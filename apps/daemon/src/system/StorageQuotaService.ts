import { createHash } from "node:crypto";
import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import type { SqliteMemoryStore } from "@prismux/memory-core";
import { BRAND } from "@prismux/protocol";
import type { AppUpdater } from "../updater/AppUpdater.js";

export const STORAGE_WARNING_THRESHOLD_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB
export const DEFAULT_STORAGE_CACHE_TTL_MS = 60_000; // 60s
const MAX_CHILDREN_PER_CATEGORY = 25;
const MAX_SCAN_DEPTH = 16;

export type StorageSafetyTier = "disposable" | "managed" | "protected";

export type StorageCleanAction =
  | "clean-cache"
  | "clean-logs"
  | "clean-updates"
  | "clean-legacy"
  | "clean-artifacts"
  | "clean-worktrees"
  | "clean-wallpapers"
  | "compact-db";

export interface StorageRootSummary {
  id: string;
  label: string;
  path: string;
  bytes: number;
  exists: boolean;
}

export interface StorageCategoryEntry {
  id: string;
  name: string;
  path: string;
  bytes: number;
  fileCount: number;
  tier: StorageSafetyTier;
  categoryId: string;
  cleanable: boolean;
  cleanAction?: StorageCleanAction;
  children?: StorageCategoryEntry[];
}

export interface StoragePolicySummary {
  id: string;
  label: string;
  limitLabel: string;
  active: boolean;
}

export interface StorageInventoryResponse {
  ok: true;
  scannedAt: string;
  durationMs: number;
  totalBytes: number;
  reclaimableDisposableBytes: number;
  reclaimableManagedBytes: number;
  protectedBytes: number;
  warningThresholdBytes: number;
  roots: StorageRootSummary[];
  categories: StorageCategoryEntry[];
  policies: StoragePolicySummary[];
}

export interface StorageCleanRequest {
  targetIds?: string[];
  actions?: string[];
}

export interface StorageCleanResponse {
  ok: true;
  freedBytes: number;
  removedCount: number;
  errors: string[];
  inventory: StorageInventoryResponse;
}

export interface StorageQuotaServiceOptions {
  /** Primary Prismux data directory (`~/.prismux`). */
  dataDir: string;
  /** Optional override for Electron userData dir (`%APPDATA%\prismux`). */
  electronUserDataDir?: string;
  /** Optional override for updater local cache dir (`%LOCALAPPDATA%\prismux-updater`). */
  updaterLocalCacheDir?: string;
  /** Optional override for temp cache dirs (`%TEMP%\prismux`, `%TEMP%\prismux-factory-worktrees`). */
  tempCacheDirs?: string[];
  /** Optional override for legacy `~/.t3` directory (set `null` to skip). */
  legacyT3Dir?: string | null;
  /** Optional MemoryStore for safe `compact-db` execution. */
  memoryStore?: SqliteMemoryStore;
  /** Optional AppUpdater for safe `clean-updates` execution. */
  appUpdater?: AppUpdater;
  /** In-memory cache TTL in ms (default: 60s). */
  cacheTtlMs?: number;
  /** Warning threshold in bytes (default: 5 GiB). */
  warningThresholdBytes?: number;
  /** Injectable clock for deterministic unit tests. */
  now?: () => number;
}

const ELECTRON_DISPOSABLE_CACHE_NAMES = new Set<string>([
  "cache",
  "code cache",
  "gpucache",
  "dawngraphitecache",
  "dawnwebgpucache",
  "grshadercache",
  "shadercache",
  "blob_storage",
  "crashpad",
  "logs",
  "crash reports"
]);

const PROTECTED_DIR_NAMES = new Set<string>([
  "credentials",
  "secrets",
  "config",
  "chief-workspace",
  "plugins"
]);

const DATABASE_FILE_RE =
  /(?:^|[\\/])(?:memory\.db(?:-(?:wal|shm))?|statev2\.sqlite(?:-(?:wal|shm))?|[^\\/]+\.(?:sqlite|sqlite3|db)(?:-(?:wal|shm))?)$/i;

const ALWAYS_PROTECTED_FILE_RE =
  /(?:^|[\\/])(?:credentials-master\.key|memory\.db(?:-(?:wal|shm))?|statev2\.sqlite(?:-(?:wal|shm))?|[^\\/]+\.(?:enc|key|sqlite|sqlite3|db)(?:-(?:wal|shm))?)$/i;

interface ScannedStats {
  bytes: number;
  fileCount: number;
}

interface ChildTargetDescriptor {
  id: string;
  path: string;
  rootDir: string;
  tier: StorageSafetyTier;
  cleanable: boolean;
  cleanAction?: StorageCleanAction;
  isDirectory: boolean;
}

interface CategoryCleanSpec {
  id: string;
  tier: StorageSafetyTier;
  cleanable: boolean;
  cleanAction?: StorageCleanAction;
  /** Paths whose contents (or self for files) may be removed when this category is cleaned. */
  cleanTargets: Array<{ path: string; rootDir: string; preserveRootDir: boolean }>;
}

