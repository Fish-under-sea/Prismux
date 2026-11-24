import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ProviderInstanceId,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useNavigate } from "@tanstack/react-router";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";
import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { useClientSettings } from "../../hooks/useSettings";
import {
  formatAgentBrandName,
  resolveProviderEntryDisplayName,
} from "../../prismux/agentBrand";
import {
  PrismuxTopbarControls,
  PrismuxWallpaperQuickPanel,
} from "../../prismux/PrismuxWallpaperBridge";
import {
  providerInstanceEntriesFor,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { useRightPanelStore, type AgentSessionSurface } from "../../rightPanelStore";
import { useProjects, useQuietThreadShell, useVisibleThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentServerConfigsAtom } from "../../state/server";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  type ThreadRouteTarget,
} from "../../threadRoutes";
import type { ModelEsque } from "../chat/providerIconUtils";
import { RightPanelAgentSessionPane } from "./RightPanelAgentSessionPane";
import { WorkspacePaneContent } from "./WorkspacePaneContent";
import {
  buildQuickLaunchAgentOptions,
  resolveQuickLaunchAgentTarget,
  type QuickLaunchAgentOption,
  type QuickLaunchHistoryThread,
  type QuickLaunchOpenTabMatch,
  type QuickLaunchToolId,
} from "./workspaceQuickLaunch.logic";
import { WorkspaceTabBar } from "./WorkspaceTabBar";
import {
  PrismuxStageFrame,
  WorkspaceTopbarPortalContext,
  type WorkspaceTopbarPortalContextValue,
} from "./WorkspaceTopbarPortalContext";
import {
  clampSplitRatio,
  countLeafPanes,
  findPrimaryUnusedDraftTab,
  getLiveComposerDraftStateLookup,
  listLeafPaneIds,
  useWorkspaceTabsStore,
  type SplitDirection,
  type WorkspaceSplitLayoutNode,
  type WorkspaceTab,
} from "./workspaceTabsStore";

export interface PendingDraftTabBinding {
  readonly token: object;
  readonly tabId: string | null;
  readonly title: string;
  readonly providerId: string | null;
  readonly instanceId: ProviderInstanceId | null;
  readonly model: string | null;
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

export interface WorkspaceSplitContainerProps {
  /** The primary T3 Code route view (`ThreadRouteView` or `<Outlet />`), kept mounted in primary pane. */
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
}) {
  const { splitId, direction, ratio, onCommitRatio } = props;
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
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Best-effort capture
    }

    let latestRatio: number | null = null;
    const computeRatio = (clientX: number, clientY: number): number => {
      const rect = parent.getBoundingClientRect();
      const total = isHorizontal ? rect.width : rect.height;
      if (total <= 1) return ratio;
      const offset = isHorizontal ? clientX - rect.left : clientY - rect.top;
      return clampSplitRatio(offset / total);
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
      onDoubleClick={() => onCommitRatio(splitId, 0.5)}
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
        "group relative z-20 shrink-0 select-none bg-border/60 transition-colors hover:bg-primary/65 focus-visible:bg-primary focus-visible:outline-none",
        isHorizontal
          ? "w-px cursor-col-resize before:absolute before:inset-y-0 before:-inset-x-1"
          : "h-px cursor-row-resize before:absolute before:inset-x-0 before:-inset-y-1",
        dragging && "bg-primary",
      )}
    />
  );
}

