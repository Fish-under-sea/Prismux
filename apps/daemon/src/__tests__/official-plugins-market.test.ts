import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertPluginSelfUpdateAllowed,
  ChecksumMismatchError,
  CordisPluginHost,
  CordisStreamingInstaller,
  EncryptedPluginCredentialStore,
  ManagedPluginSelfUpdateError,
  type CordisPluginModule
} from "@prismux/cordis-kernel";
import type { OfficialPluginCatalogEntry } from "@prismux/protocol";

function findRepoRoot(startDir: string): string {
  let cursor = resolve(startDir);
  while (true) {
    if (existsSync(join(cursor, "plugins-official", "catalog", "official.json"))) {
      return cursor;
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      throw new Error("Unable to locate Prismux monorepo root from test directory.");
    }
    cursor = parent;
  }
}

function getSanitizedNodeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  delete env["ELECTRON_NO_ATTACH_CONSOLE"];
  return env;
}

const tempRoots: string[] = [];
const cleanupJunctions: string[] = [];

after(() => {
  for (const linkPath of cleanupJunctions) {
    try {
      if (existsSync(linkPath)) {
        const stat = lstatSync(linkPath);
        if (stat.isSymbolicLink()) {
          unlinkSync(linkPath);
        } else {
          rmSync(linkPath, { recursive: true, force: true });
        }
      }
    } catch {
      // Best-effort temp link cleanup
    }
  }

  for (const root of tempRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Best-effort temp dir cleanup
    }
  }
});

function createTempMarketRoot(): {
  repoRoot: string;
  tempRoot: string;
  archiveOutDir: string;
  pluginsDir: string;
  dataDir: string;
} {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(here);
  const tempRoot = mkdtempSync(join(tmpdir(), "prismux-official-market-"));
  tempRoots.push(tempRoot);

  const scopeDir = join(tempRoot, "node_modules", "@prismux");
  mkdirSync(scopeDir, { recursive: true });
  const protocolLink = join(scopeDir, "protocol");
  symlinkSync(
    join(repoRoot, "packages", "protocol"),
    protocolLink,
    process.platform === "win32" ? "junction" : "dir"
  );
  cleanupJunctions.push(protocolLink);

  const archiveOutDir = join(tempRoot, "archives");
  const pluginsDir = join(tempRoot, "plugins");
  const dataDir = join(tempRoot, "data");
  mkdirSync(archiveOutDir, { recursive: true });
  mkdirSync(pluginsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  return { repoRoot, tempRoot, archiveOutDir, pluginsDir, dataDir };
}

function readRootPackageVersion(repoRoot: string): string {
  const pkgRaw = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8")
  ) as { version?: unknown };
  if (typeof pkgRaw.version !== "string" || pkgRaw.version.trim().length === 0) {
    throw new Error("Root package.json is missing a valid version string.");
  }
  return pkgRaw.version.trim();
}

function packOfficialPluginArchive(
  repoRoot: string,
  pluginId: string,
  outDir: string,
  version: string
): Buffer {
  const packScript = join(repoRoot, "scripts", "pack-plugin.ts");
  const pluginDir = join(repoRoot, "plugins-official", `plugin-${pluginId}`);
  execFileSync(
    process.execPath,
    [packScript, "--plugin", pluginDir, "--out", outDir],
    {
      cwd: repoRoot,
      env: getSanitizedNodeEnv(),
      encoding: "utf8"
    }
  );
  const archivePath = join(outDir, `${pluginId}-${version}.wb-plugin`);
  return readFileSync(archivePath);
}

