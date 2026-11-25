// @effect-diagnostics nodeBuiltinImport:off - Startup upgrade migration must run synchronously before Chromium opens caches or Electron layers read settings.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { resolveDesktopBaseDir, resolveDesktopStateDir } from "../app/DesktopStatePaths.ts";

export const PRISMUX_UPGRADE_MIGRATION_VERSION = "0.2.0-rc.1" as const;
export const UPGRADE_MIGRATIONS_STATE_FILENAME = "upgrade-migrations.json" as const;

export const DEPRECATED_CLIENT_SETTINGS_KEYS = [
  "appearanceContrast",
  "chatWidth",
  "t3ConnectActiveTab",
  "t3ConnectCachedAccount",
  "t3ConnectSession",
  "t3ConnectState",
  "t3ConnectAccount",
  "t3ConnectUser",
  "clerkSession",
  "clerkUser",
] as const;

export const DEPRECATED_CONNECT_SETTINGS_KEYS = [
  "t3ConnectActiveTab",
  "t3ConnectCachedAccount",
  "t3ConnectSession",
  "t3ConnectState",
  "t3ConnectAccount",
  "t3ConnectUser",
  "clerkSession",
  "clerkUser",
] as const;

export const RETIRED_PLUGIN_DIR_NAMES = [
  "pet",
  "plugin-pet",
  "prismux-plugin-pet",
  "ssh",
  "plugin-ssh",
  "prismux-plugin-ssh",
] as const;

export const ACTIVE_OFFICIAL_PLUGIN_DIR_NAMES = [
  "qq",
  "plugin-qq",
  "prismux-plugin-qq",
  "fishdock-hook",
  "plugin-fishdock-hook",
  "prismux-plugin-fishdock-hook",
] as const;

export const OBSOLETE_APPDATA_CACHE_RELPATHS = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUPersistentCache",
  "blob_storage",
  "Service Worker/CacheStorage",
  "Service Worker/ScriptCache",
  "Crashpad/reports",
  "Crashpad/completed",
  "t3-connect-cache",
  "clerk-cache",
] as const;

export const OBSOLETE_LOCALAPPDATA_CACHE_RELPATHS = [
  "EBWebView",
  "Cache",
  "Code Cache",
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUPersistentCache",
  "Temp",
  "Crashpad",
  "updater-cache",
  "t3-connect-cache",
] as const;

export const OBSOLETE_T3_CONNECT_STATE_RELPATHS = [
  "clerk/clerk-tokens.json",
  "clerk-tokens.json",
  "relay-clients",
  "t3-connect.json",
  "t3-connect-state.json",
  "t3-connect-cache.json",
  "cloud-link.json",
] as const;

export interface PrismuxUpgradeMigrationPaths {
  readonly platform: NodeJS.Platform;
  readonly baseDir: string;
  readonly stateDir: string;
  readonly appDataDir: string;
  readonly localAppDataDir: string;
  readonly isDevelopment: boolean;
}

export interface PrismuxUpgradeMigrationOptions {
  readonly platform?: NodeJS.Platform;
  readonly homeDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly baseDir?: string;
  readonly stateDir?: string;
  readonly appDataDir?: string;
  readonly localAppDataDir?: string;
  readonly isDevelopment?: boolean;
  readonly nowIso?: () => string;
}

export interface PrismuxUpgradeMigrationErrorEntry {
  readonly path: string;
  readonly message: string;
}

export interface PrismuxUpgradeMigrationResult {
  readonly migrationId: typeof PRISMUX_UPGRADE_MIGRATION_VERSION;
  readonly skipped: boolean;
  readonly markerPath: string;
  readonly removedPaths: readonly string[];
  readonly removedRetiredPlugins: readonly string[];
  readonly strippedSettingsKeys: readonly string[];
  readonly errors: readonly PrismuxUpgradeMigrationErrorEntry[];
}

interface UpgradeMigrationMarkerRecord {
  readonly completedAt: string;
  readonly removedPathsCount: number;
  readonly removedRetiredPlugins: readonly string[];
  readonly strippedSettingsKeys: readonly string[];
}

