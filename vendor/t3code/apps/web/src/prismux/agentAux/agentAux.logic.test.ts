import type {
  OrchestrationV2NativeChildWork,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { DaemonAgentAuxInspectResponse } from "../daemonClient";
import {
  buildAgentAuxViewModel,
  buildBeeTileBackground,
  buildHexPolygonPath,
  computeBeeHue,
  computeBeeRamp,
  computeHiveHexSlots,
  computeHiveLayout,
  computeMentionGraphLayout,
  formatAuxRoleLabel,
  formatAuxStatusLabel,
  formatAuxTaskStatusLabel,
  parseBoardMentions,
  parseSidecarSwarmLink,
  shouldAutoOpenAgentAux,
  tokenizeBoardText,
} from "./agentAux.logic";

function createAgySwarmSnapshot(
  overrides: Partial<DaemonAgentAuxInspectResponse> = {},
): DaemonAgentAuxInspectResponse {
  return {
    ok: true,
    active: true,
    hasLiveWork: true,
    kind: "agy-swarm",
    title: "Prismux v0.1.3 发布蜂群",
    activationKey: "agy-swarm:conv-root-001",
    updatedAt: 1_760_000_000_000,
    swarm: {
      id: "conv-root-001",
      title: "Prismux v0.1.3 发布蜂群",
      selfMember: "coordinator",
      head: 4,
      members: [
        {
          name: "coordinator",
          role: "coordinator",
          model: "claude-opus-4-6-high",
          conversationId: "conv-root-001",
          status: "working",
          waitSince: 0,
          killed: false,
          roleWorker: false,
          narrator: false,
          steps: 42,
          posts: 2,
          unread: 1,
          lastReadSeq: 2,
          lastPostSeq: 3,
          lastPostTime: "10:03",
          lastPostTs: 1_760_000_180_000,
          transcriptMtime: 1_760_000_180_000,
          activity: "汇总各路工人交付结果",
          activityKind: "thinking",
          wakeMode: "mentions",
          replied: false,
          replyAsk: "",
          failure: null,
        },
        {
          name: "agent-aux-pane",
          role: "worker",
          model: "claude-sonnet-4-5",
          conversationId: "conv-worker-002",
          status: "working",
          waitSince: 0,
          killed: false,
          roleWorker: false,
          narrator: false,
          steps: 18,
          posts: 1,
          unread: 0,
          lastReadSeq: 4,
          lastPostSeq: 2,
          lastPostTime: "10:02",
          lastPostTs: 1_760_000_120_000,
          transcriptMtime: 1_760_000_120_000,
          activity: "编写蜂群像素蜂组件",
          activityKind: "tool",
          wakeMode: "mentions",
          replied: false,
          replyAsk: "",
          failure: null,
        },
        {
          name: "old-helper",
          role: "verifier",
          model: "gemini-2.5-pro",
          conversationId: "conv-worker-003",
          status: "killed",
          waitSince: 0,
          killed: true,
          roleWorker: false,
          narrator: false,
          steps: 9,
          posts: 1,
          unread: 0,
          lastReadSeq: 4,
          lastPostSeq: 4,
          lastPostTime: "10:04",
          lastPostTs: 1_760_000_240_000,
          transcriptMtime: 1_760_000_240_000,
          activity: "",
          activityKind: "",
          wakeMode: "mentions",
          replied: false,
          replyAsk: "",
          failure: null,
        },
      ],
      messages: [
        {
          seq: 1,
          agent: "coordinator",
          text: "@agent-aux-pane 请实现蜂群侧边栏",
          time: "10:00",
          ts: 1_760_000_000_000,
          mentions: ["agent-aux-pane"],
          all: false,
        },
        {
          seq: 2,
          agent: "agent-aux-pane",
          text: "@coordinator 已完成后端只读探针，参见 #1 并参考 `AgentAuxService.ts`",
          time: "10:02",
          ts: 1_760_000_120_000,
          mentions: ["coordinator"],
          all: false,
        },
        {
          seq: 3,
          agent: "coordinator",
          text: "@all 请同步检查类型校验",
          time: "10:03",
          ts: 1_760_000_180_000,
          mentions: [],
          all: true,
        },
        {
          seq: 4,
          agent: "old-helper",
          text: "@coordinator 回归测试通过 #2",
          time: "10:04",
          ts: 1_760_000_240_000,
          mentions: ["coordinator"],
          all: false,
        },
      ],
      edges: [
        { from: "coordinator", to: "agent-aux-pane", count: 2, direct: 1, viaAll: 1 },
        { from: "agent-aux-pane", to: "coordinator", count: 1, direct: 1, viaAll: 0 },
        { from: "old-helper", to: "coordinator", count: 1, direct: 1, viaAll: 0 },
      ],
      plan: {
        goal: { title: "交付原生蜂群侧边栏", line: "多智能体只读适配" },
        tasks: { "agent-aux-pane": "实现多 Agent 辅助面板" },
        threads: [
          { id: "t-ui", title: "侧边栏 UI", goal: "1:1 复刻蜂群视觉", tasks: ["ws-1"] },
        ],
      },
      view: {
        goal: { title: "交付原生蜂群侧边栏", line: "AGY / CC / Codex 全适配" },
        headline: "前端视图施工中",
        phase: { label: "阶段 2", index: 2, total: 3 },
        workstreams: [
          {
            id: "ws-1",
            title: "蜂群像素蜂与画布渲染",
            state: "running",
            owners: ["agent-aux-pane"],
            note: "正在编写组件与单测",
            progress: { done: 3, total: 5, label: "3/5" },
            refs: [{ seq: 2 }],
          },
          {
            id: "ws-2",
            title: "后端只读探针",
            state: "done",
            owners: ["old-helper"],
            note: "6/6 测试通过",
            refs: [{ seq: 4 }],
          },
        ],
        threads: [
          { id: "t-ui", title: "侧边栏 UI", goal: "1:1 复刻", now: "进行中", workstreams: ["ws-1", "ws-2"] },
        ],
        attention: [
          {
            id: "att-1",
            kind: "review",
            severity: "med",
            title: "等待确认最终汉化文案",
            why: "协调者已准备验收",
            refs: [{ seq: 3, member: "coordinator" }],
          },
        ],
      },
      systemAttention: [],
    },
    ...overrides,
  };
}

describe("agentAux.logic", () => {
  it("computes deterministic 1:1 AGY bee hue, color ramp, and coordinator tile background", () => {
    expect(computeBeeHue("coordinator")).toBe(46);
    expect(computeBeeHue("agent-aux-pane")).toBe(computeBeeHue("agent-aux-pane"));
    const ramp = computeBeeRamp("coordinator");
    expect(ramp.mid).toMatch(/^#[0-9a-f]{6}$/);
    expect(ramp.ol).toMatch(/^#[0-9a-f]{6}$/);
    expect(buildBeeTileBackground("coordinator")).toContain("#1C1B22");
    expect(buildBeeTileBackground("agent-aux-pane")).toContain("color-mix(");
  });

  it("parses @mentions, @all, #seq references, and inline code accurately", () => {
    const parsed = parseBoardMentions(
      "请 @agent-aux-pane 和 @worker 查看 #12，同时 @all 注意",
      ["coordinator", "agent-aux-pane", "worker-1", "worker-2"],
    );
    expect(parsed.all).toBe(true);
    expect(parsed.mentions).toEqual(["agent-aux-pane", "worker-1", "worker-2"]);

    const tokens = tokenizeBoardText(
      "@coordinator 请看 #2 和 `AgentAuxService.ts` 以及 @all",
      new Set(["coordinator", "agent-aux-pane"]),
      10,
    );
    expect(tokens.some((t) => t.kind === "mention" && t.name === "coordinator" && !t.isAll)).toBe(true);
    expect(tokens.some((t) => t.kind === "seq" && t.seq === 2)).toBe(true);
    expect(tokens.some((t) => t.kind === "code" && t.value === "AgentAuxService.ts")).toBe(true);
    expect(tokens.some((t) => t.kind === "mention" && t.isAll)).toBe(true);
  });

  it("builds a complete AGY Swarm view model with 4 Chinese tabs, unread boundary, and layout", () => {
    const model = buildAgentAuxViewModel({
      provider: "antigravity",
      threadId: "thread-1" as ThreadId,
      daemonSnapshot: createAgySwarmSnapshot(),
    });

    expect(model.active).toBe(true);
    expect(model.hasLiveActivity).toBe(true);
    expect(model.kind).toBe("agy-swarm");
    expect(model.badgeLabel).toBe("🐝 蜂群协作");
    expect(model.entryLabel).toBe("蜂群侧边栏");
    expect(model.tabs.map((t) => t.label)).toEqual(["总览", "消息板", "成员", "图谱"]);
    expect(model.activeCount).toBe(2);
    expect(model.retiredCount).toBe(1);
    expect(model.unreadSeqBoundary).toBe(2);
    expect(model.messages.find((m) => m.seq === 4)?.isUnread).toBe(true);
    expect(model.messages.find((m) => m.seq === 3)?.isUnread).toBe(false); // posted by self

    const hive = computeHiveLayout({
      model,
      containerWidth: 380,
      replaySeq: null,
      hideInactive: false,
    });
    expect(hive.cells.length).toBeGreaterThanOrEqual(2);
    expect(hive.bees.some((b) => b.name === "coordinator" && b.isQueen)).toBe(true);
    expect(buildHexPolygonPath(100, 100, 40)).toMatch(/^M.*Z$/);
    expect(computeHiveHexSlots(6)).toHaveLength(6);

    const graphAllCollapsed = computeMentionGraphLayout({
      model,
      width: 360,
      replaySeq: 3,
      hideInactive: false,
      expandAll: false,
    });
    expect(graphAllCollapsed.nodes.find((n) => n.name === "coordinator")?.broadcastCount).toBe(1);
    const graphExpanded = computeMentionGraphLayout({
      model,
      width: 360,
      replaySeq: 3,
      hideInactive: false,
      expandAll: true,
    });
    expect(graphExpanded.edges.some((e) => e.from === "coordinator" && e.viaAllOnly)).toBe(true);
  });

  it("builds Claude Code Agent Team view model with Board + Members + Tasks tabs", () => {
    const model = buildAgentAuxViewModel({
      provider: "claudeAgent",
      threadId: "thread-cc" as ThreadId,
      daemonSnapshot: {
        ok: true,
        active: true,
        hasLiveWork: true,
        kind: "claude-team",
        title: "refactor-auth",
        activationKey: "claude-team:refactor-auth",
        updatedAt: 1_760_000_000_000,
        claudeTeam: {
          teamName: "refactor-auth",
          description: "重构鉴权与单测",
          leadSessionId: "cc-session-1",
          members: [
            {
              agentId: "lead-1",
              name: "team-lead",
              agentType: "team-lead",
              model: "claude-opus-4-6",
              color: "#d97757",
              cwd: "/repo",
              backendType: "in-process",
              isLead: true,
              status: "working",
            },
            {
              agentId: "w-1",
              name: "tester",
              agentType: "worker",
              model: "claude-sonnet-4-5",
              color: "#3b82f6",
              cwd: "/repo",
              backendType: "in-process",
              isLead: false,
              status: "waiting",
            },
          ],
          messages: [
            {
              seq: 1,
              agent: "tester",
              recipient: "team-lead",
              text: "@team-lead 单测全部通过",
              summary: "单测完成",
              time: "10:12",
              ts: 1_760_000_500_000,
              read: false,
              mentions: ["team-lead"],
              all: false,
            },
          ],
          edges: [{ from: "tester", to: "team-lead", count: 1, direct: 1, viaAll: 0 }],
        },
        tasks: [
          {
            id: "1",
            subject: "迁移 token 验证逻辑",
            description: "保持旧接口向后兼容",
            status: "completed",
            owner: "team-lead",
            blockedBy: [],
            blocks: ["2"],
            source: "claude-tasks",
          },
          {
            id: "2",
            subject: "补齐回归测试",
            description: "覆盖越权边界",
            status: "blocked",
            owner: "tester",
            blockedBy: ["1"],
            blocks: [],
            source: "claude-tasks",
          },
        ],
      },
    });

    expect(model.active).toBe(true);
    expect(model.kind).toBe("claude-team");
    expect(model.badgeLabel).toBe("Claude 智能体团队");
    expect(model.tabs.map((t) => t.id)).toEqual(["overview", "board", "members", "tasks"]);
    expect(model.tasks).toHaveLength(2);
    expect(model.tasks[1]?.blockedBy).toEqual(["1"]);
  });

  it("builds Codex Collab and generic provider subagents view models from live projection + daemon", () => {
    const codexModel = buildAgentAuxViewModel({
      provider: "codex",
      threadId: "thread-codex" as ThreadId,
      daemonSnapshot: {
        ok: true,
        active: true,
        hasLiveWork: true,
        kind: "codex-collab",
        title: "Codex 协同",
        activationKey: "codex-collab:s1",
        updatedAt: 1_760_000_000_000,
        codex: {
          goals: [
            {
              goalId: "g-1",
              threadId: "s1",
              objective: "修复并发死锁",
              status: "active",
              tokenBudget: 100000,
              tokensUsed: 12000,
              timeUsedSeconds: 45,
              createdAtMs: 1_760_000_000_000,
              updatedAtMs: 1_760_000_000_000,
            },
          ],
          spawnedThreads: [
            {
              threadId: "child-1",
              parentThreadId: "s1",
              nickname: "lock-auditor",
              role: "reviewer",
              title: "排查读写锁顺序",
              model: "gpt-5.3-codex",
              reasoningEffort: "high",
              status: "running",
              cwd: "/repo",
              updatedAtMs: 1_760_000_000_000,
            },
          ],
        },
        tasks: [
          {
            id: "g-1",
            subject: "修复并发死锁",
            description: "",
            status: "in_progress",
            owner: "Codex",
            blockedBy: [],
            blocks: [],
            progressLabel: "2/4",
            source: "codex-goals",
          },
        ],
      },
    });

    expect(codexModel.active).toBe(true);
    expect(codexModel.kind).toBe("codex-collab");
    expect(codexModel.badgeLabel).toBe("Codex 协同子代理");
    expect(codexModel.tabs.map((t) => t.id)).toEqual(["overview", "members", "tasks"]);
    expect(codexModel.members[0]?.displayName).toBe("lock-auditor");

    const opencodeShells: OrchestrationV2ThreadShell[] = [
      {
        id: "child-oc" as ThreadId,
        title: "Explore CSS tokens",
        status: "active",
        activityRunStatus: "running",
        lineage: { parentThreadId: "parent-oc" as ThreadId, sideChat: false },
      } as unknown as OrchestrationV2ThreadShell,
    ];
    const opencodeModel = buildAgentAuxViewModel({
      provider: "opencode",
      threadId: "parent-oc" as ThreadId,
      daemonSnapshot: null,
      relationshipShells: opencodeShells,
    });
    expect(opencodeModel.active).toBe(true);
    expect(opencodeModel.kind).toBe("provider-subagents");
    expect(opencodeModel.badgeLabel).toBe("OpenCode 协同侧边栏");
    expect(opencodeModel.hasLiveActivity).toBe(true);
  });

  it("merges AGY nativeChildWork steps and stays strictly inactive on single-agent chats", () => {
    const inactive = buildAgentAuxViewModel({
      provider: "codex",
      threadId: "plain-1" as ThreadId,
      daemonSnapshot: {
        ok: true,
        active: false,
        hasLiveWork: false,
        kind: null,
        title: "",
        activationKey: null,
        updatedAt: 1_760_000_000_000,
      },
      projection: { subagents: [], turnItems: [], plans: [] } as unknown as OrchestrationV2ThreadProjection,
    });
    expect(inactive.active).toBe(false);
    expect(inactive.hasLiveActivity).toBe(false);
    expect(inactive.tabs).toEqual([]);

    const nativeWork: OrchestrationV2NativeChildWork[] = [
      {
        conversationId: "conv-child-99",
        role: "explorer",
        prompt: "检查路由挂载点",
        steps: [
          {
            index: 1,
            type: "tool",
            status: "RUNNING",
            text: null,
            toolCalls: [{ name: "read_file", input: "ChatView.tsx" }],
          },
        ],
      } as unknown as OrchestrationV2NativeChildWork,
    ];
    const agySubModel = buildAgentAuxViewModel({
      provider: "antigravity",
      threadId: "thread-agy" as ThreadId,
      daemonSnapshot: null,
      nativeChildWork: nativeWork,
    });
    expect(agySubModel.active).toBe(true);
    expect(agySubModel.kind).toBe("agy-subagents");
    expect(agySubModel.members[0]?.nativeSteps).toHaveLength(1);
    expect(agySubModel.members[0]?.nativeSteps?.[0]?.toolCalls[0]?.summary).toBe("ChatView.tsx");
  });

  it("enforces strict one-shot activation-only auto-popup and parses sidecar://swarm links", () => {
    const liveModel = buildAgentAuxViewModel({
      provider: "antigravity",
      threadId: "t-1" as ThreadId,
      daemonSnapshot: createAgySwarmSnapshot(),
    });
    const opened = new Set<string>();

    const key1 = shouldAutoOpenAgentAux({
      isServerThread: true,
      threadKey: "env:t-1",
      model: liveModel,
      autoOpenedKeys: opened,
    });
    expect(key1).toBe("env:t-1::agy-swarm:conv-root-001");

    // Once recorded, must NEVER auto-open again
    opened.add(key1!);
    expect(
      shouldAutoOpenAgentAux({
        isServerThread: true,
        threadKey: "env:t-1",
        model: liveModel,
        autoOpenedKeys: opened,
      }),
    ).toBeNull();

    // Historical / finished swarm with no live activity must NOT auto-open
    const finishedModel = buildAgentAuxViewModel({
      provider: "antigravity",
      threadId: "t-2" as ThreadId,
      daemonSnapshot: createAgySwarmSnapshot({
        hasLiveWork: false,
        swarm: {
          ...createAgySwarmSnapshot().swarm!,
          members: [
            {
              ...createAgySwarmSnapshot().swarm!.members[0]!,
              status: "waiting",
            },
          ],
          view: { workstreams: [], attention: [] },
        },
      }),
    });
    expect(finishedModel.active).toBe(true);
    expect(finishedModel.hasLiveActivity).toBe(false);
    expect(
      shouldAutoOpenAgentAux({
        isServerThread: true,
        threadKey: "env:t-2",
        model: finishedModel,
        autoOpenedKeys: new Set(),
      }),
    ).toBeNull();

    // Draft / embedded thread must NOT auto-open
    expect(
      shouldAutoOpenAgentAux({
        isServerThread: false,
        threadKey: "env:t-1",
        model: liveModel,
        autoOpenedKeys: new Set(),
      }),
    ).toBeNull();
    expect(
      shouldAutoOpenAgentAux({
        isServerThread: true,
        embedded: true,
        threadKey: "env:t-1",
        model: liveModel,
        autoOpenedKeys: new Set(),
      }),
    ).toBeNull();

    // Sidecar URI parsing & Chinese formatters
    expect(parseSidecarSwarmLink("sidecar://swarm/board")).toEqual({ swarmPath: "/board" });
    expect(parseSidecarSwarmLink("https://example.com")).toBeNull();
    expect(formatAuxRoleLabel("coordinator")).toBe("协调者");
    expect(formatAuxRoleLabel("worker")).toBe("工人");
    expect(formatAuxStatusLabel("working")).toBe("运行中");
    expect(formatAuxStatusLabel("waiting_on", "coordinator")).toBe("等待 @coordinator");
    expect(formatAuxTaskStatusLabel("blocked")).toBe("已阻塞");
  });
});
