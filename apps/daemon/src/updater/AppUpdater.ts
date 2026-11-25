import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compareSemver, parseSemver } from "@prismux/cordis-kernel";
import {
  DEFAULT_APP_VERSION,
  DEFAULT_UPDATE_POLICY,
  NETWORK_ROUTE_PREFERENCES,
  PLUGIN_REGISTRY_IDS,
  UPDATE_ENDPOINTS,
  type NetworkRoutePreference,
  type SourceEndpointProbe,
  type SourceProbeReport,
  type UpdateAssetInfo,
  type UpdateChannel,
  type UpdateCheckResult,
  type UpdateDownloadProgress,
  type UpdateDownloadResult,
  type UpdateInstallState,
  type UpdatePackageKind,
  type UpdatePolicyConfig,
  type UpdatePolicyPatch,
  type UpdaterSseEventPayload,
  type UpdaterSseEventType,
  type UpdaterStatusSnapshot,
  type UpdateSourceId,
  type UpdateSplitArchivePart
} from "@prismux/protocol";

const execFileAsync = promisify(execFile);

const POLICY_FILENAME = "updater-policy.json";
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const SOFTWARE_SHA256SUMS_RE =
  /^prismux-(?!plugins?-)(?:.+?-)?sha256sums(?:\.txt)?$/i;

/**
 * Selects the software-dedicated checksum manifest from a release's assets:
 * 1. Exact versioned `Prismux-<ver>-SHA256SUMS.txt`
 * 2. Generic `Prismux-*-SHA256SUMS.txt` / `Prismux-SHA256SUMS.txt` (strictly excluding `prismux-plugin(s)-*`)
 * 3. Legacy `SHA256SUMS.txt` / `SHA256SUMS`
 */
export function selectSoftwareChecksumAsset<T extends { name: string }>(
  rawAssets: readonly T[],
  version?: string
): T | undefined {
  if (version && version.trim().length > 0) {
    const exactVersioned = `prismux-${version.trim().toLowerCase()}-sha256sums.txt`;
    const exactMatch = rawAssets.find(
      (item) => item.name.toLowerCase() === exactVersioned
    );
    if (exactMatch !== undefined) {
      return exactMatch;
    }
  }

  const dedicatedMatch = rawAssets.find((item) =>
    SOFTWARE_SHA256SUMS_RE.test(item.name.trim())
  );
  if (dedicatedMatch !== undefined) {
    return dedicatedMatch;
  }

  return rawAssets.find((item) => {
    const lower = item.name.trim().toLowerCase();
    return lower === "sha256sums.txt" || lower === "sha256sums";
  });
}
const SPLIT_7Z_EXE_RE = /^(.+\.exe)\.7z\.(\d{3})$/i;
const DEFAULT_MAX_REDIRECTS = 6;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAYS_MS = [250, 750, 1500];
const DEFAULT_EXTRACT_TIMEOUT_MS = 180_000;
const DOWNLOAD_PROGRESS_MAX_PERCENT = 90;
const SPLIT_EXTRACT_END_PERCENT = 95;
const VERIFY_MAX_PERCENT = 99.9;
const HEAD_SIZE_PROBE_TIMEOUT_MS = 5_000;
const PROGRESS_SSE_THROTTLE_MS = 100;
const PROGRESS_SSE_MIN_PERCENT_DELTA = 1;

export const DEFAULT_AUTO_CHECK_INITIAL_DELAY_MS = 15_000;
export const DEFAULT_AUTO_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const MAX_RELEASE_NOTES_CHARS = 24 * 1024;

export type { UpdateDownloadProgress };

export interface AppUpdaterTimerApi {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

export interface AppUpdaterEndpoints {
  githubOwner: string;
  githubRepo: string;
  githubApiBase: string;
  githubWebBase: string;
  giteeOwner: string;
  giteeRepo: string;
  giteeApiBase: string;
  giteeWebBase: string;
}

export interface AppUpdaterOptions {
  currentVersion?: string;
  dataDir: string;
  portableMode?: boolean;
  downloadsDir?: string;
  initialPolicy?: UpdatePolicyPatch;
  endpoints?: Partial<AppUpdaterEndpoints>;
  githubApiBase?: string;
  giteeApiBase?: string;
  githubWebBase?: string;
  giteeWebBase?: string;
  maxRedirects?: number;
  maxRetries?: number;
  retryDelaysMs?: number[];
  /** Optional explicit 7za/7z executable path (also reads `PRISMUX_7ZA_PATH`). */
  sevenZipPath?: string;
  /** Initial delay before first background auto-check (default 15s). */
  autoCheckInitialDelayMs?: number;
  /** Interval between background auto-checks (default 4h). */
  autoCheckIntervalMs?: number;
  /** Injectable timers for deterministic tests. */
  timers?: AppUpdaterTimerApi;
}

export interface CheckForUpdatesOptions {
  channel?: UpdateChannel;
  sourceOverride?: UpdateSourceId;
}

export interface DownloadUpdateOptions {
  checkResult?: UpdateCheckResult;
  asset?: UpdateAssetInfo;
  kind?: UpdatePackageKind;
  assetName?: string;
  sourceOverride?: UpdateSourceId;
  destDir?: string;
  onProgress?: (progress: UpdateDownloadProgress) => void;
  maxRetries?: number;
  retryDelaysMs?: number[];
}

export class UpdateHttpError extends Error {
  readonly statusCode: number;
  readonly url: string;

  constructor(statusCode: number, url: string, message?: string) {
    super(
      `Updater HTTP ${statusCode} for ${url}${message ? `: ${message}` : ""}`
    );
    this.name = "UpdateHttpError";
    this.statusCode = statusCode;
    this.url = url;
  }
}

export class UpdateIntegrityError extends Error {
  readonly assetName: string;
  readonly expectedSha256: string;
  readonly actualSha256: string;

  constructor(assetName: string, expectedSha256: string, actualSha256: string) {
    super(
      `SHA-256 checksum mismatch for "${assetName}": expected ${expectedSha256}, got ${actualSha256}.`
    );
    this.name = "UpdateIntegrityError";
    this.assetName = assetName;
    this.expectedSha256 = expectedSha256;
    this.actualSha256 = actualSha256;
  }
}

class RetryableTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableTransferError";
  }
}

interface RawReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
}

interface RawReleaseRecord {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  created_at?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

interface ParsedReleaseCandidate {
  version: string;
  tagName: string;
  prerelease: boolean;
  releaseName: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  htmlUrl: string | null;
  rawAssets: Array<{
    name: string;
    downloadUrl: string;
    sizeBytes: number | null;
  }>;
}

interface HttpOpenedResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  stream: http.IncomingMessage;
  finalUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function normalizeTagToVersion(tagName: string): string {
  return tagName.trim().replace(/^v/i, "");
}

function isValidSha256Hex(value: string | null | undefined): value is string {
  return typeof value === "string" && SHA256_HEX_RE.test(value.trim().toLowerCase());
}

function sanitizeAssetFileName(name: string): string {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("..") ||
    trimmed.includes("\0")
  ) {
    throw new Error(`Unsafe update asset file name: "${name}".`);
  }
  return trimmed;
}

function roundPercent1(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value * 10) / 10));
}

function computeWeightedDownloadPercent(
  bytesDownloaded: number,
  totalBytes: number | null,
  maxWeight = DOWNLOAD_PROGRESS_MAX_PERCENT
): number | null {
  if (totalBytes === null || totalBytes <= 0) {
    return null;
  }
  const pct = (bytesDownloaded / totalBytes) * maxWeight;
  return roundPercent1(pct, 0, maxWeight);
}

function computeSplitPartWeightedPercent(
  partIndex: number,
  totalParts: number,
  partBytes: number,
  partTotal: number | null
): number {
  const safeTotalParts = Math.max(1, totalParts);
  const safeIndex = Math.max(0, Math.min(safeTotalParts - 1, partIndex));
  const partFrac =
    partTotal !== null && partTotal > 0
      ? Math.max(0, Math.min(1, partBytes / partTotal))
      : partBytes > 0
        ? Math.min(0.95, 1 - 1 / (1 + partBytes / (32 * 1024 * 1024)))
        : 0;
  const raw = ((safeIndex + partFrac) / safeTotalParts) * DOWNLOAD_PROGRESS_MAX_PERCENT;
  return roundPercent1(raw, 0, DOWNLOAD_PROGRESS_MAX_PERCENT);
}

function parsePositiveIntegerHeader(
  rawHeader: string | string[] | undefined
): number | null {
  const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function applyGhProxyPrefix(rawUrl: string, prefix: string): string {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) {
    return rawUrl;
  }
  if (rawUrl.startsWith(trimmed)) {
    return rawUrl;
  }
  if (trimmed.endsWith("/") || trimmed.endsWith("=") || trimmed.endsWith("?")) {
    return `${trimmed}${rawUrl}`;
  }
  return `${trimmed}/${rawUrl}`;
}

/**
 * Resolves the `7za.exe` / `7z.exe` binary for extracting Gitee split `.7z.001..N`
 * installer archives.
 *
 * Priority order:
 * 1. Explicit `explicitPath` override
 * 2. `PRISMUX_7ZA_PATH` environment variable
 * 3. Bundled `process.resourcesPath/tools/7za.exe` (Electron packaged app)
 * 4. Adjacent `<execDir>/resources/tools/7za.exe` & `<execDir>/tools/7za.exe`
 * 5. Monorepo dev fallback `node_modules/7zip-bin/win/x64/7za.exe`
 * 6. Standard Windows 7-Zip install paths (`C:\Program Files\7-Zip\7z.exe`, etc.)
 * 7. PATH lookup (`7za.exe`, `7z.exe`, `7za`, `7z`)
 */
export function resolve7zaBinary(explicitPath?: string): string | null {
  const candidates: string[] = [];

  if (explicitPath && explicitPath.trim().length > 0) {
    candidates.push(resolve(explicitPath.trim()));
  }

  const envPath = process.env["PRISMUX_7ZA_PATH"]?.trim();
  if (envPath && envPath.length > 0) {
    candidates.push(resolve(envPath));
  }

  const procResourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath;
  const exeName = process.platform === "win32" ? "7za.exe" : "7za";
  if (typeof procResourcesPath === "string" && procResourcesPath.trim().length > 0) {
    candidates.push(join(procResourcesPath, "tools", exeName));
    candidates.push(join(procResourcesPath, "tools", "7z.exe"));
  }

  const execDir = dirname(process.execPath);
  candidates.push(join(execDir, "resources", "tools", exeName));
  candidates.push(join(execDir, "tools", exeName));

  // Walk upward from current module to locate repo-bundled resources or 7zip-bin in dev.
  let cursor = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    candidates.push(join(cursor, "resources", "tools", exeName));
    candidates.push(
      join(cursor, "node_modules", "7zip-bin", "win", "x64", "7za.exe")
    );
    const parent = dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  if (process.platform === "win32") {
    candidates.push("C:\\Program Files\\7-Zip\\7za.exe");
    candidates.push("C:\\Program Files\\7-Zip\\7z.exe");
    candidates.push("C:\\Program Files (x86)\\7-Zip\\7za.exe");
    candidates.push("C:\\Program Files (x86)\\7-Zip\\7z.exe");
  }

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // ignore inaccessible candidate
    }
  }

  // Fallback: scan PATH entries synchronously (fast stat-only check, no shell spawn)
  const pathEnv = process.env["PATH"] ?? process.env["Path"] ?? "";
  const pathSep = process.platform === "win32" ? ";" : ":";
  const binNames =
    process.platform === "win32"
      ? ["7za.exe", "7z.exe", "7za.cmd", "7z.cmd"]
      : ["7za", "7z", "7zz"];
  for (const dir of pathEnv.split(pathSep)) {
    const trimmedDir = dir.trim();
    if (!trimmedDir) {
      continue;
    }
    for (const binName of binNames) {
      const full = join(trimmedDir, binName);
      try {
        if (existsSync(full) && statSync(full).isFile()) {
          return full;
        }
      } catch {
        // ignore
      }
    }
  }

  return null;
}

function extractAssetName(asset: RawReleaseAsset, downloadUrl: string): string {
  if (typeof asset.name === "string" && asset.name.trim().length > 0) {
    return asset.name.trim();
  }
  try {
    const parsed = new URL(downloadUrl);
    const segment = parsed.pathname.split("/").filter(Boolean).pop();
    if (segment && segment.length > 0) {
      return decodeURIComponent(segment);
    }
  } catch {
    // Fall back to empty string
  }
  return "";
}

