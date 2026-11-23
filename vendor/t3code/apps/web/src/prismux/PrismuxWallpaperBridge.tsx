import {
  WallpaperQuickPanel,
  WallpaperStage,
  useWallpaperStore,
  type WallpaperItem,
} from "@prismux/wallpaper";
import { Image as ImageIcon, Sparkles } from "lucide-react";
import { memo, useCallback } from "react";

import { Toggle } from "../components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
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
 * Native right-panel `"wallpaper"` surface mounting @prismux/wallpaper's deduplicated 2-tab QuickPanel
 * (壁纸 / 播放) with direct shortcuts to /settings/appearance and /settings/wallpaper.
 */
export const PrismuxWallpaperQuickPanel = memo(function PrismuxWallpaperQuickPanel() {
  const { wallpaperStore, wallpaperHost } = usePrismuxRuntime();

  return (
    <div
      data-pmx-right-sidebar=""
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
    >
      <WallpaperQuickPanel
        store={wallpaperStore}
        adapter={wallpaperHost}
        dock="official"
        className="min-h-0 flex-1"
      />
    </div>
  );
});

export interface PrismuxTopbarControlsProps {
  readonly wallpaperOpen: boolean;
  readonly wallpaperAvailable: boolean;
  readonly inlineRightPanelOwnsTitleBar: boolean;
  readonly onToggleWallpaper: () => void;
  readonly onOpenChiefSettings: () => void;
}

const DIAL_MODE_LABELS = {
  agent: "Agent",
  oracle: "Oracle",
  review: "Review",
} as const;

/**
 * MP-02 chat header controls: compact Chief Thread Slot status pill + one-click Wallpaper/Glass sidebar toggle.
 * Strictly marks interactive controls `[-webkit-app-region:no-drag]` to preserve Electron window dragging.
 */
export const PrismuxTopbarControls = memo(function PrismuxTopbarControls({
  wallpaperOpen,
  wallpaperAvailable,
  inlineRightPanelOwnsTitleBar,
  onToggleWallpaper,
  onOpenChiefSettings,
}: PrismuxTopbarControlsProps) {
  const { appearance, chiefProvider, dialMode, daemonInfo } = usePrismuxRuntime();
  const isGlassActive = appearance.themeMode === "glass" && appearance.glassPreset !== "off";

  return (
    <div
      data-pmx-topbar-controls=""
      className={cn(
        "flex shrink-0 items-center gap-1.5 [-webkit-app-region:no-drag]",
        inlineRightPanelOwnsTitleBar ? "mr-10" : "mr-28",
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-pmx-chief-badge=""
              onClick={onOpenChiefSettings}
              className={cn(
                "inline-flex h-7 max-w-44 items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 text-[11px] font-medium text-foreground/85 transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [-webkit-app-region:no-drag]",
                isGlassActive && "border-white/20 bg-white/10 backdrop-blur-md",
              )}
              aria-label={`主秘书槽位：${chiefProvider} (${DIAL_MODE_LABELS[dialMode]})，点击管理记忆与同步`}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  daemonInfo.ready ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.75)]" : "bg-amber-400/80",
                )}
              />
              <span className="truncate font-mono text-[10.5px] tracking-tight">
                {chiefProvider}
              </span>
              <span className="rounded-sm bg-foreground/10 px-1 py-px text-[9.5px] uppercase tracking-wider text-muted-foreground">
                {DIAL_MODE_LABELS[dialMode]}
              </span>
            </button>
          }
        />
        <TooltipPopup side="bottom">
          {daemonInfo.ready
            ? `主秘书槽位：${chiefProvider} · ${DIAL_MODE_LABELS[dialMode]}（点击进入记忆与同步设置）`
            : `主秘书槽位：${chiefProvider} · 本地预览模式（点击管理记忆与同步）`}
        </TooltipPopup>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger render={<span className="flex shrink-0" />}>
          <Toggle
            className={cn(
              "shrink-0 [-webkit-app-region:no-drag]",
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
              <Sparkles className="size-4" />
            ) : (
              <ImageIcon className="size-4" />
            )}
          </Toggle>
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {wallpaperAvailable ? "壁纸与液态玻璃边栏" : "打开会话后可使用壁纸边栏"}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});
