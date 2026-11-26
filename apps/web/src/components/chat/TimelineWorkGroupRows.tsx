import { TimelinePendingApprovalRow } from "./TimelinePendingApprovalRow";
import { WorkLogList, WorkLogRow } from "./WorkLog";
import type { WorktreeSetupSnapshot } from "@prismux/core-contracts";
import { type ToolActivityIcon } from "@prismux/core-contracts";
import {
  liveThoughtLine,
  resolveViewedImageAsset,
  workEntriesViewedImagePaths,
} from "@prismux/client-runtime/work-log/presentation";
import { useAssetUrls } from "~/assets/assetUrls";
import { observeResize } from "~/lib/observeResize";
import { tickTextContent } from "~/lib/tickTextContent";
import { observeVisibleAnimation } from "../../lib/visibleAnimation";
import { T, useGT, useMessages } from "gt-react";
import {
  memo,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { workEntryDisplayIndicatesToolFailure } from "../../session-logic";
import ChatMarkdown from "../ChatMarkdown";
import { assetMediaActionsSource } from "./ChatMarkdownMedia";
import { AtomIcon, BookOpenIcon, LayersIcon, Minimize2Icon, XIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  liveWorkEntryLabel,
  workEntryIsVisibleInGroup,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { WorktreeSetupCard } from "./WorktreeSetupCard";
import { cn } from "~/lib/utils";
import {
  TimelineRowCtx,
  TimelineRowActivityCtx,
  WorkGroupViewCtx,
  type WorkGroupViewedImage,
  type TimelineWorkEntry,
  type TimelineRow,
} from "./timelineRowContext";
import { ActivityShimmerOverlay } from "./TimelineRowParts";
import {
  isWideToolActivityIcon,
  toolIconAcceptsTint,
  type WorkEntryIconName,
  ToolActivityIconView,
} from "./TimelineToolActivityIcon";
import {
  DshDisclosureLeadingSlot,
  useThreadReadTarget,
  threadReadLabel,
  ThreadReadLabel,
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
  type DshActivityCategory,
} from "./dshWorkSteps.logic";

const PROCESS_SCROLL_REARM_PX = 8;

const PROCESS_SCROLL_INTERRUPT_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

/** Watches the fixed-height process drawer body/content to auto-follow bottom while armed and compute 24px edge fade flags. */
export function useProcessScroll(
  bodyRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  options: { readonly isLive: boolean; readonly itemCount: number },
): { readonly top: boolean; readonly bottom: boolean } {
  const [fades, setFades] = useState({ top: false, bottom: false });
  const followRef = useRef(options.isLive);
  const initializedRef = useRef(false);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- manages ResizeObserver auto-follow-bottom and edge fade flags for fixed-height process drawer
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!body) return;

    const updateFades = () => {
      const distanceFromBottom = body.scrollHeight - body.clientHeight - body.scrollTop;
      const top = body.scrollTop > 1;
      const bottom = distanceFromBottom > 1;
      setFades((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
    };

    const syncScrollPosition = () => {
      const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
      if (!initializedRef.current) {
        initializedRef.current = true;
        followRef.current = options.isLive;
        body.scrollTop = options.isLive ? maxScrollTop : 0;
        updateFades();
        return;
      }
      if (followRef.current) {
        body.scrollTop = maxScrollTop;
      }
      updateFades();
    };

    const pauseFollow = () => {
      followRef.current = false;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (PROCESS_SCROLL_INTERRUPT_KEYS.has(event.key)) {
        followRef.current = false;
      }
    };

    const handleScroll = () => {
      const distanceFromBottom = body.scrollHeight - body.clientHeight - body.scrollTop;
      if (distanceFromBottom <= PROCESS_SCROLL_REARM_PX) {
        followRef.current = true;
      }
      updateFades();
    };

    syncScrollPosition();
    const stopResize = observeResize(content ? [body, content] : body, syncScrollPosition);
    body.addEventListener("wheel", pauseFollow, { passive: true });
    body.addEventListener("touchstart", pauseFollow, { passive: true });
    body.addEventListener("pointerdown", pauseFollow, { passive: true });
    body.addEventListener("keydown", handleKeyDown);
    body.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      stopResize();
      body.removeEventListener("wheel", pauseFollow);
      body.removeEventListener("touchstart", pauseFollow);
      body.removeEventListener("pointerdown", pauseFollow);
      body.removeEventListener("keydown", handleKeyDown);
      body.removeEventListener("scroll", handleScroll);
    };
  }, [bodyRef, contentRef, options.isLive]);

  return fades;
}

