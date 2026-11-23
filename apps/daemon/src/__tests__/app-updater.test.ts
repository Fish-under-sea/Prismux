import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync
} from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { compareSemver } from "@prismux/cordis-kernel";
import { DEFAULT_UPDATE_POLICY, type UpdaterStatusSnapshot } from "@prismux/protocol";
import { PrismuxDaemon } from "../index.js";
import {
  AppUpdater,
  UpdateIntegrityError,
  applyGhProxyPrefix
} from "../updater/AppUpdater.js";

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

test("PrismuxDaemon integrates AppUpdater with 0.1.0-alpha.3 default and exposes HTTP & RPC updater endpoints", async () => {
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
    assert.equal(statusJson.currentVersion, "0.1.0-alpha.3");
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
