import type { ContextWindowSnapshot } from "@prismux/client-runtime/state/context-window";
import type { ServerProvider, UsageSummary } from "@prismux/core-contracts";
import { makeWindow } from "@prismux/core-shared/usageFormat";
import type { MergedUsage } from "@prismux/core-shared/usageMerge";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, DatabaseIcon, GaugeIcon } from "lucide-react";
import { memo, useEffect, useState, useSyncExternalStore } from "react";

import { cn } from "~/lib/utils";
import { useUsage, type EnvironmentUsageStatus } from "~/state/usage";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  formatCacheHitRate,
  useSessionLiveTelemetry,
  useUsageCallLogs,
  type BackendUsageCallLogLike,
  type SessionLiveTelemetrySnapshot,
  type UsageCallLogRecord,
} from "../usage/usageCallTelemetryStore";
import { ComposerWorkspaceLocationBar } from "./ComposerWorkspaceLocationBar";
import {
  useSessionTelemetryCopy,
  type SessionTelemetryCopy,
} from "./sessionTelemetry.copy";
import {
  computeDonutSegments,
  formatCompactPopoverTokens,
  formatIntegerTokens,
  resolveContextBarTone,
  resolveContextRingTone,
  resolveSessionTelemetryDisplay,
  transitionTelemetryPopover,
  useSessionTelemetryDetail,
  type ContextBarTone,
  type ContextRingTone,
  type ResolvedTelemetryDisplay,
  type SessionModelDistributionEntry,
  type SessionTelemetryDetailSnapshot,
  type TelemetryMetricScope,
  type TelemetryPopoverId,
} from "./sessionTelemetry.logic";

export {
  resolveContextBarTone,
  resolveContextRingTone,
  transitionTelemetryPopover,
  type ContextBarTone,
  type ContextRingTone,
  type ResolvedTelemetryDisplay,
  type SessionModelDistributionEntry,
  type SessionTelemetryDetailSnapshot,
  type TelemetryMetricScope,
  type TelemetryPopoverId,
};

