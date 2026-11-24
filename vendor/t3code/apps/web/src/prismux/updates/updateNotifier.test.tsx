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
import { parseUpdaterStatusPayload } from "../settings/prismuxUpdates.logic";

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
    expect(updatesSettingsSource).not.toContain("whitespace-pre-wrap");
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
