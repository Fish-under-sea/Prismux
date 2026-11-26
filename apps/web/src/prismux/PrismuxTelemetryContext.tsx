import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useStableCallback } from "../hooks/useStableCallback";
import {
  prismuxDaemonClient,
  type DaemonKillStalePtyResponse,
  type DaemonKillSystemPortResponse,
  type DaemonSystemResourcesResponse,
} from "./daemonClient";
import {
  createPortsPollingController,
  INITIAL_PORTS_SCAN_STATE,
  type PortsPollingController,
  type PortsScanState,
} from "./statusBar/portsPolling";

export interface PrismuxTelemetryContextValue {
  readonly portsState: PortsScanState;
  readonly portsPopoverOpen: boolean;
  readonly setPortsPopoverOpen: (open: boolean) => void;
  readonly refreshSystemPorts: (workspace?: string) => Promise<void>;
  readonly killSystemPort: (pid: number) => Promise<DaemonKillSystemPortResponse>;
  readonly systemResources: DaemonSystemResourcesResponse | null;
  readonly resourcesLoading: boolean;
  readonly resourcesError: string | null;
  readonly refreshSystemResources: () => Promise<void>;
  readonly setSystemResourcesSnapshot: (snapshot: DaemonSystemResourcesResponse | null) => void;
  readonly killStalePty: (sessionId: string) => Promise<DaemonKillStalePtyResponse>;
}

export interface PrismuxTelemetryMirrorState {
  readonly portsState: PortsScanState;
  readonly systemResources: DaemonSystemResourcesResponse | null;
  readonly resourcesLoading: boolean;
  readonly resourcesError: string | null;
  readonly refreshSystemPorts: (workspace?: string) => Promise<void>;
  readonly killSystemPort: (pid: number) => Promise<DaemonKillSystemPortResponse>;
  readonly refreshSystemResources: () => Promise<void>;
  readonly killStalePty: (sessionId: string) => Promise<DaemonKillStalePtyResponse>;
}

/**
 * Non-reactive mirror bridging telemetry values back to legacy runtime context getters
 * so static consumers never re-render on volatile telemetry updates.
 */
export interface PrismuxTelemetryMirror extends PrismuxTelemetryMirrorState {
  readonly sync: (next: PrismuxTelemetryMirrorState) => void;
}

export function createPrismuxTelemetryMirror(): PrismuxTelemetryMirror {
  let state: PrismuxTelemetryMirrorState = {
    portsState: INITIAL_PORTS_SCAN_STATE,
    systemResources: null,
    resourcesLoading: false,
    resourcesError: null,
    refreshSystemPorts: async () => {},
    killSystemPort: async (pid) => ({
      ok: false,
      pid,
      error: "telemetry_unmounted",
    }),
    refreshSystemResources: async () => {},
    killStalePty: async (sessionId) => ({
      ok: false,
      sessionId,
      error: "telemetry_unmounted",
    }),
  };

  return {
    get portsState() {
      return state.portsState;
    },
    get systemResources() {
      return state.systemResources;
    },
    get resourcesLoading() {
      return state.resourcesLoading;
    },
    get resourcesError() {
      return state.resourcesError;
    },
    get refreshSystemPorts() {
      return state.refreshSystemPorts;
    },
    get killSystemPort() {
      return state.killSystemPort;
    },
    get refreshSystemResources() {
      return state.refreshSystemResources;
    },
    get killStalePty() {
      return state.killStalePty;
    },
    sync(next) {
      state = next;
    },
  };
}

const PrismuxTelemetryContext = createContext<PrismuxTelemetryContextValue | null>(null);

export interface PrismuxTelemetryProviderProps {
  readonly daemonReady: boolean;
  readonly occluded: boolean;
  readonly mirror?: PrismuxTelemetryMirror | undefined;
  readonly children: ReactNode;
}

/**
 * Isolated context for volatile host/port/resource telemetry.
 * Gates port polling strictly to when the Ports popover is open and removes duplicate 30s polls.
 */
