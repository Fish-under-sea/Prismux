import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { SqliteMemoryStore } from "@prismux/memory-core";
import type {
  ServiceDiagnosticsResponse,
  SyncNowResponse,
  SyncTestResponse,
  SystemPortsResponse,
  SystemResourcesResponse,
  UpdaterStatusSnapshot
} from "@prismux/protocol";
import { PrismuxDaemon } from "../index.js";
import { PersistentPtyPool } from "../pty/PersistentPtyPool.js";
import { getOfficialPluginArchiveCandidateFilenames } from "../server/DaemonBusinessRoutes.js";
import {
  PortKillError,
  PortScannerService,
  parseWindowsNetstatOutput
} from "../system/PortScannerService.js";
import {
  ResourceMonitorService,
  parseWindowsProcessTreeTsv,
  type ExtendedSystemResourcesResponse,
  type OsProcessSnapshotEntry
} from "../system/ResourceMonitorService.js";
import {
  ServiceDiagnosticsService,
  normalizeT3HttpProbeUrl
} from "../system/ServiceDiagnosticsService.js";
import {
  AppUpdater,
  DEFAULT_AUTO_CHECK_INITIAL_DELAY_MS,
  DEFAULT_AUTO_CHECK_INTERVAL_MS,
  UpdateIntegrityError,
  parseGiteeWebReleasesHtml,
  resolve7zaBinary,
  selectSoftwareChecksumAsset,
  type AppUpdaterTimerApi
} from "../updater/AppUpdater.js";

const execFileAsync = promisify(execFile);

const cleanupDirs: string[] = [];
after(() => {
  for (const dir of cleanupDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function startMockServer(
  handler: http.RequestListener
): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const addr = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

async function closeMockServer(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((err) => {
      if (err) rejectPromise(err);
      else resolvePromise();
    });
  });
}

async function createRealSplit7zFixture(
  sevenZipExe: string,
  exeName: string,
  payload: Buffer,
  volumeSizeArg = "24k"
): Promise<{
  fixtureDir: string;
  parts: Array<{ name: string; bytes: Buffer }>;
}> {
  const fixtureDir = makeTempDir("prismux-7z-fixture-");
  const sourceExe = join(fixtureDir, exeName);
  writeFileSync(sourceExe, payload);
  const archiveBase = join(fixtureDir, `${exeName}.7z`);

  await execFileAsync(
    sevenZipExe,
    ["a", "-t7z", "-mx=0", `-v${volumeSizeArg}`, archiveBase, sourceExe],
    { windowsHide: true, timeout: 15_000 }
  );

  const partNames = readdirSync(fixtureDir)
    .filter((name) => name.startsWith(`${exeName}.7z.`))
    .sort((a, b) => a.localeCompare(b));
  assert.ok(
    partNames.length >= 2,
    `Expected >=2 split 7z volumes, got ${partNames.join(", ")}`
  );

  return {
    fixtureDir,
    parts: partNames.map((name) => ({
      name,
      bytes: readFileSync(join(fixtureDir, name))
    }))
  };
}

// ---------------------------------------------------------------------------
// 1. Gitee split-7z-exe detection, Range resume, 7z extract, SHA-256 & 1-byte tamper
// ---------------------------------------------------------------------------

test("AppUpdater recognizes Gitee split-7z-exe, resumes mid-part, extracts via 7z, verifies SHA-256, and streams SSE events", async () => {
  const sevenZip = resolve7zaBinary();
  assert.ok(sevenZip !== null, "Expected 7za/7z binary on Windows test host");

  const exeName = "Prismux-Setup-0.2.0-win-x64.exe";
  // Incompressible random bytes ensure predictable multi-volume splitting.
  const exePayload = randomBytes(68 * 1024);
  const expectedSha = sha256Hex(exePayload);
  const fixture = await createRealSplit7zFixture(sevenZip, exeName, exePayload, "24k");

  let part2RequestCount = 0;
  let mockRef!: { server: http.Server; baseUrl: string };
  mockRef = await startMockServer((req, res) => {
    const urlPath = req.url ?? "/";
    if (urlPath.startsWith("/gitee/repos/")) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify([
          {
            tag_name: "v0.2.0",
            name: "Prismux v0.2.0",
            prerelease: false,
            draft: false,
            assets: [
              ...fixture.parts.map((part) => ({
                name: part.name,
                browser_download_url: `${mockRef.baseUrl}/dl/${encodeURIComponent(part.name)}`,
                size: part.bytes.length
              })),
              {
                name: `${exeName}.sha256`,
                browser_download_url: `${mockRef.baseUrl}/dl/${encodeURIComponent(exeName)}.sha256`
              }
            ]
          }
        ])
      );
      return;
    }

    if (urlPath === `/dl/${encodeURIComponent(exeName)}.sha256`) {
      res.statusCode = 200;
      res.end(`${expectedSha}  ${exeName}\n`);
      return;
    }

    const matchedPart = fixture.parts.find(
      (part) => urlPath === `/dl/${encodeURIComponent(part.name)}`
    );
    if (matchedPart) {
      const rangeHeader = req.headers.range;
      // Inject a clean mid-stream interruption on the first request for volume 2 to test resume.
      if (matchedPart.name.endsWith(".002") && !rangeHeader && part2RequestCount === 0) {
        part2RequestCount += 1;
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": String(matchedPart.bytes.length)
        });
        const firstHalf = matchedPart.bytes.subarray(
          0,
          Math.floor(matchedPart.bytes.length / 2)
        );
        res.write(firstHalf);
        setTimeout(() => {
          res.destroy();
        }, 15);
        return;
      }

      if (typeof rangeHeader === "string" && rangeHeader.startsWith("bytes=")) {
        const start = Number.parseInt(rangeHeader.slice("bytes=".length).split("-")[0]!, 10);
        const slice = matchedPart.bytes.subarray(start);
        res.writeHead(206, {
          "content-type": "application/octet-stream",
          "content-range": `bytes ${start}-${matchedPart.bytes.length - 1}/${matchedPart.bytes.length}`,
          "content-length": String(slice.length)
        });
        res.end(slice);
        return;
      }

      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(matchedPart.bytes.length)
      });
      res.end(matchedPart.bytes);
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  try {
    const dataDir = makeTempDir("prismux-split7z-ok-");
    const updater = new AppUpdater({
      currentVersion: "0.1.0",
      dataDir,
      sevenZipPath: sevenZip,
      giteeApiBase: `${mockRef.baseUrl}/gitee`,
      githubApiBase: `${mockRef.baseUrl}/github-offline`,
      initialPolicy: { routePreference: "domestic", includePrerelease: true },
      retryDelaysMs: [10, 20]
    });

    const events: string[] = [];
    const unsubscribe = updater.subscribeEvents((evt) => {
      events.push(evt.type);
    });

    const check = await updater.checkForUpdates({ sourceOverride: "gitee" });
    assert.equal(check.hasUpdate, true);
    assert.equal(check.latestVersion, "0.2.0");
    assert.ok(check.recommendedAsset !== null);
    assert.equal(check.recommendedAsset.kind, "split-7z-exe");
    assert.equal(check.recommendedAsset.expectedExeName, exeName);
    assert.equal(check.recommendedAsset.expectedSha256, expectedSha);
    assert.ok(check.recommendedAsset.sha256Url?.includes(`${exeName}.sha256`));
    assert.equal(check.recommendedAsset.parts?.length, fixture.parts.length);

    const progressStages = new Set<string>();
    const dlResult = await updater.downloadUpdate({
      checkResult: check,
      onProgress: (p) => {
        progressStages.add(p.stage);
      }
    });

    unsubscribe();

    assert.equal(dlResult.verified, true);
    assert.equal(dlResult.sha256, expectedSha);
    assert.equal(dlResult.assetName, exeName);
    assert.equal(dlResult.packageKind, "split-7z-exe");
    assert.ok(dlResult.resumedFromBytes > 0, "Expected Range resume on part 2");
    assert.deepEqual(readFileSync(dlResult.filePath), exePayload);

    assert.ok(progressStages.has("downloading"));
    assert.ok(progressStages.has("extracting"));
    assert.ok(progressStages.has("verifying"));
    assert.ok(events.includes("extracting"));
    assert.ok(events.includes("verifying"));
    assert.ok(events.includes("ready"));

    const status = updater.getStatus();
    assert.equal(status.installState, "ready");
    assert.equal(status.downloadedFilePath, dlResult.filePath);
    assert.equal(status.downloadedSha256, expectedSha);
    assert.equal(status.portableMode, false);

    // Ensure isolated work directory fragments were cleaned up cleanly.
    const updatesEntries = readdirSync(updater.getDownloadsDir());
    assert.deepEqual(updatesEntries, [exeName]);
  } finally {
    await closeMockServer(mockRef.server);
  }
});

