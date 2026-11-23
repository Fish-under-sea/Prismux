import {
  ChatAttachmentId,
  EnvironmentId,
  MessageId,
  NodeId,
  PlanId,
  ProjectId,
  RunId,
  ThreadId,
  TurnItemId,
  type ChatAttachment,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const SCRATCH_ROOT = "/home/user/.t3/scratch";

const mockState = vi.hoisted(() => ({
  projection: null as OrchestrationV2ThreadProjection | null,
  useQuietThreadShellSpy: vi.fn(),
  useThreadProjectionSpy: vi.fn(),
  useThreadRelationshipShellsSpy: vi.fn(),
}));

vi.mock("gt-react", () => ({
  useGT: () => (text: string) => text,
  useLocale: () => "zh-CN",
  useMessages: () => (text: string) => text,
  msg: (text: string) => text,
  T: ({ children }: { children?: unknown }) => children ?? null,
  Var: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  Link: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProject: ((ref: unknown) =>
    ref === null
      ? null
      : {
          id: ProjectId.make("project-1"),
          environmentId: EnvironmentId.make("env-1"),
          title: "Prismux",
          workspaceRoot: "/work/prismux",
          scripts: [],
        }) as never,
  useProjects: (() => []) as never,
  useQuietThreadShell: ((ref: unknown) => {
    mockState.useQuietThreadShellSpy(ref);
    return ref === null
      ? null
      : {
          id: ThreadId.make("thread-1"),
          environmentId: EnvironmentId.make("env-1"),
          projectId: ProjectId.make("project-1"),
          title: "AGY 概览面板重构",
          worktreePath: "/work/prismux",
          branch: "main",
          pullRequests: [],
        };
  }) as never,
  useThreadProjection: ((ref: unknown) => {
    mockState.useThreadProjectionSpy(ref);
    return ref === null || mockState.projection === null
      ? null
      : { projection: mockState.projection };
  }) as never,
  useThreadRelationshipShells: ((ref: unknown) => {
    mockState.useThreadRelationshipShellsSpy(ref);
    return [];
  }) as never,
  useServerConfigs: (() =>
    new Map([
      [
        EnvironmentId.make("env-1"),
        {
          scratchWorkspaceRoot: SCRATCH_ROOT,
          environment: { capabilities: { pullRequests: true, sideChats: true } },
        },
      ],
    ])) as never,
}));

vi.mock(import("~/state/vcs"), async (importOriginal) => {
  const actual = await importOriginal();
  const repoStatus = Atom.make(
    AsyncResult.success({
      isRepo: true,
      hasPrimaryRemote: true,
      isDefaultRef: true,
      refName: "main",
      hasWorkingTreeChanges: true,
      workingTree: {
        files: [
          { path: "src/components/overview/SessionOverviewPanel.tsx", insertions: 50, deletions: 8 },
          { path: "src/components/overview/sessionOverview.logic.ts", insertions: 20, deletions: 4 },
          { path: "src/styles/glass.css", insertions: 8, deletions: 2 },
          { path: "package.json", insertions: 4, deletions: 1 },
          { path: "docs/overview.md", insertions: 4, deletions: 2 },
          { path: "src/utils/path.ts", insertions: 2, deletions: 2 },
        ],
        insertions: 88,
        deletions: 19,
      },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      aheadOfDefaultCount: 0,
      pr: null,
    }),
  );
  return {
    ...actual,
    vcsEnvironment: { ...actual.vcsEnvironment, status: (() => repoStatus) as never },
  };
});

import { SessionOverviewPanel, type SessionOverviewPanelProps } from "./SessionOverviewPanel";
import {
  ModifiedFilesOverviewSection,
  OverviewSectionBlock,
  SideQuestionsOverviewSection,
} from "./SessionOverviewSections";
import { SideQuestionComposer } from "./SideQuestionWidget";
import {
  createSideQuestionRecord,
  extractOverviewModifiedFiles,
  extractOverviewSideQuestions,
} from "./sessionOverview.logic";

function createRichProjection(): OrchestrationV2ThreadProjection {
  const img: ChatAttachment = {
    type: "image",
    id: ChatAttachmentId.make("img-fig5"),
    name: "overview-fig5.png",
    mimeType: "image/png",
    sizeBytes: 32_768,
  };
  const doc: ChatAttachment = {
    type: "file",
    id: ChatAttachmentId.make("doc-spec"),
    name: "design-spec.pdf",
    mimeType: "application/pdf",
    sizeBytes: 120_000,
  };
  return {
    thread: {
      id: ThreadId.make("thread-1"),
      title: "AGY 概览面板重构",
    },
    runs: [],
    attempts: [],
    nodes: [],
    subagents: [
      {
        id: NodeId.make("sub-1"),
        title: "UI Verifier",
        status: "running",
        driver: "claude",
        childThreadId: ThreadId.make("thread-sub-1"),
        prompt: "Inspect layout contrast",
      },
    ],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [
      {
        id: MessageId.make("m1"),
        role: "user",
        text: "/handoff 请把右侧面板改造成 AGY 概览风格，使用 $tdd 验证。",
        attachments: [img, doc],
      },
      {
        id: MessageId.make("m2"),
        role: "assistant",
        text: "已输出设计说明文档 `docs/overview.md`。",
        attachments: [],
      },
    ],
    plans: [
      {
        id: PlanId.make("plan-todo-1"),
        kind: "todo_list",
        status: "active",
        steps: [
          { id: "g1", text: "重构顶部三项快捷入口", status: "completed" },
          { id: "g2", text: "接入 8 大结构化区块", status: "running" },
        ],
      },
      {
        id: PlanId.make("plan-doc-1"),
        kind: "proposed_plan",
        status: "completed",
        markdown: "# 概览面板实施方案\n\n- 保留原有能力到更多菜单",
      },
    ],
    turnItems: [
      {
        id: TurnItemId.make("fc-1"),
        runId: RunId.make("run-1"),
        type: "file_change",
        fileName: "src/components/overview/SessionOverviewPanel.tsx",
        additions: 50,
        deletions: 8,
      },
    ],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
  } as unknown as OrchestrationV2ThreadProjection;
}

function makeBaseProps(
  overrides: Partial<SessionOverviewPanelProps> = {},
): SessionOverviewPanelProps {
  const noop = () => {};
  const scriptResult = async () => ({ ok: true }) as never;
  return {
    environmentId: EnvironmentId.make("env-1"),
    threadId: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    worktreePath: "/work/prismux",
    isServerThread: true,
    composerDraftTarget: {
      environmentId: EnvironmentId.make("env-1"),
      threadId: ThreadId.make("thread-1"),
    },
    activeProjectName: "Prismux",
    activeProjectScripts: [],
    preferredScriptId: null,
    keybindings: [],
    availableEditors: [],
    showOpenInPicker: true,
    openInShortcutEnabled: false,
    gitCwd: "/work/prismux",
    workspaceMutationId: null,
    isGitRepo: true,
    envLocked: false,
    availableEnvironments: [],
    onEnvModeChange: noop,
    envMode: "local",
    startFromOrigin: false,
    onStartFromOriginChange: noop,
    onComposerFocusRequest: noop,
    onRunProjectScript: noop,
    onAddProjectScript: scriptResult,
    onUpdateProjectScript: scriptResult,
    onDeleteProjectScript: scriptResult,
    usage: {} as never,
    daemonPtysOverride: [
      {
        id: "pty-dev",
        title: "vp dev",
        command: "pnpm dev",
        cwd: "/work/prismux",
        pid: 4321,
        alive: true,
      },
    ],
    ...overrides,
  };
}

describe("SessionOverviewPanel SSR & Component Markup", () => {
  beforeEach(() => {
    mockState.projection = createRichProjection();
    mockState.useQuietThreadShellSpy.mockClear();
    mockState.useThreadProjectionSpy.mockClear();
    mockState.useThreadRelationshipShellsSpy.mockClear();
  });

  it("renders AGY+Codex Overview header, 3 quick actions with +/- stats, 8 sections, liquid glass zone, and strictly NO Plugins row", () => {
    const html = renderToStaticMarkup(<SessionOverviewPanel {...makeBaseProps()} />);

    // Outer glass zone & header
    expect(html).toContain('data-pmx-glass-zone="rightSidebar"');
    expect(html).toContain('data-session-overview-panel="1"');
    expect(html).toContain(">概览<");
    expect(html).toContain('data-overview-more-trigger="1"');

    // Top 3 quick actions with real green/red diff stats
    expect(html).toContain('data-overview-action="review"');
    expect(html).toContain(">审查<");
    expect(html).toContain("+88");
    expect(html).toContain("-19");
    expect(html).toContain('data-overview-action="files"');
    expect(html).toContain(">文件列表<");
    expect(html).toContain('data-overview-action="continue-in-terminal"');
    expect(html).toContain(">在终端继续<");

    // Strictly NO 「插件」 / Plugins row
    expect(html).not.toContain("插件");
    expect(html).not.toContain("Plugins");

    // All 8 structured sections rendered with real data & counts
    for (const sectionId of [
      "subagents",
      "side-questions",
      "background-tasks",
      "goals",
      "artifacts",
      "modified-files",
      "uploads",
      "used-skills",
    ]) {
      expect(html).toContain(`data-overview-section="${sectionId}"`);
    }

    // Real data assertions across sections
    expect(html).toContain("UI Verifier"); // subagents
    expect(html).toContain('data-action="add-side-question"'); // side-questions + trigger
    expect(html).toContain("vp dev"); // background tasks (Daemon PTY)
    expect(html).toContain("1/2"); // goals completion count
    expect(html).toContain("概览面板实施方案"); // artifacts (proposed_plan)
    expect(html).toContain("SessionOverviewPanel.tsx"); // modified files
    expect(html).toContain(">TSX<"); // colored file type micro-badge
    expect(html).toContain("查看全部 (6)"); // default 4 items + expand toggle
    expect(html).toContain("overview-fig5.png"); // uploads (image)
    expect(html).toContain("design-spec.pdf"); // uploads (file)
    expect(html).toContain("/handoff"); // used skills (read-only slash command)
    expect(html).toContain(">tdd<"); // used skills (read-only skill ref)
  });

  it("renders default 4 modified files with 查看全部 toggle and collapses/expands cleanly via OverviewSectionBlock", () => {
    const files = extractOverviewModifiedFiles({
      diffStats: {
        insertions: 100,
        deletions: 20,
        files: [
          { path: "a/One.tsx", insertions: 10, deletions: 1 },
          { path: "b/Two.ts", insertions: 10, deletions: 1 },
          { path: "c/Three.css", insertions: 10, deletions: 1 },
          { path: "d/Four.json", insertions: 10, deletions: 1 },
          { path: "e/Five.md", insertions: 10, deletions: 1 },
        ],
      },
    });

    const collapsedHtml = renderToStaticMarkup(
      <ModifiedFilesOverviewSection items={files} onOpenFileDiff={() => {}} />,
    );
    expect(collapsedHtml).toContain("One.tsx");
    expect(collapsedHtml).toContain("Four.json");
    expect(collapsedHtml).not.toContain("Five.md");
    expect(collapsedHtml).toContain("查看全部 (5)");

    const expandedHtml = renderToStaticMarkup(
      <OverviewSectionBlock
        id="modified-files"
        title="已修改文件"
        count={5}
        emptyHint="empty"
        showAll
        onToggleShowAll={() => {}}
      >
        <div>Five.md</div>
      </OverviewSectionBlock>,
    );
    expect(expandedHtml).toContain("Five.md");
    expect(expandedHtml).toContain(">收起<");
  });

  it("renders SideQuestionComposer and persisted SideQuestion items with status labels", () => {
    const items = extractOverviewSideQuestions({
      currentThreadId: ThreadId.make("thread-1"),
      persisted: [
        createSideQuestionRecord({
          id: "sq-1",
          question: "如何避免主对话被污染？",
          contextSummary: "当前会话：测试",
          status: "answered",
          answer: "使用独立支线会话。",
        }),
        createSideQuestionRecord({
          id: "sq-2",
          question: "离线时问题会不会丢失？",
          contextSummary: "当前会话：测试",
          status: "offline",
        }),
      ],
    });

    const html = renderToStaticMarkup(
      <SideQuestionsOverviewSection
        items={items}
        composerOpen
        onToggleComposer={() => {}}
        onSelectItem={() => {}}
        composerSlot={
          <SideQuestionComposer
            open
            submitting={false}
            online
            contextMessageCount={4}
            onSubmit={() => {}}
            onClose={() => {}}
          />
        }
      />,
    );

    expect(html).toContain('data-side-question-composer="1"');
    expect(html).toContain("只读支线 · 附带上下文 (4 条)");
    expect(html).toContain("如何避免主对话被污染？");
    expect(html).toContain("已回复");
    expect(html).toContain("离线时问题会不会丢失？");
    expect(html).toContain("离线暂存");
  });

  it("supports diffStats override, threadAttachments, continueInTerminalDisabled, and empty/offline thread state cleanly", () => {
    mockState.projection = null;
    const extraAttachment: ChatAttachment = {
      type: "image",
      id: ChatAttachmentId.make("att-extra"),
      name: "screenshot-check.png",
      mimeType: "image/png",
      sizeBytes: 8_192,
    };

    const html = renderToStaticMarkup(
      <SessionOverviewPanel
        {...makeBaseProps({
          isServerThread: false,
          gitCwd: null,
          isGitRepo: false,
          continueInTerminalDisabled: true,
          diffStats: {
            insertions: 42,
            deletions: 7,
            files: [{ path: "packages/protocol/src/index.ts", insertions: 42, deletions: 7 }],
          },
          threadAttachments: [extraAttachment],
          daemonPtysOverride: [],
        })}
      />,
    );

    expect(html).toContain("+42");
    expect(html).toContain("-7");
    expect(html).toContain("screenshot-check.png");
    expect(html).toContain("index.ts");
    expect(html).toContain(">TS<");
    expect(html).toContain('data-overview-action="continue-in-terminal"');
    expect(html).toContain("disabled");
    expect(html).not.toContain("插件");

    // Draft threads (isServerThread === false) must NEVER subscribe to server thread atoms
    // that trigger GET /api/orchestration/threads/<draftId>/bounded -> HTTP 404.
    expect(mockState.useQuietThreadShellSpy).not.toHaveBeenCalled();
    expect(mockState.useThreadProjectionSpy).not.toHaveBeenCalled();
    expect(mockState.useThreadRelationshipShellsSpy).not.toHaveBeenCalled();
  });
});
