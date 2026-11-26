import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@prismux/client-runtime/environment";
import type { EnvironmentProject } from "@prismux/client-runtime/state/shell";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ProviderInstanceId,
  type ScopedThreadRef,
  type ServerProvider,
  type ServerSettings,
  type ThreadId,
} from "@prismux/core-contracts";
import { createModelSelection } from "@prismux/core-shared/model";
import { resolveProjectSettings } from "@prismux/core-shared/projectSettings";
import { resolveNewThreadModelSelection } from "@prismux/core-shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cn, newDraftId, newThreadId } from "~/lib/utils";
import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useScratchProject } from "../../hooks/useScratchProject";
import { useClientSettings } from "../../hooks/useSettings";
import { useStableCallback } from "../../hooks/useStableCallback";
import {
  formatAgentBrandName,
  resolveAgentBrandId,
  resolveProviderEntryDisplayName,
} from "../../prismux/agentBrand";
import {
  PrismuxTopbarControls,
  PrismuxWallpaperQuickPanel,
} from "../../prismux/PrismuxWallpaperBridge";
import {
  NO_PROVIDER_MODEL_SELECTION,
  providerInstanceEntriesFor,
  resolveProjectDefaultProviderModelSelection,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../../rightPanelLayout";
import {
  selectPaneOverviewOpen,
  useRightPanelStore,
  type AgentSessionSurface,
} from "../../rightPanelStore";
import { useProjects, useQuietThreadShell, useVisibleThreadShells } from "../../state/entities";
import { useEnvironmentProviders, usePrimaryEnvironmentId } from "../../state/environments";
import { environmentServerConfigsAtom } from "../../state/server";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  type ThreadRouteTarget,
} from "../../threadRoutes";
import { resolveComposerProviderSelection } from "../ChatView.logic";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { orderProviderInstanceEntries } from "../chat/ProviderModelPicker.logic";
import type { ModelEsque } from "../chat/providerIconUtils";
import { RightPanelAgentSessionPane } from "./RightPanelAgentSessionPane";
import {
  isWorkspaceConversationTab,
  resolveFocusedSplitRightPanelContext,
  resolveSplitRouteOwnership,
  type WorkspaceDraftSessionLookup,
} from "./splitPaneIsolation.logic";
import { WorkspacePaneContent } from "./WorkspacePaneContent";

const WorkspaceSplitRightPanelDock = lazy(() =>
  import("./WorkspaceSplitRightPanelDock").then((module) => ({
    default: module.WorkspaceSplitRightPanelDock,
  })),
);
import {
  buildQuickLaunchAgentOptions,
  resolveProviderBrandIdForEntry,
  resolveQuickLaunchAgentTarget,
  type QuickLaunchAgentOption,
  type QuickLaunchHistoryThread,
  type QuickLaunchOpenTabMatch,
  type QuickLaunchToolId,
} from "./workspaceQuickLaunch.logic";
import {
  PRISMUX_SPLIT_DRAG_EVENT,
  ROOT_SPLIT_PANE_EDGES,
  computeClampedSplitRatio,
  deriveChildSplitEdges,
  dispatchSplitDragEvent,
  hasSplitDragMime,
  readSplitDragDataTransfer,
  resolveDropPreviewOverlayClass,
  resolveDropZoneLabel,
  resolvePaneBodyCornerClasses,
  resolvePaneDropZone,
  resolvePaneOuterBorderClasses,
  type SplitDragEventDetail,
  type SplitDragPayload,
  type SplitDropZone,
  type SplitPaneEdges,
} from "./splitAnything.logic";
import { WorkspaceTabBar } from "./WorkspaceTabBar";
import {
  PrismuxStageFrame,
  WorkspaceSplitPaneContext,
  WorkspaceTopbarPortalContext,
  type WorkspaceActiveChatProviderSnapshot,
  type WorkspaceTopbarPortalContextValue,
} from "./WorkspaceTopbarPortalContext";
import {
  clampSplitRatio,
  countLeafPanes,
  findPrimaryUnusedDraftTab,
  getLiveComposerDraftStateLookup,
  listLeafPaneIds,
  useWorkspaceTabsStore,
  WORKSPACE_MAX_SPLIT_PANES,
  type OpenWorkspaceTabInput,
  type SplitDirection,
  type WorkspaceSplitLayoutNode,
  type WorkspaceTab,
} from "./workspaceTabsStore";

export { resolveProviderBrandIdForEntry };

export interface PendingDraftTabBinding {
  readonly token: object;
  readonly tabId: string | null;
  readonly originRouteKey?: string | null | undefined;
  readonly title: string;
  readonly providerId: string | null;
  readonly instanceId: ProviderInstanceId | null;
  readonly model: string | null;
}

export interface WorkspaceRouteProviderMetadata {
  readonly entry: ProviderInstanceEntry | null;
  readonly instanceId: ProviderInstanceId | null;
  readonly providerId: string | null;
  readonly model: string | null;
  readonly title: string;
}

/**
 * Decides whether a pending `+` launch binding should apply to the current draft route sync
 * and whether it must be consumed/cleared immediately so it can NEVER revert subsequent
 * composer model/provider switches.
 */
export function resolvePendingDraftBindingForSync(input: {
  readonly shownTarget: ThreadRouteTarget | null;
  readonly routeKey: string | null;
  readonly pendingBinding: PendingDraftTabBinding | null;
  readonly routeComposerDraft: {
    readonly activeProvider: ProviderInstanceId | null;
    readonly modelSelectionByProvider: Readonly<Partial<Record<ProviderInstanceId, ModelSelection>>>;
    readonly modelSelectionExplicit?: boolean | undefined;
  } | null;
  readonly activeChatProvider?: WorkspaceActiveChatProviderSnapshot | null | undefined;
}): {
  readonly applied: PendingDraftTabBinding | null;
  readonly shouldClear: boolean;
} {
  const { shownTarget, routeKey, pendingBinding, routeComposerDraft, activeChatProvider } = input;
  if (!pendingBinding) {
    return { applied: null, shouldClear: false };
  }
  // Keep in-flight launch bindings untouched while still on a server route waiting to navigate.
  if (shownTarget?.kind !== "draft") {
    return { applied: null, shouldClear: false };
  }

  // If the user explicitly switched provider or model in the composer, discard stale pending binding!
  const explicitComposerProvider = routeComposerDraft?.modelSelectionExplicit
    ? routeComposerDraft.activeProvider
    : null;
  const explicitComposerModel = explicitComposerProvider
    ? (routeComposerDraft?.modelSelectionByProvider[explicitComposerProvider]?.model ?? null)
    : null;
  if (
    explicitComposerProvider !== null &&
    ((pendingBinding.instanceId !== null && explicitComposerProvider !== pendingBinding.instanceId) ||
      (explicitComposerModel !== null &&
        pendingBinding.model !== null &&
        explicitComposerModel !== pendingBinding.model))
  ) {
    return { applied: null, shouldClear: true };
  }

  // If the mounted ChatView for this exact route already reports a newer explicit provider/instance, discard!
  const liveChatSnapshot =
    activeChatProvider && routeKey && activeChatProvider.routeKey === routeKey
      ? activeChatProvider
      : null;
  if (
    liveChatSnapshot?.instanceId != null &&
    pendingBinding.instanceId !== null &&
    liveChatSnapshot.instanceId !== pendingBinding.instanceId &&
    (routeComposerDraft?.modelSelectionExplicit === true ||
      pendingBinding.originRouteKey === routeKey)
  ) {
    return { applied: null, shouldClear: true };
  }

  // Still sitting on the origin draft waiting for `handleNewThread` to navigate to a brand-new draft.
  if (
    pendingBinding.originRouteKey &&
    routeKey &&
    pendingBinding.originRouteKey === routeKey &&
    pendingBinding.tabId === null
  ) {
    return { applied: null, shouldClear: false };
  }

  // Consume once applied so future `useEffect` runs never overwrite tab harness with stale data.
  return { applied: pendingBinding, shouldClear: true };
}

/**
 * Resolves the workspace tab's live provider, instance, model, and fallback display title
 * using the exact same priority chain as `ChatView`:
 * - For real server threads (`!isDraft`), ALWAYS trusts the thread's actual live harness
 *   (`liveChatSnapshot` matching `routeKey`, `routeThreadShell.runtime.providerInstanceId`,
 *   `routeThreadShell.modelSelection.instanceId`, `routeThreadShell.providerInstanceId`) and
 *   matches by `instanceId` first (even for `acpRegistry` agents like DSH), never letting a
 *   stale `stickyActiveProvider` or wrong default override it.
 * - For draft threads (`isDraft`), matches composer draft selection -> live ChatView snapshot
 *   -> sticky provider -> project/server default & fallback selection -> healthy selectable provider.
 */
export function resolveWorkspaceRouteProviderMetadata(input: {
  readonly shownTarget: ThreadRouteTarget | null;
  readonly routeKey: string | null;
  readonly routeThreadShell: {
    readonly title?: string | null | undefined;
    readonly modelSelection?: ModelSelection | null | undefined;
    readonly providerInstanceId?: ProviderInstanceId | null | undefined;
    readonly runtime?: {
      readonly providerInstanceId?: ProviderInstanceId | null | undefined;
    } | null | undefined;
  } | null;
  readonly routeComposerDraft: {
    readonly activeProvider: ProviderInstanceId | null;
    readonly modelSelectionByProvider: Readonly<Partial<Record<ProviderInstanceId, ModelSelection>>>;
    readonly modelSelectionExplicit?: boolean | undefined;
  } | null;
  readonly stickyActiveProvider: ProviderInstanceId | null;
  readonly stickyModelSelectionByProvider: Readonly<
    Partial<Record<ProviderInstanceId, ModelSelection>>
  >;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: ServerSettings;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly activeProject: EnvironmentProject | null;
  readonly activeProjectId: ProjectId | null;
  readonly activeChatProvider?: WorkspaceActiveChatProviderSnapshot | null | undefined;
  readonly now?: number | undefined;
}): WorkspaceRouteProviderMetadata {
  const {
    shownTarget,
    routeKey,
    routeThreadShell,
    routeComposerDraft,
    stickyActiveProvider,
    stickyModelSelectionByProvider,
    providers,
    settings,
    instanceEntries,
    activeProject,
    activeProjectId,
    activeChatProvider,
    now,
  } = input;

  const isDraft = shownTarget?.kind === "draft";
  const liveChatSnapshot =
    activeChatProvider && routeKey && activeChatProvider.routeKey === routeKey
      ? activeChatProvider
      : null;

  const projectDefaultModelSelection = resolveProjectSettings(
    settings,
    activeProject?.id ?? activeProjectId ?? null,
    activeProject ?? undefined,
  ).settings.defaultModelSelection;

  const draftModelResolution = isDraft
    ? resolveNewThreadModelSelection({
        defaultSelection:
          projectDefaultModelSelection ??
          resolveProjectDefaultProviderModelSelection(providers, settings, activeProjectId),
        fallbackSelection: settings.fallbackModelSelection,
        providers,
        settings,
        projectId: activeProjectId,
        now: now ?? Date.now(),
      })
    : null;

  const effectiveDefaultSelection = draftModelResolution?.fallback
    ? draftModelResolution.selection
    : (projectDefaultModelSelection ?? draftModelResolution?.selection ?? null);

  let resolvedEntry: ProviderInstanceEntry | null = null;
  let instanceId: ProviderInstanceId | null = null;

  if (!isDraft) {
    // Real server threads: ALWAYS trust the thread's live harness by exact instanceId first.
    const serverAuthoritativeIds = [
      liveChatSnapshot?.instanceId,
      routeThreadShell?.runtime?.providerInstanceId,
      routeThreadShell?.modelSelection?.instanceId,
      routeThreadShell?.providerInstanceId,
    ].filter(
      (candidate): candidate is ProviderInstanceId =>
        candidate != null && candidate !== NO_PROVIDER_MODEL_SELECTION.instanceId,
    );

    const authoritativeInstanceId = serverAuthoritativeIds[0] ?? null;
    if (authoritativeInstanceId !== null) {
      resolvedEntry =
        instanceEntries.find((candidate) => candidate.instanceId === authoritativeInstanceId) ??
        null;
      instanceId = resolvedEntry?.instanceId ?? authoritativeInstanceId;
    } else {
      const serverFallbackCandidates: Array<ProviderInstanceId | null | undefined> = [
        routeComposerDraft?.modelSelectionExplicit ? routeComposerDraft.activeProvider : null,
        routeComposerDraft?.activeProvider,
        effectiveDefaultSelection?.instanceId,
      ];
      const { selectedProviderEntry, requestedInstanceId } = resolveComposerProviderSelection({
        entries: instanceEntries,
        candidateInstanceIds: serverFallbackCandidates,
        lockedProvider: null,
        lockedInstanceId: null,
      });
      resolvedEntry =
        selectedProviderEntry ??
        (requestedInstanceId
          ? (instanceEntries.find((candidate) => candidate.instanceId === requestedInstanceId) ??
            null)
          : null);
      instanceId =
        resolvedEntry?.instanceId ?? requestedInstanceId ?? liveChatSnapshot?.instanceId ?? null;
    }
  } else {
    const draftCandidateInstanceIds: Array<ProviderInstanceId | null | undefined> = [
      routeComposerDraft?.modelSelectionExplicit ? routeComposerDraft.activeProvider : null,
      liveChatSnapshot?.instanceId,
      routeComposerDraft?.activeProvider,
      stickyActiveProvider,
      effectiveDefaultSelection?.instanceId,
    ];

    const explicitDraftInstanceId =
      routeComposerDraft?.modelSelectionExplicit &&
      routeComposerDraft.activeProvider &&
      routeComposerDraft.activeProvider !== NO_PROVIDER_MODEL_SELECTION.instanceId
        ? routeComposerDraft.activeProvider
        : null;
    const explicitEnabledEntry = explicitDraftInstanceId
      ? (instanceEntries.find(
          (candidate) => candidate.instanceId === explicitDraftInstanceId && candidate.enabled,
        ) ?? null)
      : null;

    if (explicitEnabledEntry) {
      resolvedEntry = explicitEnabledEntry;
      instanceId = explicitEnabledEntry.instanceId;
    } else {
      const { selectedProviderEntry, requestedInstanceId } = resolveComposerProviderSelection({
        entries: instanceEntries,
        candidateInstanceIds: draftCandidateInstanceIds,
        lockedProvider: null,
        lockedInstanceId: null,
      });

      resolvedEntry =
        selectedProviderEntry ??
        (requestedInstanceId
          ? (instanceEntries.find((candidate) => candidate.instanceId === requestedInstanceId) ??
            null)
          : null);
      instanceId =
        resolvedEntry?.instanceId ?? requestedInstanceId ?? liveChatSnapshot?.instanceId ?? null;
    }
  }

  const providerId: string | null = resolvedEntry
    ? resolveProviderBrandIdForEntry(resolvedEntry)
    : (liveChatSnapshot?.providerId ?? instanceId ?? null);

  const draftSelectedModel =
    instanceId !== null
      ? (routeComposerDraft?.modelSelectionByProvider[instanceId]?.model ?? null)
      : null;
  const stickySelectedModel =
    isDraft && instanceId !== null
      ? (stickyModelSelectionByProvider[instanceId]?.model ?? null)
      : null;
  const shellSelectedModel =
    routeThreadShell?.modelSelection &&
    (instanceId === null || routeThreadShell.modelSelection.instanceId === instanceId)
      ? routeThreadShell.modelSelection.model
      : null;
  const defaultSelectedModel =
    effectiveDefaultSelection &&
    (instanceId === null || effectiveDefaultSelection.instanceId === instanceId)
      ? effectiveDefaultSelection.model
      : null;
  const liveSnapshotModel =
    liveChatSnapshot &&
    (instanceId === null || liveChatSnapshot.instanceId === instanceId)
      ? liveChatSnapshot.model
      : null;

  const model = isDraft
    ? (draftSelectedModel ??
      liveSnapshotModel ??
      stickySelectedModel ??
      shellSelectedModel ??
      defaultSelectedModel ??
      null)
    : (liveSnapshotModel ??
      shellSelectedModel ??
      draftSelectedModel ??
      defaultSelectedModel ??
      null);

  let title: string;
  if (routeThreadShell?.title?.trim()) {
    title = routeThreadShell.title.trim();
  } else if (isDraft) {
    if (resolvedEntry) {
      title = resolveProviderEntryDisplayName(resolvedEntry);
    } else if (liveChatSnapshot?.displayName?.trim()) {
      title = liveChatSnapshot.displayName.trim();
    } else if (providerId) {
      title = formatAgentBrandName(providerId);
    } else {
      title = "新会话";
    }
  } else {
    title = "会话";
  }

  return {
    entry: resolvedEntry,
    instanceId,
    providerId,
    model,
    title,
  };
}

