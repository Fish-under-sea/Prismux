import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  PRISMUX_SQLITE_VEC_PATH_ENV,
  SqliteMemoryStore,
  getSqliteVecPlatformSpec,
  loadSqliteVecExtension,
  normalizeAsarUnpackedCandidates,
  resolveSqliteVecCandidatePaths
} from "../index.js";

test("sqlite-vec loads out-of-the-box in dev mode, reports real vec_version(), and executes KNN + FTS5 hybrid search", async () => {
  const store = new SqliteMemoryStore({
    dbPath: ":memory:",
    machineId: "vec-native-dev",
    embeddingDimensions: 4,
    enableWal: false
  });

  try {
    await store.initialize();
    assert.equal(store.isVectorSearchEnabled(), true);
    assert.equal(store.getRetrievalMode(), "fts5+sqlite-vec");

    const vecVersion = store.getVectorExtensionVersion();
    assert.ok(
      typeof vecVersion === "string" && /^v?\d+\.\d+\.\d+/.test(vecVersion),
      `Expected valid semver from SELECT vec_version(), got: ${String(vecVersion)}`
    );

    const status = store.getVectorExtensionStatus();
    assert.equal(status.loaded, true);
    assert.equal(status.mode, "fts5+sqlite-vec");
    assert.equal(status.version, vecVersion);
    assert.ok(status.extensionPath && status.extensionPath.length > 0);
    assert.equal(status.error, null);

    // Direct DatabaseSync probe verifies real SELECT vec_version() matches store status.
    const probeDb = new DatabaseSync(":memory:", { allowExtension: true });
    try {
      const directLoad = await loadSqliteVecExtension(probeDb);
      assert.equal(directLoad.loaded, true);
      assert.equal(directLoad.version, vecVersion);
      const row = probeDb.prepare("SELECT vec_version() AS v").get() as { v: string };
      assert.equal(row.v, vecVersion);
    } finally {
      probeDb.close();
    }

    const lexicalAndSemantic = await store.upsert(
      {
        namespace: "private/chief",
        kind: "fact",
        title: "SQLite Vec Hybrid Engine",
        content: "Prismux desktop bundles vec0 native library for hybrid FTS5 and vector search.",
        machineId: "vec-native-dev",
        importance: 0.9
      },
      [1, 0, 0, 0]
    );
    const semanticOnly = await store.upsert(
      {
        namespace: "workspace/prismux",
        kind: "fact",
        title: "Dense Semantic Neighbor",
        content: "Unrelated wording without any matching query keywords.",
        machineId: "vec-native-dev",
        importance: 0.6
      },
      [0.95, 0.05, 0, 0]
    );
    await store.upsert(
      {
        namespace: "workspace/prismux",
        kind: "fact",
        title: "Orthogonal Distractor",
        content: "Completely orthogonal embedding and unrelated text.",
        machineId: "vec-native-dev",
        importance: 0.2
      },
      [0, 0, 0, 1]
    );

    const hybrid = await store.query(
      {
        callerScope: "owner_chief",
        query: "hybrid vector",
        mode: "hybrid",
        limit: 5
      },
      "owner_chief",
      [1, 0, 0, 0]
    );
    assert.equal(hybrid.degradedToFtsOnly, false);
    assert.ok(hybrid.hits.length >= 2);
    assert.equal(hybrid.hits[0]?.entry.id, lexicalAndSemantic.id);
    assert.equal(hybrid.hits[0]?.matchSource, "rrf");
    assert.ok((hybrid.hits[0]?.score ?? 0) > 0);
    assert.ok(
      hybrid.hits.some((hit) => hit.entry.id === semanticOnly.id),
      "Expected KNN semantic neighbor to be fused into hybrid results"
    );

    const knn = await store.query(
      {
        callerScope: "owner_chief",
        query: "",
        mode: "vector",
        limit: 2
      },
      "owner_chief",
      [0.96, 0.04, 0, 0]
    );
    assert.equal(knn.degradedToFtsOnly, false);
    assert.equal(knn.hits.length, 2);
    assert.equal(knn.hits[0]?.matchSource, "vector");
    assert.ok((knn.hits[0]?.score ?? 0) > 0.9);
  } finally {
    await store.close();
  }
});

