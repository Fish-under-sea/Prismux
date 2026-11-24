import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { sanitizeChildEnv } from "../t3/T3ServerSupervisor.js";

const execFileAsync = promisify(execFile);

export const WINDOWS_HKLM_ENV_KEY =
  "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment";
export const WINDOWS_HKCU_ENV_KEY = "HKCU\\Environment";

const DEFAULT_REG_QUERY_TIMEOUT_MS = 600;
const WIN32_SPAWNABLE_EXTENSIONS = [".exe", ".cmd", ".bat", ".com"] as const;
const WIN32_EXPLICIT_EXECUTABLE_EXT_RE = /\.(exe|cmd|bat|com)$/i;
const WIN32_CMD_SCRIPT_EXT_RE = /\.(cmd|bat)$/i;
const SAFE_UNQUOTED_CMD_ARG_RE = /^[A-Za-z0-9_./:@=+-]+$/;

/**
 * Developer / SDK / tool environment variables safely refreshed from Windows
 * HKLM + HKCU registry without touching process identity (`USERNAME`, `TEMP`,
 * `SystemRoot`, proxy overrides, or Electron/Prismux runtime vars).
 */
export const REFRESHABLE_WINDOWS_ENV_KEYS = new Set<string>([
  "ANDROID_HOME",
  "ANDROID_SDK_ROOT",
  "JAVA_HOME",
  "PNPM_HOME",
  "NVM_SYMLINK",
  "NVM_HOME",
  "VOLTA_HOME",
  "FNM_DIR",
  "BUN_INSTALL",
  "DENO_INSTALL",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "GOPATH",
  "GOROOT",
  "HF_ENDPOINT",
  "PRISMUX_7ZA_PATH",
  "PRISMUX_SQLITE_VEC_PATH",
  "PATHEXT",
  "STEAM_PATH"
]);

export interface ParsedRegistryEnvEntry {
  name: string;
  type: string;
  value: string;
}

export interface SafeCliSpawnSpec {
  file: string;
  args: string[];
  windowsVerbatimArguments: boolean;
  env: Record<string, string>;
  usesCmdWrapper: boolean;
}

export interface WindowsEnvRefreshOptions {
  /** Target environment map to mutate in place (defaults to `process.env`). */
  targetEnv?: Record<string, string | undefined>;
  /** Override platform for deterministic unit tests (defaults to `process.platform`). */
  platform?: NodeJS.Platform;
  /** Per-hive `reg.exe query` timeout in milliseconds (default 600ms). */
  timeoutMs?: number;
  /** Injectable registry reader for deterministic unit tests. */
  queryRegistryHive?: (hiveKey: string, timeoutMs: number) => Promise<string>;
}

export interface WindowsEnvRefreshResult {
  refreshed: boolean;
  updatedKeys: string[];
  pathEntryCount: number;
  error?: string;
}

/**
 * Decodes `reg.exe` raw stdout bytes safely across UTF-8 and legacy Windows
 * Chinese/OEM codepages (falling back to GB18030 if strict UTF-8 fails).
 */
export function decodeWindowsProcessOutput(raw: Buffer | string): string {
  if (typeof raw === "string") {
    return raw;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    try {
      return new TextDecoder("gb18030").decode(raw);
    } catch {
      return raw.toString("utf8");
    }
  }
}

/**
 * Parses `reg.exe query <key>` stdout into structured environment entries.
 * Handles `REG_SZ` and `REG_EXPAND_SZ` values including spaces, Chinese paths,
 * and empty values.
 */
