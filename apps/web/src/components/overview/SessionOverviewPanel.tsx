import {
  ThreadId,
  type AssetResource,
  type ChatAttachment,
  type ChatFileAttachment,
  type EditorId,
  type EnvironmentId,
  type ModelSelection,
  type OrchestrationMessageContext,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type ProjectId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ScheduledTask,
  type TaskFolder,
} from "@prismux/core-contracts";
import { scopeProjectRef, scopeThreadRef } from "@prismux/client-runtime/environment";
import { isScratchProject } from "@prismux/client-runtime/state/projects";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import {
  ChevronRightIcon,
  FolderOpenIcon,
  GitCompareArrowsIcon,
  MessageSquarePlusIcon,
  MoreVerticalIcon,
  SlidersHorizontalIcon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";

import { useAssetUrls } from "~/assets/assetUrls";
import type { ComposerThreadTarget, DraftId } from "~/composerDraftStore";
import { useDiffPanelStore } from "~/diffPanelStore";
import { useClientSettings } from "~/hooks/useSettings";
import { useT3ProjectFileScripts } from "~/hooks/useT3ProjectFileScripts";
import { openSideThread } from "~/lib/sideChatPane";
import { cn } from "~/lib/utils";
import { workspaceAreaProps } from "~/lib/workspaceFocus";
import { useThreadDiscoveredPorts } from "~/portDiscoveryState";
import { prismuxDaemonClient } from "~/prismux/daemonClient";
import {
  AgentAuxOverviewEntryButton,
  type AgentAuxOverviewEntryData,
} from "~/prismux/agentAux/AgentAuxPanel";
import { useRightPanelStore } from "~/rightPanelStore";
import {
  useProject,
  useQuietThreadShell,
  useServerConfigs,
  useThreadProjection,
  useThreadRelationshipShells,
} from "~/state/entities";
import { filesystemEnvironment } from "~/state/filesystem";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useKnownTerminalSessions } from "~/state/terminalSessions";
import { vcsEnvironment } from "~/state/vcs";
import { buildThreadRouteParams } from "~/threadRoutes";
import { DEFAULT_THREAD_TERMINAL_ID } from "~/types";
import { BranchToolbar } from "../BranchToolbar";
import type { EnvMode, EnvironmentOption } from "../BranchToolbar.logic";
import GitActionsControl from "../GitActionsControl";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { OpenInPicker } from "../chat/OpenInPicker";
import { ThreadDetailsItemsMenuItems } from "../chat/ThreadDetailsItemsMenu";
import { ThreadDetailsThreadPrRows } from "../chat/ThreadDetailsPrRows";
import { ThreadRepositorySections } from "../chat/ThreadRepositorySections";
import {
  ThreadDetailsContext,
  ThreadDetailsUsage,
  type ThreadDetailsUsageInput,
} from "../chat/ThreadDetailsUsage";
import { resolveThreadDetailsVisibility } from "../chat/threadDetailsItems";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  ArtifactPreviewDialog,
  ArtifactsOverviewSection,
  BackgroundTasksOverviewSection,
  GoalsOverviewSection,
  ModifiedFilesOverviewSection,
  SideQuestionsOverviewSection,
  SubagentsOverviewSection,
  UploadPreviewDialog,
  UploadsOverviewSection,
  UsedSkillsOverviewSection,
} from "./SessionOverviewSections";
import {
  SideQuestionComposer,
  SideQuestionDetailDialog,
  useSideQuestionController,
  type SideQuestionAskExecutor,
} from "./SideQuestionWidget";
import {
  OVERVIEW_DEFAULT_COMPOSER_HEIGHT_PX,
  OVERVIEW_FLOATING_TOP_GAP_PX,
  OVERVIEW_FLOATING_Z_INDEX,
  OVERVIEW_SECTION_LIMIT_OPTIONS,
  computeDynamicOverviewSectionLimit,
  computeFloatingOverviewClearance,
  extractOverviewArtifacts,
  extractOverviewBackgroundTasks,
  extractOverviewGoals,
  extractOverviewModifiedFiles,
  extractOverviewSideQuestions,
  extractOverviewSubagents,
  extractOverviewUploads,
  extractOverviewUsedSkills,
  loadOverviewDisplayPrefs,
  resolveOverviewDiffStats,
  saveOverviewDisplayPrefs,
  type DaemonPtySessionItem,
  type OverviewArtifactItem,
  type OverviewBackgroundTaskItem,
  type OverviewDiffStats,
  type OverviewDisplayPrefs,
  type OverviewModifiedFileItem,
  type OverviewSectionLimitMode,
  type OverviewSideQuestionItem,
  type OverviewSubagentItem,
  type OverviewUploadItem,
} from "./sessionOverview.logic";

const EMPTY_ASSET_RESOURCES: ReadonlyArray<AssetResource> = Object.freeze([]);
const EMPTY_THREAD_SHELLS: ReadonlyArray<OrchestrationV2ThreadShell> = Object.freeze([]);
const EMPTY_SCHEDULED_TASKS: ReadonlyArray<ScheduledTask> = Object.freeze([]);
const DAEMON_PTY_POLL_INTERVAL_MS = 15_000;

