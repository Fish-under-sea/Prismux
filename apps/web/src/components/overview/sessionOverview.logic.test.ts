import {
  ChatAttachmentId,
  MessageId,
  NodeId,
  PlanId,
  RunId,
  ScheduledTaskId,
  ThreadId,
  TurnItemId,
  type ChatAttachment,
  type DiscoveredLocalServer,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type ScheduledTask,
  type VcsStatusResult,
} from "@prismux/core-contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_OVERVIEW_DISPLAY_PREFS,
  DEFAULT_OVERVIEW_SECTION_LIMIT,
  buildSideQuestionContextSummary,
  buildSideQuestionPrompt,
  computeDynamicOverviewSectionLimit,
  createSideQuestionRecord,
  deriveSideQuestionTitle,
  extractOverviewArtifacts,
  extractOverviewBackgroundTasks,
  extractOverviewGoals,
  extractOverviewModifiedFiles,
  extractOverviewSideQuestions,
  extractOverviewSubagents,
  extractOverviewUploads,
  extractOverviewUsedSkills,
  formatByteSize,
  loadOverviewDisplayPrefs,
  loadPersistedSideQuestions,
  removeSideQuestionRecord,
  resolveFileTypeBadge,
  resolveOverviewDiffStats,
  saveOverviewDisplayPrefs,
  savePersistedSideQuestions,
  sliceOverviewItems,
  splitRelativePath,
  upsertSideQuestionRecord,
} from "./sessionOverview.logic";

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) ?? null) : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

function createBaseProjection(
  overrides: Partial<OrchestrationV2ThreadProjection> = {},
): OrchestrationV2ThreadProjection {
  return {
    thread: {
      id: ThreadId.make("thread-main"),
      title: "重构概览面板",
    },
    runs: [],
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [],
    plans: [],
    turnItems: [],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    ...overrides,
  } as unknown as OrchestrationV2ThreadProjection;
}

