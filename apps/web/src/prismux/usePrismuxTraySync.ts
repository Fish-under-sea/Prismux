import { useAtomValue } from "@effect/atom-react";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@prismux/client-runtime/environment";
import type {
  AdvertisedEndpoint,
  DesktopBridge,
  DesktopServerExposureState,
  PrismuxTrayActionPayload,
  ScopedThreadRef,
} from "@prismux/core-contracts";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getAppModalReturnThreadTarget,
  isAppModalPage,
} from "~/components/sidebar/mainAppLocation";
import { openPrismuxRemoteConnectDialog } from "~/components/cloud/prismuxRemoteConnect.logic";
import { toastManager } from "~/components/ui/toast";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import {
  ISSUES_PANEL_REF,
  PULL_REQUESTS_PANEL_REF,
  rightPanelHostRef,
  useRightPanelStore,
} from "~/rightPanelStore";
import { runningThreadKeepAliveAtom } from "~/state/threads";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  resolveThreadRouteRef,
} from "~/threadRoutes";
import { useOptionalPrismuxRuntime } from "./PrismuxRuntimeProvider";
import { countActiveRunningThreads } from "./statusBar/statusBarKeepAwake";
import { normalizeResourcesSummary } from "./statusBar/statusBarResources";

const TRAY_SYNC_THROTTLE_MS = 250;
const SENTINEL_PANEL_KEYS = new Set([
  scopedThreadKey(PULL_REQUESTS_PANEL_REF),
  scopedThreadKey(ISSUES_PANEL_REF),
]);

export function resolveTrayRunningAgentsCount(input: {
  readonly activeThreadCount: number;
  readonly activeAgentProcessCount: number;
}): number {
  const threads = Number.isFinite(input.activeThreadCount)
    ? Math.max(0, Math.floor(input.activeThreadCount))
    : 0;
  const processes = Number.isFinite(input.activeAgentProcessCount)
    ? Math.max(0, Math.floor(input.activeAgentProcessCount))
    : 0;
  // Deduplicate overlapping live thread runs and their own CLI agent subprocesses.
  return Math.max(threads, processes);
}

export function selectPreferredMobileAccessUrl(input: {
  readonly advertisedEndpoints?: ReadonlyArray<AdvertisedEndpoint> | null;
  readonly serverExposureState?: Pick<DesktopServerExposureState, "endpointUrl"> | null;
  readonly fallbackHttpUrl?: string | null;
}): string | null {
  const endpoints = input.advertisedEndpoints ?? [];
  const availableRemote = endpoints.filter(
    (endpoint) => endpoint.status !== "unavailable" && endpoint.reachability !== "loopback",
  );

  const rankedRemote =
    availableRemote.find((endpoint) => endpoint.isDefault) ??
    availableRemote.find((endpoint) => endpoint.reachability === "private-network") ??
    availableRemote.find((endpoint) => endpoint.reachability === "public") ??
    availableRemote.find((endpoint) => endpoint.reachability === "lan") ??
    availableRemote[0];

  const candidates = [
    rankedRemote?.httpBaseUrl,
    input.serverExposureState?.endpointUrl,
    endpoints.find((endpoint) => endpoint.reachability === "loopback")?.httpBaseUrl,
    input.fallbackHttpUrl,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.href.replace(/\/+$/u, "");
      }
    } catch {
      // Ignore malformed candidate URLs.
    }
  }

  return null;
}

async function resolveDesktopMobileAccessUrl(bridge: DesktopBridge): Promise<string | null> {
  const [exposureResult, endpointsResult] = await Promise.allSettled([
    typeof bridge.getServerExposureState === "function"
      ? bridge.getServerExposureState()
      : Promise.resolve(null),
    typeof bridge.getAdvertisedEndpoints === "function"
      ? bridge.getAdvertisedEndpoints()
      : Promise.resolve([] as readonly AdvertisedEndpoint[]),
  ]);

  const serverExposureState =
    exposureResult.status === "fulfilled" ? exposureResult.value : null;
  const advertisedEndpoints =
    endpointsResult.status === "fulfilled" ? endpointsResult.value : [];

  let fallbackHttpUrl: string | null = null;
  try {
    const bootstraps =
      typeof bridge.getLocalEnvironmentBootstraps === "function"
        ? bridge.getLocalEnvironmentBootstraps()
        : [];
    fallbackHttpUrl = bootstraps.find((item) => Boolean(item.httpBaseUrl))?.httpBaseUrl ?? null;
  } catch {
    fallbackHttpUrl = null;
  }

  return selectPreferredMobileAccessUrl({
    advertisedEndpoints,
    serverExposureState,
    fallbackHttpUrl,
  });
}

