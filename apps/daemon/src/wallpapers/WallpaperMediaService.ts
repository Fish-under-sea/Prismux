import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import type * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import {
  inspectSteamScenePackage,
  renderSteamScenePlayerHtml,
  type SteamScenePackageManifest
} from "./SteamScenePackage.js";

const { execFile } = NodeChildProcess;
const { createHash, randomUUID } = NodeCrypto;
const {
  closeSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} = NodeFS;
type IncomingMessage = NodeHttp.IncomingMessage;
type ServerResponse = NodeHttp.ServerResponse;
const {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve
} = NodePath;
const { promisify } = NodeUtil;
// oxlint-disable-next-line prismux/no-global-process-runtime -- @prismux/daemon is a standalone Node service outside the Effect HostProcess runtime
const HOST_PLATFORM = NodeOS.platform();

const execFileAsync = promisify(execFile);

export const WALLPAPER_ENGINE_APP_ID = "431960" as const;
export const MAX_IMPORT_DECODED_BYTES = 24 * 1024 * 1024;
export const MAX_IMPORT_SOURCE_FILE_BYTES = 512 * 1024 * 1024;
export const DEFAULT_CHUNK_BYTES = 1024 * 1024;

export type WallpaperMediaType = "scene" | "web" | "video" | "image";
export type WallpaperSource = "steam" | "custom" | "builtin";
export type WallpaperOrientation = "landscape" | "portrait" | "square" | "unknown";
export type WallpaperContentRating = "everyone" | "pg13" | "mature" | "unrated";
export type BuiltinScenePresetId =
  | "aurora-prism"
  | "midnight-abyss"
  | "liquid-silk"
  | "cyber-twilight";

export interface WallpaperUserPropertyOption {
  label: string;
  value: string | number | boolean;
  condition?: string;
}

export interface WallpaperUserProperty {
  name: string;
  ptype: string;
  text: string;
  order: number;
  value: string | number | boolean | null;
  defaultValue: string | number | boolean | null;
  overridden: boolean;
  condition?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: WallpaperUserPropertyOption[];
  fileType?: string;
}

export interface WallpaperInventoryItem {
  id: string;
  title: string;
  type: WallpaperMediaType;
  source: WallpaperSource;
  previewUrl: string | null;
  mediaUrl: string | null;
  webEntryUrl?: string | null;
  filePath: string | null;
  dirPath: string | null;
  width: number | null;
  height: number | null;
  orientation: WallpaperOrientation;
  contentRating: WallpaperContentRating;
  userProperties?: WallpaperUserProperty[];
  tags?: string[];
  schemeColor?: string | null;
  builtinSceneId?: BuiltinScenePresetId;
  slides?: string[];
  sceneLiveSupported: boolean;
  webLiveSupported: boolean;
  fileSize?: number;
  mtimeMs?: number;
}

export interface WallpaperInventorySnapshot {
  schemaVersion: 1;
  scannedAt: number;
  customWallpaperDir: string;
  customDirs: string[];
  steamRootOverride: string;
  steamRoots: string[];
  workshopDirs: string[];
  items: WallpaperInventoryItem[];
  totalCount: number;
}

export interface WallpaperRescanRequest {
  customDirs?: string[];
  steamRootOverride?: string;
  advancedEngineEnabled?: boolean;
}

export interface WallpaperImportRequest {
  sourcePath?: string;
  fileName?: string;
  base64?: string;
  title?: string;
}

export interface WallpaperServiceOptions {
  dataDir: string;
  customDirs?: string[];
  steamRootOverride?: string;
  advancedEngineEnabled?: boolean;
  steamRootsDiscoverer?: () => Promise<string[]>;
}

interface IndexedWallpaperEntry {
  item: WallpaperInventoryItem;
  allowedRoot: string;
  mediaFile: string | null;
  previewFile: string | null;
  webRootDir: string | null;
  webEntryRelPath: string | null;
  scenePkgPath: string | null;
  sceneManifest: SteamScenePackageManifest | null;
}

interface ByteRangeSuccess {
  ok: true;
  start: number;
  end: number;
  totalSize: number;
  isPartial: boolean;
}

interface ByteRangeUnsatisfiable {
  ok: false;
  totalSize: number;
}

type ByteRangeOutcome = ByteRangeSuccess | ByteRangeUnsatisfiable;

const ALLOWED_IMAGE_EXTENSIONS = new Set<string>([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".avif"
]);

const ALLOWED_VIDEO_EXTENSIONS = new Set<string>([
  ".mp4",
  ".webm",
  ".mov",
  ".m4v"
]);

const ALL_RECOGNIZED_VIDEO_EXTENSIONS = new Set<string>([
  ...ALLOWED_VIDEO_EXTENSIONS,
  ".mkv",
  ".avi"
]);

const ALLOWED_IMPORT_EXTENSIONS = new Set<string>([
  ...ALLOWED_IMAGE_EXTENSIONS,
  ...ALLOWED_VIDEO_EXTENSIONS
]);

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".glsl": "text/plain; charset=utf-8",
  ".frag": "text/plain; charset=utf-8",
  ".vert": "text/plain; charset=utf-8",
  ".skel": "application/octet-stream",
  ".atlas": "text/plain; charset=utf-8",
  ".moc3": "application/octet-stream",
  ".bin": "application/octet-stream"
};

export const BUILTIN_WEBWALLGL_WALLPAPERS: readonly WallpaperInventoryItem[] = [];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class WallpaperServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "WallpaperServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function getMimeTypeForFile(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

export function hasRawTraversal(rawPath: string): boolean {
  if (rawPath.includes("\0")) {
    return true;
  }
  const normalizedSlashes = rawPath.replace(/\\/g, "/");
  if (
    normalizedSlashes === ".." ||
    normalizedSlashes.startsWith("../") ||
    normalizedSlashes.endsWith("/..") ||
    normalizedSlashes.includes("/../")
  ) {
    return true;
  }
  const lower = rawPath.toLowerCase();
  if (
    lower.includes("%2e%2e") ||
    lower.includes("%2f..") ||
    lower.includes("..%2f") ||
    lower.includes("%5c")
  ) {
    return true;
  }
  return false;
}

export function isPathStrictlyInsideDir(
  candidatePath: string,
  rootDir: string
): boolean {
  const resolvedRoot = resolve(rootDir);
  const resolvedCandidate = resolve(candidatePath);
  if (
    resolvedCandidate.toLowerCase() === resolvedRoot.toLowerCase() &&
    HOST_PLATFORM === "win32"
  ) {
    return true;
  }
  if (resolvedCandidate === resolvedRoot) {
    return true;
  }

  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    return false;
  }

  try {
    const realRoot = realpathSync(resolvedRoot);
    const realCandidate = realpathSync(resolvedCandidate);
    if (realCandidate === realRoot) {
      return true;
    }
    if (
      HOST_PLATFORM === "win32" &&
      realCandidate.toLowerCase() === realRoot.toLowerCase()
    ) {
      return true;
    }
    const realRel = relative(realRoot, realCandidate);
    return realRel === "" || (!realRel.startsWith("..") && !isAbsolute(realRel));
  } catch {
    return false;
  }
}

/**
 * Resolves a raw local filesystem relative path (e.g. from Steam `project.json`)
 * strictly inside `rootDir` WITHOUT calling `decodeURIComponent()` so filenames
 * containing literal `%` characters are preserved intact.
 */
async function pathExistsAsync(candidatePath: string): Promise<boolean> {
  try {
    await NodeFSP.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function isPathStrictlyInsideDirAsync(
  candidatePath: string,
  rootDir: string,
  cachedRealRoot?: string
): Promise<boolean> {
  const resolvedRoot = resolve(rootDir);
  const resolvedCandidate = resolve(candidatePath);
  if (
    resolvedCandidate.toLowerCase() === resolvedRoot.toLowerCase() &&
    HOST_PLATFORM === "win32"
  ) {
    return true;
  }
  if (resolvedCandidate === resolvedRoot) {
    return true;
  }

  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    return false;
  }

  try {
    const realRoot = cachedRealRoot ?? (await NodeFSP.realpath(resolvedRoot));
    const realCandidate = await NodeFSP.realpath(resolvedCandidate);
    if (realCandidate === realRoot) {
      return true;
    }
    if (
      HOST_PLATFORM === "win32" &&
      realCandidate.toLowerCase() === realRoot.toLowerCase()
    ) {
      return true;
    }
    const realRel = relative(realRoot, realCandidate);
    return realRel === "" || (!realRel.startsWith("..") && !isAbsolute(realRel));
  } catch {
    return false;
  }
}

async function safeResolveLocalPathAsync(
  rootDir: string,
  rawRelativePath: string,
  cachedRealRoot?: string
): Promise<string | null> {
  if (rawRelativePath.includes("\0")) {
    return null;
  }
  const normalizedSlashes = rawRelativePath.replace(/\\/g, "/");
  const segments = normalizedSlashes.split("/");
  if (segments.some((seg) => seg === "..")) {
    return null;
  }
  const cleanRel = normalizedSlashes.replace(/^\/+/, "");
  if (cleanRel.length === 0) {
    return null;
  }
  const candidate = resolve(rootDir, cleanRel);
  if (!(await isPathStrictlyInsideDirAsync(candidate, rootDir, cachedRealRoot))) {
    return null;
  }
  return candidate;
}

export function safeResolveLocalPath(
  rootDir: string,
  rawRelativePath: string
): string | null {
  if (rawRelativePath.includes("\0")) {
    return null;
  }
  const normalizedSlashes = rawRelativePath.replace(/\\/g, "/");
  const segments = normalizedSlashes.split("/");
  if (segments.some((seg) => seg === "..")) {
    return null;
  }
  const cleanRel = normalizedSlashes.replace(/^\/+/, "");
  if (cleanRel.length === 0) {
    return null;
  }
  const candidate = resolve(rootDir, cleanRel);
  if (!isPathStrictlyInsideDir(candidate, rootDir)) {
    return null;
  }
  return candidate;
}

export function safeResolveInsideDir(
  rootDir: string,
  rawRelativePath: string
): string | null {
  if (hasRawTraversal(rawRelativePath)) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawRelativePath);
  } catch {
    return null;
  }
  if (hasRawTraversal(decoded)) {
    return null;
  }
  const cleanRel = decoded.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleanRel.length === 0) {
    return null;
  }
  const candidate = resolve(rootDir, cleanRel);
  if (!isPathStrictlyInsideDir(candidate, rootDir)) {
    return null;
  }
  return candidate;
}

type WebAssetResolveOutcome =
  | { ok: true; path: string }
  | { ok: false; kind: "traversal" | "not_found" };

function resolveWebAssetPath(
  rootDir: string,
  rawRelativePath: string
): WebAssetResolveOutcome {
  if (hasRawTraversal(rawRelativePath)) {
    return { ok: false, kind: "traversal" };
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawRelativePath);
  } catch {
    return { ok: false, kind: "traversal" };
  }
  if (hasRawTraversal(decoded)) {
    return { ok: false, kind: "traversal" };
  }
  const cleanRel = decoded.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleanRel.length === 0) {
    return { ok: false, kind: "traversal" };
  }

  const resolvedRoot = resolve(rootDir);
  const candidate = resolve(resolvedRoot, cleanRel);
  const lexicalRel = relative(resolvedRoot, candidate);
  if (lexicalRel.startsWith("..") || isAbsolute(lexicalRel)) {
    return { ok: false, kind: "traversal" };
  }

  if (existsSync(candidate)) {
    if (!isPathStrictlyInsideDir(candidate, resolvedRoot)) {
      return { ok: false, kind: "traversal" };
    }
    return { ok: true, path: candidate };
  }

  // Verify the deepest existing parent directory does not escape via symlink before returning 404.
  let ancestor = dirname(candidate);
  while (ancestor !== resolvedRoot) {
    const parentRel = relative(resolvedRoot, ancestor);
    if (parentRel.startsWith("..") || isAbsolute(parentRel)) {
      return { ok: false, kind: "traversal" };
    }
    if (existsSync(ancestor)) {
      if (!isPathStrictlyInsideDir(ancestor, resolvedRoot)) {
        return { ok: false, kind: "traversal" };
      }
      break;
    }
    const nextParent = dirname(ancestor);
    if (nextParent === ancestor) {
      break;
    }
    ancestor = nextParent;
  }
  return { ok: false, kind: "not_found" };
}

export function parseLibraryFoldersVdf(vdfText: string): string[] {
  const libraries: string[] = [];
  const seen = new Set<string>();
  const pathPattern = /"path"\s+"([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(vdfText)) !== null) {
    const rawPath = match[1]?.replace(/\\\\/g, "\\").trim();
    if (!rawPath) {
      continue;
    }
    const normalized = resolve(rawPath);
    const key =
      HOST_PLATFORM === "win32" ? normalized.toLowerCase() : normalized;
    if (!seen.has(key)) {
      seen.add(key);
      libraries.push(normalized);
    }
  }
  return libraries;
}

