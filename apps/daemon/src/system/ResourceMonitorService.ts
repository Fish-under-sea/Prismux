import { execFile } from "node:child_process";
import os from "node:os";
import { basename, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import {
  CANONICAL_PROVIDER_DISPLAY_NAMES,
  type KillSystemPtyResponse,
  type ProcessCommitMetric,
  type ProcessMemoryMetric,
  type PtyResourceEntry,
  type SystemResourcesResponse,
  type WorkspaceResourceEntry,
} from "@prismux/protocol";
import type { PersistentPtyPool } from "../pty/PersistentPtyPool.js";
import type { CoreRpcClient } from "../core/CoreRpcClient.js";
import type { CoreServerSupervisor } from "../core/CoreServerSupervisor.js";

const execFileAsync = promisify(execFile);

const DEFAULT_SAMPLE_TIMEOUT_MS = 5_000;
const DEFAULT_TREE_CACHE_TTL_MS = 10_000;
const DEFAULT_BACKGROUND_SAMPLE_INTERVAL_MS = 5_000;
const HOST_METRICS_FRESH_TTL_MS = 15_000;
const STALE_IDLE_THRESHOLD_MS = 30 * 60 * 1000;
const MAX_HISTORY_SAMPLES = 30;
const DAEMON_CPU_SLIDING_WINDOW_SIZE = 3;
const MIN_CPU_DELTA_MS = 200;
const MAX_DESCENDANT_DEPTH = 8;
const MAX_ATTRIBUTED_PROCESSES = 200;
const SELF_PROBE_MARKER = "PRISMUX_RES_PROBE";

export interface ProcessUsageReading {
  pid: number;
  cpuPercent: number | null;
  memoryBytes: number | null;
  privateMemoryBytes?: number | null;
  /** Windows Task Manager "Memory (Private Working Set)" in bytes, excluding shared pages. */
  privateWorkingSetBytes?: number | null;
  /** Raw cumulative CPU seconds (used internally on Windows to derive CPU% deltas). */
  cpuSeconds?: number | null;
}

export interface OsProcessSnapshotEntry {
  pid: number;
  parentPid: number | null;
  processName: string;
  commandLine: string | null;
  memoryBytes: number | null;
  privateMemoryBytes: number | null;
  /** Windows Task Manager "Memory (Private Working Set)" in bytes when queried from PerfProc. */
  privateWorkingSetBytes?: number | null;
  cpuSeconds: number | null;
  cpuPercent: number | null;
  /** Exact wall-clock epoch ms when OS process CPU counters were captured (immune to post-query overhead). */
  sampledAtMs?: number;
}

export interface HostElectronProcessMetric {
  pid: number;
  type: string;
  name?: string;
  serviceName?: string;
  creationTimeMs?: number;
  cpuPercent: number | null;
  cumulativeCpuSeconds?: number | null;
  workingSetBytes: number;
  privateMemoryBytes?: number | null;
  peakWorkingSetBytes?: number | null;
}

export interface HostCoreServerInfo {
  pid: number | null;
  ready: boolean;
  desiredRunning?: boolean;
  state?: string;
  hostedBy?: "electron" | "electron-in-process" | "daemon-supervisor" | "external";
  httpUrl?: string | null;
}

export interface HostMetricsReport {
  collectedAt: number;
  mainPid: number;
  cpuCores?: number;
  cpuScale?: "single-core" | "system-total";
  coreServer?: HostCoreServerInfo | null;
  electronProcesses: HostElectronProcessMetric[];
}

export interface HostMetricsIngestResult {
  ok: true;
  receivedAt: number;
  acceptedProcesses: number;
  mainPid: number | null;
  coreServerPid: number | null;
}

export type ProcessAttributionRole =
  | "electron-main"
  | "electron-renderer"
  | "electron-gpu"
  | "electron-utility"
  | "core-server"
  | "daemon"
  | "agent"
  | "terminal"
  | "pty"
  | "child";

export type ProcessAttributionCategory = "desktop" | "core" | "terminal" | "agent";

export interface ProcessAttributionEntry {
  pid: number;
  parentPid: number | null;
  name: string;
  processName: string;
  commandLine?: string | null;
  role: ProcessAttributionRole;
  category: ProcessAttributionCategory;
  cpuPercent: number | null;
  memoryBytes: number | null;
  privateMemoryBytes?: number | null;
  alive: boolean;
  source: "electron" | "daemon-self" | "os-tree" | "pty-pool";
  sessionId?: string | null;
  workspace?: string | null;
  stale?: boolean;
}

export interface DesktopResourcesSummary {
  pid: number | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
  privateMemoryBytes?: number | null;
  processCount: number;
  source: "electron-app-metrics" | "process-tree" | "mixed";
}

export interface ExtendedCoreServerResources {
  pid: number | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
  privateMemoryBytes?: number | null;
  state: string;
  hostedBy?: "electron" | "electron-in-process" | "daemon-supervisor" | "external";
  label?: string;
  childCount?: number;
}

export interface ExtendedSystemResourcesResponse extends Omit<
  SystemResourcesResponse,
  "coreServer"
> {
  coreServer: ExtendedCoreServerResources | null;
  desktop: DesktopResourcesSummary | null;
  processes: ProcessAttributionEntry[];
  processCount: number;
  activeAgentCount: number;
  activeTerminalCount: number;
  hostMetricsSource: "electron-push" | "process-tree" | "hybrid" | "daemon-only";
  hostMetricsUpdatedAt: number | null;
}

export interface GetResourcesOptions {
  forceRefresh?: boolean;
}

export interface ResourceMonitorServiceOptions {
  ptyPool: PersistentPtyPool;
  coreSupervisor?: CoreServerSupervisor;
  coreRpcClient?: CoreRpcClient;
  coreServerUrl?: string;
  /** @deprecated Use coreSupervisor */
  t3Supervisor?: CoreServerSupervisor;
  /** @deprecated Use coreRpcClient */
  t3RpcClient?: CoreRpcClient;
  /** @deprecated Use coreServerUrl */
  t3ServerUrl?: string;
  mainPid?: number | null;
  coreServerPid?: number | null;
  sampleTimeoutMs?: number;
  treeCacheTtlMs?: number;
  backgroundSampleIntervalMs?: number;
  /** Injectable per-PID usage sampler for deterministic unit tests. */
  sampleProcesses?: (pids: number[]) => Promise<Map<number, ProcessUsageReading>>;
  /** Injectable full OS process tree sampler for deterministic unit tests. */
  sampleProcessTree?: () => Promise<Map<number, OsProcessSnapshotEntry>>;
}

interface CpuTotals {
  idle: number;
  total: number;
}

interface PreviousProcCpu {
  cpuSeconds: number;
  sampledAtMs: number;
  lastCpuPercent: number | null;
}

interface PreviousElectronCpu {
  cumulativeCpuSeconds: number | null;
  collectedAtMs: number;
  lastCpuPercent: number | null;
  pushCount: number;
}

interface CachedHostMetrics {
  report: HostMetricsReport;
  receivedAt: number;
}

interface CachedProcessTree {
  entries: Map<number, OsProcessSnapshotEntry>;
  sampledAtMs: number;
  cpuSampledAtMs: number;
}

interface ProcessTreeLookupResult {
  entries: Map<number, OsProcessSnapshotEntry>;
  sampledAtMs: number;
  fromCache: boolean;
}

function readHostCpuTotals(): CpuTotals {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 100) return 100;
  return roundOneDecimal(value);
}

function clampPercentPrecise(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 100) return 100;
  return roundTwoDecimals(value);
}

/**
 * Windows Task Manager standard total-system CPU% normalization formula:
 * `processCpuPercent = (deltaCpuSeconds / (elapsedSeconds * logicalCpuCores)) * 100`,
 * clamped to `[0, 100]` with 2-decimal precision so summing many low-CPU processes
 * never drops real usage due to premature 1-decimal truncation.
 */
export function computeNormalizedCpuPercent(
  deltaCpuSeconds: number,
  elapsedSeconds: number,
  cpuCores: number,
): number {
  if (
    !Number.isFinite(deltaCpuSeconds) ||
    !Number.isFinite(elapsedSeconds) ||
    elapsedSeconds <= 0
  ) {
    return 0;
  }
  const safeDelta = Math.max(0, deltaCpuSeconds);
  const safeCores = Math.max(1, Number.isFinite(cpuCores) ? cpuCores : 1);
  return clampPercentPrecise((safeDelta / (elapsedSeconds * safeCores)) * 100);
}

function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function parseNonNegativeNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number.parseFloat(raw.trim());
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

function appendBoundedHistory(history: number[], value: number): number[] {
  const next = [...history, value];
  if (next.length > MAX_HISTORY_SAMPLES) {
    return next.slice(next.length - MAX_HISTORY_SAMPLES);
  }
  return next;
}

function normalizeProcessStem(name: string): string {
  return basename(name.trim())
    .toLowerCase()
    .replace(/\.exe$/i, "");
}

function isTransientSelfProbe(
  entry: Pick<OsProcessSnapshotEntry, "parentPid" | "processName" | "commandLine">,
  daemonPid: number,
): boolean {
  const cmd = entry.commandLine ?? "";
  if (cmd.includes(SELF_PROBE_MARKER)) {
    return true;
  }
  if (entry.parentPid === daemonPid) {
    const stem = normalizeProcessStem(entry.processName);
    if (
      (stem === "powershell" || stem === "pwsh") &&
      (cmd.includes("Win32_Process") || cmd.includes("Get-Process -Id"))
    ) {
      return true;
    }
    if (stem === "ps" && cmd.includes("pid=,ppid=")) {
      return true;
    }
  }
  return false;
}

/**
 * Parses tab-separated Windows `Win32_Process` rows emitted by the zero-window
 * PowerShell CIM sampler into structured `OsProcessSnapshotEntry` records.
 */
