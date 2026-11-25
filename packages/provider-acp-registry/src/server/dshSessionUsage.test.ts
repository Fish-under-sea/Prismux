// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  decodeDshSessionJsonl,
  dshRateModel,
  encodeDshProjectKey,
  encodeDshSegment,
  estimateDshReasoningTokens,
  extractDshStreamFirstTokenTime,
  findDshSessionFile,
  formatDshModelId,
  makeDshTurnUsageWatcher,
  makeDshUsageFileCache,
  resolveDshHomeDir,
  scanDshUsageFiles,
  scanDshUsageRecords,
  scanZstdFrames,
} from "./dshSessionUsage.ts";

const tempDirs: Array<string> = [];

function createTempDir(prefix: string): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
});

function compressFrame(lines: ReadonlyArray<unknown>, withChecksum = true): Buffer {
  const payload = `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
  return NodeZlib.zstdCompressSync(
    Buffer.from(payload, "utf8"),
    withChecksum ? { params: { [NodeZlib.constants.ZSTD_c_checksumFlag]: 1 } } : undefined,
  );
}

describe("dshSessionUsage", () => {
  describe("scanZstdFrames & decodeDshSessionJsonl", () => {
    it("scans and decodes concatenated multi-frame Zstandard JSONL buffers", () => {
      const frame1 = compressFrame([
        { type: "session", version: 4, id: "sess-multi", createdAt: 1_700_000_000_000, isSeeded: false, delegationDepth: 0 },
      ]);
      const frame2 = compressFrame([
        { seq: 1, type: "step/start", time: 1_700_000_001_000, data: { turn: 1, step: 1 } },
      ]);
      const frame3 = compressFrame(
        [
          {
            seq: 2,
            type: "assistant/message",
            time: 1_700_000_004_000,
            data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } },
          },
        ],
        false,
      );
      const combined = Buffer.concat([frame1, frame2, frame3]);

      const scan = scanZstdFrames(combined);
      expect(scan.tornStart).toBeUndefined();
      expect(scan.frames).toEqual([
        { start: 0, end: frame1.length },
        { start: frame1.length, end: frame1.length + frame2.length },
        { start: frame1.length + frame2.length, end: combined.length },
      ]);

      const records = decodeDshSessionJsonl(combined);
      expect(records).toHaveLength(3);
      expect(records[0]?.type).toBe("session");
      expect(records[1]?.type).toBe("step/start");
      expect(records[2]?.type).toBe("assistant/message");
    });

    it("gracefully recovers complete frames when the final frame is torn mid-write", () => {
      const frame1 = compressFrame([{ type: "session", version: 4, id: "sess-torn", createdAt: 1 }]);
      const frame2 = compressFrame([{ seq: 1, type: "step/start", time: 1000, data: { turn: 1, step: 1 } }]);
      const frame3 = compressFrame([
        { seq: 2, type: "assistant/message", time: 2000, data: { turn: 1, step: 1, padding: "x".repeat(400) } },
      ]);

      // Truncate in header, mid-block, and mid-checksum
      for (const cut of [2, 6, Math.floor(frame3.length / 2), frame3.length - 2]) {
        const torn = Buffer.concat([frame1, frame2, frame3.subarray(0, cut)]);
        const scan = scanZstdFrames(torn);
        expect(scan.frames).toHaveLength(2);
        expect(scan.tornStart).toBe(frame1.length + frame2.length);

        const records = decodeDshSessionJsonl(torn);
        expect(records).toHaveLength(2);
        expect(records[1]?.type).toBe("step/start");
      }
    });

    it("rejects invalid Zstd magic in scanZstdFrames and decodes plain JSONL fallback", () => {
      expect(() => scanZstdFrames(Buffer.from("not-zstd-payload"))).toThrow(/invalid frame magic/u);

      const plain = Buffer.from(
        [
          JSON.stringify({ type: "session", version: 4, id: "plain-1", createdAt: 10 }),
          JSON.stringify({ seq: 1, type: "step/start", time: 20, data: { turn: 1, step: 1 } }),
          '{"seq":2,"type":"assistant/message","truncated',
        ].join("\n"),
        "utf8",
      );
      const records = decodeDshSessionJsonl(plain);
      expect(records).toHaveLength(2);
      expect(records[0]?.id).toBe("plain-1");
      expect(records[1]?.type).toBe("step/start");
    });
  });

  describe("path, model, reasoning, and stream timing helpers", () => {
    it("resolves DSH_HOME and defaults to <homeDir>/.dsh", () => {
      expect(resolveDshHomeDir({ DSH_HOME: "/custom/dsh-home" }, "/home/tester", "linux")).toBe(
        NodePath.posix.resolve("/custom/dsh-home"),
      );
      expect(resolveDshHomeDir({ DSH_HOME: "~/my-dsh" }, "/home/tester", "linux")).toBe(
        NodePath.posix.resolve("/home/tester/my-dsh"),
      );
      expect(resolveDshHomeDir({}, "/home/tester", "linux")).toBe("/home/tester/.dsh");
    });

    it("encodes project keys and segments identically to DSH", () => {
      expect(encodeDshProjectKey("D:\\Fish-code\\AGY\\Prismux")).toBe("--D-Fish-code-AGY-Prismux--");
      expect(encodeDshSegment("c84fb8fd-a786-4c31-b2e8-28c7bcfbadf1")).toBe(
        "c84fb8fd-a786-4c31-b2e8-28c7bcfbadf1",
      );
      expect(encodeDshSegment("..")).toBe("~002E~002E");
    });

    it("formats clean human-friendly model strings and strips proxy prefixes for rateModel", () => {
      expect(formatDshModelId({ provider: "magpie", model: "group/deepseek" })).toBe("group/deepseek");
      expect(formatDshModelId('["magpie","group/deepseek"]')).toBe("group/deepseek");
      expect(formatDshModelId(undefined, { provider: "magpie", model: "deepseek-chat" })).toBe(
        "deepseek-chat",
      );
      expect(dshRateModel("dragon-api-max/claude-opus-5-5")).toBe("claude-opus-5-5");
      expect(dshRateModel("deepseek/deepseek-chat")).toBe("deepseek/deepseek-chat");
    });

    it("estimates reasoning tokens conservatively when omitted and clamps explicit values", () => {
      expect(estimateDshReasoningTokens(100, 42, [])).toBe(42);
      expect(estimateDshReasoningTokens(100, 250, [])).toBe(100);
      expect(estimateDshReasoningTokens(100, undefined, [{ type: "text", text: "Hello world" }])).toBe(0);
      expect(
        estimateDshReasoningTokens(100, undefined, [{ type: "reasoning", text: "Thinking deeply..." }]),
      ).toBe(100);

      const estimated = estimateDshReasoningTokens(100, undefined, [
        { type: "reasoning", text: "a".repeat(75) },
        { type: "text", text: "b".repeat(25) },
      ]);
      expect(estimated).toBe(75);

      const withToolCall = estimateDshReasoningTokens(82, undefined, [
        { type: "reasoning", text: "a".repeat(73) },
        { type: "tool-call", name: "pwsh", arguments: "b".repeat(84) },
      ]);
      expect(withToolCall).toBeGreaterThan(0);
      expect(withToolCall).toBeLessThan(82);
    });

    it("extracts first non-empty token delta timestamps across compact and raw stream shapes", () => {
      expect(
        extractDshStreamFirstTokenTime([
          { type: "chunk", time: 1000, chunk: { type: "block-start", index: 0, blockType: "text" } },
          { type: "text-chunks", time0: 1200, index: 0, dt: [15, 30], texts: ["", "Hi", "!"] },
        ]),
      ).toBe(1215);

      expect(
        extractDshStreamFirstTokenTime([
          { type: "reasoning-chunks", time0: 2500, index: 0, dt: [5], texts: ["Think", "ing"] },
        ]),
      ).toBe(2500);

      expect(
        extractDshStreamFirstTokenTime([
          { type: "tool-call-chunks", time0: 3100, index: 0, dt: [], id: "tc-1", name: "pwsh", args: [""] },
        ]),
      ).toBe(3100);
    });
  });

  describe("makeDshTurnUsageWatcher", () => {
    it("computes exact token breakdown, cache math, reasoning split, and server-side TTFT/decodeMs across steps", async () => {
      const root = createTempDir("prismux-dsh-watcher-");
      const cwd = "D:\\Fish-code\\Prismux";
      const sessionId = "sess-live-1";
      const sessionDir = NodePath.join(root, "sessions", encodeDshProjectKey(cwd), sessionId);
      NodeFS.mkdirSync(sessionDir, { recursive: true });
      const filePath = NodePath.join(sessionDir, "session.v4.jsonl.zstd");

      // Turn 1 (already on disk before watcher starts)
      const turn1Frame = compressFrame([
        { type: "session", version: 4, id: sessionId, createdAt: 1_700_000_000_000, cwd, isSeeded: false, delegationDepth: 0 },
        { seq: 1, type: "model/selection", time: 1_700_000_000_100, data: { provider: "magpie", model: "group/deepseek" } },
        { seq: 2, type: "step/start", time: 1_700_000_000_200, data: { turn: 1, step: 1 } },
        {
          seq: 3,
          type: "assistant/message",
          time: 1_700_000_001_200,
          data: {
            turn: 1,
            step: 1,
            usage: { inputTokens: 1000, outputTokens: 50, totalTokens: 1050 },
            message: { source: { provider: "magpie", model: "group/deepseek" }, content: [{ type: "text", text: "old" }] },
            stream: [{ type: "text-chunks", time0: 1_700_000_000_500, index: 0, dt: [], texts: ["old"] }],
          },
        },
        { seq: 4, type: "turn/end", time: 1_700_000_001_300, data: { turn: 1 } },
      ]);
      NodeFS.writeFileSync(filePath, turn1Frame);

      expect(findDshSessionFile(root, sessionId, cwd)).toBe(filePath);
      expect(findDshSessionFile(root, sessionId)).toBe(filePath);

      // Start watching before turn 2
      const watcher = makeDshTurnUsageWatcher({ dshHome: root, sessionId, cwd, settleWaitMs: 0 });
      expect(watcher.baselineSeq).toBe(4);
      expect(watcher.readTurnDelta()).toBeUndefined();

      // Step 1 of turn 2: reasoning + tool call (no explicit reasoningTokens)
      const turn2Step1 = compressFrame([
        { seq: 5, type: "step/start", time: 1_700_000_010_000, data: { turn: 2, step: 1 } },
        {
          seq: 6,
          type: "assistant/message",
          time: 1_700_000_013_000, // modelDurationMs = 3000
          data: {
            turn: 2,
            step: 1,
            usage: { inputTokens: 500, outputTokens: 80, totalTokens: 51780, cacheReadTokens: 50000, cacheWriteTokens: 1200 },
            message: {
              source: { provider: "magpie", model: "group/deepseek" },
              content: [
                { type: "reasoning", text: "r".repeat(60) },
                { type: "tool-call", name: "pwsh", arguments: "a".repeat(36) },
              ],
            },
            stream: [
              { type: "reasoning-chunks", time0: 1_700_000_011_000, index: 0, dt: [], texts: ["think"] }, // ttft = 1000, decode = 2000
            ],
          },
        },
        { seq: 7, type: "step/end", time: 1_700_000_013_050, data: { turn: 2, step: 1 } },
      ]);
      NodeFS.appendFileSync(filePath, turn2Step1);

      const midTurn = watcher.readTurnDelta();
      expect(midTurn).toBeDefined();
      expect(midTurn?.hasTurnEnd).toBe(false);
      expect(midTurn?.usage.usageStatus).toBe("complete");
      // Total input = uncached (500) + cacheRead (50000) + cacheWrite (1200) = 51700
      expect(midTurn?.usage.inputTokens).toBe(51700);
      expect(midTurn?.usage.cachedInputTokens).toBe(50000);
      expect(midTurn?.usage.cacheCreationTokens).toBe(1200);
      expect(midTurn?.usage.outputTokens).toBe(80);
      expect(midTurn?.usage.reasoningTokens).toBe(48); // 60 / (60 + 4 + 36) = 0.6 -> 48
      expect(midTurn?.usage.ttftMs).toBe(1000);
      expect(midTurn?.usage.decodeMs).toBe(2000);
      expect(midTurn?.usage.modelDurationMs).toBe(3000);

      // Step 2 of turn 2: text answer (real DSH example: 357 uncached + 51200 cacheRead + 189 output = 51746)
      const turn2Step2 = compressFrame([
        { seq: 8, type: "step/start", time: 1_700_000_014_000, data: { turn: 2, step: 2 } },
        {
          seq: 9,
          type: "assistant/message",
          time: 1_700_000_018_000, // modelDurationMs = 4000
          data: {
            turn: 2,
            step: 2,
            usage: { inputTokens: 357, outputTokens: 189, totalTokens: 51746, cacheReadTokens: 51200 },
            message: {
              source: { provider: "magpie", model: "group/deepseek" },
              content: [{ type: "text", text: "PowerShell 7.5" }],
            },
            stream: [
              { type: "text-chunks", time0: 1_700_000_016_000, index: 0, dt: [], texts: ["PowerShell"] }, // ttft = 2000, decode = 2000
            ],
          },
        },
        { seq: 10, type: "step/end", time: 1_700_000_018_010, data: { turn: 2, step: 2 } },
        { seq: 11, type: "turn/end", time: 1_700_000_018_020, data: { turn: 2 } },
      ]);
      NodeFS.appendFileSync(filePath, turn2Step2);

      const final = await watcher.collectFinal();
      expect(final).toBeDefined();
      expect(final?.hasTurnEnd).toBe(true);
      expect(final?.stepCount).toBe(2);
      expect(final?.models).toEqual(["group/deepseek"]);
      // Combined across step 1 + step 2:
      // uncached = 500 + 357 = 857; cacheRead = 50000 + 51200 = 101200; cacheWrite = 1200
      // totalInput = 857 + 101200 + 1200 = 103257
      expect(final?.usage.inputTokens).toBe(103257);
      expect(final?.usage.cachedInputTokens).toBe(101200);
      expect(final?.usage.cacheCreationTokens).toBe(1200);
      expect(final?.usage.outputTokens).toBe(269); // 80 + 189
      expect(final?.usage.reasoningTokens).toBe(48); // step 2 had 0 reasoning
      expect(final?.usage.ttftMs).toBe(1500); // avg(1000, 2000)
      expect(final?.usage.decodeMs).toBe(4000); // 2000 + 2000
      expect(final?.usage.modelDurationMs).toBe(7000); // 3000 + 4000
      expect(final?.liveTokenUsage).toEqual({
        inputTokens: 103257,
        cachedInputTokens: 101200,
        cacheCreationTokens: 1200,
        outputTokens: 269,
        reasoningOutputTokens: 48,
        ttftMs: 1500,
        decodeMs: 4000,
        durationMs: 7000,
      });
    });
  });

  describe("scanDshUsageRecords & scanDshUsageFiles", () => {
    it("scans DSH sessions with uncached input semantics, skips seeded prefixes and stale mtime files, and caches unchanged files", () => {
      const root = createTempDir("prismux-dsh-scan-");
      const freshDir = NodePath.join(root, "sessions", "--D-Proj--", "sess-fresh");
      const staleDir = NodePath.join(root, "sessions", "--D-Proj--", "sess-stale");
      const forkedDir = NodePath.join(root, "sessions", "--D-Proj--", "sess-fork");
      NodeFS.mkdirSync(freshDir, { recursive: true });
      NodeFS.mkdirSync(staleDir, { recursive: true });
      NodeFS.mkdirSync(forkedDir, { recursive: true });

      const freshTime = Date.parse("2026-08-01T10:00:05Z");
      const freshFile = NodePath.join(freshDir, "session.v4.jsonl.zstd");
      NodeFS.writeFileSync(
        freshFile,
        Buffer.concat([
          compressFrame([{ type: "session", version: 4, id: "sess-fresh", createdAt: freshTime - 5000, isSeeded: false, delegationDepth: 0 }]),
          compressFrame([
            { seq: 1, type: "step/start", time: freshTime - 4000, data: { turn: 1, step: 1 } },
            {
              seq: 2,
              type: "assistant/message",
              time: freshTime,
              data: {
                turn: 1,
                step: 1,
                usage: { inputTokens: 357, outputTokens: 189, totalTokens: 51746, cacheReadTokens: 51200 },
                message: {
                  source: { provider: "magpie", model: '["magpie","group/deepseek"]' },
                  content: [{ type: "text", text: "ok" }],
                },
                stream: [{ type: "text-chunks", time0: freshTime - 3000, index: 0, dt: [], texts: ["ok"] }],
              },
            },
          ]),
        ]),
      );

      // Stale file with old mtime
      const staleTime = Date.parse("2026-01-01T00:00:00Z");
      const staleFile = NodePath.join(staleDir, "session.v4.jsonl.zstd");
      NodeFS.writeFileSync(
        staleFile,
        compressFrame([
          { type: "session", version: 4, id: "sess-stale", createdAt: staleTime, isSeeded: false, delegationDepth: 0 },
          {
            seq: 1,
            type: "assistant/message",
            time: staleTime,
            data: {
              turn: 1,
              step: 1,
              usage: { inputTokens: 999, outputTokens: 111, totalTokens: 1110 },
              message: { source: { provider: "magpie", model: "old-model" }, content: [{ type: "text", text: "old" }] },
            },
          },
        ]),
      );
      NodeFS.utimesSync(staleFile, staleTime / 1000, staleTime / 1000);

      // Forked/seeded session: inherited event before session/end-seed must be skipped
      const forkedFile = NodePath.join(forkedDir, "session.v4.jsonl");
      NodeFS.writeFileSync(
        forkedFile,
        [
          { type: "session", version: 4, id: "sess-fork", createdAt: freshTime, isSeeded: true, delegationDepth: 0 },
          {
            seq: 1,
            type: "assistant/message",
            time: freshTime,
            data: {
              turn: 1,
              step: 1,
              usage: { inputTokens: 777, outputTokens: 77, totalTokens: 854 },
              message: { source: { provider: "magpie", model: "inherited-model" }, content: [] },
            },
          },
          { seq: 2, type: "session/end-seed", time: freshTime + 1, data: {} },
          {
            seq: 3,
            type: "assistant/message",
            time: freshTime + 2000,
            data: {
              turn: 2,
              step: 1,
              usage: { inputTokens: 100, outputTokens: 50, totalTokens: 250, cacheWriteTokens: 100 },
              message: { source: { provider: "magpie-anthropic", model: "dragon-api-max/claude-opus-5-5" }, content: [] },
            },
          },
        ]
          .map((line) => JSON.stringify(line))
          .join("\n") + "\n",
      );

      const cache = makeDshUsageFileCache();
      const sinceMs = Date.parse("2026-07-31T00:00:00Z");
      const records = scanDshUsageRecords({ dshHome: root, sinceMs, cache });
      expect(records).toHaveLength(2);

      const freshRecord = records.find((r) => r.sessionId === "sess-fresh");
      expect(freshRecord).toEqual({
        provider: "dsh",
        timestampMs: freshTime,
        model: "group/deepseek",
        rateModel: "deepseek",
        sessionId: "sess-fresh",
        totals: {
          uncachedInputTokens: 357,
          cachedInputTokens: 51200,
          cacheCreationTokens: 0,
          outputTokens: 189,
          reasoningTokens: 0,
        },
        reportedCostUsd: null,
        speed: "standard",
        dedupeKey: "dsh:sess-fresh:2",
        ttftMs: 1000,
        durationMs: 4000,
      });

      const forkRecord = records.find((r) => r.sessionId === "sess-fork");
      expect(forkRecord?.model).toBe("dragon-api-max/claude-opus-5-5");
      expect(forkRecord?.rateModel).toBe("claude-opus-5-5");
      expect(forkRecord?.totals).toEqual({
        uncachedInputTokens: 100,
        cachedInputTokens: 0,
        cacheCreationTokens: 100,
        outputTokens: 50,
        reasoningTokens: 0,
      });

      // Second scan hits cache and produces identical records
      const secondScan = scanDshUsageFiles({ dshHome: root, sinceMs, cache });
      expect(secondScan.missing).toBe(false);
      expect(secondScan.error).toBe(false);
      expect(secondScan.files.flatMap((f) => f.records)).toEqual(records);
    });

    it("reports missing when <dshHome>/sessions does not exist", () => {
      const root = createTempDir("prismux-dsh-missing-");
      const result = scanDshUsageFiles({ dshHome: root });
      expect(result.missing).toBe(true);
      expect(result.error).toBe(false);
      expect(result.files).toEqual([]);
    });

    it("reads live local ~/.dsh/sessions without crashing when present on host", () => {
      const localDshHome = NodePath.join(NodeOS.homedir(), ".dsh");
      const localSessionsDir = NodePath.join(localDshHome, "sessions");
      if (!NodeFS.existsSync(localSessionsDir)) {
        return;
      }
      const records = scanDshUsageRecords({ dshHome: localDshHome });
      expect(records.length).toBeGreaterThan(0);
      for (const record of records.slice(0, 50)) {
        expect(record.provider).toBe("dsh");
        expect(record.model.startsWith("[")).toBe(false);
        expect(record.totals.uncachedInputTokens).toBeGreaterThanOrEqual(0);
        expect(record.totals.cachedInputTokens).toBeGreaterThanOrEqual(0);
        expect(record.totals.outputTokens).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
