import type { ContextWindowSnapshot } from "@prismux/client-runtime/state/context-window";

export type ContextGaugeLevel = "unknown" | "normal" | "warning" | "compact" | "overflow";

export interface ContextGaugeSummary {
  readonly level: ContextGaugeLevel;
  readonly rawPercent: number | null;
  readonly displayPercent: number | null;
  readonly barFillPercent: number;
  /** Position (0–100) of the auto-compaction boundary tick on the gauge track (OMP `computeCompactionBoundaries`). */
  readonly compactionBoundaryPercent: number | null;
  readonly usedTokens: number | null;
  readonly maxTokens: number | null;
  readonly autoCompactThreshold: number | null;
  readonly label: string;
  readonly advice: string | null;
}

export type PromptCacheState = "unknown" | "hit" | "miss";

export interface PromptCacheDetailRow {
  readonly label: string;
  readonly value: string;
  readonly tone?: "warning";
}

export interface PromptCacheSummary {
  readonly state: PromptCacheState;
  readonly cachedTokens: number | null;
  readonly inputTokens: number | null;
  readonly uncachedInputTokens: number | null;
  readonly hitRatePercent: number | null;
  /** Two-line brief modeled after OMP `packages/tui/src/status-line/prompt-cache.ts`. */
  readonly brief: readonly [string, string];
  /** Structured rows for the Prompt Cache breakdown popover. */
  readonly details: readonly PromptCacheDetailRow[];
}

function formatCompactTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 1 : 2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}k`;
  }
  return String(Math.round(tokens));
}

/**
 * 4-tier Context Gauge classifier aligned with Issue #5 & OMP `chrome/context-thresholds.ts`:
 * - normal:   < 60%
 * - warning:  60% <= p < 95%
 * - compact:  95% <= p <= 100%
 * - overflow: > 100% (bar clamps to 100% while percentage label keeps true >100%)
 * - unknown window with known usedTokens renders `<tokens>/?` instead of misleading `0%`
 */
export function classifyContextGauge(
  usedTokens: number | null | undefined,
  maxTokens: number | null | undefined,
  autoCompactThreshold: number | null | undefined = null,
): ContextGaugeSummary {
  const validUsed =
    typeof usedTokens === "number" && Number.isFinite(usedTokens) && usedTokens >= 0
      ? usedTokens
      : null;
  const validMax =
    typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0
      ? maxTokens
      : null;
  const validThreshold =
    typeof autoCompactThreshold === "number" &&
    Number.isFinite(autoCompactThreshold) &&
    autoCompactThreshold > 0
      ? autoCompactThreshold
      : null;

  if (validUsed === null || validMax === null) {
    // OMP `formatContextUsage`: unknown window with known tokens renders `<tokens>/?` rather than `0%`.
    const unknownLabel =
      validUsed !== null && validUsed > 0
        ? `Ctx ${formatCompactTokenCount(validUsed)}/?`
        : "Ctx —";
    return {
      level: "unknown",
      rawPercent: null,
      displayPercent: null,
      barFillPercent: 0,
      compactionBoundaryPercent: null,
      usedTokens: validUsed,
      maxTokens: validMax,
      autoCompactThreshold: validThreshold,
      label: unknownLabel,
      advice: null,
    };
  }

  const rawPercent = (validUsed / validMax) * 100;
  const displayPercent = Math.round(rawPercent);
  const barFillPercent = Math.max(0, Math.min(100, rawPercent));
  const compactionBoundaryPercent =
    validThreshold !== null && validThreshold <= validMax
      ? Math.max(0, Math.min(100, (validThreshold / validMax) * 100))
      : 95;

  let level: ContextGaugeLevel;
  let advice: string | null = null;
  if (rawPercent > 100) {
    level = "overflow";
    advice = "上下文已超过窗口上限，请立即执行 /compact 压缩或使用 /handoff 提纯开新线程。";
  } else if (rawPercent >= 95) {
    level = "compact";
    advice = "上下文接近极限（≥95%），建议执行 /compact 压缩上下文。";
  } else if (rawPercent >= 60) {
    level = "warning";
    advice = "上下文水位较高（≥60%），后续轮次可按需精简或分段。";
  } else {
    level = "normal";
    advice = null;
  }

  return {
    level,
    rawPercent,
    displayPercent,
    barFillPercent,
    compactionBoundaryPercent,
    usedTokens: validUsed,
    maxTokens: validMax,
    autoCompactThreshold: validThreshold,
    label: `Ctx ${displayPercent}%`,
    advice,
  };
}

export function deriveContextGaugeFromSnapshot(
  snapshot: Pick<
    ContextWindowSnapshot,
    "usedTokens" | "maxTokens" | "autoCompactThreshold"
  > | null | undefined,
): ContextGaugeSummary {
  if (!snapshot) {
    return classifyContextGauge(null, null, null);
  }
  return classifyContextGauge(
    snapshot.usedTokens,
    snapshot.maxTokens,
    snapshot.autoCompactThreshold,
  );
}

/**
 * Pure local session Prompt Cache derivation modeled after OMP `status-line/prompt-cache.ts`
 * & `status-line/segments.ts` (`cacheHitSegment` / `cacheSegment`):
 * - Reads only local session token telemetry (`lastCachedInputTokens ?? cachedInputTokens`).
 * - Hit (`cachedTokens > 0`) → lit badge with hit percentage + structured breakdown rows.
 * - Miss (`cachedTokens === 0` with observed input/used tokens) → struck-through badge + cold brief.
 * - Unknown (no session telemetry yet) → calm dash placeholder.
 */
export function derivePromptCacheSummary(
  snapshot: Pick<
    ContextWindowSnapshot,
    "usedTokens" | "inputTokens" | "cachedInputTokens" | "lastInputTokens" | "lastCachedInputTokens"
  > | null | undefined,
): PromptCacheSummary {
  if (!snapshot) {
    return {
      state: "unknown",
      cachedTokens: null,
      inputTokens: null,
      uncachedInputTokens: null,
      hitRatePercent: null,
      brief: ["尚无本地缓存事件", "发送消息后自动统计本会话 Prompt Cache 命中情况"],
      details: [{ label: "状态", value: "未观测" }],
    };
  }

  const cachedTokens =
    typeof snapshot.lastCachedInputTokens === "number" &&
    Number.isFinite(snapshot.lastCachedInputTokens)
      ? Math.max(0, snapshot.lastCachedInputTokens)
      : typeof snapshot.cachedInputTokens === "number" &&
          Number.isFinite(snapshot.cachedInputTokens)
        ? Math.max(0, snapshot.cachedInputTokens)
        : null;

  const inputTokens =
    typeof snapshot.lastInputTokens === "number" && Number.isFinite(snapshot.lastInputTokens)
      ? Math.max(0, snapshot.lastInputTokens)
      : typeof snapshot.inputTokens === "number" && Number.isFinite(snapshot.inputTokens)
        ? Math.max(0, snapshot.inputTokens)
        : null;

  if (cachedTokens === null) {
    return {
      state: "unknown",
      cachedTokens: null,
      inputTokens,
      uncachedInputTokens: inputTokens,
      hitRatePercent: null,
      brief: ["尚无本地缓存事件", "当前 Provider 尚未上报本轮缓存读取计数"],
      details: [{ label: "状态", value: "未观测" }],
    };
  }

  if (cachedTokens > 0) {
    const denominator =
      inputTokens !== null && inputTokens >= cachedTokens
        ? inputTokens
        : inputTokens !== null && inputTokens > 0
          ? inputTokens + cachedTokens
          : snapshot.usedTokens > 0
            ? Math.max(snapshot.usedTokens, cachedTokens)
            : cachedTokens;
    const uncachedInputTokens = Math.max(0, denominator - cachedTokens);
    const hitRatePercent =
      denominator > 0 ? Math.min(100, Math.round((cachedTokens / denominator) * 100)) : 100;
    return {
      state: "hit",
      cachedTokens,
      inputTokens: denominator,
      uncachedInputTokens,
      hitRatePercent,
      brief: [
        `缓存已命中（${hitRatePercent}%）`,
        `本轮从缓存读取 ~${formatCompactTokenCount(cachedTokens)}，新发送 ~${formatCompactTokenCount(uncachedInputTokens)}`,
      ],
      details: [
        { label: "状态", value: "Warm（已命中）" },
        { label: "命中率", value: `${hitRatePercent}%` },
        { label: "缓存读取", value: formatCompactTokenCount(cachedTokens) },
        { label: "未命中增量", value: formatCompactTokenCount(uncachedInputTokens) },
      ],
    };
  }

  const hasObservedRequest =
    (inputTokens !== null && inputTokens > 0) ||
    (typeof snapshot.usedTokens === "number" && snapshot.usedTokens > 0);
  if (hasObservedRequest) {
    const uncached = inputTokens ?? snapshot.usedTokens;
    return {
      state: "miss",
      cachedTokens: 0,
      inputTokens: uncached,
      uncachedInputTokens: uncached,
      hitRatePercent: 0,
      brief: [
        "缓存未命中（Cold）",
        `本轮未复用前缀，完整发送 ~${formatCompactTokenCount(uncached)} tokens`,
      ],
      details: [
        { label: "状态", value: "Cold（未命中）", tone: "warning" },
        { label: "缓存读取", value: "0" },
        { label: "未命中发送", value: formatCompactTokenCount(uncached), tone: "warning" },
      ],
    };
  }

  return {
    state: "unknown",
    cachedTokens: null,
    inputTokens,
    uncachedInputTokens: inputTokens,
    hitRatePercent: null,
    brief: ["尚无本地缓存事件", "发送消息后自动统计本会话 Prompt Cache 命中情况"],
    details: [{ label: "状态", value: "未观测" }],
  };
}