export function parseByteRangeHeader(
  rangeHeader: string | undefined,
  totalSize: number
): ByteRangeOutcome {
  if (rangeHeader === undefined || rangeHeader.trim().length === 0) {
    return {
      ok: true,
      start: 0,
      end: Math.max(0, totalSize - 1),
      totalSize,
      isPartial: false
    };
  }

  if (totalSize <= 0) {
    return { ok: false, totalSize };
  }

  const trimmed = rangeHeader.trim();
  const match = /^bytes=(\d*)-(\d*)$/i.exec(trimmed);
  if (!match) {
    return { ok: false, totalSize };
  }

  const startStr = match[1] ?? "";
  const endStr = match[2] ?? "";
  if (startStr.length === 0 && endStr.length === 0) {
    return { ok: false, totalSize };
  }

  let start: number;
  let end: number;

  if (startStr.length === 0) {
    const suffixLength = Number.parseInt(endStr, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { ok: false, totalSize };
    }
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else {
    start = Number.parseInt(startStr, 10);
    if (!Number.isFinite(start) || start < 0 || start >= totalSize) {
      return { ok: false, totalSize };
    }
    if (endStr.length === 0) {
      end = totalSize - 1;
    } else {
      end = Number.parseInt(endStr, 10);
      if (!Number.isFinite(end) || end < start) {
        return { ok: false, totalSize };
      }
      end = Math.min(end, totalSize - 1);
    }
  }

  return {
    ok: true,
    start,
    end,
    totalSize,
    isPartial: true
  };
}

function parseImageDimensionsFromSlice(
  slice: Buffer
): { width: number; height: number } | null {
  // PNG: 8-byte signature + IHDR width/height at offsets 16 and 20
  if (
    slice.length >= 24 &&
    slice[0] === 0x89 &&
    slice[1] === 0x50 &&
    slice[2] === 0x4e &&
    slice[3] === 0x47
  ) {
    return {
      width: slice.readUInt32BE(16),
      height: slice.readUInt32BE(20)
    };
  }

  // GIF: GIF87a / GIF89a
  if (
    slice.length >= 10 &&
    slice.subarray(0, 3).toString("ascii") === "GIF"
  ) {
    return {
      width: slice.readUInt16LE(6),
      height: slice.readUInt16LE(8)
    };
  }

  // BMP: BM
  if (slice.length >= 26 && slice[0] === 0x42 && slice[1] === 0x4d) {
    return {
      width: Math.abs(slice.readInt32LE(18)),
      height: Math.abs(slice.readInt32LE(22))
    };
  }

  // WEBP: RIFF....WEBP (VP8 / VP8L / VP8X)
  if (
    slice.length >= 30 &&
    slice.subarray(0, 4).toString("ascii") === "RIFF" &&
    slice.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    const chunkHeader = slice.subarray(12, 16).toString("ascii");
    if (chunkHeader === "VP8X" && slice.length >= 30) {
      const w = 1 + (slice[24]! | (slice[25]! << 8) | (slice[26]! << 16));
      const h = 1 + (slice[27]! | (slice[28]! << 8) | (slice[29]! << 16));
      return { width: w, height: h };
    }
    if (chunkHeader === "VP8L" && slice.length >= 25) {
      const bits = slice.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1
      };
    }
    if (chunkHeader === "VP8 " && slice.length >= 30) {
      return {
        width: slice.readUInt16LE(26) & 0x3fff,
        height: slice.readUInt16LE(28) & 0x3fff
      };
    }
  }

  // JPEG: SOI (FF D8) + SOF0..SOF3/SOF5..SOF7/SOF9..SOF11/SOF13..SOF15
  if (slice.length >= 4 && slice[0] === 0xff && slice[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < slice.length) {
      if (slice[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < slice.length && slice[offset] === 0xff) {
        offset += 1;
      }
      if (offset >= slice.length) {
        break;
      }
      const marker = slice[offset]!;
      offset += 1;
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
        continue;
      }
      if (marker >= 0xd0 && marker <= 0xd7) {
        continue;
      }
      if (offset + 2 > slice.length) {
        break;
      }
      const segmentLen = slice.readUInt16BE(offset);
      if (segmentLen < 2) {
        break;
      }
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && offset + 7 <= slice.length) {
        return {
          height: slice.readUInt16BE(offset + 3),
          width: slice.readUInt16BE(offset + 5)
        };
      }
      offset += segmentLen;
    }
  }
  return null;
}

export async function readImageDimensionsAsync(
  filePath: string
): Promise<{ width: number; height: number } | null> {
  let fh: NodeFSP.FileHandle | undefined;
  try {
    fh = await NodeFSP.open(filePath, "r");
    const stats = await fh.stat();
    if (!stats.isFile() || stats.size < 16) {
      return null;
    }
    const readBytes = Math.min(stats.size, 65_536);
    const buffer = Buffer.allocUnsafe(readBytes);
    const { bytesRead } = await fh.read(buffer, 0, readBytes, 0);
    return parseImageDimensionsFromSlice(buffer.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    if (fh !== undefined) {
      try {
        await fh.close();
      } catch {
        // ignore close failure
      }
    }
  }
}

export function readImageDimensions(
  filePath: string
): { width: number; height: number } | null {
  let fd: number | undefined;
  try {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size < 16) {
      return null;
    }
    const readBytes = Math.min(stats.size, 65_536);
    const buffer = Buffer.allocUnsafe(readBytes);
    fd = openSync(filePath, "r");
    const bytesRead = readSync(fd, buffer, 0, readBytes, 0);
    return parseImageDimensionsFromSlice(buffer.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore close failure
      }
    }
  }
}

const VIDEO_HEAD_PROBE_BYTES = 128 * 1024;
const VIDEO_TAIL_PROBE_BYTES = 256 * 1024;
const MAX_MOOV_READ_BYTES = 2 * 1024 * 1024;

function parseMp4TkhdAt(
  buf: Buffer,
  payloadStart: number,
  payloadEnd: number
): { width: number; height: number } | null {
  if (payloadStart + 84 > payloadEnd) {
    return null;
  }
  const version = buf[payloadStart]!;
  if (version !== 0 && version !== 1) {
    return null;
  }
  const matrixOff = payloadStart + (version === 1 ? 52 : 40);
  const dimOff = payloadStart + (version === 1 ? 88 : 76);
  if (dimOff + 8 > payloadEnd) {
    return null;
  }
  const rawWidth = Math.round(buf.readUInt32BE(dimOff) / 65536);
  const rawHeight = Math.round(buf.readUInt32BE(dimOff + 4) / 65536);
  if (
    rawWidth < 16 ||
    rawHeight < 16 ||
    rawWidth > 16_384 ||
    rawHeight > 16_384
  ) {
    return null;
  }
  // Check 2x2 transform matrix [a, b; c, d] for 90°/270° rotation
  const a = buf.readInt32BE(matrixOff);
  const b = buf.readInt32BE(matrixOff + 4);
  const c = buf.readInt32BE(matrixOff + 12);
  const d = buf.readInt32BE(matrixOff + 16);
  const rotated90 = a === 0 && d === 0 && b !== 0 && c !== 0;
  return rotated90
    ? { width: rawHeight, height: rawWidth }
    : { width: rawWidth, height: rawHeight };
}

function parseMp4BoxesForDimensions(
  buf: Buffer,
  start: number,
  end: number,
  depth = 0
): { width: number; height: number } | null {
  if (depth > 6) {
    return null;
  }
  let best: { width: number; height: number } | null = null;
  let offset = start;
  while (offset + 8 <= end) {
    let boxSize = buf.readUInt32BE(offset);
    const boxType = buf.subarray(offset + 4, offset + 8).toString("ascii");
    let headerSize = 8;
    if (boxSize === 1) {
      if (offset + 16 > end) break;
      const hi = buf.readUInt32BE(offset + 8);
      const lo = buf.readUInt32BE(offset + 12);
      boxSize = hi * 0x100000000 + lo;
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = end - offset;
    }
    if (!Number.isFinite(boxSize) || boxSize < headerSize) {
      break;
    }
    const boxEnd = Math.min(end, offset + boxSize);
    const payloadStart = offset + headerSize;
    if (boxType === "tkhd") {
      const dims = parseMp4TkhdAt(buf, payloadStart, boxEnd);
      if (dims && (!best || dims.width * dims.height > best.width * best.height)) {
        best = dims;
      }
    } else if (boxType === "moov" || boxType === "trak") {
      const nested = parseMp4BoxesForDimensions(buf, payloadStart, boxEnd, depth + 1);
      if (nested && (!best || nested.width * nested.height > best.width * best.height)) {
        best = nested;
      }
    }
    if (offset + boxSize <= offset) break;
    offset += boxSize;
  }
  return best;
}

function scanBufferForTkhd(buf: Buffer): { width: number; height: number } | null {
  let best: { width: number; height: number } | null = null;
  let searchFrom = 4;
  while (searchFrom < buf.length - 84) {
    const idx = buf.indexOf("tkhd", searchFrom, "ascii");
    if (idx < 4) break;
    const boxSize = buf.readUInt32BE(idx - 4);
    if (boxSize >= 84 && boxSize <= 512) {
      const boxEnd = Math.min(buf.length, idx - 4 + boxSize);
      const dims = parseMp4TkhdAt(buf, idx + 4, boxEnd);
      if (dims && (!best || dims.width * dims.height > best.width * best.height)) {
        best = dims;
      }
    }
    searchFrom = idx + 4;
  }
  return best;
}

function readEbmlVint(
  buf: Buffer,
  offset: number,
  maskLengthBit: boolean
): { value: number; length: number } | null {
  if (offset >= buf.length) return null;
  const first = buf[offset]!;
  if (first === 0) return null;
  let mask = 0x80;
  let length = 1;
  while (length <= 8 && (first & mask) === 0) {
    mask >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > buf.length) return null;
  let value = maskLengthBit ? first & ~mask : first;
  for (let i = 1; i < length; i += 1) {
    value = value * 256 + buf[offset + i]!;
  }
  return { value, length };
}

function parseEbmlVideoDimensions(buf: Buffer): { width: number; height: number } | null {
  if (
    buf.length < 32 ||
    buf[0] !== 0x1a ||
    buf[1] !== 0x45 ||
    buf[2] !== 0xdf ||
    buf[3] !== 0xa3
  ) {
    return null;
  }

  const CONTAINER_IDS = new Set([
    0x18538067, // Segment
    0x1654ae6b, // Tracks
    0xae,       // TrackEntry
    0xe0        // Video
  ]);

  let width: number | null = null;
  let height: number | null = null;

  const walk = (start: number, end: number, inVideo: boolean, depth: number): boolean => {
    if (depth > 6) return false;
    let offset = start;
    while (offset < end) {
      const id = readEbmlVint(buf, offset, false);
      if (!id) break;
      offset += id.length;
      const size = readEbmlVint(buf, offset, true);
      if (!size) break;
      offset += size.length;
      // Unknown-size EBML element (all data bits 1) extends to parent end
      const isUnknownSize =
        size.length <= 4 && size.value === (1 << (7 * size.length)) - 1;
      const dataEnd = isUnknownSize ? end : Math.min(end, offset + size.value);
      if (dataEnd < offset) break;

      if (CONTAINER_IDS.has(id.value)) {
        const nextInVideo = inVideo || id.value === 0xe0;
        if (walk(offset, dataEnd, nextInVideo, depth + 1)) {
          return true;
        }
      } else if (inVideo && (id.value === 0xb0 || id.value === 0xba)) {
        const byteLen = dataEnd - offset;
        if (byteLen >= 1 && byteLen <= 4) {
          let val = 0;
          for (let i = 0; i < byteLen; i += 1) {
            val = val * 256 + buf[offset + i]!;
          }
          if (val >= 16 && val <= 16_384) {
            if (id.value === 0xb0) width = val;
            if (id.value === 0xba) height = val;
            if (width !== null && height !== null) {
              return true;
            }
          }
        }
      }

      if (dataEnd <= offset) break;
      offset = dataEnd;
    }
    return false;
  };

  walk(0, buf.length, false, 0);
  if (width !== null && height !== null) {
    return { width, height };
  }
  return null;
}

/**
 * Pure-Node binary video dimension parser supporting MP4/MOV/M4V (`moov`/`tkhd` in head,
 * top-level box seek over large `mdat`, or EOF tail) and WebM/MKV (EBML `PixelWidth`/`PixelHeight`).
 */
export async function readVideoDimensionsAsync(
  filePath: string
): Promise<{ width: number; height: number } | null> {
  let fh: NodeFSP.FileHandle | undefined;
  try {
    fh = await NodeFSP.open(filePath, "r");
    const stats = await fh.stat();
    if (!stats.isFile() || stats.size < 16) {
      return null;
    }
    const fileSize = stats.size;

    const headLen = Math.min(fileSize, VIDEO_HEAD_PROBE_BYTES);
    const headBuf = Buffer.allocUnsafe(headLen);
    const { bytesRead: headRead } = await fh.read(headBuf, 0, headLen, 0);
    const head = headBuf.subarray(0, headRead);

    if (
      head.length >= 4 &&
      head[0] === 0x1a &&
      head[1] === 0x45 &&
      head[2] === 0xdf &&
      head[3] === 0xa3
    ) {
      return parseEbmlVideoDimensions(head);
    }

    const fromHead = parseMp4BoxesForDimensions(head, 0, head.length) ?? scanBufferForTkhd(head);
    if (fromHead) {
      return fromHead;
    }

    if (fileSize > headLen) {
      const hdr = Buffer.allocUnsafe(16);
      let pos = 0;
      for (let i = 0; i < 64 && pos + 8 <= fileSize; i += 1) {
        const { bytesRead: got } = await fh.read(hdr, 0, Math.min(16, fileSize - pos), pos);
        if (got < 8) break;
        let boxSize = hdr.readUInt32BE(0);
        const boxType = hdr.subarray(4, 8).toString("ascii");
        let headerSize = 8;
        if (boxSize === 1) {
          if (got < 16) break;
          boxSize = hdr.readUInt32BE(8) * 0x100000000 + hdr.readUInt32BE(12);
          headerSize = 16;
        } else if (boxSize === 0) {
          boxSize = fileSize - pos;
        }
        if (!Number.isFinite(boxSize) || boxSize < headerSize) break;
        if (boxType === "moov") {
          const readLen = Math.min(boxSize, MAX_MOOV_READ_BYTES, fileSize - pos);
          const moovBuf = Buffer.allocUnsafe(readLen);
          const { bytesRead: moovGot } = await fh.read(moovBuf, 0, readLen, pos);
          const moovSlice = moovBuf.subarray(0, moovGot);
          const fromMoov =
            parseMp4BoxesForDimensions(moovSlice, 0, moovSlice.length) ??
            scanBufferForTkhd(moovSlice);
          if (fromMoov) {
            return fromMoov;
          }
          break;
        }
        if (pos + boxSize <= pos) break;
        pos += boxSize;
      }

      const tailLen = Math.min(fileSize, VIDEO_TAIL_PROBE_BYTES);
      const tailOffset = Math.max(0, fileSize - tailLen);
      const tailBuf = Buffer.allocUnsafe(tailLen);
      const { bytesRead: tailGot } = await fh.read(tailBuf, 0, tailLen, tailOffset);
      const tail = tailBuf.subarray(0, tailGot);
      const fromTail = scanBufferForTkhd(tail);
      if (fromTail) {
        return fromTail;
      }
    }

    return null;
  } catch {
    return null;
  } finally {
    if (fh !== undefined) {
      try {
        await fh.close();
      } catch {
        // ignore close failure
      }
    }
  }
}