test("resolveSqliteVecCandidatePaths enforces priority order and rewrites .asar paths to .asar.unpacked", () => {
  const candidates = resolveSqliteVecCandidatePaths({
    env: {
      [PRISMUX_SQLITE_VEC_PATH_ENV]: "C:\\custom\\vec0.dll"
    },
    resourcesPath: "C:\\Program Files\\Prismux\\resources",
    cwd: "C:\\Program Files\\Prismux\\resources\\prismux-daemon",
    moduleDir: "C:\\Program Files\\Prismux\\resources\\prismux-daemon\\node_modules\\@prismux\\memory-core\\dist",
    platform: "win32",
    arch: "x64"
  });

  assert.equal(candidates[0]?.source, "env");
  assert.ok(candidates[0]?.path.toLowerCase().endsWith("vec0.dll"));

  const firstElectronIdx = candidates.findIndex((c) => c.source === "electron-resources");
  const firstLocalIdx = candidates.findIndex((c) => c.source === "local-node-modules");
  assert.ok(firstElectronIdx > 0, "Electron resources should come immediately after env");
  assert.ok(
    firstLocalIdx > firstElectronIdx,
    "Local node_modules should come after Electron resources"
  );
  assert.ok(
    candidates[firstElectronIdx]?.path.includes(join("native", "sqlite-vec", "vec0.dll")),
    `Expected native/sqlite-vec/vec0.dll first in Electron resources, got ${candidates[firstElectronIdx]?.path}`
  );

  // Explicit config override is strict and does not fall back to other tiers.
  const strictCandidates = resolveSqliteVecCandidatePaths({
    explicitPath: "C:\\strict\\custom-vec0.dll",
    env: { [PRISMUX_SQLITE_VEC_PATH_ENV]: "C:\\ignored\\vec0.dll" },
    resourcesPath: "C:\\Program Files\\Prismux\\resources",
    platform: "win32",
    arch: "x64"
  });
  assert.equal(strictCandidates.length, 1);
  assert.equal(strictCandidates[0]?.source, "explicit-config");

  // ASAR paths expand to .asar.unpacked before .asar.
  const asarExpanded = normalizeAsarUnpackedCandidates(
    "C:\\Apps\\Prismux\\resources\\app.asar\\node_modules\\sqlite-vec-windows-x64\\vec0.dll"
  );
  assert.equal(asarExpanded.length, 2);
  assert.ok(asarExpanded[0]?.includes("app.asar.unpacked"));
});

