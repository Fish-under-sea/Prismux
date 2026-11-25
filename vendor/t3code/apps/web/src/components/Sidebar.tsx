import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { msg, T, useGT, useMessages } from "gt-react";
import { m } from "../i18n/messages";
import { attachSidebarTree } from "../lib/sidebarTree";
import type { EnvironmentServerConfig } from "@t3tools/client-runtime/connection";
import {
  dropThreadContext,
  endThreadContextDrag,
  moveThreadContextDrag as moveThreadContextDragGhost,
} from "./chat/threadContextDrag";
import { discardComposerDraft } from "../lib/discardComposerDraft";
import { requestCustomSnooze } from "./CustomSnoozeDialog";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import {
  DndContext,
  useSensor,
  useSensors,
  type AutoScrollOptions,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  canSnooze,
  effectiveSnoozed,
  threadWokeAt,
} from "@t3tools/client-runtime/state/thread-settled";
import {
  asLaunchingThread,
  createInboxReturnTracker,
  isThreadWorking,
} from "@t3tools/client-runtime/state/thread-inbox";
import { sortSettledThreads } from "@t3tools/client-runtime/state/thread-sort";
import {
  threadRuntimeCanArchive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  parseScopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  type ContextMenuSource,
  type EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  resolveEnvironmentMachineKind,
  type ScopedProjectRef,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { canCreateProjectInEnvironment } from "@t3tools/client-runtime/operations/projects";
import { findProjectByPath, inferProjectTitleFromPath } from "@t3tools/client-runtime/state/projects";
import { createModelSelection } from "@t3tools/shared/model";
import {
  resolveListedAncestorThreadRef,
  type OlderSettledScope,
} from "@t3tools/client-runtime/state/threads";

import { ChevronDownIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { type AnyRouter, useRouter } from "@tanstack/react-router";

import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { isElectron } from "../env";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { isMacPlatform, newProjectId, newThreadId } from "~/lib/utils";
import { readLocalApi } from "../localApi";
import { configuredHostedAppUrl } from "../hostedPairing";
import { useSidebarPendingFileDropStore } from "../sidebarPendingFileDropStore";
import { SidebarFolderDrop } from "./sidebar/SidebarFolderDrop";
import {
  pickableProjectGroups,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import {
  resolveSidebarProjectScopeKeys,
  getSidebarProjectSettingsKey,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import { resolveProjectExpanded, useUiStateStore } from "../uiStateStore";
import {
  getThreadKeysToDeselectAfterDelete,
  useThreadSelectionStore,
} from "../threadSelectionStore";
import {
  canTurnThreadIntoProject,
  useAcknowledgeThreadWoke,
  useThreadActions,
} from "../hooks/useThreadActions";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useNewProject } from "../hooks/useNewProject";
import { useScratchProject } from "../hooks/useScratchProject";
import { useProjectPin } from "../hooks/useProjectGroupUpdate";
import { useSidebarProjectGroups } from "../hooks/useSidebarProjectGroups";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { registerCommands } from "../shortcuts/dispatcher";
import { registerSettleAndAdvance } from "../settleAndAdvance";
import { useClientSettings } from "../hooks/useSettings";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useNowMinute } from "../hooks/useNowMinute";
import {
  useEnvironments,
  useEnvironmentIdentities,
  useConnectedEnvironmentIds,
  useEnvironmentMachines,
} from "../state/environments";
import {
  readThreadShell,
  useAllEnvironmentProjectSnapshotsReady,
  useDelegatedUnderParent,
  useProjects,
  useServerConfigs,
  useQuietThreadShells,
} from "../state/entities";
import { environmentPresentations } from "../state/presentation";
import { primaryServerKeybindingsAtom } from "../state/server";
import { environmentProjects, projectEnvironment } from "../state/projects";
import { sourceControlEnvironment } from "../state/sourceControl";
import { threadEnvironment } from "../state/threads";
import { useOlderSettledShelf, useOlderSettledShelfGrowth } from "../state/olderSettledShelf";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { readEnvironmentScope, useEnvironmentScope } from "../state/session";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { canShareWithGuestAtom } from "./chat/guestShareAvailability";
import { openGuestShareDialog } from "./chat/guestShareDialogState";
import {
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type SidebarThreadSummary,
} from "../types";
import { cn } from "~/lib/utils";
import {
  buildDraftActionMenuItems,
  buildThreadActionMenuItems,
  threadActionRequiresOperate,
} from "./threadActionMenu.logic";
import {
  applySidebarThreadDrop,
  filterSidebarV2VisibleThreads,
  groupSidebarThreadsByProject,
  hasUnseenCompletion,
  sidebarFolderExpansionKeys,
  buildBulkTitleRegenerationContextMenuItem,
  buildBulkUnpinContextMenuItem,
  deleteSelectedThreadEntries,
  firstValidTimestampMs,
  isSidebarNestedLinkClick,
  isTrailingDoubleClick,
  orderItemsByPreferredIds,
  planSidebarThreadDrop,
  resolveAdjacentThreadId,
  resolveSidebarRowStatus,
  resolveSidebarSweepKeys,
  resolveSidebarDropTarget,
  resolveSidebarDropVerb,
  resolveSidebarThreadSection,
  resolveSidebarReorderableThreadKeys,
  resolveThreadLastVisitedAt,
  shouldNavigateAfterThreadPark,
  sidebarListItemId,
  sidebarThreadKeyAtY,
  sortInboxThreadsByReturn,
  sortPinnedThreadsForSidebar,
  sortThreadsForSidebar,
  sortWorkingThreadsBySend,
  useSnoozeWakeClock,
  threadShortcutContext,
  useThreadJumpHintsVisible,
  type SidebarListItem,
  type SidebarSection,
} from "./Sidebar.logic";
import {
  createSidebarCollisionDetection,
  createSidebarSortingStrategy,
  restrictBelowSidebarLabel,
} from "./Sidebar.drag";
import { SidebarPointerSensor } from "./Sidebar.pointer";
import { createSidebarListMotion } from "./Sidebar.motion";
import { createSidebarShiftGuard } from "./Sidebar.shiftGuard";
import {
  pickSnoozePreset,
  resolveSnoozePresets,
  snoozeWakeLabel,
  type SnoozePreset,
} from "./Sidebar.snooze";
import { ProjectFavicon } from "./ProjectFavicon";
import { deriveProviderEntriesByEnvironment } from "../providerInstances";
import { useStableCallback } from "../hooks/useStableCallback";
import {
  resolveSidebarRouteReveal,
  type SidebarRouteReveal,
  useActiveRowReveal,
} from "./sidebar/routeReveal";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { titleRegenerationToast } from "./threadTitleRegenerationToast";
import { copyThreadReference } from "../lib/copyThreadReference";
import { threadChipCopyTarget } from "@t3tools/client-runtime/thread-reference";
import { SidebarContent, SidebarGroup, useSidebar } from "./ui/sidebar";
import { PrismuxSidebarQuickNav } from "./sidebar/PrismuxSidebarQuickNav";
import {
  readSidebarProjectsSectionOpen,
  subscribeLocateActiveSidebarThread,
  subscribeOpenCreateWorkspace,
  writeSidebarProjectsSectionOpen,
} from "./sidebar/prismuxSidebarQuickNav.logic";
import { formatAgentBrandName } from "../prismux/agentBrand";
import { OrcaActivityView } from "./sidebar/orcaProjects/OrcaActivityView";
import {
  OrcaBrowseFolderFallbackDialog,
  OrcaCloneProjectDialog,
  OrcaCreateProjectDialog,
  type OrcaEnvironmentOption,
} from "./sidebar/orcaProjects/OrcaAddProjectMenu";
import { OrcaCreateWorkspaceDialog } from "./sidebar/orcaProjects/OrcaCreateWorkspaceDialog";
import { OrcaProjectsHeader } from "./sidebar/orcaProjects/OrcaProjectsHeader";
import {
  areAllProjectsCollapsed,
  buildOrcaActivityItem,
  computeCollapseAllProjectsNextExpanded,
  createOrcaSidebarShortcutHandler,
  DEFAULT_ORCA_PROJECTS_PREFS,
  filterOrcaActivityItems,
  filterSidebarProjectThreads,
  formatLocalEnvironmentDisplayLabel,
  readOrcaProjectsPrefs,
  summarizeOrcaActivityBadge,
  writeOrcaProjectsPrefs,
  type CreateWorkspacePayload,
  type OrcaActivityItem,
  type OrcaProjectsPrefs,
  type OrcaWorkspaceAgentOption,
} from "./sidebar/orcaProjects/orcaProjects.logic";
import { useOrcaProjectsCopy } from "./sidebar/orcaProjects/orcaProjectsCopy";
import {
  SidebarChromeFooter,
  SidebarChromeHeader,
  SidebarRailMonogramButton,
} from "./sidebar/SidebarChrome";
import {
  resolveSidebarRailThreadTooltip,
  SIDEBAR_EXPANDED_TOOLTIP_DELAY_MS,
  SIDEBAR_RAIL_TOOLTIP_CLOSE_DELAY_MS,
  SIDEBAR_RAIL_TOOLTIP_DELAY_MS,
  SIDEBAR_RAIL_TOOLTIP_TIMEOUT_MS,
} from "./sidebar/sidebarIconRailMotion";
import { resolveAgentRuntimeLamp } from "./sidebar/sidebarMicroIndicators";
import { TooltipProvider } from "./ui/tooltip";
import {
  composerDraftHasUserContent,
  DraftId,
  useComposerDraftStore,
  usePromotingDraftThreadKeys,
} from "../composerDraftStore";
import { useShownThreadRouteTarget } from "../hooks/useShownThreadRouteTarget";
import {
  SortableThreadRow,
  type SidebarProviderEntry,
  type SidebarSweepAction,
} from "./sidebar/SidebarThreadRow";
import {
  draftTerminalLabel,
  SidebarDraftBlock,
  useDraftTerminalLabels,
  useSidebarDrafts,
} from "./sidebar/SidebarDraftBlock";
import {
  SidebarProjectFolderHeader,
  sidebarFolderRowId,
} from "./sidebar/SidebarProjectFolderHeader";
import { SidebarHostGroupCapsule } from "./sidebar/SidebarHostGroupCapsule";
import { SidebarWorkspaceCard } from "./sidebar/SidebarWorkspaceCard";
import {
  groupProjectFoldersByHost,
  type SidebarHostDescriptor,
} from "./sidebar/sidebarWorkspaceGrouping";
import { useRightPanelStore } from "../rightPanelStore";
import {
  SidebarDragBoundary,
  SidebarSectionHeader,
  SidebarSectionPlaceholder,
} from "./sidebar/SidebarListMarkers";

function sameSidebarProviderEntries(
  left: ReadonlyMap<string, SidebarProviderEntry>,
  right: ReadonlyMap<string, SidebarProviderEntry>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [instanceId, entry] of right) {
    const other = left.get(instanceId);
    if (
      other === undefined ||
      other.driverKind !== entry.driverKind ||
      other.enabled !== entry.enabled ||
      other.displayName !== entry.displayName ||
      other.accentColor !== entry.accentColor ||
      other.acpRegistryAgentId !== entry.acpRegistryAgentId ||
      other.acpRegistryIconUrl !== entry.acpRegistryIconUrl ||
      other.models !== entry.models
    ) {
      return false;
    }
  }
  return true;
}

// Resolve providers per environment because default instance ids collide across environments.
const sidebarProviderEntriesAtom = Atom.make((get) => {
  const providersByEnvironment = get(environmentPresentations.providersByEnvironmentAtom);
  const derived = deriveProviderEntriesByEnvironment(
    [...get(environmentPresentations.serverConfigsAtom)].map(
      ([environmentId, config]) =>
        [environmentId, providersByEnvironment.get(environmentId) ?? [], config.settings] as const,
    ),
  );
  const previous = Option.getOrNull(
    get.self<ReadonlyMap<string, ReadonlyMap<string, SidebarProviderEntry>>>(),
  );
  const next = new Map<string, ReadonlyMap<string, SidebarProviderEntry>>();
  let changed = previous === null || previous.size !== derived.size;
  for (const [environmentId, entries] of derived) {
    const prior = previous?.get(environmentId);
    if (prior !== undefined && sameSidebarProviderEntries(prior, entries)) {
      next.set(environmentId, prior);
    } else {
      next.set(environmentId, entries);
      changed = true;
    }
  }
  return !changed && previous !== null ? previous : next;
}).pipe(Atom.withLabel("sidebar-provider-entries"));

const EMPTY_PROVIDER_ENTRIES: ReadonlyMap<string, SidebarProviderEntry> = new Map();
const EMPTY_THREADS: readonly EnvironmentThreadShell[] = [];

const SETTLED_TAIL_INITIAL_COUNT = 10;
const SETTLED_TAIL_PAGE_COUNT = 25;
const SETTLED_SHELF_EXPANDED_KEY = "t3code:sidebar:settled-expanded";
const SNOOZED_SHELF_EXPANDED_KEY = "t3code:sidebar:snoozed-expanded";
const WORKING_SHELF_EXPANDED_KEY = "t3code:sidebar:working-expanded";

const inboxReturns = createInboxReturnTracker();

type SidebarOptimisticDrop = {
  readonly key: string;
  readonly sourceSection: SidebarSection;
  readonly section: "pinned" | "active" | "settled";
  readonly occurredAt: string;
  readonly clearsSnooze: boolean;
  readonly order: readonly string[] | null;
  readonly keysAtDrop: ReadonlyMap<string, string | null>;
  readonly assignedKeys: ReadonlyMap<string, string>;
};

interface SidebarThreadPartitionInput {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  /** Tasks linked environments run for a listed thread; they show under it. */
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly serverConfigs: ReadonlyMap<EnvironmentId, EnvironmentServerConfig>;
  readonly connectedEnvironmentIds: readonly EnvironmentId[];
  readonly optimisticDrop: SidebarOptimisticDrop | null;
  readonly workingShelfEnabled: boolean;
  /** Boring mode: folders list active threads by the user's latest message. */
  readonly sortActiveBySend: boolean;
  // Snooze wakes, the queued-turn grace and the Working shelf's exit grace depend
  // on the clock, so the minute tick, the precise snooze-wake tick and the inbox
  // tracker's expiry version are inputs: a new key repartitions.
  readonly clockKey: string;
}

function scrollSidebarToTop(content: HTMLElement | null) {
  content?.closest("[data-slot=scroll-area-viewport]")?.scrollTo({ top: 0 });
}

function threadShellKey(thread: Pick<SidebarThreadSummary, "environmentId" | "id">): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

const NO_DRAGGED_ORDER: readonly string[] = [];
const NO_DRAGGED_ORDERS: {
  readonly settledOrder: readonly string[];
  readonly activeOrder: readonly string[] | undefined;
} = { settledOrder: NO_DRAGGED_ORDER, activeOrder: undefined };

function resolveDraggedOrders(input: {
  readonly drag: { readonly activeKey: string; readonly occurredAt: string };
  readonly threadByKey: ReadonlyMap<string, EnvironmentThreadShell>;
  readonly settledThreads: readonly EnvironmentThreadShell[];
  readonly activeThreads: readonly EnvironmentThreadShell[];
  readonly workingShelfEnabled: boolean;
}): typeof NO_DRAGGED_ORDERS {
  const { drag, threadByKey, settledThreads, activeThreads, workingShelfEnabled } = input;
  const thread = threadByKey.get(drag.activeKey);
  if (thread === undefined) return NO_DRAGGED_ORDERS;
  const others = (list: readonly EnvironmentThreadShell[]) =>
    list.filter((candidate) => threadShellKey(candidate) !== drag.activeKey);
  return {
    settledOrder: sortSettledThreads([
      ...others(settledThreads),
      applySidebarThreadDrop(thread, "settled", drag.occurredAt),
    ]).map(threadShellKey),
    activeOrder: workingShelfEnabled
      ? sortInboxThreadsByReturn(
          [...others(activeThreads), applySidebarThreadDrop(thread, "active", drag.occurredAt)],
          inboxReturns.returnedAt,
        ).map(threadShellKey)
      : undefined,
  };
}

function routeThreadOnly(
  threads: readonly EnvironmentThreadShell[],
  routeThreadKey: string | null,
): readonly EnvironmentThreadShell[] {
  if (routeThreadKey === null) return EMPTY_THREADS;
  const routeThread = threads.find((thread) => threadShellKey(thread) === routeThreadKey);
  return routeThread === undefined ? EMPTY_THREADS : [routeThread];
}

// Separate hooks cache maps independently of later Sidebar hooks and preserve dnd-kit inputs.
function useSidebarThreads(input: {
  readonly projectScopeKey: string | null;
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly serverConfigs: ReadonlyMap<EnvironmentId, EnvironmentServerConfig>;
  readonly connectedEnvironmentIds: readonly EnvironmentId[];
  readonly optimisticDrop: SidebarOptimisticDrop | null;
  readonly threads: readonly EnvironmentThreadShell[];
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly routeRowThreadKey: string | null;
  readonly departingThreadKey: string | null;
  // Set in boring mode: the project groups to fold active threads into, in order.
  readonly folderGroups: readonly SidebarProjectSnapshot[] | null;
  // Keeps folders with no active threads, so a project the user filtered to or pinned can start one.
  readonly keepEmptyFolders: (group: SidebarProjectSnapshot) => boolean;
}) {
  const {
    projectScopeKey,
    scopedProjectKeys,
    serverConfigs,
    connectedEnvironmentIds,
    optimisticDrop,
    threads,
    delegatedUnderParent,
    routeRowThreadKey,
    departingThreadKey,
    folderGroups,
    keepEmptyFolders: keepEmpty,
  } = input;
  const shelfRouteThreadKey = routeRowThreadKey === departingThreadKey ? null : routeRowThreadKey;
  // Folders already separate the work, so boring mode has no Working shelf.
  const workingShelfEnabled =
    useClientSettings((s) => s.sidebarWorkingShelfEnabled) && folderGroups === null;
  const inboxReturnsVersion = useSyncExternalStore(
    inboxReturns.subscribe,
    inboxReturns.getSnapshot,
  );
  const nowMinute = useNowMinute();
  // Minute-quantized clocks would delay second-precise snooze wakes by up to a minute.
  const snoozeWakeClock = useSnoozeWakeClock(threads);
  const [settledShelfExpanded, setSettledShelfExpanded] = useLocalStorage(
    SETTLED_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const [snoozedShelfExpanded, setSnoozedShelfExpanded] = useLocalStorage(
    SNOOZED_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const [workingShelfExpanded, setWorkingShelfExpanded] = useLocalStorage(
    WORKING_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  // Shared with the old per-project sidebar, so folders keep their open state.
  const projectExpandedById = useUiStateStore((store) => store.projectExpandedById);
  const setProjectExpanded = useUiStateStore((store) => store.setProjectExpanded);
  const [settledTail, setSettledTail] = useState({
    scopeKey: projectScopeKey,
    count: SETTLED_TAIL_INITIAL_COUNT,
  });
  if (settledTail.scopeKey !== projectScopeKey) {
    setSettledTail({ scopeKey: projectScopeKey, count: SETTLED_TAIL_INITIAL_COUNT });
  }
  const settledVisibleCount =
    settledTail.scopeKey === projectScopeKey ? settledTail.count : SETTLED_TAIL_INITIAL_COUNT;

  const partition = partitionSidebarThreads({
    threads,
    scopedProjectKeys,
    delegatedUnderParent,
    serverConfigs,
    connectedEnvironmentIds,
    optimisticDrop,
    workingShelfEnabled,
    sortActiveBySend: folderGroups !== null,
    clockKey: `${nowMinute}:${snoozeWakeClock}:${inboxReturnsVersion}`,
  });

  const { pinnedThreads, activeThreads, workingThreads, snoozedThreads, settledThreads } =
    partition;
  // Older settled threads load in pages; the shelf lists them only as far as they are loaded.
  const olderSettledShelf = useOlderSettledShelf({
    scopes: olderSettledScopes([...serverConfigs.keys()], scopedProjectKeys),
    expanded: settledShelfExpanded,
    visibleCount: settledVisibleCount,
  });
  const listedSettledThreads = settledThreads.filter(olderSettledShelf.isListed);
  useOlderSettledShelfGrowth(olderSettledShelf, listedSettledThreads);
  const settledCount =
    settledThreads.length + olderSettledShelf.unloadedCount(partition.visibleThreads);
  const visibleSettledThreads = (() => {
    const visible = listedSettledThreads.slice(0, settledVisibleCount);
    if (
      shelfRouteThreadKey !== null &&
      !visible.some((thread) => threadShellKey(thread) === shelfRouteThreadKey)
    ) {
      const routeThread = settledThreads.find(
        (thread) => threadShellKey(thread) === shelfRouteThreadKey,
      );
      if (routeThread !== undefined) visible.push(routeThread);
    }
    return visible.length === settledThreads.length ? settledThreads : visible;
  })();
  const renderedSettledThreads = settledShelfExpanded
    ? visibleSettledThreads
    : routeThreadOnly(visibleSettledThreads, shelfRouteThreadKey);
  const visibleSnoozedThreads = snoozedShelfExpanded
    ? snoozedThreads
    : routeThreadOnly(snoozedThreads, shelfRouteThreadKey);
  const visibleWorkingThreads = workingShelfExpanded
    ? workingThreads
    : routeThreadOnly(workingThreads, routeRowThreadKey);
  const projectFolders =
    folderGroups === null
      ? null
      : groupSidebarThreadsByProject(folderGroups, activeThreads, keepEmpty).map((folder) => {
          const collapsed = !resolveProjectExpanded(
            projectExpandedById,
            sidebarFolderExpansionKeys(folder.group),
          );
          return {
            group: folder.group,
            collapsed,
            // A closed folder still shows the open thread, and hints at the rest.
            threads: collapsed
              ? routeThreadOnly(folder.threads, routeRowThreadKey)
              : folder.threads,
            hiddenThreads: collapsed
              ? folder.threads.filter((thread) => threadShellKey(thread) !== routeRowThreadKey)
              : EMPTY_THREADS,
          };
        });
  const orderedThreads = [
    ...pinnedThreads,
    ...(projectFolders === null
      ? activeThreads
      : projectFolders.flatMap((folder) => folder.threads)),
    ...visibleWorkingThreads,
    ...visibleSnoozedThreads,
    ...renderedSettledThreads,
  ];
  const sectionByThreadKey = new Map<string, SidebarSection>();
  for (const [list, section] of [
    [pinnedThreads, "pinned"],
    [activeThreads, "active"],
    [workingThreads, "working"],
    [snoozedThreads, "snoozed"],
    [settledThreads, "settled"],
  ] as const) {
    for (const thread of list) sectionByThreadKey.set(threadShellKey(thread), section);
  }
  return {
    ...partition,
    threads,
    workingShelfEnabled,
    searchableThreads: [
      ...pinnedThreads,
      ...activeThreads,
      ...workingThreads,
      ...snoozedThreads,
      ...settledThreads,
    ],
    settledVisibleCount,
    settledCount,
    olderSettledShelf,
    hiddenSettledCount: Math.max(0, settledCount - visibleSettledThreads.length),
    showMoreSettled: () =>
      setSettledTail((current) => ({
        scopeKey: current.scopeKey,
        count: current.count + SETTLED_TAIL_PAGE_COUNT,
      })),
    settledShelfExpanded,
    toggleSettledShelf: () => setSettledShelfExpanded((value) => !value),
    snoozedShelfExpanded,
    toggleSnoozedShelf: () => setSnoozedShelfExpanded((value) => !value),
    workingShelfExpanded,
    toggleWorkingShelf: () => setWorkingShelfExpanded((value) => !value),
    projectFolders,
    toggleProjectFolder: (group: SidebarProjectSnapshot) => {
      const keys = sidebarFolderExpansionKeys(group);
      setProjectExpanded(keys, !resolveProjectExpanded(projectExpandedById, keys));
    },
    renderedSettledThreads,
    visibleSnoozedThreads,
    visibleWorkingThreads,
    orderedThreadKeys: orderedThreads.map(threadShellKey),
    threadByKey: new Map(orderedThreads.map((thread) => [threadShellKey(thread), thread] as const)),
    settledThreadKeys: new Set(settledThreads.map(threadShellKey)),
    snoozedThreadKeys: new Set(snoozedThreads.map(threadShellKey)),
    sectionByThreadKey,
    pinnedKeys: pinnedThreads.map(threadShellKey),
    activeKeys: activeThreads.map(threadShellKey),
    pinnedKeysById: new Map(
      threads.map((thread) => [threadShellKey(thread), thread.pinOrderKey ?? null] as const),
    ),
    activeKeysById: new Map(
      threads.map((thread) => [threadShellKey(thread), thread.activeOrderKey ?? null] as const),
    ),
  };
}

function partitionSidebarThreads(input: SidebarThreadPartitionInput) {
  const {
    threads,
    scopedProjectKeys,
    delegatedUnderParent,
    serverConfigs,
    optimisticDrop,
    workingShelfEnabled,
    sortActiveBySend,
  } = input;
  const preciseNow = new Date().toISOString();
  const visible = filterSidebarV2VisibleThreads(threads, scopedProjectKeys, delegatedUnderParent);
  const inboxObservation = inboxReturns.observe(workingShelfEnabled ? threads : null);
  const pinned: EnvironmentThreadShell[] = [];
  const active: EnvironmentThreadShell[] = [];
  const working: EnvironmentThreadShell[] = [];
  const inbox = (thread: EnvironmentThreadShell, manuallyMoved = false) =>
    workingShelfEnabled &&
    (manuallyMoved ? isThreadWorking(thread) : inboxObservation.isWorking(thread))
      ? working
      : active;
  const snoozed: EnvironmentThreadShell[] = [];
  const settled: EnvironmentThreadShell[] = [];
  const { draggableThreadKeys, activeReorderableThreadKeys } = resolveSidebarReorderableThreadKeys({
    threads: visible,
    serverConfigs,
    connectedEnvironmentIds: input.connectedEnvironmentIds,
  });
  for (const thread of visible) {
    const configLoaded = serverConfigs.has(thread.environmentId);
    const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    if (optimisticDrop?.key === threadKey) {
      const projected = applySidebarThreadDrop(
        thread,
        optimisticDrop.section,
        optimisticDrop.occurredAt,
        optimisticDrop.assignedKeys.get(threadKey),
      );
      (optimisticDrop.section === "pinned"
        ? pinned
        : optimisticDrop.section === "settled"
          ? settled
          : inbox(projected, true)
      ).push(
        optimisticDrop.clearsSnooze
          ? projected
          : { ...projected, snoozedAt: thread.snoozedAt, snoozedUntil: thread.snoozedUntil },
      );
    } else {
      const section = resolveSidebarThreadSection({
        snoozed: configLoaded && effectiveSnoozed(thread, { now: preciseNow }),
        settled: configLoaded && thread.settledOverride === "settled",
        pinned: thread.pinnedAt != null,
      });
      (section === "snoozed"
        ? snoozed
        : section === "settled"
          ? settled
          : section === "pinned"
            ? pinned
            : inbox(thread)
      ).push(thread);
    }
  }
  // Availability gates dragging only; sorting must stay consistent across clients.
  const sortedPinned = sortPinnedThreadsForSidebar(pinned);
  const sortedActive = sortActiveBySend
    ? sortWorkingThreadsBySend(active)
    : workingShelfEnabled
      ? sortInboxThreadsByReturn(active, inboxObservation.returnedAt)
      : sortThreadsForSidebar(active);
  return {
    pinnedThreads:
      optimisticDrop?.section !== "pinned" || optimisticDrop.order === null
        ? sortedPinned
        : orderItemsByPreferredIds({
            items: sortedPinned,
            preferredIds: optimisticDrop.order,
            getId: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          }),
    draggableThreadKeys,
    activeReorderableThreadKeys,
    activeThreads:
      optimisticDrop?.section !== "active" || optimisticDrop.order === null
        ? sortedActive
        : orderItemsByPreferredIds({
            items: sortedActive,
            preferredIds: optimisticDrop.order,
            getId: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          }),
    workingThreads: sortWorkingThreadsBySend(working),
    snoozedThreads: snoozed.toSorted(
      (left, right) =>
        firstValidTimestampMs(left.snoozedUntil ?? null) -
        firstValidTimestampMs(right.snoozedUntil ?? null),
    ),
    settledThreads: sortSettledThreads(settled),
    visibleThreads: visible,
    snoozeNow: preciseNow,
  };
}

/** The sidebar's scope per environment: the scoped projects there, or every project. */
function olderSettledScopes(
  environmentIds: ReadonlyArray<EnvironmentId>,
  scopedProjectKeys: ReadonlySet<string> | null,
): ReadonlyArray<OlderSettledScope> {
  if (scopedProjectKeys === null) {
    return environmentIds.map((environmentId) => ({ environmentId, projectIds: null }));
  }
  return environmentIds.flatMap((environmentId) => {
    const prefix = `${environmentId}:`;
    const projectIds = [...scopedProjectKeys].flatMap((key) =>
      key.startsWith(prefix) ? [ProjectId.make(key.slice(prefix.length))] : [],
    );
    return projectIds.length === 0 ? [] : [{ environmentId, projectIds }];
  });
}

function isOptimisticDropReleased(input: {
  readonly optimisticDrop: SidebarOptimisticDrop;
  readonly threads: readonly EnvironmentThreadShell[];
  readonly pinnedKeys: readonly string[];
  readonly activeKeys: readonly string[];
  readonly now: string;
}): boolean {
  const { optimisticDrop, threads, pinnedKeys, activeKeys, now } = input;
  const canonicalByKey = new Map(
    threads.map((thread) => [
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      thread,
    ]),
  );
  const thread = canonicalByKey.get(optimisticDrop.key);
  if (thread === undefined || thread.archivedAt !== null) {
    return true;
  }
  const canonicalSection = effectiveSnoozed(thread, { now })
    ? "snoozed"
    : thread.settledOverride === "settled"
      ? "settled"
      : thread.pinnedAt != null
        ? "pinned"
        : "active";
  if (
    canonicalSection !== optimisticDrop.sourceSection &&
    canonicalSection !== optimisticDrop.section
  ) {
    return true;
  }
  if (optimisticDrop.order === null) {
    // Settle emits unpin/unsnooze too; hold projected fields and sort times until the whole move completes.
    if (
      canonicalSection === optimisticDrop.section &&
      thread.pinnedAt == null &&
      (!optimisticDrop.clearsSnooze || thread.snoozedUntil == null)
    ) {
      return true;
    }
    return false;
  }
  if (canonicalSection !== optimisticDrop.section) return false;
  if (optimisticDrop.clearsSnooze && thread.snoozedUntil != null) return false;
  const destinationKeys = optimisticDrop.section === "pinned" ? pinnedKeys : activeKeys;
  const canonicalDestination = destinationKeys.flatMap((key) => {
    const canonical = canonicalByKey.get(key);
    return canonical === undefined ? [] : [canonical];
  });
  const keyByThread = new Map(
    canonicalDestination.map((thread) => [
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      (optimisticDrop.section === "pinned" ? thread.pinOrderKey : thread.activeOrderKey) ?? null,
    ]),
  );
  const heldOrder = optimisticDrop.order;
  const heldKeys = new Set(heldOrder);
  const membershipChanged =
    destinationKeys.length !== heldOrder.length ||
    destinationKeys.some((key) => !heldKeys.has(key));
  const foreignKeyLanded = destinationKeys.some((threadKey) => {
    const currentKey = keyByThread.get(threadKey) ?? null;
    if (currentKey === (optimisticDrop.keysAtDrop.get(threadKey) ?? null)) return false;
    return currentKey !== optimisticDrop.assignedKeys.get(threadKey);
  });
  const allAssignmentsLanded = [...optimisticDrop.assignedKeys].every(
    ([threadKey, orderKey]) => keyByThread.get(threadKey) === orderKey,
  );
  return membershipChanged || foreignKeyLanded || allAssignmentsLanded;
}

// Build maps in a hook so the compiler can prove they are frozen and cache them.
function useSidebarLookups() {
  const projects = useProjects();
  const environments = useEnvironmentIdentities();
  const serverConfigs = useServerConfigs();
  const providerEntriesByEnvironment = useAtomValue(sidebarProviderEntriesAtom);
  const projectGroups = useSidebarProjectGroups();
  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  const projectByKey = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
  );
  const projectDisplayNameByKey = new Map(
    projectGroups.flatMap((group) =>
      group.memberProjects.map(
        (project) => [`${project.environmentId}:${project.id}`, group.displayName] as const,
      ),
    ),
  );
  return {
    projects,
    serverConfigs,
    projectGroups,
    environmentLabelById,
    providerEntriesByEnvironment,
    projectByKey,
    projectDisplayNameByKey,
  };
}

function canOperateThreads(
  threads: ReadonlyArray<Pick<SidebarThreadSummary, "environmentId">>,
): boolean {
  return threads.every((thread) =>
    readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope),
  );
}

function checkThreadOperations(
  threads: ReadonlyArray<Pick<SidebarThreadSummary, "environmentId">>,
): boolean {
  if (canOperateThreads(threads)) return true;
  toastManager.add({
    type: "error",
    title: m(msg("Thread action unavailable")),
    description: m(msg("This connection cannot change one or more selected threads.")),
  });
  return false;
}

const SIDEBAR_DRAG_DISTANCE = 6;

// dnd-kit's 20% edge zone at full speed runs the list away while the pointer rests near the bottom.
const SIDEBAR_AUTO_SCROLL: AutoScrollOptions = { threshold: { x: 0, y: 0.05 }, acceleration: 3 };

const SIDEBAR_DRAG_LABEL_HEIGHT = 24;

// Continuations that outlive a render read the open thread from the router.
function readRouteThreadKey(router: AnyRouter): string | null {
  const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const draft =
    target?.kind === "draft"
      ? useComposerDraftStore.getState().getDraftSession(target.draftId)
      : null;
  const ref = resolveActiveThreadRouteRef(target, draft);
  return ref === null ? null : scopedThreadKey(ref);
}

export default function Sidebar({ routeReveal }: { routeReveal: SidebarRouteReveal }) {
  const gt = useGT();
  const messages = useMessages();
  const orcaCopy = useOrcaProjectsCopy();
  const {
    projects,
    serverConfigs,
    projectGroups,
    environmentLabelById,
    providerEntriesByEnvironment,
    projectByKey,
    projectDisplayNameByKey,
  } = useSidebarLookups();
  const { environments: environmentPresentationsList } = useEnvironments();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const startProjectClone = useAtomCommand(sourceControlEnvironment.startProjectClone, {
    reportFailure: false,
  });
  const createThreadCommand = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const visitThreadCommand = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  const createNewProject = useNewProject();
  const { openScratchProject } = useScratchProject();
  const delegatedUnderParent = useDelegatedUnderParent();
  const router = useRouter();
  const { isMobile, setOpen, setOpenMobile, isIconRail, isTextHidden } = useSidebar();
  const railCompact = !isMobile && isIconRail;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const confirmThreadDelete = useClientSettings((s) => s.confirmThreadDelete);
  const confirmThreadArchive = useClientSettings((s) => s.confirmThreadArchive);
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const {
    settleThread,
    unsettleThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    unpinThread,
    confirmAndUnpinThread,
    setThreadAutoSettle,
    turnThreadIntoProject,
    reorderPinnedThread,
    reorderActiveThread,
    markThreadUnread,
    archiveThread,
    deleteThread,
  } = useThreadActions();
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const regenerateThreadTitle = useOrchestrationCommand(threadEnvironment.regenerateTitle, {
    reportFailure: false,
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Failed to copy path"),
          description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
        }),
      );
    },
  });
  const { copyToClipboard: copyBranchToClipboard } = useCopyToClipboard<{ branch: string }>({
    target: {
      target: "branch name",
      unavailableMessage: msg("Clipboard API is unavailable while copying branch name."),
      failureMessage: msg("Failed to copy branch name to the clipboard."),
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Failed to copy branch"),
          description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
        }),
      );
    },
  });
  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{ threadId: ThreadId }>({
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Failed to copy thread ID"),
          description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
        }),
      );
    },
  });
  const boringSidebarEnabled = useClientSettings((settings) => settings.boringSidebarEnabled);
  const useOrcaCompactTree = !boringSidebarEnabled;
  const folderRowsMultiline = useClientSettings((settings) => settings.boringSidebarMultilineRows);
  const [collapsedHostEnvIds, setCollapsedHostEnvIds] = useState<ReadonlySet<EnvironmentId>>(
    () => new Set(),
  );
  const toggleHostGroupCollapsed = (environmentId: EnvironmentId) => {
    setCollapsedHostEnvIds((prev) => {
      const next = new Set(prev);
      if (next.has(environmentId)) {
        next.delete(environmentId);
      } else {
        next.add(environmentId);
      }
      return next;
    });
  };
  const newThreadContext = useHandleNewThread();
  // Row callbacks capture only the handler; the rest of the context changes with the route.
  const { handleNewThread } = newThreadContext;
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const acknowledgeWoke = useAcknowledgeThreadWoke();
  // A Settings or Usage modal keeps the thread behind it current.
  const routeTarget = useShownThreadRouteTarget().shownTarget;
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const routeDraftRedirect = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getPromotedDraftRedirect(routeTarget.draftId) : null,
  );
  const environmentMachineById = useEnvironmentMachines();
  const projectGroupsRef = useRef(projectGroups);
  const persistedProjectScopeKeys = useUiStateStore((store) => store.sidebarProjectScopeKeys);
  const setPersistedProjectScopeKeys = useUiStateStore((store) => store.setSidebarProjectScopeKeys);
  const allProjectSnapshotsReady = useAllEnvironmentProjectSnapshotsReady();
  const allProjectConfigsReady = useAtomValue(environmentProjects.projectConfigsReadyAtom);
  // Hold dropped rows until server placement is confirmed; block another pickup from replacing the hold.
  const [optimisticDrop, setOptimisticDrop] = useState<SidebarOptimisticDrop | null>(null);
  const activitySearchInputRef = useRef<HTMLInputElement>(null);
  const [activitySearchQuery, setActivitySearchQuery] = useState("");
  const localLastVisitedAtById = useUiStateStore((store) => store.threadLastVisitedAtById);
  const markThreadVisitedLocal = useUiStateStore((store) => store.markThreadVisited);
  const setProjectExpanded = useUiStateStore((store) => store.setProjectExpanded);
  const [projectsSectionOpen, setProjectsSectionOpen] = useState<boolean>(() =>
    readSidebarProjectsSectionOpen(),
  );
  const [orcaPrefs, setOrcaPrefs] = useState<OrcaProjectsPrefs>(() => readOrcaProjectsPrefs());
  const [activityViewActive, setActivityViewActive] = useState(false);
  const [selectedAddProjectEnvId, setSelectedAddProjectEnvId] = useState<EnvironmentId | null>(null);
  const [cloneDialogEnvId, setCloneDialogEnvId] = useState<EnvironmentId | null>(null);
  const [createProjectDialogEnvId, setCreateProjectDialogEnvId] = useState<EnvironmentId | null>(null);
  const [browseFolderDialogEnvId, setBrowseFolderDialogEnvId] = useState<EnvironmentId | null>(null);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const queuePendingFileDrop = useSidebarPendingFileDropStore((s) => s.queuePendingFileDrop);
  const clearPendingFileDrop = useSidebarPendingFileDropStore((s) => s.clearPendingFileDrop);
  const [renamingThreadRef, setRenamingThreadRef] = useState<ScopedThreadRef | null>(null);
  const canOperateRenamingThread = useEnvironmentScope(
    renamingThreadRef?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  // Losing operate access cancels the rename without committing the title, so
  // the editor does not return and take focus when access comes back.
  if (renamingThreadRef !== null && !canOperateRenamingThread) setRenamingThreadRef(null);
  const renamingThreadKey =
    renamingThreadRef !== null && canOperateRenamingThread
      ? scopedThreadKey(renamingThreadRef)
      : null;
  const [renamingTitle, setRenamingTitle] = useState("");
  const renamingOriginalTitleRef = useRef("");
  const settlingThreadKeysRef = useRef(new Set<string>());
  const threadListRef = useRef<HTMLUListElement | null>(null);
  const sidebarContentRef = useRef<HTMLDivElement | null>(null);
  const dragLabelOffsetRef = useRef(0);
  const listMotionRef = useRef<ReturnType<typeof createSidebarListMotion> | null>(null);
  const shiftGuardRef = useRef<ReturnType<typeof createSidebarShiftGuard> | null>(null);
  const [dragState, setDragState] = useState<{
    readonly activeKey: string;
    readonly activeSection: SidebarSection;
    readonly occurredAt: string;
    readonly activationY: number | null;
    readonly targetSection: SidebarSection | null;
    readonly contextDrag: boolean;
  } | null>(null);
  const dragSensorRef = useRef<SidebarPointerSensor | null>(null);
  const contextDragKeyRef = useRef<string | null>(null);
  const dragScrollRef = useRef<{ readonly viewport: Element; readonly top: number } | null>(null);
  const [actionSweep, setActionSweep] = useState<{
    action: SidebarSweepAction;
    keys: ReadonlySet<string>;
  } | null>(null);
  const snoozingThreadKeysRef = useRef(new Set<string>());
  const removeFromSelection = useThreadSelectionStore((s) => s.removeFromSelection);
  const routeThreadRef = resolveActiveThreadRouteRef(
    routeTarget,
    routeDraftThread,
    routeDraftRedirect,
  );
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;

  // A selection made under one scope can hold threads the next scope hides.
  // The viewport outlives the scope and does not anchor, so a new list starts at the top.
  const setProjectScopeKeys = (keys: readonly string[]) => {
    clearSelection();
    setPersistedProjectScopeKeys(keys);
    scrollSidebarToTop(sidebarContentRef.current);
  };
  // A scope whose project is gone reads as all projects once every snapshot has
  // loaded. The stored keys are left alone, so the scope returns with its project.
  // An archived project's scope reads as all projects, matching the menu.
  const scopeGroups = pickableProjectGroups(projectGroups);
  const archivedProjectKeys = new Set(
    projectGroups.filter((project) => project.archived).map((project) => project.projectKey),
  );
  const chosenProjectScopeKeys = resolveSidebarProjectScopeKeys({
    groups: projectGroups,
    keys: persistedProjectScopeKeys,
    settings: projectGroupingSettings,
    canClearMissingScope: allProjectSnapshotsReady && allProjectConfigsReady,
  }).filter((key) => !archivedProjectKeys.has(key));
  const chosenProjectGroups = scopeGroups.filter((project) =>
    chosenProjectScopeKeys.includes(project.projectKey),
  );
  const chosenScopeProjectKeys =
    chosenProjectGroups.length === 0
      ? null
      : new Set(
          chosenProjectGroups.flatMap((project) =>
            project.memberProjectRefs.map(
              (projectRef) => `${projectRef.environmentId}:${projectRef.projectId}`,
            ),
          ),
        );
  const threads = useQuietThreadShells();
  const promotingDraftThreadKeys = usePromotingDraftThreadKeys();
  const listedThreads =
    promotingDraftThreadKeys.length === 0
      ? threads
      : threads.map((thread) =>
          promotingDraftThreadKeys.includes(threadShellKey(thread))
            ? asLaunchingThread(thread)
            : thread,
        );
  const filteredProjectThreads = filterSidebarProjectThreads(
    listedThreads,
    orcaPrefs,
    localLastVisitedAtById,
  );
  const routeRowThreadKey =
    routeThreadRef === null
      ? null
      : scopedThreadKey(resolveListedAncestorThreadRef(routeThreadRef, threads));
  // The open draft's first send names its thread in place; a finalized draft reached by
  // navigation resolves through its redirect instead, and still reveals.
  const routeKeyInPlace = routeDraftThread?.promotedTo != null;

  // History, the palette and links can open a thread the scope hides or the list
  // scrolled away; a remount starts at the top, so each mount scrolls to the open
  // thread once. Render decides the widening, so the first frame of the new route
  // already lists the row; the active row's ref callback scrolls to it.
  const { widensScope: revealWidensScope } = resolveSidebarRouteReveal({
    reveal: routeReveal,
    routeKey: routeRowThreadKey,
    routeKeyInPlace,
    isSearching: false,
    scopedProjectKeys: chosenScopeProjectKeys,
    delegatedUnderParent,
    findThread: (key) => threads.find((candidate) => threadShellKey(candidate) === key),
  });
  const projectScopeKeys = revealWidensScope ? [] : chosenProjectScopeKeys;
  const projectScopeKey = projectScopeKeys.length === 0 ? null : projectScopeKeys.join("\n");
  // The widened scope outlives the reveal, so it is written back to the persisted
  // scope. Route changes arrive from history, links and the palette, and only this
  // component holds the project groups that decide a widening, so no single
  // navigation handler can make the write.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes a route reveal's widened project scope back to the persisted sidebar scope and clears selection
  useEffect(() => {
    if (!revealWidensScope) return;
    clearSelection();
    setPersistedProjectScopeKeys([]);
  }, [clearSelection, revealWidensScope, setPersistedProjectScopeKeys]);
  const revealActiveRow = useActiveRowReveal(routeReveal, routeRowThreadKey, routeKeyInPlace);
  const [departingThreadKey, setDepartingThreadKey] = useState<string | null>(null);
  if (departingThreadKey !== null && departingThreadKey !== routeThreadKey) {
    setDepartingThreadKey(null);
  }
  const departRouteThread = (threadKey: string) => setDepartingThreadKey(threadKey);
  const stayOnRouteThread = (threadKey: string) =>
    setDepartingThreadKey((current) => (current === threadKey ? null : current));
  const scopedProjectGroups = revealWidensScope ? [] : chosenProjectGroups;
  const scopedProjectKeys = revealWidensScope ? null : chosenScopeProjectKeys;
  const routeDraftIdForRows = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const draftTerminalLabels = useDraftTerminalLabels();
  const visibleDraftSessionCount = useComposerDraftStore((store) => {
    let count = 0;
    for (const [draftKey, session] of Object.entries(store.draftThreadsByThreadKey)) {
      if (session.promotedTo != null) {
        continue;
      }
      if (
        draftTerminalLabel(session, draftTerminalLabels) === null &&
        !composerDraftHasUserContent(store.draftsByThreadKey[draftKey])
      ) {
        continue;
      }
      if (
        scopedProjectKeys !== null &&
        !scopedProjectKeys.has(`${session.environmentId}:${session.projectId}`)
      ) {
        continue;
      }
      count += 1;
    }
    return count;
  });

  const openProjectSettings = useStableCallback(
    (projectGroup: SidebarProjectSnapshot, projectRef?: ScopedProjectRef) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/projects/$projectKey",
        params: {
          projectKey: getSidebarProjectSettingsKey(
            projectGroup,
            projectGroupingSettings,
            projects,
            projectRef,
          ),
        },
      });
    },
  );
  const {
    canPinProjectGroup: canPinProject,
    setProjectGroupPinned,
  } = useProjectPin();
  const startThreadInProjectFolder = useStableCallback((group: SidebarProjectSnapshot) => {
    if (isMobile) setOpenMobile(false);
    void handleNewThread(scopeProjectRef(group.environmentId, group.id));
  });
  const handleProjectFolderContextMenu = useStableCallback(
    (
      group: SidebarProjectSnapshot,
      position: { x: number; y: number },
      source: ContextMenuSource,
    ) => {
      const api = readLocalApi();
      if (!api) return;
      void (async () => {
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            [
              { id: "new-thread", label: gt("New thread") },
              { id: "copy-path", label: gt("Copy path") },
              ...(canPinProject(group)
                ? [
                    group.pinned
                      ? { id: "unpin", label: gt("Unpin project"), icon: "pin-off" }
                      : { id: "pin", label: gt("Pin project"), icon: "pin" },
                  ]
                : []),
              { id: "project-settings", label: gt("Project settings"), icon: "settings" },
            ],
            position,
            source,
          ),
        );
        if (clicked._tag === "Failure") return;
        switch (clicked.value) {
          case "new-thread":
            startThreadInProjectFolder(group);
            return;
          case "copy-path":
            copyPathToClipboard(group.workspaceRoot, { path: group.workspaceRoot });
            return;
          case "pin":
          case "unpin":
            setProjectGroupPinned(group, clicked.value === "pin");
            return;
          case "project-settings":
            openProjectSettings(group);
            return;
        }
      })();
    },
  );

  const {
    workingShelfEnabled,
    pinnedThreads,
    draggableThreadKeys,
    activeReorderableThreadKeys,
    activeThreads,
    workingThreads,
    snoozedThreads,
    settledThreads,
    snoozeNow,
    searchableThreads,
    settledVisibleCount,
    settledCount,
    olderSettledShelf,
    hiddenSettledCount,
    showMoreSettled,
    settledShelfExpanded,
    toggleSettledShelf,
    snoozedShelfExpanded,
    toggleSnoozedShelf,
    workingShelfExpanded,
    toggleWorkingShelf,
    projectFolders,
    toggleProjectFolder,
    renderedSettledThreads,
    visibleSnoozedThreads,
    visibleWorkingThreads,
    orderedThreadKeys,
    threadByKey,
    settledThreadKeys,
    snoozedThreadKeys,
    sectionByThreadKey,
    pinnedKeys,
    activeKeys,
    pinnedKeysById,
    activeKeysById,
  } = useSidebarThreads({
    projectScopeKey,
    scopedProjectKeys,
    serverConfigs,
    connectedEnvironmentIds,
    optimisticDrop,
    threads: filteredProjectThreads,
    delegatedUnderParent,
    routeRowThreadKey,
    departingThreadKey,
    folderGroups:
      scopedProjectGroups.length === 0
        ? // An archived project keeps a folder for its active threads, below the rest.
          [...scopeGroups, ...projectGroups.filter((project) => project.archived)]
        : scopedProjectGroups,
    keepEmptyFolders: (group) =>
      scopedProjectGroups.length > 0 ||
      (group.pinned && !group.archived) ||
      (useOrcaCompactTree && !group.archived && !group.isScratch),
  });

  const orderedThreadKeysRef = useRef(orderedThreadKeys);
  // Read changing maps/sets through refs so streamed events preserve row callbacks.
  const threadByKeyRef = useRef(threadByKey);
  const settledThreadKeysRef = useRef(settledThreadKeys);
  const snoozedThreadKeysRef = useRef(snoozedThreadKeys);

  const { draftIds, routeDraftComposer } = useSidebarDrafts(
    scopedProjectKeys,
    routeDraftIdForRows,
    draftTerminalLabels,
  );
  // Draft rows sit above the threads, so jumps and traversal reach them first.
  const listedDraftIds = draftIds;
  const draftIdByRowKey = new Map<string, DraftId>(listedDraftIds.map((id) => [`draft:${id}`, id]));
  const orderedRowKeys = [...draftIdByRowKey.keys(), ...orderedThreadKeys];
  const routeDraftRowKey = `draft:${routeDraftIdForRows}`;
  const routeRowKey = draftIdByRowKey.has(routeDraftRowKey) ? routeDraftRowKey : routeRowThreadKey;

  const jumpLabelByKey = (() => {
    const mapping = new Map<string, string>();
    for (const [index, rowKey] of orderedRowKeys.entries()) {
      const jumpCommand = threadJumpCommandForIndex(index);
      if (!jumpCommand) break;
      const label = shortcutLabelForCommand(keybindings, jumpCommand);
      if (label) mapping.set(rowKey, label);
    }
    return mapping;
  })();

  const navigateToThread = (threadRef: ScopedThreadRef) => {
    if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
      clearSelection();
    }
    setSelectionAnchor(scopedThreadKey(threadRef));
    if (isMobile) {
      setOpenMobile(false);
    }
    return router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
    });
  };

  const handleThreadFileDrop = async (threadRef: ScopedThreadRef, files: File[]) => {
    const dropId = queuePendingFileDrop({ threadRef, files });
    const landedBefore =
      router.buildLocation({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      }).pathname === router.state.location.pathname;
    if (landedBefore) return;

    try {
      await navigateToThread(threadRef);
      const landed =
        router.buildLocation({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(threadRef),
        }).pathname === router.state.location.pathname;
      if (!landed) clearPendingFileDrop(dropId);
    } catch {
      clearPendingFileDrop(dropId);
    }
  };

  const navigateToDraft = (draftId: DraftId) => {
    clearSelection();
    if (isMobile) {
      setOpenMobile(false);
    }
    void router.navigate({ to: "/draft/$draftId", params: { draftId } });
  };

  // The ref write stops the compiler memoizing this, and every row receives it.
  const startThreadRename = useStableCallback((threadRef: ScopedThreadRef, title: string) => {
    if (!readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)) return;
    setRenamingThreadRef(threadRef);
    setRenamingTitle(title);
    renamingOriginalTitleRef.current = title;
  });
  const cancelThreadRename = () => setRenamingThreadRef(null);
  const commitThreadRename = (threadRef: ScopedThreadRef, title: string) => {
    const originalTitle = renamingOriginalTitleRef.current;
    void (async () => {
      if (!readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)) return;
      const trimmed = title.trim();
      setRenamingThreadRef(null);
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: gt("Thread title cannot be empty") });
        return;
      }
      if (trimmed === originalTitle) return;
      const result = await updateThreadMetadata({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, title: trimmed },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Failed to rename thread"),
            description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
          }),
        );
      }
    })();
  };

  const readOpensPullRequestsInRightPanel = useStableCallback(() => routeThreadRef !== null);
  const handleThreadClick = (event: ReactMouseEvent, threadRef: ScopedThreadRef) => {
    if (isSidebarNestedLinkClick(event.target)) return;
    const isMac = isMacPlatform(navigator.platform);
    const isModClick = isMac ? event.metaKey : event.ctrlKey;
    const threadKey = scopedThreadKey(threadRef);
    if (isModClick) {
      event.preventDefault();
      toggleThreadSelection(threadKey);
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      rangeSelectTo(threadKey, orderedThreadKeysRef.current);
      return;
    }
    if (isTrailingDoubleClick(event.detail)) {
      return;
    }
    navigateToThread(threadRef);
  };

  // Snapshot navigation before partition mutation; background parks use a null plan.
  const planForwardNavigation = (
    threadKey: string,
    coParkingKeys?: ReadonlySet<string>,
  ): (() => void) | null => {
    if (readRouteThreadKey(router) !== threadKey) return null;
    const shell = threadByKeyRef.current.get(threadKey);
    const orderedKeys = orderedThreadKeysRef.current;
    const settledKeys = settledThreadKeysRef.current;
    const snoozedKeys = snoozedThreadKeysRef.current;
    const currentIndex = orderedKeys.indexOf(threadKey);
    const nextCardKey =
      currentIndex === -1
        ? null
        : ([...orderedKeys.slice(currentIndex + 1), ...orderedKeys.slice(0, currentIndex)].find(
            (key) => !settledKeys.has(key) && !snoozedKeys.has(key) && !coParkingKeys?.has(key),
          ) ?? null);
    const nextThread = nextCardKey ? threadByKeyRef.current.get(nextCardKey) : null;
    return nextThread
      ? () => navigateToThread(scopeThreadRef(nextThread.environmentId, nextThread.id))
      : shell
        ? () => void handleNewThread(scopeProjectRef(shell.environmentId, shell.projectId))
        : () => void router.navigate({ to: "/" });
  };

  const attemptSettle = (
    threadRef: ScopedThreadRef,
    opts: { coSettlingKeys?: ReadonlySet<string> } = {},
  ) => {
    void (async () => {
      const threadKey = scopedThreadKey(threadRef);
      if (settlingThreadKeysRef.current.has(threadKey)) return;
      settlingThreadKeysRef.current.add(threadKey);
      const navigateAfterSettle = planForwardNavigation(threadKey, opts.coSettlingKeys);
      if (navigateAfterSettle) departRouteThread(threadKey);
      const result = await settleThread(threadRef);
      settlingThreadKeysRef.current.delete(threadKey);
      if (result._tag === "Failure") {
        stayOnRouteThread(threadKey);
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: gt("Failed to settle thread"),
              description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
            }),
          );
        }
        return;
      }
      if (
        shouldNavigateAfterThreadPark({
          threadKey,
          currentThreadKey: readRouteThreadKey(router),
          action: "settle",
          now: new Date().toISOString(),
          thread: readThreadShell(threadRef),
        })
      ) {
        navigateAfterSettle?.();
      } else {
        stayOnRouteThread(threadKey);
      }
    })();
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this sidebar's settle handler in the module-level settleAndAdvance registry
  useEffect(() => registerSettleAndAdvance(attemptSettle), [attemptSettle]);
  const settleThreads = (threadKeys: readonly string[]) => {
    const coSettlingKeys = new Set(threadKeys);
    for (const threadKey of threadKeys) {
      const thread = threadByKeyRef.current.get(threadKey);
      if (!thread || thread.settledOverride === "settled") continue;
      attemptSettle(scopeThreadRef(thread.environmentId, thread.id), { coSettlingKeys });
    }
  };
  const attemptUnsettle = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await unsettleThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Failed to un-settle thread"),
            description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
          }),
        );
      }
    })();
  };
  const attemptUnsnooze = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await unsnoozeThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Failed to wake thread"),
            description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
          }),
        );
      }
    })();
  };
  const restrictBelowPins: Modifier = (args) =>
    restrictBelowSidebarLabel(args, dragLabelOffsetRef.current);
  const dndModifiers = [
    restrictToVerticalAxis,
    restrictBelowPins,
    restrictToFirstScrollableAncestor,
  ];
  const attachListMotionRef = (node: HTMLUListElement) => {
    threadListRef.current = node;
    const motion = createSidebarListMotion(node);
    listMotionRef.current = motion;
    motion.update(false);
    const shiftGuard = createSidebarShiftGuard(node);
    shiftGuardRef.current = shiftGuard;
    return () => {
      // Search replaces this list while the Sidebar stays mounted, and a drag
      // whose rows are gone can never drop. The compiler memoizes this callback
      // with no deps (it reads only refs), so the cleanup runs only on unmount.
      dragSensorRef.current?.cancel();
      motion.dispose();
      shiftGuard.dispose();
      if (listMotionRef.current === motion) listMotionRef.current = null;
      if (shiftGuardRef.current === shiftGuard) shiftGuardRef.current = null;
      if (threadListRef.current === node) threadListRef.current = null;
    };
  };

  const attachTreeRef = (node: HTMLUListElement) => {
    const detachMotion = attachListMotionRef(node);
    const detachTree = attachSidebarTree(node);
    return () => {
      detachTree?.();
      detachMotion();
    };
  };

  // Folder rows only drag out to the composer; folders own their order, so nothing drops in the list.
  const isContextDrag =
    projectFolders !== null ||
    dragState?.contextDrag === true ||
    dragState?.activeSection === "working";
  const dragTargetSection = isContextDrag ? null : (dragState?.targetSection ?? null);
  const finishThreadDrag = (started: boolean) => {
    dragSensorRef.current = null;
    contextDragKeyRef.current = null;
    dragScrollRef.current = null;
    endThreadContextDrag();
    if (started) {
      listMotionRef.current?.release();
      setDragState(null);
    }
  };
  const attachDragSensor = (sensor: SidebarPointerSensor) => {
    dragSensorRef.current = sensor;
  };
  const cancelThreadDrag = () => {
    dragSensorRef.current?.cancel();
  };
  const contextDragThreads = (): ReadonlyArray<ScopedThreadRef> => {
    const key = contextDragKeyRef.current;
    if (key === null) return [];
    const selected = useThreadSelectionStore.getState().selectedThreadKeys;
    const keys = selected.has(key) ? [...selected] : [key];
    return keys.flatMap((candidate) => {
      const ref = parseScopedThreadKey(candidate);
      return ref ? [ref] : [];
    });
  };
  const pointerOutsideThreadList = (point: { x: number; y: number }) => {
    const bounds = threadListRef.current?.getBoundingClientRect();
    return bounds !== undefined && (point.x < bounds.left || point.x > bounds.right);
  };
  // The path out of the list often crosses dnd-kit's edge zone, which autoscrolls the sidebar.
  const restoreDragScroll = () => {
    const scroll = dragScrollRef.current;
    if (scroll && scroll.viewport.scrollTop !== scroll.top) scroll.viewport.scrollTop = scroll.top;
  };
  const moveThreadContextDrag = (point: { x: number; y: number }) => {
    const contextDrag = pointerOutsideThreadList(point);
    setDragState((current) =>
      current === null || current.contextDrag === contextDrag
        ? current
        : { ...current, contextDrag },
    );
    if (!contextDrag) {
      endThreadContextDrag();
      return false;
    }
    restoreDragScroll();
    const threads = contextDragThreads();
    const threadRef = parseScopedThreadKey(contextDragKeyRef.current ?? "");
    const title = (threadRef && readThreadShell(threadRef)?.title.trim()) || gt("Thread");
    moveThreadContextDragGhost(point, { title, count: threads.length });
    return true;
  };
  const dropThreadContextDrag = (point: { x: number; y: number }) => {
    if (!pointerOutsideThreadList(point)) return false;
    restoreDragScroll();
    dropThreadContext(point, contextDragThreads());
    return true;
  };
  // useSensor memoizes options identity; fresh options rebuild DndContext and every sortable row.
  const pointerSensorOptions = {
    distance: SIDEBAR_DRAG_DISTANCE,
    onAttach: attachDragSensor,
    onFinish: finishThreadDrag,
    onMove: moveThreadContextDrag,
    onDrop: dropThreadContextDrag,
  };
  const dndSensors = useSensors(useSensor(SidebarPointerSensor, pointerSensorOptions));
  const sectionByThreadKeyRef = useRef(sectionByThreadKey);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes committed list data to refs read by stable drag and sweep callbacks
  useLayoutEffect(() => {
    projectGroupsRef.current = projectGroups;
    orderedThreadKeysRef.current = orderedThreadKeys;
    threadByKeyRef.current = threadByKey;
    settledThreadKeysRef.current = settledThreadKeys;
    snoozedThreadKeysRef.current = snoozedThreadKeys;
    sectionByThreadKeyRef.current = sectionByThreadKey;
  });
  const startActionSweep = useStableCallback(
    (threadRef: ScopedThreadRef, action: SidebarSweepAction, event: PointerEvent) => {
      const originKey = scopedThreadKey(threadRef);
      const originSection = sectionByThreadKeyRef.current.get(originKey);
      const canApply = (key: string) => {
        const thread = threadByKeyRef.current.get(key);
        return (
          thread !== undefined &&
          sectionByThreadKeyRef.current.get(key) === originSection &&
          serverConfigs.has(thread.environmentId)
        );
      };
      let targetKey: string | null = null;
      let sweptKeys: string[] = [];
      const sweepTo = (key: string | null) => {
        if (key === null || key === targetKey) return;
        targetKey = key;
        sweptKeys = resolveSidebarSweepKeys(orderedThreadKeysRef.current, originKey, key, canApply);
        setActionSweep({ action, keys: new Set(sweptKeys) });
      };
      dragSensorRef.current = new SidebarPointerSensor({
        active: originKey,
        event,
        options: {
          distance: SIDEBAR_DRAG_DISTANCE,
          onAttach: () => {},
          onFinish: () => {
            dragSensorRef.current = null;
            setActionSweep(null);
          },
        },
        onPending: () => {},
        onStart: () => sweepTo(originKey),
        onMove: ({ y }) =>
          sweepTo(threadListRef.current && sidebarThreadKeyAtY(threadListRef.current, y)),
        onEnd: () => {
          const keys = sweptKeys.filter(canApply);
          if (action === "settle") {
            settleThreads(keys);
            return;
          }
          for (const key of keys) {
            const ref = parseScopedThreadKey(key);
            if (ref === null) continue;
            if (action === "unsettle") attemptUnsettle(ref);
            else attemptUnsnooze(ref);
          }
        },
        onCancel: () => {},
        onAbort: () => {},
      });
    },
  );
  // Release during render when server state catches up so canonical order appears in the same frame.
  if (
    optimisticDrop !== null &&
    isOptimisticDropReleased({
      optimisticDrop,
      threads,
      pinnedKeys,
      activeKeys,
      now: snoozeNow,
    })
  ) {
    setOptimisticDrop(null);
  }
  const attemptPin = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await pinThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Failed to pin thread"),
            description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
          }),
        );
      }
    })();
  };
  const attemptUnpin = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await confirmAndUnpinThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Failed to unpin thread"),
            description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
          }),
        );
      }
    })();
  };

  const handleThreadDragStart = (event: DragStartEvent) => {
    const activeKey = String(event.active.id);
    contextDragKeyRef.current = activeKey;
    const activeSection = sectionByThreadKey.get(activeKey);
    if (activeSection === undefined) return;
    listMotionRef.current?.suspend();
    const list = threadListRef.current;
    const viewport = list?.closest('[data-slot="scroll-area-viewport"]');
    dragScrollRef.current = viewport ? { viewport, top: viewport.scrollTop } : null;
    const header = list?.querySelector<HTMLElement>('[data-testid="sidebar-pinned-header"]');
    if (list && header) {
      const listRect = list.getBoundingClientRect();
      const scale = list.offsetWidth > 0 ? listRect.width / list.offsetWidth : 1;
      dragLabelOffsetRef.current =
        header.getBoundingClientRect().top - listRect.top + SIDEBAR_DRAG_LABEL_HEIGHT * scale;
    } else {
      dragLabelOffsetRef.current = 0;
    }
    setDragState({
      activeKey,
      activeSection,
      targetSection: activeSection,
      contextDrag: false,
      occurredAt: new Date().toISOString(),
      activationY:
        event.activatorEvent instanceof PointerEvent ? event.activatorEvent.clientY : null,
    });
  };
  const hasProjectFolders = projectFolders !== null && projectFolders.length > 0;
  const sidebarListItemsFresh = ((): readonly SidebarListItem[] => {
    const rowsOf = (
      list: readonly EnvironmentThreadShell[],
      section: SidebarSection,
    ): SidebarListItem[] =>
      list.map((thread) => {
        const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
        return { kind: "thread", key, section };
      });
    // Boring mode keeps a pinned open project or one the user filtered to, so it can start a thread.
    if (
      !hasProjectFolders &&
      pinnedThreads.length +
        activeThreads.length +
        workingThreads.length +
        snoozedThreads.length +
        settledCount ===
        0
    ) {
      return [];
    }
    const items: SidebarListItem[] = [{ kind: "marker", marker: "pinned-header" }];
    const pinnedRows = rowsOf(pinnedThreads, "pinned");
    items.push(...pinnedRows);
    items.push({ kind: "marker", marker: "pinned-divider" });
    const activeRows = rowsOf(activeThreads, "active");
    items.push({ kind: "marker", marker: "active-placeholder" });
    items.push(...activeRows);
    if (workingThreads.length > 0) {
      items.push({ kind: "marker", marker: "working-header" });
      items.push(...rowsOf(visibleWorkingThreads, "working"));
    }
    if (snoozedThreads.length > 0) {
      items.push({ kind: "marker", marker: "snoozed-header" });
      items.push(...rowsOf(visibleSnoozedThreads, "snoozed"));
    }
    items.push({ kind: "marker", marker: "settled-header" });
    const settledRows = rowsOf(renderedSettledThreads, "settled");
    items.push({ kind: "marker", marker: "settled-placeholder" });
    items.push(...settledRows);
    return items;
  })();
  // Preserve the list while streamed updates leave order unchanged to retain row memoization.
  const sidebarListItemsKey = sidebarListItemsFresh
    .map((item) => (item.kind === "thread" ? item.section + ":" + item.key : item.marker))
    .join("\n");
  const [sidebarListItemsState, setSidebarListItems] = useState(sidebarListItemsFresh);
  const [sidebarListItemsKeyState, setSidebarListItemsKeyState] = useState(sidebarListItemsKey);
  let sidebarListItems = sidebarListItemsState;
  if (sidebarListItemsKeyState !== sidebarListItemsKey) {
    setSidebarListItemsKeyState(sidebarListItemsKey);
    setSidebarListItems(sidebarListItemsFresh);
    // Update the local list too; threadByKey already omits rows moved into collapsed shelves.
    sidebarListItems = sidebarListItemsFresh;
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels the dnd-kit drag sensor when the dragged row leaves the list
  useEffect(() => {
    if (
      dragState !== null &&
      !sidebarListItems.some((item) => item.kind === "thread" && item.key === dragState.activeKey)
    ) {
      cancelThreadDrag();
    }
  }, [cancelThreadDrag, dragState, sidebarListItems]);
  // Only order, section, or draft changes need layout reads and motion.
  const listMotionLayoutKey = [
    sidebarListItemsKey,
    projectFolders
      ?.map((folder) => `${folder.group.projectKey}:${folder.threads.length}`)
      .join("\n") ?? "",
    visibleDraftSessionCount,
    routeDraftIdForRows ?? "",
  ].join("\0");
  const listMotionAnimate =
    dragState === null && sidebarListItems.length + visibleDraftSessionCount > 0;
  // Cache on both fields so layout-key changes trigger the effect even when animate is unchanged.
  const listMotionPass = { layoutKey: listMotionLayoutKey, animate: listMotionAnimate };
  const shelfExpansionKey = [workingShelfExpanded, snoozedShelfExpanded, settledShelfExpanded].join(
    ":",
  );
  const previousShelfExpansionKeyRef = useRef(shelfExpansionKey);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records moved rows and updates list motion after each layout-affecting commit
  useLayoutEffect(() => {
    shiftGuardRef.current?.update();
    // Shelf rows would travel over stationary headers below the bottom-anchored shelf.
    const shelvesUnchanged = previousShelfExpansionKeyRef.current === shelfExpansionKey;
    previousShelfExpansionKeyRef.current = shelfExpansionKey;
    listMotionRef.current?.update(listMotionPass.animate && shelvesUnchanged);
  }, [listMotionPass, shelfExpansionKey]);
  const handleThreadDragOver = (event: DragOverEvent) => {
    const target = event.over
      ? resolveSidebarDropTarget(sidebarListItems, String(event.active.id), String(event.over.id))
      : null;
    setDragState((current) =>
      current === null || current.activeKey !== String(event.active.id)
        ? current
        : { ...current, targetSection: target?.section ?? null },
    );
  };
  const sortableIds = sidebarListItems.map(sidebarListItemId);
  // Keep non-drag orders constant to preserve sorting strategy and row identity during streaming.
  const { settledOrder: draggedSettledOrder, activeOrder: draggedActiveOrder } =
    dragState === null
      ? NO_DRAGGED_ORDERS
      : resolveDraggedOrders({
          drag: dragState,
          threadByKey,
          settledThreads,
          activeThreads,
          workingShelfEnabled,
        });
  const sidebarSortingStrategy = createSidebarSortingStrategy({
    items: sidebarListItems,
    enabled: !isContextDrag,
    boundaryLabelHeight: SIDEBAR_DRAG_LABEL_HEIGHT,
    settledOrder: draggedSettledOrder,
    ...(draggedActiveOrder === undefined ? {} : { activeOrder: draggedActiveOrder }),
    settledExpanded: settledShelfExpanded,
    settledVisibleCount,
    routeThreadKey: routeRowThreadKey,
    snoozedThreadCount: snoozedThreads.length,
  });
  const draggedThreadKey = dragState?.activeKey;
  const draggedFromSection = dragState?.activeSection;
  const dragActivationY = dragState?.activationY;
  const dndCollisionDetection = (() => {
    if (draggedThreadKey === undefined || draggedFromSection === undefined)
      return createSidebarCollisionDetection(() => true);
    const source = threadByKey.get(draggedThreadKey);
    if (source === undefined) return createSidebarCollisionDetection(() => false);
    return createSidebarCollisionDetection(
      (id) => {
        const target = resolveSidebarDropTarget(sidebarListItems, draggedThreadKey, id);
        if (target === null) return false;
        return (
          planSidebarThreadDrop({
            activeKey: draggedThreadKey,
            activeSection: draggedFromSection,
            activePinned: source.pinnedAt != null,
            activeSettled: source.settledOverride === "settled",
            supportsSettlement: serverConfigs.has(source.environmentId),
            target,
            pinnedOrder: pinnedKeys,
            pinnedKeysById,
            reorderableKeys: draggableThreadKeys,
            activeOrder: activeKeys,
            activeKeysById,
            activeReorderableKeys: activeReorderableThreadKeys,
            activeTimeOrdered: workingShelfEnabled,
          }).kind !== "none"
        );
      },
      {
        items: sidebarListItems,
        activationY: dragActivationY ?? null,
      },
    );
  })();
  const handleThreadDragEnd = (event: DragEndEvent) => {
    if (projectFolders !== null) return;
    const activeKey = String(event.active.id);
    const activeSection = sectionByThreadKey.get(activeKey);
    const target =
      event.over === null
        ? null
        : resolveSidebarDropTarget(sidebarListItems, activeKey, String(event.over.id));
    const activeThread = threadByKey.get(activeKey);
    if (activeSection === undefined || target === null || activeThread === undefined) return;
    const threadRef = scopeThreadRef(activeThread.environmentId, activeThread.id);
    const plan = planSidebarThreadDrop({
      activeKey,
      activeSection,
      activePinned: activeThread.pinnedAt != null,
      activeSettled: activeThread.settledOverride === "settled",
      supportsSettlement: serverConfigs.has(activeThread.environmentId),
      target,
      pinnedOrder: pinnedKeys,
      pinnedKeysById,
      reorderableKeys: draggableThreadKeys,
      activeOrder: activeKeys,
      activeKeysById,
      activeReorderableKeys: activeReorderableThreadKeys,
      activeTimeOrdered: workingShelfEnabled,
    });
    if (plan.kind === "none") return;
    if (plan.kind === "settle" && settlingThreadKeysRef.current.has(activeKey)) return;
    const assignments =
      plan.kind === "pin"
        ? [
            ...(plan.orderKey === undefined ? [] : [{ id: activeKey, orderKey: plan.orderKey }]),
            ...plan.extraAssignments,
          ]
        : plan.kind === "reorder-pinned" || plan.kind === "move-active"
          ? plan.assignments
          : [];
    if (
      !checkThreadOperations(
        [activeKey, ...assignments.map(({ id }) => id)].flatMap((key) => {
          const thread = threadByKey.get(key);
          return thread ? [thread] : [];
        }),
      )
    )
      return;
    const drop = {
      key: activeKey,
      sourceSection: activeSection,
      section: target.section,
      occurredAt: new Date().toISOString(),
      clearsSnooze:
        plan.kind === "pin" ||
        plan.kind === "settle" ||
        (plan.kind === "move-active" && plan.unsnooze),
      order: plan.kind === "settle" ? null : plan.order,
      keysAtDrop: target.section === "active" ? activeKeysById : pinnedKeysById,
      assignedKeys: new Map(assignments.map(({ id, orderKey }) => [id, orderKey])),
    };
    setOptimisticDrop(drop);
    void (async () => {
      const run = async (
        operation: Promise<AtomCommandResult<unknown, unknown>>,
        title: string,
      ) => {
        const result = await operation;
        if (result._tag === "Success") return true;
        setOptimisticDrop((current) => (current === drop ? null : current));
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title,
              description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
            }),
          );
        }
        return false;
      };
      switch (plan.kind) {
        case "settle": {
          settlingThreadKeysRef.current.add(activeKey);
          const navigateAfterSettle = planForwardNavigation(activeKey);
          if (navigateAfterSettle) departRouteThread(activeKey);
          const settled = await run(settleThread(threadRef), gt("Failed to settle thread")).finally(
            () => settlingThreadKeysRef.current.delete(activeKey),
          );
          if (
            settled &&
            shouldNavigateAfterThreadPark({
              threadKey: activeKey,
              currentThreadKey: readRouteThreadKey(router),
              action: "settle",
              now: new Date().toISOString(),
              thread: readThreadShell(threadRef),
            })
          )
            navigateAfterSettle?.();
          else stayOnRouteThread(activeKey);
          return;
        }
        case "move-active":
          if (plan.unpin && !(await run(unpinThread(threadRef), gt("Failed to unpin thread"))))
            return;
          if (
            plan.unsettle &&
            !(await run(unsettleThread(threadRef), gt("Failed to un-settle thread")))
          )
            return;
          if (plan.unsnooze && !(await run(unsnoozeThread(threadRef), gt("Failed to wake thread"))))
            return;
          break;
        case "pin":
          if (
            !(await run(
              pinThread(threadRef, plan.orderKey === undefined ? {} : { orderKey: plan.orderKey }),
              gt("Failed to pin thread"),
            ))
          )
            return;
          break;
        case "reorder-pinned":
          break;
      }
      const keyWrites = plan.kind === "pin" ? plan.extraAssignments : plan.assignments;
      for (const assignment of keyWrites) {
        const thread = threadByKey.get(assignment.id);
        if (thread === undefined) continue;
        if (
          !(await run(
            (plan.kind === "move-active" ? reorderActiveThread : reorderPinnedThread)(
              scopeThreadRef(thread.environmentId, thread.id),
              assignment.orderKey,
            ),
            plan.kind === "move-active"
              ? gt("Failed to reorder active threads")
              : gt("Failed to reorder pinned threads"),
          ))
        )
          return;
      }
    })();
  };
  const performSnooze = async (
    threadRef: ScopedThreadRef,
    preset: Pick<SnoozePreset, "snoozedUntil">,
    opts: { coSnoozingKeys?: ReadonlySet<string> } = {},
  ) => {
    const threadKey = scopedThreadKey(threadRef);
    if (snoozingThreadKeysRef.current.has(threadKey)) {
      return { status: "skipped" } as const;
    }
    snoozingThreadKeysRef.current.add(threadKey);
    const navigateAfterSnooze = planForwardNavigation(threadKey, opts.coSnoozingKeys);
    if (navigateAfterSnooze) departRouteThread(threadKey);
    const result = await snoozeThread(threadRef, preset.snoozedUntil);
    snoozingThreadKeysRef.current.delete(threadKey);
    if (result._tag === "Failure") {
      stayOnRouteThread(threadKey);
      return isAtomCommandInterrupted(result)
        ? ({ status: "interrupted" } as const)
        : ({ status: "failure", error: squashAtomCommandFailure(result) } as const);
    }
    if (
      shouldNavigateAfterThreadPark({
        threadKey,
        currentThreadKey: readRouteThreadKey(router),
        action: "snooze",
        now: new Date().toISOString(),
        thread: readThreadShell(threadRef),
      })
    ) {
      navigateAfterSnooze?.();
    } else {
      stayOnRouteThread(threadKey);
    }
    return { status: "success" } as const;
  };
  const attemptSnooze = useStableCallback(
    (
      threadRef: ScopedThreadRef,
      preset: Pick<SnoozePreset, "snoozedUntil">,
      opts: { coSnoozingKeys?: ReadonlySet<string> } = {},
    ) => {
      void (async () => {
        const outcome = await performSnooze(threadRef, preset, opts);
        if (outcome.status === "failure") {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: gt("Failed to snooze thread"),
              description: thrownErrorMessage(outcome.error, m) ?? gt("An error occurred."),
            }),
          );
          return;
        }
      })();
    },
  );

  const handleMultiSelectContextMenu = useStableCallback(
    async (position: { x: number; y: number }, source: ContextMenuSource) => {
      const api = readLocalApi();
      if (!api) return;
      const selectedThreadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys];
      const threadKeys = selectedThreadKeys.filter((threadKey) =>
        threadByKeyRef.current.has(threadKey),
      );
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;
      const selectionNow = new Date();
      const selectedThreads = threadKeys.flatMap((threadKey) => {
        const thread = threadByKeyRef.current.get(threadKey);
        return thread ? [thread] : [];
      });
      const settlingThreads = selectedThreads.filter(
        (thread) => thread.settledOverride !== "settled",
      );
      const canSnoozeSelection = selectedThreads.every(
        (thread) =>
          serverConfigs.has(thread.environmentId) &&
          canSnooze(thread, { now: selectionNow.toISOString() }),
      );
      const titleRegenerationThreads = selectedThreads.filter((thread) =>
        serverConfigs.has(thread.environmentId),
      );
      const regeneratableTitleThreads = titleRegenerationThreads.filter(
        (thread) => thread.titleRegeneration == null,
      );
      const titleRegenerationMenuItem = buildBulkTitleRegenerationContextMenuItem({
        supportedCount: titleRegenerationThreads.length,
        actionableCount: regeneratableTitleThreads.length,
      });
      const pinnedSelectedThreads = selectedThreads.filter(
        (thread) => serverConfigs.has(thread.environmentId) && thread.pinnedAt != null,
      );
      const unpinMenuItem = buildBulkUnpinContextMenuItem({
        pinnedCount: pinnedSelectedThreads.length,
      });
      // Presets sync across environments, so the first selected thread's stand for all.
      const menuOpenedAt = new Date();
      const snoozePresets = resolveSnoozePresets(
        menuOpenedAt,
        timestampFormat,
        selectedThreads[0]!.environmentId,
      );
      const clicked = await settlePromise(() =>
        api.contextMenu.show(
          [
            ...(unpinMenuItem
              ? [{ ...unpinMenuItem, disabled: !canOperateThreads(pinnedSelectedThreads) }]
              : []),
            {
              id: "settle",
              label: gt("Settle ({count})", { count }),
              disabled: settlingThreads.length === 0 || !canOperateThreads(settlingThreads),
            },
            ...(canSnoozeSelection
              ? [
                  {
                    id: "snooze",
                    label: gt("Snooze ({count})", { count }),
                    disabled: !canOperateThreads(selectedThreads),
                    children: [
                      ...snoozePresets.map((preset) => ({
                        id: `snooze:${preset.id}`,
                        label: preset.label,
                        detail: preset.whenLabel,
                        disabled: !canOperateThreads(selectedThreads),
                      })),
                      {
                        id: "snooze:custom",
                        label: gt("Custom…"),
                        separatorBefore: snoozePresets.length > 0,
                        disabled: !canOperateThreads(selectedThreads),
                      },
                    ],
                  },
                ]
              : []),
            ...(titleRegenerationMenuItem
              ? [
                  {
                    ...titleRegenerationMenuItem,
                    disabled:
                      titleRegenerationMenuItem.disabled ||
                      !canOperateThreads(regeneratableTitleThreads),
                  },
                ]
              : []),
            { id: "mark-unread", label: gt("Mark unread ({count})", { count }) },
            {
              id: "delete",
              label: gt("Delete ({count})", { count }),
              destructive: true,
              disabled: !canOperateThreads(selectedThreads),
            },
          ],
          position,
          source,
        ),
      );
      if (clicked._tag === "Failure" || clicked.value === null) return;
      const actionTargets =
        clicked.value === "unpin"
          ? pinnedSelectedThreads
          : clicked.value === "regenerate-title"
            ? regeneratableTitleThreads
            : clicked.value === "settle"
              ? settlingThreads.flatMap((thread) => {
                  const current = threadByKeyRef.current.get(
                    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
                  );
                  return current && current.settledOverride !== "settled" ? [current] : [];
                })
              : selectedThreads;
      if (clicked.value === "settle" && actionTargets.length === 0) return;
      if (clicked.value !== "mark-unread" && !checkThreadOperations(actionTargets)) return;
      if (clicked.value?.startsWith("snooze:")) {
        const preset =
          clicked.value === "snooze:custom"
            ? await requestCustomSnooze()
            : pickSnoozePreset(
                snoozePresets,
                clicked.value.slice("snooze:".length),
                timestampFormat,
                selectedThreads[0]!.environmentId,
              );
        if (preset) {
          const coSnoozingKeys = new Set(threadKeys);
          clearSelection();
          const outcomes = await Promise.all(
            selectedThreads.map(async (thread) => {
              const threadRef = scopeThreadRef(thread.environmentId, thread.id);
              const outcome = await performSnooze(threadRef, preset, { coSnoozingKeys });
              return { outcome, threadRef };
            }),
          );
          const snoozedThreadRefs = outcomes.flatMap(({ outcome, threadRef }) =>
            outcome.status === "success" ? [threadRef] : [],
          );
          const failures = outcomes.flatMap(({ outcome }) =>
            outcome.status === "failure" ? [outcome.error] : [],
          );

          if (failures.length > 0) {
            const firstError = failures[0];
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title:
                  snoozedThreadRefs.length > 0
                    ? gt(
                        "{count, plural, one {Failed to snooze {count} thread} other {Failed to snooze {count} threads}}",
                        { count: failures.length },
                      )
                    : gt("Failed to snooze threads"),
                description: thrownErrorMessage(firstError, m) ?? gt("An error occurred."),
              }),
            );
          }
        }
        return;
      }
      if (clicked.value === "unpin") {
        for (const thread of pinnedSelectedThreads) {
          attemptUnpin(scopeThreadRef(thread.environmentId, thread.id));
        }
        clearSelection();
        return;
      }
      if (clicked.value === "regenerate-title") {
        clearSelection();
        const toast = titleRegenerationToast(
          await Promise.all(
            regeneratableTitleThreads.map((thread) =>
              regenerateThreadTitle({
                environmentId: thread.environmentId,
                input: { threadId: thread.id },
              }),
            ),
          ),
        );
        if (toast) toastManager.add(toast);
        return;
      }
      if (clicked.value === "settle") {
        settleThreads(
          actionTargets.map((thread) =>
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          ),
        );
        clearSelection();
        return;
      }
      if (clicked.value === "mark-unread") {
        for (const threadKey of threadKeys) {
          const thread = threadByKeyRef.current.get(threadKey);
          if (thread) markThreadUnread(scopeThreadRef(thread.environmentId, thread.id));
        }
        clearSelection();
        return;
      }
      if (clicked.value !== "delete") return;
      if (confirmThreadDelete) {
        const confirmed = await settlePromise(() =>
          api.dialogs.confirm(
            [
              gt("{count, plural, one {Delete {count} thread?} other {Delete {count} threads?}}", {
                count,
              }),
              gt("This permanently clears conversation history for these threads."),
            ].join("\n"),
            { variant: "destructive" },
          ),
        );
        if (confirmed._tag === "Failure" || !confirmed.value) return;
      }
      if (
        !checkThreadOperations(
          threadKeys.flatMap((threadKey) => {
            const thread = threadByKeyRef.current.get(threadKey);
            return thread ? [thread] : [];
          }),
        )
      )
        return;
      const { deletedThreadKeys, firstFailure } = await deleteSelectedThreadEntries({
        entries: threadKeys.map((threadKey) => ({ threadKey })),
        delete: async ({ threadKey }, deletedThreadKeys) => {
          const thread = threadByKeyRef.current.get(threadKey);
          if (!thread) return null;
          return deleteThread(scopeThreadRef(thread.environmentId, thread.id), {
            deletedThreadKeys,
          });
        },
      });
      if (firstFailure !== null) {
        const firstError = squashAtomCommandFailure(firstFailure);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Failed to delete threads"),
            description: thrownErrorMessage(firstError, m) ?? gt("An error occurred."),
          }),
        );
      }
      removeFromSelection(
        getThreadKeysToDeselectAfterDelete(selectedThreadKeys, deletedThreadKeys, (threadKey) => {
          const threadRef = parseScopedThreadKey(threadKey);
          return threadRef !== null && readThreadShell(threadRef) !== null;
        }),
      );
    },
  );

  const handleDraftContextMenu = useStableCallback(
    (draftId: DraftId, position: { x: number; y: number }, source: ContextMenuSource) => {
      void (async () => {
        const api = readLocalApi();
        const session = useComposerDraftStore.getState().getDraftSession(draftId);
        if (!api || !session || session.promotedTo) return;
        const projectGroup = projectGroupsRef.current.find((group) =>
          group.memberProjectRefs.some(
            (ref) =>
              ref.environmentId === session.environmentId && ref.projectId === session.projectId,
          ),
        );
        const workspacePath =
          session.worktreePath ??
          projectByKey.get(`${session.environmentId}:${session.projectId}`)?.workspaceRoot;
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            buildDraftActionMenuItems({
              hasPath: Boolean(workspacePath),
              hasBranch: Boolean(session.branch),
              hasProject: projectGroup != null,
            }),
            position,
            source,
          ),
        );
        if (clicked._tag === "Failure") return;
        switch (clicked.value) {
          case "project-settings":
            if (projectGroup)
              openProjectSettings(projectGroup, {
                environmentId: session.environmentId,
                projectId: session.projectId,
              });
            return;
          case "copy-path":
            if (workspacePath) copyPathToClipboard(workspacePath, { path: workspacePath });
            return;
          case "copy-branch":
            if (session.branch) copyBranchToClipboard(session.branch, { branch: session.branch });
            return;
          case "discard": {
            // The menu may outlive draft promotion; discarding then would strand the send.
            const current = useComposerDraftStore.getState().getDraftSession(draftId);
            if (current && !current.promotedTo) discardComposerDraft(draftId);
            return;
          }
        }
      })();
    },
  );

  const handleThreadContextMenu = useStableCallback(
    (
      threadRef: ScopedThreadRef,
      position: { x: number; y: number },
      source: ContextMenuSource,
      fromSearch = false,
    ) => {
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        const threadKey = scopedThreadKey(threadRef);
        const selectionState = useThreadSelectionStore.getState();
        // Search results are not selectable rows, so they always act on their own thread.
        if (
          !fromSearch &&
          selectionState.hasSelection() &&
          selectionState.selectedThreadKeys.has(threadKey)
        ) {
          await handleMultiSelectContextMenu(position, source);
          return;
        }
        // Search results also reach threads in collapsed shelves, which are not rendered rows.
        const thread =
          threadByKeyRef.current.get(threadKey) ??
          searchableThreads.find((candidate) => threadShellKey(candidate) === threadKey);
        if (!thread) return;
        const threadWorkspacePath =
          thread.worktreePath ??
          projectByKey.get(`${thread.environmentId}:${thread.projectId}`)?.workspaceRoot ??
          null;
        const configLoaded = serverConfigs.has(thread.environmentId);
        const supportsAutoSettleOptOut =
          serverConfigs.get(thread.environmentId)?.environment.capabilities
            .threadAutoSettleOptOut === true;
        const isRegeneratingTitle = thread.titleRegeneration != null;
        const isSettled = settledThreadKeysRef.current.has(threadKey);
        const isSnoozed = snoozedThreadKeysRef.current.has(threadKey);
        const isPinned = thread.pinnedAt != null;
        const snoozePresets = resolveSnoozePresets(
          new Date(),
          timestampFormat,
          thread.environmentId,
        );
        const threadProjectGroup =
          projectGroupsRef.current.find((project) =>
            project.memberProjectRefs.some(
              (projectRef) =>
                projectRef.environmentId === thread.environmentId &&
                projectRef.projectId === thread.projectId,
            ),
          ) ?? null;
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            buildThreadActionMenuItems({
              canOperate: readEnvironmentScope(
                threadRef.environmentId,
                AuthOrchestrationOperateScope,
              ),
              branch: thread.branch ?? null,
              // An archived project is not a filter choice.
              projectFilter:
                threadProjectGroup && !threadProjectGroup.archived
                  ? {
                      label: threadProjectGroup.displayName,
                      isActive: projectScopeKeys.includes(threadProjectGroup.projectKey),
                    }
                  : null,
              isPinned,
              isSettled,
              autoSettleEnabled: thread.autoSettleDisabledAt == null,
              isSnoozed,
              canSnoozeNow: canSnooze(thread, { now: new Date().toISOString() }),
              isRegeneratingTitle,
              isRunning: !threadRuntimeCanArchive(thread.runtime),
              canShareWithGuest: appAtomRegistry.get(
                canShareWithGuestAtom(threadRef.environmentId),
              ),
              canTurnIntoProject: canTurnThreadIntoProject(threadRef),
              canRename: !fromSearch,
              supports: {
                settlement: configLoaded,
                autoSettleOptOut: supportsAutoSettleOptOut,
                snooze: configLoaded,
                pinning: configLoaded,
                titleRegeneration: configLoaded,
              },
              snoozePresets,
            }),
            position,
            source,
          ),
        );
        if (clicked._tag === "Failure" || clicked.value === null) return;
        if (threadActionRequiresOperate(clicked.value) && !checkThreadOperations([thread])) return;
        if (clicked.value?.startsWith("snooze:")) {
          const preset =
            clicked.value === "snooze:custom"
              ? await requestCustomSnooze()
              : pickSnoozePreset(
                  snoozePresets,
                  clicked.value.slice("snooze:".length),
                  timestampFormat,
                  thread.environmentId,
                );
          if (preset) attemptSnooze(threadRef, preset);
          return;
        }
        switch (clicked.value) {
          case "filter-by-project":
            if (threadProjectGroup) {
              setProjectScopeKeys(
                projectScopeKeys.includes(threadProjectGroup.projectKey)
                  ? []
                  : [threadProjectGroup.projectKey],
              );
            }
            return;
          case "project-settings":
            if (threadProjectGroup)
              openProjectSettings(threadProjectGroup, {
                environmentId: threadRef.environmentId,
                projectId: thread.projectId,
              });
            return;
          case "new-thread-on-branch": {
            const result = await settlePromise(() =>
              handleNewThread(scopeProjectRef(thread.environmentId, thread.projectId), {
                branch: thread.branch,
                worktreePath: thread.worktreePath,
                envMode: thread.worktreePath ? "worktree" : "local",
                startFromOrigin: false,
              }),
            );
            if (result._tag === "Failure") {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: gt("Could not create thread"),
                  description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
                }),
              );
            }
            return;
          }
          case "settle":
            attemptSettle(threadRef);
            return;
          case "unsettle":
            attemptUnsettle(threadRef);
            return;
          case "unsnooze":
            attemptUnsnooze(threadRef);
            return;
          case "pin":
            attemptPin(threadRef);
            return;
          case "unpin":
            attemptUnpin(threadRef);
            return;
          case "turn-into-project": {
            const result = await turnThreadIntoProject(threadRef);
            if (result._tag === "Success") {
              toastManager.add({
                type: "success",
                title: gt("Project created"),
                description: thread.title,
              });
            } else if (!isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: gt("Could not turn thread into a project"),
                  description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
                }),
              );
            }
            return;
          }
          case "auto-settle:enabled":
          case "auto-settle:disabled": {
            const result = await setThreadAutoSettle(
              threadRef,
              clicked.value === "auto-settle:enabled",
            );
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: gt("Failed to update auto-settle"),
                  description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
                }),
              );
            }
            return;
          }
          case "rename":
            startThreadRename(threadRef, thread.title);
            return;
          case "share-guest":
            openGuestShareDialog(threadRef);
            return;
          case "regenerate-title": {
            if (isRegeneratingTitle) return;
            const toast = titleRegenerationToast([
              await regenerateThreadTitle({
                environmentId: threadRef.environmentId,
                input: { threadId: threadRef.threadId },
              }),
            ]);
            if (toast) toastManager.add(toast);
            return;
          }
          case "mark-unread":
            markThreadUnread(threadRef);
            return;
          case "copy-path":
            if (!threadWorkspacePath) {
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: gt("Path unavailable"),
                  description: gt("This thread does not have a workspace path to copy."),
                }),
              );
              return;
            }
            copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
            return;
          case "copy-branch":
            if (thread.branch) {
              copyBranchToClipboard(thread.branch, { branch: thread.branch });
            }
            return;
          case "copy-thread":
            void copyThreadReference(
              threadChipCopyTarget(threadRef, thread.title, configuredHostedAppUrl(), m),
            );
            return;
          case "copy-thread-id":
            copyThreadIdToClipboard(thread.id, { threadId: thread.id });
            return;
          case "archive": {
            if (confirmThreadArchive) {
              const confirmed = await settlePromise(() =>
                api.dialogs.confirm(gt('Archive thread "{title}"?', { title: thread.title })),
              );
              if (confirmed._tag === "Failure" || !confirmed.value) return;
            }
            let didArchive = false;
            const result = await archiveThread(threadRef, {
              onArchived: () => {
                didArchive = true;
              },
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: didArchive
                    ? gt("Thread archived, but navigation failed")
                    : gt("Failed to archive thread"),
                  description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
                }),
              );
              return;
            }
            return;
          }
          case "delete": {
            if (confirmThreadDelete) {
              const confirmed = await settlePromise(() =>
                api.dialogs.confirm(
                  [
                    gt('Delete thread "{title}"?', { title: thread.title }),
                    gt("This permanently clears conversation history for this thread."),
                  ].join("\n"),
                  { variant: "destructive" },
                ),
              );
              if (confirmed._tag === "Failure" || !confirmed.value) return;
            }
            const result = await deleteThread(threadRef);
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: gt("Failed to delete thread"),
                  description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
                }),
              );
              return;
            }
            return;
          }
          default:
            return;
        }
      })();
    },
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to window keydown for thread navigation shortcuts using the current thread list
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isCommandPaletteOpen() || isModelPickerOpen()) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: threadShortcutContext(routeThreadRef),
      });
      const navigateToRowKey = (targetRowKey: string | null) => {
        if (!targetRowKey) return false;
        const targetDraftId = draftIdByRowKey.get(targetRowKey);
        const targetThread = threadByKey.get(targetRowKey);
        if (targetDraftId === undefined && !targetThread) return false;
        event.preventDefault();
        event.stopPropagation();
        if (targetDraftId !== undefined) navigateToDraft(targetDraftId);
        else if (targetThread)
          navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
        return true;
      };
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        navigateToRowKey(
          resolveAdjacentThreadId({
            threadIds: orderedRowKeys,
            currentThreadId: routeRowKey,
            direction: traversalDirection,
          }),
        );
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) return;
      navigateToRowKey(orderedRowKeys[jumpIndex] ?? null);
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [
    draftIdByRowKey,
    keybindings,
    navigateToDraft,
    navigateToThread,
    orderedRowKeys,
    routeRowKey,
    routeThreadRef,
    threadByKey,
  ]);

  const showJumpHints = useThreadJumpHintsVisible(keybindings, routeThreadRef);
  const draftJumpLabelById = showJumpHints
    ? new Map(
        listedDraftIds.flatMap((id) => {
          const label = jumpLabelByKey.get(`draft:${id}`);
          return label ? [[id, label] as const] : [];
        }),
      )
    : null;

  const orcaEnvironments = useMemo<readonly OrcaEnvironmentOption[]>(() => {
    const list = environmentPresentationsList.map((env): OrcaEnvironmentOption => {
      const isPrimary = env.entry.target._tag === "PrimaryConnectionTarget";
      const platformOs = env.serverConfig?.environment.platform.os ?? null;
      return {
        environmentId: env.environmentId,
        rawLabel: env.label,
        displayLabel: formatLocalEnvironmentDisplayLabel({
          rawLabel: env.label,
          platformOs,
          isPrimary,
          isZh: orcaCopy.isZh,
        }),
        machine: resolveEnvironmentMachineKind(env.serverConfig),
        isPrimary,
        isConnected: canCreateProjectInEnvironment(env.connection.phase),
        platformOs,
        addProjectBaseDirectory: env.serverConfig?.settings.addProjectBaseDirectory ?? null,
        newProjectsRoot: env.serverConfig?.newProjectsRoot ?? null,
        ghqCloneLayout: env.serverConfig?.settings.ghqCloneLayout === true,
      };
    });
    list.sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
      if (left.isConnected !== right.isConnected) return left.isConnected ? -1 : 1;
      return left.displayLabel.localeCompare(right.displayLabel);
    });
    return list;
  }, [environmentPresentationsList, orcaCopy.isZh]);

  const sidebarHostDescriptors = useMemo<readonly SidebarHostDescriptor[]>(
    () =>
      orcaEnvironments.map((env) => ({
        environmentId: env.environmentId,
        label: env.displayLabel,
        hostname: serverConfigs.get(env.environmentId)?.hostname ?? null,
        machine: env.machine,
        isPrimary: env.isPrimary,
        isConnected: env.isConnected,
      })),
    [orcaEnvironments, serverConfigs],
  );

  const orcaHostGroups =
    useOrcaCompactTree && projectFolders !== null
      ? groupProjectFoldersByHost({
          folders: projectFolders,
          hosts: sidebarHostDescriptors,
          activeThreadKey: routeRowThreadKey,
          localLastVisitedAtById,
        })
      : null;

  const effectiveAddProjectEnvId =
    selectedAddProjectEnvId ??
    orcaEnvironments.find((env) => env.isConnected)?.environmentId ??
    orcaEnvironments[0]?.environmentId ??
    null;

  const orcaActivityItems = useMemo<readonly OrcaActivityItem[]>(() => {
    return listedThreads.map((thread) => {
      const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      const envProviders =
        providerEntriesByEnvironment.get(thread.environmentId) ?? EMPTY_PROVIDER_ENTRIES;
      const providerEntry =
        envProviders.get(thread.modelSelection?.instanceId ?? thread.providerInstanceId) ?? null;
      const projectName =
        projectDisplayNameByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? "";
      return buildOrcaActivityItem({
        thread,
        localLastVisitedAt: localLastVisitedAtById[key],
        projectName,
        providerDriverKind: providerEntry?.driverKind ?? null,
        providerLabel: formatAgentBrandName(
          providerEntry?.driverKind ?? thread.providerInstanceId,
          providerEntry?.displayName,
        ),
      });
    });
  }, [listedThreads, localLastVisitedAtById, projectDisplayNameByKey, providerEntriesByEnvironment]);

  const orcaActivityBadge = useMemo(() => {
    const scopeFiltered = filterOrcaActivityItems(
      orcaActivityItems,
      { ...orcaPrefs, unreadOnly: false },
      "",
    );
    return summarizeOrcaActivityBadge(scopeFiltered);
  }, [orcaActivityItems, orcaPrefs]);

  const agentOptionsByEnvironment = useMemo(() => {
    const map = new Map<EnvironmentId, readonly OrcaWorkspaceAgentOption[]>();
    for (const [envId, entries] of providerEntriesByEnvironment) {
      const options: OrcaWorkspaceAgentOption[] = [];
      for (const entry of entries.values()) {
        if (!entry.enabled) continue;
        const primaryModel = entry.models[0];
        const modelSlug = primaryModel?.slug ?? "";
        const modelLabel = primaryModel?.name ?? modelSlug;
        options.push({
          id: `${entry.instanceId}:${modelSlug}`,
          providerInstanceId: entry.instanceId,
          driverKind: entry.driverKind,
          model: modelSlug,
          displayName: entry.displayName,
          modelLabel,
          online: true,
        });
      }
      map.set(envId as EnvironmentId, options);
    }
    return map;
  }, [providerEntriesByEnvironment]);

  const fallbackAgentOptions = useMemo<readonly OrcaWorkspaceAgentOption[]>(
    () => [
      {
        id: "claudeAgent:claude-opus-4-6",
        providerInstanceId: "claudeAgent",
        driverKind: "claudeAgent",
        model: "claude-opus-4-6",
        displayName: "Claude Code",
        modelLabel: "Claude Opus 4.6",
        online: true,
      },
      {
        id: "codex:gpt-5.4",
        providerInstanceId: "codex",
        driverKind: "codex",
        model: "gpt-5.4",
        displayName: "Codex",
        modelLabel: "GPT-5.4",
        online: true,
      },
      {
        id: "antigravity:gemini-2.5-pro",
        providerInstanceId: "antigravity",
        driverKind: "antigravity",
        model: "gemini-2.5-pro",
        displayName: "Antigravity",
        modelLabel: "Gemini 2.5 Pro",
        online: true,
      },
      {
        id: "omp:default",
        providerInstanceId: "omp",
        driverKind: "omp",
        model: "default",
        displayName: "oh-my-pi",
        modelLabel: "Default",
        online: true,
      },
    ],
    [],
  );

  const handleUpdateOrcaPrefs = useStableCallback((patch: Partial<OrcaProjectsPrefs>) => {
    setOrcaPrefs((prev) => {
      const next: OrcaProjectsPrefs = { ...prev, ...patch };
      writeOrcaProjectsPrefs(next);
      return next;
    });
  });

  const handleResetOrcaActivityFilters = useStableCallback(() => {
    setActivitySearchQuery("");
    handleUpdateOrcaPrefs({
      unreadOnly: DEFAULT_ORCA_PROJECTS_PREFS.unreadOnly,
      hideAutomationCreated: DEFAULT_ORCA_PROJECTS_PREFS.hideAutomationCreated,
      hideCliCreated: DEFAULT_ORCA_PROJECTS_PREFS.hideCliCreated,
    });
  });

  const handleToggleProjectsOpen = useStableCallback(() => {
    setProjectsSectionOpen((prev) => {
      const next = !prev;
      writeSidebarProjectsSectionOpen(next);
      return next;
    });
  });

  const canToggleAllProjects =
    (projectFolders !== null && projectFolders.length > 0) || projectGroups.length > 0;
  const allProjectsCollapsed =
    projectFolders !== null && projectFolders.length > 0
      ? areAllProjectsCollapsed(projectFolders)
      : !projectsSectionOpen;

  const handleToggleCollapseAllProjects = useStableCallback(() => {
    if (projectFolders !== null && projectFolders.length > 0) {
      const nextExpanded = computeCollapseAllProjectsNextExpanded(projectFolders);
      if (nextExpanded && !projectsSectionOpen) {
        setProjectsSectionOpen(true);
        writeSidebarProjectsSectionOpen(true);
      }
      for (const folder of projectFolders) {
        setProjectExpanded(sidebarFolderExpansionKeys(folder.group), nextExpanded);
      }
      return;
    }
    if (projectGroups.length > 0) {
      const nextExpanded = !projectsSectionOpen;
      setProjectsSectionOpen(nextExpanded);
      writeSidebarProjectsSectionOpen(nextExpanded);
      for (const group of projectGroups) {
        setProjectExpanded(sidebarFolderExpansionKeys(group), nextExpanded);
      }
      return;
    }
    const nextExpanded = !projectsSectionOpen;
    setProjectsSectionOpen(nextExpanded);
    writeSidebarProjectsSectionOpen(nextExpanded);
  });

  const handleToggleActivityView = useStableCallback(() => {
    setActivityViewActive((prev) => {
      const next = !prev;
      if (next && !projectsSectionOpen) {
        setProjectsSectionOpen(true);
        writeSidebarProjectsSectionOpen(true);
      }
      if (next && orcaPrefs.showSearch) {
        requestAnimationFrame(() => activitySearchInputRef.current?.focus());
      }
      return next;
    });
  });

  const handleMarkItemRead = useStableCallback((item: OrcaActivityItem) => {
    const nowIso = new Date().toISOString();
    markThreadVisitedLocal(item.key, nowIso);
    void visitThreadCommand({
      environmentId: item.thread.environmentId,
      input: { threadId: item.thread.id, visitedAt: nowIso },
    });
  });

  const handleMarkAllActivityRead = useStableCallback(() => {
    const unreadItems = orcaActivityItems.filter((item) => item.isUnread);
    if (unreadItems.length === 0) return;
    const nowIso = new Date().toISOString();
    for (const item of unreadItems) {
      markThreadVisitedLocal(item.key, nowIso);
      void visitThreadCommand({
        environmentId: item.thread.environmentId,
        input: { threadId: item.thread.id, visitedAt: nowIso },
      });
    }
    toastManager.add({
      type: "success",
      title: orcaCopy.markedAllReadToast(unreadItems.length),
    });
  });

  const handleClearCompletedActivities = useStableCallback(() => {
    const clearableKeys = orcaActivityItems
      .filter((item) => item.isCompleted && item.thread.settledOverride !== "settled")
      .map((item) => item.key);
    if (clearableKeys.length === 0) return;
    settleThreads(clearableKeys);
    toastManager.add({
      type: "success",
      title: orcaCopy.clearedCompletedToast(clearableKeys.length),
    });
  });

  const addLocalFolderPathAsProject = useStableCallback(
    async (input: { readonly environmentId: EnvironmentId; readonly path: string }) => {
      const cwd = input.path.trim();
      if (!cwd) return false;
      const existing = findProjectByPath(
        projects.filter((candidate) => candidate.environmentId === input.environmentId),
        cwd,
      );
      if (existing) {
        if (isMobile) setOpenMobile(false);
        await handleNewThread(scopeProjectRef(existing.environmentId, existing.id));
        return true;
      }
      if (!readEnvironmentScope(input.environmentId, AuthOrchestrationOperateScope)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Cannot add project"),
            description: gt("This connection cannot add projects."),
          }),
        );
        return false;
      }
      const projectId = newProjectId();
      const result = await createProject({
        environmentId: input.environmentId,
        input: {
          projectId,
          title: inferProjectTitleFromPath(cwd),
          workspaceRoot: cwd,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: null,
        },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: gt("Failed to add project"),
              description:
                thrownErrorMessage(squashAtomCommandFailure(result), m) ?? gt("An error occurred."),
            }),
          );
        }
        return false;
      }
      if (isMobile) setOpenMobile(false);
      await handleNewThread(scopeProjectRef(input.environmentId, projectId));
      return true;
    },
  );

  const handleBrowseFolder = useStableCallback((environmentId: EnvironmentId | null) => {
    const targetEnvId = environmentId ?? effectiveAddProjectEnvId;
    if (!targetEnvId) {
      toastManager.add({ type: "error", title: orcaCopy.environmentUnavailable });
      return;
    }
    const targetEnv = orcaEnvironments.find((env) => env.environmentId === targetEnvId) ?? null;
    const api = readLocalApi();
    if (isElectron && api && targetEnv?.isPrimary) {
      void api.dialogs
        .pickFolder(
          targetEnv.addProjectBaseDirectory
            ? { initialPath: targetEnv.addProjectBaseDirectory }
            : undefined,
        )
        .then((picked) => {
          if (!picked) return;
          return addLocalFolderPathAsProject({ environmentId: targetEnvId, path: picked });
        });
      return;
    }
    setBrowseFolderDialogEnvId(targetEnvId);
  });

  const handleOpenCloneDialog = useStableCallback((environmentId: EnvironmentId | null) => {
    const targetEnvId = environmentId ?? effectiveAddProjectEnvId;
    if (!targetEnvId) {
      toastManager.add({ type: "error", title: orcaCopy.environmentUnavailable });
      return;
    }
    setCloneDialogEnvId(targetEnvId);
  });

  const handleOpenCreateProjectDialog = useStableCallback((environmentId: EnvironmentId | null) => {
    const targetEnvId = environmentId ?? effectiveAddProjectEnvId;
    if (!targetEnvId) {
      toastManager.add({ type: "error", title: orcaCopy.environmentUnavailable });
      return;
    }
    setCreateProjectDialogEnvId(targetEnvId);
  });

  const handlePickParentFolder = useStableCallback(async (): Promise<string | null> => {
    const api = readLocalApi();
    if (!isElectron || !api) return null;
    return api.dialogs.pickFolder().catch(() => null);
  });

  const handleSubmitCloneProject = useStableCallback(
    async (input: {
      readonly environmentId: EnvironmentId;
      readonly remoteUrl: string;
      readonly destinationPath: string;
    }): Promise<boolean> => {
      if (
        !readEnvironmentScope(input.environmentId, AuthSourceControlWriteScope) ||
        !readEnvironmentScope(input.environmentId, AuthOrchestrationOperateScope)
      ) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Clone unavailable"),
            description: gt(
              "This connection needs permission to write source control and add projects.",
            ),
          }),
        );
        return false;
      }
      const projectId = newProjectId();
      const result = await startProjectClone({
        environmentId: input.environmentId,
        input: {
          projectId,
          title: inferProjectTitleFromPath(input.destinationPath),
          createdAt: new Date().toISOString(),
          remoteUrl: input.remoteUrl,
          destinationPath: input.destinationPath,
        },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: gt("Clone failed"),
              description:
                thrownErrorMessage(squashAtomCommandFailure(result), m) ?? gt("An error occurred."),
            }),
          );
        }
        return false;
      }
      if (isMobile) setOpenMobile(false);
      void handleNewThread(scopeProjectRef(input.environmentId, projectId));
      return true;
    },
  );

  const handleSubmitCreateProject = useStableCallback(
    async (input: {
      readonly environmentId: EnvironmentId;
      readonly name: string;
      readonly parentDir: string | null;
    }): Promise<boolean> => {
      const targetEnv =
        orcaEnvironments.find((env) => env.environmentId === input.environmentId) ?? null;
      const defaultRoot = targetEnv?.newProjectsRoot ?? null;
      const customParent = input.parentDir?.trim() ?? "";
      if (defaultRoot && (!customParent || customParent === defaultRoot)) {
        return createNewProject({
          environmentId: input.environmentId,
          name: input.name,
          publishTo: null,
        });
      }
      const sep = customParent.includes("\\") ? "\\" : "/";
      const fullPath =
        customParent.length > 0
          ? `${customParent.replace(/[\\/]+$/, "")}${sep}${input.name}`
          : input.name;
      return addLocalFolderPathAsProject({
        environmentId: input.environmentId,
        path: fullPath,
      });
    },
  );

  const handleOpenCreateWorkspace = useStableCallback(() => {
    setCreateWorkspaceOpen(true);
  });

  const handleOpenProviderSettings = useStableCallback(() => {
    if (isMobile) setOpenMobile(false);
    void router.navigate({ to: "/settings/providers" });
  });

  const handleSubmitCreateWorkspace = useStableCallback(
    async (
      payload: CreateWorkspacePayload,
      resolvedAgent: OrcaWorkspaceAgentOption | null,
    ): Promise<boolean> => {
      const targetEnvId = payload.environmentId as EnvironmentId;
      let targetProjectRef: ScopedProjectRef | null = null;
      let fallbackTitle = payload.workspaceName ?? "New Workspace";

      if (payload.isScratchProject) {
        const scratch = await openScratchProject(targetEnvId);
        if (!scratch) return false;
        targetProjectRef = scopeProjectRef(scratch.environmentId, scratch.id);
        fallbackTitle = payload.workspaceName ?? scratch.title;
      } else {
        const group =
          projectGroups.find((candidate) => candidate.projectKey === payload.projectKey) ?? null;
        if (!group) return false;
        const memberOnEnv = group.memberProjects.find(
          (member) => member.environmentId === targetEnvId,
        );
        targetProjectRef = memberOnEnv
          ? scopeProjectRef(memberOnEnv.environmentId, memberOnEnv.id)
          : scopeProjectRef(group.environmentId, group.id);
        fallbackTitle = payload.workspaceName ?? group.displayName;
      }

      const explicitModelSelection =
        resolvedAgent && resolvedAgent.model.length > 0
          ? createModelSelection(
              ProviderInstanceId.make(resolvedAgent.providerInstanceId),
              resolvedAgent.model,
            )
          : null;

      // Custom workspace title or "Create more" batch flow materializes a named server thread directly.
      if (payload.workspaceName !== null || payload.createMore) {
        const envProviders =
          providerEntriesByEnvironment.get(targetProjectRef.environmentId) ?? EMPTY_PROVIDER_ENTRIES;
        const firstProvider = [...envProviders.values()].find((entry) => entry.enabled) ?? null;
        const fallbackModelSelection =
          explicitModelSelection ??
          (firstProvider && firstProvider.models[0]
            ? createModelSelection(
                ProviderInstanceId.make(firstProvider.instanceId),
                firstProvider.models[0].slug,
              )
            : createModelSelection(ProviderInstanceId.make("claudeAgent"), "claude-opus-4-6"));

        const threadId = newThreadId();
        const created = await createThreadCommand({
          environmentId: targetProjectRef.environmentId,
          input: {
            threadId,
            projectId: targetProjectRef.projectId,
            title: payload.workspaceName ?? fallbackTitle,
            modelSelection: fallbackModelSelection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_INTERACTION_MODE,
            branch: payload.branch,
            worktreePath: null,
          },
        });
        if (created._tag === "Failure") {
          if (!isAtomCommandInterrupted(created)) {
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: gt("Could not create thread"),
                description:
                  thrownErrorMessage(squashAtomCommandFailure(created), m) ??
                  gt("An error occurred."),
              }),
            );
          }
          return false;
        }
        const createdThreadRef = scopeThreadRef(targetProjectRef.environmentId, threadId);
        if (payload.initialPrompt) {
          useComposerDraftStore.getState().setPrompt(createdThreadRef, payload.initialPrompt);
        }
        if (payload.createMore) {
          toastManager.add({
            type: "success",
            title: orcaCopy.workspaceCreatedToast(payload.workspaceName ?? fallbackTitle),
          });
          return true;
        }
        if (isMobile) setOpenMobile(false);
        void navigateToThread(createdThreadRef);
        return true;
      }

      const opened = await handleNewThread(targetProjectRef, {
        envMode: payload.envMode,
        branch: payload.branch,
        ...(payload.initialPrompt ? { prompt: payload.initialPrompt } : {}),
      });
      if (opened && explicitModelSelection) {
        useComposerDraftStore
          .getState()
          .setModelSelection(opened.draftId, explicitModelSelection, { replaceOptions: true });
      }
      if (isMobile) setOpenMobile(false);
      return opened !== null;
    },
  );

  // Global Orca sidebar shortcuts: `Ctrl+Shift+H` (collapse/expand all projects) & `Ctrl+N` (Create workspace).
  // Registered in the capture phase ahead of bubble-phase global commands (such as `chat.new` / `composer.host`)
  // so `Ctrl+N` deterministically opens `OrcaCreateWorkspaceDialog` instead of T3's command-dialog,
  // while still yielding when focus is in an editable field or when the command palette / model picker is open.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to capture-phase shortcut dispatcher for Orca sidebar shortcuts
  useEffect(() => {
    const onOrcaShortcutKeyDown = createOrcaSidebarShortcutHandler({
      isCommandPaletteOpen,
      isModelPickerOpen,
      onToggleCollapseAllProjects: handleToggleCollapseAllProjects,
      onOpenCreateWorkspace: handleOpenCreateWorkspace,
    });
    return registerCommands(
      {},
      {
        capture: true,
        onKeyDown: onOrcaShortcutKeyDown,
      },
    );
  }, [handleOpenCreateWorkspace, handleToggleCollapseAllProjects]);

  const handleLocateCurrentThread = useStableCallback(() => {
    if (!routeRowThreadKey) {
      toastManager.add({
        type: "info",
        title: gt("No active thread to locate"),
      });
      return;
    }
    if (!projectsSectionOpen) {
      setProjectsSectionOpen(true);
      writeSidebarProjectsSectionOpen(true);
    }
    if (activityViewActive) {
      setActivityViewActive(false);
    }
    const targetSection = sectionByThreadKey.get(routeRowThreadKey);
    if (targetSection === "working" && !workingShelfExpanded) toggleWorkingShelf();
    if (targetSection === "snoozed" && !snoozedShelfExpanded) toggleSnoozedShelf();
    if (targetSection === "settled" && !settledShelfExpanded) toggleSettledShelf();
    if (projectFolders !== null) {
      for (const folder of projectFolders) {
        const containsRoute =
          folder.threads.some((t) => threadShellKey(t) === routeRowThreadKey) ||
          folder.hiddenThreads.some((t) => threadShellKey(t) === routeRowThreadKey);
        if (containsRoute) {
          if (collapsedHostEnvIds.has(folder.group.environmentId)) {
            setCollapsedHostEnvIds((prev) => {
              const next = new Set(prev);
              next.delete(folder.group.environmentId);
              return next;
            });
          }
          if (folder.collapsed) {
            setProjectExpanded(sidebarFolderExpansionKeys(folder.group), true);
          }
          break;
        }
      }
    }
    requestAnimationFrame(() => {
      const listRoot = threadListRef.current ?? sidebarContentRef.current;
      if (!listRoot) return;
      const rows = listRoot.querySelectorAll<HTMLElement>("[data-sidebar-row]");
      for (const row of rows) {
        if (row.dataset.sidebarRow === routeRowThreadKey) {
          row.scrollIntoView({ block: "center", behavior: "smooth" });
          row.focus({ preventScroll: true });
          break;
        }
      }
    });
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- connects bottom toolbar locate button to active sidebar row scroll
  useEffect(
    () => subscribeLocateActiveSidebarThread(handleLocateCurrentThread),
    [handleLocateCurrentThread],
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- connects Workspace Board lane '+' buttons to OrcaCreateWorkspaceDialog
  useEffect(
    () => subscribeOpenCreateWorkspace(handleOpenCreateWorkspace),
    [handleOpenCreateWorkspace],
  );

  const defaultCreateWorkspaceProjectKey = useMemo(() => {
    const activeThread = newThreadContext.activeThread ?? newThreadContext.activeDraftThread;
    if (activeThread) {
      const matched = projectGroups.find((group) =>
        group.memberProjectRefs.some(
          (ref) =>
            ref.environmentId === activeThread.environmentId &&
            ref.projectId === activeThread.projectId,
        ),
      );
      if (matched) return matched.projectKey;
    }
    if (newThreadContext.defaultProjectRef) {
      const matched = projectGroups.find((group) =>
        group.memberProjectRefs.some(
          (ref) =>
            ref.environmentId === newThreadContext.defaultProjectRef?.environmentId &&
            ref.projectId === newThreadContext.defaultProjectRef?.projectId,
        ),
      );
      if (matched) return matched.projectKey;
    }
    return projectGroups[0]?.projectKey ?? null;
  }, [newThreadContext.activeDraftThread, newThreadContext.activeThread, newThreadContext.defaultProjectRef, projectGroups]);

  const cloneDialogEnv =
    orcaEnvironments.find((env) => env.environmentId === cloneDialogEnvId) ?? null;
  const createProjectDialogEnv =
    orcaEnvironments.find((env) => env.environmentId === createProjectDialogEnvId) ?? null;
  const browseFolderDialogEnv =
    orcaEnvironments.find((env) => env.environmentId === browseFolderDialogEnvId) ?? null;

  return (
    <TooltipProvider
      delay={railCompact ? SIDEBAR_RAIL_TOOLTIP_DELAY_MS : SIDEBAR_EXPANDED_TOOLTIP_DELAY_MS}
      closeDelay={SIDEBAR_RAIL_TOOLTIP_CLOSE_DELAY_MS}
      timeout={SIDEBAR_RAIL_TOOLTIP_TIMEOUT_MS}
    >
      <SidebarFolderDrop>
        <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        ref={sidebarContentRef}
        className="min-h-full"
        fixedHeader={
          <SidebarGroup className={cn("z-[1]", railCompact && "px-1.5")}>
            <PrismuxSidebarQuickNav
              routeThreadRef={routeThreadRef}
              showSearch={orcaPrefs.showSearch}
            />
            <OrcaProjectsHeader
              projectsOpen={projectsSectionOpen}
              onToggleProjectsOpen={handleToggleProjectsOpen}
              canToggleAllProjects={canToggleAllProjects}
              allProjectsCollapsed={allProjectsCollapsed}
              onToggleCollapseAllProjects={handleToggleCollapseAllProjects}
              activityViewActive={activityViewActive}
              onToggleActivityView={handleToggleActivityView}
              activityBadge={orcaActivityBadge}
              prefs={orcaPrefs}
              onUpdatePrefs={handleUpdateOrcaPrefs}
              onMarkAllRead={handleMarkAllActivityRead}
              onClearCompleted={handleClearCompletedActivities}
              environments={orcaEnvironments}
              selectedAddProjectEnvId={effectiveAddProjectEnvId}
              onSelectAddProjectEnvId={setSelectedAddProjectEnvId}
              onBrowseFolder={handleBrowseFolder}
              onOpenCloneDialog={handleOpenCloneDialog}
              onOpenCreateProjectDialog={handleOpenCreateProjectDialog}
              onOpenCreateWorkspace={handleOpenCreateWorkspace}
            />
          </SidebarGroup>
        }
      >
        <SidebarGroup
          className={cn(
            "flex-1",
            railCompact
              ? "items-center px-1.5"
              : cn(
                  "transition-opacity duration-[90ms] ease-out motion-reduce:transition-none",
                  isTextHidden && "pointer-events-none opacity-0",
                ),
          )}
          role="presentation"
        >
          {railCompact ? (
            <ul
              ref={attachTreeRef}
              role="presentation"
              data-testid="prismux-sidebar-rail-threads"
              className="flex w-full flex-col items-center gap-1"
            >
              {(() => {
                const railCandidates = [...pinnedThreads, ...activeThreads, ...workingThreads];
                const activeAttentionKeys = new Set(
                  orcaActivityItems
                    .filter(
                      (item) =>
                        item.bucket === "attention" || item.bucket === "working" || item.isUnread,
                    )
                    .map((item) => item.key),
                );
                const railThreads = activityViewActive
                  ? railCandidates.filter((thread) =>
                      activeAttentionKeys.has(threadShellKey(thread)),
                    )
                  : railCandidates;
                if (railThreads.length === 0 && !activityViewActive) {
                  const railProjects = projectGroups.filter(
                    (group) => !group.archived && !group.isScratch,
                  );
                  return railProjects.map((group) => (
                    <li key={`rail-project:${group.projectKey}`} className="list-none">
                      <SidebarRailMonogramButton
                        icon={<ProjectFavicon project={group} className="size-4 shrink-0" />}
                        primaryLabel={group.displayName}
                        ariaLabel={group.displayName}
                        dataProjectKey={group.projectKey}
                        onClick={() => {
                          setOpen(true);
                          setProjectExpanded(sidebarFolderExpansionKeys(group), true);
                        }}
                      />
                    </li>
                  ));
                }
                return railThreads.map((thread) => {
                  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
                  const threadKey = scopedThreadKey(threadRef);
                  const isRouteActive = routeRowThreadKey === threadKey;
                  const project =
                    projectByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null;
                  const projectDisplayName =
                    projectDisplayNameByKey.get(`${thread.environmentId}:${thread.projectId}`) ??
                    project?.title ??
                    null;
                  const effectiveThread = {
                    ...thread,
                    lastVisitedAt: resolveThreadLastVisitedAt(
                      thread.lastVisitedAt,
                      localLastVisitedAtById[threadKey],
                    ),
                  };
                  const rowStatus = resolveSidebarRowStatus(effectiveThread);
                  const agentLamp = resolveAgentRuntimeLamp(rowStatus);
                  const isUnread =
                    rowStatus === "ready" && hasUnseenCompletion(effectiveThread);
                  const statusText = messages(agentLamp.labelMessage);
                  const tooltipContent = resolveSidebarRailThreadTooltip({
                    threadTitle: thread.title,
                    projectDisplayName,
                    lampState: agentLamp.state,
                    statusText,
                    fallbackTitle: gt("New thread"),
                  });
                  const dotClassName =
                    agentLamp.state !== "idle"
                      ? agentLamp.dotClassName
                      : isUnread
                        ? "bg-primary"
                        : null;
                  return (
                    <li key={threadKey} className="list-none">
                      <SidebarRailMonogramButton
                        icon={
                          project ? (
                            <ProjectFavicon project={project} className="size-4 shrink-0" />
                          ) : (
                            <MessageSquareIcon aria-hidden className="size-3.5 shrink-0" />
                          )
                        }
                        primaryLabel={tooltipContent.primary}
                        secondaryLabel={tooltipContent.secondary}
                        ariaLabel={tooltipContent.ariaLabel}
                        active={isRouteActive}
                        dotClassName={dotClassName}
                        dataRow={threadKey}
                        onClick={() => navigateToThread(threadRef)}
                      />
                    </li>
                  );
                });
              })()}
            </ul>
          ) : activityViewActive ? (
            projectsSectionOpen ? (
              <OrcaActivityView
                items={orcaActivityItems}
                prefs={orcaPrefs}
                query={activitySearchQuery}
                onQueryChange={setActivitySearchQuery}
                searchInputRef={activitySearchInputRef}
                activeThreadKey={routeRowThreadKey}
                onSelectThread={(threadRef) => {
                  void navigateToThread(threadRef);
                }}
                onMarkItemRead={handleMarkItemRead}
                onResetFilters={handleResetOrcaActivityFilters}
              />
            ) : null
          ) : (
            <>
          {projectsSectionOpen &&
          !hasProjectFolders &&
          visibleDraftSessionCount === 0 &&
          pinnedThreads.length +
            activeThreads.length +
            workingThreads.length +
            snoozedThreads.length ===
            0 &&
          (settledCount === 0 || scopedProjectGroups.length > 0) ? (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
              {projects.length === 0 ? (
                <>
                  <span>
                    <T>No projects yet</T>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleBrowseFolder(effectiveAddProjectEnvId)}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-2xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                  >
                    <PlusIcon className="-mx-0.5 size-3" />
                    <T>Add project</T>
                  </button>
                </>
              ) : scopedProjectGroups.length > 0 ? (
                <>
                  <span>
                    {settledCount > 0
                      ? scopedProjectGroups.length > 1
                        ? gt("No active threads in these projects")
                        : gt("No active threads in {project}", {
                            project: scopedProjectGroups[0]!.displayName,
                          })
                      : scopedProjectGroups.length > 1
                        ? gt("No threads in these projects yet")
                        : gt("No threads in {project} yet", {
                            project: scopedProjectGroups[0]!.displayName,
                          })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setProjectScopeKeys([])}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-2xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                  >
                    <T>Show all projects</T>
                  </button>
                </>
              ) : (
                <T>No threads yet</T>
              )}
            </div>
          ) : null}
          {projectsSectionOpen ? (
            <TooltipProvider
              key="sidebar-thread-tooltips-150"
              delay={150}
              closeDelay={0}
              timeout={400}
            >
              <DndContext
                sensors={dndSensors}
                autoScroll={isContextDrag ? false : SIDEBAR_AUTO_SCROLL}
                collisionDetection={dndCollisionDetection}
                modifiers={dndModifiers}
                onDragStart={handleThreadDragStart}
                onDragOver={handleThreadDragOver}
                onDragEnd={handleThreadDragEnd}
              >
                <SortableContext items={sortableIds} strategy={sidebarSortingStrategy}>
                  <ul
                    ref={attachTreeRef}
                    data-orca-compact={orcaPrefs.compactMode ? "true" : undefined}
                    data-orca-tree={useOrcaCompactTree ? "true" : "false"}
                    // Presentation flattens VoiceOver's list interaction boundary while preserving descendant
                    // controls.
                    role="presentation"
                    className={cn(
                      "relative flex flex-col gap-px",
                      sidebarListItems.length > 0 && "flex-1",
                      !useOrcaCompactTree &&
                        orcaPrefs.compactMode &&
                        "[&_[data-sidebar-row]]:min-h-7 [&_[data-sidebar-row]]:py-0.5",
                      actionSweep !== null && "**:pointer-events-none",
                      // Projected rows (two boundary labels, two hints) extend the scroll range; a range that
                      // shrinks as the target changes clamps scrollTop and flips the target under a still pointer.
                      dragState !== null &&
                        "after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-30 after:h-px after:content-['']",
                    )}
                  >
                    {(() => {
                      const renderThreadRow = (
                        thread: EnvironmentThreadShell,
                        section: SidebarSection,
                        // The tree row of the project folder this row sits in.
                        folderRow?: string,
                        inWorkspaceCard = false,
                      ) => {
                        const threadKey = scopedThreadKey(
                          scopeThreadRef(thread.environmentId, thread.id),
                        );
                        const isCard =
                          section === "active" || section === "pinned" || section === "working";
                        const rowVariant = useOrcaCompactTree
                          ? "orca-compact"
                          : folderRow
                            ? folderRowsMultiline
                              ? "folder-multiline"
                              : "folder"
                            : isCard
                              ? "card"
                              : "slim";
                        return (
                          <SortableThreadRow
                            key={threadKey}
                            sortableId={threadKey}
                            contextDrag={isContextDrag}
                            sortableDisabled={
                              rowVariant === "orca-compact" ||
                              renamingThreadKey === threadKey ||
                              !draggableThreadKeys.has(threadKey) ||
                              optimisticDrop !== null
                            }
                            thread={thread}
                            variant={rowVariant}
                            inWorkspaceCard={inWorkspaceCard}
                            navigationParent={
                              folderRow ??
                              (section === "working" ||
                              section === "snoozed" ||
                              section === "settled"
                                ? `shelf:${section}`
                                : undefined)
                            }
                            variantAction={
                              section === "snoozed"
                                ? "unsnooze"
                                : section === "settled"
                                  ? "unsettle"
                                  : "settle"
                            }
                            settlementSupported={serverConfigs.has(thread.environmentId)}
                            snoozeSupported={serverConfigs.has(thread.environmentId)}
                            pinningSupported={serverConfigs.has(thread.environmentId)}
                            isPinned={thread.pinnedAt != null}
                            dropVerb={
                              dragState?.activeKey === threadKey
                                ? resolveSidebarDropVerb(dragState.activeSection, dragTargetSection)
                                : null
                            }
                            dragOverPinned={
                              dragState?.activeKey === threadKey && dragTargetSection === "pinned"
                            }
                            sweepAction={
                              actionSweep?.keys.has(threadKey) ? actionSweep.action : null
                            }
                            snoozeWakeLabelText={
                              section === "snoozed" && thread.snoozedUntil != null
                                ? snoozeWakeLabel(
                                    thread.snoozedUntil,
                                    { now: new Date().toISOString() },
                                    messages,
                                  )
                                : null
                            }
                            wokeAt={threadWokeAt(thread, { now: snoozeNow })}
                            isActive={routeRowThreadKey === threadKey}
                            revealRef={
                              routeRowThreadKey === threadKey ? revealActiveRow : undefined
                            }
                            isRouteThread={routeThreadKey === threadKey}
                            readOpensPullRequestsInRightPanel={readOpensPullRequestsInRightPanel}
                            jumpLabel={
                              showJumpHints ? (jumpLabelByKey.get(threadKey) ?? null) : null
                            }
                            environmentLabel={
                              environmentLabelById.get(thread.environmentId) ?? null
                            }
                            environmentMachine={
                              environmentMachineById.get(thread.environmentId) ?? "server"
                            }
                            project={
                              projectByKey.get(`${thread.environmentId}:${thread.projectId}`) ??
                              null
                            }
                            projectDisplayName={
                              projectDisplayNameByKey.get(
                                `${thread.environmentId}:${thread.projectId}`,
                              ) ?? null
                            }
                            providerEntryByInstanceId={
                              providerEntriesByEnvironment.get(thread.environmentId) ??
                              EMPTY_PROVIDER_ENTRIES
                            }
                            timestampFormat={timestampFormat}
                            onThreadClick={handleThreadClick}
                            onThreadActivate={navigateToThread}
                            onStartRename={startThreadRename}
                            onRenameTitleChange={setRenamingTitle}
                            onCommitRename={commitThreadRename}
                            onCancelRename={cancelThreadRename}
                            isRenaming={renamingThreadKey === threadKey}
                            renamingTitle={renamingThreadKey === threadKey ? renamingTitle : ""}
                            onContextMenu={handleThreadContextMenu}
                            onSettle={attemptSettle}
                            onActionSweepStart={startActionSweep}
                            onUnsettle={attemptUnsettle}
                            onSnooze={attemptSnooze}
                            onUnsnooze={attemptUnsnooze}
                            onUnpin={attemptUnpin}
                            onAcknowledgeWoke={acknowledgeWoke}
                            onFileDropThreads={handleThreadFileDrop}
                          />
                        );
                      };
                      const from = isContextDrag ? null : (dragState?.activeSection ?? null);
                      const items: ReactNode[] = [
                        <SidebarDraftBlock
                          key="draft-sessions"
                          draftIds={draftIds}
                          routeDraftComposer={routeDraftComposer}
                          terminalLabels={draftTerminalLabels}
                          jumpLabelByDraftId={draftJumpLabelById}
                          projectByKey={projectByKey}
                          projectDisplayNameByKey={projectDisplayNameByKey}
                          routeDraftId={routeDraftIdForRows}
                          onNavigateToDraft={navigateToDraft}
                          onDraftContextMenu={handleDraftContextMenu}
                        />,
                      ];
                      for (const item of sidebarListItems) {
                        if (item.kind === "thread") {
                          // Folders draw active rows in their own place below.
                          if (projectFolders !== null && item.section === "active") continue;
                          items.push(renderThreadRow(threadByKey.get(item.key)!, item.section));
                          continue;
                        }
                        if (projectFolders !== null && item.marker === "active-placeholder") {
                          if (useOrcaCompactTree && orcaHostGroups !== null) {
                            for (const hostGroup of orcaHostGroups) {
                              const isHostCollapsed = collapsedHostEnvIds.has(
                                hostGroup.environmentId,
                              );
                              items.push(
                                <SidebarHostGroupCapsule
                                  key={`host-group:${hostGroup.environmentId}`}
                                  environmentId={hostGroup.environmentId}
                                  label={hostGroup.label}
                                  hostname={hostGroup.hostname}
                                  machine={hostGroup.machine}
                                  workspaceCount={hostGroup.workspaceCount}
                                  collapsed={isHostCollapsed}
                                  onToggle={() => toggleHostGroupCollapsed(hostGroup.environmentId)}
                                />,
                              );
                              if (isHostCollapsed) continue;
                              for (const { folder, workspaces } of hostGroup.folders) {
                                items.push(
                                  <SidebarProjectFolderHeader
                                    key={`project-folder:${folder.group.projectKey}`}
                                    group={folder.group}
                                    collapsed={folder.collapsed}
                                    hiddenThreads={folder.hiddenThreads}
                                    onToggle={toggleProjectFolder}
                                    onNewThread={startThreadInProjectFolder}
                                    onContextMenu={handleProjectFolderContextMenu}
                                  />,
                                );
                                for (const workspace of workspaces) {
                                  const primaryThread = workspace.threads[0];
                                  items.push(
                                    <SidebarWorkspaceCard
                                      key={`workspace:${folder.group.projectKey}:${workspace.workspaceKey}`}
                                      workspace={workspace}
                                      onActivateWorkspace={
                                        primaryThread
                                          ? () => {
                                              void navigateToThread(
                                                scopeThreadRef(
                                                  primaryThread.environmentId,
                                                  primaryThread.id,
                                                ),
                                              );
                                            }
                                          : undefined
                                      }
                                      onOpenWorkspaceFiles={
                                        primaryThread
                                          ? () => {
                                              const targetRef = scopeThreadRef(
                                                primaryThread.environmentId,
                                                primaryThread.id,
                                              );
                                              useRightPanelStore.getState().open(targetRef, "files");
                                              void navigateToThread(targetRef);
                                            }
                                          : undefined
                                      }
                                    >
                                      {workspace.threads.map((thread) =>
                                        renderThreadRow(
                                          thread,
                                          "active",
                                          sidebarFolderRowId(folder.group.projectKey),
                                          true,
                                        ),
                                      )}
                                    </SidebarWorkspaceCard>,
                                  );
                                }
                              }
                            }
                            continue;
                          }
                          for (const folder of projectFolders) {
                            items.push(
                              <SidebarProjectFolderHeader
                                key={`project-folder:${folder.group.projectKey}`}
                                group={folder.group}
                                collapsed={folder.collapsed}
                                hiddenThreads={folder.hiddenThreads}
                                onToggle={toggleProjectFolder}
                                onNewThread={startThreadInProjectFolder}
                                onContextMenu={handleProjectFolderContextMenu}
                              />,
                            );
                            for (const thread of folder.threads) {
                              items.push(
                                renderThreadRow(
                                  thread,
                                  "active",
                                  sidebarFolderRowId(folder.group.projectKey),
                                ),
                              );
                            }
                          }
                          continue;
                        }
                        switch (item.marker) {
                          case "pinned-header":
                            items.push(
                              <SidebarDragBoundary
                                key="pinned-header"
                                marker="pinned-header"
                                label={gt("Pinned", { $context: "sidebar section" })}
                                visible={from !== null}
                                isDropTarget={dragTargetSection === "pinned"}
                              />,
                            );
                            break;
                          case "pinned-divider":
                            items.push(
                              <SidebarDragBoundary
                                key="pinned-divider"
                                marker="pinned-divider"
                                label={gt("Active", { $context: "sidebar section" })}
                                visible={from !== null}
                                isDropTarget={dragTargetSection === "active"}
                              />,
                            );
                            break;
                          case "active-placeholder":
                            items.push(
                              <SidebarSectionPlaceholder
                                key="active-placeholder"
                                marker="active-placeholder"
                                label={gt("Active", { $context: "sidebar section" })}
                                showHint={
                                  from !== null &&
                                  (activeThreads.length === 0 ||
                                    (from === "active" &&
                                      activeThreads.length === 1 &&
                                      dragTargetSection !== null &&
                                      dragTargetSection !== "active"))
                                }
                                isDropTarget={dragTargetSection === "active"}
                              />,
                            );
                            break;
                          case "working-header":
                            items.push(
                              <SidebarSectionHeader
                                key="working-shelf-header"
                                marker="working-header"
                                className="mt-auto"
                                label={gt("Working", { $context: "sidebar section" })}
                                count={workingThreads.length}
                                toggle={{
                                  expanded: workingShelfExpanded,
                                  onToggle: toggleWorkingShelf,
                                }}
                              />,
                            );
                            break;
                          case "snoozed-header":
                            items.push(
                              <SidebarSectionHeader
                                key="snoozed-shelf-header"
                                marker="snoozed-header"
                                className={cn(workingThreads.length === 0 && "mt-auto")}
                                label={gt("Snoozed", { $context: "sidebar section" })}
                                count={snoozedThreads.length}
                                toggle={{
                                  expanded: snoozedShelfExpanded,
                                  onToggle: toggleSnoozedShelf,
                                }}
                              />,
                            );
                            break;
                          case "settled-header":
                            items.push(
                              <SidebarSectionHeader
                                key="settled-shelf-header"
                                marker="settled-header"
                                className={cn(
                                  workingThreads.length + snoozedThreads.length === 0 && "mt-auto",
                                )}
                                label={gt("Settled", { $context: "sidebar section" })}
                                count={settledCount}
                                dragging={from !== null}
                                isDropTarget={dragTargetSection === "settled"}
                                toggle={{
                                  expanded: settledShelfExpanded,
                                  onToggle: toggleSettledShelf,
                                }}
                              />,
                            );
                            break;
                          case "settled-placeholder":
                            items.push(
                              <SidebarSectionPlaceholder
                                key="settled-placeholder"
                                marker="settled-placeholder"
                                label={gt("Settled", { $context: "sidebar section" })}
                                showHint={
                                  from !== null &&
                                  (renderedSettledThreads.length === 0 ||
                                    (from === "settled" &&
                                      renderedSettledThreads.length === 1 &&
                                      dragTargetSection !== null &&
                                      dragTargetSection !== "settled"))
                                }
                                isDropTarget={dragTargetSection === "settled"}
                              />,
                            );
                            break;
                        }
                      }
                      return items;
                    })()}
                    {settledShelfExpanded && hiddenSettledCount > 0 ? (
                      <li className="list-none">
                        <button
                          type="button"
                          data-sidebar-row="settled:more"
                          data-sidebar-parent="shelf:settled"
                          aria-disabled={olderSettledShelf.loading}
                          onClick={() => {
                            if (olderSettledShelf.loading) return;
                            olderSettledShelf.retry();
                            showMoreSettled();
                          }}
                          className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground aria-disabled:cursor-default"
                        >
                          {/* Plus means "add", so revealing more uses a chevron. */}
                          <ChevronDownIcon aria-hidden className="size-4 shrink-0" />
                          {olderSettledShelf.loading
                            ? gt("Loading")
                            : olderSettledShelf.failed
                              ? gt("Could not load older threads. Retry")
                              : gt(
                                  "{count, plural, one {Show {count} more} other {Show {count} more}}",
                                  {
                                    count: Math.min(hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT),
                                  },
                                )}
                        </button>
                      </li>
                    ) : null}
                  </ul>
                </SortableContext>
              </DndContext>
            </TooltipProvider>
          ) : null}
            </>
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />

      {/* Orca Create Workspace (`Ctrl+N`) & Add Project liquid-glass dialogs */}
      <OrcaCreateWorkspaceDialog
        open={createWorkspaceOpen}
        onOpenChange={setCreateWorkspaceOpen}
        projects={projectGroups}
        defaultProjectKey={defaultCreateWorkspaceProjectKey}
        environments={orcaEnvironments}
        defaultEnvironmentId={effectiveAddProjectEnvId}
        agentOptionsByEnvironment={agentOptionsByEnvironment}
        fallbackAgentOptions={fallbackAgentOptions}
        onOpenProviderSettings={handleOpenProviderSettings}
        onBrowseFolder={handleBrowseFolder}
        onOpenCloneDialog={handleOpenCloneDialog}
        onOpenCreateProjectDialog={handleOpenCreateProjectDialog}
        onSubmit={handleSubmitCreateWorkspace}
      />

      <OrcaCloneProjectDialog
        open={cloneDialogEnvId !== null}
        onOpenChange={(open) => {
          if (!open) setCloneDialogEnvId(null);
        }}
        environment={cloneDialogEnv}
        canPickLocalFolder={isElectron && cloneDialogEnv?.isPrimary === true}
        onPickParentFolder={handlePickParentFolder}
        onSubmitClone={handleSubmitCloneProject}
      />

      <OrcaCreateProjectDialog
        open={createProjectDialogEnvId !== null}
        onOpenChange={(open) => {
          if (!open) setCreateProjectDialogEnvId(null);
        }}
        environment={createProjectDialogEnv}
        canPickLocalFolder={isElectron && createProjectDialogEnv?.isPrimary === true}
        onPickParentFolder={handlePickParentFolder}
        onSubmitCreate={handleSubmitCreateProject}
      />

      <OrcaBrowseFolderFallbackDialog
        open={browseFolderDialogEnvId !== null}
        onOpenChange={(open) => {
          if (!open) setBrowseFolderDialogEnvId(null);
        }}
        environment={browseFolderDialogEnv}
        onSubmitFolderPath={addLocalFolderPathAsProject}
      />
      </SidebarFolderDrop>
    </TooltipProvider>
  );
}
