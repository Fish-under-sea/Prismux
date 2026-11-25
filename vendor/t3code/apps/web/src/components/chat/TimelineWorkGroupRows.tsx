import { TimelinePendingApprovalRow } from "./TimelinePendingApprovalRow";
import { WorkLogButton, WorkLogList, WorkLogRow } from "./WorkLog";
import type { WorktreeSetupSnapshot } from "@t3tools/contracts";
import { type ToolActivityIcon } from "@t3tools/contracts";
import {
  liveThoughtLine,
  resolveViewedImageAsset,
  workEntriesViewedImagePaths,
} from "@t3tools/client-runtime/work-log/presentation";
import { resolveWorkGroupScrollAnchor } from "@t3tools/client-runtime/work-log/scroll-anchor";
import { useAssetUrls } from "~/assets/assetUrls";
import { observeResize } from "~/lib/observeResize";
import { tickTextContent } from "~/lib/tickTextContent";
import { observeVisibleAnimation } from "../../lib/visibleAnimation";
import { T, useGT, useMessages } from "gt-react";
import { memo, use, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { workEntryDisplayIndicatesToolFailure } from "../../session-logic";
import ChatMarkdown from "../ChatMarkdown";
import { assetMediaActionsSource } from "./ChatMarkdownMedia";
import { ChevronRightIcon, Minimize2Icon, XIcon } from "lucide-react";
import { Button } from "../ui/button";
import { getVirtualizedScrollFadeClassName } from "../ui/scroll-area";
import {
  liveWorkEntryLabel,
  resolveWorkGroupScrollIndex,
  shouldFollowWorkGroupAppend,
  workEntryIsVisibleInGroup,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { WorktreeSetupCard } from "./WorktreeSetupCard";
import { cn } from "~/lib/utils";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import {
  TimelineRowCtx,
  TimelineRowActivityCtx,
  WorkGroupViewCtx,
  type WorkGroupViewedImage,
  type TimelineWorkEntry,
  type TimelineRow,
} from "./timelineRowContext";
import { TimelineRowTimestamp, ActivityShimmerOverlay } from "./TimelineRowParts";
import {
  failedToolIconClassName,
  toolIconAcceptsTint,
  type WorkEntryIconName,
  ToolActivityIconView,
} from "./TimelineToolActivityIcon";
import {
  useThreadReadTarget,
  threadReadLabel,
  ThreadReadLabel,
  ReasoningTraceContent,
  SimpleWorkEntryRow,
} from "./TimelineWorkEntryRow";
import {
  thoughtPreviewMarkdown,
  THOUGHT_PREVIEW_SOURCE_MAX_LENGTH,
  toolGroupSummaryIconName,
  workEntryIconName,
} from "./TimelineWorkEntryRow.logic";
import { formatWorkingTimerNow } from "./TimelineWorkGroupRows.logic";
import {
  dshActivityCategoryIconName,
  formatDshLiveActivityLabel,
  PROCESS_TITLE_MINIMUM_MS,
} from "./dshWorkSteps.logic";

function useDebouncedLiveTitle(value: string, active: boolean): string {
  const [displayed, setDisplayed] = useState(value);
  const lastSwappedAtRef = useRef(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- debounces live DSH step header updates by 150ms (PROCESS_TITLE_MINIMUM_MS) so rapid tool bursts do not flicker
  useEffect(() => {
    if (!active) {
      return;
    }
    const elapsed = Date.now() - lastSwappedAtRef.current;
    const remaining = Math.max(0, PROCESS_TITLE_MINIMUM_MS - elapsed);
    const timer = window.setTimeout(() => {
      lastSwappedAtRef.current = Date.now();
      setDisplayed(value);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [active, value]);
  return active ? displayed : value;
}

/**
 * Single clean directional chevron for collapsible group headers (smoothly rotates 90° on expand).
 * Never duplicates a chevron in the leading icon slot.
 */
function SingleDisclosureChevron({ expanded }: { expanded: boolean }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
      <ChevronRightIcon
        data-disclosure-chevron="true"
        className={cn(
          "size-3.5 shrink-0 text-icon-muted transition-transform duration-200 group-hover/timeline-row:text-foreground/80 group-hover/live-work:text-foreground/80",
          expanded && "rotate-90 text-foreground/80",
        )}
      />
    </span>
  );
}

export const WorkGroupSection = memo(function WorkGroupSection({
  anchorKey,
  disclosureAnchorKey = anchorKey,
  groupedEntries,
  isExpandedToolGroup,
  displayLabel,
  isLive = false,
  autoExpandReasoning = false,
}: {
  anchorKey: string;
  disclosureAnchorKey?: string;
  groupedEntries: Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"];
  isExpandedToolGroup: boolean;
  displayLabel?: string | undefined;
  isLive?: boolean | undefined;
  autoExpandReasoning?: boolean | undefined;
}) {
  const {
    workspaceRoot,
    routeThreadKey,
    onToggleWorkEntry,
    onWorkEntryContentReady,
    pendingApprovals,
  } = use(TimelineRowCtx);
  const gt = useGT();
  const nonEmptyEntries = groupedEntries.filter((entry) => {
    const item = entry.projectedItem?.item;
    return (
      (item?.type === "approval_request" && pendingApprovals.has(item.requestId)) ||
      workEntryIsVisibleInGroup(entry, isExpandedToolGroup || isLive)
    );
  });

  if (nonEmptyEntries.length === 0) return null;
  if (isExpandedToolGroup && nonEmptyEntries.every((entry) => entry.itemType === "reasoning")) {
    return (
      <div
        data-work-group-tree-rail="true"
        className="relative ml-2.5 mt-1 mb-1.5 border-l border-border/55 pl-3 [[data-pmx-glass='1']_&]:border-foreground/15"
      >
        <ReasoningTraceContent entries={nonEmptyEntries} />
      </div>
    );
  }
  if (isExpandedToolGroup) {
    return (
      <ExpandedWorkGroupEntries
        key={`${routeThreadKey}:${anchorKey}`}
        anchorKey={anchorKey}
        disclosureAnchorKey={disclosureAnchorKey}
        entries={nonEmptyEntries}
        groupedEntries={groupedEntries}
        workspaceRoot={workspaceRoot}
        isLive={isLive}
      />
    );
  }

  return (
    <section aria-label={gt("Activity")}>
      {nonEmptyEntries.map((workEntry) => (
        <SimpleWorkEntryRow
          key={workEntry.id}
          workEntry={workEntry}
          workspaceRoot={workspaceRoot}
          displayLabel={displayLabel}
          autoExpandReasoning={autoExpandReasoning}
          onToggleEntry={(collapsed) =>
            onToggleWorkEntry(disclosureAnchorKey, collapsed, workEntry.id)
          }
          onContentReady={() => onWorkEntryContentReady?.(disclosureAnchorKey, workEntry.id)}
        />
      ))}
    </section>
  );
});

function WorkingTimer({ createdAt }: { createdAt: string }) {
  const { activeThreadEnvironmentId } = use(TimelineRowCtx);
  return (
    <span
      ref={tickTextContent(() => formatWorkingTimerNow(createdAt, activeThreadEnvironmentId), true)}
      className="tabular-nums"
    />
  );
}

const compactWorkEntryHeight = 24;

// The thumbnail strip below the group is its own virtualized row, so the gallery an expanded
// entry opens is built from the same entries rather than from the strip's mounted images.
function useWorkGroupViewedImages(
  groupedEntries: ReadonlyArray<TimelineWorkEntry>,
): ReadonlyArray<WorkGroupViewedImage> {
  const { threadRef, workspaceRoot, activeThreadEnvironmentId } = use(TimelineRowCtx);
  const gt = useGT();
  const fallbackName = gt("image", { $context: "fallback name of an image without alt text" });
  const viewed = threadRef
    ? workEntriesViewedImagePaths(groupedEntries).flatMap((path) => {
        const asset = resolveViewedImageAsset(path, {
          threadId: threadRef.threadId,
          workspaceRoot,
        });
        return asset ? [{ path, asset }] : [];
      })
    : [];
  const environmentId = threadRef?.environmentId ?? activeThreadEnvironmentId;
  const urls = useAssetUrls(
    environmentId,
    viewed.map(({ asset }) => asset.resource),
  );
  return viewed.map(({ path, asset }, index) => {
    const url = urls[index];
    if (!url) return { path, item: null };
    const src = url + asset.srcFragment;
    const name = asset.alt.trim() || fallbackName;
    return {
      path,
      item: {
        src,
        name,
        actionsSource: assetMediaActionsSource({
          environmentId,
          resource: asset.resource,
          kind: "image",
          name: asset.alt || fallbackName,
          src,
          workspaceRoot,
        }),
      },
    };
  });
}

function ExpandedWorkGroupEntries({
  anchorKey,
  disclosureAnchorKey,
  entries,
  groupedEntries,
  workspaceRoot,
  isLive = false,
}: {
  anchorKey: string;
  disclosureAnchorKey: string;
  entries: TimelineWorkEntry[];
  groupedEntries: ReadonlyArray<TimelineWorkEntry>;
  workspaceRoot: string | undefined;
  isLive?: boolean;
}) {
  const {
    workGroupViewState: viewState,
    onToggleWorkEntry,
    onWorkEntryContentReady,
  } = use(TimelineRowCtx);
  const gt = useGT();
  const [initialScrollIndex] = useState(() =>
    resolveWorkGroupScrollIndex(entries, viewState.scrollPositions.get(anchorKey)),
  );
  const [restoringPosition, setRestoringPosition] = useState(initialScrollIndex !== undefined);
  const listRef = useRef<LegendListRef>(null);
  const [expandedContentHeight, setExpandedContentHeight] = useState(0);
  const [fades, setFades] = useState({ top: false, bottom: false, viewportHeight: 0 });
  const [appendState, setAppendState] = useState({ entries, follow: false });
  // Capture the pre-change edge once per incoming array, before new layout
  // metrics arrive. Edge/viewport changes never turn a status update into a follow.
  if (appendState.entries !== entries) {
    setAppendState({
      entries,
      follow:
        fades.viewportHeight > 0 &&
        shouldFollowWorkGroupAppend(appendState.entries, entries, fades.bottom ? Infinity : 0),
    });
  }

  const viewedImages = useWorkGroupViewedImages(groupedEntries);
  const groupView = {
    state: viewState,
    viewedImages,
    onToggleEntry: (collapsed: boolean, entryId: string) =>
      onToggleWorkEntry(disclosureAnchorKey, collapsed, entryId),
    onContentReady: (entryId: string) => onWorkEntryContentReady?.(disclosureAnchorKey, entryId),
  };
  const updateScrollFades = () => {
    const element = listRef.current?.getScrollableNode();
    if (!element) return;
    const distanceFromEnd = element.scrollHeight - element.clientHeight - element.scrollTop;
    const viewportHeight = element.clientHeight;
    const top = element.scrollTop > 1;
    const bottom = distanceFromEnd > 1;
    setFades((previous) =>
      previous.top === top &&
      previous.bottom === bottom &&
      previous.viewportHeight === viewportHeight
        ? previous
        : { top, bottom, viewportHeight },
    );
  };

  const handleScroll = () => {
    const state = listRef.current?.getState();
    const position = state && resolveWorkGroupScrollAnchor(state);
    if (position) {
      viewState.scrollPositions.set(anchorKey, {
        entryId: position.rowId,
        offset: position.offsetWithinRow,
      });
    }
    updateScrollFades();
  };

  const handleLoad = () => {
    const list = listRef.current;
    const element = list?.getScrollableNode();
    if (initialScrollIndex && list && element) {
      // Bootstrap can report the restored target before the DOM has applied it.
      // Reconcile once at load, before releasing the measured anchor row.
      const offset = Math.max(
        0,
        Math.min(list.getState().scroll, element.scrollHeight - element.clientHeight),
      );
      if (Math.abs(element.scrollTop - offset) > 1) {
        void list.scrollToOffset({ offset, animated: false });
      }
    }
    setRestoringPosition(false);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes the list scroller and its content with ResizeObserver to update scroll fades
  useLayoutEffect(() => {
    const element = listRef.current?.getScrollableNode();
    if (!element) return;
    updateScrollFades();
    const content = element.firstElementChild;
    return observeResize(content ? [element, content] : element, updateScrollFades);
  }, [updateScrollFades]);

  const renderEntry = ({ item }: { item: TimelineWorkEntry }) => (
    <SimpleWorkEntryRow key={item.id} workEntry={item} workspaceRoot={workspaceRoot} />
  );

  const updateExpandedContentHeight = () => {
    const state = listRef.current?.getState();
    let height = 0;
    for (const entryId of viewState.expandedEntries) {
      if (state?.indexByKey(entryId) === undefined) continue;
      height += Math.max(
        0,
        (state.sizes.get(entryId) ?? compactWorkEntryHeight) - compactWorkEntryHeight,
      );
    }
    setExpandedContentHeight(height);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads expanded row sizes from LegendList's measured state after layout
  useLayoutEffect(updateExpandedContentHeight, [entries, updateExpandedContentHeight]);

  return (
    <WorkGroupViewCtx value={groupView}>
      <div
        data-work-group-tree-rail="true"
        className="relative ml-2.5 mt-1 mb-1.5 border-l border-border/55 pl-3 [[data-pmx-glass='1']_&]:border-foreground/15"
      >
        <WorkLogList>
          <LegendList
            ref={listRef}
            data={entries}
            extraData={workspaceRoot}
            keyExtractor={workEntryKey}
            renderItem={renderEntry}
            estimatedItemSize={compactWorkEntryHeight}
            drawDistance={240}
            recycleItems
            {...(initialScrollIndex ? { initialScrollIndex } : { initialScrollAtEnd: isLive })}
            maintainScrollAtEnd={
              appendState.follow || isLive ? { animated: false, on: { dataChange: true } } : false
            }
            maintainScrollAtEndThreshold={1 / Math.max(1, fades.viewportHeight)}
            // Measure the restored row even when an intra-row offset puts its
            // estimated bounds outside the list's small bootstrap render window.
            {...(restoringPosition && initialScrollIndex
              ? { alwaysRender: { indices: [initialScrollIndex.index] } }
              : {})}
            maintainVisibleContentPosition
            onLoad={handleLoad}
            onScroll={handleScroll}
            onLayout={updateScrollFades}
            onItemSizeChanged={updateExpandedContentHeight}
            tabIndex={0}
            role="region"
            aria-label={gt("Tool calls")}
            data-tool-group-scroll
            data-scroll-fade-top={fades.top ? "true" : undefined}
            data-scroll-fade-bottom={fades.bottom ? "true" : undefined}
            style={{ maxHeight: `calc(min(25rem, 50dvh) + ${expandedContentHeight}px)` }}
            className={cn(
              "scrollbar-gutter-stable scroll-py-6 overflow-x-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
              getVirtualizedScrollFadeClassName(fades),
            )}
          />
        </WorkLogList>
      </div>
    </WorkGroupViewCtx>
  );
}

const workEntryKey = (entry: TimelineWorkEntry) => entry.id;

export function WorkingTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "working" }> }) {
  const { isCompacting, isPreparingWorktree, backgroundWorktreeSetup } =
    use(TimelineRowActivityCtx);
  const compacting = row.compacting === true || isCompacting;
  const shimmer = isPreparingWorktree || compacting;
  const label = isPreparingWorktree ? (
    <T>Setting up worktree…</T>
  ) : compacting ? (
    <CompactingLabel createdAt={row.createdAt} />
  ) : row.createdAt ? (
    <T>
      Working for <WorkingTimer createdAt={row.createdAt} />
    </T>
  ) : (
    <T>Working...</T>
  );
  return (
    <div className="border-b border-border/60 pb-2 pt-1">
      <div className="flex h-6 min-w-0 items-baseline gap-2 px-1 text-sm leading-relaxed text-muted-foreground tabular-nums">
        <span
          ref={shimmer ? observeVisibleAnimation : undefined}
          className="relative shrink-0 overflow-hidden whitespace-nowrap"
        >
          {label}
          {shimmer ? <ActivityShimmerOverlay>{label}</ActivityShimmerOverlay> : null}
        </span>
        {backgroundWorktreeSetup ? (
          <BackgroundWorktreeSetupChip snapshot={backgroundWorktreeSetup} />
        ) : null}
      </div>
    </div>
  );
}

function BackgroundWorktreeSetupChip({ snapshot }: { snapshot: WorktreeSetupSnapshot }) {
  const ctx = use(TimelineRowCtx);
  const gt = useGT();
  const terminalId = snapshot.setupScript?.terminalId ?? null;
  const openTerminal = ctx.onOpenWorktreeSetupTerminal;
  const onOpenTerminal = openTerminal && terminalId ? () => openTerminal(terminalId) : null;
  const scriptName = snapshot.setupScript?.name ?? gt("Setup script");
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost-muted"
            size="micro"
            className="ml-auto min-w-0 shrink-0"
            aria-label={gt(
              "Background setup is still running: {scriptName}. Show setup progress.",
              { scriptName },
            )}
          />
        }
      >
        <Spinner className="size-3 shrink-0" />
        <span className="truncate">
          <T>Background setup</T>
        </span>
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" width="lg" padding="compact">
        <WorktreeSetupCard
          snapshot={snapshot}
          embedded
          onCancel={null}
          onWorkLocally={null}
          onOpenTerminal={onOpenTerminal}
        />
      </PopoverPopup>
    </Popover>
  );
}

function CompactingLabel({ createdAt }: { createdAt: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Minimize2Icon aria-hidden="true" className="size-3" />
      {createdAt ? (
        <span>
          <T>
            Compacting for <WorkingTimer createdAt={createdAt} />
          </T>
        </span>
      ) : (
        <T>Compacting…</T>
      )}
    </span>
  );
}

export function ThinkingTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "thinking" }> }) {
  const ctx = use(TimelineRowCtx);
  const gt = useGT();
  const m = useMessages();
  const { isCompacting, isPreparingWorktree, liveAnswerPreview, providerStartingLabel } =
    use(TimelineRowActivityCtx);
  if (isPreparingWorktree || isCompacting) return <WorkLogRow label="" />;
  // A failed group keeps this disclosure while an approval waits, but nothing is thinking then.
  const live = ctx.pendingApprovals.size === 0;
  const { groupId } = row;
  const expandable = groupId !== undefined;
  const activity = (
    <LiveActivityRow
      label={
        (providerStartingLabel === null ? null : m(providerStartingLabel)) ??
        row.label ??
        liveAnswerPreview ??
        gt("Thinking")
      }
      iconName="brain"
      active={live}
      shimmer={live}
      expandable={expandable}
      expanded={row.expanded === true}
    />
  );
  if (!expandable) return activity;
  return (
    <button
      type="button"
      className="group/live-work flex min-h-6 w-full max-w-full cursor-pointer items-center rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
      aria-expanded={row.expanded === true}
      onClick={() => ctx.onToggleWorkGroup(groupId, row.id)}
    >
      {activity}
    </button>
  );
}