function classifyPackageAssetKind(
  assetName: string,
  version: string
): Exclude<UpdatePackageKind, "split-7z-exe"> | null {
  const lower = assetName.toLowerCase();
  if (
    lower.endsWith(".sha256") ||
    lower.endsWith(".sig") ||
    lower.endsWith(".asc") ||
    SPLIT_7Z_EXE_RE.test(assetName)
  ) {
    return null;
  }
  const portableExact = `prismux-portable-${version.toLowerCase()}-win-x64.zip`;
  const setupExact = `prismux-setup-${version.toLowerCase()}.exe`;

  if (
    lower === portableExact ||
    (lower.startsWith("prismux-portable-") && lower.endsWith("-win-x64.zip")) ||
    (lower.includes("portable") && lower.endsWith(".zip"))
  ) {
    return "portable-zip";
  }

  if (
    lower === setupExact ||
    (lower.startsWith("prismux-setup-") && lower.endsWith(".exe")) ||
    (lower.includes("setup") && lower.endsWith(".exe"))
  ) {
    return "setup-exe";
  }

  return null;
}

function parseSha256SumsText(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
    if (match !== null) {
      const digest = match[1]!.toLowerCase();
      const fileToken = basename(match[2]!.trim()).toLowerCase();
      if (fileToken.length > 0) {
        map.set(fileToken, digest);
      }
    }
  }
  return map;
}

function parseSingleAssetSha256Text(
  text: string,
  expectedAssetName: string
): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const expectedLower = basename(expectedAssetName).toLowerCase();

  for (const line of lines) {
    const bareMatch = /^([0-9a-fA-F]{64})$/.exec(line);
    if (bareMatch !== null) {
      return bareMatch[1]!.toLowerCase();
    }
    const pairMatch = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
    if (pairMatch !== null) {
      const digest = pairMatch[1]!.toLowerCase();
      const fileToken = basename(pairMatch[2]!.trim()).toLowerCase();
      if (fileToken === expectedLower) {
        return digest;
      }
    }
  }
  return null;
}

function isStrictlyInsideDir(candidatePath: string, rootDir: string): boolean {
  const realRoot = realpathSync(rootDir);
  const realCandidate = realpathSync(candidatePath);
  const rel = relative(realRoot, realCandidate);
  return (
    rel !== "" &&
    !rel.startsWith("..") &&
    !isAbsolute(rel) &&
    !rel.split(/[\\/]/).includes("..")
  );
}

function findExtractedExeFile(
  extractDir: string,
  expectedExeName: string
): string | null {
  const direct = join(extractDir, expectedExeName);
  if (existsSync(direct) && statSync(direct).isFile()) {
    if (!isStrictlyInsideDir(direct, extractDir)) {
      throw new Error(`Extracted update path escaped isolation directory: ${direct}`);
    }
    return direct;
  }

  const expectedLower = expectedExeName.toLowerCase();
  const queue: Array<{ dir: string; depth: number }> = [{ dir: extractDir, depth: 0 }];
  let fallbackExe: string | null = null;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = readdirSync(current.dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current.dir, entry.name);
      if (entry.isDirectory() && current.depth < 2) {
        queue.push({ dir: full, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!isStrictlyInsideDir(full, extractDir)) {
        continue;
      }
      const lower = entry.name.toLowerCase();
      if (lower === expectedLower) {
        return full;
      }
      if (lower.endsWith(".exe") && fallbackExe === null) {
        fallbackExe = full;
      }
    }
  }

  return fallbackExe;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeDecodeUriComponent(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

const NAMED_HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

function decodeHtmlEntities(raw: string): string {
  if (!raw.includes("&")) {
    return raw;
  }
  return raw.replace(
    /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos|nbsp));/gi,
    (match, hex: string | undefined, dec: string | undefined, named: string | undefined) => {
      if (hex !== undefined) {
        const cp = Number.parseInt(hex, 16);
        if (Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff) {
          return String.fromCodePoint(cp);
        }
        return match;
      }
      if (dec !== undefined) {
        const cp = Number.parseInt(dec, 10);
        if (Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff) {
          return String.fromCodePoint(cp);
        }
        return match;
      }
      if (named !== undefined) {
        return NAMED_HTML_ENTITIES[named.toLowerCase()] ?? match;
      }
      return match;
    }
  );
}

/**
 * Normalizes a release notes Markdown body from GitHub/Gitee APIs or Gitee Web HTML:
 * strips UTF-8 BOM, normalizes CRLF/CR to LF, trims outer whitespace, and preserves
 * full content up to `MAX_RELEASE_NOTES_CHARS` (24 KB) without arbitrary short truncation.
 */
export function normalizeReleaseNotesBody(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.length <= MAX_RELEASE_NOTES_CHARS) {
    return normalized;
  }
  let end = MAX_RELEASE_NOTES_CHARS;
  const lastCode = normalized.charCodeAt(end - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    end -= 1;
  }
  return normalized.slice(0, end).trimEnd();
}