export function PrismuxTelemetryProvider({
  daemonReady,
  occluded,
  mirror,
  children,
}: PrismuxTelemetryProviderProps) {
  const [portsState, setPortsState] = useState<PortsScanState>(INITIAL_PORTS_SCAN_STATE);
  const [portsPopoverOpen, setPortsPopoverOpen] = useState<boolean>(false);
  const [systemResources, setSystemResources] = useState<DaemonSystemResourcesResponse | null>(
    null,
  );
  const [resourcesLoading, setResourcesLoading] = useState<boolean>(false);
  const [resourcesError, setResourcesError] = useState<string | null>(null);

  const portsControllerRef = useRef<PortsPollingController | null>(null);

  const isCurrentlyPaused = useStableCallback(
    () =>
      occluded || (typeof document !== "undefined" && document.visibilityState === "hidden"),
  );

  const refreshSystemPorts = useStableCallback(async (workspace?: string): Promise<void> => {
    const controller = portsControllerRef.current;
    if (controller) {
      await controller.refreshNow(workspace);
      return;
    }
    if (!daemonReady) return;
    try {
      const res = await prismuxDaemonClient.fetchSystemPorts(workspace);
      const list = Array.isArray(res?.ports) ? res.ports : [];
      setPortsState({
        ports: list,
        loading: false,
        error: null,
        failureStreak: 0,
        lastScannedAt: Date.now(),
      });
    } catch (err) {
      setPortsState((prev) => {
        const nextStreak = prev.failureStreak + 1;
        return {
          ports: nextStreak >= 2 ? [] : prev.ports,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          failureStreak: nextStreak,
          lastScannedAt: prev.lastScannedAt,
        };
      });
    }
  });

  const killSystemPort = useStableCallback(
    async (pid: number): Promise<DaemonKillSystemPortResponse> => {
      const result = await prismuxDaemonClient.killSystemPort(pid);
      void refreshSystemPorts();
      return result;
    },
  );

  const refreshSystemResources = useStableCallback(async (): Promise<void> => {
    if (!daemonReady) return;
    setResourcesLoading(true);
    try {
      const res = await prismuxDaemonClient.fetchSystemResources();
      setSystemResources(res);
      setResourcesError(null);
    } catch (err) {
      setResourcesError(err instanceof Error ? err.message : String(err));
    } finally {
      setResourcesLoading(false);
    }
  });

  const setSystemResourcesSnapshot = useStableCallback(
    (snapshot: DaemonSystemResourcesResponse | null) => {
      setSystemResources(snapshot);
      if (snapshot !== null) {
        setResourcesError(null);
      }
    },
  );

  const killStalePty = useStableCallback(
    async (sessionId: string): Promise<DaemonKillStalePtyResponse> => {
      const result = await prismuxDaemonClient.killStalePty(sessionId);
      void refreshSystemResources();
      return result;
    },
  );

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- manages imperative PortsPollingController lifecycle gated on popover open
  useEffect(() => {
    if (!daemonReady || !portsPopoverOpen) {
      portsControllerRef.current?.stop();
      portsControllerRef.current = null;
      return;
    }

    const controller = createPortsPollingController({
      fetcher: async (workspace) => {
        const res = await prismuxDaemonClient.fetchSystemPorts(workspace);
        return Array.isArray(res?.ports) ? res.ports : [];
      },
      isPaused: () => isCurrentlyPaused(),
      onStateChange: (next) => setPortsState(next),
    });
    portsControllerRef.current = controller;
    controller.start();

    return () => {
      controller.stop();
      if (portsControllerRef.current === controller) {
        portsControllerRef.current = null;
      }
    };
  }, [daemonReady, isCurrentlyPaused, portsPopoverOpen]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- pauses imperative PortsPollingController when host window is occluded
  useEffect(() => {
    const isHidden =
      occluded || (typeof document !== "undefined" && document.visibilityState === "hidden");
    portsControllerRef.current?.setPaused(isHidden);
  }, [occluded]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- syncs non-reactive mirror consumed by legacy runtime context getters
  useEffect(() => {
    mirror?.sync({
      portsState,
      systemResources,
      resourcesLoading,
      resourcesError,
      refreshSystemPorts,
      killSystemPort,
      refreshSystemResources,
      killStalePty,
    });
  }, [
    mirror,
    portsState,
    systemResources,
    resourcesLoading,
    resourcesError,
    refreshSystemPorts,
    killSystemPort,
    refreshSystemResources,
    killStalePty,
  ]);

  // oxlint-disable-next-line prismux/no-manual-memo -- preserves stable context value reference across parent re-renders even outside compiler transforms
  const value = useMemo<PrismuxTelemetryContextValue>(
    () => ({
      portsState,
      portsPopoverOpen,
      setPortsPopoverOpen,
      refreshSystemPorts,
      killSystemPort,
      systemResources,
      resourcesLoading,
      resourcesError,
      refreshSystemResources,
      setSystemResourcesSnapshot,
      killStalePty,
    }),
    [
      portsState,
      portsPopoverOpen,
      refreshSystemPorts,
      killSystemPort,
      systemResources,
      resourcesLoading,
      resourcesError,
      refreshSystemResources,
      setSystemResourcesSnapshot,
      killStalePty,
    ],
  );

  return <PrismuxTelemetryContext value={value}>{children}</PrismuxTelemetryContext>;
}

export function useOptionalPrismuxTelemetry(): PrismuxTelemetryContextValue | null {
  return useContext(PrismuxTelemetryContext);
}

export function usePrismuxTelemetry(): PrismuxTelemetryContextValue {
  const ctx = useContext(PrismuxTelemetryContext);
  if (!ctx) {
    throw new Error("usePrismuxTelemetry must be used inside <PrismuxTelemetryProvider />");
  }
  return ctx;
}
