import { execFile, execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync
} from "node:fs";
import {
  open as openFileAsync,
  readdir as readdirAsync,
  stat as statAsync
} from "node:fs/promises";
import * as http from "node:http";
import * as https from "node:https";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import type { SqliteMemoryStore } from "@prismux/memory-core";
import {
  DIAGNOSTIC_CATEGORIES,
  UPDATE_ENDPOINTS,
  type DiagnosticCategoryId,
  type DiagnosticCheckItem,
  type DiagnosticCheckStatus,
  type DiagnosticGroupSummary,
  type ServiceDiagnosticsResponse
} from "@prismux/protocol";
import type { SyncVaultEngine } from "@prismux/sync-vault";
import type { LifecycleHookBus } from "../hooks/LifecycleHookBus.js";
import type { PersistentPtyPool } from "../pty/PersistentPtyPool.js";
import {
  selectPlatformSandboxBackend,
  type WorktreeSandbox
} from "../sandbox/WorktreeSandbox.js";
import type { CoreRpcClient } from "../core/CoreRpcClient.js";
import type { CoreServerSupervisor } from "../core/CoreServerSupervisor.js";
import { resolve7zaBinary, type AppUpdater } from "../updater/AppUpdater.js";
import type { WallpaperMediaService } from "../wallpapers/WallpaperMediaService.js";
import type { OvernightFactory } from "../workflows/OvernightFactory.js";
import {
  PRISMUX_PROBE_PROVIDER_SPECS,
  PrismuxProviderProbeService,
  canonicalizeProbeProviderId,
  type ProviderProbeSpec
} from "./PrismuxProviderProbeService.js";
import type { ResourceMonitorService } from "./ResourceMonitorService.js";
import {
  buildSafeCliSpawnSpec,
  decodeWindowsProcessOutput,
  findExecutableOnPath,
  refreshWindowsEnvironmentFromRegistry,
  type WindowsEnvRefreshResult
} from "./WindowsEnvRefresh.js";

const execFileAsync = promisify(execFile);

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_SINGLE_CHECK_TIMEOUT_MS = 1_100;
const DEFAULT_GLOBAL_BUDGET_MS = 2_400;
export const CLI_DISCOVERY_POSITIVE_TTL_MS = 10 * 60 * 1000;
export const CLI_DISCOVERY_NEGATIVE_TTL_MS = 5 * 60 * 1000;

interface TtlCacheEntry<T> {
  value: T;
  expiresAt: number;
}

const MAX_DISCOVERY_CACHE_ENTRIES = 128;

function getTtlCached<T>(
  cache: Map<string, TtlCacheEntry<T>>,
  key: string,
  nowMs = Date.now()
): { hit: true; value: T } | { hit: false } {
  const entry = cache.get(key);
  if (!entry) return { hit: false };
  if (nowMs >= entry.expiresAt) {
    cache.delete(key);
    return { hit: false };
  }
  return { hit: true, value: entry.value };
}

function setTtlCached<T>(
  cache: Map<string, TtlCacheEntry<T>>,
  key: string,
  value: T,
  isPositive: boolean,
  nowMs = Date.now()
): void {
  if (cache.size >= MAX_DISCOVERY_CACHE_ENTRIES && !cache.has(key)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  const ttlMs = isPositive
    ? CLI_DISCOVERY_POSITIVE_TTL_MS
    : CLI_DISCOVERY_NEGATIVE_TTL_MS;
  cache.set(key, { value, expiresAt: nowMs + ttlMs });
}

const packagedDshCache = new Map<
  string,
  TtlCacheEntry<{ executablePath: string; bootstrapPath: string } | null>
>();
const packagedAgyCache = new Map<string, TtlCacheEntry<string | null>>();
const androidSdkCache = new Map<
  string,
  TtlCacheEntry<{ sdkRoot: string | null; adbPath: string | null }>
>();
const cliProbeCache = new Map<string, TtlCacheEntry<CliProbeResult>>();
const daemonUninstallDirsCache = new Map<string, TtlCacheEntry<readonly string[]>>();

/**
 * Clears all in-process CLI discovery, Android SDK, Uninstall registry, and CLI
 * version probe caches (positive & negative). Invoked automatically on explicit
 * `refresh=1` / `force=1` diagnostics and provider probe refreshes.
 */
export function clearCliDiscoveryCaches(): void {
  packagedDshCache.clear();
  packagedAgyCache.clear();
  androidSdkCache.clear();
  cliProbeCache.clear();
  daemonUninstallDirsCache.clear();
}

export interface RunDiagnosticsOptions {
  force?: boolean;
  /** Optional list of configured/enabled provider IDs to scope AI CLI checks. */
  providers?: readonly string[] | null;
  /** Explicitly include all known AI providers regardless of `configuredProviders`. */
  includeAll?: boolean;
  /** Opt-in drive root scan (`C:/D:/E:/F:`); defaults to `false`. */
  deepScan?: boolean;
}

export interface CliProbeResult {
  found: boolean;
  path?: string | null;
  version?: string | null;
  latencyMs: number;
  error?: string;
}

export interface NetworkProbeResult {
  reachable: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error?: string;
}

export interface ServiceDiagnosticsOptions {
  dataDir: string;
  version: string;
  headless: boolean;
  startedAt: number;
  memoryStore?: SqliteMemoryStore;
  memoryDbPath?: string;
  syncVault?: SyncVaultEngine;
  coreSupervisor?: CoreServerSupervisor;
  coreRpcClient?: CoreRpcClient;
  /** @deprecated Use coreSupervisor */
  t3Supervisor?: CoreServerSupervisor;
  /** @deprecated Use coreRpcClient */
  t3RpcClient?: CoreRpcClient;
  /** Optional explicit Core Server URL (HTTP or WS) when desktop-hosted. */
  coreServerUrl?: string;
  /** Optional Core Server bearer token used strictly as a probe header (never logged/returned). */
  coreToken?: string;
  /** @deprecated Use coreToken */
  t3Token?: string;
  providerProbeService?: PrismuxProviderProbeService;
  ptyPool?: PersistentPtyPool;
  resourceMonitor?: ResourceMonitorService;
  appUpdater?: AppUpdater;
  wallpaperService?: WallpaperMediaService;
  overnightFactory?: OvernightFactory;
  hookBus?: LifecycleHookBus;
  sandbox?: WorktreeSandbox;
  cacheTtlMs?: number;
  singleCheckTimeoutMs?: number;
  globalBudgetMs?: number;
  /** Injectable CLI version probe for deterministic tests (never reads OAuth/keyring). */
  cliProbe?: (
    command: string,
    args: string[],
    timeoutMs: number
  ) => Promise<CliProbeResult>;
  /** Injectable network reachability probe for deterministic tests. */
  networkProbe?: (
    url: string,
    timeoutMs: number,
    headers?: Record<string, string>,
    method?: "HEAD" | "GET"
  ) => Promise<NetworkProbeResult>;
  /** Injectable Android SDK path detector for deterministic tests. */
  detectAndroidSdk?: () => { sdkRoot: string | null; adbPath: string | null };
  /** Injectable 7za path resolver for deterministic tests. */
  resolve7za?: () => string | null;
  /**
   * Injectable environment refresher called before every uncached/forced
   * diagnostics run (defaults to Windows HKLM + HKCU registry refresh).
   */
  refreshEnv?: () => Promise<WindowsEnvRefreshResult | void> | void;
  /** Optional configured/enabled provider IDs to scope AI provider scans by default. */
  configuredProviders?:
    | readonly string[]
    | (() => readonly string[] | null | undefined);
}

const CATEGORY_LABELS: Record<DiagnosticCategoryId, string> = {
  host_core: "宿主核心",
  memory_sync: "记忆与同步",
  ai_providers: "AI Provider CLI",
  simulators_media: "模拟器与媒体工具",
  network_mirrors: "网络与镜像源",
  dormant_engines: "沉睡内核状态摘要"
};

function readEnvCaseInsensitive(
  env: Record<string, string | undefined>,
  key: string,
  platform: NodeJS.Platform
): string | undefined {
  if (platform !== "win32") {
    const val = env[key]?.trim();
    return val && val.length > 0 ? val : undefined;
  }
  const upper = key.toUpperCase();
  for (const [k, v] of Object.entries(env)) {
    if (k.toUpperCase() === upper && v?.trim()) {
      return v.trim();
    }
  }
  return undefined;
}

export function getDefaultCliExtraDirs(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = homedir()
): string[] {
  const dirs: string[] = [];
  if (platform === "win32") {
    const userProfile = readEnvCaseInsensitive(env, "USERPROFILE", platform) || homeDir;
    const appData =
      readEnvCaseInsensitive(env, "APPDATA", platform) || join(userProfile, "AppData", "Roaming");
    const localAppData =
      readEnvCaseInsensitive(env, "LOCALAPPDATA", platform) ||
      join(userProfile, "AppData", "Local");
    const pnpmHome = readEnvCaseInsensitive(env, "PNPM_HOME", platform);
    const voltaHome = readEnvCaseInsensitive(env, "VOLTA_HOME", platform);
    const nvmSymlink = readEnvCaseInsensitive(env, "NVM_SYMLINK", platform);
    const bunInstall = readEnvCaseInsensitive(env, "BUN_INSTALL", platform);
    if (pnpmHome) dirs.push(pnpmHome);
    dirs.push(
      join(appData, "npm"),
      join(localAppData, "pnpm"),
      join(localAppData, "agy", "bin"),
      join(localAppData, "Microsoft", "WinGet", "Links"),
      join(localAppData, "Volta", "bin"),
      join(localAppData, "DSH NEXT", "bin"),
      join(localAppData, "Programs", "nodejs")
    );
    if (voltaHome) dirs.push(join(voltaHome, "bin"));
    if (nvmSymlink) dirs.push(nvmSymlink);
    if (bunInstall) dirs.push(join(bunInstall, "bin"));
    dirs.push(
      join(userProfile, ".local", "bin"),
      join(userProfile, ".bun", "bin"),
      join(userProfile, "scoop", "shims"),
      join(userProfile, ".opencode", "bin"),
      join(userProfile, ".dsh", "bin")
    );
  } else {
    const home = readEnvCaseInsensitive(env, "HOME", platform) || homeDir;
    const pnpmHome = readEnvCaseInsensitive(env, "PNPM_HOME", platform);
    const bunInstall = readEnvCaseInsensitive(env, "BUN_INSTALL", platform);
    const voltaHome = readEnvCaseInsensitive(env, "VOLTA_HOME", platform);
    if (pnpmHome) dirs.push(pnpmHome);
    if (bunInstall) dirs.push(join(bunInstall, "bin"));
    if (voltaHome) dirs.push(join(voltaHome, "bin"));
    dirs.push(
      join(home, ".local", "bin"),
      join(home, ".bun", "bin"),
      join(home, ".opencode", "bin"),
      join(home, ".dsh", "bin"),
      join(home, ".volta", "bin"),
      join(home, ".npm-global", "bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin"
    );
  }
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const dir of dirs) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    const key = platform === "win32" ? trimmed.toLowerCase() : trimmed;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(trimmed);
  }
  return deduped;
}

function extractFirstVersionLine(output: string): string | null {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return null;
  }
  const first = lines[0]!;
  return first.length > 100 ? `${first.slice(0, 97)}...` : first;
}

async function execSafeCli(
  executablePath: string,
  args: readonly string[],
  timeoutMs: number,
  options: {
    env?: Record<string, string | undefined>;
    platform?: NodeJS.Platform;
    maxBuffer?: number;
  } = {}
): Promise<{ stdout: string; stderr: string }> {
  const spec = buildSafeCliSpawnSpec(executablePath, args, {
    env: options.env ?? process.env,
    platform: options.platform ?? process.platform
  });
  const result = await execFileAsync(spec.file, spec.args, {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: options.maxBuffer ?? 512 * 1024,
    env: spec.env,
    windowsVerbatimArguments: spec.windowsVerbatimArguments
  });
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? "")
  };
}

const DSH_ASAR_BOOTSTRAP_ENTRIES = [
  "lib/desktop-cli.js",
  "node_modules/@deepseek-ai/dsh/lib/bin.js"
] as const;

const WINDOWS_DSH_DESKTOP_CANDIDATES = [
  { folder: "DSH NEXT", executable: "DSH NEXT.exe" },
  { folder: "DSH", executable: "DSH.exe" },
  { folder: "DeepSeek Harness", executable: "DeepSeek Harness.exe" }
] as const;

const MACOS_DSH_DESKTOP_CANDIDATES = [
  { bundle: "DSH NEXT.app", executable: "DSH NEXT" },
  { bundle: "DSH.app", executable: "DSH" },
  { bundle: "DeepSeek Harness.app", executable: "DeepSeek Harness" }
] as const;

const DSH_ASAR_PACKAGE_JSON_CANDIDATES = [
  "node_modules/@deepseek-ai/dsh/package.json",
  "node_modules/@deepseek-ai/dsh-acp/package.json",
  "package.json"
] as const;

const MAX_ASAR_PACKAGE_JSON_BYTES = 4 * 1024 * 1024;
const DSH_SEMVER_RE = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/;
const DSH_PACKAGE_NAME_RE = /^(?:@deepseek-ai\/dsh(?:-[a-z0-9-]+)?|dsh|deepseek-harness)$/i;

export function isPlaceholderDshVersion(version: string | null | undefined): boolean {
  if (typeof version !== "string") return true;
  const normalized = version.trim().replace(/^v/i, "");
  return normalized.length === 0 || normalized === "0.0.0" || normalized === "0.0.1";
}

function parseDshSemver(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const match = DSH_SEMVER_RE.exec(raw.trim());
  const version = match?.[1]?.trim();
  if (!version || isPlaceholderDshVersion(version)) {
    return null;
  }
  return version;
}

interface AsarFileLeaf {
  readonly size: number;
  readonly offset?: string | number;
  readonly unpacked?: boolean;
}

function lookupAsarEntryInHeader(
  header: { readonly files?: Record<string, unknown> },
  relativeEntry: string
): AsarFileLeaf | null {
  let cursor: unknown = header;
  for (const segment of relativeEntry.split("/")) {
    if (cursor === null || typeof cursor !== "object" || !("files" in cursor)) {
      return null;
    }
    const files = (cursor as { readonly files?: Record<string, unknown> }).files;
    if (!files || !Object.hasOwn(files, segment)) {
      return null;
    }
    cursor = files[segment];
  }
  if (cursor === null || typeof cursor !== "object" || "files" in cursor) {
    return null;
  }
  const leaf = cursor as { size?: unknown; offset?: unknown; unpacked?: unknown };
  if (typeof leaf.size !== "number" || !Number.isFinite(leaf.size) || leaf.size < 0) {
    return null;
  }
  return {
    size: leaf.size,
    ...(typeof leaf.offset === "string" || typeof leaf.offset === "number"
      ? { offset: leaf.offset }
      : {}),
    ...(leaf.unpacked === true ? { unpacked: true } : {})
  };
}

