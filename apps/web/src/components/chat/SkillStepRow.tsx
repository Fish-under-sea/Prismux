import { BookOpenIcon, CheckIcon, CopyIcon } from "lucide-react";
import { use, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  turnItemDetailRevision,
  turnItemNeedsDetailFetch,
  turnItemOutputText,
} from "@prismux/client-runtime/work-log/item-detail";
import { cn } from "~/lib/utils";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import { useTurnItemDetail } from "../../state/queries";
import type { SkillStepData } from "./dshWorkSteps.logic";
import { TimelineRowCtx, WorkGroupViewCtx, type TimelineWorkEntry } from "./timelineRowContext";
import { DshDisclosureLeadingSlot, SmoothDisclosure } from "./TimelineWorkEntryRow";

function getSkillStepCopy(locale: string | undefined) {
  const zh = !locale || locale.toLowerCase().startsWith("zh");
  return {
    headingPrefix: zh ? "加载技能" : "Load skill",
    instructionsHeader: zh ? "说明" : "Instructions",
    copy: zh ? "复制" : "Copy",
    copied: zh ? "已复制" : "Copied",
    loading: zh ? "正在加载说明…" : "Loading instructions…",
    empty: zh ? "无技能说明内容。" : "No skill instructions available.",
  };
}

const stopPropagation = (event: MouseEvent<HTMLElement>) => {
  event.stopPropagation();
};

/**
 * 1:1 DSH NEXT Skill Load step row (`加载技能 · <name>`):
 * - 24px disclosure row with hover-swap leading chevron
 * - 260px max-height rounded 16px frosted card with uppercase `说明` / `Instructions` header
 */
export function SkillStepRow({
  workEntry,
  skill,
  workspaceRoot,
  autoExpandDetails = false,
  onToggleEntry,
}: {
  readonly workEntry: TimelineWorkEntry;
  readonly skill: SkillStepData;
  readonly workspaceRoot?: string | undefined;
  readonly autoExpandDetails?: boolean | undefined;
  readonly onToggleEntry?: ((collapsed: boolean) => void) | undefined;
}) {
  const detailsId = useId();
  const ctx = use(TimelineRowCtx);
  const groupView = use(WorkGroupViewCtx);
  const copy = getSkillStepCopy(ctx.locale);

  const shouldAutoExpand = Boolean(
    autoExpandDetails || ctx.workStepsPolicy?.defaultExpandLongItems,
  );
  const defaultExpanded =
    (groupView?.state.expandedEntries.has(workEntry.id) ?? false) || shouldAutoExpand;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  const resetCount = ctx.turnDisclosureResetCount ?? 0;
  const [seenResetCount, setSeenResetCount] = useState(resetCount);
  if (seenResetCount !== resetCount) {
    setSeenResetCount(resetCount);
    if (expanded && !shouldAutoExpand) {
      setExpanded(false);
    }
  }

  const projected = workEntry.projectedItem;
  const needsFetch = Boolean(
    expanded && !skill.instructions && projected && turnItemNeedsDetailFetch(projected.item),
  );
  const detailQuery = useTurnItemDetail(
    needsFetch && projected
      ? {
          environmentId: ctx.activeThreadEnvironmentId,
          threadId: projected.sourceThreadId,
          itemId: projected.sourceItemId,
          revision: turnItemDetailRevision(projected.item),
        }
      : null,
    ctx.turnItemSource?.detail,
  );
  const fetchedText = detailQuery.data?.item ? turnItemOutputText(detailQuery.data.item) : null;
  const instructions = skill.instructions ?? fetchedText ?? skill.args;
  const displaySourcePath = skill.sourcePath
    ? formatWorkspaceRelativePath(skill.sourcePath, workspaceRoot)
    : null;
  const hasExpandableBody = Boolean(
    instructions || displaySourcePath || (projected && turnItemNeedsDetailFetch(projected.item)),
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

  const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!instructions) return;
    void navigator.clipboard?.writeText(instructions).catch(() => {});
    setCopied(true);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      setCopied(false);
    }, 1500);
  };

  return (
    <div
      data-work-entry-id={workEntry.id}
      data-skill-step-row="true"
      data-skill-name={skill.skillName}
      data-open={expanded ? "true" : undefined}
      onClick={hasExpandableBody ? toggleExpanded : undefined}
      className="flex w-full min-w-0 flex-col"
    >
      <div data-disclosure-header="true" className="flex min-w-0 items-center">
        <div
          data-disclosure-row="true"
          data-expandable={hasExpandableBody ? "true" : undefined}
          role={hasExpandableBody ? "button" : undefined}
          tabIndex={hasExpandableBody ? 0 : undefined}
          aria-label={hasExpandableBody ? `${copy.headingPrefix} · ${skill.skillName}` : undefined}
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
              <BookOpenIcon
                aria-hidden="true"
                strokeWidth={1.8}
                className="block size-3.5 shrink-0"
              />
            }
            expandable={hasExpandableBody}
            expanded={expanded}
            groupScope="disclosure-row"
            iconClassName="mr-1.5 text-muted-foreground group-hover/disclosure-row:text-foreground"
          />
          <span className="flex min-w-0 flex-1 items-center overflow-hidden">
            <span className="shrink-0 font-normal">{copy.headingPrefix}</span>
            <span
              aria-hidden="true"
              className="mx-2 size-0.5 shrink-0 rounded-full bg-muted-foreground/60"
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground/85">
              {skill.skillName}
            </span>
          </span>
        </div>
      </div>

      <SmoothDisclosure
        open={expanded}
        id={detailsId}
        onClick={stopPropagation}
        onPointerDown={stopPropagation}
      >
        <div
          data-step-detail-card="skill_load"
          className="pmx-step-card pmx-skill-card my-1 ml-1 flex flex-col overflow-hidden rounded-2xl"
        >
          <div className="pmx-hairline-b flex items-center justify-between gap-2 px-3 py-2 text-2xs leading-4 font-medium uppercase tracking-wider text-muted-foreground">
            <span className="shrink-0">{copy.instructionsHeader}</span>
            <div className="flex min-w-0 items-center gap-2">
              {displaySourcePath ? (
                <span className="truncate font-mono normal-case tracking-normal text-muted-foreground/80">
                  {displaySourcePath}
                </span>
              ) : null}
              {instructions ? (
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-2xs font-medium normal-case tracking-normal transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                  style={{ color: "var(--pmx-accent-text)" }}
                >
                  {copied ? (
                    <CheckIcon aria-hidden="true" className="size-3 shrink-0" />
                  ) : (
                    <CopyIcon aria-hidden="true" className="size-3 shrink-0" />
                  )}
                  <span>{copied ? copy.copied : copy.copy}</span>
                </button>
              ) : null}
            </div>
          </div>
          <pre className="m-0 flex-1 overflow-auto px-3 pt-2.5 pb-3 font-mono text-2xs leading-4 whitespace-pre-wrap break-words text-foreground/90 select-text">
            {instructions ? instructions : detailQuery.isPending ? copy.loading : copy.empty}
          </pre>
        </div>
      </SmoothDisclosure>
    </div>
  );
}
