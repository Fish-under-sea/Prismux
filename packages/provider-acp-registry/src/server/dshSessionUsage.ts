// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeZlib from "node:zlib";

import type {
  OrchestrationV2ContextInjectionCatalogEntry,
  OrchestrationV2ContextInjectionFileChange,
  OrchestrationV2ContextInjectionForm,
  OrchestrationV2ContextInjectionSection,
  OrchestrationV2ContextInjectionSourceKind,
  TurnTokenUsage,
} from "@prismux/core-contracts";
import * as HostProcess from "@prismux/core-shared/HostProcess";
import type { TrackedContextInjectionPayload } from "@prismux/provider-core/server/contextInjectionTracker";
import { totalTokens, type UsageRecord } from "@prismux/provider-core/server/usage";

import { resolveDshDesktopHome } from "./dshLocal.ts";

const ZSTD_MAGIC = 0xfd2fb528;
const MAX_SESSION_FILE_CACHE_ENTRIES = 512;
const DEFAULT_DSH_USAGE_FILE_CACHE_MAX_ENTRIES = 500;
const DSH_SCAN_CONCURRENCY = 4;
const DEFAULT_FINAL_SETTLE_WAIT_MS = 260;
const FINAL_SETTLE_POLL_INTERVAL_MS = 40;
const MIN_STEP_DECODE_MS = 50;
const MAX_PLAUSIBLE_DECODE_TPS = 2_000;
const MAX_SINGLE_PACKET_OUTPUT_TOKENS = 20;
const zstdDecompressAsync = NodeUtil.promisify(NodeZlib.zstdDecompress);

/** Byte range occupied by one structurally complete RFC 8878 Zstandard frame. */
export interface ZstdFrameRange {
  readonly start: number;
  readonly end: number;
}

/** Structural scan result for a concatenated Zstandard stream. */
export interface ZstdFrameScan {
  readonly frames: ReadonlyArray<ZstdFrameRange>;
  /** Start offset of an incomplete/in-progress final frame, when EOF interrupts one. */
  readonly tornStart?: number;
}

/**
 * Locates complete RFC 8878 Zstd frames without decompressing; reports `tornStart` on truncated tail.
 */
export function scanZstdFrames(
  buffer: Buffer,
  maxFrames = Number.POSITIVE_INFINITY,
): ZstdFrameScan {
  const frames: Array<ZstdFrameRange> = [];
  let offset = 0;

  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) {
      return { frames, tornStart: start };
    }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`);
    }
    offset += 4;

    if (offset === buffer.length) {
      return { frames, tornStart: start };
    }
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 0x18) !== 0) {
      throw new Error(
        `corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`,
      );
    }

    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) {
      return { frames, tornStart: start };
    }
    offset += remainingHeaderBytes;

    for (;;) {
      if (buffer.length - offset < 3) {
        return { frames, tornStart: start };
      }
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      if (blockType === 0x03) {
        throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`);
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) {
        return { frames, tornStart: start };
      }
      offset += payloadBytes;
      if (lastBlock) break;
    }

    if (checksum) {
      if (buffer.length - offset < 4) {
        return { frames, tornStart: start };
      }
      offset += 4;
    }
    frames.push({ start, end: offset });
    if (frames.length === maxFrames) {
      return { frames };
    }
  }

  return { frames };
}

/**
 * Decompresses one complete Zstandard frame. On Node 24 Windows, passing a shared
 * `Buffer.subarray` view into `zstdDecompressSync` can intermittently raise
 * `ZSTD_error_checksum_wrong`, so a failed view decode retries once on a copied buffer.
 */
function decompressZstdFrameSafe(buffer: Buffer, start: number, end: number): Buffer | undefined {
  const view = buffer.subarray(start, end);
  try {
    return NodeZlib.zstdDecompressSync(view);
  } catch {
    try {
      return NodeZlib.zstdDecompressSync(Buffer.from(view));
    } catch {
      return undefined;
    }
  }
}

async function decompressZstdFrameSafeAsync(
  buffer: Buffer,
  start: number,
  end: number,
): Promise<Buffer | undefined> {
  const view = buffer.subarray(start, end);
  try {
    return await zstdDecompressAsync(view);
  } catch {
    try {
      return await zstdDecompressAsync(Buffer.from(view));
    } catch {
      return undefined;
    }
  }
}

export interface DecodedDshSessionJsonl {
  readonly records: ReadonlyArray<Record<string, unknown>>;
  readonly tornFrame: boolean;
}

function parseJsonlText(text: string, initialTornFrame: boolean): DecodedDshSessionJsonl {
  let tornFrame = initialTornFrame;
  const records: Array<Record<string, unknown>> = [];
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        records.push(parsed as Record<string, unknown>);
      }
    } catch {
      if (index === lines.length - 1) {
        tornFrame = true;
      }
    }
  }
  return { records, tornFrame };
}

function decodeDshSessionJsonlInternal(buf: Buffer): DecodedDshSessionJsonl {
  if (buf.length === 0) {
    return { records: [], tornFrame: false };
  }

  let text = "";
  let tornFrame = false;

  if (buf.length >= 4 && buf.readUInt32LE(0) === ZSTD_MAGIC) {
    let scan: ZstdFrameScan;
    try {
      scan = scanZstdFrames(buf);
    } catch {
      return { records: [], tornFrame: true };
    }
    tornFrame = scan.tornStart !== undefined;
    const chunks: Array<string> = [];
    for (const frame of scan.frames) {
      const decoded = decompressZstdFrameSafe(buf, frame.start, frame.end);
      if (decoded === undefined) {
        tornFrame = true;
        break;
      }
      chunks.push(decoded.toString("utf8"));
    }
    text = chunks.join("");
  } else {
    text = buf.toString("utf8");
  }

  return parseJsonlText(text, tornFrame);
}

async function decodeDshSessionJsonlInternalAsync(buf: Buffer): Promise<DecodedDshSessionJsonl> {
  if (buf.length === 0) {
    return { records: [], tornFrame: false };
  }

  let text = "";
  let tornFrame = false;

  if (buf.length >= 4 && buf.readUInt32LE(0) === ZSTD_MAGIC) {
    let scan: ZstdFrameScan;
    try {
      scan = scanZstdFrames(buf);
    } catch {
      return { records: [], tornFrame: true };
    }
    tornFrame = scan.tornStart !== undefined;
    const chunks: Array<string> = [];
    for (const frame of scan.frames) {
      const decoded = await decompressZstdFrameSafeAsync(buf, frame.start, frame.end);
      if (decoded === undefined) {
        tornFrame = true;
        break;
      }
      chunks.push(decoded.toString("utf8"));
    }
    text = chunks.join("");
  } else {
    text = buf.toString("utf8");
  }

  return parseJsonlText(text, tornFrame);
}

/**
 * Decodes a DSH session log buffer (concatenated multi-frame `.jsonl.zstd` or plain `.jsonl`)
 * into parsed JSONL records, safely ignoring any torn/in-progress final frame or line.
 */
export function decodeDshSessionJsonl(buf: Buffer): ReadonlyArray<Record<string, unknown>> {
  return decodeDshSessionJsonlInternal(buf).records;
}

function readEnvValue(
  env: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") {
    const raw = env[name]?.trim();
    return raw && raw.length > 0 ? raw : undefined;
  }
  const target = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === target) {
      const trimmed = value?.trim();
      if (trimmed && trimmed.length > 0) return trimmed;
    }
  }
  return undefined;
}

