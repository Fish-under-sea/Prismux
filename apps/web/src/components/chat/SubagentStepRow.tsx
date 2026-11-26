import { ArrowUpRightIcon, BotIcon } from "lucide-react";
import { use, useId, useState, type KeyboardEvent, type MouseEvent } from "react";
import { notificationChildThreadId } from "@prismux/client-runtime/state/thread-execution";
import { formatSubagentDisplayTitle } from "@prismux/client-runtime/state/subagent-display";
import type { ThreadId } from "@prismux/core-contracts";
import { cn } from "~/lib/utils";
import { TimelineRowCtx, WorkGroupViewCtx, type TimelineWorkEntry } from "./timelineRowContext";
import { DshDisclosureLeadingSlot, SmoothDisclosure } from "./TimelineWorkEntryRow";

function getSubagentStepCopy(locale: string | undefined) {
  const zh = !locale || locale.toLowerCase().startsWith("zh");
  return {
    zh,
    notificationPrefix: zh ? "子智能体回执" : "Subagent update",
    notificationFallback: zh ? "子智能体回执" : "Subagent notification",
    subagentPrefix: zh ? "协调子智能体" : "Subagent",
    subagentFallback: zh ? "子智能体" : "Subagent",
    openSubThread: zh ? "打开子会话" : "Open sub-thread",
    delegatedPrompt: zh ? "委派任务" : "Delegated prompt",
    result: zh ? "执行结果" : "Result",
    statusRunning: zh ? "运行中" : "Running",
    statusUpdated: zh ? "更新" : "Updated",
    statusFailed: zh ? "失败" : "Failed",
    statusStopped: zh ? "已停止" : "Stopped",
    statusCompleted: zh ? "已完成" : "Completed",
  };
}

type SubagentStepCopy = ReturnType<typeof getSubagentStepCopy>;

const stopPropagation = (event: MouseEvent<HTMLElement>) => {
  event.stopPropagation();
};

type SubagentVisualTone = "running" | "completed" | "failed" | "stopped";

function resolveStatusBadgeText(
  tone: SubagentVisualTone,
  kind: "subagent" | "notification",
  copy: SubagentStepCopy,
): string {
  if (tone === "failed") return copy.statusFailed;
  if (tone === "stopped") return copy.statusStopped;
  if (tone === "running") {
    return kind === "notification" ? copy.statusUpdated : copy.statusRunning;
  }
  return copy.statusCompleted;
}

function resolveSubagentStepFields(
  workEntry: TimelineWorkEntry,
  copy: SubagentStepCopy,
): {
  readonly kind: "subagent" | "notification";
  readonly heading: string;
  readonly prompt: string | null;
  readonly resultText: string | null;
  readonly modelLabel: string | null;
  readonly statusTone: SubagentVisualTone;
  readonly statusText: string;
  readonly childThreadId: ThreadId | null;
} | null {
  const item = workEntry.projectedItem?.item ?? workEntry.structuredPayload;
  if (item?.type === "subagent") {
    const heading = formatSubagentDisplayTitle(
      item.title?.trim() || workEntry.label || copy.subagentFallback,
    );
    const status = item.status;
    const statusTone: SubagentVisualTone =
      status === "running" || status === "pending" || status === "waiting"
        ? "running"
        : status === "failed"
          ? "failed"
          : status === "cancelled" || status === "interrupted"
            ? "stopped"
            : "completed";
    const rawRec = item as unknown as Record<string, unknown>;
    const rawSelection =
      rawRec.modelSelection && typeof rawRec.modelSelection === "object"
        ? (rawRec.modelSelection as Record<string, unknown>)
        : undefined;
    const rawModel =
      (typeof rawRec.executedModel === "string" && rawRec.executedModel.trim()) ||
      (typeof rawRec.model === "string" && rawRec.model.trim()) ||
      (typeof rawSelection?.model === "string" && rawSelection.model.trim()) ||
      null;
    const modelLabel = [item.driver, rawModel].filter(Boolean).join(" / ");
    return {
      kind: "subagent",
      heading,
      prompt: item.prompt?.trim() || null,
      resultText: item.result?.trim() || item.progress?.trim() || workEntry.detail?.trim() || null,
      modelLabel: modelLabel || null,
      statusTone,
      statusText: resolveStatusBadgeText(statusTone, "subagent", copy),
      childThreadId: item.childThreadId ?? null,
    };
  }

  if (item?.type === "notification") {
    const childThreadId = notificationChildThreadId(item.source) ?? null;
    const outcome = item.outcome;
    const statusTone: SubagentVisualTone =
      outcome === "failed"
        ? "failed"
        : outcome === "cancelled"
          ? "stopped"
          : outcome === "updated"
            ? "running"
            : "completed";
    return {
      kind: "notification",
      heading: item.title?.trim() || workEntry.label?.trim() || copy.notificationFallback,
      prompt: null,
      resultText: item.detail?.trim() || workEntry.detail?.trim() || null,
      modelLabel: null,
      statusTone,
      statusText: resolveStatusBadgeText(statusTone, "notification", copy),
      childThreadId,
    };
  }

  if (workEntry.itemType === "subagent" || workEntry.itemType === "notification") {
    const isFailed = workEntry.toolLifecycleStatus === "failed" || workEntry.tone === "error";
    const isRunning = workEntry.toolLifecycleStatus === "inProgress";
    const statusTone: SubagentVisualTone = isRunning
      ? "running"
      : isFailed
        ? "failed"
        : "completed";
    const kind = workEntry.itemType === "notification" ? "notification" : "subagent";
    return {
      kind,
      heading: workEntry.label || copy.subagentFallback,
      prompt: null,
      resultText: workEntry.detail?.trim() || null,
      modelLabel: null,
      statusTone,
      statusText: resolveStatusBadgeText(statusTone, kind, copy),
      childThreadId: null,
    };
  }

  return null;
}

