import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@prismux/client-runtime/environment";
import { refreshUsageLimits } from "@prismux/client-runtime/state/usage";
import {
  isListedThreadLineage,
  type PrismuxKeepAwakeState,
  type ProviderInstanceId,
  type ServerProvider,
} from "@prismux/core-contracts";
import { makeWindow } from "@prismux/core-shared/usageFormat";
import { useRouterState } from "@tanstack/react-router";
import {
  CheckIcon,
  CoffeeIcon,
  CpuIcon,
  GaugeIcon,
  NetworkIcon,
  RefreshCwIcon,
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
import { useStableCallback } from "~/hooks/useStableCallback";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import {
  brandProviderInstanceEntries,
  deriveProviderInstanceEntries,
  disambiguateProviderInstanceDisplayNames,
  orderProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "~/providerInstances";
import { useProject, useQuietThreadProjection, useQuietThreadShells } from "~/state/entities";
import { environmentPresentations } from "~/state/presentation";
import { serverEnvironment } from "~/state/server";
import { runningThreadKeepAliveAtom } from "~/state/threads";
import { useUsage } from "~/state/usage";
import { useAtomCommand } from "~/state/use-atom-command";
import { resolveThreadRouteRef } from "~/threadRoutes";
import { AgentBrandLogo } from "./agentBrand";
import type {
  DaemonOfficialQuotaSummaryResponse,
  DaemonSystemResourcesResponse,
} from "./daemonClient";
import { useOptionalPrismuxRuntime } from "./PrismuxRuntimeProvider";
import { useOptionalPrismuxTelemetry } from "./PrismuxTelemetryContext";
import { KeepAwakeStatusPopover } from "./statusBar/KeepAwakeStatusPopover";
import { PortsStatusPopover } from "./statusBar/PortsStatusPopover";
import {
  aggregateQuotaSummary,
  buildQuotaStatusBarDisplay,
  detectCompletedAntigravityTurns,
  isAntigravityEnabledAndAuthenticated,
  isAntigravityQuotaAuthAllowed,
  isUpstreamProviderQuotaEligible,
  loadQuotaPreferences,
  saveQuotaPreferences,
  shouldFetchAntigravityCreditsOnPopoverOpen,
  shouldRefreshAntigravityOnManualClick,
  shouldShowStatusBarQuota,
  shouldTriggerAntigravityColdStartFetch,
  type AgyTurnTrackerMemory,
  type DaemonOfficialQuotaCreditsResponse,
  type QuotaPreferences,
  type QuotaTone,
} from "./statusBar/quotaStatus.logic";
import { QuotaStatusPopover } from "./statusBar/QuotaStatusPopover";
import { ResourcesStatusPopover } from "./statusBar/ResourcesStatusPopover";
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
  isSameUsageWindow,
  resolveServerProviderUsageKind,
  STATUS_BAR_USAGE_AUTO_REFRESH_INTERVAL_MS,
  type PrismuxProviderProbeSnapshot,
} from "./statusBar/statusBarUsage";
import {
  DEFAULT_STATUS_BAR_VISIBILITY,
  loadStatusBarVisibility,
  saveStatusBarVisibility,
  STATUS_BAR_SEGMENT_IDS,
  toggleStatusBarSegment,
  type StatusBarSegmentId,
  type StatusBarVisibility,
} from "./statusBar/statusBarVisibility";
import { UsageStatusPopover } from "./statusBar/UsageStatusPopover";
import { useResetCountdownClock } from "./statusBar/useResetCountdownClock";
import { usePrismuxTraySync } from "./usePrismuxTraySync";

export { STATUS_BAR_USAGE_AUTO_REFRESH_INTERVAL_MS };
export const PRISMUX_STATUS_BAR_HEIGHT_PX = 20 as const;

const SEGMENT_LABELS: Readonly<Record<StatusBarSegmentId, string>> = {
  usage: "用量总览",
  quota: "实时额度",
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
const RESOURCES_IDLE_POLL_MS = 15_000;
const RESOURCES_EARLY_WARMUP_MS = 1_200;

const STATUS_POPOVER_POPUP_CLASS =
  "overflow-hidden rounded-xl border border-border bg-popover bg-clip-padding p-0 shadow-xl before:hidden";

function quotaMiniBarColorClass(tone: QuotaTone): string {
  switch (tone) {
    case "critical":
      return "bg-[#ef4444]";
    case "warning":
      return "bg-[#f59e0b]";
    default:
      return "bg-[#22c55e]";
  }
}

interface DaemonProvidersProbeResponse {
  readonly ok?: boolean;
  readonly providers?: readonly PrismuxProviderProbeSnapshot[];
}

export interface PrismuxStatusBarProps {
  /** Optional initial daemon quota snapshot (primarily for deterministic UI tests). */
  readonly initialDaemonQuota?: DaemonOfficialQuotaSummaryResponse | null | undefined;
}

export function PrismuxStatusBar({ initialDaemonQuota = null }: PrismuxStatusBarProps = {}) {
  usePrismuxTraySync();
  const runtime = useOptionalPrismuxRuntime();
  const telemetry = useOptionalPrismuxTelemetry();
  const setSystemResourcesSnapshot = telemetry?.setSystemResourcesSnapshot;
  const setPortsPopoverOpen = telemetry?.setPortsPopoverOpen;
  const refreshSystemResourcesAction =
    telemetry?.refreshSystemResources ?? runtime?.refreshSystemResources;
  const refreshSystemPortsAction = telemetry?.refreshSystemPorts ?? runtime?.refreshSystemPorts;
  const scrollStripRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const [visibility, setVisibility] = useState<StatusBarVisibility>(() =>
    loadStatusBarVisibility(),
  );
  const [quotaPrefs, setQuotaPrefs] = useState<QuotaPreferences>(() => loadQuotaPreferences());
  const [usageOpen, setUsageOpen] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [quotaPopoverSession, setQuotaPopoverSession] = useState(0);
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
  const usageRefreshInflightRef = useRef<Promise<void> | null>(null);
  const [providerProbeSnapshots, setProviderProbeSnapshots] = useState<
    readonly PrismuxProviderProbeSnapshot[]
  >([]);
  const providerProbeInflightRef = useRef<Promise<void> | null>(null);
  const [daemonQuota, setDaemonQuota] = useState<DaemonOfficialQuotaSummaryResponse | null>(
    initialDaemonQuota,
  );
  const daemonQuotaRef = useRef<DaemonOfficialQuotaSummaryResponse | null>(initialDaemonQuota);
  const [agyCredits, setAgyCredits] = useState<DaemonOfficialQuotaCreditsResponse | null>(null);
  const agyCreditsRef = useRef<DaemonOfficialQuotaCreditsResponse | null>(null);
  const [agyCreditsLoading, setAgyCreditsLoading] = useState(false);
  const [quotaRefreshing, setQuotaRefreshing] = useState(false);
  const [quotaMinuteTick, setQuotaMinuteTick] = useState<number>(() => Date.now());
  const quotaOpenRef = useRef<boolean>(false);
  const agyQuotaInflightRef = useRef<Promise<void> | null>(null);
  const agyCreditsInflightRef = useRef<Promise<void> | null>(null);
  const agyQuotaRequestGenRef = useRef<number>(0);
  const agyCreditsRequestGenRef = useRef<number>(0);
  const agyColdStartFetchedRef = useRef<boolean>(false);
  const agyTurnMemoryRef = useRef<AgyTurnTrackerMemory | null>(null);
  const prevAgyAuthAllowedRef = useRef<boolean | null>(null);
  const prevNonAgyProviderAuthSignatureRef = useRef<string | null>(null);

  // Resolve current route thread & workspace root without touching ChatView.
  const routeParams = useRouterState({
    select: (state) => {
      const params = state.matches.at(-1)?.params as
        | Partial<Record<"environmentId" | "threadId", string | undefined>>
        | undefined;
      return {
        environmentId: params?.environmentId ?? "",
        threadId: params?.threadId ?? "",
      };
    },
    structuralSharing: true,
  });
  const activeThreadRef = useMemo(
    () => resolveThreadRouteRef(routeParams),
    [routeParams.environmentId, routeParams.threadId],
  );
  const serverThreadProjection = useQuietThreadProjection(activeThreadRef);
  const serverProjection = serverThreadProjection?.projection ?? null;
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

  // Quiet thread shells across environments (held through streaming ticks) to detect interactive AGY turn completion.
  const threadShells = useQuietThreadShells();

  // Collect providers & configured SSOT branding/order across connected environments.
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const { allProviders, statusBarProviderDisplayOptions } = useMemo(() => {
    const providersList: ServerProvider[] = [];
    const configuredEntries: ProviderInstanceEntry[] = [];
    const mergedOrder: ProviderInstanceId[] = [];
    const seenOrderIds = new Set<ProviderInstanceId>();
    for (const presentation of presentations.values()) {
      const config = presentation.serverConfig;
      const providers = config?.providers;
      const providerOrder = config?.settings?.providerOrder;
      if (Array.isArray(providerOrder)) {
        for (const id of providerOrder) {
          if (!seenOrderIds.has(id)) {
            seenOrderIds.add(id);
            mergedOrder.push(id);
          }
        }
      }
      if (Array.isArray(providers)) {
        providersList.push(...providers);
        const derived = deriveProviderInstanceEntries(providers);
        const branded = config?.settings
          ? brandProviderInstanceEntries(derived, config.settings)
          : derived;
        const ordered = orderProviderInstanceEntries(branded, providerOrder);
        configuredEntries.push(...disambiguateProviderInstanceDisplayNames(ordered));
      }
    }
    return {
      allProviders: providersList,
      statusBarProviderDisplayOptions: {
        entries: configuredEntries,
        providerOrder: mergedOrder,
      },
    };
  }, [presentations]);

  // 7-day local usage summary (also exposes today's bucket) for custom-endpoint & all providers.
  const [usageWindow, setUsageWindow] = useState(() => makeWindow(7, undefined, "day"));
  const usageView = useUsage(usageWindow);
  const mergedUsage = usageView.shown?.merged ?? usageView.merged;
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });

  const quotaResetTimes = useMemo(() => {
    const times: number[] = [];
    const agyAllowed = isAntigravityQuotaAuthAllowed(allProviders);
    const agySnapshot = daemonQuota?.antigravity;
    const agyWindows =
      agyAllowed && agySnapshot?.status === "ok" && agySnapshot.available
        ? agySnapshot.windows
        : undefined;
    if (Array.isArray(agyWindows)) {
      for (const win of agyWindows) {
        if (typeof win.resetAtMs === "number" && Number.isFinite(win.resetAtMs)) {
          times.push(win.resetAtMs);
        } else if (typeof win.resetAtIso === "string" && win.resetAtIso.trim()) {
          const parsed = Date.parse(win.resetAtIso);
          if (Number.isFinite(parsed)) {
            times.push(parsed);
          }
        }
      }
    }
    for (const provider of allProviders) {
      if (provider.driver === "antigravity" || !isUpstreamProviderQuotaEligible(provider)) {
        continue;
      }
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
  }, [allProviders, daemonQuota]);

  // Boundary-scheduled countdown clock (Orca `useResetCountdownClock`): ticks only at exact reset boundaries while popover is open.
  const resetClockNow = useResetCountdownClock(quotaOpen, quotaResetTimes);
  const quotaNow = Math.max(resetClockNow, quotaMinuteTick);

  useEffect(() => {
    if (!quotaOpen) return;
    setQuotaMinuteTick(Date.now());
    const timer = setInterval(() => {
      setQuotaMinuteTick(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, [quotaOpen]);

  const configuredProbeProviderIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const provider of allProviders) {
      if (!provider.enabled) continue;
      const kind = resolveServerProviderUsageKind(
        provider,
        statusBarProviderDisplayOptions.entries,
      );
      const normalized = kind.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      ids.push(normalized);
    }
    ids.sort();
    return ids;
  }, [allProviders, statusBarProviderDisplayOptions.entries]);

  const fetchProviderProbeSnapshots = useCallback(
    async (refresh = false) => {
      if (!runtime?.daemonInfo.ready) return;
      if (typeof runtime.daemon?.requestJson !== "function") return;
      if (providerProbeInflightRef.current && !refresh) {
        await providerProbeInflightRef.current;
        return;
      }
      const params = new URLSearchParams();
      if (refresh) params.set("refresh", "1");
      if (configuredProbeProviderIds.length > 0) {
        params.set("providers", configuredProbeProviderIds.join(","));
      }
      const qs = params.toString();
      const endpoint = qs ? `/v1/providers/probe?${qs}` : "/v1/providers/probe";
      const run = runtime.daemon.requestJson<DaemonProvidersProbeResponse>(endpoint).then(
        (response) => {
          if (Array.isArray(response?.providers)) {
            setProviderProbeSnapshots(response.providers);
          }
        },
        () => {
          // Keep previous snapshots / ServerProvider fallback if daemon probe is temporarily unavailable.
        },
      );
      providerProbeInflightRef.current = run;
      try {
        await run;
      } finally {
        if (providerProbeInflightRef.current === run) {
          providerProbeInflightRef.current = null;
        }
      }
    },
    [configuredProbeProviderIds, runtime?.daemon, runtime?.daemonInfo.ready],
  );

  // Lightweight single-shot `/v1/providers/probe` read on mount/daemon-ready (zero polling timer).
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- Fetches authoritative provider auth probe snapshot once when local daemon becomes ready.
  useEffect(() => {
    if (!runtime?.daemonInfo.ready) return;
    void fetchProviderProbeSnapshots(false);
  }, [fetchProviderProbeSnapshots, runtime?.daemonInfo.ready]);

  const usageSummary = useMemo(
    () =>
      collectStatusBarUsageSummary(
        allProviders,
        quotaNow,
        mergedUsage,
        usageWindow.untilDay,
        providerProbeSnapshots,
        statusBarProviderDisplayOptions,
      ),
    [
      allProviders,
      mergedUsage,
      providerProbeSnapshots,
      quotaNow,
      statusBarProviderDisplayOptions,
      usageWindow.untilDay,
    ],
  );
  const quotaSummary = useMemo(
    () =>
      aggregateQuotaSummary(
        daemonQuota,
        allProviders,
        quotaNow,
        agyCredits,
        statusBarProviderDisplayOptions,
      ),
    [agyCredits, allProviders, daemonQuota, quotaNow, statusBarProviderDisplayOptions],
  );
  const quotaDisplay = useMemo(
    () => buildQuotaStatusBarDisplay(quotaSummary, quotaPrefs),
    [quotaPrefs, quotaSummary],
  );
  const showQuotaCapsule =
    shouldShowStatusBarQuota(quotaSummary, visibility.quota) && quotaDisplay !== null;

  // Close the quota popover cleanly if all authenticated providers log out or lose live quota.
  if (!showQuotaCapsule && quotaOpen) {
    quotaOpenRef.current = false;
    setQuotaOpen(false);
  }

  // Prefer whichever resources snapshot is newer between telemetry context and live status-bar sampling.
  const effectiveResources = useMemo(() => {
    const ctxRes = telemetry?.systemResources ?? runtime?.systemResources ?? null;
    if (!liveResources) return ctxRes;
    if (!ctxRes) return liveResources;
    const liveTs = liveResources.collectedAt ?? liveResources.sampledAt ?? 0;
    const ctxTs = ctxRes.collectedAt ?? ctxRes.sampledAt ?? 0;
    return liveTs >= ctxTs ? liveResources : ctxRes;
  }, [liveResources, runtime?.systemResources, telemetry?.systemResources]);

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

    const nav =
      typeof navigator !== "undefined" ? (navigator as unknown as NavigatorWithWakeLock) : null;
    if (!nav?.wakeLock || typeof nav.wakeLock.request !== "function") {
      setWebWakeLockActive(false);
      return;
    }

    let cancelled = false;
    const requestWebLock = async () => {
      if (cancelled || (typeof document !== "undefined" && document.visibilityState === "hidden")) {
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
    setUsageOpen(false);
    setQuotaOpen(false);
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

  const daemonReady = Boolean(runtime?.daemonInfo.ready);
  const daemonClient = runtime?.daemon ?? null;
  const fetchLiveResources = useCallback(
    async (options: { forceRefresh: boolean; showSpinner: boolean }) => {
      if (!daemonReady) return;
      if (options.showSpinner) {
        setManualResourcesLoading(true);
      }
      try {
        if (typeof daemonClient?.fetchSystemResources === "function") {
          const res = await daemonClient.fetchSystemResources(options.forceRefresh);
          setLiveResources(res);
          setSystemResourcesSnapshot?.(res);
          setLiveResourcesError(null);
        } else {
          await refreshSystemResourcesAction?.();
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
    [daemonClient, daemonReady, refreshSystemResourcesAction, setSystemResourcesSnapshot],
  );

  // Silent live resource polling: ONLY runs when `visibility.resources` is enabled OR Resources popover is open
  // (3s while popover open, 15s while segment visible, completely stopped when hidden/disabled/occluded).
  const shouldPollResources = visibility.resources || resourcesOpen;
  useEffect(() => {
    if (!runtime?.daemonInfo.ready || runtime.occluded || !shouldPollResources) return;
    let cancelled = false;

    const silentPoll = () => {
      if (cancelled || (typeof document !== "undefined" && document.visibilityState === "hidden")) {
        return;
      }
      void fetchLiveResources({ forceRefresh: false, showSpinner: false });
    };

    // Fast follow-up right after daemon boot so post-warmup Electron & CPU% deltas appear within ~1.2s.
    const warmupTimer = setTimeout(silentPoll, RESOURCES_EARLY_WARMUP_MS);
    const intervalMs = resourcesOpen ? RESOURCES_OPEN_POLL_MS : RESOURCES_IDLE_POLL_MS;
    const pollTimer = setInterval(silentPoll, intervalMs);

    return () => {
      cancelled = true;
      clearTimeout(warmupTimer);
      clearInterval(pollTimer);
    };
  }, [
    fetchLiveResources,
    resourcesOpen,
    runtime?.daemonInfo.ready,
    runtime?.occluded,
    shouldPollResources,
  ]);

  // Gate Ports polling in PrismuxTelemetryProvider strictly on Ports popover open.
  useEffect(() => {
    setPortsPopoverOpen?.(portsOpen);
    return () => {
      setPortsPopoverOpen?.(false);
    };
  }, [portsOpen, setPortsPopoverOpen]);

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
    void refreshSystemPortsAction?.(portsPopoverRequest.workspace ?? undefined);
  }, [portsPopoverRequest, refreshSystemPortsAction]);

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

  const handleQuotaPrefsChange = useCallback((next: QuotaPreferences) => {
    setQuotaPrefs(next);
    saveQuotaPreferences(next);
  }, []);

  const agyEnabledAndAuthenticated = isAntigravityEnabledAndAuthenticated(allProviders);
  const agyAuthAllowed = isAntigravityQuotaAuthAllowed(allProviders);

  // AGY-ONLY lazy `/v1/quota/summary` fetcher (never spawns `/credits`, never touches Codex/Claude).
  const fetchAntigravityQuotaSummary = useStableCallback(async (force: boolean = false) => {
    if (!runtime?.daemonInfo.ready) return;
    const hasFetchMethod = typeof runtime.daemon?.fetchQuotaSummary === "function";
    const hasRequestJson = typeof runtime.daemon?.requestJson === "function";
    if (!hasFetchMethod && !hasRequestJson) return;
    if (agyQuotaInflightRef.current && !force) {
      await agyQuotaInflightRef.current;
      return;
    }
    const requestGen = ++agyQuotaRequestGenRef.current;
    // Use SWR fast-return when refreshing a previously populated non-forced snapshot so cached quota renders immediately.
    const requestPromise =
      !force && daemonQuotaRef.current !== null && hasRequestJson
        ? runtime.daemon.requestJson<DaemonOfficialQuotaSummaryResponse>("/v1/quota/summary?swr=1")
        : hasFetchMethod
          ? runtime.daemon.fetchQuotaSummary(force)
          : runtime.daemon.requestJson<DaemonOfficialQuotaSummaryResponse>(
              force ? "/v1/quota/summary?force=1" : "/v1/quota/summary",
            );
    const run = requestPromise.then(
      (snapshot) => {
        if (requestGen < agyQuotaRequestGenRef.current) return;
        daemonQuotaRef.current = snapshot;
        setDaemonQuota(snapshot);
        setQuotaMinuteTick(Date.now());
        if (!snapshot.antigravity.available || snapshot.antigravity.status !== "ok") {
          agyCreditsRef.current = null;
          setAgyCredits(null);
        }
      },
      () => {
        // Keep last-known cached quota visible on transient errors so the open popover never snaps shut.
      },
    );
    agyQuotaInflightRef.current = run;
    try {
      await run;
    } finally {
      if (agyQuotaInflightRef.current === run) {
        agyQuotaInflightRef.current = null;
      }
    }
  });

  // AGY-ONLY on-demand `/v1/quota/credits` fetcher (invoked ONLY when user opens QuotaStatusPopover or manually refreshes while open).
  const fetchAntigravityCredits = useStableCallback(async (force: boolean = false) => {
    if (!runtime?.daemonInfo.ready) return;
    if (typeof runtime.daemon?.requestJson !== "function") return;
    if (agyCreditsInflightRef.current && !force) {
      await agyCreditsInflightRef.current;
      return;
    }
    const requestGen = ++agyCreditsRequestGenRef.current;
    setAgyCreditsLoading(true);
    const suffix = force ? "?force=1" : agyCreditsRef.current !== null ? "?swr=1" : "";
    const run = runtime.daemon
      .requestJson<DaemonOfficialQuotaCreditsResponse>(`/v1/quota/credits${suffix}`)
      .then(
        (credits) => {
          if (requestGen < agyCreditsRequestGenRef.current) return;
          if (credits.status === "unauthenticated" || credits.status === "not_installed") {
            daemonQuotaRef.current = null;
            agyCreditsRef.current = null;
            setDaemonQuota(null);
            setAgyCredits(null);
            agyColdStartFetchedRef.current = false;
            return;
          }
          agyCreditsRef.current = credits;
          setAgyCredits(credits);
        },
        () => {
          // Credits hydration is best-effort; never disrupt `/usage` display.
        },
      )
      .finally(() => {
        if (requestGen === agyCreditsRequestGenRef.current) {
          setAgyCreditsLoading(false);
        }
      });
    agyCreditsInflightRef.current = run;
    try {
      await run;
    } finally {
      if (agyCreditsInflightRef.current === run) {
        agyCreditsInflightRef.current = null;
      }
    }
  });

  // Upstream non-AGY providers (Claude Code / Codex / OpenCode / DSH): 100% unchanged real-time refresh.
  const refreshUpstreamProvidersQuota = useStableCallback(async () => {
    const tasks: Array<Promise<unknown>> = [];
    for (const [environmentId, presentation] of presentations) {
      if (presentation.connection.phase !== "connected" || presentation.serverConfig === null) {
        continue;
      }
      tasks.push(
        refreshUsageLimits(
          environmentId,
          () => refreshProviders({ environmentId, input: {} }),
          false,
        ),
      );
    }
    if (tasks.length > 0) {
      await Promise.allSettled(tasks);
    }
  });

  // Trigger 3 (Manual user refresh click): refreshes upstream providers + AGY `/v1/quota/summary?force=1`
  // in parallel ONLY if AGY is enabled & authenticated. If the popover is open and `/usage` succeeds,
  // hydrates `/v1/quota/credits?force=1` sequentially afterward (never concurrently with `/usage`).
  const handleRefreshQuota = async (_force = true) => {
    setQuotaRefreshing(true);
    try {
      const shouldRefreshAgy =
        Boolean(runtime?.daemonInfo.ready) && shouldRefreshAntigravityOnManualClick(allProviders);
      const tasks: Array<Promise<unknown>> = [refreshUpstreamProvidersQuota()];
      if (shouldRefreshAgy) {
        tasks.push(
          fetchAntigravityQuotaSummary(true).then(() => {
            const latest = daemonQuotaRef.current;
            if (
              quotaOpenRef.current &&
              latest?.antigravity.available &&
              latest.antigravity.status === "ok"
            ) {
              return fetchAntigravityCredits(true);
            }
            return undefined;
          }),
        );
      }
      await Promise.allSettled(tasks);
      setQuotaMinuteTick(Date.now());
    } finally {
      setQuotaRefreshing(false);
    }
  };

  // Immediate AGY logout/disable cache clearing + Trigger 1 (Cold Start Once when AGY is enabled & authenticated).
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- Synchronizes local Daemon AGY quota cache with live auth state and performs one-shot cold start fetch.
  useEffect(() => {
    const prevAllowed = prevAgyAuthAllowedRef.current;
    prevAgyAuthAllowedRef.current = agyAuthAllowed;

    if (!agyAuthAllowed) {
      agyColdStartFetchedRef.current = false;
      const hasFrontendAgyCache = daemonQuotaRef.current !== null || agyCreditsRef.current !== null;
      const clearFrontendAgyCache = () => {
        if (daemonQuotaRef.current !== null) {
          daemonQuotaRef.current = null;
          setDaemonQuota(null);
        }
        if (agyCreditsRef.current !== null) {
          agyCreditsRef.current = null;
          setAgyCredits(null);
        }
      };
      if (
        prevAllowed === true &&
        runtime?.daemonInfo.ready &&
        typeof runtime.daemon?.requestJson === "function"
      ) {
        void runtime.daemon
          .requestJson("/v1/quota/invalidate", { method: "POST" })
          .catch(() => {})
          .finally(clearFrontendAgyCache);
      } else if (hasFrontendAgyCache) {
        queueMicrotask(clearFrontendAgyCache);
      }
      return;
    }

    if (!agyEnabledAndAuthenticated) {
      agyColdStartFetchedRef.current = false;
      return;
    }

    if (
      shouldTriggerAntigravityColdStartFetch({
        daemonReady: Boolean(runtime?.daemonInfo.ready),
        hasTriggeredColdStart: agyColdStartFetchedRef.current,
        upstreamProviders: allProviders,
      })
    ) {
      agyColdStartFetchedRef.current = true;
      void fetchAntigravityQuotaSummary(false);
    }
  }, [
    agyAuthAllowed,
    agyEnabledAndAuthenticated,
    allProviders,
    fetchAntigravityQuotaSummary,
    runtime?.daemon,
    runtime?.daemonInfo.ready,
  ]);

  // Trigger 2 (After Human AGY Turn Ends): detect interactive desktop AGY thread finishing a turn
  // (running/streaming -> completed/idle) and trigger a single lazy `/v1/quota/summary?force=1`.
  // Strictly ignores Codex, Claude Code, OpenCode, DSH, and non-interactive subagent threads.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- Triggers external Daemon AGY quota refresh strictly when an interactive AGY thread completes a turn.
  useEffect(() => {
    const result = detectCompletedAntigravityTurns(
      agyTurnMemoryRef.current,
      threadShells.map((shell) => ({
        key: `${shell.environmentId}:${shell.id}`,
        providerInstanceId: shell.providerInstanceId,
        runtimeProviderInstanceId: shell.runtime?.providerInstanceId ?? null,
        modelInstanceId: shell.modelSelection?.instanceId ?? null,
        status: shell.runtime?.status ?? shell.source.status,
        latestRunStatus: shell.latestRun?.status ?? null,
        isInteractive:
          isListedThreadLineage(shell.lineage) &&
          shell.archivedAt === null &&
          shell.deletedAt === null,
      })),
      allProviders,
    );
    agyTurnMemoryRef.current = result.memory;

    if (
      result.shouldRefreshAntigravityQuota &&
      agyEnabledAndAuthenticated &&
      runtime?.daemonInfo.ready
    ) {
      void fetchAntigravityQuotaSummary(true);
    }
  }, [
    agyEnabledAndAuthenticated,
    allProviders,
    fetchAntigravityQuotaSummary,
    runtime?.daemonInfo.ready,
    threadShells,
  ]);

  // Preserve real-time upstream refresh when non-AGY providers (Claude Code / Codex / etc.) change auth/enabled state.
  const nonAgyProviderAuthSignature = allProviders
    .filter((provider) => provider.driver !== "antigravity")
    .map(
      (provider) =>
        `${provider.instanceId}:${provider.driver}:${provider.enabled ? 1 : 0}:${provider.installed === false ? 0 : 1}:${provider.status}:${provider.auth?.status ?? "none"}`,
    )
    .sort()
    .join("|");

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- Refreshes external upstream Codex/Claude usage limits when non-AGY provider auth state changes.
  useEffect(() => {
    const prevSignature = prevNonAgyProviderAuthSignatureRef.current;
    prevNonAgyProviderAuthSignatureRef.current = nonAgyProviderAuthSignature;
    if (prevSignature === null || prevSignature === nonAgyProviderAuthSignature) {
      return;
    }
    if (!runtime?.occluded) {
      void refreshUpstreamProvidersQuota();
    }
  }, [nonAgyProviderAuthSignature, refreshUpstreamProvidersQuota, runtime?.occluded]);

  const runUsageRefresh = useStableCallback(async (mode: "manual" | "auto") => {
    if (usageRefreshInflightRef.current) {
      if (mode === "auto") return;
      await usageRefreshInflightRef.current;
      return;
    }
    const nextWindow = makeWindow(7, undefined, "day");
    setUsageWindow((prev) => (isSameUsageWindow(prev, nextWindow) ? prev : nextWindow));
    if (mode === "manual") {
      setUsageRefreshing(true);
    }
    const run = usageView
      .refresh(nextWindow, {
        pricingRefreshMode: mode === "manual" ? "background" : "skip",
      })
      .catch(() => {})
      .finally(() => {
        if (usageRefreshInflightRef.current === run) {
          usageRefreshInflightRef.current = null;
        }
        if (mode === "manual") {
          setUsageRefreshing(false);
        }
      });
    usageRefreshInflightRef.current = run;
    if (mode === "manual") {
      // Refresh provider auth metadata in background without stalling immediate token hot-reload.
      void fetchProviderProbeSnapshots(false);
    }
    await run;
  });

  const handleRefreshUsage = async () => {
    await runUsageRefresh("manual");
  };

  // Periodic local Today/7-day token telemetry auto-refresh every 30 minutes (never touches quota endpoints).
  const runScheduledUsageRefresh = useStableCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    void runUsageRefresh("auto");
  });

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- Schedules the 30-minute local usage telemetry auto-refresh timer while the status bar usage segment is visible.
  useEffect(() => {
    if (!visibility.usage || runtime?.occluded) return;
    const timer = setInterval(runScheduledUsageRefresh, STATUS_BAR_USAGE_AUTO_REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [runScheduledUsageRefresh, runtime?.occluded, visibility.usage]);

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

  const handleUsageOpenChange = (open: boolean) => {
    setUsageOpen(open);
    if (open) {
      setQuotaOpen(false);
      quotaOpenRef.current = false;
      setKeepAwakeOpen(false);
      setPortsOpen(false);
      setResourcesOpen(false);
      const nextWindow = makeWindow(7, undefined, "day");
      setUsageWindow((prev) => (isSameUsageWindow(prev, nextWindow) ? prev : nextWindow));
      void fetchProviderProbeSnapshots(false);
    }
  };

  const handleQuotaOpenChange = (open: boolean) => {
    setQuotaOpen(open);
    quotaOpenRef.current = open;
    if (open) {
      setQuotaPopoverSession((seq) => seq + 1);
      setUsageOpen(false);
      setKeepAwakeOpen(false);
      setPortsOpen(false);
      setResourcesOpen(false);
      const openedAt = Date.now();
      setQuotaMinuteTick(openedAt);
      // On-demand `/v1/quota/credits`: hydrate credit balance ONLY when user opens
      // QuotaStatusPopover and AGY is authenticated; skip redundant re-fetches while fresh.
      const existingCredits = agyCreditsRef.current;
      const creditsStillFresh =
        existingCredits !== null &&
        existingCredits.available &&
        existingCredits.cacheTtlMs > 0 &&
        openedAt - existingCredits.fetchedAt < existingCredits.cacheTtlMs;
      if (
        !creditsStillFresh &&
        runtime?.daemonInfo.ready &&
        shouldFetchAntigravityCreditsOnPopoverOpen(allProviders, daemonQuota)
      ) {
        void fetchAntigravityCredits(false);
      }
    }
  };

  const handlePortsOpenChange = useCallback(
    (open: boolean) => {
      setPortsOpen(open);
      if (open) {
        setUsageOpen(false);
        setQuotaOpen(false);
        void refreshSystemPortsAction?.(activeWorkspaceRoot ?? undefined);
      } else {
        setOverridePortsWorkspace(null);
      }
    },
    [activeWorkspaceRoot, refreshSystemPortsAction],
  );

  const handleResourcesOpenChange = useCallback(
    (open: boolean) => {
      setResourcesOpen(open);
      if (open) {
        setUsageOpen(false);
        setQuotaOpen(false);
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

  const activePortsState = telemetry?.portsState ?? runtime?.portsState;
  const portsCount = activePortsState?.ports.length ?? 0;
  const { telemetry: usageTelemetry } = usageSummary;

  const effectiveResourcesLoading =
    manualResourcesLoading || Boolean(telemetry?.resourcesLoading ?? runtime?.resourcesLoading);
  const effectiveResourcesError =
    liveResourcesError ?? telemetry?.resourcesError ?? runtime?.resourcesError ?? null;

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
        {/* Left Zone: Local Token Usage Overview + Standalone Official Quota Pill */}
        <div className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {visibility.usage ? (
            <Popover open={usageOpen} onOpenChange={handleUsageOpenChange}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    data-testid="status-bar-usage-trigger"
                    aria-label="打开用量总览详情"
                    className="inline-flex h-4 shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1.5 font-medium text-foreground tabular-nums transition-colors hover:bg-accent/70 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  />
                }
              >
                {usageTelemetry.todayTokens > 0 ? (
                  <>
                    <GaugeIcon
                      aria-hidden
                      className="size-[11px] shrink-0 text-emerald-600 dark:text-emerald-400"
                    />
                    <span>今日 {formatCompactUsageTokens(usageTelemetry.todayTokens)}</span>
                  </>
                ) : usageTelemetry.weekTokens > 0 ? (
                  <>
                    <GaugeIcon aria-hidden className="size-[11px] shrink-0 text-foreground/80" />
                    <span>7日 {formatCompactUsageTokens(usageTelemetry.weekTokens)}</span>
                  </>
                ) : usageSummary.enabledProviderCount > 0 ? (
                  <>
                    <GaugeIcon aria-hidden className="size-[11px] shrink-0 text-muted-foreground" />
                    <span>用量 · {usageSummary.enabledProviderCount} 提供方</span>
                  </>
                ) : (
                  <>
                    <GaugeIcon aria-hidden className="size-[11px] shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">用量总览</span>
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
                  loading={usageRefreshing || usageView.isPending}
                  onRefresh={handleRefreshUsage}
                  onClose={() => setUsageOpen(false)}
                  embeddedInPopover
                />
              </PopoverPopup>
            </Popover>
          ) : null}

          {showQuotaCapsule && quotaDisplay ? (
            <div
              data-testid="status-bar-quota-capsule"
              className="inline-flex h-4 min-w-0 max-w-full items-center overflow-hidden rounded-sm transition-colors hover:bg-accent/70"
            >
              <Popover open={quotaOpen} onOpenChange={handleQuotaOpenChange}>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      data-testid="status-bar-quota-trigger"
                      data-quota-bar-mode={quotaPrefs.viewMode}
                      data-quota-percent-mode={quotaPrefs.percentMode}
                      title={quotaDisplay.fullText}
                      aria-label={`打开实时额度详情：${quotaDisplay.fullText}`}
                      className={cn(
                        "inline-flex h-4 min-w-0 max-w-full cursor-pointer items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-l-sm pl-1.5 pr-1 font-medium tabular-nums active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                        quotaDisplay.tone === "critical"
                          ? "text-red-700 dark:text-red-300"
                          : quotaDisplay.tone === "warning"
                            ? "text-amber-700 dark:text-amber-300"
                            : "text-foreground",
                      )}
                    />
                  }
                >
                  <span className="shrink-0 text-muted-foreground">{quotaDisplay.modePrefix}</span>
                  <span className="inline-flex min-w-0 items-center gap-1.5 overflow-hidden">
                    {quotaDisplay.segments.map((segment, segIndex) => (
                      <span
                        key={segment.agentId}
                        data-testid={`status-bar-quota-segment-${segment.agentId}`}
                        className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap"
                      >
                        {segIndex > 0 ? (
                          <span aria-hidden className="shrink-0 text-muted-foreground/50">
                            |
                          </span>
                        ) : null}
                        <AgentBrandLogo provider={segment.brandProvider} size={11} />
                        {quotaDisplay.viewMode === "detailed" ? (
                          <span
                            aria-hidden
                            data-testid={`status-bar-quota-minibar-${segment.agentId}`}
                            className="inline-flex h-[5px] w-9 shrink-0 overflow-hidden rounded-full bg-black/[0.14] dark:bg-white/[0.16] [[data-pmx-glass='1']_&]:bg-white/20 [html:not(.dark)[data-pmx-glass='1']_&]:bg-black/15"
                          >
                            <span
                              data-testid={`status-bar-quota-minibar-fill-${segment.agentId}`}
                              className={cn(
                                "block h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none",
                                quotaMiniBarColorClass(segment.tone),
                              )}
                              style={{ width: `${segment.barWidthPercent}%` }}
                            />
                          </span>
                        ) : null}
                        <span className="inline-flex min-w-0 items-center gap-1 overflow-hidden">
                          {segment.windows.map((win, winIndex) => (
                            <span
                              key={win.id}
                              data-testid={`status-bar-quota-window-${win.id}`}
                              className="inline-flex shrink-0 items-center gap-1"
                            >
                              {winIndex > 0 ? (
                                <span aria-hidden className="text-muted-foreground/60">
                                  ·
                                </span>
                              ) : null}
                              <span
                                className={cn(
                                  win.tone === "critical"
                                    ? "text-red-700 dark:text-red-300"
                                    : win.tone === "warning"
                                      ? "text-amber-700 dark:text-amber-300"
                                      : undefined,
                                )}
                              >
                                {win.text}
                              </span>
                            </span>
                          ))}
                        </span>
                      </span>
                    ))}
                  </span>
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
                  <QuotaStatusPopover
                    key={quotaPopoverSession}
                    summary={quotaSummary}
                    prefs={quotaPrefs}
                    onPrefsChange={handleQuotaPrefsChange}
                    now={quotaNow}
                    loading={quotaRefreshing}
                    creditsLoading={agyCreditsLoading}
                    onRefresh={handleRefreshQuota}
                    embeddedInPopover
                  />
                </PopoverPopup>
              </Popover>

              <button
                type="button"
                data-testid="status-bar-quota-refresh"
                aria-label="立即刷新实时额度"
                title="立即刷新实时额度"
                disabled={quotaRefreshing}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleRefreshQuota(true);
                }}
                className="inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-r-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              >
                <RefreshCwIcon
                  aria-hidden
                  className={cn("size-[11px] shrink-0", quotaRefreshing && "animate-spin")}
                />
              </button>
            </div>
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
                  state={
                    activePortsState ?? {
                      ports: [],
                      loading: false,
                      error: null,
                      failureStreak: 0,
                      lastScannedAt: null,
                    }
                  }
                  activeWorkspaceRoot={activeWorkspaceRoot}
                  daemonReady={Boolean(runtime?.daemonInfo.ready)}
                  onRefresh={() =>
                    (telemetry ?? runtime)?.refreshSystemPorts(activeWorkspaceRoot ?? undefined) ??
                    Promise.resolve()
                  }
                  onKillPort={(pid) =>
                    (telemetry ?? runtime)
                      ? (telemetry ?? runtime)!.killSystemPort(pid)
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
                  onRefresh={() => fetchLiveResources({ forceRefresh: true, showSpinner: true })}
                  onKillPty={async (sessionId) => {
                    const target = telemetry ?? runtime;
                    if (!target) {
                      return { ok: false, sessionId, error: "Daemon 未连接" };
                    }
                    const res = await target.killStalePty(sessionId);
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
