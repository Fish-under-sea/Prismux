import { useLocale } from "gt-react";

import { getActiveLocale } from "../../i18n/messages";
import type { SidebarStorageLike } from "../sidebar/prismuxSidebarQuickNav.logic";

export type TasksTabMode = "issues" | "prs" | "projects";
export type TasksItemStateFilter = "open" | "closed" | "merged" | "all";
export type TasksInvolvementFilter =
  | "all"
  | "assigned"
  | "authored"
  | "mentioned"
  | "review-requested";
export type TasksSortOrder = "updated" | "created";

export const TASKS_SELECTED_PROJECTS_STORAGE_KEY = "prismux.tasks.selectedProjects.v1" as const;

export const DEFAULT_ISSUES_QUERY = "is:issue is:open" as const;
export const DEFAULT_PRS_QUERY = "is:pr is:open" as const;

export interface ParsedTasksQuery {
  readonly kind: "issue" | "pr";
  readonly state: TasksItemStateFilter;
  readonly involvement: TasksInvolvementFilter;
  readonly labels: readonly string[];
  readonly author: string | null;
  readonly assignee: string | null;
  readonly text: string;
}

export interface TasksEmptyState {
  readonly kind: "no-sources" | "no-matches";
  readonly title: string;
  readonly description: string;
}

export interface TasksViewCopy {
  readonly isZh: boolean;
  readonly pageTitle: string;
  readonly closeLabel: string;
  readonly closeTooltip: string;
  readonly githubSourceLabel: string;
  readonly sourcePrefixGitHub: string;
  readonly sourceSelectedProjects: string;
  readonly sourceNoProjectsSelected: string;
  readonly sourceProjectCount: (count: number) => string;
  readonly tabIssues: string;
  readonly tabPrs: string;
  readonly tabProjects: string;
  readonly projectPickerEmpty: string;
  readonly projectPickerAll: string;
  readonly projectPickerCount: (selected: number, total: number) => string;
  readonly selectAllProjects: string;
  readonly clearSelection: string;
  readonly addProjectAction: string;
  readonly openInGitHubTooltip: string;
  readonly openInGitHubDisabledTooltip: string;
  readonly chipOpen: string;
  readonly chipAssignedToMe: string;
  readonly chipAuthoredByMe: string;
  readonly chipMentioned: string;
  readonly chipReviewRequested: string;
  readonly chipMerged: string;
  readonly chipClosed: string;
  readonly chipAll: string;
  readonly filterDropdownLabel: string;
  readonly filterSectionState: string;
  readonly filterSectionInvolvement: string;
  readonly filterSectionSort: string;
  readonly sortRecentlyUpdated: string;
  readonly sortNewest: string;
  readonly searchIssuesPlaceholder: string;
  readonly searchPrsPlaceholder: string;
  readonly clearSearchLabel: string;
  readonly createTaskTooltip: string;
  readonly refreshTasksTooltip: string;
  readonly refreshingTasksTooltip: string;
  readonly columnId: string;
  readonly columnTitleContext: string;
  readonly columnAssignees: string;
  readonly columnReviewers: string;
  readonly columnStatus: string;
  readonly columnUpdated: string;
  readonly statusOpen: string;
  readonly statusClosed: string;
  readonly statusMerged: string;
  readonly statusDraft: string;
  readonly unassignedLabel: string;
  readonly openDetailAction: string;
  readonly startThreadAction: string;
  readonly noProjectSourcesTitle: string;
  readonly noProjectSourcesDescription: string;
  readonly noMatchingWorkTitle: string;
  readonly noMatchingWorkDescription: string;
  readonly noProjectsConfiguredTitle: string;
  readonly noProjectsConfiguredDescription: string;
  readonly projectsLinkedThreads: (count: number) => string;
  readonly projectsOpenIssues: string;
  readonly projectsOpenPrs: string;
  readonly projectsCreateWorkspace: string;
  readonly loadingLabel: string;
  readonly errorPrefix: string;
  readonly retryAction: string;
}

