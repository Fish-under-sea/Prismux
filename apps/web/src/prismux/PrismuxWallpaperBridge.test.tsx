import {
  DEFAULT_APPEARANCE_CONFIG,
  InlineAppearanceStudio,
  LiquidGlassCard,
  type AppearanceConfig,
} from "@prismux/appearance";
import {
  WallpaperQuickPanel,
  closeInlineAppearanceInStore,
  createWallpaperStore,
  openInlineAppearanceInStore,
  type WallpaperHostAdapter,
} from "@prismux/wallpaper";
import { GTProvider, initializeGT } from "gt-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  PanelLayoutControls,
  RightPanelMaximizeControl,
} from "../components/chat/PanelLayoutControls";
import { TooltipProvider } from "../components/ui/tooltip";
import { PrismuxWallpaperQuickPanel, PrismuxTopbarControls } from "./PrismuxWallpaperBridge";
import { PrismuxDaemonClient } from "./daemonClient";
import { PrismuxRuntimeProvider } from "./PrismuxRuntimeProvider";
import { PrismuxAppearanceIntegration } from "./settings/PrismuxAppearanceIntegration";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
}));

function renderQuickPanelWithInlineStudio(
  store: ReturnType<typeof createWallpaperStore>,
  adapter: WallpaperHostAdapter,
  appearance: AppearanceConfig = { ...DEFAULT_APPEARANCE_CONFIG, themeMode: "glass" },
): string {
  return renderToStaticMarkup(
    <WallpaperQuickPanel
      store={store}
      adapter={adapter}
      dock="official"
      renderInlineAppearance={({ onBack }) => (
        <InlineAppearanceStudio
          config={appearance}
          onChange={() => {}}
          onBack={onBack}
          backLabel="返回壁纸"
          title="外观与玻璃"
        />
      )}
    />,
  );
}