function LiveActivityRow({
  label,
  iconName,
  toolIcon,
  failed = false,
  active = false,
  shimmer = false,
  expandable = false,
  expanded = false,
}: {
  label: ReactNode;
  iconName?: WorkEntryIconName;
  toolIcon?: ToolActivityIcon | undefined;
  failed?: boolean;
  active?: boolean;
  shimmer?: boolean;
  expandable?: boolean;
  expanded?: boolean;
}) {
  const animated = active && !failed;
  const showShimmer = animated && shimmer;
  return (
    <div
      ref={animated ? observeVisibleAnimation : undefined}
      className={cn(
        "relative min-h-6 max-w-full min-w-0 overflow-hidden rounded-md text-sm leading-relaxed",
        expandable ? "w-full" : "w-fit",
      )}
    >
      <LiveActivityContent
        label={label}
        iconName={iconName}
        toolIcon={toolIcon}
        failed={failed}
        announceFailure={failed}
        active={animated && !shimmer}
        liveAccent={animated}
        expandable={expandable}
        expanded={expanded}
      />
      {showShimmer ? (
        <ActivityShimmerOverlay>
          <LiveActivityContent
            label={label}
            iconName={iconName}
            toolIcon={toolIcon}
            highlighted
            liveAccent={animated}
            expandable={false}
            expanded={expanded}
          />
        </ActivityShimmerOverlay>
      ) : null}
    </div>
  );
}

