import type {
  OrchestrationV2NativeChildWork,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
  ThreadId,
} from "@prismux/core-contracts";
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
  computeHiveStateAtSeq,
  computeMentionGraphLayout,
  computeReplayDelayMs,
  extractScreenshotsFromText,
  formatAuxRoleLabel,
  formatAuxStatusLabel,
  formatAuxTaskStatusLabel,
  parseBoardMentions,
  parseSidecarSwarmLink,
  shortenWorkspacePath,
  shouldAutoOpenAgentAux,
  stripLeadingMentionTokens,
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
          workspaceMode: "share",
          workspace: "C:\\Users\\Fish\\.gemini\\antigravity\\worktrees\\swarm-w2-swarm-panel",
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
          text: "@coordinator 已完成后端只读探针，参见 #1 并参考 `AgentAuxService.ts`？",
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
          text: "@coordinator [done] 回归测试通过 #2\nScreenshot: /tmp/verify.png | 实机验证截图",
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
        threads: [{ id: "t-ui", title: "侧边栏 UI", goal: "1:1 复刻蜂群视觉", tasks: ["ws-1"] }],
      },
      view: {
        goal: { title: "交付原生蜂群侧边栏", line: "AGY / CC / Codex 全适配" },
        headline: "前端视图施工中",
        phase: { label: "阶段 2", index: 2, total: 3 },
        workstreams: [
          {
            id: "ws-1",
            title: "蜂群像素蜂与画布渲染",
            state: "review",
            owners: ["agent-aux-pane"],
            note: "正在等待校验审阅",
            progress: { done: 3, total: 5, label: "3/5" },
            refs: [{ seq: 2 }],
          },
          {
            id: "ws-2",
            title: "后端只读探针",
            state: "done",
            owners: ["old-helper"],
            note: "8/8 测试通过",
            refs: [{ seq: 4 }],
          },
        ],
        threads: [
          {
            id: "t-ui",
            title: "侧边栏 UI",
            goal: "1:1 复刻",
            now: "进行中",
            workstreams: ["ws-1", "ws-2"],
          },
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
  it("computes deterministic 1:1 AGY bee hue, color ramp, and tri-theme coordinator tile token (zero #1C1B22)", () => {
    expect(computeBeeHue("coordinator")).toBe(46);
    expect(computeBeeHue("agent-aux-pane")).toBe(computeBeeHue("agent-aux-pane"));
    const ramp = computeBeeRamp("coordinator");
    expect(ramp.mid).toMatch(/^#[0-9a-f]{6}$/);
    expect(ramp.ol).toMatch(/^#[0-9a-f]{6}$/);
    const coordBg = buildBeeTileBackground("coordinator");
    expect(coordBg).toBe("var(--pmx-aux-coord-bg)");
    expect(coordBg).not.toContain("#1C1B22");
    expect(buildBeeTileBackground("agent-aux-pane")).toContain("color-mix(");
  });

  it("parses @mentions, @all, #seq references, screenshots, workspace paths, and leading mention stripping", () => {
    const parsed = parseBoardMentions("请 @agent-aux-pane 和 @worker 查看 #12，同时 @all 注意", [
      "coordinator",
      "agent-aux-pane",
      "worker-1",
      "worker-2",
    ]);
    expect(parsed.all).toBe(true);
    expect(parsed.mentions).toEqual(["agent-aux-pane", "worker-1", "worker-2"]);

    const tokens = tokenizeBoardText(
      "@coordinator 请看 #2 和 `AgentAuxService.ts` 以及 @all",
      new Set(["coordinator", "agent-aux-pane"]),
      10,
    );
    expect(tokens.some((t) => t.kind === "mention" && t.name === "coordinator" && !t.isAll)).toBe(
      true,
    );
    expect(tokens.some((t) => t.kind === "seq" && t.seq === 2)).toBe(true);
    expect(tokens.some((t) => t.kind === "code" && t.value === "AgentAuxService.ts")).toBe(true);
    expect(tokens.some((t) => t.kind === "mention" && t.isAll)).toBe(true);

    expect(stripLeadingMentionTokens("@coordinator [done] 完成构建", ["coordinator"], false)).toBe(
      "[done] 完成构建",
    );
    expect(shortenWorkspacePath("C:\\Users\\Fish\\.gemini\\antigravity\\worktrees\\swarm-w2")).toBe(
      "…/worktrees/swarm-w2",
    );
    expect(extractScreenshotsFromText("ok\nScreenshot: /tmp/a.png | 首页预览\n")).toEqual([
      { path: "/tmp/a.png", caption: "首页预览" },
    ]);
  });

  it("builds a complete AGY Swarm view model with 4 native Chinese tabs, historical replay scrubbing, and +N overflow", () => {
    const model = buildAgentAuxViewModel({
      provider: "antigravity",
      threadId: "thread-1" as ThreadId,
      daemonSnapshot: createAgySwarmSnapshot(),
      locale: "zh",
    });

    expect(model.active).toBe(true);
    expect(model.hasLiveActivity).toBe(true);
    expect(model.kind).toBe("agy-swarm");
    expect(model.useBees).toBe(true);
    expect(model.badgeLabel).toBe("蜂群协同");
    expect(model.entryLabel).toBe("蜂群侧边栏");
    expect(model.tabs.map((t) => t.label)).toEqual(["概览", "看板", "成员", "关系图"]);
    expect(model.activeCount).toBe(2);
    expect(model.retiredCount).toBe(1);
    expect(model.unreadSeqBoundary).toBe(2);
    expect(model.messages.find((m) => m.seq === 4)?.isUnread).toBe(true);
    expect(model.messages.find((m) => m.seq === 3)?.isUnread).toBe(false); // posted by self
    expect(model.workstreams[0]?.rawState).toBe("review");

    // True historical state reconstruction at seq=1, seq=2, seq=4
    const atSeq1 = computeHiveStateAtSeq(model, 1);
    expect(atSeq1.states["agent-aux-pane"]?.st).toBe("working");
    expect(atSeq1.states["old-helper"]?.st).toBe("unborn");
    expect(atSeq1.beam?.seq).toBe(1);

    const atSeq2 = computeHiveStateAtSeq(model, 2);
    expect(atSeq2.states["agent-aux-pane"]?.st).toBe("wait");
    expect(atSeq2.states["agent-aux-pane"]?.who).toBe("coordinator");

    const atSeq4 = computeHiveStateAtSeq(model, 4);
    expect(atSeq4.states["old-helper"]?.st).toBe("done");
    expect(atSeq4.isDoneAtSeq?.("old-helper")).toBe(true);

    // Variable replay pacing (`even` vs `real`)
    expect(computeReplayDelayMs(model.messages, 1, "even", 2)).toBe(700);
    const realDelay = computeReplayDelayMs(model.messages, 1, "real", 1);
    expect(realDelay).toBeGreaterThanOrEqual(250);
    expect(realDelay).toBeLessThanOrEqual(4000);

    // Hive layout with > 6 workers in one hex verifies 5 visible + "+N" overflow
    const manyWorkersSnap = createAgySwarmSnapshot();
    const extraMembers = Array.from({ length: 8 }, (_, idx) => ({
      ...manyWorkersSnap.swarm!.members[1]!,
      name: `w-extra-${idx + 1}`,
      conversationId: `conv-extra-${idx + 1}`,
      status: idx === 0 ? ("working" as const) : ("waiting" as const),
    }));
    const manyModel = buildAgentAuxViewModel({
      provider: "antigravity",
      threadId: "thread-many" as ThreadId,
      daemonSnapshot: {
        ...manyWorkersSnap,
        swarm: {
          ...manyWorkersSnap.swarm!,
          members: [manyWorkersSnap.swarm!.members[0]!, ...extraMembers],
          view: {
            ...manyWorkersSnap.swarm!.view!,
            workstreams: extraMembers.map((m, idx) => ({
              id: `ws-e-${idx}`,
              title: `子任务 ${idx + 1}`,
              state: idx === 0 ? "running" : "done",
              owners: [m.name],
            })),
            threads: [
              {
                id: "t-big",
                title: "大工作组",
                workstreams: extraMembers.map((_, idx) => `ws-e-${idx}`),
              },
            ],
          },
        },
      },
      locale: "zh",
    });

    const hive = computeHiveLayout({
      model: manyModel,
      containerWidth: 460,
      replaySeq: null,
      hideInactive: false,
      zoom: 1.4,
    });
    expect(hive.cells.length).toBeGreaterThanOrEqual(2);
    expect(hive.bees.some((b) => b.name === "coordinator" && b.isQueen)).toBe(true);
    const bigCell = hive.cells.find((c) => c.id === "t-big");
    expect(bigCell?.overflowCount).toBeGreaterThan(0);
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

  it("unifies normal ACP / Prismux MCP multi-agent (Codex -> DSH) onto ALL 4 tabs with Coordinator, Board, Members & Hive", () => {
    const acpModel = buildAgentAuxViewModel({
      provider: "codex",
      threadId: "thread-codex-main" as ThreadId,
      threadShell: {
        id: "thread-codex-main" as ThreadId,
        title: "Codex 委派 DSH 修复路由",
        activityRunStatus: "running",
        lineage: {},
      },
      projection: {
        runs: [{ id: "run-1", status: "running" }],
        subagents: [
          {
            id: "sub-dsh-1",
            runId: "run-1",
            title: "DSH 类型修复",
            status: "running",
            driver: "dsh",
            model: "deepseek-reasoner",
            childThreadId: "thread-dsh-child-1" as ThreadId,
            prompt: "排查 apps/web 中的路由类型错误并修复",
            progress: "正在运行 vp typecheck 验证",
            startedAt: 1_760_000_010_000,
          },
          {
            id: "sub-claude-2",
            runId: "run-1",
            title: "Claude 安全审查",
            status: "completed",
            driver: "claudeAgent",
            model: "claude-sonnet-4-5",
            childThreadId: "thread-cc-child-2" as ThreadId,
            prompt: "审查权限边界",
            result: "所有 4 项安全断言均已通过",
            startedAt: 1_760_000_020_000,
            completedAt: 1_760_000_090_000,
          },
        ],
      },
      daemonSnapshot: null,
      locale: "zh",
    });

    expect(acpModel.active).toBe(true);
    expect(acpModel.useBees).toBe(false);
    expect(acpModel.tabs.map((t) => t.id)).toEqual(["overview", "board", "members", "graph"]);
    expect(acpModel.tabs.map((t) => t.label)).toEqual(["概览", "看板", "成员", "关系图"]);
    expect(acpModel.members[0]?.isCoordinator).toBe(true);
    expect(acpModel.members[0]?.providerBrand).toBe("codex");
    expect(acpModel.members.some((m) => m.providerBrand === "dsh")).toBe(true);
    expect(acpModel.members.some((m) => m.providerBrand === "claude-code")).toBe(true);
    expect(acpModel.messages.length).toBeGreaterThanOrEqual(4); // dispatch + progress + result
    expect(acpModel.edges.length).toBeGreaterThanOrEqual(2);
    expect(acpModel.threadGroups.length).toBeGreaterThanOrEqual(1);

    const hive = computeHiveLayout({
      model: acpModel,
      containerWidth: 380,
      replaySeq: null,
      hideInactive: false,
    });
    expect(hive.cells.length).toBeGreaterThanOrEqual(2);
    expect(hive.beams.length).toBeGreaterThanOrEqual(1);
  });

  it("absorbs simultaneous ACP/MCP delegated agents seamlessly INTO an active AGY Swarm across all 4 tabs (Hybrid Mode)", () => {
    const hybridModel = buildAgentAuxViewModel({
      provider: "antigravity",
      threadId: "thread-hybrid" as ThreadId,
      daemonSnapshot: createAgySwarmSnapshot(),
      projection: {
        subagents: [
          {
            id: "sub-hybrid-dsh",
            runId: "run-h1",
            title: "DSH 外部性能剖析",
            status: "running",
            driver: "dsh",
            model: "deepseek-reasoner",
            childThreadId: "thread-dsh-99" as ThreadId,
            prompt: "分析渲染帧率瓶颈",
            progress: "正在采样 SVG 渲染耗时",
            startedAt: 1_760_000_150_000,
          },
        ],
      },
      locale: "zh",
    });

    expect(hybridModel.active).toBe(true);
    expect(hybridModel.kind).toBe("agy-swarm");
    expect(hybridModel.useBees).toBe(true);
    expect(hybridModel.hasAbsorbedAcpAgents).toBe(true);

    // Tab 1 (`概览`): preserves swarm thread groups AND adds `ACP 外部委派` workgroup
    const acpGroup = hybridModel.threadGroups.find((tg) => tg.sourceKind === "acp-delegated");
    expect(acpGroup).toBeDefined();
    expect(acpGroup?.title).toBe("ACP 外部委派");

    // Tab 2 (`看板`): preserves native swarm #seq (1..4) AND interleaves absorbed ACP messages
    expect(hybridModel.messages.some((m) => m.seq === 2 && m.sourceKind === "swarm")).toBe(true);
    expect(hybridModel.messages.some((m) => m.sourceKind === "acp-delegated")).toBe(true);

    // Tab 3 (`成员`): preserves pixel-bee swarm members AND adds ACP member with brand + childThreadId
    const absorbedMember = hybridModel.members.find((m) => m.sourceKind === "acp-delegated");
    expect(absorbedMember).toBeDefined();
    expect(absorbedMember?.providerBrand).toBe("dsh");
    expect(absorbedMember?.childThreadId).toBe("thread-dsh-99");

    // Tab 4 (`关系图`): renders `ACP 外部委派` hex cell alongside native swarm hexes
    const hive = computeHiveLayout({
      model: hybridModel,
      containerWidth: 400,
      replaySeq: null,
      hideInactive: false,
    });
    expect(hive.cells.some((c) => c.isAcpDelegated)).toBe(true);
  });

  it("builds Claude Code Agent Team view model with unified 4 tabs + Tasks tab", () => {
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
      locale: "zh",
    });

    expect(model.active).toBe(true);
    expect(model.kind).toBe("claude-team");
    expect(model.badgeLabel).toBe("Claude 智能体团队");
    expect(model.tabs.map((t) => t.id)).toEqual(["overview", "board", "members", "graph", "tasks"]);
    expect(model.tasks).toHaveLength(2);
    expect(model.tasks[1]?.blockedBy).toEqual(["1"]);
  });

  it("builds Codex Collab and OpenCode subagents onto unified 4 tabs and stays strictly inactive on single-agent chats", () => {
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
      locale: "zh",
    });

    expect(codexModel.active).toBe(true);
    expect(codexModel.kind).toBe("codex-collab");
    expect(codexModel.tabs.map((t) => t.id)).toEqual([
      "overview",
      "board",
      "members",
      "graph",
      "tasks",
    ]);
    expect(codexModel.members.some((m) => m.displayName === "lock-auditor")).toBe(true);

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
      locale: "zh",
    });
    expect(opencodeModel.active).toBe(true);
    expect(opencodeModel.kind).toBe("provider-subagents");
    expect(opencodeModel.tabs.map((t) => t.id)).toEqual(["overview", "board", "members", "graph"]);
    expect(opencodeModel.hasLiveActivity).toBe(true);

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
      projection: {
        subagents: [],
        turnItems: [],
        plans: [],
      } as unknown as OrchestrationV2ThreadProjection,
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
      locale: "zh",
    });
    expect(agySubModel.active).toBe(true);
    expect(agySubModel.kind).toBe("agy-subagents");
    const explorerMember = agySubModel.members.find((m) => !m.isCoordinator);
    expect(explorerMember?.nativeSteps).toHaveLength(1);
    expect(explorerMember?.nativeSteps?.[0]?.toolCalls[0]?.summary).toBe("ChatView.tsx");
  });

  it("enforces strict one-shot activation-only auto-popup and parses sidecar://swarm links", () => {
    const liveModel = buildAgentAuxViewModel({
      provider: "antigravity",
      threadId: "t-1" as ThreadId,
      daemonSnapshot: createAgySwarmSnapshot(),
      locale: "zh",
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
      locale: "zh",
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

    // Initializing AGY swarm (when swarm tool signal detected in live turn) DOES auto-open
    const initializingModel = buildAgentAuxViewModel({
      provider: "antigravity",
      threadId: "t-init" as ThreadId,
      daemonSnapshot: createAgySwarmSnapshot({
        hasLiveWork: false,
        swarm: {
          ...createAgySwarmSnapshot().swarm!,
          members: [
            {
              ...createAgySwarmSnapshot().swarm!.members[0]!,
              status: "waiting",
            },
            {
              ...createAgySwarmSnapshot().swarm!.members[1]!,
              status: "waiting",
            },
          ],
          view: { workstreams: [], attention: [] },
        },
      }),
      locale: "zh",
    });
    expect(
      shouldAutoOpenAgentAux({
        isServerThread: true,
        threadKey: "env:t-init",
        model: initializingModel,
        autoOpenedKeys: new Set(),
        swarmSignalCount: 2,
      }),
    ).toBe("env:t-init::agy-swarm:conv-root-001");

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

    // Sidecar URI parsing & localized formatters
    expect(parseSidecarSwarmLink("sidecar://swarm/board")).toEqual({ swarmPath: "/board" });
    expect(parseSidecarSwarmLink("https://example.com")).toBeNull();
    expect(formatAuxRoleLabel("coordinator", false, "zh")).toBe("协调者");
    expect(formatAuxRoleLabel("worker", false, "zh")).toBe("执行者");
    expect(formatAuxStatusLabel("working", null, "zh")).toBe("工作中");
    expect(formatAuxStatusLabel("waiting_on", "coordinator", "zh")).toBe("等待 @coordinator");
    expect(formatAuxTaskStatusLabel("blocked", "zh")).toBe("受阻");
  });
});
