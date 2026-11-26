import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import type {
  KillSystemPortResponse,
  ListeningPortEntry,
  ListeningPortScope,
  PortAttributionConfidence,
  PortServiceProtocol,
  SystemPortsResponse
} from "@prismux/protocol";
import type { PersistentPtyPool } from "../pty/PersistentPtyPool.js";
import type { CoreServerSupervisor } from "../core/CoreServerSupervisor.js";

const execFileAsync = promisify(execFile);

const DEFAULT_SCAN_TIMEOUT_MS = 2_500;
const MAX_PORTS = 200;
const SLOW_SPAWN_SKIP_METADATA_MS = 2_000;
const METADATA_REPROBE_INTERVAL_SCANS = 10;
const METADATA_CACHE_TTL_MS = 15_000;
const TIMEOUT_BACKOFF_STEPS_MS = [15_000, 30_000, 60_000] as const;

const HTTP_PORTS = new Set<number>([
  80, 3000, 3001, 4200, 5000, 5173, 5174, 8000, 8080, 8888
]);
const HTTPS_PORTS = new Set<number>([443, 8443]);

const CONTAINER_PROCESS_RE =
  /\b(com\.[\w.-]+\.backend|com\.container\w*|container\w*|docker-proxy|vpnkit)\b/i;

/**
 * OS-critical process names (lowercase without `.exe` suffix) that MUST NEVER
 * be terminated via `/v1/system/ports/kill`.
 */
const CRITICAL_SYSTEM_PROCESS_NAMES = new Set<string>([
  "system",
  "idle",
  "system idle process",
  "registry",
  "smss",
  "csrss",
  "wininit",
  "winlogon",
  "services",
  "lsass",
  "lsm",
  "svchost",
  "dwm",
  "fontdrvhost",
  "memory compression",
  "ntoskrnl",
  "secure system",
  "init",
  "systemd",
  "launchd",
  "kernel_task"
]);

const PRISMUX_PROCESS_NAME_PREFIXES = ["prismux"];

export class PortKillError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "PortKillError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface RawListeningSocket {
  pid: number;
  address: string;
  port: number;
  protocol: "tcp";
}

export interface ProcessMetadata {
  pid: number;
  processName: string;
  executablePath?: string | null;
  commandLine?: string | null;
  cwd?: string | null;
  parentPid?: number | null;
}

interface RememberedMetadataEntry {
  meta: ProcessMetadata;
  probedAtScan: number;
  probedAtMs: number;
}

export interface KillProtectionCheck {
  protected: boolean;
  reason?: string;
}

export interface PortScannerServiceOptions {
  ptyPool?: PersistentPtyPool;
  t3Supervisor?: CoreServerSupervisor;
  getProtectedPids?: () => number[];
  /** Injectable scanner for deterministic tests. */
  scanListeningSockets?: () => Promise<RawListeningSocket[]>;
  /** Injectable process metadata lookup for deterministic tests. */
  inspectProcesses?: (pids: number[]) => Promise<Map<number, ProcessMetadata>>;
  /** Injectable kill executor for deterministic tests. */
  killProcessFn?: (pid: number, signal?: NodeJS.Signals | number) => Promise<void>;
  scanTimeoutMs?: number;
}

function normalizeProcessStem(name: string): string {
  return basename(name.trim()).toLowerCase().replace(/\.exe$/i, "");
}

function inferServiceProtocol(port: number): PortServiceProtocol {
  if (HTTPS_PORTS.has(port)) {
    return "https";
  }
  if (HTTP_PORTS.has(port)) {
    return "http";
  }
  return "unknown";
}

function isContainerProcess(meta?: ProcessMetadata | null): boolean {
  if (!meta) {
    return false;
  }
  const haystack = `${meta.processName} ${meta.commandLine ?? ""}`;
  return CONTAINER_PROCESS_RE.test(haystack);
}