test("AppUpdater rejects 1-byte tampered split-7z extracted exe and wipes all temporary fragments immediately", async () => {
  const sevenZip = resolve7zaBinary();
  assert.ok(sevenZip !== null, "Expected 7za/7z binary on Windows test host");

  const exeName = "Prismux-Setup-0.2.1-win-x64.exe";
  const legitPayload = randomBytes(60 * 1024);
  const legitSha = sha256Hex(legitPayload);

  // Flip 1 single byte in the payload packed into the split 7z archive!
  const tamperedPayload = Buffer.from(legitPayload);
  tamperedPayload[1024] = tamperedPayload[1024]! ^ 0x01;
  assert.notEqual(sha256Hex(tamperedPayload), legitSha);

  const fixture = await createRealSplit7zFixture(
    sevenZip,
    exeName,
    tamperedPayload,
    "24k"
  );

  let mockRef!: { server: http.Server; baseUrl: string };
  mockRef = await startMockServer((req, res) => {
    const urlPath = req.url ?? "/";
    if (urlPath.startsWith("/gitee/repos/")) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify([
          {
            tag_name: "v0.2.1",
            prerelease: false,
            draft: false,
            assets: [
              ...fixture.parts.map((part) => ({
                name: part.name,
                browser_download_url: `${mockRef.baseUrl}/dl/${encodeURIComponent(part.name)}`,
                size: part.bytes.length
              })),
              {
                name: `${exeName}.sha256`,
                browser_download_url: `${mockRef.baseUrl}/dl/${encodeURIComponent(exeName)}.sha256`
              }
            ]
          }
        ])
      );
      return;
    }

    if (urlPath === `/dl/${encodeURIComponent(exeName)}.sha256`) {
      res.statusCode = 200;
      res.end(`${legitSha}  ${exeName}\n`);
      return;
    }

    const matchedPart = fixture.parts.find(
      (part) => urlPath === `/dl/${encodeURIComponent(part.name)}`
    );
    if (matchedPart) {
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(matchedPart.bytes.length)
      });
      res.end(matchedPart.bytes);
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  try {
    const dataDir = makeTempDir("prismux-split7z-tamper-");
    const updater = new AppUpdater({
      currentVersion: "0.1.0",
      dataDir,
      sevenZipPath: sevenZip,
      giteeApiBase: `${mockRef.baseUrl}/gitee`,
      githubApiBase: `${mockRef.baseUrl}/github-offline`,
      initialPolicy: { routePreference: "domestic", includePrerelease: true }
    });

    const check = await updater.checkForUpdates({ sourceOverride: "gitee" });
    await assert.rejects(
      () => updater.downloadUpdate({ checkResult: check }),
      (err: unknown) => err instanceof UpdateIntegrityError
    );

    const status = updater.getStatus();
    assert.equal(status.installState, "error");
    assert.equal(status.downloadedFilePath, null);

    // Zero leftover fragments or extracted tampered binaries!
    const updatesDir = updater.getDownloadsDir();
    const leftovers = existsSync(updatesDir) ? readdirSync(updatesDir) : [];
    assert.deepEqual(leftovers, []);
  } finally {
    await closeMockServer(mockRef.server);
  }
});

