import type { DaemonSystemPortEntryDto } from "../daemonClient";

export const PORTS_POLL_INTERVAL_MS = 30_000;
export const PORTS_FAILURE_CLEAR_THRESHOLD = 2;

export interface PortsScanState {
  readonly ports: readonly DaemonSystemPortEntryDto[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly failureStreak: number;
  readonly lastScannedAt: number | null;
}

export const INITIAL_PORTS_SCAN_STATE: PortsScanState = Object.freeze({
  ports: [],
  loading: false,
  error: null,
  failureStreak: 0,
  lastScannedAt: null,
});

export function applyPortsScanSuccess(
  _prev: PortsScanState,
  ports: readonly DaemonSystemPortEntryDto[],
  now = Date.now(),
): PortsScanState {
  return {
    ports: [...ports],
    loading: false,
    error: null,
    failureStreak: 0,
    lastScannedAt: now,
  };
}

/**
 * Consecutive failure debounce:
 * - Failure #1 preserves the previous `ports` snapshot to avoid UI flicker on transient errors.
 * - Failure #2+ clears `ports` so stale entries do not linger indefinitely.
 */
export function applyPortsScanFailure(
  prev: PortsScanState,
  errorMessage: string,
  threshold = PORTS_FAILURE_CLEAR_THRESHOLD,
): PortsScanState {
  const failureStreak = prev.failureStreak + 1;
  return {
    ports: failureStreak >= threshold ? [] : prev.ports,
    loading: false,
    error: errorMessage,
    failureStreak,
    lastScannedAt: prev.lastScannedAt,
  };
}

export interface PortsPollingControllerOptions {
  readonly fetcher: (workspace?: string) => Promise<readonly DaemonSystemPortEntryDto[]>;
  readonly getWorkspace?: () => string | undefined;
  readonly isPaused: () => boolean;
  readonly onStateChange: (state: PortsScanState) => void;
  readonly intervalMs?: number;
  readonly failureClearThreshold?: number;
  readonly now?: () => number;
}

export interface PortsPollingController {
  start(): void;
  stop(): void;
  setPaused(paused: boolean): void;
  refreshNow(workspaceOverride?: string): Promise<void>;
  getState(): PortsScanState;
}

export function createPortsPollingController(
  options: PortsPollingControllerOptions,
): PortsPollingController {
  const intervalMs = Math.max(1000, options.intervalMs ?? PORTS_POLL_INTERVAL_MS);
  const failureThreshold = options.failureClearThreshold ?? PORTS_FAILURE_CLEAR_THRESHOLD;
  const nowFn = options.now ?? (() => Date.now());

  let state: PortsScanState = INITIAL_PORTS_SCAN_STATE;
  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let paused = options.isPaused();
  let inflight: Promise<void> | null = null;
  /**
   * Generation guard modeled after Orca `ports/WorkspacePortScanner.tsx`:
   * Incremented on stop or pause-resume transitions so a stale in-flight scan
   * from an earlier lifecycle generation can never overwrite fresher state.
   */
  let generation = 0;

  const commit = (next: PortsScanState) => {
    state = next;
    options.onStateChange(state);
  };

  const runScan = async (workspaceOverride?: string): Promise<void> => {
    if (inflight) return inflight;

    const scanGeneration = generation;
    const task = (async () => {
      commit({ ...state, loading: true });
      try {
        const workspace = workspaceOverride ?? options.getWorkspace?.();
        const ports = await options.fetcher(workspace);
        if (scanGeneration !== generation) {
          return;
        }
        if (!started && workspaceOverride === undefined) {
          return;
        }
        // Reachable empty scan clears immediately (streak resets to 0), matching Orca.
        commit(applyPortsScanSuccess(state, ports, nowFn()));
      } catch (err) {
        if (scanGeneration !== generation) {
          return;
        }
        if (!started && workspaceOverride === undefined) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        commit(applyPortsScanFailure(state, message, failureThreshold));
      }
    })().finally(() => {
      if (inflight === task) {
        inflight = null;
      }
    });

    inflight = task;
    return task;
  };

  const clearTimer = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const ensureTimer = () => {
    clearTimer();
    if (!started || paused) return;
    timer = setInterval(() => {
      if (paused || options.isPaused()) return;
      void runScan();
    }, intervalMs);
  };

  return {
    start() {
      if (started) return;
      started = true;
      generation += 1;
      paused = options.isPaused();
      if (!paused) {
        void runScan();
      }
      ensureTimer();
    },
    stop() {
      started = false;
      generation += 1;
      inflight = null;
      clearTimer();
    },
    setPaused(nextPaused: boolean) {
      if (paused === nextPaused) return;
      paused = nextPaused;
      if (paused) {
        generation += 1;
        inflight = null;
        clearTimer();
      } else if (started) {
        generation += 1;
        void runScan();
        ensureTimer();
      }
    },
    refreshNow(workspaceOverride?: string) {
      return runScan(workspaceOverride);
    },
    getState() {
      return state;
    },
  };
}

export function normalizePathForPortMatch(rawPath: string | null | undefined): string | null {
  if (!rawPath || typeof rawPath !== "string") return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  const slashed = trimmed.replaceAll("\\", "/").replace(/\/+$/, "");
  // Windows drive paths (e.g. D:/foo) are case-insensitive.
  if (/^[a-zA-Z]:\//.test(slashed) || /^[a-zA-Z]:$/.test(slashed)) {
    return slashed.toLowerCase();
  }
  return slashed;
}

export function isPortInWorkspace(
  entry: DaemonSystemPortEntryDto,
  workspaceRoot: string | null | undefined,
): boolean {
  const normalizedTarget = normalizePathForPortMatch(workspaceRoot);
  if (!normalizedTarget) {
    return entry.scope === "workspace";
  }

  const candidates = [
    normalizePathForPortMatch(entry.workspace),
    normalizePathForPortMatch(entry.cwd),
  ].filter((value): value is string => value !== null);

  for (const candidate of candidates) {
    if (candidate === normalizedTarget || candidate.startsWith(`${normalizedTarget}/`)) {
      return true;
    }
  }
  return false;
}

export function partitionPortsByWorkspace(
  ports: readonly DaemonSystemPortEntryDto[],
  workspaceRoot: string | null | undefined,
): {
  readonly workspacePorts: readonly DaemonSystemPortEntryDto[];
  readonly externalPorts: readonly DaemonSystemPortEntryDto[];
} {
  const workspacePorts: DaemonSystemPortEntryDto[] = [];
  const externalPorts: DaemonSystemPortEntryDto[] = [];

  for (const port of ports) {
    if (isPortInWorkspace(port, workspaceRoot)) {
      workspacePorts.push(port);
    } else {
      externalPorts.push(port);
    }
  }

  workspacePorts.sort((a, b) => a.port - b.port);
  externalPorts.sort((a, b) => a.port - b.port);
  return { workspacePorts, externalPorts };
}

export function resolvePortOpenUrl(entry: DaemonSystemPortEntryDto): string {
  if (typeof entry.url === "string" && /^https?:\/\//i.test(entry.url.trim())) {
    return entry.url.trim();
  }
  const rawHost =
    entry.connectHost?.trim() ||
    entry.host?.trim() ||
    entry.bindHost?.trim() ||
    entry.address?.trim() ||
    "127.0.0.1";
  const safeHost =
    rawHost === "0.0.0.0" || rawHost === "::" || rawHost === "[::]" || rawHost === "*"
      ? "127.0.0.1"
      : rawHost;
  const scheme =
    entry.serviceProtocol === "https" || entry.port === 443 || entry.port === 8443
      ? "https"
      : "http";
  return `${scheme}://${safeHost}:${entry.port}`;
}
