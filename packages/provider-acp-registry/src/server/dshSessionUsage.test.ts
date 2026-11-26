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
        {
          type: "session",
          version: 4,
          id: "sess-multi",
          createdAt: 1_700_000_000_000,
          isSeeded: false,
          delegationDepth: 0,
        },
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
            data: {
              turn: 1,
              step: 1,
              usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
            },
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
      const frame1 = compressFrame([
        { type: "session", version: 4, id: "sess-torn", createdAt: 1 },
      ]);
      const frame2 = compressFrame([
        { seq: 1, type: "step/start", time: 1000, data: { turn: 1, step: 1 } },
      ]);
      const frame3 = compressFrame([
        {
          seq: 2,
          type: "assistant/message",
          time: 2000,
          data: { turn: 1, step: 1, padding: "x".repeat(400) },
        },
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
      expect(encodeDshProjectKey("D:\\Fish-code\\AGY\\Prismux")).toBe(
        "--D-Fish-code-AGY-Prismux--",
      );
      expect(encodeDshSegment("c84fb8fd-a786-4c31-b2e8-28c7bcfbadf1")).toBe(
        "c84fb8fd-a786-4c31-b2e8-28c7bcfbadf1",
      );
      expect(encodeDshSegment("..")).toBe("~002E~002E");
    });

    it("formats clean human-friendly model strings and strips proxy prefixes for rateModel", () => {
      expect(formatDshModelId({ provider: "magpie", model: "group/deepseek" })).toBe(
        "group/deepseek",
      );
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
      expect(
        estimateDshReasoningTokens(100, undefined, [{ type: "text", text: "Hello world" }]),
      ).toBe(0);
      expect(
        estimateDshReasoningTokens(100, undefined, [
          { type: "reasoning", text: "Thinking deeply..." },
        ]),
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
          {
            type: "chunk",
            time: 1000,
            chunk: { type: "block-start", index: 0, blockType: "text" },
          },
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
          {
            type: "tool-call-chunks",
            time0: 3100,
            index: 0,
            dt: [],
            id: "tc-1",
            name: "pwsh",
            args: [""],
          },
        ]),
      ).toBe(3100);

      expect(
        extractDshStreamFirstTokenTime([
          { type: "chunk", time: 4500, chunk: { type: "text-delta", text: "final" } },
          { type: "chunk", time: 4100, chunk: { type: "reasoning-delta", reasoning: "thought" } },
        ]),
      ).toBe(4100);
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
        {
          type: "session",
          version: 4,
          id: sessionId,
          createdAt: 1_700_000_000_000,
          cwd,
          isSeeded: false,
          delegationDepth: 0,
        },
        {
          seq: 1,
          type: "model/selection",
          time: 1_700_000_000_100,
          data: { provider: "magpie", model: "group/deepseek" },
        },
        { seq: 2, type: "step/start", time: 1_700_000_000_200, data: { turn: 1, step: 1 } },
        {
          seq: 3,
          type: "assistant/message",
          time: 1_700_000_001_200,
          data: {
            turn: 1,
            step: 1,
            usage: { inputTokens: 1000, outputTokens: 50, totalTokens: 1050 },
            message: {
              source: { provider: "magpie", model: "group/deepseek" },
              content: [{ type: "text", text: "old" }],
            },
            stream: [
              { type: "text-chunks", time0: 1_700_000_000_500, index: 0, dt: [], texts: ["old"] },
            ],
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
            usage: {
              inputTokens: 500,
              outputTokens: 80,
              totalTokens: 51780,
              cacheReadTokens: 50000,
              cacheWriteTokens: 1200,
            },
            message: {
              source: { provider: "magpie", model: "group/deepseek" },
              content: [
                { type: "reasoning", text: "r".repeat(60) },
                { type: "tool-call", name: "pwsh", arguments: "a".repeat(36) },
              ],
            },
            stream: [
              {
                type: "reasoning-chunks",
                time0: 1_700_000_011_000,
                index: 0,
                dt: [],
                texts: ["think"],
              }, // ttft = 1000, decode = 2000
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
            usage: {
              inputTokens: 357,
              outputTokens: 189,
              totalTokens: 51746,
              cacheReadTokens: 51200,
            },
            message: {
              source: { provider: "magpie", model: "group/deepseek" },
              content: [{ type: "text", text: "PowerShell 7.5" }],
            },
            stream: [
              {
                type: "text-chunks",
                time0: 1_700_000_016_000,
                index: 0,
                dt: [],
                texts: ["PowerShell"],
              }, // ttft = 2000, decode = 2000
            ],
          },
        },
        { seq: 10, type: "step/end", time: 1_700_000_018_010, data: { turn: 2, step: 2 } },
        { seq: 11, type: "turn/end", time: 1_700_000_018_020, data: { turn: 2 } },
      ]);
      NodeFS.appendFileSync(filePath, turn2Step2);
      // Pin integer-second mtime so NTFS sub-ms precision does not skew utimes restoration below.
      NodeFS.utimesSync(filePath, 1_700_000_020, 1_700_000_020);

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

      // Calling readTurnDelta() again while (mtimeMs, size) are unchanged reuses the cached
      // result without re-reading or re-decompressing the zstd log.
      const repeated = watcher.readTurnDelta();
      expect(repeated).toBe(final);
      const stat = NodeFS.statSync(filePath);
      NodeFS.writeFileSync(filePath, Buffer.alloc(stat.size, 0));
      NodeFS.utimesSync(filePath, 1_700_000_020, 1_700_000_020);
      expect(watcher.readTurnDelta()).toBe(final);
    });

    it("omits bogus decodeMs on single-packet 1ms micro-burst responses (128 tok, TTFT 6.66s, dur 6.66s)", async () => {
      const root = createTempDir("prismux-dsh-microburst-");
      const cwd = "D:\\Fish-code\\Prismux";
      const sessionId = "sess-microburst";
      const sessionDir = NodePath.join(root, "sessions", encodeDshProjectKey(cwd), sessionId);
      NodeFS.mkdirSync(sessionDir, { recursive: true });
      const filePath = NodePath.join(sessionDir, "session.v4.jsonl.zstd");

      NodeFS.writeFileSync(
        filePath,
        compressFrame([
          {
            type: "session",
            version: 4,
            id: sessionId,
            createdAt: 1_795_687_360_000,
            cwd,
            isSeeded: false,
            delegationDepth: 0,
          },
        ]),
      );

      const watcher = makeDshTurnUsageWatcher({ dshHome: root, sessionId, cwd, settleWaitMs: 0 });
      NodeFS.appendFileSync(
        filePath,
        compressFrame([
          { seq: 116, type: "step/start", time: 1_795_687_368_902, data: { turn: 5, step: 1 } },
          {
            seq: 119,
            type: "assistant/message",
            time: 1_795_687_375_558, // modelDurationMs = 6656ms
            data: {
              turn: 5,
              step: 1,
              usage: { inputTokens: 43_944, outputTokens: 128, totalTokens: 44_072 },
              message: {
                source: { provider: "magpie", model: "group/deepseek" },
                content: [
                  { type: "text", text: "Buffered full reply delivered in a single packet." },
                ],
              },
              stream: [
                {
                  type: "chunk",
                  time: 1_795_687_375_557,
                  chunk: { type: "block-start", index: 0, blockType: "text" },
                },
                {
                  type: "text-chunks",
                  time0: 1_795_687_375_557,
                  index: 0,
                  dt: [],
                  texts: ["Buffered full reply"],
                },
                { type: "chunk", time: 1_795_687_375_557, chunk: { type: "block-end", index: 0 } },
                { type: "chunk", time: 1_795_687_375_557, chunk: { type: "usage" } },
                { type: "chunk", time: 1_795_687_375_558, chunk: { type: "finish" } },
              ],
            },
          },
          { seq: 120, type: "step/end", time: 1_795_687_375_559, data: { turn: 5, step: 1 } },
          { seq: 121, type: "turn/end", time: 1_795_687_375_560, data: { turn: 5 } },
        ]),
      );

      const final = await watcher.collectFinal();
      expect(final).toBeDefined();
      expect(final?.usage.inputTokens).toBe(43_944);
      expect(final?.usage.outputTokens).toBe(128);
      expect(final?.usage.ttftMs).toBe(6_655);
      expect(final?.usage.modelDurationMs).toBe(6_656);
      // 1ms buffered flush must never emit decodeMs=1 (which would inflate TPS to 128000 tok/s).
      expect(final?.usage.decodeMs).toBeUndefined();
      expect(final?.liveTokenUsage.decodeMs).toBeUndefined();
    });

    it("prevents multi-step partial decodeSum inflation (242 tok, TTFT 3.54s, dur 7.37s) on buffered and mixed steps", async () => {
      const root = createTempDir("prismux-dsh-multistep-burst-");
      const cwd = "D:\\Fish-code\\Prismux";
      const sessionId = "sess-multistep-burst";
      const sessionDir = NodePath.join(root, "sessions", encodeDshProjectKey(cwd), sessionId);
      NodeFS.mkdirSync(sessionDir, { recursive: true });
      const filePath = NodePath.join(sessionDir, "session.v4.jsonl.zstd");

      NodeFS.writeFileSync(
        filePath,
        compressFrame([
          {
            type: "session",
            version: 4,
            id: sessionId,
            createdAt: 1_795_689_270_000,
            cwd,
            isSeeded: false,
            delegationDepth: 0,
          },
        ]),
      );

      // Turn A: exact real DSH structure (step 1 buffered 170 tok in 1ms + 291ms finish delay;
      // step 2 buffered 72 tok in 0ms).
      const watcherA = makeDshTurnUsageWatcher({ dshHome: root, sessionId, cwd, settleWaitMs: 0 });
      NodeFS.appendFileSync(
        filePath,
        compressFrame([
          { seq: 126, type: "step/start", time: 1_795_689_280_342, data: { turn: 6, step: 1 } },
          {
            seq: 129,
            type: "assistant/message",
            time: 1_795_689_285_237, // dur = 4895ms, ttft = 4603ms, rawDecode = 292ms, tokSpan = 1ms
            data: {
              turn: 6,
              step: 1,
              usage: {
                inputTokens: 2_473,
                cacheReadTokens: 43_776,
                outputTokens: 170,
                totalTokens: 46_419,
              },
              message: {
                source: { provider: "magpie", model: "group/deepseek" },
                content: [
                  { type: "reasoning", text: "Checking environment before running pwsh." },
                  { type: "tool-call", name: "pwsh", arguments: { command: "echo ok" } },
                ],
              },
              stream: [
                {
                  type: "chunk",
                  time: 1_795_689_284_945,
                  chunk: { type: "block-start", index: 0, blockType: "reasoning" },
                },
                {
                  type: "reasoning-chunks",
                  time0: 1_795_689_284_945,
                  index: 0,
                  dt: [0, 0, 0, 1, 0],
                  texts: ["a", "b", "c", "d", "e", "f"],
                },
                {
                  type: "chunk",
                  time: 1_795_689_284_946,
                  chunk: { type: "block-start", index: 1, blockType: "tool-call" },
                },
                {
                  type: "tool-call-chunks",
                  time0: 1_795_689_284_946,
                  index: 1,
                  dt: [],
                  id: "tc-1",
                  name: "pwsh",
                  args: ['{"command":"echo ok"}'],
                },
                { type: "chunk", time: 1_795_689_285_236, chunk: { type: "block-end", index: 0 } },
                { type: "chunk", time: 1_795_689_285_236, chunk: { type: "usage" } },
                { type: "chunk", time: 1_795_689_285_236, chunk: { type: "finish" } },
              ],
            },
          },
          { seq: 134, type: "step/end", time: 1_795_689_285_974, data: { turn: 6, step: 1 } },
          { seq: 135, type: "step/start", time: 1_795_689_285_987, data: { turn: 6, step: 2 } },
          {
            seq: 136,
            type: "assistant/message",
            time: 1_795_689_288_457, // dur = 2470ms, ttft = 2470ms, rawDecode = 0ms
            data: {
              turn: 6,
              step: 2,
              usage: {
                inputTokens: 379,
                cacheReadTokens: 46_080,
                outputTokens: 72,
                totalTokens: 46_531,
              },
              message: {
                source: { provider: "magpie", model: "group/deepseek" },
                content: [{ type: "text", text: "Connected." }],
              },
              stream: [
                {
                  type: "chunk",
                  time: 1_795_689_288_457,
                  chunk: { type: "block-start", index: 0, blockType: "text" },
                },
                {
                  type: "text-chunks",
                  time0: 1_795_689_288_457,
                  index: 0,
                  dt: [],
                  texts: ["Connected."],
                },
                { type: "chunk", time: 1_795_689_288_457, chunk: { type: "block-end", index: 0 } },
                { type: "chunk", time: 1_795_689_288_457, chunk: { type: "usage" } },
                { type: "chunk", time: 1_795_689_288_457, chunk: { type: "finish" } },
              ],
            },
          },
          { seq: 137, type: "step/end", time: 1_795_689_288_458, data: { turn: 6, step: 2 } },
          { seq: 138, type: "turn/end", time: 1_795_689_288_459, data: { turn: 6 } },
        ]),
      );

      const finalA = await watcherA.collectFinal();
      expect(finalA).toBeDefined();
      expect(finalA?.usage.outputTokens).toBe(242);
      expect(finalA?.usage.ttftMs).toBe(3_537);
      expect(finalA?.usage.modelDurationMs).toBe(7_365);
      // Must NOT emit decodeMs=292 (which produced 242 / 0.292 = 829 tok/s).
      expect(finalA?.usage.decodeMs).toBeUndefined();
      expect(finalA?.liveTokenUsage.decodeMs).toBeUndefined();

      // Turn B: step 1 genuinely streams for 292ms (tokSpan = 260ms, valid step decodeMs = 292),
      // while step 2 is a 0ms buffered flush. Partial decodeSum must still be omitted so 242 total
      // tokens are never divided by step 1's 292ms alone.
      const watcherB = makeDshTurnUsageWatcher({ dshHome: root, sessionId, cwd, settleWaitMs: 0 });
      NodeFS.appendFileSync(
        filePath,
        compressFrame([
          { seq: 201, type: "step/start", time: 1_795_689_300_000, data: { turn: 7, step: 1 } },
          {
            seq: 202,
            type: "assistant/message",
            time: 1_795_689_304_895, // dur = 4895ms, ttft = 4603ms, valid decode = 292ms
            data: {
              turn: 7,
              step: 1,
              usage: { inputTokens: 1_000, outputTokens: 170, totalTokens: 1_170 },
              message: {
                source: { provider: "magpie", model: "group/deepseek" },
                content: [{ type: "reasoning", text: "streamed" }],
              },
              stream: [
                {
                  type: "reasoning-chunks",
                  time0: 1_795_689_304_603,
                  index: 0,
                  dt: [130, 130],
                  texts: ["part1", "part2", "part3"],
                },
                { type: "chunk", time: 1_795_689_304_895, chunk: { type: "finish" } },
              ],
            },
          },
          { seq: 203, type: "step/end", time: 1_795_689_304_900, data: { turn: 7, step: 1 } },
          { seq: 204, type: "step/start", time: 1_795_689_305_000, data: { turn: 7, step: 2 } },
          {
            seq: 205,
            type: "assistant/message",
            time: 1_795_689_307_470, // dur = 2470ms, buffered decode = 0ms
            data: {
              turn: 7,
              step: 2,
              usage: { inputTokens: 400, outputTokens: 72, totalTokens: 472 },
              message: {
                source: { provider: "magpie", model: "group/deepseek" },
                content: [{ type: "text", text: "ok" }],
              },
              stream: [
                { type: "text-chunks", time0: 1_795_689_307_470, index: 0, dt: [], texts: ["ok"] },
                { type: "chunk", time: 1_795_689_307_470, chunk: { type: "finish" } },
              ],
            },
          },
          { seq: 206, type: "turn/end", time: 1_795_689_307_471, data: { turn: 7 } },
        ]),
      );

      const finalB = await watcherB.collectFinal();
      expect(finalB).toBeDefined();
      expect(finalB?.usage.outputTokens).toBe(242);
      expect(finalB?.usage.ttftMs).toBe(3_537);
      expect(finalB?.usage.modelDurationMs).toBe(7_365);
      expect(finalB?.usage.decodeMs).toBeUndefined();
      expect(finalB?.liveTokenUsage.decodeMs).toBeUndefined();
    });

    it("rejects buffered >2000 tok/s tool-call bursts and isolates committed decodeMs from retried attempts", async () => {
      const root = createTempDir("prismux-dsh-retry-burst-");
      const cwd = "D:\\Fish-code\\Prismux";
      const sessionId = "sess-retry-burst";
      const sessionDir = NodePath.join(root, "sessions", encodeDshProjectKey(cwd), sessionId);
      NodeFS.mkdirSync(sessionDir, { recursive: true });
      const filePath = NodePath.join(sessionDir, "session.v4.jsonl.zstd");

      NodeFS.writeFileSync(
        filePath,
        compressFrame([
          {
            type: "session",
            version: 4,
            id: sessionId,
            createdAt: 1_794_085_100_000,
            cwd,
            isSeeded: false,
            delegationDepth: 0,
          },
        ]),
      );

      // 1. Buffered tool-call burst with 158ms trailing finish delay (745 tok / 0.158s = 4715 tok/s)
      const watcherBurst = makeDshTurnUsageWatcher({
        dshHome: root,
        sessionId,
        cwd,
        settleWaitMs: 0,
      });
      NodeFS.appendFileSync(
        filePath,
        compressFrame([
          { seq: 1, type: "step/start", time: 1_794_085_122_455, data: { turn: 1, step: 1 } },
          {
            seq: 2,
            type: "assistant/message",
            time: 1_794_085_127_470, // dur = 5015ms, rawDecode = 158ms -> 4715 tok/s > 2000
            data: {
              turn: 1,
              step: 1,
              usage: {
                inputTokens: 1_469,
                cacheReadTokens: 128_256,
                outputTokens: 745,
                totalTokens: 130_470,
              },
              message: {
                source: { provider: "magpie", model: "group/deepseek" },
                content: [{ type: "tool-call", name: "edit", arguments: "{}" }],
              },
              stream: [
                {
                  type: "tool-call-chunks",
                  time0: 1_794_085_127_312,
                  index: 0,
                  dt: [],
                  id: "tc-1",
                  name: "edit",
                  args: ["{}"],
                },
                { type: "chunk", time: 1_794_085_127_470, chunk: { type: "finish" } },
              ],
            },
          },
          { seq: 3, type: "turn/end", time: 1_794_085_127_471, data: { turn: 1 } },
        ]),
      );
      const burstResult = await watcherBurst.collectFinal();
      expect(burstResult?.usage.outputTokens).toBe(745);
      expect(burstResult?.usage.modelDurationMs).toBe(5_015);
      expect(burstResult?.usage.ttftMs).toBe(4_857);
      expect(burstResult?.usage.decodeMs).toBeUndefined();

      // 2. Failed assistant/attempt followed by retry: decodeMs uses committed stream, not failed attempt
      const watcherRetry = makeDshTurnUsageWatcher({
        dshHome: root,
        sessionId,
        cwd,
        settleWaitMs: 0,
      });
      NodeFS.appendFileSync(
        filePath,
        compressFrame([
          { seq: 10, type: "step/start", time: 1_794_318_708_563, data: { turn: 2, step: 1 } },
          {
            seq: 11,
            type: "assistant/attempt",
            time: 1_794_318_719_643,
            data: {
              turn: 2,
              step: 1,
              stream: [
                {
                  type: "reasoning-chunks",
                  time0: 1_794_318_713_499,
                  index: 0,
                  dt: [100],
                  texts: ["aborted", " attempt"],
                },
              ],
            },
          },
          {
            seq: 12,
            type: "assistant/message",
            time: 1_794_318_729_581, // dur = 21018ms
            data: {
              turn: 2,
              step: 1,
              usage: {
                inputTokens: 173,
                cacheReadTokens: 58_624,
                outputTokens: 855,
                totalTokens: 59_652,
              },
              message: {
                source: { provider: "magpie", model: "group/deepseek" },
                content: [{ type: "text", text: "retry ok" }],
              },
              stream: [
                {
                  type: "text-chunks",
                  time0: 1_794_318_724_356,
                  index: 0,
                  dt: [2_500, 2_500],
                  texts: ["retry ", "succeeded ", "cleanly"],
                },
                { type: "chunk", time: 1_794_318_729_581, chunk: { type: "finish" } },
              ],
            },
          },
          { seq: 13, type: "turn/end", time: 1_794_318_729_582, data: { turn: 2 } },
        ]),
      );
      const retryResult = await watcherRetry.collectFinal();
      expect(retryResult?.usage.modelDurationMs).toBe(21_018);
      expect(retryResult?.usage.ttftMs).toBe(4_936); // 1794318713499 - 1794318708563
      expect(retryResult?.usage.decodeMs).toBe(5_225); // 1794318729581 - 1794318724356 (committed stream only)
      expect(retryResult!.usage.ttftMs!).toBeLessThanOrEqual(retryResult!.usage.modelDurationMs!);
      expect(retryResult!.usage.decodeMs!).toBeLessThanOrEqual(retryResult!.usage.modelDurationMs!);
    });
  });

  describe("scanDshUsageRecords & scanDshUsageFiles", () => {
    it("enforces bounded LRU eviction on makeDshUsageFileCache", () => {
      const cache = makeDshUsageFileCache(2);
      cache.set("a", { mtimeMs: 1, size: 1, records: [] });
      cache.set("b", { mtimeMs: 2, size: 2, records: [] });
      // Touch "a" so "b" becomes least recently used.
      expect(cache.get("a")?.size).toBe(1);
      cache.set("c", { mtimeMs: 3, size: 3, records: [] });
      expect([...cache.keys()]).toEqual(["a", "c"]);
    });

    it("scans DSH sessions with uncached input semantics, skips seeded prefixes and stale mtime files, and caches unchanged files", async () => {
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
          compressFrame([
            {
              type: "session",
              version: 4,
              id: "sess-fresh",
              createdAt: freshTime - 5000,
              isSeeded: false,
              delegationDepth: 0,
            },
          ]),
          compressFrame([
            { seq: 1, type: "step/start", time: freshTime - 4000, data: { turn: 1, step: 1 } },
            {
              seq: 2,
              type: "assistant/message",
              time: freshTime,
              data: {
                turn: 1,
                step: 1,
                usage: {
                  inputTokens: 357,
                  outputTokens: 189,
                  totalTokens: 51746,
                  cacheReadTokens: 51200,
                },
                message: {
                  source: { provider: "magpie", model: '["magpie","group/deepseek"]' },
                  content: [{ type: "text", text: "ok" }],
                },
                stream: [
                  { type: "text-chunks", time0: freshTime - 3000, index: 0, dt: [], texts: ["ok"] },
                ],
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
          {
            type: "session",
            version: 4,
            id: "sess-stale",
            createdAt: staleTime,
            isSeeded: false,
            delegationDepth: 0,
          },
          {
            seq: 1,
            type: "assistant/message",
            time: staleTime,
            data: {
              turn: 1,
              step: 1,
              usage: { inputTokens: 999, outputTokens: 111, totalTokens: 1110 },
              message: {
                source: { provider: "magpie", model: "old-model" },
                content: [{ type: "text", text: "old" }],
              },
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
          {
            type: "session",
            version: 4,
            id: "sess-fork",
            createdAt: freshTime,
            isSeeded: true,
            delegationDepth: 0,
          },
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
              usage: {
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 250,
                cacheWriteTokens: 100,
              },
              message: {
                source: { provider: "magpie-anthropic", model: "dragon-api-max/claude-opus-5-5" },
                content: [],
              },
            },
          },
        ]
          .map((line) => JSON.stringify(line))
          .join("\n") + "\n",
      );

      const cache = makeDshUsageFileCache();
      const sinceMs = Date.parse("2026-07-31T00:00:00Z");
      const records = await scanDshUsageRecords({ dshHome: root, sinceMs, cache });
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
      const secondScan = await scanDshUsageFiles({ dshHome: root, sinceMs, cache });
      expect(secondScan.missing).toBe(false);
      expect(secondScan.error).toBe(false);
      expect(secondScan.files.flatMap((f) => f.records)).toEqual(records);
    });

    it("reports missing when <dshHome>/sessions does not exist", async () => {
      const root = createTempDir("prismux-dsh-missing-");
      const result = await scanDshUsageFiles({ dshHome: root });
      expect(result.missing).toBe(true);
      expect(result.error).toBe(false);
      expect(result.files).toEqual([]);
    });

    it("reads live local ~/.dsh/sessions without crashing when present on host", async () => {
      const localDshHome = NodePath.join(NodeOS.homedir(), ".dsh");
      const localSessionsDir = NodePath.join(localDshHome, "sessions");
      if (!NodeFS.existsSync(localSessionsDir)) {
        return;
      }
      const records = await scanDshUsageRecords({ dshHome: localDshHome });
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

  describe("native DSH context_injection projection", () => {
    it("extracts agent-instructions, runtime-context, skill-catalog, and time-context while skipping user/tool-jobs", async () => {
      const root = createTempDir("prismux-dsh-ctx-");
      const cwd = "D:\\Fish-code\\Prismux";
      const sessionId = "sess-ctx-1";
      const sessionDir = NodePath.join(root, "sessions", encodeDshProjectKey(cwd), sessionId);
      NodeFS.mkdirSync(sessionDir, { recursive: true });
      const filePath = NodePath.join(sessionDir, "session.v4.jsonl.zstd");

      // Baseline prior turn (seq <= 2) must not be re-emitted
      const baselineFrame = compressFrame([
        { type: "session", version: 4, id: sessionId, createdAt: 1_794_083_200_000 },
        {
          seq: 2,
          type: "user/message",
          time: 1_794_083_201_000,
          data: {
            id: "old-ctx",
            role: "user",
            source: {
              kind: "time-context",
              form: "snapshot",
              sections: [{ name: "t", text: "old" }],
            },
            content: [{ type: "text", text: "old time" }],
          },
        },
      ]);
      NodeFS.writeFileSync(filePath, baselineFrame);

      const watcher = makeDshTurnUsageWatcher({
        dshHome: root,
        sessionId,
        cwd,
        settleWaitMs: 0,
      });
      expect(watcher.baselineSeq).toBe(2);
      expect(watcher.readContextInjections()).toEqual([]);

      // New turn appends non-user context injections BEFORE any assistant/message step
      const ctxFrame = compressFrame([
        {
          seq: 10,
          type: "user/message",
          time: 1_794_083_211_685,
          data: {
            id: "msg-inst",
            role: "user",
            source: {
              kind: "agent-instructions",
              form: "instructions",
              baseline: true,
              changes: [
                {
                  action: "set",
                  scope: "user-global\u0000AGENTS.md",
                  path: "~/.dsh/AGENTS.md",
                  digest: "a367a9aa2ec0aab7d8214e62c04760cd811b9ce8",
                },
              ],
            },
            content: [
              {
                type: "text",
                text: "<system-reminder>\nThe following workspace instructions apply.\n</system-reminder>",
              },
            ],
          },
        },
        {
          seq: 11,
          type: "user/message",
          time: 1_794_083_211_686,
          data: {
            id: "msg-runtime",
            role: "user",
            source: {
              kind: "runtime-context",
              form: "snapshot",
              sections: [{ name: "working-directory:current", text: "C:\\workspace" }],
            },
            content: [{ type: "text", text: "Current runtime context." }],
          },
        },
        {
          seq: 12,
          type: "user/message",
          time: 1_794_083_211_687,
          data: {
            id: "msg-skills",
            role: "user",
            source: {
              kind: "skill-catalog",
              form: "catalog",
              entries: [
                { name: "core-rules", description: "Core baseline rules" },
                { name: "tdd", description: "Test driven development" },
              ],
            },
            content: [{ type: "text", text: "<system-reminder>\nSkills list\n</system-reminder>" }],
          },
        },
        {
          seq: 13,
          type: "user/message",
          time: 1_794_083_211_688,
          data: {
            id: "msg-time",
            role: "user",
            source: {
              kind: "time-context",
              form: "snapshot",
              sections: [
                { name: "time-context", text: "2026-11-26T01:00:00+08:00[Asia/Shanghai]" },
              ],
            },
            content: [{ type: "text", text: "Time sampled while preparing turn 1" }],
          },
        },
        {
          seq: 14,
          type: "user/message",
          time: 1_794_083_211_689,
          data: {
            id: "msg-user",
            role: "user",
            source: { kind: "user" },
            content: [{ type: "text", text: "Hello DSH" }],
          },
        },
        {
          seq: 15,
          type: "user/message",
          time: 1_794_083_211_690,
          data: {
            id: "msg-job",
            role: "user",
            source: { kind: "tool-jobs", form: "notice", summary: "bg job" },
            content: [{ type: "text", text: "bg job output" }],
          },
        },
      ]);
      NodeFS.writeFileSync(filePath, Buffer.concat([baselineFrame, ctxFrame]));

      // Works immediately before any assistant/message step commits
      expect(watcher.readTurnDelta()).toBeUndefined();
      const injected = watcher.readContextInjections();
      expect(injected.map((item) => item.sourceKind)).toEqual([
        "agent-instructions",
        "runtime-context",
        "skill-catalog",
        "time-context",
      ]);
      expect(injected[0]).toMatchObject({
        nativeId: "dsh-ctx:msg-inst:agent-instructions",
        label: "~/.dsh/AGENTS.md",
        sourcePath: "~/.dsh/AGENTS.md",
        statusLabel: "已载入",
        form: "instructions",
        baseline: true,
        files: [
          {
            action: "set",
            path: "~/.dsh/AGENTS.md",
            digest: "a367a9aa2ec0aab7d8214e62c04760cd811b9ce8",
          },
        ],
      });
      expect(injected[0]?.content).toContain("<system-reminder>");
      expect(injected[2]?.entries).toEqual([
        { name: "core-rules", description: "Core baseline rules" },
        { name: "tdd", description: "Test driven development" },
      ]);

      // Appending assistant/message + turn/end exposes both usage and contextInjections on collectFinal
      const stepFrame = compressFrame([
        {
          seq: 20,
          type: "assistant/message",
          time: 1_794_083_215_000,
          data: {
            turn: 1,
            step: 1,
            usage: {
              inputTokens: 120,
              cacheReadTokens: 800,
              cacheWriteTokens: 0,
              outputTokens: 50,
            },
            message: { source: { provider: "magpie", model: "group/deepseek" } },
          },
        },
        { seq: 21, type: "turn/end", time: 1_794_083_215_100, data: { turn: 1 } },
      ]);
      NodeFS.writeFileSync(filePath, Buffer.concat([baselineFrame, ctxFrame, stepFrame]));

      const finalDelta = await watcher.collectFinal();
      expect(finalDelta?.usage.inputTokens).toBe(920);
      expect(finalDelta?.contextInjections?.map((i) => i.sourceKind)).toEqual([
        "agent-instructions",
        "runtime-context",
        "skill-catalog",
        "time-context",
      ]);
    });
  });
});