function resolveConnectHost(
  rawAddress: string,
  serviceProtocol: PortServiceProtocol
): { bindHost: string; connectHost: string; url: (port: number) => string } {
  const bindHost = rawAddress.trim() || "127.0.0.1";
  const cleaned = bindHost.replace(/^\[|\]$/g, "");
  const lowerCleaned = cleaned.toLowerCase();
  const scheme = serviceProtocol === "https" ? "https" : "http";

  if (
    lowerCleaned === "" ||
    lowerCleaned === "0.0.0.0" ||
    lowerCleaned === "::" ||
    lowerCleaned === "*" ||
    lowerCleaned === "::1" ||
    lowerCleaned === "::ffff:127.0.0.1" ||
    lowerCleaned === "::ffff:0.0.0.0"
  ) {
    return {
      bindHost,
      connectHost: "127.0.0.1",
      url: (port) => `${scheme}://127.0.0.1:${port}`
    };
  }
  if (cleaned.includes(":")) {
    return {
      bindHost,
      connectHost: cleaned,
      url: (port) => `${scheme}://[${cleaned}]:${port}`
    };
  }
  return {
    bindHost,
    connectHost: cleaned,
    url: (port) => `${scheme}://${cleaned}:${port}`
  };
}

/**
 * Ranks bind addresses when collapsing IPv4/IPv6 dual-stack listeners for the
 * same `(pid, port, connectHost)`. Lower rank wins (concrete IPv4 > wildcard IPv4 > IPv6).
 */
function rankBindHostPreference(rawAddress: string): number {
  const cleaned = rawAddress.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (cleaned === "127.0.0.1") {
    return 0;
  }
  if (cleaned === "0.0.0.0") {
    return 1;
  }
  if (cleaned.length > 0 && !cleaned.includes(":") && cleaned !== "*") {
    return 2;
  }
  if (cleaned === "::1" || cleaned === "::ffff:127.0.0.1") {
    return 3;
  }
  if (cleaned === "::" || cleaned === "*" || cleaned === "::ffff:0.0.0.0") {
    return 4;
  }
  return 5;
}

async function expandPathAliases(inputPath: string): Promise<string[]> {
  const resolved = resolve(inputPath);
  const aliases = [resolved];
  try {
    const real = await realpath(resolved);
    if (real !== resolved) {
      aliases.push(real);
    }
  } catch {
    // Non-existent or inaccessible paths keep lexical resolution.
  }
  return aliases;
}

function isPathInsideOrEqual(candidate: string, root: string): boolean {
  const resolvedCandidate = resolve(candidate);
  const resolvedRoot = resolve(root);
  const a =
    process.platform === "win32" ? resolvedCandidate.toLowerCase() : resolvedCandidate;
  const b = process.platform === "win32" ? resolvedRoot.toLowerCase() : resolvedRoot;
  const rel = relative(b, a);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function doesCommandLineMentionWorkspace(
  commandLine: string | null | undefined,
  workspacePath: string
): boolean {
  if (!commandLine || commandLine.trim().length === 0) {
    return false;
  }
  const normalizedWorkspace = resolve(workspacePath);
  const hay = process.platform === "win32" ? commandLine.toLowerCase() : commandLine;
  const needleNative =
    process.platform === "win32"
      ? normalizedWorkspace.toLowerCase()
      : normalizedWorkspace;
  const needleSlash = needleNative.replaceAll("\\", "/");
  const haySlash = hay.replaceAll("\\", "/");
  const idx = haySlash.indexOf(needleSlash);
  if (idx === -1) {
    return false;
  }
  const afterChar = haySlash[idx + needleSlash.length];
  return (
    afterChar === undefined ||
    afterChar === "/" ||
    afterChar === " " ||
    afterChar === '"' ||
    afterChar === "'" ||
    afterChar === "\t"
  );
}

function isCommandTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const err = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
  return (
    err.code === "ETIMEDOUT" ||
    Boolean(err.killed && err.signal === "SIGTERM") ||
    /timed out/i.test(err.message)
  );
}

/**
 * Parses Windows `netstat -ano` output into TCP LISTENING socket entries.
 */
