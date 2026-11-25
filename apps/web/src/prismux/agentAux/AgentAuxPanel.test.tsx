import type { ThreadId } from "@prismux/core-contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { buildAgentAuxViewModel } from "./agentAux.logic";
import {
  AgentAuxOverviewEntryButton,
  AgentAuxPanel,
  toAgentAuxOverviewEntry,
} from "./AgentAuxPanel";

describe("AgentAuxPanel & AgentAuxOverviewEntryButton", () => {
  it("renders AGY Swarm Overview, Board, Members, and Graph views in clean Chinese with pixel bees", () => {
    const model = buildAgentAuxViewModel({
      provider: "antigravity",
      threadId: "thread-agy" as ThreadId,
      daemonSnapshot: {
        ok: true,
        active: true,
        hasLiveWork: true,
        kind: "agy-swarm",
        title: "蜂群联调任务",
        activationKey: "agy-swarm:root-1",
        updatedAt: 1_760_000_000_000,
        swarm: {
          id: "root-1",
          title: "蜂群联调任务",
          selfMember: "coordinator",
          head: 2,
          members: [
            {
              name: "coordinator",
              role: "coordinator",
              model: "claude-opus-4-6",
              conversationId: "root-1",
              status: "working",
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
              activity: "分配任务中",
              activityKind: "thinking",
              wakeMode: "mentions",
              replied: false,
              replyAsk: "",
              failure: null,
            },
            {
              name: "worker-ui",
              role: "worker",
              model: "claude-sonnet-4-5",
              conversationId: "w-1",
              status: "working",
              waitSince: 0,
              killed: false,
              roleWorker: false,
              narrator: false,
              steps: 7,
              posts: 1,
              unread: 0,
              lastReadSeq: 2,
              lastPostSeq: 2,
              lastPostTime: "11:02",
              lastPostTs: 1_760_000_120_000,
              transcriptMtime: 1_760_000_120_000,
              activity: "渲染蜂巢视图",
              activityKind: "tool",
              wakeMode: "mentions",
              replied: false,
              replyAsk: "",
              failure: null,
            },
            {
              name: "old-worker",
              role: "worker",
              model: "gemini-2.5",
              conversationId: "w-old",
              status: "killed",
              waitSince: 0,
              killed: true,
              roleWorker: false,
              narrator: false,
              steps: 3,
              posts: 0,
              unread: 0,
              lastReadSeq: 2,
              lastPostSeq: 0,
              lastPostTime: "",
              lastPostTs: null,
              transcriptMtime: 0,
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
              text: "@worker-ui 启动任务",
              time: "11:00",
              ts: 1_760_000_000_000,
              mentions: ["worker-ui"],
              all: false,
            },
            {
              seq: 2,
              agent: "worker-ui",
              text: "@coordinator 已完成 #1",
              time: "11:02",
              ts: 1_760_000_120_000,
              mentions: ["coordinator"],
              all: false,
            },
          ],
          edges: [{ from: "coordinator", to: "worker-ui", count: 1, direct: 1, viaAll: 0 }],
          plan: { goal: { title: "完成原生蜂群面板", line: "只读视图" }, tasks: {}, threads: [] },
          view: {
            goal: { title: "完成原生蜂群面板", line: "多智能体只读视图" },
            workstreams: [
              {
                id: "ws-1",
                title: "蜂群像素蜂渲染",
                state: "running",
                owners: ["worker-ui"],
                note: "绘制中",
                refs: [{ seq: 2 }],
              },
            ],
            attention: [],
          },
          systemAttention: [],
        },
      },
    });

    const overviewHtml = renderToStaticMarkup(<AgentAuxPanel model={model} initialTab="overview" />);
    expect(overviewHtml).toContain("蜂群联调任务");
    expect(overviewHtml).toContain("总览");
    expect(overviewHtml).toContain("消息板");
    expect(overviewHtml).toContain("成员");
    expect(overviewHtml).toContain("图谱");
    expect(overviewHtml).toContain("实时");
    expect(overviewHtml).toContain("只读");
    expect(overviewHtml).toContain("完成原生蜂群面板");
    expect(overviewHtml).toContain("pmx-beebox");
    expect(overviewHtml).toContain("<canvas");

    const boardHtml = renderToStaticMarkup(<AgentAuxPanel model={model} initialTab="board" />);
    expect(boardHtml).toContain("未读新消息");
    expect(boardHtml).toContain("#1");
    expect(boardHtml).toContain("@worker-ui");

    const membersHtml = renderToStaticMarkup(<AgentAuxPanel model={model} initialTab="members" />);
    expect(membersHtml).toContain("活跃中");
    expect(membersHtml).toContain("显示已结束 (1)");

    const graphHtml = renderToStaticMarkup(<AgentAuxPanel model={model} initialTab="graph" />);
    expect(graphHtml).toContain("蜂巢视图");
    expect(graphHtml).toContain("@提及关系图");
    expect(graphHtml).toContain("data-hive-stage=\"1\"");
  });

  it("renders Claude Code Agent Team Tasks with dependency badges and Codex Collab entry button", () => {
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
    });

    const tasksHtml = renderToStaticMarkup(<AgentAuxPanel model={ccModel} initialTab="tasks" />);
    expect(tasksHtml).toContain("执行安全回归验证");
    expect(tasksHtml).toContain("已阻塞");
    expect(tasksHtml).toContain("依赖 #1");

    const entry = toAgentAuxOverviewEntry(ccModel);
    expect(entry?.active).toBe(true);
    const entryHtml = renderToStaticMarkup(
      <AgentAuxOverviewEntryButton entry={entry} onOpen={vi.fn()} />,
    );
    expect(entryHtml).toContain('data-overview-action="agent-aux"');
    expect(entryHtml).toContain("Claude 团队面板");
    expect(entryHtml).toContain("1 活跃");
  });

  it("renders empty state when inactive and hides overview entry button completely", () => {
    const inactiveModel = buildAgentAuxViewModel({
      provider: "codex",
      threadId: "plain" as ThreadId,
      daemonSnapshot: null,
    });

    const emptyHtml = renderToStaticMarkup(<AgentAuxPanel model={inactiveModel} />);
    expect(emptyHtml).toContain('data-agent-aux-empty="1"');
    expect(emptyHtml).toContain("当前会话未检测到活跃协同");

    const entry = toAgentAuxOverviewEntry(inactiveModel);
    expect(entry).toBeNull();
    const hiddenEntryHtml = renderToStaticMarkup(
      <AgentAuxOverviewEntryButton entry={entry} onOpen={vi.fn()} />,
    );
    expect(hiddenEntryHtml).toBe("");
  });
});
