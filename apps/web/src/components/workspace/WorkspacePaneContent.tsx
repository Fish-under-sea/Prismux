import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@prismux/client-runtime/environment";
import type {
  EnvironmentId,
  ProviderInstanceId,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
  ThreadId,
} from "@prismux/core-contracts";
import {
  ArrowRightIcon,
  ExternalLinkIcon,
  FilesIcon,
  GitCompareArrowsIcon,
  GlobeIcon,
  MessageSquarePlusIcon,
  RefreshCwIcon,
  TabletSmartphoneIcon,
  TerminalIcon,
} from "lucide-react";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { cn } from "~/lib/utils";
import { ComposerHandleContext } from "../../composerHandleContext";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useScratchProject } from "../../hooks/useScratchProject";
import type { SideChatParentPanel } from "../../lib/sideChatPane";
import type { TerminalContextSelection } from "../../lib/terminalContext";
import {
  AgentBrandLogo,
  formatAgentBrandName,
  resolveProviderEntryDisplayName,
} from "../../prismux/agentBrand";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { useRightPanelStore, type RightPanelSurface } from "../../rightPanelStore";
import { useProjects, useQuietThreadShell } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import {
  environmentServerConfigsAtom,
  primaryServerKeybindingsAtom,
} from "../../state/server";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { LinkedItemsEmptySurface, SideChatEmptySurface } from "../chat/RightPanelEmptySurfaces";
import type { ModelEsque } from "../chat/providerIconUtils";
import { PersistentThreadTerminalPanel } from "../PersistentThreadTerminals";
import { ThreadPullRequestsPanel } from "../pullRequest/ThreadPullRequestsPanel";
import { PhoneSimulatorBlankStage } from "../RightPanelTabs";
import { useThreadTerminalActions } from "../terminal/useThreadTerminalActions";
import { Button } from "../ui/button";
import { classifyQuickLaunchUrl, type QuickLaunchHistoryThread } from "./workspaceQuickLaunch.logic";
import { PrismuxStageFrame } from "./WorkspaceTopbarPortalContext";
import type { WorkspaceTab } from "./workspaceTabsStore";

const ChatView = lazy(() => import("../ChatView"));
const DiffPanel = lazy(() => import("../DiffPanel"));
const PreviewPanel = lazy(() =>
  import("../preview/PreviewPanel").then((module) => ({ default: module.PreviewPanel })),
);
const FilePreviewPanel = lazy(() => import("../files/FilePreviewPanel"));
const DevicePanel = lazy(() =>
  import("../device/DevicePanel").then((module) => ({ default: module.DevicePanel })),
);

const GENERIC_SESSION_LABELS = new Set([
  "新会话",
  "会话",
  "新标签页",
  "new thread",
  "new session",
  "new chat",
  "untitled",
]);

function resolveConversationBrandName(
  tab: WorkspaceTab,
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>,
): string {
  if (tab.instanceId) {
    const exact = instanceEntries.find((entry) => entry.instanceId === tab.instanceId);
    if (exact) return resolveProviderEntryDisplayName(exact);
  }
  const rawProvider = tab.providerId?.trim() ?? "";
  if (rawProvider.length > 0 && !GENERIC_SESSION_LABELS.has(rawProvider.toLowerCase())) {
    const formatted = formatAgentBrandName(rawProvider);
    const matched = instanceEntries.find(
      (entry) =>
        entry.enabled &&
        resolveProviderEntryDisplayName(entry).toLowerCase() === formatted.toLowerCase(),
    );
    return matched ? resolveProviderEntryDisplayName(matched) : formatted;
  }
  const rawTitle = tab.title?.trim() ?? "";
  if (rawTitle.length > 0 && !GENERIC_SESSION_LABELS.has(rawTitle.toLowerCase())) {
    return formatAgentBrandName(rawTitle, rawTitle);
  }
  const defaultEntry = instanceEntries.find((entry) => entry.enabled) ?? instanceEntries[0] ?? null;
  return defaultEntry ? resolveProviderEntryDisplayName(defaultEntry) : "Agent";
}