export function formatCompactTelemetryTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens >= 1_000_000_000) {
    return `${(tokens / 1_000_000_000).toFixed(tokens >= 10_000_000_000 ? 1 : 2)}B`;
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 1 : 2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}k`;
  }
  return String(Math.round(tokens));
}

/**
 * Below this composer form width (e.g. split pane, wallpaper drawer open, or dragged narrow),
 * the 3-segment live telemetry strip drops cleanly onto its own second footer row so the left
 * model picker and right telemetry/action clusters never overlap across 420px–1200px+.
 */
export const COMPOSER_INLINE_TELEMETRY_MIN_WIDTH_PX = 700;

export function shouldWrapComposerTelemetryRow(composerWidthPx: number): boolean {
  return (
    Number.isFinite(composerWidthPx) &&
    composerWidthPx > 0 &&
    composerWidthPx < COMPOSER_INLINE_TELEMETRY_MIN_WIDTH_PX
  );
}

/**
 * Formats output generation throughput for Trigger 1 (always 1 decimal when measured,
 * e.g. `102.1 tok/s`, or `— tok/s` when no real speed has been measured yet).
 */
export function formatTelemetryStripTps(tps: number | null | undefined): string {
  if (typeof tps !== "number" || !Number.isFinite(tps) || tps <= 0) {
    return "— tok/s";
  }
  return `${tps.toFixed(1)} tok/s`;
}

/** Formats output generation throughput for Popover 1 rows (`102.1 tok/s` or `—`). */
export function formatTelemetryPopoverTps(tps: number | null | undefined): string {
  if (typeof tps !== "number" || !Number.isFinite(tps) || tps <= 0) {
    return "—";
  }
  return `${tps.toFixed(1)} tok/s`;
}

const RING_STROKE_CLASS: Readonly<Record<ContextRingTone, string>> = {
  unknown: "stroke-foreground/35 dark:stroke-foreground/35",
  normal: "stroke-[#22c55e] dark:stroke-[#22c55e]",
  warning: "stroke-amber-500 dark:stroke-amber-400",
  compact: "stroke-orange-500 dark:stroke-orange-400",
  overflow: "stroke-red-500 dark:stroke-red-400",
};

const RING_TEXT_CLASS: Readonly<Record<ContextRingTone, string>> = {
  unknown: "text-foreground/75 dark:text-foreground/75",
  normal: "text-foreground/90 dark:text-foreground/85",
  warning: "text-amber-700 dark:text-amber-400",
  compact: "text-orange-700 dark:text-orange-400",
  overflow: "text-red-700 dark:text-red-400 font-semibold",
};

const CONTEXT_BAR_FILL_CLASS: Readonly<Record<ContextBarTone, string>> = {
  unknown: "bg-[#22c55e]",
  normal: "bg-[#22c55e]",
  warning: "bg-amber-500",
  critical: "bg-red-500",
};

const RING_SIZE = 14;
const RING_STROKE_WIDTH = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE_WIDTH) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function ContextProgressRing({
  percent,
  className,
}: {
  readonly percent: number | null;
  readonly className?: string | undefined;
}) {
  const tone = resolveContextRingTone(percent);
  const clamped =
    typeof percent === "number" && Number.isFinite(percent)
      ? Math.max(0, Math.min(100, percent))
      : 0;
  const dashOffset = RING_CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      aria-hidden="true"
      data-context-ring-tone={tone}
      className={cn("size-3.5 shrink-0 -rotate-90", className)}
    >
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        strokeWidth={RING_STROKE_WIDTH}
        className="stroke-foreground/22 dark:stroke-foreground/28"
      />
      {tone !== "unknown" ? (
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          className={cn(
            "transition-[stroke-dashoffset,stroke] duration-200 ease-out motion-reduce:transition-none",
            RING_STROKE_CLASS[tone],
          )}
        />
      ) : null}
    </svg>
  );
}

function ContextWindowPieGlyph({ className }: { readonly className?: string | undefined }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 1.75A6.25 6.25 0 0 1 13.7 10.6L8 8Z" fill="currentColor" opacity="0.24" />
      <path
        d="M8 1.75V8L12.4 12.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const DONUT_SIZE = 46;
const DONUT_STROKE_WIDTH = 6;
const DONUT_RADIUS = (DONUT_SIZE - DONUT_STROKE_WIDTH) / 2;

export function SessionModelDonutChart({
  models,
  className,
}: {
  readonly models: readonly SessionModelDistributionEntry[];
  readonly className?: string | undefined;
}) {
  const segments = computeDonutSegments(models, DONUT_RADIUS);
  return (
    <svg
      width={DONUT_SIZE}
      height={DONUT_SIZE}
      viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
      aria-hidden="true"
      data-telemetry-model-donut="true"
      className={cn("size-[46px] shrink-0 -rotate-90", className)}
    >
      <circle
        cx={DONUT_SIZE / 2}
        cy={DONUT_SIZE / 2}
        r={DONUT_RADIUS}
        fill="none"
        strokeWidth={DONUT_STROKE_WIDTH}
        className="stroke-foreground/12 dark:stroke-white/12"
      />
      {segments.map((segment) => (
        <circle
          key={segment.modelId}
          cx={DONUT_SIZE / 2}
          cy={DONUT_SIZE / 2}
          r={DONUT_RADIUS}
          fill="none"
          stroke={segment.color}
          strokeWidth={DONUT_STROKE_WIDTH}
          strokeDasharray={segment.dashArray}
          strokeDashoffset={segment.dashOffset}
          strokeLinecap="butt"
        />
      ))}
    </svg>
  );
}

export function SessionStatsPopoverContent({
  display,
  copy,
}: {
  readonly display: ResolvedTelemetryDisplay;
  readonly copy: SessionTelemetryCopy;
}) {
  const rows: ReadonlyArray<{ readonly key: string; readonly label: string; readonly value: string }> = [
    {
      key: "model-duration",
      label: copy.modelCallDuration,
      value: copy.formatDuration(display.modelCallDurationMs),
    },
    {
      key: "tool-duration",
      label: copy.toolCallDuration,
      value: copy.formatDuration(display.toolCallDurationMs),
    },
    {
      key: "avg-ttft",
      label: copy.avgTtft,
      value: copy.formatTtft(display.avgTtftMs),
    },
    {
      key: "session-tps",
      label: copy.sessionTps,
      value: formatTelemetryPopoverTps(display.sessionTps),
    },
    {
      key: "latest-request",
      label: copy.latestRequest,
      value: formatTelemetryPopoverTps(display.latestRequestTps),
    },
    {
      key: "text-thinking-output",
      label: copy.textAndThinkingOutput,
      value: `${formatIntegerTokens(display.textOutputTokens)} / ${formatIntegerTokens(display.reasoningOutputTokens)} tok`,
    },
  ];

  return (
    <div
      data-telemetry-popover="stats"
      className="flex w-[320px] max-w-[calc(100vw-1.5rem)] flex-col p-4 text-popover-foreground"
    >
      <div className="flex items-center justify-between gap-3 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <GaugeIcon aria-hidden="true" className="size-4 shrink-0 text-foreground" />
          <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">
            {copy.statsTitle}
          </span>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {copy.formatRoundsStepsSamples(display.rounds, display.steps, display.samples)}
        </span>
      </div>

      <div className="flex flex-col gap-2.5 border-t border-border/65 pt-3 text-[13px] dark:border-white/10">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="text-right font-medium text-foreground tabular-nums">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SessionTokenUsagePopoverContent({
  display,
  copy,
  onOpenUsage,
}: {
  readonly display: ResolvedTelemetryDisplay;
  readonly copy: SessionTelemetryCopy;
  readonly onOpenUsage: () => void;
}) {
  const detailRows: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly value: string;
  }> = [
    {
      key: "cache-hit",
      label: copy.cacheHit,
      value: formatCacheHitRate(display.cacheHitRate),
    },
    {
      key: "uncached-input",
      label: copy.uncachedInput,
      value: `${formatIntegerTokens(display.uncachedInputTokens)} tok`,
    },
    {
      key: "cache-read",
      label: copy.cacheRead,
      value: `${formatIntegerTokens(display.cachedInputTokens)} tok`,
    },
    {
      key: "output",
      label: copy.output,
      value: `${formatIntegerTokens(display.outputTokens)} tok`,
    },
    {
      key: "aggregated-task-tokens",
      label: copy.aggregatedTaskTokens,
      value: `${formatIntegerTokens(display.aggregatedTaskTotalTokens)} tok`,
    },
    {
      key: "subagents",
      label: copy.formatSubagentsLabel(display.subagentCount),
      value: `${formatIntegerTokens(display.subagentTotalTokens)} tok`,
    },
  ];

  return (
    <div
      data-telemetry-popover="tokens"
      className="flex w-[348px] max-w-[calc(100vw-1.5rem)] flex-col p-4 text-popover-foreground"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <DatabaseIcon aria-hidden="true" className="size-4 shrink-0 text-foreground" />
          <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">
            {copy.tokensTitle}
          </span>
        </div>
        <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
          {`${formatIntegerTokens(display.totalTokens)} tok`}
        </span>
      </div>

      {/* Active-session 6 rows */}
      <div className="flex flex-col gap-2.5 border-t border-border/65 py-3 text-[13px] dark:border-white/10">
        {detailRows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="text-right font-medium text-foreground tabular-nums">
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {/* Multi-model distribution */}
      <div className="border-t border-border/65 py-3 dark:border-white/10">
        <div className="flex items-center justify-between gap-2 pb-2.5 text-xs text-muted-foreground">
          <span>{copy.modelDistribution}</span>
          <span className="tabular-nums">
            {copy.formatModelCount(display.modelDistribution.length)}
          </span>
        </div>

        {display.modelDistribution.length > 0 ? (
          <div className="flex items-center gap-3.5">
            <SessionModelDonutChart models={display.modelDistribution} />
            <div className="flex max-h-32 min-w-0 flex-1 flex-col gap-1.5 overflow-y-auto text-[12.5px]">
              {display.modelDistribution.map((entry) => (
                <div
                  key={entry.modelId}
                  data-telemetry-model-row={entry.modelId}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="truncate text-foreground">{entry.displayName}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {`${entry.percent}% (${entry.compactTokens})`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div
            data-telemetry-no-models="true"
            className="py-1 text-xs text-muted-foreground"
          >
            {copy.noModelSamples}
          </div>
        )}
      </div>

      {/* Global Today / This Month reference */}
      <div
        data-telemetry-global-usage="true"
        className="grid grid-cols-2 gap-4 border-t border-border/65 py-3.5 dark:border-white/10"
      >
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">{copy.todayUsage}</span>
          <div className="mt-1 flex items-baseline gap-1.5 tabular-nums">
            <span className="text-[22px] font-bold leading-none tracking-tight text-foreground">
              {formatCompactPopoverTokens(display.globalTodayTokens)}
            </span>
            <span className="text-xs text-muted-foreground">{copy.tokenUnit}</span>
          </div>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">{copy.monthUsage}</span>
          <div className="mt-1 flex items-baseline gap-1.5 tabular-nums">
            <span className="text-[22px] font-bold leading-none tracking-tight text-foreground">
              {formatCompactPopoverTokens(display.globalMonthTokens)}
            </span>
            <span className="text-xs text-muted-foreground">{copy.tokenUnit}</span>
          </div>
        </div>
      </div>

      {/* Footer link button */}
      <div className="-mx-2 -mb-2 border-t border-border/65 pt-2 dark:border-white/10">
        <button
          type="button"
          data-telemetry-open-usage="true"
          onClick={onOpenUsage}
          className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-[13px] font-medium text-foreground/90 transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/8"
        >
          <span>{copy.viewUsageStats}</span>
          <ArrowRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

export function SessionContextWindowPopoverContent({
  display,
  copy,
}: {
  readonly display: ResolvedTelemetryDisplay;
  readonly copy: SessionTelemetryCopy;
}) {
  const usedPercent =
    display.contextPercent !== null && Number.isFinite(display.contextPercent)
      ? Math.max(0, Math.round(display.contextPercent))
      : 0;
  const remainingPercent = Math.max(0, 100 - usedPercent);
  const clampedBarPercent =
    display.contextPercent !== null && Number.isFinite(display.contextPercent)
      ? Math.max(0, Math.min(100, display.contextPercent))
      : 0;

  const usedFormatted =
    display.contextUsedTokens !== null
      ? formatCompactPopoverTokens(display.contextUsedTokens)
      : "0";
  const maxFormatted =
    display.contextMaxTokens !== null
      ? formatCompactPopoverTokens(display.contextMaxTokens)
      : "—";
  const sublineText = `${usedFormatted} / ${maxFormatted} tok`;

  return (
    <div
      data-telemetry-popover="context"
      className="flex w-[320px] max-w-[calc(100vw-1.5rem)] flex-col p-4 text-popover-foreground"
    >
      {/* Header */}
      <div className="flex items-center gap-2 pb-3">
        <ContextWindowPieGlyph className="text-foreground" />
        <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">
          {copy.contextWindowTitle}
        </span>
      </div>

      {/* Main readout + progress bar */}
      <div className="border-t border-border/65 pt-3.5 pb-3 dark:border-white/10">
        <div className="text-[19px] font-bold leading-snug tracking-tight text-foreground tabular-nums">
          {copy.formatContextHeadline(usedPercent, remainingPercent)}
        </div>
        <div className="mt-1 text-[13px] text-muted-foreground tabular-nums">
          {sublineText}
        </div>
        <div
          role="progressbar"
          aria-valuenow={Math.min(100, usedPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          data-context-bar-tone={display.contextBarTone}
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-foreground/15 dark:bg-white/15"
        >
          {clampedBarPercent > 0 ? (
            <div
              data-context-bar-fill="true"
              className={cn(
                "h-full rounded-full transition-[width,background-color] duration-200 ease-out motion-reduce:transition-none",
                CONTEXT_BAR_FILL_CLASS[display.contextBarTone],
              )}
              style={{ width: `max(${clampedBarPercent}%, 4px)` }}
            />
          ) : null}
        </div>
      </div>

      {/* Sampled model & primary entrypoint */}
      <div className="flex flex-col gap-2.5 pt-2 text-[13px]">
        <div className="flex items-center justify-between gap-4">
          <span className="shrink-0 text-muted-foreground">{copy.sampledModel}</span>
          <span className="truncate text-right text-foreground">
            {display.sampledModelDisplayName ?? "—"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="shrink-0 text-muted-foreground">{copy.primaryEntrypoint}</span>
          <span className="truncate text-right font-semibold text-foreground">
            {display.primaryEntrypointId ?? "—"}
          </span>
        </div>
      </div>

      {/* Conditional multi-model notice (only when >= 2 distinct models sampled in current session) */}
      {display.hasMultipleSampledModels ? (
        <div
          data-telemetry-multi-model-note="true"
          className="mt-2.5 text-xs text-muted-foreground"
        >
          {copy.multipleModelsSampled}
        </div>
      ) : null}
    </div>
  );
}

export interface ComposerTelemetryFallbackInput {
  readonly threadId?: string | null | undefined;
  readonly detail?: SessionTelemetryDetailSnapshot | null | undefined;
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

/**
 * Resolves active-session telemetry strictly scoped to the current thread.
 * Global `mergedUsage` is NEVER surfaced on the composer trigger strip — only
 * in Popover 2's bottom `Today / This month` global reference section.
 */
export function resolveComposerTelemetryDisplay(
  live: SessionLiveTelemetrySnapshot | null,
  contextWindow: ContextWindowSnapshot | null,
  fallback?: ComposerTelemetryFallbackInput | null,
): ResolvedTelemetryDisplay {
  return resolveSessionTelemetryDisplay({
    threadId: fallback?.threadId ?? live?.threadId ?? null,
    detail: fallback?.detail ?? null,
    live,
    contextWindow,
    callLogs: fallback?.callLogs,
    mergedUsage: fallback?.mergedUsage,
    todayDay: fallback?.todayDay,
    providerStatuses: fallback?.providerStatuses,
    selectedModelId: fallback?.selectedModelId,
    selectedProvider: fallback?.selectedProvider,
  });
}

function extractBackendCallLogsFromEnvironments(
  environments: readonly EnvironmentUsageStatus[],
): readonly BackendUsageCallLogLike[] {
  const collected: BackendUsageCallLogLike[] = [];
  for (const env of environments) {
    const summary = env.summary as
      | (UsageSummary & { readonly callLogs?: readonly BackendUsageCallLogLike[] | undefined })
      | null;
    const rawLogs = summary?.callLogs;
    if (!Array.isArray(rawLogs)) continue;
    for (const entry of rawLogs) {
      if (entry) collected.push(entry);
    }
  }
  return collected;
}

export type ComposerTelemetryPlacement = "inline" | "below";

const publishedContextWindows = new Map<string, ContextWindowSnapshot | null>();
const publishedContextWindowListeners = new Set<() => void>();

function notifyPublishedContextWindows(): void {
  for (const listener of publishedContextWindowListeners) {
    listener();
  }
}

export function publishComposerContextWindow(
  threadId: string | null | undefined,
  contextWindow: ContextWindowSnapshot | null,
): void {
  if (!threadId) return;
  const previous = publishedContextWindows.get(threadId) ?? null;
  if (previous === contextWindow) return;
  publishedContextWindows.set(threadId, contextWindow);
  notifyPublishedContextWindows();
}

export function clearPublishedComposerContextWindows(): void {
  if (publishedContextWindows.size === 0) return;
  publishedContextWindows.clear();
  notifyPublishedContextWindows();
}

function subscribePublishedContextWindows(listener: () => void): () => void {
  publishedContextWindowListeners.add(listener);
  return () => {
    publishedContextWindowListeners.delete(listener);
  };
}

export function usePublishedComposerContextWindow(
  threadId: string | null | undefined,
): ContextWindowSnapshot | null {
  return useSyncExternalStore(
    subscribePublishedContextWindows,
    () => (threadId ? (publishedContextWindows.get(threadId) ?? null) : null),
    () => null,
  );
}

const TELEMETRY_POPOVER_POPUP_CLASS =
  "overflow-hidden rounded-2xl border border-border/85 bg-popover/96 text-popover-foreground bg-clip-padding p-0 shadow-[0_16px_42px_-16px_rgba(15,23,42,0.28)] dark:border-white/12 dark:bg-[#111215]/95 dark:shadow-[0_22px_54px_-14px_rgba(0,0,0,0.82)] before:hidden";

const TRIGGER_BUTTON_BASE_CLASS =
  "inline-flex h-6 min-w-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-1.5 font-normal text-foreground/82 transition-colors outline-none hover:bg-accent/75 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[open=true]:bg-accent/85 data-[open=true]:text-foreground dark:text-foreground/78 dark:hover:bg-white/10 dark:hover:text-foreground dark:data-[open=true]:bg-white/12 dark:data-[open=true]:text-foreground";

export function ComposerLiveTelemetryStripView(props: {
  readonly display: ResolvedTelemetryDisplay;
  readonly onOpenUsage: () => void;
  readonly threadId?: string | null | undefined;
  readonly compact?: boolean | undefined;
  readonly className?: string | undefined;
  readonly openPopover?: TelemetryPopoverId | null | undefined;
  readonly onOpenPopoverChange?: ((next: TelemetryPopoverId | null) => void) | undefined;
}) {
  const copy = useSessionTelemetryCopy();
  const { display, onOpenUsage, compact = false, className } = props;
  const scopeThreadId = props.threadId ?? null;

  const [uncontrolledState, setUncontrolledState] = useState<{
    readonly threadId: string | null;
    readonly popover: TelemetryPopoverId | null;
  }>({ threadId: scopeThreadId, popover: null });
  const uncontrolledOpen =
    uncontrolledState.threadId === scopeThreadId ? uncontrolledState.popover : null;
  const activePopover =
    props.openPopover !== undefined ? props.openPopover : uncontrolledOpen;

  const handlePopoverOpenChange = (target: TelemetryPopoverId, nextOpen: boolean) => {
    if (props.onOpenPopoverChange) {
      props.onOpenPopoverChange(transitionTelemetryPopover(activePopover, target, nextOpen));
      return;
    }
    setUncontrolledState((current) => {
      const effective = current.threadId === scopeThreadId ? current.popover : null;
      return {
        threadId: scopeThreadId,
        popover: transitionTelemetryPopover(effective, target, nextOpen),
      };
    });
  };

  const closeActivePopover = () => {
    if (props.onOpenPopoverChange) {
      props.onOpenPopoverChange(null);
      return;
    }
    setUncontrolledState({ threadId: scopeThreadId, popover: null });
  };

  const handleOpenUsageAndClose = () => {
    closeActivePopover();
    onOpenUsage();
  };

  const hasMeasuredTps = display.tps !== null && Number.isFinite(display.tps) && display.tps > 0;
  const tpsText = formatTelemetryStripTps(display.tps);

  const hasMeasuredTokens = display.totalTokens > 0;
  const tokensText = `${formatCompactTelemetryTokens(display.totalTokens)} tok`;
  const cacheHitFormatted = formatCacheHitRate(display.cacheHitRate);
  const showInlineCacheHit = hasMeasuredTokens && display.cacheHitRate !== null;
  const tokensInlineAriaSummary = showInlineCacheHit
    ? `${tokensText} · ${copy.formatCacheHitInline(cacheHitFormatted)}`
    : tokensText;

  const contextPctText =
    display.contextPercent !== null ? `${Math.round(display.contextPercent)}%` : "—";
  const contextLabel = copy.formatContextInline(contextPctText);

  return (
    <div
      data-composer-live-telemetry="true"
      data-telemetry-placement={compact ? "inline" : "below"}
      data-context-tone={display.contextTone}
      data-tokens-scope={display.tokensScope}
      data-tps-scope={display.tpsScope}
      data-open-popover={activePopover ?? "none"}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center tabular-nums",
        compact ? "shrink gap-0.5 text-[11px]" : "ms-auto shrink-0 gap-1 text-xs",
        "[[data-pmx-wallpaper='1']_&]:[text-shadow:0_1px_2px_rgba(0,0,0,0.28)] [[data-pmx-wallpaper-visible='1']_&]:[text-shadow:0_1px_2px_rgba(0,0,0,0.28)] [[data-pmx-glass='1']_&]:[text-shadow:0_1px_2px_rgba(0,0,0,0.22)]",
        className,
      )}
    >
      {/* Trigger 1: Output Speed (tok/s) → Independent Popover 1 (Session Stats) */}
      <Popover
        open={activePopover === "stats"}
        onOpenChange={(nextOpen) => handlePopoverOpenChange("stats", nextOpen)}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              data-telemetry-trigger="stats"
              data-telemetry-tps="true"
              data-telemetry-measured={hasMeasuredTps ? "true" : "false"}
              data-open={activePopover === "stats" ? "true" : "false"}
              aria-label={copy.statsTriggerAria(tpsText)}
              className={TRIGGER_BUTTON_BASE_CLASS}
            />
          }
        >
          <GaugeIcon
            aria-hidden="true"
            className={cn(
              "size-3 shrink-0",
              display.active ? "text-emerald-500 dark:text-emerald-400" : "opacity-80",
            )}
          />
          <span className={cn(hasMeasuredTps ? "font-medium text-foreground" : "opacity-75")}>
            {tpsText}
          </span>
        </PopoverTrigger>
        <PopoverPopup
          side="top"
          align="end"
          sideOffset={8}
          padding="none"
          collisionAvoidance={{ side: "flip", align: "shift" }}
          className={TELEMETRY_POPOVER_POPUP_CLASS}
        >
          <SessionStatsPopoverContent display={display} copy={copy} />
        </PopoverPopup>
      </Popover>

      {/* Trigger 2: Session Tokens & Cache Hit → Independent Popover 2 (Token Usage) */}
      <Popover
        open={activePopover === "tokens"}
        onOpenChange={(nextOpen) => handlePopoverOpenChange("tokens", nextOpen)}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              data-telemetry-trigger="tokens"
              data-telemetry-tokens="true"
              data-telemetry-measured={hasMeasuredTokens ? "true" : "false"}
              data-open={activePopover === "tokens" ? "true" : "false"}
              aria-label={copy.tokensTriggerAria(tokensInlineAriaSummary)}
              className={TRIGGER_BUTTON_BASE_CLASS}
            />
          }
        >
          <DatabaseIcon aria-hidden="true" className="size-3 shrink-0 opacity-80" />
          <span className={cn(hasMeasuredTokens ? "text-foreground/90" : "opacity-75")}>
            <span className={cn(hasMeasuredTokens && "font-medium text-foreground")}>
              {tokensText}
            </span>
            {showInlineCacheHit ? ` · ${copy.formatCacheHitInline(cacheHitFormatted)}` : null}
          </span>
        </PopoverTrigger>
        <PopoverPopup
          side="top"
          align="end"
          sideOffset={8}
          padding="none"
          collisionAvoidance={{ side: "flip", align: "shift" }}
          className={TELEMETRY_POPOVER_POPUP_CLASS}
        >
          <SessionTokenUsagePopoverContent
            display={display}
            copy={copy}
            onOpenUsage={handleOpenUsageAndClose}
          />
        </PopoverPopup>
      </Popover>

      {/* Trigger 3: Context Window Ring → Independent Popover 3 (Context Window) */}
      <Popover
        open={activePopover === "context"}
        onOpenChange={(nextOpen) => handlePopoverOpenChange("context", nextOpen)}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              data-telemetry-trigger="context"
              data-telemetry-context="true"
              data-open={activePopover === "context" ? "true" : "false"}
              aria-label={copy.contextTriggerAria(contextLabel)}
              className={cn(TRIGGER_BUTTON_BASE_CLASS, RING_TEXT_CLASS[display.contextTone])}
            />
          }
        >
          <ContextProgressRing percent={display.contextPercent} />
          <span className={cn(display.contextPercent !== null && "font-medium")}>
            {contextLabel}
          </span>
        </PopoverTrigger>
        <PopoverPopup
          side="top"
          align="end"
          sideOffset={8}
          padding="none"
          collisionAvoidance={{ side: "flip", align: "shift" }}
          className={TELEMETRY_POPOVER_POPUP_CLASS}
        >
          <SessionContextWindowPopoverContent display={display} copy={copy} />
        </PopoverPopup>
      </Popover>
    </div>
  );
}

export const ComposerLiveTelemetryStrip = memo(function ComposerLiveTelemetryStrip(props: {
  readonly threadId: string | null;
  readonly contextWindow: ContextWindowSnapshot | null;
  readonly placement?: ComposerTelemetryPlacement | undefined;
  readonly providerStatuses?: readonly ServerProvider[] | undefined;
  readonly selectedModelId?: string | null | undefined;
  readonly selectedProvider?: string | null | undefined;
  readonly onOpenUsage?: () => void;
  readonly className?: string | undefined;
}) {
  const placement = props.placement ?? "below";
  const navigate = useNavigate();
  const live = useSessionLiveTelemetry(props.threadId);
  const detail = useSessionTelemetryDetail(props.threadId);
  const publishedContextWindow = usePublishedComposerContextWindow(
    placement === "inline" && props.contextWindow === null ? props.threadId : null,
  );
  const effectiveContextWindow = props.contextWindow ?? publishedContextWindow;

  // Bridge contextWindow published by legacy below-composer mounts to the AGY inline strip.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- mirrors parent ContextWindowSnapshot to inline composer strip without duplicating DOM
  useEffect(() => {
    if (placement !== "below") return;
    publishComposerContextWindow(props.threadId, props.contextWindow);
  }, [placement, props.contextWindow, props.threadId]);

  const usageWindow = (() => {
    const base = makeWindow(30, undefined, "day");
    const dayOfMonth = Number.parseInt(base.untilDay.slice(8, 10), 10);
    return dayOfMonth >= 31 ? makeWindow(31, undefined, "day") : base;
  })();
  const usage = useUsage(usageWindow);
  const backendLogs = extractBackendCallLogsFromEnvironments(usage.environments);
  const mergedLogs = useUsageCallLogs(backendLogs);

  const display = resolveComposerTelemetryDisplay(live, effectiveContextWindow, {
    threadId: props.threadId,
    detail,
    callLogs: mergedLogs,
    mergedUsage: usage.shown?.merged ?? usage.merged,
    todayDay: usageWindow.untilDay,
    providerStatuses: props.providerStatuses,
    selectedModelId: props.selectedModelId,
    selectedProvider: props.selectedProvider,
  });

  const handleOpenUsage = () => {
    if (props.onOpenUsage) {
      props.onOpenUsage();
      return;
    }
    void navigate({ to: "/usage" });
  };

  if (placement === "inline") {
    return (
      <ComposerLiveTelemetryStripView
        display={display}
        threadId={props.threadId}
        onOpenUsage={handleOpenUsage}
        compact
        className={props.className}
      />
    );
  }

  return (
    <>
      <ComposerWorkspaceLocationBar
        variant="below"
        className="order-first [[data-slot=composer-shell]:has([data-pmx-composer-layout=agy])_&]:hidden"
      />
      <ComposerLiveTelemetryStripView
        display={display}
        threadId={props.threadId}
        onOpenUsage={handleOpenUsage}
        className={cn(
          "[[data-slot=composer-shell]:has([data-pmx-composer-layout=agy])_&]:hidden",
          props.className,
        )}
      />
    </>
  );
});
