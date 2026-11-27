import { useSyncExternalStore } from "react";

import { getActiveLocale } from "../../i18n/messages";
import { getI18nSnapshot, subscribeI18n } from "../../i18n/runtime";

export type AgentAuxLocale = "zh" | "en";

export function normalizeAgentAuxLocale(raw?: string | null): AgentAuxLocale {
  const candidate = (raw ?? "").trim().toLowerCase();
  if (candidate.startsWith("zh")) return "zh";
  if (candidate.startsWith("en")) return "en";
  const active = (getActiveLocale() ?? "").trim().toLowerCase();
  if (active.startsWith("zh")) return "zh";
  if (active.startsWith("en")) return "en";
  if (typeof document !== "undefined") {
    const docLang = (document.documentElement?.lang ?? "").trim().toLowerCase();
    if (docLang.startsWith("zh")) return "zh";
    if (docLang.startsWith("en")) return "en";
  }
  return "zh";
}

/**
 * Reactively subscribes to the active Prismux UI locale via the i18n runtime store
 * (the exact source backing `I18nProvider` / `GTProvider`), safely supporting both
 * live runtime language switching and standalone SSR/unit tests without requiring `initializeGT()`.
 */
export function useAgentAuxLocale(override?: AgentAuxLocale): AgentAuxLocale {
  const { locale } = useSyncExternalStore(subscribeI18n, getI18nSnapshot, getI18nSnapshot);
  if (override) return override;
  const low = locale.trim().toLowerCase();
  if (low.startsWith("zh")) return "zh";
  if (low.startsWith("en")) {
    const active = (getActiveLocale() ?? "").trim().toLowerCase();
    if (active.startsWith("zh")) return "zh";
    return "en";
  }
  return normalizeAgentAuxLocale(locale);
}

export interface AgentAuxMessages {
  readonly panelFallbackSwarm: string;
  readonly panelFallbackCollab: string;
  readonly panelEmptyHeader: string;
  readonly panelEmptyTitle: string;
  readonly panelEmptyBody: string;
  readonly panelTablistAria: string;
  readonly entrySwarm: string;
  readonly entryCollab: string;
  readonly entryClaudeTeam: string;
  readonly entryAgySubagents: string;
  readonly entryViewFallback: string;
  readonly headerLive: string;
  readonly headerCompleted: string;
  readonly headerIdle: string;
  readonly headerRefresh: string;
  readonly tabOverview: string;
  readonly tabBoard: string;
  readonly tabMembers: string;
  readonly tabGraph: string;
  readonly tabTasks: string;
  readonly overviewGoal: string;
  readonly overviewRunning: string;
  readonly overviewThreadsHeading: string;
  readonly overviewOtherThread: string;
  readonly overviewDelegatedThread: string;
  readonly overviewAcpAbsorbedThread: string;
  readonly overviewAcpAbsorbedGoal: string;
  readonly overviewTeamHeading: string;
  readonly overviewAllTeam: string;
  readonly overviewClearFilter: string;
  readonly overviewViewPosts: string;
  readonly overviewViewAllMembers: string;
  readonly overviewNoDoneYet: string;
  readonly overviewQueuedHeading: string;
  readonly overviewNeedsYouHeading: string;
  readonly overviewFromPrefix: string;
  readonly overviewNowPrefix: string;
  readonly overviewStallTitle: string;
  readonly overviewOnboardingTitle: string;
  readonly overviewOnboardingLeadTitle: string;
  readonly overviewOnboardingLeadDesc: string;
  readonly overviewOnboardingWorkersTitle: string;
  readonly overviewOnboardingWorkersDesc: string;
  readonly overviewOnboardingBoardTitle: string;
  readonly overviewOnboardingBoardDesc: string;
  readonly overviewOnboardingWait: string;
  readonly stateMoving: string;
  readonly stateDone: string;
  readonly stateReview: string;
  readonly stateWorking: string;
  readonly stateParked: string;
  readonly stateWaitingGeneric: string;
  readonly stateNeedsYou: string;
  readonly stateBlocked: string;
  readonly stateError: string;
  readonly stateQueued: string;
  readonly stateKilled: string;
  readonly stateUnborn: string;
  readonly roleCoordinator: string;
  readonly roleCoordinatorWorking: string;
  readonly roleWorker: string;
  readonly roleVerifier: string;
  readonly roleMonitor: string;
  readonly roleNarrator: string;
  readonly roleSubagent: string;
  readonly roleAcpDelegated: string;
  readonly boardSearchPlaceholder: string;
  readonly boardSearchAria: string;
  readonly boardFiltersTitle: string;
  readonly boardFiltersAria: string;
  readonly boardSenderAll: string;
  readonly boardRecipientAll: string;
  readonly boardBroadcastAllOption: string;
  readonly boardBroadcastAllMention: string;
  readonly boardTagDone: string;
  readonly boardTagBlocked: string;
  readonly boardTagStall: string;
  readonly boardFollowLabel: string;
  readonly boardNewDivider: string;
  readonly boardExpandPost: string;
  readonly boardCollapsePost: string;
  readonly boardJumpLatest: string;
  readonly boardEmpty: string;
  readonly boardEmptyFiltered: string;
  readonly boardClearFilters: string;
  readonly boardAllChannels: string;
  readonly boardMainChannel: string;
  readonly membersSearchPlaceholder: string;
  readonly membersSearchAria: string;
  readonly membersActiveHeading: string;
  readonly membersStandbyHeading: string;
  readonly membersTeamHeading: string;
  readonly membersRetiredHeading: string;
  readonly membersOpenThread: string;
  readonly membersViewPosts: string;
  readonly membersHideSteps: string;
  readonly membersNoPostsYet: string;
  readonly membersEmptySearch: string;
  readonly graphModeAria: string;
  readonly graphModeHive: string;
  readonly graphModeMentions: string;
  readonly graphPacingAria: string;
  readonly graphPacingEven: string;
  readonly graphPacingReal: string;
  readonly graphSpeedAria: string;
  readonly graphHideInactive: string;
  readonly graphExpandAll: string;
  readonly graphReplayStart: string;
  readonly graphReplayPrev: string;
  readonly graphReplayPlay: string;
  readonly graphReplayPause: string;
  readonly graphReplayNext: string;
  readonly graphReplayLive: string;
  readonly graphReplaySliderAria: string;
  readonly graphZoomOut: string;
  readonly graphZoomIn: string;
  readonly graphZoomFit: string;
  readonly graphHiveAria: string;
  readonly graphMentionsAria: string;
  readonly graphLegendTasksDone: string;
  readonly graphLegendMessageSent: string;
  readonly graphLegendWaitingOn: string;
  readonly graphLegendMentionCount: string;
  readonly graphLegendViaAll: string;
  readonly graphLegendUnaddressed: string;
  readonly graphLegendBroadcast: string;
  readonly graphLegendActive: string;
  readonly graphLocateInBoard: string;
  readonly graphCloseCard: string;
  readonly graphNoMembersInThread: string;
  readonly tasksEmpty: string;
  readonly tasksOwnerPrefix: string;
  readonly tasksBlockedByPrefix: string;
  readonly acpDelegatedBadge: string;
}