test("AppUpdater schedules silent background auto-check (15s initial + 4h interval) and stops when disabled", async () => {
  let checkHits = 0;
  let mockRef!: { server: http.Server; baseUrl: string };
  mockRef = await startMockServer((req, res) => {
    if ((req.url ?? "").startsWith("/github/repos/")) {
      checkHits += 1;
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([{ tag_name: "v0.1.0", prerelease: false, draft: false, assets: [] }]));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  try {
    const timeouts: Array<{ delay: number; fn: () => void; cleared: boolean }> = [];
    const intervals: Array<{ delay: number; fn: () => void; cleared: boolean }> = [];

    const fakeTimers: AppUpdaterTimerApi = {
      setTimeout: ((fn: () => void, delay?: number) => {
        const entry = { delay: delay ?? 0, fn, cleared: false };
        timeouts.push(entry);
        return entry as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeout: ((handle: unknown) => {
        const entry = handle as { cleared?: boolean } | undefined;
        if (entry) entry.cleared = true;
      }) as typeof clearTimeout,
      setInterval: ((fn: () => void, delay?: number) => {
        const entry = { delay: delay ?? 0, fn, cleared: false };
        intervals.push(entry);
        return entry as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval,
      clearInterval: ((handle: unknown) => {
        const entry = handle as { cleared?: boolean } | undefined;
        if (entry) entry.cleared = true;
      }) as typeof clearInterval
    };

    const dataDir = makeTempDir("prismux-autocheck-");
    const updater = new AppUpdater({
      currentVersion: "0.1.0",
      dataDir,
      githubApiBase: `${mockRef.baseUrl}/github`,
      giteeApiBase: `${mockRef.baseUrl}/gitee-offline`,
      initialPolicy: { routePreference: "global", autoCheckEnabled: true },
      timers: fakeTimers
    });

    updater.startAutoCheck();
    assert.equal(timeouts.length, 1);
    assert.equal(timeouts[0]!.delay, DEFAULT_AUTO_CHECK_INITIAL_DELAY_MS);
    assert.equal(DEFAULT_AUTO_CHECK_INITIAL_DELAY_MS, 15_000);

    // Fire 15s initial check
    timeouts[0]!.fn();
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(checkHits, 1);
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0]!.delay, DEFAULT_AUTO_CHECK_INTERVAL_MS);
    assert.equal(DEFAULT_AUTO_CHECK_INTERVAL_MS, 4 * 60 * 60 * 1000);

    // Fire 4h periodic check
    intervals[0]!.fn();
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(checkHits, 2);

    // Disabling autoCheckEnabled via policy clears active timers immediately.
    updater.setPolicy({ autoCheckEnabled: false });
    assert.equal(intervals[0]!.cleared, true);
    assert.equal(updater.getStatus().autoCheckEnabled, false);
    assert.equal(updater.getStatus().nextAutoCheckAt, null);
  } finally {
    await closeMockServer(mockRef.server);
  }
});

// ---------------------------------------------------------------------------
// 2. PortScannerService anti-self-kill & anti-system-kill guard + workspace attribution
// ---------------------------------------------------------------------------

test("PortScannerService parses netstat, attributes workspace/external ports, and blocks killing self/parent/T3/system PIDs with HTTP 403", async () => {
  const sampleNetstat = [
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       812",
    "  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       22334",
    "  TCP    [::1]:3000             [::]:0                 LISTENING       33445",
    `  TCP    127.0.0.1:41900        0.0.0.0:0              LISTENING       ${process.pid}`,
    "  TCP    127.0.0.1:9999         0.0.0.0:0              ESTABLISHED     44556"
  ].join("\r\n");

  const parsed = parseWindowsNetstatOutput(sampleNetstat);
  assert.equal(parsed.length, 4);

  const killedPids: number[] = [];
  const fakeT3Pid = 55111;
  const workspaceRoot = join(tmpdir(), "prismux-demo-ws");

  const scanner = new PortScannerService({
    getProtectedPids: () => [fakeT3Pid],
    scanListeningSockets: async () => [
      { pid: 4, address: "0.0.0.0", port: 445, protocol: "tcp" },
      { pid: 812, address: "0.0.0.0", port: 135, protocol: "tcp" },
      { pid: process.pid, address: "127.0.0.1", port: 41900, protocol: "tcp" },
      { pid: fakeT3Pid, address: "127.0.0.1", port: 3773, protocol: "tcp" },
      { pid: 22334, address: "127.0.0.1", port: 5173, protocol: "tcp" },
      { pid: 33445, address: "127.0.0.1", port: 8080, protocol: "tcp" }
    ],
    inspectProcesses: async (pids) => {
      const map = new Map();
      for (const pid of pids) {
        if (pid === 4) map.set(pid, { pid, processName: "System" });
        else if (pid === 812) map.set(pid, { pid, processName: "svchost.exe" });
        else if (pid === 900) map.set(pid, { pid, processName: "lsass.exe" });
        else if (pid === 901) map.set(pid, { pid, processName: "csrss.exe" });
        else if (pid === 902) map.set(pid, { pid, processName: "wininit.exe" });
        else if (pid === 903) map.set(pid, { pid, processName: "services.exe" });
        else if (pid === 904) map.set(pid, { pid, processName: "Prismux.exe" });
        else if (pid === process.pid) map.set(pid, { pid, processName: "node.exe" });
        else if (pid === fakeT3Pid) map.set(pid, { pid, processName: "node.exe" });
        else if (pid === 22334) {
          map.set(pid, {
            pid,
            processName: "node.exe",
            cwd: join(workspaceRoot, "web"),
            commandLine: `node vite --root "${workspaceRoot}"`
          });
        } else if (pid === 33445) {
          map.set(pid, {
            pid,
            processName: "python.exe",
            cwd: join(tmpdir(), "other-project")
          });
        }
      }
      return map;
    },
    killProcessFn: async (pid) => {
      killedPids.push(pid);
    }
  });

  const scanRes = await scanner.scanPorts(workspaceRoot);
  assert.equal(scanRes.ok, true);
  assert.equal(scanRes.workspaceCount, 1);
  const wsPort = scanRes.ports.find((p) => p.pid === 22334);
  assert.ok(wsPort !== undefined);
  assert.equal(wsPort.scope, "workspace");
  assert.equal(wsPort.protected, false);
  assert.equal(wsPort.url, "http://127.0.0.1:5173");

  const extPort = scanRes.ports.find((p) => p.pid === 33445);
  assert.equal(extPort?.scope, "external");

  // Guard MUST block all protected PIDs with 403 and NEVER call killProcessFn.
  const forbiddenTargets = [
    0,
    4,
    process.pid,
    ...(process.ppid > 0 ? [process.ppid] : []),
    fakeT3Pid,
    812, // svchost.exe
    900, // lsass.exe
    901, // csrss.exe
    902, // wininit.exe
    903, // services.exe
    904 // Prismux.exe
  ];

  for (const forbiddenPid of forbiddenTargets) {
    await assert.rejects(
      () => scanner.killPid(forbiddenPid),
      (err: unknown) =>
        err instanceof PortKillError &&
        err.statusCode === 403 &&
        err.code === "PROTECTED_PROCESS" &&
        err.message.includes("禁止终止")
    );
  }
  assert.deepEqual(killedPids, []);

  // Allowed dev server PID succeeds.
  const okRes = await scanner.killPid(22334);
  assert.equal(okRes.ok, true);
  assert.equal(okRes.killed, true);
  assert.deepEqual(killedPids, [22334]);
});

// ---------------------------------------------------------------------------
// 3. ServiceDiagnosticsService < 3s timeout guard, 30s cache, force=1, sqlite-vec status
// ---------------------------------------------------------------------------

test("ServiceDiagnosticsService enforces < 3s timeout protection under hanging probes, caches 30s, supports force=1, and reports sqlite-vec mode", async () => {
  const tempRoot = makeTempDir("prismux-diag-");
  const dbPath = join(tempRoot, "data", "memory.db");
  const storeFtsOnly = new SqliteMemoryStore({
    dbPath,
    machineId: "win-1",
    embeddingDimensions: 4,
    enableWal: true,
    loadVectorExtension: false
  });
  await storeFtsOnly.initialize();

  let probeCalls = 0;
  try {
    const svc = new ServiceDiagnosticsService({
      dataDir: tempRoot,
      version: "0.1.1-alpha.1",
      headless: true,
      startedAt: Date.now() - 5000,
      memoryStore: storeFtsOnly,
      memoryDbPath: dbPath,
      singleCheckTimeoutMs: 250,
      globalBudgetMs: 900,
      resolve7za: () => null,
      detectAndroidSdk: () => ({ sdkRoot: null, adbPath: null }),
      // Deliberately hang 10 seconds to prove timeout protection finishes well under 3s!
      cliProbe: async () => {
        probeCalls += 1;
        await new Promise((r) => setTimeout(r, 10_000));
        return { found: false, latencyMs: 10_000 };
      },
      networkProbe: async () => {
        probeCalls += 1;
        await new Promise((r) => setTimeout(r, 10_000));
        return { reachable: false, statusCode: null, latencyMs: 10_000 };
      }
    });

    const t0 = performance.now();
    const first = await svc.runDiagnostics(false);
    const elapsedMs = performance.now() - t0;

    assert.equal(first.ok, true);
    assert.equal(first.cached, false);
    assert.ok(
      elapsedMs < 3_000,
      `Diagnostics exceeded 3s budget: ${Math.round(elapsedMs)}ms`
    );
    assert.equal(first.groups.length, 6);
    assert.ok(first.items.length >= 18);

    const vecCheck = first.items.find((i) => i.id === "memory.sqlite_vec");
    assert.ok(vecCheck !== undefined);
    assert.equal(vecCheck.status, "degraded");
    assert.equal(vecCheck.summary, "FTS5 降级态（缺 vec0.dll，无兼容风险）");

    // 30s cache hit
    const callsAfterFirst = probeCalls;
    const cachedRes = await svc.runDiagnostics(false);
    assert.equal(cachedRes.cached, true);
    assert.equal(probeCalls, callsAfterFirst);

    // force=1 bypasses cache
    const forcedRes = await svc.runDiagnostics(true);
    assert.equal(forcedRes.cached, false);
    assert.ok(probeCalls > callsAfterFirst);
  } finally {
    await storeFtsOnly.close();
  }
});

// ---------------------------------------------------------------------------
// 4. End-to-end Daemon HTTP routes: /v1/updater/events (SSE), /v1/diagnostics/services,
//    /v1/system/ports, /v1/system/ports/kill (403), /v1/system/resources, /v1/system/pty/kill,
//    /v1/memory/stats (retrievalMode & sqliteVecLoaded), /v1/sync/test & /v1/sync/now
// ---------------------------------------------------------------------------

test("PrismuxDaemon exposes v0.1.1-alpha.1 HTTP APIs: SSE updater events, diagnostics, ports 403 guard, resources, pty cleanup, memory retrievalMode, and SyncVault now/test", async () => {
  // Mock WebDAV server for real SyncVault /v1/sync/test and /v1/sync/now testing.
  const webdavState: { blob: Buffer | null; etag: string } = {
    blob: null,
    etag: "etag-initial-1"
  };
  const expectedWebdavPass = "SuperSecretWebDavPass999";
  const expectedAuthHeader = `Basic ${Buffer.from(`prismux:${expectedWebdavPass}`).toString("base64")}`;

  const webdavServer = await startMockServer((req, res) => {
    const auth = req.headers.authorization;
    if (auth !== expectedAuthHeader) {
      // Deliberately echo secret in 401 body to verify DaemonBusinessService scrubs secrets!
      res.writeHead(401, { "content-type": "text/plain" });
      res.end(`Unauthorized for password ${expectedWebdavPass}`);
      return;
    }

    if (req.method === "HEAD") {
      if (webdavState.blob === null) {
        res.writeHead(404);
        res.end();
      } else {
        res.writeHead(200, {
          etag: `"${webdavState.etag}"`,
          "content-length": String(webdavState.blob.length)
        });
        res.end();
      }
      return;
    }

    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        webdavState.blob = Buffer.concat(chunks);
        webdavState.etag = `etag-v-${webdavState.blob.length}`;
        res.writeHead(201, { etag: `"${webdavState.etag}"` });
        res.end();
      });
      return;
    }

    if (req.method === "GET") {
      if (webdavState.blob === null) {
        res.writeHead(404);
        res.end();
      } else {
        res.writeHead(200, { etag: `"${webdavState.etag}"` });
        res.end(webdavState.blob);
      }
      return;
    }

    res.writeHead(405);
    res.end();
  });

  const dataDir = makeTempDir("prismux-v011-daemon-");
  const authToken = "test-v011-owner-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    dataDir,
    host: "127.0.0.1",
    port: 0,
    authToken,
    disableAutoUpdateCheck: true
  });

  try {
    const ready = await daemon.start();
    const headers = {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json"
    };

    // 1. /v1/memory/stats exposes retrievalMode & sqliteVecLoaded
    await daemon.memoryStore.upsert({
      namespace: "private/chief",
      kind: "fact",
      title: "Sync Check Entry",
      content: "End-to-end sync verification record.",
      machineId: "local"
    });
    const memStatsRes = await fetch(`${ready.httpUrl}/v1/memory/stats`, {
      headers
    });
    assert.equal(memStatsRes.status, 200);
    const memStats = (await memStatsRes.json()) as {
      ok: boolean;
      sqliteVecLoaded: boolean;
      retrievalMode: string;
    };
    assert.equal(memStats.ok, true);
    assert.equal(typeof memStats.sqliteVecLoaded, "boolean");
    assert.equal(
      memStats.retrievalMode,
      memStats.sqliteVecLoaded ? "fts5+sqlite-vec" : "fts5-only"
    );

    // 2. /v1/updater/status & /v1/updater/events (SSE)
    const upStatusRes = await fetch(`${ready.httpUrl}/v1/updater/status`, {
      headers
    });
    assert.equal(upStatusRes.status, 200);
    const upStatus = (await upStatusRes.json()) as UpdaterStatusSnapshot;
    assert.equal(upStatus.portableMode, false);
    assert.equal(upStatus.downloadedFilePath, null);
    assert.equal(upStatus.downloadedSha256, null);

    const sseController = new AbortController();
    const sseRes = await fetch(
      `${ready.httpUrl}/v1/updater/events?token=${encodeURIComponent(authToken)}`,
      { signal: sseController.signal }
    );
    assert.equal(sseRes.status, 200);
    assert.ok(
      sseRes.headers.get("content-type")?.includes("text/event-stream")
    );
    const reader = sseRes.body!.getReader();
    const firstChunk = await reader.read();
    const sseText = new TextDecoder().decode(firstChunk.value);
    assert.ok(sseText.includes("event: status"));
    assert.ok(sseText.includes("portableMode"));
    sseController.abort();
    await reader.cancel().catch(() => undefined);

    // 3. /v1/system/ports/kill blocks Daemon self PID with HTTP 403
    const selfKillRes = await fetch(`${ready.httpUrl}/v1/system/ports/kill`, {
      method: "POST",
      headers,
      body: JSON.stringify({ pid: process.pid })
    });
    assert.equal(selfKillRes.status, 403);
    const selfKillJson = (await selfKillRes.json()) as {
      ok: boolean;
      killed: boolean;
      message: string;
    };
    assert.equal(selfKillJson.ok, false);
    assert.equal(selfKillJson.killed, false);
    assert.ok(selfKillJson.message.includes("禁止终止"));

    const sysKillRes = await fetch(`${ready.httpUrl}/v1/system/ports/kill`, {
      method: "POST",
      headers,
      body: JSON.stringify({ pid: 4 })
    });
    assert.equal(sysKillRes.status, 403);

    // 4. /v1/system/resources & /v1/system/pty/kill
    const fakeWs = join(dataDir, "ws-res");
    mkdirSync(fakeWs, { recursive: true });
    daemon.ptyPool.registerSession({
      ptyId: "stale-pty-1",
      cwd: fakeWs
    });
    await daemon.ptyPool.kill("stale-pty-1");

    const resResp = await fetch(`${ready.httpUrl}/v1/system/resources`, {
      headers
    });
    assert.equal(resResp.status, 200);
    const resources = (await resResp.json()) as SystemResourcesResponse;
    assert.equal(resources.ok, true);
    assert.equal(resources.daemon.pid, process.pid);
    assert.ok(resources.ptys.some((p) => p.sessionId === "stale-pty-1" && p.stale));

    const killPtyRes = await fetch(`${ready.httpUrl}/v1/system/pty/kill`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: "stale-pty-1" })
    });
    assert.equal(killPtyRes.status, 200);
    const killPtyJson = (await killPtyRes.json()) as {
      ok: boolean;
      removed: boolean;
    };
    assert.equal(killPtyJson.ok, true);
    assert.equal(killPtyJson.removed, true);
    assert.equal(daemon.ptyPool.getSession("stale-pty-1"), undefined);

    const missingPtyRes = await fetch(`${ready.httpUrl}/v1/system/pty/kill`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: "nonexistent-pty" })
    });
    assert.equal(missingPtyRes.status, 404);

    // 5. /v1/sync/config + /v1/sync/test + /v1/sync/now
    const cfgRes = await fetch(`${ready.httpUrl}/v1/sync/config`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        passphrase: "MyDistinctVaultPassphrase!2026",
        channels: {
          webdav: {
            enabled: true,
            endpointUrl: `${webdavServer.baseUrl}/dav`,
            username: "prismux",
            password: expectedWebdavPass,
            remotePath: "prismux.prismux-backup"
          }
        }
      })
    });
    assert.equal(cfgRes.status, 200);

    const testSyncRes = await fetch(`${ready.httpUrl}/v1/sync/test`, {
      method: "POST",
      headers,
      body: JSON.stringify({})
    });
    assert.equal(testSyncRes.status, 200);
    const testSyncJson = (await testSyncRes.json()) as SyncTestResponse;
    assert.equal(testSyncJson.ok, true);
    assert.equal(testSyncJson.results.length, 1);
    assert.equal(testSyncJson.results[0]!.reachable, true);
    assert.ok(!JSON.stringify(testSyncJson).includes(expectedWebdavPass));

    const syncNowRes = await fetch(`${ready.httpUrl}/v1/sync/now`, {
      method: "POST",
      headers,
      body: JSON.stringify({})
    });
    assert.equal(syncNowRes.status, 200);
    const syncNowJson = (await syncNowRes.json()) as SyncNowResponse;
    assert.equal(syncNowJson.ok, true);
    assert.ok(syncNowJson.syncedAt > 0);
    assert.ok(syncNowJson.etag !== null);
    assert.ok(webdavState.blob !== null && webdavState.blob.length > 32);
    assert.ok(!JSON.stringify(syncNowJson).includes(expectedWebdavPass));

    // Verify secret scrubbing when remote returns 401 containing secret
    await fetch(`${ready.httpUrl}/v1/sync/config`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        channels: {
          webdav: {
            enabled: true,
            endpointUrl: `${webdavServer.baseUrl}/dav`,
            username: "wrong-user",
            password: expectedWebdavPass
          }
        }
      })
    });
    const failedTestRes = await fetch(`${ready.httpUrl}/v1/sync/test`, {
      method: "POST",
      headers,
      body: JSON.stringify({})
    });
    assert.equal(failedTestRes.status, 200);
    const failedText = await failedTestRes.text();
    assert.ok(
      !failedText.includes(expectedWebdavPass),
      "Sync test response must NEVER leak plaintext password!"
    );

    // 6. /v1/diagnostics/services responds cleanly in < 3s with 6 groups & >= 18 checks
    const diagStart = performance.now();
    const diagRes = await fetch(`${ready.httpUrl}/v1/diagnostics/services`, {
      headers
    });
    const diagElapsed = performance.now() - diagStart;
    assert.equal(diagRes.status, 200);
    const diagJson = (await diagRes.json()) as ServiceDiagnosticsResponse;
    assert.equal(diagJson.ok, true);
    assert.equal(diagJson.groups.length, 6);
    assert.ok(diagJson.items.length >= 18);
    assert.ok(
      diagElapsed < 3_500,
      `Live /v1/diagnostics/services took ${Math.round(diagElapsed)}ms`
    );

    // 7. /v1/system/ports responds cleanly with Daemon's own bound port protected
    const portsRes = await fetch(`${ready.httpUrl}/v1/system/ports`, {
      headers
    });
    assert.equal(portsRes.status, 200);
    const portsJson = (await portsRes.json()) as SystemPortsResponse;
    assert.equal(portsJson.ok, true);
    assert.ok(Array.isArray(portsJson.ports));
    const daemonPortEntry = portsJson.ports.find(
      (p) => p.pid === process.pid && p.port === ready.port
    );
    if (daemonPortEntry) {
      assert.equal(daemonPortEntry.protected, true);
    }
  } finally {
    await daemon.stop();
    await closeMockServer(webdavServer.server);
  }
});

