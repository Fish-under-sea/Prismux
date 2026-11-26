import { describe, expect, it } from "vite-plus/test";

import type { ResourceTelemetryProcess } from "@prismux/core-contracts";
import * as DateTime from "effect/DateTime";

import {
  extractHostHardwareInfo,
  extractHostPowerExtended,
  formatCoreTopology,
  formatCpuTime,
  formatHostPowerSourceLabel,
  formatHostUptime,
  formatSamplingStatus,
  formatThermalSensorDisplay,
  localizeNativeStatusBadge,
  localizeSourceStatus,
  localizeThermalState,
  resolveCpuSpeedLimitDisplay,
  visibleResourceTelemetryProcesses,
} from "./ResourceTelemetryDiagnostics.logic";

const process = (pid: number, ppid: number, depth: number): ResourceTelemetryProcess => ({
  identity: { pid, startTimeMs: pid * 1_000 },
  ppid,
  childPids: [],
  depth,
  name: `process-${pid}`,
  command: `process-${pid}`,
  status: "Running",
  category: pid === 1 ? "server" : "server-child",
  cpuPercent: 0,
  cpuTimeMs: 0,
  residentBytes: 0,
  peakResidentBytes: 0,
  virtualBytes: 0,
  ioReadBytes: 0,
  ioWriteBytes: 0,
  ioReadBytesPerSecond: 0,
  ioWriteBytesPerSecond: 0,
  ioSemantics: "storage",
  runTimeMs: 0,
  firstSeenAt: DateTime.makeUnsafe(0),
  lastSeenAt: DateTime.makeUnsafe(0),
});

describe("visibleResourceTelemetryProcesses", () => {
  it("hides descendants by parentage even when rows are not depth-first", () => {
    const processes = [
      process(1, 0, 0),
      process(10, 0, 0),
      process(2, 1, 1),
      process(11, 10, 1),
      process(3, 2, 2),
    ];

    expect(visibleResourceTelemetryProcesses(processes, new Set(["1:1000"]))).toEqual([
      processes[0],
      processes[1],
      processes[3],
    ]);
  });

  it("keeps a root row visible when its launcher is collapsed", () => {
    const processes = [process(1, 10, 0), process(2, 1, 1), process(10, 0, 0), process(11, 10, 1)];

    expect(visibleResourceTelemetryProcesses(processes, new Set(["10:10000"]))).toEqual([
      processes[0],
      processes[1],
      processes[2],
    ]);
  });
});

describe("formatCpuTime", () => {
  it("switches units when rounding reaches the next unit", () => {
    expect([59.94, 59.97, 3_599.7, 3_600].map((seconds) => formatCpuTime(seconds))).toEqual([
      "59.9s",
      "1m",
      "1h",
      "1h",
    ]);
  });
});

describe("formatSamplingStatus", () => {
  it("reads an idle interval as on demand rather than every 0 ms", () => {
    expect([0, 500, 2_000].map((intervalMs) => formatSamplingStatus(intervalMs))).toEqual([
      "Sampling on demand",
      "Sampling every 500 ms",
      "Sampling every 2 seconds",
    ]);
  });
});

describe("resource telemetry localization and speed-limit display", () => {
  it("maps native and source statuses to user-facing labels without raw enum tokens", () => {
    expect(localizeNativeStatusBadge("healthy")).toBe("Running natively");
    expect(localizeNativeStatusBadge("degraded")).toBe("Native Degraded");
    expect(localizeSourceStatus("healthy")).toBe("Healthy");
    expect(localizeSourceStatus("unavailable")).toBe("Unavailable");
  });

  it("maps thermal states cleanly without leaking raw unknown enum strings", () => {
    expect(localizeThermalState("nominal")).toBe("Nominal");
    expect(localizeThermalState("fair")).toBe("Fair");
    expect(localizeThermalState("serious")).toBe("Serious");
    expect(localizeThermalState("critical")).toBe("Critical");
    expect(localizeThermalState("unknown")).toBe("No sensor data");
  });

  it("does not display alarming idle P-state throttling when thermalState is unknown", () => {
    expect(
      resolveCpuSpeedLimitDisplay({ speedLimitPercent: 23, thermalState: "unknown" }),
    ).toEqual({
      value: "Normal (unthrottled)",
      tone: "default",
    });
    expect(
      resolveCpuSpeedLimitDisplay({ speedLimitPercent: null, thermalState: "unknown" }),
    ).toEqual({
      value: "Normal (unthrottled)",
      tone: "default",
    });
    expect(
      resolveCpuSpeedLimitDisplay({ speedLimitPercent: 70, thermalState: "serious" }),
    ).toEqual({
      value: "70%",
      tone: "warning",
    });
    expect(
      resolveCpuSpeedLimitDisplay({ speedLimitPercent: 45, thermalState: "critical" }),
    ).toEqual({
      value: "45%",
      tone: "danger",
    });
  });
});