export const AGENT_AUX_STRINGS: Readonly<Record<AgentAuxLocale, AgentAuxMessages>> = {
  zh: {
    panelFallbackSwarm: "蜂群协同",
    panelFallbackCollab: "多智能体协同",
    panelEmptyHeader: "多智能体协同",
    panelEmptyTitle: "当前会话未检测到活跃协同",
    panelEmptyBody:
      "当 Antigravity 蜂群、ACP 子代理委派、Claude 团队或 Codex 协同启动时，此只读侧边栏将自动呈现实时协作视图。",
    panelTablistAria: "多智能体协同视图",
    entrySwarm: "蜂群侧边栏",
    entryCollab: "协同侧边栏",
    entryClaudeTeam: "团队侧边栏",
    entryAgySubagents: "子智能体面板",
    entryViewFallback: "查看",
    headerLive: "实时",
    headerCompleted: "已完成",
    headerIdle: "已待命",
    headerRefresh: "刷新状态",
    tabOverview: "概览",
    tabBoard: "看板",
    tabMembers: "成员",
    tabGraph: "关系图",
    tabTasks: "任务",
    overviewGoal: "目标",
    overviewRunning: "进行中",
    overviewThreadsHeading: "工作组",
    overviewOtherThread: "其他",
    overviewDelegatedThread: "协同委派任务",
    overviewAcpAbsorbedThread: "ACP 外部委派",
    overviewAcpAbsorbedGoal: "主线程同步调用的外部 ACP / MCP 子代理已纳入当前蜂群协同管理",
    overviewTeamHeading: "协同团队",
    overviewAllTeam: "全部",
    overviewClearFilter: "清除筛选",
    overviewViewPosts: "查看发言",
    overviewViewAllMembers: "全部成员",
    overviewNoDoneYet: "暂无已完成任务",
    overviewQueuedHeading: "待开始",
    overviewNeedsYouHeading: "需你介入",
    overviewFromPrefix: "来自",
    overviewNowPrefix: "当前：",
    overviewStallTitle: "检测到协同停滞",
    overviewOnboardingTitle: "蜂群已启动",
    overviewOnboardingLeadTitle: "统一目标",
    overviewOnboardingLeadDesc: "协调者负责拆解任务并调度成员。",
    overviewOnboardingWorkersTitle: "并行执行",
    overviewOnboardingWorkersDesc: "各成员在独立上下文中推进子任务。",
    overviewOnboardingBoardTitle: "消息看板",
    overviewOnboardingBoardDesc: "所有进展、评审与交付实时汇集于此。",
    overviewOnboardingWait: "等待协调者分派首个任务…",
    stateMoving: "推进中",
    stateDone: "已完成",
    stateReview: "审阅中",
    stateWorking: "工作中",
    stateParked: "待命中",
    stateWaitingGeneric: "等待中",
    stateNeedsYou: "需你介入",
    stateBlocked: "受阻",
    stateError: "异常",
    stateQueued: "待开始",
    stateKilled: "已退出",
    stateUnborn: "尚未加入",
    roleCoordinator: "协调者",
    roleCoordinatorWorking: "协调者 · 工作中",
    roleWorker: "执行者",
    roleVerifier: "校验者",
    roleMonitor: "监控者",
    roleNarrator: "播报员",
    roleSubagent: "子代理",
    roleAcpDelegated: "ACP 委派",
    boardSearchPlaceholder: "搜索看板消息、@成员或 #序号…",
    boardSearchAria: "搜索看板消息",
    boardFiltersTitle: "筛选消息",
    boardFiltersAria: "展开或收起筛选器",
    boardSenderAll: "发送者：全部",
    boardRecipientAll: "接收者：全部",
    boardBroadcastAllOption: "@全体 广播",
    boardBroadcastAllMention: "@全体",
    boardTagDone: "[已完成]",
    boardTagBlocked: "[受阻]",
    boardTagStall: "[停滞]",
    boardFollowLabel: "自动跟随",
    boardNewDivider: "新消息",
    boardExpandPost: "展开全文",
    boardCollapsePost: "收起",
    boardJumpLatest: "回到底部",
    boardEmpty: "暂无看板消息",
    boardEmptyFiltered: "没有匹配的看板消息",
    boardClearFilters: "清除筛选",
    boardAllChannels: "全部频道",
    boardMainChannel: "主频道",
    membersSearchPlaceholder: "搜索成员名称、模型或职责…",
    membersSearchAria: "搜索成员",
    membersActiveHeading: "工作中",
    membersStandbyHeading: "待命成员",
    membersTeamHeading: "团队成员",
    membersRetiredHeading: "已退出成员",
    membersOpenThread: "打开会话",
    membersViewPosts: "查看发言",
    membersHideSteps: "收起步骤",
    membersNoPostsYet: "尚无发言",
    membersEmptySearch: "未找到匹配的成员",
    graphModeAria: "关系图视图切换",
    graphModeHive: "蜂巢视图",
    graphModeMentions: "提及关系",
    graphPacingAria: "回放节奏",
    graphPacingEven: "均匀间隔",
    graphPacingReal: "真实时间",
    graphSpeedAria: "回放倍速",
    graphHideInactive: "隐藏非活跃",
    graphExpandAll: "展开 @全体",
    graphReplayStart: "跳到开头",
    graphReplayPrev: "上一条消息",
    graphReplayPlay: "播放回放",
    graphReplayPause: "暂停回放",
    graphReplayNext: "下一条消息",
    graphReplayLive: "实时",
    graphReplaySliderAria: "消息时间轴回放进度",
    graphZoomOut: "缩小",
    graphZoomIn: "放大",
    graphZoomFit: "适应画面",
    graphHiveAria: "蜂群蜂巢状态图",
    graphMentionsAria: "成员提及关系图",
    graphLegendTasksDone: "任务完成",
    graphLegendMessageSent: "消息刚发送",
    graphLegendWaitingOn: "等待回复",
    graphLegendMentionCount: "发送消息（线宽=次数）",
    graphLegendViaAll: "经由 @全体 广播",
    graphLegendUnaddressed: "未定向提及",
    graphLegendBroadcast: "广播 @全体",
    graphLegendActive: "活跃中",
    graphLocateInBoard: "在看板中定位",
    graphCloseCard: "关闭详情",
    graphNoMembersInThread: "该工作组暂无在岗成员",
    tasksEmpty: "暂无共享任务",
    tasksOwnerPrefix: "负责人：",
    tasksBlockedByPrefix: "依赖 #",
    acpDelegatedBadge: "ACP 委派",
  },
  en: {
    panelFallbackSwarm: "Swarm Collaboration",
    panelFallbackCollab: "Multi-Agent Collaboration",
    panelEmptyHeader: "Agent Collaboration",
    panelEmptyTitle: "No active collaboration in this thread",
    panelEmptyBody:
      "When an Antigravity swarm, ACP subagent delegation, Claude team, or Codex collab starts, this read-only sidebar updates live.",
    panelTablistAria: "Collaboration views",
    entrySwarm: "Swarm Panel",
    entryCollab: "Collaboration Panel",
    entryClaudeTeam: "Team Panel",
    entryAgySubagents: "Subagents Panel",
    entryViewFallback: "Open",
    headerLive: "Live",
    headerCompleted: "Completed",
    headerIdle: "Idle",
    headerRefresh: "Refresh",
    tabOverview: "Overview",
    tabBoard: "Board",
    tabMembers: "Members",
    tabGraph: "Graph",
    tabTasks: "Tasks",
    overviewGoal: "Goal",
    overviewRunning: "Running",
    overviewThreadsHeading: "Workgroups",
    overviewOtherThread: "Other",
    overviewDelegatedThread: "Delegated Tasks",
    overviewAcpAbsorbedThread: "ACP Delegations",
    overviewAcpAbsorbedGoal:
      "External ACP / MCP subagents invoked alongside this swarm are unified here",
    overviewTeamHeading: "The Team",
    overviewAllTeam: "All",
    overviewClearFilter: "Clear",
    overviewViewPosts: "View posts",
    overviewViewAllMembers: "All members",
    overviewNoDoneYet: "No tasks completed yet",
    overviewQueuedHeading: "Queued",
    overviewNeedsYouHeading: "Needs your input",
    overviewFromPrefix: "From",
    overviewNowPrefix: "Now: ",
    overviewStallTitle: "Swarm Stall Detected",
    overviewOnboardingTitle: "Your swarm is starting",
    overviewOnboardingLeadTitle: "One goal",
    overviewOnboardingLeadDesc: "The coordinator splits work and dispatches tasks.",
    overviewOnboardingWorkersTitle: "Parallel workers",
    overviewOnboardingWorkersDesc: "Each agent advances its slice independently.",
    overviewOnboardingBoardTitle: "Shared board",
    overviewOnboardingBoardDesc: "Progress, reviews, and handoffs land here live.",
    overviewOnboardingWait: "Waiting for coordinator to dispatch the first task…",
    stateMoving: "Moving",
    stateDone: "Done",
    stateReview: "In review",
    stateWorking: "Working",
    stateParked: "Standing by",
    stateWaitingGeneric: "Waiting",
    stateNeedsYou: "Needs your input",
    stateBlocked: "Blocked",
    stateError: "Failed",
    stateQueued: "Queued",
    stateKilled: "Retired",
    stateUnborn: "Not started",
    roleCoordinator: "Coordinator",
    roleCoordinatorWorking: "Coordinator · Working",
    roleWorker: "Worker",
    roleVerifier: "Verifier",
    roleMonitor: "Monitor",
    roleNarrator: "Narrator",
    roleSubagent: "Subagent",
    roleAcpDelegated: "ACP Delegated",
    boardSearchPlaceholder: "Search posts, @member, or #seq…",
    boardSearchAria: "Search board messages",
    boardFiltersTitle: "Filters",
    boardFiltersAria: "Toggle filters",
    boardSenderAll: "From: All",
    boardRecipientAll: "To: All",
    boardBroadcastAllOption: "@all broadcast",
    boardBroadcastAllMention: "@all",
    boardTagDone: "[done]",
    boardTagBlocked: "[blocked]",
    boardTagStall: "[stall]",
    boardFollowLabel: "Follow",
    boardNewDivider: "New",
    boardExpandPost: "Show more",
    boardCollapsePost: "Show less",
    boardJumpLatest: "Jump to latest",
    boardEmpty: "No board messages yet",
    boardEmptyFiltered: "No matching posts",
    boardClearFilters: "Clear filters",
    boardAllChannels: "All channels",
    boardMainChannel: "Main",
    membersSearchPlaceholder: "Search members, model, or task…",
    membersSearchAria: "Search members",
    membersActiveHeading: "Working",
    membersStandbyHeading: "Standing by",
    membersTeamHeading: "Team members",
    membersRetiredHeading: "Retired members",
    membersOpenThread: "Open thread",
    membersViewPosts: "View posts",
    membersHideSteps: "Hide steps",
    membersNoPostsYet: "No posts yet",
    membersEmptySearch: "No matching members",
    graphModeAria: "Graph mode switch",
    graphModeHive: "Hive",
    graphModeMentions: "Mentions",
    graphPacingAria: "Replay pacing",
    graphPacingEven: "Even spacing",
    graphPacingReal: "Real time",
    graphSpeedAria: "Replay speed",
    graphHideInactive: "Hide inactive",
    graphExpandAll: "Expand @all",
    graphReplayStart: "Jump to start",
    graphReplayPrev: "Previous post",
    graphReplayPlay: "Play replay",
    graphReplayPause: "Pause replay",
    graphReplayNext: "Next post",
    graphReplayLive: "Live",
    graphReplaySliderAria: "Replay timeline slider",
    graphZoomOut: "Zoom out",
    graphZoomIn: "Zoom in",
    graphZoomFit: "Fit",
    graphHiveAria: "Swarm hive state map",
    graphMentionsAria: "Member mention graph",
    graphLegendTasksDone: "Tasks done",
    graphLegendMessageSent: "Message just sent",
    graphLegendWaitingOn: "Waiting on",
    graphLegendMentionCount: "@mention (width = count)",
    graphLegendViaAll: "via @all",
    graphLegendUnaddressed: "Unaddressed post",
    graphLegendBroadcast: "@all broadcast",
    graphLegendActive: "Active",
    graphLocateInBoard: "Locate in board",
    graphCloseCard: "Close details",
    graphNoMembersInThread: "No active members in this workgroup",
    tasksEmpty: "No shared tasks yet",
    tasksOwnerPrefix: "Owner: ",
    tasksBlockedByPrefix: "Blocked by #",
    acpDelegatedBadge: "ACP",
  },
};

