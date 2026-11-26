import * as NodeBuffer from "node:buffer";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const { Buffer } = NodeBuffer;
const { closeSync, openSync, readSync, statSync } = NodeFS;
const { extname } = NodePath;

export type SteamSceneAssetKind = "image" | "video" | "audio";

export interface SteamScenePkgEntry {
  name: string;
  normalizedName: string;
  offset: number;
  length: number;
}

export interface SteamSceneAssetSlice {
  index: number;
  entryName: string;
  kind: SteamSceneAssetKind;
  mimeType: string;
  byteStart: number;
  byteLength: number;
  width: number | null;
  height: number | null;
}

export interface SteamSceneLayer {
  name: string;
  assetIndex: number;
  kind: "image" | "video";
  originX: number;
  originY: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  angleZ: number;
  alpha: number;
  parallaxX: number;
  parallaxY: number;
  effects: string[];
}

export interface SteamSceneSound {
  name: string;
  assetIndex: number;
  mimeType: string;
}

export interface SteamScenePackageManifest {
  pkgPath: string;
  pkgMagic: string;
  pkgFileSize: number;
  pkgMtimeMs: number;
  orthoWidth: number;
  orthoHeight: number;
  width: number;
  height: number;
  hasVideo: boolean;
  layers: SteamSceneLayer[];
  sounds: SteamSceneSound[];
  assets: SteamSceneAssetSlice[];
}

const MAX_PKG_MAGIC_LEN = 64;
const MAX_PKG_ENTRIES = 100_000;
const MAX_ENTRY_NAME_LEN = 4_096;
const MAX_JSON_ENTRY_BYTES = 2 * 1024 * 1024;
const TEX_HEADER_PROBE_BYTES = 512;
const TEX_FLAG_VIDEO_MP4 = 32;

const AUDIO_MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac"
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEntryPath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function isMaskTexturePath(normalizedPath: string): boolean {
  const lower = normalizedPath.toLowerCase();
  return lower.startsWith("materials/masks/") || lower.includes("/masks/");
}

function sanitizeJsonText(raw: string): string {
  return raw.replace(/^\uFEFF/, "").trim();
}

export function unwrapSceneValue(raw: unknown): unknown {
  let current = raw;
  for (let depth = 0; depth < 8; depth += 1) {
    if (isPlainRecord(current) && "value" in current) {
      current = current["value"];
    } else {
      break;
    }
  }
  return current;
}

function parseSceneBoolean(raw: unknown, fallback: boolean): boolean {
  const unwrapped = unwrapSceneValue(raw);
  if (typeof unwrapped === "boolean") {
    return unwrapped;
  }
  if (typeof unwrapped === "number") {
    return unwrapped !== 0;
  }
  if (typeof unwrapped === "string") {
    const lower = unwrapped.trim().toLowerCase();
    if (lower === "false" || lower === "0") {
      return false;
    }
    if (lower === "true" || lower === "1") {
      return true;
    }
  }
  return fallback;
}

