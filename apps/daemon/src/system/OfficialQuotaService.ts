import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import {
  buildSafeCliSpawnSpec,
  decodeWindowsProcessOutput,
  findExecutableOnPath,
  refreshWindowsEnvironmentFromRegistry,
  type WindowsEnvRefreshResult
} from "./WindowsEnvRefresh.js";

const execFileAsync = promisify(execFile);

export const OFFICIAL_QUOTA_CACHE_TTL_MS = 3 * 60 * 1_000;
const NEGATIVE_CACHE_TTL_MS = 15_000;
const DEFAULT_USAGE_PRINT_TIMEOUT_SEC = 15;
const DEFAULT_USAGE_EXEC_TIMEOUT_MS = 18_000;
const DEFAULT_CREDITS_PRINT_TIMEOUT_SEC = 10;
const DEFAULT_CREDITS_EXEC_TIMEOUT_MS = 12_000;
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;

export type OfficialQuotaWindowKind = "weekly" | "5h" | "other";

export interface OfficialQuotaWindowEntry {
  id: string;
  group: string;
  groupId: string;
  window: OfficialQuotaWindowKind;
  shortLabel: string;
  detailLabel: string;
  remainingPercent: number;
  usedPercent: number;
  resetAtIso: string | null;
  resetAtMs: number | null;
  rawGroup?: string;
  rawWindow?: string;
}

export type OfficialQuotaProviderStatus =
  | "ok"
  | "not_installed"
  | "unauthenticated"
  | "timeout"
  | "error";

export interface OfficialQuotaProviderSnapshot {
  id: "antigravity";
  providerId: "antigravity";
  displayName: "Antigravity";
  source: "official-cli";
  command: string;
  status: OfficialQuotaProviderStatus;
  available: boolean;
  executablePath: string | null;
  windows: OfficialQuotaWindowEntry[];
  remainingCredits: number | null;
  fetchedAt: number;
  fetchedAtIso: string;
  error: string | null;
}

export interface OfficialQuotaSummaryResponse {
  ok: true;
  cached: boolean;
  cacheTtlMs: number;
  fetchedAt: number;
  fetchedAtIso: string;
  providers: OfficialQuotaProviderSnapshot[];
  antigravity: OfficialQuotaProviderSnapshot;
}

export interface OfficialCliExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut?: boolean;
  errorMessage?: string;
}

export interface OfficialQuotaServiceOptions {
  /** Cache TTL for successful quota snapshots (default 3 minutes). */
  cacheTtlMs?: number;
  /** Short TTL for negative results so unavailable states do not hammer CLI (default 15s). */
  negativeCacheTtlMs?: number;
  /** Subprocess timeout for `agy -p "/usage"` (default 18s; CLI `--print-timeout` is 15s). */
  usageTimeoutMs?: number;
  /** Subprocess timeout for `agy -p "/credits"` (default 12s; CLI `--print-timeout` is 10s). */
  creditsTimeoutMs?: number;
  /** Whether to also fetch best-effort `/credits` in parallel (default true). */
  includeCredits?: boolean;
  /** Injectable clock for deterministic unit tests. */
  now?: () => number;
  /** Injectable platform for deterministic unit tests. */
  platform?: NodeJS.Platform;
  /** Injectable environment map for deterministic unit tests. */
  env?: Record<string, string | undefined>;
  /** Injectable Windows environment refresh helper. */
  refreshEnv?: () => Promise<WindowsEnvRefreshResult | void> | void;
  /** Injectable executable locator for deterministic unit tests. */
  locateExecutable?: (
    env: Record<string, string | undefined>,
    platform: NodeJS.Platform
  ) => string | null;
  /** Injectable official CLI runner for deterministic unit tests. */
  cliRunner?: (
    executablePath: string,
    args: readonly string[],
    timeoutMs: number,
    env: Record<string, string | undefined>,
    platform: NodeJS.Platform
  ) => Promise<OfficialCliExecResult>;
}

const CANONICAL_WINDOW_ORDER = new Map<string, number>([
  ["gemini:weekly", 0],
  ["gemini:5h", 1],
  ["claude-gpt:weekly", 2],
  ["claude-gpt:5h", 3]
]);

