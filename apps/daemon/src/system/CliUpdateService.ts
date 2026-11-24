import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { UPDATE_ENDPOINTS } from "@prismux/protocol";
import type { AppUpdater } from "../updater/AppUpdater.js";
import {
  defaultCliProbe,
  type CliProbeResult
} from "./ServiceDiagnosticsService.js";
import {
  buildSafeCliSpawnSpec,
  findExecutableOnPath,
  refreshWindowsEnvironmentFromRegistry,
  type WindowsEnvRefreshResult
} from "./WindowsEnvRefresh.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_CLI_UPDATE_CACHE_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_CLI_CHECK_TIMEOUT_MS = 6_000;
export const DEFAULT_CLI_PROBE_TIMEOUT_MS = 3_000;
export const DEFAULT_CLI_INSTALL_TIMEOUT_MS = 180_000;

export type ManagedCliProviderId =
  | "codex"
  | "claude"
  | "gemini"
  | "opencode"
  | "omp"
  | "antigravity";

export type CliInstallMethod = "npm-global" | "native-self-update" | "unsupported";

export interface CliUpdateCheckItem {
  provider: string;
  canonicalProvider: ManagedCliProviderId | null;
  command: string | null;
  packageName: string | null;
  installed: boolean;
  installedPath: string | null;
  currentVersion: string | null;
  rawVersion: string | null;
  latestVersion: string | null;
  hasUpdate: boolean;
  updateSupported: boolean;
  installMethod: CliInstallMethod;
  registryUsed: string | null;
  checkedAt: number;
  cached: boolean;
  error?: string;
}

export interface CliUpdatesCheckResponse {
  ok: true;
  checkedAt: number;
  cached: boolean;
  items: CliUpdateCheckItem[];
  item?: CliUpdateCheckItem;
}

export interface CliUpdateInstallResult {
  ok: true;
  provider: ManagedCliProviderId;
  packageName: string | null;
  method: Exclude<CliInstallMethod, "unsupported">;
  previousVersion: string | null;
  newVersion: string | null;
  latestVersion: string | null;
  registryUsed: string | null;
  durationMs: number;
  item: CliUpdateCheckItem;
  message: string;
}

export class CliUpdateError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "CliUpdateError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<number | string>;
  normalized: string;
}

export interface CliCommandExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface CliUpdateServiceOptions {
  appUpdater?: Pick<AppUpdater, "getPolicy">;
  cacheTtlMs?: number;
  registryTimeoutMs?: number;
  probeTimeoutMs?: number;
  installTimeoutMs?: number;
  npmRegistryUrl?: string;
  npmMirrorRegistryUrl?: string;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** Called after a successful CLI update (e.g. clear ServiceDiagnosticsService cache). */
  onAfterUpdate?: () => void;
  /** Injectable CLI version probe for deterministic tests. */
  cliProbe?: (
    command: string,
    args: string[],
    timeoutMs: number
  ) => Promise<CliProbeResult>;
  /** Injectable npm registry latest-version fetcher for deterministic tests. */
  fetchLatestNpmVersion?: (
    packageName: string,
    registryUrl: string,
    timeoutMs: number
  ) => Promise<string>;
  /** Injectable command executor for update installation tests. */
  execCommand?: (
    executablePath: string,
    args: readonly string[],
    timeoutMs: number
  ) => Promise<CliCommandExecResult>;
  /** Injectable executable finder for locating `npm` / CLIs. */
  findExecutable?: (commandNames: readonly string[]) => string | null;
  /** Injectable file reader for shim inspection. */
  readTextFile?: (filePath: string) => string | null;
  /** Injectable path existence check for omp package detection. */
  pathExists?: (filePath: string) => boolean;
  /** Injectable Windows environment refresher. */
  refreshEnv?: () => Promise<WindowsEnvRefreshResult | void> | void;
}

interface ManagedCliSpec {
  readonly id: ManagedCliProviderId;
  readonly command: string;
  readonly versionArgs: readonly string[];
  readonly defaultNpmPackage: string | null;
  readonly updateSupported: boolean;
}

export const MANAGED_CLI_SPECS: Readonly<Record<ManagedCliProviderId, ManagedCliSpec>> = {
  codex: {
    id: "codex",
    command: "codex",
    versionArgs: ["--version"],
    defaultNpmPackage: "@openai/codex",
    updateSupported: true
  },
  claude: {
    id: "claude",
    command: "claude",
    versionArgs: ["--version"],
    defaultNpmPackage: "@anthropic-ai/claude-code",
    updateSupported: true
  },
  gemini: {
    id: "gemini",
    command: "gemini",
    versionArgs: ["--version"],
    defaultNpmPackage: "@google/gemini-cli",
    updateSupported: true
  },
  opencode: {
    id: "opencode",
    command: "opencode",
    versionArgs: ["--version"],
    defaultNpmPackage: "opencode-ai",
    updateSupported: true
  },
  omp: {
    id: "omp",
    command: "omp",
    versionArgs: ["--version"],
    defaultNpmPackage: "@oh-my-pi/pi-coding-agent",
    updateSupported: true
  },
  antigravity: {
    id: "antigravity",
    command: "agy",
    versionArgs: ["--version"],
    defaultNpmPackage: null,
    updateSupported: false
  }
};

