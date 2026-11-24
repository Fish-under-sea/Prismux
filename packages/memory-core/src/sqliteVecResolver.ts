import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export const PRISMUX_SQLITE_VEC_PATH_ENV = "PRISMUX_SQLITE_VEC_PATH" as const;
export const PRISMUX_RESOURCES_PATH_ENV = "PRISMUX_RESOURCES_PATH" as const;

export type SqliteVecCandidateSource =
  | "explicit-config"
  | "env"
  | "electron-resources"
  | "local-node-modules"
  | "sqlite-vec-package";

export interface SqliteVecPlatformSpec {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly osToken: string;
  readonly packageName: string;
  readonly baseName: "vec0";
  readonly extension: "dll" | "dylib" | "so";
  readonly libraryFileName: "vec0.dll" | "vec0.dylib" | "vec0.so";
}

export interface SqliteVecCandidate {
  readonly path: string;
  readonly source: SqliteVecCandidateSource;
}

export interface ResolveSqliteVecCandidatesOptions {
  readonly explicitPath?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly resourcesPath?: string | null;
  readonly cwd?: string;
  readonly moduleDir?: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
}

export interface LoadSqliteVecOptions extends ResolveSqliteVecCandidatesOptions {
  /** Whether to fall back to `import("sqlite-vec").getLoadablePath()` (default: true). */
  readonly allowPackageImport?: boolean;
}

export interface SqliteVecLoadResult {
  readonly loaded: boolean;
  readonly version: string | null;
  readonly extensionPath: string | null;
  readonly source: SqliteVecCandidateSource | null;
  readonly error: string | null;
  readonly searchedPaths: readonly string[];
}

export interface SqliteVecLoadStatus {
  readonly loaded: boolean;
  readonly mode: "fts5+sqlite-vec" | "fts5-only";
  readonly version: string | null;
  readonly extensionPath: string | null;
  readonly source: SqliteVecCandidateSource | null;
  readonly error: string | null;
}

export function getSqliteVecPlatformSpec(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): SqliteVecPlatformSpec {
  const osToken = platform === "win32" ? "windows" : platform;
  const extension: "dll" | "dylib" | "so" =
    platform === "win32" ? "dll" : platform === "darwin" ? "dylib" : "so";
  const libraryFileName: "vec0.dll" | "vec0.dylib" | "vec0.so" =
    platform === "win32"
      ? "vec0.dll"
      : platform === "darwin"
        ? "vec0.dylib"
        : "vec0.so";

  return {
    platform,
    arch,
    osToken,
    packageName: `sqlite-vec-${osToken}-${arch}`,
    baseName: "vec0",
    extension,
    libraryFileName
  };
}

/**
 * Rewrites paths pointing inside an `.asar` archive to `.asar.unpacked` first,
 * because OS dynamic library loaders (e.g., Windows `LoadLibraryW`) cannot load
 * native shared libraries from inside an ASAR archive.
 */
export function normalizeAsarUnpackedCandidates(candidatePath: string): string[] {
  const asarPattern = /([\\/][^\\/]+\.asar)([\\/])/i;
  if (!asarPattern.test(candidatePath) || /\.asar\.unpacked([\\/]|$)/i.test(candidatePath)) {
    return [candidatePath];
  }
  const unpackedPath = candidatePath.replace(asarPattern, "$1.unpacked$2");
  return unpackedPath === candidatePath
    ? [candidatePath]
    : [unpackedPath, candidatePath];
}

function getProcessResourcesPath(): string | undefined {
  const proc = process as NodeJS.Process & { resourcesPath?: unknown };
  return typeof proc.resourcesPath === "string" && proc.resourcesPath.trim().length > 0
    ? proc.resourcesPath.trim()
    : undefined;
}

