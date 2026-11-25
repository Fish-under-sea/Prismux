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
import { compareSemver } from "@prismux/cordis-kernel";
import {
  DEFAULT_UPDATE_POLICY,
  type UpdateDownloadProgress,
  type UpdaterSseEventPayload,
  type UpdaterStatusSnapshot
} from "@prismux/protocol";
import { PrismuxDaemon } from "../index.js";
import {
  AppUpdater,
  MAX_RELEASE_NOTES_CHARS,
  UpdateIntegrityError,
  applyGhProxyPrefix,
  extractGiteeReleaseBodyFromHtml,
  normalizeReleaseNotesBody,
  parseGiteeWebReleasesHtml,
  resolve7zaBinary
} from "../updater/AppUpdater.js";

const execFileAsync = promisify(execFile);

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

const cleanupDirs: string[] = [];
after(() => {
  for (const dir of cleanupDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

test("compareSemver and channel filtering recognize 0.0.1-alpha.1 < 0.0.1-alpha.2 < 0.1.0", async () => {
  assert.equal(compareSemver("0.0.1-alpha.1", "0.0.1-alpha.2"), -1);
  assert.equal(compareSemver("0.0.1-alpha.2", "0.1.0"), -1);
  assert.equal(compareSemver("0.0.1-alpha.1", "0.1.0"), -1);

  const setupAlpha2 = Buffer.from("prismux-setup-0.0.1-alpha.2-binary", "utf8");
  const setupStable = Buffer.from("prismux-setup-0.1.0-stable-binary", "utf8");

  let phase: "alpha" | "stable" = "alpha";
  let mockRef!: { server: http.Server; baseUrl: string };
  mockRef = await startMockServer((req, res) => {
    const urlPath = req.url ?? "/";
    if (urlPath.startsWith("/repos/")) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      if (phase === "alpha") {
        res.end(
          JSON.stringify([
            {
              tag_name: "v0.0.1-alpha.2",
              name: "v0.0.1-alpha.2",
              prerelease: true,
              draft: false,
              assets: [
                {
                  name: "Prismux-Setup-0.0.1-alpha.2.exe",
                  browser_download_url: `${mockRef.baseUrl}/dl/setup-alpha2.exe`,
                  size: setupAlpha2.length
                },
                {
                  name: "Prismux-Setup-0.0.1-alpha.2.exe.sha256",
                  browser_download_url: `${mockRef.baseUrl}/dl/setup-alpha2.exe.sha256`
                }
              ]
            },
            {
              tag_name: "v0.0.1-alpha.1",
              name: "v0.0.1-alpha.1",
              prerelease: true,
              draft: false,
              assets: []
            },
            {
              tag_name: "v0.0.0-draft",
              draft: true,
              prerelease: false,
              assets: []
            }
          ])
        );
      } else {
        res.end(
          JSON.stringify([
            {
              tag_name: "v0.0.1-alpha.2",
              prerelease: true,
              draft: false,
              assets: []
            },
            {
              tag_name: "v0.1.0",
              prerelease: false,
              draft: false,
              assets: [
                {
                  name: "Prismux-Setup-0.1.0.exe",
                  browser_download_url: `${mockRef.baseUrl}/dl/setup-010.exe`,
                  size: setupStable.length
                },
                {
                  name: "SHA256SUMS.txt",
                  browser_download_url: `${mockRef.baseUrl}/dl/SHA256SUMS.txt`
                }
              ]
            }
          ])
        );
      }
      return;
    }
    if (urlPath === "/dl/setup-alpha2.exe.sha256") {
      res.statusCode = 200;
      res.end(`${sha256Hex(setupAlpha2)}  Prismux-Setup-0.0.1-alpha.2.exe\n`);
      return;
    }
    if (urlPath === "/dl/SHA256SUMS.txt") {
      res.statusCode = 200;
      res.end(`${sha256Hex(setupStable)}  Prismux-Setup-0.1.0.exe\n`);
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  try {
    const dataDir = makeTempDir("prismux-updater-semver-");
    const updater = new AppUpdater({
      currentVersion: "0.0.1-alpha.1",
      dataDir,
      initialPolicy: { routePreference: "global", includePrerelease: true },
      githubApiBase: mockRef.baseUrl,
      giteeApiBase: mockRef.baseUrl
    });

    // With includePrerelease: true, picks 0.0.1-alpha.2 over 0.0.1-alpha.1
    const preCheck = await updater.checkForUpdates();
    assert.equal(preCheck.hasUpdate, true);
    assert.equal(preCheck.latestVersion, "0.0.1-alpha.2");
    assert.equal(preCheck.prerelease, true);
    assert.equal(preCheck.recommendedAsset?.sha256, sha256Hex(setupAlpha2));

    // With includePrerelease: false (stable only), alpha.2 is filtered out -> no update
    const stableCheck = await updater.checkForUpdates({ channel: "stable" });
    assert.equal(stableCheck.hasUpdate, false);

    // When 0.1.0 stable is published, compareSemver(0.0.1-alpha.2, 0.1.0) < 0 picks 0.1.0
    phase = "stable";
    const stableUpgrade = await updater.checkForUpdates({ channel: "stable" });
    assert.equal(stableUpgrade.hasUpdate, true);
    assert.equal(stableUpgrade.latestVersion, "0.1.0");
    assert.equal(stableUpgrade.prerelease, false);
    assert.equal(stableUpgrade.recommendedAsset?.sha256, sha256Hex(setupStable));
  } finally {
    await closeMockServer(mockRef.server);
  }
});

test("AppUpdater route switching: domestic (Gitee->GitHub fallback), global (GitHub->Gitee fallback), and auto latency probe", async () => {
  const payload = Buffer.from("prismux-dual-source-installer-payload", "utf8");
  const expectedDigest = sha256Hex(payload);

  let githubHits = 0;
  let giteeHits = 0;
  let githubMode: "ok" | "503" | "slow" = "ok";
  let giteeMode: "ok" | "503" | "slow" = "ok";

  const makeReleaseJson = (baseUrl: string) =>
    JSON.stringify([
      {
        tag_name: "v0.0.1-alpha.2",
        name: "Prismux v0.0.1-alpha.2",
        prerelease: true,
        draft: false,
        assets: [
          {
            name: "Prismux-Setup-0.0.1-alpha.2.exe",
            browser_download_url: `${baseUrl}/assets/Prismux-Setup-0.0.1-alpha.2.exe`,
            size: payload.length
          },
          {
            name: "Prismux-Portable-0.0.1-alpha.2-win-x64.zip",
            browser_download_url: `${baseUrl}/assets/Prismux-Portable-0.0.1-alpha.2-win-x64.zip`,
            size: payload.length
          },
          {
            name: "SHA256SUMS.txt",
            browser_download_url: `${baseUrl}/assets/SHA256SUMS.txt`
          }
        ]
      }
    ]);

  let githubBase = "";
  let giteeBase = "";

  const githubServer = await startMockServer((req, res) => {
    githubHits += 1;
    const urlPath = req.url ?? "/";
    if (githubMode === "503") {
      res.statusCode = 503;
      res.end("GitHub down");
      return;
    }
    const respond = () => {
      if (urlPath.startsWith("/repos/")) {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(makeReleaseJson(githubBase));
        return;
      }
      if (urlPath === "/assets/SHA256SUMS.txt") {
        res.statusCode = 200;
        res.end(
          [
            `${expectedDigest}  Prismux-Setup-0.0.1-alpha.2.exe`,
            `${expectedDigest}  Prismux-Portable-0.0.1-alpha.2-win-x64.zip`
          ].join("\n")
        );
        return;
      }
      if (urlPath.startsWith("/assets/")) {
        res.statusCode = 200;
        res.setHeader("content-length", String(payload.length));
        res.end(payload);
        return;
      }
      res.statusCode = 404;
      res.end();
    };

    if (githubMode === "slow" && urlPath.startsWith("/repos/")) {
      setTimeout(respond, 90);
    } else {
      respond();
    }
  });
  githubBase = githubServer.baseUrl;

  const giteeServer = await startMockServer((req, res) => {
    giteeHits += 1;
    const urlPath = req.url ?? "/";
    if (giteeMode === "503") {
      res.statusCode = 503;
      res.end("Gitee down");
      return;
    }
    const respond = () => {
      if (urlPath.startsWith("/repos/")) {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(makeReleaseJson(giteeBase));
        return;
      }
      if (urlPath === "/assets/SHA256SUMS.txt") {
        res.statusCode = 200;
        res.end(
          [
            `${expectedDigest}  Prismux-Setup-0.0.1-alpha.2.exe`,
            `${expectedDigest}  Prismux-Portable-0.0.1-alpha.2-win-x64.zip`
          ].join("\n")
        );
        return;
      }
      if (urlPath.startsWith("/assets/")) {
        res.statusCode = 200;
        res.setHeader("content-length", String(payload.length));
        res.end(payload);
        return;
      }
      res.statusCode = 404;
      res.end();
    };

    if (giteeMode === "slow" && urlPath.startsWith("/repos/")) {
      setTimeout(respond, 90);
    } else {
      respond();
    }
  });
  giteeBase = giteeServer.baseUrl;

  try {
    const dataDir = makeTempDir("prismux-updater-routes-");
    const updater = new AppUpdater({
      currentVersion: "0.0.1-alpha.1",
      dataDir,
      portableMode: true,
      githubApiBase: githubBase,
      giteeApiBase: giteeBase,
      retryDelaysMs: [10, 20]
    });

    // Default policy uses empty ghProxyPrefix and auto routePreference
    assert.equal(updater.getPolicy().customGhProxyPrefix, DEFAULT_UPDATE_POLICY.customGhProxyPrefix);
    assert.equal(updater.getPolicy().routePreference, "auto");

    // 1. domestic: Gitee first (succeeds without hitting GitHub); portableMode selects Portable ZIP
    updater.setPolicy({ routePreference: "domestic" });
    githubHits = 0;
    giteeHits = 0;
    const domesticOk = await updater.checkForUpdates();
    assert.equal(domesticOk.sourceUsed, "gitee");
    assert.equal(domesticOk.usedFallbackSource, false);
    assert.equal(domesticOk.recommendedAsset?.kind, "portable-zip");
    assert.equal(githubHits, 0);
    assert.ok(giteeHits >= 1);

    // domestic: Gitee fails (503) -> falls back to GitHub
    giteeMode = "503";
    githubMode = "ok";
    githubHits = 0;
    giteeHits = 0;
    const domesticFallback = await updater.checkForUpdates();
    assert.equal(domesticFallback.sourceUsed, "github");
    assert.equal(domesticFallback.usedFallbackSource, true);
    assert.ok(giteeHits >= 1);
    assert.ok(githubHits >= 1);

    // 2. global: GitHub first, fails (503) -> falls back to Gitee
    updater.setPolicy({ routePreference: "global" });
    giteeMode = "ok";
    githubMode = "503";
    githubHits = 0;
    giteeHits = 0;
    const globalFallback = await updater.checkForUpdates();
    assert.equal(globalFallback.sourceUsed, "gitee");
    assert.equal(globalFallback.usedFallbackSource, true);
    assert.ok(githubHits >= 1);
    assert.ok(giteeHits >= 1);

    // 3. auto: probes both concurrently and picks lower-latency source
    updater.setPolicy({ routePreference: "auto" });
    githubMode = "slow";
    giteeMode = "ok";
    const autoGiteeWins = await updater.checkForUpdates();
    assert.equal(autoGiteeWins.probeReport?.recommendedSource, "gitee");
    assert.equal(autoGiteeWins.probeReport?.recommendedRoute, "domestic");
    assert.equal(autoGiteeWins.sourceUsed, "gitee");

    githubMode = "ok";
    giteeMode = "slow";
    const autoGithubWins = await updater.checkForUpdates();
    assert.equal(autoGithubWins.probeReport?.recommendedSource, "github");
    assert.equal(autoGithubWins.probeReport?.recommendedRoute, "global");
    assert.equal(autoGithubWins.sourceUsed, "github");
  } finally {
    await closeMockServer(githubServer.server);
    await closeMockServer(giteeServer.server);
  }
});

test("AppUpdater security gates: rejects missing .sha256 and deletes .part on 1-byte tamper", async () => {
  const realPayload = Buffer.from("authentic-prismux-setup-exe-payload-bytes", "utf8");
  const expectedSha = sha256Hex(realPayload);
  const tamperedPayload = Buffer.from(realPayload);
  tamperedPayload[10] = (tamperedPayload[10]! ^ 0x01) & 0xff;

  let mode: "missing-sha" | "tampered-bytes" = "missing-sha";
  let downloadHits = 0;
  let mockRef!: { server: http.Server; baseUrl: string };
  mockRef = await startMockServer((req, res) => {
    const urlPath = req.url ?? "/";
    if (urlPath.startsWith("/repos/")) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      const assets: unknown[] = [
        {
          name: "Prismux-Setup-0.0.1-alpha.2.exe",
          browser_download_url: `${mockRef.baseUrl}/dl/setup.exe`,
          size: realPayload.length
        }
      ];
      if (mode === "tampered-bytes") {
        assets.push({
          name: "Prismux-Setup-0.0.1-alpha.2.exe.sha256",
          browser_download_url: `${mockRef.baseUrl}/dl/setup.exe.sha256`
        });
      }
      res.end(
        JSON.stringify([
          {
            tag_name: "v0.0.1-alpha.2",
            prerelease: true,
            draft: false,
            assets
          }
        ])
      );
      return;
    }
    if (urlPath === "/dl/setup.exe.sha256") {
      res.statusCode = 200;
      res.end(`${expectedSha}  Prismux-Setup-0.0.1-alpha.2.exe\n`);
      return;
    }
    if (urlPath === "/dl/setup.exe") {
      downloadHits += 1;
      res.statusCode = 200;
      res.setHeader("content-length", String(tamperedPayload.length));
      res.end(tamperedPayload);
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  try {
    const dataDir = makeTempDir("prismux-updater-sec-");
    const destDir = join(dataDir, "downloads");
    const updater = new AppUpdater({
      currentVersion: "0.0.1-alpha.1",
      dataDir,
      downloadsDir: destDir,
      initialPolicy: { routePreference: "global" },
      githubApiBase: mockRef.baseUrl,
      giteeApiBase: mockRef.baseUrl,
      retryDelaysMs: [5]
    });

    // ④ Missing .sha256 MUST refuse download before hitting /dl/setup.exe
    mode = "missing-sha";
    const missingCheck = await updater.checkForUpdates();
    assert.equal(missingCheck.recommendedAsset?.sha256, null);
    await assert.rejects(
      () => updater.downloadUpdate({ checkResult: missingCheck }),
      /missing valid 64-char SHA-256/i
    );
    assert.equal(downloadHits, 0);

    // ⑤ 1-byte tampered download MUST fail SHA-256 check, clean .part, and leave no final exe
    mode = "tampered-bytes";
    const tamperCheck = await updater.checkForUpdates();
    assert.equal(tamperCheck.recommendedAsset?.sha256, expectedSha);
    await assert.rejects(
      () => updater.downloadUpdate({ checkResult: tamperCheck }),
      UpdateIntegrityError
    );
    assert.equal(downloadHits, 1);
    assert.equal(
      existsSync(join(destDir, "Prismux-Setup-0.0.1-alpha.2.exe")),
      false
    );
    assert.equal(
      existsSync(join(destDir, "Prismux-Setup-0.0.1-alpha.2.exe.part")),
      false
    );
    assert.deepEqual(existsSync(destDir) ? readdirSync(destDir) : [], []);
  } finally {
    await closeMockServer(mockRef.server);
  }
});

test("AppUpdater supports Range resume, 302 redirects (max 6 hops), and customGhProxyPrefix", async () => {
  const fullPayload = Buffer.alloc(16 * 1024);
  for (let i = 0; i < fullPayload.length; i += 1) {
    fullPayload[i] = (i * 31 + 7) & 0xff;
  }
  const expectedSha = sha256Hex(fullPayload);
  const splitOffset = 5 * 1024;

  const seenRanges: Array<string | undefined> = [];
  let proxySeenUrl = "";
  let redirectServerHops = 6;
  let attemptCount = 0;

  let originRef!: { server: http.Server; baseUrl: string };
  let proxyRef!: { server: http.Server; baseUrl: string };

  originRef = await startMockServer((req, res) => {
    const urlPath = req.url ?? "/";
    if (urlPath.startsWith("/repos/")) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify([
          {
            tag_name: "v0.0.1-alpha.2",
            prerelease: true,
            draft: false,
            assets: [
              {
                name: "Prismux-Setup-0.0.1-alpha.2.exe",
                browser_download_url: `${originRef.baseUrl}/redirect/0`,
                size: fullPayload.length
              },
              {
                name: "Prismux-Setup-0.0.1-alpha.2.exe.sha256",
                browser_download_url: `${originRef.baseUrl}/dl/setup.sha256`
              }
            ]
          }
        ])
      );
      return;
    }

    if (urlPath === "/dl/setup.sha256") {
      res.statusCode = 200;
      res.end(`${expectedSha}  Prismux-Setup-0.0.1-alpha.2.exe\n`);
      return;
    }

    if (urlPath.startsWith("/redirect/")) {
      const hop = Number.parseInt(urlPath.slice("/redirect/".length), 10);
      if (hop < redirectServerHops) {
        res.statusCode = 302;
        res.setHeader("location", `${originRef.baseUrl}/redirect/${hop + 1}`);
        res.end();
        return;
      }
      res.statusCode = 302;
      res.setHeader("location", `${originRef.baseUrl}/dl/setup.exe`);
      res.end();
      return;
    }

    if (urlPath === "/dl/setup.exe") {
      attemptCount += 1;
      const rangeHeader = req.headers.range;
      seenRanges.push(typeof rangeHeader === "string" ? rangeHeader : undefined);

      if (attemptCount === 1) {
        // First response: advertise full length, write only prefix, then terminate stream
        res.writeHead(200, {
          "content-length": String(fullPayload.length)
        });
        res.write(fullPayload.subarray(0, splitOffset));
        res.end();
        return;
      }

      if (typeof rangeHeader === "string" && rangeHeader.startsWith("bytes=")) {
        const start = Number.parseInt(
          rangeHeader.slice("bytes=".length).replace(/-.*$/, ""),
          10
        );
        const slice = fullPayload.subarray(start);
        res.writeHead(206, {
          "content-range": `bytes ${start}-${fullPayload.length - 1}/${fullPayload.length}`,
          "content-length": String(slice.length)
        });
        res.end(slice);
        return;
      }

      res.writeHead(200, { "content-length": String(fullPayload.length) });
      res.end(fullPayload);
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  proxyRef = await startMockServer((req, res) => {
    const rawTarget = (req.url ?? "/").slice(1);
    proxySeenUrl = rawTarget;
    if (rawTarget.startsWith(originRef.baseUrl)) {
      const targetUrl = new URL(rawTarget);
      const upstreamReq = http.request(
        targetUrl,
        {
          method: req.method,
          headers: {
            ...(req.headers.range ? { range: req.headers.range } : {})
          }
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
          upstreamRes.pipe(res);
        }
      );
      upstreamReq.on("error", () => {
        res.statusCode = 502;
        res.end();
      });
      upstreamReq.end();
      return;
    }
    res.statusCode = 400;
    res.end("Unexpected proxy target");
  });

  try {
    assert.equal(
      applyGhProxyPrefix("https://github.com/a/b", ""),
      "https://github.com/a/b"
    );
    assert.equal(
      applyGhProxyPrefix("https://github.com/a/b", "https://gh.example.com"),
      "https://gh.example.com/https://github.com/a/b"
    );

    const dataDir = makeTempDir("prismux-updater-resume-");
    const updater = new AppUpdater({
      currentVersion: "0.0.1-alpha.1",
      dataDir,
      initialPolicy: {
        routePreference: "global",
        customGhProxyPrefix: `${proxyRef.baseUrl}/`
      },
      githubApiBase: originRef.baseUrl,
      giteeApiBase: originRef.baseUrl,
      maxRedirects: 6,
      retryDelaysMs: [10, 20]
    });

    // ⑥ 6 redirect hops (wait: /redirect/0 -> ... -> /redirect/5 -> /dl/setup.exe is 6 hops;
    // set redirectServerHops=5 so 0->1->2->3->4->5->/dl/setup.exe = 6 redirects!)
    redirectServerHops = 5;
    const check = await updater.checkForUpdates();
    assert.ok(
      check.recommendedAsset?.effectiveUrl.startsWith(`${proxyRef.baseUrl}/`)
    );
    assert.ok(proxySeenUrl.startsWith(originRef.baseUrl));

    const result = await updater.downloadUpdate({ checkResult: check });
    assert.equal(result.verified, true);
    assert.equal(result.sha256, expectedSha);
    assert.equal(result.bytesDownloaded, fullPayload.length);
    assert.equal(result.resumedFromBytes, splitOffset);
    assert.deepEqual(seenRanges, [undefined, `bytes=${splitOffset}-`]);
    assert.equal(
      Buffer.compare(readFileSync(result.filePath), fullPayload),
      0
    );
    assert.equal(existsSync(`${result.filePath}.part`), false);

    // 7 redirects (> 6 maxRedirects) MUST fail cleanly
    redirectServerHops = 7;
    await assert.rejects(
      () => updater.downloadUpdate({ checkResult: check }),
      /Too many redirects/i
    );
  } finally {
    await closeMockServer(originRef.server);
    await closeMockServer(proxyRef.server);
  }
});

test("PrismuxDaemon integrates AppUpdater with 0.2.2-rc.1 default and exposes HTTP & RPC updater endpoints", async () => {
  const dataDir = makeTempDir("prismux-daemon-updater-");
  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken: "updater-rpc-token"
  });

  const ready = await daemon.start();
  try {
    const statusRes = await fetch(`${ready.httpUrl}/v1/updater/status`, {
      headers: { Authorization: "Bearer updater-rpc-token" }
    });
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as UpdaterStatusSnapshot;
    assert.equal(statusJson.currentVersion, "0.2.2-rc.1");
    assert.equal(statusJson.policy.routePreference, "auto");
    assert.equal(statusJson.policy.includePrerelease, true);
    assert.equal(statusJson.policy.customGhProxyPrefix, "");

    const policyRes = await fetch(`${ready.httpUrl}/v1/updater/policy`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer updater-rpc-token"
      },
      body: JSON.stringify({
        routePreference: "domestic",
        pluginRegistryOverride: "npmmirror"
      })
    });
    assert.equal(policyRes.status, 200);

    const rpcStatusRes = await fetch(`${ready.httpUrl}/v1/rpc`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer updater-rpc-token"
      },
      body: JSON.stringify({
        id: "u-1",
        method: "updater.status",
        params: {}
      })
    });
    assert.equal(rpcStatusRes.status, 200);
    const rpcJson = (await rpcStatusRes.json()) as {
      ok: boolean;
      result: UpdaterStatusSnapshot;
    };
    assert.equal(rpcJson.ok, true);
    assert.equal(rpcJson.result.policy.routePreference, "domestic");
    assert.equal(rpcJson.result.policy.pluginRegistryOverride, "npmmirror");
  } finally {
    await daemon.stop();
  }
});

test("AppUpdater downloadUpdate switches to fallback source when primary asset CDN returns 503", async () => {
  const realAsset = Buffer.from("fallback-verified-installer-binary-content", "utf8");
  const expectedSha = sha256Hex(realAsset);
  let giteeDlHits = 0;
  let githubDlHits = 0;

  let giteeRef!: { server: http.Server; baseUrl: string };
  let githubRef!: { server: http.Server; baseUrl: string };

  giteeRef = await startMockServer((req, res) => {
    const urlPath = req.url ?? "/";
    if (urlPath.startsWith("/repos/")) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify([
          {
            tag_name: "v0.0.1-alpha.2",
            prerelease: true,
            draft: false,
            assets: [
              {
                name: "Prismux-Setup-0.0.1-alpha.2.exe",
                browser_download_url: `${giteeRef.baseUrl}/dl/setup.exe`,
                size: realAsset.length
              },
              {
                name: "Prismux-Setup-0.0.1-alpha.2.exe.sha256",
                browser_download_url: `${giteeRef.baseUrl}/dl/setup.exe.sha256`
              }
            ]
          }
        ])
      );
      return;
    }
    if (urlPath === "/dl/setup.exe.sha256") {
      res.statusCode = 200;
      res.end(`${expectedSha}  Prismux-Setup-0.0.1-alpha.2.exe\n`);
      return;
    }
    if (urlPath === "/dl/setup.exe") {
      giteeDlHits += 1;
      res.statusCode = 503;
      res.end("Gitee CDN temporarily unavailable");
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  githubRef = await startMockServer((req, res) => {
    const urlPath = req.url ?? "/";
    if (urlPath.startsWith("/repos/")) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify([
          {
            tag_name: "v0.0.1-alpha.2",
            prerelease: true,
            draft: false,
            assets: [
              {
                name: "Prismux-Setup-0.0.1-alpha.2.exe",
                browser_download_url: `${githubRef.baseUrl}/dl/setup.exe`,
                size: realAsset.length
              },
              {
                name: "Prismux-Setup-0.0.1-alpha.2.exe.sha256",
                browser_download_url: `${githubRef.baseUrl}/dl/setup.exe.sha256`
              }
            ]
          }
        ])
      );
      return;
    }
    if (urlPath === "/dl/setup.exe.sha256") {
      res.statusCode = 200;
      res.end(`${expectedSha}  Prismux-Setup-0.0.1-alpha.2.exe\n`);
      return;
    }
    if (urlPath === "/dl/setup.exe") {
      githubDlHits += 1;
      res.statusCode = 200;
      res.setHeader("content-length", String(realAsset.length));
      res.end(realAsset);
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  try {
    const dataDir = makeTempDir("prismux-updater-dl-fallback-");
    const updater = new AppUpdater({
      currentVersion: "0.0.1-alpha.1",
      dataDir,
      initialPolicy: { routePreference: "domestic" },
      giteeApiBase: giteeRef.baseUrl,
      githubApiBase: githubRef.baseUrl,
      maxRetries: 1,
      retryDelaysMs: [5]
    });

    const check = await updater.checkForUpdates();
    assert.equal(check.sourceUsed, "gitee");

    const downloaded = await updater.downloadUpdate({ checkResult: check });
    assert.equal(downloaded.sourceUsed, "github");
    assert.equal(downloaded.usedFallbackSource, true);
    assert.equal(downloaded.verified, true);
    assert.equal(downloaded.sha256, expectedSha);
    assert.ok(giteeDlHits >= 1);
    assert.equal(githubDlHits, 1);
    assert.equal(Buffer.compare(readFileSync(downloaded.filePath), realAsset), 0);
  } finally {
    await closeMockServer(giteeRef.server);
    await closeMockServer(githubRef.server);
  }
});

async function createSplit7zThreePartFixture(
  sevenZipExe: string,
  exeName: string,
  payload: Buffer,
  volumeSizeArg = "28k"
): Promise<{
  fixtureDir: string;
  parts: Array<{ name: string; bytes: Buffer }>;
}> {
  const fixtureDir = makeTempDir("prismux-7z-3part-");
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
  assert.equal(
    partNames.length,
    3,
    `Expected exactly 3 split 7z volumes, got ${partNames.join(", ")}`
  );

  return {
    fixtureDir,
    parts: partNames.map((name) => ({
      name,
      bytes: readFileSync(join(fixtureDir, name))
    }))
  };
}

function writeChunkedBuffer(
  res: http.ServerResponse,
  buf: Buffer,
  chunkSize: number,
  delayMs = 2
): void {
  let offset = 0;
  const pushNext = () => {
    if (res.writableEnded || res.destroyed) return;
    if (offset >= buf.length) {
      res.end();
      return;
    }
    const end = Math.min(buf.length, offset + chunkSize);
    res.write(buf.subarray(offset, end));
    offset = end;
    if (delayMs > 0) {
      setTimeout(pushNext, delayMs);
    } else {
      setImmediate(pushNext);
    }
  };
  pushNext();
}

test("AppUpdater probes Gitee 3-part split-7z sizes via HEAD when JSON omits size and emits monotonic 0->30->60->90->95->99.9->100% progress", async () => {
  const sevenZip = resolve7zaBinary();
  assert.ok(sevenZip !== null, "Expected 7za/7z binary on Windows test host");

  const exeName = "Prismux-Setup-0.1.2-preview.5.exe";
  const exePayload = randomBytes(72 * 1024);
  const expectedSha = sha256Hex(exePayload);
  const fixture = await createSplit7zThreePartFixture(sevenZip, exeName, exePayload, "28k");
  const totalArchiveBytes = fixture.parts.reduce((sum, part) => sum + part.bytes.length, 0);

  let headCount = 0;
  let mockRef!: { server: http.Server; baseUrl: string };
  mockRef = await startMockServer((req, res) => {
    const urlPath = req.url ?? "/";
    if (urlPath.startsWith("/gitee/repos/")) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      // Intentionally omit `size` on every asset to reproduce Gitee OpenAPI v5 / Web HTML payload.
      res.end(
        JSON.stringify([
          {
            tag_name: "v0.1.2-preview.5",
            name: "Prismux v0.1.2-preview.5",
            prerelease: true,
            draft: false,
            assets: [
              ...fixture.parts.map((part) => ({
                name: part.name,
                browser_download_url: `${mockRef.baseUrl}/dl/${encodeURIComponent(part.name)}`
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
      if (req.method === "HEAD") {
        headCount += 1;
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": String(matchedPart.bytes.length)
        });
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(matchedPart.bytes.length)
      });
      writeChunkedBuffer(res, matchedPart.bytes, 4 * 1024, 1);
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  try {
    const dataDir = makeTempDir("prismux-updater-head-3part-");
    const updater = new AppUpdater({
      currentVersion: "0.1.2-preview.4",
      dataDir,
      sevenZipPath: sevenZip,
      giteeApiBase: `${mockRef.baseUrl}/gitee`,
      githubApiBase: `${mockRef.baseUrl}/github-offline`,
      initialPolicy: { routePreference: "domestic", includePrerelease: true },
      retryDelaysMs: [10]
    });

    const check = await updater.checkForUpdates({ sourceOverride: "gitee" });
    assert.equal(check.recommendedAsset?.kind, "split-7z-exe");
    assert.equal(check.recommendedAsset?.totalBytes, null);

    const progressLog: UpdateDownloadProgress[] = [];
    const sseLog: UpdaterSseEventPayload[] = [];
    const unsub = updater.subscribeEvents((evt) => {
      sseLog.push(evt);
    });

    const result = await updater.downloadUpdate({
      checkResult: check,
      onProgress: (p) => {
        progressLog.push({ ...p });
      }
    });
    unsub();

    assert.equal(result.verified, true);
    assert.equal(result.sha256, expectedSha);
    assert.equal(result.totalBytes, totalArchiveBytes);
    assert.equal(headCount, 3, "Expected parallel HEAD probes for all 3 parts lacking size");

    // Verify zero null percents and strict monotonicity across the entire 0 -> 100% pipeline.
    assert.ok(progressLog.length >= 10, `Expected granular progress updates, got ${progressLog.length}`);
    for (let i = 0; i < progressLog.length; i += 1) {
      const p = progressLog[i]!;
      assert.notEqual(p.percent, null, `Progress entry #${i} (${p.stage}) must never have null percent`);
      if (i > 0) {
        const prev = progressLog[i - 1]!;
        assert.ok(
          (p.percent ?? 0) >= (prev.percent ?? 0),
          `Progress percent must be monotonic: #${i - 1}=${prev.percent} -> #${i}=${p.percent}`
        );
      }
    }

    const part1Progress = progressLog.filter((p) => p.stage === "downloading" && p.currentPart === 1 && p.bytesDownloaded > 0);
    const part2Progress = progressLog.filter((p) => p.stage === "downloading" && p.currentPart === 2 && p.bytesDownloaded > 0);
    const part3Progress = progressLog.filter((p) => p.stage === "downloading" && p.currentPart === 3 && p.bytesDownloaded > 0);
    const extractingProgress = progressLog.filter((p) => p.stage === "extracting");
    const verifyingProgress = progressLog.filter((p) => p.stage === "verifying");
    const readyProgress = progressLog.filter((p) => p.stage === "ready");

    // HEAD probe resolved exact totalArchiveBytes before part 1 chunks even started.
    assert.ok(part1Progress.length > 0 && part1Progress.every((p) => p.totalBytes === totalArchiveBytes));
    assert.ok(part1Progress.some((p) => (p.percent ?? 0) > 0 && (p.percent ?? 0) < 30));
    assert.equal(Math.max(...part1Progress.map((p) => p.percent ?? 0)), 30);

    assert.ok(part2Progress.some((p) => (p.percent ?? 0) > 30 && (p.percent ?? 0) < 60));
    assert.equal(Math.max(...part2Progress.map((p) => p.percent ?? 0)), 60);

    assert.ok(part3Progress.some((p) => (p.percent ?? 0) > 60 && (p.percent ?? 0) < 90));
    assert.equal(Math.max(...part3Progress.map((p) => p.percent ?? 0)), 90);

    assert.ok(extractingProgress.some((p) => p.percent === 90));
    assert.ok(extractingProgress.some((p) => p.percent === 95));

    assert.ok(verifyingProgress.length > 0);
    assert.ok(verifyingProgress[0]!.percent === 95);
    assert.ok(verifyingProgress.every((p) => (p.percent ?? 0) >= 95 && (p.percent ?? 0) <= 99.9));
    assert.equal(verifyingProgress[verifyingProgress.length - 1]!.percent, 99.9);

    assert.equal(readyProgress.length, 1);
    assert.equal(readyProgress[0]!.percent, 100);

    const readySse = sseLog.find((evt) => evt.type === "ready");
    assert.ok(readySse !== undefined);
    assert.equal(readySse.progress?.percent, 100);
    assert.equal(readySse.status.downloading, false);
  } finally {
    await closeMockServer(mockRef.server);
  }
});

test("AppUpdater keeps smooth monotonic 0->30->60->90->95->99.9->100% progress even when HEAD returns 405 and part 3 uses Content-Range", async () => {
  const sevenZip = resolve7zaBinary();
  assert.ok(sevenZip !== null, "Expected 7za/7z binary on Windows test host");

  const exeName = "Prismux-Setup-0.1.2-preview.5.exe";
  const exePayload = randomBytes(72 * 1024);
  const expectedSha = sha256Hex(exePayload);
  const fixture = await createSplit7zThreePartFixture(sevenZip, exeName, exePayload, "28k");
  const totalArchiveBytes = fixture.parts.reduce((sum, part) => sum + part.bytes.length, 0);

  let head405Count = 0;
  let mockRef!: { server: http.Server; baseUrl: string };
  mockRef = await startMockServer((req, res) => {
    const urlPath = req.url ?? "/";
    if (urlPath.startsWith("/gitee/repos/")) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify([
          {
            tag_name: "v0.1.2-preview.5",
            prerelease: true,
            draft: false,
            assets: [
              ...fixture.parts.map((part) => ({
                name: part.name,
                browser_download_url: `${mockRef.baseUrl}/dl/${encodeURIComponent(part.name)}`
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

    const partIdx = fixture.parts.findIndex(
      (part) => urlPath === `/dl/${encodeURIComponent(part.name)}`
    );
    if (partIdx >= 0) {
      const matchedPart = fixture.parts[partIdx]!;
      if (req.method === "HEAD") {
        head405Count += 1;
        res.statusCode = 405;
        res.end("Method Not Allowed");
        return;
      }
      if (partIdx === 2) {
        // Part 3 omits Content-Length and provides Content-Range total fallback.
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-range": `bytes 0-${matchedPart.bytes.length - 1}/${matchedPart.bytes.length}`
        });
      } else {
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": String(matchedPart.bytes.length)
        });
      }
      writeChunkedBuffer(res, matchedPart.bytes, 4 * 1024, 1);
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  try {
    const dataDir = makeTempDir("prismux-updater-head405-3part-");
    const updater = new AppUpdater({
      currentVersion: "0.1.2-preview.4",
      dataDir,
      sevenZipPath: sevenZip,
      giteeApiBase: `${mockRef.baseUrl}/gitee`,
      githubApiBase: `${mockRef.baseUrl}/github-offline`,
      initialPolicy: { routePreference: "domestic", includePrerelease: true },
      retryDelaysMs: [10]
    });

    const check = await updater.checkForUpdates({ sourceOverride: "gitee" });
    const progressLog: UpdateDownloadProgress[] = [];

    const result = await updater.downloadUpdate({
      checkResult: check,
      onProgress: (p) => {
        progressLog.push({ ...p });
      }
    });

    assert.equal(result.verified, true);
    assert.equal(result.sha256, expectedSha);
    assert.equal(head405Count, 3, "HEAD 405 must be gracefully ignored without failing download");

    for (let i = 0; i < progressLog.length; i += 1) {
      const p = progressLog[i]!;
      assert.notEqual(p.percent, null, `Progress #${i} must never fall back to null when HEAD returns 405`);
      if (i > 0) {
        assert.ok((p.percent ?? 0) >= (progressLog[i - 1]!.percent ?? 0));
      }
    }

    const p1 = progressLog.filter((p) => p.stage === "downloading" && p.currentPart === 1);
    const p2 = progressLog.filter((p) => p.stage === "downloading" && p.currentPart === 2);
    const p3 = progressLog.filter((p) => p.stage === "downloading" && p.currentPart === 3);

    assert.ok(p1.some((p) => (p.percent ?? 0) > 0 && (p.percent ?? 0) < 30));
    assert.equal(Math.max(...p1.map((p) => p.percent ?? 0)), 30);
    assert.ok(p2.some((p) => (p.percent ?? 0) > 30 && (p.percent ?? 0) < 60));
    assert.equal(Math.max(...p2.map((p) => p.percent ?? 0)), 60);
    assert.ok(p3.some((p) => (p.percent ?? 0) > 60 && (p.percent ?? 0) < 90));
    assert.equal(Math.max(...p3.map((p) => p.percent ?? 0)), 90);
    // By part 3, all 3 part sizes are known (via GET Content-Length + Content-Range) -> exact totalBytes!
    assert.ok(p3.some((p) => p.totalBytes === totalArchiveBytes));

    assert.equal(progressLog[progressLog.length - 1]?.stage, "ready");
    assert.equal(progressLog[progressLog.length - 1]?.percent, 100);
  } finally {
    await closeMockServer(mockRef.server);
  }
});

test("AppUpdater throttles high-frequency chunk SSE broadcasts while preserving real-time status and 0->90->99.9->100% single-file progression", async () => {
  // 512 KB delivered in 512 rapid 1 KB chunks -> ~512 raw chunk callbacks, throttled SSE.
  const fullPayload = randomBytes(512 * 1024);
  const expectedSha = sha256Hex(fullPayload);

  let mockRef!: { server: http.Server; baseUrl: string };
  mockRef = await startMockServer((req, res) => {
    const urlPath = req.url ?? "/";
    if (urlPath.startsWith("/repos/")) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify([
          {
            tag_name: "v0.1.2-preview.5",
            prerelease: true,
            draft: false,
            assets: [
              {
                name: "Prismux-Setup-0.1.2-preview.5.exe",
                browser_download_url: `${mockRef.baseUrl}/dl/setup.exe`
              },
              {
                name: "Prismux-Setup-0.1.2-preview.5.exe.sha256",
                browser_download_url: `${mockRef.baseUrl}/dl/setup.exe.sha256`
              }
            ]
          }
        ])
      );
      return;
    }
    if (urlPath === "/dl/setup.exe.sha256") {
      res.statusCode = 200;
      res.end(`${expectedSha}  Prismux-Setup-0.1.2-preview.5.exe\n`);
      return;
    }
    if (urlPath === "/dl/setup.exe") {
      // Omit Content-Length to also verify Content-Range total parsing on single-file download.
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-range": `bytes 0-${fullPayload.length - 1}/${fullPayload.length}`
      });
      writeChunkedBuffer(res, fullPayload, 1024, 0);
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  try {
    const dataDir = makeTempDir("prismux-updater-throttle-");
    const updater = new AppUpdater({
      currentVersion: "0.1.2-preview.4",
      dataDir,
      initialPolicy: { routePreference: "global", includePrerelease: true },
      githubApiBase: mockRef.baseUrl,
      giteeApiBase: mockRef.baseUrl,
      retryDelaysMs: [10]
    });

    const check = await updater.checkForUpdates();
    let rawChunkProgressCount = 0;
    const sseEvents: UpdaterSseEventPayload[] = [];
    const unsub = updater.subscribeEvents((evt) => {
      sseEvents.push(evt);
    });

    const result = await updater.downloadUpdate({
      checkResult: check,
      onProgress: (p) => {
        if (p.stage === "downloading") {
          rawChunkProgressCount += 1;
          // Ensure updater.getStatus().progress is updated synchronously on every chunk.
          assert.equal(updater.getStatus().progress?.bytesDownloaded, p.bytesDownloaded);
        }
      }
    });
    unsub();

    assert.equal(result.verified, true);
    assert.equal(result.sha256, expectedSha);

    const sseDownloadEvents = sseEvents.filter((evt) => evt.type === "progress");
    const sseVerifyEvents = sseEvents.filter((evt) => evt.type === "verifying");
    const sseReadyEvents = sseEvents.filter((evt) => evt.type === "ready");

    assert.ok(
      rawChunkProgressCount >= 200,
      `Expected >=200 raw chunk progress callbacks, got ${rawChunkProgressCount}`
    );
    assert.ok(
      sseDownloadEvents.length > 10 && sseDownloadEvents.length <= 120,
      `Expected throttled SSE progress events (11..120), got ${sseDownloadEvents.length} for ${rawChunkProgressCount} raw chunks`
    );
    assert.ok(
      sseDownloadEvents.length < rawChunkProgressCount / 2,
      `Expected SSE throttling to cut event volume by >50% (${sseDownloadEvents.length} vs ${rawChunkProgressCount})`
    );
    assert.equal(sseDownloadEvents[0]!.progress?.percent, 0);
    assert.equal(sseDownloadEvents[sseDownloadEvents.length - 1]!.progress?.percent, 90);
    assert.equal(
      sseDownloadEvents[sseDownloadEvents.length - 1]!.progress?.totalBytes,
      fullPayload.length
    );

    assert.ok(sseVerifyEvents.length >= 1);
    assert.ok(sseVerifyEvents[0]!.progress?.percent !== null && sseVerifyEvents[0]!.progress!.percent! >= 90);
    assert.equal(sseVerifyEvents[sseVerifyEvents.length - 1]!.progress?.percent, 99.9);

    assert.equal(sseReadyEvents.length, 1);
    assert.equal(sseReadyEvents[0]!.progress?.percent, 100);
    assert.equal(sseReadyEvents[0]!.status.downloading, false);
  } finally {
    await closeMockServer(mockRef.server);
  }
});

const REAL_V013_PREVIEW_1_GITHUB_BODY = [
  "# Prismux v0.1.3 Preview 1",
  "",
  "> 标准 SemVer / Tag：`v0.1.3-preview.1`（`0.1.3-preview.1`）。本次为大版本视觉与交互升级，**官方两大活跃插件（`qq` / `fishdock-hook`）严格保持默认零预装**（原 `pet` / `ssh` 已停用：已被 Prismux 内置功能取代），桌面安装包内不包含任何官方插件，需要时可在 **设置 → 插件中心** 或通过下方独立 `.wb-plugin` / npm 单包按需安装。",
  "",
  "## ✨ 本次核心升级亮点（v0.1.3 Preview 1）",
  "",
  "### 1. 1:1 还原 AGY 蜂群侧边栏 & 多 Agent 原生只读协作视图",
  "- **AGY 蜂群 1:1 复刻**：原生只读还原 22×18 像素蜜蜂与蜂王皇冠、概览目标/进度/工作流、公告板（`@提及` / `#序号` 跳转胶囊与未读分隔线）、成员实时活动与离场筛选，以及关系图 / 消息回放。",
  "- **多 Agent 原生适配**：同步提供 Claude Code（`~/.claude/teams`、`inboxes`、`tasks`）与 Codex（子代理协作、`goals` / `state`）原生只读协作侧边栏，不自建任何重型编排 DAG。",
  "- **按需无扰唤醒**：仅在协作状态首次从休眠切入活跃时自动弹出（历史/空闲会话绝不误弹），并在概览面板「在终端继续」正下方提供一键打开入口。",
  "",
  "### 2. `/` 斜杠命令前缀图标双语汉化 & `@对话 / @工作 Agent` 提及",
  "- **清晰双语格式**：统一按「图标 中文 小号原生英文：汉化介绍」排布（如 `🐝 蜂群 swarm：...`、`🕒 定时 schedule：...`）；技能项统一按「图标 技能 原生名：描述」展示，**个人技能严守原名不做汉化**，原生/系统自带技能完整汉化。",
  "- **折叠分层排序**：只输入 `/` 时原生 Agent 指令排在顶部，个人技能与自带技能归入同一可展开折叠项（展开后先列「个人技能」，再列「自带技能」）。",
  "- **增强 `@` 提及**：空 `@` 与中文关键词均可直接召出 `@对话`、`@工作 Agent`、`@主机` 与 `@文件`。",
  "",
  "### 3. 侧栏液态玻璃卡片、RGB 呼吸态、AGY 胶囊气泡 & Orca 详细配额",
  "- **高对比四边液态玻璃卡片**：全面补全侧栏会话卡片四边玻璃质感与对比度（`刚刚`、Agent Logo、项目名与主机名在复杂壁纸下均清晰可读），移除前置状态圆点；活跃执行中的会话呈现旋转 RGB 跑马灯边环与呼吸 Agent Logo，空闲态静默优雅。",
  "- **AGY 扁平大圆角胶囊气泡**：用户消息采用扁平大圆角胶囊设计，在浅色液态玻璃与深色液态玻璃下呈现清晰视觉区隔。",
  "- **底部 20px 状态栏详细配额联动**：底部配额胶囊与浮窗 `详细 / 精简` 模式完全同步，一屏尽览多窗口百分比与迷你进度条。",
  "",
  "### 4. 空白新会话硬单例、概览面板解耦防遮挡 & 壁纸侧栏精简",
  "- **空白新会话硬单例**：同一工作区最多仅保留 1 个未发送消息的空白草稿标签，支持原位切换 Agent，点击新建或切换标签绝不再连弹多个重复空白会话。",
  "- **概览面板独立悬浮与动态限高**：右侧「概览」与底部居中对话框彻底解耦（对话框不再左偏），强制保障底部 ≥ 28px 留白，默认隐藏已完成/已结束项，并随窗口/全屏高度自动调整每区显示条数上限（支持右上角 `⋮` 手动定制）。",
  "- **壁纸侧边栏精简与永久去重**：删除「壁纸属性」按钮、底部重复「外观与玻璃」按钮、壁纸页重复声音控制以及 4 张合成场景壁纸；导入本地图片按文件大小 + SHA-256 永久去重，仅保留唯一副本。",
  "",
  "### 5. 宿主机时区自动语言识别、全宽无白框天体胶囊 & 升级/体检重设计",
  "- **时区自动语言切换**：首次启动默认读取宿主机 IANA 时区，在已支持的 10 种语言中自动切换（中国时区即刻直达全中文 `/welcome` 欢迎页）；一旦用户手动切换语言后，后续永不覆盖用户选择。",
  "- **全宽无白框天体三态胶囊**：`/welcome` 天体三态胶囊拉满全宽对齐右侧边缘，并彻底移除点击玻璃态时右侧 1/3 出现刺眼白框的焦点描边。",
  "- **分卷加权下载进度条 & 四级液态玻璃服务体检**：Gitee 3 段分卷下载按 `3×30% + 5% 解压 + 5% 校验 = 100%` 实时流式推送进度与 MB/s 速率，彻底根治进度条卡死前半段；服务体检中心升级为四级液态玻璃卡片与翡翠绿混合记忆引擎横幅。",
  "",
  "## 📦 下载指南（Windows x64 · 零预装插件）",
  "",
  "| 资产文件 | 用途说明 | SHA-256 |",
  "| :--- | :--- | :--- |",
  "| **`Prismux-Setup-0.1.3-preview.1-win-x64.exe`**（208.39 MB） | Electron 44 Windows x64 安装包（**官方插件零预装**） | `9498ae63f670e28acef5143ea3533b53d07c2bfdbfe584f5910a75475c71f8c0` |",
  "",
  "> 中国大陆用户亦可前往 **[Gitee Releases (`v0.1.3-preview.1`)](https://gitee.com/Fish-under-sea/Prismux/releases/tag/v0.1.3-preview.1)** 获取高速 80 MB 无损分卷（`.7z.001..003`）及软件内置直连自动更新。"
].join("\r\n");

const REAL_V013_PREVIEW_1_GITEE_BODY = [
  REAL_V013_PREVIEW_1_GITHUB_BODY.replace(/\r\n/g, "\n"),
  "",
  "### Gitee 80 MB 无损分卷还原说明",
  "",
  "| 分卷文件名 | 用途 | SHA-256 |",
  "| :--- | :--- | :--- |",
  "| `Prismux-Setup-0.1.3-preview.1-win-x64.exe.7z.001`（80.00 MB） | Gitee 80 MB 无损分卷 | `e7015543916680df151af36cf83e0a9c0d82d752509ba2cb6ae2d7e2023b1f6b` |",
  "| `Prismux-Setup-0.1.3-preview.1-win-x64.exe.7z.002`（80.00 MB） | Gitee 80 MB 无损分卷 | `7442efafa4b0701158a1cedd372b9258c61efedd3f8adcdad783f1d5d525133f` |",
  "| `Prismux-Setup-0.1.3-preview.1-win-x64.exe.7z.003`（48.39 MB） | Gitee 80 MB 无损分卷 | `1c3e760a844dc57e163ecbf3cc7b2e88fa220b4efa3895638efdb4969d216a93` |",
  "",
  "```powershell",
  "# 下载全部 .7z.001..003 至同一目录后执行无损合并（只需指定 .001）：",
  "7z x Prismux-Setup-0.1.3-preview.1-win-x64.exe.7z.001",
  "(Get-FileHash .\\Prismux-Setup-0.1.3-preview.1-win-x64.exe -Algorithm SHA256).Hash.ToLower()",
  "# 期望值: 9498ae63f670e28acef5143ea3533b53d07c2bfdbfe584f5910a75475c71f8c0",
  "```"
].join("\n");

function escapeForGiteeTextarea(markdown: string): string {
  return markdown
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\n", "&#x000A;");
}

test("AppUpdater preserves full v0.1.3-preview.1 releaseNotes across GitHub API, Gitee API, and Gitee 403 Web HTML fallback", async () => {
  // 1. normalizeReleaseNotesBody strips BOM/CRLF and preserves up to 24 KB without short truncation
  const largeNotes = `${"✨ 更新条目\n".repeat(2500)}结尾验证`;
  assert.ok(largeNotes.length > 16_000 && largeNotes.length < MAX_RELEASE_NOTES_CHARS);
  assert.equal(normalizeReleaseNotesBody(`\uFEFF${largeNotes.replaceAll("\n", "\r\n")}`), largeNotes);

  const oversized = "a".repeat(MAX_RELEASE_NOTES_CHARS + 500);
  assert.equal(normalizeReleaseNotesBody(oversized)?.length, MAX_RELEASE_NOTES_CHARS);
  assert.equal(normalizeReleaseNotesBody("   \r\n  "), null);

  // 2. parseGiteeWebReleasesHtml extracts full Markdown body, title, timestamp, and split assets from real Gitee HTML
  const giteeReleasesHtml = `
    <html><body>
      <div class='release-tag-item' data-tag='v0.1.3-preview.1' id='release-v0.1.3-preview.1'>
        <div class='release-body'>
          <div class='release-header'>
            <div class='release-header-main'>
              <a target="_blank" class="title" href="/Fish-under-sea/Prismux/releases/tag/v0.1.3-preview.1">Prismux v0.1.3 Preview 1</a>
            </div>
          </div>
          <div class='release-meta-row'>
            <span class='release-time' data-commit-date='2026-11-24 18:05:24 +0800'>2026-11-24 18:11</span>
            <span class='tag-name' data-tag-name='v0.1.3-preview.1'>
              <a href="/Fish-under-sea/Prismux/tree/v0.1.3-preview.1"><span>v0.1.3-preview.1</span></a>
            </span>
          </div>
          <div class='content'>
            <div class='markdown-body'>
              <rich-markdown-renderer data-enterprise-id='' data-project-id='51687511'>&#x000A;<textarea class='content' style='display:none;'>${escapeForGiteeTextarea(REAL_V013_PREVIEW_1_GITEE_BODY)}</textarea></rich-markdown-renderer>
            </div>
          </div>
          <div class='release-attachments'>
            <a href="/Fish-under-sea/Prismux/releases/download/v0.1.3-preview.1/Prismux-Setup-0.1.3-preview.1-win-x64.exe.7z.001">part1</a>
            <a href="/Fish-under-sea/Prismux/releases/download/v0.1.3-preview.1/Prismux-Setup-0.1.3-preview.1-win-x64.exe.7z.002">part2</a>
            <a href="/Fish-under-sea/Prismux/releases/download/v0.1.3-preview.1/Prismux-Setup-0.1.3-preview.1-win-x64.exe.7z.003">part3</a>
            <a href="/Fish-under-sea/Prismux/releases/download/v0.1.3-preview.1/Prismux-0.1.3-preview.1-SHA256SUMS.txt">sums</a>
          </div>
        </div>
      </div>
    </body></html>
  `;

  const parsedWeb = parseGiteeWebReleasesHtml(
    giteeReleasesHtml,
    "https://gitee.com",
    "Fish-under-sea",
    "Prismux"
  );
  assert.equal(parsedWeb.length, 1);
  assert.equal(parsedWeb[0]!.tag_name, "v0.1.3-preview.1");
  assert.equal(parsedWeb[0]!.name, "Prismux v0.1.3 Preview 1");
  assert.equal(parsedWeb[0]!.published_at, "2026-11-24T10:05:24.000Z");
  assert.equal(parsedWeb[0]!.body, REAL_V013_PREVIEW_1_GITEE_BODY);
  assert.equal(
    extractGiteeReleaseBodyFromHtml(
      "<rich-markdown-renderer><textarea class='content'>&amp;lt;safe&amp;gt;</textarea></rich-markdown-renderer>"
    ),
    "&lt;safe&gt;"
  );

  // 3. End-to-end checkForUpdates across GitHub API, Gitee API 200, Gitee 403 -> Web index HTML,
  //    and Gitee 403 -> index HTML omitting textarea -> tag detail page fallback.
  const exeSha = "9498ae63f670e28acef5143ea3533b53d07c2bfdbfe584f5910a75475c71f8c0";
  let giteeMode: "api-200" | "web-index" | "web-tag-fallback" = "api-200";
  let tagDetailHits = 0;

  let mockRef!: { server: http.Server; baseUrl: string };
  mockRef = await startMockServer((req, res) => {
    const urlPath = req.url ?? "/";
    if (urlPath.startsWith("/gh-api/repos/")) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify([
          {
            tag_name: "v0.1.3-preview.1",
            name: "Prismux v0.1.3 Preview 1",
            body: `\uFEFF${REAL_V013_PREVIEW_1_GITHUB_BODY}`,
            prerelease: true,
            draft: false,
            published_at: "2026-11-24T10:11:00Z",
            assets: [
              {
                name: "Prismux-Setup-0.1.3-preview.1-win-x64.exe",
                browser_download_url: `${mockRef.baseUrl}/dl/setup.exe`,
                size: 218_510_000
              },
              {
                name: "Prismux-0.1.3-preview.1-SHA256SUMS.txt",
                browser_download_url: `${mockRef.baseUrl}/dl/SHA256SUMS.txt`
              }
            ]
          }
        ])
      );
      return;
    }

    if (urlPath.startsWith("/gitee-api/repos/")) {
      if (giteeMode === "api-200") {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify([
            {
              tag_name: "v0.1.3-preview.1",
              name: "Prismux v0.1.3 Preview 1",
              body: REAL_V013_PREVIEW_1_GITEE_BODY,
              prerelease: true,
              created_at: "2026-11-24T18:11:00+08:00",
              assets: [
                {
                  name: "Prismux-Setup-0.1.3-preview.1-win-x64.exe.7z.001",
                  browser_download_url: `${mockRef.baseUrl}/dl/part1`
                },
                {
                  name: "Prismux-0.1.3-preview.1-SHA256SUMS.txt",
                  browser_download_url: `${mockRef.baseUrl}/dl/SHA256SUMS.txt`
                }
              ]
            }
          ])
        );
        return;
      }
      res.statusCode = 403;
      res.setHeader("content-type", "text/plain");
      res.end("403 Forbidden (Rate Limit Exceeded)");
      return;
    }

    if (urlPath === "/gitee-web/Fish-under-sea/Prismux/releases") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      if (giteeMode === "web-index") {
        res.end(giteeReleasesHtml);
      } else {
        // Index page without embedded textarea -> triggers tag page fallback
        res.end(`
          <html><body>
            <a href="/Fish-under-sea/Prismux/releases/tag/v0.1.3-preview.1">Prismux v0.1.3 Preview 1</a>
            <a href="/Fish-under-sea/Prismux/releases/download/v0.1.3-preview.1/Prismux-Setup-0.1.3-preview.1-win-x64.exe.7z.001">part1</a>
            <a href="/Fish-under-sea/Prismux/releases/download/v0.1.3-preview.1/Prismux-0.1.3-preview.1-SHA256SUMS.txt">sums</a>
          </body></html>
        `);
      }
      return;
    }

    if (urlPath === "/gitee-web/Fish-under-sea/Prismux/releases/tag/v0.1.3-preview.1") {
      tagDetailHits += 1;
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(`
        <html><body>
          <rich-markdown-renderer><textarea class='content' style='display:none;'>${escapeForGiteeTextarea(REAL_V013_PREVIEW_1_GITEE_BODY)}</textarea></rich-markdown-renderer>
        </body></html>
      `);
      return;
    }

    if (
      urlPath === "/dl/SHA256SUMS.txt" ||
      urlPath === "/gitee-web/Fish-under-sea/Prismux/releases/download/v0.1.3-preview.1/Prismux-0.1.3-preview.1-SHA256SUMS.txt"
    ) {
      res.statusCode = 200;
      res.end(`${exeSha}  Prismux-Setup-0.1.3-preview.1-win-x64.exe\n`);
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  try {
    const updater = new AppUpdater({
      currentVersion: "0.1.2-preview.4",
      dataDir: makeTempDir("prismux-updater-notes-"),
      githubApiBase: `${mockRef.baseUrl}/gh-api`,
      giteeApiBase: `${mockRef.baseUrl}/gitee-api`,
      giteeWebBase: `${mockRef.baseUrl}/gitee-web`,
      initialPolicy: { routePreference: "global", includePrerelease: true }
    });

    const assertAllFiveHighlightsPresent = (notes: string | null, label: string) => {
      assert.ok(notes !== null && notes.length > 2_400, `${label}: expected full unchopped notes`);
      assert.ok(!notes.includes("\r"), `${label}: CRLF must be normalized to LF`);
      assert.ok(!notes.startsWith("\uFEFF"), `${label}: BOM must be stripped`);
      assert.ok(notes.includes("## ✨ 本次核心升级亮点（v0.1.3 Preview 1）"), label);
      assert.ok(notes.includes("### 1. 1:1 还原 AGY 蜂群侧边栏 & 多 Agent 原生只读协作视图"), label);
      assert.ok(notes.includes("### 2. `/` 斜杠命令前缀图标双语汉化 & `@对话 / @工作 Agent` 提及"), label);
      assert.ok(notes.includes("### 3. 侧栏液态玻璃卡片、RGB 呼吸态、AGY 胶囊气泡 & Orca 详细配额"), label);
      assert.ok(notes.includes("### 4. 空白新会话硬单例、概览面板解耦防遮挡 & 壁纸侧栏精简"), label);
      assert.ok(notes.includes("### 5. 宿主机时区自动语言识别、全宽无白框天体胶囊 & 升级/体检重设计"), label);
    };

    // GitHub API
    const ghCheck = await updater.checkForUpdates({ sourceOverride: "github" });
    assert.equal(ghCheck.releaseName, "Prismux v0.1.3 Preview 1");
    assertAllFiveHighlightsPresent(ghCheck.releaseNotes, "GitHub API");

    // Gitee API 200
    giteeMode = "api-200";
    const giteeApiCheck = await updater.checkForUpdates({ sourceOverride: "gitee" });
    assertAllFiveHighlightsPresent(giteeApiCheck.releaseNotes, "Gitee API 200");

    // Gitee 403 -> Web releases index HTML (exact live condition that previously yielded releaseNotes: null!)
    giteeMode = "web-index";
    tagDetailHits = 0;
    const giteeWebCheck = await updater.checkForUpdates({ sourceOverride: "gitee" });
    assert.equal(giteeWebCheck.releaseName, "Prismux v0.1.3 Preview 1");
    assert.equal(giteeWebCheck.publishedAt, "2026-11-24T10:05:24.000Z");
    assert.equal(tagDetailHits, 0, "Inline textarea on /releases avoids extra tag-page fetch");
    assertAllFiveHighlightsPresent(giteeWebCheck.releaseNotes, "Gitee 403 Web HTML");

    // Gitee 403 -> Web index omits textarea -> tag detail page fallback recovers full releaseNotes
    giteeMode = "web-tag-fallback";
    tagDetailHits = 0;
    const giteeTagFallbackCheck = await updater.checkForUpdates({ sourceOverride: "gitee" });
    assert.equal(tagDetailHits, 1, "Expected tag detail page fallback fetch when index omits body");
    assertAllFiveHighlightsPresent(giteeTagFallbackCheck.releaseNotes, "Gitee tag detail fallback");
  } finally {
    await closeMockServer(mockRef.server);
  }
});