export const ALL_MANAGED_CLI_PROVIDERS: readonly ManagedCliProviderId[] = [
  "codex",
  "claude",
  "gemini",
  "opencode",
  "omp",
  "antigravity"
];

const PROVIDER_ALIASES: Readonly<Record<string, ManagedCliProviderId>> = {
  codex: "codex",
  "openai-codex": "codex",
  openai_codex: "codex",
  "codex-cli": "codex",
  claude: "claude",
  claudeagent: "claude",
  "claude-agent": "claude",
  claude_agent: "claude",
  "claude-code": "claude",
  claude_code: "claude",
  claudecode: "claude",
  gemini: "gemini",
  "gemini-cli": "gemini",
  gemini_cli: "gemini",
  geminicli: "gemini",
  opencode: "opencode",
  "open-code": "opencode",
  open_code: "opencode",
  omp: "omp",
  "oh-my-pi": "omp",
  oh_my_pi: "omp",
  ohmypi: "omp",
  pi: "omp",
  "pi-coding-agent": "omp",
  antigravity: "antigravity",
  agy: "antigravity",
  "antigravity-cli": "antigravity",
  antigravity_cli: "antigravity"
};

/**
 * Normalizes any provider driver kind, alias, or UUID-suffixed instance ID
 * (e.g. `codex_048c43c3-...`, `claudeAgent`, `agy`, `oh-my-pi`) to a canonical
 * managed CLI provider ID.
 */
export function normalizeCliProviderId(
  raw: string | null | undefined
): ManagedCliProviderId | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  const key = raw.trim().toLowerCase();
  if (!key) {
    return null;
  }
  const exact = PROVIDER_ALIASES[key];
  if (exact) {
    return exact;
  }
  const compact = key.replace(/[^a-z0-9]+/g, "");
  const compactHit = PROVIDER_ALIASES[compact];
  if (compactHit) {
    return compactHit;
  }
  if (key.startsWith("codex") || key.includes("openai-codex") || key.includes("openai_codex")) {
    return "codex";
  }
  if (key.startsWith("claude")) {
    return "claude";
  }
  if (key.startsWith("gemini")) {
    return "gemini";
  }
  if (key.startsWith("opencode") || key.startsWith("open-code")) {
    return "opencode";
  }
  if (
    key === "omp" ||
    key.startsWith("omp-") ||
    key.startsWith("omp_") ||
    key.includes("oh-my-pi") ||
    key.includes("oh_my_pi") ||
    key === "pi" ||
    key.startsWith("pi-") ||
    key.startsWith("pi_")
  ) {
    return "omp";
  }
  if (
    key.startsWith("antigravity") ||
    key === "agy" ||
    key.startsWith("agy-") ||
    key.startsWith("agy_")
  ) {
    return "antigravity";
  }
  return null;
}

const SEMVER_EXTRACT_RE =
  /(?:^|[^0-9A-Za-z])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?=$|[^0-9A-Za-z.-])/;
const STRICT_SEMVER_RE =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const NUMERIC_IDENT_RE = /^\d+$/;

/**
 * Extracts the primary SemVer string from CLI `--version` output such as:
 * - `"0.171.0"` -> `"0.171.0"`
 * - `"v0.172.0"` -> `"0.172.0"`
 * - `"codex-cli 0.171.0"` -> `"0.171.0"`
 * - `"2.1.331 (Claude Code)"` -> `"2.1.331"`
 * - `"v1.2.3-beta.4+build.1"` -> `"1.2.3-beta.4"`
 */
export function extractSemverFromOutput(
  raw: string | null | undefined
): string | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const match = SEMVER_EXTRACT_RE.exec(trimmed);
  if (!match?.[1]) {
    return null;
  }
  const parsed = parseSemver(match[1]);
  return parsed ? parsed.normalized : null;
}

export function parseSemver(raw: string | null | undefined): ParsedSemver | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const match = STRICT_SEMVER_RE.exec(trimmed);
  if (!match) {
    return null;
  }
  const major = Number.parseInt(match[1]!, 10);
  const minor = Number.parseInt(match[2]!, 10);
  const patch = Number.parseInt(match[3]!, 10);
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    return null;
  }
  const rawPrerelease = match[4];
  const prerelease: Array<number | string> = [];
  if (rawPrerelease !== undefined) {
    const parts = rawPrerelease.split(".");
    for (const part of parts) {
      if (part.length === 0) {
        return null;
      }
      if (NUMERIC_IDENT_RE.test(part)) {
        prerelease.push(Number.parseInt(part, 10));
      } else {
        prerelease.push(part);
      }
    }
  }
  const normalized =
    prerelease.length > 0
      ? `${major}.${minor}.${patch}-${prerelease.join(".")}`
      : `${major}.${minor}.${patch}`;
  return { major, minor, patch, prerelease, normalized };
}

