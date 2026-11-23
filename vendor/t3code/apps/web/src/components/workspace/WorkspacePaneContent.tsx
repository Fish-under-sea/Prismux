import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ProviderInstanceId,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import {
  ArrowRightIcon,
  ExternalLinkIcon,
  GitCompareArrowsIcon,
  GlobeIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  SendHorizontalIcon,
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
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { cn } from "~/lib/utils";
import { ComposerHandleContext } from "../../composerHandleContext";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useScratchProject } from "../../hooks/useScratchProject";
import type { SideChatParentPanel } from "../../lib/sideChatPane";
import type { TerminalContextSelection } from "../../lib/terminalContext";
import { AgentBrandLogo, formatAgentBrandName } from "../../prismux/agentBrand";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { useRightPanelStore, type RightPanelSurface } from "../../rightPanelStore";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import type { ModelEsque } from "../chat/providerIconUtils";
import { PersistentThreadTerminalPanel } from "../PersistentThreadTerminals";
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
            打开任意工作区会话后即可直连 T3 Server 持久化终端（支持多窗口与无损重连）。
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

  const handleNavigate = (event: FormEvent) => {
    event.preventDefault();
    const classified = classifyQuickLaunchUrl(addressInput);
    if (!classified) return;
    onUpdateUrl(classified.normalizedUrl, classified.displayHost);
    setAddressInput(classified.normalizedUrl);
  };

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

