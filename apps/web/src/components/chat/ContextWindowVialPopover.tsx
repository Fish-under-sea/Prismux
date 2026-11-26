import { useId, useState, type CSSProperties } from "react";

import { cn } from "~/lib/utils";
import type { SessionTelemetryCopy } from "./sessionTelemetry.copy";
import {
  computeContextVialTicks,
  formatContextBreakdownTokens,
  type ContextBarTone,
  type ContextBreakdownCategory,
  type ResolvedTelemetryDisplay,
} from "./sessionTelemetry.logic";
import "./ContextWindowVialPopover.css";

// oxlint-disable-next-line prismux/no-em-dash-copy -- tabular empty-metric placeholder for unmeasured numbers
const EMPTY_METRIC_DASH = "—";

interface VialLiquidPalette {
  readonly top: string;
  readonly mid: string;
  readonly bot: string;
  readonly crest: string;
  readonly glow: string;
  readonly textClass: string;
}

const VIAL_PALETTES: Readonly<Record<ContextBarTone, VialLiquidPalette>> = {
  unknown: {
    top: "#94a3b8",
    mid: "#64748b",
    bot: "#334155",
    crest: "#e2e8f0",
    glow: "rgba(148, 163, 184, 0.24)",
    textClass: "text-muted-foreground",
  },
  normal: {
    top: "#6ee7b7",
    mid: "#10b981",
    bot: "#065f46",
    crest: "#d1fae5",
    glow: "rgba(16, 185, 129, 0.42)",
    textClass: "text-emerald-700 dark:text-emerald-400",
  },
  warning: {
    top: "#fde047",
    mid: "#f59e0b",
    bot: "#92400e",
    crest: "#fef3c7",
    glow: "rgba(245, 158, 11, 0.44)",
    textClass: "text-amber-700 dark:text-amber-400",
  },
  critical: {
    top: "#fda4af",
    mid: "#f43f5e",
    bot: "#881337",
    crest: "#ffe4e6",
    glow: "rgba(244, 63, 94, 0.46)",
    textClass: "text-rose-700 dark:text-rose-400",
  },
};

const VIAL_VIEWBOX_W = 104;
const VIAL_VIEWBOX_H = 196;
const TUBE_X = 16;
const TUBE_Y = 10;
const TUBE_W = 72;
const TUBE_H = 176;
const TUBE_R_TOP = 12;
const TUBE_R_BOT = 31;
const WALL = 3;
const INNER_X = TUBE_X + WALL;
const INNER_Y = TUBE_Y + WALL;
const INNER_W = TUBE_W - WALL * 2;
const INNER_H = TUBE_H - WALL * 2;
const INNER_R_TOP = TUBE_R_TOP - 2.5;
const INNER_R_BOT = TUBE_R_BOT - 2.5;

const SEEDED_BUBBLES: ReadonlyArray<{
  readonly id: string;
  readonly cxRatio: number;
  readonly bottomOffsetRatio: number;
  readonly r: number;
  readonly durationSec: number;
  readonly delaySec: number;
}> = [
  {
    id: "b-low-left",
    cxRatio: 0.28,
    bottomOffsetRatio: 0.22,
    r: 2.1,
    durationSec: 4.8,
    delaySec: 0,
  },
  {
    id: "b-low-right",
    cxRatio: 0.66,
    bottomOffsetRatio: 0.14,
    r: 1.7,
    durationSec: 5.6,
    delaySec: 1.2,
  },
  {
    id: "b-mid-center",
    cxRatio: 0.44,
    bottomOffsetRatio: 0.52,
    r: 1.6,
    durationSec: 4.4,
    delaySec: 2.3,
  },
  {
    id: "b-high-left",
    cxRatio: 0.25,
    bottomOffsetRatio: 0.72,
    r: 2.3,
    durationSec: 6.1,
    delaySec: 0.7,
  },
  {
    id: "b-mid-right",
    cxRatio: 0.74,
    bottomOffsetRatio: 0.44,
    r: 1.4,
    durationSec: 5.1,
    delaySec: 3.1,
  },
];

function buildTestTubePath(
  x: number,
  y: number,
  w: number,
  h: number,
  rTop: number,
  rBot: number,
): string {
  const rt = Math.min(rTop, w * 0.5, h * 0.5);
  const rb = Math.min(rBot, w * 0.5, h * 0.5);
  return [
    `M ${x + rt} ${y}`,
    `L ${x + w - rt} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rt}`,
    `L ${x + w} ${y + h - rb}`,
    `Q ${x + w} ${y + h} ${x + w - rb} ${y + h}`,
    `L ${x + rb} ${y + h}`,
    `Q ${x} ${y + h} ${x} ${y + h - rb}`,
    `L ${x} ${y + rt}`,
    `Q ${x} ${y} ${x + rt} ${y}`,
    "Z",
  ].join(" ");
}