/**
 * Primary-pane single-unused-draft launch/switch orchestration:
 * 1. If the primary pane already has a live, non-promoted unused draft tab, switches its
 *    Agent/Model in-place without calling `handleNewThread` or creating a second tab.
 * 2. If an unused draft tab exists with an expired/missing draft session (or none exists yet),
 *    calls `handleNewThread(..., { forceNew: false })` and binds/reuses the target tab in-place
 *    so at most one unused blank draft tab ever exists in the primary pane.
 */
export async function launchPrimaryAgentDraft(input: {
  readonly agent: QuickLaunchAgentOption;
  readonly resolvedPaneId: string;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly resolveProjectRef: () => Promise<{
    readonly projectRef: ReturnType<typeof scopeProjectRef>;
    readonly fromScratch: boolean;
  } | null>;
  readonly handleNewThread: (
    projectRef: ReturnType<typeof scopeProjectRef>,
    options?: {
      readonly envMode?: "local" | "worktree";
      readonly forceNew?: boolean;
      readonly modelSelection?: ReturnType<typeof createModelSelection> | null;
    },
  ) => Promise<{ readonly draftId: DraftId; readonly threadId: ThreadId } | null>;
  readonly onNavigateToDraft: (draftId: DraftId) => void;
  readonly onNavigateHome: () => void;
  readonly originRouteKey?: string | null | undefined;
  readonly setPendingBinding?: (binding: PendingDraftTabBinding | null) => void;
  readonly getPendingBinding?: () => PendingDraftTabBinding | null;
}): Promise<string | null> {
  const {
    agent,
    resolvedPaneId,
    instanceEntries,
    resolveProjectRef,
    handleNewThread,
    onNavigateToDraft,
    onNavigateHome,
    originRouteKey,
    setPendingBinding,
    getPendingBinding,
  } = input;

  const store = useWorkspaceTabsStore.getState();
  const resolved = resolveQuickLaunchAgentTarget(agent, instanceEntries);
  const draftStore = useComposerDraftStore.getState();
  const draftLookup = getLiveComposerDraftStateLookup();
  const existingUnusedTab = findPrimaryUnusedDraftTab(store, draftLookup);

  // Branch 1: Primary pane already has a live unused blank draft tab -> switch Agent/Model in place!
  if (existingUnusedTab?.kind === "draft" && existingUnusedTab.draftId) {
    const existingDraftId = existingUnusedTab.draftId;
    const existingDraftSession = draftStore.getDraftSession(existingDraftId);
    const existingPromotedRedirect = draftStore.getPromotedDraftRedirect(existingDraftId);
    if (existingDraftSession && !existingDraftSession.promotedTo && !existingPromotedRedirect) {
      if (resolved.modelSelection) {
        draftStore.setModelSelection(existingDraftId, resolved.modelSelection, {
          explicit: true,
          replaceOptions: true,
        });
      }
      const tabId = useWorkspaceTabsStore.getState().openTab(
        {
          kind: "draft",
          title: agent.displayName,
          providerId: resolved.providerId,
          instanceId: resolved.instanceId,
          model: resolved.model,
          environmentId: existingDraftSession.environmentId,
          threadId: existingDraftSession.threadId,
          draftId: existingDraftId,
          reuseExisting: true,
          reuseUnusedDraftTabId: existingUnusedTab.id,
        },
        resolvedPaneId,
      );
      onNavigateToDraft(existingDraftId);
      return tabId;
    }
  }

  // Branch 2 & 3: Existing unused tab's draft expired/missing, or no unused draft tab exists yet.
  const resolvedProject = await resolveProjectRef();
  if (resolvedProject) {
    const { projectRef, fromScratch } = resolvedProject;
    const reuseTabId = existingUnusedTab?.id ?? null;
    const bindingToken = {};
    setPendingBinding?.({
      token: bindingToken,
      tabId: reuseTabId,
      ...(originRouteKey !== undefined ? { originRouteKey } : {}),
      title: agent.displayName,
      providerId: resolved.providerId,
      instanceId: resolved.instanceId,
      model: resolved.model,
    });
    try {
      const opened = await handleNewThread(projectRef, {
        forceNew: false,
        ...(fromScratch ? { envMode: "local" as const } : {}),
        ...(resolved.modelSelection ? { modelSelection: resolved.modelSelection } : {}),
      }).catch(() => null);

      if (opened) {
        if (resolved.modelSelection) {
          useComposerDraftStore
            .getState()
            .setModelSelection(opened.draftId, resolved.modelSelection, {
              explicit: true,
              replaceOptions: true,
            });
        }
        return useWorkspaceTabsStore.getState().openTab(
          {
            kind: "draft",
            title: agent.displayName,
            providerId: resolved.providerId,
            instanceId: resolved.instanceId,
            model: resolved.model,
            environmentId: projectRef.environmentId,
            threadId: opened.threadId,
            draftId: opened.draftId,
            reuseExisting: true,
            reuseUnusedDraftTabId: reuseTabId,
          },
          resolvedPaneId,
        );
      }
    } finally {
      if (getPendingBinding?.()?.token === bindingToken) {
        setPendingBinding?.(null);
      }
    }
  }

  onNavigateHome();
  return null;
}

/**
 * Creates a completely isolated draft session + workspace tab inside a secondary split pane.
 * Never mutates the primary pane's draft, global router target, or `stickyActiveProvider`,
 * so launching Codex / Claude / DSH in Pane B preserves Pane A's conversation & model 100%.
 */
export async function launchSecondaryPaneAgentDraft(input: {
  readonly agent: QuickLaunchAgentOption;
  readonly targetPaneId: string;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly resolveProjectRef: () => Promise<{
    readonly projectRef: ReturnType<typeof scopeProjectRef>;
    readonly fromScratch: boolean;
  } | null>;
}): Promise<{
  readonly tabId: string;
  readonly draftId: DraftId;
  readonly threadId: ThreadId;
} | null> {
  const { agent, targetPaneId, instanceEntries, resolveProjectRef } = input;
  const resolvedProject = await resolveProjectRef();
  if (!resolvedProject) return null;

  const { projectRef } = resolvedProject;
  const resolved = resolveQuickLaunchAgentTarget(agent, instanceEntries);
  const draftId = newDraftId();
  const threadId = newThreadId();
  const createdAt = new Date().toISOString();
  const paneScopedLogicalKey = `split:${targetPaneId}:${draftId}`;

  const draftStore = useComposerDraftStore.getState();
  draftStore.setLogicalProjectDraftThreadId(paneScopedLogicalKey, projectRef, draftId, {
    threadId,
    createdAt,
    branch: null,
    worktreePath: null,
    envMode: "local",
    preservePreviousDraft: true,
  });
  if (resolved.modelSelection) {
    draftStore.setModelSelection(draftId, resolved.modelSelection, {
      explicit: true,
      replaceOptions: true,
    });
  }

  const tabId = useWorkspaceTabsStore.getState().openTab(
    {
      kind: "draft",
      title: agent.displayName,
      providerId: resolved.providerId,
      instanceId: resolved.instanceId,
      model: resolved.model,
      environmentId: projectRef.environmentId,
      threadId,
      draftId,
      reuseExisting: false,
    },
    targetPaneId,
  );
  return { tabId, draftId, threadId };
}

const HIDDEN_SPLIT_OUTLET_PANE_CONTEXT = {
  inSplit: true,
  edges: ROOT_SPLIT_PANE_EDGES,
  paneId: null,
  isFocused: false,
  isPrimary: false,
} as const;

export interface WorkspaceSplitContainerProps {
  /** The primary Prismux route view (`ThreadRouteView` or `<Outlet />`), kept mounted in primary pane. */
  readonly primaryContent: ReactNode;
  readonly shownTarget: ThreadRouteTarget | null;
  readonly modalOpen: boolean;
}

/**
 * Orca-aligned thin split seam resize handle: writes pane flex styles directly during drag
 * (avoiding 60–120 store writes/sec) and commits the clamped ratio once on release.
 */