/**
 * Compact 24px converged subagent / notification row rendered INSIDE ProcessGroup drawers,
 * replacing the leaked outer `V2LifecycleRow` / `SubagentNotificationLink` cards (Blueprint §3 Leak 2).
 */
export function SubagentStepRow({
  workEntry,
  autoExpandDetails = false,
  onToggleEntry,
}: {
  readonly workEntry: TimelineWorkEntry;
  readonly autoExpandDetails?: boolean | undefined;
  readonly onToggleEntry?: ((collapsed: boolean) => void) | undefined;
}) {
  const detailsId = useId();
  const ctx = use(TimelineRowCtx);
  const groupView = use(WorkGroupViewCtx);
  const copy = getSubagentStepCopy(ctx.locale);

  const info = resolveSubagentStepFields(workEntry, copy);
  const shouldAutoExpand = Boolean(
    autoExpandDetails || ctx.workStepsPolicy?.defaultExpandLongItems,
  );
  const defaultExpanded =
    (groupView?.state.expandedEntries.has(workEntry.id) ?? false) || shouldAutoExpand;
  const [expanded, setExpanded] = useState(defaultExpanded);

  const resetCount = ctx.turnDisclosureResetCount ?? 0;
  const [seenResetCount, setSeenResetCount] = useState(resetCount);
  if (seenResetCount !== resetCount) {
    setSeenResetCount(resetCount);
    if (expanded && !shouldAutoExpand) {
      setExpanded(false);
    }
  }

  if (!info) return null;

  const hasExpandableBody = Boolean(
    info.prompt || info.resultText || info.modelLabel || info.childThreadId,
  );

  const toggleExpanded = () => {
    if (!hasExpandableBody) return;
    const next = !expanded;
    if (groupView) {
      groupView.onToggleEntry(!next, workEntry.id);
      if (next) groupView.state.expandedEntries.add(workEntry.id);
      else groupView.state.expandedEntries.delete(workEntry.id);
    } else {
      onToggleEntry?.(!next);
    }
    setExpanded(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      toggleExpanded();
    }
  };

  const headingPrefix =
    info.kind === "notification" ? copy.notificationPrefix : copy.subagentPrefix;

  const statusDotStyle =
    info.statusTone === "completed"
      ? { backgroundColor: "var(--success)" }
      : info.statusTone === "failed"
        ? { backgroundColor: "var(--destructive)" }
        : info.statusTone === "running"
          ? { backgroundColor: "var(--pmx-accent-text)" }
          : { backgroundColor: "var(--muted-foreground)" };

  return (
    <div
      data-work-entry-id={workEntry.id}
      data-v2-item-type={info.kind}
      data-subagent-step-row="true"
      data-open={expanded ? "true" : undefined}
      onClick={hasExpandableBody ? toggleExpanded : undefined}
      className="flex w-full min-w-0 flex-col"
    >
      <div data-disclosure-header="true" className="flex min-w-0 items-center gap-2">
        <div
          data-disclosure-row="true"
          data-expandable={hasExpandableBody ? "true" : undefined}
          role={hasExpandableBody ? "button" : undefined}
          tabIndex={hasExpandableBody ? 0 : undefined}
          aria-label={hasExpandableBody ? `${headingPrefix} · ${info.heading}` : undefined}
          aria-expanded={hasExpandableBody ? expanded : undefined}
          aria-controls={hasExpandableBody ? detailsId : undefined}
          onKeyDown={hasExpandableBody ? handleKeyDown : undefined}
          className={cn(
            "group/disclosure-row relative flex h-6 min-w-0 flex-1 items-center overflow-hidden rounded-md text-left text-xs leading-6 text-muted-foreground transition-colors duration-200 ease-out select-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 motion-reduce:transition-none",
            hasExpandableBody && "cursor-pointer",
          )}
        >
          <DshDisclosureLeadingSlot
            icon={
              <BotIcon aria-hidden="true" strokeWidth={1.8} className="block size-3.5 shrink-0" />
            }
            expandable={hasExpandableBody}
            expanded={expanded}
            groupScope="disclosure-row"
            iconClassName={
              info.statusTone === "failed"
                ? "mr-1.5 text-destructive"
                : "mr-1.5 text-muted-foreground group-hover/disclosure-row:text-foreground"
            }
          />
          <span className="flex min-w-0 flex-1 items-center overflow-hidden">
            <span className="shrink-0 font-normal">{headingPrefix}</span>
            <span
              aria-hidden="true"
              className="mx-2 size-0.5 shrink-0 rounded-full bg-muted-foreground/60"
            />
            <span className="min-w-0 truncate text-muted-foreground/90">{info.heading}</span>
            <span
              className="ml-2 inline-flex shrink-0 items-center gap-1.25 rounded-full px-2 py-px text-2xs leading-4.25 font-medium text-muted-foreground"
              style={{
                backgroundColor: "color-mix(in srgb, var(--contrast-foreground) 7%, transparent)",
              }}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1 shrink-0 rounded-full",
                  info.statusTone === "running" && "animate-pulse motion-reduce:animate-none",
                )}
                style={statusDotStyle}
              />
              <span>{info.statusText}</span>
            </span>
          </span>
        </div>

        {info.childThreadId ? (
          <button
            type="button"
            data-open-subthread-action="true"
            onClick={(event) => {
              event.stopPropagation();
              ctx.onOpenThread(info.childThreadId!);
            }}
            className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded px-1.5 py-0.5 text-2xs font-medium transition-opacity hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
            style={{ color: "var(--pmx-accent-text)" }}
          >
            <span>{copy.openSubThread}</span>
            <ArrowUpRightIcon aria-hidden="true" className="size-3 shrink-0" />
          </button>
        ) : null}
      </div>

      <SmoothDisclosure
        open={expanded}
        id={detailsId}
        onClick={stopPropagation}
        onPointerDown={stopPropagation}
      >
        <div
          data-step-detail-card="subagent"
          className="pmx-step-card pmx-subagent-card mt-1 space-y-2 overflow-hidden rounded-xl px-3 py-2.5 text-xs"
        >
          {info.modelLabel ? (
            <div className="font-mono text-2xs text-muted-foreground">{info.modelLabel}</div>
          ) : null}
          {info.prompt ? (
            <div className="space-y-0.5">
              <div className="text-2xs font-medium text-muted-foreground">
                {copy.delegatedPrompt}
              </div>
              <pre className="pmx-subagent-prompt m-0 overflow-auto font-mono text-2xs leading-4.25 whitespace-pre-wrap break-words text-foreground/85 select-text">
                {info.prompt}
              </pre>
            </div>
          ) : null}
          {info.resultText ? (
            <div className="space-y-0.5">
              <div className="text-2xs font-medium text-muted-foreground">{copy.result}</div>
              <pre className="pmx-subagent-result m-0 overflow-auto font-mono text-2xs leading-4.25 whitespace-pre-wrap break-words text-foreground/90 select-text">
                {info.resultText}
              </pre>
            </div>
          ) : null}
          {info.childThreadId ? (
            <div className="flex justify-end pt-0.5">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  ctx.onOpenThread(info.childThreadId!);
                }}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-2xs font-medium transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                style={{
                  color: "var(--pmx-accent-text)",
                  backgroundColor: "var(--pmx-accent-soft)",
                }}
              >
                <span>{copy.openSubThread}</span>
                <ArrowUpRightIcon aria-hidden="true" className="size-3 shrink-0" />
              </button>
            </div>
          ) : null}
        </div>
      </SmoothDisclosure>
    </div>
  );
}