function normalizeCandidateKey(filePath: string, platform: NodeJS.Platform): string {
  const resolved = resolve(filePath);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Builds the deterministic priority-ordered list of candidate `vec0` native
 * extension paths for dev mode, standalone daemon mode, and packaged Electron apps:
 *
 * 1. Explicit `vectorExtensionPath` config (strict override — no fallback) or `PRISMUX_SQLITE_VEC_PATH` env;
 * 2. Electron packaged `resourcesPath` outside `.asar` (`native/sqlite-vec/vec0.dll`,
 *    `prismux-daemon/native/vec0.dll`, `daemon/native/vec0.dll`,
 *    `prismux-daemon/node_modules/<pkg>/vec0.dll`, `app.asar.unpacked/...`);
 * 3. Local `cwd` and ancestor `node_modules/<pkg>/vec0.dll` directories.
 */
export function resolveSqliteVecCandidatePaths(
  options: ResolveSqliteVecCandidatesOptions = {}
): SqliteVecCandidate[] {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const spec = getSqliteVecPlatformSpec(platform, arch);
  const env = options.env ?? process.env;

  const candidates: SqliteVecCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (rawPath: string | undefined, source: SqliteVecCandidateSource) => {
    const trimmed = rawPath?.trim();
    if (!trimmed) {
      return;
    }
    for (const expanded of normalizeAsarUnpackedCandidates(trimmed)) {
      const resolved = resolve(expanded);
      const key = normalizeCandidateKey(resolved, platform);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push({ path: resolved, source });
    }
  };

  // Tier 1a: Explicit store config override is strict (never silently bypassed).
  const explicit = options.explicitPath?.trim();
  if (explicit) {
    pushCandidate(explicit, "explicit-config");
    return candidates;
  }

  // Tier 1b: Environment variable override (`PRISMUX_SQLITE_VEC_PATH`).
  const envOverride = env[PRISMUX_SQLITE_VEC_PATH_ENV]?.trim();
  if (envOverride) {
    pushCandidate(envOverride, "env");
  }

  // Tier 2: Electron packaged resources directory (outside .asar on real disk).
  const resourceRoots: string[] = [];
  if (options.resourcesPath !== null) {
    const directResources = options.resourcesPath?.trim() || getProcessResourcesPath();
    if (directResources) {
      resourceRoots.push(directResources);
    }
    const envResources = env[PRISMUX_RESOURCES_PATH_ENV]?.trim();
    if (envResources && !resourceRoots.includes(envResources)) {
      resourceRoots.push(envResources);
    }
  }

  for (const resRoot of resourceRoots) {
    pushCandidate(join(resRoot, "native", "sqlite-vec", spec.libraryFileName), "electron-resources");
    pushCandidate(join(resRoot, "prismux-daemon", "native", spec.libraryFileName), "electron-resources");
    pushCandidate(join(resRoot, "daemon", "native", spec.libraryFileName), "electron-resources");
    pushCandidate(
      join(resRoot, "prismux-daemon", "node_modules", spec.packageName, spec.libraryFileName),
      "electron-resources"
    );
    pushCandidate(
      join(resRoot, "daemon", "node_modules", spec.packageName, spec.libraryFileName),
      "electron-resources"
    );
    pushCandidate(
      join(resRoot, "app.asar.unpacked", "node_modules", spec.packageName, spec.libraryFileName),
      "electron-resources"
    );
    pushCandidate(
      join(resRoot, "server.asar.unpacked", "node_modules", spec.packageName, spec.libraryFileName),
      "electron-resources"
    );
  }

  // Tier 3: Working directory & module-relative node_modules / native folders.
  const cwd = options.cwd ?? process.cwd();
  pushCandidate(join(cwd, "native", "sqlite-vec", spec.libraryFileName), "local-node-modules");
  pushCandidate(join(cwd, "native", spec.libraryFileName), "local-node-modules");
  pushCandidate(join(cwd, "..", "native", "sqlite-vec", spec.libraryFileName), "local-node-modules");
  pushCandidate(join(cwd, "node_modules", spec.packageName, spec.libraryFileName), "local-node-modules");
  pushCandidate(
    join(cwd, "apps", "daemon", "node_modules", spec.packageName, spec.libraryFileName),
    "local-node-modules"
  );
  pushCandidate(
    join(cwd, "packages", "memory-core", "node_modules", spec.packageName, spec.libraryFileName),
    "local-node-modules"
  );

  const startModuleDir = options.moduleDir ?? dirname(fileURLToPath(import.meta.url));
  let cursor = resolve(startModuleDir);
  for (let depth = 0; depth < 6; depth += 1) {
    pushCandidate(join(cursor, "native", "sqlite-vec", spec.libraryFileName), "local-node-modules");
    pushCandidate(join(cursor, "native", spec.libraryFileName), "local-node-modules");
    pushCandidate(join(cursor, "node_modules", spec.packageName, spec.libraryFileName), "local-node-modules");
    pushCandidate(join(cursor, spec.packageName, spec.libraryFileName), "local-node-modules");

    const parent = dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  return candidates;
}

function resolveExistingLibraryFile(
  candidatePath: string,
  spec: SqliteVecPlatformSpec
): string | null {
  try {
    if (existsSync(candidatePath)) {
      const stat = statSync(candidatePath);
      if (stat.isFile() && stat.size > 0) {
        return resolve(candidatePath);
      }
      if (stat.isDirectory()) {
        const insideDir = join(candidatePath, spec.libraryFileName);
        if (existsSync(insideDir)) {
          const innerStat = statSync(insideDir);
          if (innerStat.isFile() && innerStat.size > 0) {
            return resolve(insideDir);
          }
        }
      }
    }
  } catch {
    // Fall through to suffix check.
  }

  const extSuffix = `.${spec.extension}`;
  if (!candidatePath.toLowerCase().endsWith(extSuffix)) {
    const withExt = `${candidatePath}${extSuffix}`;
    try {
      if (existsSync(withExt)) {
        const stat = statSync(withExt);
        if (stat.isFile() && stat.size > 0) {
          return resolve(withExt);
        }
      }
    } catch {
      // Ignore stat failures.
    }
  }

  return null;
}

function tryLoadExtensionBinary(
  db: DatabaseSync,
  libraryFilePath: string,
  spec: SqliteVecPlatformSpec
): string {
  const attempts: string[] = [libraryFilePath];
  const extSuffix = `.${spec.extension}`;
  if (libraryFilePath.toLowerCase().endsWith(extSuffix)) {
    attempts.push(libraryFilePath.slice(0, -extSuffix.length));
  }

  let lastError: unknown;
  for (const loadArg of attempts) {
    try {
      db.loadExtension(loadArg);
      const versionRow = db.prepare("SELECT vec_version() AS version").get() as
        | { version?: unknown }
        | undefined;
      const version =
        typeof versionRow?.version === "string" && versionRow.version.trim().length > 0
          ? versionRow.version.trim()
          : null;
      if (version === null) {
        throw new Error("sqlite-vec loaded but SELECT vec_version() returned empty output.");
      }
      return version;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Resolves and loads the native `sqlite-vec` shared library (`vec0.dll` / `.dylib` / `.so`)
 * into a `node:sqlite` `DatabaseSync` instance (which must be opened with `{ allowExtension: true }`)
 * and verifies readiness via `SELECT vec_version()`.
 */
export async function loadSqliteVecExtension(
  db: DatabaseSync,
  options: LoadSqliteVecOptions = {}
): Promise<SqliteVecLoadResult> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const spec = getSqliteVecPlatformSpec(platform, arch);
  const candidates = resolveSqliteVecCandidatePaths(options);
  const searchedPaths: string[] = [];
  const attemptedKeys = new Set<string>();
  let lastError: string | null = null;

  const tryCandidate = (candidate: SqliteVecCandidate): SqliteVecLoadResult | null => {
    const key = normalizeCandidateKey(candidate.path, platform);
    if (attemptedKeys.has(key)) {
      return null;
    }
    attemptedKeys.add(key);
    searchedPaths.push(candidate.path);

    const existingFile = resolveExistingLibraryFile(candidate.path, spec);
    if (existingFile === null) {
      return null;
    }

    try {
      const version = tryLoadExtensionBinary(db, existingFile, spec);
      return {
        loaded: true,
        version,
        extensionPath: existingFile,
        source: candidate.source,
        error: null,
        searchedPaths
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = `加载 ${existingFile} 失败：${message}`;
      return null;
    }
  };

  for (const candidate of candidates) {
    const loaded = tryCandidate(candidate);
    if (loaded !== null) {
      return loaded;
    }
  }

  // Final Tier 3 fallback: official `sqlite-vec` npm package `getLoadablePath()`
  // (skipped when caller provided a strict explicit `explicitPath` override).
  const hasStrictExplicitPath = Boolean(options.explicitPath?.trim());
  if (!hasStrictExplicitPath && options.allowPackageImport !== false) {
    try {
      const sqliteVec = await import("sqlite-vec");
      const packageLoadablePath = sqliteVec.getLoadablePath();
      for (const expanded of normalizeAsarUnpackedCandidates(packageLoadablePath)) {
        const loaded = tryCandidate({
          path: resolve(expanded),
          source: "sqlite-vec-package"
        });
        if (loaded !== null) {
          return loaded;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (lastError === null) {
        lastError = `sqlite-vec 包解析失败：${message}`;
      }
    }
  }

  return {
    loaded: false,
    version: null,
    extensionPath: null,
    source: null,
    error:
      lastError ??
      `未找到 ${spec.libraryFileName}（已检查 ${searchedPaths.length} 个候选路径）`,
    searchedPaths
  };
}