export function getAuxStrings(locale: AgentAuxLocale): AgentAuxMessages {
  return AGENT_AUX_STRINGS[locale];
}

export function formatAuxDuration(ms: number, locale: AgentAuxLocale): string {
  const clamped = Math.max(0, Math.round(ms));
  const totalSec = Math.floor(clamped / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (locale === "zh") {
    if (hours > 0) {
      return `${hours} 小时 ${String(minutes).padStart(2, "0")} 分`;
    }
    if (minutes > 0) {
      return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
    }
    return `${seconds} 秒`;
  }
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

export function formatAuxTasksDone(done: number, total: number, locale: AgentAuxLocale): string {
  return locale === "zh" ? `已完成 ${done} / 共 ${total} 项` : `${done} of ${total} tasks done`;
}

export function formatAuxInReviewChip(count: number, locale: AgentAuxLocale): string {
  return locale === "zh" ? `${count} 项审阅中` : `${count} in review`;
}

export function formatAuxBlockedChip(count: number, locale: AgentAuxLocale): string {
  return locale === "zh" ? `${count} 项受阻` : `${count} blocked`;
}

export function formatAuxNeedsYouChip(count: number, locale: AgentAuxLocale): string {
  return locale === "zh" ? `${count} 项需你介入` : `${count} need${count === 1 ? "s" : ""} you`;
}

export function formatAuxThreadsOpenChip(count: number, locale: AgentAuxLocale): string {
  return locale === "zh"
    ? `${count} 个工作组进行中`
    : `${count} thread${count === 1 ? "" : "s"} open`;
}

export function formatAuxThreadsSummary(
  openCount: number,
  totalCount: number,
  locale: AgentAuxLocale,
): string {
  return locale === "zh"
    ? `${openCount} 进行中 · 共 ${totalCount} 组`
    : `${openCount} open · ${totalCount} total`;
}

export function formatAuxTeamCount(
  liveCount: number,
  retiredCount: number,
  locale: AgentAuxLocale,
): { readonly live: string; readonly retired: string } {
  if (locale === "zh") {
    return {
      live: `${liveCount} 在岗`,
      retired: retiredCount > 0 ? `${retiredCount} 已退出` : "",
    };
  }
  return {
    live: `${liveCount} active`,
    retired: retiredCount > 0 ? `${retiredCount} retired` : "",
  };
}

export function formatAuxFilteredBy(
  name: string,
  locale: AgentAuxLocale,
  options?: { readonly displayName?: string; readonly isCoordinator?: boolean },
): string {
  const handle = formatAuxBoardMemberHandle(name, locale, options);
  return locale === "zh" ? `已筛选：${handle}` : `Filtered by ${handle}`;
}

export function formatAuxWaitingOn(
  name: string,
  locale: AgentAuxLocale,
  options?: { readonly displayName?: string; readonly isCoordinator?: boolean },
): string {
  const handle = formatAuxBoardMemberHandle(name, locale, options);
  return locale === "zh" ? `等待 ${handle}` : `Waiting on ${handle}`;
}

export function formatAuxWaitingCount(count: number, locale: AgentAuxLocale): string {
  return locale === "zh" ? `等待 ${count} 位成员` : `Waiting on ${count}`;
}

export function formatAuxShowEarlier(count: number, locale: AgentAuxLocale): string {
  return locale === "zh" ? `显示更早的 ${count} 条消息` : `Show ${count} earlier posts`;
}

export function formatAuxNewPostsFloat(count: number, locale: AgentAuxLocale): string {
  return locale === "zh" ? `有 ${count} 条新消息` : `${count} new posts`;
}

export function formatAuxStepsCount(count: number, locale: AgentAuxLocale): string {
  return locale === "zh" ? `执行步骤 (${count})` : `Steps (${count})`;
}

export function formatAuxPostsOverDuration(
  count: number,
  durationMs: number | null,
  locale: AgentAuxLocale,
): string {
  if (durationMs !== null && durationMs > 0 && count > 1) {
    const dur = formatAuxDuration(durationMs, locale);
    return locale === "zh" ? `共 ${count} 条消息 · 历时 ${dur}` : `${count} posts over ${dur}`;
  }
  return locale === "zh" ? `共 ${count} 条消息` : `${count} post${count === 1 ? "" : "s"}`;
}

export function formatAuxReplayProgress(
  indexOneBased: number,
  total: number,
  seq: number,
  clockTime: string,
  deltaMs: number | null,
  locale: AgentAuxLocale,
): string {
  const deltaPart =
    deltaMs !== null && deltaMs > 0 ? ` (+${formatAuxDuration(deltaMs, locale)})` : "";
  if (locale === "zh") {
    return `第 ${indexOneBased} / ${total} 条 · #${seq}${clockTime ? ` · ${clockTime}` : ""}${deltaPart}`;
  }
  return `Post ${indexOneBased}/${total} · #${seq}${clockTime ? ` · ${clockTime}` : ""}${deltaPart}`;
}

export function formatAuxWorkspaceBadge(
  mode: string | null | undefined,
  shortPath: string,
  locale: AgentAuxLocale,
): string {
  const cleanMode = (mode ?? "").trim().toLowerCase();
  if (!cleanMode || cleanMode === "inherit") return shortPath;
  const localizedMode =
    locale === "zh"
      ? cleanMode === "share"
        ? "共享副本"
        : cleanMode === "branch"
          ? "独立分支"
          : cleanMode === "worktree"
            ? "工作树"
            : cleanMode === "remote"
              ? "远程"
              : cleanMode
      : cleanMode;
  return shortPath ? `${localizedMode} · ${shortPath}` : localizedMode;
}

export function formatAuxEntryBadge(
  activeCount: number,
  memberCount: number,
  locale: AgentAuxLocale,
): string {
  if (activeCount > 0) {
    return locale === "zh" ? `${activeCount} 工作中` : `${activeCount} working`;
  }
  if (memberCount > 0) {
    return locale === "zh" ? `${memberCount} 成员` : `${memberCount} members`;
  }
  return getAuxStrings(locale).entryViewFallback;
}

export function formatAuxDelegationWave(indexOneBased: number, locale: AgentAuxLocale): string {
  return locale === "zh" ? `第 ${indexOneBased} 轮委派` : `Delegation Wave ${indexOneBased}`;
}

export function formatAuxCoordinatorSummary(childCount: number, locale: AgentAuxLocale): string {
  return locale === "zh"
    ? `协调 ${childCount} 个子代理任务`
    : `Coordinating ${childCount} delegated agent${childCount === 1 ? "" : "s"}`;
}

export type AuxBoardStatusTagKind = "done" | "blocked" | "stall";

export function formatAuxBoardStatusTag(
  kind: AuxBoardStatusTagKind,
  locale: AgentAuxLocale,
): string {
  const s = getAuxStrings(locale);
  switch (kind) {
    case "done":
      return s.boardTagDone;
    case "blocked":
      return s.boardTagBlocked;
    case "stall":
      return s.boardTagStall;
  }
}

const ACP_REGISTRY_HANDLE_PREFIX_RE = /^acp[_-]?registry[-_]+/i;

/**
 * Formats a member handle into its localized display name (without a leading `@`) while keeping
 * raw routing IDs untouched (`coordinator` -> `协调者` in zh; strips noisy internal `acpregistry-`
 * driver prefixes while keeping disambiguation suffixes readable).
 */
export function formatAuxMemberDisplayName(
  name: string,
  locale: AgentAuxLocale,
  options?: { readonly displayName?: string; readonly isCoordinator?: boolean },
): string {
  const raw = name.trim().replace(/^@+/, "");
  if (!raw) return "";
  const s = getAuxStrings(locale);
  const lower = raw.toLowerCase();
  if (lower === "all") {
    return s.boardBroadcastAllMention.replace(/^@+/, "");
  }
  if (lower === "coordinator" || (locale === "zh" && lower === "team-lead")) {
    return locale === "zh" ? s.roleCoordinator : raw;
  }
  if (lower === "acpregistry") {
    const cleanDisplay = options?.displayName?.trim();
    if (cleanDisplay) return cleanDisplay;
    return locale === "zh" ? s.roleAcpDelegated : "acp";
  }
  if (ACP_REGISTRY_HANDLE_PREFIX_RE.test(raw)) {
    const stripped = raw.replace(ACP_REGISTRY_HANDLE_PREFIX_RE, "").trim();
    if (!stripped) {
      return locale === "zh" ? s.roleSubagent : "acp";
    }
    if (/^\d+$/.test(stripped)) {
      return locale === "zh" ? `${s.roleSubagent}-${stripped}` : `acp-${stripped}`;
    }
    return stripped;
  }
  return raw;
}

/**
 * Formats a board member handle for display (always prefixed with `@`) without altering the
 * underlying member routing ID (`coordinator` -> `@协调者` in zh; strips noisy internal
 * `acpregistry-` driver prefixes while keeping disambiguation suffixes readable).
 */
export function formatAuxBoardMemberHandle(
  name: string,
  locale: AgentAuxLocale,
  options?: { readonly displayName?: string; readonly isCoordinator?: boolean },
): string {
  const display = formatAuxMemberDisplayName(name, locale, options);
  return display ? `@${display}` : "@";
}

interface ParsedBoardModelSpec {
  readonly raw: string;
  readonly provider: string | undefined;
  readonly model: string;
  readonly fromTuple: boolean;
}

function parseBoardModelSpec(rawValue: string): ParsedBoardModelSpec {
  const raw = rawValue.trim();
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        if (
          parsed.length >= 2 &&
          typeof parsed[0] === "string" &&
          typeof parsed[1] === "string" &&
          parsed[1].trim().length > 0
        ) {
          const provider = parsed[0].trim();
          return {
            raw,
            provider: provider.length > 0 ? provider : undefined,
            model: parsed[1].trim(),
            fromTuple: true,
          };
        }
        if (parsed.length === 1 && typeof parsed[0] === "string" && parsed[0].trim().length > 0) {
          return {
            raw,
            provider: undefined,
            model: parsed[0].trim(),
            fromTuple: true,
          };
        }
      }
    } catch {
      // Fall back to raw text.
    }
  }
  return { raw, provider: undefined, model: raw, fromTuple: false };
}

