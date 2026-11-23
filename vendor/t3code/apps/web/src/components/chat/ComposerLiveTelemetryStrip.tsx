import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { DatabaseIcon, GaugeIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  computeCacheHitRate,
  formatCacheHitRate,
  formatTps,
  formatTtft,
  useSessionLiveTelemetry,
  type SessionLiveTelemetrySnapshot,
} from "../usage/usageCallTelemetryStore";
import { deriveContextOccupancyPercent } from "./useSessionCallTelemetry";

export type ContextRingTone = "unknown" | "normal" | "warning" | "compact" | "overflow";

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
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 1 : 2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}k`;
  }
  return String(Math.round(tokens));
}

const RING_STROKE_CLASS: Readonly<Record<ContextRingTone, string>> = {
  unknown: "stroke-muted-foreground/45",
  normal: "stroke-emerald-500 dark:stroke-emerald-400",
  warning: "stroke-amber-500 dark:stroke-amber-400",
  compact: "stroke-orange-500 dark:stroke-orange-400",
  overflow: "stroke-red-500 dark:stroke-red-400",
};

const RING_TEXT_CLASS: Readonly<Record<ContextRingTone, string>> = {
  unknown: "text-muted-foreground",
  normal: "text-foreground/80 dark:text-muted-foreground",
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
        className="stroke-foreground/15 dark:stroke-foreground/20"
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

export interface ResolvedTelemetryDisplay {
  readonly tps: number | null;
  readonly ttftMs: number | null;
  readonly totalTokens: number;
  readonly cacheHitRate: number | null;
  readonly contextPercent: number | null;
  readonly contextTone: ContextRingTone;
  readonly active: boolean;
}

export function resolveComposerTelemetryDisplay(
  live: SessionLiveTelemetrySnapshot | null,
  contextWindow: ContextWindowSnapshot | null,
): ResolvedTelemetryDisplay {
  const contextPercent = live?.contextPercent ?? deriveContextOccupancyPercent(contextWindow);

  const fallbackTotal = contextWindow
    ? Math.max(contextWindow.totalProcessedTokens ?? 0, contextWindow.usedTokens ?? 0)
    : 0;
  const totalTokens = Math.max(live?.sessionTotalTokens ?? 0, live?.totalTokens ?? 0, fallbackTotal);

  let cacheHitRate = live?.cacheHitRate ?? null;
  if (cacheHitRate === null && contextWindow) {
    const cached = contextWindow.lastCachedInputTokens ?? contextWindow.cachedInputTokens ?? 0;
    const rawInput = contextWindow.lastInputTokens ?? contextWindow.inputTokens ?? 0;
    const uncached = Math.max(0, rawInput - cached);
    cacheHitRate = computeCacheHitRate(uncached, cached, 0);
  }

  return {
    tps: live?.tps ?? null,
    ttftMs: live?.ttftMs ?? null,
    totalTokens,
    cacheHitRate,
    contextPercent,
    contextTone: resolveContextRingTone(contextPercent),
    active: live?.active === true,
  };
}

export function ComposerLiveTelemetryStripView(props: {
  readonly display: ResolvedTelemetryDisplay;
  readonly onOpenUsage: () => void;
  readonly className?: string | undefined;
}) {
  const gt = useGT();
  const { display, onOpenUsage, className } = props;

  const contextPctText =
    display.contextPercent !== null ? `${Math.round(display.contextPercent)}%` : "—";
  const tpsText = display.tps !== null ? formatTps(display.tps) : null;
  const cacheHitText =
    display.cacheHitRate !== null ? formatCacheHitRate(display.cacheHitRate) : null;
  const tokensText =
    display.totalTokens > 0 ? `${formatCompactTelemetryTokens(display.totalTokens)} tok` : null;

  const contextLabel = gt("Context {percent}", { percent: contextPctText });
  const cacheHitLabel =
    cacheHitText !== null ? gt("Cache hit {rate}", { rate: cacheHitText }) : null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-composer-live-telemetry="true"
            data-context-tone={display.contextTone}
            onClick={onOpenUsage}
            aria-label={gt("Open usage and call logs ({context})", { context: contextLabel })}
            className={cn(
              "ms-auto inline-flex h-6 max-w-full shrink-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-xs font-normal tabular-nums text-foreground/75 transition-colors outline-none hover:bg-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:text-muted-foreground dark:hover:text-foreground",
              className,
            )}
          />
        }
      >
        {tpsText ? (
          <span
            data-telemetry-tps="true"
            className="hidden items-center gap-1 whitespace-nowrap @md/composer-surface:inline-flex"
          >
            <GaugeIcon
              aria-hidden="true"
              className={cn("size-3 shrink-0", display.active && "text-emerald-500")}
            />
            <span>{tpsText}</span>
          </span>
        ) : null}

        {tokensText ? (
          <span
            data-telemetry-tokens="true"
            className="hidden items-center gap-1 whitespace-nowrap @lg/composer-surface:inline-flex"
          >
            <DatabaseIcon aria-hidden="true" className="size-3 shrink-0" />
            <span>
              {tokensText}
              {cacheHitLabel ? ` · ${cacheHitLabel}` : ""}
            </span>
          </span>
        ) : null}

        <span
          data-telemetry-context="true"
          className={cn(
            "inline-flex items-center gap-1 whitespace-nowrap",
            RING_TEXT_CLASS[display.contextTone],
          )}
        >
          <ContextProgressRing percent={display.contextPercent} />
          <span>{contextLabel}</span>
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top" align="end" className="max-w-72">
        <div className="flex flex-col gap-1 text-xs tabular-nums">
          <div className="font-medium text-foreground">{gt("Live session telemetry")}</div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span>{gt("First token (TTFT)")}</span>
            <span className="text-foreground">{formatTtft(display.ttftMs)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span>{gt("Output speed")}</span>
            <span className="text-foreground">{formatTps(display.tps)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span>{gt("Session tokens")}</span>
            <span className="text-foreground">
              {display.totalTokens > 0 ? display.totalTokens.toLocaleString() : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span>{gt("Cache hit rate")}</span>
            <span className="text-foreground">{formatCacheHitRate(display.cacheHitRate)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span>{gt("Context occupancy")}</span>
            <span className="text-foreground">{contextPctText}</span>
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
  readonly onOpenUsage?: () => void;
  readonly className?: string | undefined;
}) {
  const navigate = useNavigate();
  const live = useSessionLiveTelemetry(props.threadId);
  const display = resolveComposerTelemetryDisplay(live, props.contextWindow);

  const handleOpenUsage = () => {
    if (props.onOpenUsage) {
      props.onOpenUsage();
      return;
    }
    void navigate({ to: "/usage" });
  };

  return (
    <ComposerLiveTelemetryStripView
      display={display}
      onOpenUsage={handleOpenUsage}
      className={props.className}
    />
  );
});