function normalizePathKey(p: string): string {
  const resolved = resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function stableShortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function isProtectedPathInsideAppData(
  candidatePath: string,
  baseDir: string,
  electronUserDataDir: string
): boolean {
  const normalized = normalizePathKey(candidatePath);
  const nameLower = basename(candidatePath).toLowerCase();

  if (ALWAYS_PROTECTED_FILE_RE.test(candidatePath)) {
    return true;
  }

  // Check path segments inside baseDir
  const relBase = relative(resolve(baseDir), resolve(candidatePath));
  if (relBase !== "" && !relBase.startsWith("..") && !isAbsolute(relBase)) {
    const segments = relBase.split(/[\\/]/).filter(Boolean);
    const first = segments[0]?.toLowerCase() ?? "";
    if (PROTECTED_DIR_NAMES.has(first)) {
      return true;
    }
    if (segments.length === 1 && nameLower.endsWith(".json")) {
      return true;
    }
    if (
      first === "userdata" &&
      segments.length === 2 &&
      (nameLower.endsWith(".json") || DATABASE_FILE_RE.test(nameLower))
    ) {
      return true;
    }
    if (
      first === "data" &&
      segments.length === 2 &&
      (nameLower.endsWith(".json") || DATABASE_FILE_RE.test(nameLower))
    ) {
      return true;
    }
  }

  // Check path segments inside electronUserDataDir: ONLY known cache subdirs are non-protected
  const relElectron = relative(
    resolve(electronUserDataDir),
    resolve(candidatePath)
  );
  if (
    relElectron !== "" &&
    !relElectron.startsWith("..") &&
    !isAbsolute(relElectron)
  ) {
    const segments = relElectron.split(/[\\/]/).filter(Boolean);
    const first = segments[0]?.toLowerCase() ?? "";
    const second = segments[1]?.toLowerCase() ?? "";
    const isServiceWorkerCache =
      first === "service worker" &&
      (second === "cachestorage" || second === "scriptcache");
    if (!ELECTRON_DISPOSABLE_CACHE_NAMES.has(first) && !isServiceWorkerCache) {
      return true;
    }
  }

  // Also guard against deleting baseDir or electronUserDataDir themselves
  if (
    normalized === normalizePathKey(baseDir) ||
    normalized === normalizePathKey(electronUserDataDir)
  ) {
    return true;
  }

  return false;
}

async function isStrictlyInsideDirAsync(
  targetPath: string,
  allowedRoot: string
): Promise<boolean> {
  try {
    const [realRoot, realTarget] = await Promise.all([
      realpath(allowedRoot),
      realpath(targetPath)
    ]);
    const a = process.platform === "win32" ? realTarget.toLowerCase() : realTarget;
    const b = process.platform === "win32" ? realRoot.toLowerCase() : realRoot;
    const rel = relative(b, a);
    return (
      rel !== "" &&
      !rel.startsWith("..") &&
      !isAbsolute(rel) &&
      !rel.split(/[\\/]/).includes("..")
    );
  } catch {
    return false;
  }
}

async function isEqualOrInsideDirAsync(
  targetPath: string,
  allowedRoot: string
): Promise<boolean> {
  try {
    const [realRoot, realTarget] = await Promise.all([
      realpath(allowedRoot),
      realpath(targetPath)
    ]);
    const a = process.platform === "win32" ? realTarget.toLowerCase() : realTarget;
    const b = process.platform === "win32" ? realRoot.toLowerCase() : realRoot;
    const rel = relative(b, a);
    return (
      rel === "" ||
      (!rel.startsWith("..") &&
        !isAbsolute(rel) &&
        !rel.split(/[\\/]/).includes(".."))
    );
  } catch {
    return false;
  }
}

function defaultElectronUserDataDir(): string {
  const override = process.env["PRISMUX_ELECTRON_USER_DATA_DIR"]?.trim();
  if (override && override.length > 0) {
    return resolve(override);
  }
  const home = homedir();
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"]?.trim() || join(home, "AppData", "Roaming");
    return join(appData, BRAND.appSlug);
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", BRAND.appSlug);
  }
  const xdgConfig = process.env["XDG_CONFIG_HOME"]?.trim() || join(home, ".config");
  return join(xdgConfig, BRAND.appSlug);
}

function defaultUpdaterLocalCacheDir(): string {
  const home = homedir();
  if (process.platform === "win32") {
    const localAppData =
      process.env["LOCALAPPDATA"]?.trim() || join(home, "AppData", "Local");
    return join(localAppData, `${BRAND.appSlug}-updater`);
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Caches", `${BRAND.appSlug}-updater`);
  }
  const xdgCache = process.env["XDG_CACHE_HOME"]?.trim() || join(home, ".cache");
  return join(xdgCache, `${BRAND.appSlug}-updater`);
}

function defaultTempCacheDirs(): string[] {
  const tmp = tmpdir();
  return [
    join(tmp, BRAND.appSlug),
    join(tmp, `${BRAND.appSlug}-factory-worktrees`)
  ];
}

/**
 * Recursively computes byte size and file count for a file or directory using
 * async `fs/promises` `lstat`/`readdir` with strict symlink & inode loop protection.
 */