export function parseWindowsNetstatOutput(stdout: string): RawListeningSocket[] {
  const results: RawListeningSocket[] = [];
  const lines = stdout.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length < 5) {
      continue;
    }
    const proto = parts[0]!.toUpperCase();
    if (proto !== "TCP") {
      continue;
    }
    const localAddr = parts[1]!;
    const state = parts[3]!.toUpperCase();
    if (state !== "LISTENING" && state !== "监听") {
      continue;
    }
    const pid = Number.parseInt(parts[4]!, 10);
    if (!Number.isInteger(pid) || pid < 0) {
      continue;
    }

    const lastColon = localAddr.lastIndexOf(":");
    if (lastColon <= 0) {
      continue;
    }
    const address = localAddr.slice(0, lastColon);
    const port = Number.parseInt(localAddr.slice(lastColon + 1), 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      continue;
    }

    results.push({
      pid,
      address,
      port,
      protocol: "tcp"
    });
  }

  return results;
}

/**
 * Parses Linux/macOS `lsof -iTCP -sTCP:LISTEN -P -n` or `ss -tlnp` output.
 */
export function parseUnixListeningOutput(stdout: string): RawListeningSocket[] {
  const results: RawListeningSocket[] = [];
  const lines = stdout.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("COMMAND") || line.startsWith("State")) {
      continue;
    }
    const lsofMatch = /^\S+\s+(\d+)\s+.*\s+TCP\s+(\S+):(\d+)\s+\(LISTEN\)/i.exec(line);
    if (lsofMatch !== null) {
      const pid = Number.parseInt(lsofMatch[1]!, 10);
      const port = Number.parseInt(lsofMatch[3]!, 10);
      if (Number.isInteger(pid) && pid >= 0 && port >= 1 && port <= 65535) {
        results.push({
          pid,
          address: lsofMatch[2]!,
          port,
          protocol: "tcp"
        });
      }
      continue;
    }
    const ssMatch = /^LISTEN\s+\d+\s+\d+\s+(\S+):(\d+)\s+\S+\s+.*pid=(\d+)/i.exec(line);
    if (ssMatch !== null) {
      const port = Number.parseInt(ssMatch[2]!, 10);
      const pid = Number.parseInt(ssMatch[3]!, 10);
      if (Number.isInteger(pid) && pid >= 0 && port >= 1 && port <= 65535) {
        results.push({
          pid,
          address: ssMatch[1]!,
          port,
          protocol: "tcp"
        });
      }
    }
  }
  return results;
}

async function defaultScanListeningSockets(
  timeoutMs: number
): Promise<RawListeningSocket[]> {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("netstat", ["-ano"], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    });
    return parseWindowsNetstatOutput(stdout);
  }

  try {
    const { stdout } = await execFileAsync(
      "lsof",
      ["-iTCP", "-sTCP:LISTEN", "-P", "-n"],
      {
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024
      }
    );
    return parseUnixListeningOutput(stdout);
  } catch {
    try {
      const { stdout } = await execFileAsync("ss", ["-tlnp"], {
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024
      });
      return parseUnixListeningOutput(stdout);
    } catch {
      return [];
    }
  }
}

