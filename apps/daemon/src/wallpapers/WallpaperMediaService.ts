import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
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
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import { promisify } from "node:util";

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
  steamRootsDiscoverer?: () => Promise<string[]>;
}

interface IndexedWallpaperEntry {
  item: WallpaperInventoryItem;
  allowedRoot: string;
  mediaFile: string | null;
  previewFile: string | null;
  webRootDir: string | null;
  webEntryRelPath: string | null;
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
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".glsl": "text/plain; charset=utf-8",
  ".frag": "text/plain; charset=utf-8",
  ".vert": "text/plain; charset=utf-8"
};

export const BUILTIN_WEBWALLGL_WALLPAPERS: readonly WallpaperInventoryItem[] = [
  {
    id: "builtin-aurora-prism",
    title: "Aurora Prism · 极光棱镜",
    type: "scene",
    source: "builtin",
    previewUrl: null,
    mediaUrl: null,
    filePath: null,
    dirPath: null,
    width: null,
    height: null,
    orientation: "landscape",
    contentRating: "everyone",
    tags: ["builtin", "WebWallGL", "aurora"],
    schemeColor: "#5e9bff",
    builtinSceneId: "aurora-prism",
    sceneLiveSupported: true,
    webLiveSupported: false
  },
  {
    id: "builtin-midnight-tide",
    title: "Midnight Tide · 午夜潮汐",
    type: "scene",
    source: "builtin",
    previewUrl: null,
    mediaUrl: null,
    filePath: null,
    dirPath: null,
    width: null,
    height: null,
    orientation: "landscape",
    contentRating: "everyone",
    tags: ["builtin", "WebWallGL", "ocean"],
    schemeColor: "#38bdf8",
    builtinSceneId: "midnight-abyss",
    sceneLiveSupported: true,
    webLiveSupported: false
  },
  {
    id: "builtin-liquid-silk",
    title: "Liquid Silk · 液态丝绸",
    type: "scene",
    source: "builtin",
    previewUrl: null,
    mediaUrl: null,
    filePath: null,
    dirPath: null,
    width: null,
    height: null,
    orientation: "landscape",
    contentRating: "everyone",
    tags: ["builtin", "WebWallGL", "silk"],
    schemeColor: "#c084fc",
    builtinSceneId: "liquid-silk",
    sceneLiveSupported: true,
    webLiveSupported: false
  },
  {
    id: "builtin-cyber-dusk",
    title: "Cyber Dusk · 赛博暮光",
    type: "scene",
    source: "builtin",
    previewUrl: null,
    mediaUrl: null,
    filePath: null,
    dirPath: null,
    width: null,
    height: null,
    orientation: "landscape",
    contentRating: "everyone",
    tags: ["builtin", "WebWallGL", "cyber"],
    schemeColor: "#f472b6",
    builtinSceneId: "cyber-twilight",
    sceneLiveSupported: true,
    webLiveSupported: false
  }
];

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
    process.platform === "win32"
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
      process.platform === "win32" &&
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
      process.platform === "win32" ? normalized.toLowerCase() : normalized;
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
    const slice = buffer.subarray(0, bytesRead);

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
    if (ALLOWED_VIDEO_EXTENSIONS.has(ext)) {
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
  if (process.platform !== "win32") {
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
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) {
      return;
    }
    if (existsSync(resolved)) {
      seen.add(key);
      candidates.push(resolved);
    }
  };

  if (process.platform === "win32") {
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
  } else if (process.platform === "darwin") {
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
  private readonly steamRootsDiscoverer: () => Promise<string[]>;
  private readonly itemsById = new Map<string, IndexedWallpaperEntry>();
  private lastInventory: WallpaperInventorySnapshot | null = null;

  constructor(options: WallpaperServiceOptions) {
    this.customWallpaperDir = resolve(options.dataDir, "wallpapers");
    mkdirSync(this.customWallpaperDir, { recursive: true });
    this.customDirs = (options.customDirs ?? [])
      .map((dir) => dir.trim())
      .filter((dir) => dir.length > 0)
      .map((dir) => resolve(dir));
    this.steamRootOverride = (options.steamRootOverride ?? "").trim();
    this.steamRootsDiscoverer =
      options.steamRootsDiscoverer ?? discoverDefaultSteamRoots;
  }

  async getInventory(): Promise<WallpaperInventorySnapshot> {
    if (this.lastInventory !== null) {
      return this.lastInventory;
    }
    return this.rescan();
  }

  async rescan(request?: WallpaperRescanRequest): Promise<WallpaperInventorySnapshot> {
    if (request?.customDirs !== undefined) {
      this.customDirs = [...new Set(
        request.customDirs
          .map((d) => d.trim())
          .filter((d) => d.length > 0)
          .map((d) => resolve(d))
      )];
    }
    if (request?.steamRootOverride !== undefined) {
      this.steamRootOverride = request.steamRootOverride.trim();
    }

    mkdirSync(this.customWallpaperDir, { recursive: true });

    const steamRoots = await this.resolveAllSteamLibraryRoots();
    const workshopDirs = this.resolveWorkshopDirs(steamRoots);

    this.itemsById.clear();
    const collected: WallpaperInventoryItem[] = [];

    // 1. Built-in WebWallGL scenes
    for (const builtin of BUILTIN_WEBWALLGL_WALLPAPERS) {
      const copy: WallpaperInventoryItem = { ...builtin };
      collected.push(copy);
      this.itemsById.set(copy.id, {
        item: copy,
        allowedRoot: this.customWallpaperDir,
        mediaFile: null,
        previewFile: null,
        webRootDir: null,
        webEntryRelPath: null
      });
    }

    // 2. Steam Workshop 431960 items
    for (const workshopDir of workshopDirs) {
      this.scanWorkshopDirectory(workshopDir, collected);
    }

    // 3. Local managed custom wallpaper dir + extra user-configured customDirs
    const localScanDirs = [
      this.customWallpaperDir,
      ...this.customDirs.filter((d) => d !== this.customWallpaperDir)
    ];
    for (const dir of localScanDirs) {
      if (existsSync(dir)) {
        this.scanCustomDirectory(dir, collected);
      }
    }

    const snapshot: WallpaperInventorySnapshot = {
      schemaVersion: 1,
      scannedAt: Date.now(),
      customWallpaperDir: this.customWallpaperDir,
      customDirs: [...this.customDirs],
      steamRootOverride: this.steamRootOverride,
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

      const preferredName =
        typeof request.fileName === "string" && request.fileName.trim().length > 0
          ? sanitizeImportFileName(request.fileName)
          : sanitizeImportFileName(basename(resolvedSrc));
      const finalName = extname(preferredName).toLowerCase() === ext
        ? preferredName
        : `${preferredName}${ext}`;
      destPath = ensureUniqueDestPath(this.customWallpaperDir, finalName);

      this.atomicCopyFile(resolvedSrc, destPath);
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

      destPath = ensureUniqueDestPath(this.customWallpaperDir, safeName);
      this.atomicWriteBytes(destPath, bytes);
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

  async serveWebAsset(
    rawId: string,
    rawRelPath: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    if (hasRawTraversal(rawRelPath)) {
      this.writeError(res, 403, "PATH_TRAVERSAL_BLOCKED", "Path traversal is forbidden.");
      return;
    }

    const entry = await this.resolveIndexedEntry(rawId);
    if (!entry || !entry.webRootDir) {
      this.writeError(res, 404, "WEB_WALLPAPER_NOT_FOUND", "Web wallpaper not found.");
      return;
    }

    const requestedRel =
      rawRelPath.trim().length === 0
        ? (entry.webEntryRelPath ?? "index.html")
        : rawRelPath;

    const resolvedAsset = safeResolveInsideDir(entry.webRootDir, requestedRel);
    if (resolvedAsset === null) {
      this.writeError(res, 403, "PATH_TRAVERSAL_BLOCKED", "Asset path escapes wallpaper directory.");
      return;
    }

    if (!existsSync(resolvedAsset)) {
      this.writeError(res, 404, "ASSET_NOT_FOUND", "Web wallpaper asset not found.");
      return;
    }

    this.streamValidatedFile(resolvedAsset, entry.webRootDir, req, res, "no-cache");
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

  private async resolveAllSteamLibraryRoots(): Promise<string[]> {
    const roots: string[] = [];
    const seen = new Set<string>();

    const addRoot = (candidate: string) => {
      const normalized = resolve(candidate);
      const key =
        process.platform === "win32" ? normalized.toLowerCase() : normalized;
      if (!seen.has(key) && existsSync(normalized)) {
        seen.add(key);
        roots.push(normalized);
      }
    };

    const seedRoots: string[] = [];
    if (this.steamRootOverride.length > 0) {
      seedRoots.push(resolve(this.steamRootOverride));
    } else {
      seedRoots.push(...(await this.steamRootsDiscoverer()));
    }

    for (const seed of seedRoots) {
      addRoot(seed);
      const vdfCandidates = [
        join(seed, "steamapps", "libraryfolders.vdf"),
        join(seed, "config", "libraryfolders.vdf")
      ];
      for (const vdfPath of vdfCandidates) {
        if (existsSync(vdfPath)) {
          try {
            const vdfText = readFileSync(vdfPath, "utf8");
            for (const libRoot of parseLibraryFoldersVdf(vdfText)) {
              addRoot(libRoot);
            }
          } catch {
            // ignore unreadable vdf
          }
        }
      }
    }

    return roots;
  }

  private resolveWorkshopDirs(steamRoots: readonly string[]): string[] {
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
      if (!existsSync(candidate)) {
        continue;
      }
      const key =
        process.platform === "win32" ? candidate.toLowerCase() : candidate;
      if (!seen.has(key)) {
        seen.add(key);
        dirs.push(candidate);
      }
    }
    return dirs;
  }

  private scanWorkshopDirectory(
    workshopDir: string,
    out: WallpaperInventoryItem[]
  ): void {
    let entries;
    try {
      entries = readdirSync(workshopDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of entries) {
      if (!dirent.isDirectory()) {
        continue;
      }
      const itemDir = join(workshopDir, dirent.name);
      const projectJsonPath = join(itemDir, "project.json");
      if (!existsSync(projectJsonPath)) {
        continue;
      }

      const visibilityPath = join(itemDir, "visibility.json");
      if (existsSync(visibilityPath)) {
        try {
          const vis = JSON.parse(
            sanitizeJsonText(readFileSync(visibilityPath, "utf8"))
          ) as unknown;
          if (isPlainRecord(vis) && vis["hidden"] === true) {
            continue;
          }
        } catch {
          // ignore malformed visibility.json
        }
      }

      let project: unknown;
      try {
        project = JSON.parse(
          sanitizeJsonText(readFileSync(projectJsonPath, "utf8"))
        );
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
      if (this.itemsById.has(id)) {
        continue;
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

      const mediaFile = rawFile ? safeResolveInsideDir(itemDir, rawFile) : null;
      const previewFile = rawPreview
        ? safeResolveInsideDir(itemDir, rawPreview)
        : null;

      const resolvedMedia =
        mediaFile && existsSync(mediaFile) ? mediaFile : null;
      const resolvedPreview =
        previewFile && existsSync(previewFile) ? previewFile : null;

      const type = normalizeWallpaperType(project["type"], rawFile);
      const contentRating = normalizeContentRating(project["contentrating"]);
      const { props, schemeColor } = parseSteamUserProperties(project["general"]);
      const tags = Array.isArray(project["tags"])
        ? project["tags"].filter((t): t is string => typeof t === "string")
        : [];

      let dimensions: { width: number; height: number } | null = null;
      if (type === "image" && resolvedMedia) {
        dimensions = readImageDimensions(resolvedMedia);
      }
      if (!dimensions && resolvedPreview) {
        dimensions = readImageDimensions(resolvedPreview);
      }

      let fileSize: number | undefined;
      let mtimeMs: number | undefined;
      const statTarget = resolvedMedia ?? resolvedPreview;
      if (statTarget) {
        try {
          const st = statSync(statTarget);
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

      if (type === "web" && rawFile && resolvedMedia) {
        const rel = relative(itemDir, resolvedMedia).replace(/\\/g, "/");
        webEntryRelPath = rel;
        webEntryUrl = `/v1/wallpapers/web/${encodedId}/${encodeWebPathSegments(rel)}`;
        mediaUrl = webEntryUrl;
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
        filePath: resolvedMedia ?? resolvedPreview,
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
        sceneLiveSupported: false,
        webLiveSupported: type === "web" && resolvedMedia !== null,
        ...(fileSize !== undefined ? { fileSize } : {}),
        ...(mtimeMs !== undefined ? { mtimeMs } : {})
      };

      out.push(item);
      this.itemsById.set(id, {
        item,
        allowedRoot: itemDir,
        mediaFile: resolvedMedia,
        previewFile: resolvedPreview,
        webRootDir: type === "web" ? itemDir : null,
        webEntryRelPath
      });
    }
  }

  private scanCustomDirectory(
    rootDir: string,
    out: WallpaperInventoryItem[]
  ): void {
    const stack: string[] = [rootDir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      let entries;
      try {
        entries = readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));

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
        if (!isPathStrictlyInsideDir(fullPath, rootDir)) {
          continue;
        }

        const isVideo = ALLOWED_VIDEO_EXTENSIONS.has(ext);
        const type: WallpaperMediaType = isVideo ? "video" : "image";
        const idHash = createHash("sha256")
          .update(resolve(fullPath).toLowerCase())
          .digest("hex")
          .slice(0, 10);
        const rawSlug = basename(dirent.name, ext)
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 32);
        const id = `custom-${rawSlug || "media"}-${idHash}`;
        if (this.itemsById.has(id)) {
          continue;
        }

        const dimensions = isVideo ? null : readImageDimensions(fullPath);
        let fileSize: number | undefined;
        let mtimeMs: number | undefined;
        try {
          const st = statSync(fullPath);
          fileSize = st.size;
          mtimeMs = st.mtimeMs;
        } catch {
          // ignore
        }

        const encodedId = encodeURIComponent(id);
        const mediaUrl = `/v1/wallpapers/media/${encodedId}`;
        const previewUrl = isVideo ? null : `/v1/wallpapers/preview/${encodedId}`;

        const item: WallpaperInventoryItem = {
          id,
          title: basename(dirent.name, ext),
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
        this.itemsById.set(id, {
          item,
          allowedRoot: rootDir,
          mediaFile: fullPath,
          previewFile: isVideo ? null : fullPath,
          webRootDir: null,
          webEntryRelPath: null
        });
      }
    }
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
        "cache-control": cacheControl
      });
      res.end();
      return;
    }

    const commonHeaders: Record<string, string> = {
      "accept-ranges": "bytes",
      "content-type": contentType,
      "cache-control": cacheControl,
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
      highWaterMark: Math.min(64 * 1024, DEFAULT_CHUNK_BYTES)
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
