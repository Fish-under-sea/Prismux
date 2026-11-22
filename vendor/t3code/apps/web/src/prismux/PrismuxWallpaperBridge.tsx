import {
  CelestialThemeCapsule,
  FloatingColorPopover,
} from "@prismux/appearance";
import {
  WallpaperQuickPanel,
  WallpaperStage,
  useWallpaperStore,
  type AppearanceBridge,
  type ColorTriggerRenderContext,
  type ThemeHeroRenderContext,
  type WallpaperItem,
} from "@prismux/wallpaper";
import { Image as ImageIcon, Sparkles } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import { Toggle } from "../components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import { usePrismuxRuntime } from "./PrismuxRuntimeProvider";

interface ActivePopoverState {
  anchorEl: HTMLElement;
  label: string;
  value: string;
  onChange: (hex: string) => void;
  onClear?: () => void;
}

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
 * Native right-panel `"wallpaper"` surface integrating @prismux/wallpaper's QuickPanel
 * with @prismux/appearance's 1:1 FISH-Dock CelestialThemeCapsule (compact) and FloatingColorPopover.
 */
export const PrismuxWallpaperQuickPanel = memo(function PrismuxWallpaperQuickPanel() {
  const { wallpaperStore, wallpaperHost, setThemeMode } = usePrismuxRuntime();
  const [activePopover, setActivePopover] = useState<ActivePopoverState | null>(null);

  const renderThemeHero = useCallback(
    (ctx: ThemeHeroRenderContext) => (
      <CelestialThemeCapsule
        mode={ctx.themeMode}
        onChange={ctx.onChangeThemeMode}
        size="compact"
      />
    ),
    [],
  );

  const renderColorTrigger = useCallback((ctx: ColorTriggerRenderContext) => {
    const swatchColor = ctx.value?.trim() || "";
    return (
      <button
        type="button"
        className="pmx-wp-btn inline-flex items-center gap-1.5 px-2 text-xs"
        aria-label={ctx.label}
        title={ctx.label}
        onClick={(event) => {
          const anchorEl = event.currentTarget;
          setActivePopover((prev) =>
            prev?.anchorEl === anchorEl
              ? null
              : {
                  anchorEl,
                  label: ctx.label,
                  value: swatchColor,
                  onChange: ctx.onChange,
                  ...(ctx.onClear ? { onClear: ctx.onClear } : {}),
                },
          );
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.28)",
            background: swatchColor
              ? swatchColor
              : "conic-gradient(from 0deg, #ff5e7e, #ffbd4a, #4cd964, #5e9bff, #c084fc, #ff5e7e)",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span className="font-mono text-[11px] opacity-85">
          {swatchColor ? swatchColor.toUpperCase() : "默认"}
        </span>
      </button>
    );
  }, []);

  const appearanceBridge = useMemo<AppearanceBridge>(
    () => ({
      onThemeModeChange: setThemeMode,
      renderThemeHero,
      renderThemeCapsule: renderThemeHero,
      renderColorTrigger,
    }),
    [renderColorTrigger, renderThemeHero, setThemeMode],
  );

  return (
    <div
      data-pmx-right-sidebar=""
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
    >
      <WallpaperQuickPanel
        store={wallpaperStore}
        adapter={wallpaperHost}
        dock="official"
        appearanceBridge={appearanceBridge}
        renderThemeHero={renderThemeHero}
        className="min-h-0 flex-1"
      />
      <FloatingColorPopover
        open={activePopover !== null}
        value={activePopover?.value ?? ""}
        anchorEl={activePopover?.anchorEl ?? null}
        {...(activePopover?.label ? { title: activePopover.label } : {})}
        allowClear={Boolean(activePopover?.onClear)}
        onChange={(hex) => {
          activePopover?.onChange(hex);
          setActivePopover((prev) => (prev ? { ...prev, value: hex } : null));
        }}
        onClear={() => {
          activePopover?.onClear?.();
          setActivePopover((prev) => (prev ? { ...prev, value: "" } : null));
        }}
        onClose={() => setActivePopover(null)}
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
