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
import type { PrismuxProviderProbeService } from "./PrismuxProviderProbeService.js";

const execFileAsync = promisify(execFile);

/** Base cache TTL: 15 minutes (900,000 ms). */
export const OFFICIAL_QUOTA_CACHE_TTL_MS = 15 * 60 * 1_000;
/** Random cache TTL jitter half-window: ±90 seconds (90,000 ms) => [810_000, 990_000] ms. */
export const OFFICIAL_QUOTA_CACHE_JITTER_MS = 90 * 1_000;
export const OFFICIAL_QUOTA_CACHE_TTL_MIN_MS =
  OFFICIAL_QUOTA_CACHE_TTL_MS - OFFICIAL_QUOTA_CACHE_JITTER_MS;
export const OFFICIAL_QUOTA_CACHE_TTL_MAX_MS =
  OFFICIAL_QUOTA_CACHE_TTL_MS + OFFICIAL_QUOTA_CACHE_JITTER_MS;

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

export interface OfficialQuotaCreditsSnapshot {
  id: "antigravity";
  providerId: "antigravity";
  displayName: "Antigravity";
  source: "official-cli";
  command: 'agy -p "/credits"';
  status: OfficialQuotaProviderStatus;
  available: boolean;
  executablePath: string | null;
  remainingCredits: number | null;
  fetchedAt: number;
  fetchedAtIso: string;
  error: string | null;
}

export interface OfficialQuotaCreditsResponse {
  ok: true;
  cached: boolean;
  cacheTtlMs: number;
  fetchedAt: number;
  fetchedAtIso: string;
  remainingCredits: number | null;
  status: OfficialQuotaProviderStatus;
  available: boolean;
  error: string | null;
  antigravity: OfficialQuotaCreditsSnapshot;
}

export interface OfficialCliExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut?: boolean;
  errorMessage?: string;
}