async function defaultInspectProcesses(
  pids: number[],
  timeoutMs: number
): Promise<Map<number, ProcessMetadata>> {
  const result = new Map<number, ProcessMetadata>();
  const uniquePids = [...new Set(pids.filter((p) => Number.isInteger(p) && p >= 0))];
  if (uniquePids.length === 0) {
    return result;
  }

  for (const pid of uniquePids) {
    if (pid === 0) {
      result.set(0, { pid: 0, processName: "System Idle Process" });
    } else if (pid === 4 && process.platform === "win32") {
      result.set(4, { pid: 4, processName: "System" });
    }
  }

  const queryPids = uniquePids.filter((p) => p > 4 || process.platform !== "win32");
  if (queryPids.length === 0) {
    return result;
  }

  if (process.platform === "win32") {
    const filterExpr = queryPids.map((p) => `ProcessId=${p}`).join(" OR ");
    const psScript = `Get-CimInstance Win32_Process -Filter "${filterExpr}" | Select-Object ProcessId,Name,ExecutablePath,CommandLine,ParentProcessId | ConvertTo-Json -Compress`;
    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", psScript],
        {
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024
        }
      );
      const trimmed = stdout.trim();
      if (trimmed.length > 0) {
        const parsed = JSON.parse(trimmed) as unknown;
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        for (const row of rows) {
          if (typeof row !== "object" || row === null) continue;
          const rec = row as Record<string, unknown>;
          const pid = typeof rec["ProcessId"] === "number" ? rec["ProcessId"] : -1;
          if (pid < 0) continue;
          result.set(pid, {
            pid,
            processName:
              typeof rec["Name"] === "string" && rec["Name"].length > 0
                ? rec["Name"]
                : `pid-${pid}`,
            executablePath:
              typeof rec["ExecutablePath"] === "string"
                ? rec["ExecutablePath"]
                : null,
            commandLine:
              typeof rec["CommandLine"] === "string" ? rec["CommandLine"] : null,
            parentPid:
              typeof rec["ParentProcessId"] === "number"
                ? rec["ParentProcessId"]
                : null
          });
        }
        return result;
      }
    } catch {
      // Fallback to tasklist
    }

    try {
      const { stdout } = await execFileAsync("tasklist", ["/FO", "CSV", "/NH"], {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      });
      const wanted = new Set(queryPids);
      for (const line of stdout.split(/\r?\n/)) {
        const match = /^"([^"]+)","(\d+)"/.exec(line.trim());
        if (!match) continue;
        const pid = Number.parseInt(match[2]!, 10);
        if (wanted.has(pid) && !result.has(pid)) {
          result.set(pid, { pid, processName: match[1]! });
        }
      }
    } catch {
      // Return partial best-effort metadata
    }
    return result;
  }

  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-o", "pid=,ppid=,comm=,args=", "-p", queryPids.join(",")],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }
    );
    for (const rawLine of stdout.split(/\r?\n/)) {
      const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(rawLine);
      if (!match) continue;
      const pid = Number.parseInt(match[1]!, 10);
      const parentPid = Number.parseInt(match[2]!, 10);
      result.set(pid, {
        pid,
        parentPid,
        processName: match[3]!,
        commandLine: match[4]?.trim() || null
      });
    }
  } catch {
    // Best-effort
  }

  return result;
}

async function defaultKillProcess(
  pid: number,
  signal: NodeJS.Signals | number = "SIGTERM"
): Promise<void> {
  if (process.platform === "win32") {
    try {
      process.kill(pid, signal);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ESRCH") {
        throw new PortKillError(404, "PROCESS_NOT_FOUND", `未找到进程 PID ${pid}。`);
      }
      try {
        await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          timeout: 3_000,
          windowsHide: true
        });
        return;
      } catch (taskkillErr) {
        const msg =
          taskkillErr instanceof Error ? taskkillErr.message : String(taskkillErr);
        if (/not found|没有找到/i.test(msg)) {
          throw new PortKillError(404, "PROCESS_NOT_FOUND", `未找到进程 PID ${pid}。`);
        }
        throw err;
      }
    }
  }

  try {
    process.kill(pid, signal);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      throw new PortKillError(404, "PROCESS_NOT_FOUND", `未找到进程 PID ${pid}。`);
    }
    throw err;
  }
}

/**
 * Asynchronous TCP LISTEN port scanner and protected PID killer for Prismux Daemon.
 * Aligned with `stablyai/orca` (`workspace-ports.ts`, `local-workspace-port-attribution.ts`,
 * `local-workspace-port-scan-state.ts`, `workspace-port-ownership.ts`):
 * - `bindHost` vs `connectHost` + inferred HTTP/HTTPS protocol + `attributionConfidence` (`cwd`/`command`/`none`)
 * - Container process classification, realpath symlink alias resolution, and 200-port cap
 * - Command-timeout exponential cooldown backoff and slow-spawn metadata skip (always bypassed on kill)
 * - Strict anti-self-kill and anti-system-kill guard returning HTTP 403 with Chinese reason
 */
export class PortScannerService {
  private readonly ptyPool: PersistentPtyPool | undefined;
  private readonly t3Supervisor: CoreServerSupervisor | undefined;
  private readonly getProtectedPids: (() => number[]) | undefined;
  private readonly scanListeningSocketsFn: () => Promise<RawListeningSocket[]>;
  private readonly inspectProcessesFn: (
    pids: number[]
  ) => Promise<Map<number, ProcessMetadata>>;
  private readonly killProcessFn: (
    pid: number,
    signal?: NodeJS.Signals | number
  ) => Promise<void>;

