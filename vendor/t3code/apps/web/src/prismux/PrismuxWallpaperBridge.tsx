import { InlineAppearanceStudio } from "@prismux/appearance";
import {
  WallpaperQuickPanel,
  WallpaperStage,
  useWallpaperStore,
  type InlineAppearanceRenderContext,
  type WallpaperItem,
} from "@prismux/wallpaper";
import { Sparkles } from "lucide-react";
import { memo, useCallback } from "react";

import { PopoverCreateHandle, PopoverTrigger } from "../components/ui/popover";
import { Toggle } from "../components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import type { ThreadPanelPresentation } from "../rightPanelLayout";
import { PrismuxChiefStatusPill } from "./PrismuxChiefStatusPill";
import { usePrismuxRuntime } from "./PrismuxRuntimeProvider";

/**
 * Z-0 Fullscreen Wallpaper Stage (0 Token visual layer).
 * Mounts behind the T3 Code shell, obeys window occlusion / visibility for 0 FPS suspension,
 * and resolves authenticated Daemon URLs for Steam/local web runtimes.
 */
export const PrismuxWallpaperBackdrop = memo(function PrismuxWallpaperBackdrop() {
  const { daemon, wallpaperStore, occluded } = usePrismuxRuntime();
  const snapshot = useWallpaperStore(wallpaperStore);

  const resolveLiveRuntimeUrl = useCallback(
    (wallpaper: WallpaperItem): string | null => {
      if (wallpaper.type !== "web") {
        return null;
      }
      if (wallpaper.mediaUrl) {
        return daemon.resolveMediaUrl(wallpaper.mediaUrl);
      }
      return daemon.buildMediaUrl("web", wallpaper.id);
    },
    [daemon],
  );

  if (!snapshot.settings.selectedId) {
    return null;
  }

  return (
    <div
      data-pmx-wallpaper-backdrop="1"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <WallpaperStage
        store={wallpaperStore}
        occluded={occluded}
        resolveLiveRuntimeUrl={resolveLiveRuntimeUrl}
      />
    </div>
  );
});

/**
 * Native right-panel `"wallpaper"` surface mounting @prismux/wallpaper's 3-tab QuickPanel
 * (壁纸 / 播放 / 外观与玻璃). Clicking bottom `外观与玻璃` switches in-place to
 * `InlineAppearanceStudio` (zero route navigation) for live 6-zone glass tuning against Z-0.
 */
export const PrismuxWallpaperQuickPanel = memo(function PrismuxWallpaperQuickPanel() {
  const { appearance, setAppearance, setThemeMode, wallpaperStore, wallpaperHost } =
    usePrismuxRuntime();

  const renderInlineAppearance = useCallback(
    ({ onBack }: InlineAppearanceRenderContext) => (
      <InlineAppearanceStudio
        config={appearance}
        onChange={setAppearance}
        onThemeModeChange={setThemeMode}
        onBack={onBack}
        backLabel="返回壁纸"
        title="外观与玻璃"
      />
    ),
    [appearance, setAppearance, setThemeMode],
  );

  return (
    <div
      data-pmx-right-sidebar=""
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
    >
      <WallpaperQuickPanel
        store={wallpaperStore}
        adapter={wallpaperHost}
        renderInlineAppearance={renderInlineAppearance}
        dock="official"
        className="min-h-0 flex-1"
      />
    </div>
  );
});

/**
 * 1:1 Overview panel icon (rounded square frame + 3 left-aligned rounded horizontal bars,
 * with the 3rd bar shorter). Hand-crafted `viewBox="0 0 20 20"` for pixel-crisp rendering.
 */
