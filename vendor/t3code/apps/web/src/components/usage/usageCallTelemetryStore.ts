import { useMemo, useSyncExternalStore } from "react";

export const MAX_USAGE_CALL_LOGS = 500;
export const USAGE_CALL_TELEMETRY_STORAGE_KEY = "prismux.usage.callTelemetry.v1";

export type UsageCallStatus = "completed" | "streaming" | "interrupted" | "error";

export interface UsageCallLogRecord {
  readonly id: string;
  /** Epoch milliseconds when the model call started (or completed when transcript has a single timestamp). */
  readonly timestamp: number;
  readonly provider: string;
  readonly model: string;
  readonly threadId?: string | undefined;
  readonly turnId?: string | undefined;
  /** Real time-to-first-token in milliseconds, or null when unavailable. */
  readonly ttftMs: number | null;
  /** Real total call duration in milliseconds, or null when unavailable. */
  readonly durationMs: number | null;
  /** Real output generation throughput in tokens/second, or null when unavailable. */
  readonly tps: number | null;
  /** Uncached prompt input tokens. */
  readonly inputTokens: number;
  /** Cached prompt read tokens. */
  readonly cachedInputTokens: number;
  /** Prompt cache creation / write tokens. */
  readonly cacheCreationTokens: number;
  /** Generated output tokens. */
  readonly outputTokens: number;
  /** Total processed tokens for this call. */
  readonly totalTokens: number;
  /** Actual cache hit rate in [0, 1], or null when no input tokens were processed. */
  readonly cacheHitRate: number | null;
  /** Optional context occupancy percentage (0..100+), or null when unknown. */
  readonly contextPercent?: number | null | undefined;
  readonly status: UsageCallStatus;
  readonly source: "live" | "backend";
}

/** Shape compatible with Spec 4B backend `callLogs` entries from UsageService. */
export interface BackendUsageCallLogLike {
  readonly id: string;
  readonly timestamp: number | string;
  readonly provider: string;
  readonly model: string;
  readonly threadId?: string | null | undefined;
  readonly turnId?: string | null | undefined;
  readonly ttftMs?: number | null | undefined;
  readonly durationMs?: number | null | undefined;
  readonly tps?: number | null | undefined;
  readonly inputTokens?: number | null | undefined;
  readonly uncachedInputTokens?: number | null | undefined;
  readonly cachedInputTokens?: number | null | undefined;
  readonly cacheCreationTokens?: number | null | undefined;
  readonly cacheWriteTokens?: number | null | undefined;
  readonly outputTokens?: number | null | undefined;
  readonly totalTokens?: number | null | undefined;
  readonly cacheHitRate?: number | null | undefined;
  readonly status?: UsageCallStatus | string | undefined;
}

export interface RecordModelCallTelemetryInput {
  readonly id?: string | undefined;
  readonly timestamp?: number | undefined;
  readonly provider: string;
  readonly model: string;
  readonly threadId?: string | undefined;
  readonly turnId?: string | undefined;
  readonly turnStartedAt?: number | null | undefined;
  readonly firstTokenAt?: number | null | undefined;
  readonly completedAt?: number | null | undefined;
  readonly ttftMs?: number | null | undefined;
  readonly durationMs?: number | null | undefined;
  readonly tps?: number | null | undefined;
  readonly inputTokens?: number | undefined;
  readonly cachedInputTokens?: number | undefined;
  readonly cacheCreationTokens?: number | undefined;
  /** Alias accepted for convenience alongside `cacheCreationTokens`. */
  readonly cacheWriteTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly totalTokens?: number | undefined;
  readonly cacheHitRate?: number | null | undefined;
  readonly contextPercent?: number | null | undefined;
  readonly status?: UsageCallStatus | undefined;
}

export interface SessionLiveTelemetrySnapshot {
  readonly threadId: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly active: boolean;
  readonly turnStartedAt: number | null;
  readonly firstTokenAt: number | null;
  readonly ttftMs: number | null;
  readonly tps: number | null;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  /** Real cumulative tokens in this thread across recorded turns plus active in-flight turn. */
  readonly sessionTotalTokens: number;
  /** Actual cache hit rate in [0, 1] across this turn/session, or null when unmeasured. */
  readonly cacheHitRate: number | null;
  /** Context occupancy percentage (0..100+, may exceed 100), or null when unknown. */
  readonly contextPercent: number | null;
  readonly updatedAt: number;
}

