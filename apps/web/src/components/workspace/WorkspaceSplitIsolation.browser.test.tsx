import "../../index.css";
import { scopeThreadRef, scopedThreadKey } from "@prismux/client-runtime/environment";
import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ThreadProjection,
} from "@prismux/core-contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

const ENV_ID = EnvironmentId.make("env-local");
const PROJECT_ID = ProjectId.make("proj-prismux");
const DSH_THREAD_ID = ThreadId.make("thread-dsh-bash");
const CODEX_THREAD_ID = ThreadId.make("thread-codex-goose");
const DSH_INSTANCE_ID = ProviderInstanceId.make("acp-deepseek-harness");
const CODEX_INSTANCE_ID = ProviderInstanceId.make("codex");

const mockProjections = vi.hoisted(() => {
  const byThreadId = new Map<string, OrchestrationV2ThreadProjection>();
  return { byThreadId };
});

vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProject: ((ref: unknown) =>
    ref === null
      ? null
      : {
          id: ProjectId.make("proj-prismux"),
          environmentId: EnvironmentId.make("env-local"),
          title: "Prismux",
          workspaceRoot: "/work/prismux",
          scripts: [],
        }) as never,
  useProjects: (() => [
    {
      id: ProjectId.make("proj-prismux"),
      environmentId: EnvironmentId.make("env-local"),
      title: "Prismux",
      workspaceRoot: "/work/prismux",
      scripts: [],
    },
  ]) as never,
  useQuietThreadShell: ((ref: { threadId?: string } | null) => {
    if (!ref?.threadId) return null;
    if (ref.threadId === "thread-dsh-bash") {
      return {
        id: ThreadId.make("thread-dsh-bash"),
        environmentId: EnvironmentId.make("env-local"),
        projectId: ProjectId.make("proj-prismux"),
        title: "查看本机 Bash、PowerShell 环境",
        worktreePath: "/work/prismux",
        branch: "main",
        pullRequests: [],
      } as never;
    }
    return {
      id: ThreadId.make("thread-codex-goose"),
      environmentId: EnvironmentId.make("env-local"),
      projectId: ProjectId.make("proj-prismux"),
      title: "制作鹅鹅骑自行车动画",
      worktreePath: "/work/prismux",
      branch: "feat/goose-bike",
      pullRequests: [],
    } as never;
  }) as never,
  useThreadProjection: ((ref: { threadId?: string } | null) => {
    if (!ref?.threadId) return null;
    const projection = mockProjections.byThreadId.get(ref.threadId) ?? null;
    return projection ? ({ projection } as never) : null;
  }) as never,
  useThreadRelationshipShells: (() => []) as never,
  useServerConfigs: (() =>
    new Map([
      [
        EnvironmentId.make("env-local"),
        {
          scratchWorkspaceRoot: "/tmp/scratch",
          environment: { capabilities: { pullRequests: true, sideChats: false } },
        },
      ],
    ])) as never,
}));

vi.mock(import("~/state/vcs"), async (importOriginal) => {
  const actual = await importOriginal();
  const repoStatusByCwd = new Map<string, unknown>();
  const makeStatusAtom = (cwd: string) => {
    const existing = repoStatusByCwd.get(cwd);
    if (existing) return existing;
    const isCodex = cwd.includes("goose");
    const atom = Atom.make(
      AsyncResult.success({
        isRepo: true,
        hasPrimaryRemote: true,
        isDefaultRef: !isCodex,
        refName: isCodex ? "feat/goose-bike" : "main",
        hasWorkingTreeChanges: true,
        workingTree: {
          files: isCodex
            ? [
                { path: "src/animations/GooseBicycle.tsx", insertions: 142, deletions: 12 },
                { path: "src/animations/pedalPhysics.ts", insertions: 68, deletions: 4 },
              ]
            : [{ path: "scripts/inspect-shell-env.ps1", insertions: 24, deletions: 3 }],
          insertions: isCodex ? 210 : 24,
          deletions: isCodex ? 16 : 3,
        },
        hasUpstream: true,
        aheadCount: 0,
        behindCount: 0,
        aheadOfDefaultCount: 0,
        pr: null,
      }),
    );
    repoStatusByCwd.set(cwd, atom);
    return atom;
  };
  return {
    ...actual,
    vcsEnvironment: {
      ...actual.vcsEnvironment,
      status: ((arg: { input?: { cwd?: string } }) =>
        makeStatusAtom(arg?.input?.cwd ?? "/work/prismux")) as never,
    },
  };
});

