import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { copyFile, mkdir, open, readdir, readFile, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import {
  basename,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";
import type { Readable } from "node:stream";
import type {
  ContentRating,
  WallpaperItem,
  WallpaperOrientation,
  WallpaperType,
} from "../types.js";
import { parseUserPropDefs, schemeToCss } from "../userProps.js";

export const WALLPAPER_ENGINE_APP_ID = "431960";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov"]);
const CUSTOM_ALLOWED_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS]);
const WEB_EXTS = new Set([".html", ".htm", ".js"]);
const ALL_WE_VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"]);

const SLIDE_SWITCH_MS: Record<number, number> = {
  1: 60_000,
  2: 300_000,
  3: 600_000,
  4: 1_800_000,
  5: 3_600_000,
};

const SCAN_CHUNK = 24;
const SLIDE_MAX = 2000;
const SLIDE_MAX_DEPTH = 3;

const DEFAULT_STEAM_PROBE_DIRS = [
  "C:\\Program Files (x86)\\Steam",
  "C:\\Program Files\\Steam",
  "D:\\Steam",
  "D:\\SteamLibrary",
  "E:\\Steam",
  "E:\\SteamLibrary",
  "F:\\SteamLibrary",
];

// ── Path security fences (fail-closed) ──────────────────────────────────────

function hasRawTraversal(raw: string): boolean {
  if (!raw || raw.includes("\0")) return true;
  const segments = raw.replace(/\\/g, "/").split("/");
  return segments.some((seg) => seg === "..");
}

/**
 * Pure lexical containment check: returns true strictly when `targetPath` is
 * inside `baseDir` (and not equal to `baseDir` unless `allowSelf` is true).
 */
export function isPathInsideDir(baseDir: string, targetPath: string, allowSelf = false): boolean {
  if (!baseDir || !targetPath || baseDir.includes("\0") || targetPath.includes("\0")) {
    return false;
  }
  const absBase = resolve(baseDir);
  const absTarget = resolve(targetPath);
  const rel = relative(absBase, absTarget);
  if (rel === "") return allowSelf;
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  // Windows case-insensitive cross-drive protection
  if (/^[a-zA-Z]:/.test(rel)) return false;
  return true;
}

export interface SafeMediaPathResult {
  ok: boolean;
  resolvedPath?: string;
  root?: string;
  reason?: string;
}

/**
 * Fail-closed path validator for local media serving (Daemon / Electron custom protocol).
 * Rejects null bytes, raw `..` traversal, out-of-root absolute paths, and symlink escapes.
 */
export function resolveSafeMediaPath(
  allowedRoots: readonly string[],
  requestedPath: string,
): SafeMediaPathResult {
  if (typeof requestedPath !== "string" || !requestedPath.trim()) {
    return { ok: false, reason: "empty path" };
  }
  if (requestedPath.includes("\0")) {
    return { ok: false, reason: "null byte rejected" };
  }
  if (hasRawTraversal(requestedPath)) {
    return { ok: false, reason: "path traversal rejected" };
  }
  const normalizedRoots = allowedRoots
    .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    .map((r) => resolve(r));

  if (normalizedRoots.length === 0) {
    return { ok: false, reason: "no allowed roots configured" };
  }

  // If caller passed a relative path, try resolving against each root; if absolute, validate directly.
  const candidates: Array<{ root: string; candidate: string }> = [];
  if (isAbsolute(requestedPath)) {
    const abs = resolve(requestedPath);
    for (const root of normalizedRoots) {
      if (isPathInsideDir(root, abs, false)) {
        candidates.push({ root, candidate: abs });
      }
    }
  } else {
    for (const root of normalizedRoots) {
      const abs = resolve(root, requestedPath);
      if (isPathInsideDir(root, abs, false)) {
        candidates.push({ root, candidate: abs });
      }
    }
  }

  for (const { root, candidate } of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const realRoot = realpathSync(root);
      const realCandidate = realpathSync(candidate);
      if (isPathInsideDir(realRoot, realCandidate, false)) {
        return { ok: true, resolvedPath: realCandidate, root: realRoot };
      }
      return { ok: false, reason: "symlink escape rejected" };
    } catch {
      return { ok: false, reason: "failed to resolve realpath" };
    }
  }

  // Not found on disk, check whether lexically inside any root to distinguish 403 vs 404
  if (candidates.length > 0) {
    return { ok: false, reason: "not found" };
  }
  return { ok: false, reason: "path outside allowed roots" };
}

// ── MIME table & HTTP 206 Partial Content Range streaming ───────────────────

const MIME_MAP: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".m4v": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".apng": "image/apng",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
};

export function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

export type ParsedByteRange =
  | { ok: true; start: number; end: number; contentLength: number; contentRange: string }
  | { ok: false; status: 416; contentRange: string };

/**
 * RFC 9110 single byte-range parser supporting `bytes=A-B`, `bytes=A-`, and suffix `bytes=-S`.
 */