const ZH_COPY: TasksViewCopy = {
  isZh: true,
  pageTitle: "任务面板",
  closeLabel: "关闭任务面板",
  closeTooltip: "关闭 · Esc",
  githubSourceLabel: "GitHub",
  sourcePrefixGitHub: "GitHub",
  sourceSelectedProjects: "所选项目",
  sourceNoProjectsSelected: "未选择项目",
  sourceProjectCount: (count) => `已选 ${count} 个项目`,
  tabIssues: "Issue",
  tabPrs: "PR",
  tabProjects: "项目",
  projectPickerEmpty: "未选择项目",
  projectPickerAll: "全部项目",
  projectPickerCount: (selected, total) =>
    selected === total ? `全部项目 (${total})` : `已选 ${selected}/${total} 个项目`,
  selectAllProjects: "全选所有项目",
  clearSelection: "清空选择",
  addProjectAction: "添加项目…",
  openInGitHubTooltip: "在 GitHub 中打开",
  openInGitHubDisabledTooltip: "请选择一个已关联 GitHub 的项目以在浏览器打开",
  chipOpen: "开放",
  chipAssignedToMe: "分配给我",
  chipAuthoredByMe: "我创建的",
  chipMentioned: "提到我",
  chipReviewRequested: "待我审查",
  chipMerged: "已合并",
  chipClosed: "已关闭",
  chipAll: "全部",
  filterDropdownLabel: "筛选条件",
  filterSectionState: "状态",
  filterSectionInvolvement: "参与关系",
  filterSectionSort: "排序方式",
  sortRecentlyUpdated: "最近更新",
  sortNewest: "最新创建",
  searchIssuesPlaceholder: "搜索 GitHub Issue（支持 is:open assignee:@me label:...）",
  searchPrsPlaceholder: "搜索 GitHub PR（支持 is:pr is:open review-requested:@me）",
  clearSearchLabel: "清空搜索条件",
  createTaskTooltip: "新建任务 / 工作区",
  refreshTasksTooltip: "刷新任务列表",
  refreshingTasksTooltip: "正在刷新任务列表…",
  columnId: "ID",
  columnTitleContext: "标题/上下文",
  columnAssignees: "负责人",
  columnReviewers: "作者/审查",
  columnStatus: "状态",
  columnUpdated: "已更新",
  statusOpen: "开放",
  statusClosed: "已关闭",
  statusMerged: "已合并",
  statusDraft: "草稿",
  unassignedLabel: "未分配",
  openDetailAction: "查看",
  startThreadAction: "新建工作区",
  noProjectSourcesTitle: "未选择项目来源",
  noProjectSourcesDescription:
    "请至少选择一个项目来源，让 Prismux 知道要从哪个主机/账户获取任务。",
  noMatchingWorkTitle: "没有匹配的 GitHub 工作项",
  noMatchingWorkDescription: "更改查询条件或清空筛选器以查看其它任务。",
  noProjectsConfiguredTitle: "尚未添加任何项目",
  noProjectsConfiguredDescription: "添加一个本地或远程 Git 项目后，即可在此聚合 Issue、PR 与工作区。",
  projectsLinkedThreads: (count) => `${count} 个会话`,
  projectsOpenIssues: "查看 Issue",
  projectsOpenPrs: "查看 PR",
  projectsCreateWorkspace: "新建工作区",
  loadingLabel: "正在加载任务…",
  errorPrefix: "无法加载部分项目数据",
  retryAction: "重试",
};

const EN_COPY: TasksViewCopy = {
  isZh: false,
  pageTitle: "Tasks",
  closeLabel: "Close tasks",
  closeTooltip: "Close · Esc",
  githubSourceLabel: "GitHub",
  sourcePrefixGitHub: "GitHub",
  sourceSelectedProjects: "Selected projects",
  sourceNoProjectsSelected: "No projects selected",
  sourceProjectCount: (count) => (count === 1 ? "1 project selected" : `${count} projects selected`),
  tabIssues: "Issue",
  tabPrs: "PR",
  tabProjects: "Projects",
  projectPickerEmpty: "No projects selected",
  projectPickerAll: "All projects",
  projectPickerCount: (selected, total) =>
    selected === total ? `All projects (${total})` : `${selected}/${total} projects`,
  selectAllProjects: "Select all projects",
  clearSelection: "Clear selection",
  addProjectAction: "Add project…",
  openInGitHubTooltip: "Open in GitHub",
  openInGitHubDisabledTooltip: "Select a GitHub-connected project to open externally",
  chipOpen: "Open",
  chipAssignedToMe: "Assigned to me",
  chipAuthoredByMe: "Created by me",
  chipMentioned: "Mentioned",
  chipReviewRequested: "Review requested",
  chipMerged: "Merged",
  chipClosed: "Closed",
  chipAll: "All",
  filterDropdownLabel: "Filters",
  filterSectionState: "State",
  filterSectionInvolvement: "Involvement",
  filterSectionSort: "Sort",
  sortRecentlyUpdated: "Recently updated",
  sortNewest: "Newest",
  searchIssuesPlaceholder: "Search GitHub issues (e.g. is:issue is:open assignee:@me)",
  searchPrsPlaceholder: "Search GitHub PRs (e.g. is:pr is:open review-requested:@me)",
  clearSearchLabel: "Clear search",
  createTaskTooltip: "New task / workspace",
  refreshTasksTooltip: "Refresh GitHub work",
  refreshingTasksTooltip: "Refreshing GitHub work…",
  columnId: "ID",
  columnTitleContext: "Title / Context",
  columnAssignees: "Assignees",
  columnReviewers: "Author / Review",
  columnStatus: "Status",
  columnUpdated: "Updated",
  statusOpen: "Open",
  statusClosed: "Closed",
  statusMerged: "Merged",
  statusDraft: "Draft",
  unassignedLabel: "Unassigned",
  openDetailAction: "Inspect",
  startThreadAction: "New workspace",
  noProjectSourcesTitle: "No project sources selected",
  noProjectSourcesDescription:
    "Select at least one project source so Prismux knows which host/account to fetch tasks from.",
  noMatchingWorkTitle: "No matching GitHub work",
  noMatchingWorkDescription: "Change the query or clear filters to see more tasks.",
  noProjectsConfiguredTitle: "No projects configured yet",
  noProjectsConfiguredDescription:
    "Add a local or remote Git repository to aggregate its issues, pull requests, and workspaces here.",
  projectsLinkedThreads: (count) => (count === 1 ? "1 thread" : `${count} threads`),
  projectsOpenIssues: "Issues",
  projectsOpenPrs: "PRs",
  projectsCreateWorkspace: "New workspace",
  loadingLabel: "Loading tasks…",
  errorPrefix: "Failed to load some project sources",
  retryAction: "Retry",
};

