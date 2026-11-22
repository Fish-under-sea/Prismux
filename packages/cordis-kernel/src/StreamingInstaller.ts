import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import * as http from "node:http";
import * as https from "node:https";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import {
  BRAND,
  UPDATE_ENDPOINTS,
  type InstalledPluginRecord,
  type NetworkRoutePreference,
  type OfficialPluginCatalog,
  type OfficialPluginCatalogEntry,
  type PluginDistribution,
  type PluginManifest,
  type PluginPermission,
  type PluginRealm,
  type PluginRegistryId
} from "@prismux/protocol";
import {
  checkPackageEngineCompatibility,
  checkTopLevelEngineCompatibility,
  compareSemver,
  parseSemver,
  satisfiesSemverRange,
  type EngineCompatibilityResult
} from "./semver.js";

const TAR_BLOCK_SIZE = 512;
const DEFAULT_REGISTRY_URL = UPDATE_ENDPOINTS.npmRegistry;
const DEFAULT_FALLBACK_REGISTRY_URL = UPDATE_ENDPOINTS.npmMirrorRegistry;
const DEFAULT_GITHUB_API_URL = UPDATE_ENDPOINTS.githubApiBase;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const INSTALL_METADATA_FILENAME = ".prismux-install.json";
const SAFE_PLUGIN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const INSTALL_LIFECYCLE_SCRIPT_NAMES = [
  "preinstall",
  "install",
  "postinstall",
  "prepare"
] as const;

const PERMISSION_LABELS_ZH: Record<string, { labelZh: string; elevated: boolean }> = {
  "network:outbound": { labelZh: "发起出站网络请求", elevated: false },
  "network:inbound": { labelZh: "监听入站网络请求与本地端口", elevated: true },
  "memory:private-chief": {
    labelZh: "读写主人私密主秘书记忆 (private/chief)",
    elevated: true
  },
  "memory:workspace": {
    labelZh: "读写工作区项目记忆 (workspace/*)",
    elevated: false
  },
  "memory:social-qq": {
    labelZh: "读写隔离 QQ 群聊记忆 (social/qq-group-*)",
    elevated: false
  },
  "hooks:subscribe": { labelZh: "只读订阅生命周期钩子事件", elevated: false },
  "hooks:intercept": {
    labelZh: "拦截并改写工具调用与模型生命周期钩子 (高风险)",
    elevated: true
  },
  "pty:spawn": { labelZh: "创建本地或远程交互式终端 (PTY)", elevated: true },
  "fs:read": { labelZh: "读取本地文件系统", elevated: false },
  "fs:write": { labelZh: "写入或修改本地文件系统", elevated: true },
  "ui:panel": { labelZh: "注册工作台分屏面板", elevated: false },
  "ui:status-bar": { labelZh: "注册状态栏与顶部胶囊组件", elevated: false },
  "pet:lease": { labelZh: "控制桌宠实例租约与演出状态", elevated: false },
  "notifications:push": { labelZh: "推送系统或灵动岛通知卡片", elevated: false }
};

export type AuditSeverity = "info" | "warning";

export interface PermissionAuditItem {
  permission: PluginPermission;
  labelZh: string;
  elevated: boolean;
}

export interface PermissionAuditCard {
  pluginId: string;
  version: string;
  severity: AuditSeverity;
  requiresExplicitConfirmation: boolean;
  modelVisible: boolean;
  permissions: PermissionAuditItem[];
  warnings: string[];
  ignoredInstallScripts: string[];
}

export interface PluginPackageJsonLike {
  name?: string;
  version?: string;
  engines?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface StreamingInstallOptions {
  packageNameOrTarball: string;
  registryUrl?: string;
  fallbackRegistryUrl?: string;
  networkPreference?: NetworkRoutePreference;
  expectedSha256?: string;
  ignoreScripts: true;
  distribution?: PluginDistribution;
  confirmedAudit?: boolean;
  hostVersion?: string;
  headers?: Record<string, string>;
}

export interface OfficialInstallOptions {
  confirmedAudit?: boolean;
  hostVersion?: string;
}

export interface InstalledPluginDetails extends InstalledPluginRecord {
  audit: PermissionAuditCard;
  registryUsed?: string;
  usedFallbackRegistry?: boolean;
  ignoredInstallScripts: string[];
}

export interface StreamingNpmInstaller {
  installFromNpm(options: StreamingInstallOptions): Promise<InstalledPluginRecord>;
  installOfficialEntry(
    entry: OfficialPluginCatalogEntry,
    archiveBytes: Uint8Array,
    options?: OfficialInstallOptions
  ): Promise<InstalledPluginRecord>;
  uninstall(pluginId: string): Promise<void>;
}

export interface CordisStreamingInstallerOptions {
  pluginsDir: string;
  hostVersion: string;
  defaultRegistryUrl?: string;
  defaultFallbackRegistryUrl?: string;
  networkPreference?: NetworkRoutePreference;
  githubApiBaseUrl?: string;
  requestTimeoutMs?: number;
  maxArchiveBytes?: number;
  maxUncompressedBytes?: number;
}

export interface RegistryOrderResolution {
  preference: NetworkRoutePreference;
  primary: string;
  fallback: string;
  order: string[];
}

export interface ProbePluginRegistriesOptions {
  npmRegistryUrl?: string;
  npmMirrorRegistryUrl?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  probePath?: string;
}

export interface PluginRegistryProbeEntry {
  id: PluginRegistryId;
  url: string;
  reachable: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error?: string;
}

export interface PluginRegistryProbeReport {
  probedAt: number;
  recommendedRegistryId: PluginRegistryId;
  recommendedUrl: string;
  fallbackUrl: string;
  order: [string, string];
  registries: [PluginRegistryProbeEntry, PluginRegistryProbeEntry];
}

export interface CommunityPluginSummary {
  fullName: string;
  name: string;
  description: string | null;
  htmlUrl: string;
  stars: number;
  topics: string[];
  defaultBranch: string;
  updatedAt: string;
}

export type CommunitySearchFetcher = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class TarSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TarSecurityError";
  }
}

export class TarFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TarFormatError";
  }
}

export class ChecksumMismatchError extends Error {
  readonly expected: string;
  readonly actual: string;