export function parseRegQueryOutput(stdout: string): ParsedRegistryEnvEntry[] {
  const entries: ParsedRegistryEnvEntry[] = [];
  const lineRe = /^\s{2,}(.+?)\s{4,}(REG_[A-Z0-9_]+)(?:\s{4,}(.*))?$/;

  for (const rawLine of stdout.split(/\r?\n/)) {
    if (!rawLine || rawLine.trim().length === 0) {
      continue;
    }
    const match = lineRe.exec(rawLine);
    if (!match) {
      continue;
    }
    const name = match[1]?.trim() ?? "";
    const type = match[2]?.trim() ?? "";
    const value = (match[3] ?? "").trimEnd();
    if (!name || name === "(Default)") {
      continue;
    }
    if (type !== "REG_SZ" && type !== "REG_EXPAND_SZ") {
      continue;
    }
    entries.push({ name, type, value });
  }

  return entries;
}

function buildCaseInsensitiveLookup(
  ...sources: Array<Record<string, string | undefined>>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "string" && value.length > 0) {
        map.set(key.toUpperCase(), value);
      }
    }
  }
  return map;
}

/**
 * Expands Windows `%VAR%` references up to 3 passes using a case-insensitive
 * lookup map. Unresolved variables are preserved verbatim.
 */
export function expandWindowsEnvVars(
  input: string,
  lookup: ReadonlyMap<string, string>
): string {
  if (!input.includes("%")) {
    return input;
  }
  let current = input;
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    const next = current.replace(/%([^%\r\n]+)%/g, (full, varName: string) => {
      const resolved = lookup.get(varName.trim().toUpperCase());
      if (resolved !== undefined) {
        changed = true;
        return resolved;
      }
      return full;
    });
    current = next;
    if (!changed || !current.includes("%")) {
      break;
    }
  }
  return current;
}

function normalizeWinPathEntryKey(entry: string): string {
  const cleaned = entry.trim().replace(/^"|"$/g, "").replace(/\//g, "\\");
  // Keep drive roots like `C:\` intact; strip redundant trailing backslashes elsewhere.
  const withoutTrailing =
    cleaned.length > 3 ? cleaned.replace(/\\+$/, "") : cleaned;
  return withoutTrailing.toLowerCase();
}

function splitPathList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  const out: string[] = [];
  for (const segment of raw.split(";")) {
    const trimmed = segment.trim().replace(/^"|"$/g, "");
    if (trimmed.length > 0) {
      out.push(trimmed);
    }
  }
  return out;
}

/**
 * Merges Windows `PATH` segments from process, HKLM, and HKCU while:
 * 1. Keeping process-only entries (e.g. session shims, virtualenvs, test overrides)
 *    ahead so active tool overrides remain intact;
 * 2. Appending fresh HKLM + HKCU entries (including newly installed WinGet / npm
 *    / Android SDK paths) without case-insensitive duplicates.
 */
export function mergeWindowsPathLists(
  processPath: string | undefined,
  hklmPath: string | undefined,
  hkcuPath: string | undefined
): string {
  const hklmEntries = splitPathList(hklmPath);
  const hkcuEntries = splitPathList(hkcuPath);
  const processEntries = splitPathList(processPath);

  const registryKeys = new Set<string>();
  for (const item of [...hklmEntries, ...hkcuEntries]) {
    registryKeys.add(normalizeWinPathEntryKey(item));
  }

  const processOnly = processEntries.filter(
    (item) => !registryKeys.has(normalizeWinPathEntryKey(item))
  );

  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of [...processOnly, ...hklmEntries, ...hkcuEntries]) {
    const key = normalizeWinPathEntryKey(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  return merged.join(";");
}

function findEnvKeyCaseInsensitive(
  env: Record<string, string | undefined>,
  targetName: string
): string | undefined {
  const upper = targetName.toUpperCase();
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === upper) {
      return key;
    }
  }
  return undefined;
}

function getEnvValueCaseInsensitive(
  env: Record<string, string | undefined>,
  targetName: string
): string | undefined {
  const key = findEnvKeyCaseInsensitive(env, targetName);
  return key !== undefined ? env[key] : undefined;
}

function setEnvValuePreservingKeyCase(
  env: Record<string, string | undefined>,
  canonicalKey: string,
  value: string
): void {
  const existingKey = findEnvKeyCaseInsensitive(env, canonicalKey);
  env[existingKey ?? canonicalKey] = value;
}