export function getTasksViewCopy(locale: string | null | undefined): TasksViewCopy {
  const normalized = (locale ?? getActiveLocale() ?? "en").toLowerCase();
  return normalized.startsWith("zh") ? ZH_COPY : EN_COPY;
}

export function useTasksViewCopy(): TasksViewCopy {
  const locale = useLocale();
  return getTasksViewCopy(locale);
}

/**
 * Tokenizes a GitHub-style query string while preserving quoted qualifier values
 * such as `label:"good first issue"`.
 */
function tokenizeQuery(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function parseTasksQuery(
  rawQuery: string,
  fallbackMode: "issues" | "prs" = "issues",
): ParsedTasksQuery {
  let kind: "issue" | "pr" = fallbackMode === "prs" ? "pr" : "issue";
  let state: TasksItemStateFilter = "all";
  let sawStateToken = false;
  let involvement: TasksInvolvementFilter = "all";
  const labels: string[] = [];
  let author: string | null = null;
  let assignee: string | null = null;
  const freeTerms: string[] = [];

  for (const token of tokenizeQuery(rawQuery)) {
    const colonIdx = token.indexOf(":");
    if (colonIdx <= 0) {
      freeTerms.push(token);
      continue;
    }
    const key = token.slice(0, colonIdx).toLowerCase();
    const rawVal = stripQuotes(token.slice(colonIdx + 1));
    const lowerVal = rawVal.toLowerCase();

    if (key === "is" || key === "type") {
      if (lowerVal === "issue") {
        kind = "issue";
        continue;
      }
      if (lowerVal === "pr" || lowerVal === "pull-request") {
        kind = "pr";
        continue;
      }
      if (lowerVal === "open" || lowerVal === "closed" || lowerVal === "merged") {
        state = lowerVal;
        sawStateToken = true;
        continue;
      }
    }
    if (key === "state") {
      if (lowerVal === "open" || lowerVal === "closed" || lowerVal === "merged") {
        state = lowerVal;
        sawStateToken = true;
        continue;
      }
    }
    if (key === "assignee") {
      if (lowerVal === "@me") {
        involvement = "assigned";
      } else if (rawVal) {
        assignee = rawVal;
      }
      continue;
    }
    if (key === "author") {
      if (lowerVal === "@me") {
        involvement = "authored";
      } else if (rawVal) {
        author = rawVal;
      }
      continue;
    }
    if (key === "mentions" && lowerVal === "@me") {
      involvement = "mentioned";
      continue;
    }
    if (key === "review-requested" && lowerVal === "@me") {
      involvement = "review-requested";
      continue;
    }
    if (key === "label" && rawVal) {
      labels.push(rawVal);
      continue;
    }
    freeTerms.push(token);
  }

  return {
    kind,
    state: sawStateToken ? state : "all",
    involvement,
    labels,
    author,
    assignee,
    text: freeTerms.join(" ").trim(),
  };
}

export function buildTasksQuery(input: {
  readonly mode: "issues" | "prs";
  readonly state: TasksItemStateFilter;
  readonly involvement: TasksInvolvementFilter;
  readonly labels?: readonly string[];
  readonly author?: string | null;
  readonly assignee?: string | null;
  readonly text?: string;
}): string {
  const parts: string[] = [input.mode === "prs" ? "is:pr" : "is:issue"];
  if (input.state !== "all") {
    parts.push(`is:${input.state}`);
  }
  if (input.involvement === "assigned") {
    parts.push("assignee:@me");
  } else if (input.involvement === "authored") {
    parts.push("author:@me");
  } else if (input.involvement === "mentioned") {
    parts.push("mentions:@me");
  } else if (input.involvement === "review-requested") {
    parts.push("review-requested:@me");
  }
  if (input.author) {
    parts.push(`author:${input.author}`);
  }
  if (input.assignee) {
    parts.push(`assignee:${input.assignee}`);
  }
  for (const label of input.labels ?? []) {
    const trimmed = label.trim();
    if (!trimmed) continue;
    parts.push(/\s/.test(trimmed) ? `label:"${trimmed}"` : `label:${trimmed}`);
  }
  const text = input.text?.trim();
  if (text) {
    parts.push(text);
  }
  return parts.join(" ");
}

export function applyTasksQueryPatch(
  rawQuery: string,
  mode: "issues" | "prs",
  patch: Partial<{
    readonly state: TasksItemStateFilter;
    readonly involvement: TasksInvolvementFilter;
    readonly labels: readonly string[];
    readonly author: string | null;
    readonly assignee: string | null;
    readonly text: string;
  }>,
): string {
  const parsed = parseTasksQuery(rawQuery, mode);
  return buildTasksQuery({
    mode,
    state: patch.state ?? parsed.state,
    involvement: patch.involvement ?? parsed.involvement,
    labels: patch.labels ?? parsed.labels,
    author: patch.author !== undefined ? patch.author : parsed.author,
    assignee: patch.assignee !== undefined ? patch.assignee : parsed.assignee,
    text: patch.text !== undefined ? patch.text : parsed.text,
  });
}

export function resolveTasksEmptyState(input: {
  readonly selectedProjectCount: number;
  readonly totalProjectCount: number;
  readonly copy: TasksViewCopy;
}): TasksEmptyState {
  if (input.selectedProjectCount === 0) {
    return {
      kind: "no-sources",
      title: input.copy.noProjectSourcesTitle,
      description: input.copy.noProjectSourcesDescription,
    };
  }
  return {
    kind: "no-matches",
    title: input.copy.noMatchingWorkTitle,
    description: input.copy.noMatchingWorkDescription,
  };
}

function getDefaultStorage(): SidebarStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Returns `null` when no persisted selection exists yet (meaning "follow available projects" or
 * empty if none exist), or an explicit array of selected project keys (`JSON.stringify([envId, projectId])`).
 */
export function readSelectedTaskProjectKeys(
  storage: SidebarStorageLike | null = getDefaultStorage(),
): readonly string[] | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(TASKS_SELECTED_PROJECTS_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return null;
  }
}

