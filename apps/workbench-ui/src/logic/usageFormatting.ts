import type { UsageLedgerSummary } from "@prismux/protocol";

export const UNKNOWN_METRIC_LABEL = "未告知" as const;

export type LedgerMetricUnit =
  | "tokens"
  | "ratio-percent"
  | "percent"
  | "usd"
  | "count";

export interface FormatLedgerMetricOptions {
  unit?: LedgerMetricUnit;
  compact?: boolean;
  decimals?: number;
}

/**
 * Formats numeric ledger telemetry cleanly and strictly distinguishes
 * known `0` values from unknown/unreported metrics (`"未告知"`).
 */
export function formatLedgerMetric(
  value: number | null | undefined,
  options: FormatLedgerMetricOptions = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return UNKNOWN_METRIC_LABEL;
  }

  const unit = options.unit ?? "tokens";
  switch (unit) {
    case "ratio-percent": {
      const decimals = options.decimals ?? 1;
      return `${(value * 100).toFixed(decimals)}%`;
    }
    case "percent": {
      const decimals = options.decimals ?? 1;
      return `${value.toFixed(decimals)}%`;
    }
    case "usd": {
      const decimals = options.decimals ?? 2;
      return `$${value.toFixed(decimals)}`;
    }
    case "tokens": {
      if (options.compact) {
        const abs = Math.abs(value);
        if (abs >= 1_000_000) {
          return `${(value / 1_000_000).toFixed(2)}M`;
        }
        if (abs >= 10_000) {
          return `${(value / 1_000).toFixed(1)}K`;
        }
      }
      return Math.round(value).toLocaleString("en-US");
    }
    case "count":
    default:
      return Math.round(value).toLocaleString("en-US");
  }
}

export function formatMachineIdLabel(
  machineId: string | null | undefined
): string {
  if (typeof machineId !== "string" || machineId.trim().length === 0) {
    return UNKNOWN_METRIC_LABEL;
  }
  return machineId.trim();
}

export function formatUnknownCountLabel(unknownCount: number): string {
  if (!Number.isFinite(unknownCount) || unknownCount <= 0) {
    return UNKNOWN_METRIC_LABEL;
  }
  return `${Math.round(unknownCount)} 项未告知`;
}

export type PartialUsageLedgerEntry = {
  machineId?: string | null;
  providerId: string;
  todayTokens?: number | null;
  weekTokens?: number | null;
  quotaUsedRatio?: number | null;
  estimatedCostUsd?: number | null;
  apiBalanceUsd?: number | null;
};

/**
 * Deduplicates ledger rows by `(machineId, providerId)` so multi-machine sync restores
 * never double-count records belonging to the same device (Magpie #6987 invariant).
 */
export function deduplicateMachineUsage(
  entries: ReadonlyArray<PartialUsageLedgerEntry>
): PartialUsageLedgerEntry[] {
  const map = new Map<string, PartialUsageLedgerEntry>();
  for (const entry of entries) {
    const machineKey =
      typeof entry.machineId === "string" && entry.machineId.trim().length > 0
        ? entry.machineId.trim()
        : "__unknown_machine__";
    const key = `${machineKey}::${entry.providerId}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...entry });
      continue;
    }
    // Keep the highest reported known monotonic watermark per (machineId, providerId)
    map.set(key, {
      ...existing,
      ...entry,
      todayTokens: pickDefinedMax(existing.todayTokens, entry.todayTokens),
      weekTokens: pickDefinedMax(existing.weekTokens, entry.weekTokens),
      quotaUsedRatio: entry.quotaUsedRatio ?? existing.quotaUsedRatio,
      estimatedCostUsd: entry.estimatedCostUsd ?? existing.estimatedCostUsd,
      apiBalanceUsd: entry.apiBalanceUsd ?? existing.apiBalanceUsd
    });
  }
  return Array.from(map.values());
}

function pickDefinedMax(
  a: number | null | undefined,
  b: number | null | undefined
): number | null | undefined {
  const aValid = typeof a === "number" && Number.isFinite(a);
  const bValid = typeof b === "number" && Number.isFinite(b);
  if (aValid && bValid) {
    return Math.max(a, b);
  }
  if (bValid) {
    return b;
  }
  if (aValid) {
    return a;
  }
  return undefined;
}

export interface AggregatedUsageSummary {
  dedupedEntries: PartialUsageLedgerEntry[];
  totalTodayTokens: number | null;
  totalWeekTokens: number | null;
  averageQuotaRatio: number | null;
  totalEstimatedCostUsd: number | null;
  unknownFieldCount: number;
  machineIds: string[];
}

export function summarizeUsageLedger(
  entries: ReadonlyArray<PartialUsageLedgerEntry | UsageLedgerSummary>
): AggregatedUsageSummary {
  const deduped = deduplicateMachineUsage(entries);
  if (deduped.length === 0) {
    return {
      dedupedEntries: [],
      totalTodayTokens: null,
      totalWeekTokens: null,
      averageQuotaRatio: null,
      totalEstimatedCostUsd: null,
      unknownFieldCount: 4,
      machineIds: []
    };
  }

  let todaySum = 0;
  let todayKnownCount = 0;
  let weekSum = 0;
  let weekKnownCount = 0;
  let quotaSum = 0;
  let quotaKnownCount = 0;
  let costSum = 0;
  let costKnownCount = 0;
  let unknownFieldCount = 0;
  const machineIdSet = new Set<string>();

  for (const row of deduped) {
    if (typeof row.machineId === "string" && row.machineId.trim().length > 0) {
      machineIdSet.add(row.machineId.trim());
    } else {
      unknownFieldCount += 1;
    }

    if (typeof row.todayTokens === "number" && Number.isFinite(row.todayTokens)) {
      todaySum += row.todayTokens;
      todayKnownCount += 1;
    } else {
      unknownFieldCount += 1;
    }

    if (typeof row.weekTokens === "number" && Number.isFinite(row.weekTokens)) {
      weekSum += row.weekTokens;
      weekKnownCount += 1;
    } else {
      unknownFieldCount += 1;
    }

    if (
      typeof row.quotaUsedRatio === "number" &&
      Number.isFinite(row.quotaUsedRatio)
    ) {
      quotaSum += row.quotaUsedRatio;
      quotaKnownCount += 1;
    } else {
      unknownFieldCount += 1;
    }

    if (
      typeof row.estimatedCostUsd === "number" &&
      Number.isFinite(row.estimatedCostUsd)
    ) {
      costSum += row.estimatedCostUsd;
      costKnownCount += 1;
    } else {
      unknownFieldCount += 1;
    }
  }

  return {
    dedupedEntries: deduped,
    totalTodayTokens: todayKnownCount > 0 ? todaySum : null,
    totalWeekTokens: weekKnownCount > 0 ? weekSum : null,
    averageQuotaRatio:
      quotaKnownCount > 0 ? quotaSum / quotaKnownCount : null,
    totalEstimatedCostUsd: costKnownCount > 0 ? costSum : null,
    unknownFieldCount,
    machineIds: Array.from(machineIdSet)
  };
}