test("ResourceMonitorService groups alive & stale PTY sessions by workspace cleanly", async () => {
  const pool = new PersistentPtyPool();
  const wsA = makeTempDir("prismux-res-wsa-");
  const wsB = makeTempDir("prismux-res-wsb-");
  pool.registerSession({ ptyId: "pty-a-1", cwd: wsA });
  pool.registerSession({ ptyId: "pty-b-1", cwd: wsB });
  await pool.kill("pty-b-1");

  const monitor = new ResourceMonitorService({
    ptyPool: pool,
    sampleProcesses: async () => new Map()
  });

  const snap = await monitor.getResources();
  assert.equal(snap.ok, true);
  assert.equal(snap.ptys.length, 2);
  assert.equal(snap.workspaces.length, 2);
  assert.equal(snap.orphanCount, 1);
  assert.equal(snap.history.length, 1);
  assert.ok(
    snap.processMemoryMetric === "working-set" ||
      snap.processMemoryMetric === "rss" ||
      snap.processMemoryMetric === "footprint"
  );
  const bEntry = snap.ptys.find((p) => p.sessionId === "pty-b-1");
  assert.equal(bEntry?.alive, false);
  assert.equal(bEntry?.stale, true);

  const killed = await monitor.killPtySession("pty-b-1");
  assert.equal(killed.statusCode, 200);
  assert.equal(killed.payload.removed, true);
  assert.equal(pool.listSessions().length, 1);

  await pool.dispose();
});

test("PortScannerService aligns with Orca: bindHost/connectHost, HTTPS inference, attributionConfidence, container ranking, and timeout backoff", async () => {
  const wsRoot = makeTempDir("prismux-orca-port-ws-");
  let shouldTimeout = false;

  const scanner = new PortScannerService({
    scanListeningSockets: async () => {
      if (shouldTimeout) {
        const err = new Error("netstat timed out") as NodeJS.ErrnoException;
        err.code = "ETIMEDOUT";
        throw err;
      }
      return [
        { pid: 41001, address: "0.0.0.0", port: 8443, protocol: "tcp" },
        { pid: 41002, address: "127.0.0.1", port: 5173, protocol: "tcp" },
        { pid: 41003, address: "0.0.0.0", port: 5432, protocol: "tcp" },
        { pid: 41004, address: "127.0.0.1", port: 9090, protocol: "tcp" }
      ];
    },
    inspectProcesses: async (pids) => {
      const map = new Map();
      for (const pid of pids) {
        if (pid === 41001) {
          map.set(pid, {
            pid,
            processName: "node.exe",
            commandLine: `node tls-dev --cwd "${wsRoot}"`
          });
        } else if (pid === 41002) {
          map.set(pid, {
            pid,
            processName: "node.exe",
            cwd: wsRoot
          });
        } else if (pid === 41003) {
          map.set(pid, {
            pid,
            processName: "com.docker.backend.exe",
            commandLine: "docker-proxy -proto tcp -host-port 5432"
          });
        } else if (pid === 41004) {
          map.set(pid, {
            pid,
            processName: "external-srv.exe"
          });
        }
      }
      return map;
    }
  });

  const scan = await scanner.scanPorts(wsRoot);
  assert.equal(scan.ok, true);
  assert.equal(scan.ports.length, 4);
  assert.equal(scan.workspaceCount, 2);

  // Priority order: workspace (5173, 8443) -> container (5432) -> external (9090)
  assert.deepEqual(
    scan.ports.map((p) => p.port),
    [5173, 8443, 5432, 9090]
  );

  const vitePort = scan.ports[0]!;
  assert.equal(vitePort.attributionConfidence, "cwd");
  assert.equal(vitePort.serviceProtocol, "http");
  assert.equal(vitePort.connectHost, "127.0.0.1");
  assert.equal(vitePort.id, "127.0.0.1:5173:41002");

  const httpsPort = scan.ports[1]!;
  assert.equal(httpsPort.attributionConfidence, "command");
  assert.equal(httpsPort.serviceProtocol, "https");
  assert.equal(httpsPort.bindHost, "0.0.0.0");
  assert.equal(httpsPort.connectHost, "127.0.0.1");
  assert.equal(httpsPort.url, "https://127.0.0.1:8443");

  const containerPort = scan.ports[2]!;
  assert.equal(containerPort.isContainer, true);
  assert.equal(containerPort.scope, "external");

  // Command timeout enters backoff cooldown and returns unavailableReason without crashing.
  shouldTimeout = true;
  const timedOut = await scanner.scanPorts(wsRoot);
  assert.equal(timedOut.ok, true);
  assert.equal(timedOut.ports.length, 0);
  assert.ok(timedOut.unavailableReason?.includes("退避冷却"));

  const coolingDown = await scanner.scanPorts(wsRoot);
  assert.equal(coolingDown.ports.length, 0);
  assert.ok(coolingDown.unavailableReason?.includes("退避冷却"));
});

test("ResourceMonitorService aligns with Orca: computes Windows CPU% deltas, tracks privateMemoryBytes & sparkline history", async () => {
  const pool = new PersistentPtyPool();
  const ws = makeTempDir("prismux-res-orca-");
  const session = pool.spawnSession({
    ptyId: "live-pty-cpu",
    cwd: ws,
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"]
  });
  const runtimeInfo = pool
    .listSessionRuntimeInfos()
    .find((item) => item.ptyId === session.ptyId);
  assert.ok(runtimeInfo?.pid && runtimeInfo.pid > 0);
  const childPid = runtimeInfo.pid;

  let callIndex = 0;
  const monitor = new ResourceMonitorService({
    ptyPool: pool,
    sampleProcesses: async (pids) => {
      callIndex += 1;
      const map = new Map();
      for (const pid of pids) {
        if (pid === childPid) {
          map.set(pid, {
            pid,
            cpuPercent: null,
            cpuSeconds: callIndex === 1 ? 1.0 : 1.25,
            memoryBytes: callIndex === 1 ? 30 * 1024 * 1024 : 34 * 1024 * 1024,
            privateMemoryBytes: 22 * 1024 * 1024
          });
        }
      }
      return map;
    }
  });

  try {
    const s1 = await monitor.getResources();
    assert.equal(s1.history.length, 1);
    assert.equal(s1.workspaces[0]?.history.length, 1);
    assert.equal(s1.workspaces[0]?.privateMemoryBytes, 22 * 1024 * 1024);
    assert.equal(s1.ptys[0]?.hasLocalSamples, true);

    await new Promise((r) => setTimeout(r, 80));
    const s2 = await monitor.getResources();
    assert.equal(s2.history.length, 2);
    assert.equal(s2.workspaces[0]?.history.length, 2);
    assert.ok(
      s2.ptys[0]?.cpuPercent !== null && s2.ptys[0]!.cpuPercent > 0,
      `Expected positive derived CPU%, got ${String(s2.ptys[0]?.cpuPercent)}`
    );
  } finally {
    await pool.dispose();
  }
});

