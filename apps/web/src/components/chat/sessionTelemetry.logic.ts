import type { ContextWindowSnapshot } from "@prismux/client-runtime/state/context-window";
import type { ThreadStructure } from "@prismux/client-runtime/state/models";
import type {
  OrchestrationV2ProviderTurn,
  ServerProvider,
} from "@prismux/core-contracts";
import type { MergedUsage } from "@prismux/core-shared/usageMerge";
import * as DateTime from "effect/DateTime";
import { useSyncExternalStore } from "react";

import {
  clampTtftToDuration,
  computeCacheHitRate,
  computeOutputTps,
  formatUsageModelDisplayName,
  unwrapUsageModelSlug,
  type SessionLiveTelemetrySnapshot,
  type UsageCallLogRecord,
} from "../usage/usageCallTelemetryStore";

export type TelemetryPopoverId = "stats" | "tokens" | "context";
export type ContextRingTone = "unknown" | "normal" | "warning" | "compact" | "overflow";
export type ContextBarTone = "unknown" | "normal" | "warning" | "critical";
export type TelemetryMetricScope = "session" | "none";

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

  // Popover 3: Context window (图 8)
  readonly sampledModelDisplayName: string | null;
  readonly primaryEntrypointId: string | null;
  readonly distinctSampledModelCount: number;
  readonly hasMultipleSampledModels: boolean;
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
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
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

/** Context occupancy bands: <60% normal, 60-94.9% warning, 95-100% compact, >100% overflow. */
export function resolveContextRingTone(
  contextPercent: number | null | undefined,
): ContextRingTone {
  if (
    typeof contextPercent !== "number" ||
    !Number.isFinite(contextPercent) ||
    contextPercent < 0
  ) {
    return "unknown";
  }
  if (contextPercent > 100) return "overflow";
  if (contextPercent >= 95) return "compact";
  if (contextPercent >= 60) return "warning";
  return "normal";
}

/**
 * Classifies the Popover 3 progress bar color:
 * - `< 60%`  → emerald green (`normal`)
 * - `60–89%` → amber (`warning`)
 * - `>= 90%` → red (`critical`)
 */
export function resolveContextBarTone(
  contextPercent: number | null | undefined,
): ContextBarTone {
  if (
    typeof contextPercent !== "number" ||
    !Number.isFinite(contextPercent) ||
    contextPercent < 0
  ) {
    return "unknown";
  }
  if (contextPercent >= 90) return "critical";
  if (contextPercent >= 60) return "warning";
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
    .filter(
      ([start, end]) =>
        Number.isFinite(start) && Number.isFinite(end) && end > start,
    )
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

export function sumIntervalMs(
  intervals: readonly (readonly [number, number])[],
): number {
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
  turn: Pick<OrchestrationV2ProviderTurn, "turnTokenUsage" | "tokenUsage" | "model"> | null | undefined,
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
  const rawToolDurationMs =
    sumIntervalMs(mergedToolIntervals) + workflowExtraDurationMs;
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
    const startedMs =
      parseTelemetryTimestampMs(turn.startedAt) ?? observed?.turnStartedAt ?? null;
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
    const ttftMs = clampTtftToDuration(
      extracted.ttftMs ?? observedTtftMs,
      clampedDurationBound,
    );

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

      const primaryModelRaw =
        extracted.reportedModels[0] ?? activeModel?.trim() ?? null;
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

    if (
      turn.status !== "running" &&
      turn.status !== "pending" &&
      extracted.outputTokens > 0
    ) {
      if (extracted.decodeMs !== null && extracted.decodeMs > 0) {
        const turnTps = extracted.outputTokens / (extracted.decodeMs / 1_000);
        if (Number.isFinite(turnTps) && turnTps > 0) {
          latestRequestTps = turnTps;
          tpsSum += turnTps;
          tpsSampleCount += 1;
          timedOutputSum += extracted.outputTokens;
          timedGenMsSum += extracted.decodeMs;
        }
      } else if (durationMs !== null && durationMs > 0) {
        const turnTps = computeOutputTps(extracted.outputTokens, durationMs, ttftMs);
        if (turnTps !== null) {
          latestRequestTps = turnTps;
          tpsSum += turnTps;
          tpsSampleCount += 1;
          const genMs = ttftMs !== null && durationMs > ttftMs ? durationMs - ttftMs : durationMs;
          if (genMs > 0) {
            timedOutputSum += extracted.outputTokens;
            timedGenMsSum += genMs;
          }
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
        activeContextWindow.lastReasoningOutputTokens ??
          activeContextWindow.reasoningOutputTokens,
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
    modelCallDurationMs = (netModelMs > 0 ? netModelMs : totalTurnWallMs) + turnExtraModelDurationMs;
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

  const effectiveSubagentCount =
    subagentCount > 0 ? subagentCount : turnsWithSubagents;
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
  const cacheHitRate = computeCacheHitRate(
    totalUncached,
    totalCached,
    totalCacheCreate,
  );
  const modelDistribution = buildModelDistribution(
    tokensByModel,
    providerStatuses,
    activeProvider,
  );

  const latestSampledModelDisplayName = latestSampledModelId
    ? resolveModelDisplayName(latestSampledModelId, providerStatuses, activeProvider)
    : null;

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
  readonly mergedUsage?:
    | Pick<MergedUsage, "totalTokens" | "daily">
    | null
    | undefined;
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
  const threadLogs =
    threadId !== null
      ? callLogs.filter((log) => log.threadId === threadId)
      : [];

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
  const useDetailTokens = (detail?.sessionTotalTokens ?? 0) >= logTotalTokens && (detail?.sessionTotalTokens ?? 0) > 0;
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
      nonNegInt(
        contextWindow.lastReasoningOutputTokens ?? contextWindow.reasoningOutputTokens,
      ),
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
    detail && detail.rounds > 0
      ? detail.rounds
      : samples > 0
        ? Math.max(1, threadLogs.length)
        : 0;
  const steps = detail && detail.steps > 0 ? detail.steps : samples;
  const modelCallDurationMs =
    detail?.modelCallDurationMs ?? (logDurationSum > 0 ? logDurationSum : null);
  const toolCallDurationMs = detail?.toolCallDurationMs ?? null;

  // Subagents & aggregated task tokens
  const subagentCount = detail?.subagentCount ?? 0;
  const subagentTotalTokens = Math.max(
    detail?.subagentTotalTokens ?? 0,
    childThreadSubagentTokens,
  );
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
  const cleanedSelectedModelId =
    selectedModelId?.trim() ? unwrapUsageModelSlug(selectedModelId.trim()) : null;
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
  };
}

// ── Per-thread detail external store (bridges ChatView -> inline ChatComposer strip) ──

const publishedSessionDetails = new Map<string, SessionTelemetryDetailSnapshot>();
const sessionDetailListeners = new Set<() => void>();

function notifySessionDetailListeners(): void {
  for (const listener of sessionDetailListeners) {
    listener();
  }
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
  publishedSessionDetails.set(threadId, detail);
  notifySessionDetailListeners();
}

export function getSessionTelemetryDetail(
  threadId: string | null | undefined,
): SessionTelemetryDetailSnapshot | null {
  if (!threadId) return null;
  return publishedSessionDetails.get(threadId) ?? null;
}

export function clearSessionTelemetryDetails(): void {
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
