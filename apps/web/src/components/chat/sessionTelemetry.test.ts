import type { ContextWindowSnapshot } from "@prismux/client-runtime/state/context-window";
import type {
  OrchestrationV2ProviderTurn,
  OrchestrationV2Run,
  OrchestrationV2Subagent,
  OrchestrationV2TurnItem,
  ServerProvider,
} from "@prismux/core-contracts";
import { GTProvider, initializeGT } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  clearUsageCallLogs,
  getSessionLiveTelemetry,
  recordModelCallTelemetry,
  updateSessionLiveTelemetry,
} from "../usage/usageCallTelemetryStore";
import {
  clearPublishedComposerContextWindows,
  COMPOSER_INLINE_TELEMETRY_MIN_WIDTH_PX,
  ComposerLiveTelemetryStripView,
  formatCompactTelemetryTokens,
  formatTelemetryPopoverTps,
  formatTelemetryStripTps,
  publishComposerContextWindow,
  resolveComposerTelemetryDisplay,
  resolveContextBarTone,
  resolveContextRingTone,
  SessionContextWindowPopoverContent,
  SessionStatsPopoverContent,
  SessionTokenUsagePopoverContent,
  shouldWrapComposerTelemetryRow,
  transitionTelemetryPopover,
} from "./ComposerLiveTelemetryStrip";
import { getSessionTelemetryCopy } from "./sessionTelemetry.copy";
import {
  allocateRoundedPercentages,
  clearSessionTelemetryDetails,
  computeDonutSegments,
  deriveSessionTelemetryDetail,
  formatCompactPopoverTokens,
  formatIntegerTokens,
  mergeTimeIntervals,
  publishSessionTelemetryDetail,
  getSessionTelemetryDetail,
  resolveGlobalTodayAndMonthTokens,
  type SessionProjectionLike,
} from "./sessionTelemetry.logic";
import {
  deriveContextOccupancyPercent,
  deriveSessionTelemetryFromProjection,
  extractProviderTurnTokenCounts,
} from "./useSessionCallTelemetry";

function makeProviderTurn(
  overrides: Partial<OrchestrationV2ProviderTurn>,
): OrchestrationV2ProviderTurn {
  return {
    id: "turn-1" as OrchestrationV2ProviderTurn["id"],
    status: "completed",
    startedAt: "2026-11-23T12:00:00.000Z" as unknown as OrchestrationV2ProviderTurn["startedAt"],
    completedAt: "2026-11-23T12:00:10.000Z" as unknown as OrchestrationV2ProviderTurn["completedAt"],
    ...overrides,
  } as OrchestrationV2ProviderTurn;
}

function makeRun(id: string, ordinal: number, status = "completed"): OrchestrationV2Run {
  return {
    id,
    ordinal,
    status,
  } as unknown as OrchestrationV2Run;
}

function makeToolItem(
  id: string,
  type: "command_execution" | "file_change" | "dynamic_tool",
  startedAt: string,
  completedAt: string,
): OrchestrationV2TurnItem {
  return {
    id,
    runId: "run-1",
    nodeId: `node-${id}`,
    type,
    status: "completed",
    startedAt,
    completedAt,
    updatedAt: completedAt,
  } as unknown as OrchestrationV2TurnItem;
}

function makeSubagent(
  overrides: Partial<OrchestrationV2Subagent>,
): OrchestrationV2Subagent {
  return {
    id: "sub-1",
    threadId: "thread-main",
    runId: "run-1",
    parentNodeId: "node-root",
    origin: "provider_native",
    driver: "antigravity",
    providerInstanceId: "inst-agy",
    providerThreadId: null,
    childThreadId: null,
    nativeTaskRef: null,
    prompt: "subtask",
    title: "Subagent",
    model: null,
    status: "completed",
    result: "done",
    startedAt: null,
    completedAt: null,
    updatedAt: "2026-11-23T12:05:00.000Z",
    ...overrides,
  } as unknown as OrchestrationV2Subagent;
}

