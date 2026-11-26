import type { ContextWindowSnapshot } from "@prismux/client-runtime/state/context-window";
import type { ThreadStructure } from "@prismux/client-runtime/state/models";
import type { OrchestrationV2ProviderTurn, ServerProvider } from "@prismux/core-contracts";
import type { MergedUsage } from "@prismux/core-shared/usageMerge";
import * as DateTime from "effect/DateTime";
import { useSyncExternalStore } from "react";

import {
  clampTtftToDuration,
  computeCacheHitRate,
  computeOutputTps,
  formatUsageModelDisplayName,
  resolveEffectiveDecodeDurationMs,
  unwrapUsageModelSlug,
  type SessionLiveTelemetrySnapshot,
  type UsageCallLogRecord,
} from "../usage/usageCallTelemetryStore";

export type TelemetryPopoverId = "stats" | "tokens" | "context";
export type ContextRingTone = "unknown" | "normal" | "warning" | "compact" | "overflow";
export type ContextBarTone = "unknown" | "normal" | "warning" | "critical";
export type TelemetryMetricScope = "session" | "none";
export type ContextBreakdownGroup = "system" | "conversation" | "tools" | "free";
export type ContextBreakdownSource =
  | "provider-categories"
  | "transcript-estimate"
  | "usage-split"
  | "total-only"
  | "empty";

export interface ContextBreakdownCategoryInput {
  readonly key?: string | undefined;
  readonly label: string;
  readonly tokens: number;
  readonly group?: ContextBreakdownGroup | undefined;
  readonly color?: string | undefined;
  readonly estimated?: boolean | undefined;
}

export interface ContextBreakdownCategory {
  readonly key: string;
  readonly label: string;
  readonly tokens: number;
  /** Percentage of `contextMaxTokens` (0..100), or null when limit is unknown. */
  readonly percent: number | null;
  readonly group: ContextBreakdownGroup;
  readonly color: string;
  readonly estimated: boolean;
}

export interface ContextBreakdownSummary {
  readonly systemTokens: number;
  readonly conversationTokens: number;
  readonly toolTokens: number;
}

export interface ContextVialTick {
  readonly fraction: number;
  readonly label: string;
}

export interface SessionContextBreakdown {
  readonly usedTokens: number | null;
  readonly maxTokens: number | null;
  readonly remainingTokens: number | null;
  readonly usedPercent: number | null;
  readonly remainingPercent: number | null;
  readonly compactionCount: number;
  readonly source: ContextBreakdownSource;
  readonly summary: ContextBreakdownSummary;
  readonly categories: readonly ContextBreakdownCategory[];
}

export const CONTEXT_BREAKDOWN_COLORS: Readonly<Record<string, string>> = {
  system: "#a855f7",
  "system-prompt": "#a855f7",
  mcp: "#8b5cf6",
  subagents: "#38bdf8",
  skills: "#06b6d4",
  plugins: "#10b981",
  rules: "#ec4899",
  tools: "#f59e0b",
  reasoning: "#38bdf8",
  messages: "#f97316",
  cached_context: "#6366f1",
  uncached_input: "#f97316",
  output: "#10b981",
  memory: "#2dd4bf",
  used: "#f59e0b",
};

const CONTEXT_BREAKDOWN_FALLBACK_PALETTE = [
  "#a855f7",
  "#8b5cf6",
  "#38bdf8",
  "#06b6d4",
  "#10b981",
  "#ec4899",
  "#f59e0b",
  "#f97316",
  "#6366f1",
] as const;

export const MAX_PUBLISHED_SESSION_DETAILS = 50;

export const MODEL_DISTRIBUTION_COLORS = [
  "#7ea18a",
  "#22c55e",
  "#38bdf8",
  "#a78bfa",
  "#f59e0b",
  "#fb7185",
  "#2dd4bf",
  "#f97316",
] as const;

const INTEGER_FORMATTER = new Intl.NumberFormat("en-US");

const TOOL_TURN_ITEM_TYPES = new Set<string>([
  "command_execution",
  "file_change",
  "file_search",
  "web_search",
  "dynamic_tool",
  "subagent",
]);

const NON_STEP_TURN_ITEM_TYPES = new Set<string>([
  "user_message",
  "notification",
  "system_notice",
  "checkpoint",
  "run_interrupt_request",
  "run_interrupt_result",
  "error",
]);

export interface TurnObservedTiming {
  readonly turnStartedAt: number;
  readonly firstTokenAt: number | null;
}

export interface SessionModelDistributionEntry {
  readonly modelId: string;
  readonly displayName: string;
  readonly totalTokens: number;
  readonly share: number;
  readonly percent: number;
  readonly compactTokens: string;
  readonly color: string;
}

export interface DonutSegmentGeometry {
  readonly modelId: string;
  readonly color: string;
  readonly dashArray: string;
  readonly dashOffset: number;
  readonly share: number;
}

export interface SessionTelemetryDetailSnapshot {
  readonly threadId: string;
  readonly rounds: number;
  readonly steps: number;
  readonly samples: number;
  readonly modelCallDurationMs: number | null;
  readonly toolCallDurationMs: number | null;
  readonly avgTtftMs: number | null;
  readonly ttftSampleCount: number;
  readonly sessionTps: number | null;
  readonly latestRequestTps: number | null;
  readonly textOutputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly sessionTotalTokens: number;
  readonly cacheHitRate: number | null;
  readonly subagentCount: number;
  readonly subagentTotalTokens: number;
  readonly subagentChildThreadIds: readonly string[];
  readonly aggregatedTaskTotalTokens: number;
  readonly modelDistribution: readonly SessionModelDistributionEntry[];
  readonly distinctSampledModels: readonly string[];
  readonly latestSampledModelId: string | null;
  readonly latestSampledModelDisplayName: string | null;
  readonly compactionCount: number;
  readonly contextBreakdown: SessionContextBreakdown;
  readonly updatedAt: number;
}

export interface ResolvedTelemetryDisplay {
  // Core trigger metrics (strictly active-session scoped — never global fallback)
  readonly tps: number | null;
  readonly tpsScope: TelemetryMetricScope;
  readonly ttftMs: number | null;
  readonly totalTokens: number;
  readonly tokensScope: TelemetryMetricScope;
  readonly cacheHitRate: number | null;
  readonly contextPercent: number | null;
  readonly contextUsedTokens: number | null;
  readonly contextMaxTokens: number | null;
  readonly contextTone: ContextRingTone;
  readonly contextBarTone: ContextBarTone;
  readonly active: boolean;

  // Popover 1: Session stats (图 6)
  readonly rounds: number;
  readonly steps: number;
  readonly samples: number;
  readonly modelCallDurationMs: number | null;
  readonly toolCallDurationMs: number | null;
  readonly avgTtftMs: number | null;
  readonly sessionTps: number | null;
  readonly latestRequestTps: number | null;
  readonly textOutputTokens: number;
  readonly reasoningOutputTokens: number;

  // Popover 2: Token usage (图 7)
  /** Uncached prompt input tokens (including cache write tokens so uncached + cached + output = total). */
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly aggregatedTaskTotalTokens: number;
  readonly subagentCount: number;
  readonly subagentTotalTokens: number;
  readonly modelDistribution: readonly SessionModelDistributionEntry[];
  readonly globalTodayTokens: number;
  readonly globalMonthTokens: number;

  // Popover 3: Context window (Liquid vial + breakdown)
  readonly sampledModelDisplayName: string | null;
  readonly primaryEntrypointId: string | null;
  readonly distinctSampledModelCount: number;
  readonly hasMultipleSampledModels: boolean;
  readonly compactionCount: number;
  readonly contextBreakdown: SessionContextBreakdown;
}

export type SessionProjectionLike = Partial<
  Pick<
    ThreadStructure,
    | "thread"
    | "providerThreads"
    | "runs"
    | "nodes"
    | "subagents"
    | "providerTurns"
    | "turnItems"
    | "visibleTurnItems"
    | "messages"
  >
>;

export interface DeriveSessionTelemetryDetailInput {
  readonly threadId: string;
  readonly serverProjection: SessionProjectionLike | null;
  readonly activeContextWindow: ContextWindowSnapshot | null;
  readonly providerStatuses?: readonly ServerProvider[] | undefined;
  readonly activeProvider?: string | null | undefined;
  readonly activeModel?: string | null | undefined;
  readonly turnTimingsById?: ReadonlyMap<string, TurnObservedTiming> | undefined;
  readonly activeLiveTps?: number | null | undefined;
  readonly activeLiveTtftMs?: number | null | undefined;
  readonly contextBreakdownCategories?: readonly ContextBreakdownCategoryInput[] | undefined;
  readonly now?: number | undefined;
}

export interface SessionTelemetryDisplayInput {
  readonly threadId?: string | null | undefined;
  readonly detail?: SessionTelemetryDetailSnapshot | null | undefined;
  readonly live?: SessionLiveTelemetrySnapshot | null | undefined;
  readonly contextWindow?: ContextWindowSnapshot | null | undefined;
  readonly callLogs?: readonly UsageCallLogRecord[] | undefined;
  readonly mergedUsage?:
    | Pick<
        MergedUsage,
        | "totalTokens"
        | "uncachedInputTokens"
        | "cachedInputTokens"
        | "cacheCreationTokens"
        | "daily"
      >
    | null
    | undefined;
  readonly todayDay?: string | null | undefined;
  readonly providerStatuses?: readonly ServerProvider[] | undefined;
  readonly selectedModelId?: string | null | undefined;
  readonly selectedProvider?: string | null | undefined;
}

export function nonNegInt(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export function parseTelemetryTimestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  if (value !== null && typeof value === "object" && DateTime.isDateTime(value)) {
    const epoch = DateTime.toEpochMillis(value);
    return Number.isFinite(epoch) && epoch > 0 ? epoch : null;
  }
  return null;
}

export function formatIntegerTokens(tokens: number | null | undefined): string {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) {
    return "0";
  }
  return INTEGER_FORMATTER.format(Math.round(tokens));
}

