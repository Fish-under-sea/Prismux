import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import os from "node:os";
import { test } from "node:test";
import { PersistentPtyPool } from "../pty/PersistentPtyPool.js";
import {
  ResourceMonitorService,
  computeNormalizedCpuPercent,
  normalizeHostMetricsReport,
  type OsProcessSnapshotEntry
} from "../system/ResourceMonitorService.js";

test("computeNormalizedCpuPercent aligns exactly with Windows Task Manager formula across core counts", () => {
  // 1 full logical core on 32-core host => 100 / 32 = 3.125 -> 3.13%
  assert.equal(computeNormalizedCpuPercent(1.0, 1.0, 32), 3.13);
  // 2.784 logical cores over 2.0s on 32-core host => (5.568 / (2.0 * 32)) * 100 = 8.7%
  assert.equal(computeNormalizedCpuPercent(5.568, 2.0, 32), 8.7);
  // 1 full core on 8-core host => 12.5%
  assert.equal(computeNormalizedCpuPercent(0.5, 0.5, 8), 12.5);
  // Clamping & defensive bounds
  assert.equal(computeNormalizedCpuPercent(-1, 1, 32), 0);
  assert.equal(computeNormalizedCpuPercent(1, 0, 32), 0);
  assert.equal(computeNormalizedCpuPercent(100, 1, 8), 100);
});

test("ResourceMonitorService does not double-divide Electron system-total percentCPUUsage on 32-core hosts and defaults omitted cpuScale to system-total", async () => {
  const pool = new PersistentPtyPool();
  const monitor = new ResourceMonitorService({
    ptyPool: pool,
    mainPid: 1000,
    treeCacheTtlMs: 0,
    sampleProcessTree: async () => new Map()
  });

  try {
    // Omitted cpuScale defaults to system-total (Electron app.getAppMetrics() native scale).
    const normalizedDefault = normalizeHostMetricsReport({
      collectedAt: Date.now(),
      mainPid: 1000,
      cpuCores: 32,
      electronProcesses: [
        { pid: 1000, type: "Browser", cpuPercent: 0.8, workingSetBytes: 120_000_000 },
        { pid: 1001, type: "Tab", name: "Workbench", cpuPercent: 4.2, workingSetBytes: 260_000_000 },
        { pid: 1002, type: "GPU", cpuPercent: 3.1, workingSetBytes: 180_000_000 },
        { pid: 1003, type: "Utility", name: "Network Service", cpuPercent: 0.6, workingSetBytes: 40_000_000 }
      ]
    });
    assert.ok(normalizedDefault !== null);
    assert.equal(normalizedDefault.cpuScale, "system-total");

    monitor.ingestHostMetrics(normalizedDefault);
    monitor.ingestHostMetrics({
      ...normalizedDefault,
      collectedAt: normalizedDefault.collectedAt + 2_000
    });

    const snap = await monitor.getResources({ forceRefresh: true });
    assert.equal(snap.desktop?.cpuPercent, 8.7);
    assert.ok(
      snap.totalCpuPercent !== null && snap.totalCpuPercent >= 8.7,
      `Expected totalCpuPercent >= 8.7 (not 32x-shrunk 0.1%), got ${String(snap.totalCpuPercent)}`
    );
  } finally {
    monitor.stop();
    await pool.dispose();
  }
});

