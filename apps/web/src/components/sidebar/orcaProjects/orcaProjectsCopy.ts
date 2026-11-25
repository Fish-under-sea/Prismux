import { useLocale } from "gt-react";
import { getActiveLocale } from "../../../i18n/messages";
import type { OrcaActivityGroupBy, OrcaActivityStatusBucket } from "./orcaProjects.logic";

export interface OrcaProjectsCopy {
  readonly isZh: boolean;
  readonly projectsTitle: string;
  readonly expandProjectsSection: string;
  readonly collapseProjectsSection: string;
  readonly expandAllProjects: string;
  readonly collapseAllProjects: string;
  readonly openActivityView: string;
  readonly closeActivityView: string;
  readonly railNotificationsTooltip: string;
  readonly railCloseNotificationsTooltip: string;
  readonly activityFilterPlaceholder: string;
  readonly activitySearchAriaLabel: string;
  readonly clearSearch: string;
  readonly noActivityMatches: string;
  readonly resetFilters: string;
  readonly filtersSection: string;
  readonly showUnreadOnly: string;
  readonly showChildAgents: string;
  readonly hideAutomationCreated: string;
  readonly hideCliCreated: string;
  readonly viewSection: string;
  readonly groupAgentActivityBy: string;
  readonly groupByLabels: Readonly<Record<OrcaActivityGroupBy, string>>;
  readonly statusBucketLabels: Readonly<Record<OrcaActivityStatusBucket, string>>;
  readonly recentActivityHeading: string;
  readonly compactMode: string;
  readonly showSearch: string;
  readonly markAllRead: string;
  readonly clearCompleted: string;
  readonly optionsTooltip: string;
  readonly optionsTooltipCount: (count: number) => string;
  readonly addProjectTitle: string;
  readonly projectHostLabel: string;
  readonly connectedStatus: string;
  readonly disconnectedStatus: string;
  readonly browseFolder: string;
  readonly cloneFromUrl: string;
  readonly createNewProject: string;
  readonly cloneDialogTitle: string;
  readonly cloneDialogDescription: (host: string) => string;
  readonly gitUrlLabel: string;
  readonly gitUrlPlaceholder: string;
  readonly parentFolderLabel: string;
  readonly parentFolderPlaceholder: string;
  readonly chooseFolder: string;
  readonly cloneTargetPreview: string;
  readonly cloneAction: string;
  readonly cloningAction: string;
  readonly cloneUrlEmptyError: string;
  readonly cloneUrlInvalidError: string;
  readonly createProjectDialogTitle: string;
  readonly createProjectDialogDescription: (host: string) => string;
  readonly projectNameLabel: string;
  readonly projectNamePlaceholder: string;
  readonly createProjectAction: string;
  readonly creatingProjectAction: string;
  readonly projectNameEmptyError: string;
  readonly projectNameInvalidError: string;
  readonly browseFolderDialogTitle: string;
  readonly browseFolderDialogDescription: (host: string) => string;
  readonly folderPathLabel: string;
  readonly folderPathPlaceholder: string;
  readonly addFolderAction: string;
  readonly cancel: string;
  readonly newWorkspaceTooltip: string;
  readonly createWorkspaceTitle: string;
  readonly projectLabel: string;
  readonly noProjectOption: string;
  readonly runOnLabel: string;
  readonly workspaceNameLabel: string;
  readonly optionalTag: string;
  readonly workspaceNamePlaceholder: string;
  readonly addEmojiTooltip: string;
  readonly emojiSearchPlaceholder: string;
  readonly agentLabel: string;
  readonly configureAgentsTooltip: string;
  readonly defaultAgentOption: string;
  readonly advancedLabel: string;
  readonly workspaceModeLabel: string;
  readonly workspaceModeLocal: string;
  readonly workspaceModeWorktree: string;
  readonly defaultBranchLabel: string;
  readonly defaultBranchPlaceholder: string;
  readonly initialPromptLabel: string;
  readonly initialPromptPlaceholder: string;
  readonly createMoreLabel: string;
  readonly createButtonLabel: string;
  readonly creatingButtonLabel: string;
  readonly markedAllReadToast: (count: number) => string;
  readonly clearedCompletedToast: (count: number) => string;
  readonly workspaceCreatedToast: (title: string) => string;
  readonly environmentUnavailable: string;
  readonly unreadBadge: string;
  readonly markReadAction: string;
  readonly primaryWorkspaceBadge: string;
  readonly openWorkspaceFilesTooltip: string;
  readonly toggleHostGroupTooltip: string;
}

