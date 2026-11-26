// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { claudeUsageFormat } from "../provider/Drivers/claudeUsage.ts";
import {
  decodeScanCache,
  USAGE_SCAN_CACHE_VERSION,
  type CachedFile,
} from "./usageScanCache.ts";
import {
  extractTranscriptWithWorker,
  serializeScanCacheWithWorker,
  shutdownUsageScanWorkerPool,
} from "./usageScanWorker.ts";
import { TEST_FORMAT_MAP } from "./usageTestFormats.ts";
import { readTranscriptRecords } from "./usageTranscriptReader.ts";

function claudeLine(id: string, outputTokens: number): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-01T10:00:00Z",
    requestId: `req_${id}`,
    sessionId: "session-worker",
    message: {
      id: `msg_${id}`,
      model: "claude-fable-5",
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: outputTokens,
      },
    },
  });
}

describe("usageScanWorker", () => {
  afterAll(async () => {
    await shutdownUsageScanWorkerPool();
  });

  it("extracts plain and zstd transcripts in worker threads matching inline parsing, including incremental resume", async () => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prismux-usage-worker-"));
    try {
      const plainPath = NodePath.join(dir, "session.jsonl");
      const firstBatch = `${JSON.stringify({ type: "user", text: "ignored line" })}\n${claudeLine("1", 25)}\n`;
      await NodeFSP.writeFile(plainPath, firstBatch, "utf8");

      const inlineFirst = await readTranscriptRecords(plainPath, claudeUsageFormat, undefined, {
        useWorker: false,
      });
      const workerFirst = await readTranscriptRecords(plainPath, claudeUsageFormat, undefined, {
        useWorker: true,
      });
      expect(workerFirst).toEqual(inlineFirst);
      expect(workerFirst?.records).toHaveLength(1);
      expect(workerFirst?.records[0]?.totals.outputTokens).toBe(25);

      // Append a new line plus an unterminated tail line and resume via guard hash.
      await NodeFSP.appendFile(plainPath, `${claudeLine("2", 40)}\n${claudeLine("tail", 7)}`, "utf8");
      const workerResumed = await readTranscriptRecords(
        plainPath,
        claudeUsageFormat,
        workerFirst!.position,
        { useWorker: true },
      );
      expect(workerResumed?.resumed).toBe(true);
      expect(workerResumed?.records).toHaveLength(1);
      expect(workerResumed?.records[0]?.totals.outputTokens).toBe(40);
      expect(workerResumed?.tailRecords).toHaveLength(1);
      expect(workerResumed?.tailRecords[0]?.totals.outputTokens).toBe(7);

      // Compressed .jsonl.zst archive matches inline parse identically.
      const zstPath = NodePath.join(dir, "archive.jsonl.zst");
      const zstPayload = NodeZlib.zstdCompressSync(
        Buffer.from(`${claudeLine("z1", 12)}\n${claudeLine("z2", 34)}\n`, "utf8"),
      );
      await NodeFSP.writeFile(zstPath, zstPayload);
      const inlineZst = await readTranscriptRecords(zstPath, claudeUsageFormat, undefined, {
        useWorker: false,
      });
      const workerZst = await readTranscriptRecords(zstPath, claudeUsageFormat, undefined, {
        useWorker: true,
      });
      expect(workerZst).toEqual(inlineZst);
      expect(workerZst?.records.map((r) => r.totals.outputTokens)).toEqual([12, 34]);

      // Oversized line triggers fallbackInline cleanly.
      const fallback = await extractTranscriptWithWorker({
        filePath: plainPath,
        compressed: false,
        markers: claudeUsageFormat.usageMarkers,
        resumeOffset: 0,
        guardLength: 0,
        guardHash: 0,
        streamingThresholdBytes: 32,
      });
      expect(fallback?.status).toBe("fallbackInline");
    } finally {
      await NodeFSP.rm(dir, { recursive: true, force: true });
    }
  });

  it("serializes scan cache entries off the main thread with compacted intern tables", async () => {
    const entry: CachedFile = {
      size: 120,
      mtimeMs: 1_786_000_000_000,
      provider: "claude",
      records: [
        {
          provider: "claude",
          timestampMs: 1_786_000_000_000,
          model: "claude-fable-5",
          sessionId: "sess-1",
          totals: {
            uncachedInputTokens: 10,
            cachedInputTokens: 20,
            cacheCreationTokens: 0,
            outputTokens: 30,
            reasoningTokens: 0,
          },
          reportedCostUsd: null,
          speed: "standard",
          dedupeKey: "msg_1:",
          ttftMs: 120,
          durationMs: 850,
        },
      ],
      tailRecords: [],
      malformedRecords: 0,
      position: { resumeOffset: 120, guardLength: 64, guardHash: 12345, state: null },
    };
    const serialized = await serializeScanCacheWithWorker({
      version: USAGE_SCAN_CACHE_VERSION,
      entries: [["/a.jsonl", entry]],
      extra: { sources: {}, coveredSince: {} },
    });
    expect(serialized?.status).toBe("ok");
    const parsed = JSON.parse((serialized?.chunks ?? []).join(""));
    expect(parsed.models).toEqual(["claude-fable-5"]);
    expect(parsed.sessions).toEqual(["sess-1"]);
    const restored = decodeScanCache(parsed, TEST_FORMAT_MAP);
    expect(restored.get("/a.jsonl")).toEqual(entry);
  });
});