/** Formats raw model strings (including JSON tuples like `["magpie","group/deepseek"]`) for display. */
export function formatAuxReadableModelId(
  rawValue: string,
  options?: { readonly includeTupleProvider?: boolean },
): string {
  const parsed = parseBoardModelSpec(rawValue);
  if (!parsed.model) return parsed.raw;
  if (parsed.fromTuple && options?.includeTupleProvider && parsed.provider) {
    return `${parsed.provider}/${parsed.model}`;
  }
  return parsed.model;
}

/**
 * Unwraps raw model identifiers (including JSON routing tuples like `["magpie","group/deepseek"]`)
 * into clean user-facing labels across Overview, Members, Board, and Graph tabs.
 */
export function formatAuxModelDisplayLabel(rawModel: string | null | undefined): string {
  const raw = (rawModel ?? "").trim();
  if (!raw) return "";
  return formatAuxReadableModelId(raw);
}

/**
 * Returns true when `requestedModel` and `executedModel` resolve to the same underlying model
 * after unwrapping JSON routing tuples such as `["magpie","group/deepseek"]` vs `group/deepseek`.
 */
export function isEquivalentAuxModelSpec(requestedModel: string, executedModel: string): boolean {
  const reqParsed = parseBoardModelSpec(requestedModel);
  const execParsed = parseBoardModelSpec(executedModel);
  const reqModel = reqParsed.model.trim().toLowerCase();
  const execModel = execParsed.model.trim().toLowerCase();
  if (!reqModel || !execModel) return false;
  if (reqModel === execModel) return true;
  if (reqParsed.provider && `${reqParsed.provider.toLowerCase()}/${reqModel}` === execModel) {
    return true;
  }
  if (execParsed.provider && `${execParsed.provider.toLowerCase()}/${execModel}` === reqModel) {
    return true;
  }
  return false;
}

