import type { ThreadId } from "@prismux/core-contracts";
import { EnvironmentId } from "@prismux/core-contracts";
import { GTProvider, initializeGT } from "gt-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { RightPanelTabs } from "../../components/RightPanelTabs";
import { buildAgentAuxViewModel } from "./agentAux.logic";
import {
  AgentAuxOverviewEntryButton,
  AgentAuxPanel,
  toAgentAuxOverviewEntry,
} from "./AgentAuxPanel";

const FORBIDDEN_EN_IN_ZH_UI = [
  "GOAL",
  "Running",
  "tasks done",
  "Threads",
  "The team",
  "Moving",
  "In review",
  "Hive",
  "Mentions",
  "Tasks done",
  "Message just sent",
  "Waiting on",
  "Coordinator",
  "posts over",
];

function createRichSwarmSnapshot() {
  return {
    ok: true as const,
    active: true,
    hasLiveWork: true,
    kind: "agy-swarm" as const,
    title: "Prismux Wave 2 协同蜂群",
    activationKey: "agy-swarm:root-1",
    updatedAt: 1_760_000_000_000,
    swarm: {
      id: "root-1",
      title: "Prismux Wave 2 协同蜂群",
      selfMember: "coordinator",
      head: 3,
      members: [
        {
          name: "coordinator",
          role: "coordinator",
          model: "claude-opus-4-6",
          conversationId: "root-1",
          status: "working" as const,
          waitSince: 0,
          killed: false,
          roleWorker: false,
          narrator: false,
          steps: 12,
          posts: 1,
          unread: 1,
          lastReadSeq: 1,
          lastPostSeq: 1,
          lastPostTime: "11:00",
          lastPostTs: 1_760_000_000_000,
          transcriptMtime: 1_760_000_000_000,
          activity: "统筹各路工人进度",
          activityKind: "thinking" as const,
          wakeMode: "mentions",
          replied: false,
          replyAsk: "",
          failure: null,
        },
        {
          name: "w2-swarm-panel",
          role: "worker",
          model: "claude-sonnet-4-5",
          conversationId: "w-1",
          status: "working" as const,
          waitSince: 0,
          killed: false,
          roleWorker: false,
          narrator: false,
          steps: 7,
          posts: 1,
          unread: 0,
          lastReadSeq: 3,
          lastPostSeq: 2,
          lastPostTime: "11:02",
          lastPostTs: 1_760_000_120_000,
          transcriptMtime: 1_760_000_120_000,
          activity: "渲染蜂巢六边形与像素蜂",
          activityKind: "tool" as const,
          wakeMode: "mentions",
          replied: false,
          replyAsk: "",
          failure: null,
          workspaceMode: "share",
          workspace: "C:\\Users\\Fish\\.gemini\\worktrees\\swarm-w2-panel",
        },
        {
          name: "old-worker",
          role: "worker",
          model: "gemini-2.5-pro",
          conversationId: "w-old",
          status: "killed" as const,
          waitSince: 0,
          killed: true,
          roleWorker: false,
          narrator: false,
          steps: 3,
          posts: 1,
          unread: 0,
          lastReadSeq: 3,
          lastPostSeq: 3,
          lastPostTime: "11:05",
          lastPostTs: 1_760_000_300_000,
          transcriptMtime: 1_760_000_300_000,
          activity: "",
          activityKind: "" as const,
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
          text: "@w2-swarm-panel 请构建 1:1 四标签协同侧边栏",
          time: "11:00",
          ts: 1_760_000_000_000,
          mentions: ["w2-swarm-panel"],
          all: false,
        },
        {
          seq: 2,
          agent: "w2-swarm-panel",
          text: "@coordinator 已完成 `AgentAuxWatcher` 与四标签 UI，详见 #1",
          time: "11:02",
          ts: 1_760_000_120_000,
          mentions: ["coordinator"],
          all: false,
        },
        {
          seq: 3,
          agent: "old-worker",
          text: "@coordinator [done] 单测验证全部通过 #2",
          time: "11:05",
          ts: 1_760_000_300_000,
          mentions: ["coordinator"],
          all: false,
        },
      ],
      edges: [
        { from: "coordinator", to: "w2-swarm-panel", count: 1, direct: 1, viaAll: 0 },
        { from: "w2-swarm-panel", to: "coordinator", count: 1, direct: 1, viaAll: 0 },
      ],
      plan: {
        goal: { title: "交付 1:1 蜂群与 ACP 协同面板", line: "全主题零遥测" },
        tasks: {},
        threads: [],
      },
      view: {
        goal: { title: "交付 1:1 蜂群与 ACP 协同面板", line: "支持浅色、深色与液态玻璃" },
        workstreams: [
          {
            id: "ws-1",
            title: "蜂群像素蜂与画布渲染",
            state: "review",
            owners: ["w2-swarm-panel"],
            note: "等待审阅验收",
            refs: [{ seq: 2 }],
          },
          {
            id: "ws-2",
            title: "守护进程 SSE 推送",
            state: "done",
            owners: ["old-worker"],
            note: "8/8 通过",
            refs: [{ seq: 3 }],
          },
        ],
        threads: [
          {
            id: "t-panel",
            title: "协同侧边栏重构",
            goal: "四标签 1:1 对齐",
            now: "等待校验",
            workstreams: ["ws-1", "ws-2"],
          },
        ],
        attention: [],
      },
      systemAttention: [],
    },
  };
}

