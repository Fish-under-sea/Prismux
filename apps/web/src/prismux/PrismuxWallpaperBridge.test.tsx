import {
  DEFAULT_APPEARANCE_CONFIG,
  InlineAppearanceStudio,
  LiquidGlassCard,
  type AppearanceConfig,
} from "@prismux/appearance";
import {
  SETTINGS_VP_FIRST,
  WallpaperQuickPanel,
  WallpaperSettingsView,
  WallpaperStage,
  closeInlineAppearanceInStore,
  createWallpaperStore,
  openInlineAppearanceInStore,
  type WallpaperHostAdapter,
  type WallpaperItem,
} from "@prismux/wallpaper";
import { GTProvider, initializeGT } from "gt-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  PanelLayoutControls,
  RightPanelMaximizeControl,
} from "../components/chat/PanelLayoutControls";
import { TooltipProvider } from "../components/ui/tooltip";
import {
  PrismuxTopbarControls,
  PrismuxWallpaperBackdrop,
  PrismuxWallpaperQuickPanel,
  buildFreshWallpaperMediaUrl,
  createEngineAwareWallpaperHost,
  resolveWallpaperLiveRuntimeUrl,
} from "./PrismuxWallpaperBridge";
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
      // Wallpaper tab keeps top current card, moves rotation into playback tab, and omits 壁纸属性 / audio
      expect(wallpaperHtml).toContain("pmx-wp-qp__current");
      expect(wallpaperHtml).not.toContain("pmx-wp-qp__rotation");
      expect(wallpaperHtml).not.toContain("壁纸属性");
      expect(wallpaperHtml).not.toContain('data-pmx-section="audio"');
      expect(wallpaperHtml).not.toContain("音量");
      expect(wallpaperHtml).not.toContain("壁纸音轨");
      expect(wallpaperHtml).not.toContain('data-pmx-inline-appearance="1"');
      expect(openSettingsSection).not.toHaveBeenCalled();

      // Playback tab keeps top current card, houses auto-rotation card + audio controls (声音 / 音量 / 壁纸音轨)
      store.setUiState("qpTab", "playback");
      const playbackHtml = renderQuickPanelWithInlineStudio(store, adapter);
      expect(playbackHtml).toContain('data-pmx-qp-view="playback"');
      expect(playbackHtml).toContain("pmx-wp-qp__current");
      expect(playbackHtml).toContain("pmx-wp-qp__rotation");
      expect(playbackHtml).toContain("自动轮播");
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
      // Top current wallpaper card stays permanently visible above tabs & InlineAppearanceStudio
      const currentIdx = inlineHtml.indexOf("pmx-wp-qp__current");
      const tabsIdx = inlineHtml.indexOf("pmx-wp-qp__tabs");
      const studioIdx = inlineHtml.indexOf('data-pmx-inline-appearance="1"');
      expect(currentIdx).toBeGreaterThan(-1);
      expect(tabsIdx).toBeGreaterThan(currentIdx);
      expect(studioIdx).toBeGreaterThan(tabsIdx);
      expect(inlineHtml).not.toContain("pmx-wp-qp__rotation");
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
    const prevToken = (globalThis as { __PRISMUX_DAEMON_TOKEN__?: unknown })
      .__PRISMUX_DAEMON_TOKEN__;
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
        client.resolveMediaUrl(
          "http://127.0.0.1:47910/v1/wallpapers/web/3650874083/index.html?token=old",
        ),
      ).toBe("http://127.0.0.1:47910/v1/wallpapers/web-t/secret-wp-token/3650874083/index.html");
      // Idempotent if already tokenized in path
      expect(
        client.resolveMediaUrl(
          "http://127.0.0.1:47910/v1/wallpapers/web-t/secret-wp-token/3650874083/index.html",
        ),
      ).toBe("http://127.0.0.1:47910/v1/wallpapers/web-t/secret-wp-token/3650874083/index.html");
      expect(client.buildMediaUrl("web", "3650874083")).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/web-t/secret-wp-token/3650874083/index.html",
      );
      // Media & preview still use query token
      expect(client.resolveMediaUrl("/v1/wallpapers/media/3839308585")).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/media/3839308585?token=secret-wp-token",
      );

      // Steam Scene live runtime routes rewrite /v1/wallpapers/scene/... -> /v1/wallpapers/scene-t/<token>/...
      expect(client.resolveMediaUrl("/v1/wallpapers/scene/2966081148/index.html")).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/scene-t/secret-wp-token/2966081148/index.html",
      );
      expect(
        client.resolveMediaUrl(
          "http://127.0.0.1:47910/v1/wallpapers/scene/2966081148/index.html?token=stale&v=2",
        ),
      ).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/scene-t/secret-wp-token/2966081148/index.html?v=2",
      );
      // Idempotent when already tokenized in path
      expect(
        client.resolveMediaUrl("/v1/wallpapers/scene-t/secret-wp-token/2966081148/index.html"),
      ).toBe("http://127.0.0.1:47910/v1/wallpapers/scene-t/secret-wp-token/2966081148/index.html");
      expect(
        client.resolveMediaUrl(
          "http://127.0.0.1:47910/v1/wallpapers/scene-t/secret-wp-token/2966081148/index.html",
        ),
      ).toBe("http://127.0.0.1:47910/v1/wallpapers/scene-t/secret-wp-token/2966081148/index.html");
      expect(client.buildMediaUrl("scene", "2966081148")).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/scene-t/secret-wp-token/2966081148/index.html",
      );
      expect(client.buildMediaUrl("scene", "2966081148", "assets/loop.mp4")).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/scene-t/secret-wp-token/2966081148/assets/loop.mp4",
      );

      // Without token, scene buildMediaUrl omits -t segment cleanly
      (globalThis as { __PRISMUX_DAEMON_TOKEN__?: unknown }).__PRISMUX_DAEMON_TOKEN__ = "";
      const tokenlessClient = new PrismuxDaemonClient();
      await tokenlessClient.getConnectionInfo(true);
      expect(tokenlessClient.buildMediaUrl("scene", "2966081148", "index.html")).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/scene/2966081148/index.html",
      );
      expect(tokenlessClient.buildMediaUrl("scene", "2966081148")).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/scene/2966081148",
      );
    } finally {
      (globalThis as { __PRISMUX_DAEMON_URL__?: unknown }).__PRISMUX_DAEMON_URL__ = prevUrl;
      (globalThis as { __PRISMUX_DAEMON_TOKEN__?: unknown }).__PRISMUX_DAEMON_TOKEN__ = prevToken;
    }
  });

  it("maps sceneLiveSupported Steam Scene wallpapers to /v1/wallpapers/scene-t/<token>/... and mounts WebWallpaperStage", async () => {
    const prevUrl = (globalThis as { __PRISMUX_DAEMON_URL__?: unknown }).__PRISMUX_DAEMON_URL__;
    const prevToken = (globalThis as { __PRISMUX_DAEMON_TOKEN__?: unknown })
      .__PRISMUX_DAEMON_TOKEN__;
    (globalThis as { __PRISMUX_DAEMON_URL__?: unknown }).__PRISMUX_DAEMON_URL__ =
      "http://127.0.0.1:47910";
    (globalThis as { __PRISMUX_DAEMON_TOKEN__?: unknown }).__PRISMUX_DAEMON_TOKEN__ =
      "scene-tok-123";
    try {
      const client = new PrismuxDaemonClient();
      await client.getConnectionInfo(true);

      const sceneWallpaper = {
        id: "steam:2966081148",
        title: "Shiroko 2K Live Scene",
        type: "scene" as const,
        source: "steam" as const,
        previewUrl: client.resolveMediaUrl("/v1/wallpapers/preview/steam%3A2966081148"),
        mediaUrl: client.resolveMediaUrl("/v1/wallpapers/scene/steam%3A2966081148/index.html"),
        filePath: null,
        width: 2560,
        height: 1440,
        orientation: "landscape" as const,
        contentRating: "everyone" as const,
        sceneLiveSupported: true,
        webLiveSupported: false,
      };

      expect(sceneWallpaper.mediaUrl).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/scene-t/scene-tok-123/steam%3A2966081148/index.html",
      );
      expect(sceneWallpaper.previewUrl).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/preview/steam%3A2966081148?token=scene-tok-123",
      );

      // resolveWallpaperLiveRuntimeUrl yields scene-t URL for live-supported Steam scene (with or without mediaUrl)
      expect(resolveWallpaperLiveRuntimeUrl(client, sceneWallpaper)).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/scene-t/scene-tok-123/steam%3A2966081148/index.html",
      );
      expect(resolveWallpaperLiveRuntimeUrl(client, { ...sceneWallpaper, mediaUrl: null })).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/scene-t/scene-tok-123/steam%3A2966081148/index.html",
      );
      // Unsupported Steam scenes still return null so SteamSceneFallback handles them cleanly
      expect(
        resolveWallpaperLiveRuntimeUrl(client, { ...sceneWallpaper, sceneLiveSupported: false }),
      ).toBeNull();

      // Mount WallpaperStage with sceneLive: true -> renders WebWallpaperStage iframe pointing at scene-t URL
      const store = createWallpaperStore({
        includeBuiltins: false,
        wallpapers: [sceneWallpaper],
        settings: {
          selectedId: sceneWallpaper.id,
          sceneLive: true,
          videoAudioEnabled: false,
          videoVolume: 0.6,
          objectFit: "contain",
        },
      });
      try {
        const liveHtml = renderToStaticMarkup(
          <WallpaperStage
            store={store}
            resolveLiveRuntimeUrl={(wp) => resolveWallpaperLiveRuntimeUrl(client, wp)}
          />,
        );
        expect(liveHtml).toContain("pmx-wp-stage__iframe");
        expect(liveHtml).toContain(
          'src="http://127.0.0.1:47910/v1/wallpapers/scene-t/scene-tok-123/steam%3A2966081148/index.html"',
        );
        expect(liveHtml).toContain("pmx-wp-stage__poster");
        expect(liveHtml).toContain("object-fit:contain");

        // Toggling sceneLive off gracefully falls back from live iframe to SteamSceneFallback
        store.setSetting("sceneLive", false);
        const fallbackHtml = renderToStaticMarkup(
          <WallpaperStage
            store={store}
            resolveLiveRuntimeUrl={(wp) => resolveWallpaperLiveRuntimeUrl(client, wp)}
          />,
        );
        expect(fallbackHtml).not.toContain("pmx-wp-stage__iframe");
      } finally {
        store.dispose();
      }

      // Hard-gate verification: when advancedEngineEnabled is false, both resolveWallpaperLiveRuntimeUrl
      // and WallpaperStage hard-block Web/Scene live runtimes (0 iframe / 0 WebWallGL canvas).
      expect(
        resolveWallpaperLiveRuntimeUrl(client, sceneWallpaper, { advancedEngineEnabled: false }),
      ).toBeNull();
      expect(
        resolveWallpaperLiveRuntimeUrl(client, sceneWallpaper, { advancedEngineEnabled: true }),
      ).toBe(
        "http://127.0.0.1:47910/v1/wallpapers/scene-t/scene-tok-123/steam%3A2966081148/index.html",
      );

      const gatedStore = createWallpaperStore({
        includeBuiltins: false,
        wallpapers: [sceneWallpaper],
        settings: {
          selectedId: sceneWallpaper.id,
          advancedEngineEnabled: false,
          sceneLive: true,
        },
      });
      try {
        const gatedHtml = renderToStaticMarkup(
          <WallpaperStage
            store={gatedStore}
            resolveLiveRuntimeUrl={(wp, s) => resolveWallpaperLiveRuntimeUrl(client, wp, s)}
          />,
        );
        expect(gatedHtml).toBe("");
      } finally {
        gatedStore.dispose();
      }

      // createEngineAwareWallpaperHost flushes advancedEngineEnabled immediately to daemon & refreshes catalog
      const savedPayloads: unknown[] = [];
      let refreshedCount = 0;
      const wrappedHost = createEngineAwareWallpaperHost(
        {
          listWallpapers: async () => ({ wallpapers: [sceneWallpaper] }),
        },
        {
          saveAppearance: async (patch) => {
            savedPayloads.push(patch);
            return {} as never;
          },
        },
        {
          refreshLibrary: async () => {
            refreshedCount += 1;
          },
        },
      );
      await wrappedHost.onAdvancedEngineToggle?.(true);
      expect(savedPayloads).toEqual([{ wallpaper: { advancedEngineEnabled: true } }]);
      expect(refreshedCount).toBe(1);

      // SSR verification of red gated card, inline guidance banner, and virtualized settings grid (> 24 items)
      const manyWallpapers: WallpaperItem[] = [
        sceneWallpaper,
        ...Array.from({ length: 60 }, (_, idx) => ({
          id: `img-${idx}`,
          title: `Static Image ${idx}`,
          type: "image" as const,
          source: "custom" as const,
          previewUrl: `http://127.0.0.1:47910/v1/wallpapers/preview/img-${idx}`,
          mediaUrl: `http://127.0.0.1:47910/v1/wallpapers/media/img-${idx}`,
          filePath: null,
          width: 1920,
          height: 1080,
          orientation: "landscape" as const,
          contentRating: "everyone" as const,
        })),
      ];
      const uiStore = createWallpaperStore({
        includeBuiltins: false,
        wallpapers: manyWallpapers,
      });
      try {
        // Attempting to select gated scene leaves selectedId null & populates gatedAttempt banner
        uiStore.selectWallpaper(sceneWallpaper.id);
        expect(uiStore.getSnapshot().settings.selectedId).toBeNull();
        expect(uiStore.getSnapshot().gatedAttempt?.wallpaper.id).toBe(sceneWallpaper.id);

        const quickHtml = renderToStaticMarkup(<WallpaperQuickPanel store={uiStore} />);
        expect(quickHtml).toContain("pmx-wp-qp__card--gated");
        expect(quickHtml).toContain('aria-disabled="true"');
        expect(quickHtml).toContain("渲染引擎未开启");
        expect(quickHtml).toContain('data-pmx-engine-gate-banner="1"');
        expect(quickHtml).toContain("开启高级渲染引擎");

        const settingsHtml = renderToStaticMarkup(<WallpaperSettingsView store={uiStore} />);
        expect(settingsHtml).toContain("pmx-wp-card--gated");
        expect(settingsHtml).toContain('aria-disabled="true"');
        expect(settingsHtml).toContain("渲染引擎未开启");
        expect(settingsHtml).toContain('data-pmx-engine-gate-banner="1"');
        expect(settingsHtml).toContain('data-pmx-grid-virtualized="1"');
        // Virtualization caps rendered cards to SETTINGS_VP_FIRST (24) instead of flooding 61 <img> sockets
        const renderedCards = (settingsHtml.match(/data-pmx-wp-id="/g) ?? []).length;
        expect(renderedCards).toBe(SETTINGS_VP_FIRST);
      } finally {
        uiStore.dispose();
      }
    } finally {
      (globalThis as { __PRISMUX_DAEMON_URL__?: unknown }).__PRISMUX_DAEMON_URL__ = prevUrl;
      (globalThis as { __PRISMUX_DAEMON_TOKEN__?: unknown }).__PRISMUX_DAEMON_TOKEN__ = prevToken;
    }
  });

  it("rebuilds fresh authenticated media URLs after daemon token/port rotation and preserves blob/data URLs", async () => {
    const prevUrl = (globalThis as { __PRISMUX_DAEMON_URL__?: unknown }).__PRISMUX_DAEMON_URL__;
    const prevToken = (globalThis as { __PRISMUX_DAEMON_TOKEN__?: unknown })
      .__PRISMUX_DAEMON_TOKEN__;
    (globalThis as { __PRISMUX_DAEMON_URL__?: unknown }).__PRISMUX_DAEMON_URL__ =
      "http://127.0.0.1:47999";
    (globalThis as { __PRISMUX_DAEMON_TOKEN__?: unknown }).__PRISMUX_DAEMON_TOKEN__ =
      "rotated-token-v2";
    try {
      const client = new PrismuxDaemonClient();
      await client.getConnectionInfo(true);

      // Video wallpaper holding an old port & old token gets rebuilt with the new port & token
      expect(
        buildFreshWallpaperMediaUrl(client, {
          id: "steam:3839308585",
          type: "video",
          source: "steam",
          mediaUrl:
            "http://127.0.0.1:47910/v1/wallpapers/media/steam%3A3839308585?token=stale-token-v1",
        }),
      ).toBe(
        "http://127.0.0.1:47999/v1/wallpapers/media/steam%3A3839308585?token=rotated-token-v2",
      );

      // Web & live Scene wallpapers rebuild fresh path-tokenized URLs
      expect(
        buildFreshWallpaperMediaUrl(client, {
          id: "steam:3650874083",
          type: "web",
          source: "steam",
          mediaUrl:
            "http://127.0.0.1:47910/v1/wallpapers/web-t/stale-token-v1/steam%3A3650874083/index.html",
        }),
      ).toBe(
        "http://127.0.0.1:47999/v1/wallpapers/web-t/rotated-token-v2/steam%3A3650874083/index.html",
      );
      expect(
        buildFreshWallpaperMediaUrl(client, {
          id: "steam:2966081148",
          type: "scene",
          source: "steam",
          sceneLiveSupported: true,
          mediaUrl:
            "http://127.0.0.1:47910/v1/wallpapers/scene-t/stale-token-v1/steam%3A2966081148/index.html",
        }),
      ).toBe(
        "http://127.0.0.1:47999/v1/wallpapers/scene-t/rotated-token-v2/steam%3A2966081148/index.html",
      );

      // Offline blob:/data: URLs stay untouched
      expect(
        buildFreshWallpaperMediaUrl(client, {
          id: "local-1",
          type: "video",
          source: "custom",
          mediaUrl: "blob:http://localhost/local-clip",
        }),
      ).toBe("blob:http://localhost/local-clip");
      expect(
        buildFreshWallpaperMediaUrl(client, {
          id: "local-2",
          type: "image",
          source: "custom",
          mediaUrl: "data:image/png;base64,AAAA",
        }),
      ).toBe("data:image/png;base64,AAAA");

      // SSR sanity check: PrismuxWallpaperBackdrop stays empty when no wallpaper is selected
      const emptyHtml = renderToStaticMarkup(
        <PrismuxRuntimeProvider>
          <PrismuxWallpaperBackdrop />
        </PrismuxRuntimeProvider>,
      );
      expect(emptyHtml).toBe("");
    } finally {
      (globalThis as { __PRISMUX_DAEMON_URL__?: unknown }).__PRISMUX_DAEMON_URL__ = prevUrl;
      (globalThis as { __PRISMUX_DAEMON_TOKEN__?: unknown }).__PRISMUX_DAEMON_TOKEN__ = prevToken;
    }
  });
});
