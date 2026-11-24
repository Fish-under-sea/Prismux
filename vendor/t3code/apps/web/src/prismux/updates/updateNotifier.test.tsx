// @effect-diagnostics-next-line nodeBuiltinImport:off
import fs from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  createBackdropDismissGuardState,
  hasOpenNestedOverlay,
  recordBackdropPointerDown,
  shouldDismissOnBackdropClick,
} from "../../components/ui/dialog-styles";
import type { UpdateCheckView } from "../settings/prismuxUpdates.logic";
import { PrismuxReleaseNotesMarkdown } from "./PrismuxReleaseNotesMarkdown";
import { PrismuxSidebarUpdateCapsule } from "./PrismuxSidebarUpdateCapsule";
import { PrismuxUpdateReleaseModal } from "./PrismuxUpdateReleaseModal";
import {
  AUTO_CHECK_UPDATES_STORAGE_KEY,
  COLLAPSED_UPDATE_VERSIONS_STORAGE_KEY,
  createUpdateNotifierStore,
  extractReleaseNotesPreview,
  parseReleaseNotesBlocks,
  prismuxUpdateNotifierStore,
  shouldPollUpdaterStatusFallback,
  startUpdaterStatusFallbackPoller,
  type StorageLike,
} from "./updateNotifierStore";
import {
  extractReleaseNotesHighlights,
  parseUpdaterStatusPayload,
} from "../settings/prismuxUpdates.logic";

function createMemoryStorage(): StorageLike & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function makeUpdateCheck(overrides: Partial<UpdateCheckView> = {}): UpdateCheckView {
  return {
    checkedAt: 1_764_000_000_000,
    currentVersion: "0.1.2-alpha.1",
    hasUpdate: true,
    latestVersion: "0.2.0",
    tagName: "v0.2.0",
    channel: "stable",
    releaseName: "Prismux v0.2.0",
    releaseNotes: [
      "## 更新亮点",
      "- **自动检测更新**：启动与后台定时静默检查 GitHub / Gitee 双源新版本",
      "- 新增右下角液态玻璃提醒卡片与 `SHA-256` 强校验软件内一键更新弹窗",
      "",
      "感谢大家反馈！",
    ].join("\n"),
    publishedAt: "2026-11-24T00:00:00Z",
    htmlUrl: "https://github.com/Fish-under-sea/Prismux/releases/tag/v0.2.0",
    sourceUsed: "github",
    usedFallbackSource: false,
    recommendedAsset: {
      name: "Prismux-Setup-0.2.0.exe",
      kind: "setup-exe",
      effectiveUrl: "https://github.com/Fish-under-sea/Prismux/releases/download/v0.2.0/Prismux-Setup-0.2.0.exe",
      sizeBytes: 86_400_000,
      sha256: "a".repeat(64),
      expectedExeName: null,
      parts: [],
      source: "github",
    },
    assets: [],
    ...overrides,
  };
}