export interface WorkspacePaneContentProps {
  readonly paneId: string;
  readonly tab: WorkspaceTab;
  readonly activeHostThreadRef: ScopedThreadRef | null;
  readonly environmentId: EnvironmentId | null;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly historyThreads: ReadonlyArray<QuickLaunchHistoryThread>;
  readonly onUpdateTab: (
    tabId: string,
    patch: Partial<Pick<WorkspaceTab, "title" | "url" | "providerId" | "instanceId" | "model">>,
  ) => void;
  readonly onOpenHistoryThreadInPane: (thread: QuickLaunchHistoryThread, paneId: string) => void;
  readonly onLaunchAgentPrompt: (input: {
    readonly paneId: string;
    readonly tabId: string;
    readonly providerId: string;
    readonly instanceId: ProviderInstanceId | null;
    readonly model: string | null;
    readonly prompt: string;
  }) => void;
  readonly onOpenQuickTool: (tool: "terminal" | "diff" | "browser" | "simulator", paneId: string) => void;
  readonly onOpenConversationInMainChat?: ((paneId: string, tab: WorkspaceTab) => void) | undefined;
}

const STAGE_TITLE_GLASS_CLASS =
  "text-foreground dark:[[data-pmx-glass='1']_&]:text-white dark:[[data-pmx-glass='1']_&]:[text-shadow:0_1px_6px_rgba(0,0,0,0.48)] dark:[[data-pmx-wallpaper-visible='1']_&]:[text-shadow:0_1px_8px_rgba(0,0,0,0.56)] light:[[data-pmx-glass='1']_&]:[text-shadow:0_1px_4px_rgba(255,255,255,0.7)]";

const STAGE_SUBTITLE_GLASS_CLASS =
  "text-muted-foreground [[data-pmx-glass='1']_&]:text-foreground/92 [[data-pmx-wallpaper='1']_&]:text-foreground/92 [[data-pmx-wallpaper-visible='1']_&]:text-foreground/95 dark:[[data-pmx-glass='1']_&]:text-white/92 dark:[[data-pmx-wallpaper='1']_&]:text-white/92 dark:[[data-pmx-wallpaper-visible='1']_&]:text-white/95 dark:[[data-pmx-glass='1']_&]:[text-shadow:0_1px_4px_rgba(0,0,0,0.58),0_0_12px_rgba(0,0,0,0.34)] dark:[[data-pmx-wallpaper-visible='1']_&]:[text-shadow:0_1px_5px_rgba(0,0,0,0.65),0_0_14px_rgba(0,0,0,0.38)] light:[[data-pmx-glass='1']_&]:text-foreground/90 light:[[data-pmx-glass='1']_&]:[text-shadow:0_1px_3px_rgba(255,255,255,0.76)]";

function EmbeddedThreadPaneView(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly hostRef: ScopedThreadRef;
}) {
  const { environmentId, threadId, hostRef } = props;
  const parentPanel = useMemo<SideChatParentPanel>(
    () => ({
      hostRef,
      openToolDiff: () => {
        useRightPanelStore.getState().open(hostRef, "diff");
      },
      runShellCommand: () => {
        useRightPanelStore.getState().openTerminal(hostRef, "default");
      },
    }),
    [hostRef],
  );

  return (
    <PrismuxStageFrame innerDataAttributes={{ "data-side-chat-pane": threadId }}>
      <BackgroundThreadContext value>
        <ComposerHandleContext value={null}>
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                正在加载会话...
              </div>
            }
          >
            <ChatView
              key={`${environmentId}:${threadId}`}
              environmentId={environmentId}
              threadId={threadId}
              routeKind="server"
              embedded={parentPanel}
            />
          </Suspense>
        </ComposerHandleContext>
      </BackgroundThreadContext>
    </PrismuxStageFrame>
  );
}