export function parseWindowsProcessTreeTsv(stdout: string): Map<number, OsProcessSnapshotEntry> {
  const map = new Map<number, OsProcessSnapshotEntry>();
  for (const rawLine of stdout.split(/\r?\n/)) {
    if (!rawLine || rawLine.trim().length === 0) continue;
    const cols = rawLine.split("\t");
    if (cols.length < 7) continue;

    const pid = parsePositiveInt(cols[0]);
    if (pid === null) continue;

    const parentPid = parsePositiveInt(cols[1]);
    const processName = cols[2]?.trim() || `pid-${pid}`;
    const memoryBytes = parseNonNegativeNumber(cols[3]);
    const privateMemoryBytes = parseNonNegativeNumber(cols[4]);
    const kernelTicks = parseNonNegativeNumber(cols[5]);
    const userTicks = parseNonNegativeNumber(cols[6]);
    const cpuSeconds =
      kernelTicks !== null || userTicks !== null
        ? ((kernelTicks ?? 0) + (userTicks ?? 0)) / 10_000_000
        : null;
    const commandLine = cols.slice(7).join("\t").trim() || null;

    map.set(pid, {
      pid,
      parentPid,
      processName,
      commandLine,
      memoryBytes,
      privateMemoryBytes,
      cpuSeconds,
      cpuPercent: null,
    });
  }
  return map;
}

/**
 * Parses POSIX `ps -eo pid=,ppid=,pcpu=,rss=,comm=,args=` output into
 * `OsProcessSnapshotEntry` records with total-system CPU% normalization.
 */
export function parseUnixProcessTreeOutput(
  stdout: string,
  cpuCores: number = Math.max(1, os.cpus().length),
): Map<number, OsProcessSnapshotEntry> {
  const map = new Map<number, OsProcessSnapshotEntry>();
  const cores = Math.max(1, cpuCores);
  for (const rawLine of stdout.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(rawLine);
    if (!match) continue;
    const pid = Number.parseInt(match[1]!, 10);
    const parentPidRaw = Number.parseInt(match[2]!, 10);
    const rawCpu = Number.parseFloat(match[3]!);
    const rssKb = Number.parseInt(match[4]!, 10);
    const processName = match[5]!;
    const commandLine = match[6]?.trim() || null;
    if (!Number.isInteger(pid) || pid <= 0) continue;

    map.set(pid, {
      pid,
      parentPid: Number.isInteger(parentPidRaw) && parentPidRaw > 0 ? parentPidRaw : null,
      processName,
      commandLine,
      memoryBytes: Number.isFinite(rssKb) && rssKb >= 0 ? rssKb * 1024 : null,
      privateMemoryBytes: null,
      cpuSeconds: null,
      cpuPercent:
        Number.isFinite(rawCpu) && rawCpu >= 0 ? clampPercentPrecise(rawCpu / cores) : null,
    });
  }
  return map;
}

/**
 * Parses 9-column tab-separated Windows rows that include `WorkingSetPrivate`
 * (column 7, from `Win32_PerfRawData_PerfProc_Process`) before `CommandLine`.
 */
export function parseWindowsProcessTreeWithPrivateWsTsv(
  stdout: string,
): Map<number, OsProcessSnapshotEntry> {
  const map = new Map<number, OsProcessSnapshotEntry>();
  let sampleTsMs: number | undefined;
  for (const rawLine of stdout.split(/\r?\n/)) {
    if (!rawLine || rawLine.trim().length === 0) continue;
    if (rawLine.startsWith("#TS\t")) {
      const parsedTs = parsePositiveInt(rawLine.slice(4));
      if (parsedTs !== null) {
        sampleTsMs = parsedTs;
      }
      continue;
    }
    const cols = rawLine.split("\t");
    if (cols.length < 8) continue;

    const pid = parsePositiveInt(cols[0]);
    if (pid === null) continue;

    const parentPid = parsePositiveInt(cols[1]);
    const processName = cols[2]?.trim() || `pid-${pid}`;
    const workingSetBytes = parseNonNegativeNumber(cols[3]);
    const privateMemoryBytes = parseNonNegativeNumber(cols[4]);
    const kernelTicks = parseNonNegativeNumber(cols[5]);
    const userTicks = parseNonNegativeNumber(cols[6]);
    const privateWorkingSetBytes = parseNonNegativeNumber(cols[7]);
    const cpuSeconds =
      kernelTicks !== null || userTicks !== null
        ? ((kernelTicks ?? 0) + (userTicks ?? 0)) / 10_000_000
        : null;
    const commandLine = cols.slice(8).join("\t").trim() || null;

    map.set(pid, {
      pid,
      parentPid,
      processName,
      commandLine,
      memoryBytes: privateWorkingSetBytes ?? workingSetBytes,
      privateMemoryBytes,
      privateWorkingSetBytes,
      cpuSeconds,
      cpuPercent: null,
      ...(sampleTsMs !== undefined ? { sampledAtMs: sampleTsMs } : {}),
    });
  }
  return map;
}

async function defaultSampleProcessTree(
  timeoutMs: number,
  familyRootPids: readonly number[] = [],
): Promise<Map<number, OsProcessSnapshotEntry>> {
  if (process.platform === "win32") {
    // Fast Win32_Process dump + filtered Win32_PerfRawData_PerfProc_Process.WorkingSetPrivate
    // ONLY for Prismux family PIDs (exact Task Manager Memory column without Chromium/Electron
    // shared-page double counting, ~4x faster than scanning all system PerfProc counters).
    const sanitizedRoots = [
      ...new Set(familyRootPids.filter((pid) => Number.isInteger(pid) && pid > 0)),
    ];
    const rootInit =
      sanitizedRoots.length > 0 ? `@(${sanitizedRoots.join(",")})` : `@(${process.pid})`;
    const psScript = [
      `<# ${SELF_PROBE_MARKER} #>`,
      "$ErrorActionPreference='SilentlyContinue'",
      "$procs = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount,KernelModeTime,UserModeTime,CommandLine)",
      "$sampleTsMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()",
      "$byParent = @{}",
      "foreach ($p in $procs) {",
      "  $ppid = [int]$p.ParentProcessId",
      "  if (-not $byParent.ContainsKey($ppid)) { $byParent[$ppid] = [System.Collections.Generic.List[int]]::new() }",
      "  $byParent[$ppid].Add([int]$p.ProcessId)",
      "}",
      "$family = [System.Collections.Generic.HashSet[int]]::new()",
      "$queue = [System.Collections.Generic.Queue[int]]::new()",
      `foreach ($r in ${rootInit}) { if ($family.Add([int]$r)) { $queue.Enqueue([int]$r) } }`,
      "while ($queue.Count -gt 0 -and $family.Count -lt 96) {",
      "  $cur = $queue.Dequeue()",
      "  if ($byParent.ContainsKey($cur)) {",
      "    foreach ($ch in $byParent[$cur]) { if ($family.Add($ch)) { $queue.Enqueue($ch) } }",
      "  }",
      "}",
      "$pwsMap = @{}",
      "if ($family.Count -gt 0) {",
      "  try {",
      "    $filter = (@($family) | ForEach-Object { \"IDProcess=$_\" }) -join ' OR '",
      "    Get-CimInstance Win32_PerfRawData_PerfProc_Process -Filter $filter -Property IDProcess,WorkingSetPrivate | ForEach-Object {",
      "      if ($_.IDProcess -gt 0 -and $_.WorkingSetPrivate -ge 0) { $pwsMap[[int]$_.IDProcess] = [int64]$_.WorkingSetPrivate }",
      "    }",
      "  } catch {}",
      "}",
      '"#TS`t$sampleTsMs"',
      "foreach ($p in $procs) {",
      "  $c = if ($p.CommandLine) { ($p.CommandLine -replace '[\\r\\n\\t]+', ' ').Trim() } else { '' }",
      "  if ($c.Length -gt 320) { $c = $c.Substring(0, 320) }",
      "  $pidInt = [int]$p.ProcessId",
      "  $pws = if ($pwsMap.ContainsKey($pidInt)) { $pwsMap[$pidInt] } else { '' }",
      '  "$($p.ProcessId)`t$($p.ParentProcessId)`t$($p.Name)`t$($p.WorkingSetSize)`t$($p.PrivatePageCount)`t$($p.KernelModeTime)`t$($p.UserModeTime)`t$pws`t$c"',
      "}",
    ].join("\n");

    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", psScript],
        {
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      return parseWindowsProcessTreeWithPrivateWsTsv(stdout);
    } catch {
      return new Map();
    }
  }

  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid=,pcpu=,rss=,comm=,args="], {
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseUnixProcessTreeOutput(stdout, os.cpus().length);
  } catch {
    return new Map();
  }
}