  private scanSequence = 0;
  private skippedMetadataOnLastScan = false;
  private rememberedMetadataByPid = new Map<number, RememberedMetadataEntry>();
  private consecutiveTimeouts = 0;
  private cooldownUntilMs = 0;

  constructor(options: PortScannerServiceOptions = {}) {
    const timeoutMs = options.scanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
    this.ptyPool = options.ptyPool;
    this.t3Supervisor = options.t3Supervisor;
    this.getProtectedPids = options.getProtectedPids;
    this.scanListeningSocketsFn =
      options.scanListeningSockets ??
      (() => defaultScanListeningSockets(timeoutMs));
    this.inspectProcessesFn =
      options.inspectProcesses ??
      ((pids) => defaultInspectProcesses(pids, timeoutMs));
    this.killProcessFn = options.killProcessFn ?? defaultKillProcess;
  }

  private collectProtectedHostPids(): {
    selfPid: number;
    parentPid: number;
    t3ServerPid: number | null;
    prismuxMainPid: number | null;
    extraProtectedPids: Set<number>;
  } {
    const selfPid = process.pid;
    const parentPid = process.ppid;
    const t3PidRaw = this.t3Supervisor?.getStatus().pid;
    const t3ServerPid =
      typeof t3PidRaw === "number" && Number.isInteger(t3PidRaw) && t3PidRaw > 0
        ? t3PidRaw
        : null;

    const envMainPidRaw = Number.parseInt(
      process.env["PRISMUX_MAIN_PID"] ?? "",
      10
    );
    const prismuxMainPid =
      Number.isInteger(envMainPidRaw) && envMainPidRaw > 0 ? envMainPidRaw : null;

    const extraProtectedPids = new Set<number>();
    if (this.getProtectedPids) {
      for (const pid of this.getProtectedPids()) {
        if (Number.isInteger(pid) && pid > 0) {
          extraProtectedPids.add(pid);
        }
      }
    }

    return {
      selfPid,
      parentPid,
      t3ServerPid,
      prismuxMainPid,
      extraProtectedPids
    };
  }

  /**
   * Evaluates whether a target PID + optional process metadata is protected from termination.
   */
  evaluateKillProtection(
    pid: number,
    meta?: ProcessMetadata | null
  ): KillProtectionCheck {
    if (!Number.isInteger(pid) || pid <= 4) {
      return {
        protected: true,
        reason: `禁止终止系统核心进程（PID ${pid} <= 4）。`
      };
    }

    const hostPids = this.collectProtectedHostPids();
    if (pid === hostPids.selfPid) {
      return {
        protected: true,
        reason: `禁止终止 Prismux Daemon 自身进程（PID ${pid}）。`
      };
    }
    if (hostPids.parentPid > 0 && pid === hostPids.parentPid) {
      return {
        protected: true,
        reason: `禁止终止 Prismux Daemon 父进程 / 桌面主进程（PID ${pid}）。`
      };
    }
    if (hostPids.t3ServerPid !== null && pid === hostPids.t3ServerPid) {
      return {
        protected: true,
        reason: `禁止终止 Prismux 托管的核心服务进程（PID ${pid}）。`
      };
    }
    if (hostPids.prismuxMainPid !== null && pid === hostPids.prismuxMainPid) {
      return {
        protected: true,
        reason: `禁止终止 Prismux 桌面主进程（PID ${pid}）。`
      };
    }
    if (hostPids.extraProtectedPids.has(pid)) {
      return {
        protected: true,
        reason: `禁止终止受保护的 Prismux 核心进程（PID ${pid}）。`
      };
    }

    if (meta) {
      const stem = normalizeProcessStem(meta.processName);
      if (CRITICAL_SYSTEM_PROCESS_NAMES.has(stem)) {
        return {
          protected: true,
          reason: `禁止终止系统关键进程「${meta.processName}」（PID ${pid}）。`
        };
      }
      if (
        PRISMUX_PROCESS_NAME_PREFIXES.some(
          (prefix) => stem === prefix || stem.startsWith(`${prefix}-`)
        )
      ) {
        return {
          protected: true,
          reason: `禁止终止 Prismux 主进程「${meta.processName}」（PID ${pid}）。`
        };
      }
      const cmdLower = (meta.commandLine ?? "").toLowerCase();
      if (
        cmdLower.includes("prismux-daemon") ||
        cmdLower.includes("apps\\daemon\\dist\\cli.js") ||
        cmdLower.includes("apps/daemon/dist/cli.js") ||
        cmdLower.includes("apps\\server\\dist") ||
        cmdLower.includes("apps/server/dist")
      ) {
        return {
          protected: true,
          reason: `禁止终止 Prismux 核心服务进程「${meta.processName}」（PID ${pid}）。`
        };
      }
    }

    return { protected: false };
  }

