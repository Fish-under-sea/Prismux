import type {
  EnvironmentId,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
  ScheduledTask,
  ScheduledTaskSchedule,
} from "@prismux/core-contracts";
import { useLocale } from "gt-react";

import { getActiveLocale } from "../../i18n/messages";
import type { ScheduleMode } from "../settings/scheduledTasksSettings.logic";
import type { SettingsScopeSearch } from "../settings/settingsScope";

export type ScheduledTasksStatusFilter = "all" | "enabled" | "paused" | "webhook";

export interface ScheduledTasksFilterState {
  readonly query: string;
  readonly statusFilter: ScheduledTasksStatusFilter;
}

export interface ScheduledTasksSummary {
  readonly total: number;
  readonly enabled: number;
  readonly paused: number;
  readonly webhook: number;
  readonly failed: number;
}

export interface ScheduledTaskQuickPreset {
  readonly id: "daily-triage" | "interval-audit" | "webhook-automation";
  readonly title: string;
  readonly description: string;
  readonly scheduleBadge: string;
  readonly scheduleMode: ScheduleMode;
  readonly timeOfDay?: string;
  readonly weekdays?: readonly number[];
  readonly intervalMinutes?: string;
  readonly prompt: string;
}

export interface ScheduledTasksPageCopy {
  readonly isZh: boolean;
  readonly pageTitle: string;
  readonly pageSubtitle: string;
  readonly closeLabel: string;
  readonly closeTooltip: string;
  readonly newTaskAction: string;
  readonly createFirstTaskCta: string;
  readonly searchPlaceholder: string;
  readonly clearSearchLabel: string;
  readonly clearFiltersAction: string;
  readonly filterAll: string;
  readonly filterEnabled: string;
  readonly filterPaused: string;
  readonly filterWebhook: string;
  readonly allEnvironmentsLabel: string;
  readonly connectedEnvPrefix: string;
  readonly summaryBadge: (enabled: number, total: number) => string;
  readonly failedCountBadge: (failed: number) => string;
  readonly noEnvironmentsTitle: string;
  readonly noEnvironmentsDescription: string;
  readonly noCreatePermissionTooltip: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly quickTemplatesHeading: string;
  readonly useTemplateAction: string;
  readonly noMatchesTitle: string;
  readonly noMatchesDescription: string;
  readonly loadingLabel: string;
  readonly disconnectedPrefix: string;
  readonly errorPrefix: string;
  readonly taskUnavailableTitle: string;
  readonly taskUnavailableDescription: string;
  readonly statusEnabled: string;
  readonly statusPaused: string;
  readonly statusListening: string;
  readonly statusBlocked: string;
  readonly runStatusRunning: string;
  readonly runStatusSucceeded: string;
  readonly runStatusFailed: string;
  readonly actionRunNow: string;
  readonly actionDeliveries: string;
  readonly actionEdit: string;
  readonly actionDelete: string;
  readonly metaScheduleLabel: string;
  readonly metaNextRunLabel: string;
  readonly metaLastRunLabel: string;
  readonly metaWorkspaceLabel: string;
  readonly metaModelLabel: string;
  readonly metaWebhookEndpointLabel: string;
  readonly metaWebhookListening: string;
  readonly metaWebhookSigned: string;
  readonly metaWebhookUnsigned: string;
  readonly metaNotScheduled: string;
  readonly metaNeverRun: string;
  readonly metaRunCount: (count: number) => string;
  readonly metaViewExecutionThread: string;
  readonly metaCopyEndpoint: string;
  readonly metaCopiedEndpoint: string;
  readonly quickTemplates: readonly ScheduledTaskQuickPreset[];
}

const ZH_QUICK_TEMPLATES: readonly ScheduledTaskQuickPreset[] = [
  {
    id: "daily-triage",
    title: "工作日晨间代码巡检",
    description: "每天上午自动检查未处理 Issue、CI 状态与待评审 PR，生成简洁摘要。",
    scheduleBadge: "工作日 09:00",
    scheduleMode: "fixed",
    timeOfDay: "09:00",
    weekdays: [1, 2, 3, 4, 5],
    prompt: "检查当前仓库最近 24 小时的变更、失败的构建与待处理 Issue，输出一份简明的优先处理清单。",
  },
  {
    id: "interval-audit",
    title: "周期健康与依赖巡查",
    description: "按固定时间间隔自动巡检测试状态、依赖漏洞与待清理分支。",
    scheduleBadge: "每 60 分钟",
    scheduleMode: "interval",
    intervalMinutes: "60",
    prompt: "运行基础健康检查与依赖安全扫描，若发现阻断性错误或高危漏洞则整理修复建议。",
  },
  {
    id: "webhook-automation",
    title: "Webhook 回调事件响应",
    description: "接收 GitHub / CI / 外部系统 HTTP 回调后，自动拉起代理线程分析并处理。",
    scheduleBadge: "Webhook 回调",
    scheduleMode: "webhook",
    prompt: "分析收到的 Webhook 回调负载 {{body}}，总结触发事件上下文并给出可执行处理方案。",
  },
];