export function parseByteRange(rangeHeader: string, totalSize: number): ParsedByteRange {
  if (!Number.isFinite(totalSize) || totalSize <= 0) {
    return { ok: false, status: 416, contentRange: "bytes */0" };
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2])) {
    return { ok: false, status: 416, contentRange: `bytes */${totalSize}` };
  }

  let start: number;
  let end: number;

  if (match[1] && match[2]) {
    start = parseInt(match[1], 10);
    end = Math.min(parseInt(match[2], 10), totalSize - 1);
  } else if (match[1]) {
    start = parseInt(match[1], 10);
    end = totalSize - 1;
  } else {
    const suffix = parseInt(match[2]!, 10);
    if (suffix <= 0) {
      return { ok: false, status: 416, contentRange: `bytes */${totalSize}` };
    }
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    start >= totalSize ||
    start > end
  ) {
    return { ok: false, status: 416, contentRange: `bytes */${totalSize}` };
  }

  return {
    ok: true,
    start,
    end,
    contentLength: end - start + 1,
    contentRange: `bytes ${start}-${end}/${totalSize}`,
  };
}

export interface MediaRangeResponseDescriptor {
  status: 200 | 206 | 403 | 404 | 416;
  headers: Record<string, string>;
  resolvedPath?: string;
  start?: number;
  end?: number;
  totalSize?: number;
  openStream?: () => Readable;
}

/**
 * Pure descriptor helper for Electron `protocol.handle`, Fetch `Response`, or HTTP servers.
 */
export function prepareMediaRangeResponse(
  filePath: string,
  allowedRoots: readonly string[],
  rangeHeader?: string | null,
): MediaRangeResponseDescriptor {
  const safe = resolveSafeMediaPath(allowedRoots, filePath);
  if (!safe.ok || !safe.resolvedPath) {
    if (safe.reason === "not found") {
      return {
        status: 404,
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
      };
    }
    return {
      status: 403,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    };
  }

  const st = statSync(safe.resolvedPath);
  if (!st.isFile()) {
    return {
      status: 404,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    };
  }

  const totalSize = st.size;
  const contentType = getMimeType(safe.resolvedPath);
  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };

  if (rangeHeader && rangeHeader.trim()) {
    const parsed = parseByteRange(rangeHeader, totalSize);
    if (!parsed.ok) {
      return {
        status: 416,
        headers: {
          ...baseHeaders,
          "Content-Range": parsed.contentRange,
        },
        totalSize,
      };
    }
    const resolved = safe.resolvedPath;
    return {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": parsed.contentRange,
        "Content-Length": String(parsed.contentLength),
      },
      resolvedPath: resolved,
      start: parsed.start,
      end: parsed.end,
      totalSize,
      openStream: () => createReadStream(resolved, { start: parsed.start, end: parsed.end }),
    };
  }

  const resolved = safe.resolvedPath;
  return {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": String(totalSize),
    },
    resolvedPath: resolved,
    start: 0,
    end: Math.max(0, totalSize - 1),
    totalSize,
    openStream: () =>
      totalSize > 0
        ? createReadStream(resolved, { start: 0, end: totalSize - 1 })
        : createReadStream(resolved),
  };
}

/**
 * Stream a validated local media file over Node HTTP with full 206 Partial Content support
 * and automatic file-descriptor cleanup on disconnect/error.
 */
export function serveMediaFileWithRange(
  req: Pick<IncomingMessage, "method" | "headers">,
  res: ServerResponse,
  filePath: string,
  allowedRoots: readonly string[],
): void {
  const rangeHeader =
    typeof req.headers.range === "string" ? req.headers.range : undefined;
  const desc = prepareMediaRangeResponse(filePath, allowedRoots, rangeHeader);

  res.statusCode = desc.status;
  for (const [k, v] of Object.entries(desc.headers)) {
    res.setHeader(k, v);
  }

  if (desc.status === 403) {
    res.end("forbidden");
    return;
  }
  if (desc.status === 404) {
    res.end("not found");
    return;
  }
  if (desc.status === 416 || req.method === "HEAD" || !desc.openStream) {
    res.end();
    return;
  }

  const stream = desc.openStream();
  const cleanup = () => {
    if (!stream.destroyed) {
      try {
        stream.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }
  };
  stream.once("end", cleanup);
  stream.once("error", () => {
    cleanup();
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end("stream error");
    } else {
      try {
        res.destroy();
      } catch {
        // Ignore
      }
    }
  });
  res.once("close", cleanup);
  stream.pipe(res);
}

// ── Zero-dependency pure Buffer image dimension parser ──────────────────────

export interface ImageDimensions {
  width: number;
  height: number;
}

export function orientationFromDimensions(
  width: number | null,
  height: number | null,
): WallpaperOrientation {
  if (!width || !height || width <= 0 || height <= 0) return "unknown";
  if (width > height) return "landscape";
  if (height > width) return "portrait";
  return "square";
}

