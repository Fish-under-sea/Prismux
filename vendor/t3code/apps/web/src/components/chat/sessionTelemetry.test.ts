import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import type { OrchestrationV2ProviderTurn } from "@t3tools/contracts";
import { GTProvider, initializeGT } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { TooltipProvider } from "../ui/tooltip";
import {
  clearUsageCallLogs,
  getSessionLiveTelemetry,
  recordModelCallTelemetry,
  updateSessionLiveTelemetry,
} from "../usage/usageCallTelemetryStore";
import {
  ComposerLiveTelemetryStripView,
  formatCompactTelemetryTokens,
  resolveComposerTelemetryDisplay,
  resolveContextRingTone,
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

  it("renders below-composer live telemetry strip with TPS, tokens, cache hit, and 14x14 4-tier context ring", () => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });

    updateSessionLiveTelemetry("thread-render", {
      provider: "codex",
      model: "gpt-5.4-codex",
      active: true,
      ttftMs: 420,
      tps: 48.2,
      inputTokens: 2_200,
      cachedInputTokens: 7_800,
      outputTokens: 2_400,
      totalTokens: 12_400,
      sessionTotalTokens: 12_400,
      cacheHitRate: 0.78,
      contextPercent: 65,
    });

    const display = resolveComposerTelemetryDisplay(getSessionLiveTelemetry("thread-render"), null);
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
    expect(html).toContain("48.2 tok/s");
    expect(html).toContain('data-telemetry-tokens="true"');
    expect(html).toContain("12.4k tok");
    expect(html).toContain("Cache hit 78.0%");
    expect(html).toContain('data-telemetry-context="true"');
    expect(html).toContain('data-context-ring-tone="warning"');
    expect(html).toContain('width="14"');
    expect(html).toContain('height="14"');
    expect(html).toContain("motion-reduce:transition-none");
    expect(html).toContain("Context 65%");

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

    // Empty state omits unmeasured TPS/tokens and shows honest em-dash instead of fake 0%.
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
    expect(emptyHtml).toContain("Context —");
    expect(emptyHtml).not.toContain('data-telemetry-tps="true"');
    expect(emptyHtml).not.toContain('data-telemetry-tokens="true"');
  });
});
