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
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

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

  it("mounts PrismuxWallpaperQuickPanel and unified single-topbar PrismuxTopbarControls (Chief Pill + Overview toggle)", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <PrismuxRuntimeProvider>
          <PrismuxTopbarControls
            overviewOpen={true}
            overviewShortcutLabel="Ctrl+Shift+B"
            onToggleOverview={() => {}}
            onOpenChiefSettings={() => {}}
          />
          <PrismuxWallpaperQuickPanel />
        </PrismuxRuntimeProvider>
      </TooltipProvider>,
    );

    // Topbar uses minimalist PrismuxChiefStatusPill (canonical brand name, no noisy AGENT tag)
    expect(html).toContain("data-pmx-chief-badge");
    expect(html).toContain('data-agent-brand="codex"');
    expect(html).toContain(">Codex<");
    expect(html).not.toContain(">AGENT<");
    expect(html).not.toContain(">Agent<");

    // Overview toggle button lives cleanly beside Chief Pill without brittle mr-28 spacer
    expect(html).toContain('data-pmx-overview-toggle="1"');
    expect(html).toContain("data-thread-panel-toggle");
    expect(html).toContain('aria-label="切换概览"');
    expect(html).not.toContain("mr-28");

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