export function readVideoDimensions(
  filePath: string
): { width: number; height: number } | null {
  let fd: number | undefined;
  try {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size < 16) {
      return null;
    }
    const fileSize = stats.size;
    fd = openSync(filePath, "r");

    // 1. Read head 128 KB (covers fast-start MP4 and WebM/MKV headers)
    const headLen = Math.min(fileSize, VIDEO_HEAD_PROBE_BYTES);
    const headBuf = Buffer.allocUnsafe(headLen);
    const headRead = readSync(fd, headBuf, 0, headLen, 0);
    const head = headBuf.subarray(0, headRead);

    // WebM / MKV EBML check
    if (
      head.length >= 4 &&
      head[0] === 0x1a &&
      head[1] === 0x45 &&
      head[2] === 0xdf &&
      head[3] === 0xa3
    ) {
      return parseEbmlVideoDimensions(head);
    }

    // MP4 / MOV fast-start head parse
    const fromHead = parseMp4BoxesForDimensions(head, 0, head.length) ?? scanBufferForTkhd(head);
    if (fromHead) {
      return fromHead;
    }

    // 2. Walk top-level MP4 boxes to jump directly over huge `mdat` (e.g. 478 MB) straight to `moov`
    if (fileSize > headLen) {
      const hdr = Buffer.allocUnsafe(16);
      let pos = 0;
      for (let i = 0; i < 64 && pos + 8 <= fileSize; i += 1) {
        const got = readSync(fd, hdr, 0, Math.min(16, fileSize - pos), pos);
        if (got < 8) break;
        let boxSize = hdr.readUInt32BE(0);
        const boxType = hdr.subarray(4, 8).toString("ascii");
        let headerSize = 8;
        if (boxSize === 1) {
          if (got < 16) break;
          boxSize = hdr.readUInt32BE(8) * 0x100000000 + hdr.readUInt32BE(12);
          headerSize = 16;
        } else if (boxSize === 0) {
          boxSize = fileSize - pos;
        }
        if (!Number.isFinite(boxSize) || boxSize < headerSize) break;
        if (boxType === "moov") {
          const readLen = Math.min(boxSize, MAX_MOOV_READ_BYTES, fileSize - pos);
          const moovBuf = Buffer.allocUnsafe(readLen);
          const moovGot = readSync(fd, moovBuf, 0, readLen, pos);
          const moovSlice = moovBuf.subarray(0, moovGot);
          const fromMoov =
            parseMp4BoxesForDimensions(moovSlice, 0, moovSlice.length) ??
            scanBufferForTkhd(moovSlice);
          if (fromMoov) {
            return fromMoov;
          }
          break;
        }
        if (pos + boxSize <= pos) break;
        pos += boxSize;
      }

      // 3. Tail 256 KB fallback (catches non-standard EOF moov layouts)
      const tailLen = Math.min(fileSize, VIDEO_TAIL_PROBE_BYTES);
      const tailOffset = Math.max(0, fileSize - tailLen);
      const tailBuf = Buffer.allocUnsafe(tailLen);
      const tailGot = readSync(fd, tailBuf, 0, tailLen, tailOffset);
      const tail = tailBuf.subarray(0, tailGot);
      const fromTail = scanBufferForTkhd(tail);
      if (fromTail) {
        return fromTail;
      }
    }

    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore close failure
      }
    }
  }
}

export function classifyOrientation(
  width: number | null,
  height: number | null
): WallpaperOrientation {
  if (width === null || height === null || width <= 0 || height <= 0) {
    return "unknown";
  }
  if (width > height) {
    return "landscape";
  }
  if (height > width) {
    return "portrait";
  }
  return "square";
}

function normalizeContentRating(raw: unknown): WallpaperContentRating {
  if (typeof raw !== "string") {
    return "unrated";
  }
  const lower = raw.trim().toLowerCase();
  if (lower === "everyone" || lower === "0") {
    return "everyone";
  }
  if (lower === "questionable" || lower === "pg13" || lower === "1") {
    return "pg13";
  }
  if (lower === "mature" || lower === "2") {
    return "mature";
  }
  return "unrated";
}

function normalizeWallpaperType(
  rawType: unknown,
  fileName: string | null
): WallpaperMediaType {
  const lowerType =
    typeof rawType === "string" ? rawType.trim().toLowerCase() : "";
  if (lowerType === "web") {
    return "web";
  }
  if (lowerType === "video") {
    return "video";
  }
  if (lowerType === "image") {
    return "image";
  }
  if (lowerType === "scene") {
    return "scene";
  }
  if (fileName) {
    const ext = extname(fileName).toLowerCase();
    if (ALL_RECOGNIZED_VIDEO_EXTENSIONS.has(ext)) {
      return "video";
    }
    if (ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      return "image";
    }
    if (ext === ".html" || ext === ".htm") {
      return "web";
    }
  }
  return "scene";
}

