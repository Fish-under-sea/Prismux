import { afterEach, describe, expect, it } from "vite-plus/test";

import { filterAndSortCallLogs, formatCallTimestamp } from "./UsageCallLogsSection";
import { deriveSessionTelemetryFromProjection } from "../chat/useSessionCallTelemetry";
import {
  MAX_USAGE_CALL_LOGS,
  clearSessionLiveTelemetry,
  clearUsageCallLogs,
  computeCacheHitRate,
  computeOutputTps,
  computeUsageCallSummaryMetrics,
  formatCacheHitRate,
  formatDurationMs,
  formatTps,
  formatTtft,
  getRecordedUsageCallLogs,
  getSessionLiveTelemetry,
  mergeUsageCallLogs,
  normalizeBackendUsageCallLog,
  recordModelCallTelemetry,
  updateSessionLiveTelemetry,
} from "./usageCallTelemetryStore";

afterEach(() => {
  clearUsageCallLogs();
});

describe("usageCallTelemetryStore", () => {
  it("computes real TTFT, TPS, and cache hit rate without fabricating missing data", () => {
    expect(computeCacheHitRate(200, 600, 200)).toBeCloseTo(0.6, 5);
    expect(computeCacheHitRate(0, 0, 0)).toBeNull();

    // Generation window subtracts TTFT when durationMs > ttftMs
    expect(computeOutputTps(100, 2500, 500)).toBeCloseTo(50, 5);
    expect(computeOutputTps(0, 2500, 500)).toBeNull();
    expect(computeOutputTps(100, null, 500)).toBeNull();

    expect(formatTtft(null)).toBe("—");
    expect(formatTtft(420)).toBe("420 ms");
    expect(formatTtft(1420)).toBe("1.42 s");
    expect(formatTps(null)).toBe("—");
    expect(formatTps(48.54)).toBe("48.5 tok/s");
    expect(formatTps(128.4)).toBe("128 tok/s");
    expect(formatCacheHitRate(null)).toBe("—");
    expect(formatCacheHitRate(0.742)).toBe("74.2%");
    expect(formatDurationMs(65_000)).toBe("1m 5s");
  });

  it("records real calls, enforces 500-entry bound, and updates live session telemetry", () => {
    const first = recordModelCallTelemetry({
      id: "turn-1",
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      threadId: "thread-alpha",
      turnStartedAt: 10_000,
      firstTokenAt: 10_450,
      completedAt: 12_450,
      inputTokens: 1_000,
      cachedInputTokens: 3_000,
      cacheWriteTokens: 0,
      outputTokens: 200,
      contextPercent: 24.5,
      status: "completed",
    });

    expect(first.ttftMs).toBe(450);
    expect(first.durationMs).toBe(2450);
    expect(first.tps).toBeCloseTo(100, 5);
    expect(first.cacheHitRate).toBeCloseTo(0.75, 5);
    expect(first.totalTokens).toBe(4200);

    const live = getSessionLiveTelemetry("thread-alpha");
    expect(live?.ttftMs).toBe(450);
    expect(live?.tps).toBeCloseTo(100, 5);
    expect(live?.sessionTotalTokens).toBe(4200);
    expect(live?.contextPercent).toBe(24.5);

    // Streaming updates refresh live snapshot without duplicating call logs
    updateSessionLiveTelemetry("thread-alpha", {
      active: true,
      tps: 64.2,
      contextPercent: 31.0,
    });
    expect(getSessionLiveTelemetry("thread-alpha")?.tps).toBeCloseTo(64.2, 5);
    expect(getRecordedUsageCallLogs().length).toBe(1);

    clearSessionLiveTelemetry("thread-alpha");
    expect(getSessionLiveTelemetry("thread-alpha")).toBeNull();

    // Enforce bounded 500-item retention
    for (let i = 0; i < MAX_USAGE_CALL_LOGS + 25; i += 1) {
      recordModelCallTelemetry({
        id: `bulk-${i}`,
        timestamp: 20_000 + i,
        provider: "codex",
        model: "gpt-5.4-codex",
        inputTokens: 100,
        outputTokens: 50,
      });
    }
    expect(getRecordedUsageCallLogs().length).toBe(MAX_USAGE_CALL_LOGS);
  });

  it("merges local live logs with backend callLogs without duplication and computes real summary metrics", () => {
    const liveLog = recordModelCallTelemetry({
      id: "turn:101",
      timestamp: 100_000,
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
      ttftMs: 380,
      durationMs: 2380,
      inputTokens: 500,
      cachedInputTokens: 1500,
      outputTokens: 100,
      status: "completed",
    });

    const merged = mergeUsageCallLogs([liveLog], [
      // Near-duplicate of liveLog from backend transcript (backend uses "claude" while live used "claudeAgent")
      {
        id: "backend-dup-1",
        timestamp: new Date(101_500).toISOString(),
        provider: "claude",
        model: "claude-sonnet-4-6",
        ttftMs: null,
        durationMs: 2400,
        tps: null,
        inputTokens: 500,
        cachedInputTokens: 1500,
        cacheCreationTokens: 0,
        outputTokens: 100,
        cacheHitRate: 0.75,
      },
      // Distinct historical backend call
      {
        id: "backend-hist-2",
        timestamp: 90_000,
        provider: "codex",
        model: "gpt-5.4-codex",
        ttftMs: 620,
        durationMs: 3620,
        tps: 60,
        inputTokens: 800,
        cachedInputTokens: 1200,
        cacheCreationTokens: 0,
        outputTokens: 180,
        cacheHitRate: 0.6,
      },
    ]);

    expect(merged.length).toBe(2);
    expect(merged[0]?.id).toBe("turn:101");
    expect(merged[0]?.ttftMs).toBe(380);
    expect(merged[1]?.id).toBe("backend-hist-2");

    const summary = computeUsageCallSummaryMetrics(merged);
    expect(summary.callCount).toBe(2);
    expect(summary.avgTtftMs).toBeCloseTo(500, 5);
    expect(summary.avgTps).toBeCloseTo(55, 5);
    expect(summary.cacheHitRate).toBeCloseTo((1500 + 1200) / (500 + 1500 + 800 + 1200), 5);

    // Filter & sort helper: nulls always stay at bottom
    const withNull = [
      ...merged,
      recordModelCallTelemetry({
        id: "no-timing",
        timestamp: 80_000,
        provider: "codex",
        model: "gpt-5.4-codex",
        inputTokens: 100,
        outputTokens: 20,
      }),
    ];
    const sortedByTpsDesc = filterAndSortCallLogs(withNull, {
      provider: "codex",
      sortField: "tps",
      sortDirection: "desc",
    });
    expect(sortedByTpsDesc.map((entry) => entry.id)).toEqual(["backend-hist-2", "no-timing"]);
  });

  it("formats call timestamps with exact HH:mm:ss instead of truncating to :00 hourly buckets", () => {
    const instant = Date.parse("2026-11-23T22:21:27.747Z"); // 2026-11-24 06:21:27 Asia/Shanghai
    const zh = formatCallTimestamp(instant, "Asia/Shanghai", false, "zh-CN");
    expect(zh).toContain("06:21:27");
    expect(zh).not.toContain("06:00");

    const en = formatCallTimestamp(instant, "UTC", false, "en-US");
    expect(en).toContain("22:21:27");
  });

  it("normalizes snake_case backend timing aliases, guards micro-burst TPS spikes, and counts reasoning deltas for TTFT", () => {
    const normalized = normalizeBackendUsageCallLog({
      id: "ag-1",
      timestamp: "2026-11-23T22:21:27.747Z",
      provider: "antigravity",
      model: "gemini-4-neon",
      ttft_ms: 4857,
      duration_ms: 14199,
      inputTokens: 3162,
      cachedInputTokens: 167712,
      outputTokens: 1356,
    });
    expect(normalized.ttftMs).toBe(4857);
    expect(normalized.durationMs).toBe(14199);
    expect(normalized.tps).toBeCloseTo(1356 / (9342 / 1000), 2);

    // Buffered micro-burst falls back to total wall time instead of spiking to 73,000 tok/s
    expect(computeOutputTps(73, 26_125, 26_124)).toBeCloseTo(73 / 26.125, 2);
    expect(computeOutputTps(50, 5, null)).toBeNull();

    // Streaming reasoning item increments assistantCharCount so thinking-first models stamp TTFT
    const derived = deriveSessionTelemetryFromProjection({
      serverProjection: {
        providerTurns: [],
        messages: [],
        turnItems: [
          {
            type: "reasoning",
            text: "analyzing call log pipeline...",
          } as unknown as never,
        ],
      },
      activeContextWindow: null,
    });
    expect(derived.assistantCharCount).toBe("analyzing call log pipeline...".length);
  });
});