async function defaultSampleProcesses(
  pids: number[],
  timeoutMs: number,
): Promise<Map<number, ProcessUsageReading>> {
  const map = new Map<number, ProcessUsageReading>();
  const uniquePids = [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))];
  if (uniquePids.length === 0) {
    return map;
  }

  if (process.platform === "win32") {
    const idList = uniquePids.join(",");
    const filter = uniquePids.map((pid) => `IDProcess=${pid}`).join(" OR ");
    const psScript = [
      `<# ${SELF_PROBE_MARKER} #>`,
      "$ErrorActionPreference='SilentlyContinue'",
      "$pwsMap = @{}",
      "try {",
      `  Get-CimInstance Win32_PerfRawData_PerfProc_Process -Filter '${filter}' -Property IDProcess,WorkingSetPrivate | ForEach-Object {`,
      "    if ($_.IDProcess -gt 0 -and $_.WorkingSetPrivate -ge 0) { $pwsMap[[int]$_.IDProcess] = [int64]$_.WorkingSetPrivate }",
      "  }",
      "} catch {}",
      `Get-Process -Id ${idList} -ErrorAction SilentlyContinue | ForEach-Object {`,
      "  $pws = if ($pwsMap.ContainsKey($_.Id)) { $pwsMap[$_.Id] } else { $null }",
      "  [PSCustomObject]@{ Id = $_.Id; WorkingSet64 = $_.WorkingSet64; PrivateWorkingSet64 = $pws; PrivateMemorySize64 = $_.PrivateMemorySize64; CPU = $_.CPU }",
      "} | ConvertTo-Json -Compress",
    ].join("\n");
    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", psScript],
        {
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
        },
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
            typeof rec["WorkingSet64"] === "number" && Number.isFinite(rec["WorkingSet64"])
              ? rec["WorkingSet64"]
              : null;
          const pwsBytes =
            typeof rec["PrivateWorkingSet64"] === "number" &&
            Number.isFinite(rec["PrivateWorkingSet64"])
              ? rec["PrivateWorkingSet64"]
              : null;
          const privBytes =
            typeof rec["PrivateMemorySize64"] === "number" &&
            Number.isFinite(rec["PrivateMemorySize64"])
              ? rec["PrivateMemorySize64"]
              : null;
          const cpuSec =
            typeof rec["CPU"] === "number" && Number.isFinite(rec["CPU"]) ? rec["CPU"] : null;
          map.set(pid, {
            pid,
            cpuPercent: null,
            memoryBytes: pwsBytes ?? wsBytes,
            privateMemoryBytes: privBytes,
            privateWorkingSetBytes: pwsBytes,
            cpuSeconds: cpuSec,
          });
        }
      }
    } catch {
      // Non-fatal: gracefully return partial sample
    }
    return map;
  }

  const cpuCores = Math.max(1, os.cpus().length);
  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-o", "pid=,%cpu=,rss=", "-p", uniquePids.join(",")],
      { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
    );
    for (const line of stdout.split(/\r?\n/)) {
      const match = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s*$/.exec(line);
      if (!match) continue;
      const pid = Number.parseInt(match[1]!, 10);
      const cpu = Number.parseFloat(match[2]!);
      const rssKb = Number.parseInt(match[3]!, 10);
      map.set(pid, {
        pid,
        cpuPercent: Number.isFinite(cpu) ? clampPercentPrecise(cpu / cpuCores) : null,
        memoryBytes: Number.isFinite(rssKb) ? rssKb * 1024 : null,
      });
    }
  } catch {
    // Non-fatal
  }
  return map;
}

const SHELL_PROCESS_NAMES = new Map<string, string>([
  ["pwsh", "PowerShell 7"],
  ["powershell", "Windows PowerShell"],
  ["cmd", "Command Prompt"],
  ["bash", "Bash Shell"],
  ["zsh", "Zsh Shell"],
  ["fish", "Fish Shell"],
  ["sh", "POSIX Shell"],
  ["wsl", "WSL Bridge"],
  ["wslhost", "WSL Host"],
  ["openconsole", "OpenConsole PTY"],
  ["conhost", "Console Host"],
]);

const AGENT_PATTERNS: ReadonlyArray<{
  readonly regex: RegExp;
  readonly label: string;
}> = [
  {
    regex: /(?:^|[\\/.\s-])(claude(?:-code)?|@anthropic-ai[\\/]claude-code)(?:$|[\\/.\s-])/i,
    label: CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent,
  },
  {
    regex: /(?:^|[\\/.\s-])(codex|@openai[\\/]codex)(?:$|[\\/.\s-])/i,
    label: `${CANONICAL_PROVIDER_DISPLAY_NAMES.codex} Agent`,
  },
  {
    regex: /(?:^|[\\/.\s-])(agy|antigravity)(?:$|[\\/.\s-])/i,
    label: `${CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity} ACP`,
  },
  {
    regex: /(?:^|[\\/.\s-])(gemini(?:-cli)?)(?:$|[\\/.\s-])/i,
    label: CANONICAL_PROVIDER_DISPLAY_NAMES.gemini,
  },
  { regex: /(?:^|[\\/.\s-])(opencode|cursor-agent|aider)(?:$|[\\/.\s-])/i, label: "Coding Agent" },
];

function formatElectronProcessLabel(
  metric: HostElectronProcessMetric,
  isInProcessCore: boolean,
): {
  role: ProcessAttributionRole;
  name: string;
} {
  const typeLower = metric.type.trim().toLowerCase();
  if (typeLower === "browser") {
    return {
      role: "electron-main",
      name: isInProcessCore ? "Prismux 主进程 (含 Prismux Server)" : "Prismux 主进程",
    };
  }
  if (typeLower === "tab") {
    const customName = metric.name?.trim();
    return {
      role: "electron-renderer",
      name: customName && customName.length > 0 ? `渲染进程 · ${customName}` : "工作台渲染进程",
    };
  }
  if (typeLower === "gpu") {
    return {
      role: "electron-gpu",
      name: "GPU 合成 / 壁纸渲染",
    };
  }
  const rawLabel = (metric.name ?? metric.serviceName ?? "").trim();
  const rawLower = rawLabel.toLowerCase();
  if (rawLower.includes("network")) {
    return { role: "electron-utility", name: "网络服务进程" };
  }
  if (rawLower.includes("storage")) {
    return { role: "electron-utility", name: "存储服务进程" };
  }
  if (rawLower.includes("audio")) {
    return { role: "electron-utility", name: "音频服务进程" };
  }
  if (rawLower.includes("video")) {
    return { role: "electron-utility", name: "视频解码进程" };
  }
  return {
    role: "electron-utility",
    name: rawLabel.length > 0 ? rawLabel : `Electron ${metric.type || "辅助进程"}`,
  };
}

function detectCoreServerFromOsEntry(
  entry: OsProcessSnapshotEntry,
  daemonPid: number,
  mainPid: number | null,
): boolean {
  if (entry.pid === daemonPid || entry.pid === mainPid) {
    return false;
  }
  const cmd = (entry.commandLine ?? "").toLowerCase();
  if (!cmd) return false;
  if (
    cmd.includes("--type=renderer") ||
    cmd.includes("--type=gpu-process") ||
    cmd.includes("--type=utility") ||
    cmd.includes("--type=crashpad-handler") ||
    cmd.includes("prismux-daemon") ||
    cmd.includes("apps\\daemon\\") ||
    cmd.includes("apps/daemon/")
  ) {
    return false;
  }
  return (
    cmd.includes("apps\\server\\") ||
    cmd.includes("apps/server/") ||
    cmd.includes("core-server") ||
    cmd.includes("resources\\server\\") ||
    cmd.includes("resources/server/") ||
    cmd.includes("dist\\index.mjs") ||
    cmd.includes("dist/index.mjs")
  );
}

/**
 * Classifies an OS process inside the Prismux process tree into a user-facing
 * role, category, and display label.
 */
export function classifyOsProcessEntry(
  entry: Pick<OsProcessSnapshotEntry, "pid" | "processName" | "commandLine">,
  ctx: {
    daemonPid: number;
    mainPid: number | null;
    corePid: number | null;
    electronMetric?: HostElectronProcessMetric;
    ptyTitle?: string | null;
  },
): {
  role: ProcessAttributionRole;
  category: ProcessAttributionCategory;
  name: string;
} {
  if (entry.pid === ctx.daemonPid) {
    return { role: "daemon", category: "core", name: "Prismux Daemon" };
  }
  if (ctx.corePid !== null && entry.pid === ctx.corePid && entry.pid !== ctx.mainPid) {
    return { role: "core-server", category: "core", name: "Prismux Server" };
  }
  if (ctx.electronMetric) {
    const formatted = formatElectronProcessLabel(
      ctx.electronMetric,
      ctx.corePid !== null && entry.pid === ctx.corePid,
    );
    return { role: formatted.role, category: "desktop", name: formatted.name };
  }
  if (ctx.mainPid !== null && entry.pid === ctx.mainPid) {
    return {
      role: "electron-main",
      category: "desktop",
      name: ctx.corePid === ctx.mainPid ? "Prismux 主进程 (含 Prismux Server)" : "Prismux 主进程",
    };
  }

  const cmdLower = (entry.commandLine ?? "").toLowerCase();
  if (cmdLower.includes("--type=gpu-process")) {
    return { role: "electron-gpu", category: "desktop", name: "GPU 合成 / 壁纸渲染" };
  }
  if (cmdLower.includes("--type=renderer")) {
    return { role: "electron-renderer", category: "desktop", name: "工作台渲染进程" };
  }
  if (cmdLower.includes("--type=utility")) {
    const serviceMatch = /--utility-sub-type=([^\s]+)/i.exec(entry.commandLine ?? "");
    const subType = serviceMatch?.[1]?.toLowerCase() ?? "";
    if (subType.includes("network")) {
      return { role: "electron-utility", category: "desktop", name: "网络服务进程" };
    }
    if (subType.includes("storage")) {
      return { role: "electron-utility", category: "desktop", name: "存储服务进程" };
    }
    if (subType.includes("audio")) {
      return { role: "electron-utility", category: "desktop", name: "音频服务进程" };
    }
    return { role: "electron-utility", category: "desktop", name: "Electron 辅助进程" };
  }
  if (cmdLower.includes("--type=crashpad-handler")) {
    return { role: "electron-utility", category: "desktop", name: "Crashpad 守护进程" };
  }

  if (ctx.ptyTitle) {
    return { role: "pty", category: "terminal", name: ctx.ptyTitle };
  }

  const stem = normalizeProcessStem(entry.processName);
  const haystack = `${stem} ${entry.commandLine ?? ""}`;
  for (const candidate of AGENT_PATTERNS) {
    if (candidate.regex.test(haystack)) {
      return { role: "agent", category: "agent", name: candidate.label };
    }
  }

  const shellLabel = SHELL_PROCESS_NAMES.get(stem);
  if (shellLabel) {
    return { role: "terminal", category: "terminal", name: shellLabel };
  }

  // Meaningful dev tool sub-command label (e.g. `node (vite)`, `pnpm`, `git`)
  if (stem === "node" || stem === "bun" || stem === "deno") {
    if (cmdLower.includes("vite"))
      return { role: "child", category: "terminal", name: `${entry.processName} (vite)` };
    if (cmdLower.includes("vitest"))
      return { role: "child", category: "terminal", name: `${entry.processName} (vitest)` };
    if (cmdLower.includes("tsc") || cmdLower.includes("tsgo"))
      return { role: "child", category: "terminal", name: `${entry.processName} (tsc)` };
    if (cmdLower.includes("esbuild"))
      return { role: "child", category: "terminal", name: `${entry.processName} (esbuild)` };
    if (cmdLower.includes("mcp"))
      return { role: "agent", category: "agent", name: `${entry.processName} (MCP)` };
  }

  return {
    role: "child",
    category: "terminal",
    name: entry.processName || `PID ${entry.pid}`,
  };
}