/**
 * Strict SemVer 2.0.0 comparator:
 * Returns `1` when `a > b`, `-1` when `a < b`, `0` when equal, or `null` if either is unparseable.
 */
export function compareSemver(
  a: string | null | undefined,
  b: string | null | undefined
): -1 | 0 | 1 | null {
  const left = parseSemver(a) ?? parseSemver(extractSemverFromOutput(a));
  const right = parseSemver(b) ?? parseSemver(extractSemverFromOutput(b));
  if (!left || !right) {
    return null;
  }

  if (left.major !== right.major) return left.major > right.major ? 1 : -1;
  if (left.minor !== right.minor) return left.minor > right.minor ? 1 : -1;
  if (left.patch !== right.patch) return left.patch > right.patch ? 1 : -1;

  const leftPre = left.prerelease;
  const rightPre = right.prerelease;
  if (leftPre.length === 0 && rightPre.length === 0) return 0;
  // Release version has higher precedence than pre-release version.
  if (leftPre.length === 0) return 1;
  if (rightPre.length === 0) return -1;

  const len = Math.max(leftPre.length, rightPre.length);
  for (let i = 0; i < len; i += 1) {
    const l = leftPre[i];
    const r = rightPre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const lNum = typeof l === "number";
    const rNum = typeof r === "number";
    if (lNum && rNum) {
      return l > r ? 1 : -1;
    }
    // Numeric identifiers always have lower precedence than non-numeric identifiers.
    if (lNum && !rNum) return -1;
    if (!lNum && rNum) return 1;
    return String(l) > String(r) ? 1 : -1;
  }
  return 0;
}

/**
 * Returns `true` strictly when `latest` and `current` are valid SemVer versions
 * and `latest > current`.
 */
export function isNewerVersion(
  latest: string | null | undefined,
  current: string | null | undefined
): boolean {
  return compareSemver(latest, current) === 1;
}

/**
 * Determines how Claude Code CLI was installed on the host machine so updates
 * use the exact matching mechanism without corrupting the user's installation:
 * - Native binary (e.g. `~/.local/bin/claude.exe`, `~/.local/bin/claude`) -> `claude update`
 * - Global npm/pnpm/node package (e.g. `%APPDATA%\npm\claude.cmd`, `.../pnpm/...`, `.../node_modules/...`) -> `npm install -g @anthropic-ai/claude-code@latest`
 */
export function detectClaudeInstallMethod(
  installedPath: string | null | undefined,
  options: {
    platform?: NodeJS.Platform;
    readTextFile?: (filePath: string) => string | null;
  } = {}
): Exclude<CliInstallMethod, "unsupported"> {
  if (!installedPath || installedPath.trim().length === 0) {
    return "npm-global";
  }
  const platform = options.platform ?? process.platform;
  const normalized = installedPath.trim().replace(/\\/g, "/").toLowerCase();

  // Explicit native install locations (e.g. ~/.local/bin/claude.exe or ~/.local/bin/claude)
  if (
    normalized.includes("/.local/bin/") ||
    normalized.includes("/.claude/local/") ||
    normalized.includes("/appdata/local/programs/claude")
  ) {
    return "native-self-update";
  }

  // Explicit npm / pnpm / yarn / node package manager locations
  if (
    /(?:^|\/)(?:npm|pnpm|yarn|node_modules|nvm|volta|fnm|bun|corepack)(?:\/|$)/.test(
      normalized
    )
  ) {
    return "npm-global";
  }

  // On Windows, inspect `.cmd`/`.bat` shims; native standalone installs ship `.exe`
  if (platform === "win32") {
    if (normalized.endsWith(".cmd") || normalized.endsWith(".bat")) {
      const content = (options.readTextFile ?? safeReadTextFile)(installedPath);
      if (
        content === null ||
        /node_modules|@anthropic-ai\/claude-code|node\.exe/i.test(content)
      ) {
        return "npm-global";
      }
    }
    if (normalized.endsWith(".exe")) {
      return "native-self-update";
    }
  }

  return "native-self-update";
}

/**
 * Detects which npm package backs the user's installed `omp` binary, defaulting
 * to `@oh-my-pi/pi-coding-agent`.
 */