test("ResourceMonitorService derives exact Electron CPU% from cumulativeCpuSeconds deltas even when competing app.getAppMetrics() calls zero percentCPUUsage", async () => {
  const pool = new PersistentPtyPool();
  const monitor = new ResourceMonitorService({
    ptyPool: pool,
    mainPid: 2000,
    treeCacheTtlMs: 0,
    sampleProcessTree: async () => new Map()
  });

  try {
    const t0 = Date.now() - 2_000;
    // Push 1: initial unprimed frame (percentCPUUsage === 0)
    monitor.ingestHostMetrics({
      collectedAt: t0,
      mainPid: 2000,
      cpuCores: 32,
      cpuScale: "system-total",
      electronProcesses: [
        { pid: 2000, type: "Browser", cpuPercent: 0, cumulativeCpuSeconds: 1.0, workingSetBytes: 100_000_000 },
        { pid: 2001, type: "Tab", name: "Main", cpuPercent: 0, cumulativeCpuSeconds: 2.0, workingSetBytes: 220_000_000 },
        { pid: 2002, type: "GPU", cpuPercent: 0, cumulativeCpuSeconds: 1.5, workingSetBytes: 160_000_000 }
      ]
    });

    // Push 2 (+2.0s wall clock on 32 cores):
    // Competing DesktopTelemetryPublisher stole app.getAppMetrics() right before push so percentCPUUsage === 0,
    // while cumulativeCpuSeconds grew by +0.512s (0.8%), +2.688s (4.2%), +1.984s (3.1%) => total 8.1%!
    monitor.ingestHostMetrics({
      collectedAt: t0 + 2_000,
      mainPid: 2000,
      cpuCores: 32,
      cpuScale: "system-total",
      electronProcesses: [
        { pid: 2000, type: "Browser", cpuPercent: 0, cumulativeCpuSeconds: 1.512, workingSetBytes: 100_000_000 },
        { pid: 2001, type: "Tab", name: "Main", cpuPercent: 0, cumulativeCpuSeconds: 4.688, workingSetBytes: 220_000_000 },
        { pid: 2002, type: "GPU", cpuPercent: 0, cumulativeCpuSeconds: 3.484, workingSetBytes: 160_000_000 }
      ]
    });

    const snap1 = await monitor.getResources({ forceRefresh: true });
    assert.equal(snap1.desktop?.cpuPercent, 8.1);

    // Calling getResources() again between pushes MUST NOT wipe or alter the computed Electron CPU%.
    await new Promise((r) => setTimeout(r, 80));
    const snap2 = await monitor.getResources({ forceRefresh: true });
    assert.equal(snap2.desktop?.cpuPercent, 8.1);
  } finally {
    monitor.stop();
    await pool.dispose();
  }
});

test("ResourceMonitorService preserves non-zero OS process CPU% across cached osTree hits within TTL", async () => {
  const pool = new PersistentPtyPool();
  let sampleCall = 0;
  const monitor = new ResourceMonitorService({
    ptyPool: pool,
    mainPid: 3000,
    t3ServerPid: 3001,
    treeCacheTtlMs: 2_000,
    sampleProcessTree: async () => {
      sampleCall += 1;
      const cpuSec = sampleCall === 1 ? 10.0 : 12.0; // +2.0s CPU time
      const map = new Map<number, OsProcessSnapshotEntry>([
        [
          3000,
          {
            pid: 3000,
            parentPid: 1,
            processName: "Prismux.exe",
            commandLine: "Prismux.exe",
            memoryBytes: 150_000_000,
            privateMemoryBytes: 100_000_000,
            cpuSeconds: sampleCall === 1 ? 5.0 : 5.5,
            cpuPercent: null
          }
        ],
        [
          3001,
          {
            pid: 3001,
            parentPid: 3000,
            processName: "node.exe",
            commandLine: "node apps/server/dist/index.mjs",
            memoryBytes: 120_000_000,
            privateMemoryBytes: 90_000_000,
            cpuSeconds: cpuSec,
            cpuPercent: null
          }
        ]
      ]);
      return map;
    }
  });

  try {
    // Frame 1: baseline
    await monitor.getResources({ forceRefresh: true });
    await new Promise((r) => setTimeout(r, 120));

    // Frame 2: real delta computed
    const snap2 = await monitor.getResources({ forceRefresh: true });
    assert.equal(sampleCall, 2);
    assert.ok(
      snap2.t3Server !== null &&
        snap2.t3Server.cpuPercent !== null &&
        snap2.t3Server.cpuPercent > 0,
      `Expected positive T3 Server CPU% on frame 2, got ${String(snap2.t3Server?.cpuPercent)}`
    );
    const measuredT3Cpu = snap2.t3Server.cpuPercent;

    // Frame 3: cache hit after 80ms (still within 2000ms treeCacheTtlMs) MUST NOT wipe CPU% to 0.0%!
    await new Promise((r) => setTimeout(r, 80));
    const snap3 = await monitor.getResources({ forceRefresh: false });
    assert.equal(sampleCall, 2, "Expected treeCacheTtlMs cache hit");
    assert.equal(
      snap3.t3Server?.cpuPercent,
      measuredT3Cpu,
      `Cached osTree hit wiped T3 Server CPU% from ${measuredT3Cpu} to ${String(snap3.t3Server?.cpuPercent)}`
    );
  } finally {
    monitor.stop();
    await pool.dispose();
  }
});