export interface SessionOverviewPanelProps {
  readonly density?: "full" | "compact" | "essential";
  /** Mount as a true top-right floating overlay (`position: absolute; top: 12px; right: 12px; z-index: 25`) without displacing chat layout. */
  readonly floating?: boolean;
  /** Optional extra top inset (px), e.g. when the in-thread Find bar is visible at top-right. */
  readonly topInsetPx?: number;
  /** Live bottom composer height (px) for dynamic bottom clearance (`--pmx-composer-height`); falls back to CSS var / 148px. */
  readonly bottomClearancePx?: number;
  /** Live chat canvas container height (px) used with `bottomClearancePx` to compute section limits when `availableHeightPx` is omitted. */
  readonly containerHeightPx?: number;
  /** Live available height (px) inside the overview card, used to dynamically scale per-section limits. */
  readonly availableHeightPx?: number;
  readonly forceNewWorktree?: boolean;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly worktreePath: string | null;
  readonly isServerThread: boolean;
  readonly draftId?: DraftId;
  readonly composerDraftTarget: ComposerThreadTarget;
  readonly activeProjectName: string | undefined;
  readonly activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  readonly preferredScriptId: string | null;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly showOpenInPicker: boolean;
  readonly openInShortcutEnabled: boolean;
  readonly gitCwd: string | null;
  readonly workspaceMutationId: string | null;
  readonly isGitRepo: boolean;
  readonly envLocked: boolean;
  readonly availableEnvironments: readonly EnvironmentOption[];
  readonly autoEnvironmentLabel?: string | undefined;
  readonly onAutoEnvironment?: (() => void) | undefined;
  readonly onEnvironmentChange?: (environmentId: EnvironmentId) => void;
  readonly onEnvModeChange: (mode: EnvMode) => void;
  readonly envMode: EnvMode;
  readonly activeThreadBranchOverride?: string | null;
  readonly onActiveThreadBranchOverrideChange?: (branch: string | null) => void;
  readonly startFromOrigin: boolean;
  readonly onStartFromOriginChange: (startFromOrigin: boolean) => void;
  readonly onCheckoutPullRequestRequest?: (reference: string) => void;
  readonly onComposerFocusRequest: () => void;
  readonly onOpenChanges?: () => void;
  readonly onRunProjectScript: (script: ProjectScript) => void;
  readonly onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  readonly onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  readonly onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
  readonly usage: ThreadDetailsUsageInput;
  // Incremental optional AGY+Codex Overview props (100% backward-compatible)
  readonly onContinueInTerminal?: () => void;
  readonly continueInTerminalDisabled?: boolean;
  readonly continueInTerminalLabel?: string | null;
  readonly agentAuxEntry?: AgentAuxOverviewEntryData | null;
  readonly onOpenAgentAux?: () => void;
  readonly onOpenDiffReview?: (filePath?: string) => void;
  readonly onOpenFiles?: () => void;
  readonly onOpenFile?: (relativePath: string, line?: number) => void;
  readonly onOpenSideChat?: (message?: {
    readonly text: string;
    readonly titleSeed: string;
    readonly attachments: ReadonlyArray<ChatAttachment>;
    readonly context?: OrchestrationMessageContext;
  }) => Promise<boolean> | boolean | void;
  readonly readModelSelection?: (() => ModelSelection | undefined) | undefined;
  readonly sideChatAvailable?: boolean;
  readonly sideChatDisabledReason?: string | null;
  readonly diffStats?: OverviewDiffStats | null;
  readonly threadAttachments?: ReadonlyArray<ChatAttachment>;
  /** Optional overrides primarily used by tests or custom host adapters. */
  readonly onAskSideQuestion?: SideQuestionAskExecutor;
  readonly daemonPtysOverride?: ReadonlyArray<DaemonPtySessionItem>;
  readonly displayPrefsOverride?: Partial<OverviewDisplayPrefs>;
  readonly defaultMoreMenuOpen?: boolean;
  /** Optional split-pane identifier for pane-scoped overview panels under split view. */
  readonly paneId?: string | null | undefined;
  /** Invoked before opening right-sidebar surfaces so split-pane overview actions focus their own pane first. */
  readonly onBeforePanelAction?: (() => void) | undefined;
  /** Optional collapse button handler rendered in split-pane headers for independent per-pane collapse/expand. */
  readonly onCollapse?: (() => void) | undefined;
}