  constructor(expected: string, actual: string, algorithm = "sha256") {
    super(
      `${algorithm.toUpperCase()} checksum mismatch: expected ${expected}, got ${actual}.`
    );
    this.name = "ChecksumMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

export class EngineIncompatibleError extends Error {
  readonly result: EngineCompatibilityResult;

  constructor(result: EngineCompatibilityResult) {
    super(result.reason ?? "Plugin engines.prismux is incompatible with host.");
    this.name = "EngineIncompatibleError";
    this.result = result;
  }
}

export class PermissionAuditRequiredError extends Error {
  readonly audit: PermissionAuditCard;

  constructor(audit: PermissionAuditCard) {
    super(
      `Plugin "${audit.pluginId}" declares modelVisible=true and requires explicit audit confirmation (confirmedAudit: true).`
    );
    this.name = "PermissionAuditRequiredError";
    this.audit = audit;
  }
}

export class RegistryNetworkError extends Error {
  readonly url: string;

  constructor(url: string, message: string) {
    super(`Network error contacting registry (${url}): ${message}`);
    this.name = "RegistryNetworkError";
    this.url = url;
  }
}

export class RegistryHttpError extends Error {
  readonly url: string;
  readonly statusCode: number;

  constructor(url: string, statusCode: number, message?: string) {
    super(
      `Registry HTTP ${statusCode} for ${url}${message ? `: ${message}` : ""}`
    );
    this.name = "RegistryHttpError";
    this.url = url;
    this.statusCode = statusCode;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSafePluginId(pluginId: unknown): string {
  if (typeof pluginId !== "string" || pluginId.length === 0) {
    throw new Error("plugin.manifest.json field \"id\" must be a non-empty string.");
  }
  if (
    pluginId.includes("..") ||
    pluginId.includes("/") ||
    pluginId.includes("\\") ||
    pluginId.includes("\0") ||
    !SAFE_PLUGIN_ID_PATTERN.test(pluginId)
  ) {
    throw new Error(`Unsafe or invalid plugin ID: "${pluginId}".`);
  }
  return pluginId;
}

/**
 * Builds a Chinese permission audit card for a plugin manifest and optional `package.json`.
 * Marks `severity: "warning"` and `requiresExplicitConfirmation: true` when `modelVisible === true`,
 * `permissions` includes `hooks:intercept`, or `packageJson.scripts` contains install lifecycle hooks.
 */
export function buildPermissionAuditCard(
  manifest: PluginManifest,
  packageJson?: PluginPackageJsonLike
): PermissionAuditCard {
  const permissions: PermissionAuditItem[] = manifest.permissions.map((perm) => {
    const known = PERMISSION_LABELS_ZH[perm];
    if (known !== undefined) {
      return {
        permission: perm,
        labelZh: known.labelZh,
        elevated: known.elevated
      };
    }
    return {
      permission: perm,
      labelZh: `自定义权限 (${perm})`,
      elevated: false
    };
  });

  const warnings: string[] = [];
  const ignoredInstallScripts: string[] = [];

  if (manifest.modelVisible === true) {
    warnings.push(
      "该插件声明 modelVisible: true，可向大模型暴露工具或影响系统提示词，请二次确认后安装。"
    );
  }

  if (manifest.permissions.includes("hooks:intercept")) {
    warnings.push(
      "该插件请求 hooks:intercept 高危权限，可拦截并改写代理工具调用执行链路。"
    );
  }

  if (isPlainRecord(packageJson?.scripts)) {
    for (const scriptName of INSTALL_LIFECYCLE_SCRIPT_NAMES) {
      const scriptValue = packageJson.scripts[scriptName];
      if (typeof scriptValue === "string" && scriptValue.trim().length > 0) {
        ignoredInstallScripts.push(scriptName);
      }
    }
    if (ignoredInstallScripts.length > 0) {
      warnings.push(
        `检测到包内含安装脚本 (${ignoredInstallScripts.join(", ")})，已由安全策略强制禁用且绝不会执行。`
      );
    }
  }

  const requiresExplicitConfirmation =
    manifest.modelVisible === true ||
    manifest.permissions.includes("hooks:intercept") ||
    ignoredInstallScripts.length > 0;

  return {
    pluginId: manifest.id,
    version: manifest.version,
    severity: requiresExplicitConfirmation ? "warning" : "info",
    requiresExplicitConfirmation,
    modelVisible: manifest.modelVisible,
    permissions,
    warnings,
    ignoredInstallScripts
  };
}

function readNullTerminatedUtf8(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  const nulIdx = slice.indexOf(0);
  const end = nulIdx === -1 ? slice.length : nulIdx;
  return slice.subarray(0, end).toString("utf8");
}

function verifyTarHeaderChecksum(header: Buffer): void {
  const expectedOctal = readNullTerminatedUtf8(header, 148, 8).trim();
  const expected = Number.parseInt(expectedOctal, 8);
  if (Number.isNaN(expected)) {
    throw new TarFormatError(
      `Invalid tar header checksum string: "${expectedOctal}".`
    );
  }

  let unsignedSum = 0;
  for (let i = 0; i < TAR_BLOCK_SIZE; i += 1) {
    unsignedSum += i >= 148 && i < 156 ? 0x20 : (header[i] ?? 0);
  }
  if (unsignedSum !== expected) {
    throw new TarFormatError(
      `Tar header checksum mismatch: expected ${expected}, computed ${unsignedSum}.`
    );
  }
}

function parseOctalNumber(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  const value = Number.parseInt(trimmed, 8);
  if (!Number.isFinite(value) || value < 0) {
    throw new TarFormatError(`Invalid octal number in tar header: "${raw}".`);
  }
  return value;
}

function parsePaxRecords(buf: Buffer): Record<string, string> {
  const attrs: Record<string, string> = {};
  let pos = 0;
  while (pos < buf.length) {
    const spaceIdx = buf.indexOf(0x20, pos);
    if (spaceIdx === -1) {
      break;
    }
    const lenStr = buf.subarray(pos, spaceIdx).toString("ascii");
    const recLen = Number.parseInt(lenStr, 10);
    if (!Number.isFinite(recLen) || recLen <= 0 || pos + recLen > buf.length) {
      break;
    }
    const lineEnd =
      buf[pos + recLen - 1] === 0x0a ? pos + recLen - 1 : pos + recLen;
    const record = buf.subarray(spaceIdx + 1, lineEnd).toString("utf8");
    const eqIdx = record.indexOf("=");
    if (eqIdx !== -1) {
      const key = record.slice(0, eqIdx);
      const value = record.slice(eqIdx + 1);
      attrs[key] = value;
    }
    pos += recLen;
  }
  return attrs;
}

/**
 * Validates and normalizes a tar entry path strictly against Tar-Slip path traversal,
 * absolute paths, Windows drive paths, backslashes, and NUL bytes.
 */
export function normalizeAndValidateTarPath(
  rawPath: string,
  isDirectory: boolean
): string | null {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    throw new TarSecurityError("Tar entry path cannot be empty.");
  }
  if (rawPath.includes("\0")) {
    throw new TarSecurityError(
      `Tar entry path contains NUL byte: "${rawPath}".`
    );
  }
  if (rawPath.includes("\\")) {
    throw new TarSecurityError(
      `Tar entry path contains forbidden backslash: "${rawPath}".`
    );
  }
  if (rawPath.startsWith("/") || /^[A-Za-z]:/.test(rawPath)) {
    throw new TarSecurityError(
      `Absolute tar entry path is forbidden: "${rawPath}".`
    );
  }

  let candidate = rawPath;
  if (isDirectory && candidate.endsWith("/")) {
    candidate = candidate.slice(0, -1);
    if (candidate === "." || candidate === "") {
      return null;
    }
  }

  const segments = candidate.split("/");
  if (segments[0] === "." && segments.length > 1) {
    segments.shift();
  }
  if (segments.length === 1 && segments[0] === "." && isDirectory) {
    return null;
  }

  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      throw new TarSecurityError(
        `Tar-Slip path traversal or unsafe segment detected: "${rawPath}".`
      );
    }
  }

  return segments.join("/");
}

interface ExtractedArchiveStats {
  files: string[];
  dirs: string[];
}

/**
 * Streaming POSIX ustar / PAX / GNU-longname tar extractor that writes validated
 * regular files directly to `destDir` while rejecting symlinks, hardlinks, and Tar-Slip.
 */
async function extractSafeTarFromStream(
  tarInput: Readable,
  destDir: string,
  options?: { maxEntryBytes?: number; gunzipMaxOutputBytes?: number }
): Promise<ExtractedArchiveStats> {
  const maxEntryBytes = options?.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
  const resolvedDest = resolve(destDir);
  await mkdir(resolvedDest, { recursive: true });

  const extractedFiles: string[] = [];
  const extractedDirs: string[] = [];
  const createdDirs = new Set<string>([resolvedDest]);

  const ensureDir = async (dirPath: string): Promise<void> => {
    if (createdDirs.has(dirPath)) {
      return;
    }
    await mkdir(dirPath, { recursive: true });
    createdDirs.add(dirPath);
  };

  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let finishedZero = false;
  let state: "header" | "body" = "header";

  let currentType = "0";
  let currentPath: string | null = null;
  let currentRemainingSize = 0;
  let currentPaddingBytes = 0;
  let metaChunks: Buffer[] = [];
  let currentFileChunks: Buffer[] = [];

  let nextPaxAttrs: Record<string, string> = {};
  let globalPaxAttrs: Record<string, string> = {};
  let nextGnuLongName: string | null = null;

  const processBuffer = async (): Promise<void> => {
    while (true) {
      if (finishedZero) {
        pending = Buffer.alloc(0);
        return;
      }

      if (state === "header") {
        if (pending.length < TAR_BLOCK_SIZE) {
          return;
        }
        const header = pending.subarray(0, TAR_BLOCK_SIZE);
        pending = pending.subarray(TAR_BLOCK_SIZE);

        let isAllZero = true;
        for (let i = 0; i < TAR_BLOCK_SIZE; i += 1) {
          if (header[i] !== 0) {
            isAllZero = false;
            break;
          }
        }
        if (isAllZero) {
          finishedZero = true;
          pending = Buffer.alloc(0);
          return;
        }

        verifyTarHeaderChecksum(header);

        const typeByte = header[156] ?? 0;
        const typeflag = typeByte === 0 ? "0" : String.fromCharCode(typeByte);

        // Hardlinks ('1'), symlinks ('2'), devices/FIFOs ('3','4','6'), GNU longlink ('K') are strictly forbidden.
        if (
          typeflag === "1" ||
          typeflag === "2" ||
          typeflag === "3" ||
          typeflag === "4" ||
          typeflag === "6" ||
          typeflag === "K"
        ) {
          throw new TarSecurityError(
            `Forbidden tar entry type "${typeflag}" (symlinks, hardlinks, and special devices are blocked).`
          );
        }

        if (
          typeflag !== "0" &&
          typeflag !== "5" &&
          typeflag !== "x" &&
          typeflag !== "g" &&
          typeflag !== "L"
        ) {
          throw new TarFormatError(`Unsupported tar entry type "${typeflag}".`);
        }

        const headerName = readNullTerminatedUtf8(header, 0, 100);
        const headerPrefix = readNullTerminatedUtf8(header, 345, 155);
        const headerSize = parseOctalNumber(readNullTerminatedUtf8(header, 124, 12));

        const combinedPax = { ...globalPaxAttrs, ...nextPaxAttrs };
        const paxSizeRaw = combinedPax["size"];
        const effectiveSize =
          paxSizeRaw !== undefined
            ? /^\d+$/.test(paxSizeRaw)
              ? Number.parseInt(paxSizeRaw, 10)
              : Number.NaN
            : headerSize;

        if (!Number.isInteger(effectiveSize) || effectiveSize < 0) {
          throw new TarFormatError(`Invalid tar entry size (${effectiveSize}).`);
        }
        if (effectiveSize > maxEntryBytes) {
          throw new TarFormatError(
            `Tar entry exceeds maximum allowed size (${effectiveSize} > ${maxEntryBytes}).`
          );
        }

        const rawPath =
          nextGnuLongName ??
          combinedPax["path"] ??
          (headerPrefix.length > 0 ? `${headerPrefix}/${headerName}` : headerName);

        if (typeflag === "0" || typeflag === "5") {
          const normalized = normalizeAndValidateTarPath(
            rawPath,
            typeflag === "5"
          );
          // Consume per-entry overrides only for real filesystem entries.
          nextPaxAttrs = {};
          nextGnuLongName = null;
          currentPath = normalized;

          if (typeflag === "5") {
            if (normalized !== null) {
              const targetDir = resolve(resolvedDest, normalized);
              const rel = relative(resolvedDest, targetDir);
              if (rel.startsWith("..") || isAbsolute(rel)) {
                throw new TarSecurityError(
                  `Directory path escaped staging directory: "${rawPath}".`
                );
              }
              await ensureDir(targetDir);
              extractedDirs.push(normalized);
            }
          }
        } else {
          // 'x', 'g', 'L' metadata entries
          currentPath = null;
        }

        currentType = typeflag;
        currentRemainingSize = effectiveSize;
        const remainder = effectiveSize % TAR_BLOCK_SIZE;
        currentPaddingBytes = remainder === 0 ? 0 : TAR_BLOCK_SIZE - remainder;
        metaChunks = [];
        currentFileChunks = [];

        if (effectiveSize === 0 && currentPaddingBytes === 0) {
          if (currentType === "0" && currentPath !== null) {
            const targetFile = resolve(resolvedDest, currentPath);
            const rel = relative(resolvedDest, targetFile);
            if (rel.startsWith("..") || isAbsolute(rel) || rel === "") {
              throw new TarSecurityError(
                `File path escaped staging directory: "${currentPath}".`
              );
            }
            await ensureDir(dirname(targetFile));
            await writeFile(targetFile, Buffer.alloc(0));
            extractedFiles.push(currentPath);
          }
          state = "header";
        } else {
          state = "body";
        }
        continue;
      }

      // state === "body"
      if (currentRemainingSize > 0) {
        if (pending.length === 0) {
          return;
        }
        const take = Math.min(currentRemainingSize, pending.length);
        const slice = pending.subarray(0, take);
        pending = pending.subarray(take);
        currentRemainingSize -= take;

        if (currentType === "x" || currentType === "g" || currentType === "L") {
          metaChunks.push(Buffer.from(slice));
        } else if (currentType === "0") {
          currentFileChunks.push(Buffer.from(slice));
        }

        if (currentRemainingSize === 0) {
          if (currentType === "x") {
            nextPaxAttrs = {
              ...nextPaxAttrs,
              ...parsePaxRecords(Buffer.concat(metaChunks))
            };
          } else if (currentType === "g") {
            globalPaxAttrs = {
              ...globalPaxAttrs,
              ...parsePaxRecords(Buffer.concat(metaChunks))
            };
          } else if (currentType === "L") {
            const longStr = Buffer.concat(metaChunks).toString("utf8");
            const nul = longStr.indexOf("\0");
            nextGnuLongName = nul === -1 ? longStr : longStr.slice(0, nul);
          } else if (currentType === "0" && currentPath !== null) {
            const targetFile = resolve(resolvedDest, currentPath);
            const rel = relative(resolvedDest, targetFile);
            if (rel.startsWith("..") || isAbsolute(rel) || rel === "") {
              throw new TarSecurityError(
                `File path escaped staging directory: "${currentPath}".`
              );
            }
            await ensureDir(dirname(targetFile));
            await writeFile(targetFile, Buffer.concat(currentFileChunks));
            extractedFiles.push(currentPath);
          }
          metaChunks = [];
          currentFileChunks = [];
        }
        continue;
      }

      if (currentPaddingBytes > 0) {
        if (pending.length === 0) {
          return;
        }
        const skip = Math.min(currentPaddingBytes, pending.length);
        pending = pending.subarray(skip);
        currentPaddingBytes -= skip;
      }

      if (currentRemainingSize === 0 && currentPaddingBytes === 0) {
        state = "header";
      }
    }
  };

  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      void processBuffer().then(
        () => callback(),
        (err) => callback(err instanceof Error ? err : new Error(String(err)))
      );
    },
    final(callback): void {
      if (state === "body" || (!finishedZero && pending.length > 0)) {
        callback(new TarFormatError("Unexpected end of tar archive."));
        return;
      }
      callback();
    }
  });

  if (options?.gunzipMaxOutputBytes !== undefined) {
    const gunzip = createGunzip({
      maxOutputLength: options.gunzipMaxOutputBytes
    });
    await pipeline(tarInput, gunzip, sink);
  } else {
    await pipeline(tarInput, sink);
  }
  return { files: extractedFiles, dirs: extractedDirs };
}

