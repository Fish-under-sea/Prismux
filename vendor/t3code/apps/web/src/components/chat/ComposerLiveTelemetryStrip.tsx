import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import type { UsageSummary } from "@t3tools/contracts";
import { makeWindow } from "@t3tools/shared/usageFormat";
import type { MergedUsage } from "@t3tools/shared/usageMerge";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { DatabaseIcon, GaugeIcon } from "lucide-react";
import { memo, useEffect, useMemo, useSyncExternalStore } from "react";

import { cn } from "~/lib/utils";
import { useUsage, type EnvironmentUsageStatus } from "~/state/usage";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  computeCacheHitRate,
  formatCacheHitRate,
  formatTtft,
  useSessionLiveTelemetry,
  useUsageCallLogs,
  type BackendUsageCallLogLike,
  type SessionLiveTelemetrySnapshot,
  type UsageCallLogRecord,
} from "../usage/usageCallTelemetryStore";
import { ComposerWorkspaceLocationBar } from "./ComposerWorkspaceLocationBar";
import { deriveContextOccupancyPercent } from "./useSessionCallTelemetry";

export type ContextRingTone = "unknown" | "normal" | "warning" | "compact" | "overflow";
export type TelemetryMetricScope = "session" | "recent" | "none";

/**
 * Classifies context occupancy into Spec 3's 4-tier color bands:
 * - `< 60%`     → emerald green (`normal`)
 * - `60–94.9%`  → amber (`warning`)
 * - `95–100%`   → orange (`compact`)
 * - `> 100%`    → red (`overflow`)
 */
export function resolveContextRingTone(contextPercent: number | null | undefined): ContextRingTone {
  if (typeof contextPercent !== "number" || !Number.isFinite(contextPercent) || contextPercent < 0) {
    return "unknown";
  }
  if (contextPercent > 100) return "overflow";
  if (contextPercent >= 95) return "compact";
  if (contextPercent >= 60) return "warning";
  return "normal";
}

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
 * Formats output generation throughput for the composer strip (always 1 decimal when measured,
 * e.g. `111.2 tok/s`, or `— tok/s` when no real speed has been measured yet).
 */
export function formatTelemetryStripTps(tps: number | null | undefined): string {
  if (typeof tps !== "number" || !Number.isFinite(tps) || tps <= 0) {
    return "— tok/s";
  }
  return `${tps.toFixed(1)} tok/s`;
}