export function OverviewDisplayPrefsMenuSection(props: {
  readonly prefs: OverviewDisplayPrefs;
  readonly effectiveLimit: number;
  readonly autoLimit: number;
  readonly onToggleShowCompleted: () => void;
  readonly onSelectLimitMode: (mode: OverviewSectionLimitMode) => void;
}) {
  return (
    <section
      aria-label="概览显示设置"
      data-overview-more-section="display-prefs"
      className="mb-1 space-y-1.5 border-b border-border/50 pb-2"
    >
      <div className="px-2 pt-0.5 text-[10.5px] font-semibold tracking-wide text-muted-foreground">
        概览显示
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.prefs.showCompleted}
        data-overview-toggle-completed="1"
        onClick={props.onToggleShowCompleted}
        className="flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 text-left text-xs font-medium text-foreground/90 transition-colors hover:bg-black/[0.045] hover:text-foreground dark:hover:bg-white/[0.075]"
      >
        <span className="truncate">显示已结束项</span>
        <span
          aria-hidden
          className={cn(
            "inline-flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors",
            props.prefs.showCompleted ? "bg-primary/90" : "bg-foreground/15 dark:bg-white/20",
          )}
        >
          <span
            className={cn(
              "block size-3 rounded-full bg-white shadow-xs transition-transform",
              props.prefs.showCompleted && "translate-x-3",
            )}
          />
        </span>
      </button>

      <div className="px-2" data-overview-limit-mode={String(props.prefs.limitMode)}>
        <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
          <span className="font-medium text-foreground/85">每区最多显示</span>
          <span className="tabular-nums text-muted-foreground">
            {props.prefs.limitMode === "auto"
              ? `自动 (当前 ${props.autoLimit} 项)`
              : `${props.effectiveLimit} 项`}
          </span>
        </div>
        <div
          role="group"
          aria-label="每区最多显示数量"
          className="grid grid-cols-5 gap-1 rounded-lg bg-foreground/[0.05] p-0.5 dark:bg-white/[0.06]"
        >
          {OVERVIEW_SECTION_LIMIT_OPTIONS.map((option) => {
            const active = props.prefs.limitMode === option;
            return (
              <button
                key={String(option)}
                type="button"
                aria-pressed={active}
                data-overview-limit-option={String(option)}
                onClick={() => props.onSelectLimitMode(option)}
                className={cn(
                  "h-6 cursor-pointer rounded-md px-1 text-[11px] font-medium tabular-nums transition-colors",
                  active
                    ? "bg-background text-foreground shadow-xs ring-1 ring-border/60 dark:bg-white/15"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option === "auto" ? "自动" : String(option)}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function parseDaemonPtySessionsPayload(raw: unknown): DaemonPtySessionItem[] {
  if (!raw || typeof raw !== "object") return [];
  const rec = raw as Record<string, unknown>;
  const result = rec.result && typeof rec.result === "object" ? (rec.result as Record<string, unknown>) : rec;
  const list = Array.isArray(result.sessions)
    ? result.sessions
    : Array.isArray(result.ptys)
      ? result.ptys
      : [];
  const parsed: DaemonPtySessionItem[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const id =
      typeof item.ptyId === "string"
        ? item.ptyId
        : typeof item.sessionId === "string"
          ? item.sessionId
          : typeof item.id === "string"
            ? item.id
            : null;
    if (!id) continue;
    const command = typeof item.command === "string" ? item.command : null;
    const title = typeof item.title === "string" ? item.title : command ?? id;
    const cwd =
      typeof item.cwd === "string"
        ? item.cwd
        : typeof item.workspace === "string"
          ? item.workspace
          : null;
    const pid = typeof item.pid === "number" ? item.pid : null;
    const alive = item.alive !== false;
    const stale = item.stale === true;
    const group = typeof item.group === "string" ? item.group : null;
    parsed.push({ id, title, command, cwd, pid, alive, stale, group });
  }
  return parsed;
}

function useDaemonPtySessions(
  override: ReadonlyArray<DaemonPtySessionItem> | undefined,
): ReadonlyArray<DaemonPtySessionItem> {
  const [sessions, setSessions] = useState<ReadonlyArray<DaemonPtySessionItem>>([]);

  useEffect(() => {
    if (override !== undefined) return;
    let disposed = false;

    const load = async () => {
      try {
        const info = await prismuxDaemonClient.getConnectionInfo(false);
        if (!info.ready || !info.baseUrl || disposed) return;
        let next: DaemonPtySessionItem[] = [];
        try {
          const rpcResp = await prismuxDaemonClient.requestJson<unknown>("/v1/rpc", {
            method: "POST",
            body: JSON.stringify({
              id: `overview-pty-${Date.now()}`,
              method: "pty.list",
              params: {},
            }),
          });
          next = parseDaemonPtySessionsPayload(rpcResp);
        } catch {
          // Fallback to /v1/system/resources PTY listing
          try {
            const res = await prismuxDaemonClient.fetchSystemResources(false);
            next = parseDaemonPtySessionsPayload({ ptys: res.ptys ?? [] });
          } catch {
            next = [];
          }
        }
        if (!disposed) {
          setSessions(next);
        }
      } catch {
        // Daemon unavailable in standalone/browser test mode.
      }
    };

    void load();
    const timer = setInterval(() => {
      void load();
    }, DAEMON_PTY_POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [override]);

  return override ?? sessions;
}

interface ResolvedServerThreadData {
  readonly threadShell: ReturnType<typeof useQuietThreadShell>;
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly relationshipShells: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly scheduledTasks: ReadonlyArray<ScheduledTask>;
  readonly taskFolder: TaskFolder | null;
  readonly onTaskFolderChange?: (() => void) | undefined;
}

function ServerSessionOverviewPanel(props: SessionOverviewPanelProps) {
  const activeThreadRef = useMemo(
    () => scopeThreadRef(props.environmentId, props.threadId),
    [props.environmentId, props.threadId],
  );
  const threadShell = useQuietThreadShell(activeThreadRef);
  const projection = useThreadProjection(activeThreadRef)?.projection ?? null;
  const relationshipShells = useThreadRelationshipShells(activeThreadRef);
  const scheduledTasksQuery = useEnvironmentQuery(
    !props.draftId
      ? serverEnvironment.scheduledTasksLive({ environmentId: props.environmentId, input: {} })
      : null,
  );
  const taskFolderQuery = useEnvironmentQuery(
    props.worktreePath !== null
      ? filesystemEnvironment.taskFolder({
          environmentId: props.environmentId,
          input: { worktreePath: props.worktreePath },
        })
      : null,
  );

  return (
    <SessionOverviewPanelContent
      {...props}
      serverData={{
        threadShell,
        projection,
        relationshipShells,
        scheduledTasks: scheduledTasksQuery.data?.tasks ?? EMPTY_SCHEDULED_TASKS,
        taskFolder: taskFolderQuery.data?.taskFolder ?? null,
        onTaskFolderChange: taskFolderQuery.refresh,
      }}
    />
  );
}

const DRAFT_SERVER_DATA: ResolvedServerThreadData = Object.freeze({
  threadShell: null,
  projection: null,
  relationshipShells: EMPTY_THREAD_SHELLS,
  scheduledTasks: EMPTY_SCHEDULED_TASKS,
  taskFolder: null,
  onTaskFolderChange: undefined,
});

export function SessionOverviewPanel(props: SessionOverviewPanelProps) {
  // Never subscribe to server thread projection / shell / relationship atoms for draft threads,
  // which would otherwise fire GET /api/orchestration/threads/<draftId>/bounded -> HTTP 404.
  if (props.isServerThread) {
    return <ServerSessionOverviewPanel {...props} />;
  }
  return <SessionOverviewPanelContent {...props} serverData={DRAFT_SERVER_DATA} />;
}

function SessionOverviewPanelContent(
  props: SessionOverviewPanelProps & { readonly serverData: ResolvedServerThreadData },
) {
  const gt = useGT();
  const navigate = useNavigate();
  const visible = useClientSettings(resolveThreadDetailsVisibility);

  const [moreMenuOpen, setMoreMenuOpen] = useState(props.defaultMoreMenuOpen === true);
  const [displayPrefs, setDisplayPrefs] = useState<OverviewDisplayPrefs>(() =>
    loadOverviewDisplayPrefs(),
  );
  const effectiveDisplayPrefs = useMemo<OverviewDisplayPrefs>(
    () =>
      props.displayPrefsOverride
        ? {
            limitMode: props.displayPrefsOverride.limitMode ?? displayPrefs.limitMode,
            showCompleted: props.displayPrefsOverride.showCompleted ?? displayPrefs.showCompleted,
          }
        : displayPrefs,
    [displayPrefs, props.displayPrefsOverride],
  );
  const updateDisplayPrefs = useCallback(
    (updater: (current: OverviewDisplayPrefs) => OverviewDisplayPrefs) => {
      setDisplayPrefs((current) => {
        const next = updater(current);
        saveOverviewDisplayPrefs(next);
        return next;
      });
    },
    [],
  );
  const activeOnly = !effectiveDisplayPrefs.showCompleted;
  const [sideComposerOpen, setSideComposerOpen] = useState(false);
  const [activeSideQuestionId, setActiveSideQuestionId] = useState<string | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<OverviewArtifactItem | null>(null);
  const [previewUpload, setPreviewUpload] = useState<{
    readonly item: OverviewUploadItem;
    readonly url: string | null;
  } | null>(null);

  const activeThreadRef = useMemo(
    () => scopeThreadRef(props.environmentId, props.threadId),
    [props.environmentId, props.threadId],
  );
  const project = useProject(scopeProjectRef(props.environmentId, props.projectId));
  const serverConfig = useServerConfigs().get(props.environmentId);
  const {
    threadShell,
    projection,
    relationshipShells,
    scheduledTasks,
    taskFolder,
    onTaskFolderChange,
  } = props.serverData;
  const terminalSessions = useKnownTerminalSessions({
    environmentId: props.isServerThread ? props.environmentId : null,
    threadId: props.isServerThread ? props.threadId : null,
  });
  const discoveredServers = useThreadDiscoveredPorts({
    environmentId: props.isServerThread ? props.environmentId : null,
    threadId: props.isServerThread ? props.threadId : null,
  });
  const daemonPtys = useDaemonPtySessions(props.daemonPtysOverride);

  const gitStatusQuery = useEnvironmentQuery(
    props.gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: props.environmentId,
          input: { cwd: props.gitCwd },
        })
      : null,
  );
  const gitStatus = gitStatusQuery.data ?? null;

  const fileScripts = useT3ProjectFileScripts(
    props.environmentId,
    props.activeProjectScripts && visible.scripts ? props.gitCwd : null,
  );
  const tracksFolders = (project?.trackedFolders?.length ?? 0) > 0;
  const folderIsRepo = props.isGitRepo && taskFolder?.projectIsWorktree !== false;
  const offersGit =
    props.gitCwd !== null &&
    serverConfig !== undefined &&
    project !== null &&
    !isScratchProject(project, serverConfig.scratchWorkspaceRoot);

  // Extract all 8 real-data groups
  const modifiedFiles = useMemo(
    () =>
      extractOverviewModifiedFiles({
        diffStats: props.diffStats,
        gitStatus,
        projection,
      }),
    [gitStatus, projection, props.diffStats],
  );

  const diffTotals = useMemo(
    () =>
      resolveOverviewDiffStats({
        diffStats: props.diffStats,
        gitStatus,
        modifiedFiles,
      }),
    [gitStatus, modifiedFiles, props.diffStats],
  );

  const subagents = useMemo(
    () =>
      extractOverviewSubagents({
        projection,
        relationshipShells,
        currentThreadId: props.threadId,
        activeOnly,
      }),
    [activeOnly, projection, props.threadId, relationshipShells],
  );

  const effectiveSideChatAvailable =
    props.sideChatAvailable ??
    (props.isServerThread && serverConfig?.environment.capabilities.sideChats === true);

  const sideQuestionController = useSideQuestionController({
    environmentId: props.environmentId,
    threadId: props.threadId,
    threadTitle: threadShell?.title ?? projection?.thread.title ?? null,
    cwd: props.worktreePath ?? props.gitCwd ?? project?.workspaceRoot ?? null,
    isServerThread: props.isServerThread,
    sideChatAvailable: effectiveSideChatAvailable,
    sideChatDisabledReason: props.sideChatDisabledReason,
    projection,
    modifiedFiles,
    onOpenSideChat: props.onOpenSideChat,
    readModelSelection: props.readModelSelection,
    onAskSideQuestion: props.onAskSideQuestion,
  });

  const allSideQuestions = useMemo(
    () =>
      extractOverviewSideQuestions({
        persisted: sideQuestionController.records,
        relationshipShells,
        currentThreadId: props.threadId,
        activeOnly: false,
      }),
    [props.threadId, relationshipShells, sideQuestionController.records],
  );

  const sideQuestions = useMemo(
    () =>
      activeOnly
        ? extractOverviewSideQuestions({
            persisted: sideQuestionController.records,
            relationshipShells,
            currentThreadId: props.threadId,
            activeOnly: true,
          })
        : allSideQuestions,
    [
      activeOnly,
      allSideQuestions,
      props.threadId,
      relationshipShells,
      sideQuestionController.records,
    ],
  );

  // Resolve against allSideQuestions so an open detail dialog stays open when an item finishes answering.
  const activeSideQuestion = useMemo(
    () =>
      activeSideQuestionId
        ? (allSideQuestions.find((item) => item.id === activeSideQuestionId) ?? null)
        : null,
    [activeSideQuestionId, allSideQuestions],
  );

  const backgroundTasks = useMemo(
    () =>
      extractOverviewBackgroundTasks({
        daemonPtys,
        terminalSessions: terminalSessions ?? [],
        scheduledTasks,
        discoveredServers,
        projection,
        currentThreadId: props.threadId,
        activeOnly,
      }),
    [
      activeOnly,
      daemonPtys,
      discoveredServers,
      projection,
      props.threadId,
      scheduledTasks,
      terminalSessions,
    ],
  );

  const goalsSummary = useMemo(
    () => extractOverviewGoals({ projection, activeOnly }),
    [activeOnly, projection],
  );

  const artifacts = useMemo(
    () => extractOverviewArtifacts({ projection, modifiedFiles, activeOnly }),
    [activeOnly, modifiedFiles, projection],
  );

  const uploads = useMemo(
    () =>
      extractOverviewUploads({
        projection,
        threadAttachments: props.threadAttachments,
      }),
    [projection, props.threadAttachments],
  );

  const imageUploadResources = useMemo<ReadonlyArray<AssetResource>>(() => {
    if (!props.isServerThread) return EMPTY_ASSET_RESOURCES;
    const imgs = uploads.filter((u) => u.kind === "image");
    if (imgs.length === 0) return EMPTY_ASSET_RESOURCES;
    return imgs.map((u) => ({
      _tag: "attachment" as const,
      attachmentId: u.attachment.id,
      fileName: u.attachment.name,
      mimeType: u.attachment.mimeType,
    }));
  }, [props.isServerThread, uploads]);

  const resolvedImageUrls = useAssetUrls(props.environmentId, imageUploadResources);
  const imageUrlById = useMemo(() => {
    const map = new Map<string, string>();
    imageUploadResources.forEach((resource, idx) => {
      const url = resolvedImageUrls[idx];
      if (url && resource._tag === "attachment") {
        map.set(resource.attachmentId, url);
      }
    });
    return map;
  }, [imageUploadResources, resolvedImageUrls]);

  const usedSkills = useMemo(() => extractOverviewUsedSkills({ projection }), [projection]);

  // Quick action handlers (always focus owning split pane first so right-sidebar targets this threadRef)
  const notifyBeforePanelAction = useCallback(() => {
    props.onBeforePanelAction?.();
  }, [props]);

  const handleOpenDiffReview = useCallback(
    (filePath?: string) => {
      notifyBeforePanelAction();
      if (props.onOpenDiffReview) {
        props.onOpenDiffReview(filePath);
        return;
      }
      if (!filePath && props.onOpenChanges) {
        props.onOpenChanges();
        return;
      }
      useDiffPanelStore.getState().selectGitScope(activeThreadRef, "branch");
      useRightPanelStore.getState().open(activeThreadRef, "diff");
    },
    [activeThreadRef, notifyBeforePanelAction, props],
  );

  const handleOpenFiles = useCallback(() => {
    notifyBeforePanelAction();
    if (props.onOpenFiles) {
      props.onOpenFiles();
      return;
    }
    useRightPanelStore.getState().open(activeThreadRef, "files");
  }, [activeThreadRef, notifyBeforePanelAction, props]);

  const handleOpenWorkspaceFile = useCallback(
    (relativePath: string, line?: number) => {
      notifyBeforePanelAction();
      if (props.onOpenFile) {
        props.onOpenFile(relativePath, line);
        return;
      }
      useRightPanelStore.getState().openFile(activeThreadRef, relativePath, line);
    },
    [activeThreadRef, notifyBeforePanelAction, props],
  );

  const handleContinueInTerminal = useCallback(() => {
    if (props.continueInTerminalDisabled) return;
    notifyBeforePanelAction();
    if (props.onContinueInTerminal) {
      props.onContinueInTerminal();
      return;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("prismux:continue-in-terminal", {
          detail: {
            environmentId: props.environmentId,
            threadId: props.threadId,
            cwd: props.worktreePath ?? props.gitCwd ?? null,
          },
        }),
      );
    }
    useRightPanelStore.getState().openTerminal(activeThreadRef, DEFAULT_THREAD_TERMINAL_ID);
  }, [activeThreadRef, notifyBeforePanelAction, props]);

  const handleOpenSubagent = useCallback(
    (item: OverviewSubagentItem) => {
      if (!item.childThreadId) return;
      notifyBeforePanelAction();
      openSideThread({
        threadRef: scopeThreadRef(props.environmentId, item.childThreadId),
        panelRef: activeThreadRef,
        intent: "panel",
        navigate: (ref) =>
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(ref),
          }),
      });
    },
    [activeThreadRef, navigate, notifyBeforePanelAction, props.environmentId],
  );

  const handleOpenBackgroundTask = useCallback(
    (task: OverviewBackgroundTaskItem) => {
      notifyBeforePanelAction();
      if (task.kind === "automation" && task.taskId) {
        void navigate({
          to: "/settings/scheduled-tasks",
          search: { environmentId: props.environmentId, taskId: task.taskId },
        });
        return;
      }
      useRightPanelStore
        .getState()
        .openTerminal(activeThreadRef, task.terminalId ?? DEFAULT_THREAD_TERMINAL_ID);
    },
    [activeThreadRef, navigate, notifyBeforePanelAction, props.environmentId],
  );

  const handleOpenArtifact = useCallback(
    (artifact: OverviewArtifactItem) => {
      if (artifact.markdown) {
        setPreviewArtifact(artifact);
        return;
      }
      if (artifact.relativePath) {
        handleOpenWorkspaceFile(artifact.relativePath);
        return;
      }
      setPreviewArtifact(artifact);
    },
    [handleOpenWorkspaceFile],
  );

  const handleOpenFileDiff = useCallback(
    (file: OverviewModifiedFileItem) => {
      notifyBeforePanelAction();
      if (props.onOpenDiffReview) {
        props.onOpenDiffReview(file.path);
        return;
      }
      if (props.isServerThread && (props.isGitRepo || folderIsRepo)) {
        if (file.runId) {
          useDiffPanelStore.getState().selectTurn(activeThreadRef, file.runId, file.path);
        } else {
          useDiffPanelStore.getState().selectGitScope(activeThreadRef, "branch");
        }
        useRightPanelStore.getState().open(activeThreadRef, "diff");
        return;
      }
      handleOpenWorkspaceFile(file.path);
    },
    [activeThreadRef, folderIsRepo, handleOpenWorkspaceFile, notifyBeforePanelAction, props],
  );

  const handleOpenUpload = useCallback(
    (item: OverviewUploadItem, previewUrl: string | null) => {
      if (item.kind === "image") {
        setPreviewUpload({ item, url: previewUrl });
        return;
      }
      if (item.attachment.type === "file") {
        notifyBeforePanelAction();
        useRightPanelStore
          .getState()
          .openAttachment(activeThreadRef, item.attachment as ChatFileAttachment);
        return;
      }
      setPreviewUpload({ item, url: previewUrl });
    },
    [activeThreadRef, notifyBeforePanelAction],
  );

  const branchToolbarProps = {
    showGitControls: folderIsRepo,
    environmentId: props.environmentId,
    threadId: props.threadId,
    projectId: props.projectId,
    worktreePath: props.worktreePath,
    isServerThread: props.isServerThread,
    ...(props.draftId ? { draftId: props.draftId } : {}),
    onEnvModeChange: props.onEnvModeChange,
    startFromOrigin: props.startFromOrigin,
    onStartFromOriginChange: props.onStartFromOriginChange,
    envMode: props.envMode,
    ...(props.activeThreadBranchOverride !== undefined
      ? { activeThreadBranchOverride: props.activeThreadBranchOverride }
      : {}),
    ...(props.onActiveThreadBranchOverrideChange
      ? { onActiveThreadBranchOverrideChange: props.onActiveThreadBranchOverrideChange }
      : {}),
    envLocked: props.envLocked,
    forceNewWorktree: props.forceNewWorktree ?? false,
    onComposerFocusRequest: props.onComposerFocusRequest,
    ...(props.onCheckoutPullRequestRequest
      ? { onCheckoutPullRequestRequest: props.onCheckoutPullRequestRequest }
      : {}),
  };

  const hasLinkedPullRequests = (threadShell?.pullRequests?.length ?? 0) > 0;
  const showGitActionsInMenu =
    offersGit &&
    props.activeProjectName !== undefined &&
    (folderIsRepo || (!tracksFolders && taskFolder === null));

  const contextMessageCount = (projection?.messages ?? []).filter(
    (msg) => msg.role === "user" || msg.role === "assistant",
  ).length;

  const hasDiffChanges = diffTotals.insertions > 0 || diffTotals.deletions > 0;
  const showSubagents = subagents.length > 0;
  const showSideQuestions = sideQuestions.length > 0 || sideComposerOpen;
  const showBackgroundTasks = backgroundTasks.length > 0;
  const showGoals = goalsSummary.items.length > 0;
  const showArtifacts = artifacts.length > 0;
  const showModifiedFiles = modifiedFiles.length > 0;
  const showUploads = uploads.length > 0;
  const showUsedSkills = usedSkills.length > 0;
  const activeSectionCount = [
    showSubagents,
    showSideQuestions,
    showBackgroundTasks,
    showGoals,
    showArtifacts,
    showModifiedFiles,
    showUploads,
    showUsedSkills,
  ].filter(Boolean).length;
  const hasAnyOverviewSection = activeSectionCount > 0;

  const floatingClearance = computeFloatingOverviewClearance({
    composerHeightPx: props.bottomClearancePx,
    topInsetPx: props.topInsetPx,
    containerHeightPx: props.containerHeightPx,
  });

  const effectiveAvailableHeightPx =
    props.availableHeightPx !== undefined
      ? props.availableHeightPx
      : props.floating
        ? floatingClearance.availableHeightPx
        : 0;

  const dynamicAutoLimit = computeDynamicOverviewSectionLimit({
    availableHeightPx: effectiveAvailableHeightPx,
    activeSectionCount,
    limitMode: "auto",
    hasLinkedPrs: hasLinkedPullRequests,
  });

  const dynamicSectionLimit = computeDynamicOverviewSectionLimit({
    availableHeightPx: effectiveAvailableHeightPx,
    activeSectionCount,
    limitMode: effectiveDisplayPrefs.limitMode,
    hasLinkedPrs: hasLinkedPullRequests,
  });

  const panelCard = (
    <div
      data-pmx-glass-zone="overviewPanel"
      data-session-overview-panel="1"
      data-overview-pane-id={props.paneId ?? undefined}
      data-overview-thread-id={props.threadId}
      data-overview-floating={props.floating ? "true" : undefined}
      data-overview-composer-clearance={
        props.floating
          ? String(floatingClearance.composerHeightPx ?? OVERVIEW_DEFAULT_COMPOSER_HEIGHT_PX)
          : undefined
      }
      data-overview-section-limit={dynamicSectionLimit}
      data-overview-show-completed={effectiveDisplayPrefs.showCompleted ? "1" : "0"}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl bg-clip-padding text-foreground",
        props.floating && "dropdown-glass pointer-events-auto w-full flex-initial shadow-lg",
      )}
    >
      {/* Top Header Bar: 概览 + ⋮ More Menu (losslessly housing workspace/host, open-in, scripts, git & usage) */}
      <header className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5">
        <h2 className="truncate text-[13px] font-semibold tracking-tight text-foreground select-none">
          概览
        </h2>

        <div className="flex shrink-0 items-center gap-0.5">
        <Popover open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="更多操作"
                title="更多工作区操作（环境/主机、资源管理器、项目脚本、Git 与用量）"
                data-overview-more-trigger="1"
                className="size-6.5 rounded-md text-muted-foreground hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.1]"
              >
                <MoreVerticalIcon className="size-3.5" aria-hidden />
              </Button>
            }
          />
          <PopoverPopup
            align="end"
            side="bottom"
            sideOffset={6}
            padding="none"
            keepMounted={props.showOpenInPicker && props.openInShortcutEnabled}
            data-pmx-glass-zone="overlays"
            data-overview-more-popover="1"
            className="w-[292px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-clip-padding"
          >
            <div className="max-h-[min(72dvh,540px)] overflow-y-auto p-1.5">
              {/* Always-available Side Question trigger even while zero-count sections stay hidden */}
              <div className="mb-1 border-b border-border/50 pb-1">
                <button
                  type="button"
                  data-overview-more-action="add-side-question"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    setSideComposerOpen(true);
                  }}
                  className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-left text-xs font-medium text-foreground/90 transition-colors hover:bg-black/[0.045] hover:text-foreground dark:hover:bg-white/[0.075]"
                >
                  <MessageSquarePlusIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1 truncate">发起旁路提问</span>
                </button>
              </div>

              {/* AGY-style overview display preferences (show completed items + per-section max visible count) */}
              <OverviewDisplayPrefsMenuSection
                prefs={effectiveDisplayPrefs}
                effectiveLimit={dynamicSectionLimit}
                autoLimit={dynamicAutoLimit}
                onToggleShowCompleted={() =>
                  updateDisplayPrefs((prev) => ({ ...prev, showCompleted: !prev.showCompleted }))
                }
                onSelectLimitMode={(limitMode) =>
                  updateDisplayPrefs((prev) => ({ ...prev, limitMode }))
                }
              />

              {/* Lossless original workspace controls: Environment/Host, Open In Explorer/Editor, Project Scripts */}
              <section
                aria-label={gt("Workspace")}
                className="space-y-0.5 pb-1.5"
                data-overview-more-section="workspace"
              >
                <div className="px-2 py-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground">
                  工作区与环境
                </div>
                <BranchToolbar
                  layout="panel"
                  panelSection="workspace"
                  availableEnvironments={props.availableEnvironments}
                  {...(props.onEnvironmentChange
                    ? { onEnvironmentChange: props.onEnvironmentChange }
                    : {})}
                  autoEnvironmentLabel={props.autoEnvironmentLabel}
                  onAutoEnvironment={props.onAutoEnvironment}
                  {...branchToolbarProps}
                />

                {props.showOpenInPicker ? (
                  <OpenInPicker
                    keybindings={props.keybindings}
                    environmentId={props.environmentId}
                    availableEditors={props.availableEditors}
                    openInCwd={props.gitCwd}
                    enableShortcut={props.openInShortcutEnabled}
                    displayMode="panel"
                  />
                ) : null}

                {props.activeProjectScripts !== undefined ? (
                  <ProjectScriptsControl
                    environmentId={props.environmentId}
                    displayMode="panel"
                    scripts={props.activeProjectScripts}
                    fileScripts={fileScripts}
                    preferredScriptId={props.preferredScriptId}
                    onRunScript={props.onRunProjectScript}
                    onAddScript={props.onAddProjectScript}
                    onUpdateScript={props.onUpdateProjectScript}
                    onDeleteScript={props.onDeleteProjectScript}
                  />
                ) : null}
              </section>

              {/* Version Control & Git Actions */}
              {moreMenuOpen && offersGit ? (
                <section
                  aria-label={gt("Version Control")}
                  className="space-y-0.5 border-t border-border/50 py-1.5"
                  data-overview-more-section="version-control"
                >
                  <div className="px-2 py-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground">
                    版本控制与分支
                  </div>
                  {folderIsRepo ? (
                    <BranchToolbar layout="panel" panelSection="branch" {...branchToolbarProps} />
                  ) : null}
                  {showGitActionsInMenu && props.gitCwd ? (
                    <GitActionsControl
                      compact={false}
                      showActions
                      showChanges={folderIsRepo}
                      gitCwd={props.gitCwd}
                      name={props.activeProjectName ?? ""}
                      workspaceMutationId={props.workspaceMutationId}
                      activeThreadRef={props.isServerThread ? activeThreadRef : null}
                      {...(props.draftId ? { draftId: props.draftId } : {})}
                      onOpenChanges={() => {
                        setMoreMenuOpen(false);
                        handleOpenDiffReview();
                      }}
                    />
                  ) : null}
                  <ThreadRepositorySections
                    environmentId={props.environmentId}
                    threadId={props.threadId}
                    projectId={props.projectId}
                    isServerThread={props.isServerThread}
                    threadCwd={props.gitCwd}
                    taskFolder={taskFolder}
                    reachesTracked={
                      props.worktreePath === null ? tracksFolders : taskFolder !== null
                    }
                    onTaskFolderChange={onTaskFolderChange ?? (() => {})}
                    explainsEmpty={!folderIsRepo}
                    showActions
                  />
                </section>
              ) : null}

              {/* Usage & Context Window */}
              <div className="border-t border-border/50 pt-1">
                <ThreadDetailsUsage {...props.usage} />
                {props.usage.contextWindow ? (
                  <ThreadDetailsContext usage={props.usage.contextWindow} />
                ) : null}
              </div>

              {/* Visibility Preferences Sub-menu */}
              <div className="border-t border-border/50 pt-1">
                <Menu>
                  <MenuTrigger
                    render={
                      <button
                        type="button"
                        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-left text-xs font-medium text-muted-foreground hover:bg-black/[0.045] hover:text-foreground dark:hover:bg-white/[0.075]"
                      >
                        <SlidersHorizontalIcon className="size-3.5 shrink-0" aria-hidden />
                        <span className="flex-1 truncate">自定义菜单显示项</span>
                        <ChevronRightIcon className="size-3.5 shrink-0 opacity-60" aria-hidden />
                      </button>
                    }
                  />
                  <MenuPopup side="left" align="end">
                    <ThreadDetailsItemsMenuItems />
                  </MenuPopup>
                </Menu>
              </div>
            </div>
          </PopoverPopup>
        </Popover>
        {props.onCollapse ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="收起概览"
            title="收起当前分屏概览"
            data-overview-collapse-trigger="1"
            onClick={props.onCollapse}
            className="size-6.5 rounded-md text-muted-foreground hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.1]"
          >
            <XIcon className="size-3.5" aria-hidden />
          </Button>
        ) : null}
        </div>
      </header>

      {/* Scrollable Overview Body: scrolls smoothly within floating max-height without touching composer */}
      <div
        data-overview-scroll-body="1"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {/* Top 3 Quick Action Rows (Review with live +/- stats, File List, Continue in Terminal — NO Plugins row!) */}
        <nav
          aria-label="快捷入口"
          data-overview-quick-actions="1"
          className="flex flex-col gap-0.5 px-1.5 py-1.5"
        >
        <button
          type="button"
          data-overview-action="review"
          onClick={() => handleOpenDiffReview()}
          className="group flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-left text-[13px] font-medium text-foreground/90 transition-colors hover:bg-black/[0.045] dark:hover:bg-white/[0.08]"
        >
          <GitCompareArrowsIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">审查</span>
          {hasDiffChanges ? (
            <span
              data-overview-diff-stats="1"
              className="flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] font-medium tabular-nums"
            >
              <span
                data-overview-diff-insertions="1"
                className="text-emerald-600 dark:text-emerald-400"
              >
                +{diffTotals.insertions}
              </span>
              <span
                data-overview-diff-deletions="1"
                className="text-rose-600 dark:text-rose-400"
              >
                -{diffTotals.deletions}
              </span>
            </span>
          ) : null}
        </button>

        <button
          type="button"
          data-overview-action="files"
          onClick={handleOpenFiles}
          className="group flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-left text-[13px] font-medium text-foreground/90 transition-colors hover:bg-black/[0.045] dark:hover:bg-white/[0.08]"
        >
          <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">文件列表</span>
          <ChevronRightIcon
            className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </button>

        <button
          type="button"
          data-overview-action="continue-in-terminal"
          disabled={props.continueInTerminalDisabled}
          onClick={handleContinueInTerminal}
          title={
            props.continueInTerminalLabel
              ? `在终端继续（${props.continueInTerminalLabel}）`
              : "打开会话交接对话框或在持久终端中继续当前会话"
          }
          className={cn(
            "group flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-left text-[13px] font-medium text-foreground/90 transition-colors hover:bg-black/[0.045] dark:hover:bg-white/[0.08]",
            props.continueInTerminalDisabled && "cursor-not-allowed opacity-50",
          )}
        >
          <TerminalIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">在终端继续</span>
          <ChevronRightIcon
            className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </button>

        <AgentAuxOverviewEntryButton
          entry={props.agentAuxEntry}
          onOpen={
            props.onOpenAgentAux
              ? () => {
                  notifyBeforePanelAction();
                  props.onOpenAgentAux?.();
                }
              : undefined
          }
        />
      </nav>

      {/* Compact linked pull request strip when the thread is attached to PR(s) */}
      {hasLinkedPullRequests ? (
        <div
          data-thread-details-pr-list
          className="border-t border-border/50 px-1.5 py-1"
        >
          <ThreadDetailsThreadPrRows
            threadRef={activeThreadRef}
            project={project}
            composerTarget={props.composerDraftTarget}
          />
        </div>
      ) : null}

      {/* 8 Structured AGY-style Overview Sections: hidden when count === 0, dynamically appear on real data */}
      {hasAnyOverviewSection ? (
        <div data-thread-relationships-panel className="flex flex-col pb-1.5">
          {showSubagents ? (
            <SubagentsOverviewSection
              items={subagents}
              maxVisibleItems={dynamicSectionLimit}
              onOpenSubagent={handleOpenSubagent}
            />
          ) : null}

          {showSideQuestions ? (
            <SideQuestionsOverviewSection
              items={sideQuestions}
              maxVisibleItems={dynamicSectionLimit}
              composerOpen={sideComposerOpen}
              onToggleComposer={() => setSideComposerOpen((prev) => !prev)}
              onSelectItem={(item) => {
                // Native / live BTW items open directly in the right-panel multi-turn SideThreadPane tab.
                if (item.linkedSideThreadId) {
                  notifyBeforePanelAction();
                  useRightPanelStore
                    .getState()
                    .openThread(activeThreadRef, item.linkedSideThreadId);
                  return;
                }
                setActiveSideQuestionId(item.id);
              }}
              composerSlot={
                <SideQuestionComposer
                  open={sideComposerOpen}
                  submitting={sideQuestionController.submitting}
                  online={effectiveSideChatAvailable || Boolean(props.onAskSideQuestion)}
                  contextMessageCount={contextMessageCount}
                  onClose={() => setSideComposerOpen(false)}
                  onSubmit={async (question) => {
                    const created = await sideQuestionController.ask(question);
                    setSideComposerOpen(false);
                    if (created?.linkedSideThreadId) {
                      notifyBeforePanelAction();
                      useRightPanelStore
                        .getState()
                        .openThread(activeThreadRef, ThreadId.make(created.linkedSideThreadId));
                    } else if (created) {
                      setActiveSideQuestionId(created.id);
                    }
                  }}
                />
              }
            />
          ) : null}

          {showBackgroundTasks ? (
            <BackgroundTasksOverviewSection
              items={backgroundTasks}
              maxVisibleItems={dynamicSectionLimit}
              onOpenTask={handleOpenBackgroundTask}
            />
          ) : null}

          {showGoals ? (
            <GoalsOverviewSection summary={goalsSummary} maxVisibleItems={dynamicSectionLimit} />
          ) : null}

          {showArtifacts ? (
            <ArtifactsOverviewSection
              items={artifacts}
              maxVisibleItems={dynamicSectionLimit}
              onOpenArtifact={handleOpenArtifact}
            />
          ) : null}

          {showModifiedFiles ? (
            <ModifiedFilesOverviewSection
              items={modifiedFiles}
              maxVisibleItems={dynamicSectionLimit}
              onOpenFileDiff={handleOpenFileDiff}
            />
          ) : null}

          {showUploads ? (
            <UploadsOverviewSection
              items={uploads}
              maxVisibleItems={dynamicSectionLimit}
              imageUrlById={imageUrlById}
              onOpenUpload={handleOpenUpload}
            />
          ) : null}

          {showUsedSkills ? (
            <UsedSkillsOverviewSection
              items={usedSkills}
              maxVisibleItems={dynamicSectionLimit}
            />
          ) : null}
        </div>
      ) : null}
      </div>

      {/* Inner Overlay Dialogs (all strictly tagged with data-pmx-glass-zone="overlays") */}
      <SideQuestionDetailDialog
        item={activeSideQuestion}
        environmentId={props.environmentId}
        threadId={props.threadId}
        submitting={sideQuestionController.submitting}
        onClose={() => setActiveSideQuestionId(null)}
        onRetry={sideQuestionController.retry}
        onRemove={sideQuestionController.remove}
        onSyncAnswer={sideQuestionController.syncAnswer}
      />

      <ArtifactPreviewDialog
        artifact={previewArtifact}
        onClose={() => setPreviewArtifact(null)}
        onOpenWorkspaceFile={handleOpenWorkspaceFile}
      />

      <UploadPreviewDialog
        target={previewUpload}
        onClose={() => setPreviewUpload(null)}
        onOpenAttachmentFile={(attachment) => {
          if (attachment.type === "file") {
            notifyBeforePanelAction();
            useRightPanelStore
              .getState()
              .openAttachment(activeThreadRef, attachment as ChatFileAttachment);
          }
        }}
      />
    </div>
  );

  if (!props.floating) {
    return panelCard;
  }

  const floatingShellStyle: CSSProperties = {
    position: "absolute",
    top: `${floatingClearance.topPx}px`,
    right: `${floatingClearance.rightPx}px`,
    zIndex: OVERVIEW_FLOATING_Z_INDEX,
    maxHeight: floatingClearance.maxHeightCss,
    ...(floatingClearance.composerHeightPx !== null
      ? ({ "--pmx-composer-height": `${floatingClearance.composerHeightPx}px` } as CSSProperties)
      : {}),
  };

  return (
    <aside
      {...workspaceAreaProps("details", 3, gt("Thread details"))}
      data-workspace-focus-key={`details:${props.paneId ? `${props.paneId}:` : ""}${props.environmentId}:${props.threadId}`}
      data-overview-pane-id={props.paneId ?? undefined}
      data-overview-thread-id={props.threadId}
      data-overview-floating-shell="true"
      data-overview-max-height-css={floatingClearance.maxHeightCss}
      className={cn(
        "pointer-events-none absolute flex w-[var(--thread-details-panel-width,280px)] max-w-[calc(100%-24px)] flex-col",
        floatingClearance.topPx > OVERVIEW_FLOATING_TOP_GAP_PX &&
          "transition-[top,max-height] duration-150 ease-out motion-reduce:transition-none",
      )}
      style={floatingShellStyle}
    >
      {panelCard}
    </aside>
  );
}
