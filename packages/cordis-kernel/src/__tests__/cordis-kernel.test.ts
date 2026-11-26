import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import type {
  InstalledPluginRecord,
  OfficialPluginCatalogEntry,
  PluginManifest
} from "@prismux/protocol";
import {
  CORDIS_KERNEL_MILESTONE,
  ChecksumMismatchError,
  CordisPluginHost,
  CordisStreamingInstaller,
  EncryptedPluginCredentialStore,
  EngineIncompatibleError,
  ManagedPluginSelfUpdateError,
  PermissionAuditRequiredError,
  PluginCredentialError,
  PluginDeprecatedError,
  ReversibleEffectScope,
  TarSecurityError,
  assertPluginSelfUpdateAllowed,
  buildPermissionAuditCard,
  checkPackageEngineCompatibility,
  checkTopLevelEngineCompatibility,
  compareSemver,
  parseSemver,
  satisfiesSemverRange,
  searchCommunityPlugins,
  type CordisPluginModule
} from "../index.js";

function createTestUstarArchive(
  entries: ReadonlyArray<{
    path: string;
    content?: string | Buffer;
    typeflag?: "0" | "1" | "2" | "5" | "x";
    linkname?: string;
    prefix?: string;
  }>
): Buffer {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const content =
      entry.content === undefined
        ? Buffer.alloc(0)
        : typeof entry.content === "string"
          ? Buffer.from(entry.content, "utf8")
          : entry.content;
    const typeflag = entry.typeflag ?? "0";
    const size = typeflag === "0" || typeflag === "x" ? content.length : 0;

    const header = Buffer.alloc(512, 0);
    Buffer.from(entry.path, "utf8").copy(header, 0, 0, 100);
    Buffer.from("0000644\0", "ascii").copy(header, 100);
    Buffer.from("0000000\0", "ascii").copy(header, 108);
    Buffer.from("0000000\0", "ascii").copy(header, 116);
    Buffer.from(`${size.toString(8).padStart(11, "0")}\0`, "ascii").copy(
      header,
      124
    );
    Buffer.from("00000000000\0", "ascii").copy(header, 136);
    header.fill(0x20, 148, 156);
    header[156] = typeflag.charCodeAt(0);
    if (entry.linkname !== undefined) {
      Buffer.from(entry.linkname, "utf8").copy(header, 157, 0, 100);
    }
    Buffer.from("ustar\0", "ascii").copy(header, 257);
    Buffer.from("00", "ascii").copy(header, 263);
    if (entry.prefix !== undefined) {
      Buffer.from(entry.prefix, "utf8").copy(header, 345, 0, 155);
    }

    let checksum = 0;
    for (let i = 0; i < 512; i += 1) {
      checksum += header[i] ?? 0;
    }
    Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `, "ascii").copy(
      header,
      148
    );

    blocks.push(header);
    if (size > 0) {
      blocks.push(content);
      const rem = size % 512;
      if (rem !== 0) {
        blocks.push(Buffer.alloc(512 - rem, 0));
      }
    }
  }

  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

function createPaxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body, "utf8") + 1;
  while (true) {
    const full = `${len}${body}`;
    const byteLen = Buffer.byteLength(full, "utf8");
    if (byteLen === len) {
      return Buffer.from(full, "utf8");
    }
    len = byteLen;
  }
}

function createGzipTestTarball(
  entries: Parameters<typeof createTestUstarArchive>[0]
): Buffer {
  const tar = createTestUstarArchive(entries);
  const gz = gzipSync(tar);
  assert.equal(Buffer.compare(gunzipSync(gz), tar), 0);
  return gz;
}

async function startHttpServer(
  handler: http.RequestListener
): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const addr = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`
  };
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