test("official catalog metadata verifies all 4 plugins and deterministic .wb-plugin market install mounts/unmounts with zero residual", async () => {
  const { repoRoot, archiveOutDir, pluginsDir, dataDir } = createTempMarketRoot();
  const rootVersion = readRootPackageVersion(repoRoot);
  const installer = new CordisStreamingInstaller({
    pluginsDir,
    hostVersion: rootVersion
  });

  const catalogPath = join(repoRoot, "plugins-official", "catalog", "official.json");
  const catalog = await installer.loadOfficialCatalog(catalogPath);
  assert.equal(catalog.schemaVersion, 1);

  const entryById = new Map<string, OfficialPluginCatalogEntry>();
  for (const item of catalog.plugins) {
    entryById.set(item.id, item);
    assert.equal(item.status, "verified", `${item.id} must be verified in catalog`);
    assert.match(item.sha256 ?? "", /^[0-9a-f]{64}$/, `${item.id} must have sha256`);
    assert.ok((item.bytes ?? 0) > 0, `${item.id} must have positive bytes`);
  }

  assert.equal(catalog.plugins.length, 4);
  assert.equal(entryById.has("purge"), false);
  for (const expectedId of ["qq", "pet", "fishdock-hook", "ssh"]) {
    assert.ok(entryById.has(expectedId), `Catalog must include ${expectedId}`);
  }

  const host = new CordisPluginHost("daemon");
  const credStore = new EncryptedPluginCredentialStore({
    dataDir,
    masterKey: "official-plugins-market-test-master-key"
  });

  for (const targetId of ["qq", "pet"] as const) {
    const entry = entryById.get(targetId);
    assert.ok(entry !== undefined);

    const archiveBytes = packOfficialPluginArchive(
      repoRoot,
      targetId,
      archiveOutDir,
      rootVersion
    );
    const actualSha256 = createHash("sha256").update(archiveBytes).digest("hex");

    assert.equal(
      actualSha256,
      entry.sha256,
      `Packed ${targetId}.wb-plugin SHA-256 must match catalog/official.json`
    );
    assert.equal(
      archiveBytes.byteLength,
      entry.bytes,
      `Packed ${targetId}.wb-plugin byte length must match catalog/official.json`
    );

    const installed = await installer.installOfficialEntry(entry, archiveBytes);
    assert.equal(installed.distribution, "managed");
    assert.equal(installed.manifest.id, targetId);
    assert.equal(installed.sha256, entry.sha256);
    assert.throws(
      () => assertPluginSelfUpdateAllowed(installed),
      ManagedPluginSelfUpdateError
    );

    const entryUrl = pathToFileURL(join(installed.installPath, "dist", "index.js")).href;
    const loadedRaw = (await import(entryUrl)) as Record<string, unknown>;
    assert.ok(loadedRaw["manifest"] !== undefined);
    assert.equal(typeof loadedRaw["apply"], "function");

    const pluginModule = loadedRaw as unknown as CordisPluginModule;
    await host.mountPlugin(
      installed,
      pluginModule,
      credStore.openForPlugin(installed.manifest.id)
    );
    assert.equal(host.isMounted(targetId), true);
  }

  const mountedCounts = host.getActiveResourceCounts();
  assert.ok(mountedCounts.routes >= 10);
  assert.ok(mountedCounts.hooks >= 4);
  assert.ok(mountedCounts.effects >= 2);

  await host.unmountPlugin("qq");
  await host.unmountPlugin("pet");

  assert.equal(host.isMounted("qq"), false);
  assert.equal(host.isMounted("pet"), false);
  assert.deepEqual(host.getActiveResourceCounts(), {
    routes: 0,
    hooks: 0,
    panels: 0,
    styles: 0,
    timers: 0,
    effects: 0
  });
});

test("installOfficialEntry rejects 1-byte tampered .wb-plugin archive with ChecksumMismatchError", async () => {
  const { repoRoot, archiveOutDir, pluginsDir } = createTempMarketRoot();
  const rootVersion = readRootPackageVersion(repoRoot);
  const installer = new CordisStreamingInstaller({
    pluginsDir,
    hostVersion: rootVersion
  });

  const catalog = await installer.loadOfficialCatalog(
    join(repoRoot, "plugins-official", "catalog", "official.json")
  );
  const qqEntry = catalog.plugins.find((entry) => entry.id === "qq");
  assert.ok(qqEntry !== undefined);

  const original = packOfficialPluginArchive(
    repoRoot,
    "qq",
    archiveOutDir,
    rootVersion
  );
  const tampered = Buffer.from(original);
  const tamperIndex = Math.floor(tampered.length / 2);
  const originalByte = tampered[tamperIndex];
  assert.ok(originalByte !== undefined);
  tampered[tamperIndex] = originalByte ^ 0xff;

  await assert.rejects(
    () => installer.installOfficialEntry(qqEntry, tampered),
    (err: unknown) => {
      assert.ok(err instanceof ChecksumMismatchError);
      assert.equal(err.expected, qqEntry.sha256);
      assert.notEqual(err.actual, qqEntry.sha256);
      return true;
    }
  );
});