export function detectOmpNpmPackage(
  installedPath: string | null | undefined,
  options: {
    readTextFile?: (filePath: string) => string | null;
    pathExists?: (filePath: string) => boolean;
  } = {}
): string {
  const fallback = "@oh-my-pi/pi-coding-agent";
  if (!installedPath || installedPath.trim().length === 0) {
    return fallback;
  }
  const readText = options.readTextFile ?? safeReadTextFile;
  const checkExists = options.pathExists ?? existsSync;

  const content = readText(installedPath);
  if (content) {
    const normalizedContent = content.replace(/\\/g, "/");
    const scopedMatch = /(@[a-z0-9._-]+\/[a-z0-9._-]*pi[a-z0-9._-]*)/i.exec(
      normalizedContent
    );
    if (scopedMatch?.[1]) {
      return scopedMatch[1];
    }
  }

  const binDir = dirname(installedPath);
  const candidates = [
    "@oh-my-pi/pi-coding-agent",
    "@mariozechner/pi-coding-agent"
  ];
  for (const pkg of candidates) {
    const parts = pkg.split("/");
    if (
      checkExists(join(binDir, "node_modules", ...parts, "package.json")) ||
      checkExists(join(binDir, "..", "lib", "node_modules", ...parts, "package.json"))
    ) {
      return pkg;
    }
  }

  return fallback;
}

function safeReadTextFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function sanitizeUpdateErrorMessage(raw: string): string {
  const redacted = raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/(_authToken|password|token)\s*[:=]\s*[^\s"'`]+/gi, "$1=[REDACTED]")
    .replace(/(https?:\/\/)([^:@/\s]+):([^@/\s]+)@/gi, "$1[REDACTED]@");

  const lines = redacted
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("npm notice"));

  const meaningful = lines.filter(
    (line) =>
      /npm (?:err!|error)/i.test(line) ||
      /EACCES|EPERM|ENOENT|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|404|403|502|503/i.test(
        line
      )
  );
  const picked = (meaningful.length > 0 ? meaningful : lines).slice(0, 3).join(" | ");
  const result = picked || "CLI 自动更新执行失败";
  return result.length > 280 ? `${result.slice(0, 277)}...` : result;
}

