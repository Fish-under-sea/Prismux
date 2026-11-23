import { execFile } from "node:child_process";
import os from "node:os";
import { basename, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import type {
  KillSystemPtyResponse,
  ProcessCommitMetric,
  ProcessMemoryMetric,
  PtyResourceEntry,
  SystemResourcesResponse,
  WorkspaceResourceEntry
} from "@prismux/protocol";
import type { PersistentPtyPool } from "../pty/PersistentPtyPool.js";
import type { T3ServerSupervisor } from "../t3/T3ServerSupervisor.js";

const execFileAsync = promisify(execFile);

const DEFAULT_SAMPLE_TIMEOUT_MS = 1_500;
const STALE_IDLE_THRESHOLD_MS = 30 * 60 * 1000;
const MAX_HISTORY_SAMPLES = 30;

export interface ProcessUsageReading {
  pid: number;
  cpuPercent: number | null;
  memoryBytes: number | null;
  privateMemoryBytes?: number | null;
  /** Raw cumulative CPU seconds (used internally on Windows to derive CPU% deltas). */
  cpuSeconds?: number | null;
}

export interface ResourceMonitorServiceOptions {
  ptyPool: PersistentPtyPool;
  t3Supervisor?: T3ServerSupervisor;
  sampleTimeoutMs?: number;
  /** Injectable per-PID usage sampler for deterministic unit tests. */
  sampleProcesses?: (pids: number[]) => Promise<Map<number, ProcessUsageReading>>;
}

interface CpuTotals {
  idle: number;
  total: number;
}

interface PreviousProcCpu {
  cpuSeconds: number;
  sampledAtMs: number;
}

function readHostCpuTotals(): CpuTotals {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }
  return { idle, total };
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function appendBoundedHistory(history: number[], value: number): number[] {
  const next = [...history, value];
  if (next.length > MAX_HISTORY_SAMPLES) {
    return next.slice(next.length - MAX_HISTORY_SAMPLES);
  }
  return next;
}

async function defaultSampleProcesses(
  pids: number[],
  timeoutMs: number
): Promise<Map<number, ProcessUsageReading>> {
  const map = new Map<number, ProcessUsageReading>();
  const uniquePids = [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))];
  if (uniquePids.length === 0) {
    return map;
  }

  if (process.platform === "win32") {
    const idList = uniquePids.join(",");
    const psScript = `Get-Process -Id ${idList} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64,CPU | ConvertTo-Json -Compress`;
    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", psScript],
        {
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024
        }
      );
      const trimmed = stdout.trim();
      if (trimmed.length > 0) {
        const parsed = JSON.parse(trimmed) as unknown;
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        for (const row of rows) {
          if (typeof row !== "object" || row === null) continue;
          const rec = row as Record<string, unknown>;
          const pid = typeof rec["Id"] === "number" ? rec["Id"] : -1;
          if (pid <= 0) continue;
          const wsBytes =
            typeof rec["WorkingSet64"] === "number" &&
            Number.isFinite(rec["WorkingSet64"])
              ? rec["WorkingSet64"]
              : null;
          const privBytes =
            typeof rec["PrivateMemorySize64"] === "number" &&
            Number.isFinite(rec["PrivateMemorySize64"])
              ? rec["PrivateMemorySize64"]
              : null;
          const cpuSec =
            typeof rec["CPU"] === "number" && Number.isFinite(rec["CPU"])
              ? rec["CPU"]
              : null;
          map.set(pid, {
            pid,
            cpuPercent: null,
            memoryBytes: wsBytes,
            privateMemoryBytes: privBytes,
            cpuSeconds: cpuSec
          });
        }
      }
    } catch {
      // Non-fatal: gracefully return partial sample
    }
    return map;
  }

  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-o", "pid=,%cpu=,rss=", "-p", uniquePids.join(",")],
      { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }
    );
    for (const line of stdout.split(/\r?\n/)) {
      const match = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s*$/.exec(line);
      if (!match) continue;
      const pid = Number.parseInt(match[1]!, 10);
      const cpu = Number.parseFloat(match[2]!);
      const rssKb = Number.parseInt(match[3]!, 10);
      map.set(pid, {
        pid,
        cpuPercent: Number.isFinite(cpu) ? roundOneDecimal(cpu) : null,
        memoryBytes: Number.isFinite(rssKb) ? rssKb * 1024 : null
      });
    }
  } catch {
    // Non-fatal
  }
  return map;
}

/**
 * Aggregates host, Daemon, T3 Server, and PersistentPtyPool CPU/RAM metrics
 * attributed by workspace and PTY session (aligned with `stablyai/orca`
 * `process-stats-types.ts` & `ResourceUsageStatusSegment.tsx`), with sparkline
 * history ring buffers, Windows private-bytes commit metrics, and validated PTY cleanup.
 */
