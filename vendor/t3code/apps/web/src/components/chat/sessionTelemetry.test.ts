import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import type { OrchestrationV2ProviderTurn } from "@t3tools/contracts";
import { GTProvider, initializeGT } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vite-plus/test";

import zhCatalog from "../../i18n/translations/zh.json";
import { TooltipProvider } from "../ui/tooltip";
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
  formatTelemetryStripTps,
  publishComposerContextWindow,
  resolveComposerTelemetryDisplay,
  resolveContextRingTone,
  shouldWrapComposerTelemetryRow,
} from "./ComposerLiveTelemetryStrip";
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

describe("Spec 3 real-time session telemetry collector & below-composer strip", () => {
  afterEach(() => {
    clearUsageCallLogs();
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

  it("derives cumulative tokens, real cache hit rate, real TPS, and context occupancy with zero fabrication", () => {
    const turn1 = makeProviderTurn({
      id: "turn-a" as OrchestrationV2ProviderTurn["id"],
      startedAt: "2026-11-23T12:00:00.000Z" as unknown as OrchestrationV2ProviderTurn["startedAt"],
      completedAt: "2026-11-23T12:00:05.000Z" as unknown as OrchestrationV2ProviderTurn["completedAt"],
      turnTokenUsage: {
        usageScope: "main_agent",
        hasSubagents: false,
        usageStatus: "complete",
        inputTokens: 2_000,
        cachedInputTokens: 1_000,
        cacheCreationTokens: 0,
        outputTokens: 250,
      },
    });
    const turn2 = makeProviderTurn({
      id: "turn-b" as OrchestrationV2ProviderTurn["id"],
      startedAt: "2026-11-23T12:01:00.000Z" as unknown as OrchestrationV2ProviderTurn["startedAt"],
      completedAt: "2026-11-23T12:01:10.000Z" as unknown as OrchestrationV2ProviderTurn["completedAt"],
      turnTokenUsage: {
        usageScope: "main_agent",
        hasSubagents: false,
        usageStatus: "complete",
        inputTokens: 10_000,
        cachedInputTokens: 7_800,
        cacheCreationTokens: 0,
        outputTokens: 482,
      },
    });

    const contextWindow = {
      usedTokens: 130_000,
      maxTokens: 200_000,
    } as ContextWindowSnapshot;

    const derived = deriveSessionTelemetryFromProjection({
      serverProjection: {
        providerTurns: [turn1, turn2],
        messages: [],
      },
      activeContextWindow: contextWindow,
    });

    expect(derived.sessionTotalTokens).toBe(2_250 + 10_482);
    expect(derived.latestCacheHitRate).toBeCloseTo(0.78, 5);
    expect(derived.latestTps).toBeCloseTo(48.2, 5);
    expect(derived.contextPercent).toBeCloseTo(65, 5);

    // When timestamps or output tokens are absent, latestTps stays strictly null (never fabricated).
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
      serverProjection: {
        providerTurns: [noTimingTurn],
        messages: [],
      },
      activeContextWindow: null,
    });
    expect(withoutTiming.latestTps).toBeNull();
    expect(withoutTiming.contextPercent).toBeNull();
  });

  it("classifies Spec 3 context ring tones across all 4 color tiers plus unknown & overflow", () => {
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
    expect(resolveContextRingTone(125)).toBe("overflow");

    expect(
      deriveContextOccupancyPercent({
        usedTokens: 224_000,
        maxTokens: 200_000,
      }),
    ).toBeCloseTo(112, 5);
  });

  it("formats compact token counts and resolves live store telemetry with contextWindow fallback", () => {
    expect(formatCompactTelemetryTokens(0)).toBe("0");
    expect(formatCompactTelemetryTokens(842)).toBe("842");
    expect(formatCompactTelemetryTokens(12_400)).toBe("12.4k");
    expect(formatCompactTelemetryTokens(128_000)).toBe("128k");
    expect(formatCompactTelemetryTokens(1_450_000)).toBe("1.45M");
    expect(formatCompactTelemetryTokens(12_300_000)).toBe("12.3M");

    recordModelCallTelemetry({
      id: "turn:t-100",
      turnId: "t-100",
      threadId: "thread-spec3",
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      turnStartedAt: 1_000,
      firstTokenAt: 1_500,
      completedAt: 11_500,
      inputTokens: 2_200,
      cachedInputTokens: 7_800,
      outputTokens: 482,
      contextPercent: 65,
      status: "completed",
    });

    const live = getSessionLiveTelemetry("thread-spec3");
    const display = resolveComposerTelemetryDisplay(live, null);
    expect(display.ttftMs).toBe(500);
    expect(display.tps).toBeCloseTo(48.2, 5);
    expect(display.totalTokens).toBe(10_482);
    expect(display.cacheHitRate).toBeCloseTo(0.78, 5);
    expect(display.contextPercent).toBe(65);
    expect(display.contextTone).toBe("warning");

    // Fallback to activeContextWindow when live snapshot has not been populated yet.
    const fallbackDisplay = resolveComposerTelemetryDisplay(null, {
      usedTokens: 40_000,
      maxTokens: 200_000,
      totalProcessedTokens: 52_000,
      lastInputTokens: 10_000,
      lastCachedInputTokens: 6_000,
    } as ContextWindowSnapshot);
    expect(fallbackDisplay.totalTokens).toBe(52_000);
    expect(fallbackDisplay.cacheHitRate).toBeCloseTo(0.6, 5);
    expect(fallbackDisplay.contextPercent).toBeCloseTo(20, 5);
    expect(fallbackDisplay.contextTone).toBe("normal");
    expect(fallbackDisplay.tps).toBeNull();
  });

  it("renders all 3 telemetry segments cleanly with data, fallback usage, overflow, and empty state", () => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });

    expect(formatTelemetryStripTps(null)).toBe("— tok/s");
    expect(formatTelemetryStripTps(0)).toBe("— tok/s");
    expect(formatTelemetryStripTps(111.24)).toBe("111.2 tok/s");
    expect(formatCompactTelemetryTokens(208_800_000)).toBe("208.8M");

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

    const display = resolveComposerTelemetryDisplay(getSessionLiveTelemetry("thread-render"), null);
    expect(display.tokensScope).toBe("session");
    expect(display.tpsScope).toBe("session");
    const html = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "en", translations: {} },
        createElement(
          TooltipProvider,
          null,
          createElement(ComposerLiveTelemetryStripView, {
            display,
            onOpenUsage: () => undefined,
          }),
        ),
      ),
    );

    expect(html).toContain('data-composer-live-telemetry="true"');
    expect(html).toContain('data-telemetry-tps="true"');
    expect(html).toContain('data-telemetry-measured="true"');
    expect(html).toContain("111.2 tok/s");
    expect(html).toContain('data-telemetry-tokens="true"');
    expect(html).toContain("208.8M tok");
    expect(html).toContain("Cache hit 96.1%");
    expect(html).toContain('data-telemetry-context="true"');
    expect(html).toContain('data-context-ring-tone="normal"');
    expect(html).toContain('width="14"');
    expect(html).toContain('height="14"');
    expect(html).toContain("motion-reduce:transition-none");
    expect(html).toContain("Context 21%");
    // Must not hide TPS or tokens behind container-query breakpoints.
    expect(html).not.toContain("@md/composer-surface");
    expect(html).not.toContain("@lg/composer-surface");

    // Overflow (>100%) renders red overflow tone with exact percentage.
    const overflowHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "en", translations: {} },
        createElement(
          TooltipProvider,
          null,
          createElement(ComposerLiveTelemetryStripView, {
            display: {
              ...display,
              contextPercent: 112,
              contextTone: "overflow",
            },
            onOpenUsage: () => undefined,
          }),
        ),
      ),
    );
    expect(overflowHtml).toContain('data-context-ring-tone="overflow"');
    expect(overflowHtml).toContain("Context 112%");

    // Empty state ALWAYS keeps all 3 segments visible with honest placeholders (never collapses to Context only).
    const emptyHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "en", translations: {} },
        createElement(
          TooltipProvider,
          null,
          createElement(ComposerLiveTelemetryStripView, {
            display: resolveComposerTelemetryDisplay(null, null),
            onOpenUsage: () => undefined,
          }),
        ),
      ),
    );
    expect(emptyHtml).toContain('data-context-ring-tone="unknown"');
    expect(emptyHtml).toContain('data-telemetry-tps="true"');
    expect(emptyHtml).toContain("— tok/s");
    expect(emptyHtml).toContain('data-telemetry-tokens="true"');
    expect(emptyHtml).toContain("0 tok");
    expect(emptyHtml).toContain("Cache hit —");
    expect(emptyHtml).toContain("Context —");
    expect(emptyHtml).toContain('data-telemetry-measured="false"');

    // Fresh thread falls back to real recent/global usage summary + recent call log TPS without faking context %.
    const recentFallback = resolveComposerTelemetryDisplay(null, null, {
      threadId: "brand-new-draft",
      callLogs: [
        {
          id: "call-1",
          timestamp: 100_000,
          provider: "codex",
          model: "gpt-5.4-codex",
          threadId: "older-thread",
          ttftMs: 320,
          durationMs: 2_320,
          tps: 94.6,
          inputTokens: 500,
          cachedInputTokens: 4_500,
          cacheCreationTokens: 0,
          outputTokens: 189,
          totalTokens: 5_189,
          cacheHitRate: 0.9,
          status: "completed",
          source: "live",
        },
      ],
      mergedUsage: {
        totalTokens: 208_800_000,
        uncachedInputTokens: 8_143_200,
        cachedInputTokens: 200_656_800,
        cacheCreationTokens: 0,
      },
    });
    expect(recentFallback.tps).toBeCloseTo(94.6, 5);
    expect(recentFallback.tpsScope).toBe("recent");
    expect(recentFallback.totalTokens).toBe(208_800_000);
    expect(recentFallback.tokensScope).toBe("recent");
    expect(recentFallback.cacheHitRate).toBeCloseTo(0.961, 3);
    expect(recentFallback.contextPercent).toBeNull();

    // Chinese locale renders Figure 2 format ("111.2 tok/s · 208.8M tok · 缓存命中 96.1% · 上下文 21%")
    // and never drops TPS or tokens when unmeasured.
    const zhTranslations = { zh: zhCatalog } as unknown as NonNullable<
      Parameters<typeof GTProvider>[0]["translations"]
    >;
    const zhHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "zh", translations: zhTranslations },
        createElement(
          TooltipProvider,
          null,
          createElement(ComposerLiveTelemetryStripView, {
            display,
            onOpenUsage: () => undefined,
          }),
        ),
      ),
    );
    expect(zhHtml).toContain("111.2 tok/s");
    expect(zhHtml).toContain("208.8M tok");
    expect(zhHtml).toContain("缓存命中 96.1%");
    expect(zhHtml).toContain("上下文 21%");

    const zhEmptyHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "zh", translations: zhTranslations },
        createElement(
          TooltipProvider,
          null,
          createElement(ComposerLiveTelemetryStripView, {
            display: resolveComposerTelemetryDisplay(null, null),
            onOpenUsage: () => undefined,
          }),
        ),
      ),
    );
    expect(zhEmptyHtml).toContain("— tok/s");
    expect(zhEmptyHtml).toContain("0 tok");
    expect(zhEmptyHtml).toContain("缓存命中 —");
    expect(zhEmptyHtml).toContain("上下文 —");

    // AGY 2.0 inline inner-footer mode renders compact 3-segment telemetry without ms-auto push.
    const zhCompactHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "zh", translations: zhTranslations },
        createElement(
          TooltipProvider,
          null,
          createElement(ComposerLiveTelemetryStripView, {
            display,
            compact: true,
            onOpenUsage: () => undefined,
          }),
        ),
      ),
    );
    expect(zhCompactHtml).toContain('data-telemetry-placement="inline"');
    expect(zhCompactHtml).toContain("111.2 tok/s");
    expect(zhCompactHtml).toContain("208.8M tok");
    expect(zhCompactHtml).toContain("缓存命中 96.1%");
    expect(zhCompactHtml).toContain("上下文 21%");

    // External context-window bridge safely publishes & clears without errors.
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
    clearPublishedComposerContextWindows();

    // Billion-scale cumulative token totals compact cleanly (e.g. 3.09B) & narrow wrap guard works across 420-1200px.
    expect(formatCompactTelemetryTokens(3_088_000_000)).toBe("3.09B");
    expect(formatCompactTelemetryTokens(12_400_000_000)).toBe("12.4B");
    expect(COMPOSER_INLINE_TELEMETRY_MIN_WIDTH_PX).toBe(700);
    expect(shouldWrapComposerTelemetryRow(420)).toBe(true);
    expect(shouldWrapComposerTelemetryRow(550)).toBe(true);
    expect(shouldWrapComposerTelemetryRow(699)).toBe(true);
    expect(shouldWrapComposerTelemetryRow(700)).toBe(false);
    expect(shouldWrapComposerTelemetryRow(960)).toBe(false);
    expect(shouldWrapComposerTelemetryRow(1200)).toBe(false);
    expect(shouldWrapComposerTelemetryRow(0)).toBe(false);
  });
});