function parseImageDimensionsFromBuffer(buf: Buffer): ImageDimensions | null {
  if (buf.length < 16) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR width/height at offset 16..24
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width > 0 && height > 0) return { width, height };
  }

  // GIF: GIF87a / GIF89a, width/height LE at 6..10
  if (
    buf.length >= 10 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46
  ) {
    const width = buf.readUInt16LE(6);
    const height = buf.readUInt16LE(8);
    if (width > 0 && height > 0) return { width, height };
  }

  // BMP: 'BM', DIB header width/height at 18..26
  if (buf.length >= 26 && buf[0] === 0x42 && buf[1] === 0x4d) {
    const width = Math.abs(buf.readInt32LE(18));
    const height = Math.abs(buf.readInt32LE(22));
    if (width > 0 && height > 0) return { width, height };
  }

  // WebP: RIFF....WEBP
  if (
    buf.length >= 30 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X" && buf.length >= 30) {
      const w = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16));
      const h = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16));
      if (w > 0 && h > 0) return { width: w, height: h };
    }
    if (chunk === "VP8 " && buf.length >= 30) {
      const w = buf.readUInt16LE(26) & 0x3fff;
      const h = buf.readUInt16LE(28) & 0x3fff;
      if (w > 0 && h > 0) return { width: w, height: h };
    }
    if (chunk === "VP8L" && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      const w = (bits & 0x3fff) + 1;
      const h = ((bits >> 14) & 0x3fff) + 1;
      if (w > 0 && h > 0) return { width: w, height: h };
    }
  }

  // JPEG: FF D8 ... SOF0/SOF1/SOF2 marker
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buf[offset + 1]!;
      offset += 2;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > buf.length) break;
      const segLen = buf.readUInt16BE(offset);
      if (segLen < 2 || offset + segLen > buf.length) break;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (offset + 7 <= buf.length) {
          const height = buf.readUInt16BE(offset + 3);
          const width = buf.readUInt16BE(offset + 5);
          if (width > 0 && height > 0) return { width, height };
        }
        break;
      }
      offset += segLen;
    }
  }

  return null;
}

