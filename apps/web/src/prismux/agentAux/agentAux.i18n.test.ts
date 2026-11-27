import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { AgentAuxBoardTab } from "./AgentAuxBoardTab";
import { AgentAuxMarkdown } from "./AgentAuxMarkdown";
import {
  AGENT_AUX_STRINGS,
  formatAuxBlockedChip,
  formatAuxBoardMemberHandle,
  formatAuxBoardStatusTag,
  formatAuxCoordinatorSummary,
  formatAuxDelegationWave,
  formatAuxDuration,
  formatAuxEntryBadge,
  formatAuxFilteredBy,
  formatAuxInReviewChip,
  formatAuxMemberDisplayName,
  formatAuxModelDisplayLabel,
  formatAuxModelMismatchNote,
  formatAuxNeedsYouChip,
  formatAuxNewPostsFloat,
  formatAuxPlainSnippet,
  formatAuxPostsOverDuration,
  formatAuxReadableModelId,
  formatAuxReplayProgress,
  formatAuxShowEarlier,
  formatAuxStepsCount,
  formatAuxTasksDone,
  formatAuxTeamCount,
  formatAuxThreadsOpenChip,
  formatAuxThreadsSummary,
  formatAuxWaitingCount,
  formatAuxWaitingOn,
  formatAuxWorkspaceBadge,
  isEquivalentAuxModelSpec,
  localizeAuxBoardPlainText,
} from "./agentAux.i18n";
import type { AgentAuxViewModel } from "./agentAux.logic";

const FORBIDDEN_ENGLISH_TOKENS_IN_ZH = [
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
  "Standing by",
  "Retired",
  "Show more",
  "Show less",
  "Jump to latest",
];

const CJK_RE = /[\u4e00-\u9fff]/;

