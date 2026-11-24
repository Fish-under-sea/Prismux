import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import type { ThreadStructure } from "@t3tools/client-runtime/state/models";
import type { OrchestrationV2ProviderTurn, ServerProvider } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { useEffect, useRef } from "react";

import {
  computeCacheHitRate,
  computeOutputTps,
  getRecordedUsageCallLogs,
  recordModelCallTelemetry,
  updateSessionLiveTelemetry,
  type UsageCallStatus,
} from "../usage/usageCallTelemetryStore";
import {
  deriveSessionTelemetryDetail,
  extractTurnUsageDetail,
  publishSessionTelemetryDetail,
  type SessionProjectionLike,
} from "./sessionTelemetry.logic";

const MIN_STREAMING_TPS_ELAPSED_MS = 200;

export interface ExtractedTurnTokens {
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly hasMeasuredTokens: boolean;
}

export interface DerivedProjectionTelemetry {
  readonly activeTurnId: string | null;
  readonly latestTurn: OrchestrationV2ProviderTurn | null;
  readonly assistantCharCount: number;
  readonly sessionTotalTokens: number;
  readonly latestTokens: ExtractedTurnTokens;
  readonly latestCacheHitRate: number | null;
  readonly latestTps: number | null;
  readonly contextPercent: number | null;
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

function nonNegInt(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * Extract normalized token counters from a provider turn without double-counting cached tokens.
 * Per `contracts/providerRuntime.ts`, `TurnTokenUsage.inputTokens` includes cache reads and writes.
 */
export function extractProviderTurnTokenCounts(
  turn: Pick<OrchestrationV2ProviderTurn, "turnTokenUsage" | "tokenUsage"> | null | undefined,
): ExtractedTurnTokens {
  if (!turn) {
    return {
      uncachedInputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      hasMeasuredTokens: false,
    };
  }

  const finalUsage = turn.turnTokenUsage;
  if (finalUsage && finalUsage.usageStatus !== "unavailable") {
    const cached = nonNegInt(finalUsage.cachedInputTokens);
    const cacheCreate = nonNegInt(finalUsage.cacheCreationTokens);
    const rawInput = nonNegInt(finalUsage.inputTokens);
    const uncached = Math.max(0, rawInput - cached - cacheCreate);
    const output = nonNegInt(finalUsage.outputTokens);
    const total = uncached + cached + cacheCreate + output;
    if (total > 0) {
      return {
        uncachedInputTokens: uncached,
        cachedInputTokens: cached,
        cacheCreationTokens: cacheCreate,
        outputTokens: output,
        totalTokens: total,
        hasMeasuredTokens: true,
      };
    }
  }

  const liveUsage = turn.tokenUsage;
  if (liveUsage) {
    const cached = nonNegInt(liveUsage.cachedInputTokens);
    const rawInput = nonNegInt(liveUsage.inputTokens);
    const uncached = Math.max(0, rawInput - cached);
    const output = nonNegInt(liveUsage.outputTokens);
    const total = Math.max(nonNegInt(liveUsage.usedTokens), uncached + cached + output);
    if (total > 0) {
      return {
        uncachedInputTokens: uncached,
        cachedInputTokens: cached,
        cacheCreationTokens: 0,
        outputTokens: output,
        totalTokens: total,
        hasMeasuredTokens: true,
      };
    }
  }

  return {
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    hasMeasuredTokens: false,
  };
}

function mapTurnStatusToCallStatus(
  status: OrchestrationV2ProviderTurn["status"],
): UsageCallStatus {
  switch (status) {
    case "running":
    case "pending":
      return "streaming";
    case "interrupted":
    case "cancelled":
      return "interrupted";
    case "failed":
      return "error";
    case "completed":
      return "completed";
  }
}

export function deriveContextOccupancyPercent(
  contextWindow: Pick<ContextWindowSnapshot, "usedTokens" | "maxTokens"> | null | undefined,
): number | null {
  if (!contextWindow) return null;
  const used = contextWindow.usedTokens;
  const max = contextWindow.maxTokens;
  if (
    typeof used !== "number" ||
    !Number.isFinite(used) ||
    used < 0 ||
    typeof max !== "number" ||
    !Number.isFinite(max) ||
    max <= 0
  ) {
    return null;
  }
  return (used / max) * 100;
}

function countStreamingOutputChars(
  serverProjection: Pick<ThreadStructure, "messages"> &
    Partial<Pick<ThreadStructure, "turnItems" | "visibleTurnItems">> | null,
): number {
  if (!serverProjection) return 0;
  let total = 0;
  for (const message of serverProjection.messages ?? []) {
    if (message.role === "assistant" && typeof message.text === "string") {
      total += message.text.length;
    }
  }
  // Also count streaming assistant_message & reasoning turn items so thinking-first models
  // (Antigravity / Claude / Codex) stamp `firstTokenAt` on the very first reasoning or text delta.
  const items =
    serverProjection.turnItems && serverProjection.turnItems.length > 0
      ? serverProjection.turnItems
      : (serverProjection.visibleTurnItems ?? []);
  for (const item of items) {
    const raw = item as unknown as Record<string, unknown>;
    if (raw.type !== "assistant_message" && raw.type !== "reasoning") continue;
    if (typeof raw.text === "string") total += raw.text.length;
    if (typeof raw.summary === "string") total += raw.summary.length;
    if (typeof raw.content === "string") total += raw.content.length;
    if (Array.isArray(raw.content)) {
      for (const part of raw.content) {
        if (typeof part === "string") total += part.length;
        else if (part && typeof part === "object") {
          const text = (part as Record<string, unknown>).text;
          if (typeof text === "string") total += text.length;
        }
      }
    }
  }
  return total;
}

function readExplicitTurnDurationMs(turn: OrchestrationV2ProviderTurn): number | null {
  const raw = (turn as unknown as { readonly durationMs?: unknown }).durationMs;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * Pure derivation of real session telemetry from `serverProjection` and `activeContextWindow`.
 * Never fabricates TTFT or TPS when underlying timestamps or output token counts are absent.
 */
export function deriveSessionTelemetryFromProjection(input: {
  readonly serverProjection:
    | (Pick<ThreadStructure, "providerTurns" | "messages"> &
        Partial<Pick<ThreadStructure, "turnItems" | "visibleTurnItems">>)
    | null;
  readonly activeContextWindow: ContextWindowSnapshot | null;
}): DerivedProjectionTelemetry {
  const { serverProjection, activeContextWindow } = input;
  const turns = serverProjection?.providerTurns ?? [];

  let activeTurnId: string | null = null;
  let latestTurn: OrchestrationV2ProviderTurn | null = null;
  let sessionTotalTokens = 0;
  let totalUncached = 0;
  let totalCached = 0;
  let totalCacheCreate = 0;
  let latestTps: number | null = null;

  for (const turn of turns) {
    latestTurn = turn;
    if (turn.status === "running" || turn.status === "pending") {
      activeTurnId = turn.id;
    }
    const counts = extractProviderTurnTokenCounts(turn);
    if (counts.hasMeasuredTokens) {
      sessionTotalTokens += counts.totalTokens;
      totalUncached += counts.uncachedInputTokens;
      totalCached += counts.cachedInputTokens;
      totalCacheCreate += counts.cacheCreationTokens;
    }
    if (
      turn.status !== "running" &&
      turn.status !== "pending" &&
      counts.outputTokens > 0
    ) {
      const startedMs = parseTelemetryTimestampMs(turn.startedAt);
      const completedMs = parseTelemetryTimestampMs(turn.completedAt);
      const durationMs =
        startedMs !== null && completedMs !== null && completedMs > startedMs
          ? completedMs - startedMs
          : readExplicitTurnDurationMs(turn);
      const computed = computeOutputTps(counts.outputTokens, durationMs, null);
      if (computed !== null) {
        latestTps = computed;
      }
    }
  }

  let latestTokens = extractProviderTurnTokenCounts(latestTurn);

  // Fallback to activeContextWindow when provider turns have not yet emitted per-turn usage.
  if (!latestTokens.hasMeasuredTokens && activeContextWindow) {
    const cached = nonNegInt(
      activeContextWindow.lastCachedInputTokens ?? activeContextWindow.cachedInputTokens,
    );
    const rawInput = nonNegInt(activeContextWindow.lastInputTokens ?? activeContextWindow.inputTokens);
    const uncached = Math.max(0, rawInput - cached);
    const output = nonNegInt(activeContextWindow.lastOutputTokens ?? activeContextWindow.outputTokens);
    const total = Math.max(nonNegInt(activeContextWindow.usedTokens), uncached + cached + output);
    if (total > 0) {
      latestTokens = {
        uncachedInputTokens: uncached,
        cachedInputTokens: cached,
        cacheCreationTokens: 0,
        outputTokens: output,
        totalTokens: total,
        hasMeasuredTokens: true,
      };
      sessionTotalTokens = Math.max(
        sessionTotalTokens,
        nonNegInt(activeContextWindow.totalProcessedTokens),
        total,
      );
      totalUncached = Math.max(totalUncached, uncached);
      totalCached = Math.max(totalCached, cached);
    }
    if (latestTps === null && output > 0 && activeContextWindow.durationMs) {
      latestTps = computeOutputTps(output, activeContextWindow.durationMs, null);
    }
  }

  const latestCacheHitRate =
    computeCacheHitRate(
      latestTokens.uncachedInputTokens,
      latestTokens.cachedInputTokens,
      latestTokens.cacheCreationTokens,
    ) ?? computeCacheHitRate(totalUncached, totalCached, totalCacheCreate);

  const assistantCharCount = countStreamingOutputChars(serverProjection);

  return {
    activeTurnId,
    latestTurn,
    assistantCharCount,
    sessionTotalTokens: Math.max(sessionTotalTokens, latestTokens.totalTokens),
    latestTokens,
    latestCacheHitRate,
    latestTps,
    contextPercent: deriveContextOccupancyPercent(activeContextWindow),
  };
}

interface ActiveTurnTimingTracker {
  key: string;
  turnStartedAt: number;
  firstTokenAt: number | null;
  baselineAssistantChars: number;
  baselineOutputTokens: number;
}

export interface UseSessionCallTelemetryInput {
  readonly threadId: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly serverProjection: SessionProjectionLike | null;
  readonly activeContextWindow: ContextWindowSnapshot | null;
  readonly providerStatuses?: readonly ServerProvider[] | undefined;
  readonly isWorking: boolean;
  readonly activeWorkStartedAt: unknown;
}

/**
 * Observes real local session streaming & turn completion in `ChatView` and writes measured
 * TTFT, output TPS, input/cached/cache-write/output tokens, and context % to
 * `usageCallTelemetryStore` (100% local telemetry, zero unofficial requests).
 */
export function useSessionCallTelemetry(input: UseSessionCallTelemetryInput): void {
  const {
    threadId,
    provider,
    model,
    serverProjection,
    activeContextWindow,
    providerStatuses,
    isWorking,
    activeWorkStartedAt,
  } = input;

  const activeTrackerRef = useRef<ActiveTurnTimingTracker | null>(null);
  const turnTimingsByIdRef = useRef<
    Map<string, { readonly turnStartedAt: number; readonly firstTokenAt: number | null }>
  >(new Map());
  const recordedTurnFingerprintsRef = useRef<Map<string, string>>(new Map());
  const lastLivePatchFingerprintRef = useRef<string | null>(null);
  const lastDetailFingerprintRef = useRef<string | null>(null);

  // Reset per-thread transient timing tracker when switching threads.
  useEffect(() => {
    activeTrackerRef.current = null;
    lastLivePatchFingerprintRef.current = null;
    lastDetailFingerprintRef.current = null;
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;

    const derived = deriveSessionTelemetryFromProjection({
      serverProjection: serverProjection
        ? {
            providerTurns: serverProjection.providerTurns ?? [],
            messages: serverProjection.messages ?? [],
            ...(serverProjection.turnItems !== undefined
              ? { turnItems: serverProjection.turnItems }
              : {}),
            ...(serverProjection.visibleTurnItems !== undefined
              ? { visibleTurnItems: serverProjection.visibleTurnItems }
              : {}),
          }
        : null,
      activeContextWindow,
    });
    const now = Date.now();
    const resolvedProvider = provider?.trim() || "unknown";
    const resolvedModel =
      derived.latestTurn?.model?.trim() || model?.trim() || "unknown";

    // Hydrate persisted per-turn timings from localStorage so switching threads or reloading
    // preserves measured TTFT & duration for turns in this session.
    const persistedByTurnId = new Map<
      string,
      { readonly timestamp: number; readonly ttftMs: number | null; readonly durationMs: number | null }
    >();
    for (const log of getRecordedUsageCallLogs()) {
      if (log.threadId !== threadId || !log.turnId) continue;
      if (!persistedByTurnId.has(log.turnId)) {
        persistedByTurnId.set(log.turnId, {
          timestamp: log.timestamp,
          ttftMs: log.ttftMs,
          durationMs: log.durationMs,
        });
      }
    }

    // 1. Track real turn start & exact first-token arrival while streaming.
    const activeTurnKey =
      derived.activeTurnId ?? (isWorking ? `active:${threadId}` : null);

    if (activeTurnKey !== null) {
      const currentTracker = activeTrackerRef.current;
      if (!currentTracker || currentTracker.key !== activeTurnKey) {
        const turnStartedAt =
          parseTelemetryTimestampMs(derived.latestTurn?.startedAt) ??
          parseTelemetryTimestampMs(activeWorkStartedAt) ??
          now;
        const nextTracker: ActiveTurnTimingTracker = {
          key: activeTurnKey,
          turnStartedAt,
          firstTokenAt: null,
          baselineAssistantChars: derived.assistantCharCount,
          baselineOutputTokens: derived.latestTokens.outputTokens,
        };
        activeTrackerRef.current = nextTracker;
        if (derived.activeTurnId) {
          turnTimingsByIdRef.current.set(derived.activeTurnId, {
            turnStartedAt,
            firstTokenAt: null,
          });
        }
      } else {
        const receivedNewText =
          derived.assistantCharCount > currentTracker.baselineAssistantChars;
        const receivedNewOutputTokens =
          derived.latestTokens.outputTokens > currentTracker.baselineOutputTokens &&
          derived.latestTokens.outputTokens > 0;
        if (currentTracker.firstTokenAt === null && (receivedNewText || receivedNewOutputTokens)) {
          currentTracker.firstTokenAt = Math.max(currentTracker.turnStartedAt, now);
          if (derived.activeTurnId) {
            turnTimingsByIdRef.current.set(derived.activeTurnId, {
              turnStartedAt: currentTracker.turnStartedAt,
              firstTokenAt: currentTracker.firstTokenAt,
            });
          }
        }
      }
    }

    // 2. Record finalized provider turns into persistent Call Logs (upsert on late token arrival).
    for (const turn of serverProjection?.providerTurns ?? []) {
      if (turn.status === "running" || turn.status === "pending") continue;
      const counts = extractTurnUsageDetail(turn);
      const observedTiming = turnTimingsByIdRef.current.get(turn.id);
      const persistedTiming = persistedByTurnId.get(turn.id);
      const startedMs =
        parseTelemetryTimestampMs(turn.startedAt) ??
        observedTiming?.turnStartedAt ??
        persistedTiming?.timestamp ??
        null;
      const completedMs =
        parseTelemetryTimestampMs(turn.completedAt) ??
        (activeTrackerRef.current?.key === turn.id ? now : null);
      const firstTokenAt =
        observedTiming?.firstTokenAt ??
        (startedMs !== null && persistedTiming?.ttftMs !== null && persistedTiming?.ttftMs !== undefined
          ? startedMs + persistedTiming.ttftMs
          : null);
      const ttftMs =
        startedMs !== null && firstTokenAt !== null && firstTokenAt >= startedMs
          ? firstTokenAt - startedMs
          : (persistedTiming?.ttftMs ?? null);
      const isLatestTurn = derived.latestTurn?.id === turn.id;
      const durationMs =
        startedMs !== null && completedMs !== null && completedMs > startedMs
          ? completedMs - startedMs
          : readExplicitTurnDurationMs(turn) ??
            (isLatestTurn &&
            typeof activeContextWindow?.durationMs === "number" &&
            Number.isFinite(activeContextWindow.durationMs) &&
            activeContextWindow.durationMs > 0
              ? activeContextWindow.durationMs
              : null) ??
            persistedTiming?.durationMs ??
            null;

      if (startedMs !== null && firstTokenAt !== null && !observedTiming?.firstTokenAt) {
        turnTimingsByIdRef.current.set(turn.id, {
          turnStartedAt: startedMs,
          firstTokenAt,
        });
      }

      // Only record turns that carry real tokens or real observed timing (zero fabricated records).
      if (!counts.hasMeasuredTokens && durationMs === null && ttftMs === null) {
        continue;
      }

      const fingerprint = [
        turn.status,
        counts.uncachedInputTokens,
        counts.cachedInputTokens,
        counts.cacheCreationTokens,
        counts.outputTokens,
        counts.reasoningTokens,
        ttftMs ?? "",
        durationMs ?? "",
      ].join("|");
      if (recordedTurnFingerprintsRef.current.get(turn.id) === fingerprint) {
        continue;
      }
      recordedTurnFingerprintsRef.current.set(turn.id, fingerprint);

      recordModelCallTelemetry({
        id: `turn:${turn.id}`,
        turnId: turn.id,
        threadId,
        provider: resolvedProvider,
        model: turn.model?.trim() || resolvedModel,
        timestamp: startedMs ?? completedMs ?? now,
        turnStartedAt: startedMs,
        firstTokenAt,
        completedAt: completedMs,
        ttftMs,
        durationMs,
        inputTokens: counts.uncachedInputTokens,
        cachedInputTokens: counts.cachedInputTokens,
        cacheCreationTokens: counts.cacheCreationTokens,
        outputTokens: counts.outputTokens,
        reasoningTokens: counts.reasoningTokens,
        totalTokens: counts.totalTokens,
        contextPercent: isLatestTurn ? derived.contextPercent : undefined,
        status: mapTurnStatusToCallStatus(turn.status),
      });
    }

    // Clear active tracker once working stops and no turn is running.
    if (activeTurnKey === null && activeTrackerRef.current !== null) {
      activeTrackerRef.current = null;
    }

    // 3. Publish live thread telemetry snapshot for the below-composer telemetry bar.
    const tracker = activeTrackerRef.current;
    const latestTurnTiming = derived.latestTurn
      ? turnTimingsByIdRef.current.get(derived.latestTurn.id)
      : undefined;
    const latestCompletedTtftMs =
      latestTurnTiming &&
      latestTurnTiming.firstTokenAt !== null &&
      latestTurnTiming.firstTokenAt >= latestTurnTiming.turnStartedAt
        ? latestTurnTiming.firstTokenAt - latestTurnTiming.turnStartedAt
        : null;
    const liveTtftMs =
      tracker && tracker.firstTokenAt !== null && tracker.firstTokenAt >= tracker.turnStartedAt
        ? tracker.firstTokenAt - tracker.turnStartedAt
        : latestCompletedTtftMs;
    const streamingElapsedMs = tracker ? Math.max(0, now - tracker.turnStartedAt) : null;
    const streamingTps =
      tracker &&
      derived.latestTokens.outputTokens > 0 &&
      streamingElapsedMs !== null &&
      streamingElapsedMs >= MIN_STREAMING_TPS_ELAPSED_MS
        ? computeOutputTps(derived.latestTokens.outputTokens, streamingElapsedMs, liveTtftMs)
        : null;
    let latestCompletedTps = derived.latestTps;
    if (
      streamingTps === null &&
      derived.latestTurn &&
      derived.latestTurn.status !== "running" &&
      derived.latestTurn.status !== "pending" &&
      derived.latestTokens.outputTokens > 0 &&
      latestCompletedTtftMs !== null
    ) {
      const startedMs =
        parseTelemetryTimestampMs(derived.latestTurn.startedAt) ??
        latestTurnTiming?.turnStartedAt ??
        null;
      const completedMs = parseTelemetryTimestampMs(derived.latestTurn.completedAt);
      const durationMs =
        startedMs !== null && completedMs !== null && completedMs >= startedMs
          ? completedMs - startedMs
          : null;
      latestCompletedTps =
        computeOutputTps(derived.latestTokens.outputTokens, durationMs, latestCompletedTtftMs) ??
        derived.latestTps;
    }
    const effectiveTps = streamingTps ?? latestCompletedTps;

    // 3. Publish full active-session telemetry detail for the 3 independent composer popovers.
    const detailSnapshot = deriveSessionTelemetryDetail({
      threadId,
      serverProjection,
      activeContextWindow,
      providerStatuses,
      activeProvider: resolvedProvider,
      activeModel: resolvedModel,
      turnTimingsById: turnTimingsByIdRef.current,
      activeLiveTps: streamingTps,
      activeLiveTtftMs: liveTtftMs,
      now,
    });
    const detailFingerprint = [
      detailSnapshot.threadId,
      detailSnapshot.rounds,
      detailSnapshot.steps,
      detailSnapshot.samples,
      detailSnapshot.modelCallDurationMs ?? "",
      detailSnapshot.toolCallDurationMs ?? "",
      detailSnapshot.avgTtftMs !== null ? detailSnapshot.avgTtftMs.toFixed(1) : "",
      detailSnapshot.sessionTps !== null ? detailSnapshot.sessionTps.toFixed(2) : "",
      detailSnapshot.latestRequestTps !== null ? detailSnapshot.latestRequestTps.toFixed(2) : "",
      detailSnapshot.textOutputTokens,
      detailSnapshot.reasoningOutputTokens,
      detailSnapshot.uncachedInputTokens,
      detailSnapshot.cachedInputTokens,
      detailSnapshot.outputTokens,
      detailSnapshot.sessionTotalTokens,
      detailSnapshot.subagentCount,
      detailSnapshot.subagentTotalTokens,
      detailSnapshot.modelDistribution.map((m) => `${m.modelId}:${m.totalTokens}`).join(","),
      detailSnapshot.latestSampledModelId ?? "",
      detailSnapshot.latestSampledModelDisplayName ?? "",
    ].join("|");
    if (lastDetailFingerprintRef.current !== detailFingerprint) {
      lastDetailFingerprintRef.current = detailFingerprint;
      publishSessionTelemetryDetail(threadId, detailSnapshot);
    }

    // 4. Publish live thread telemetry snapshot for the below-composer telemetry bar.
    const liveFingerprint = [
      threadId,
      resolvedProvider,
      resolvedModel,
      isWorking ? "1" : "0",
      tracker?.turnStartedAt ?? "",
      tracker?.firstTokenAt ?? "",
      liveTtftMs ?? "",
      effectiveTps !== null ? effectiveTps.toFixed(2) : "",
      derived.latestTokens.uncachedInputTokens,
      derived.latestTokens.cachedInputTokens,
      derived.latestTokens.cacheCreationTokens,
      derived.latestTokens.outputTokens,
      detailSnapshot.reasoningOutputTokens,
      derived.sessionTotalTokens,
      derived.latestCacheHitRate !== null ? derived.latestCacheHitRate.toFixed(4) : "",
      derived.contextPercent !== null ? derived.contextPercent.toFixed(2) : "",
    ].join("|");

    if (lastLivePatchFingerprintRef.current === liveFingerprint) {
      return;
    }
    lastLivePatchFingerprintRef.current = liveFingerprint;

    if (
      isWorking ||
      derived.sessionTotalTokens > 0 ||
      derived.contextPercent !== null ||
      effectiveTps !== null
    ) {
      updateSessionLiveTelemetry(threadId, {
        provider: resolvedProvider,
        model: resolvedModel,
        active: isWorking,
        ...(tracker !== null ? { turnStartedAt: tracker.turnStartedAt } : {}),
        ...(tracker !== null && tracker.firstTokenAt !== null
          ? { firstTokenAt: tracker.firstTokenAt }
          : {}),
        ...(liveTtftMs !== null ? { ttftMs: liveTtftMs } : {}),
        ...(effectiveTps !== null ? { tps: effectiveTps } : {}),
        inputTokens: derived.latestTokens.uncachedInputTokens,
        cachedInputTokens: derived.latestTokens.cachedInputTokens,
        cacheCreationTokens: derived.latestTokens.cacheCreationTokens,
        outputTokens: derived.latestTokens.outputTokens,
        reasoningTokens: detailSnapshot.reasoningOutputTokens,
        totalTokens: derived.latestTokens.totalTokens,
        sessionTotalTokens: derived.sessionTotalTokens,
        cacheHitRate: derived.latestCacheHitRate,
        contextPercent: derived.contextPercent,
      });
    }
  }, [
    activeContextWindow,
    activeWorkStartedAt,
    isWorking,
    model,
    provider,
    providerStatuses,
    serverProjection,
    threadId,
  ]);
}