function SplitResizeHandle(props: {
  readonly splitId: string;
  readonly direction: SplitDirection;
  readonly ratio: number;
  readonly onCommitRatio: (splitId: string, ratio: number) => void;
  readonly onResetRatio: (splitId: string) => void;
  readonly onResizingChange: (resizing: boolean) => void;
}) {
  const { splitId, direction, ratio, onCommitRatio, onResetRatio, onResizingChange } = props;
  const isHorizontal = direction === "horizontal";
  const handleRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const handle = handleRef.current;
    const parent = handle?.parentElement;
    if (!handle || !parent) return;
    const firstPane = handle.previousElementSibling as HTMLElement | null;
    const secondPane = handle.nextElementSibling as HTMLElement | null;
    if (!firstPane || !secondPane) return;

    event.preventDefault();
    event.stopPropagation();
    setDragging(true);
    onResizingChange(true);
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Best-effort capture
    }

    let latestRatio: number | null = null;
    const computeRatio = (clientX: number, clientY: number): number => {
      const rect = parent.getBoundingClientRect();
      const total = isHorizontal ? rect.width : rect.height;
      const offset = isHorizontal ? clientX - rect.left : clientY - rect.top;
      return computeClampedSplitRatio(offset, total, { fallbackRatio: ratio });
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      if (moveEvent.buttons === 0) {
        cleanup();
        return;
      }
      const next = computeRatio(moveEvent.clientX, moveEvent.clientY);
      latestRatio = next;
      firstPane.style.flex = `${next} 1 0%`;
      secondPane.style.flex = `${1 - next} 1 0%`;
    };

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      setDragging(false);
      onResizingChange(false);
      if (latestRatio !== null) {
        onCommitRatio(splitId, latestRatio);
      }
      try {
        if (handle.hasPointerCapture(event.pointerId)) {
          handle.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Ignore
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", cleanup);
      window.removeEventListener("blur", cleanup);
    };

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      if (latestRatio !== null) {
        latestRatio = computeRatio(upEvent.clientX, upEvent.clientY);
      }
      cleanup();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cleanup);
    window.addEventListener("blur", cleanup);
  };

  const handleDoubleClick = () => {
    const handle = handleRef.current;
    const firstPane = handle?.previousElementSibling as HTMLElement | null;
    const secondPane = handle?.nextElementSibling as HTMLElement | null;
    if (firstPane && secondPane) {
      firstPane.style.flex = "0.5 1 0%";
      secondPane.style.flex = "0.5 1 0%";
    }
    onResetRatio(splitId);
  };

  return (
    <div
      ref={handleRef}
      role="separator"
      tabIndex={0}
      aria-orientation={isHorizontal ? "vertical" : "horizontal"}
      aria-label={isHorizontal ? "调整左右分屏比例" : "调整上下分屏比例"}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={18}
      aria-valuemax={82}
      data-workspace-split-resizer={splitId}
      data-direction={direction}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(event) => {
        const step = 0.04;
        if (isHorizontal && event.key === "ArrowLeft") {
          event.preventDefault();
          onCommitRatio(splitId, clampSplitRatio(ratio - step));
        } else if (isHorizontal && event.key === "ArrowRight") {
          event.preventDefault();
          onCommitRatio(splitId, clampSplitRatio(ratio + step));
        } else if (!isHorizontal && event.key === "ArrowUp") {
          event.preventDefault();
          onCommitRatio(splitId, clampSplitRatio(ratio - step));
        } else if (!isHorizontal && event.key === "ArrowDown") {
          event.preventDefault();
          onCommitRatio(splitId, clampSplitRatio(ratio + step));
        }
      }}
      className={cn(
        "group relative z-20 shrink-0 select-none bg-border/65 transition-colors hover:bg-primary/70 focus-visible:bg-primary focus-visible:outline-none",
        isHorizontal
          ? "w-px cursor-col-resize before:absolute before:inset-y-0 before:-inset-x-[3px] before:content-['']"
          : "h-px cursor-row-resize before:absolute before:inset-x-0 before:-inset-y-[3px] before:content-['']",
        dragging && "bg-primary",
      )}
    />
  );
}

/**
 * Flush zero-gap host for the primary Prismux route view directly beneath the unified single `WorkspaceTabBar`.
 * Avoids CSS Backdrop Roots (`contain` / `transform`) so Z-0 liquid glass samples cleanly.
 */
function PrimaryPaneBody(props: {
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        !props.active && "hidden",
      )}
    >
      {props.children}
    </div>
  );
}