function LiveActivityContent({
  label,
  iconName,
  toolIcon,
  failed = false,
  announceFailure = false,
  active = false,
  highlighted = false,
  liveAccent = false,
  expandable = false,
  expanded = false,
}: {
  label: ReactNode;
  iconName: WorkEntryIconName | undefined;
  toolIcon?: ToolActivityIcon | undefined;
  failed?: boolean;
  announceFailure?: boolean;
  active?: boolean;
  highlighted?: boolean;
  liveAccent?: boolean;
  expandable?: boolean;
  expanded?: boolean;
}) {
  const gt = useGT();
  const showTrailingFailureMark =
    failed && iconName !== undefined && !toolIconAcceptsTint(toolIcon);
  const iconContent = iconName ? (
    <span
      className={cn(
        "relative flex size-4 items-center justify-center",
        failed
          ? failedToolIconClassName
          : liveAccent
            ? "text-primary"
            : highlighted
              ? "text-foreground"
              : "text-icon-muted",
      )}
      role={announceFailure ? "img" : undefined}
      aria-label={announceFailure ? gt("Tool call failed") : undefined}
    >
      <ToolActivityIconView
        icon={toolIcon}
        fallbackName={iconName}
        className="block size-4 shrink-0 stroke-2"
        muted={!highlighted && !liveAccent}
      />
      {liveAccent && !highlighted ? (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -bottom-0.5 size-1.5 animate-pulse rounded-full bg-primary ring-2 ring-background"
        />
      ) : null}
    </span>
  ) : null;

  return (
    <WorkLogRow
      icon={iconContent}
      label={
        <span
          className={cn(
            "block truncate",
            highlighted ? "text-foreground" : "text-foreground/90",
            active && "live-tool-shine",
          )}
        >
          {label}
        </span>
      }
      trailing={
        showTrailingFailureMark || expandable ? (
          <>
            {showTrailingFailureMark ? (
              <XIcon aria-hidden className={cn("size-3 shrink-0", failedToolIconClassName)} />
            ) : null}
            {expandable ? <SingleDisclosureChevron expanded={expanded} /> : null}
          </>
        ) : null
      }
    />
  );
}