test("SqliteMemoryStore loads vec0 from Electron resourcesPath, PRISMUX_SQLITE_VEC_PATH, and Unicode/space paths without npm package import", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "prismux-vec-packaged-"));
  const spec = getSqliteVecPlatformSpec();

  try {
    // Locate real native library from current dev environment to simulate packaged artifacts.
    const bootstrapStore = new SqliteMemoryStore({
      dbPath: ":memory:",
      machineId: "bootstrap",
      embeddingDimensions: 4,
      enableWal: false
    });
    await bootstrapStore.initialize();
    const realDllPath = bootstrapStore.getVectorExtensionPath();
    const expectedVersion = bootstrapStore.getVectorExtensionVersion();
    await bootstrapStore.close();

    assert.ok(realDllPath, "Expected dev environment to locate real native sqlite-vec binary");
    assert.ok(expectedVersion, "Expected dev environment to return real vec_version()");

    // 1. Simulated Electron packaged resources/native/sqlite-vec/vec0.dll inside a Unicode + space install path.
    const packagedResourcesDir = join(tempRoot, "Prismux 安装目录", "resources");
    const packagedDllPath = join(
      packagedResourcesDir,
      "native",
      "sqlite-vec",
      spec.libraryFileName
    );
    await mkdir(join(packagedResourcesDir, "native", "sqlite-vec"), { recursive: true });
    await copyFile(realDllPath, packagedDllPath);

    const packagedStore = new SqliteMemoryStore({
      dbPath: ":memory:",
      machineId: "packaged-win",
      embeddingDimensions: 4,
      enableWal: false,
      resourcesPath: packagedResourcesDir,
      allowPackageImport: false
    });
    try {
      await packagedStore.initialize();
      assert.equal(packagedStore.isVectorSearchEnabled(), true);
      assert.equal(packagedStore.getRetrievalMode(), "fts5+sqlite-vec");
      assert.equal(packagedStore.getVectorExtensionVersion(), expectedVersion);
      assert.equal(packagedStore.getVectorExtensionPath(), resolve(packagedDllPath));
      assert.equal(packagedStore.getVectorExtensionStatus().source, "electron-resources");
    } finally {
      await packagedStore.close();
    }

    // 2. Explicit extensionless path (`.../vec0`) on Unicode + space path works seamlessly.
    const withoutExt = packagedDllPath.slice(0, -(spec.extension.length + 1));
    const extensionlessStore = new SqliteMemoryStore({
      dbPath: ":memory:",
      machineId: "extensionless-win",
      embeddingDimensions: 4,
      enableWal: false,
      vectorExtensionPath: withoutExt,
      allowPackageImport: false
    });
    try {
      await extensionlessStore.initialize();
      assert.equal(extensionlessStore.isVectorSearchEnabled(), true);
      assert.equal(extensionlessStore.getVectorExtensionVersion(), expectedVersion);
      assert.equal(extensionlessStore.getVectorExtensionPath(), resolve(packagedDllPath));
    } finally {
      await extensionlessStore.close();
    }

    // 3. PRISMUX_SQLITE_VEC_PATH environment variable override (pointing to directory containing vec0.dll).
    const envDir = join(tempRoot, "env 覆盖目录");
    const envDllPath = join(envDir, spec.libraryFileName);
    await mkdir(envDir, { recursive: true });
    await copyFile(realDllPath, envDllPath);

    const prevEnv = process.env[PRISMUX_SQLITE_VEC_PATH_ENV];
    process.env[PRISMUX_SQLITE_VEC_PATH_ENV] = envDir;
    const envStore = new SqliteMemoryStore({
      dbPath: ":memory:",
      machineId: "env-override",
      embeddingDimensions: 4,
      enableWal: false,
      resourcesPath: null,
      allowPackageImport: false
    });
    try {
      await envStore.initialize();
      assert.equal(envStore.isVectorSearchEnabled(), true);
      assert.equal(envStore.getVectorExtensionVersion(), expectedVersion);
      assert.equal(envStore.getVectorExtensionPath(), resolve(envDllPath));
      assert.equal(envStore.getVectorExtensionStatus().source, "env");
    } finally {
      await envStore.close();
      if (prevEnv === undefined) {
        delete process.env[PRISMUX_SQLITE_VEC_PATH_ENV];
      } else {
        process.env[PRISMUX_SQLITE_VEC_PATH_ENV] = prevEnv;
      }
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore degrades gracefully to FTS5-only with diagnostics when vec0.dll is missing", async () => {
  const missingDll = join(tmpdir(), `missing-prismux-vec0-${Date.now()}.dll`);
  const store = new SqliteMemoryStore({
    dbPath: ":memory:",
    machineId: "degraded-regression",
    embeddingDimensions: 4,
    enableWal: false,
    vectorExtensionPath: missingDll
  });

  try {
    await store.initialize();
    assert.equal(store.isVectorSearchEnabled(), false);
    assert.equal(store.getRetrievalMode(), "fts5-only");
    assert.equal(store.getVectorExtensionVersion(), null);
    assert.equal(store.getVectorExtensionPath(), null);

    const status = store.getVectorExtensionStatus();
    assert.equal(status.loaded, false);
    assert.equal(status.mode, "fts5-only");
    assert.ok(
      typeof status.error === "string" && status.error.length > 0,
      "Expected diagnostic error reason when vec0 is missing"
    );

    await store.upsert(
      {
        namespace: "private/chief",
        kind: "fact",
        title: "FTS5 Fallback Note",
        content: "Even without vec0.dll, FTS5 lexical memory search stays completely functional.",
        machineId: "degraded-regression"
      },
      [1, 0, 0, 0]
    );

    const result = await store.query(
      {
        callerScope: "owner_chief",
        query: "lexical memory",
        mode: "hybrid"
      },
      "owner_chief",
      [1, 0, 0, 0]
    );
    assert.equal(result.degradedToFtsOnly, true);
    assert.equal(result.hits.length, 1);
    assert.equal(result.hits[0]?.matchSource, "fts");
  } finally {
    await store.close();
  }
});
