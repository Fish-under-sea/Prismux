import { InlineAppearanceStudio } from "@prismux/appearance";
import {
  WallpaperQuickPanel,
  WallpaperStage,
  findWallpaperById,
  isWallpaperGatedByEngine,
  useWallpaperStore,
  type InlineAppearanceRenderContext,
  type WallpaperHostAdapter,
  type WallpaperItem,
  type WallpaperSettingsState,
  type WallpaperStore,
} from "@prismux/wallpaper";
import { memo, useEffect, useId, useMemo, useRef, useState } from "react";

import { PopoverCreateHandle, PopoverTrigger } from "../components/ui/popover";
import { Toggle } from "../components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import type { ThreadPanelPresentation } from "../rightPanelLayout";
import { PrismuxChiefStatusPill } from "./PrismuxChiefStatusPill";
import type { PrismuxDaemonClient } from "./daemonClient";
import { usePrismuxRuntime } from "./PrismuxRuntimeProvider";

/**
 * Resolves the authenticated live runtime iframe URL for Web and live-supported Steam Scene wallpapers.
 * Hard-blocks returning any Web/Scene runtime URL when `settings.advancedEngineEnabled` is false.
 */
export function resolveWallpaperLiveRuntimeUrl(
  daemon: Pick<PrismuxDaemonClient, "resolveMediaUrl" | "buildMediaUrl">,
  wallpaper: WallpaperItem,
  settings?: Pick<WallpaperSettingsState, "advancedEngineEnabled">,
): string | null {
  if (settings && !settings.advancedEngineEnabled) {
    return null;
  }
  if (wallpaper.type === "web") {
    return (
      (wallpaper.mediaUrl ? daemon.resolveMediaUrl(wallpaper.mediaUrl) : null) ??
      daemon.buildMediaUrl("web", wallpaper.id, "index.html")
    );
  }
  if (wallpaper.type === "scene" && wallpaper.source === "steam" && wallpaper.sceneLiveSupported) {
    return (
      (wallpaper.mediaUrl ? daemon.resolveMediaUrl(wallpaper.mediaUrl) : null) ??
      daemon.buildMediaUrl("scene", wallpaper.id, "index.html")
    );
  }
  return null;
}

/**
 * Wraps a base `WallpaperHostAdapter` so toggling `advancedEngineEnabled` flushes immediately to
 * Daemon (`PUT /v1/appearance`) and refreshes Steam catalog metadata before mounting a live runtime.
 */
export function createEngineAwareWallpaperHost(
  baseHost: WallpaperHostAdapter,
  daemon: Pick<PrismuxDaemonClient, "saveAppearance">,
  wallpaperStore: Pick<WallpaperStore, "refreshLibrary">,
): WallpaperHostAdapter {
  if (baseHost.onAdvancedEngineToggle) return baseHost;
  return {
    ...baseHost,
    onAdvancedEngineToggle: async (enabled: boolean) => {
      try {
        await daemon.saveAppearance({
          wallpaper: { advancedEngineEnabled: enabled },
        });
      } catch {
        // Offline mode: local store update still succeeds
      }
      if (enabled && baseHost.listWallpapers) {
        await wallpaperStore.refreshLibrary(baseHost, false);
      }
    },
  };
}

const MISSING_WALLPAPER_RETRY_MS: readonly number[] = [500, 1500, 4000, 8000];
const MEDIA_REFRESH_THROTTLE_MS = 3000;

/**
 * Rebuilds a fresh authenticated Daemon media URL after daemon restart or auth-token rotation.
 * Preserves blob:/data: URLs verbatim.
 */
export function buildFreshWallpaperMediaUrl(
  daemon: Pick<PrismuxDaemonClient, "resolveMediaUrl" | "buildMediaUrl">,
  wallpaper: Pick<WallpaperItem, "id" | "type" | "source" | "mediaUrl" | "sceneLiveSupported">,
): string | null {
  if (!wallpaper.mediaUrl) return null;
  if (wallpaper.mediaUrl.startsWith("blob:") || wallpaper.mediaUrl.startsWith("data:")) {
    return wallpaper.mediaUrl;
  }
  if (/\/v1\/wallpapers\/media\//i.test(wallpaper.mediaUrl)) {
    return daemon.buildMediaUrl("media", wallpaper.id);
  }
  if (wallpaper.type === "web") {
    return daemon.buildMediaUrl("web", wallpaper.id, "index.html");
  }
  if (wallpaper.type === "scene" && wallpaper.source === "steam" && wallpaper.sceneLiveSupported) {
    return daemon.buildMediaUrl("scene", wallpaper.id, "index.html");
  }
  return daemon.resolveMediaUrl(wallpaper.mediaUrl);
}