export function LiveWorkEntryTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "work-live" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const gt = useGT();
  const m = useMessages();
  const threadTarget = useThreadReadTarget(row.entry, ctx.activeThreadEnvironmentId);
  const legacyLabel = liveWorkEntryLabel(row.entry, ctx.workspaceRoot, row.active, m);
  const threadLabel = threadReadLabel(legacyLabel, row.entry, threadTarget, m);
  const useDshHeader = row.dshMode !== undefined;
  const liveProcessDetail =
    row.liveProcessDetail ?? ctx.workStepsPolicy?.liveProcessDetail ?? true;
  const dshLive = useDshHeader
    ? formatDshLiveActivityLabel(row.entry, {
        liveProcessDetail,
        workspaceRoot: ctx.workspaceRoot,
        locale: ctx.locale,
      })
    : null;
  const debouncedDshText = useDebouncedLiveTitle(dshLive?.text ?? legacyLabel, row.active);

  const item = row.entry.projectedItem?.item;
  const pendingApproval =
    item?.type === "approval_request" ? ctx.pendingApprovals.get(item.requestId) : undefined;
  if (pendingApproval) return <TimelinePendingApprovalRow approval={pendingApproval} />;

  const failed = workEntryDisplayIndicatesToolFailure(row.entry);
  const showThoughtPreview = !useDshHeader && row.thought && !row.expanded && liveProcessDetail;
  const thoughtLine = showThoughtPreview
    ? liveThoughtLine((row.thought?.detail ?? "").slice(0, THOUGHT_PREVIEW_SOURCE_MAX_LENGTH))
    : "";
  const thoughtIsStatus = thoughtLine !== "" && row.entry === row.thought;
  const iconName = dshLive
    ? dshActivityCategoryIconName(dshLive.category)
    : workEntryIconName(row.entry);

  return (
    <button
      type="button"
      data-work-live-header="true"
      data-work-live-mode={row.dshMode}
      className={cn(
        "group/live-work flex w-full max-w-full cursor-pointer rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
        thoughtLine ? "flex-col items-start" : "min-h-6 items-center",
      )}
      aria-label={
        failed
          ? gt("{label}, tool call failed", {
              label: `${thoughtLine ? `${thoughtLine} ` : ""}${threadLabel?.text ?? debouncedDshText}`,
            })
          : undefined
      }
      aria-expanded={row.expanded}
      onClick={() => ctx.onToggleWorkGroup(row.groupId, row.id)}
    >
      {thoughtLine ? (
        <WorkLogRow
          icon={
            <span className="flex size-4 items-center justify-center text-primary/80">
              <ToolActivityIconView
                icon={undefined}
                fallbackName="brain"
                className="block size-4 shrink-0 stroke-2"
                muted
              />
            </span>
          }
          label={
            <span className="line-clamp-4">
              <ChatMarkdown
                inline
                text={thoughtLine}
                cwd={ctx.markdownCwd}
                parseRawHtml={false}
                extensions={thoughtPreviewMarkdown(gt("Thought"))}
              />
            </span>
          }
          wrapLabel
        />
      ) : null}
      <LiveActivityRow
        label={
          useDshHeader ? (
            debouncedDshText
          ) : thoughtIsStatus ? (
            row.active ? (
              gt("Thinking")
            ) : (
              gt("Thought")
            )
          ) : row.entry.itemType === "reasoning" ? (
            <ChatMarkdown
              inline
              text={(row.entry.detail ?? legacyLabel).slice(0, THOUGHT_PREVIEW_SOURCE_MAX_LENGTH)}
              cwd={ctx.markdownCwd}
              parseRawHtml={false}
              extensions={
                row.active
                  ? thoughtPreviewMarkdown(gt("Thinking"))
                  : thoughtPreviewMarkdown(gt("Thought"))
              }
            />
          ) : threadLabel ? (
            <ThreadReadLabel
              label={threadLabel}
              environmentId={ctx.activeThreadEnvironmentId}
              linked={false}
            />
          ) : (
            legacyLabel
          )
        }
        iconName={iconName}
        toolIcon={row.entry.toolIcon ?? row.entry.toolSource?.icon}
        failed={failed}
        active={row.active}
        shimmer={useDshHeader && row.active}
        expandable
        expanded={row.expanded}
      />
    </button>
  );
}