export function writeSelectedTaskProjectKeys(
  keys: readonly string[],
  storage: SidebarStorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(TASKS_SELECTED_PROJECTS_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Ignore storage quota / private mode errors.
  }
}

export function normalizeSelectedTaskProjectKeys(
  availableKeys: readonly string[],
  persistedKeys: readonly string[] | null,
): readonly string[] {
  if (availableKeys.length === 0) return [];
  const availableSet = new Set(availableKeys);
  if (persistedKeys === null) {
    return [...availableKeys];
  }
  return persistedKeys.filter((key) => availableSet.has(key));
}

export function formatRelativeTaskTime(
  isoDate: string | null | undefined,
  isZh: boolean,
  nowMs: number = Date.now(),
): string {
  if (!isoDate) return "—";
  const parsedMs = Date.parse(isoDate);
  if (!Number.isFinite(parsedMs)) return "—";
  const diffSec = Math.max(0, Math.floor((nowMs - parsedMs) / 1000));
  if (diffSec < 60) return isZh ? "刚刚" : "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return isZh ? `${diffMin} 分钟前` : `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return isZh ? `${diffHr} 小时前` : `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return isZh ? `${diffDay} 天前` : `${diffDay}d ago`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo < 12) return isZh ? `${diffMo} 个月前` : `${diffMo}mo ago`;
  const diffYr = Math.floor(diffDay / 365);
  return isZh ? `${diffYr} 年前` : `${diffYr}y ago`;
}