function expandTildePath(
  rawPath: string,
  homeDir: string,
  pathApi: typeof NodePath.win32 | typeof NodePath.posix,
): string {
  if (rawPath === "~") return homeDir;
  if (rawPath.startsWith("~/") || rawPath.startsWith("~\\")) {
    return pathApi.join(homeDir, rawPath.slice(2));
  }
  return rawPath;
}

function resolveEnvHome(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  if (platform === "win32") {
    const userProfile = readEnvValue(env, "USERPROFILE", platform);
    if (userProfile) return userProfile;
    const homeDrive = readEnvValue(env, "HOMEDRIVE", platform);
    const homePath = readEnvValue(env, "HOMEPATH", platform);
    if (homeDrive && homePath) return `${homeDrive}${homePath}`;
  }
  return readEnvValue(env, "HOME", platform);
}

/**
 * Resolves the DeepSeek Harness home directory (`DSH_HOME` → `<homeDir>/.dsh`).
 * When `DSH_HOME` is unset and `homeDir` matches the host environment home (or is omitted),
 * also respects DSH Desktop's `desktop-next-last-home.json` override if present on disk.
 */
export function resolveDshHomeDir(
  env: NodeJS.ProcessEnv = HostProcess.Environment.defaultValue(),
  homeDir?: string,
  platform: NodeJS.Platform = HostProcess.Platform.defaultValue(),
): string {
  const pathApi = platform === "win32" ? NodePath.win32 : NodePath.posix;
  const envHome = resolveEnvHome(env, platform);
  const resolvedHome =
    homeDir && homeDir.trim().length > 0 ? homeDir.trim() : (envHome ?? NodeOS.homedir());

  const resolvePathPreservingDrive = (value: string) =>
    platform !== "win32" && /^[A-Za-z]:[\\/]/u.test(value) ? value : pathApi.resolve(value);

  const explicit = readEnvValue(env, "DSH_HOME", platform);
  if (explicit !== undefined) {
    return resolvePathPreservingDrive(expandTildePath(explicit, resolvedHome, pathApi));
  }

  const normalizeForCompare = (value: string) =>
    platform === "win32" ? pathApi.resolve(value).toLowerCase() : resolvePathPreservingDrive(value);
  const homeMatchesEnv =
    homeDir === undefined ||
    (envHome !== undefined && normalizeForCompare(resolvedHome) === normalizeForCompare(envHome));
  if (homeMatchesEnv) {
    const desktopHome = resolveDshDesktopHome(env, platform);
    if (desktopHome !== undefined) {
      return resolvePathPreservingDrive(desktopHome);
    }
  }

  return pathApi.join(resolvedHome, ".dsh");
}

/**
 * Encodes a session ID as a single filesystem-safe path segment, matching
 * `@deepseek-ai/dsh-session-persistence-jsonl/src/format.ts#encodeSegment`.
 */
export function encodeDshSegment(raw: string): string {
  if (raw.length === 0) return "_empty";
  if (raw === ".") return "~002E";
  if (raw === "..") return "~002E~002E";
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== "~" && /^[A-Za-z0-9._-]$/u.test(ch)) {
      out += ch;
    } else {
      out += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
    }
  }
  return out;
}

/**
 * Encodes a workspace `cwd` into DSH's project directory name (`--D-Fish-code-Prismux--`),
 * matching `@deepseek-ai/dsh-session-persistence-jsonl/src/format.ts#projectKey`.
 */
export function encodeDshProjectKey(cwd: string): string {
  if (cwd.length === 0) return "_no-cwd";
  let readable = "";
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (ch !== "~" && /^[A-Za-z0-9._-]$/u.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
      separatorRun = false;
    }
  }
  const slug = readable.replace(/^-+/u, "") || "root";
  return `--${slug.slice(0, 251)}--`;
}

const SESSION_FILE_PATTERN = /^session(?:\.v([1-9]\d*))?\.jsonl(\.zstd)?$/u;

interface SessionLogCandidate {
  readonly filePath: string;
  readonly version: number;
  readonly compressed: boolean;
}

function parseSessionLogCandidate(
  dirPath: string,
  fileName: string,
): SessionLogCandidate | undefined {
  const match = SESSION_FILE_PATTERN.exec(fileName);
  if (match === null) return undefined;
  const version = match[1] === undefined ? 0 : Number.parseInt(match[1], 10);
  return {
    filePath: NodePath.join(dirPath, fileName),
    version,
    compressed: match[2] === ".zstd",
  };
}

