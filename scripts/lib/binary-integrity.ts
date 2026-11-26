// @effect-diagnostics nodeBuiltinImport:off - Build-time binary integrity verification operates directly on host filesystem paths.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface PinnedBinaryDigest {
  readonly sha256: string;
  readonly bytes: number;
  readonly description: string;
}

export interface PinnedBinaryAllowlist {
  readonly version: string;
  readonly allowedSha256: readonly string[];
  readonly description: string;
}

/**
 * Cryptographic SHA-256 manifest pinning all vendored WebAssembly binaries,
 * vendored tarballs, native sqlite-vec libraries, and bundled 7-Zip executables.
 * Build and packaging scripts fail closed on any SHA-256 mismatch or unverified host copy.
 */
export const BINARY_SHA256_MANIFEST = {
  repoAssets: {
    "apps/web/src/terminal/ghostty/vendor/ghostty-vt.wasm": {
      sha256: "5e6a60cdfae2381b695c90d3bac0c039f63974e4c1373403a8cb6b37862133c6",
      bytes: 660_897,
      description: "Ghostty VT terminal emulator WASM module",
    },
    "apps/web/src/terminal/ghostty/vendor/ghostty-write-pty.wasm": {
      sha256: "75cb147e98ede3f85f3cd6236a30f6d12565b0b237e1d8db941f5f3e8ad3d903",
      bytes: 112,
      description: "Ghostty PTY write helper WASM module",
    },
    "apps/web/deps/pierre-words-0.2.2-t3.4-7c04b7f1.tgz": {
      sha256: "62f96487cad4f30d21edc021dc167f3edb83d50eec93ed9d0da8560d95fc48a8",
      bytes: 219_310,
      description: "Vendored @pierre/words@0.2.2-t3.4 tarball",
    },
  } satisfies Record<string, PinnedBinaryDigest>,
  sqliteVec: {
    "sqlite-vec-windows-x64/vec0.dll": {
      version: "0.1.9",
      allowedSha256: ["fcf98662a7ad9dce394b96a88f91032047823831b951c76636787c312a6476e6"],
      description: "sqlite-vec Windows x64 native extension (vec0.dll)",
    },
    "sqlite-vec-linux-x64/vec0.so": {
      version: "0.1.9",
      allowedSha256: ["5923730861b86c707cca5602b5f91092f9e52a46706dbc6e269fd4bb9c4498e8"],
      description: "sqlite-vec Linux x64 native extension (vec0.so)",
    },
  } satisfies Record<string, PinnedBinaryAllowlist>,
  sevenZip: {
    version: "24.09",
    sourceUrl: "https://www.7-zip.org/",
    licenseRepoPath: "scripts/licenses/7zip-LGPL-2.1.LICENSE",
    stagedLicenseFileName: "LICENSE-7zip-LGPL-2.1.txt",
    executableAllowedSha256: [
      // 7-Zip 24.09 x64 CLI executable (7z.exe staged as 7za.exe alongside 7z.dll)
      "e2ca3ec168ae9c0b4115cd4fe220145ea9b2dc4b6fc79d765e91f415b34d00de",
    ],
    dllAllowedSha256: [
      // 7-Zip 24.09 x64 core library (7z.dll)
      "882063948d675ee41b5ae68db3e84879350ec81cf88d15b9babf2fa08e332863",
    ],
  },
} as const;

// @effect-diagnostics-next-line extendsNativeError:off - Plain Node.js build helper runs outside Effect runtime (used by node:test and build-prismux-desktop.ts).
export class BinaryIntegrityError extends Error {
  readonly code: "MISSING_FILE" | "EMPTY_FILE" | "SHA256_MISMATCH" | "UNPINNED_BINARY";
  readonly filePath: string;
  readonly actualSha256: string | undefined;
  readonly expectedSha256: readonly string[];

  constructor(options: {
    readonly code: "MISSING_FILE" | "EMPTY_FILE" | "SHA256_MISMATCH" | "UNPINNED_BINARY";
    readonly filePath: string;
    readonly actualSha256?: string;
    readonly expectedSha256?: readonly string[];
    readonly message: string;
  }) {
    super(options.message);
    this.name = "BinaryIntegrityError";
    this.code = options.code;
    this.filePath = options.filePath;
    this.actualSha256 = options.actualSha256;
    this.expectedSha256 = options.expectedSha256 ?? [];
  }
}