test("AppUpdater prefers Prismux-<ver>-SHA256SUMS.txt over prismux-plugins-*-SHA256SUMS.txt for both single-exe and Gitee split-7z-exe without per-asset .sha256", async () => {
  const sevenZip = resolve7zaBinary();
  assert.ok(sevenZip !== null, "Expected 7za/7z binary on Windows test host");

  // Direct selector priority & negative-match verification
  assert.equal(
    selectSoftwareChecksumAsset(
      [
        { name: "prismux-plugins-0.1.1-alpha.1-SHA256SUMS.txt" },
        { name: "prismux-plugin-0.1.1-alpha.1-SHA256SUMS.txt" },
        { name: "Prismux-0.1.1-alpha.1-SHA256SUMS.txt" },
        { name: "SHA256SUMS.txt" }
      ],
      "0.1.1-alpha.1"
    )?.name,
    "Prismux-0.1.1-alpha.1-SHA256SUMS.txt"
  );
  assert.equal(
    selectSoftwareChecksumAsset(
      [
        { name: "prismux-plugins-0.1.1-alpha.1-SHA256SUMS.txt" },
        { name: "Prismux-SHA256SUMS.txt" }
      ],
      "0.1.1-alpha.1"
    )?.name,
    "Prismux-SHA256SUMS.txt"
  );
  assert.equal(
    selectSoftwareChecksumAsset(
      [{ name: "prismux-plugins-0.1.1-alpha.1-SHA256SUMS.txt" }],
      "0.1.1-alpha.1"
    ),
    undefined
  );

  // Plugin archive filename helper avoids duplicate prefix and preserves legacy fallback
  assert.deepEqual(
    getOfficialPluginArchiveCandidateFilenames("qq", "0.1.1-alpha.1"),
    ["prismux-plugin-qq-0.1.1-alpha.1.wb-plugin", "qq-0.1.1-alpha.1.wb-plugin"]
  );
  assert.deepEqual(
    getOfficialPluginArchiveCandidateFilenames("prismux-plugin-qq", "0.1.1-alpha.1"),
    ["prismux-plugin-qq-0.1.1-alpha.1.wb-plugin"]
  );

  const ver = "0.1.1-alpha.1";
  const exeName = `Prismux-Setup-${ver}-win-x64.exe`;
  const exePayload = randomBytes(68 * 1024);
  const exeSha = sha256Hex(exePayload);
  const fixture = await createRealSplit7zFixture(sevenZip, exeName, exePayload, "24k");

  const softwareSumsText = [
    `${exeSha}  ${exeName}`,
    ...fixture.parts.map((p) => `${sha256Hex(p.bytes)}  ${p.name}`)
  ].join("\n") + "\n";
  // Deliberately bogus plugin sums placed FIRST in release assets list!
  const pluginSumsText = `${"0".repeat(64)}  prismux-plugin-qq-${ver}.wb-plugin\n${"f".repeat(64)}  ${exeName}\n`;

  let mockRef!: { server: http.Server; baseUrl: string };
  mockRef = await startMockServer((req, res) => {
    const urlPath = req.url ?? "/";
    if (urlPath.startsWith("/github/repos/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify([
          {
            tag_name: `v${ver}`,
            name: `Prismux v${ver}（公测版）`,
            // GitHub --latest non-prerelease flag, while SemVer `-alpha.1` still marks prerelease channel
            prerelease: false,
            draft: false,
            assets: [
              {
                name: `prismux-plugins-${ver}-SHA256SUMS.txt`,
                browser_download_url: `${mockRef.baseUrl}/dl/plugin-sums.txt`
              },
              {
                name: `Prismux-${ver}-SHA256SUMS.txt`,
                browser_download_url: `${mockRef.baseUrl}/dl/software-sums.txt`
              },
              {
                name: exeName,
                browser_download_url: `${mockRef.baseUrl}/dl/${encodeURIComponent(exeName)}`,
                size: exePayload.length
              }
            ]
          }
        ])
      );
      return;
    }

    if (urlPath.startsWith("/gitee/repos/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify([
          {
            tag_name: `v${ver}`,
            name: `Prismux v${ver}（公测版）`,
            prerelease: false,
            draft: false,
            assets: [
              {
                name: `prismux-plugins-${ver}-SHA256SUMS.txt`,
                browser_download_url: `${mockRef.baseUrl}/dl/plugin-sums.txt`
              },
              {
                name: `Prismux-${ver}-SHA256SUMS.txt`,
                browser_download_url: `${mockRef.baseUrl}/dl/software-sums.txt`
              },
              ...fixture.parts.map((part) => ({
                name: part.name,
                browser_download_url: `${mockRef.baseUrl}/dl/${encodeURIComponent(part.name)}`,
                size: part.bytes.length
              }))
            ]
          }
        ])
      );
      return;
    }

    if (urlPath === "/dl/plugin-sums.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(pluginSumsText);
      return;
    }
    if (urlPath === "/dl/software-sums.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(softwareSumsText);
      return;
    }
    if (urlPath === `/dl/${encodeURIComponent(exeName)}`) {
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(exePayload.length)
      });
      res.end(exePayload);
      return;
    }
    const matchedPart = fixture.parts.find(
      (p) => urlPath === `/dl/${encodeURIComponent(p.name)}`
    );
    if (matchedPart) {
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(matchedPart.bytes.length)
      });
      res.end(matchedPart.bytes);
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  try {
    const ghUpdater = new AppUpdater({
      currentVersion: "0.1.0-alpha.2",
      dataDir: makeTempDir("prismux-sums-gh-"),
      sevenZipPath: sevenZip,
      githubApiBase: `${mockRef.baseUrl}/github`,
      giteeApiBase: `${mockRef.baseUrl}/gitee`,
      initialPolicy: { routePreference: "global", includePrerelease: true }
    });

    const ghCheck = await ghUpdater.checkForUpdates({ sourceOverride: "github" });
    assert.equal(ghCheck.hasUpdate, true);
    assert.equal(ghCheck.channel, "prerelease");
    assert.equal(ghCheck.recommendedAsset?.kind, "setup-exe");
    assert.equal(ghCheck.recommendedAsset?.sha256, exeSha);
    assert.ok(ghCheck.recommendedAsset?.sha256Url?.endsWith("/dl/software-sums.txt"));
    const ghDl = await ghUpdater.downloadUpdate({ checkResult: ghCheck });
    assert.equal(ghDl.verified, true);
    assert.equal(ghDl.sha256, exeSha);

    const giteeUpdater = new AppUpdater({
      currentVersion: "0.1.0-alpha.2",
      dataDir: makeTempDir("prismux-sums-gitee-"),
      sevenZipPath: sevenZip,
      githubApiBase: `${mockRef.baseUrl}/github`,
      giteeApiBase: `${mockRef.baseUrl}/gitee`,
      initialPolicy: { routePreference: "domestic", includePrerelease: true }
    });

    const giteeCheck = await giteeUpdater.checkForUpdates({ sourceOverride: "gitee" });
    assert.equal(giteeCheck.hasUpdate, true);
    assert.equal(giteeCheck.channel, "prerelease");
    assert.equal(giteeCheck.recommendedAsset?.kind, "split-7z-exe");
    assert.equal(giteeCheck.recommendedAsset?.expectedSha256, exeSha);
    assert.ok(giteeCheck.recommendedAsset?.sha256Url?.endsWith("/dl/software-sums.txt"));
    const giteeDl = await giteeUpdater.downloadUpdate({ checkResult: giteeCheck });
    assert.equal(giteeDl.verified, true);
    assert.equal(giteeDl.sha256, exeSha);
    assert.deepEqual(readFileSync(giteeDl.filePath), exePayload);
  } finally {
    await closeMockServer(mockRef.server);
  }
});

test("Daemon CORS preflight allows Cache-Control and Last-Event-ID on /v1/updater/events for desktop origins", async () => {
  const dataDir = makeTempDir("prismux-cors-sse-");
  const authToken = "cors-sse-test-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    dataDir,
    host: "127.0.0.1",
    port: 0,
    authToken
  });
  const ready = await daemon.start();

  try {
    const preflightRes = await fetch(
      `${ready.httpUrl}/v1/updater/events?token=${encodeURIComponent(authToken)}`,
      {
        method: "OPTIONS",
        headers: {
          Origin: "t3code://app",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "cache-control, last-event-id"
        }
      }
    );
    assert.equal(preflightRes.status, 204);
    assert.equal(
      preflightRes.headers.get("access-control-allow-origin"),
      "t3code://app"
    );
    const allowedHeaders = (
      preflightRes.headers.get("access-control-allow-headers") ?? ""
    ).toLowerCase();
    assert.ok(
      allowedHeaders.includes("cache-control"),
      `Expected Cache-Control in allow-headers, got: ${allowedHeaders}`
    );
    assert.ok(
      allowedHeaders.includes("last-event-id"),
      `Expected Last-Event-ID in allow-headers, got: ${allowedHeaders}`
    );
    assert.ok(allowedHeaders.includes("pragma"));
    assert.ok(allowedHeaders.includes("accept"));

    const controller = new AbortController();
    const sseRes = await fetch(
      `${ready.httpUrl}/v1/updater/events?token=${encodeURIComponent(authToken)}`,
      {
        headers: {
          Origin: "t3code://app",
          "Cache-Control": "no-cache"
        },
        signal: controller.signal
      }
    );
    assert.equal(sseRes.status, 200);
    assert.equal(
      sseRes.headers.get("access-control-allow-origin"),
      "t3code://app"
    );
    assert.ok(
      (sseRes.headers.get("content-type") ?? "").includes("text/event-stream")
    );
    controller.abort();
    await sseRes.body?.cancel().catch(() => undefined);
  } finally {
    await daemon.stop();
  }
});