async function defaultQueryRegistryHive(
  hiveKey: string,
  timeoutMs: number
): Promise<string> {
  const { stdout } = await execFileAsync("reg.exe", ["query", hiveKey], {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
    encoding: "buffer",
    env: sanitizeChildEnv(process.env)
  });
  return decodeWindowsProcessOutput(stdout);
}

/**
 * Refreshes Windows user & system environment variables (`HKLM` + `HKCU`) into
 * `targetEnv` (default `process.env`) asynchronously so newly installed CLIs,
 * WinGet packages, and SDK environment variables (`ANDROID_HOME`, `PATH`, etc.)
 * are immediately visible without restarting Prismux.
 *
 * Non-Windows platforms return immediately as a no-op; registry read errors or
 * timeouts degrade gracefully without throwing.
 */
export async function refreshWindowsEnvironmentFromRegistry(
  options: WindowsEnvRefreshOptions = {}
): Promise<WindowsEnvRefreshResult> {
  const platform = options.platform ?? process.platform;
  const targetEnv = options.targetEnv ?? process.env;
  if (platform !== "win32") {
    return { refreshed: false, updatedKeys: [], pathEntryCount: 0 };
  }

  const timeoutMs = Math.max(
    100,
    options.timeoutMs ?? DEFAULT_REG_QUERY_TIMEOUT_MS
  );
  const queryHive = options.queryRegistryHive ?? defaultQueryRegistryHive;

  const [hklmResult, hkcuResult] = await Promise.allSettled([
    queryHive(WINDOWS_HKLM_ENV_KEY, timeoutMs),
    queryHive(WINDOWS_HKCU_ENV_KEY, timeoutMs)
  ]);

  const errors: string[] = [];
  const hklmEntries =
    hklmResult.status === "fulfilled"
      ? parseRegQueryOutput(hklmResult.value)
      : (errors.push(
          `HKLM: ${hklmResult.reason instanceof Error ? hklmResult.reason.message : String(hklmResult.reason)}`
        ),
        []);
  const hkcuEntries =
    hkcuResult.status === "fulfilled"
      ? parseRegQueryOutput(hkcuResult.value)
      : (errors.push(
          `HKCU: ${hkcuResult.reason instanceof Error ? hkcuResult.reason.message : String(hkcuResult.reason)}`
        ),
        []);

  if (hklmEntries.length === 0 && hkcuEntries.length === 0) {
    return {
      refreshed: false,
      updatedKeys: [],
      pathEntryCount: splitPathList(getEnvValueCaseInsensitive(targetEnv, "PATH")).length,
      ...(errors.length > 0 ? { error: errors.join("; ") } : {})
    };
  }

  const hklmMap: Record<string, string> = {};
  const hkcuMap: Record<string, string> = {};
  let rawHklmPath: string | undefined;
  let rawHkcuPath: string | undefined;

  for (const entry of hklmEntries) {
    const upper = entry.name.toUpperCase();
    if (upper === "PATH") {
      rawHklmPath = entry.value;
    } else if (entry.value.trim().length > 0) {
      hklmMap[upper] = entry.value;
    }
  }
  for (const entry of hkcuEntries) {
    const upper = entry.name.toUpperCase();
    if (upper === "PATH") {
      rawHkcuPath = entry.value;
    } else if (entry.value.trim().length > 0) {
      hkcuMap[upper] = entry.value;
    }
  }

  // Expansion lookup: existing process env (keeps USERPROFILE / LOCALAPPDATA / SystemRoot)
  // overlaid with non-path HKLM and HKCU refreshable vars.
  const refreshableRegistryValues: Record<string, string> = {};
  for (const key of REFRESHABLE_WINDOWS_ENV_KEYS) {
    const fromHkcu = hkcuMap[key];
    const fromHklm = hklmMap[key];
    const chosen = fromHkcu ?? fromHklm;
    if (chosen !== undefined && chosen.trim().length > 0) {
      refreshableRegistryValues[key] = chosen.trim();
    }
  }

  const lookup = buildCaseInsensitiveLookup(targetEnv, refreshableRegistryValues);
  const updatedKeys: string[] = [];

  for (const [key, rawValue] of Object.entries(refreshableRegistryValues)) {
    const expanded = expandWindowsEnvVars(rawValue, lookup);
    if (expanded.length === 0) {
      continue;
    }
    const prev = getEnvValueCaseInsensitive(targetEnv, key);
    if (prev !== expanded) {
      setEnvValuePreservingKeyCase(targetEnv, key, expanded);
      updatedKeys.push(key);
    }
    lookup.set(key.toUpperCase(), expanded);
  }

  const expandedHklmPath =
    rawHklmPath !== undefined ? expandWindowsEnvVars(rawHklmPath, lookup) : undefined;
  const expandedHkcuPath =
    rawHkcuPath !== undefined ? expandWindowsEnvVars(rawHkcuPath, lookup) : undefined;
  const prevPath = getEnvValueCaseInsensitive(targetEnv, "PATH");
  const mergedPath = mergeWindowsPathLists(
    prevPath,
    expandedHklmPath,
    expandedHkcuPath
  );

  if (mergedPath.length > 0 && mergedPath !== prevPath) {
    setEnvValuePreservingKeyCase(targetEnv, "PATH", mergedPath);
    updatedKeys.push("PATH");
  }

  return {
    refreshed: true,
    updatedKeys,
    pathEntryCount: splitPathList(mergedPath).length,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {})
  };
}