function resolveDraftThreadRef(draftId: string): ScopedThreadRef | null {
  const draftStore = useComposerDraftStore.getState();
  const typedDraftId = DraftId.make(draftId);
  const promoted = draftStore.getPromotedDraftRedirect(typedDraftId);
  if (promoted) {
    return promoted;
  }
  const session = draftStore.getDraftSession(typedDraftId);
  if (session) {
    return scopeThreadRef(session.environmentId, session.threadId);
  }
  return null;
}

function openMobileSimulatorForRef(targetRef: ScopedThreadRef): void {
  const rightPanel = useRightPanelStore.getState();
  rightPanel.requestMobileSimulatorLaunch();
  const hostRef = rightPanelHostRef(targetRef);
  const existingPreview = rightPanel.byThreadKey[scopedThreadKey(hostRef)]?.surfaces.find(
    (surface) => surface.kind === "preview",
  );
  if (existingPreview) {
    rightPanel.activateSurface(hostRef, existingPreview.id);
    rightPanel.show(hostRef);
    return;
  }
  rightPanel.openBrowser(hostRef, null);
}

/**
 * Synchronizes active running-agent count and mobile access URL to the Electron System Tray
 * (deduplicated + throttled) and handles tray context-menu actions ("open-mobile-connect" &
 * "open-mobile-simulator"). Safely no-ops outside Electron desktop.
 */
