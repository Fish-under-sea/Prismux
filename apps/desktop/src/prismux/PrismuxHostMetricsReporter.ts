import * as NodeOS from "node:os";

import type * as Electron from "electron";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import type * as DesktopBackendManager from "../backend/DesktopBackendManager.ts";

export const HOST_METRICS_WARMUP_DELAY = Duration.millis(300);
export const HOST_METRICS_ACTIVE_POLL_INTERVAL = Duration.millis(2_000);
export const HOST_METRICS_BACKGROUND_POLL_INTERVAL = Duration.millis(10_000);
export const HOST_METRICS_POLL_INTERVAL = HOST_METRICS_ACTIVE_POLL_INTERVAL;
export const HOST_METRICS_POST_TIMEOUT = Duration.millis(1_500);

export interface HostMetricsActivityState {
  readonly windowVisible: boolean;
  readonly windowFocused: boolean;
  readonly systemLocked: boolean;
  readonly systemSuspended: boolean;
}

export type HostMetricsCadence =
  | { readonly mode: "paused" }
  | { readonly mode: "active"; readonly interval: Duration.Duration }
  | { readonly mode: "background"; readonly interval: Duration.Duration };

/**
 * Resolves the host metrics push cadence from window visibility/focus and OS power state:
 * - Minimized, hidden, locked, or suspended -> paused (zero `app.getAppMetrics()` polling).
 * - Visible & focused -> active 2s cadence.
 * - Visible & unfocused -> relaxed 10s background cadence.
 */
export function resolveHostMetricsCadence(
  activity: HostMetricsActivityState,
): HostMetricsCadence {
  if (activity.systemSuspended || activity.systemLocked || !activity.windowVisible) {
    return { mode: "paused" };
  }
  if (activity.windowFocused) {
    return { mode: "active", interval: HOST_METRICS_ACTIVE_POLL_INTERVAL };
  }
  return { mode: "background", interval: HOST_METRICS_BACKGROUND_POLL_INTERVAL };
}

/**
 * Determines whether a cadence transition should wake a sleeping metrics reporter immediately:
 * resumes immediately on restore/focus/unlock, switches immediately from 10s -> 2s on focus,
 * and parks immediately when transitioning to paused without emitting an extra push.
 */
export function shouldWakeHostMetricsReporter(
  previous: HostMetricsCadence,
  next: HostMetricsCadence,
): boolean {
  if (previous.mode === "paused" && next.mode !== "paused") {
    return true;
  }
  if (previous.mode === "background" && next.mode === "active") {
    return true;
  }
  if (previous.mode !== "paused" && next.mode === "paused") {
    return true;
  }
  return false;
}

export interface PrismuxElectronProcessMetricPayload {
  readonly pid: number;
  readonly type: string;
  readonly name?: string;
  readonly serviceName?: string;
  readonly creationTimeMs?: number;
  readonly cpuPercent: number | null;
  readonly cumulativeCpuSeconds?: number | null;
  readonly workingSetBytes: number;
  readonly privateMemoryBytes?: number | null;
  readonly peakWorkingSetBytes?: number | null;
}

export interface PrismuxHostT3ServerPayload {
  readonly pid: number | null;
  readonly ready: boolean;
  readonly desiredRunning?: boolean;
  readonly state: string;
  readonly hostedBy: "electron" | "electron-in-process" | "external";
  readonly httpUrl?: string | null;
}

export interface PrismuxHostMetricsPayload {
  readonly collectedAt: number;
  readonly mainPid: number;
  readonly cpuCores: number;
  /**
   * Electron's `app.getAppMetrics().cpu.percentCPUUsage` divides Chromium's
   * `GetPlatformIndependentCPUUsage()` by `base::SysInfo::NumberOfProcessors()`,
   * so its native scale is total-system CPU% (0–100%), matching Windows Task Manager.
   */
  readonly cpuScale: "system-total";
  readonly t3Server?: PrismuxHostT3ServerPayload | null;
  readonly electronProcesses: readonly PrismuxElectronProcessMetricPayload[];
}

