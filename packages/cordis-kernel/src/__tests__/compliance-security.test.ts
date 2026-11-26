import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import {
  ChecksumMismatchError,
  CordisStreamingInstaller,
  PermissionAuditRequiredError,
  RegistryNetworkError,
  TarSecurityError,
  normalizeAndValidateTarPath,
  probePluginRegistries
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

function buildPluginTgz(opts: {
  id: string;
  version?: string;
  modelVisible?: boolean;
  permissions?: string[];
  scripts?: Record<string, string>;
}): {
  tarball: Buffer;
  sha256: string;
  sha1: string;
  sriSha512: string;
  sriSha256: string;
} {
  const version = opts.version ?? "1.0.0";
  const tar = createTestUstarArchive([
    {
      path: "package/package.json",
      content: JSON.stringify({
        name: `prismux-plugin-${opts.id}`,
        version,
        engines: { prismux: ">=0.1.0 <2.0.0" },
        ...(opts.scripts ? { scripts: opts.scripts } : {})
      })
    },
    {
      path: "package/plugin.manifest.json",
      content: JSON.stringify({
        id: opts.id,
        version,
        realms: ["daemon"],
        permissions: opts.permissions ?? ["hooks:subscribe"],
        modelVisible: opts.modelVisible ?? false
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
    sha256: createHash("sha256").update(tarball).digest("hex"),
    sha1: createHash("sha1").update(tarball).digest("hex"),
    sriSha512: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
    sriSha256: `sha256-${createHash("sha256").update(tarball).digest("base64")}`
  };
}

async function startLocalServer(
  handler: http.RequestListener
): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const addr = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

async function closeLocalServer(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((err) => {
      if (err) rejectClose(err);
      else resolveClose();
    });
  });
}

test("P2-5 normalizeAndValidateTarPath blocks Windows reserved device names, NTFS ADS colons, forbidden chars, and trailing dots/spaces", () => {
  const blocked = [
    "CON",
    "con.txt",
    "package/PRN",
    "package/prn.js",
    "package/Aux/index.js",
    "package/nul.json",
    "package/COM1",
    "package/com9.d.ts",
    "package/LPT1.txt",
    "package/lpt9",
    "package/file.txt:hidden_stream",
    "package/dir:ads/index.js",
    "package/bad*name.js",
    "package/bad?name.js",
    'package/bad"name.js',
    "package/bad<name>.js",
    "package/bad|name.js",
    "package/trailing-dot.",
    "package/trailing-space ",
    "package/dir./index.js",
    "package/dir /index.js"
  ];

  for (const unsafePath of blocked) {
    assert.throws(
      () => normalizeAndValidateTarPath(unsafePath, false),
      TarSecurityError,
      `Expected TarSecurityError for "${unsafePath}"`
    );
  }

  // Safe lookalike names remain allowed
  for (const safePath of [
    "package/dist/index.js",
    "package/console.js",
    "package/null.js",
    "package/common/auxillary.js",
    "package/com10.js",
    "package/lpt0.js",
    "package/.prismux-install.json"
  ]) {
    assert.equal(normalizeAndValidateTarPath(safePath, false), safePath);
  }
});

test("P1-7 audit gate enforces confirmedAudit for modelVisible, hooks:intercept (even modelVisible=false), and ignored install scripts", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "prismux-cordis-audit-"));
  const pluginsDir = join(workDir, "plugins");
  try {
    const installer = new CordisStreamingInstaller({
      pluginsDir,
      hostVersion: "0.2.0"
    });

    // 1. hooks:intercept with modelVisible=false MUST require explicit confirmation
    const interceptPkg = buildPluginTgz({
      id: "intercept-only",
      modelVisible: false,
      permissions: ["hooks:intercept"]
    });
    await assert.rejects(
      () => installer.installLocalArchive(interceptPkg.tarball),
      (err: unknown) => {
        assert.ok(err instanceof PermissionAuditRequiredError);
        assert.equal(err.audit.requiresExplicitConfirmation, true);
        assert.equal(err.audit.modelVisible, false);
        assert.match(err.message, /hooks:intercept/);
        return true;
      }
    );
    assert.equal(existsSync(join(pluginsDir, "intercept-only")), false);

    const interceptConfirmed = await installer.installLocalArchive(interceptPkg.tarball, {
      confirmedAudit: true
    });
    assert.equal(interceptConfirmed.manifest.id, "intercept-only");

    // 2. postinstall script with modelVisible=false and no elevated permissions MUST require explicit confirmation
    const scriptPkg = buildPluginTgz({
      id: "script-only",
      modelVisible: false,
      permissions: ["ui:panel"],
      scripts: { postinstall: "node evil.js" }
    });
    await assert.rejects(
      () => installer.installLocalArchive(scriptPkg.tarball),
      (err: unknown) => {
        assert.ok(err instanceof PermissionAuditRequiredError);
        assert.equal(err.audit.requiresExplicitConfirmation, true);
        assert.deepEqual(err.audit.ignoredInstallScripts, ["postinstall"]);
        assert.match(err.message, /postinstall/);
        return true;
      }
    );
    assert.equal(existsSync(join(pluginsDir, "script-only")), false);

    const scriptConfirmed = await installer.installLocalArchive(scriptPkg.tarball, {
      confirmedAudit: true
    });
    assert.equal(scriptConfirmed.manifest.id, "script-only");
    assert.deepEqual(scriptConfirmed.ignoredInstallScripts, ["postinstall"]);

    // 3. Clean plugin (modelVisible=false, no hooks:intercept, no install scripts) installs without confirmation
    const cleanPkg = buildPluginTgz({
      id: "clean-plugin",
      modelVisible: false,
      permissions: ["ui:panel"]
    });
    const cleanInstalled = await installer.installLocalArchive(cleanPkg.tarball);
    assert.equal(cleanInstalled.manifest.id, "clean-plugin");
    assert.equal(cleanInstalled.audit.requiresExplicitConfirmation, false);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("P1-7 installFromNpm forbids file:// URLs and local filesystem paths and enforces fail-closed SRI/expectedSha256", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "prismux-cordis-sri-"));
  const pluginsDir = join(workDir, "plugins");
  const cleanPkg = buildPluginTgz({ id: "sri-demo" });
  const tamperedPkg = buildPluginTgz({ id: "sri-demo", version: "1.0.1" });
  const localTgzPath = join(workDir, "local-demo.tgz");
  writeFileSync(localTgzPath, cleanPkg.tarball);

  let registryMode: "no-integrity" | "sha1-only-shasum" | "unsupported-sri" | "sha256-sri" | "sha512-sri" | "tampered" =
    "no-integrity";
  let tarballHits = 0;

  const registry = await startLocalServer((req, res) => {
    const urlPath = req.url ?? "/";
    if (urlPath === "/prismux-plugin-sri-demo") {
      const dist: Record<string, string> = {
        tarball: `${registry.baseUrl}/tar/sri-demo.tgz`
      };
      if (registryMode === "sha1-only-shasum") {
        dist["shasum"] = cleanPkg.sha1;
      } else if (registryMode === "unsupported-sri") {
        dist["integrity"] = `md5-${createHash("md5").update(cleanPkg.tarball).digest("base64")}`;
      } else if (registryMode === "sha256-sri") {
        dist["integrity"] = cleanPkg.sriSha256;
      } else if (registryMode === "sha512-sri" || registryMode === "tampered") {
        dist["integrity"] = cleanPkg.sriSha512;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          name: "prismux-plugin-sri-demo",
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { version: "1.0.0", dist } }
        })
      );
      return;
    }
    if (urlPath === "/tar/sri-demo.tgz") {
      tarballHits += 1;
      const body =
        registryMode === "tampered" ? tamperedPkg.tarball : cleanPkg.tarball;
      res.writeHead(200, { "content-type": "application/gzip" });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  try {
    const installer = new CordisStreamingInstaller({
      pluginsDir,
      hostVersion: "0.2.0",
      defaultRegistryUrl: registry.baseUrl,
      defaultFallbackRegistryUrl: registry.baseUrl,
      allowInsecureLoopbackForTesting: true
    });

    // 1. Disallow file:// URLs and local paths in installFromNpm
    for (const forbiddenSpec of [
      pathToFileURL(localTgzPath).href,
      localTgzPath,
      "./local-demo.tgz",
      "../local-demo.tgz",
      "C:\\Windows\\System32\\cmd.exe"
    ]) {
      await assert.rejects(
        () =>
          installer.installFromNpm({
            packageNameOrTarball: forbiddenSpec,
            expectedSha256: cleanPkg.sha256,
            ignoreScripts: true,
            distribution: "managed"
          }),
        /Local filesystem paths and file:\/\/ URLs are forbidden/i
      );
    }

    // 2. Direct remote tarball URL WITHOUT expectedSha256 MUST fail closed before downloading
    tarballHits = 0;
    await assert.rejects(
      () =>
        installer.installFromNpm({
          packageNameOrTarball: `${registry.baseUrl}/tar/sri-demo.tgz`,
          ignoreScripts: true,
          distribution: "managed"
        }),
      /without valid SRI integrity/i
    );
    assert.equal(tarballHits, 0);

    // 3. Registry packument missing integrity -> fail closed before downloading tarball
    registryMode = "no-integrity";
    await assert.rejects(
      () =>
        installer.installFromNpm({
          packageNameOrTarball: "prismux-plugin-sri-demo",
          ignoreScripts: true,
          distribution: "managed"
        }),
      /without valid SRI integrity/i
    );
    assert.equal(tarballHits, 0);

    // 4. Registry packument with SHA-1 shasum only (no sha256/sha512 SRI) -> fail closed
    registryMode = "sha1-only-shasum";
    await assert.rejects(
      () =>
        installer.installFromNpm({
          packageNameOrTarball: "prismux-plugin-sri-demo",
          ignoreScripts: true,
          distribution: "managed"
        }),
      /without valid SRI integrity/i
    );
    assert.equal(tarballHits, 0);

    // 5. Unsupported SRI algorithm (md5-...) -> fail closed (never silently skipped!)
    registryMode = "unsupported-sri";
    await assert.rejects(
      () =>
        installer.installFromNpm({
          packageNameOrTarball: "prismux-plugin-sri-demo",
          ignoreScripts: true,
          distribution: "managed"
        }),
      /Unsupported SRI hash algorithm/i
    );
    assert.equal(tarballHits, 0);

    // 6. Valid sha256 SRI succeeds
    registryMode = "sha256-sri";
    const ok256 = await installer.installFromNpm({
      packageNameOrTarball: "prismux-plugin-sri-demo",
      ignoreScripts: true,
      distribution: "managed"
    });
    assert.equal(ok256.manifest.id, "sri-demo");

    // 7. Valid sha512 SRI succeeds
    registryMode = "sha512-sri";
    const ok512 = await installer.installFromNpm({
      packageNameOrTarball: "prismux-plugin-sri-demo",
      ignoreScripts: true,
      distribution: "managed"
    });
    assert.equal(ok512.manifest.id, "sri-demo");

    // 8. Tampered tarball with sha512 SRI fails with ChecksumMismatchError
    registryMode = "tampered";
    await assert.rejects(
      () =>
        installer.installFromNpm({
          packageNameOrTarball: "prismux-plugin-sri-demo",
          ignoreScripts: true,
          distribution: "managed"
        }),
      ChecksumMismatchError
    );
  } finally {
    await closeLocalServer(registry.server);
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("P1-6 StreamingInstaller enforces HTTPS-only by default, blocks untrusted redirect hosts, and strips Auth/Cookie headers cross-origin", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "prismux-cordis-net-"));
  const pluginsDir = join(workDir, "plugins");
  const cleanPkg = buildPluginTgz({ id: "redirect-demo" });

  let originAHeaders: http.IncomingHttpHeaders | undefined;
  let originBHeaders: http.IncomingHttpHeaders | undefined;
  let redirectMode: "cross-origin-loopback" | "disallowed-host" = "cross-origin-loopback";

  const originB = await startLocalServer((req, res) => {
    originBHeaders = req.headers;
    res.writeHead(200, { "content-type": "application/gzip" });
    res.end(cleanPkg.tarball);
  });

  const originA = await startLocalServer((req, res) => {
    originAHeaders = req.headers;
    if (redirectMode === "disallowed-host") {
      res.writeHead(302, { location: "https://evil.example.com/malicious.tgz" });
      res.end();
      return;
    }
    res.writeHead(302, { location: `${originB.baseUrl}/tar/redirect-demo.tgz` });
    res.end();
  });

  try {
    // 1. Without allowInsecureLoopbackForTesting, http://127.0.0.1 and http://registry.npmjs.org are rejected
    const prodInstaller = new CordisStreamingInstaller({
      pluginsDir,
      hostVersion: "0.2.0"
    });
    await assert.rejects(
      () =>
        prodInstaller.installFromNpm({
          packageNameOrTarball: `${originA.baseUrl}/tar/redirect-demo.tgz`,
          expectedSha256: cleanPkg.sha256,
          ignoreScripts: true,
          distribution: "managed"
        }),
      RegistryNetworkError
    );
    await assert.rejects(
      () =>
        prodInstaller.installFromNpm({
          packageNameOrTarball: "https://evil.example.com/tar/demo.tgz",
          expectedSha256: cleanPkg.sha256,
          ignoreScripts: true,
          distribution: "managed"
        }),
      /not in the trusted registry\/redirect allowlist/i
    );

    const probeReport = await probePluginRegistries({
      npmRegistryUrl: originA.baseUrl,
      npmMirrorRegistryUrl: originB.baseUrl
    });
    assert.equal(probeReport.registries[0].reachable, false);
    assert.match(probeReport.registries[0].error ?? "", /HTTPS required/i);

    // 2. With test loopback opt-in, cross-origin redirect (portA -> portB) strips Authorization, Cookie, Proxy-Authorization
    const testInstaller = new CordisStreamingInstaller({
      pluginsDir,
      hostVersion: "0.2.0",
      allowInsecureLoopbackForTesting: true
    });
    redirectMode = "cross-origin-loopback";
    const installed = await testInstaller.installFromNpm({
      packageNameOrTarball: `${originA.baseUrl}/start.tgz`,
      expectedSha256: cleanPkg.sha256,
      ignoreScripts: true,
      distribution: "managed",
      headers: {
        Authorization: "Bearer super-secret-token",
        Cookie: "session=secret-cookie",
        "Proxy-Authorization": "Basic c2VjcmV0",
        "X-Custom-Safe": "keep-me"
      }
    });
    assert.equal(installed.manifest.id, "redirect-demo");
    assert.equal(originAHeaders?.authorization, "Bearer super-secret-token");
    assert.equal(originAHeaders?.cookie, "session=secret-cookie");
    assert.equal(originAHeaders?.["proxy-authorization"], "Basic c2VjcmV0");
    assert.equal(originBHeaders?.authorization, undefined);
    assert.equal(originBHeaders?.cookie, undefined);
    assert.equal(originBHeaders?.["proxy-authorization"], undefined);
    assert.equal(originBHeaders?.["x-custom-safe"], "keep-me");

    // 3. Redirect to disallowed external HTTPS host is blocked even with test loopback opt-in
    redirectMode = "disallowed-host";
    await assert.rejects(
      () =>
        testInstaller.installFromNpm({
          packageNameOrTarball: `${originA.baseUrl}/start.tgz`,
          expectedSha256: cleanPkg.sha256,
          ignoreScripts: true,
          distribution: "managed"
        }),
      /not in the trusted registry\/redirect allowlist/i
    );
  } finally {
    await closeLocalServer(originA.server);
    await closeLocalServer(originB.server);
    rmSync(workDir, { recursive: true, force: true });
  }
});