const EN_QUICK_TEMPLATES: readonly ScheduledTaskQuickPreset[] = [
  {
    id: "daily-triage",
    title: "Weekday morning triage",
    description: "Automatically review open issues, CI checks, and pending PRs every weekday morning.",
    scheduleBadge: "Weekdays 09:00",
    scheduleMode: "fixed",
    timeOfDay: "09:00",
    weekdays: [1, 2, 3, 4, 5],
    prompt: "Review repository changes, failing checks, and open issues from the last 24 hours, and produce a prioritized summary.",
  },
  {
    id: "interval-audit",
    title: "Periodic health & audit check",
    description: "Run recurring checks on test health, dependency advisories, and stale branches.",
    scheduleBadge: "Every 60 min",
    scheduleMode: "interval",
    intervalMinutes: "60",
    prompt: "Run baseline health checks and dependency audits, reporting any regressions or high-severity advisories.",
  },
  {
    id: "webhook-automation",
    title: "Webhook event handler",
    description: "Launch an agent session automatically whenever GitHub, CI, or an external service posts a callback.",
    scheduleBadge: "Webhook callback",
    scheduleMode: "webhook",
    prompt: "Inspect the incoming webhook payload {{body}}, summarize the event context, and propose concrete next steps.",
  },
];

const ZH_COPY: ScheduledTasksPageCopy = {
  isZh: true,
  pageTitle: "定时任务",
  pageSubtitle: "按固定时间、单次计划、周期或 Webhook 回调自动触发代理会话",
  closeLabel: "关闭定时任务面板",
  closeTooltip: "关闭 · Esc",
  newTaskAction: "新建定时任务",
  createFirstTaskCta: "立即创建定时任务",
  searchPlaceholder: "搜索定时任务...",
  clearSearchLabel: "清空搜索条件",
  clearFiltersAction: "重置筛选条件",
  filterAll: "全部",
  filterEnabled: "已启用",
  filterPaused: "已暂停",
  filterWebhook: "Webhook 回调",
  allEnvironmentsLabel: "全部环境",
  connectedEnvPrefix: "环境",
  summaryBadge: (enabled, total) => `${enabled} / ${total} 启用`,
  failedCountBadge: (failed) => `${failed} 失败`,
  noEnvironmentsTitle: "暂无可用环境",
  noEnvironmentsDescription: "请先连接本地或远程 Prismux 环境后再创建与管理定时任务。",
  noCreatePermissionTooltip: "当前环境暂无创建或修改定时任务的权限",
  emptyTitle: "尚未创建定时任务",
  emptyDescription:
    "配置固定时间、周期巡检、单次计划或 Webhook 回调，让代理在指定工作区自动执行任务并保留完整运行记录。",
  quickTemplatesHeading: "快速开始模板",
  useTemplateAction: "使用此模板",
  noMatchesTitle: "没有匹配的定时任务",
  noMatchesDescription: "尝试更换关键词或切换状态筛选以查看其它任务。",
  loadingLabel: "正在加载定时任务…",
  disconnectedPrefix: "未连接",
  errorPrefix: "无法加载定时任务",
  taskUnavailableTitle: "目标定时任务不可用",
  taskUnavailableDescription: "该任务已被删除或属于其他环境/项目。",
  statusEnabled: "已启用",
  statusPaused: "已暂停",
  statusListening: "监听回调中",
  statusBlocked: "策略已禁用",
  runStatusRunning: "运行中",
  runStatusSucceeded: "上次成功",
  runStatusFailed: "上次失败",
  actionRunNow: "立即运行",
  actionDeliveries: "回调日志",
  actionEdit: "编辑",
  actionDelete: "删除",
  metaScheduleLabel: "触发计划",
  metaNextRunLabel: "下次运行",
  metaLastRunLabel: "上次运行",
  metaWorkspaceLabel: "目标工作区",
  metaModelLabel: "执行模型",
  metaWebhookEndpointLabel: "Webhook 回调端点",
  metaWebhookListening: "等待 HTTP 回调触发",
  metaWebhookSigned: "已启用签名校验",
  metaWebhookUnsigned: "未启用签名校验",
  metaNotScheduled: "未排期",
  metaNeverRun: "尚未执行",
  metaRunCount: (count) => `累计 ${count} 次`,
  metaViewExecutionThread: "查看执行会话",
  metaCopyEndpoint: "复制回调地址",
  metaCopiedEndpoint: "已复制",
  quickTemplates: ZH_QUICK_TEMPLATES,
};