interface UpgradeMigrationsStateDocument {
  readonly schemaVersion: 1;
  readonly completed: Record<string, UpgradeMigrationMarkerRecord>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePathForCompare(targetPath: string, platform: NodeJS.Platform): string {
  const resolved = NodePath.resolve(targetPath);
  const trimmed = resolved.replace(/[\\/]+$/, "");
  return platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

function isSameOrInsidePath(
  candidatePath: string,
  rootPath: string,
  platform: NodeJS.Platform,
): boolean {
  const normalizedCandidate = normalizePathForCompare(candidatePath, platform);
  const normalizedRoot = normalizePathForCompare(rootPath, platform);
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  const sep = platform === "win32" ? "\\" : NodePath.sep;
  const rootWithSep = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  if (platform === "win32") {
    return normalizedCandidate.startsWith(rootWithSep.replaceAll("/", "\\"));
  }
  return normalizedCandidate.startsWith(rootWithSep);
}

function deduplicatePaths(paths: readonly string[], platform: NodeJS.Platform): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of paths) {
    if (!candidate.trim()) continue;
    const key = normalizePathForCompare(candidate, platform);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(NodePath.resolve(candidate));
  }
  return unique;
}

/**
 * Defense-in-depth invariant: refuses deletion of any protected Prismux user data
 * (SQLite memory database, encrypted credentials, wallpapers, active plugins,
 * user sessions/projects, Chromium Local State/Local Storage/IndexedDB, or portable data/).
 */
export function isProtectedUserDataPath(
  candidatePath: string,
  paths: PrismuxUpgradeMigrationPaths,
): boolean {
  const { platform, baseDir, stateDir, localAppDataDir } = paths;
  const protectedRoots = [
    NodePath.join(baseDir, "data"),
    NodePath.join(baseDir, "credentials"),
    NodePath.join(baseDir, "wallpapers"),
    NodePath.join(stateDir, "state.sqlite"),
    NodePath.join(stateDir, "state.sqlite-wal"),
    NodePath.join(stateDir, "state.sqlite-shm"),
    NodePath.join(stateDir, "saved-environments.json"),
    NodePath.join(stateDir, "connection-catalog.json"),
    NodePath.join(stateDir, "threads"),
    NodePath.join(stateDir, "sessions"),
    NodePath.join(stateDir, "projects"),
    NodePath.join(localAppDataDir, "Prismux", "data"),
    NodePath.join(localAppDataDir, "prismux", "data"),
    ...ACTIVE_OFFICIAL_PLUGIN_DIR_NAMES.map((name) => NodePath.join(baseDir, "plugins", name)),
    ...ACTIVE_OFFICIAL_PLUGIN_DIR_NAMES.map((name) =>
      NodePath.join(baseDir, "data", "plugins", name),
    ),
  ];

  for (const protectedRoot of protectedRoots) {
    // Reject if candidate is inside a protected root OR is an ancestor that would wipe a protected root.
    if (
      isSameOrInsidePath(candidatePath, protectedRoot, platform) ||
      isSameOrInsidePath(protectedRoot, candidatePath, platform)
    ) {
      return true;
    }
  }

  const protectedLeafNames = new Set([
    "memory.db",
    "memory.db-wal",
    "memory.db-shm",
    "local state",
    "local storage",
    "indexeddb",
    "preferences",
    "cookies",
    "session storage",
  ]);
  const leafLower = NodePath.basename(candidatePath).toLowerCase();
  return protectedLeafNames.has(leafLower);
}

