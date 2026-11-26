import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { PrismuxDaemon } from "../index.js";

const tempDirs: string[] = [];
const cleanups: Array<() => Promise<void> | void> = [];

after(async () => {
  for (const fn of cleanups.reverse()) {
    try {
      await fn();
    } catch {
      // Best-effort cleanup
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

function findRepoRoot(startDir: string): string {
  let cursor = resolve(startDir);
  while (true) {
    if (existsSync(join(cursor, "plugins-official", "catalog", "official.json"))) {
      return cursor;
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      throw new Error("Unable to locate Prismux monorepo root.");
    }
    cursor = parent;
  }
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

async function startLocalServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const port = (server.address() as AddressInfo).port;
  cleanups.push(
    () =>
      new Promise<void>((resolveClose) => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      })
  );
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function packRealPlugin(repoRoot: string, pluginId: string, outDir: string): {
  bytes: Buffer;
  sha256: string;
  filename: string;
  version: string;
} {
  const packScript = join(repoRoot, "scripts", "pack-plugin.ts");
  const pluginDir = join(repoRoot, "plugins-official", `plugin-${pluginId}`);
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const stdout = execFileSync(
    process.execPath,
    [packScript, "--plugin", pluginDir, "--out", outDir, "--json"],
    { cwd: repoRoot, env, encoding: "utf8" }
  );
  const meta = JSON.parse(stdout) as {
    archivePath: string;
    sha256: string;
    version: string;
  };
  const bytes = readFileSync(meta.archivePath);
  return {
    bytes,
    sha256: meta.sha256,
    filename: `prismux-plugin-${pluginId}-${meta.version}.wb-plugin`,
    version: meta.version
  };
}

test("E2E plugin install: GitHub 404 -> Gitee release fallback, npm wrapper fallback, tamper rejection, retired pet/ssh/fishdock-hook 410, local .wb-plugin + rollback + restart hydration", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(here);
  const workDir = mkdtempSync(join(tmpdir(), "prismux-plugin-e2e-"));
  tempDirs.push(workDir);

  const packedDir = join(workDir, "packed");
  const dataDir = join(workDir, "daemon-data");
  const isolatedCatalogDir = join(workDir, "catalog-only");
  mkdirSync(packedDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(isolatedCatalogDir, { recursive: true });

  const qqPack = packRealPlugin(repoRoot, "qq", packedDir);

  // Copy official.json to an isolated directory without plugins-official/dist so local cache is guaranteed empty
  const repoCatalogRaw = readFileSync(
    join(repoRoot, "plugins-official", "catalog", "official.json"),
    "utf8"
  );
  const isolatedCatalogPath = join(isolatedCatalogDir, "official.json");
  writeFileSync(isolatedCatalogPath, repoCatalogRaw, "utf8");

  // Build an npm wrapper tarball for qq matching scripts/build-npm-plugin-packages.ts
  const qqManifestRaw = readFileSync(
    join(repoRoot, "plugins-official", "plugin-qq", "plugin.manifest.json"),
    "utf8"
  );
  const qqNpmWrapper = buildDeterministicTgz({
    "package/package.json": JSON.stringify({
      name: "prismux-plugin-qq",
      version: qqPack.version,
      type: "module",
      bin: { "prismux-plugin-qq": "bin/install.mjs" },
      engines: { prismux: ">=0.1.0-0 <2.0.0" },
      scripts: { postinstall: "exit 1" }
    }),
    "package/plugin.manifest.json": qqManifestRaw,
    [`package/${qqPack.filename}`]: qqPack.bytes
  });
  const qqNpmSha512 = `sha512-${createHash("sha512").update(qqNpmWrapper).digest("base64")}`;

  let tamperQqOnGithub = false;
  let serveQqOnGitee = true;
  const requestedPaths: string[] = [];

  // Mock GitHub Release server: returns 404 normally (or tampered gzip when tamperQqOnGithub=true)
  const mockGithub = await startLocalServer((req, res) => {
    requestedPaths.push(`github:${req.url}`);
    if (tamperQqOnGithub && req.url?.includes("qq")) {
      const corrupted = Buffer.from(qqPack.bytes);
      corrupted[corrupted.byteLength - 1] = (corrupted[corrupted.byteLength - 1]! ^ 0xff) & 0xff;
      res.writeHead(200, { "content-type": "application/gzip" });
      res.end(corrupted);
      return;
    }
    res.writeHead(404);
    res.end("Not Found");
  });

  // Mock Gitee Release server: serves real qq .wb-plugin when serveQqOnGitee=true, 404 otherwise
  const mockGitee = await startLocalServer((req, res) => {
    requestedPaths.push(`gitee:${req.url}`);
    if (!tamperQqOnGithub && serveQqOnGitee && req.url?.endsWith(`/${qqPack.filename}`)) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(qqPack.bytes);
      return;
    }
    res.writeHead(404);
    res.end("Not Found");
  });

  // Mock npm Registry server: serves wrapper package for qq when both GitHub and Gitee return 404
  const mockNpm = await startLocalServer((req, res) => {
    requestedPaths.push(`npm:${req.url}`);
    if (req.url === "/prismux-plugin-qq") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          name: "prismux-plugin-qq",
          "dist-tags": { latest: qqPack.version },
          versions: {
            [qqPack.version]: {
              version: qqPack.version,
              engines: { prismux: ">=0.1.0-0 <2.0.0" },
              dist: {
                tarball: `${mockNpm.baseUrl}/tarballs/prismux-plugin-qq.tgz`,
                integrity: qqNpmSha512
              }
            }
          }
        })
      );
      return;
    }
    if (req.url === "/tarballs/prismux-plugin-qq.tgz") {
      res.writeHead(200, { "content-type": "application/gzip" });
      res.end(qqNpmWrapper);
      return;
    }
    res.writeHead(404);
    res.end("Not Found");
  });

  const authToken = "e2e-plugin-owner-token";
  const createDaemon = () =>
    new PrismuxDaemon({
      headless: true,
      host: "127.0.0.1",
      port: 0,
      dataDir,
      authToken,
      hostVersion: "0.1.2-preview.2",
      officialCatalogPath: isolatedCatalogPath,
      officialPluginSources: {
        githubWebBase: mockGithub.baseUrl,
        giteeWebBase: mockGitee.baseUrl,
        npmRegistryUrl: mockNpm.baseUrl,
        npmMirrorRegistryUrl: mockNpm.baseUrl,
        timeoutMs: 5_000
      }
    });

  const daemon = createDaemon();
  cleanups.push(() => daemon.stop());
  const ready = await daemon.start();
  const authHeaders = {
    Authorization: `Bearer ${authToken}`,
    "content-type": "application/json"
  };

  // 1. Catalog exposes 1 active plugin (qq) + retired pet/ssh/fishdock-hook notices, 0 preinstalled
  const catRes = await fetch(`${ready.httpUrl}/v1/plugins/catalog`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assert.equal(catRes.status, 200);
  const catalogBody = (await catRes.json()) as {
    plugins: Array<{ id: string; installed: boolean }>;
    retiredPlugins: Array<{
      id: string;
      status: string;
      replacedByBuiltin: boolean;
      noticeZh: string;
    }>;
  };
  assert.deepEqual(
    catalogBody.plugins.map((p) => p.id).sort(),
    ["qq"]
  );
  assert.equal(catalogBody.plugins.every((p) => p.installed === false), true);
  assert.deepEqual(
    catalogBody.retiredPlugins.map((r) => r.id).sort(),
    ["fishdock-hook", "pet", "ssh"]
  );
  for (const retired of catalogBody.retiredPlugins) {
    assert.equal(retired.status, "deprecated");
    assert.equal(retired.replacedByBuiltin, retired.id !== "fishdock-hook");
    assert.match(retired.noticeZh, /已停用/);
  }

  // 2. Attempting to install retired pet, ssh, or fishdock-hook is rejected with HTTP 410 PLUGIN_RETIRED
  for (const retiredId of ["pet", "ssh", "fishdock-hook"]) {
    const retiredRes = await fetch(`${ready.httpUrl}/v1/plugins/install-official`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ pluginId: retiredId, confirmedAudit: true })
    });
    assert.equal(retiredRes.status, 410);
    const retiredErr = (await retiredRes.json()) as {
      error?: { code?: string; message?: string };
    };
    assert.equal(retiredErr.error?.code, "PLUGIN_RETIRED");
    assert.match(retiredErr.error?.message ?? "", /已停用/);
  }

  // 3. Tampered remote .wb-plugin from GitHub (with Gitee 404) is strictly rejected with 422 CHECKSUM_MISMATCH
  tamperQqOnGithub = true;
  const tamperedRes = await fetch(`${ready.httpUrl}/v1/plugins/install`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      source: "official",
      pluginId: "qq",
      confirmedAudit: true,
      networkPreference: "global"
    })
  });
  assert.equal(tamperedRes.status, 422);
  const tamperedBody = (await tamperedRes.json()) as {
    error?: { code?: string };
  };
  assert.equal(tamperedBody.error?.code, "CHECKSUM_MISMATCH");
  assert.equal(existsSync(join(dataDir, "plugins", "qq")), false);
  tamperQqOnGithub = false;

  // 4. Official install of qq: GitHub 404 -> Gitee fallback -> SHA-256 verify -> atomic install -> mount -> disable/enable -> uninstall
  const qqInstallRes = await fetch(`${ready.httpUrl}/v1/plugins/install`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      source: "official",
      pluginId: "qq",
      confirmedAudit: true,
      networkPreference: "global"
    })
  });
  assert.equal(qqInstallRes.status, 200);
  const qqInstalled = (await qqInstallRes.json()) as {
    ok: boolean;
    mounted: boolean;
    sourceUsed?: string;
    plugin: { manifest: { id: string; version: string }; distribution: string };
  };
  assert.equal(qqInstalled.ok, true);
  assert.equal(qqInstalled.mounted, true);
  assert.equal(qqInstalled.plugin.manifest.id, "qq");
  assert.equal(qqInstalled.plugin.distribution, "managed");
  assert.match(qqInstalled.sourceUsed ?? "", /^gitee-release:/);
  assert.ok(existsSync(join(dataDir, "plugins", "qq", ".prismux-install.json")));

  const disableQqRes = await fetch(`${ready.httpUrl}/v1/plugins/disable`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ pluginId: "qq" })
  });
  assert.equal(disableQqRes.status, 200);
  assert.equal(((await disableQqRes.json()) as { mounted: boolean }).mounted, false);

  const enableQqRes = await fetch(`${ready.httpUrl}/v1/plugins/enable`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ pluginId: "qq" })
  });
  assert.equal(enableQqRes.status, 200);
  assert.equal(((await enableQqRes.json()) as { mounted: boolean }).mounted, true);

  const uninstallQqRes = await fetch(`${ready.httpUrl}/v1/plugins/uninstall`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ pluginId: "qq" })
  });
  assert.equal(uninstallQqRes.status, 200);
  assert.equal(existsSync(join(dataDir, "plugins", "qq")), false);
  assert.deepEqual(daemon.pluginHost.getActiveResourceCounts(), {
    routes: 0,
    hooks: 0,
    panels: 0,
    styles: 0,
    timers: 0,
    effects: 0
  });

  // 5. Official install of qq via npm wrapper fallback: GitHub 404 & Gitee 404 -> npm wrapper fallback -> unwraps nested .wb-plugin -> mounts cleanly
  serveQqOnGitee = false;
  const qqNpmInstallRes = await fetch(`${ready.httpUrl}/v1/plugins/install`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      source: "official",
      pluginId: "qq",
      confirmedAudit: true
    })
  });
  assert.equal(qqNpmInstallRes.status, 200);
  const qqNpmInstalled = (await qqNpmInstallRes.json()) as {
    ok: boolean;
    mounted: boolean;
    sourceUsed?: string;
    plugin: { manifest: { id: string }; distribution: string };
  };
  assert.equal(qqNpmInstalled.ok, true);
  assert.equal(qqNpmInstalled.mounted, true);
  assert.equal(qqNpmInstalled.plugin.manifest.id, "qq");
  assert.equal(qqNpmInstalled.plugin.distribution, "managed");
  assert.match(qqNpmInstalled.sourceUsed ?? "", /^npm-fallback:/);

  const uninstallQqNpmRes = await fetch(`${ready.httpUrl}/v1/plugins/uninstall`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ pluginId: "qq" })
  });
  assert.equal(uninstallQqNpmRes.status, 200);
  assert.equal(existsSync(join(dataDir, "plugins", "qq")), false);
  serveQqOnGitee = true;

  // 6. Local .wb-plugin upload: modelVisible 409 audit gate -> confirmed install v1.0.0 -> upgrade v1.1.0 -> rollback v1.0.0 -> restart hydration
  const makeLocalWb = (version: string) =>
    buildDeterministicTgz({
      "package.json": JSON.stringify({
        name: "prismux-plugin-local-demo",
        version,
        type: "module",
        main: "./index.mjs",
        engines: { prismux: ">=0.1.0 <2.0.0" }
      }),
      "plugin.manifest.json": JSON.stringify({
        id: "local-demo",
        version,
        realms: ["daemon"],
        permissions: ["hooks:subscribe"],
        modelVisible: true
      }),
      "index.mjs": `export const manifest = { id: "local-demo", version: "${version}", realms: ["daemon"], permissions: ["hooks:subscribe"], modelVisible: true };\nexport function apply(ctx) { ctx.registerRoute("GET", "/plugins/local-demo/ver", () => "${version}"); }\n`
    });

  const localV1 = makeLocalWb("1.0.0");
  const auditGateRes = await fetch(`${ready.httpUrl}/v1/plugins/install`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      source: "local-archive",
      fileName: "local-demo-1.0.0.wb-plugin",
      archiveBase64: localV1.toString("base64"),
      confirmedAudit: false
    })
  });
  assert.equal(auditGateRes.status, 409);
  const auditGateBody = (await auditGateRes.json()) as {
    error?: { code?: string };
  };
  assert.equal(auditGateBody.error?.code, "AUDIT_CONFIRMATION_REQUIRED");

  const localV1Res = await fetch(`${ready.httpUrl}/v1/plugins/install`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      source: "local-archive",
      fileName: "local-demo-1.0.0.wb-plugin",
      archiveBase64: localV1.toString("base64"),
      confirmedAudit: true
    })
  });
  assert.equal(localV1Res.status, 200);
  const localV1Data = (await localV1Res.json()) as {
    mounted: boolean;
    plugin: { manifest: { version: string }; distribution: string };
  };
  assert.equal(localV1Data.mounted, true);
  assert.equal(localV1Data.plugin.manifest.version, "1.0.0");
  assert.equal(localV1Data.plugin.distribution, "managed");

  const localV2 = makeLocalWb("1.1.0");
  const localV2Res = await fetch(`${ready.httpUrl}/v1/plugins/install`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      source: "local-archive",
      fileName: "local-demo-1.1.0.wb-plugin",
      archiveBase64: localV2.toString("base64"),
      confirmedAudit: true
    })
  });
  assert.equal(localV2Res.status, 200);
  const localV2Data = (await localV2Res.json()) as {
    mounted: boolean;
    plugin: { manifest: { version: string }; previousVersion?: string };
  };
  assert.equal(localV2Data.mounted, true);
  assert.equal(localV2Data.plugin.manifest.version, "1.1.0");
  assert.equal(localV2Data.plugin.previousVersion, "1.0.0");

  const rollbackRes = await fetch(`${ready.httpUrl}/v1/plugins/rollback`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ pluginId: "local-demo", targetVersion: "1.0.0" })
  });
  assert.equal(rollbackRes.status, 200);
  const rollbackData = (await rollbackRes.json()) as {
    ok: boolean;
    version: string;
    mounted: boolean;
  };
  assert.equal(rollbackData.ok, true);
  assert.equal(rollbackData.version, "1.0.0");
  assert.equal(rollbackData.mounted, true);

  // Stop & restart daemon on same dataDir to verify restart hydration mounts local-demo automatically
  await daemon.stop();
  const restarted = createDaemon();
  cleanups.push(() => restarted.stop());
  const ready2 = await restarted.start();
  assert.equal(restarted.pluginHost.isMounted("local-demo"), true);

  const installedAfterRestart = (await (
    await fetch(`${ready2.httpUrl}/v1/plugins/installed`, {
      headers: { Authorization: `Bearer ${authToken}` }
    })
  ).json()) as { plugins: Array<{ manifest: { id: string; version: string }; mounted: boolean }> };
  assert.equal(installedAfterRestart.plugins.length, 1);
  assert.equal(installedAfterRestart.plugins[0]?.manifest.id, "local-demo");
  assert.equal(installedAfterRestart.plugins[0]?.manifest.version, "1.0.0");
  assert.equal(installedAfterRestart.plugins[0]?.mounted, true);

  // Final uninstall leaves zero residual files and zero mounted resources
  const finalUninstallRes = await fetch(`${ready2.httpUrl}/v1/plugins/uninstall`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ pluginId: "local-demo" })
  });
  assert.equal(finalUninstallRes.status, 200);
  assert.equal(existsSync(join(dataDir, "plugins", "local-demo")), false);
  assert.equal(existsSync(join(dataDir, "plugins", ".snapshots", "local-demo")), false);
  assert.deepEqual(restarted.pluginHost.getActiveResourceCounts(), {
    routes: 0,
    hooks: 0,
    panels: 0,
    styles: 0,
    timers: 0,
    effects: 0
  });
  assert.ok(requestedPaths.some((p) => p.startsWith("github:")));
  assert.ok(requestedPaths.some((p) => p.startsWith("gitee:")));
  assert.ok(requestedPaths.some((p) => p.startsWith("npm:")));
});