/**
 * Validates and normalizes an incoming Electron host metrics report payload
 * from `POST /v1/resources/host-metrics`.
 */
export function normalizeHostMetricsReport(raw: unknown): HostMetricsReport | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const mainPid = parsePositiveInt(rec["mainPid"]);
  const collectedAt = parseNonNegativeNumber(rec["collectedAt"]) ?? Date.now();
  const cpuCores = parsePositiveInt(rec["cpuCores"]) ?? undefined;
  const cpuScale =
    rec["cpuScale"] === "system-total" || rec["cpuScale"] === "single-core"
      ? rec["cpuScale"]
      : "system-total";

  let coreServer: HostCoreServerInfo | null | undefined;
  if (rec["coreServer"] === null) {
    coreServer = null;
  } else if (
    typeof rec["coreServer"] === "object" &&
    rec["coreServer"] !== null &&
    !Array.isArray(rec["coreServer"])
  ) {
    const coreRec = rec["coreServer"] as Record<string, unknown>;
    const pid = parsePositiveInt(coreRec["pid"]);
    const ready = Boolean(coreRec["ready"]);
    const desiredRunning =
      typeof coreRec["desiredRunning"] === "boolean" ? coreRec["desiredRunning"] : undefined;
    const state =
      typeof coreRec["state"] === "string" && coreRec["state"].trim().length > 0
        ? coreRec["state"].trim()
        : ready
          ? "running"
          : desiredRunning
            ? "starting"
            : "stopped";
    const hostedByRaw = coreRec["hostedBy"];
    const hostedBy =
      hostedByRaw === "electron" ||
      hostedByRaw === "electron-in-process" ||
      hostedByRaw === "daemon-supervisor" ||
      hostedByRaw === "external"
        ? hostedByRaw
        : pid !== null && mainPid !== null && pid === mainPid
          ? "electron-in-process"
          : "electron";
    const httpUrl =
      typeof coreRec["httpUrl"] === "string" && coreRec["httpUrl"].trim().length > 0
        ? coreRec["httpUrl"].trim()
        : null;
    coreServer = {
      pid,
      ready,
      ...(desiredRunning !== undefined ? { desiredRunning } : {}),
      state,
      hostedBy,
      httpUrl,
    };
  }

  const rawProcs = Array.isArray(rec["electronProcesses"]) ? rec["electronProcesses"] : [];
  const electronProcesses: HostElectronProcessMetric[] = [];
  for (const item of rawProcs) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const pRec = item as Record<string, unknown>;
    const pid = parsePositiveInt(pRec["pid"]);
    if (pid === null) continue;
    const type =
      typeof pRec["type"] === "string" && pRec["type"].trim().length > 0
        ? pRec["type"].trim()
        : "Unknown";
    const workingSetBytes = parseNonNegativeNumber(pRec["workingSetBytes"]) ?? 0;
    const privateMemoryBytes = parseNonNegativeNumber(pRec["privateMemoryBytes"]);
    const peakWorkingSetBytes = parseNonNegativeNumber(pRec["peakWorkingSetBytes"]);
    const cpuPercent = parseNonNegativeNumber(pRec["cpuPercent"]);
    const cumulativeCpuSeconds = parseNonNegativeNumber(pRec["cumulativeCpuSeconds"]);
    const creationTimeMs = parseNonNegativeNumber(pRec["creationTimeMs"]);
    const name =
      typeof pRec["name"] === "string" && pRec["name"].trim().length > 0
        ? pRec["name"].trim()
        : undefined;
    const serviceName =
      typeof pRec["serviceName"] === "string" && pRec["serviceName"].trim().length > 0
        ? pRec["serviceName"].trim()
        : undefined;

    electronProcesses.push({
      pid,
      type,
      ...(name !== undefined ? { name } : {}),
      ...(serviceName !== undefined ? { serviceName } : {}),
      ...(creationTimeMs !== null ? { creationTimeMs } : {}),
      cpuPercent,
      ...(cumulativeCpuSeconds !== null ? { cumulativeCpuSeconds } : {}),
      workingSetBytes,
      ...(privateMemoryBytes !== null ? { privateMemoryBytes } : {}),
      ...(peakWorkingSetBytes !== null ? { peakWorkingSetBytes } : {}),
    });
  }

  if (mainPid === null && electronProcesses.length === 0 && coreServer === undefined) {
    return null;
  }

  return {
    collectedAt,
    mainPid: mainPid ?? electronProcesses.find((p) => p.type.toLowerCase() === "browser")?.pid ?? 0,
    ...(cpuCores !== undefined ? { cpuCores } : {}),
    cpuScale,
    ...(coreServer !== undefined ? { coreServer } : {}),
    electronProcesses,
  };
}

/**
 * Aggregates host, Electron desktop process family, T3 Server, Daemon,
 * PersistentPtyPool, and live descendant terminal/agent CPU & RAM metrics.
 *
 * Uses a continuous sliding-window CPU sampler for Daemon, real-time pushed
 * Electron `app.getAppMetrics()` + `DesktopBackendPool` T3 Server PID telemetry,
 * and a fast cached (2s TTL, zero-window `windowsHide: true`) OS process tree
 * walk so every Prismux workbench process is truthfully attributed with consistent
 * Windows Task Manager (`0–100%` of total machine CPU) normalization.
 */
export class ResourceMonitorService {
  private readonly ptyPool: PersistentPtyPool;
  private readonly coreSupervisor: CoreServerSupervisor | undefined;
  private readonly coreRpcClient: CoreRpcClient | undefined;
  private readonly coreServerUrl: string | undefined;
  private readonly configuredMainPid: number | null;
  private readonly configuredCoreServerPid: number | null;
  private readonly sampleTimeoutMs: number;
  private readonly treeCacheTtlMs: number;
  private readonly backgroundSampleIntervalMs: number;
  private readonly customSampleProcessesFn:
    | ((pids: number[]) => Promise<Map<number, ProcessUsageReading>>)
    | undefined;
  private readonly sampleProcessTreeFn:
    | (() => Promise<Map<number, OsProcessSnapshotEntry>>)
    | undefined;

  private lastHostCpu: CpuTotals | null = null;
  private lastHostCpuPercent: number | null = null;
  private lastDaemonCpuUsage: NodeJS.CpuUsage;
  private lastDaemonSampleAt: number;
  private lastDaemonCpuPercent: number | null = null;
  private daemonCpuWindow: number[] = [];

  private readonly previousProcCpuByPid = new Map<number, PreviousProcCpu>();
  private readonly previousElectronCpuByPid = new Map<number, PreviousElectronCpu>();
  private appMemoryHistory: number[] = [];
  private readonly workspaceMemoryHistory = new Map<string, number[]>();

  private latestHostMetrics: CachedHostMetrics | null = null;

  private cachedProcessTree: CachedProcessTree | null = null;
  private inflightProcessTree: Promise<CachedProcessTree> | null = null;

  private backgroundTimer: NodeJS.Timeout | undefined;

  constructor(options: ResourceMonitorServiceOptions) {
    this.sampleTimeoutMs = options.sampleTimeoutMs ?? DEFAULT_SAMPLE_TIMEOUT_MS;
    this.treeCacheTtlMs = options.treeCacheTtlMs ?? DEFAULT_TREE_CACHE_TTL_MS;
    this.backgroundSampleIntervalMs =
      options.backgroundSampleIntervalMs ?? DEFAULT_BACKGROUND_SAMPLE_INTERVAL_MS;
    this.ptyPool = options.ptyPool;
    this.coreSupervisor = options.coreSupervisor ?? options.t3Supervisor;
    this.coreRpcClient = options.coreRpcClient ?? options.t3RpcClient;
    this.coreServerUrl = options.coreServerUrl ?? options.t3ServerUrl;
    this.configuredMainPid =
      options.mainPid !== undefined
        ? parsePositiveInt(options.mainPid)
        : parsePositiveInt(process.env["PRISMUX_MAIN_PID"]);
    this.configuredCoreServerPid =
      options.coreServerPid !== undefined
        ? parsePositiveInt(options.coreServerPid)
        : (parsePositiveInt(process.env["PRISMUX_SERVER_PID"]) ??
          parsePositiveInt(process.env["PRISMUX_CORE_SERVER_PID"]));
    this.customSampleProcessesFn = options.sampleProcesses;
    this.sampleProcessTreeFn = options.sampleProcessTree;

    // Prime initial CPU baselines immediately at construction so the first query
    // already measures a real elapsed interval instead of returning hardcoded 0.0%.
    this.lastHostCpu = readHostCpuTotals();
    this.lastDaemonCpuUsage = process.cpuUsage();
    this.lastDaemonSampleAt = Date.now();
  }

