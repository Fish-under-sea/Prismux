import { useAtomMount } from "@effect/atom-react";
import { asLaunchingThread } from "@prismux/client-runtime/state/thread-inbox";
import { ThreadHoverCard, ThreadHoverCardPopup } from "../ThreadHoverCard";
import { ThreadTerminalStatusButton } from "../ThreadStatusIndicators";
import { discardComposerDraft } from "../../lib/discardComposerDraft";
import { formatWorktreePathForDisplay } from "../../worktreeCleanup";
import { contextMenuSourceOf } from "../../contextMenuSource";
import { requestCustomSnooze } from "../CustomSnoozeDialog";
import { useSupportsMultiplePullRequests } from "~/hooks/useSupportsMultiplePullRequests";
import { useDeadlinePassed } from "~/hooks/useDeadline";
import { resolveThreadCurrentPullRequestLink } from "@prismux/client-runtime/thread-pull-requests";
import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  canSnooze,
  hasQueuedTurnStart,
  QUEUED_TURN_START_GRACE_MS,
} from "@prismux/client-runtime/state/thread-settled";
import { formatDiffCount } from "@prismux/client-runtime/diff-count";
import {
  resolveSettledThreadTimestamp,
  resolveThreadActivityTimestamp,
} from "@prismux/client-runtime/state/thread-sort";
import { type EnvironmentThreadSearchMatch } from "@prismux/client-runtime/state/thread-search";
import {
  formatWorkingDurationLabel,
  resolveThreadProviderStack,
  threadRuntimeCanArchive,
} from "@prismux/client-runtime/state/models";
import { scopeThreadRef, scopedThreadKey } from "@prismux/client-runtime/environment";
import { toServerClock } from "@prismux/client-runtime/clock";
import {
  AuthOrchestrationOperateScope,
  type ContextMenuSource,
  type EnvironmentId,
  type EnvironmentMachineKind,
  type ProviderInstanceId,
  type ScopedThreadRef,
} from "@prismux/core-contracts";

import type { TimestampFormat } from "@prismux/core-contracts/settings";
import {
  AlarmClockIcon,
  AlarmClockOffIcon,
  ArchiveIcon,
  ArrowRightLeftIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  ClockIcon,
  FolderGit2Icon,
  GitBranchIcon,
  MessageCircleQuestionIcon,
  NetworkIcon,
  PinIcon,
  PinOffIcon,
  ShieldQuestionIcon,
  SquarePenIcon,
  TerminalIcon,
  Trash2Icon,
  Undo2Icon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import {
  memo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { msg, T, useGT, useMessages, Var } from "gt-react";

import type { MessageResolver } from "../../i18n/messages";

import { useRightPanelStore } from "../../rightPanelStore";
import { useOpenPrLink } from "../../lib/openPullRequestLink";
import { useUiStateStore } from "../../uiStateStore";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useNowSecond } from "../../hooks/useNowSecond";
import { vcsEnvironment, vcsBranchRevalidation } from "../../state/vcs";
import { useSidebarLinkedIssueState } from "../../state/issues";
import { useEnvironmentQuery } from "../../state/query";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { formatRelativeTime, parseTimestampDate } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import type { EnvironmentProject } from "@prismux/client-runtime/state/shell";
import { cn } from "~/lib/utils";
import { textDirection } from "~/textDirection";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import {
  animateSidebarLayoutChanges,
  hasUnseenCompletion,
  resolveSidebarRowAccessibility,
  type SidebarDropVerb,
  resolveSidebarRowStatus,
  resolveThreadLastVisitedAt,
  shouldRecedeSidebarThread,
  resolveWorkingStartedAt,
  useRetainedValue,
  withoutRemovedCheckout,
  useSidebarRowSubscriptionLease,
  setFileDragActive,
} from "../Sidebar.logic";
import { resolveLocalCheckoutBranchMismatch } from "../BranchToolbar.logic";
import {
  ThreadPullRequestBadgeControl,
  ThreadPullRequestsMiniList,
  prStatusIndicator,
  resolveThreadPullRequestBadge,
  terminalStatusFromRunningIds,
  type TerminalStatusIndicator,
  useLinkedThreadPullRequest,
  ThreadSearchPullRequestNumber,
} from "../ThreadStatusIndicators";
import { pickSnoozePreset, resolveSnoozePresets, type SnoozePreset } from "../Sidebar.snooze";
import { useThreadShell } from "../../state/entities";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { ThreadSearchMatchExcerpt } from "../ThreadSearchMatch";
import { makeWorkspaceFileDropHandlers } from "../chat/workspaceFileDrop";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../../providerInstances";
import { useThreadRunningTerminalIds } from "../../state/terminalSessions";
import { InlineButton } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Menu, MenuItem, MenuItemDetail, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MiddleTruncate } from "../ui/middle-truncate";
import { ActivityShimmerOverlay } from "../chat/TimelineRowParts";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { useThreadHasUnsentDraft } from "../../composerDraftStore";
import { ThreadDetailsIssueRows } from "../chat/ThreadDetailsIssueRows";
import { IssueGlyph, issueStatePresentation } from "../issue/issuePresentation";
import { ensureLocalApi } from "../../localApi";
import {
  AgentBrandLogo,
  inferAgentBrandFromModel,
  resolveAgentBrandId,
} from "../../prismux/agentBrand";
import type { DaemonSystemPortEntryDto } from "../../prismux/daemonClient";
import { useOptionalPrismuxRuntime } from "../../prismux/PrismuxRuntimeProvider";
import {
  findWorkspaceListeningPorts,
  formatPortMicroBadgeLabel,
  resolveAgentRuntimeLamp,
  resolvePrimaryPortUrl,
  stopActivationKeyPropagation,
  type AgentRuntimeLampInfo,
} from "./sidebarMicroIndicators";
import {
  dispatchSidebarSplitDragEvent,
  PRISMUX_SPLIT_ITEM_MIME,
  resolveSidebarModelShortName,
  type SidebarThreadSplitDragPayload,
} from "./sidebarWorkspaceGrouping";
import { DelegatedSubthreadTree } from "./DelegatedSubthreadTree";
import { isDelegatedChildThreadActive } from "./delegatedThreadTree.logic";

const DELEGATED_PILL_EXPANDED_STYLE: CSSProperties = {
  color: "var(--pmx-accent-text, var(--primary))",
  backgroundColor: "var(--pmx-accent-soft, color-mix(in srgb, var(--primary) 13%, transparent))",
  borderColor: "var(--pmx-accent-border, color-mix(in srgb, var(--primary) 34%, transparent))",
};

const DELEGATED_PILL_RUNNING_STYLE: CSSProperties = {
  color: "var(--pmx-accent-text, var(--primary))",
  backgroundColor: "var(--pmx-accent-soft, color-mix(in srgb, var(--primary) 16%, transparent))",
  borderColor: "var(--pmx-accent-border, color-mix(in srgb, var(--primary) 42%, transparent))",
};

const DELEGATED_RUNNING_DOT_STYLE: CSSProperties = {
  backgroundColor: "var(--pmx-accent, var(--primary))",
};

// The fields thread rows show. Provider status pushes refresh `checkedAt`,
// status and auth on every provider; leaving those out keeps each
// environment's map, and every memoized row, stable across them.
export type SidebarProviderEntry = Pick<
  ProviderInstanceEntry,
  | "instanceId"
  | "driverKind"
  | "enabled"
  | "displayName"
  | "accentColor"
  | "acpRegistryAgentId"
  | "acpRegistryIconUrl"
  | "acpCommandPath"
  | "models"
>;
function compactSidebarTimeLabel(timestamp: string, nowMs: number, resolve: MessageResolver) {
  const parts = formatRelativeTime(timestamp, nowMs, resolve);
  if (parts === null) return "";
  return parts.suffix === null ? resolve(msg("now", { $context: "relative time" })) : parts.value;
}

// Subscribes to the minute tick itself, so only the label re-renders each
// minute. The minute is passed as the clock so it is the formatter's input.
function RelativeTimeLabel(props: { timestamp: string | null }) {
  const nowMinute = useNowMinute();
  const m = useMessages();
  return props.timestamp === null
    ? null
    : compactSidebarTimeLabel(props.timestamp, Date.parse(`${nowMinute}:00.000Z`), m);
}

export function JumpHintBadge(props: { label: string }) {
  return (
    <Kbd aria-hidden data-jump-hint>
      {props.label}
    </Kbd>
  );
}

export const JUMP_HINT_SLOT_CLASS_NAME =
  "[&>:not([data-jump-hint])]:invisible [&>:not([data-jump-hint])]:absolute";

function WorkingDuration(props: { environmentId: EnvironmentId; startedAt: string | null }) {
  const startedMs = props.startedAt !== null ? Date.parse(props.startedAt) : Number.NaN;
  if (Number.isNaN(startedMs)) return null;
  return <WorkingDurationLabel environmentId={props.environmentId} startedMs={startedMs} />;
}

// Self-ticking so only this span re-renders each second, not the whole row;
// the shared tick lands every working row's update in the same frame.
function WorkingDurationLabel(props: { environmentId: EnvironmentId; startedMs: number }) {
  const nowMs = useNowSecond();
  const messages = useMessages();
  return (
    <span className="tabular-nums">
      {formatWorkingDurationLabel(
        toServerClock(props.environmentId, nowMs) - props.startedMs,
        messages,
      )}
    </span>
  );
}

function terminalProcessLabel(count: number, resolve: MessageResolver): string {
  return resolve(
    msg(
      "{count, plural, one {{count} terminal process running} other {{count} terminal processes running}}",
      { count },
    ),
  );
}