function findBestSessionFileInDir(sessionDirPath: string): string | undefined {
  // Fast probe for canonical current-generation files before readdir.
  for (const preferred of ["session.v4.jsonl.zstd", "session.v4.jsonl"] as const) {
    const candidate = NodePath.join(sessionDirPath, preferred);
    try {
      if (NodeFS.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }
  let entries: ReadonlyArray<string>;
  try {
    entries = NodeFS.readdirSync(sessionDirPath);
  } catch {
    return undefined;
  }
  let best: SessionLogCandidate | undefined;
  for (const name of entries) {
    const candidate = parseSessionLogCandidate(sessionDirPath, name);
    if (candidate === undefined) continue;
    try {
      if (!NodeFS.statSync(candidate.filePath).isFile()) continue;
    } catch {
      continue;
    }
    if (
      best === undefined ||
      candidate.version > best.version ||
      (candidate.version === best.version && candidate.compressed && !best.compressed)
    ) {
      best = candidate;
    }
  }
  return best?.filePath;
}

async function findBestSessionFileInDirAsync(sessionDirPath: string): Promise<string | undefined> {
  for (const preferred of ["session.v4.jsonl.zstd", "session.v4.jsonl"] as const) {
    const candidate = NodePath.join(sessionDirPath, preferred);
    try {
      if ((await NodeFSP.stat(candidate)).isFile()) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }
  let entries: ReadonlyArray<string>;
  try {
    entries = await NodeFSP.readdir(sessionDirPath);
  } catch {
    return undefined;
  }
  let best: SessionLogCandidate | undefined;
  for (const name of entries) {
    const candidate = parseSessionLogCandidate(sessionDirPath, name);
    if (candidate === undefined) continue;
    try {
      if (!(await NodeFSP.stat(candidate.filePath)).isFile()) continue;
    } catch {
      continue;
    }
    if (
      best === undefined ||
      candidate.version > best.version ||
      (candidate.version === best.version && candidate.compressed && !best.compressed)
    ) {
      best = candidate;
    }
  }
  return best?.filePath;
}

const sessionFileCache = new Map<string, string>();

function cacheSessionFile(cacheKey: string, filePath: string): void {
  if (sessionFileCache.size >= MAX_SESSION_FILE_CACHE_ENTRIES) {
    const firstKey = sessionFileCache.keys().next().value;
    if (firstKey !== undefined) {
      sessionFileCache.delete(firstKey);
    }
  }
  sessionFileCache.set(cacheKey, filePath);
}

/**
 * Locates the session JSONL(.zstd) file for `sessionId` under `<dshHome>/sessions`
 * via encoded `cwd` fast path, in-memory cache, and fallback project-directory scan.
 */
export function findDshSessionFile(
  dshHome: string,
  sessionId: string,
  cwd?: string,
): string | undefined {
  const trimmedId = sessionId.trim();
  if (trimmedId.length === 0) return undefined;

  const sessionsRoot = NodePath.join(dshHome, "sessions");
  const cacheKey = `${sessionsRoot}\0${trimmedId}`;
  const cached = sessionFileCache.get(cacheKey);
  if (cached !== undefined) {
    try {
      if (NodeFS.statSync(cached).isFile()) {
        return cached;
      }
    } catch {
      sessionFileCache.delete(cacheKey);
    }
  }

  const encodedId = encodeDshSegment(trimmedId);
  const idCandidates = encodedId === trimmedId ? [encodedId] : [encodedId, trimmedId];

  // 1. Fast path via encoded cwd + _no-cwd
  const fastProjectKeys: Array<string> = [];
  if (cwd && cwd.trim().length > 0) {
    fastProjectKeys.push(encodeDshProjectKey(cwd.trim()));
    const resolvedCwd = NodePath.resolve(cwd.trim());
    const resolvedKey = encodeDshProjectKey(resolvedCwd);
    if (!fastProjectKeys.includes(resolvedKey)) {
      fastProjectKeys.push(resolvedKey);
    }
  }
  fastProjectKeys.push("_no-cwd");

  for (const projectKey of fastProjectKeys) {
    for (const idSegment of idCandidates) {
      const found = findBestSessionFileInDir(NodePath.join(sessionsRoot, projectKey, idSegment));
      if (found !== undefined) {
        cacheSessionFile(cacheKey, found);
        return found;
      }
    }
  }

  // 2. Fallback scan across all project directories in `<dshHome>/sessions`
  let projectDirs: ReadonlyArray<string>;
  try {
    projectDirs = NodeFS.readdirSync(sessionsRoot);
  } catch {
    return undefined;
  }
  const checkedFast = new Set(fastProjectKeys);
  for (const projectKey of projectDirs) {
    if (checkedFast.has(projectKey)) continue;
    for (const idSegment of idCandidates) {
      const found = findBestSessionFileInDir(NodePath.join(sessionsRoot, projectKey, idSegment));
      if (found !== undefined) {
        cacheSessionFile(cacheKey, found);
        return found;
      }
    }
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asNonNegInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/**
 * Formats DSH model attribution into a human-friendly model string (never a raw ACP tuple
 * string like `["magpie","group/deepseek"]`).
 */
export function formatDshModelId(source: unknown, fallbackSelection?: unknown): string | undefined {
  const extract = (raw: unknown): string | undefined => {
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return undefined;
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (
            Array.isArray(parsed) &&
            typeof parsed[1] === "string" &&
            parsed[1].trim().length > 0
          ) {
            return parsed[1].trim();
          }
        } catch {
          // fall through
        }
      }
      return trimmed;
    }
    const rec = asRecord(raw);
    if (rec === undefined) return undefined;
    const directModel = extract(rec.model);
    if (directModel !== undefined) return directModel;
    const replay = asRecord(asRecord(rec.replayState)?.response);
    return extract(replay?.model);
  };

  return extract(source) ?? extract(fallbackSelection);
}

/**
 * Resolves reasoning tokens: uses explicit `usage.reasoningTokens` (clamped `<= outputTokens`),
 * or estimates conservatively from reasoning vs total block char share when omitted.
 */
export function estimateDshReasoningTokens(
  outputTokens: number,
  explicitReasoningTokens: unknown,
  contentBlocks: unknown,
): number {
  const clampedOutput = Math.max(0, Math.trunc(outputTokens));
  const explicit = asFiniteNumber(explicitReasoningTokens);
  if (explicit !== undefined && explicit >= 0) {
    return Math.min(clampedOutput, Math.trunc(explicit));
  }
  if (clampedOutput === 0 || !Array.isArray(contentBlocks)) {
    return 0;
  }

  let reasoningChars = 0;
  let otherChars = 0;

  for (const rawBlock of contentBlocks) {
    const block = asRecord(rawBlock);
    if (block === undefined) continue;
    const blockType = block.type;
    if (blockType === "reasoning") {
      const text =
        typeof block.text === "string"
          ? block.text
          : typeof block.reasoning === "string"
            ? block.reasoning
            : "";
      reasoningChars += text.trim().length;
    } else if (blockType === "text") {
      const text = typeof block.text === "string" ? block.text : "";
      otherChars += text.trim().length;
    } else if (blockType === "tool-call") {
      const nameLen = typeof block.name === "string" ? block.name.trim().length : 0;
      let argsLen = 0;
      if (typeof block.arguments === "string") {
        argsLen = block.arguments.trim().length;
      } else if (block.arguments !== undefined && block.arguments !== null) {
        try {
          argsLen = JSON.stringify(block.arguments).length;
        } catch {
          argsLen = 0;
        }
      }
      otherChars += nameLen + argsLen;
    }
  }

  if (reasoningChars === 0) {
    return 0;
  }
  if (otherChars === 0) {
    return clampedOutput;
  }

  const totalChars = reasoningChars + otherChars;
  const rawEstimate = Math.round(clampedOutput * (reasoningChars / totalChars));
  if (clampedOutput === 1) {
    return rawEstimate >= 1 ? 1 : 0;
  }
  return Math.max(1, Math.min(clampedOutput - 1, rawEstimate));
}

interface DshStreamTiming {
  readonly firstTokenTime: number | undefined;
  readonly lastTokenTime: number | undefined;
  readonly hasTerminalFrame: boolean;
}

function isPlausibleDecodeWindow(outputTokens: number, decodeMs: number): boolean {
  if (!Number.isFinite(outputTokens) || outputTokens <= 0) return false;
  if (!Number.isFinite(decodeMs) || decodeMs < MIN_STEP_DECODE_MS) return false;
  const tps = outputTokens / (decodeMs / 1_000);
  return Number.isFinite(tps) && tps > 0 && tps <= MAX_PLAUSIBLE_DECODE_TPS;
}

function runMemberTimeBounds(
  time0: number,
  dt: ReadonlyArray<unknown>,
  fragments: ReadonlyArray<unknown>,
): { readonly firstTime: number; readonly lastTime: number } | undefined {
  let time = time0;
  let firstTime: number | undefined;
  let lastTime: number | undefined;
  for (let index = 0; index < fragments.length; index += 1) {
    if (index > 0) {
      const gap = asFiniteNumber(dt[index - 1]);
      if (gap !== undefined && gap > 0) time += gap;
    }
    const fragment = fragments[index];
    if (typeof fragment === "string" && fragment !== "") {
      if (firstTime === undefined || time < firstTime) firstTime = time;
      if (lastTime === undefined || time > lastTime) lastTime = time;
    }
  }
  return firstTime !== undefined && lastTime !== undefined ? { firstTime, lastTime } : undefined;
}

/**
 * Analyzes a DSH compact `data.stream` array across all reasoning, text, and tool-call
 * chunks to extract both first/last non-empty token delta timestamps and whether terminal
 * stream frames (`block-end` / `usage` / `finish`) are present.
 */
function analyzeDshStreamTiming(stream: unknown): DshStreamTiming {
  if (!Array.isArray(stream)) {
    return { firstTokenTime: undefined, lastTokenTime: undefined, hasTerminalFrame: false };
  }

  let firstTokenTime: number | undefined;
  let lastTokenTime: number | undefined;
  let hasTerminalFrame = false;

  const recordTokenTime = (time: number): void => {
    if (firstTokenTime === undefined || time < firstTokenTime) firstTokenTime = time;
    if (lastTokenTime === undefined || time > lastTokenTime) lastTokenTime = time;
  };

  for (const rawRecord of stream) {
    const record = asRecord(rawRecord);
    if (record === undefined) continue;
    const type = record.type;
    if (type === "chunk") {
      const time = asFiniteNumber(record.time);
      const chunk = asRecord(record.chunk);
      if (chunk === undefined) continue;
      const chunkType = chunk.type;
      if (chunkType === "block-end" || chunkType === "usage" || chunkType === "finish") {
        hasTerminalFrame = true;
        continue;
      }
      if (time === undefined) continue;
      if (
        (chunkType === "text-delta" && typeof chunk.text === "string" && chunk.text !== "") ||
        (chunkType === "reasoning-delta" &&
          ((typeof chunk.text === "string" && chunk.text !== "") ||
            (typeof chunk.reasoning === "string" && chunk.reasoning !== "")))
      ) {
        recordTokenTime(time);
      } else if (
        chunkType === "tool-call-delta" &&
        ((typeof chunk.argumentsDelta === "string" && chunk.argumentsDelta !== "") ||
          (typeof chunk.name === "string" && chunk.name.length > 0))
      ) {
        recordTokenTime(time);
      }
    } else if (type === "text-chunks" || type === "reasoning-chunks") {
      const time0 = asFiniteNumber(record.time0);
      if (time0 === undefined) continue;
      const dt = Array.isArray(record.dt) ? record.dt : [];
      const texts = Array.isArray(record.texts) ? record.texts : [];
      const bounds = runMemberTimeBounds(time0, dt, texts);
      if (bounds !== undefined) {
        recordTokenTime(bounds.firstTime);
        recordTokenTime(bounds.lastTime);
      }
    } else if (type === "tool-call-chunks") {
      const time0 = asFiniteNumber(record.time0);
      if (time0 === undefined) continue;
      if (typeof record.name === "string" && record.name.length > 0) {
        recordTokenTime(time0);
      }
      const dt = Array.isArray(record.dt) ? record.dt : [];
      const args = Array.isArray(record.args) ? record.args : [];
      const bounds = runMemberTimeBounds(time0, dt, args);
      if (bounds !== undefined) {
        recordTokenTime(bounds.firstTime);
        recordTokenTime(bounds.lastTime);
      }
    }
  }

  return { firstTokenTime, lastTokenTime, hasTerminalFrame };
}

/**
 * Extracts the timestamp (ms) of the first non-empty output token delta from a DSH
 * compact `data.stream` array, matching `@deepseek-ai/dsh-llm#assistantStreamFirstTokenTime`.
 */
export function extractDshStreamFirstTokenTime(stream: unknown): number | undefined {
  return analyzeDshStreamTiming(stream).firstTokenTime;
}

interface ParsedDshAssistantStep {
  readonly seq: number;
  readonly timestampMs: number;
  readonly model: string | undefined;
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly ttftMs: number | undefined;
  readonly decodeMs: number | undefined;
  readonly modelDurationMs: number | undefined;
}

export interface DshContextInjectionEvent extends TrackedContextInjectionPayload {
  readonly seq: number;
  readonly timestampMs?: number | undefined;
  readonly nativeId: string;
}

interface ParsedDshSessionLog {
  readonly sessionId: string | undefined;
  readonly maxSeq: number;
  readonly steps: ReadonlyArray<ParsedDshAssistantStep>;
  readonly contextInjections: ReadonlyArray<DshContextInjectionEvent>;
  readonly turnEndSeqs: ReadonlyArray<number>;
}

const DSH_MAX_SKILL_CATALOG_ENTRIES = 200;

function sha256Hex(value: string): string {
  return NodeCrypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractDshMessageContentText(data: Record<string, unknown>): string | null {
  const rawContent = data.content ?? asRecord(data.message)?.content;
  if (typeof rawContent === "string") {
    const trimmed = rawContent.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (!Array.isArray(rawContent)) return null;
  const chunks: Array<string> = [];
  for (const block of rawContent) {
    if (typeof block === "string") {
      const trimmed = block.trim();
      if (trimmed.length > 0) chunks.push(trimmed);
      continue;
    }
    const rec = asRecord(block);
    if (rec === undefined) continue;
    if (typeof rec.text === "string" && rec.text.trim().length > 0) {
      chunks.push(rec.text.trim());
    }
  }
  return chunks.length > 0 ? chunks.join("\n\n") : null;
}

function formatDshInstructionLabel(
  files: ReadonlyArray<OrchestrationV2ContextInjectionFileChange>,
): string {
  if (files.length === 0) return "agent-instructions";
  if (files.length === 1) return files[0]!.path;
  if (files.length === 2) return `${files[0]!.path}, ${files[1]!.path}`;
  return `${files[0]!.path} +${files.length - 1}`;
}

function parseDshContextInjectionRecord(
  rec: Record<string, unknown>,
  index: number,
): DshContextInjectionEvent | undefined {
  const data = asRecord(rec.data);
  if (data === undefined) return undefined;
  const source = asRecord(data.source);
  if (source === undefined) return undefined;

  const rawKind = asTrimmedString(source.kind);
  if (rawKind === undefined || rawKind === "user" || rawKind === "tool-jobs") {
    return undefined;
  }

  const rawForm = asTrimmedString(source.form);
  let sourceKind: OrchestrationV2ContextInjectionSourceKind;
  if (
    rawKind === "agent-instructions" ||
    rawKind === "runtime-context" ||
    rawKind === "skill-catalog" ||
    rawKind === "time-context" ||
    rawKind === "prismux-instructions"
  ) {
    sourceKind = rawKind;
  } else if (rawForm === "instructions" || rawForm === "catalog" || rawForm === "snapshot") {
    sourceKind = "other";
  } else {
    return undefined;
  }

  const seq = asFiniteNumber(rec.seq) ?? index;
  const timestampMs = asFiniteNumber(rec.time);
  const messageId = asTrimmedString(data.id);
  const nativeId = `dsh-ctx:${messageId ?? seq}:${sourceKind}`;
  const content = extractDshMessageContentText(data);
  const baseline = source.baseline === true ? true : undefined;
  const explicitSupersedes = source.supersedesPrevious === true ? true : undefined;

  if (sourceKind === "agent-instructions") {
    const rawChanges = Array.isArray(source.changes) ? source.changes : [];
    const files: Array<OrchestrationV2ContextInjectionFileChange> = [];
    for (const rawChange of rawChanges) {
      const change = asRecord(rawChange);
      if (change === undefined) continue;
      const action = change.action;
      const path = asTrimmedString(change.path);
      if (path === undefined || (action !== "set" && action !== "replace" && action !== "remove")) {
        continue;
      }
      const scope = asTrimmedString(change.scope);
      const digest = asTrimmedString(change.digest);
      files.push({
        action,
        path,
        ...(scope === undefined ? {} : { scope }),
        ...(digest === undefined ? {} : { digest }),
      });
    }
    const hasReplace = files.some((file) => file.action === "replace");
    const allRemoved = files.length > 0 && files.every((file) => file.action === "remove");
    const supersedesPrevious = explicitSupersedes ?? (!baseline && hasReplace ? true : undefined);
    const statusLabel = allRemoved
      ? "已移除"
      : supersedesPrevious || hasReplace
        ? "已更新"
        : "已载入";
    const digest = sha256Hex(
      JSON.stringify([
        files.map((file) => [file.action, file.path, file.digest ?? ""]),
        content ?? "",
      ]),
    );
    return {
      seq,
      ...(timestampMs === undefined ? {} : { timestampMs }),
      nativeId,
      sourceKey: sourceKind,
      sourceKind,
      form: "instructions",
      label: formatDshInstructionLabel(files),
      sourcePath: files[0]?.path ?? null,
      statusLabel,
      digest,
      ...(baseline === undefined ? {} : { baseline }),
      ...(supersedesPrevious === undefined ? {} : { supersedesPrevious }),
      ...(files.length > 0 ? { files } : {}),
      content,
    };
  }

  if (sourceKind === "skill-catalog") {
    const rawEntries = Array.isArray(source.entries) ? source.entries : [];
    const entries: Array<OrchestrationV2ContextInjectionCatalogEntry> = [];
    for (const rawEntry of rawEntries) {
      const entry = asRecord(rawEntry);
      if (entry === undefined) continue;
      const name = asTrimmedString(entry.name);
      if (name === undefined) continue;
      entries.push({
        name,
        description: typeof entry.description === "string" ? entry.description.trim() : "",
      });
      if (entries.length >= DSH_MAX_SKILL_CATALOG_ENTRIES) break;
    }
    const digest = sha256Hex(JSON.stringify([entries, content ?? ""]));
    return {
      seq,
      ...(timestampMs === undefined ? {} : { timestampMs }),
      nativeId,
      sourceKey: sourceKind,
      sourceKind,
      form: "catalog",
      label: "skill-catalog",
      sourcePath: null,
      statusLabel: explicitSupersedes ? "已更新" : "已载入",
      digest,
      ...(baseline === undefined ? {} : { baseline }),
      ...(explicitSupersedes === undefined ? {} : { supersedesPrevious: explicitSupersedes }),
      ...(entries.length > 0 ? { entries } : {}),
      content,
    };
  }

  const form: OrchestrationV2ContextInjectionForm =
    rawForm === "instructions" ||
    rawForm === "catalog" ||
    rawForm === "snapshot" ||
    rawForm === "notice"
      ? rawForm
      : "snapshot";
  const rawSections = Array.isArray(source.sections) ? source.sections : [];
  const sections: Array<OrchestrationV2ContextInjectionSection> = [];
  for (const rawSection of rawSections) {
    const section = asRecord(rawSection);
    if (section === undefined) continue;
    const name = asTrimmedString(section.name);
    if (name === undefined || typeof section.text !== "string") continue;
    sections.push({ name, text: section.text });
  }
  const digest = sha256Hex(JSON.stringify([sourceKind, sections, content ?? ""]));
  return {
    seq,
    ...(timestampMs === undefined ? {} : { timestampMs }),
    nativeId,
    sourceKey: sourceKind,
    sourceKind,
    form,
    label: sourceKind === "other" ? rawKind : sourceKind,
    sourcePath: null,
    statusLabel: explicitSupersedes ? "已更新" : "已载入",
    digest,
    ...(baseline === undefined ? {} : { baseline }),
    ...(explicitSupersedes === undefined ? {} : { supersedesPrevious: explicitSupersedes }),
    ...(sections.length > 0 ? { sections } : {}),
    content,
  };
}

function parseDshSessionRecords(
  records: ReadonlyArray<Record<string, unknown>>,
  options?: { readonly skipSeededPrefix?: boolean },
): ParsedDshSessionLog {
  let sessionId: string | undefined;
  let isSeeded = false;
  let lastEndSeedIndex = -1;

  for (let index = 0; index < records.length; index += 1) {
    const rec = records[index]!;
    if (rec.type === "session") {
      if (typeof rec.id === "string" && rec.id.trim().length > 0) {
        sessionId = rec.id.trim();
      }
      if (rec.isSeeded === true) {
        isSeeded = true;
      }
    } else if (rec.type === "session/end-seed") {
      lastEndSeedIndex = index;
    }
  }

  let maxSeq = 0;
  let currentModel: string | undefined;
  let openStep: {
    readonly turn: number | undefined;
    readonly step: number | undefined;
    readonly startTime: number;
    firstTokenTime: number | undefined;
  } | null = null;
  const steps: Array<ParsedDshAssistantStep> = [];
  const contextInjections: Array<DshContextInjectionEvent> = [];
  const turnEndSeqs: Array<number> = [];

  for (let index = 0; index < records.length; index += 1) {
    const rec = records[index]!;
    const seq = asFiniteNumber(rec.seq);
    if (seq !== undefined && seq > maxSeq) {
      maxSeq = seq;
    }
    const type = rec.type;
    const data = asRecord(rec.data);
    const time = asFiniteNumber(rec.time);

    if (type === "user/message") {
      if (
        options?.skipSeededPrefix &&
        isSeeded &&
        lastEndSeedIndex !== -1 &&
        index <= lastEndSeedIndex
      ) {
        continue;
      }
      const parsedInjection = parseDshContextInjectionRecord(rec, index);
      if (parsedInjection !== undefined) {
        contextInjections.push(parsedInjection);
      }
      continue;
    }

    if (type === "model/selection") {
      const selected = formatDshModelId(data);
      if (selected !== undefined) {
        currentModel = selected;
      }
      continue;
    }

    if (type === "step/start" && time !== undefined) {
      openStep = {
        turn: asFiniteNumber(data?.turn),
        step: asFiniteNumber(data?.step),
        startTime: time,
        firstTokenTime: undefined,
      };
      continue;
    }

    if (type === "assistant/attempt" && openStep !== null && data !== undefined) {
      const attemptTurn = asFiniteNumber(data.turn);
      const attemptStep = asFiniteNumber(data.step);
      if (
        (openStep.turn === undefined || openStep.turn === attemptTurn) &&
        (openStep.step === undefined || openStep.step === attemptStep) &&
        openStep.firstTokenTime === undefined
      ) {
        openStep.firstTokenTime = extractDshStreamFirstTokenTime(data.stream);
      }
      continue;
    }

    if (type === "step/end") {
      openStep = null;
      continue;
    }

    if (type === "turn/end") {
      if (seq !== undefined) {
        turnEndSeqs.push(seq);
      }
      openStep = null;
      continue;
    }

    if (type === "assistant/message" && data !== undefined) {
      const msgTurn = asFiniteNumber(data.turn);
      const msgStep = asFiniteNumber(data.step);
      const matchedStep =
        openStep !== null &&
        (openStep.turn === undefined || msgTurn === undefined || openStep.turn === msgTurn) &&
        (openStep.step === undefined || msgStep === undefined || openStep.step === msgStep)
          ? openStep
          : null;
      const messageStreamTiming = analyzeDshStreamTiming(data.stream);
      const ttftFirstTokenTime = matchedStep?.firstTokenTime ?? messageStreamTiming.firstTokenTime;
      // Measure committed output decode time from the committed assistant/message stream itself
      // rather than an earlier failed `assistant/attempt` before a retry backoff.
      const decodeFirstTokenTime =
        messageStreamTiming.firstTokenTime ?? matchedStep?.firstTokenTime;
      openStep = null;

      if (
        options?.skipSeededPrefix &&
        isSeeded &&
        lastEndSeedIndex !== -1 &&
        index <= lastEndSeedIndex
      ) {
        continue;
      }

      const usage = asRecord(data.usage);
      if (usage === undefined) continue;

      const uncachedInputTokens = asNonNegInt(usage.inputTokens);
      const cachedInputTokens = asNonNegInt(usage.cacheReadTokens);
      const cacheCreationTokens = asNonNegInt(usage.cacheWriteTokens);
      const outputTokens = asNonNegInt(usage.outputTokens);
      if (uncachedInputTokens + cachedInputTokens + cacheCreationTokens + outputTokens === 0) {
        continue;
      }

      const message = asRecord(data.message);
      const reasoningTokens = estimateDshReasoningTokens(
        outputTokens,
        usage.reasoningTokens,
        message?.content,
      );
      const model = formatDshModelId(message?.source, currentModel);

      const stepStartMs = matchedStep?.startTime;
      const endMs = time;
      const modelDurationMs =
        stepStartMs !== undefined && endMs !== undefined
          ? Math.max(0, Math.round(endMs - stepStartMs))
          : undefined;
      const rawTtftMs =
        stepStartMs !== undefined && ttftFirstTokenTime !== undefined
          ? Math.max(0, Math.round(ttftFirstTokenTime - stepStartMs))
          : undefined;
      const ttftMs =
        rawTtftMs === undefined
          ? undefined
          : modelDurationMs === undefined
            ? rawTtftMs
            : Math.min(rawTtftMs, modelDurationMs);
      const rawDecodeMs =
        decodeFirstTokenTime !== undefined && endMs !== undefined && outputTokens > 0
          ? Math.max(0, Math.round(endMs - decodeFirstTokenTime))
          : undefined;
      const clampedDecodeMs =
        rawDecodeMs === undefined
          ? undefined
          : modelDurationMs === undefined
            ? rawDecodeMs
            : Math.min(rawDecodeMs, modelDurationMs);
      const tokenSpanMs =
        messageStreamTiming.firstTokenTime !== undefined &&
        messageStreamTiming.lastTokenTime !== undefined
          ? Math.max(
              0,
              Math.round(messageStreamTiming.lastTokenTime - messageStreamTiming.firstTokenTime),
            )
          : undefined;
      const isBufferedTokenBurst =
        messageStreamTiming.hasTerminalFrame &&
        tokenSpanMs !== undefined &&
        (tokenSpanMs <= 0
          ? outputTokens > MAX_SINGLE_PACKET_OUTPUT_TOKENS
          : outputTokens / (tokenSpanMs / 1_000) > MAX_PLAUSIBLE_DECODE_TPS);
      const decodeMs =
        clampedDecodeMs !== undefined &&
        !isBufferedTokenBurst &&
        isPlausibleDecodeWindow(outputTokens, clampedDecodeMs)
          ? clampedDecodeMs
          : undefined;

      steps.push({
        seq: seq ?? index,
        timestampMs: endMs ?? stepStartMs ?? 0,
        model,
        uncachedInputTokens,
        cachedInputTokens,
        cacheCreationTokens,
        outputTokens,
        reasoningTokens,
        ttftMs,
        decodeMs,
        modelDurationMs,
      });
    }
  }

  return { sessionId, maxSeq, steps, contextInjections, turnEndSeqs };
}

export interface DshLiveTokenUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly ttftMs?: number;
  readonly decodeMs?: number;
  readonly durationMs?: number;
}

export interface DshTurnUsageDelta {
  readonly usage: TurnTokenUsage;
  readonly liveTokenUsage: DshLiveTokenUsage;
  readonly models: ReadonlyArray<string>;
  readonly stepCount: number;
  readonly hasTurnEnd: boolean;
  readonly tornFrame: boolean;
  readonly contextInjections?: ReadonlyArray<DshContextInjectionEvent>;
}

export interface DshTurnUsageWatcher {
  readonly baselineSeq: number;
  readonly readTurnDelta: () => DshTurnUsageDelta | undefined;
  readonly readContextInjections: () => ReadonlyArray<DshContextInjectionEvent>;
  readonly collectFinal: () => Promise<DshTurnUsageDelta | undefined>;
}

export interface MakeDshTurnUsageWatcherInput {
  readonly dshHome: string;
  readonly sessionId: string;
  readonly cwd?: string;
  /** Max wall-clock ms `collectFinal()` may wait for DSH's write-behind batch flush. */
  readonly settleWaitMs?: number;
}

function readDshSessionFileSync(filePath: string): DecodedDshSessionJsonl | undefined {
  try {
    const buffer = NodeFS.readFileSync(filePath);
    return decodeDshSessionJsonlInternal(buffer);
  } catch {
    return undefined;
  }
}

async function readDshSessionFileAsync(
  filePath: string,
): Promise<DecodedDshSessionJsonl | undefined> {
  try {
    const buffer = await NodeFSP.readFile(filePath);
    return await decodeDshSessionJsonlInternalAsync(buffer);
  } catch {
    return undefined;
  }
}

function sleepRealMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Watches a live DSH session's on-disk `session.v4.jsonl.zstd` (or `.jsonl`) log for one
 * turn, capturing the baseline `seq` before `session/prompt` runs and aggregating all newly
 * committed `assistant/message` steps on demand (mid-turn and at turn completion).
 */
export function makeDshTurnUsageWatcher(input: MakeDshTurnUsageWatcherInput): DshTurnUsageWatcher {
  const { dshHome, sessionId, cwd } = input;
  const settleWaitMs = input.settleWaitMs ?? DEFAULT_FINAL_SETTLE_WAIT_MS;

  const initialFile = findDshSessionFile(dshHome, sessionId, cwd);
  let lastStat:
    | { readonly filePath: string; readonly mtimeMs: number; readonly size: number }
    | undefined;
  let lastParsed: ParsedDshSessionLog | undefined;
  let lastTornFrame = false;
  let lastDelta: DshTurnUsageDelta | undefined;
  let lastDeltaComputedForStat = false;
  if (initialFile !== undefined) {
    try {
      const st = NodeFS.statSync(initialFile);
      if (st.isFile()) {
        lastStat = { filePath: initialFile, mtimeMs: st.mtimeMs, size: st.size };
      }
    } catch {
      // ignore
    }
  }
  const initialDecoded =
    initialFile === undefined ? undefined : readDshSessionFileSync(initialFile);
  if (initialDecoded !== undefined) {
    lastParsed = parseDshSessionRecords(initialDecoded.records);
    lastTornFrame = initialDecoded.tornFrame;
  }
  const baselineSeq = lastParsed?.maxSeq ?? 0;

  const ensureParsed = ():
    | {
        readonly parsed: ParsedDshSessionLog;
        readonly tornFrame: boolean;
        readonly changed: boolean;
      }
    | undefined => {
    const filePath = findDshSessionFile(dshHome, sessionId, cwd);
    if (filePath === undefined) return undefined;
    let stat: NodeFS.Stats | undefined;
    try {
      stat = NodeFS.statSync(filePath);
    } catch {
      return undefined;
    }
    if (
      lastStat !== undefined &&
      lastParsed !== undefined &&
      lastStat.filePath === filePath &&
      lastStat.mtimeMs === stat.mtimeMs &&
      lastStat.size === stat.size
    ) {
      return { parsed: lastParsed, tornFrame: lastTornFrame, changed: false };
    }
    const decoded = readDshSessionFileSync(filePath);
    if (decoded === undefined) return undefined;
    const parsed = parseDshSessionRecords(decoded.records);
    lastStat = { filePath, mtimeMs: stat.mtimeMs, size: stat.size };
    lastParsed = parsed;
    lastTornFrame = decoded.tornFrame;
    lastDeltaComputedForStat = false;
    return { parsed, tornFrame: decoded.tornFrame, changed: true };
  };

  const readContextInjections = (): ReadonlyArray<DshContextInjectionEvent> => {
    const state = ensureParsed();
    if (state === undefined) return [];
    return state.parsed.contextInjections.filter((entry) => entry.seq > baselineSeq);
  };

  const readTurnDelta = (): DshTurnUsageDelta | undefined => {
    const state = ensureParsed();
    if (state === undefined) return undefined;
    if (!state.changed && lastDeltaComputedForStat) {
      return lastDelta;
    }
    const { parsed, tornFrame } = state;
    const turnSteps = parsed.steps.filter((step) => step.seq > baselineSeq);
    if (turnSteps.length === 0) {
      lastDelta = undefined;
      lastDeltaComputedForStat = true;
      return undefined;
    }

    let uncachedInput = 0;
    let cachedInput = 0;
    let cacheCreation = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let modelDurationSum = 0;
    let hasModelDuration = false;
    let decodeSum = 0;
    let outputStepsCount = 0;
    let decodedOutputStepsCount = 0;
    let ttftSum = 0;
    let ttftCount = 0;
    const models: Array<string> = [];

    for (const step of turnSteps) {
      uncachedInput += step.uncachedInputTokens;
      cachedInput += step.cachedInputTokens;
      cacheCreation += step.cacheCreationTokens;
      outputTokens += step.outputTokens;
      reasoningTokens += step.reasoningTokens;
      if (step.modelDurationMs !== undefined) {
        modelDurationSum += step.modelDurationMs;
        hasModelDuration = true;
      }
      if (step.outputTokens > 0) {
        outputStepsCount += 1;
        if (step.decodeMs !== undefined) {
          decodeSum += step.decodeMs;
          decodedOutputStepsCount += 1;
        }
      }
      if (step.ttftMs !== undefined) {
        ttftSum += step.ttftMs;
        ttftCount += 1;
      }
      if (step.model !== undefined && !models.includes(step.model)) {
        models.push(step.model);
      }
    }

    const totalInputTokens = uncachedInput + cachedInput + cacheCreation;
    const clampedReasoning = Math.min(outputTokens, reasoningTokens);
    const modelDurationMs = hasModelDuration
      ? Math.max(0, Math.round(modelDurationSum))
      : undefined;
    // Only emit an aggregated turn decodeMs when EVERY output-producing step recorded a
    // plausible decode window; otherwise outputTokens summed across all steps would be
    // divided by only a subset of steps' decode time.
    const rawAggregatedDecodeMs =
      outputStepsCount > 0 && decodedOutputStepsCount === outputStepsCount
        ? Math.max(0, Math.round(decodeSum))
        : undefined;
    const clampedAggregatedDecodeMs =
      rawAggregatedDecodeMs === undefined
        ? undefined
        : modelDurationMs === undefined
          ? rawAggregatedDecodeMs
          : Math.min(rawAggregatedDecodeMs, modelDurationMs);
    const decodeMs =
      clampedAggregatedDecodeMs !== undefined &&
      isPlausibleDecodeWindow(outputTokens, clampedAggregatedDecodeMs)
        ? clampedAggregatedDecodeMs
        : undefined;
    const rawAvgTtftMs = ttftCount > 0 ? Math.max(0, Math.round(ttftSum / ttftCount)) : undefined;
    const ttftMs =
      rawAvgTtftMs === undefined
        ? undefined
        : modelDurationMs === undefined
          ? rawAvgTtftMs
          : Math.min(rawAvgTtftMs, modelDurationMs);

    const hasTurnEnd = parsed.turnEndSeqs.some((seq) => seq > baselineSeq);

    const usage: TurnTokenUsage = {
      usageScope: "main_agent",
      usageStatus: "complete",
      hasSubagents: false,
      inputTokens: totalInputTokens,
      outputTokens,
      cachedInputTokens: cachedInput,
      cacheCreationTokens: cacheCreation,
      reasoningTokens: clampedReasoning,
      ...(models.length > 0 ? { models } : {}),
      ...(ttftMs !== undefined ? { ttftMs } : {}),
      ...(decodeMs !== undefined ? { decodeMs } : {}),
      ...(modelDurationMs !== undefined ? { modelDurationMs } : {}),
    };

    const liveTokenUsage: DshLiveTokenUsage = {
      inputTokens: totalInputTokens,
      cachedInputTokens: cachedInput,
      cacheCreationTokens: cacheCreation,
      outputTokens,
      reasoningOutputTokens: clampedReasoning,
      ...(ttftMs !== undefined ? { ttftMs } : {}),
      ...(decodeMs !== undefined ? { decodeMs } : {}),
      ...(modelDurationMs !== undefined ? { durationMs: modelDurationMs } : {}),
    };

    const turnContextInjections = parsed.contextInjections.filter(
      (entry) => entry.seq > baselineSeq,
    );

    const result: DshTurnUsageDelta = {
      usage,
      liveTokenUsage,
      models,
      stepCount: turnSteps.length,
      hasTurnEnd,
      tornFrame,
      ...(turnContextInjections.length > 0 ? { contextInjections: turnContextInjections } : {}),
    };
    lastDelta = result;
    lastDeltaComputedForStat = true;
    return result;
  };

  const collectFinal = async (): Promise<DshTurnUsageDelta | undefined> => {
    let latest = readTurnDelta();
    if (latest !== undefined && latest.hasTurnEnd && !latest.tornFrame) {
      return latest;
    }
    if (settleWaitMs <= 0) {
      return latest;
    }
    const deadline = Date.now() + settleWaitMs;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      await sleepRealMs(Math.min(FINAL_SETTLE_POLL_INTERVAL_MS, Math.max(1, remaining)));
      const next = readTurnDelta();
      if (next !== undefined) {
        latest = next;
        if (next.hasTurnEnd && !next.tornFrame) {
          return next;
        }
      }
    }
    return latest;
  };

  return {
    baselineSeq,
    readTurnDelta,
    readContextInjections,
    collectFinal,
  };
}

export interface CachedDshUsageFile {
  readonly mtimeMs: number;
  readonly size: number;
  readonly records: ReadonlyArray<UsageRecord>;
}

export type DshUsageFileCache = Map<string, CachedDshUsageFile>;

class BoundedLruDshUsageFileCache extends Map<string, CachedDshUsageFile> {
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    super();
    this.maxEntries = Math.max(1, Math.trunc(maxEntries));
  }

  override get(key: string): CachedDshUsageFile | undefined {
    const value = super.get(key);
    if (value !== undefined) {
      super.delete(key);
      super.set(key, value);
    }
    return value;
  }

  override set(key: string, value: CachedDshUsageFile): this {
    if (super.has(key)) {
      super.delete(key);
    } else if (this.size >= this.maxEntries) {
      const oldestKey = this.keys().next().value;
      if (oldestKey !== undefined) {
        super.delete(oldestKey);
      }
    }
    return super.set(key, value);
  }
}

export function makeDshUsageFileCache(
  maxEntries = DEFAULT_DSH_USAGE_FILE_CACHE_MAX_ENTRIES,
): DshUsageFileCache {
  return new BoundedLruDshUsageFileCache(maxEntries);
}

export interface ScanDshUsageInput {
  readonly dshHome: string;
  readonly sinceMs?: number;
  readonly untilMs?: number;
  readonly cache?: DshUsageFileCache;
}

export interface DshUsageScannedFile {
  readonly path: string;
  readonly records: ReadonlyArray<UsageRecord>;
}

export interface DshUsageScanFilesResult {
  readonly sessionsDir: string;
  readonly missing: boolean;
  readonly error: boolean;
  readonly files: ReadonlyArray<DshUsageScannedFile>;
}

const FIRST_PARTY_LITELLM_PREFIXES = new Set([
  "anthropic",
  "deepseek",
  "gemini",
  "google",
  "meta",
  "mistral",
  "openai",
  "xai",
]);

/**
 * Resolves a LiteLLM rate-table model key for DSH models that carry a custom gateway prefix
 * (e.g. `dragon-api-max/claude-opus-5-5` → `claude-opus-5-5`).
 */
export function dshRateModel(model: string): string {
  const trimmed = model.trim();
  const firstSlash = trimmed.indexOf("/");
  if (firstSlash === -1) return trimmed;
  const prefix = trimmed.slice(0, firstSlash).toLowerCase();
  if (FIRST_PARTY_LITELLM_PREFIXES.has(prefix)) return trimmed;
  const lastSlash = trimmed.lastIndexOf("/");
  const bare = trimmed.slice(lastSlash + 1).trim();
  return bare.length > 0 ? bare : trimmed;
}

async function parseDshUsageFileRecordsAsync(
  filePath: string,
  fallbackSessionId: string,
): Promise<ReadonlyArray<UsageRecord>> {
  const decoded = await readDshSessionFileAsync(filePath);
  if (decoded === undefined) return [];
  const parsed = parseDshSessionRecords(decoded.records, { skipSeededPrefix: true });
  const sessionId = parsed.sessionId ?? fallbackSessionId;
  const records: Array<UsageRecord> = [];

  for (const step of parsed.steps) {
    if (step.timestampMs <= 0) continue;
    const totals = {
      uncachedInputTokens: step.uncachedInputTokens,
      cachedInputTokens: step.cachedInputTokens,
      cacheCreationTokens: step.cacheCreationTokens,
      outputTokens: step.outputTokens,
      reasoningTokens: step.reasoningTokens,
    };
    if (totalTokens(totals) === 0) continue;
    const model = step.model ?? "unknown";
    const rateModel = dshRateModel(model);
    records.push({
      provider: "dsh",
      timestampMs: step.timestampMs,
      model,
      ...(rateModel !== model ? { rateModel } : {}),
      sessionId,
      totals,
      reportedCostUsd: null,
      speed: "standard",
      dedupeKey: `dsh:${sessionId}:${step.seq}`,
      ...(step.ttftMs !== undefined ? { ttftMs: step.ttftMs } : {}),
      ...(step.modelDurationMs !== undefined && step.modelDurationMs > 0
        ? { durationMs: step.modelDurationMs }
        : {}),
    });
  }

  return records;
}

/**
 * Asynchronously scans `<dshHome>/sessions/*\/*\/session*.jsonl(.zstd)?` for historical DSH usage,
 * returning per-file `UsageRecord` batches suitable for `UsageService` (`kind: "scan"`).
 * Skips files whose `mtimeMs < sinceMs` and reuses bounded-LRU cached parses for unchanged `(mtimeMs, size)`.
 */
export async function scanDshUsageFiles(
  input: ScanDshUsageInput,
): Promise<DshUsageScanFilesResult> {
  const sessionsDir = NodePath.join(input.dshHome, "sessions");
  const sinceMs = input.sinceMs;
  const untilMs = input.untilMs;
  const cache = input.cache;

  let projectEntries: ReadonlyArray<NodeFS.Dirent>;
  try {
    projectEntries = await NodeFSP.readdir(sessionsDir, { withFileTypes: true });
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException | undefined)?.code;
    const missing = code === "ENOENT" || code === "ENOTDIR";
    return { sessionsDir, missing, error: !missing, files: [] };
  }

  const sessionTargets: Array<{
    readonly sessionDirPath: string;
    readonly fallbackSessionId: string;
  }> = [];
  let error = false;

  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;
    const projectPath = NodePath.join(sessionsDir, projectEntry.name);
    let sessionEntries: ReadonlyArray<NodeFS.Dirent>;
    try {
      sessionEntries = await NodeFSP.readdir(projectPath, { withFileTypes: true });
    } catch {
      error = true;
      continue;
    }

    for (const sessionEntry of sessionEntries) {
      if (!sessionEntry.isDirectory()) continue;
      sessionTargets.push({
        sessionDirPath: NodePath.join(projectPath, sessionEntry.name),
        fallbackSessionId: sessionEntry.name,
      });
    }
  }

  const results: Array<DshUsageScannedFile | undefined> = Array.from({
    length: sessionTargets.length,
  });
  const queue = sessionTargets.entries();
  const worker = async (): Promise<void> => {
    for (const [index, target] of queue) {
      const bestFile = await findBestSessionFileInDirAsync(target.sessionDirPath);
      if (bestFile === undefined) continue;

      let stat: NodeFS.Stats;
      try {
        stat = await NodeFSP.stat(bestFile);
      } catch {
        error = true;
        continue;
      }
      if (!stat.isFile()) continue;
      if (sinceMs !== undefined && stat.mtimeMs < sinceMs) {
        continue;
      }

      const cached = cache?.get(bestFile);
      let allFileRecords: ReadonlyArray<UsageRecord>;
      if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        allFileRecords = cached.records;
      } else {
        allFileRecords = await parseDshUsageFileRecordsAsync(bestFile, target.fallbackSessionId);
        cache?.set(bestFile, {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          records: allFileRecords,
        });
      }

      const filtered =
        sinceMs === undefined && untilMs === undefined
          ? allFileRecords
          : allFileRecords.filter(
              (record) =>
                (sinceMs === undefined || record.timestampMs >= sinceMs) &&
                (untilMs === undefined || record.timestampMs <= untilMs),
            );

      results[index] = { path: bestFile, records: filtered };
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(DSH_SCAN_CONCURRENCY, sessionTargets.length) }, worker),
  );

  return {
    sessionsDir,
    missing: false,
    error,
    files: results.filter((entry): entry is DshUsageScannedFile => entry !== undefined),
  };
}

/**
 * Asynchronously scans all `<dshHome>/sessions/**\/session*.jsonl(.zstd)?` logs and returns
 * flattened `UsageRecord[]` entries with `provider: "dsh"`.
 */
export async function scanDshUsageRecords(
  input: ScanDshUsageInput,
): Promise<ReadonlyArray<UsageRecord>> {
  return (await scanDshUsageFiles(input)).files.flatMap((file) => file.records);
}