const RING_STROKE_CLASS: Readonly<Record<ContextRingTone, string>> = {
  unknown: "stroke-foreground/35 dark:stroke-foreground/35",
  normal: "stroke-emerald-500 dark:stroke-emerald-400",
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
        className="stroke-foreground/20 dark:stroke-foreground/25"
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

export interface ComposerTelemetryFallbackInput {
  readonly threadId?: string | null | undefined;
  readonly callLogs?: readonly UsageCallLogRecord[] | undefined;
  readonly mergedUsage?:
    | Pick<
        MergedUsage,
        "totalTokens" | "uncachedInputTokens" | "cachedInputTokens" | "cacheCreationTokens"
      >
    | null
    | undefined;
}

export interface ResolvedTelemetryDisplay {
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
  readonly active: boolean;
}

function summarizeLogsForThread(
  logs: readonly UsageCallLogRecord[],
  threadId: string | null | undefined,
): {
  readonly totalTokens: number;
  readonly cacheHitRate: number | null;
  readonly latestTps: number | null;
  readonly latestTtftMs: number | null;
} {
  if (!threadId || logs.length === 0) {
    return { totalTokens: 0, cacheHitRate: null, latestTps: null, latestTtftMs: null };
  }
  let totalTokens = 0;
  let uncached = 0;
  let cached = 0;
  let cacheCreate = 0;
  let latestTps: number | null = null;
  let latestTtftMs: number | null = null;

  for (const log of logs) {
    if (log.threadId !== threadId) continue;
    totalTokens += log.totalTokens;
    uncached += log.inputTokens;
    cached += log.cachedInputTokens;
    cacheCreate += log.cacheCreationTokens;
    if (latestTps === null && log.tps !== null && Number.isFinite(log.tps) && log.tps > 0) {
      latestTps = log.tps;
    }
    if (latestTtftMs === null && log.ttftMs !== null && Number.isFinite(log.ttftMs)) {
      latestTtftMs = log.ttftMs;
    }
  }

  return {
    totalTokens,
    cacheHitRate: computeCacheHitRate(uncached, cached, cacheCreate),
    latestTps,
    latestTtftMs,
  };
}

function summarizeRecentGlobalLogs(logs: readonly UsageCallLogRecord[]): {
  readonly totalTokens: number;
  readonly cacheHitRate: number | null;
  readonly latestTps: number | null;
  readonly latestTtftMs: number | null;
} {
  let totalTokens = 0;
  let uncached = 0;
  let cached = 0;
  let cacheCreate = 0;
  let latestTps: number | null = null;
  let latestTtftMs: number | null = null;

  for (const log of logs) {
    totalTokens += log.totalTokens;
    uncached += log.inputTokens;
    cached += log.cachedInputTokens;
    cacheCreate += log.cacheCreationTokens;
    if (latestTps === null && log.tps !== null && Number.isFinite(log.tps) && log.tps > 0) {
      latestTps = log.tps;
    }
    if (latestTtftMs === null && log.ttftMs !== null && Number.isFinite(log.ttftMs)) {
      latestTtftMs = log.ttftMs;
    }
  }

  return {
    totalTokens,
    cacheHitRate: computeCacheHitRate(uncached, cached, cacheCreate),
    latestTps,
    latestTtftMs,
  };
}

/**
 * Resolves real below-composer telemetry display prioritizing:
 * 1. Current session live snapshot / context window / persisted thread call logs.
 * 2. Real recent global usage summary & call logs (when current session is fresh/empty)
 *    so the 3-segment strip displays real cumulative throughput & cache hit rate without
 *    ever fabricating numbers.
 */
export function resolveComposerTelemetryDisplay(
  live: SessionLiveTelemetrySnapshot | null,
  contextWindow: ContextWindowSnapshot | null,
  fallback?: ComposerTelemetryFallbackInput | null,
): ResolvedTelemetryDisplay {
  const contextPercent = live?.contextPercent ?? deriveContextOccupancyPercent(contextWindow);
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

  const logs = fallback?.callLogs ?? [];
  const threadSummary = summarizeLogsForThread(logs, fallback?.threadId ?? live?.threadId ?? null);
  const recentSummary = summarizeRecentGlobalLogs(logs);

  // 1. Session-scoped tokens & cache hit rate
  const contextWindowFallbackTotal = contextWindow
    ? Math.max(contextWindow.totalProcessedTokens ?? 0, contextWindow.usedTokens ?? 0)
    : 0;
  const sessionTotalTokens = Math.max(
    live?.sessionTotalTokens ?? 0,
    live?.totalTokens ?? 0,
    contextWindowFallbackTotal,
    threadSummary.totalTokens,
  );

  let sessionCacheHitRate = live?.cacheHitRate ?? null;
  if (sessionCacheHitRate === null && contextWindow) {
    const cached = contextWindow.lastCachedInputTokens ?? contextWindow.cachedInputTokens ?? 0;
    const rawInput = contextWindow.lastInputTokens ?? contextWindow.inputTokens ?? 0;
    const uncached = Math.max(0, rawInput - cached);
    sessionCacheHitRate = computeCacheHitRate(uncached, cached, 0);
  }
  if (sessionCacheHitRate === null) {
    sessionCacheHitRate = threadSummary.cacheHitRate;
  }

  // 2. Fallback to real recent / 30d UsageSummary when the current thread has 0 tokens so far.
  let totalTokens = sessionTotalTokens;
  let cacheHitRate = sessionCacheHitRate;
  let tokensScope: TelemetryMetricScope = sessionTotalTokens > 0 ? "session" : "none";

  if (totalTokens <= 0) {
    const mergedUsage = fallback?.mergedUsage ?? null;
    if (mergedUsage && mergedUsage.totalTokens > 0) {
      totalTokens = mergedUsage.totalTokens;
      cacheHitRate = computeCacheHitRate(
        mergedUsage.uncachedInputTokens,
        mergedUsage.cachedInputTokens,
        mergedUsage.cacheCreationTokens,
      );
      tokensScope = "recent";
    } else if (recentSummary.totalTokens > 0) {
      totalTokens = recentSummary.totalTokens;
      cacheHitRate = recentSummary.cacheHitRate;
      tokensScope = "recent";
    }
  }

  // 3. Speed (TPS): live streaming/session turn -> thread log -> most recent real recorded turn
  const sessionTps = live?.tps ?? threadSummary.latestTps ?? null;
  const tps = sessionTps ?? recentSummary.latestTps ?? null;
  const tpsScope: TelemetryMetricScope =
    sessionTps !== null ? "session" : tps !== null ? "recent" : "none";

  const ttftMs = live?.ttftMs ?? threadSummary.latestTtftMs ?? recentSummary.latestTtftMs ?? null;

  return {
    tps,
    tpsScope,
    ttftMs,
    totalTokens,
    tokensScope,
    cacheHitRate,
    contextPercent,
    contextUsedTokens,
    contextMaxTokens,
    contextTone: resolveContextRingTone(contextPercent),
    active: live?.active === true,
  };
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

export function ComposerLiveTelemetryStripView(props: {
  readonly display: ResolvedTelemetryDisplay;
  readonly onOpenUsage: () => void;
  readonly compact?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  const gt = useGT();
  const { display, onOpenUsage, compact = false, className } = props;

  const hasMeasuredTps = display.tps !== null && Number.isFinite(display.tps) && display.tps > 0;
  const tpsText = formatTelemetryStripTps(display.tps);

  const hasMeasuredTokens = display.totalTokens > 0;
  const tokensText = `${formatCompactTelemetryTokens(display.totalTokens)} tok`;
  const cacheHitFormatted = formatCacheHitRate(display.cacheHitRate);
  const cacheHitLabel = gt("Cache hit {rate}", { rate: cacheHitFormatted });

  const contextPctText =
    display.contextPercent !== null ? `${Math.round(display.contextPercent)}%` : "—";
  const contextLabel = gt("Context {percent}", { percent: contextPctText });

  const exactContextReadout =
    display.contextUsedTokens !== null && display.contextMaxTokens !== null
      ? `${display.contextUsedTokens.toLocaleString()} / ${display.contextMaxTokens.toLocaleString()} (${contextPctText})`
      : contextPctText;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-composer-live-telemetry="true"
            data-telemetry-placement={compact ? "inline" : "below"}
            data-context-tone={display.contextTone}
            data-tokens-scope={display.tokensScope}
            data-tps-scope={display.tpsScope}
            onClick={onOpenUsage}
            aria-label={gt("Open usage and call logs ({context})", { context: contextLabel })}
            className={cn(
              "inline-flex h-6 min-w-0 max-w-full cursor-pointer items-center overflow-x-clip rounded-md px-1.5 font-normal tabular-nums text-foreground/82 transition-colors outline-none hover:bg-accent/70 hover:text-foreground focus-visible:ring-1 focus-visible:ring-foreground/25 dark:text-foreground/78 dark:hover:bg-white/10 dark:hover:text-foreground",
              compact ? "shrink gap-2 text-[11px]" : "ms-auto shrink-0 gap-2.5 text-xs",
              "[[data-pmx-wallpaper='1']_&]:[text-shadow:0_1px_2px_rgba(0,0,0,0.28)] [[data-pmx-wallpaper-visible='1']_&]:[text-shadow:0_1px_2px_rgba(0,0,0,0.28)] [[data-pmx-glass='1']_&]:[text-shadow:0_1px_2px_rgba(0,0,0,0.22)]",
              className,
            )}
          />
        }
      >
        {/* Segment 1: Output Speed (tok/s) — always rendered */}
        <span
          data-telemetry-tps="true"
          data-telemetry-measured={hasMeasuredTps ? "true" : "false"}
          className="inline-flex items-center gap-1 whitespace-nowrap"
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
        </span>

        {/* Segment 2: Tokens & Cache Hit Rate — always rendered */}
        <span
          data-telemetry-tokens="true"
          data-telemetry-measured={hasMeasuredTokens ? "true" : "false"}
          className="inline-flex items-center gap-1 whitespace-nowrap"
        >
          <DatabaseIcon aria-hidden="true" className="size-3 shrink-0 opacity-80" />
          <span className={cn(hasMeasuredTokens ? "text-foreground/90" : "opacity-75")}>
            <span className={cn(hasMeasuredTokens && "font-medium text-foreground")}>
              {tokensText}
            </span>
            {` · ${cacheHitLabel}`}
          </span>
        </span>

        {/* Segment 3: Context Progress Ring — always rendered */}
        <span
          data-telemetry-context="true"
          className={cn(
            "inline-flex items-center gap-1 whitespace-nowrap",
            RING_TEXT_CLASS[display.contextTone],
          )}
        >
          <ContextProgressRing percent={display.contextPercent} />
          <span className={cn(display.contextPercent !== null && "font-medium")}>
            {contextLabel}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipPopup
        data-pmx-glass-zone="overlays"
        side="top"
        align="end"
        className="max-w-80"
      >
        <div className="flex flex-col gap-1 text-xs tabular-nums">
          <div className="font-medium text-foreground">{gt("Live session telemetry")}</div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span>{gt("First token (TTFT)")}</span>
            <span className="text-foreground">{formatTtft(display.ttftMs)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span>{gt("Output speed")}</span>
            <span className="text-foreground">{tpsText}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span>{display.tokensScope === "recent" ? gt("Usage") : gt("Session tokens")}</span>
            <span className="text-foreground">
              {display.totalTokens > 0 ? display.totalTokens.toLocaleString() : "0"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span>{gt("Cache hit rate")}</span>
            <span className="text-foreground">{cacheHitFormatted}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span>{gt("Context occupancy")}</span>
            <span className="text-foreground">{exactContextReadout}</span>
          </div>
          <div className="border-t border-border/60 pt-1 text-[11px] text-muted-foreground">
            {gt("Click to open Usage & Call Logs")}
          </div>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

export const ComposerLiveTelemetryStrip = memo(function ComposerLiveTelemetryStrip(props: {
  readonly threadId: string | null;
  readonly contextWindow: ContextWindowSnapshot | null;
  readonly placement?: ComposerTelemetryPlacement | undefined;
  readonly onOpenUsage?: () => void;
  readonly className?: string | undefined;
}) {
  const placement = props.placement ?? "below";
  const navigate = useNavigate();
  const live = useSessionLiveTelemetry(props.threadId);
  const publishedContextWindow = usePublishedComposerContextWindow(
    placement === "inline" && props.contextWindow === null ? props.threadId : null,
  );
  const effectiveContextWindow = props.contextWindow ?? publishedContextWindow;

  // Bridge contextWindow published by legacy below-composer mounts to the AGY inline strip.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors parent ContextWindowSnapshot to inline composer strip without duplicating DOM
  useEffect(() => {
    if (placement !== "below") return;
    publishComposerContextWindow(props.threadId, props.contextWindow);
  }, [placement, props.contextWindow, props.threadId]);

  const usageWindow = useMemo(() => makeWindow(30, undefined, "day"), []);
  const usage = useUsage(usageWindow);
  const backendLogs = useMemo(
    () => extractBackendCallLogsFromEnvironments(usage.environments),
    [usage.environments],
  );
  const mergedLogs = useUsageCallLogs(backendLogs);

  const display = resolveComposerTelemetryDisplay(live, effectiveContextWindow, {
    threadId: props.threadId,
    callLogs: mergedLogs,
    mergedUsage: usage.shown?.merged ?? usage.merged,
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
        onOpenUsage={handleOpenUsage}
        className={cn(
          "[[data-slot=composer-shell]:has([data-pmx-composer-layout=agy])_&]:hidden",
          props.className,
        )}
      />
    </>
  );
});