export interface OfficialQuotaServiceOptions {
  /** Base cache TTL for successful quota/credits snapshots (default 15 minutes). */
  cacheTtlMs?: number;
  /** Random jitter half-window applied to TTL (default ±90s => [810_000, 990_000] ms). */
  cacheJitterMs?: number;
  /** Injectable PRNG returning [0, 1] for deterministic jitter unit testing. */
  random?: () => number;
  /** Short TTL retained for option compatibility (failures invalidate cache immediately). */
  negativeCacheTtlMs?: number;
  /** Subprocess timeout for `agy -p "/usage"` (default 18s; CLI `--print-timeout` is 15s). */
  usageTimeoutMs?: number;
  /** Subprocess timeout for `agy -p "/credits"` (default 12s; CLI `--print-timeout` is 10s). */
  creditsTimeoutMs?: number;
  /** Optional predicate indicating whether Antigravity is currently enabled (default true). */
  isAntigravityEnabled?: () => boolean;
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
  /** Optional unified provider probe service used as single source of truth for AGY binary location. */
  providerProbeService?: PrismuxProviderProbeService;
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

/**
 * Computes a jittered cache TTL in `[baseTtlMs - jitterMs, baseTtlMs + jitterMs]`.
 * With defaults (15m ± 90s), always returns an integer in `[810_000, 990_000]` ms.
 */
export function computeJitteredQuotaCacheTtlMs(
  baseTtlMs: number = OFFICIAL_QUOTA_CACHE_TTL_MS,
  jitterMs: number = OFFICIAL_QUOTA_CACHE_JITTER_MS,
  random: () => number = Math.random
): number {
  const safeBase = Math.max(1_000, Math.round(baseTtlMs));
  const safeJitter = Math.max(0, Math.round(jitterMs));
  if (safeJitter === 0) {
    return safeBase;
  }
  const rawRandom = random();
  const clamped = Number.isFinite(rawRandom)
    ? Math.max(0, Math.min(1, rawRandom))
    : 0.5;
  const offset = Math.round((clamped * 2 - 1) * safeJitter);
  return Math.max(1_000, safeBase + offset);
}

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
    /not logged in|logged out|please log in|please sign in|sign in|unauthenticated|unauthorized|no active account|login required|need to log in|re-?authenticate|authenticate|session expired|token expired|invalid_grant|credentials? not found/i.test(
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
 * 100% compliant lazy Antigravity quota reader powered exclusively by the user's
 * locally installed official CLI:
 * - `getSummary()` / `getQuotaSummary()` runs ONLY a single `agy -p "/usage"` command (NEVER `/credits`).
 * - `getCredits()` runs ONLY a single `agy -p "/credits"` command on demand (popover open).
 * - Both caches use 15m ± 90s random jitter TTL (`[810_000, 990_000]` ms) + singleflight deduplication.
 * - Strictly zero OAuth token file reads, zero keyring reads, and zero private
 *   `cloudcode-pa` / `v1internal` HTTP requests.
 */
export class OfficialQuotaService {
  private readonly cacheTtlMs: number;
  private readonly cacheJitterMs: number;
  private readonly random: () => number;
  private readonly negativeCacheTtlMs: number;
  private readonly usageTimeoutMs: number;
  private readonly creditsTimeoutMs: number;
  private readonly isAntigravityEnabled: () => boolean;
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

  private cacheGeneration = 0;
  private usageGeneration = 0;
  private creditsGeneration = 0;

  private cachedSnapshot: OfficialQuotaProviderSnapshot | null = null;
  private cacheExpiresAt = 0;
  private lastUsageCacheTtlMs: number;
  private inflightNormal: Promise<OfficialQuotaProviderSnapshot> | null = null;
  private inflightForce: Promise<OfficialQuotaProviderSnapshot> | null = null;

  private cachedCreditsSnapshot: OfficialQuotaCreditsSnapshot | null = null;
  private creditsCacheExpiresAt = 0;
  private lastCreditsCacheTtlMs: number;
  private inflightCreditsNormal: Promise<OfficialQuotaCreditsSnapshot> | null = null;
  private inflightCreditsForce: Promise<OfficialQuotaCreditsSnapshot> | null = null;

  constructor(options: OfficialQuotaServiceOptions = {}) {
    this.cacheTtlMs = Math.max(
      1_000,
      options.cacheTtlMs ?? OFFICIAL_QUOTA_CACHE_TTL_MS
    );
    this.cacheJitterMs =
      options.cacheJitterMs !== undefined
        ? Math.max(0, options.cacheJitterMs)
        : options.cacheTtlMs === undefined
          ? OFFICIAL_QUOTA_CACHE_JITTER_MS
          : Math.min(OFFICIAL_QUOTA_CACHE_JITTER_MS, Math.floor(this.cacheTtlMs * 0.1));
    this.random = options.random ?? Math.random;
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
    this.isAntigravityEnabled = options.isAntigravityEnabled ?? (() => true);
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
      options.locateExecutable ??
      (options.providerProbeService
        ? (env, platform) =>
            options.providerProbeService!.locateProviderExecutable(
              "antigravity",
              env,
              platform
            )
        : locateOfficialAgyExecutable);
    this.cliRunner = options.cliRunner ?? defaultRunOfficialCli;
    this.lastUsageCacheTtlMs = this.cacheTtlMs;
    this.lastCreditsCacheTtlMs = this.cacheTtlMs;
  }

  /** Monotonic invalidation generation counter (increments on every clearCache / logout / disable). */
  getCacheGeneration(): number {
    return this.cacheGeneration;
  }

  /**
   * Immediately clears BOTH `/usage` and `/credits` caches and increments the
   * monotonic `cacheGeneration` counter so in-flight pre-logout fetches can never
   * repopulate stale data.
   */
  clearCache(): void {
    this.cacheGeneration += 1;
    this.usageGeneration += 1;
    this.creditsGeneration += 1;
    this.cachedSnapshot = null;
    this.cacheExpiresAt = 0;
    this.cachedCreditsSnapshot = null;
    this.creditsCacheExpiresAt = 0;
  }

  /**
   * Alias invoked when Antigravity is disabled or reported logged out.
   */
  invalidateAuthCache(): void {
    this.clearCache();
  }

  /**
   * Convenience alias for `getQuotaSummary(force)` — runs ONLY `agy -p "/usage"`.
   */
  async getSummary(force = false): Promise<OfficialQuotaSummaryResponse> {
    return this.getQuotaSummary(force);
  }

  /**
   * Returns Antigravity quota windows from `agy -p "/usage"` ONLY.
   * NEVER spawns `/credits` concurrently during summary refresh.
   */
  async getQuotaSummary(force = false): Promise<OfficialQuotaSummaryResponse> {
    if (!this.isAntigravityEnabled()) {
      return this.buildDisabledSummaryResponse();
    }

    if (force) {
      if (this.inflightForce !== null) {
        const snapshot = await this.inflightForce;
        return this.wrapSummaryResponse(snapshot, false);
      }
      // Invalidate stale usage snapshot immediately on forced refresh so concurrent
      // non-forced callers never observe outdated percentages during logout/account switches.
      this.cachedSnapshot = null;
      this.cacheExpiresAt = 0;
      const cacheGen = this.cacheGeneration;
      const usageGen = ++this.usageGeneration;
      const run = this.fetchFreshUsageSnapshot(cacheGen, usageGen).finally(() => {
        if (this.inflightForce === run) {
          this.inflightForce = null;
        }
      });
      this.inflightForce = run;
      const snapshot = await run;
      return this.wrapSummaryResponse(snapshot, false);
    }

    if (this.inflightForce !== null) {
      const snapshot = await this.inflightForce;
      return this.wrapSummaryResponse(snapshot, false);
    }

    const currentNow = this.now();
    if (this.cachedSnapshot !== null && currentNow < this.cacheExpiresAt) {
      return this.wrapSummaryResponse(this.cachedSnapshot, true);
    }

    if (this.inflightNormal !== null) {
      const snapshot = await this.inflightNormal;
      return this.wrapSummaryResponse(snapshot, false);
    }

    const cacheGen = this.cacheGeneration;
    const usageGen = ++this.usageGeneration;
    const run = this.fetchFreshUsageSnapshot(cacheGen, usageGen).finally(() => {
      if (this.inflightNormal === run) {
        this.inflightNormal = null;
      }
    });
    this.inflightNormal = run;
    const snapshot = await run;
    return this.wrapSummaryResponse(snapshot, false);
  }

  /**
   * On-demand Antigravity credit balance reader powered by ONLY a single `agy -p "/credits"`
   * command, with its own 15m ± 90s jitter TTL and singleflight in-flight deduplication.
   */
  async getCredits(force = false): Promise<OfficialQuotaCreditsResponse> {
    if (!this.isAntigravityEnabled()) {
      return this.buildDisabledCreditsResponse();
    }

    if (force) {
      if (this.inflightCreditsForce !== null) {
        const snapshot = await this.inflightCreditsForce;
        return this.wrapCreditsResponse(snapshot, false);
      }
      this.cachedCreditsSnapshot = null;
      this.creditsCacheExpiresAt = 0;
      const cacheGen = this.cacheGeneration;
      const creditsGen = ++this.creditsGeneration;
      const run = this.fetchFreshCreditsSnapshot(cacheGen, creditsGen).finally(() => {
        if (this.inflightCreditsForce === run) {
          this.inflightCreditsForce = null;
        }
      });
      this.inflightCreditsForce = run;
      const snapshot = await run;
      return this.wrapCreditsResponse(snapshot, false);
    }

    if (this.inflightCreditsForce !== null) {
      const snapshot = await this.inflightCreditsForce;
      return this.wrapCreditsResponse(snapshot, false);
    }

    const currentNow = this.now();
    if (this.cachedCreditsSnapshot !== null && currentNow < this.creditsCacheExpiresAt) {
      return this.wrapCreditsResponse(this.cachedCreditsSnapshot, true);
    }

    if (this.inflightCreditsNormal !== null) {
      const snapshot = await this.inflightCreditsNormal;
      return this.wrapCreditsResponse(snapshot, false);
    }

    const cacheGen = this.cacheGeneration;
    const creditsGen = ++this.creditsGeneration;
    const run = this.fetchFreshCreditsSnapshot(cacheGen, creditsGen).finally(() => {
      if (this.inflightCreditsNormal === run) {
        this.inflightCreditsNormal = null;
      }
    });
    this.inflightCreditsNormal = run;
    const snapshot = await run;
    return this.wrapCreditsResponse(snapshot, false);
  }

  /** Alias for `getCredits(force)`. */
  async getQuotaCredits(force = false): Promise<OfficialQuotaCreditsResponse> {
    return this.getCredits(force);
  }

  /**
   * Immediately clears both caches and returns an unauthenticated summary response
   * without spawning `agy` CLI (used when Antigravity is disabled).
   */
  buildDisabledSummaryResponse(): OfficialQuotaSummaryResponse {
    this.clearCache();
    const ts = this.now();
    const snapshot: OfficialQuotaProviderSnapshot = {
      id: "antigravity",
      providerId: "antigravity",
      displayName: "Antigravity",
      source: "official-cli",
      command: 'agy -p "/usage"',
      status: "unauthenticated",
      available: false,
      executablePath: null,
      windows: [],
      remainingCredits: null,
      fetchedAt: ts,
      fetchedAtIso: new Date(ts).toISOString(),
      error: "Antigravity 已禁用或未登录"
    };
    return this.wrapSummaryResponse(snapshot, false);
  }

  /**
   * Immediately clears both caches and returns an unauthenticated credits response
   * without spawning `agy` CLI (used when Antigravity is disabled).
   */
  buildDisabledCreditsResponse(): OfficialQuotaCreditsResponse {
    this.clearCache();
    const ts = this.now();
    const snapshot: OfficialQuotaCreditsSnapshot = {
      id: "antigravity",
      providerId: "antigravity",
      displayName: "Antigravity",
      source: "official-cli",
      command: 'agy -p "/credits"',
      status: "unauthenticated",
      available: false,
      executablePath: null,
      remainingCredits: null,
      fetchedAt: ts,
      fetchedAtIso: new Date(ts).toISOString(),
      error: "Antigravity 已禁用或未登录"
    };
    return this.wrapCreditsResponse(snapshot, false);
  }

  private nextJitteredTtlMs(): number {
    return computeJitteredQuotaCacheTtlMs(
      this.cacheTtlMs,
      this.cacheJitterMs,
      this.random
    );
  }

  private wrapSummaryResponse(
    snapshot: OfficialQuotaProviderSnapshot,
    cached: boolean
  ): OfficialQuotaSummaryResponse {
    return {
      ok: true,
      cached,
      cacheTtlMs: this.lastUsageCacheTtlMs,
      fetchedAt: snapshot.fetchedAt,
      fetchedAtIso: snapshot.fetchedAtIso,
      providers: [snapshot],
      antigravity: snapshot
    };
  }

  private wrapCreditsResponse(
    snapshot: OfficialQuotaCreditsSnapshot,
    cached: boolean
  ): OfficialQuotaCreditsResponse {
    return {
      ok: true,
      cached,
      cacheTtlMs: this.lastCreditsCacheTtlMs,
      fetchedAt: snapshot.fetchedAt,
      fetchedAtIso: snapshot.fetchedAtIso,
      remainingCredits: snapshot.remainingCredits,
      status: snapshot.status,
      available: snapshot.available,
      error: snapshot.error,
      antigravity: snapshot
    };
  }

  private storeUsageCache(
    snapshot: OfficialQuotaProviderSnapshot,
    cacheGen: number,
    usageGen: number
  ): void {
    if (cacheGen !== this.cacheGeneration || usageGen !== this.usageGeneration) {
      return;
    }
    const ttl = snapshot.available ? this.nextJitteredTtlMs() : this.negativeCacheTtlMs;
    this.lastUsageCacheTtlMs = ttl;
    this.cachedSnapshot = snapshot;
    this.cacheExpiresAt = this.now() + ttl;
  }

  private storeCreditsCache(
    snapshot: OfficialQuotaCreditsSnapshot,
    cacheGen: number,
    creditsGen: number
  ): void {
    if (cacheGen !== this.cacheGeneration || creditsGen !== this.creditsGeneration) {
      return;
    }
    const ttl = snapshot.available ? this.nextJitteredTtlMs() : this.negativeCacheTtlMs;
    this.lastCreditsCacheTtlMs = ttl;
    this.cachedCreditsSnapshot = snapshot;
    this.creditsCacheExpiresAt = this.now() + ttl;
  }

  private invalidateAllCachesForFailure(cacheGen: number): void {
    if (cacheGen === this.cacheGeneration) {
      this.clearCache();
    }
  }

  private async fetchFreshUsageSnapshot(
    cacheGen: number,
    usageGen: number
  ): Promise<OfficialQuotaProviderSnapshot> {
    try {
      await this.refreshEnv();
    } catch {
      // Registry refresh failure is strictly non-fatal.
    }

    const executablePath = this.locateExecutable(this.env, this.platform);
    if (!executablePath) {
      this.invalidateAllCachesForFailure(cacheGen);
      const ts = this.now();
      return {
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
    }

    const usagePrintTimeoutSec = Math.max(
      1,
      Math.min(
        DEFAULT_USAGE_PRINT_TIMEOUT_SEC,
        Math.ceil(this.usageTimeoutMs / 1000)
      )
    );

    let usageResult: OfficialCliExecResult;
    try {
      usageResult = await this.cliRunner(
        executablePath,
        ["-p", "/usage", "--print-timeout", `${usagePrintTimeoutSec}s`],
        this.usageTimeoutMs,
        this.env,
        this.platform
      );
    } catch (err) {
      usageResult = {
        stdout: "",
        stderr: "",
        exitCode: null,
        errorMessage: err instanceof Error ? err.message : String(err)
      };
    }

    const ts = this.now();
    const windows = parseAgyUsageTsv(usageResult.stdout);

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
        remainingCredits: null,
        fetchedAt: ts,
        fetchedAtIso: new Date(ts).toISOString(),
        error: null
      };
      this.storeUsageCache(okSnapshot, cacheGen, usageGen);
      return okSnapshot;
    }

    const failure = classifyFailureStatus(usageResult);
    // Immediately invalidate BOTH `/usage` and `/credits` caches so logout /
    // uninstall / CLI error can never leave stale percentages or credits in memory.
    this.invalidateAllCachesForFailure(cacheGen);
    return {
      id: "antigravity",
      providerId: "antigravity",
      displayName: "Antigravity",
      source: "official-cli",
      command: 'agy -p "/usage"',
      status: failure.status,
      available: false,
      executablePath,
      windows: [],
      remainingCredits: null,
      fetchedAt: ts,
      fetchedAtIso: new Date(ts).toISOString(),
      error: failure.message
    };
  }

  private async fetchFreshCreditsSnapshot(
    cacheGen: number,
    creditsGen: number
  ): Promise<OfficialQuotaCreditsSnapshot> {
    try {
      await this.refreshEnv();
    } catch {
      // Registry refresh failure is strictly non-fatal.
    }

    const executablePath = this.locateExecutable(this.env, this.platform);
    if (!executablePath) {
      this.invalidateAllCachesForFailure(cacheGen);
      const ts = this.now();
      return {
        id: "antigravity",
        providerId: "antigravity",
        displayName: "Antigravity",
        source: "official-cli",
        command: 'agy -p "/credits"',
        status: "not_installed",
        available: false,
        executablePath: null,
        remainingCredits: null,
        fetchedAt: ts,
        fetchedAtIso: new Date(ts).toISOString(),
        error: "未检测到官方 agy CLI 登录态"
      };
    }

    const creditsPrintTimeoutSec = Math.max(
      1,
      Math.min(
        DEFAULT_CREDITS_PRINT_TIMEOUT_SEC,
        Math.ceil(this.creditsTimeoutMs / 1000)
      )
    );

    let creditsResult: OfficialCliExecResult;
    try {
      creditsResult = await this.cliRunner(
        executablePath,
        ["-p", "/credits", "--print-timeout", `${creditsPrintTimeoutSec}s`],
        this.creditsTimeoutMs,
        this.env,
        this.platform
      );
    } catch (err) {
      creditsResult = {
        stdout: "",
        stderr: "",
        exitCode: null,
        errorMessage: err instanceof Error ? err.message : String(err)
      };
    }

    const ts = this.now();
    const remainingCredits =
      creditsResult.exitCode === 0 ? parseAgyCreditsTsv(creditsResult.stdout) : null;

    if (remainingCredits !== null) {
      const okSnapshot: OfficialQuotaCreditsSnapshot = {
        id: "antigravity",
        providerId: "antigravity",
        displayName: "Antigravity",
        source: "official-cli",
        command: 'agy -p "/credits"',
        status: "ok",
        available: true,
        executablePath,
        remainingCredits,
        fetchedAt: ts,
        fetchedAtIso: new Date(ts).toISOString(),
        error: null
      };
      this.storeCreditsCache(okSnapshot, cacheGen, creditsGen);
      return okSnapshot;
    }

    const failure = classifyFailureStatus(creditsResult);
    if (failure.status === "unauthenticated" || failure.status === "not_installed") {
      // Logout / unauthenticated immediately wipes BOTH `/usage` and `/credits` caches.
      this.invalidateAllCachesForFailure(cacheGen);
    } else if (cacheGen === this.cacheGeneration && creditsGen === this.creditsGeneration) {
      this.cachedCreditsSnapshot = null;
      this.creditsCacheExpiresAt = 0;
    }
    return {
      id: "antigravity",
      providerId: "antigravity",
      displayName: "Antigravity",
      source: "official-cli",
      command: 'agy -p "/credits"',
      status: failure.status,
      available: false,
      executablePath,
      remainingCredits: null,
      fetchedAt: ts,
      fetchedAtIso: new Date(ts).toISOString(),
      error: failure.message
    };
  }
}