async function measureTreeAsync(
  targetPath: string,
  visitedInodes: Set<string>,
  depth = 0
): Promise<ScannedStats> {
  if (depth > MAX_SCAN_DEPTH) {
    return { bytes: 0, fileCount: 0 };
  }
  let st;
  try {
    st = await lstat(targetPath);
  } catch {
    return { bytes: 0, fileCount: 0 };
  }

  // Never traverse symlinks / Windows junctions to guarantee zero symlink loops and zero escape.
  if (st.isSymbolicLink()) {
    return { bytes: 0, fileCount: 0 };
  }
  if (st.isFile()) {
    return { bytes: st.size, fileCount: 1 };
  }
  if (!st.isDirectory()) {
    return { bytes: 0, fileCount: 0 };
  }

  if (st.ino > 0) {
    const inodeKey = `${st.dev}:${st.ino}`;
    if (visitedInodes.has(inodeKey)) {
      return { bytes: 0, fileCount: 0 };
    }
    visitedInodes.add(inodeKey);
  }

  let entries: string[];
  try {
    entries = await readdir(targetPath);
  } catch {
    return { bytes: 0, fileCount: 0 };
  }

  let bytes = 0;
  let fileCount = 0;
  // Measure children in bounded chunks to avoid fd exhaustion on large directories.
  const CHUNK_SIZE = 16;
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map((name) =>
        measureTreeAsync(join(targetPath, name), visitedInodes, depth + 1)
      )
    );
    for (const res of results) {
      bytes += res.bytes;
      fileCount += res.fileCount;
    }
  }
  return { bytes, fileCount };
}

async function listDirectChildrenStats(
  dirPath: string,
  visitedInodes: Set<string>
): Promise<
  Array<{ name: string; path: string; bytes: number; fileCount: number; isDirectory: boolean }>
> {
  let names: string[];
  try {
    names = await readdir(dirPath);
  } catch {
    return [];
  }
  const items: Array<{
    name: string;
    path: string;
    bytes: number;
    fileCount: number;
    isDirectory: boolean;
  }> = [];

  const CHUNK_SIZE = 12;
  for (let i = 0; i < names.length; i += CHUNK_SIZE) {
    const chunk = names.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async (name) => {
        const fullPath = join(dirPath, name);
        let st;
        try {
          st = await lstat(fullPath);
        } catch {
          return null;
        }
        if (st.isSymbolicLink()) {
          return null;
        }
        if (st.isFile()) {
          return {
            name,
            path: fullPath,
            bytes: st.size,
            fileCount: 1,
            isDirectory: false
          };
        }
        if (st.isDirectory()) {
          const stats = await measureTreeAsync(fullPath, visitedInodes, 1);
          return {
            name,
            path: fullPath,
            bytes: stats.bytes,
            fileCount: stats.fileCount,
            isDirectory: true
          };
        }
        return null;
      })
    );
    for (const item of chunkResults) {
      if (item !== null) items.push(item);
    }
  }
  return items;
}

/**
 * On-demand C-drive storage analyzer & tiered safe cleaner powering
 * `GET /v1/system/storage` and `POST /v1/system/storage/clean` for the WizTree Treemap UI.
 *
 * Design guarantees:
 * - Strictly on-demand (60s in-memory cache, NEVER polled in background)
 * - Async `fs/promises` traversal with symlink & inode loop protection
 * - Hardcoded safety-tier enforcement: NEVER deletes `protected` items
 */
export class StorageQuotaService {
  private readonly baseDir: string;
  private readonly electronUserDataDir: string;
  private readonly updaterLocalCacheDir: string;
  private readonly tempCacheDirs: string[];
  private readonly legacyT3Dir: string | null;
  private readonly memoryStore: SqliteMemoryStore | undefined;
  private readonly appUpdater: AppUpdater | undefined;
  private readonly cacheTtlMs: number;
  private readonly warningThresholdBytes: number;
  private readonly now: () => number;

  private cachedInventory: {
    response: StorageInventoryResponse;
    cachedAtMs: number;
  } | null = null;
  private inflightScan: Promise<StorageInventoryResponse> | null = null;
  private lastCategorySpecs = new Map<string, CategoryCleanSpec>();
  private lastChildTargets = new Map<string, ChildTargetDescriptor>();