export function usePrismuxTraySync(): void {
  const runtime = useOptionalPrismuxRuntime();
  const navigate = useNavigate();

  const keptRunningThreads = useAtomValue(runningThreadKeepAliveAtom);
  const activeThreadCount = useMemo(
    () => countActiveRunningThreads(keptRunningThreads),
    [keptRunningThreads],
  );
  const activeAgentProcessCount = useMemo(
    () => normalizeResourcesSummary(runtime?.systemResources).activeAgentCount,
    [runtime?.systemResources],
  );
  const runningAgentsCount = useMemo(
    () =>
      resolveTrayRunningAgentsCount({
        activeThreadCount,
        activeAgentProcessCount,
      }),
    [activeAgentProcessCount, activeThreadCount],
  );

  const routeSnapshot = useRouterState({
    select: (state) => {
      const lastMatch = state.matches.at(-1);
      const params = lastMatch?.params as
        | Partial<Record<"environmentId" | "threadId" | "draftId", string | undefined>>
        | undefined;
      return {
        pathname: state.location.pathname,
        environmentId: params?.environmentId ?? "",
        threadId: params?.threadId ?? "",
        draftId: params?.draftId ?? "",
      };
    },
    structuralSharing: true,
  });
  const routeSnapshotRef = useRef(routeSnapshot);
  routeSnapshotRef.current = routeSnapshot;

  const [mobileUrl, setMobileUrl] = useState<string | null | undefined>(undefined);

  // Resolve current LAN / Tailscale / local T3 Server access URL via Electron IPC (no HTTP fetch).
  useEffect(() => {
    const desktopBridge = typeof window !== "undefined" ? window.desktopBridge : undefined;
    const prismuxBridge = desktopBridge?.prismux;
    if (!desktopBridge || typeof prismuxBridge?.setTrayRunningAgentsCount !== "function") {
      return;
    }

    let cancelled = false;
    const refreshMobileUrl = () => {
      void resolveDesktopMobileAccessUrl(desktopBridge)
        .then((nextUrl) => {
          if (!cancelled) {
            setMobileUrl(nextUrl);
          }
        })
        .catch(() => {
          // Keep previous mobileUrl on transient IPC read errors.
        });
    };

    refreshMobileUrl();
    window.addEventListener("focus", refreshMobileUrl);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshMobileUrl);
    };
  }, []);

  // Deduplicated & throttled sync of running agent count + mobile URL to Electron main tray.
  const lastSentRef = useRef<{
    readonly count: number;
    readonly mobileUrl: string | null | undefined;
  } | null>(null);
  const lastSentAtRef = useRef<number>(0);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prismuxBridge =
      typeof window !== "undefined" ? window.desktopBridge?.prismux : undefined;
    const syncTray = prismuxBridge?.setTrayRunningAgentsCount;
    if (typeof syncTray !== "function") {
      return;
    }

    const lastSent = lastSentRef.current;
    if (
      lastSent !== null &&
      lastSent.count === runningAgentsCount &&
      lastSent.mobileUrl === mobileUrl
    ) {
      return;
    }

    const flush = () => {
      throttleTimerRef.current = null;
      lastSentRef.current = { count: runningAgentsCount, mobileUrl };
      lastSentAtRef.current = Date.now();
      const extra = mobileUrl !== undefined ? { mobileUrl } : undefined;
      void syncTray(runningAgentsCount, extra).catch(() => {
        // Allow retry on next state change if IPC momentarily failed.
        lastSentRef.current = null;
      });
    };

    if (throttleTimerRef.current !== null) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }

    const elapsedMs = Date.now() - lastSentAtRef.current;
    if (lastSent === null || elapsedMs >= TRAY_SYNC_THROTTLE_MS) {
      flush();
    } else {
      throttleTimerRef.current = setTimeout(flush, TRAY_SYNC_THROTTLE_MS - elapsedMs);
    }

    return () => {
      if (throttleTimerRef.current !== null) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
    };
  }, [mobileUrl, runningAgentsCount]);

  // Handle tray menu action callbacks from Electron main process.
  const handleTrayAction = useCallback(
    (payload: PrismuxTrayActionPayload) => {
      if (payload.action === "open-mobile-connect") {
        openPrismuxRemoteConnectDialog();
        return;
      }

      if (payload.action === "open-mobile-simulator") {
        const snapshot = routeSnapshotRef.current;
        const onModalPage = isAppModalPage(snapshot.pathname);

        // 1. Prefer the active route thread (server or draft).
        const directServerRef = resolveThreadRouteRef(snapshot);
        if (directServerRef) {
          openMobileSimulatorForRef(directServerRef);
          return;
        }
        if (snapshot.draftId) {
          const draftRef = resolveDraftThreadRef(snapshot.draftId);
          if (draftRef) {
            openMobileSimulatorForRef(draftRef);
            return;
          }
        }

        // 2. If currently inside Settings/Usage modal, return to its underlying thread and expand phone simulator.
        if (onModalPage) {
          const returnTarget = getAppModalReturnThreadTarget();
          if (returnTarget?.kind === "server") {
            openMobileSimulatorForRef(returnTarget.threadRef);
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(returnTarget.threadRef),
            });
            return;
          }
          if (returnTarget?.kind === "draft") {
            const draftRef = resolveDraftThreadRef(returnTarget.draftId);
            if (draftRef) {
              openMobileSimulatorForRef(draftRef);
            } else {
              useRightPanelStore.getState().requestMobileSimulatorLaunch();
            }
            void navigate({
              to: "/draft/$draftId",
              params: buildDraftThreadRouteParams(returnTarget.draftId),
            });
            return;
          }
        }

        // 3. Fallback to any known thread tracked in rightPanelStore.
        const rightPanel = useRightPanelStore.getState();
        for (const threadKey of Object.keys(rightPanel.byThreadKey)) {
          if (SENTINEL_PANEL_KEYS.has(threadKey)) continue;
          const parsed = parseScopedThreadKey(threadKey);
          if (parsed) {
            openMobileSimulatorForRef(parsed);
            if (onModalPage) {
              void navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams(parsed),
              });
            }
            return;
          }
        }

        // 4. Queue simulator preset so opening any thread launches Phone Simulator immediately.
        rightPanel.requestMobileSimulatorLaunch();
        toastManager.add({
          type: "info",
          title: "打开对话即可启动内置手机模拟器",
          description: "选择或新建任意工作区对话，右侧边栏将自动展开并切到手机模拟面板。",
        });
      }
    },
    [navigate],
  );

  useEffect(() => {
    const onTrayAction =
      typeof window !== "undefined" ? window.desktopBridge?.prismux?.onTrayAction : undefined;
    if (typeof onTrayAction !== "function") {
      return;
    }
    return onTrayAction(handleTrayAction);
  }, [handleTrayAction]);
}