interface StreamExtractResult {
  sha256: string;
  sha512: string;
  sha1: string;
  bytes: number;
  files: string[];
  dirs: string[];
}

/**
 * Streams a `.tar`, `.tgz`, or `.wb-plugin` archive directly from a `Readable` source
 * into `stagingDir` while computing SHA-256 / SHA-512 / SHA-1 hashes and enforcing
 * archive size caps + Tar-Slip / symlink defenses.
 */
async function streamArchiveToStaging(
  source: Readable,
  stagingDir: string,
  options: {
    maxArchiveBytes: number;
    maxUncompressedBytes: number;
  }
): Promise<StreamExtractResult> {
  const hash256 = createHash("sha256");
  const hash512 = createHash("sha512");
  const hash1 = createHash("sha1");
  let totalBytes = 0;

  const iterator = source[Symbol.asyncIterator]();
  const initialParts: Buffer[] = [];
  let initialLen = 0;

  try {
    while (initialLen < 2) {
      const next = await iterator.next();
      if (next.done) {
        break;
      }
      const buf = Buffer.isBuffer(next.value)
        ? next.value
        : Buffer.from(next.value as Uint8Array);
      if (buf.length === 0) {
        continue;
      }
      totalBytes += buf.length;
      if (totalBytes > options.maxArchiveBytes) {
        throw new TarFormatError(
          `Archive exceeds maximum allowed compressed size (${options.maxArchiveBytes} bytes).`
        );
      }
      hash256.update(buf);
      hash512.update(buf);
      hash1.update(buf);
      initialParts.push(buf);
      initialLen += buf.length;
    }

    if (initialLen === 0) {
      throw new TarFormatError("Plugin archive stream is empty.");
    }

    const headBuf = Buffer.concat(initialParts);
    const isGzip = headBuf.length >= 2 && headBuf[0] === 0x1f && headBuf[1] === 0x8b;

    async function* generateRawChunks(): AsyncGenerator<Buffer> {
      yield headBuf;
      while (true) {
        const next = await iterator.next();
        if (next.done) {
          break;
        }
        const buf = Buffer.isBuffer(next.value)
          ? next.value
          : Buffer.from(next.value as Uint8Array);
        if (buf.length === 0) {
          continue;
        }
        totalBytes += buf.length;
        if (totalBytes > options.maxArchiveBytes) {
          throw new TarFormatError(
            `Archive exceeds maximum allowed compressed size (${options.maxArchiveBytes} bytes).`
          );
        }
        hash256.update(buf);
        hash512.update(buf);
        hash1.update(buf);
        yield buf;
      }
    }

    const rawReadable = Readable.from(generateRawChunks());
    const stats = await extractSafeTarFromStream(rawReadable, stagingDir, {
      gunzipMaxOutputBytes: isGzip ? options.maxUncompressedBytes : undefined
    });

    return {
      sha256: hash256.digest("hex"),
      sha512: hash512.digest("hex"),
      sha1: hash1.digest("hex"),
      bytes: totalBytes,
      files: stats.files,
      dirs: stats.dirs
    };
  } finally {
    source.destroy();
  }
}