function safeNonNegative(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function kibToBytes(kib: number | undefined): number | null {
  const valid = safeNonNegative(kib);
  return valid === null ? null : Math.round(valid * 1024);
}

/**
 * Converts Electron `app.getAppMetrics()` entries and the primary desktop backend
 * snapshot into the structured payload consumed by Prismux Daemon's
 * `POST /v1/resources/host-metrics` route.
 */
export function buildHostMetricsPayload(input: {
  readonly metrics: ReadonlyArray<Electron.ProcessMetric>;
  readonly mainPid: number;
  readonly collectedAt: number;
  readonly cpuCores?: number;
  readonly t3BackendSnapshot?: DesktopBackendManager.DesktopBackendSnapshot | null;
  readonly t3HttpUrl?: string | null;
}): PrismuxHostMetricsPayload {
  const cpuCores = Math.max(1, input.cpuCores ?? NodeOS.cpus().length);
  const collectedAt = input.collectedAt;

  const electronProcesses: PrismuxElectronProcessMetricPayload[] = [];
  for (const metric of input.metrics) {
    if (!Number.isInteger(metric.pid) || metric.pid <= 0) {
      continue;
    }
    const workingSetBytes = kibToBytes(metric.memory?.workingSetSize) ?? 0;
    const privateMemoryBytes = kibToBytes(metric.memory?.privateBytes);
    const peakWorkingSetBytes = kibToBytes(metric.memory?.peakWorkingSetSize);
    const cpuPercent = safeNonNegative(metric.cpu?.percentCPUUsage);
    const cumulativeCpuSeconds = safeNonNegative(metric.cpu?.cumulativeCPUUsage);
    const creationTimeMs = safeNonNegative(metric.creationTime);

    electronProcesses.push({
      pid: metric.pid,
      type: metric.type || "Unknown",
      ...(metric.name ? { name: metric.name } : {}),
      ...(metric.serviceName ? { serviceName: metric.serviceName } : {}),
      ...(creationTimeMs !== null ? { creationTimeMs: Math.round(creationTimeMs) } : {}),
      cpuPercent,
      ...(cumulativeCpuSeconds !== null ? { cumulativeCpuSeconds } : {}),
      workingSetBytes,
      ...(privateMemoryBytes !== null ? { privateMemoryBytes } : {}),
      ...(peakWorkingSetBytes !== null ? { peakWorkingSetBytes } : {}),
    });
  }

  let t3Server: PrismuxHostT3ServerPayload | null | undefined;
  if (input.t3BackendSnapshot) {
    const snap = input.t3BackendSnapshot;
    const rawPid = Option.getOrNull(snap.activePid);
    const pid =
      typeof rawPid === "number" && Number.isInteger(rawPid) && rawPid > 0 ? rawPid : null;
    const state = snap.ready
      ? "running"
      : snap.desiredRunning
        ? "starting"
        : "stopped";
    const hostedBy: PrismuxHostT3ServerPayload["hostedBy"] =
      pid !== null && pid === input.mainPid ? "electron-in-process" : "electron";

    t3Server = {
      pid,
      ready: snap.ready,
      desiredRunning: snap.desiredRunning,
      state,
      hostedBy,
      ...(input.t3HttpUrl ? { httpUrl: input.t3HttpUrl } : {}),
    };
  } else if (input.t3HttpUrl) {
    t3Server = {
      pid: null,
      ready: false,
      state: "external",
      hostedBy: "external",
      httpUrl: input.t3HttpUrl,
    };
  }

  return {
    collectedAt,
    mainPid: input.mainPid,
    cpuCores,
    cpuScale: "system-total",
    ...(t3Server !== undefined ? { t3Server } : {}),
    electronProcesses,
  };
}

/**
 * Posts one host metrics snapshot to the local Prismux Daemon.
 * Swallows transient network/timeout errors so telemetry never disrupts desktop stability.
 */
export function postHostMetricsToDaemon(input: {
  readonly baseUrl: string;
  readonly token: string;
  readonly payload: PrismuxHostMetricsPayload;
  readonly httpClient: HttpClient.HttpClient;
}): Effect.Effect<boolean> {
  if (!input.baseUrl) {
    return Effect.succeed(false);
  }
  const url = new URL("/v1/resources/host-metrics", input.baseUrl);
  const request = HttpClientRequest.post(url).pipe(
    input.token ? HttpClientRequest.bearerToken(input.token) : (req) => req,
    HttpClientRequest.bodyJson(input.payload),
  );
  return request.pipe(
    Effect.flatMap((req) => input.httpClient.execute(req)),
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.timeout(HOST_METRICS_POST_TIMEOUT),
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
}