describe("sessionOverview.logic", () => {
  it("resolves colored file type badges and splits Windows/POSIX relative paths", () => {
    expect(resolveFileTypeBadge("src/components/SessionOverviewPanel.tsx").label).toBe("TSX");
    expect(resolveFileTypeBadge("src/logic.ts").label).toBe("TS");
    expect(resolveFileTypeBadge("styles/theme.css").label).toBe("CSS");
    expect(resolveFileTypeBadge("package.json").label).toBe("JSON");
    expect(resolveFileTypeBadge("docs/README.md").label).toBe("MD");
    expect(resolveFileTypeBadge("Makefile").label).toBe("FILE");

    expect(splitRelativePath(".\\apps\\web\\src\\App.tsx")).toEqual({
      fileName: "App.tsx",
      dirPath: "apps/web/src",
      normalizedPath: "apps/web/src/App.tsx",
    });
    expect(splitRelativePath("README.md")).toEqual({
      fileName: "README.md",
      dirPath: "",
      normalizedPath: "README.md",
    });
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(24_576)).toBe("24.0 KB");
    expect(formatByteSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("slices overview items to 4 by default and toggles full visibility", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    const collapsed = sliceOverviewItems(items, false);
    expect(collapsed.visible).toHaveLength(DEFAULT_OVERVIEW_SECTION_LIMIT);
    expect(collapsed.hiddenCount).toBe(2);
    expect(collapsed.hasMore).toBe(true);

    const expanded = sliceOverviewItems(items, true);
    expect(expanded.visible).toHaveLength(6);
    expect(expanded.hiddenCount).toBe(0);
    expect(expanded.hasMore).toBe(true);

    const small = sliceOverviewItems(["x", "y"], false);
    expect(small.hasMore).toBe(false);
    expect(small.hiddenCount).toBe(0);
  });

  it("extracts and deduplicates modified files and resolves live diff stats (+/-)", () => {
    const projection = createBaseProjection({
      turnItems: [
        {
          id: TurnItemId.make("item-1"),
          runId: RunId.make("run-1"),
          type: "file_change",
          fileName: "src/components/overview/SessionOverviewPanel.tsx",
          additions: 120,
          deletions: 10,
        },
        {
          id: TurnItemId.make("item-2"),
          runId: RunId.make("run-1"),
          type: "file_change",
          fileName: "src/styles/app.css",
          additions: 15,
          deletions: 3,
        },
      ] as unknown as OrchestrationV2ThreadProjection["turnItems"],
      checkpoints: [
        {
          runId: RunId.make("run-1"),
          files: [
            {
              path: "package.json",
              kind: "modified",
              additions: 4,
              deletions: 1,
            },
          ],
        },
      ] as unknown as OrchestrationV2ThreadProjection["checkpoints"],
    });

    const gitStatus = {
      isRepo: true,
      workingTree: {
        files: [
          {
            path: "src\\components\\overview\\SessionOverviewPanel.tsx",
            insertions: 188,
            deletions: 22,
          },
          {
            path: "README.md",
            insertions: 12,
            deletions: 0,
          },
        ],
        insertions: 200,
        deletions: 22,
      },
    } as unknown as VcsStatusResult;

    const files = extractOverviewModifiedFiles({ gitStatus, projection });
    expect(files).toHaveLength(4);
    const tsx = files.find((f) => f.fileName === "SessionOverviewPanel.tsx");
    expect(tsx).toBeDefined();
    expect(tsx?.insertions).toBe(188);
    expect(tsx?.deletions).toBe(22);
    expect(tsx?.dirPath).toBe("src/components/overview");
    expect(tsx?.toolCallItemId).toBe(TurnItemId.make("item-1"));
    expect(tsx?.badge.label).toBe("TSX");

    const stats = resolveOverviewDiffStats({ gitStatus, modifiedFiles: files });
    expect(stats).toEqual({ insertions: 200, deletions: 22, fileCount: 4 });

    const overrideStats = resolveOverviewDiffStats({
      diffStats: { insertions: 42, deletions: 7 },
      gitStatus,
      modifiedFiles: files,
    });
    expect(overrideStats).toEqual({ insertions: 42, deletions: 7, fileCount: 4 });
  });

  it("extracts subagents from projection and child shells while excluding sideChats", () => {
    const mainId = ThreadId.make("thread-main");
    const subChildId = ThreadId.make("thread-sub-1");
    const sideChildId = ThreadId.make("thread-side-1");

    const projection = createBaseProjection({
      subagents: [
        {
          id: NodeId.make("node-1"),
          title: "Glass Engine Audit",
          status: "completed",
          driver: "claude",
          childThreadId: subChildId,
          prompt: "Audit glass tokens",
        },
        {
          id: NodeId.make("node-2"),
          title: "Running Reviewer",
          status: "running",
          driver: "codex",
          childThreadId: null,
          prompt: "Check diff",
        },
      ] as unknown as OrchestrationV2ThreadProjection["subagents"],
    });

    const shells = [
      {
        id: subChildId,
        title: "Glass Engine Audit",
        status: "idle",
        activityRunStatus: null,
        lineage: { parentThreadId: mainId, sideChat: false },
      },
      {
        id: sideChildId,
        title: "快速旁路提问",
        status: "idle",
        activityRunStatus: null,
        lineage: { parentThreadId: mainId, sideChat: true },
      },
    ] as unknown as OrchestrationV2ThreadShell[];

    const activeSubagents = extractOverviewSubagents({
      projection,
      relationshipShells: shells,
      currentThreadId: mainId,
    });
    // Active-only by default: completed subagent is hidden, running subagent remains
    expect(activeSubagents).toHaveLength(1);
    expect(activeSubagents[0]?.title).toContain("Running Reviewer");
    expect(activeSubagents.some((s) => s.childThreadId === sideChildId)).toBe(false);

    const allSubagents = extractOverviewSubagents({
      projection,
      relationshipShells: shells,
      currentThreadId: mainId,
      activeOnly: false,
    });
    expect(allSubagents).toHaveLength(2);
    // Running subagent sorted first
    expect(allSubagents[0]?.title).toContain("Running Reviewer");
    expect(allSubagents.some((s) => s.childThreadId === sideChildId)).toBe(false);
  });

  it("extracts and merges persisted side questions with native sideChat shells, hiding finished items by default", () => {
    const mainId = ThreadId.make("thread-main");
    const linkedId = ThreadId.make("thread-side-linked");
    const otherNativeId = ThreadId.make("thread-side-native");

    const persisted = [
      createSideQuestionRecord({
        id: "sq-1",
        question: "这里的 backdrop-filter 会不会二次叠加？",
        contextSummary: "当前会话：概览面板",
        status: "answered",
        answer: "不会，因为外层保持单层玻璃。",
        linkedSideThreadId: linkedId,
        nowIso: "2026-11-23T14:00:00.000Z",
      }),
      createSideQuestionRecord({
        id: "sq-done",
        question: "已完成回答的历史提问",
        contextSummary: "当前会话：概览面板",
        status: "answered",
        answer: "已回答完毕。",
        nowIso: "2026-11-23T13:55:00.000Z",
      }),
    ];

    const shells = [
      {
        id: linkedId,
        title: "backdrop-filter 排查",
        status: "running",
        activityRunStatus: "running",
        updatedAt: "2026-11-23T14:01:00.000Z",
        lineage: { parentThreadId: mainId, sideChat: true },
      },
      {
        id: otherNativeId,
        title: "另一个原生支线",
        status: "idle",
        activityRunStatus: null,
        updatedAt: "2026-11-23T14:02:00.000Z",
        lineage: { parentThreadId: mainId, sideChat: true },
      },
    ] as unknown as OrchestrationV2ThreadShell[];

    const activeItems = extractOverviewSideQuestions({
      persisted,
      relationshipShells: shells,
      currentThreadId: mainId,
    });
    expect(activeItems).toHaveLength(1);
    expect(activeItems[0]?.id).toBe("sq-1");
    expect(activeItems[0]?.status).toBe("pending"); // live running shell upgrades status

    const allItems = extractOverviewSideQuestions({
      persisted,
      relationshipShells: shells,
      currentThreadId: mainId,
      activeOnly: false,
    });
    expect(allItems).toHaveLength(3);
    expect(allItems[1]?.id).toBe("sq-done");
    expect(allItems[2]?.id).toBe(`native:${otherNativeId}`);
    expect(allItems[2]?.source).toBe("native");
  });

  it("aggregates background tasks and hides exited/paused tasks by default unless activeOnly is false", () => {
    const mainId = ThreadId.make("thread-main");
    const projection = createBaseProjection({
      turnItems: [
        {
          id: TurnItemId.make("cmd-1"),
          type: "command_execution",
          input: "pnpm --filter @prismux/web dev",
          status: "running",
          monitor: true,
        },
        {
          id: TurnItemId.make("cmd-finished"),
          type: "command_execution",
          input: "pnpm test",
          status: "completed",
          monitor: true,
        },
      ] as unknown as OrchestrationV2ThreadProjection["turnItems"],
    });

    const baseInput = {
      currentThreadId: mainId,
      projection,
      daemonPtys: [
        {
          id: "pty-active",
          title: "vite dev server",
          command: "vp dev",
          cwd: "D:/Fish-code/AGY/Prismux",
          pid: 12345,
          alive: true,
        },
        {
          id: "pty-exited",
          title: "finished build shell",
          command: "pnpm build",
          cwd: "D:/Fish-code/AGY/Prismux",
          pid: null,
          alive: false,
          stale: false,
        },
        {
          id: "pty-stale-dead",
          title: "old shell",
          command: "pwsh",
          cwd: "D:/tmp",
          pid: null,
          alive: false,
          stale: true,
        },
      ],
      discoveredServers: [
        {
          pid: 4567,
          port: 5733,
          url: "http://localhost:5733",
          processName: "node",
          terminal: null,
        } as unknown as DiscoveredLocalServer,
      ],
      scheduledTasks: [
        {
          id: ScheduledTaskId.make("task-1"),
          threadId: mainId,
          title: "每日健康巡检",
          enabled: true,
          lastRunStatus: "succeeded",
        } as unknown as ScheduledTask,
        {
          id: ScheduledTaskId.make("task-paused"),
          threadId: mainId,
          title: "已暂停巡检",
          enabled: false,
          lastRunStatus: "succeeded",
        } as unknown as ScheduledTask,
      ],
    };

    const activeTasks = extractOverviewBackgroundTasks(baseInput);
    expect(activeTasks.map((t) => t.kind)).toEqual([
      "daemon-pty",
      "command",
      "server",
      "automation",
    ]);
    expect(activeTasks.some((t) => t.id.includes("pty-exited"))).toBe(false);
    expect(activeTasks.some((t) => t.id.includes("pty-stale-dead"))).toBe(false);
    expect(activeTasks.some((t) => t.id.includes("cmd-finished"))).toBe(false);
    expect(activeTasks.some((t) => t.id.includes("task-paused"))).toBe(false);

    const allTasks = extractOverviewBackgroundTasks({ ...baseInput, activeOnly: false });
    expect(allTasks.some((t) => t.id.includes("pty-exited"))).toBe(true);
    expect(allTasks.some((t) => t.id.includes("cmd-finished"))).toBe(true);
    expect(allTasks.some((t) => t.id.includes("task-paused"))).toBe(true);
  });

  it("extracts goals, hides completed steps while in progress, and hides 100%-completed checklists by default", () => {
    const withTodo = createBaseProjection({
      plans: [
        {
          id: PlanId.make("plan-todo"),
          kind: "todo_list",
          status: "active",
          steps: [
            { id: "s1", text: "锁定 props 契约", status: "completed" },
            { id: "s2", text: "实现 8 大概览区块", status: "running" },
            { id: "s3", text: "补齐单测", status: "pending" },
          ],
        },
      ] as unknown as OrchestrationV2ThreadProjection["plans"],
    });

    const structuredActive = extractOverviewGoals({ projection: withTodo });
    expect(structuredActive.completedCount).toBe(1);
    expect(structuredActive.totalCount).toBe(3);
    expect(structuredActive.allCompleted).toBe(false);
    expect(structuredActive.items.map((item) => item.id)).toEqual(["s2", "s3"]);

    const structuredAll = extractOverviewGoals({ projection: withTodo, activeOnly: false });
    expect(structuredAll.items).toHaveLength(3);

    const allDoneTodo = createBaseProjection({
      plans: [
        {
          id: PlanId.make("plan-done"),
          kind: "todo_list",
          status: "completed",
          steps: [
            { id: "s1", text: "步骤一", status: "completed" },
            { id: "s2", text: "步骤二", status: "completed" },
          ],
        },
      ] as unknown as OrchestrationV2ThreadProjection["plans"],
    });
    const hiddenDone = extractOverviewGoals({ projection: allDoneTodo });
    expect(hiddenDone).toEqual({ items: [], completedCount: 2, totalCount: 0, allCompleted: true });

    const shownDone = extractOverviewGoals({ projection: allDoneTodo, activeOnly: false });
    expect(shownDone.items).toHaveLength(2);
    expect(shownDone.totalCount).toBe(2);
    expect(shownDone.allCompleted).toBe(true);

    const withMarkdownChecklist = createBaseProjection({
      plans: [
        {
          id: PlanId.make("plan-md"),
          kind: "proposed_plan",
          status: "active",
          markdown: [
            "# Plan",
            "- [x] 完成调研",
            "- [/] 编写代码",
            "- [ ] 验证截图",
            "```md",
            "- [ ] 代码块里的假任务不该被提取",
            "```",
          ].join("\n"),
        },
      ] as unknown as OrchestrationV2ThreadProjection["plans"],
    });
    const parsedActive = extractOverviewGoals({ projection: withMarkdownChecklist });
    expect(parsedActive.totalCount).toBe(3);
    expect(parsedActive.completedCount).toBe(1);
    expect(parsedActive.items).toHaveLength(2);
    expect(parsedActive.items[0]?.status).toBe("running");

    const parsedAll = extractOverviewGoals({
      projection: withMarkdownChecklist,
      activeOnly: false,
    });
    expect(parsedAll.items).toHaveLength(3);
    expect(parsedAll.items[1]?.status).toBe("running");
  });

  it("extracts artifacts, always skipping superseded plans and hiding completed plans by default", () => {
    const projection = createBaseProjection({
      plans: [
        {
          id: PlanId.make("plan-superseded"),
          kind: "proposed_plan",
          status: "superseded",
          markdown: "# 已废弃方案\n\n旧版本",
        },
        {
          id: PlanId.make("plan-active"),
          kind: "proposed_plan",
          status: "active",
          markdown: "# 进行中设计方案\n\n详细内容...",
        },
        {
          id: PlanId.make("plan-completed"),
          kind: "proposed_plan",
          status: "completed",
          markdown: "# 已完成历史方案\n\n归档内容...",
        },
      ] as unknown as OrchestrationV2ThreadProjection["plans"],
      messages: [
        {
          id: MessageId.make("msg-1"),
          role: "assistant",
          text: "已生成 [walkthrough.md](file:///D:/repo/docs/walkthrough.md) 与 `docs/summary.md`，外部参考 [remote](https://example.com/guide.md) 忽略。",
          attachments: [],
        },
      ] as unknown as OrchestrationV2ThreadProjection["messages"],
    });

    const modifiedFiles = extractOverviewModifiedFiles({
      diffStats: {
        insertions: 20,
        deletions: 0,
        files: [{ path: "docs/summary.md", insertions: 20, deletions: 0 }],
      },
    });

    const activeArtifacts = extractOverviewArtifacts({ projection, modifiedFiles });
    expect(activeArtifacts.map((a) => a.title)).toEqual([
      "进行中设计方案",
      "summary.md",
      "walkthrough.md",
    ]);
    expect(activeArtifacts.some((a) => a.title.includes("remote"))).toBe(false);
    expect(activeArtifacts.some((a) => a.title.includes("已完成历史方案"))).toBe(false);
    expect(activeArtifacts.some((a) => a.title.includes("已废弃方案"))).toBe(false);
    expect(activeArtifacts[0]?.markdown).toContain("详细内容");

    const allArtifacts = extractOverviewArtifacts({
      projection,
      modifiedFiles,
      activeOnly: false,
    });
    expect(allArtifacts.map((a) => a.title)).toEqual([
      "进行中设计方案",
      "已完成历史方案",
      "summary.md",
      "walkthrough.md",
    ]);
    expect(allArtifacts.some((a) => a.title.includes("已废弃方案"))).toBe(false);
  });

  it("extracts uploaded images and files deduplicated across messages and threadAttachments", () => {
    const img: ChatAttachment = {
      type: "image",
      id: ChatAttachmentId.make("att-img-1"),
      name: "fig5-overview.png",
      mimeType: "image/png",
      sizeBytes: 48_000,
    };
    const doc: ChatAttachment = {
      type: "file",
      id: ChatAttachmentId.make("att-doc-1"),
      name: "spec.pdf",
      mimeType: "application/pdf",
      sizeBytes: 210_000,
    };

    const projection = createBaseProjection({
      messages: [
        {
          id: MessageId.make("m1"),
          role: "user",
          text: "参考图五",
          attachments: [img],
        },
      ] as unknown as OrchestrationV2ThreadProjection["messages"],
    });

    const uploads = extractOverviewUploads({
      projection,
      threadAttachments: [img, doc],
    });
    expect(uploads).toHaveLength(2);
    expect(uploads[0]?.kind).toBe("image");
    expect(uploads[1]?.kind).toBe("file");
    expect(uploads[1]?.name).toBe("spec.pdf");
  });

  it("extracts used slash commands and skills read-only while filtering paths, URLs, and env vars", () => {
    const projection = createBaseProjection({
      messages: [
        {
          id: MessageId.make("m1"),
          role: "user",
          text: "/handoff 先交接一下，另外看看 https://example.com/plan 和 /src/app.ts，使用 $tdd 和 $PATH",
          attachments: [],
        },
        {
          id: MessageId.make("m2"),
          role: "user",
          text: "/handoff 再跑一次\n```\n/fake-inside-codeblock\n```\n/grill-me",
          attachments: [],
        },
      ] as unknown as OrchestrationV2ThreadProjection["messages"],
      turnItems: [
        {
          id: TurnItemId.make("dt-1"),
          type: "dynamic_tool",
          toolName: "read_file",
          input: { Path: "C:/Users/Fish/.gemini/config/skills/systematic-debugging/SKILL.md" },
        },
      ] as unknown as OrchestrationV2ThreadProjection["turnItems"],
    });

    const skills = extractOverviewUsedSkills({ projection });
    const names = skills.map((s) => s.name);
    expect(names).toContain("/handoff");
    expect(names).toContain("/grill-me");
    expect(names).toContain("tdd");
    expect(names).toContain("systematic-debugging");
    expect(names).not.toContain("/fake-inside-codeblock");
    expect(names).not.toContain("/src");
    expect(names).not.toContain("PATH");
    expect(skills.find((s) => s.name === "/handoff")?.count).toBe(2);
  });

  it("builds bounded side-question context prompts and persists records in storage", () => {
    const projection = createBaseProjection({
      messages: [
        { id: MessageId.make("u1"), role: "user", text: "帮我重构右侧概览面板", attachments: [] },
        { id: MessageId.make("a1"), role: "assistant", text: "好的，已规划 8 大区块。", attachments: [] },
      ] as unknown as OrchestrationV2ThreadProjection["messages"],
    });
    const summary = buildSideQuestionContextSummary({
      threadTitle: "AGY 概览",
      cwd: "D:/Fish-code/AGY/Prismux",
      projection,
    });
    expect(summary).toContain("当前会话：AGY 概览");
    expect(summary).toContain("帮我重构右侧概览面板");

    const prompt = buildSideQuestionPrompt("为什么不用插件行？", summary);
    expect(prompt).toContain("旁路只读提问");
    expect(prompt).toContain("为什么不用插件行？");
    expect(deriveSideQuestionTitle("  第一行问题标题\n第二行详情")).toBe("第一行问题标题");

    const storage = makeMemoryStorage();
    const q1 = createSideQuestionRecord({
      id: "sq-a",
      question: "问题 A",
      contextSummary: summary,
      status: "answered",
      answer: "答案 A",
    });
    const q2 = createSideQuestionRecord({
      id: "sq-b",
      question: "问题 B",
      contextSummary: summary,
      status: "offline",
    });

    const afterInsert = upsertSideQuestionRecord(upsertSideQuestionRecord([], q1), q2);
    savePersistedSideQuestions("env-1", "thread-1", afterInsert, storage);

    const loaded = loadPersistedSideQuestions("env-1", "thread-1", storage);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.id).toBe("sq-b");
    expect(loaded[1]?.answer).toBe("答案 A");

    const afterRemove = removeSideQuestionRecord(loaded, "sq-a");
    savePersistedSideQuestions("env-1", "thread-1", afterRemove, storage);
    expect(loadPersistedSideQuestions("env-1", "thread-1", storage)).toHaveLength(1);
  });

  it("dynamically scales per-section visible limits across compact window, medium window, fullscreen, and explicit modes", () => {
    // Compact window (320px height, 3 active sections) -> 1 item per section
    expect(
      computeDynamicOverviewSectionLimit({
        availableHeightPx: 320,
        activeSectionCount: 3,
        limitMode: "auto",
      }),
    ).toBe(1);

    // Compact window with 2 active sections at 360px -> 2 items per section
    expect(
      computeDynamicOverviewSectionLimit({
        availableHeightPx: 360,
        activeSectionCount: 2,
        limitMode: "auto",
      }),
    ).toBe(2);

    // Medium window (540px height, 3 sections) -> 3 items per section
    expect(
      computeDynamicOverviewSectionLimit({
        availableHeightPx: 540,
        activeSectionCount: 3,
        limitMode: "auto",
      }),
    ).toBe(3);

    // Fullscreen (860px height, 2 sections -> clamped to 8; 5 sections -> 3)
    expect(
      computeDynamicOverviewSectionLimit({
        availableHeightPx: 860,
        activeSectionCount: 2,
        limitMode: "auto",
      }),
    ).toBe(8);
    expect(
      computeDynamicOverviewSectionLimit({
        availableHeightPx: 860,
        activeSectionCount: 5,
        limitMode: "auto",
      }),
    ).toBe(3);

    // Linked PR strip deducts vertical chrome budget
    const withoutPr = computeDynamicOverviewSectionLimit({
      availableHeightPx: 430,
      activeSectionCount: 2,
      limitMode: "auto",
      hasLinkedPrs: false,
    });
    const withPr = computeDynamicOverviewSectionLimit({
      availableHeightPx: 430,
      activeSectionCount: 2,
      limitMode: "auto",
      hasLinkedPrs: true,
    });
    expect(withPr).toBeLessThanOrEqual(withoutPr);

    // Explicit fixed modes override dynamic calculation
    for (const fixed of [2, 3, 5, 8] as const) {
      expect(
        computeDynamicOverviewSectionLimit({
          availableHeightPx: 320,
          activeSectionCount: 6,
          limitMode: fixed,
        }),
      ).toBe(fixed);
    }

    // Fallback to default limit when availableHeightPx is unavailable (0 / SSR)
    expect(
      computeDynamicOverviewSectionLimit({
        availableHeightPx: 0,
        activeSectionCount: 3,
        limitMode: "auto",
      }),
    ).toBe(DEFAULT_OVERVIEW_SECTION_LIMIT);
  });

  it("persists and validates overview display preferences in storage", () => {
    const storage = makeMemoryStorage();
    expect(loadOverviewDisplayPrefs(storage)).toEqual(DEFAULT_OVERVIEW_DISPLAY_PREFS);

    saveOverviewDisplayPrefs({ limitMode: 5, showCompleted: true }, storage);
    expect(loadOverviewDisplayPrefs(storage)).toEqual({ limitMode: 5, showCompleted: true });

    // Corrupted JSON or invalid limitMode gracefully falls back
    storage.setItem("prismux.overview.displayPrefs.v1", '{"limitMode":99,"showCompleted":false}');
    expect(loadOverviewDisplayPrefs(storage)).toEqual({ limitMode: "auto", showCompleted: false });

    storage.setItem("prismux.overview.displayPrefs.v1", "not-json");
    expect(loadOverviewDisplayPrefs(storage)).toEqual(DEFAULT_OVERVIEW_DISPLAY_PREFS);
  });
});