export function readAsarTextEntrySync(
  asarPath: string,
  relativeEntry: string
): string | null {
  const directPath = join(asarPath, ...relativeEntry.split("/"));
  if (isExistingFile(directPath)) {
    try {
      return readFileSync(directPath, "utf8");
    } catch {
      return null;
    }
  }
  if (!isExistingFile(asarPath)) {
    return null;
  }
  let fd: number | undefined;
  try {
    fd = openSync(asarPath, "r");
    const prefix = Buffer.alloc(16);
    if (readSync(fd, prefix, 0, 16, 0) < 16) return null;
    const headerSize = prefix.readUInt32LE(4);
    const jsonSize = prefix.readUInt32LE(12);
    if (
      headerSize === 0 ||
      jsonSize === 0 ||
      jsonSize > 64 * 1024 * 1024 ||
      headerSize < jsonSize
    ) {
      return null;
    }
    const jsonBuffer = Buffer.alloc(jsonSize);
    if (readSync(fd, jsonBuffer, 0, jsonSize, 16) < jsonSize) return null;
    const parsed = JSON.parse(jsonBuffer.toString("utf8")) as {
      files?: Record<string, unknown>;
    };
    const entry = lookupAsarEntryInHeader(parsed, relativeEntry);
    if (!entry) return null;
    if (entry.unpacked === true) {
      const unpackedPath = join(`${asarPath}.unpacked`, ...relativeEntry.split("/"));
      return isExistingFile(unpackedPath) ? readFileSync(unpackedPath, "utf8") : null;
    }
    if (entry.size > MAX_ASAR_PACKAGE_JSON_BYTES || entry.offset === undefined) {
      return null;
    }
    const relOffset = Number(entry.offset);
    if (!Number.isSafeInteger(relOffset) || relOffset < 0) return null;
    const dataOffset = 8 + headerSize + relOffset;
    const payload = Buffer.alloc(entry.size);
    if (readSync(fd, payload, 0, entry.size, dataOffset) < entry.size) return null;
    return payload.toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore close failure
      }
    }
  }
}

function readPackageVersionFromText(
  rawJson: string | null | undefined,
  options: { requireDshName?: boolean } = {}
): string | null {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson) as { name?: unknown; version?: unknown };
    if (
      options.requireDshName &&
      (typeof parsed.name !== "string" || !DSH_PACKAGE_NAME_RE.test(parsed.name.trim()))
    ) {
      return null;
    }
    return parseDshSemver(typeof parsed.version === "string" ? parsed.version : null);
  } catch {
    return null;
  }
}

function readDshVersionFromAsarOrAppDirSync(asarPath: string): string | null {
  for (const candidate of DSH_ASAR_PACKAGE_JSON_CANDIDATES) {
    const version = readPackageVersionFromText(readAsarTextEntrySync(asarPath, candidate));
    if (version) return version;
  }
  const siblingAppDir = join(dirname(asarPath), "app");
  for (const candidate of DSH_ASAR_PACKAGE_JSON_CANDIDATES) {
    const filePath = join(siblingAppDir, ...candidate.split("/"));
    if (isExistingFile(filePath)) {
      try {
        const version = readPackageVersionFromText(readFileSync(filePath, "utf8"));
        if (version) return version;
      } catch {
        // ignore unreadable package.json
      }
    }
  }
  return null;
}

export function resolveDshInstalledVersionFastSync(options: {
  binaryPath?: string | null;
  bootstrapPath?: string | null;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  homeDir?: string;
} = {}): string | null {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();

  // 1. Direct ASAR path from bootstrapPath
  if (options.bootstrapPath) {
    const asarMatch = /^(.*?[\\/]app\.asar)(?:[\\/]|$)/i.exec(options.bootstrapPath.trim());
    if (asarMatch?.[1]) {
      const version = readDshVersionFromAsarOrAppDirSync(asarMatch[1]);
      if (version) return version;
    }
  }

  // 2. Binary path -> Electron resources/app.asar or adjacent package.json
  if (options.binaryPath) {
    const binPath = options.binaryPath.trim();
    const binDir = dirname(binPath);
    const candidateAsars =
      platform === "darwin"
        ? [resolve(binDir, "..", "Resources", "app.asar"), join(binDir, "resources", "app.asar")]
        : [join(binDir, "resources", "app.asar")];
    for (const asarPath of candidateAsars) {
      const version = readDshVersionFromAsarOrAppDirSync(asarPath);
      if (version) return version;
    }

    // Walk up 0..3 parent dirs for standalone npm / node package layouts
    let cursor = binDir;
    for (let depth = 0; depth <= 3; depth += 1) {
      for (const relPkg of [
        "package.json",
        join("node_modules", "@deepseek-ai", "dsh", "package.json"),
        join("node_modules", "@deepseek-ai", "dsh-acp", "package.json")
      ]) {
        const pkgPath = join(cursor, relPkg);
        if (isExistingFile(pkgPath)) {
          try {
            const version = readPackageVersionFromText(readFileSync(pkgPath, "utf8"), {
              requireDshName: relPkg === "package.json"
            });
            if (version) return version;
          } catch {
            // continue walking
          }
        }
      }
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }

  // 3. Packaged DSH Desktop auto-discovery fallback
  const packaged = findPackagedDshDesktopCli(env, platform, homeDir);
  if (packaged) {
    const asarMatch = /^(.*?[\\/]app\.asar)(?:[\\/]|$)/i.exec(packaged.bootstrapPath);
    if (asarMatch?.[1]) {
      const version = readDshVersionFromAsarOrAppDirSync(asarMatch[1]);
      if (version) return version;
    }
  }

  return null;
}

function hasAsarEntrySync(asarPath: string, relativeEntry: string): boolean {
  const directPath = join(asarPath, ...relativeEntry.split("/"));
  if (isExistingFile(directPath)) {
    return true;
  }
  if (!isExistingFile(asarPath)) {
    return false;
  }
  let fd: number | undefined;
  try {
    fd = openSync(asarPath, "r");
    const prefix = Buffer.alloc(16);
    if (readSync(fd, prefix, 0, 16, 0) < 16) return false;
    const jsonSize = prefix.readUInt32LE(12);
    if (jsonSize === 0 || jsonSize > 64 * 1024 * 1024) return false;
    const jsonBuffer = Buffer.alloc(jsonSize);
    if (readSync(fd, jsonBuffer, 0, jsonSize, 16) < jsonSize) return false;
    const parsed = JSON.parse(jsonBuffer.toString("utf8")) as {
      files?: Record<string, unknown>;
    };
    let cursor: unknown = parsed;
    for (const segment of relativeEntry.split("/")) {
      if (cursor === null || typeof cursor !== "object" || !("files" in cursor)) {
        return false;
      }
      const files = (cursor as { files?: Record<string, unknown> }).files;
      if (!files || !Object.hasOwn(files, segment)) {
        return false;
      }
      cursor = files[segment];
    }
    return cursor !== null && typeof cursor === "object" && !("files" in cursor);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore close failure
      }
    }
  }
}

const WINDOWS_UNINSTALL_REGISTRY_KEYS = [
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
] as const;

const WINDOWS_COMMON_DRIVES = ["C:", "D:", "E:", "F:"] as const;
const WINDOWS_DSH_DRIVE_SUBDIRS = [
  "DSH NEXT",
  "Program Files\\DSH NEXT",
  "Programs\\DSH NEXT",
  "DeepSeek Harness",
  "Program Files\\DeepSeek Harness",
  "Programs\\DeepSeek Harness",
  "DSH"
] as const;
const WINDOWS_UNINSTALLER_EXE_RE = /(?:uninstall|uninst|setup|update|squirrel)/i;
const DSH_UNINSTALL_MATCH_RE = /\b(?:dsh(?:\s+next)?|deepseek\s+harness)\b/i;
const ANTIGRAVITY_UNINSTALL_MATCH_RE = /^(?:google\s+)?antigravity(?:\s|$)/i;

interface DaemonWindowsUninstallEntry {
  readonly subkey: string;
  readonly displayName?: string;
  readonly installLocation?: string;
  readonly uninstallString?: string;
  readonly quietUninstallString?: string;
  readonly displayIcon?: string;
  readonly comments?: string;
}

export type DaemonWindowsRegistryQueryRunner = (
  args: readonly string[]
) => string | undefined;