/**
 * Flush zero-gap host for the primary T3 Code route view directly beneath the unified single `WorkspaceTabBar`.
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
  const [topbarSlotElement, setTopbarSlotElement] = useState<HTMLDivElement | null>(null);
  const [hasActiveChatControls, setHasActiveChatControls] = useState(false);
  const [standaloneRightPanel, setStandaloneRightPanel] = useState<
    | { readonly kind: "agent-session"; readonly session: AgentSessionSurface }
    | { readonly kind: "wallpaper" }
    | null
  >(null);

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
      standaloneRightPanelOpen: Boolean(standaloneRightPanel && !activeHostThreadRef),
    }),
    [activeHostThreadRef, standaloneRightPanel, topbarSlotElement],
  );

  const openChiefSettings = useCallback(() => {
    void navigate({ to: "/settings/memory" as never });
  }, [navigate]);

  // Dynamic Provider instance entries + model options for Quick Launcher & Agent Blank Stage
  const { instanceEntries, modelOptionsByInstance } = useMemo(() => {
    const serverConfig = activeEnvironmentId
      ? environmentServerConfigs.get(activeEnvironmentId)
      : [...environmentServerConfigs.values()][0];
    const providers = serverConfig?.providers ?? [];
    const settings = serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS;
    const entries: ReadonlyArray<ProviderInstanceEntry> = providerInstanceEntriesFor(
      providers,
      settings,
      activeProjectId,
    );
    const optionsMap = new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>();
    for (const entry of entries) {
      optionsMap.set(entry.instanceId, entry.models);
    }
    return { instanceEntries: entries, modelOptionsByInstance: optionsMap };
  }, [activeEnvironmentId, activeProjectId, environmentServerConfigs]);

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
        const instanceId = thread.modelSelection?.instanceId ?? null;
        const entry = instanceId
          ? instanceEntries.find((candidate) => candidate.instanceId === instanceId)
          : undefined;
        return {
          environmentId: thread.environmentId,
          threadId: thread.id,
          title: thread.title || "未命名会话",
          projectName: projectNameByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null,
          providerId: entry?.driverKind ?? instanceId,
          instanceId,
          updatedAt: thread.updatedAt,
        };
      });
  }, [instanceEntries, projectNameByKey, visibleThreads]);

  const quickLaunchAgents = useMemo(
    () => buildQuickLaunchAgentOptions({ instanceEntries, historyThreads }),
    [historyThreads, instanceEntries],
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

  const routeActiveSelection = useMemo(() => {
    const draftProvider = routeComposerDraft?.activeProvider ?? null;
    const draftSelection = draftProvider
      ? routeComposerDraft?.modelSelectionByProvider[draftProvider]
      : null;
    return draftSelection ?? routeThreadShell?.modelSelection ?? null;
  }, [routeComposerDraft, routeThreadShell]);

  const routeActiveProviderId = useMemo(() => {
    const draftProvider = routeComposerDraft?.activeProvider ?? null;
    const instanceId = routeActiveSelection?.instanceId ?? null;
    if (instanceId) {
      const entry = instanceEntries.find((candidate) => candidate.instanceId === instanceId);
      if (entry) return entry.driverKind;
      return instanceId;
    }
    return draftProvider;
  }, [instanceEntries, routeActiveSelection?.instanceId, routeComposerDraft?.activeProvider]);

  const routeActiveInstanceId = routeActiveSelection?.instanceId ?? null;
  const routeActiveModel = routeActiveSelection?.model ?? null;

  const routeActiveEntry = useMemo(() => {
    if (!routeActiveInstanceId) return null;
    return instanceEntries.find((candidate) => candidate.instanceId === routeActiveInstanceId) ?? null;
  }, [instanceEntries, routeActiveInstanceId]);

  const routeDisplayTitle = useMemo(() => {
    if (routeThreadShell?.title?.trim()) return routeThreadShell.title.trim();
    if (shownTarget?.kind === "draft") {
      if (routeActiveEntry) {
        return resolveProviderEntryDisplayName(routeActiveEntry);
      }
      if (routeActiveProviderId) {
        return formatAgentBrandName(routeActiveProviderId);
      }
      const fallbackEntry = instanceEntries.find((entry) => entry.enabled) ?? instanceEntries[0];
      if (fallbackEntry) {
        return resolveProviderEntryDisplayName(fallbackEntry);
      }
      return "新会话";
    }
    return "会话";
  }, [
    instanceEntries,
    routeActiveEntry,
    routeActiveProviderId,
    routeThreadShell?.title,
    shownTarget?.kind,
  ]);

  // Keep open draft & blank agent tab titles synchronized immediately when a provider is renamed in Settings.
  useEffect(() => {
    if (instanceEntries.length === 0) return;
    const entryById = new Map(instanceEntries.map((entry) => [entry.instanceId, entry] as const));
    const store = useWorkspaceTabsStore.getState();
    for (const tab of Object.values(store.tabs)) {
      if ((tab.kind !== "agent" && tab.kind !== "draft") || !tab.instanceId) continue;
      const entry = entryById.get(tab.instanceId);
      if (!entry) continue;
      const nextTitle = resolveProviderEntryDisplayName(entry);
      if (nextTitle && tab.title !== nextTitle) {
        store.updateTab(tab.id, { title: nextTitle });
      }
    }
  }, [instanceEntries]);

  useEffect(() => {
    if (!shownTarget || !routeKey) return;
    const isRouteChanged = lastSyncedRouteKeyRef.current !== routeKey;
    lastSyncedRouteKeyRef.current = routeKey;
    const pendingBinding =
      shownTarget.kind === "draft" ? pendingDraftTabBindingRef.current : null;
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
    });
  }, [
    routeActiveInstanceId,
    routeActiveModel,
    routeActiveProviderId,
    routeDisplayTitle,
    routeDraftSession?.environmentId,
    routeDraftSession?.threadId,
    routeKey,
    shownTarget,
  ]);

  // Promote draft tabs in-place when T3 promotes a draft into a server thread
  const promotedTarget = routeDraftSession?.promotedTo ?? routePromotedRedirect;
  useEffect(() => {
    if (routeDraftId && promotedTarget) {
      useWorkspaceTabsStore.getState().promoteDraftTab(routeDraftId, promotedTarget, {
        title: routeDisplayTitle,
        providerId: routeActiveProviderId,
      });
    }
  }, [promotedTarget, routeActiveProviderId, routeDisplayTitle, routeDraftId]);

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
                  (entry.driverKind === tab.providerId ||
                    formatAgentBrandName(entry.driverKind).toLowerCase() ===
                      formatAgentBrandName(tab.providerId).toLowerCase()),
              )
            : undefined) ??
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
        const resolvedProviderId = matchedEntry?.driverKind ?? tab.providerId ?? null;
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
    [handleNewThread, instanceEntries, navigate, resolveProjectRefForMainLaunch],
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
        if (promotedRedirect) {
          useWorkspaceTabsStore.getState().promoteDraftTab(tab.draftId, promotedRedirect);
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(promotedRedirect),
          });
          return;
        }
        const draftSession = draftStore.getDraftSession(tab.draftId);
        if (draftSession?.promotedTo) {
          useWorkspaceTabsStore.getState().promoteDraftTab(tab.draftId, draftSession.promotedTo);
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(draftSession.promotedTo),
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
    [materializePrimaryConversationTab, modalOpen, navigate, shownTarget],
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

      // Secondary panes route parallel agent sessions to the right sidebar instead of a blank shell.
      if (resolvedPaneId !== store.primaryPaneId) {
        openAgentInRightSidebar(agent);
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

      if (activeHostThreadRef) {
        useRightPanelStore.getState().openAgentSession(activeHostThreadRef, {
          title: thread.title,
          providerId: thread.providerId ?? "codex",
          instanceId: thread.instanceId ?? null,
          environmentId: thread.environmentId,
          threadId: thread.threadId,
        });
        return;
      }

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
    },
    [activeHostThreadRef, navigate],
  );

  const handleRunQuickTool = useCallback(
    (toolId: QuickLaunchToolId, targetPaneId: string) => {
      if (toolId === "settings") {
        void navigate({ to: "/settings" });
        return;
      }
      if (activeHostThreadRef) {
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

      const store = useWorkspaceTabsStore.getState();
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
              hostThreadRef: null,
              environmentId: null,
              threadId: null,
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
    (_paneId: string, _direction: SplitDirection) => {
      const preferredAgent = quickLaunchAgents[0];
      if (preferredAgent) {
        openAgentInRightSidebar(preferredAgent);
      } else if (activeHostThreadRef) {
        useRightPanelStore.getState().show(activeHostThreadRef);
      }
    },
    [activeHostThreadRef, openAgentInRightSidebar, quickLaunchAgents],
  );

  const handleLaunchAgentInSplit = useCallback(
    (agent: QuickLaunchAgentOption, _fromPaneId: string) => {
      openAgentInRightSidebar(agent);
    },
    [openAgentInRightSidebar],
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
      const bindingToken = {};
      pendingDraftTabBindingRef.current = {
        token: bindingToken,
        tabId: reuseTabId,
        title: resolvedTitle,
        providerId: matchedEntry?.driverKind ?? input.providerId,
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
              providerId: matchedEntry?.driverKind ?? input.providerId,
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
    [handleNewThread, instanceEntries, resolveProjectRefForMainLaunch],
  );

  const paneCount = countLeafPanes(layout);
  const allLeafIds = useMemo(() => listLeafPaneIds(layout), [layout]);

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

  const renderNode = (
    node: WorkspaceSplitLayoutNode,
    edges: {
      readonly top: boolean;
      readonly left: boolean;
      readonly right: boolean;
    },
  ): ReactNode => {
    if (node.type === "split") {
      const isHorizontal = node.direction === "horizontal";
      return (
        <div
          key={node.id}
          data-workspace-split={node.id}
          data-split-direction={node.direction}
          className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
          style={{ flexDirection: isHorizontal ? "row" : "column" }}
        >
          <div className="flex min-h-0 min-w-0 overflow-hidden" style={{ flex: `${node.ratio} 1 0%` }}>
            {renderNode(node.first, {
              top: edges.top,
              left: edges.left,
              right: isHorizontal ? false : edges.right,
            })}
          </div>
          <SplitResizeHandle
            splitId={node.id}
            direction={node.direction}
            ratio={node.ratio}
            onCommitRatio={(splitId, nextRatio) =>
              useWorkspaceTabsStore.getState().setSplitRatio(splitId, nextRatio)
            }
          />
          <div
            className="flex min-h-0 min-w-0 overflow-hidden"
            style={{ flex: `${1 - node.ratio} 1 0%` }}
          >
            {renderNode(node.second, {
              top: isHorizontal ? edges.top : false,
              left: isHorizontal ? false : edges.left,
              right: edges.right,
            })}
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
    const otherPaneIds = allLeafIds.filter((id) => id !== pane.id);

    // Primary pane ALWAYS hosts the real full ChatView / route stage for any conversation tab
    // (thread, draft, or legacy agent) — never a stripped blank agent shell.
    const primaryShowsRoute =
      isPrimaryPane &&
      (activeTab === null ||
        activeTab.kind === "thread" ||
        activeTab.kind === "draft" ||
        activeTab.kind === "agent");

    return (
      <section
        key={pane.id}
        data-workspace-pane={pane.id}
        data-primary-pane={isPrimaryPane ? "true" : "false"}
        data-focused-pane={isFocused ? "true" : "false"}
        onPointerDownCapture={() => {
          useWorkspaceTabsStore.getState().focusPane(pane.id);
        }}
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          paneCount > 1 && isFocused && "ring-1 ring-inset ring-primary/40",
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
          touchesRightEdge={edges.right}
          tabBarRef={edges.top && edges.right ? tabBarRef : undefined}
          topbarRightSlotRef={edges.top && edges.right ? setTopbarSlotElement : undefined}
          fallbackRightControls={
            edges.top && edges.right && !hasActiveChatControls ? (
              <PrismuxTopbarControls
                wallpaperOpen={standaloneRightPanel?.kind === "wallpaper"}
                wallpaperAvailable
                onToggleWallpaper={toggleStandaloneWallpaper}
                onOpenChiefSettings={openChiefSettings}
              />
            ) : null
          }
          showSplitControls={false}
          newTabPopover={newTabPopoverBase}
          onActivateTab={handleActivateTab}
          onCloseTab={handleCloseTab}
          onSplitPane={handleSplitPane}
          onClosePane={(id) => useWorkspaceTabsStore.getState().closePane(id, { mergeTabs: true })}
          onMoveTabToPane={(tabId, fromPaneId, toPaneId) =>
            useWorkspaceTabsStore.getState().moveTabToPane(tabId, fromPaneId, toPaneId)
          }
          onReorderTab={(pId, tabId, targetIndex) =>
            useWorkspaceTabsStore.getState().reorderTab(pId, tabId, targetIndex)
          }
        />

        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {isPrimaryPane ? (
              <PrimaryPaneBody active={primaryShowsRoute}>{primaryContent}</PrimaryPaneBody>
            ) : null}

            {!primaryShowsRoute && activeTab ? (
              <WorkspacePaneContent
                paneId={pane.id}
                tab={activeTab}
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
                <span>点击左上角「+」在右侧边栏开启会话或工具面板</span>
              </PrismuxStageFrame>
            ) : null}
          </div>

          {isPrimaryPane && standaloneRightPanel && !activeHostThreadRef ? (
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
        </div>
      </section>
    );
  };

  return (
    <WorkspaceTopbarPortalContext.Provider value={topbarPortalValue}>
      <div
        data-workspace-split-container="true"
        data-pane-count={paneCount}
        inert={modalOpen}
        className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-sidebar [[data-pmx-glass='1']_&]:bg-transparent [[data-pmx-wallpaper='1']_&]:bg-transparent [[data-pmx-wallpaper-visible='1']_&]:bg-transparent"
      >
        {renderNode(layout, { top: true, left: true, right: true })}
      </div>
    </WorkspaceTopbarPortalContext.Provider>
  );
});