function clampPercent(raw: number): number {
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function stripAnsi(raw: string): string {
  return raw.replace(ANSI_ESCAPE_RE, "");
}

function normalizeGroup(rawGroup: string): { groupId: string; group: string } {
  const cleaned = rawGroup.trim();
  const lower = cleaned.toLowerCase();
  if (lower.includes("gemini")) {
    return { groupId: "gemini", group: "Gemini" };
  }
  if (lower.includes("claude") || lower.includes("gpt")) {
    return { groupId: "claude-gpt", group: "Claude/GPT" };
  }
  const slug = lower
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return {
    groupId: slug || "other",
    group: cleaned || "Unknown"
  };
}

function normalizeWindowKind(rawWindow: string): {
  window: OfficialQuotaWindowKind;
  shortSuffix: string;
  detailSuffix: string;
  isUsedSemantics: boolean;
} {
  const cleaned = rawWindow.trim();
  const lower = cleaned.toLowerCase();
  const isUsedSemantics =
    lower.includes("used") && !lower.includes("remaining") && !lower.includes("left");

  if (lower.includes("weekly") || lower.includes("week") || /\b7\s*d\b/.test(lower)) {
    return {
      window: "weekly",
      shortSuffix: "周",
      detailSuffix: "每周",
      isUsedSemantics
    };
  }
  if (
    lower.includes("five hour") ||
    lower.includes("5 hour") ||
    /\b5\s*h\b/.test(lower) ||
    lower.includes("session")
  ) {
    return {
      window: "5h",
      shortSuffix: "5h",
      detailSuffix: "5h",
      isUsedSemantics
    };
  }
  const compact = cleaned
    .replace(/\b(limit|remaining|used|quota)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const fallback = compact || cleaned || "额度";
  return {
    window: "other",
    shortSuffix: fallback,
    detailSuffix: fallback,
    isUsedSemantics
  };
}

function parsePercentToken(rawPercent: string): number | null {
  const match = /(-?\d+(?:\.\d+)?)\s*%?/.exec(rawPercent.trim());
  if (!match?.[1]) {
    return null;
  }
  const numeric = Number.parseFloat(match[1]);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return clampPercent(numeric);
}

function parseIsoTimestamp(rawIso: string | undefined): {
  iso: string | null;
  ms: number | null;
} {
  if (!rawIso) {
    return { iso: null, ms: null };
  }
  const trimmed = rawIso.trim();
  if (trimmed.length === 0) {
    return { iso: null, ms: null };
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    return { iso: null, ms: null };
  }
  return {
    iso: new Date(parsed).toISOString(),
    ms: parsed
  };
}

/**
 * Parses the official machine-readable TSV output of `agy -p "/usage"`.
 *
 * Expected lines:
 * `Gemini Models\tWeekly Limit Remaining\t93%\t2026-11-30T20:03:11Z`
 * `Gemini Models\tFive Hour Limit Remaining\t92%\t2026-11-24T09:34:15Z`
 * `Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-12-01T06:04:49Z`
 * `Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-11-24T11:04:49Z`
 */
export function parseAgyUsageTsv(rawOutput: string): OfficialQuotaWindowEntry[] {
  const cleaned = stripAnsi(rawOutput);
  const byId = new Map<string, OfficialQuotaWindowEntry>();
  let extraCounter = 0;

  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    const columns = rawLine
      .split("\t")
      .map((col) => col.trim());
    if (columns.length < 3) {
      continue;
    }

    const rawGroup = columns[0] ?? "";
    const rawWindow = columns[1] ?? "";
    const rawPercent = columns[2] ?? "";
    const rawReset = columns[3];

    if (!rawGroup || !rawWindow) {
      continue;
    }

    const parsedPercent = parsePercentToken(rawPercent);
    if (parsedPercent === null) {
      continue;
    }

    const { groupId, group } = normalizeGroup(rawGroup);
    const { window, shortSuffix, detailSuffix, isUsedSemantics } =
      normalizeWindowKind(rawWindow);
    const remainingPercent = isUsedSemantics
      ? clampPercent(100 - parsedPercent)
      : parsedPercent;
    const usedPercent = clampPercent(100 - remainingPercent);
    const reset = parseIsoTimestamp(rawReset);

    const baseId =
      window === "other"
        ? `${groupId}:other:${extraCounter++}`
        : `${groupId}:${window}`;

    byId.set(baseId, {
      id: baseId,
      group,
      groupId,
      window,
      shortLabel: `${group} ${shortSuffix}`,
      detailLabel: `${group} · ${detailSuffix}`,
      remainingPercent,
      usedPercent,
      resetAtIso: reset.iso,
      resetAtMs: reset.ms,
      rawGroup,
      rawWindow
    });
  }

  return Array.from(byId.values()).sort((a, b) => {
    const rankA = CANONICAL_WINDOW_ORDER.get(a.id) ?? 100;
    const rankB = CANONICAL_WINDOW_ORDER.get(b.id) ?? 100;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * Parses the official TSV output of `agy -p "/credits"` (e.g. `Remaining credits\t0`).
 */
export function parseAgyCreditsTsv(rawOutput: string): number | null {
  const cleaned = stripAnsi(rawOutput);
  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const columns = rawLine.split("\t").map((col) => col.trim());
    if (columns.length >= 2 && /credits?/i.test(columns[0] ?? "")) {
      const numeric = Number.parseFloat((columns[1] ?? "").replace(/,/g, ""));
      if (Number.isFinite(numeric) && numeric >= 0) {
        return numeric;
      }
    }
    const fallbackMatch = /remaining\s+credits?\s*[:\t ]\s*([\d,]+(?:\.\d+)?)/i.exec(line);
    if (fallbackMatch?.[1]) {
      const numeric = Number.parseFloat(fallbackMatch[1].replace(/,/g, ""));
      if (Number.isFinite(numeric) && numeric >= 0) {
        return numeric;
      }
    }
  }
  return null;
}

export function getDefaultAgyExtraDirs(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = homedir()
): string[] {
  const dirs: string[] = [];
  if (platform === "win32") {
    const localAppData =
      env["LOCALAPPDATA"]?.trim() || join(homeDir, "AppData", "Local");
    const appData =
      env["APPDATA"]?.trim() || join(homeDir, "AppData", "Roaming");
    const userProfile = env["USERPROFILE"]?.trim() || homeDir;
    const pnpmHome = env["PNPM_HOME"]?.trim();
    if (pnpmHome) dirs.push(pnpmHome);
    dirs.push(
      join(localAppData, "agy", "bin"),
      join(userProfile, ".local", "bin"),
      join(appData, "npm"),
      join(localAppData, "pnpm"),
      join(localAppData, "Microsoft", "WinGet", "Links"),
      join(userProfile, "scoop", "shims")
    );
  } else {
    const pnpmHome = env["PNPM_HOME"]?.trim();
    if (pnpmHome) dirs.push(pnpmHome);
    dirs.push(
      join(homeDir, ".local", "bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin"
    );
  }
  return dirs;
}

export function locateOfficialAgyExecutable(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform
): string | null {
  return findExecutableOnPath(["agy"], {
    env,
    platform,
    extraDirs: getDefaultAgyExtraDirs(env, platform)
  });
}

async function defaultRunOfficialCli(
  executablePath: string,
  args: readonly string[],
  timeoutMs: number,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform
): Promise<OfficialCliExecResult> {
  const spec = buildSafeCliSpawnSpec(executablePath, args, { env, platform });
  try {
    const result = await execFileAsync(spec.file, spec.args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 256 * 1024,
      encoding: "buffer",
      env: spec.env,
      windowsVerbatimArguments: spec.windowsVerbatimArguments
    });
    return {
      stdout: decodeWindowsProcessOutput(result.stdout),
      stderr: decodeWindowsProcessOutput(result.stderr),
      exitCode: 0
    };
  } catch (err) {
    const execErr = err as Error & {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      code?: number | string | null;
      killed?: boolean;
      signal?: string | null;
    };
    const stdout =
      execErr.stdout !== undefined
        ? decodeWindowsProcessOutput(execErr.stdout)
        : "";
    const stderr =
      execErr.stderr !== undefined
        ? decodeWindowsProcessOutput(execErr.stderr)
        : "";
    const timedOut =
      Boolean(execErr.killed) ||
      execErr.code === "ETIMEDOUT" ||
      /timed?\s*out/i.test(execErr.message || stderr);
    const exitCode = typeof execErr.code === "number" ? execErr.code : null;
    return {
      stdout,
      stderr,
      exitCode,
      timedOut,
      errorMessage: execErr.message
    };
  }
}

function classifyFailureStatus(
  result: OfficialCliExecResult
): { status: OfficialQuotaProviderStatus; message: string } {
  const combined = stripAnsi(
    `${result.stdout}\n${result.stderr}\n${result.errorMessage ?? ""}`
  ).trim();
  const lower = combined.toLowerCase();

  if (result.timedOut || /timed?\s*out|deadline exceeded/i.test(lower)) {
    return {
      status: "timeout",
      message: "官方 agy CLI 额度查询超时，请稍后重试"
    };
  }

  if (
    /not logged in|please log in|sign in|unauthenticated|unauthorized|no active account|login required|authenticate|credentials? not found/i.test(
      lower
    )
  ) {
    return {
      status: "unauthenticated",
      message: "未检测到官方 agy CLI 登录态"
    };
  }

  if (result.exitCode !== 0 && combined.length === 0) {
    return {
      status: "unauthenticated",
      message: "未检测到官方 agy CLI 登录态"
    };
  }

  const firstLine = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return {
    status: "error",
    message: firstLine
      ? `官方 agy CLI 返回异常：${firstLine.slice(0, 120)}`
      : "暂时无法读取官方 agy CLI 额度"
  };
}

/**
 * 100% compliant real-time quota reader powered exclusively by the user's
 * locally installed official CLI (`agy -p "/usage"` and optional `agy -p "/credits"`).
 *
 * Strictly zero OAuth token file reads, zero keyring reads, and zero private
 * `cloudcode-pa` / `v1internal` HTTP requests.
 */
export class OfficialQuotaService {
  private readonly cacheTtlMs: number;
  private readonly negativeCacheTtlMs: number;
  private readonly usageTimeoutMs: number;
  private readonly creditsTimeoutMs: number;
  private readonly includeCredits: boolean;
  private readonly now: () => number;
  private readonly platform: NodeJS.Platform;
  private readonly env: Record<string, string | undefined>;
  private readonly refreshEnv: () => Promise<WindowsEnvRefreshResult | void> | void;
  private readonly locateExecutable: (
    env: Record<string, string | undefined>,
    platform: NodeJS.Platform
  ) => string | null;
  private readonly cliRunner: (
    executablePath: string,
    args: readonly string[],
    timeoutMs: number,
    env: Record<string, string | undefined>,
    platform: NodeJS.Platform
  ) => Promise<OfficialCliExecResult>;

  private cachedSnapshot: OfficialQuotaProviderSnapshot | null = null;
  private cacheExpiresAt = 0;
  private inflightNormal: Promise<OfficialQuotaProviderSnapshot> | null = null;
  private inflightForce: Promise<OfficialQuotaProviderSnapshot> | null = null;

  constructor(options: OfficialQuotaServiceOptions = {}) {
    this.cacheTtlMs = Math.max(
      1_000,
      options.cacheTtlMs ?? OFFICIAL_QUOTA_CACHE_TTL_MS
    );
    this.negativeCacheTtlMs = Math.max(
      1_000,
      options.negativeCacheTtlMs ?? NEGATIVE_CACHE_TTL_MS
    );
    this.usageTimeoutMs = Math.max(
      1_000,
      options.usageTimeoutMs ?? DEFAULT_USAGE_EXEC_TIMEOUT_MS
    );
    this.creditsTimeoutMs = Math.max(
      1_000,
      options.creditsTimeoutMs ?? DEFAULT_CREDITS_EXEC_TIMEOUT_MS
    );
    this.includeCredits = options.includeCredits ?? true;
    this.now = options.now ?? (() => Date.now());
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
    this.refreshEnv =
      options.refreshEnv ??
      (() =>
        refreshWindowsEnvironmentFromRegistry({
          targetEnv: this.env,
          platform: this.platform
        }));
    this.locateExecutable =
      options.locateExecutable ?? locateOfficialAgyExecutable;
    this.cliRunner = options.cliRunner ?? defaultRunOfficialCli;
  }

  clearCache(): void {
    this.cachedSnapshot = null;
    this.cacheExpiresAt = 0;
  }

  async getQuotaSummary(force = false): Promise<OfficialQuotaSummaryResponse> {
    const currentNow = this.now();
    if (!force && this.cachedSnapshot !== null && currentNow < this.cacheExpiresAt) {
      return this.wrapResponse(this.cachedSnapshot, true);
    }

    if (force) {
      if (this.inflightForce !== null) {
        const snapshot = await this.inflightForce;
        return this.wrapResponse(snapshot, false);
      }
      const run = this.fetchFreshSnapshot().finally(() => {
        if (this.inflightForce === run) {
          this.inflightForce = null;
        }
      });
      this.inflightForce = run;
      const snapshot = await run;
      return this.wrapResponse(snapshot, false);
    }

    if (this.inflightForce !== null) {
      const snapshot = await this.inflightForce;
      return this.wrapResponse(snapshot, false);
    }
    if (this.inflightNormal !== null) {
      const snapshot = await this.inflightNormal;
      return this.wrapResponse(snapshot, false);
    }

    const run = this.fetchFreshSnapshot().finally(() => {
      if (this.inflightNormal === run) {
        this.inflightNormal = null;
      }
    });
    this.inflightNormal = run;
    const snapshot = await run;
    return this.wrapResponse(snapshot, false);
  }

  private wrapResponse(
    snapshot: OfficialQuotaProviderSnapshot,
    cached: boolean
  ): OfficialQuotaSummaryResponse {
    return {
      ok: true,
      cached,
      cacheTtlMs: this.cacheTtlMs,
      fetchedAt: snapshot.fetchedAt,
      fetchedAtIso: snapshot.fetchedAtIso,
      providers: [snapshot],
      antigravity: snapshot
    };
  }

  private storeCache(snapshot: OfficialQuotaProviderSnapshot): void {
    this.cachedSnapshot = snapshot;
    const ttl = snapshot.available ? this.cacheTtlMs : this.negativeCacheTtlMs;
    this.cacheExpiresAt = this.now() + ttl;
  }

  private async fetchFreshSnapshot(): Promise<OfficialQuotaProviderSnapshot> {
    try {
      await this.refreshEnv();
    } catch {
      // Registry refresh failure is strictly non-fatal.
    }

    const executablePath = this.locateExecutable(this.env, this.platform);
    if (!executablePath) {
      const ts = this.now();
      const notFound: OfficialQuotaProviderSnapshot = {
        id: "antigravity",
        providerId: "antigravity",
        displayName: "Antigravity",
        source: "official-cli",
        command: 'agy -p "/usage"',
        status: "not_installed",
        available: false,
        executablePath: null,
        windows: [],
        remainingCredits: null,
        fetchedAt: ts,
        fetchedAtIso: new Date(ts).toISOString(),
        error: "未检测到官方 agy CLI 登录态"
      };
      this.storeCache(notFound);
      return notFound;
    }

    const usagePrintTimeoutSec = Math.max(
      1,
      Math.min(
        DEFAULT_USAGE_PRINT_TIMEOUT_SEC,
        Math.ceil(this.usageTimeoutMs / 1000)
      )
    );
    const creditsPrintTimeoutSec = Math.max(
      1,
      Math.min(
        DEFAULT_CREDITS_PRINT_TIMEOUT_SEC,
        Math.ceil(this.creditsTimeoutMs / 1000)
      )
    );

    const usagePromise = this.cliRunner(
      executablePath,
      ["-p", "/usage", "--print-timeout", `${usagePrintTimeoutSec}s`],
      this.usageTimeoutMs,
      this.env,
      this.platform
    );

    const creditsPromise = this.includeCredits
      ? this.cliRunner(
          executablePath,
          ["-p", "/credits", "--print-timeout", `${creditsPrintTimeoutSec}s`],
          this.creditsTimeoutMs,
          this.env,
          this.platform
        ).catch(() => null)
      : Promise.resolve(null);

    const [usageResult, creditsResult] = await Promise.all([
      usagePromise.catch(
        (err): OfficialCliExecResult => ({
          stdout: "",
          stderr: "",
          exitCode: null,
          errorMessage: err instanceof Error ? err.message : String(err)
        })
      ),
      creditsPromise
    ]);

    const ts = this.now();
    const windows = parseAgyUsageTsv(usageResult.stdout);
    const remainingCredits =
      creditsResult && creditsResult.exitCode === 0
        ? parseAgyCreditsTsv(creditsResult.stdout)
        : null;

    if (windows.length > 0) {
      const okSnapshot: OfficialQuotaProviderSnapshot = {
        id: "antigravity",
        providerId: "antigravity",
        displayName: "Antigravity",
        source: "official-cli",
        command: 'agy -p "/usage"',
        status: "ok",
        available: true,
        executablePath,
        windows,
        remainingCredits,
        fetchedAt: ts,
        fetchedAtIso: new Date(ts).toISOString(),
        error: null
      };
      this.storeCache(okSnapshot);
      return okSnapshot;
    }

    const failure = classifyFailureStatus(usageResult);
    const failedSnapshot: OfficialQuotaProviderSnapshot = {
      id: "antigravity",
      providerId: "antigravity",
      displayName: "Antigravity",
      source: "official-cli",
      command: 'agy -p "/usage"',
      status: failure.status,
      available: false,
      executablePath,
      windows: [],
      remainingCredits,
      fetchedAt: ts,
      fetchedAtIso: new Date(ts).toISOString(),
      error: failure.message
    };
    this.storeCache(failedSnapshot);
    return failedSnapshot;
  }
}
