import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { cleanupOrphanedSnapShots, ORPHAN_SNAPSHOT_MAX_AGE_MS } from "../snapShot/DesktopSnapShot.ts";
import {
  cleanupStalePendingInstallers,
  extractInstallerVersion,
  PENDING_INSTALLER_MAX_AGE_MS,
} from "../updates/DesktopUpdates.ts";
import {
  cleanupCompileCache,
  cleanupCrashpadReports,
  clearStaleGpuCaches,
  pruneOrphanedPreviewPartitions,
  resolveUserDataPath,
  runUserDataMaintenance,
  trimCodeCache,
} from "./DesktopUserData.ts";

it.effect.each(["Prismux (Alpha)"])(
  "preserves Windows credential keys from %s without copying browser databases",
  (sourceName) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "prismux-profile-" });
      const source = path.join(directory, sourceName);
      const destination = path.join(directory, "prismux");
      const state = '{"os_crypt":{"encrypted_key":"test-encrypted-key"}}';
      yield* fs.makeDirectory(path.join(directory, "Prismux (Alpha)"), { recursive: true });
      yield* fs.makeDirectory(path.join(source, "IndexedDB"), { recursive: true });
      yield* fs.writeFileString(path.join(source, "Local State"), state);
      yield* fs.writeFileString(path.join(source, "IndexedDB", "LOCK"), "V1 owns this database");
      yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: false,
        platform: "win32",
      });
      assert.equal(yield* fs.readFileString(path.join(destination, "Local State")), state);
      assert.equal(yield* fs.readFileString(path.join(source, "Local State")), state);
      assert.isFalse(yield* fs.exists(path.join(destination, "IndexedDB")));
      yield* fs.writeFileString(path.join(destination, "Local State"), "existing V2 state");
      yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: false,
        platform: "win32",
      });
      assert.equal(
        yield* fs.readFileString(path.join(destination, "Local State")),
        "existing V2 state",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

const gpuCacheDirectories = [
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUPersistentCache",
];

it.effect.each([
  { profile: "written by Electron 44.10.0", marker: "44.10.0" },
  { profile: "with no recorded Electron version", marker: undefined },
])("clears GPU caches $profile once when Electron 44.10.1 starts", ({ marker }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const userDataPath = yield* fs.makeTempDirectoryScoped({ prefix: "t3-v2-gpu-cache-" });
    for (const name of gpuCacheDirectories) {
      yield* fs.makeDirectory(path.join(userDataPath, name), { recursive: true });
      yield* fs.writeFileString(path.join(userDataPath, name, "data_0"), "44.10.0 shaders");
    }
    yield* fs.makeDirectory(path.join(userDataPath, "Local Storage"), { recursive: true });
    yield* fs.writeFileString(path.join(userDataPath, "Local Storage", "LOCK"), "profile");
    yield* fs.writeFileString(path.join(userDataPath, "Local State"), "profile");
    if (marker !== undefined) {
      yield* fs.writeFileString(path.join(userDataPath, "gpu-cache-electron-version"), marker);
    }

    yield* clearStaleGpuCaches({ userDataPath, electronVersion: "44.10.1" });

    const survivingCaches: Array<string> = [];
    for (const name of gpuCacheDirectories) {
      if (yield* fs.exists(path.join(userDataPath, name))) survivingCaches.push(name);
    }
    assert.deepStrictEqual(survivingCaches, []);
    assert.equal(
      yield* fs.readFileString(path.join(userDataPath, "Local Storage", "LOCK")),
      "profile",
    );
    assert.equal(yield* fs.readFileString(path.join(userDataPath, "Local State")), "profile");

    yield* fs.makeDirectory(path.join(userDataPath, "GPUCache"));
    yield* fs.writeFileString(path.join(userDataPath, "GPUCache", "data_0"), "44.10.1 shaders");
    yield* clearStaleGpuCaches({ userDataPath, electronVersion: "44.10.1" });
    assert.equal(
      yield* fs.readFileString(path.join(userDataPath, "GPUCache", "data_0")),
      "44.10.1 shaders",
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("keeps GPU caches built on the first launch of a fresh install", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const appData = yield* fs.makeTempDirectoryScoped({ prefix: "t3-v2-fresh-" });
    const userDataPath = path.join(appData, "prismux-v2");

    yield* clearStaleGpuCaches({ userDataPath, electronVersion: "44.10.1" });
    yield* fs.makeDirectory(path.join(userDataPath, "GPUCache"));
    yield* fs.writeFileString(path.join(userDataPath, "GPUCache", "data_0"), "44.10.1 shaders");
    yield* clearStaleGpuCaches({ userDataPath, electronVersion: "44.10.1" });

    assert.equal(
      yield* fs.readFileString(path.join(userDataPath, "GPUCache", "data_0")),
      "44.10.1 shaders",
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("retries on the next launch when a GPU cache cannot be removed", () =>
  Effect.gen(function* () {
    const writes: Array<string> = [];
    const fileSystem = FileSystem.makeNoop({
      remove: (path) =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "remove",
            pathOrDescriptor: path,
          }),
        ),
      writeFileString: (path) =>
        Effect.sync(() => {
          writes.push(path);
        }),
    });

    yield* clearStaleGpuCaches({ userDataPath: "/profile", electronVersion: "44.10.1" }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
    );

    assert.deepStrictEqual(writes, []);
  }).pipe(Effect.provide(NodeServices.layer)),
);

const DAY_MS = 24 * 60 * 60 * 1_000;

function setMtimeMs(fs: FileSystem.FileSystem, targetPath: string, mtimeMs: number) {
  const timestamp = DateTime.toDateUtc(DateTime.makeUnsafe(mtimeMs));
  return fs.utimes(targetPath, timestamp, timestamp);
}

it.effect("enforces Crashpad reports count, age, and total byte caps", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const userDataPath = yield* fs.makeTempDirectoryScoped({ prefix: "prismux-crashpad-" });
    const reportsDir = path.join(userDataPath, "Crashpad", "reports");
    yield* fs.makeDirectory(reportsDir, { recursive: true });
    const nowMs = Date.UTC(2026, 10, 26, 12, 0, 0);

    // 12 recent dumps + 1 expired (>30d) dump
    for (let i = 0; i < 12; i += 1) {
      const filePath = path.join(reportsDir, `dump-${String(i).padStart(2, "0")}.dmp`);
      yield* fs.writeFileString(filePath, "x".repeat(1_000));
      yield* setMtimeMs(fs, filePath, nowMs - i * 60_000);
    }
    const oldDump = path.join(reportsDir, "expired.dmp");
    yield* fs.writeFileString(oldDump, "x".repeat(1_000));
    yield* setMtimeMs(fs, oldDump, nowMs - 31 * DAY_MS);

    const removed = yield* cleanupCrashpadReports({
      userDataPath,
      nowMs,
      maxFiles: 10,
      maxTotalBytes: 8_500,
    });
    // Only 8 dumps fit under 8_500 bytes (8 * 1_000 = 8_000 <= 8_500), so 5 removed.
    assert.equal(removed, 5);
    const remaining = (yield* fs.readDirectory(reportsDir)).sort();
    assert.equal(remaining.length, 8);
    assert.isFalse(remaining.includes("expired.dmp"));
    assert.isTrue(remaining.includes("dump-00.dmp"));
    assert.isTrue(remaining.includes("dump-07.dmp"));
    assert.isFalse(remaining.includes("dump-08.dmp"));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("trims oldest Code Cache files when exceeding quota", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const userDataPath = yield* fs.makeTempDirectoryScoped({ prefix: "prismux-code-cache-" });
    const jsCache = path.join(userDataPath, "Code Cache", "js");
    yield* fs.makeDirectory(jsCache, { recursive: true });
    const nowMs = Date.UTC(2026, 10, 26, 12, 0, 0);

    const oldest = path.join(jsCache, "a.bin");
    const middle = path.join(jsCache, "b.bin");
    const newest = path.join(jsCache, "c.bin");
    for (const [filePath, ageMs] of [
      [oldest, 3 * DAY_MS],
      [middle, 2 * DAY_MS],
      [newest, 1 * DAY_MS],
    ] as const) {
      yield* fs.writeFileString(filePath, "a".repeat(1_000));
      yield* setMtimeMs(fs, filePath, nowMs - ageMs);
    }

    const removed = yield* trimCodeCache({ userDataPath, maxBytes: 2_100 });
    assert.equal(removed, 1);
    assert.isFalse(yield* fs.exists(oldest));
    assert.isTrue(yield* fs.exists(middle));
    assert.isTrue(yield* fs.exists(newest));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("prunes orphaned preview partitions unused >30 days while keeping active and unrelated ones", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const userDataPath = yield* fs.makeTempDirectoryScoped({ prefix: "prismux-partitions-" });
    const partitionsDir = path.join(userDataPath, "Partitions");
    const nowMs = Date.UTC(2026, 10, 26, 12, 0, 0);

    const stalePreview = path.join(partitionsDir, "prismux-preview-stale");
    const freshPreview = path.join(partitionsDir, "prismux-preview-fresh");
    const unrelated = path.join(partitionsDir, "other-partition");
    for (const dir of [stalePreview, freshPreview, unrelated]) {
      yield* fs.makeDirectory(dir, { recursive: true });
      yield* fs.writeFileString(path.join(dir, "Cache"), "data");
    }
    yield* setMtimeMs(fs, path.join(stalePreview, "Cache"), nowMs - 35 * DAY_MS);
    yield* setMtimeMs(fs, stalePreview, nowMs - 35 * DAY_MS);
    yield* setMtimeMs(fs, path.join(freshPreview, "Cache"), nowMs - 5 * DAY_MS);
    yield* setMtimeMs(fs, freshPreview, nowMs - 5 * DAY_MS);
    yield* setMtimeMs(fs, path.join(unrelated, "Cache"), nowMs - 90 * DAY_MS);
    yield* setMtimeMs(fs, unrelated, nowMs - 90 * DAY_MS);

    const removed = yield* pruneOrphanedPreviewPartitions({ userDataPath, nowMs });
    assert.equal(removed, 1);
    assert.isFalse(yield* fs.exists(stalePreview));
    assert.isTrue(yield* fs.exists(freshPreview));
    assert.isTrue(yield* fs.exists(unrelated));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("cleans expired and oversized compile-cache entries and runs full maintenance", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "prismux-maint-" });
    const userDataPath = path.join(root, "userData");
    const compileCacheDir = path.join(root, "compile-cache");
    yield* fs.makeDirectory(compileCacheDir, { recursive: true });
    const nowMs = Date.UTC(2026, 10, 26, 12, 0, 0);

    const expiredEntry = path.join(compileCacheDir, "old-build");
    const keepOlder = path.join(compileCacheDir, "prev-build");
    const keepNewer = path.join(compileCacheDir, "cur-build");
    for (const dir of [expiredEntry, keepOlder, keepNewer]) {
      yield* fs.makeDirectory(dir, { recursive: true });
      yield* fs.writeFileString(path.join(dir, "cache.bin"), "c".repeat(1_000));
    }
    yield* setMtimeMs(fs, path.join(expiredEntry, "cache.bin"), nowMs - 40 * DAY_MS);
    yield* setMtimeMs(fs, expiredEntry, nowMs - 40 * DAY_MS);
    yield* setMtimeMs(fs, path.join(keepOlder, "cache.bin"), nowMs - 5 * DAY_MS);
    yield* setMtimeMs(fs, keepOlder, nowMs - 5 * DAY_MS);
    yield* setMtimeMs(fs, path.join(keepNewer, "cache.bin"), nowMs - 1 * DAY_MS);
    yield* setMtimeMs(fs, keepNewer, nowMs - 1 * DAY_MS);

    const summary = yield* runUserDataMaintenance({
      userDataPath,
      compileCacheDir,
      nowMs,
      compileCacheMaxBytes: 1_500,
    });
    assert.equal(summary.compileCacheRemoved, 2);
    assert.isFalse(yield* fs.exists(expiredEntry));
    assert.isFalse(yield* fs.exists(keepOlder));
    assert.isTrue(yield* fs.exists(keepNewer));

    // Also verify standalone cleanupCompileCache returns 0 when already under limits.
    assert.equal(
      yield* cleanupCompileCache({ compileCacheDir, nowMs, maxBytes: 1_500 }),
      0,
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("sweeps orphaned snap-shots older than 24 hours", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const captureDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "prismux-snapshots-" });
    const nowMs = Date.UTC(2026, 10, 26, 12, 0, 0);

    const stalePng = path.join(captureDirectory, "orphan-1.png");
    const staleJson = path.join(captureDirectory, "orphan-1.json");
    const freshPng = path.join(captureDirectory, "recent-2.png");
    const unrelatedNote = path.join(captureDirectory, "readme.txt");
    for (const filePath of [stalePng, staleJson, freshPng, unrelatedNote]) {
      yield* fs.writeFileString(filePath, "data");
    }
    yield* setMtimeMs(fs, stalePng, nowMs - ORPHAN_SNAPSHOT_MAX_AGE_MS - 60_000);
    yield* setMtimeMs(fs, staleJson, nowMs - ORPHAN_SNAPSHOT_MAX_AGE_MS - 60_000);
    yield* setMtimeMs(fs, freshPng, nowMs - 60_000);
    yield* setMtimeMs(fs, unrelatedNote, nowMs - ORPHAN_SNAPSHOT_MAX_AGE_MS - 60_000);

    const removed = yield* cleanupOrphanedSnapShots({ captureDirectory, nowMs });
    assert.equal(removed, 2);
    assert.isFalse(yield* fs.exists(stalePng));
    assert.isFalse(yield* fs.exists(staleJson));
    assert.isTrue(yield* fs.exists(freshPng));
    assert.isTrue(yield* fs.exists(unrelatedNote));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("sweeps installed (<= currentVersion) and stale (>7d) pending updater installers", () =>
  Effect.gen(function* () {
    assert.equal(extractInstallerVersion("Prismux-0.2.2-rc.2-x64-setup.exe"), "0.2.2-rc.2");
    assert.equal(extractInstallerVersion("Prismux Setup 0.2.1.exe"), "0.2.1");
    assert.equal(extractInstallerVersion("update-info.json"), null);

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const pendingDir = yield* fs.makeTempDirectoryScoped({ prefix: "prismux-updater-pending-" });
    const nowMs = Date.UTC(2026, 10, 26, 12, 0, 0);

    const olderInstaller = path.join(pendingDir, "Prismux-0.2.2-rc.1-x64-setup.exe");
    const sameInstaller = path.join(pendingDir, "Prismux-0.2.2-rc.2-x64-setup.exe");
    const staleFutureInstaller = path.join(pendingDir, "Prismux-0.2.3-x64-setup.exe");
    const freshFutureInstaller = path.join(pendingDir, "Prismux-0.2.4-x64-setup.exe");
    const staleUpdateInfo = path.join(pendingDir, "update-info.json");
    for (const filePath of [
      olderInstaller,
      sameInstaller,
      staleFutureInstaller,
      freshFutureInstaller,
    ]) {
      yield* fs.writeFileString(filePath, "installer");
    }
    yield* fs.writeFileString(
      staleUpdateInfo,
      JSON.stringify({ fileName: "Prismux-0.2.2-rc.2-x64-setup.exe", version: "0.2.2-rc.2" }),
    );
    yield* setMtimeMs(fs, olderInstaller, nowMs - 60_000);
    yield* setMtimeMs(fs, sameInstaller, nowMs - 60_000);
    yield* setMtimeMs(fs, staleFutureInstaller, nowMs - PENDING_INSTALLER_MAX_AGE_MS - 60_000);
    yield* setMtimeMs(fs, freshFutureInstaller, nowMs - 60_000);
    yield* setMtimeMs(fs, staleUpdateInfo, nowMs - 60_000);

    const removed = yield* cleanupStalePendingInstallers({
      pendingDir,
      currentVersion: "0.2.2-rc.2",
      nowMs,
    });
    assert.equal(removed, 4);
    assert.isFalse(yield* fs.exists(olderInstaller));
    assert.isFalse(yield* fs.exists(sameInstaller));
    assert.isFalse(yield* fs.exists(staleFutureInstaller));
    assert.isFalse(yield* fs.exists(staleUpdateInfo));
    assert.isTrue(yield* fs.exists(freshFutureInstaller));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