  /**
   * Starts the lightweight unref'd background CPU sliding-window ticker using
   * zero-subprocess `os.cpus()` and `process.cpuUsage()`.
   *
   * Note: Does NOT spawn startup PowerShell WMI process-tree warmups on Windows;
   * desktop metrics arrive via Electron `ingestHostMetrics()` and OS tree queries
   * run strictly on demand when cache expired without fresh Electron metrics or
   * when `forceRefresh: true`.
   */
  start(): void {
    if (this.backgroundTimer !== undefined) {
      return;
    }
    this.backgroundTimer = setInterval(() => {
      const now = Date.now();
      this.sampleHostCpuPercent();
      this.sampleDaemonCpuPercent(now);
    }, this.backgroundSampleIntervalMs);
    this.backgroundTimer.unref();
  }

  stop(): void {
    if (this.backgroundTimer !== undefined) {
      clearInterval(this.backgroundTimer);
      this.backgroundTimer = undefined;
    }
  }

  /**
   * Ingests a real-time host process snapshot pushed by the Electron desktop host
   * (`app.getAppMetrics()` + `DesktopBackendPool` primary T3 Server PID).
   *
   * Derives per-PID total-system CPU% from monotonic `cumulativeCpuSeconds` deltas
   * whenever available (100% immune to competing `app.getAppMetrics()` interval resets
   * from T3 DesktopTelemetryPublisher), falling back to `cpuPercent` normalized by
   * `report.cpuScale` without ever double-dividing by logical CPU cores.
   */
  ingestHostMetrics(report: HostMetricsReport): HostMetricsIngestResult {
    const receivedAt = Date.now();
    this.latestHostMetrics = { report, receivedAt };

    const effectiveCores = Math.max(1, report.cpuCores ?? os.cpus().length);
    const reportTimeMs =
      Number.isFinite(report.collectedAt) && report.collectedAt > 0
        ? report.collectedAt
        : receivedAt;

    const seenPids = new Set<number>();
    for (const metric of report.electronProcesses) {
      seenPids.add(metric.pid);
      const prev = this.previousElectronCpuByPid.get(metric.pid);
      const pushCount = (prev?.pushCount ?? 0) + 1;

      let directPct: number | null = null;
      if (
        metric.cpuPercent !== null &&
        Number.isFinite(metric.cpuPercent) &&
        metric.cpuPercent >= 0
      ) {
        directPct =
          report.cpuScale === "single-core"
            ? clampPercentPrecise(metric.cpuPercent / effectiveCores)
            : clampPercentPrecise(metric.cpuPercent);
      }

      const curCum =
        metric.cumulativeCpuSeconds !== undefined &&
        metric.cumulativeCpuSeconds !== null &&
        Number.isFinite(metric.cumulativeCpuSeconds) &&
        metric.cumulativeCpuSeconds >= 0
          ? metric.cumulativeCpuSeconds
          : null;

      let cumulativeDeltaPct: number | null = null;
      if (curCum !== null && prev && prev.cumulativeCpuSeconds !== null) {
        const elapsedSec = (reportTimeMs - prev.collectedAtMs) / 1000;
        if (elapsedSec >= 0.05 && curCum >= prev.cumulativeCpuSeconds) {
          cumulativeDeltaPct = computeNormalizedCpuPercent(
            curCum - prev.cumulativeCpuSeconds,
            elapsedSec,
            effectiveCores,
          );
        } else if (elapsedSec < 0.05 && prev.lastCpuPercent !== null) {
          cumulativeDeltaPct = prev.lastCpuPercent;
        }
      }

      let resolvedPct: number | null = null;
      if (cumulativeDeltaPct !== null) {
        resolvedPct = cumulativeDeltaPct;
      } else if (directPct !== null) {
        // A PID's very first Electron app.getAppMetrics() push often reports 0 (unprimed baseline);
        // keep null so getResources() can fall back to OS-derived delta until push #2 arrives.
        resolvedPct = pushCount <= 1 && directPct === 0 ? null : directPct;
      } else if (prev?.lastCpuPercent !== undefined) {
        resolvedPct = prev.lastCpuPercent;
      }

      this.previousElectronCpuByPid.set(metric.pid, {
        cumulativeCpuSeconds: curCum,
        collectedAtMs: reportTimeMs,
        lastCpuPercent: resolvedPct,
        pushCount,
      });
    }

    if (report.electronProcesses.length > 0) {
      for (const trackedPid of this.previousElectronCpuByPid.keys()) {
        if (!seenPids.has(trackedPid)) {
          this.previousElectronCpuByPid.delete(trackedPid);
        }
      }
    }

    return {
      ok: true,
      receivedAt,
      acceptedProcesses: report.electronProcesses.length,
      mainPid: report.mainPid > 0 ? report.mainPid : null,
      coreServerPid: report.coreServer?.pid ?? null,
    };
  }

  getLatestHostMetrics(): CachedHostMetrics | null {
    return this.latestHostMetrics;
  }

  private getFreshHostMetrics(nowMs: number): CachedHostMetrics | null {
    if (!this.latestHostMetrics) {
      return null;
    }
    if (nowMs - this.latestHostMetrics.receivedAt > HOST_METRICS_FRESH_TTL_MS) {
      return null;
    }
    return this.latestHostMetrics;
  }

  private resolveEffectiveMainPid(): number | null {
    if (this.latestHostMetrics && this.latestHostMetrics.report.mainPid > 0) {
      return this.latestHostMetrics.report.mainPid;
    }
    if (this.configuredMainPid !== null) {
      return this.configuredMainPid;
    }
    return parsePositiveInt(process.env["PRISMUX_MAIN_PID"]);
  }

  private resolveDerivedCpuPercent(
    reading: Pick<ProcessUsageReading, "pid" | "cpuPercent" | "cpuSeconds"> | undefined,
    sampledAtMs: number,
    cpuCores: number,
    fromCache: boolean,
  ): number | null {
    if (!reading) {
      return null;
    }
    if (reading.cpuPercent !== null) {
      return clampPercentPrecise(reading.cpuPercent);
    }
    if (reading.cpuSeconds === undefined || reading.cpuSeconds === null) {
      return null;
    }
    const prev = this.previousProcCpuByPid.get(reading.pid);
    if (!prev) {
      this.previousProcCpuByPid.set(reading.pid, {
        cpuSeconds: reading.cpuSeconds,
        sampledAtMs,
        lastCpuPercent: null,
      });
      return null;
    }
    // Cached snapshot or non-advancing timestamp: preserve previous delta instead of wiping to 0.0%.
    if (fromCache || sampledAtMs <= prev.sampledAtMs) {
      return prev.lastCpuPercent;
    }
    const elapsedSec = (sampledAtMs - prev.sampledAtMs) / 1000;
    if (elapsedSec < 0.05) {
      return prev.lastCpuPercent;
    }
    // Guard against PID reuse or counter reset.
    if (reading.cpuSeconds < prev.cpuSeconds) {
      this.previousProcCpuByPid.set(reading.pid, {
        cpuSeconds: reading.cpuSeconds,
        sampledAtMs,
        lastCpuPercent: null,
      });
      return null;
    }
    const normalized = computeNormalizedCpuPercent(
      reading.cpuSeconds - prev.cpuSeconds,
      elapsedSec,
      cpuCores,
    );
    this.previousProcCpuByPid.set(reading.pid, {
      cpuSeconds: reading.cpuSeconds,
      sampledAtMs,
      lastCpuPercent: normalized,
    });
    return normalized;
  }

  private sampleHostCpuPercent(): number | null {
    const current = readHostCpuTotals();
    const prev = this.lastHostCpu;
    if (!prev) {
      this.lastHostCpu = current;
      return this.lastHostCpuPercent;
    }
    const deltaTotal = current.total - prev.total;
    const deltaIdle = current.idle - prev.idle;
    if (deltaTotal <= 0) {
      return this.lastHostCpuPercent ?? 0;
    }
    this.lastHostCpu = current;
    const busy = Math.max(0, deltaTotal - deltaIdle);
    const pct = clampPercent((busy / deltaTotal) * 100);
    this.lastHostCpuPercent = pct;
    return pct;
  }

  private sampleDaemonCpuPercent(nowMs: number): number {
    const elapsedMs = nowMs - this.lastDaemonSampleAt;
    if (elapsedMs < MIN_CPU_DELTA_MS && this.lastDaemonCpuPercent !== null) {
      return this.lastDaemonCpuPercent;
    }
    const currentUsage = process.cpuUsage();
    const deltaCpuMicros = Math.max(
      0,
      currentUsage.user -
        this.lastDaemonCpuUsage.user +
        (currentUsage.system - this.lastDaemonCpuUsage.system),
    );
    const cpuCores = Math.max(1, os.cpus().length);
    const safeElapsedMs = Math.max(1, elapsedMs);
    const instantPercent = clampPercentPrecise(
      (deltaCpuMicros / (safeElapsedMs * 1000 * cpuCores)) * 100,
    );

    if (elapsedMs >= MIN_CPU_DELTA_MS) {
      this.lastDaemonCpuUsage = currentUsage;
      this.lastDaemonSampleAt = nowMs;
      this.daemonCpuWindow.push(instantPercent);
      if (this.daemonCpuWindow.length > DAEMON_CPU_SLIDING_WINDOW_SIZE) {
        this.daemonCpuWindow.shift();
      }
      // Weighted recent smoothing favors latest burst while preventing brief 0.0% flicker.
      const sum = this.daemonCpuWindow.reduce((acc, v) => acc + v, 0);
      const smoothed = clampPercentPrecise(sum / this.daemonCpuWindow.length);
      this.lastDaemonCpuPercent = Math.max(instantPercent, smoothed);
      return this.lastDaemonCpuPercent;
    }

    this.lastDaemonCpuPercent = instantPercent;
    return instantPercent;
  }

