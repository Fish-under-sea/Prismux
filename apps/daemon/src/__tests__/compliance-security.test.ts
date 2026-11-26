import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
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
import { gzipSync } from "node:zlib";
import {
  DEFAULT_UPDATE_POLICY,
  type OfficialPluginCatalogEntry
} from "@prismux/protocol";
import { WebSocket } from "ws";
import { PrismuxDaemon } from "../index.js";
import { isAllowedCorsOrigin } from "../server/CorsOrigin.js";
import { downloadOfficialPluginReleaseArchive } from "../server/OfficialPluginDownloader.js";
import {
  AppUpdater,
  UpdateIntegrityError,
  openHttpWithRedirects,
  parseAndValidate7zSltListing,
  resolve7zaBinary,
  validateUpdaterHttpUrl,
  type AppUpdaterTimerApi
} from "../updater/AppUpdater.js";

const execFileAsync = promisify(execFile);

const tempDirs: string[] = [];
const cleanups: Array<() => Promise<void> | void> = [];

after(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) {
      try {
        await fn();
      } catch {
        // Best-effort cleanup
      }
    }
  }
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function findTestHostSevenZip(): string | null {
  const bundled = resolve7zaBinary();
  if (bundled !== null) {
    return bundled;
  }
  for (const candidate of [
    "C:\\Program Files\\7-Zip\\7za.exe",
    "C:\\Program Files\\7-Zip\\7z.exe",
    "C:\\Program Files (x86)\\7-Zip\\7za.exe",
    "C:\\Program Files (x86)\\7-Zip\\7z.exe"
  ]) {
    const resolved = resolve7zaBinary(candidate);
    if (resolved !== null) {
      return resolved;
    }
  }
  return null;
}

async function startMockHttpServer(
  handler: http.RequestListener
): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const addr = server.address() as AddressInfo;
  cleanups.push(
    () =>
      new Promise<void>((resolveClose) => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      })
  );
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

function buildDeterministicTgz(files: Record<string, string | Buffer>): Buffer {
  const blocks: Buffer[] = [];
  for (const [entryPath, rawContent] of Object.entries(files).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const content = Buffer.isBuffer(rawContent)
      ? rawContent
      : Buffer.from(rawContent, "utf8");
    const header = Buffer.alloc(512, 0);
    Buffer.from(entryPath, "utf8").copy(header, 0, 0, 100);
    Buffer.from("0000644\0", "ascii").copy(header, 100);
    Buffer.from("0000000\0", "ascii").copy(header, 108);
    Buffer.from("0000000\0", "ascii").copy(header, 116);
    Buffer.from(`${content.length.toString(8).padStart(11, "0")}\0`, "ascii").copy(
      header,
      124
    );
    Buffer.from("00000000000\0", "ascii").copy(header, 136);
    header.fill(0x20, 148, 156);
    header[156] = "0".charCodeAt(0);
    Buffer.from("ustar\0", "ascii").copy(header, 257);
    Buffer.from("00", "ascii").copy(header, 263);

    let sum = 0;
    for (let i = 0; i < 512; i += 1) {
      sum += header[i] ?? 0;
    }
    Buffer.from(`${sum.toString(8).padStart(6, "0")}\0 `, "ascii").copy(header, 148);
    blocks.push(header, content);
    const rem = content.length % 512;
    if (rem !== 0) {
      blocks.push(Buffer.alloc(512 - rem, 0));
    }
  }
  blocks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(blocks));
}