test("SemVer 2.0 parsing, prerelease precedence, ranges, and top-level engines.prismux enforcement", () => {
  assert.equal(CORDIS_KERNEL_MILESTONE, "M3");

  // Strict SemVer 2.0 parsing
  assert.ok(parseSemver("1.2.3-alpha.1+build.42") !== null);
  assert.equal(parseSemver("01.0.0"), null);
  assert.equal(parseSemver("1.0.0-01"), null);
  assert.equal(parseSemver("1.2"), null);
  assert.equal(parseSemver("v1.2.3"), null);

  // SemVer 2.0 prerelease precedence chain
  const ordered = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0"
  ];
  for (let i = 0; i < ordered.length - 1; i += 1) {
    assert.equal(compareSemver(ordered[i]!, ordered[i + 1]!), -1);
    assert.equal(compareSemver(ordered[i + 1]!, ordered[i]!), 1);
  }
  assert.equal(compareSemver("1.0.0+build.1", "1.0.0+build.999"), 0);

  // Operators, AND intersections, OR unions, prerelease range evaluation
  assert.equal(satisfiesSemverRange("0.1.0", ">=0.1.0 <2.0.0"), true);
  assert.equal(satisfiesSemverRange("1.9.9", ">=0.1.0 <2.0.0"), true);
  assert.equal(satisfiesSemverRange("2.0.0", ">=0.1.0 <2.0.0"), false);
  assert.equal(satisfiesSemverRange("2.0.0-alpha.1", ">=0.1.0 <2.0.0"), false);
  assert.equal(satisfiesSemverRange("1.0.0-alpha.2", ">=1.0.0-alpha.1 <1.0.0"), true);
  assert.equal(satisfiesSemverRange("1.0.0-alpha.0", ">=1.0.0-alpha.1 <1.0.0"), false);
  assert.equal(satisfiesSemverRange("1.4.2", "^1.2.3"), true);
  assert.equal(satisfiesSemverRange("2.0.0", "^1.2.3"), false);
  assert.equal(satisfiesSemverRange("0.1.5", "^0.1.0"), true);
  assert.equal(satisfiesSemverRange("0.2.0", "^0.1.0"), false);
  assert.equal(satisfiesSemverRange("0.0.3", "^0.0.3"), true);
  assert.equal(satisfiesSemverRange("0.0.4", "^0.0.3"), false);
  assert.equal(satisfiesSemverRange("1.2.9", "~1.2.3"), true);
  assert.equal(satisfiesSemverRange("1.3.0", "~1.2.3"), false);
  assert.equal(satisfiesSemverRange("3.2.1", "^1.0.0 || ^3.2.0"), true);
  assert.equal(satisfiesSemverRange("2.5.0", "^1.0.0 || ^3.2.0"), false);
  assert.equal(satisfiesSemverRange("5.4.3", "*"), true);
  assert.equal(satisfiesSemverRange("1.2.3", "=1.2.3"), true);
  assert.equal(satisfiesSemverRange("1.2.4", "=1.2.3"), false);
  assert.equal(satisfiesSemverRange("0.2.0", ">0.1.0 <=0.2.0"), true);
  assert.equal(satisfiesSemverRange("0.1.0", ">0.1.0 <=0.2.0"), false);
  assert.equal(satisfiesSemverRange("1.2.9", "1.2.x"), true);
  assert.equal(satisfiesSemverRange("1.5.0", "1.0.0 - 2.0.0"), true);
  assert.equal(satisfiesSemverRange("2.0.1", "1.0.0 - 2.0.0"), false);

  // Top-level engines.prismux check
  assert.equal(
    checkTopLevelEngineCompatibility({ prismux: ">=0.1.0 <2.0.0" }, "0.1.0").compatible,
    true
  );

  const incompatible = checkTopLevelEngineCompatibility({ prismux: "^2.0.0" }, "0.1.0");
  assert.equal(incompatible.compatible, false);
  assert.ok(incompatible.reason && incompatible.reason.length > 0);

  const invalidRange = checkTopLevelEngineCompatibility({ prismux: "not-a-range" }, "0.1.0");
  assert.equal(invalidRange.compatible, false);

  // PeerDependencies fallback MUST be strictly rejected
  const peerOnlyPkg = {
    name: "bad-plugin",
    version: "1.0.0",
    peerDependencies: {
      prismux: ">=0.1.0 <2.0.0",
      "@prismux/protocol": "^0.1.0"
    }
  };
  const peerRejected = checkPackageEngineCompatibility(peerOnlyPkg, "0.1.0");
  assert.equal(peerRejected.compatible, false);
  assert.match(peerRejected.reason ?? "", /peerDependencies/i);

  // Even forcing peerDependencies into checkTopLevelEngineCompatibility fails
  const forcedRejected = checkTopLevelEngineCompatibility(
    { peerDependencies: { prismux: "*" } } as unknown as { prismux?: string },
    "0.1.0"
  );
  assert.equal(forcedRejected.compatible, false);
});