function parseSteamColorValue(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 3) {
    return null;
  }
  const nums = parts.map((p) => Number.parseFloat(p));
  if (nums.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const maxVal = Math.max(...nums);
  const scale = maxVal <= 1.001 ? 255 : 1;
  const hex = nums
    .map((n) => Math.max(0, Math.min(255, Math.round(n * scale))))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

function parseSteamUserProperties(
  general: unknown
): { props: WallpaperUserProperty[]; schemeColor: string | null } {
  if (!isPlainRecord(general) || !isPlainRecord(general["properties"])) {
    return { props: [], schemeColor: null };
  }

  const rawProps = general["properties"];
  const result: WallpaperUserProperty[] = [];
  let schemeColor: string | null = null;

  for (const [name, rawDef] of Object.entries(rawProps)) {
    if (!isPlainRecord(rawDef)) {
      continue;
    }
    if (name.toLowerCase() === "schemecolor") {
      schemeColor = parseSteamColorValue(rawDef["value"]);
    }
    const ptype =
      typeof rawDef["type"] === "string"
        ? rawDef["type"].trim().toLowerCase()
        : "other";
    const text =
      typeof rawDef["text"] === "string" && rawDef["text"].trim().length > 0
        ? rawDef["text"].trim()
        : name;
    const order =
      typeof rawDef["order"] === "number" && Number.isFinite(rawDef["order"])
        ? rawDef["order"]
        : result.length;

    const rawVal = rawDef["value"];
    const normalizedVal: string | number | boolean | null =
      typeof rawVal === "string" ||
      typeof rawVal === "number" ||
      typeof rawVal === "boolean"
        ? rawVal
        : null;

    let options: WallpaperUserPropertyOption[] | undefined;
    if (Array.isArray(rawDef["options"])) {
      options = rawDef["options"]
        .filter((opt): opt is Record<string, unknown> => isPlainRecord(opt))
        .map((opt) => ({
          label: String(opt["label"] ?? opt["value"] ?? ""),
          value:
            typeof opt["value"] === "string" ||
            typeof opt["value"] === "number" ||
            typeof opt["value"] === "boolean"
              ? opt["value"]
              : String(opt["value"] ?? ""),
          ...(typeof opt["condition"] === "string"
            ? { condition: opt["condition"] }
            : {})
        }));
    }

    result.push({
      name,
      ptype,
      text,
      order,
      value: normalizedVal,
      defaultValue: normalizedVal,
      overridden: false,
      ...(typeof rawDef["condition"] === "string"
        ? { condition: rawDef["condition"] }
        : {}),
      ...(typeof rawDef["min"] === "number" ? { min: rawDef["min"] } : {}),
      ...(typeof rawDef["max"] === "number" ? { max: rawDef["max"] } : {}),
      ...(typeof rawDef["step"] === "number" ? { step: rawDef["step"] } : {}),
      ...(options !== undefined ? { options } : {}),
      ...(typeof rawDef["fileType"] === "string"
        ? { fileType: rawDef["fileType"] }
        : {})
    });
  }

  result.sort((a, b) => a.order - b.order);
  return { props: result, schemeColor };
}

function sanitizeJsonText(raw: string): string {
  return raw.replace(/^\uFEFF/, "").trim();
}

function encodeWebPathSegments(relPath: string): string {
  return relPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((seg) => seg.length > 0)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

function sanitizeImportFileName(rawName: string): string {
  const base = basename(rawName.trim()).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  const collapsed = base.replace(/\s+/g, "-").replace(/\.+/g, ".");
  return collapsed.length > 0 ? collapsed : `wallpaper-${Date.now()}`;
}

export function computeBufferSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function computeFileSha256Async(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(256 * 1024);
  const fh = await NodeFSP.open(filePath, "r");
  try {
    let offset = 0;
    while (true) {
      const { bytesRead } = await fh.read(chunk, 0, chunk.length, offset);
      if (bytesRead <= 0) {
        break;
      }
      hash.update(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
  } finally {
    await fh.close();
  }
  return hash.digest("hex");
}

export function computeFileSha256(filePath: string): string {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(256 * 1024);
  const fd = openSync(filePath, "r");
  try {
    let offset = 0;
    while (true) {
      const bytesRead = readSync(fd, chunk, 0, chunk.length, offset);
      if (bytesRead <= 0) {
        break;
      }
      hash.update(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function hasNumericDuplicateSuffix(fileName: string): boolean {
  const ext = extname(fileName);
  const stem = ext.length > 0 ? fileName.slice(0, -ext.length) : fileName;
  return /-\d+$/.test(stem);
}

/**
 * Deterministic preference ordering for byte-identical wallpaper files:
 * prefers canonical filenames without `-1` / `-2` duplicate suffixes, then shorter filenames.
 */
function compareCanonicalFilePath(aPath: string, bPath: string): number {
  const aBase = basename(aPath);
  const bBase = basename(bPath);
  const aSuffixed = hasNumericDuplicateSuffix(aBase) ? 1 : 0;
  const bSuffixed = hasNumericDuplicateSuffix(bBase) ? 1 : 0;
  if (aSuffixed !== bSuffixed) {
    return aSuffixed - bSuffixed;
  }
  if (aBase.length !== bBase.length) {
    return aBase.length - bBase.length;
  }
  if (aPath.length !== bPath.length) {
    return aPath.length - bPath.length;
  }
  const baseCmp = aBase.localeCompare(bBase);
  if (baseCmp !== 0) {
    return baseCmp;
  }
  return aPath.localeCompare(bPath);
}

export function findExistingDuplicateByHash(
  dir: string,
  sizeBytes: number,
  sha256: string
): string | null {
  if (!existsSync(dir)) {
    return null;
  }
  const sizeMatches: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of entries) {
      if (dirent.name.startsWith(".")) {
        continue;
      }
      const fullPath = join(current, dirent.name);
      if (dirent.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!dirent.isFile()) {
        continue;
      }
      const ext = extname(dirent.name).toLowerCase();
      if (!ALLOWED_IMPORT_EXTENSIONS.has(ext)) {
        continue;
      }
      if (!isPathStrictlyInsideDir(fullPath, dir)) {
        continue;
      }
      try {
        const st = statSync(fullPath);
        if (st.isFile() && st.size === sizeBytes) {
          sizeMatches.push(fullPath);
        }
      } catch {
        // ignore unreadable candidate
      }
    }
  }

  sizeMatches.sort(compareCanonicalFilePath);
  for (const candidate of sizeMatches) {
    try {
      if (computeFileSha256(candidate) === sha256) {
        return candidate;
      }
    } catch {
      // ignore unreadable candidate
    }
  }
  return null;
}

function ensureUniqueDestPath(targetDir: string, preferredName: string): string {
  const ext = extname(preferredName);
  const stem = ext.length > 0 ? preferredName.slice(0, -ext.length) : preferredName;
  const safeStem = stem.length > 0 ? stem : "wallpaper";

  let candidate = join(targetDir, `${safeStem}${ext}`);
  if (!existsSync(candidate)) {
    return candidate;
  }

  for (let i = 1; i <= 9999; i += 1) {
    candidate = join(targetDir, `${safeStem}-${i}${ext}`);
    if (!existsSync(candidate)) {
      return candidate;
    }
  }
  return join(targetDir, `${safeStem}-${randomUUID()}${ext}`);
}

async function queryWindowsRegistryValue(
  keyPath: string,
  valueName: string
): Promise<string | null> {
  if (HOST_PLATFORM !== "win32") {
    return null;
  }
  try {
    const { stdout } = await execFileAsync(
      "reg.exe",
      ["query", keyPath, "/v", valueName],
      { timeout: 2_000, windowsHide: true }
    );
    const regex = new RegExp(
      `^\\s*${valueName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+REG_\\w+\\s+(.+)$`,
      "im"
    );
    const match = regex.exec(stdout);
    if (!match || !match[1]) {
      return null;
    }
    return match[1].trim();
  } catch {
    return null;
  }
}

export async function discoverDefaultSteamRoots(): Promise<string[]> {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (dirPath: string | null | undefined) => {
    if (!dirPath || dirPath.trim().length === 0) {
      return;
    }
    const resolved = resolve(dirPath.trim());
    const key = HOST_PLATFORM === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) {
      return;
    }
    if (existsSync(resolved)) {
      seen.add(key);
      candidates.push(resolved);
    }
  };

  if (HOST_PLATFORM === "win32") {
    const [hkcuSteam, hklmSteam] = await Promise.all([
      queryWindowsRegistryValue("HKCU\\SOFTWARE\\Valve\\Steam", "SteamPath"),
      queryWindowsRegistryValue(
        "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam",
        "InstallPath"
      )
    ]);
    addCandidate(hkcuSteam);
    addCandidate(hklmSteam);
    addCandidate("C:\\Program Files (x86)\\Steam");
    addCandidate("C:\\Program Files\\Steam");
    addCandidate("D:\\Steam");
    addCandidate("D:\\SteamLibrary");
    addCandidate("E:\\Steam");
    addCandidate("E:\\SteamLibrary");
  } else if (HOST_PLATFORM === "darwin") {
    const home = process.env.HOME;
    if (home) {
      addCandidate(join(home, "Library", "Application Support", "Steam"));
    }
  } else {
    const home = process.env.HOME;
    if (home) {
      addCandidate(join(home, ".local", "share", "Steam"));
      addCandidate(join(home, ".steam", "steam"));
    }
  }

  return candidates;
}

/**
 * Discovers, indexes, imports, and streams Steam 431960, local custom, and
 * built-in WebWallGL wallpapers with RFC 9110 Range (`206 Partial Content`)
 * support and strict path-traversal protection.
 */
export class WallpaperMediaService {
  readonly customWallpaperDir: string;
  private customDirs: string[];
  private steamRootOverride: string;
  private advancedEngineEnabled: boolean;
  private readonly steamRootsDiscoverer: () => Promise<string[]>;
  private itemsById = new Map<string, IndexedWallpaperEntry>();
  private lastInventory: WallpaperInventorySnapshot | null = null;
  private inFlightRescan: Promise<WallpaperInventorySnapshot> | null = null;
  private queuedRescan: Promise<WallpaperInventorySnapshot> | null = null;
  private queuedRescanRequested = false;
  private rescanCount = 0;

  constructor(options: WallpaperServiceOptions) {
    this.customWallpaperDir = resolve(options.dataDir, "wallpapers");
    mkdirSync(this.customWallpaperDir, { recursive: true });
    this.customDirs = (options.customDirs ?? [])
      .map((dir) => dir.trim())
      .filter((dir) => dir.length > 0)
      .map((dir) => resolve(dir));
    this.steamRootOverride = (options.steamRootOverride ?? "").trim();
    this.advancedEngineEnabled = options.advancedEngineEnabled === true;
    this.steamRootsDiscoverer =
      options.steamRootsDiscoverer ?? discoverDefaultSteamRoots;
  }

  isAdvancedEngineEnabled(): boolean {
    return this.advancedEngineEnabled;
  }

  setAdvancedEngineEnabled(enabled: boolean): void {
    this.advancedEngineEnabled = Boolean(enabled);
  }

  getRescanCount(): number {
    return this.rescanCount;
  }

  async getInventory(options?: {
    advancedEngineEnabled?: boolean;
  }): Promise<WallpaperInventorySnapshot> {
    if (
      options?.advancedEngineEnabled !== undefined &&
      options.advancedEngineEnabled !== this.advancedEngineEnabled
    ) {
      return this.rescan({ advancedEngineEnabled: options.advancedEngineEnabled });
    }
    if (this.lastInventory !== null) {
      return this.lastInventory;
    }
    return this.rescan();
  }

  async rescan(request?: WallpaperRescanRequest): Promise<WallpaperInventorySnapshot> {
    let configChanged = false;
    if (request?.customDirs !== undefined) {
      const nextCustomDirs = [
        ...new Set(
          request.customDirs
            .map((d) => d.trim())
            .filter((d) => d.length > 0)
            .map((d) => resolve(d))
        )
      ];
      if (
        nextCustomDirs.length !== this.customDirs.length ||
        nextCustomDirs.some((d, idx) => d !== this.customDirs[idx])
      ) {
        this.customDirs = nextCustomDirs;
        configChanged = true;
      }
    }
    if (request?.steamRootOverride !== undefined) {
      const nextOverride = request.steamRootOverride.trim();
      if (nextOverride !== this.steamRootOverride) {
        this.steamRootOverride = nextOverride;
        configChanged = true;
      }
    }
    if (request?.advancedEngineEnabled !== undefined) {
      const nextEnabled = Boolean(request.advancedEngineEnabled);
      if (nextEnabled !== this.advancedEngineEnabled) {
        this.advancedEngineEnabled = nextEnabled;
        configChanged = true;
      }
    }

    // Single-flight + coalescing lock: concurrent identical rescans share one in-flight promise,
    // while config changes during an active scan coalesce into at most one follow-up scan.
    if (this.inFlightRescan !== null) {
      if (!configChanged && !this.queuedRescanRequested) {
        return this.inFlightRescan;
      }
      this.queuedRescanRequested = true;
      if (this.queuedRescan === null) {
        const waitForCurrent = this.inFlightRescan;
        this.queuedRescan = waitForCurrent
          .catch(() => undefined)
          .then(() => {
            this.queuedRescan = null;
            this.queuedRescanRequested = false;
            return this.startSingleFlightRescan();
          });
      }
      return this.queuedRescan;
    }

    return this.startSingleFlightRescan();
  }

  private startSingleFlightRescan(): Promise<WallpaperInventorySnapshot> {
    const run = this.performRescan().finally(() => {
      if (this.inFlightRescan === run) {
        this.inFlightRescan = null;
      }
    });
    this.inFlightRescan = run;
    return run;
  }

  private async performRescan(): Promise<WallpaperInventorySnapshot> {
    this.rescanCount += 1;
    const scanCustomDirs = [...this.customDirs];
    const scanSteamRootOverride = this.steamRootOverride;
    const scanAdvancedEngineEnabled = this.advancedEngineEnabled;

    await NodeFSP.mkdir(this.customWallpaperDir, { recursive: true });

    const steamRoots = await this.resolveAllSteamLibraryRoots(scanSteamRootOverride);
    const workshopDirs = await this.resolveWorkshopDirs(steamRoots);

    const nextItemsById = new Map<string, IndexedWallpaperEntry>();
    const collected: WallpaperInventoryItem[] = [];

    // 1. Steam Workshop 431960 items (async traversal; skips scene.pkg parsing when engine disabled)
    for (const workshopDir of workshopDirs) {
      await this.scanWorkshopDirectory(
        workshopDir,
        collected,
        nextItemsById,
        scanAdvancedEngineEnabled
      );
    }

    // 2. Local managed custom wallpaper dir + extra user-configured customDirs (deduplicated by size + SHA-256)
    const seenCustomBySize = new Map<
      number,
      Array<{ filePath: string; sha256: string | null }>
    >();
    const localScanDirs = [
      this.customWallpaperDir,
      ...scanCustomDirs.filter((d) => d !== this.customWallpaperDir)
    ];
    for (const dir of localScanDirs) {
      if (await pathExistsAsync(dir)) {
        await this.scanCustomDirectory(dir, collected, nextItemsById, seenCustomBySize);
      }
    }

    // Atomic index swap so concurrent preview/media requests never observe an emptied map mid-scan
    this.itemsById = nextItemsById;

    const snapshot: WallpaperInventorySnapshot = {
      schemaVersion: 1,
      scannedAt: Date.now(),
      customWallpaperDir: this.customWallpaperDir,
      customDirs: scanCustomDirs,
      steamRootOverride: scanSteamRootOverride,
      steamRoots,
      workshopDirs,
      items: collected,
      totalCount: collected.length
    };
    this.lastInventory = snapshot;
    return snapshot;
  }

  async importWallpaper(request: WallpaperImportRequest): Promise<{
    item: WallpaperInventoryItem;
    inventory: WallpaperInventorySnapshot;
  }> {
    mkdirSync(this.customWallpaperDir, { recursive: true });

    let destPath: string;
    if (typeof request.sourcePath === "string" && request.sourcePath.trim().length > 0) {
      const resolvedSrc = resolve(request.sourcePath.trim());
      if (!existsSync(resolvedSrc)) {
        throw new WallpaperServiceError(
          404,
          "SOURCE_NOT_FOUND",
          `Source wallpaper file not found: "${resolvedSrc}".`
        );
      }
      const st = statSync(resolvedSrc);
      if (!st.isFile()) {
        throw new WallpaperServiceError(
          400,
          "INVALID_SOURCE",
          "sourcePath must refer to a regular file."
        );
      }
      if (st.size <= 0 || st.size > MAX_IMPORT_SOURCE_FILE_BYTES) {
        throw new WallpaperServiceError(
          400,
          "INVALID_FILE_SIZE",
          `Imported wallpaper size must be between 1 byte and ${MAX_IMPORT_SOURCE_FILE_BYTES} bytes.`
        );
      }
      const ext = extname(resolvedSrc).toLowerCase();
      if (!ALLOWED_IMPORT_EXTENSIONS.has(ext)) {
        throw new WallpaperServiceError(
          400,
          "UNSUPPORTED_EXTENSION",
          `Unsupported wallpaper file extension "${ext}".`
        );
      }

      const sourceSha256 = computeFileSha256(resolvedSrc);
      const existingDup = findExistingDuplicateByHash(
        this.customWallpaperDir,
        st.size,
        sourceSha256
      );
      if (existingDup !== null) {
        destPath = existingDup;
      } else {
        const preferredName =
          typeof request.fileName === "string" && request.fileName.trim().length > 0
            ? sanitizeImportFileName(request.fileName)
            : sanitizeImportFileName(basename(resolvedSrc));
        const finalName = extname(preferredName).toLowerCase() === ext
          ? preferredName
          : `${preferredName}${ext}`;
        destPath = ensureUniqueDestPath(this.customWallpaperDir, finalName);

        this.atomicCopyFile(resolvedSrc, destPath);
      }
    } else if (
      typeof request.fileName === "string" &&
      request.fileName.trim().length > 0 &&
      typeof request.base64 === "string" &&
      request.base64.trim().length > 0
    ) {
      const safeName = sanitizeImportFileName(request.fileName);
      const ext = extname(safeName).toLowerCase();
      if (!ALLOWED_IMPORT_EXTENSIONS.has(ext)) {
        throw new WallpaperServiceError(
          400,
          "UNSUPPORTED_EXTENSION",
          `Unsupported wallpaper file extension "${ext}".`
        );
      }
      const cleanBase64 = request.base64
        .trim()
        .replace(/^data:[^;]+;base64,/i, "");
      const bytes = Buffer.from(cleanBase64, "base64");
      if (bytes.byteLength <= 0 || bytes.byteLength > MAX_IMPORT_DECODED_BYTES) {
        throw new WallpaperServiceError(
          400,
          "INVALID_FILE_SIZE",
          `Decoded wallpaper size must be between 1 byte and ${MAX_IMPORT_DECODED_BYTES} bytes.`
        );
      }

      const payloadSha256 = computeBufferSha256(bytes);
      const existingDup = findExistingDuplicateByHash(
        this.customWallpaperDir,
        bytes.byteLength,
        payloadSha256
      );
      if (existingDup !== null) {
        destPath = existingDup;
      } else {
        destPath = ensureUniqueDestPath(this.customWallpaperDir, safeName);
        this.atomicWriteBytes(destPath, bytes);
      }
    } else {
      throw new WallpaperServiceError(
        400,
        "INVALID_IMPORT_PAYLOAD",
        "Provide either { sourcePath } or { fileName, base64 }."
      );
    }

    const inventory = await this.rescan();
    const matched = inventory.items.find(
      (item) => item.filePath !== null && resolve(item.filePath) === resolve(destPath)
    );
    if (!matched) {
      throw new WallpaperServiceError(
        500,
        "IMPORT_INDEX_FAILED",
        "Imported wallpaper was saved but did not appear in rescan index."
      );
    }
    if (typeof request.title === "string" && request.title.trim().length > 0) {
      matched.title = request.title.trim();
    }
    return { item: matched, inventory };
  }

  async servePreview(
    rawId: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const entry = await this.resolveIndexedEntry(rawId);
    if (!entry) {
      this.writeError(res, 404, "WALLPAPER_NOT_FOUND", "Wallpaper not found.");
      return;
    }
    const target = entry.previewFile ?? (entry.item.type === "image" ? entry.mediaFile : null);
    if (!target) {
      this.writeError(res, 404, "PREVIEW_NOT_FOUND", "Wallpaper preview image not available.");
      return;
    }
    this.streamValidatedFile(target, entry.allowedRoot, req, res, "private, max-age=300");
  }

  async serveMedia(
    rawId: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const entry = await this.resolveIndexedEntry(rawId);
    if (!entry) {
      this.writeError(res, 404, "WALLPAPER_NOT_FOUND", "Wallpaper not found.");
      return;
    }
    const target = entry.mediaFile ?? entry.previewFile;
    if (!target) {
      this.writeError(res, 404, "MEDIA_NOT_FOUND", "Wallpaper media file not available.");
      return;
    }
    this.streamValidatedFile(target, entry.allowedRoot, req, res, "private, max-age=300");
  }

  async isWebWallpaperId(rawId: string): Promise<boolean> {
    try {
      const entry = await this.resolveIndexedEntry(rawId);
      return Boolean(entry && entry.webRootDir);
    } catch {
      return false;
    }
  }

  async serveSceneAsset(
    rawId: string,
    rawRelPath: string,
    req: IncomingMessage,
    res: ServerResponse,
    options?: { advancedEngineEnabled?: boolean }
  ): Promise<void> {
    if (hasRawTraversal(rawRelPath)) {
      this.writeError(res, 403, "PATH_TRAVERSAL_BLOCKED", "Path traversal is forbidden.");
      return;
    }

    const engineEnabled =
      options?.advancedEngineEnabled ?? this.advancedEngineEnabled;
    if (!engineEnabled) {
      this.writeError(
        res,
        403,
        "ENGINE_DISABLED",
        "Advanced wallpaper rendering engine (Web / Steam Scene) is disabled."
      );
      return;
    }

    const entry = await this.resolveIndexedEntry(rawId);
    if (!entry || !entry.scenePkgPath) {
      this.writeError(res, 404, "SCENE_WALLPAPER_NOT_FOUND", "Steam scene wallpaper not found.");
      return;
    }

    if (!isPathStrictlyInsideDir(entry.scenePkgPath, entry.allowedRoot)) {
      this.writeError(res, 403, "PATH_TRAVERSAL_BLOCKED", "Scene package escapes allowed directory.");
      return;
    }

    let manifest = entry.sceneManifest;
    try {
      const pkgStats = statSync(entry.scenePkgPath);
      if (
        !manifest ||
        manifest.pkgFileSize !== pkgStats.size ||
        manifest.pkgMtimeMs !== pkgStats.mtimeMs
      ) {
        manifest = inspectSteamScenePackage(entry.scenePkgPath);
        entry.sceneManifest = manifest;
      }
    } catch {
      this.writeError(res, 404, "SCENE_PACKAGE_MISSING", "Scene package file missing.");
      return;
    }

    if (!manifest || manifest.layers.length === 0) {
      this.writeError(res, 404, "SCENE_UNSUPPORTED", "Scene package has no renderable assets.");
      return;
    }

    let decodedRel: string;
    try {
      decodedRel = decodeURIComponent(rawRelPath);
    } catch {
      this.writeError(res, 400, "INVALID_ASSET_PATH", "Malformed scene asset path.");
      return;
    }
    if (hasRawTraversal(decodedRel)) {
      this.writeError(res, 403, "PATH_TRAVERSAL_BLOCKED", "Path traversal is forbidden.");
      return;
    }
    const cleanRel = decodedRel.replace(/\\/g, "/").replace(/^\/+/, "");

    if (cleanRel.length === 0 || cleanRel === "index.html") {
      const html = renderSteamScenePlayerHtml(manifest, entry.item.title);
      const body = Buffer.from(html, "utf8");
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(body.byteLength),
        "cache-control": "no-cache",
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin"
      });
      if (req.method?.toUpperCase() === "HEAD") {
        res.end();
        return;
      }
      res.end(body);
      return;
    }

    const assetMatch = /^asset\/(\d+)$/.exec(cleanRel);
    if (!assetMatch) {
      this.writeError(res, 404, "ASSET_NOT_FOUND", "Scene asset not found.");
      return;
    }
    const assetIdx = Number.parseInt(assetMatch[1]!, 10);
    const slice = Number.isInteger(assetIdx) ? manifest.assets[assetIdx] : undefined;
    if (!slice) {
      this.writeError(res, 404, "ASSET_NOT_FOUND", "Scene asset index not found.");
      return;
    }

    this.streamValidatedFileSlice(
      entry.scenePkgPath,
      entry.allowedRoot,
      slice.byteStart,
      slice.byteLength,
      slice.mimeType,
      req,
      res,
      "private, max-age=300"
    );
  }

  async serveWebAsset(
    rawId: string,
    rawRelPath: string,
    req: IncomingMessage,
    res: ServerResponse,
    options?: { refererWallpaperId?: string | null; advancedEngineEnabled?: boolean }
  ): Promise<void> {
    if (hasRawTraversal(rawRelPath)) {
      this.writeError(res, 403, "PATH_TRAVERSAL_BLOCKED", "Path traversal is forbidden.");
      return;
    }

    const engineEnabled =
      options?.advancedEngineEnabled ?? this.advancedEngineEnabled;
    if (!engineEnabled) {
      this.writeError(
        res,
        403,
        "ENGINE_DISABLED",
        "Advanced wallpaper rendering engine (Web / Steam Scene) is disabled."
      );
      return;
    }

    let entry = await this.resolveIndexedEntry(rawId);
    let effectiveRelPath = rawRelPath;

    // Steam Web wallpapers (e.g. Spine) may fetch `../assets/...` which normalizes to
    // `/web-t/<token>/assets/...`; re-bind inside the verified same-token Referer's webRootDir.
    if ((!entry || !entry.webRootDir) && options?.refererWallpaperId) {
      const refererEntry = await this.resolveIndexedEntry(options.refererWallpaperId);
      if (refererEntry && refererEntry.webRootDir) {
        entry = refererEntry;
        effectiveRelPath =
          rawRelPath.trim().length > 0 ? `${rawId}/${rawRelPath}` : rawId;
        if (hasRawTraversal(effectiveRelPath)) {
          this.writeError(res, 403, "PATH_TRAVERSAL_BLOCKED", "Path traversal is forbidden.");
          return;
        }
      }
    }

    if (!entry || !entry.webRootDir) {
      this.writeError(res, 404, "WEB_WALLPAPER_NOT_FOUND", "Web wallpaper not found.");
      return;
    }

    const requestedRel =
      effectiveRelPath.trim().length === 0
        ? (entry.webEntryRelPath ?? "index.html")
        : effectiveRelPath;

    const resolvedOutcome = resolveWebAssetPath(entry.webRootDir, requestedRel);
    if (!resolvedOutcome.ok) {
      if (resolvedOutcome.kind === "not_found") {
        this.writeError(res, 404, "ASSET_NOT_FOUND", "Web wallpaper asset not found.");
        return;
      }
      this.writeError(res, 403, "PATH_TRAVERSAL_BLOCKED", "Asset path escapes wallpaper directory.");
      return;
    }

    const resolvedAsset = resolvedOutcome.path;
    const ext = extname(resolvedAsset).toLowerCase();
    if ((ext === ".html" || ext === ".htm") && !req.headers.range) {
      this.serveWebHtmlWithBridge(resolvedAsset, entry, req, res);
      return;
    }

    this.streamValidatedFile(resolvedAsset, entry.webRootDir, req, res, "no-cache");
  }

  /** Early `<head>` bridge script for master audio, `../` URL clamping, and init reload guards. */
  private buildWebBridgeScript(
    defaultProps: Record<string, { value: string | number | boolean | null }>
  ): string {
    const serializedDefaults = JSON.stringify(defaultProps).replace(/</g, "\\u003c");
    return `<style data-pmx-we-style="1">html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000;}:where(body > canvas#canvas){display:block;width:100%;height:100%;}</style><script data-pmx-we-bridge="1">(()=>{
const d=${serializedDefaults};
let delivered=false,lastVals=Object.create(null),timer=null;
let pendingInit=null,layoutRafId=0,layoutFallbackTimer=null;
let masterMuted=true,masterVol=0,isPaused=false;
let webReadySent=false;
const seenInitUrls=[];

// 0. Master rAF Pause Controller (freezes uncooperative Web/WebGL wallpapers cleanly when paused/occluded)
const origRaf=typeof window.requestAnimationFrame==="function"
  ? window.requestAnimationFrame.bind(window)
  : (typeof requestAnimationFrame==="function"?requestAnimationFrame:null);
const origCancelRaf=typeof window.cancelAnimationFrame==="function"
  ? window.cancelAnimationFrame.bind(window)
  : (typeof cancelAnimationFrame==="function"?cancelAnimationFrame:null);
const MAX_PAUSED_RAF_QUEUE=64;
const pausedRafQueue=new Map();
const pausedRafIdByCb=new Map();
let syntheticRafSeq=1000000;

function enqueuePausedRaf(cb){
  const existingId=pausedRafIdByCb.get(cb);
  if(existingId!==undefined){
    pausedRafQueue.delete(existingId);
    pausedRafIdByCb.delete(cb);
  }
  while(pausedRafQueue.size>=MAX_PAUSED_RAF_QUEUE){
    const oldest=pausedRafQueue.entries().next().value;
    if(!oldest)break;
    pausedRafQueue.delete(oldest[0]);
    if(pausedRafIdByCb.get(oldest[1])===oldest[0]){
      pausedRafIdByCb.delete(oldest[1]);
    }
  }
  const qId=++syntheticRafSeq;
  pausedRafQueue.set(qId,cb);
  pausedRafIdByCb.set(cb,qId);
  return qId;
}

function scheduleManagedRaf(cb){
  if(!origRaf||typeof cb!=="function")return 0;
  if(isPaused){
    return enqueuePausedRaf(cb);
  }
  return origRaf((ts)=>{
    if(isPaused){
      enqueuePausedRaf(cb);
      return;
    }
    cb(ts);
  });
}

function flushPausedRafQueue(){
  if(isPaused||!origRaf||pausedRafQueue.size===0)return;
  const queued=Array.from(pausedRafQueue.values());
  pausedRafQueue.clear();
  pausedRafIdByCb.clear();
  for(let i=0;i<queued.length;i++){
    scheduleManagedRaf(queued[i]);
  }
}

if(origRaf){
  window.requestAnimationFrame=scheduleManagedRaf;
  window.cancelAnimationFrame=function(id){
    if(pausedRafQueue.has(id)){
      const cb=pausedRafQueue.get(id);
      pausedRafQueue.delete(id);
      if(cb!==undefined&&pausedRafIdByCb.get(cb)===id){
        pausedRafIdByCb.delete(cb);
      }
      return;
    }
    if(origCancelRaf){origCancelRaf(id);}
  };
}

const wpRootUrl=(()=>{try{return new URL("./",window.location.href);}catch{return null;}})();
const wpRootHref=wpRootUrl?wpRootUrl.href:"";
const wpRootOrigin=wpRootUrl?wpRootUrl.origin:"";
const wpRootPath=wpRootUrl?wpRootUrl.pathname:"";
const prefixMatch=/^(\\/v1\\/wallpapers\\/web-t\\/[^/]+\\/|\\/v1\\/wallpapers\\/web\\/)/.exec(wpRootPath);
const tokenPrefix=prefixMatch?prefixMatch[1]:null;
const wpIdSeg=tokenPrefix?wpRootPath.slice(tokenPrefix.length).split("/")[0]:"";

function recordInitUrl(u){
  if(delivered||seenInitUrls.length>=200||typeof u!=="string")return;
  seenInitUrls.push(u.toLowerCase());
}

function rewriteEscapedUrl(raw){
  if(typeof raw!=="string")return raw;
  const trimmed=raw.trim();
  if(!trimmed||/^(?:data:|blob:|javascript:|about:|#)/i.test(trimmed))return raw;
  recordInitUrl(trimmed);
  if(!tokenPrefix||!wpRootHref)return raw;
  try{
    const resolved=new URL(trimmed,window.location.href);
    if(resolved.origin===wpRootOrigin&&resolved.pathname.startsWith(tokenPrefix)&&!resolved.pathname.startsWith(wpRootPath)){
      const overflow=resolved.pathname.slice(tokenPrefix.length).replace(/^\\/+/, "");
      if(overflow.length>0&&overflow.split("/")[0]!==wpIdSeg){
        const rewritten=wpRootHref+overflow+resolved.search+resolved.hash;
        recordInitUrl(rewritten);
        return rewritten;
      }
    }
  }catch{}
  return raw;
}

// 1. Clamp escaped relative "../" asset fetches without altering caller asset keys
if(typeof XMLHttpRequest==="function"&&XMLHttpRequest.prototype&&typeof XMLHttpRequest.prototype.open==="function"){
  const origXhrOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){
    const args=Array.prototype.slice.call(arguments);
    if(typeof url==="string"){args[1]=rewriteEscapedUrl(url);}
    else if(url&&typeof url.href==="string"){args[1]=rewriteEscapedUrl(url.href);}
    return origXhrOpen.apply(this,args);
  };
}
if(typeof window.fetch==="function"){
  const origFetch=window.fetch.bind(window);
  window.fetch=function(input,init){
    if(typeof input==="string"){
      return origFetch(rewriteEscapedUrl(input),init);
    }
    if(input&&typeof input==="object"){
      if(typeof URL==="function"&&input instanceof URL){
        return origFetch(rewriteEscapedUrl(input.href),init);
      }
      if(typeof Request==="function"&&input instanceof Request){
        const nextUrl=rewriteEscapedUrl(input.url);
        if(nextUrl!==input.url){
          return origFetch(new Request(nextUrl,input),init);
        }
      }
    }
    return origFetch(input,init);
  };
}
if(typeof HTMLImageElement==="function"&&HTMLImageElement.prototype){
  const imgSrcDesc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,"src");
  if(imgSrcDesc&&imgSrcDesc.set){
    Object.defineProperty(HTMLImageElement.prototype,"src",{
      configurable:true,
      enumerable:imgSrcDesc.enumerable!==false,
      get:function(){return imgSrcDesc.get?imgSrcDesc.get.call(this):"";},
      set:function(v){imgSrcDesc.set.call(this,typeof v==="string"?rewriteEscapedUrl(v):v);}
    });
  }
  const origImgSetAttr=HTMLImageElement.prototype.setAttribute;
  if(typeof origImgSetAttr==="function"){
    HTMLImageElement.prototype.setAttribute=function(name,val){
      if(typeof name==="string"&&name.toLowerCase()==="src"&&typeof val==="string"){
        return origImgSetAttr.call(this,name,rewriteEscapedUrl(val));
      }
      return origImgSetAttr.call(this,name,val);
    };
  }
}

// 2. Master Audio Controller (starts strictly muted at volume 0 until host sends audio state)
const mediaState=new WeakMap();
const trackedMedia=new Set();
const audioCtxSet=new Set();
const ctxGainMap=new WeakMap();
const masterGainNodes=new WeakSet();

const mediaProto=typeof HTMLMediaElement==="function"?HTMLMediaElement.prototype:null;
const origVolDesc=mediaProto?Object.getOwnPropertyDescriptor(mediaProto,"volume"):null;
const origMutedDesc=mediaProto?Object.getOwnPropertyDescriptor(mediaProto,"muted"):null;
const origMediaSrcDesc=mediaProto?Object.getOwnPropertyDescriptor(mediaProto,"src"):null;
const origPlay=mediaProto&&typeof mediaProto.play==="function"?mediaProto.play:null;
const origPause=mediaProto&&typeof mediaProto.pause==="function"?mediaProto.pause:null;

function getMediaInfo(el){
  let info=mediaState.get(el);
  if(!info){
    const initialVol=origVolDesc&&origVolDesc.get?origVolDesc.get.call(el):1;
    const initialMuted=origMutedDesc&&origMutedDesc.get?origMutedDesc.get.call(el):false;
    info={
      baseVol:typeof initialVol==="number"&&Number.isFinite(initialVol)?Math.max(0,Math.min(1,initialVol)):1,
      baseMuted:Boolean(initialMuted),
      pausedByHost:false
    };
    mediaState.set(el,info);
  }
  return info;
}

function syncMediaElement(el){
  if(!el)return;
  const info=getMediaInfo(el);
  const effMuted=masterMuted||masterVol<=0||info.baseMuted;
  const effVol=effMuted?0:Math.max(0,Math.min(1,info.baseVol*masterVol));
  try{if(origMutedDesc&&origMutedDesc.set)origMutedDesc.set.call(el,effMuted);}catch{}
  try{if(origVolDesc&&origVolDesc.set)origVolDesc.set.call(el,effVol);}catch{}
}

function shouldPruneTrackedMedia(el){
  if(!el)return true;
  if(el.isConnected===false){
    const info=mediaState.get(el);
    if(el.ended&&!el.loop)return true;
    if(el.paused&&!(info&&info.pausedByHost))return true;
  }
  return false;
}

function pruneTrackedMedia(){
  trackedMedia.forEach((el)=>{
    if(shouldPruneTrackedMedia(el)){
      trackedMedia.delete(el);
    }
  });
}

function trackMediaElement(el){
  if(!el||trackedMedia.has(el))return;
  if(trackedMedia.size>=64){
    pruneTrackedMedia();
  }
  trackedMedia.add(el);
  getMediaInfo(el);
  syncMediaElement(el);
  try{
    if(typeof el.addEventListener==="function"){
      el.addEventListener("ended",()=>{
        if(el.isConnected===false&&!el.loop){trackedMedia.delete(el);}
      });
    }
  }catch{}
}

if(mediaProto){
  if(origVolDesc&&origVolDesc.set){
    Object.defineProperty(mediaProto,"volume",{
      configurable:true,
      enumerable:origVolDesc.enumerable!==false,
      get:function(){return getMediaInfo(this).baseVol;},
      set:function(v){
        const n=Number(v);
        const info=getMediaInfo(this);
        info.baseVol=Number.isFinite(n)?Math.max(0,Math.min(1,n)):1;
        trackMediaElement(this);
        syncMediaElement(this);
      }
    });
  }
  if(origMutedDesc&&origMutedDesc.set){
    Object.defineProperty(mediaProto,"muted",{
      configurable:true,
      enumerable:origMutedDesc.enumerable!==false,
      get:function(){return getMediaInfo(this).baseMuted;},
      set:function(v){
        const info=getMediaInfo(this);
        info.baseMuted=Boolean(v);
        trackMediaElement(this);
        syncMediaElement(this);
      }
    });
  }
  if(origMediaSrcDesc&&origMediaSrcDesc.set){
    Object.defineProperty(mediaProto,"src",{
      configurable:true,
      enumerable:origMediaSrcDesc.enumerable!==false,
      get:function(){return origMediaSrcDesc.get?origMediaSrcDesc.get.call(this):"";},
      set:function(v){
        trackMediaElement(this);
        origMediaSrcDesc.set.call(this,typeof v==="string"?rewriteEscapedUrl(v):v);
      }
    });
  }
  const origMediaSetAttr=mediaProto.setAttribute;
  if(typeof origMediaSetAttr==="function"){
    mediaProto.setAttribute=function(name,val){
      if(typeof name==="string"&&name.toLowerCase()==="src"&&typeof val==="string"){
        trackMediaElement(this);
        return origMediaSetAttr.call(this,name,rewriteEscapedUrl(val));
      }
      return origMediaSetAttr.call(this,name,val);
    };
  }
  if(origPlay){
    mediaProto.play=function(){
      trackMediaElement(this);
      const info=getMediaInfo(this);
      syncMediaElement(this);
      if(isPaused){
        info.pausedByHost=true;
        if(origPause){try{origPause.call(this);}catch{}}
        return Promise.resolve();
      }
      info.pausedByHost=false;
      return origPlay.call(this);
    };
  }
  if(origPause){
    mediaProto.pause=function(){
      const info=getMediaInfo(this);
      info.pausedByHost=false;
      return origPause.call(this);
    };
  }
}

if(typeof window.Audio==="function"){
  const OrigAudio=window.Audio;
  const PatchedAudio=function(src){
    const el=arguments.length>0?new OrigAudio(typeof src==="string"?rewriteEscapedUrl(src):src):new OrigAudio();
    trackMediaElement(el);
    return el;
  };
  PatchedAudio.prototype=OrigAudio.prototype;
  try{Object.setPrototypeOf(PatchedAudio,OrigAudio);}catch{}
  window.Audio=PatchedAudio;
}

if(typeof Document==="function"&&Document.prototype){
  if(typeof Document.prototype.createElement==="function"){
    const origCreate=Document.prototype.createElement;
    Document.prototype.createElement=function(tagName){
      const el=origCreate.apply(this,arguments);
      if(typeof tagName==="string"){
        const lower=tagName.toLowerCase();
        if(lower==="audio"||lower==="video"){trackMediaElement(el);}
      }
      return el;
    };
  }
  if(typeof Document.prototype.createElementNS==="function"){
    const origCreateNS=Document.prototype.createElementNS;
    Document.prototype.createElementNS=function(ns,tagName){
      const el=origCreateNS.apply(this,arguments);
      if(typeof tagName==="string"){
        const lower=tagName.toLowerCase();
        if(lower==="audio"||lower==="video"){trackMediaElement(el);}
      }
      return el;
    };
  }
}

const origAudioNodeConnect=typeof AudioNode==="function"&&AudioNode.prototype&&typeof AudioNode.prototype.connect==="function"?AudioNode.prototype.connect:null;

const patchedAudioCtxCloseProtos=new WeakSet();
const patchedAudioCtxOwnClose=new WeakSet();

function evictAudioContext(ctx){
  if(!ctx)return;
  audioCtxSet.delete(ctx);
  ctxGainMap.delete(ctx);
}

function patchAudioContextCloseProto(proto){
  if(!proto||patchedAudioCtxCloseProtos.has(proto)||typeof proto.close!=="function")return;
  patchedAudioCtxCloseProtos.add(proto);
  const origClose=proto.close;
  proto.close=function(){
    evictAudioContext(this);
    try{
      const result=origClose.apply(this,arguments);
      if(result&&typeof result.finally==="function"){
        return result.finally(()=>{evictAudioContext(this);});
      }
      return result;
    }catch(err){
      evictAudioContext(this);
      throw err;
    }
  };
}

function trackAudioContext(ctx){
  if(!ctx||ctx.state==="closed"){
    evictAudioContext(ctx);
    return false;
  }
  if(!audioCtxSet.has(ctx)){
    audioCtxSet.add(ctx);
    try{patchAudioContextCloseProto(Object.getPrototypeOf(ctx));}catch{}
    if(!patchedAudioCtxOwnClose.has(ctx)&&Object.prototype.hasOwnProperty.call(ctx,"close")&&typeof ctx.close==="function"){
      patchedAudioCtxOwnClose.add(ctx);
      const origOwnClose=ctx.close;
      ctx.close=function(){
        evictAudioContext(ctx);
        try{
          const result=origOwnClose.apply(this,arguments);
          if(result&&typeof result.finally==="function"){
            return result.finally(()=>{evictAudioContext(ctx);});
          }
          return result;
        }catch(err){
          evictAudioContext(ctx);
          throw err;
        }
      };
    }
    try{
      if(typeof ctx.addEventListener==="function"){
        ctx.addEventListener("statechange",()=>{
          if(ctx.state==="closed"){evictAudioContext(ctx);}
        });
      }
    }catch{}
  }
  return true;
}

function ensureCtxGain(ctx){
  if(!ctx||ctx.state==="closed"){
    evictAudioContext(ctx);
    return null;
  }
  let gain=ctxGainMap.get(ctx);
  if(!gain&&typeof ctx.createGain==="function"&&origAudioNodeConnect){
    try{
      gain=ctx.createGain();
      gain.gain.value=(masterMuted||masterVol<=0)?0:masterVol;
      masterGainNodes.add(gain);
      origAudioNodeConnect.call(gain,ctx.destination);
      ctxGainMap.set(ctx,gain);
      trackAudioContext(ctx);
    }catch{
      return null;
    }
  }
  return gain||null;
}

if(origAudioNodeConnect){
  AudioNode.prototype.connect=function(dest){
    if(this&&!masterGainNodes.has(this)&&this.context&&dest===this.context.destination){
      const gain=ensureCtxGain(this.context);
      if(gain){
        const args=Array.prototype.slice.call(arguments);
        args[0]=gain;
        return origAudioNodeConnect.apply(this,args);
      }
    }
    return origAudioNodeConnect.apply(this,arguments);
  };
}

function syncAudioContext(ctx){
  if(!ctx||ctx.state==="closed"){
    evictAudioContext(ctx);
    return;
  }
  const gain=ensureCtxGain(ctx);
  const silent=isPaused||masterMuted||masterVol<=0;
  if(gain&&gain.gain){
    try{gain.gain.value=silent?0:masterVol;}catch{}
  }
  try{
    if(silent){
      if(typeof ctx.suspend==="function"&&ctx.state!=="closed"){ctx.suspend().catch(()=>{});}
    }else{
      if(typeof ctx.resume==="function"&&ctx.state==="suspended"){ctx.resume().catch(()=>{});}
    }
  }catch{}
}

function wrapAudioContextCtor(propName){
  const OrigCtx=window[propName];
  if(typeof OrigCtx!=="function")return;
  patchAudioContextCloseProto(OrigCtx.prototype);
  const WrappedCtx=function(){
    const ctx=Reflect.construct(OrigCtx,arguments,new.target||OrigCtx);
    trackAudioContext(ctx);
    syncAudioContext(ctx);
    return ctx;
  };
  WrappedCtx.prototype=OrigCtx.prototype;
  try{Object.setPrototypeOf(WrappedCtx,OrigCtx);}catch{}
  window[propName]=WrappedCtx;
}
wrapAudioContextCtor("AudioContext");
wrapAudioContextCtor("webkitAudioContext");

function applyMasterAudio(nextMuted,nextVol){
  const clamped=typeof nextVol==="number"&&Number.isFinite(nextVol)?Math.max(0,Math.min(1,nextVol)):masterVol;
  const effMuted=Boolean(nextMuted)||clamped<=0;
  masterMuted=effMuted;
  masterVol=effMuted?0:clamped;
  try{
    if(document&&typeof document.querySelectorAll==="function"){
      const nodes=document.querySelectorAll("audio,video");
      for(let i=0;i<nodes.length;i++){trackMediaElement(nodes[i]);}
    }
  }catch{}
  trackedMedia.forEach((el)=>{
    syncMediaElement(el);
    if(shouldPruneTrackedMedia(el)){
      trackedMedia.delete(el);
    }
  });
  audioCtxSet.forEach((ctx)=>{syncAudioContext(ctx);});
}

function applyMasterPaused(nextPaused){
  const norm=Boolean(nextPaused);
  if(isPaused===norm)return;
  isPaused=norm;
  try{
    if(document&&typeof document.querySelectorAll==="function"){
      const nodes=document.querySelectorAll("audio,video");
      for(let i=0;i<nodes.length;i++){trackMediaElement(nodes[i]);}
    }
  }catch{}
  trackedMedia.forEach((el)=>{
    if(shouldPruneTrackedMedia(el)){
      trackedMedia.delete(el);
      return;
    }
    const info=getMediaInfo(el);
    if(isPaused){
      if(!el.paused){
        info.pausedByHost=true;
        if(origPause){try{origPause.call(el);}catch{}}
      }
    }else{
      syncMediaElement(el);
      if(info.pausedByHost){
        info.pausedByHost=false;
        if(origPlay){try{origPlay.call(el).catch(()=>{});}catch{}}
      }
    }
  });
  audioCtxSet.forEach((ctx)=>{syncAudioContext(ctx);});
  if(!isPaused){
    flushPausedRafQueue();
  }
}

// 3. Wallpaper Engine property bridge + duplicate initial modelresolution reload guard
if(typeof window.wallpaperRegisterAudioListener!=="function"){
  window.wallpaperRegisterAudioListener=function(cb){window.__pmxWeAudioListener=cb;};
}

function hasInitResolutionDownload(resVal){
  const token=String(resVal||"").trim().toLowerCase();
  if(!token)return false;
  const escaped=token.replace(/[.*+?^$()|[\\]\\\\]/g,"\\\\$&");
  const re=new RegExp("(?:^|[\\\\/_.-])"+escaped+"(?:[\\\\/_.-]|$)");
  for(let i=0;i<seenInitUrls.length;i++){
    if(re.test(seenInitUrls[i]))return true;
  }
  return false;
}

function applyProps(raw,isInitial,rawOverrides){
  const l=window.wallpaperPropertyListener;
  if(!l||typeof l.applyUserProperties!=="function")return false;
  const out={};
  let n=0;
  for(const k of Object.keys(raw)){
    const item=raw[k];
    if(!item||typeof item!=="object"||!("value" in item))continue;
    if(isInitial&&k==="modelresolution"){
      const defVal=d&&d.modelresolution?d.modelresolution.value:undefined;
      const userChanged=Boolean(rawOverrides&&rawOverrides.modelresolution&&typeof rawOverrides.modelresolution==="object"&&rawOverrides.modelresolution.value!==defVal);
      if(!userChanged&&item.value===defVal&&hasInitResolutionDownload(item.value)){
        lastVals[k]=item.value;
        continue;
      }
    }
    if(!isInitial&&Object.prototype.hasOwnProperty.call(lastVals,k)&&lastVals[k]===item.value)continue;
    lastVals[k]=item.value;
    out[k]=item;
    n++;
  }
  if(n>0||isInitial){try{l.applyUserProperties(out);}catch{}}
  return true;
}

function hasViewportLayout(){
  const de=document&&document.documentElement;
  if(!de)return true;
  return de.clientWidth>0&&de.clientHeight>0;
}

function clearLayoutDefer(){
  if(layoutRafId&&origCancelRaf){origCancelRaf(layoutRafId);}
  layoutRafId=0;
  if(layoutFallbackTimer){clearTimeout(layoutFallbackTimer);layoutFallbackTimer=null;}
}

function flushPendingInit(force){
  if(delivered||!pendingInit)return;
  if(!force&&!hasViewportLayout())return;
  const next=pendingInit;
  pendingInit=null;
  clearLayoutDefer();
  deliver(next.raw,next.gen,null,true);
}

function scheduleLayoutDefer(){
  if(delivered||!pendingInit)return;
  if(!layoutFallbackTimer){
    layoutFallbackTimer=setTimeout(()=>{
      layoutFallbackTimer=null;
      flushPendingInit(true);
    },300);
  }
  if(!layoutRafId&&origRaf){
    const step=()=>{
      layoutRafId=0;
      if(delivered||!pendingInit)return;
      if(hasViewportLayout()){
        flushPendingInit(false);
      }else{
        layoutRafId=origRaf(step);
      }
    };
    layoutRafId=origRaf(step);
  }
}

function deliver(raw,gen,audio,forceInit){
  if(audio&&typeof audio==="object"){
    applyMasterAudio(audio.muted,audio.volume);
  }
  if(gen&&typeof gen.paused==="boolean"){
    applyMasterPaused(gen.paused);
  }
  const isInit=!delivered;
  if(isInit&&!forceInit&&!hasViewportLayout()){
    if(!pendingInit){
      pendingInit={
        raw:raw&&typeof raw==="object"?Object.assign({},raw):{},
        gen:gen&&typeof gen==="object"?Object.assign({},gen):null
      };
    }else{
      if(raw&&typeof raw==="object"){Object.assign(pendingInit.raw,raw);}
      if(gen&&typeof gen==="object"){pendingInit.gen=Object.assign({},pendingInit.gen||{},gen);}
    }
    if(timer){clearTimeout(timer);timer=null;}
    scheduleLayoutDefer();
    return;
  }
  const merged=isInit?Object.assign({},d,raw||{}):(raw||{});
  if(applyProps(merged,isInit,raw||null)){
    delivered=true;
    pendingInit=null;
    clearLayoutDefer();
    if(timer){clearTimeout(timer);timer=null;}
  }
  const l=window.wallpaperPropertyListener;
  if(gen&&l){
    if(typeof l.applyGeneralProperties==="function"){try{l.applyGeneralProperties(gen);}catch{}}
    if(typeof gen.paused==="boolean"&&typeof l.setPaused==="function"){try{l.setPaused(gen.paused);}catch{}}
  }
}

window.addEventListener("message",(e)=>{
  const m=e&&e.data;
  if(!m||typeof m!=="object")return;
  if(m.type==="prismuxWallpaperAudio"){
    applyMasterAudio(m.muted,m.volume);
    return;
  }
  if(m.type==="wallpaperPropertyListener"){
    deliver(m.applyUserProperties,m.applyGeneralProperties,m.audio);
  }
});

// 4. Readiness signals (prismuxWeBridgeReady + prismuxWebReady) & container resize sync
function postParent(msg){
  try{if(window.parent&&window.parent!==window){window.parent.postMessage(msg,"*");}}catch{}
}
function notifyBridgeReady(){postParent({type:"prismuxWeBridgeReady"});}
function markWebReady(){
  if(webReadySent)return;
  webReadySent=true;
  postParent({type:"prismuxWebReady"});
}

function patchWebGlReady(ctorName){
  const Ctor=window[ctorName];
  if(typeof Ctor!=="function"||!Ctor.prototype)return;
  for(const fnName of ["drawElements","drawArrays"]){
    const orig=Ctor.prototype[fnName];
    if(typeof orig!=="function")continue;
    Ctor.prototype[fnName]=function(mode,count){
      const res=orig.apply(this,arguments);
      if(!webReadySent&&typeof count==="number"&&count>0){
        queueMicrotask(markWebReady);
      }
      return res;
    };
  }
}
patchWebGlReady("WebGLRenderingContext");
patchWebGlReady("WebGL2RenderingContext");

function scheduleFallback(){
  if(delivered||timer||pendingInit)return;
  timer=setTimeout(()=>{timer=null;if(!delivered&&!pendingInit)deliver({},null,null);},80);
}

function onDomReady(){
  notifyBridgeReady();
  scheduleFallback();
  if(pendingInit&&!delivered&&hasViewportLayout()){flushPendingInit(false);}
  try{
    if(typeof ResizeObserver==="function"&&document.documentElement){
      let lastW=document.documentElement.clientWidth,lastH=document.documentElement.clientHeight;
      let rzTimer=null;
      const ro=new ResizeObserver(()=>{
        const w=document.documentElement.clientWidth,h=document.documentElement.clientHeight;
        if(w>0&&h>0&&pendingInit&&!delivered){
          flushPendingInit(false);
        }
        if(w===lastW&&h===lastH)return;
        lastW=w;lastH=h;
        if(rzTimer)clearTimeout(rzTimer);
        rzTimer=setTimeout(()=>{rzTimer=null;try{window.dispatchEvent(new Event("resize"));}catch{}},32);
      });
      ro.observe(document.documentElement);
    }
  }catch{}
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",onDomReady,{once:true});
}else{
  onDomReady();
}
window.addEventListener("load",()=>{
  notifyBridgeReady();
  scheduleFallback();
  const hasCanvas=Boolean(document&&document.querySelector&&document.querySelector("canvas"));
  if(!hasCanvas){
    if(origRaf){origRaf(markWebReady);}else{markWebReady();}
  }else{
    setTimeout(markWebReady,1200);
  }
},{once:true});
})();</script>`;
  }

  /**
   * Serves Steam Web wallpaper HTML entry points with a lightweight Wallpaper Engine
   * `window.wallpaperPropertyListener` & `window.wallpaperRegisterAudioListener` bridge
   * so postMessage updates and `project.json` default properties activate Spine/Live2D
   * wallpapers that wait for `applyUserProperties(...)` before rendering.
   */
  private serveWebHtmlWithBridge(
    filePath: string,
    entry: IndexedWallpaperEntry,
    req: IncomingMessage,
    res: ServerResponse
  ): void {
    if (!entry.webRootDir || !isPathStrictlyInsideDir(filePath, entry.webRootDir)) {
      this.writeError(res, 403, "PATH_TRAVERSAL_BLOCKED", "File is outside allowed directory.");
      return;
    }

    let htmlText: string;
    try {
      htmlText = readFileSync(filePath, "utf8");
    } catch {
      this.writeError(res, 404, "FILE_NOT_FOUND", "Web wallpaper HTML missing.");
      return;
    }

    const defaultProps: Record<string, { value: string | number | boolean | null }> = {};
    for (const prop of entry.item.userProperties ?? []) {
      defaultProps[prop.name] = { value: prop.defaultValue };
    }
    const bridgeScript = this.buildWebBridgeScript(defaultProps);

    const headOpenMatch = /<head\b[^>]*>/i.exec(htmlText);
    const injectedHtml = headOpenMatch
      ? `${htmlText.slice(0, headOpenMatch.index + headOpenMatch[0].length)}${bridgeScript}${htmlText.slice(headOpenMatch.index + headOpenMatch[0].length)}`
      : `${bridgeScript}${htmlText}`;

    const body = Buffer.from(injectedHtml, "utf8");
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": String(body.byteLength),
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin"
    });
    if (req.method?.toUpperCase() === "HEAD") {
      res.end();
      return;
    }
    res.end(body);
  }

  private async resolveIndexedEntry(
    rawId: string
  ): Promise<IndexedWallpaperEntry | null> {
    if (hasRawTraversal(rawId)) {
      throw new WallpaperServiceError(
        403,
        "PATH_TRAVERSAL_BLOCKED",
        "Invalid wallpaper identifier."
      );
    }
    let decodedId: string;
    try {
      decodedId = decodeURIComponent(rawId);
    } catch {
      throw new WallpaperServiceError(400, "INVALID_ID", "Malformed wallpaper ID.");
    }
    if (hasRawTraversal(decodedId)) {
      throw new WallpaperServiceError(
        403,
        "PATH_TRAVERSAL_BLOCKED",
        "Invalid wallpaper identifier."
      );
    }

    if (this.lastInventory === null) {
      await this.getInventory();
    }
    return this.itemsById.get(decodedId) ?? null;
  }

  private async resolveAllSteamLibraryRoots(
    steamRootOverride: string
  ): Promise<string[]> {
    const roots: string[] = [];
    const seen = new Set<string>();

    const addRoot = async (candidate: string) => {
      const normalized = resolve(candidate);
      const key =
        HOST_PLATFORM === "win32" ? normalized.toLowerCase() : normalized;
      if (!seen.has(key) && (await pathExistsAsync(normalized))) {
        seen.add(key);
        roots.push(normalized);
      }
    };

    const seedRoots: string[] = [];
    if (steamRootOverride.length > 0) {
      seedRoots.push(resolve(steamRootOverride));
    } else {
      seedRoots.push(...(await this.steamRootsDiscoverer()));
    }

    for (const seed of seedRoots) {
      await addRoot(seed);
      const vdfCandidates = [
        join(seed, "steamapps", "libraryfolders.vdf"),
        join(seed, "config", "libraryfolders.vdf")
      ];
      for (const vdfPath of vdfCandidates) {
        try {
          const vdfText = await NodeFSP.readFile(vdfPath, "utf8");
          for (const libRoot of parseLibraryFoldersVdf(vdfText)) {
            await addRoot(libRoot);
          }
        } catch {
          // ignore missing or unreadable vdf
        }
      }
    }

    return roots;
  }

  private async resolveWorkshopDirs(steamRoots: readonly string[]): Promise<string[]> {
    const dirs: string[] = [];
    const seen = new Set<string>();
    for (const root of steamRoots) {
      const candidate = join(
        root,
        "steamapps",
        "workshop",
        "content",
        WALLPAPER_ENGINE_APP_ID
      );
      if (!(await pathExistsAsync(candidate))) {
        continue;
      }
      const key =
        HOST_PLATFORM === "win32" ? candidate.toLowerCase() : candidate;
      if (!seen.has(key)) {
        seen.add(key);
        dirs.push(candidate);
      }
    }
    return dirs;
  }

  private async scanWorkshopDirectory(
    workshopDir: string,
    out: WallpaperInventoryItem[],
    itemsById: Map<string, IndexedWallpaperEntry>,
    advancedEngineEnabled: boolean
  ): Promise<void> {
    let entries;
    try {
      entries = await NodeFSP.readdir(workshopDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of entries) {
      if (!dirent.isDirectory()) {
        continue;
      }
      const itemDir = join(workshopDir, dirent.name);
      const projectJsonPath = join(itemDir, "project.json");
      let rawProjectText: string;
      try {
        rawProjectText = await NodeFSP.readFile(projectJsonPath, "utf8");
      } catch {
        continue;
      }

      const visibilityPath = join(itemDir, "visibility.json");
      try {
        const visText = await NodeFSP.readFile(visibilityPath, "utf8");
        const vis = JSON.parse(sanitizeJsonText(visText)) as unknown;
        if (isPlainRecord(vis) && vis["hidden"] === true) {
          continue;
        }
      } catch {
        // ignore missing or malformed visibility.json
      }

      let project: unknown;
      try {
        project = JSON.parse(sanitizeJsonText(rawProjectText));
      } catch {
        continue;
      }
      if (!isPlainRecord(project)) {
        continue;
      }

      const rawId =
        typeof project["id"] === "string" || typeof project["id"] === "number"
          ? String(project["id"]).trim()
          : dirent.name;
      const id = rawId.length > 0 ? rawId : dirent.name;
      if (itemsById.has(id)) {
        continue;
      }

      let realItemDir: string | undefined;
      try {
        realItemDir = await NodeFSP.realpath(itemDir);
      } catch {
        realItemDir = undefined;
      }

      const title =
        typeof project["title"] === "string" && project["title"].trim().length > 0
          ? project["title"].trim()
          : id;
      const rawFile =
        typeof project["file"] === "string" && project["file"].trim().length > 0
          ? project["file"].trim()
          : null;
      const rawPreview =
        typeof project["preview"] === "string" && project["preview"].trim().length > 0
          ? project["preview"].trim()
          : null;

      const mediaFile = rawFile
        ? await safeResolveLocalPathAsync(itemDir, rawFile, realItemDir)
        : null;
      const previewFile = rawPreview
        ? await safeResolveLocalPathAsync(itemDir, rawPreview, realItemDir)
        : null;

      const resolvedMedia =
        mediaFile && (await pathExistsAsync(mediaFile)) ? mediaFile : null;
      const resolvedPreview =
        previewFile && (await pathExistsAsync(previewFile)) ? previewFile : null;

      const type = normalizeWallpaperType(project["type"], rawFile);
      const contentRating = normalizeContentRating(project["contentrating"]);
      const { props, schemeColor } = parseSteamUserProperties(project["general"]);
      const tags = Array.isArray(project["tags"])
        ? project["tags"].filter((t): t is string => typeof t === "string")
        : [];

      let dimensions: { width: number; height: number } | null = null;
      let scenePkgPath: string | null = null;
      let sceneManifest: SteamScenePackageManifest | null = null;

      if (type === "video" && resolvedMedia) {
        dimensions = await readVideoDimensionsAsync(resolvedMedia);
      } else if (type === "image" && resolvedMedia) {
        dimensions = await readImageDimensionsAsync(resolvedMedia);
      } else if (type === "scene") {
        // When advancedEngineEnabled is false, SKIP inspectSteamScenePackage(candidatePkg)
        // completely so catalog scans incur ~0 I/O while keeping Scene items visible.
        if (advancedEngineEnabled) {
          const candidatePkg = await safeResolveLocalPathAsync(
            itemDir,
            "scene.pkg",
            realItemDir
          );
          if (candidatePkg && (await pathExistsAsync(candidatePkg))) {
            scenePkgPath = candidatePkg;
            // Yield a macrotask turn before bounded binary header probe so HTTP/RPC remains responsive
            await new Promise<void>((r) => setImmediate(r));
            sceneManifest = inspectSteamScenePackage(candidatePkg);
            if (sceneManifest && sceneManifest.layers.length > 0) {
              dimensions = {
                width: sceneManifest.width,
                height: sceneManifest.height
              };
            }
          }
        }
      }
      if (!dimensions && resolvedPreview) {
        dimensions = await readImageDimensionsAsync(resolvedPreview);
      }

      let fileSize: number | undefined;
      let mtimeMs: number | undefined;
      const statTarget = resolvedMedia ?? scenePkgPath ?? resolvedPreview;
      if (statTarget) {
        try {
          const st = await NodeFSP.stat(statTarget);
          fileSize = st.size;
          mtimeMs = st.mtimeMs;
        } catch {
          // ignore
        }
      }

      const encodedId = encodeURIComponent(id);
      const previewUrl = resolvedPreview
        ? `/v1/wallpapers/preview/${encodedId}`
        : null;

      let mediaUrl: string | null = null;
      let webEntryUrl: string | null = null;
      let webEntryRelPath: string | null = null;
      const sceneLiveSupported =
        advancedEngineEnabled &&
        type === "scene" &&
        sceneManifest !== null &&
        sceneManifest.layers.length > 0;

      if (type === "web" && rawFile && resolvedMedia) {
        const rel = relative(itemDir, resolvedMedia).replace(/\\/g, "/");
        webEntryRelPath = rel;
        webEntryUrl = `/v1/wallpapers/web/${encodedId}/${encodeWebPathSegments(rel)}`;
        mediaUrl = webEntryUrl;
      } else if (sceneLiveSupported) {
        const sceneUrl = `/v1/wallpapers/scene/${encodedId}/index.html`;
        webEntryUrl = sceneUrl;
        mediaUrl = sceneUrl;
      } else if ((type === "video" || type === "image") && resolvedMedia) {
        mediaUrl = `/v1/wallpapers/media/${encodedId}`;
      } else if (resolvedPreview) {
        mediaUrl = previewUrl;
      }

      const item: WallpaperInventoryItem = {
        id,
        title,
        type,
        source: "steam",
        previewUrl,
        mediaUrl,
        ...(webEntryUrl !== null ? { webEntryUrl } : {}),
        filePath: resolvedMedia ?? scenePkgPath ?? resolvedPreview,
        dirPath: itemDir,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        orientation: classifyOrientation(
          dimensions?.width ?? null,
          dimensions?.height ?? null
        ),
        contentRating,
        ...(props.length > 0 ? { userProperties: props } : {}),
        ...(tags.length > 0 ? { tags } : {}),
        ...(schemeColor !== null ? { schemeColor } : {}),
        sceneLiveSupported,
        webLiveSupported: type === "web" && resolvedMedia !== null,
        ...(fileSize !== undefined ? { fileSize } : {}),
        ...(mtimeMs !== undefined ? { mtimeMs } : {})
      };

      out.push(item);
      itemsById.set(id, {
        item,
        allowedRoot: itemDir,
        mediaFile: resolvedMedia,
        previewFile: resolvedPreview,
        webRootDir: type === "web" ? itemDir : null,
        webEntryRelPath,
        scenePkgPath,
        sceneManifest
      });
    }
  }

  private async scanCustomDirectory(
    rootDir: string,
    out: WallpaperInventoryItem[],
    itemsById: Map<string, IndexedWallpaperEntry>,
    seenBySize: Map<number, Array<{ filePath: string; sha256: string | null }>>
  ): Promise<void> {
    interface CustomCandidate {
      fullPath: string;
      fileName: string;
      ext: string;
      fileSize: number | undefined;
      mtimeMs: number | undefined;
    }

    let realRootDir: string | undefined;
    try {
      realRootDir = await NodeFSP.realpath(rootDir);
    } catch {
      realRootDir = undefined;
    }

    const candidates: CustomCandidate[] = [];
    const stack: string[] = [rootDir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      let entries;
      try {
        entries = await NodeFSP.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const dirent of entries) {
        if (dirent.name.startsWith(".")) {
          continue;
        }
        const fullPath = join(current, dirent.name);
        if (dirent.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!dirent.isFile()) {
          continue;
        }
        const ext = extname(dirent.name).toLowerCase();
        if (!ALLOWED_IMPORT_EXTENSIONS.has(ext)) {
          continue;
        }
        if (!(await isPathStrictlyInsideDirAsync(fullPath, rootDir, realRootDir))) {
          continue;
        }

        let fileSize: number | undefined;
        let mtimeMs: number | undefined;
        try {
          const st = await NodeFSP.stat(fullPath);
          fileSize = st.size;
          mtimeMs = st.mtimeMs;
        } catch {
          // ignore
        }

        candidates.push({
          fullPath,
          fileName: dirent.name,
          ext,
          fileSize,
          mtimeMs
        });
      }
    }

    // Prefer canonical shortest filenames (without -1/-2 suffix) before deduplicating byte-identical files
    candidates.sort((a, b) => compareCanonicalFilePath(a.fullPath, b.fullPath));

    for (const candidate of candidates) {
      const { fullPath, fileName, ext, fileSize, mtimeMs } = candidate;

      if (fileSize !== undefined) {
        const bucket = seenBySize.get(fileSize);
        if (!bucket) {
          seenBySize.set(fileSize, [{ filePath: fullPath, sha256: null }]);
        } else {
          let candidateSha: string | null = null;
          try {
            candidateSha = await computeFileSha256Async(fullPath);
          } catch {
            candidateSha = null;
          }
          if (candidateSha !== null) {
            let isDuplicate = false;
            for (const existing of bucket) {
              if (existing.sha256 === null) {
                try {
                  existing.sha256 = await computeFileSha256Async(existing.filePath);
                } catch {
                  existing.sha256 = "";
                }
              }
              if (existing.sha256 === candidateSha) {
                isDuplicate = true;
                break;
              }
            }
            if (isDuplicate) {
              continue;
            }
            bucket.push({ filePath: fullPath, sha256: candidateSha });
          }
        }
      }

      const isVideo = ALLOWED_VIDEO_EXTENSIONS.has(ext);
      const type: WallpaperMediaType = isVideo ? "video" : "image";
      const idHash = createHash("sha256")
        .update(resolve(fullPath).toLowerCase())
        .digest("hex")
        .slice(0, 10);
      const rawSlug = basename(fileName, ext)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);
      const id = `custom-${rawSlug || "media"}-${idHash}`;
      if (itemsById.has(id)) {
        continue;
      }

      const dimensions = isVideo
        ? await readVideoDimensionsAsync(fullPath)
        : await readImageDimensionsAsync(fullPath);
      const encodedId = encodeURIComponent(id);
      const mediaUrl = `/v1/wallpapers/media/${encodedId}`;
      const previewUrl = isVideo ? null : `/v1/wallpapers/preview/${encodedId}`;

      const item: WallpaperInventoryItem = {
        id,
        title: basename(fileName, ext),
        type,
        source: "custom",
        previewUrl,
        mediaUrl,
        filePath: fullPath,
        dirPath: dirname(fullPath),
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        orientation: classifyOrientation(
          dimensions?.width ?? null,
          dimensions?.height ?? null
        ),
        contentRating: "everyone",
        sceneLiveSupported: false,
        webLiveSupported: false,
        ...(fileSize !== undefined ? { fileSize } : {}),
        ...(mtimeMs !== undefined ? { mtimeMs } : {})
      };

      out.push(item);
      itemsById.set(id, {
        item,
        allowedRoot: rootDir,
        mediaFile: fullPath,
        previewFile: isVideo ? null : fullPath,
        webRootDir: null,
        webEntryRelPath: null,
        scenePkgPath: null,
        sceneManifest: null
      });
    }
  }

  private streamValidatedFileSlice(
    filePath: string,
    allowedRoot: string,
    sliceStart: number,
    sliceLength: number,
    contentType: string,
    req: IncomingMessage,
    res: ServerResponse,
    cacheControl: string
  ): void {
    if (!isPathStrictlyInsideDir(filePath, allowedRoot)) {
      this.writeError(res, 403, "PATH_TRAVERSAL_BLOCKED", "File is outside allowed directory.");
      return;
    }

    let stats;
    try {
      stats = statSync(filePath);
    } catch {
      this.writeError(res, 404, "FILE_NOT_FOUND", "Scene package file missing.");
      return;
    }

    if (
      !stats.isFile() ||
      sliceStart < 0 ||
      sliceLength < 0 ||
      sliceStart + sliceLength > stats.size
    ) {
      this.writeError(res, 404, "ASSET_OUT_OF_RANGE", "Scene asset byte range is invalid.");
      return;
    }

    const totalSize = sliceLength;
    const etag = `"${sliceStart.toString(16)}-${totalSize.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
    const parsedRange = parseByteRangeHeader(req.headers.range, totalSize);

    if (!parsedRange.ok) {
      res.writeHead(416, {
        "accept-ranges": "bytes",
        "content-range": `bytes */${totalSize}`,
        "cache-control": cacheControl,
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin"
      });
      res.end();
      return;
    }

    const commonHeaders: Record<string, string> = {
      "accept-ranges": "bytes",
      "content-type": contentType,
      "cache-control": cacheControl,
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
      etag
    };

    if (req.method?.toUpperCase() === "HEAD") {
      if (parsedRange.isPartial) {
        const chunkLength = parsedRange.end - parsedRange.start + 1;
        res.writeHead(206, {
          ...commonHeaders,
          "content-range": `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`,
          "content-length": String(chunkLength)
        });
      } else {
        res.writeHead(200, {
          ...commonHeaders,
          "content-length": String(totalSize)
        });
      }
      res.end();
      return;
    }

    if (totalSize === 0) {
      res.writeHead(200, {
        ...commonHeaders,
        "content-length": "0"
      });
      res.end();
      return;
    }

    const chunkLength = parsedRange.end - parsedRange.start + 1;
    if (parsedRange.isPartial) {
      res.writeHead(206, {
        ...commonHeaders,
        "content-range": `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`,
        "content-length": String(chunkLength)
      });
    } else {
      res.writeHead(200, {
        ...commonHeaders,
        "content-length": String(totalSize)
      });
    }

    const stream = createReadStream(filePath, {
      start: sliceStart + parsedRange.start,
      end: sliceStart + parsedRange.end,
      highWaterMark: Math.min(256 * 1024, DEFAULT_CHUNK_BYTES)
    });

    const cleanup = () => {
      if (!stream.destroyed) {
        stream.destroy();
      }
    };

    req.once("close", cleanup);
    res.once("close", cleanup);
    stream.once("error", () => {
      if (!res.headersSent) {
        this.writeError(res, 500, "STREAM_READ_FAILED", "Failed to read scene asset stream.");
      } else if (!res.writableEnded) {
        res.destroy();
      }
    });
    stream.pipe(res);
  }

  private streamValidatedFile(
    filePath: string,
    allowedRoot: string,
    req: IncomingMessage,
    res: ServerResponse,
    cacheControl: string
  ): void {
    if (!isPathStrictlyInsideDir(filePath, allowedRoot)) {
      this.writeError(res, 403, "PATH_TRAVERSAL_BLOCKED", "File is outside allowed directory.");
      return;
    }

    let stats;
    try {
      stats = statSync(filePath);
    } catch {
      this.writeError(res, 404, "FILE_NOT_FOUND", "Wallpaper media file missing.");
      return;
    }

    if (!stats.isFile()) {
      this.writeError(res, 404, "NOT_A_FILE", "Target media is not a regular file.");
      return;
    }

    const totalSize = stats.size;
    const contentType = getMimeTypeForFile(filePath);
    const etag = `"${totalSize.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
    const rangeHeader = req.headers.range;
    const parsedRange = parseByteRangeHeader(rangeHeader, totalSize);

    if (!parsedRange.ok) {
      res.writeHead(416, {
        "accept-ranges": "bytes",
        "content-range": `bytes */${totalSize}`,
        "cache-control": cacheControl,
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin"
      });
      res.end();
      return;
    }

    const commonHeaders: Record<string, string> = {
      "accept-ranges": "bytes",
      "content-type": contentType,
      "cache-control": cacheControl,
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
      etag
    };

    if (req.method?.toUpperCase() === "HEAD") {
      if (parsedRange.isPartial) {
        const chunkLength = parsedRange.end - parsedRange.start + 1;
        res.writeHead(206, {
          ...commonHeaders,
          "content-range": `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`,
          "content-length": String(chunkLength)
        });
      } else {
        res.writeHead(200, {
          ...commonHeaders,
          "content-length": String(totalSize)
        });
      }
      res.end();
      return;
    }

    if (totalSize === 0) {
      res.writeHead(200, {
        ...commonHeaders,
        "content-length": "0"
      });
      res.end();
      return;
    }

    const chunkLength = parsedRange.end - parsedRange.start + 1;
    if (parsedRange.isPartial) {
      res.writeHead(206, {
        ...commonHeaders,
        "content-range": `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`,
        "content-length": String(chunkLength)
      });
    } else {
      res.writeHead(200, {
        ...commonHeaders,
        "content-length": String(totalSize)
      });
    }

    const stream = createReadStream(filePath, {
      start: parsedRange.start,
      end: parsedRange.end,
      highWaterMark: Math.min(256 * 1024, DEFAULT_CHUNK_BYTES)
    });

    const cleanup = () => {
      if (!stream.destroyed) {
        stream.destroy();
      }
    };

    req.once("close", cleanup);
    res.once("close", cleanup);
    stream.once("error", () => {
      if (!res.headersSent) {
        this.writeError(res, 500, "STREAM_READ_FAILED", "Failed to read media stream.");
      } else if (!res.writableEnded) {
        res.destroy();
      }
    });
    stream.pipe(res);
  }

  private atomicCopyFile(srcPath: string, destPath: string): void {
    const dir = dirname(destPath);
    mkdirSync(dir, { recursive: true });
    const tmpPath = join(
      dir,
      `.tmp-${basename(destPath)}-${process.pid}-${randomUUID()}`
    );
    try {
      copyFileSync(srcPath, tmpPath);
      renameSync(tmpPath, destPath);
    } catch (err) {
      try {
        rmSync(tmpPath, { force: true });
      } catch {
        // ignore cleanup failure
      }
      throw err;
    }
  }

  private atomicWriteBytes(destPath: string, bytes: Uint8Array): void {
    const dir = dirname(destPath);
    mkdirSync(dir, { recursive: true });
    const tmpPath = join(
      dir,
      `.tmp-${basename(destPath)}-${process.pid}-${randomUUID()}`
    );
    try {
      writeFileSync(tmpPath, bytes);
      renameSync(tmpPath, destPath);
    } catch (err) {
      try {
        rmSync(tmpPath, { force: true });
      } catch {
        // ignore cleanup failure
      }
      throw err;
    }
  }

  private writeError(
    res: ServerResponse,
    statusCode: number,
    code: string,
    message: string
  ): void {
    const body = `${JSON.stringify({ ok: false, error: { code, message } })}\n`;
    res.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(Buffer.byteLength(body, "utf8"))
    });
    res.end(body);
  }
}
