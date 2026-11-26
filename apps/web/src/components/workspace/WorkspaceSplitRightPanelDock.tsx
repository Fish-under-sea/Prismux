import { useAtomValue } from "@effect/atom-react";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@prismux/client-runtime/environment";
import { sideThreadComposer, sideThreadKindOf } from "@prismux/client-runtime/side-thread";
import { sourceControlClients } from "@prismux/client-runtime/source-control-clients";
import { threadRuntimeIsActive } from "@prismux/client-runtime/state/shell";
import { deriveWorkspaceMutationId } from "@prismux/client-runtime/state/threads";
import {
  AuthOrchestrationOperateScope,
  AuthPreviewOperateScope,
  AuthTerminalOperateScope,
  type EnvironmentId,
  type ScopedThreadRef,
  type ThreadId,
} from "@prismux/core-contracts";
import { projectScriptCwd, resolveProjectScripts } from "@prismux/core-shared/projectScripts";
import { resolveProjectSettings } from "@prismux/core-shared/projectSettings";
import { resolveTerminalSessionLabel } from "@prismux/core-shared/terminalLabelsCopy";
import { visibleThreadPullRequests } from "@prismux/core-shared/threadPullRequests";
import { orchestrationV2WorktreePending } from "@prismux/core-shared/orchestrationV2ThreadError";
import { T, useGT, useMessages } from "gt-react";
import { ImageIcon, LayersIcon, XIcon } from "lucide-react";
import { memo, useEffect, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";

import { previewRuntimeTabId } from "../../browser/previewRuntimeTabId";
import { useComposerDraftStore } from "../../composerDraftStore";
import { isElectron } from "../../env";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useOpenSurfaceInMainView } from "../../hooks/useOpenSurfaceInMainView";
import { useRightPanelSurfaceClose } from "../../hooks/useRightPanelSurfaceClose";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useWorkspaceRevision } from "../../hooks/useWorkspaceRevision";
import { shortcutLabelForCommand } from "../../keybindings";
import { cn } from "~/lib/utils";
import { usePanelAnimationSettings, usePanelPresence } from "../../panelAnimations";
import { isPreviewSupportedInRuntime, useThreadPreviewState } from "../../previewStateStore";
import { AgentBrandLogo } from "../../prismux/agentBrand";
import { useAgentAuxActivation } from "../../prismux/agentAux/useAgentAuxActivation";
import {
  PrismuxTopbarControls,
  PrismuxWallpaperQuickPanel,
} from "../../prismux/PrismuxWallpaperBridge";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../../rightPanelLayout";
import {
  selectActiveRightPanel,
  selectActiveRightPanelSurface,
  selectPaneOverviewOpen,
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "../../rightPanelStore";
import { useDeviceState } from "~/state/device";
import {
  readThreadShell,
  resolveThreadDetailRef,
  useEnvironmentSupportsServerBrowser,
  useProject,
  useQuietThreadProjection,
  useQuietThreadShell,
  useQuietThreadVisibleTurnItems,
  useThreadCheckpointSummaries,
  useThreadShells,
  useThreadStatus,
} from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { revisionedQuery } from "../../state/revisionedQuery";
import { primaryServerKeybindingsAtom, serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "~/state/session";
import {
  useKnownTerminalSessions,
  useThreadRunningTerminalIds,
} from "../../state/terminalSessions";
import { chatGitStatusAtom, NO_CHAT_GIT_STATUS_ATOM, vcsEnvironment } from "../../state/vcs";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../../terminalUiStateStore";
import { recallCheckoutIsRepo } from "../ChatView.logic";
import { deriveBtwThreadTitle, normalizeBtwDisplayTitle } from "../chat/btwMode";
import { DeviceSetupDialogHost } from "../chat/ChatOverlayHosts";
import { ChatRightPanel } from "../chat/ChatRightPanel";
import {
  PanelLayoutControls,
  RightPanelMaximizeControl,
  type PanelLayoutControlsProps,
} from "../chat/PanelLayoutControls";
import { RightPanelSurfaceContent } from "../chat/RightPanelSurfaceContent";
import { useChatTerminalActions, type TerminalLaunchContext } from "../chat/useChatTerminalActions";
import { useRightPanelActions } from "../chat/useRightPanelActions";
import { useSideChat } from "../chat/useSideChat";
import { getConfiguredPreviewUrls } from "../preview/previewEmptyStateLogic";
import { usePreviewSession } from "../preview/usePreviewSession";
import { LinkPullRequestDialogHost } from "../pullRequest/LinkPullRequestDialog";
import { threadPullRequestPanelTarget } from "../pullRequest/pullRequestDetail.logic";
import { useThreadLinkedPullRequest } from "../pullRequest/useThreadLinkedPullRequest";
import { RightPanelSheet } from "../RightPanelSheet";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { RightPanelAgentSessionPane } from "./RightPanelAgentSessionPane";
import {
  resolveFollowSurfaceKindForPaneSwitch,
  type FocusedSplitRightPanelContext,
} from "./splitPaneIsolation.logic";
import { PrismuxStageFrame } from "./WorkspaceTopbarPortalContext";

const EMPTY_PENDING_FILE_SURFACE_IDS: ReadonlySet<string> = new Set();
const SPLIT_DOCK_WIDTH_STORAGE_KEY = "prismux:split-right-panel-width";

export interface WorkspaceSplitRightPanelDockProps {
  readonly focusedContext: FocusedSplitRightPanelContext;
  readonly topbarSlotElement: HTMLDivElement | null;
  readonly workspaceLayoutElement: HTMLDivElement | null;
  readonly onOpenChiefSettings: () => void;
  readonly dockTopbarSlotRef: Ref<HTMLDivElement>;
  readonly dockOwnsTopRightSlot: boolean;
}

function SplitDockPreviewSessionSync(props: { readonly threadRef: ScopedThreadRef }) {
  usePreviewSession(props.threadRef);
  return null;
}

function SplitDockTopStrip({
  dockTopbarSlotRef,
  showSlot,
}: {
  readonly dockTopbarSlotRef: Ref<HTMLDivElement>;
  readonly showSlot: boolean;
}) {
  if (!showSlot) return null;
  return (
    <div
      data-split-right-panel-topbar="1"
      data-pmx-glass-zone="shellFrame"
      className={cn(
        "flex h-[max(38px,env(titlebar-area-height,38px))] min-h-[38px] shrink-0 items-center justify-end gap-1 bg-sidebar px-2 [[data-pmx-glass='1']_&]:bg-transparent",
        isElectron && "drag-region wco:pr-(--workspace-native-controls-inset)",
      )}
    >
      <div
        ref={dockTopbarSlotRef}
        data-workspace-topbar-right-slot="1"
        className="flex shrink-0 items-center gap-1 empty:hidden [-webkit-app-region:no-drag]"
      />
    </div>
  );
}

function SplitRightPanelContextBar({
  focusedContext,
  onClose,
}: {
  readonly focusedContext: FocusedSplitRightPanelContext;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  return (
    <div
      data-split-right-panel-context="1"
      data-split-right-panel-pane={focusedContext.paneId}
      data-split-right-panel-thread={focusedContext.threadKey ?? "none"}
      className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border/55 bg-muted/20 px-2.5 text-2xs text-muted-foreground [[data-pmx-glass='1']_&]:border-white/12 [[data-pmx-glass='1']_&]:bg-transparent"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {focusedContext.providerId ? (
          <AgentBrandLogo provider={focusedContext.providerId} size={12} className="shrink-0" />
        ) : (
          <LayersIcon className="size-3 shrink-0 opacity-75" aria-hidden />
        )}
        <span className="shrink-0 opacity-75">
          <T>Following pane</T>
        </span>
        <span className="min-w-0 truncate font-medium text-foreground">{focusedContext.title}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-3xs leading-none font-medium text-muted-foreground">
          {gt("Pane {index}", { index: focusedContext.paneIndex + 1 })}
        </span>
        <button
          type="button"
          aria-label={gt("Collapse right sidebar")}
          data-split-right-panel-close="1"
          onClick={onClose}
          className="flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <XIcon className="size-3" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function NonThreadFallbackBody({
  focusedContext,
  onOpenWallpaper,
  onClose,
}: {
  readonly focusedContext: FocusedSplitRightPanelContext;
  readonly onOpenWallpaper: () => void;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  return (
    <div
      data-split-right-panel-fallback="non-thread"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <div className="flex size-10 items-center justify-center rounded-xl border border-border/70 bg-muted/35">
        <LayersIcon className="size-4.5 text-muted-foreground" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">
          {gt('Tab "{title}" has no bound thread', { title: focusedContext.title })}
        </p>
        <p className="max-w-xs text-2xs leading-relaxed text-muted-foreground">
          <T>
            Focus any conversation pane to sync its diff review, files, and terminal sidebar, or
            open global wallpaper and appearance controls.
          </T>
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="xs" variant="outline" onClick={onOpenWallpaper}>
          <ImageIcon className="size-3.5" aria-hidden />
          <span>
            <T>Wallpaper & Appearance</T>
          </span>
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={onClose}>
          <T>Collapse sidebar</T>
        </Button>
      </div>
    </div>
  );
}

function BoundSplitThreadRightPanel(props: {
  readonly focusedContext: FocusedSplitRightPanelContext;
  readonly threadRef: ScopedThreadRef;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly sheet: boolean;
  readonly maximized: boolean;
  readonly open: boolean;
  readonly workspaceLayoutElement: HTMLDivElement | null;
  readonly panelAnimationsActive: boolean;
  readonly panelAnimationDurationMs: number;
  readonly previousSurfaceRef: React.MutableRefObject<{
    threadKey: string | null;
    activeSurface: RightPanelSurface | null;
  }>;
  readonly layoutControls: React.ReactNode;
  readonly onCloseDock: () => void;
}) {
  const {
    focusedContext,
    threadRef,
    environmentId,
    threadId,
    sheet,
    maximized,
    open,
    workspaceLayoutElement,
    panelAnimationsActive,
    panelAnimationDurationMs,
    previousSurfaceRef,
    layoutControls,
    onCloseDock,
  } = props;
  const gt = useGT();
  const messages = useMessages();
  const threadKey = scopedThreadKey(threadRef);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const settings = useEnvironmentSettings(environmentId);
  const activeEnvironment = useEnvironment(environmentId);
  const serverConfig = activeEnvironment?.serverConfig ?? null;
  const availableEditors =
    useAtomValue(serverEnvironment.configValueAtom(environmentId))?.availableEditors ?? [];
  const canOperateThread = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const canOperatePreview = useEnvironmentScope(environmentId, AuthPreviewOperateScope);
  const activeEnvironmentServerBrowser = useEnvironmentSupportsServerBrowser(environmentId);
  const browserAvailable = isPreviewSupportedInRuntime() || activeEnvironmentServerBrowser;

  const draftId = focusedContext.draftId ?? null;
  const draftThread = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : store.getDraftSessionByRef(threadRef),
  );
  const serverThreadShell = useQuietThreadShell(threadRef);
  const isServerThread = serverThreadShell !== null;
  const routeThreadDetailRef = resolveThreadDetailRef(threadRef, {
    shellExists: serverThreadShell !== null,
    waitForShell: draftThread !== null,
  });
  const serverThreadProjection = useQuietThreadProjection(routeThreadDetailRef);
  const serverProjection = serverThreadProjection?.projection ?? null;
  const serverVisibleTurnItems = useQuietThreadVisibleTurnItems(routeThreadDetailRef);
  const turnDiffSummaries = useThreadCheckpointSummaries(routeThreadDetailRef);
  const threadStatus = useThreadStatus(routeThreadDetailRef);

  const projectId = serverThreadShell?.projectId ?? draftThread?.projectId ?? null;
  const activeProjectRef = projectId ? scopeProjectRef(environmentId, projectId) : null;
  const activeProject = useProject(activeProjectRef);
  const activeProjectScripts = activeProject ? resolveProjectScripts(settings, activeProject) : [];
  const configuredPreviewUrls = getConfiguredPreviewUrls(activeProjectScripts);
  const activeWorktreePath = serverThreadShell?.worktreePath ?? draftThread?.worktreePath ?? null;
  const activeProjectCwd = activeProject?.workspaceRoot ?? null;
  const activeWorkspaceRoot = activeWorktreePath ?? activeProjectCwd ?? undefined;
  const gitCwd = activeProject
    ? projectScriptCwd({
        project: { cwd: activeProject.workspaceRoot },
        worktreePath: activeWorktreePath,
      })
    : null;

  const workspaceMutationId = deriveWorkspaceMutationId(
    serverVisibleTurnItems,
    turnDiffSummaries.at(-1)?.completedAt ?? null,
  );
  const workspaceRevision = useWorkspaceRevision({
    threadKey,
    unloaded:
      routeThreadDetailRef !== null &&
      threadStatus !== "live" &&
      threadStatus !== "deleted" &&
      !threadRuntimeIsActive(serverThreadShell?.runtime),
    mutationId: workspaceMutationId,
  });
  const gitStatusCwd = activeWorktreePath ?? gitCwd;
  const gitStatusAtom =
    gitStatusCwd === null
      ? null
      : vcsEnvironment.status({
          environmentId,
          input: { cwd: gitStatusCwd },
        });
  const gitStatusRevision =
    workspaceRevision.revision === null
      ? undefined
      : `${threadKey}\u0000${workspaceRevision.revision}`;
  const gitStatusData = useAtomValue(
    gitStatusAtom
      ? chatGitStatusAtom(
          workspaceRevision.pending
            ? revisionedQuery(gitStatusAtom, undefined, { startedUnder: gitStatusRevision })
            : revisionedQuery(
                gitStatusAtom,
                workspaceMutationId === null ? undefined : gitStatusRevision,
              ),
        )
      : NO_CHAT_GIT_STATUS_ATOM,
  );
  const isGitRepo =
    gitStatusData?.isRepo ?? recallCheckoutIsRepo(environmentId, gitStatusCwd) ?? true;
  const diffAvailable =
    isGitRepo ||
    (activeProject?.trackedFolders?.length ?? 0) > 0 ||
    turnDiffSummaries.some((summary) => summary.repositories !== undefined);

  const rightPanelState = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, threadRef),
  );
  const activeRightPanelKind = useRightPanelStore((state) =>
    selectActiveRightPanel(state.byThreadKey, threadRef),
  );
  const activeRightPanelSurface = useRightPanelStore((state) =>
    selectActiveRightPanelSurface(state.byThreadKey, threadRef),
  );
  const activePreviewState = useThreadPreviewState(threadRef);
  const activePreviewServerEpoch = activePreviewState.serverEpoch;
  const resolvePreviewRuntimeTabId = (tabId: string) =>
    previewRuntimeTabId(threadRef, activePreviewServerEpoch, tabId);
  const { state: deviceState, loaded: deviceStateLoaded } = useDeviceState(environmentId);

  const runningTerminalIds = useThreadRunningTerminalIds({ environmentId, threadId });
  const knownSessionsRaw = useKnownTerminalSessions({ environmentId, threadId });
  const knownSessions = (knownSessionsRaw ?? []).filter(
    (session) => session.target.threadId === threadId,
  );
  const activeServerOrderedTerminalIds = knownSessions.map((session) => session.target.terminalId);
  const activeTerminalLabelsById = new Map<string, string>(
    knownSessions.map((session) => [
      session.target.terminalId,
      resolveTerminalSessionLabel(session.target.terminalId, session.state.summary, messages),
    ]),
  );
  const panelTerminalIds = new Set(
    rightPanelState.surfaces.flatMap((surface) =>
      surface.kind === "terminal" ? surface.terminalIds : [],
    ),
  );
  const terminalUiState = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, threadRef),
  );
  const [terminalLaunchContext, setTerminalLaunchContext] = useState<TerminalLaunchContext | null>(
    null,
  );
  const nullComposerRef = useRef(null);
  const noopSetThreadError = (_id: ThreadId | null, _error: string | null) => {};
  const {
    activatePanelTerminalStable,
    addTerminalContextToDraftStable,
    addTerminalSurfaceStable,
    closePanelTerminalStable,
    runShellCommandStable,
    splitPanelTerminalStable,
    splitPanelTerminalVerticalStable,
  } = useChatTerminalActions({
    environmentId,
    composerRef: nullComposerRef,
    terminalUiState,
    activeThread: serverThreadShell ?? undefined,
    activeThreadId: threadId,
    activeThreadRef: threadRef,
    activeProject,
    activeRightPanelSurface,
    runningTerminalIds,
    activeServerOrderedTerminalIds,
    activeTerminalLabelsById,
    panelTerminalIds,
    canReuseTerminal: knownSessionsRaw !== null,
    gitCwd,
    setTerminalUiLaunchContext: setTerminalLaunchContext,
    setThreadError: noopSetThreadError,
  });

  const terminalShortcutLabelOptions = {
    context: { terminalFocus: true, terminalOpen: Boolean(terminalUiState.terminalOpen) },
  };
  const splitTerminalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.split",
    terminalShortcutLabelOptions,
  );
  const splitTerminalVerticalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.splitVertical",
    terminalShortcutLabelOptions,
  );
  const newTerminalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.new",
    terminalShortcutLabelOptions,
  );
  const closeTerminalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.close",
    terminalShortcutLabelOptions,
  );

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- syncs focused split pane transitions into rightPanelStore while the unified split dock is open
  useEffect(() => {
    if (!open) {
      previousSurfaceRef.current = { threadKey, activeSurface: activeRightPanelSurface };
      return;
    }
    const previous = previousSurfaceRef.current;
    if (previous.threadKey !== null && previous.threadKey !== threadKey) {
      const store = useRightPanelStore.getState();
      const nextState = selectThreadRightPanelState(store.byThreadKey, threadRef);
      const nextActive = selectActiveRightPanelSurface(store.byThreadKey, threadRef);
      if (!(nextState.isOpen && nextActive && nextActive.kind !== "wallpaper")) {
        const action = resolveFollowSurfaceKindForPaneSwitch({
          previousSurface: previous.activeSurface,
          nextThreadHasSurfaces: nextState.surfaces.some((s) => s.kind !== "wallpaper"),
          nextIsServerThread: isServerThread,
          nextHasProject: activeProject !== null,
          nextDiffAvailable: diffAvailable,
        });
        if (action === "diff") {
          store.open(threadRef, "diff");
        } else if (action === "files") {
          store.open(threadRef, "files");
        } else if (action === "pull-requests") {
          store.open(threadRef, "pull-requests");
        } else {
          store.show(threadRef);
        }
      }
    }
    previousSurfaceRef.current = {
      threadKey,
      activeSurface:
        activeRightPanelSurface && activeRightPanelSurface.kind !== "wallpaper"
          ? activeRightPanelSurface
          : previous.activeSurface,
    };
  }, [
    activeProject,
    activeRightPanelSurface,
    diffAvailable,
    isServerThread,
    open,
    previousSurfaceRef,
    threadKey,
    threadRef,
  ]);

  const supportsPullRequests = serverConfig !== null;
  const visiblePullRequests = visibleThreadPullRequests(serverThreadShell?.pullRequests ?? []);
  const visiblePullRequestCount = visiblePullRequests.length;
  const pullRequestsSurfaceAvailable =
    isServerThread && supportsPullRequests && visiblePullRequestCount > 0;
  const linkedItemsSurfaceAvailable =
    pullRequestsSurfaceAvailable ||
    (isServerThread && (serverThreadShell?.issues?.length ?? 0) > 0);
  const activeProjectRepository = sourceControlClients.repositorySelector(
    activeProject?.repositoryIdentity,
  );
  const { linked: linkedThreadPullRequest } = useThreadLinkedPullRequest({
    serverThreadRef: isServerThread ? threadRef : null,
    environmentId,
    persisted: serverThreadShell?.linkedPullRequest ?? null,
    projectId: activeProject?.id ?? null,
    projectRepository: activeProjectRepository,
    threadBranch: serverThreadShell?.branch ?? draftThread?.branch ?? null,
    gitStatus: gitStatusData ?? null,
  });
  const pullRequestPanelTarget =
    projectId !== null
      ? threadPullRequestPanelTarget({
          projectId,
          pullRequests: visiblePullRequests,
          linkedPullRequest: linkedThreadPullRequest,
          branchPullRequest: serverThreadShell?.branchPullRequest,
        })
      : null;

  const {
    closeSurface: closeRightPanelSurface,
    closeOtherSurfaces: closeOtherRightPanelSurfacesStable,
    closeSurfacesToRight: closeRightPanelSurfacesToRightStable,
    closeAllSurfaces: closeAllRightPanelSurfacesStable,
  } = useRightPanelSurfaceClose({
    threadRef,
    terminalLabelsById: activeTerminalLabelsById,
  });

  const {
    activateRightPanelSurfaceStable,
    addDeviceSurfaceStable,
    addWallpaperSurfaceStable,
    addDiffSurfaceStable,
    addFilesSurfaceStable,
    addPullRequestSurfaceStable,
    addPullRequestsSurfaceStable,
    copyRightPanelFilePathStable,
    createBrowserSurface,
    createBrowserSurfaceStable,
    duplicateBrowserSurfaceStable,
    moveRightPanelSurfaceStable,
    onOpenToolDiffStable,
    openFileSurfaceStable,
  } = useRightPanelActions({
    activeThreadRef: threadRef,
    activeProject,
    activeRightPanelSurface,
    activePreviewState,
    deviceState,
    deviceStateLoaded,
    pullRequestPanelTarget,
    threadPanelPresentation: "inline",
    isServerThread,
    embedded: true,
    paneId: focusedContext.paneId,
    inSplit: true,
    diffAvailable,
    browserAvailable,
    canOperatePreview,
    diffOpen: activeRightPanelKind === "diff",
    previewPanelOpen: activeRightPanelKind === "preview" && browserAvailable,
    rightPanelOpen: open,
    canMaximizeRightPanel: open,
    rightPanelMaximized: maximized,
    supportsPullRequests,
    pullRequestsSurfaceAvailable: linkedItemsSurfaceAvailable,
    gitCwd,
    activeProjectCwd,
    onDiffPanelOpen: undefined,
    closeRightPanelSurface,
  });

  const [pendingFileSurfaceIdsByProject, setPendingFileSurfaceIdsByProject] = useState<
    ReadonlyMap<string, ReadonlySet<string>>
  >(() => new Map());
  const activeProjectKey = activeProject
    ? `${activeProject.environmentId}:${activeProject.workspaceRoot}`
    : null;
  const pendingFileSurfaceIds = activeProjectKey
    ? (pendingFileSurfaceIdsByProject.get(activeProjectKey) ?? EMPTY_PENDING_FILE_SURFACE_IDS)
    : EMPTY_PENDING_FILE_SURFACE_IDS;
  const handleFilePendingChangeStable = useStableCallback(
    (relativePath: string, pending: boolean) => {
      if (!activeProjectKey) return;
      setPendingFileSurfaceIdsByProject((currentByProject) => {
        const current = currentByProject.get(activeProjectKey) ?? EMPTY_PENDING_FILE_SURFACE_IDS;
        const surfaceId = `file:${relativePath}`;
        if (current.has(surfaceId) === pending) return currentByProject;
        const next = new Set(current);
        if (pending) next.add(surfaceId);
        else next.delete(surfaceId);
        const nextByProject = new Map(currentByProject);
        if (next.size === 0) nextByProject.delete(activeProjectKey);
        else nextByProject.set(activeProjectKey, next);
        return nextByProject;
      });
    },
  );

  const isSubagentThread = serverThreadShell?.lineage.relationshipToParent === "subagent";
  const sideChatsOffered =
    canOperateThread &&
    serverThreadShell?.lineage.sideChat !== true &&
    !isSubagentThread &&
    serverConfig?.environment.capabilities.sideChats === true;
  const defaultRuntimeMode = resolveProjectSettings(settings, projectId).settings
    .defaultRuntimeMode;
  const sideChat = useSideChat({
    threadRef: sideChatsOffered && isServerThread ? threadRef : null,
    readSettings: () => ({
      runtimeMode: serverThreadShell?.runtimeMode ?? defaultRuntimeMode,
      modelSelection: serverThreadShell?.modelSelection,
    }),
    onError: (message) => {
      toastManager.add({ type: "error", title: message });
    },
  });
  const sideChatDisabledReason =
    serverThreadShell?.lineage.sideChat === true
      ? gt("Side chats cannot start side chats.")
      : isSubagentThread
        ? gt("Subagent threads cannot start side chats.")
        : serverConfig === null
          ? gt("Side chats are not ready yet. Try again in a moment.")
          : serverConfig.environment.capabilities.sideChats !== true
            ? gt("Update this environment's Prismux server to use side chats.")
            : sideChatsOffered && !isServerThread
              ? gt("Side chats start after the first message.")
              : sideChat.available &&
                  orchestrationV2WorktreePending(activeWorktreePath, serverProjection?.runs ?? [])
                ? gt("Available once the thread's worktree is set up.")
                : null;
  const canStartSideChat = sideChatsOffered && sideChat.available && !sideChatDisabledReason;
  const openSideChatStable = useStableCallback(() => void sideChat.open());
  const quickAskSideChatStable = useStableCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return false;
    return sideChat.open({
      text: trimmed,
      attachments: [],
      titleSeed: deriveBtwThreadTitle(trimmed),
    });
  });
  const openSideChatSurfaceStable = useStableCallback(() => {
    const store = useRightPanelStore.getState();
    const existingSideChat = selectThreadRightPanelState(
      store.byThreadKey,
      threadRef,
    ).surfaces.find(
      (surface) =>
        surface.kind === "thread" &&
        readThreadShell(scopeThreadRef(threadRef.environmentId, surface.threadId))?.lineage
          .sideChat === true,
    );
    if (existingSideChat) {
      store.activateSurface(threadRef, existingSideChat.id);
      return;
    }
    if (canStartSideChat) {
      void sideChat.open();
      return;
    }
    store.open(threadRef, "side-chat-empty");
  });

  const allShells = useThreadShells(isServerThread);
  const relationshipShells = isServerThread
    ? allShells.filter(
        (shell) =>
          shell.environmentId === threadRef.environmentId &&
          shell.lineage.parentThreadId === threadRef.threadId,
      )
    : undefined;
  const existingBtwSideThreads = (relationshipShells ?? [])
    .filter((shell) => shell.lineage.sideChat === true && shell.deletedAt == null)
    .map((shell) => ({
      threadId: shell.id,
      title: normalizeBtwDisplayTitle(shell.title, gt("Side chat")),
      running: shell.runtime?.status === "running" || shell.latestRun?.status === "running",
    }));
  const sideThreadKind = serverThreadShell ? sideThreadKindOf(serverThreadShell.source) : null;
  const isProviderSubagent =
    sideThreadKind !== null && sideThreadComposer(sideThreadKind) === "read-only";
  const agentAux = useAgentAuxActivation({
    activeThreadRef: threadRef,
    isServerThread,
    embedded: false,
    provider: focusedContext.providerId ?? null,
    cwd: activeWorkspaceRoot ?? gitCwd ?? null,
    projection: serverProjection,
    relationshipShells,
    isProviderNativeSubagent: isProviderSubagent && focusedContext.providerId === "antigravity",
  });

  const sideChatParentPanel = {
    hostRef: threadRef,
    openToolDiff: onOpenToolDiffStable,
    runShellCommand: (command: string) => {
      useRightPanelStore.getState().setSplitDockMaximized(false);
      void runShellCommandStable(command);
    },
    ...(canStartSideChat ? { onNewSideChat: openSideChatStable } : {}),
  };

  const openSurfaceInMainView = useOpenSurfaceInMainView(threadRef);
  const getShortcutContextStable = useStableCallback(() => ({
    terminalFocus: false,
    terminalOpen: Boolean(terminalUiState.terminalOpen),
    previewFocus: false,
    previewOpen: activeRightPanelKind === "preview" && browserAvailable,
    rightPanelOpen: open,
    editableFocus: false,
    modelPickerOpen: false,
    composerFocus: false,
    draftThreadRoute: focusedContext.isDraftTab,
    turnRunning: false,
    composerEmpty: true,
    composerRequiresModifier: false,
    isWeb: !isElectron,
    isDesktop: isElectron,
  }));

  // Filter out legacy per-thread "wallpaper" surface inside split mode since wallpaper is global.
  const threadSurfaces = rightPanelState.surfaces.filter((surface) => surface.kind !== "wallpaper");
  const effectiveActiveSurface =
    activeRightPanelSurface && activeRightPanelSurface.kind !== "wallpaper"
      ? activeRightPanelSurface
      : (threadSurfaces[0] ?? null);

  const presence = usePanelPresence(
    open,
    { activeSurface: effectiveActiveSurface, surfaces: threadSurfaces },
    panelAnimationsActive,
    threadKey,
    panelAnimationDurationMs,
  );
  const renderedSurface = presence.value?.activeSurface ?? null;
  const renderedSurfaces = presence.value?.surfaces ?? [];
  const composerDraftTarget = draftId ?? threadRef;

  const rightPanelContent =
    renderedSurface?.kind === "agent-session" ? (
      <RightPanelAgentSessionPane
        hostThreadRef={threadRef}
        surface={renderedSurface}
        activeProjectRef={activeProjectRef}
        sideChatParentPanel={sideChatParentPanel}
        onUpdateSurface={(patch) => {
          useRightPanelStore.getState().updateAgentSession(threadRef, renderedSurface.id, patch);
        }}
        onClose={() => closeRightPanelSurface(renderedSurface)}
      />
    ) : (
      <RightPanelSurfaceContent
        surface={renderedSurface}
        activeSurfaceId={effectiveActiveSurface?.id ?? null}
        threadRef={threadRef}
        environmentId={environmentId}
        visible={open}
        composerDraftTarget={composerDraftTarget}
        keybindings={keybindings}
        configuredPreviewUrls={configuredPreviewUrls}
        workspaceMutationId={workspaceMutationId}
        workspaceRevision={workspaceRevision.revision}
        getShortcutContext={getShortcutContextStable}
        onSendAnnotation={() => {}}
        onCloseSurface={closeRightPanelSurface}
        sideChatParentPanel={sideChatParentPanel}
        terminal={{
          launchContext:
            terminalLaunchContext?.threadId === threadId ? terminalLaunchContext : null,
          keybindings,
          onAddTerminalContext: addTerminalContextToDraftStable,
          onSplitTerminal: splitPanelTerminalStable,
          onSplitTerminalVertical: splitPanelTerminalVerticalStable,
          onNewTerminal: addTerminalSurfaceStable,
          onActiveTerminalChange: activatePanelTerminalStable,
          onCloseTerminal: closePanelTerminalStable,
          splitShortcutLabel: splitTerminalShortcutLabel ?? undefined,
          splitVerticalShortcutLabel: splitTerminalVerticalShortcutLabel ?? undefined,
          newShortcutLabel: newTerminalShortcutLabel ?? undefined,
          closeShortcutLabel: closeTerminalShortcutLabel ?? undefined,
        }}
        pullRequest={{
          capabilityKnown: serverConfig !== null,
          supported: supportsPullRequests,
          isServerThread,
          projectId,
          pullRequests: visiblePullRequests,
          linkedPullRequest: linkedThreadPullRequest,
          branchPullRequest: serverThreadShell?.branchPullRequest,
          onBack:
            pullRequestsSurfaceAvailable && visiblePullRequestCount > 1
              ? addPullRequestsSurfaceStable
              : undefined,
          onOpenLinkedItems: addPullRequestsSurfaceStable,
        }}
        sideChat={{
          canStart: canStartSideChat,
          disabledReason: sideChatDisabledReason,
          onStart: canStartSideChat ? openSideChatStable : undefined,
          onQuickAsk: canStartSideChat ? quickAskSideChatStable : undefined,
          isServerThread,
          existingSideThreads: existingBtwSideThreads,
          onOpenExistingSideThread: (sideThreadId) => {
            useRightPanelStore.getState().openThread(threadRef, sideThreadId);
          },
        }}
        issuesSupported={serverConfig?.environment.capabilities.issues === true}
        files={{
          projectId: activeProject?.id,
          projectName: activeProject?.title ?? null,
          workspaceRoot: activeWorkspaceRoot,
          availableEditors,
          pendingSurfaceIds: pendingFileSurfaceIds,
          onOpenFile: openFileSurfaceStable,
          onPendingChange: handleFilePendingChangeStable,
        }}
        agentAux={{
          model: agentAux.model,
          isLoading: agentAux.isLoading,
          onRefresh: agentAux.refresh,
          onOpenChildThread: (childThreadId) => {
            useRightPanelStore.getState().openThread(threadRef, childThreadId);
          },
        }}
      />
    );

  return (
    <>
      {canOperatePreview && activeEnvironmentServerBrowser ? (
        <SplitDockPreviewSessionSync threadRef={threadRef} />
      ) : null}
      <DeviceSetupDialogHost threadKey={threadKey} threadRef={threadRef} state={deviceState} />
      <LinkPullRequestDialogHost />
      {presence.present ? (
        <ChatRightPanel
          sheet={sheet}
          workspaceLayoutElement={workspaceLayoutElement}
          widthStorageKey={SPLIT_DOCK_WIDTH_STORAGE_KEY}
          sheetAnimationDurationMs={panelAnimationsActive ? panelAnimationDurationMs : 0}
          onCloseSheet={onCloseDock}
          open={open}
          keybindings={keybindings}
          getShortcutContext={getShortcutContextStable}
          maximized={maximized}
          layoutControls={layoutControls}
          surfaces={renderedSurfaces}
          environmentId={environmentId}
          activeSurfaceId={renderedSurface?.id ?? null}
          pendingSurfaceIds={pendingFileSurfaceIds}
          previewSessions={activePreviewState.sessions}
          desktopByTabId={activePreviewState.desktopByTabId}
          previewRuntimeTabId={resolvePreviewRuntimeTabId}
          terminalLabelsById={activeTerminalLabelsById}
          onActivate={activateRightPanelSurfaceStable}
          onCloseSurface={closeRightPanelSurface}
          onOpenInMainView={openSurfaceInMainView}
          onRenameDevice={(surfaceId, title) => {
            useRightPanelStore.getState().renameDevice(threadRef, surfaceId, title);
          }}
          onCloseOtherSurfaces={closeOtherRightPanelSurfacesStable}
          onCloseSurfacesToRight={closeRightPanelSurfacesToRightStable}
          onCloseAllSurfaces={closeAllRightPanelSurfacesStable}
          onMoveSurface={moveRightPanelSurfaceStable}
          onCopyFilePath={copyRightPanelFilePathStable}
          onAddBrowser={() => createBrowserSurface()}
          onAddBrowserInProfile={createBrowserSurfaceStable}
          onDuplicateBrowser={duplicateBrowserSurfaceStable}
          onAddTerminal={addTerminalSurfaceStable}
          onAddDiff={addDiffSurfaceStable}
          onAddFiles={addFilesSurfaceStable}
          onAddPullRequest={addPullRequestSurfaceStable}
          onAddPullRequests={addPullRequestsSurfaceStable}
          onAddDevice={addDeviceSurfaceStable}
          onAddWallpaper={addWallpaperSurfaceStable}
          onAddSideChat={openSideChatSurfaceStable}
          browserAvailable={canOperatePreview && browserAvailable}
          terminalAvailable={activeProject !== null && canOperateTerminal}
          diffAvailable={isServerThread && diffAvailable}
          filesAvailable={activeProject !== null}
          pullRequestAvailable
          pullRequestsAvailable
          deviceAvailable
          wallpaperAvailable
          sideChatAvailable
          sideChatDisabledReason={sideChatDisabledReason}
        >
          {rightPanelContent}
        </ChatRightPanel>
      ) : null}
    </>
  );
}