export function formatAuxModelMismatchNote(
  requestedModel: string,
  executedModel: string,
  locale: AgentAuxLocale,
): string {
  const reqParsed = parseBoardModelSpec(requestedModel);
  const execParsed = parseBoardModelSpec(executedModel);
  const includeTupleProvider =
    reqParsed.model.toLowerCase() === execParsed.model.toLowerCase() &&
    reqParsed.provider !== execParsed.provider;
  const cleanRequested = formatAuxReadableModelId(requestedModel, { includeTupleProvider });
  const cleanExecuted = formatAuxReadableModelId(executedModel, { includeTupleProvider });
  return locale === "zh"
    ? `请求模型 ${cleanRequested}，提供方实际运行 ${cleanExecuted}。`
    : `Requested model ${cleanRequested}; the provider reported running ${cleanExecuted}.`;
}

const REQUESTED_MODEL_NOTE_RE =
  /Requested model ([^\n;]+?);\s*the provider reported running ([^\n]+?)\.(?=\s|$)/g;
const STANDALONE_MODEL_TUPLE_RE = /\[\s*"([^"\s[\]]+)"\s*,\s*"([^"\s[\]]+)"\s*\]/g;
const CHILD_NO_ASSISTANT_RESULT_RE = /Child task completed without an assistant result\./g;
const CHILD_ENDED_WITH_STATUS_RE = /Child task ended with status ([a-z_]+)\./gi;
const LAST_ASSISTANT_BEFORE_FAIL_RE = /Last assistant message before the run failed:/g;
const PLAIN_STATUS_TAG_RE = /\[(done|blocked|stall)\]/gi;
const PLAIN_MENTION_RE = /(?<![\p{L}\p{Nd}_-])@([\p{L}\p{Nd}][\p{L}\p{Nd}_-]{0,63})/gu;

function localizeSubagentRunStatusZh(status: string): string {
  switch (status.toLowerCase()) {
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
    case "canceled":
      return "已取消";
    case "interrupted":
      return "已中断";
    case "rolled_back":
      return "已回滚";
    default:
      return status;
  }
}

/**
 * Localizes known provider-projected system notices inside plain board text (never invoked on
 * code blocks or inline code) and unwraps ugly JSON model tuple strings across both zh & en.
 */
export function localizeAuxBoardPlainText(text: string, locale: AgentAuxLocale): string {
  if (!text) return text;
  let out = text
    .replace(REQUESTED_MODEL_NOTE_RE, (_full, requested: string, executed: string) =>
      formatAuxModelMismatchNote(requested, executed, locale),
    )
    .replace(STANDALONE_MODEL_TUPLE_RE, (_full, _provider: string, model: string) => model);
  if (locale === "zh") {
    out = out
      .replace(CHILD_NO_ASSISTANT_RESULT_RE, "子任务已完成，但未返回助手结果。")
      .replace(
        CHILD_ENDED_WITH_STATUS_RE,
        (_full, status: string) => `子任务已结束（状态：${localizeSubagentRunStatusZh(status)}）。`,
      )
      .replace(LAST_ASSISTANT_BEFORE_FAIL_RE, "运行失败前最后一条助手消息：");
  }
  return out;
}

/** Localizes single-line member/workstream previews, stripping equivalent model-mismatch prefixes and inline markdown. */
export function formatAuxPlainSnippet(
  raw: string | null | undefined,
  locale: AgentAuxLocale,
): string {
  const input = (raw ?? "").trim();
  if (!input) return "";

  let out = input.replace(REQUESTED_MODEL_NOTE_RE, (_full, requested: string, executed: string) =>
    isEquivalentAuxModelSpec(requested, executed)
      ? ""
      : formatAuxModelMismatchNote(requested, executed, locale),
  );

  out = out.replace(STANDALONE_MODEL_TUPLE_RE, (_full, _provider: string, model: string) => model);

  if (locale === "zh") {
    out = out
      .replace(CHILD_NO_ASSISTANT_RESULT_RE, "子任务已完成，但未返回助手结果。")
      .replace(
        CHILD_ENDED_WITH_STATUS_RE,
        (_full, status: string) => `子任务已结束（状态：${localizeSubagentRunStatusZh(status)}）。`,
      )
      .replace(LAST_ASSISTANT_BEFORE_FAIL_RE, "运行失败前最后一条助手消息：");
  }

  out = out
    .replace(PLAIN_STATUS_TAG_RE, (_full, kind: string) =>
      formatAuxBoardStatusTag(kind.toLowerCase() as AuxBoardStatusTagKind, locale),
    )
    .replace(PLAIN_MENTION_RE, (_full, name: string) => formatAuxBoardMemberHandle(name, locale))
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  // Deduplicate adjacent `@Name Name ...` emitted by synthetic dispatch previews
  const dupMention = /^@([^\s]+)\s+([^\s]+)(?:\s+(.+))?$/.exec(out);
  if (
    dupMention?.[1] &&
    dupMention[2] &&
    dupMention[1].toLowerCase() === dupMention[2].toLowerCase()
  ) {
    out = dupMention[3] ? `@${dupMention[1]} ${dupMention[3]}` : `@${dupMention[1]}`;
  }

  return out;
}