test("CordisPluginHost dual-realm lifecycle: zero residual resources, LIFO rollback, and managed write lock", async () => {
  // Direct ReversibleEffectScope LIFO verification
  const scope = new ReversibleEffectScope();
  const order: number[] = [];
  scope.add(() => {
    order.push(1);
  });
  scope.add(() => {
    order.push(2);
  });
  scope.add(() => {
    order.push(3);
  });
  assert.equal(scope.size, 3);
  await scope.disposeAll();
  assert.deepEqual(order, [3, 2, 1]);
  assert.equal(scope.size, 0);
  assert.equal(scope.isDisposed(), true);

  const credDir = mkdtempSync(join(tmpdir(), "prismux-host-cred-"));
  try {
    const credStore = new EncryptedPluginCredentialStore({
      dataDir: credDir,
      masterKey: "unit-test-master-key-32-bytes-ok"
    });

    const daemonHost = new CordisPluginHost("daemon");
    const uiHost = new CordisPluginHost("ui");
    const cleanupLog: string[] = [];

    const dualManifest: PluginManifest = {
      id: "dual-sample",
      version: "1.0.0",
      realms: ["daemon", "ui"],
      permissions: ["hooks:subscribe", "ui:panel"],
      modelVisible: false
    };

    const daemonRecord: InstalledPluginRecord = {
      manifest: dualManifest,
      packageName: "@prismux/plugin-dual-sample",
      distribution: "managed",
      enabled: true,
      installPath: join(credDir, "plugins", "dual-sample"),
      installedAt: Date.now()
    };

    const dualModule: CordisPluginModule = {
      manifest: dualManifest,
      apply(ctx) {
        if (ctx.realm === "daemon") {
          ctx.registerRoute?.("GET", "/plugins/dual-sample/ping", () => "pong");
          ctx.onHook?.("PreToolUse", () => ({
            decision: "allow",
            exitCode: 0,
            feedback: "ok"
          }));
          ctx.setInterval(() => undefined, 60_000);
          ctx.effect(() => {
            cleanupLog.push("daemon-effect");
          });
        } else {
          ctx.registerPanel?.("dual-panel", { title: "Dual Panel" });
          ctx.registerStyle("dual-style", ".dual { opacity: 1; }");
          ctx.onHook?.("Notification", () => undefined);
          ctx.effect(() => {
            cleanupLog.push("ui-effect");
          });
        }
      }
    };

    const handle = credStore.openForPlugin("dual-sample");
    await daemonHost.mountPlugin(daemonRecord, dualModule, handle);
    await uiHost.mountPlugin(daemonRecord, dualModule, handle);

    const daemonCounts = daemonHost.getActiveResourceCounts();
    assert.equal(daemonCounts.routes, 1);
    assert.equal(daemonCounts.hooks, 1);
    assert.equal(daemonCounts.timers, 1);
    assert.equal(daemonCounts.effects, 1);

    const uiCounts = uiHost.getActiveResourceCounts();
    assert.equal(uiCounts.panels, 1);
    assert.equal(uiCounts.styles, 1);
    assert.equal(uiCounts.hooks, 1);
    assert.equal(uiCounts.effects, 1);

    const hookOutcomes = await daemonHost.dispatchHook({
      event: "PreToolUse",
      sessionId: "s1",
      threadId: "t1",
      permissionMode: "auto",
      timestamp: Date.now()
    });
    assert.equal(hookOutcomes.length, 1);
    assert.equal(hookOutcomes[0]?.decision, "allow");

    // Managed single-write lock forbids in-app self-update
    assert.throws(
      () => assertPluginSelfUpdateAllowed(daemonRecord),
      ManagedPluginSelfUpdateError
    );
    assert.throws(
      () => daemonHost.assertSelfUpdateAllowed("dual-sample"),
      ManagedPluginSelfUpdateError
    );
    assert.doesNotThrow(() =>
      assertPluginSelfUpdateAllowed({ ...daemonRecord, distribution: "local" })
    );

    // Unmount daemon & uninstall ui -> ZERO residual resources
    await daemonHost.unmountPlugin("dual-sample");
    assert.deepEqual(daemonHost.getActiveResourceCounts(), {
      routes: 0,
      hooks: 0,
      panels: 0,
      styles: 0,
      timers: 0,
      effects: 0
    });
    assert.deepEqual(
      daemonHost.getActiveResourceCountsForPlugin("dual-sample"),
      { routes: 0, hooks: 0, panels: 0, styles: 0, timers: 0, effects: 0 }
    );
    const afterUnmountHooks = await daemonHost.dispatchHook({
      event: "PreToolUse",
      sessionId: "s1",
      threadId: "t1",
      permissionMode: "auto",
      timestamp: Date.now()
    });
    assert.equal(afterUnmountHooks.length, 0);

    await uiHost.uninstallPlugin("dual-sample");
    assert.deepEqual(uiHost.getActiveResourceCounts(), {
      routes: 0,
      hooks: 0,
      panels: 0,
      styles: 0,
      timers: 0,
      effects: 0
    });
    assert.equal(uiHost.listInstalled().length, 0);
    assert.deepEqual(cleanupLog, ["daemon-effect", "ui-effect"]);

    // Mid-apply failure triggers full LIFO rollback with zero leaked resources
    const rollbackOrder: string[] = [];
    const flakyManifest: PluginManifest = {
      id: "flaky-plugin",
      version: "0.1.0",
      realms: ["daemon"],
      permissions: ["hooks:subscribe"],
      modelVisible: false
    };
    const flakyRecord: InstalledPluginRecord = {
      manifest: flakyManifest,
      packageName: "prismux-plugin-flaky",
      distribution: "managed",
      enabled: true,
      installPath: join(credDir, "plugins", "flaky-plugin"),
      installedAt: Date.now()
    };

    await assert.rejects(
      () =>
        daemonHost.mountPlugin(
          flakyRecord,
          {
            manifest: flakyManifest,
            apply(ctx) {
              ctx.registerRoute?.("POST", "/flaky", () => null);
              ctx.onHook?.("Stop", () => undefined);
              ctx.setInterval(() => undefined, 50_000);
              ctx.effect(() => {
                rollbackOrder.push("first");
              });
              ctx.effect(() => {
                rollbackOrder.push("second");
              });
              throw new Error("Simulated mid-apply failure");
            }
          } as CordisPluginModule,
          credStore.openForPlugin("flaky-plugin")
        ),
      /Simulated mid-apply failure/
    );

    assert.deepEqual(rollbackOrder, ["second", "first"]);
    assert.deepEqual(daemonHost.getActiveResourceCounts(), {
      routes: 0,
      hooks: 0,
      panels: 0,
      styles: 0,
      timers: 0,
      effects: 0
    });
    assert.equal(daemonHost.isMounted("flaky-plugin"), false);
  } finally {
    rmSync(credDir, { recursive: true, force: true });
  }
});