  async scanPorts(
    workspace?: string,
    options: { requireMetadata?: boolean } = {}
  ): Promise<SystemPortsResponse> {
    const normalizedWorkspace =
      workspace !== undefined && workspace.trim().length > 0
        ? resolve(workspace.trim())
        : null;
    const now = Date.now();

    if (!options.requireMetadata && now < this.cooldownUntilMs) {
      const remainingSec = Math.max(
        1,
        Math.ceil((this.cooldownUntilMs - now) / 1000)
      );
      return {
        ok: true,
        platform: process.platform,
        scannedAt: now,
        workspace: normalizedWorkspace,
        ports: [],
        totalCount: 0,
        workspaceCount: 0,
        externalCount: 0,
        metadataAvailable: false,
        unavailableReason: `端口扫描因命令超时短暂退避冷却，将在 ${remainingSec}s 后恢复。`
      };
    }

    let rawSockets: RawListeningSocket[];
    const scanStarted = performance.now();
    try {
      rawSockets = await this.scanListeningSocketsFn();
      this.consecutiveTimeouts = 0;
      this.cooldownUntilMs = 0;
    } catch (error) {
      if (isCommandTimeoutError(error)) {
        const idx = Math.min(
          this.consecutiveTimeouts,
          TIMEOUT_BACKOFF_STEPS_MS.length - 1
        );
        const backoffMs = TIMEOUT_BACKOFF_STEPS_MS[idx] ?? 15_000;
        this.consecutiveTimeouts += 1;
        this.cooldownUntilMs = Date.now() + backoffMs;
        return {
          ok: true,
          platform: process.platform,
          scannedAt: Date.now(),
          workspace: normalizedWorkspace,
          ports: [],
          totalCount: 0,
          workspaceCount: 0,
          externalCount: 0,
          metadataAvailable: false,
          unavailableReason: `端口扫描命令超时，已进入 ${Math.ceil(backoffMs / 1000)}s 退避冷却。`
        };
      }
      throw error;
    }

    const spawnMs = performance.now() - scanStarted;
    this.scanSequence += 1;

    // Collapse IPv4/IPv6 dual-stack duplicates (e.g. `0.0.0.0:135` + `[::]:135`,
    // `127.0.0.1:53` + `[::1]:53`) that resolve to the same `(pid, port, connectHost)`.
    const dedupMap = new Map<string, RawListeningSocket>();
    for (const sock of rawSockets) {
      const hostInfo = resolveConnectHost(
        sock.address,
        inferServiceProtocol(sock.port)
      );
      const key = `${sock.pid}:${sock.port}:${hostInfo.connectHost.toLowerCase()}`;
      const existing = dedupMap.get(key);
      if (
        existing === undefined ||
        rankBindHostPreference(sock.address) <
          rankBindHostPreference(existing.address)
      ) {
        dedupMap.set(key, sock);
      }
    }
    const uniqueSockets = [...dedupMap.values()];
    const pids = [...new Set(uniqueSockets.map((s) => s.pid))];

    // Orca slow-spawn guard: skip fresh metadata for 1 cycle when listener scan itself >2s
    // (never skipped when `requireMetadata` is set).
    const skipMetadata =
      !options.requireMetadata &&
      spawnMs > SLOW_SPAWN_SKIP_METADATA_MS &&
      !this.skippedMetadataOnLastScan;
    this.skippedMetadataOnLastScan = skipMetadata;

    let metadataMap = new Map<number, ProcessMetadata>();
    let metadataAvailable = true;
    const inspectNowMs = Date.now();

    if (skipMetadata) {
      metadataAvailable = false;
      for (const pid of pids) {
        const cached = this.rememberedMetadataByPid.get(pid);
        if (
          cached &&
          this.scanSequence - cached.probedAtScan < METADATA_REPROBE_INTERVAL_SCANS
        ) {
          metadataMap.set(pid, cached.meta);
        }
      }
    } else if (!options.requireMetadata && this.rememberedMetadataByPid.size > 0) {
      const pidsToQuery: number[] = [];
      for (const pid of pids) {
        const cached = this.rememberedMetadataByPid.get(pid);
        if (
          cached &&
          inspectNowMs - cached.probedAtMs < METADATA_CACHE_TTL_MS &&
          this.scanSequence - cached.probedAtScan < METADATA_REPROBE_INTERVAL_SCANS
        ) {
          metadataMap.set(pid, cached.meta);
        } else {
          pidsToQuery.push(pid);
        }
      }
      if (pidsToQuery.length > 0) {
        const freshMap = await this.inspectProcessesFn(pidsToQuery);
        for (const [pid, meta] of freshMap.entries()) {
          metadataMap.set(pid, meta);
        }
      }
      const nextRemembered = new Map<number, RememberedMetadataEntry>();
      for (const [pid, meta] of metadataMap.entries()) {
        const prev = this.rememberedMetadataByPid.get(pid);
        const wasFreshlyProbed = pidsToQuery.includes(pid) || prev === undefined;
        nextRemembered.set(pid, {
          meta,
          probedAtScan: wasFreshlyProbed ? this.scanSequence : prev.probedAtScan,
          probedAtMs: wasFreshlyProbed ? inspectNowMs : prev.probedAtMs
        });
      }
      this.rememberedMetadataByPid = nextRemembered;
    } else {
      metadataMap = await this.inspectProcessesFn(pids);
      const nextRemembered = new Map<number, RememberedMetadataEntry>();
      for (const [pid, meta] of metadataMap.entries()) {
        nextRemembered.set(pid, {
          meta,
          probedAtScan: this.scanSequence,
          probedAtMs: inspectNowMs
        });
      }
      this.rememberedMetadataByPid = nextRemembered;
    }

    // Map PTY child PIDs to their known cwd
    const ptyCwdByPid = new Map<number, string>();
    const knownPtyWorkspaces: string[] = [];
    if (this.ptyPool) {
      for (const info of this.ptyPool.listSessionRuntimeInfos()) {
        if (info.cwd) {
          knownPtyWorkspaces.push(resolve(info.cwd));
        }
        if (info.pid !== null) {
          ptyCwdByPid.set(info.pid, resolve(info.cwd));
        }
      }
    }

    const workspaceAliases =
      normalizedWorkspace !== null ? await expandPathAliases(normalizedWorkspace) : [];

    const entries: ListeningPortEntry[] = uniqueSockets.map((sock) => {
      const meta = metadataMap.get(sock.pid);
      const processName =
        meta?.processName ??
        (sock.pid === 0
          ? "System Idle Process"
          : sock.pid === 4
            ? "System"
            : `pid-${sock.pid}`);

      const resolvedCwd =
        meta?.cwd ??
        ptyCwdByPid.get(sock.pid) ??
        (sock.pid === process.pid ? process.cwd() : null);

      let scope: ListeningPortScope = "external";
      let attributionConfidence: PortAttributionConfidence = "none";
      let matchedWorkspace: string | null = null;

      if (normalizedWorkspace !== null) {
        const cwdMatches =
          resolvedCwd !== null &&
          workspaceAliases.some((alias) => isPathInsideOrEqual(resolvedCwd, alias));
        const exeMatches =
          meta?.executablePath != null &&
          workspaceAliases.some((alias) =>
            isPathInsideOrEqual(meta.executablePath!, alias)
          );
        const cmdMatches = workspaceAliases.some((alias) =>
          doesCommandLineMentionWorkspace(meta?.commandLine, alias)
        );
        if (cwdMatches) {
          scope = "workspace";
          attributionConfidence = "cwd";
          matchedWorkspace = normalizedWorkspace;
        } else if (exeMatches || cmdMatches) {
          scope = "workspace";
          attributionConfidence = "command";
          matchedWorkspace = normalizedWorkspace;
        }
      } else if (resolvedCwd !== null) {
        const matchedPtyWs = knownPtyWorkspaces.find((ws) =>
          isPathInsideOrEqual(resolvedCwd, ws)
        );
        if (matchedPtyWs !== undefined) {
          scope = "workspace";
          attributionConfidence = "cwd";
          matchedWorkspace = matchedPtyWs;
        }
      }

      const containerFlag = scope === "external" && isContainerProcess(meta);
      const protection = this.evaluateKillProtection(
        sock.pid,
        meta ?? { pid: sock.pid, processName }
      );
      const serviceProtocol = inferServiceProtocol(sock.port);
      const hostInfo = resolveConnectHost(sock.address, serviceProtocol);

      return {
        id: `${hostInfo.bindHost}:${sock.port}:${sock.pid}`,
        port: sock.port,
        pid: sock.pid,
        processName,
        host: hostInfo.connectHost,
        bindHost: hostInfo.bindHost,
        connectHost: hostInfo.connectHost,
        address: sock.address,
        protocol: "tcp",
        serviceProtocol,
        url: hostInfo.url(sock.port),
        cwd: resolvedCwd,
        scope,
        attributionConfidence,
        isContainer: containerFlag,
        workspace: matchedWorkspace,
        protected: protection.protected,
        ...(protection.reason !== undefined
          ? { protectedReason: protection.reason }
          : {})
      };
    });

    // Orca priority sort: workspace -> container -> external, then port asc, then connectHost, capped at MAX_PORTS
    entries.sort((a, b) => {
      const rank = (e: ListeningPortEntry): number =>
        e.scope === "workspace" ? 0 : e.isContainer ? 1 : 2;
      return (
        rank(a) - rank(b) ||
        a.port - b.port ||
        a.connectHost.localeCompare(b.connectHost) ||
        a.pid - b.pid
      );
    });

    const capped = entries.slice(0, MAX_PORTS);
    const workspaceCount = capped.filter((e) => e.scope === "workspace").length;
    return {
      ok: true,
      platform: process.platform,
      scannedAt: Date.now(),
      workspace: normalizedWorkspace,
      ports: capped,
      totalCount: capped.length,
      workspaceCount,
      externalCount: capped.length - workspaceCount,
      metadataAvailable
    };
  }