const ZH_COPY: OrcaProjectsCopy = {
  isZh: true,
  projectsTitle: "项目",
  expandProjectsSection: "展开项目",
  collapseProjectsSection: "折叠项目",
  expandAllProjects: "展开所有项目",
  collapseAllProjects: "折叠所有项目",
  openActivityView: "查看代理活动",
  closeActivityView: "关闭代理活动视图",
  railNotificationsTooltip: "通知",
  railCloseNotificationsTooltip: "关闭通知",
  activityFilterPlaceholder: "筛选...",
  activitySearchAriaLabel: "筛选代理活动",
  clearSearch: "清空筛选",
  noActivityMatches: "没有代理活动与这些筛选条件匹配",
  resetFilters: "重置筛选条件",
  filtersSection: "筛选",
  showUnreadOnly: "仅显示未读",
  showChildAgents: "显示子代理",
  hideAutomationCreated: "隐藏自动化创建的工作区",
  hideCliCreated: "隐藏 CLI 创建的工作区",
  viewSection: "视图",
  groupAgentActivityBy: "对代理活动进行分组",
  groupByLabels: {
    status: "状态",
    project: "项目",
    recent: "最近活动",
  },
  statusBucketLabels: {
    attention: "等待处理",
    working: "进行中",
    unread: "未读",
    failed: "失败",
    completed: "已完成",
  },
  recentActivityHeading: "最近活动",
  compactMode: "紧凑模式",
  showSearch: "显示搜索",
  markAllRead: "标记全部已读",
  clearCompleted: "清除已完成",
  optionsTooltip: "筛选与视图选项",
  optionsTooltipCount: (count) => `筛选与视图选项（已启用 ${count} 项筛选）`,
  addProjectTitle: "添加项目",
  projectHostLabel: "目标运行环境",
  connectedStatus: "已连接",
  disconnectedStatus: "未连接",
  browseFolder: "浏览文件夹...",
  cloneFromUrl: "从 URL 克隆...",
  createNewProject: "创建新项目...",
  cloneDialogTitle: "从 URL 克隆项目",
  cloneDialogDescription: (host) => `输入 Git 仓库地址并选择在 ${host} 上的克隆位置。`,
  gitUrlLabel: "Git URL",
  gitUrlPlaceholder: "https://github.com/owner/repo.git 或 owner/repo",
  parentFolderLabel: "目标目录",
  parentFolderPlaceholder: "留空则使用默认项目目录",
  chooseFolder: "选择文件夹",
  cloneTargetPreview: "将克隆至",
  cloneAction: "开始克隆",
  cloningAction: "克隆中...",
  cloneUrlEmptyError: "请输入有效的 Git 仓库 URL。",
  cloneUrlInvalidError: "无法识别的 Git 地址格式，支持 HTTPS、SSH 或 owner/repo。",
  createProjectDialogTitle: "创建新项目",
  createProjectDialogDescription: (host) => `在 ${host} 创建新项目目录并初始化工作区。`,
  projectNameLabel: "项目名称",
  projectNamePlaceholder: "my-project",
  createProjectAction: "创建项目",
  creatingProjectAction: "创建中...",
  projectNameEmptyError: "请输入项目名称。",
  projectNameInvalidError: "项目名称不能包含路径分隔符或特殊非法字符。",
  browseFolderDialogTitle: "添加本地文件夹",
  browseFolderDialogDescription: (host) => `请输入 ${host} 上已存在项目的完整目录路径。`,
  folderPathLabel: "文件夹路径",
  folderPathPlaceholder: "D:\\Projects\\my-app",
  addFolderAction: "添加项目",
  cancel: "取消",
  newWorkspaceTooltip: "新工作区",
  createWorkspaceTitle: "创建工作区",
  projectLabel: "项目",
  noProjectOption: "无项目",
  runOnLabel: "运行于",
  workspaceNameLabel: "工作区名称",
  optionalTag: "[可选]",
  workspaceNamePlaceholder: "输入工作区名称...",
  addEmojiTooltip: "添加表情符号",
  emojiSearchPlaceholder: "搜索表情...",
  agentLabel: "代理",
  configureAgentsTooltip: "配置代理提供方",
  defaultAgentOption: "跟随项目默认代理",
  advancedLabel: "高级",
  workspaceModeLabel: "工作区模式",
  workspaceModeLocal: "本地目录",
  workspaceModeWorktree: "独立 Git Worktree",
  defaultBranchLabel: "默认分支",
  defaultBranchPlaceholder: "自动跟随项目默认分支（如 main）",
  initialPromptLabel: "初始提示词",
  initialPromptPlaceholder: "可选：创建后自动预填到输入框的任务说明...",
  createMoreLabel: "创建更多",
  createButtonLabel: "创建",
  creatingButtonLabel: "创建中...",
  markedAllReadToast: (count) => `已将 ${count} 条活动标记为已读`,
  clearedCompletedToast: (count) => `已清除 ${count} 条已完成会话`,
  workspaceCreatedToast: (title) => `已创建工作区「${title}」`,
  environmentUnavailable: "当前所选运行环境未连接，请先检查环境连接状态。",
  unreadBadge: "未读",
  markReadAction: "标记已读",
  primaryWorkspaceBadge: "主工作区",
  openWorkspaceFilesTooltip: "查看工作区文件与变更",
  toggleHostGroupTooltip: "折叠或展开宿主机分组",
};