function AgentBlankStageView(props: {
  readonly paneId: string;
  readonly tab: WorkspaceTab;
  readonly environmentId: EnvironmentId | null;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly historyThreads: ReadonlyArray<QuickLaunchHistoryThread>;
  readonly onUpdateTab: WorkspacePaneContentProps["onUpdateTab"];
  readonly onOpenHistoryThreadInPane: WorkspacePaneContentProps["onOpenHistoryThreadInPane"];
  readonly onLaunchAgentPrompt: WorkspacePaneContentProps["onLaunchAgentPrompt"];
  readonly onOpenQuickTool: WorkspacePaneContentProps["onOpenQuickTool"];
}) {
  const {
    paneId,
    tab,
    environmentId,
    instanceEntries,
    modelOptionsByInstance,
    historyThreads,
    onUpdateTab,
    onOpenHistoryThreadInPane,
    onLaunchAgentPrompt,
    onOpenQuickTool,
  } = props;

  const [prompt, setPrompt] = useState("");
  const brandName = formatAgentBrandName(tab.providerId ?? tab.title);

  const matchedEntry = useMemo(() => {
    if (tab.instanceId) {
      const exact = instanceEntries.find((entry) => entry.instanceId === tab.instanceId);
      if (exact) return exact;
    }
    const targetName = brandName.toLowerCase();
    return (
      instanceEntries.find(
        (entry) =>
          entry.enabled &&
          formatAgentBrandName(entry.driverKind, entry.displayName).toLowerCase() === targetName,
      ) ??
      instanceEntries.find((entry) => entry.enabled) ??
      instanceEntries[0] ??
      null
    );
  }, [brandName, instanceEntries, tab.instanceId]);

  const activeInstanceId = matchedEntry?.instanceId ?? null;
  const activeModel =
    tab.model ??
    matchedEntry?.models.find((m) => m.isDefault && !m.isCustom)?.slug ??
    matchedEntry?.models[0]?.slug ??
    "";

  const relatedThreads = useMemo(() => {
    const targetLower = brandName.toLowerCase();
    return historyThreads
      .filter((thread) => {
        if (!thread.providerId) return false;
        return formatAgentBrandName(thread.providerId).toLowerCase() === targetLower;
      })
      .slice(0, 4);
  }, [brandName, historyThreads]);

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    onLaunchAgentPrompt({
      paneId,
      tabId: tab.id,
      providerId: tab.providerId ?? matchedEntry?.driverKind ?? "codex",
      instanceId: activeInstanceId,
      model: activeModel || null,
      prompt: trimmed,
    });
    setPrompt("");
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  return (
    <PrismuxStageFrame
      innerDataAttributes={{ "data-workspace-agent-stage": "true" }}
      innerClassName="items-center justify-center overflow-y-auto px-5 py-8"
    >
      <div className="flex w-full max-w-xl flex-col items-center gap-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl border border-border/75 bg-muted/40 shadow-xs [[data-pmx-glass='1']_&]:border-white/25 [[data-pmx-glass='1']_&]:bg-background/55">
            <AgentBrandLogo provider={tab.providerId ?? brandName} size={26} />
          </div>
          <div className="space-y-1.5">
            <h2
              data-workspace-agent-title="true"
              className={cn("text-base font-semibold tracking-tight", STAGE_TITLE_GLASS_CLASS)}
            >
              开始与 {brandName} 聊天
            </h2>
            <p
              data-workspace-agent-subtitle="true"
              className={cn("text-xs font-medium", STAGE_SUBTITLE_GLASS_CLASS)}
            >
              让 {brandName} 检查代码、解释输出或进行修改
            </p>
          </div>
        </div>

        {/* Real interactive composer card */}
        <div
          data-pmx-glass-zone="composer"
          className="flex w-full flex-col gap-2 rounded-2xl border border-border/75 bg-card/85 p-3 shadow-sm"
        >
          <textarea
            rows={3}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`向 ${brandName} 提问或描述要修改的任务...`}
            className="w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/75 dark:[[data-pmx-glass='1']_&]:placeholder:text-white/75"
          />
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="min-w-0">
              {activeInstanceId && instanceEntries.length > 0 ? (
                <ProviderModelPicker
                  environmentId={environmentId}
                  activeInstanceId={activeInstanceId}
                  model={activeModel}
                  lockedProvider={null}
                  instanceEntries={instanceEntries}
                  modelOptionsByInstance={modelOptionsByInstance}
                  scopeToActiveAgent
                  isComposerOwned
                  size="sm"
                  onInstanceModelChange={(nextInstanceId, nextModel) => {
                    const nextEntry = instanceEntries.find((e) => e.instanceId === nextInstanceId);
                    const nextBrand = nextEntry
                      ? formatAgentBrandName(nextEntry.driverKind, nextEntry.displayName)
                      : brandName;
                    onUpdateTab(tab.id, {
                      instanceId: nextInstanceId,
                      providerId: nextEntry?.driverKind ?? tab.providerId,
                      model: nextModel,
                      title: nextBrand,
                    });
                  }}
                />
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <AgentBrandLogo provider={tab.providerId ?? brandName} size={13} />
                  {brandName}
                </span>
              )}
            </div>
            <Button
              type="button"
              size="xs"
              disabled={prompt.trim().length === 0}
              onClick={handleSubmit}
              className="gap-1 rounded-full px-3"
            >
              <SendHorizontalIcon className="size-3.5" aria-hidden />
              <span>发送</span>
            </Button>
          </div>
        </div>

        {/* Recent threads for this Agent or quick tool switches */}
        {relatedThreads.length > 0 ? (
          <div className="flex w-full flex-col gap-1.5">
            <div className={cn("text-[11px] font-medium", STAGE_SUBTITLE_GLASS_CLASS)}>
              或继续 {brandName} 的历史会话
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {relatedThreads.map((thread) => (
                <button
                  key={`${thread.environmentId}:${thread.threadId}`}
                  type="button"
                  onClick={() => onOpenHistoryThreadInPane(thread, paneId)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/65 bg-muted/25 px-2.5 py-2 text-left text-xs text-foreground outline-none transition-colors hover:bg-muted/55 focus-visible:ring-2 focus-visible:ring-ring [[data-pmx-glass='1']_&]:border-white/18 [[data-pmx-glass='1']_&]:bg-background/45 [[data-pmx-glass='1']_&]:hover:bg-background/65"
                >
                  <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground dark:[[data-pmx-glass='1']_&]:text-white/85" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs">
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => onOpenQuickTool("terminal", paneId)}
            >
              <TerminalIcon className="size-3.5" />
              <span>PowerShell 终端</span>
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => onOpenQuickTool("diff", paneId)}
            >
              <GitCompareArrowsIcon className="size-3.5" />
              <span>查看差异</span>
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => onOpenQuickTool("browser", paneId)}
            >
              <GlobeIcon className="size-3.5" />
              <span>内置浏览器</span>
            </Button>
          </div>
        )}
      </div>
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
    environmentId,
    instanceEntries,
    modelOptionsByInstance,
    historyThreads,
    onUpdateTab,
    onOpenHistoryThreadInPane,
    onLaunchAgentPrompt,
    onOpenQuickTool,
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
        <AgentBlankStageView
          paneId={paneId}
          tab={tab}
          environmentId={environmentId}
          instanceEntries={instanceEntries}
          modelOptionsByInstance={modelOptionsByInstance}
          historyThreads={historyThreads}
          onUpdateTab={onUpdateTab}
          onOpenHistoryThreadInPane={onOpenHistoryThreadInPane}
          onLaunchAgentPrompt={onLaunchAgentPrompt}
          onOpenQuickTool={onOpenQuickTool}
        />
      );
    case "terminal":
      return <EmbeddedTerminalTabView tab={tab} threadRef={resolvedHostRef} />;
    case "diff":
      return <EmbeddedDiffTabView threadRef={resolvedHostRef} />;
    case "browser":
      return (
        <EmbeddedBrowserTabView
          tab={tab}
          threadRef={resolvedHostRef}
          onUpdateUrl={(url, title) => onUpdateTab(tab.id, { url, title })}
        />
      );
    case "simulator":
      return <EmbeddedSimulatorTabView />;
    case "draft":
    case "agent":
    default:
      return (
        <AgentBlankStageView
          paneId={paneId}
          tab={tab}
          environmentId={environmentId}
          instanceEntries={instanceEntries}
          modelOptionsByInstance={modelOptionsByInstance}
          historyThreads={historyThreads}
          onUpdateTab={onUpdateTab}
          onOpenHistoryThreadInPane={onOpenHistoryThreadInPane}
          onLaunchAgentPrompt={onLaunchAgentPrompt}
          onOpenQuickTool={onOpenQuickTool}
        />
      );
  }
});