function EmbeddedTerminalTabView(props: {
  readonly tab: WorkspaceTab;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const { tab, threadRef } = props;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const terminalId = tab.resourceId ?? `ws-term-${tab.id}`;
  const [terminalIds, setTerminalIds] = useState<string[]>([terminalId]);
  const [activeTerminalId, setActiveTerminalId] = useState<string>(terminalId);
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const primaryEnvId = usePrimaryEnvironmentId();
  const fallbackEnvId = scratchEnvironmentId(primaryEnvId);

  if (!threadRef) {
    return (
      <PrismuxStageFrame innerClassName="items-center justify-center gap-3 p-6 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl border border-border/70 bg-muted/40 [[data-pmx-glass='1']_&]:border-white/20 [[data-pmx-glass='1']_&]:bg-background/50">
          <TerminalIcon className="size-5 text-muted-foreground dark:[[data-pmx-glass='1']_&]:text-white/90" />
        </div>
        <div className="space-y-1">
          <h3 className={cn("text-sm font-medium", STAGE_TITLE_GLASS_CLASS)}>
            {tab.title || "PowerShell"}
          </h3>
          <p className={cn("max-w-sm text-xs", STAGE_SUBTITLE_GLASS_CLASS)}>
            打开任意工作区会话后即可直连 Prismux Server 持久化终端（支持多窗口与无损重连）。
          </p>
        </div>
        {fallbackEnvId ? (
          <Button size="sm" variant="outline" onClick={() => void startScratchThread(fallbackEnvId)}>
            快速创建无项目工作区并开启终端
          </Button>
        ) : null}
      </PrismuxStageFrame>
    );
  }

  return (
    <BoundTerminalSurface
      threadRef={threadRef}
      terminalId={terminalId}
      terminalIds={terminalIds}
      activeTerminalId={activeTerminalId}
      keybindings={keybindings}
      onNewTerminal={() => {
        const nextId = `${terminalId}-${terminalIds.length + 1}`;
        setTerminalIds((prev) => [...prev, nextId]);
        setActiveTerminalId(nextId);
      }}
      onActiveTerminalChange={setActiveTerminalId}
      onCloseTerminal={(closedId) => {
        setTerminalIds((prev) => {
          const next = prev.filter((id) => id !== closedId);
          return next.length > 0 ? next : [terminalId];
        });
      }}
    />
  );
}

function BoundTerminalSurface(props: {
  readonly threadRef: ScopedThreadRef;
  readonly terminalId: string;
  readonly terminalIds: string[];
  readonly activeTerminalId: string;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly onNewTerminal: () => void;
  readonly onActiveTerminalChange: (id: string) => void;
  readonly onCloseTerminal: (id: string) => void;
}) {
  const terminalActions = useThreadTerminalActions(props.threadRef);
  const surface = useMemo<Extract<RightPanelSurface, { kind: "terminal" }>>(
    () => ({
      id: `terminal:${props.terminalId}`,
      kind: "terminal",
      resourceId: props.terminalId,
      terminalIds: props.terminalIds,
      activeTerminalId: props.activeTerminalId,
    }),
    [props.activeTerminalId, props.terminalId, props.terminalIds],
  );

  const handleAddContext = useCallback(
    (selection: TerminalContextSelection) => {
      useComposerDraftStore.getState().addTerminalContexts(props.threadRef, [
        {
          id: `ws-term-ctx-${Date.now().toString(36)}`,
          threadId: props.threadRef.threadId,
          ...selection,
          createdAt: new Date().toISOString(),
        },
      ]);
    },
    [props.threadRef],
  );

  return (
    <PrismuxStageFrame innerDataAttributes={{ "data-workspace-terminal-pane": "true" }}>
      <PersistentThreadTerminalPanel
        visible
        threadRef={props.threadRef}
        surface={surface}
        launchContext={null}
        keybindings={props.keybindings}
        onAddTerminalContext={handleAddContext}
        onSplitTerminal={props.onNewTerminal}
        onSplitTerminalVertical={props.onNewTerminal}
        onNewTerminal={props.onNewTerminal}
        onActiveTerminalChange={props.onActiveTerminalChange}
        onCloseTerminal={(id) => {
          terminalActions.closeTerminalSession(id);
          props.onCloseTerminal(id);
        }}
      />
    </PrismuxStageFrame>
  );
}

function EmbeddedDiffTabView(props: { readonly threadRef: ScopedThreadRef | null }) {
  const { threadRef } = props;
  if (!threadRef) {
    return (
      <PrismuxStageFrame innerClassName="items-center justify-center gap-2 p-6 text-center">
        <GitCompareArrowsIcon className="size-6 text-muted-foreground dark:[[data-pmx-glass='1']_&]:text-white/90" />
        <p className={cn("text-sm font-medium", STAGE_TITLE_GLASS_CLASS)}>Git 差异视图</p>
        <p className={cn("max-w-xs text-xs", STAGE_SUBTITLE_GLASS_CLASS)}>
          请先在左侧选择或新建一个项目会话，即可在此窗格查看实时 Git 变更与文件 Diff。
        </p>
      </PrismuxStageFrame>
    );
  }
  return (
    <PrismuxStageFrame innerDataAttributes={{ "data-workspace-diff-pane": "true" }}>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            正在加载差异视图...
          </div>
        }
      >
        <DiffPanel
          key={`${threadRef.environmentId}:${threadRef.threadId}`}
          mode="embedded"
          composerDraftTarget={threadRef}
          workspaceMutationId={null}
          visible
        />
      </Suspense>
    </PrismuxStageFrame>
  );
}