describe("host hardware, power, and thermal sensor helpers", () => {
  it("defensively reads snapshot.host and falls back to daemon system resources", () => {
    const withNativeHost = extractHostHardwareInfo(
      {
        host: {
          osName: "Windows",
          osVersion: "11",
          arch: "x64",
          cpuBrand: "AMD Ryzen 9 7950X",
          physicalCores: 16,
          logicalCores: 32,
          totalMemoryBytes: 64 * 1024 ** 3,
          usedMemoryBytes: 24 * 1024 ** 3,
          uptimeSeconds: 90_000,
          temperatureCelsius: 58.4,
        },
      } as never,
      null,
    );
    expect(withNativeHost.osName).toBe("Windows");
    expect(withNativeHost.osVersion).toBe("11");
    expect(withNativeHost.physicalCores).toBe(16);
    expect(withNativeHost.logicalCores).toBe(32);
    expect(withNativeHost.temperatureCelsius).toBe(58.4);

    const withDaemonFallback = extractHostHardwareInfo(null, {
      platform: "win32",
      uptimeSec: 7_260,
      host: {
        cpuCores: 12,
        totalMemoryBytes: 32 * 1024 ** 3,
        memoryBytes: 12 * 1024 ** 3,
      },
    });
    expect(withDaemonFallback.osName).toBe("Windows");
    expect(withDaemonFallback.logicalCores).toBe(12);
    expect(withDaemonFallback.totalMemoryBytes).toBe(32 * 1024 ** 3);
    expect(withDaemonFallback.usedMemoryBytes).toBe(12 * 1024 ** 3);
    expect(withDaemonFallback.uptimeSeconds).toBe(7_260);
  });

  it("formats core topology, uptime, battery/AC state, and calm thermal fallback", () => {
    expect(formatCoreTopology(16, 32)).toBe("16C / 32T");
    expect(formatCoreTopology(null, 8)).toBe("8 logical cores");
    expect(formatHostUptime(45)).toBe("<1m");
    expect(formatHostUptime(3_660)).toBe("1h 1m");
    expect(formatHostUptime(93_600)).toBe("1d 2h");

    const extended = extractHostPowerExtended({
      source: "node-windows",
      idle: "false",
      idleSeconds: 0,
      locked: "false",
      suspended: false,
      onBattery: "false",
      lowPowerMode: "false",
      thermalState: "unknown",
      stale: false,
      updatedAt: DateTime.makeUnsafe(0),
      batteryPercent: 84.6,
      isCharging: "true",
    } as never);
    expect(extended).toEqual({ batteryPercent: 85, isCharging: "true" });
    expect(
      formatHostPowerSourceLabel(
        {
          source: "node-windows",
          idle: "false",
          idleSeconds: 0,
          locked: "false",
          suspended: false,
          onBattery: "false",
          lowPowerMode: "false",
          thermalState: "unknown",
          stale: false,
          updatedAt: DateTime.makeUnsafe(0),
        },
        extended,
      ),
    ).toBe("Charging · 85%");

    expect(formatThermalSensorDisplay("unknown", null)).toEqual({
      label: "Normal (OS sensors not exposed)",
      tone: "default",
    });
    expect(formatThermalSensorDisplay("nominal", 52.3)).toEqual({
      label: "52.3 °C · Nominal",
      tone: "default",
    });
    expect(formatThermalSensorDisplay("critical", 94.1)).toEqual({
      label: "94.1 °C · Critical",
      tone: "danger",
    });
  });
});