/**
 * Single workspace-level right sidebar dock for split view, mounted outside split pane context
 * so thread surfaces follow the focused pane while maximized mode keeps 14px concave corners.
 */
export const WorkspaceSplitRightPanelDock = memo(function WorkspaceSplitRightPanelDock({
  focusedContext,
  topbarSlotElement,
  workspaceLayoutElement,
  onOpenChiefSettings,
  dockTopbarSlotRef,
  dockOwnsTopRightSlot,
}: WorkspaceSplitRightPanelDockProps) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const prefersSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();

  const splitDockOpen = useRightPanelStore((state) => state.splitDockOpen);
  const splitDockMaximized = useRightPanelStore((state) => state.splitDockMaximized);
  const splitGlobalWallpaperOpen = useRightPanelStore((state) => state.splitGlobalWallpaperOpen);
  const focusedPaneOverviewOpen = useRightPanelStore((state) =>
    selectPaneOverviewOpen(
      state.paneOverviewOpenByPaneId,
      state.threadPanelVisibilityByThreadKey,
      focusedContext.paneId,
      focusedContext.threadRef,
      true,
    ),
  );
  const focusedTerminalUiState = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, focusedContext.threadRef),
  );

  const anyDockOpen = splitDockOpen || splitGlobalWallpaperOpen;
  const shouldUseSheet = prefersSheet && !splitDockMaximized;
  const dockInlineOpen = anyDockOpen && !shouldUseSheet;
  const effectiveMaximized = dockInlineOpen && splitDockMaximized;

  const previousSurfaceRef = useRef<{
    threadKey: string | null;
    activeSurface: RightPanelSurface | null;
  }>({ threadKey: null, activeSurface: null });

  const handleCloseDock = useStableCallback(() => {
    const store = useRightPanelStore.getState();
    store.setSplitGlobalWallpaperOpen(false);
    store.setSplitDockMaximized(false);
    store.setSplitDockOpen(false);
    if (focusedContext.threadRef) {
      store.close(focusedContext.threadRef);
    }
  });

  const handleToggleFocusedOverview = useStableCallback(() => {
    if (!focusedContext.isConversationTab) return;
    useRightPanelStore.getState().togglePaneOverview(focusedContext.paneId, true);
  });

  const handleToggleWallpaper = useStableCallback(() => {
    useRightPanelStore.getState().toggleSplitGlobalWallpaper();
  });

  const handleToggleBottomTerminal = useStableCallback(() => {
    if (!focusedContext.threadRef) return;
    const termStore = useTerminalUiStateStore.getState();
    const current = selectThreadTerminalUiState(
      termStore.terminalUiStateByThreadKey,
      focusedContext.threadRef,
    );
    termStore.setTerminalOpen(focusedContext.threadRef, !current.terminalOpen);
  });

  const handleToggleRightPanel = useStableCallback(() => {
    const store = useRightPanelStore.getState();
    if (store.splitDockOpen && !store.splitGlobalWallpaperOpen) {
      handleCloseDock();
      return;
    }
    store.setSplitGlobalWallpaperOpen(false);
    store.setSplitDockOpen(true);
    if (focusedContext.threadRef) {
      store.show(focusedContext.threadRef);
    }
  });

  const handleToggleMaximized = useStableCallback(() => {
    const store = useRightPanelStore.getState();
    store.setSplitDockMaximized(!store.splitDockMaximized);
  });

  const panelToggleControlProps: PanelLayoutControlsProps = {
    terminalAvailable: focusedContext.threadRef !== null,
    terminalOpen: Boolean(focusedTerminalUiState.terminalOpen),
    terminalShortcutLabel: shortcutLabelForCommand(keybindings, "terminal.toggle"),
    threadPanelOpen: focusedContext.isConversationTab ? focusedPaneOverviewOpen : false,
    threadPanelPresentation: "inline",
    threadPanelShortcutLabel: shortcutLabelForCommand(keybindings, "threadPanel.toggle"),
    rightPanelAvailable: true,
    rightPanelOpen: splitDockOpen && !splitGlobalWallpaperOpen,
    rightPanelShortcutLabel: shortcutLabelForCommand(keybindings, "rightPanel.toggle"),
    onToggleTerminal: handleToggleBottomTerminal,
    onToggleThreadPanel: handleToggleFocusedOverview,
    onToggleRightPanel: handleToggleRightPanel,
  };

  const sheetLayoutControls = anyDockOpen ? (
    <div className="mr-px flex items-center gap-1">
      <RightPanelMaximizeControl maximized={effectiveMaximized} onToggle={handleToggleMaximized} />
      <PanelLayoutControls {...panelToggleControlProps} showThreadPanelControl={false} />
    </div>
  ) : null;

  const topbarControlsPortal = topbarSlotElement
    ? createPortal(
        <>
          <PrismuxTopbarControls
            overviewOpen={focusedContext.isConversationTab ? focusedPaneOverviewOpen : false}
            overviewPresentation="inline"
            overviewShortcutLabel={panelToggleControlProps.threadPanelShortcutLabel}
            {...(focusedContext.isConversationTab
              ? { onToggleOverview: handleToggleFocusedOverview }
              : {})}
            wallpaperOpen={splitGlobalWallpaperOpen}
            wallpaperAvailable
            inlineRightPanelOwnsTitleBar={dockInlineOpen}
            onToggleWallpaper={handleToggleWallpaper}
            onOpenChiefSettings={onOpenChiefSettings}
          />
          <PanelLayoutControls {...panelToggleControlProps} showThreadPanelControl={false} />
          {dockInlineOpen ? (
            <RightPanelMaximizeControl
              maximized={effectiveMaximized}
              onToggle={handleToggleMaximized}
            />
          ) : null}
        </>,
        topbarSlotElement,
      )
    : null;

  if (splitGlobalWallpaperOpen) {
    const wallpaperContent = effectiveMaximized ? (
      <PrismuxStageFrame
        rightPanelOpen={false}
        glassZone="mainCanvas"
        innerDataAttributes={{ "data-right-panel-maximized-stage": "1" }}
      >
        <PrismuxWallpaperQuickPanel />
      </PrismuxStageFrame>
    ) : (
      <PrismuxWallpaperQuickPanel />
    );

    if (shouldUseSheet) {
      return (
        <>
          {topbarControlsPortal}
          <RightPanelSheet
            animationDurationMs={panelAnimationsActive ? panelAnimationDurationMs : 0}
            open
            onClose={handleCloseDock}
          >
            <div
              data-split-right-panel-dock="wallpaper"
              className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
            >
              <PrismuxWallpaperQuickPanel />
            </div>
          </RightPanelSheet>
        </>
      );
    }

    return (
      <>
        {topbarControlsPortal}
        <aside
          data-split-right-panel-dock="wallpaper"
          data-pmx-glass-zone={effectiveMaximized ? undefined : "rightSidebar"}
          data-preview-panel-mode="inline"
          className={cn(
            "flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-sidebar [[data-pmx-glass='1']_&]:bg-transparent",
            effectiveMaximized ? "flex-1" : "w-[min(420px,42vw)] border-l border-border/60",
          )}
        >
          <SplitDockTopStrip
            dockTopbarSlotRef={dockTopbarSlotRef}
            showSlot={dockOwnsTopRightSlot}
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{wallpaperContent}</div>
        </aside>
      </>
    );
  }

  if (splitDockOpen && focusedContext.threadRef === null) {
    const fallbackInner = (
      <>
        <SplitRightPanelContextBar focusedContext={focusedContext} onClose={handleCloseDock} />
        <NonThreadFallbackBody
          focusedContext={focusedContext}
          onOpenWallpaper={() => useRightPanelStore.getState().setSplitGlobalWallpaperOpen(true)}
          onClose={handleCloseDock}
        />
      </>
    );

    if (shouldUseSheet) {
      return (
        <>
          {topbarControlsPortal}
          <RightPanelSheet
            animationDurationMs={panelAnimationsActive ? panelAnimationDurationMs : 0}
            open
            onClose={handleCloseDock}
          >
            <div
              data-split-right-panel-dock="fallback"
              className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
            >
              {fallbackInner}
            </div>
          </RightPanelSheet>
        </>
      );
    }

    return (
      <>
        {topbarControlsPortal}
        <aside
          data-split-right-panel-dock="fallback"
          data-pmx-glass-zone={effectiveMaximized ? undefined : "rightSidebar"}
          data-preview-panel-mode="inline"
          className={cn(
            "flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-sidebar [[data-pmx-glass='1']_&]:bg-transparent",
            effectiveMaximized ? "flex-1" : "w-[min(420px,42vw)] border-l border-border/60",
          )}
        >
          <SplitDockTopStrip
            dockTopbarSlotRef={dockTopbarSlotRef}
            showSlot={dockOwnsTopRightSlot}
          />
          {effectiveMaximized ? (
            <PrismuxStageFrame
              rightPanelOpen={false}
              glassZone="mainCanvas"
              innerDataAttributes={{ "data-right-panel-maximized-stage": "1" }}
            >
              {fallbackInner}
            </PrismuxStageFrame>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{fallbackInner}</div>
          )}
        </aside>
      </>
    );
  }

  const threadRef = focusedContext.threadRef;
  if (!splitDockOpen || !threadRef) {
    return <>{topbarControlsPortal}</>;
  }

  if (shouldUseSheet) {
    return (
      <>
        {topbarControlsPortal}
        <div
          data-split-right-panel-dock="thread"
          data-split-right-panel-pane={focusedContext.paneId}
        >
          <BoundSplitThreadRightPanel
            focusedContext={focusedContext}
            threadRef={threadRef}
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            sheet
            maximized={false}
            open={splitDockOpen}
            workspaceLayoutElement={workspaceLayoutElement}
            panelAnimationsActive={panelAnimationsActive}
            panelAnimationDurationMs={panelAnimationDurationMs}
            previousSurfaceRef={previousSurfaceRef}
            layoutControls={sheetLayoutControls}
            onCloseDock={handleCloseDock}
          />
        </div>
      </>
    );
  }

  return (
    <>
      {topbarControlsPortal}
      <div
        data-split-right-panel-dock="thread"
        data-split-right-panel-pane={focusedContext.paneId}
        data-split-right-panel-thread={focusedContext.threadKey ?? "none"}
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden bg-sidebar [[data-pmx-glass='1']_&]:bg-transparent",
          effectiveMaximized ? "flex-1" : "shrink-0",
        )}
      >
        <SplitDockTopStrip dockTopbarSlotRef={dockTopbarSlotRef} showSlot={dockOwnsTopRightSlot} />
        {!effectiveMaximized ? (
          <SplitRightPanelContextBar focusedContext={focusedContext} onClose={handleCloseDock} />
        ) : null}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <BoundSplitThreadRightPanel
            focusedContext={focusedContext}
            threadRef={threadRef}
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            sheet={false}
            maximized={effectiveMaximized}
            open={splitDockOpen}
            workspaceLayoutElement={workspaceLayoutElement}
            panelAnimationsActive={panelAnimationsActive}
            panelAnimationDurationMs={panelAnimationDurationMs}
            previousSurfaceRef={previousSurfaceRef}
            layoutControls={null}
            onCloseDock={handleCloseDock}
          />
        </div>
      </div>
    </>
  );
});