export const WorkspaceSplitContainer = memo(function WorkspaceSplitContainer(
  props: WorkspaceSplitContainerProps,
) {
  const { primaryContent, shownTarget, modalOpen } = props;
  const navigate = useNavigate();

  const layout = useWorkspaceTabsStore((state) => state.layout);
  const panes = useWorkspaceTabsStore((state) => state.panes);
  const tabs = useWorkspaceTabsStore((state) => state.tabs);
  const focusedPaneId = useWorkspaceTabsStore((state) => state.focusedPaneId);
  const primaryPaneId = useWorkspaceTabsStore((state) => state.primaryPaneId);
  const activeDrag = useWorkspaceTabsStore((state) => state.activeDrag);
  const isResizingSplit = useWorkspaceTabsStore((state) => state.isResizingSplit);

  const [hoveredDrop, setHoveredDrop] = useState<{
    readonly paneId: string;
    readonly zone: SplitDropZone;
  } | null>(null);

  // Subscribe to cross-module `"prismux:split-drag"` events from SidebarThreadRow, RightPanelTabs,
  // ThreadTerminalDrawer, and WorkspaceTabBar so drop previews and WebView shields stay in sync.
  useEffect(() => {
    const onSplitDrag = (event: Event) => {
      const detail = (event as CustomEvent<SplitDragEventDetail>).detail;
      if (!detail) return;
      useWorkspaceTabsStore.getState().setActiveDrag(detail.active ? detail.payload : null);
      if (!detail.active) {
        setHoveredDrop(null);
      }
    };
    const clearDrag = () => {
      if (useWorkspaceTabsStore.getState().activeDrag !== null) {
        useWorkspaceTabsStore.getState().setActiveDrag(null);
      }
      setHoveredDrop(null);
    };
    window.addEventListener(PRISMUX_SPLIT_DRAG_EVENT, onSplitDrag);
    window.addEventListener("dragend", clearDrag);
    window.addEventListener("drop", clearDrag);
    return () => {
      window.removeEventListener(PRISMUX_SPLIT_DRAG_EVENT, onSplitDrag);
      window.removeEventListener("dragend", clearDrag);
      window.removeEventListener("drop", clearDrag);
    };
  }, []);

  const effectiveHoveredDrop = activeDrag !== null ? hoveredDrop : null;

  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const visibleThreads = useVisibleThreadShells();
  const environmentServerConfigs = useAtomValue(environmentServerConfigsAtom);
  const { defaultProjectRef, handleNewThread } = useHandleNewThread();
  const { scratchEnvironmentId, openScratchProject } = useScratchProject();
  const _clientSettings = useClientSettings((s) => s.confirmThreadDelete);
  void _clientSettings;

  // Unified single-topbar portal slot + fallback right-sidebar drawer when no thread is active
  const tabBarRef = useRef<HTMLDivElement | null>(null);
  const [workspaceLayoutElement, setWorkspaceLayoutElement] = useState<HTMLDivElement | null>(null);
  const [tabBarTopbarSlotElement, setTabBarTopbarSlotElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [dockTopbarSlotElement, setDockTopbarSlotElement] = useState<HTMLDivElement | null>(null);
  const [hasActiveChatControls, setHasActiveChatControls] = useState(false);
  const [activeChatProvider, setActiveChatProvider] =
    useState<WorkspaceActiveChatProviderSnapshot | null>(null);
  const [paneChatProviders, setPaneChatProviders] = useState<
    Readonly<Record<string, WorkspaceActiveChatProviderSnapshot>>
  >({});
  const [standaloneRightPanel, setStandaloneRightPanel] = useState<
    | { readonly kind: "agent-session"; readonly session: AgentSessionSurface }
    | { readonly kind: "wallpaper" }
    | null
  >(null);

  const prefersRightPanelSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const splitDockOpenStore = useRightPanelStore((state) => state.splitDockOpen);
  const splitDockMaximizedStore = useRightPanelStore((state) => state.splitDockMaximized);
  const splitGlobalWallpaperOpenStore = useRightPanelStore(
    (state) => state.splitGlobalWallpaperOpen,
  );

  const handleSetActiveChatProvider = useStableCallback(
    (next: WorkspaceActiveChatProviderSnapshot | null) => {
      setActiveChatProvider((current) => {
        if (current === next) return current;
        if (
          current &&
          next &&
          current.routeKey === next.routeKey &&
          current.instanceId === next.instanceId &&
          current.providerId === next.providerId &&
          current.model === next.model &&
          current.displayName === next.displayName
        ) {
          return current;
        }
        return next;
      });
    },
  );

  const handleSetPaneChatProvider = useStableCallback(
    (paneId: string, next: WorkspaceActiveChatProviderSnapshot | null) => {
      setPaneChatProviders((current) => {
        const existing = current[paneId] ?? null;
        if (existing === next) return current;
        if (
          existing &&
          next &&
          existing.routeKey === next.routeKey &&
          existing.instanceId === next.instanceId &&
          existing.providerId === next.providerId &&
          existing.model === next.model &&
          existing.displayName === next.displayName
        ) {
          return current;
        }
        if (next === null) {
          if (!(paneId in current)) return current;
          const copy = { ...current };
          delete copy[paneId];
          return copy;
        }
        return { ...current, [paneId]: next };
      });
    },
  );

  const paneCount = countLeafPanes(layout);
  const isSplitWorkspace = paneCount > 1;
  const anySplitDockOpen = splitDockOpenStore || splitGlobalWallpaperOpenStore;
  const splitDockInline = anySplitDockOpen && (!prefersRightPanelSheet || splitDockMaximizedStore);
  const dockOwnsTopRightSlot = isSplitWorkspace && splitDockInline;
  const splitDockMaximized = dockOwnsTopRightSlot && splitDockMaximizedStore;
  const topbarSlotElement = dockOwnsTopRightSlot
    ? dockTopbarSlotElement
    : tabBarTopbarSlotElement;

  // Resolve current route thread metadata for seamless Tab Bar sync
  const routeServerRef = shownTarget?.kind === "server" ? shownTarget.threadRef : null;
  const routeDraftId = shownTarget?.kind === "draft" ? shownTarget.draftId : null;
  const routeThreadShell = useQuietThreadShell(routeServerRef);
  const routeDraftSession = useComposerDraftStore((store) =>
    routeDraftId ? store.getDraftSession(routeDraftId) : null,
  );
  const routePromotedRedirect = useComposerDraftStore((store) =>
    routeDraftId ? store.getPromotedDraftRedirect(routeDraftId) : null,
  );
  const routeComposerDraft = useComposerDraftStore((store) =>
    shownTarget
      ? store.getComposerDraft(
          shownTarget.kind === "server" ? shownTarget.threadRef : shownTarget.draftId,
        )
      : null,
  );
  const stickyActiveProvider = useComposerDraftStore((store) => store.stickyActiveProvider);
  const stickyModelSelectionByProvider = useComposerDraftStore(
    (store) => store.stickyModelSelectionByProvider,
  );
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const promotedDraftRedirects = useComposerDraftStore((store) => store.promotedDraftRedirects);

  const activeEnvironmentId: EnvironmentId | null =
    routeServerRef?.environmentId ??
    routeDraftSession?.environmentId ??
    defaultProjectRef?.environmentId ??
    primaryEnvironmentId ??
    null;

  const activeProjectId =
    routeThreadShell?.projectId ??
    routeDraftSession?.projectId ??
    defaultProjectRef?.projectId ??
    null;

  const activeProject =
    activeEnvironmentId && activeProjectId
      ? (projects.find(
          (project) =>
            project.environmentId === activeEnvironmentId && project.id === activeProjectId,
        ) ?? null)
      : null;

  const activeHostThreadRef: ScopedThreadRef | null =
    routeServerRef ??
    (routeDraftSession
      ? scopeThreadRef(routeDraftSession.environmentId, routeDraftSession.threadId)
      : null);

  // Close standalone fallback drawer once a real thread mounts its native RightPanel.
  useEffect(() => {
    if (activeHostThreadRef && standaloneRightPanel) {
      setStandaloneRightPanel(null);
    }
  }, [activeHostThreadRef, standaloneRightPanel]);

  const toggleStandaloneWallpaper = useCallback(() => {
    setStandaloneRightPanel((current) =>
      current?.kind === "wallpaper" ? null : { kind: "wallpaper" },
    );
  }, []);

  const topbarPortalValue = useMemo<WorkspaceTopbarPortalContextValue>(
    () => ({
      managed: true,
      slotElement: topbarSlotElement,
      tabBarRef,
      setHasActiveChatControls,
      setActiveChatProvider: handleSetActiveChatProvider,
      setPaneChatProvider: handleSetPaneChatProvider,
      standaloneRightPanelOpen: Boolean(standaloneRightPanel && !activeHostThreadRef),
    }),
    [
      activeHostThreadRef,
      handleSetActiveChatProvider,
      handleSetPaneChatProvider,
      standaloneRightPanel,
      topbarSlotElement,
    ],
  );

  const openChiefSettings = useCallback(() => {
    void navigate({ to: "/settings/memory" as never });
  }, [navigate]);

  // Dynamic Provider instance entries + model options for Quick Launcher & Agent Blank Stage
  const providersByEnvironment = useEnvironmentProviders();
  const { activeProviders, activeServerSettings, instanceEntries, modelOptionsByInstance } =
    useMemo(() => {
      const serverConfig = activeEnvironmentId
        ? environmentServerConfigs.get(activeEnvironmentId)
        : [...environmentServerConfigs.values()][0];
      const liveProviders = activeEnvironmentId
        ? providersByEnvironment.get(activeEnvironmentId)
        : undefined;
      const providers =
        liveProviders && liveProviders.length > 0 ? liveProviders : (serverConfig?.providers ?? []);
      const settings = serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS;
      const entries: ReadonlyArray<ProviderInstanceEntry> = orderProviderInstanceEntries(
        providerInstanceEntriesFor(providers, settings, activeProjectId),
        settings.providerOrder,
      );
      const optionsMap = new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>();
      for (const entry of entries) {
        optionsMap.set(entry.instanceId, entry.models);
      }
      return {
        activeProviders: providers,
        activeServerSettings: settings,
        instanceEntries: entries,
        modelOptionsByInstance: optionsMap,
      };
    }, [activeEnvironmentId, activeProjectId, environmentServerConfigs, providersByEnvironment]);

  const projectNameByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) {
      map.set(`${project.environmentId}:${project.id}`, project.isScratch ? "无项目" : project.title);
    }
    return map;
  }, [projects]);

  const historyThreads = useMemo<ReadonlyArray<QuickLaunchHistoryThread>>(() => {
    return [...visibleThreads]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 40)
      .map((thread) => {
        const instanceId =
          thread.runtime?.providerInstanceId ??
          thread.modelSelection?.instanceId ??
          thread.providerInstanceId ??
          null;
        const entry = instanceId
          ? instanceEntries.find((candidate) => candidate.instanceId === instanceId)
          : undefined;
        return {
          environmentId: thread.environmentId,
          threadId: thread.id,
          title: thread.title || "未命名会话",
          projectName: projectNameByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null,
          providerId: entry ? resolveProviderBrandIdForEntry(entry) : instanceId,
          instanceId,
          updatedAt: thread.updatedAt,
        };
      });
  }, [instanceEntries, projectNameByKey, visibleThreads]);

  const quickLaunchAgents = useMemo(
    () =>
      buildQuickLaunchAgentOptions({
        instanceEntries,
        historyThreads,
        providerOrder: activeServerSettings.providerOrder,
      }),
    [activeServerSettings.providerOrder, historyThreads, instanceEntries],
  );

  // Sync active T3 route target into the primary workspace pane seamlessly
  const routeKey = shownTarget
    ? shownTarget.kind === "server"
      ? `server:${shownTarget.threadRef.environmentId}:${shownTarget.threadRef.threadId}`
      : `draft:${shownTarget.draftId}`
    : null;
  const lastSyncedRouteKeyRef = useRef<string | null>(null);
  const pendingDraftTabBindingRef = useRef<PendingDraftTabBinding | null>(null);

  // Deduplicate any legacy persisted duplicate unused draft/agent tabs on mount.
  useEffect(() => {
    useWorkspaceTabsStore.getState().pruneDuplicateDraftTabs({
      lookup: getLiveComposerDraftStateLookup(),
    });
  }, []);

  const routeProviderMetadata = resolveWorkspaceRouteProviderMetadata({
    shownTarget,
    routeKey,
    routeThreadShell,
    routeComposerDraft,
    stickyActiveProvider,
    stickyModelSelectionByProvider,
    providers: activeProviders,
    settings: activeServerSettings,
    instanceEntries,
    activeProject,
    activeProjectId,
    activeChatProvider,
  });

  const routeActiveProviderId = routeProviderMetadata.providerId;
  const routeActiveInstanceId = routeProviderMetadata.instanceId;
  const routeActiveModel = routeProviderMetadata.model;
  const routeDisplayTitle = routeProviderMetadata.title;

  // Keep open draft, blank agent, AND server thread tabs synchronized immediately when provider
  // settings (display name / brand / acpRegistry) or live server thread modelSelection changes.
  useEffect(() => {
    if (instanceEntries.length === 0 && visibleThreads.length === 0) return;
    const entryById = new Map(instanceEntries.map((entry) => [entry.instanceId, entry] as const));
    const threadByKey = new Map<string, (typeof visibleThreads)[number]>(
      visibleThreads.map((thread) => [`${thread.environmentId}:${thread.id}`, thread] as const),
    );
    const activeServerKey =
      shownTarget?.kind === "server"
        ? `${shownTarget.threadRef.environmentId}:${shownTarget.threadRef.threadId}`
        : null;
    const activeRouteHasLiveSnapshot = Boolean(
      activeServerKey && activeChatProvider && routeKey && activeChatProvider.routeKey === routeKey,
    );
    const store = useWorkspaceTabsStore.getState();
    for (const tab of Object.values(store.tabs)) {
      if ((tab.kind === "agent" || tab.kind === "draft") && tab.instanceId) {
        const entry = entryById.get(tab.instanceId);
        if (!entry) continue;
        const nextTitle = resolveProviderEntryDisplayName(entry);
        const nextProviderId = resolveProviderBrandIdForEntry(entry);
        const titleChanged = Boolean(nextTitle && tab.title !== nextTitle);
        const providerChanged = Boolean(nextProviderId && tab.providerId !== nextProviderId);
        if (titleChanged || providerChanged) {
          store.updateTab(tab.id, {
            ...(titleChanged ? { title: nextTitle } : {}),
            ...(providerChanged ? { providerId: nextProviderId } : {}),
          });
        }
        continue;
      }

      if (tab.kind === "thread" && tab.environmentId && tab.threadId) {
        const key = `${tab.environmentId}:${tab.threadId}`;
        const threadShell = threadByKey.get(key);
        const isCurrentActiveRouteWithLive =
          activeServerKey === key &&
          (activeRouteHasLiveSnapshot || routeComposerDraft?.modelSelectionExplicit === true);

        const nextTitle = threadShell?.title?.trim() || tab.title;
        const shellInstanceId =
          threadShell?.runtime?.providerInstanceId ??
          threadShell?.modelSelection?.instanceId ??
          threadShell?.providerInstanceId ??
          tab.instanceId ??
          null;
        const effectiveInstanceId = isCurrentActiveRouteWithLive
          ? (tab.instanceId ?? shellInstanceId)
          : shellInstanceId;
        const entry = effectiveInstanceId ? entryById.get(effectiveInstanceId) : undefined;
        const nextProviderId = entry
          ? resolveProviderBrandIdForEntry(entry)
          : effectiveInstanceId && effectiveInstanceId !== tab.instanceId
            ? effectiveInstanceId
            : (tab.providerId ?? null);
        const nextModel = isCurrentActiveRouteWithLive
          ? (tab.model ?? threadShell?.modelSelection?.model ?? null)
          : (threadShell?.modelSelection?.model ??
            (effectiveInstanceId !== tab.instanceId ? null : (tab.model ?? null)));

        const titleChanged = Boolean(nextTitle && tab.title !== nextTitle);
        const instanceChanged =
          !isCurrentActiveRouteWithLive &&
          effectiveInstanceId !== null &&
          tab.instanceId !== effectiveInstanceId;
        const providerChanged =
          !isCurrentActiveRouteWithLive &&
          nextProviderId !== null &&
          tab.providerId !== nextProviderId;
        const modelChanged =
          !isCurrentActiveRouteWithLive &&
          nextModel !== null &&
          tab.model !== nextModel;

        if (titleChanged || instanceChanged || providerChanged || modelChanged) {
          store.updateTab(tab.id, {
            ...(titleChanged ? { title: nextTitle } : {}),
            ...(instanceChanged ? { instanceId: effectiveInstanceId } : {}),
            ...(providerChanged ? { providerId: nextProviderId } : {}),
            ...(modelChanged ? { model: nextModel } : {}),
          });
        }
      }
    }
  }, [
    activeChatProvider,
    instanceEntries,
    routeComposerDraft?.modelSelectionExplicit,
    routeKey,
    shownTarget,
    visibleThreads,
  ]);

  // Sync each split pane's own live ChatView provider/model snapshot strictly onto that pane's
  // active tab without touching other panes or the global route tab.
  useEffect(() => {
    if (!isSplitWorkspace) return;
    const store = useWorkspaceTabsStore.getState();
    for (const [paneId, snapshot] of Object.entries(paneChatProviders)) {
      const pane = store.panes[paneId];
      if (!pane?.activeTabId) continue;
      const activeTab = store.tabs[pane.activeTabId];
      if (!activeTab) continue;
      const tabRouteKey =
        activeTab.kind === "thread" && activeTab.environmentId && activeTab.threadId
          ? `server:${activeTab.environmentId}:${activeTab.threadId}`
          : activeTab.kind === "draft" && activeTab.draftId
            ? `draft:${activeTab.draftId}`
            : null;
      if (!tabRouteKey || tabRouteKey !== snapshot.routeKey) continue;
      const nextProviderId = snapshot.providerId ?? activeTab.providerId ?? null;
      const nextInstanceId = snapshot.instanceId ?? activeTab.instanceId ?? null;
      const nextModel = snapshot.model ?? activeTab.model ?? null;
      const nextTitle =
        activeTab.kind === "draft" && snapshot.displayName?.trim()
          ? snapshot.displayName.trim()
          : activeTab.title;
      if (
        activeTab.providerId !== nextProviderId ||
        activeTab.instanceId !== nextInstanceId ||
        activeTab.model !== nextModel ||
        activeTab.title !== nextTitle
      ) {
        store.updateTab(activeTab.id, {
          providerId: nextProviderId,
          instanceId: nextInstanceId,
          model: nextModel,
          title: nextTitle,
        });
      }
    }
  }, [isSplitWorkspace, paneChatProviders]);

  useEffect(() => {
    if (!shownTarget || !routeKey) return;
    const isRouteChanged = lastSyncedRouteKeyRef.current !== routeKey;
    lastSyncedRouteKeyRef.current = routeKey;
    const { applied: pendingBinding, shouldClear } = resolvePendingDraftBindingForSync({
      shownTarget,
      routeKey,
      pendingBinding: pendingDraftTabBindingRef.current,
      routeComposerDraft,
      activeChatProvider,
    });
    if (shouldClear) {
      pendingDraftTabBindingRef.current = null;
    }
    const draftLookup = getLiveComposerDraftStateLookup();
    const reuseUnusedDraftTabId =
      shownTarget.kind === "draft"
        ? (pendingBinding?.tabId ??
          findPrimaryUnusedDraftTab(useWorkspaceTabsStore.getState(), draftLookup)?.id ??
          null)
        : null;
    const resolvedProviderId = pendingBinding?.providerId ?? routeActiveProviderId;
    const resolvedInstanceId = pendingBinding?.instanceId ?? routeActiveInstanceId;
    const resolvedModel = pendingBinding?.model ?? routeActiveModel;

    useWorkspaceTabsStore.getState().syncRouteTarget({
      target: shownTarget,
      title: pendingBinding?.title ?? routeDisplayTitle,
      ...(resolvedProviderId ? { providerId: resolvedProviderId } : {}),
      ...(resolvedInstanceId ? { instanceId: resolvedInstanceId } : {}),
      ...(resolvedModel ? { model: resolvedModel } : {}),
      environmentId:
        shownTarget.kind === "server"
          ? shownTarget.threadRef.environmentId
          : (routeDraftSession?.environmentId ?? null),
      threadId:
        shownTarget.kind === "server"
          ? shownTarget.threadRef.threadId
          : (routeDraftSession?.threadId ?? null),
      activate: isRouteChanged,
      reuseUnusedDraftTabId,
      draftLookup,
    });
  }, [
    activeChatProvider,
    routeActiveInstanceId,
    routeActiveModel,
    routeActiveProviderId,
    routeComposerDraft,
    routeDisplayTitle,
    routeDraftSession?.environmentId,
    routeDraftSession?.threadId,
    routeKey,
    shownTarget,
  ]);

  // Promote draft tabs in-place when T3 promotes a draft into a server thread (preserving full harness metadata)
  const promotedTarget = routeDraftSession?.promotedTo ?? routePromotedRedirect;
  useEffect(() => {
    if (routeDraftId && promotedTarget) {
      useWorkspaceTabsStore.getState().promoteDraftTab(routeDraftId, promotedTarget, {
        title: routeDisplayTitle,
        providerId: routeActiveProviderId,
        instanceId: routeActiveInstanceId,
        model: routeActiveModel,
      });
    }
  }, [
    promotedTarget,
    routeActiveInstanceId,
    routeActiveModel,
    routeActiveProviderId,
    routeDisplayTitle,
    routeDraftId,
  ]);

  // Reactively reconcile all draft tabs so promoted drafts merge immediately (zero zombie "新会话"
  // tabs waiting to be clicked) and orphan non-active draft tabs vanish after send errors.
  useEffect(() => {
    const entryById = new Map(instanceEntries.map((entry) => [entry.instanceId, entry] as const));
    const threadByKey = new Map<string, (typeof visibleThreads)[number]>(
      visibleThreads.map((thread) => [`${thread.environmentId}:${thread.id}`, thread] as const),
    );
    useWorkspaceTabsStore.getState().reconcileDraftTabs({
      activeRouteTarget: shownTarget,
      lookup: getLiveComposerDraftStateLookup(),
      resolveThreadMetadata: (threadRef) => {
        const shell = threadByKey.get(`${threadRef.environmentId}:${threadRef.threadId}`);
        if (!shell) return null;
        const instanceId =
          shell.runtime?.providerInstanceId ??
          shell.modelSelection?.instanceId ??
          shell.providerInstanceId ??
          null;
        const entry = instanceId ? entryById.get(instanceId) : undefined;
        return {
          title: shell.title?.trim() || undefined,
          providerId: entry ? resolveProviderBrandIdForEntry(entry) : instanceId,
          instanceId,
          model: shell.modelSelection?.model ?? null,
        };
      },
    });
  }, [
    draftThreadsByThreadKey,
    instanceEntries,
    promotedDraftRedirects,
    shownTarget,
    visibleThreads,
  ]);

  const openTabsList = useMemo<ReadonlyArray<QuickLaunchOpenTabMatch>>(() => {
    const list: QuickLaunchOpenTabMatch[] = [];
    for (const pane of Object.values(panes)) {
      for (const tabId of pane.tabIds) {
        const tab = tabs[tabId];
        if (tab) {
          list.push({ tab, paneId: pane.id });
        }
      }
    }
    return list;
  }, [panes, tabs]);

  const resolveProjectRefForMainLaunch = useCallback(async (): Promise<{
    readonly projectRef: ReturnType<typeof scopeProjectRef>;
    readonly fromScratch: boolean;
  } | null> => {
    const firstOpenProject = projects.find((project) => project.archivedAt == null);
    const direct =
      activeEnvironmentId && activeProjectId
        ? scopeProjectRef(activeEnvironmentId, activeProjectId)
        : (defaultProjectRef ??
          (firstOpenProject
            ? scopeProjectRef(firstOpenProject.environmentId, firstOpenProject.id)
            : null));
    if (direct) {
      return { projectRef: direct, fromScratch: false };
    }
    const scratchEnv = scratchEnvironmentId(activeEnvironmentId ?? primaryEnvironmentId);
    if (!scratchEnv) {
      return null;
    }
    const scratchProject = await openScratchProject(scratchEnv);
    if (!scratchProject) {
      return null;
    }
    return {
      projectRef: scopeProjectRef(scratchProject.environmentId, scratchProject.id),
      fromScratch: true,
    };
  }, [
    activeEnvironmentId,
    activeProjectId,
    defaultProjectRef,
    openScratchProject,
    primaryEnvironmentId,
    projects,
    scratchEnvironmentId,
  ]);

  const materializingTabIdsRef = useRef<Set<string>>(new Set());

  const materializePrimaryConversationTab = useCallback(
    async (tab: WorkspaceTab) => {
      if (materializingTabIdsRef.current.has(tab.id)) return;
      materializingTabIdsRef.current.add(tab.id);
      const bindingToken = {};
      try {
        const store = useWorkspaceTabsStore.getState();
        const primaryPane = store.panes[store.primaryPaneId];
        const tabStillInPrimary = Boolean(
          primaryPane?.tabIds.includes(tab.id) && store.tabs[tab.id],
        );
        const draftStore = useComposerDraftStore.getState();
        const draftLookup = getLiveComposerDraftStateLookup();
        const existingPrimaryUnused = findPrimaryUnusedDraftTab(
          store,
          draftLookup,
          tabStillInPrimary ? tab.id : null,
        );
        const targetReuseTabId = tabStillInPrimary
          ? tab.id
          : (existingPrimaryUnused?.id ?? null);

        const matchedEntry =
          (tab.instanceId
            ? instanceEntries.find((entry) => entry.instanceId === tab.instanceId)
            : undefined) ??
          (tab.providerId
            ? instanceEntries.find(
                (entry) =>
                  entry.enabled &&
                  (resolveProviderBrandIdForEntry(entry) === tab.providerId ||
                    entry.driverKind === tab.providerId ||
                    resolveAgentBrandId(resolveProviderBrandIdForEntry(entry)) ===
                      resolveAgentBrandId(tab.providerId) ||
                    formatAgentBrandName(entry.driverKind).toLowerCase() ===
                      formatAgentBrandName(tab.providerId).toLowerCase()),
              )
            : undefined) ??
          routeProviderMetadata.entry ??
          resolveComposerProviderSelection({
            entries: instanceEntries,
            candidateInstanceIds: [stickyActiveProvider],
            lockedProvider: null,
            lockedInstanceId: null,
          }).selectedProviderEntry ??
          instanceEntries.find((entry) => entry.enabled) ??
          instanceEntries[0] ??
          null;
        const resolvedModel =
          tab.model ??
          matchedEntry?.models.find((model) => model.isDefault && !model.isCustom)?.slug ??
          matchedEntry?.models.find((model) => !model.isCustom)?.slug ??
          matchedEntry?.models[0]?.slug ??
          (matchedEntry ? DEFAULT_MODEL_BY_PROVIDER[matchedEntry.driverKind] : null) ??
          null;
        const modelSelection =
          matchedEntry && resolvedModel
            ? createModelSelection(matchedEntry.instanceId, resolvedModel)
            : null;
        const resolvedProviderId = matchedEntry
          ? resolveProviderBrandIdForEntry(matchedEntry)
          : (tab.providerId ?? null);
        const resolvedInstanceId = matchedEntry?.instanceId ?? tab.instanceId ?? null;
        const resolvedTitle = matchedEntry
          ? resolveProviderEntryDisplayName(matchedEntry)
          : tab.providerId
            ? formatAgentBrandName(tab.providerId)
            : "新会话";

        // If another live unused draft tab already exists in the primary pane (e.g. handoff from
        // a secondary pane or duplicate legacy tab), reuse that live draft directly in-place.
        if (
          !tabStillInPrimary &&
          existingPrimaryUnused?.kind === "draft" &&
          existingPrimaryUnused.draftId
        ) {
          const liveDraftId = existingPrimaryUnused.draftId;
          const liveSession = draftStore.getDraftSession(liveDraftId);
          if (
            liveSession &&
            !liveSession.promotedTo &&
            !draftStore.getPromotedDraftRedirect(liveDraftId)
          ) {
            if (modelSelection) {
              draftStore.setModelSelection(liveDraftId, modelSelection, {
                explicit: true,
                replaceOptions: true,
              });
            }
            useWorkspaceTabsStore.getState().openTab(
              {
                kind: "draft",
                draftId: liveDraftId,
                environmentId: liveSession.environmentId,
                threadId: liveSession.threadId,
                providerId: resolvedProviderId,
                instanceId: resolvedInstanceId,
                model: resolvedModel,
                title: resolvedTitle,
                reuseExisting: true,
                reuseUnusedDraftTabId: existingPrimaryUnused.id,
              },
              store.primaryPaneId,
            );
            void navigate({
              to: "/draft/$draftId",
              params: buildDraftThreadRouteParams(liveDraftId),
            });
            return;
          }
        }

        const resolvedProject = await resolveProjectRefForMainLaunch();
        if (!resolvedProject) {
          if (tabStillInPrimary) {
            const latestStore = useWorkspaceTabsStore.getState();
            latestStore.closeTab(tab.id, latestStore.primaryPaneId);
          }
          void navigate({ to: "/" });
          return;
        }
        const { projectRef, fromScratch } = resolvedProject;
        pendingDraftTabBindingRef.current = {
          token: bindingToken,
          tabId: targetReuseTabId,
          originRouteKey: routeKey,
          title: resolvedTitle,
          providerId: resolvedProviderId,
          instanceId: resolvedInstanceId,
          model: resolvedModel,
        };
        const opened = await handleNewThread(projectRef, {
          forceNew: false,
          ...(fromScratch ? { envMode: "local" as const } : {}),
          ...(modelSelection ? { modelSelection } : {}),
        }).catch(() => null);
        if (!opened) {
          if (tabStillInPrimary) {
            const latestStore = useWorkspaceTabsStore.getState();
            latestStore.closeTab(tab.id, latestStore.primaryPaneId);
          }
          void navigate({ to: "/" });
          return;
        }
        if (modelSelection) {
          useComposerDraftStore.getState().setModelSelection(opened.draftId, modelSelection, {
            explicit: true,
            replaceOptions: true,
          });
        }
        const latestStore = useWorkspaceTabsStore.getState();
        latestStore.openTab(
          {
            kind: "draft",
            draftId: opened.draftId,
            environmentId: projectRef.environmentId,
            threadId: opened.threadId,
            providerId: resolvedProviderId,
            instanceId: resolvedInstanceId,
            model: resolvedModel,
            title: resolvedTitle,
            reuseExisting: true,
            reuseUnusedDraftTabId: targetReuseTabId,
          },
          latestStore.primaryPaneId,
        );
      } finally {
        if (pendingDraftTabBindingRef.current?.token === bindingToken) {
          pendingDraftTabBindingRef.current = null;
        }
        materializingTabIdsRef.current.delete(tab.id);
      }
    },
    [
      handleNewThread,
      instanceEntries,
      navigate,
      resolveProjectRefForMainLaunch,
      routeKey,
      routeProviderMetadata.entry,
      stickyActiveProvider,
    ],
  );

  // Auto-upgrade any legacy/orphaned "agent" tab active in the primary pane into a full ChatView draft.
  const primaryActiveTab = panes[primaryPaneId]?.activeTabId
    ? (tabs[panes[primaryPaneId]!.activeTabId!] ?? null)
    : null;
  useEffect(() => {
    if (primaryActiveTab?.kind === "agent") {
      void materializePrimaryConversationTab(primaryActiveTab);
    }
  }, [materializePrimaryConversationTab, primaryActiveTab]);

  const navigateToTabIfPrimaryRoute = useCallback(
    (paneId: string, tab: WorkspaceTab | undefined) => {
      if (!tab || paneId !== useWorkspaceTabsStore.getState().primaryPaneId) return;
      if (tab.kind === "thread" && tab.environmentId && tab.threadId) {
        if (
          !modalOpen &&
          shownTarget?.kind === "server" &&
          shownTarget.threadRef.environmentId === tab.environmentId &&
          shownTarget.threadRef.threadId === tab.threadId
        ) {
          return;
        }
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(tab.environmentId, tab.threadId)),
        });
      } else if (tab.kind === "draft" && tab.draftId) {
        const draftStore = useComposerDraftStore.getState();
        const promotedRedirect = draftStore.getPromotedDraftRedirect(tab.draftId);
        const draftSession = draftStore.getDraftSession(tab.draftId);
        const promotedRef = promotedRedirect ?? draftSession?.promotedTo ?? null;
        if (promotedRef) {
          const promotedShell = visibleThreads.find(
            (candidate) =>
              candidate.environmentId === promotedRef.environmentId &&
              candidate.id === promotedRef.threadId,
          );
          const promotedInstanceId =
            promotedShell?.runtime?.providerInstanceId ??
            promotedShell?.modelSelection?.instanceId ??
            promotedShell?.providerInstanceId ??
            tab.instanceId ??
            null;
          const promotedEntry = promotedInstanceId
            ? instanceEntries.find((candidate) => candidate.instanceId === promotedInstanceId)
            : undefined;
          useWorkspaceTabsStore.getState().promoteDraftTab(tab.draftId, promotedRef, {
            title: promotedShell?.title?.trim() || undefined,
            providerId: promotedEntry
              ? resolveProviderBrandIdForEntry(promotedEntry)
              : (promotedInstanceId ?? tab.providerId ?? null),
            instanceId: promotedInstanceId,
            model: promotedShell?.modelSelection?.model ?? tab.model ?? null,
          });
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(promotedRef),
          });
          return;
        }
        if (draftSession) {
          if (!modalOpen && shownTarget?.kind === "draft" && shownTarget.draftId === tab.draftId) {
            return;
          }
          void navigate({
            to: "/draft/$draftId",
            params: buildDraftThreadRouteParams(tab.draftId),
          });
          return;
        }
        // Draft was pruned across reload; re-materialize in-place onto this same tab ID.
        void materializePrimaryConversationTab(tab);
      } else if (tab.kind === "agent" || (tab.kind === "draft" && !tab.draftId)) {
        void materializePrimaryConversationTab(tab);
      }
    },
    [
      instanceEntries,
      materializePrimaryConversationTab,
      modalOpen,
      navigate,
      shownTarget,
      visibleThreads,
    ],
  );

  const handleActivateTab = useCallback(
    (paneId: string, tabId: string) => {
      const store = useWorkspaceTabsStore.getState();
      store.activateTab(paneId, tabId);
      navigateToTabIfPrimaryRoute(paneId, useWorkspaceTabsStore.getState().tabs[tabId]);
    },
    [navigateToTabIfPrimaryRoute],
  );

  const handleCloseTab = useCallback(
    (paneId: string, tabId: string) => {
      const store = useWorkspaceTabsStore.getState();
      const prevActiveTabId = store.panes[paneId]?.activeTabId ?? null;
      store.closeTab(tabId, paneId);
      const after = useWorkspaceTabsStore.getState();
      const paneAfter = after.panes[paneId];
      if (
        paneAfter &&
        paneAfter.id === after.primaryPaneId &&
        paneAfter.activeTabId &&
        paneAfter.activeTabId !== prevActiveTabId
      ) {
        navigateToTabIfPrimaryRoute(paneAfter.id, after.tabs[paneAfter.activeTabId]);
      }
    },
    [navigateToTabIfPrimaryRoute],
  );

  const openAgentInRightSidebar = useCallback(
    (agent: QuickLaunchAgentOption) => {
      const resolved = resolveQuickLaunchAgentTarget(agent, instanceEntries);
      if (activeHostThreadRef) {
        useRightPanelStore.getState().openAgentSession(activeHostThreadRef, {
          title: agent.displayName,
          providerId: resolved.providerId,
          instanceId: resolved.instanceId,
          model: resolved.model,
        });
        return;
      }

      // Empty workspace (no active thread yet): open a matching right-sidebar drawer smoothly
      // without splitting or replacing the main stage with a blank pseudo-pane.
      setStandaloneRightPanel({
        kind: "agent-session",
        session: {
          id: `agent-session:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          kind: "agent-session",
          title: agent.displayName,
          providerId: resolved.providerId,
          instanceId: resolved.instanceId,
          model: resolved.model,
        },
      });
    },
    [activeHostThreadRef, instanceEntries],
  );

  const launchAgentInPane = useCallback(
    async (agent: QuickLaunchAgentOption, targetPaneId: string) => {
      const store = useWorkspaceTabsStore.getState();
      const resolvedPaneId =
        targetPaneId && store.panes[targetPaneId] ? targetPaneId : store.primaryPaneId;

      // Secondary split panes create their own isolated draft session & tab directly inside the pane
      // without touching Pane A's route, draft, or provider/model selection.
      if (resolvedPaneId !== store.primaryPaneId) {
        const created = await launchSecondaryPaneAgentDraft({
          agent,
          targetPaneId: resolvedPaneId,
          instanceEntries,
          resolveProjectRef: resolveProjectRefForMainLaunch,
        });
        if (!created) {
          openAgentInRightSidebar(agent);
        }
        return;
      }

      await launchPrimaryAgentDraft({
        agent,
        resolvedPaneId,
        instanceEntries,
        resolveProjectRef: resolveProjectRefForMainLaunch,
        handleNewThread,
        onNavigateToDraft: (draftId) => {
          if (!modalOpen && shownTarget?.kind === "draft" && shownTarget.draftId === draftId) {
            return;
          }
          void navigate({
            to: "/draft/$draftId",
            params: buildDraftThreadRouteParams(draftId),
          });
        },
        onNavigateHome: () => {
          void navigate({ to: "/" });
        },
        originRouteKey: routeKey,
        setPendingBinding: (binding) => {
          pendingDraftTabBindingRef.current = binding;
        },
        getPendingBinding: () => pendingDraftTabBindingRef.current,
      });
    },
    [
      handleNewThread,
      instanceEntries,
      modalOpen,
      navigate,
      openAgentInRightSidebar,
      resolveProjectRefForMainLaunch,
      routeKey,
      shownTarget,
    ],
  );

  const handleOpenHistoryThread = useCallback(
    (thread: QuickLaunchHistoryThread, targetPaneId: string) => {
      const store = useWorkspaceTabsStore.getState();
      if (targetPaneId === store.primaryPaneId) {
        store.openTab(
          {
            kind: "thread",
            title: thread.title,
            providerId: thread.providerId ?? null,
            instanceId: thread.instanceId ?? null,
            environmentId: thread.environmentId,
            threadId: thread.threadId,
          },
          targetPaneId,
        );
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.threadId)),
        });
        return;
      }

      // Secondary split panes host the thread live inline via EmbeddedThreadPaneView (ChatView).
      store.openTab(
        {
          kind: "thread",
          title: thread.title,
          providerId: thread.providerId ?? null,
          instanceId: thread.instanceId ?? null,
          environmentId: thread.environmentId,
          threadId: thread.threadId,
          hostThreadRef: scopeThreadRef(thread.environmentId, thread.threadId),
          reuseExisting: false,
        },
        targetPaneId,
      );
    },
    [navigate],
  );

  const handleRunQuickTool = useCallback(
    (toolId: QuickLaunchToolId, targetPaneId: string) => {
      if (toolId === "settings") {
        void navigate({ to: "/settings" });
        return;
      }
      const store = useWorkspaceTabsStore.getState();
      const openInsidePane =
        targetPaneId !== store.primaryPaneId || countLeafPanes(store.layout) > 1;

      if (activeHostThreadRef && !openInsidePane) {
        const rightPanel = useRightPanelStore.getState();
        switch (toolId) {
          case "terminal":
            rightPanel.openTerminal(
              activeHostThreadRef,
              `ws-term-${Date.now().toString(36)}`,
            );
            return;
          case "diff":
            rightPanel.open(activeHostThreadRef, "diff");
            return;
          case "browser":
            rightPanel.setMobileSimulatorIdleActive(false);
            rightPanel.openBrowser(activeHostThreadRef, null);
            return;
          case "simulator":
            rightPanel.requestMobileSimulatorLaunch();
            rightPanel.open(activeHostThreadRef, "preview");
            return;
        }
      }

      switch (toolId) {
        case "terminal":
          store.openTab(
            {
              kind: "terminal",
              title: "",
              shell: "PowerShell",
              hostThreadRef: activeHostThreadRef,
              reuseExisting: false,
            },
            targetPaneId,
          );
          return;
        case "diff":
          store.openTab(
            {
              kind: "diff",
              title: "差异",
              hostThreadRef: activeHostThreadRef,
              environmentId: activeHostThreadRef?.environmentId ?? null,
              threadId: activeHostThreadRef?.threadId ?? null,
              reuseExisting: false,
            },
            targetPaneId,
          );
          return;
        case "browser":
          store.openTab(
            {
              kind: "browser",
              title: "内置浏览器",
              hostThreadRef: activeHostThreadRef,
              reuseExisting: false,
            },
            targetPaneId,
          );
          return;
        case "simulator":
          store.openTab(
            {
              kind: "simulator",
              title: "手机模拟器",
              hostThreadRef: activeHostThreadRef,
              reuseExisting: false,
            },
            targetPaneId,
          );
          return;
      }
    },
    [activeHostThreadRef, navigate],
  );

  const handleOpenUrl = useCallback(
    (url: string, targetPaneId: string) => {
      let host = url;
      try {
        host = new URL(url).host || url;
      } catch {
        // Keep raw URL as label
      }
      useWorkspaceTabsStore.getState().openTab(
        {
          kind: "browser",
          title: host,
          url,
          hostThreadRef: activeHostThreadRef,
          reuseExisting: false,
        },
        targetPaneId,
      );
    },
    [activeHostThreadRef],
  );

  const handleSplitPane = useCallback(
    (paneId: string, direction: SplitDirection) => {
      const store = useWorkspaceTabsStore.getState();
      if (countLeafPanes(store.layout) >= WORKSPACE_MAX_SPLIT_PANES) {
        return;
      }
      const sourcePane = store.panes[paneId];
      const sourceActiveTab = sourcePane?.activeTabId ? store.tabs[sourcePane.activeTabId] : null;

      let initialTab: OpenWorkspaceTabInput;
      if (direction === "vertical") {
        initialTab = {
          kind: "terminal",
          title: "",
          shell: "PowerShell",
          hostThreadRef: activeHostThreadRef,
          reuseExisting: false,
        };
      } else {
        const alternateThread = historyThreads.find(
          (candidate) =>
            !(
              sourceActiveTab?.environmentId === candidate.environmentId &&
              sourceActiveTab?.threadId === candidate.threadId
            ),
        );
        if (alternateThread) {
          initialTab = {
            kind: "thread",
            title: alternateThread.title,
            providerId: alternateThread.providerId ?? null,
            instanceId: alternateThread.instanceId ?? null,
            environmentId: alternateThread.environmentId,
            threadId: alternateThread.threadId,
            hostThreadRef: scopeThreadRef(alternateThread.environmentId, alternateThread.threadId),
            reuseExisting: false,
          };
        } else if (activeHostThreadRef) {
          initialTab = {
            kind: "diff",
            title: "差异",
            hostThreadRef: activeHostThreadRef,
            environmentId: activeHostThreadRef.environmentId,
            threadId: activeHostThreadRef.threadId,
            reuseExisting: false,
          };
        } else {
          initialTab = {
            kind: "terminal",
            title: "",
            shell: "PowerShell",
            hostThreadRef: null,
            reuseExisting: false,
          };
        }
      }

      store.splitPane(paneId, direction, initialTab, "after");
    },
    [activeHostThreadRef, historyThreads],
  );

  const handleLaunchAgentInSplit = useCallback(
    (agent: QuickLaunchAgentOption, fromPaneId: string) => {
      const store = useWorkspaceTabsStore.getState();
      const targetPaneId = store.panes[fromPaneId] ? fromPaneId : store.focusedPaneId;
      if (countLeafPanes(store.layout) >= WORKSPACE_MAX_SPLIT_PANES) {
        openAgentInRightSidebar(agent);
        return;
      }
      const resolved = resolveQuickLaunchAgentTarget(agent, instanceEntries);
      const recentThread = agent.recentThreads[0];
      if (recentThread) {
        store.splitPane(
          targetPaneId,
          "horizontal",
          {
            kind: "thread",
            title: recentThread.title,
            providerId: recentThread.providerId ?? resolved.providerId,
            instanceId: recentThread.instanceId ?? resolved.instanceId,
            environmentId: recentThread.environmentId,
            threadId: recentThread.threadId,
            hostThreadRef: scopeThreadRef(recentThread.environmentId, recentThread.threadId),
            reuseExisting: false,
          },
          "after",
        );
        return;
      }
      void (async () => {
        const resolvedProject = await resolveProjectRefForMainLaunch();
        const latestStore = useWorkspaceTabsStore.getState();
        if (resolvedProject && countLeafPanes(latestStore.layout) < WORKSPACE_MAX_SPLIT_PANES) {
          const { projectRef } = resolvedProject;
          const draftId = newDraftId();
          const threadId = newThreadId();
          const createdAt = new Date().toISOString();
          const draftStore = useComposerDraftStore.getState();
          draftStore.setLogicalProjectDraftThreadId(
            `split:new:${draftId}`,
            projectRef,
            draftId,
            {
              threadId,
              createdAt,
              branch: null,
              worktreePath: null,
              envMode: "local",
              preservePreviousDraft: true,
            },
          );
          if (resolved.modelSelection) {
            draftStore.setModelSelection(draftId, resolved.modelSelection, {
              explicit: true,
              replaceOptions: true,
            });
          }
          latestStore.splitPane(
            targetPaneId,
            "horizontal",
            {
              kind: "draft",
              title: agent.displayName,
              providerId: resolved.providerId,
              instanceId: resolved.instanceId,
              model: resolved.model,
              environmentId: projectRef.environmentId,
              threadId,
              draftId,
              reuseExisting: false,
            },
            "after",
          );
          return;
        }
        latestStore.splitPane(
          targetPaneId,
          "horizontal",
          {
            kind: "agent",
            title: agent.displayName,
            providerId: resolved.providerId,
            instanceId: resolved.instanceId,
            model: resolved.model,
            hostThreadRef: activeHostThreadRef,
            reuseExisting: false,
          },
          "after",
        );
      })();
    },
    [
      activeHostThreadRef,
      instanceEntries,
      openAgentInRightSidebar,
      resolveProjectRefForMainLaunch,
    ],
  );

  const handleDropItemIntoPane = useCallback(
    (payload: SplitDragPayload, targetPaneId: string, zone: SplitDropZone) => {
      setHoveredDrop(null);
      const beforePrimaryActiveTabId =
        useWorkspaceTabsStore.getState().panes[useWorkspaceTabsStore.getState().primaryPaneId]
          ?.activeTabId ?? null;
      const result = useWorkspaceTabsStore
        .getState()
        .dropItemIntoPane(payload, targetPaneId, zone, {
          fallbackHostThreadRef: activeHostThreadRef,
        });
      dispatchSplitDragEvent(false, null);
      if (result) {
        const after = useWorkspaceTabsStore.getState();
        const afterPrimaryPane = after.panes[after.primaryPaneId];
        const afterPrimaryActiveTabId = afterPrimaryPane?.activeTabId ?? null;
        if (result.paneId === after.primaryPaneId) {
          navigateToTabIfPrimaryRoute(result.paneId, after.tabs[result.tabId]);
        } else if (
          afterPrimaryActiveTabId &&
          afterPrimaryActiveTabId !== beforePrimaryActiveTabId
        ) {
          navigateToTabIfPrimaryRoute(
            after.primaryPaneId,
            after.tabs[afterPrimaryActiveTabId],
          );
        }
      }
    },
    [activeHostThreadRef, navigateToTabIfPrimaryRoute],
  );

  const handleLaunchAgentPrompt = useCallback(
    async (input: {
      readonly paneId: string;
      readonly tabId: string;
      readonly providerId: string;
      readonly instanceId: ProviderInstanceId | null;
      readonly model: string | null;
      readonly prompt: string;
    }) => {
      const resolvedProject = await resolveProjectRefForMainLaunch();
      if (!resolvedProject) return;
      const { projectRef, fromScratch } = resolvedProject;
      const modelSelection =
        input.instanceId && input.model
          ? createModelSelection(input.instanceId, input.model)
          : null;
      const matchedEntry = input.instanceId
        ? instanceEntries.find((candidate) => candidate.instanceId === input.instanceId)
        : undefined;
      const resolvedTitle = matchedEntry
        ? resolveProviderEntryDisplayName(matchedEntry)
        : formatAgentBrandName(input.providerId);
      const store = useWorkspaceTabsStore.getState();
      const primaryPane = store.panes[store.primaryPaneId];
      const reuseTabId = primaryPane?.tabIds.includes(input.tabId)
        ? input.tabId
        : (findPrimaryUnusedDraftTab(store, getLiveComposerDraftStateLookup())?.id ?? null);
      const resolvedProviderId = matchedEntry
        ? resolveProviderBrandIdForEntry(matchedEntry)
        : input.providerId;
      const bindingToken = {};
      pendingDraftTabBindingRef.current = {
        token: bindingToken,
        tabId: reuseTabId,
        originRouteKey: routeKey,
        title: resolvedTitle,
        providerId: resolvedProviderId,
        instanceId: input.instanceId,
        model: input.model,
      };
      try {
        const opened = await handleNewThread(projectRef, {
          forceNew: false,
          prompt: input.prompt,
          ...(fromScratch ? { envMode: "local" as const } : {}),
          ...(modelSelection ? { modelSelection } : {}),
        });
        if (opened) {
          if (modelSelection) {
            useComposerDraftStore.getState().setModelSelection(opened.draftId, modelSelection, {
              explicit: true,
              replaceOptions: true,
            });
          }
          const latestStore = useWorkspaceTabsStore.getState();
          latestStore.openTab(
            {
              kind: "draft",
              draftId: opened.draftId,
              environmentId: projectRef.environmentId,
              threadId: opened.threadId,
              providerId: resolvedProviderId,
              instanceId: input.instanceId,
              model: input.model,
              title: resolvedTitle,
              reuseExisting: true,
              reuseUnusedDraftTabId: reuseTabId,
            },
            latestStore.primaryPaneId,
          );
        }
      } finally {
        if (pendingDraftTabBindingRef.current?.token === bindingToken) {
          pendingDraftTabBindingRef.current = null;
        }
      }
    },
    [handleNewThread, instanceEntries, resolveProjectRefForMainLaunch, routeKey],
  );

  const allLeafIds = useMemo(() => listLeafPaneIds(layout), [layout]);

  const liveDraftSessionLookup = useMemo<WorkspaceDraftSessionLookup>(() => {
    const base = getLiveComposerDraftStateLookup();
    return {
      ...base,
      getDraftSessionWithCoords: (draftId) => {
        const session = useComposerDraftStore.getState().getDraftSession(draftId);
        return session
          ? {
              environmentId: session.environmentId,
              threadId: session.threadId,
              promotedTo: session.promotedTo ?? null,
            }
          : null;
      },
    };
  }, [draftThreadsByThreadKey, promotedDraftRedirects]);

  const routeOwnership = useMemo(
    () =>
      resolveSplitRouteOwnership({
        layout,
        panes,
        tabs,
        primaryPaneId,
        focusedPaneId,
        shownTarget,
        modalOpen,
        draftLookup: liveDraftSessionLookup,
      }),
    [
      focusedPaneId,
      layout,
      liveDraftSessionLookup,
      modalOpen,
      panes,
      primaryPaneId,
      shownTarget,
      tabs,
    ],
  );

  const focusedSplitContext = useMemo(
    () =>
      resolveFocusedSplitRightPanelContext({
        layout,
        panes,
        tabs,
        focusedPaneId,
        primaryPaneId,
        draftLookup: liveDraftSessionLookup,
      }),
    [focusedPaneId, layout, liveDraftSessionLookup, panes, primaryPaneId, tabs],
  );

  const paneOverviewOpenByPaneId = useRightPanelStore((state) => state.paneOverviewOpenByPaneId);
  const threadPanelVisibilityByThreadKey = useRightPanelStore(
    (state) => state.threadPanelVisibilityByThreadKey,
  );

  const handleFocusPane = useStableCallback((paneId: string) => {
    useWorkspaceTabsStore.getState().focusPane(paneId);
  });

  const handleTogglePaneOverview = useStableCallback((paneId: string) => {
    useRightPanelStore.getState().togglePaneOverview(paneId, true);
  });

  const handleClosePane = useStableCallback((id: string) => {
    const before = useWorkspaceTabsStore.getState();
    const beforePrimaryActiveTabId = before.panes[before.primaryPaneId]?.activeTabId ?? null;
    before.closePane(id, { mergeTabs: true });
    useRightPanelStore.getState().clearPaneOverview(id);
    const after = useWorkspaceTabsStore.getState();
    const afterPrimaryActiveTabId = after.panes[after.primaryPaneId]?.activeTabId ?? null;
    if (afterPrimaryActiveTabId && afterPrimaryActiveTabId !== beforePrimaryActiveTabId) {
      navigateToTabIfPrimaryRoute(after.primaryPaneId, after.tabs[afterPrimaryActiveTabId]);
    }
  });

  const handleMoveTabToPane = useStableCallback(
    (tabId: string, fromPaneId: string, toPaneId: string, insertIndex?: number) => {
      const before = useWorkspaceTabsStore.getState();
      const beforePrimaryActiveTabId = before.panes[before.primaryPaneId]?.activeTabId ?? null;
      before.moveTabToPane(tabId, fromPaneId, toPaneId, insertIndex);
      const after = useWorkspaceTabsStore.getState();
      const afterPrimaryActiveTabId = after.panes[after.primaryPaneId]?.activeTabId ?? null;
      if (afterPrimaryActiveTabId && afterPrimaryActiveTabId !== beforePrimaryActiveTabId) {
        navigateToTabIfPrimaryRoute(after.primaryPaneId, after.tabs[afterPrimaryActiveTabId]);
      }
    },
  );

  const newTabPopoverBase = useMemo(
    () => ({
      openTabs: openTabsList,
      historyThreads,
      agents: quickLaunchAgents,
      onActivateOpenTab: handleActivateTab,
      onOpenHistoryThread: handleOpenHistoryThread,
      onLaunchAgent: (agent: QuickLaunchAgentOption, targetPaneId: string) => {
        void launchAgentInPane(agent, targetPaneId);
      },
      onLaunchAgentInSplit: handleLaunchAgentInSplit,
      onRunQuickTool: handleRunQuickTool,
      onOpenUrl: handleOpenUrl,
      onOpenAgentSettings: () => {
        void navigate({ to: "/settings/providers" });
      },
    }),
    [
      handleActivateTab,
      handleLaunchAgentInSplit,
      handleOpenHistoryThread,
      handleOpenUrl,
      handleRunQuickTool,
      historyThreads,
      launchAgentInPane,
      navigate,
      openTabsList,
      quickLaunchAgents,
    ],
  );

  const computeDropZoneForEvent = (
    paneId: string,
    event: ReactDragEvent<HTMLDivElement>,
    dragPayload: SplitDragPayload | null,
  ): SplitDropZone => {
    const rect = event.currentTarget.getBoundingClientRect();
    const isSingleTabSelfDrag =
      dragPayload?.kind === "pane-tab" &&
      dragPayload.fromPaneId === paneId &&
      (panes[paneId]?.tabIds.length ?? 0) <= 1;
    return resolvePaneDropZone(rect, event.clientX, event.clientY, {
      paneCount,
      maxSplitPanes: WORKSPACE_MAX_SPLIT_PANES,
      isSingleTabSelfDrag,
    });
  };

  const handlePaneBodyDragOver = (
    paneId: string,
    event: ReactDragEvent<HTMLDivElement>,
  ) => {
    const dragPayload = useWorkspaceTabsStore.getState().activeDrag;
    if (!dragPayload && !hasSplitDragMime(event.dataTransfer.types)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const zone = computeDropZoneForEvent(paneId, event, dragPayload);
    setHoveredDrop((current) =>
      current && current.paneId === paneId && current.zone === zone
        ? current
        : { paneId, zone },
    );
  };

  const handlePaneBodyDragLeave = (
    paneId: string,
    event: ReactDragEvent<HTMLDivElement>,
  ) => {
    const related = event.relatedTarget as Node | null;
    if (related && event.currentTarget.contains(related)) {
      return;
    }
    setHoveredDrop((current) => (current?.paneId === paneId ? null : current));
  };

  const handlePaneBodyDrop = (
    paneId: string,
    event: ReactDragEvent<HTMLDivElement>,
  ) => {
    const payload =
      readSplitDragDataTransfer(event.dataTransfer) ??
      useWorkspaceTabsStore.getState().activeDrag;
    if (!payload) {
      setHoveredDrop(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const zone = computeDropZoneForEvent(paneId, event, payload);
    handleDropItemIntoPane(payload, paneId, zone);
  };

  const renderNode = (
    node: WorkspaceSplitLayoutNode,
    edges: SplitPaneEdges,
    parentSplitId: string | null = null,
  ): ReactNode => {
    if (node.type === "split") {
      const isHorizontal = node.direction === "horizontal";
      const childEdges = deriveChildSplitEdges(edges, node.direction);
      return (
        <div
          key={node.id}
          data-workspace-split={node.id}
          data-split-direction={node.direction}
          className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-none"
          style={{ flexDirection: isHorizontal ? "row" : "column" }}
        >
          <div
            className="flex min-h-0 min-w-0 overflow-hidden rounded-none"
            style={{ flex: `${node.ratio} 1 0%` }}
          >
            {renderNode(node.first, childEdges.first, node.id)}
          </div>
          <SplitResizeHandle
            splitId={node.id}
            direction={node.direction}
            ratio={node.ratio}
            onCommitRatio={(splitId, nextRatio) =>
              useWorkspaceTabsStore.getState().setSplitRatio(splitId, nextRatio)
            }
            onResetRatio={(splitId) =>
              useWorkspaceTabsStore.getState().resetSplitRatio(splitId)
            }
            onResizingChange={(resizing) =>
              useWorkspaceTabsStore.getState().setIsResizingSplit(resizing)
            }
          />
          <div
            className="flex min-h-0 min-w-0 overflow-hidden rounded-none"
            style={{ flex: `${1 - node.ratio} 1 0%` }}
          >
            {renderNode(node.second, childEdges.second, node.id)}
          </div>
        </div>
      );
    }

    const pane = panes[node.paneId];
    if (!pane) return null;
    const paneTabs = pane.tabIds
      .map((id) => tabs[id])
      .filter((tab): tab is WorkspaceTab => Boolean(tab));
    const activeTab = pane.activeTabId ? (tabs[pane.activeTabId] ?? null) : null;
    const isPrimaryPane = pane.id === primaryPaneId;
    const isFocused = pane.id === focusedPaneId;
    const isSplit = paneCount > 1;
    const otherPaneIds = allLeafIds.filter((id) => id !== pane.id);
    const paneDropZone =
      effectiveHoveredDrop?.paneId === pane.id ? effectiveHoveredDrop.zone : null;

    // Strictly decide whether THIS pane hosts `primaryContent` (single-pane preserves 100% legacy
    // behavior including `activeTab.kind === "agent"`; split view binds `primaryContent` ONLY to
    // the single pane whose active tab matches `shownTarget`, preventing any cross-pane mirroring).
    const paneOwnsRoute = routeOwnership.routeOwnerPaneId === pane.id;
    const primaryShowsRoute = paneOwnsRoute && routeOwnership.ownerShowsRoute;
    const paneConversationActive =
      isSplit &&
      (isWorkspaceConversationTab(activeTab) ||
        (primaryShowsRoute && activeTab?.kind === "agent"));
    const paneThreadRef =
      activeTab?.kind === "thread" && activeTab.environmentId && activeTab.threadId
        ? scopeThreadRef(activeTab.environmentId, activeTab.threadId)
        : null;
    const paneOverviewOpen = selectPaneOverviewOpen(
      paneOverviewOpenByPaneId,
      threadPanelVisibilityByThreadKey,
      pane.id,
      paneThreadRef,
      isSplit,
    );
    const tabBarTouchesWindowRight = edges.right && !dockOwnsTopRightSlot;

    return (
      <WorkspaceSplitPaneContext.Provider
        key={pane.id}
        value={{
          inSplit: isSplit,
          edges,
          paneId: pane.id,
          isFocused,
          isPrimary: isPrimaryPane,
          onFocusPane: handleFocusPane,
        }}
      >
        <section
          data-workspace-pane={pane.id}
          data-primary-pane={isPrimaryPane ? "true" : "false"}
          data-focused-pane={isFocused ? "true" : "false"}
          data-edge-top={edges.top ? "1" : "0"}
          data-edge-right={edges.right ? "1" : "0"}
          data-edge-bottom={edges.bottom ? "1" : "0"}
          data-edge-left={edges.left ? "1" : "0"}
          onPointerDownCapture={() => {
            useWorkspaceTabsStore.getState().focusPane(pane.id);
          }}
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-none",
          )}
        >
          <WorkspaceTabBar
            pane={pane}
            tabs={paneTabs}
            isFocused={isFocused}
            paneCount={paneCount}
            otherPaneIds={otherPaneIds}
            touchesTopEdge={edges.top}
            touchesLeftEdge={edges.left}
            touchesRightEdge={tabBarTouchesWindowRight}
            tabBarRef={edges.top && tabBarTouchesWindowRight ? tabBarRef : undefined}
            topbarRightSlotRef={
              edges.top && tabBarTouchesWindowRight ? setTabBarTopbarSlotElement : undefined
            }
            fallbackRightControls={
              !isSplit && edges.top && tabBarTouchesWindowRight && !hasActiveChatControls ? (
                <PrismuxTopbarControls
                  wallpaperOpen={standaloneRightPanel?.kind === "wallpaper"}
                  wallpaperAvailable
                  onToggleWallpaper={toggleStandaloneWallpaper}
                  onOpenChiefSettings={openChiefSettings}
                />
              ) : null
            }
            showSplitControls
            paneOverviewAvailable={paneConversationActive}
            paneOverviewOpen={paneOverviewOpen}
            onTogglePaneOverview={handleTogglePaneOverview}
            newTabPopover={newTabPopoverBase}
            onActivateTab={handleActivateTab}
            onCloseTab={handleCloseTab}
            onSplitPane={handleSplitPane}
            onResetSplitRatio={
              parentSplitId
                ? () => useWorkspaceTabsStore.getState().resetSplitRatio(parentSplitId)
                : undefined
            }
            onClosePane={handleClosePane}
            onMoveTabToPane={handleMoveTabToPane}
            onReorderTab={(pId, tabId, targetIndex) =>
              useWorkspaceTabsStore.getState().reorderTab(pId, tabId, targetIndex)
            }
            onDropItemIntoPane={handleDropItemIntoPane}
          />

          <div
            data-workspace-pane-body={pane.id}
            onDragOver={(event) => handlePaneBodyDragOver(pane.id, event)}
            onDragLeave={(event) => handlePaneBodyDragLeave(pane.id, event)}
            onDrop={(event) => handlePaneBodyDrop(pane.id, event)}
            className={cn(
              "relative flex min-h-0 min-w-0 flex-1 overflow-hidden",
              resolvePaneBodyCornerClasses(edges, isSplit),
              resolvePaneOuterBorderClasses(edges, isSplit),
            )}
          >
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {paneOwnsRoute ? (
                <PrimaryPaneBody active={primaryShowsRoute}>{primaryContent}</PrimaryPaneBody>
              ) : null}

              {!primaryShowsRoute && activeTab ? (
                <WorkspacePaneContent
                  paneId={pane.id}
                  tab={activeTab}
                  isFocused={isFocused}
                  onFocusPane={handleFocusPane}
                  activeHostThreadRef={activeHostThreadRef}
                  environmentId={activeEnvironmentId}
                  instanceEntries={instanceEntries}
                  modelOptionsByInstance={modelOptionsByInstance}
                  historyThreads={historyThreads}
                  onUpdateTab={(tabId, patch) => useWorkspaceTabsStore.getState().updateTab(tabId, patch)}
                  onOpenHistoryThreadInPane={handleOpenHistoryThread}
                  onLaunchAgentPrompt={(payload) => void handleLaunchAgentPrompt(payload)}
                  onOpenQuickTool={(tool, targetPaneId) => handleRunQuickTool(tool, targetPaneId)}
                  onOpenConversationInMainChat={(fromPaneId, sourceTab) => {
                    const store = useWorkspaceTabsStore.getState();
                    if (fromPaneId !== store.primaryPaneId) {
                      store.closeTab(sourceTab.id, fromPaneId);
                    }
                    if (sourceTab.kind === "thread" && sourceTab.environmentId && sourceTab.threadId) {
                      store.openTab(
                        {
                          kind: "thread",
                          title: sourceTab.title,
                          providerId: sourceTab.providerId ?? null,
                          instanceId: sourceTab.instanceId ?? null,
                          environmentId: sourceTab.environmentId,
                          threadId: sourceTab.threadId,
                        },
                        store.primaryPaneId,
                      );
                      void navigate({
                        to: "/$environmentId/$threadId",
                        params: buildThreadRouteParams(
                          scopeThreadRef(sourceTab.environmentId, sourceTab.threadId),
                        ),
                      });
                      return;
                    }
                    if (sourceTab.kind === "draft" && sourceTab.draftId) {
                      const draftStore = useComposerDraftStore.getState();
                      const promoted =
                        draftStore.getPromotedDraftRedirect(sourceTab.draftId) ??
                        draftStore.getDraftSession(sourceTab.draftId)?.promotedTo ??
                        null;
                      if (promoted) {
                        store.openTab(
                          {
                            kind: "thread",
                            title: sourceTab.title,
                            providerId: sourceTab.providerId ?? null,
                            instanceId: sourceTab.instanceId ?? null,
                            environmentId: promoted.environmentId,
                            threadId: promoted.threadId,
                          },
                          store.primaryPaneId,
                        );
                        void navigate({
                          to: "/$environmentId/$threadId",
                          params: buildThreadRouteParams(promoted),
                        });
                        return;
                      }
                      if (draftStore.getDraftSession(sourceTab.draftId)) {
                        store.openTab(
                          {
                            kind: "draft",
                            title: sourceTab.title,
                            providerId: sourceTab.providerId ?? null,
                            instanceId: sourceTab.instanceId ?? null,
                            model: sourceTab.model ?? null,
                            environmentId: sourceTab.environmentId ?? null,
                            threadId: sourceTab.threadId ?? null,
                            draftId: sourceTab.draftId,
                            reuseExisting: true,
                          },
                          store.primaryPaneId,
                        );
                        void navigate({
                          to: "/draft/$draftId",
                          params: buildDraftThreadRouteParams(sourceTab.draftId),
                        });
                        return;
                      }
                    }
                    void materializePrimaryConversationTab(sourceTab);
                  }}
                />
              ) : !isPrimaryPane ? (
                <PrismuxStageFrame innerClassName="items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground [[data-pmx-glass='1']_&]:text-foreground/92 dark:[[data-pmx-glass='1']_&]:text-white/92 dark:[[data-pmx-glass='1']_&]:[text-shadow:0_1px_4px_rgba(0,0,0,0.58)]">
                  <span>拖拽任意会话、终端、浏览器、文件或差异面板至此窗格，或点击「+」打开</span>
                </PrismuxStageFrame>
              ) : null}
            </div>

            {!isSplit && isPrimaryPane && standaloneRightPanel && !activeHostThreadRef ? (
              <aside
                data-pmx-glass-zone="rightSidebar"
                data-preview-panel-mode="inline"
                data-standalone-agent-sidebar={
                  standaloneRightPanel.kind === "agent-session" ? "1" : undefined
                }
                data-standalone-wallpaper-sidebar={
                  standaloneRightPanel.kind === "wallpaper" ? "1" : undefined
                }
                className="flex h-full min-h-0 w-[min(420px,46vw)] shrink-0 flex-col overflow-hidden bg-sidebar [[data-pmx-glass='1']_&]:bg-transparent"
              >
                {standaloneRightPanel.kind === "agent-session" ? (
                  <RightPanelAgentSessionPane
                    hostThreadRef={null}
                    surface={standaloneRightPanel.session}
                    activeProjectRef={
                      activeEnvironmentId && activeProjectId
                        ? scopeProjectRef(activeEnvironmentId, activeProjectId)
                        : defaultProjectRef
                    }
                    sideChatParentPanel={null}
                    onUpdateSurface={(patch) =>
                      setStandaloneRightPanel((current) =>
                        current?.kind === "agent-session"
                          ? { kind: "agent-session", session: { ...current.session, ...patch } }
                          : current,
                      )
                    }
                    onClose={() => setStandaloneRightPanel(null)}
                  />
                ) : (
                  <PrismuxWallpaperQuickPanel />
                )}
              </aside>
            ) : null}

            {/* Explicit z-30 drop capture shield mounted while dragging so Electron <webview>,
                <iframe>, and Ghostty terminal <canvas> never swallow dragover/drop events. */}
            {activeDrag !== null ? (
              <div
                data-workspace-drop-shield={pane.id}
                onDragOver={(event) => handlePaneBodyDragOver(pane.id, event)}
                onDragLeave={(event) => handlePaneBodyDragLeave(pane.id, event)}
                onDrop={(event) => handlePaneBodyDrop(pane.id, event)}
                className="absolute inset-0 z-30 bg-transparent"
              />
            ) : null}

            {paneDropZone !== null ? (
              <div
                data-workspace-drop-preview={pane.id}
                data-drop-zone={paneDropZone}
                className={resolveDropPreviewOverlayClass(paneDropZone)}
              >
                <span className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border border-primary/45 bg-background/85 px-2.5 py-1 text-2xs font-medium text-foreground shadow-sm backdrop-blur-sm">
                  {resolveDropZoneLabel(paneDropZone)}
                </span>
              </div>
            ) : null}
          </div>
        </section>
      </WorkspaceSplitPaneContext.Provider>
    );
  };

  return (
    <WorkspaceTopbarPortalContext.Provider value={topbarPortalValue}>
      <div
        ref={setWorkspaceLayoutElement}
        data-workspace-split-container="true"
        data-pane-count={paneCount}
        data-workspace-dragging={activeDrag !== null ? "1" : "0"}
        data-workspace-resizing={isResizingSplit ? "1" : "0"}
        inert={modalOpen}
        className={cn(
          "relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-sidebar [[data-pmx-glass='1']_&]:bg-transparent [[data-pmx-wallpaper='1']_&]:bg-transparent [[data-pmx-wallpaper-visible='1']_&]:bg-transparent",
          isSplitWorkspace ? "flex-row" : "flex-col",
        )}
      >
        <div
          data-workspace-split-grid="true"
          className={cn(
            "flex min-h-0 min-w-0 flex-col overflow-hidden",
            splitDockMaximized ? "hidden" : "flex-1",
          )}
        >
          {renderNode(layout, ROOT_SPLIT_PANE_EDGES)}
        </div>

        {/* Keep TanStack Router <Outlet /> mounted without leaking into any split pane when no pane owns shownTarget. */}
        {isSplitWorkspace && routeOwnership.routeOwnerPaneId === null ? (
          <WorkspaceSplitPaneContext.Provider value={HIDDEN_SPLIT_OUTLET_PANE_CONTEXT}>
            <BackgroundThreadContext value>
              <div
                className="hidden"
                aria-hidden="true"
                data-workspace-hidden-outlet="1"
              >
                {primaryContent}
              </div>
            </BackgroundThreadContext>
          </WorkspaceSplitPaneContext.Provider>
        ) : null}

        {/* Unified single right sidebar dock for split view (mounted outside WorkspaceSplitPaneContext
            so maximized <PrismuxStageFrame> preserves full 14px concave corners). */}
        {isSplitWorkspace ? (
          <Suspense fallback={null}>
            <WorkspaceSplitRightPanelDock
              focusedContext={focusedSplitContext}
              topbarSlotElement={topbarSlotElement}
              workspaceLayoutElement={workspaceLayoutElement}
              onOpenChiefSettings={openChiefSettings}
              dockTopbarSlotRef={setDockTopbarSlotElement}
              dockOwnsTopRightSlot={dockOwnsTopRightSlot}
            />
          </Suspense>
        ) : null}
      </div>
    </WorkspaceTopbarPortalContext.Provider>
  );
});