export function extractGiteeReleaseBodyFromHtml(blockHtml: string): string | null {
  const richRendererMatch =
    /<rich-markdown-renderer\b[^>]*>[\s\S]*?<textarea\b[^>]*>([\s\S]*?)<\/textarea>/i.exec(
      blockHtml
    );
  const textareaMatch =
    richRendererMatch ??
    /<textarea\b[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/textarea>/i.exec(
      blockHtml
    );
  if (textareaMatch === null) {
    return null;
  }
  return normalizeReleaseNotesBody(decodeHtmlEntities(textareaMatch[1] ?? ""));
}

function parseGiteeReleaseTimestamp(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  // Example: "2026-11-24 18:05:24 +0800"
  const withOffset =
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s*([+-]\d{2}):?(\d{2})$/.exec(
      trimmed
    );
  if (withOffset !== null) {
    const timePart = withOffset[2]!.length === 5 ? `${withOffset[2]!}:00` : withOffset[2]!;
    const isoCandidate = `${withOffset[1]!}T${timePart}${withOffset[3]!}:${withOffset[4]!}`;
    const parsed = new Date(isoCandidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  // Example: "2026-11-24 18:11" (Gitee CN web UI local display time)
  const dateTimeLocal = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)$/.exec(trimmed);
  if (dateTimeLocal !== null) {
    const timePart =
      dateTimeLocal[2]!.length === 5 ? `${dateTimeLocal[2]!}:00` : dateTimeLocal[2]!;
    const parsed = new Date(`${dateTimeLocal[1]!}T${timePart}+08:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

export interface GiteeWebParsedRelease {
  tag_name: string;
  name: string;
  body: string | null;
  published_at: string | null;
  prerelease: boolean;
  draft: false;
  html_url: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

/**
 * Fallback parser for Gitee's public Web Releases HTML page
 * (`https://gitee.com/<owner>/<repo>/releases`) when Gitee OpenAPI v5 returns
 * HTTP 403/429 anonymous rate-limit responses from WAF (`ADAS`).
 */
export function parseGiteeWebReleasesHtml(
  html: string,
  webBase: string,
  owner: string,
  repo: string
): GiteeWebParsedRelease[] {
  const normalizedBase = normalizeBaseUrl(webBase);
  const ownerEsc = escapeRegExp(owner);
  const repoEsc = escapeRegExp(repo);
  const downloadRe = new RegExp(
    `href=["'](?:https?:\\/\\/[^"']+)?\\/${ownerEsc}\\/${repoEsc}\\/releases\\/download\\/([^"'/?#]+)\\/([^"'?#]+)["']`,
    "gi"
  );
  const tagRe = new RegExp(
    `href=["'](?:https?:\\/\\/[^"']+)?\\/${ownerEsc}\\/${repoEsc}\\/releases\\/tag\\/([^"'/?#]+)["']`,
    "gi"
  );

  const tags = new Map<string, string>();
  const assetsByTag = new Map<
    string,
    Map<string, { name: string; browser_download_url: string }>
  >();
  const metaByTag = new Map<
    string,
    {
      name: string | null;
      body: string | null;
      publishedAt: string | null;
    }
  >();

  const registerTag = (rawTag: string): string | null => {
    const decoded = safeDecodeUriComponent(rawTag).trim();
    if (decoded.length === 0 || /[\s`<>]/.test(decoded)) {
      return null;
    }
    const parsed = parseSemver(normalizeTagToVersion(decoded));
    if (parsed === null) {
      return null;
    }
    const key = decoded.toLowerCase();
    if (!tags.has(key)) {
      tags.set(key, decoded);
    }
    return tags.get(key)!;
  };

  // Extract structured release cards (`<div class='release-tag-item' data-tag='...'>`)
  // including full Markdown release body, title, and commit/release timestamp.
  const cardStarts = [
    ...html.matchAll(
      /<div\b[^>]*class=["'][^"']*\brelease-tag-item\b[^"']*["'][^>]*>/gi
    )
  ];
  for (let i = 0; i < cardStarts.length; i += 1) {
    const startMatch = cardStarts[i]!;
    const startIdx = startMatch.index ?? 0;
    const endIdx =
      i + 1 < cardStarts.length
        ? (cardStarts[i + 1]!.index ?? html.length)
        : html.length;
    const cardHtml = html.slice(startIdx, endIdx);
    const openingTag = startMatch[0];

    const rawCardTag =
      /\bdata-tag=["']([^"']+)["']/i.exec(openingTag)?.[1] ??
      /\bdata-tag-name=["']([^"']+)["']/i.exec(cardHtml)?.[1] ??
      new RegExp(
        `href=["'](?:https?:\\/\\/[^"']+)?\\/${ownerEsc}\\/${repoEsc}\\/releases\\/tag\\/([^"'/?#]+)["']`,
        "i"
      ).exec(cardHtml)?.[1];
    if (!rawCardTag) {
      continue;
    }
    const canonicalTag = registerTag(rawCardTag);
    if (canonicalTag === null) {
      continue;
    }
    const tagKey = canonicalTag.toLowerCase();

    const titleMatch =
      /<a\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(
        cardHtml
      );
    const cleanedTitle = titleMatch
      ? decodeHtmlEntities(titleMatch[1]!.replace(/<[^>]+>/g, "")).trim()
      : "";

    const body = extractGiteeReleaseBodyFromHtml(cardHtml);

    const commitDateAttr = /\bdata-commit-date=["']([^"']+)["']/i.exec(cardHtml)?.[1];
    const releaseTimeText =
      /<span\b[^>]*class=["'][^"']*\brelease-time\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(
        cardHtml
      )?.[1];
    const publishedAt =
      parseGiteeReleaseTimestamp(commitDateAttr) ??
      parseGiteeReleaseTimestamp(
        releaseTimeText ? decodeHtmlEntities(releaseTimeText.replace(/<[^>]+>/g, "")) : null
      );

    const existing = metaByTag.get(tagKey);
    metaByTag.set(tagKey, {
      name: existing?.name ?? (cleanedTitle.length > 0 ? cleanedTitle : null),
      body: existing?.body ?? body,
      publishedAt: existing?.publishedAt ?? publishedAt
    });
  }

  for (const match of html.matchAll(tagRe)) {
    registerTag(match[1]!);
  }

  for (const match of html.matchAll(downloadRe)) {
    const canonicalTag = registerTag(match[1]!);
    if (canonicalTag === null) {
      continue;
    }
    const fileName = safeDecodeUriComponent(match[2]!).trim();
    if (
      fileName.length === 0 ||
      fileName.includes("/") ||
      fileName.includes("\\") ||
      fileName.includes("..")
    ) {
      continue;
    }
    const tagKey = canonicalTag.toLowerCase();
    let assetMap = assetsByTag.get(tagKey);
    if (assetMap === undefined) {
      assetMap = new Map<string, { name: string; browser_download_url: string }>();
      assetsByTag.set(tagKey, assetMap);
    }
    const fileKey = fileName.toLowerCase();
    if (!assetMap.has(fileKey)) {
      assetMap.set(fileKey, {
        name: fileName,
        browser_download_url: `${normalizedBase}/${owner}/${repo}/releases/download/${encodeURIComponent(canonicalTag)}/${encodeURIComponent(fileName)}`
      });
    }
  }

  const records: GiteeWebParsedRelease[] = [];
  for (const [tagKey, tagName] of tags.entries()) {
    const parsed = parseSemver(normalizeTagToVersion(tagName));
    if (parsed === null) {
      continue;
    }
    const assetMap = assetsByTag.get(tagKey);
    const meta = metaByTag.get(tagKey);
    records.push({
      tag_name: tagName,
      name: meta?.name ?? tagName,
      body: meta?.body ?? null,
      published_at: meta?.publishedAt ?? null,
      prerelease: parsed.prerelease.length > 0,
      draft: false,
      html_url: `${normalizedBase}/${owner}/${repo}/releases/tag/${encodeURIComponent(tagName)}`,
      assets: assetMap ? [...assetMap.values()] : []
    });
  }

  return records;
}

function openHttpWithRedirects(
  rawUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
  maxRedirects: number,
  method: "GET" | "HEAD" = "GET",
  followRedirects = true
): Promise<HttpOpenedResponse> {
  const attemptOpen = (
    targetUrl: string,
    redirectsLeft: number
  ): Promise<HttpOpenedResponse> =>
    new Promise((resolvePromise, rejectPromise) => {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(targetUrl);
      } catch {
        rejectPromise(new Error(`Invalid updater URL: "${targetUrl}".`));
        return;
      }

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        rejectPromise(
          new Error(`Unsupported updater URL protocol: "${parsedUrl.protocol}".`)
        );
        return;
      }

      const transport = parsedUrl.protocol === "https:" ? https : http;
      const req = transport.request(
        parsedUrl,
        {
          method,
          agent: false,
          headers: {
            "user-agent": `Mozilla/5.0 (compatible; Prismux-Updater/${DEFAULT_APP_VERSION})`,
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
            connection: "close",
            ...headers
          }
        },
        (res) => {
          const statusCode = res.statusCode ?? 0;
          const location = res.headers.location;
          if (
            followRedirects &&
            (statusCode === 301 ||
              statusCode === 302 ||
              statusCode === 303 ||
              statusCode === 307 ||
              statusCode === 308)
          ) {
            if (typeof location !== "string" || location.trim().length === 0) {
              res.resume();
              rejectPromise(
                new UpdateHttpError(
                  statusCode,
                  parsedUrl.toString(),
                  "Redirect response missing Location header."
                )
              );
              return;
            }
            if (redirectsLeft <= 0) {
              res.resume();
              rejectPromise(
                new Error(
                  `Too many redirects (exceeded ${maxRedirects} hops) while requesting ${rawUrl}.`
                )
              );
              return;
            }
            res.resume();
            const nextUrl = new URL(location, parsedUrl).toString();
            attemptOpen(nextUrl, redirectsLeft - 1).then(
              resolvePromise,
              rejectPromise
            );
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
        req.destroy(
          new RetryableTransferError(
            `Updater request timed out after ${timeoutMs}ms (${targetUrl}).`
          )
        );
      });

      req.on("error", (err) => {
        rejectPromise(err);
      });

      req.end();
    });

  return attemptOpen(rawUrl, maxRedirects);
}

async function fetchText(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  maxRedirects: number,
  maxBytes = 8 * 1024 * 1024
): Promise<string> {
  const response = await openHttpWithRedirects(
    url,
    headers,
    timeoutMs,
    maxRedirects
  );
  if (response.statusCode < 200 || response.statusCode >= 300) {
    response.stream.resume();
    throw new UpdateHttpError(response.statusCode, url);
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response.stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buf.length;
    if (bytes > maxBytes) {
      response.stream.destroy();
      throw new Error(`Updater payload exceeded ${maxBytes} bytes (${url}).`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function computeFileSha256(
  filePath: string,
  onProgress?: (hashedBytes: number, totalBytes: number) => void
): Promise<{ sha256: string; bytes: number }> {
  const totalBytes = existsSync(filePath) ? statSync(filePath).size : 0;
  onProgress?.(0, totalBytes);
  const hash = createHash("sha256");
  let bytes = 0;
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buf.length;
    hash.update(buf);
    onProgress?.(bytes, totalBytes > 0 ? totalBytes : bytes);
  }
  if (bytes === 0) {
    onProgress?.(0, totalBytes);
  }
  return {
    sha256: hash.digest("hex"),
    bytes
  };
}

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function closeWriteStream(
  stream: ReturnType<typeof createWriteStream>
): Promise<void> {
  return new Promise((resolvePromise) => {
    if (stream.closed) {
      resolvePromise();
      return;
    }
    stream.once("close", () => resolvePromise());
    stream.close();
  });
}

function endWriteStream(
  stream: ReturnType<typeof createWriteStream>
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    if (stream.closed) {
      resolvePromise();
      return;
    }
    const onError = (err: Error) => {
      stream.off("close", onClose);
      rejectPromise(err);
    };
    const onClose = () => {
      stream.off("error", onError);
      resolvePromise();
    };
    stream.once("error", onError);
    stream.once("close", onClose);
    stream.end();
  });
}

function writeChunkToStream(
  stream: ReturnType<typeof createWriteStream>,
  chunk: Buffer
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const cleanup = () => {
      stream.off("error", onError);
      stream.off("drain", onDrain);
    };
    const finishOk = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolvePromise();
      }
    };
    const finishErr = (err: Error) => {
      if (!settled) {
        settled = true;
        cleanup();
        rejectPromise(err);
      }
    };
    const onError = (err: Error) => finishErr(err);
    const onDrain = () => finishOk();

    stream.once("error", onError);
    const ok = stream.write(chunk, (err) => {
      if (err) {
        finishErr(err);
      } else if (ok) {
        finishOk();
      }
    });

    if (!ok) {
      stream.once("drain", onDrain);
    }
  });
}

function isRetryableDownloadError(error: unknown): boolean {
  if (error instanceof UpdateIntegrityError) {
    return false;
  }
  if (error instanceof RetryableTransferError) {
    return true;
  }
  if (error instanceof UpdateHttpError) {
    return (
      error.statusCode >= 500 ||
      error.statusCode === 408 ||
      error.statusCode === 429
    );
  }
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (
      code === "ECONNRESET" ||
      code === "ECONNREFUSED" ||
      code === "ETIMEDOUT" ||
      code === "EPIPE" ||
      code === "EAI_AGAIN" ||
      code === "ENOTFOUND" ||
      /aborted|premature|socket hang up|timed out/i.test(error.message)
    ) {
      return true;
    }
  }
  return false;
}

function parseContentRangeHeader(
  rawHeader: string | string[] | undefined
): { start: number; end: number | null; total: number | null } | null {
  const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof value !== "string") {
    return null;
  }
  const match = /^bytes\s+(\d+)-(\d+|\*)\/(\d+|\*)$/i.exec(value.trim());
  if (match === null) {
    return null;
  }
  const start = Number.parseInt(match[1]!, 10);
  const end = match[2] === "*" ? null : Number.parseInt(match[2]!, 10);
  const total = match[3] === "*" ? null : Number.parseInt(match[3]!, 10);
  if (!Number.isSafeInteger(start) || start < 0) {
    return null;
  }
  return { start, end, total };
}

function unrefTimerHandle(handle: unknown): void {
  if (
    typeof handle === "object" &&
    handle !== null &&
    "unref" in handle &&
    typeof (handle as { unref?: unknown }).unref === "function"
  ) {
    (handle as { unref: () => void }).unref();
  }
}

export class AppUpdater {
  private readonly currentVersion: string;
  private readonly dataDir: string;
  private readonly portableMode: boolean;
  private readonly downloadsDir: string;
  private readonly endpoints: AppUpdaterEndpoints;
  private readonly maxRedirects: number;
  private readonly maxRetries: number;
  private readonly retryDelaysMs: number[];
  private readonly sevenZipPathOverride: string | undefined;
  private readonly autoCheckInitialDelayMs: number;
  private readonly autoCheckIntervalMs: number;
  private readonly timers: AppUpdaterTimerApi;

  private policy: UpdatePolicyConfig;
  private checking = false;
  private downloading = false;
  private installState: UpdateInstallState = "idle";
  private progress: UpdateDownloadProgress | null = null;
  private lastCheck: UpdateCheckResult | null = null;
  private lastDownload: UpdateDownloadResult | null = null;
  private lastProbe: SourceProbeReport | null = null;
  private lastError: string | null = null;

  private readonly eventListeners = new Set<(event: UpdaterSseEventPayload) => void>();
  private autoCheckLifecycleEnabled = false;
  private autoCheckStarted = false;
  private autoCheckInitialTimer: ReturnType<typeof setTimeout> | undefined;
  private autoCheckIntervalTimer: ReturnType<typeof setInterval> | undefined;
  private nextAutoCheckAt: number | null = null;

  constructor(options: AppUpdaterOptions) {
    const currentVersion = (options.currentVersion ?? DEFAULT_APP_VERSION).trim();
    if (parseSemver(currentVersion) === null) {
      throw new Error(`Invalid AppUpdater currentVersion SemVer: "${currentVersion}".`);
    }

    this.currentVersion = currentVersion;
    this.dataDir = resolve(options.dataDir);
    this.portableMode = Boolean(options.portableMode);
    this.downloadsDir = resolve(
      options.downloadsDir ?? join(this.dataDir, "updates")
    );
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.sevenZipPathOverride = options.sevenZipPath;
    this.autoCheckInitialDelayMs = Math.max(
      0,
      options.autoCheckInitialDelayMs ?? DEFAULT_AUTO_CHECK_INITIAL_DELAY_MS
    );
    this.autoCheckIntervalMs = Math.max(
      1_000,
      options.autoCheckIntervalMs ?? DEFAULT_AUTO_CHECK_INTERVAL_MS
    );
    this.timers = options.timers ?? {
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval
    };

    this.endpoints = {
      githubOwner: options.endpoints?.githubOwner ?? UPDATE_ENDPOINTS.githubOwner,
      githubRepo: options.endpoints?.githubRepo ?? UPDATE_ENDPOINTS.githubRepo,
      githubApiBase: normalizeBaseUrl(
        options.githubApiBase ??
          options.endpoints?.githubApiBase ??
          UPDATE_ENDPOINTS.githubApiBase
      ),
      githubWebBase: normalizeBaseUrl(
        options.githubWebBase ??
          options.endpoints?.githubWebBase ??
          UPDATE_ENDPOINTS.githubWebBase
      ),
      giteeOwner: options.endpoints?.giteeOwner ?? UPDATE_ENDPOINTS.giteeOwner,
      giteeRepo: options.endpoints?.giteeRepo ?? UPDATE_ENDPOINTS.giteeRepo,
      giteeApiBase: normalizeBaseUrl(
        options.giteeApiBase ??
          options.endpoints?.giteeApiBase ??
          UPDATE_ENDPOINTS.giteeApiBase
      ),
      giteeWebBase: normalizeBaseUrl(
        options.giteeWebBase ??
          options.endpoints?.giteeWebBase ??
          UPDATE_ENDPOINTS.giteeWebBase
      )
    };

    const persisted = this.loadPersistedPolicy();
    this.policy = this.validatePolicy({
      ...DEFAULT_UPDATE_POLICY,
      ...(persisted ?? {}),
      ...(options.initialPolicy ?? {})
    });
  }

  getDownloadsDir(): string {
    return this.downloadsDir;
  }

  resolve7zaPath(): string | null {
    return resolve7zaBinary(this.sevenZipPathOverride);
  }

  getStatus(): UpdaterStatusSnapshot {
    return {
      ok: true,
      currentVersion: this.currentVersion,
      portableMode: this.portableMode,
      policy: { ...this.policy },
      checking: this.checking,
      downloading: this.downloading,
      installState: this.installState,
      progress: this.progress ? { ...this.progress } : null,
      downloadedFilePath: this.lastDownload?.filePath ?? null,
      downloadedSha256: this.lastDownload?.sha256 ?? null,
      lastCheck: this.lastCheck,
      lastDownload: this.lastDownload,
      lastProbe: this.lastProbe,
      lastError: this.lastError,
      autoCheckEnabled: this.policy.autoCheckEnabled !== false,
      nextAutoCheckAt: this.nextAutoCheckAt
    };
  }

  subscribeEvents(
    listener: (event: UpdaterSseEventPayload) => void
  ): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  private emitEvent(type: UpdaterSseEventType, error?: string | null): void {
    if (this.eventListeners.size === 0) {
      return;
    }
    const status = this.getStatus();
    const payload: UpdaterSseEventPayload = {
      type,
      timestamp: Date.now(),
      installState: status.installState,
      progress: status.progress,
      downloadedFilePath: status.downloadedFilePath,
      downloadedSha256: status.downloadedSha256,
      portableMode: status.portableMode,
      ...(error !== undefined ? { error } : {}),
      status
    };
    for (const listener of Array.from(this.eventListeners)) {
      try {
        listener(payload);
      } catch {
        // Isolate subscriber errors so one broken SSE client never stalls updater.
      }
    }
  }

  /**
   * Starts silent background update巡检: initial check 15s after start, then every 4h.
   * Respects `policy.autoCheckEnabled` and can be safely stopped via `stopAutoCheck()`.
   */
  startAutoCheck(): void {
    this.autoCheckLifecycleEnabled = true;
    this.stopAutoCheck();
    if (this.policy.autoCheckEnabled === false) {
      return;
    }

    this.autoCheckStarted = true;
    const runSilentCheck = () => {
      if (this.checking || this.downloading) {
        return;
      }
      void this.checkForUpdates().catch(() => {
        // Background check failures are recorded on `lastError` without unhandled rejections.
      });
    };

    const schedulePeriodic = () => {
      this.nextAutoCheckAt = Date.now() + this.autoCheckIntervalMs;
      this.autoCheckIntervalTimer = this.timers.setInterval(() => {
        this.nextAutoCheckAt = Date.now() + this.autoCheckIntervalMs;
        runSilentCheck();
      }, this.autoCheckIntervalMs);
      unrefTimerHandle(this.autoCheckIntervalTimer);
    };

    this.nextAutoCheckAt = Date.now() + this.autoCheckInitialDelayMs;
    this.autoCheckInitialTimer = this.timers.setTimeout(() => {
      this.autoCheckInitialTimer = undefined;
      if (!this.autoCheckStarted) {
        return;
      }
      runSilentCheck();
      schedulePeriodic();
    }, this.autoCheckInitialDelayMs);
    unrefTimerHandle(this.autoCheckInitialTimer);
  }

  stopAutoCheck(): void {
    this.autoCheckStarted = false;
    this.nextAutoCheckAt = null;
    if (this.autoCheckInitialTimer !== undefined) {
      this.timers.clearTimeout(this.autoCheckInitialTimer);
      this.autoCheckInitialTimer = undefined;
    }
    if (this.autoCheckIntervalTimer !== undefined) {
      this.timers.clearInterval(this.autoCheckIntervalTimer);
      this.autoCheckIntervalTimer = undefined;
    }
  }

  dispose(): void {
    this.autoCheckLifecycleEnabled = false;
    this.stopAutoCheck();
    this.eventListeners.clear();
  }

  getPolicy(): UpdatePolicyConfig {
    return { ...this.policy };
  }

  setPolicy(patch: UpdatePolicyPatch): UpdatePolicyConfig {
    const merged: UpdatePolicyConfig = {
      ...this.policy,
      ...(patch.routePreference !== undefined
        ? { routePreference: patch.routePreference }
        : {}),
      ...(patch.includePrerelease !== undefined
        ? { includePrerelease: patch.includePrerelease }
        : {}),
      ...(patch.customGhProxyPrefix !== undefined
        ? { customGhProxyPrefix: patch.customGhProxyPrefix }
        : {}),
      ...(patch.pluginRegistryOverride !== undefined
        ? { pluginRegistryOverride: patch.pluginRegistryOverride }
        : {}),
      ...(patch.timeoutMs !== undefined ? { timeoutMs: patch.timeoutMs } : {}),
      ...(patch.autoCheckEnabled !== undefined
        ? { autoCheckEnabled: patch.autoCheckEnabled }
        : {})
    };
    const validated = this.validatePolicy(merged);
    const shouldResumeAutoCheck =
      this.autoCheckLifecycleEnabled || this.autoCheckStarted;
    this.policy = validated;
    this.savePersistedPolicy(validated);

    if (validated.autoCheckEnabled === false) {
      this.stopAutoCheck();
    } else if (
      shouldResumeAutoCheck &&
      this.autoCheckInitialTimer === undefined &&
      this.autoCheckIntervalTimer === undefined
    ) {
      this.startAutoCheck();
    }
    this.emitEvent("status");
    return { ...this.policy };
  }

  async probeSources(): Promise<SourceProbeReport> {
    const timeoutMs = Math.min(this.policy.timeoutMs, 8_000);
    const githubApiUrl = `${this.endpoints.githubApiBase}/repos/${this.endpoints.githubOwner}/${this.endpoints.githubRepo}/releases?per_page=1`;
    const githubWebLatestUrl = `${this.endpoints.githubWebBase}/${this.endpoints.githubOwner}/${this.endpoints.githubRepo}/releases/latest`;
    const giteeApiUrl = `${this.endpoints.giteeApiBase}/repos/${this.endpoints.giteeOwner}/${this.endpoints.giteeRepo}/releases?page=1&per_page=1`;
    const giteeWebLatestUrl = `${this.endpoints.giteeWebBase}/${this.endpoints.giteeOwner}/${this.endpoints.giteeRepo}/releases/latest`;
    const giteeWebReleasesUrl = `${this.endpoints.giteeWebBase}/${this.endpoints.giteeOwner}/${this.endpoints.giteeRepo}/releases`;

    const probeGithub = async (): Promise<SourceEndpointProbe> => {
      const apiProbe = await this.probeSingleSource(
        "github",
        githubApiUrl,
        { accept: "application/vnd.github+json" },
        timeoutMs
      );
      if (
        !apiProbe.reachable &&
        (apiProbe.statusCode === 403 || apiProbe.statusCode === 429)
      ) {
        const webProbe = await this.probeSingleSource(
          "github",
          githubWebLatestUrl,
          { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
          timeoutMs,
          "HEAD",
          false
        );
        if (webProbe.reachable) {
          return webProbe;
        }
      }
      return apiProbe;
    };

    const probeGitee = async (): Promise<SourceEndpointProbe> => {
      const apiProbe = await this.probeSingleSource(
        "gitee",
        giteeApiUrl,
        { accept: "application/json" },
        timeoutMs
      );
      if (
        !apiProbe.reachable &&
        (apiProbe.statusCode === 403 || apiProbe.statusCode === 429)
      ) {
        const latestProbe = await this.probeSingleSource(
          "gitee",
          giteeWebLatestUrl,
          { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
          timeoutMs,
          "HEAD",
          false
        );
        if (latestProbe.reachable) {
          return latestProbe;
        }
        const webProbe = await this.probeSingleSource(
          "gitee",
          giteeWebReleasesUrl,
          { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
          timeoutMs,
          "HEAD",
          false
        );
        if (webProbe.reachable) {
          return webProbe;
        }
      }
      return apiProbe;
    };

    const [githubProbe, giteeProbe] = await Promise.all([
      probeGithub(),
      probeGitee()
    ]);

    let recommendedSource: UpdateSourceId = "github";
    if (githubProbe.reachable && giteeProbe.reachable) {
      const ghLatency = githubProbe.latencyMs ?? Number.POSITIVE_INFINITY;
      const giteeLatency = giteeProbe.latencyMs ?? Number.POSITIVE_INFINITY;
      recommendedSource = giteeLatency < ghLatency ? "gitee" : "github";
    } else if (giteeProbe.reachable && !githubProbe.reachable) {
      recommendedSource = "gitee";
    } else if (githubProbe.reachable && !giteeProbe.reachable) {
      recommendedSource = "github";
    }

    const report: SourceProbeReport = {
      probedAt: Date.now(),
      recommendedSource,
      recommendedRoute: recommendedSource === "gitee" ? "domestic" : "global",
      sources: [githubProbe, giteeProbe]
    };
    this.lastProbe = report;
    return report;
  }

  async checkForUpdates(
    options?: CheckForUpdatesOptions
  ): Promise<UpdateCheckResult> {
    this.checking = true;
    const prevInstallState = this.installState;
    if (!this.downloading) {
      this.installState = "checking";
    }
    this.emitEvent("checking");

    try {
      const includePrerelease =
        options?.channel === "stable"
          ? false
          : options?.channel === "prerelease"
            ? true
            : this.policy.includePrerelease;

      let probeReport: SourceProbeReport | undefined;
      let candidateOrder: UpdateSourceId[];
      if (options?.sourceOverride !== undefined) {
        candidateOrder = [options.sourceOverride];
      } else if (this.policy.routePreference === "domestic") {
        candidateOrder = ["gitee", "github"];
      } else if (this.policy.routePreference === "global") {
        candidateOrder = ["github", "gitee"];
      } else {
        probeReport = await this.probeSources();
        candidateOrder =
          probeReport.recommendedSource === "gitee"
            ? ["gitee", "github"]
            : ["github", "gitee"];
      }

      const errors: Array<{ source: UpdateSourceId; message: string }> = [];
      for (let i = 0; i < candidateOrder.length; i += 1) {
        const source = candidateOrder[i]!;
        try {
          const result = await this.checkSingleSource(
            source,
            includePrerelease,
            i > 0,
            probeReport,
            errors
          );
          this.lastCheck = result;
          this.lastError = null;
          if (!this.downloading) {
            if (
              prevInstallState === "ready" &&
              this.lastDownload !== null &&
              result.latestVersion === this.lastDownload.version &&
              existsSync(this.lastDownload.filePath)
            ) {
              this.installState = "ready";
            } else {
              this.installState = result.hasUpdate ? "available" : "up-to-date";
            }
          }
          this.emitEvent(result.hasUpdate ? "available" : "up-to-date");
          return result;
        } catch (error) {
          errors.push({
            source,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const summary = errors
        .map((item) => `${item.source}: ${item.message}`)
        .join("; ");
      const errMessage = `Failed to check for updates from all sources (${summary}).`;
      this.lastError = errMessage;
      if (!this.downloading) {
        this.installState = "error";
      }
      this.emitEvent("error", errMessage);
      throw new Error(errMessage);
    } finally {
      this.checking = false;
    }
  }

  async downloadUpdate(
    options?: DownloadUpdateOptions
  ): Promise<UpdateDownloadResult> {
    this.downloading = true;
    this.installState = "downloading";
    this.lastError = null;
    try {
      const checkResult =
        options?.checkResult ??
        (options?.sourceOverride !== undefined &&
        this.lastCheck?.sourceUsed !== options.sourceOverride
          ? await this.checkForUpdates({ sourceOverride: options.sourceOverride })
          : this.lastCheck ??
            (await this.checkForUpdates(
              options?.sourceOverride !== undefined
                ? { sourceOverride: options.sourceOverride }
                : undefined
            )));
      const primaryAsset = this.selectDownloadAsset(checkResult, options);
      if (primaryAsset === null) {
        throw new Error(
          `No matching Windows installer or portable asset available for update check (current ${this.currentVersion}).`
        );
      }

      const expectedSha = this.requireValidSha256(
        primaryAsset.expectedSha256 ?? primaryAsset.sha256,
        primaryAsset.expectedExeName ?? primaryAsset.name
      );
      const targetAssetName =
        primaryAsset.kind === "split-7z-exe"
          ? primaryAsset.expectedExeName ?? primaryAsset.name
          : primaryAsset.name;
      const safeName = sanitizeAssetFileName(targetAssetName);
      const destDir = resolve(options?.destDir ?? this.downloadsDir);
      mkdirSync(destDir, { recursive: true });
      const targetPath = join(destDir, safeName);
      const partPath = `${targetPath}.part`;

      const maxRetries = options?.maxRetries ?? this.maxRetries;
      const retryDelaysMs = options?.retryDelaysMs ?? this.retryDelaysMs;

      let activeSource: UpdateSourceId = primaryAsset.source;
      let usedFallbackSource = false;
      let activeAsset = primaryAsset;
      let activeSha = expectedSha;

      let lastSseEmitAt = 0;
      let lastSseStage: UpdateDownloadProgress["stage"] | null = null;
      let lastSsePart: number | undefined = undefined;
      let lastSsePercent: number | null = null;
      let lastSseBytes = -1;

      const resetProgressThrottle = () => {
        lastSseEmitAt = 0;
        lastSseStage = null;
        lastSsePart = undefined;
        lastSsePercent = null;
        lastSseBytes = -1;
      };

      const emitProgress = (prog: UpdateDownloadProgress) => {
        this.progress = prog;
        let sseType: UpdaterSseEventType;
        let sseError: string | null | undefined;
        if (prog.stage === "extracting") {
          this.installState = "extracting";
          sseType = "extracting";
        } else if (prog.stage === "verifying") {
          this.installState = "verifying";
          sseType = "verifying";
        } else if (prog.stage === "ready") {
          this.installState = "ready";
          sseType = "ready";
        } else if (prog.stage === "error") {
          this.installState = "error";
          sseType = "error";
          sseError = prog.message ?? null;
        } else {
          this.installState = "downloading";
          sseType = "progress";
        }

        const now = prog.updatedAt > 0 ? prog.updatedAt : Date.now();
        const isTerminalOrDiscrete =
          prog.stage === "ready" ||
          prog.stage === "error" ||
          (prog.stage === "extracting" &&
            (lastSseStage !== "extracting" || lastSsePercent !== prog.percent));
        const stageChanged = prog.stage !== lastSseStage;
        const partChanged = prog.currentPart !== lastSsePart;
        const hitPercentMilestone =
          prog.percent !== null &&
          prog.percent !== lastSsePercent &&
          (prog.percent >= 100 ||
            (prog.stage === "downloading" &&
              prog.percent >= DOWNLOAD_PROGRESS_MAX_PERCENT) ||
            (prog.stage === "downloading" &&
              typeof prog.currentPart === "number" &&
              typeof prog.totalParts === "number" &&
              prog.totalParts > 1 &&
              prog.percent >=
                roundPercent1(
                  (prog.currentPart / prog.totalParts) *
                    DOWNLOAD_PROGRESS_MAX_PERCENT,
                  0,
                  DOWNLOAD_PROGRESS_MAX_PERCENT
                )) ||
            (prog.stage === "verifying" && prog.percent >= VERIFY_MAX_PERCENT));
        const hitEndOfBytes =
          prog.totalBytes !== null &&
          prog.totalBytes > 0 &&
          prog.bytesDownloaded >= prog.totalBytes &&
          prog.bytesDownloaded !== lastSseBytes;
        const hitPercentDelta =
          prog.percent !== null &&
          (lastSsePercent === null ||
            Math.abs(prog.percent - lastSsePercent) >=
              PROGRESS_SSE_MIN_PERCENT_DELTA);
        const hitTimeInterval =
          now - lastSseEmitAt >= PROGRESS_SSE_THROTTLE_MS &&
          (prog.bytesDownloaded !== lastSseBytes ||
            prog.percent !== lastSsePercent);

        const shouldEmitSse =
          isTerminalOrDiscrete ||
          stageChanged ||
          partChanged ||
          hitPercentMilestone ||
          hitEndOfBytes ||
          hitPercentDelta ||
          hitTimeInterval;

        if (shouldEmitSse) {
          lastSseEmitAt = now;
          lastSseStage = prog.stage;
          lastSsePart = prog.currentPart;
          lastSsePercent = prog.percent;
          lastSseBytes = prog.bytesDownloaded;
          this.emitEvent(sseType, sseError);
        }

        options?.onProgress?.(prog);
      };

      const emitInitialHandshakeProgress = (asset: UpdateAssetInfo) => {
        const splitParts =
          asset.kind === "split-7z-exe" ? (asset.parts ?? []) : [];
        const initialTotalBytes = asset.totalBytes ?? asset.sizeBytes ?? null;
        emitProgress({
          stage: "downloading",
          phase: "downloading",
          bytesDownloaded: 0,
          totalBytes: initialTotalBytes,
          percent: 0,
          source: asset.source,
          ...(splitParts.length > 0
            ? {
                currentPart: 1,
                totalParts: splitParts.length,
                partName: splitParts[0]?.name
              }
            : { partName: asset.name }),
          message: `正在连接 ${asset.source === "gitee" ? "Gitee" : "GitHub"} 下载源...`,
          updatedAt: Date.now()
        });
      };

      emitInitialHandshakeProgress(activeAsset);

      try {
        const result = await this.executeAssetDownload({
          asset: activeAsset,
          expectedSha256: activeSha,
          version: checkResult.latestVersion ?? this.currentVersion,
          destDir,
          targetPath,
          partPath,
          usedFallbackSource,
          maxRetries,
          retryDelaysMs,
          onProgress: emitProgress
        });
        this.downloading = false;
        this.lastDownload = result;
        this.lastError = null;
        this.installState = "ready";
        const readyProgress: UpdateDownloadProgress = {
          stage: "ready",
          phase: "ready",
          bytesDownloaded: result.bytesDownloaded,
          totalBytes: result.totalBytes ?? result.bytesDownloaded,
          percent: 100,
          source: result.sourceUsed,
          message: `校验完成，已就绪：${result.assetName}`,
          updatedAt: Date.now()
        };
        this.progress = readyProgress;
        this.emitEvent("ready");
        options?.onProgress?.(readyProgress);
        return result;
      } catch (primaryError) {
        if (primaryError instanceof UpdateIntegrityError) {
          this.progress = {
            stage: "error",
            phase: "error",
            bytesDownloaded: this.progress?.bytesDownloaded ?? 0,
            totalBytes: this.progress?.totalBytes ?? null,
            percent: this.progress?.percent ?? null,
            source: activeSource,
            message: primaryError.message,
            updatedAt: Date.now()
          };
          throw primaryError;
        }

        // Remove potentially partial bytes from primary source before switching mirrors.
        rmSync(partPath, { force: true });

        const fallbackSource: UpdateSourceId =
          activeSource === "github" ? "gitee" : "github";
        const fallbackIncludePrerelease =
          checkResult.channel === "stable"
            ? false
            : checkResult.channel === "prerelease"
              ? true
              : this.policy.includePrerelease;
        let fallbackCheck: UpdateCheckResult;
        try {
          fallbackCheck = await this.checkSingleSource(
            fallbackSource,
            fallbackIncludePrerelease,
            true,
            undefined,
            [
              {
                source: activeSource,
                message:
                  primaryError instanceof Error
                    ? primaryError.message
                    : String(primaryError)
              }
            ]
          );
        } catch (fallbackCheckError) {
          const combined = `Primary source ${activeSource} failed (${primaryError instanceof Error ? primaryError.message : String(primaryError)}); fallback source ${fallbackSource} check failed (${fallbackCheckError instanceof Error ? fallbackCheckError.message : String(fallbackCheckError)}).`;
          throw new Error(combined);
        }

        const fallbackAsset =
          fallbackCheck.assets.find((item) => item.name === targetAssetName) ??
          fallbackCheck.assets.find(
            (item) => item.expectedExeName === targetAssetName
          ) ??
          fallbackCheck.assets.find((item) => item.kind === primaryAsset.kind) ??
          fallbackCheck.assets.find(
            (item) =>
              (primaryAsset.kind === "setup-exe" && item.kind === "split-7z-exe") ||
              (primaryAsset.kind === "split-7z-exe" && item.kind === "setup-exe")
          ) ??
          fallbackCheck.recommendedAsset;

        if (fallbackAsset === null || fallbackAsset === undefined) {
          const msg = `Primary source ${activeSource} failed (${primaryError instanceof Error ? primaryError.message : String(primaryError)}); fallback source ${fallbackSource} had no matching asset for "${targetAssetName}".`;
          throw new Error(msg);
        }

        const fallbackSha = this.requireValidSha256(
          fallbackAsset.expectedSha256 ?? fallbackAsset.sha256,
          fallbackAsset.expectedExeName ?? fallbackAsset.name
        );
        const fallbackTargetName =
          fallbackAsset.kind === "split-7z-exe"
            ? fallbackAsset.expectedExeName ?? fallbackAsset.name
            : fallbackAsset.name;
        if (
          fallbackCheck.latestVersion === checkResult.latestVersion &&
          fallbackTargetName === targetAssetName &&
          fallbackSha !== expectedSha
        ) {
          const msg = `Fallback source ${fallbackSource} SHA-256 for "${fallbackTargetName}" disagrees with primary ${activeSource}.`;
          throw new Error(msg);
        }

        activeSource = fallbackSource;
        usedFallbackSource = true;
        activeAsset = fallbackAsset;
        activeSha = fallbackSha;

        const fallbackSafeName = sanitizeAssetFileName(fallbackTargetName);
        const fallbackTargetPath = join(destDir, fallbackSafeName);
        const fallbackPartPath = `${fallbackTargetPath}.part`;

        resetProgressThrottle();
        emitInitialHandshakeProgress(activeAsset);

        const fallbackResult = await this.executeAssetDownload({
          asset: activeAsset,
          expectedSha256: activeSha,
          version:
            fallbackCheck.latestVersion ??
            checkResult.latestVersion ??
            this.currentVersion,
          destDir,
          targetPath: fallbackTargetPath,
          partPath: fallbackPartPath,
          usedFallbackSource,
          maxRetries,
          retryDelaysMs,
          onProgress: emitProgress
        });
        this.downloading = false;
        this.lastDownload = fallbackResult;
        this.lastError = null;
        this.installState = "ready";
        const readyProgress: UpdateDownloadProgress = {
          stage: "ready",
          phase: "ready",
          bytesDownloaded: fallbackResult.bytesDownloaded,
          totalBytes: fallbackResult.totalBytes ?? fallbackResult.bytesDownloaded,
          percent: 100,
          source: fallbackResult.sourceUsed,
          message: `校验完成，已就绪：${fallbackResult.assetName}`,
          updatedAt: Date.now()
        };
        this.progress = readyProgress;
        this.emitEvent("ready");
        options?.onProgress?.(readyProgress);
        return fallbackResult;
      }
    } catch (err) {
      this.downloading = false;
      this.installState = "error";
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emitEvent("error", this.lastError);
      throw err;
    } finally {
      this.downloading = false;
    }
  }

  private async executeAssetDownload(params: {
    asset: UpdateAssetInfo;
    expectedSha256: string;
    version: string;
    destDir: string;
    targetPath: string;
    partPath: string;
    usedFallbackSource: boolean;
    maxRetries: number;
    retryDelaysMs: number[];
    onProgress: (progress: UpdateDownloadProgress) => void;
  }): Promise<UpdateDownloadResult> {
    if (params.asset.kind === "split-7z-exe") {
      return this.downloadAndExtractSplit7zAsset(params);
    }
    return this.downloadAndVerifySingleAsset(params);
  }

  private validatePolicy(raw: UpdatePolicyConfig): UpdatePolicyConfig {
    if (
      !(NETWORK_ROUTE_PREFERENCES as readonly string[]).includes(
        raw.routePreference
      )
    ) {
      throw new Error(
        `Invalid routePreference "${String(raw.routePreference)}": expected one of ${NETWORK_ROUTE_PREFERENCES.join(", ")}.`
      );
    }
    if (typeof raw.includePrerelease !== "boolean") {
      throw new Error("includePrerelease must be a boolean.");
    }
    if (typeof raw.customGhProxyPrefix !== "string") {
      throw new Error("customGhProxyPrefix must be a string.");
    }
    const cleanPrefix = raw.customGhProxyPrefix.trim();
    if (cleanPrefix.length > 0 && !/^https?:\/\//i.test(cleanPrefix)) {
      throw new Error(
        `customGhProxyPrefix must start with http:// or https://, got "${cleanPrefix}".`
      );
    }
    if (
      raw.pluginRegistryOverride !== "auto" &&
      !(PLUGIN_REGISTRY_IDS as readonly string[]).includes(
        raw.pluginRegistryOverride
      )
    ) {
      throw new Error(
        `Invalid pluginRegistryOverride "${String(raw.pluginRegistryOverride)}".`
      );
    }
    if (
      typeof raw.timeoutMs !== "number" ||
      !Number.isFinite(raw.timeoutMs) ||
      raw.timeoutMs < 100 ||
      raw.timeoutMs > 300_000
    ) {
      throw new Error("timeoutMs must be a finite number between 100 and 300000.");
    }
    const autoCheckEnabled =
      raw.autoCheckEnabled === undefined ? true : Boolean(raw.autoCheckEnabled);

    return {
      routePreference: raw.routePreference as NetworkRoutePreference,
      includePrerelease: raw.includePrerelease,
      customGhProxyPrefix: cleanPrefix,
      pluginRegistryOverride: raw.pluginRegistryOverride,
      timeoutMs: Math.round(raw.timeoutMs),
      autoCheckEnabled
    };
  }

  private loadPersistedPolicy(): UpdatePolicyPatch | null {
    const filePath = join(this.dataDir, POLICY_FILENAME);
    if (!existsSync(filePath)) {
      return null;
    }
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      return isRecord(parsed) ? (parsed as UpdatePolicyPatch) : null;
    } catch {
      return null;
    }
  }

  private savePersistedPolicy(policy: UpdatePolicyConfig): void {
    try {
      mkdirSync(this.dataDir, { recursive: true });
      writeFileSync(
        join(this.dataDir, POLICY_FILENAME),
        `${JSON.stringify(policy, null, 2)}\n`,
        "utf8"
      );
    } catch {
      // Best-effort policy persistence
    }
  }

  private async probeSingleSource(
    source: UpdateSourceId,
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
    method: "GET" | "HEAD" = "GET",
    followRedirects = true
  ): Promise<SourceEndpointProbe> {
    const startedAt = performance.now();
    try {
      const response = await openHttpWithRedirects(
        url,
        headers,
        timeoutMs,
        this.maxRedirects,
        method,
        followRedirects
      );
      response.stream.resume();
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const reachable = response.statusCode >= 200 && response.statusCode < 400;
      return {
        source,
        url,
        reachable,
        statusCode: response.statusCode,
        latencyMs,
        ...(reachable ? {} : { error: `HTTP ${response.statusCode}` })
      };
    } catch (error) {
      return {
        source,
        url,
        reachable: false,
        statusCode: null,
        latencyMs: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async checkSingleSource(
    source: UpdateSourceId,
    includePrerelease: boolean,
    usedFallbackSource: boolean,
    probeReport: SourceProbeReport | undefined,
    priorErrors: Array<{ source: UpdateSourceId; message: string }>
  ): Promise<UpdateCheckResult> {
    const releasesUrl =
      source === "github"
        ? `${this.endpoints.githubApiBase}/repos/${this.endpoints.githubOwner}/${this.endpoints.githubRepo}/releases?per_page=20`
        : `${this.endpoints.giteeApiBase}/repos/${this.endpoints.giteeOwner}/${this.endpoints.giteeRepo}/releases?page=1&per_page=20&direction=desc`;

    const headers: Record<string, string> =
      source === "github"
        ? { accept: "application/vnd.github+json" }
        : { accept: "application/json" };

    let parsedJson: unknown;
    let usedGiteeWebFallback = false;
    try {
      const rawText = await fetchText(
        releasesUrl,
        headers,
        this.policy.timeoutMs,
        this.maxRedirects
      );
      parsedJson = JSON.parse(rawText) as unknown;
    } catch (error) {
      if (
        source === "gitee" &&
        error instanceof UpdateHttpError &&
        (error.statusCode === 403 || error.statusCode === 429)
      ) {
        usedGiteeWebFallback = true;
        const giteeWebUrl = `${this.endpoints.giteeWebBase}/${this.endpoints.giteeOwner}/${this.endpoints.giteeRepo}/releases`;
        const html = await fetchText(
          giteeWebUrl,
          { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
          this.policy.timeoutMs,
          this.maxRedirects
        );
        parsedJson = parseGiteeWebReleasesHtml(
          html,
          this.endpoints.giteeWebBase,
          this.endpoints.giteeOwner,
          this.endpoints.giteeRepo
        );
      } else {
        throw error;
      }
    }
    if (!Array.isArray(parsedJson)) {
      throw new Error(`Expected JSON array of releases from ${source}.`);
    }

    const candidates: ParsedReleaseCandidate[] = [];
    for (const item of parsedJson) {
      if (!isRecord(item)) {
        continue;
      }
      const raw = item as RawReleaseRecord;
      if (raw.draft === true) {
        continue;
      }
      if (typeof raw.tag_name !== "string" || raw.tag_name.trim().length === 0) {
        continue;
      }
      const tagName = raw.tag_name.trim();
      const version = normalizeTagToVersion(tagName);
      const parsedSemver = parseSemver(version);
      if (parsedSemver === null) {
        continue;
      }
      const prerelease =
        raw.prerelease === true || parsedSemver.prerelease.length > 0;
      if (!includePrerelease && prerelease) {
        continue;
      }

      const rawAssetsList = Array.isArray(raw.assets) ? raw.assets : [];
      const rawAssets: ParsedReleaseCandidate["rawAssets"] = [];
      for (const rawAsset of rawAssetsList) {
        if (!isRecord(rawAsset)) {
          continue;
        }
        const typedAsset = rawAsset as RawReleaseAsset;
        if (
          typeof typedAsset.browser_download_url !== "string" ||
          typedAsset.browser_download_url.trim().length === 0
        ) {
          continue;
        }
        const downloadUrl = typedAsset.browser_download_url.trim();
        const name = extractAssetName(typedAsset, downloadUrl);
        if (name.length === 0) {
          continue;
        }
        const sizeBytes =
          typeof typedAsset.size === "number" && Number.isFinite(typedAsset.size)
            ? typedAsset.size
            : null;
        rawAssets.push({ name, downloadUrl, sizeBytes });
      }

      const fallbackHtmlUrl =
        source === "github"
          ? `${this.endpoints.githubWebBase}/${this.endpoints.githubOwner}/${this.endpoints.githubRepo}/releases/tag/${encodeURIComponent(tagName)}`
          : `${this.endpoints.giteeWebBase}/${this.endpoints.giteeOwner}/${this.endpoints.giteeRepo}/releases/tag/${encodeURIComponent(tagName)}`;

      candidates.push({
        version,
        tagName,
        prerelease,
        releaseName:
          typeof raw.name === "string" && raw.name.trim().length > 0
            ? raw.name.trim()
            : tagName,
        releaseNotes: normalizeReleaseNotesBody(raw.body),
        publishedAt:
          typeof raw.published_at === "string" && raw.published_at.trim().length > 0
            ? raw.published_at.trim()
            : typeof raw.created_at === "string" && raw.created_at.trim().length > 0
              ? raw.created_at.trim()
              : null,
        htmlUrl:
          typeof raw.html_url === "string" && raw.html_url.trim().length > 0
            ? raw.html_url.trim()
            : fallbackHtmlUrl,
        rawAssets
      });
    }

    candidates.sort((a, b) => compareSemver(b.version, a.version));
    const best = candidates[0];
    if (best === undefined) {
      return {
        checkedAt: Date.now(),
        currentVersion: this.currentVersion,
        hasUpdate: false,
        latestVersion: null,
        tagName: null,
        channel: null,
        prerelease: false,
        releaseName: null,
        releaseNotes: null,
        publishedAt: null,
        htmlUrl: null,
        sourceUsed: source,
        usedFallbackSource,
        recommendedAsset: null,
        assets: [],
        ...(probeReport !== undefined ? { probeReport } : {}),
        ...(priorErrors.length > 0 ? { errors: [...priorErrors] } : {})
      };
    }

    // If Gitee index HTML omitted inline release body for the selected tag,
    // attempt a single best-effort fetch of its dedicated tag page.
    let resolvedReleaseNotes = best.releaseNotes;
    if (usedGiteeWebFallback && resolvedReleaseNotes === null && best.htmlUrl !== null) {
      try {
        const tagHtml = await fetchText(
          best.htmlUrl,
          { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
          Math.min(this.policy.timeoutMs, 8_000),
          this.maxRedirects
        );
        resolvedReleaseNotes = extractGiteeReleaseBodyFromHtml(tagHtml);
      } catch {
        // Best-effort only: never fail update check if tag detail page is unreachable.
      }
    }

    const hasUpdate = compareSemver(best.version, this.currentVersion) > 0;
    const assets = hasUpdate
      ? await this.resolveReleaseAssetsWithSha256(best, source)
      : [];
    const recommendedAsset = this.pickRecommendedAsset(assets);

    return {
      checkedAt: Date.now(),
      currentVersion: this.currentVersion,
      hasUpdate,
      latestVersion: best.version,
      tagName: best.tagName,
      channel: best.prerelease ? "prerelease" : "stable",
      prerelease: best.prerelease,
      releaseName: best.releaseName,
      releaseNotes: resolvedReleaseNotes,
      publishedAt: best.publishedAt,
      htmlUrl: best.htmlUrl,
      sourceUsed: source,
      usedFallbackSource,
      recommendedAsset,
      assets,
      ...(probeReport !== undefined ? { probeReport } : {}),
      ...(priorErrors.length > 0 ? { errors: [...priorErrors] } : {})
    };
  }

  private async resolveSha256ForAssetName(
    assetName: string,
    release: ParsedReleaseCandidate,
    source: UpdateSourceId,
    sumsMap: Map<string, string>,
    sumsSourceUrl: string | undefined
  ): Promise<{ sha256: string | null; sha256SourceUrl?: string }> {
    const companionName = `${assetName.toLowerCase()}.sha256`;
    const companion = release.rawAssets.find(
      (item) => item.name.toLowerCase() === companionName
    );
    if (companion !== undefined) {
      const companionUrl = this.resolveSourceUrl(companion.downloadUrl, source);
      try {
        const companionText = await fetchText(
          companionUrl,
          {},
          this.policy.timeoutMs,
          this.maxRedirects,
          256 * 1024
        );
        const parsedDigest = parseSingleAssetSha256Text(companionText, assetName);
        if (isValidSha256Hex(parsedDigest)) {
          return { sha256: parsedDigest, sha256SourceUrl: companionUrl };
        }
      } catch {
        // Fall through to SHA256SUMS.txt
      }
    }

    const fromSums = sumsMap.get(assetName.toLowerCase());
    if (isValidSha256Hex(fromSums)) {
      return {
        sha256: fromSums,
        ...(sumsSourceUrl !== undefined ? { sha256SourceUrl: sumsSourceUrl } : {})
      };
    }

    return { sha256: null };
  }

  private async resolveReleaseAssetsWithSha256(
    release: ParsedReleaseCandidate,
    source: UpdateSourceId
  ): Promise<UpdateAssetInfo[]> {
    const checksumAsset = selectSoftwareChecksumAsset(
      release.rawAssets,
      release.version
    );

    let sumsMap = new Map<string, string>();
    let sumsSourceUrl: string | undefined;
    if (checksumAsset !== undefined) {
      sumsSourceUrl = this.resolveSourceUrl(checksumAsset.downloadUrl, source);
      try {
        const sumsText = await fetchText(
          sumsSourceUrl,
          {},
          this.policy.timeoutMs,
          this.maxRedirects
        );
        sumsMap = parseSha256SumsText(sumsText);
      } catch {
        // Leave sumsMap empty; per-asset .sha256 files can still verify
      }
    }

    const resolvedAssets: UpdateAssetInfo[] = [];

    // 1. Standard single-file assets (.exe / portable .zip)
    for (const rawAsset of release.rawAssets) {
      const kind = classifyPackageAssetKind(rawAsset.name, release.version);
      if (kind === null) {
        continue;
      }

      const { sha256, sha256SourceUrl } = await this.resolveSha256ForAssetName(
        rawAsset.name,
        release,
        source,
        sumsMap,
        sumsSourceUrl
      );

      const effectiveUrl = this.resolveSourceUrl(rawAsset.downloadUrl, source);
      resolvedAssets.push({
        name: rawAsset.name,
        kind,
        downloadUrl: rawAsset.downloadUrl,
        effectiveUrl,
        sizeBytes: rawAsset.sizeBytes,
        sha256,
        ...(sha256SourceUrl !== undefined
          ? { sha256SourceUrl, sha256Url: sha256SourceUrl }
          : {}),
        source
      });
    }

    // 2. Gitee split-7z multi-volume archives: `<name>.exe.7z.001..N`
    const splitGroups = new Map<
      string,
      {
        expectedExeName: string;
        entries: Array<{
          index: number;
          name: string;
          downloadUrl: string;
          sizeBytes: number | null;
        }>;
      }
    >();

    for (const rawAsset of release.rawAssets) {
      const match = SPLIT_7Z_EXE_RE.exec(rawAsset.name);
      if (match === null) {
        continue;
      }
      const expectedExeName = match[1]!;
      const partIndex = Number.parseInt(match[2]!, 10);
      if (!Number.isInteger(partIndex) || partIndex < 1) {
        continue;
      }
      const key = expectedExeName.toLowerCase();
      let group = splitGroups.get(key);
      if (group === undefined) {
        group = { expectedExeName, entries: [] };
        splitGroups.set(key, group);
      }
      group.entries.push({
        index: partIndex,
        name: rawAsset.name,
        downloadUrl: rawAsset.downloadUrl,
        sizeBytes: rawAsset.sizeBytes
      });
    }

    for (const group of splitGroups.values()) {
      group.entries.sort((a, b) => a.index - b.index);
      // Verify contiguous 1..N part indices without gaps or duplicates.
      let contiguous = group.entries.length > 0;
      for (let i = 0; i < group.entries.length; i += 1) {
        if (group.entries[i]!.index !== i + 1) {
          contiguous = false;
          break;
        }
      }
      if (!contiguous) {
        continue;
      }

      const parts: UpdateSplitArchivePart[] = group.entries.map((entry) => ({
        name: entry.name,
        url: entry.downloadUrl,
        effectiveUrl: this.resolveSourceUrl(entry.downloadUrl, source),
        ...(entry.sizeBytes !== null ? { size: entry.sizeBytes } : {})
      }));

      const allHaveSize = group.entries.every((e) => e.sizeBytes !== null);
      const totalBytes = allHaveSize
        ? group.entries.reduce((acc, e) => acc + (e.sizeBytes ?? 0), 0)
        : null;

      const { sha256, sha256SourceUrl } = await this.resolveSha256ForAssetName(
        group.expectedExeName,
        release,
        source,
        sumsMap,
        sumsSourceUrl
      );

      const firstPart = parts[0]!;
      resolvedAssets.push({
        name: group.expectedExeName,
        kind: "split-7z-exe",
        downloadUrl: firstPart.url,
        effectiveUrl: firstPart.effectiveUrl ?? firstPart.url,
        sizeBytes: totalBytes,
        totalBytes,
        sha256,
        expectedSha256: sha256,
        expectedExeName: group.expectedExeName,
        ...(sha256SourceUrl !== undefined
          ? { sha256SourceUrl, sha256Url: sha256SourceUrl }
          : {}),
        parts,
        source
      });
    }

    return resolvedAssets;
  }

  private resolveSourceUrl(rawUrl: string, source: UpdateSourceId): string {
    if (source === "github") {
      return applyGhProxyPrefix(rawUrl, this.policy.customGhProxyPrefix);
    }
    return rawUrl;
  }

  private pickRecommendedAsset(
    assets: readonly UpdateAssetInfo[]
  ): UpdateAssetInfo | null {
    if (assets.length === 0) {
      return null;
    }
    const order: UpdatePackageKind[] = this.portableMode
      ? ["portable-zip", "setup-exe", "split-7z-exe"]
      : ["setup-exe", "split-7z-exe", "portable-zip"];

    for (const kind of order) {
      const matched = assets.find((item) => item.kind === kind);
      if (matched !== undefined) {
        return matched;
      }
    }
    return assets[0] ?? null;
  }

  private selectDownloadAsset(
    checkResult: UpdateCheckResult,
    options?: DownloadUpdateOptions
  ): UpdateAssetInfo | null {
    if (options?.asset !== undefined) {
      return options.asset;
    }
    if (options?.assetName !== undefined && options.assetName.trim().length > 0) {
      const wanted = options.assetName.trim().toLowerCase();
      const byName = checkResult.assets.find(
        (item) =>
          item.name.toLowerCase() === wanted ||
          item.expectedExeName?.toLowerCase() === wanted
      );
      if (byName !== undefined) {
        return byName;
      }
    }
    if (options?.kind !== undefined) {
      const matched = checkResult.assets.find(
        (item) => item.kind === options.kind
      );
      if (matched !== undefined) {
        return matched;
      }
      if (options.kind === "setup-exe") {
        const splitMatch = checkResult.assets.find(
          (item) => item.kind === "split-7z-exe"
        );
        if (splitMatch !== undefined) {
          return splitMatch;
        }
      }
    }
    if (!checkResult.hasUpdate) {
      return null;
    }
    return (
      checkResult.recommendedAsset ??
      this.pickRecommendedAsset(checkResult.assets)
    );
  }

  private requireValidSha256(
    sha256: string | null | undefined,
    assetName: string
  ): string {
    const normalized =
      typeof sha256 === "string" ? sha256.trim().toLowerCase() : "";
    if (!SHA256_HEX_RE.test(normalized)) {
      throw new Error(
        `Refusing to download or install update "${assetName}": missing valid 64-char SHA-256 checksum.`
      );
    }
    return normalized;
  }

  private async streamDownloadFileWithResume(params: {
    url: string;
    partPath: string;
    expectedSizeHint: number | null;
    maxRetries: number;
    retryDelaysMs: number[];
    onChunkProgress: (bytesWrittenTotal: number, fileTotalHint: number | null) => void;
    checkCompleteDigest?: string;
  }): Promise<{ bytes: number; resumedFromBytes: number }> {
    let resumedFromBytes = 0;

    for (let attempt = 0; attempt <= params.maxRetries; attempt += 1) {
      try {
        const existingSize = existsSync(params.partPath)
          ? statSync(params.partPath).size
          : 0;
        const headers: Record<string, string> = {};
        if (existingSize > 0) {
          headers["range"] = `bytes=${existingSize}-`;
        }

        const response = await openHttpWithRedirects(
          params.url,
          headers,
          this.policy.timeoutMs,
          this.maxRedirects
        );

        if (response.statusCode === 416) {
          response.stream.resume();
          if (existsSync(params.partPath)) {
            if (params.checkCompleteDigest !== undefined) {
              const checkExisting = await computeFileSha256(params.partPath);
              if (checkExisting.sha256 === params.checkCompleteDigest) {
                params.onChunkProgress(checkExisting.bytes, checkExisting.bytes);
                return {
                  bytes: checkExisting.bytes,
                  resumedFromBytes: checkExisting.bytes
                };
              }
            } else if (
              params.expectedSizeHint !== null &&
              existingSize === params.expectedSizeHint
            ) {
              params.onChunkProgress(existingSize, existingSize);
              return {
                bytes: existingSize,
                resumedFromBytes: existingSize
              };
            }
            rmSync(params.partPath, { force: true });
          }
          throw new RetryableTransferError(
            "Server returned 416; restarting from byte 0."
          );
        }

        if (response.statusCode !== 200 && response.statusCode !== 206) {
          response.stream.resume();
          throw new UpdateHttpError(response.statusCode, params.url);
        }

        const contentRange = parseContentRangeHeader(
          response.headers["content-range"]
        );
        let appendMode = false;
        let currentOffset = 0;
        if (response.statusCode === 206 && existingSize > 0) {
          if (contentRange !== null && contentRange.start !== existingSize) {
            response.stream.resume();
            rmSync(params.partPath, { force: true });
            throw new RetryableTransferError(
              `Content-Range start ${contentRange.start} mismatched offset ${existingSize}.`
            );
          }
          appendMode = true;
          currentOffset = existingSize;
          if (resumedFromBytes === 0) {
            resumedFromBytes = existingSize;
          }
        }

        const parsedContentLength = parsePositiveIntegerHeader(
          response.headers["content-length"]
        );
        const parsedContentRangeTotal =
          contentRange !== null &&
          contentRange.total !== null &&
          Number.isSafeInteger(contentRange.total) &&
          contentRange.total > 0
            ? contentRange.total
            : null;
        const totalBytesForProgress =
          parsedContentLength !== null
            ? currentOffset + parsedContentLength
            : parsedContentRangeTotal !== null
              ? parsedContentRangeTotal
              : params.expectedSizeHint;

        // Emit immediate header-received progress so UI gets real total size right away.
        params.onChunkProgress(currentOffset, totalBytesForProgress);

        const writeStream = createWriteStream(params.partPath, {
          flags: appendMode ? "a" : "w"
        });

        let bytesWrittenThisAttempt = 0;
        let streamError: unknown = null;

        try {
          for await (const chunk of response.stream) {
            const buf = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk as Uint8Array);
            if (buf.length === 0) {
              continue;
            }
            await writeChunkToStream(writeStream, buf);
            bytesWrittenThisAttempt += buf.length;
            params.onChunkProgress(
              currentOffset + bytesWrittenThisAttempt,
              totalBytesForProgress
            );
          }
        } catch (err) {
          streamError = err;
        }

        if (streamError !== null) {
          await closeWriteStream(writeStream);
          throw streamError;
        }

        await endWriteStream(writeStream);

        if (!response.stream.complete) {
          throw new RetryableTransferError(
            `Download stream aborted prematurely (${bytesWrittenThisAttempt} bytes received).`
          );
        }

        if (
          parsedContentLength !== null &&
          bytesWrittenThisAttempt !== parsedContentLength
        ) {
          throw new RetryableTransferError(
            `Truncated response body: expected ${parsedContentLength} bytes, got ${bytesWrittenThisAttempt}.`
          );
        }

        const finalSize = existsSync(params.partPath)
          ? statSync(params.partPath).size
          : currentOffset + bytesWrittenThisAttempt;
        params.onChunkProgress(finalSize, totalBytesForProgress ?? finalSize);
        return { bytes: finalSize, resumedFromBytes };
      } catch (error) {
        if (attempt < params.maxRetries && isRetryableDownloadError(error)) {
          const delayMs =
            params.retryDelaysMs[
              Math.min(attempt, params.retryDelaysMs.length - 1)
            ] ?? 200;
          await sleepMs(delayMs);
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Exhausted retries while downloading ${params.url}`);
  }

  private async probeRemoteAssetSize(url: string): Promise<number | null> {
    const headTimeoutMs = Math.min(this.policy.timeoutMs, HEAD_SIZE_PROBE_TIMEOUT_MS);
    try {
      const response = await openHttpWithRedirects(
        url,
        {},
        headTimeoutMs,
        this.maxRedirects,
        "HEAD",
        true
      );
      response.stream.resume();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return null;
      }
      const fromLength = parsePositiveIntegerHeader(
        response.headers["content-length"]
      );
      if (fromLength !== null) {
        return fromLength;
      }
      const contentRange = parseContentRangeHeader(
        response.headers["content-range"]
      );
      if (
        contentRange !== null &&
        contentRange.total !== null &&
        Number.isSafeInteger(contentRange.total) &&
        contentRange.total > 0
      ) {
        return contentRange.total;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async downloadAndVerifySingleAsset(params: {
    asset: UpdateAssetInfo;
    expectedSha256: string;
    version: string;
    targetPath: string;
    partPath: string;
    usedFallbackSource: boolean;
    maxRetries: number;
    retryDelaysMs: number[];
    onProgress: (progress: UpdateDownloadProgress) => void;
  }): Promise<UpdateDownloadResult> {
    const effectiveDownloadUrl = this.resolveSourceUrl(
      params.asset.downloadUrl,
      params.asset.source
    );

    let lastDownloadPercent = 0;
    const transfer = await this.streamDownloadFileWithResume({
      url: effectiveDownloadUrl,
      partPath: params.partPath,
      expectedSizeHint: params.asset.sizeBytes ?? null,
      maxRetries: params.maxRetries,
      retryDelaysMs: params.retryDelaysMs,
      checkCompleteDigest: params.expectedSha256,
      onChunkProgress: (bytesDownloaded, totalBytes) => {
        const rawPercent = computeWeightedDownloadPercent(
          bytesDownloaded,
          totalBytes,
          DOWNLOAD_PROGRESS_MAX_PERCENT
        );
        const percent =
          rawPercent !== null
            ? Math.max(lastDownloadPercent, rawPercent)
            : null;
        if (percent !== null) {
          lastDownloadPercent = percent;
        }
        params.onProgress({
          stage: "downloading",
          phase: "downloading",
          bytesDownloaded,
          totalBytes,
          percent,
          source: params.asset.source,
          partName: params.asset.name,
          message: `正在下载 ${params.asset.name}...`,
          updatedAt: Date.now()
        });
      }
    });

    if (!existsSync(params.partPath)) {
      throw new Error(
        `Partial update file missing after download: ${params.partPath}`
      );
    }

    const verifyTotalBytes = params.asset.sizeBytes ?? transfer.bytes;
    let lastVerifyPercent = DOWNLOAD_PROGRESS_MAX_PERCENT;
    const computed = await computeFileSha256(
      params.partPath,
      (hashedBytes, totalHashBytes) => {
        const frac =
          totalHashBytes > 0
            ? Math.max(0, Math.min(1, hashedBytes / totalHashBytes))
            : 1;
        const candidate = roundPercent1(
          DOWNLOAD_PROGRESS_MAX_PERCENT +
            frac * (VERIFY_MAX_PERCENT - DOWNLOAD_PROGRESS_MAX_PERCENT),
          DOWNLOAD_PROGRESS_MAX_PERCENT,
          VERIFY_MAX_PERCENT
        );
        const percent = Math.max(lastVerifyPercent, candidate);
        lastVerifyPercent = percent;
        params.onProgress({
          stage: "verifying",
          phase: "verifying",
          bytesDownloaded: transfer.bytes,
          totalBytes: verifyTotalBytes,
          percent,
          source: params.asset.source,
          partName: params.asset.name,
          message: "正在执行 SHA-256 完整性校验...",
          updatedAt: Date.now()
        });
      }
    );
    if (computed.sha256 !== params.expectedSha256) {
      rmSync(params.partPath, { force: true });
      throw new UpdateIntegrityError(
        params.asset.name,
        params.expectedSha256,
        computed.sha256
      );
    }

    rmSync(params.targetPath, { force: true });
    renameSync(params.partPath, params.targetPath);

    return {
      downloadedAt: Date.now(),
      version: params.version,
      assetName: params.asset.name,
      filePath: params.targetPath,
      bytesDownloaded: computed.bytes,
      totalBytes: params.asset.sizeBytes ?? computed.bytes,
      resumedFromBytes: transfer.resumedFromBytes,
      sha256: computed.sha256,
      verified: true,
      sourceUsed: params.asset.source,
      usedFallbackSource: params.usedFallbackSource,
      downloadUrl: effectiveDownloadUrl,
      packageKind: params.asset.kind
    };
  }

  private async downloadAndExtractSplit7zAsset(params: {
    asset: UpdateAssetInfo;
    expectedSha256: string;
    version: string;
    destDir: string;
    targetPath: string;
    usedFallbackSource: boolean;
    maxRetries: number;
    retryDelaysMs: number[];
    onProgress: (progress: UpdateDownloadProgress) => void;
  }): Promise<UpdateDownloadResult> {
    const parts = params.asset.parts ?? [];
    if (parts.length === 0) {
      throw new Error(
        `Split-7z update asset "${params.asset.name}" contains no archive parts.`
      );
    }

    const sevenZipExe = this.resolve7zaPath();
    if (!sevenZipExe) {
      throw new Error(
        "未找到 7za.exe / 7z.exe，无法重组 Gitee 分卷安装包。请安装 7-Zip 或设置环境变量 PRISMUX_7ZA_PATH。"
      );
    }

    const expectedExeName = sanitizeAssetFileName(
      params.asset.expectedExeName ?? params.asset.name
    );
    const workHash = createHash("sha256")
      .update(`${params.version}:${expectedExeName}:${params.expectedSha256}`)
      .digest("hex")
      .slice(0, 12);
    const workDir = join(params.destDir, `.split-work-${workHash}`);
    const extractDir = join(workDir, "extracted");
    mkdirSync(workDir, { recursive: true });

    const knownPartSizes: Array<number | null> = parts.map((p) =>
      typeof p.size === "number" && Number.isFinite(p.size) && p.size > 0
        ? p.size
        : null
    );

    const computeTotalArchiveBytes = (): number | null => {
      if (
        knownPartSizes.every((size): size is number => size !== null && size > 0)
      ) {
        return knownPartSizes.reduce((sum, size) => sum + size, 0);
      }
      if (
        typeof params.asset.totalBytes === "number" &&
        Number.isFinite(params.asset.totalBytes) &&
        params.asset.totalBytes > 0
      ) {
        return params.asset.totalBytes;
      }
      return null;
    };

    // Fast parallel HEAD probe for any parts missing size metadata (common on Gitee API/HTML).
    if (computeTotalArchiveBytes() === null) {
      const missingIndices: number[] = [];
      for (let i = 0; i < parts.length; i += 1) {
        if (knownPartSizes[i] === null) {
          missingIndices.push(i);
        }
      }
      if (missingIndices.length > 0) {
        await Promise.all(
          missingIndices.map(async (idx) => {
            const part = parts[idx]!;
            const probeUrl =
              part.effectiveUrl ??
              this.resolveSourceUrl(part.url, params.asset.source);
            const probedSize = await this.probeRemoteAssetSize(probeUrl);
            if (probedSize !== null) {
              knownPartSizes[idx] = probedSize;
            }
          })
        );
      }
    }

    let totalArchiveBytes = computeTotalArchiveBytes();
    let completedPartsBytes = 0;
    let totalResumedBytes = 0;
    let lastDownloadPercent = 0;
    const downloadedPartPaths: string[] = [];

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]!;
      const safePartName = sanitizeAssetFileName(part.name);
      const finalPartPath = join(workDir, safePartName);
      const tempPartPath = `${finalPartPath}.part`;
      const effectivePartUrl =
        part.effectiveUrl ??
        this.resolveSourceUrl(part.url, params.asset.source);
      const expectedPartSize = knownPartSizes[i] ?? null;

      // Reuse already-completed split volume if exact size matches (supports cross-attempt resume).
      if (
        existsSync(finalPartPath) &&
        expectedPartSize !== null &&
        statSync(finalPartPath).size === expectedPartSize
      ) {
        completedPartsBytes += expectedPartSize;
        totalResumedBytes += expectedPartSize;
        downloadedPartPaths.push(finalPartPath);
        const reusedPercent = Math.max(
          lastDownloadPercent,
          roundPercent1(
            ((i + 1) / parts.length) * DOWNLOAD_PROGRESS_MAX_PERCENT,
            0,
            DOWNLOAD_PROGRESS_MAX_PERCENT
          )
        );
        lastDownloadPercent = reusedPercent;
        params.onProgress({
          stage: "downloading",
          phase: "downloading",
          bytesDownloaded: completedPartsBytes,
          totalBytes: totalArchiveBytes,
          percent: reusedPercent,
          source: params.asset.source,
          currentPart: i + 1,
          totalParts: parts.length,
          partName: safePartName,
          message: `已复用分卷 ${i + 1}/${parts.length} (${safePartName})`,
          updatedAt: Date.now()
        });
        continue;
      }

      const partBaseOffset = completedPartsBytes;
      const transfer = await this.streamDownloadFileWithResume({
        url: effectivePartUrl,
        partPath: tempPartPath,
        expectedSizeHint: expectedPartSize,
        maxRetries: params.maxRetries,
        retryDelaysMs: params.retryDelaysMs,
        onChunkProgress: (partBytes, partTotal) => {
          if (partTotal !== null && Number.isFinite(partTotal) && partTotal > 0) {
            knownPartSizes[i] = partTotal;
            totalArchiveBytes = computeTotalArchiveBytes();
          }
          const effectivePartTotal =
            partTotal !== null && Number.isFinite(partTotal) && partTotal > 0
              ? partTotal
              : knownPartSizes[i] ?? null;
          const aggregateBytes = partBaseOffset + partBytes;
          const weightedPercent = computeSplitPartWeightedPercent(
            i,
            parts.length,
            partBytes,
            effectivePartTotal
          );
          const percent = Math.max(lastDownloadPercent, weightedPercent);
          lastDownloadPercent = percent;
          params.onProgress({
            stage: "downloading",
            phase: "downloading",
            bytesDownloaded: aggregateBytes,
            totalBytes: totalArchiveBytes,
            percent,
            source: params.asset.source,
            currentPart: i + 1,
            totalParts: parts.length,
            partName: safePartName,
            message: `正在下载分卷 ${i + 1}/${parts.length} (${safePartName})...`,
            updatedAt: Date.now()
          });
        }
      });

      rmSync(finalPartPath, { force: true });
      renameSync(tempPartPath, finalPartPath);
      knownPartSizes[i] = transfer.bytes;
      totalArchiveBytes = computeTotalArchiveBytes();
      completedPartsBytes += transfer.bytes;
      totalResumedBytes += transfer.resumedFromBytes;
      downloadedPartPaths.push(finalPartPath);

      const partEndPercent = roundPercent1(
        ((i + 1) / parts.length) * DOWNLOAD_PROGRESS_MAX_PERCENT,
        0,
        DOWNLOAD_PROGRESS_MAX_PERCENT
      );
      if (lastDownloadPercent < partEndPercent) {
        lastDownloadPercent = partEndPercent;
        params.onProgress({
          stage: "downloading",
          phase: "downloading",
          bytesDownloaded: completedPartsBytes,
          totalBytes: totalArchiveBytes,
          percent: partEndPercent,
          source: params.asset.source,
          currentPart: i + 1,
          totalParts: parts.length,
          partName: safePartName,
          message: `已完成分卷 ${i + 1}/${parts.length} (${safePartName})`,
          updatedAt: Date.now()
        });
      }
    }

    const firstVolumePath = downloadedPartPaths[0]!;
    const resolvedTotalBytes = totalArchiveBytes ?? completedPartsBytes;
    const reportExtractProgress = (percent: number, message: string) => {
      params.onProgress({
        stage: "extracting",
        phase: "extracting",
        bytesDownloaded: completedPartsBytes,
        totalBytes: resolvedTotalBytes,
        percent,
        source: params.asset.source,
        currentPart: parts.length,
        totalParts: parts.length,
        partName: expectedExeName,
        message,
        updatedAt: Date.now()
      });
    };

    reportExtractProgress(
      DOWNLOAD_PROGRESS_MAX_PERCENT,
      `正在使用 7-Zip 无损合并解压 ${expectedExeName}...`
    );

    rmSync(extractDir, { recursive: true, force: true });
    mkdirSync(extractDir, { recursive: true });

    let extractPercent = DOWNLOAD_PROGRESS_MAX_PERCENT;
    const extractHeartbeat = this.timers.setInterval(() => {
      if (extractPercent < SPLIT_EXTRACT_END_PERCENT - 1) {
        extractPercent =
          extractPercent < DOWNLOAD_PROGRESS_MAX_PERCENT + 2
            ? DOWNLOAD_PROGRESS_MAX_PERCENT + 2
            : Math.min(SPLIT_EXTRACT_END_PERCENT - 1, extractPercent + 1);
        reportExtractProgress(
          extractPercent,
          `正在使用 7-Zip 无损合并解压 ${expectedExeName}...`
        );
      }
    }, 350);
    unrefTimerHandle(extractHeartbeat);

    try {
      await execFileAsync(
        sevenZipExe,
        ["x", "-y", `-o${extractDir}`, firstVolumePath],
        {
          timeout: DEFAULT_EXTRACT_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024
        }
      );
    } catch (error) {
      rmSync(workDir, { recursive: true, force: true });
      const detail =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `分卷 7z 解压失败（已自动清理残片）：${detail}`
      );
    } finally {
      this.timers.clearInterval(extractHeartbeat);
    }

    const extractedExePath = findExtractedExeFile(extractDir, expectedExeName);
    if (extractedExePath === null) {
      rmSync(workDir, { recursive: true, force: true });
      throw new Error(
        `分卷解压后未找到目标安装包 "${expectedExeName}"（已清理临时残片）。`
      );
    }

    reportExtractProgress(
      SPLIT_EXTRACT_END_PERCENT,
      `分卷合并完成，准备执行 SHA-256 校验 (${expectedExeName})...`
    );

    let lastVerifyPercent = SPLIT_EXTRACT_END_PERCENT;
    const computed = await computeFileSha256(
      extractedExePath,
      (hashedBytes, totalHashBytes) => {
        const frac =
          totalHashBytes > 0
            ? Math.max(0, Math.min(1, hashedBytes / totalHashBytes))
            : 1;
        const candidate = roundPercent1(
          SPLIT_EXTRACT_END_PERCENT +
            frac * (VERIFY_MAX_PERCENT - SPLIT_EXTRACT_END_PERCENT),
          SPLIT_EXTRACT_END_PERCENT,
          VERIFY_MAX_PERCENT
        );
        const percent = Math.max(lastVerifyPercent, candidate);
        lastVerifyPercent = percent;
        params.onProgress({
          stage: "verifying",
          phase: "verifying",
          bytesDownloaded: completedPartsBytes,
          totalBytes: resolvedTotalBytes,
          percent,
          source: params.asset.source,
          currentPart: parts.length,
          totalParts: parts.length,
          partName: expectedExeName,
          message: `正在校验整包 SHA-256 (${expectedExeName})...`,
          updatedAt: Date.now()
        });
      }
    );
    if (computed.sha256 !== params.expectedSha256) {
      // Immediately wipe all fragments and extracted tampered artifacts!
      rmSync(workDir, { recursive: true, force: true });
      rmSync(params.targetPath, { force: true });
      throw new UpdateIntegrityError(
        expectedExeName,
        params.expectedSha256,
        computed.sha256
      );
    }

    rmSync(params.targetPath, { force: true });
    renameSync(extractedExePath, params.targetPath);
    rmSync(workDir, { recursive: true, force: true });

    return {
      downloadedAt: Date.now(),
      version: params.version,
      assetName: expectedExeName,
      filePath: params.targetPath,
      bytesDownloaded: completedPartsBytes,
      totalBytes: resolvedTotalBytes,
      resumedFromBytes: totalResumedBytes,
      sha256: computed.sha256,
      verified: true,
      sourceUsed: params.asset.source,
      usedFallbackSource: params.usedFallbackSource,
      downloadUrl: params.asset.effectiveUrl,
      packageKind: "split-7z-exe"
    };
  }
}