const EN_COPY: ScheduledTasksPageCopy = {
  isZh: false,
  pageTitle: "Scheduled Tasks",
  pageSubtitle: "Run agent prompts automatically on a schedule, fixed time, once, or webhook callback",
  closeLabel: "Close scheduled tasks",
  closeTooltip: "Close · Esc",
  newTaskAction: "New task",
  createFirstTaskCta: "Create scheduled task",
  searchPlaceholder: "Search scheduled tasks...",
  clearSearchLabel: "Clear search",
  clearFiltersAction: "Reset filters",
  filterAll: "All",
  filterEnabled: "Enabled",
  filterPaused: "Paused",
  filterWebhook: "Webhook",
  allEnvironmentsLabel: "All environments",
  connectedEnvPrefix: "Env",
  summaryBadge: (enabled, total) => `${enabled} / ${total} active`,
  failedCountBadge: (failed) => `${failed} failed`,
  noEnvironmentsTitle: "No environments available",
  noEnvironmentsDescription: "Connect a local or remote Prismux environment to manage scheduled tasks.",
  noCreatePermissionTooltip: "You do not have permission to manage scheduled tasks in this environment.",
  emptyTitle: "No scheduled tasks yet",
  emptyDescription:
    "Create an interval, fixed-time, one-time, or webhook task to trigger agent runs automatically with full execution logs.",
  quickTemplatesHeading: "Quick-start templates",
  useTemplateAction: "Use template",
  noMatchesTitle: "No matching scheduled tasks",
  noMatchesDescription: "Try adjusting your search query or status filter to view other tasks.",
  loadingLabel: "Loading scheduled tasks…",
  disconnectedPrefix: "Disconnected",
  errorPrefix: "Could not load scheduled tasks",
  taskUnavailableTitle: "Task unavailable",
  taskUnavailableDescription: "This task was deleted or belongs to a different environment or project.",
  statusEnabled: "Enabled",
  statusPaused: "Paused",
  statusListening: "Listening",
  statusBlocked: "Blocked by policy",
  runStatusRunning: "Running",
  runStatusSucceeded: "Succeeded",
  runStatusFailed: "Failed",
  actionRunNow: "Run now",
  actionDeliveries: "Deliveries",
  actionEdit: "Edit",
  actionDelete: "Delete",
  metaScheduleLabel: "Schedule",
  metaNextRunLabel: "Next run",
  metaLastRunLabel: "Last run",
  metaWorkspaceLabel: "Workspace",
  metaModelLabel: "Model",
  metaWebhookEndpointLabel: "Webhook endpoint",
  metaWebhookListening: "Waiting for HTTP callback",
  metaWebhookSigned: "Signature verified",
  metaWebhookUnsigned: "No signature required",
  metaNotScheduled: "Not scheduled",
  metaNeverRun: "Never run",
  metaRunCount: (count) => (count === 1 ? "1 run" : `${count} runs`),
  metaViewExecutionThread: "Open execution thread",
  metaCopyEndpoint: "Copy webhook URL",
  metaCopiedEndpoint: "Copied",
  quickTemplates: EN_QUICK_TEMPLATES,
};

export function getScheduledTasksPageCopy(
  locale: string | null | undefined,
): ScheduledTasksPageCopy {
  const normalized = (locale ?? getActiveLocale() ?? "en").toLowerCase();
  return normalized.startsWith("zh") ? ZH_COPY : EN_COPY;
}

export function useScheduledTasksPageCopy(): ScheduledTasksPageCopy {
  const locale = useLocale();
  return getScheduledTasksPageCopy(locale);
}

/**
 * Converts a route/select environment choice into a valid `SettingsScopeSearch`.
 * IMPORTANT: `resolveSettingsScope` interprets `{}` (omitted `machine`) as "all environments";
 * passing `{ machine: "all" }` triggers `kind: "unavailable"` (`environment-missing`)!
 */
export function resolveScheduledTasksScopeSearch(
  environmentId?: EnvironmentId | "all" | string | null,
): SettingsScopeSearch {
  const trimmed = typeof environmentId === "string" ? environmentId.trim() : "";
  if (!trimmed || trimmed === "all") {
    return {};
  }
  return { machine: trimmed };
}

/**
 * Resolves the active environment set for ScheduledTasksPage: prefers the scoped environments,
 * and falls back cleanly to all available environments if the scope ever points to a stale ID
 * while live connected environments exist.
 */
export function resolveScheduledTasksEffectiveEnvironments<
  TEnv extends {
    readonly environmentId: EnvironmentId;
    readonly connection: { readonly phase: string };
    readonly serverConfig: unknown;
  },