describe("updateNotifierStore state machine & persistence", () => {
  beforeEach(() => {
    prismuxUpdateNotifierStore.dismissAllForReset();
  });

  it("persists autoCheckEnabled locally and respects local dirty changes during daemon hydration", () => {
    const storage = createMemoryStorage();
    const store = createUpdateNotifierStore({ storage });

    expect(store.getState().autoCheckEnabled).toBe(true);

    store.setAutoCheckEnabled(false);
    expect(store.getState().autoCheckEnabled).toBe(false);
    expect(storage.map.get(AUTO_CHECK_UPDATES_STORAGE_KEY)).toBe("false");
    expect(store.isLocalAutoCheckDirty()).toBe(true);

    // Hydrating stale daemon state while local edit is dirty must not clobber the user's choice.
    store.hydrateFromDaemonStatus({
      currentVersion: "0.1.2",
      portableMode: false,
      policy: {
        routePreference: "auto",
        channel: "prerelease",
        includePrerelease: true,
        customGhProxyPrefix: "",
        pluginRegistryOverride: "auto",
        timeoutMs: 15_000,
        autoCheckEnabled: true,
      },
      checking: false,
      downloading: false,
      installState: "idle",
      progress: null,
      downloadedFilePath: null,
      downloadedSha256: null,
      lastCheck: null,
      lastProbe: null,
      lastError: null,
    });
    expect(store.getState().autoCheckEnabled).toBe(false);

    // Reloading a fresh store restores persisted false preference.
    const reloaded = createUpdateNotifierStore({ storage });
    expect(reloaded.getState().autoCheckEnabled).toBe(false);
  });

  it("drives full toast -> modal -> curved fly collapse -> sidebar capsule -> reopen modal lifecycle", () => {
    const storage = createMemoryStorage();
    const store = createUpdateNotifierStore({ storage });

    expect(store.getState().presentation).toBe("hidden");

    // 1. Update detected -> bottom-right liquid glass toast.
    store.reportUpdateAvailable(makeUpdateCheck());
    expect(store.getState().presentation).toBe("toast");
    expect(store.getState().availableUpdate?.latestVersion).toBe("0.2.0");

    // 2. Click toast -> centered release notes & in-app update modal.
    store.openReleaseModal();
    expect(store.getState().presentation).toBe("modal");

    // 3. Dismiss with rect -> smooth FLIP fly transition + sidebar capsule + version persisted.
    store.collapseToCapsule({ left: 900, top: 600, width: 328, height: 120 }, false);
    expect(store.getState().presentation).toBe("capsule");
    expect(store.getState().flyTransition).not.toBeNull();
    expect(store.getState().flyTransition?.version).toBe("0.2.0");
    expect(storage.map.get(COLLAPSED_UPDATE_VERSIONS_STORAGE_KEY)).toContain("0.2.0");

    // 4. Fly animation completes -> ghost clears, capsule remains visible.
    store.clearFlyTransition(store.getState().flyTransition!.id);
    expect(store.getState().flyTransition).toBeNull();
    expect(store.getState().presentation).toBe("capsule");

    // 5. Reduced-motion collapse skips flight ghost while still docking capsule.
    store.openReleaseModal();
    store.collapseToCapsule({ left: 900, top: 600, width: 328, height: 120 }, true);
    expect(store.getState().flyTransition).toBeNull();
    expect(store.getState().presentation).toBe("capsule");

    // 6. Reloading with same version stays calmly in sidebar capsule instead of nagging again.
    const reloaded = createUpdateNotifierStore({ storage });
    reloaded.reportUpdateAvailable(makeUpdateCheck({ latestVersion: "0.2.0" }));
    expect(reloaded.getState().presentation).toBe("capsule");

    // 7. A newer release v0.2.1 gently shows the bottom-right toast again.
    reloaded.reportUpdateAvailable(makeUpdateCheck({ latestVersion: "0.2.1", tagName: "v0.2.1" }));
    expect(reloaded.getState().presentation).toBe("toast");

    // 8. Clicking sidebar capsule reopens the centered release modal.
    store.openReleaseModal();
    expect(store.getState().presentation).toBe("modal");
  });

  it("tracks download speed & ready state from Daemon SSE events", () => {
    const store = createUpdateNotifierStore({ storage: createMemoryStorage() });
    store.hydrateFromDaemonStatus({
      currentVersion: "0.1.2",
      portableMode: false,
      policy: {
        routePreference: "auto",
        channel: "stable",
        includePrerelease: false,
        customGhProxyPrefix: "",
        pluginRegistryOverride: "auto",
        timeoutMs: 15_000,
        autoCheckEnabled: true,
      },
      checking: false,
      downloading: false,
      installState: "available",
      progress: null,
      downloadedFilePath: null,
      downloadedSha256: null,
      lastCheck: makeUpdateCheck(),
      lastProbe: null,
      lastError: null,
    });

    store.applySseEvent({
      event: "progress",
      data: {
        installState: "downloading",
        progress: {
          stage: "downloading",
          percent: 10,
          bytesDownloaded: 1_000_000,
          totalBytes: 10_000_000,
          updatedAt: 1000,
        },
      },
      rawData: "",
      receivedAt: 1000,
    });
    store.applySseEvent({
      event: "progress",
      data: {
        installState: "downloading",
        progress: {
          stage: "downloading",
          percent: 30,
          bytesDownloaded: 3_000_000,
          totalBytes: 10_000_000,
          updatedAt: 2000,
        },
      },
      rawData: "",
      receivedAt: 2000,
    });

    expect(store.getState().downloading).toBe(true);
    expect(store.getState().speedBytesPerSec).toBeGreaterThan(1_500_000);

    store.applySseEvent({
      event: "ready",
      data: {
        installState: "ready",
        downloadedFilePath: "C:\\Users\\Fish\\.prismux\\updates\\Prismux-Setup-0.2.0.exe",
        downloadedSha256: "f".repeat(64),
        progress: { stage: "ready", percent: 100, bytesDownloaded: 10_000_000, totalBytes: 10_000_000, updatedAt: 3000 },
      },
      rawData: "",
      receivedAt: 3000,
    });

    expect(store.getState().downloading).toBe(false);
    expect(store.getState().speedBytesPerSec).toBeNull();
    expect(store.getState().updaterStatus?.downloadedSha256).toBe("f".repeat(64));
  });

  it("extracts concise release note preview and parses structured Markdown blocks safely", () => {
    const notes = makeUpdateCheck().releaseNotes;
    const preview = extractReleaseNotesPreview(notes);
    expect(preview).toContain("自动检测更新");
    expect(preview).not.toContain("**");
    expect(preview).not.toContain("##");

    const blocks = parseReleaseNotesBlocks(notes);
    expect(blocks[0]).toEqual({ type: "heading", level: 2, text: "更新亮点" });
    expect(blocks[1]?.type).toBe("list");
    if (blocks[1]?.type === "list") {
      expect(blocks[1].items).toHaveLength(2);
    }
    expect(blocks[2]).toEqual({ type: "paragraph", text: "感谢大家反馈！" });
  });

  it("strips Markdown blockquote prefixes (>) and GitHub Alert tags ([!NOTE]/[!IMPORTANT]/etc.) from toast preview", () => {
    const quotedReleaseNotes = [
      "# Prismux v0.1.2-preview.2",
      "",
      "> 纯宿主视觉层 0 Token 开销，内置 `sqlite-vec` 混合检索开箱即用。",
      "",
      "## 更新亮点",
      "- 其他内容",
    ].join("\n");
    const quotedPreview = extractReleaseNotesPreview(quotedReleaseNotes);
    expect(quotedPreview).toBe("纯宿主视觉层 0 Token 开销，内置 sqlite-vec 混合检索开箱即用。");
    expect(quotedPreview.startsWith(">")).toBe(false);
    expect(quotedPreview).not.toContain("`");

    const alertMultiLineNotes = [
      "# Release v0.2.0",
      "> [!IMPORTANT]",
      "> **官方插件默认零预装**，请按需在插件中心安装。",
    ].join("\n");
    const alertMultiLinePreview = extractReleaseNotesPreview(alertMultiLineNotes);
    expect(alertMultiLinePreview).toBe("官方插件默认零预装，请按需在插件中心安装。");
    expect(alertMultiLinePreview).not.toContain("[!IMPORTANT]");
    expect(alertMultiLinePreview).not.toContain(">");
    expect(alertMultiLinePreview).not.toContain("**");

    const alertInlineNotes = "> [!NOTE] 仅本机运行，零外部服务依赖。";
    expect(extractReleaseNotesPreview(alertInlineNotes)).toBe("仅本机运行，零外部服务依赖。");

    const nestedAndFenceNotes = [
      "```bash",
      "pnpm build",
      "```",
      "> [!WARNING]",
      "> > - [x] **嵌套引用与任务列表**均可干净提取",
    ].join("\n");
    expect(extractReleaseNotesPreview(nestedAndFenceNotes)).toBe(
      "嵌套引用与任务列表均可干净提取",
    );

    const parsedBlocks = parseReleaseNotesBlocks(alertMultiLineNotes);
    expect(parsedBlocks).toEqual([
      { type: "heading", level: 1, text: "Release v0.2.0" },
      { type: "paragraph", text: "**官方插件默认零预装**，请按需在插件中心安装。" },
    ]);
  });
});

