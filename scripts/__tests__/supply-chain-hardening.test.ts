import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

import {
  BINARY_SHA256_MANIFEST,
  BinaryIntegrityError,
  verifyPinnedRepoBinaries,
  verifySevenZipBinaryIntegrity,
  verifySqliteVecBinaryIntegrity,
} from "../lib/binary-integrity.ts";

const { after, describe, it } = NodeTest;
const assert = NodeAssert;

const REPO_ROOT = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../..");
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
});

describe("P2-3 GitHub Actions workflow supply-chain hardening", () => {
  it("pins all third-party actions in publish-github-packages.yml to 40-char commit SHAs, disables persist-credentials, and enforces strict SemVer on inputs.tag", () => {
    const workflowPath = NodePath.join(REPO_ROOT, ".github/workflows/publish-github-packages.yml");
    const yaml = NodeFS.readFileSync(workflowPath, "utf8");

    const usesMatches = [...yaml.matchAll(/uses:\s*([^\s#]+)/g)];
    assert.ok(usesMatches.length >= 3, "Expected at least 3 GitHub Actions uses: entries");
    for (const match of usesMatches) {
      const actionRef = match[1]!;
      assert.match(
        actionRef,
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/,
        `Action must be pinned to an immutable 40-char commit SHA: ${actionRef}`,
      );
    }

    assert.match(yaml, /actions\/checkout@[0-9a-f]{40}\s+#\s*v4\./);
    assert.match(yaml, /pnpm\/action-setup@[0-9a-f]{40}\s+#\s*v4\./);
    assert.match(yaml, /actions\/setup-node@[0-9a-f]{40}\s+#\s*v4\./);
    assert.match(yaml, /persist-credentials:\s*false/);
    assert.match(
      yaml,
      /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\(-\[0-9A-Za-z\.-\]\+\)\?\$/,
      "Workflow must validate inputs.tag against strict SemVer regex",
    );
    const validateIndex = yaml.indexOf("Validate workflow_dispatch tag input");
    const checkoutIndex = yaml.indexOf("uses: actions/checkout@");
    assert.ok(
      validateIndex !== -1 && checkoutIndex !== -1 && validateIndex < checkoutIndex,
      "Tag SemVer validation must run before actions/checkout",
    );
  });
});

describe("P2-4 install.sh and install.ps1 hardening", () => {
  it("install.sh enforces prismux/~/.prismux, GitHub Releases URL, HTTPS-only PRISMUX_RELEASE_BASE_URL, and mandatory SHA256SUMS + tar traversal guard", () => {
    const sh = NodeFS.readFileSync(NodePath.join(REPO_ROOT, "scripts/install.sh"), "utf8");

    assert.doesNotMatch(sh, /https?:\/\/prismux\.app\b/i, "Legacy prismux.app URL must be removed");
    assert.doesNotMatch(sh, /~\/\.t3\b/, "Legacy ~/.t3 directory must be removed");
    assert.match(sh, /https:\/\/github\.com\/\$\{repo\}\/releases/);
    assert.match(sh, /PRISMUX_RELEASE_BASE_URL must use https:\/\//);
    assert.match(sh, /--proto '=https' --tlsv1\.2/);
    assert.match(sh, /SHA256SUMS/);
    assert.match(sh, /checksum mismatch/);
    assert.match(sh, /tar -tzf/);
  });

  it("install.ps1 enforces prismux/~/.prismux, HTTPS-only, TLS 1.2 + TLS 1.3, mandatory SHA256SUMS, and ZipFile Zip-Slip validation (no Expand-Archive)", () => {
    const ps1 = NodeFS.readFileSync(NodePath.join(REPO_ROOT, "scripts/install.ps1"), "utf8");

    assert.doesNotMatch(ps1, /https?:\/\/prismux\.app\b/i, "Legacy prismux.app URL must be removed");
    assert.doesNotMatch(ps1, /~\\\.t3\b/, "Legacy ~\\.t3 directory must be removed");
    assert.doesNotMatch(ps1, /\bExpand-Archive\b/, "Unsafe Expand-Archive must be replaced by ZipFile");
    assert.match(ps1, /\[Net\.SecurityProtocolType\]::Tls12/);
    assert.match(ps1, /Tls13/);
    assert.match(ps1, /PRISMUX_RELEASE_BASE_URL must use https:\/\//);
    assert.match(ps1, /\[System\.IO\.Compression\.ZipFile\]::OpenRead/);
    assert.match(ps1, /refusing zip-slip/);
    assert.match(ps1, /SHA256SUMS/);

    // oxlint-disable-next-line prismux/no-global-process-runtime -- Standalone node:test runs outside Effect HostProcess layer and checks Windows host for PowerShell execution.
    if (NodeOS.platform() === "win32") {
      const tempRoot = makeTempDir("prismux-ps1-https-");
      const res = NodeChildProcess.spawnSync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", NodePath.join(REPO_ROOT, "scripts/install.ps1")],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PRISMUX_VERSION: "0.2.3",
            PRISMUX_HOME: NodePath.join(tempRoot, "home"),
            PRISMUX_INSTALL_BIN_DIR: NodePath.join(tempRoot, "bin"),
            PRISMUX_RELEASE_BASE_URL: "http://evil.example.test/releases",
          },
        },
      );
      assert.notEqual(res.status, 0, "install.ps1 must fail on plain http:// PRISMUX_RELEASE_BASE_URL");
      assert.match(`${res.stdout}\n${res.stderr}`, /must use https:\/\//i);

      // Verify the ZipFile Zip-Slip guard logic rejects an archive containing "../evil.txt"
      const slipCheckScript = NodePath.join(tempRoot, "check-zip-slip.ps1");
      const evilZip = NodePath.join(tempRoot, "evil.zip");
      const extractDir = NodePath.join(tempRoot, "extract");
      NodeFS.writeFileSync(
        slipCheckScript,
        [
          "$ErrorActionPreference = 'Stop'",
          "Add-Type -AssemblyName System.IO.Compression",
          "Add-Type -AssemblyName System.IO.Compression.FileSystem",
          `$zipPath = '${evilZip.replaceAll("'", "''")}'`,
          `$staging = '${extractDir.replaceAll("'", "''")}'`,
          "New-Item -ItemType Directory -Force -Path $staging | Out-Null",
          "$fs = [System.IO.File]::Create($zipPath)",
          "$za = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)",
          "$entry = $za.CreateEntry('../evil.txt')",
          "$sw = New-Object System.IO.StreamWriter($entry.Open())",
          "$sw.Write('pwned'); $sw.Dispose(); $za.Dispose(); $fs.Dispose()",
          "function Fail([string] $m) { Write-Error $m; exit 1 }",
          "$stagingFull = [System.IO.Path]::GetFullPath($staging) + [System.IO.Path]::DirectorySeparatorChar",
          "$zipArchive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)",
          "try {",
          "  foreach ($e in $zipArchive.Entries) {",
          "    $entryName = $e.FullName",
          "    $normalizedRel = $entryName -replace '/', '\\'",
          "    if (($normalizedRel.Split('\\')) -contains '..') { Fail \"refusing zip-slip traversal entry: $entryName\" }",
          "  }",
          "} finally { $zipArchive.Dispose() }",
        ].join("\r\n"),
        "utf8",
      );
      const slipRes = NodeChildProcess.spawnSync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", slipCheckScript],
        { encoding: "utf8" },
      );
      assert.notEqual(slipRes.status, 0, "Zip-Slip guard must reject ../evil.txt archive entry");
      assert.match(`${slipRes.stdout}\n${slipRes.stderr}`, /refusing zip-slip traversal entry/i);
      assert.equal(NodeFS.existsSync(NodePath.join(tempRoot, "evil.txt")), false);
    }
  });
});

describe("P2-2 binary SHA-256 integrity manifest", () => {
  it("verifies all pinned in-repo vendored WASM and tarball binaries pass SHA-256 verification", () => {
    const verified = verifyPinnedRepoBinaries(REPO_ROOT);
    assert.equal(verified.length, Object.keys(BINARY_SHA256_MANIFEST.repoAssets).length);
    for (const item of verified) {
      assert.match(item.sha256, /^[0-9a-f]{64}$/);
      assert.ok(item.bytes > 0);
    }
  });

  it("fails closed when any pinned WASM/tarball, sqlite-vec, or 7za.exe binary is tampered or unverified", () => {
    const tempRoot = makeTempDir("prismux-bin-tamper-");

    // 1. Copy pinned repo assets and tamper one byte of ghostty-vt.wasm
    for (const relPath of Object.keys(BINARY_SHA256_MANIFEST.repoAssets)) {
      const dest = NodePath.join(tempRoot, relPath);
      NodeFS.mkdirSync(NodePath.dirname(dest), { recursive: true });
      NodeFS.copyFileSync(NodePath.join(REPO_ROOT, relPath), dest);
    }
    assert.equal(verifyPinnedRepoBinaries(tempRoot).length, 3);

    const vtWasm = NodePath.join(tempRoot, "apps/web/src/terminal/ghostty/vendor/ghostty-vt.wasm");
    const tamperedBytes = Buffer.from(NodeFS.readFileSync(vtWasm));
    tamperedBytes[0] = (tamperedBytes[0]! ^ 0xff) & 0xff;
    NodeFS.writeFileSync(vtWasm, tamperedBytes);
    assert.throws(
      () => verifyPinnedRepoBinaries(tempRoot),
      (err: unknown) => err instanceof BinaryIntegrityError && err.code === "SHA256_MISMATCH",
    );

    // 2. Tampered vec0.dll fails closed against pinned digest
    const fakeVec = NodePath.join(tempRoot, "vec0.dll");
    NodeFS.writeFileSync(fakeVec, Buffer.alloc(1024, 0xaa));
    assert.throws(
      () => verifySqliteVecBinaryIntegrity(fakeVec, "sqlite-vec-windows-x64", "vec0.dll"),
      (err: unknown) => err instanceof BinaryIntegrityError && err.code === "SHA256_MISMATCH",
    );

    // 3. Unverified host 7za.exe fails closed against pinned digest
    const fake7za = NodePath.join(tempRoot, "7za.exe");
    const fake7zaBytes = Buffer.alloc(2048, 0x7a);
    NodeFS.writeFileSync(fake7za, fake7zaBytes);
    assert.throws(
      () => verifySevenZipBinaryIntegrity(fake7za),
      (err: unknown) => err instanceof BinaryIntegrityError && err.code === "SHA256_MISMATCH",
    );

    // Matching explicit digest passes
    const validSha = NodeCrypto.createHash("sha256").update(fake7zaBytes).digest("hex");
    const verified7za = verifySevenZipBinaryIntegrity(fake7za, { expectedExeSha256: [validSha] });
    assert.equal(verified7za.exeSha256, validSha);
  });
});
