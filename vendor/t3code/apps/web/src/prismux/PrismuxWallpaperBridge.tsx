import { InlineAppearanceStudio } from "@prismux/appearance";
import {
  WallpaperQuickPanel,
  WallpaperStage,
  useWallpaperStore,
  type InlineAppearanceRenderContext,
  type WallpaperItem,
} from "@prismux/wallpaper";
import { Image as ImageIcon, Sparkles } from "lucide-react";
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

export interface PrismuxTopbarControlsProps {
  /** Overview (`ThreadDetailsPanel`) toggle state when rendered in the unified single topbar. */
  readonly overviewOpen?: boolean;
  readonly overviewPresentation?: ThreadPanelPresentation;
  readonly overviewPopoverHandle?: ReturnType<typeof PopoverCreateHandle>;
  readonly overviewShortcutLabel?: string | null;
  readonly onToggleOverview?: () => void;
  /** Legacy wallpaper toggle props retained for backward compatibility when `onToggleOverview` is omitted. */
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
 * - AGY + Codex Overview panel (`ThreadDetailsPanel`) toggle button (`✨`, compatible with `Ctrl+Shift+B`)
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
      className={cn(
        "size-6.5 shrink-0 [-webkit-app-region:no-drag]",
        isGlassActive && !overviewOpen && "text-primary",
      )}
      pressed={overviewOpen}
      onPressedChange={overviewPresentation === "popover" ? undefined : onToggleOverview}
      aria-label="切换概览"
      data-pmx-overview-toggle="1"
      variant="ghost"
      size="sm"
    >
      <Sparkles className="size-3.5" />
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
            {overviewShortcutLabel ? `切换概览 (${overviewShortcutLabel})` : "切换概览"}
          </TooltipPopup>
        </Tooltip>
      ) : onToggleWallpaper ? (
        <Tooltip>
          <TooltipTrigger render={<span className="flex shrink-0" />}>
            <Toggle
              className={cn(
                "size-6.5 shrink-0 [-webkit-app-region:no-drag]",
                isGlassActive && !wallpaperOpen && "text-primary",
              )}
              pressed={wallpaperOpen}
              onPressedChange={onToggleWallpaper}
              aria-label="切换壁纸与液态玻璃边栏"
              data-pmx-wallpaper-toggle=""
              variant="ghost"
              size="sm"
              disabled={!wallpaperAvailable}
            >
              {isGlassActive ? (
                <Sparkles className="size-3.5" />
              ) : (
                <ImageIcon className="size-3.5" />
              )}
            </Toggle>
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            {wallpaperAvailable ? "壁纸与液态玻璃边栏" : "打开会话后可使用壁纸边栏"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
});