function EmbeddedBrowserTabView(props: {
  readonly tab: WorkspaceTab;
  readonly threadRef: ScopedThreadRef | null;
  readonly onUpdateUrl: (url: string, title: string) => void;
}) {
  const { tab, threadRef, onUpdateUrl } = props;
  const [addressInput, setAddressInput] = useState(tab.url ?? "");
  const [reloadNonce, setReloadNonce] = useState(0);
  const currentUrl = tab.url ?? "";

  const hostedPreviewTabId =
    tab.resourceId &&
    tab.resourceId !== "browser:new" &&
    !tab.resourceId.startsWith("ws-browser-")
      ? tab.resourceId
      : null;

  const handleNavigate = (event: FormEvent) => {
    event.preventDefault();
    const classified = classifyQuickLaunchUrl(addressInput);
    if (!classified) return;
    onUpdateUrl(classified.normalizedUrl, classified.displayHost);
    setAddressInput(classified.normalizedUrl);
  };

  // Dragged desktop browser tabs preserve their live Electron <webview> PreviewPanel session.
  if (hostedPreviewTabId && threadRef) {
    return (
      <PrismuxStageFrame innerDataAttributes={{ "data-workspace-browser-pane": "true" }}>
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              正在加载内置浏览器...
            </div>
          }
        >
          <PreviewPanel mode="embedded" threadRef={threadRef} tabId={hostedPreviewTabId} visible />
        </Suspense>
      </PrismuxStageFrame>
    );
  }

  return (
    <PrismuxStageFrame innerDataAttributes={{ "data-workspace-browser-pane": "true" }}>
      <form
        onSubmit={handleNavigate}
        className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border/65 bg-muted/25 px-2.5"
      >
        <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="text"
          value={addressInput}
          onChange={(event) => setAddressInput(event.target.value)}
          placeholder="输入网址或本地端口，例如 http://localhost:5173 ..."
          className="h-7 min-w-0 flex-1 rounded-md border border-border/65 bg-background/70 px-2.5 text-xs text-foreground outline-none focus-visible:border-ring"
        />
        <Button type="submit" size="xs" variant="secondary">
          <ArrowRightIcon className="size-3.5" />
        </Button>
        {currentUrl ? (
          <>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="刷新页面"
              onClick={() => setReloadNonce((n) => n + 1)}
            >
              <RefreshCwIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="在系统浏览器打开"
              onClick={() => {
                if (window.desktopBridge?.openExternal) {
                  void window.desktopBridge.openExternal(currentUrl);
                } else {
                  window.open(currentUrl, "_blank", "noopener,noreferrer");
                }
              }}
            >
              <ExternalLinkIcon className="size-3.5" />
            </Button>
          </>
        ) : null}
      </form>

      {currentUrl ? (
        <iframe
          key={`${currentUrl}:${reloadNonce}`}
          src={currentUrl}
          title={tab.title || currentUrl}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          className="min-h-0 flex-1 w-full border-0 bg-background"
        />
      ) : threadRef ? (
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              正在加载内置浏览器...
            </div>
          }
        >
          <PreviewPanel mode="embedded" threadRef={threadRef} visible />
        </Suspense>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <GlobeIcon className="size-7 text-muted-foreground/75 dark:[[data-pmx-glass='1']_&]:text-white/90" />
          <p className={cn("text-sm font-medium", STAGE_TITLE_GLASS_CLASS)}>内置浏览器</p>
          <p className={cn("max-w-xs text-xs", STAGE_SUBTITLE_GLASS_CLASS)}>
            在上方地址栏输入本地开发服务（如 `localhost:3000`）或任意网址即可实时预览。
          </p>
        </div>
      )}
    </PrismuxStageFrame>
  );
}