function SidebarProviderStack(props: {
  thread: SidebarThreadSummary;
  providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  activeBreathing?: boolean;
}) {
  const stack = resolveThreadProviderStack(props.thread);
  const currentInstanceId = stack[stack.length - 1]!;
  const currentEntry = props.providerEntryByInstanceId.get(currentInstanceId) ?? null;
  if (currentEntry === null) return null;
  const showInstanceBadge = shouldShowInstanceBadge(
    currentEntry,
    props.providerEntryByInstanceId.values(),
  );
  const current = (
    <ProviderInstanceIcon
      driverKind={currentEntry.driverKind}
      displayName={currentEntry.displayName}
      instanceId={currentEntry.instanceId}
      accentColor={currentEntry.accentColor}
      acpRegistryAgentId={currentEntry.acpRegistryAgentId}
      acpRegistryIconUrl={currentEntry.acpRegistryIconUrl}
      acpCommandPath={currentEntry.acpCommandPath}
      model={props.thread.modelSelection.model}
      showBadge={showInstanceBadge}
      size="compact"
      iconClassName="opacity-92 text-sidebar-foreground/90"
    />
  );
  const breathingAttr = props.activeBreathing ? "1" : "0";
  if (stack.length === 1) {
    return (
      <span data-agent-logo-breathing={breathingAttr} className="inline-flex shrink-0 items-center">
        {current}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {stack.slice(0, -1).map((instanceId) => {
        const entry = props.providerEntryByInstanceId.get(instanceId);
        if (entry === undefined) return null;
        return (
          <ProviderInstanceIcon
            key={instanceId}
            driverKind={entry.driverKind}
            displayName={entry.displayName}
            instanceId={entry.instanceId}
            acpRegistryAgentId={entry.acpRegistryAgentId}
            acpRegistryIconUrl={entry.acpRegistryIconUrl}
            acpCommandPath={entry.acpCommandPath}
            iconClassName="size-3 opacity-65"
          />
        );
      })}
      <span
        data-agent-logo-breathing={breathingAttr}
        className="relative z-10 inline-flex items-center"
      >
        {current}
      </span>
    </span>
  );
}

function SidebarThreadTooltip({
  thread,
  project,
  projectDisplayName,
  environmentLabel,
  environmentMachine,
  providerEntry,
  providerEntryByInstanceId,
  showInstanceBadge,
  modelInstanceId,
  modelLabel,
  branchMismatch,
  terminalStatus,
  terminalProcessCount,
  agentLamp,
  workspacePorts,
}: {
  thread: SidebarThreadSummary;
  project: ProjectFaviconProject | null;
  projectDisplayName: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  providerEntry: SidebarProviderEntry | null;
  providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  showInstanceBadge: boolean;
  modelInstanceId: string;
  modelLabel: string;
  branchMismatch: {
    threadBranch: string;
    currentBranch: string;
  } | null;
  terminalStatus: TerminalStatusIndicator | null;
  terminalProcessCount: number;
  agentLamp: AgentRuntimeLampInfo;
  workspacePorts: readonly DaemonSystemPortEntryDto[];
}) {
  const driverKind = providerEntry?.driverKind ?? null;
  const worktreePath = thread.worktreePath?.trim();
  const previousProviderNames = thread.providerInstanceHistory
    .filter((instanceId) => instanceId !== modelInstanceId)
    .map((instanceId) => providerEntryByInstanceId.get(instanceId)?.displayName ?? instanceId);
  const supportsMultiplePullRequests = useSupportsMultiplePullRequests(thread.environmentId);
  const gt = useGT();
  const m = useMessages();
  return (
    <ThreadHoverCardPopup side="right" align="start" sideOffset={4}>
      <ThreadHoverCard
        title={thread.title}
        footer={
          supportsMultiplePullRequests && thread.pullRequests.length > 0 ? (
            <div className="border-t border-border/60 pt-2 pl-0.5 text-xs text-muted-foreground">
              <ThreadPullRequestsMiniList pullRequests={thread.pullRequests} />
            </div>
          ) : null
        }
      >
        {projectDisplayName ? (
          <div className="flex min-w-0 items-center gap-2">
            {project ? <ProjectFavicon project={project} className="size-3 shrink-0" /> : null}
            <div className="min-w-0 truncate text-foreground/75">{projectDisplayName}</div>
          </div>
        ) : null}
        {environmentLabel ? (
          <div className="flex min-w-0 items-center gap-2">
            <EnvironmentMachineIcon
              kind={environmentMachine}
              className="size-3 shrink-0 stroke-muted-foreground"
            />
            <div className="min-w-0 truncate text-foreground/75">{environmentLabel}</div>
          </div>
        ) : null}
        {thread.branch ? (
          <div className="flex min-w-0 items-center gap-2">
            <GitBranchIcon className="size-3 shrink-0 stroke-muted-foreground" />
            <MiddleTruncate value={thread.branch} className="flex" />
          </div>
        ) : null}
        {worktreePath ? (
          <div className="flex min-w-0 items-center gap-2">
            <FolderGit2Icon className="size-3 shrink-0 stroke-muted-foreground" />
            <MiddleTruncate value={formatWorktreePathForDisplay(worktreePath)} className="flex" />
          </div>
        ) : null}
        {branchMismatch ? (
          <div className="flex min-w-0 items-start gap-2 text-warning">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0 stroke-current" />
            <div className="min-w-0 flex-1 wrap-break-word">
              <T>You're currently checked out on another branch.</T>
            </div>
          </div>
        ) : null}
        {driverKind ? (
          <div className="flex min-w-0 items-center gap-2">
            <ProviderInstanceIcon
              driverKind={driverKind}
              displayName={
                providerEntry?.displayName ?? thread.runtime?.providerName ?? modelInstanceId
              }
              instanceId={providerEntry?.instanceId ?? modelInstanceId}
              accentColor={providerEntry?.accentColor}
              acpRegistryAgentId={providerEntry?.acpRegistryAgentId}
              acpRegistryIconUrl={providerEntry?.acpRegistryIconUrl}
              acpCommandPath={providerEntry?.acpCommandPath}
              model={thread.modelSelection.model}
              showBadge={showInstanceBadge && providerEntry?.accentColor !== undefined}
              badgeContent="none"
              badgeClassName="h-2 min-w-2 px-0"
              iconClassName="size-3 shrink-0 opacity-90"
            />
            <div className="min-w-0 truncate text-foreground/75">
              {showInstanceBadge && providerEntry
                ? `${modelLabel} · ${providerEntry.displayName}`
                : modelLabel}
            </div>
          </div>
        ) : null}
        {previousProviderNames.length > 0 ? (
          <div className="flex min-w-0 items-center gap-2">
            <ArrowRightLeftIcon className="size-3 shrink-0 stroke-muted-foreground" />
            <div className="min-w-0 truncate text-foreground/75">
              <T>
                Handed off from <Var>{previousProviderNames.join(", ")}</Var>
              </T>
            </div>
          </div>
        ) : null}
        {terminalStatus ? (
          <div className="flex min-w-0 items-center gap-2">
            <TerminalIcon
              aria-hidden
              className={cn("size-3 shrink-0", terminalStatus.colorClass)}
            />
            <div className="min-w-0 truncate text-foreground/75">
              {terminalProcessLabel(terminalProcessCount, m)}
            </div>
          </div>
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-full", agentLamp.dotClassName)}
          />
          <div className="min-w-0 truncate text-foreground/75">
            {gt("Agent status: {status}", { status: m(agentLamp.labelMessage) })}
          </div>
        </div>
        {workspacePorts.length > 0 ? (
          <div className="flex min-w-0 items-center gap-2">
            <NetworkIcon
              aria-hidden
              className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
            <div className="min-w-0 truncate font-mono text-foreground/80 tabular-nums">
              {gt("Listening ports: {ports}", {
                ports: workspacePorts
                  .slice(0, 3)
                  .map((entry) => `:${entry.port} (${entry.processName})`)
                  .join(", "),
              })}
            </div>
          </div>
        ) : null}
        {thread.runtime?.lastError ? (
          <div
            className={cn(
              "flex min-w-0 items-center gap-2",
              thread.runtime.lastErrorClass === "usage_limit" ? "text-warning" : "text-error",
            )}
          >
            <CircleAlertIcon className="size-3 shrink-0 stroke-current" />
            <div className="min-w-0 truncate">
              {thread.runtime.lastErrorClass === "usage_limit"
                ? gt("Usage limit reached")
                : gt("Error occurred")}
            </div>
          </div>
        ) : null}
      </ThreadHoverCard>
    </ThreadHoverCardPopup>
  );
}

function SnoozeMenuButton(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnooze: (preset: Pick<SnoozePreset, "snoozedUntil">) => void;
  timestampFormat: TimestampFormat;
  environmentId: EnvironmentId;
}) {
  const { open, onOpenChange, onSnooze, timestampFormat, environmentId } = props;
  const gt = useGT();
  const messages = useMessages();
  const presets = open
    ? // oxlint-disable-next-line react/purity -- Presets are resolved only while the menu is open, so each opening reads a fresh time.
      resolveSnoozePresets(new Date(), timestampFormat, environmentId, messages)
    : [];
  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  aria-label={gt("Snooze thread")}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  className="inline-flex h-full cursor-pointer items-center gap-0.5 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground"
                />
              }
            />
          }
        >
          <ClockIcon className="size-3" />
        </TooltipTrigger>
        <TooltipPopup>
          <T>Snooze thread</T>
        </TooltipPopup>
      </Tooltip>
      <MenuPopup side="bottom" align="end">
        {presets.map((preset) => (
          <MenuItem
            key={preset.id}
            onClick={(event) => {
              event.stopPropagation();
              const picked = pickSnoozePreset(presets, preset.id, timestampFormat, environmentId);
              if (picked) onSnooze(picked);
            }}
          >
            {preset.label}
            <MenuItemDetail>{preset.whenLabel}</MenuItemDetail>
          </MenuItem>
        ))}
        {presets.length > 0 ? <MenuSeparator /> : null}
        <MenuItem
          onClick={async (event) => {
            event.stopPropagation();
            const choice = await requestCustomSnooze();
            if (choice) onSnooze(choice);
          }}
        >
          <T>Custom…</T>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

type SortableThreadRowBag = Pick<
  ReturnType<typeof useSortable>,
  "listeners" | "setNodeRef" | "transform" | "transition" | "isDragging"
>;

export const draftSurfaceClassName = "bg-warning/4 hover:bg-warning/8";
export const draftPenClassName = "size-3 shrink-0 text-warning-foreground";

// useSortable memoizes on its `disabled` object, so a fresh one per render
// re-renders every row and marker on each sidebar update.
export const SIDEBAR_SORTABLE_DRAG_DISABLED = { draggable: true } as const;
const SIDEBAR_SORTABLE_DRAG_ENABLED = { draggable: false } as const;

// Takes the row's props rather than a render function: a closure from the
// sidebar body is new on every sidebar render, which rebuilt the bag and
// re-rendered every memoized row with it.
export function SortableThreadRow(
  props: Omit<SidebarThreadRowProps, "sortable"> & {
    sortableId: string;
    sortableDisabled: boolean;
    contextDrag: boolean;
  },
) {
  const { sortableId, sortableDisabled, contextDrag, ...rowProps } = props;
  const canOperateThread = useEnvironmentScope(
    rowProps.thread.environmentId,
    AuthOrchestrationOperateScope,
  );
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    disabled:
      sortableDisabled || !canOperateThread
        ? SIDEBAR_SORTABLE_DRAG_DISABLED
        : SIDEBAR_SORTABLE_DRAG_ENABLED,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  // dnd-kit memoizes each field but not the bag, so the memoized row would
  // rerender on every shell update without this.
  const bag = {
    listeners,
    setNodeRef,
    transform: contextDrag ? null : transform,
    transition: contextDrag && isDragging ? "transform 150ms ease-out" : transition,
    isDragging: isDragging && !contextDrag,
  };
  // The sidebar arranges rows from quiet shells, which hold still while a
  // thread streams; reading the live shell here re-renders only this row.
  const liveThread = useThreadShell(
    scopeThreadRef(rowProps.thread.environmentId, rowProps.thread.id),
  );
  // A runtime on the arranged copy but not the run-less live shell is the list's launch overlay.
  const thread =
    liveThread === null
      ? rowProps.thread
      : rowProps.thread.runtime !== null
        ? asLaunchingThread(liveThread)
        : liveThread;
  // Keyed by variant so a card/slim switch remounts the row.
  return <SidebarThreadRow key={rowProps.variant} {...rowProps} thread={thread} sortable={bag} />;
}
export type SidebarSweepAction = "settle" | "unsettle" | "unsnooze";
const dropVerbBadge: Record<SidebarDropVerb, ReactNode> = {
  pin: (
    <>
      <PinIcon aria-hidden className="size-3" />
      <T>Pin</T>
    </>
  ),
  unpin: (
    <>
      <PinOffIcon aria-hidden className="size-3" />
      <T>Unpin</T>
    </>
  ),
  settle: (
    <>
      <CircleCheckIcon aria-hidden className="size-3" />
      <T>Settle</T>
    </>
  ),
  unsettle: (
    <>
      <Undo2Icon aria-hidden className="size-3" />
      <T>Un-settle</T>
    </>
  ),
  wake: (
    <>
      <AlarmClockOffIcon aria-hidden className="size-3" />
      <T>Wake</T>
    </>
  ),
};

const TOP_STATUS_ICONS = {
  working: CircleDashedIcon,
  waiting: CircleDotDashedIcon,
  input: MessageCircleQuestionIcon,
  request: UserRoundIcon,
  approval: ShieldQuestionIcon,
  failed: CircleAlertIcon,
  done: CircleCheckIcon,
  woke: AlarmClockIcon,
} as const;

function TopStatusIcon(props: { icon: keyof typeof TOP_STATUS_ICONS; className: string }) {
  const Icon = TOP_STATUS_ICONS[props.icon];
  return <Icon aria-hidden className={cn("shrink-0", props.className)} />;
}

function OrcaCompactStatusIcon(props: {
  readonly status: ReturnType<typeof resolveSidebarRowStatus>;
  readonly isUnread: boolean;
  readonly isWoke: boolean;
  readonly hasRun: boolean;
}) {
  const { status, isUnread, isWoke, hasRun } = props;
  if (status === "working" || status === "preparing") {
    return (
      <svg
        aria-hidden
        data-orca-status="working"
        viewBox="0 0 12 12"
        fill="none"
        className="size-3 shrink-0 animate-spin text-warning motion-reduce:animate-none"
      >
        <circle
          cx="6"
          cy="6"
          r="4.25"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeOpacity="0.22"
        />
        <path
          d="M6 1.75A4.25 4.25 0 1 1 1.75 6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (status === "approval") {
    return (
      <ShieldQuestionIcon
        aria-hidden
        data-orca-status="approval"
        className="size-3 shrink-0 text-warning"
      />
    );
  }
  if (status === "input") {
    return (
      <MessageCircleQuestionIcon
        aria-hidden
        data-orca-status="input"
        className="size-3 shrink-0 text-info"
      />
    );
  }
  if (status === "request") {
    return (
      <UserRoundIcon
        aria-hidden
        data-orca-status="request"
        className="size-3 shrink-0 text-guest-foreground"
      />
    );
  }
  if (status === "failed" || status === "limited") {
    return (
      <CircleAlertIcon
        aria-hidden
        data-orca-status="failed"
        className="size-3 shrink-0 text-error"
      />
    );
  }
  if (isWoke) {
    return (
      <AlarmClockIcon
        aria-hidden
        data-orca-status="woke"
        className="size-3 shrink-0 text-warning"
      />
    );
  }
  return (
    <CircleCheckIcon
      aria-hidden
      data-orca-status={isUnread ? "unread" : hasRun ? "done" : "idle"}
      className={cn(
        "size-3 shrink-0",
        isUnread ? "text-success" : hasRun ? "text-success/80" : "text-sidebar-muted-foreground/45",
      )}
    />
  );
}

export type SidebarThreadRowProps = {
  thread: SidebarThreadSummary;
  // "orca-compact" is the default Orca 25px dense single-line row inside a workspace card;
  // "folder" is a one-line row inside a boring sidebar project folder;
  // "folder-multiline" adds the card's environment and PR line under it.
  variant: "card" | "slim" | "folder" | "folder-multiline" | "orca-compact";
  inWorkspaceCard?: boolean | undefined;
  navigationParent?: string | undefined;
  variantAction: SidebarSweepAction;
  settlementSupported: boolean;
  snoozeSupported: boolean;
  pinningSupported: boolean;
  isPinned: boolean;
  sortable?: SortableThreadRowBag | undefined;
  dropVerb: SidebarDropVerb | null;
  dragOverPinned: boolean;
  sweepAction: SidebarSweepAction | null;
  snoozeWakeLabelText: string | null;
  wokeAt: string | null;
  isActive: boolean;
  // Set on the active row only; scrolls it into view when a reveal is owed.
  revealRef?: ((row: HTMLElement, threadKey: string) => (() => void) | undefined) | undefined;
  // Unlike isActive, never true for the ancestor standing in for an open
  // subagent: drafts and PR clicks care about which composer is on screen.
  isRouteThread: boolean;
  // Read at click time; a prop would re-render every row on entering or leaving a thread route.
  readOpensPullRequestsInRightPanel: () => boolean;
  jumpLabel: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  project: EnvironmentProject | null;
  projectDisplayName: string | null;
  providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  timestampFormat: TimestampFormat;
  onThreadClick: (event: ReactMouseEvent, threadRef: ScopedThreadRef) => void;
  onThreadActivate: (threadRef: ScopedThreadRef) => void;
  onStartRename: (threadRef: ScopedThreadRef, title: string) => void;
  onRenameTitleChange: (title: string) => void;
  onCommitRename: (threadRef: ScopedThreadRef, title: string) => void;
  onCancelRename: () => void;
  isRenaming: boolean;
  renamingTitle: string;
  onContextMenu: (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
    source: ContextMenuSource,
  ) => void;
  onSettle: (threadRef: ScopedThreadRef) => void;
  onArchive?: ((threadRef: ScopedThreadRef) => void) | undefined;
  onDelete?: ((threadRef: ScopedThreadRef) => void) | undefined;
  onActionSweepStart: (
    threadRef: ScopedThreadRef,
    action: SidebarSweepAction,
    event: PointerEvent,
  ) => void;
  onUnsettle: (threadRef: ScopedThreadRef) => void;
  onSnooze: (threadRef: ScopedThreadRef, preset: Pick<SnoozePreset, "snoozedUntil">) => void;
  onUnsnooze: (threadRef: ScopedThreadRef) => void;
  onUnpin: (threadRef: ScopedThreadRef) => void;
  onAcknowledgeWoke: (threadRef: ScopedThreadRef, visitedAt: string) => void;
  onFileDropThreads?: ((threadRef: ScopedThreadRef, files: File[]) => void) | undefined;
  delegatedChildren?: readonly SidebarThreadSummary[] | undefined;
  delegatedTreeExpanded?: boolean | undefined;
  delegatedTreeHasRunning?: boolean | undefined;
  activeDelegatedChildKey?: string | null | undefined;
  localLastVisitedAtById?: Readonly<Record<string, string | undefined>> | undefined;
  onToggleDelegatedTree?: ((parentKey: string, hasRunning: boolean) => void) | undefined;
};

// Mounted only while renaming, so each rename starts uncommitted.
function ThreadRenameInput(props: {
  title: string;
  onTitleChange: (title: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  // Enter and Escape blur the input as it unmounts; that blur must not commit again.
  const settledRef = useRef(false);
  const gt = useGT();
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      settledRef.current = true;
      props.onCommit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      settledRef.current = true;
      props.onCancel();
    }
  };
  return (
    <input
      autoFocus
      value={props.title}
      dir="auto"
      aria-label={gt("Thread title")}
      onChange={(event) => props.onTitleChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        if (!settledRef.current) props.onCommit();
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="-mx-1 min-w-0 flex-1 rounded-sm bg-card px-1 text-sm font-medium text-card-foreground outline-none ring-1 ring-inset ring-input focus:ring-foreground"
    />
  );
}

export const SidebarThreadRow = memo(function SidebarThreadRow(props: SidebarThreadRowProps) {
  const gt = useGT();
  const messages = useMessages();
  const {
    isRenaming,
    onArchive,
    onCancelRename,
    onCommitRename,
    onContextMenu,
    onDelete,
    onAcknowledgeWoke,
    onFileDropThreads,
    onRenameTitleChange,
    onSettle,
    onActionSweepStart,
    onSnooze,
    onStartRename,
    onThreadActivate,
    onThreadClick,
    onUnsettle,
    onUnsnooze,
    onUnpin,
    readOpensPullRequestsInRightPanel,
    renamingTitle,
    thread,
    variant,
    variantAction,
  } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const canOperateThread = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const { leaseLiveStatus, rowRef: leaseRowRef } = useSidebarRowSubscriptionLease(props.isActive);
  const { revealRef } = props;
  const rowRef = (row: HTMLElement | null) => {
    const stopReveal = row === null ? undefined : revealRef?.(row, threadKey);
    const releaseLease = leaseRowRef(row);
    if (!stopReveal) return releaseLease;
    return () => {
      stopReveal();
      releaseLease?.();
    };
  };
  const isRegeneratingTitle = thread.titleRegeneration != null;
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt);
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(threadKey));
  const openPrLink = useOpenPrLink();
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds, messages);
  const terminalProcessCount = runningTerminalIds.length;
  const hasUnsentDraft = useThreadHasUnsentDraft(threadRef) && !props.isRouteThread;
  const handleDiscardDraftClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    discardComposerDraft(threadRef);
  };

  const gitCwd = thread.worktreePath ?? props.project?.workspaceRoot ?? null;
  const prismuxRuntime = useOptionalPrismuxRuntime();
  const workspacePorts = findWorkspaceListeningPorts(
    prismuxRuntime?.portsState.ports ?? [],
    gitCwd,
  );
  const portBadgeLabel = formatPortMicroBadgeLabel(workspacePorts);
  const primaryPortUrl = resolvePrimaryPortUrl(workspacePorts);
  const handlePortBadgeClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (workspacePorts.length === 1 && primaryPortUrl && !event.shiftKey) {
      try {
        void ensureLocalApi()
          .shell.openExternal(primaryPortUrl)
          .catch(() => {
            window.open(primaryPortUrl, "_blank", "noopener,noreferrer");
          });
      } catch {
        window.open(primaryPortUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }
    prismuxRuntime?.requestOpenPortsPopover(gitCwd);
  };
  const linkedPullRequestStatus = useLinkedThreadPullRequest(
    thread.environmentId,
    thread.linkedPullRequest,
    leaseLiveStatus,
    thread.pullRequests,
    thread.branchPullRequest,
  );
  const branchTarget =
    leaseLiveStatus && (thread.branch != null || thread.worktreePath !== null) && gitCwd !== null
      ? { environmentId: thread.environmentId, cwd: gitCwd }
      : null;
  const gitStatus = useEnvironmentQuery(
    branchTarget === null
      ? null
      : vcsEnvironment.branch({
          environmentId: branchTarget.environmentId,
          input: { cwd: branchTarget.cwd },
        }),
  );
  useAtomMount(vcsBranchRevalidation(branchTarget));
  const visibleGitStatus = useRetainedValue(
    JSON.stringify([thread.environmentId, gitCwd]),
    gitStatus.data,
  );
  const checkoutThread = withoutRemovedCheckout(thread, visibleGitStatus, props.project);
  const pr = linkedPullRequestStatus?.pr ?? null;
  const supportsMultiplePullRequests = useSupportsMultiplePullRequests(thread.environmentId);
  const currentLinkedPr = supportsMultiplePullRequests
    ? resolveThreadCurrentPullRequestLink(thread.pullRequests)
    : null;

  const isUnread = hasUnseenCompletion({ ...thread, lastVisitedAt });
  const status = resolveSidebarRowStatus({ ...thread, lastVisitedAt });
  const agentLamp = resolveAgentRuntimeLamp(status);
  const lastVisitedDate = lastVisitedAt === undefined ? null : parseTimestampDate(lastVisitedAt);
  const wokeAtDate = props.wokeAt === null ? null : parseTimestampDate(props.wokeAt);
  const isWoke =
    wokeAtDate !== null &&
    (lastVisitedDate === null || lastVisitedDate < wokeAtDate) &&
    thread.settledOverride !== "settled";
  const shouldRecede = shouldRecedeSidebarThread({
    status,
    isUnread,
    isWoke,
    isActive: props.isActive,
    isSelected,
  });
  const topStatus =
    status === "preparing" || status === "working"
      ? {
          label:
            status === "preparing"
              ? gt("Setting up")
              : thread.goal?.status === "active"
                ? gt("Goal", { $context: "thread status: working on a goal" })
                : gt("Working", { $context: "thread status" }),
          icon: "working" as const,
          className: "text-info-foreground",
        }
      : status === "waiting"
        ? {
            label: gt("Waiting", { $context: "thread status" }),
            icon: "waiting" as const,
            className: "text-muted-foreground",
          }
        : status === "approval"
          ? {
              label: gt("Approval", { $context: "thread status: needs approval" }),
              icon: "approval" as const,
              className: "text-warning-foreground",
            }
          : status === "input"
            ? {
                label: gt("Input", { $context: "thread status: needs user input" }),
                icon: "input" as const,
                className: "text-indigo-600 dark:text-indigo-300",
              }
            : status === "request"
              ? {
                  label: gt("Request", { $context: "thread status: guest request" }),
                  icon: "request" as const,
                  className: "text-guest-foreground",
                }
              : status === "limited"
                ? {
                    label: gt("Limited", { $context: "thread status: usage limited" }),
                    icon: "failed" as const,
                    className: "text-warning-foreground",
                  }
                : status === "failed"
                  ? {
                      label: gt("Failed", { $context: "thread status" }),
                      icon: "failed" as const,
                      className: "text-error-foreground",
                    }
                  : isWoke
                    ? {
                        label: gt("Woke", { $context: "thread status: woke from snooze" }),
                        icon: "woke" as const,
                        className: "text-warning-foreground",
                      }
                    : isUnread
                      ? {
                          label: gt("Done", { $context: "thread status" }),
                          icon: "done" as const,
                          className: "text-success-foreground",
                        }
                      : null;
  const isWokeStatus = topStatus?.icon === "woke";

  const branchMismatch = resolveLocalCheckoutBranchMismatch({
    effectiveEnvMode: thread.worktreePath === null ? "local" : "worktree",
    activeWorktreePath: thread.worktreePath,
    activeThreadBranch: thread.branch,
    currentGitBranch: visibleGitStatus?.refName ?? null,
  });
  const prStatus = prStatusIndicator(pr, linkedPullRequestStatus?.sourceControlProvider, messages);

  const modelInstanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = props.providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const showInstanceBadge =
    providerEntry !== null &&
    shouldShowInstanceBadge(providerEntry, props.providerEntryByInstanceId.values());
  const selectedModel = providerEntry?.models.find(
    (model) => model.slug === thread.modelSelection.model,
  );
  const modelLabel = resolveSidebarModelShortName({
    modelSlug: thread.modelSelection.model,
    selectedModel,
    driverKind: providerEntry?.driverKind,
  });

  const splitDragPayload: SidebarThreadSplitDragPayload = {
    kind: "sidebar-thread",
    environmentId: thread.environmentId,
    threadId: thread.id,
    title: thread.title,
    providerId: providerEntry?.driverKind ?? null,
    instanceId: modelInstanceId as ProviderInstanceId,
  };
  const canHtml5SplitDrag = !isRenaming && !props.sortable?.listeners;
  const handleSplitDragStart = (event: ReactDragEvent<HTMLElement>) => {
    if (!canHtml5SplitDrag) return;
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(PRISMUX_SPLIT_ITEM_MIME, JSON.stringify(splitDragPayload));
    event.dataTransfer.setData("text/plain", thread.title);
    dispatchSidebarSplitDragEvent(true, splitDragPayload);
  };
  const handleSplitDragEnd = () => {
    dispatchSidebarSplitDragEvent(false, null);
  };

  const detailsTooltip = (
    <SidebarThreadTooltip
      thread={checkoutThread}
      project={props.project}
      projectDisplayName={props.projectDisplayName}
      environmentLabel={props.environmentLabel}
      environmentMachine={props.environmentMachine}
      providerEntry={providerEntry}
      providerEntryByInstanceId={props.providerEntryByInstanceId}
      showInstanceBadge={showInstanceBadge}
      modelInstanceId={modelInstanceId}
      modelLabel={modelLabel}
      branchMismatch={branchMismatch}
      terminalStatus={terminalStatus}
      terminalProcessCount={terminalProcessCount}
      agentLamp={agentLamp}
      workspacePorts={workspacePorts}
    />
  );

  const handleClick = (event: ReactMouseEvent) => {
    onThreadClick(event, threadRef);
  };
  const handleAcknowledgeWokeClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (props.wokeAt === null) return;
    onAcknowledgeWoke(threadRef, props.wokeAt);
  };
  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    onContextMenu(threadRef, { x: event.clientX, y: event.clientY }, contextMenuSourceOf(event));
  };
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (
      event.key === "F2" &&
      !isRenaming &&
      readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)
    ) {
      event.preventDefault();
      onStartRename(threadRef, thread.title);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onThreadActivate(threadRef);
  };
  const handleDoubleClick = (event: ReactMouseEvent) => {
    if (
      !readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope) ||
      isRenaming ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    event.preventDefault();
    onStartRename(threadRef, thread.title);
  };
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const fileDropHandlers = onFileDropThreads
    ? makeWorkspaceFileDropHandlers({
        setDragActive: (active) => setFileDragActive(setIsFileDragOver, active),
        addFiles: (files) => {
          onFileDropThreads(threadRef, files);
        },
        addFolders: () => {},
      })
    : null;
  const handleSettleClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onSettle(threadRef);
  };
  const handleArchiveClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onArchive?.(threadRef);
  };
  const handleDeleteClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onDelete?.(threadRef);
  };
  const handleQuickActionPointerDown = (event: ReactPointerEvent) => {
    event.stopPropagation();
  };
  const handleActionPointerDown = (event: ReactPointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.stopPropagation();
    onActionSweepStart(threadRef, variantAction, event.nativeEvent);
  };
  const canArchiveAction =
    canOperateThread && onArchive !== undefined && threadRuntimeCanArchive(thread.runtime);
  const canDeleteAction = canOperateThread && onDelete !== undefined;
  const quickActionButtonClassName =
    "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md bg-transparent text-xs text-muted-foreground transition-colors hover:bg-sidebar-foreground/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";
  const archiveQuickButton = canArchiveAction ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-testid="sidebar-row-archive-action"
            aria-label={gt("Archive thread")}
            onClick={handleArchiveClick}
            onPointerDown={handleQuickActionPointerDown}
            className={quickActionButtonClassName}
          />
        }
      >
        <ArchiveIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">
        <T>Archive thread</T>
      </TooltipPopup>
    </Tooltip>
  ) : null;
  const deleteQuickButton = canDeleteAction ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-testid="sidebar-row-delete-action"
            aria-label={gt("Delete", { $context: "verb, delete the thread" })}
            onClick={handleDeleteClick}
            onPointerDown={handleQuickActionPointerDown}
            className={cn(
              quickActionButtonClassName,
              "hover:bg-destructive/12 hover:text-destructive",
            )}
          />
        }
      >
        <Trash2Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">
        <T context="verb, delete the thread">Delete</T>
      </TooltipPopup>
    </Tooltip>
  ) : null;
  const handleUnsettleClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onUnsettle(threadRef);
  };
  const handleUnsnoozeClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onUnsnooze(threadRef);
  };
  const handleUnpinClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onUnpin(threadRef);
  };
  const handleSnoozePreset = (preset: Pick<SnoozePreset, "snoozedUntil">) => {
    onSnooze(threadRef, preset);
  };
  const [snoozeMenuOpenRaw, setSnoozeMenuOpen] = useState(false);
  // The React Compiler caches render results on their inputs, so a clock read
  // here would stay frozen until `thread` changes and a queued-turn gate would
  // never reopen. The gate's clock is state, reset with the thread.
  const [snoozeGateClock, setSnoozeGateClock] = useState(() => ({
    thread,
    now: new Date().toISOString(),
  }));
  if (snoozeGateClock.thread !== thread) {
    // oxlint-disable-next-line react/purity -- Reseeds the snooze gate clock only in the render-phase adjustment that runs when the thread changes.
    setSnoozeGateClock({ thread, now: new Date().toISOString() });
  }
  const snoozeGateNow = snoozeGateClock.now;
  const snoozeGateExpiryMs = hasQueuedTurnStart(thread, { now: snoozeGateNow })
    ? Date.parse(thread.latestUserMessageAt ?? "") + QUEUED_TURN_START_GRACE_MS
    : Number.NaN;
  // A gate still closed past its expiry is held by runtime status, not time,
  // so no clock tick can open it.
  const snoozeGateOpensAt =
    Number.isFinite(snoozeGateExpiryMs) && snoozeGateExpiryMs > Date.parse(snoozeGateNow)
      ? snoozeGateExpiryMs + 50
      : null;
  const snoozeGateOpened = useDeadlinePassed(snoozeGateOpensAt);
  if (snoozeGateOpened && snoozeGateOpensAt !== null) {
    setSnoozeGateClock({ thread, now: new Date(snoozeGateOpensAt).toISOString() });
  }
  const showSnoozeButton =
    canOperateThread && props.snoozeSupported && canSnooze(thread, { now: snoozeGateNow });
  // Closing here, not just masking, keeps the menu from reopening when the button returns.
  if (snoozeMenuOpenRaw && !showSnoozeButton) setSnoozeMenuOpen(false);
  const snoozeMenuOpen = snoozeMenuOpenRaw && showSnoozeButton;
  const jumpHintLabel = snoozeMenuOpen ? null : props.jumpLabel;
  const handlePrClick = (event: ReactMouseEvent<HTMLElement>, targetUrl?: string) => {
    const url = targetUrl ?? pr?.url ?? currentLinkedPr?.url;
    if (!url) return;
    const showInRightPanel = targetUrl !== undefined || readOpensPullRequestsInRightPanel();
    const openedInRightPanel = openPrLink(event, url, showInRightPanel ? threadRef : undefined);
    if (openedInRightPanel && showInRightPanel && !props.isRouteThread) {
      onThreadActivate(threadRef);
    }
  };

  const isAgentActive = agentLamp.state !== "idle";
  const isCardVariant = variant === "card";
  const rowSurfaceClassName = cn(
    "group/sidebar-row relative w-full cursor-pointer overflow-hidden border text-left outline-none select-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    isCardVariant ? "rounded-xl" : "rounded-lg border-transparent",
    variantAction === "unsettle" &&
      !props.isActive &&
      "[&:not(:hover):not(:focus-within)_*:not(.live-activity-focus_*)]:text-secondary-label",
    props.isActive
      ? isCardVariant
        ? "border-sidebar-border/85 bg-sidebar-row-active text-sidebar-foreground shadow-[0_1px_3px_rgb(0_0_0/8%)] dark:shadow-[0_1px_4px_rgb(0_0_0/34%)]"
        : "border-sidebar-border/65 bg-sidebar-row-active text-sidebar-foreground shadow-[0_1px_2px_rgb(0_0_0/6%)] dark:shadow-[0_1px_3px_rgb(0_0_0/28%)]"
      : isSelected || props.sweepAction !== null
        ? isCardVariant
          ? "border-sidebar-border/75 bg-sidebar-row-selected text-sidebar-foreground"
          : "border-sidebar-border/60 bg-sidebar-row-selected text-sidebar-foreground"
        : hasUnsentDraft
          ? cn(
              draftSurfaceClassName,
              isCardVariant && "border-sidebar-border/65",
              "text-sidebar-foreground",
            )
          : shouldRecede
            ? isCardVariant
              ? "border-sidebar-border/55 bg-sidebar-control-surface/40 text-sidebar-muted-foreground/90 hover:border-sidebar-border/80 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
              : "text-sidebar-muted-foreground/90 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            : isCardVariant
              ? "border-sidebar-border/60 bg-sidebar-control-surface/45 text-sidebar-foreground hover:border-sidebar-border/85 hover:bg-sidebar-row-hover"
              : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
    shouldRecede &&
      (status === "preparing" || status === "working") &&
      "opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none",
    isFileDragOver && "ring-1 ring-inset ring-primary/70",
    isFileDragOver && !props.isActive && !isSelected && "bg-sidebar-row-hover",
    props.sortable?.isDragging &&
      "bg-sidebar bg-linear-to-b from-sidebar-row-active to-sidebar-row-active text-sidebar-foreground opacity-100 shadow-lg",
  );
  const sortable = props.sortable;
  const sortableRootProps = sortable
    ? {
        ref: sortable.setNodeRef,
        style: {
          transform: CSS.Translate.toString(sortable.transform),
          transition: sortable.transition,
          // A zero-height boundary also makes dnd-kit scale the source to
          // zero. Only projected peers use scaleY as a visibility sentinel.
          visibility:
            !sortable.isDragging && sortable.transform?.scaleY === 0
              ? ("hidden" as const)
              : undefined,
        },
        ...sortable.listeners,
      }
    : {};
  const destinationVerb = sortable?.isDragging
    ? props.dropVerb
    : props.sweepAction === "unsnooze"
      ? "wake"
      : props.sweepAction;
  const dragDestination =
    destinationVerb !== null ? (
      <span
        role="status"
        className="pointer-events-none ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-primary/40 bg-primary/10 px-1.5 text-2xs font-medium text-primary"
      >
        {dropVerbBadge[destinationVerb]}
      </span>
    ) : null;

  const accessibility = resolveSidebarRowAccessibility({
    title: thread.title,
    statusLabel: topStatus?.label ?? null,
    projectDisplayName: props.projectDisplayName,
    isActive: props.isActive,
  });

  const title = isRenaming ? (
    <ThreadRenameInput
      title={renamingTitle}
      onTitleChange={onRenameTitleChange}
      onCommit={() => onCommitRename(threadRef, renamingTitle)}
      onCancel={onCancelRename}
    />
  ) : (
    <span
      ref={isRegeneratingTitle ? observeVisibleAnimation : undefined}
      className={cn(
        "min-w-0 flex-1 text-start text-sm transition-opacity motion-reduce:transition-none",
        shouldRecede ? "font-normal" : "font-medium",
        isRegeneratingTitle
          ? "relative truncate text-muted-foreground"
          : variant !== "slim"
            ? cn(
                "truncate",
                shouldRecede
                  ? "text-foreground/90 group-hover/sidebar-row:text-foreground group-focus-visible/sidebar-row:text-foreground"
                  : status === "failed" && !isUnread && !isWoke
                    ? "text-foreground/95"
                    : "text-foreground",
              )
            : cn(
                "truncate group-focus-within/sidebar-row:text-foreground group-hover/sidebar-row:text-foreground",
                shouldRecede
                  ? "text-secondary-label"
                  : props.isActive || isWoke || status === "input" || status === "request"
                    ? "text-foreground"
                    : isUnread
                      ? "text-muted-foreground"
                      : "text-secondary-label/90",
              ),
      )}
      dir={textDirection(thread.title)}
    >
      {thread.title}
      {isRegeneratingTitle ? (
        <ActivityShimmerOverlay className="truncate">{thread.title}</ActivityShimmerOverlay>
      ) : null}
    </span>
  );

  const prBadgeShape = supportsMultiplePullRequests
    ? resolveThreadPullRequestBadge(thread.pullRequests)
    : null;
  const openLinkedItems = () => {
    useRightPanelStore.getState().open(threadRef, "pull-requests");
    if (!props.isRouteThread) onThreadActivate(threadRef);
  };
  const prBadge =
    prBadgeShape?.kind === "stack" || pr || currentLinkedPr ? (
      <ThreadPullRequestBadgeControl
        render={<InlineButton />}
        badge={prBadgeShape}
        pullRequests={thread.pullRequests}
        number={pr?.number ?? currentLinkedPr?.number}
        url={pr?.url ?? currentLinkedPr?.url}
        status={prStatus}
        onOpenList={openLinkedItems}
        onOpenPullRequest={handlePrClick}
      />
    ) : null;
  const firstIssue = thread.issues?.[0];
  const issueCount = thread.issues?.length ?? 0;
  const issueState = useSidebarLinkedIssueState(
    thread.environmentId,
    leaseLiveStatus ? thread.issues : undefined,
  );
  const issueStatus = issueState === null ? null : issueStatePresentation(issueState);
  const IssueIcon = issueStatus?.Icon ?? IssueGlyph.issue;
  const issueLabel =
    issueCount === 1 && firstIssue
      ? issueStatus
        ? gt("Issue {key}: {title}, {state}", {
            key: firstIssue.displayKey,
            title: firstIssue.title,
            state: issueStatus.label,
          })
        : gt("Issue {key}: {title}", { key: firstIssue.displayKey, title: firstIssue.title })
      : gt("{count, plural, one {{count} linked issue} other {{count} linked issues}}", {
          count: issueCount,
        });
  const issueBadge = firstIssue ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <InlineButton
            tone="muted"
            aria-label={issueLabel}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              openLinkedItems();
            }}
          />
        }
      >
        <IssueIcon aria-hidden className={cn("size-3 shrink-0", issueStatus?.toneClassName)} />
        <span className="max-w-16 truncate text-xs font-normal text-secondary-label tabular-nums">
          {issueCount === 1 ? firstIssue.displayKey : issueCount}
        </span>
      </TooltipTrigger>
      <TooltipPopup
        side="top"
        sideOffset={0}
        variant="glass"
        className="pointer-events-auto w-80 max-w-[calc(100vw-2rem)] text-left whitespace-normal"
        onContextMenu={(event) => event.stopPropagation()}
      >
        <div className="-mx-1 max-h-[calc(var(--available-height)-0.5rem-2px)] overflow-y-auto overscroll-contain">
          <ThreadDetailsIssueRows
            links={thread.issues ?? []}
            threadRef={threadRef}
            compact={false}
            mountScope="sidebar-tooltip"
            onOpen={() => {
              if (!props.isRouteThread) onThreadActivate(threadRef);
            }}
          />
        </div>
      </TooltipPopup>
    </Tooltip>
  ) : null;
  const terminalStatusIcon = (
    <ThreadTerminalStatusButton
      threadRef={threadRef}
      terminalIds={runningTerminalIds}
      onThreadActivate={onThreadActivate}
    />
  );
  const draftIndicator = hasUnsentDraft ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={gt("Unsent draft")}
            data-testid={`sidebar-draft-indicator-${thread.id}`}
            className="inline-flex shrink-0 items-center"
          />
        }
      >
        <SquarePenIcon aria-hidden className={draftPenClassName} />
      </TooltipTrigger>
      <TooltipPopup side="top">
        <T>Unsent draft</T>
      </TooltipPopup>
    </Tooltip>
  ) : null;
  const showPin =
    props.isPinned && (!sortable?.isDragging || (props.dragOverPinned && props.dropVerb === null));
  const pinIndicator = showPin ? (
    props.pinningSupported && canOperateThread && !sortable?.isDragging ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={gt("Unpin thread")}
              onClick={handleUnpinClick}
              className="group/unpin inline-flex cursor-pointer items-center rounded-sm text-muted-foreground/65 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            />
          }
        >
          <PinIcon
            aria-hidden
            className="size-3 shrink-0 group-hover/unpin:hidden group-focus-visible/unpin:hidden"
          />
          <PinOffIcon
            aria-hidden
            className="hidden size-3 shrink-0 group-hover/unpin:block group-focus-visible/unpin:block"
          />
        </TooltipTrigger>
        <TooltipPopup>
          <T>Unpin thread</T>
        </TooltipPopup>
      </Tooltip>
    ) : (
      <PinIcon
        aria-label={gt("Pinned")}
        role="img"
        className="size-3 shrink-0 text-muted-foreground/65"
      />
    )
  ) : null;

  const portMicroBadge = portBadgeLabel ? (
    <button
      type="button"
      data-testid={`sidebar-port-badge-${thread.id}`}
      aria-label={
        workspacePorts.length === 1
          ? gt("Open workspace port {port} (Shift+click to inspect ports)", {
              port: portBadgeLabel,
            })
          : gt(
              "{count, plural, one {Inspect {count} listening workspace port} other {Inspect {count} listening workspace ports}}",
              { count: workspacePorts.length },
            )
      }
      title={
        workspacePorts.length === 1 && primaryPortUrl
          ? gt("Click to open {url} · Shift+click to inspect ports", {
              url: primaryPortUrl,
            })
          : gt(
              "{count, plural, one {Click to inspect {count} listening workspace port} other {Click to inspect {count} listening workspace ports}}",
              { count: workspacePorts.length },
            )
      }
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={stopActivationKeyPropagation}
      onClick={(event) => {
        handlePortBadgeClick(event);
        if (event.detail > 0) event.currentTarget.blur();
      }}
      className="inline-flex h-4 shrink-0 cursor-pointer items-center gap-0.5 rounded-sm bg-emerald-600/15 px-1 font-mono text-[10px] leading-none font-semibold text-emerald-800 tabular-nums transition-colors hover:bg-emerald-600/25 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring dark:bg-emerald-400/18 dark:text-emerald-200 dark:hover:bg-emerald-400/28"
    >
      <NetworkIcon aria-hidden className="size-2.5 shrink-0" />
      <span>{portBadgeLabel}</span>
    </button>
  ) : null;

  const delegatedChildren = props.delegatedChildren;
  const delegatedCount = delegatedChildren?.length ?? 0;
  const delegatedExpanded = Boolean(props.delegatedTreeExpanded);
  const delegatedHasRunning = Boolean(props.delegatedTreeHasRunning);
  const delegatedRunningCount =
    delegatedHasRunning && delegatedChildren !== undefined
      ? delegatedChildren.reduce((count, child) => {
          const childKey = scopedThreadKey(scopeThreadRef(child.environmentId, child.id));
          return (
            count +
            (isDelegatedChildThreadActive(child, props.localLastVisitedAtById?.[childKey]) ? 1 : 0)
          );
        }, 0)
      : 0;
  const delegatedToggleLabel =
    delegatedHasRunning && delegatedRunningCount > 0
      ? delegatedExpanded
        ? gt(
            "{count, plural, one {Collapse {count} delegated agent ({running} running)} other {Collapse {count} delegated agents ({running} running)}}",
            { count: delegatedCount, running: delegatedRunningCount },
          )
        : gt(
            "{count, plural, one {Expand {count} delegated agent ({running} running)} other {Expand {count} delegated agents ({running} running)}}",
            { count: delegatedCount, running: delegatedRunningCount },
          )
      : delegatedHasRunning
        ? delegatedExpanded
          ? gt(
              "{count, plural, one {Collapse {count} delegated agent (running)} other {Collapse {count} delegated agents (running)}}",
              { count: delegatedCount },
            )
          : gt(
              "{count, plural, one {Expand {count} delegated agent (running)} other {Expand {count} delegated agents (running)}}",
              { count: delegatedCount },
            )
        : delegatedExpanded
          ? gt(
              "{count, plural, one {Collapse {count} delegated agent} other {Collapse {count} delegated agents}}",
              { count: delegatedCount },
            )
          : gt(
              "{count, plural, one {Expand {count} delegated agent} other {Expand {count} delegated agents}}",
              { count: delegatedCount },
            );
  const delegatedPillStyle = delegatedHasRunning
    ? DELEGATED_PILL_RUNNING_STYLE
    : delegatedExpanded
      ? DELEGATED_PILL_EXPANDED_STYLE
      : undefined;
  const delegatedTreeBadge =
    delegatedCount > 0 ? (
      <Tooltip disabled={sortable?.isDragging}>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-testid="sidebar-delegated-tree-toggle"
              data-delegated-expanded={delegatedExpanded ? "true" : "false"}
              data-delegated-running={delegatedHasRunning ? "1" : "0"}
              aria-expanded={delegatedExpanded}
              aria-label={delegatedToggleLabel}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={stopActivationKeyPropagation}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onToggleDelegatedTree?.(threadKey, delegatedHasRunning);
              }}
              style={delegatedPillStyle}
              className={cn(
                "inline-flex h-[18px] shrink-0 cursor-pointer select-none items-center gap-1 rounded-full border px-1.5 font-mono text-3xs leading-none font-medium tabular-nums outline-none transition-[background-color,border-color,color,filter,box-shadow] duration-150 motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                delegatedHasRunning
                  ? "font-semibold hover:brightness-105 [[data-pmx-glass='1']_&]:shadow-xs"
                  : delegatedExpanded
                    ? "hover:brightness-105 [[data-pmx-glass='1']_&]:shadow-2xs"
                    : "border-sidebar-border/55 bg-sidebar-foreground/[0.06] text-sidebar-muted-foreground hover:border-sidebar-border/80 hover:bg-sidebar-foreground/[0.12] hover:text-sidebar-foreground [[data-pmx-glass='1']_&]:border-sidebar-foreground/[0.16] [[data-pmx-glass='1']_&]:bg-sidebar-foreground/[0.08] [[data-pmx-glass='1']_&]:hover:border-sidebar-foreground/[0.26] [[data-pmx-glass='1']_&]:hover:bg-sidebar-foreground/[0.15]",
              )}
            />
          }
        >
          {delegatedHasRunning ? (
            <span
              aria-hidden
              data-delegated-running-dot="true"
              className="size-1.5 shrink-0 animate-pulse rounded-full motion-reduce:animate-none"
              style={DELEGATED_RUNNING_DOT_STYLE}
            />
          ) : null}
          <GitBranchIcon aria-hidden className="size-2.5 shrink-0 opacity-85" />
          <span data-delegated-count="true">{delegatedCount}</span>
          <ChevronRightIcon
            aria-hidden
            data-delegated-chevron="true"
            className={cn(
              "size-2.5 shrink-0 opacity-75 transition-transform duration-150 motion-reduce:transition-none",
              delegatedExpanded && "rotate-90",
            )}
          />
        </TooltipTrigger>
        <TooltipPopup side="top">{delegatedToggleLabel}</TooltipPopup>
      </Tooltip>
    ) : null;

  const delegatedTreeNode =
    delegatedChildren !== undefined && delegatedChildren.length > 0 && delegatedExpanded ? (
      <DelegatedSubthreadTree
        parentKey={threadKey}
        childThreads={delegatedChildren}
        activeThreadKey={props.activeDelegatedChildKey ?? null}
        inWorkspaceCard={props.inWorkspaceCard}
        indentClassName={
          variant === "folder" || variant === "folder-multiline"
            ? "ps-9 pr-1"
            : variant === "card"
              ? "pl-3 pr-1 pt-0.5"
              : undefined
        }
        providerEntryByInstanceId={props.providerEntryByInstanceId}
        localLastVisitedAtById={props.localLastVisitedAtById}
        canOperateEnvironment={canOperateThread}
        onSelectChild={onThreadClick}
        onActivateChild={onThreadActivate}
        onContextMenuChild={onContextMenu}
        onArchiveChild={onArchive}
        onDeleteChild={onDelete}
      />
    ) : null;

  const diff = latestRunDiff(thread);
  // Only the trailing icons would remain, so the row moves them to the title line instead.
  const metaLineEmpty =
    props.environmentLabel === null &&
    prBadge === null &&
    issueBadge === null &&
    diff === null &&
    runningTerminalIds.length === 0 &&
    portMicroBadge === null;
  const metaLine = metaLineEmpty ? null : (
    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-secondary-label text-xs">
      {props.environmentLabel !== null ? (
        <>
          <EnvironmentMachineIcon
            aria-hidden
            kind={props.environmentMachine}
            className="size-3.5 shrink-0 text-icon-muted"
          />
          <span className="min-w-0 flex-1 truncate">{props.environmentLabel}</span>
        </>
      ) : (
        <span className="flex-1" />
      )}
      {portMicroBadge}
      {terminalStatusIcon}
      {prBadge}
      {issueBadge}
      {diff ? (
        <span className="shrink-0 font-mono">
          <span className="text-diff-addition-foreground">+{formatDiffCount(diff.insertions)}</span>{" "}
          <span className="text-diff-deletion-foreground">−{formatDiffCount(diff.deletions)}</span>
        </span>
      ) : null}
      <span
        aria-hidden
        className="pointer-events-none ml-auto inline-flex shrink-0 items-center gap-1"
      >
        <SidebarProviderStack
          thread={thread}
          providerEntryByInstanceId={props.providerEntryByInstanceId}
          activeBreathing={isAgentActive}
        />
      </span>
    </div>
  );
  const titleLineIcons = metaLineEmpty ? (
    <span aria-hidden className="inline-flex shrink-0 items-center gap-1">
      <SidebarProviderStack
        thread={thread}
        providerEntryByInstanceId={props.providerEntryByInstanceId}
        activeBreathing={isAgentActive}
      />
    </span>
  ) : null;

  if (variant === "orca-compact") {
    const hasHoverRowAction =
      (variantAction === "unsnooze" && props.snoozeSupported) ||
      (variantAction !== "unsnooze" && props.settlementSupported) ||
      canArchiveAction ||
      canDeleteAction;
    return (
      <li
        data-thread-item={threadKey}
        {...sortableRootProps}
        {...(fileDropHandlers ?? {})}
        className={cn(
          "list-none",
          delegatedTreeNode === null &&
            "[content-visibility:auto] [contain-intrinsic-size:auto_25px]",
          sortable?.isDragging && "relative z-20",
        )}
      >
        <Tooltip disabled={isRenaming || sortable?.isDragging}>
          <TooltipTrigger
            render={
              <div
                ref={rowRef}
                role="button"
                tabIndex={0}
                draggable={canHtml5SplitDrag || undefined}
                onDragStart={handleSplitDragStart}
                onDragEnd={handleSplitDragEnd}
                data-sidebar-row={threadKey}
                data-sidebar-parent={props.navigationParent}
                data-sidebar-agent-active={isAgentActive ? "1" : "0"}
                data-agent-lamp={agentLamp.state}
                data-split-draggable={canHtml5SplitDrag ? "true" : "false"}
                aria-label={accessibility.label}
                aria-current={accessibility.current}
                data-testid="sidebar-row-orca-compact"
                aria-busy={isRegeneratingTitle || undefined}
                className={cn(
                  "group/sidebar-row relative flex h-[25px] w-full cursor-pointer items-center gap-1.5 overflow-hidden rounded-md text-left text-xs outline-none select-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  props.inWorkspaceCard ? "pr-1.5 pl-4" : "px-2",
                  props.isActive
                    ? "bg-sidebar-row-active/80 text-sidebar-foreground"
                    : isSelected || props.sweepAction !== null
                      ? "bg-sidebar-row-selected text-sidebar-foreground"
                      : hasUnsentDraft
                        ? cn(draftSurfaceClassName, "text-sidebar-foreground")
                        : "text-sidebar-foreground/85 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                  isFileDragOver && "ring-1 ring-inset ring-primary/70",
                  isFileDragOver && !props.isActive && !isSelected && "bg-sidebar-row-hover",
                )}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                onKeyDown={handleKeyDown}
                onContextMenu={handleContextMenu}
              />
            }
          >
            <OrcaCompactStatusIcon
              status={status}
              isUnread={isUnread}
              isWoke={isWoke}
              hasRun={thread.latestRun !== null}
            />
            <span aria-hidden className="inline-flex size-3.5 shrink-0 items-center justify-center">
              {providerEntry !== null ? (
                <SidebarProviderStack
                  thread={thread}
                  providerEntryByInstanceId={props.providerEntryByInstanceId}
                  activeBreathing={isAgentActive}
                />
              ) : (
                <AgentBrandLogo
                  provider={(() => {
                    const direct = resolveAgentBrandId(modelInstanceId);
                    if (direct !== "acp" && direct !== "custom") return modelInstanceId;
                    return inferAgentBrandFromModel(thread.modelSelection.model) ?? modelInstanceId;
                  })()}
                  online={isAgentActive}
                  breathing={false}
                  size={14}
                />
              )}
            </span>
            {draftIndicator}
            {isRenaming ? (
              <ThreadRenameInput
                title={renamingTitle}
                onTitleChange={onRenameTitleChange}
                onCommit={() => onCommitRename(threadRef, renamingTitle)}
                onCancel={onCancelRename}
              />
            ) : (
              <span
                ref={isRegeneratingTitle ? observeVisibleAnimation : undefined}
                data-testid="sidebar-row-title"
                className={cn(
                  "min-w-0 flex-1 truncate text-xs leading-none",
                  isRegeneratingTitle
                    ? "relative text-muted-foreground"
                    : props.isActive || isUnread
                      ? "font-medium text-sidebar-foreground"
                      : "font-normal text-sidebar-foreground/85 group-hover/sidebar-row:text-sidebar-foreground",
                )}
                dir={textDirection(thread.title)}
              >
                {thread.title}
                {isRegeneratingTitle ? (
                  <ActivityShimmerOverlay className="truncate">
                    {thread.title}
                  </ActivityShimmerOverlay>
                ) : null}
              </span>
            )}
            {delegatedTreeBadge}
            {pinIndicator}
            {isRegeneratingTitle ? (
              <span role="status" className="sr-only">
                <T>Regenerating title</T>
              </span>
            ) : null}
            {sortable?.isDragging ? (
              dragDestination
            ) : (
              <span
                className={cn(
                  "group/sidebar-status-slot relative ml-auto flex h-5 shrink-0 items-center justify-end gap-1.5",
                  props.sweepAction !== null && "hidden",
                  jumpHintLabel && JUMP_HINT_SLOT_CLASS_NAME,
                )}
              >
                <span
                  className={cn(
                    "inline-flex items-center justify-end gap-1.5 transition-opacity",
                    hasHoverRowAction &&
                      "group-has-[:focus-visible]/sidebar-status-slot:pointer-events-none group-has-[:focus-visible]/sidebar-status-slot:absolute group-has-[:focus-visible]/sidebar-status-slot:right-0 group-has-[:focus-visible]/sidebar-status-slot:opacity-0 group-any-hover/sidebar-row:pointer-events-none group-any-hover/sidebar-row:absolute group-any-hover/sidebar-row:right-0 group-any-hover/sidebar-row:opacity-0",
                  )}
                >
                  {modelLabel ? (
                    <span
                      data-testid="sidebar-row-model-name"
                      className="max-w-20 truncate font-mono text-3xs leading-none text-sidebar-muted-foreground/75"
                    >
                      {modelLabel}
                    </span>
                  ) : null}
                  <span
                    data-testid="sidebar-row-relative-time"
                    className="shrink-0 text-3xs leading-none text-sidebar-muted-foreground/65 tabular-nums"
                  >
                    <RelativeTimeLabel
                      timestamp={
                        variantAction === "unsettle"
                          ? resolveSettledThreadTimestamp(thread)
                          : resolveThreadActivityTimestamp(thread)
                      }
                    />
                  </span>
                </span>
                {hasHoverRowAction ? (
                  <span
                    data-testid="sidebar-row-hover-actions"
                    className="pointer-events-none absolute inset-y-0 right-0 inline-flex items-center gap-0.5 opacity-0 transition-opacity has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:static has-[:focus-visible]:opacity-100 group-any-hover/sidebar-row:pointer-events-auto group-any-hover/sidebar-row:static group-any-hover/sidebar-row:opacity-100"
                  >
                    {variantAction === "unsnooze" ? (
                      !props.snoozeSupported ? null : (
                        <button
                          type="button"
                          aria-label={gt("Wake thread now")}
                          onClick={handleUnsnoozeClick}
                          onPointerDown={handleActionPointerDown}
                          className={quickActionButtonClassName}
                        >
                          <AlarmClockOffIcon className="size-3.5" />
                        </button>
                      )
                    ) : !props.settlementSupported ? null : variantAction === "unsettle" ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              aria-label={gt("Un-settle thread")}
                              onClick={handleUnsettleClick}
                              onPointerDown={handleActionPointerDown}
                              className={quickActionButtonClassName}
                            />
                          }
                        >
                          <Undo2Icon className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipPopup side="top">
                          <T>Un-settle thread</T>
                        </TooltipPopup>
                      </Tooltip>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              aria-label={gt("Settle thread")}
                              onClick={handleSettleClick}
                              onPointerDown={handleActionPointerDown}
                              className={quickActionButtonClassName}
                            />
                          }
                        >
                          <CheckIcon className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipPopup side="top">
                          <T>Settle thread</T>
                        </TooltipPopup>
                      </Tooltip>
                    )}
                    {archiveQuickButton}
                    {deleteQuickButton}
                  </span>
                ) : null}
                {jumpHintLabel ? <JumpHintBadge label={jumpHintLabel} /> : null}
              </span>
            )}
            {props.sweepAction !== null ? dragDestination : null}
          </TooltipTrigger>
          {detailsTooltip}
        </Tooltip>
        {delegatedTreeNode}
      </li>
    );
  }

  if (variant !== "card") {
    const multiline = variant === "folder-multiline";
    const inFolder = variant === "folder" || multiline;
    return (
      <li
        data-thread-item={threadKey}
        {...sortableRootProps}
        {...(fileDropHandlers ?? {})}
        className={cn(
          "list-none",
          delegatedTreeNode === null &&
            "[content-visibility:auto] [contain-intrinsic-size:auto_--spacing(9)]",
          delegatedTreeNode === null &&
            metaLine !== null &&
            multiline &&
            "[contain-intrinsic-size:auto_--spacing(13.5)]",
          sortable?.isDragging && "relative z-20",
        )}
      >
        <Tooltip disabled={isRenaming || sortable?.isDragging}>
          <TooltipTrigger
            render={
              <div
                ref={rowRef}
                role="button"
                tabIndex={0}
                draggable={canHtml5SplitDrag || undefined}
                onDragStart={handleSplitDragStart}
                onDragEnd={handleSplitDragEnd}
                data-sidebar-row={threadKey}
                data-sidebar-parent={props.navigationParent}
                data-sidebar-agent-active={isAgentActive ? "1" : "0"}
                data-agent-lamp={agentLamp.state}
                aria-label={accessibility.label}
                aria-current={accessibility.current}
                data-testid={inFolder ? "sidebar-row-folder" : "sidebar-row-slim"}
                aria-busy={isRegeneratingTitle || undefined}
                className={cn(
                  rowSurfaceClassName,
                  multiline
                    ? "flex flex-col justify-center px-2.5 py-1.5"
                    : "flex h-9 items-center gap-2.5 px-2.5",
                  // Lines titles up with the folder name, past its chevron and icon.
                  inFolder && "ps-9",
                )}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                onKeyDown={handleKeyDown}
                onContextMenu={handleContextMenu}
              />
            }
          >
            {/* `contents` keeps one-line rows a single flex row. */}
            <div className={multiline ? "flex h-6 min-w-0 items-center gap-2.5" : "contents"}>
              {inFolder ? null : (
                <span
                  className={cn(
                    "flex shrink-0 items-center transition-opacity",
                    (!props.isActive || variantAction === "unsettle") &&
                      "opacity-40 grayscale group-focus-within/sidebar-row:opacity-100 group-focus-within/sidebar-row:grayscale-0 group-hover/sidebar-row:opacity-100 group-hover/sidebar-row:grayscale-0",
                  )}
                >
                  {props.project ? (
                    <ProjectFavicon project={props.project} className="size-4" />
                  ) : null}
                </span>
              )}
              {draftIndicator}
              {title}
              {delegatedTreeBadge}
              {multiline ? titleLineIcons : null}
              {pinIndicator}
              {multiline ? null : portMicroBadge}
              {multiline ? null : terminalStatusIcon}
              {multiline ? null : issueBadge}
              {isRegeneratingTitle ? (
                <span role="status" className="sr-only">
                  <T>Regenerating title</T>
                </span>
              ) : null}
              {sortable?.isDragging ? (
                dragDestination
              ) : (
                <span
                  className={cn(
                    "group/sidebar-status-slot relative ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end",
                    props.sweepAction !== null && "hidden",
                    jumpHintLabel && JUMP_HINT_SLOT_CLASS_NAME,
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex justify-end tabular-nums text-secondary-label transition-opacity",
                      !isWoke &&
                        "group-has-[:focus-visible]/sidebar-status-slot:pointer-events-none group-has-[:focus-visible]/sidebar-status-slot:absolute group-has-[:focus-visible]/sidebar-status-slot:right-0 group-has-[:focus-visible]/sidebar-status-slot:opacity-0 group-any-hover/sidebar-row:pointer-events-none group-any-hover/sidebar-row:absolute group-any-hover/sidebar-row:right-0 group-any-hover/sidebar-row:opacity-0",
                    )}
                  >
                    {variantAction === "unsnooze" && props.snoozeWakeLabelText !== null ? (
                      <span className="inline-flex items-center gap-1 text-xs text-info-foreground tabular-nums">
                        {/* The clock tells a wake time from an age at a glance. */}
                        <AlarmClockIcon aria-hidden className="size-3" />
                        {props.snoozeWakeLabelText}
                      </span>
                    ) : (inFolder ? isWokeStatus : isWoke) ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              aria-label={gt("Dismiss Woke notification")}
                              onClick={handleAcknowledgeWokeClick}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-xs font-medium text-warning-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            >
                              <AlarmClockIcon aria-hidden className="size-3" />
                              <span role="status">
                                <T context="thread status: woke from snooze">Woke</T>
                              </span>
                            </button>
                          }
                        />
                        <TooltipPopup side="top">
                          <T>Dismiss Woke notification</T>
                        </TooltipPopup>
                      </Tooltip>
                    ) : inFolder && topStatus ? (
                      // Folder rows have no status line, so the status takes the time slot.
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-xs font-medium",
                          topStatus.className,
                        )}
                      >
                        <TopStatusIcon icon={topStatus.icon} className="size-3" />
                        {topStatus.label}
                      </span>
                    ) : (
                      <span className="text-xs">
                        <RelativeTimeLabel
                          timestamp={
                            variantAction === "unsettle"
                              ? resolveSettledThreadTimestamp(thread)
                              : resolveThreadActivityTimestamp(thread)
                          }
                        />
                      </span>
                    )}
                  </span>
                  {(variantAction === "unsnooze" && props.snoozeSupported) ||
                  (variantAction !== "unsnooze" && props.settlementSupported) ||
                  canArchiveAction ||
                  canDeleteAction ? (
                    <span
                      data-testid="sidebar-row-hover-actions"
                      className={cn(
                        "pointer-events-none absolute inset-y-0 right-0 inline-flex items-center gap-0.5 opacity-0 transition-opacity has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:static has-[:focus-visible]:opacity-100 group-any-hover/sidebar-row:pointer-events-auto group-any-hover/sidebar-row:static group-any-hover/sidebar-row:opacity-100",
                        isWoke && "ml-1",
                      )}
                    >
                      {variantAction === "unsnooze" ? (
                        !props.snoozeSupported ? null : (
                          <button
                            type="button"
                            aria-label={gt("Wake thread now")}
                            onClick={handleUnsnoozeClick}
                            onPointerDown={handleActionPointerDown}
                            className={quickActionButtonClassName}
                          >
                            <AlarmClockOffIcon className="size-3.5" />
                          </button>
                        )
                      ) : !props.settlementSupported ? null : variantAction === "unsettle" ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                aria-label={gt("Un-settle thread")}
                                onClick={handleUnsettleClick}
                                onPointerDown={handleActionPointerDown}
                                className={quickActionButtonClassName}
                              />
                            }
                          >
                            <Undo2Icon className="size-3.5" />
                          </TooltipTrigger>
                          <TooltipPopup side="top">
                            <T>Un-settle thread</T>
                          </TooltipPopup>
                        </Tooltip>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                aria-label={gt("Settle thread")}
                                onClick={handleSettleClick}
                                onPointerDown={handleActionPointerDown}
                                className={quickActionButtonClassName}
                              />
                            }
                          >
                            <CheckIcon className="size-3.5" />
                          </TooltipTrigger>
                          <TooltipPopup side="top">
                            <T>Settle thread</T>
                          </TooltipPopup>
                        </Tooltip>
                      )}
                      {archiveQuickButton}
                      {deleteQuickButton}
                    </span>
                  ) : null}
                  {jumpHintLabel ? <JumpHintBadge label={jumpHintLabel} /> : null}
                </span>
              )}
              {props.sweepAction !== null ? dragDestination : null}
            </div>
            {multiline ? metaLine : null}
          </TooltipTrigger>
          {detailsTooltip}
        </Tooltip>
        {delegatedTreeNode}
      </li>
    );
  }

  return (
    <li
      data-thread-item={threadKey}
      {...sortableRootProps}
      {...(fileDropHandlers ?? {})}
      // The hints are the rendered heights inside py-1. Revealing the open thread measures rows
      // that have not rendered yet, so a hint off by a pixel lands it a pixel short per row above.
      className={cn(
        "list-none py-1",
        delegatedTreeNode === null &&
          "[content-visibility:auto] [contain-intrinsic-size:auto_82px]",
        delegatedTreeNode === null && metaLineEmpty && "[contain-intrinsic-size:auto_64px]",
        sortable?.isDragging && "relative z-20",
      )}
    >
      <Tooltip disabled={isRenaming || snoozeMenuOpen || sortable?.isDragging}>
        <TooltipTrigger
          render={
            <div
              ref={rowRef}
              role="button"
              tabIndex={0}
              data-sidebar-row={threadKey}
              data-sidebar-parent={props.navigationParent}
              data-sidebar-card="1"
              data-sidebar-card-active={props.isActive ? "1" : "0"}
              data-sidebar-agent-active={isAgentActive ? "1" : "0"}
              data-agent-lamp={agentLamp.state}
              aria-label={accessibility.label}
              aria-current={accessibility.current}
              data-testid="sidebar-row-card"
              aria-busy={isRegeneratingTitle || undefined}
              className={rowSurfaceClassName}
              onClick={handleClick}
              onDoubleClick={handleDoubleClick}
              onKeyDown={handleKeyDown}
              onContextMenu={handleContextMenu}
            />
          }
        >
          <div
            className={cn(
              "relative z-10 h-[4.875rem] px-(--sidebar-row-content-inset) py-(--sidebar-content-inset)",
              metaLineEmpty && "h-auto",
            )}
          >
            <div className="flex h-5 min-w-0 items-center gap-1.5">
              {draftIndicator}
              {props.project ? (
                <ProjectFavicon project={props.project} className="size-4 shrink-0" />
              ) : null}
              {/* Left of the status slot, the pin would slide when hover swaps the
                label for the wider row controls. */}
              {pinIndicator}
              {props.projectDisplayName ? (
                <span
                  className={cn("min-w-0 flex-1 truncate font-normal text-secondary-label text-xs")}
                >
                  {props.projectDisplayName}
                </span>
              ) : (
                <span className="flex-1" />
              )}
              {sortable?.isDragging ? (
                dragDestination
              ) : (
                <span
                  className={cn(
                    "group/sidebar-status-slot relative ml-auto flex h-5 min-w-8 shrink-0 items-stretch justify-end text-xs",
                    props.sweepAction !== null && "hidden",
                    jumpHintLabel && JUMP_HINT_SLOT_CLASS_NAME,
                  )}
                >
                  <span
                    className={cn(
                      isWokeStatus
                        ? "pointer-events-auto"
                        : "pointer-events-none group-has-[:focus-visible]/sidebar-status-slot:absolute group-has-[:focus-visible]/sidebar-status-slot:right-0 group-has-[:focus-visible]/sidebar-status-slot:opacity-0 group-any-hover/sidebar-row:absolute group-any-hover/sidebar-row:right-0 group-any-hover/sidebar-row:opacity-0",
                      "flex items-center self-center justify-self-end tabular-nums text-secondary-label",
                      snoozeMenuOpen && "pointer-events-none absolute right-0 opacity-0",
                    )}
                  >
                    {topStatus ? (
                      isWokeStatus ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                aria-label={gt("Dismiss Woke notification")}
                                onClick={handleAcknowledgeWokeClick}
                                className={cn(
                                  "inline-flex cursor-pointer items-center gap-1 rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                                  topStatus.className,
                                )}
                              >
                                <AlarmClockIcon aria-hidden className="size-4 shrink-0" />
                                <span role="status">{topStatus.label}</span>
                              </button>
                            }
                          />
                          <TooltipPopup side="top">
                            <T>Dismiss Woke notification</T>
                          </TooltipPopup>
                        </Tooltip>
                      ) : (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 font-medium",
                            topStatus.className,
                          )}
                        >
                          <TopStatusIcon icon={topStatus.icon} className="size-4" />
                          {/* Not a live region: a collapsed sidebar is inert, so
                            BackgroundThreadAnnouncer and the open thread's
                            timeline speak status changes instead. */}
                          {topStatus.label}
                          {status === "preparing" || status === "working" ? (
                            <span aria-hidden>
                              <WorkingDuration
                                environmentId={thread.environmentId}
                                startedAt={resolveWorkingStartedAt(thread)}
                              />
                            </span>
                          ) : status === "waiting" ? (
                            <span aria-hidden>
                              <WorkingDuration
                                environmentId={thread.environmentId}
                                startedAt={thread.latestRun?.completedAt ?? null}
                              />
                            </span>
                          ) : null}
                        </span>
                      )
                    ) : (
                      <RelativeTimeLabel timestamp={resolveThreadActivityTimestamp(thread)} />
                    )}
                  </span>
                  {props.settlementSupported ||
                  showSnoozeButton ||
                  hasUnsentDraft ||
                  canArchiveAction ||
                  canDeleteAction ? (
                    <span
                      data-testid="sidebar-row-hover-actions"
                      className={cn(
                        // Mouse clicks leave Settle focused; focus-within would pin controls over
                        // the status label after the pointer leaves. Use focus-visible instead.
                        "pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:static has-[:focus-visible]:opacity-100 group-any-hover/sidebar-row:pointer-events-auto group-any-hover/sidebar-row:static group-any-hover/sidebar-row:opacity-100",
                        snoozeMenuOpen && "pointer-events-auto static opacity-100",
                      )}
                    >
                      {hasUnsentDraft ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                aria-label={gt("Discard draft")}
                                onClick={handleDiscardDraftClick}
                                className={quickActionButtonClassName}
                              />
                            }
                          >
                            <XIcon className="size-3.5" />
                          </TooltipTrigger>
                          <TooltipPopup side="top">
                            <T>Discard draft</T>
                          </TooltipPopup>
                        </Tooltip>
                      ) : null}
                      {showSnoozeButton ? (
                        <SnoozeMenuButton
                          open={snoozeMenuOpen}
                          onOpenChange={setSnoozeMenuOpen}
                          onSnooze={handleSnoozePreset}
                          timestampFormat={props.timestampFormat}
                          environmentId={thread.environmentId}
                        />
                      ) : null}
                      {props.settlementSupported ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                aria-label={gt("Settle thread")}
                                onClick={handleSettleClick}
                                onPointerDown={handleActionPointerDown}
                                className={quickActionButtonClassName}
                              />
                            }
                          >
                            <CheckIcon className="size-3.5" />
                          </TooltipTrigger>
                          <TooltipPopup side="top">
                            <T>Settle thread</T>
                          </TooltipPopup>
                        </Tooltip>
                      ) : null}
                      {archiveQuickButton}
                      {deleteQuickButton}
                    </span>
                  ) : null}
                  {jumpHintLabel ? <JumpHintBadge label={jumpHintLabel} /> : null}
                </span>
              )}
              {props.sweepAction !== null ? dragDestination : null}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              {title}
              {delegatedTreeBadge}
              {isRegeneratingTitle ? (
                <span role="status" className="sr-only">
                  <T>Regenerating title</T>
                </span>
              ) : null}
              {titleLineIcons}
            </div>
            {metaLine}
          </div>
        </TooltipTrigger>
        {detailsTooltip}
      </Tooltip>
      {delegatedTreeNode}
    </li>
  );
});

