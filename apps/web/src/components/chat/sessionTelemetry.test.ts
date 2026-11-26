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
  computeContextVialTicks,
  deletePublishedComposerContextWindow,
  formatCompactTelemetryTokens,
  formatContextBreakdownTokens,
  formatTelemetryPopoverTps,
  formatTelemetryStripTps,
  getPublishedComposerContextWindow,
  getPublishedComposerContextWindowCount,
  MAX_PUBLISHED_CONTEXT_WINDOWS,
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
  apportionTokensLargestRemainder,
  clearSessionTelemetryDetails,
  computeDonutSegments,
  deriveSessionContextBreakdown,
  deriveSessionTelemetryDetail,
  extractTurnUsageDetail,
  formatCompactPopoverTokens,
  formatIntegerTokens,
  getPublishedSessionDetailCount,
  getSessionTelemetryDetail,
  MAX_PUBLISHED_SESSION_DETAILS,
  mergeTimeIntervals,
  publishSessionTelemetryDetail,
  resolveGlobalTodayAndMonthTokens,
  retainSessionTelemetryDetailOwner,
  type SessionProjectionLike,
} from "./sessionTelemetry.logic";
import {
  deriveContextOccupancyPercent,
  deriveSessionTelemetryFromProjection,
  extractProviderTurnTokenCounts,
  resolveTelemetryCanonicalProvider,
} from "./useSessionCallTelemetry";

