import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  deriveLatestContextWindowSnapshot,
  latestProviderTurnTokenUsage,
} from "@t3tools/client-runtime/state/context-window";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import type { PrismuxKeepAwakeState, ServerProvider } from "@t3tools/contracts";
import { makeWindow } from "@t3tools/shared/usageFormat";
import { useRouterState } from "@tanstack/react-router";
import {
  CheckIcon,
  CoffeeIcon,
  CpuIcon,
  GaugeIcon,
  NetworkIcon,
  ShieldCheckIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { getClientSettings, subscribeClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import {
  useProject,
  useQuietThreadProjection,
  useQuietThreadVisibleTurnItems,
} from "~/state/entities";
import { environmentPresentations } from "~/state/presentation";
import { serverEnvironment } from "~/state/server";
import { runningThreadKeepAliveAtom } from "~/state/threads";
import { useUsage } from "~/state/usage";
import { useAtomCommand } from "~/state/use-atom-command";
import { resolveThreadRouteRef } from "~/threadRoutes";
import type { DaemonSystemResourcesResponse } from "./daemonClient";
import { useOptionalPrismuxRuntime } from "./PrismuxRuntimeProvider";
import { KeepAwakeStatusPopover } from "./statusBar/KeepAwakeStatusPopover";
import { PortsStatusPopover } from "./statusBar/PortsStatusPopover";
import { ResourcesStatusPopover } from "./statusBar/ResourcesStatusPopover";
import { deriveContextGaugeFromSnapshot } from "./statusBar/statusBarContext";
import {
  shouldOpenStatusBarContextMenu,
  STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS,
} from "./statusBar/statusBarContextMenuPolicy";
import {
  countActiveRunningThreads,
  deriveKeepAwakeState,
  loadKeepAwakeMode,
  resolveKeepAwakeLocale,
  saveKeepAwakeMode,
  type KeepAwakeMode,
} from "./statusBar/statusBarKeepAwake";
import {
  formatBytesCompact,
  formatCpuPercent,
  normalizeResourcesSummary,
} from "./statusBar/statusBarResources";
import {
  collectStatusBarUsageSummary,
  formatCompactUsageTokens,
  formatCompactUsageWindowValue,
} from "./statusBar/statusBarUsage";
import {
  DEFAULT_STATUS_BAR_VISIBILITY,
  loadStatusBarUsagePreferences,
  loadStatusBarVisibility,
  saveStatusBarUsagePreferences,
  saveStatusBarVisibility,
  STATUS_BAR_SEGMENT_IDS,
  toggleStatusBarSegment,
  type StatusBarSegmentId,
  type StatusBarUsagePreferences,
  type StatusBarVisibility,
} from "./statusBar/statusBarVisibility";
import { UsageStatusPopover } from "./statusBar/UsageStatusPopover";
import { useResetCountdownClock } from "./statusBar/useResetCountdownClock";
import { usePrismuxTraySync } from "./usePrismuxTraySync";

export const PRISMUX_STATUS_BAR_HEIGHT_PX = 20 as const;

const SEGMENT_LABELS: Readonly<Record<StatusBarSegmentId, string>> = {
  usage: "额度与用量统计",
  keepAwake: "防止电脑休眠",
  ports: "监听端口胶囊",
  resources: "CPU / RAM 归因",
};

interface WakeLockSentinelLike {
  readonly released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: "release", listener: () => void) => void;
  removeEventListener?: (type: "release", listener: () => void) => void;
}

interface NavigatorWithWakeLock {
  readonly wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
}

const RESOURCES_OPEN_POLL_MS = 3_000;
const RESOURCES_IDLE_POLL_MS = 8_000;
const RESOURCES_EARLY_WARMUP_MS = 1_800;

const STATUS_POPOVER_POPUP_CLASS =
  "overflow-hidden rounded-xl border border-border bg-popover bg-clip-padding p-0 shadow-xl before:hidden";

export function PrismuxStatusBar() {
  usePrismuxTraySync();
  const runtime = useOptionalPrismuxRuntime();
  const scrollStripRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const [visibility, setVisibility] = useState<StatusBarVisibility>(() =>
    loadStatusBarVisibility(),
  );
  const [usagePrefs, setUsagePrefs] = useState<StatusBarUsagePreferences>(() =>
    loadStatusBarUsagePreferences(),
  );
  const [usageOpen, setUsageOpen] = useState(false);
  const [keepAwakeOpen, setKeepAwakeOpen] = useState(false);
  const [portsOpen, setPortsOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [keepAwakeMode, setKeepAwakeMode] = useState<KeepAwakeMode>(() => loadKeepAwakeMode());
  const [keepAwakeNativeState, setKeepAwakeNativeState] = useState<PrismuxKeepAwakeState | null>(
    null,
  );
  const [keepAwakeError, setKeepAwakeError] = useState<string | null>(null);
  const [webWakeLockActive, setWebWakeLockActive] = useState(false);
  const lastSyncedKeepAwakeRef = useRef<boolean | null>(null);
  const webWakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const [contextMenu, setContextMenu] = useState<{ readonly x: number; readonly y: number } | null>(
    null,
  );
  const [overridePortsWorkspace, setOverridePortsWorkspace] = useState<string | null>(null);
  const [liveResources, setLiveResources] = useState<DaemonSystemResourcesResponse | null>(null);
  const [manualResourcesLoading, setManualResourcesLoading] = useState(false);
  const [liveResourcesError, setLiveResourcesError] = useState<string | null>(null);
  const [usageRefreshing, setUsageRefreshing] = useState(false);

  // Resolve current route thread & workspace root without touching ChatView.
  const routeParams = useRouterState({
    select: (state) => {
      const params = state.matches.at(-1)?.params as
        | Partial<Record<"environmentId" | "threadId", string | undefined>>
        | undefined;
      return {
        environmentId: params?.environmentId,
        threadId: params?.threadId,
      };
    },
  });
  const activeThreadRef = useMemo(
    () => resolveThreadRouteRef(routeParams),
    [routeParams.environmentId, routeParams.threadId],
  );
  const serverThreadProjection = useQuietThreadProjection(activeThreadRef);
  const serverProjection = serverThreadProjection?.projection ?? null;
  const serverVisibleTurnItems = useQuietThreadVisibleTurnItems(activeThreadRef);
  const activeProjectRef =
    serverProjection && activeThreadRef
      ? scopeProjectRef(activeThreadRef.environmentId, serverProjection.thread.projectId)
      : null;
  const activeProject = useProject(activeProjectRef);
  const activeWorkspaceRoot =
    overridePortsWorkspace ??
    serverProjection?.thread.worktreePath ??
    activeProject?.workspaceRoot ??
    null;

  const activeProviderThread = serverProjection?.providerThreads.find(
    (thread) => thread.id === serverProjection.thread.activeProviderThreadId,
  );
  const activeThreadLiveTokenUsage = useMemo(
    () =>
      latestProviderTurnTokenUsage(
        serverProjection?.providerTurns ?? [],
        serverProjection,
        activeProviderThread,
      ),
    [serverProjection, activeProviderThread],
  );
  const activeContextWindow = useMemo(
    () =>
      deriveLatestContextWindowSnapshot(
        serverVisibleTurnItems ?? [],
        activeThreadLiveTokenUsage,
        activeProviderThread,
      ),
    [serverVisibleTurnItems, activeThreadLiveTokenUsage, activeProviderThread],
  );

  // Collect providers across connected environments (read-only from existing client atoms).
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const allProviders = useMemo<readonly ServerProvider[]>(() => {
    const list: ServerProvider[] = [];
    for (const presentation of presentations.values()) {
      const providers = presentation.serverConfig?.providers;
      if (Array.isArray(providers)) {
        list.push(...providers);
      }
    }
    return list;
  }, [presentations]);

  // 7-day local usage summary (also exposes today's bucket) for custom-endpoint & all providers.
  const [usageWindow, setUsageWindow] = useState(() => makeWindow(7, undefined, "day"));
  const usageView = useUsage(usageWindow);
  const mergedUsage = usageView.shown?.merged ?? usageView.merged;
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });

  const activeThreadProvider = useMemo(() => {
    const instanceId =
      activeProviderThread?.providerInstanceId ??
      serverProjection?.thread.modelSelection?.instanceId ??
      null;
    if (!instanceId) return null;
    return allProviders.find((p) => p.instanceId === instanceId) ?? null;
  }, [activeProviderThread, allProviders, serverProjection]);

  const usageResetTimes = useMemo(() => {
    const times: number[] = [];
    for (const provider of allProviders) {
      if (!provider.enabled || provider.driver === "antigravity") continue;
      const rawWindows = provider.usageLimits?.windows;
      if (!Array.isArray(rawWindows)) continue;
      for (const win of rawWindows) {
        if (typeof win.resetsAt === "string" && win.resetsAt.trim()) {
          const parsed = Date.parse(win.resetsAt);
          if (Number.isFinite(parsed)) {
            times.push(parsed);
          }
        }
      }
    }
    return times;
  }, [allProviders]);

  // Boundary-scheduled countdown clock (Orca `useResetCountdownClock`): ticks only at exact reset boundaries while popover is open.
  const now = useResetCountdownClock(usageOpen, usageResetTimes);

  const usageSummary = useMemo(
    () => collectStatusBarUsageSummary(allProviders, now, mergedUsage, usageWindow.untilDay),
    [allProviders, mergedUsage, now, usageWindow.untilDay],
  );
  const contextGauge = useMemo(
    () => deriveContextGaugeFromSnapshot(activeContextWindow),
    [activeContextWindow],
  );

  // Prefer whichever resources snapshot is newer between runtime context and live status-bar sampling.
  const effectiveResources = useMemo(() => {
    const ctxRes = runtime?.systemResources ?? null;
    if (!liveResources) return ctxRes;
    if (!ctxRes) return liveResources;
    const liveTs = liveResources.collectedAt ?? liveResources.sampledAt ?? 0;
    const ctxTs = ctxRes.collectedAt ?? ctxRes.sampledAt ?? 0;
    return liveTs >= ctxTs ? liveResources : ctxRes;
  }, [liveResources, runtime?.systemResources]);

  const resourcesSummary = useMemo(
    () => normalizeResourcesSummary(effectiveResources),
    [effectiveResources],
  );

  // Track active coding agent / streaming threads across all connected environments + daemon busy state.
  const keptRunningThreads = useAtomValue(runningThreadKeepAliveAtom);
  const activeThreadCount = useMemo(
    () => countActiveRunningThreads(keptRunningThreads),
    [keptRunningThreads],
  );
  const clientLanguageSetting = useSyncExternalStore(
    subscribeClientSettings,
    () => getClientSettings().language,
    () => "zh",
  );
  const keepAwakeLocale = useMemo(
    () => resolveKeepAwakeLocale(clientLanguageSetting),
    [clientLanguageSetting],
  );
  const daemonTaskBusy = useMemo(() => {
    const installState = runtime?.updaterBadge.installState;
    return (
      installState === "downloading" ||
      installState === "extracting" ||
      installState === "verifying" ||
      installState === "installing"
    );
  }, [runtime?.updaterBadge.installState]);
  const hasDesktopKeepAwake =
    typeof window !== "undefined" &&
    typeof window.desktopBridge?.prismux?.setKeepAwake === "function";

  const keepAwakeState = useMemo(
    () =>
      deriveKeepAwakeState({
        mode: keepAwakeMode,
        activeThreadCount,
        activeAgentProcessCount: resourcesSummary.activeAgentCount,
        daemonTaskBusy,
        desktopBridgeAvailable: hasDesktopKeepAwake,
        nativeActive: keepAwakeNativeState ? keepAwakeNativeState.active : null,
        webWakeLockActive,
        locale: keepAwakeLocale,
      }),
    [
      activeThreadCount,
      daemonTaskBusy,
      hasDesktopKeepAwake,
      keepAwakeLocale,
      keepAwakeMode,
      keepAwakeNativeState,
      resourcesSummary.activeAgentCount,
      webWakeLockActive,
    ],
  );

  // Synchronize desired keep-awake lock with Electron powerSaveBlocker (idempotent) or browser Wake Lock fallback.
  useEffect(() => {
    const desired = keepAwakeState.shouldPreventSleep;
    const bridge = typeof window !== "undefined" ? window.desktopBridge?.prismux : undefined;

    if (bridge && typeof bridge.setKeepAwake === "function") {
      if (lastSyncedKeepAwakeRef.current === desired) {
        return;
      }
      let cancelled = false;
      lastSyncedKeepAwakeRef.current = desired;
      void bridge
        .setKeepAwake(desired)
        .then((nextState) => {
          if (cancelled) return;
          setKeepAwakeNativeState(nextState);
          setKeepAwakeError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          lastSyncedKeepAwakeRef.current = null;
          setKeepAwakeError(err instanceof Error ? err.message : String(err));
        });
      return () => {
        cancelled = true;
      };
    }

    // Non-Electron Web fallback: best-effort Screen Wake Lock API (never throws).
    const releaseWebLock = () => {
      const current = webWakeLockRef.current;
      webWakeLockRef.current = null;
      if (current && !current.released) {
        void current.release().catch(() => {});
      }
      setWebWakeLockActive(false);
    };

    if (!desired) {
      releaseWebLock();
      return;
    }

    const nav = typeof navigator !== "undefined" ? (navigator as unknown as NavigatorWithWakeLock) : null;
    if (!nav?.wakeLock || typeof nav.wakeLock.request !== "function") {
      setWebWakeLockActive(false);
      return;
    }

    let cancelled = false;
    const requestWebLock = async () => {
      if (
        cancelled ||
        (typeof document !== "undefined" && document.visibilityState === "hidden")
      ) {
        return;
      }
      if (webWakeLockRef.current && !webWakeLockRef.current.released) {
        setWebWakeLockActive(true);
        return;
      }
      try {
        const sentinel = await nav.wakeLock!.request("screen");
        if (cancelled) {
          void sentinel.release().catch(() => {});
          return;
        }
        webWakeLockRef.current = sentinel;
        setWebWakeLockActive(true);
        sentinel.addEventListener?.("release", () => {
          if (webWakeLockRef.current === sentinel) {
            webWakeLockRef.current = null;
            setWebWakeLockActive(false);
          }
        });
      } catch {
        if (!cancelled) {
          setWebWakeLockActive(false);
        }
      }
    };

    void requestWebLock();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void requestWebLock();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      cancelled = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      releaseWebLock();
    };
  }, [keepAwakeState.shouldPreventSleep]);

  const handleSelectKeepAwakeMode = useCallback((nextMode: KeepAwakeMode) => {
    setKeepAwakeMode(nextMode);
    saveKeepAwakeMode(nextMode);
    setKeepAwakeError(null);
  }, []);

  const handleKeepAwakeOpenChange = useCallback((open: boolean) => {
    setKeepAwakeOpen(open);
    if (!open) return;
    const bridge = typeof window !== "undefined" ? window.desktopBridge?.prismux : undefined;
    if (bridge && typeof bridge.getKeepAwakeState === "function") {
      void bridge
        .getKeepAwakeState()
        .then((nextState) => {
          setKeepAwakeNativeState(nextState);
          setKeepAwakeError(null);
        })
        .catch(() => {});
    }
  }, []);

  const fetchLiveResources = useCallback(
    async (options: { forceRefresh: boolean; showSpinner: boolean }) => {
      if (!runtime?.daemonInfo.ready) return;
      if (options.showSpinner) {
        setManualResourcesLoading(true);
      }
      try {
        if (typeof runtime.daemon?.fetchSystemResources === "function") {
          const res = await runtime.daemon.fetchSystemResources(options.forceRefresh);
          setLiveResources(res);
          setLiveResourcesError(null);
        } else {
          await runtime.refreshSystemResources();
          setLiveResourcesError(null);
        }
      } catch (err) {
        if (options.showSpinner) {
          setLiveResourcesError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (options.showSpinner) {
          setManualResourcesLoading(false);
        }
      }
    },
    [runtime],
  );

  // Silent live resource polling (3s while popover open, 8s while visible, paused when occluded).
  useEffect(() => {
    if (!runtime?.daemonInfo.ready || runtime.occluded) return;
    let cancelled = false;

    const silentPoll = () => {
      if (
        cancelled ||
        (typeof document !== "undefined" && document.visibilityState === "hidden")
      ) {
        return;
      }
      void fetchLiveResources({ forceRefresh: false, showSpinner: false });
    };

    // Fast follow-up right after daemon boot so post-warmup Electron & CPU% deltas appear within ~2s.
    const warmupTimer = setTimeout(silentPoll, RESOURCES_EARLY_WARMUP_MS);
    const intervalMs = resourcesOpen ? RESOURCES_OPEN_POLL_MS : RESOURCES_IDLE_POLL_MS;
    const pollTimer = setInterval(silentPoll, intervalMs);

    return () => {
      cancelled = true;
      clearTimeout(warmupTimer);
      clearInterval(pollTimer);
    };
  }, [fetchLiveResources, resourcesOpen, runtime?.daemonInfo.ready, runtime?.occluded]);

  // Respond to external requests from left sidebar port badges to open the Ports Popover.
  const lastPortsRequestIdRef = useRef<number>(0);
  const portsPopoverRequest = runtime?.portsPopoverRequest ?? null;
  useEffect(() => {
    if (!portsPopoverRequest || portsPopoverRequest.id === lastPortsRequestIdRef.current) {
      return;
    }
    lastPortsRequestIdRef.current = portsPopoverRequest.id;
    setOverridePortsWorkspace(portsPopoverRequest.workspace ?? null);
    setPortsOpen(true);
    void runtime?.refreshSystemPorts(portsPopoverRequest.workspace ?? undefined);
  }, [portsPopoverRequest, runtime]);

  // Dismiss custom right-click menu on outside pointerdown or Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [contextMenu]);

  const handleToggleSegment = useCallback((segment: StatusBarSegmentId) => {
    setVisibility((prev) => {
      const next = toggleStatusBarSegment(prev, segment);
      saveStatusBarVisibility(next);
      return next;
    });
  }, []);

  const handleResetVisibility = useCallback(() => {
    setVisibility({ ...DEFAULT_STATUS_BAR_VISIBILITY });
    saveStatusBarVisibility(DEFAULT_STATUS_BAR_VISIBILITY);
    setContextMenu(null);
  }, []);

  const handleUsagePrefsChange = useCallback((next: StatusBarUsagePreferences) => {
    setUsagePrefs(next);
    saveStatusBarUsagePreferences(next);
  }, []);

  const handleRefreshUsage = useCallback(async () => {
    setUsageRefreshing(true);
    try {
      const nextWindow = makeWindow(7, undefined, "day");
      setUsageWindow(nextWindow);
      await Promise.allSettled([
        usageView.refresh(nextWindow),
        ...Array.from(presentations, ([environmentId, presentation]) => {
          if (presentation.connection.phase !== "connected" || presentation.serverConfig === null) {
            return Promise.resolve();
          }
          return refreshUsageLimits(
            environmentId,
            () => refreshProviders({ environmentId, input: {} }),
            false,
          );
        }),
      ]);
    } finally {
      setUsageRefreshing(false);
    }
  }, [presentations, refreshProviders, usageView]);

  // Native non-passive wheel listener (modeled after Orca StatusBarSurface.tsx):
  // Chromium treats React `onWheel` as passive, so `preventDefault()` requires `{ passive: false }`.
  useEffect(() => {
    const el = scrollStripRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      if (el.scrollWidth <= el.clientWidth + 1) return;
      let delta = event.deltaY;
      if (event.deltaMode === 1) delta *= 16;
      if (event.deltaMode === 2) delta *= el.clientWidth;
      const prevLeft = el.scrollLeft;
      el.scrollLeft += delta;
      if (el.scrollLeft !== prevLeft) {
        event.preventDefault();
      }
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
    };
  }, []);

  const handleContextMenuCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!shouldOpenStatusBarContextMenu(event.target)) {
      return;
    }
    event.preventDefault();
    const menuWidth = 192;
    const menuHeight = 180;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    const x = Math.max(8, Math.min(event.clientX, vw - menuWidth - 8));
    const y = Math.max(8, Math.min(event.clientY - menuHeight, vh - menuHeight - 8));
    setContextMenu({ x, y });
  }, []);

  const handleUsageOpenChange = useCallback(
    (open: boolean) => {
      setUsageOpen(open);
      if (open) {
        const nextWindow = makeWindow(7, undefined, "day");
        setUsageWindow(nextWindow);
      }
    },
    [],
  );

  const handlePortsOpenChange = useCallback(
    (open: boolean) => {
      setPortsOpen(open);
      if (open) {
        void runtime?.refreshSystemPorts(activeWorkspaceRoot ?? undefined);
      } else {
        setOverridePortsWorkspace(null);
      }
    },
    [activeWorkspaceRoot, runtime],
  );

  const handleResourcesOpenChange = useCallback(
    (open: boolean) => {
      setResourcesOpen(open);
      if (open) {
        void fetchLiveResources({ forceRefresh: true, showSpinner: false });
      }
    },
    [fetchLiveResources],
  );

  const handleOpenPortUrl = useCallback((url: string) => {
    try {
      const api = ensureLocalApi();
      void api.shell.openExternal(url).catch(() => {
        window.open(url, "_blank", "noopener,noreferrer");
      });
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, []);

  const portsCount = runtime?.portsState.ports.length ?? 0;
  const primaryUsage = usageSummary.primaryWindow;
  const antigravityPrimary = usageSummary.antigravityEntries[0] ?? null;
  const { telemetry: usageTelemetry } = usageSummary;

  const effectiveResourcesLoading = manualResourcesLoading || Boolean(runtime?.resourcesLoading);
  const effectiveResourcesError = liveResourcesError ?? runtime?.resourcesError ?? null;

  return (
    <footer
      role="contentinfo"
      aria-label="Prismux 状态栏"
      data-prismux-status-bar="true"
      data-pmx-glass-zone="shellFrame"
      onContextMenuCapture={handleContextMenuCapture}
      className={cn(
        "relative z-[45] flex h-[var(--pmx-status-bar-height,20px)] w-full shrink-0 select-none items-center overflow-clip [overflow-clip-margin:3px] text-[10.5px] leading-none text-foreground",
        // Monolithic shellFrame surface: solid bg-sidebar in non-glass modes, delegated to glass bridge in Liquid Glass mode.
        "bg-sidebar [[data-pmx-glass='1']_&]:bg-transparent",
        "[@media(prefers-reduced-transparency:reduce)]:bg-sidebar [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none",
        "[html[data-prismux-gpu='0']_&]:bg-sidebar [html[data-prismux-gpu='0']_&]:backdrop-blur-none",
        "[@media(forced-colors:active)]:bg-[Canvas] [@media(forced-colors:active)]:text-[CanvasText]",
      )}
    >
      <div
        ref={scrollStripRef}
        data-testid="prismux-status-bar-strip"
        className="flex h-full min-w-0 flex-1 items-center justify-between gap-1.5 overflow-x-auto overflow-y-hidden px-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {/* Left Zone: Compliant Quota & Local Usage Telemetry */}
        <div className="flex h-full shrink-0 items-center gap-1">
          {visibility.usage ? (
            <Popover open={usageOpen} onOpenChange={handleUsageOpenChange}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    data-testid="status-bar-usage-trigger"
                    aria-label="打开额度与用量统计详情"
                    className={cn(
                      "inline-flex h-4 cursor-pointer items-center gap-1 rounded-sm px-1.5 font-medium tabular-nums transition-colors hover:bg-accent/70 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                      primaryUsage?.urgency === "critical"
                        ? "text-red-700 dark:text-red-300"
                        : primaryUsage?.urgency === "warning"
                          ? "text-amber-700 dark:text-amber-300"
                          : "text-foreground",
                    )}
                  />
                }
              >
                {primaryUsage ? (
                  <>
                    <GaugeIcon aria-hidden className="size-[11px] shrink-0" />
                    <span className="max-w-28 truncate">{primaryUsage.providerName}</span>
                    <span>{formatCompactUsageWindowValue(primaryUsage, usagePrefs.percentMode)}</span>
                  </>
                ) : usageTelemetry.todayTokens > 0 ? (
                  <>
                    <GaugeIcon aria-hidden className="size-[11px] shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span>今日 {formatCompactUsageTokens(usageTelemetry.todayTokens)}</span>
                  </>
                ) : usageTelemetry.weekTokens > 0 ? (
                  <>
                    <GaugeIcon aria-hidden className="size-[11px] shrink-0 text-foreground/80" />
                    <span>7日 {formatCompactUsageTokens(usageTelemetry.weekTokens)}</span>
                  </>
                ) : antigravityPrimary ? (
                  <>
                    <ShieldCheckIcon
                      aria-hidden
                      className="size-[11px] shrink-0 text-emerald-600 dark:text-emerald-400"
                    />
                    <span className="max-w-36 truncate">
                      {antigravityPrimary.tierLabel
                        ? `AGY · ${antigravityPrimary.tierLabel}`
                        : "AGY · ACP"}
                    </span>
                  </>
                ) : usageSummary.enabledProviderCount > 0 ? (
                  <>
                    <GaugeIcon aria-hidden className="size-[11px] shrink-0 text-muted-foreground" />
                    <span>用量 · {usageSummary.enabledProviderCount} 提供方</span>
                  </>
                ) : (
                  <>
                    <GaugeIcon aria-hidden className="size-[11px] shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">额度 —</span>
                  </>
                )}
              </PopoverTrigger>
              <PopoverPopup
                {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
                side="top"
                align="start"
                sideOffset={8}
                padding="none"
                data-pmx-glass-zone="overlays"
                data-pmx-status-popover="1"
                className={STATUS_POPOVER_POPUP_CLASS}
              >
                <UsageStatusPopover
                  summary={usageSummary}
                  activeThreadIsAntigravity={activeThreadProvider?.driver === "antigravity"}
                  contextGauge={contextGauge}
                  prefs={usagePrefs}
                  onPrefsChange={handleUsagePrefsChange}
                  now={now}
                  loading={usageRefreshing || usageView.isPending}
                  onRefresh={handleRefreshUsage}
                  onClose={() => setUsageOpen(false)}
                  embeddedInPopover
                />
              </PopoverPopup>
            </Popover>
          ) : null}
        </div>

        {/* Right Zone: Keep Awake Capsule + Ports Capsule + CPU/RAM Capsule */}
        <div className="flex h-full shrink-0 items-center gap-1">
          {visibility.keepAwake ? (
            <Popover open={keepAwakeOpen} onOpenChange={handleKeepAwakeOpenChange}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    data-testid="status-bar-keep-awake-trigger"
                    data-keep-awake-mode={keepAwakeState.mode}
                    data-keep-awake-active={
                      keepAwakeState.shouldPreventSleep && keepAwakeState.effectiveActive
                        ? "true"
                        : "false"
                    }
                    aria-label={keepAwakeState.ariaLabel}
                    className={cn(
                      "inline-flex h-4 cursor-pointer items-center gap-1 rounded-sm px-1.5 font-medium transition-colors hover:bg-accent/70 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                      keepAwakeState.visualTone === "active"
                        ? "text-amber-700 dark:text-amber-300"
                        : keepAwakeState.visualTone === "standby"
                          ? "text-foreground/85"
                          : "text-muted-foreground",
                    )}
                  />
                }
              >
                <CoffeeIcon
                  aria-hidden
                  className={cn(
                    "size-[11px] shrink-0 transition-colors",
                    keepAwakeState.visualTone === "active"
                      ? "text-amber-600 dark:text-amber-400"
                      : keepAwakeState.visualTone === "standby"
                        ? "text-foreground/75"
                        : "text-muted-foreground",
                  )}
                />
                <span>{keepAwakeState.pillLabel}</span>
                <span
                  aria-hidden
                  data-testid="status-bar-keep-awake-dot"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full transition-all",
                    keepAwakeState.visualTone === "active"
                      ? "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.85)] dark:bg-amber-400"
                      : keepAwakeState.visualTone === "standby"
                        ? "bg-muted-foreground/60"
                        : "bg-muted-foreground/35",
                  )}
                />
              </PopoverTrigger>
              <PopoverPopup
                {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
                side="top"
                align="end"
                sideOffset={8}
                padding="none"
                data-pmx-glass-zone="overlays"
                data-pmx-status-popover="1"
                className={STATUS_POPOVER_POPUP_CLASS}
              >
                <KeepAwakeStatusPopover
                  state={keepAwakeState}
                  onSelectMode={handleSelectKeepAwakeMode}
                  blockerId={keepAwakeNativeState?.blockerId ?? null}
                  error={keepAwakeError}
                  embeddedInPopover
                />
              </PopoverPopup>
            </Popover>
          ) : null}

          {visibility.ports ? (
            <Popover open={portsOpen} onOpenChange={handlePortsOpenChange}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    data-testid="status-bar-ports-trigger"
                    aria-label={`本机监听端口，共 ${portsCount} 个`}
                    className={cn(
                      "inline-flex h-4 cursor-pointer items-center gap-1 rounded-sm px-1.5 font-medium tabular-nums transition-colors hover:bg-accent/70 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                      portsCount > 0 ? "text-foreground" : "text-muted-foreground",
                    )}
                  />
                }
              >
                <NetworkIcon
                  aria-hidden
                  className={cn(
                    "size-[11px] shrink-0",
                    portsCount > 0 && "text-emerald-600 dark:text-emerald-400",
                  )}
                />
                <span>Ports ({portsCount})</span>
              </PopoverTrigger>
              <PopoverPopup
                {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
                side="top"
                align="end"
                sideOffset={8}
                padding="none"
                data-pmx-glass-zone="overlays"
                data-pmx-status-popover="1"
                className={STATUS_POPOVER_POPUP_CLASS}
              >
                <PortsStatusPopover
                  state={runtime?.portsState ?? { ports: [], loading: false, error: null, failureStreak: 0, lastScannedAt: null }}
                  activeWorkspaceRoot={activeWorkspaceRoot}
                  daemonReady={Boolean(runtime?.daemonInfo.ready)}
                  onRefresh={() =>
                    runtime?.refreshSystemPorts(activeWorkspaceRoot ?? undefined) ??
                    Promise.resolve()
                  }
                  onKillPort={(pid) =>
                    runtime
                      ? runtime.killSystemPort(pid)
                      : Promise.resolve({ ok: false, error: "Daemon 未连接" })
                  }
                  onOpenUrl={handleOpenPortUrl}
                  embeddedInPopover
                />
              </PopoverPopup>
            </Popover>
          ) : null}

          {visibility.resources ? (
            <Popover open={resourcesOpen} onOpenChange={handleResourcesOpenChange}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    data-testid="status-bar-resources-trigger"
                    aria-label="打开 CPU 与内存资源归因详情"
                    className="inline-flex h-4 cursor-pointer items-center gap-1 rounded-sm px-1.5 font-medium text-foreground tabular-nums transition-colors hover:bg-accent/70 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  />
                }
              >
                <CpuIcon aria-hidden className="size-[11px] shrink-0 text-muted-foreground" />
                <span>
                  CPU {formatCpuPercent(resourcesSummary.cpuPercent)} ·{" "}
                  {formatBytesCompact(resourcesSummary.memoryBytes)}
                </span>
              </PopoverTrigger>
              <PopoverPopup
                {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
                side="top"
                align="end"
                sideOffset={8}
                padding="none"
                data-pmx-glass-zone="overlays"
                data-pmx-status-popover="1"
                className={STATUS_POPOVER_POPUP_CLASS}
              >
                <ResourcesStatusPopover
                  raw={effectiveResources}
                  loading={effectiveResourcesLoading}
                  error={effectiveResourcesError}
                  daemonReady={Boolean(runtime?.daemonInfo.ready)}
                  onRefresh={() =>
                    fetchLiveResources({ forceRefresh: true, showSpinner: true })
                  }
                  onKillPty={async (sessionId) => {
                    if (!runtime) {
                      return { ok: false, sessionId, error: "Daemon 未连接" };
                    }
                    const res = await runtime.killStalePty(sessionId);
                    void fetchLiveResources({ forceRefresh: true, showSpinner: false });
                    return res;
                  }}
                  embeddedInPopover
                />
              </PopoverPopup>
            </Popover>
          ) : null}
        </div>
      </div>

      {/* Right-click segment visibility menu */}
      {contextMenu ? (
        <div
          ref={contextMenuRef}
          {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
          role="menu"
          aria-label="状态栏分段显隐设置"
          data-testid="prismux-status-bar-context-menu"
          data-pmx-glass-zone="overlays"
          data-pmx-status-popover="1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          className="fixed z-50 w-48 overflow-hidden rounded-xl border border-border bg-popover bg-clip-padding p-1 text-xs text-popover-foreground shadow-xl"
        >
          <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">
            状态栏分段显隐
          </div>
          {STATUS_BAR_SEGMENT_IDS.map((segmentId) => {
            const checked = visibility[segmentId];
            return (
              <button
                key={segmentId}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                onClick={() => handleToggleSegment(segmentId)}
                className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              >
                <span>{SEGMENT_LABELS[segmentId]}</span>
                <span
                  aria-hidden
                  className={cn(
                    "inline-flex size-3.5 items-center justify-center rounded-xs border",
                    checked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background",
                  )}
                >
                  {checked ? <CheckIcon className="size-2.5" /> : null}
                </span>
              </button>
            );
          })}
          <div className="my-1 border-t border-border/70" />
          <button
            type="button"
            role="menuitem"
            onClick={handleResetVisibility}
            className="flex w-full cursor-pointer items-center justify-center rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            恢复全部显示
          </button>
        </div>
      ) : null}
    </footer>
  );
}