const TEST_PROVIDERS: readonly ServerProvider[] = [
  {
    instanceId: "inst-agy",
    driver: "antigravity",
    displayName: "Antigravity",
    enabled: true,
    models: [
      {
        slug: "MODEL_PLACEHOLDER_M535",
        name: "Gemini 4 Neon (XHigh)",
        isCustom: false,
        capabilities: null,
      },
      {
        slug: "MODEL_PLACEHOLDER_M536",
        name: "Gemini 4 Hydrogen (XHigh)",
        isCustom: false,
        capabilities: null,
      },
    ],
  } as unknown as ServerProvider,
  {
    instanceId: "inst-claude",
    driver: "claudeAgent",
    displayName: "Claude Code",
    enabled: true,
    models: [
      {
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        isCustom: false,
        capabilities: null,
      },
    ],
  } as unknown as ServerProvider,
];

describe("Session telemetry aggregation, strict active-thread isolation & 3 independent popovers", () => {
  afterEach(() => {
    clearUsageCallLogs();
    clearSessionTelemetryDetails();
    clearPublishedComposerContextWindows();
  });

  it("extracts normalized turn token counts without double-counting cached input tokens", () => {
    const counts = extractProviderTurnTokenCounts({
      turnTokenUsage: {
        usageScope: "main_agent",
        hasSubagents: false,
        usageStatus: "partial",
        inputTokens: 10_000,
        cachedInputTokens: 7_800,
        cacheCreationTokens: 200,
        outputTokens: 600,
      },
      tokenUsage: undefined,
    });

    expect(counts).toEqual({
      uncachedInputTokens: 2_000,
      cachedInputTokens: 7_800,
      cacheCreationTokens: 200,
      outputTokens: 600,
      totalTokens: 10_600,
      hasMeasuredTokens: true,
    });
  });

  it("falls back to live tokenUsage when turnTokenUsage is unavailable and never fabricates counts", () => {
    const fallbackCounts = extractProviderTurnTokenCounts({
      turnTokenUsage: {
        usageScope: "main_agent",
        hasSubagents: false,
        usageStatus: "unavailable",
      },
      tokenUsage: {
        usedTokens: 4_500,
        inputTokens: 4_000,
        cachedInputTokens: 3_000,
        outputTokens: 500,
        updatedAt: "2026-11-23T12:00:00.000Z",
      },
    });
    expect(fallbackCounts).toEqual({
      uncachedInputTokens: 1_000,
      cachedInputTokens: 3_000,
      cacheCreationTokens: 0,
      outputTokens: 500,
      totalTokens: 4_500,
      hasMeasuredTokens: true,
    });

    const emptyCounts = extractProviderTurnTokenCounts({
      turnTokenUsage: undefined,
      tokenUsage: undefined,
    });
    expect(emptyCounts.hasMeasuredTokens).toBe(false);
    expect(emptyCounts.totalTokens).toBe(0);
  });

  it("enforces strict empty-session isolation: never leaks 3.48B global usage or other threads onto a fresh thread", () => {
    initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });
    const zhCopy = getSessionTelemetryCopy("zh");

    const display = resolveComposerTelemetryDisplay(null, null, {
      threadId: "brand-new-empty-thread",
      callLogs: [
        {
          id: "other-thread-call-1",
          timestamp: Date.parse("2026-11-23T08:00:00.000Z"),
          provider: "codex",
          model: "gpt-5.4-codex",
          threadId: "different-older-thread",
          ttftMs: 420,
          durationMs: 3_000,
          tps: 98.4,
          inputTokens: 50_000,
          cachedInputTokens: 450_000,
          cacheCreationTokens: 0,
          outputTokens: 1_200,
          totalTokens: 501_200,
          cacheHitRate: 0.9,
          status: "completed",
          source: "live",
        },
      ],
      mergedUsage: {
        totalTokens: 3_480_000_000,
        uncachedInputTokens: 226_200_000,
        cachedInputTokens: 3_253_800_000,
        cacheCreationTokens: 0,
        daily: [
          { day: "2026-11-01", costUsd: 10, totalTokens: 2_902_400_000, byProvider: new Map() },
          { day: "2026-11-23", costUsd: 4, totalTokens: 397_600_000, byProvider: new Map() },
        ],
      },
      todayDay: "2026-11-23",
      providerStatuses: TEST_PROVIDERS,
      selectedModelId: "MODEL_PLACEHOLDER_M535",
      selectedProvider: "antigravity",
    });

    // Trigger strip MUST stay strictly zero/empty for the new thread — ZERO global leakage!
    expect(display.tps).toBeNull();
    expect(display.tpsScope).toBe("none");
    expect(display.totalTokens).toBe(0);
    expect(display.tokensScope).toBe("none");
    expect(display.cacheHitRate).toBeNull();
    expect(display.contextPercent).toBeNull();
    expect(display.contextTone).toBe("unknown");
    expect(display.contextBarTone).toBe("unknown");
    expect(display.rounds).toBe(0);
    expect(display.steps).toBe(0);
    expect(display.samples).toBe(0);
    expect(display.modelDistribution).toHaveLength(0);
    expect(display.hasMultipleSampledModels).toBe(false);

    // Global reference values ARE populated for Popover 2's bottom reference cards ONLY.
    expect(display.globalTodayTokens).toBe(397_600_000);
    expect(display.globalMonthTokens).toBe(3_300_000_000);

    // Trigger strip renders 3 separate buttons with graceful empty state (never "3.48B tok").
    const stripHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "zh", translations: {} },
        createElement(ComposerLiveTelemetryStripView, {
          display,
          onOpenUsage: () => undefined,
        }),
      ),
    );
    expect(stripHtml).toContain('data-telemetry-trigger="stats"');
    expect(stripHtml).toContain('data-telemetry-trigger="tokens"');
    expect(stripHtml).toContain('data-telemetry-trigger="context"');
    expect(stripHtml).toContain("— tok/s");
    expect(stripHtml).toContain("0 tok");
    expect(stripHtml).toContain("上下文 —");
    expect(stripHtml).not.toContain("3.48B");
    expect(stripHtml).not.toContain("缓存命中 —");

    // Popover 1 empty state
    const statsHtml = renderToStaticMarkup(
      createElement(SessionStatsPopoverContent, { display, copy: zhCopy }),
    );
    expect(statsHtml).toContain("会话统计");
    expect(statsHtml).toContain("0轮 0步 · 0 次采样");
    expect(statsHtml).toContain("0 / 0 tok");

    // Popover 2 empty session + global reference bottom
    const tokensHtml = renderToStaticMarkup(
      createElement(SessionTokenUsagePopoverContent, {
        display,
        copy: zhCopy,
        onOpenUsage: () => undefined,
      }),
    );
    expect(tokensHtml).toContain("Token 用量");
    expect(tokensHtml).toContain("当前会话暂无模型采样");
    expect(tokensHtml).toContain("0 个模型");
    expect(tokensHtml).toContain("今日用量");
    expect(tokensHtml).toContain("397.6M");
    expect(tokensHtml).toContain("本月用量");
    expect(tokensHtml).toContain("3.3B");
    expect(tokensHtml).toContain("查看用量统计");

    // Popover 3 empty state
    const contextHtml = renderToStaticMarkup(
      createElement(SessionContextWindowPopoverContent, { display, copy: zhCopy }),
    );
    expect(contextHtml).toContain("上下文窗口");
    expect(contextHtml).toContain("0% 已用（剩余 100%）");
    expect(contextHtml).toContain("0 / — tok");
    expect(contextHtml).toContain("Gemini 4 Neon (XHigh)");
    expect(contextHtml).toContain("MODEL_PLACEHOLDER_M535");
    expect(contextHtml).not.toContain("当前会话采样了多个模型");
  });

  it("derives accurate single-model session stats, non-overlapping durations, reasoning split, and context bar", () => {
    const turn1 = makeProviderTurn({
      id: "turn-s1" as OrchestrationV2ProviderTurn["id"],
      model: "claude-sonnet-4-6",
      startedAt: "2026-11-23T12:00:00.000Z" as unknown as OrchestrationV2ProviderTurn["startedAt"],
      completedAt: "2026-11-23T12:00:20.000Z" as unknown as OrchestrationV2ProviderTurn["completedAt"],
      turnTokenUsage: {
        usageScope: "main_agent",
        hasSubagents: false,
        usageStatus: "complete",
        inputTokens: 100_000,
        cachedInputTokens: 80_000,
        cacheCreationTokens: 5_000,
        outputTokens: 1_500,
        reasoningTokens: 500,
        models: ["claude-sonnet-4-6"],
      },
    });

    // Two overlapping tool calls: [12:00:05..12:00:11] and [12:00:08..12:00:13] -> merged 8s tool time
    const projection: SessionProjectionLike = {
      runs: [makeRun("run-1", 1)],
      providerTurns: [turn1],
      turnItems: [
        makeToolItem("tool-1", "command_execution", "2026-11-23T12:00:05.000Z", "2026-11-23T12:00:11.000Z"),
        makeToolItem("tool-2", "file_change", "2026-11-23T12:00:08.000Z", "2026-11-23T12:00:13.000Z"),
      ],
      messages: [],
      subagents: [],
      nodes: [],
    };

    const timings = new Map([
      [
        "turn-s1",
        {
          turnStartedAt: Date.parse("2026-11-23T12:00:00.000Z"),
          firstTokenAt: Date.parse("2026-11-23T12:00:02.000Z"), // 2s TTFT
        },
      ],
    ]);

    const contextWindow = {
      usedTokens: 132_400,
      maxTokens: 512_000,
    } as ContextWindowSnapshot;

    const detail = deriveSessionTelemetryDetail({
      threadId: "thread-single",
      serverProjection: projection,
      activeContextWindow: contextWindow,
      providerStatuses: TEST_PROVIDERS,
      activeProvider: "claudeAgent",
      activeModel: "claude-sonnet-4-6",
      turnTimingsById: timings,
    });

    expect(detail.rounds).toBe(1);
    expect(detail.steps).toBe(2);
    expect(detail.samples).toBe(1);
    expect(detail.toolCallDurationMs).toBe(8_000);
    // 20s turn - 8s merged tool overlap = 12s model call time
    expect(detail.modelCallDurationMs).toBe(12_000);
    expect(detail.avgTtftMs).toBe(2_000);
    // Generation window = 20s - 2s TTFT = 18s -> 1500 / 18 = 83.333... tok/s
    expect(detail.sessionTps).toBeCloseTo(1500 / 18, 4);
    expect(detail.latestRequestTps).toBeCloseTo(1500 / 18, 4);
    expect(detail.textOutputTokens).toBe(1_000);
    expect(detail.reasoningOutputTokens).toBe(500);
    // Uncached input includes cache creation (15,000 + 5,000 = 20,000), cached = 80,000, output = 1,500
    expect(detail.uncachedInputTokens).toBe(20_000);
    expect(detail.cachedInputTokens).toBe(80_000);
    expect(detail.outputTokens).toBe(1_500);
    expect(detail.sessionTotalTokens).toBe(101_500);
    expect(detail.cacheHitRate).toBeCloseTo(0.8, 5);
    expect(detail.modelDistribution).toHaveLength(1);
    expect(detail.modelDistribution[0]).toMatchObject({
      modelId: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      percent: 100,
      compactTokens: "101.5K",
    });

    const display = resolveComposerTelemetryDisplay(null, contextWindow, {
      threadId: "thread-single",
      detail,
      providerStatuses: TEST_PROVIDERS,
    });

    expect(display.hasMultipleSampledModels).toBe(false);
    expect(display.contextPercent).toBeCloseTo((132_400 / 512_000) * 100, 3);
    expect(display.contextBarTone).toBe("normal");
    expect(display.sampledModelDisplayName).toBe("Claude Sonnet 4.6");
    expect(display.primaryEntrypointId).toBe("claude-sonnet-4-6");

    const zhCopy = getSessionTelemetryCopy("zh");
    const contextHtml = renderToStaticMarkup(
      createElement(SessionContextWindowPopoverContent, { display, copy: zhCopy }),
    );
    expect(contextHtml).toContain("26% 已用（剩余 74%）");
    expect(contextHtml).toContain("132.4K / 512K tok");
    expect(contextHtml).toContain('data-context-bar-tone="normal"');
    expect(contextHtml).toContain("bg-[#22c55e]");
    expect(contextHtml).toContain("Claude Sonnet 4.6");
    expect(contextHtml).toContain("claude-sonnet-4-6");
    expect(contextHtml).not.toContain("当前会话采样了多个模型");
  });

  it("aggregates multi-model distribution, Donut chart, subagent tokens, and multi-model notice accurately", () => {
    const turnNeon = makeProviderTurn({
      id: "turn-m1" as OrchestrationV2ProviderTurn["id"],
      model: "MODEL_PLACEHOLDER_M535",
      startedAt: "2026-11-23T10:00:00.000Z" as unknown as OrchestrationV2ProviderTurn["startedAt"],
      completedAt: "2026-11-23T10:00:10.000Z" as unknown as OrchestrationV2ProviderTurn["completedAt"],
      turnTokenUsage: {
        usageScope: "main_agent",
        hasSubagents: true,
        usageStatus: "complete",
        inputTokens: 189_200_000,
        cachedInputTokens: 181_000_000,
        cacheCreationTokens: 0,
        outputTokens: 700_000,
        reasoningTokens: 300_000,
        models: ["MODEL_PLACEHOLDER_M535"],
        otherUsage: { inputTokens: 1_200_000_000, outputTokens: 10_000_000 },
      },
    });
    const turnHydrogen = makeProviderTurn({
      id: "turn-m2" as OrchestrationV2ProviderTurn["id"],
      model: "MODEL_PLACEHOLDER_M536",
      startedAt: "2026-11-23T10:05:00.000Z" as unknown as OrchestrationV2ProviderTurn["startedAt"],
      completedAt: "2026-11-23T10:05:05.000Z" as unknown as OrchestrationV2ProviderTurn["completedAt"],
      turnTokenUsage: {
        usageScope: "main_agent",
        hasSubagents: false,
        usageStatus: "complete",
        inputTokens: 53_565_613,
        cachedInputTokens: 51_324_662,
        cacheCreationTokens: 0,
        outputTokens: 234_387,
        reasoningTokens: 131_226,
        models: ["MODEL_PLACEHOLDER_M536"],
      },
    });

    const nativeSub = makeSubagent({
      id: "sub-native" as OrchestrationV2Subagent["id"],
      origin: "provider_native",
    });
    const appOwnedSub = makeSubagent({
      id: "sub-app" as OrchestrationV2Subagent["id"],
      origin: "app_owned",
      childThreadId: "child-thread-1" as unknown as OrchestrationV2Subagent["childThreadId"],
      workflow: {
        phases: [],
        agents: [
          { index: 0, label: "worker-1", state: "completed", totalTokens: 300_000_000 },
          { index: 1, label: "worker-2", state: "completed", totalTokens: 320_924_086 },
        ],
        totalTokens: 620_924_086,
      },
    });

    const detail = deriveSessionTelemetryDetail({
      threadId: "thread-multi",
      serverProjection: {
        runs: [makeRun("run-1", 1), makeRun("run-2", 2)],
        providerTurns: [turnNeon, turnHydrogen],
        subagents: [nativeSub, appOwnedSub],
        turnItems: [],
        messages: [],
        nodes: [],
      },
      activeContextWindow: {
        usedTokens: 132_400,
        maxTokens: 512_000,
      } as ContextWindowSnapshot,
      providerStatuses: TEST_PROVIDERS,
      activeProvider: "antigravity",
      activeModel: "MODEL_PLACEHOLDER_M535",
    });

    // Main session total = 189,900,000 + 53,800,000 = 243,700,000
    expect(detail.sessionTotalTokens).toBe(243_700_000);
    // Subagents: 1 native + 2 workflow agents = 3 subagents
    expect(detail.subagentCount).toBe(3);
    // Subagent tokens: 1,210,000,000 (native otherUsage) + 620,924,086 (app-owned workflow) = 1,830,924,086
    expect(detail.subagentTotalTokens).toBe(1_830_924_086);
    expect(detail.aggregatedTaskTotalTokens).toBe(243_700_000 + 1_830_924_086);
    expect(detail.distinctSampledModels).toEqual([
      "MODEL_PLACEHOLDER_M535",
      "MODEL_PLACEHOLDER_M536",
    ]);
    expect(detail.modelDistribution).toHaveLength(2);
    expect(detail.modelDistribution[0]!.displayName).toBe("Gemini 4 Neon (XHigh)");
    expect(detail.modelDistribution[0]!.percent).toBe(78);
    expect(detail.modelDistribution[0]!.compactTokens).toBe("189.9M");
    expect(detail.modelDistribution[1]!.displayName).toBe("Gemini 4 Hydrogen (XHigh)");
    expect(detail.modelDistribution[1]!.percent).toBe(22);
    expect(detail.modelDistribution[1]!.compactTokens).toBe("53.8M");

    const display = resolveComposerTelemetryDisplay(
      null,
      { usedTokens: 132_400, maxTokens: 512_000 } as ContextWindowSnapshot,
      {
        threadId: "thread-multi",
        detail,
        providerStatuses: TEST_PROVIDERS,
      },
    );
    expect(display.hasMultipleSampledModels).toBe(true);
    expect(display.distinctSampledModelCount).toBe(2);

    const zhCopy = getSessionTelemetryCopy("zh");
    const tokensHtml = renderToStaticMarkup(
      createElement(SessionTokenUsagePopoverContent, {
        display,
        copy: zhCopy,
        onOpenUsage: () => undefined,
      }),
    );
    expect(tokensHtml).toContain("243,700,000 tok");
    expect(tokensHtml).toContain("任务总 Token（聚合）");
    expect(tokensHtml).toContain("2,074,624,086 tok");
    expect(tokensHtml).toContain("子代理（3 个）");
    expect(tokensHtml).toContain("1,830,924,086 tok");
    expect(tokensHtml).toContain("多模型分布");
    expect(tokensHtml).toContain("2 个模型");
    expect(tokensHtml).toContain('data-telemetry-model-donut="true"');
    expect(tokensHtml).toContain("Gemini 4 Neon (XHigh)");
    expect(tokensHtml).toContain("78% (189.9M)");
    expect(tokensHtml).toContain("Gemini 4 Hydrogen (XHigh)");
    expect(tokensHtml).toContain("22% (53.8M)");

    const contextHtml = renderToStaticMarkup(
      createElement(SessionContextWindowPopoverContent, { display, copy: zhCopy }),
    );
    expect(contextHtml).toContain('data-telemetry-multi-model-note="true"');
    expect(contextHtml).toContain("当前会话采样了多个模型");

    // Donut geometry covers full circumference cleanly.
    const segments = computeDonutSegments(detail.modelDistribution, 20);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.share + segments[1]!.share).toBeCloseTo(1, 5);
  });

  it("handles mutual-exclusion transitions across all 3 independent popovers cleanly", () => {
    expect(transitionTelemetryPopover(null, "stats", true)).toBe("stats");
    // Opening Popover 2 while Popover 1 is open switches immediately to Popover 2.
    expect(transitionTelemetryPopover("stats", "tokens", true)).toBe("tokens");
    // Stale close event from Popover 1 MUST NOT close Popover 2!
    expect(transitionTelemetryPopover("tokens", "stats", false)).toBe("tokens");
    // Opening Popover 3 replaces Popover 2.
    expect(transitionTelemetryPopover("tokens", "context", true)).toBe("context");
    // Closing active Popover 3 dismisses it.
    expect(transitionTelemetryPopover("context", "context", false)).toBeNull();
  });

  it("classifies context ring tones, progress bar colors, and formatting helpers accurately in zh and en", () => {
    expect(resolveContextRingTone(null)).toBe("unknown");
    expect(resolveContextRingTone(undefined)).toBe("unknown");
    expect(resolveContextRingTone(-5)).toBe("unknown");
    expect(resolveContextRingTone(Number.NaN)).toBe("unknown");
    expect(resolveContextRingTone(0)).toBe("normal");
    expect(resolveContextRingTone(59.9)).toBe("normal");
    expect(resolveContextRingTone(60)).toBe("warning");
    expect(resolveContextRingTone(94.9)).toBe("warning");
    expect(resolveContextRingTone(95)).toBe("compact");
    expect(resolveContextRingTone(100)).toBe("compact");
    expect(resolveContextRingTone(100.1)).toBe("overflow");

    expect(resolveContextBarTone(null)).toBe("unknown");
    expect(resolveContextBarTone(26)).toBe("normal");
    expect(resolveContextBarTone(75)).toBe("warning");
    expect(resolveContextBarTone(92)).toBe("critical");
    expect(resolveContextBarTone(112)).toBe("critical");

    expect(
      deriveContextOccupancyPercent({ usedTokens: 224_000, maxTokens: 200_000 }),
    ).toBeCloseTo(112, 5);

    expect(formatCompactTelemetryTokens(0)).toBe("0");
    expect(formatCompactTelemetryTokens(12_400)).toBe("12.4k");
    expect(formatCompactTelemetryTokens(208_800_000)).toBe("208.8M");
    expect(formatCompactTelemetryTokens(3_088_000_000)).toBe("3.09B");

    expect(formatCompactPopoverTokens(132_400)).toBe("132.4K");
    expect(formatCompactPopoverTokens(512_000)).toBe("512K");
    expect(formatCompactPopoverTokens(189_900_000)).toBe("189.9M");
    expect(formatCompactPopoverTokens(3_300_000_000)).toBe("3.3B");
    expect(formatIntegerTokens(243_643_888)).toBe("243,643,888");

    expect(formatTelemetryStripTps(null)).toBe("— tok/s");
    expect(formatTelemetryStripTps(102.14)).toBe("102.1 tok/s");
    expect(formatTelemetryPopoverTps(null)).toBe("—");
    expect(formatTelemetryPopoverTps(128.4)).toBe("128.4 tok/s");

    const zhCopy = getSessionTelemetryCopy("zh");
    const enCopy = getSessionTelemetryCopy("en");
    expect(zhCopy.formatDuration((5 * 3600 + 23 * 60 + 39) * 1000)).toBe("5小时23分39秒");
    expect(zhCopy.formatDuration((39 * 60 + 9) * 1000)).toBe("39分9秒");
    expect(zhCopy.formatDuration(4_200)).toBe("4.2秒");
    expect(zhCopy.formatDuration(null)).toBe("—");
    expect(zhCopy.formatTtft(13_630)).toBe("13.63 秒");
    expect(enCopy.formatDuration((5 * 3600 + 23 * 60 + 39) * 1000)).toBe("5h 23m 39s");
    expect(enCopy.formatTtft(13_630)).toBe("13.63 s");

    expect(allocateRoundedPercentages([189.9, 53.8])).toEqual([78, 22]);
    expect(allocateRoundedPercentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(
      mergeTimeIntervals([
        [100, 300],
        [200, 500],
        [600, 700],
      ]),
    ).toEqual([
      [100, 500],
      [600, 700],
    ]);
  });

  it("renders active session triggers in zh and en, supports overflow, narrow wrapping, and detail store bridge", () => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });

    recordModelCallTelemetry({
      id: "turn:t-100",
      turnId: "t-100",
      threadId: "thread-spec3",
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
      turnStartedAt: 1_000,
      firstTokenAt: 1_500,
      completedAt: 11_500,
      inputTokens: 2_200,
      cachedInputTokens: 7_800,
      outputTokens: 482,
      reasoningTokens: 182,
      contextPercent: 65,
      status: "completed",
    });

    const live = getSessionLiveTelemetry("thread-spec3");
    const display = resolveComposerTelemetryDisplay(live, null);
    expect(display.avgTtftMs).toBe(500);
    expect(display.tps).toBeCloseTo(48.2, 5);
    expect(display.totalTokens).toBe(10_482);
    expect(display.cacheHitRate).toBeCloseTo(0.78, 5);
    expect(display.contextPercent).toBe(65);
    expect(display.contextTone).toBe("warning");
    expect(display.contextBarTone).toBe("warning");
    expect(display.reasoningOutputTokens).toBe(182);
    expect(display.textOutputTokens).toBe(300);

    updateSessionLiveTelemetry("thread-render", {
      provider: "codex",
      model: "gpt-5.4-codex",
      active: true,
      ttftMs: 420,
      tps: 111.2,
      inputTokens: 8_140_000,
      cachedInputTokens: 200_660_000,
      outputTokens: 2_400,
      totalTokens: 208_800_000,
      sessionTotalTokens: 208_800_000,
      cacheHitRate: 0.961,
      contextPercent: 21,
    });

    const activeDisplay = resolveComposerTelemetryDisplay(
      getSessionLiveTelemetry("thread-render"),
      null,
    );

    const enHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "en", translations: {} },
        createElement(ComposerLiveTelemetryStripView, {
          display: activeDisplay,
          onOpenUsage: () => undefined,
        }),
      ),
    );
    expect(enHtml).toContain('data-composer-live-telemetry="true"');
    expect(enHtml).toContain('data-telemetry-trigger="stats"');
    expect(enHtml).toContain('data-telemetry-trigger="tokens"');
    expect(enHtml).toContain('data-telemetry-trigger="context"');
    expect(enHtml).toContain("111.2 tok/s");
    expect(enHtml).toContain("208.8M tok");
    expect(enHtml).toContain("Cache hit 96.1%");
    expect(enHtml).toContain("Context 21%");
    expect(enHtml).toContain("motion-reduce:transition-none");

    const zhHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "zh", translations: {} },
        createElement(ComposerLiveTelemetryStripView, {
          display: activeDisplay,
          compact: true,
          openPopover: "tokens",
          onOpenUsage: () => undefined,
        }),
      ),
    );
    expect(zhHtml).toContain('data-telemetry-placement="inline"');
    expect(zhHtml).toContain('data-open-popover="tokens"');
    expect(zhHtml).toContain("111.2 tok/s");
    expect(zhHtml).toContain("208.8M tok");
    expect(zhHtml).toContain("缓存命中 96.1%");
    expect(zhHtml).toContain("上下文 21%");

    // Overflow (>100%) renders red overflow tone on ring and critical bar tone in Popover 3.
    const overflowDisplay = {
      ...activeDisplay,
      contextPercent: 112,
      contextTone: "overflow" as const,
      contextBarTone: "critical" as const,
    };
    const overflowContextHtml = renderToStaticMarkup(
      createElement(SessionContextWindowPopoverContent, {
        display: overflowDisplay,
        copy: getSessionTelemetryCopy("zh"),
      }),
    );
    expect(overflowContextHtml).toContain("112% 已用（剩余 0%）");
    expect(overflowContextHtml).toContain('data-context-bar-tone="critical"');
    expect(overflowContextHtml).toContain("bg-red-500");

    // External bridge helpers work cleanly.
    publishComposerContextWindow("thread-agy", {
      usedTokens: 42_000,
      maxTokens: 200_000,
      remainingTokens: 158_000,
      usedPercentage: 21,
      remainingPercentage: 79,
      lastUsedTokens: 42_000,
      compactsAutomatically: true,
      updatedAt: "2026-11-23T12:00:00.000Z",
    });
    const detail = deriveSessionTelemetryDetail({
      threadId: "thread-agy",
      serverProjection: null,
      activeContextWindow: null,
    });
    publishSessionTelemetryDetail("thread-agy", detail);
    expect(getSessionTelemetryDetail("thread-agy")?.threadId).toBe("thread-agy");
    clearSessionTelemetryDetails();
    expect(getSessionTelemetryDetail("thread-agy")).toBeNull();

    // Global today/month aggregation sums only current month buckets.
    const globalTotals = resolveGlobalTodayAndMonthTokens({
      mergedUsage: {
        totalTokens: 5_000_000,
        daily: [
          { day: "2026-10-31", costUsd: 1, totalTokens: 2_000_000, byProvider: new Map() },
          { day: "2026-11-05", costUsd: 1, totalTokens: 1_500_000, byProvider: new Map() },
          { day: "2026-11-23", costUsd: 1, totalTokens: 400_000, byProvider: new Map() },
        ],
      },
      todayDay: "2026-11-23",
    });
    expect(globalTotals.todayTokens).toBe(400_000);
    expect(globalTotals.monthTokens).toBe(1_900_000);

    // Projection derivation preserves zero fabrication when timestamps are absent.
    const noTimingTurn = makeProviderTurn({
      id: "turn-notime" as OrchestrationV2ProviderTurn["id"],
      startedAt: null,
      completedAt: null,
      turnTokenUsage: {
        usageScope: "main_agent",
        hasSubagents: false,
        usageStatus: "complete",
        inputTokens: 1_000,
        cachedInputTokens: 0,
        outputTokens: 120,
      },
    });
    const withoutTiming = deriveSessionTelemetryFromProjection({
      serverProjection: { providerTurns: [noTimingTurn], messages: [] },
      activeContextWindow: null,
    });
    expect(withoutTiming.latestTps).toBeNull();
    expect(withoutTiming.contextPercent).toBeNull();

    // Narrow-width wrap guard preserves zero-overlap thresholds across 420-1200px.
    expect(COMPOSER_INLINE_TELEMETRY_MIN_WIDTH_PX).toBe(700);
    expect(shouldWrapComposerTelemetryRow(420)).toBe(true);
    expect(shouldWrapComposerTelemetryRow(699)).toBe(true);
    expect(shouldWrapComposerTelemetryRow(700)).toBe(false);
    expect(shouldWrapComposerTelemetryRow(1200)).toBe(false);
  });
});