test("PortScannerService collapses IPv4/IPv6 dual-stack duplicate listeners preferring IPv4 bindHost", async () => {
  const scanner = new PortScannerService({
    scanListeningSockets: async () => [
      // IPv6 listed first, IPv4 second -> must still prefer IPv4
      { pid: 46784, address: "[::]", port: 53, protocol: "tcp" },
      { pid: 46784, address: "0.0.0.0", port: 53, protocol: "tcp" },
      // IPv4 listed first, IPv6 second -> collapse to single IPv4 entry
      { pid: 2076, address: "0.0.0.0", port: 135, protocol: "tcp" },
      { pid: 2076, address: "[::]", port: 135, protocol: "tcp" },
      // System PID 4 dual-stack SMB
      { pid: 4, address: "0.0.0.0", port: 445, protocol: "tcp" },
      { pid: 4, address: "[::]", port: 445, protocol: "tcp" },
      // Loopback dual-stack dev server (IPv6 + IPv4-mapped IPv6 + IPv4)
      { pid: 55100, address: "[::1]", port: 5173, protocol: "tcp" },
      { pid: 55100, address: "::ffff:127.0.0.1", port: 5173, protocol: "tcp" },
      { pid: 55100, address: "127.0.0.1", port: 5173, protocol: "tcp" },
      // Distinct LAN interface IP on same port & PID must remain separate
      { pid: 46784, address: "192.168.1.50", port: 53, protocol: "tcp" },
      // Pure IPv6-only listener survives with connectHost 127.0.0.1
      { pid: 55200, address: "[::1]", port: 3001, protocol: "tcp" }
    ],
    inspectProcesses: async (pids) => {
      const map = new Map();
      for (const pid of pids) {
        map.set(pid, {
          pid,
          processName:
            pid === 46784
              ? "verge-mihomo.exe"
              : pid === 2076
                ? "svchost.exe"
                : pid === 4
                  ? "System"
                  : "node.exe"
        });
      }
      return map;
    }
  });

  const scan = await scanner.scanPorts();
  assert.equal(scan.ok, true);
  assert.equal(scan.ports.length, 6);

  const dnsLoopback = scan.ports.filter(
    (p) => p.pid === 46784 && p.port === 53 && p.connectHost === "127.0.0.1"
  );
  assert.equal(dnsLoopback.length, 1);
  assert.equal(dnsLoopback[0]!.bindHost, "0.0.0.0");

  const dnsLan = scan.ports.filter(
    (p) => p.pid === 46784 && p.port === 53 && p.connectHost === "192.168.1.50"
  );
  assert.equal(dnsLan.length, 1);

  const rpc135 = scan.ports.filter((p) => p.port === 135);
  assert.equal(rpc135.length, 1);
  assert.equal(rpc135[0]!.bindHost, "0.0.0.0");

  const smb445 = scan.ports.filter((p) => p.port === 445);
  assert.equal(smb445.length, 1);
  assert.equal(smb445[0]!.bindHost, "0.0.0.0");
  assert.equal(smb445[0]!.protected, true);

  const vite5173 = scan.ports.filter((p) => p.port === 5173);
  assert.equal(vite5173.length, 1);
  assert.equal(vite5173[0]!.bindHost, "127.0.0.1");
  assert.equal(vite5173[0]!.id, "127.0.0.1:5173:55100");

  const ipv6Only3001 = scan.ports.filter((p) => p.port === 3001);
  assert.equal(ipv6Only3001.length, 1);
  assert.equal(ipv6Only3001[0]!.connectHost, "127.0.0.1");
});

test("ServiceDiagnosticsService marks desktop-hosted T3 Server ok via HTTP liveness probe even when bare WS RPC is disconnected", async () => {
  assert.equal(
    normalizeT3HttpProbeUrl("ws://127.0.0.1:3773/ws?orchestrationProtocol=2"),
    "http://127.0.0.1:3773/"
  );
  assert.equal(
    normalizeT3HttpProbeUrl("http://127.0.0.1:3773/health"),
    "http://127.0.0.1:3773/health"
  );

  let receivedAuthHeader: string | undefined;
  let receivedMethod: string | undefined;
  let responseStatus = 200;
  const mockT3Http = await startMockServer((req, res) => {
    receivedMethod = req.method;
    receivedAuthHeader =
      typeof req.headers.authorization === "string"
        ? req.headers.authorization
        : undefined;
    res.statusCode = responseStatus;
    res.end("ok");
  });

  const secretToken = "super-secret-t3-probe-token";
  const fakeDisconnectedRpc = {
    getStatus: () => ({
      state: "reconnecting" as const,
      connected: false,
      wsUrl: `${mockT3Http.baseUrl.replace(/^http:/, "ws:")}/ws?orchestrationProtocol=2`,
      protocolVersion: "2",
      reconnectAttempts: 3,
      pendingRequestCount: 0,
      lastError: "WebSocket was closed before the connection was established"
    })
  };

  try {
    // 1. Live HTTP 200 derived from wsUrl / t3ServerUrl -> status: "ok"
    const diagFromWsUrl = new ServiceDiagnosticsService({
      dataDir: makeTempDir("prismux-diag-t3-ok-"),
      version: "0.1.1-alpha.1",
      headless: true,
      startedAt: Date.now(),
      t3RpcClient: fakeDisconnectedRpc as never,
      t3Token: secretToken,
      cliProbe: async () => ({ found: true, version: "1.0.0", latencyMs: 1 }),
      detectAndroidSdk: () => ({ sdkRoot: null, adbPath: null }),
      resolve7za: () => "7za.exe"
    });
    const reportOk = await diagFromWsUrl.runDiagnostics(true);
    const t3OkItem = reportOk.items.find((i) => i.id === "host.t3_server");
    assert.ok(t3OkItem);
    assert.equal(t3OkItem.status, "ok");
    assert.equal(receivedMethod, "GET");
    assert.equal(receivedAuthHeader, `Bearer ${secretToken}`);
    assert.ok(t3OkItem.summary.includes("桌面托管运行中"));
    assert.ok(!t3OkItem.summary.includes(secretToken));
    assert.ok(!(t3OkItem.detail ?? "").includes(secretToken));

    // 2. Auth-gated 401 via PRISMUX_T3_SERVER_URL env var still confirms HTTP server is alive
    responseStatus = 401;
    const prevEnv = process.env["PRISMUX_T3_SERVER_URL"];
    process.env["PRISMUX_T3_SERVER_URL"] = mockT3Http.baseUrl;
    try {
      const diagFromEnv = new ServiceDiagnosticsService({
        dataDir: makeTempDir("prismux-diag-t3-env-"),
        version: "0.1.1-alpha.1",
        headless: true,
        startedAt: Date.now(),
        cliProbe: async () => ({ found: true, version: "1.0.0", latencyMs: 1 }),
        detectAndroidSdk: () => ({ sdkRoot: null, adbPath: null }),
        resolve7za: () => "7za.exe"
      });
      const reportEnv = await diagFromEnv.runDiagnostics(true);
      const t3EnvItem = reportEnv.items.find((i) => i.id === "host.t3_server");
      assert.equal(t3EnvItem?.status, "ok");
      assert.ok(t3EnvItem?.summary.includes("HTTP 401"));
    } finally {
      if (prevEnv === undefined) {
        delete process.env["PRISMUX_T3_SERVER_URL"];
      } else {
        process.env["PRISMUX_T3_SERVER_URL"] = prevEnv;
      }
    }
  } finally {
    await closeMockServer(mockT3Http.server);
  }

  // 3. Closed / unreachable T3 HTTP server degrades cleanly
  const diagDown = new ServiceDiagnosticsService({
    dataDir: makeTempDir("prismux-diag-t3-down-"),
    version: "0.1.1-alpha.1",
    headless: true,
    startedAt: Date.now(),
    t3ServerUrl: mockT3Http.baseUrl,
    cliProbe: async () => ({ found: true, version: "1.0.0", latencyMs: 1 }),
    detectAndroidSdk: () => ({ sdkRoot: null, adbPath: null }),
    resolve7za: () => "7za.exe"
  });
  const reportDown = await diagDown.runDiagnostics(true);
  const t3DownItem = reportDown.items.find((i) => i.id === "host.t3_server");
  assert.equal(t3DownItem?.status, "degraded");
  assert.ok(t3DownItem?.summary.includes("未响应"));
});