function getDefaultCliExtraDirs(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform
): string[] {
  const dirs: string[] = [];
  const home = homedir();
  if (platform === "win32") {
    const appData = env["APPDATA"]?.trim() || join(home, "AppData", "Roaming");
    const localAppData =
      env["LOCALAPPDATA"]?.trim() || join(home, "AppData", "Local");
    const userProfile = env["USERPROFILE"]?.trim() || home;
    const pnpmHome = env["PNPM_HOME"]?.trim();
    if (pnpmHome) dirs.push(pnpmHome);
    dirs.push(
      join(appData, "npm"),
      join(localAppData, "pnpm"),
      join(userProfile, ".local", "bin"),
      join(localAppData, "agy", "bin"),
      join(localAppData, "Microsoft", "WinGet", "Links"),
      join(userProfile, "scoop", "shims")
    );
  } else {
    const pnpmHome = env["PNPM_HOME"]?.trim();
    if (pnpmHome) dirs.push(pnpmHome);
    dirs.push(join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin");
  }
  return dirs;
}

function httpGetJson(
  url: string,
  timeoutMs: number,
  redirectsLeft = 3
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const fail = (err: Error) => {
      if (!settled) {
        settled = true;
        rejectPromise(err);
      }
    };
    const succeed = (result: { statusCode: number; body: string }) => {
      if (!settled) {
        settled = true;
        resolvePromise(result);
      }
    };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      fail(new Error(`Invalid registry URL: ${url}`));
      return;
    }

    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(
      parsed,
      {
        method: "GET",
        agent: false,
        headers: {
          accept: "application/vnd.npm.install-v1+json, application/json",
          "user-agent": "Prismux-CliUpdater/0.1",
          connection: "close"
        }
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        const location = res.headers.location;
        if (
          (statusCode === 301 ||
            statusCode === 302 ||
            statusCode === 307 ||
            statusCode === 308) &&
          typeof location === "string" &&
          location.length > 0 &&
          redirectsLeft > 0
        ) {
          res.resume();
          clearTimeout(timer);
          const nextUrl = new URL(location, parsed).toString();
          void httpGetJson(nextUrl, timeoutMs, redirectsLeft - 1)
            .then(succeed)
            .catch(fail);
          return;
        }

        const chunks: Buffer[] = [];
        let bytes = 0;
        const maxBytes = 2 * 1024 * 1024;
        res.on("data", (chunk: Buffer | string) => {
          const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
          bytes += buf.length;
          if (bytes > maxBytes) {
            req.destroy(new Error("Registry response exceeded 2MB limit."));
            return;
          }
          chunks.push(buf);
        });
        res.on("end", () => {
          clearTimeout(timer);
          succeed({
            statusCode,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
        res.on("error", (err) => {
          clearTimeout(timer);
          fail(err);
        });
      }
    );

    const timer = setTimeout(() => {
      req.destroy(new Error(`Registry request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    req.on("error", (err) => {
      clearTimeout(timer);
      fail(err);
    });

    req.end();
  });
}

export async function defaultFetchLatestNpmVersion(
  packageName: string,
  registryUrl: string,
  timeoutMs: number
): Promise<string> {
  const base = registryUrl.replace(/\/+$/, "");
  const latestUrl = `${base}/${packageName}/latest`;
  const primaryRes = await httpGetJson(latestUrl, timeoutMs);

  if (primaryRes.statusCode >= 200 && primaryRes.statusCode < 300) {
    const parsed = JSON.parse(primaryRes.body) as { version?: unknown };
    if (typeof parsed.version === "string" && parseSemver(parsed.version)) {
      return parseSemver(parsed.version)!.normalized;
    }
  }

  // Fallback to full packument (`dist-tags.latest`) when `/latest` is unsupported
  const encodedPkg = encodeURIComponent(packageName).replace(/^%40/, "@");
  const packumentUrl = `${base}/${encodedPkg}`;
  const fallbackRes = await httpGetJson(packumentUrl, timeoutMs);
  if (fallbackRes.statusCode < 200 || fallbackRes.statusCode >= 300) {
    throw new Error(`HTTP ${fallbackRes.statusCode} from ${base}`);
  }
  const packument = JSON.parse(fallbackRes.body) as {
    "dist-tags"?: { latest?: unknown };
    version?: unknown;
  };
  const latest = packument["dist-tags"]?.latest ?? packument.version;
  if (typeof latest !== "string" || !parseSemver(latest)) {
    throw new Error(`Registry ${base} returned invalid version for ${packageName}`);
  }
  return parseSemver(latest)!.normalized;
}

async function defaultExecCliCommand(
  executablePath: string,
  args: readonly string[],
  timeoutMs: number,
  options: {
    platform: NodeJS.Platform;
    env: Record<string, string | undefined>;
  }
): Promise<CliCommandExecResult> {
  const spec = buildSafeCliSpawnSpec(executablePath, args, {
    platform: options.platform,
    env: options.env
  });
  try {
    const { stdout, stderr } = await execFileAsync(spec.file, spec.args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      env: spec.env,
      windowsVerbatimArguments: spec.windowsVerbatimArguments
    });
    return {
      exitCode: 0,
      stdout: String(stdout ?? ""),
      stderr: String(stderr ?? "")
    };
  } catch (error: unknown) {
    const err = error as {
      code?: number | string;
      killed?: boolean;
      signal?: string | null;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    const timedOut = Boolean(err.killed && (err.signal === "SIGTERM" || err.signal === "SIGKILL"));
    const exitCode = typeof err.code === "number" ? err.code : 1;
    return {
      exitCode,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? err.message ?? ""),
      timedOut
    };
  }
}

export class CliUpdateService {
  private readonly appUpdater: Pick<AppUpdater, "getPolicy"> | undefined;
  private readonly cacheTtlMs: number;
  private readonly registryTimeoutMs: number;
  private readonly probeTimeoutMs: number;
  private readonly installTimeoutMs: number;
  private readonly npmRegistryUrl: string;
  private readonly npmMirrorRegistryUrl: string;
  private readonly platform: NodeJS.Platform;
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => number;
  private readonly onAfterUpdate: (() => void) | undefined;
  private readonly cliProbeFn: (
    command: string,
    args: string[],
    timeoutMs: number
  ) => Promise<CliProbeResult>;
  private readonly fetchLatestFn: (
    packageName: string,
    registryUrl: string,
    timeoutMs: number
  ) => Promise<string>;
  private readonly execCommandFn: (
    executablePath: string,
    args: readonly string[],
    timeoutMs: number
  ) => Promise<CliCommandExecResult>;
  private readonly findExecutableFn: (commandNames: readonly string[]) => string | null;
  private readonly readTextFileFn: (filePath: string) => string | null;
  private readonly pathExistsFn: (filePath: string) => boolean;
  private readonly refreshEnvFn: () => Promise<WindowsEnvRefreshResult | void> | void;

  private readonly cache = new Map<ManagedCliProviderId, CliUpdateCheckItem>();
  private readonly inflightChecks = new Map<
    ManagedCliProviderId,
    Promise<CliUpdateCheckItem>
  >();
  private readonly inflightInstalls = new Map<
    ManagedCliProviderId,
    Promise<CliUpdateInstallResult>
  >();

  constructor(options: CliUpdateServiceOptions = {}) {
    this.appUpdater = options.appUpdater;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CLI_UPDATE_CACHE_TTL_MS;
    this.registryTimeoutMs = options.registryTimeoutMs ?? DEFAULT_CLI_CHECK_TIMEOUT_MS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_CLI_PROBE_TIMEOUT_MS;
    this.installTimeoutMs = options.installTimeoutMs ?? DEFAULT_CLI_INSTALL_TIMEOUT_MS;
    this.npmRegistryUrl = (
      options.npmRegistryUrl ?? UPDATE_ENDPOINTS.npmRegistry
    ).replace(/\/+$/, "");
    this.npmMirrorRegistryUrl = (
      options.npmMirrorRegistryUrl ?? UPDATE_ENDPOINTS.npmMirrorRegistry
    ).replace(/\/+$/, "");
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
    this.now = options.now ?? (() => Date.now());
    this.onAfterUpdate = options.onAfterUpdate;
    this.cliProbeFn =
      options.cliProbe ??
      ((command, args, timeoutMs) =>
        defaultCliProbe(command, args, timeoutMs, {
          env: this.env,
          platform: this.platform
        }));
    this.fetchLatestFn = options.fetchLatestNpmVersion ?? defaultFetchLatestNpmVersion;
    this.execCommandFn =
      options.execCommand ??
      ((executablePath, args, timeoutMs) =>
        defaultExecCliCommand(executablePath, args, timeoutMs, {
          platform: this.platform,
          env: this.env
        }));
    this.findExecutableFn =
      options.findExecutable ??
      ((commandNames) =>
        findExecutableOnPath(commandNames, {
          env: this.env,
          platform: this.platform,
          extraDirs: getDefaultCliExtraDirs(this.env, this.platform)
        }));
    this.readTextFileFn = options.readTextFile ?? safeReadTextFile;
    this.pathExistsFn = options.pathExists ?? existsSync;
    this.refreshEnvFn =
      options.refreshEnv ??
      (() =>
        refreshWindowsEnvironmentFromRegistry({
          targetEnv: this.env,
          platform: this.platform,
          timeoutMs: 600
        }));
  }

  clearCache(provider?: string): void {
    if (!provider) {
      this.cache.clear();
      return;
    }
    const canonical = normalizeCliProviderId(provider);
    if (canonical) {
      this.cache.delete(canonical);
    }
  }

  resolveRegistryOrder(): string[] {
    const policy = this.appUpdater?.getPolicy();
    const override = policy?.pluginRegistryOverride ?? "auto";
    const route = policy?.routePreference ?? "auto";

    const preferMirror =
      override === "npmmirror" ||
      (override === "auto" && route === "domestic");

    if (preferMirror) {
      return this.npmMirrorRegistryUrl === this.npmRegistryUrl
        ? [this.npmMirrorRegistryUrl]
        : [this.npmMirrorRegistryUrl, this.npmRegistryUrl];
    }
    return this.npmRegistryUrl === this.npmMirrorRegistryUrl
      ? [this.npmRegistryUrl]
      : [this.npmRegistryUrl, this.npmMirrorRegistryUrl];
  }

  async checkUpdates(options: {
    force?: boolean;
    provider?: string | null;
  } = {}): Promise<CliUpdatesCheckResponse> {
    const force = options.force === true;
    const requestedProvider = options.provider?.trim();

    if (requestedProvider) {
      const canonical = normalizeCliProviderId(requestedProvider);
      if (!canonical) {
        const now = this.now();
        const unsupported: CliUpdateCheckItem = {
          provider: requestedProvider,
          canonicalProvider: null,
          command: null,
          packageName: null,
          installed: false,
          installedPath: null,
          currentVersion: null,
          rawVersion: null,
          latestVersion: null,
          hasUpdate: false,
          updateSupported: false,
          installMethod: "unsupported",
          registryUsed: null,
          checkedAt: now,
          cached: false
        };
        return {
          ok: true,
          checkedAt: now,
          cached: false,
          items: [unsupported],
          item: unsupported
        };
      }

      if (force) {
        await this.safeRefreshEnv();
      }
      const item = await this.checkSingleProvider(canonical, force);
      return {
        ok: true,
        checkedAt: item.checkedAt,
        cached: item.cached,
        items: [item],
        item
      };
    }

    if (force) {
      await this.safeRefreshEnv();
    }
    const items = await Promise.all(
      ALL_MANAGED_CLI_PROVIDERS.map((id) => this.checkSingleProvider(id, force))
    );
    const checkedAt = items.reduce(
      (max, item) => (item.checkedAt > max ? item.checkedAt : max),
      this.now()
    );
    const allCached = items.length > 0 && items.every((item) => item.cached);
    return {
      ok: true,
      checkedAt,
      cached: allCached,
      items
    };
  }

  async installUpdate(rawProvider: string): Promise<CliUpdateInstallResult> {
    const canonical = normalizeCliProviderId(rawProvider);
    if (!canonical) {
      throw new CliUpdateError(
        400,
        "CLI_UPDATE_UNSUPPORTED",
        `不支持自动更新提供方 "${rawProvider}"。`
      );
    }
    const spec = MANAGED_CLI_SPECS[canonical];
    if (!spec.updateSupported) {
      throw new CliUpdateError(
        400,
        "CLI_UPDATE_UNSUPPORTED",
        `${canonical} 为受管原生客户端，不支持通过 npm 静默自动更新。`
      );
    }

    const existing = this.inflightInstalls.get(canonical);
    if (existing) {
      throw new CliUpdateError(
        409,
        "CLI_UPDATE_IN_PROGRESS",
        `${canonical} 正在更新中，请稍候…`
      );
    }

    const run = this.executeInstall(canonical).finally(() => {
      if (this.inflightInstalls.get(canonical) === run) {
        this.inflightInstalls.delete(canonical);
      }
    });
    this.inflightInstalls.set(canonical, run);
    return run;
  }

  private async checkSingleProvider(
    providerId: ManagedCliProviderId,
    force: boolean
  ): Promise<CliUpdateCheckItem> {
    const now = this.now();
    if (!force) {
      const cached = this.cache.get(providerId);
      if (cached && now - cached.checkedAt < this.cacheTtlMs) {
        return { ...cached, cached: true };
      }
      const inflight = this.inflightChecks.get(providerId);
      if (inflight) {
        return inflight;
      }
    }

    const run = this.probeAndCompare(providerId).finally(() => {
      if (this.inflightChecks.get(providerId) === run) {
        this.inflightChecks.delete(providerId);
      }
    });
    this.inflightChecks.set(providerId, run);
    return run;
  }

  private async probeAndCompare(
    providerId: ManagedCliProviderId
  ): Promise<CliUpdateCheckItem> {
    const spec = MANAGED_CLI_SPECS[providerId];
    const probe = await this.cliProbeFn(
      spec.command,
      [...spec.versionArgs],
      this.probeTimeoutMs
    );
    const installedPath = probe.path ?? null;
    const rawVersion = probe.version ?? null;
    const currentVersion = extractSemverFromOutput(rawVersion);

    const packageName =
      providerId === "omp"
        ? detectOmpNpmPackage(installedPath, {
            readTextFile: this.readTextFileFn,
            pathExists: this.pathExistsFn
          })
        : spec.defaultNpmPackage;

    const installMethod: CliInstallMethod = !spec.updateSupported
      ? "unsupported"
      : providerId === "claude"
        ? detectClaudeInstallMethod(installedPath, {
            platform: this.platform,
            readTextFile: this.readTextFileFn
          })
        : "npm-global";

    if (!spec.updateSupported || !packageName) {
      const item: CliUpdateCheckItem = {
        provider: providerId,
        canonicalProvider: providerId,
        command: spec.command,
        packageName: null,
        installed: probe.found,
        installedPath,
        currentVersion,
        rawVersion,
        latestVersion: null,
        hasUpdate: false,
        updateSupported: false,
        installMethod: "unsupported",
        registryUsed: null,
        checkedAt: this.now(),
        cached: false
      };
      this.cache.set(providerId, item);
      return item;
    }

    const { latestVersion, registryUsed, error } = await this.fetchLatestWithFallback(
      packageName
    );
    const hasUpdate = Boolean(
      probe.found &&
        currentVersion &&
        latestVersion &&
        isNewerVersion(latestVersion, currentVersion)
    );

    const item: CliUpdateCheckItem = {
      provider: providerId,
      canonicalProvider: providerId,
      command: spec.command,
      packageName,
      installed: probe.found,
      installedPath,
      currentVersion,
      rawVersion,
      latestVersion,
      hasUpdate,
      updateSupported: true,
      installMethod,
      registryUsed,
      checkedAt: this.now(),
      cached: false,
      ...(error ? { error } : {})
    };
    this.cache.set(providerId, item);
    return item;
  }

  private async fetchLatestWithFallback(packageName: string): Promise<{
    latestVersion: string | null;
    registryUsed: string | null;
    error?: string;
  }> {
    const registries = this.resolveRegistryOrder();
    const errors: string[] = [];

    for (const registry of registries) {
      try {
        const version = await this.fetchLatestFn(
          packageName,
          registry,
          this.registryTimeoutMs
        );
        const parsed = parseSemver(version);
        if (parsed) {
          return {
            latestVersion: parsed.normalized,
            registryUsed: registry
          };
        }
        errors.push(`${registry}: invalid semver "${version}"`);
      } catch (err) {
        errors.push(
          `${registry}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return {
      latestVersion: null,
      registryUsed: null,
      error: sanitizeUpdateErrorMessage(errors.join(" ; "))
    };
  }

  private async executeInstall(
    providerId: ManagedCliProviderId
  ): Promise<CliUpdateInstallResult> {
    const started = performance.now();
    const spec = MANAGED_CLI_SPECS[providerId];

    // Refresh env first and probe current installation state
    await this.safeRefreshEnv();
    const beforeProbe = await this.cliProbeFn(
      spec.command,
      [...spec.versionArgs],
      this.probeTimeoutMs
    );
    const previousVersion = extractSemverFromOutput(beforeProbe.version ?? null);
    const installedPath = beforeProbe.path ?? null;

    const packageName =
      providerId === "omp"
        ? detectOmpNpmPackage(installedPath, {
            readTextFile: this.readTextFileFn,
            pathExists: this.pathExistsFn
          })
        : spec.defaultNpmPackage;

    const method: Exclude<CliInstallMethod, "unsupported"> =
      providerId === "claude"
        ? detectClaudeInstallMethod(installedPath, {
            platform: this.platform,
            readTextFile: this.readTextFileFn
          })
        : "npm-global";

    let registryUsed: string | null = null;

    if (method === "native-self-update") {
      const targetExe = installedPath ?? this.findExecutableFn([spec.command]);
      if (!targetExe) {
        throw new CliUpdateError(
          400,
          "CLI_BINARY_NOT_FOUND",
          `未找到本机 ${spec.command} 可执行文件，无法执行原地自更新。`
        );
      }
      const res = await this.execCommandFn(
        targetExe,
        ["update"],
        this.installTimeoutMs
      );
      if (res.timedOut) {
        throw new CliUpdateError(
          504,
          "CLI_UPDATE_TIMEOUT",
          `${spec.command} update 执行超时（>${Math.round(this.installTimeoutMs / 1000)}s），请检查网络后重试。`
        );
      }
      if (res.exitCode !== 0) {
        throw new CliUpdateError(
          502,
          "CLI_UPDATE_FAILED",
          sanitizeUpdateErrorMessage(
            res.stderr || res.stdout || `${spec.command} update 退出码 ${res.exitCode}`
          )
        );
      }
    } else {
      if (!packageName) {
        throw new CliUpdateError(
          400,
          "CLI_UPDATE_UNSUPPORTED",
          `${providerId} 未配置对应的 npm 包名。`
        );
      }
      const npmExe = this.findExecutableFn(["npm"]);
      if (!npmExe) {
        throw new CliUpdateError(
          500,
          "NPM_NOT_FOUND",
          "未在系统 PATH 中找到 npm，请确认 Node.js / npm 已正确安装。"
        );
      }

      const registries = this.resolveRegistryOrder();
      let lastError: CliUpdateError | null = null;

      for (const registry of registries) {
        const args = [
          "install",
          "-g",
          `${packageName}@latest`,
          "--no-audit",
          "--no-fund",
          `--registry=${registry}`
        ];
        const res = await this.execCommandFn(npmExe, args, this.installTimeoutMs);
        if (res.exitCode === 0) {
          registryUsed = registry;
          lastError = null;
          break;
        }
        if (res.timedOut) {
          lastError = new CliUpdateError(
            504,
            "CLI_UPDATE_TIMEOUT",
            `npm 更新 ${packageName} 超时（>${Math.round(this.installTimeoutMs / 1000)}s），请检查网络后重试。`
          );
          continue;
        }
        lastError = new CliUpdateError(
          502,
          "CLI_UPDATE_FAILED",
          sanitizeUpdateErrorMessage(
            res.stderr || res.stdout || `npm install -g ${packageName}@latest 退出码 ${res.exitCode}`
          )
        );
      }

      if (lastError !== null) {
        throw lastError;
      }
    }

    // Post-install: refresh Windows env, clear diagnostics cache, re-probe actual version
    await this.safeRefreshEnv();
    try {
      this.onAfterUpdate?.();
    } catch {
      // Cache invalidation must not fail a completed install.
    }

    const afterProbe = await this.cliProbeFn(
      spec.command,
      [...spec.versionArgs],
      this.probeTimeoutMs
    );
    const afterRawVersion = afterProbe.version ?? null;
    const newVersion = extractSemverFromOutput(afterRawVersion);
    const cachedBefore = this.cache.get(providerId);
    const latestVersion = cachedBefore?.latestVersion ?? newVersion;
    const hasUpdate = Boolean(
      afterProbe.found &&
        newVersion &&
        latestVersion &&
        isNewerVersion(latestVersion, newVersion)
    );

    const updatedItem: CliUpdateCheckItem = {
      provider: providerId,
      canonicalProvider: providerId,
      command: spec.command,
      packageName,
      installed: afterProbe.found,
      installedPath: afterProbe.path ?? installedPath,
      currentVersion: newVersion,
      rawVersion: afterRawVersion,
      latestVersion,
      hasUpdate,
      updateSupported: true,
      installMethod: method,
      registryUsed: registryUsed ?? cachedBefore?.registryUsed ?? null,
      checkedAt: this.now(),
      cached: false
    };
    this.cache.set(providerId, updatedItem);

    const durationMs = Math.max(0, Math.round(performance.now() - started));
    const versionNote = newVersion ? `v${newVersion}` : "最新版本";
    return {
      ok: true,
      provider: providerId,
      packageName,
      method,
      previousVersion,
      newVersion,
      latestVersion,
      registryUsed: updatedItem.registryUsed,
      durationMs,
      item: updatedItem,
      message: `${providerId} 已自动更新至 ${versionNote}`
    };
  }

  private async safeRefreshEnv(): Promise<void> {
    try {
      await Promise.resolve(this.refreshEnvFn());
    } catch {
      // Non-fatal on restricted environments.
    }
  }
}