export function resolvePrismuxUpgradeMigrationPaths(
  options: PrismuxUpgradeMigrationOptions = {},
): PrismuxUpgradeMigrationPaths {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? NodeOS.homedir();
  const isDevelopment =
    options.isDevelopment ?? Boolean(env["VITE_DEV_SERVER_URL"]?.trim());

  const t3Home = env["T3CODE_HOME"]?.trim();
  const t3HomeOption = t3Home && t3Home.length > 0 ? Option.some(t3Home) : Option.none<string>();

  const baseDir =
    options.baseDir ??
    resolveDesktopBaseDir({
      homeDirectory: homeDir,
      joinPath: NodePath.join,
      t3Home: t3HomeOption,
    });

  const stateDir =
    options.stateDir ??
    resolveDesktopStateDir({
      baseDir,
      isDevelopment,
      joinPath: NodePath.join,
      t3Home: t3HomeOption,
    });

  const appDataDir =
    options.appDataDir ??
    (platform === "win32"
      ? (env["APPDATA"]?.trim() || NodePath.join(homeDir, "AppData", "Roaming"))
      : platform === "darwin"
        ? NodePath.join(homeDir, "Library", "Application Support")
        : (env["XDG_CONFIG_HOME"]?.trim() || NodePath.join(homeDir, ".config")));

  const localAppDataDir =
    options.localAppDataDir ??
    (platform === "win32"
      ? (env["LOCALAPPDATA"]?.trim() || NodePath.join(homeDir, "AppData", "Local"))
      : platform === "darwin"
        ? NodePath.join(homeDir, "Library", "Caches")
        : (env["XDG_CACHE_HOME"]?.trim() || NodePath.join(homeDir, ".cache")));

  return {
    platform,
    baseDir: NodePath.resolve(baseDir),
    stateDir: NodePath.resolve(stateDir),
    appDataDir: NodePath.resolve(appDataDir),
    localAppDataDir: NodePath.resolve(localAppDataDir),
    isDevelopment,
  };
}

function readMigrationState(markerPath: string): UpgradeMigrationsStateDocument {
  if (!NodeFS.existsSync(markerPath)) {
    return { schemaVersion: 1, completed: {} };
  }
  try {
    const parsed: unknown = JSON.parse(NodeFS.readFileSync(markerPath, "utf8"));
    if (!isPlainObject(parsed) || !isPlainObject(parsed["completed"])) {
      return { schemaVersion: 1, completed: {} };
    }
    const completed: Record<string, UpgradeMigrationMarkerRecord> = {};
    for (const [key, value] of Object.entries(parsed["completed"])) {
      if (isPlainObject(value) && typeof value["completedAt"] === "string") {
        completed[key] = {
          completedAt: value["completedAt"],
          removedPathsCount:
            typeof value["removedPathsCount"] === "number" ? value["removedPathsCount"] : 0,
          removedRetiredPlugins: Array.isArray(value["removedRetiredPlugins"])
            ? value["removedRetiredPlugins"].filter(
                (item): item is string => typeof item === "string",
              )
            : [],
          strippedSettingsKeys: Array.isArray(value["strippedSettingsKeys"])
            ? value["strippedSettingsKeys"].filter(
                (item): item is string => typeof item === "string",
              )
            : [],
        };
      }
    }
    return { schemaVersion: 1, completed };
  } catch {
    return { schemaVersion: 1, completed: {} };
  }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = NodePath.dirname(filePath);
  NodeFS.mkdirSync(dir, { recursive: true });
  const suffix = NodeCrypto.randomBytes(6).toString("hex");
  const tempPath = `${filePath}.${process.pid}.${suffix}.tmp`;
  try {
    NodeFS.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    NodeFS.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      NodeFS.rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup error for temp file.
    }
    throw error;
  }
}