export async function readImageDimensions(filePath: string): Promise<ImageDimensions | null> {
  const ext = extname(filePath).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) return null;
  let handle;
  try {
    handle = await open(filePath, "r");
    const buf = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return parseImageDimensionsFromBuffer(buf.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

// ── Zero-dependency pure Buffer video dimension parser (MP4/MOV + WebM/MKV) ──

const VIDEO_HEAD_PROBE_BYTES = 128 * 1024;
const VIDEO_TAIL_PROBE_BYTES = 256 * 1024;
const MAX_MOOV_READ_BYTES = 2 * 1024 * 1024;

function parseMp4TkhdAt(
  buf: Buffer,
  payloadStart: number,
  payloadEnd: number,
): ImageDimensions | null {
  if (payloadStart + 84 > payloadEnd) return null;
  const version = buf[payloadStart]!;
  if (version !== 0 && version !== 1) return null;
  const matrixOff = payloadStart + (version === 1 ? 52 : 40);
  const dimOff = payloadStart + (version === 1 ? 88 : 76);
  if (dimOff + 8 > payloadEnd) return null;
  const rawWidth = Math.round(buf.readUInt32BE(dimOff) / 65536);
  const rawHeight = Math.round(buf.readUInt32BE(dimOff + 4) / 65536);
  if (rawWidth < 16 || rawHeight < 16 || rawWidth > 16_384 || rawHeight > 16_384) {
    return null;
  }
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
  depth = 0,
): ImageDimensions | null {
  if (depth > 6) return null;
  let best: ImageDimensions | null = null;
  let offset = start;
  while (offset + 8 <= end) {
    let boxSize = buf.readUInt32BE(offset);
    const boxType = buf.subarray(offset + 4, offset + 8).toString("ascii");
    let headerSize = 8;
    if (boxSize === 1) {
      if (offset + 16 > end) break;
      boxSize = buf.readUInt32BE(offset + 8) * 0x100000000 + buf.readUInt32BE(offset + 12);
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = end - offset;
    }
    if (!Number.isFinite(boxSize) || boxSize < headerSize) break;
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

function scanBufferForTkhd(buf: Buffer): ImageDimensions | null {
  let best: ImageDimensions | null = null;
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
  maskLengthBit: boolean,
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

function parseEbmlVideoDimensions(buf: Buffer): ImageDimensions | null {
  if (
    buf.length < 32 ||
    buf[0] !== 0x1a ||
    buf[1] !== 0x45 ||
    buf[2] !== 0xdf ||
    buf[3] !== 0xa3
  ) {
    return null;
  }

  const CONTAINER_IDS = new Set([0x18538067, 0x1654ae6b, 0xae, 0xe0]);
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
      const isUnknownSize =
        size.length <= 4 && size.value === (1 << (7 * size.length)) - 1;
      const dataEnd = isUnknownSize ? end : Math.min(end, offset + size.value);
      if (dataEnd < offset) break;

      if (CONTAINER_IDS.has(id.value)) {
        if (walk(offset, dataEnd, inVideo || id.value === 0xe0, depth + 1)) {
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
            if (width !== null && height !== null) return true;
          }
        }
      }

      if (dataEnd <= offset) break;
      offset = dataEnd;
    }
    return false;
  };

  walk(0, buf.length, false, 0);
  return width !== null && height !== null ? { width, height } : null;
}

export async function readVideoDimensions(filePath: string): Promise<ImageDimensions | null> {
  const ext = extname(filePath).toLowerCase();
  if (!ALL_WE_VIDEO_EXTS.has(ext)) return null;
  let handle;
  try {
    const st = await stat(filePath);
    if (!st.isFile() || st.size < 16) return null;
    const fileSize = st.size;
    handle = await open(filePath, "r");

    const headLen = Math.min(fileSize, VIDEO_HEAD_PROBE_BYTES);
    const headBuf = Buffer.allocUnsafe(headLen);
    const { bytesRead: headRead } = await handle.read(headBuf, 0, headLen, 0);
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
    if (fromHead) return fromHead;

    if (fileSize > headLen) {
      const hdr = Buffer.allocUnsafe(16);
      let pos = 0;
      for (let i = 0; i < 64 && pos + 8 <= fileSize; i += 1) {
        const { bytesRead: got } = await handle.read(hdr, 0, Math.min(16, fileSize - pos), pos);
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
          const { bytesRead: moovGot } = await handle.read(moovBuf, 0, readLen, pos);
          const moovSlice = moovBuf.subarray(0, moovGot);
          const fromMoov =
            parseMp4BoxesForDimensions(moovSlice, 0, moovSlice.length) ??
            scanBufferForTkhd(moovSlice);
          if (fromMoov) return fromMoov;
          break;
        }
        if (pos + boxSize <= pos) break;
        pos += boxSize;
      }

      const tailLen = Math.min(fileSize, VIDEO_TAIL_PROBE_BYTES);
      const tailOffset = Math.max(0, fileSize - tailLen);
      const tailBuf = Buffer.allocUnsafe(tailLen);
      const { bytesRead: tailGot } = await handle.read(tailBuf, 0, tailLen, tailOffset);
      return scanBufferForTkhd(tailBuf.subarray(0, tailGot));
    }

    return null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

// ── Steam Discovery & libraryfolders.vdf Parser ─────────────────────────────

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Parse Valve KeyValues `steamapps/libraryfolders.vdf` to discover all Steam library paths across drives.
 * When `filterAppId` is provided (e.g. "431960"), libraries explicitly listing that appId are returned first,
 * and if `includeAllLibraries` is true (default), all declared library paths are also included so workshop folders
 * on other drives are never missed.
 */
export function parseLibraryFoldersVdf(
  vdfContent: string,
  options: { filterAppId?: string; includeAllLibraries?: boolean } = {},
): string[] {
  const filterAppId = options.filterAppId ?? WALLPAPER_ENGINE_APP_ID;
  const includeAll = options.includeAllLibraries ?? true;
  const matchingLibs: string[] = [];
  const allLibs: string[] = [];

  let currentPath: string | null = null;
  let inAppsBlock = false;
  let braceDepth = 0;
  let appsDepth = -1;

  for (const rawLine of vdfContent.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;

    if (line === "{") {
      braceDepth++;
      continue;
    }
    if (line === "}") {
      if (inAppsBlock && braceDepth === appsDepth) {
        inAppsBlock = false;
        appsDepth = -1;
      }
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    const pathMatch = /^"path"\s+"([^"]+)"$/i.exec(line);
    if (pathMatch) {
      currentPath = normalize(pathMatch[1]!.replace(/\\\\/g, "\\"));
      if (currentPath && !allLibs.includes(currentPath)) {
        allLibs.push(currentPath);
      }
      continue;
    }

    // Legacy numeric format: "1" "D:\\SteamLibrary"
    const legacyMatch = /^"\d+"\s+"([A-Za-z]:\\[^"]+|\/[^"]+)"$/.exec(line);
    if (legacyMatch) {
      currentPath = normalize(legacyMatch[1]!.replace(/\\\\/g, "\\"));
      if (currentPath && !allLibs.includes(currentPath)) {
        allLibs.push(currentPath);
      }
      continue;
    }

    if (/^"apps"$/i.test(line)) {
      inAppsBlock = true;
      appsDepth = braceDepth + 1;
      continue;
    }

    if (currentPath && filterAppId && (inAppsBlock || line.includes(`"${filterAppId}"`))) {
      const appMatch = new RegExp(`^"${filterAppId}"\\s+"[^"]*"$`).exec(line);
      if (appMatch && !matchingLibs.includes(currentPath)) {
        matchingLibs.push(currentPath);
      }
    }
  }

  if (!includeAll) return matchingLibs;
  const merged = [...matchingLibs];
  for (const lib of allLibs) {
    if (!merged.includes(lib)) merged.push(lib);
  }
  return merged;
}

function querySteamPathFromWindowsRegistry(): Promise<string | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  const regExe = join(process.env.SystemRoot || "C:\\Windows", "System32", "reg.exe");
  return new Promise((resolvePromise) => {
    try {
      execFile(
        regExe,
        ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"],
        { encoding: "utf8", windowsHide: true, timeout: 4000 },
        (err, stdout) => {
          if (err || !stdout) {
            resolvePromise(null);
            return;
          }
          const match = /SteamPath\s+REG_SZ\s+(.+)/i.exec(stdout);
          resolvePromise(match ? normalize(match[1]!.trim()) : null);
        },
      );
    } catch {
      resolvePromise(null);
    }
  });
}

export interface SteamDiscoveryOptions {
  steamRootOverride?: string;
  probeDirs?: readonly string[];
  queryRegistry?: boolean;
}

export async function discoverSteamLibraryDirs(
  opts: SteamDiscoveryOptions = {},
): Promise<string[]> {
  const candidates: string[] = [];

  if (opts.steamRootOverride && opts.steamRootOverride.trim()) {
    for (const part of opts.steamRootOverride.split(/[,;]/)) {
      const trimmed = part.trim();
      if (trimmed) candidates.push(normalize(trimmed));
    }
  }

  const envRaw = process.env.PRISMUX_STEAM_ROOT || process.env.DSH_WE_STEAM_ROOT || "";
  if (envRaw.trim()) {
    for (const part of envRaw.split(/[,;]/)) {
      const trimmed = part.trim();
      if (trimmed) candidates.push(normalize(trimmed));
    }
  }

  if (opts.queryRegistry !== false) {
    const regRoot = await querySteamPathFromWindowsRegistry();
    if (regRoot) candidates.push(regRoot);
  }

  const probes = opts.probeDirs ?? DEFAULT_STEAM_PROBE_DIRS;
  for (const p of probes) {
    candidates.push(normalize(p));
  }

  const discovered: string[] = [];
  const seen = new Set<string>();
  const addLib = (dir: string) => {
    const norm = normalize(dir);
    const key = process.platform === "win32" ? norm.toLowerCase() : norm;
    if (!seen.has(key)) {
      seen.add(key);
      discovered.push(norm);
    }
  };

  for (const root of candidates) {
    const vdfPath = join(root, "steamapps", "libraryfolders.vdf");
    if (await isFile(vdfPath)) {
      addLib(root);
      try {
        const text = await readFile(vdfPath, "utf8");
        const vdfLibs = parseLibraryFoldersVdf(text, {
          filterAppId: WALLPAPER_ENGINE_APP_ID,
          includeAllLibraries: true,
        });
        for (const lib of vdfLibs) {
          if (await pathExists(lib)) addLib(lib);
        }
      } catch {
        // Ignore malformed VDF
      }
    } else if (await isDirectory(join(root, "steamapps", "workshop", "content", WALLPAPER_ENGINE_APP_ID))) {
      addLib(root);
    } else if (await isDirectory(root) && opts.steamRootOverride) {
      // Allow pointing directly at a workshop/content/431960 directory or library root
      addLib(root);
    }
  }

  return discovered;
}

// ── Steam Workshop 431960 Scanner ───────────────────────────────────────────

function inferWallpaperType(file: string): WallpaperType {
  const ext = extname(file).toLowerCase();
  if (ALL_WE_VIDEO_EXTS.has(ext)) return "video";
  if (WEB_EXTS.has(ext)) return "web";
  if (IMAGE_EXTS.has(ext)) return "image";
  return "scene";
}

function normalizeContentRating(raw: unknown): ContentRating {
  if (typeof raw !== "string" || !raw.trim()) return "unrated";
  const lower = raw.trim().toLowerCase();
  if (lower === "everyone" || lower === "g" || lower === "general") return "everyone";
  if (lower === "questionable" || lower === "pg13" || lower === "pg-13" || lower === "teen") {
    return "pg13";
  }
  if (lower === "mature" || lower === "r" || lower === "adult" || lower === "nsfw") {
    return "mature";
  }
  return "unrated";
}

async function listImagesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string, prefix: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= SLIDE_MAX) return;
      if (entry.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (depth >= SLIDE_MAX_DEPTH) continue;
        await walk(join(current, entry.name), rel, depth + 1);
      } else if (IMAGE_EXTS.has(extname(entry.name).toLowerCase())) {
        out.push(rel);
      }
    }
  }
  await walk(dir, "", 0);
  out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return out;
}