import { render } from "../../../test/render";
import { AgentBrandLogo } from "../../prismux/agentBrand";
import {
  selectPaneOverviewOpen,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../../rightPanelStore";
import { SessionOverviewPanel } from "../overview/SessionOverviewPanel";
import {
  resolveFocusedSplitRightPanelContext,
  resolveSplitRouteOwnership,
} from "./splitPaneIsolation.logic";
import { WorkspaceTabBar } from "./WorkspaceTabBar";
import { DEFAULT_PRIMARY_PANE_ID, useWorkspaceTabsStore } from "./workspaceTabsStore";

function seedSplitScenario() {
  mockProjections.byThreadId.set("thread-dsh-bash", {
    thread: { id: DSH_THREAD_ID, title: "查看本机 Bash、PowerShell 环境" },
    runs: [],
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [
      {
        id: MessageId.make("m-dsh-1"),
        role: "user",
        text: "查看本机 Bash、PowerShell 环境",
        attachments: [],
      },
      {
        id: MessageId.make("m-dsh-2"),
        role: "assistant",
        text: "本机已检测 PowerShell 7.5 与 Git Bash 2.49。",
        attachments: [],
      },
    ],
    plans: [],
    turnItems: [
      {
        id: TurnItemId.make("fc-dsh-1"),
        runId: RunId.make("run-dsh-1"),
        type: "file_change",
        fileName: "scripts/inspect-shell-env.ps1",
        additions: 24,
        deletions: 3,
      },
    ],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
  } as unknown as OrchestrationV2ThreadProjection);

  mockProjections.byThreadId.set("thread-codex-goose", {
    thread: { id: CODEX_THREAD_ID, title: "制作鹅鹅骑自行车动画" },
    runs: [],
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [
      {
        id: MessageId.make("m-cdx-1"),
        role: "user",
        text: "制作一个流畅的鹅鹅骑自行车 SVG 动画",
        attachments: [],
      },
      {
        id: MessageId.make("m-cdx-2"),
        role: "assistant",
        text: "已完成鹅鹅骑自行车矢量动画组件与踏板运动学循环。",
        attachments: [],
      },
    ],
    plans: [],
    turnItems: [
      {
        id: TurnItemId.make("fc-cdx-1"),
        runId: RunId.make("run-cdx-1"),
        type: "file_change",
        fileName: "src/animations/GooseBicycle.tsx",
        additions: 142,
        deletions: 12,
      },
      {
        id: TurnItemId.make("fc-cdx-2"),
        runId: RunId.make("run-cdx-1"),
        type: "file_change",
        fileName: "src/animations/pedalPhysics.ts",
        additions: 68,
        deletions: 4,
      },
    ],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
  } as unknown as OrchestrationV2ThreadProjection);

  useWorkspaceTabsStore.setState({
    layout: { type: "leaf", paneId: DEFAULT_PRIMARY_PANE_ID },
    panes: {
      [DEFAULT_PRIMARY_PANE_ID]: { id: DEFAULT_PRIMARY_PANE_ID, tabIds: [], activeTabId: null },
    },
    tabs: {},
    focusedPaneId: DEFAULT_PRIMARY_PANE_ID,
    primaryPaneId: DEFAULT_PRIMARY_PANE_ID,
    activeDrag: null,
    isResizingSplit: false,
  });
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    paneOverviewOpenByPaneId: {},
    splitDockOpen: false,
    splitDockMaximized: false,
    splitGlobalWallpaperOpen: false,
    pendingMaximizeThreadKey: null,
  });

  const store = useWorkspaceTabsStore.getState();
  store.openTab(
    {
      kind: "thread",
      title: "制作鹅鹅骑自行车动画",
      providerId: "codex",
      instanceId: CODEX_INSTANCE_ID,
      model: "gpt-5.3-codex",
      environmentId: ENV_ID,
      threadId: CODEX_THREAD_ID,
    },
    "pane-main",
  );
  const dshTabId = store.openTab(
    {
      kind: "thread",
      title: "查看本机 Bash、PowerShell 环境",
      providerId: "deepseek-harness",
      instanceId: DSH_INSTANCE_ID,
      model: "deepseek-v4.1-flash",
      environmentId: ENV_ID,
      threadId: DSH_THREAD_ID,
    },
    "pane-main",
  );
  useWorkspaceTabsStore
    .getState()
    .dropItemIntoPane(
      { kind: "pane-tab", tabId: dshTabId, fromPaneId: "pane-main" },
      "pane-main",
      "top",
    );
}

