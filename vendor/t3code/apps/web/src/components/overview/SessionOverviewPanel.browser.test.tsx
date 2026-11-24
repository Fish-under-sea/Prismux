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
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

const SCRATCH_ROOT = "/home/user/.t3/scratch";

const mockState = vi.hoisted(() => ({
  projection: null as OrchestrationV2ThreadProjection | null,
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
  useQuietThreadShell: ((ref: unknown) =>
    ref === null
      ? null
      : {
          id: ThreadId.make("thread-1"),
          environmentId: EnvironmentId.make("env-1"),
          projectId: ProjectId.make("project-1"),
          title: "AGY 概览面板重构",
          worktreePath: "/work/prismux",
          branch: "main",
          pullRequests: [],
        }) as never,
  useThreadProjection: ((ref: unknown) =>
    ref === null || mockState.projection === null
      ? null
      : { projection: mockState.projection }) as never,
  useThreadRelationshipShells: (() => []) as never,
  useServerConfigs: (() =>
    new Map([
      [
        EnvironmentId.make("env-1"),
        {
          scratchWorkspaceRoot: SCRATCH_ROOT,
          environment: { capabilities: { pullRequests: true, sideChats: false } },
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

import { render } from "../../../test/render";
import { SessionOverviewPanel, type SessionOverviewPanelProps } from "./SessionOverviewPanel";
import { sideQuestionStorageKey } from "./sessionOverview.logic";

function createRichProjection(): OrchestrationV2ThreadProjection {
  const imageAttachment: ChatAttachment = {
    type: "image",
    id: ChatAttachmentId.make("img-fig5"),
    name: "overview-fig5.png",
    mimeType: "image/png",
    sizeBytes: 32_768,
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
        attachments: [imageAttachment],
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
        markdown: "# 概览面板实施方案\n\n- 保留原有能力到更多菜单\n- 移除插件入口",
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

describe("SessionOverviewPanel", () => {
  beforeEach(() => {
    window.localStorage.removeItem(sideQuestionStorageKey("env-1", "thread-1"));
    mockState.projection = createRichProjection();
  });

  it("renders Overview header, 3 quick actions with real diff stats, 8 sections, and strictly NO Plugins row", async () => {
    const onOpenDiffReview = vi.fn();
    const onOpenFiles = vi.fn();
    const onContinueInTerminal = vi.fn();

    await using screen = await render(
      <SessionOverviewPanel
        {...makeBaseProps({
          onOpenDiffReview,
          onOpenFiles,
          onContinueInTerminal,
        })}
      />,
    );

    const root = screen.container.querySelector('[data-session-overview-panel="1"]');
    expect(root?.getAttribute("data-pmx-glass-zone")).toBe("rightSidebar");

    await expect.element(screen.getByRole("heading", { name: "概览" })).toBeVisible();
    await expect.element(screen.getByText("+88")).toBeVisible();
    await expect.element(screen.getByText("-19")).toBeVisible();

    // Strictly NO 「插件」 quick action row
    expect(screen.container.textContent).not.toContain("插件");

    // Verify top 3 quick actions fire callbacks
    await userEvent.click(screen.getByRole("button", { name: /审查/ }));
    expect(onOpenDiffReview).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "文件列表" }));
    expect(onOpenFiles).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "在终端继续" }));
    expect(onContinueInTerminal).toHaveBeenCalledTimes(1);

    // Verify non-zero structured sections render while zero-count side-questions stays hidden
    for (const sectionId of [
      "subagents",
      "background-tasks",
      "goals",
      "artifacts",
      "modified-files",
      "uploads",
      "used-skills",
    ]) {
      expect(
        screen.container.querySelector(`[data-overview-section="${sectionId}"]`),
      ).not.toBeNull();
    }
    expect(screen.container.querySelector('[data-overview-section="side-questions"]')).toBeNull();

    // Verify read-only used skills extraction
    await expect.element(screen.getByText("/handoff")).toBeVisible();
    await expect.element(screen.getByText("tdd")).toBeVisible();
  });

  it("hides +0 -0 and all 8 zero-count sections on an empty thread while keeping top 3 quick actions", async () => {
    mockState.projection = null;

    await using screen = await render(
      <SessionOverviewPanel
        {...makeBaseProps({
          isServerThread: false,
          gitCwd: null,
          isGitRepo: false,
          diffStats: { insertions: 0, deletions: 0, files: [] },
          threadAttachments: [],
          daemonPtysOverride: [],
        })}
      />,
    );

    await expect.element(screen.getByRole("button", { name: "审查" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "文件列表" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "在终端继续" })).toBeVisible();
    expect(screen.container.querySelector('[data-overview-diff-stats="1"]')).toBeNull();
    expect(screen.container.querySelector("[data-thread-relationships-panel]")).toBeNull();
    expect(screen.container.querySelectorAll("[data-overview-section]").length).toBe(0);
  });

  it("shows first 4 modified files by default, toggles 查看全部/收起, and opens file diff on click", async () => {
    const onOpenDiffReview = vi.fn();
    await using screen = await render(
      <SessionOverviewPanel {...makeBaseProps({ onOpenDiffReview })} />,
    );

    const fileSection = screen.container.querySelector('[data-overview-section="modified-files"]')!;
    expect(fileSection.querySelectorAll("[data-overview-modified-file]").length).toBe(4);
    await expect.element(screen.getByText("TSX")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "查看全部 (6)" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "查看全部 (6)" }));
    expect(fileSection.querySelectorAll("[data-overview-modified-file]").length).toBe(6);
    await expect.element(screen.getByRole("button", { name: "收起" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(fileSection.querySelectorAll("[data-overview-modified-file]").length).toBe(4);

    // Click modified file row -> jumps to file diff
    const firstFileBtn = fileSection.querySelector<HTMLButtonElement>(
      '[data-overview-modified-file="src/components/overview/SessionOverviewPanel.tsx"]',
    )!;
    await userEvent.click(firstFileBtn);
    expect(onOpenDiffReview).toHaveBeenCalledWith(
      "src/components/overview/SessionOverviewPanel.tsx",
    );
  });

  it("initiates Side Questions from the ⋮ more menu when hidden, then dynamically reveals and persists the section", async () => {
    const onAskSideQuestion = vi.fn(async () => ({
      status: "answered" as const,
      answer: "使用单层 rightSidebar 液态玻璃即可保持高对比度。",
    }));

    await using screen = await render(
      <SessionOverviewPanel {...makeBaseProps({ onAskSideQuestion })} />,
    );

    // Side Questions section is hidden by default when count is 0
    expect(screen.container.querySelector('[data-overview-section="side-questions"]')).toBeNull();

    // Open ⋮ more menu and click 「发起旁路提问」
    await userEvent.click(screen.getByRole("button", { name: "更多操作" }));
    const askMenuAction = document.querySelector<HTMLButtonElement>(
      '[data-overview-more-action="add-side-question"]',
    );
    expect(askMenuAction).not.toBeNull();
    await userEvent.click(askMenuAction!);

    // Side Questions section dynamically appears with the inline composer open
    expect(
      screen.container.querySelector('[data-overview-section="side-questions"]'),
    ).not.toBeNull();
    const textarea = screen.getByRole("textbox", { name: "旁路提问内容" });
    await expect.element(textarea).toBeVisible();

    await userEvent.type(textarea, "液态玻璃如何保证可读性？");
    await userEvent.click(screen.getByRole("button", { name: "提问" }));

    expect(onAskSideQuestion).toHaveBeenCalledTimes(1);
    expect(
      screen.container.querySelector('[data-overview-count="side-questions"]')?.textContent,
    ).toBe("1");

    // Detail dialog opens with glass overlays zone & answer visible
    await expect
      .element(page.getByText("使用单层 rightSidebar 液态玻璃即可保持高对比度。"))
      .toBeVisible();
    const dialog = document.querySelector('[data-side-question-dialog="1"]');
    expect(dialog?.getAttribute("data-pmx-glass-zone")).toBe("overlays");

    // Verify persistence in localStorage
    const rawSaved = window.localStorage.getItem(sideQuestionStorageKey("env-1", "thread-1"));
    expect(rawSaved).toContain("液态玻璃如何保证可读性？");
    expect(rawSaved).toContain("使用单层 rightSidebar 液态玻璃即可保持高对比度。");
  });

  it("opens glass preview dialogs for artifacts, uploaded images, and the ⋮ workspace more menu", async () => {
    await using screen = await render(<SessionOverviewPanel {...makeBaseProps()} />);

    // Open artifact markdown preview dialog
    await userEvent.click(screen.getByRole("button", { name: /概览面板实施方案/ }));
    await expect.element(page.getByText(/保留原有能力到更多菜单/)).toBeVisible();
    expect(
      document.querySelector('[data-overview-artifact-dialog="1"]')?.getAttribute("data-pmx-glass-zone"),
    ).toBe("overlays");
    await userEvent.keyboard("{Escape}");

    // Open uploaded image preview dialog
    await userEvent.click(screen.getByRole("button", { name: /overview-fig5\.png/ }));
    await expect.element(page.getByText(/image\/png/)).toBeVisible();
    expect(
      document.querySelector('[data-overview-upload-dialog="1"]')?.getAttribute("data-pmx-glass-zone"),
    ).toBe("overlays");
    await userEvent.keyboard("{Escape}");

    // Open ⋮ more menu housing Workspace & Environment controls
    await userEvent.click(screen.getByRole("button", { name: "更多操作" }));
    await expect.element(page.getByText("工作区与环境")).toBeVisible();
    expect(
      document.querySelector('[data-overview-more-popover="1"]')?.getAttribute("data-pmx-glass-zone"),
    ).toBe("overlays");
  });
});