interface HttpResponseStream {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  stream: http.IncomingMessage;
  finalUrl: string;
}

function openHttpStream(
  rawUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
  redirectsRemaining = 5
): Promise<HttpResponseStream> {
  return new Promise((resolvePromise, rejectPromise) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      rejectPromise(new RegistryNetworkError(rawUrl, "Invalid URL."));
      return;
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      rejectPromise(
        new RegistryNetworkError(
          rawUrl,
          `Unsupported protocol "${parsedUrl.protocol}".`
        )
      );
      return;
    }

    const transport = parsedUrl.protocol === "https:" ? https : http;
    const req = transport.request(
      parsedUrl,
      {
        method: "GET",
        agent: false,
        headers: {
          "user-agent": "Prismux-Cordis-Kernel/0.1",
          connection: "close",
          ...headers
        }
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        const location = res.headers.location;
        if (
          (statusCode === 301 ||
            statusCode === 302 ||
            statusCode === 303 ||
            statusCode === 307 ||
            statusCode === 308) &&
          typeof location === "string" &&
          location.length > 0 &&
          redirectsRemaining > 0
        ) {
          res.resume();
          const nextUrl = new URL(location, parsedUrl).toString();
          openHttpStream(
            nextUrl,
            headers,
            timeoutMs,
            redirectsRemaining - 1
          ).then(resolvePromise, rejectPromise);
          return;
        }

        resolvePromise({
          statusCode,
          headers: res.headers,
          stream: res,
          finalUrl: parsedUrl.toString()
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new RegistryNetworkError(rawUrl, `Request timed out after ${timeoutMs}ms.`));
    });

    req.on("error", (err) => {
      if (err instanceof RegistryNetworkError) {
        rejectPromise(err);
      } else {
        rejectPromise(new RegistryNetworkError(rawUrl, err.message));
      }
    });

    req.end();
  });
}