/**
 * Z-0 Fullscreen Wallpaper Stage (0 Token visual layer).
 * Mounts behind the Prismux shell, obeys window occlusion / visibility for 0 FPS suspension,
 * self-heals stale occlusion or unhydrated inventory states, and resolves fresh authenticated
 * Daemon URLs for video/image/web/scene runtimes.
 */
export const PrismuxWallpaperBackdrop = memo(function PrismuxWallpaperBackdrop() {
  const { daemon, daemonInfo, wallpaperStore, wallpaperHost, occluded } = usePrismuxRuntime();
  const snapshot = useWallpaperStore(wallpaperStore);
  const [verifiedUnoccluded, setVerifiedUnoccluded] = useState(false);
  const lastMediaRefreshAtRef = useRef(0);

  const selectedId = snapshot.settings.selectedId;
  const currentWallpaper = findWallpaperById(snapshot.wallpapers, selectedId);
  const rawOccluded = occluded || snapshot.occluded;

  // Reset local occlusion verification whenever upstream occlusion clears or a fresh desktop occlusion event arrives.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to Electron occlusion IPC and wake events to self-heal stale occluded=true state
  useEffect(() => {
    if (!rawOccluded) {
      queueMicrotask(() => {
        setVerifiedUnoccluded((prev) => (prev ? false : prev));
      });
      return;
    }
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    let disposed = false;
    const prismuxBridge = window.desktopBridge?.prismux;

    const verifyWithHost = async (): Promise<boolean> => {
      if (disposed || document.hidden || document.visibilityState !== "visible") {
        return true;
      }
      if (prismuxBridge && typeof prismuxBridge.getWindowOcclusion === "function") {
        try {
          const res = await prismuxBridge.getWindowOcclusion();
          if (disposed) return true;
          if (res && res.occluded === false && document.visibilityState === "visible") {
            setVerifiedUnoccluded(true);
            if (wallpaperStore.getSnapshot().occluded) {
              wallpaperStore.setOccluded(false);
            }
            return false;
          }
          setVerifiedUnoccluded(false);
          return true;
        } catch {
          return true;
        }
      }
      setVerifiedUnoccluded(true);
      if (wallpaperStore.getSnapshot().occluded) {
        wallpaperStore.setOccluded(false);
      }
      return false;
    };

    const unsubscribeDesktopOcclusion =
      prismuxBridge && typeof prismuxBridge.onWindowOcclusionChange === "function"
        ? prismuxBridge.onWindowOcclusionChange((payload) => {
            if (disposed) return;
            if (payload.occluded) {
              setVerifiedUnoccluded(false);
            } else if (document.visibilityState === "visible") {
              setVerifiedUnoccluded(true);
            }
          })
        : undefined;

    // Immediately verify once if a desktop window is already visible (heals cold-boot show:false IPC races).
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    if (
      document.visibilityState === "visible" &&
      prismuxBridge &&
      typeof prismuxBridge.getWindowOcclusion === "function"
    ) {
      void verifyWithHost();
      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (!disposed && document.visibilityState === "visible") {
          void verifyWithHost();
        }
      }, 300);
    }

    const onLiveWake = () => {
      if (disposed || document.hidden || document.visibilityState !== "visible") return;
      void verifyWithHost();
    };

    document.addEventListener("visibilitychange", onLiveWake);
    window.addEventListener("focus", onLiveWake);
    window.addEventListener("pageshow", onLiveWake);
    window.addEventListener("pointerdown", onLiveWake, { passive: true });
    window.addEventListener("keydown", onLiveWake, { passive: true });

    return () => {
      disposed = true;
      if (settleTimer !== null) clearTimeout(settleTimer);
      unsubscribeDesktopOcclusion?.();
      document.removeEventListener("visibilitychange", onLiveWake);
      window.removeEventListener("focus", onLiveWake);
      window.removeEventListener("pageshow", onLiveWake);
      window.removeEventListener("pointerdown", onLiveWake);
      window.removeEventListener("keydown", onLiveWake);
    };
  }, [rawOccluded, wallpaperStore]);

  // Self-heal when a persisted `selectedId` exists but the wallpaper inventory has not hydrated yet
  // (e.g. slow Windows daemon startup or transient initial inventory failure).
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- retries wallpaperStore.refreshLibrary with bounded backoff when selectedId is unresolved
  useEffect(() => {
    if (!selectedId || currentWallpaper !== null || !wallpaperHost.listWallpapers) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }

    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const triggerRefresh = () => {
      if (disposed) return;
      const latest = wallpaperStore.getSnapshot();
      if (
        !latest.settings.selectedId ||
        findWallpaperById(latest.wallpapers, latest.settings.selectedId) !== null ||
        latest.loading
      ) {
        return;
      }
      void wallpaperStore.refreshLibrary(wallpaperHost, false).finally(() => {
        if (!disposed) {
          scheduleNext();
        }
      });
    };

    const scheduleNext = () => {
      if (disposed || retryTimer !== null || attempt >= MISSING_WALLPAPER_RETRY_MS.length) {
        return;
      }
      const latest = wallpaperStore.getSnapshot();
      if (
        !latest.settings.selectedId ||
        findWallpaperById(latest.wallpapers, latest.settings.selectedId) !== null
      ) {
        return;
      }
      const delayMs = MISSING_WALLPAPER_RETRY_MS[attempt]!;
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        triggerRefresh();
      }, delayMs);
    };

    if (daemonInfo.ready) {
      scheduleNext();
    }

    const onWake = () => {
      if (disposed || (typeof document !== "undefined" && document.hidden)) return;
      attempt = 0;
      triggerRefresh();
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onWake);
    }
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);

    return () => {
      disposed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onWake);
      }
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [selectedId, currentWallpaper, daemonInfo.ready, wallpaperHost, wallpaperStore]);

  const handleRequestOcclusionSync = async (): Promise<boolean> => {
    if (
      typeof document !== "undefined" &&
      (document.hidden || document.visibilityState !== "visible")
    ) {
      return true;
    }
    const prismuxBridge = typeof window !== "undefined" ? window.desktopBridge?.prismux : undefined;
    if (prismuxBridge && typeof prismuxBridge.getWindowOcclusion === "function") {
      try {
        const res = await prismuxBridge.getWindowOcclusion();
        const stillOccluded = Boolean(res?.occluded);
        setVerifiedUnoccluded(!stillOccluded);
        if (!stillOccluded && wallpaperStore.getSnapshot().occluded) {
          wallpaperStore.setOccluded(false);
        }
        return stillOccluded;
      } catch {
        return rawOccluded;
      }
    }
    setVerifiedUnoccluded(true);
    if (wallpaperStore.getSnapshot().occluded) {
      wallpaperStore.setOccluded(false);
    }
    return false;
  };

  const handleRequestMediaRefresh = async (wallpaper: WallpaperItem): Promise<string | null> => {
    const info = await daemon.getConnectionInfo(true).catch(() => null);
    const now = Date.now();
    if (
      info?.ready &&
      wallpaperHost.listWallpapers &&
      now - lastMediaRefreshAtRef.current >= MEDIA_REFRESH_THROTTLE_MS
    ) {
      lastMediaRefreshAtRef.current = now;
      void wallpaperStore.refreshLibrary(wallpaperHost, false);
    }
    return buildFreshWallpaperMediaUrl(daemon, wallpaper);
  };

  const resolveLiveRuntimeUrl = (
    wallpaper: WallpaperItem,
    settings: WallpaperSettingsState,
  ): string | null => resolveWallpaperLiveRuntimeUrl(daemon, wallpaper, settings);

  if (!selectedId || isWallpaperGatedByEngine(currentWallpaper, snapshot.settings)) {
    return null;
  }

  const effectiveOccluded = rawOccluded && !verifiedUnoccluded;

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
        occluded={effectiveOccluded}
        resolveLiveRuntimeUrl={resolveLiveRuntimeUrl}
        onRequestMediaRefresh={handleRequestMediaRefresh}
        onRequestOcclusionSync={handleRequestOcclusionSync}
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
  const { appearance, setAppearance, setThemeMode, daemon, wallpaperStore, wallpaperHost } =
    usePrismuxRuntime();

  // oxlint-disable-next-line prismux/no-manual-memo -- preserves stable WallpaperHostAdapter identity for downstream @prismux/wallpaper effects across renders
  const engineAwareHost = useMemo(
    () => createEngineAwareWallpaperHost(wallpaperHost, daemon, wallpaperStore),
    [wallpaperHost, daemon, wallpaperStore],
  );

  const renderInlineAppearance = ({ onBack }: InlineAppearanceRenderContext) => (
    <InlineAppearanceStudio
      config={appearance}
      onChange={setAppearance}
      onThemeModeChange={setThemeMode}
      onBack={onBack}
      // oxlint-disable-next-line prismux/no-untranslated-copy -- Prismux Chinese workbench copy verified by PrismuxWallpaperBridge.test.tsx
      backLabel="返回壁纸"
      // oxlint-disable-next-line prismux/no-untranslated-copy -- Prismux Chinese workbench copy verified by PrismuxWallpaperBridge.test.tsx
      title="外观与玻璃"
    />
  );

  return (
    <div
      data-pmx-right-sidebar=""
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
    >
      <WallpaperQuickPanel
        store={wallpaperStore}
        adapter={engineAwareHost}
        renderInlineAppearance={renderInlineAppearance}
        dock="official"
        className="min-h-0 flex-1"
      />
    </div>
  );
});