async function resolveSceneMainFile(dir: string, declared: string | null): Promise<string | null> {
  for (const candidate of [declared, "scene.pkg", "scene.json"]) {
    if (!candidate) continue;
    const abs = resolve(dir, candidate);
    if (!isPathInsideDir(dir, abs, false)) continue;
    if (await isFile(abs)) return candidate;
  }
  try {
    const pkgs = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith(".pkg"));
    return pkgs.length === 1 ? pkgs[0]! : null;
  } catch {
    return null;
  }
}

async function readHiddenEntryNames(root: string): Promise<Set<string>> {
  const out = new Set<string>();
  let text: string;
  try {
    text = await readFile(join(root, "visibility.json"), "utf8");
  } catch {
    return out;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return out;
  }
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (value === false) {
        const strKey = String(key);
        out.add(strKey);
        out.add(strKey.replace(/\\/g, "/"));
        const tail = strKey.split(/[\\/]/).pop();
        if (tail) out.add(tail);
      } else if (value && typeof value === "object") {
        walk(value);
      }
    }
  };
  walk(parsed);
  return out;
}

export interface ScanSteamOptions extends SteamDiscoveryOptions {
  /** Optional explicit URL builder for media/preview paths (e.g. `(abs) => '/api/media?p=' + encodeURIComponent(abs)`). */
  toMediaUrl?: (absPath: string) => string;
}