/**
 * Returns the executable extension search order for `findExecutableOnPath`.
 *
 * On Windows, strictly prioritizes directly spawnable extensions
 * (`.exe` -> `.cmd` -> `.bat` -> `.com`) and NEVER returns `""` for bare
 * command names, preventing extensionless npm POSIX shims (e.g.
 * `%APPDATA%\npm\codex`) from shadowing `codex.cmd` and causing `ENOENT`.
 */
export function resolveExecutableExtensions(
  platform: NodeJS.Platform = process.platform,
  pathext?: string
): readonly string[] {
  if (platform !== "win32") {
    return [""];
  }

  // Always enforce `.exe -> .cmd -> .bat -> .com` priority; if PATHEXT is
  // provided, keep only spawnable executable extensions in this safe priority
  // order (never `""`, `.ps1`, `.js`, etc.).
  if (!pathext || pathext.trim().length === 0) {
    return WIN32_SPAWNABLE_EXTENSIONS;
  }

  const declared = new Set(
    pathext
      .split(";")
      .map((ext) => ext.trim().toLowerCase())
      .filter((ext) => ext.startsWith("."))
  );

  const ordered: string[] = [];
  for (const ext of WIN32_SPAWNABLE_EXTENSIONS) {
    if (declared.has(ext) || ext === ".exe" || ext === ".cmd" || ext === ".bat") {
      ordered.push(ext);
    }
  }
  return ordered.length > 0 ? ordered : WIN32_SPAWNABLE_EXTENSIONS;
}