test("GET /v1/plugins/logs gracefully returns HTTP 200 empty logs for uninstalled plugins and recent logs with limit for active plugins", async () => {
  const dataDir = makeTempDir("prismux-plugin-logs-");
  const authToken = "plugin-logs-test-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    dataDir,
    host: "127.0.0.1",
    port: 0,
    authToken
  });
  const ready = await daemon.start();
  const headers = { Authorization: `Bearer ${authToken}` };

  try {
    // 1. Uninstalled official plugin -> HTTP 200 (never 404!) with empty logs array
    const missingRes = await fetch(
      `${ready.httpUrl}/v1/plugins/logs?pluginId=qq&limit=20`,
      { headers }
    );
    assert.equal(missingRes.status, 200);
    const missingBody = (await missingRes.json()) as {
      ok: boolean;
      pluginId: string | null;
      logs: Array<Record<string, unknown>>;
    };
    assert.equal(missingBody.ok, true);
    assert.equal(missingBody.pluginId, "qq");
    assert.deepEqual(missingBody.logs, []);

    // 2. Omitted pluginId -> HTTP 200 with empty logs array
    const allEmptyRes = await fetch(`${ready.httpUrl}/v1/plugins/logs`, {
      headers
    });
    assert.equal(allEmptyRes.status, 200);
    const allEmptyBody = (await allEmptyRes.json()) as {
      ok: boolean;
      pluginId: string | null;
      logs: Array<Record<string, unknown>>;
    };
    assert.equal(allEmptyBody.ok, true);
    assert.equal(allEmptyBody.pluginId, null);
    assert.deepEqual(allEmptyBody.logs, []);

    // 3. Recorded plugin runtime logs are returned newest-first and honor `limit`
    daemon.businessService.recordPluginLog(
      "qq",
      "info",
      "daemon",
      "插件 qq 已加载"
    );
    daemon.businessService.recordPluginLog(
      "qq",
      "warn",
      "onebot",
      "OneBot 重连退避中"
    );

    const limitedRes = await fetch(
      `${ready.httpUrl}/v1/plugins/logs?pluginId=qq&limit=1`,
      { headers }
    );
    assert.equal(limitedRes.status, 200);
    const limitedBody = (await limitedRes.json()) as {
      ok: boolean;
      pluginId: string | null;
      logs: Array<{
        id: string;
        timestamp: number;
        level: string;
        source: string;
        message: string;
      }>;
    };
    assert.equal(limitedBody.ok, true);
    assert.equal(limitedBody.pluginId, "qq");
    assert.equal(limitedBody.logs.length, 1);
    assert.equal(limitedBody.logs[0]!.level, "warn");
    assert.equal(limitedBody.logs[0]!.source, "onebot");
    assert.equal(limitedBody.logs[0]!.message, "OneBot 重连退避中");
    assert.equal(typeof limitedBody.logs[0]!.id, "string");
    assert.equal(typeof limitedBody.logs[0]!.timestamp, "number");
  } finally {
    await daemon.stop();
  }
});