export interface ScanSteamResult {
  wallpapers: WallpaperItem[];
  libraryDirs: string[];
  workshopRoots: string[];
}

async function parseWorkshopProjectDir(
  dir: string,
  toMediaUrl?: (absPath: string) => string,
): Promise<WallpaperItem | null> {
  const pjPath = join(dir, "project.json");
  if (!(await isFile(pjPath))) return null;

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(await readFile(pjPath, "utf8"));
  } catch {
    return null;
  }
  if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson)) return null;
  const o = rawJson as Record<string, unknown>;

  const declared = typeof o.type === "string" ? o.type.trim().toLowerCase() : "";
  let fileRel = typeof o.file === "string" && o.file.trim() !== "" ? o.file.trim() : null;
  let type: WallpaperType;
  let slides: string[] = [];
  let slideIntervalMs: number | null = null;

  if (fileRel) {
    const validKinds: WallpaperType[] = ["scene", "web", "video", "image"];
    type = validKinds.includes(declared as WallpaperType)
      ? (declared as WallpaperType)
      : inferWallpaperType(fileRel);
    if (type === "image") slides = [fileRel];
  } else {
    // Picture / slideshow preset project
    const preset = o.preset && typeof o.preset === "object" ? (o.preset as Record<string, unknown>) : null;
    if (!preset) return null;
    const mode = Number(preset.wallpapermode);
    const customDir = typeof preset.customdirectory === "string" ? preset.customdirectory.trim() : "";
    const singleImg = typeof preset.image === "string" ? preset.image.trim() : "";
    if (customDir && (mode === 1 || mode === 2)) {
      const targetDir = resolve(dir, customDir);
      if (!isPathInsideDir(dir, targetDir, true)) return null;
      const prefix = customDir.replace(/\\/g, "/").replace(/\/+$/, "");
      for (const name of await listImagesRecursive(targetDir)) {
        slides.push(prefix ? `${prefix}/${name}` : name);
      }
    } else if (singleImg && IMAGE_EXTS.has(extname(singleImg).toLowerCase())) {
      const singleAbs = resolve(dir, singleImg);
      if (!isPathInsideDir(dir, singleAbs, false)) return null;
      if (await isFile(singleAbs)) slides.push(singleImg);
    }
    if (!slides.length) return null;
    fileRel = slides[0]!;
    type = "image";
    const interval = Number(preset.imageswitchtimes);
    slideIntervalMs = SLIDE_SWITCH_MS[interval] ?? null;
  }

  // Strict security containment check on `file` (reject traversal & out-of-project escapes)
  const declaredSafe =
    typeof fileRel === "string" &&
    !hasRawTraversal(fileRel) &&
    isPathInsideDir(dir, resolve(dir, fileRel), false);

  const resolvedRel =
    type === "scene"
      ? await resolveSceneMainFile(dir, declaredSafe ? fileRel : null)
      : declaredSafe
        ? fileRel
        : null;

  if (!resolvedRel) return null;
  const fileAbs = resolve(dir, resolvedRel);
  if (!isPathInsideDir(dir, fileAbs, false)) return null;

  // Verify realpath containment when file exists on disk
  try {
    const [realDir, realFile] = await Promise.all([realpath(dir), realpath(fileAbs)]);
    if (!isPathInsideDir(realDir, realFile, false)) return null;
  } catch {
    if (type !== "scene") return null;
  }

  // Filter slides against containment
  if (slides.length) {
    slides = slides.filter(
      (s) => !hasRawTraversal(s) && isPathInsideDir(dir, resolve(dir, s), false),
    );
  }

  // Validate preview path separately: out-of-bounds preview -> null (keep wallpaper)
  const previewDecl =
    typeof o.preview === "string" && o.preview.trim() !== ""
      ? o.preview.trim()
      : type === "image"
        ? resolvedRel
        : null;

  let previewAbs: string | null = null;
  if (previewDecl && !hasRawTraversal(previewDecl)) {
    const candidate = resolve(dir, previewDecl);
    if (isPathInsideDir(dir, candidate, false) && (await isFile(candidate))) {
      try {
        const [realDir, realPrev] = await Promise.all([realpath(dir), realpath(candidate)]);
        if (isPathInsideDir(realDir, realPrev, false)) {
          previewAbs = realPrev;
        }
      } catch {
        previewAbs = null;
      }
    }
  }

  // Extract dimensions from true video/image header before falling back to preview image
  let dims: ImageDimensions | null = null;
  if (type === "video") {
    dims = await readVideoDimensions(fileAbs);
  } else if (type === "image") {
    dims = await readImageDimensions(fileAbs);
  }
  if (!dims && previewAbs) {
    dims = await readImageDimensions(previewAbs);
  }

  let fileSize: number | undefined;
  let mtimeMs: number | undefined;
  try {
    const st = await stat(fileAbs);
    fileSize = st.size;
    mtimeMs = st.mtimeMs;
  } catch {
    // Ignore stat errors
  }

  const general = o.general && typeof o.general === "object" ? (o.general as Record<string, unknown>) : null;
  const propsObj =
    general?.properties && typeof general.properties === "object"
      ? (general.properties as Record<string, unknown>)
      : null;
  const schemeRaw =
    propsObj?.schemecolor && typeof propsObj.schemecolor === "object"
      ? (propsObj.schemecolor as Record<string, unknown>).value
      : null;

  const userProperties = parseUserPropDefs(o);
  const tags = Array.isArray(o.tags)
    ? o.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : undefined;

  const id = `steam:${basename(dir)}`;
  const title = typeof o.title === "string" && o.title.trim() ? o.title.trim() : basename(dir);

  return {
    id,
    title,
    type,
    source: "steam",
    previewUrl: previewAbs ? (toMediaUrl ? toMediaUrl(previewAbs) : previewAbs) : null,
    mediaUrl: toMediaUrl ? toMediaUrl(fileAbs) : fileAbs,
    filePath: fileAbs,
    dirPath: dir,
    width: dims ? dims.width : null,
    height: dims ? dims.height : null,
    orientation: orientationFromDimensions(dims ? dims.width : null, dims ? dims.height : null),
    contentRating: normalizeContentRating(o.contentrating),
    userProperties: userProperties.length > 0 ? userProperties : undefined,
    tags,
    schemeColor: schemeToCss(schemeRaw),
    slides: slides.length > 1 ? slides : undefined,
    slideIntervalMs,
    sceneLiveSupported: type === "scene",
    webLiveSupported: type === "web",
    fileSize,
    mtimeMs,
  };
}