/**
 * Bespoke 6-stop RGB prism-gradient Sparkles icon for the topbar Wallpaper toggle button.
 * Uses a unique `useId()` `<linearGradient>` and settles statically under `prefers-reduced-motion`.
 */
export const PrismuxWallpaperSparklesIcon = memo(function PrismuxWallpaperSparklesIcon({
  className,
  active = false,
}: {
  readonly className?: string;
  readonly active?: boolean;
}) {
  const rawId = useId();
  const gradientId = `pmx-wallpaper-rgb-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const strokeUrl = `url(#${gradientId})`;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-pmx-wallpaper-icon="1"
      data-pmx-rgb-gradient="1"
      data-active={active ? "1" : "0"}
      // oxlint-disable-next-line shadcn/no-unknown-classes -- custom bridge CSS animation class and Lucide selector hook
      className={cn("lucide lucide-sparkles pmx-wallpaper-rgb-sparkles", className)}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="2"
          y1="2"
          x2="22"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          {/* oxlint-disable shadcn/no-raw-colors -- fixed 6-stop RGB prism brand gradient */}
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="22%" stopColor="#6366f1" />
          <stop offset="46%" stopColor="#ec4899" />
          <stop offset="70%" stopColor="#f59e0b" />
          <stop offset="88%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#38bdf8" />
          {/* oxlint-enable shadcn/no-raw-colors */}
        </linearGradient>
      </defs>
      <path
        d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
        stroke={strokeUrl}
        fill={strokeUrl}
        fillOpacity={active ? 0.3 : 0.16}
      />
      <path d="M20 3v4" stroke={strokeUrl} />
      <path d="M22 5h-4" stroke={strokeUrl} />
      <path d="M4 17v2" stroke={strokeUrl} />
      <path d="M5 18H3" stroke={strokeUrl} />
    </svg>
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
  /** Independent right-sidebar wallpaper quick-toggle button (RGB Sparkles icon) before Overview. */
  readonly wallpaperOpen?: boolean;
  readonly wallpaperAvailable?: boolean;
  readonly inlineRightPanelOwnsTitleBar?: boolean;
  readonly onToggleWallpaper?: () => void;
  readonly onOpenChiefSettings: () => void;
  readonly className?: string;
}

/**
 * Unified single-topbar Prismux controls (Chief pill -> Wallpaper -> Overview) placed before
 * ChatView's Bottom and Right Panel toggles; marks interactive buttons `[-webkit-app-region:no-drag]`.
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
      className="size-7 min-w-7 shrink-0 [-webkit-app-region:no-drag]"
      pressed={overviewOpen}
      onPressedChange={overviewPresentation === "popover" ? undefined : onToggleOverview}
      // oxlint-disable-next-line prismux/no-untranslated-copy -- Prismux Chinese workbench aria-label verified by unit test
      aria-label="概览"
      data-pmx-overview-toggle="1"
      data-pmx-topbar-icon-toggle="1"
      data-pmx-topbar-toggle-kind="overview"
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
        className="h-6.5 px-2 text-2xs"
      />

      {onToggleWallpaper ? (
        <Tooltip>
          <TooltipTrigger render={<span className="flex shrink-0" />}>
            <Toggle
              className="size-7 min-w-7 shrink-0 [-webkit-app-region:no-drag]"
              pressed={wallpaperOpen}
              onPressedChange={onToggleWallpaper}
              // oxlint-disable-next-line prismux/no-untranslated-copy -- Prismux Chinese workbench aria-label verified by unit test
              aria-label="壁纸快速开启"
              data-pmx-wallpaper-toggle="1"
              data-pmx-topbar-icon-toggle="1"
              data-pmx-topbar-toggle-kind="wallpaper"
              variant="ghost"
              size="sm"
              disabled={!wallpaperAvailable}
            >
              <PrismuxWallpaperSparklesIcon className="size-4" active={wallpaperOpen} />
            </Toggle>
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            {/* oxlint-disable-next-line prismux/no-untranslated-copy -- Prismux Chinese workbench tooltip copy */}
            {wallpaperAvailable ? "壁纸快速开启" : "打开会话后可使用壁纸边栏"}
          </TooltipPopup>
        </Tooltip>
      ) : null}

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
            {/* oxlint-disable-next-line prismux/no-untranslated-copy -- Prismux Chinese workbench tooltip copy */}
            {overviewShortcutLabel ? `概览 (${overviewShortcutLabel})` : "概览"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
});