  async killPid(
    rawPid: unknown,
    signal?: string
  ): Promise<KillSystemPortResponse> {
    if (typeof rawPid !== "number" || !Number.isInteger(rawPid) || rawPid < 0) {
      throw new PortKillError(
        400,
        "INVALID_PID",
        "参数 pid 必须是非负整数。"
      );
    }

    const pid = rawPid;

    // 1. Fast static check before inspecting OS process table (PID <= 4, self, parent, T3 Server).
    const fastCheck = this.evaluateKillProtection(pid, null);
    if (fastCheck.protected) {
      throw new PortKillError(
        403,
        "PROTECTED_PROCESS",
        fastCheck.reason ?? `禁止终止受保护进程（PID ${pid}）。`
      );
    }

    // 2. Always query FRESH OS process metadata (never trust cached metadata for kill authorization).
    const metaMap = await this.inspectProcessesFn([pid]);
    const meta = metaMap.get(pid) ?? null;
    const metaCheck = this.evaluateKillProtection(pid, meta);
    if (metaCheck.protected) {
      throw new PortKillError(
        403,
        "PROTECTED_PROCESS",
        metaCheck.reason ?? `禁止终止受保护进程（PID ${pid}）。`
      );
    }

    await this.killProcessFn(
      pid,
      (signal as NodeJS.Signals | undefined) ?? "SIGTERM"
    );

    return {
      ok: true,
      pid,
      killed: true,
      message: `已发送终止信号至进程 PID ${pid}${meta ? ` (${meta.processName})` : ""}。`
    };
  }
}