const EN_COPY: OrcaProjectsCopy = {
  isZh: false,
  projectsTitle: "Projects",
  expandProjectsSection: "Expand Projects",
  collapseProjectsSection: "Collapse Projects",
  expandAllProjects: "Expand all projects",
  collapseAllProjects: "Collapse all projects",
  openActivityView: "View activity",
  closeActivityView: "Turn off activity view",
  railNotificationsTooltip: "Notifications",
  railCloseNotificationsTooltip: "Close notifications",
  activityFilterPlaceholder: "Filter...",
  activitySearchAriaLabel: "Filter agent activity",
  clearSearch: "Clear filter",
  noActivityMatches: "No agent activity matches these filters.",
  resetFilters: "Reset filters",
  filtersSection: "Filters",
  showUnreadOnly: "Show unread only",
  showChildAgents: "Show child agents",
  hideAutomationCreated: "Hide automation-created workspaces",
  hideCliCreated: "Hide CLI-created workspaces",
  viewSection: "View",
  groupAgentActivityBy: "Group agent activity by",
  groupByLabels: {
    status: "Status",
    project: "Project",
    recent: "Recent",
  },
  statusBucketLabels: {
    attention: "Needs You",
    working: "Working",
    unread: "Unread",
    failed: "Failed",
    completed: "Completed",
  },
  recentActivityHeading: "Recent activity",
  compactMode: "Compact mode",
  showSearch: "Show search",
  markAllRead: "Mark all read",
  clearCompleted: "Clear completed",
  optionsTooltip: "Filter & view options",
  optionsTooltipCount: (count) =>
    count === 1 ? "Filter & view options (1 filter)" : `Filter & view options (${count} filters)`,
  addProjectTitle: "Add project",
  projectHostLabel: "Project host",
  connectedStatus: "Connected",
  disconnectedStatus: "Disconnected",
  browseFolder: "Browse folder…",
  cloneFromUrl: "Clone from URL…",
  createNewProject: "Create new project…",
  cloneDialogTitle: "Clone from URL",
  cloneDialogDescription: (host) => `Enter a Git URL and choose where to clone it on ${host}.`,
  gitUrlLabel: "Git URL",
  gitUrlPlaceholder: "https://github.com/owner/repo.git or owner/repo",
  parentFolderLabel: "Destination folder",
  parentFolderPlaceholder: "Leave blank to use default projects directory",
  chooseFolder: "Choose folder",
  cloneTargetPreview: "Will clone to",
  cloneAction: "Clone",
  cloningAction: "Cloning…",
  cloneUrlEmptyError: "Please enter a Git repository URL.",
  cloneUrlInvalidError: "Invalid Git URL. Supports HTTPS, SSH, or owner/repo.",
  createProjectDialogTitle: "Create new project",
  createProjectDialogDescription: (host) =>
    `Create and initialize a new project directory on ${host}.`,
  projectNameLabel: "Project name",
  projectNamePlaceholder: "my-project",
  createProjectAction: "Create project",
  creatingProjectAction: "Creating…",
  projectNameEmptyError: "Please enter a project name.",
  projectNameInvalidError: "Project name cannot include path separators or reserved characters.",
  browseFolderDialogTitle: "Add local folder",
  browseFolderDialogDescription: (host) => `Enter the full folder path on ${host}.`,
  folderPathLabel: "Folder path",
  folderPathPlaceholder: "/path/to/my-project",
  addFolderAction: "Add project",
  cancel: "Cancel",
  newWorkspaceTooltip: "New workspace",
  createWorkspaceTitle: "Create workspace",
  projectLabel: "Project",
  noProjectOption: "No project",
  runOnLabel: "Run on",
  workspaceNameLabel: "Workspace name",
  optionalTag: "[Optional]",
  workspaceNamePlaceholder: "Enter workspace name…",
  addEmojiTooltip: "Add emoji",
  emojiSearchPlaceholder: "Filter emojis…",
  agentLabel: "Agent",
  configureAgentsTooltip: "Configure agents",
  defaultAgentOption: "Use project default agent",
  advancedLabel: "Advanced",
  workspaceModeLabel: "Workspace mode",
  workspaceModeLocal: "Local folder",
  workspaceModeWorktree: "Isolated Git worktree",
  defaultBranchLabel: "Default branch",
  defaultBranchPlaceholder: "Follow project default branch (e.g. main)",
  initialPromptLabel: "Initial prompt",
  initialPromptPlaceholder: "Optional: prefill initial prompt in the composer…",
  createMoreLabel: "Create more",
  createButtonLabel: "Create",
  creatingButtonLabel: "Creating…",
  markedAllReadToast: (count) =>
    count === 1 ? "Marked 1 activity as read" : `Marked ${count} activities as read`,
  clearedCompletedToast: (count) =>
    count === 1 ? "Cleared 1 completed thread" : `Cleared ${count} completed threads`,
  workspaceCreatedToast: (title) => `Created workspace "${title}"`,
  environmentUnavailable: "The selected environment is not connected.",
  unreadBadge: "Unread",
  markReadAction: "Mark as read",
  primaryWorkspaceBadge: "primary",
  openWorkspaceFilesTooltip: "Inspect workspace files",
  toggleHostGroupTooltip: "Toggle host group",
};

export function getOrcaProjectsCopy(locale: string | null | undefined): OrcaProjectsCopy {
  const normalized = (locale ?? getActiveLocale() ?? "en").toLowerCase();
  return normalized.startsWith("zh") ? ZH_COPY : EN_COPY;
}

export function useOrcaProjectsCopy(): OrcaProjectsCopy {
  const locale = useLocale();
  return getOrcaProjectsCopy(locale);
}