export class ResourceMonitorService {
  private readonly ptyPool: PersistentPtyPool;
  private readonly t3Supervisor: T3ServerSupervisor | undefined;
  private readonly sampleProcessesFn: (
    pids: number[]
  ) => Promise<Map<number, ProcessUsageReading>>;

  private lastHostCpu: CpuTotals | null = null;
  private lastDaemonCpuUsage: NodeJS.CpuUsage | null = null;
  private lastDaemonSampleAt: number | null = null;
  private readonly previousProcCpuByPid = new Map<number, PreviousProcCpu>();
  private appMemoryHistory: number[] = [];
  private readonly workspaceMemoryHistory = new Map<string, number[]>();

  constructor(options: ResourceMonitorServiceOptions) {
    const timeoutMs = options.sampleTimeoutMs ?? DEFAULT_SAMPLE_TIMEOUT_MS;
    this.ptyPool = options.ptyPool;
    this.t3Supervisor = options.t3Supervisor;
    this.sampleProcessesFn =
      options.sampleProcesses ??
      ((pids) => defaultSampleProcesses(pids, timeoutMs));
  }

  private resolveDerivedCpuPercent(
    reading: ProcessUsageReading | undefined,
    nowMs: number
  ): number | null {
    if (!reading) {
      return null;
    }
    if (reading.cpuPercent !== null) {
      return reading.cpuPercent;
    }
    if (reading.cpuSeconds === undefined || reading.cpuSeconds === null) {
      return null;
    }
    const prev = this.previousProcCpuByPid.get(reading.pid);
    this.previousProcCpuByPid.set(reading.pid, {
      cpuSeconds: reading.cpuSeconds,
      sampledAtMs: nowMs
    });
    if (!prev) {
      return null;
    }
    const elapsedSec = (nowMs - prev.sampledAtMs) / 1000;
    if (elapsedSec <= 0.05) {
      return null;
    }
    const deltaCpuSec = Math.max(0, reading.cpuSeconds - prev.cpuSeconds);
    // Single-core percentage (matches Orca `UsageValues.cpu`: can exceed 100 on multi-core).
    return roundOneDecimal((deltaCpuSec / elapsedSec) * 100);
  }

  private sampleHostCpuPercent(): number | null {
    const current = readHostCpuTotals();
    const prev = this.lastHostCpu;
    this.lastHostCpu = current;
    if (!prev) {
      return null;
    }
    const deltaTotal = current.total - prev.total;
    const deltaIdle = current.idle - prev.idle;
    if (deltaTotal <= 0) {
      return 0;
    }
    const busy = Math.max(0, deltaTotal - deltaIdle);
    return roundOneDecimal(Math.min(100, (busy / deltaTotal) * 100));
  }

  private sampleDaemonCpuPercent(nowMs: number): number | null {
    const currentUsage = process.cpuUsage();
    const prevUsage = this.lastDaemonCpuUsage;
    const prevAt = this.lastDaemonSampleAt;
    this.lastDaemonCpuUsage = currentUsage;
    this.lastDaemonSampleAt = nowMs;

    if (!prevUsage || prevAt === null) {
      return 0;
    }
    const elapsedMs = Math.max(1, nowMs - prevAt);
    const deltaCpuMicros =
      currentUsage.user - prevUsage.user + (currentUsage.system - prevUsage.system);
    const cpuCores = Math.max(1, os.cpus().length);
    const rawPercent = (deltaCpuMicros / (elapsedMs * 1000 * cpuCores)) * 100;
    return roundOneDecimal(Math.max(0, Math.min(100, rawPercent)));
  }

