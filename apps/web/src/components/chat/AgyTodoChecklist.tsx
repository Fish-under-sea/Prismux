import {
  CheckCircle2Icon,
  ChevronRightIcon,
  MinusCircleIcon,
  XCircleIcon,
} from "lucide-react";
import { memo, useEffect, useId, useState } from "react";
import type { OrchestrationV2PlanArtifact } from "@prismux/core-contracts";
import { cn } from "~/lib/utils";
import type { WorkLogEntry } from "../../session-logic";
import {
  AGY_TODO_COPY_ZH,
  extractActiveTodoChecklist,
  extractTodoChecklistFromTurnItem,
  extractTodoChecklistFromWorkEntry,
  type AgyTodoChecklistSnapshot,
  type AgyTodoStep,
  type AgyTodoTurnItemLike,
} from "./AgyTodoChecklist.logic";

const RING_RADIUS = 5.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const AGY_CARD_SURFACE_CLASS = cn(
  "rounded-xl border border-border/55 bg-card/68 text-foreground shadow-xs backdrop-blur-md",
  "[[data-pmx-glass='1']_&]:border-foreground/15 [[data-pmx-glass='1']_&]:bg-card/60",
  "[[data-pmx-glass='1']_&]:shadow-sm [[data-pmx-glass='1']_&]:ring-1 [[data-pmx-glass='1']_&]:ring-inset [[data-pmx-glass='1']_&]:ring-foreground/10",
  "[[data-pmx-glass='1']_&]:backdrop-blur-xl",
);

/**
 * 14px circular progress ring `◔` matching AGY header toggle aesthetics across Light, Dark, and Liquid Glass.
 */