/**
 * Scan Steam Workshop app 431960 (Wallpaper Engine) across all discovered Steam library drives.
 */
export async function scanSteamWorkshop431960(
  opts: ScanSteamOptions = {},
): Promise<ScanSteamResult> {
  const libraryDirs = await discoverSteamLibraryDirs(opts);
  const workshopRoots: string[] = [];

  for (const lib of libraryDirs) {
    const wsDir = join(lib, "steamapps", "workshop", "content", WALLPAPER_ENGINE_APP_ID);
    if (await isDirectory(wsDir)) {
      workshopRoots.push(wsDir);
    } else if (basename(lib) === WALLPAPER_ENGINE_APP_ID && (await isDirectory(lib))) {
      workshopRoots.push(lib);
    }
    // Also check WE defaultprojects / myprojects if installed under this library
    for (const sub of ["defaultprojects", "myprojects"]) {
      const projRoot = join(lib, "steamapps", "common", "wallpaper_engine", "projects", sub);
      if (await isDirectory(projRoot)) {
        workshopRoots.push(projRoot);
      }
    }
  }

  const projectDirs: string[] = [];
  for (const root of workshopRoots) {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    const hidden = await readHiddenEntryNames(root);
    for (const entry of entries) {
      if (hidden.has(entry) || hidden.has(entry.replace(/\\/g, "/"))) continue;
      const dir = join(root, entry);
      if (await isDirectory(dir)) {
        projectDirs.push(dir);
      }
    }
  }

  const found = new Map<string, WallpaperItem>();
  for (let i = 0; i < projectDirs.length; i += SCAN_CHUNK) {
    const chunk = projectDirs.slice(i, i + SCAN_CHUNK);
    const items = await Promise.all(
      chunk.map((dir) => parseWorkshopProjectDir(dir, opts.toMediaUrl)),
    );
    for (const item of items) {
      if (item && !found.has(item.id)) {
        found.set(item.id, item);
      }
    }
  }

  const wallpapers = [...found.values()].sort((a, b) => a.title.localeCompare(b.title));
  return { wallpapers, libraryDirs, workshopRoots };
}

// ── Local Custom Wallpaper Directory Scanner & Safe Importer ────────────────

export function getDefaultCustomWallpaperDir(): string {
  return join(homedir(), ".prismux", "wallpapers");
}

function stableCustomId(filePath: string): string {
  const hash = createHash("sha1").update(filePath.toLowerCase()).digest("hex").slice(0, 12);
  return `custom:${hash}`;
}

export interface ScanCustomOptions {
  toMediaUrl?: (absPath: string) => string;
}