describe("Sidebar update capsule & release modal rendering", () => {
  beforeEach(() => {
    prismuxUpdateNotifierStore.dismissAllForReset();
  });

  it("renders zero footprint when hidden/toast and displays expanded & 54px rail capsule when collapsed", () => {
    expect(
      renderToStaticMarkup(createElement(PrismuxSidebarUpdateCapsule, { railCompact: false })),
    ).toBe("");

    prismuxUpdateNotifierStore.reportUpdateAvailable(makeUpdateCheck());
    // Still in toast state -> capsule occupies 0px.
    expect(
      renderToStaticMarkup(createElement(PrismuxSidebarUpdateCapsule, { railCompact: false })),
    ).toBe("");

    // Collapse to sidebar capsule.
    prismuxUpdateNotifierStore.collapseToCapsule(null, true);

    const expandedHtml = renderToStaticMarkup(
      createElement(PrismuxSidebarUpdateCapsule, { railCompact: false }),
    );
    expect(expandedHtml).toContain('data-testid="prismux-sidebar-update-capsule"');
    expect(expandedHtml).toContain('data-prismux-update-capsule-slot="true"');
    expect(expandedHtml).toContain('data-pmx-glass-zone="overlays"');
    expect(expandedHtml).toContain("发现新版本 v0.2.0");

    const compactHtml = renderToStaticMarkup(
      createElement(PrismuxSidebarUpdateCapsule, { railCompact: true }),
    );
    expect(compactHtml).toContain('data-testid="prismux-sidebar-update-capsule"');
    expect(compactHtml).toContain("size-[26px]");
    expect(compactHtml).toContain('data-pmx-glass-zone="overlays"');
  });

  it("renders centered liquid glass release modal with release notes and in-app update button", () => {
    prismuxUpdateNotifierStore.reportUpdateAvailable(makeUpdateCheck());
    prismuxUpdateNotifierStore.openReleaseModal();

    const modalHtml = renderToStaticMarkup(createElement(PrismuxUpdateReleaseModal));
    expect(modalHtml).toContain('role="dialog"');
    expect(modalHtml).toContain('data-testid="prismux-update-release-modal"');
    expect(modalHtml).toContain('data-pmx-glass-zone="overlays"');
    expect(modalHtml).toContain("fixed inset-0 z-[75] flex items-center justify-center");
    expect(modalHtml).toContain("v0.1.2-alpha.1");
    expect(modalHtml).toContain("v0.2.0");
    expect(modalHtml).toContain("更新亮点");
    expect(modalHtml).toContain("软件内一键更新");
    expect(modalHtml).toContain("稍后提醒");
  });

  it("renders rich sanitized Markdown (headings, blockquotes, bold, inline/block code, GFM tables, hr, safe https links) across settings and update modal without raw syntax leakage", () => {
    const richNotes = [
      "# Prismux v0.1.2 Preview 1",
      "",
      "> 标准 SemVer / Tag: `v0.1.2-preview.1` (`0.1.2-preview.1`)。**官方四大插件（`qq` / `pet` / `fishdock-hook` / `ssh`）严格保持默认零预装**：按需独立安装。",
      "",
      "## 📦 下载指南：我应该下载哪个文件？",
      "",
      "### 1. 桌面主程序 (Desktop App)",
      "",
      "| 文件名 | 适用场景 | 校验 |",
      "| :--- | :--- | :--- |",
      "| `Prismux-Setup.exe` | 标准安装版 | **SHA-256** |",
      "| `Prismux-Portable.zip` | 便携目录版 | **SHA-256** |",
      "",
      "1. 下载对应安装包",
      "2. 核对 [GitHub Releases](https://github.com/Fish-under-sea/Prismux/releases)",
      "",
      "- 禁止危险链接：[恶意链接](javascript:alert(1))",
      "- 原始 HTML 必须安全转义：<script>window.__xss=1</script>",
      "",
      "```bash",
      "pnpm release:build",
      "```",
      "",
      "---",
    ].join("\n");

    const renderedHtml = renderToStaticMarkup(
      createElement(PrismuxReleaseNotesMarkdown, { markdown: richNotes }),
    );

    expect(renderedHtml).toContain('data-pmx-release-notes-markdown="1"');
    expect(renderedHtml).toContain("<h1");
    expect(renderedHtml).toContain("Prismux v0.1.2 Preview 1</h1>");
    expect(renderedHtml).toContain("<h2");
    expect(renderedHtml).toContain("下载指南：我应该下载哪个文件？</h2>");
    expect(renderedHtml).toContain("<h3");
    expect(renderedHtml).toContain("1. 桌面主程序 (Desktop App)</h3>");
    expect(renderedHtml).toContain("<blockquote");
    expect(renderedHtml).toContain("<strong");
    expect(renderedHtml).toContain("官方四大插件");
    expect(renderedHtml).toContain("<code");
    expect(renderedHtml).toContain("v0.1.2-preview.1");
    expect(renderedHtml).toContain('data-pmx-release-notes-table-wrap="1"');
    expect(renderedHtml).toContain("overflow-x-auto");
    expect(renderedHtml).toContain("<table");
    expect(renderedHtml).toContain("<thead");
    expect(renderedHtml).toContain("<tbody");
    expect(renderedHtml).toContain("<ol");
    expect(renderedHtml).toContain("<ul");
    expect(renderedHtml).toContain("<pre");
    expect(renderedHtml).toContain("pnpm release:build");
    expect(renderedHtml).toContain("<hr");
    expect(renderedHtml).toContain('href="https://github.com/Fish-under-sea/Prismux/releases"');
    expect(renderedHtml).toContain('rel="noopener noreferrer"');

    // No raw markdown syntax symbols leaking into rendered output
    expect(renderedHtml).not.toContain("# Prismux v0.1.2 Preview 1");
    expect(renderedHtml).not.toContain("## 📦");
    expect(renderedHtml).not.toContain("### 1.");
    expect(renderedHtml).not.toContain("&gt; 标准 SemVer");
    expect(renderedHtml).not.toContain("**官方四大插件");
    expect(renderedHtml).not.toContain("| :--- |");

    // Strict XSS & protocol hardening (no script tag or javascript: href)
    expect(renderedHtml).not.toContain("<script>");
    expect(renderedHtml).not.toContain('href="javascript:');

    // Update release modal also renders full rich Markdown via PrismuxReleaseNotesMarkdown
    prismuxUpdateNotifierStore.reportUpdateAvailable(makeUpdateCheck({ releaseNotes: richNotes }));
    prismuxUpdateNotifierStore.openReleaseModal();
    const modalHtml = renderToStaticMarkup(createElement(PrismuxUpdateReleaseModal));
    expect(modalHtml).toContain('data-pmx-release-notes-markdown="1"');
    expect(modalHtml).toContain("<blockquote");
    expect(modalHtml).toContain("<table");
    expect(modalHtml).not.toContain("**官方四大插件");

    // Verify PrismuxUpdatesSettingsPage no longer renders raw <pre> releaseNotes
    const updatesSettingsSource = fs.readFileSync(
      path.resolve(import.meta.dirname, "../settings/PrismuxUpdatesSettingsPage.tsx"),
      "utf8",
    );
    expect(updatesSettingsSource).toContain("<PrismuxReleaseNotesMarkdown");
    expect(updatesSettingsSource).toContain("extractReleaseNotesHighlights");
    expect(updatesSettingsSource).not.toContain("whitespace-pre-wrap");
  });

  it("extracts and richly renders all 5 numbered sections of real v0.1.3-preview.1 (and v0.1.2-preview.4) without raw ** or backticks or download boilerplate", () => {
    const realV013ReleaseNotes = [
      "# Prismux v0.1.3 Preview 1",
      "",
      "> 标准 SemVer / Tag：`v0.1.3-preview.1`（`0.1.3-preview.1`）。本次为大版本视觉与交互升级，**官方两大活跃插件（`qq` / `fishdock-hook`）严格保持默认零预装**。",
      "",
      "## ✨ 本次核心升级亮点（v0.1.3 Preview 1）",
      "",
      "### 1. 1:1 还原 AGY 蜂群侧边栏 & 多 Agent 原生只读协作视图",
      "- **AGY 蜂群 1:1 复刻**：原生只读还原 22×18 像素蜜蜂与蜂王皇冠、概览目标/进度/工作流、公告板（`@提及` / `#序号` 跳转胶囊与未读分隔线）、成员实时活动与离场筛选，以及关系图 / 消息回放。",
      "- **多 Agent 原生适配**：同步提供 Claude Code（`~/.claude/teams`、`inboxes`、`tasks`）与 Codex（子代理协作、`goals` / `state`）原生只读协作侧边栏，不自建任何重型编排 DAG。",
      "- **按需无扰唤醒**：仅在协作状态首次从休眠切入活跃时自动弹出（历史/空闲会话绝不误弹），并在概览面板「在终端继续」正下方提供一键打开入口。",
      "",
      "### 2. `/` 斜杠命令前缀图标双语汉化 & `@对话 / @工作 Agent` 提及",
      "- **清晰双语格式**：统一按「图标 中文 小号原生英文：汉化介绍」排布（如 `🐝 蜂群 swarm：...`、`🕒 定时 schedule：...`）；技能项统一按「图标 技能 原生名：描述」展示，**个人技能严守原名不做汉化**，原生/系统自带技能完整汉化。",
      "- **折叠分层排序**：只输入 `/` 时原生 Agent 指令排在顶部，个人技能与自带技能归入同一可展开折叠项（展开后先列「个人技能」，再列「自带技能」）。",
      "- **增强 `@` 提及**：空 `@` 与中文关键词均可直接召出 `@对话`、`@工作 Agent`、`@主机` 与 `@文件`。",
      "",
      "### 3. 侧栏液态玻璃卡片、RGB 呼吸态、AGY 胶囊气泡 & Orca 详细配额",
      "- **高对比四边液态玻璃卡片**：全面补全侧栏会话卡片四边玻璃质感与对比度（`刚刚`、Agent Logo、项目名与主机名在复杂壁纸下均清晰可读），移除前置状态圆点；活跃执行中的会话呈现旋转 RGB 跑马灯边环与呼吸 Agent Logo，空闲态静默优雅。",
      "- **AGY 扁平大圆角胶囊气泡**：用户消息采用扁平大圆角胶囊设计，在浅色液态玻璃与深色液态玻璃下呈现清晰视觉区隔。",
      "- **底部 20px 状态栏详细配额联动**：底部配额胶囊与浮窗 `详细 / 精简` 模式完全同步，一屏尽览多窗口百分比与迷你进度条。",
      "",
      "### 4. 空白新会话硬单例、概览面板解耦防遮挡 & 壁纸侧栏精简",
      "- **空白新会话硬单例**：同一工作区最多仅保留 1 个未发送消息的空白草稿标签，支持原位切换 Agent，点击新建或切换标签绝不再连弹多个重复空白会话。",
      "- **概览面板独立悬浮与动态限高**：右侧「概览」与底部居中对话框彻底解耦（对话框不再左偏），强制保障底部 ≥ 28px 留白，默认隐藏已完成/已结束项，并随窗口/全屏高度自动调整每区显示条数上限（支持右上角 `⋮` 手动定制）。",
      "- **壁纸侧边栏精简与永久去重**：删除「壁纸属性」按钮、底部重复「外观与玻璃」按钮、壁纸页重复声音控制以及 4 张合成场景壁纸；导入本地图片按文件大小 + SHA-256 永久去重，仅保留唯一副本。",
      "",
      "### 5. 宿主机时区自动语言识别、全宽无白框天体胶囊 & 升级/体检重设计",
      "- **时区自动语言切换**：首次启动默认读取宿主机 IANA 时区，在已支持的 10 种语言中自动切换（中国时区即刻直达全中文 `/welcome` 欢迎页）；一旦用户手动切换语言后，后续永不覆盖用户选择。",
      "- **全宽无白框天体三态胶囊**：`/welcome` 天体三态胶囊拉满全宽对齐右侧边缘，并彻底移除点击玻璃态时右侧 1/3 出现刺眼白框的焦点描边。",
      "- **分卷加权下载进度条 & 四级液态玻璃服务体检**：Gitee 3 段分卷下载按 `3×30% + 5% 解压 + 5% 校验 = 100%` 实时流式推送进度与 MB/s 速率，彻底根治进度条卡死前半段；服务体检中心升级为四级液态玻璃卡片与翡翠绿混合记忆引擎横幅。",
      "",
      "## 📦 下载指南（Windows x64 · 零预装插件）",
      "",
      "| 资产文件 | 用途说明 | SHA-256 |",
      "| :--- | :--- | :--- |",
      "| **`Prismux-Setup-0.1.3-preview.1-win-x64.exe`**（208.39 MB） | Electron 44 Windows x64 安装包 | `9498ae63f670e28acef5143ea3533b53d07c2bfdbfe584f5910a75475c71f8c0` |",
      "",
      "> 中国大陆用户亦可前往 **[Gitee Releases (`v0.1.3-preview.1`)](https://gitee.com/Fish-under-sea/Prismux/releases/tag/v0.1.3-preview.1)** 获取高速 80 MB 无损分卷（`.7z.001..003`）。",
      "",
      "### Gitee 80 MB 无损分卷还原说明",
      "",
      "```powershell",
      "7z x Prismux-Setup-0.1.3-preview.1-win-x64.exe.7z.001",
      "(Get-FileHash .\\Prismux-Setup-0.1.3-preview.1-win-x64.exe -Algorithm SHA256).Hash.ToLower()",
      "```",
    ].join("\n");

    // Toast preview surfaces the real first highlight bullet, not SemVer boilerplate
    const toastPreview = extractReleaseNotesPreview(realV013ReleaseNotes);
    expect(toastPreview).toContain("AGY 蜂群 1:1 复刻");
    expect(toastPreview).not.toContain("标准 SemVer");
    expect(toastPreview).not.toContain("**");
    expect(toastPreview).not.toContain("`");

    // Modal renders full structured highlights cleanly
    prismuxUpdateNotifierStore.reportUpdateAvailable(
      makeUpdateCheck({
        currentVersion: "0.1.2-preview.4",
        latestVersion: "0.1.3-preview.1",
        tagName: "v0.1.3-preview.1",
        releaseName: "Prismux v0.1.3 Preview 1",
        releaseNotes: realV013ReleaseNotes,
        sourceUsed: "gitee",
      }),
    );
    prismuxUpdateNotifierStore.openReleaseModal();

    const modalHtml = renderToStaticMarkup(createElement(PrismuxUpdateReleaseModal));
    expect(modalHtml).toContain("✨ 本次核心升级亮点（v0.1.3 Preview 1）</h2>");
    expect(modalHtml).toContain("1. 1:1 还原 AGY 蜂群侧边栏 &amp; 多 Agent 原生只读协作视图</h3>");
    expect(modalHtml).toContain("2. <code");
    expect(modalHtml).toContain("斜杠命令前缀图标双语汉化");
    expect(modalHtml).toContain("3. 侧栏液态玻璃卡片、RGB 呼吸态、AGY 胶囊气泡 &amp; Orca 详细配额</h3>");
    expect(modalHtml).toContain("4. 空白新会话硬单例、概览面板解耦防遮挡 &amp; 壁纸侧栏精简</h3>");
    expect(modalHtml).toContain("5. 宿主机时区自动语言识别、全宽无白框天体胶囊 &amp; 升级/体检重设计</h3>");

    // Bold lead-ins and inline code pills rendered cleanly with zero raw markdown leakage
    expect(modalHtml).toContain("<strong");
    expect(modalHtml).toContain("AGY 蜂群 1:1 复刻</strong>");
    expect(modalHtml).toContain("分卷加权下载进度条 &amp; 四级液态玻璃服务体检</strong>");
    expect(modalHtml).toContain("~/.claude/teams</code>");
    expect(modalHtml).toContain("3×30% + 5% 解压 + 5% 校验 = 100%</code>");
    expect(modalHtml).not.toContain("**");
    expect(modalHtml).not.toContain("`");

    // Boilerplate tables, SHA-256 commands, and fallback one-liner must NOT appear
    expect(modalHtml).not.toContain("标准 SemVer / Tag");
    expect(modalHtml).not.toContain("下载指南");
    expect(modalHtml).not.toContain("Gitee 80 MB 无损分卷");
    expect(modalHtml).not.toContain("Get-FileHash");
    expect(modalHtml).not.toContain("9498ae63f670e28a");
    expect(modalHtml).not.toContain("此版本包含性能与液态玻璃体验优化");

    // v0.1.2-preview.4 format (highlights AFTER download guide) renders cleanly in settings/modal pipeline too
    const realV0124Notes = [
      "# Prismux v0.1.2 Preview 4",
      "",
      "> 标准 SemVer / Tag：`v0.1.2-preview.4`（`0.1.2-preview.4`）。",
      "",
      "## 📦 下载指南：我应该下载哪个文件？",
      "",
      "| 平台 | 下载 |",
      "| :--- | :--- |",
      "| Windows | `Prismux-Setup-0.1.2-preview.4-win-x64.exe` |",
      "",
      "## ✨ Prismux v0.1.2 Preview 4 六大核心升级",
      "",
      "- **Codex Windows 双模启动修复**：`npmNodeShimCommand` 零壳直启。",
      "- **权威插件文档**：新增 [`plugin-development-guide.md`](https://github.com/Fish-under-sea/Prismux/blob/v0.1.2-preview.4/docs/plugins/plugin-development-guide.md)。",
    ].join("\n");

    const settingsRenderedHtml = renderToStaticMarkup(
      createElement(PrismuxReleaseNotesMarkdown, {
        markdown: extractReleaseNotesHighlights(realV0124Notes),
      }),
    );
    expect(settingsRenderedHtml).toContain("✨ Prismux v0.1.2 Preview 4 六大核心升级</h2>");
    expect(settingsRenderedHtml).toContain("Codex Windows 双模启动修复</strong>");
    expect(settingsRenderedHtml).toContain("npmNodeShimCommand</code>");
    expect(settingsRenderedHtml).toContain(
      'href="https://github.com/Fish-under-sea/Prismux/blob/v0.1.2-preview.4/docs/plugins/plugin-development-guide.md"',
    );
    expect(settingsRenderedHtml).not.toContain("下载指南");
    expect(settingsRenderedHtml).not.toContain("标准 SemVer / Tag");
    expect(settingsRenderedHtml).not.toContain("**");
    expect(settingsRenderedHtml).not.toContain("`");
  });

  it("renders exact weighted determinate progress width, MB/s speed, split volume badge, and 4-stage indicator without fake 14%/15% widths", () => {
    const splitCheck = makeUpdateCheck({
      sourceUsed: "gitee",
      recommendedAsset: {
        name: "Prismux-Setup-0.2.0.exe",
        kind: "split-7z-exe",
        effectiveUrl: "https://gitee.com/Fish-under-sea/Prismux/releases/download/v0.2.0/Prismux-Setup-0.2.0.exe.7z.001",
        sizeBytes: 218_000_000,
        sha256: "a".repeat(64),
        expectedExeName: "Prismux-Setup-0.2.0.exe",
        parts: [
          { name: "Prismux-Setup-0.2.0.exe.7z.001", url: "https://gitee.com/a/1", size: 95_000_000 },
          { name: "Prismux-Setup-0.2.0.exe.7z.002", url: "https://gitee.com/a/2", size: 95_000_000 },
          { name: "Prismux-Setup-0.2.0.exe.7z.003", url: "https://gitee.com/a/3", size: 28_000_000 },
        ],
        source: "gitee",
      },
    });
    prismuxUpdateNotifierStore.hydrateFromDaemonStatus({
      currentVersion: "0.1.2-preview.4",
      portableMode: false,
      policy: {
        routePreference: "domestic",
        channel: "prerelease",
        includePrerelease: true,
        customGhProxyPrefix: "",
        pluginRegistryOverride: "auto",
        timeoutMs: 15_000,
        autoCheckEnabled: true,
      },
      checking: false,
      downloading: true,
      installState: "downloading",
      progress: {
        stage: "downloading",
        percent: 32,
        bytesDownloaded: 100_000_000,
        totalBytes: 218_000_000,
        currentPart: 2,
        totalParts: 3,
        partName: "Prismux-Setup-0.2.0.exe.7z.002",
        message: "正在下载分卷 2/3",
        updatedAt: 1000,
      },
      downloadedFilePath: null,
      downloadedSha256: null,
      lastCheck: splitCheck,
      lastProbe: null,
      lastError: null,
    });
    // Second SSE progress tick establishes live MB/s speed and advances bar to exact 42.6%.
    prismuxUpdateNotifierStore.applySseEvent({
      event: "progress",
      data: {
        installState: "downloading",
        progress: {
          stage: "downloading",
          percent: 42.6,
          bytesDownloaded: 112_000_000,
          totalBytes: 218_000_000,
          currentPart: 2,
          totalParts: 3,
          partName: "Prismux-Setup-0.2.0.exe.7z.002",
          message: "正在下载分卷 2/3",
          updatedAt: 2000,
        },
      },
      rawData: "",
      receivedAt: 2000,
    });
    prismuxUpdateNotifierStore.openReleaseModal();

    const modalHtml = renderToStaticMarkup(createElement(PrismuxUpdateReleaseModal));
    expect(modalHtml).toContain('data-progress-mode="determinate"');
    expect(modalHtml).toContain('data-testid="prismux-update-modal-progressbar-fill"');
    expect(modalHtml).toContain("width:42.6%");
    expect(modalHtml).not.toContain("width:14%");
    expect(modalHtml).not.toContain("width:15%");
    expect(modalHtml).toContain("43%");
    expect(modalHtml).toContain('data-testid="prismux-update-modal-speed"');
    expect(modalHtml).toContain("MB/s");
    expect(modalHtml).toContain('data-testid="prismux-update-modal-part"');
    expect(modalHtml).toContain("分卷 2/3");
    expect(modalHtml).toContain('data-stage-step="downloading" data-stage-state="active"');
    expect(modalHtml).toContain('data-stage-step="extracting" data-stage-state="pending"');
    expect(modalHtml).toContain("0–90%");
    expect(modalHtml).toContain("90–95%");
    expect(modalHtml).toContain("95–100%");

    // Collapsed sidebar capsule shows live percentage & hairline progress bar.
    prismuxUpdateNotifierStore.collapseToCapsule(null, true);
    const capsuleHtml = renderToStaticMarkup(
      createElement(PrismuxSidebarUpdateCapsule, { railCompact: false }),
    );
    expect(capsuleHtml).toContain("下载更新 43%");
    expect(capsuleHtml).toContain('data-testid="prismux-sidebar-update-capsule-progress"');
    expect(capsuleHtml).toContain("width:42.6%");
  });

  it("renders reduced-motion-safe indeterminate shimmer bar during null-percent connection handshake instead of static 14%/15%", () => {
    prismuxUpdateNotifierStore.hydrateFromDaemonStatus({
      currentVersion: "0.1.2-preview.4",
      portableMode: false,
      policy: {
        routePreference: "auto",
        channel: "prerelease",
        includePrerelease: true,
        customGhProxyPrefix: "",
        pluginRegistryOverride: "auto",
        timeoutMs: 15_000,
        autoCheckEnabled: true,
      },
      checking: false,
      downloading: true,
      installState: "downloading",
      progress: {
        stage: "downloading",
        percent: null,
        bytesDownloaded: 0,
        totalBytes: null,
        currentPart: null,
        totalParts: null,
        partName: null,
        message: null,
        updatedAt: 1000,
      },
      downloadedFilePath: null,
      downloadedSha256: null,
      lastCheck: makeUpdateCheck(),
      lastProbe: null,
      lastError: null,
    });
    prismuxUpdateNotifierStore.openReleaseModal();

    const modalHtml = renderToStaticMarkup(createElement(PrismuxUpdateReleaseModal));
    expect(modalHtml).toContain('data-progress-mode="indeterminate"');
    expect(modalHtml).toContain('data-testid="prismux-update-modal-progressbar-indeterminate"');
    expect(modalHtml).toContain("motion-reduce:animate-none");
    expect(modalHtml).toContain("正在连接下载源…");
    expect(modalHtml).toContain("连接中…");
    expect(modalHtml).not.toContain("width:14%");
    expect(modalHtml).not.toContain("width:15%");
    expect(modalHtml).not.toContain("aria-valuenow=");
  });

  it("activates 500ms status polling fallback whenever SSE goes silent > 700ms during active transfer and guards against stale out-of-order polls", async () => {
    const store = createUpdateNotifierStore({ storage: createMemoryStorage() });
    let clock = 10_000;

    store.hydrateFromDaemonStatus({
      currentVersion: "0.1.2-preview.4",
      portableMode: false,
      policy: {
        routePreference: "domestic",
        channel: "prerelease",
        includePrerelease: true,
        customGhProxyPrefix: "",
        pluginRegistryOverride: "auto",
        timeoutMs: 15_000,
        autoCheckEnabled: true,
      },
      checking: false,
      downloading: true,
      installState: "downloading",
      progress: {
        stage: "downloading",
        percent: 20,
        bytesDownloaded: 40_000_000,
        totalBytes: 200_000_000,
        currentPart: 1,
        totalParts: 3,
        partName: "Prismux-Setup.exe.7z.001",
        message: null,
        updatedAt: 10_000,
      },
      downloadedFilePath: null,
      downloadedSha256: null,
      lastCheck: makeUpdateCheck(),
      lastProbe: null,
      lastError: null,
    });

    // Fresh SSE event received at t=10_000 -> at t=10_500 (500ms <= 700ms), fallback poll stays idle.
    store.applySseEvent({
      event: "progress",
      data: {
        installState: "downloading",
        progress: {
          stage: "downloading",
          percent: 24,
          bytesDownloaded: 48_000_000,
          totalBytes: 200_000_000,
          currentPart: 1,
          totalParts: 3,
          partName: "Prismux-Setup.exe.7z.001",
          updatedAt: 10_000,
        },
      },
      rawData: "",
      receivedAt: 10_000,
    });
    expect(shouldPollUpdaterStatusFallback(store.getState(), 10_500)).toBe(false);
    expect(shouldPollUpdaterStatusFallback(store.getState(), 10_701)).toBe(true);

    const registeredTicks: Array<() => void> = [];
    let cleared = false;
    let pollCalls = 0;

    const stop = startUpdaterStatusFallbackPoller({
      store,
      intervalMs: 500,
      staleThresholdMs: 700,
      now: () => clock,
      setIntervalFn: ((fn: () => void) => {
        registeredTicks.push(fn);
        return 1 as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval,
      clearIntervalFn: (() => {
        cleared = true;
      }) as typeof clearInterval,
      fetchStatus: async () => {
        pollCalls += 1;
        return {
          currentVersion: "0.1.2-preview.4",
          portableMode: false,
          policy: { routePreference: "domestic", channel: "prerelease" },
          checking: false,
          downloading: true,
          installState: "downloading",
          progress: {
            stage: "downloading",
            percent: 58.4,
            bytesDownloaded: 120_000_000,
            totalBytes: 200_000_000,
            currentPart: 2,
            totalParts: 3,
            partName: "Prismux-Setup.exe.7z.002",
            updatedAt: 11_000,
          },
        };
      },
      parseStatus: (raw) => parseUpdaterStatusPayload(raw, "0.1.2-preview.4"),
    });

    expect(registeredTicks).toHaveLength(1);
    const runTick = registeredTicks[0]!;

    // Tick while SSE is still fresh -> 0 HTTP polls
    clock = 10_400;
    runTick();
    await Promise.resolve();
    expect(pollCalls).toBe(0);

    // Clock crosses 700ms SSE silence -> fallback poll executes & updates store + live speed
    clock = 11_000;
    runTick();
    await new Promise((r) => setTimeout(r, 10));
    expect(pollCalls).toBe(1);
    expect(store.getState().updaterStatus?.progress?.percent).toBe(58.4);
    expect(store.getState().updaterStatus?.progress?.currentPart).toBe(2);
    expect(store.getState().speedBytesPerSec).toBeGreaterThan(0);

    // Out-of-order older poll snapshot (updatedAt < 11_000) must never rewind progress backwards!
    store.hydrateFromDaemonStatus(
      {
        ...store.getState().updaterStatus!,
        progress: {
          stage: "downloading",
          percent: 30,
          bytesDownloaded: 60_000_000,
          totalBytes: 200_000_000,
          currentPart: 1,
          totalParts: 3,
          partName: "Prismux-Setup.exe.7z.001",
          message: null,
          updatedAt: 10_500,
        },
      },
      { syncAutoCheck: false, fromPoll: true },
    );
    expect(store.getState().updaterStatus?.progress?.percent).toBe(58.4);

    stop();
    expect(cleared).toBe(true);
  });
});

describe("Global modal backdrop dismissal & centering guardrails", () => {
  it("allows primary backdrop clicks while blocking drag-out selection, right-click, busy lock, and open nested overlays", () => {
    const backdrop = { id: "backdrop" } as unknown as EventTarget;
    const innerChild = { id: "inner" } as unknown as EventTarget;
    const fakeDocNoOverlay = {
      querySelector: () => null,
      querySelectorAll: () => [],
    } as unknown as Document;

    // 1. Clean click on empty backdrop dismisses.
    const guard1 = createBackdropDismissGuardState();
    recordBackdropPointerDown(
      guard1,
      { target: backdrop, currentTarget: backdrop, button: 0 },
      null,
      fakeDocNoOverlay,
    );
    expect(
      shouldDismissOnBackdropClick(
        guard1,
        { target: backdrop, currentTarget: backdrop },
        null,
        { doc: fakeDocNoOverlay },
      ),
    ).toBe(true);

    // 2. Dragging text from inside modal onto backdrop must NOT dismiss.
    const guard2 = createBackdropDismissGuardState();
    recordBackdropPointerDown(
      guard2,
      { target: innerChild, currentTarget: backdrop, button: 0 },
      null,
      fakeDocNoOverlay,
    );
    expect(
      shouldDismissOnBackdropClick(
        guard2,
        { target: backdrop, currentTarget: backdrop },
        null,
        { doc: fakeDocNoOverlay },
      ),
    ).toBe(false);

    // 3. Right click on backdrop must NOT dismiss.
    const guard3 = createBackdropDismissGuardState();
    recordBackdropPointerDown(
      guard3,
      { target: backdrop, currentTarget: backdrop, button: 2 },
      null,
      fakeDocNoOverlay,
    );
    expect(
      shouldDismissOnBackdropClick(
        guard3,
        { target: backdrop, currentTarget: backdrop },
        null,
        { doc: fakeDocNoOverlay },
      ),
    ).toBe(false);

    // 4. Busy/deleting/installing state blocks backdrop dismissal.
    const guard4 = createBackdropDismissGuardState();
    recordBackdropPointerDown(
      guard4,
      { target: backdrop, currentTarget: backdrop, button: 0 },
      null,
      fakeDocNoOverlay,
    );
    expect(
      shouldDismissOnBackdropClick(
        guard4,
        { target: backdrop, currentTarget: backdrop },
        null,
        { disabled: true, doc: fakeDocNoOverlay },
      ),
    ).toBe(false);

    // 5. Open Select/Popover inside Settings blocks closing Settings when dismissing that inner popup.
    const fakeSelectPopup = { tagName: "DIV" } as unknown as Element;
    const fakeDocWithSelect = {
      querySelector: () => fakeSelectPopup,
      querySelectorAll: (selector: string) =>
        selector.includes("select-popup") ? [fakeSelectPopup] : [],
    } as unknown as Document;
    expect(hasOpenNestedOverlay(null, fakeDocWithSelect)).toBe(true);

    const guard5 = createBackdropDismissGuardState();
    recordBackdropPointerDown(
      guard5,
      { target: backdrop, currentTarget: backdrop, button: 0 },
      null,
      fakeDocWithSelect,
    );
    // Even after Select closes before click fires, the pointerdown guard prevents closing Settings.
    expect(
      shouldDismissOnBackdropClick(
        guard5,
        { target: backdrop, currentTarget: backdrop },
        null,
        { doc: fakeDocNoOverlay },
      ),
    ).toBe(false);

    // 6. Stacked modals: AlertDialog (e.g. ProviderDeleteDialog) rendered AFTER underlying Settings
    // AppRouteModal must close on its own backdrop click while underlying Settings stays open!
    const DOCUMENT_POSITION_PRECEDING = 2;
    const DOCUMENT_POSITION_FOLLOWING = 4;
    const settingsPopup = {
      contains: () => false,
      compareDocumentPosition: (other: Node) =>
        other === (alertPopup as unknown as Node) ? DOCUMENT_POSITION_FOLLOWING : 0,
    } as unknown as Element;
    const alertPopup = {
      contains: () => false,
      compareDocumentPosition: (other: Node) =>
        other === (settingsPopup as unknown as Node) ? DOCUMENT_POSITION_PRECEDING : 0,
    } as unknown as Element;
    const fakeDocStacked = {
      querySelector: () => null,
      querySelectorAll: (selector: string) =>
        selector.includes("dialog-popup") ? [settingsPopup, alertPopup] : [],
    } as unknown as Document;

    // Top AlertDialog sees NO overlay above it -> backdrop click dismisses AlertDialog cleanly.
    expect(hasOpenNestedOverlay(alertPopup, fakeDocStacked)).toBe(false);
    const alertGuard = createBackdropDismissGuardState();
    recordBackdropPointerDown(
      alertGuard,
      { target: backdrop, currentTarget: backdrop, button: 0 },
      alertPopup,
      fakeDocStacked,
    );
    expect(
      shouldDismissOnBackdropClick(
        alertGuard,
        { target: backdrop, currentTarget: backdrop },
        alertPopup,
        { doc: fakeDocStacked },
      ),
    ).toBe(true);

    // Underlying Settings modal DOES see AlertDialog above it -> backdrop click must NOT close Settings.
    expect(hasOpenNestedOverlay(settingsPopup, fakeDocStacked)).toBe(true);
    const settingsGuard = createBackdropDismissGuardState();
    recordBackdropPointerDown(
      settingsGuard,
      { target: backdrop, currentTarget: backdrop, button: 0 },
      settingsPopup,
      fakeDocStacked,
    );
    expect(
      shouldDismissOnBackdropClick(
        settingsGuard,
        { target: backdrop, currentTarget: backdrop },
        settingsPopup,
        { doc: fakeDocStacked },
      ),
    ).toBe(false);
  });

  it("enforces symmetric centering, document.body portaling, and backdrop dismissal across all scoped modals", () => {
    const webSrc = path.resolve(import.meta.dirname, "../..");

    const appRouteModal = fs.readFileSync(
      path.join(webSrc, "components/AppRouteModal.tsx"),
      "utf8",
    );
    expect(appRouteModal).toContain("sm:py-(--app-modal-safe-y)");
    expect(appRouteModal).toContain("lg:py-(--app-modal-lg-y)");
    expect(appRouteModal).toContain("flex items-center justify-center");
    expect(appRouteModal).toContain("shouldDismissOnBackdropClick");
    expect(appRouteModal).toContain("container={portalContainer}");

    const uiDialog = fs.readFileSync(path.join(webSrc, "components/ui/dialog.tsx"), "utf8");
    expect(uiDialog).toContain("fixed inset-0 z-50 flex items-center justify-center");
    expect(uiDialog).toContain("document.body");
    expect(uiDialog).toContain("shouldDismissOnBackdropClick");

    const uiAlertDialog = fs.readFileSync(
      path.join(webSrc, "components/ui/alert-dialog.tsx"),
      "utf8",
    );
    expect(uiAlertDialog).toContain("fixed inset-0 z-50 flex items-center justify-center");
    expect(uiAlertDialog).toContain("[-webkit-app-region:no-drag]");
    expect(uiAlertDialog).toContain("dismissOnBackdropClick = true");
    expect(uiAlertDialog).toContain("shouldDismissOnBackdropClick");

    const providerDelete = fs.readFileSync(
      path.join(webSrc, "components/settings/ProviderDeleteDialog.tsx"),
      "utf8",
    );
    expect(providerDelete).toContain("dismissOnBackdropClick={!isDeleting}");

    const pluginTrust = fs.readFileSync(
      path.join(webSrc, "prismux/settings/plugins/PluginTrustAuditModal.tsx"),
      "utf8",
    );
    // Symmetric visual vertical centering (top 0 + pt-10 = 40px, bottom 20px + pb-5 20px = 40px)
    expect(pluginTrust).toContain("px-4 pt-10 pb-5");
    expect(pluginTrust).toContain("shouldDismissOnBackdropClick");

    const pluginRollback = fs.readFileSync(
      path.join(webSrc, "prismux/settings/plugins/PluginRollbackDialog.tsx"),
      "utf8",
    );
    expect(pluginRollback).toContain("fixed inset-0 z-[80] flex items-center justify-center");
    expect(pluginRollback).toContain("shouldDismissOnBackdropClick");
  });
});
