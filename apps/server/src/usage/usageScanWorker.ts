// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
import * as NodeOS from "node:os";
import * as NodeWorkerThreads from "node:worker_threads";

import type { CachedFile } from "./usageScanCache.ts";

export interface WorkerExtractTranscriptRequest {
  readonly kind: "extractTranscript";
  readonly filePath: string;
  readonly compressed: boolean;
  readonly markers: readonly string[];
  readonly resumeOffset: number;
  readonly guardLength: number;
  readonly guardHash: number;
  readonly streamingThresholdBytes: number;
}

export interface WorkerExtractTranscriptResult {
  readonly status: "ok" | "error" | "fallbackInline";
  readonly resumed?: boolean;
  readonly lines?: readonly string[];
  readonly tailLine?: string | null;
  readonly resumeOffset?: number;
  readonly guardLength?: number;
  readonly guardHash?: number;
}

export interface WorkerSerializeScanCacheRequest {
  readonly kind: "serializeScanCache";
  readonly version: number;
  readonly entries: readonly (readonly [string, CachedFile])[];
  readonly extra: Readonly<Record<string, unknown>>;
}

export interface WorkerSerializeScanCacheResult {
  readonly status: "ok" | "error";
  readonly chunks?: readonly string[];
}

type WorkerTaskRequest = WorkerExtractTranscriptRequest | WorkerSerializeScanCacheRequest;
type WorkerTaskResult = WorkerExtractTranscriptResult | WorkerSerializeScanCacheResult;

const MIN_WORKER_THREADS = 2;
const MAX_WORKER_THREADS = 4;
const IDLE_TERMINATE_MS = 30_000;

/**
 * Self-contained inline worker source using only Node built-ins so both Vitest TS
 * and bundled production server builds can offload Zstd/JSONL scanning and scan-cache
 * JSON serialization without external worker entrypoints.
 */