>(input: {
  readonly scopedEnvironments: readonly TEnv[];
  readonly scopedConnectedEnvironments: readonly TEnv[];
  readonly availableEnvironments: readonly TEnv[];
  readonly primaryEnvironmentId: EnvironmentId | null;
}): {
  readonly environments: readonly TEnv[];
  readonly connectedEnvironments: readonly TEnv[];
  readonly defaultEnvironment: TEnv | null;
} {
  const environments =
    input.scopedEnvironments.length > 0 ? input.scopedEnvironments : input.availableEnvironments;
  const connectedEnvironments =
    input.scopedEnvironments.length > 0
      ? input.scopedConnectedEnvironments
      : environments.filter(
          (entry) => entry.connection.phase === "connected" && entry.serverConfig !== null,
        );
  const defaultEnvironment =
    connectedEnvironments.find(
      (entry) => entry.environmentId === input.primaryEnvironmentId,
    ) ??
    connectedEnvironments[0] ??
    environments.find((entry) => entry.environmentId === input.primaryEnvironmentId) ??
    environments[0] ??
    null;
  return { environments, connectedEnvironments, defaultEnvironment };
}

/**
 * Formats a compact cron-style or technical cadence badge for a ScheduledTask schedule.
 */
export function formatScheduledTaskExpression(
  schedule: ScheduledTaskSchedule,
  isZh: boolean,
): string {
  if (schedule.type === "webhook") {
    return isZh ? "POST · Webhook 回调" : "POST · Webhook";
  }
  if (schedule.type === "once") {
    return isZh ? "单次计划" : "One-time";
  }
  if (schedule.type === "interval") {
    const minutes = schedule.everyMs / 60_000;
    if (Number.isInteger(minutes) && minutes >= 1 && minutes < 60) {
      return `*/${minutes} * * * *`;
    }
    if (Number.isInteger(minutes) && minutes % 60 === 0) {
      const hours = minutes / 60;
      return `0 */${hours} * * *`;
    }
    return `every ${Math.round(schedule.everyMs / 1000)}s`;
  }
  const [rawHour = "0", rawMinute = "0"] = schedule.timeOfDay.split(":");
  const hour = Number.parseInt(rawHour, 10);
  const minute = Number.parseInt(rawMinute, 10);
  const h = Number.isFinite(hour) ? String(hour) : "0";
  const m = Number.isFinite(minute) ? String(minute) : "0";
  const weekdays = schedule.weekdays ?? [];
  const dow =
    weekdays.length === 0 || weekdays.length === 7
      ? "*"
      : weekdays.length === 5 && weekdays.every((day) => day >= 1 && day <= 5)
        ? "1-5"
        : [...weekdays].toSorted((a, b) => a - b).join(",");
  return `${m} ${h} * * ${dow}`;
}

export function formatScheduledTaskWorkspaceStrategy(
  strategy: OrchestrationV2ThreadLaunchWorkspaceStrategy,
  isZh: boolean,
): string {
  if (strategy.type === "root") {
    return isZh ? "项目主目录" : "Project checkout";
  }
  if (strategy.type === "existing_worktree") {
    return isZh ? "指定检出目录" : "Specific checkout";
  }
  const base = strategy.baseRef ? ` (${strategy.baseRef})` : "";
  return isZh ? `独立 Worktree${base}` : `New worktree${base}`;
}

export function summarizeScheduledTasks(
  tasks: ReadonlyArray<Pick<ScheduledTask, "enabled" | "schedule" | "lastRunStatus">>,
): ScheduledTasksSummary {
  let enabled = 0;
  let paused = 0;
  let webhook = 0;
  let failed = 0;
  for (const task of tasks) {
    if (task.enabled) {
      enabled += 1;
    } else {
      paused += 1;
    }
    if (task.schedule.type === "webhook") {
      webhook += 1;
    }
    if (task.lastRunStatus === "failed") {
      failed += 1;
    }
  }
  return { total: tasks.length, enabled, paused, webhook, failed };
}

export function filterScheduledTasks<
  T extends Pick<ScheduledTask, "title" | "prompt" | "enabled" | "schedule" | "blockedByPolicy">,
>(tasks: ReadonlyArray<T>, filter: ScheduledTasksFilterState): T[] {
  const q = filter.query.trim().toLowerCase();
  return tasks.filter((task) => {
    if (filter.statusFilter === "enabled" && (!task.enabled || task.blockedByPolicy !== undefined)) {
      return false;
    }
    if (filter.statusFilter === "paused" && task.enabled) {
      return false;
    }
    if (filter.statusFilter === "webhook" && task.schedule.type !== "webhook") {
      return false;
    }
    if (q.length > 0) {
      const haystack = `${task.title}\n${task.prompt}\n${task.schedule.type}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function isScheduledTasksEscapeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return Boolean(
    target.closest(
      "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-slot='popover-popup']",
    ),
  );
}
