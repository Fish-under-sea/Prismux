import {
  DEFAULT_APPEARANCE_CONFIG,
  InlineAppearanceStudio,
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
  it("renders bottom inline appearance trigger in wallpaper mode and switches in-place without route navigation", () => {
    const store = createWallpaperStore({ includeBuiltins: true });
    const openSettingsSection = vi.fn();
    const adapter: WallpaperHostAdapter = {
      openSettingsSection,
    };

    try {
      store.setQpSearch("nebula");

      const wallpaperHtml = renderQuickPanelWithInlineStudio(store, adapter);
      expect(wallpaperHtml).toContain('data-pmx-qp-view="wallpaper"');
      expect(wallpaperHtml).toContain('data-pmx-inline-appearance-trigger="1"');
      expect(wallpaperHtml).toContain("外观与玻璃");
      expect(wallpaperHtml).toContain("壁纸引擎设置 ›");
      expect(wallpaperHtml).not.toContain('data-pmx-inline-appearance="1"');
      expect(openSettingsSection).not.toHaveBeenCalled();

      // Switch in-place into InlineAppearanceStudio (must NOT trigger route jump)
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

    // Right sidebar mounts WallpaperQuickPanel cleanly
    expect(html).toContain("data-pmx-right-sidebar");
    expect(html).toContain('data-pmx-quick-panel="1"');
    expect(html).toContain('data-pmx-inline-appearance-trigger="1"');
  });

  it("renders /settings/appearance PrismuxAppearanceIntegration with 5-zone glass configurator and no sidebar corner radius controls", () => {
    const html = renderToStaticMarkup(
      <PrismuxRuntimeProvider>
        <PrismuxAppearanceIntegration />
      </PrismuxRuntimeProvider>,
    );

    expect(html).toContain("Prismux 液态玻璃与光学主题");
    expect(html).toContain('data-glass-card="true"');
    expect(html).toContain('data-pmx-zone-item="shellFrame"');
    expect(html).toContain('data-pmx-zone-item="rightSidebar"');
    expect(html).toContain('data-pmx-zone-item="mainCanvas"');
    expect(html).toContain('data-pmx-zone-item="composer"');
    expect(html).toContain('data-pmx-zone-item="overlays"');
    expect(html).not.toContain('data-pmx-zone-item="leftSidebar"');
    expect(html).not.toContain('data-pmx-zone-item="chromeBars"');
    // Sidebar corner radius card & copy removed per #362
    expect(html).not.toContain("侧边栏圆角");
  });
});