function makeProviderTurn(
  overrides: Partial<OrchestrationV2ProviderTurn>,
): OrchestrationV2ProviderTurn {
  return {
    id: "turn-1" as OrchestrationV2ProviderTurn["id"],
    status: "completed",
    startedAt: "2026-11-23T12:00:00.000Z" as unknown as OrchestrationV2ProviderTurn["startedAt"],
    completedAt:
      "2026-11-23T12:00:10.000Z" as unknown as OrchestrationV2ProviderTurn["completedAt"],
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

function makeSubagent(overrides: Partial<OrchestrationV2Subagent>): OrchestrationV2Subagent {
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

    // Popover 3 empty state (liquid vial + breakdown panel)
    const contextHtml = renderToStaticMarkup(
      createElement(SessionContextWindowPopoverContent, { display, copy: zhCopy }),
    );
    expect(contextHtml).toContain('aria-label="上下文窗口"');
    expect(contextHtml).toContain("上下文拆解");
    expect(contextHtml).toContain('data-context-vial="true"');
    expect(contextHtml).toContain("0 / —");
    expect(contextHtml).toContain("等待会话上下文数据…");
    expect(contextHtml).toContain("Gemini 4 Neon (XHigh)");
    expect(contextHtml).toContain("MODEL_PLACEHOLDER_M535");
    expect(contextHtml).not.toContain("当前会话采样了多个模型");
  });

  it("derives accurate single-model session stats, non-overlapping durations, reasoning split, and context bar", () => {
    const turn1 = makeProviderTurn({
      id: "turn-s1" as OrchestrationV2ProviderTurn["id"],
      model: "claude-sonnet-4-6",
      startedAt: "2026-11-23T12:00:00.000Z" as unknown as OrchestrationV2ProviderTurn["startedAt"],
      completedAt:
        "2026-11-23T12:00:20.000Z" as unknown as OrchestrationV2ProviderTurn["completedAt"],
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
        makeToolItem(
          "tool-1",
          "command_execution",
          "2026-11-23T12:00:05.000Z",
          "2026-11-23T12:00:11.000Z",
        ),
        makeToolItem(
          "tool-2",
          "file_change",
          "2026-11-23T12:00:08.000Z",
          "2026-11-23T12:00:13.000Z",
        ),
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
    expect(contextHtml).toContain("上下文拆解");
    expect(contextHtml).toContain("25.9%");
    expect(contextHtml).toContain("132.4k / 512.0k");
    expect(contextHtml).toContain("128k");
    expect(contextHtml).toContain("256k");
    expect(contextHtml).toContain("384k");
    expect(contextHtml).toContain("剩余空间");
    expect(contextHtml).toContain('data-context-bar-tone="normal"');
    expect(contextHtml).toContain('data-context-vial-tone="normal"');
    expect(contextHtml).toContain("Claude Sonnet 4.6");
    expect(contextHtml).toContain("claude-sonnet-4-6");
    expect(contextHtml).not.toContain("当前会话采样了多个模型");
  });

  it("aggregates multi-model distribution, Donut chart, subagent tokens, and multi-model notice accurately", () => {
    const turnNeon = makeProviderTurn({
      id: "turn-m1" as OrchestrationV2ProviderTurn["id"],
      model: "MODEL_PLACEHOLDER_M535",
      startedAt: "2026-11-23T10:00:00.000Z" as unknown as OrchestrationV2ProviderTurn["startedAt"],
      completedAt:
        "2026-11-23T10:00:10.000Z" as unknown as OrchestrationV2ProviderTurn["completedAt"],
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
      completedAt:
        "2026-11-23T10:05:05.000Z" as unknown as OrchestrationV2ProviderTurn["completedAt"],
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
    expect(resolveContextRingTone(49.9)).toBe("normal");
    expect(resolveContextRingTone(50)).toBe("warning");
    expect(resolveContextRingTone(62.1)).toBe("warning");
    expect(resolveContextRingTone(79.9)).toBe("warning");
    expect(resolveContextRingTone(80)).toBe("compact");
    expect(resolveContextRingTone(100)).toBe("compact");
    expect(resolveContextRingTone(100.1)).toBe("overflow");

    expect(resolveContextBarTone(null)).toBe("unknown");
    expect(resolveContextBarTone(26)).toBe("normal");
    expect(resolveContextBarTone(49.9)).toBe("normal");
    expect(resolveContextBarTone(50)).toBe("warning");
    expect(resolveContextBarTone(75)).toBe("warning");
    expect(resolveContextBarTone(80)).toBe("critical");
    expect(resolveContextBarTone(92)).toBe("critical");
    expect(resolveContextBarTone(112)).toBe("critical");

    expect(computeContextVialTicks(512_000).map((t) => t.label)).toEqual(["128k", "256k", "384k"]);
    expect(computeContextVialTicks(524_288).map((t) => t.label)).toEqual(["128k", "256k", "384k"]);
    expect(computeContextVialTicks(1_000_000).map((t) => t.label)).toEqual([
      "250k",
      "500k",
      "750k",
    ]);
    expect(computeContextVialTicks(200_000).map((t) => t.label)).toEqual(["50k", "100k", "150k"]);
    expect(computeContextVialTicks(null).map((t) => t.label)).toEqual(["25%", "50%", "75%"]);

    expect(formatContextBreakdownTokens(139)).toBe("139");
    expect(formatContextBreakdownTokens(3_750)).toBe("3.75k");
    expect(formatContextBreakdownTokens(318_100)).toBe("318.1k");
    expect(formatContextBreakdownTokens(512_000)).toBe("512.0k");
    expect(formatContextBreakdownTokens(1_000_000)).toBe("1.0M");

    expect(deriveContextOccupancyPercent({ usedTokens: 224_000, maxTokens: 200_000 })).toBeCloseTo(
      112,
      5,
    );

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

    // Overflow (>100%) renders red/rose overflow tone on ring and critical liquid vial in Popover 3.
    const overflowDisplay = {
      ...activeDisplay,
      contextPercent: 112,
      contextUsedTokens: 224_000,
      contextMaxTokens: 200_000,
      contextTone: "overflow" as const,
      contextBarTone: "critical" as const,
    };
    const overflowContextHtml = renderToStaticMarkup(
      createElement(SessionContextWindowPopoverContent, {
        display: overflowDisplay,
        copy: getSessionTelemetryCopy("zh"),
      }),
    );
    expect(overflowContextHtml).toContain("112.0%");
    expect(overflowContextHtml).toContain('data-context-bar-tone="critical"');
    expect(overflowContextHtml).toContain('data-context-vial-tone="critical"');
    expect(overflowContextHtml).toContain("text-rose-700");

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

  it("consumes authoritative DSH server ttftMs/decodeMs/modelDurationMs, formats tuple model names, and renders real cache hit & text/thinking split", () => {
    initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });
    const dshProviders: readonly ServerProvider[] = [
      {
        instanceId: "acpRegistry-dsh",
        driver: "acpRegistry",
        displayName: "DeepSeek Harness",
        enabled: true,
        models: [
          {
            slug: '["magpie","group/deepseek"]',
            name: "DeepSeek-V4.1-Flash",
            isCustom: false,
            capabilities: null,
          },
        ],
      } as unknown as ServerProvider,
    ];

    const dshTurn = makeProviderTurn({
      id: "turn-dsh-1" as OrchestrationV2ProviderTurn["id"],
      model: '["magpie","group/deepseek"]',
      startedAt: "2026-11-25T10:00:00.000Z" as unknown as OrchestrationV2ProviderTurn["startedAt"],
      completedAt:
        "2026-11-25T10:00:08.738Z" as unknown as OrchestrationV2ProviderTurn["completedAt"],
      turnTokenUsage: {
        usageScope: "main_agent",
        hasSubagents: false,
        usageStatus: "complete",
        inputTokens: 51_557,
        cachedInputTokens: 51_200,
        cacheCreationTokens: 0,
        outputTokens: 189,
        reasoningTokens: 82,
        ttftMs: 7_916,
        decodeMs: 822,
        modelDurationMs: 8_738,
        models: ['["magpie","group/deepseek"]'],
      },
    });

    const extracted = extractTurnUsageDetail(dshTurn);
    expect(extracted.ttftMs).toBe(7_916);
    expect(extracted.decodeMs).toBe(822);
    expect(extracted.modelDurationMs).toBe(8_738);
    expect(extracted.reportedModels).toEqual(["group/deepseek"]);

    // Noisy client WebSocket first-token arrival (8,470ms) MUST lose to authoritative server TTFT (7,916ms).
    const noisyTimings = new Map([
      [
        "turn-dsh-1",
        {
          turnStartedAt: Date.parse("2026-11-25T10:00:00.000Z"),
          firstTokenAt: Date.parse("2026-11-25T10:00:08.470Z"),
        },
      ],
    ]);

    const detail = deriveSessionTelemetryDetail({
      threadId: "thread-dsh",
      serverProjection: {
        runs: [makeRun("run-dsh-1", 1)],
        providerTurns: [dshTurn],
        turnItems: [],
        messages: [],
        subagents: [],
        nodes: [],
      },
      activeContextWindow: {
        usedTokens: 51_746,
        maxTokens: 128_000,
      } as ContextWindowSnapshot,
      providerStatuses: dshProviders,
      activeProvider: "dsh",
      activeModel: '["magpie","group/deepseek"]',
      turnTimingsById: noisyTimings,
    });

    const expectedTps = 189 / (822 / 1_000);
    expect(detail.avgTtftMs).toBe(7_916);
    expect(detail.modelCallDurationMs).toBe(8_738);
    expect(detail.avgTtftMs!).toBeLessThanOrEqual(detail.modelCallDurationMs!);
    expect(detail.sessionTps).toBeCloseTo(expectedTps, 4);
    expect(detail.latestRequestTps).toBeCloseTo(expectedTps, 4);
    expect(detail.textOutputTokens).toBe(107);
    expect(detail.reasoningOutputTokens).toBe(82);
    expect(detail.cacheHitRate).toBeCloseTo(51_200 / 51_557, 5);
    expect(detail.modelDistribution).toHaveLength(1);
    expect(detail.modelDistribution[0]!.displayName).toBe("DeepSeek-V4.1-Flash");
    expect(detail.latestSampledModelDisplayName).toBe("DeepSeek-V4.1-Flash");
    expect(detail.latestSampledModelId).toBe("group/deepseek");

    // `deriveSessionTelemetryFromProjection` also computes exact TPS from `decodeMs`.
    const projDerived = deriveSessionTelemetryFromProjection({
      serverProjection: { providerTurns: [dshTurn], messages: [] },
      activeContextWindow: null,
    });
    expect(projDerived.latestTps).toBeCloseTo(expectedTps, 4);
    expect(projDerived.latestCacheHitRate).toBeCloseTo(51_200 / 51_557, 5);

    const display = resolveComposerTelemetryDisplay(
      null,
      {
        usedTokens: 51_746,
        maxTokens: 128_000,
      } as ContextWindowSnapshot,
      {
        threadId: "thread-dsh",
        detail,
        providerStatuses: dshProviders,
        selectedProvider: "dsh",
        selectedModelId: '["magpie","group/deepseek"]',
      },
    );

    const zhCopy = getSessionTelemetryCopy("zh");
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
    expect(stripHtml).toContain(`${expectedTps.toFixed(1)} tok/s`);
    expect(stripHtml).toContain("缓存命中 99.3%");

    const statsHtml = renderToStaticMarkup(
      createElement(SessionStatsPopoverContent, { display, copy: zhCopy }),
    );
    expect(statsHtml).toContain("7.92 秒");
    expect(statsHtml).toContain(`${expectedTps.toFixed(1)} tok/s`);
    expect(statsHtml).toContain("107 / 82 tok");

    const tokensHtml = renderToStaticMarkup(
      createElement(SessionTokenUsagePopoverContent, {
        display,
        copy: zhCopy,
        onOpenUsage: () => undefined,
      }),
    );
    expect(tokensHtml).toContain("99.3%");
    expect(tokensHtml).toContain("DeepSeek-V4.1-Flash");
    expect(tokensHtml).not.toContain('["magpie"');
  });

  it("extracts live tokenUsage cacheCreationTokens/timings, clamps ttftMs <= durationMs, and normalizes DSH canonical provider", () => {
    const liveOnlyTurn = makeProviderTurn({
      id: "turn-live-cache" as OrchestrationV2ProviderTurn["id"],
      startedAt: "2026-11-25T10:00:00.000Z" as unknown as OrchestrationV2ProviderTurn["startedAt"],
      completedAt:
        "2026-11-25T10:00:08.430Z" as unknown as OrchestrationV2ProviderTurn["completedAt"],
      turnTokenUsage: undefined,
      tokenUsage: {
        usedTokens: 10_200,
        inputTokens: 10_000,
        cachedInputTokens: 7_000,
        cacheCreationTokens: 1_500,
        outputTokens: 200,
        reasoningOutputTokens: 50,
        ttftMs: 8_470,
        decodeMs: 500,
        durationMs: 8_430,
        updatedAt: "2026-11-25T10:00:08.430Z",
      },
    });

    const extracted = extractTurnUsageDetail(liveOnlyTurn);
    expect(extracted.uncachedInputTokens).toBe(1_500);
    expect(extracted.cachedInputTokens).toBe(7_000);
    expect(extracted.cacheCreationTokens).toBe(1_500);
    expect(extracted.outputTokens).toBe(200);
    expect(extracted.reasoningTokens).toBe(50);
    // Clamped to durationMs (8430), never 8470 > 8430!
    expect(extracted.ttftMs).toBe(8_430);
    expect(extracted.decodeMs).toBe(500);
    expect(extracted.modelDurationMs).toBe(8_430);

    const liveCounts = extractProviderTurnTokenCounts(liveOnlyTurn);
    expect(liveCounts.uncachedInputTokens).toBe(1_500);
    expect(liveCounts.cacheCreationTokens).toBe(1_500);

    // Client-observed TTFT (8470ms) exceeding wall duration (8430ms) MUST clamp to 8430ms.
    const clampedDetail = deriveSessionTelemetryDetail({
      threadId: "thread-clamp",
      serverProjection: {
        runs: [makeRun("run-c1", 1)],
        providerTurns: [
          makeProviderTurn({
            id: "turn-clamp" as OrchestrationV2ProviderTurn["id"],
            startedAt:
              "2026-11-25T10:00:00.000Z" as unknown as OrchestrationV2ProviderTurn["startedAt"],
            completedAt:
              "2026-11-25T10:00:08.430Z" as unknown as OrchestrationV2ProviderTurn["completedAt"],
            turnTokenUsage: {
              usageScope: "main_agent",
              hasSubagents: false,
              usageStatus: "complete",
              inputTokens: 1_000,
              outputTokens: 100,
            },
          }),
        ],
        turnItems: [],
        messages: [],
        subagents: [],
        nodes: [],
      },
      activeContextWindow: null,
      turnTimingsById: new Map([
        [
          "turn-clamp",
          {
            turnStartedAt: Date.parse("2026-11-25T10:00:00.000Z"),
            firstTokenAt: Date.parse("2026-11-25T10:00:08.470Z"),
          },
        ],
      ]),
    });
    expect(clampedDetail.modelCallDurationMs).toBe(8_430);
    expect(clampedDetail.avgTtftMs).toBe(8_430);

    // Canonical provider normalization maps DSH `acpRegistry` instances to `"dsh"`.
    const dshStatuses: readonly ServerProvider[] = [
      {
        instanceId: "acpRegistry-deepseek-harness",
        driver: "acpRegistry",
        displayName: "DeepSeek Harness",
        enabled: true,
        models: [
          {
            slug: '["magpie","group/deepseek"]',
            name: "DeepSeek-V4.1-Flash",
            isCustom: false,
            capabilities: null,
          },
        ],
      } as unknown as ServerProvider,
    ];
    expect(
      resolveTelemetryCanonicalProvider({
        provider: "acpRegistry",
        providerInstanceId: "acpRegistry-deepseek-harness",
        providerStatuses: dshStatuses,
      }),
    ).toBe("dsh");
    expect(
      resolveTelemetryCanonicalProvider({
        provider: "acpRegistry",
        providerStatuses: dshStatuses,
        model: '["magpie","group/deepseek"]',
      }),
    ).toBe("dsh");
    expect(
      resolveTelemetryCanonicalProvider({
        provider: "acpRegistry",
        providerInstanceId: "acpRegistry-goose",
        providerStatuses: [
          {
            instanceId: "acpRegistry-goose",
            driver: "acpRegistry",
            displayName: "Goose",
            enabled: true,
            models: [],
          } as unknown as ServerProvider,
        ],
      }),
    ).toBe("acpRegistry");
    expect(
      resolveTelemetryCanonicalProvider({
        provider: "claudeAgent",
      }),
    ).toBe("claude");
  });

  it("honestly decomposes context breakdown for fine-grained provider categories, active post-compaction transcripts, and minimal totals without purple bg or fabricated numbers", () => {
    initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });
    const zhCopy = getSessionTelemetryCopy("zh");

    // 1. Provider-reported fine-grained categories preserve exact usedTokens sum via largest-remainder rounding.
    const providerBreakdown = deriveSessionContextBreakdown({
      activeContextWindow: {
        usedTokens: 318_100,
        maxTokens: 512_000,
      } as ContextWindowSnapshot,
      compactionCountOverride: 2,
      providerCategories: [
        { key: "system-prompt", label: "System Prompt", tokens: 3_750 },
        { key: "mcp", label: "Mcp Tools", tokens: 139 },
        { key: "subagents", label: "Subagents", tokens: 2_830 },
        { key: "skills", label: "Skills", tokens: 3_010 },
        { key: "plugins", label: "Plugins", tokens: 1_600 },
        { key: "rules", label: "Rules", tokens: 9_170 },
        { key: "tools", label: "Tools", tokens: 10_400 },
        { key: "messages", label: "Chat Messages", tokens: 287_201 },
      ],
    });
    expect(providerBreakdown.source).toBe("provider-categories");
    expect(providerBreakdown.compactionCount).toBe(2);
    const activeProviderSum = providerBreakdown.categories
      .filter((c) => c.group !== "free")
      .reduce((acc, c) => acc + c.tokens, 0);
    expect(activeProviderSum).toBe(318_100);
    const freeRow = providerBreakdown.categories.find((c) => c.key === "free");
    expect(freeRow?.tokens).toBe(193_900);
    expect(freeRow?.percent).toBeCloseTo(37.9, 1);

    // 2. Real transcript decomposition counts only post-compaction items + real compaction count.
    const transcriptBreakdown = deriveSessionContextBreakdown({
      serverProjection: {
        runs: [makeRun("run-1", 1), makeRun("run-2", 2)],
        providerTurns: [],
        turnItems: [
          {
            id: "old-msg",
            runId: "run-1",
            type: "user_message",
            messageId: "m-old",
            text: "This pre-compaction message was discarded after compaction.",
            attachments: [],
          } as unknown as OrchestrationV2TurnItem,
          {
            id: "compact-1",
            runId: "run-1",
            type: "compaction",
            status: "completed",
            driver: "claudeAgent",
            summary: "Compacted session summary covering auth fixes.",
            beforeTokenCount: 280_000,
            afterTokenCount: 40_000,
          } as unknown as OrchestrationV2TurnItem,
          {
            id: "cmd-1",
            runId: "run-2",
            type: "command_execution",
            status: "completed",
            input: "pnpm test",
            output: "All 56 unit tests passed in 1.2s.".repeat(30),
          } as unknown as OrchestrationV2TurnItem,
          {
            id: "reason-1",
            runId: "run-2",
            type: "reasoning",
            text: "Checking edge cases in token apportionment.".repeat(20),
          } as unknown as OrchestrationV2TurnItem,
          {
            id: "msg-2",
            runId: "run-2",
            type: "assistant_message",
            messageId: "m-2",
            text: "已完成上下文拆解模块和内存泄漏修复。".repeat(25),
          } as unknown as OrchestrationV2TurnItem,
        ],
        messages: [],
        subagents: [],
        nodes: [],
      },
      activeContextWindow: {
        usedTokens: 64_000,
        maxTokens: 200_000,
      } as ContextWindowSnapshot,
    });
    expect(transcriptBreakdown.source).toBe("transcript-estimate");
    expect(transcriptBreakdown.compactionCount).toBe(1);
    const activeTranscriptSum = transcriptBreakdown.categories
      .filter((c) => c.group !== "free")
      .reduce((acc, c) => acc + c.tokens, 0);
    expect(activeTranscriptSum).toBe(64_000);
    expect(transcriptBreakdown.categories.some((c) => c.key === "system")).toBe(true);
    expect(transcriptBreakdown.categories.some((c) => c.key === "tools")).toBe(true);
    expect(transcriptBreakdown.categories.some((c) => c.key === "reasoning")).toBe(true);
    expect(transcriptBreakdown.categories.some((c) => c.key === "messages")).toBe(true);
    expect(transcriptBreakdown.categories.some((c) => c.key === "free")).toBe(true);
    // MUST NEVER fabricate unreported fine-grained categories like MCP or Skills!
    expect(transcriptBreakdown.categories.some((c) => c.key === "mcp")).toBe(false);
    expect(transcriptBreakdown.categories.some((c) => c.key === "skills")).toBe(false);
    expect(
      transcriptBreakdown.summary.systemTokens +
        transcriptBreakdown.summary.conversationTokens +
        transcriptBreakdown.summary.toolTokens,
    ).toBe(64_000);

    // 3. Bare total-only fallback honestly renders only "已用上下文" + "剩余空间".
    const bareBreakdown = deriveSessionContextBreakdown({
      activeContextWindow: {
        usedTokens: 44_100,
        maxTokens: 1_000_000,
      } as ContextWindowSnapshot,
    });
    expect(bareBreakdown.source).toBe("total-only");
    expect(bareBreakdown.categories.map((c) => c.key)).toEqual(["used", "free"]);

    // 4. Largest-remainder apportionment invariant
    const apportioned = apportionTokensLargestRemainder([1, 1, 1], 100);
    expect(apportioned.reduce((a, b) => a + b, 0)).toBe(100);

    // 5. Render popover at 62.1% warning state and assert ZERO purple plugin background!
    const warningDisplay = resolveComposerTelemetryDisplay(
      null,
      { usedTokens: 318_100, maxTokens: 512_000 } as ContextWindowSnapshot,
      {
        threadId: "thread-vial-warn",
        detail: {
          ...deriveSessionTelemetryDetail({
            threadId: "thread-vial-warn",
            serverProjection: null,
            activeContextWindow: {
              usedTokens: 318_100,
              maxTokens: 512_000,
            } as ContextWindowSnapshot,
            contextBreakdownCategories: [
              { key: "system-prompt", label: "System Prompt", tokens: 3_750 },
              { key: "tools", label: "Tools", tokens: 10_400 },
              { key: "messages", label: "Chat Messages", tokens: 303_950 },
            ],
          }),
          compactionCount: 2,
          contextBreakdown: providerBreakdown,
        },
        selectedModelId: "MODEL_PLACEHOLDER_M535",
        providerStatuses: TEST_PROVIDERS,
      },
    );
    const vialHtml = renderToStaticMarkup(
      createElement(SessionContextWindowPopoverContent, { display: warningDisplay, copy: zhCopy }),
    );
    expect(vialHtml).toContain("62.1%");
    expect(vialHtml).toContain("318.1k / 512.0k");
    expect(vialHtml).toContain("已压缩 2 次");
    expect(vialHtml).toContain("128k");
    expect(vialHtml).toContain("256k");
    expect(vialHtml).toContain("384k");
    expect(vialHtml).toContain("系统提示");
    expect(vialHtml).toContain("剩余空间");
    expect(vialHtml).toContain('data-context-vial-tone="warning"');
    expect(vialHtml).not.toContain("#1a1625");
    expect(vialHtml).not.toContain("#261e3e");
    expect(vialHtml).not.toContain("196, 172, 255");

    // 6. Color-coded inline status pill (Fig 5): BOTH ring stroke & text shift color by occupancy tier!
    const renderPill = (pct: number | null) =>
      renderToStaticMarkup(
        createElement(
          GTProvider,
          { locale: "zh", translations: {} },
          createElement(ComposerLiveTelemetryStripView, {
            display: {
              ...warningDisplay,
              contextPercent: pct,
              contextTone: resolveContextRingTone(pct),
              contextBarTone: resolveContextBarTone(pct),
            },
            onOpenUsage: () => undefined,
          }),
        ),
      );

    const normalPill = renderPill(24);
    expect(normalPill).toContain('data-context-pill-tone="normal"');
    expect(normalPill).toContain("text-emerald-700");
    expect(normalPill).toContain("stroke-emerald-600");

    const warnPill = renderPill(62.1);
    expect(warnPill).toContain('data-context-pill-tone="warning"');
    expect(warnPill).toContain("text-amber-700");
    expect(warnPill).toContain("stroke-amber-500");

    const criticalPill = renderPill(86);
    expect(criticalPill).toContain('data-context-pill-tone="compact"');
    expect(criticalPill).toContain("text-rose-700");
    expect(criticalPill).toContain("stroke-rose-600");
  });

  it("enforces 50-entry LRU caps and owner/unmount cleanup on publishedSessionDetails (L10) and publishedContextWindows (L11)", () => {
    // L10: publishedSessionDetails LRU cap = 50
    for (let i = 0; i < MAX_PUBLISHED_SESSION_DETAILS + 15; i += 1) {
      const id = `lru-detail-${i}`;
      publishSessionTelemetryDetail(
        id,
        deriveSessionTelemetryDetail({
          threadId: id,
          serverProjection: null,
          activeContextWindow: null,
        }),
      );
    }
    expect(getPublishedSessionDetailCount()).toBe(MAX_PUBLISHED_SESSION_DETAILS);
    expect(getSessionTelemetryDetail("lru-detail-0")).toBeNull();
    expect(getSessionTelemetryDetail("lru-detail-14")).toBeNull();
    expect(getSessionTelemetryDetail("lru-detail-15")).not.toBeNull();
    expect(
      getSessionTelemetryDetail(`lru-detail-${MAX_PUBLISHED_SESSION_DETAILS + 14}`),
    ).not.toBeNull();

    // Owner ref-count keeps detail alive until final owner releases
    const releaseA = retainSessionTelemetryDetailOwner("lru-detail-64");
    const releaseB = retainSessionTelemetryDetailOwner("lru-detail-64");
    releaseA();
    expect(getSessionTelemetryDetail("lru-detail-64")).not.toBeNull();
    releaseB();
    expect(getSessionTelemetryDetail("lru-detail-64")).toBeNull();

    // L11: publishedContextWindows LRU cap = 50 + delete on null/helper
    for (let i = 0; i < MAX_PUBLISHED_CONTEXT_WINDOWS + 12; i += 1) {
      publishComposerContextWindow(`lru-ctx-${i}`, {
        usedTokens: 1000 + i,
        maxTokens: 100_000,
        remainingTokens: 99_000 - i,
        usedPercentage: 1,
        remainingPercentage: 99,
        updatedAt: "2026-11-26T00:00:00.000Z",
      } as ContextWindowSnapshot);
    }
    expect(getPublishedComposerContextWindowCount()).toBe(MAX_PUBLISHED_CONTEXT_WINDOWS);
    expect(getPublishedComposerContextWindow("lru-ctx-0")).toBeNull();
    expect(getPublishedComposerContextWindow("lru-ctx-11")).toBeNull();
    expect(getPublishedComposerContextWindow("lru-ctx-12")?.usedTokens).toBe(1012);

    // Passing null or delete helper deletes the entry immediately
    deletePublishedComposerContextWindow("lru-ctx-12");
    expect(getPublishedComposerContextWindow("lru-ctx-12")).toBeNull();
    expect(getPublishedComposerContextWindowCount()).toBe(MAX_PUBLISHED_CONTEXT_WINDOWS - 1);
  });
});
