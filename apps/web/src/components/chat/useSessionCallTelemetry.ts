import type { ContextWindowSnapshot } from "@prismux/client-runtime/state/context-window";
import type { ThreadStructure } from "@prismux/client-runtime/state/models";
import type { OrchestrationV2ProviderTurn, ServerProvider } from "@prismux/core-contracts";
import * as DateTime from "effect/DateTime";
import { useEffect, useRef } from "react";

import { resolveAgentBrandId } from "../../prismux/agentBrand";
import {
  clampTtftToDuration,
  computeCacheHitRate,
  computeOutputTps,
  formatUsageModelDisplayName,
  getRecordedUsageCallLogs,
  normalizeUsageProviderKey,
  recordModelCallTelemetry,
  unwrapUsageModelSlug,
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
    const cacheCreate = nonNegInt(liveUsage.cacheCreationTokens);
    const rawInput = nonNegInt(liveUsage.inputTokens);
    const uncached = Math.max(0, rawInput - cached - cacheCreate);
    const output = nonNegInt(liveUsage.outputTokens);
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
  const finalDuration =
    turn.turnTokenUsage && turn.turnTokenUsage.usageStatus !== "unavailable"
      ? turn.turnTokenUsage.modelDurationMs
      : undefined;
  const liveDuration = turn.tokenUsage?.durationMs;
  const legacyDuration = (turn as unknown as { readonly durationMs?: unknown }).durationMs;
  for (const candidate of [finalDuration, liveDuration, legacyDuration]) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return null;
}

/**
 * Resolves the canonical usage provider key (e.g. `"dsh"` instead of raw `"acpRegistry"` for
 * DeepSeek Harness instances) so live call logs merge and filter cleanly with backend `UsageService`.
 */