const WORKER_SCRIPT = String.raw`
const { parentPort } = require("node:worker_threads");
const fs = require("node:fs/promises");
const zlib = require("node:zlib");

const GUARD_LENGTH = 64;
const READ_CHUNK_BYTES = 256 * 1024;
const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const SPEEDS = ["standard", "fast", "ultrafast"];
const SERIALIZE_CHUNK_TARGET_CHARS = 1024 * 1024;

function fnv1a(buffer) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < buffer.length; i += 1) {
    hash ^= buffer[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

async function guardMatches(handle, resumeOffset, guardLength, guardHash) {
  if (guardLength <= 0 || guardLength > GUARD_LENGTH || guardLength > resumeOffset) return false;
  try {
    const window = Buffer.alloc(guardLength);
    const { bytesRead } = await handle.read(window, 0, guardLength, resumeOffset - guardLength);
    return bytesRead === guardLength && fnv1a(window) === guardHash;
  } catch {
    return false;
  }
}

async function* readChunks(handle, start, compressed) {
  if (compressed) {
    yield* handle
      .createReadStream({ start, autoClose: true, highWaterMark: READ_CHUNK_BYTES })
      .compose(zlib.createZstdDecompress());
    return;
  }
  const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  for (let position = start; ;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) return;
    position += bytesRead;
    yield buffer.subarray(0, bytesRead);
  }
}

function toLineString(lineBuffer) {
  const content =
    lineBuffer.length > 0 && lineBuffer[lineBuffer.length - 1] === CARRIAGE_RETURN
      ? lineBuffer.subarray(0, -1)
      : lineBuffer;
  return content.toString("utf8");
}

async function handleExtractTranscript(req) {
  let handle;
  try {
    handle = await fs.open(req.filePath, "r");
  } catch {
    return { status: "error" };
  }

  try {
    let resumed = false;
    let start = 0;
    if (
      !req.compressed &&
      req.resumeOffset > 0 &&
      (await guardMatches(handle, req.resumeOffset, req.guardLength, req.guardHash))
    ) {
      start = req.resumeOffset;
      resumed = true;
    }

    const needles = req.markers.map((marker) => Buffer.from(marker));
    const matchesMarker = (buf) => {
      for (let i = 0; i < needles.length; i += 1) {
        if (buf.includes(needles[i])) return true;
      }
      return false;
    };

    const lines = [];
    let resumeOffset = start;
    let scanOffset = start;
    let pendingChunks = [];
    let pendingBytes = 0;
    const limit = req.streamingThresholdBytes;

    for await (const chunk of readChunks(handle, start, req.compressed)) {
      let lineStart = 0;
      while (lineStart < chunk.length) {
        const newlineIndex = chunk.indexOf(NEWLINE, lineStart);
        if (newlineIndex === -1) {
          const tail = chunk.subarray(lineStart);
          if (pendingBytes + tail.length > limit) {
            return { status: "fallbackInline" };
          }
          if (tail.length > 0) {
            pendingChunks.push(Buffer.from(tail));
            pendingBytes += tail.length;
          }
          break;
        }
        const segment = chunk.subarray(lineStart, newlineIndex);
        if (pendingBytes === 0) {
          if (segment.length > limit) {
            return { status: "fallbackInline" };
          }
          if (matchesMarker(segment)) {
            lines.push(toLineString(segment));
          }
        } else {
          if (pendingBytes + segment.length > limit) {
            return { status: "fallbackInline" };
          }
          if (segment.length > 0) {
            pendingChunks.push(Buffer.from(segment));
            pendingBytes += segment.length;
          }
          const combined =
            pendingChunks.length === 1
              ? pendingChunks[0]
              : Buffer.concat(pendingChunks, pendingBytes);
          pendingChunks = [];
          pendingBytes = 0;
          if (matchesMarker(combined)) {
            lines.push(toLineString(combined));
          }
        }
        lineStart = newlineIndex + 1;
        resumeOffset = scanOffset + lineStart;
      }
      scanOffset += chunk.length;
    }

    let tailLine = null;
    if (pendingBytes > 0) {
      const combined =
        pendingChunks.length === 1
          ? pendingChunks[0]
          : Buffer.concat(pendingChunks, pendingBytes);
      if (matchesMarker(combined)) {
        tailLine = toLineString(combined);
      }
    }

    const guardLength = req.compressed ? 0 : Math.min(GUARD_LENGTH, resumeOffset);
    let guardHash = 0;
    if (guardLength > 0) {
      const window = Buffer.alloc(guardLength);
      await handle.read(window, 0, guardLength, resumeOffset - guardLength);
      guardHash = fnv1a(window);
    }

    return {
      status: "ok",
      resumed,
      lines,
      tailLine,
      resumeOffset: req.compressed ? 0 : resumeOffset,
      guardLength,
      guardHash,
    };
  } catch {
    return { status: "error" };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function intern(table, index, value) {
  const existing = index.get(value);
  if (existing !== undefined) return existing;
  const next = table.length;
  table.push(value);
  index.set(value, next);
  return next;
}

function serializeFile(entry, tables) {
  const serializeRecord = (record) => {
    const hasTiming = record.ttftMs !== undefined || record.durationMs !== undefined;
    const row = [
      record.timestampMs,
      intern(tables.models, tables.modelIndex, record.model),
      intern(tables.sessions, tables.sessionIndex, record.sessionId),
      record.totals.uncachedInputTokens,
      record.totals.cachedInputTokens,
      record.totals.cacheCreationTokens,
      record.totals.outputTokens,
      record.totals.reasoningTokens,
      record.dedupeKey,
      record.reportedCostUsd,
      SPEEDS.indexOf(record.speed),
      record.rateModel === undefined
        ? null
        : intern(tables.models, tables.modelIndex, record.rateModel),
    ];
    if (hasTiming) {
      row.push(
        record.unresolvedServiceTierTurnId ?? null,
        record.cacheCreation1hTokens ?? 0,
        record.ttftMs ?? null,
        record.durationMs ?? null,
      );
    } else if (record.cacheCreation1hTokens !== undefined) {
      row.push(record.unresolvedServiceTierTurnId ?? null, record.cacheCreation1hTokens);
    } else if (record.unresolvedServiceTierTurnId !== undefined) {
      row.push(record.unresolvedServiceTierTurnId);
    }
    return row;
  };
  return {
    s: entry.size,
    m: entry.mtimeMs,
    p: entry.provider,
    r: entry.records.map(serializeRecord),
    t: entry.tailRecords.map(serializeRecord),
    mr: entry.malformedRecords,
    o: entry.position.resumeOffset,
    gl: entry.position.guardLength,
    gh: entry.position.guardHash,
    cs: entry.position.state,
  };
}

function handleSerializeScanCache(req) {
  try {
    const tables = {
      models: [],
      sessions: [],
      modelIndex: new Map(),
      sessionIndex: new Map(),
    };
    const chunks = [];
    let batch = ['{"files":{'];
    let batchChars = 10;

    for (let index = 0; index < req.entries.length; index += 1) {
      const [filePath, entry] = req.entries[index];
      const part =
        (index === 0 ? "" : ",") +
        JSON.stringify(filePath) +
        ":" +
        JSON.stringify(serializeFile(entry, tables));
      batch.push(part);
      batchChars += part.length;
      if (batchChars >= SERIALIZE_CHUNK_TARGET_CHARS) {
        chunks.push(batch.join(""));
        batch = [];
        batchChars = 0;
      }
    }

    const tail = JSON.stringify({
      ...req.extra,
      version: req.version,
      models: tables.models,
      sessions: tables.sessions,
    });
    batch.push("}," + tail.slice(1));
    chunks.push(batch.join(""));
    return { status: "ok", chunks };
  } catch {
    return { status: "error" };
  }
}

parentPort.on("message", async (message) => {
  const { id, task } = message;
  try {
    const result =
      task.kind === "extractTranscript"
        ? await handleExtractTranscript(task)
        : handleSerializeScanCache(task);
    parentPort.postMessage({ id, result });
  } catch {
    parentPort.postMessage({ id, result: { status: "error" } });
  }
});
`;