  private collectKnownRootPids(): number[] {
    const roots = new Set<number>([process.pid]);
    const mainPid = this.resolveEffectiveMainPid();
    if (mainPid !== null) roots.add(mainPid);
    const coreStatus = this.coreSupervisor?.getStatus();
    const corePid =
      parsePositiveInt(coreStatus?.pid) ??
      parsePositiveInt(this.latestHostMetrics?.report.coreServer?.pid) ??
      this.configuredCoreServerPid ??
      parsePositiveInt(process.env["PRISMUX_SERVER_PID"]) ??
      parsePositiveInt(process.env["PRISMUX_CORE_SERVER_PID"]);
    if (corePid !== null) roots.add(corePid);
    if (this.latestHostMetrics) {
      for (const proc of this.latestHostMetrics.report.electronProcesses) {
        if (proc.pid > 0) roots.add(proc.pid);
      }
    }
    for (const info of this.ptyPool.listSessionRuntimeInfos()) {
      if (info.alive && info.pid !== null && info.pid > 0) {
        roots.add(info.pid);
      }
    }
    return [...roots];
  }

  private async getProcessTree(forceRefresh: boolean): Promise<ProcessTreeLookupResult> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cachedProcessTree !== null &&
      now - this.cachedProcessTree.sampledAtMs < this.treeCacheTtlMs
    ) {
      return {
        entries: this.cachedProcessTree.entries,
        sampledAtMs: this.cachedProcessTree.cpuSampledAtMs,
        fromCache: true,
      };
    }
    if (this.inflightProcessTree !== null) {
      const snapshot = await this.inflightProcessTree;
      return {
        entries: snapshot.entries,
        sampledAtMs: snapshot.cpuSampledAtMs,
        fromCache: false,
      };
    }

    const fetcher = this.sampleProcessTreeFn
      ? () => this.sampleProcessTreeFn!()
      : () => defaultSampleProcessTree(this.sampleTimeoutMs, this.collectKnownRootPids());

    const run = fetcher()
      .then((entries) => {
        const completedAtMs = Date.now();
        let cpuSampledAtMs = completedAtMs;
        for (const entry of entries.values()) {
          if (typeof entry.sampledAtMs === "number" && entry.sampledAtMs > 0) {
            cpuSampledAtMs = entry.sampledAtMs;
            break;
          }
        }
        const snapshot: CachedProcessTree = {
          entries,
          sampledAtMs: completedAtMs,
          cpuSampledAtMs,
        };
        this.cachedProcessTree = snapshot;
        return snapshot;
      })
      .catch(() => {
        const fallbackAtMs = Date.now();
        return (
          this.cachedProcessTree ?? {
            entries: new Map<number, OsProcessSnapshotEntry>(),
            sampledAtMs: fallbackAtMs,
            cpuSampledAtMs: fallbackAtMs,
          }
        );
      })
      .finally(() => {
        if (this.inflightProcessTree === run) {
          this.inflightProcessTree = null;
        }
      });

    this.inflightProcessTree = run;
    const snapshot = await run;
    return {
      entries: snapshot.entries,
      sampledAtMs: snapshot.cpuSampledAtMs,
      fromCache: false,
    };
  }

  private resolveElectronCpuPercent(
    metric: HostElectronProcessMetric,
    report: HostMetricsReport,
    cpuCores: number,
    osDerivedCpu: number | null,
  ): number | null {
    const tracked = this.previousElectronCpuByPid.get(metric.pid);
    if (tracked && tracked.lastCpuPercent !== null) {
      return tracked.lastCpuPercent;
    }
    if (osDerivedCpu !== null) {
      return osDerivedCpu;
    }
    const effectiveCores = Math.max(1, report.cpuCores ?? cpuCores);
    if (
      metric.cpuPercent !== null &&
      Number.isFinite(metric.cpuPercent) &&
      metric.cpuPercent >= 0
    ) {
      return report.cpuScale === "single-core"
        ? clampPercentPrecise(metric.cpuPercent / effectiveCores)
        : clampPercentPrecise(metric.cpuPercent);
    }
    return null;
  }

  async getResources(options: GetResourcesOptions = {}): Promise<ExtendedSystemResourcesResponse> {
    const forceRefresh = options.forceRefresh === true;
    const now = Date.now();
    const cpuCores = Math.max(1, os.cpus().length);
    const hostTotalMem = os.totalmem();
    const hostFreeMem = os.freemem();
    const hostUsedMem = Math.max(0, hostTotalMem - hostFreeMem);
    const hostCpuPercent = this.sampleHostCpuPercent();
    const daemonCpuPercent = this.sampleDaemonCpuPercent(now);
    const daemonRssBytes = process.memoryUsage().rss;

    const processMemoryMetric: ProcessMemoryMetric =
      process.platform === "win32"
        ? "working-set"
        : process.platform === "darwin"
          ? "footprint"
          : "rss";
    const processCommitMetric: ProcessCommitMetric | undefined =
      process.platform === "win32" ? "private-bytes" : undefined;

    const freshHost = this.getFreshHostMetrics(now);
    const hostReport = freshHost?.report ?? null;
    const mainPid = this.resolveEffectiveMainPid();
    const coreSupervisorStatus = this.coreSupervisor?.getStatus();
    const ptyInfos = this.ptyPool.listSessionRuntimeInfos();

    // Collect process samples either via injected test sampler OR full cached OS process tree.
    let osTree = new Map<number, OsProcessSnapshotEntry>();
    let legacySampledMap = new Map<number, ProcessUsageReading>();
    let osSampledAtMs = now;
    let osFromCache = false;

    if (this.customSampleProcessesFn && !this.sampleProcessTreeFn) {
      const pidsToSample: number[] = [];
      if (process.platform === "win32") {
        pidsToSample.push(process.pid);
      }
      if (mainPid !== null) {
        pidsToSample.push(mainPid);
      }
      const hintCorePid =
        parsePositiveInt(coreSupervisorStatus?.pid) ??
        parsePositiveInt(hostReport?.coreServer?.pid) ??
        this.configuredCoreServerPid ??
        parsePositiveInt(process.env["PRISMUX_SERVER_PID"]) ??
        parsePositiveInt(process.env["PRISMUX_CORE_SERVER_PID"]);
      if (hintCorePid !== null) {
        pidsToSample.push(hintCorePid);
      }
      for (const info of ptyInfos) {
        if (info.alive && info.pid !== null && info.pid > 0) {
          pidsToSample.push(info.pid);
        }
      }
      legacySampledMap =
        pidsToSample.length > 0 ? await this.customSampleProcessesFn(pidsToSample) : new Map();
      osSampledAtMs = Date.now();
      osFromCache = false;
    } else {
      // Prefer Electron-pushed hostMetrics + lightweight os.cpus()/process.cpuUsage()
      // without spawning PowerShell WMI unless `forceRefresh: true`, a test sampler is
      // injected, or no fresh Electron host metrics exist AND the 10s tree cache expired.
      const hasFreshCachedTree =
        this.cachedProcessTree !== null &&
        now - this.cachedProcessTree.sampledAtMs < this.treeCacheTtlMs;
      const shouldSkipOsTreeSpawn =
        !forceRefresh && !this.sampleProcessTreeFn && hostReport !== null && !hasFreshCachedTree;

      if (shouldSkipOsTreeSpawn) {
        osTree = new Map();
        osSampledAtMs = now;
        osFromCache = true;
      } else {
        const treeLookup = await this.getProcessTree(forceRefresh);
        osTree = treeLookup.entries;
        osSampledAtMs = treeLookup.sampledAtMs;
        osFromCache = treeLookup.fromCache;
        // Fallback to targeted Get-Process/ps if full tree came back empty (e.g. restricted WMI).
        if (osTree.size === 0 && !this.sampleProcessTreeFn) {
          const fallbackPids = new Set<number>([process.pid]);
          if (mainPid !== null) fallbackPids.add(mainPid);
          const hintCore =
            parsePositiveInt(coreSupervisorStatus?.pid) ??
            parsePositiveInt(hostReport?.coreServer?.pid) ??
            this.configuredCoreServerPid;
          if (hintCore !== null) fallbackPids.add(hintCore);
          for (const info of ptyInfos) {
            if (info.alive && info.pid !== null && info.pid > 0) {
              fallbackPids.add(info.pid);
            }
          }
          legacySampledMap = await defaultSampleProcesses([...fallbackPids], this.sampleTimeoutMs);
          osSampledAtMs = Date.now();
          osFromCache = false;
        }
      }
    }

    // Build parent -> children adjacency index over the OS process table.
    const childrenByParent = new Map<number, OsProcessSnapshotEntry[]>();
    for (const entry of osTree.values()) {
      if (isTransientSelfProbe(entry, process.pid)) continue;
      if (entry.parentPid !== null) {
        const list = childrenByParent.get(entry.parentPid);
        if (list) list.push(entry);
        else childrenByParent.set(entry.parentPid, [entry]);
      }
    }

    // Resolve T3 Server PID & hosting metadata across all authoritative sources.
    let corePid: number | null =
      parsePositiveInt(coreSupervisorStatus?.pid) ??
      parsePositiveInt(hostReport?.coreServer?.pid) ??
      parsePositiveInt(this.latestHostMetrics?.report.coreServer?.pid) ??
      this.configuredCoreServerPid ??
      parsePositiveInt(process.env["PRISMUX_SERVER_PID"]) ??
      parsePositiveInt(process.env["PRISMUX_CORE_SERVER_PID"]);
    let coreHostedBy: ExtendedCoreServerResources["hostedBy"] =
      coreSupervisorStatus !== undefined
        ? "daemon-supervisor"
        : (hostReport?.coreServer?.hostedBy ??
          this.latestHostMetrics?.report.coreServer?.hostedBy ??
          (mainPid !== null ? "electron" : undefined));
    let coreState: string | null =
      coreSupervisorStatus?.state ??
      hostReport?.coreServer?.state ??
      (hostReport?.coreServer?.ready ? "running" : null) ??
      (this.coreRpcClient?.isConnected() ? "running" : null);

    // Auto-discover T3 Server child under Electron Main PID if PID wasn't pushed yet.
    if (corePid === null && mainPid !== null && osTree.size > 0) {
      const mainChildren = childrenByParent.get(mainPid) ?? [];
      const detected = mainChildren.find((child) =>
        detectCoreServerFromOsEntry(child, process.pid, mainPid),
      );
      if (detected) {
        corePid = detected.pid;
        coreHostedBy = "electron";
        coreState = "running";
      }
    }
    if (corePid !== null && mainPid !== null && corePid === mainPid) {
      coreHostedBy = "electron-in-process";
    }

    // Helper to look up raw OS reading for any PID (preferring osTree, fallback to legacySampledMap).
    const getOsReading = (pid: number): ProcessUsageReading | undefined => {
      const treeRow = osTree.get(pid);
      if (treeRow) {
        return {
          pid: treeRow.pid,
          cpuPercent: treeRow.cpuPercent,
          memoryBytes: treeRow.memoryBytes,
          privateMemoryBytes: treeRow.privateMemoryBytes,
          cpuSeconds: treeRow.cpuSeconds,
        };
      }
      return legacySampledMap.get(pid);
    };

    // Index Electron metrics by PID for instant zero-cost lookups.
    const electronByPid = new Map<number, HostElectronProcessMetric>();
    if (hostReport) {
      for (const metric of hostReport.electronProcesses) {
        electronByPid.set(metric.pid, metric);
      }
    }

    // Index PersistentPtyPool sessions by PID for enrichment.
    const ptyByPid = new Map<number, (typeof ptyInfos)[number]>();
    for (const info of ptyInfos) {
      if (info.alive && info.pid !== null && info.pid > 0) {
        ptyByPid.set(info.pid, info);
      }
    }

    // Walk full Prismux family tree (Electron Main + Electron helpers + T3 Server + Daemon + PTYs + descendants).
    const familyPids = new Set<number>([process.pid]);
    if (mainPid !== null) familyPids.add(mainPid);
    if (corePid !== null) familyPids.add(corePid);
    for (const pid of electronByPid.keys()) familyPids.add(pid);
    for (const pid of ptyByPid.keys()) familyPids.add(pid);

    const bfsQueue: Array<{ pid: number; depth: number }> = [...familyPids].map((pid) => ({
      pid,
      depth: 0,
    }));
    const visited = new Set<number>(familyPids);
    while (bfsQueue.length > 0 && visited.size < MAX_ATTRIBUTED_PROCESSES) {
      const current = bfsQueue.shift()!;
      if (current.depth >= MAX_DESCENDANT_DEPTH) continue;
      const children = childrenByParent.get(current.pid);
      if (!children) continue;
      for (const child of children) {
        if (visited.has(child.pid) || isTransientSelfProbe(child, process.pid)) continue;
        visited.add(child.pid);
        familyPids.add(child.pid);
        bfsQueue.push({ pid: child.pid, depth: current.depth + 1 });
        if (visited.size >= MAX_ATTRIBUTED_PROCESSES) break;
      }
    }

    // Derive CPU% once per PID using the actual OS snapshot timestamp and cache status so cached reads
    // never overwrite previous deltas with 0.0%.
    const derivedOsCpuByPid = new Map<number, number | null>();
    for (const pid of familyPids) {
      const reading = getOsReading(pid);
      if (reading) {
        derivedOsCpuByPid.set(
          pid,
          this.resolveDerivedCpuPercent(reading, osSampledAtMs, cpuCores, osFromCache),
        );
      }
    }

    // Prune exited PID CPU history entries while preserving baselines of live OS processes that
    // may join familyPids on a subsequent host-metrics push.
    for (const [trackedPid, prevState] of this.previousProcCpuByPid.entries()) {
      const stillAliveInTree = osTree.size > 0 && osTree.has(trackedPid);
      const stale = now - prevState.sampledAtMs > 60_000;
      if (!familyPids.has(trackedPid) && (!stillAliveInTree || stale)) {
        this.previousProcCpuByPid.delete(trackedPid);
      }
    }

    // Resolve the single authoritative CPU% per PID once so cards, sections, and totals agree 100%.
    const resolvedCpuByPid = new Map<number, number | null>();
    for (const pid of familyPids) {
      if (pid === process.pid) {
        resolvedCpuByPid.set(pid, daemonCpuPercent);
        continue;
      }
      const electronMetric = electronByPid.get(pid);
      if (electronMetric && hostReport) {
        resolvedCpuByPid.set(
          pid,
          this.resolveElectronCpuPercent(
            electronMetric,
            hostReport,
            cpuCores,
            derivedOsCpuByPid.get(pid) ?? null,
          ),
        );
        continue;
      }
      resolvedCpuByPid.set(pid, derivedOsCpuByPid.get(pid) ?? null);
    }

    // Build Daemon self metrics.
    const daemonOsReading = getOsReading(process.pid);
    const daemonMemBytes = daemonOsReading?.memoryBytes ?? daemonRssBytes;
    const daemonPrivateMemBytes = daemonOsReading?.privateMemoryBytes ?? undefined;

    // Build T3 Server metrics (never returns null when desktop/env/RPC knows about T3 Server!).
    const coreOsReading = corePid !== null ? getOsReading(corePid) : undefined;
    const coreElectronMetric = corePid !== null ? electronByPid.get(corePid) : undefined;
    const coreDerivedCpu = corePid !== null ? (resolvedCpuByPid.get(corePid) ?? null) : null;
    const coreMemoryBytes =
      coreOsReading?.memoryBytes ??
      (coreElectronMetric ? coreElectronMetric.workingSetBytes : null);
    const corePrivateMemoryBytes =
      coreOsReading?.privateMemoryBytes ??
      (coreElectronMetric?.privateMemoryBytes !== undefined
        ? coreElectronMetric.privateMemoryBytes
        : undefined);
    const coreChildCount =
      corePid !== null && corePid !== mainPid
        ? (childrenByParent.get(corePid)?.filter((c) => c.pid !== process.pid).length ?? 0)
        : 0;

    const hasCorePresence =
      coreSupervisorStatus !== undefined ||
      corePid !== null ||
      hostReport?.coreServer !== undefined ||
      this.coreRpcClient !== undefined ||
      Boolean(this.coreServerUrl) ||
      Boolean(process.env["PRISMUX_SERVER_URL"]) ||
      Boolean(process.env["PRISMUX_CORE_SERVER_URL"]) ||
      Boolean(process.env["PRISMUX_CORE_SERVER_URL"]);

    const coreServer: ExtendedCoreServerResources | null = hasCorePresence
      ? {
          pid: corePid,
          cpuPercent: coreDerivedCpu,
          memoryBytes: coreMemoryBytes,
          ...(corePrivateMemoryBytes !== undefined
            ? { privateMemoryBytes: corePrivateMemoryBytes }
            : {}),
          state:
            coreState ??
            (corePid !== null && (coreMemoryBytes !== null || coreOsReading !== undefined)
              ? "running"
              : "unknown"),
          ...(coreHostedBy !== undefined ? { hostedBy: coreHostedBy } : {}),
          label:
            coreHostedBy === "electron-in-process"
              ? "Prismux Server (宿主同进程)"
              : coreHostedBy === "electron"
                ? "Prismux Server (桌面托管)"
                : coreHostedBy === "daemon-supervisor"
                  ? "Prismux Server (Daemon 托管)"
                  : "Prismux Server",
          childCount: coreChildCount,
        }
      : null;

    // Build PersistentPtyPool entries (100% compatible with existing workspace/kill API).
    const ptyEntries: PtyResourceEntry[] = ptyInfos.map((info) => {
      const sample = info.pid !== null ? getOsReading(info.pid) : undefined;
      const cpuPercent = info.pid !== null ? (resolvedCpuByPid.get(info.pid) ?? null) : null;
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
        idleMs,
      };
    });

    // Build unified deduplicated process attribution list across Desktop, Core, Agents, and Terminals.
    const processEntries: ProcessAttributionEntry[] = [];
    for (const pid of familyPids) {
      const osRow = osTree.get(pid);
      const legacyRow = legacySampledMap.get(pid);
      const electronMetric = electronByPid.get(pid);
      const ptyInfo = ptyByPid.get(pid);

      // Skip ghost PIDs that have neither live OS reading, Electron metric, nor Daemon self identity.
      if (pid !== process.pid && !osRow && !legacyRow && !electronMetric) {
        continue;
      }

      const ptyEntry = ptyInfo ? ptyEntries.find((e) => e.sessionId === ptyInfo.ptyId) : undefined;

      const processName =
        osRow?.processName ??
        (pid === process.pid
          ? basename(process.execPath)
          : electronMetric
            ? `Electron (${electronMetric.type})`
            : (ptyInfo?.command ?? `pid-${pid}`));

      const classified = classifyOsProcessEntry(
        {
          pid,
          processName,
          commandLine: osRow?.commandLine ?? ptyInfo?.command ?? null,
        },
        {
          daemonPid: process.pid,
          mainPid,
          corePid,
          ...(electronMetric !== undefined ? { electronMetric } : {}),
          ...(ptyEntry ? { ptyTitle: ptyEntry.title } : {}),
        },
      );

      const cpuPercent: number | null = resolvedCpuByPid.get(pid) ?? null;
      let memoryBytes: number | null;
      let privateMemoryBytes: number | null | undefined;
      let source: ProcessAttributionEntry["source"];

      if (pid === process.pid) {
        memoryBytes = daemonMemBytes;
        privateMemoryBytes = daemonPrivateMemBytes;
        source = "daemon-self";
      } else if (electronMetric && hostReport) {
        // On Windows, `privateWorkingSetBytes` (from PerfProc WorkingSetPrivate) is exact Task
        // Manager Memory without Chromium/Electron shared-page double counting. Prefer it over
        // Electron's inflated total `workingSetBytes`, while preserving fallback when unavailable.
        const osPrivateWsBytes =
          osRow?.privateWorkingSetBytes ?? legacyRow?.privateWorkingSetBytes ?? null;
        memoryBytes =
          process.platform === "win32" && osPrivateWsBytes !== null && osPrivateWsBytes >= 0
            ? osPrivateWsBytes
            : electronMetric.workingSetBytes > 0
              ? electronMetric.workingSetBytes
              : (osRow?.memoryBytes ?? legacyRow?.memoryBytes ?? null);
        privateMemoryBytes =
          electronMetric.privateMemoryBytes ??
          osRow?.privateMemoryBytes ??
          legacyRow?.privateMemoryBytes ??
          undefined;
        source = "electron";
      } else {
        memoryBytes = osRow?.memoryBytes ?? legacyRow?.memoryBytes ?? null;
        privateMemoryBytes =
          osRow?.privateMemoryBytes ?? legacyRow?.privateMemoryBytes ?? undefined;
        source = ptyInfo ? "pty-pool" : "os-tree";
      }

      processEntries.push({
        pid,
        parentPid: osRow?.parentPid ?? null,
        name: classified.name,
        processName,
        ...(osRow?.commandLine ? { commandLine: osRow.commandLine } : {}),
        role: classified.role,
        category: classified.category,
        cpuPercent,
        memoryBytes,
        ...(privateMemoryBytes !== undefined && privateMemoryBytes !== null
          ? { privateMemoryBytes }
          : {}),
        alive: true,
        source,
        ...(ptyEntry
          ? {
              sessionId: ptyEntry.sessionId,
              workspace: ptyEntry.workspace,
              stale: ptyEntry.stale,
            }
          : {}),
      });
    }

    // Sort processes by memory descending by default for deterministic payload ordering.
    processEntries.sort(
      (a, b) =>
        (b.memoryBytes ?? -1) - (a.memoryBytes ?? -1) ||
        (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1) ||
        a.name.localeCompare(b.name),
    );

    // Group PersistentPtyPool sessions by workspace (preserving existing contract & history).
    const workspaceMap = new Map<string, PtyResourceEntry[]>();
    for (const entry of ptyEntries) {
      const key = entry.workspace ?? entry.cwd;
      const list = workspaceMap.get(key);
      if (list) list.push(entry);
      else workspaceMap.set(key, [entry]);
    }
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
          if (pty.privateMemoryBytes !== undefined && pty.privateMemoryBytes !== null) {
            privSum += pty.privateMemoryBytes;
            hasPriv = true;
          }
        }

        const prevWsHistory = this.workspaceMemoryHistory.get(workspacePath) ?? [];
        const nextWsHistory = hasMem ? appendBoundedHistory(prevWsHistory, memSum) : prevWsHistory;
        this.workspaceMemoryHistory.set(workspacePath, nextWsHistory);

        return {
          workspace: workspacePath,
          label: basename(workspacePath) || workspacePath,
          cpuPercent: hasCpu ? clampPercent(cpuSum) : null,
          memoryBytes: hasMem ? memSum : null,
          ...(hasPriv ? { privateMemoryBytes: privSum } : {}),
          hasLocalSamples: hasMem || hasCpu,
          history: nextWsHistory,
          ptyCount: ptys.length,
          alivePtyCount: aliveCount,
          stalePtyCount: staleCount,
          ptys,
        };
      })
      .sort((a, b) => a.workspace.localeCompare(b.workspace));

    // Aggregate Desktop (Electron Main + Renderers + GPU + Utilities) summary.
    const desktopProcs = processEntries.filter((p) => p.category === "desktop");
    let desktopSummary: DesktopResourcesSummary | null = null;
    if (desktopProcs.length > 0) {
      let desktopCpu = 0;
      let hasDesktopCpu = false;
      let desktopMem = 0;
      let hasDesktopMem = false;
      let desktopPriv = 0;
      let hasDesktopPriv = false;
      let hasElectronSource = false;
      let hasTreeSource = false;

      for (const proc of desktopProcs) {
        if (proc.source === "electron") hasElectronSource = true;
        else hasTreeSource = true;
        if (proc.cpuPercent !== null) {
          desktopCpu += proc.cpuPercent;
          hasDesktopCpu = true;
        }
        if (proc.memoryBytes !== null) {
          desktopMem += proc.memoryBytes;
          hasDesktopMem = true;
        }
        if (proc.privateMemoryBytes !== undefined && proc.privateMemoryBytes !== null) {
          desktopPriv += proc.privateMemoryBytes;
          hasDesktopPriv = true;
        }
      }

      desktopSummary = {
        pid: mainPid,
        cpuPercent: hasDesktopCpu ? clampPercent(desktopCpu) : null,
        memoryBytes: hasDesktopMem ? desktopMem : null,
        ...(hasDesktopPriv ? { privateMemoryBytes: desktopPriv } : {}),
        processCount: desktopProcs.length,
        source:
          hasElectronSource && hasTreeSource
            ? "mixed"
            : hasElectronSource
              ? "electron-app-metrics"
              : "process-tree",
      };
    }

    // Aggregate deduplicated totals across ALL unique PIDs in processEntries (zero double-counting!).
    let totalManagedMem = 0;
    let totalManagedCpu = 0;
    let hasManagedCpu = false;
    let totalPrivMem = 0;
    let hasPrivMem = false;

    for (const proc of processEntries) {
      if (proc.memoryBytes !== null) {
        totalManagedMem += proc.memoryBytes;
      }
      if (proc.privateMemoryBytes !== undefined && proc.privateMemoryBytes !== null) {
        totalPrivMem += proc.privateMemoryBytes;
        hasPrivMem = true;
      }
      if (proc.cpuPercent !== null) {
        totalManagedCpu += proc.cpuPercent;
        hasManagedCpu = true;
      }
    }

    if (totalManagedMem === 0) {
      totalManagedMem = daemonMemBytes;
    }

    this.appMemoryHistory = appendBoundedHistory(this.appMemoryHistory, totalManagedMem);

    const orphanCount = ptyEntries.filter((p) => p.stale).length;
    const activeAgentCount = processEntries.filter((p) => p.category === "agent").length;
    const activeTerminalCount = processEntries.filter((p) => p.category === "terminal").length;

    const hostMetricsSource: ExtendedSystemResourcesResponse["hostMetricsSource"] =
      hostReport !== null && osTree.size > 0
        ? "hybrid"
        : hostReport !== null
          ? "electron-push"
          : osTree.size > 0
            ? "process-tree"
            : "daemon-only";

    return {
      ok: true,
      collectedAt: now,
      sampledAt: now,
      processMemoryMetric,
      ...(processCommitMetric !== undefined ? { processCommitMetric } : {}),
      totalCpuPercent: hasManagedCpu ? clampPercent(totalManagedCpu) : null,
      totalMemoryBytes: totalManagedMem,
      ...(hasPrivMem ? { totalPrivateMemoryBytes: totalPrivMem } : {}),
      hostMemoryTotalBytes: hostTotalMem,
      orphanCount,
      history: [...this.appMemoryHistory],
      host: {
        platform: process.platform,
        cpuCores,
        cpuPercent: hostCpuPercent,
        memoryBytes: hostUsedMem,
        totalMemoryBytes: hostTotalMem,
        freeMemoryBytes: hostFreeMem,
        availableMemoryBytes: hostFreeMem,
        memoryUsedPercent:
          hostTotalMem > 0 ? roundOneDecimal((hostUsedMem / hostTotalMem) * 100) : 0,
        loadAvg: os.loadavg().map((n) => roundOneDecimal(n)),
        uptimeSec: Math.round(os.uptime()),
      },
      daemon: {
        pid: process.pid,
        cpuPercent: daemonCpuPercent,
        memoryBytes: daemonMemBytes,
        ...(daemonPrivateMemBytes !== undefined && daemonPrivateMemBytes !== null
          ? { privateMemoryBytes: daemonPrivateMemBytes }
          : {}),
      },
      coreServer,
      desktop: desktopSummary,
      processes: processEntries,
      processCount: processEntries.length,
      activeAgentCount,
      activeTerminalCount,
      hostMetricsSource,
      hostMetricsUpdatedAt: freshHost?.receivedAt ?? this.latestHostMetrics?.receivedAt ?? null,
      workspaces,
      ptys: ptyEntries,
    };
  }

  async killPtySession(
    rawSessionId: unknown,
    signal?: string,
  ): Promise<{ statusCode: number; payload: KillSystemPtyResponse }> {
    if (typeof rawSessionId !== "string" || rawSessionId.trim().length === 0) {
      return {
        statusCode: 400,
        payload: {
          ok: false,
          sessionId: "",
          killed: false,
          removed: false,
          message: "参数 sessionId 必须是非空字符串。",
        },
      };
    }

    const sessionId = rawSessionId.trim();
    const outcome = await this.ptyPool.killAndRemoveSession(sessionId, signal ?? "SIGTERM");
    if (!outcome.existed) {
      return {
        statusCode: 404,
        payload: {
          ok: false,
          sessionId,
          killed: false,
          removed: false,
          message: `未找到 PTY 会话「${sessionId}」。`,
        },
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
          : `已清理僵死 PTY 会话记录「${sessionId}」。`,
      },
    };
  }
}