function getDshWorkingCopy(locale: string | undefined) {
  const isZh = (locale ?? "zh").toLowerCase().startsWith("zh");
  return isZh
    ? {
        prefix: "正在处理，用时 ",
        suffix: " ···",
        idle: "正在处理 ···",
        timerLocale: "zh" as const,
      }
    : { prefix: "Working, ", suffix: " ···", idle: "Working ···", timerLocale: "en" as const };
}

function useDebouncedLiveTitle(value: string, active: boolean): string {
  const [displayed, setDisplayed] = useState(value);
  const lastSwappedAtRef = useRef(0);
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- debounces live DSH step header updates by 150ms (PROCESS_TITLE_MINIMUM_MS) so rapid tool bursts do not flicker
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

function renderDshCategoryIcon(input: {
  readonly category?: DshActivityCategory | undefined;
  readonly iconName: WorkEntryIconName;
  readonly toolIcon?: ToolActivityIcon | undefined;
}): ReactNode {
  if (!input.toolIcon) {
    if (input.category === "thinking" || input.iconName === "brain") {
      return <AtomIcon aria-hidden="true" strokeWidth={1.8} className="block size-3.5 shrink-0" />;
    }
    if (input.category === "context") {
      return (
        <LayersIcon aria-hidden="true" strokeWidth={1.8} className="block size-3.5 shrink-0" />
      );
    }
    if (input.category === "skill") {
      return (
        <BookOpenIcon aria-hidden="true" strokeWidth={1.8} className="block size-3.5 shrink-0" />
      );
    }
  }
  return (
    <ToolActivityIconView
      icon={input.toolIcon}
      fallbackName={input.iconName}
      className="block size-3.5 shrink-0 stroke-2"
      muted={false}
    />
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
  autoExpandDetails = false,
}: {
  anchorKey: string;
  disclosureAnchorKey?: string;
  groupedEntries: Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"];
  isExpandedToolGroup: boolean;
  displayLabel?: string | undefined;
  isLive?: boolean | undefined;
  autoExpandReasoning?: boolean | undefined;
  autoExpandDetails?: boolean | undefined;
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
        autoExpandDetails={autoExpandDetails}
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
          autoExpandDetails={autoExpandDetails}
          onToggleEntry={(collapsed) =>
            onToggleWorkEntry(disclosureAnchorKey, collapsed, workEntry.id)
          }
          onContentReady={() => onWorkEntryContentReady?.(disclosureAnchorKey, workEntry.id)}
        />
      ))}
    </section>
  );
});

function WorkingTimer({ createdAt, locale }: { createdAt: string; locale?: string | undefined }) {
  const { activeThreadEnvironmentId } = use(TimelineRowCtx);
  return (
    <span
      ref={tickTextContent(
        () => formatWorkingTimerNow(createdAt, activeThreadEnvironmentId, locale),
        true,
      )}
      className="tabular-nums"
    />
  );
}

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
  disclosureAnchorKey,
  entries,
  groupedEntries,
  workspaceRoot,
  isLive = false,
  autoExpandDetails = false,
}: {
  anchorKey: string;
  disclosureAnchorKey: string;
  entries: TimelineWorkEntry[];
  groupedEntries: ReadonlyArray<TimelineWorkEntry>;
  workspaceRoot: string | undefined;
  isLive?: boolean;
  autoExpandDetails?: boolean;
}) {
  const {
    workGroupViewState: viewState,
    onToggleWorkEntry,
    onWorkEntryContentReady,
  } = use(TimelineRowCtx);
  const gt = useGT();
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fades = useProcessScroll(bodyRef, contentRef, {
    isLive,
    itemCount: entries.length,
  });

  const viewedImages = useWorkGroupViewedImages(groupedEntries);
  const groupView = {
    state: viewState,
    viewedImages,
    onToggleEntry: (collapsed: boolean, entryId: string) =>
      onToggleWorkEntry(disclosureAnchorKey, collapsed, entryId),
    onContentReady: (entryId: string) => onWorkEntryContentReady?.(disclosureAnchorKey, entryId),
  };

  return (
    <WorkGroupViewCtx value={groupView}>
      <div
        data-work-group-depth="2"
        className="pmx-disclosure-enter relative mt-0.5 mb-1.5 min-w-0"
      >
        <WorkLogList>
          <div
            ref={bodyRef}
            tabIndex={0}
            role="region"
            aria-label={gt("Tool calls")}
            data-tool-group-scroll="true"
            data-process-drawer-body="true"
            data-scroll-fade-top={fades.top ? "true" : undefined}
            data-scroll-fade-bottom={fades.bottom ? "true" : undefined}
            style={{ maxHeight: "min(400px, 50vh)" }}
            className="pmx-process-drawer-body scroll-py-6 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
          >
            <div ref={contentRef} className="flex min-w-0 flex-col gap-1 py-0.5">
              {entries.map((item) => (
                <SimpleWorkEntryRow
                  key={item.id}
                  workEntry={item}
                  workspaceRoot={workspaceRoot}
                  autoExpandDetails={autoExpandDetails}
                />
              ))}
            </div>
          </div>
        </WorkLogList>
      </div>
    </WorkGroupViewCtx>
  );
}