function EmbeddedSimulatorTabView() {
  return (
    <PrismuxStageFrame innerDataAttributes={{ "data-workspace-simulator-pane": "true" }}>
      <PhoneSimulatorBlankStage />
    </PrismuxStageFrame>
  );
}

function EmbeddedFilesTabView(props: {
  readonly tab: WorkspaceTab;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const { tab, threadRef } = props;
  const threadShell = useQuietThreadShell(threadRef);
  const projects = useProjects();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const initialRelativePath =
    tab.resourceId && tab.resourceId !== "files" && !tab.resourceId.startsWith("files:")
      ? tab.resourceId
      : null;
  const [relativePath, setRelativePath] = useState<string | null>(initialRelativePath);
  const [folderTrail, setFolderTrail] = useState<string | undefined>(undefined);

  const matchedProject = !threadRef
    ? null
    : threadShell?.projectId
      ? (projects.find(
          (project) =>
            project.environmentId === threadRef.environmentId &&
            project.id === threadShell.projectId,
        ) ?? null)
      : (projects.find((project) => project.environmentId === threadRef.environmentId) ?? null);

  const workspaceRoot = threadShell?.worktreePath ?? matchedProject?.workspaceRoot ?? null;
  const availableEditors =
    (threadRef ? serverConfigs.get(threadRef.environmentId)?.availableEditors : undefined) ?? [];

  if (!threadRef || !matchedProject || !workspaceRoot) {
    return (
      <PrismuxStageFrame
        innerDataAttributes={{ "data-workspace-files-pane": "true" }}
        innerClassName="items-center justify-center gap-2 p-6 text-center"
      >
        <FilesIcon className="size-6 text-muted-foreground dark:[[data-pmx-glass='1']_&]:text-white/90" />
        <p className={cn("text-sm font-medium", STAGE_TITLE_GLASS_CLASS)}>
          {tab.title || "工作区文件"}
        </p>
        <p className={cn("max-w-xs text-xs", STAGE_SUBTITLE_GLASS_CLASS)}>
          请先打开任意项目会话，即可在此分屏窗格浏览并预览工作区文件。
        </p>
      </PrismuxStageFrame>
    );
  }

  return (
    <PrismuxStageFrame innerDataAttributes={{ "data-workspace-files-pane": "true" }}>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            正在加载文件视图...
          </div>
        }
      >
        <FilePreviewPanel
          key={`${threadRef.environmentId}:${workspaceRoot}`}
          environmentId={threadRef.environmentId}
          cwd={workspaceRoot}
          projectName={matchedProject.title}
          projectId={matchedProject.id}
          relativePath={relativePath}
          threadRef={threadRef}
          composerDraftTarget={threadRef}
          keybindings={keybindings}
          availableEditors={availableEditors}
          openInShortcutEnabled={false}
          revealLine={null}
          revealRequestId={0}
          onOpenFile={(nextPath) => setRelativePath(nextPath)}
          onNavigateFolder={(nextPath, nextTrail) => {
            setRelativePath(nextPath || null);
            setFolderTrail(nextTrail || undefined);
          }}
          folderTrail={folderTrail}
          onPendingChange={() => {}}
          selectedFilePending={false}
          workspaceMutationId={null}
        />
      </Suspense>
    </PrismuxStageFrame>
  );
}