export function normalizeSha256Hex(digest: string): string {
  const normalized = digest.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Invalid SHA-256 hex digest: "${digest}"`);
  }
  return normalized;
}

export function constantTimeSha256Equals(actualHex: string, expectedHex: string): boolean {
  const left = Buffer.from(normalizeSha256Hex(actualHex), "hex");
  const right = Buffer.from(normalizeSha256Hex(expectedHex), "hex");
  return left.length === right.length && NodeCrypto.timingSafeEqual(left, right);
}

export function computeFileSha256(filePath: string): { readonly sha256: string; readonly bytes: number } {
  if (!NodeFS.existsSync(filePath)) {
    throw new BinaryIntegrityError({
      code: "MISSING_FILE",
      filePath,
      message: `Pinned binary is missing: ${filePath}`,
    });
  }
  const bytes = NodeFS.readFileSync(filePath);
  if (bytes.length === 0) {
    throw new BinaryIntegrityError({
      code: "EMPTY_FILE",
      filePath,
      message: `Pinned binary is empty (0 bytes): ${filePath}`,
    });
  }
  return {
    sha256: NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}

export function verifyFileSha256(
  filePath: string,
  allowedSha256: readonly string[],
  label: string,
): { readonly sha256: string; readonly bytes: number } {
  if (allowedSha256.length === 0) {
    throw new BinaryIntegrityError({
      code: "UNPINNED_BINARY",
      filePath,
      message: `No pinned SHA-256 digests configured for ${label} (${filePath}); refusing unverified binary.`,
    });
  }
  const normalizedExpected = allowedSha256.map(normalizeSha256Hex);
  const { sha256, bytes } = computeFileSha256(filePath);
  const matched = normalizedExpected.some((expected) => constantTimeSha256Equals(sha256, expected));
  if (!matched) {
    throw new BinaryIntegrityError({
      code: "SHA256_MISMATCH",
      filePath,
      actualSha256: sha256,
      expectedSha256: normalizedExpected,
      message: `SHA-256 verification failed for ${label} (${filePath}): expected ${normalizedExpected.join(" | ")}, got ${sha256}`,
    });
  }
  return { sha256, bytes };
}

export function verifyPinnedRepoBinaries(
  repoRoot: string,
): ReadonlyArray<{ readonly relPath: string; readonly sha256: string; readonly bytes: number }> {
  const results: Array<{ readonly relPath: string; readonly sha256: string; readonly bytes: number }> =
    [];
  for (const [relPath, entry] of Object.entries(BINARY_SHA256_MANIFEST.repoAssets)) {
    const fullPath = NodePath.resolve(repoRoot, relPath);
    const verified = verifyFileSha256(fullPath, [entry.sha256], `${entry.description} [${relPath}]`);
    results.push({ relPath, sha256: verified.sha256, bytes: verified.bytes });
  }
  return results;
}

export function resolvePinnedSqliteVecDigests(
  pkgName: string,
  libName: string,
): readonly string[] | undefined {
  const key = `${pkgName}/${libName}` as keyof typeof BINARY_SHA256_MANIFEST.sqliteVec;
  const entry = BINARY_SHA256_MANIFEST.sqliteVec[key];
  return entry?.allowedSha256;
}

export function verifySqliteVecBinaryIntegrity(
  filePath: string,
  pkgName: string,
  libName: string,
  options?: { readonly expectedSha256?: readonly string[] },
): { readonly sha256: string; readonly bytes: number } {
  const allowed = options?.expectedSha256 ?? resolvePinnedSqliteVecDigests(pkgName, libName);
  if (!allowed || allowed.length === 0) {
    throw new BinaryIntegrityError({
      code: "UNPINNED_BINARY",
      filePath,
      message: `No pinned SHA-256 digest configured for sqlite-vec binary ${pkgName}/${libName} (${filePath}).`,
    });
  }
  return verifyFileSha256(filePath, allowed, `sqlite-vec ${pkgName}/${libName}`);
}

export function verifySevenZipBinaryIntegrity(
  exePath: string,
  options?: {
    readonly dllPath?: string;
    readonly expectedExeSha256?: readonly string[];
    readonly expectedDllSha256?: readonly string[];
  },
): {
  readonly exeSha256: string;
  readonly exeBytes: number;
  readonly dllSha256: string | undefined;
  readonly dllBytes: number | undefined;
} {
  const allowedExe =
    options?.expectedExeSha256 ?? BINARY_SHA256_MANIFEST.sevenZip.executableAllowedSha256;
  const exe = verifyFileSha256(exePath, allowedExe, "7-Zip executable (7za.exe / 7z.exe)");

  if (options?.dllPath !== undefined) {
    const allowedDll =
      options.expectedDllSha256 ?? BINARY_SHA256_MANIFEST.sevenZip.dllAllowedSha256;
    const dll = verifyFileSha256(options.dllPath, allowedDll, "7-Zip library (7z.dll)");
    return {
      exeSha256: exe.sha256,
      exeBytes: exe.bytes,
      dllSha256: dll.sha256,
      dllBytes: dll.bytes,
    };
  }

  return {
    exeSha256: exe.sha256,
    exeBytes: exe.bytes,
    dllSha256: undefined,
    dllBytes: undefined,
  };
}
