import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { SqliteMemoryStore } from "@prismux/memory-core";
import {
  AgentAuxService,
  ROSTER_SCAN_TTL_MS
} from "../agentAux/AgentAuxService.js";
import {
  AppUpdater,
  DEFAULT_DEAD_SESSION_TTL_MS,
  OvernightFactory,
  PersistentPtyPool,
  PrismuxDaemon,
  PrismuxProviderProbeService,
  ResourceMonitorService,
  STORAGE_WARNING_THRESHOLD_BYTES,
  ServiceDiagnosticsService,
  StorageQuotaService,
  clearCliDiscoveryCaches,
  defaultCliProbe,
  defaultDetectAndroidSdk,
  extractInstallerVersionFromFilename,
  type StorageCleanResponse,
  type StorageInventoryResponse
} from "../index.js";

const tempDirs: string[] = [];
const cleanups: Array<() => Promise<void> | void> = [];

after(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) {
      await fn();
    }
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("Daemon performance, caching, guardrails & WizTree StorageQuotaService", () => {
  test("negative & positive CLI discovery cache hits and clears on explicit refresh / clearCliDiscoveryCaches()", async () => {
    clearCliDiscoveryCaches();
    const root = makeTempDir("pmx-cli-cache-");
    const binDir = join(root, "bin");
    mkdirSync(binDir, { recursive: true });
    const fakeEnv: Record<string, string | undefined> = {
      PATH: binDir,
      USERPROFILE: root,
      LOCALAPPDATA: join(root, "AppData", "Local"),
      COMSPEC: process.env["COMSPEC"]
    };

    // 1. Negative cache on defaultCliProbe
    const first = await defaultCliProbe("nonexistent-pmx-tool", ["--version"], 1000, {
      env: fakeEnv,
      platform: process.platform,
      includeFallbackDirs: false
    });
    assert.equal(first.found, false);

    // Create the binary on disk AFTER negative result was cached
    const binFile =
      process.platform === "win32"
        ? join(binDir, "nonexistent-pmx-tool.cmd")
        : join(binDir, "nonexistent-pmx-tool");
    writeFileSync(
      binFile,
      process.platform === "win32"
        ? "@echo off\r\necho tool-v1.2.3\r\n"
        : "#!/bin/sh\necho tool-v1.2.3\n",
      { mode: 0o755 }
    );

    // Within 5-min negative TTL, cached miss is returned without re-scanning
    const cachedMiss = await defaultCliProbe("nonexistent-pmx-tool", ["--version"], 1000, {
      env: fakeEnv,
      platform: process.platform,
      includeFallbackDirs: false
    });
    assert.equal(cachedMiss.found, false);

    // Explicit refresh=true bypasses negative cache and detects the binary
    const refreshed = await defaultCliProbe("nonexistent-pmx-tool", ["--version"], 5000, {
      env: fakeEnv,
      platform: process.platform,
      includeFallbackDirs: false,
      refresh: true
    });
    assert.equal(refreshed.found, true);
    assert.equal(refreshed.path, binFile);

    // 2. Android SDK negative cache + clearCliDiscoveryCaches()
    const sdkEnv = {
      PATH: "",
      USERPROFILE: root,
      LOCALAPPDATA: join(root, "AppData", "Local")
    };
    const adbMiss1 = defaultDetectAndroidSdk({
      env: sdkEnv,
      platform: "win32",
      homeDir: root
    });
    assert.equal(adbMiss1.adbPath, null);

    const adbDir = join(root, "AppData", "Local", "Android", "Sdk", "platform-tools");
    mkdirSync(adbDir, { recursive: true });
    writeFileSync(join(adbDir, "adb.exe"), "MZ", "utf8");

    // Still cached negative
    const adbMissCached = defaultDetectAndroidSdk({
      env: sdkEnv,
      platform: "win32",
      homeDir: root
    });
    assert.equal(adbMissCached.adbPath, null);

    // After clearCliDiscoveryCaches(), discovers adb immediately
    clearCliDiscoveryCaches();
    const adbHit = defaultDetectAndroidSdk({
      env: sdkEnv,
      platform: "win32",
      homeDir: root
    });
    assert.equal(adbHit.adbPath, join(adbDir, "adb.exe"));
  });

  test("PrismuxProviderProbeService & ServiceDiagnosticsService scope scans to configured providers and honor 5m negative / 10m positive TTLs", async () => {
    const root = makeTempDir("pmx-provider-scope-");
    let nowMs = 1_700_000_000_000;
    const probedCommands: string[] = [];

    const probeService = new PrismuxProviderProbeService({
      homeDir: root,
      env: {},
      now: () => nowMs,
      refreshEnv: () => undefined,
      configuredProviders: ["codex"],
      cliProbe: async (cmd) => {
        probedCommands.push(cmd);
        if (cmd === "codex") {
          return {
            found: true,
            path: "/usr/bin/codex",
            version: "codex-cli 0.200.0",
            latencyMs: 3
          };
        }
        return { found: false, path: null, version: null, latencyMs: 1 };
      }
    });

    // 1. Default scoped probeAll ONLY scans configured provider (`codex`) — NEVER `agy` or `dsh`!
    const scopedRes = await probeService.probeAll();
    assert.deepEqual(
      scopedRes.providers.map((p) => p.providerId),
      ["codex"]
    );
    assert.deepEqual(probedCommands, ["codex"]);

    // 2. Positive cache lasts 10 minutes (at +6 min, still cached -> no re-probe)
    nowMs += 6 * 60 * 1000;
    await probeService.probeAll();
    assert.deepEqual(probedCommands, ["codex"]);

    // 3. Negative cache lasts 5 minutes: probe missing `claude` -> cached at +4m, expired at +6m
    await probeService.probeAll({ providers: ["claude"] });
    assert.deepEqual(probedCommands, ["codex", "claude"]);
    nowMs += 4 * 60 * 1000;
    await probeService.probeAll({ providers: ["claude"] });
    assert.deepEqual(probedCommands, ["codex", "claude"]);
    nowMs += 2 * 60 * 1000; // total +6m > 5m negative TTL
    await probeService.probeAll({ providers: ["claude"] });
    assert.deepEqual(probedCommands, ["codex", "claude", "claude"]);

    // 4. ServiceDiagnosticsService scopes AI CLI checks when `providers` is passed
    const diagCommands: string[] = [];
    const diag = new ServiceDiagnosticsService({
      dataDir: root,
      version: "0.2.2-rc.1",
      headless: true,
      startedAt: nowMs,
      refreshEnv: () => undefined,
      detectAndroidSdk: () => ({ sdkRoot: null, adbPath: null }),
      resolve7za: () => null,
      networkProbe: async () => ({ reachable: true, statusCode: 200, latencyMs: 2 }),
      cliProbe: async (cmd) => {
        diagCommands.push(cmd);
        return cmd === "codex"
          ? { found: true, path: "/usr/bin/codex", version: "0.200.0", latencyMs: 2 }
          : { found: false, path: null, version: null, latencyMs: 1 };
      }
    });

    await diag.runDiagnostics({ providers: ["codex"] });
    assert.ok(diagCommands.includes("codex"));
    assert.ok(!diagCommands.includes("agy"), "unconfigured agy must NOT be probed");
    assert.ok(!diagCommands.includes("dsh"), "unconfigured dsh must NOT be probed");

    // includeAll: true scans all known providers
    diagCommands.length = 0;
    await diag.runDiagnostics({ force: true, includeAll: true });
    assert.ok(diagCommands.includes("agy"));
    assert.ok(diagCommands.includes("dsh"));
  });

  test("ResourceMonitorService skips startup PowerShell warmup and uses fresh Electron hostMetrics without spawning WMI", async () => {
    const pool = new PersistentPtyPool();
    const monitor = new ResourceMonitorService({
      ptyPool: pool,
      mainPid: 8000
    });
    cleanups.push(async () => {
      monitor.stop();
      await pool.dispose();
    });

    monitor.start();
    // Push fresh Electron host metrics
    const ts = Date.now();
    monitor.ingestHostMetrics({
      collectedAt: ts - 1000,
      mainPid: 8000,
      cpuCores: 8,
      cpuScale: "system-total",
      electronProcesses: [
        { pid: 8000, type: "Browser", cpuPercent: 1.5, workingSetBytes: 90_000_000 }
      ]
    });
    monitor.ingestHostMetrics({
      collectedAt: ts,
      mainPid: 8000,
      cpuCores: 8,
      cpuScale: "system-total",
      electronProcesses: [
        { pid: 8000, type: "Browser", cpuPercent: 1.5, workingSetBytes: 90_000_000 }
      ]
    });

    const t0 = performance.now();
    const snap = await monitor.getResources({ forceRefresh: false });
    const elapsedMs = performance.now() - t0;

    assert.equal(snap.ok, true);
    assert.equal(snap.hostMetricsSource, "electron-push");
    assert.equal(snap.desktop?.memoryBytes, 90_000_000);
    // Must complete nearly instantaneously without spawning powershell.exe!
    assert.ok(
      elapsedMs < 250,
      `Expected zero-PowerShell fast return (<250ms), took ${Math.round(elapsedMs)}ms`
    );
  });

  test("AgentAuxService increases ROSTER_SCAN_TTL_MS to >=10s and skips reopening unchanged Codex SQLite files", async () => {
    assert.ok(ROSTER_SCAN_TTL_MS >= 10_000);
    const root = makeTempDir("pmx-aux-sqlite-cache-");
    const codexHome = join(root, ".codex");
    mkdirSync(codexHome, { recursive: true });

    const parentThread = "codex-cache-parent";
    const childThread = "codex-cache-child";
    const stateDbPath = join(codexHome, "state_5.sqlite");
    const goalsDbPath = join(codexHome, "goals_1.sqlite");

    const stateDb = new DatabaseSync(stateDbPath);
    stateDb.exec(`
      CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, agent_nickname TEXT, agent_role TEXT, model TEXT, reasoning_effort TEXT, cwd TEXT, updated_at_ms INTEGER);
      CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT PRIMARY KEY, status TEXT);
    `);
    stateDb
      .prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(childThread, "Subtask", "worker", "coder", "gpt-5", "medium", root, 1000);
    stateDb
      .prepare("INSERT INTO thread_spawn_edges VALUES (?, ?, ?)")
      .run(parentThread, childThread, "running");
    stateDb.close();

    const goalsDb = new DatabaseSync(goalsDbPath);
    goalsDb.exec(`
      CREATE TABLE thread_goals (thread_id TEXT PRIMARY KEY, goal_id TEXT, objective TEXT, status TEXT, token_budget INTEGER, tokens_used INTEGER, time_used_seconds INTEGER, created_at_ms INTEGER, updated_at_ms INTEGER);
    `);
    goalsDb
      .prepare("INSERT INTO thread_goals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(parentThread, "g1", "Optimize daemon", "active", 1000, 200, 10, 1000, 1000);
    goalsDb.close();

    let openCount = 0;
    const service = new AgentAuxService({
      agyAppDataDirs: [],
      claudeHomeDir: join(root, "none"),
      codexHomeDir: codexHome,
      openCodexDb: (dbPath) => {
        openCount += 1;
        return new DatabaseSync(dbPath, { readOnly: true });
      }
    });

    const snap1 = await service.inspect({ provider: "codex", sessionId: parentThread });
    assert.equal(snap1.active, true);
    assert.equal(openCount, 2, "initial inspect opens state_5 + goals_1 once each");

    // Repeated inspect while SQLite files unchanged -> ZERO DatabaseSync reopens!
    const snap2 = await service.inspect({ provider: "codex", sessionId: parentThread });
    assert.equal(snap2.active, true);
    assert.equal(openCount, 2, "unchanged sqlite files must not be reopened");

    // Modify goals_1.sqlite (bump mtime & update row) -> reopens goals_1 only!
    const goalsDb2 = new DatabaseSync(goalsDbPath);
    goalsDb2
      .prepare("UPDATE thread_goals SET tokens_used = 500 WHERE goal_id = 'g1'")
      .run();
    goalsDb2.close();
    const futureDate = new Date(Date.now() + 5_000);
    utimesSync(goalsDbPath, futureDate, futureDate);

    const snap3 = await service.inspect({ provider: "codex", sessionId: parentThread });
    assert.equal(snap3.codex?.goals[0]?.tokensUsed, 500);
    assert.equal(openCount, 3, "only the modified goals_1.sqlite should reopen");
  });

  test("PersistentPtyPool evicts dead sessions after 30m TTL and enforces maxRetainedDeadSessions cap", async () => {
    assert.equal(DEFAULT_DEAD_SESSION_TTL_MS, 30 * 60 * 1000);
    let nowMs = 1_700_000_000_000;
    const pool = new PersistentPtyPool({
      ringBufferBytes: 1024,
      deadSessionTtlMs: 30 * 60 * 1000,
      maxRetainedDeadSessions: 2,
      sweepIntervalMs: 0,
      now: () => nowMs
    });
    cleanups.push(() => pool.dispose());

    // Create 3 sessions, buffer data, and kill them sequentially
    for (let i = 1; i <= 3; i += 1) {
      nowMs += 1_000;
      pool.registerSession({ ptyId: `dead-${i}`, cwd: process.cwd() });
      pool.appendFrame(`dead-${i}`, `buffered-output-${i}`);
      await pool.kill(`dead-${i}`);
    }

    // Cap = 2 -> oldest dead session (`dead-1`) immediately evicted!
    assert.equal(pool.getSession("dead-1"), undefined);
    assert.ok(pool.getSession("dead-2") !== undefined);
    assert.ok(pool.getSession("dead-3") !== undefined);

    // Keep an alive session too
    pool.registerSession({ ptyId: "alive-1", cwd: process.cwd() });
    pool.appendFrame("alive-1", "live-data");

    // Advance clock past 30 min TTL -> remaining dead sessions evicted, alive session untouched!
    nowMs += 31 * 60 * 1000;
    const evicted = pool.evictDeadSessions();
    assert.equal(evicted, 2);
    assert.equal(pool.getSession("dead-2"), undefined);
    assert.equal(pool.getSession("dead-3"), undefined);
    assert.equal(pool.getSession("alive-1")?.alive, true);
  });

  test("AppUpdater.cleanupUpdateCache deletes <= currentVersion installers, >24h stale temps, and enforces 1 newer / 512 MiB cap", async () => {
    assert.equal(
      extractInstallerVersionFromFilename("Prismux-Setup-0.2.2-rc.1.exe"),
      "0.2.2-rc.1"
    );
    assert.equal(
      extractInstallerVersionFromFilename("Prismux-Portable-0.2.2-rc.1-win-x64.zip"),
      "0.2.2-rc.1"
    );

    const dataDir = makeTempDir("pmx-updater-clean-");
    const updatesDir = join(dataDir, "updates");
    mkdirSync(updatesDir, { recursive: true });

    const nowMs = Date.now();
    const oldTime = new Date(nowMs - 30 * 60 * 60 * 1000); // 30h ago
    const freshTime = new Date(nowMs - 10 * 60 * 1000); // 10m ago

    // 1. Old & current version installers (must be deleted)
    writeFileSync(join(updatesDir, "Prismux-Setup-0.2.0.exe"), Buffer.alloc(1024));
    writeFileSync(join(updatesDir, "Prismux-Setup-0.2.2-rc.1.exe"), Buffer.alloc(1024));
    // 2. Two newer installers (keep ONLY newest 0.2.3, delete 0.2.2)
    writeFileSync(join(updatesDir, "Prismux-Setup-0.2.2.exe"), Buffer.alloc(2048));
    writeFileSync(join(updatesDir, "Prismux-Setup-0.2.3.exe"), Buffer.alloc(4096));
    // 3. Stale (>24h) vs fresh (<24h) split-work & .part leftovers
    const staleSplitDir = join(updatesDir, ".split-work-old123");
    mkdirSync(staleSplitDir, { recursive: true });
    writeFileSync(join(staleSplitDir, "part.001"), Buffer.alloc(512));
    utimesSync(staleSplitDir, oldTime, oldTime);

    const stalePart = join(updatesDir, "Prismux-Setup-0.2.3.exe.part");
    writeFileSync(stalePart, Buffer.alloc(512));
    utimesSync(stalePart, oldTime, oldTime);

    const freshPart = join(updatesDir, "Prismux-Setup-0.2.4.exe.part");
    writeFileSync(freshPart, Buffer.alloc(256));
    utimesSync(freshPart, freshTime, freshTime);

    const updater = new AppUpdater({
      currentVersion: "0.2.2-rc.1",
      dataDir
    });

    const result = await updater.cleanupUpdateCache({ nowMs });
    assert.equal(existsSync(join(updatesDir, "Prismux-Setup-0.2.0.exe")), false);
    assert.equal(existsSync(join(updatesDir, "Prismux-Setup-0.2.2-rc.1.exe")), false);
    assert.equal(existsSync(join(updatesDir, "Prismux-Setup-0.2.2.exe")), false);
    assert.equal(existsSync(staleSplitDir), false);
    assert.equal(existsSync(stalePart), false);

    assert.equal(existsSync(join(updatesDir, "Prismux-Setup-0.2.3.exe")), true);
    assert.equal(existsSync(freshPart), true);
    assert.equal(result.freedBytes, 1024 + 1024 + 2048 + 512 + 512);
    assert.ok(result.keptFiles.includes("Prismux-Setup-0.2.3.exe"));
  });

  test("OvernightFactory.sweepStaleWorktrees removes >24h crashed worktree dirs and keeps fresh ones", async () => {
    const worktreeBase = makeTempDir("pmx-factory-wt-");
    const staleJobDir = join(worktreeBase, "job-crashed-old");
    const freshJobDir = join(worktreeBase, "job-active-fresh");
    mkdirSync(staleJobDir, { recursive: true });
    mkdirSync(freshJobDir, { recursive: true });
    writeFileSync(join(staleJobDir, "temp.txt"), "crashed-output");
    writeFileSync(join(freshJobDir, "active.txt"), "running-output");

    const nowMs = Date.now();
    const oldTime = new Date(nowMs - 26 * 60 * 60 * 1000);
    utimesSync(staleJobDir, oldTime, oldTime);

    const factory = new OvernightFactory({ worktreeBaseDir: worktreeBase });
    const swept = await factory.sweepStaleWorktrees({ nowMs });

    assert.equal(swept.removedPaths.length, 1);
    assert.equal(existsSync(staleJobDir), false);
    assert.equal(existsSync(freshJobDir), true);
    assert.ok(swept.freedBytes >= "crashed-output".length);
  });

  test("StorageQuotaService scans 5 roots safely (with symlink loop guard), caches 60s, and strictly enforces safety tiers on clean()", async () => {
    const sandbox = makeTempDir("pmx-storage-quota-");
    const baseDir = join(sandbox, "prismux-base");
    const electronDir = join(sandbox, "electron-userdata");
    const updaterLocalDir = join(sandbox, "prismux-updater");
    const tempDirA = join(sandbox, "temp-prismux");
    const tempDirB = join(sandbox, "temp-factory-worktrees");
    const legacyDir = join(sandbox, "legacy-t3");

    // Populate baseDir with protected, disposable, and managed items
    mkdirSync(join(baseDir, "credentials"), { recursive: true });
    mkdirSync(join(baseDir, "secrets"), { recursive: true });
    mkdirSync(join(baseDir, "config"), { recursive: true });
    mkdirSync(join(baseDir, "data"), { recursive: true });
    mkdirSync(join(baseDir, "logs"), { recursive: true });
    mkdirSync(join(baseDir, "browser-artifacts"), { recursive: true });
    mkdirSync(join(baseDir, "worktrees", "wt-1"), { recursive: true });
    mkdirSync(join(baseDir, "wallpapers"), { recursive: true });
    mkdirSync(join(baseDir, "updates"), { recursive: true });

    writeFileSync(join(baseDir, "credentials", "plugin-qq.enc"), Buffer.alloc(300));
    writeFileSync(join(baseDir, "secrets", "vault.key"), Buffer.alloc(200));
    writeFileSync(join(baseDir, "settings.json"), JSON.stringify({ theme: "dark" }));
    writeFileSync(join(baseDir, "config", "appearance.json"), JSON.stringify({ ok: true }));
    writeFileSync(join(baseDir, "logs", "daemon.log"), Buffer.alloc(4096));
    writeFileSync(join(baseDir, "browser-artifacts", "rec.webm"), Buffer.alloc(8192));
    writeFileSync(join(baseDir, "worktrees", "wt-1", "index.ts"), Buffer.alloc(2048));
    writeFileSync(join(baseDir, "wallpapers", "bg.mp4"), Buffer.alloc(6000));
    writeFileSync(join(baseDir, "updates", "Prismux-Setup-0.1.0.exe"), Buffer.alloc(5000));

    // Create >25 files in logs to verify top-25 children cap
    for (let i = 0; i < 30; i += 1) {
      writeFileSync(join(baseDir, "logs", `term-${i}.log`), Buffer.alloc(100 + i));
    }

    // Create a symlink loop inside logs to verify loop protection does NOT hang or escape!
    try {
      symlinkSync(baseDir, join(baseDir, "logs", "loop-to-base"), "junction");
    } catch {
      // Some environments disallow symlinks; junction works on Windows without admin.
    }

    // Populate Electron userData: disposable Cache vs protected Local Storage & Preferences
    mkdirSync(join(electronDir, "Cache"), { recursive: true });
    mkdirSync(join(electronDir, "Local Storage"), { recursive: true });
    writeFileSync(join(electronDir, "Cache", "data_0"), Buffer.alloc(7000));
    writeFileSync(join(electronDir, "Local Storage", "leveldb.ldb"), Buffer.alloc(1500));
    writeFileSync(join(electronDir, "Preferences"), JSON.stringify({ lang: "zh" }));

    // Populate updater local cache, temp caches, and legacy ~/.t3
    mkdirSync(updaterLocalDir, { recursive: true });
    writeFileSync(join(updaterLocalDir, "pending.exe"), Buffer.alloc(3500));
    mkdirSync(tempDirA, { recursive: true });
    writeFileSync(join(tempDirA, "tmp.bin"), Buffer.alloc(1200));
    mkdirSync(tempDirB, { recursive: true });
    writeFileSync(join(tempDirB, "crashed.txt"), Buffer.alloc(800));
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "old.log"), Buffer.alloc(2500));

    // Initialize real memory.db inside baseDir/data/memory.db
    const memoryStore = new SqliteMemoryStore({
      dbPath: join(baseDir, "data", "memory.db"),
      machineId: "storage-test",
      embeddingDimensions: 4,
      enableWal: true,
      loadVectorExtension: false
    });
    await memoryStore.initialize();
    cleanups.push(() => memoryStore.close());
    await memoryStore.upsert({
      namespace: "private/chief",
      kind: "fact",
      title: "Protected DB Entry",
      content: "Must survive compact-db and all clean calls",
      machineId: "storage-test"
    });

    let nowMs = 1_750_000_000_000;
    const svc = new StorageQuotaService({
      dataDir: baseDir,
      electronUserDataDir: electronDir,
      updaterLocalCacheDir: updaterLocalDir,
      tempCacheDirs: [tempDirA, tempDirB],
      legacyT3Dir: legacyDir,
      memoryStore,
      now: () => nowMs
    });

    // 1. Scan and validate contract
    const inv1 = await svc.getInventory();
    assert.equal(inv1.ok, true);
    assert.equal(inv1.warningThresholdBytes, STORAGE_WARNING_THRESHOLD_BYTES);
    assert.equal(inv1.roots.length, 5);
    assert.equal(
      inv1.reclaimableDisposableBytes +
        inv1.reclaimableManagedBytes +
        inv1.protectedBytes,
      inv1.totalBytes
    );
    assert.ok(inv1.policies.length >= 4);

    const logsCat = inv1.categories.find((c) => c.id === "logs");
    assert.ok(logsCat !== undefined);
    assert.equal(logsCat.tier, "disposable");
    assert.ok((logsCat.children?.length ?? 0) <= 25, "children capped at top 25");

    // 2. 60s cache hit
    nowMs += 30_000;
    const invCached = await svc.getInventory();
    assert.equal(invCached.scannedAt, inv1.scannedAt);

    // 3. Attempting to delete protected category is strictly REFUSED!
    const refused = await svc.clean({ targetIds: ["credentials-config", "electron-userdata"] });
    assert.equal(refused.ok, true);
    assert.ok(refused.errors.length >= 2);
    assert.equal(existsSync(join(baseDir, "credentials", "plugin-qq.enc")), true);
    assert.equal(existsSync(join(baseDir, "secrets", "vault.key")), true);
    assert.equal(existsSync(join(baseDir, "settings.json")), true);
    assert.equal(existsSync(join(electronDir, "Preferences")), true);
    assert.equal(existsSync(join(electronDir, "Local Storage", "leveldb.ldb")), true);

    // 4. Clean disposable categories (`clean-cache`, `clean-logs`, `clean-updates`)
    const cleanDisposable = await svc.clean({
      actions: ["clean-cache", "clean-logs", "clean-updates"]
    });
    assert.equal(cleanDisposable.ok, true);
    assert.ok(cleanDisposable.freedBytes > 0);
    assert.equal(existsSync(join(baseDir, "logs", "daemon.log")), false);
    assert.equal(existsSync(join(electronDir, "Cache", "data_0")), false);
    assert.equal(existsSync(join(tempDirA, "tmp.bin")), false);
    assert.equal(existsSync(join(updaterLocalDir, "pending.exe")), false);
    // Protected & managed items MUST survive disposable cleanup!
    assert.equal(existsSync(join(baseDir, "credentials", "plugin-qq.enc")), true);
    assert.equal(existsSync(join(baseDir, "data", "memory.db")), true);
    assert.equal(existsSync(join(electronDir, "Preferences")), true);
    assert.equal(existsSync(join(baseDir, "browser-artifacts", "rec.webm")), true);
    assert.equal(existsSync(join(legacyDir, "old.log")), true);

    // 5. compact-db NEVER deletes memory.db
    const compactRes = await svc.clean({ actions: ["compact-db"] });
    assert.equal(compactRes.ok, true);
    assert.equal(existsSync(join(baseDir, "data", "memory.db")), true);
    const activeAfterCompact = await memoryStore.listEntries("owner_chief");
    assert.equal(activeAfterCompact.length, 1);

    // 6. Explicit clean-legacy removes ~/.t3
    const legacyClean = await svc.clean({ actions: ["clean-legacy"] });
    assert.equal(legacyClean.ok, true);
    assert.equal(existsSync(legacyDir), false);
  });

  test("Daemon HTTP routes GET /v1/system/storage, POST /v1/system/storage/clean, and ?providers= scoping enforce auth & scope", async () => {
    const sandbox = makeTempDir("pmx-http-storage-");
    const dataDir = join(sandbox, "data-dir");
    mkdirSync(join(dataDir, "logs"), { recursive: true });
    writeFileSync(join(dataDir, "logs", "http-test.log"), Buffer.alloc(2048));
    mkdirSync(join(dataDir, "credentials"), { recursive: true });
    writeFileSync(join(dataDir, "credentials", "secret.enc"), Buffer.alloc(128));

    const token = "storage-route-owner-token";
    const daemon = new PrismuxDaemon({
      headless: true,
      dataDir,
      host: "127.0.0.1",
      port: 0,
      authToken: token,
      disableAutoUpdateCheck: true,
      storageQuotaOptions: {
        electronUserDataDir: join(sandbox, "electron-userdata"),
        updaterLocalCacheDir: join(sandbox, "prismux-updater"),
        tempCacheDirs: [join(sandbox, "temp-prismux")],
        legacyT3Dir: join(sandbox, "legacy-t3")
      }
    });
    const ready = await daemon.start();
    cleanups.push(() => daemon.stop());

    const headers = {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json"
    };

    // Unauthenticated -> 401
    const unauth = await fetch(`${ready.httpUrl}/v1/system/storage`);
    assert.equal(unauth.status, 401);

    // Non-owner scope -> 403
    const groupToken = "qq-group-storage-forbidden";
    daemon.pairingManager.registerScopedToken(groupToken, "qq_group:42", "qq-42");
    const forbidden = await fetch(`${ready.httpUrl}/v1/system/storage`, {
      headers: { Authorization: `Bearer ${groupToken}` }
    });
    assert.equal(forbidden.status, 403);

    // Owner GET /v1/system/storage?refresh=1 -> 200
    const res = await fetch(`${ready.httpUrl}/v1/system/storage?refresh=1`, { headers });
    assert.equal(res.status, 200);
    const inv = (await res.json()) as StorageInventoryResponse;
    assert.equal(inv.ok, true);
    assert.equal(inv.roots.length, 5);
    assert.ok(inv.totalBytes >= 2048);

    // Owner POST /v1/system/storage/clean -> cleans logs, preserves credentials
    const cleanRes = await fetch(`${ready.httpUrl}/v1/system/storage/clean`, {
      method: "POST",
      headers,
      body: JSON.stringify({ actions: ["clean-logs"] })
    });
    assert.equal(cleanRes.status, 200);
    const cleanJson = (await cleanRes.json()) as StorageCleanResponse;
    assert.equal(cleanJson.ok, true);
    assert.ok(cleanJson.freedBytes >= 2048);
    assert.equal(existsSync(join(dataDir, "logs", "http-test.log")), false);
    assert.equal(existsSync(join(dataDir, "credentials", "secret.enc")), true);

    // Owner GET /v1/providers/probe?providers=codex -> returns only codex
    const scopedProbeRes = await fetch(
      `${ready.httpUrl}/v1/providers/probe?providers=codex`,
      { headers }
    );
    assert.equal(scopedProbeRes.status, 200);
    const scopedProbeJson = (await scopedProbeRes.json()) as {
      ok: boolean;
      providers: Array<{ providerId: string }>;
    };
    assert.equal(scopedProbeJson.ok, true);
    assert.deepEqual(
      scopedProbeJson.providers.map((p) => p.providerId),
      ["codex"]
    );
  });
});