function safeRemovePath(
  targetPath: string,
  paths: PrismuxUpgradeMigrationPaths,
  removedPaths: string[],
  errors: PrismuxUpgradeMigrationErrorEntry[],
): boolean {
  if (isProtectedUserDataPath(targetPath, paths)) {
    return false;
  }

  let stat: NodeFS.Stats;
  try {
    stat = NodeFS.lstatSync(targetPath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false;
    }
    errors.push({
      path: targetPath,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  // Never recursively follow symlinks when sweeping directories.
  if (stat.isSymbolicLink()) {
    return false;
  }

  try {
    NodeFS.rmSync(targetPath, { recursive: stat.isDirectory(), force: true });
    removedPaths.push(targetPath);
    return true;
  } catch (error) {
    errors.push({
      path: targetPath,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function stripDeprecatedKeysFromJsonFile(
  filePath: string,
  keysToStrip: readonly string[],
  errors: PrismuxUpgradeMigrationErrorEntry[],
): string[] {
  if (!NodeFS.existsSync(filePath)) {
    return [];
  }

  let raw: string;
  try {
    const stat = NodeFS.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return [];
    }
    raw = NodeFS.readFileSync(filePath, "utf8");
  } catch (error) {
    errors.push({
      path: filePath,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Preserve unparseable or JSONC user files untouched rather than risking data loss.
    return [];
  }

  if (!isPlainObject(parsed)) {
    return [];
  }

  const stripped: string[] = [];
  const keySet = new Set<string>(keysToStrip);

  for (const key of Object.keys(parsed)) {
    if (keySet.has(key)) {
      delete parsed[key];
      stripped.push(key);
    }
  }

  // DesktopClientSettings supports both top-level and `{ settings: { ... } }` envelope formats.
  const nestedSettings = parsed["settings"];
  if (isPlainObject(nestedSettings)) {
    for (const key of Object.keys(nestedSettings)) {
      if (keySet.has(key)) {
        delete nestedSettings[key];
        if (!stripped.includes(key)) {
          stripped.push(key);
        }
      }
    }
  }

  if (stripped.length === 0) {
    return [];
  }

  try {
    writeJsonAtomic(filePath, parsed);
    return stripped;
  } catch (error) {
    errors.push({
      path: filePath,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Executes versioned idempotent one-time upgrade cleanup for `0.2.0-rc.1`:
 * 1. Sweeps obsolete cache directories under %APPDATA%\Prismux and %LOCALAPPDATA%\Prismux
 *    (plus legacy Prismux (Alpha), Tauri WebView2 EBWebView, and stale updater pending cache).
 * 2. Removes retired `pet` and `ssh` plugin directories under ~/.prismux/plugins/ while
 *    strictly preserving active official plugins (`qq`, `fishdock-hook`) and third-party plugins.
 * 3. Strips deprecated settings keys (`appearanceContrast`, `chatWidth`, obsolete T3 Connect
 *    cached keys) and removes obsolete T3 Connect / Clerk token caches.
 * 4. Strictly preserves `memory.db`, `credentials/`, wallpapers, active plugins, and all
 *    user sessions/projects.
 */
export function runPrismuxUpgradeMigrations(
  options: PrismuxUpgradeMigrationOptions = {},
): PrismuxUpgradeMigrationResult {
  const paths = resolvePrismuxUpgradeMigrationPaths(options);
  const markerPath = NodePath.join(paths.stateDir, UPGRADE_MIGRATIONS_STATE_FILENAME);
  const existingState = readMigrationState(markerPath);

  if (existingState.completed[PRISMUX_UPGRADE_MIGRATION_VERSION] !== undefined) {
    return {
      migrationId: PRISMUX_UPGRADE_MIGRATION_VERSION,
      skipped: true,
      markerPath,
      removedPaths: [],
      removedRetiredPlugins: [],
      strippedSettingsKeys: [],
      errors: [],
    };
  }

  const removedPaths: string[] = [];
  const removedRetiredPlugins: string[] = [];
  const strippedSettingsKeys: string[] = [];
  const errors: PrismuxUpgradeMigrationErrorEntry[] = [];

  // 1. Clean obsolete disposable caches under %APPDATA%\Prismux (and legacy Prismux (Alpha)).
  const appDataRoots = deduplicatePaths(
    [
      NodePath.join(paths.appDataDir, "Prismux"),
      NodePath.join(paths.appDataDir, "prismux"),
      NodePath.join(paths.appDataDir, "Prismux (Alpha)"),
    ],
    paths.platform,
  );
  for (const appDataRoot of appDataRoots) {
    for (const relCache of OBSOLETE_APPDATA_CACHE_RELPATHS) {
      safeRemovePath(NodePath.join(appDataRoot, relCache), paths, removedPaths, errors);
    }
  }

  // 2. Clean obsolete disposable caches under %LOCALAPPDATA%\Prismux, Tauri WebView2, and updater cache.
  const localAppDataRoots = deduplicatePaths(
    [
      NodePath.join(paths.localAppDataDir, "Prismux"),
      NodePath.join(paths.localAppDataDir, "prismux"),
    ],
    paths.platform,
  );
  for (const localRoot of localAppDataRoots) {
    for (const relCache of OBSOLETE_LOCALAPPDATA_CACHE_RELPATHS) {
      safeRemovePath(NodePath.join(localRoot, relCache), paths, removedPaths, errors);
    }
  }
  safeRemovePath(
    NodePath.join(paths.localAppDataDir, "io.prismux.desktop", "EBWebView"),
    paths,
    removedPaths,
    errors,
  );
  safeRemovePath(
    NodePath.join(paths.localAppDataDir, "prismux-updater", "pending"),
    paths,
    removedPaths,
    errors,
  );

  // 3. Remove retired `pet` and `ssh` plugin leftovers ONLY (never touch qq, fishdock-hook, or user plugins).
  const pluginRoots = deduplicatePaths([NodePath.join(paths.baseDir, "plugins")], paths.platform);
  for (const pluginRoot of pluginRoots) {
    for (const retiredName of RETIRED_PLUGIN_DIR_NAMES) {
      const target = NodePath.join(pluginRoot, retiredName);
      if (safeRemovePath(target, paths, removedPaths, errors)) {
        removedRetiredPlugins.push(retiredName);
      }
    }
  }

  // 4. Remove obsolete T3 Connect / Clerk cached state files inside stateDir.
  for (const relState of OBSOLETE_T3_CONNECT_STATE_RELPATHS) {
    safeRemovePath(NodePath.join(paths.stateDir, relState), paths, removedPaths, errors);
  }

  // 5. Strip deprecated settings keys (`appearanceContrast`, `chatWidth`, obsolete T3 Connect keys).
  const clientStripped = stripDeprecatedKeysFromJsonFile(
    NodePath.join(paths.stateDir, "client-settings.json"),
    DEPRECATED_CLIENT_SETTINGS_KEYS,
    errors,
  );
  for (const key of clientStripped) {
    if (!strippedSettingsKeys.includes(key)) {
      strippedSettingsKeys.push(key);
    }
  }

  for (const secondaryFile of ["desktop-settings.json", "settings.json"] as const) {
    const secondaryStripped = stripDeprecatedKeysFromJsonFile(
      NodePath.join(paths.stateDir, secondaryFile),
      DEPRECATED_CONNECT_SETTINGS_KEYS,
      errors,
    );
    for (const key of secondaryStripped) {
      if (!strippedSettingsKeys.includes(key)) {
        strippedSettingsKeys.push(key);
      }
    }
  }

  // 6. Persist idempotent completion marker.
  const completedAt = options.nowIso ? options.nowIso() : DateTime.formatIso(DateTime.nowUnsafe());
  const nextState: UpgradeMigrationsStateDocument = {
    schemaVersion: 1,
    completed: {
      ...existingState.completed,
      [PRISMUX_UPGRADE_MIGRATION_VERSION]: {
        completedAt,
        removedPathsCount: removedPaths.length,
        removedRetiredPlugins,
        strippedSettingsKeys,
      },
    },
  };
  try {
    writeJsonAtomic(markerPath, nextState);
  } catch (error) {
    errors.push({
      path: markerPath,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    migrationId: PRISMUX_UPGRADE_MIGRATION_VERSION,
    skipped: false,
    markerPath,
    removedPaths,
    removedRetiredPlugins,
    strippedSettingsKeys,
    errors,
  };
}

/**
 * Best-effort startup hook invoked in Electron main.ts prior to cache/settings initialization.
 * Never throws so startup cannot be blocked by transient filesystem locks.
 */
export function runPrismuxStartupUpgradeMigration(
  options: PrismuxUpgradeMigrationOptions = {},
): PrismuxUpgradeMigrationResult | null {
  try {
    return runPrismuxUpgradeMigrations(options);
  } catch {
    return null;
  }
}