function EmbeddedRelatedTabView(props: { readonly threadRef: ScopedThreadRef | null }) {
  const { threadRef } = props;
  if (!threadRef) {
    return (
      <PrismuxStageFrame innerDataAttributes={{ "data-workspace-related-pane": "true" }}>
        <LinkedItemsEmptySurface />
      </PrismuxStageFrame>
    );
  }
  return (
    <PrismuxStageFrame innerDataAttributes={{ "data-workspace-related-pane": "true" }}>
      <ThreadPullRequestsPanel threadRef={threadRef} />
    </PrismuxStageFrame>
  );
}

function EmbeddedDeviceTabView(props: {
  readonly tab: WorkspaceTab;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const { tab, threadRef } = props;
  if (!threadRef) {
    return (
      <PrismuxStageFrame
        innerDataAttributes={{ "data-workspace-device-pane": "true" }}
        innerClassName="items-center justify-center gap-2 p-6 text-center"
      >
        <TabletSmartphoneIcon className="size-6 text-muted-foreground dark:[[data-pmx-glass='1']_&]:text-white/90" />
        <p className={cn("text-sm font-medium", STAGE_TITLE_GLASS_CLASS)}>
          {tab.title || "预览设备"}
        </p>
        <p className={cn("max-w-xs text-xs", STAGE_SUBTITLE_GLASS_CLASS)}>
          打开任意工作区会话后即可在此分屏连接并预览移动设备。
        </p>
      </PrismuxStageFrame>
    );
  }
  const deviceSurface: Extract<RightPanelSurface, { kind: "device" }> = {
    id:
      tab.resourceId && tab.resourceId.startsWith("device:")
        ? (tab.resourceId as `device:${string}`)
        : "device",
    kind: "device",
    title: tab.title,
  };
  return (
    <PrismuxStageFrame innerDataAttributes={{ "data-workspace-device-pane": "true" }}>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            正在加载设备预览...
          </div>
        }
      >
        <DevicePanel
          mode="embedded"
          threadRef={threadRef}
          surface={deviceSurface}
          visible
          onDismissSetup={() => {}}
        />
      </Suspense>
    </PrismuxStageFrame>
  );
}

