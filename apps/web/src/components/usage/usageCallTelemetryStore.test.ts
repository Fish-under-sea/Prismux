import { ProviderDriverKind, ProviderInstanceId } from "@prismux/core-contracts";
import { GTProvider, initializeGT } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  CALL_LOGS_PAGE_SIZE,
  UsageCallLogsSection,
  filterAndSortCallLogs,
  formatCallTimestamp,
} from "./UsageCallLogsSection";
import { deriveSessionTelemetryFromProjection } from "../chat/useSessionCallTelemetry";
import {
  MAX_LIVE_TELEMETRY_THREADS,
  MAX_USAGE_CALL_LOGS,
  USAGE_CALL_PERSIST_DEBOUNCE_MS,
  USAGE_CALL_TELEMETRY_STORAGE_KEY,
  clampTtftToDuration,
  clearSessionLiveTelemetry,
  clearUsageCallLogs,
  computeCacheHitRate,
  computeOutputTps,
  computeUsageCallSummaryMetrics,
  flushUsageCallLogsPersistence,
  formatCacheHitRate,
  formatDurationMs,
  formatTps,
  formatTtft,
  formatUsageModelDisplayName,
  getRecordedUsageCallLogs,
  getSessionLiveTelemetry,
  mergeUsageCallLogs,
  normalizeBackendUsageCallLog,
  recordModelCallTelemetry,
  reloadUsageCallLogsFromStorage,
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

    const merged = mergeUsageCallLogs(
      [liveLog],
      [
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
      ],
    );

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

  it("enforces physical invariant ttftMs <= durationMs on record, localStorage hydration, backend normalize, and merge", () => {
    expect(clampTtftToDuration(8_470, 8_430)).toBe(8_430);
    expect(clampTtftToDuration(7_916, 8_738)).toBe(7_916);
    expect(clampTtftToDuration(null, 8_430)).toBeNull();
    expect(clampTtftToDuration(500, null)).toBe(500);

    // 1. Direct recordModelCallTelemetry clamps 8470 -> 8430 and uses decodeMs for exact TPS
    const recorded = recordModelCallTelemetry({
      id: "turn:clamp-1",
      provider: "dsh",
      model: '["magpie","group/deepseek"]',
      ttftMs: 8_470,
      durationMs: 8_430,
      decodeMs: 822,
      inputTokens: 357,
      cachedInputTokens: 51_200,
      outputTokens: 189,
    });
    expect(recorded.ttftMs).toBe(8_430);
    expect(recorded.durationMs).toBe(8_430);
    expect(recorded.model).toBe("group/deepseek");
    expect(recorded.tps).toBeCloseTo(189 / (822 / 1_000), 4);

    // 2. Backend normalization clamps 8470 -> 8430
    const normalizedBackend = normalizeBackendUsageCallLog({
      id: "backend-clamp-1",
      timestamp: 200_000,
      provider: "dsh",
      model: '["magpie","group/deepseek"]',
      ttft_ms: 8_470,
      duration_ms: 8_430,
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(normalizedBackend.ttftMs).toBe(8_430);
    expect(normalizedBackend.model).toBe("group/deepseek");

    // 3. Merging a live record (ttftMs: 8470, durationMs: null) with backend (durationMs: 8430) clamps to 8430
    const liveWithoutDur = recordModelCallTelemetry({
      id: "turn:merge-clamp",
      timestamp: 300_000,
      provider: "dsh",
      model: "group/deepseek",
      ttftMs: 8_470,
      durationMs: null,
      inputTokens: 100,
      cachedInputTokens: 900,
      outputTokens: 50,
    });
    const merged = mergeUsageCallLogs(
      [liveWithoutDur],
      [
        {
          id: "turn:merge-clamp",
          timestamp: 300_000,
          provider: "dsh",
          model: "group/deepseek",
          ttftMs: null,
          durationMs: 8_430,
          inputTokens: 100,
          cachedInputTokens: 900,
          outputTokens: 50,
        },
      ],
    );
    expect(merged[0]?.ttftMs).toBe(8_430);
    expect(merged[0]?.durationMs).toBe(8_430);

    // 4. Hydrating corrupted persisted localStorage records clamps 8470 -> 8430 and unwraps JSON tuple model
    const previousStorage = globalThis.localStorage;
    const backing = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: (key: string, value: string) => {
          backing.set(key, value);
        },
        removeItem: (key: string) => {
          backing.delete(key);
        },
      },
    });
    try {
      backing.set(
        USAGE_CALL_TELEMETRY_STORAGE_KEY,
        JSON.stringify([
          {
            id: "persisted-bad-ttft",
            timestamp: 400_000,
            provider: "acpRegistry",
            model: '["magpie","group/deepseek"]',
            ttftMs: 8_470,
            durationMs: 8_430,
            tps: 25,
            inputTokens: 357,
            cachedInputTokens: 51_200,
            cacheCreationTokens: 0,
            outputTokens: 189,
            totalTokens: 51_746,
            cacheHitRate: 0.993,
            status: "completed",
            source: "live",
          },
        ]),
      );
      const reloaded = reloadUsageCallLogsFromStorage();
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0]?.ttftMs).toBe(8_430);
      expect(reloaded[0]?.durationMs).toBe(8_430);
      expect(reloaded[0]?.model).toBe("group/deepseek");
      expect(reloaded[0]?.provider).toBe("acpRegistry");
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previousStorage,
      });
    }
  });

  it("formats ACP tuple model slugs cleanly and resolves configured model display names", () => {
    const dshEntries: readonly ProviderInstanceEntry[] = [
      {
        instanceId: ProviderInstanceId.make("acpRegistry-dsh"),
        driverKind: ProviderDriverKind.make("acpRegistry"),
        displayName: "My DeepSeek",
        hasCustomDisplayName: true,
        acpRegistryAgentId: "dsh",
        enabled: true,
        installed: true,
        status: "ready",
        isDefault: false,
        isAvailable: true,
        snapshot: {} as ProviderInstanceEntry["snapshot"],
        models: [
          {
            slug: '["magpie","group/deepseek"]',
            name: "DeepSeek-V4.1-Flash",
            isCustom: false,
            capabilities: null,
          } as unknown as ProviderInstanceEntry["models"][number],
        ],
      },
    ];

    const withoutCatalog = formatUsageModelDisplayName('["magpie","group/deepseek"]');
    expect(withoutCatalog).toBe("group/deepseek");
    expect(withoutCatalog).not.toContain('["');
    expect(withoutCatalog).not.toContain('"]');

    expect(formatUsageModelDisplayName('["group","deepseek"]')).toBe("group/deepseek");
    expect(formatUsageModelDisplayName('["magpie","group/deepseek"]', dshEntries)).toBe(
      "DeepSeek-V4.1-Flash",
    );
    expect(formatUsageModelDisplayName("group/deepseek", dshEntries)).toBe("DeepSeek-V4.1-Flash");
    expect(formatUsageModelDisplayName("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("renders DSH blue whale icon, configured custom DSH name, clean model names, and legacy acpRegistry fallback in UsageCallLogsSection", () => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });
    const dshEntries: readonly ProviderInstanceEntry[] = [
      {
        instanceId: ProviderInstanceId.make("acpRegistry-dsh"),
        driverKind: ProviderDriverKind.make("acpRegistry"),
        displayName: "My DeepSeek",
        hasCustomDisplayName: true,
        acpRegistryAgentId: "dsh",
        enabled: true,
        installed: true,
        status: "ready",
        isDefault: false,
        isAvailable: true,
        snapshot: {} as ProviderInstanceEntry["snapshot"],
        models: [
          {
            slug: '["magpie","group/deepseek"]',
            name: "DeepSeek-V4.1-Flash",
            isCustom: false,
            capabilities: null,
          } as unknown as ProviderInstanceEntry["models"][number],
        ],
      },
    ];

    const logs = [
      {
        id: "dsh-call-1",
        timestamp: Date.parse("2026-11-25T10:00:00.000Z"),
        provider: "dsh",
        model: '["magpie","group/deepseek"]',
        ttftMs: 7_916,
        durationMs: 8_738,
        tps: 229.9,
        inputTokens: 357,
        cachedInputTokens: 51_200,
        cacheCreationTokens: 0,
        outputTokens: 189,
        totalTokens: 51_746,
        cacheHitRate: 51_200 / 51_557,
        status: "completed" as const,
        source: "backend" as const,
      },
      {
        id: "legacy-acp-1",
        timestamp: Date.parse("2026-11-25T09:50:00.000Z"),
        provider: "acpRegistry",
        model: "group/deepseek",
        ttftMs: 8_470,
        durationMs: 8_430,
        tps: 120.5,
        inputTokens: 400,
        cachedInputTokens: 4_600,
        cacheCreationTokens: 0,
        outputTokens: 100,
        totalTokens: 5_100,
        cacheHitRate: 0.92,
        status: "completed" as const,
        source: "live" as const,
      },
    ];

    // Filtering by clean formatted display model name matches both tuple and unwrapped slugs.
    const filteredByDisplayName = filterAndSortCallLogs(logs, {
      model: "DeepSeek-V4.1-Flash",
      providerEntries: dshEntries,
      sortField: "timestamp",
      sortDirection: "desc",
    });
    expect(filteredByDisplayName).toHaveLength(2);

    const htmlWithConfiguredDsh = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "en", translations: {} },
        createElement(UsageCallLogsSection, {
          logs,
          timeZone: "UTC",
          hour12: false,
          providerEntries: dshEntries,
        }),
      ),
    );
    expect(htmlWithConfiguredDsh).toContain("DeepSeek-V4.1-Flash");
    expect(htmlWithConfiguredDsh).toContain("My DeepSeek");
    expect(htmlWithConfiguredDsh).toContain('data-dsh-brand-icon="true"');
    expect(htmlWithConfiguredDsh).toContain("8.43 s");
    expect(htmlWithConfiguredDsh).not.toContain("8.47 s");
    expect(htmlWithConfiguredDsh).not.toContain('["magpie"');
    expect(htmlWithConfiguredDsh).not.toContain(">acpRegistry<");

    // Without configured entries: "dsh" -> "DeepSeek Harness" + blue whale icon; legacy "acpRegistry" -> "ACP Agent".
    const htmlWithoutConfigured = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "en", translations: {} },
        createElement(UsageCallLogsSection, {
          logs,
          timeZone: "UTC",
          hour12: false,
          providerEntries: [],
        }),
      ),
    );
    expect(htmlWithoutConfigured).toContain("DeepSeek Harness");
    expect(htmlWithoutConfigured).toContain("ACP Agent");
    expect(htmlWithoutConfigured).toContain('data-dsh-brand-icon="true"');
    expect(htmlWithoutConfigured).toContain("group/deepseek");
    expect(htmlWithoutConfigured).not.toContain('["magpie"');
    expect(htmlWithoutConfigured).not.toContain(">acpRegistry<");
  });

  it("caps liveByThread at 50 threads LRU, debounces localStorage writes by 1000ms, and paginates large call logs tables", () => {
    vi.useFakeTimers();
    const previousStorage = globalThis.localStorage;
    const setItemSpy = vi.fn();
    const backing = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: (key: string, value: string) => {
          setItemSpy(key, value);
          backing.set(key, value);
        },
        removeItem: (key: string) => {
          backing.delete(key);
        },
      },
    });
    try {
      // 1. Recording 65 distinct threads caps liveByThread to MAX_LIVE_TELEMETRY_THREADS (50)
      for (let i = 0; i < MAX_LIVE_TELEMETRY_THREADS + 15; i += 1) {
        vi.advanceTimersByTime(10);
        updateSessionLiveTelemetry(`thread-${i}`, {
          provider: "codex",
          model: "gpt-5.4-codex",
          outputTokens: 10 + i,
          active: false,
        });
      }
      expect(getSessionLiveTelemetry("thread-0")).toBeNull();
      expect(getSessionLiveTelemetry(`thread-${MAX_LIVE_TELEMETRY_THREADS + 14}`)).not.toBeNull();

      // 2. Rapid recordModelCallTelemetry writes coalesce into a single debounced localStorage serialization
      setItemSpy.mockClear();
      for (let i = 0; i < 10; i += 1) {
        recordModelCallTelemetry({
          id: `debounced-${i}`,
          timestamp: 500_000 + i * 100,
          provider: "codex",
          model: "gpt-5.4-codex",
          inputTokens: 100,
          outputTokens: 20 + i,
        });
      }
      expect(setItemSpy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(USAGE_CALL_PERSIST_DEBOUNCE_MS);
      expect(setItemSpy).toHaveBeenCalledTimes(1);

      // Flush writes immediately when requested
      recordModelCallTelemetry({
        id: "debounced-flush",
        timestamp: 600_000,
        provider: "codex",
        model: "gpt-5.4-codex",
        inputTokens: 50,
        outputTokens: 10,
      });
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      flushUsageCallLogsPersistence();
      expect(setItemSpy).toHaveBeenCalledTimes(2);

      // 3. UsageCallLogsSection paginates 120 rows to CALL_LOGS_PAGE_SIZE (50) rows per page
      initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });
      const manyLogs = Array.from({ length: CALL_LOGS_PAGE_SIZE * 2 + 20 }, (_, idx) => ({
        id: `paged-${idx}`,
        timestamp: 1_764_000_000_000 + idx * 1000,
        provider: "codex",
        model: "gpt-5.4-codex",
        ttftMs: 250,
        durationMs: 1250,
        tps: 80,
        inputTokens: 500,
        cachedInputTokens: 500,
        cacheCreationTokens: 0,
        outputTokens: 80,
        totalTokens: 1080,
        cacheHitRate: 0.5,
        status: "completed" as const,
        source: "backend" as const,
      }));
      const pagedHtml = renderToStaticMarkup(
        createElement(
          GTProvider,
          { locale: "en", translations: {} },
          createElement(UsageCallLogsSection, {
            logs: manyLogs,
            timeZone: "UTC",
            hour12: false,
            providerEntries: [],
          }),
        ),
      );
      expect(pagedHtml).toContain('data-testid="usage-call-logs-pagination"');
      expect(pagedHtml).toContain(`1–${CALL_LOGS_PAGE_SIZE} / ${manyLogs.length}`);
      expect(pagedHtml.match(/aria-expanded="false"/g)).toHaveLength(CALL_LOGS_PAGE_SIZE);
    } finally {
      vi.useRealTimers();
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previousStorage,
      });
    }
  });

  it("memoizes mergeUsageCallLogs by (localLogs, backendLogs) reference identity without retaining stale arrays", () => {
    const liveLog = recordModelCallTelemetry({
      id: "turn:memo-1",
      timestamp: 700_000,
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
      inputTokens: 1_000,
      cachedInputTokens: 2_000,
      outputTokens: 250,
      status: "completed",
    });
    const localLogs = [liveLog] as const;
    const backendLogs = [
      {
        id: "backend-memo-1",
        timestamp: 690_000,
        provider: "codex",
        model: "gpt-5.4-codex",
        inputTokens: 400,
        cachedInputTokens: 600,
        outputTokens: 100,
      },
    ] as const;

    const first = mergeUsageCallLogs(localLogs, backendLogs);
    const second = mergeUsageCallLogs(localLogs, backendLogs);
    expect(second).toBe(first);

    // Also memoizes null / undefined / empty backendLogs cleanly.
    const emptyA = mergeUsageCallLogs(localLogs, undefined);
    const emptyB = mergeUsageCallLogs(localLogs, null);
    const emptyC = mergeUsageCallLogs(localLogs, []);
    expect(emptyB).toBe(emptyA);
    expect(emptyC).toBe(emptyA);

    // Changing either array reference recomputes cleanly.
    const nextBackend = [...backendLogs];
    const third = mergeUsageCallLogs(localLogs, nextBackend);
    expect(third).not.toBe(first);
    expect(third).toEqual(first);
  });

  it("guards micro-burst decodeMs across all TPS entrypoints and self-heals persisted >2000 tok/s spikes", () => {
    // 1. User screenshot Row 2: 128 tok, TTFT 6.66s, duration 6.66s, decodeMs 1ms -> ~19.22 tok/s (never 128000)
    expect(computeOutputTps(128, 6_660, 6_660, 1)).toBeCloseTo(128 / 6.66, 4);

    // 2. User screenshot Row 1: 242 tok, TTFT 3.54s, duration 7.37s, decodeMs 1ms -> ~63.19 tok/s (242 / 3.83s)
    expect(computeOutputTps(242, 7_370, 3_540, 1)).toBeCloseTo(242 / 3.83, 4);

    // 3. decodeMs > 1.1x durationMs or implying > 2000 tok/s falls back to guarded post-TTFT/wall window
    expect(computeOutputTps(300, 5_000, 1_000, 100)).toBeCloseTo(300 / 4, 4);
    expect(computeOutputTps(100, 2_000, 500, 5_000)).toBeCloseTo(100 / 1.5, 4);

    // 4. recordModelCallTelemetry & normalizeBackendUsageCallLog guard decodeMs and sanitize explicit > 2000 tps
    const liveRow = recordModelCallTelemetry({
      id: "turn:dsh-burst-row2",
      provider: "dsh",
      model: "group/deepseek",
      ttftMs: 6_660,
      durationMs: 6_660,
      decodeMs: 1,
      inputTokens: 1_200,
      outputTokens: 128,
    });
    expect(liveRow.tps).toBeCloseTo(128 / 6.66, 4);

    const explicitBadLive = recordModelCallTelemetry({
      id: "turn:dsh-bad-explicit-tps",
      provider: "dsh",
      model: "group/deepseek",
      ttftMs: 3_540,
      durationMs: 7_370,
      decodeMs: 1,
      tps: 128_000,
      inputTokens: 1_200,
      outputTokens: 242,
    });
    expect(explicitBadLive.tps).toBeCloseTo(242 / 3.83, 4);

    const backendHealed = normalizeBackendUsageCallLog({
      id: "backend-dsh-burst",
      timestamp: 800_000,
      provider: "dsh",
      model: "group/deepseek",
      ttft_ms: 6_660,
      duration_ms: 6_660,
      decode_ms: 1,
      tps: 128_000,
      inputTokens: 1_000,
      outputTokens: 128,
    });
    expect(backendHealed.tps).toBeCloseTo(128 / 6.66, 4);

    const backendNoTimingBadTps = normalizeBackendUsageCallLog({
      id: "backend-dsh-no-timing-bad-tps",
      timestamp: 801_000,
      provider: "dsh",
      model: "group/deepseek",
      tps: 128_000,
      inputTokens: 1_000,
      outputTokens: 128,
    });
    expect(backendNoTimingBadTps.tps).toBeNull();

    // 5. updateSessionLiveTelemetry rejects > 2000 tok/s spikes
    updateSessionLiveTelemetry("thread-dsh-spike", {
      provider: "dsh",
      model: "group/deepseek",
      tps: 128_000,
      outputTokens: 128,
    });
    expect(getSessionLiveTelemetry("thread-dsh-spike")?.tps).toBeNull();

    // 6. Persisted localStorage hydration self-heals stale 128000 tok/s rows
    const previousStorage = globalThis.localStorage;
    const backing = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: (key: string, value: string) => {
          backing.set(key, value);
        },
        removeItem: (key: string) => {
          backing.delete(key);
        },
      },
    });
    try {
      backing.set(
        USAGE_CALL_TELEMETRY_STORAGE_KEY,
        JSON.stringify([
          {
            id: "persisted-dsh-128000",
            timestamp: 900_000,
            provider: "dsh",
            model: "group/deepseek",
            ttftMs: 6_660,
            durationMs: 6_660,
            tps: 128_000,
            inputTokens: 1_000,
            cachedInputTokens: 9_000,
            cacheCreationTokens: 0,
            outputTokens: 128,
            totalTokens: 10_128,
            cacheHitRate: 0.9,
            status: "completed",
            source: "live",
          },
          {
            id: "persisted-dsh-no-dur",
            timestamp: 899_000,
            provider: "dsh",
            model: "group/deepseek",
            ttftMs: null,
            durationMs: null,
            tps: 128_000,
            inputTokens: 500,
            cachedInputTokens: 0,
            cacheCreationTokens: 0,
            outputTokens: 128,
            totalTokens: 628,
            cacheHitRate: 0,
            status: "completed",
            source: "live",
          },
        ]),
      );
      const healed = reloadUsageCallLogsFromStorage();
      expect(healed).toHaveLength(2);
      expect(healed[0]?.tps).toBeCloseTo(128 / 6.66, 4);
      expect(healed[1]?.tps).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previousStorage,
      });
    }
  });
});