function isFileSafe(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Locates an executable on `PATH` (plus optional fallback directories).
 * On Windows, bare names strictly match `.exe -> .cmd -> .bat -> .com` and
 * never pick extensionless POSIX shell shims.
 */
export function findExecutableOnPath(
  commandNames: readonly string[],
  options: {
    env?: Record<string, string | undefined>;
    platform?: NodeJS.Platform;
    extraDirs?: readonly string[];
  } = {}
): string | null {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const sep = platform === "win32" ? ";" : ":";
  const pathEnv = getEnvValueCaseInsensitive(env, "PATH") ?? "";
  const pathext = getEnvValueCaseInsensitive(env, "PATHEXT");
  const exts = resolveExecutableExtensions(platform, pathext);

  // If a command already contains path separators, resolve it directly first.
  for (const cmd of commandNames) {
    if (cmd.includes("/") || cmd.includes("\\")) {
      const hasWinExeExt =
        platform === "win32" && WIN32_EXPLICIT_EXECUTABLE_EXT_RE.test(cmd);
      const variants =
        platform !== "win32" || hasWinExeExt
          ? [cmd]
          : exts.map((ext) => `${cmd}${ext}`);
      for (const candidate of variants) {
        if (isFileSafe(candidate)) {
          return candidate;
        }
      }
    }
  }

  const rawDirs = [...pathEnv.split(sep), ...(options.extraDirs ?? [])];
  const seenDirs = new Set<string>();

  for (const rawDir of rawDirs) {
    const dir = rawDir.trim().replace(/^"|"$/g, "");
    if (!dir) {
      continue;
    }
    const dedupKey = platform === "win32" ? normalizeWinPathEntryKey(dir) : dir;
    if (seenDirs.has(dedupKey)) {
      continue;
    }
    seenDirs.add(dedupKey);

    for (const cmd of commandNames) {
      if (cmd.includes("/") || cmd.includes("\\")) {
        continue;
      }
      const hasExplicitExt =
        platform === "win32"
          ? WIN32_EXPLICIT_EXECUTABLE_EXT_RE.test(cmd)
          : false;
      const variants = hasExplicitExt
        ? [cmd]
        : exts.map((ext) => `${cmd}${ext}`);

      for (const variant of variants) {
        const candidate = join(dir, variant);
        if (isFileSafe(candidate)) {
          return candidate;
        }
      }
    }
  }

  return null;
}

/**
 * Quotes a single token for `cmd.exe /d /s /c "..."` (with
 * `windowsVerbatimArguments: true`). Strips control/newline characters and
 * wraps executable paths or arguments containing whitespace/metacharacters.
 */
export function quoteWindowsCmdToken(token: string, forceQuote = false): string {
  const sanitized = token.replace(/[\r\n\0]/g, "");
  if (!forceQuote && sanitized.length > 0 && SAFE_UNQUOTED_CMD_ARG_RE.test(sanitized)) {
    return sanitized;
  }
  const escaped = sanitized.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Builds a safe, sanitized `execFile` spawn specification for probing CLIs.
 *
 * - Strips `ELECTRON_RUN_AS_NODE` and `ELECTRON_NO_ATTACH_CONSOLE`.
 * - On Windows `.cmd` / `.bat` targets, invokes `cmd.exe /d /s /c` with
 *   `windowsVerbatimArguments: true` and outer quotes stripped cleanly by `/s`,
 *   supporting executable paths and arguments containing spaces.
 */
export function buildSafeCliSpawnSpec(
  executablePath: string,
  args: readonly string[],
  options: {
    platform?: NodeJS.Platform;
    env?: Record<string, string | undefined>;
  } = {}
): SafeCliSpawnSpec {
  const platform = options.platform ?? process.platform;
  const cleanEnv = sanitizeChildEnv(options.env ?? process.env);

  if (platform === "win32" && WIN32_CMD_SCRIPT_EXT_RE.test(executablePath)) {
    const comspec =
      getEnvValueCaseInsensitive(cleanEnv, "COMSPEC")?.trim() || "cmd.exe";
    const quotedExe = quoteWindowsCmdToken(executablePath, true);
    const quotedArgs = args.map((arg) => quoteWindowsCmdToken(arg, false));
    const innerCommand =
      quotedArgs.length > 0 ? `${quotedExe} ${quotedArgs.join(" ")}` : quotedExe;
    return {
      file: comspec,
      args: ["/d", "/s", "/c", `"${innerCommand}"`],
      windowsVerbatimArguments: true,
      env: cleanEnv,
      usesCmdWrapper: true
    };
  }

  return {
    file: executablePath,
    args: [...args],
    windowsVerbatimArguments: false,
    env: cleanEnv,
    usesCmdWrapper: false
  };
}