export async function scanCustomWallpaperDir(
  dir: string = getDefaultCustomWallpaperDir(),
  opts: ScanCustomOptions = {},
): Promise<WallpaperItem[]> {
  if (!dir || !(await isDirectory(dir))) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const items: WallpaperItem[] = [];
  const absDir = resolve(dir);

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const ext = extname(entry.name).toLowerCase();
    if (!CUSTOM_ALLOWED_EXTS.has(ext)) continue;

    const absFile = resolve(absDir, entry.name);
    if (!isPathInsideDir(absDir, absFile, false)) continue;

    const type: WallpaperType = VIDEO_EXTS.has(ext) ? "video" : "image";
    const dims =
      type === "video"
        ? await readVideoDimensions(absFile)
        : await readImageDimensions(absFile);
    let fileSize: number | undefined;
    let mtimeMs: number | undefined;
    try {
      const st = await stat(absFile);
      fileSize = st.size;
      mtimeMs = st.mtimeMs;
    } catch {
      continue;
    }

    const mediaUrl = opts.toMediaUrl ? opts.toMediaUrl(absFile) : absFile;
    items.push({
      id: stableCustomId(absFile),
      title: basename(entry.name, ext),
      type,
      source: "custom",
      previewUrl: type === "image" ? mediaUrl : null,
      mediaUrl,
      filePath: absFile,
      dirPath: absDir,
      width: dims ? dims.width : null,
      height: dims ? dims.height : null,
      orientation: orientationFromDimensions(dims ? dims.width : null, dims ? dims.height : null),
      contentRating: "everyone",
      fileSize,
      mtimeMs,
    });
  }

  items.sort((a, b) => a.title.localeCompare(b.title));
  return items;
}

function sanitizeImportFilename(rawName: string): string {
  // Strip any directory components, null bytes, traversal tokens, and unsafe characters
  const leaf = basename(rawName.replace(/\\/g, "/"));
  const ext = extname(leaf).toLowerCase();
  const stem = basename(leaf, ext)
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "_")
    .replace(/\.+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  const safeStem = stem || "wallpaper";
  return `${safeStem}${ext}`;
}

export interface ImportLocalWallpaperOptions {
  targetName?: string;
  toMediaUrl?: (absPath: string) => string;
}

/**
 * Safely copy a user-selected image/video file into the Prismux custom wallpaper directory.
 * Enforces extension allowlist, strips path traversal characters, and verifies containment.
 */
export async function importLocalWallpaperFile(
  sourceFilePath: string,
  destDir: string = getDefaultCustomWallpaperDir(),
  opts: ImportLocalWallpaperOptions = {},
): Promise<WallpaperItem> {
  if (!sourceFilePath || sourceFilePath.includes("\0")) {
    throw new Error("Invalid source wallpaper path");
  }
  const absSrc = resolve(sourceFilePath);
  if (!(await isFile(absSrc))) {
    throw new Error(`Source file does not exist: ${absSrc}`);
  }

  const preferredName = opts.targetName || basename(absSrc);
  const safeName = sanitizeImportFilename(preferredName);
  const ext = extname(safeName).toLowerCase();
  if (!CUSTOM_ALLOWED_EXTS.has(ext)) {
    throw new Error(`Unsupported wallpaper file type: ${ext || "(none)"}`);
  }

  const absDestDir = resolve(destDir);
  await mkdir(absDestDir, { recursive: true });

  let destFile = resolve(absDestDir, safeName);
  if (await pathExists(destFile)) {
    const stem = basename(safeName, ext);
    const stamp = Date.now().toString(36);
    destFile = resolve(absDestDir, `${stem}-${stamp}${ext}`);
  }

  if (!isPathInsideDir(absDestDir, destFile, false)) {
    throw new Error("Destination path escaped target wallpaper directory");
  }

  await copyFile(absSrc, destFile);
  const type: WallpaperType = VIDEO_EXTS.has(ext) ? "video" : "image";
  const dims =
    type === "video"
      ? await readVideoDimensions(destFile)
      : await readImageDimensions(destFile);
  const st = await stat(destFile);
  const mediaUrl = opts.toMediaUrl ? opts.toMediaUrl(destFile) : destFile;

  return {
    id: stableCustomId(destFile),
    title: basename(destFile, ext),
    type,
    source: "custom",
    previewUrl: type === "image" ? mediaUrl : null,
    mediaUrl,
    filePath: destFile,
    dirPath: absDestDir,
    width: dims ? dims.width : null,
    height: dims ? dims.height : null,
    orientation: orientationFromDimensions(dims ? dims.width : null, dims ? dims.height : null),
    contentRating: "everyone",
    fileSize: st.size,
    mtimeMs: st.mtimeMs,
  };
}

export interface CombinedScanOptions extends ScanSteamOptions {
  customDir?: string;
}

export interface CombinedScanResult {
  wallpapers: WallpaperItem[];
  steamLibraryDirs: string[];
  workshopRoots: string[];
  customDir: string;
}

/**
 * Convenience aggregator combining Steam Workshop 431960 and Prismux custom local wallpapers.
 */
export async function scanAllLocalWallpapers(
  opts: CombinedScanOptions = {},
): Promise<CombinedScanResult> {
  const customDir = opts.customDir || getDefaultCustomWallpaperDir();
  const [steamRes, customItems] = await Promise.all([
    scanSteamWorkshop431960(opts),
    scanCustomWallpaperDir(customDir, { toMediaUrl: opts.toMediaUrl }),
  ]);
  return {
    wallpapers: [...customItems, ...steamRes.wallpapers],
    steamLibraryDirs: steamRes.libraryDirs,
    workshopRoots: steamRes.workshopRoots,
    customDir,
  };
}
