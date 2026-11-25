// @effect-diagnostics-next-line nodeBuiltinImport:off
import fs from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  ALLOWED_UPDATE_CHANNELS,
  applyUpdaterSseEvent,
  buildUpdaterStageSteps,
  describeUpdaterProgressStage,
  extractReleaseNotesHighlights,
  formatProgressPercentDisplay,
  formatUpdaterStageWeightHint,
  normalizeUpdateChannel,
  parseUpdaterStatusPayload,
  resolveProgressBarPercent,
  resolveRuntimeVersion,
  selectRecommendedUpdateAsset,
} from "./prismuxUpdates.logic";

describe("prismuxUpdates.logic", () => {
  it("never falls back to hardcoded 0.1.0-alpha.1 when runtime version is missing", () => {
    expect(resolveRuntimeVersion("0.1.1-alpha.1", "0.1.0")).toBe("0.1.1-alpha.1");
    expect(resolveRuntimeVersion("", "0.1.1-alpha.1")).toBe("0.1.1-alpha.1");
    expect(resolveRuntimeVersion("0.0.0", "0.0.0")).toBe("");
    expect(resolveRuntimeVersion(null, undefined)).toBe("");
  });

  it("converges channels strictly to stable and prerelease with zero nightly option", () => {
    expect(ALLOWED_UPDATE_CHANNELS).toEqual(["stable", "prerelease"]);
    expect(ALLOWED_UPDATE_CHANNELS).not.toContain("nightly");
    expect(normalizeUpdateChannel("stable")).toBe("stable");
    expect(normalizeUpdateChannel("prerelease")).toBe("prerelease");
    expect(normalizeUpdateChannel("nightly")).toBe("prerelease");
    expect(normalizeUpdateChannel(undefined, false)).toBe("stable");
    expect(normalizeUpdateChannel(undefined, true)).toBe("prerelease");
  });

  it("tracks Gitee 3-part split-7z download, extraction, SHA-256 verification, and ready state via SSE", () => {
    const initial = parseUpdaterStatusPayload(
      {
        currentVersion: "0.1.1-alpha.1",
        portableMode: false,
        policy: { channel: "prerelease", routePreference: "auto" },
        checking: false,
        downloading: false,
        installState: "available",
      },
      "0.1.1-alpha.1",
    );
    expect(initial).not.toBeNull();

    const part2 = applyUpdaterSseEvent(initial, {
      event: "progress",
      data: {
        installState: "downloading",
        progress: {
          stage: "downloading",
          percent: 62,
          bytesDownloaded: 62_000_000,
          totalBytes: 100_000_000,
          currentPart: 2,
          totalParts: 3,
          partName: "Prismux-Setup.7z.002",
        },
      },
      rawData: "",
      receivedAt: Date.now(),
    });
    expect(part2?.downloading).toBe(true);
    expect(describeUpdaterProgressStage(part2?.progress ?? null)).toContain("2/3");
    expect(describeUpdaterProgressStage(part2?.progress ?? null)).toContain("Prismux-Setup.7z.002");

    const extracting = applyUpdaterSseEvent(part2, {
      event: "extracting",
      data: {
        installState: "extracting",
        progress: { stage: "extracting", percent: 90 },
      },
      rawData: "",
      receivedAt: Date.now(),
    });
    expect(describeUpdaterProgressStage(extracting?.progress ?? null)).toContain("解压合并");

    const ready = applyUpdaterSseEvent(extracting, {
      event: "ready",
      data: {
        installState: "ready",
        downloadedFilePath: "C:\\Users\\Fish\\.prismux\\updates\\Prismux-Setup-0.1.2.exe",
        downloadedSha256: "a".repeat(64),
        progress: { stage: "ready", percent: 100 },
      },
      rawData: "",
      receivedAt: Date.now(),
    });
    expect(ready?.downloading).toBe(false);
    expect(ready?.installState).toBe("ready");
    expect(ready?.downloadedFilePath).toContain("Prismux-Setup-0.1.2.exe");
    expect(ready?.downloadedSha256).toBe("a".repeat(64));
  });

  it("selects portable-zip in portable mode and setup-exe/split-7z in installer mode", () => {
    const assets = [
      {
        name: "Prismux-Portable.zip",
        kind: "portable-zip",
        effectiveUrl: "https://github.com/Fish-under-sea/Prismux/releases/download/v0.1.2/Prismux-Portable.zip",
        sizeBytes: 120_000_000,
        sha256: "b".repeat(64),
        expectedExeName: null,
        parts: [],
        source: "github" as const,
      },
      {
        name: "Prismux-Setup.7z",
        kind: "split-7z-exe",
        effectiveUrl: "https://gitee.com/Fish-under-sea/Prismux/releases/download/v0.1.2/Prismux-Setup.7z.001",
        sizeBytes: 110_000_000,
        sha256: "c".repeat(64),
        expectedExeName: "Prismux-Setup.exe",
        parts: [],
        source: "gitee" as const,
      },
    ];
    expect(selectRecommendedUpdateAsset(assets, true)?.kind).toBe("portable-zip");
    expect(selectRecommendedUpdateAsset(assets, false)?.kind).toBe("split-7z-exe");
  });

  it("parses autoCheckEnabled policy flag with default true and explicit false override", () => {
    const defaultStatus = parseUpdaterStatusPayload(
      {
        currentVersion: "0.1.2",
        policy: { channel: "prerelease", routePreference: "auto" },
      },
      "0.1.2",
    );
    expect(defaultStatus?.policy.autoCheckEnabled).toBe(true);

    const disabledStatus = parseUpdaterStatusPayload(
      {
        currentVersion: "0.1.2",
        policy: { channel: "stable", routePreference: "domestic", autoCheckEnabled: false },
      },
      "0.1.2",
    );
    expect(disabledStatus?.policy.autoCheckEnabled).toBe(false);
  });

  it("removes hardcoded 0.1.0-alpha.1 fallback, nightly channel, and legacy 公测版/内测版 copy from PrismuxUpdatesSettingsPage", () => {
    const pagePath = path.resolve(import.meta.dirname, "PrismuxUpdatesSettingsPage.tsx");
    const source = fs.readFileSync(pagePath, "utf8");
    expect(source).not.toContain("0.1.0-alpha.1");
    expect(source.toLowerCase()).not.toContain('"nightly"');
    expect(source).not.toContain("公测版");
    expect(source).not.toContain("内测版");
    expect(source).toContain("Preview");
    expect(source).toContain("prismux-auto-check-updates-switch");
    expect(source).toContain("自动检查更新");
    expect(source).toContain("installDownloadedUpdate");
  });

  it("computes weighted progress display, stage steps, and weight hints across 0->30->60->90->95->99.9->100%", () => {
    // Handshake with null percent -> strictly null (indeterminate shimmer), never hardcoded 14%/15%.
    expect(
      resolveProgressBarPercent({
        stage: "downloading",
        percent: null,
        bytesDownloaded: 0,
        totalBytes: null,
        currentPart: 1,
        totalParts: 3,
        partName: "Prismux-Setup.exe.7z.001",
        message: null,
        updatedAt: 1000,
      }),
    ).toBeNull();
    expect(formatProgressPercentDisplay(null)).toBeNull();

    // Split part 2/3 mid-download at 42.6%
    const part2Progress = {
      stage: "downloading" as const,
      percent: 42.6,
      bytesDownloaded: 90_000_000,
      totalBytes: 218_000_000,
      currentPart: 2,
      totalParts: 3,
      partName: "Prismux-Setup.exe.7z.002",
      message: null,
      updatedAt: 2000,
    };
    expect(resolveProgressBarPercent(part2Progress)).toBe(42.6);
    expect(formatProgressPercentDisplay(42.6)).toBe("43%");
    const splitHint = formatUpdaterStageWeightHint(part2Progress, true);
    expect(splitHint).toContain("0–90%");
    expect(splitHint).toContain("30%");
    expect(splitHint).toContain("90–95%");
    expect(splitHint).toContain("95–100%");

    const downloadingSteps = buildUpdaterStageSteps(part2Progress, false, true);
    expect(downloadingSteps.map((s) => `${s.id}:${s.state}`)).toEqual([
      "downloading:active",
      "extracting:pending",
      "verifying:pending",
      "ready:pending",
    ]);

    // Extracting 90->95%
    const extractingSteps = buildUpdaterStageSteps(
      { ...part2Progress, stage: "extracting", percent: 92 },
      false,
      true,
    );
    expect(extractingSteps.map((s) => `${s.id}:${s.state}`)).toEqual([
      "downloading:completed",
      "extracting:active",
      "verifying:pending",
      "ready:pending",
    ]);

    // Verifying 99.9% displays "99%" (never prematurely 100% before ready)
    expect(formatProgressPercentDisplay(99.9)).toBe("99%");
    const verifyingSteps = buildUpdaterStageSteps(
      { ...part2Progress, stage: "verifying", percent: 99.9 },
      false,
      true,
    );
    expect(verifyingSteps.map((s) => `${s.id}:${s.state}`)).toEqual([
      "downloading:completed",
      "extracting:completed",
      "verifying:active",
      "ready:pending",
    ]);

    // Ready hits 100% with all stages completed
    expect(formatProgressPercentDisplay(100)).toBe("100%");
    const readySteps = buildUpdaterStageSteps(
      { ...part2Progress, stage: "ready", percent: 100 },
      true,
      true,
    );
    expect(readySteps.map((s) => `${s.id}:${s.state}`)).toEqual([
      "downloading:completed",
      "extracting:completed",
      "verifying:completed",
      "ready:completed",
    ]);
  });

  it("enforces zero hardcoded 14%/15% fake widths, infinite SSE reconnect, polling fallback, and glass contrast across updater UI files", () => {
    const prismuxDir = path.resolve(import.meta.dirname, "..");
    const settingsSrc = fs.readFileSync(
      path.join(prismuxDir, "settings/PrismuxUpdatesSettingsPage.tsx"),
      "utf8",
    );
    const modalSrc = fs.readFileSync(
      path.join(prismuxDir, "updates/PrismuxUpdateReleaseModal.tsx"),
      "utf8",
    );
    const hostSrc = fs.readFileSync(
      path.join(prismuxDir, "updates/PrismuxAutoUpdateHost.tsx"),
      "utf8",
    );
    const capsuleSrc = fs.readFileSync(
      path.join(prismuxDir, "updates/PrismuxSidebarUpdateCapsule.tsx"),
      "utf8",
    );

    // Zero hardcoded 14% / 15% fake widths anywhere
    expect(modalSrc).not.toMatch(/\?\?\s*14\b/);
    expect(settingsSrc).not.toMatch(/\?\?\s*15\b/);
    expect(modalSrc).not.toContain("width: 14%");
    expect(settingsSrc).not.toContain("width: 15%");

    // Infinite reconnect (no maxReconnectAttempts option cap) + 500ms fallback poller
    expect(hostSrc).not.toMatch(/maxReconnectAttempts\s*:/);
    expect(settingsSrc).not.toMatch(/maxReconnectAttempts\s*:/);
    expect(hostSrc).toContain("startUpdaterStatusFallbackPoller");
    expect(settingsSrc).toContain("startUpdaterStatusFallbackPoller");

    // Settings page shares speed & store state
    expect(settingsSrc).toContain("formatTransferSpeed");
    expect(settingsSrc).toContain("prismuxUpdateNotifierStore");

    // Glass contrast guardrail: zero bg-background/45..85 across updated UI files
    for (const [label, src] of [
      ["PrismuxUpdatesSettingsPage", settingsSrc],
      ["PrismuxUpdateReleaseModal", modalSrc],
      ["PrismuxSidebarUpdateCapsule", capsuleSrc],
    ] as const) {
      expect(src, `${label} must not use washed-out bg-background/45..85`).not.toMatch(
        /\bbg-background\/(?:45|50|55|60|70|75|80|85)\b/,
      );
    }
  });

  it("extracts full structured highlights from real v0.1.3-preview.1 (before download guide) and v0.1.2-preview.4 (after download guide) while stripping boilerplate", () => {
    const realV013GiteeNotes = [
      "# Prismux v0.1.3 Preview 1",
      "",
      "> 标准 SemVer / Tag：`v0.1.3-preview.1`（`0.1.3-preview.1`）。本次为大版本视觉与交互升级，**官方两大活跃插件（`qq` / `fishdock-hook`）严格保持默认零预装**（原 `pet` / `ssh` 已停用：已被 Prismux 内置功能取代），桌面安装包内不包含任何官方插件。",
      "",
      "## ✨ 本次核心升级亮点（v0.1.3 Preview 1）",
      "",
      "### 1. 1:1 还原 AGY 蜂群侧边栏 & 多 Agent 原生只读协作视图",
      "- **AGY 蜂群 1:1 复刻**：原生只读还原 22×18 像素蜜蜂与蜂王皇冠、概览目标/进度/工作流、公告板（`@提及` / `#序号` 跳转胶囊与未读分隔线）。",
      "- **多 Agent 原生适配**：同步提供 Claude Code（`~/.claude/teams`、`inboxes`、`tasks`）与 Codex（子代理协作、`goals` / `state`）原生只读协作侧边栏。",
      "- **按需无扰唤醒**：仅在协作状态首次从休眠切入活跃时自动弹出。",
      "",
      "### 2. `/` 斜杠命令前缀图标双语汉化 & `@对话 / @工作 Agent` 提及",
      "- **清晰双语格式**：统一按「图标 中文 小号原生英文：汉化介绍」排布（如 `🐝 蜂群 swarm：...`）；**个人技能严守原名不做汉化**。",
      "- **折叠分层排序**：只输入 `/` 时原生 Agent 指令排在顶部，个人技能与自带技能归入同一可展开折叠项。",
      "- **增强 `@` 提及**：空 `@` 与中文关键词均可直接召出 `@对话`、`@工作 Agent`、`@主机` 与 `@文件`。",
      "",
      "### 3. 侧栏液态玻璃卡片、RGB 呼吸态、AGY 胶囊气泡 & Orca 详细配额",
      "- **高对比四边液态玻璃卡片**：全面补全侧栏会话卡片四边玻璃质感与对比度（`刚刚`、Agent Logo、项目名与主机名）。",
      "- **AGY 扁平大圆角胶囊气泡**：用户消息采用扁平大圆角胶囊设计。",
      "- **底部 20px 状态栏详细配额联动**：底部配额胶囊与浮窗 `详细 / 精简` 模式完全同步。",
      "",
      "### 4. 空白新会话硬单例、概览面板解耦防遮挡 & 壁纸侧栏精简",
      "- **空白新会话硬单例**：同一工作区最多仅保留 1 个未发送消息的空白草稿标签。",
      "- **概览面板独立悬浮与动态限高**：右侧「概览」与底部居中对话框彻底解耦，强制保障底部 ≥ 28px 留白。",
      "- **壁纸侧边栏精简与永久去重**：导入本地图片按文件大小 + SHA-256 永久去重，仅保留唯一副本。",
      "",
      "### 5. 宿主机时区自动语言识别、全宽无白框天体胶囊 & 升级/体检重设计",
      "- **时区自动语言切换**：首次启动默认读取宿主机 IANA 时区，直达全中文 `/welcome` 欢迎页。",
      "- **全宽无白框天体三态胶囊**：`/welcome` 天体三态胶囊拉满全宽对齐右侧边缘。",
      "- **分卷加权下载进度条 & 四级液态玻璃服务体检**：Gitee 3 段分卷下载按 `3×30% + 5% 解压 + 5% 校验 = 100%` 实时流式推送进度与 MB/s 速率。",
      "",
      "## 📦 下载指南（Windows x64 · 零预装插件）",
      "",
      "| 资产文件 | 用途说明 | SHA-256 |",
      "| :--- | :--- | :--- |",
      "| **`Prismux-Setup-0.1.3-preview.1-win-x64.exe`**（208.39 MB） | Electron 44 安装包 | `9498ae63f670e28acef5143ea3533b53d07c2bfdbfe584f5910a75475c71f8c0` |",
      "",
      "> 中国大陆用户亦可前往 **[Gitee Releases (`v0.1.3-preview.1`)](https://gitee.com/Fish-under-sea/Prismux/releases/tag/v0.1.3-preview.1)** 获取高速 80 MB 无损分卷。",
      "",
      "### Gitee 80 MB 无损分卷还原说明",
      "",
      "| 分卷文件名 | 用途 | SHA-256 |",
      "| :--- | :--- | :--- |",
      "| `Prismux-Setup-0.1.3-preview.1-win-x64.exe.7z.001`（80.00 MB） | Gitee 80 MB 无损分卷 | `e7015543916680df151af36cf83e0a9c0d82d752509ba2cb6ae2d7e2023b1f6b` |",
      "",
      "```powershell",
      "# 下载全部 .7z.001..003 至同一目录后执行无损合并（只需指定 .001）：",
      "7z x Prismux-Setup-0.1.3-preview.1-win-x64.exe.7z.001",
      "(Get-FileHash .\\Prismux-Setup-0.1.3-preview.1-win-x64.exe -Algorithm SHA256).Hash.ToLower()",
      "# 期望值: 9498ae63f670e28acef5143ea3533b53d07c2bfdbfe584f5910a75475c71f8c0",
      "```",
    ].join("\r\n");

    const extracted013 = extractReleaseNotesHighlights(`\uFEFF${realV013GiteeNotes}`);
    expect(extracted013.startsWith("## ✨ 本次核心升级亮点（v0.1.3 Preview 1）")).toBe(true);
    expect(extracted013).toContain("### 1. 1:1 还原 AGY 蜂群侧边栏 & 多 Agent 原生只读协作视图");
    expect(extracted013).toContain("### 2. `/` 斜杠命令前缀图标双语汉化 & `@对话 / @工作 Agent` 提及");
    expect(extracted013).toContain("### 3. 侧栏液态玻璃卡片、RGB 呼吸态、AGY 胶囊气泡 & Orca 详细配额");
    expect(extracted013).toContain("### 4. 空白新会话硬单例、概览面板解耦防遮挡 & 壁纸侧栏精简");
    expect(extracted013).toContain("### 5. 宿主机时区自动语言识别、全宽无白框天体胶囊 & 升级/体检重设计");
    expect(extracted013).toContain("3×30% + 5% 解压 + 5% 校验 = 100%");
    // Boilerplate strictly removed
    expect(extracted013).not.toContain("# Prismux v0.1.3 Preview 1");
    expect(extracted013).not.toContain("标准 SemVer / Tag");
    expect(extracted013).not.toContain("## 📦 下载指南");
    expect(extracted013).not.toContain("Gitee 80 MB 无损分卷");
    expect(extracted013).not.toContain("Get-FileHash");
    expect(extracted013).not.toContain("7z x ");
    expect(extracted013).not.toContain("9498ae63f670e28a");

    // v0.1.2-preview.4 format: highlights appear AFTER ## 📦 下载指南 + tables + SHA-256 block
    const realV012Preview4Notes = [
      "# Prismux v0.1.2 Preview 4",
      "",
      "> 标准 SemVer / Tag：`v0.1.2-preview.4`（`0.1.2-preview.4`）。**官方两大活跃插件（`qq` / `fishdock-hook`）严格保持默认零预装**。",
      "",
      "## 📦 下载指南：我应该下载哪个文件？",
      "",
      "### 1. 桌面主程序（Desktop App）",
      "",
      "| 平台 / 架构 | 获取方式（直接下载） | 说明 & SHA-256 |",
      "| :--- | :--- | :--- |",
      "| **Windows (x64)** | [Prismux-Setup-0.1.2-preview.4-win-x64.exe](https://github.com/Fish-under-sea/Prismux/releases/download/v0.1.2-preview.4/Prismux-Setup-0.1.2-preview.4-win-x64.exe) | 208.21 MB |",
      "",
      "### 2. 官方认证按需插件（Optional Official Plugins · 默认零预装）",
      "",
      "| 插件 ID | 独立归档包 |",
      "| :--- | :--- |",
      "| `qq` | `prismux-plugin-qq-0.1.2-preview.4.wb-plugin` |",
      "",
      "### 3. 完整性校验命令",
      "",
      "```powershell",
      "# 下载后校验安装包 SHA-256：",
      "(Get-FileHash .\\Prismux-Setup-0.1.2-preview.4-win-x64.exe -Algorithm SHA256).Hash.ToLower()",
      "# 期望值: 9a1a968e720ce97c620c7152e85f609fbc974760c99d4d17b1df5d11b9e35d9f",
      "```",
      "",
      "## ✨ Prismux v0.1.2 Preview 4 六大核心升级",
      "",
      "- **Codex Windows 双模启动修复 & `[Chat | CLI]` 三态高对比高亮**：`npmNodeShimCommand` 在 Windows 零壳直启。",
      "- **消除提供方重命名 UUID 乱码 & CLI 版本号原地一键更新**：全链路清除托管账号 `codex_<uuid>` 噪点。",
      "- **100% 官方合规 `agy -p /usage` 实时额度栏**：支持单独强刷与三态独立额度浮窗。",
      "- **NSIS 默认用户目录 + 可取消桌面快捷方式**：默认安装至 `%LOCALAPPDATA%\\Programs\\Prismux`。",
      "- **淘汰残缺新会话空态壳 & 品牌菜单重载 / 强刷 / DevTools**：收敛至全功能 `ChatView`。",
      "- **两篇源码级插件与 Hook/主题 Token 权威文档**：新增 [`docs/plugins/plugin-development-guide.md`](https://github.com/Fish-under-sea/Prismux/blob/v0.1.2-preview.4/docs/plugins/plugin-development-guide.md)。",
    ].join("\n");

    const extracted0124 = extractReleaseNotesHighlights(realV012Preview4Notes);
    expect(extracted0124.startsWith("## ✨ Prismux v0.1.2 Preview 4 六大核心升级")).toBe(true);
    expect(extracted0124).toContain("Codex Windows 双模启动修复");
    expect(extracted0124).toContain("两篇源码级插件与 Hook/主题 Token 权威文档");
    expect(extracted0124).not.toContain("## 📦 下载指南");
    expect(extracted0124).not.toContain("桌面主程序");
    expect(extracted0124).not.toContain("Get-FileHash");
    expect(extracted0124).not.toContain("标准 SemVer / Tag");

    // Unknown heading / plain body -> preserved gracefully
    const customNotes = "## Bug Fixes\n\n- Fixed **memory leak** in `ptyPool`.\n- Added retry logic.";
    expect(extractReleaseNotesHighlights(customNotes)).toBe(customNotes);

    const plainNotes = "- Improved startup speed\n- Fixed theme contrast";
    expect(extractReleaseNotesHighlights(plainNotes)).toBe(plainNotes);

    // Boilerplate-only release -> gracefully falls back to original markdown (never empty!)
    const boilerplateOnly =
      "# Prismux v0.1.2 Preview 1\n\n> 标准 SemVer / Tag: `v0.1.2-preview.1`\n\n## 📦 下载指南\n| File |\n| :--- |\n| Setup.exe |";
    expect(extractReleaseNotesHighlights(boilerplateOnly)).toBe(boilerplateOnly);

    expect(extractReleaseNotesHighlights(null)).toBe("");
    expect(extractReleaseNotesHighlights("   ")).toBe("");
  });
});
