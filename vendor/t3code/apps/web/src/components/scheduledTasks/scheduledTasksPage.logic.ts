import type { ScheduledTask } from "@t3tools/contracts";
import { useLocale } from "gt-react";

import { getActiveLocale } from "../../i18n/messages";

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

export interface ScheduledTasksPageCopy {
  readonly isZh: boolean;
  readonly pageTitle: string;
  readonly pageSubtitle: string;
  readonly closeLabel: string;
  readonly closeTooltip: string;
  readonly newTaskAction: string;
  readonly searchPlaceholder: string;
  readonly clearSearchLabel: string;
  readonly clearFiltersAction: string;
  readonly filterAll: string;
  readonly filterEnabled: string;
  readonly filterPaused: string;
  readonly filterWebhook: string;
  readonly allEnvironmentsLabel: string;
  readonly summaryBadge: (enabled: number, total: number) => string;
  readonly noEnvironmentsTitle: string;
  readonly noEnvironmentsDescription: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly noMatchesTitle: string;
  readonly noMatchesDescription: string;
  readonly loadingLabel: string;
  readonly disconnectedPrefix: string;
  readonly errorPrefix: string;
  readonly taskUnavailableTitle: string;
  readonly taskUnavailableDescription: string;
}

const ZH_COPY: ScheduledTasksPageCopy = {
  isZh: true,
  pageTitle: "定时任务",
  pageSubtitle: "按固定时间、单次计划、周期或 Webhook 自动触发代理会话",
  closeLabel: "关闭定时任务面板",
  closeTooltip: "关闭 · Esc",
  newTaskAction: "新建定时任务",
  searchPlaceholder: "搜索定时任务标题或提示词…",
  clearSearchLabel: "清空搜索条件",
  clearFiltersAction: "重置筛选条件",
  filterAll: "全部",
  filterEnabled: "已启用",
  filterPaused: "已暂停",
  filterWebhook: "Webhook",
  allEnvironmentsLabel: "全部环境",
  summaryBadge: (enabled, total) => `${enabled} / ${total} 启用`,
  noEnvironmentsTitle: "暂无可用环境",
  noEnvironmentsDescription: "请先连接本地或远程 Prismux 环境后再创建与管理定时任务。",
  emptyTitle: "尚未创建定时任务",
  emptyDescription:
    "可配置每日定时巡检、间隔触发、单次计划或 Webhook 自动拉起工作区线程执行任务。",
  noMatchesTitle: "没有匹配的定时任务",
  noMatchesDescription: "尝试更换关键词或切换状态筛选以查看其它任务。",
  loadingLabel: "正在加载定时任务…",
  disconnectedPrefix: "未连接",
  errorPrefix: "无法加载定时任务",
  taskUnavailableTitle: "目标定时任务不可用",
  taskUnavailableDescription: "该任务已被删除或属于其他环境/项目。",
};

const EN_COPY: ScheduledTasksPageCopy = {
  isZh: false,
  pageTitle: "Scheduled Tasks",
  pageSubtitle: "Run agent prompts automatically on a schedule, fixed time, once, or webhook",
  closeLabel: "Close scheduled tasks",
  closeTooltip: "Close · Esc",
  newTaskAction: "New task",
  searchPlaceholder: "Search scheduled tasks by name or prompt…",
  clearSearchLabel: "Clear search",
  clearFiltersAction: "Reset filters",
  filterAll: "All",
  filterEnabled: "Enabled",
  filterPaused: "Paused",
  filterWebhook: "Webhook",
  allEnvironmentsLabel: "All environments",
  summaryBadge: (enabled, total) => `${enabled} / ${total} active`,
  noEnvironmentsTitle: "No environments available",
  noEnvironmentsDescription: "Connect a local or remote Prismux environment to manage scheduled tasks.",
  emptyTitle: "No scheduled tasks yet",
  emptyDescription:
    "Create an interval, fixed-time, one-time, or webhook task to trigger agent runs automatically.",
  noMatchesTitle: "No matching scheduled tasks",
  noMatchesDescription: "Try adjusting your search query or status filter to view other tasks.",
  loadingLabel: "Loading scheduled tasks…",
  disconnectedPrefix: "Disconnected",
  errorPrefix: "Could not load scheduled tasks",
  taskUnavailableTitle: "Task unavailable",
  taskUnavailableDescription: "This task was deleted or belongs to a different environment or project.",
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