const THREAD_SCENARIOS = {
  "thread-dsh-bash": {
    providerId: "deepseek-harness",
    modelLabel: "DeepSeek V4.1 Flash · 付费组",
    durationLabel: "已完成，用时 8s",
    prompt: "查看本机 Bash、PowerShell、Node.js 与 Git 环境路径",
    reply:
      "已完成本机环境巡检：PowerShell 7.5.1、Git Bash 2.49.0、Node.js v24.12.0、pnpm 12.3.4 均就绪。",
    telemetry: { speed: "828.8 tok/s", tokens: "486k tok", ctx: "上下文 5%" },
    cwd: "/work/prismux/shell",
    diffFiles: [{ path: "scripts/inspect-shell-env.ps1", additions: 24, deletions: 3 }],
  },
  "thread-codex-goose": {
    providerId: "codex",
    modelLabel: "GPT-5.3 Codex · 高推理",
    durationLabel: "已完成，用时 14s",
    prompt: "制作鹅鹅骑自行车动画，带踏板物理摆动与车轮辐条旋转",
    reply: "已生成 GooseBicycle.tsx 矢量动画：包含鹅鹅脖子律动、双脚联动曲柄与 60fps 辐条旋转。",
    telemetry: { speed: "142.4 tok/s", tokens: "18.2k tok", ctx: "上下文 12%" },
    cwd: "/work/prismux/goose",
    diffFiles: [
      { path: "src/animations/GooseBicycle.tsx", additions: 142, deletions: 12 },
      { path: "src/animations/pedalPhysics.ts", additions: 68, deletions: 4 },
    ],
  },
} as const;