function parseSceneNumber(raw: unknown, fallback: number): number {
  const unwrapped = unwrapSceneValue(raw);
  if (typeof unwrapped === "number" && Number.isFinite(unwrapped)) {
    return unwrapped;
  }
  if (typeof unwrapped === "string") {
    const parsed = Number.parseFloat(unwrapped.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function parseSceneVec(raw: unknown): number[] | null {
  const unwrapped = unwrapSceneValue(raw);
  if (typeof unwrapped === "string") {
    const parts = unwrapped.trim().split(/\s+/);
    if (parts.length === 0) {
      return null;
    }
    const nums = parts.map((p) => Number.parseFloat(p));
    if (nums.some((n) => !Number.isFinite(n))) {
      return null;
    }
    return nums;
  }
  if (Array.isArray(unwrapped)) {
    const nums = unwrapped.map((v) =>
      typeof v === "number" ? v : Number.parseFloat(String(v))
    );
    if (nums.length > 0 && nums.every((n) => Number.isFinite(n))) {
      return nums;
    }
  }
  return null;
}

function parseSceneVec2(
  raw: unknown,
  fallback: readonly [number, number]
): [number, number] {
  const vec = parseSceneVec(raw);
  if (!vec || vec.length < 2) {
    return [fallback[0], fallback[1]];
  }
  return [vec[0]!, vec[1]!];
}

function parseSceneVec3(
  raw: unknown,
  fallback: readonly [number, number, number]
): [number, number, number] {
  const vec = parseSceneVec(raw);
  if (!vec || vec.length < 2) {
    return [fallback[0], fallback[1], fallback[2]];
  }
  return [vec[0]!, vec[1]!, vec[2] ?? fallback[2]];
}

function readExactBytes(
  fd: number,
  offset: number,
  length: number
): Buffer | null {
  if (length <= 0 || offset < 0) {
    return null;
  }
  const buf = Buffer.allocUnsafe(length);
  let totalRead = 0;
  while (totalRead < length) {
    const got = readSync(fd, buf, totalRead, length - totalRead, offset + totalRead);
    if (got <= 0) {
      return null;
    }
    totalRead += got;
  }
  return buf;
}

function readLengthPrefixedString(
  fd: number,
  offset: number,
  fileSize: number,
  maxLen: number
): { value: string; nextOffset: number } | null {
  if (offset < 0 || offset + 4 > fileSize) {
    return null;
  }
  const lenBuf = readExactBytes(fd, offset, 4);
  if (!lenBuf) {
    return null;
  }
  const strLen = lenBuf.readInt32LE(0);
  if (strLen <= 0 || strLen > maxLen || offset + 4 + strLen > fileSize) {
    return null;
  }
  const strBuf = readExactBytes(fd, offset + 4, strLen);
  if (!strBuf) {
    return null;
  }
  return {
    value: strBuf.toString("utf8"),
    nextOffset: offset + 4 + strLen
  };
}

interface ParsedPkgHeader {
  magic: string;
  dataBase: number;
  entries: SteamScenePkgEntry[];
}

function readPkgHeaderIndex(fd: number, fileSize: number): ParsedPkgHeader | null {
  if (fileSize < 16) {
    return null;
  }
  const magicRes = readLengthPrefixedString(fd, 0, fileSize, MAX_PKG_MAGIC_LEN);
  if (!magicRes || !magicRes.value.startsWith("PKGV")) {
    return null;
  }
  if (magicRes.nextOffset + 4 > fileSize) {
    return null;
  }
  const countBuf = readExactBytes(fd, magicRes.nextOffset, 4);
  if (!countBuf) {
    return null;
  }
  const entryCount = countBuf.readInt32LE(0);
  if (entryCount < 0 || entryCount > MAX_PKG_ENTRIES) {
    return null;
  }

  let cursor = magicRes.nextOffset + 4;
  const rawEntries: Array<{ name: string; offset: number; length: number }> = [];

  for (let i = 0; i < entryCount; i += 1) {
    const nameRes = readLengthPrefixedString(fd, cursor, fileSize, MAX_ENTRY_NAME_LEN);
    if (!nameRes) {
      return null;
    }
    if (nameRes.nextOffset + 8 > fileSize) {
      return null;
    }
    const metaBuf = readExactBytes(fd, nameRes.nextOffset, 8);
    if (!metaBuf) {
      return null;
    }
    const offset = metaBuf.readUInt32LE(0);
    const length = metaBuf.readUInt32LE(4);
    rawEntries.push({
      name: nameRes.value,
      offset,
      length
    });
    cursor = nameRes.nextOffset + 8;
  }

  const dataBase = cursor;
  const entries: SteamScenePkgEntry[] = [];
  for (const item of rawEntries) {
    const absStart = dataBase + item.offset;
    const absEnd = absStart + item.length;
    if (absStart < dataBase || absEnd > fileSize) {
      continue;
    }
    entries.push({
      name: item.name,
      normalizedName: normalizeEntryPath(item.name),
      offset: item.offset,
      length: item.length
    });
  }

  return {
    magic: magicRes.value,
    dataBase,
    entries
  };
}

function readNullTerminatedAscii(
  buf: Buffer,
  startOffset: number
): { value: string; nextOffset: number } | null {
  if (startOffset < 0 || startOffset >= buf.length) {
    return null;
  }
  const zeroIdx = buf.indexOf(0, startOffset);
  if (zeroIdx < startOffset || zeroIdx - startOffset > 32) {
    return null;
  }
  return {
    value: buf.subarray(startOffset, zeroIdx).toString("ascii"),
    nextOffset: zeroIdx + 1
  };
}

function sniffMediaMagic(
  head: Buffer,
  videoHint: boolean
): { kind: "image" | "video"; mimeType: string } | null {
  if (head.length < 4) {
    return null;
  }
  // ISO BMFF / MP4: box size (4 bytes) + "ftyp"
  if (
    head.length >= 8 &&
    head[4] === 0x66 &&
    head[5] === 0x74 &&
    head[6] === 0x79 &&
    head[7] === 0x70
  ) {
    return { kind: "video", mimeType: "video/mp4" };
  }
  // Video-flagged textures must carry a valid MP4 container header to avoid feeding raw bytes to <video>
  if (videoHint) {
    return null;
  }
  // JPEG: FF D8 FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { kind: "image", mimeType: "image/jpeg" };
  }
  // PNG: 89 50 4E 47
  if (
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47
  ) {
    return { kind: "image", mimeType: "image/png" };
  }
  // WebP: RIFF....WEBP
  if (
    head.length >= 12 &&
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return { kind: "image", mimeType: "image/webp" };
  }
  // GIF: GIF8
  if (
    head[0] === 0x47 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x38
  ) {
    return { kind: "image", mimeType: "image/gif" };
  }
  // BMP: BM
  if (head[0] === 0x42 && head[1] === 0x4d) {
    return { kind: "image", mimeType: "image/bmp" };
  }
  return null;
}

interface InspectedTexMedia {
  entryName: string;
  kind: "image" | "video";
  mimeType: string;
  byteStart: number;
  byteLength: number;
  width: number | null;
  height: number | null;
}

function inspectTexEntry(
  fd: number,
  fileSize: number,
  dataBase: number,
  entry: SteamScenePkgEntry
): InspectedTexMedia | null {
  if (isMaskTexturePath(entry.normalizedName) || entry.length < 48) {
    return null;
  }

  const entryStart = dataBase + entry.offset;
  const entryEnd = entryStart + entry.length;
  if (entryStart < dataBase || entryEnd > fileSize) {
    return null;
  }

  const probeLen = Math.min(entry.length, TEX_HEADER_PROBE_BYTES);
  const hdr = readExactBytes(fd, entryStart, probeLen);
  if (!hdr) {
    return null;
  }

  const texv = readNullTerminatedAscii(hdr, 0);
  if (!texv || !texv.value.startsWith("TEXV")) {
    return null;
  }
  const texi = readNullTerminatedAscii(hdr, texv.nextOffset);
  if (!texi || !texi.value.startsWith("TEXI")) {
    return null;
  }

  let cursor = texi.nextOffset;
  if (cursor + 28 > hdr.length) {
    return null;
  }
  const flags = hdr.readInt32LE(cursor + 4);
  const texWidth = hdr.readInt32LE(cursor + 8);
  const texHeight = hdr.readInt32LE(cursor + 12);
  const imageWidth = hdr.readInt32LE(cursor + 16);
  const imageHeight = hdr.readInt32LE(cursor + 20);
  cursor += 28;

  const texb = readNullTerminatedAscii(hdr, cursor);
  if (!texb) {
    return null;
  }
  const texbVer = texb.value;
  if (
    texbVer !== "TEXB0001" &&
    texbVer !== "TEXB0002" &&
    texbVer !== "TEXB0003" &&
    texbVer !== "TEXB0004"
  ) {
    return null;
  }
  cursor = texb.nextOffset;

  // imageCount (int32)
  if (cursor + 4 > hdr.length) {
    return null;
  }
  const imageCount = hdr.readInt32LE(cursor);
  cursor += 4;
  if (imageCount < 1 || imageCount > 64) {
    return null;
  }

  let isVideoMp4 = 0;
  if (texbVer === "TEXB0003") {
    if (cursor + 4 > hdr.length) {
      return null;
    }
    cursor += 4; // freeImageFormat (int32)
  } else if (texbVer === "TEXB0004") {
    if (cursor + 8 > hdr.length) {
      return null;
    }
    cursor += 4; // freeImageFormat (int32)
    isVideoMp4 = hdr.readUInt32LE(cursor);
    cursor += 4;
  }

  // mipCount (int32)
  if (cursor + 4 > hdr.length) {
    return null;
  }
  const mipCount = hdr.readInt32LE(cursor);
  cursor += 4;
  if (mipCount < 1 || mipCount > 32) {
    return null;
  }

  let mipWidth = 0;
  let mipHeight = 0;
  let lz4Flag = 0;
  let byteLen = 0;

  if (texbVer === "TEXB0001") {
    if (cursor + 12 > hdr.length) {
      return null;
    }
    mipWidth = hdr.readInt32LE(cursor);
    mipHeight = hdr.readInt32LE(cursor + 4);
    byteLen = hdr.readInt32LE(cursor + 8);
    cursor += 12;
  } else {
    if (cursor + 20 > hdr.length) {
      return null;
    }
    mipWidth = hdr.readInt32LE(cursor);
    mipHeight = hdr.readInt32LE(cursor + 4);
    lz4Flag = hdr.readInt32LE(cursor + 8);
    byteLen = hdr.readInt32LE(cursor + 16);
    cursor += 20;
  }

  // Skip LZ4-compressed raw/block GPU textures (DXT/R8 masks etc.)
  if (lz4Flag !== 0 || byteLen <= 12) {
    return null;
  }

  const byteStart = entryStart + cursor;
  if (byteStart + byteLen > entryEnd || byteStart + byteLen > fileSize) {
    return null;
  }

  const headSlice =
    cursor + 16 <= hdr.length
      ? hdr.subarray(cursor, cursor + 16)
      : readExactBytes(fd, byteStart, Math.min(16, byteLen));
  if (!headSlice) {
    return null;
  }

  const videoHint = (flags & TEX_FLAG_VIDEO_MP4) !== 0 || isVideoMp4 === 1;
  const mediaInfo = sniffMediaMagic(headSlice, videoHint);
  if (!mediaInfo) {
    return null;
  }

  const width =
    imageWidth > 0
      ? imageWidth
      : mipWidth > 0
        ? mipWidth
        : texWidth > 0
          ? texWidth
          : null;
  const height =
    imageHeight > 0
      ? imageHeight
      : mipHeight > 0
        ? mipHeight
        : texHeight > 0
          ? texHeight
          : null;

  return {
    entryName: entry.normalizedName,
    kind: mediaInfo.kind,
    mimeType: mediaInfo.mimeType,
    byteStart,
    byteLength: byteLen,
    width,
    height
  };
}

function readTexHeaderDimensions(
  fd: number,
  fileSize: number,
  dataBase: number,
  entry: SteamScenePkgEntry
): { width: number; height: number } | null {
  if (isMaskTexturePath(entry.normalizedName) || entry.length < 48) {
    return null;
  }
  const entryStart = dataBase + entry.offset;
  const entryEnd = entryStart + entry.length;
  if (entryStart < dataBase || entryEnd > fileSize) {
    return null;
  }
  const hdr = readExactBytes(fd, entryStart, Math.min(entry.length, 96));
  if (!hdr) {
    return null;
  }
  const texv = readNullTerminatedAscii(hdr, 0);
  if (!texv || !texv.value.startsWith("TEXV")) {
    return null;
  }
  const texi = readNullTerminatedAscii(hdr, texv.nextOffset);
  if (!texi || !texi.value.startsWith("TEXI")) {
    return null;
  }
  const cursor = texi.nextOffset;
  if (cursor + 24 > hdr.length) {
    return null;
  }
  const texWidth = hdr.readInt32LE(cursor + 8);
  const texHeight = hdr.readInt32LE(cursor + 12);
  const imageWidth = hdr.readInt32LE(cursor + 16);
  const imageHeight = hdr.readInt32LE(cursor + 20);
  const width = imageWidth > 0 ? imageWidth : texWidth > 0 ? texWidth : 0;
  const height = imageHeight > 0 ? imageHeight : texHeight > 0 ? texHeight : 0;
  return width > 0 && height > 0 ? { width, height } : null;
}

function readJsonEntry(
  fd: number,
  dataBase: number,
  entry: SteamScenePkgEntry | undefined
): unknown {
  if (!entry || entry.length <= 0 || entry.length > MAX_JSON_ENTRY_BYTES) {
    return null;
  }
  const buf = readExactBytes(fd, dataBase + entry.offset, entry.length);
  if (!buf) {
    return null;
  }
  try {
    return JSON.parse(sanitizeJsonText(buf.toString("utf8"))) as unknown;
  } catch {
    return null;
  }
}

function extractEffectTags(rawEffects: unknown): string[] {
  if (!Array.isArray(rawEffects)) {
    return [];
  }
  const tags = new Set<string>();
  const knownTokens = [
    "foliagesway",
    "waterwaves",
    "lightshafts",
    "shake",
    "pulse",
    "twirl",
    "iris"
  ];
  for (const eff of rawEffects) {
    if (!isPlainRecord(eff)) {
      continue;
    }
    if (!parseSceneBoolean(eff["visible"], true)) {
      continue;
    }
    const rawFile = typeof eff["file"] === "string" ? eff["file"].toLowerCase() : "";
    const rawName = typeof eff["name"] === "string" ? eff["name"].toLowerCase() : "";
    const combined = `${rawFile} ${rawName}`;
    for (const token of knownTokens) {
      if (combined.includes(token)) {
        tags.add(token);
      }
    }
  }
  return Array.from(tags);
}

function getAudioMimeForEntry(normalizedPath: string): string | null {
  const ext = extname(normalizedPath).toLowerCase();
  return AUDIO_MIME_BY_EXT[ext] ?? null;
}

/**
 * Inspects a Steam Wallpaper Engine `scene.pkg` archive strictly using bounded
 * `openSync` + `readSync` header/index probes (never loading the entire archive
 * into memory) and extracts renderable image/video layers and audio slices.
 */
export function inspectSteamScenePackage(
  pkgPath: string
): SteamScenePackageManifest | null {
  let fd: number | undefined;
  try {
    const stats = statSync(pkgPath);
    if (!stats.isFile() || stats.size < 16) {
      return null;
    }
    const fileSize = stats.size;
    fd = openSync(pkgPath, "r");

    const header = readPkgHeaderIndex(fd, fileSize);
    if (!header) {
      return null;
    }

    const entriesByLower = new Map<string, SteamScenePkgEntry>();
    for (const entry of header.entries) {
      const key = entry.normalizedName.toLowerCase();
      if (!entriesByLower.has(key)) {
        entriesByLower.set(key, entry);
      }
    }

    const lookupEntry = (relPath: string): SteamScenePkgEntry | undefined => {
      const norm = normalizeEntryPath(relPath).toLowerCase();
      return entriesByLower.get(norm);
    };

    const assets: SteamSceneAssetSlice[] = [];
    const texAssetByKey = new Map<string, SteamSceneAssetSlice | null>();

    const getOrInspectTex = (
      entry: SteamScenePkgEntry
    ): SteamSceneAssetSlice | null => {
      const key = entry.normalizedName.toLowerCase();
      if (texAssetByKey.has(key)) {
        return texAssetByKey.get(key) ?? null;
      }
      const inspected = inspectTexEntry(fd!, fileSize, header.dataBase, entry);
      if (!inspected) {
        texAssetByKey.set(key, null);
        return null;
      }
      const slice: SteamSceneAssetSlice = {
        index: assets.length,
        ...inspected
      };
      assets.push(slice);
      texAssetByKey.set(key, slice);
      return slice;
    };

    const resolveTexEntryFromTextureRef = (
      rawTexRef: string
    ): SteamScenePkgEntry | undefined => {
      const clean = normalizeEntryPath(rawTexRef);
      if (clean.length === 0) {
        return undefined;
      }
      const hasTexExt = clean.toLowerCase().endsWith(".tex");
      const candidates = hasTexExt
        ? [clean, `materials/${clean}`]
        : [`materials/${clean}.tex`, `${clean}.tex`, `materials/${clean}`, clean];
      for (const candidate of candidates) {
        const hit = lookupEntry(candidate);
        if (hit && !isMaskTexturePath(hit.normalizedName)) {
          return hit;
        }
      }
      return undefined;
    };

    const resolveTexEntryFromMaterialPath = (
      materialPath: string
    ): SteamScenePkgEntry | undefined => {
      const matEntry = lookupEntry(materialPath);
      const matJson = readJsonEntry(fd!, header.dataBase, matEntry);
      if (!isPlainRecord(matJson) || !Array.isArray(matJson["passes"])) {
        return undefined;
      }
      for (const pass of matJson["passes"]) {
        if (!isPlainRecord(pass) || !Array.isArray(pass["textures"])) {
          continue;
        }
        for (const texRef of pass["textures"]) {
          if (typeof texRef !== "string" || texRef.trim().length === 0) {
            continue;
          }
          const found = resolveTexEntryFromTextureRef(texRef);
          if (found) {
            return found;
          }
        }
      }
      return undefined;
    };

    type ResolvedObjectImage =
      | { kind: "none" }
      | { kind: "puppet" }
      | { kind: "tex"; entry: SteamScenePkgEntry };

    const resolveObjectImage = (imageRef: string): ResolvedObjectImage => {
      const clean = normalizeEntryPath(imageRef);
      if (clean.length === 0) {
        return { kind: "none" };
      }
      const lower = clean.toLowerCase();
      if (lower.endsWith(".tex")) {
        const direct = lookupEntry(clean);
        return direct && !isMaskTexturePath(direct.normalizedName)
          ? { kind: "tex", entry: direct }
          : { kind: "none" };
      }
      const entry = lookupEntry(clean);
      const json = readJsonEntry(fd!, header.dataBase, entry);
      if (!isPlainRecord(json)) {
        return { kind: "none" };
      }
      if (json["solidlayer"] === true) {
        return { kind: "none" };
      }
      if (typeof json["puppet"] === "string" && json["puppet"].trim().length > 0) {
        return { kind: "puppet" };
      }
      let texEntry: SteamScenePkgEntry | undefined;
      if (typeof json["material"] === "string" && json["material"].trim().length > 0) {
        texEntry = resolveTexEntryFromMaterialPath(json["material"]);
      } else if (Array.isArray(json["passes"])) {
        texEntry = resolveTexEntryFromMaterialPath(clean);
      }
      return texEntry ? { kind: "tex", entry: texEntry } : { kind: "none" };
    };

    const sceneEntry = lookupEntry("scene.json");
    const sceneJson = readJsonEntry(fd, header.dataBase, sceneEntry);

    let orthoWidth = 0;
    let orthoHeight = 0;
    let skippedPuppetLayerCount = 0;
    let skippedUnsupportedBackdropCount = 0;
    const layers: SteamSceneLayer[] = [];
    const orderedSoundEntries: SteamScenePkgEntry[] = [];
    const seenSoundKeys = new Set<string>();

    const addSoundEntry = (entry: SteamScenePkgEntry | undefined) => {
      if (!entry || entry.length <= 0) {
        return;
      }
      const mime = getAudioMimeForEntry(entry.normalizedName);
      if (!mime) {
        return;
      }
      const key = entry.normalizedName.toLowerCase();
      if (seenSoundKeys.has(key)) {
        return;
      }
      seenSoundKeys.add(key);
      orderedSoundEntries.push(entry);
    };

    if (isPlainRecord(sceneJson)) {
      const general = sceneJson["general"];
      if (isPlainRecord(general) && isPlainRecord(general["orthogonalprojection"])) {
        const ortho = general["orthogonalprojection"];
        const w = parseSceneNumber(ortho["width"], 0);
        const h = parseSceneNumber(ortho["height"], 0);
        if (w > 0 && h > 0) {
          orthoWidth = Math.round(w);
          orthoHeight = Math.round(h);
        }
      }

      const objects = sceneJson["objects"];
      if (Array.isArray(objects)) {
        for (const rawObj of objects) {
          if (!isPlainRecord(rawObj)) {
            continue;
          }

          // Collect referenced sound entries even on non-visual objects
          const rawSound = unwrapSceneValue(rawObj["sound"]);
          if (Array.isArray(rawSound)) {
            for (const s of rawSound) {
              if (typeof s === "string") {
                addSoundEntry(lookupEntry(s));
              }
            }
          } else if (typeof rawSound === "string") {
            addSoundEntry(lookupEntry(rawSound));
          }

          const imageRef = unwrapSceneValue(rawObj["image"]);
          if (typeof imageRef !== "string" || imageRef.trim().length === 0) {
            continue;
          }

          if (!parseSceneBoolean(rawObj["visible"], true)) {
            continue;
          }

          const alpha = Math.max(0, Math.min(1, parseSceneNumber(rawObj["alpha"], 1)));
          if (alpha <= 0) {
            continue;
          }

          const [scaleX, scaleY] = parseSceneVec3(rawObj["scale"], [1, 1, 1]);
          if (scaleX === 0 || scaleY === 0) {
            continue;
          }

          const resolvedImage = resolveObjectImage(imageRef);
          if (resolvedImage.kind === "puppet") {
            skippedPuppetLayerCount += 1;
            continue;
          }
          if (resolvedImage.kind !== "tex") {
            continue;
          }
          const texEntry = resolvedImage.entry;
          const asset = getOrInspectTex(texEntry);
          if (!asset || (asset.kind !== "image" && asset.kind !== "video")) {
            const texDims = readTexHeaderDimensions(fd, fileSize, header.dataBase, texEntry);
            const fallbackW = texDims?.width ?? (orthoWidth > 0 ? orthoWidth : 0);
            const fallbackH = texDims?.height ?? (orthoHeight > 0 ? orthoHeight : 0);
            const [rawW, rawH] = parseSceneVec2(rawObj["size"], [fallbackW, fallbackH]);
            const effectiveW = rawW > 0 ? rawW : fallbackW;
            const effectiveH = rawH > 0 ? rawH : fallbackH;
            const coveredW = effectiveW * Math.abs(scaleX);
            const coveredH = effectiveH * Math.abs(scaleY);
            const coveredArea = coveredW * coveredH;
            const orthoArea = orthoWidth > 0 && orthoHeight > 0 ? orthoWidth * orthoHeight : 0;
            if (
              (orthoArea > 0 && coveredArea >= orthoArea * 0.6) ||
              (orthoArea === 0 && coveredW >= 512 && coveredH >= 512)
            ) {
              skippedUnsupportedBackdropCount += 1;
            }
            continue;
          }

          const fallbackW = asset.width ?? (orthoWidth > 0 ? orthoWidth : 1920);
          const fallbackH = asset.height ?? (orthoHeight > 0 ? orthoHeight : 1080);
          const [sizeW, sizeH] = parseSceneVec2(rawObj["size"], [fallbackW, fallbackH]);
          const effectiveW = sizeW > 0 ? sizeW : fallbackW;
          const effectiveH = sizeH > 0 ? sizeH : fallbackH;

          const baseOrthoW = orthoWidth > 0 ? orthoWidth : effectiveW;
          const baseOrthoH = orthoHeight > 0 ? orthoHeight : effectiveH;
          const [originX, originY] = parseSceneVec3(rawObj["origin"], [
            baseOrthoW / 2,
            baseOrthoH / 2,
            0
          ]);
          const [, , angleZ] = parseSceneVec3(rawObj["angles"], [0, 0, 0]);
          const [parallaxX, parallaxY] = parseSceneVec2(rawObj["parallaxDepth"], [0, 0]);
          const effects = extractEffectTags(rawObj["effects"]);

          const layerName =
            typeof rawObj["name"] === "string" && rawObj["name"].trim().length > 0
              ? rawObj["name"].trim()
              : texEntry.normalizedName;

          layers.push({
            name: layerName,
            assetIndex: asset.index,
            kind: asset.kind,
            originX,
            originY,
            width: effectiveW,
            height: effectiveH,
            scaleX,
            scaleY,
            angleZ,
            alpha,
            parallaxX,
            parallaxY,
            effects
          });
        }
      }
    }

    // Protect against rendering disassembled skeletal puppet UV atlases as flat 2D sprites
    const hasDecodedVideoLayer = layers.some((layer) => layer.kind === "video");
    if (skippedPuppetLayerCount > 0 && !hasDecodedVideoLayer) {
      return null;
    }

    // Protect against rendering partial overlays over black void when primary backdrop uses unsupported GPU compression (e.g. DXT1/DXT5)
    if (skippedUnsupportedBackdropCount > 0 && !hasDecodedVideoLayer) {
      const orthoArea = orthoWidth > 0 && orthoHeight > 0 ? orthoWidth * orthoHeight : 0;
      const hasFullFrameOpaqueImage =
        orthoArea > 0 &&
        layers.some(
          (layer) =>
            layer.kind === "image" &&
            layer.alpha >= 0.99 &&
            layer.width * Math.abs(layer.scaleX) * (layer.height * Math.abs(layer.scaleY)) >=
              orthoArea * 0.85
        );
      if (!hasFullFrameOpaqueImage) {
        return null;
      }
    }

    // Fallback: if scene.json yielded no renderable layers, pick the largest non-mask .tex asset
    if (layers.length === 0) {
      let bestSlice: SteamSceneAssetSlice | null = null;
      let bestScore = -1;

      for (const entry of header.entries) {
        if (
          !entry.normalizedName.toLowerCase().endsWith(".tex") ||
          isMaskTexturePath(entry.normalizedName)
        ) {
          continue;
        }
        const slice = getOrInspectTex(entry);
        if (!slice || (slice.kind !== "image" && slice.kind !== "video")) {
          continue;
        }
        const area = (slice.width ?? 0) * (slice.height ?? 0);
        const videoBonus = slice.kind === "video" ? 1e12 : 0;
        const score = videoBonus + area + slice.byteLength / 1e6;
        if (score > bestScore) {
          bestScore = score;
          bestSlice = slice;
        }
      }

      if (bestSlice) {
        const fallbackW = bestSlice.width ?? (orthoWidth > 0 ? orthoWidth : 1920);
        const fallbackH = bestSlice.height ?? (orthoHeight > 0 ? orthoHeight : 1080);
        if (orthoWidth <= 0 || orthoHeight <= 0) {
          orthoWidth = fallbackW;
          orthoHeight = fallbackH;
        }
        layers.push({
          name: bestSlice.entryName,
          assetIndex: bestSlice.index,
          kind: bestSlice.kind === "video" ? "video" : "image",
          originX: orthoWidth / 2,
          originY: orthoHeight / 2,
          width: orthoWidth,
          height: orthoHeight,
          scaleX: 1,
          scaleY: 1,
          angleZ: 0,
          alpha: 1,
          parallaxX: 0,
          parallaxY: 0,
          effects: []
        });
      }
    }

    if (layers.length === 0) {
      return null;
    }

    // Collect any remaining sounds/* audio entries inside the package
    for (const entry of header.entries) {
      if (entry.normalizedName.toLowerCase().startsWith("sounds/")) {
        addSoundEntry(entry);
      }
    }

    const sounds: SteamSceneSound[] = [];
    for (const soundEntry of orderedSoundEntries) {
      const mimeType = getAudioMimeForEntry(soundEntry.normalizedName);
      if (!mimeType) {
        continue;
      }
      const slice: SteamSceneAssetSlice = {
        index: assets.length,
        entryName: soundEntry.normalizedName,
        kind: "audio",
        mimeType,
        byteStart: header.dataBase + soundEntry.offset,
        byteLength: soundEntry.length,
        width: null,
        height: null
      };
      assets.push(slice);
      sounds.push({
        name: soundEntry.normalizedName,
        assetIndex: slice.index,
        mimeType
      });
    }

    const primaryLayer = layers[0]!;
    if (orthoWidth <= 0 || orthoHeight <= 0) {
      orthoWidth = Math.max(1, Math.round(primaryLayer.width));
      orthoHeight = Math.max(1, Math.round(primaryLayer.height));
    }

    return {
      pkgPath,
      pkgMagic: header.magic,
      pkgFileSize: fileSize,
      pkgMtimeMs: stats.mtimeMs,
      orthoWidth,
      orthoHeight,
      width: orthoWidth,
      height: orthoHeight,
      hasVideo: layers.some((layer) => layer.kind === "video"),
      layers,
      sounds,
      assets
    };
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

function escapeHtmlText(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Generates a self-contained HTML5 Live Scene Player for a parsed `scene.pkg`.
 * Converts Wallpaper Engine bottom-left Y-up coordinates into CSS top-down space,
 * streams embedded MP4/image/audio slices zero-copy via `./asset/<index>`,
 * strictly respects parent audio/pause/objectFit commands, and runs 0 rAF when paused.
 */
export function renderSteamScenePlayerHtml(
  manifest: SteamScenePackageManifest,
  title: string
): string {
  const safeTitle = escapeHtmlText(title);
  const clientModel = {
    orthoWidth: manifest.orthoWidth,
    orthoHeight: manifest.orthoHeight,
    layers: manifest.layers.map((layer) => ({
      name: layer.name,
      src: `./asset/${layer.assetIndex}`,
      kind: layer.kind,
      originX: layer.originX,
      originY: layer.originY,
      topY: manifest.orthoHeight - layer.originY,
      width: layer.width,
      height: layer.height,
      scaleX: layer.scaleX,
      scaleY: layer.scaleY,
      angleZ: layer.angleZ,
      alpha: layer.alpha,
      parallaxX: layer.parallaxX,
      parallaxY: layer.parallaxY,
      effects: layer.effects
    })),
    sounds: manifest.sounds.map((s) => ({
      name: s.name,
      src: `./asset/${s.assetIndex}`,
      mimeType: s.mimeType
    }))
  };

  const serializedModel = JSON.stringify(clientModel).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en" style="background:#000">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<style>
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000;}
#pmx-viewport{position:fixed;inset:0;overflow:hidden;background:#000;}
#pmx-stage{position:absolute;left:50%;top:50%;transform-origin:center center;}
.pmx-layer{position:absolute;transform-origin:center center;pointer-events:none;user-select:none;}
.pmx-layer img,.pmx-layer video{display:block;width:100%;height:100%;object-fit:fill;pointer-events:none;user-select:none;}
#pmx-solo-video{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;background:#000;pointer-events:none;user-select:none;}
</style>
</head>
<body>
<div id="pmx-viewport"></div>
<script data-pmx-scene-player="1">
(()=>{
  const scene=${serializedModel};
  const viewport=document.getElementById("pmx-viewport");
  const reducedMotion=Boolean(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  let paused=false;
  let objectFit="cover";
  let masterMuted=true;
  let masterVol=0;
  let fpsLimit=30;
  let lastFrameTs=0;
  let readySent=false;
  let rafId=0;
  let stageW=Math.max(1,window.innerWidth||1);
  let stageH=Math.max(1,window.innerHeight||1);
  let targetPtrX=0,targetPtrY=0,curPtrX=0,curPtrY=0;

  const videos=[];
  const animatedNodes=[];
  let stageEl=null;
  let soloVideoEl=null;
  let audioEl=null;
  let soundIndex=0;

  function postToParent(msg){
    try{if(window.parent&&window.parent!==window){window.parent.postMessage(msg,"*");}}catch{}
  }
  function notifyBridgeReady(){
    postToParent({type:"prismuxWeBridgeReady"});
  }
  function notifyRenderReady(){
    if(readySent)return;
    readySent=true;
    postToParent({type:"prismuxWebReady"});
  }

  function applyAudioState(nextMuted,nextVol){
    const clamped=typeof nextVol==="number"&&Number.isFinite(nextVol)?Math.max(0,Math.min(1,nextVol)):masterVol;
    const effMuted=Boolean(nextMuted)||clamped<=0;
    masterMuted=effMuted;
    masterVol=effMuted?0:clamped;
    syncMediaPlayback();
  }

  function ensureAudioElement(){
    if(audioEl||!scene.sounds.length)return audioEl;
    const el=document.createElement("audio");
    el.preload="none";
    el.muted=true;
    el.volume=0;
    el.loop=scene.sounds.length===1;
    el.src=scene.sounds[0].src;
    if(scene.sounds.length>1){
      el.addEventListener("ended",()=>{
        soundIndex=(soundIndex+1)%scene.sounds.length;
        el.src=scene.sounds[soundIndex].src;
        if(!paused&&!masterMuted&&masterVol>0){
          el.muted=false;
          el.volume=masterVol;
          el.play().catch(()=>{});
        }
      });
    }
    audioEl=el;
    return el;
  }

  function syncMediaPlayback(){
    const hasDedicatedSounds=scene.sounds.length>0;
    for(const v of videos){
      const videoMuted=hasDedicatedSounds||masterMuted||masterVol<=0;
      v.muted=videoMuted;
      v.volume=videoMuted?0:masterVol;
      if(paused){
        try{if(!v.paused)v.pause();}catch{}
      }else{
        try{if(v.paused)v.play().catch(()=>{});}catch{}
      }
    }
    if(hasDedicatedSounds){
      if(paused||masterMuted||masterVol<=0){
        if(audioEl){
          audioEl.muted=true;
          audioEl.volume=0;
          try{audioEl.pause();}catch{}
        }
      }else{
        const el=ensureAudioElement();
        if(el){
          el.muted=false;
          el.volume=masterVol;
          el.play().catch(()=>{});
        }
      }
    }
  }

  function layoutStage(){
    const vw=Math.max(1,window.innerWidth||document.documentElement.clientWidth||1);
    const vh=Math.max(1,window.innerHeight||document.documentElement.clientHeight||1);
    if(soloVideoEl){
      soloVideoEl.style.objectFit=objectFit==="contain"?"contain":objectFit==="fill"?"fill":"cover";
      return;
    }
    if(!stageEl)return;
    const ow=Math.max(1,scene.orthoWidth);
    const oh=Math.max(1,scene.orthoHeight);
    let sx=vw/ow;
    let sy=vh/oh;
    if(objectFit==="contain"){
      const s=Math.min(sx,sy);sx=s;sy=s;
    }else if(objectFit!=="fill"){
      const overscan=(!reducedMotion&&animatedNodes.length>0)?1.02:1;
      const s=Math.max(sx,sy)*overscan;sx=s;sy=s;
    }
    stageW=Math.max(1,ow*sx);
    stageH=Math.max(1,oh*sy);
    stageEl.style.width=stageW.toFixed(2)+"px";
    stageEl.style.height=stageH.toFixed(2)+"px";
    stageEl.style.transform="translate(-50%,-50%)";
  }

  function isSoloFullVideo(){
    if(scene.layers.length!==1)return false;
    const l=scene.layers[0];
    if(l.kind!=="video")return false;
    const coverW=Math.abs(l.width*l.scaleX)>=scene.orthoWidth*0.95;
    const coverH=Math.abs(l.height*l.scaleY)>=scene.orthoHeight*0.95;
    return coverW&&coverH&&Math.abs(l.angleZ)<0.001;
  }

  function buildScene(){
    if(isSoloFullVideo()){
      const l=scene.layers[0];
      const v=document.createElement("video");
      v.id="pmx-solo-video";
      v.src=l.src;
      v.autoplay=true;
      v.loop=true;
      v.playsInline=true;
      v.muted=true;
      v.volume=0;
      v.preload="auto";
      v.addEventListener("loadeddata",notifyRenderReady,{once:true});
      v.addEventListener("canplay",notifyRenderReady,{once:true});
      v.addEventListener("playing",notifyRenderReady,{once:true});
      v.addEventListener("error",notifyRenderReady,{once:true});
      soloVideoEl=v;
      videos.push(v);
      viewport.appendChild(v);
      layoutStage();
      v.play().catch(()=>{});
      return;
    }

    stageEl=document.createElement("div");
    stageEl.id="pmx-stage";
    viewport.appendChild(stageEl);

    const ow=Math.max(1,scene.orthoWidth);
    const oh=Math.max(1,scene.orthoHeight);
    const totalLayers=scene.layers.length;
    scene.layers.forEach((l,idx)=>{
      const box=document.createElement("div");
      box.className="pmx-layer";
      const w=Math.max(1,l.width*Math.abs(l.scaleX));
      const h=Math.max(1,l.height*Math.abs(l.scaleY));
      const topY=oh-l.originY;
      box.style.left=((l.originX/ow)*100)+"%";
      box.style.top=((topY/oh)*100)+"%";
      box.style.width=((w/ow)*100)+"%";
      box.style.height=((h/oh)*100)+"%";
      box.style.opacity=String(l.alpha);
      box.style.zIndex=String(idx+1);

      const flipX=l.scaleX<0?-1:1;
      const flipY=l.scaleY<0?-1:1;
      const rotDeg=l.angleZ?(-l.angleZ*180/Math.PI):0;
      const baseSuffix=(rotDeg?" rotate("+rotDeg.toFixed(3)+"deg)":"")+(flipX<0||flipY<0?" scale("+flipX+","+flipY+")":"");
      box.style.transform="translate(-50%,-50%)"+baseSuffix;

      if(l.kind==="video"){
        const v=document.createElement("video");
        v.src=l.src;
        v.autoplay=true;
        v.loop=true;
        v.playsInline=true;
        v.muted=true;
        v.volume=0;
        v.preload="auto";
        if(idx===0){
          v.addEventListener("loadeddata",notifyRenderReady,{once:true});
          v.addEventListener("canplay",notifyRenderReady,{once:true});
          v.addEventListener("error",notifyRenderReady,{once:true});
        }
        videos.push(v);
        box.appendChild(v);
        v.play().catch(()=>{});
      }else{
        const img=document.createElement("img");
        img.decoding="async";
        img.alt="";
        const finishImgReady=()=>{
          const p=typeof img.decode==="function"?img.decode().catch(()=>{}):Promise.resolve();
          p.then(notifyRenderReady,notifyRenderReady);
        };
        if(idx===0){
          img.addEventListener("load",finishImgReady,{once:true});
          img.addEventListener("error",notifyRenderReady,{once:true});
        }
        img.src=l.src;
        if(idx===0&&img.complete&&img.naturalWidth>0){
          queueMicrotask(finishImgReady);
        }
        box.appendChild(img);
      }

      const hasMotionEffect=l.effects.some((ef)=>ef==="foliagesway"||ef==="waterwaves"||ef==="lightshafts"||ef==="shake"||ef==="pulse");
      const depthScale=l.parallaxX!==0||l.parallaxY!==0
        ?{px:l.parallaxX,py:l.parallaxY}
        :totalLayers>1
          ?{px:0.25+0.55*(idx/(totalLayers-1)),py:0.2+0.4*(idx/(totalLayers-1))}
          :{px:0.35,py:0.35};
      if(l.kind==="image"){
        animatedNodes.push({
          el:box,
          baseSuffix,
          px:depthScale.px,
          py:depthScale.py,
          breathe:hasMotionEffect?1:(totalLayers>1?0.35:0.45),
          phase:idx*1.17
        });
      }
      stageEl.appendChild(box);
    });

    layoutStage();
  }

  function stopLoop(){
    if(rafId){
      cancelAnimationFrame(rafId);
      rafId=0;
    }
    lastFrameTs=0;
  }

  function startLoop(){
    if(paused||reducedMotion||animatedNodes.length===0||rafId)return;
    lastFrameTs=0;
    const tick=(ts)=>{
      if(paused){rafId=0;return;}
      const minInterval=fpsLimit>0?(1000/fpsLimit):0;
      if(minInterval>0&&lastFrameTs>0&&(ts-lastFrameTs)<minInterval-0.5){
        rafId=requestAnimationFrame(tick);
        return;
      }
      lastFrameTs=ts;
      curPtrX+=(targetPtrX-curPtrX)*0.08;
      curPtrY+=(targetPtrY-curPtrY)*0.08;
      const t=ts*0.001;
      const maxShiftX=stageW*0.006;
      const maxShiftY=stageH*0.006;
      for(let i=0;i<animatedNodes.length;i++){
        const item=animatedNodes[i];
        const dx=curPtrX*maxShiftX*item.px+Math.sin(t*0.65+item.phase)*item.breathe*(stageW*0.0014);
        const dy=curPtrY*maxShiftY*item.py+Math.cos(t*0.52+item.phase)*item.breathe*(stageH*0.0012);
        const s=1+Math.sin(t*0.45+item.phase)*0.0025*item.breathe;
        item.el.style.transform="translate(-50%,-50%) translate3d("+dx.toFixed(2)+"px,"+dy.toFixed(2)+"px,0) scale("+s.toFixed(5)+")"+item.baseSuffix;
      }
      rafId=requestAnimationFrame(tick);
    };
    rafId=requestAnimationFrame(tick);
  }

  function setPaused(nextPaused){
    const norm=Boolean(nextPaused);
    if(paused===norm)return;
    paused=norm;
    if(paused){
      stopLoop();
    }else{
      startLoop();
    }
    syncMediaPlayback();
  }

  function updatePointer(clientX,clientY){
    const vw=Math.max(1,window.innerWidth||1);
    const vh=Math.max(1,window.innerHeight||1);
    targetPtrX=Math.max(-1,Math.min(1,(clientX/vw-0.5)*2));
    targetPtrY=Math.max(-1,Math.min(1,(clientY/vh-0.5)*2));
  }

  window.addEventListener("pointermove",(e)=>{updatePointer(e.clientX,e.clientY);},{passive:true});
  window.addEventListener("resize",layoutStage);
  window.addEventListener("message",(e)=>{
    const m=e&&e.data;
    if(!m||typeof m!=="object")return;
    if(m.type==="prismuxWallpaperAudio"){
      applyAudioState(m.muted,m.volume);
      return;
    }
    if(m.type==="prismuxPointerMove"){
      if(typeof m.x==="number"&&typeof m.y==="number"){
        if(m.x>=-1&&m.x<=1&&m.y>=-1&&m.y<=1&&m.normalized){
          targetPtrX=m.x;targetPtrY=m.y;
        }else{
          updatePointer(m.x,m.y);
        }
      }
      return;
    }
    if(m.type==="wallpaperPropertyListener"){
      if(m.audio&&typeof m.audio==="object"){
        applyAudioState(m.audio.muted,m.audio.volume);
      }
      if(typeof m.objectFit==="string"&&m.objectFit!==objectFit){
        objectFit=m.objectFit;
        layoutStage();
      }
      if(m.applyGeneralProperties&&typeof m.applyGeneralProperties==="object"){
        if(typeof m.applyGeneralProperties.fps==="number"&&Number.isFinite(m.applyGeneralProperties.fps)){
          fpsLimit=m.applyGeneralProperties.fps<=0?0:Math.max(1,Math.min(120,m.applyGeneralProperties.fps));
        }
        if(typeof m.applyGeneralProperties.paused==="boolean"){
          setPaused(m.applyGeneralProperties.paused);
        }
      }
    }
  });

  buildScene();
  startLoop();
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",notifyBridgeReady,{once:true});
  }else{
    notifyBridgeReady();
  }
  window.addEventListener("load",notifyBridgeReady,{once:true});
  setTimeout(notifyRenderReady,2000);
})();
</script>
</body>
</html>`;
}