describe("AgentAuxPanel & AgentAuxOverviewEntryButton", () => {
  it("renders AGY Swarm all 4 tabs in 100% native Chinese with ZERO leftover English UI tokens", () => {
    const model = buildAgentAuxViewModel({
      provider: "antigravity",
      threadId: "thread-agy" as ThreadId,
      daemonSnapshot: createRichSwarmSnapshot(),
      locale: "zh",
    });

    const overviewHtml = renderToStaticMarkup(
      <AgentAuxPanel model={model} initialTab="overview" locale="zh" />,
    );
    const boardHtml = renderToStaticMarkup(
      <AgentAuxPanel model={model} initialTab="board" locale="zh" />,
    );
    const membersHtml = renderToStaticMarkup(
      <AgentAuxPanel model={model} initialTab="members" locale="zh" />,
    );
    const graphHtml = renderToStaticMarkup(
      <AgentAuxPanel model={model} initialTab="graph" locale="zh" />,
    );

    // Strip HTML tags to check visible UI text for forbidden English tokens
    const visibleText = [overviewHtml, boardHtml, membersHtml, graphHtml]
      .join(" ")
      .replace(/<[^>]+>/g, " ");
    for (const forbidden of FORBIDDEN_EN_IN_ZH_UI) {
      expect(visibleText, `Unexpected English UI label "${forbidden}" in zh render`).not.toContain(
        forbidden,
      );
    }

    expect(overviewHtml).toContain("Prismux Wave 2 协同蜂群");
    expect(overviewHtml).toContain("概览");
    expect(overviewHtml).toContain("看板");
    expect(overviewHtml).toContain("成员");
    expect(overviewHtml).toContain("关系图");
    expect(overviewHtml).toContain("实时");
    expect(overviewHtml).toContain("目标");
    expect(overviewHtml).toContain("进行中");
    expect(overviewHtml).toContain("工作组");
    expect(overviewHtml).toContain("协同团队");
    expect(overviewHtml).toContain("审阅中");
    expect(overviewHtml).toContain("已完成 1 / 共 2 项");
    expect(overviewHtml).toContain("pmx-beebox");
    expect(overviewHtml).toContain("<canvas");

    expect(boardHtml).toContain("新消息");
    expect(boardHtml).toContain("#1");
    expect(boardHtml).toContain("@w2-swarm-panel");

    expect(membersHtml).toContain("工作中");
    expect(membersHtml).toContain("已退出成员");
    expect(membersHtml).toContain("共享副本 · …/worktrees/swarm-w2-panel");

    expect(graphHtml).toContain("蜂巢视图");
    expect(graphHtml).toContain("提及关系");
    expect(graphHtml).toContain("任务完成");
    expect(graphHtml).toContain("消息刚发送");
    expect(graphHtml).toContain("等待回复");
    expect(graphHtml).toContain('data-hive-stage="1"');
  });

  it("renders English locale cleanly when locale='en'", () => {
    const enModel = buildAgentAuxViewModel({
      provider: "antigravity",
      threadId: "thread-en" as ThreadId,
      daemonSnapshot: createRichSwarmSnapshot(),
      locale: "en",
    });

    const overviewHtml = renderToStaticMarkup(
      <AgentAuxPanel model={enModel} initialTab="overview" locale="en" />,
    );
    expect(overviewHtml).toContain("Overview");
    expect(overviewHtml).toContain("Board");
    expect(overviewHtml).toContain("Members");
    expect(overviewHtml).toContain("Graph");
    expect(overviewHtml).toContain("1 of 2 tasks done");
  });

  it("renders unified 4 tabs for pure ACP multi-agent (Codex -> DSH) AND hybrid Swarm + absorbed ACP mode", () => {
    // Pure ACP multi-agent
    const acpModel = buildAgentAuxViewModel({
      provider: "codex",
      threadId: "thread-acp" as ThreadId,
      projection: {
        runs: [{ id: "r1", status: "running" }],
        subagents: [
          {
            id: "sub-dsh",
            title: "DSH 性能诊断",
            status: "running",
            driver: "dsh",
            model: "deepseek-reasoner",
            childThreadId: "child-dsh" as ThreadId,
            prompt: "检查渲染开销",
            progress: "采样中",
            startedAt: 1_760_000_010_000,
          },
        ],
      },
      daemonSnapshot: null,
      locale: "zh",
    });

    const acpOverview = renderToStaticMarkup(
      <AgentAuxPanel model={acpModel} initialTab="overview" locale="zh" />,
    );
    const acpGraph = renderToStaticMarkup(
      <AgentAuxPanel model={acpModel} initialTab="graph" locale="zh" />,
    );
    expect(acpOverview).toContain("概览");
    expect(acpOverview).toContain("看板");
    expect(acpOverview).toContain("成员");
    expect(acpOverview).toContain("关系图");
    expect(acpOverview).toContain("data-agent-avatar-brand=");
    expect(acpGraph).toContain('data-hive-stage="1"');

    // Hybrid AGY Swarm + simultaneous ACP subagent absorption
    const hybridModel = buildAgentAuxViewModel({
      provider: "antigravity",
      threadId: "thread-hybrid" as ThreadId,
      daemonSnapshot: createRichSwarmSnapshot(),
      projection: {
        subagents: [
          {
            id: "sub-hybrid",
            title: "DSH 静态审计",
            status: "running",
            driver: "dsh",
            model: "deepseek-reasoner",
            childThreadId: "child-dsh-h" as ThreadId,
            prompt: "检查内存泄漏",
            progress: "分析 watcher 引用计数",
            startedAt: 1_760_000_200_000,
          },
        ],
      },
      locale: "zh",
    });

    const hybridOverview = renderToStaticMarkup(
      <AgentAuxPanel model={hybridModel} initialTab="overview" locale="zh" />,
    );
    const hybridMembers = renderToStaticMarkup(
      <AgentAuxPanel
        model={hybridModel}
        initialTab="members"
        locale="zh"
        onOpenChildThread={vi.fn()}
      />,
    );
    expect(hybridOverview).toContain("ACP 外部委派");
    expect(hybridOverview).toContain("pmx-beebox");
    expect(hybridMembers).toContain("ACP 委派");
    expect(hybridMembers).toContain("打开会话");
  });

  it("renders Claude Code Agent Team Tasks, crisp SVG Overview Entry Button (no OS bee emoji), and empty state", () => {
    const ccModel = buildAgentAuxViewModel({
      provider: "claudeAgent",
      threadId: "thread-cc" as ThreadId,
      daemonSnapshot: {
        ok: true,
        active: true,
        hasLiveWork: true,
        kind: "claude-team",
        title: "auth-squad",
        activationKey: "claude-team:auth-squad",
        updatedAt: 1_760_000_000_000,
        claudeTeam: {
          teamName: "auth-squad",
          description: "权限审计团队",
          leadSessionId: "cc-lead-1",
          members: [
            {
              agentId: "a1",
              name: "team-lead",
              agentType: "team-lead",
              model: "claude-opus-4-6",
              color: "#d97757",
              cwd: "/repo",
              backendType: "in-process",
              isLead: true,
              status: "working",
            },
          ],
          messages: [],
          edges: [],
        },
        tasks: [
          {
            id: "2",
            subject: "执行安全回归验证",
            description: "确保跨目录读取被拦截",
            status: "blocked",
            owner: "team-lead",
            blockedBy: ["1"],
            blocks: [],
            source: "claude-tasks",
          },
        ],
      },
      locale: "zh",
    });

    const tasksHtml = renderToStaticMarkup(
      <AgentAuxPanel model={ccModel} initialTab="tasks" locale="zh" />,
    );
    expect(tasksHtml).toContain("执行安全回归验证");
    expect(tasksHtml).toContain("受阻");
    expect(tasksHtml).toContain("依赖 #1");

    const entry = toAgentAuxOverviewEntry(ccModel);
    expect(entry?.active).toBe(true);
    const entryHtml = renderToStaticMarkup(
      <AgentAuxOverviewEntryButton entry={entry} onOpen={vi.fn()} locale="zh" />,
    );
    expect(entryHtml).toContain('data-overview-action="agent-aux"');
    expect(entryHtml).toContain("团队侧边栏");
    expect(entryHtml).toContain("1 工作中");

    // Swarm entry button uses crisp inline SVG instead of OS bee emoji
    const swarmEntry = toAgentAuxOverviewEntry(
      buildAgentAuxViewModel({
        provider: "antigravity",
        threadId: "t-sw" as ThreadId,
        daemonSnapshot: createRichSwarmSnapshot(),
        locale: "zh",
      }),
    );
    const swarmEntryHtml = renderToStaticMarkup(
      <AgentAuxOverviewEntryButton entry={swarmEntry} onOpen={vi.fn()} locale="zh" />,
    );
    expect(swarmEntryHtml).toContain("<svg");
    expect(swarmEntryHtml).not.toContain("🐝");

    const inactiveModel = buildAgentAuxViewModel({
      provider: "codex",
      threadId: "plain" as ThreadId,
      daemonSnapshot: null,
      locale: "zh",
    });

    const emptyHtml = renderToStaticMarkup(<AgentAuxPanel model={inactiveModel} locale="zh" />);
    expect(emptyHtml).toContain('data-agent-aux-empty="1"');
    expect(emptyHtml).toContain("当前会话未检测到活跃协同");

    expect(toAgentAuxOverviewEntry(inactiveModel)).toBeNull();
    expect(
      renderToStaticMarkup(<AgentAuxOverviewEntryButton entry={null} onOpen={vi.fn()} />),
    ).toBe("");
  });

  it("renders shell-less transparent Captain & worker logos (zero [AC], zero box shells) across all 4 ACP tabs and RightPanelTabs", () => {
    const dshEntry = {
      instanceId: "acpRegistry:dsh",
      driverKind: "acpRegistry",
      displayName: "DeepSeek Harness",
      acpRegistryAgentId: "dsh",
    };
    const glmEntry = {
      instanceId: "acpRegistry:glm",
      driverKind: "acpRegistry",
      displayName: "GLM Agent",
      acpRegistryAgentId: "glm-acp-agent",
    };
    const qwenEntry = {
      instanceId: "acpRegistry:qwen",
      driverKind: "acpRegistry",
      displayName: "Qwen Code",
      acpRegistryAgentId: "qwen-code",
    };
    const entryMap = new Map([
      [dshEntry.instanceId, dshEntry],
      [glmEntry.instanceId, glmEntry],
      [qwenEntry.instanceId, qwenEntry],
    ]);

    const acpModel = buildAgentAuxViewModel({
      provider: "acpRegistry",
      providerEntry: dshEntry,
      model: "DeepSeek-V4.1",
      providerEntryByInstanceId: entryMap,
      threadId: "thread-acp-bare" as ThreadId,
      projection: {
        runs: [{ id: "r1", status: "running" }],
        subagents: [
          {
            id: "sub-glm",
            runId: "r1",
            title: "GLM 视觉审查",
            status: "running",
            driver: "acpRegistry",
            providerInstanceId: glmEntry.instanceId,
            model: "glm-5",
            childThreadId: "child-glm" as ThreadId,
            prompt: "审查对齐与透明图标",
            progress: "检查中",
            startedAt: 1_760_000_010_000,
          },
          {
            id: "sub-qwen",
            runId: "r1",
            title: "Qwen 单元测试",
            status: "completed",
            driver: "acpRegistry",
            providerInstanceId: qwenEntry.instanceId,
            model: "qwen3-coder",
            childThreadId: "child-qwen" as ThreadId,
            prompt: "运行单测",
            result: "全部通过",
            startedAt: 1_760_000_020_000,
            completedAt: 1_760_000_050_000,
          },
        ],
      },
      daemonSnapshot: null,
      locale: "zh",
    });

    const overviewHtml = renderToStaticMarkup(
      <AgentAuxPanel model={acpModel} initialTab="overview" locale="zh" />,
    );
    const boardHtml = renderToStaticMarkup(
      <AgentAuxPanel model={acpModel} initialTab="board" locale="zh" />,
    );
    const membersHtml = renderToStaticMarkup(
      <AgentAuxPanel model={acpModel} initialTab="members" locale="zh" />,
    );
    const graphHtml = renderToStaticMarkup(
      <AgentAuxPanel model={acpModel} initialTab="graph" locale="zh" />,
    );
    const entryHtml = renderToStaticMarkup(
      <AgentAuxOverviewEntryButton
        entry={toAgentAuxOverviewEntry(acpModel)}
        onOpen={vi.fn()}
        locale="zh"
      />,
    );

    const allHtml = [overviewHtml, boardHtml, membersHtml, graphHtml, entryHtml].join("\n");
    // NEVER renders generic [AC] monogram badge when Captain/worker brands are known
    expect(allHtml).not.toContain('data-agent-brand-monogram="AC"');
    // Renders Captain DSH pure transparent logo everywhere
    expect(overviewHtml).toContain('data-agent-brand="dsh"');
    expect(overviewHtml).toContain('data-agent-avatar-bare="1"');
    expect(overviewHtml).toContain('data-aux-all-bare="1"');
    expect(overviewHtml).not.toContain("background:color-mix(");
    expect(boardHtml).toContain("pmx-aux-msg--bare");
    expect(membersHtml).toContain("pmx-aux-member-row--bare");
    expect(membersHtml).not.toContain("pt-0.5");
    expect(graphHtml).toContain('data-hive-bare="1"');
    expect(graphHtml).toContain('data-hive-brand="dsh"');
    expect(graphHtml).toContain('data-hive-brand="glm"');
    expect(graphHtml).not.toContain("pmx-aux-hv-brand-dot");
    expect(entryHtml).toContain('data-agent-brand="dsh"');

    // RightPanelTabs agent-aux tab renders resolved Captain providerBrand (DSH), NOT [AC]
    initializeGT({ defaultLocale: "zh", locales: ["zh", "en"] });
    const noop = () => {};
    const tabHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <RightPanelTabs
          mode="embedded"
          open
          keybindings={[]}
          getShortcutContext={() => ({
            terminalFocus: false,
            terminalOpen: false,
            previewFocus: false,
            previewOpen: false,
            isWeb: true,
            isDesktop: false,
          })}
          surfaces={[
            {
              id: "agent-aux",
              kind: "agent-aux",
              title: "DeepSeek Harness 多智能体协同",
              auxKind: "provider-subagents",
              provider: "acpRegistry",
              providerBrand: "dsh",
              activeCount: 1,
            },
          ]}
          environmentId={EnvironmentId.make("local")}
          activeSurfaceId="agent-aux"
          pendingSurfaceIds={new Set<string>()}
          previewSessions={{}}
          desktopByTabId={{}}
          terminalLabelsById={new Map<string, string>()}
          onActivate={noop}
          onCloseSurface={noop}
          onCloseOtherSurfaces={noop}
          onCloseSurfacesToRight={noop}
          onCloseAllSurfaces={noop}
          onCopyFilePath={noop}
          onAddBrowser={noop}
          onAddBrowserInProfile={noop}
          onAddTerminal={noop}
          onAddDiff={noop}
          onAddFiles={noop}
          onAddPullRequest={noop}
          onAddPullRequests={noop}
          onAddDevice={noop}
          onAddWallpaper={noop}
          onAddSideChat={noop}
          browserAvailable={false}
          terminalAvailable={false}
          diffAvailable={false}
          filesAvailable={false}
          pullRequestAvailable={false}
          pullRequestsAvailable={false}
          deviceAvailable={false}
          wallpaperAvailable={false}
          sideChatAvailable={false}
        >
          <div />
        </RightPanelTabs>
      </GTProvider>,
    );
    expect(tabHtml).toContain('data-agent-brand="dsh"');
    expect(tabHtml).not.toContain('data-agent-brand-monogram="AC"');
  });
});