function SplitWorkspaceHarness() {
  const layout = useWorkspaceTabsStore((s) => s.layout);
  const panes = useWorkspaceTabsStore((s) => s.panes);
  const tabs = useWorkspaceTabsStore((s) => s.tabs);
  const focusedPaneId = useWorkspaceTabsStore((s) => s.focusedPaneId);
  const primaryPaneId = useWorkspaceTabsStore((s) => s.primaryPaneId);
  const paneOverviewOpenByPaneId = useRightPanelStore((s) => s.paneOverviewOpenByPaneId);
  const threadPanelVisibilityByThreadKey = useRightPanelStore(
    (s) => s.threadPanelVisibilityByThreadKey,
  );
  const splitDockOpen = useRightPanelStore((s) => s.splitDockOpen);
  const byThreadKey = useRightPanelStore((s) => s.byThreadKey);
  const [shownTarget] = useState({
    kind: "server" as const,
    threadRef: scopeThreadRef(ENV_ID, DSH_THREAD_ID),
  });

  const ownership = resolveSplitRouteOwnership({
    layout,
    panes,
    tabs,
    primaryPaneId,
    focusedPaneId,
    shownTarget,
    modalOpen: false,
  });
  const focusedContext = resolveFocusedSplitRightPanelContext({
    layout,
    panes,
    tabs,
    focusedPaneId,
    primaryPaneId,
  });

  const leafIds =
    layout.type === "split" && layout.first.type === "leaf" && layout.second.type === "leaf"
      ? [layout.first.paneId, layout.second.paneId]
      : [primaryPaneId];

  const noop = () => {};
  const scriptResult = async () => ({ ok: true }) as never;

  const focusedThreadKey = focusedContext.threadKey;
  const focusedRpState = selectThreadRightPanelState(byThreadKey, focusedContext.threadRef);
  const focusedScenario =
    focusedContext.threadRef?.threadId && focusedContext.threadRef.threadId in THREAD_SCENARIOS
      ? THREAD_SCENARIOS[focusedContext.threadRef.threadId as keyof typeof THREAD_SCENARIOS]
      : null;

  return (
    <div
      data-testid="split-verification-shell"
      className="dark flex h-screen w-screen flex-row overflow-hidden bg-sidebar text-foreground"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {leafIds.map((paneId, idx) => {
          const pane = panes[paneId]!;
          const paneTabs = pane.tabIds.map((id) => tabs[id]!).filter(Boolean);
          const activeTab = pane.activeTabId ? tabs[pane.activeTabId]! : null;
          const isFocused = paneId === focusedPaneId;
          const threadId = activeTab?.threadId ?? DSH_THREAD_ID;
          const threadRef = scopeThreadRef(ENV_ID, threadId);
          const scenario =
            THREAD_SCENARIOS[threadId as keyof typeof THREAD_SCENARIOS] ??
            THREAD_SCENARIOS["thread-dsh-bash"];
          const overviewOpen = selectPaneOverviewOpen(
            paneOverviewOpenByPaneId,
            threadPanelVisibilityByThreadKey,
            paneId,
            threadRef,
            true,
          );
          const isRouteOwner = ownership.routeOwnerPaneId === paneId;

          return (
            <section
              key={paneId}
              data-workspace-pane={paneId}
              data-pane-thread-id={threadId}
              data-route-owner={isRouteOwner ? "true" : "false"}
              data-focused-pane={isFocused ? "true" : "false"}
              onPointerDownCapture={() => useWorkspaceTabsStore.getState().focusPane(paneId)}
              className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-border/70 last:border-b-0"
            >
              <WorkspaceTabBar
                pane={pane}
                tabs={paneTabs}
                isFocused={isFocused}
                paneCount={leafIds.length}
                otherPaneIds={leafIds.filter((id) => id !== paneId)}
                touchesTopEdge={idx === 0}
                touchesLeftEdge
                touchesRightEdge={!splitDockOpen}
                paneOverviewAvailable
                paneOverviewOpen={overviewOpen}
                onTogglePaneOverview={(pId) =>
                  useRightPanelStore.getState().togglePaneOverview(pId, true)
                }
                newTabPopover={{
                  openTabs: [],
                  historyThreads: [],
                  agents: [],
                  onActivateOpenTab: noop,
                  onOpenHistoryThread: noop,
                  onLaunchAgent: noop,
                  onLaunchAgentInSplit: noop,
                  onRunQuickTool: noop,
                  onOpenUrl: noop,
                  onOpenAgentSettings: noop,
                }}
                onActivateTab={(pId, tId) => useWorkspaceTabsStore.getState().activateTab(pId, tId)}
                onCloseTab={noop}
                onSplitPane={noop}
                onClosePane={noop}
                onMoveTabToPane={noop}
                onReorderTab={noop}
              />

              <div className="relative flex min-h-0 flex-1 flex-col justify-between overflow-hidden bg-background px-6 py-4">
                <div className="max-w-xl space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-1.5 text-xs text-foreground">
                    <AgentBrandLogo provider={scenario.providerId} size={14} />
                    <span className="font-medium">{activeTab?.title}</span>
                    <span className="text-muted-foreground">· {scenario.durationLabel}</span>
                  </div>
                  <div
                    data-pane-message-prompt={paneId}
                    className="rounded-xl border border-border/70 bg-card px-3.5 py-2.5 text-xs text-foreground"
                  >
                    {scenario.prompt}
                  </div>
                  <div
                    data-pane-message-reply={paneId}
                    className="rounded-xl border border-border/60 bg-muted/25 px-3.5 py-2.5 text-xs leading-relaxed text-foreground"
                  >
                    {scenario.reply}
                  </div>
                </div>

                <div className="mt-3 flex max-w-xl items-center justify-between rounded-xl border border-border/80 bg-card px-3.5 py-2 text-2xs">
                  <div
                    data-pane-model-badge={paneId}
                    className="flex items-center gap-2 font-medium text-foreground"
                  >
                    <AgentBrandLogo provider={scenario.providerId} size={13} />
                    <span>{scenario.modelLabel}</span>
                  </div>
                  <div
                    data-pane-telemetry={paneId}
                    className="flex items-center gap-3 font-mono text-muted-foreground"
                  >
                    <span>{scenario.telemetry.speed}</span>
                    <span>{scenario.telemetry.tokens}</span>
                    <span>{scenario.telemetry.ctx}</span>
                  </div>
                </div>

                {overviewOpen ? (
                  <SessionOverviewPanel
                    floating
                    paneId={paneId}
                    topInsetPx={0}
                    bottomClearancePx={76}
                    containerHeightPx={412}
                    onBeforePanelAction={() => {
                      useWorkspaceTabsStore.getState().focusPane(paneId);
                    }}
                    onCollapse={() => {
                      useRightPanelStore.getState().setPaneOverviewOpen(paneId, false);
                    }}
                    environmentId={ENV_ID}
                    threadId={threadId}
                    projectId={PROJECT_ID}
                    worktreePath={scenario.cwd}
                    isServerThread
                    composerDraftTarget={threadRef}
                    activeProjectName="Prismux"
                    activeProjectScripts={[]}
                    preferredScriptId={null}
                    keybindings={[]}
                    availableEditors={[]}
                    showOpenInPicker={false}
                    openInShortcutEnabled={false}
                    gitCwd={scenario.cwd}
                    workspaceMutationId={null}
                    isGitRepo
                    envLocked={false}
                    availableEnvironments={[]}
                    onEnvModeChange={noop}
                    envMode="local"
                    startFromOrigin={false}
                    onStartFromOriginChange={noop}
                    onComposerFocusRequest={noop}
                    onOpenDiffReview={() => {
                      useRightPanelStore.getState().open(threadRef, "diff");
                    }}
                    onOpenFiles={() => {
                      useRightPanelStore.getState().open(threadRef, "files");
                    }}
                    onRunProjectScript={noop}
                    onAddProjectScript={scriptResult}
                    onUpdateProjectScript={scriptResult}
                    onDeleteProjectScript={scriptResult}
                    usage={{
                      providerInstanceId: null,
                      model: null,
                      providers: [],
                      sources: [],
                      contextWindow: null,
                    }}
                  />
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      {splitDockOpen ? (
        <aside
          data-split-right-panel-dock="thread"
          data-split-right-panel-pane={focusedContext.paneId}
          data-split-right-panel-thread={focusedThreadKey ?? "none"}
          className="flex h-full w-96 shrink-0 flex-col border-l border-border/75 bg-sidebar"
        >
          <div className="flex h-9.5 items-center justify-between border-b border-border/70 px-3 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              {focusedContext.providerId ? (
                <AgentBrandLogo provider={focusedContext.providerId} size={13} />
              ) : null}
              <span>{focusedRpState.activeSurfaceId === "files" ? "文件列表" : "差异审查"}</span>
            </div>
            <span className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-3xs text-muted-foreground">
              跟随分屏 {focusedContext.paneIndex + 1}
            </span>
          </div>
          <div
            data-split-right-panel-context="1"
            className="flex items-center justify-between border-b border-border/60 bg-muted/25 px-3 py-1.5 text-2xs text-muted-foreground"
          >
            <span className="truncate font-medium text-foreground">{focusedContext.title}</span>
            <span className="font-mono text-3xs text-muted-foreground">
              {focusedContext.threadRef?.threadId}
            </span>
          </div>
          <div className="flex-1 space-y-2 p-3 text-xs">
            {focusedScenario?.diffFiles.map((file) => (
              <div
                key={file.path}
                data-dock-diff-file={file.path}
                className="flex items-center justify-between rounded-lg border border-border/70 bg-card px-3 py-2"
              >
                <span className="truncate font-mono text-2xs text-foreground">{file.path}</span>
                <span className="shrink-0 font-mono text-2xs">
                  <span className="text-diff-addition">+{file.additions}</span>{" "}
                  <span className="text-diff-deletion">-{file.deletions}</span>
                </span>
              </div>
            ))}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

describe("WorkspaceSplitIsolation browser verification", () => {
  it("isolates DSH top pane & Codex bottom pane, renders per-pane independent overviews, and syncs one right sidebar dock", async () => {
    seedSplitScenario();
    const hadDark = document.documentElement.classList.contains("dark");
    document.documentElement.classList.add("dark");
    using _restoreDark = {
      [Symbol.dispose]() {
        if (!hadDark) document.documentElement.classList.remove("dark");
      },
    };
    await page.viewport(1440, 900);
    await using _screen = await render(<SplitWorkspaceHarness />);

    const paneElements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-workspace-pane]"),
    );
    expect(paneElements).toHaveLength(2);
    const topPaneId = paneElements[0]!.getAttribute("data-workspace-pane")!;
    const bottomPaneId = paneElements[1]!.getAttribute("data-workspace-pane")!;
    expect(bottomPaneId).toBe("pane-main");

    // 1. Both panes render strictly isolated conversations, models, and telemetry simultaneously.
    expect(document.querySelector(`[data-pane-model-badge="${topPaneId}"]`)?.textContent).toContain(
      "DeepSeek V4.1 Flash",
    );
    expect(document.querySelector(`[data-pane-telemetry="${topPaneId}"]`)?.textContent).toContain(
      "828.8 tok/s",
    );
    expect(
      document.querySelector(`[data-pane-model-badge="${bottomPaneId}"]`)?.textContent,
    ).toContain("GPT-5.3 Codex");
    expect(
      document.querySelector(`[data-pane-telemetry="${bottomPaneId}"]`)?.textContent,
    ).toContain("142.4 tok/s");
    expect(
      document.querySelector(`[data-pane-message-reply="${bottomPaneId}"]`)?.textContent,
    ).toContain("GooseBicycle.tsx");
    expect(
      document.querySelector(`[data-pane-message-reply="${bottomPaneId}"]`)?.textContent,
    ).not.toContain("PowerShell 7.5.1");

    // 2. Both panes mount their own dedicated floating SessionOverviewPanel.
    const topOverview = document.querySelector(`[data-overview-pane-id="${topPaneId}"]`);
    const bottomOverview = document.querySelector(`[data-overview-pane-id="${bottomPaneId}"]`);
    expect(topOverview).not.toBeNull();
    expect(bottomOverview).not.toBeNull();
    expect(topOverview?.getAttribute("data-overview-thread-id")).toBe("thread-dsh-bash");
    expect(bottomOverview?.getAttribute("data-overview-thread-id")).toBe("thread-codex-goose");

    // 3. Collapsing Top Pane's overview leaves Bottom Pane's overview open.
    const topCollapseBtn = document.querySelector<HTMLButtonElement>(
      `[data-overview-pane-id="${topPaneId}"] [data-overview-collapse-trigger="1"]`,
    );
    expect(topCollapseBtn).not.toBeNull();
    await userEvent.click(topCollapseBtn!);
    expect(document.querySelector(`[data-overview-pane-id="${topPaneId}"]`)).toBeNull();
    expect(document.querySelector(`[data-overview-pane-id="${bottomPaneId}"]`)).not.toBeNull();

    // Re-expand Top Pane's overview via its own tabbar button.
    const topTabbarToggle = document.querySelector<HTMLButtonElement>(
      `[data-workspace-pane-overview-toggle="${topPaneId}"]`,
    );
    expect(topTabbarToggle).not.toBeNull();
    await userEvent.click(topTabbarToggle!);
    expect(document.querySelector(`[data-overview-pane-id="${topPaneId}"]`)).not.toBeNull();

    // 4. Starting with Top Pane focused, clicking "审查" in Bottom Pane's overview focuses Bottom Pane
    //    AND opens ONE unified right sidebar dock synced to Bottom Pane's Codex thread.
    useWorkspaceTabsStore.getState().focusPane(topPaneId);
    expect(useWorkspaceTabsStore.getState().focusedPaneId).toBe(topPaneId);

    const bottomReviewBtn = document.querySelector<HTMLButtonElement>(
      `[data-overview-pane-id="${bottomPaneId}"] [data-overview-action="review"]`,
    );
    expect(bottomReviewBtn).not.toBeNull();
    await userEvent.click(bottomReviewBtn!);

    expect(useWorkspaceTabsStore.getState().focusedPaneId).toBe(bottomPaneId);
    const docks = document.querySelectorAll("[data-split-right-panel-dock]");
    expect(docks).toHaveLength(1);
    expect(docks[0]!.getAttribute("data-split-right-panel-pane")).toBe(bottomPaneId);
    expect(docks[0]!.getAttribute("data-split-right-panel-thread")).toBe(
      scopedThreadKey(scopeThreadRef(ENV_ID, CODEX_THREAD_ID)),
    );
    expect(
      document.querySelector('[data-dock-diff-file="src/animations/GooseBicycle.tsx"]'),
    ).not.toBeNull();

    if (import.meta.env.VITE_CAPTURE_SPLIT_SCREENSHOT === "1") {
      await page.screenshot({ path: "split-pane-verification.png" });
    }

    // 5. Clicking back into Top Pane smoothly syncs the right sidebar dock to DSH (zero stale Codex files).
    const topTab = document.querySelector<HTMLElement>(
      `[data-workspace-pane="${topPaneId}"] [data-workspace-tab]`,
    );
    expect(topTab).not.toBeNull();
    await userEvent.click(topTab!);
    expect(useWorkspaceTabsStore.getState().focusedPaneId).toBe(topPaneId);
    expect(
      document
        .querySelector("[data-split-right-panel-dock]")
        ?.getAttribute("data-split-right-panel-thread"),
    ).toBe(scopedThreadKey(scopeThreadRef(ENV_ID, DSH_THREAD_ID)));
    expect(
      document.querySelector('[data-dock-diff-file="scripts/inspect-shell-env.ps1"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-dock-diff-file="src/animations/GooseBicycle.tsx"]'),
    ).toBeNull();
  });
});