async function fetchJsonViaHttp(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<unknown> {
  const response = await openHttpStream(url, headers, timeoutMs);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    response.stream.resume();
    throw new RegistryHttpError(url, response.statusCode);
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  const maxJsonBytes = 16 * 1024 * 1024;
  for await (const chunk of response.stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buf.length;
    if (bytes > maxJsonBytes) {
      response.stream.destroy();
      throw new RegistryHttpError(url, response.statusCode, "JSON payload too large.");
    }
    chunks.push(buf);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON response from ${url}: ${message}`);
  }
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function parseNpmPackageSpec(spec: string): {
  name: string;
  rangeOrTag: string;
} {
  const trimmed = spec.trim();
  if (trimmed.length === 0) {
    throw new Error("Package specifier must be a non-empty string.");
  }

  if (trimmed.startsWith("@")) {
    const slashIdx = trimmed.indexOf("/");
    if (slashIdx <= 1) {
      throw new Error(`Invalid scoped npm package specifier: "${spec}".`);
    }
    const versionAtIdx = trimmed.indexOf("@", slashIdx + 1);
    if (versionAtIdx === -1) {
      return { name: trimmed, rangeOrTag: "latest" };
    }
    const name = trimmed.slice(0, versionAtIdx);
    const rangeOrTag = trimmed.slice(versionAtIdx + 1).trim() || "latest";
    return { name, rangeOrTag };
  }

  const atIdx = trimmed.indexOf("@");
  if (atIdx === -1) {
    return { name: trimmed, rangeOrTag: "latest" };
  }
  const name = trimmed.slice(0, atIdx);
  const rangeOrTag = trimmed.slice(atIdx + 1).trim() || "latest";
  return { name, rangeOrTag };
}

function encodeNpmPackageUrlSegment(name: string): string {
  if (name.startsWith("@")) {
    const slashIdx = name.indexOf("/");
    const scope = name.slice(1, slashIdx);
    const pkg = name.slice(slashIdx + 1);
    return `@${encodeURIComponent(scope)}%2F${encodeURIComponent(pkg)}`;
  }
  return encodeURIComponent(name);
}

interface NpmPackumentVersion {
  version?: string;
  engines?: Record<string, unknown>;
  dist?: {
    tarball?: string;
    shasum?: string;
    integrity?: string;
  };
}

function resolvePackumentVersion(
  packument: Record<string, unknown>,
  rangeOrTag: string
): { version: string; versionDoc: NpmPackumentVersion } {
  const distTags = isPlainRecord(packument["dist-tags"])
    ? packument["dist-tags"]
    : {};
  const versionsObj = isPlainRecord(packument["versions"])
    ? packument["versions"]
    : null;

  if (versionsObj === null) {
    throw new Error("Invalid npm packument: missing \"versions\" map.");
  }

  const tagVersion = distTags[rangeOrTag];
  if (typeof tagVersion === "string" && isPlainRecord(versionsObj[tagVersion])) {
    return {
      version: tagVersion,
      versionDoc: versionsObj[tagVersion] as NpmPackumentVersion
    };
  }

  if (isPlainRecord(versionsObj[rangeOrTag])) {
    return {
      version: rangeOrTag,
      versionDoc: versionsObj[rangeOrTag] as NpmPackumentVersion
    };
  }

  const matchingVersions = Object.keys(versionsObj)
    .filter((ver) => parseSemver(ver) !== null && satisfiesSemverRange(ver, rangeOrTag))
    .sort((a, b) => compareSemver(b, a));

  const best = matchingVersions[0];
  if (best !== undefined && isPlainRecord(versionsObj[best])) {
    return {
      version: best,
      versionDoc: versionsObj[best] as NpmPackumentVersion
    };
  }

  throw new Error(
    `No version matching "${rangeOrTag}" found in npm packument.`
  );
}

function verifyExtractedIntegrity(
  actual: StreamExtractResult,
  expected: {
    expectedSha256?: string;
    integrity?: string;
    shasum?: string;
  }
): void {
  if (expected.expectedSha256 !== undefined) {
    const normalizedExpected = expected.expectedSha256.trim().toLowerCase();
    if (actual.sha256.toLowerCase() !== normalizedExpected) {
      throw new ChecksumMismatchError(normalizedExpected, actual.sha256, "sha256");
    }
  }

  if (typeof expected.integrity === "string" && expected.integrity.trim().length > 0) {
    const sri = expected.integrity.trim();
    if (sri.startsWith("sha512-")) {
      const expectedHex = Buffer.from(sri.slice("sha512-".length), "base64").toString("hex");
      if (actual.sha512 !== expectedHex) {
        throw new ChecksumMismatchError(expectedHex, actual.sha512, "sha512");
      }
    } else if (sri.startsWith("sha256-")) {
      const expectedHex = Buffer.from(sri.slice("sha256-".length), "base64").toString("hex");
      if (actual.sha256 !== expectedHex) {
        throw new ChecksumMismatchError(expectedHex, actual.sha256, "sha256");
      }
    }
  }

  if (typeof expected.shasum === "string" && expected.shasum.trim().length > 0) {
    const expectedSha1 = expected.shasum.trim().toLowerCase();
    if (actual.sha1.toLowerCase() !== expectedSha1) {
      throw new ChecksumMismatchError(expectedSha1, actual.sha1, "sha1");
    }
  }
}

function readJsonFileRecord(filePath: string, label: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    throw new Error(`Plugin archive is missing required ${label}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${label}: ${message}`);
  }
  if (!isPlainRecord(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
}

function validateExtractedManifest(raw: Record<string, unknown>): PluginManifest {
  const id = validateSafePluginId(raw["id"]);
  const versionRaw = raw["version"];
  if (typeof versionRaw !== "string" || parseSemver(versionRaw) === null) {
    throw new Error(
      `plugin.manifest.json field "version" must be a valid SemVer 2.0 string, got "${String(versionRaw)}".`
    );
  }
  const realmsRaw = raw["realms"];
  if (
    !Array.isArray(realmsRaw) ||
    realmsRaw.length === 0 ||
    !realmsRaw.every((item): item is PluginRealm => item === "daemon" || item === "ui")
  ) {
    throw new Error(
      "plugin.manifest.json field \"realms\" must be a non-empty array of \"daemon\" | \"ui\"."
    );
  }
  const permissionsRaw = raw["permissions"];
  if (
    !Array.isArray(permissionsRaw) ||
    !permissionsRaw.every((item): item is string => typeof item === "string")
  ) {
    throw new Error("plugin.manifest.json field \"permissions\" must be a string array.");
  }
  const modelVisibleRaw = raw["modelVisible"];
  if (typeof modelVisibleRaw !== "boolean") {
    throw new Error("plugin.manifest.json field \"modelVisible\" must be a boolean.");
  }

  return {
    id,
    version: versionRaw.trim(),
    realms: [...realmsRaw],
    permissions: [...permissionsRaw],
    modelVisible: modelVisibleRaw,
    behaviors: isPlainRecord(raw["behaviors"])
      ? (raw["behaviors"] as PluginManifest["behaviors"])
      : undefined
  };
}

function resolvePluginRootInStaging(
  stagingDir: string,
  extractedFiles: readonly string[]
): string {
  if (extractedFiles.length === 0) {
    throw new TarFormatError("Plugin archive contains no regular files.");
  }

  const allInsidePackageDir = extractedFiles.every((filePath) =>
    filePath.startsWith("package/")
  );
  const packagedDir = join(stagingDir, "package");
  if (
    allInsidePackageDir &&
    existsSync(join(packagedDir, "package.json")) &&
    !existsSync(join(stagingDir, "package.json"))
  ) {
    return packagedDir;
  }
  return stagingDir;
}

function isFallbackEligibleError(error: unknown): boolean {
  if (error instanceof RegistryNetworkError) {
    return true;
  }
  if (
    error instanceof RegistryHttpError &&
    (error.statusCode >= 500 ||
      error.statusCode === 404 ||
      error.statusCode === 408 ||
      error.statusCode === 429)
  ) {
    return true;
  }
  return false;
}

/**
 * Resolves the primary/fallback npm registry order for a given network route preference.
 * - `domestic`: `npmmirror` first, `npmjs` fallback
 * - `global` / `auto` (static default): `npmjs` first, `npmmirror` fallback
 */
export function resolveRegistryOrder(
  preference: NetworkRoutePreference = "auto",
  primaryOverride?: string,
  fallbackOverride?: string
): RegistryOrderResolution {
  const globalUrl = normalizeBaseUrl(primaryOverride ?? DEFAULT_REGISTRY_URL);
  const domesticUrl = normalizeBaseUrl(
    fallbackOverride ?? DEFAULT_FALLBACK_REGISTRY_URL
  );

  const primary = preference === "domestic" ? domesticUrl : globalUrl;
  const fallback = preference === "domestic" ? globalUrl : domesticUrl;
  const order =
    fallback.length === 0 || fallback === primary ? [primary] : [primary, fallback];

  return {
    preference,
    primary,
    fallback,
    order
  };
}

async function probeSingleRegistry(
  id: PluginRegistryId,
  baseUrl: string,
  probePath: string,
  timeoutMs: number,
  headers: Record<string, string>
): Promise<PluginRegistryProbeEntry> {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const normalizedPath = probePath.startsWith("/") ? probePath : `/${probePath}`;
  const targetUrl = `${normalizedBase}${normalizedPath}`;
  const startedAt = performance.now();

  try {
    const response = await openHttpStream(
      targetUrl,
      {
        accept: "application/json",
        ...headers
      },
      timeoutMs,
      3
    );
    response.stream.resume();
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    const reachable = response.statusCode >= 200 && response.statusCode < 400;
    return {
      id,
      url: normalizedBase,
      reachable,
      statusCode: response.statusCode,
      latencyMs,
      ...(reachable ? {} : { error: `HTTP ${response.statusCode}` })
    };
  } catch (error) {
    return {
      id,
      url: normalizedBase,
      reachable: false,
      statusCode: null,
      latencyMs: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Concurrently probes `registry.npmjs.org` and `registry.npmmirror.com` (or custom URLs)
 * and ranks the fastest reachable registry first, keeping the other as automatic fallback.
 */
export async function probePluginRegistries(
  options?: ProbePluginRegistriesOptions
): Promise<PluginRegistryProbeReport> {
  const npmRegistryUrl = normalizeBaseUrl(
    options?.npmRegistryUrl ?? DEFAULT_REGISTRY_URL
  );
  const npmMirrorRegistryUrl = normalizeBaseUrl(
    options?.npmMirrorRegistryUrl ?? DEFAULT_FALLBACK_REGISTRY_URL
  );
  const timeoutMs = options?.timeoutMs ?? 5_000;
  const probePath = options?.probePath ?? "/";
  const headers = options?.headers ?? {};

  const [npmjsProbe, mirrorProbe] = await Promise.all([
    probeSingleRegistry("npmjs", npmRegistryUrl, probePath, timeoutMs, headers),
    probeSingleRegistry(
      "npmmirror",
      npmMirrorRegistryUrl,
      probePath,
      timeoutMs,
      headers
    )
  ]);

  let recommended: PluginRegistryProbeEntry = npmjsProbe;
  let fallback: PluginRegistryProbeEntry = mirrorProbe;

  if (npmjsProbe.reachable && mirrorProbe.reachable) {
    const npmLatency = npmjsProbe.latencyMs ?? Number.POSITIVE_INFINITY;
    const mirrorLatency = mirrorProbe.latencyMs ?? Number.POSITIVE_INFINITY;
    if (mirrorLatency < npmLatency) {
      recommended = mirrorProbe;
      fallback = npmjsProbe;
    }
  } else if (mirrorProbe.reachable && !npmjsProbe.reachable) {
    recommended = mirrorProbe;
    fallback = npmjsProbe;
  }

  return {
    probedAt: Date.now(),
    recommendedRegistryId: recommended.id,
    recommendedUrl: recommended.url,
    fallbackUrl: fallback.url,
    order: [recommended.url, fallback.url],
    registries: [npmjsProbe, mirrorProbe]
  };
}

/**
 * Queries GitHub repositories by topic (default `"prismux-plugin"`) for community plugin discovery.
 */
export async function searchCommunityPlugins(
  topic: string = BRAND.githubTopic,
  fetcher?: CommunitySearchFetcher,
  options?: {
    githubApiBaseUrl?: string;
    perPage?: number;
    timeoutMs?: number;
  }
): Promise<CommunityPluginSummary[]> {
  const cleanTopic = topic.trim() || BRAND.githubTopic;
  const baseUrl = normalizeBaseUrl(
    options?.githubApiBaseUrl ?? DEFAULT_GITHUB_API_URL
  );
  const perPage = options?.perPage ?? 20;
  const url = `${baseUrl}/search/repositories?q=${encodeURIComponent(`topic:${cleanTopic}`)}&sort=stars&order=desc&per_page=${perPage}`;
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "Prismux-Cordis-Kernel/0.1"
  };

  let payload: unknown;
  if (fetcher !== undefined) {
    const res = await fetcher(url, { headers });
    if (!res.ok) {
      throw new RegistryHttpError(url, res.status);
    }
    payload = await res.json();
  } else {
    payload = await fetchJsonViaHttp(
      url,
      headers,
      options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    );
  }

  if (!isPlainRecord(payload) || !Array.isArray(payload["items"])) {
    throw new Error("Invalid GitHub topic search response format.");
  }

  const results: CommunityPluginSummary[] = [];
  for (const item of payload["items"]) {
    if (!isPlainRecord(item)) {
      continue;
    }
    results.push({
      fullName: String(item["full_name"] ?? ""),
      name: String(item["name"] ?? ""),
      description:
        typeof item["description"] === "string" ? item["description"] : null,
      htmlUrl: String(item["html_url"] ?? ""),
      stars: typeof item["stargazers_count"] === "number" ? item["stargazers_count"] : 0,
      topics: Array.isArray(item["topics"])
        ? item["topics"].filter((t): t is string => typeof t === "string")
        : [],
      defaultBranch: String(item["default_branch"] ?? "main"),
      updatedAt: String(item["updated_at"] ?? "")
    });
  }
  return results;
}

/**
 * Dual-track, scriptless, git-free streaming plugin installer implementing `StreamingNpmInstaller`.
 * - Track 1: Official catalog (`catalog/official.json`) with mandatory SHA-256 verification.
 * - Track 2: Streaming npm tarball install with automatic fallback mirror (`npmmirror`) and zero script execution.
 * Enforces top-level `engines.prismux` SemVer compatibility, `modelVisible` audit confirmation, and `distribution: "managed"`.
 */
export class CordisStreamingInstaller implements StreamingNpmInstaller {
  private readonly pluginsDir: string;
  private readonly hostVersion: string;
  private readonly defaultRegistryUrl: string;
  private readonly defaultFallbackRegistryUrl: string;
  private readonly networkPreference: NetworkRoutePreference | undefined;
  private readonly hasCustomRegistries: boolean;
  private readonly githubApiBaseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly maxArchiveBytes: number;
  private readonly maxUncompressedBytes: number;

  constructor(options: CordisStreamingInstallerOptions) {
    if (typeof options.pluginsDir !== "string" || options.pluginsDir.trim().length === 0) {
      throw new Error("pluginsDir must be a non-empty string.");
    }
    if (parseSemver(options.hostVersion) === null) {
      throw new Error(`Invalid hostVersion SemVer 2.0 string: "${options.hostVersion}".`);
    }

    this.pluginsDir = resolve(options.pluginsDir);
    this.hostVersion = options.hostVersion;
    this.defaultRegistryUrl = normalizeBaseUrl(
      options.defaultRegistryUrl ?? DEFAULT_REGISTRY_URL
    );
    this.defaultFallbackRegistryUrl = normalizeBaseUrl(
      options.defaultFallbackRegistryUrl ?? DEFAULT_FALLBACK_REGISTRY_URL
    );
    this.networkPreference = options.networkPreference;
    this.hasCustomRegistries =
      options.defaultRegistryUrl !== undefined ||
      options.defaultFallbackRegistryUrl !== undefined;
    this.githubApiBaseUrl = normalizeBaseUrl(
      options.githubApiBaseUrl ?? DEFAULT_GITHUB_API_URL
    );
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
    this.maxUncompressedBytes =
      options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES;
  }

  async probeRegistries(
    options?: ProbePluginRegistriesOptions
  ): Promise<PluginRegistryProbeReport> {
    return probePluginRegistries({
      npmRegistryUrl: options?.npmRegistryUrl ?? this.defaultRegistryUrl,
      npmMirrorRegistryUrl:
        options?.npmMirrorRegistryUrl ?? this.defaultFallbackRegistryUrl,
      timeoutMs: options?.timeoutMs ?? Math.min(this.requestTimeoutMs, 5_000),
      headers: options?.headers,
      probePath: options?.probePath
    });
  }

  getPluginsDir(): string {
    return this.pluginsDir;
  }

  async loadOfficialCatalog(catalogPath: string): Promise<OfficialPluginCatalog> {
    const resolved = resolve(catalogPath);
    if (!existsSync(resolved)) {
      throw new Error(`Official plugin catalog not found: ${resolved}`);
    }
    const raw = JSON.parse(readFileSync(resolved, "utf8")) as unknown;
    if (
      !isPlainRecord(raw) ||
      raw["schemaVersion"] !== 1 ||
      !Array.isArray(raw["plugins"])
    ) {
      throw new Error(`Invalid official plugin catalog schema: ${resolved}`);
    }
    return raw as unknown as OfficialPluginCatalog;
  }

  async installOfficialEntry(
    entry: OfficialPluginCatalogEntry,
    archiveBytes: Uint8Array,
    options?: OfficialInstallOptions
  ): Promise<InstalledPluginDetails> {
    const hostVersion = options?.hostVersion ?? this.hostVersion;
    const expectedSha = entry.sha256?.trim().toLowerCase() ?? "";
    if (!/^[0-9a-f]{64}$/.test(expectedSha)) {
      throw new Error(
        `Official plugin "${entry.id}" is missing a valid 64-char SHA-256 checksum.`
      );
    }

    const buf = Buffer.isBuffer(archiveBytes)
      ? archiveBytes
      : Buffer.from(archiveBytes);
    const actualSha = createHash("sha256").update(buf).digest("hex");
    if (actualSha !== expectedSha) {
      throw new ChecksumMismatchError(expectedSha, actualSha, "sha256");
    }

    if (entry.bytes !== undefined && entry.bytes !== null && buf.byteLength !== entry.bytes) {
      throw new Error(
        `Official plugin "${entry.id}" archive byte length mismatch: expected ${entry.bytes}, got ${buf.byteLength}.`
      );
    }

    const entryEngineResult = checkTopLevelEngineCompatibility(
      entry.engines,
      hostVersion
    );
    if (!entryEngineResult.compatible) {
      throw new EngineIncompatibleError(entryEngineResult);
    }

    return this.installFromReadable(Readable.from([buf]), {
      packageNameHint: entry.packageName,
      expectedSha256: expectedSha,
      expectedPluginId: entry.id,
      expectedVersion: entry.version,
      confirmedAudit: options?.confirmedAudit,
      hostVersion
    });
  }

  async installFromNpm(
    options: StreamingInstallOptions
  ): Promise<InstalledPluginDetails> {
    const hostVersion = options.hostVersion ?? this.hostVersion;
    const specInput = options.packageNameOrTarball.trim();

    if (/^https?:\/\//i.test(specInput)) {
      return this.installFromHttpTarballUrl(specInput, {
        expectedSha256: options.expectedSha256,
        confirmedAudit: options.confirmedAudit,
        hostVersion,
        headers: options.headers,
        packageNameHint: specInput
      });
    }

    if (specInput.startsWith("file://") || existsSync(specInput)) {
      const localPath = specInput.startsWith("file://")
        ? fileURLToPath(specInput)
        : resolve(specInput);
      return this.installFromReadable(createReadStream(localPath), {
        packageNameHint: localPath,
        expectedSha256: options.expectedSha256,
        confirmedAudit: options.confirmedAudit,
        hostVersion
      });
    }

    const parsedSpec = parseNpmPackageSpec(specInput);
    const baseGlobal = normalizeBaseUrl(
      options.registryUrl ?? this.defaultRegistryUrl
    );
    const baseDomestic = normalizeBaseUrl(
      options.fallbackRegistryUrl ?? this.defaultFallbackRegistryUrl
    );
    const hasExplicitDifferentRegistry =
      options.registryUrl !== undefined &&
      normalizeBaseUrl(options.registryUrl) !== this.defaultRegistryUrl;
    const effectivePreference = options.networkPreference ?? this.networkPreference;

    let primaryRegistry = baseGlobal;
    let fallbackRegistry = baseDomestic;

    if (hasExplicitDifferentRegistry && options.networkPreference === undefined) {
      primaryRegistry = baseGlobal;
      fallbackRegistry = baseDomestic;
    } else if (
      effectivePreference === "domestic" ||
      effectivePreference === "global"
    ) {
      const resolved = resolveRegistryOrder(
        effectivePreference,
        baseGlobal,
        baseDomestic
      );
      primaryRegistry = resolved.primary;
      fallbackRegistry = resolved.fallback;
    } else if (effectivePreference === "auto" || !this.hasCustomRegistries) {
      const probe = await probePluginRegistries({
        npmRegistryUrl: baseGlobal,
        npmMirrorRegistryUrl: baseDomestic,
        timeoutMs: Math.min(this.requestTimeoutMs, 5_000),
        headers: options.headers
      });
      primaryRegistry = probe.recommendedUrl;
      fallbackRegistry = probe.fallbackUrl;
    }

    try {
      const details = await this.installFromRegistryBase(
        primaryRegistry,
        parsedSpec,
        {
          expectedSha256: options.expectedSha256,
          confirmedAudit: options.confirmedAudit,
          hostVersion,
          headers: options.headers
        }
      );
      return {
        ...details,
        registryUsed: primaryRegistry,
        usedFallbackRegistry: false
      };
    } catch (primaryError) {
      if (
        !isFallbackEligibleError(primaryError) ||
        fallbackRegistry.length === 0 ||
        fallbackRegistry === primaryRegistry
      ) {
        throw primaryError;
      }

      const details = await this.installFromRegistryBase(
        fallbackRegistry,
        parsedSpec,
        {
          expectedSha256: options.expectedSha256,
          confirmedAudit: options.confirmedAudit,
          hostVersion,
          headers: options.headers
        }
      );
      return {
        ...details,
        registryUsed: fallbackRegistry,
        usedFallbackRegistry: true
      };
    }
  }

  async searchCommunityPlugins(
    topic: string = BRAND.githubTopic,
    fetcher?: CommunitySearchFetcher
  ): Promise<CommunityPluginSummary[]> {
    return searchCommunityPlugins(topic, fetcher, {
      githubApiBaseUrl: this.githubApiBaseUrl,
      timeoutMs: this.requestTimeoutMs
    });
  }

  async getInstalledRecord(
    pluginId: string
  ): Promise<InstalledPluginDetails | null> {
    const safeId = validateSafePluginId(pluginId);
    const metaPath = resolve(this.pluginsDir, safeId, INSTALL_METADATA_FILENAME);
    if (!existsSync(metaPath)) {
      return null;
    }
    return JSON.parse(readFileSync(metaPath, "utf8")) as InstalledPluginDetails;
  }

  async listInstalled(): Promise<InstalledPluginDetails[]> {
    if (!existsSync(this.pluginsDir)) {
      return [];
    }
    const entries = readdirSync(this.pluginsDir, { withFileTypes: true });
    const records: InstalledPluginDetails[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      const metaPath = join(this.pluginsDir, entry.name, INSTALL_METADATA_FILENAME);
      if (existsSync(metaPath)) {
        records.push(
          JSON.parse(readFileSync(metaPath, "utf8")) as InstalledPluginDetails
        );
      }
    }
    return records;
  }

  async uninstall(pluginId: string): Promise<void> {
    const safeId = validateSafePluginId(pluginId);
    const targetDir = resolve(this.pluginsDir, safeId);
    const rel = relative(this.pluginsDir, targetDir);
    if (rel.startsWith("..") || isAbsolute(rel) || rel === "" || rel.includes(sep)) {
      throw new Error(`Unsafe plugin uninstall path: "${targetDir}".`);
    }
    rmSync(targetDir, { recursive: true, force: true });
  }

  private async installFromRegistryBase(
    registryBaseUrl: string,
    spec: { name: string; rangeOrTag: string },
    options: {
      expectedSha256?: string;
      confirmedAudit?: boolean;
      hostVersion: string;
      headers?: Record<string, string>;
    }
  ): Promise<InstalledPluginDetails> {
    const packumentUrl = `${registryBaseUrl}/${encodeNpmPackageUrlSegment(spec.name)}`;
    const packumentRaw = await fetchJsonViaHttp(
      packumentUrl,
      {
        accept: "application/json",
        ...options.headers
      },
      this.requestTimeoutMs
    );

    if (!isPlainRecord(packumentRaw)) {
      throw new Error(`Invalid npm packument JSON from ${packumentUrl}.`);
    }

    const { versionDoc } = resolvePackumentVersion(packumentRaw, spec.rangeOrTag);
    if (versionDoc.engines !== undefined) {
      const packumentEngineResult = checkPackageEngineCompatibility(
        { engines: versionDoc.engines },
        options.hostVersion
      );
      if (!packumentEngineResult.compatible) {
        throw new EngineIncompatibleError(packumentEngineResult);
      }
    }

    const rawTarballUrl = versionDoc.dist?.tarball;
    if (typeof rawTarballUrl !== "string" || rawTarballUrl.trim().length === 0) {
      throw new Error(
        `Missing dist.tarball URL in packument for ${spec.name}.`
      );
    }
    const tarballUrl = new URL(rawTarballUrl, `${registryBaseUrl}/`).toString();

    return this.installFromHttpTarballUrl(tarballUrl, {
      expectedSha256: options.expectedSha256,
      integrity: versionDoc.dist?.integrity,
      shasum: versionDoc.dist?.shasum,
      confirmedAudit: options.confirmedAudit,
      hostVersion: options.hostVersion,
      headers: options.headers,
      packageNameHint: spec.name
    });
  }

  private async installFromHttpTarballUrl(
    tarballUrl: string,
    options: {
      expectedSha256?: string;
      integrity?: string;
      shasum?: string;
      confirmedAudit?: boolean;
      hostVersion: string;
      headers?: Record<string, string>;
      packageNameHint: string;
    }
  ): Promise<InstalledPluginDetails> {
    const response = await openHttpStream(
      tarballUrl,
      options.headers ?? {},
      this.requestTimeoutMs
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.stream.resume();
      throw new RegistryHttpError(tarballUrl, response.statusCode);
    }

    return this.installFromReadable(response.stream, {
      packageNameHint: options.packageNameHint,
      expectedSha256: options.expectedSha256,
      integrity: options.integrity,
      shasum: options.shasum,
      confirmedAudit: options.confirmedAudit,
      hostVersion: options.hostVersion
    });
  }

  private async installFromReadable(
    source: Readable,
    options: {
      packageNameHint: string;
      expectedSha256?: string;
      integrity?: string;
      shasum?: string;
      expectedPluginId?: string;
      expectedVersion?: string;
      confirmedAudit?: boolean;
      hostVersion: string;
    }
  ): Promise<InstalledPluginDetails> {
    mkdirSync(this.pluginsDir, { recursive: true });
    const stagingDir = resolve(this.pluginsDir, `.staging-${randomUUID()}`);
    mkdirSync(stagingDir, { recursive: true });

    try {
      const extracted = await streamArchiveToStaging(source, stagingDir, {
        maxArchiveBytes: this.maxArchiveBytes,
        maxUncompressedBytes: this.maxUncompressedBytes
      });

      verifyExtractedIntegrity(extracted, {
        expectedSha256: options.expectedSha256,
        integrity: options.integrity,
        shasum: options.shasum
      });

      const pluginRoot = resolvePluginRootInStaging(stagingDir, extracted.files);
      const packageJson = readJsonFileRecord(
        join(pluginRoot, "package.json"),
        "package.json"
      ) as PluginPackageJsonLike;

      const engineResult = checkPackageEngineCompatibility(
        packageJson,
        options.hostVersion
      );
      if (!engineResult.compatible) {
        throw new EngineIncompatibleError(engineResult);
      }

      const manifestRaw = readJsonFileRecord(
        join(pluginRoot, "plugin.manifest.json"),
        "plugin.manifest.json"
      );
      const manifest = validateExtractedManifest(manifestRaw);

      if (
        options.expectedPluginId !== undefined &&
        manifest.id !== options.expectedPluginId
      ) {
        throw new Error(
          `Catalog plugin ID mismatch: expected "${options.expectedPluginId}", got "${manifest.id}".`
        );
      }
      if (
        options.expectedVersion !== undefined &&
        manifest.version !== options.expectedVersion
      ) {
        throw new Error(
          `Catalog plugin version mismatch: expected "${options.expectedVersion}", got "${manifest.version}".`
        );
      }

      const audit = buildPermissionAuditCard(manifest, packageJson);
      if (manifest.modelVisible === true && options.confirmedAudit !== true) {
        throw new PermissionAuditRequiredError(audit);
      }

      const targetDir = resolve(this.pluginsDir, manifest.id);
      const relTarget = relative(this.pluginsDir, targetDir);
      if (relTarget.startsWith("..") || isAbsolute(relTarget) || relTarget === "") {
        throw new Error(`Unsafe plugin installation target: "${targetDir}".`);
      }

      const packageName =
        typeof packageJson.name === "string" && packageJson.name.trim().length > 0
          ? packageJson.name.trim()
          : options.packageNameHint;

      // Managed single-write lock: market/registry installs ALWAYS write distribution="managed".
      const details: InstalledPluginDetails = {
        manifest,
        packageName,
        distribution: "managed",
        enabled: true,
        installPath: targetDir,
        installedAt: Date.now(),
        sha256: extracted.sha256,
        audit,
        ignoredInstallScripts: [...audit.ignoredInstallScripts]
      };

      writeFileSync(
        join(pluginRoot, INSTALL_METADATA_FILENAME),
        `${JSON.stringify(details, null, 2)}\n`,
        "utf8"
      );

      this.atomicReplacePluginDirectory(pluginRoot, targetDir, manifest.id);
      return details;
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  private atomicReplacePluginDirectory(
    stagedPluginRoot: string,
    targetDir: string,
    pluginId: string
  ): void {
    const hasExisting = existsSync(targetDir);
    if (!hasExisting) {
      renameSync(stagedPluginRoot, targetDir);
      return;
    }

    const backupDir = resolve(
      this.pluginsDir,
      `.backup-${pluginId}-${randomUUID()}`
    );
    renameSync(targetDir, backupDir);
    try {
      renameSync(stagedPluginRoot, targetDir);
    } catch (error) {
      if (!existsSync(targetDir) && existsSync(backupDir)) {
        try {
          renameSync(backupDir, targetDir);
        } catch {
          // Best-effort restore
        }
      }
      throw error;
    }
    rmSync(backupDir, { recursive: true, force: true });
  }
}

export function isOfficialPluginDirStat(pluginDir: string): boolean {
  try {
    return statSync(pluginDir).isDirectory();
  } catch {
    return false;
  }
}