interface PendingTask {
  readonly id: number;
  readonly task: WorkerTaskRequest;
  readonly resolve: (result: WorkerTaskResult | null) => void;
}

interface WorkerSlot {
  readonly worker: NodeWorkerThreads.Worker;
  busy: boolean;
  currentTask: PendingTask | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

function defaultPoolSize(): number {
  const parallelism =
    typeof NodeOS.availableParallelism === "function"
      ? NodeOS.availableParallelism()
      : NodeOS.cpus().length;
  return Math.max(MIN_WORKER_THREADS, Math.min(MAX_WORKER_THREADS, Math.floor(parallelism / 2)));
}

class UsageScanWorkerPool {
  private readonly maxWorkers: number;
  private readonly slots = new Set<WorkerSlot>();
  private readonly queue: Array<PendingTask> = [];
  private nextId = 1;
  private workersDisabled = false;

  constructor(maxWorkers = defaultPoolSize()) {
    this.maxWorkers = Math.max(1, Math.min(MAX_WORKER_THREADS, maxWorkers));
  }

  run<T extends WorkerTaskResult>(task: WorkerTaskRequest): Promise<T | null> {
    if (this.workersDisabled) {
      return Promise.resolve(null);
    }
    return new Promise<T | null>((resolve) => {
      const pending: PendingTask = {
        id: this.nextId++,
        task,
        resolve: resolve as (result: WorkerTaskResult | null) => void,
      };
      this.queue.push(pending);
      this.pump();
    });
  }

  async shutdown(): Promise<void> {
    while (this.queue.length > 0) {
      const pending = this.queue.shift()!;
      pending.resolve(null);
    }
    const terminations: Array<Promise<number>> = [];
    for (const slot of this.slots) {
      if (slot.idleTimer !== null) {
        clearTimeout(slot.idleTimer);
        slot.idleTimer = null;
      }
      if (slot.currentTask !== null) {
        slot.currentTask.resolve(null);
        slot.currentTask = null;
      }
      terminations.push(slot.worker.terminate().catch(() => 0));
    }
    this.slots.clear();
    await Promise.all(terminations);
  }

