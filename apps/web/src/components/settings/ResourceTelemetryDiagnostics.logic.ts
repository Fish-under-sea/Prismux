import type {
  BackgroundBooleanState,
  HostPowerSnapshot,
  ResourceTelemetryProcess,
  ResourceTelemetrySnapshot,
  ResourceTelemetrySourceStatus,
} from "@prismux/core-contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";
import type { DaemonSystemResourcesResponse } from "../../prismux/daemonClient";

export interface HostHardwareInfo {
  readonly osName: string | null;
  readonly osVersion: string | null;
  readonly arch: string | null;
  readonly cpuBrand: string | null;
  readonly physicalCores: number | null;
  readonly logicalCores: number | null;
  readonly totalMemoryBytes: number | null;
  readonly usedMemoryBytes: number | null;
  readonly uptimeSeconds: number | null;
  readonly temperatureCelsius: number | null;
}

export interface HostPowerExtendedInfo {
  readonly batteryPercent: number | null;
  readonly isCharging: BackgroundBooleanState;
}

function readOptionalString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const raw = record[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readOptionalFiniteNumber(
  record: Record<string, unknown> | null,
  key: string,
): number | null {
  if (!record) return null;
  const raw = record[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function readOptionalBooleanState(
  record: Record<string, unknown> | null,
  key: string,
): BackgroundBooleanState {
  if (!record) return "unknown";
  const raw = record[key];
  if (raw === "true" || raw === "false" || raw === "unknown") return raw;
  if (raw === true) return "true";
  if (raw === false) return "false";
  return "unknown";
}

function formatPlatformFallback(platform: string | null | undefined): string | null {
  if (!platform) return null;
  const lower = platform.trim().toLowerCase();
  if (lower === "win32" || lower === "windows") return "Windows";
  if (lower === "darwin" || lower === "macos") return "macOS";
  if (lower === "linux") return "Linux";
  return platform.trim() || null;
}

/**
 * Defensively reads optional `snapshot.host` telemetry supplied by native monitor
 * and falls back cleanly to daemon host resource metrics when unavailable.
 */
export function extractHostHardwareInfo(
  snapshot: ResourceTelemetrySnapshot | null,
  daemonResources?: DaemonSystemResourcesResponse | null,
): HostHardwareInfo {
  const snapshotRecord = snapshot
    ? (snapshot as unknown as Record<string, unknown>)
    : null;
  const hostRecord =
    snapshotRecord && typeof snapshotRecord.host === "object" && snapshotRecord.host !== null
      ? (snapshotRecord.host as Record<string, unknown>)
      : null;

  const daemonRecord = daemonResources
    ? (daemonResources as unknown as Record<string, unknown>)
    : null;
  const daemonHost = daemonResources?.host ?? null;

  const osName =
    readOptionalString(hostRecord, "osName") ??
    formatPlatformFallback(
      readOptionalString(daemonHost as Record<string, unknown> | null, "platform") ??
        readOptionalString(daemonRecord, "platform"),
    );
  const osVersion = readOptionalString(hostRecord, "osVersion");
  const arch =
    readOptionalString(hostRecord, "arch") ??
    readOptionalString(daemonHost as Record<string, unknown> | null, "arch");
  const cpuBrand =
    readOptionalString(hostRecord, "cpuBrand") ??
    readOptionalString(daemonHost as Record<string, unknown> | null, "cpuBrand");
  const physicalCores = readOptionalFiniteNumber(hostRecord, "physicalCores");
  const logicalCores =
    readOptionalFiniteNumber(hostRecord, "logicalCores") ??
    (typeof daemonHost?.cpuCores === "number" && daemonHost.cpuCores > 0
      ? daemonHost.cpuCores
      : null);
  const totalMemoryBytes =
    readOptionalFiniteNumber(hostRecord, "totalMemoryBytes") ??
    (typeof daemonHost?.totalMemoryBytes === "number" && daemonHost.totalMemoryBytes > 0
      ? daemonHost.totalMemoryBytes
      : typeof daemonResources?.hostMemoryTotalBytes === "number" &&
          daemonResources.hostMemoryTotalBytes > 0
        ? daemonResources.hostMemoryTotalBytes
        : null);
  const usedMemoryBytes =
    readOptionalFiniteNumber(hostRecord, "usedMemoryBytes") ??
    (typeof daemonHost?.memoryBytes === "number" && daemonHost.memoryBytes >= 0
      ? daemonHost.memoryBytes
      : null);
  const uptimeSeconds =
    readOptionalFiniteNumber(hostRecord, "uptimeSeconds") ??
    readOptionalFiniteNumber(daemonHost as Record<string, unknown> | null, "uptimeSeconds") ??
    readOptionalFiniteNumber(daemonRecord, "uptimeSec");
  const temperatureCelsius = readOptionalFiniteNumber(hostRecord, "temperatureCelsius");

  return {
    osName,
    osVersion,
    arch,
    cpuBrand,
    physicalCores,
    logicalCores,
    totalMemoryBytes,
    usedMemoryBytes,
    uptimeSeconds,
    temperatureCelsius,
  };
}

/**
 * Defensively reads optional `batteryPercent` and `isCharging` fields from `HostPowerSnapshot`.
 */
export function extractHostPowerExtended(power: HostPowerSnapshot | null): HostPowerExtendedInfo {
  if (!power) {
    return { batteryPercent: null, isCharging: "unknown" };
  }
  const record = power as unknown as Record<string, unknown>;
  const rawPercent = readOptionalFiniteNumber(record, "batteryPercent");
  const batteryPercent =
    rawPercent !== null ? Math.max(0, Math.min(100, Math.round(rawPercent))) : null;
  const isCharging = readOptionalBooleanState(record, "isCharging");
  return { batteryPercent, isCharging };
}

export function formatHostUptime(
  uptimeSeconds: number | null,
  resolve: MessageResolver = m,
): string | null {
  if (uptimeSeconds === null || !Number.isFinite(uptimeSeconds) || uptimeSeconds < 0) return null;
  const totalMinutes = Math.floor(uptimeSeconds / 60);
  if (totalMinutes < 1) {
    return resolve(msg("<1m"));
  }
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return resolve(msg("{days}d {hours}h", { days, hours }));
  }
  if (hours > 0) {
    return resolve(msg("{hours}h {minutes}m", { hours, minutes }));
  }
  return resolve(msg("{minutes}m", { minutes }));
}

export function formatCoreTopology(
  physicalCores: number | null,
  logicalCores: number | null,
  resolve: MessageResolver = m,
): string | null {
  if (physicalCores !== null && logicalCores !== null && physicalCores > 0 && logicalCores > 0) {
    return `${physicalCores}C / ${logicalCores}T`;
  }
  if (logicalCores !== null && logicalCores > 0) {
    return resolve(
      msg("{count, plural, one {{count} logical core} other {{count} logical cores}}", {
        count: logicalCores,
      }),
    );
  }
  if (physicalCores !== null && physicalCores > 0) {
    return resolve(
      msg("{count, plural, one {{count} core} other {{count} cores}}", {
        count: physicalCores,
      }),
    );
  }
  return null;
}

export function formatHostPowerSourceLabel(
  power: HostPowerSnapshot | null,
  extended: HostPowerExtendedInfo,
  resolve: MessageResolver = m,
): string {
  const suffix = extended.batteryPercent !== null ? ` · ${extended.batteryPercent}%` : "";
  if (!power) {
    return extended.batteryPercent !== null
      ? `${resolve(msg("Battery"))}${suffix}`
      : resolve(msg("Unknown"));
  }
  if (power.onBattery === "true") {
    return `${resolve(msg("Battery"))}${suffix}`;
  }
  if (power.onBattery === "false") {
    if (extended.isCharging === "true") {
      return `${resolve(msg("Charging"))}${suffix}`;
    }
    return `${resolve(msg("External power"))}${suffix}`;
  }
  if (extended.batteryPercent !== null) {
    return `${resolve(msg("Battery"))}${suffix}`;
  }
  return resolve(msg("Unknown"));
}

export function formatThermalSensorDisplay(
  thermalState: HostPowerSnapshot["thermalState"],
  temperatureCelsius: number | null,
  resolve: MessageResolver = m,
): {
  readonly label: string;
  readonly tone: "default" | "warning" | "danger";
} {
  const tone: "default" | "warning" | "danger" =
    thermalState === "critical" || (temperatureCelsius !== null && temperatureCelsius >= 90)
      ? "danger"
      : thermalState === "serious" || (temperatureCelsius !== null && temperatureCelsius >= 80)
        ? "warning"
        : "default";

  if (temperatureCelsius !== null && Number.isFinite(temperatureCelsius)) {
    const tempText = `${temperatureCelsius.toFixed(1)} °C`;
    if (thermalState === "unknown") {
      return { label: tempText, tone };
    }
    return {
      label: `${tempText} · ${localizeThermalState(thermalState, resolve)}`,
      tone,
    };
  }

  if (thermalState === "unknown") {
    return {
      label: resolve(msg("Normal (OS sensors not exposed)")),
      tone: "default",
    };
  }

  return {
    label: localizeThermalState(thermalState, resolve),
    tone,
  };
}

export function processIdentityKey(process: Pick<ResourceTelemetryProcess, "identity">): string {
  return `${process.identity.pid}:${process.identity.startTimeMs}`;
}

export function visibleResourceTelemetryProcesses(
  processes: ReadonlyArray<ResourceTelemetryProcess>,
  collapsed: ReadonlySet<string>,
): ReadonlyArray<ResourceTelemetryProcess> {
  const childrenByParent = new Map<number, ResourceTelemetryProcess[]>();
  for (const process of processes) {
    const children = childrenByParent.get(process.ppid) ?? [];
    children.push(process);
    childrenByParent.set(process.ppid, children);
  }

  const hidden = new Set<string>();
  const hideDescendants = (pid: number): void => {
    for (const child of childrenByParent.get(pid) ?? []) {
      // Depth 0 rows are their own roots, e.g. the server launched by Electron main.
      if (child.depth === 0) continue;
      const key = processIdentityKey(child);
      if (hidden.has(key)) continue;
      hidden.add(key);
      hideDescendants(child.identity.pid);
    }
  };
  for (const process of processes) {
    if (collapsed.has(processIdentityKey(process))) {
      hideDescendants(process.identity.pid);
    }
  }
  return processes.filter((process) => !hidden.has(processIdentityKey(process)));
}

export function shouldShowResourceMonitorRetry(input: {
  readonly nativeStatus: ResourceTelemetrySourceStatus | null;
  readonly error: string | null;
}): boolean {
  return (
    (input.nativeStatus === null && input.error !== null) ||
    input.nativeStatus === "degraded" ||
    input.nativeStatus === "unavailable" ||
    input.nativeStatus === "stopped"
  );
}

export function resourceHistoryBarHeight(input: {
  readonly value: number;
  readonly max: number;
  readonly minimumVisiblePercent: number;
}): number {
  if (input.value <= 0) return 0;
  return Math.max(input.minimumVisiblePercent, (input.value / Math.max(1, input.max)) * 100);
}

export function resourceHistoryCpuScaleMax(
  buckets: ReadonlyArray<{ readonly avgCpuPercent: number }>,
): number {
  return Math.max(1, ...buckets.map((bucket) => bucket.avgCpuPercent));
}

export function formatCpuTime(seconds: number, resolve: MessageResolver = m): string {
  const format = (value: number) => value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$/, "");
  // Pick the unit after rounding so 59.97 seconds never renders as "60s".
  const shortSeconds = format(seconds);
  if (Number(shortSeconds) < 60) {
    return resolve(msg("{value}s", { value: shortSeconds, $context: "CPU time in seconds" }));
  }
  const shortMinutes = format(seconds / 60);
  if (Number(shortMinutes) < 60) {
    return resolve(msg("{value}m", { value: shortMinutes, $context: "CPU time in minutes" }));
  }
  return resolve(
    msg("{value}h", {
      value: (seconds / 3_600).toFixed(2).replace(/\.0+$/, ""),
      $context: "CPU time in hours",
    }),
  );
}

export function formatSamplingStatus(intervalMs: number, resolve: MessageResolver = m): string {
  // The server reports 0 while the native monitor is idle and samples only on request.
  if (intervalMs <= 0) return resolve(msg("Sampling on demand"));
  if (intervalMs < 1_000) {
    return resolve(msg("Sampling every {ms} ms", { ms: Math.round(intervalMs) }));
  }
  const seconds = intervalMs / 1_000;
  return resolve(
    msg(
      "{count, plural, one {Sampling every {seconds} second} other {Sampling every {seconds} seconds}}",
      {
        count: seconds,
        seconds: seconds.toLocaleString(undefined, { maximumFractionDigits: 1 }),
      },
    ),
  );
}

export function localizeSourceStatus(
  status: ResourceTelemetrySourceStatus,
  resolve: MessageResolver = m,
): string {
  switch (status) {
    case "healthy":
      return resolve(msg("Healthy"));
    case "starting":
      return resolve(msg("Starting"));
    case "degraded":
      return resolve(msg("Degraded"));
    case "unavailable":
      return resolve(msg("Unavailable"));
    case "stopped":
      return resolve(msg("Stopped"));
  }
}

export function localizeNativeStatusBadge(
  status: ResourceTelemetrySourceStatus,
  resolve: MessageResolver = m,
): string {
  if (status === "healthy") {
    return resolve(msg("Running natively"));
  }
  return `${resolve(msg("Native"))} ${localizeSourceStatus(status, resolve)}`;
}

export function localizeThermalState(
  thermalState: HostPowerSnapshot["thermalState"],
  resolve: MessageResolver = m,
): string {
  switch (thermalState) {
    case "nominal":
      return resolve(msg("Nominal", { $context: "host thermal state" }));
    case "fair":
      return resolve(msg("Fair", { $context: "host thermal state" }));
    case "serious":
      return resolve(msg("Serious", { $context: "host thermal state" }));
    case "critical":
      return resolve(msg("Critical", { $context: "host thermal state" }));
    case "unknown":
      return resolve(msg("No sensor data", { $context: "host thermal state" }));
  }
}

export function resolveCpuSpeedLimitDisplay(
  input: {
    readonly speedLimitPercent: number | null;
    readonly thermalState: HostPowerSnapshot["thermalState"];
  },
  resolve: MessageResolver = m,
): {
  readonly value: string;
  readonly tone: "default" | "warning" | "danger";
} {
  // Windows laptops dynamically scale idle P-states (e.g. 23%) while thermalState is "unknown".
  // Do not raise an alarming throttling warning without genuine OS thermal telemetry.
  if (input.thermalState === "unknown") {
    return {
      value: resolve(msg("Normal (unthrottled)")),
      tone: "default",
    };
  }
  if (input.speedLimitPercent === null) {
    if (input.thermalState === "nominal") {
      return { value: "100%", tone: "default" };
    }
    if (input.thermalState === "fair") {
      return { value: resolve(msg("Normal (unthrottled)")), tone: "default" };
    }
    return {
      value: resolve(msg("Throttled")),
      tone: input.thermalState === "critical" ? "danger" : "warning",
    };
  }
  const clamped = Math.max(0, Math.min(100, input.speedLimitPercent));
  const tone: "default" | "warning" | "danger" =
    input.thermalState === "critical" || clamped < 50
      ? "danger"
      : clamped < 80 || input.thermalState === "serious"
        ? "warning"
        : "default";
  return {
    value: `${clamped.toFixed(0)}%`,
    tone,
  };
}