function latestRunDiff(
  thread: SidebarThreadSummary,
): { insertions: number; deletions: number } | null {
  void thread;
  return null;
}

// Attached only to the highlighted result, so React calls it each time the
// highlight lands on a different row: a new query, late rows replacing the first
// result, or arrow keys moving past the scrolled edge.
const scrollHighlightedResultIntoView = (node: HTMLLIElement | null) => {
  node?.scrollIntoView({ block: "nearest" });
};

export const SidebarSearchResultRow = memo(function SidebarSearchResultRow(props: {
  isSettled: boolean;
  thread: SidebarThreadSummary;
  project: EnvironmentProject | null;
  projectDisplayName: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  isHighlighted: boolean;
  isRouteActive: boolean;
  resultId: string;
  searchMatch: EnvironmentThreadSearchMatch | null;
  searchQuery: string;
  /** The query `searchMatch` was found for, which lags `searchQuery` while a search runs. */
  searchMatchQuery?: string;
  onHighlight: () => void;
  onSelect: () => void;
  onContextMenu: (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
    source: ContextMenuSource,
  ) => void;
  onFileDropThreads: (threadRef: ScopedThreadRef, files: File[]) => void;
}) {
  const messages = useMessages();
  const thread =
    useThreadShell(scopeThreadRef(props.thread.environmentId, props.thread.id)) ?? props.thread;
  const accessibility = resolveSidebarRowAccessibility({
    title: thread.title,
    statusLabel: null,
    projectDisplayName: props.projectDisplayName,
    isActive: props.isRouteActive,
  });
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  // Results only drag out as chat context; the row keeps its own listbox attributes.
  const { listeners: dragListeners, setNodeRef: setDragNodeRef } = useDraggable({
    id: scopedThreadKey(threadRef),
  });
  const { leaseLiveStatus, rowRef: leaseRowRef } = useSidebarRowSubscriptionLease(
    props.isHighlighted || props.isRouteActive,
  );
  const isRegeneratingTitle = thread.titleRegeneration != null;
  const rowRef = (row: HTMLElement | null) => {
    setDragNodeRef(row);
    return leaseRowRef(row);
  };
  const gitCwd = thread.worktreePath ?? props.project?.workspaceRoot ?? null;
  const prismuxRuntime = useOptionalPrismuxRuntime();
  const workspacePorts = findWorkspaceListeningPorts(
    prismuxRuntime?.portsState.ports ?? [],
    gitCwd,
  );
  const branchTarget =
    leaseLiveStatus && (thread.branch != null || thread.worktreePath !== null) && gitCwd !== null
      ? { environmentId: thread.environmentId, cwd: gitCwd }
      : null;
  const gitStatus = useEnvironmentQuery(
    branchTarget === null
      ? null
      : vcsEnvironment.branch({
          environmentId: branchTarget.environmentId,
          input: { cwd: branchTarget.cwd },
        }),
  );
  useAtomMount(vcsBranchRevalidation(branchTarget));
  const visibleGitStatus = useRetainedValue(
    JSON.stringify([thread.environmentId, gitCwd]),
    gitStatus.data,
  );
  const checkoutThread = withoutRemovedCheckout(thread, visibleGitStatus, props.project);
  const branchMismatch = resolveLocalCheckoutBranchMismatch({
    effectiveEnvMode: thread.worktreePath === null ? "local" : "worktree",
    activeWorktreePath: thread.worktreePath,
    activeThreadBranch: thread.branch,
    currentGitBranch: visibleGitStatus?.refName ?? null,
  });
  const modelInstanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = props.providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const showInstanceBadge =
    providerEntry !== null &&
    shouldShowInstanceBadge(providerEntry, props.providerEntryByInstanceId.values());
  const selectedModel = providerEntry?.models.find(
    (model) => model.slug === thread.modelSelection.model,
  );
  const modelLabel = resolveSidebarModelShortName({
    modelSlug: thread.modelSelection.model,
    selectedModel,
    driverKind: providerEntry?.driverKind,
  });
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds, messages);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const onFileDropThreads = props.onFileDropThreads;
  const fileDropHandlers = makeWorkspaceFileDropHandlers({
    setDragActive: (active) => setFileDragActive(setIsFileDragOver, active),
    addFiles: (files) => {
      onFileDropThreads(threadRef, files);
    },
    addFolders: () => {},
  });
  return (
    <li
      ref={props.isHighlighted ? scrollHighlightedResultIntoView : undefined}
      role="presentation"
      className="list-none"
      {...fileDropHandlers}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              ref={rowRef}
              id={props.resultId}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={props.isHighlighted}
              aria-current={accessibility.current}
              aria-describedby={`${props.resultId}-pr`}
              aria-label={accessibility.label}
              {...dragListeners}
              onMouseMove={props.onHighlight}
              // Focus stays in the search box, as for Enter. A focused result would lose focus as
              // the results close, and its recovery scrolls the list away from the opened thread.
              // dnd-kit ignores a prevented press, so the drag listener runs first.
              onPointerDown={(event) => {
                dragListeners?.onPointerDown?.(event);
                event.preventDefault();
              }}
              onClick={props.onSelect}
              onContextMenu={(event) => {
                event.preventDefault();
                props.onContextMenu(
                  threadRef,
                  { x: event.clientX, y: event.clientY },
                  contextMenuSourceOf(event),
                );
              }}
              className={cn(
                "group/sidebar-row group/v2-row flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1 text-left text-sm outline-none",
                props.isHighlighted || props.isRouteActive
                  ? "bg-sidebar-row-active text-sidebar-foreground"
                  : "text-sidebar-muted-foreground/90 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                isFileDragOver && "ring-1 ring-inset ring-primary/70",
                isFileDragOver && !props.isRouteActive && "bg-sidebar-row-hover",
              )}
            />
          }
        >
          {props.project ? (
            <ProjectFavicon
              project={props.project}
              className={cn(
                "size-4 shrink-0 transition-opacity",
                props.isSettled &&
                  !props.isRouteActive &&
                  !props.isHighlighted &&
                  "opacity-40 grayscale group-hover/sidebar-row:opacity-100 group-hover/sidebar-row:grayscale-0",
              )}
            />
          ) : null}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                ref={isRegeneratingTitle ? observeVisibleAnimation : undefined}
                className={cn(
                  "min-w-0 flex-1 truncate",
                  props.isSettled ? "font-normal" : "font-medium",
                  isRegeneratingTitle
                    ? "relative text-muted-foreground"
                    : props.isSettled && !props.isHighlighted && !props.isRouteActive
                      ? "text-secondary-label/90 group-hover/sidebar-row:text-foreground"
                      : "text-foreground",
                )}
              >
                {thread.title}
                {isRegeneratingTitle ? (
                  <ActivityShimmerOverlay className="truncate">
                    {thread.title}
                  </ActivityShimmerOverlay>
                ) : null}
              </span>
              <span id={`${props.resultId}-pr`} className="contents">
                <ThreadSearchPullRequestNumber
                  thread={thread}
                  query={props.searchQuery}
                  enabled={leaseLiveStatus}
                  settled={props.isSettled}
                />
              </span>
              <span className="w-8 shrink-0 text-right text-xs text-secondary-label/85 tabular-nums">
                <RelativeTimeLabel timestamp={resolveThreadActivityTimestamp(thread)} />
              </span>
            </span>
            {props.searchMatch ? (
              <ThreadSearchMatchExcerpt
                match={{
                  source: props.searchMatch.source,
                  snippet: props.searchMatch.snippet,
                  query: props.searchMatchQuery ?? props.searchQuery,
                }}
              />
            ) : null}
          </span>
        </TooltipTrigger>
        <SidebarThreadTooltip
          thread={checkoutThread}
          project={props.project}
          projectDisplayName={props.projectDisplayName}
          environmentLabel={props.environmentLabel}
          environmentMachine={props.environmentMachine}
          providerEntry={providerEntry}
          providerEntryByInstanceId={props.providerEntryByInstanceId}
          showInstanceBadge={showInstanceBadge}
          modelInstanceId={modelInstanceId}
          modelLabel={modelLabel}
          branchMismatch={branchMismatch}
          terminalStatus={terminalStatus}
          terminalProcessCount={runningTerminalIds.length}
          agentLamp={resolveAgentRuntimeLamp(resolveSidebarRowStatus(thread))}
          workspacePorts={workspacePorts}
        />
      </Tooltip>
    </li>
  );
});