describe("agentAux.i18n (100% Native Chinese & English Parity)", () => {
  it("contains ZERO forbidden leftover English UI tokens across all Chinese dictionary entries and formatters", () => {
    const zhValues = Object.values(AGENT_AUX_STRINGS.zh);
    const formattedZh = [
      formatAuxDuration(11 * 3600_000 + 7 * 60_000, "zh"),
      formatAuxDuration(4 * 60_000 + 18_000, "zh"),
      formatAuxDuration(25_000, "zh"),
      formatAuxTasksDone(32, 33, "zh"),
      formatAuxInReviewChip(2, "zh"),
      formatAuxBlockedChip(1, "zh"),
      formatAuxNeedsYouChip(1, "zh"),
      formatAuxThreadsOpenChip(3, "zh"),
      formatAuxThreadsSummary(2, 5, "zh"),
      formatAuxTeamCount(8, 3, "zh").live,
      formatAuxTeamCount(8, 3, "zh").retired,
      formatAuxFilteredBy("worker-1", "zh"),
      formatAuxWaitingOn("coordinator", "zh"),
      formatAuxWaitingCount(2, "zh"),
      formatAuxShowEarlier(40, "zh"),
      formatAuxNewPostsFloat(5, "zh"),
      formatAuxStepsCount(7, "zh"),
      formatAuxPostsOverDuration(112, 11 * 3600_000 + 7 * 60_000, "zh"),
      formatAuxReplayProgress(12, 112, 12, "10:15", 180_000, "zh"),
      formatAuxWorkspaceBadge("share", "…/worktrees/w2", "zh"),
      formatAuxEntryBadge(3, 5, "zh"),
      formatAuxDelegationWave(2, "zh"),
      formatAuxCoordinatorSummary(4, "zh"),
      formatAuxBoardStatusTag("done", "zh"),
      formatAuxBoardStatusTag("blocked", "zh"),
      formatAuxBoardStatusTag("stall", "zh"),
      formatAuxBoardMemberHandle("coordinator", "zh"),
      formatAuxBoardMemberHandle("all", "zh"),
      formatAuxBoardMemberHandle("acpregistry-算术题-37-89-1447-1", "zh"),
      formatAuxModelMismatchNote('["magpie","group/deepseek"]', "group/deepseek", "zh"),
    ];

    const allZh = [...zhValues, ...formattedZh];
    for (const text of allZh) {
      for (const forbidden of FORBIDDEN_ENGLISH_TOKENS_IN_ZH) {
        expect(
          text,
          `Forbidden English token "${forbidden}" found in zh string "${text}"`,
        ).not.toContain(forbidden);
      }
    }

    // Spot-check key native Chinese translations
    expect(AGENT_AUX_STRINGS.zh.tabOverview).toBe("概览");
    expect(AGENT_AUX_STRINGS.zh.tabBoard).toBe("看板");
    expect(AGENT_AUX_STRINGS.zh.tabMembers).toBe("成员");
    expect(AGENT_AUX_STRINGS.zh.tabGraph).toBe("关系图");
    expect(AGENT_AUX_STRINGS.zh.overviewGoal).toBe("目标");
    expect(AGENT_AUX_STRINGS.zh.overviewRunning).toBe("进行中");
    expect(AGENT_AUX_STRINGS.zh.overviewThreadsHeading).toBe("工作组");
    expect(AGENT_AUX_STRINGS.zh.overviewTeamHeading).toBe("协同团队");
    expect(AGENT_AUX_STRINGS.zh.graphModeHive).toBe("蜂巢视图");
    expect(AGENT_AUX_STRINGS.zh.graphModeMentions).toBe("提及关系");
    expect(formatAuxTasksDone(32, 33, "zh")).toBe("已完成 32 / 共 33 项");
    expect(formatAuxPostsOverDuration(112, 11 * 3600_000 + 7 * 60_000, "zh")).toBe(
      "共 112 条消息 · 历时 11 小时 07 分",
    );
    expect(formatAuxWorkspaceBadge("share", "…/worktrees/w2", "zh")).toBe(
      "共享副本 · …/worktrees/w2",
    );
    expect(formatAuxBoardStatusTag("done", "zh")).toBe("[已完成]");
    expect(formatAuxBoardStatusTag("blocked", "zh")).toBe("[受阻]");
    expect(formatAuxBoardStatusTag("stall", "zh")).toBe("[停滞]");
    expect(formatAuxBoardMemberHandle("coordinator", "zh")).toBe("@协调者");
    expect(formatAuxBoardMemberHandle("all", "zh")).toBe("@全体");
    expect(formatAuxBoardMemberHandle("acpregistry-算术题-37-89-1447-1", "zh")).toBe(
      "@算术题-37-89-1447-1",
    );
    expect(formatAuxBoardMemberHandle("acpregistry-1", "zh")).toBe("@子代理-1");
    expect(formatAuxBoardMemberHandle("w2-swarm-panel", "zh")).toBe("@w2-swarm-panel");
  });

  it("contains ZERO Chinese characters across all English dictionary entries and formatters", () => {
    const enValues = Object.values(AGENT_AUX_STRINGS.en);
    const formattedEn = [
      formatAuxDuration(11 * 3600_000 + 7 * 60_000, "en"),
      formatAuxTasksDone(32, 33, "en"),
      formatAuxInReviewChip(2, "en"),
      formatAuxBlockedChip(1, "en"),
      formatAuxNeedsYouChip(1, "en"),
      formatAuxThreadsOpenChip(3, "en"),
      formatAuxThreadsSummary(2, 5, "en"),
      formatAuxTeamCount(8, 3, "en").live,
      formatAuxTeamCount(8, 3, "en").retired,
      formatAuxFilteredBy("worker-1", "en"),
      formatAuxWaitingOn("coordinator", "en"),
      formatAuxWaitingCount(2, "en"),
      formatAuxShowEarlier(40, "en"),
      formatAuxNewPostsFloat(5, "en"),
      formatAuxStepsCount(7, "en"),
      formatAuxPostsOverDuration(112, 11 * 3600_000 + 7 * 60_000, "en"),
      formatAuxReplayProgress(12, 112, 12, "10:15", 180_000, "en"),
      formatAuxWorkspaceBadge("share", "…/worktrees/w2", "en"),
      formatAuxEntryBadge(3, 5, "en"),
      formatAuxDelegationWave(2, "en"),
      formatAuxCoordinatorSummary(4, "en"),
      formatAuxBoardStatusTag("done", "en"),
      formatAuxBoardStatusTag("blocked", "en"),
      formatAuxBoardStatusTag("stall", "en"),
      formatAuxBoardMemberHandle("coordinator", "en"),
      formatAuxBoardMemberHandle("all", "en"),
      formatAuxBoardMemberHandle("acpregistry-1", "en"),
      formatAuxModelMismatchNote('["magpie","group/deepseek"]', "group/qwen", "en"),
    ];

    for (const text of [...enValues, ...formattedEn]) {
      expect(CJK_RE.test(text), `Unexpected CJK character in en string "${text}"`).toBe(false);
    }

    expect(formatAuxTasksDone(32, 33, "en")).toBe("32 of 33 tasks done");
    expect(formatAuxPostsOverDuration(112, 11 * 3600_000 + 7 * 60_000, "en")).toBe(
      "112 posts over 11h 07m",
    );
    expect(formatAuxBoardStatusTag("done", "en")).toBe("[done]");
    expect(formatAuxBoardStatusTag("blocked", "en")).toBe("[blocked]");
    expect(formatAuxBoardStatusTag("stall", "en")).toBe("[stall]");
    expect(formatAuxBoardMemberHandle("coordinator", "en")).toBe("@coordinator");
    expect(formatAuxBoardMemberHandle("all", "en")).toBe("@all");
    expect(formatAuxBoardMemberHandle("acpregistry-1", "en")).toBe("@acp-1");
  });

  it("localizes provider model-mismatch and fallback notices cleanly while unwrapping JSON tuples", () => {
    expect(formatAuxReadableModelId('["magpie","group/deepseek"]')).toBe("group/deepseek");
    expect(
      localizeAuxBoardPlainText(
        '[done] Requested model ["magpie","group/deepseek"]; the provider reported running group/deepseek.',
        "zh",
      ),
    ).toBe("[done] 请求模型 magpie/group/deepseek，提供方实际运行 group/deepseek。");
    expect(
      localizeAuxBoardPlainText(
        '[done] Requested model ["magpie","group/deepseek"]; the provider reported running group/qwen.',
        "zh",
      ),
    ).toBe("[done] 请求模型 group/deepseek，提供方实际运行 group/qwen。");
    expect(
      localizeAuxBoardPlainText(
        "Requested model gpt-5.4; the provider reported running gpt-5.4-mini.",
        "zh",
      ),
    ).toBe("请求模型 gpt-5.4，提供方实际运行 gpt-5.4-mini。");
    expect(
      localizeAuxBoardPlainText(
        'Requested model ["magpie","group/deepseek"]; the provider reported running group/qwen.',
        "en",
      ),
    ).toBe("Requested model group/deepseek; the provider reported running group/qwen.");
    expect(
      localizeAuxBoardPlainText("Child task completed without an assistant result.", "zh"),
    ).toBe("子任务已完成，但未返回助手结果。");
    expect(localizeAuxBoardPlainText("Child task ended with status failed.", "zh")).toBe(
      "子任务已结束（状态：失败）。",
    );
    expect(localizeAuxBoardPlainText("Last assistant message before the run failed:", "zh")).toBe(
      "运行失败前最后一条助手消息：",
    );
  });

  it("renders AgentAuxMarkdown status tags, model notes, and mentions in zh vs en without mutating code spans", () => {
    const known = new Set(["coordinator", "acpregistry-算术题-37-89-1447-1"]);
    const sample =
      '[done] Requested model ["magpie","group/deepseek"]; the provider reported running group/deepseek.\n\n请 @coordinator 复核，另外 [blocked] 和 [stall] 状态详见 `Requested model ["magpie","group/deepseek"]; the provider reported running group/deepseek.`。';

    const zhHtml = renderToStaticMarkup(
      createElement(AgentAuxMarkdown, {
        text: sample,
        knownNames: known,
        maxSeq: 5,
        locale: "zh",
        onClickMention: () => undefined,
      }),
    );
    expect(zhHtml).toContain("pmx-aux-md-tag--done");
    expect(zhHtml).toContain("[已完成]");
    expect(zhHtml).toContain("pmx-aux-md-tag--blocked");
    expect(zhHtml).toContain("[受阻]");
    expect(zhHtml).toContain("pmx-aux-md-tag--stall");
    expect(zhHtml).toContain("[停滞]");
    expect(zhHtml).toContain("请求模型 magpie/group/deepseek，提供方实际运行 group/deepseek。");
    expect(zhHtml).toContain("@协调者");
    // Inline code block preserves literal code untouched
    expect(zhHtml).toContain("pmx-aux-inline-code");
    expect(zhHtml).toContain("Requested model");

    const enHtml = renderToStaticMarkup(
      createElement(AgentAuxMarkdown, {
        text: sample,
        knownNames: known,
        maxSeq: 5,
        locale: "en",
        onClickMention: () => undefined,
      }),
    );
    expect(enHtml).toContain("[done]");
    expect(enHtml).toContain("[blocked]");
    expect(enHtml).toContain("[stall]");
    expect(enHtml).toContain(
      "Requested model magpie/group/deepseek; the provider reported running group/deepseek.",
    );
    expect(enHtml).toContain("@coordinator");
  });

  it("renders AgentAuxBoardTab headers cleanly in zh (localizing @coordinator and stripping acpregistry- prefix) while preserving en mode", () => {
    const buildModel = (locale: "zh" | "en"): AgentAuxViewModel => ({
      active: true,
      hasLiveActivity: false,
      kind: "provider-subagents",
      locale,
      useBees: false,
      hasAbsorbedAcpAgents: false,
      provider: "acpRegistry",
      providerBrand: "dsh",
      title: "多智能体协同",
      badgeLabel: "2 成员",
      entryLabel: "协同侧边栏",
      activationKey: "k-1",
      selfMember: "coordinator",
      headSeq: 2,
      unreadSeqBoundary: null,
      channels: [],
      tabs: [],
      defaultTab: "board",
      statusLine: "",
      activeCount: 0,
      waitingCount: 0,
      retiredCount: 0,
      messageCount: 2,
      goal: null,
      headline: "",
      phase: null,
      stall: null,
      starting: false,
      workstreams: [],
      threadGroups: [],
      attention: [],
      members: [
        {
          id: "coord",
          name: "coordinator",
          displayName: "DeepSeek Harness",
          role: "coordinator",
          roleLabel: locale === "zh" ? "协调者" : "Coordinator",
          title: "DeepSeek Harness",
          brief: "",
          model: "group/deepseek",
          providerBrand: "dsh",
          sourceKind: "acp-delegated",
          status: "done",
          statusLabel: locale === "zh" ? "已完成" : "Done",
          waitingOn: null,
          wakeMode: "",
          steps: 0,
          posts: 1,
          unread: 0,
          activity: "",
          activityKind: "",
          nowLine: "",
          lastPostSnippet: "",
          lastSeq: 1,
          lastTime: "10:26",
          killed: false,
          isCoordinator: true,
          isSystem: false,
          isYou: true,
          childThreadId: null,
          conversationId: null,
          color: null,
          backendType: null,
          workspace: null,
          workspaceMode: null,
          failureText: null,
        },
        {
          id: "sub-1",
          name: "acpregistry-算术题-37-89-1447-1",
          displayName: "算术题：(37×89+1447)÷12",
          role: "subagent",
          roleLabel: locale === "zh" ? "子代理" : "Subagent",
          title: "算术题：(37×89+1447)÷12",
          brief: "",
          model: "group/deepseek",
          providerBrand: "dsh",
          sourceKind: "acp-delegated",
          status: "done",
          statusLabel: locale === "zh" ? "已完成" : "Done",
          waitingOn: null,
          wakeMode: "",
          steps: 0,
          posts: 1,
          unread: 0,
          activity: "",
          activityKind: "",
          nowLine: "",
          lastPostSnippet: "",
          lastSeq: 2,
          lastTime: "10:26",
          killed: false,
          isCoordinator: false,
          isSystem: false,
          isYou: false,
          childThreadId: null,
          conversationId: null,
          color: null,
          backendType: null,
          workspace: null,
          workspaceMode: null,
          failureText: null,
        },
      ],
      messages: [
        {
          seq: 1,
          agent: "coordinator",
          recipient: "acpregistry-算术题-37-89-1447-1",
          text: "@acpregistry-算术题-37-89-1447-1 **算术题：(37×89+1447)÷12**\n\n解答这道算术题。",
          time: "10:26",
          ts: null,
          mentions: ["acpregistry-算术题-37-89-1447-1"],
          all: false,
          isControl: false,
          isDirectToYou: false,
          isUnread: false,
        },
        {
          seq: 2,
          agent: "acpregistry-算术题-37-89-1447-1",
          recipient: "coordinator",
          text: '@coordinator [done] Requested model ["magpie","group/deepseek"]; the provider reported running group/deepseek.\n\n计算：\n第一步：计算乘法',
          time: "10:26",
          ts: null,
          mentions: ["coordinator"],
          all: false,
          isControl: false,
          isDirectToYou: false,
          isUnread: false,
        },
      ],
      edges: [],
      tasks: [],
      finished: true,
      updatedAt: 1_760_000_000_000,
    });

    const zhHtml = renderToStaticMarkup(
      createElement(AgentAuxBoardTab, {
        model: buildModel("zh"),
        senderFilter: "",
        onChangeSenderFilter: () => undefined,
        flashSeq: null,
        onJumpSeq: () => undefined,
        onClearFlash: () => undefined,
        scrollContainerRef: { current: null },
      }),
    );
    const zhVisibleText = zhHtml.replace(/<[^>]+>/g, " ");
    expect(zhVisibleText).toContain("@协调者");
    expect(zhVisibleText).toContain("@算术题-37-89-1447-1");
    expect(zhVisibleText).toContain("[已完成]");
    expect(zhVisibleText).toContain(
      "请求模型 magpie/group/deepseek，提供方实际运行 group/deepseek。",
    );
    expect(zhVisibleText).not.toContain("@coordinator");
    expect(zhVisibleText).not.toContain("acpregistry-");
    expect(zhVisibleText).not.toContain("[done]");
    expect(zhVisibleText).not.toContain("Requested model");
    expect(zhVisibleText).not.toContain('["magpie"');
    // Raw routing ID preserved in data attribute
    expect(zhHtml).toContain('data-aux-member-id="coordinator"');
    expect(zhHtml).toContain('data-aux-member-id="acpregistry-算术题-37-89-1447-1"');

    const enHtml = renderToStaticMarkup(
      createElement(AgentAuxBoardTab, {
        model: buildModel("en"),
        senderFilter: "",
        onChangeSenderFilter: () => undefined,
        flashSeq: null,
        onJumpSeq: () => undefined,
        onClearFlash: () => undefined,
        scrollContainerRef: { current: null },
      }),
    );
    const enVisibleText = enHtml.replace(/<[^>]+>/g, " ");
    expect(enVisibleText).toContain("@coordinator");
    expect(enVisibleText).toContain("[done]");
    expect(enVisibleText).toContain(
      "Requested model magpie/group/deepseek; the provider reported running group/deepseek.",
    );
  });

  it("formats member display names, JSON model tuples, waiting/filter handles, and plain previews cleanly in zh and en", () => {
    expect(formatAuxMemberDisplayName("coordinator", "zh")).toBe("协调者");
    expect(formatAuxMemberDisplayName("coordinator", "en")).toBe("coordinator");
    expect(formatAuxMemberDisplayName("acpregistry-生成100字打招呼", "zh")).toBe("生成100字打招呼");
    expect(formatAuxMemberDisplayName("acpregistry-生成100字打招呼", "en")).toBe("生成100字打招呼");
    expect(formatAuxMemberDisplayName("all", "zh")).toBe("全体");
    expect(formatAuxMemberDisplayName("all", "en")).toBe("all");

    expect(formatAuxWaitingOn("coordinator", "zh")).toBe("等待 @协调者");
    expect(formatAuxWaitingOn("acpregistry-生成100字打招呼", "zh")).toBe("等待 @生成100字打招呼");
    expect(formatAuxWaitingOn("coordinator", "en")).toBe("Waiting on @coordinator");
    expect(formatAuxFilteredBy("coordinator", "zh")).toBe("已筛选：@协调者");
    expect(formatAuxFilteredBy("acpregistry-生成100字打招呼", "zh")).toBe(
      "已筛选：@生成100字打招呼",
    );

    expect(formatAuxModelDisplayLabel('["magpie","group/deepseek"]')).toBe("group/deepseek");
    expect(formatAuxModelDisplayLabel('["openai", "gpt-5.4"]')).toBe("gpt-5.4");
    expect(formatAuxModelDisplayLabel('["deepseek-v4.1"]')).toBe("deepseek-v4.1");
    expect(formatAuxModelDisplayLabel("claude-opus-4-6")).toBe("claude-opus-4-6");
    expect(formatAuxModelDisplayLabel("")).toBe("");

    expect(isEquivalentAuxModelSpec('["magpie","group/deepseek"]', "group/deepseek")).toBe(true);
    expect(isEquivalentAuxModelSpec('["magpie","group/deepseek"]', "group/qwen")).toBe(false);

    // Strips false-positive equivalent model mismatch prefix and preserves the real answer
    expect(
      formatAuxPlainSnippet(
        '@coordinator [done] Requested model ["magpie","group/deepseek"]; the provider reported running group/deepseek.\n\n你好！很高兴见到你！',
        "zh",
      ),
    ).toBe("@协调者 [已完成] 你好！很高兴见到你！");
    expect(
      formatAuxPlainSnippet(
        '@coordinator [done] Requested model ["magpie","group/deepseek"]; the provider reported running group/deepseek.\n\nHello there!',
        "en",
      ),
    ).toBe("@coordinator [done] Hello there!");

    // Localizes genuine model mismatch while unwrapping JSON tuple
    expect(
      formatAuxPlainSnippet(
        '@coordinator [done] Requested model ["magpie","group/deepseek"]; the provider reported running group/qwen.\n\n你好！',
        "zh",
      ),
    ).toBe("@协调者 [已完成] 请求模型 group/deepseek，提供方实际运行 group/qwen。 你好！");
    expect(
      formatAuxPlainSnippet(
        '@coordinator [done] Requested model ["magpie","group/deepseek"]; the provider reported running group/qwen.\n\nHello!',
        "en",
      ),
    ).toBe(
      "@coordinator [done] Requested model group/deepseek; the provider reported running group/qwen. Hello!",
    );

    // Cleans dispatch bold markdown and deduplicates redundant `@Name Name` prefix
    expect(
      formatAuxPlainSnippet(
        "@acpregistry-生成100字打招呼 **生成100字打招呼**\n\n请生成一段100字左右的打招呼文案",
        "zh",
      ),
    ).toBe("@生成100字打招呼 请生成一段100字左右的打招呼文案");

    // Localizes [blocked], [stall], @all, and standalone JSON model tuple
    expect(
      formatAuxPlainSnippet(
        '@all [blocked] [stall] 使用 `["magpie","group/deepseek"]` 测试 **完成**',
        "zh",
      ),
    ).toBe("@全体 [受阻] [停滞] 使用 group/deepseek 测试 完成");
  });
});