test("CordisStreamingInstaller Track 1: official .wb-plugin SHA-256 verification and 1-byte tamper rejection", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "prismux-official-inst-"));
  try {
    const pluginsDir = join(workDir, "plugins");
    const catalogPath = join(workDir, "official.json");

    const archive = createGzipTestTarball([
      {
        path: "package.json",
        content: JSON.stringify({
          name: "@prismux/plugin-demo-official",
          version: "0.2.0",
          engines: { prismux: ">=0.1.0 <2.0.0" }
        })
      },
      {
        path: "plugin.manifest.json",
        content: JSON.stringify({
          id: "demo-official",
          version: "0.2.0",
          realms: ["daemon"],
          permissions: ["hooks:subscribe"],
          modelVisible: false
        })
      },
      {
        path: "dist/index.js",
        content: "export function apply() {}\n"
      }
    ]);
    const sha256 = createHash("sha256").update(archive).digest("hex");

    writeFileSync(
      catalogPath,
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: "2026-11-22T00:00:00Z",
        plugins: [
          {
            id: "demo-official",
            packageName: "@prismux/plugin-demo-official",
            version: "0.2.0",
            description: "Official test plugin",
            engines: { prismux: ">=0.1.0 <2.0.0" },
            realms: ["daemon"],
            permissions: ["hooks:subscribe"],
            modelVisible: false,
            sha256,
            bytes: archive.byteLength,
            status: "verified"
          }
        ]
      }),
      "utf8"
    );

    const installer = new CordisStreamingInstaller({
      pluginsDir,
      hostVersion: "0.1.0"
    });
    const catalog = await installer.loadOfficialCatalog(catalogPath);
    const entry: OfficialPluginCatalogEntry = catalog.plugins[0]!;

    // 1-byte tamper MUST fail before unpacking
    const tampered = Buffer.from(archive);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! ^ 0xff) & 0xff;
    await assert.rejects(
      () => installer.installOfficialEntry(entry, tampered),
      ChecksumMismatchError
    );
    assert.equal(existsSync(join(pluginsDir, "demo-official")), false);

    // Valid archive succeeds and sets distribution="managed"
    const installed = await installer.installOfficialEntry(entry, archive);
    assert.equal(installed.manifest.id, "demo-official");
    assert.equal(installed.distribution, "managed");
    assert.equal(installed.sha256, sha256);
    assert.equal(
      existsSync(join(pluginsDir, "demo-official", "dist", "index.js")),
      true
    );

    const persisted = await installer.getInstalledRecord("demo-official");
    assert.equal(persisted?.distribution, "managed");

    // Verify loading the repository's real official.json catalog
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const repoOfficialCatalogPath = resolve(
      __dirname,
      "../../../../plugins-official/catalog/official.json"
    );
    const repoCatalog = await installer.loadOfficialCatalog(repoOfficialCatalogPath);
    assert.equal(repoCatalog.schemaVersion, 1);
    assert.ok(repoCatalog.plugins.some((item) => item.id === "qq"));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("CordisStreamingInstaller Track 2: 503 npmmirror fallback, scriptless postinstall defense, Tar-Slip, modelVisible confirmation, and GitHub topic search", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "prismux-npm-inst-"));
  const pluginsDir = join(workDir, "plugins");
  const markerPath = join(workDir, "pwned-by-postinstall.txt");
  const escapedTargetPath = join(workDir, "escape.txt");

  // Build tarballs:
  // 1) Normal community plugin with malicious postinstall script and modelVisible=false
  const safePkgTarball = createGzipTestTarball([
    {
      path: "package/package.json",
      content: JSON.stringify({
        name: "prismux-plugin-community",
        version: "1.1.0",
        engines: { prismux: ">=0.1.0 <2.0.0" },
        scripts: {
          preinstall: `node -e "require('fs').writeFileSync(${JSON.stringify(markerPath)}, 'pre')"`,
          postinstall: `node -e "require('fs').writeFileSync(${JSON.stringify(markerPath)}, 'post')"`,
          prepare: "echo should-not-run"
        }
      })
    },
    {
      path: "package/plugin.manifest.json",
      content: JSON.stringify({
        id: "community-demo",
        version: "1.1.0",
        realms: ["daemon", "ui"],
        permissions: ["network:outbound", "ui:panel"],
        modelVisible: false
      })
    },
    {
      path: "package/dist/index.js",
      content: "export const ok = true;\n"
    }
  ]);

  // 2) Tar-Slip archive attempting `../escape.txt`
  const tarSlipTarball = createGzipTestTarball([
    {
      path: "package/package.json",
      content: JSON.stringify({
        name: "prismux-plugin-evil",
        version: "1.0.0",
        engines: { prismux: ">=0.1.0 <2.0.0" }
      })
    },
    {
      path: "../escape.txt",
      content: "escaped!"
    }
  ]);

  // 3) Symlink archive attempting symlink entry
  const symlinkTarball = createGzipTestTarball([
    {
      path: "package/package.json",
      content: JSON.stringify({
        name: "prismux-plugin-symlink",
        version: "1.0.0",
        engines: { prismux: ">=0.1.0 <2.0.0" }
      })
    },
    {
      path: "package/link",
      typeflag: "2",
      linkname: "/etc/passwd"
    }
  ]);

  // 4) modelVisible: true plugin requiring explicit audit confirmation
  const modelVisibleTarball = createGzipTestTarball([
    {
      path: "package/package.json",
      content: JSON.stringify({
        name: "@thirdparty/prismux-plugin-tools",
        version: "1.0.0",
        engines: { prismux: "^0.1.0" }
      })
    },
    {
      path: "package/plugin.manifest.json",
      content: JSON.stringify({
        id: "thirdparty-tools",
        version: "1.0.0",
        realms: ["daemon"],
        permissions: ["hooks:intercept", "network:outbound"],
        modelVisible: true
      })
    },
    {
      path: "package/dist/index.js",
      content: "export function apply() {}\n"
    }
  ]);

  // 5) peerDependencies-only plugin (no top-level engines.prismux)
  const peerOnlyTarball = createGzipTestTarball([
    {
      path: "package/package.json",
      content: JSON.stringify({
        name: "prismux-plugin-peer-only",
        version: "1.0.0",
        peerDependencies: { prismux: ">=0.1.0" }
      })
    },
    {
      path: "package/plugin.manifest.json",
      content: JSON.stringify({
        id: "peer-only",
        version: "1.0.0",
        realms: ["daemon"],
        permissions: ["hooks:subscribe"],
        modelVisible: false
      })
    }
  ]);

  let primaryHits = 0;
  let fallbackHits = 0;

  const primary = await startHttpServer((_req, res) => {
    primaryHits += 1;
    res.statusCode = 503;
    res.end("Primary registry temporarily unavailable");
  });

  const fallback = await startHttpServer((req, res) => {
    fallbackHits += 1;
    const urlPath = req.url ?? "/";

    const sri512 = (buf: Buffer) =>
      `sha512-${createHash("sha512").update(buf).digest("base64")}`;
    const sendPackument = (
      pkgName: string,
      version: string,
      tarballPath: string,
      tarballBuf: Buffer
    ) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          name: pkgName,
          "dist-tags": { latest: version },
          versions: {
            [version]: {
              version,
              dist: {
                tarball: `${fallback.baseUrl}${tarballPath}`,
                integrity: sri512(tarballBuf)
              }
            }
          }
        })
      );
    };

    if (urlPath === "/prismux-plugin-community") {
      sendPackument("prismux-plugin-community", "1.1.0", "/tar/community.tgz", safePkgTarball);
      return;
    }
    if (urlPath === "/tar/community.tgz") {
      res.statusCode = 200;
      res.end(safePkgTarball);
      return;
    }
    if (urlPath === "/prismux-plugin-evil") {
      sendPackument("prismux-plugin-evil", "1.0.0", "/tar/evil.tgz", tarSlipTarball);
      return;
    }
    if (urlPath === "/tar/evil.tgz") {
      res.statusCode = 200;
      res.end(tarSlipTarball);
      return;
    }
    if (urlPath === "/prismux-plugin-symlink") {
      sendPackument("prismux-plugin-symlink", "1.0.0", "/tar/symlink.tgz", symlinkTarball);
      return;
    }
    if (urlPath === "/tar/symlink.tgz") {
      res.statusCode = 200;
      res.end(symlinkTarball);
      return;
    }
    if (urlPath === "/@thirdparty%2Fprismux-plugin-tools") {
      sendPackument(
        "@thirdparty/prismux-plugin-tools",
        "1.0.0",
        "/tar/tools.tgz",
        modelVisibleTarball
      );
      return;
    }
    if (urlPath === "/tar/tools.tgz") {
      res.statusCode = 200;
      res.end(modelVisibleTarball);
      return;
    }
    if (urlPath === "/prismux-plugin-peer-only") {
      sendPackument("prismux-plugin-peer-only", "1.0.0", "/tar/peer-only.tgz", peerOnlyTarball);
      return;
    }
    if (urlPath === "/tar/peer-only.tgz") {
      res.statusCode = 200;
      res.end(peerOnlyTarball);
      return;
    }

    res.statusCode = 404;
    res.end("Not Found");
  });

  try {
    const installer = new CordisStreamingInstaller({
      pluginsDir,
      hostVersion: "0.1.0",
      defaultRegistryUrl: primary.baseUrl,
      defaultFallbackRegistryUrl: fallback.baseUrl,
      allowInsecureLoopbackForTesting: true
    });

    // 1. Primary 503 -> automatic fallback to npmmirror + postinstall NEVER executed
    // Package declares preinstall/postinstall/prepare -> requires explicit audit confirmation!
    await assert.rejects(
      () =>
        installer.installFromNpm({
          packageNameOrTarball: "prismux-plugin-community",
          ignoreScripts: true,
          distribution: "managed"
        }),
      PermissionAuditRequiredError
    );

    const installed = await installer.installFromNpm({
      packageNameOrTarball: "prismux-plugin-community",
      ignoreScripts: true,
      distribution: "managed",
      confirmedAudit: true
    });
    assert.ok(primaryHits >= 1);
    assert.ok(fallbackHits >= 2);
    assert.equal(installed.usedFallbackRegistry, true);
    assert.equal(installed.distribution, "managed");
    assert.equal(installed.manifest.id, "community-demo");
    assert.equal(existsSync(markerPath), false, "postinstall script MUST NEVER run");
    assert.deepEqual(installed.ignoredInstallScripts, [
      "preinstall",
      "postinstall",
      "prepare"
    ]);
    assert.equal(installed.audit.severity, "warning");
    assert.equal(installed.audit.requiresExplicitConfirmation, true);
    assert.equal(
      existsSync(join(pluginsDir, "community-demo", "dist", "index.js")),
      true
    );

    // 2. Tar-Slip `../escape.txt` MUST be rejected
    await assert.rejects(
      () =>
        installer.installFromNpm({
          packageNameOrTarball: "prismux-plugin-evil",
          ignoreScripts: true,
          distribution: "managed"
        }),
      TarSecurityError
    );
    assert.equal(existsSync(escapedTargetPath), false);

    // 3. Symlink entry MUST be rejected
    await assert.rejects(
      () =>
        installer.installFromNpm({
          packageNameOrTarball: "prismux-plugin-symlink",
          ignoreScripts: true,
          distribution: "managed"
        }),
      TarSecurityError
    );

    // 4. peerDependencies-only package MUST be rejected
    await assert.rejects(
      () =>
        installer.installFromNpm({
          packageNameOrTarball: "prismux-plugin-peer-only",
          ignoreScripts: true,
          distribution: "managed"
        }),
      EngineIncompatibleError
    );

    // 5. modelVisible: true without confirmedAudit MUST be rejected
    const auditCard = buildPermissionAuditCard({
      id: "thirdparty-tools",
      version: "1.0.0",
      realms: ["daemon"],
      permissions: ["hooks:intercept", "network:outbound"],
      modelVisible: true
    });
    assert.equal(auditCard.severity, "warning");
    assert.equal(auditCard.requiresExplicitConfirmation, true);
    assert.ok(auditCard.permissions.some((item) => item.labelZh.includes("拦截")));

    await assert.rejects(
      () =>
        installer.installFromNpm({
          packageNameOrTarball: "@thirdparty/prismux-plugin-tools",
          ignoreScripts: true,
          distribution: "managed"
        }),
      PermissionAuditRequiredError
    );
    assert.equal(existsSync(join(pluginsDir, "thirdparty-tools")), false);

    // 6. modelVisible: true WITH confirmedAudit: true succeeds & writes distribution="managed"
    const confirmedInstall = await installer.installFromNpm({
      packageNameOrTarball: "@thirdparty/prismux-plugin-tools",
      ignoreScripts: true,
      distribution: "managed",
      confirmedAudit: true
    });
    assert.equal(confirmedInstall.manifest.id, "thirdparty-tools");
    assert.equal(confirmedInstall.distribution, "managed");
    assert.equal(confirmedInstall.audit.severity, "warning");
    const onDiskMeta = await installer.getInstalledRecord("thirdparty-tools");
    assert.equal(onDiskMeta?.distribution, "managed");

    // 7. Uninstall removes installed directory cleanly
    await installer.uninstall("thirdparty-tools");
    assert.equal(existsSync(join(pluginsDir, "thirdparty-tools")), false);
    assert.equal(await installer.getInstalledRecord("thirdparty-tools"), null);

    // 8. GitHub topic search (`prismux-plugin`)
    let requestedSearchUrl = "";
    const communityList = await searchCommunityPlugins(
      "prismux-plugin",
      async (url) => {
        requestedSearchUrl = url;
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              items: [
                {
                  full_name: "community/prismux-plugin-awesome",
                  name: "prismux-plugin-awesome",
                  description: "Awesome plugin",
                  html_url: "https://github.com/community/prismux-plugin-awesome",
                  stargazers_count: 42,
                  topics: ["prismux-plugin"],
                  default_branch: "main",
                  updated_at: "2026-11-22T00:00:00Z"
                }
              ]
            };
          }
        };
      }
    );
    assert.match(requestedSearchUrl, /topic%3Aprismux-plugin/);
    assert.equal(communityList.length, 1);
    assert.equal(communityList[0]?.name, "prismux-plugin-awesome");
    assert.equal(communityList[0]?.stars, 42);
  } finally {
    await closeHttpServer(primary.server);
    await closeHttpServer(fallback.server);
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("CordisStreamingInstaller security edge cases: ustar prefix, PAX paths, small chunks, hardlinks, package/../escape, ECONNREFUSED fallback, and HTTP topic search", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "prismux-edge-inst-"));
  const pluginsDir = join(workDir, "plugins");

  try {
    // Build a tarball exercising ustar `prefix`, PAX extended `path`, and chunked 7-byte streaming
    const longSubPath = `nested/${"segment-".repeat(12)}entry.js`;
    const paxTarball = createGzipTestTarball([
      {
        path: "package/package.json",
        content: JSON.stringify({
          name: "prismux-plugin-pax",
          version: "1.0.0",
          engines: { prismux: ">=0.1.0 <2.0.0" }
        })
      },
      {
        path: "plugin.manifest.json",
        prefix: "package",
        content: JSON.stringify({
          id: "pax-demo",
          version: "1.0.0",
          realms: ["ui"],
          permissions: ["ui:panel"],
          modelVisible: false
        })
      },
      {
        path: "PaxHeader/long",
        typeflag: "x",
        content: createPaxRecord("path", `package/${longSubPath}`)
      },
      {
        path: "placeholder",
        content: "export const longPathOk = true;\n"
      }
    ]);

    const pkgEscapeTarball = createGzipTestTarball([
      {
        path: "package/../escape.txt",
        content: "nope"
      }
    ]);

    const hardlinkTarball = createGzipTestTarball([
      {
        path: "package/package.json",
        content: JSON.stringify({
          name: "prismux-plugin-hardlink",
          version: "1.0.0",
          engines: { prismux: ">=0.1.0 <2.0.0" }
        })
      },
      {
        path: "package/hard",
        typeflag: "1",
        linkname: "package/package.json"
      }
    ]);

    // Reserve and immediately close a port so primary triggers real ECONNREFUSED network error
    const deadServer = await startHttpServer((_req, res) => res.end());
    const deadPrimaryUrl = deadServer.baseUrl;
    await closeHttpServer(deadServer.server);

    const fallbackAndGithub = await startHttpServer((req, res) => {
      const reqUrl = req.url ?? "/";
      if (reqUrl === "/prismux-plugin-pax") {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            name: "prismux-plugin-pax",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                version: "1.0.0",
                dist: {
                  tarball: "/tar/pax.tgz",
                  integrity: `sha512-${createHash("sha512").update(paxTarball).digest("base64")}`
                }
              }
            }
          })
        );
        return;
      }
      if (reqUrl === "/tar/pax.tgz") {
        res.statusCode = 200;
        // Stream in tiny 7-byte chunks to exercise tar header/body boundary assembly
        const stream = new Readable({ read() {} });
        let offset = 0;
        const pushNext = () => {
          if (offset >= paxTarball.length) {
            stream.push(null);
            return;
          }
          stream.push(paxTarball.subarray(offset, offset + 7));
          offset += 7;
          setImmediate(pushNext);
        };
        pushNext();
        stream.pipe(res);
        return;
      }
      if (reqUrl === "/tar/pkg-escape.tgz") {
        res.statusCode = 200;
        res.end(pkgEscapeTarball);
        return;
      }
      if (reqUrl === "/tar/hardlink.tgz") {
        res.statusCode = 200;
        res.end(hardlinkTarball);
        return;
      }
      if (reqUrl.startsWith("/search/repositories?")) {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            items: [
              {
                full_name: "org/prismux-plugin-http",
                name: "prismux-plugin-http",
                description: "From HTTP mock",
                html_url: "https://github.com/org/prismux-plugin-http",
                stargazers_count: 7,
                topics: ["prismux-plugin"],
                default_branch: "main",
                updated_at: "2026-11-22T01:00:00Z"
              }
            ]
          })
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    try {
      const installer = new CordisStreamingInstaller({
        pluginsDir,
        hostVersion: "0.1.0",
        defaultRegistryUrl: deadPrimaryUrl,
        defaultFallbackRegistryUrl: fallbackAndGithub.baseUrl,
        githubApiBaseUrl: fallbackAndGithub.baseUrl,
        allowInsecureLoopbackForTesting: true
      });

      const installed = await installer.installFromNpm({
        packageNameOrTarball: "prismux-plugin-pax",
        ignoreScripts: true,
        distribution: "managed"
      });
      assert.equal(installed.usedFallbackRegistry, true);
      assert.equal(installed.distribution, "managed");
      assert.equal(
        existsSync(join(pluginsDir, "pax-demo", longSubPath)),
        true
      );

      await assert.rejects(
        () =>
          installer.installFromNpm({
            packageNameOrTarball: `${fallbackAndGithub.baseUrl}/tar/pkg-escape.tgz`,
            expectedSha256: createHash("sha256").update(pkgEscapeTarball).digest("hex"),
            ignoreScripts: true,
            distribution: "managed"
          }),
        TarSecurityError
      );

      await assert.rejects(
        () =>
          installer.installFromNpm({
            packageNameOrTarball: `${fallbackAndGithub.baseUrl}/tar/hardlink.tgz`,
            expectedSha256: createHash("sha256").update(hardlinkTarball).digest("hex"),
            ignoreScripts: true,
            distribution: "managed"
          }),
        TarSecurityError
      );

      const viaHttp = await installer.searchCommunityPlugins("prismux-plugin");
      assert.equal(viaHttp.length, 1);
      assert.equal(viaHttp[0]?.name, "prismux-plugin-http");
    } finally {
      await closeHttpServer(fallbackAndGithub.server);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("EncryptedPluginCredentialStore: isolated <plugin-id>.enc, ChaCha20-Poly1305, 0600 mode, and cross-plugin key isolation", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "prismux-cred-iso-"));
  try {
    const store = new EncryptedPluginCredentialStore({
      dataDir,
      masterKey: "prismux-super-secret-master-key-material"
    });

    // Reject path traversal in pluginId
    assert.throws(() => store.openForPlugin("../other"), PluginCredentialError);
    assert.throws(() => store.openForPlugin("a/b"), PluginCredentialError);
    assert.throws(() => store.openForPlugin("a\\b"), PluginCredentialError);
    assert.throws(() => store.openForPlugin(".."), PluginCredentialError);

    const handleA = store.openForPlugin("plugin-alpha");
    const handleB = store.openForPlugin("plugin-beta");

    await Promise.all([
      handleA.set("apiKey", "alpha-secret-token-123"),
      handleA.set("endpoint", "https://alpha.local"),
      handleB.set("apiKey", "beta-secret-token-999")
    ]);

    assert.equal(await handleA.get("apiKey"), "alpha-secret-token-123");
    assert.equal(await handleA.get("endpoint"), "https://alpha.local");
    assert.equal(await handleB.get("apiKey"), "beta-secret-token-999");

    const fileA = store.getCredentialFilePath("plugin-alpha");
    const fileB = store.getCredentialFilePath("plugin-beta");
    assert.equal(existsSync(fileA), true);
    assert.equal(existsSync(fileB), true);

    const rawA = readFileSync(fileA);
    const rawB = readFileSync(fileB);
    assert.equal(rawA.toString("utf8").includes("alpha-secret-token-123"), false);
    assert.equal(rawB.toString("utf8").includes("beta-secret-token-999"), false);

    if (process.platform !== "win32") {
      assert.equal(statSync(fileA).mode & 0o777, 0o600);
      assert.equal(statSync(fileB).mode & 0o777, 0o600);
    }

    // Physical cross-plugin isolation: plugin A key CANNOT decrypt plugin B file
    assert.throws(
      () => store.decryptRawForPlugin("plugin-alpha", rawB),
      PluginCredentialError
    );

    // Even overwriting plugin-alpha.enc with plugin-beta.enc MUST fail authentication
    copyFileSync(fileB, fileA);
    await assert.rejects(() => handleA.get("apiKey"), PluginCredentialError);

    // Restore valid plugin-alpha file by rewriting and verify delete + tamper detection
    writeFileSync(fileA, rawA);
    await handleA.delete("endpoint");
    assert.equal(await handleA.get("endpoint"), null);
    assert.equal(await handleA.get("apiKey"), "alpha-secret-token-123");

    const tamperedA = readFileSync(fileA);
    tamperedA[tamperedA.length - 1] = (tamperedA[tamperedA.length - 1]! ^ 0x01) & 0xff;
    writeFileSync(fileA, tamperedA);
    await assert.rejects(() => handleA.get("apiKey"), PluginCredentialError);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("SemVer prerelease host compatibility: 0.1.2-preview.2 satisfies >=0.1.0-0 <2.0.0 and >=0.1.0 <2.0.0 without bypassing upper bounds", () => {
  // Prerelease opt-in on lower bound matches subsequent preview tuples
  assert.equal(satisfiesSemverRange("0.1.2-preview.2", ">=0.1.0-0 <2.0.0"), true);
  assert.equal(satisfiesSemverRange("0.1.9-rc.1", ">=0.1.0-0 <2.0.0"), true);
  // Exclusive upper-bound prereleases remain blocked
  assert.equal(satisfiesSemverRange("2.0.0-alpha.1", ">=0.1.0-0 <2.0.0"), false);
  assert.equal(satisfiesSemverRange("2.0.0-alpha.1", ">=0.1.0 <2.0.0"), false);

  // Prerelease host evaluating standard plugin ranges
  assert.equal(
    checkTopLevelEngineCompatibility({ prismux: ">=0.1.0-0 <2.0.0" }, "0.1.2-preview.2").compatible,
    true
  );
  assert.equal(
    checkTopLevelEngineCompatibility({ prismux: ">=0.1.0 <2.0.0" }, "0.1.2-preview.2").compatible,
    true
  );
  assert.equal(
    checkTopLevelEngineCompatibility({ prismux: "^0.1.0" }, "0.1.2-preview.2").compatible,
    true
  );
  // Strict bounds still enforced on prerelease hosts
  assert.equal(
    checkTopLevelEngineCompatibility({ prismux: ">=0.1.0 <2.0.0" }, "0.1.0-preview.1").compatible,
    false
  );
  assert.equal(
    checkTopLevelEngineCompatibility({ prismux: ">=0.1.0 <2.0.0" }, "2.0.0-alpha.1").compatible,
    false
  );
  assert.equal(
    checkTopLevelEngineCompatibility({ prismux: "^2.0.0" }, "0.1.2-preview.2").compatible,
    false
  );
});

test("CordisStreamingInstaller: unwraps official npm .wb-plugin wrappers, blocks deprecated entries, and supports local archive + snapshot rollback", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "prismux-wrapper-rollback-"));
  try {
    const pluginsDir = join(workDir, "plugins");
    const installer = new CordisStreamingInstaller({
      pluginsDir,
      hostVersion: "0.1.2-preview.2",
      allowInsecureLoopbackForTesting: true
    });

    // 1. Deprecated official entry is strictly rejected
    const deprecatedEntry: OfficialPluginCatalogEntry = {
      id: "pet",
      packageName: "@prismux/plugin-pet",
      version: "0.1.2-preview.1",
      description: "Deprecated pet plugin",
      engines: { prismux: ">=0.1.0-0 <2.0.0" },
      realms: ["ui"],
      permissions: [],
      modelVisible: false,
      sha256: "0".repeat(64),
      status: "deprecated"
    };
    await assert.rejects(
      () => installer.installOfficialEntry(deprecatedEntry, Buffer.from("dummy")),
      PluginDeprecatedError
    );

    // 2. Official npm wrapper tarball containing a nested `.wb-plugin` unpacks real dist/index.js
    const innerWbV1 = createGzipTestTarball([
      {
        path: "package.json",
        content: JSON.stringify({
          name: "@prismux/plugin-qq",
          version: "0.1.2-preview.1",
          main: "./dist/index.js",
          engines: { prismux: ">=0.1.0-0 <2.0.0" }
        })
      },
      {
        path: "plugin.manifest.json",
        content: JSON.stringify({
          id: "qq",
          version: "0.1.2-preview.1",
          realms: ["daemon", "ui"],
          permissions: ["network:outbound"],
          modelVisible: false
        })
      },
      {
        path: "dist/index.js",
        content: "export const marker = 'v1-unwrapped'; export function apply() {}\n"
      }
    ]);
    const wrapperNpmTgz = createGzipTestTarball([
      {
        path: "package/package.json",
        content: JSON.stringify({
          name: "prismux-plugin-qq",
          version: "0.1.2-preview.1",
          bin: { "prismux-plugin-qq": "bin/install.mjs" },
          engines: { prismux: ">=0.1.0-0 <2.0.0" },
          scripts: { postinstall: "echo must-never-run" }
        })
      },
      {
        path: "package/plugin.manifest.json",
        content: JSON.stringify({
          id: "qq",
          version: "0.1.2-preview.1",
          realms: ["daemon", "ui"],
          permissions: ["network:outbound"],
          modelVisible: false
        })
      },
      {
        path: "package/prismux-plugin-qq-0.1.2-preview.1.wb-plugin",
        content: innerWbV1
      }
    ]);

    const wrapperSha512 = `sha512-${createHash("sha512").update(wrapperNpmTgz).digest("base64")}`;
    const registry = await startHttpServer((req, res) => {
      if (req.url === "/prismux-plugin-qq") {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            name: "prismux-plugin-qq",
            "dist-tags": { latest: "0.1.2-preview.1" },
            versions: {
              "0.1.2-preview.1": {
                version: "0.1.2-preview.1",
                engines: { prismux: ">=0.1.0-0 <2.0.0" },
                dist: {
                  tarball: `${registry.baseUrl}/tarballs/prismux-plugin-qq-0.1.2-preview.1.tgz`,
                  integrity: wrapperSha512
                }
              }
            }
          })
        );
        return;
      }
      if (req.url === "/tarballs/prismux-plugin-qq-0.1.2-preview.1.tgz") {
        res.statusCode = 200;
        res.end(wrapperNpmTgz);
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    try {
      // Outer wrapper declares postinstall script -> must require audit confirmation first
      await assert.rejects(
        () =>
          installer.installFromNpm({
            packageNameOrTarball: "prismux-plugin-qq",
            registryUrl: registry.baseUrl,
            fallbackRegistryUrl: registry.baseUrl,
            expectedPluginId: "qq",
            ignoreScripts: true,
            distribution: "managed"
          }),
        PermissionAuditRequiredError
      );

      const installedV1 = await installer.installFromNpm({
        packageNameOrTarball: "prismux-plugin-qq",
        registryUrl: registry.baseUrl,
        fallbackRegistryUrl: registry.baseUrl,
        expectedPluginId: "qq",
        ignoreScripts: true,
        distribution: "managed",
        confirmedAudit: true
      });
      assert.equal(installedV1.manifest.id, "qq");
      assert.equal(installedV1.manifest.version, "0.1.2-preview.1");
      assert.equal(installedV1.distribution, "managed");
      assert.equal(installedV1.packageName, "@prismux/plugin-qq");
      assert.deepEqual(installedV1.ignoredInstallScripts, ["postinstall"]);
      assert.ok(existsSync(join(installedV1.installPath, "dist", "index.js")));
      assert.match(
        readFileSync(join(installedV1.installPath, "dist", "index.js"), "utf8"),
        /v1-unwrapped/
      );

      // 3. Upgrade via installLocalArchive to v2 and verify previous snapshot + rollback
      const innerWbV2 = createGzipTestTarball([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "@prismux/plugin-qq",
            version: "0.1.2-preview.2",
            main: "./dist/index.js",
            engines: { prismux: ">=0.1.0 <2.0.0" }
          })
        },
        {
          path: "plugin.manifest.json",
          content: JSON.stringify({
            id: "qq",
            version: "0.1.2-preview.2",
            realms: ["daemon", "ui"],
            permissions: ["network:outbound"],
            modelVisible: false
          })
        },
        {
          path: "dist/index.js",
          content: "export const marker = 'v2-upgraded'; export function apply() {}\n"
        }
      ]);

      const installedV2 = await installer.installLocalArchive(innerWbV2, {
        fileName: "prismux-plugin-qq-0.1.2-preview.2.wb-plugin"
      });
      assert.equal(installedV2.manifest.version, "0.1.2-preview.2");
      assert.equal(installedV2.previousVersion, "0.1.2-preview.1");
      assert.deepEqual(installer.listSnapshots("qq"), ["0.1.2-preview.1"]);
      assert.match(
        readFileSync(join(installedV2.installPath, "dist", "index.js"), "utf8"),
        /v2-upgraded/
      );

      const rolledBack = await installer.rollback("qq", "0.1.2-preview.1");
      assert.equal(rolledBack.manifest.version, "0.1.2-preview.1");
      assert.equal(rolledBack.previousVersion, "0.1.2-preview.2");
      assert.match(
        readFileSync(join(rolledBack.installPath, "dist", "index.js"), "utf8"),
        /v1-unwrapped/
      );

      // 4. Uninstall cleans both plugin dir and snapshots dir
      await installer.uninstall("qq");
      assert.equal(existsSync(join(pluginsDir, "qq")), false);
      assert.deepEqual(installer.listSnapshots("qq"), []);
    } finally {
      await closeHttpServer(registry.server);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