const OUTER_TUBE_PATH = buildTestTubePath(TUBE_X, TUBE_Y, TUBE_W, TUBE_H, TUBE_R_TOP, TUBE_R_BOT);
const INNER_TUBE_PATH = buildTestTubePath(
  INNER_X,
  INNER_Y,
  INNER_W,
  INNER_H,
  INNER_R_TOP,
  INNER_R_BOT,
);

function computeHighlightedStratum(
  categories: readonly ContextBreakdownCategory[],
  highlightedKey: string | null,
  liquidHeight: number,
): { readonly y: number; readonly height: number } | null {
  if (!highlightedKey || highlightedKey === "free" || liquidHeight <= 0) return null;
  const active = categories.filter((c) => c.group !== "free" && c.tokens > 0);
  const total = active.reduce((acc, c) => acc + c.tokens, 0);
  if (total <= 0) return null;
  let cursor = 0;
  for (const cat of active) {
    const bandH = (cat.tokens / total) * liquidHeight;
    if (cat.key === highlightedKey) {
      const clampedH = Math.max(4, bandH);
      return {
        y: INNER_Y + INNER_H - cursor - clampedH,
        height: clampedH,
      };
    }
    cursor += bandH;
  }
  return null;
}

export function ContextLiquidVial({
  percent,
  tone,
  maxTokens,
  categories,
  highlightedCategoryKey,
  className,
}: {
  readonly percent: number | null;
  readonly tone: ContextBarTone;
  readonly maxTokens: number | null;
  readonly categories: readonly ContextBreakdownCategory[];
  readonly highlightedCategoryKey: string | null;
  readonly className?: string | undefined;
}) {
  const uid = useId().replace(/:/g, "");
  const clipId = `pmx-vial-clip-${uid}`;
  const glassBgId = `pmx-vial-glass-${uid}`;
  const liqGradId = `pmx-vial-liq-${uid}`;
  const glowGradId = `pmx-vial-glow-${uid}`;
  const specGradId = `pmx-vial-spec-${uid}`;

  const pal = VIAL_PALETTES[tone];
  const clampedPct =
    typeof percent === "number" && Number.isFinite(percent)
      ? Math.max(0, Math.min(100, percent))
      : 0;
  const fillFraction = clampedPct / 100;
  const liquidHeight = fillFraction > 0.002 ? Math.max(4, INNER_H * fillFraction) : 0;
  const surfaceY = INNER_Y + INNER_H - liquidHeight;
  const glowCenterY = TUBE_Y + TUBE_H * (1 - Math.max(0.15, fillFraction * 0.55));
  const ticks = computeContextVialTicks(maxTokens);
  const stratum = computeHighlightedStratum(categories, highlightedCategoryKey, liquidHeight);

  // Gentle meniscus curves for primary & parallax back liquid surfaces
  const backWavePath =
    liquidHeight > 0
      ? [
          `M ${INNER_X - 4} ${INNER_Y + INNER_H + 4}`,
          `L ${INNER_X - 4} ${surfaceY - 1.5}`,
          `Q ${INNER_X + INNER_W * 0.25} ${surfaceY - 4.2} ${INNER_X + INNER_W * 0.5} ${surfaceY - 1.2}`,
          `Q ${INNER_X + INNER_W * 0.78} ${surfaceY + 1.4} ${INNER_X + INNER_W + 6} ${surfaceY - 2.0}`,
          `L ${INNER_X + INNER_W + 6} ${INNER_Y + INNER_H + 4}`,
          "Z",
        ].join(" ")
      : "";

  const frontWavePath =
    liquidHeight > 0
      ? [
          `M ${INNER_X} ${INNER_Y + INNER_H + 4}`,
          `L ${INNER_X} ${surfaceY}`,
          `Q ${INNER_X + INNER_W * 0.3} ${surfaceY + 1.4} ${INNER_X + INNER_W * 0.55} ${surfaceY}`,
          `Q ${INNER_X + INNER_W * 0.8} ${surfaceY - 1.2} ${INNER_X + INNER_W} ${surfaceY + 0.3}`,
          `L ${INNER_X + INNER_W} ${INNER_Y + INNER_H + 4}`,
          "Z",
        ].join(" ")
      : "";

  const crestLinePath =
    liquidHeight > 0
      ? [
          `M ${INNER_X} ${surfaceY}`,
          `Q ${INNER_X + INNER_W * 0.3} ${surfaceY + 1.4} ${INNER_X + INNER_W * 0.55} ${surfaceY}`,
          `Q ${INNER_X + INNER_W * 0.8} ${surfaceY - 1.2} ${INNER_X + INNER_W} ${surfaceY + 0.3}`,
        ].join(" ")
      : "";

  return (
    <svg
      width={VIAL_VIEWBOX_W}
      height={VIAL_VIEWBOX_H}
      viewBox={`0 0 ${VIAL_VIEWBOX_W} ${VIAL_VIEWBOX_H}`}
      aria-hidden="true"
      data-context-vial="true"
      data-context-vial-tone={tone}
      className={cn("block shrink-0 select-none", className)}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={INNER_TUBE_PATH} />
        </clipPath>

        <radialGradient
          id={glowGradId}
          cx="50%"
          cy={`${((glowCenterY / VIAL_VIEWBOX_H) * 100).toFixed(1)}%`}
          r="54%"
        >
          <stop offset="0%" stopColor={pal.glow} />
          <stop offset="100%" stopColor={pal.glow} stopOpacity={0} />
        </radialGradient>

        <linearGradient id={glassBgId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--pmx-vial-glass-rim)" />
          <stop offset="28%" stopColor="var(--pmx-vial-glass-core-a)" />
          <stop offset="78%" stopColor="var(--pmx-vial-glass-core-b)" />
          <stop offset="100%" stopColor="var(--pmx-vial-glass-rim)" />
        </linearGradient>

        <linearGradient
          id={liqGradId}
          gradientUnits="userSpaceOnUse"
          x1={INNER_X}
          y1={Math.max(INNER_Y, surfaceY - 4)}
          x2={INNER_X}
          y2={INNER_Y + INNER_H}
        >
          <stop offset="0%" stopColor={pal.top} />
          <stop offset="44%" stopColor={pal.mid} />
          <stop offset="100%" stopColor={pal.bot} />
        </linearGradient>

        <linearGradient id={specGradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--pmx-vial-glass-specular-a)" />
          <stop offset="55%" stopColor="var(--pmx-vial-glass-specular-b)" />
          <stop offset="100%" stopColor="var(--pmx-vial-glass-specular-b)" stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* 1. Soft occupancy-tinted ambient glow behind the glass tube */}
      {liquidHeight > 4 ? (
        <rect
          x={0}
          y={0}
          width={VIAL_VIEWBOX_W}
          height={VIAL_VIEWBOX_H}
          fill={`url(#${glowGradId})`}
          style={{ opacity: "var(--pmx-vial-glow-opacity)" }}
        />
      ) : null}

      {/* 2. Borosilicate outer glass backing */}
      <path d={OUTER_TUBE_PATH} fill={`url(#${glassBgId})`} />

      {/* 3. Clipped inner cavity: liquid fill, meniscus, rising bubbles, graduation ticks & specular streak */}
      <g clipPath={`url(#${clipId})`}>
        {liquidHeight > 0 ? (
          <g data-context-vial-liquid="true" data-fill-percent={clampedPct.toFixed(1)}>
            {/* Parallax back meniscus */}
            <path d={backWavePath} fill={pal.top} opacity={0.32} data-context-vial-wave="back" />

            {/* Primary glowing liquid body */}
            <path d={frontWavePath} fill={`url(#${liqGradId})`} />

            {/* Interactive category stratum highlight on right-panel row hover */}
            {stratum ? (
              <g data-context-vial-stratum={highlightedCategoryKey ?? undefined}>
                <rect
                  x={INNER_X}
                  y={stratum.y}
                  width={INNER_W}
                  height={stratum.height}
                  fill="var(--pmx-vial-stratum-fill)"
                />
                <line
                  x1={INNER_X}
                  x2={INNER_X + INNER_W}
                  y1={stratum.y}
                  y2={stratum.y}
                  stroke="var(--pmx-vial-stratum-stroke)"
                  strokeWidth={1.1}
                />
                <line
                  x1={INNER_X}
                  x2={INNER_X + INNER_W}
                  y1={stratum.y + stratum.height}
                  y2={stratum.y + stratum.height}
                  stroke="var(--pmx-vial-stratum-stroke)"
                  strokeWidth={1.1}
                />
              </g>
            ) : null}

            {/* Luminous top crest meniscus rim */}
            <path
              d={crestLinePath}
              fill="none"
              stroke={pal.crest}
              strokeWidth={1.8}
              strokeOpacity={0.88}
              strokeLinecap="round"
            />

            {/* Gentle rising micro-bubbles (automatically static under prefers-reduced-motion) */}
            {liquidHeight >= 18
              ? SEEDED_BUBBLES.map((bubble) => {
                  const by = INNER_Y + INNER_H - liquidHeight * bubble.bottomOffsetRatio;
                  if (by < surfaceY + 8) return null;
                  const bx = INNER_X + INNER_W * bubble.cxRatio;
                  return (
                    <circle
                      key={bubble.id}
                      cx={bx}
                      cy={by}
                      r={bubble.r}
                      fill={pal.crest}
                      opacity={0.62}
                      data-context-vial-bubble="true"
                      style={
                        {
                          "--pmx-bubble-dur": `${bubble.durationSec}s`,
                          "--pmx-bubble-delay": `${bubble.delaySec}s`,
                        } as CSSProperties
                      }
                    />
                  );
                })
              : null}
          </g>
        ) : null}

        {/* Laser-etched dynamic graduation tick marks (25% / 50% / 75%) */}
        <g data-context-vial-ticks="true">
          {ticks.map((tick) => {
            const ty = Math.round(INNER_Y + INNER_H * (1 - tick.fraction)) + 0.5;
            return (
              <g key={tick.fraction}>
                {/* Left micro-tick */}
                <line
                  x1={INNER_X + 2}
                  x2={INNER_X + 7}
                  y1={ty}
                  y2={ty}
                  stroke="var(--pmx-vial-tick-stroke)"
                  strokeWidth={1}
                />
                {/* Right graduated tick */}
                <line
                  x1={INNER_X + INNER_W - 10}
                  x2={INNER_X + INNER_W - 2}
                  y1={ty}
                  y2={ty}
                  stroke="var(--pmx-vial-tick-stroke)"
                  strokeWidth={1}
                />
                <text
                  x={INNER_X + INNER_W - 13}
                  y={ty + 0.5}
                  textAnchor="end"
                  dominantBaseline="central"
                  fill="var(--pmx-vial-tick-text)"
                  stroke="var(--pmx-vial-tick-halo)"
                  strokeWidth={2}
                  paintOrder="stroke"
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 600,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  }}
                >
                  {tick.label}
                </text>
              </g>
            );
          })}
        </g>

        {/* Left glass specular highlight reflection */}
        <rect
          x={INNER_X + 2}
          y={INNER_Y + 4}
          width={INNER_W * 0.26}
          height={INNER_H - 8}
          rx={4}
          fill={`url(#${specGradId})`}
        />
      </g>

      {/* 4. Outer borosilicate wall contour & top glass lip highlight */}
      <path
        d={OUTER_TUBE_PATH}
        fill="none"
        stroke="var(--pmx-vial-glass-stroke)"
        strokeWidth={1.25}
      />
      <line
        x1={TUBE_X + TUBE_R_TOP * 0.8}
        x2={TUBE_X + TUBE_W - TUBE_R_TOP * 0.8}
        y1={TUBE_Y + 1.5}
        y2={TUBE_Y + 1.5}
        stroke="var(--pmx-vial-glass-lip)"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ContextWindowVialPopover({
  display,
  copy,
}: {
  readonly display: ResolvedTelemetryDisplay;
  readonly copy: SessionTelemetryCopy;
}) {
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const { contextBreakdown } = display;

  const effectivePercent =
    display.contextPercent !== null && Number.isFinite(display.contextPercent)
      ? Math.max(0, display.contextPercent)
      : contextBreakdown.usedPercent;
  const clampedBarPercent =
    effectivePercent !== null && Number.isFinite(effectivePercent)
      ? Math.max(0, Math.min(100, effectivePercent))
      : 0;
  const pctReadoutText =
    effectivePercent !== null && Number.isFinite(effectivePercent)
      ? `${effectivePercent.toFixed(1)}%`
      : EMPTY_METRIC_DASH;

  const usedTokens = display.contextUsedTokens ?? contextBreakdown.usedTokens;
  const maxTokens = display.contextMaxTokens ?? contextBreakdown.maxTokens;
  const usedFormatted = usedTokens !== null ? formatContextBreakdownTokens(usedTokens) : "0";
  const maxFormatted =
    maxTokens !== null ? formatContextBreakdownTokens(maxTokens) : EMPTY_METRIC_DASH;
  const ratioText = `${usedFormatted} / ${maxFormatted}`;

  const pal = VIAL_PALETTES[display.contextBarTone];
  const activeCategories = contextBreakdown.categories.filter(
    (cat) => cat.group !== "free" && cat.tokens > 0,
  );
  const activeTotalTokens = activeCategories.reduce((acc, cat) => acc + cat.tokens, 0);

  const compactionBadgeText = copy.formatContextCompactionBadge(
    display.compactionCount,
    display.rounds,
  );
  const hasBreakdownData = contextBreakdown.categories.length > 0;
  const hasUsedSummary = contextBreakdown.source !== "empty" && activeTotalTokens > 0;

  return (
    <div
      data-telemetry-popover="context"
      aria-label={copy.contextWindowTitle}
      className="flex flex-col p-3.5 text-popover-foreground"
    >
      {/* Two-column body: Left vertical liquid test-tube (Fig 3) + Right context breakdown (Fig 4) */}
      <div data-context-vial-grid="true">
        {/* Left Column: Borosilicate Glass Liquid Test Tube + Readout */}
        <div
          data-context-vial-column="true"
          className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border/70 bg-foreground/3 px-2.5 py-3.5 dark:border-white/10 dark:bg-white/4"
        >
          <ContextLiquidVial
            percent={effectivePercent}
            tone={display.contextBarTone}
            maxTokens={maxTokens}
            categories={contextBreakdown.categories}
            highlightedCategoryKey={highlightedKey}
          />
          <div className="flex flex-col items-center text-center tabular-nums">
            <span
              data-context-vial-percent="true"
              className={cn("text-lg font-bold leading-tight tracking-tight", pal.textClass)}
            >
              {pctReadoutText}
            </span>
            <span
              data-context-vial-ratio="true"
              className="mt-0.5 text-2xs leading-snug text-muted-foreground"
            >
              {ratioText}
            </span>
          </div>
        </div>

        {/* Right Column: 上下文拆解 Breakdown Panel */}
        <div
          data-context-breakdown-column="true"
          className="flex min-w-0 flex-col rounded-xl border border-border/70 bg-foreground/3 p-3 dark:border-white/10 dark:bg-white/4"
        >
          {/* Header + Compaction Badge */}
          <div className="flex items-center justify-between gap-2 pb-2">
            <span className="truncate text-sm font-semibold tracking-tight text-foreground">
              {copy.contextBreakdownTitle}
            </span>
            <span
              data-context-compaction-badge="true"
              data-compaction-count={display.compactionCount}
              className={cn(
                "shrink-0 tabular-nums",
                display.compactionCount > 0
                  ? "rounded-full border border-border/75 bg-foreground/6 px-2 py-0.5 text-2xs font-medium text-foreground dark:border-white/14 dark:bg-white/8"
                  : "text-xs text-muted-foreground",
              )}
            >
              {compactionBadgeText}
            </span>
          </div>

          {/* Multi-segment horizontal stacked bar */}
          <div
            role="progressbar"
            aria-label={copy.contextBreakdownTitle}
            aria-valuenow={Math.round(clampedBarPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            data-context-bar-tone={display.contextBarTone}
            data-context-stacked-bar="true"
            className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-foreground/12 dark:bg-white/12"
          >
            {activeCategories.map((cat) => {
              const rawSharePct =
                cat.percent !== null
                  ? Math.max(0, Math.min(100, cat.percent))
                  : activeTotalTokens > 0
                    ? (cat.tokens / activeTotalTokens) * clampedBarPercent
                    : 0;
              const isHighlighted = highlightedKey === cat.key;
              const isDimmed =
                highlightedKey !== null && highlightedKey !== "free" && !isHighlighted;
              return (
                <span
                  key={cat.key}
                  data-context-bar-slice={cat.key}
                  data-highlighted={isHighlighted ? "true" : "false"}
                  onPointerEnter={() => setHighlightedKey(cat.key)}
                  onPointerLeave={() => setHighlightedKey(null)}
                  className={cn(
                    "h-full first:rounded-l-full last:rounded-r-full transition-[opacity,filter] duration-150 motion-reduce:transition-none",
                    isHighlighted && "brightness-125",
                    isDimmed && "opacity-45",
                  )}
                  style={{
                    width: `${rawSharePct.toFixed(2)}%`,
                    minWidth: rawSharePct > 0 ? "3px" : undefined,
                    backgroundColor: cat.color,
                  }}
                />
              );
            })}
          </div>

          {/* Concise 3-group summary line: 系统 ... · 对话 ... · 工具 ... */}
          <div
            data-context-breakdown-summary="true"
            className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground tabular-nums"
          >
            {hasUsedSummary ? (
              <>
                <span>
                  {copy.contextSummarySystem}{" "}
                  {formatContextBreakdownTokens(contextBreakdown.summary.systemTokens)}
                </span>
                <span aria-hidden="true" className="opacity-50">
                  ·
                </span>
                <span>
                  {copy.contextSummaryConversation}{" "}
                  {formatContextBreakdownTokens(contextBreakdown.summary.conversationTokens)}
                </span>
                <span aria-hidden="true" className="opacity-50">
                  ·
                </span>
                <span>
                  {copy.contextSummaryTools}{" "}
                  {formatContextBreakdownTokens(contextBreakdown.summary.toolTokens)}
                </span>
              </>
            ) : (
              <span>
                {`${copy.contextSummarySystem} ${EMPTY_METRIC_DASH} · ${copy.contextSummaryConversation} ${EMPTY_METRIC_DASH} · ${copy.contextSummaryTools} ${EMPTY_METRIC_DASH}`}
              </span>
            )}
          </div>

          {/* Structured category breakdown rows */}
          <div
            data-context-breakdown-rows="true"
            className="mt-2 flex flex-col gap-0.5 overflow-y-auto"
          >
            {hasBreakdownData ? (
              contextBreakdown.categories.map((cat) => {
                const isFree = cat.group === "free";
                const isHighlighted = highlightedKey === cat.key;
                const pctText =
                  cat.percent !== null ? `${cat.percent.toFixed(1)}%` : EMPTY_METRIC_DASH;
                return (
                  <div
                    key={cat.key}
                    data-context-category-row={cat.key}
                    data-highlighted={isHighlighted ? "true" : "false"}
                    onPointerEnter={() => setHighlightedKey(cat.key)}
                    onPointerLeave={() => setHighlightedKey(null)}
                    className={cn(
                      "flex min-h-6 items-center gap-2 rounded-md px-1.5 text-xs leading-6 tabular-nums transition-colors duration-100 motion-reduce:transition-none",
                      isHighlighted
                        ? "bg-foreground/7 dark:bg-white/8"
                        : "hover:bg-foreground/5 dark:hover:bg-white/6",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-2 shrink-0 rounded-xs",
                        isFree && "bg-foreground/25 dark:bg-white/25",
                      )}
                      style={isFree ? undefined : { backgroundColor: cat.color }}
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        isFree ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {copy.formatContextCategoryLabel(cat.key, cat.label)}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatContextBreakdownTokens(cat.tokens)}
                    </span>
                    <span className="min-w-11 shrink-0 text-right text-xs font-semibold text-foreground">
                      {pctText}
                    </span>
                  </div>
                );
              })
            ) : (
              <div
                data-context-breakdown-empty="true"
                className="py-4 text-center text-xs text-muted-foreground"
              >
                {copy.contextWaitingData}
              </div>
            )}
          </div>

          {contextBreakdown.source === "transcript-estimate" ? (
            <div
              data-context-estimated-note="true"
              className="mt-1.5 px-1.5 text-2xs text-muted-foreground/80"
            >
              {copy.contextEstimatedFootnote}
            </div>
          ) : null}
        </div>
      </div>

      {/* Integrated Model & Entrypoint Footnote (matching Fig 1 essentials cleanly without clutter) */}
      <div
        data-context-model-footnote="true"
        className="mt-3 flex flex-col gap-1.5 border-t border-border/65 pt-2.5 text-xs dark:border-white/10"
      >
        <div className="flex items-center justify-between gap-4">
          <span className="shrink-0 text-muted-foreground">{copy.sampledModel}</span>
          <span className="truncate text-right text-foreground">
            {display.sampledModelDisplayName ?? EMPTY_METRIC_DASH}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="shrink-0 text-muted-foreground">{copy.primaryEntrypoint}</span>
          <span className="truncate text-right font-semibold text-foreground">
            {display.primaryEntrypointId ?? EMPTY_METRIC_DASH}
          </span>
        </div>
        {display.hasMultipleSampledModels ? (
          <div
            data-telemetry-multi-model-note="true"
            className="pt-0.5 text-2xs text-muted-foreground"
          >
            {copy.multipleModelsSampled}
          </div>
        ) : null}
      </div>
    </div>
  );
}