function connectWsWithOrigin(
  url: string,
  token: string,
  origin?: string
): Promise<WebSocket> {
  return new Promise<WebSocket>((resolveWs, rejectWs) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`
    };
    if (origin !== undefined) {
      headers["Origin"] = origin;
    }
    const ws = new WebSocket(url, { headers });
    ws.once("open", () => resolveWs(ws));
    ws.once("unexpected-response", (_req, res) => {
      res.resume();
      rejectWs(new Error(`WS_REJECTED_${res.statusCode ?? 0}`));
    });
    ws.once("error", (err) => rejectWs(err));
  });
}

async function closeWs(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolveClose) => {
    ws.once("close", () => resolveClose());
    if (ws.readyState === WebSocket.CONNECTING) {
      ws.terminate();
    } else {
      ws.close();
    }
  });
}

// ---------------------------------------------------------------------------
// P1-5: Default autoCheckEnabled === false -> strictly 0 cold-start requests
// ---------------------------------------------------------------------------

test("P1-5 DEFAULT_UPDATE_POLICY.autoCheckEnabled defaults to false and AppUpdater produces strictly 0 cold-start calls", async () => {
  assert.equal(DEFAULT_UPDATE_POLICY.autoCheckEnabled, false);

  let outboundHits = 0;
  const mockServer = await startMockHttpServer((_req, res) => {
    outboundHits += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end("[]");
  });

  const scheduledTimeouts: number[] = [];
  const scheduledIntervals: number[] = [];
  const fakeTimers: AppUpdaterTimerApi = {
    setTimeout: ((_fn: () => void, delay?: number) => {
      scheduledTimeouts.push(delay ?? 0);
      return {} as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeout: (() => undefined) as typeof clearTimeout,
    setInterval: ((_fn: () => void, delay?: number) => {
      scheduledIntervals.push(delay ?? 0);
      return {} as ReturnType<typeof setInterval>;
    }) as typeof setInterval,
    clearInterval: (() => undefined) as typeof clearInterval
  };

  const updater = new AppUpdater({
    currentVersion: "0.2.3-rc.2",
    dataDir: makeTempDir("prismux-p1-5-"),
    githubApiBase: mockServer.baseUrl,
    giteeApiBase: mockServer.baseUrl,
    timers: fakeTimers,
    allowInsecureLoopbackForTesting: true
  });

  assert.equal(updater.getPolicy().autoCheckEnabled, false);
  assert.equal(updater.getStatus().autoCheckEnabled, false);
  assert.equal(updater.getStatus().nextAutoCheckAt, null);

  updater.startAutoCheck();
  assert.equal(scheduledTimeouts.length, 0);
  assert.equal(scheduledIntervals.length, 0);
  assert.equal(updater.getStatus().nextAutoCheckAt, null);
  assert.equal(outboundHits, 0);

  // Explicit opt-in resumes auto-check cleanly
  updater.setPolicy({ autoCheckEnabled: true });
  assert.equal(updater.getStatus().autoCheckEnabled, true);
  assert.equal(scheduledTimeouts.length, 1);
  updater.dispose();
});

// ---------------------------------------------------------------------------
// P1-2: Strict CORS allowlist, WallpaperMediaService CORS, WS Origin & pairing limits
// ---------------------------------------------------------------------------

test("P1-2 isAllowedCorsOrigin strictly allows only prismux://, prismux-dev://, and exact loopback origins", () => {
  for (const allowed of [
    "prismux://app",
    "prismux-dev://app",
    "http://127.0.0.1:3777",
    "http://localhost:5173",
    "http://[::1]:5173"
  ]) {
    assert.equal(isAllowedCorsOrigin(allowed), true, `Expected allowed: ${allowed}`);
  }

  for (const rejected of [
    "null",
    "NULL",
    "*",
    "",
    "file://",
    "file:///C:/index.html",
    "app://prismux",
    "tauri://localhost",
    "https://evil.example.com",
    "http://127.0.0.1.evil.com:3777",
    "http://localhost.evil.com:5173",
    "http://127.0.0.1:0",
    "http://127.0.0.1:70000",
    "http://localhost:5173/extra",
    "prismux://app/extra"
  ]) {
    assert.equal(isAllowedCorsOrigin(rejected), false, `Expected rejected: ${rejected}`);
  }
});

test("P1-2 DaemonRpcServer rejects Origin: null, enforces WS Origin allowlist (403), invalidates pairing code after 5 failures, and rate-limits /v1/pair/exchange (429)", async () => {
  const dataDir = makeTempDir("prismux-p1-2-daemon-");
  const authToken = "p1-2-owner-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken
  });
  cleanups.push(() => daemon.stop());
  const ready = await daemon.start();

  // 1. HTTP CORS never echoes null or *
  for (const untrusted of ["null", "*", "file://", "https://attacker.example"]) {
    const res = await fetch(`${ready.httpUrl}/health`, {
      headers: { Origin: untrusted }
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  }
  for (const trusted of [
    "prismux://app",
    "prismux-dev://app",
    "http://127.0.0.1:5173",
    "http://localhost:3777",
    "http://[::1]:5173"
  ]) {
    const res = await fetch(`${ready.httpUrl}/health`, {
      headers: { Origin: trusted }
    });
    assert.equal(res.headers.get("access-control-allow-origin"), trusted);
    assert.equal(res.headers.get("vary"), "Origin");
  }

  // 2. WebSocket handleUpgrade: allow missing Origin & trusted origins; reject untrusted Origin with 403
  const wsNoOrigin = await connectWsWithOrigin(ready.wsUrl, authToken);
  await closeWs(wsNoOrigin);

  const wsAllowed = await connectWsWithOrigin(ready.wsUrl, authToken, "prismux://app");
  await closeWs(wsAllowed);

  const wsLoopback = await connectWsWithOrigin(
    ready.wsUrl,
    authToken,
    "http://[::1]:5173"
  );
  await closeWs(wsLoopback);

  for (const badOrigin of ["null", "file://", "https://evil.example.com"]) {
    await assert.rejects(
      () => connectWsWithOrigin(ready.wsUrl, authToken, badOrigin),
      /WS_REJECTED_403/
    );
  }

  // 3. /v1/pair/exchange: 5 consecutive failures revoke active pairing code -> 6th attempt with REAL code returns 401
  const validCode = ready.pairingCode;
  for (let i = 0; i < 5; i += 1) {
    const badRes = await fetch(`${ready.httpUrl}/v1/pair/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingCode: `BAD-ATTEMPT-${i}` })
    });
    assert.equal(badRes.status, 401);
  }

  // Active code was invalidated by 5 consecutive failures!
  const revokedRes = await fetch(`${ready.httpUrl}/v1/pair/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairingCode: validCode })
  });
  assert.equal(revokedRes.status, 401);

  // 4. Sliding-window rate limit: requests 7..10 still processed (401), request 11 -> 429 with Retry-After
  for (let i = 6; i < 10; i += 1) {
    const res = await fetch(`${ready.httpUrl}/v1/pair/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingCode: `MORE-${i}` })
    });
    assert.equal(res.status, 401);
  }

  const rateLimitedRes = await fetch(`${ready.httpUrl}/v1/pair/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairingCode: "ELEVENTH" })
  });
  assert.equal(rateLimitedRes.status, 429);
  assert.ok(Number(rateLimitedRes.headers.get("retry-after") ?? "0") >= 1);
  const limitedBody = (await rateLimitedRes.json()) as { error?: { code?: string } };
  assert.equal(limitedBody.error?.code, "rate_limited");
});

test("P1-2 WallpaperMediaService enforces validated CORS allowlist (never *) across 200/206/416 media responses", async () => {
  const dataDir = makeTempDir("prismux-p1-2-wp-");
  const authToken = "p1-2-wp-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken
  });
  cleanups.push(() => daemon.stop());
  const ready = await daemon.start();

  // Import a local image file to get a served media URL
  const samplePng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2dIAAAAASUVORK5CYII=",
    "base64"
  );
  const importRes = await fetch(`${ready.httpUrl}/v1/wallpapers/import`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({
      fileName: "cors-check.png",
      contentBase64: samplePng.toString("base64")
    })
  });
  assert.equal(importRes.status, 200);
  const imported = (await importRes.json()) as { item: { id: string; mediaUrl: string } };
  const mediaUrl = `${ready.httpUrl}${imported.item.mediaUrl}?token=${encodeURIComponent(authToken)}`;

  // Missing Origin -> no Access-Control-Allow-Origin header (never *)
  const noOriginRes = await fetch(mediaUrl);
  assert.equal(noOriginRes.status, 200);
  assert.equal(noOriginRes.headers.get("access-control-allow-origin"), null);

  // Untrusted Origin / null -> omitted (never * or null)
  for (const badOrigin of ["null", "file://", "https://evil.example.com"]) {
    const res = await fetch(mediaUrl, { headers: { Origin: badOrigin } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  }

  // Trusted Origin -> reflected + Vary: Origin on 200, 206, and 416
  const ok200 = await fetch(mediaUrl, { headers: { Origin: "prismux://app" } });
  assert.equal(ok200.status, 200);
  assert.equal(ok200.headers.get("access-control-allow-origin"), "prismux://app");
  assert.equal(ok200.headers.get("vary"), "Origin");

  const ok206 = await fetch(mediaUrl, {
    headers: { Origin: "http://127.0.0.1:5173", Range: "bytes=0-15" }
  });
  assert.equal(ok206.status, 206);
  assert.equal(ok206.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
  assert.equal(ok206.headers.get("vary"), "Origin");

  const err416Trusted = await fetch(mediaUrl, {
    headers: { Origin: "http://localhost:5173", Range: "bytes=99999-100000" }
  });
  assert.equal(err416Trusted.status, 416);
  assert.equal(err416Trusted.headers.get("access-control-allow-origin"), "http://localhost:5173");

  const err416Untrusted = await fetch(mediaUrl, {
    headers: { Origin: "https://evil.example.com", Range: "bytes=99999-100000" }
  });
  assert.equal(err416Untrusted.status, 416);
  assert.equal(err416Untrusted.headers.get("access-control-allow-origin"), null);
});

// ---------------------------------------------------------------------------
// P1-6 & P2-2: AppUpdater network, redirect, 7za resolution & split-7z pre-extract gates
// ---------------------------------------------------------------------------

test("P1-6 AppUpdater enforces HTTPS-only, customGhProxyPrefix HTTPS validation, redirect host allowlist, no downgrade, and cross-origin header stripping", async () => {
  const dataDir = makeTempDir("prismux-p1-6-net-");
  const prodUpdater = new AppUpdater({
    currentVersion: "0.2.3-rc.2",
    dataDir
  });

  // customGhProxyPrefix rejects http:// (both remote and loopback) in production
  assert.throws(
    () => prodUpdater.setPolicy({ customGhProxyPrefix: "http://proxy.example.com/" }),
    /https:\/\//i
  );
  assert.throws(
    () => prodUpdater.setPolicy({ customGhProxyPrefix: "http://127.0.0.1:8080/" }),
    /https:\/\//i
  );
  // Accepts https:// customGhProxyPrefix
  const updatedPolicy = prodUpdater.setPolicy({
    customGhProxyPrefix: "https://ghproxy.example.com/"
  });
  assert.equal(updatedPolicy.customGhProxyPrefix, "https://ghproxy.example.com/");

  // Direct URL validation checks
  assert.throws(
    () => validateUpdaterHttpUrl("http://github.com/Fish-under-sea/Prismux"),
    /HTTPS required/i
  );
  assert.throws(
    () => validateUpdaterHttpUrl("http://127.0.0.1:8080/releases"),
    /HTTPS required/i
  );
  assert.throws(
    () => validateUpdaterHttpUrl("https://evil.example.com/setup.exe"),
    /disallowed updater host/i
  );
  assert.throws(
    () =>
      validateUpdaterHttpUrl(
        "http://127.0.0.1:8080/setup.exe",
        { allowInsecureLoopbackForTesting: true },
        "https:"
      ),
    /downgrade is forbidden/i
  );
  assert.equal(
    validateUpdaterHttpUrl("https://objects.githubusercontent.com/file.exe").hostname,
    "objects.githubusercontent.com"
  );
  assert.equal(
    validateUpdaterHttpUrl("https://release-assets.githubusercontent.com/file.exe").hostname,
    "release-assets.githubusercontent.com"
  );
  assert.equal(
    validateUpdaterHttpUrl("https://github-releases.githubusercontent.com/file.exe").hostname,
    "github-releases.githubusercontent.com"
  );
  assert.equal(
    validateUpdaterHttpUrl("https://foruda.gitee.com/file.exe").hostname,
    "foruda.gitee.com"
  );
  assert.equal(
    validateUpdaterHttpUrl("https://ghproxy.example.com/file.exe", {
      extraAllowedHosts: new Set(["ghproxy.example.com"])
    }).hostname,
    "ghproxy.example.com"
  );

  // Real cross-origin redirect strips Authorization, Cookie, Proxy-Authorization
  let firstHopHeaders: http.IncomingHttpHeaders | undefined;
  let secondHopHeaders: http.IncomingHttpHeaders | undefined;
  let mode: "cross-origin" | "disallowed-host" = "cross-origin";

  const targetServer = await startMockHttpServer((req, res) => {
    secondHopHeaders = req.headers;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  const sourceServer = await startMockHttpServer((req, res) => {
    firstHopHeaders = req.headers;
    if (mode === "disallowed-host") {
      res.writeHead(302, { location: "https://evil.example.com/drop.exe" });
      res.end();
      return;
    }
    res.writeHead(302, { location: `${targetServer.baseUrl}/final` });
    res.end();
  });

  const resp = await openHttpWithRedirects(
    `${sourceServer.baseUrl}/start`,
    {
      Authorization: "Bearer top-secret",
      Cookie: "sid=secret",
      "Proxy-Authorization": "Basic abc",
      "X-Trace": "keep"
    },
    5_000,
    5,
    "GET",
    true,
    { allowInsecureLoopbackForTesting: true }
  );
  resp.stream.resume();
  assert.equal(resp.statusCode, 200);
  assert.equal(firstHopHeaders?.authorization, "Bearer top-secret");
  assert.equal(firstHopHeaders?.cookie, "sid=secret");
  assert.equal(firstHopHeaders?.["proxy-authorization"], "Basic abc");
  assert.equal(secondHopHeaders?.authorization, undefined);
  assert.equal(secondHopHeaders?.cookie, undefined);
  assert.equal(secondHopHeaders?.["proxy-authorization"], undefined);
  assert.equal(secondHopHeaders?.["x-trace"], "keep");

  mode = "disallowed-host";
  await assert.rejects(
    () =>
      openHttpWithRedirects(
        `${sourceServer.baseUrl}/start`,
        {},
        5_000,
        5,
        "GET",
        true,
        { allowInsecureLoopbackForTesting: true }
      ),
    /disallowed updater host/i
  );
});

test("P2-2 resolve7zaBinary rejects .cmd/.bat shims, relative paths, and PATH fallback", () => {
  const dir = makeTempDir("prismux-p2-2-7za-");
  const fakeCmd = join(dir, "7za.cmd");
  const fakeBat = join(dir, "7z.bat");
  const fakeExe = join(dir, "7za.exe");
  writeFileSync(fakeCmd, "@echo off\r\necho pwned\r\n");
  writeFileSync(fakeBat, "@echo off\r\necho pwned\r\n");
  writeFileSync(fakeExe, "MZ-mock");

  assert.equal(resolve7zaBinary(fakeCmd), null);
  assert.equal(resolve7zaBinary(fakeBat), null);
  assert.equal(resolve7zaBinary("./7za.exe"), null);
  assert.equal(resolve7zaBinary(fakeExe), fakeExe);

  const prevPath = process.env["PATH"];
  const prevEnv7za = process.env["PRISMUX_7ZA_PATH"];
  try {
    // Even if dir containing 7za.cmd and 7za.exe is prepended to PATH, PATH fallback is completely removed!
    process.env["PATH"] = `${dir};${prevPath ?? ""}`;
    delete process.env["PRISMUX_7ZA_PATH"];
    // Should NOT resolve fakeCmd or fakeExe from PATH
    const resolvedNoArg = resolve7zaBinary();
    assert.notEqual(resolvedNoArg, fakeCmd);
    assert.notEqual(resolvedNoArg, fakeExe);

    // PRISMUX_7ZA_PATH rejects .cmd and relative paths, accepts absolute .exe
    process.env["PRISMUX_7ZA_PATH"] = fakeCmd;
    assert.equal(resolve7zaBinary(), null);
    process.env["PRISMUX_7ZA_PATH"] = "relative\\7za.exe";
    assert.equal(resolve7zaBinary(), null);
    process.env["PRISMUX_7ZA_PATH"] = fakeExe;
    assert.equal(resolve7zaBinary(), fakeExe);
  } finally {
    if (prevPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = prevPath;
    if (prevEnv7za === undefined) delete process.env["PRISMUX_7ZA_PATH"];
    else process.env["PRISMUX_7ZA_PATH"] = prevEnv7za;
  }
});

test("P1-6 parseAndValidate7zSltListing and split-7z pre-extract gates reject missing/mismatched volume hashes and unsafe archives before extraction", async () => {
  // 1. Unit tests for parseAndValidate7zSltListing
  const validSlt = [
    "7-Zip 24.08 (x64)",
    "Scanning the drive for archives:",
    "1 file, 69632 bytes",
    "----------",
    "Path = Prismux-Setup-0.2.4-rc.1.exe",
    "Size = 69632",
    "Packed Size = 69632",
    "Attributes = A",
    "Encrypted = -",
    ""
  ].join("\r\n");
  assert.deepEqual(parseAndValidate7zSltListing(validSlt), {
    entryPath: "Prismux-Setup-0.2.4-rc.1.exe"
  });

  const invalidListings: Array<[string, string]> = [
    ["traversal", "----------\nPath = ../evil.exe\nAttributes = A\n"],
    ["subdirectory", "----------\nPath = sub/setup.exe\nAttributes = A\n"],
    ["windows-backslash", "----------\nPath = sub\\setup.exe\nAttributes = A\n"],
    ["absolute", "----------\nPath = C:\\Windows\\evil.exe\nAttributes = A\n"],
    ["non-exe", "----------\nPath = payload.dll\nAttributes = A\n"],
    ["symlink-field", "----------\nPath = setup.exe\nSymbolic Link = target.exe\n"],
    ["reparse-attr", "----------\nPath = setup.exe\nAttributes = L\n"],
    ["posix-symlink", "----------\nPath = setup.exe\nAttributes = lrwxrwxrwx\n"],
    ["directory", "----------\nPath = setup.exe\nFolder = +\n"],
    ["ntfs-ads", "----------\nPath = setup.exe:hidden\nAttributes = A\n"],
    ["reserved-name", "----------\nPath = con.exe\nAttributes = A\n"],
    [
      "multiple-files",
      "----------\nPath = setup.exe\nAttributes = A\n\nPath = extra.dll\nAttributes = A\n"
    ],
    ["empty", "----------\n"]
  ];
  for (const [label, slt] of invalidListings) {
    assert.throws(
      () => parseAndValidate7zSltListing(slt),
      `Expected listing "${label}" to be rejected`
    );
  }

  // 2. Real 7-Zip integration tests:
  //    (a) Missing volume SHA-256 in SHA256SUMS fails closed before downloading/extracting
  //    (b) Tampered .7z.002 volume fails with UpdateIntegrityError before invoking 7za
  //    (c) Multi-file / subdirectory 7z archive is blocked by `7za l -slt` precheck BEFORE extraction
  const sevenZip = findTestHostSevenZip();
  assert.ok(sevenZip !== null, "Expected 7z binary on Windows test host");

  const exeName = "Prismux-Setup-0.2.4-rc.1.exe";
  const exePayload = randomBytes(60 * 1024);
  const exeSha = sha256Hex(exePayload);

  // Build valid 2+ part split archive
  const goodFixtureDir = makeTempDir("prismux-p1-6-good7z-");
  writeFileSync(join(goodFixtureDir, exeName), exePayload);
  await execFileAsync(
    sevenZip,
    ["a", "-t7z", "-mx=0", "-v24k", join(goodFixtureDir, `${exeName}.7z`), join(goodFixtureDir, exeName)],
    { windowsHide: true, timeout: 15_000 }
  );
  const goodParts = readdirSync(goodFixtureDir)
    .filter((n) => n.startsWith(`${exeName}.7z.`))
    .sort()
    .map((name) => ({ name, bytes: readFileSync(join(goodFixtureDir, name)) }));

  // Build unsafe split archive containing 2 files (setup.exe + extra.txt)
  const multiFixtureDir = makeTempDir("prismux-p1-6-multi7z-");
  writeFileSync(join(multiFixtureDir, exeName), exePayload);
  writeFileSync(join(multiFixtureDir, "sneaky.txt"), "extra file");
  await execFileAsync(
    sevenZip,
    [
      "a",
      "-t7z",
      "-mx=0",
      "-v24k",
      join(multiFixtureDir, `${exeName}.7z`),
      join(multiFixtureDir, exeName),
      join(multiFixtureDir, "sneaky.txt")
    ],
    { windowsHide: true, timeout: 15_000 }
  );
  const multiParts = readdirSync(multiFixtureDir)
    .filter((n) => n.startsWith(`${exeName}.7z.`))
    .sort()
    .map((name) => ({ name, bytes: readFileSync(join(multiFixtureDir, name)) }));

  let testCase: "missing-vol-sha" | "tampered-vol-2" | "multi-file-archive" =
    "missing-vol-sha";
  const mock = await startMockHttpServer((req, res) => {
    const urlPath = req.url ?? "/";
    const activeParts = testCase === "multi-file-archive" ? multiParts : goodParts;

    if (urlPath.startsWith("/gitee/repos/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify([
          {
            tag_name: "v0.2.4-rc.1",
            prerelease: true,
            draft: false,
            assets: [
              ...activeParts.map((p) => ({
                name: p.name,
                browser_download_url: `${mock.baseUrl}/dl/${encodeURIComponent(p.name)}`,
                size: p.bytes.length
              })),
              {
                name: "SHA256SUMS.txt",
                browser_download_url: `${mock.baseUrl}/dl/SHA256SUMS.txt`
              }
            ]
          }
        ])
      );
      return;
    }

    if (urlPath === "/dl/SHA256SUMS.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      if (testCase === "missing-vol-sha") {
        // Only exe hash, deliberately omitting .7z.001..N volume hashes!
        res.end(`${exeSha}  ${exeName}\n`);
      } else {
        res.end(
          [
            `${exeSha}  ${exeName}`,
            ...activeParts.map((p) => `${sha256Hex(p.bytes)}  ${p.name}`)
          ].join("\n") + "\n"
        );
      }
      return;
    }

    const partIdx = activeParts.findIndex(
      (p) => urlPath === `/dl/${encodeURIComponent(p.name)}`
    );
    if (partIdx >= 0) {
      let body = activeParts[partIdx]!.bytes;
      if (testCase === "tampered-vol-2" && partIdx === 1) {
        body = Buffer.from(body);
        body[body.length - 1] = (body[body.length - 1]! ^ 0xff) & 0xff;
      }
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(body.length)
      });
      res.end(body);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  // (a) Missing volume hash fails closed BEFORE any 7za invocation (even with bogus 7za path!)
  const updaterMissing = new AppUpdater({
    currentVersion: "0.2.3-rc.2",
    dataDir: makeTempDir("prismux-p1-6-missingvol-"),
    sevenZipPath: sevenZip,
    giteeApiBase: `${mock.baseUrl}/gitee`,
    githubApiBase: `${mock.baseUrl}/gh-offline`,
    initialPolicy: { routePreference: "domestic", includePrerelease: true },
    allowInsecureLoopbackForTesting: true
  });
  testCase = "missing-vol-sha";
  const checkMissing = await updaterMissing.checkForUpdates({ sourceOverride: "gitee" });
  await assert.rejects(
    () => updaterMissing.downloadUpdate({ checkResult: checkMissing }),
    /missing valid 64-char SHA-256/i
  );

  // (b) Tampered .7z.002 volume fails with UpdateIntegrityError BEFORE 7za runs & wipes workDir
  const updaterTamper = new AppUpdater({
    currentVersion: "0.2.3-rc.2",
    dataDir: makeTempDir("prismux-p1-6-tampervol-"),
    sevenZipPath: sevenZip,
    giteeApiBase: `${mock.baseUrl}/gitee`,
    githubApiBase: `${mock.baseUrl}/gh-offline`,
    initialPolicy: { routePreference: "domestic", includePrerelease: true },
    allowInsecureLoopbackForTesting: true
  });
  testCase = "tampered-vol-2";
  const checkTamper = await updaterTamper.checkForUpdates({ sourceOverride: "gitee" });
  await assert.rejects(
    () => updaterTamper.downloadUpdate({ checkResult: checkTamper }),
    (err: unknown) => {
      assert.ok(err instanceof UpdateIntegrityError);
      assert.match(err.assetName, /\.7z\.002$/);
      return true;
    }
  );
  assert.deepEqual(readdirSync(updaterTamper.getDownloadsDir()), []);

  // (c) Multi-file 7z archive is rejected by `7za l -slt` precheck BEFORE extraction & wipes workDir
  const updaterMulti = new AppUpdater({
    currentVersion: "0.2.3-rc.2",
    dataDir: makeTempDir("prismux-p1-6-multifile-"),
    sevenZipPath: sevenZip,
    giteeApiBase: `${mock.baseUrl}/gitee`,
    githubApiBase: `${mock.baseUrl}/gh-offline`,
    initialPolicy: { routePreference: "domestic", includePrerelease: true },
    allowInsecureLoopbackForTesting: true
  });
  testCase = "multi-file-archive";
  const checkMulti = await updaterMulti.checkForUpdates({ sourceOverride: "gitee" });
  await assert.rejects(
    () => updaterMulti.downloadUpdate({ checkResult: checkMulti }),
    /安全预检失败|exactly 1 flat \.exe/i
  );
  assert.deepEqual(readdirSync(updaterMulti.getDownloadsDir()), []);
});

// ---------------------------------------------------------------------------
// P1-6: OfficialPluginDownloader fail-closed sha256 + HTTPS/redirect/header hardening
// ---------------------------------------------------------------------------

test("P1-6 OfficialPluginDownloader fails closed on missing/invalid sha256, enforces HTTPS & redirect allowlist, and strips sensitive headers cross-origin", async () => {
  const validGzip = gzipSync(Buffer.from("official-plugin-payload", "utf8"));
  const validSha = sha256Hex(validGzip);

  let hop1Headers: http.IncomingHttpHeaders | undefined;
  let hop2Headers: http.IncomingHttpHeaders | undefined;
  let redirectKind: "cross-origin-ok" | "disallowed-host" = "cross-origin-ok";

  const targetSrv = await startMockHttpServer((req, res) => {
    hop2Headers = req.headers;
    res.writeHead(200, { "content-type": "application/gzip" });
    res.end(validGzip);
  });
  const sourceSrv = await startMockHttpServer((req, res) => {
    hop1Headers = req.headers;
    if (redirectKind === "disallowed-host") {
      res.writeHead(302, { location: "https://evil.example.com/plugin.wb-plugin" });
      res.end();
      return;
    }
    res.writeHead(302, { location: `${targetSrv.baseUrl}/plugin.wb-plugin` });
    res.end();
  });

  const baseEntry: OfficialPluginCatalogEntry = {
    id: "qq",
    packageName: "@prismux/plugin-qq",
    version: "0.2.4",
    description: "QQ plugin",
    engines: { prismux: ">=0.1.0 <2.0.0" },
    realms: ["daemon"],
    permissions: [],
    modelVisible: false,
    sha256: validSha,
    status: "verified"
  };

  // 1. Fail-closed on missing, empty, or malformed entry.sha256
  for (const badSha of [null, undefined as unknown as null, "", "not-a-sha256", "a".repeat(63)]) {
    const badEntry: OfficialPluginCatalogEntry = {
      ...baseEntry,
      sha256: badSha
    };
    await assert.rejects(
      () =>
        downloadOfficialPluginReleaseArchive(badEntry, {
          config: {
            githubWebBase: sourceSrv.baseUrl,
            giteeWebBase: sourceSrv.baseUrl,
            allowInsecureLoopbackForTesting: true
          }
        }),
      /missing valid 64-char SHA-256/i
    );
  }

  // 2. Without test loopback opt-in, http:// URLs are blocked (HTTPS required)
  const blockedHttp = await downloadOfficialPluginReleaseArchive(
    { ...baseEntry, downloadUrl: `${sourceSrv.baseUrl}/plugin.wb-plugin` },
    {
      config: {
        githubWebBase: sourceSrv.baseUrl,
        giteeWebBase: sourceSrv.baseUrl
      }
    }
  );
  assert.equal(blockedHttp.ok, false);
  assert.ok(blockedHttp.attempts.every((a) => /HTTPS required/i.test(a.reason ?? "")));

  // 3. Cross-origin redirect strips Authorization, Cookie, Proxy-Authorization
  redirectKind = "cross-origin-ok";
  const okRes = await downloadOfficialPluginReleaseArchive(
    { ...baseEntry, downloadUrl: `${sourceSrv.baseUrl}/start` },
    {
      config: {
        githubWebBase: sourceSrv.baseUrl,
        giteeWebBase: sourceSrv.baseUrl,
        allowInsecureLoopbackForTesting: true
      },
      headers: {
        Authorization: "Bearer secret-official",
        Cookie: "c=1",
        "Proxy-Authorization": "Basic xyz"
      }
    }
  );
  assert.equal(okRes.ok, true);
  assert.equal(hop1Headers?.authorization, "Bearer secret-official");
  assert.equal(hop2Headers?.authorization, undefined);
  assert.equal(hop2Headers?.cookie, undefined);
  assert.equal(hop2Headers?.["proxy-authorization"], undefined);

  // 4. Redirect to disallowed external host is blocked
  redirectKind = "disallowed-host";
  const blockedRedirect = await downloadOfficialPluginReleaseArchive(
    { ...baseEntry, downloadUrl: `${sourceSrv.baseUrl}/start` },
    {
      config: {
        githubWebBase: sourceSrv.baseUrl,
        giteeWebBase: sourceSrv.baseUrl,
        allowInsecureLoopbackForTesting: true
      }
    }
  );
  assert.equal(blockedRedirect.ok, false);
  assert.ok(
    blockedRedirect.attempts.some((a) => /disallowed download\/redirect host/i.test(a.reason ?? ""))
  );
});

// ---------------------------------------------------------------------------
// P1-7: DaemonBusinessRoutes rejects archivePath & untrusted registryUrl/fallbackRegistryUrl
// ---------------------------------------------------------------------------

test("P1-7 DaemonBusinessRoutes rejects archivePath, rejects untrusted/HTTP registryUrl, and requires audit confirmation for hooks:intercept", async () => {
  const dataDir = makeTempDir("prismux-p1-7-biz-");
  const authToken = "p1-7-biz-owner-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken
  });
  cleanups.push(() => daemon.stop());
  const ready = await daemon.start();

  const headers = {
    "content-type": "application/json",
    Authorization: `Bearer ${authToken}`
  };

  // 1. archivePath is strictly rejected on local-archive and official install endpoints
  const dummyArchive = join(dataDir, "dummy.wb-plugin");
  writeFileSync(dummyArchive, "dummy");

  const localPathRes = await fetch(`${ready.httpUrl}/v1/plugins/install`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      source: "local-archive",
      archivePath: dummyArchive
    })
  });
  assert.equal(localPathRes.status, 400);
  const localPathBody = (await localPathRes.json()) as { error?: { code?: string } };
  assert.equal(localPathBody.error?.code, "ARCHIVE_PATH_FORBIDDEN");

  const officialPathRes = await fetch(`${ready.httpUrl}/v1/plugins/install-official`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      pluginId: "qq",
      archivePath: dummyArchive
    })
  });
  assert.equal(officialPathRes.status, 400);
  const officialPathBody = (await officialPathRes.json()) as { error?: { code?: string } };
  assert.equal(officialPathBody.error?.code, "ARCHIVE_PATH_FORBIDDEN");

  // 2. Untrusted or plaintext HTTP registryUrl / fallbackRegistryUrl rejected with 400 INVALID_REGISTRY_URL
  for (const body of [
    {
      source: "npm",
      packageNameOrTarball: "prismux-plugin-demo",
      registryUrl: "http://registry.npmjs.org"
    },
    {
      source: "npm",
      packageNameOrTarball: "prismux-plugin-demo",
      registryUrl: "https://evil.example.com"
    },
    {
      source: "npm",
      packageNameOrTarball: "prismux-plugin-demo",
      fallbackRegistryUrl: "http://registry.npmmirror.com"
    },
    {
      source: "npm",
      packageNameOrTarball: "prismux-plugin-demo",
      fallbackRegistryUrl: "https://attacker.org/npm"
    }
  ]) {
    const regRes = await fetch(`${ready.httpUrl}/v1/plugins/install`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    assert.equal(regRes.status, 400);
    const regErr = (await regRes.json()) as { error?: { code?: string } };
    assert.equal(regErr.error?.code, "INVALID_REGISTRY_URL");
  }

  // 3. archiveBase64 with hooks:intercept (modelVisible=false) returns 409 AUDIT_CONFIRMATION_REQUIRED until confirmed
  const interceptArchive = buildDeterministicTgz({
    "package.json": JSON.stringify({
      name: "prismux-plugin-intercept-biz",
      version: "1.0.0",
      type: "module",
      main: "./index.mjs",
      engines: { prismux: ">=0.1.0-0 <2.0.0" }
    }),
    "plugin.manifest.json": JSON.stringify({
      id: "intercept-biz",
      version: "1.0.0",
      realms: ["daemon"],
      permissions: ["hooks:intercept"],
      modelVisible: false
    }),
    "index.mjs":
      'export const manifest = { id: "intercept-biz", version: "1.0.0", realms: ["daemon"], permissions: ["hooks:intercept"], modelVisible: false }; export function apply() {}\n'
  });

  const unconfirmedRes = await fetch(`${ready.httpUrl}/v1/plugins/install`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      source: "local-archive",
      fileName: "intercept-biz-1.0.0.wb-plugin",
      archiveBase64: interceptArchive.toString("base64")
    })
  });
  assert.equal(unconfirmedRes.status, 409);
  const unconfirmedBody = (await unconfirmedRes.json()) as { error?: { code?: string } };
  assert.equal(unconfirmedBody.error?.code, "AUDIT_CONFIRMATION_REQUIRED");
  assert.equal(existsSync(join(dataDir, "plugins", "intercept-biz")), false);

  const confirmedRes = await fetch(`${ready.httpUrl}/v1/plugins/install`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      source: "local-archive",
      fileName: "intercept-biz-1.0.0.wb-plugin",
      archiveBase64: interceptArchive.toString("base64"),
      confirmedAudit: true
    })
  });
  assert.equal(confirmedRes.status, 200);
  assert.equal(existsSync(join(dataDir, "plugins", "intercept-biz")), true);
});
