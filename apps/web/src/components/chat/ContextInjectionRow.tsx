import { LayersIcon } from "lucide-react";
import { use, useId, useState, type KeyboardEvent, type MouseEvent } from "react";
import { cn } from "~/lib/utils";
import { useTurnItemDetail } from "../../state/queries";
import { turnItemDetailRevision } from "@prismux/client-runtime/work-log/item-detail";
import type { ContextInjectionStepData } from "./dshWorkSteps.logic";
import { TimelineRowCtx, WorkGroupViewCtx, type TimelineWorkEntry } from "./timelineRowContext";
import { DshDisclosureLeadingSlot, SmoothDisclosure } from "./TimelineWorkEntryRow";

const MAX_CATALOG_ENTRIES = 200;

function getContextInjectionCopy(locale: string | undefined) {
  const zh = !locale || locale.toLowerCase().startsWith("zh");
  return {
    zh,
    headingPrefix: zh ? "上下文注入" : "Context injection",
    loadingContent: zh ? "正在加载内容…" : "Loading content…",
    replacesCatalog: zh ? "取代先前的目录" : "Replaces previous catalog",
    replacesSnapshot: zh ? "取代先前的快照" : "Replaces previous snapshot",
    moreItems: (count: number) => (zh ? `另有 ${count} 项` : `+${count} more`),
    actionLoaded: zh ? "已载入" : "Loaded",
    actionUpdated: zh ? "已更新" : "Updated",
    actionRemoved: zh ? "已移除" : "Removed",
  };
}

function resolveFileActionText(
  action: "set" | "replace" | "remove",
  explicitStatusLabel: string | undefined,
  copy: ReturnType<typeof getContextInjectionCopy>,
): string {
  if (explicitStatusLabel && explicitStatusLabel.trim().length > 0) {
    return explicitStatusLabel.trim();
  }
  if (action === "replace") return copy.actionUpdated;
  if (action === "remove") return copy.actionRemoved;
  return copy.actionLoaded;
}

const stopPropagation = (event: MouseEvent<HTMLElement>) => {
  event.stopPropagation();
};

/**
 * 1:1 DSH NEXT Fig 5 Context Injection row (`上下文注入 · <label>`):
 * - 24px disclosure row with hover-swap leading chevron
 * - 141px max-height rounded frosted card (`instructions` / `catalog` / `snapshot` / `notice`)
 */
export function ContextInjectionRow({
  workEntry,
  data,
  autoExpandDetails = false,
  onToggleEntry,
}: {
  readonly workEntry: TimelineWorkEntry;
  readonly data: ContextInjectionStepData;
  readonly autoExpandDetails?: boolean | undefined;
  readonly onToggleEntry?: ((collapsed: boolean) => void) | undefined;
}) {
  const detailsId = useId();
  const ctx = use(TimelineRowCtx);
  const groupView = use(WorkGroupViewCtx);
  const copy = getContextInjectionCopy(ctx.locale);
  const { headingPrefix } = copy;

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

  const projected = workEntry.projectedItem;
  const needsFetch = Boolean(expanded && data.contentOmitted && !data.content && projected);
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
  const fetchedItemRecord = detailQuery.data?.item as unknown as
    | Record<string, unknown>
    | undefined;
  const resolvedContent =
    data.content ??
    (typeof fetchedItemRecord?.content === "string" ? fetchedItemRecord.content : null);

  const hasExpandableBody = Boolean(
    data.files.length > 0 ||
    data.sections.length > 0 ||
    data.entries.length > 0 ||
    resolvedContent ||
    data.contentOmitted ||
    data.supersedesPrevious,
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

  const visibleCatalogEntries = data.entries.slice(0, MAX_CATALOG_ENTRIES);
  const hiddenCatalogCount = Math.max(0, data.entries.length - MAX_CATALOG_ENTRIES);

  return (
    <div
      data-work-entry-id={workEntry.id}
      data-v2-item-type="context_injection"
      data-context-injection-row="true"
      data-context-injection-kind={data.sourceKind}
      data-context-injection-form={data.form}
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
          aria-label={hasExpandableBody ? `${headingPrefix} · ${data.label}` : undefined}
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
              <LayersIcon
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
            <span className="shrink-0 font-normal">{headingPrefix}</span>
            <span
              aria-hidden="true"
              className="mx-2 size-0.5 shrink-0 rounded-full bg-muted-foreground/60"
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground/85">{data.label}</span>
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
          data-step-detail-card="context_injection"
          data-context-injection-body="true"
          className="pmx-step-card pmx-context-injection-card mt-1 overflow-auto rounded-xl pt-2.5 pr-4 pb-3 pl-3 font-mono text-2xs leading-4 text-muted-foreground select-text"
        >
          {data.form === "instructions" ? (
            <>
              {data.files.length > 0 ? (
                <ul className="m-0 list-none space-y-0.5 p-0" data-context-injection-files="true">
                  {data.files.map((file) => (
                    <li
                      key={`${file.path}:${file.action}`}
                      className="flex flex-wrap items-baseline gap-2"
                    >
                      <span className="font-medium text-foreground/85 break-all">{file.path}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {resolveFileActionText(file.action, file.statusLabel, copy)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {resolvedContent ? (
                <pre
                  className={cn(
                    "m-0 font-mono text-2xs leading-4 whitespace-pre-wrap break-words text-muted-foreground",
                    data.files.length > 0 && "mt-2",
                  )}
                >
                  {resolvedContent}
                </pre>
              ) : detailQuery.isPending ? (
                <div className="mt-2 italic">{copy.loadingContent}</div>
              ) : null}
            </>
          ) : data.form === "catalog" ? (
            <>
              {data.supersedesPrevious ? (
                <div className="mb-1.5 text-muted-foreground/85">{copy.replacesCatalog}</div>
              ) : null}
              {visibleCatalogEntries.length > 0 ? (
                <ul className="m-0 list-none space-y-1 p-0" data-context-injection-catalog="true">
                  {visibleCatalogEntries.map((item) => (
                    <li key={item.name} className="flex flex-wrap items-baseline gap-1.5">
                      <code className="font-medium text-foreground/85">{item.name}</code>
                      {item.description ? (
                        <span className="text-muted-foreground">{item.description}</span>
                      ) : null}
                    </li>
                  ))}
                  {hiddenCatalogCount > 0 ? (
                    <li className="italic text-muted-foreground/80">
                      {copy.moreItems(hiddenCatalogCount)}
                    </li>
                  ) : null}
                </ul>
              ) : resolvedContent ? (
                <pre className="m-0 font-mono text-2xs leading-4 whitespace-pre-wrap break-words text-muted-foreground">
                  {resolvedContent}
                </pre>
              ) : null}
            </>
          ) : (
            <>
              {data.supersedesPrevious ? (
                <div className="mb-1.5 text-muted-foreground/85">{copy.replacesSnapshot}</div>
              ) : null}
              {data.sections.length > 0 ? (
                <dl className="m-0 space-y-1.5" data-context-injection-sections="true">
                  {data.sections.map((section) => (
                    <div key={section.name}>
                      <dt className="font-medium text-foreground/85">{section.name}</dt>
                      <dd className="m-0 whitespace-pre-wrap break-words text-muted-foreground">
                        {section.text}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : resolvedContent ? (
                <pre className="m-0 font-mono text-2xs leading-4 whitespace-pre-wrap break-words text-muted-foreground">
                  {resolvedContent}
                </pre>
              ) : detailQuery.isPending ? (
                <div className="italic">{copy.loadingContent}</div>
              ) : null}
            </>
          )}
        </div>
      </SmoothDisclosure>
    </div>
  );
}