function EmbeddedSideChatTabView(props: {
  readonly tab: WorkspaceTab;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const { tab, threadRef } = props;
  if (tab.environmentId && tab.threadId) {
    const ref = scopeThreadRef(tab.environmentId, tab.threadId);
    return (
      <EmbeddedThreadPaneView
        environmentId={tab.environmentId}
        threadId={tab.threadId}
        hostRef={threadRef ?? ref}
      />
    );
  }
  return (
    <PrismuxStageFrame innerDataAttributes={{ "data-workspace-side-chat-pane": "true" }}>
      <SideChatEmptySurface
        canStart={false}
        disabledReason="在会话中发起旁路提问后，可直接拖拽至任意分屏窗格并排查看。"
        threadRef={threadRef ?? undefined}
      />
    </PrismuxStageFrame>
  );
}

function ConversationMainChatHandoffView(props: {
  readonly paneId: string;
  readonly tab: WorkspaceTab;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly onOpenConversationInMainChat?: ((paneId: string, tab: WorkspaceTab) => void) | undefined;
}) {
  const { paneId, tab, instanceEntries, onOpenConversationInMainChat } = props;
  const brandName = resolveConversationBrandName(tab, instanceEntries);

  return (
    <PrismuxStageFrame
      innerDataAttributes={{ "data-workspace-chat-handoff": "true" }}
      innerClassName="items-center justify-center gap-3 p-6 text-center"
    >
      <div className="flex size-11 items-center justify-center rounded-xl border border-border/70 bg-muted/40 [[data-pmx-glass='1']_&]:border-white/20 [[data-pmx-glass='1']_&]:bg-background/50">
        <AgentBrandLogo provider={tab.providerId ?? brandName} size={22} />
      </div>
      <div className="space-y-1">
        <p className={cn("text-sm font-medium", STAGE_TITLE_GLASS_CLASS)}>{brandName}</p>
        <p className={cn("max-w-xs text-xs", STAGE_SUBTITLE_GLASS_CLASS)}>
          对话会话已统一收敛至完整主工作台视图。
        </p>
      </div>
      {onOpenConversationInMainChat ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => onOpenConversationInMainChat(paneId, tab)}
        >
          <MessageSquarePlusIcon className="size-3.5" aria-hidden />
          <span>在主工作台打开 {brandName}</span>
        </Button>
      ) : null}
    </PrismuxStageFrame>
  );
}

export const WorkspacePaneContent = memo(function WorkspacePaneContent(
  props: WorkspacePaneContentProps,
) {
  const {
    paneId,
    tab,
    activeHostThreadRef,
    instanceEntries,
    onUpdateTab,
    onOpenConversationInMainChat,
  } = props;

  const resolvedHostRef = tab.hostThreadRef ?? activeHostThreadRef;

  switch (tab.kind) {
    case "thread":
      if (tab.environmentId && tab.threadId) {
        const ref = scopeThreadRef(tab.environmentId, tab.threadId);
        return (
          <EmbeddedThreadPaneView
            environmentId={tab.environmentId}
            threadId={tab.threadId}
            hostRef={resolvedHostRef ?? ref}
          />
        );
      }
      return (
        <ConversationMainChatHandoffView
          paneId={paneId}
          tab={tab}
          instanceEntries={instanceEntries}
          onOpenConversationInMainChat={onOpenConversationInMainChat}
        />
      );
    case "terminal":
      return <EmbeddedTerminalTabView key={tab.id} tab={tab} threadRef={resolvedHostRef} />;
    case "diff":
      return <EmbeddedDiffTabView threadRef={resolvedHostRef} />;
    case "browser":
      return (
        <EmbeddedBrowserTabView
          key={`${tab.id}:${tab.url ?? ""}`}
          tab={tab}
          threadRef={resolvedHostRef}
          onUpdateUrl={(url, title) => onUpdateTab(tab.id, { url, title })}
        />
      );
    case "simulator":
      return <EmbeddedSimulatorTabView />;
    case "files":
      return <EmbeddedFilesTabView key={tab.id} tab={tab} threadRef={resolvedHostRef} />;
    case "related":
      return <EmbeddedRelatedTabView threadRef={resolvedHostRef} />;
    case "device":
      return <EmbeddedDeviceTabView tab={tab} threadRef={resolvedHostRef} />;
    case "side-chat":
      return <EmbeddedSideChatTabView tab={tab} threadRef={resolvedHostRef} />;
    case "draft":
    case "agent":
    default:
      return (
        <ConversationMainChatHandoffView
          paneId={paneId}
          tab={tab}
          instanceEntries={instanceEntries}
          onOpenConversationInMainChat={onOpenConversationInMainChat}
        />
      );
  }
});