export function OverviewPanelIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-pmx-overview-icon="1"
      className={className}
    >
      <rect
        x="2.75"
        y="2.75"
        width="14.5"
        height="14.5"
        rx="2.6"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M6.1 6.9H13.9M6.1 10H13.9M6.1 13.1H10.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface PrismuxTopbarControlsProps {
  /** Overview (`ThreadDetailsPanel`) toggle state when rendered in the unified single topbar. */
  readonly overviewOpen?: boolean;
  readonly overviewPresentation?: ThreadPanelPresentation;
  readonly overviewPopoverHandle?: ReturnType<typeof PopoverCreateHandle>;
  readonly overviewShortcutLabel?: string | null;
  readonly onToggleOverview?: () => void;
  /** Independent right-sidebar wallpaper quick-toggle button (Sparkles icon) beside Overview. */
  readonly wallpaperOpen?: boolean;
  readonly wallpaperAvailable?: boolean;
  readonly inlineRightPanelOwnsTitleBar?: boolean;
  readonly onToggleWallpaper?: () => void;
  readonly onOpenChiefSettings: () => void;
  readonly className?: string;
}

/**
 * Unified single-topbar Prismux controls:
 * - Minimalist Chief Thread Slot breathing brand pill (`<PrismuxChiefStatusPill />`)
 * - AGY + Codex Overview panel (`ThreadDetailsPanel`) toggle button (rounded list-box SVG, `Ctrl+Shift+B`)
 * - Independent Wallpaper Quick Sidebar toggle button (`Sparkles` 4-point star icon)
 * Strictly marks interactive controls `[-webkit-app-region:no-drag]` and uses clean flow layout
 * (zero brittle `mr-28` hacks) so it sits flush alongside right-panel toggles & Electron WCO buttons.
 */
export const PrismuxTopbarControls = memo(function PrismuxTopbarControls({
  overviewOpen = false,
  overviewPresentation = "inline",
  overviewPopoverHandle,
  overviewShortcutLabel,
  onToggleOverview,
  wallpaperOpen = false,
  wallpaperAvailable = true,
  onToggleWallpaper,
  onOpenChiefSettings,
  className,
}: PrismuxTopbarControlsProps) {
  const { appearance } = usePrismuxRuntime();
  const isGlassActive = appearance.themeMode === "glass" && appearance.glassPreset !== "off";
  const usesOverviewMode = onToggleOverview !== undefined || overviewPopoverHandle !== undefined;

  const overviewToggleButton = (
    <Toggle
      className="size-6.5 shrink-0 [-webkit-app-region:no-drag]"
      pressed={overviewOpen}
      onPressedChange={overviewPresentation === "popover" ? undefined : onToggleOverview}
      aria-label="概览"
      data-pmx-overview-toggle="1"
      variant="ghost"
      size="sm"
    >
      <OverviewPanelIcon className="size-4" />
    </Toggle>
  );

  return (
    <div
      data-pmx-topbar-controls=""
      className={cn("flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]", className)}
    >
      <PrismuxChiefStatusPill
        onClick={onOpenChiefSettings}
        isGlassActive={isGlassActive}
        className="h-6.5 px-2 text-[11px]"
      />

      {usesOverviewMode ? (
        <Tooltip>
          <TooltipTrigger render={<span className="flex shrink-0" data-thread-panel-toggle="" />}>
            {overviewPresentation === "popover" && overviewPopoverHandle ? (
              <PopoverTrigger handle={overviewPopoverHandle} render={overviewToggleButton} />
            ) : (
              overviewToggleButton
            )}
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            {overviewShortcutLabel ? `概览 (${overviewShortcutLabel})` : "概览"}
          </TooltipPopup>
        </Tooltip>
      ) : null}

      {onToggleWallpaper ? (
        <Tooltip>
          <TooltipTrigger render={<span className="flex shrink-0" />}>
            <Toggle
              className={cn(
                "size-6.5 shrink-0 [-webkit-app-region:no-drag]",
                isGlassActive && !wallpaperOpen && "text-primary",
              )}
              pressed={wallpaperOpen}
              onPressedChange={onToggleWallpaper}
              aria-label="壁纸快速开启"
              data-pmx-wallpaper-toggle="1"
              variant="ghost"
              size="sm"
              disabled={!wallpaperAvailable}
            >
              <Sparkles className="size-3.5" data-pmx-wallpaper-icon="1" aria-hidden />
            </Toggle>
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            {wallpaperAvailable ? "壁纸快速开启" : "打开会话后可使用壁纸边栏"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
});
