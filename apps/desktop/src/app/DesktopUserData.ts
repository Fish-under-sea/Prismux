import * as NodeOS from "node:os";

import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

export class DesktopUserDataInitializationError extends Schema.TaggedError<DesktopUserDataInitializationError>()(
  "DesktopUserDataInitializationError",
  {
    operation: Schema.Literals(["inspect", "read", "create-directory", "write"]),
    resourcePath: Schema.String,
    category: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Could not initialize Electron user data during ${this.operation} at ${this.resourcePath} (${this.category}).`;
  }

  static fromFileSystem(
    cause: PlatformError.PlatformError,
    operation: DesktopUserDataInitializationError["operation"],
    resourcePath: string,
  ) {
    return new DesktopUserDataInitializationError({
      operation,
      resourcePath,
      category: cause.reason._tag,
      cause,
    });
  }
}

export const resolveUserDataPath = Effect.fn("desktop.userData.resolveUserDataPath")(
  function* (input: {
    readonly appDataDirectory: string;
    readonly isDevelopment: boolean;
    readonly platform: NodeJS.Platform;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const names = input.isDevelopment
      ? { current: "prismux-dev", legacy: "Prismux (Dev)" }
      : { current: "prismux", legacy: "Prismux (Alpha)" };
    const destinationPath = path.join(input.appDataDirectory, names.current);
    const legacyPath = path.join(input.appDataDirectory, names.legacy);
    const inspect = (resourcePath: string) =>
      fs
        .exists(resourcePath)
        .pipe(
          Effect.mapError((cause) =>
            DesktopUserDataInitializationError.fromFileSystem(cause, "inspect", resourcePath),
          ),
        );
    if (input.isDevelopment) {
      return (yield* inspect(legacyPath)) ? legacyPath : destinationPath;
    }
    // Chromium databases require their own profile for each running version.
    if (input.platform !== "win32") return destinationPath;
    const destinationState = path.join(destinationPath, "Local State");
    if (yield* inspect(destinationState)) return destinationPath;
    const legacyState = path.join(legacyPath, "Local State");
    const sourceState = legacyState;
    if (!(yield* inspect(sourceState))) return destinationPath;
    // Windows safeStorage keys live here. Copy only these preferences, never locked databases.
    const state = yield* fs
      .readFileString(sourceState)
      .pipe(
        Effect.mapError((cause) =>
          DesktopUserDataInitializationError.fromFileSystem(cause, "read", sourceState),
        ),
      );
    yield* fs
      .makeDirectory(destinationPath, { recursive: true })
      .pipe(
        Effect.mapError((cause) =>
          DesktopUserDataInitializationError.fromFileSystem(
            cause,
            "create-directory",
            destinationPath,
          ),
        ),
      );
    yield* fs.writeFileString(destinationState, state, { flag: "wx" }).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "AlreadyExists",
        () => Effect.void,
      ),
      Effect.mapError((cause) =>
        DesktopUserDataInitializationError.fromFileSystem(cause, "write", destinationState),
      ),
    );
    return destinationPath;
  },
);

const GPU_CACHE_DIRECTORIES = [
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUPersistentCache",
];

// Keyed on Electron, not Chromium: Electron patches ship Chromium backports under the same Chrome version.
export const clearStaleGpuCaches = Effect.fn("desktop.userData.clearStaleGpuCaches")(
  function* (input: { readonly userDataPath: string; readonly electronVersion: string }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const markerPath = path.join(input.userDataPath, "gpu-cache-electron-version");
    const cachedVersion = yield* fs.readFileString(markerPath).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.undefined,
      ),
    );
    if (cachedVersion?.trim() === input.electronVersion) return;
    for (const name of GPU_CACHE_DIRECTORIES) {
      yield* fs.remove(path.join(input.userDataPath, name), { recursive: true, force: true });
    }
    yield* fs.makeDirectory(input.userDataPath, { recursive: true });
    yield* fs.writeFileString(markerPath, input.electronVersion);
  },
  (effect, input) =>
    effect.pipe(
      Effect.catch((error) =>
        Effect.logWarning("could not clear stale GPU caches", {
          userDataPath: input.userDataPath,
          electronVersion: input.electronVersion,
          error: error.message,
        }),
      ),
    ),
);

const DAY_MS = 24 * 60 * 60 * 1_000;
const MIB = 1024 * 1024;
const MAX_TRAVERSAL_DEPTH = 8;

export const CRASHPAD_MAX_FILES = 10;
export const CRASHPAD_MAX_AGE_MS = 30 * DAY_MS;
export const CRASHPAD_MAX_TOTAL_BYTES = 100 * MIB;
export const CODE_CACHE_MAX_BYTES = 256 * MIB;
export const PREVIEW_PARTITION_MAX_AGE_MS = 30 * DAY_MS;
export const COMPILE_CACHE_MAX_AGE_MS = 30 * DAY_MS;
export const COMPILE_CACHE_MAX_BYTES = 256 * MIB;

interface SizedEntry {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface DesktopUserDataMaintenanceResult {
  readonly crashpadRemoved: number;
  readonly codeCacheRemoved: number;
  readonly previewPartitionsRemoved: number;
  readonly compileCacheRemoved: number;
}

function statMtimeMs(info: FileSystem.File.Info): number {
  return Option.getOrUndefined(info.mtime)?.getTime() ?? 0;
}

function readDirectorySafe(
  fs: FileSystem.FileSystem,
  directory: string,
): Effect.Effect<ReadonlyArray<string>> {
  return fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));
}

function collectFilesRecursive(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  directory: string,
  depth = 0,
): Effect.Effect<ReadonlyArray<SizedEntry>> {
  if (depth > MAX_TRAVERSAL_DEPTH) {
    return Effect.succeed([]);
  }
  return Effect.gen(function* () {
    const names = yield* readDirectorySafe(fs, directory);
    const files: SizedEntry[] = [];
    for (const name of names) {
      const entryPath = path.join(directory, name);
      const infoOption = yield* fs.stat(entryPath).pipe(Effect.option);
      if (Option.isNone(infoOption)) continue;
      const info = infoOption.value;
      if (info.type === "SymbolicLink") continue;
      if (info.type === "Directory") {
        const nested = yield* collectFilesRecursive(fs, path, entryPath, depth + 1);
        files.push(...nested);
      } else if (info.type === "File") {
        files.push({
          path: entryPath,
          size: Number(info.size),
          mtimeMs: statMtimeMs(info),
        });
      }
    }
    return files;
  });
}

const measureEntryUsage = Effect.fn("DesktopUserData.measureEntryUsage")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  entryPath: string,
  depth = 0,
): Effect.fn.Return<Option.Option<SizedEntry>> {
  const infoOption = yield* fs.stat(entryPath).pipe(Effect.option);
  if (Option.isNone(infoOption)) return Option.none<SizedEntry>();
  const info = infoOption.value;
  if (info.type === "SymbolicLink") return Option.none<SizedEntry>();
  const ownMtime = statMtimeMs(info);
  if (info.type !== "Directory" || depth >= MAX_TRAVERSAL_DEPTH) {
    return Option.some({
      path: entryPath,
      size: info.type === "File" ? Number(info.size) : 0,
      mtimeMs: ownMtime,
    });
  }
  const nestedFiles = yield* collectFilesRecursive(fs, path, entryPath, depth + 1);
  let totalSize = 0;
  let latestMtime = ownMtime;
  for (const file of nestedFiles) {
    totalSize += file.size;
    if (file.mtimeMs > latestMtime) {
      latestMtime = file.mtimeMs;
    }
  }
  return Option.some({
    path: entryPath,
    size: totalSize,
    mtimeMs: latestMtime,
  });
});

export function resolveCompileCacheDir(input: {
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
  readonly xdgCacheHome?: string | undefined;
  readonly tempDir?: string | undefined;
  readonly joinPath: (...paths: ReadonlyArray<string>) => string;
}): string {
  const cacheRoot =
    input.platform === "linux"
      ? input.xdgCacheHome || input.joinPath(input.homeDirectory, ".cache")
      : (input.tempDir ?? NodeOS.tmpdir());
  return input.joinPath(cacheRoot, "prismux", "compile-cache");
}

export const cleanupCrashpadReports = Effect.fn("desktop.userData.cleanupCrashpadReports")(
  function* (input: {
    readonly userDataPath: string;
    readonly nowMs?: number;
    readonly maxFiles?: number;
    readonly maxAgeMs?: number;
    readonly maxTotalBytes?: number;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const nowMs = input.nowMs ?? (yield* Clock.currentTimeMillis);
    const maxFiles = input.maxFiles ?? CRASHPAD_MAX_FILES;
    const maxAgeMs = input.maxAgeMs ?? CRASHPAD_MAX_AGE_MS;
    const maxTotalBytes = input.maxTotalBytes ?? CRASHPAD_MAX_TOTAL_BYTES;
    const reportsDir = path.join(input.userDataPath, "Crashpad", "reports");
    const names = yield* readDirectorySafe(fs, reportsDir);
    if (names.length === 0) return 0;

    const entries: SizedEntry[] = [];
    for (const name of names) {
      const entryPath = path.join(reportsDir, name);
      const infoOption = yield* fs.stat(entryPath).pipe(Effect.option);
      if (Option.isNone(infoOption)) continue;
      if (infoOption.value.type !== "File") continue;
      entries.push({
        path: entryPath,
        size: Number(infoOption.value.size),
        mtimeMs: statMtimeMs(infoOption.value),
      });
    }
    entries.sort((left, right) => right.mtimeMs - left.mtimeMs);

    let keptFiles = 0;
    let keptBytes = 0;
    let removed = 0;
    for (const entry of entries) {
      const expired = nowMs - entry.mtimeMs > maxAgeMs;
      const withinCount = keptFiles < maxFiles;
      const withinBytes = keptBytes + entry.size <= maxTotalBytes;
      if (!expired && withinCount && withinBytes) {
        keptFiles += 1;
        keptBytes += entry.size;
        continue;
      }
      const deleted = yield* fs.remove(entry.path, { force: true }).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (deleted) removed += 1;
    }
    return removed;
  },
);

export const trimCodeCache = Effect.fn("desktop.userData.trimCodeCache")(function* (input: {
  readonly userDataPath: string;
  readonly maxBytes?: number;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const maxBytes = input.maxBytes ?? CODE_CACHE_MAX_BYTES;
  const codeCacheDir = path.join(input.userDataPath, "Code Cache");
  const files = [...(yield* collectFilesRecursive(fs, path, codeCacheDir))];
  let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes <= maxBytes) return 0;

  files.sort((left, right) => left.mtimeMs - right.mtimeMs);
  let removed = 0;
  for (const file of files) {
    if (totalBytes <= maxBytes) break;
    const deleted = yield* fs.remove(file.path, { force: true }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (deleted) {
      totalBytes -= file.size;
      removed += 1;
    }
  }
  return removed;
});

function isPreviewPartitionDirectoryName(name: string): boolean {
  return name.startsWith("persist:prismux-preview-") || name.startsWith("prismux-preview-");
}

export const pruneOrphanedPreviewPartitions = Effect.fn(
  "desktop.userData.pruneOrphanedPreviewPartitions",
)(function* (input: {
  readonly userDataPath: string;
  readonly nowMs?: number;
  readonly maxAgeMs?: number;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const nowMs = input.nowMs ?? (yield* Clock.currentTimeMillis);
  const maxAgeMs = input.maxAgeMs ?? PREVIEW_PARTITION_MAX_AGE_MS;
  const partitionsDir = path.join(input.userDataPath, "Partitions");
  const names = yield* readDirectorySafe(fs, partitionsDir);
  if (names.length === 0) return 0;

  let removed = 0;
  for (const name of names) {
    if (!isPreviewPartitionDirectoryName(name)) continue;
    const partitionPath = path.join(partitionsDir, name);
    const usageOption = yield* measureEntryUsage(fs, path, partitionPath);
    if (Option.isNone(usageOption)) continue;
    if (nowMs - usageOption.value.mtimeMs <= maxAgeMs) continue;
    const deleted = yield* fs.remove(partitionPath, { recursive: true, force: true }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (deleted) removed += 1;
  }
  return removed;
});

export const cleanupCompileCache = Effect.fn("desktop.userData.cleanupCompileCache")(
  function* (input: {
    readonly compileCacheDir: string;
    readonly nowMs?: number;
    readonly maxAgeMs?: number;
    readonly maxBytes?: number;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const nowMs = input.nowMs ?? (yield* Clock.currentTimeMillis);
    const maxAgeMs = input.maxAgeMs ?? COMPILE_CACHE_MAX_AGE_MS;
    const maxBytes = input.maxBytes ?? COMPILE_CACHE_MAX_BYTES;
    const names = yield* readDirectorySafe(fs, input.compileCacheDir);
    if (names.length === 0) return 0;

    const survivors: SizedEntry[] = [];
    let removed = 0;
    for (const name of names) {
      const entryPath = path.join(input.compileCacheDir, name);
      const usageOption = yield* measureEntryUsage(fs, path, entryPath);
      if (Option.isNone(usageOption)) continue;
      const entry = usageOption.value;
      if (nowMs - entry.mtimeMs > maxAgeMs) {
        const deleted = yield* fs.remove(entry.path, { recursive: true, force: true }).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        if (deleted) removed += 1;
      } else {
        survivors.push(entry);
      }
    }

    let totalBytes = survivors.reduce((sum, entry) => sum + entry.size, 0);
    if (totalBytes <= maxBytes) return removed;

    survivors.sort((left, right) => left.mtimeMs - right.mtimeMs);
    for (const entry of survivors) {
      if (totalBytes <= maxBytes) break;
      const deleted = yield* fs.remove(entry.path, { recursive: true, force: true }).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (deleted) {
        totalBytes -= entry.size;
        removed += 1;
      }
    }
    return removed;
  },
);

/**
 * Lightweight post-startup maintenance capping Chromium userData & compile-cache growth
 * without blocking window launch. All failures are swallowed so locked active files never disrupt UX.
 */
export const runUserDataMaintenance = Effect.fn("desktop.userData.runMaintenance")(function* (input: {
  readonly userDataPath: string;
  readonly compileCacheDir?: string | undefined;
  readonly nowMs?: number;
  readonly crashpadMaxFiles?: number;
  readonly crashpadMaxAgeMs?: number;
  readonly crashpadMaxTotalBytes?: number;
  readonly codeCacheMaxBytes?: number;
  readonly previewPartitionMaxAgeMs?: number;
  readonly compileCacheMaxAgeMs?: number;
  readonly compileCacheMaxBytes?: number;
}): Effect.fn.Return<
  DesktopUserDataMaintenanceResult,
  never,
  FileSystem.FileSystem | Path.Path
> {
  const nowMs = input.nowMs ?? (yield* Clock.currentTimeMillis);
  const crashpadRemoved = yield* cleanupCrashpadReports({
    userDataPath: input.userDataPath,
    nowMs,
    ...(input.crashpadMaxFiles === undefined ? {} : { maxFiles: input.crashpadMaxFiles }),
    ...(input.crashpadMaxAgeMs === undefined ? {} : { maxAgeMs: input.crashpadMaxAgeMs }),
    ...(input.crashpadMaxTotalBytes === undefined
      ? {}
      : { maxTotalBytes: input.crashpadMaxTotalBytes }),
  }).pipe(Effect.orElseSucceed(() => 0));
  const codeCacheRemoved = yield* trimCodeCache({
    userDataPath: input.userDataPath,
    ...(input.codeCacheMaxBytes === undefined ? {} : { maxBytes: input.codeCacheMaxBytes }),
  }).pipe(Effect.orElseSucceed(() => 0));
  const previewPartitionsRemoved = yield* pruneOrphanedPreviewPartitions({
    userDataPath: input.userDataPath,
    nowMs,
    ...(input.previewPartitionMaxAgeMs === undefined
      ? {}
      : { maxAgeMs: input.previewPartitionMaxAgeMs }),
  }).pipe(Effect.orElseSucceed(() => 0));
  const compileCacheRemoved = input.compileCacheDir
    ? yield* cleanupCompileCache({
        compileCacheDir: input.compileCacheDir,
        nowMs,
        ...(input.compileCacheMaxAgeMs === undefined
          ? {}
          : { maxAgeMs: input.compileCacheMaxAgeMs }),
        ...(input.compileCacheMaxBytes === undefined
          ? {}
          : { maxBytes: input.compileCacheMaxBytes }),
      }).pipe(Effect.orElseSucceed(() => 0))
    : 0;
  return {
    crashpadRemoved,
    codeCacheRemoved,
    previewPartitionsRemoved,
    compileCacheRemoved,
  };
});