export interface SessionLiveTelemetryPatch {
  readonly provider?: string | null | undefined;
  readonly model?: string | null | undefined;
  readonly active?: boolean | undefined;
  readonly turnStartedAt?: number | null | undefined;
  readonly firstTokenAt?: number | null | undefined;
  readonly ttftMs?: number | null | undefined;
  readonly tps?: number | null | undefined;
  readonly inputTokens?: number | undefined;
  readonly cachedInputTokens?: number | undefined;
  readonly cacheCreationTokens?: number | undefined;
  readonly cacheWriteTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly totalTokens?: number | undefined;
  readonly sessionTotalTokens?: number | undefined;
  readonly cacheHitRate?: number | null | undefined;
  readonly contextPercent?: number | null | undefined;
}

export interface UsageCallSummaryMetrics {
  readonly callCount: number;
  readonly ttftSampleCount: number;
  readonly avgTtftMs: number | null;
  readonly tpsSampleCount: number;
  readonly avgTps: number | null;
  readonly totalInputTokens: number;
  readonly totalCachedInputTokens: number;
  readonly totalCacheCreationTokens: number;
  readonly totalOutputTokens: number;
  readonly cacheHitRate: number | null;
}

function nonNegativeFinite(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

function positiveOrZeroNullable(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function positiveNullable(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function normalizeCacheHitRateValue(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  // Support both 0..1 ratio (canonical) and accidental 0..100 percentage inputs cleanly.
  if (value > 1 && value <= 100) return Math.min(1, value / 100);
  return Math.min(1, value);
}

/**
 * Compute real cache hit rate in `[0, 1]`, or `null` when no input tokens were processed.
 * Cache writes count as misses because full input processing occurred.
 */
export function computeCacheHitRate(
  uncachedInputTokens: number,
  cachedInputTokens: number,
  cacheCreationTokens = 0,
): number | null {
  const uncached = nonNegativeFinite(uncachedInputTokens);
  const cached = nonNegativeFinite(cachedInputTokens);
  const write = nonNegativeFinite(cacheCreationTokens);
  const totalInput = uncached + cached + write;
  if (totalInput <= 0) return null;
  return Math.min(1, Math.max(0, cached / totalInput));
}

/**
 * Compute real output generation throughput (`tok/s`), or `null` when real timing or output
 * token count is missing. Uses post-TTFT generation window when `durationMs > ttftMs`.
 */
export function computeOutputTps(
  outputTokens: number,
  durationMs: number | null | undefined,
  ttftMs?: number | null | undefined,
): number | null {
  const out = nonNegativeFinite(outputTokens);
  const dur = positiveNullable(durationMs);
  if (out <= 0 || dur === null) return null;
  const ttft = positiveOrZeroNullable(ttftMs);
  const genMs = ttft !== null && dur > ttft ? dur - ttft : dur;
  if (genMs <= 0) return null;
  return out / (genMs / 1000);
}

export function formatTtft(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)} s`;
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)} s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

export function formatTps(tps: number | null | undefined): string {
  if (typeof tps !== "number" || !Number.isFinite(tps) || tps <= 0) return "—";
  const rounded = tps >= 100 ? Math.round(tps).toString() : tps.toFixed(1);
  return `${rounded} tok/s`;
}

export function formatCacheHitRate(rate: number | null | undefined): string {
  const normalized = normalizeCacheHitRateValue(rate);
  if (normalized === null) return "—";
  const pct = normalized * 100;
  if (pct === 0) return "0%";
  if (pct >= 99.95) return "100%";
  return `${pct >= 10 ? pct.toFixed(1) : pct.toFixed(1)}%`;
}

function normalizeStatus(status: string | undefined): UsageCallStatus {
  if (
    status === "completed" ||
    status === "streaming" ||
    status === "interrupted" ||
    status === "error"
  ) {
    return status;
  }
  return "completed";
}

/**
 * Normalize runtime provider driver ids (e.g. `claudeAgent`) to canonical `UsageProviderKind`
 * keys (`claude`, `codex`, `antigravity`, etc.) so live telemetry and backend transcript
 * `callLogs` deduplicate and share provider filters cleanly.
 */
export function normalizeUsageProviderKey(provider: string | null | undefined): string {
  const trimmed = (provider ?? "").trim();
  if (!trimmed) return "unknown";
  const lowered = trimmed.toLowerCase();
  if (lowered === "claudeagent" || lowered === "claude-agent" || lowered === "claude_agent") {
    return "claude";
  }
  return trimmed;
}

function parseTimestampMs(raw: number | string | undefined, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function isValidPersistedRecord(value: unknown): value is UsageCallLogRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    r.id.length > 0 &&
    typeof r.timestamp === "number" &&
    Number.isFinite(r.timestamp) &&
    typeof r.provider === "string" &&
    typeof r.model === "string"
  );
}

interface TelemetryStoreState {
  logs: readonly UsageCallLogRecord[];
  liveByThread: Readonly<Record<string, SessionLiveTelemetrySnapshot>>;
}

let hydrated = false;
let seqCounter = 0;
let state: TelemetryStoreState = {
  logs: [],
  liveByThread: {},
};
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function loadFromStorage(): readonly UsageCallLogRecord[] {
  if (typeof globalThis.localStorage === "undefined") return [];
  try {
    const raw = globalThis.localStorage.getItem(USAGE_CALL_TELEMETRY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const valid: UsageCallLogRecord[] = [];
    for (const item of parsed) {
      if (!isValidPersistedRecord(item)) continue;
      valid.push({
        id: item.id,
        timestamp: item.timestamp,
        provider: item.provider,
        model: item.model,
        threadId: typeof item.threadId === "string" ? item.threadId : undefined,
        turnId: typeof item.turnId === "string" ? item.turnId : undefined,
        ttftMs: positiveOrZeroNullable(item.ttftMs),
        durationMs: positiveOrZeroNullable(item.durationMs),
        tps: positiveNullable(item.tps),
        inputTokens: nonNegativeFinite(item.inputTokens),
        cachedInputTokens: nonNegativeFinite(item.cachedInputTokens),
        cacheCreationTokens: nonNegativeFinite(item.cacheCreationTokens),
        outputTokens: nonNegativeFinite(item.outputTokens),
        totalTokens: nonNegativeFinite(item.totalTokens),
        cacheHitRate: normalizeCacheHitRateValue(item.cacheHitRate),
        contextPercent:
          typeof item.contextPercent === "number" && Number.isFinite(item.contextPercent)
            ? item.contextPercent
            : undefined,
        status: normalizeStatus(item.status),
        source: item.source === "backend" ? "backend" : "live",
      });
      if (valid.length >= MAX_USAGE_CALL_LOGS) break;
    }
    return valid;
  } catch {
    return [];
  }
}

function persistLogs(logs: readonly UsageCallLogRecord[]): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    globalThis.localStorage.setItem(
      USAGE_CALL_TELEMETRY_STORAGE_KEY,
      JSON.stringify(logs.slice(0, MAX_USAGE_CALL_LOGS)),
    );
  } catch {
    // Ignore storage quota or private browsing errors gracefully.
  }
}

function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  const loaded = loadFromStorage();
  if (loaded.length > 0) {
    state = { ...state, logs: loaded };
  }
}

function subscribeTelemetry(listener: () => void): () => void {
  ensureHydrated();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getTelemetryState(): TelemetryStoreState {
  ensureHydrated();
  return state;
}

const SERVER_EMPTY_LOGS: readonly UsageCallLogRecord[] = [];
const SERVER_EMPTY_LIVE: SessionLiveTelemetrySnapshot | null = null;

function sumThreadTokens(logs: readonly UsageCallLogRecord[], threadId: string): number {
  let total = 0;
  for (const log of logs) {
    if (log.threadId === threadId) {
      total += log.totalTokens;
    }
  }
  return total;
}

/**
 * Record (or upsert by `id` / `turnId`) a real model call telemetry entry into the
 * bounded 500-entry persistent store and refresh the thread's live telemetry snapshot.
 */
export function recordModelCallTelemetry(
  input: RecordModelCallTelemetryInput,
): UsageCallLogRecord {
  ensureHydrated();
  const now = Date.now();
  const turnStartedAt = positiveNullable(input.turnStartedAt);
  const firstTokenAt = positiveNullable(input.firstTokenAt);
  const completedAt = positiveNullable(input.completedAt);

  const timestamp =
    positiveNullable(input.timestamp) ?? turnStartedAt ?? completedAt ?? now;

  const derivedTtftMs =
    input.ttftMs !== undefined
      ? positiveOrZeroNullable(input.ttftMs)
      : turnStartedAt !== null && firstTokenAt !== null && firstTokenAt >= turnStartedAt
        ? firstTokenAt - turnStartedAt
        : null;

  const derivedDurationMs =
    input.durationMs !== undefined
      ? positiveOrZeroNullable(input.durationMs)
      : turnStartedAt !== null && completedAt !== null && completedAt >= turnStartedAt
        ? completedAt - turnStartedAt
        : null;

  const inputTokens = nonNegativeFinite(input.inputTokens);
  const cachedInputTokens = nonNegativeFinite(input.cachedInputTokens);
  const cacheCreationTokens = nonNegativeFinite(
    input.cacheCreationTokens ?? input.cacheWriteTokens,
  );
  const outputTokens = nonNegativeFinite(input.outputTokens);
  const computedTotal = inputTokens + cachedInputTokens + cacheCreationTokens + outputTokens;
  const totalTokens = Math.max(nonNegativeFinite(input.totalTokens), computedTotal);

  const derivedTps =
    input.tps !== undefined
      ? positiveNullable(input.tps)
      : computeOutputTps(outputTokens, derivedDurationMs, derivedTtftMs);

  const derivedCacheHitRate =
    input.cacheHitRate !== undefined
      ? normalizeCacheHitRateValue(input.cacheHitRate)
      : computeCacheHitRate(inputTokens, cachedInputTokens, cacheCreationTokens);

  const resolvedId =
    input.id?.trim() ||
    (input.turnId ? `turn:${input.turnId}` : `call:${timestamp}:${++seqCounter}`);

  const record: UsageCallLogRecord = {
    id: resolvedId,
    timestamp,
    provider: normalizeUsageProviderKey(input.provider),
    model: input.model.trim() || "unknown",
    threadId: input.threadId,
    turnId: input.turnId,
    ttftMs: derivedTtftMs,
    durationMs: derivedDurationMs,
    tps: derivedTps,
    inputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    totalTokens,
    cacheHitRate: derivedCacheHitRate,
    contextPercent:
      typeof input.contextPercent === "number" && Number.isFinite(input.contextPercent)
        ? input.contextPercent
        : undefined,
    status: normalizeStatus(input.status),
    source: "live",
  };

  const withoutExisting = state.logs.filter((entry) => entry.id !== record.id);
  const nextLogs = [record, ...withoutExisting]
    .toSorted((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_USAGE_CALL_LOGS);

  let nextLiveByThread = state.liveByThread;
  if (record.threadId) {
    const prev = state.liveByThread[record.threadId];
    const threadTotal = sumThreadTokens(nextLogs, record.threadId);
    nextLiveByThread = {
      ...state.liveByThread,
      [record.threadId]: {
        threadId: record.threadId,
        provider: record.provider,
        model: record.model,
        active: record.status === "streaming",
        turnStartedAt: turnStartedAt ?? prev?.turnStartedAt ?? timestamp,
        firstTokenAt: firstTokenAt ?? prev?.firstTokenAt ?? null,
        ttftMs: record.ttftMs ?? prev?.ttftMs ?? null,
        tps: record.tps ?? prev?.tps ?? null,
        inputTokens: record.inputTokens,
        cachedInputTokens: record.cachedInputTokens,
        cacheCreationTokens: record.cacheCreationTokens,
        outputTokens: record.outputTokens,
        totalTokens: record.totalTokens,
        sessionTotalTokens: Math.max(threadTotal, record.totalTokens),
        cacheHitRate: record.cacheHitRate ?? prev?.cacheHitRate ?? null,
        contextPercent:
          record.contextPercent !== undefined
            ? (record.contextPercent ?? null)
            : (prev?.contextPercent ?? null),
        updatedAt: now,
      },
    };
  }

  state = {
    logs: nextLogs,
    liveByThread: nextLiveByThread,
  };
  persistLogs(nextLogs);
  notifyListeners();
  return record;
}

/**
 * Update in-flight live telemetry for a chat thread (TTFT, streaming TPS, live token counters,
 * context %) without creating duplicate persisted call log rows on every chunk.
 */
export function updateSessionLiveTelemetry(
  threadId: string,
  patch: SessionLiveTelemetryPatch,
): SessionLiveTelemetrySnapshot {
  ensureHydrated();
  const now = Date.now();
  const prev = state.liveByThread[threadId];

  const turnStartedAt =
    patch.turnStartedAt !== undefined ? patch.turnStartedAt : (prev?.turnStartedAt ?? null);
  const firstTokenAt =
    patch.firstTokenAt !== undefined ? patch.firstTokenAt : (prev?.firstTokenAt ?? null);

  const inputTokens =
    patch.inputTokens !== undefined ? nonNegativeFinite(patch.inputTokens) : (prev?.inputTokens ?? 0);
  const cachedInputTokens =
    patch.cachedInputTokens !== undefined
      ? nonNegativeFinite(patch.cachedInputTokens)
      : (prev?.cachedInputTokens ?? 0);
  const cacheCreationTokens =
    patch.cacheCreationTokens !== undefined || patch.cacheWriteTokens !== undefined
      ? nonNegativeFinite(patch.cacheCreationTokens ?? patch.cacheWriteTokens)
      : (prev?.cacheCreationTokens ?? 0);
  const outputTokens =
    patch.outputTokens !== undefined
      ? nonNegativeFinite(patch.outputTokens)
      : (prev?.outputTokens ?? 0);

  const computedTurnTotal = inputTokens + cachedInputTokens + cacheCreationTokens + outputTokens;
  const totalTokens =
    patch.totalTokens !== undefined
      ? Math.max(nonNegativeFinite(patch.totalTokens), computedTurnTotal)
      : Math.max(prev?.totalTokens ?? 0, computedTurnTotal);

  const ttftMs =
    patch.ttftMs !== undefined
      ? positiveOrZeroNullable(patch.ttftMs)
      : turnStartedAt !== null && firstTokenAt !== null && firstTokenAt >= turnStartedAt
        ? firstTokenAt - turnStartedAt
        : (prev?.ttftMs ?? null);

  const tps =
    patch.tps !== undefined ? positiveNullable(patch.tps) : (prev?.tps ?? null);

  const cacheHitRate =
    patch.cacheHitRate !== undefined
      ? normalizeCacheHitRateValue(patch.cacheHitRate)
      : (computeCacheHitRate(inputTokens, cachedInputTokens, cacheCreationTokens) ??
        prev?.cacheHitRate ??
        null);

  const recordedThreadTotal = sumThreadTokens(state.logs, threadId);
  const sessionTotalTokens =
    patch.sessionTotalTokens !== undefined
      ? nonNegativeFinite(patch.sessionTotalTokens)
      : Math.max(recordedThreadTotal, totalTokens, prev?.sessionTotalTokens ?? 0);

  const nextSnapshot: SessionLiveTelemetrySnapshot = {
    threadId,
    provider: patch.provider !== undefined ? patch.provider : (prev?.provider ?? null),
    model: patch.model !== undefined ? patch.model : (prev?.model ?? null),
    active: patch.active !== undefined ? patch.active : (prev?.active ?? false),
    turnStartedAt,
    firstTokenAt,
    ttftMs,
    tps,
    inputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    totalTokens,
    sessionTotalTokens,
    cacheHitRate,
    contextPercent:
      patch.contextPercent !== undefined
        ? patch.contextPercent === null
          ? null
          : Number.isFinite(patch.contextPercent)
            ? patch.contextPercent
            : null
        : (prev?.contextPercent ?? null),
    updatedAt: now,
  };

  state = {
    ...state,
    liveByThread: {
      ...state.liveByThread,
      [threadId]: nextSnapshot,
    },
  };
  notifyListeners();
  return nextSnapshot;
}

export function clearSessionLiveTelemetry(threadId: string): void {
  ensureHydrated();
  if (!(threadId in state.liveByThread)) return;
  const nextLive = { ...state.liveByThread };
  delete nextLive[threadId];
  state = { ...state, liveByThread: nextLive };
  notifyListeners();
}

export function clearUsageCallLogs(): void {
  hydrated = true;
  state = { logs: [], liveByThread: {} };
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      globalThis.localStorage.removeItem(USAGE_CALL_TELEMETRY_STORAGE_KEY);
    } catch {
      // Ignore storage errors.
    }
  }
  notifyListeners();
}

export function getRecordedUsageCallLogs(): readonly UsageCallLogRecord[] {
  return getTelemetryState().logs;
}

export function getSessionLiveTelemetry(
  threadId: string | null | undefined,
): SessionLiveTelemetrySnapshot | null {
  if (!threadId) return null;
  return getTelemetryState().liveByThread[threadId] ?? null;
}

/** Normalize a backend Spec 4B `callLogs` item into a `UsageCallLogRecord`. */
export function normalizeBackendUsageCallLog(
  raw: BackendUsageCallLogLike,
): UsageCallLogRecord {
  const timestamp = parseTimestampMs(raw.timestamp, Date.now());
  const inputTokens = nonNegativeFinite(raw.uncachedInputTokens ?? raw.inputTokens);
  const cachedInputTokens = nonNegativeFinite(raw.cachedInputTokens);
  const cacheCreationTokens = nonNegativeFinite(raw.cacheCreationTokens ?? raw.cacheWriteTokens);
  const outputTokens = nonNegativeFinite(raw.outputTokens);
  const computedTotal = inputTokens + cachedInputTokens + cacheCreationTokens + outputTokens;
  const totalTokens = Math.max(nonNegativeFinite(raw.totalTokens), computedTotal);
  const ttftMs = positiveOrZeroNullable(raw.ttftMs);
  const durationMs = positiveOrZeroNullable(raw.durationMs);
  const tps =
    raw.tps !== undefined && raw.tps !== null
      ? positiveNullable(raw.tps)
      : computeOutputTps(outputTokens, durationMs, ttftMs);
  const cacheHitRate =
    raw.cacheHitRate !== undefined && raw.cacheHitRate !== null
      ? normalizeCacheHitRateValue(raw.cacheHitRate)
      : computeCacheHitRate(inputTokens, cachedInputTokens, cacheCreationTokens);

  return {
    id: raw.id,
    timestamp,
    provider: normalizeUsageProviderKey(raw.provider),
    model: raw.model,
    threadId: raw.threadId ?? undefined,
    turnId: raw.turnId ?? undefined,
    ttftMs,
    durationMs,
    tps,
    inputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    totalTokens,
    cacheHitRate,
    status: normalizeStatus(raw.status),
    source: "backend",
  };
}

/**
 * Merge local live-recorded call telemetry with backend-supplied transcript `callLogs`.
 * Deduplicates by `id` (or close timestamp + provider + model + outputTokens) and retains
 * whichever record carries richer real TTFT / TPS timing metrics.
 */
export function mergeUsageCallLogs(
  localLogs: readonly UsageCallLogRecord[],
  backendLogs?: readonly BackendUsageCallLogLike[] | null,
): readonly UsageCallLogRecord[] {
  const byId = new Map<string, UsageCallLogRecord>();
  for (const log of localLogs) {
    byId.set(log.id, log);
  }
  if (backendLogs && backendLogs.length > 0) {
    for (const raw of backendLogs) {
      if (!raw || typeof raw.id !== "string" || !raw.id) continue;
      const normalized = normalizeBackendUsageCallLog(raw);
      const existing = byId.get(normalized.id);
      if (existing) {
        byId.set(normalized.id, {
          ...normalized,
          ttftMs: existing.ttftMs ?? normalized.ttftMs,
          durationMs: existing.durationMs ?? normalized.durationMs,
          tps: existing.tps ?? normalized.tps,
          cacheHitRate: existing.cacheHitRate ?? normalized.cacheHitRate,
          contextPercent: existing.contextPercent ?? normalized.contextPercent,
          source: existing.source,
        });
        continue;
      }
      // Deduplicate live vs backend records that represent the same turn within 10s
      let matchedKey: string | null = null;
      for (const [key, candidate] of byId.entries()) {
        if (
          candidate.source === "live" &&
          candidate.provider === normalized.provider &&
          candidate.model === normalized.model &&
          candidate.outputTokens === normalized.outputTokens &&
          Math.abs(candidate.timestamp - normalized.timestamp) <= 10_000
        ) {
          matchedKey = key;
          break;
        }
      }
      if (matchedKey !== null) {
        const live = byId.get(matchedKey)!;
        byId.set(matchedKey, {
          ...live,
          ttftMs: live.ttftMs ?? normalized.ttftMs,
          durationMs: live.durationMs ?? normalized.durationMs,
          tps: live.tps ?? normalized.tps,
          inputTokens: Math.max(live.inputTokens, normalized.inputTokens),
          cachedInputTokens: Math.max(live.cachedInputTokens, normalized.cachedInputTokens),
          cacheCreationTokens: Math.max(live.cacheCreationTokens, normalized.cacheCreationTokens),
          totalTokens: Math.max(live.totalTokens, normalized.totalTokens),
          cacheHitRate: live.cacheHitRate ?? normalized.cacheHitRate,
        });
      } else {
        byId.set(normalized.id, normalized);
      }
    }
  }
  return Array.from(byId.values())
    .toSorted((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_USAGE_CALL_LOGS);
}

/**
 * Compute real aggregated summary metrics (average TTFT, average TPS, actual cache hit rate)
 * strictly from measured non-null samples. Never fabricates timing metrics when absent.
 */
export function computeUsageCallSummaryMetrics(
  logs: readonly UsageCallLogRecord[],
  fallbackTotals?: {
    readonly uncachedInputTokens: number;
    readonly cachedInputTokens: number;
    readonly cacheCreationTokens?: number | undefined;
    readonly outputTokens?: number | undefined;
  } | null,
): UsageCallSummaryMetrics {
  let ttftSum = 0;
  let ttftCount = 0;
  let tpsSum = 0;
  let tpsCount = 0;
  let totalInput = 0;
  let totalCached = 0;
  let totalCacheCreate = 0;
  let totalOutput = 0;

  for (const log of logs) {
    if (log.ttftMs !== null && Number.isFinite(log.ttftMs)) {
      ttftSum += log.ttftMs;
      ttftCount += 1;
    }
    if (log.tps !== null && Number.isFinite(log.tps) && log.tps > 0) {
      tpsSum += log.tps;
      tpsCount += 1;
    }
    totalInput += log.inputTokens;
    totalCached += log.cachedInputTokens;
    totalCacheCreate += log.cacheCreationTokens;
    totalOutput += log.outputTokens;
  }

  let cacheHitRate = computeCacheHitRate(totalInput, totalCached, totalCacheCreate);
  if (cacheHitRate === null && fallbackTotals) {
    cacheHitRate = computeCacheHitRate(
      fallbackTotals.uncachedInputTokens,
      fallbackTotals.cachedInputTokens,
      fallbackTotals.cacheCreationTokens ?? 0,
    );
  }

  return {
    callCount: logs.length,
    ttftSampleCount: ttftCount,
    avgTtftMs: ttftCount > 0 ? ttftSum / ttftCount : null,
    tpsSampleCount: tpsCount,
    avgTps: tpsCount > 0 ? tpsSum / tpsCount : null,
    totalInputTokens: totalInput,
    totalCachedInputTokens: totalCached,
    totalCacheCreationTokens: totalCacheCreate,
    totalOutputTokens: totalOutput,
    cacheHitRate,
  };
}

/** Subscribe to all merged model call logs (local live store + optional backend `callLogs`). */
export function useUsageCallLogs(
  backendLogs?: readonly BackendUsageCallLogLike[] | null,
): readonly UsageCallLogRecord[] {
  const localLogs = useSyncExternalStore(
    subscribeTelemetry,
    () => getTelemetryState().logs,
    () => SERVER_EMPTY_LOGS,
  );
  return useMemo(() => mergeUsageCallLogs(localLogs, backendLogs), [backendLogs, localLogs]);
}

/** Subscribe to real-time per-thread telemetry (for composer footer bar & live turn readouts). */
export function useSessionLiveTelemetry(
  threadId: string | null | undefined,
): SessionLiveTelemetrySnapshot | null {
  return useSyncExternalStore(
    subscribeTelemetry,
    () => (threadId ? (getTelemetryState().liveByThread[threadId] ?? null) : null),
    () => SERVER_EMPTY_LIVE,
  );
}