export function AgyProgressRing({
  progressRatio,
  allCompleted,
  hasFailed = false,
}: {
  readonly progressRatio: number;
  readonly allCompleted: boolean;
  readonly hasFailed?: boolean | undefined;
}) {
  const clamped = Math.max(0, Math.min(1, progressRatio));
  const dashOffset = RING_CIRCUMFERENCE * (1 - clamped);
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cn(
        "size-3.5 shrink-0",
        allCompleted
          ? "text-success-foreground"
          : hasFailed
            ? "text-destructive"
            : "text-foreground",
      )}
      data-agy-progress-ring={allCompleted ? "completed" : "active"}
    >
      <circle
        cx="8"
        cy="8"
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        className="opacity-22"
      />
      {clamped > 0 ? (
        <circle
          cx="8"
          cy="8"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 8 8)"
          className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
        />
      ) : null}
      {allCompleted ? (
        <path
          d="M5.4 8.2L7.1 9.9L10.7 6.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}

/**
 * 2×2 pulsing 4-dot `∷` grid indicator for in-progress steps (1:1 AGY screenshot parity).
 */
export function AgyFourDotActivityIcon() {
  return (
    <span
      aria-hidden="true"
      data-agy-step-indicator="in_progress"
      className="mt-0.5 inline-grid size-3.5 shrink-0 grid-cols-2 place-items-center gap-0.5 p-0.25"
    >
      <span
        className="size-1 animate-pulse rounded-full bg-foreground/90 motion-reduce:animate-none"
        style={{ animationDelay: "0ms" }}
      />
      <span
        className="size-1 animate-pulse rounded-full bg-foreground/65 motion-reduce:animate-none"
        style={{ animationDelay: "180ms" }}
      />
      <span
        className="size-1 animate-pulse rounded-full bg-foreground/65 motion-reduce:animate-none"
        style={{ animationDelay: "360ms" }}
      />
      <span
        className="size-1 animate-pulse rounded-full bg-foreground/90 motion-reduce:animate-none"
        style={{ animationDelay: "540ms" }}
      />
    </span>
  );
}

function AgyStepRow({
  step,
  allCompleted,
}: {
  readonly step: AgyTodoStep;
  readonly allCompleted: boolean;
}) {
  return (
    <li
      data-agy-todo-step={step.status}
      className={cn(
        "flex items-start gap-2.5 rounded-md px-1.5 py-1 text-xs leading-snug transition-colors duration-100 motion-reduce:transition-none",
        "hover:bg-muted/35 [[data-pmx-glass='1']_&]:hover:bg-foreground/6",
      )}
    >
      {step.status === "completed" ? (
        <CheckCircle2Icon
          aria-hidden="true"
          data-agy-step-indicator="completed"
          className={cn(
            "mt-0.5 size-3.5 shrink-0",
            allCompleted ? "text-success-foreground/90" : "text-muted-foreground/80",
          )}
        />
      ) : step.status === "in_progress" ? (
        <AgyFourDotActivityIcon />
      ) : step.status === "failed" ? (
        <XCircleIcon
          aria-hidden="true"
          data-agy-step-indicator="failed"
          className="mt-0.5 size-3.5 shrink-0 text-destructive"
        />
      ) : step.status === "skipped" ? (
        <MinusCircleIcon
          aria-hidden="true"
          data-agy-step-indicator="skipped"
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/65"
        />
      ) : (
        <span
          aria-hidden="true"
          data-agy-step-indicator="pending"
          className="mt-0.5 inline-block size-3.5 shrink-0 rounded-full border border-muted-foreground/55"
        />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 break-words",
          step.status === "in_progress" && "font-semibold text-foreground",
          step.status === "completed" && "text-muted-foreground",
          step.status === "pending" && "text-foreground/80",
          step.status === "failed" && "font-medium text-destructive",
          step.status === "skipped" && "text-muted-foreground/75 line-through",
        )}
      >
        {step.title}
      </span>
    </li>
  );
}

export interface AgyTodoChecklistProps {
  readonly variant?: "dock" | "inline" | undefined;
  readonly snapshot?: AgyTodoChecklistSnapshot | null | undefined;
  readonly plans?: ReadonlyArray<OrchestrationV2PlanArtifact> | null | undefined;
  readonly turnItems?: ReadonlyArray<AgyTodoTurnItemLike> | null | undefined;
  readonly workEntries?: ReadonlyArray<WorkLogEntry> | null | undefined;
  readonly turnItem?: AgyTodoTurnItemLike | null | undefined;
  readonly workEntry?: WorkLogEntry | null | undefined;
  readonly turnStartedAtMs?: number | null | undefined;
  readonly isTurnWorking?: boolean | undefined;
  readonly threadKey?: string | null | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly className?: string | undefined;
}

export const AgyTodoChecklist = memo(function AgyTodoChecklist({
  variant = "dock",
  snapshot: explicitSnapshot,
  plans,
  turnItems,
  workEntries,
  turnItem,
  workEntry,
  turnStartedAtMs,
  isTurnWorking,
  threadKey,
  defaultOpen,
  className,
}: AgyTodoChecklistProps) {
  const listId = useId();
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const timing = {
    turnStartedAtMs,
    nowMs,
    isTurnWorking,
  };
  const snapshot =
    explicitSnapshot !== undefined
      ? explicitSnapshot
      : turnItem
        ? extractTodoChecklistFromTurnItem(turnItem, timing)
        : workEntry
          ? extractTodoChecklistFromWorkEntry(workEntry, timing)
          : extractActiveTodoChecklist({
              plans,
              turnItems,
              workEntries,
              ...timing,
            });

  const shouldTick =
    variant === "dock" &&
    snapshot !== null &&
    snapshot.hasActiveWork &&
    typeof turnStartedAtMs === "number" &&
    Number.isFinite(turnStartedAtMs);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- drives live elapsed-time interval timer while an active turn is running
  useEffect(() => {
    if (!shouldTick || turnStartedAtMs == null) return;
    const elapsed = Math.max(0, Date.now() - turnStartedAtMs);
    const intervalMs = elapsed < 60_000 ? 1_000 : 15_000;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [shouldTick, turnStartedAtMs]);

  const toggleScope = `${threadKey ?? ""}:${variant === "dock" && snapshot?.allCompleted ? "done" : "open"}`;
  const [overrideState, setOverrideState] = useState<{
    readonly scope: string;
    readonly open: boolean;
  } | null>(null);

  if (!snapshot || snapshot.steps.length === 0) {
    return null;
  }

  const autoExpanded =
    defaultOpen ??
    (variant === "inline" ? true : snapshot.inProgressCount > 0 || snapshot.hasActiveWork);
  const effectiveOverride = overrideState?.scope === toggleScope ? overrideState.open : null;
  const expanded = effectiveOverride ?? autoExpanded;
  const activePreviewStep = snapshot.steps.find((step) => step.status === "in_progress");

  return (
    <section
      aria-label={AGY_TODO_COPY_ZH.regionName}
      data-agy-todo-checklist={variant}
      data-agy-todo-state={
        snapshot.allCompleted ? "completed" : snapshot.hasActiveWork ? "active" : "idle"
      }
      className={cn(
        variant === "dock" ? "space-y-1.5" : "mt-1 mb-1 ml-1 space-y-1.5",
        className,
      )}
    >
      {/* AGY Header Toggle Pill: 已进行 2m > ◔ 4/7 步 */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          data-agy-todo-toggle="true"
          onClick={(event) => {
            event.stopPropagation();
            setOverrideState({ scope: toggleScope, open: !expanded });
          }}
          className={cn(
            "group/agy-pill inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors duration-150 motion-reduce:transition-none",
            "hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
            "[[data-pmx-glass='1']_&]:hover:bg-card/55",
          )}
        >
          <span
            data-agy-todo-elapsed="true"
            className="shrink-0 text-xs font-medium text-muted-foreground"
          >
            {snapshot.elapsedLabelZh}
          </span>
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/75 transition-transform duration-200 ease-out motion-reduce:transition-none",
              expanded && "rotate-90",
            )}
          />
          <AgyProgressRing
            progressRatio={snapshot.progressRatio}
            allCompleted={snapshot.allCompleted}
            hasFailed={snapshot.failedCount > 0}
          />
          <span
            data-agy-todo-counter="true"
            className="shrink-0 text-xs font-medium tabular-nums text-foreground"
          >
            {snapshot.stepCountLabelZh}
          </span>
          {!expanded && activePreviewStep ? (
            <span className="ml-1 min-w-0 truncate text-2xs text-muted-foreground/85">
              · {activePreviewStep.title}
            </span>
          ) : null}
        </button>
      </div>

      {/* Collapsible Frosted Glass Checklist Card with smooth 0fr <-> 1fr grid motion */}
      <div
        id={listId}
        data-disclosure-panel={expanded ? "open" : "closed"}
        aria-hidden={!expanded}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div data-agy-todo-card="true" className={cn(AGY_CARD_SURFACE_CLASS, "overflow-hidden")}>
            {snapshot.explanation ? (
              <div className="border-b border-border/45 bg-muted/30 px-3.5 py-1.5 text-2xs text-muted-foreground [[data-pmx-glass='1']_&]:border-foreground/12 [[data-pmx-glass='1']_&]:bg-foreground/[0.04]">
                {snapshot.explanation}
              </div>
            ) : null}
            <ul role="list" className="max-h-52 space-y-0.5 overflow-y-auto px-2.5 py-2">
              {snapshot.steps.map((step) => (
                <AgyStepRow
                  key={`${step.id}:${step.title}`}
                  step={step}
                  allCompleted={snapshot.allCompleted}
                />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
});