export function resolveTelemetryCanonicalProvider(input: {
  readonly provider?: string | null | undefined;
  readonly providerInstanceId?: string | null | undefined;
  readonly providerThreadId?: string | null | undefined;
  readonly serverProjection?: SessionProjectionLike | null | undefined;
  readonly providerStatuses?: readonly ServerProvider[] | undefined;
  readonly model?: string | null | undefined;
}): string {
  const providerThreads = input.serverProjection?.providerThreads ?? [];
  const matchedThread = input.providerThreadId
    ? providerThreads.find((t) => t.id === input.providerThreadId)
    : (providerThreads.find(
        (t) => t.id === input.serverProjection?.thread?.activeProviderThreadId,
      ) ?? providerThreads[0]);

  const candidateInstanceId =
    matchedThread?.providerInstanceId ??
    input.providerInstanceId ??
    input.serverProjection?.thread?.modelSelection?.instanceId ??
    null;
  const rawDriver = (matchedThread?.driver ?? input.provider ?? "").trim();

  let matchedStatus =
    candidateInstanceId && input.providerStatuses
      ? input.providerStatuses.find((status) => status.instanceId === candidateInstanceId)
      : undefined;

  if (!matchedStatus && rawDriver.toLowerCase() === "acpregistry" && input.providerStatuses) {
    const acpStatuses = input.providerStatuses.filter((status) => status.driver === "acpRegistry");
    const targetModel = input.model?.trim() ?? "";
    if (targetModel) {
      const targetLower = targetModel.toLowerCase();
      const targetUnwrapped = unwrapUsageModelSlug(targetModel).toLowerCase();
      matchedStatus = acpStatuses.find((status) =>
        status.models.some((m) => {
          const slugLower = m.slug.trim().toLowerCase();
          const slugUnwrapped = unwrapUsageModelSlug(m.slug).toLowerCase();
          return (
            slugLower === targetLower ||
            slugLower === targetUnwrapped ||
            slugUnwrapped === targetUnwrapped ||
            m.name.trim().toLowerCase() === targetLower
          );
        }),
      );
    }
    if (!matchedStatus && acpStatuses.length === 1) {
      matchedStatus = acpStatuses[0];
    }
  }

  if (
    resolveAgentBrandId(rawDriver) === "dsh" ||
    resolveAgentBrandId(candidateInstanceId) === "dsh" ||
    resolveAgentBrandId(matchedStatus?.instanceId) === "dsh" ||
    resolveAgentBrandId(matchedStatus?.displayName) === "dsh"
  ) {
    return "dsh";
  }

  return normalizeUsageProviderKey(rawDriver || "unknown");
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
      const extracted = extractTurnUsageDetail(turn);
      if (extracted.decodeMs !== null && extracted.decodeMs > 0) {
        const exactTps = counts.outputTokens / (extracted.decodeMs / 1_000);
        if (Number.isFinite(exactTps) && exactTps > 0) {
          latestTps = exactTps;
        }
      } else {
        const startedMs = parseTelemetryTimestampMs(turn.startedAt);
        const completedMs = parseTelemetryTimestampMs(turn.completedAt);
        const durationMs =
          startedMs !== null && completedMs !== null && completedMs > startedMs
            ? completedMs - startedMs
            : readExplicitTurnDurationMs(turn);
        const clampedTtftMs = clampTtftToDuration(extracted.ttftMs, durationMs);
        const computed = computeOutputTps(counts.outputTokens, durationMs, clampedTtftMs);
        if (computed !== null) {
          latestTps = computed;
        }
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
  readonly providerInstanceId?: string | null | undefined;
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
    providerInstanceId,
    model,
    serverProjection,
    activeContextWindow,
    providerStatuses,
    isWorking,
    activeWorkStartedAt,
  } = input;

  const activeTrackerRef = useRef<ActiveTurnTimingTracker | null>(null);
  const lastObservedThreadIdRef = useRef<string | null>(null);
  const turnTimingsByIdRef = useRef<
    Map<string, { readonly turnStartedAt: number; readonly firstTokenAt: number | null }>
  >(new Map());
  const recordedTurnFingerprintsRef = useRef<Map<string, string>>(new Map());
  const lastLivePatchFingerprintRef = useRef<string | null>(null);
  const lastDetailFingerprintRef = useRef<string | null>(null);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- syncs external localStorage call-telemetry store and per-turn timing refs with live server projection
  useEffect(() => {
    if (lastObservedThreadIdRef.current !== threadId) {
      lastObservedThreadIdRef.current = threadId;
      activeTrackerRef.current = null;
      lastLivePatchFingerprintRef.current = null;
      lastDetailFingerprintRef.current = null;
    }
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
    const rawSessionModel = derived.latestTurn?.model?.trim() || model?.trim() || "unknown";
    const resolvedProvider = resolveTelemetryCanonicalProvider({
      provider,
      providerInstanceId,
      providerThreadId: derived.latestTurn?.providerThreadId,
      serverProjection,
      providerStatuses,
      model: rawSessionModel,
    });
    const resolvedModel =
      rawSessionModel !== "unknown"
        ? formatUsageModelDisplayName(rawSessionModel, providerStatuses, resolvedProvider)
        : "unknown";
    const cleanedRawSessionModel =
      rawSessionModel !== "unknown" ? unwrapUsageModelSlug(rawSessionModel) : "unknown";

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
      const observedFirstTokenAt =
        observedTiming?.firstTokenAt ??
        (startedMs !== null && persistedTiming?.ttftMs !== null && persistedTiming?.ttftMs !== undefined
          ? startedMs + persistedTiming.ttftMs
          : null);
      const isLatestTurn = derived.latestTurn?.id === turn.id;
      const wallDurationMs =
        startedMs !== null && completedMs !== null && completedMs > startedMs
          ? completedMs - startedMs
          : null;
      const durationMs =
        (counts.modelDurationMs !== null && counts.modelDurationMs > 0
          ? counts.modelDurationMs
          : null) ??
        wallDurationMs ??
        readExplicitTurnDurationMs(turn) ??
        (isLatestTurn &&
        typeof activeContextWindow?.durationMs === "number" &&
        Number.isFinite(activeContextWindow.durationMs) &&
        activeContextWindow.durationMs > 0
          ? activeContextWindow.durationMs
          : null) ??
        persistedTiming?.durationMs ??
        null;
      const observedTtftMs =
        startedMs !== null && observedFirstTokenAt !== null && observedFirstTokenAt >= startedMs
          ? observedFirstTokenAt - startedMs
          : (persistedTiming?.ttftMs ?? null);
      // Authoritative server-reported TTFT takes precedence over noisy client WS arrival time,
      // and physical invariant `ttftMs <= durationMs` is strictly enforced.
      const ttftMs = clampTtftToDuration(counts.ttftMs ?? observedTtftMs, durationMs);
      const firstTokenAt =
        startedMs !== null && ttftMs !== null ? startedMs + ttftMs : observedFirstTokenAt;

      if (startedMs !== null && firstTokenAt !== null && !observedTiming?.firstTokenAt) {
        turnTimingsByIdRef.current.set(turn.id, {
          turnStartedAt: startedMs,
          firstTokenAt,
        });
      }

      // Only record turns that carry real tokens or real observed timing (zero fabricated records).
      if (
        !counts.hasMeasuredTokens &&
        durationMs === null &&
        ttftMs === null &&
        counts.decodeMs === null
      ) {
        continue;
      }

      const turnProvider = resolveTelemetryCanonicalProvider({
        provider,
        providerInstanceId,
        providerThreadId: turn.providerThreadId,
        serverProjection,
        providerStatuses,
        model: turn.model ?? rawSessionModel,
      });
      const rawTurnModel = turn.model?.trim() || rawSessionModel;
      const formattedTurnModel =
        rawTurnModel && rawTurnModel !== "unknown"
          ? formatUsageModelDisplayName(rawTurnModel, providerStatuses, turnProvider)
          : "unknown";
      const exactDecodeTps =
        counts.outputTokens > 0 && counts.decodeMs !== null && counts.decodeMs > 0
          ? counts.outputTokens / (counts.decodeMs / 1_000)
          : null;
      const turnTps =
        exactDecodeTps !== null && Number.isFinite(exactDecodeTps) && exactDecodeTps > 0
          ? exactDecodeTps
          : computeOutputTps(counts.outputTokens, durationMs, ttftMs);

      const fingerprint = [
        turn.status,
        turnProvider,
        formattedTurnModel,
        counts.uncachedInputTokens,
        counts.cachedInputTokens,
        counts.cacheCreationTokens,
        counts.outputTokens,
        counts.reasoningTokens,
        ttftMs ?? "",
        counts.decodeMs ?? "",
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
        provider: turnProvider,
        model: formattedTurnModel,
        timestamp: startedMs ?? completedMs ?? now,
        turnStartedAt: startedMs,
        firstTokenAt,
        completedAt: completedMs,
        ttftMs,
        decodeMs: counts.decodeMs,
        durationMs,
        tps: turnTps,
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
    const latestTurnExtracted = extractTurnUsageDetail(derived.latestTurn);
    const latestTurnTiming = derived.latestTurn
      ? turnTimingsByIdRef.current.get(derived.latestTurn.id)
      : undefined;
    const latestTurnStartedMs = derived.latestTurn
      ? (parseTelemetryTimestampMs(derived.latestTurn.startedAt) ??
        latestTurnTiming?.turnStartedAt ??
        null)
      : null;
    const latestTurnCompletedMs = derived.latestTurn
      ? parseTelemetryTimestampMs(derived.latestTurn.completedAt)
      : null;
    const latestTurnDurationMs =
      (latestTurnExtracted.modelDurationMs !== null && latestTurnExtracted.modelDurationMs > 0
        ? latestTurnExtracted.modelDurationMs
        : null) ??
      (latestTurnStartedMs !== null &&
      latestTurnCompletedMs !== null &&
      latestTurnCompletedMs >= latestTurnStartedMs
        ? latestTurnCompletedMs - latestTurnStartedMs
        : null);
    const observedCompletedTtftMs =
      latestTurnTiming &&
      latestTurnTiming.firstTokenAt !== null &&
      latestTurnTiming.firstTokenAt >= latestTurnTiming.turnStartedAt
        ? latestTurnTiming.firstTokenAt - latestTurnTiming.turnStartedAt
        : null;
    const latestCompletedTtftMs = clampTtftToDuration(
      latestTurnExtracted.ttftMs ?? observedCompletedTtftMs,
      latestTurnDurationMs,
    );
    const liveTtftMs =
      tracker !== null
        ? (latestTurnExtracted.ttftMs ??
          (tracker.firstTokenAt !== null && tracker.firstTokenAt >= tracker.turnStartedAt
            ? tracker.firstTokenAt - tracker.turnStartedAt
            : null))
        : latestCompletedTtftMs;
    const streamingElapsedMs = tracker ? Math.max(0, now - tracker.turnStartedAt) : null;
    const exactStreamingDecodeTps =
      tracker !== null &&
      derived.latestTokens.outputTokens > 0 &&
      latestTurnExtracted.decodeMs !== null &&
      latestTurnExtracted.decodeMs > 0
        ? derived.latestTokens.outputTokens / (latestTurnExtracted.decodeMs / 1_000)
        : null;
    const streamingTps =
      exactStreamingDecodeTps !== null &&
      Number.isFinite(exactStreamingDecodeTps) &&
      exactStreamingDecodeTps > 0
        ? exactStreamingDecodeTps
        : tracker &&
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
      derived.latestTokens.outputTokens > 0
    ) {
      if (latestTurnExtracted.decodeMs !== null && latestTurnExtracted.decodeMs > 0) {
        const exactTps = derived.latestTokens.outputTokens / (latestTurnExtracted.decodeMs / 1_000);
        if (Number.isFinite(exactTps) && exactTps > 0) {
          latestCompletedTps = exactTps;
        }
      } else if (latestCompletedTtftMs !== null) {
        latestCompletedTps =
          computeOutputTps(
            derived.latestTokens.outputTokens,
            latestTurnDurationMs,
            latestCompletedTtftMs,
          ) ?? derived.latestTps;
      }
    }
    const effectiveTps = streamingTps ?? latestCompletedTps;

    // 3. Publish full active-session telemetry detail for the 3 independent composer popovers.
    const detailSnapshot = deriveSessionTelemetryDetail({
      threadId,
      serverProjection,
      activeContextWindow,
      providerStatuses,
      activeProvider: resolvedProvider,
      activeModel: cleanedRawSessionModel,
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
    providerInstanceId,
    providerStatuses,
    serverProjection,
    threadId,
  ]);
}