  constructor(options: StorageQuotaServiceOptions) {
    this.baseDir = resolve(options.dataDir);
    this.electronUserDataDir = resolve(
      options.electronUserDataDir ?? defaultElectronUserDataDir()
    );
    this.updaterLocalCacheDir = resolve(
      options.updaterLocalCacheDir ?? defaultUpdaterLocalCacheDir()
    );
    this.tempCacheDirs = (options.tempCacheDirs ?? defaultTempCacheDirs()).map((d) =>
      resolve(d)
    );
    if (options.legacyT3Dir === null) {
      this.legacyT3Dir = null;
    } else {
      const candidateLegacy = resolve(
        options.legacyT3Dir ?? join(homedir(), ".t3")
      );
      this.legacyT3Dir =
        normalizePathKey(candidateLegacy) === normalizePathKey(this.baseDir)
          ? null
          : candidateLegacy;
    }
    this.memoryStore = options.memoryStore;
    this.appUpdater = options.appUpdater;
    this.cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_STORAGE_CACHE_TTL_MS);
    this.warningThresholdBytes = Math.max(
      1,
      options.warningThresholdBytes ?? STORAGE_WARNING_THRESHOLD_BYTES
    );
    this.now = options.now ?? (() => Date.now());
  }

  clearCache(): void {
    this.cachedInventory = null;
  }

  async getInventory(
    options: { refresh?: boolean } = {}
  ): Promise<StorageInventoryResponse> {
    const refresh = options.refresh === true;
    const nowMs = this.now();
    if (
      !refresh &&
      this.cachedInventory !== null &&
      nowMs - this.cachedInventory.cachedAtMs < this.cacheTtlMs
    ) {
      return this.cachedInventory.response;
    }
    if (!refresh && this.inflightScan !== null) {
      return this.inflightScan;
    }

    const scanPromise = this.performScan()
      .then((response) => {
        this.cachedInventory = { response, cachedAtMs: this.now() };
        return response;
      })
      .finally(() => {
        if (this.inflightScan === scanPromise) {
          this.inflightScan = null;
        }
      });

    this.inflightScan = scanPromise;
    return scanPromise;
  }

  async clean(request: StorageCleanRequest = {}): Promise<StorageCleanResponse> {
    // Ensure we have up-to-date category & child target maps before executing clean.
    if (this.cachedInventory === null) {
      await this.getInventory({ refresh: true });
    }

    const requestedTargetIds = Array.isArray(request.targetIds)
      ? request.targetIds.filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0
        )
      : [];
    const requestedActions = Array.isArray(request.actions)
      ? request.actions.filter(
          (a): a is string => typeof a === "string" && a.trim().length > 0
        )
      : [];

    let freedBytes = 0;
    let removedCount = 0;
    const errors: string[] = [];
    const executedCategories = new Set<string>();
    const executedActions = new Set<string>();
    let compactDbRan = false;

    const runCompactDb = async (): Promise<void> => {
      if (compactDbRan) return;
      compactDbRan = true;
      if (!this.memoryStore) {
        errors.push("memoryStore 未挂载，无法执行 compact-db 维护。");
        return;
      }
      try {
        const result = await this.memoryStore.compact();
        freedBytes += result.freedBytes;
        removedCount += result.purgedTombstones + result.trimmedRecallSnapshots;
      } catch (err) {
        errors.push(
          `compact-db 失败: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    };

    const removeEntrySafely = async (
      targetPath: string,
      allowedRoot: string,
      allowLegacyRoot = false
    ): Promise<void> => {
      if (!allowLegacyRoot) {
        if (
          isProtectedPathInsideAppData(
            targetPath,
            this.baseDir,
            this.electronUserDataDir
          )
        ) {
          errors.push(`已拒绝删除受保护路径：${targetPath}`);
          return;
        }
        const inside = await isStrictlyInsideDirAsync(targetPath, allowedRoot);
        if (!inside) {
          errors.push(`路径越界或符号链接逃逸，已拒绝删除：${targetPath}`);
          return;
        }
      } else {
        const insideOrEqual = await isEqualOrInsideDirAsync(targetPath, allowedRoot);
        if (
          !insideOrEqual ||
          normalizePathKey(targetPath) === normalizePathKey(this.baseDir) ||
          normalizePathKey(targetPath) === normalizePathKey(this.electronUserDataDir)
        ) {
          errors.push(`路径校验失败，已拒绝删除：${targetPath}`);
          return;
        }
      }

      let st;
      try {
        st = await lstat(targetPath);
      } catch {
        return;
      }
      if (st.isSymbolicLink()) {
        errors.push(`跳过符号链接路径：${targetPath}`);
        return;
      }
      const stats = st.isDirectory()
        ? await measureTreeAsync(targetPath, new Set())
        : { bytes: st.size, fileCount: 1 };
      try {
        await rm(targetPath, { recursive: true, force: true });
        freedBytes += stats.bytes;
        removedCount += Math.max(1, stats.fileCount);
      } catch (err) {
        errors.push(
          `${basename(targetPath)}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    };

    const cleanCategorySpec = async (spec: CategoryCleanSpec): Promise<void> => {
      if (executedCategories.has(spec.id)) return;
      executedCategories.add(spec.id);

      if (spec.cleanAction === "compact-db") {
        await runCompactDb();
        return;
      }
      if (spec.tier === "protected" || !spec.cleanable) {
        errors.push(`受保护分类「${spec.id}」不可删除。`);
        return;
      }

      if (spec.id === "updates" && this.appUpdater) {
        try {
          const cleanupRes = await this.appUpdater.cleanupUpdateCache({
            maxNewerInstallers: 0,
            maxStaleTempAgeMs: 0
          });
          freedBytes += cleanupRes.freedBytes;
          removedCount += cleanupRes.removedFiles.length;
          errors.push(...cleanupRes.errors);
        } catch (err) {
          errors.push(
            `updates 清理失败: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        return;
      }

      const isLegacy = spec.cleanAction === "clean-legacy";
      for (const target of spec.cleanTargets) {
        let st;
        try {
          st = await lstat(target.path);
        } catch {
          continue;
        }
        if (st.isSymbolicLink()) {
          continue;
        }
        if (st.isFile()) {
          await removeEntrySafely(target.path, target.rootDir, isLegacy);
          continue;
        }
        if (st.isDirectory()) {
          if (!target.preserveRootDir && isLegacy) {
            await removeEntrySafely(target.path, target.rootDir, true);
            continue;
          }
          let children: string[];
          try {
            children = await readdir(target.path);
          } catch {
            continue;
          }
          for (const childName of children) {
            await removeEntrySafely(
              join(target.path, childName),
              target.rootDir,
              isLegacy
            );
          }
        }
      }
    };

    // 1. Handle explicit targetIds (category IDs or drill-down child IDs)
    for (const rawId of requestedTargetIds) {
      const id = rawId.trim();
      const catSpec = this.lastCategorySpecs.get(id);
      if (catSpec) {
        await cleanCategorySpec(catSpec);
        continue;
      }
      const childDesc = this.lastChildTargets.get(id);
      if (childDesc) {
        if (childDesc.cleanAction === "compact-db") {
          await runCompactDb();
          continue;
        }
        if (childDesc.tier === "protected" || !childDesc.cleanable) {
          errors.push(`受保护项「${basename(childDesc.path)}」不可删除。`);
          continue;
        }
        await removeEntrySafely(
          childDesc.path,
          childDesc.rootDir,
          childDesc.cleanAction === "clean-legacy"
        );
        continue;
      }
      errors.push(`未找到匹配的存储目标 ID：${id}`);
    }

    // 2. Handle explicit actions (`clean-cache`, `clean-logs`, `compact-db`, etc.)
    for (const rawAction of requestedActions) {
      const action = rawAction.trim();
      if (executedActions.has(action)) continue;
      executedActions.add(action);

      if (action === "compact-db") {
        await runCompactDb();
        continue;
      }

      const matchingSpecs = [...this.lastCategorySpecs.values()].filter(
        (spec) => spec.cleanAction === action && spec.tier !== "protected" && spec.cleanable
      );
      if (matchingSpecs.length === 0) {
        if (
          action !== "clean-cache" &&
          action !== "clean-logs" &&
          action !== "clean-updates" &&
          action !== "clean-legacy" &&
          action !== "clean-artifacts" &&
          action !== "clean-worktrees" &&
          action !== "clean-wallpapers"
        ) {
          errors.push(`不支持的清理动作：${action}`);
        }
        continue;
      }
      for (const spec of matchingSpecs) {
        await cleanCategorySpec(spec);
      }
    }

    this.clearCache();
    const inventory = await this.getInventory({ refresh: true });
    return {
      ok: true,
      freedBytes,
      removedCount,
      errors,
      inventory
    };
  }

  private async performScan(): Promise<StorageInventoryResponse> {
    const startedAt = performance.now();
    const visitedInodes = new Set<string>();
    const categorySpecs = new Map<string, CategoryCleanSpec>();
    const childTargets = new Map<string, ChildTargetDescriptor>();

    interface BucketAccumulator {
      id: string;
      name: string;
      path: string;
      bytes: number;
      fileCount: number;
      tier: StorageSafetyTier;
      categoryId: string;
      cleanable: boolean;
      cleanAction?: StorageCleanAction;
      children: StorageCategoryEntry[];
      cleanTargets: Array<{ path: string; rootDir: string; preserveRootDir: boolean }>;
    }

    const buckets = new Map<string, BucketAccumulator>();
    const getOrCreateBucket = (init: {
      id: string;
      name: string;
      path: string;
      tier: StorageSafetyTier;
      categoryId: string;
      cleanable: boolean;
      cleanAction?: StorageCleanAction;
    }): BucketAccumulator => {
      const existing = buckets.get(init.id);
      if (existing) return existing;
      const created: BucketAccumulator = {
        ...init,
        bytes: 0,
        fileCount: 0,
        children: [],
        cleanTargets: []
      };
      buckets.set(init.id, created);
      return created;
    };

    const addEntryToBucket = (
      bucket: BucketAccumulator,
      entry: {
        name: string;
        path: string;
        bytes: number;
        fileCount: number;
        isDirectory: boolean;
        rootDir: string;
        preserveRootDir?: boolean;
      }
    ): void => {
      bucket.bytes += entry.bytes;
      bucket.fileCount += entry.fileCount;
      const childId = `child:${bucket.id}:${stableShortHash(entry.path)}`;
      const childCleanable = bucket.tier !== "protected" && bucket.cleanable;
      const childNode: StorageCategoryEntry = {
        id: childId,
        name: entry.name,
        path: entry.path,
        bytes: entry.bytes,
        fileCount: entry.fileCount,
        tier: bucket.tier,
        categoryId: bucket.categoryId,
        cleanable: childCleanable,
        ...(bucket.cleanAction !== undefined ? { cleanAction: bucket.cleanAction } : {})
      };
      bucket.children.push(childNode);
      childTargets.set(childId, {
        id: childId,
        path: entry.path,
        rootDir: entry.rootDir,
        tier: bucket.tier,
        cleanable: childCleanable,
        ...(bucket.cleanAction !== undefined ? { cleanAction: bucket.cleanAction } : {}),
        isDirectory: entry.isDirectory
      });
      if (bucket.cleanable) {
        bucket.cleanTargets.push({
          path: entry.path,
          rootDir: entry.rootDir,
          preserveRootDir: entry.preserveRootDir ?? entry.isDirectory
        });
      }
    };

    const expandDirChildrenIntoBucket = async (
      bucket: BucketAccumulator,
      dirPath: string,
      rootDir: string,
      preserveRootDir = true
    ): Promise<ScannedStats> => {
      const directItems = await listDirectChildrenStats(dirPath, visitedInodes);
      let bytes = 0;
      let fileCount = 0;
      for (const item of directItems) {
        bytes += item.bytes;
        fileCount += item.fileCount;
        const childId = `child:${bucket.id}:${stableShortHash(item.path)}`;
        const childCleanable = bucket.tier !== "protected" && bucket.cleanable;
        bucket.children.push({
          id: childId,
          name: item.name,
          path: item.path,
          bytes: item.bytes,
          fileCount: item.fileCount,
          tier: bucket.tier,
          categoryId: bucket.categoryId,
          cleanable: childCleanable,
          ...(bucket.cleanAction !== undefined ? { cleanAction: bucket.cleanAction } : {})
        });
        childTargets.set(childId, {
          id: childId,
          path: item.path,
          rootDir,
          tier: bucket.tier,
          cleanable: childCleanable,
          ...(bucket.cleanAction !== undefined ? { cleanAction: bucket.cleanAction } : {}),
          isDirectory: item.isDirectory
        });
      }
      bucket.bytes += bytes;
      bucket.fileCount += fileCount;
      if (bucket.cleanable) {
        bucket.cleanTargets.push({ path: dirPath, rootDir, preserveRootDir });
      }
      return { bytes, fileCount };
    };

    const seenRootKeys = new Set<string>();
    const roots: StorageRootSummary[] = [];

    // ── Root 1: baseDir (~/.prismux) ────────────────────────────────────────
    seenRootKeys.add(normalizePathKey(this.baseDir));
    let baseExists = false;
    let baseBytes = 0;
    try {
      const baseStat = await lstat(this.baseDir);
      baseExists = baseStat.isDirectory();
    } catch {
      baseExists = false;
    }

    if (baseExists) {
      const topNames = await readdir(this.baseDir).catch(() => [] as string[]);

      const classifyBaseDirChild = async (
        parentDir: string,
        name: string,
        isInsideUserdata = false
      ): Promise<number> => {
        const fullPath = join(parentDir, name);
        let st;
        try {
          st = await lstat(fullPath);
        } catch {
          return 0;
        }
        if (st.isSymbolicLink()) return 0;

        const lower = name.toLowerCase();

        // Special container subdirs (`data/`, `userdata/`): inspect 1 level deeper for accurate categorization.
        if (st.isDirectory() && !isInsideUserdata && (lower === "data" || lower === "userdata")) {
          const innerNames = await readdir(fullPath).catch(() => [] as string[]);
          let subtotal = 0;
          for (const inner of innerNames) {
            subtotal += await classifyBaseDirChild(fullPath, inner, true);
          }
          return subtotal;
        }

        // 1. Databases (protected, compact-db only)
        if (st.isFile() && DATABASE_FILE_RE.test(lower)) {
          const b = getOrCreateBucket({
            id: "databases",
            name: "核心数据库 (memory.db / statev2.sqlite)",
            path: dirname(fullPath),
            tier: "protected",
            categoryId: "databases",
            cleanable: true,
            cleanAction: "compact-db"
          });
          addEntryToBucket(b, {
            name,
            path: fullPath,
            bytes: st.size,
            fileCount: 1,
            isDirectory: false,
            rootDir: this.baseDir,
            preserveRootDir: true
          });
          return st.size;
        }

        // 2. Logs & triage (disposable)
        if (
          (st.isDirectory() && (lower === "logs" || lower === "triage")) ||
          (st.isFile() && (lower.endsWith(".log") || lower.endsWith(".heapsnapshot")))
        ) {
          const b = getOrCreateBucket({
            id: "logs",
            name: "运行日志与终端日志",
            path: st.isDirectory() ? fullPath : join(this.baseDir, "logs"),
            tier: "disposable",
            categoryId: "logs",
            cleanable: true,
            cleanAction: "clean-logs"
          });
          if (st.isDirectory()) {
            const stats = await expandDirChildrenIntoBucket(b, fullPath, this.baseDir, true);
            return stats.bytes;
          }
          addEntryToBucket(b, {
            name,
            path: fullPath,
            bytes: st.size,
            fileCount: 1,
            isDirectory: false,
            rootDir: this.baseDir,
            preserveRootDir: false
          });
          return st.size;
        }

        // 3. Updates downloads (disposable)
        if (st.isDirectory() && lower === "updates") {
          const b = getOrCreateBucket({
            id: "updates",
            name: "历史更新安装包与分卷缓存",
            path: fullPath,
            tier: "disposable",
            categoryId: "updates",
            cleanable: true,
            cleanAction: "clean-updates"
          });
          const stats = await expandDirChildrenIntoBucket(b, fullPath, this.baseDir, true);
          return stats.bytes;
        }

        // 4. General disposable caches inside baseDir (`cache/`, `tmp/`)
        if (st.isDirectory() && (lower === "cache" || lower === "tmp")) {
          const b = getOrCreateBucket({
            id: "base-cache",
            name: "数据目录临时缓存",
            path: fullPath,
            tier: "disposable",
            categoryId: "cache",
            cleanable: true,
            cleanAction: "clean-cache"
          });
          const stats = await expandDirChildrenIntoBucket(b, fullPath, this.baseDir, true);
          return stats.bytes;
        }

        // 5. Browser artifacts (managed)
        if (st.isDirectory() && lower === "browser-artifacts") {
          const b = getOrCreateBucket({
            id: "browser-artifacts",
            name: "浏览器截图与录屏产物",
            path: fullPath,
            tier: "managed",
            categoryId: "artifacts",
            cleanable: true,
            cleanAction: "clean-artifacts"
          });
          const stats = await expandDirChildrenIntoBucket(b, fullPath, this.baseDir, true);
          return stats.bytes;
        }

        // 6. Git worktrees (managed)
        if (st.isDirectory() && lower === "worktrees") {
          const b = getOrCreateBucket({
            id: "worktrees",
            name: "Git Worktrees 隔离工作树",
            path: fullPath,
            tier: "managed",
            categoryId: "worktrees",
            cleanable: true,
            cleanAction: "clean-worktrees"
          });
          const stats = await expandDirChildrenIntoBucket(b, fullPath, this.baseDir, true);
          return stats.bytes;
        }

        // 7. Wallpapers (managed)
        if (st.isDirectory() && lower === "wallpapers") {
          const b = getOrCreateBucket({
            id: "wallpapers",
            name: "本地导入壁纸与场景资源",
            path: fullPath,
            tier: "managed",
            categoryId: "wallpapers",
            cleanable: true,
            cleanAction: "clean-wallpapers"
          });
          const stats = await expandDirChildrenIntoBucket(b, fullPath, this.baseDir, true);
          return stats.bytes;
        }

        // 8. Attachments / local models (managed, read-only here to avoid breaking active threads)
        if (
          st.isDirectory() &&
          (lower === "attachments" || lower === "models" || lower === "device-toolchain")
        ) {
          const b = getOrCreateBucket({
            id: "managed-assets",
            name: "会话附件、本地模型与工具链",
            path: fullPath,
            tier: "managed",
            categoryId: "attachments",
            cleanable: false
          });
          const stats = await expandDirChildrenIntoBucket(b, fullPath, this.baseDir, true);
          return stats.bytes;
        }

        // 9. Credentials, secrets, configs, plugins, chief-workspace & any unknown user files (protected)
        const b = getOrCreateBucket({
          id: "credentials-config",
          name: "凭据、插件与核心配置",
          path: this.baseDir,
          tier: "protected",
          categoryId: "credentials",
          cleanable: false
        });
        const stats = st.isDirectory()
          ? await measureTreeAsync(fullPath, visitedInodes, 1)
          : { bytes: st.size, fileCount: 1 };
        addEntryToBucket(b, {
          name,
          path: fullPath,
          bytes: stats.bytes,
          fileCount: stats.fileCount,
          isDirectory: st.isDirectory(),
          rootDir: this.baseDir,
          preserveRootDir: true
        });
        return stats.bytes;
      };

      for (const name of topNames) {
        baseBytes += await classifyBaseDirChild(this.baseDir, name, false);
      }
    }

    roots.push({
      id: "baseDir",
      label: "Prismux 数据根目录",
      path: this.baseDir,
      bytes: baseBytes,
      exists: baseExists
    });

    // ── Root 2: electronUserData (%APPDATA%\prismux) ────────────────────────
    const electronKey = normalizePathKey(this.electronUserDataDir);
    let electronExists = false;
    let electronBytes = 0;
    if (!seenRootKeys.has(electronKey)) {
      seenRootKeys.add(electronKey);
      try {
        const st = await lstat(this.electronUserDataDir);
        electronExists = st.isDirectory();
      } catch {
        electronExists = false;
      }
      if (electronExists) {
        const topNames = await readdir(this.electronUserDataDir).catch(
          () => [] as string[]
        );
        for (const name of topNames) {
          const fullPath = join(this.electronUserDataDir, name);
          let st;
          try {
            st = await lstat(fullPath);
          } catch {
            continue;
          }
          if (st.isSymbolicLink()) continue;
          const lower = name.toLowerCase();

          if (st.isDirectory() && ELECTRON_DISPOSABLE_CACHE_NAMES.has(lower)) {
            const b = getOrCreateBucket({
              id: "electron-cache",
              name: "桌面端 Chromium 与着色器缓存",
              path: this.electronUserDataDir,
              tier: "disposable",
              categoryId: "cache",
              cleanable: true,
              cleanAction: "clean-cache"
            });
            const stats = await measureTreeAsync(fullPath, visitedInodes, 1);
            addEntryToBucket(b, {
              name,
              path: fullPath,
              bytes: stats.bytes,
              fileCount: stats.fileCount,
              isDirectory: true,
              rootDir: this.electronUserDataDir,
              preserveRootDir: true
            });
            electronBytes += stats.bytes;
          } else {
            const b = getOrCreateBucket({
              id: "electron-userdata",
              name: "桌面端会话状态与本地配置",
              path: this.electronUserDataDir,
              tier: "protected",
              categoryId: "userdata",
              cleanable: false
            });
            const stats = st.isDirectory()
              ? await measureTreeAsync(fullPath, visitedInodes, 1)
              : { bytes: st.size, fileCount: 1 };
            addEntryToBucket(b, {
              name,
              path: fullPath,
              bytes: stats.bytes,
              fileCount: stats.fileCount,
              isDirectory: st.isDirectory(),
              rootDir: this.electronUserDataDir,
              preserveRootDir: true
            });
            electronBytes += stats.bytes;
          }
        }
      }
    }
    roots.push({
      id: "electronUserData",
      label: "桌面端浏览器缓存与配置",
      path: this.electronUserDataDir,
      bytes: electronBytes,
      exists: electronExists
    });

    // ── Root 3: updaterLocalCache (%LOCALAPPDATA%\prismux-updater) ──────────
    const updaterKey = normalizePathKey(this.updaterLocalCacheDir);
    let updaterExists = false;
    let updaterBytes = 0;
    if (!seenRootKeys.has(updaterKey)) {
      seenRootKeys.add(updaterKey);
      try {
        const st = await lstat(this.updaterLocalCacheDir);
        updaterExists = st.isDirectory();
      } catch {
        updaterExists = false;
      }
      if (updaterExists) {
        const b = getOrCreateBucket({
          id: "updater-local-cache",
          name: "更新器本地暂存包",
          path: this.updaterLocalCacheDir,
          tier: "disposable",
          categoryId: "updates",
          cleanable: true,
          cleanAction: "clean-updates"
        });
        const stats = await expandDirChildrenIntoBucket(
          b,
          this.updaterLocalCacheDir,
          this.updaterLocalCacheDir,
          true
        );
        updaterBytes = stats.bytes;
      }
    }
    roots.push({
      id: "updaterLocalCache",
      label: "更新器本地下载缓存",
      path: this.updaterLocalCacheDir,
      bytes: updaterBytes,
      exists: updaterExists
    });

    // ── Root 4: tempCache (%TEMP%\prismux & %TEMP%\prismux-factory-worktrees)
    let tempExists = false;
    let tempBytes = 0;
    const primaryTempPath = this.tempCacheDirs[0] ?? join(tmpdir(), BRAND.appSlug);
    for (const dir of this.tempCacheDirs) {
      const key = normalizePathKey(dir);
      if (seenRootKeys.has(key)) continue;
      seenRootKeys.add(key);
      let dirExists = false;
      try {
        const st = await lstat(dir);
        dirExists = st.isDirectory();
      } catch {
        dirExists = false;
      }
      if (!dirExists) continue;
      tempExists = true;
      const b = getOrCreateBucket({
        id: "temp-cache",
        name: "系统临时目录与工场残留工作树",
        path: primaryTempPath,
        tier: "disposable",
        categoryId: "cache",
        cleanable: true,
        cleanAction: "clean-cache"
      });
      const stats = await expandDirChildrenIntoBucket(b, dir, dir, true);
      tempBytes += stats.bytes;
    }
    roots.push({
      id: "tempCache",
      label: "临时缓存与工场残留目录",
      path: primaryTempPath,
      bytes: tempBytes,
      exists: tempExists
    });

    // ── Root 5: Optional legacy ~/.t3 existence check ───────────────────────
    let legacyExists = false;
    let legacyBytes = 0;
    const legacyPathDisplay = this.legacyT3Dir ?? join(homedir(), ".t3");
    if (this.legacyT3Dir !== null) {
      const legacyKey = normalizePathKey(this.legacyT3Dir);
      if (!seenRootKeys.has(legacyKey)) {
        seenRootKeys.add(legacyKey);
        try {
          const st = await lstat(this.legacyT3Dir);
          legacyExists = st.isDirectory();
        } catch {
          legacyExists = false;
        }
        if (legacyExists) {
          const b = getOrCreateBucket({
            id: "legacy-t3",
            name: "历史 ~/.t3 遗留数据目录",
            path: this.legacyT3Dir,
            tier: "managed",
            categoryId: "legacy",
            cleanable: true,
            cleanAction: "clean-legacy"
          });
          const stats = await expandDirChildrenIntoBucket(
            b,
            this.legacyT3Dir,
            this.legacyT3Dir,
            false
          );
          legacyBytes = stats.bytes;
        }
      }
    }
    roots.push({
      id: "legacyT3",
      label: "历史 ~/.t3 遗留目录",
      path: legacyPathDisplay,
      bytes: legacyBytes,
      exists: legacyExists
    });

    // Finalize categories sorted descending by bytes, children capped at top 25
    const categories: StorageCategoryEntry[] = [];
    let totalBytes = 0;
    let reclaimableDisposableBytes = 0;
    let reclaimableManagedBytes = 0;
    let protectedBytes = 0;

    for (const bucket of buckets.values()) {
      bucket.children.sort(
        (a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name)
      );
      const topChildren = bucket.children.slice(0, MAX_CHILDREN_PER_CATEGORY);

      categories.push({
        id: bucket.id,
        name: bucket.name,
        path: bucket.path,
        bytes: bucket.bytes,
        fileCount: bucket.fileCount,
        tier: bucket.tier,
        categoryId: bucket.categoryId,
        cleanable: bucket.cleanable,
        ...(bucket.cleanAction !== undefined
          ? { cleanAction: bucket.cleanAction }
          : {}),
        ...(topChildren.length > 0 ? { children: topChildren } : {})
      });

      categorySpecs.set(bucket.id, {
        id: bucket.id,
        tier: bucket.tier,
        cleanable: bucket.cleanable,
        ...(bucket.cleanAction !== undefined
          ? { cleanAction: bucket.cleanAction }
          : {}),
        cleanTargets: bucket.cleanTargets
      });

      totalBytes += bucket.bytes;
      if (bucket.tier === "disposable") {
        reclaimableDisposableBytes += bucket.bytes;
      } else if (bucket.tier === "managed") {
        reclaimableManagedBytes += bucket.bytes;
      } else {
        protectedBytes += bucket.bytes;
      }
    }

    categories.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));

    this.lastCategorySpecs = categorySpecs;
    this.lastChildTargets = childTargets;

    const policies: StoragePolicySummary[] = [
      {
        id: "pty-dead-eviction",
        label: "僵死 PTY 会话环形缓冲回收",
        limitLabel: "30 分钟 / 最多保留 16 个",
        active: true
      },
      {
        id: "memory-db-wal-cap",
        label: "记忆库 SQLite WAL 限幅与增量压缩",
        limitLabel: "WAL ≤ 64 MiB · 每日自动维护",
        active: true
      },
      {
        id: "updater-cache-cap",
        label: "历史更新安装包与分卷自动清理",
        limitLabel: "≤ 512 MiB · 仅保留 1 份新版",
        active: true
      },
      {
        id: "factory-worktrees-sweep",
        label: "夜间工场临时工作树残留清扫",
        limitLabel: "崩溃残留 >24 小时自动清理",
        active: true
      },
      {
        id: "logs-artifacts-quota",
        label: "运行日志与浏览器录屏滚动配额",
        limitLabel: "14 天保留 · 录屏上限 512 MiB",
        active: true
      }
    ];

    return {
      ok: true,
      scannedAt: new Date(this.now()).toISOString(),
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      totalBytes,
      reclaimableDisposableBytes,
      reclaimableManagedBytes,
      protectedBytes,
      warningThresholdBytes: this.warningThresholdBytes,
      roots,
      categories,
      policies
    };
  }
}