  private pump(): void {
    while (this.queue.length > 0) {
      let slot = this.findIdleSlot();
      if (slot === null && this.slots.size < this.maxWorkers) {
        slot = this.spawnSlot();
      }
      if (slot === null) {
        if (this.workersDisabled) {
          while (this.queue.length > 0) {
            this.queue.shift()!.resolve(null);
          }
        }
        return;
      }
      const next = this.queue.shift()!;
      this.dispatch(slot, next);
    }
  }

  private findIdleSlot(): WorkerSlot | null {
    for (const slot of this.slots) {
      if (!slot.busy) return slot;
    }
    return null;
  }

  private spawnSlot(): WorkerSlot | null {
    let worker: NodeWorkerThreads.Worker;
    try {
      worker = new NodeWorkerThreads.Worker(WORKER_SCRIPT, { eval: true });
      worker.unref();
    } catch {
      this.workersDisabled = true;
      return null;
    }
    const slot: WorkerSlot = {
      worker,
      busy: false,
      currentTask: null,
      idleTimer: null,
    };
    this.slots.add(slot);

    worker.on("message", (msg: { readonly id: number; readonly result: WorkerTaskResult }) => {
      const task = slot.currentTask;
      slot.currentTask = null;
      slot.busy = false;
      if (task !== null && task.id === msg.id) {
        task.resolve(msg.result);
      }
      this.scheduleIdleShutdown(slot);
      this.pump();
    });

    const onWorkerFailure = () => {
      this.evictSlot(slot);
      this.pump();
    };
    worker.on("error", onWorkerFailure);
    worker.on("exit", onWorkerFailure);

    return slot;
  }

  private dispatch(slot: WorkerSlot, pending: PendingTask): void {
    if (slot.idleTimer !== null) {
      clearTimeout(slot.idleTimer);
      slot.idleTimer = null;
    }
    slot.busy = true;
    slot.currentTask = pending;
    try {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node worker_threads Worker.postMessage has no targetOrigin parameter.
      slot.worker.postMessage({ id: pending.id, task: pending.task });
    } catch {
      slot.currentTask = null;
      slot.busy = false;
      pending.resolve(null);
      this.evictSlot(slot);
    }
  }

  private scheduleIdleShutdown(slot: WorkerSlot): void {
    if (slot.idleTimer !== null) {
      clearTimeout(slot.idleTimer);
    }
    slot.idleTimer = setTimeout(() => {
      if (!slot.busy && this.slots.has(slot)) {
        this.evictSlot(slot);
      }
    }, IDLE_TERMINATE_MS);
    slot.idleTimer.unref();
  }

  private evictSlot(slot: WorkerSlot): void {
    if (!this.slots.delete(slot)) return;
    if (slot.idleTimer !== null) {
      clearTimeout(slot.idleTimer);
      slot.idleTimer = null;
    }
    const task = slot.currentTask;
    slot.currentTask = null;
    slot.busy = false;
    if (task !== null) {
      task.resolve(null);
    }
    void slot.worker.terminate().catch(() => undefined);
  }
}

let sharedPool: UsageScanWorkerPool | null = null;

function getSharedPool(): UsageScanWorkerPool {
  if (sharedPool === null) {
    sharedPool = new UsageScanWorkerPool();
  }
  return sharedPool;
}

export function extractTranscriptWithWorker(
  request: Omit<WorkerExtractTranscriptRequest, "kind">,
): Promise<WorkerExtractTranscriptResult | null> {
  return getSharedPool().run<WorkerExtractTranscriptResult>({
    kind: "extractTranscript",
    ...request,
  });
}

export function serializeScanCacheWithWorker(
  request: Omit<WorkerSerializeScanCacheRequest, "kind">,
): Promise<WorkerSerializeScanCacheResult | null> {
  return getSharedPool().run<WorkerSerializeScanCacheResult>({
    kind: "serializeScanCache",
    ...request,
  });
}

export async function shutdownUsageScanWorkerPool(): Promise<void> {
  if (sharedPool === null) return;
  const pool = sharedPool;
  sharedPool = null;
  await pool.shutdown();
}