export function WorkingTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "working" }> }) {
  const ctx = use(TimelineRowCtx);
  const { isCompacting, isPreparingWorktree, backgroundWorktreeSetup } =
    use(TimelineRowActivityCtx);
  const compacting = row.compacting === true || isCompacting;
  const shimmer = isPreparingWorktree || compacting;
  const dshWorkingCopy = getDshWorkingCopy(ctx.locale);

  if (row.dshStyle || ctx.workStepsPolicy !== undefined) {
    const dshLabel = isPreparingWorktree ? (
      <T>Setting up worktree…</T>
    ) : compacting ? (
      <CompactingLabel createdAt={row.createdAt} locale={ctx.locale} />
    ) : row.createdAt ? (
      <span>
        {dshWorkingCopy.prefix}
        <WorkingTimer createdAt={row.createdAt} locale={dshWorkingCopy.timerLocale} />
        {dshWorkingCopy.suffix}
      </span>
    ) : (
      <span>{dshWorkingCopy.idle}</span>
    );

    return (
      <div data-running-status="true" className="relative mt-1">
        {row.showDividerAbove ? (
          <div aria-hidden="true" data-running-divider="true" className="pmx-running-divider" />
        ) : null}
        <div
          data-running-status-bar="true"
          className="flex h-7 min-w-0 items-center gap-2 px-0.5 text-xs leading-5 font-medium tabular-nums"
          style={{ color: "var(--pmx-accent-text)" }}
        >
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 animate-pulse rounded-full motion-reduce:animate-none"
            style={{ backgroundColor: "var(--pmx-accent-text)" }}
          />
          <span
            ref={shimmer ? observeVisibleAnimation : undefined}
            className="relative min-w-0 truncate whitespace-nowrap"
          >
            {dshLabel}
            {shimmer ? <ActivityShimmerOverlay>{dshLabel}</ActivityShimmerOverlay> : null}
          </span>
          {backgroundWorktreeSetup ? (
            <BackgroundWorktreeSetupChip snapshot={backgroundWorktreeSetup} />
          ) : null}
        </div>
      </div>
    );
  }

  const label = isPreparingWorktree ? (
    <T>Setting up worktree…</T>
  ) : compacting ? (
    <CompactingLabel createdAt={row.createdAt} locale={ctx.locale} />
  ) : row.createdAt ? (
    <T>
      Working for <WorkingTimer createdAt={row.createdAt} locale={ctx.locale} />
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

function CompactingLabel({
  createdAt,
  locale,
}: {
  createdAt: string | null;
  locale?: string | undefined;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Minimize2Icon
        aria-hidden="true"
        className="size-3"
        style={{ color: "var(--pmx-accent-text)" }}
      />
      {createdAt ? (
        <span>
          <T>
            Compacting for <WorkingTimer createdAt={createdAt} locale={locale} />
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
      dshCategory="thinking"
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
      onClick={() => ctx.onToggleWorkGroup(groupId, row.id, row.expanded === true)}
    >
      {activity}
    </button>
  );
}

function LiveActivityRow({
  label,
  iconName,
  dshCategory,
  toolIcon,
  failed = false,
  active = false,
  shimmer = false,
  expandable = false,
  expanded = false,
}: {
  label: ReactNode;
  iconName?: WorkEntryIconName;
  dshCategory?: DshActivityCategory | undefined;
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
        "relative min-h-6 max-w-full min-w-0 overflow-hidden rounded-md text-sm leading-6",
        expandable ? "w-full" : "w-fit",
        expanded && "pb-2",
      )}
    >
      <LiveActivityContent
        label={label}
        iconName={iconName}
        dshCategory={dshCategory}
        toolIcon={toolIcon}
        failed={failed}
        announceFailure={failed}
        active={animated && !shimmer}
        expandable={expandable}
        expanded={expanded}
      />
      {showShimmer ? (
        <ActivityShimmerOverlay>
          <LiveActivityContent
            label={label}
            iconName={iconName}
            dshCategory={dshCategory}
            toolIcon={toolIcon}
            highlighted
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
  dshCategory,
  toolIcon,
  failed = false,
  announceFailure = false,
  active = false,
  highlighted = false,
  expandable = false,
  expanded = false,
}: {
  label: ReactNode;
  iconName: WorkEntryIconName | undefined;
  dshCategory?: DshActivityCategory | undefined;
  toolIcon?: ToolActivityIcon | undefined;
  failed?: boolean;
  announceFailure?: boolean;
  active?: boolean;
  highlighted?: boolean;
  expandable?: boolean;
  expanded?: boolean;
}) {
  const gt = useGT();
  const showTrailingFailureMark =
    failed && iconName !== undefined && !toolIconAcceptsTint(toolIcon);
  const iconContent = iconName ? (
    <DshDisclosureLeadingSlot
      icon={renderDshCategoryIcon({ category: dshCategory, iconName, toolIcon })}
      expandable={expandable && !highlighted}
      expanded={expanded}
      groupScope="live-work"
      iconClassName={
        failed ? "text-destructive" : "text-muted-foreground group-hover/live-work:text-foreground"
      }
      role={announceFailure ? "img" : undefined}
      ariaLabel={announceFailure ? gt("Tool call failed") : undefined}
      liveDot={false}
      wideIcon={isWideToolActivityIcon(toolIcon, iconName)}
    />
  ) : null;

  return (
    <div className="flex h-6 w-full min-w-0 items-center gap-1.5 text-sm leading-6 text-muted-foreground transition-colors duration-200 ease-out group-hover/live-work:text-foreground motion-reduce:transition-none">
      {iconContent}
      <span
        data-live-activity-label="true"
        className={cn(
          "min-w-0 flex-1 truncate",
          highlighted ? "text-foreground" : "text-inherit",
          active && "live-tool-shine",
        )}
      >
        {label}
      </span>
      {showTrailingFailureMark ? (
        <XIcon aria-hidden className="size-3 shrink-0 text-destructive" />
      ) : null}
    </div>
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
  const liveProcessDetail = row.liveProcessDetail ?? ctx.workStepsPolicy?.liveProcessDetail ?? true;
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
      data-open={row.expanded ? "true" : undefined}
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
      onClick={() => ctx.onToggleWorkGroup(row.groupId, row.id, row.expanded)}
    >
      {thoughtLine ? (
        <WorkLogRow
          icon={
            <span className="flex size-4 items-center justify-center text-muted-foreground">
              <AtomIcon aria-hidden="true" strokeWidth={1.8} className="block size-3.5 shrink-0" />
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
        dshCategory={dshLive?.category}
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
  const iconName =
    row.toolSurface ??
    (row.dshPrimaryCategory
      ? dshActivityCategoryIconName(row.dshPrimaryCategory)
      : toolGroupSummaryIconName(row.summaryKind));
  return (
    <WorkGroupHeader
      label={row.summary}
      iconName={iconName}
      dshCategory={row.dshPrimaryCategory}
      toolIcon={row.toolIcon}
      failed={row.hasFailure}
      expanded={row.expanded}
      onToggle={() => ctx.onToggleWorkGroup(row.groupId, row.id, row.expanded)}
    />
  );
}

function WorkGroupHeader(props: {
  label: string;
  iconName: WorkEntryIconName;
  dshCategory?: DshActivityCategory | undefined;
  toolIcon?: ToolActivityIcon | undefined;
  failed?: boolean | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  const gt = useGT();
  return (
    <button
      type="button"
      data-work-group-toggle="true"
      data-open={props.expanded ? "true" : undefined}
      aria-label={
        props.failed ? gt("{label}, tool call failed", { label: props.label }) : props.label
      }
      aria-expanded={props.expanded}
      onClick={props.onToggle}
      className={cn(
        "group/timeline-row flex min-h-6 w-full max-w-full min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-md text-left text-sm leading-6 text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 motion-reduce:transition-none",
        props.expanded && "pb-2",
      )}
    >
      <DshDisclosureLeadingSlot
        icon={renderDshCategoryIcon({
          category: props.dshCategory,
          iconName: props.iconName,
          toolIcon: props.toolIcon,
        })}
        expandable
        expanded={props.expanded}
        groupScope="timeline-row"
        iconClassName={
          props.failed
            ? "text-destructive"
            : "text-muted-foreground group-hover/timeline-row:text-foreground"
        }
        wideIcon={isWideToolActivityIcon(props.toolIcon, props.iconName)}
      />
      <span data-work-group-label="true" className="min-w-0 truncate">
        {props.label}
      </span>
    </button>
  );
}
