import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { UPDATE_ENDPOINTS } from "@prismux/protocol";
import {
  CordisStreamingInstaller,
  PermissionAuditRequiredError,
  probePluginRegistries,
  resolveRegistryOrder
} from "../index.js";

function createTestUstarArchive(
  entries: ReadonlyArray<{ path: string; content: string }>
): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content, "utf8");
    const header = Buffer.alloc(512, 0);
    Buffer.from(entry.path, "utf8").copy(header, 0, 0, 100);
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

    let checksum = 0;
    for (let i = 0; i < 512; i += 1) {
      checksum += header[i] ?? 0;
    }
    Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `, "ascii").copy(
      header,
      148
    );

    blocks.push(header, content);
    const rem = content.length % 512;
    if (rem !== 0) {
      blocks.push(Buffer.alloc(512 - rem, 0));
    }
  }
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

function createPluginTarball(pkgName: string, id: string, modelVisible = false): {
  tarball: Buffer;
  sha256: string;
} {
  const tar = createTestUstarArchive([
    {
      path: "package/package.json",
      content: JSON.stringify({
        name: pkgName,
        version: "0.0.1-alpha.1",
        engines: { prismux: ">=0.0.1-0 <2.0.0" },
        scripts: {
          postinstall: "node -e \"process.exit(1)\""
        }
      })
    },
    {
      path: "package/plugin.manifest.json",
      content: JSON.stringify({
        id,
        version: "0.0.1-alpha.1",
        realms: ["daemon"],
        permissions: ["hooks:subscribe"],
        modelVisible
      })
    },
    {
      path: "package/dist/index.js",
      content: "export function apply() {}\n"
    }
  ]);
  const tarball = gzipSync(tar);
  return {
    tarball,
    sha256: createHash("sha256").update(tarball).digest("hex")
  };
}

async function startHttpServer(
  handler: http.RequestListener
): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const addr = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

async function closeHttpServer(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((err) => {
      if (err) rejectPromise(err);
      else resolvePromise();
    });
  });
}

test("resolveRegistryOrder orders npmjs and npmmirror according to auto/domestic/global", () => {
  const domestic = resolveRegistryOrder("domestic");
  assert.equal(domestic.primary, UPDATE_ENDPOINTS.npmMirrorRegistry);
  assert.equal(domestic.fallback, UPDATE_ENDPOINTS.npmRegistry);
  assert.deepEqual(domestic.order, [
    UPDATE_ENDPOINTS.npmMirrorRegistry,
    UPDATE_ENDPOINTS.npmRegistry
  ]);

  const global = resolveRegistryOrder("global");
  assert.equal(global.primary, UPDATE_ENDPOINTS.npmRegistry);
  assert.equal(global.fallback, UPDATE_ENDPOINTS.npmMirrorRegistry);
  assert.deepEqual(global.order, [
    UPDATE_ENDPOINTS.npmRegistry,
    UPDATE_ENDPOINTS.npmMirrorRegistry
  ]);

  const autoStatic = resolveRegistryOrder("auto");
  assert.deepEqual(autoStatic.order, [
    UPDATE_ENDPOINTS.npmRegistry,
    UPDATE_ENDPOINTS.npmMirrorRegistry
  ]);

  const customDomestic = resolveRegistryOrder(
    "domestic",
    "http://127.0.0.1:4100/",
    "http://127.0.0.1:4200/"
  );
  assert.deepEqual(customDomestic.order, [
    "http://127.0.0.1:4200",
    "http://127.0.0.1:4100"
  ]);
});

test("probePluginRegistries selects fastest reachable registry and falls back on unhealthy mirror", async () => {
  const slowNpmjs = await startHttpServer((req, res) => {
    if (req.url === "/") {
      setTimeout(() => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ db_name: "npmjs-mock" }));
      }, 90);
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  const fastMirror = await startHttpServer((req, res) => {
    if (req.url === "/") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ db_name: "npmmirror-mock" }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  const failingNpmjs = await startHttpServer((_req, res) => {
    res.statusCode = 503;
    res.end("down");
  });

  try {
    const fastReport = await probePluginRegistries({
      npmRegistryUrl: slowNpmjs.baseUrl,
      npmMirrorRegistryUrl: fastMirror.baseUrl,
      timeoutMs: 2_000,
      allowInsecureLoopbackForTesting: true
    });
    assert.equal(fastReport.recommendedRegistryId, "npmmirror");
    assert.equal(fastReport.recommendedUrl, fastMirror.baseUrl);
    assert.equal(fastReport.fallbackUrl, slowNpmjs.baseUrl);
    assert.deepEqual(fastReport.order, [fastMirror.baseUrl, slowNpmjs.baseUrl]);

    const healthyNpmReport = await probePluginRegistries({
      npmRegistryUrl: slowNpmjs.baseUrl,
      npmMirrorRegistryUrl: failingNpmjs.baseUrl,
      timeoutMs: 2_000,
      allowInsecureLoopbackForTesting: true
    });
    assert.equal(healthyNpmReport.recommendedRegistryId, "npmjs");
    assert.equal(healthyNpmReport.recommendedUrl, slowNpmjs.baseUrl);
    assert.equal(healthyNpmReport.fallbackUrl, failingNpmjs.baseUrl);
  } finally {
    await closeHttpServer(slowNpmjs.server);
    await closeHttpServer(fastMirror.server);
    await closeHttpServer(failingNpmjs.server);
  }
});

test("installFromNpm honors auto/domestic/global preference and falls back on 404 or 5xx while preserving security gates", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "prismux-dual-registry-"));
  const pluginsDir = join(workDir, "plugins");

  const pkg = createPluginTarball("prismux-plugin-mirror-demo", "mirror-demo", false);
  const riskyPkg = createPluginTarball("prismux-plugin-risky-mirror", "risky-mirror", true);
  const pkgSri = `sha512-${createHash("sha512").update(pkg.tarball).digest("base64")}`;
  const riskyPkgSri = `sha512-${createHash("sha512").update(riskyPkg.tarball).digest("base64")}`;

  let npmjsHits = 0;
  let npmmirrorHits = 0;
  let npmjsMode: "ok" | "404" | "slow" = "ok";
  let mirrorMode: "ok" | "503" = "ok";

  const npmjsServer = await startHttpServer((req, res) => {
    npmjsHits += 1;
    const urlPath = req.url ?? "/";
    if (urlPath === "/") {
      const delay = npmjsMode === "slow" ? 80 : 0;
      setTimeout(() => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      }, delay);
      return;
    }
    if (npmjsMode === "404") {
      res.statusCode = 404;
      res.end("Not Found on npmjs");
      return;
    }
    if (urlPath === "/prismux-plugin-mirror-demo") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          name: "prismux-plugin-mirror-demo",
          "dist-tags": { latest: "0.0.1-alpha.1" },
          versions: {
            "0.0.1-alpha.1": {
              version: "0.0.1-alpha.1",
              engines: { prismux: ">=0.0.1-0 <2.0.0" },
              dist: {
                tarball: `${npmjsServer.baseUrl}/tar/demo.tgz`,
                integrity: pkgSri
              }
            }
          }
        })
      );
      return;
    }
    if (urlPath === "/tar/demo.tgz") {
      res.statusCode = 200;
      res.end(pkg.tarball);
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  const npmmirrorServer = await startHttpServer((req, res) => {
    npmmirrorHits += 1;
    const urlPath = req.url ?? "/";
    if (urlPath === "/") {
      res.statusCode = mirrorMode === "503" ? 503 : 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: mirrorMode !== "503" }));
      return;
    }
    if (mirrorMode === "503") {
      res.statusCode = 503;
      res.end("npmmirror overloaded");
      return;
    }
    if (urlPath === "/prismux-plugin-mirror-demo") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          name: "prismux-plugin-mirror-demo",
          "dist-tags": { latest: "0.0.1-alpha.1" },
          versions: {
            "0.0.1-alpha.1": {
              version: "0.0.1-alpha.1",
              engines: { prismux: ">=0.0.1-0 <2.0.0" },
              dist: {
                tarball: `${npmmirrorServer.baseUrl}/tar/demo.tgz`,
                integrity: pkgSri
              }
            }
          }
        })
      );
      return;
    }
    if (urlPath === "/tar/demo.tgz") {
      res.statusCode = 200;
      res.end(pkg.tarball);
      return;
    }
    if (urlPath === "/prismux-plugin-risky-mirror") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          name: "prismux-plugin-risky-mirror",
          "dist-tags": { latest: "0.0.1-alpha.1" },
          versions: {
            "0.0.1-alpha.1": {
              version: "0.0.1-alpha.1",
              engines: { prismux: ">=0.0.1-0 <2.0.0" },
              dist: {
                tarball: `${npmmirrorServer.baseUrl}/tar/risky.tgz`,
                integrity: riskyPkgSri
              }
            }
          }
        })
      );
      return;
    }
    if (urlPath === "/tar/risky.tgz") {
      res.statusCode = 200;
      res.end(riskyPkg.tarball);
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  try {
    const installer = new CordisStreamingInstaller({
      pluginsDir,
      hostVersion: "0.0.1-alpha.1",
      defaultRegistryUrl: npmjsServer.baseUrl,
      defaultFallbackRegistryUrl: npmmirrorServer.baseUrl,
      allowInsecureLoopbackForTesting: true
    });

    // 1. domestic hits npmmirror directly without touching npmjs
    npmjsHits = 0;
    npmmirrorHits = 0;
    const domesticRes = await installer.installFromNpm({
      packageNameOrTarball: "prismux-plugin-mirror-demo",
      networkPreference: "domestic",
      expectedSha256: pkg.sha256,
      ignoreScripts: true,
      distribution: "managed",
      confirmedAudit: true
    });
    assert.equal(domesticRes.registryUsed, npmmirrorServer.baseUrl);
    assert.equal(domesticRes.usedFallbackRegistry, false);
    assert.equal(npmjsHits, 0);
    assert.ok(npmmirrorHits >= 2);
    assert.deepEqual(domesticRes.ignoredInstallScripts, ["postinstall"]);

    // 2. domestic falls back to npmjs when npmmirror returns 503
    mirrorMode = "503";
    npmjsMode = "ok";
    npmjsHits = 0;
    npmmirrorHits = 0;
    const domesticFallbackRes = await installer.installFromNpm({
      packageNameOrTarball: "prismux-plugin-mirror-demo",
      networkPreference: "domestic",
      expectedSha256: pkg.sha256,
      ignoreScripts: true,
      distribution: "managed",
      confirmedAudit: true
    });
    assert.equal(domesticFallbackRes.registryUsed, npmjsServer.baseUrl);
    assert.equal(domesticFallbackRes.usedFallbackRegistry, true);
    assert.ok(npmmirrorHits >= 1);
    assert.ok(npmjsHits >= 2);

    // 3. global hits npmjs first and falls back to npmmirror on 404
    mirrorMode = "ok";
    npmjsMode = "404";
    npmjsHits = 0;
    npmmirrorHits = 0;
    const globalFallbackRes = await installer.installFromNpm({
      packageNameOrTarball: "prismux-plugin-mirror-demo",
      networkPreference: "global",
      expectedSha256: pkg.sha256,
      ignoreScripts: true,
      distribution: "managed",
      confirmedAudit: true
    });
    assert.equal(globalFallbackRes.registryUsed, npmmirrorServer.baseUrl);
    assert.equal(globalFallbackRes.usedFallbackRegistry, true);
    assert.ok(npmjsHits >= 1);
    assert.ok(npmmirrorHits >= 2);

    // 4. auto probes both and selects faster healthy npmmirror as primary
    npmjsMode = "slow";
    mirrorMode = "ok";
    const autoRes = await installer.installFromNpm({
      packageNameOrTarball: "prismux-plugin-mirror-demo",
      networkPreference: "auto",
      expectedSha256: pkg.sha256,
      ignoreScripts: true,
      distribution: "managed",
      confirmedAudit: true
    });
    assert.equal(autoRes.registryUsed, npmmirrorServer.baseUrl);
    assert.equal(autoRes.usedFallbackRegistry, false);

    // 5. Security audit gate for modelVisible=true still blocks even under domestic mirror
    await assert.rejects(
      () =>
        installer.installFromNpm({
          packageNameOrTarball: "prismux-plugin-risky-mirror",
          networkPreference: "domestic",
          ignoreScripts: true,
          distribution: "managed"
        }),
      PermissionAuditRequiredError
    );
    assert.equal(existsSync(join(pluginsDir, "risky-mirror")), false);
  } finally {
    await closeHttpServer(npmjsServer.server);
    await closeHttpServer(npmmirrorServer.server);
    rmSync(workDir, { recursive: true, force: true });
  }
});