/**
 * Compact uppercase token readout matching Popover 2 & Popover 3 figures:
 * e.g. `132.4K`, `512K`, `189.9M`, `53.8M`, `397.6M`, `3.3B`.
 */
export function formatCompactPopoverTokens(tokens: number | null | undefined): string {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) {
    return "0";
  }
  if (tokens < 1_000) {
    return String(Math.round(tokens));
  }
  if (tokens < 999_950) {
    return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  if (tokens < 999_950_000) {
    return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  return `${(tokens / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
}

/**
 * Formats token counts for the liquid vial readout and breakdown list:
 * e.g. `139`, `3.75k`, `10.4k`, `318.1k`, `512.0k`, `1.0M`.
 */
export function formatContextBreakdownTokens(tokens: number | null | undefined): string {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) {
    return "0";
  }
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${m >= 10 ? m.toFixed(1) : m.toFixed(2).replace(/0$/, "")}M`;
  }
  if (tokens >= 10_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(2)}k`;
  }
  return String(Math.round(tokens));
}

/**
 * Computes graduated 25% / 50% / 75% tick labels for the vertical liquid-tube gauge.
 * Recognizes standard binary/decimal context window capacities (512k, 1M, 256k, 200k, 128k).
 */
export function computeContextVialTicks(
  maxTokens: number | null | undefined,
): readonly ContextVialTick[] {
  const fractions = [0.25, 0.5, 0.75] as const;
  if (typeof maxTokens !== "number" || !Number.isFinite(maxTokens) || maxTokens <= 0) {
    return fractions.map((fraction) => ({
      fraction,
      label: `${Math.round(fraction * 100)}%`,
    }));
  }
  if (maxTokens === 524_288 || maxTokens === 512_000) {
    return [
      { fraction: 0.25, label: "128k" },
      { fraction: 0.5, label: "256k" },
      { fraction: 0.75, label: "384k" },
    ];
  }
  if (maxTokens === 1_048_576 || maxTokens === 1_000_000) {
    return [
      { fraction: 0.25, label: "250k" },
      { fraction: 0.5, label: "500k" },
      { fraction: 0.75, label: "750k" },
    ];
  }
  if (maxTokens === 262_144 || maxTokens === 256_000) {
    return [
      { fraction: 0.25, label: "64k" },
      { fraction: 0.5, label: "128k" },
      { fraction: 0.75, label: "192k" },
    ];
  }
  if (maxTokens === 131_072 || maxTokens === 128_000) {
    return [
      { fraction: 0.25, label: "32k" },
      { fraction: 0.5, label: "64k" },
      { fraction: 0.75, label: "96k" },
    ];
  }
  return fractions.map((fraction) => {
    const val = maxTokens * fraction;
    if (val >= 1_000_000) {
      const m = val / 1_000_000;
      return { fraction, label: `${m.toFixed(1).replace(/\.0$/, "")}M` };
    }
    if (val >= 1_000) {
      return { fraction, label: `${Math.round(val / 1_000)}k` };
    }
    return { fraction, label: String(Math.round(val)) };
  });
}

/** Occupancy tiers for the inline pill: <50% normal, 50-79% warning, 80-100% compact, >100% overflow. */
export function resolveContextRingTone(contextPercent: number | null | undefined): ContextRingTone {
  if (
    typeof contextPercent !== "number" ||
    !Number.isFinite(contextPercent) ||
    contextPercent < 0
  ) {
    return "unknown";
  }
  if (contextPercent > 100) return "overflow";
  if (contextPercent >= 80) return "compact";
  if (contextPercent >= 50) return "warning";
  return "normal";
}

/**
 * Classifies the Popover 3 liquid tube & bar occupancy tier:
 * - `< 50%`     → healthy emerald/green (`normal`)
 * - `50%–79.9%` → warning amber/gold (`warning`)
 * - `>= 80%`    → critical rose/red (`critical`)
 */
export function resolveContextBarTone(contextPercent: number | null | undefined): ContextBarTone {
  if (
    typeof contextPercent !== "number" ||
    !Number.isFinite(contextPercent) ||
    contextPercent < 0
  ) {
    return "unknown";
  }
  if (contextPercent >= 80) return "critical";
  if (contextPercent >= 50) return "warning";
  return "normal";
}

export function transitionTelemetryPopover(
  current: TelemetryPopoverId | null,
  target: TelemetryPopoverId,
  nextOpen: boolean,
): TelemetryPopoverId | null {
  if (nextOpen) {
    return target;
  }
  return current === target ? null : current;
}

export function resolveModelDisplayName(
  rawModelId: string | null | undefined,
  providerStatuses?: readonly ServerProvider[] | undefined,
  preferredProvider?: string | null | undefined,
): string | null {
  const trimmed = rawModelId?.trim();
  if (!trimmed || trimmed === "unknown") return null;
  const formatted = formatUsageModelDisplayName(trimmed, providerStatuses, preferredProvider);
  return formatted && formatted !== "unknown" ? formatted : null;
}

export function mergeTimeIntervals(
  intervals: readonly (readonly [number, number])[],
): readonly (readonly [number, number])[] {
  const valid = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (valid.length === 0) return [];
  const merged: Array<[number, number]> = [[valid[0]![0], valid[0]![1]]];
  for (let i = 1; i < valid.length; i += 1) {
    const [start, end] = valid[i]!;
    const last = merged[merged.length - 1]!;
    if (start <= last[1]) {
      if (end > last[1]) last[1] = end;
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

export function sumIntervalMs(intervals: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (const [start, end] of intervals) {
    if (end > start) sum += end - start;
  }
  return sum;
}

function overlapDurationMs(
  a: readonly (readonly [number, number])[],
  b: readonly (readonly [number, number])[],
): number {
  let i = 0;
  let j = 0;
  let total = 0;
  while (i < a.length && j < b.length) {
    const [aStart, aEnd] = a[i]!;
    const [bStart, bEnd] = b[j]!;
    const start = Math.max(aStart, bStart);
    const end = Math.min(aEnd, bEnd);
    if (end > start) total += end - start;
    if (aEnd < bEnd) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return total;
}

/**
 * Allocates integer percentages summing to 100 using largest-remainder rounding.
 */
export function allocateRoundedPercentages(values: readonly number[]): readonly number[] {
  const total = values.reduce((acc, v) => acc + Math.max(0, v), 0);
  if (total <= 0 || values.length === 0) {
    return values.map(() => 0);
  }
  const exact = values.map((v) => (Math.max(0, v) / total) * 100);
  const floors = exact.map((p) => Math.floor(p));
  let remaining = 100 - floors.reduce((acc, f) => acc + f, 0);
  const order = exact
    .map((p, index) => ({ index, remainder: p - floors[index]! }))
    .toSorted((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < order.length && remaining > 0; i += 1) {
    floors[order[i]!.index]! += 1;
    remaining -= 1;
  }
  return floors;
}

export function buildModelDistribution(
  tokensByModel: ReadonlyMap<string, number>,
  providerStatuses?: readonly ServerProvider[] | undefined,
  preferredProvider?: string | null | undefined,
): readonly SessionModelDistributionEntry[] {
  const sorted = [...tokensByModel.entries()]
    .filter(([modelId, tokens]) => modelId.trim().length > 0 && tokens > 0)
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (sorted.length === 0) return [];
  const total = sorted.reduce((acc, [, tokens]) => acc + tokens, 0);
  const percentages = allocateRoundedPercentages(sorted.map(([, tokens]) => tokens));

  return sorted.map(([modelId, tokens], index) => ({
    modelId,
    displayName: resolveModelDisplayName(modelId, providerStatuses, preferredProvider) ?? modelId,
    totalTokens: tokens,
    share: total > 0 ? tokens / total : 0,
    percent: percentages[index] ?? 0,
    compactTokens: formatCompactPopoverTokens(tokens),
    color: MODEL_DISTRIBUTION_COLORS[index % MODEL_DISTRIBUTION_COLORS.length]!,
  }));
}

export function computeDonutSegments(
  models: readonly Pick<SessionModelDistributionEntry, "modelId" | "color" | "share">[],
  radius: number,
): readonly DonutSegmentGeometry[] {
  const circumference = 2 * Math.PI * radius;
  const active = models.filter((m) => Number.isFinite(m.share) && m.share > 0);
  if (active.length === 0) return [];

  let cumulativeLength = 0;
  return active.map((entry) => {
    const clampedShare = Math.min(1, Math.max(0, entry.share));
    const segmentLength = clampedShare * circumference;
    const dashOffset = -cumulativeLength;
    cumulativeLength += segmentLength;
    return {
      modelId: entry.modelId,
      color: entry.color,
      dashArray: `${segmentLength} ${Math.max(0, circumference - segmentLength)}`,
      dashOffset,
      share: clampedShare,
    };
  });
}

export interface ExtractedTurnUsageDetail {
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly otherUsageTokens: number;
  readonly hasSubagents: boolean;
  readonly reportedModels: readonly string[];
  readonly hasMeasuredTokens: boolean;
  readonly ttftMs: number | null;
  readonly decodeMs: number | null;
  readonly modelDurationMs: number | null;
}

function nonNegFiniteNullable(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function posFiniteNullable(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function extractTurnUsageDetail(
  turn:
    | Pick<OrchestrationV2ProviderTurn, "turnTokenUsage" | "tokenUsage" | "model">
    | null
    | undefined,
): ExtractedTurnUsageDetail {
  if (!turn) {
    return {
      uncachedInputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      otherUsageTokens: 0,
      hasSubagents: false,
      reportedModels: [],
      hasMeasuredTokens: false,
      ttftMs: null,
      decodeMs: null,
      modelDurationMs: null,
    };
  }

  const finalUsage = turn.turnTokenUsage;
  const usableFinalUsage =
    finalUsage && finalUsage.usageStatus !== "unavailable" ? finalUsage : undefined;
  const liveUsage = turn.tokenUsage;
  const reportedModels: string[] = [];
  if (Array.isArray(finalUsage?.models)) {
    for (const m of finalUsage.models) {
      const cleaned = unwrapUsageModelSlug(m);
      if (cleaned && !reportedModels.includes(cleaned)) reportedModels.push(cleaned);
    }
  }
  const turnModel = turn.model ? unwrapUsageModelSlug(turn.model) : "";
  if (turnModel && !reportedModels.includes(turnModel)) {
    reportedModels.unshift(turnModel);
  }

  const modelDurationMs = nonNegFiniteNullable(
    usableFinalUsage?.modelDurationMs ?? liveUsage?.durationMs,
  );
  const ttftMs = clampTtftToDuration(
    usableFinalUsage?.ttftMs ?? liveUsage?.ttftMs,
    modelDurationMs,
  );
  const decodeMs = posFiniteNullable(usableFinalUsage?.decodeMs ?? liveUsage?.decodeMs);

  const otherUsageTokens = finalUsage?.otherUsage
    ? nonNegInt(finalUsage.otherUsage.inputTokens) + nonNegInt(finalUsage.otherUsage.outputTokens)
    : 0;
  const hasSubagents = finalUsage?.hasSubagents === true || otherUsageTokens > 0;

  if (usableFinalUsage) {
    const cached = nonNegInt(usableFinalUsage.cachedInputTokens);
    const cacheCreate = nonNegInt(usableFinalUsage.cacheCreationTokens);
    const rawInput = nonNegInt(usableFinalUsage.inputTokens);
    const uncached = Math.max(0, rawInput - cached - cacheCreate);
    const output = nonNegInt(usableFinalUsage.outputTokens);
    const reasoning = Math.min(
      output,
      nonNegInt(usableFinalUsage.reasoningTokens ?? liveUsage?.reasoningOutputTokens),
    );
    const total = uncached + cached + cacheCreate + output;
    if (total > 0) {
      return {
        uncachedInputTokens: uncached,
        cachedInputTokens: cached,
        cacheCreationTokens: cacheCreate,
        outputTokens: output,
        reasoningTokens: reasoning,
        totalTokens: total,
        otherUsageTokens,
        hasSubagents,
        reportedModels,
        hasMeasuredTokens: true,
        ttftMs,
        decodeMs,
        modelDurationMs,
      };
    }
  }

  if (liveUsage) {
    const cached = nonNegInt(liveUsage.cachedInputTokens);
    const cacheCreate = nonNegInt(liveUsage.cacheCreationTokens);
    const rawInput = nonNegInt(liveUsage.inputTokens);
    const uncached = Math.max(0, rawInput - cached - cacheCreate);
    const output = nonNegInt(liveUsage.outputTokens);
    const reasoning = Math.min(output, nonNegInt(liveUsage.reasoningOutputTokens));
    const total = Math.max(
      nonNegInt(liveUsage.usedTokens),
      uncached + cached + cacheCreate + output,
    );
    if (total > 0) {
      return {
        uncachedInputTokens: uncached,
        cachedInputTokens: cached,
        cacheCreationTokens: cacheCreate,
        outputTokens: output,
        reasoningTokens: reasoning,
        totalTokens: total,
        otherUsageTokens,
        hasSubagents,
        reportedModels,
        hasMeasuredTokens: true,
        ttftMs,
        decodeMs,
        modelDurationMs,
      };
    }
  }

  return {
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    otherUsageTokens,
    hasSubagents,
    reportedModels,
    hasMeasuredTokens: false,
    ttftMs,
    decodeMs,
    modelDurationMs,
  };
}

/** CJK-aware text token estimator used solely for apportioning measured window totals across real transcript buckets. */
export function estimateContextTextTokens(text: string | null | undefined): number {
  if (!text) return 0;
  let cjk = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk += 1;
    }
  }
  const other = text.length - cjk;
  return Math.ceil(cjk * 1.15 + other / 3.8);
}

function estimateUnknownPayloadTokens(value: unknown, maxChars = 24_000): number {
  if (typeof value === "string") {
    return estimateContextTextTokens(value.length > maxChars ? value.slice(0, maxChars) : value);
  }
  if (value === null || value === undefined) return 0;
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return 0;
    return estimateContextTextTokens(
      serialized.length > maxChars ? serialized.slice(0, maxChars) : serialized,
    );
  } catch {
    return 0;
  }
}

function normalizeBreakdownCategoryKey(
  rawKey: string | undefined,
  label: string,
  index: number,
): string {
  const src = (rawKey || label || "").trim().toLowerCase();
  if (!src) return `category-${index}`;
  if (src === "free" || src.includes("remain") || src.includes("剩余")) return "free";
  if (src === "system-prompt" || src.includes("system prompt")) return "system-prompt";
  if (src.includes("system")) return "system";
  if (src.includes("mcp")) return "mcp";
  if (src.includes("subagent")) return "subagents";
  if (src === "skills" || src.includes("skill")) return "skills";
  if (src.includes("plugin")) return "plugins";
  if (src.includes("rule")) return "rules";
  if (src === "tools" || src.includes("tool")) return "tools";
  if (src.includes("think") || src.includes("reason")) return "reasoning";
  if (src.includes("message") || src.includes("chat")) return "messages";
  if (src.includes("memory") || src.includes("artifact")) return "memory";
  return src.replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || `category-${index}`;
}

function classifyBreakdownGroup(key: string, label: string): ContextBreakdownGroup {
  if (key === "free") return "free";
  const normalized = `${key} ${label}`.toLowerCase();
  if (/system|skill|rule|plugin|prompt|cached_context|memory/.test(normalized)) {
    return "system";
  }
  if (/tool|mcp|function/.test(normalized)) {
    return "tools";
  }
  return "conversation";
}

function resolveBreakdownColor(key: string, index: number, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim();
  if (key === "free") return "var(--pmx-context-free-swatch, rgba(148, 163, 184, 0.35))";
  return (
    CONTEXT_BREAKDOWN_COLORS[key] ??
    CONTEXT_BREAKDOWN_FALLBACK_PALETTE[index % CONTEXT_BREAKDOWN_FALLBACK_PALETTE.length]!
  );
}

/**
 * Apportions `targetTotal` integers across `weights` via largest-remainder rounding
 * so the returned array sums to `targetTotal` exactly (zero drift, zero fabricated tokens).
 */
export function apportionTokensLargestRemainder(
  weights: readonly number[],
  targetTotal: number,
): readonly number[] {
  const safeTarget = Math.max(0, Math.round(targetTotal));
  if (weights.length === 0) return [];
  if (safeTarget === 0) return weights.map(() => 0);
  const weightSum = weights.reduce((acc, w) => acc + Math.max(0, w), 0);
  if (weightSum <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (Math.max(0, w) / weightSum) * safeTarget);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = safeTarget - floors.reduce((acc, f) => acc + f, 0);
  const order = exact
    .map((v, index) => ({ index, frac: v - floors[index]! }))
    .toSorted((a, b) => b.frac - a.frac || a.index - b.index);
  for (let i = 0; i < order.length && remainder > 0; i += 1) {
    floors[order[i]!.index]! += 1;
    remainder -= 1;
  }
  return floors;
}

function extractProviderContextCategories(
  contextWindow: ContextWindowSnapshot | null | undefined,
  explicit?: readonly ContextBreakdownCategoryInput[] | undefined,
): readonly ContextBreakdownCategoryInput[] {
  if (Array.isArray(explicit) && explicit.length > 0) {
    return explicit;
  }
  if (!contextWindow || typeof contextWindow !== "object") return [];
  const raw = contextWindow as unknown as {
    readonly categories?: unknown;
    readonly breakdown?: unknown;
  };
  const candidate = Array.isArray(raw.categories)
    ? raw.categories
    : Array.isArray(raw.breakdown)
      ? raw.breakdown
      : null;
  if (!candidate) return [];
  const parsed: ContextBreakdownCategoryInput[] = [];
  for (const item of candidate) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const tokens = typeof rec.tokens === "number" && Number.isFinite(rec.tokens) ? rec.tokens : 0;
    const label =
      typeof rec.label === "string" ? rec.label : typeof rec.key === "string" ? rec.key : "";
    if (!label || tokens <= 0) continue;
    parsed.push({
      key: typeof rec.key === "string" ? rec.key : undefined,
      label,
      tokens,
      group:
        rec.group === "system" ||
        rec.group === "conversation" ||
        rec.group === "tools" ||
        rec.group === "free"
          ? rec.group
          : undefined,
      color: typeof rec.color === "string" ? rec.color : undefined,
      estimated: typeof rec.estimated === "boolean" ? rec.estimated : undefined,
    });
  }
  return parsed;
}

function summarizeContextCategories(
  categories: readonly ContextBreakdownCategory[],
): ContextBreakdownSummary {
  let systemTokens = 0;
  let conversationTokens = 0;
  let toolTokens = 0;
  for (const category of categories) {
    if (category.group === "system") systemTokens += category.tokens;
    else if (category.group === "tools") toolTokens += category.tokens;
    else if (category.group === "conversation") conversationTokens += category.tokens;
  }
  return { systemTokens, conversationTokens, toolTokens };
}

/**
 * Derives an honest context breakdown from provider categories, active post-compaction
 * transcript items, or measured token splits without fabricating unreported categories.
 */
export function deriveSessionContextBreakdown(input: {
  readonly serverProjection?: SessionProjectionLike | null | undefined;
  readonly activeContextWindow?: ContextWindowSnapshot | null | undefined;
  readonly providerCategories?: readonly ContextBreakdownCategoryInput[] | undefined;
  readonly compactionCountOverride?: number | undefined;
}): SessionContextBreakdown {
  const { serverProjection = null, activeContextWindow = null, providerCategories } = input;

  const runs = serverProjection?.runs ?? [];
  const rolledBackRunIds = new Set(
    runs.filter((run) => run.status === "rolled_back").map((run) => run.id),
  );
  const rawTurnItems =
    serverProjection?.turnItems && serverProjection.turnItems.length > 0
      ? serverProjection.turnItems
      : (serverProjection?.visibleTurnItems ?? []).map((entry) => entry.item);

  // 1. Count real compactions (completed compaction turn items + sharp turn-over-turn drops).
  let explicitCompactions = 0;
  let lastCompletedCompactionIdx = -1;
  for (let i = 0; i < rawTurnItems.length; i += 1) {
    const item = rawTurnItems[i]!;
    if (item.runId !== null && rolledBackRunIds.has(item.runId)) continue;
    if (item.type === "compaction" && item.status === "completed") {
      explicitCompactions += 1;
      lastCompletedCompactionIdx = i;
    }
  }

  let detectedDrops = 0;
  let prevTurnUsed = 0;
  for (const turn of serverProjection?.providerTurns ?? []) {
    const used =
      nonNegInt(turn.tokenUsage?.usedTokens) || nonNegInt(turn.turnTokenUsage?.inputTokens);
    if (used <= 0) continue;
    if (prevTurnUsed > 0 && used < prevTurnUsed * 0.72 && prevTurnUsed - used > 30_000) {
      detectedDrops += 1;
    }
    prevTurnUsed = used;
  }

  const compactionCount =
    typeof input.compactionCountOverride === "number" &&
    Number.isFinite(input.compactionCountOverride)
      ? Math.max(0, Math.round(input.compactionCountOverride))
      : Math.max(explicitCompactions, detectedDrops);

  // 2. Authoritative window totals
  const usedTokens =
    typeof activeContextWindow?.usedTokens === "number" &&
    Number.isFinite(activeContextWindow.usedTokens) &&
    activeContextWindow.usedTokens >= 0
      ? Math.round(activeContextWindow.usedTokens)
      : null;
  const maxTokens =
    typeof activeContextWindow?.maxTokens === "number" &&
    Number.isFinite(activeContextWindow.maxTokens) &&
    activeContextWindow.maxTokens > 0
      ? Math.round(activeContextWindow.maxTokens)
      : null;
  const remainingTokens =
    usedTokens !== null && maxTokens !== null
      ? Math.max(0, maxTokens - usedTokens)
      : maxTokens !== null
        ? maxTokens
        : null;
  const usedPercent =
    usedTokens !== null && maxTokens !== null && maxTokens > 0
      ? (usedTokens / maxTokens) * 100
      : null;
  const remainingPercent =
    usedPercent !== null ? Math.max(0, 100 - usedPercent) : maxTokens !== null ? 100 : null;

  const pctOfMax = (tokens: number): number | null =>
    maxTokens !== null && maxTokens > 0 ? Number(((tokens / maxTokens) * 100).toFixed(1)) : null;

  const withRemainingRow = (
    activeRows: ContextBreakdownCategory[],
  ): readonly ContextBreakdownCategory[] => {
    if (remainingTokens === null) return activeRows;
    return [
      ...activeRows,
      {
        key: "free",
        label: "free",
        tokens: remainingTokens,
        percent: pctOfMax(remainingTokens),
        group: "free",
        color: resolveBreakdownColor("free", activeRows.length),
        estimated: false,
      },
    ];
  };

  // Path 1: Fine-grained provider-reported categories
  const reportedCategories = extractProviderContextCategories(
    activeContextWindow,
    providerCategories,
  )
    .map((cat, idx) => {
      const key = normalizeBreakdownCategoryKey(cat.key, cat.label, idx);
      return {
        ...cat,
        key,
        group: cat.group ?? classifyBreakdownGroup(key, cat.label),
      };
    })
    .filter((cat) => cat.key !== "free" && Number.isFinite(cat.tokens) && cat.tokens > 0);

  if (reportedCategories.length > 0) {
    const targetUsed =
      usedTokens !== null && usedTokens > 0
        ? usedTokens
        : Math.round(reportedCategories.reduce((acc, c) => acc + c.tokens, 0));
    const apportioned = apportionTokensLargestRemainder(
      reportedCategories.map((c) => c.tokens),
      targetUsed,
    );
    const activeRows: ContextBreakdownCategory[] = reportedCategories.map((cat, idx) => {
      const tokens = apportioned[idx] ?? 0;
      return {
        key: cat.key,
        label: cat.label,
        tokens,
        percent: pctOfMax(tokens),
        group: cat.group,
        color: resolveBreakdownColor(cat.key, idx, cat.color),
        estimated: cat.estimated === true,
      };
    });
    const categories = withRemainingRow(activeRows);
    return {
      usedTokens: usedTokens ?? targetUsed,
      maxTokens,
      remainingTokens,
      usedPercent,
      remainingPercent,
      compactionCount,
      source: "provider-categories",
      summary: summarizeContextCategories(activeRows),
      categories,
    };
  }

  // Path 5: Empty / no measured used tokens yet
  if (usedTokens === null || usedTokens <= 0) {
    const categories = maxTokens !== null ? withRemainingRow([]) : [];
    return {
      usedTokens,
      maxTokens,
      remainingTokens,
      usedPercent,
      remainingPercent,
      compactionCount,
      source: "empty",
      summary: { systemTokens: 0, conversationTokens: 0, toolTokens: 0 },
      categories,
    };
  }

  // Path 2: Honest decomposition from real active post-compaction transcript items
  const activeItems =
    lastCompletedCompactionIdx >= 0 ? rawTurnItems.slice(lastCompletedCompactionIdx) : rawTurnItems;
  let conversationEst = 0;
  let reasoningEst = 0;
  let toolsEst = 0;
  let systemNoticeEst = 0;
  const seenMessageIds = new Set<string>();

  for (const item of activeItems) {
    if (item.runId !== null && rolledBackRunIds.has(item.runId)) continue;
    const raw = item as unknown as Record<string, unknown>;
    switch (item.type) {
      case "user_message": {
        if (typeof raw.messageId === "string") seenMessageIds.add(raw.messageId);
        if (typeof raw.text === "string") conversationEst += estimateContextTextTokens(raw.text);
        if (Array.isArray(raw.attachments) && raw.attachments.length > 0) {
          conversationEst += raw.attachments.length * 40;
        }
        break;
      }
      case "assistant_message": {
        if (typeof raw.messageId === "string") seenMessageIds.add(raw.messageId);
        if (typeof raw.text === "string") conversationEst += estimateContextTextTokens(raw.text);
        break;
      }
      case "proposed_plan": {
        if (typeof raw.markdown === "string")
          conversationEst += estimateContextTextTokens(raw.markdown);
        break;
      }
      case "todo_list": {
        if (typeof raw.explanation === "string")
          conversationEst += estimateContextTextTokens(raw.explanation);
        if (Array.isArray(raw.steps))
          conversationEst += estimateUnknownPayloadTokens(raw.steps, 4_000);
        break;
      }
      case "compaction": {
        if (typeof raw.summary === "string")
          conversationEst += estimateContextTextTokens(raw.summary);
        break;
      }
      case "handoff": {
        if (typeof raw.summary === "string")
          systemNoticeEst += estimateContextTextTokens(raw.summary);
        break;
      }
      case "system_notice": {
        if (typeof raw.message === "string")
          systemNoticeEst += estimateContextTextTokens(raw.message);
        break;
      }
      case "notification": {
        if (typeof raw.summary === "string")
          systemNoticeEst += estimateContextTextTokens(raw.summary);
        if (typeof raw.detail === "string")
          systemNoticeEst += estimateContextTextTokens(raw.detail);
        break;
      }
      case "reasoning": {
        if (typeof raw.text === "string") reasoningEst += estimateContextTextTokens(raw.text);
        break;
      }
      case "command_execution": {
        if (typeof raw.input === "string") toolsEst += estimateContextTextTokens(raw.input);
        if (typeof raw.output === "string") toolsEst += estimateContextTextTokens(raw.output);
        break;
      }
      case "file_change": {
        if (typeof raw.fileName === "string") toolsEst += estimateContextTextTokens(raw.fileName);
        if (typeof raw.diffStr === "string") toolsEst += estimateContextTextTokens(raw.diffStr);
        else {
          if (typeof raw.oldStr === "string") toolsEst += estimateContextTextTokens(raw.oldStr);
          if (typeof raw.newStr === "string") toolsEst += estimateContextTextTokens(raw.newStr);
        }
        break;
      }
      case "file_search": {
        if (typeof raw.pattern === "string") toolsEst += estimateContextTextTokens(raw.pattern);
        if (raw.results !== undefined)
          toolsEst += estimateUnknownPayloadTokens(raw.results, 12_000);
        break;
      }
      case "web_search": {
        if (raw.patterns !== undefined)
          toolsEst += estimateUnknownPayloadTokens(raw.patterns, 4_000);
        if (raw.results !== undefined)
          toolsEst += estimateUnknownPayloadTokens(raw.results, 12_000);
        break;
      }
      case "dynamic_tool": {
        if (typeof raw.toolName === "string") toolsEst += estimateContextTextTokens(raw.toolName);
        if (raw.input !== undefined) toolsEst += estimateUnknownPayloadTokens(raw.input, 8_000);
        if (raw.output !== undefined) toolsEst += estimateUnknownPayloadTokens(raw.output, 16_000);
        break;
      }
      case "subagent": {
        if (typeof raw.prompt === "string") toolsEst += estimateContextTextTokens(raw.prompt);
        if (typeof raw.result === "string") toolsEst += estimateContextTextTokens(raw.result);
        break;
      }
      default:
        break;
    }
  }

  // Include projection.messages not already counted via turnItems (only when uncompacted so we don't recount compacted msgs).
  if (lastCompletedCompactionIdx < 0) {
    for (const msg of serverProjection?.messages ?? []) {
      if (msg.id && seenMessageIds.has(msg.id)) continue;
      if (typeof msg.text === "string" && msg.text.length > 0) {
        conversationEst += estimateContextTextTokens(msg.text);
      }
    }
  }

  const transcriptTotal = conversationEst + reasoningEst + toolsEst + systemNoticeEst;
  if (transcriptTotal > 0) {
    const rawBuckets: Array<{
      readonly key: string;
      readonly label: string;
      readonly group: ContextBreakdownGroup;
      readonly weight: number;
    }> = [];

    if (transcriptTotal < usedTokens) {
      const systemOverhead = systemNoticeEst + (usedTokens - transcriptTotal);
      if (systemOverhead > 0) {
        rawBuckets.push({
          key: "system",
          label: "system",
          group: "system",
          weight: systemOverhead,
        });
      }
      if (toolsEst > 0) {
        rawBuckets.push({ key: "tools", label: "tools", group: "tools", weight: toolsEst });
      }
      if (reasoningEst > 0) {
        rawBuckets.push({
          key: "reasoning",
          label: "reasoning",
          group: "conversation",
          weight: reasoningEst,
        });
      }
      if (conversationEst > 0) {
        rawBuckets.push({
          key: "messages",
          label: "messages",
          group: "conversation",
          weight: conversationEst,
        });
      }
    } else {
      if (systemNoticeEst > 0) {
        rawBuckets.push({
          key: "system",
          label: "system",
          group: "system",
          weight: systemNoticeEst,
        });
      }
      if (toolsEst > 0) {
        rawBuckets.push({ key: "tools", label: "tools", group: "tools", weight: toolsEst });
      }
      if (reasoningEst > 0) {
        rawBuckets.push({
          key: "reasoning",
          label: "reasoning",
          group: "conversation",
          weight: reasoningEst,
        });
      }
      if (conversationEst > 0) {
        rawBuckets.push({
          key: "messages",
          label: "messages",
          group: "conversation",
          weight: conversationEst,
        });
      }
    }

    const apportioned = apportionTokensLargestRemainder(
      rawBuckets.map((b) => b.weight),
      usedTokens,
    );
    const activeRows: ContextBreakdownCategory[] = rawBuckets
      .map((bucket, idx) => ({
        key: bucket.key,
        label: bucket.label,
        tokens: apportioned[idx] ?? 0,
        percent: pctOfMax(apportioned[idx] ?? 0),
        group: bucket.group,
        color: resolveBreakdownColor(bucket.key, idx),
        estimated: true,
      }))
      .filter((row) => row.tokens > 0);

    const categories = withRemainingRow(activeRows);
    return {
      usedTokens,
      maxTokens,
      remainingTokens,
      usedPercent,
      remainingPercent,
      compactionCount,
      source: "transcript-estimate",
      summary: summarizeContextCategories(activeRows),
      categories,
    };
  }

  // Path 3: Honest provider-reported input / cached / output token split when no transcript items exist
  const cachedInput = nonNegInt(
    activeContextWindow?.lastCachedInputTokens ?? activeContextWindow?.cachedInputTokens,
  );
  const rawInput = nonNegInt(
    activeContextWindow?.lastInputTokens ?? activeContextWindow?.inputTokens,
  );
  const uncachedInput = Math.max(0, rawInput - cachedInput);
  const outputTokens = nonNegInt(
    activeContextWindow?.lastOutputTokens ?? activeContextWindow?.outputTokens,
  );
  const usageBuckets: Array<{
    readonly key: string;
    readonly label: string;
    readonly group: ContextBreakdownGroup;
    readonly weight: number;
  }> = [];
  if (cachedInput > 0) {
    usageBuckets.push({
      key: "cached_context",
      label: "cached_context",
      group: "system",
      weight: cachedInput,
    });
  }
  if (uncachedInput > 0) {
    usageBuckets.push({
      key: "uncached_input",
      label: "uncached_input",
      group: "conversation",
      weight: uncachedInput,
    });
  }
  if (outputTokens > 0) {
    usageBuckets.push({
      key: "output",
      label: "output",
      group: "conversation",
      weight: outputTokens,
    });
  }

  if (usageBuckets.length >= 2) {
    const apportioned = apportionTokensLargestRemainder(
      usageBuckets.map((b) => b.weight),
      usedTokens,
    );
    const activeRows: ContextBreakdownCategory[] = usageBuckets
      .map((bucket, idx) => ({
        key: bucket.key,
        label: bucket.label,
        tokens: apportioned[idx] ?? 0,
        percent: pctOfMax(apportioned[idx] ?? 0),
        group: bucket.group,
        color: resolveBreakdownColor(bucket.key, idx),
        estimated: false,
      }))
      .filter((row) => row.tokens > 0);
    const categories = withRemainingRow(activeRows);
    return {
      usedTokens,
      maxTokens,
      remainingTokens,
      usedPercent,
      remainingPercent,
      compactionCount,
      source: "usage-split",
      summary: summarizeContextCategories(activeRows),
      categories,
    };
  }

  // Path 4: Bare usedTokens only (no transcript items and no input/cached/output split)
  const usedRow: ContextBreakdownCategory = {
    key: "used",
    label: "used",
    tokens: usedTokens,
    percent: pctOfMax(usedTokens),
    group: "conversation",
    color: resolveBreakdownColor("used", 0),
    estimated: false,
  };
  const activeRows = [usedRow];
  return {
    usedTokens,
    maxTokens,
    remainingTokens,
    usedPercent,
    remainingPercent,
    compactionCount,
    source: "total-only",
    summary: summarizeContextCategories(activeRows),
    categories: withRemainingRow(activeRows),
  };
}

/**
 * Derives complete active-session telemetry directly from the active thread's
 * server projection, context window, and local timing tracker.
 * Strictly zero cross-thread or global leakage.
 */
export function deriveSessionTelemetryDetail(
  input: DeriveSessionTelemetryDetailInput,
): SessionTelemetryDetailSnapshot {
  const {
    threadId,
    serverProjection,
    activeContextWindow,
    providerStatuses,
    activeProvider,
    activeModel,
    turnTimingsById,
    activeLiveTps,
    activeLiveTtftMs,
  } = input;
  const now = input.now ?? Date.now();

  const runs = serverProjection?.runs ?? [];
  const activeRuns = runs.filter((run) => run.status !== "rolled_back");
  const rolledBackRunIds = new Set(
    runs.filter((run) => run.status === "rolled_back").map((run) => run.id),
  );
  const turns = serverProjection?.providerTurns ?? [];
  const rawTurnItems =
    serverProjection?.turnItems && serverProjection.turnItems.length > 0
      ? serverProjection.turnItems
      : (serverProjection?.visibleTurnItems ?? []).map((entry) => entry.item);
  const nodes = serverProjection?.nodes ?? [];
  const subagents = (serverProjection?.subagents ?? []).filter(
    (sub) => sub.runId === null || !rolledBackRunIds.has(sub.runId),
  );

  // 1. Turns / rounds count
  let userMessageCount = 0;
  for (const msg of serverProjection?.messages ?? []) {
    if (msg.role === "user") userMessageCount += 1;
  }
  if (userMessageCount === 0) {
    for (const item of rawTurnItems) {
      if (item.type === "user_message") userMessageCount += 1;
    }
  }
  const rounds = activeRuns.length > 0 ? activeRuns.length : userMessageCount;

  // 2. Steps & tool call durations
  let stepItemCount = 0;
  const toolIntervals: Array<[number, number]> = [];
  const coveredToolNodeIds = new Set<string>();
  const coveredSubagentIds = new Set<string>();

  for (const item of rawTurnItems) {
    if (item.runId !== null && rolledBackRunIds.has(item.runId)) continue;
    if (!NON_STEP_TURN_ITEM_TYPES.has(item.type)) {
      stepItemCount += 1;
    }
    if (item.deferredWork && item.deferredWork.itemCount > 0) {
      stepItemCount += item.deferredWork.itemCount;
    }
    if (TOOL_TURN_ITEM_TYPES.has(item.type)) {
      const startMs = parseTelemetryTimestampMs(item.startedAt);
      const endMs = parseTelemetryTimestampMs(item.completedAt);
      if (startMs !== null && endMs !== null && endMs > startMs) {
        toolIntervals.push([startMs, endMs]);
        if (item.nodeId) coveredToolNodeIds.add(item.nodeId);
        if (item.type === "subagent") coveredSubagentIds.add(item.subagentId);
      }
    }
  }

  let nonRootNodeCount = 0;
  for (const node of nodes) {
    if (node.runId !== null && rolledBackRunIds.has(node.runId)) continue;
    if (node.kind !== "root_turn" && node.kind !== "system") {
      nonRootNodeCount += 1;
    }
    if (
      (node.kind === "tool_call" || node.kind === "subagent") &&
      !coveredToolNodeIds.has(node.id)
    ) {
      const startMs = parseTelemetryTimestampMs(node.startedAt);
      const endMs = parseTelemetryTimestampMs(node.completedAt);
      if (startMs !== null && endMs !== null && endMs > startMs) {
        toolIntervals.push([startMs, endMs]);
        coveredToolNodeIds.add(node.id);
      }
    }
  }

  // Also collect subagent workflow duration/steps when timestamps weren't on turnItems
  let workflowExtraDurationMs = 0;
  let workflowToolCalls = 0;
  let subagentCount = 0;
  let nativeWorkflowTokens = 0;
  let appOwnedSubagentTokens = 0;
  const subagentChildThreadIds: string[] = [];
  const seenChildThreads = new Set<string>();

  for (const sub of subagents) {
    const workflowAgents = sub.workflow?.agents ?? [];
    subagentCount += workflowAgents.length > 0 ? workflowAgents.length : 1;

    if (sub.childThreadId && !seenChildThreads.has(sub.childThreadId)) {
      seenChildThreads.add(sub.childThreadId);
      subagentChildThreadIds.push(sub.childThreadId);
    }
    for (const agent of workflowAgents) {
      if (agent.childThreadId && !seenChildThreads.has(agent.childThreadId)) {
        seenChildThreads.add(agent.childThreadId);
        subagentChildThreadIds.push(agent.childThreadId);
      }
    }

    const wfTokens =
      nonNegInt(sub.workflow?.totalTokens) ||
      workflowAgents.reduce((acc, agent) => acc + nonNegInt(agent.totalTokens), 0);
    if (sub.origin === "provider_native") {
      nativeWorkflowTokens += wfTokens;
    } else {
      appOwnedSubagentTokens += wfTokens;
    }

    if (sub.workflow?.toolCalls) {
      workflowToolCalls += nonNegInt(sub.workflow.toolCalls);
    }

    if (!coveredSubagentIds.has(sub.id) && !coveredToolNodeIds.has(sub.id)) {
      const startMs = parseTelemetryTimestampMs(sub.startedAt);
      const endMs = parseTelemetryTimestampMs(sub.completedAt);
      if (startMs !== null && endMs !== null && endMs > startMs) {
        toolIntervals.push([startMs, endMs]);
      } else if (sub.workflow?.durationMs && sub.workflow.durationMs > 0) {
        workflowExtraDurationMs += nonNegInt(sub.workflow.durationMs);
      }
    }
  }

  const mergedToolIntervals = mergeTimeIntervals(toolIntervals);
  const rawToolDurationMs = sumIntervalMs(mergedToolIntervals) + workflowExtraDurationMs;
  const toolCallDurationMs = rawToolDurationMs > 0 ? rawToolDurationMs : null;

  // 3. Per-turn tokens, timings, TTFT, TPS, multi-model distribution, and native subagent usage
  let samples = 0;
  let totalUncached = 0;
  let totalCached = 0;
  let totalCacheCreate = 0;
  let totalOutput = 0;
  let totalReasoning = 0;
  let sessionTotalTokens = 0;
  let otherUsageTotal = 0;
  let turnsWithSubagents = 0;

  let ttftSum = 0;
  let ttftSampleCount = 0;
  let timedOutputSum = 0;
  let timedGenMsSum = 0;
  let tpsSum = 0;
  let tpsSampleCount = 0;
  let latestRequestTps: number | null = null;

  const turnIntervals: Array<[number, number]> = [];
  let turnExtraModelDurationMs = 0;
  const tokensByModel = new Map<string, number>();
  const distinctSampledModels: string[] = [];
  let latestSampledModelId: string | null = null;

  const recordSampledModel = (modelId: string | null | undefined) => {
    const cleaned = modelId ? unwrapUsageModelSlug(modelId) : "";
    if (!cleaned || cleaned === "unknown") return;
    if (!distinctSampledModels.includes(cleaned)) {
      distinctSampledModels.push(cleaned);
    }
    latestSampledModelId = cleaned;
  };

  for (const turn of turns) {
    const extracted = extractTurnUsageDetail(turn);
    const observed = turnTimingsById?.get(turn.id);
    const startedMs = parseTelemetryTimestampMs(turn.startedAt) ?? observed?.turnStartedAt ?? null;
    const completedMs = parseTelemetryTimestampMs(turn.completedAt);
    const wallDurationMs =
      startedMs !== null && completedMs !== null && completedMs >= startedMs
        ? completedMs - startedMs
        : null;
    const durationMs = wallDurationMs ?? extracted.modelDurationMs;
    const observedTtftMs =
      startedMs !== null &&
      observed?.firstTokenAt !== null &&
      observed?.firstTokenAt !== undefined &&
      observed.firstTokenAt >= startedMs
        ? observed.firstTokenAt - startedMs
        : null;
    const clampedDurationBound =
      wallDurationMs !== null && extracted.modelDurationMs !== null
        ? Math.min(wallDurationMs, extracted.modelDurationMs)
        : (wallDurationMs ?? extracted.modelDurationMs);
    // Prefer authoritative server-reported TTFT over noisy client WS receive timestamps,
    // and enforce physical invariant `ttftMs <= durationMs`.
    const ttftMs = clampTtftToDuration(extracted.ttftMs ?? observedTtftMs, clampedDurationBound);

    if (startedMs !== null && completedMs !== null && completedMs > startedMs) {
      turnIntervals.push([startedMs, completedMs]);
    } else if (extracted.modelDurationMs !== null && extracted.modelDurationMs > 0) {
      turnExtraModelDurationMs += extracted.modelDurationMs;
    }

    if (extracted.hasSubagents) {
      turnsWithSubagents += 1;
      otherUsageTotal += extracted.otherUsageTokens;
    }

    const hasSample =
      extracted.hasMeasuredTokens ||
      durationMs !== null ||
      ttftMs !== null ||
      extracted.decodeMs !== null;
    if (hasSample) {
      samples += 1;
    }

    if (ttftMs !== null) {
      ttftSum += ttftMs;
      ttftSampleCount += 1;
    }

    if (extracted.hasMeasuredTokens) {
      totalUncached += extracted.uncachedInputTokens;
      totalCached += extracted.cachedInputTokens;
      totalCacheCreate += extracted.cacheCreationTokens;
      totalOutput += extracted.outputTokens;
      totalReasoning += extracted.reasoningTokens;
      sessionTotalTokens += extracted.totalTokens;

      const primaryModelRaw = extracted.reportedModels[0] ?? activeModel?.trim() ?? null;
      const primaryModel = primaryModelRaw ? unwrapUsageModelSlug(primaryModelRaw) : null;
      if (primaryModel && primaryModel !== "unknown") {
        tokensByModel.set(
          primaryModel,
          (tokensByModel.get(primaryModel) ?? 0) + extracted.totalTokens,
        );
      }
      for (const m of extracted.reportedModels) {
        recordSampledModel(m);
      }
      if (extracted.reportedModels.length === 0 && primaryModel) {
        recordSampledModel(primaryModel);
      }
    } else if (extracted.reportedModels.length > 0) {
      for (const m of extracted.reportedModels) {
        recordSampledModel(m);
      }
    }

    if (turn.status !== "running" && turn.status !== "pending" && extracted.outputTokens > 0) {
      const effectiveGenMs = resolveEffectiveDecodeDurationMs(
        extracted.outputTokens,
        durationMs,
        ttftMs,
        extracted.decodeMs,
      );
      if (effectiveGenMs !== null) {
        const turnTps = extracted.outputTokens / (effectiveGenMs / 1_000);
        if (Number.isFinite(turnTps) && turnTps > 0) {
          latestRequestTps = turnTps;
          tpsSum += turnTps;
          tpsSampleCount += 1;
          timedOutputSum += extracted.outputTokens;
          timedGenMsSum += effectiveGenMs;
        }
      }
    }
  }

  // Fallback to activeContextWindow when providerTurns haven't emitted per-turn tokens yet
  if (sessionTotalTokens === 0 && activeContextWindow) {
    const cached = nonNegInt(
      activeContextWindow.lastCachedInputTokens ?? activeContextWindow.cachedInputTokens,
    );
    const rawInput = nonNegInt(
      activeContextWindow.lastInputTokens ?? activeContextWindow.inputTokens,
    );
    const uncached = Math.max(0, rawInput - cached);
    const output = nonNegInt(
      activeContextWindow.lastOutputTokens ?? activeContextWindow.outputTokens,
    );
    const reasoning = Math.min(
      output,
      nonNegInt(
        activeContextWindow.lastReasoningOutputTokens ?? activeContextWindow.reasoningOutputTokens,
      ),
    );
    const fallbackTotal = Math.max(
      nonNegInt(activeContextWindow.totalProcessedTokens),
      nonNegInt(activeContextWindow.usedTokens),
      uncached + cached + output,
    );
    if (fallbackTotal > 0) {
      totalUncached = uncached;
      totalCached = cached;
      totalOutput = output;
      totalReasoning = reasoning;
      sessionTotalTokens = fallbackTotal;
      if (samples === 0) samples = 1;
      if (activeModel && activeModel.trim() && activeModel.trim() !== "unknown") {
        const cleanedActiveModel = unwrapUsageModelSlug(activeModel);
        tokensByModel.set(cleanedActiveModel, fallbackTotal);
        recordSampledModel(cleanedActiveModel);
      }
    }
    if (latestRequestTps === null && output > 0 && activeContextWindow.durationMs) {
      const ctxTps = computeOutputTps(output, activeContextWindow.durationMs, null);
      if (ctxTps !== null) {
        latestRequestTps = ctxTps;
        tpsSum += ctxTps;
        tpsSampleCount += 1;
      }
    }
  }

  if (typeof activeLiveTps === "number" && Number.isFinite(activeLiveTps) && activeLiveTps > 0) {
    latestRequestTps = activeLiveTps;
  }

  // Model call duration = merged turn wall time minus overlapping merged tool intervals
  const mergedTurnIntervals = mergeTimeIntervals(turnIntervals);
  const totalTurnWallMs = sumIntervalMs(mergedTurnIntervals);
  let modelCallDurationMs: number | null = null;
  if (totalTurnWallMs > 0) {
    const toolOverlapInsideTurns = overlapDurationMs(mergedTurnIntervals, mergedToolIntervals);
    const netModelMs = totalTurnWallMs - toolOverlapInsideTurns;
    modelCallDurationMs =
      (netModelMs > 0 ? netModelMs : totalTurnWallMs) + turnExtraModelDurationMs;
  } else if (turnExtraModelDurationMs > 0) {
    modelCallDurationMs = Math.round(turnExtraModelDurationMs);
  } else if (activeContextWindow?.durationMs && activeContextWindow.durationMs > 0) {
    modelCallDurationMs = nonNegInt(activeContextWindow.durationMs);
  }

  if (
    ttftSampleCount === 0 &&
    typeof activeLiveTtftMs === "number" &&
    Number.isFinite(activeLiveTtftMs) &&
    activeLiveTtftMs >= 0
  ) {
    const hasInFlightTurn = turns.some(
      (turn) => turn.status === "running" || turn.status === "pending",
    );
    const effectiveActiveTtft = hasInFlightTurn
      ? activeLiveTtftMs
      : (clampTtftToDuration(activeLiveTtftMs, modelCallDurationMs) ?? activeLiveTtftMs);
    ttftSum = effectiveActiveTtft;
    ttftSampleCount = 1;
  }

  const effectiveSubagentCount = subagentCount > 0 ? subagentCount : turnsWithSubagents;
  const subagentTotalTokens =
    Math.max(otherUsageTotal, nativeWorkflowTokens) + appOwnedSubagentTokens;

  const steps = Math.max(
    stepItemCount + workflowToolCalls,
    nonRootNodeCount,
    activeContextWindow?.toolUses ? nonNegInt(activeContextWindow.toolUses) : 0,
    samples > 0 && rounds > 0 ? samples : 0,
  );

  const sessionTps =
    timedOutputSum > 0 && timedGenMsSum > 0
      ? timedOutputSum / (timedGenMsSum / 1_000)
      : tpsSampleCount > 0
        ? tpsSum / tpsSampleCount
        : latestRequestTps;

  const avgTtftMs = ttftSampleCount > 0 ? ttftSum / ttftSampleCount : null;
  const textOutputTokens = Math.max(0, totalOutput - totalReasoning);
  const effectiveUncachedInput = totalUncached + totalCacheCreate;
  const cacheHitRate = computeCacheHitRate(totalUncached, totalCached, totalCacheCreate);
  const modelDistribution = buildModelDistribution(tokensByModel, providerStatuses, activeProvider);

  const latestSampledModelDisplayName = latestSampledModelId
    ? resolveModelDisplayName(latestSampledModelId, providerStatuses, activeProvider)
    : null;

  const contextBreakdown = deriveSessionContextBreakdown({
    serverProjection,
    activeContextWindow,
    providerCategories: input.contextBreakdownCategories,
  });

  return {
    threadId,
    rounds,
    steps,
    samples,
    modelCallDurationMs,
    toolCallDurationMs,
    avgTtftMs,
    ttftSampleCount,
    sessionTps,
    latestRequestTps,
    textOutputTokens,
    reasoningOutputTokens: totalReasoning,
    uncachedInputTokens: effectiveUncachedInput,
    cachedInputTokens: totalCached,
    cacheCreationTokens: totalCacheCreate,
    outputTokens: totalOutput,
    sessionTotalTokens,
    cacheHitRate,
    subagentCount: effectiveSubagentCount,
    subagentTotalTokens,
    subagentChildThreadIds,
    aggregatedTaskTotalTokens: sessionTotalTokens + subagentTotalTokens,
    modelDistribution,
    distinctSampledModels,
    latestSampledModelId,
    latestSampledModelDisplayName,
    compactionCount: contextBreakdown.compactionCount,
    contextBreakdown,
    updatedAt: now,
  };
}

function localDayKeyFromMs(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveGlobalTodayAndMonthTokens(input: {
  readonly mergedUsage?: Pick<MergedUsage, "totalTokens" | "daily"> | null | undefined;
  readonly todayDay?: string | null | undefined;
  readonly callLogs?: readonly UsageCallLogRecord[] | undefined;
}): { readonly todayTokens: number; readonly monthTokens: number } {
  const todayDay = input.todayDay?.trim() || localDayKeyFromMs(Date.now());
  const monthPrefix = todayDay.slice(0, 7);

  let todayFromMerged = 0;
  let monthFromMerged = 0;
  const daily = input.mergedUsage?.daily;
  if (Array.isArray(daily) && daily.length > 0) {
    for (const bucket of daily) {
      if (bucket.day === todayDay) {
        todayFromMerged += nonNegInt(bucket.totalTokens);
      }
      if (bucket.day.startsWith(monthPrefix)) {
        monthFromMerged += nonNegInt(bucket.totalTokens);
      }
    }
  } else if (input.mergedUsage && input.mergedUsage.totalTokens > 0) {
    monthFromMerged = nonNegInt(input.mergedUsage.totalTokens);
  }

  let todayFromLiveLogs = 0;
  let monthFromLiveLogs = 0;
  if (input.callLogs && input.callLogs.length > 0) {
    for (const log of input.callLogs) {
      if (log.source !== "live") continue;
      const logDay = localDayKeyFromMs(log.timestamp);
      if (logDay === todayDay) {
        todayFromLiveLogs += nonNegInt(log.totalTokens);
      }
      if (logDay.startsWith(monthPrefix)) {
        monthFromLiveLogs += nonNegInt(log.totalTokens);
      }
    }
  }

  const todayTokens = todayFromMerged > 0 ? todayFromMerged : todayFromLiveLogs;
  const monthTokens = Math.max(
    monthFromMerged > 0 ? monthFromMerged : monthFromLiveLogs,
    todayTokens,
  );
  return { todayTokens, monthTokens };
}

/**
 * Active-session telemetry display for the 3 composer triggers/popovers.
 * Strictly thread-scoped; `mergedUsage` is ONLY for Popover 2 global Today/Month cards.
 */
export function resolveSessionTelemetryDisplay(
  input: SessionTelemetryDisplayInput,
): ResolvedTelemetryDisplay {
  const {
    detail = null,
    live = null,
    contextWindow = null,
    callLogs = [],
    mergedUsage = null,
    todayDay = null,
    providerStatuses,
    selectedModelId = null,
    selectedProvider = null,
  } = input;

  const threadId = input.threadId ?? detail?.threadId ?? live?.threadId ?? null;

  // Strictly thread-scoped call logs (never pull other threads into active session!)
  const threadLogs = threadId !== null ? callLogs.filter((log) => log.threadId === threadId) : [];

  // Aggregate thread-scoped logs in chronological/recency order
  let logTotalTokens = 0;
  let logUncached = 0;
  let logCached = 0;
  let logCacheCreate = 0;
  let logOutput = 0;
  let logReasoning = 0;
  let logDurationSum = 0;
  let logTtftSum = 0;
  let logTtftCount = 0;
  let logTimedOutput = 0;
  let logTimedGenMs = 0;
  let logTpsSum = 0;
  let logTpsCount = 0;
  let logLatestTps: number | null = null;
  let logLatestModelId: string | null = null;
  const logTokensByModel = new Map<string, number>();
  const logDistinctModels: string[] = [];

  for (const log of threadLogs) {
    logTotalTokens += nonNegInt(log.totalTokens);
    logUncached += nonNegInt(log.inputTokens);
    logCached += nonNegInt(log.cachedInputTokens);
    logCacheCreate += nonNegInt(log.cacheCreationTokens);
    logOutput += nonNegInt(log.outputTokens);
    logReasoning += Math.min(nonNegInt(log.outputTokens), nonNegInt(log.reasoningTokens));
    if (log.durationMs !== null && log.durationMs > 0) {
      logDurationSum += log.durationMs;
    }
    const clampedLogTtftMs = clampTtftToDuration(log.ttftMs, log.durationMs);
    if (clampedLogTtftMs !== null && Number.isFinite(clampedLogTtftMs) && clampedLogTtftMs >= 0) {
      logTtftSum += clampedLogTtftMs;
      logTtftCount += 1;
    }
    if (log.tps !== null && Number.isFinite(log.tps) && log.tps > 0) {
      if (logLatestTps === null) logLatestTps = log.tps;
      logTpsSum += log.tps;
      logTpsCount += 1;
      if (log.outputTokens > 0) {
        const genMs = (log.outputTokens / log.tps) * 1_000;
        if (Number.isFinite(genMs) && genMs > 0) {
          logTimedOutput += log.outputTokens;
          logTimedGenMs += genMs;
        }
      }
    }
    const modelTrimmed = unwrapUsageModelSlug(log.model);
    if (modelTrimmed && modelTrimmed !== "unknown") {
      if (logLatestModelId === null) logLatestModelId = modelTrimmed;
      if (!logDistinctModels.includes(modelTrimmed)) {
        logDistinctModels.push(modelTrimmed);
      }
      logTokensByModel.set(
        modelTrimmed,
        (logTokensByModel.get(modelTrimmed) ?? 0) + nonNegInt(log.totalTokens),
      );
    }
  }

  // Child-thread logs for app-owned subagents belonging to THIS session
  let childThreadSubagentTokens = 0;
  const subagentChildSet = new Set(detail?.subagentChildThreadIds ?? []);
  if (subagentChildSet.size > 0) {
    for (const log of callLogs) {
      if (log.threadId && subagentChildSet.has(log.threadId)) {
        childThreadSubagentTokens += nonNegInt(log.totalTokens);
      }
    }
  }

  // Context window occupancy
  const contextUsedTokens =
    typeof contextWindow?.usedTokens === "number" &&
    Number.isFinite(contextWindow.usedTokens) &&
    contextWindow.usedTokens >= 0
      ? Math.round(contextWindow.usedTokens)
      : null;
  const contextMaxTokens =
    typeof contextWindow?.maxTokens === "number" &&
    Number.isFinite(contextWindow.maxTokens) &&
    contextWindow.maxTokens > 0
      ? Math.round(contextWindow.maxTokens)
      : null;
  const derivedContextPercent =
    contextUsedTokens !== null && contextMaxTokens !== null && contextMaxTokens > 0
      ? (contextUsedTokens / contextMaxTokens) * 100
      : null;
  const contextPercent = live?.contextPercent ?? derivedContextPercent;

  // Choose authoritative current-session token source (detail > threadLogs > live > contextWindow)
  const useDetailTokens =
    (detail?.sessionTotalTokens ?? 0) >= logTotalTokens && (detail?.sessionTotalTokens ?? 0) > 0;
  const contextWindowFallbackTotal = contextWindow
    ? Math.max(nonNegInt(contextWindow.totalProcessedTokens), nonNegInt(contextWindow.usedTokens))
    : 0;

  let uncachedInputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let reasoningOutputTokens = 0;
  let sessionTotalTokens = 0;
  let cacheHitRate: number | null = null;

  if (useDetailTokens && detail) {
    uncachedInputTokens = detail.uncachedInputTokens;
    cachedInputTokens = detail.cachedInputTokens;
    outputTokens = detail.outputTokens;
    reasoningOutputTokens = detail.reasoningOutputTokens;
    sessionTotalTokens = detail.sessionTotalTokens;
    cacheHitRate = detail.cacheHitRate;
  } else if (logTotalTokens > 0) {
    uncachedInputTokens = logUncached + logCacheCreate;
    cachedInputTokens = logCached;
    outputTokens = logOutput;
    reasoningOutputTokens = logReasoning;
    sessionTotalTokens = logTotalTokens;
    cacheHitRate = computeCacheHitRate(logUncached, logCached, logCacheCreate);
  } else if (live && Math.max(live.sessionTotalTokens, live.totalTokens) > 0) {
    uncachedInputTokens = live.inputTokens + live.cacheCreationTokens;
    cachedInputTokens = live.cachedInputTokens;
    outputTokens = live.outputTokens;
    reasoningOutputTokens = Math.min(live.outputTokens, nonNegInt(live.reasoningTokens));
    sessionTotalTokens = Math.max(live.sessionTotalTokens, live.totalTokens);
    cacheHitRate =
      live.cacheHitRate ??
      computeCacheHitRate(live.inputTokens, live.cachedInputTokens, live.cacheCreationTokens);
  } else if (contextWindowFallbackTotal > 0 && contextWindow) {
    const cached = nonNegInt(
      contextWindow.lastCachedInputTokens ?? contextWindow.cachedInputTokens,
    );
    const rawInput = nonNegInt(contextWindow.lastInputTokens ?? contextWindow.inputTokens);
    const uncached = Math.max(0, rawInput - cached);
    const output = nonNegInt(contextWindow.lastOutputTokens ?? contextWindow.outputTokens);
    const reasoning = Math.min(
      output,
      nonNegInt(contextWindow.lastReasoningOutputTokens ?? contextWindow.reasoningOutputTokens),
    );
    uncachedInputTokens = uncached;
    cachedInputTokens = cached;
    outputTokens = output;
    reasoningOutputTokens = reasoning;
    sessionTotalTokens = contextWindowFallbackTotal;
    cacheHitRate = computeCacheHitRate(uncached, cached, 0);
  }

  const textOutputTokens = Math.max(0, outputTokens - reasoningOutputTokens);

  // Speed (TPS) & TTFT — strictly active-session scoped
  const logAvgTtftMs = logTtftCount > 0 ? logTtftSum / logTtftCount : null;
  const avgTtftMs = detail?.avgTtftMs ?? logAvgTtftMs ?? live?.ttftMs ?? null;

  const logSessionTps =
    logTimedOutput > 0 && logTimedGenMs > 0
      ? logTimedOutput / (logTimedGenMs / 1_000)
      : logTpsCount > 0
        ? logTpsSum / logTpsCount
        : null;
  const latestRequestTps =
    (live?.active ? live.tps : null) ??
    detail?.latestRequestTps ??
    live?.tps ??
    logLatestTps ??
    null;
  const sessionTps = detail?.sessionTps ?? logSessionTps ?? latestRequestTps;
  const triggerTps = live?.active
    ? (live.tps ?? latestRequestTps ?? sessionTps)
    : (latestRequestTps ?? sessionTps);

  // Rounds, steps, samples, durations
  const samples = Math.max(
    detail?.samples ?? 0,
    threadLogs.length,
    sessionTotalTokens > 0 && (detail?.samples ?? 0) === 0 && threadLogs.length === 0 ? 1 : 0,
  );
  const rounds =
    detail && detail.rounds > 0 ? detail.rounds : samples > 0 ? Math.max(1, threadLogs.length) : 0;
  const steps = detail && detail.steps > 0 ? detail.steps : samples;
  const modelCallDurationMs =
    detail?.modelCallDurationMs ?? (logDurationSum > 0 ? logDurationSum : null);
  const toolCallDurationMs = detail?.toolCallDurationMs ?? null;

  // Subagents & aggregated task tokens
  const subagentCount = detail?.subagentCount ?? 0;
  const subagentTotalTokens = Math.max(detail?.subagentTotalTokens ?? 0, childThreadSubagentTokens);
  const aggregatedTaskTotalTokens = sessionTotalTokens + subagentTotalTokens;

  // Multi-model distribution (strictly current session)
  let modelDistribution: readonly SessionModelDistributionEntry[] = [];
  if (detail && detail.modelDistribution.length > 0) {
    modelDistribution = detail.modelDistribution;
  } else if (logTokensByModel.size > 0) {
    modelDistribution = buildModelDistribution(
      logTokensByModel,
      providerStatuses,
      live?.provider ?? selectedProvider,
    );
  } else if (sessionTotalTokens > 0) {
    const fallbackModelId =
      live?.model?.trim() && live.model.trim() !== "unknown"
        ? live.model.trim()
        : selectedModelId?.trim() || null;
    if (fallbackModelId) {
      modelDistribution = buildModelDistribution(
        new Map([[fallbackModelId, sessionTotalTokens]]),
        providerStatuses,
        live?.provider ?? selectedProvider,
      );
    }
  }

  const distinctSampledModelSet = new Set<string>();
  for (const m of detail?.distinctSampledModels ?? []) distinctSampledModelSet.add(m);
  for (const m of logDistinctModels) distinctSampledModelSet.add(m);
  for (const entry of modelDistribution) distinctSampledModelSet.add(entry.modelId);

  const sampledRawModelId =
    detail?.latestSampledModelId ??
    logLatestModelId ??
    (live?.model && live.model !== "unknown" ? unwrapUsageModelSlug(live.model) : null);
  const cleanedSelectedModelId = selectedModelId?.trim()
    ? unwrapUsageModelSlug(selectedModelId.trim())
    : null;
  const primaryEntrypointId = sampledRawModelId ?? cleanedSelectedModelId;
  const sampledModelDisplayName =
    detail?.latestSampledModelDisplayName ??
    (primaryEntrypointId
      ? resolveModelDisplayName(
          primaryEntrypointId,
          providerStatuses,
          live?.provider ?? selectedProvider,
        )
      : null);

  // Global Today / This Month reference ONLY for Popover 2 bottom section
  const { todayTokens: globalTodayTokens, monthTokens: globalMonthTokens } =
    resolveGlobalTodayAndMonthTokens({
      mergedUsage,
      todayDay,
      callLogs,
    });

  const detailBreakdownMatchesWindow =
    detail?.contextBreakdown !== undefined &&
    detail.contextBreakdown.usedTokens === contextUsedTokens &&
    detail.contextBreakdown.maxTokens === contextMaxTokens;
  const contextBreakdown = detailBreakdownMatchesWindow
    ? detail.contextBreakdown
    : deriveSessionContextBreakdown({
        activeContextWindow: contextWindow,
        compactionCountOverride: detail?.compactionCount,
      });

  return {
    tps: triggerTps,
    tpsScope: triggerTps !== null ? "session" : "none",
    ttftMs: avgTtftMs,
    totalTokens: sessionTotalTokens,
    tokensScope: sessionTotalTokens > 0 ? "session" : "none",
    cacheHitRate,
    contextPercent,
    contextUsedTokens,
    contextMaxTokens,
    contextTone: resolveContextRingTone(contextPercent),
    contextBarTone: resolveContextBarTone(contextPercent),
    active: live?.active === true,

    rounds,
    steps,
    samples,
    modelCallDurationMs,
    toolCallDurationMs,
    avgTtftMs,
    sessionTps,
    latestRequestTps,
    textOutputTokens,
    reasoningOutputTokens,

    uncachedInputTokens,
    cachedInputTokens,
    outputTokens,
    aggregatedTaskTotalTokens,
    subagentCount,
    subagentTotalTokens,
    modelDistribution,
    globalTodayTokens,
    globalMonthTokens,

    sampledModelDisplayName,
    primaryEntrypointId,
    distinctSampledModelCount: distinctSampledModelSet.size,
    hasMultipleSampledModels: distinctSampledModelSet.size >= 2,
    compactionCount: contextBreakdown.compactionCount,
    contextBreakdown,
  };
}

// ── Per-thread detail external store (bridges ChatView -> inline ChatComposer strip) ──

const publishedSessionDetails = new Map<string, SessionTelemetryDetailSnapshot>();
const sessionDetailOwners = new Map<string, number>();
const sessionDetailListeners = new Set<() => void>();

function notifySessionDetailListeners(): void {
  for (const listener of sessionDetailListeners) {
    listener();
  }
}

export function retainSessionTelemetryDetailOwner(threadId: string | null | undefined): () => void {
  if (!threadId) return () => {};
  sessionDetailOwners.set(threadId, (sessionDetailOwners.get(threadId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const nextCount = (sessionDetailOwners.get(threadId) ?? 1) - 1;
    if (nextCount > 0) {
      sessionDetailOwners.set(threadId, nextCount);
      return;
    }
    sessionDetailOwners.delete(threadId);
    if (publishedSessionDetails.delete(threadId)) {
      notifySessionDetailListeners();
    }
  };
}

export function publishSessionTelemetryDetail(
  threadId: string | null | undefined,
  detail: SessionTelemetryDetailSnapshot | null,
): void {
  if (!threadId) return;
  if (detail === null) {
    if (!publishedSessionDetails.has(threadId)) return;
    publishedSessionDetails.delete(threadId);
    notifySessionDetailListeners();
    return;
  }
  // Refresh LRU order (delete + re-insert moves entry to MRU tail) and enforce 50-entry cap (L10).
  if (publishedSessionDetails.has(threadId)) {
    publishedSessionDetails.delete(threadId);
  }
  publishedSessionDetails.set(threadId, detail);
  while (publishedSessionDetails.size > MAX_PUBLISHED_SESSION_DETAILS) {
    const oldestKey = publishedSessionDetails.keys().next().value;
    if (oldestKey === undefined) break;
    publishedSessionDetails.delete(oldestKey);
  }
  notifySessionDetailListeners();
}

export function deleteSessionTelemetryDetail(threadId: string | null | undefined): void {
  publishSessionTelemetryDetail(threadId, null);
}

export function getPublishedSessionDetailCount(): number {
  return publishedSessionDetails.size;
}

export function getSessionTelemetryDetail(
  threadId: string | null | undefined,
): SessionTelemetryDetailSnapshot | null {
  if (!threadId) return null;
  return publishedSessionDetails.get(threadId) ?? null;
}

export function clearSessionTelemetryDetails(): void {
  sessionDetailOwners.clear();
  if (publishedSessionDetails.size === 0) return;
  publishedSessionDetails.clear();
  notifySessionDetailListeners();
}

function subscribeSessionDetails(listener: () => void): () => void {
  sessionDetailListeners.add(listener);
  return () => {
    sessionDetailListeners.delete(listener);
  };
}

export function useSessionTelemetryDetail(
  threadId: string | null | undefined,
): SessionTelemetryDetailSnapshot | null {
  return useSyncExternalStore(
    subscribeSessionDetails,
    () => (threadId ? (publishedSessionDetails.get(threadId) ?? null) : null),
    () => null,
  );
}
