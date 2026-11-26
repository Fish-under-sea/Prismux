import type {
  OrchestrationV2ProviderThread,
  OrchestrationV2ProviderTurn,
  OrchestrationV2RunAttempt,
  RunId,
} from "@prismux/core-contracts";
import { DatabaseIcon } from "lucide-react";
import { memo } from "react";
import { cn } from "~/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  getRecordedUsageCallLogs,
  unwrapUsageModelSlug,
  type UsageCallLogRecord,
} from "../usage/usageCallTelemetryStore";
import { extractTurnUsageDetail, nonNegInt } from "./sessionTelemetry.logic";
import type { HandoffTimelineRun } from "./V2LifecycleRow";

const EXACT_INTEGER_FORMATTER = new Intl.NumberFormat("en-US");

export interface ResolvedTurnUsageDisplay {
  readonly runId: RunId;
  readonly providerModelLabel: string | null;
  readonly totalTokens: number;
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly cacheHitRate: number | null;
  readonly isEstimated: false;
}

export interface ResolveTurnUsageInput {
  readonly providerTurns?: ReadonlyArray<OrchestrationV2ProviderTurn> | undefined;
  readonly attempts?: ReadonlyArray<OrchestrationV2RunAttempt> | undefined;
  readonly providerThreads?: ReadonlyArray<OrchestrationV2ProviderThread> | undefined;
  readonly runs?: ReadonlyArray<HandoffTimelineRun> | undefined;
  readonly threadId?: string | null | undefined;
  readonly callLogs?: ReadonlyArray<UsageCallLogRecord> | undefined;
}

/**
 * Compact DSH pill readout matching Fig 10:
 * `< 1K` -> exact integer, `< 100K` -> 1 decimal (`12.4K`), `< 999.5K` -> rounded K (`767K`), `>= 999.5K` -> M (`1.25M`).
 */
