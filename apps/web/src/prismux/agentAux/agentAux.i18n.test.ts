import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_AUX_STRINGS,
  formatAuxBlockedChip,
  formatAuxCoordinatorSummary,
  formatAuxDelegationWave,
  formatAuxDuration,
  formatAuxEntryBadge,
  formatAuxFilteredBy,
  formatAuxInReviewChip,
  formatAuxNeedsYouChip,
  formatAuxNewPostsFloat,
  formatAuxPostsOverDuration,
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
} from "./agentAux.i18n";

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
    ];

    for (const text of [...enValues, ...formattedEn]) {
      expect(CJK_RE.test(text), `Unexpected CJK character in en string "${text}"`).toBe(false);
    }

    expect(formatAuxTasksDone(32, 33, "en")).toBe("32 of 33 tasks done");
    expect(formatAuxPostsOverDuration(112, 11 * 3600_000 + 7 * 60_000, "en")).toBe(
      "112 posts over 11h 07m",
    );
  });
});