describe("PrismuxWallpaperBridge — In-place InlineAppearanceStudio & Topbar Chief Pill", () => {
  it("renders top 3-tab appearance switch in wallpaper mode, removes duplicate footer/props/audio controls, and switches in-place without route navigation", () => {
    const store = createWallpaperStore({
      includeBuiltins: false,
      wallpapers: [
        {
          id: "steam:1001",
          title: "Real Workshop Scene",
          type: "scene",
          source: "steam",
          previewUrl: null,
          mediaUrl: null,
          filePath: null,
          width: 1920,
          height: 1080,
          orientation: "landscape",
          contentRating: "everyone",
          userProperties: [
            {
              name: "speed",
              ptype: "slider",
              text: "速度",
              order: 1,
              value: 1,
              defaultValue: 1,
              overridden: false,
            },
          ],
        },
      ],
      settings: {
        selectedId: "steam:1001",
      },
    });
    const openSettingsSection = vi.fn();
    const adapter: WallpaperHostAdapter = {
      openSettingsSection,
    };

    try {
      store.setQpSearch("nebula");

      const wallpaperHtml = renderQuickPanelWithInlineStudio(store, adapter);
      expect(wallpaperHtml).toContain('data-pmx-qp-view="wallpaper"');
      // Top 3-tab capsule contains 外观与玻璃
      expect(wallpaperHtml).toContain('data-pmx-qp-tab="wallpaper"');
      expect(wallpaperHtml).toContain('data-pmx-qp-tab="playback"');
      expect(wallpaperHtml).toContain('data-pmx-qp-tab="appearance"');
      expect(wallpaperHtml).toContain("外观与玻璃");
      // Bottom footer renders ONLY single 壁纸引擎设置 › button (no duplicate 外观与玻璃 trigger)
      expect(wallpaperHtml).not.toContain('data-pmx-inline-appearance-trigger="1"');
      expect(wallpaperHtml).not.toContain('data-pmx-open-full-appearance="1"');
      expect(wallpaperHtml).toContain('data-pmx-open-wallpaper-settings="1"');
      expect(wallpaperHtml).toContain("壁纸引擎设置 ›");
      // Wallpaper tab omits 壁纸属性 button and duplicate audio section (音量 / 壁纸音轨)
      expect(wallpaperHtml).not.toContain("壁纸属性");
      expect(wallpaperHtml).not.toContain('data-pmx-section="audio"');
      expect(wallpaperHtml).not.toContain("音量");
      expect(wallpaperHtml).not.toContain("壁纸音轨");
      expect(wallpaperHtml).not.toContain('data-pmx-inline-appearance="1"');
      expect(openSettingsSection).not.toHaveBeenCalled();

      // Playback tab retains audio controls (声音 / 音量 / 壁纸音轨) and single footer button
      store.setUiState("qpTab", "playback");
      const playbackHtml = renderQuickPanelWithInlineStudio(store, adapter);
      expect(playbackHtml).toContain('data-pmx-qp-view="playback"');
      expect(playbackHtml).toContain('data-pmx-section="audio"');
      expect(playbackHtml).toContain("音量");
      expect(playbackHtml).toContain("壁纸音轨");
      expect(playbackHtml).not.toContain('data-pmx-inline-appearance-trigger="1"');
      expect(playbackHtml).not.toContain("壁纸属性");

      // Switch in-place into InlineAppearanceStudio (must NOT trigger route jump)
      store.setUiState("qpTab", "wallpaper");
      openInlineAppearanceInStore(store);
      expect(openSettingsSection).not.toHaveBeenCalled();

      const inlineHtml = renderQuickPanelWithInlineStudio(store, adapter);
      expect(inlineHtml).toContain('data-pmx-qp-view="appearance"');
      expect(inlineHtml).toContain('data-pmx-inline-appearance="1"');
      expect(inlineHtml).toContain('data-pmx-inline-appearance-studio="1"');
      expect(inlineHtml).toContain('data-pmx-inline-back="1"');
      expect(inlineHtml).toContain("返回壁纸");
      expect(inlineHtml).toContain('data-dtp-stop="glass"');
      // All 5 unified liquid glass zones present inside InlineAppearanceStudio (shellFrame + rightSidebar pinned)
      expect(inlineHtml).toContain('data-pmx-zone-item="shellFrame"');
      expect(inlineHtml).toContain('data-pmx-zone-item="rightSidebar"');
      expect(inlineHtml).toContain('data-pmx-zone-tab="mainCanvas"');
      expect(inlineHtml).toContain('data-pmx-zone-tab="composer"');
      expect(inlineHtml).toContain('data-pmx-zone-tab="overlays"');
      expect(inlineHtml).not.toContain('data-pmx-zone-item="leftSidebar"');
      expect(inlineHtml).not.toContain('data-pmx-zone-tab="chromeBars"');
      for (const label of ["窗口外框", "右侧功能边栏", "主画布", "输入框", "弹窗层"]) {
        expect(inlineHtml).toContain(label);
      }
      // Footer shows secondary full appearance & wallpaper settings without duplicating InlineAppearanceStudio's own footer
      expect(inlineHtml).toContain('data-pmx-open-full-appearance="1"');
      expect(inlineHtml).toContain("更多外观设置 ↗");
      expect(inlineHtml).toContain("壁纸引擎设置 ›");
      expect(inlineHtml).not.toContain('data-pmx-inline-open-settings="1"');

      // Return to wallpaper view preserving search filter
      closeInlineAppearanceInStore(store, "wallpaper");
      expect(store.getSnapshot().ui.qpTab).toBe("wallpaper");
      expect(store.getSnapshot().qpSearch).toBe("nebula");
    } finally {
      store.dispose();
    }
  });

  it("mounts unified topbar controls in strict order (壁纸 → 概览 → 下侧栏 → 右侧栏) with RGB gradient Wallpaper Sparkles and Liquid Glass toggles", () => {
    initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });
    const html = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <TooltipProvider>
          <PrismuxRuntimeProvider>
            <PrismuxTopbarControls
              overviewOpen={true}
              overviewShortcutLabel="Ctrl+Shift+B"
              onToggleOverview={() => {}}
              wallpaperOpen={true}
              wallpaperAvailable={true}
              onToggleWallpaper={() => {}}
              onOpenChiefSettings={() => {}}
            />
            <PanelLayoutControls
              showThreadPanelControl={false}
              terminalAvailable={true}
              terminalOpen={false}
              terminalShortcutLabel="Ctrl+J"
              threadPanelOpen={true}
              threadPanelPresentation="inline"
              threadPanelShortcutLabel="Ctrl+Shift+B"
              rightPanelAvailable={true}
              rightPanelOpen={true}
              rightPanelShortcutLabel="Ctrl+Shift+R"
              onToggleTerminal={() => {}}
              onToggleThreadPanel={() => {}}
              onToggleRightPanel={() => {}}
            />
            <RightPanelMaximizeControl maximized={false} onToggle={() => {}} />
            <PrismuxWallpaperQuickPanel />
          </PrismuxRuntimeProvider>
        </TooltipProvider>
      </GTProvider>,
    );

    // Topbar uses minimalist PrismuxChiefStatusPill (canonical brand name, no noisy AGENT tag)
    expect(html).toContain("data-pmx-chief-badge");
    expect(html).toContain('data-agent-brand="codex"');
    expect(html).toContain(">Codex<");
    expect(html).not.toContain(">AGENT<");
    expect(html).not.toContain(">Agent<");

    // Wallpaper Sparkles icon uses unique useId() RGB prism <linearGradient> with 6 seamless RGB stops
    expect(html).toContain('data-pmx-wallpaper-toggle="1"');
    expect(html).toContain('aria-label="壁纸快速开启"');
    expect(html).toContain('data-pmx-wallpaper-icon="1"');
    expect(html).toContain('data-pmx-rgb-gradient="1"');
    expect(html).toContain("lucide-sparkles");
    expect(html).toContain("pmx-wallpaper-rgb-sparkles");
    const gradMatch = html.match(/<linearGradient[^>]*id="(pmx-wallpaper-rgb-[^"]+)"/);
    expect(gradMatch).not.toBeNull();
    const gradId = gradMatch![1];
    expect(html).toContain(`stroke="url(#${gradId})"`);
    for (const stopColor of ["#38bdf8", "#6366f1", "#ec4899", "#f59e0b", "#22c55e"]) {
      expect(html).toContain(`stop-color="${stopColor}"`);
    }

    // Overview toggle uses crisp 20x20 rounded square + 3 left-aligned bars (3rd shorter) monochrome SVG
    expect(html).toContain('data-pmx-overview-toggle="1"');
    expect(html).toContain("data-thread-panel-toggle");
    expect(html).toContain('aria-label="概览"');
    expect(html).toContain('data-pmx-overview-icon="1"');
    expect(html).toContain('viewBox="0 0 20 20"');
    expect(html).toContain("M6.1 6.9H13.9M6.1 10H13.9M6.1 13.1H10.5");
    expect(html).not.toContain("mr-28");

    // All 4 core buttons + maximize opt into Apple Liquid Glass frosted active state (no harsh blue box)
    expect(html).toContain('data-pmx-topbar-icon-toggle="1"');
    expect(html).toContain('data-pmx-topbar-toggle-kind="wallpaper"');
    expect(html).toContain('data-pmx-topbar-toggle-kind="overview"');
    expect(html).toContain('data-pmx-topbar-toggle-kind="bottom"');
    expect(html).toContain('data-pmx-topbar-toggle-kind="right"');
    expect(html).toContain('data-pmx-topbar-toggle-kind="maximize"');

    // Only Wallpaper icon uses the RGB gradient (exactly 1 RGB gradient SVG)
    expect(html.match(/data-pmx-rgb-gradient="1"/g)).toHaveLength(1);

    // Strict left-to-right DOM order: 主秘书胶囊 → 壁纸 → 概览 → 下侧栏 → 右侧栏 → 最大化
    const idxChief = html.indexOf("data-pmx-chief-badge");
    const idxWallpaper = html.indexOf('data-pmx-wallpaper-toggle="1"');
    const idxOverview = html.indexOf('data-pmx-overview-toggle="1"');
    const idxBottom = html.indexOf('data-bottom-panel-toggle=""');
    const idxRight = html.indexOf("data-right-panel-toggle");
    const idxMax = html.indexOf('data-right-panel-maximize-toggle=""');
    expect(idxChief).toBeGreaterThan(-1);
    expect(idxWallpaper).toBeGreaterThan(idxChief);
    expect(idxOverview).toBeGreaterThan(idxWallpaper);
    expect(idxBottom).toBeGreaterThan(idxOverview);
    expect(idxRight).toBeGreaterThan(idxBottom);
    expect(idxMax).toBeGreaterThan(idxRight);

    // Right sidebar mounts WallpaperQuickPanel cleanly with top 3-tab capsule, no duplicate footer/props/audio, and 0 synthetic builtin scenes
    expect(html).toContain("data-pmx-right-sidebar");
    expect(html).toContain('data-pmx-quick-panel="1"');
    expect(html).toContain('data-pmx-qp-tab="appearance"');
    expect(html).not.toContain('data-pmx-inline-appearance-trigger="1"');
    expect(html).not.toContain("壁纸属性");
    expect(html).not.toContain("壁纸音轨");
    expect(html).not.toContain("Aurora Prism");
    expect(html).not.toContain("极光棱镜");
  });

  it("renders /settings/appearance PrismuxAppearanceIntegration 3-tab hub and 8-zone LiquidGlassCard configurator", () => {
    initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });
    const html = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <PrismuxRuntimeProvider>
          <PrismuxAppearanceIntegration />
        </PrismuxRuntimeProvider>
      </GTProvider>,
    );

    expect(html).toContain('data-slot="settings-segmented-tabs"');
    expect(html).toContain('data-tab-id="theme"');
    expect(html).toContain('data-tab-id="glass"');
    expect(html).toContain('data-tab-id="typography"');
    expect(html).toContain('data-pmx-snapshot-actions="1"');
    expect(html).toContain("主题与背景");
    expect(html).toContain('data-pmx-theme-palette-card="true"');

    const glassHtml = renderToStaticMarkup(
      <LiquidGlassCard
        config={{ ...DEFAULT_APPEARANCE_CONFIG, themeMode: "glass" }}
        onChange={() => {}}
        activeSlot={null}
        onOpenColorPicker={() => {}}
        alwaysShow
        showAccentRow={false}
      />,
    );
    expect(glassHtml).toContain('data-glass-card="true"');
    for (const zone of [
      "shellFrame",
      "rightSidebar",
      "mainCanvas",
      "workPanels",
      "composer",
      "overlays",
      "userBubble",
      "overviewPanel",
    ]) {
      expect(glassHtml).toContain(`data-pmx-zone-item="${zone}"`);
    }
    expect(glassHtml).not.toContain('data-pmx-zone-item="leftSidebar"');
    expect(glassHtml).not.toContain('data-pmx-zone-item="chromeBars"');
  });

  it("rewrites web wallpaper URLs to zero-cookie URL-path token route /v1/wallpapers/web-t/<token>/<id>/...", async () => {
    const prevUrl = (globalThis as { __PRISMUX_DAEMON_URL__?: unknown }).__PRISMUX_DAEMON_URL__;
    const prevToken = (globalThis as { __PRISMUX_DAEMON_TOKEN__?: unknown }).__PRISMUX_DAEMON_TOKEN__;
    (globalThis as { __PRISMUX_DAEMON_URL__?: unknown }).__PRISMUX_DAEMON_URL__ =
      "http://127.0.0.1:47910";
    (globalThis as { __PRISMUX_DAEMON_TOKEN__?: unknown }).__PRISMUX_DAEMON_TOKEN__ =
      "secret-wp-token";
    try {
      const client = new PrismuxDaemonClient();
      await client.getConnectionInfo(true);

      expect(client.resolveMediaUrl("/v1/wallpapers/web/3650874083/index.html")).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/web-t/secret-wp-token/3650874083/index.html",
      );
      expect(
        client.resolveMediaUrl("http://127.0.0.1:47910/v1/wallpapers/web/3650874083/index.html?token=old"),
      ).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/web-t/secret-wp-token/3650874083/index.html",
      );
      // Idempotent if already tokenized in path
      expect(
        client.resolveMediaUrl(
          "http://127.0.0.1:47910/v1/wallpapers/web-t/secret-wp-token/3650874083/index.html",
        ),
      ).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/web-t/secret-wp-token/3650874083/index.html",
      );
      expect(client.buildMediaUrl("web", "3650874083")).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/web-t/secret-wp-token/3650874083/index.html",
      );
      // Media & preview still use query token
      expect(client.resolveMediaUrl("/v1/wallpapers/media/3839308585")).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/media/3839308585?token=secret-wp-token",
      );
    } finally {
      (globalThis as { __PRISMUX_DAEMON_URL__?: unknown }).__PRISMUX_DAEMON_URL__ = prevUrl;
      (globalThis as { __PRISMUX_DAEMON_TOKEN__?: unknown }).__PRISMUX_DAEMON_TOKEN__ = prevToken;
    }
  });
});