test("ResourceMonitorService preserves sub-0.1% process sums without early rounding loss and guarantees zero duplicate PIDs", async () => {
  const pool = new PersistentPtyPool();
  const monitor = new ResourceMonitorService({
    ptyPool: pool,
    mainPid: 4000,
    treeCacheTtlMs: 0,
    sampleProcessTree: async () => new Map()
  });

  try {
    // 10 Electron processes each consuming 0.04% system-total CPU => true sum is 0.4%, NOT 0.0%!
    const electronProcesses = Array.from({ length: 10 }, (_, i) => ({
      pid: 4000 + i,
      type: i === 0 ? "Browser" : "Utility",
      name: `Worker ${i}`,
      cpuPercent: 0.04,
      workingSetBytes: 20_000_000
    }));

    monitor.ingestHostMetrics({
      collectedAt: Date.now() - 2_000,
      mainPid: 4000,
      cpuCores: 32,
      cpuScale: "system-total",
      electronProcesses
    });
    monitor.ingestHostMetrics({
      collectedAt: Date.now(),
      mainPid: 4000,
      cpuCores: 32,
      cpuScale: "system-total",
      electronProcesses
    });

    const snap = await monitor.getResources({ forceRefresh: true });
    assert.equal(snap.desktop?.cpuPercent, 0.4);
    const uniquePids = new Set(snap.processes.map((p) => p.pid));
    assert.equal(uniquePids.size, snap.processes.length, "Processes list must contain unique PIDs");
  } finally {
    monitor.stop();
    await pool.dispose();
  }
});

test("ResourceMonitorService live calibration captures ~1-core CPU usage from a real Node burner child process", async () => {
  const pool = new PersistentPtyPool();
  const logicalCores = Math.max(1, os.cpus().length);
  const expectedOneCoreTotalPct = 100 / logicalCores;

  // Spawn a real Node child running a continuous 1-core busy loop for 6s
  const burner = spawn(
    process.execPath,
    [
      "-e",
      "const end = Date.now() + 6000; let acc = 0; while (Date.now() < end) { acc += Math.sqrt(12345.6789); } console.log(acc);"
    ],
    { stdio: "ignore", windowsHide: true }
  );

  assert.ok(typeof burner.pid === "number" && burner.pid > 0);
  const monitor = new ResourceMonitorService({
    ptyPool: pool,
    mainPid: process.pid,
    t3ServerPid: burner.pid,
    treeCacheTtlMs: 0
  });

  try {
    // Allow burner to enter tight loop
    await new Promise((r) => setTimeout(r, 150));

    // Pass 1: baseline snapshot
    await monitor.getResources({ forceRefresh: true });
    // Wait 350ms while burner saturates ~1 full logical core
    await new Promise((r) => setTimeout(r, 350));

    // Pass 2: real delta measurement
    const snap2 = await monitor.getResources({ forceRefresh: true });
    const burnerCpu = snap2.t3Server?.cpuPercent;

    assert.ok(
      typeof burnerCpu === "number" && burnerCpu > 0.5,
      `Expected live 1-core burner CPU% > 0.5% (expected ~${expectedOneCoreTotalPct.toFixed(2)}% on ${logicalCores} cores), got ${String(burnerCpu)}`
    );
    assert.ok(
      burnerCpu >= expectedOneCoreTotalPct * 0.4 && burnerCpu <= expectedOneCoreTotalPct * 1.85,
      `Expected live 1-core burner CPU% near ${expectedOneCoreTotalPct.toFixed(2)}% (±tolerance), got ${burnerCpu}%`
    );
    assert.ok(
      typeof snap2.totalCpuPercent === "number" && snap2.totalCpuPercent >= burnerCpu,
      `Expected totalCpuPercent (${String(snap2.totalCpuPercent)}) >= burnerCpu (${burnerCpu})`
    );
    // Verify totalCpuPercent equals rounded sum of unique process entries (zero double-counting).
    const processCpuSum = Math.round(
      snap2.processes.reduce((acc, p) => acc + (p.cpuPercent ?? 0), 0) * 10
    ) / 10;
    assert.equal(snap2.totalCpuPercent, processCpuSum);
  } finally {
    monitor.stop();
    try {
      burner.kill("SIGKILL");
    } catch {
      // Ignore exit race
    }
    await pool.dispose();
  }
});