test("AppUpdater falls back to Gitee public Web Releases on OpenAPI v5 HTTP 403 rate limit for both probeSources and checkForUpdates", async () => {
  const exeSha = "a".repeat(64);
  const sampleHtml = `
    <html><body>
      <a href="/Fish-under-sea/Prismux/releases/tag/v0.1.1-preview.1">Prismux v0.1.1 Preview 1</a>
      <a href="/Fish-under-sea/Prismux/releases/download/v0.1.1-preview.1/Prismux-Setup-0.1.1-preview.1-win-x64.exe.7z.001">part1</a>
      <a href="/Fish-under-sea/Prismux/releases/download/v0.1.1-preview.1/Prismux-Setup-0.1.1-preview.1-win-x64.exe.7z.002">part2</a>
      <a href="/Fish-under-sea/Prismux/releases/download/v0.1.1-preview.1/Prismux-0.1.1-preview.1-SHA256SUMS.txt">sums</a>
      <a href="/Fish-under-sea/Prismux/releases/download/v0.1.1-preview.1/prismux-plugins-0.1.1-preview.1-SHA256SUMS.txt">plugin-sums</a>
      <a href="/Fish-under-sea/Prismux/releases/tag/v0.1.0-alpha.3">v0.1.0-alpha.3</a>
      <a href="/Fish-under-sea/Prismux/releases/tag/not-a-semver">ignore-me</a>
    </body></html>
  `;

  const parsed = parseGiteeWebReleasesHtml(
    sampleHtml,
    "https://gitee.com",
    "Fish-under-sea",
    "Prismux"
  );
  assert.equal(parsed.length, 2);
  const previewRec = parsed.find((r) => r.tag_name === "v0.1.1-preview.1");
  assert.ok(previewRec);
  assert.equal(previewRec.prerelease, true);
  assert.equal(previewRec.assets?.length, 4);

  let giteeApiHits = 0;
  let githubWebHeadHits = 0;
  let giteeWebHeadHits = 0;
  let giteeWebGetHits = 0;
  const mockServer = await startMockServer((req, res) => {
    const urlPath = req.url ?? "/";
    if (urlPath.startsWith("/github/repos/")) {
      res.statusCode = 403;
      res.setHeader("content-type", "application/json");
      res.end('{"message":"API rate limit exceeded"}');
      return;
    }
    if (
      urlPath === "/github-web/Fish-under-sea/Prismux/releases/latest" &&
      req.method === "HEAD"
    ) {
      githubWebHeadHits += 1;
      res.statusCode = 302;
      res.setHeader(
        "location",
        "/github-web/Fish-under-sea/Prismux/releases/tag/v0.1.1-preview.1"
      );
      res.end();
      return;
    }
    if (urlPath.startsWith("/gitee-api/repos/")) {
      giteeApiHits += 1;
      res.statusCode = 403;
      res.setHeader("content-type", "text/plain");
      res.end("403 Forbidden (Rate Limit Exceeded)");
      return;
    }
    if (
      urlPath === "/gitee-web/Fish-under-sea/Prismux/releases/latest" &&
      req.method === "HEAD"
    ) {
      giteeWebHeadHits += 1;
      res.statusCode = 302;
      res.setHeader(
        "location",
        "/gitee-web/Fish-under-sea/Prismux/releases/tag/v0.1.1-preview.1"
      );
      res.end();
      return;
    }
    if (urlPath === "/gitee-web/Fish-under-sea/Prismux/releases") {
      if (req.method === "HEAD") {
        giteeWebHeadHits += 1;
        res.statusCode = 200;
        res.end();
        return;
      }
      giteeWebGetHits += 1;
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(sampleHtml);
      return;
    }
    if (
      urlPath ===
      "/gitee-web/Fish-under-sea/Prismux/releases/download/v0.1.1-preview.1/Prismux-0.1.1-preview.1-SHA256SUMS.txt"
    ) {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain");
      res.end(`${exeSha}  Prismux-Setup-0.1.1-preview.1-win-x64.exe\n`);
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  try {
    const updater = new AppUpdater({
      currentVersion: "0.1.0-alpha.3",
      dataDir: makeTempDir("prismux-gitee-403-fallback-"),
      githubApiBase: `${mockServer.baseUrl}/github`,
      githubWebBase: `${mockServer.baseUrl}/github-web`,
      giteeApiBase: `${mockServer.baseUrl}/gitee-api`,
      giteeWebBase: `${mockServer.baseUrl}/gitee-web`,
      initialPolicy: { routePreference: "domestic", includePrerelease: true }
    });

    const probe = await updater.probeSources();
    const githubProbe = probe.sources.find((s) => s.source === "github");
    assert.ok(githubProbe);
    assert.equal(githubProbe.reachable, true);
    assert.equal(githubProbe.statusCode, 302);
    assert.equal(githubWebHeadHits, 1);

    const giteeProbe = probe.sources.find((s) => s.source === "gitee");
    assert.ok(giteeProbe);
    assert.equal(giteeProbe.reachable, true);
    assert.equal(giteeProbe.statusCode, 302);
    assert.ok(
      giteeProbe.url.endsWith("/gitee-web/Fish-under-sea/Prismux/releases/latest")
    );
    assert.equal(giteeWebHeadHits, 1);

    const check = await updater.checkForUpdates({ sourceOverride: "gitee" });
    assert.equal(check.sourceUsed, "gitee");
    assert.equal(check.hasUpdate, true);
    assert.equal(check.latestVersion, "0.1.1-preview.1");
    assert.equal(check.recommendedAsset?.kind, "split-7z-exe");
    assert.equal(check.recommendedAsset?.parts?.length, 2);
    assert.equal(check.recommendedAsset?.expectedSha256, exeSha);
    assert.ok(giteeApiHits >= 2);
    assert.equal(giteeWebGetHits, 1);
  } finally {
    await closeMockServer(mockServer.server);
  }
});

test("ResourceMonitorService fuses Electron host-metrics + OS process tree + T3 Server + Agent/Terminal descendants without double counting", async () => {
  const sampleTsv = [
    "1000\t1\tPrismux.exe\t150000000\t100000000\t10000000\t20000000\t\"C:\\Program Files\\Prismux\\Prismux.exe\"",
    "2000\t1000\tnode.exe\t120000000\t88000000\t5000000\t15000000\tnode vendor\\t3code\\apps\\server\\dist\\index.mjs --mode desktop",
    "2100\t2000\tpwsh.exe\t64000000\t42000000\t2000000\t4000000\tpwsh.exe -NoLogo",
    "2101\t2100\tnode.exe\t95000000\t71000000\t3000000\t9000000\tnode C:\\Users\\Fish\\AppData\\Roaming\\npm\\claude.js",
    `${process.pid}\t1000\tnode.exe\t82000000\t55000000\t1000000\t2000000\tnode apps\\daemon\\dist\\cli.js`,
    `99999\t${process.pid}\tpowershell.exe\t30000000\t20000000\t100000\t200000\tpowershell.exe -Command # PRISMUX_RES_PROBE Get-CimInstance Win32_Process`
  ].join("\r\n");

  const parsedTree = parseWindowsProcessTreeTsv(sampleTsv);
  assert.equal(parsedTree.size, 6);
  assert.equal(parsedTree.get(2000)?.cpuSeconds, 2.0);

  let tick = 0;
  const pool = new PersistentPtyPool();
  const monitor = new ResourceMonitorService({
    ptyPool: pool,
    mainPid: 1000,
    treeCacheTtlMs: 0,
    sampleProcessTree: async () => {
      tick += 1;
      const entries = new Map<number, OsProcessSnapshotEntry>();
      for (const [pid, row] of parsedTree) {
        const cpuBoost = tick === 1 ? 0 : pid === 2000 ? 0.4 : pid === 2101 ? 0.6 : 0.1;
        entries.set(pid, {
          ...row,
          cpuSeconds: (row.cpuSeconds ?? 0) + cpuBoost
        });
      }
      return entries;
    }
  });

  try {
    // 1. Before Electron pushes, OS process tree auto-discovers T3 Server + pwsh + Claude Code and excludes self probe
    const autoSnap = await monitor.getResources({ forceRefresh: true });
    assert.equal(autoSnap.t3Server?.pid, 2000);
    assert.equal(autoSnap.t3Server?.hostedBy, "electron");
    assert.equal(autoSnap.t3Server?.memoryBytes, 120_000_000);
    assert.ok(autoSnap.processes.some((p) => p.pid === 2101 && p.category === "agent" && p.name === "Claude Code"));
    assert.ok(autoSnap.processes.some((p) => p.pid === 2100 && p.category === "terminal" && p.name === "PowerShell 7"));
    assert.ok(!autoSnap.processes.some((p) => p.pid === 99999), "Self probe must be excluded");

    // 2. Push real Electron app.getAppMetrics() (Browser + Tab + GPU + Network) + T3 Server PID
    const ingest = monitor.ingestHostMetrics({
      collectedAt: Date.now(),
      mainPid: 1000,
      cpuCores: 8,
      cpuScale: "single-core",
      t3Server: {
        pid: 2000,
        ready: true,
        desiredRunning: true,
        state: "running",
        hostedBy: "electron",
        httpUrl: "http://127.0.0.1:3773"
      },
      electronProcesses: [
        { pid: 1000, type: "Browser", cpuPercent: 8.0, workingSetBytes: 155_000_000, privateMemoryBytes: 102_000_000 },
        { pid: 1001, type: "Tab", name: "Workbench", cpuPercent: 24.0, workingSetBytes: 240_000_000, privateMemoryBytes: 195_000_000 },
        { pid: 1002, type: "GPU", cpuPercent: 16.0, workingSetBytes: 130_000_000, privateMemoryBytes: 98_000_000 },
        { pid: 1003, type: "Utility", name: "Network Service", cpuPercent: 4.0, workingSetBytes: 45_000_000, privateMemoryBytes: 30_000_000 }
      ]
    });
    assert.equal(ingest.ok, true);
    assert.equal(ingest.acceptedProcesses, 4);
    assert.equal(ingest.t3ServerPid, 2000);

    // Push a second time to mark Electron CPU% as warmed past initial 0-call
    monitor.ingestHostMetrics({
      collectedAt: Date.now(),
      mainPid: 1000,
      cpuCores: 8,
      cpuScale: "single-core",
      t3Server: {
        pid: 2000,
        ready: true,
        desiredRunning: true,
        state: "running",
        hostedBy: "electron",
        httpUrl: "http://127.0.0.1:3773"
      },
      electronProcesses: [
        { pid: 1000, type: "Browser", cpuPercent: 8.0, workingSetBytes: 155_000_000, privateMemoryBytes: 102_000_000 },
        { pid: 1001, type: "Tab", name: "Workbench", cpuPercent: 24.0, workingSetBytes: 240_000_000, privateMemoryBytes: 195_000_000 },
        { pid: 1002, type: "GPU", cpuPercent: 16.0, workingSetBytes: 130_000_000, privateMemoryBytes: 98_000_000 },
        { pid: 1003, type: "Utility", name: "Network Service", cpuPercent: 4.0, workingSetBytes: 45_000_000, privateMemoryBytes: 30_000_000 }
      ]
    });

    await new Promise((r) => setTimeout(r, 80));
    const fused = await monitor.getResources({ forceRefresh: true });
    assert.equal(fused.hostMetricsSource, "hybrid");
    assert.equal(fused.desktop?.processCount, 4);
    assert.equal(fused.desktop?.memoryBytes, 155_000_000 + 240_000_000 + 130_000_000 + 45_000_000);
    // 8 + 24 + 16 + 4 = 52 single-core % / 8 cores = 6.5% total-system CPU%
    assert.equal(fused.desktop?.cpuPercent, 6.5);
    assert.equal(fused.t3Server?.pid, 2000);
    assert.ok(fused.t3Server?.cpuPercent !== null && fused.t3Server.cpuPercent > 0);
    assert.equal(fused.t3Server?.memoryBytes, 120_000_000);
    assert.equal(fused.activeAgentCount, 1);
    assert.ok(fused.activeTerminalCount >= 1);
    // Total memory sums all unique PIDs without double-counting Main/Daemon/T3
    const expectedTotalMem =
      155_000_000 + 240_000_000 + 130_000_000 + 45_000_000 + // Electron 4 procs
      120_000_000 + // T3 Server
      82_000_000 + // Daemon
      64_000_000 + // pwsh
      95_000_000; // Claude Code
    assert.equal(fused.totalMemoryBytes, expectedTotalMem);
    assert.ok(fused.totalCpuPercent !== null && fused.totalCpuPercent >= 6.5);
  } finally {
    monitor.stop();
    await pool.dispose();
  }
});

test("PrismuxDaemon exposes POST /v1/resources/host-metrics and live Windows process-tree sampling returns real non-zero metrics", async () => {
  const dataDir = makeTempDir("prismux-live-res-");
  const authToken = "live-res-owner-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    dataDir,
    host: "127.0.0.1",
    port: 0,
    authToken,
    disableAutoUpdateCheck: true
  });

  // Spawn a real lightweight child process performing brief CPU activity so live OS tree sampling observes real RAM & CPU
  const busyChild = spawn(
    process.execPath,
    [
      "-e",
      "const end = Date.now() + 8000; function spin(){ const t = Date.now() + 25; while(Date.now() < t){} if(Date.now() < end) setTimeout(spin, 15); } spin();"
    ],
    { stdio: "ignore", windowsHide: true }
  );

  try {
    const ready = await daemon.start();
    const headers = {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json"
    };

    // 1. Reject malformed payload with 400
    const badRes = await fetch(`${ready.httpUrl}/v1/resources/host-metrics`, {
      method: "POST",
      headers,
      body: JSON.stringify({})
    });
    assert.equal(badRes.status, 400);

    // 2. Accept valid Electron host metrics + real child PID reported as T3 Server
    assert.ok(typeof busyChild.pid === "number" && busyChild.pid > 0);
    const postRes = await fetch(`${ready.httpUrl}/v1/resources/host-metrics`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        collectedAt: Date.now(),
        mainPid: process.pid,
        cpuScale: "single-core",
        t3Server: {
          pid: busyChild.pid,
          ready: true,
          desiredRunning: true,
          state: "running",
          hostedBy: "electron",
          httpUrl: "http://127.0.0.1:3773"
        },
        electronProcesses: []
      })
    });
    assert.equal(postRes.status, 200);
    const postJson = (await postRes.json()) as { ok: boolean; t3ServerPid: number | null };
    assert.equal(postJson.ok, true);
    assert.equal(postJson.t3ServerPid, busyChild.pid);

    // 3. Real OS live sampling pass 1 (primes baseline) + pass 2 (computes real delta CPU%)
    const firstRes = await fetch(`${ready.httpUrl}/v1/system/resources?refresh=1`, { headers });
    assert.equal(firstRes.status, 200);
    const snap1 = (await firstRes.json()) as ExtendedSystemResourcesResponse;
    assert.equal(snap1.ok, true);
    assert.ok(snap1.daemon.memoryBytes > 10 * 1024 * 1024, `Expected real daemon RAM, got ${snap1.daemon.memoryBytes}`);
    assert.ok(snap1.t3Server !== null, "Expected t3Server to be populated");
    assert.equal(snap1.t3Server?.pid, busyChild.pid);
    assert.ok(
      typeof snap1.t3Server?.memoryBytes === "number" && snap1.t3Server.memoryBytes > 5 * 1024 * 1024,
      `Expected real T3 Server RAM > 5MB, got ${String(snap1.t3Server?.memoryBytes)}`
    );

    await new Promise((r) => setTimeout(r, 450));
    const secondRes = await fetch(`${ready.httpUrl}/v1/system/resources?refresh=1`, { headers });
    assert.equal(secondRes.status, 200);
    const snap2 = (await secondRes.json()) as ExtendedSystemResourcesResponse;
    assert.equal(snap2.ok, true);
    assert.ok(snap2.totalMemoryBytes > snap2.daemon.memoryBytes, "Total RAM must exceed daemon-only RAM");
    assert.ok(
      typeof snap2.t3Server?.cpuPercent === "number" && snap2.t3Server.cpuPercent > 0,
      `Expected live T3 Server CPU% > 0, got ${String(snap2.t3Server?.cpuPercent)}`
    );
    assert.ok(
      typeof snap2.totalCpuPercent === "number" && snap2.totalCpuPercent > 0,
      `Expected live total CPU% > 0, got ${String(snap2.totalCpuPercent)}`
    );
    assert.ok(snap2.processes.some((p) => p.pid === busyChild.pid && p.role === "t3-server"));
    assert.ok(snap2.processes.some((p) => p.pid === process.pid && p.role === "daemon"));
  } finally {
    try {
      busyChild.kill("SIGKILL");
    } catch {
      // already exited
    }
    await daemon.stop();
  }
});