export function WorkGroupToggleTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "work-toggle" }>;
}) {
  const ctx = use(TimelineRowCtx);
  return (
    <WorkGroupHeader
      label={row.summary}
      iconName={row.toolSurface ?? toolGroupSummaryIconName(row.summaryKind)}
      toolIcon={row.toolIcon}
      failed={row.hasFailure}
      expanded={row.expanded}
      createdAt={row.createdAt}
      timestampFormat={ctx.timestampFormat}
      onToggle={() => ctx.onToggleWorkGroup(row.groupId, row.id)}
    />
  );
}

function WorkGroupHeader(props: {
  label: string;
  iconName: WorkEntryIconName;
  toolIcon?: ToolActivityIcon | undefined;
  failed?: boolean | undefined;
  expanded: boolean;
  createdAt: string;
  timestampFormat: TimestampFormat;
  onToggle: () => void;
}) {
  const gt = useGT();
  return (
    <WorkLogButton
      data-work-group-toggle="true"
      data-open={props.expanded ? "true" : undefined}
      aria-label={
        props.failed ? gt("{label}, tool call failed", { label: props.label }) : props.label
      }
      aria-expanded={props.expanded}
      onClick={props.onToggle}
      icon={
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center",
            props.failed ? failedToolIconClassName : "text-icon-muted",
          )}
        >
          <ToolActivityIconView
            icon={props.toolIcon}
            fallbackName={props.iconName}
            className="size-4 shrink-0 stroke-2"
            muted={!props.failed}
          />
        </span>
      }
      label={
        <span className="block truncate text-foreground/88 group-hover/timeline-row:text-foreground">
          {props.label}
        </span>
      }
      trailing={
        <>
          <TimelineRowTimestamp createdAt={props.createdAt} timestampFormat={props.timestampFormat} />
          <SingleDisclosureChevron expanded={props.expanded} />
        </>
      }
    />
  );
}