  async getResources(): Promise<SystemResourcesResponse> {
    const now = Date.now();
    const hostTotalMem = os.totalmem();
    const hostFreeMem = os.freemem();
    const hostUsedMem = Math.max(0, hostTotalMem - hostFreeMem);
    const hostCpuPercent = this.sampleHostCpuPercent();
    const daemonCpuPercent = this.sampleDaemonCpuPercent(now);
    const daemonMemBytes = process.memoryUsage().rss;

    const processMemoryMetric: ProcessMemoryMetric =
      process.platform === "win32"
        ? "working-set"
        : process.platform === "darwin"
          ? "footprint"
          : "rss";
    const processCommitMetric: ProcessCommitMetric | undefined =
      process.platform === "win32" ? "private-bytes" : undefined;

    const t3Status = this.t3Supervisor?.getStatus();
    const t3Pid =
      typeof t3Status?.pid === "number" && t3Status.pid > 0 ? t3Status.pid : null;

    const ptyInfos = this.ptyPool.listSessionRuntimeInfos();
    const pidsToSample: number[] = [];
    if (process.platform === "win32") {
      pidsToSample.push(process.pid);
    }
    if (t3Pid !== null) {
      pidsToSample.push(t3Pid);
    }
    for (const info of ptyInfos) {
      if (info.alive && info.pid !== null && info.pid > 0) {
        pidsToSample.push(info.pid);
      }
    }

    const sampledMap =
      pidsToSample.length > 0
        ? await this.sampleProcessesFn(pidsToSample)
        : new Map<number, ProcessUsageReading>();

    // Prune stale PID CPU history entries no longer sampled
    const livePidSet = new Set(pidsToSample);
    for (const trackedPid of this.previousProcCpuByPid.keys()) {
      if (!livePidSet.has(trackedPid)) {
        this.previousProcCpuByPid.delete(trackedPid);
      }
    }

    const daemonSample = sampledMap.get(process.pid);
    const t3Sample = t3Pid !== null ? sampledMap.get(t3Pid) : undefined;
    const t3Cpu = this.resolveDerivedCpuPercent(t3Sample, now);
    const t3Server =
      t3Status !== undefined
        ? {
            pid: t3Pid,
            cpuPercent: t3Cpu,
            memoryBytes: t3Sample?.memoryBytes ?? null,
            ...(t3Sample?.privateMemoryBytes !== undefined
              ? { privateMemoryBytes: t3Sample.privateMemoryBytes }
              : {}),
            state: t3Status.state
          }
        : null;

    const ptyEntries: PtyResourceEntry[] = ptyInfos.map((info) => {
      const sample = info.pid !== null ? sampledMap.get(info.pid) : undefined;
      const cpuPercent = this.resolveDerivedCpuPercent(sample, now);
      const memoryBytes = sample?.memoryBytes ?? null;
      const idleMs = Math.max(0, now - info.lastActivityAt);
      const normalizedCwd = resolve(info.cwd);
      const stale = !info.alive || idleMs >= STALE_IDLE_THRESHOLD_MS;
      const title =
        info.worktreeBranch && info.worktreeBranch.trim().length > 0
          ? `${basename(normalizedCwd)} (${info.worktreeBranch})`
          : basename(normalizedCwd) || info.ptyId;

      return {
        sessionId: info.ptyId,
        pid: info.pid,
        workspace: normalizedCwd,
        cwd: normalizedCwd,
        command: info.command,
        title,
        group: info.group,
        cpuPercent,
        memoryBytes,
        ...(sample?.privateMemoryBytes !== undefined
          ? { privateMemoryBytes: sample.privateMemoryBytes }
          : {}),
        hasLocalSamples: memoryBytes !== null || cpuPercent !== null,
        bufferBytes: info.bufferBytes,
        alive: info.alive,
        stale,
        idleMs
      };
    });

    const workspaceMap = new Map<string, PtyResourceEntry[]>();
    for (const entry of ptyEntries) {
      const key = entry.workspace ?? entry.cwd;
      const list = workspaceMap.get(key);
      if (list) {
        list.push(entry);
      } else {
        workspaceMap.set(key, [entry]);
      }
    }

    // Prune workspace histories for departed workspaces
    for (const wsKey of this.workspaceMemoryHistory.keys()) {
      if (!workspaceMap.has(wsKey)) {
        this.workspaceMemoryHistory.delete(wsKey);
      }
    }

    const workspaces: WorkspaceResourceEntry[] = [...workspaceMap.entries()]
      .map(([workspacePath, ptys]) => {
        let cpuSum = 0;
        let hasCpu = false;
        let memSum = 0;
        let hasMem = false;
        let privSum = 0;
        let hasPriv = false;
        let aliveCount = 0;
        let staleCount = 0;

        for (const pty of ptys) {
          if (pty.alive) aliveCount += 1;
          if (pty.stale) staleCount += 1;
          if (pty.cpuPercent !== null) {
            cpuSum += pty.cpuPercent;
            hasCpu = true;
          }
          if (pty.memoryBytes !== null) {
            memSum += pty.memoryBytes;
            hasMem = true;
          }
          if (
            pty.privateMemoryBytes !== undefined &&
            pty.privateMemoryBytes !== null
          ) {
            privSum += pty.privateMemoryBytes;
            hasPriv = true;
          }
        }

        const prevWsHistory = this.workspaceMemoryHistory.get(workspacePath) ?? [];
        const nextWsHistory = hasMem
          ? appendBoundedHistory(prevWsHistory, memSum)
          : prevWsHistory;
        this.workspaceMemoryHistory.set(workspacePath, nextWsHistory);

        return {
          workspace: workspacePath,
          label: basename(workspacePath) || workspacePath,
          cpuPercent: hasCpu ? roundOneDecimal(cpuSum) : null,
          memoryBytes: hasMem ? memSum : null,
          ...(hasPriv ? { privateMemoryBytes: privSum } : {}),
          hasLocalSamples: hasMem || hasCpu,
          history: nextWsHistory,
          ptyCount: ptys.length,
          alivePtyCount: aliveCount,
          stalePtyCount: staleCount,
          ptys
        };
      })
      .sort((a, b) => a.workspace.localeCompare(b.workspace));

    let totalManagedMem = daemonMemBytes + (t3Server?.memoryBytes ?? 0);
    let totalManagedCpu = daemonCpuPercent ?? 0;
    let hasManagedCpu = daemonCpuPercent !== null;
    let totalPrivMem = 0;
    let hasPrivMem = false;

    if (
      daemonSample?.privateMemoryBytes !== undefined &&
      daemonSample.privateMemoryBytes !== null
    ) {
      totalPrivMem += daemonSample.privateMemoryBytes;
      hasPrivMem = true;
    }
    if (
      t3Server?.privateMemoryBytes !== undefined &&
      t3Server.privateMemoryBytes !== null
    ) {
      totalPrivMem += t3Server.privateMemoryBytes;
      hasPrivMem = true;
    }
    if (t3Server?.cpuPercent !== null && t3Server?.cpuPercent !== undefined) {
      totalManagedCpu += t3Server.cpuPercent;
      hasManagedCpu = true;
    }
    for (const pty of ptyEntries) {
      if (pty.memoryBytes !== null) {
        totalManagedMem += pty.memoryBytes;
      }
      if (
        pty.privateMemoryBytes !== undefined &&
        pty.privateMemoryBytes !== null
      ) {
        totalPrivMem += pty.privateMemoryBytes;
        hasPrivMem = true;
      }
      if (pty.cpuPercent !== null) {
        totalManagedCpu += pty.cpuPercent;
        hasManagedCpu = true;
      }
    }

    this.appMemoryHistory = appendBoundedHistory(
      this.appMemoryHistory,
      totalManagedMem
    );
    const orphanCount = ptyEntries.filter((p) => p.stale).length;

    return {
      ok: true,
      collectedAt: now,
      sampledAt: now,
      processMemoryMetric,
      ...(processCommitMetric !== undefined ? { processCommitMetric } : {}),
      totalCpuPercent: hasManagedCpu ? roundOneDecimal(totalManagedCpu) : null,
      totalMemoryBytes: totalManagedMem,
      ...(hasPrivMem ? { totalPrivateMemoryBytes: totalPrivMem } : {}),
      hostMemoryTotalBytes: hostTotalMem,
      orphanCount,
      history: [...this.appMemoryHistory],
      host: {
        platform: process.platform,
        cpuCores: os.cpus().length,
        cpuPercent: hostCpuPercent,
        memoryBytes: hostUsedMem,
        totalMemoryBytes: hostTotalMem,
        freeMemoryBytes: hostFreeMem,
        availableMemoryBytes: hostFreeMem,
        memoryUsedPercent:
          hostTotalMem > 0
            ? roundOneDecimal((hostUsedMem / hostTotalMem) * 100)
            : 0,
        loadAvg: os.loadavg().map((n) => roundOneDecimal(n)),
        uptimeSec: Math.round(os.uptime())
      },
      daemon: {
        pid: process.pid,
        cpuPercent: daemonCpuPercent,
        memoryBytes: daemonMemBytes,
        ...(daemonSample?.privateMemoryBytes !== undefined
          ? { privateMemoryBytes: daemonSample.privateMemoryBytes }
          : {})
      },
      t3Server,
      workspaces,
      ptys: ptyEntries
    };
  }

  async killPtySession(
    rawSessionId: unknown,
    signal?: string
  ): Promise<{ statusCode: number; payload: KillSystemPtyResponse }> {
    if (typeof rawSessionId !== "string" || rawSessionId.trim().length === 0) {
      return {
        statusCode: 400,
        payload: {
          ok: false,
          sessionId: "",
          killed: false,
          removed: false,
          message: "参数 sessionId 必须是非空字符串。"
        }
      };
    }

    const sessionId = rawSessionId.trim();
    const outcome = await this.ptyPool.killAndRemoveSession(
      sessionId,
      signal ?? "SIGTERM"
    );
    if (!outcome.existed) {
      return {
        statusCode: 404,
        payload: {
          ok: false,
          sessionId,
          killed: false,
          removed: false,
          message: `未找到 PTY 会话「${sessionId}」。`
        }
      };
    }

    return {
      statusCode: 200,
      payload: {
        ok: true,
        sessionId,
        killed: outcome.killed,
        removed: outcome.removed,
        message: outcome.killed
          ? `已终止并清理 PTY 会话「${sessionId}」。`
          : `已清理僵死 PTY 会话记录「${sessionId}」。`
      }
    };
  }
}