function runWindowsUninstallRegQuery(args: readonly string[]): string | undefined {
  try {
    const raw = execFileSync("reg.exe", [...args], {
      timeout: 1_500,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return decodeWindowsProcessOutput(raw);
  } catch {
    return undefined;
  }
}

async function runWindowsUninstallRegQueryAsync(
  args: readonly string[]
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("reg.exe", [...args], {
      timeout: 1_500,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "buffer"
    });
    return decodeWindowsProcessOutput(stdout);
  } catch {
    return undefined;
  }
}

async function isExistingFileAsync(filePath: string): Promise<boolean> {
  try {
    const st = await statAsync(filePath);
    return st.isFile();
  } catch {
    return false;
  }
}

async function pathExistsAsync(targetPath: string): Promise<boolean> {
  try {
    await statAsync(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function hasAsarEntryAsync(
  asarPath: string,
  relativeEntry: string
): Promise<boolean> {
  const directPath = join(asarPath, ...relativeEntry.split("/"));
  if (await isExistingFileAsync(directPath)) {
    return true;
  }
  if (!(await isExistingFileAsync(asarPath))) {
    return false;
  }
  let handle: Awaited<ReturnType<typeof openFileAsync>> | undefined;
  try {
    handle = await openFileAsync(asarPath, "r");
    const prefix = Buffer.alloc(16);
    const prefixRead = await handle.read(prefix, 0, 16, 0);
    if (prefixRead.bytesRead < 16) return false;
    const jsonSize = prefix.readUInt32LE(12);
    if (jsonSize === 0 || jsonSize > 64 * 1024 * 1024) return false;
    const jsonBuffer = Buffer.alloc(jsonSize);
    const jsonRead = await handle.read(jsonBuffer, 0, jsonSize, 16);
    if (jsonRead.bytesRead < jsonSize) return false;
    const parsed = JSON.parse(jsonBuffer.toString("utf8")) as {
      files?: Record<string, unknown>;
    };
    return lookupAsarEntryInHeader(parsed, relativeEntry) !== null;
  } catch {
    return false;
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // ignore close failure
      }
    }
  }
}

function normalizeWinInstallDir(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^"+|"+$/g, "").replace(/\//g, "\\");
  if (!/^[A-Za-z]:\\/.test(cleaned)) return null;
  const trimmed = cleaned.length > 3 ? cleaned.replace(/\\+$/, "") : cleaned;
  if (/^[A-Za-z]:\\Windows\\(?:System32|SysWOW64)$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function extractDirFromWinCommandOrIcon(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  let candidatePath: string | null = null;
  if (trimmed.startsWith('"')) {
    const endQuote = trimmed.indexOf('"', 1);
    if (endQuote > 1) {
      candidatePath = trimmed.slice(1, endQuote).trim();
    }
  }
  if (!candidatePath) {
    const exeMatch = /^([A-Za-z]:[\\/][^"<>|*?\r\n]+?\.(?:exe|cmd|bat|ico))(?:,|\s|$)/i.exec(
      trimmed
    );
    candidatePath = exeMatch?.[1]?.trim() ?? null;
  }
  if (!candidatePath) {
    const cleaned = trimmed.replace(/,-?\d+$/, "").replace(/^"+|"+$/g, "").trim();
    if (/^[A-Za-z]:[\\/]/.test(cleaned)) {
      candidatePath = cleaned;
    }
  }
  if (!candidatePath || /\bmsiexec(?:\.exe)?$/i.test(candidatePath)) return null;
  const normalized = candidatePath.replace(/,-?\d+$/, "").replace(/\//g, "\\");
  if (/\.(?:exe|cmd|bat|ico|dll|lnk)$/i.test(normalized)) {
    return normalizeWinInstallDir(dirname(normalized));
  }
  return normalizeWinInstallDir(normalized);
}

function parseDaemonUninstallRegOutput(stdout: string): DaemonWindowsUninstallEntry[] {
  const entries = new Map<string, { subkey: string; values: Record<string, string> }>();
  let currentSubkey: string | null = null;
  const valueLineRe = /^\s{2,}(.+?)\s{4,}(REG_[A-Z0-9_]+)(?:\s{4,}(.*))?$/;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || /^End of search:/i.test(trimmed)) continue;
    if (/^HKEY_[A-Z_]+\\/.test(trimmed)) {
      currentSubkey = trimmed;
      const key = trimmed.toLowerCase();
      if (!entries.has(key)) {
        entries.set(key, { subkey: trimmed, values: {} });
      }
      continue;
    }
    if (!currentSubkey) continue;
    const match = valueLineRe.exec(rawLine);
    if (!match) continue;
    const name = match[1]?.trim().toLowerCase() ?? "";
    const type = match[2]?.trim() ?? "";
    const value = (match[3] ?? "").trim();
    if (!name || (type !== "REG_SZ" && type !== "REG_EXPAND_SZ") || !value) continue;
    const bucket = entries.get(currentSubkey.toLowerCase());
    if (bucket) bucket.values[name] = value;
  }
  return Array.from(entries.values()).map(({ subkey, values }) => ({
    subkey,
    ...(values["displayname"] ? { displayName: values["displayname"] } : {}),
    ...(values["installlocation"] ? { installLocation: values["installlocation"] } : {}),
    ...(values["uninstallstring"] ? { uninstallString: values["uninstallstring"] } : {}),
    ...(values["quietuninstallstring"]
      ? { quietUninstallString: values["quietuninstallstring"] }
      : {}),
    ...(values["displayicon"] ? { displayIcon: values["displayicon"] } : {}),
    ...(values["comments"] ? { comments: values["comments"] } : {})
  }));
}

function mergeDaemonUninstallEntry(
  base: DaemonWindowsUninstallEntry,
  incoming: DaemonWindowsUninstallEntry
): DaemonWindowsUninstallEntry {
  return {
    subkey: base.subkey,
    ...(incoming.displayName ?? base.displayName
      ? { displayName: incoming.displayName ?? base.displayName }
      : {}),
    ...(incoming.installLocation ?? base.installLocation
      ? { installLocation: incoming.installLocation ?? base.installLocation }
      : {}),
    ...(incoming.uninstallString ?? base.uninstallString
      ? { uninstallString: incoming.uninstallString ?? base.uninstallString }
      : {}),
    ...(incoming.quietUninstallString ?? base.quietUninstallString
      ? { quietUninstallString: incoming.quietUninstallString ?? base.quietUninstallString }
      : {}),
    ...(incoming.displayIcon ?? base.displayIcon
      ? { displayIcon: incoming.displayIcon ?? base.displayIcon }
      : {}),
    ...(incoming.comments ?? base.comments
      ? { comments: incoming.comments ?? base.comments }
      : {})
  };
}

function discoverWindowsUninstallInstallDirsSync(options: {
  cacheKey: string;
  searchTerms: readonly string[];
  matchEntry: (entry: DaemonWindowsUninstallEntry) => boolean;
  queryRegistry?: DaemonWindowsRegistryQueryRunner;
  bypassCache?: boolean;
}): readonly string[] {
  const useCache =
    options.queryRegistry === undefined && options.bypassCache !== true;
  if (useCache) {
    const cached = getTtlCached(daemonUninstallDirsCache, options.cacheKey);
    if (cached.hit) return cached.value;
  }

  const runQuery = options.queryRegistry ?? runWindowsUninstallRegQuery;
  const bySubkey = new Map<string, DaemonWindowsUninstallEntry>();

  for (const rootKey of WINDOWS_UNINSTALL_REGISTRY_KEYS) {
    for (const term of options.searchTerms) {
      const stdout = runQuery(["query", rootKey, "/s", "/d", "/f", term]);
      if (!stdout) continue;
      for (const parsed of parseDaemonUninstallRegOutput(stdout)) {
        const key = parsed.subkey.toLowerCase();
        const existing = bySubkey.get(key);
        bySubkey.set(key, existing ? mergeDaemonUninstallEntry(existing, parsed) : parsed);
      }
    }
  }

  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const [key, partial] of bySubkey.entries()) {
    let complete = partial;
    const hasPathSignal =
      complete.installLocation !== undefined ||
      complete.uninstallString !== undefined ||
      complete.quietUninstallString !== undefined ||
      complete.displayIcon !== undefined;
    if (!hasPathSignal || complete.displayName === undefined) {
      const fullOut = runQuery(["query", complete.subkey]);
      if (fullOut) {
        const exact = parseDaemonUninstallRegOutput(fullOut).find(
          (entry) => entry.subkey.toLowerCase() === key
        );
        if (exact) complete = mergeDaemonUninstallEntry(complete, exact);
      }
    }
    if (!options.matchEntry(complete)) continue;
    for (const candidate of [
      normalizeWinInstallDir(complete.installLocation),
      extractDirFromWinCommandOrIcon(complete.uninstallString),
      extractDirFromWinCommandOrIcon(complete.quietUninstallString),
      extractDirFromWinCommandOrIcon(complete.displayIcon)
    ]) {
      if (!candidate) continue;
      const lower = candidate.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      dirs.push(candidate);
    }
  }

  if (useCache) {
    setTtlCached(daemonUninstallDirsCache, options.cacheKey, dirs, dirs.length > 0);
  }
  return dirs;
}

async function discoverWindowsUninstallInstallDirsAsync(options: {
  cacheKey: string;
  searchTerms: readonly string[];
  matchEntry: (entry: DaemonWindowsUninstallEntry) => boolean;
  queryRegistry?: DaemonWindowsRegistryQueryRunner;
  bypassCache?: boolean;
}): Promise<readonly string[]> {
  const useCache =
    options.queryRegistry === undefined && options.bypassCache !== true;
  if (useCache) {
    const cached = getTtlCached(daemonUninstallDirsCache, options.cacheKey);
    if (cached.hit) return cached.value;
  }

  const runQuery = options.queryRegistry
    ? async (args: readonly string[]) => options.queryRegistry!(args)
    : runWindowsUninstallRegQueryAsync;
  const bySubkey = new Map<string, DaemonWindowsUninstallEntry>();

  const queries: Array<Promise<string | undefined>> = [];
  for (const rootKey of WINDOWS_UNINSTALL_REGISTRY_KEYS) {
    for (const term of options.searchTerms) {
      queries.push(runQuery(["query", rootKey, "/s", "/d", "/f", term]));
    }
  }
  const outputs = await Promise.all(queries);
  for (const stdout of outputs) {
    if (!stdout) continue;
    for (const parsed of parseDaemonUninstallRegOutput(stdout)) {
      const key = parsed.subkey.toLowerCase();
      const existing = bySubkey.get(key);
      bySubkey.set(key, existing ? mergeDaemonUninstallEntry(existing, parsed) : parsed);
    }
  }

  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const [key, partial] of bySubkey.entries()) {
    let complete = partial;
    const hasPathSignal =
      complete.installLocation !== undefined ||
      complete.uninstallString !== undefined ||
      complete.quietUninstallString !== undefined ||
      complete.displayIcon !== undefined;
    if (!hasPathSignal || complete.displayName === undefined) {
      const fullOut = await runQuery(["query", complete.subkey]);
      if (fullOut) {
        const exact = parseDaemonUninstallRegOutput(fullOut).find(
          (entry) => entry.subkey.toLowerCase() === key
        );
        if (exact) complete = mergeDaemonUninstallEntry(complete, exact);
      }
    }
    if (!options.matchEntry(complete)) continue;
    for (const candidate of [
      normalizeWinInstallDir(complete.installLocation),
      extractDirFromWinCommandOrIcon(complete.uninstallString),
      extractDirFromWinCommandOrIcon(complete.quietUninstallString),
      extractDirFromWinCommandOrIcon(complete.displayIcon)
    ]) {
      if (!candidate) continue;
      const lower = candidate.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      dirs.push(candidate);
    }
  }

  if (useCache) {
    setTtlCached(daemonUninstallDirsCache, options.cacheKey, dirs, dirs.length > 0);
  }
  return dirs;
}

function collectDshDirExecutableCandidatesSync(installDir: string): string[] {
  const candidates: string[] = [];
  for (const candidate of WINDOWS_DSH_DESKTOP_CANDIDATES) {
    candidates.push(join(installDir, candidate.executable));
  }
  try {
    if (existsSync(installDir)) {
      for (const name of readdirSync(installDir)) {
        if (!/\.exe$/i.test(name) || WINDOWS_UNINSTALLER_EXE_RE.test(name)) continue;
        candidates.push(join(installDir, name));
      }
    }
  } catch {
    // ignore unreadable directory
  }
  return candidates;
}

async function collectDshDirExecutableCandidatesAsync(
  installDir: string
): Promise<string[]> {
  const candidates: string[] = [];
  for (const candidate of WINDOWS_DSH_DESKTOP_CANDIDATES) {
    candidates.push(join(installDir, candidate.executable));
  }
  try {
    const names = await readdirAsync(installDir);
    for (const name of names) {
      if (!/\.exe$/i.test(name) || WINDOWS_UNINSTALLER_EXE_RE.test(name)) continue;
      candidates.push(join(installDir, name));
    }
  } catch {
    // ignore unreadable directory
  }
  return candidates;
}

function buildDshDiscoveryCacheKey(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  homeDir: string,
  scanRegistry: boolean,
  shouldScanDriveRoots: boolean
): string {
  const readEnv = (k: string) => readEnvCaseInsensitive(env, k, platform) ?? "";
  return [
    platform,
    homeDir,
    scanRegistry ? "reg1" : "reg0",
    shouldScanDriveRoots ? "deep1" : "deep0",
    readEnv("DSH_DESKTOP_APP_EXECUTABLE"),
    readEnv("DSH_DESKTOP_DSH_BOOTSTRAP"),
    readEnv("USERPROFILE"),
    readEnv("LOCALAPPDATA"),
    readEnv("ProgramFiles"),
    readEnv("ProgramFiles(x86)"),
    readEnv("HOME")
  ].join("|");
}

function buildAgyDiscoveryCacheKey(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  homeDir: string,
  scanRegistry: boolean,
  shouldScanDriveRoots: boolean
): string {
  const readEnv = (k: string) => readEnvCaseInsensitive(env, k, platform) ?? "";
  return [
    platform,
    homeDir,
    scanRegistry ? "reg1" : "reg0",
    shouldScanDriveRoots ? "deep1" : "deep0",
    readEnv("USERPROFILE"),
    readEnv("LOCALAPPDATA"),
    readEnv("ProgramFiles"),
    readEnv("ProgramFiles(x86)"),
    readEnv("HOME")
  ].join("|");
}

export function findPackagedDshDesktopCli(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = homedir(),
  options: {
    queryRegistry?: DaemonWindowsRegistryQueryRunner;
    scanRegistry?: boolean;
    scanDriveRoots?: boolean;
    deepScan?: boolean;
    bypassCache?: boolean;
  } = {}
): { executablePath: string; bootstrapPath: string } | null {
  const scanRegistry = options.scanRegistry !== false;
  const shouldScanDriveRoots =
    options.deepScan === true || options.scanDriveRoots === true;
  const useCache =
    options.queryRegistry === undefined && options.bypassCache !== true;
  const cacheKey = useCache
    ? buildDshDiscoveryCacheKey(env, platform, homeDir, scanRegistry, shouldScanDriveRoots)
    : "";
  if (useCache) {
    const cached = getTtlCached(packagedDshCache, cacheKey);
    if (cached.hit) return cached.value;
  }

  const readEnv = (key: string): string | undefined =>
    readEnvCaseInsensitive(env, key, platform);

  const explicitApp = readEnv("DSH_DESKTOP_APP_EXECUTABLE");
  const explicitBootstrap = readEnv("DSH_DESKTOP_DSH_BOOTSTRAP");
  if (explicitApp && explicitBootstrap && isExistingFile(explicitApp)) {
    const found = { executablePath: explicitApp, bootstrapPath: explicitBootstrap };
    if (useCache) setTtlCached(packagedDshCache, cacheKey, found, true);
    return found;
  }

  const candidateExes: string[] = [];
  if (platform === "win32") {
    const userProfile = readEnv("USERPROFILE") || homeDir;
    const localAppData = readEnv("LOCALAPPDATA") || join(userProfile, "AppData", "Local");
    const programFiles = readEnv("ProgramFiles");
    const programFilesX86 = readEnv("ProgramFiles(x86)");
    const roots = [
      join(localAppData, "Programs"),
      localAppData,
      ...(programFiles ? [programFiles] : []),
      ...(programFilesX86 ? [programFilesX86] : [])
    ];
    for (const root of roots) {
      for (const candidate of WINDOWS_DSH_DESKTOP_CANDIDATES) {
        candidateExes.push(join(root, candidate.folder, candidate.executable));
      }
    }

    if (scanRegistry) {
      const registryDirs = discoverWindowsUninstallInstallDirsSync({
        cacheKey: "dsh",
        searchTerms: ["DSH", "DeepSeek"],
        matchEntry: (entry) =>
          DSH_UNINSTALL_MATCH_RE.test(entry.displayName ?? "") ||
          DSH_UNINSTALL_MATCH_RE.test(entry.comments ?? "") ||
          DSH_UNINSTALL_MATCH_RE.test(entry.uninstallString ?? "") ||
          DSH_UNINSTALL_MATCH_RE.test(entry.displayIcon ?? ""),
        ...(options.queryRegistry ? { queryRegistry: options.queryRegistry } : {}),
        ...(options.bypassCache ? { bypassCache: true } : {})
      });
      for (const dir of registryDirs) {
        candidateExes.push(...collectDshDirExecutableCandidatesSync(dir));
      }
    }

    if (shouldScanDriveRoots) {
      for (const drive of WINDOWS_COMMON_DRIVES) {
        for (const subdir of WINDOWS_DSH_DRIVE_SUBDIRS) {
          const dir = `${drive}\\${subdir}`;
          if (existsSync(dir)) {
            candidateExes.push(...collectDshDirExecutableCandidatesSync(dir));
          }
        }
      }
    }
  } else if (platform === "darwin") {
    const home = readEnv("HOME") || homeDir;
    for (const root of ["/Applications", join(home, "Applications")]) {
      for (const candidate of MACOS_DSH_DESKTOP_CANDIDATES) {
        candidateExes.push(
          join(root, candidate.bundle, "Contents", "MacOS", candidate.executable)
        );
      }
    }
  }

  const seen = new Set<string>();
  for (const executablePath of candidateExes) {
    const dedupeKey = platform === "win32" ? executablePath.toLowerCase() : executablePath;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    if (!isExistingFile(executablePath)) continue;
    const appDir = dirname(executablePath);
    const asarPath =
      platform === "darwin"
        ? resolve(appDir, "..", "Resources", "app.asar")
        : join(appDir, "resources", "app.asar");
    for (const entry of DSH_ASAR_BOOTSTRAP_ENTRIES) {
      if (hasAsarEntrySync(asarPath, entry)) {
        const found = {
          executablePath,
          bootstrapPath: join(asarPath, ...entry.split("/"))
        };
        if (useCache) setTtlCached(packagedDshCache, cacheKey, found, true);
        return found;
      }
    }
  }

  if (useCache) setTtlCached(packagedDshCache, cacheKey, null, false);
  return null;
}

export async function findPackagedDshDesktopCliAsync(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = homedir(),
  options: {
    queryRegistry?: DaemonWindowsRegistryQueryRunner;
    scanRegistry?: boolean;
    scanDriveRoots?: boolean;
    deepScan?: boolean;
    bypassCache?: boolean;
  } = {}
): Promise<{ executablePath: string; bootstrapPath: string } | null> {
  const scanRegistry = options.scanRegistry !== false;
  const shouldScanDriveRoots =
    options.deepScan === true || options.scanDriveRoots === true;
  const useCache =
    options.queryRegistry === undefined && options.bypassCache !== true;
  const cacheKey = useCache
    ? buildDshDiscoveryCacheKey(env, platform, homeDir, scanRegistry, shouldScanDriveRoots)
    : "";
  if (useCache) {
    const cached = getTtlCached(packagedDshCache, cacheKey);
    if (cached.hit) return cached.value;
  }

  const readEnv = (key: string): string | undefined =>
    readEnvCaseInsensitive(env, key, platform);

  const explicitApp = readEnv("DSH_DESKTOP_APP_EXECUTABLE");
  const explicitBootstrap = readEnv("DSH_DESKTOP_DSH_BOOTSTRAP");
  if (explicitApp && explicitBootstrap && (await isExistingFileAsync(explicitApp))) {
    const found = { executablePath: explicitApp, bootstrapPath: explicitBootstrap };
    if (useCache) setTtlCached(packagedDshCache, cacheKey, found, true);
    return found;
  }

  const candidateExes: string[] = [];
  if (platform === "win32") {
    const userProfile = readEnv("USERPROFILE") || homeDir;
    const localAppData = readEnv("LOCALAPPDATA") || join(userProfile, "AppData", "Local");
    const programFiles = readEnv("ProgramFiles");
    const programFilesX86 = readEnv("ProgramFiles(x86)");
    const roots = [
      join(localAppData, "Programs"),
      localAppData,
      ...(programFiles ? [programFiles] : []),
      ...(programFilesX86 ? [programFilesX86] : [])
    ];
    for (const root of roots) {
      for (const candidate of WINDOWS_DSH_DESKTOP_CANDIDATES) {
        candidateExes.push(join(root, candidate.folder, candidate.executable));
      }
    }

    if (scanRegistry) {
      const registryDirs = await discoverWindowsUninstallInstallDirsAsync({
        cacheKey: "dsh",
        searchTerms: ["DSH", "DeepSeek"],
        matchEntry: (entry) =>
          DSH_UNINSTALL_MATCH_RE.test(entry.displayName ?? "") ||
          DSH_UNINSTALL_MATCH_RE.test(entry.comments ?? "") ||
          DSH_UNINSTALL_MATCH_RE.test(entry.uninstallString ?? "") ||
          DSH_UNINSTALL_MATCH_RE.test(entry.displayIcon ?? ""),
        ...(options.queryRegistry ? { queryRegistry: options.queryRegistry } : {}),
        ...(options.bypassCache ? { bypassCache: true } : {})
      });
      for (const dir of registryDirs) {
        candidateExes.push(...(await collectDshDirExecutableCandidatesAsync(dir)));
      }
    }

    if (shouldScanDriveRoots) {
      for (const drive of WINDOWS_COMMON_DRIVES) {
        for (const subdir of WINDOWS_DSH_DRIVE_SUBDIRS) {
          const dir = `${drive}\\${subdir}`;
          if (await pathExistsAsync(dir)) {
            candidateExes.push(...(await collectDshDirExecutableCandidatesAsync(dir)));
          }
        }
      }
    }
  } else if (platform === "darwin") {
    const home = readEnv("HOME") || homeDir;
    for (const root of ["/Applications", join(home, "Applications")]) {
      for (const candidate of MACOS_DSH_DESKTOP_CANDIDATES) {
        candidateExes.push(
          join(root, candidate.bundle, "Contents", "MacOS", candidate.executable)
        );
      }
    }
  }

  const seen = new Set<string>();
  for (const executablePath of candidateExes) {
    const dedupeKey = platform === "win32" ? executablePath.toLowerCase() : executablePath;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    if (!(await isExistingFileAsync(executablePath))) continue;
    const appDir = dirname(executablePath);
    const asarPath =
      platform === "darwin"
        ? resolve(appDir, "..", "Resources", "app.asar")
        : join(appDir, "resources", "app.asar");
    for (const entry of DSH_ASAR_BOOTSTRAP_ENTRIES) {
      if (await hasAsarEntryAsync(asarPath, entry)) {
        const found = {
          executablePath,
          bootstrapPath: join(asarPath, ...entry.split("/"))
        };
        if (useCache) setTtlCached(packagedDshCache, cacheKey, found, true);
        return found;
      }
    }
  }

  if (useCache) setTtlCached(packagedDshCache, cacheKey, null, false);
  return null;
}

export function findPackagedAntigravityCli(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = homedir(),
  options: {
    queryRegistry?: DaemonWindowsRegistryQueryRunner;
    scanRegistry?: boolean;
    scanDriveRoots?: boolean;
    deepScan?: boolean;
    bypassCache?: boolean;
  } = {}
): string | null {
  const scanRegistry = options.scanRegistry !== false;
  const shouldScanDriveRoots =
    options.deepScan === true || options.scanDriveRoots === true;
  const useCache =
    options.queryRegistry === undefined && options.bypassCache !== true;
  const cacheKey = useCache
    ? buildAgyDiscoveryCacheKey(env, platform, homeDir, scanRegistry, shouldScanDriveRoots)
    : "";
  if (useCache) {
    const cached = getTtlCached(packagedAgyCache, cacheKey);
    if (cached.hit) return cached.value;
  }

  if (platform !== "win32") {
    const home = readEnvCaseInsensitive(env, "HOME", platform) || homeDir;
    for (const candidate of [
      join(home, ".antigravity", "bin", "agy"),
      join(home, ".local", "bin", "agy"),
      "/opt/homebrew/bin/agy",
      "/usr/local/bin/agy"
    ]) {
      if (isExistingFile(candidate)) {
        if (useCache) setTtlCached(packagedAgyCache, cacheKey, candidate, true);
        return candidate;
      }
    }
    if (useCache) setTtlCached(packagedAgyCache, cacheKey, null, false);
    return null;
  }

  const userProfile = readEnvCaseInsensitive(env, "USERPROFILE", platform) || homeDir;
  const localAppData =
    readEnvCaseInsensitive(env, "LOCALAPPDATA", platform) || join(userProfile, "AppData", "Local");
  const programFiles = readEnvCaseInsensitive(env, "ProgramFiles", platform);
  const programFilesX86 = readEnvCaseInsensitive(env, "ProgramFiles(x86)", platform);

  const candidateDirs: string[] = [
    join(localAppData, "agy", "bin"),
    join(userProfile, ".antigravity", "bin"),
    join(localAppData, "Programs", "antigravity", "bin"),
    join(localAppData, "Programs", "Antigravity"),
    ...(programFiles
      ? [join(programFiles, "Antigravity", "bin"), join(programFiles, "Antigravity")]
      : []),
    ...(programFilesX86
      ? [join(programFilesX86, "Antigravity", "bin"), join(programFilesX86, "Antigravity")]
      : [])
  ];

  if (scanRegistry) {
    const registryDirs = discoverWindowsUninstallInstallDirsSync({
      cacheKey: "antigravity",
      searchTerms: ["Antigravity"],
      matchEntry: (entry) =>
        entry.displayName !== undefined &&
        ANTIGRAVITY_UNINSTALL_MATCH_RE.test(entry.displayName.trim()),
      ...(options.queryRegistry ? { queryRegistry: options.queryRegistry } : {}),
      ...(options.bypassCache ? { bypassCache: true } : {})
    });
    for (const dir of registryDirs) {
      candidateDirs.push(join(dir, "bin"), dir, join(dir, "resources", "app", "bin"));
    }
  }

  if (shouldScanDriveRoots) {
    for (const drive of WINDOWS_COMMON_DRIVES) {
      candidateDirs.push(
        `${drive}\\Antigravity\\bin`,
        `${drive}\\Program Files\\Antigravity\\bin`,
        `${drive}\\Programs\\Antigravity\\bin`
      );
    }
  }

  const seen = new Set<string>();
  for (const dir of candidateDirs) {
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    for (const exe of ["agy.exe", "agy.cmd", "agy.bat"]) {
      const candidate = join(dir, exe);
      if (isExistingFile(candidate)) {
        if (useCache) setTtlCached(packagedAgyCache, cacheKey, candidate, true);
        return candidate;
      }
    }
  }
  if (useCache) setTtlCached(packagedAgyCache, cacheKey, null, false);
  return null;
}

export async function findPackagedAntigravityCliAsync(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = homedir(),
  options: {
    queryRegistry?: DaemonWindowsRegistryQueryRunner;
    scanRegistry?: boolean;
    scanDriveRoots?: boolean;
    deepScan?: boolean;
    bypassCache?: boolean;
  } = {}
): Promise<string | null> {
  const scanRegistry = options.scanRegistry !== false;
  const shouldScanDriveRoots =
    options.deepScan === true || options.scanDriveRoots === true;
  const useCache =
    options.queryRegistry === undefined && options.bypassCache !== true;
  const cacheKey = useCache
    ? buildAgyDiscoveryCacheKey(env, platform, homeDir, scanRegistry, shouldScanDriveRoots)
    : "";
  if (useCache) {
    const cached = getTtlCached(packagedAgyCache, cacheKey);
    if (cached.hit) return cached.value;
  }

  if (platform !== "win32") {
    const home = readEnvCaseInsensitive(env, "HOME", platform) || homeDir;
    for (const candidate of [
      join(home, ".antigravity", "bin", "agy"),
      join(home, ".local", "bin", "agy"),
      "/opt/homebrew/bin/agy",
      "/usr/local/bin/agy"
    ]) {
      if (await isExistingFileAsync(candidate)) {
        if (useCache) setTtlCached(packagedAgyCache, cacheKey, candidate, true);
        return candidate;
      }
    }
    if (useCache) setTtlCached(packagedAgyCache, cacheKey, null, false);
    return null;
  }

  const userProfile = readEnvCaseInsensitive(env, "USERPROFILE", platform) || homeDir;
  const localAppData =
    readEnvCaseInsensitive(env, "LOCALAPPDATA", platform) || join(userProfile, "AppData", "Local");
  const programFiles = readEnvCaseInsensitive(env, "ProgramFiles", platform);
  const programFilesX86 = readEnvCaseInsensitive(env, "ProgramFiles(x86)", platform);

  const candidateDirs: string[] = [
    join(localAppData, "agy", "bin"),
    join(userProfile, ".antigravity", "bin"),
    join(localAppData, "Programs", "antigravity", "bin"),
    join(localAppData, "Programs", "Antigravity"),
    ...(programFiles
      ? [join(programFiles, "Antigravity", "bin"), join(programFiles, "Antigravity")]
      : []),
    ...(programFilesX86
      ? [join(programFilesX86, "Antigravity", "bin"), join(programFilesX86, "Antigravity")]
      : [])
  ];

  if (scanRegistry) {
    const registryDirs = await discoverWindowsUninstallInstallDirsAsync({
      cacheKey: "antigravity",
      searchTerms: ["Antigravity"],
      matchEntry: (entry) =>
        entry.displayName !== undefined &&
        ANTIGRAVITY_UNINSTALL_MATCH_RE.test(entry.displayName.trim()),
      ...(options.queryRegistry ? { queryRegistry: options.queryRegistry } : {}),
      ...(options.bypassCache ? { bypassCache: true } : {})
    });
    for (const dir of registryDirs) {
      candidateDirs.push(join(dir, "bin"), dir, join(dir, "resources", "app", "bin"));
    }
  }

  if (shouldScanDriveRoots) {
    for (const drive of WINDOWS_COMMON_DRIVES) {
      candidateDirs.push(
        `${drive}\\Antigravity\\bin`,
        `${drive}\\Program Files\\Antigravity\\bin`,
        `${drive}\\Programs\\Antigravity\\bin`
      );
    }
  }

  const seen = new Set<string>();
  for (const dir of candidateDirs) {
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    for (const exe of ["agy.exe", "agy.cmd", "agy.bat"]) {
      const candidate = join(dir, exe);
      if (await isExistingFileAsync(candidate)) {
        if (useCache) setTtlCached(packagedAgyCache, cacheKey, candidate, true);
        return candidate;
      }
    }
  }
  if (useCache) setTtlCached(packagedAgyCache, cacheKey, null, false);
  return null;
}

export async function defaultCliProbe(
  command: string,
  args: string[],
  timeoutMs: number,
  options: {
    env?: Record<string, string | undefined>;
    platform?: NodeJS.Platform;
    includeFallbackDirs?: boolean;
    deepScan?: boolean;
    refresh?: boolean;
    bypassCache?: boolean;
  } = {}
): Promise<CliProbeResult> {
  const started = performance.now();
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const includeFallback = options.includeFallbackDirs !== false;
  const deepScan = options.deepScan === true;
  const useCache = options.refresh !== true && options.bypassCache !== true;
  const pathEnv = readEnvCaseInsensitive(env, "PATH", platform) ?? "";
  const probeCacheKey = useCache
    ? [
        platform,
        command.trim().toLowerCase(),
        args.join("\0"),
        includeFallback ? "fb1" : "fb0",
        deepScan ? "deep1" : "deep0",
        pathEnv,
        readEnvCaseInsensitive(env, "LOCALAPPDATA", platform) ?? "",
        readEnvCaseInsensitive(env, "USERPROFILE", platform) ?? ""
      ].join("|")
    : "";

  if (useCache) {
    const cached = getTtlCached(cliProbeCache, probeCacheKey);
    if (cached.hit) {
      return { ...cached.value };
    }
  }

  const storeAndReturn = (result: CliProbeResult): CliProbeResult => {
    if (useCache) {
      setTtlCached(
        cliProbeCache,
        probeCacheKey,
        result,
        result.found && !result.error
      );
    }
    return result;
  };

  const extraDirs = includeFallback ? getDefaultCliExtraDirs(env, platform) : [];
  let located = findExecutableOnPath([command], {
    env,
    platform,
    extraDirs
  });
  if (!located && command.trim().toLowerCase() === "agy" && includeFallback) {
    located = await findPackagedAntigravityCliAsync(env, platform, homedir(), {
      deepScan,
      bypassCache: options.refresh === true || options.bypassCache === true
    });
  }
  if (!located) {
    if (command.trim().toLowerCase() === "dsh" && includeFallback) {
      const packagedDsh = await findPackagedDshDesktopCliAsync(env, platform, homedir(), {
        deepScan,
        bypassCache: options.refresh === true || options.bypassCache === true
      });
      if (packagedDsh) {
        const fastVersion = resolveDshInstalledVersionFastSync({
          binaryPath: packagedDsh.executablePath,
          bootstrapPath: packagedDsh.bootstrapPath,
          env,
          platform
        });
        if (fastVersion) {
          return storeAndReturn({
            found: true,
            path: packagedDsh.executablePath,
            version: fastVersion,
            latencyMs: Math.max(0, Math.round(performance.now() - started))
          });
        }
        const dshEnv: Record<string, string | undefined> = {};
        for (const [key, value] of Object.entries(env)) {
          const upper = key.toUpperCase();
          if (upper === "ELECTRON_RUN_AS_NODE" || upper === "DSH_DESKTOP_DEFAULT_PROFILE") {
            continue;
          }
          dshEnv[key] = value;
        }
        dshEnv["ELECTRON_RUN_AS_NODE"] = "1";
        try {
          const result = await execFileAsync(
            packagedDsh.executablePath,
            ["--expose-internals", packagedDsh.bootstrapPath, ...args],
            {
              timeout: timeoutMs,
              windowsHide: true,
              maxBuffer: 512 * 1024,
              env: dshEnv
            }
          );
          const combined = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`;
          return storeAndReturn({
            found: true,
            path: packagedDsh.executablePath,
            version: extractFirstVersionLine(combined),
            latencyMs: Math.max(0, Math.round(performance.now() - started))
          });
        } catch (err) {
          return storeAndReturn({
            found: true,
            path: packagedDsh.executablePath,
            version: null,
            latencyMs: Math.max(0, Math.round(performance.now() - started)),
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    }
    return storeAndReturn({
      found: false,
      path: null,
      version: null,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      error: `PATH 中未找到 ${command}`
    });
  }

  try {
    const { stdout, stderr } = await execSafeCli(located, args, timeoutMs, {
      env,
      platform
    });
    const combined = `${stdout}\n${stderr}`;
    let version = extractFirstVersionLine(combined);
    if (command.trim().toLowerCase() === "dsh" && isPlaceholderDshVersion(version)) {
      const fastVersion = resolveDshInstalledVersionFastSync({
        binaryPath: located,
        env,
        platform
      });
      if (fastVersion) {
        version = fastVersion;
      }
    }
    return storeAndReturn({
      found: true,
      path: located,
      version,
      latencyMs: Math.max(0, Math.round(performance.now() - started))
    });
  } catch (err) {
    if (command.trim().toLowerCase() === "dsh") {
      const fastVersion = resolveDshInstalledVersionFastSync({
        binaryPath: located,
        env,
        platform
      });
      if (fastVersion) {
        return storeAndReturn({
          found: true,
          path: located,
          version: fastVersion,
          latencyMs: Math.max(0, Math.round(performance.now() - started))
        });
      }
    }
    return storeAndReturn({
      found: true,
      path: located,
      version: null,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Converts a T3 Server URL (HTTP/HTTPS or WS/WSS, including `/ws` or `/rpc`
 * paths) into an HTTP/HTTPS endpoint suitable for lightweight liveness probing.
 */
export function normalizeCoreHttpProbeUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "ws:") {
      parsed.protocol = "http:";
    } else if (parsed.protocol === "wss:") {
      parsed.protocol = "https:";
    } else if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const lowerPath = parsed.pathname.toLowerCase();
    if (
      lowerPath === "/ws" ||
      lowerPath === "/ws/" ||
      lowerPath === "/rpc" ||
      lowerPath === "/rpc/"
    ) {
      parsed.pathname = "/";
      parsed.search = "";
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

async function defaultNetworkProbe(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
  method: "HEAD" | "GET" = "HEAD"
): Promise<NetworkProbeResult> {
  const started = performance.now();
  return new Promise<NetworkProbeResult>((resolvePromise) => {
    let settled = false;
    const done = (result: NetworkProbeResult) => {
      if (!settled) {
        settled = true;
        resolvePromise(result);
      }
    };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      done({
        reachable: false,
        statusCode: null,
        latencyMs: null,
        error: `无效 URL: ${url}`
      });
      return;
    }

    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(
      parsed,
      {
        method,
        agent: false,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; Prismux-Diagnostics/0.1)",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          connection: "close",
          ...headers
        }
      },
      (res) => {
        res.resume();
        const statusCode = res.statusCode ?? 0;
        const latencyMs = Math.max(0, Math.round(performance.now() - started));
        // 2xx, 3xx, or 405 (method not allowed on HEAD) still confirms endpoint reachability.
        const reachable =
          (statusCode >= 200 && statusCode < 400) || statusCode === 405;
        done({
          reachable,
          statusCode,
          latencyMs,
          ...(reachable ? {} : { error: `HTTP ${statusCode}` })
        });
      }
    );

    const timer = setTimeout(() => {
      req.destroy(new Error(`请求超时（>${timeoutMs}ms）`));
    }, timeoutMs);
    timer.unref?.();

    req.on("error", (err) => {
      clearTimeout(timer);
      done({
        reachable: false,
        statusCode: null,
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
        error: err.message
      });
    });

    req.on("close", () => {
      clearTimeout(timer);
    });

    req.end();
  });
}

function isExistingFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function inferAndroidSdkRootFromAdb(adbPath: string): string | null {
  const parentDir = dirname(adbPath);
  if (basename(parentDir).toLowerCase() === "platform-tools") {
    return dirname(parentDir);
  }
  return null;
}

function scanWinGetPlatformToolsCandidates(localAppData: string): string[] {
  const packagesDir = join(localAppData, "Microsoft", "WinGet", "Packages");
  const candidates: string[] = [];
  try {
    if (!existsSync(packagesDir)) {
      return candidates;
    }
    const entries = readdirSync(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (/^google\.platformtools/i.test(entry.name)) {
        const pkgRoot = join(packagesDir, entry.name);
        candidates.push(join(pkgRoot, "platform-tools", "adb.exe"));
        candidates.push(join(pkgRoot, "adb.exe"));
      }
    }
  } catch {
    // ignore inaccessible WinGet package directories
  }
  return candidates;
}

async function scanWinGetPlatformToolsCandidatesAsync(
  localAppData: string
): Promise<string[]> {
  const packagesDir = join(localAppData, "Microsoft", "WinGet", "Packages");
  const candidates: string[] = [];
  try {
    const entries = await readdirAsync(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (/^google\.platformtools/i.test(entry.name)) {
        const pkgRoot = join(packagesDir, entry.name);
        candidates.push(join(pkgRoot, "platform-tools", "adb.exe"));
        candidates.push(join(pkgRoot, "adb.exe"));
      }
    }
  } catch {
    // ignore inaccessible WinGet package directories
  }
  return candidates;
}

function buildAndroidSdkCacheKey(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  homeDir: string,
  scanWellKnownDirs: boolean,
  deepScan: boolean
): string {
  const readEnv = (k: string) => readEnvCaseInsensitive(env, k, platform) ?? "";
  return [
    platform,
    homeDir,
    scanWellKnownDirs ? "wk1" : "wk0",
    deepScan ? "deep1" : "deep0",
    readEnv("ANDROID_HOME"),
    readEnv("ANDROID_SDK_ROOT"),
    readEnv("PATH"),
    readEnv("USERPROFILE"),
    readEnv("LOCALAPPDATA")
  ].join("|");
}

export function defaultDetectAndroidSdk(
  options: {
    env?: Record<string, string | undefined>;
    platform?: NodeJS.Platform;
    homeDir?: string;
    scanWellKnownDirs?: boolean;
    deepScan?: boolean;
    bypassCache?: boolean;
  } = {}
): {
  sdkRoot: string | null;
  adbPath: string | null;
} {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();
  const scanWellKnownDirs = options.scanWellKnownDirs !== false;
  const deepScan = options.deepScan === true;
  const useCache = options.bypassCache !== true;
  const cacheKey = useCache
    ? buildAndroidSdkCacheKey(env, platform, homeDir, scanWellKnownDirs, deepScan)
    : "";
  if (useCache) {
    const cached = getTtlCached(androidSdkCache, cacheKey);
    if (cached.hit) return { ...cached.value };
  }
  const finish = (result: { sdkRoot: string | null; adbPath: string | null }) => {
    if (useCache) {
      setTtlCached(
        androidSdkCache,
        cacheKey,
        result,
        result.adbPath !== null || result.sdkRoot !== null
      );
    }
    return result;
  };

  const adbBin = platform === "win32" ? "adb.exe" : "adb";

  const envCandidates: string[] = [];
  const envHome = env["ANDROID_HOME"]?.trim();
  const envSdkRoot = env["ANDROID_SDK_ROOT"]?.trim();
  if (envHome) envCandidates.push(resolve(envHome));
  if (envSdkRoot) envCandidates.push(resolve(envSdkRoot));

  let sdkRoot: string | null = null;

  // 1. Explicit ANDROID_HOME / ANDROID_SDK_ROOT (supports both SDK root and direct platform-tools dir)
  for (const dir of envCandidates) {
    if (!existsSync(dir)) {
      continue;
    }
    if (sdkRoot === null) {
      sdkRoot =
        basename(dir).toLowerCase() === "platform-tools" ? dirname(dir) : dir;
    }
    const nestedAdb = join(dir, "platform-tools", adbBin);
    if (isExistingFile(nestedAdb)) {
      return finish({ sdkRoot: dir, adbPath: nestedAdb });
    }
    const directAdb = join(dir, adbBin);
    if (isExistingFile(directAdb)) {
      return finish({
        sdkRoot: inferAndroidSdkRootFromAdb(directAdb) ?? sdkRoot,
        adbPath: directAdb
      });
    }
  }

  // 2. Refreshed PATH lookup (covers WinGet, Scoop, Chocolatey, Android Studio, custom PATH)
  const pathAdb = findExecutableOnPath([adbBin], { env, platform });
  if (pathAdb) {
    return finish({
      sdkRoot: sdkRoot ?? inferAndroidSdkRootFromAdb(pathAdb),
      adbPath: pathAdb
    });
  }

  if (!scanWellKnownDirs) {
    return finish({ sdkRoot, adbPath: null });
  }

  // 3. Env-derived SDK roots & Windows user package manager locations (drive-root scans require deepScan: true)
  const wellKnownRoots: string[] = [];
  const directAdbCandidates: string[] = [];

  if (platform === "win32") {
    const userProfile = env["USERPROFILE"]?.trim() || homeDir;
    const localAppData =
      env["LOCALAPPDATA"]?.trim() || join(userProfile, "AppData", "Local");
    wellKnownRoots.push(
      join(localAppData, "Android", "Sdk"),
      join(userProfile, "AppData", "Local", "Android", "Sdk")
    );
    directAdbCandidates.push(
      join(localAppData, "Microsoft", "WinGet", "Links", "adb.exe"),
      ...scanWinGetPlatformToolsCandidates(localAppData),
      join(userProfile, "scoop", "shims", "adb.exe"),
      join(userProfile, "scoop", "apps", "adb", "current", "platform-tools", "adb.exe")
    );
    if (deepScan) {
      wellKnownRoots.push("C:\\Android\\Sdk", "D:\\Android\\Sdk");
      directAdbCandidates.push(
        "C:\\ProgramData\\chocolatey\\bin\\adb.exe",
        "C:\\platform-tools\\adb.exe"
      );
    }
  } else if (platform === "darwin") {
    wellKnownRoots.push(
      join(homeDir, "Library", "Android", "sdk"),
      "/opt/homebrew/share/android-commandlinetools",
      "/usr/local/share/android-commandlinetools"
    );
  } else {
    wellKnownRoots.push(
      join(homeDir, "Android", "Sdk"),
      "/opt/android-sdk",
      "/usr/lib/android-sdk"
    );
  }

  for (const dir of wellKnownRoots) {
    if (!existsSync(dir)) {
      continue;
    }
    if (sdkRoot === null) {
      sdkRoot = dir;
    }
    const adbCandidate = join(dir, "platform-tools", adbBin);
    if (isExistingFile(adbCandidate)) {
      return finish({ sdkRoot: dir, adbPath: adbCandidate });
    }
  }

  for (const directAdb of directAdbCandidates) {
    if (isExistingFile(directAdb)) {
      return finish({
        sdkRoot: sdkRoot ?? inferAndroidSdkRootFromAdb(directAdb),
        adbPath: directAdb
      });
    }
  }

  return finish({ sdkRoot, adbPath: null });
}

export async function defaultDetectAndroidSdkAsync(
  options: {
    env?: Record<string, string | undefined>;
    platform?: NodeJS.Platform;
    homeDir?: string;
    scanWellKnownDirs?: boolean;
    deepScan?: boolean;
    bypassCache?: boolean;
  } = {}
): Promise<{
  sdkRoot: string | null;
  adbPath: string | null;
}> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();
  const scanWellKnownDirs = options.scanWellKnownDirs !== false;
  const deepScan = options.deepScan === true;
  const useCache = options.bypassCache !== true;
  const cacheKey = useCache
    ? buildAndroidSdkCacheKey(env, platform, homeDir, scanWellKnownDirs, deepScan)
    : "";
  if (useCache) {
    const cached = getTtlCached(androidSdkCache, cacheKey);
    if (cached.hit) return { ...cached.value };
  }
  const finish = (result: { sdkRoot: string | null; adbPath: string | null }) => {
    if (useCache) {
      setTtlCached(
        androidSdkCache,
        cacheKey,
        result,
        result.adbPath !== null || result.sdkRoot !== null
      );
    }
    return result;
  };

  const adbBin = platform === "win32" ? "adb.exe" : "adb";

  const envCandidates: string[] = [];
  const envHome = env["ANDROID_HOME"]?.trim();
  const envSdkRoot = env["ANDROID_SDK_ROOT"]?.trim();
  if (envHome) envCandidates.push(resolve(envHome));
  if (envSdkRoot) envCandidates.push(resolve(envSdkRoot));

  let sdkRoot: string | null = null;

  for (const dir of envCandidates) {
    if (!(await pathExistsAsync(dir))) {
      continue;
    }
    if (sdkRoot === null) {
      sdkRoot =
        basename(dir).toLowerCase() === "platform-tools" ? dirname(dir) : dir;
    }
    const nestedAdb = join(dir, "platform-tools", adbBin);
    if (await isExistingFileAsync(nestedAdb)) {
      return finish({ sdkRoot: dir, adbPath: nestedAdb });
    }
    const directAdb = join(dir, adbBin);
    if (await isExistingFileAsync(directAdb)) {
      return finish({
        sdkRoot: inferAndroidSdkRootFromAdb(directAdb) ?? sdkRoot,
        adbPath: directAdb
      });
    }
  }

  const pathAdb = findExecutableOnPath([adbBin], { env, platform });
  if (pathAdb) {
    return finish({
      sdkRoot: sdkRoot ?? inferAndroidSdkRootFromAdb(pathAdb),
      adbPath: pathAdb
    });
  }

  if (!scanWellKnownDirs) {
    return finish({ sdkRoot, adbPath: null });
  }

  const wellKnownRoots: string[] = [];
  const directAdbCandidates: string[] = [];

  if (platform === "win32") {
    const userProfile = env["USERPROFILE"]?.trim() || homeDir;
    const localAppData =
      env["LOCALAPPDATA"]?.trim() || join(userProfile, "AppData", "Local");
    wellKnownRoots.push(
      join(localAppData, "Android", "Sdk"),
      join(userProfile, "AppData", "Local", "Android", "Sdk")
    );
    directAdbCandidates.push(
      join(localAppData, "Microsoft", "WinGet", "Links", "adb.exe"),
      ...(await scanWinGetPlatformToolsCandidatesAsync(localAppData)),
      join(userProfile, "scoop", "shims", "adb.exe"),
      join(userProfile, "scoop", "apps", "adb", "current", "platform-tools", "adb.exe")
    );
    if (deepScan) {
      wellKnownRoots.push("C:\\Android\\Sdk", "D:\\Android\\Sdk");
      directAdbCandidates.push(
        "C:\\ProgramData\\chocolatey\\bin\\adb.exe",
        "C:\\platform-tools\\adb.exe"
      );
    }
  } else if (platform === "darwin") {
    wellKnownRoots.push(
      join(homeDir, "Library", "Android", "sdk"),
      "/opt/homebrew/share/android-commandlinetools",
      "/usr/local/share/android-commandlinetools"
    );
  } else {
    wellKnownRoots.push(
      join(homeDir, "Android", "Sdk"),
      "/opt/android-sdk",
      "/usr/lib/android-sdk"
    );
  }

  for (const dir of wellKnownRoots) {
    if (!(await pathExistsAsync(dir))) {
      continue;
    }
    if (sdkRoot === null) {
      sdkRoot = dir;
    }
    const adbCandidate = join(dir, "platform-tools", adbBin);
    if (await isExistingFileAsync(adbCandidate)) {
      return finish({ sdkRoot: dir, adbPath: adbCandidate });
    }
  }

  for (const directAdb of directAdbCandidates) {
    if (await isExistingFileAsync(directAdb)) {
      return finish({
        sdkRoot: sdkRoot ?? inferAndroidSdkRootFromAdb(directAdb),
        adbPath: directAdb
      });
    }
  }

  return finish({ sdkRoot, adbPath: null });
}

async function detectLocalToolchainPackageAsync(
  packageBinary: string,
  dataDir: string
): Promise<string | null> {
  const onPath = findExecutableOnPath([packageBinary], {
    extraDirs: getDefaultCliExtraDirs()
  });
  if (onPath) {
    return onPath;
  }

  const binExt = process.platform === "win32" ? ".cmd" : "";
  const home = homedir();
  const roots = [
    join(dataDir, "device-toolchain"),
    join(home, ".prismux", "device-toolchain"),
    join(home, ".prismux", "device-toolchain")
  ];

  for (const root of roots) {
    const candidates = [
      join(root, "node_modules", ".bin", `${packageBinary}${binExt}`),
      join(root, "node_modules", packageBinary, "package.json")
    ];
    for (const candidate of candidates) {
      if (await pathExistsAsync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function withTimeoutFallback<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: () => T
): Promise<T> {
  return new Promise<T>((resolvePromise) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolvePromise(fallback());
      }
    }, timeoutMs);
    timer.unref?.();

    promise
      .then((value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolvePromise(value);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolvePromise(fallback());
        }
      });
  });
}

function computeGroupStatus(
  items: readonly DiagnosticCheckItem[]
): DiagnosticCheckStatus {
  if (items.some((item) => item.status === "error")) {
    return "error";
  }
  if (items.some((item) => item.status === "degraded")) {
    return "degraded";
  }
  return "ok";
}

/**
 * Full-system asynchronous health & environment diagnostics service.
 * Runs all 6 groups in parallel with per-check timeouts, a hard <3s global budget,
 * and a 30s response cache (bypassable via `?force=1`).
 *
 * Security redline: AI Provider CLI probes ONLY inspect binary presence & `--version`;
 * NEVER reads any OAuth tokens, Keyring entries, or credential files.
 */
export class ServiceDiagnosticsService {
  private readonly opts: ServiceDiagnosticsOptions;
  private readonly cacheTtlMs: number;
  private readonly singleCheckTimeoutMs: number;
  private readonly globalBudgetMs: number;
  private readonly customCliProbe: boolean;
  private readonly cliProbeFn: (
    command: string,
    args: string[],
    timeoutMs: number
  ) => Promise<CliProbeResult>;
  private readonly networkProbeFn: (
    url: string,
    timeoutMs: number,
    headers?: Record<string, string>,
    method?: "HEAD" | "GET"
  ) => Promise<NetworkProbeResult>;
  private readonly customDetectAndroidSdkFn:
    | (() => { sdkRoot: string | null; adbPath: string | null })
    | undefined;
  private readonly resolve7zaFn: () => string | null;
  private readonly refreshEnvFn: () => Promise<WindowsEnvRefreshResult | void> | void;
  private readonly providerProbeService: PrismuxProviderProbeService;
  private configuredProvidersSource:
    | readonly string[]
    | (() => readonly string[] | null | undefined)
    | undefined;

  private readonly cachedReports = new Map<string, ServiceDiagnosticsResponse>();
  private readonly inflightRuns = new Map<string, Promise<ServiceDiagnosticsResponse>>();
  private generation = 0;

  constructor(options: ServiceDiagnosticsOptions) {
    this.opts = options;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.singleCheckTimeoutMs = Math.min(
      options.singleCheckTimeoutMs ?? DEFAULT_SINGLE_CHECK_TIMEOUT_MS,
      2_000
    );
    this.globalBudgetMs = Math.min(
      options.globalBudgetMs ?? DEFAULT_GLOBAL_BUDGET_MS,
      2_700
    );
    this.customCliProbe = options.cliProbe !== undefined;
    this.cliProbeFn = options.cliProbe ?? defaultCliProbe;
    this.networkProbeFn = options.networkProbe ?? defaultNetworkProbe;
    this.customDetectAndroidSdkFn = options.detectAndroidSdk;
    this.resolve7zaFn =
      options.resolve7za ??
      (() => this.opts.appUpdater?.resolve7zaPath() ?? resolve7zaBinary());
    this.refreshEnvFn =
      options.refreshEnv ??
      (() =>
        refreshWindowsEnvironmentFromRegistry({
          timeoutMs: Math.min(600, this.singleCheckTimeoutMs)
        }));
    this.configuredProvidersSource = options.configuredProviders;
    if (options.providerProbeService && !options.cliProbe) {
      this.providerProbeService = options.providerProbeService;
    } else {
      this.providerProbeService = new PrismuxProviderProbeService({
        coreRpcClient: options.coreRpcClient ?? options.t3RpcClient,
        cliTimeoutMs: this.singleCheckTimeoutMs,
        ...(options.cliProbe ? { cliProbe: options.cliProbe } : {}),
        refreshEnv: this.refreshEnvFn,
        ...(options.configuredProviders !== undefined
          ? { configuredProviders: options.configuredProviders }
          : {})
      });
    }
  }

  setConfiguredProviders(providers: readonly string[] | null): void {
    this.configuredProvidersSource = providers ?? undefined;
    this.providerProbeService.setConfiguredProviders(providers);
    this.cachedReports.clear();
  }

  private resolveScopedProviderIds(options: RunDiagnosticsOptions): string[] | null {
    if (options.includeAll === true) {
      return null;
    }
    const rawList =
      options.providers !== undefined && options.providers !== null
        ? options.providers
        : typeof this.configuredProvidersSource === "function"
          ? this.configuredProvidersSource()
          : this.configuredProvidersSource;
    if (rawList === undefined || rawList === null) {
      return null;
    }
    const seen = new Set<string>();
    const canonical: string[] = [];
    for (const raw of rawList) {
      const id = canonicalizeProbeProviderId(raw);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      canonical.push(id);
    }
    canonical.sort();
    return canonical;
  }

  clearCache(): void {
    this.generation += 1;
    this.cachedReports.clear();
    this.inflightRuns.clear();
    if (!this.customCliProbe) {
      clearCliDiscoveryCaches();
    }
    this.providerProbeService.clearCache();
  }

  invalidateCache(): void {
    this.clearCache();
  }

  async runDiagnostics(
    forceOrOptions: boolean | RunDiagnosticsOptions = false
  ): Promise<ServiceDiagnosticsResponse> {
    const opts: RunDiagnosticsOptions =
      typeof forceOrOptions === "boolean"
        ? { force: forceOrOptions }
        : forceOrOptions;
    const force = opts.force === true;
    const deepScan = opts.deepScan === true;
    const scopedProviders = this.resolveScopedProviderIds(opts);
    const scopeKey = `${scopedProviders === null ? "all" : scopedProviders.length === 0 ? "none" : scopedProviders.join(",")}:${deepScan ? "deep" : "std"}`;

    const now = Date.now();
    const cachedReport = this.cachedReports.get(scopeKey);
    if (!force && cachedReport !== undefined && now - cachedReport.checkedAt < this.cacheTtlMs) {
      return {
        ...cachedReport,
        cached: true
      };
    }

    const existingInflight = this.inflightRuns.get(scopeKey);
    if (!force && existingInflight !== undefined) {
      return existingInflight;
    }

    if (force) {
      this.generation += 1;
      this.cachedReports.clear();
      if (!this.customCliProbe) {
        clearCliDiscoveryCaches();
      }
      this.providerProbeService.clearCache();
    }

    const runGeneration = this.generation;
    const run = this.executeAllChecks(runGeneration, {
      force,
      deepScan,
      scopedProviders,
      scopeKey
    }).finally(() => {
      if (this.inflightRuns.get(scopeKey) === run) {
        this.inflightRuns.delete(scopeKey);
      }
    });
    this.inflightRuns.set(scopeKey, run);
    return run;
  }

  private async executeAllChecks(
    runGeneration: number,
    ctx: {
      force: boolean;
      deepScan: boolean;
      scopedProviders: string[] | null;
      scopeKey: string;
    }
  ): Promise<ServiceDiagnosticsResponse> {
    const startedAt = performance.now();
    const budget = this.globalBudgetMs;

    // Refresh Windows HKLM + HKCU environment variables before probing so
    // newly installed CLIs / WinGet tools / SDK variables take effect immediately.
    const envRefreshTimeoutMs = Math.min(650, Math.max(150, Math.floor(budget / 3)));
    await withTimeoutFallback(
      Promise.resolve().then(() => this.refreshEnvFn()),
      envRefreshTimeoutMs,
      () => undefined
    );

    const elapsedAfterEnvMs = Math.max(0, performance.now() - startedAt);
    const remainingBudget = Math.max(400, budget - elapsedAfterEnvMs);
    const perCheckTimeout = Math.min(this.singleCheckTimeoutMs, remainingBudget);

    const allowedProviderSet =
      ctx.scopedProviders !== null ? new Set(ctx.scopedProviders) : null;
    const providerSpecsToProbe = PRISMUX_PROBE_PROVIDER_SPECS.filter(
      (spec) => allowedProviderSet === null || allowedProviderSet.has(spec.providerId)
    );

    const checkSpecs: Array<{
      id: string;
      category: DiagnosticCategoryId;
      name: string;
      settingsRoute?: string;
      run: () => Promise<DiagnosticCheckItem | null>;
    }> = [
      // a. 宿主核心 (4)
      {
        id: "host.daemon",
        category: "host_core",
        name: "Prismux Daemon",
        run: async () => this.checkDaemonCore()
      },
      {
        id: "host.core_server",
        category: "host_core",
        name: "Prismux Server",
        run: () => this.checkCoreServer(perCheckTimeout)
      },
      {
        id: "host.electron_bridge",
        category: "host_core",
        name: "Electron Bridge",
        run: async () => this.checkElectronBridge()
      },
      {
        id: "host.resource_monitor",
        category: "host_core",
        name: "Resource Monitor",
        run: async () => this.checkResourceMonitor()
      },

      // b. 记忆与同步 (3)
      {
        id: "memory.sqlite_wal",
        category: "memory_sync",
        name: "memory.db (SQLite WAL + FTS5)",
        settingsRoute: "/settings/memory",
        run: () => this.checkMemoryDb()
      },
      {
        id: "memory.sqlite_vec",
        category: "memory_sync",
        name: "sqlite-vec 混合向量引擎",
        settingsRoute: "/settings/memory",
        run: async () => this.checkSqliteVec()
      },
      {
        id: "sync.vault",
        category: "memory_sync",
        name: "SyncVault 加密同步通道",
        settingsRoute: "/settings/sync",
        run: async () => this.checkSyncVault()
      },

      // c. AI Provider CLI — scoped to configured providers when specified; ZERO OAuth/keyring reads
      ...providerSpecsToProbe.map((spec) => ({
        id: spec.diagId,
        category: "ai_providers" as const,
        name: spec.diagName,
        settingsRoute: "/settings/providers",
        run: () =>
          this.checkProviderViaUnifiedProbe(
            spec.providerId,
            perCheckTimeout,
            ctx.force,
            ctx.deepScan
          )
      })),

      // d. 模拟器与媒体工具 (7)
      {
        id: "tool.7zip",
        category: "simulators_media",
        name: "7za / 7z 解压工具",
        settingsRoute: "/settings/updates",
        run: () => this.check7Zip(perCheckTimeout)
      },
      {
        id: "tool.steam_431960",
        category: "simulators_media",
        name: "Steam Workshop 431960 (Wallpaper Engine)",
        settingsRoute: "/settings/wallpaper",
        run: () => this.checkSteam431960()
      },
      {
        id: "tool.android_sdk",
        category: "simulators_media",
        name: "Android SDK / adb",
        run: () => this.checkAndroidSdk(perCheckTimeout, ctx.force, ctx.deepScan)
      },
      {
        id: "tool.expo_device_hub",
        category: "simulators_media",
        name: "expo-device-hub",
        run: () =>
          this.checkDeviceToolchainBinary(
            "tool.expo_device_hub",
            "expo-device-hub",
            "expo-device-hub"
          )
      },
      {
        id: "tool.agent_device",
        category: "simulators_media",
        name: "agent-device",
        run: () =>
          this.checkDeviceToolchainBinary(
            "tool.agent_device",
            "agent-device",
            "agent-device"
          )
      },
      {
        id: "tool.git",
        category: "simulators_media",
        name: "Git",
        run: () =>
          this.checkGenericCliTool({
            id: "tool.git",
            name: "Git",
            command: "git",
            args: ["--version"],
            fixAction: "安装 Git 并加入 PATH",
            fixCommand: "winget install --id Git.Git -e",
            timeoutMs: perCheckTimeout,
            force: ctx.force,
            deepScan: ctx.deepScan
          })
      },
      {
        id: "tool.gh",
        category: "simulators_media",
        name: "GitHub CLI (gh)",
        run: () =>
          this.checkGenericCliTool({
            id: "tool.gh",
            name: "GitHub CLI (gh)",
            command: "gh",
            args: ["--version"],
            fixAction: "按需安装 GitHub CLI（仅做版本探测）",
            fixCommand: "winget install --id GitHub.cli -e",
            timeoutMs: perCheckTimeout,
            force: ctx.force,
            deepScan: ctx.deepScan
          })
      },

      // e. 网络与镜像源 (5)
      {
        id: "mirror.github_releases",
        category: "network_mirrors",
        name: "GitHub Releases",
        settingsRoute: "/settings/updates",
        run: () =>
          this.checkMirrorEndpoint({
            id: "mirror.github_releases",
            name: "GitHub Releases",
            url: `${UPDATE_ENDPOINTS.githubWebBase}/${UPDATE_ENDPOINTS.githubOwner}/${UPDATE_ENDPOINTS.githubRepo}/releases/latest`,
            headers: {
              accept: "text/html,application/xhtml+xml,*/*;q=0.8"
            },
            fixAction: "可在「软件更新」切换国内镜像或配置自定义代理前缀",
            settingsRoute: "/settings/updates",
            timeoutMs: perCheckTimeout
          })
      },
      {
        id: "mirror.gitee_releases",
        category: "network_mirrors",
        name: "Gitee Releases（国内源）",
        settingsRoute: "/settings/updates",
        run: () =>
          this.checkMirrorEndpoint({
            id: "mirror.gitee_releases",
            name: "Gitee Releases（国内源）",
            url: `${UPDATE_ENDPOINTS.giteeWebBase}/${UPDATE_ENDPOINTS.giteeOwner}/${UPDATE_ENDPOINTS.giteeRepo}/releases/latest`,
            headers: {
              accept: "text/html,application/xhtml+xml,*/*;q=0.8"
            },
            fixAction: "可在「软件更新」切换为海外 GitHub 源",
            settingsRoute: "/settings/updates",
            timeoutMs: perCheckTimeout
          })
      },
      {
        id: "mirror.npmjs",
        category: "network_mirrors",
        name: "npmjs Registry",
        settingsRoute: "/settings/plugins",
        run: () =>
          this.checkMirrorEndpoint({
            id: "mirror.npmjs",
            name: "npmjs Registry",
            url: `${UPDATE_ENDPOINTS.npmRegistry}/-/ping`,
            fixAction: "可在「软件更新」将插件源切换至 npmmirror 国内镜像",
            settingsRoute: "/settings/updates",
            timeoutMs: perCheckTimeout
          })
      },
      {
        id: "mirror.npmmirror",
        category: "network_mirrors",
        name: "npmmirror 国内镜像",
        settingsRoute: "/settings/plugins",
        run: () =>
          this.checkMirrorEndpoint({
            id: "mirror.npmmirror",
            name: "npmmirror 国内镜像",
            url: `${UPDATE_ENDPOINTS.npmMirrorRegistry}/-/ping`,
            fixAction: "检查网络连接或切换至 npmjs 官方源",
            settingsRoute: "/settings/updates",
            timeoutMs: perCheckTimeout
          })
      },
      {
        id: "mirror.huggingface",
        category: "network_mirrors",
        name: "HuggingFace / HF-Mirror",
        run: () => this.checkHuggingFaceMirror(perCheckTimeout)
      },

      // f. 沉睡内核状态摘要 (3) — read-only summaries
      {
        id: "engine.overnight_factory",
        category: "dormant_engines",
        name: "OvernightFactory（夜间全自动工场）",
        run: async () => this.checkOvernightFactory()
      },
      {
        id: "engine.lifecycle_hook_bus",
        category: "dormant_engines",
        name: "LifecycleHookBus（生命周期钩子总线）",
        run: async () => this.checkLifecycleHookBus()
      },
      {
        id: "engine.worktree_sandbox",
        category: "dormant_engines",
        name: "WorktreeSandbox（工作树隔离沙箱）",
        run: async () => this.checkWorktreeSandbox()
      }
    ];

    const settledRaw = await Promise.all(
      checkSpecs.map((spec) =>
        withTimeoutFallback<DiagnosticCheckItem | null>(
          spec.run(),
          Math.min(perCheckTimeout + 150, remainingBudget),
          (): DiagnosticCheckItem => ({
            id: spec.id,
            category: spec.category,
            name: spec.name,
            status: "degraded",
            summary: `探测超时（>${perCheckTimeout}ms），已跳过以保护整体体检响应速度`,
            ...(spec.settingsRoute !== undefined
              ? { settingsRoute: spec.settingsRoute }
              : {})
          })
        )
      )
    );
    const settledItems = settledRaw.filter(
      (item): item is DiagnosticCheckItem => item !== null
    );

    const groups: DiagnosticGroupSummary[] = DIAGNOSTIC_CATEGORIES.map((catId) => {
      const catItems = settledItems.filter((item) => item.category === catId);
      const okCount = catItems.filter((i) => i.status === "ok").length;
      const degradedCount = catItems.filter((i) => i.status === "degraded").length;
      const errorCount = catItems.filter((i) => i.status === "error").length;
      const label = CATEGORY_LABELS[catId];
      return {
        id: catId,
        label,
        title: label,
        status: computeGroupStatus(catItems),
        okCount,
        degradedCount,
        errorCount,
        items: catItems
      };
    });

    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    const okTotal = settledItems.filter((i) => i.status === "ok").length;
    const degradedTotal = settledItems.filter((i) => i.status === "degraded").length;
    const errorTotal = settledItems.filter((i) => i.status === "error").length;

    const report: ServiceDiagnosticsResponse = {
      ok: true,
      checkedAt: Date.now(),
      durationMs,
      cached: false,
      summary: {
        total: settledItems.length,
        ok: okTotal,
        degraded: degradedTotal,
        error: errorTotal
      },
      groups,
      items: settledItems
    };

    if (runGeneration === this.generation) {
      if (this.cachedReports.size >= 8 && !this.cachedReports.has(ctx.scopeKey)) {
        const oldest = this.cachedReports.keys().next().value;
        if (oldest !== undefined) {
          this.cachedReports.delete(oldest);
        }
      }
      this.cachedReports.set(ctx.scopeKey, report);
    }
    return report;
  }

  private checkDaemonCore(): DiagnosticCheckItem {
    const uptimeSec = Math.max(0, Math.round((Date.now() - this.opts.startedAt) / 1000));
    return {
      id: "host.daemon",
      category: "host_core",
      name: "Prismux Daemon",
      status: "ok",
      version: this.opts.version,
      summary: `运行正常（v${this.opts.version}，已运行 ${uptimeSec}s）`,
      detail: `PID ${process.pid} · 数据目录 ${this.opts.dataDir}`
    };
  }

  private async checkCoreServer(timeoutMs: number): Promise<DiagnosticCheckItem> {
    const sup = (this.opts.coreSupervisor ?? this.opts.t3Supervisor)?.getStatus();
    const rpc = (this.opts.coreRpcClient ?? this.opts.t3RpcClient)?.getStatus();
    const connected = rpc?.connected ?? false;
    if (connected) {
      return {
        id: "host.core_server",
        category: "host_core",
        name: "Prismux Server",
        status: "ok",
        summary: `已连接${sup?.pid ? `（PID ${sup.pid}）` : ""}`,
        detail: rpc?.wsUrl ? `RPC: ${rpc.wsUrl}` : undefined
      };
    }

    const rawCandidates = [
      this.opts.coreServerUrl,
      this.opts.coreServerUrl,
      process.env["PRISMUX_SERVER_URL"],
      process.env["PRISMUX_CORE_SERVER_URL"],
      process.env["PRISMUX_CORE_SERVER_URL"],
      sup?.healthUrl,
      rpc?.wsUrl
    ];
    const probeUrls: string[] = [];
    for (const raw of rawCandidates) {
      if (typeof raw !== "string") {
        continue;
      }
      const normalized = normalizeCoreHttpProbeUrl(raw);
      if (normalized !== null && !probeUrls.includes(normalized)) {
        probeUrls.push(normalized);
      }
    }

    if (probeUrls.length > 0) {
      const probeHeaders: Record<string, string> = {
        accept: "*/*"
      };
      const serverToken = (this.opts.coreToken ?? this.opts.t3Token)?.trim();
      if (serverToken && serverToken.length > 0) {
        probeHeaders["authorization"] = `Bearer ${serverToken}`;
      }

      let lastProbeError: string | undefined;
      for (const probeUrl of probeUrls) {
        const probed = await this.networkProbeFn(
          probeUrl,
          timeoutMs,
          probeHeaders,
          "GET"
        );
        const httpAlive =
          probed.reachable ||
          (probed.statusCode !== null &&
            probed.statusCode >= 200 &&
            probed.statusCode < 500);
        if (httpAlive) {
          let hostLabel = probeUrl;
          try {
            hostLabel = new URL(probeUrl).host;
          } catch {
            // keep full URL label
          }
          const codeLabel =
            probed.statusCode !== null ? `HTTP ${probed.statusCode}` : "HTTP OK";
          const latencySuffix =
            probed.latencyMs !== null ? ` · ${probed.latencyMs}ms` : "";
          return {
            id: "host.core_server",
            category: "host_core",
            name: "Prismux Server",
            status: "ok",
            ...(probed.latencyMs !== null ? { latencyMs: probed.latencyMs } : {}),
            summary: sup?.pid
              ? `运行中（PID ${sup.pid} · ${codeLabel}${latencySuffix}）`
              : `桌面托管运行中（${hostLabel} · ${codeLabel}${latencySuffix}）`,
            detail: `HTTP 存活探测通过：${probeUrl}`
          };
        }
        lastProbeError = probed.error ?? lastProbeError;
      }

      if (sup?.state === "running") {
        return {
          id: "host.core_server",
          category: "host_core",
          name: "Prismux Server",
          status: "degraded",
          summary: `进程已启动（PID ${sup.pid ?? "?"}），HTTP/RPC 就绪探测中`,
          detail: lastProbeError ?? rpc?.lastError ?? sup.lastError
        };
      }

      let firstHost = probeUrls[0]!;
      try {
        firstHost = new URL(probeUrls[0]!).host;
      } catch {
        // keep full URL
      }
      return {
        id: "host.core_server",
        category: "host_core",
        name: "Prismux Server",
        status: "degraded",
        summary: `Prismux Server 未响应（${firstHost}）`,
        detail:
          lastProbeError ??
          sup?.lastError ??
          rpc?.lastError ??
          `HTTP 探测未连通：${probeUrls[0]}`
      };
    }

    if (sup?.state === "running") {
      return {
        id: "host.core_server",
        category: "host_core",
        name: "Prismux Server",
        status: "degraded",
        summary: `进程已启动（PID ${sup.pid ?? "?"}），RPC 重连中`,
        detail: rpc?.lastError ?? sup.lastError
      };
    }
    return {
      id: "host.core_server",
      category: "host_core",
      name: "Prismux Server",
      status: "degraded",
      summary: "独立模式或未附加 Prismux Server 监督器",
      detail: sup?.lastError ?? rpc?.lastError ?? "可由桌面宿主托管连接"
    };
  }

  private checkElectronBridge(): DiagnosticCheckItem {
    const hasMainPid = Boolean(process.env["PRISMUX_MAIN_PID"]?.trim());
    const hasResourcesPath = Boolean(
      (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    );
    if (!this.opts.headless || hasMainPid || hasResourcesPath) {
      return {
        id: "host.electron_bridge",
        category: "host_core",
        name: "Electron Bridge",
        status: "ok",
        summary: "桌面宿主桥接模式就绪",
        detail: hasMainPid
          ? `宿主主进程 PID ${process.env["PRISMUX_MAIN_PID"]}`
          : "已启用桌面窗口桥接上下文"
      };
    }
    return {
      id: "host.electron_bridge",
      category: "host_core",
      name: "Electron Bridge",
      status: "degraded",
      summary: "当前为无头守护模式（--headless）",
      detail: "从 Prismux 桌面客户端启动后自动接通原生 Electron Bridge"
    };
  }

  private checkResourceMonitor(): DiagnosticCheckItem {
    const ptyCount = this.opts.ptyPool?.listSessions().length ?? 0;
    const rssMb = Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10;
    return {
      id: "host.resource_monitor",
      category: "host_core",
      name: "Resource Monitor",
      status: this.opts.resourceMonitor ? "ok" : "degraded",
      summary: this.opts.resourceMonitor
        ? `采样正常（Daemon ${rssMb} MB · ${ptyCount} 个 PTY）`
        : "资源监控服务未挂载",
      detail: `平台 ${process.platform}`
    };
  }

  private async checkMemoryDb(): Promise<DiagnosticCheckItem> {
    const dbPath =
      this.opts.memoryDbPath ?? join(this.opts.dataDir, "data", "memory.db");
    if (!this.opts.memoryStore) {
      return {
        id: "memory.sqlite_wal",
        category: "memory_sync",
        name: "memory.db (SQLite WAL + FTS5)",
        status: "error",
        summary: "记忆存储未初始化",
        settingsRoute: "/settings/memory"
      };
    }
    let exists = dbPath === ":memory:";
    let sizeKb: number | null = null;
    if (!exists) {
      try {
        const st = await statAsync(dbPath);
        exists = true;
        sizeKb = Math.round((st.size / 1024) * 10) / 10;
      } catch {
        exists = false;
      }
    }
    return {
      id: "memory.sqlite_wal",
      category: "memory_sync",
      name: "memory.db (SQLite WAL + FTS5)",
      status: exists ? "ok" : "degraded",
      summary: exists
        ? `SQLite WAL + FTS5 就绪${sizeKb !== null ? `（${sizeKb} KB）` : ""}`
        : "memory.db 尚未落盘",
      detail: dbPath,
      settingsRoute: "/settings/memory"
    };
  }

  private checkSqliteVec(): DiagnosticCheckItem {
    const vecStatus = this.opts.memoryStore?.getVectorExtensionStatus();
    const loaded =
      vecStatus?.loaded ?? this.opts.memoryStore?.isVectorSearchEnabled() ?? false;
    if (loaded) {
      const version = vecStatus?.version ?? null;
      const extPath = vecStatus?.extensionPath ?? null;
      return {
        id: "memory.sqlite_vec",
        category: "memory_sync",
        name: "sqlite-vec 混合向量引擎",
        status: "ok",
        ...(version !== null ? { version } : {}),
        summary: version
          ? `FTS5 + sqlite-vec 混合态（vec0 ${version}）`
          : "FTS5 + sqlite-vec 混合态",
        detail: extPath
          ? `已加载 vec0 原生向量扩展（${extPath}），支持 RRF 混合检索。`
          : "已加载 vec0 原生向量扩展，支持 RRF 混合检索。",
        settingsRoute: "/settings/memory"
      };
    }
    const reason = vecStatus?.error?.trim();
    return {
      id: "memory.sqlite_vec",
      category: "memory_sync",
      name: "sqlite-vec 混合向量引擎",
      status: "degraded",
      summary: "FTS5 降级态（缺 vec0.dll，无兼容风险）",
      detail: reason
        ? `当前自动使用 SQLite FTS5 trigram 全文检索（${reason}），记忆读写与隔离完全正常。`
        : "当前自动使用 SQLite FTS5 trigram 全文检索，记忆读写与隔离完全正常。",
      settingsRoute: "/settings/memory"
    };
  }

  private checkSyncVault(): DiagnosticCheckItem {
    if (!this.opts.syncVault) {
      return {
        id: "sync.vault",
        category: "memory_sync",
        name: "SyncVault 加密同步通道",
        status: "degraded",
        summary: "SyncVault 引擎未启用",
        settingsRoute: "/settings/sync"
      };
    }
    const status = this.opts.syncVault.getStatus();
    const enabled = status.enabledChannels;
    if (enabled.length > 0) {
      return {
        id: "sync.vault",
        category: "memory_sync",
        name: "SyncVault 加密同步通道",
        status: "ok",
        summary: `已启用通道：${enabled.join(", ")}`,
        detail: status.portable.isPortable
          ? `便携模式 (${status.portable.dataDir})`
          : `看门狗 ${Math.round(status.watchdog.stallTimeoutMs / 1000)}s`,
        settingsRoute: "/settings/sync"
      };
    }
    return {
      id: "sync.vault",
      category: "memory_sync",
      name: "SyncVault 加密同步通道",
      status: "degraded",
      summary: "尚未启用远程加密同步通道（仅本地存储）",
      fixAction: "前往「云同步」配置 WebDAV / S3 / GitHub 加密同步",
      settingsRoute: "/settings/sync"
    };
  }

  private async checkProviderViaUnifiedProbe(
    providerId: string,
    timeoutMs: number,
    force = false,
    deepScan = false
  ): Promise<DiagnosticCheckItem | null> {
    const spec: ProviderProbeSpec | undefined =
      this.providerProbeService.getProviderSpec(providerId);
    if (!spec) {
      return null;
    }
    const snapshot = await this.providerProbeService.probeProvider(providerId, {
      refresh: force,
      skipEnvRefresh: true,
      timeoutMs,
      deepScan
    });
    if (!snapshot.installed) {
      // Optional AI Provider CLIs that are not installed on this machine are omitted
      // completely so uninstalled tools never surface as degraded warning cards.
      return null;
    }
    if (snapshot.version && !snapshot.error) {
      return {
        id: spec.diagId,
        category: "ai_providers",
        name: spec.diagName,
        status: "ok",
        version: snapshot.version,
        ...(snapshot.latencyMs !== undefined
          ? { latencyMs: snapshot.latencyMs }
          : {}),
        summary: `已安装（${snapshot.version}）· ${snapshot.authLabel}`,
        detail: snapshot.binaryPath ?? undefined,
        settingsRoute: "/settings/providers"
      };
    }
    return {
      id: spec.diagId,
      category: "ai_providers",
      name: spec.diagName,
      status: "degraded",
      ...(snapshot.latencyMs !== undefined
        ? { latencyMs: snapshot.latencyMs }
        : {}),
      summary: snapshot.error
        ? "本机 CLI 启动或探测异常（需修复）"
        : "已发现可执行文件，但版本探测未返回",
      detail: snapshot.error ?? snapshot.binaryPath ?? undefined,
      fixAction: spec.fixAction,
      fixCommand: spec.fixCommand,
      settingsRoute: "/settings/providers"
    };
  }

  private async check7Zip(timeoutMs: number): Promise<DiagnosticCheckItem> {
    const binPath = this.resolve7zaFn();
    if (!binPath) {
      return {
        id: "tool.7zip",
        category: "simulators_media",
        name: "7za / 7z 解压工具",
        status: "degraded",
        summary: "未找到 7za.exe / 7z.exe（Gitee 分卷更新重组需要）",
        fixAction: "安装 7-Zip 或设置环境变量 PRISMUX_7ZA_PATH",
        fixCommand: "winget install --id 7zip.7zip -e",
        settingsRoute: "/settings/updates"
      };
    }
    const started = performance.now();
    let version: string | null = null;
    try {
      const { stdout } = await execSafeCli(binPath, ["i"], timeoutMs, {
        maxBuffer: 256 * 1024
      });
      version = extractFirstVersionLine(stdout);
    } catch {
      // Presence alone is sufficient
    }
    return {
      id: "tool.7zip",
      category: "simulators_media",
      name: "7za / 7z 解压工具",
      status: "ok",
      version,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      summary: version ? `可用（${version}）` : "已就绪（可解压 Gitee 分卷安装包）",
      detail: binPath,
      settingsRoute: "/settings/updates"
    };
  }

  private async checkSteam431960(): Promise<DiagnosticCheckItem> {
    try {
      if (this.opts.wallpaperService) {
        const inv = await this.opts.wallpaperService.getInventory();
        const workshopCount = inv.workshopDirs.length;
        const steamItems = inv.items.filter((item) => item.source === "steam").length;
        if (workshopCount > 0) {
          return {
            id: "tool.steam_431960",
            category: "simulators_media",
            name: "Steam Workshop 431960 (Wallpaper Engine)",
            status: "ok",
            summary: `已接入 ${workshopCount} 个创意工坊目录（共 ${steamItems} 个壁纸）`,
            detail: inv.workshopDirs.join("; "),
            settingsRoute: "/settings/wallpaper"
          };
        }
      }
    } catch {
      // fall through to degraded state
    }

    return {
      id: "tool.steam_431960",
      category: "simulators_media",
      name: "Steam Workshop 431960 (Wallpaper Engine)",
      status: "degraded",
      summary: "未检测到 Steam 431960 创意工坊目录（可使用内置或本地壁纸）",
      fixAction: "前往「壁纸引擎」设置手动指定 Steam 根目录或自定义壁纸文件夹",
      settingsRoute: "/settings/wallpaper"
    };
  }

  private async checkAndroidSdk(
    timeoutMs: number,
    force = false,
    deepScan = false
  ): Promise<DiagnosticCheckItem> {
    const detected = this.customDetectAndroidSdkFn
      ? this.customDetectAndroidSdkFn()
      : await defaultDetectAndroidSdkAsync({
          deepScan,
          bypassCache: force
        });
    if (detected.adbPath) {
      let version: string | null = null;
      const started = performance.now();
      try {
        const { stdout } = await execSafeCli(
          detected.adbPath,
          ["version"],
          timeoutMs,
          { maxBuffer: 256 * 1024 }
        );
        version = extractFirstVersionLine(stdout);
      } catch {
        // adb exists even if version failed
      }
      return {
        id: "tool.android_sdk",
        category: "simulators_media",
        name: "Android SDK / adb",
        status: "ok",
        version,
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
        summary: version ? `adb 就绪（${version}）` : "已检测到 adb",
        detail: detected.sdkRoot
          ? `SDK: ${detected.sdkRoot} · adb: ${detected.adbPath}`
          : detected.adbPath
      };
    }

    return {
      id: "tool.android_sdk",
      category: "simulators_media",
      name: "Android SDK / adb",
      status: "degraded",
      summary: detected.sdkRoot
        ? `已检测到 SDK 目录但缺少 platform-tools/adb`
        : "未检测到 Android SDK 或 adb（仅真机/安卓模拟器需要）",
      detail: detected.sdkRoot ?? undefined,
      fixAction: "安装 Android Platform Tools 并设置 ANDROID_HOME",
      fixCommand: "winget install --id Google.PlatformTools -e"
    };
  }

  private async checkDeviceToolchainBinary(
    id: string,
    name: string,
    binName: string
  ): Promise<DiagnosticCheckItem> {
    const located = await detectLocalToolchainPackageAsync(binName, this.opts.dataDir);
    if (located) {
      return {
        id,
        category: "simulators_media",
        name,
        status: "ok",
        summary: "已安装（移动设备联调工具就绪）",
        detail: located
      };
    }
    return {
      id,
      category: "simulators_media",
      name,
      status: "degraded",
      summary: "尚未安装（可在设备模拟器面板按需安装，支持国内 npmmirror 镜像）",
      fixAction: `使用 npmmirror 安装 ${binName}`,
      fixCommand: `npm install -g ${binName} --registry=https://registry.npmmirror.com`
    };
  }

  private async checkGenericCliTool(params: {
    id: string;
    name: string;
    command: string;
    args: string[];
    fixAction: string;
    fixCommand: string;
    timeoutMs: number;
    force?: boolean;
    deepScan?: boolean;
  }): Promise<DiagnosticCheckItem> {
    const probed = this.customCliProbe
      ? await this.cliProbeFn(params.command, params.args, params.timeoutMs)
      : await defaultCliProbe(params.command, params.args, params.timeoutMs, {
          refresh: params.force === true,
          deepScan: params.deepScan === true
        });
    if (probed.found) {
      return {
        id: params.id,
        category: "simulators_media",
        name: params.name,
        status: "ok",
        version: probed.version ?? null,
        latencyMs: probed.latencyMs,
        summary: probed.version ? `已安装（${probed.version}）` : "已安装",
        detail: probed.path ?? undefined
      };
    }
    return {
      id: params.id,
      category: "simulators_media",
      name: params.name,
      status: "degraded",
      latencyMs: probed.latencyMs,
      summary: `未在 PATH 中找到 ${params.command}`,
      fixAction: params.fixAction,
      fixCommand: params.fixCommand
    };
  }

  private async checkMirrorEndpoint(params: {
    id: string;
    name: string;
    url: string;
    headers?: Record<string, string>;
    fixAction: string;
    settingsRoute?: string;
    timeoutMs: number;
  }): Promise<DiagnosticCheckItem> {
    const probed = await this.networkProbeFn(
      params.url,
      params.timeoutMs,
      params.headers
    );
    if (probed.reachable) {
      return {
        id: params.id,
        category: "network_mirrors",
        name: params.name,
        status: "ok",
        latencyMs: probed.latencyMs,
        summary: `可达（${probed.latencyMs ?? 0}ms · HTTP ${probed.statusCode ?? 200}）`,
        detail: params.url,
        ...(params.settingsRoute !== undefined
          ? { settingsRoute: params.settingsRoute }
          : {})
      };
    }
    return {
      id: params.id,
      category: "network_mirrors",
      name: params.name,
      status: "degraded",
      latencyMs: probed.latencyMs,
      summary: `不可达或超时（${probed.error ?? "连接失败"}）`,
      detail: params.url,
      fixAction: params.fixAction,
      ...(params.settingsRoute !== undefined
        ? { settingsRoute: params.settingsRoute }
        : {})
    };
  }

  private async checkHuggingFaceMirror(
    timeoutMs: number
  ): Promise<DiagnosticCheckItem> {
    const configured = process.env["HF_ENDPOINT"]?.trim();
    const primaryUrl =
      configured && /^https?:\/\//i.test(configured)
        ? configured.replace(/\/+$/, "")
        : "https://hf-mirror.com";
    const probe = await this.networkProbeFn(primaryUrl, timeoutMs);
    if (probe.reachable) {
      return {
        id: "mirror.huggingface",
        category: "network_mirrors",
        name: "HuggingFace / HF-Mirror",
        status: "ok",
        latencyMs: probe.latencyMs,
        summary: `镜像可达（${primaryUrl} · ${probe.latencyMs ?? 0}ms）`,
        detail: configured
          ? `已配置 HF_ENDPOINT=${configured}`
          : "国内网络建议设置 HF_ENDPOINT=https://hf-mirror.com 以加速语音/本地模型下载"
      };
    }
    return {
      id: "mirror.huggingface",
      category: "network_mirrors",
      name: "HuggingFace / HF-Mirror",
      status: "degraded",
      latencyMs: probe.latencyMs,
      summary: `镜像暂不可达（${primaryUrl}：${probe.error ?? "连接失败"}）`,
      fixAction: "国内环境建议配置 HF_ENDPOINT=https://hf-mirror.com",
      fixCommand: "$env:HF_ENDPOINT = 'https://hf-mirror.com'"
    };
  }

  private checkOvernightFactory(): DiagnosticCheckItem {
    if (!this.opts.overnightFactory) {
      return {
        id: "engine.overnight_factory",
        category: "dormant_engines",
        name: "OvernightFactory（夜间全自动工场）",
        status: "degraded",
        summary: "未挂载夜间工场实例"
      };
    }
    const cfg = this.opts.overnightFactory.getInboundConfig();
    const stages = this.opts.overnightFactory.getStages();
    const processedCount = this.opts.overnightFactory.getProcessedMessageIds().length;
    return {
      id: "engine.overnight_factory",
      category: "dormant_engines",
      name: "OvernightFactory（夜间全自动工场）",
      status: "ok",
      summary: `待命就绪（模式 ${cfg.mode} · 标签 ${cfg.matchAliasOrTag} · ${stages.length} 阶段）`,
      detail: `已处理任务邮件 ${processedCount} 封（只读摘要）`,
      settingsRoute: "/settings/overnight-factory"
    };
  }

  private checkLifecycleHookBus(): DiagnosticCheckItem {
    if (!this.opts.hookBus) {
      return {
        id: "engine.lifecycle_hook_bus",
        category: "dormant_engines",
        name: "LifecycleHookBus（生命周期钩子总线）",
        status: "degraded",
        summary: "未挂载钩子总线实例"
      };
    }
    const permMode = this.opts.hookBus.getPermissionMode();
    const hooksCount = this.opts.hookBus.getRegisteredHooks().length;
    const pendingApprovals = this.opts.hookBus
      .listApprovalRecords()
      .filter((r) => r.status === "pending").length;
    return {
      id: "engine.lifecycle_hook_bus",
      category: "dormant_engines",
      name: "LifecycleHookBus（生命周期钩子总线）",
      status: "ok",
      summary: `运行待命（权限档 ${permMode} · 已注册 ${hooksCount} 条钩子 · 待审批 ${pendingApprovals} 条）`,
      detail: "安全钩子默认 onFailure=block（只读摘要）"
    };
  }

  private checkWorktreeSandbox(): DiagnosticCheckItem {
    const backend = selectPlatformSandboxBackend(process.platform);
    return {
      id: "engine.worktree_sandbox",
      category: "dormant_engines",
      name: "WorktreeSandbox（工作树隔离沙箱）",
      status: this.opts.sandbox ? "ok" : "degraded",
      summary: this.opts.sandbox
        ? `隔离引擎待命（后端 ${backend}）`
        : "未挂载工作树隔离沙箱",
      detail: `平台 ${process.platform} · OS 级写隔离 + 域名白名单网关（只读摘要）`
    };
  }
}