export function formatTurnUsageCompact(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens < 1_000) return String(Math.round(tokens));
  if (tokens < 100_000) {
    return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  if (tokens < 999_500) {
    return `${Math.round(tokens / 1_000)}K`;
  }
  return `${(tokens / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}

/** Exact comma-grouped token string matching Fig 10 (e.g. `766,591 tok`). */
export function formatTurnUsageExact(tokens: number): string {
  const safe = Number.isFinite(tokens) && tokens > 0 ? Math.round(tokens) : 0;
  return `${EXACT_INTEGER_FORMATTER.format(safe)} tok`;
}

/**
 * Honest cache hit percentage: never rounds a strictly sub-100% rate up to `100%`.
 * E.g. `0.9459 -> "94.6%"`, `0.9995 -> "99.9%"`, `1 -> "100%"`.
 */
export function formatHonestCacheHitPercent(rate: number | null): string | null {
  if (rate === null || !Number.isFinite(rate) || rate < 0) return null;
  if (rate >= 1) return "100%";
  if (rate <= 0) return "0%";
  const pct = rate * 100;
  if (pct >= 99.9 && pct < 100) return "99.9%";
  return `${pct.toFixed(1).replace(/\.0$/, "")}%`;
}

function normalizeProviderPrefix(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim().toLowerCase() ?? "";
  if (!trimmed) return null;
  if (trimmed === "claudeagent" || trimmed === "claude-code" || trimmed.startsWith("claude")) {
    return "claude";
  }
  if (trimmed.includes("deepseek") || trimmed === "dsh" || /(?:^|[:_-])dsh$/u.test(trimmed)) {
    return "dsh";
  }
  if (trimmed.includes("antigravity") || trimmed === "agy") {
    return "antigravity";
  }
  if (trimmed.startsWith("codex")) return "codex";
  if (trimmed.startsWith("opencode")) return "opencode";
  if (trimmed === "pi" || trimmed.startsWith("pi-") || trimmed.startsWith("pi:")) return "pi";
  if (trimmed.startsWith("acp:")) return trimmed.slice(4) || "acp";
  return trimmed;
}

function formatProviderModelLabel(
  rawModel: string | null | undefined,
  driverHint: string | null | undefined,
): string | null {
  const cleaned = rawModel ? unwrapUsageModelSlug(rawModel).trim() : "";
  if (!cleaned || cleaned === "unknown") return null;
  if (cleaned.includes("/")) return cleaned;
  const prefix = normalizeProviderPrefix(driverHint);
  return prefix ? `${prefix}/${cleaned}` : cleaned;
}

interface MutableTurnUsageAccumulator {
  uncachedInputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  providerModelLabel: string | null;
}

export function resolveTurnUsageByRunId(
  input: ResolveTurnUsageInput,
): ReadonlyMap<RunId, ResolvedTurnUsageDisplay> {
  const providerTurns = input.providerTurns ?? [];
  const attempts = input.attempts ?? [];
  const providerThreads = input.providerThreads ?? [];
  const runs = input.runs ?? [];

  const attemptById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  const attemptByProviderTurnId = new Map(
    attempts
      .filter((attempt) => attempt.providerTurnId !== null)
      .map((attempt) => [attempt.providerTurnId!, attempt]),
  );
  const providerThreadById = new Map(providerThreads.map((thread) => [thread.id, thread]));
  const runById = new Map(runs.map((run) => [run.id, run]));

  const accByRunId = new Map<RunId, MutableTurnUsageAccumulator>();

  for (const turn of providerTurns) {
    const attempt =
      (turn.runAttemptId ? attemptById.get(turn.runAttemptId) : undefined) ??
      attemptByProviderTurnId.get(turn.id);
    const runId = attempt?.runId ?? null;
    if (!runId) continue;

    const detail = extractTurnUsageDetail(turn);
    if (!detail.hasMeasuredTokens || detail.totalTokens <= 0) continue;

    const providerThread = providerThreadById.get(turn.providerThreadId);
    const run = runById.get(runId);
    const driverHint =
      providerThread?.driver ?? attempt?.providerInstanceId ?? run?.providerInstanceId ?? undefined;
    const rawModel =
      detail.reportedModels[0] ?? turn.model ?? run?.modelSelection.model ?? undefined;
    const providerModelLabel = formatProviderModelLabel(rawModel, driverHint);

    const existing = accByRunId.get(runId);
    if (existing) {
      existing.uncachedInputTokens += detail.uncachedInputTokens;
      existing.cachedInputTokens += detail.cachedInputTokens;
      existing.cacheCreationTokens += detail.cacheCreationTokens;
      existing.outputTokens += detail.outputTokens;
      existing.reasoningTokens += detail.reasoningTokens;
      existing.totalTokens += detail.totalTokens;
      if (providerModelLabel) {
        existing.providerModelLabel = providerModelLabel;
      }
    } else {
      accByRunId.set(runId, {
        uncachedInputTokens: detail.uncachedInputTokens,
        cachedInputTokens: detail.cachedInputTokens,
        cacheCreationTokens: detail.cacheCreationTokens,
        outputTokens: detail.outputTokens,
        reasoningTokens: detail.reasoningTokens,
        totalTokens: detail.totalTokens,
        providerModelLabel,
      });
    }
  }

  // Fallback to recorded usage call logs for runs that had no measured `providerTurns` tokenUsage.
  const logs =
    input.callLogs ?? (input.threadId ? getRecordedUsageCallLogs() : ([] as UsageCallLogRecord[]));
  if (logs.length > 0) {
    const logAccByRunId = new Map<RunId, MutableTurnUsageAccumulator>();
    for (const log of logs) {
      if (input.threadId && log.threadId && log.threadId !== input.threadId) continue;
      if (!log.turnId) continue;
      const runId = log.turnId as RunId;
      if (accByRunId.has(runId)) continue;
      const uncached = nonNegInt(log.inputTokens);
      const cached = nonNegInt(log.cachedInputTokens);
      const cacheCreate = nonNegInt(log.cacheCreationTokens);
      const output = nonNegInt(log.outputTokens);
      const reasoning = Math.min(output, nonNegInt(log.reasoningTokens));
      const total = Math.max(nonNegInt(log.totalTokens), uncached + cached + cacheCreate + output);
      if (total <= 0) continue;

      const providerModelLabel = formatProviderModelLabel(log.model, log.provider);
      const existing = logAccByRunId.get(runId);
      if (existing) {
        existing.uncachedInputTokens += uncached;
        existing.cachedInputTokens += cached;
        existing.cacheCreationTokens += cacheCreate;
        existing.outputTokens += output;
        existing.reasoningTokens += reasoning;
        existing.totalTokens += total;
        if (providerModelLabel) existing.providerModelLabel = providerModelLabel;
      } else {
        logAccByRunId.set(runId, {
          uncachedInputTokens: uncached,
          cachedInputTokens: cached,
          cacheCreationTokens: cacheCreate,
          outputTokens: output,
          reasoningTokens: reasoning,
          totalTokens: total,
          providerModelLabel,
        });
      }
    }
    for (const [runId, acc] of logAccByRunId) {
      accByRunId.set(runId, acc);
    }
  }

  const resolved = new Map<RunId, ResolvedTurnUsageDisplay>();
  for (const [runId, acc] of accByRunId) {
    if (acc.totalTokens <= 0) continue;
    const totalInput = acc.uncachedInputTokens + acc.cachedInputTokens + acc.cacheCreationTokens;
    const cacheHitRate =
      totalInput > 0 && acc.cachedInputTokens > 0 ? acc.cachedInputTokens / totalInput : null;
    resolved.set(runId, {
      runId,
      providerModelLabel: acc.providerModelLabel,
      totalTokens: acc.totalTokens,
      uncachedInputTokens: acc.uncachedInputTokens,
      cachedInputTokens: acc.cachedInputTokens,
      cacheCreationTokens: acc.cacheCreationTokens,
      outputTokens: acc.outputTokens,
      reasoningTokens: acc.reasoningTokens,
      cacheHitRate,
      isEstimated: false,
    });
  }

  return resolved;
}

function getTurnUsageCopy(locale: string | undefined) {
  const isZh = typeof locale === "string" && locale.toLowerCase().startsWith("zh");
  return {
    pillPrefix: isZh ? "用量" : "Usage",
    popoverHeader: isZh ? "本轮用量" : "Turn usage",
    triggerAria: (exactTotal: string) =>
      isZh ? `本轮用量 ${exactTotal}` : `Turn usage ${exactTotal}`,
    providerModel: isZh ? "提供方 / 模型" : "Provider / Model",
    cacheHit: isZh ? "缓存命中" : "Cache hit",
    uncachedInput: isZh ? "未缓存输入" : "Uncached input",
    cacheRead: isZh ? "缓存读取" : "Cache read",
    cacheWrite: isZh ? "缓存写入" : "Cache write",
    output: isZh ? "输出" : "Output",
    formatOutputWithReasoning: (outputTokens: number, reasoningTokens: number) =>
      isZh
        ? `${formatTurnUsageExact(outputTokens)}（推理 ${EXACT_INTEGER_FORMATTER.format(reasoningTokens)}）`
        : `${formatTurnUsageExact(outputTokens)} (${EXACT_INTEGER_FORMATTER.format(reasoningTokens)} reasoning)`,
  };
}

export const TurnUsagePill = memo(function TurnUsagePill({
  usage,
  locale,
  defaultOpen = false,
}: {
  readonly usage: ResolvedTurnUsageDisplay;
  readonly locale?: string | undefined;
  readonly defaultOpen?: boolean | undefined;
}) {
  if (usage.totalTokens <= 0) return null;
  const copy = getTurnUsageCopy(locale);
  const compactTokens = formatTurnUsageCompact(usage.totalTokens);
  const exactTotal = formatTurnUsageExact(usage.totalTokens);
  const cacheHitLabel = formatHonestCacheHitPercent(usage.cacheHitRate);
  const triggerAriaLabel = copy.triggerAria(exactTotal);
  const outputValue =
    usage.reasoningTokens > 0
      ? copy.formatOutputWithReasoning(usage.outputTokens, usage.reasoningTokens)
      : formatTurnUsageExact(usage.outputTokens);

  return (
    <Popover defaultOpen={defaultOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-turn-usage-pill="true"
            data-turn-usage-run-id={usage.runId}
            aria-label={triggerAriaLabel}
            className={cn(
              "inline-flex h-7 cursor-pointer select-none items-center gap-1 rounded-lg px-2 py-1.5 text-xs leading-4 tabular-nums text-muted-foreground transition-colors duration-100",
              "hover:bg-muted/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
              "data-[popup-open]:bg-muted/65 data-[popup-open]:text-foreground",
              "[[data-pmx-glass='1']_&]:hover:bg-foreground/10 [[data-pmx-glass='1']_&]:data-[popup-open]:bg-foreground/12",
            )}
          />
        }
      >
        <DatabaseIcon aria-hidden="true" className="pmx-turn-usage-icon shrink-0 opacity-80" />
        <span className="pmx-turn-usage-label">{copy.pillPrefix}</span>
        <span className="font-mono">{`${compactTokens} tok`}</span>
      </PopoverTrigger>
      <PopoverPopup side="top" align="end" sideOffset={8} padding="none">
        <div data-turn-usage-popover="true" className="px-4 py-3.5 text-xs leading-4 tabular-nums">
          <div className="flex items-center justify-between gap-3 pb-2.5">
            <span className="font-medium text-foreground">{copy.popoverHeader}</span>
            <span
              data-turn-usage-total="true"
              className="font-mono font-medium tabular-nums text-foreground"
            >
              {exactTotal}
            </span>
          </div>
          <div aria-hidden="true" className="pmx-hairline-divider" />
          <dl className="mt-2.5 flex flex-col gap-2">
            {usage.providerModelLabel ? (
              <TurnUsageMetricRow label={copy.providerModel} value={usage.providerModelLabel} />
            ) : null}
            {usage.cachedInputTokens > 0 && cacheHitLabel ? (
              <TurnUsageMetricRow label={copy.cacheHit} value={cacheHitLabel} />
            ) : null}
            <TurnUsageMetricRow
              label={copy.uncachedInput}
              value={formatTurnUsageExact(usage.uncachedInputTokens)}
            />
            {usage.cachedInputTokens > 0 ? (
              <TurnUsageMetricRow
                label={copy.cacheRead}
                value={formatTurnUsageExact(usage.cachedInputTokens)}
              />
            ) : null}
            {usage.cacheCreationTokens > 0 ? (
              <TurnUsageMetricRow
                label={copy.cacheWrite}
                value={formatTurnUsageExact(usage.cacheCreationTokens)}
              />
            ) : null}
            <TurnUsageMetricRow label={copy.output} value={outputValue} />
          </dl>
        </div>
      </PopoverPopup>
    </Popover>
  );
});

function TurnUsageMetricRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd
        data-turn-usage-value="true"
        className="min-w-0 truncate text-right font-mono tabular-nums"
        style={{ color: "var(--pmx-accent-text)" }}
      >
        {value}
      </dd>
    </div>
  );
}
