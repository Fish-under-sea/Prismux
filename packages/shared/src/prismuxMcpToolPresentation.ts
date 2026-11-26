export type PrismuxMcpToolLogo = "prismux";

export interface PrismuxMcpToolPresentation {
  readonly displayName: string;
  readonly logo: PrismuxMcpToolLogo;
}

export type PrismuxMcpToolSummaryAction =
  | "capabilities"
  | "delegate"
  | "task-status"
  | "task-cancel"
  | "schedule-run"
  | "schedule-create"
  | "schedule-list"
  | "schedule-update"
  | "schedule-delete"
  | "thread-create"
  | "thread-list"
  | "thread-read"
  | "thread-send"
  | "thread-wait"
  | "thread-interrupt"
  | "workflow-stop"
  | "background-wait"
  | "thread-configuration"
  | "thread-configure"
  | "thread-fork"
  | "thread-merge"
  | "thread-search"
  | "thread-transfers"
  | "thread-organize"
  | "thread-update"
  | "queue-list"
  | "queue-read"
  | "queue-edit"
  | "queue-cancel"
  | "queue-reorder"
  | "queue-steer"
  | "question-list"
  | "question-read"
  | "question-respond"
  | "secret-request"
  | "worktree-handoff"
  | "worktree-list"
  | "worktree-status"
  | "project-list"
  | "project-read"
  | "project-create"
  | "project-update"
  | "project-delete"
  | "project-clone"
  | "environment-read"
  | "environment-links"
  | "environment-link"
  | "environment-unlink"
  | "environment-update"
  | "theme-read"
  | "theme-set"
  | "attachment-prepare"
  | "attachment-discard"
  | "attachment-send"
  | "link-pr"
  | "unlink-pr"
  | "list-prs"
  | "watch-pr"
  | "unwatch-pr"
  | "write-pr-guides"
  | "read-pr-guide"
  | "list-issues"
  | "read-issue"
  | "create-issue"
  | "comment-issue"
  | "set-issue-state"
  | "link-issue"
  | "unlink-issue"
  | "list-thread-issues"
  | "read-pr"
  | "list-repo-prs"
  | "create-pr"
  | "update-pr"
  | "respond-pr"
  | "merge-pr"
  | "review-pr"
  | "ci-logs"
  | "ci-rerun"
  | "browser"
  | "device"
  | "html-preview"
  | "html-render"
  | "send-to-user";

export interface PrismuxMcpToolDefinition {
  readonly displayName: string;
  readonly labels: readonly [action: string, running: string, completed: string, detail: string];
  readonly icon: "prismux" | "browser" | "device" | "pull-request";
  readonly summaryAction: PrismuxMcpToolSummaryAction;
}

function tool(
  labels: PrismuxMcpToolDefinition["labels"],
  summaryAction: PrismuxMcpToolSummaryAction,
  icon: PrismuxMcpToolDefinition["icon"] = "prismux",
  displayName = `${labels[0]} ${labels[3]}`,
): PrismuxMcpToolDefinition {
  return { displayName, labels, icon, summaryAction };
}

// Codex registers "prismux-direct" for Prismux tools kept out of Code Mode.
// Legacy aliases remain read-only so pre-v0.2.3-rc.3 SQLite history rows still normalize cleanly.
const PRISMUX_MCP_SERVER_ALIASES = new Set([
  "prismux",
  "prismux-direct",
  "prismux_direct",
  "t3-code",
  "t3_code",
  "t3-code-direct",
  "t3_code_direct",
]);

const PRISMUX_MCP_TOOLS: Readonly<Record<string, PrismuxMcpToolDefinition>> = {
  link_pull_request: tool(
    ["Link", "Linking", "Linked", "a pull request"],
    "link-pr",
    "pull-request",
  ),
  link_pull_requests: tool(
    ["Link", "Linking", "Linked", "pull requests"],
    "link-pr",
    "pull-request",
  ),
  unlink_pull_request: tool(
    ["Unlink", "Unlinking", "Unlinked", "a pull request"],
    "unlink-pr",
    "pull-request",
  ),
  unlink_pull_requests: tool(
    ["Unlink", "Unlinking", "Unlinked", "pull requests by state"],
    "unlink-pr",
    "pull-request",
  ),
  list_thread_pull_requests: tool(
    ["Check", "Checking", "Checked", "linked pull requests"],
    "list-prs",
    "pull-request",
  ),
  watch_pull_request: tool(
    ["Watch", "Watching", "Watching", "a pull request"],
    "watch-pr",
    "pull-request",
  ),
  unwatch_pull_request: tool(
    ["Stop watching", "Unwatching", "Stopped watching", "a pull request"],
    "unwatch-pr",
    "pull-request",
  ),
  write_pull_request_guides: tool(
    ["Write", "Writing", "Started writing", "review guides"],
    "write-pr-guides",
    "pull-request",
  ),
  read_pull_request_guide: tool(
    ["Read", "Reading", "Read", "a review guide"],
    "read-pr-guide",
    "pull-request",
  ),
  list_issues: tool(["List", "Listing", "Listed", "issues"], "list-issues"),
  read_issue: tool(["Read", "Reading", "Read", "an issue"], "read-issue"),
  create_issue: tool(["File", "Filing", "Filed", "an issue"], "create-issue"),
  comment_on_issue: tool(
    ["Comment on", "Commenting on", "Commented on", "an issue"],
    "comment-issue",
  ),
  set_issue_state: tool(["Change", "Changing", "Changed", "an issue's state"], "set-issue-state"),
  link_issue: tool(["Link", "Linking", "Linked", "an issue"], "link-issue"),
  unlink_issue: tool(["Unlink", "Unlinking", "Unlinked", "an issue"], "unlink-issue"),
  list_thread_issues: tool(["Check", "Checking", "Checked", "linked issues"], "list-thread-issues"),
  pull_request_read: tool(["Read", "Reading", "Read", "a pull request"], "read-pr", "pull-request"),
  pull_request_list: tool(
    ["List", "Listing", "Listed", "pull requests"],
    "list-repo-prs",
    "pull-request",
  ),
  pull_request_create: tool(
    ["Open", "Opening", "Opened", "a pull request"],
    "create-pr",
    "pull-request",
  ),
  pull_request_update: tool(
    ["Update", "Updating", "Updated", "a pull request"],
    "update-pr",
    "pull-request",
  ),
  pull_request_respond: tool(
    ["Respond", "Responding", "Responded", "on a pull request"],
    "respond-pr",
    "pull-request",
  ),
  pull_request_review: tool(
    ["Review", "Reviewing", "Reviewed", "a pull request"],
    "review-pr",
    "pull-request",
  ),
  ci_logs: tool(["Read", "Reading", "Read", "CI logs"], "ci-logs", "pull-request"),
  ci_rerun: tool(["Re-run", "Re-running", "Re-ran", "CI"], "ci-rerun", "pull-request"),
  pull_request_merge: tool(
    ["Merge", "Merging", "Merged", "a pull request"],
    "merge-pr",
    "pull-request",
  ),
  orchestrator_capabilities: tool(
    ["Get", "Getting", "Got", "orchestration capabilities"],
    "capabilities",
  ),
  delegate_task: tool(["Delegate", "Delegating", "Delegated", "a child task"], "delegate"),
  task_status: tool(["Get", "Getting", "Got", "delegated task status"], "task-status"),
  task_cancel: tool(
    ["Cancel", "Canceling", "Requested cancellation of", "a delegated task"],
    "task-cancel",
  ),
  schedule_task: tool(["Schedule", "Scheduling", "Scheduled", "a task"], "schedule-create"),
  list_scheduled_tasks: tool(["List", "Listing", "Listed", "scheduled tasks"], "schedule-list"),
  update_scheduled_task: tool(
    ["Update", "Updating", "Updated", "a scheduled task"],
    "schedule-update",
  ),
  delete_scheduled_task: tool(
    ["Delete", "Deleting", "Requested deletion of", "a scheduled task"],
    "schedule-delete",
  ),
  request_secret: tool(["Ask for", "Asking for", "Asked for", "a secret"], "secret-request"),
  create_threads: tool(["Create", "Creating", "Created", "Prismux threads"], "thread-create"),
  prismux_thread_start: tool(["Start", "Starting", "Started", "a Prismux thread"], "thread-create"),
  prismux_thread_list: tool(["List", "Listing", "Listed", "Prismux threads"], "thread-list"),
  prismux_thread_read: tool(["Read", "Reading", "Read", "a Prismux thread"], "thread-read"),
  prismux_thread_send: tool(["Send", "Sending", "Sent", "to a Prismux thread"], "thread-send"),
  prismux_thread_wait: tool(["Wait", "Waiting", "Waited", "for a Prismux thread"], "thread-wait"),
  prismux_workflow_stop: tool(
    ["Stop", "Stopping", "Requested a stop for", "a workflow"],
    "workflow-stop",
  ),
  prismux_background_wait: tool(
    ["Update", "Updating", "Updated", "background waits"],
    "background-wait",
  ),
  prismux_thread_interrupt: tool(
    ["Interrupt", "Interrupting", "Requested an interrupt of", "a Prismux thread"],
    "thread-interrupt",
  ),
  prismux_worktree_handoff: tool(
    ["Hand off", "Handing off", "Handed off", "thread to a git worktree"],
    "worktree-handoff",
  ),
  prismux_worktree_status: tool(
    ["Get", "Getting", "Got", "thread worktree status"],
    "worktree-status",
  ),
  preview_status: tool(["Get", "Getting", "Got", "preview browser status"], "browser", "browser"),
  preview_open: tool(
    ["Open", "Opening", "Opened", "a page in the preview browser"],
    "browser",
    "browser",
  ),
  preview_navigate: tool(
    ["Navigate", "Navigating", "Navigated", "the preview browser"],
    "browser",
    "browser",
  ),
  preview_dialog: tool(
    ["Respond", "Responding", "Responded", "to a preview browser dialog"],
    "browser",
    "browser",
  ),
  preview_snapshot: tool(
    ["Take a snapshot of", "Taking a snapshot of", "Took a snapshot of", "the preview page"],
    "browser",
    "browser",
    "Snapshot the preview page",
  ),
  preview_act: tool(["Use", "Using", "Used", "the preview browser"], "browser", "browser"),
  preview_click: tool(
    ["Click", "Clicking", "Clicked", "in the preview browser"],
    "browser",
    "browser",
  ),
  preview_press: tool(
    ["Press", "Pressing", "Pressed", "a key in the preview browser"],
    "browser",
    "browser",
  ),
  preview_type: tool(["Type", "Typing", "Typed", "in the preview browser"], "browser", "browser"),
  preview_hover: tool(
    ["Hover", "Hovering", "Hovered", "in the preview browser"],
    "browser",
    "browser",
  ),
  preview_select: tool(
    ["Choose", "Choosing", "Chose", "an option in the preview browser"],
    "browser",
    "browser",
  ),
  preview_drag: tool(
    ["Drag", "Dragging", "Dragged", "in the preview browser"],
    "browser",
    "browser",
  ),
  preview_upload: tool(
    ["Upload", "Uploading", "Uploaded", "files to the preview browser"],
    "browser",
    "browser",
  ),
  preview_scroll: tool(
    ["Scroll", "Scrolling", "Scrolled", "the preview browser"],
    "browser",
    "browser",
  ),
  preview_resize: tool(
    ["Resize", "Resizing", "Resized", "the preview browser"],
    "browser",
    "browser",
  ),
  preview_evaluate: tool(
    ["Evaluate", "Evaluating", "Evaluated", "script in the preview browser"],
    "browser",
    "browser",
  ),
  preview_wait_for: tool(
    ["Wait", "Waiting", "Waited", "for the preview page"],
    "browser",
    "browser",
  ),
  preview_set_appearance: tool(
    ["Set", "Setting", "Set", "preview browser appearance"],
    "browser",
    "browser",
  ),
  preview_recording_start: tool(
    ["Start", "Starting", "Started", "recording the preview browser"],
    "browser",
    "browser",
  ),
  preview_recording_stop: tool(
    ["Stop", "Stopping", "Stopped", "recording the preview browser"],
    "browser",
    "browser",
  ),
  device_list: tool(["List", "Listing", "Listed", "simulators and emulators"], "device", "device"),
  device_open: tool(
    ["Open", "Opening", "Opened", "a device in the Device panel"],
    "device",
    "device",
  ),
  device_screenshot: tool(
    ["Take a screenshot of", "Taking a screenshot of", "Took a screenshot of", "the device"],
    "device",
    "device",
  ),
  device_close: tool(["Close", "Closing", "Closed", "a device"], "device", "device"),
  run_scheduled_task_now: tool(
    ["Run", "Running", "Requested a run of", "a scheduled task"],
    "schedule-run",
  ),
  prismux_queue: tool(["Manage", "Managing", "Managed", "queued messages"], "queue-edit"),
  prismux_pending_request: tool(
    ["Handle", "Handling", "Handled", "pending questions"],
    "question-respond",
  ),
  prismux_submit_output: tool(["Submit", "Submitting", "Submitted", "the result"], "thread-send"),
  prismux_queue_list: tool(["List", "Listing", "Listed", "queued messages"], "queue-list"),
  prismux_queue_read: tool(["Read", "Reading", "Read", "a queued message"], "queue-read"),
  prismux_queue_edit: tool(["Edit", "Editing", "Edited", "a queued message"], "queue-edit"),
  prismux_queue_cancel: tool(
    ["Cancel", "Canceling", "Requested cancellation of", "a queued run"],
    "queue-cancel",
  ),
  prismux_queue_reorder: tool(["Reorder", "Reordering", "Reordered", "a queued run"], "queue-reorder"),
  prismux_queue_promote_to_steer: tool(
    ["Steer with", "Steering with", "Requested steering with", "a queued message"],
    "queue-steer",
  ),
  prismux_pending_request_list: tool(
    ["List", "Listing", "Listed", "pending questions"],
    "question-list",
  ),
  prismux_pending_request_read: tool(
    ["Read", "Reading", "Read", "pending questions"],
    "question-read",
  ),
  prismux_pending_request_respond: tool(
    ["Answer", "Answering", "Answered", "pending questions"],
    "question-respond",
  ),
  prismux_thread_configuration: tool(
    ["Read", "Reading", "Read", "thread configuration"],
    "thread-configuration",
  ),
  prismux_thread_configure: tool(
    ["Use", "Using", "Used", "thread model settings"],
    "thread-configure",
  ),
  prismux_thread_transfer: tool(["Use", "Using", "Used", "thread transfers"], "thread-fork"),
  prismux_thread_fork: tool(
    ["Fork", "Forking", "Requested a fork of", "this thread"],
    "thread-fork",
  ),
  prismux_thread_merge_back: tool(
    ["Merge", "Merging", "Requested a merge of", "thread context"],
    "thread-merge",
  ),
  prismux_thread_search: tool(
    ["Search", "Searching", "Searched", "thread content"],
    "thread-search",
  ),
  prismux_thread_transfers: tool(
    ["Read", "Reading", "Read", "thread transfers"],
    "thread-transfers",
  ),
  prismux_thread_organize: tool(
    ["Organize", "Organizing", "Organized", "a thread"],
    "thread-organize",
  ),
  prismux_thread_update: tool(
    ["Update", "Updating", "Updated", "Prismux thread metadata"],
    "thread-update",
  ),
  prismux_worktree_list: tool(
    ["List", "Listing", "Listed", "workspace branches"],
    "worktree-list",
  ),
  prismux_preview_list: tool(["List", "Listing", "Listed", "preview tabs"], "browser", "browser"),
  prismux_preview_close: tool(
    ["Close", "Closing", "Closed", "a preview tab"],
    "browser",
    "browser",
  ),
  prismux_environment_read: tool(
    ["Read", "Reading", "Read", "environment preferences"],
    "environment-read",
  ),
  prismux_environment_links: tool(
    ["List", "Listing", "Listed", "linked environments"],
    "environment-links",
  ),
  prismux_environment_link: tool(
    ["Ask to link", "Asking to link", "Asked to link", "an environment"],
    "environment-link",
  ),
  prismux_environment_unlink: tool(
    ["Forget", "Forgetting", "Forgot", "a linked environment"],
    "environment-unlink",
  ),
  prismux_environment_preferences_update: tool(
    ["Update", "Updating", "Updated", "environment preferences"],
    "environment-update",
  ),
  prismux_theme_read: tool(["Read", "Reading", "Read", "themes"], "theme-read"),
  prismux_theme_set: tool(["Set", "Setting", "Set", "the theme"], "theme-set"),
  prismux_thread_launch: tool(
    ["Launch", "Launching", "Launched", "a project thread"],
    "thread-create",
  ),
  prismux_project_list: tool(["List", "Listing", "Listed", "projects"], "project-list"),
  prismux_project_read: tool(["Read", "Reading", "Read", "a project"], "project-read"),
  prismux_project_create: tool(["Register", "Registering", "Registered", "a project"], "project-create"),
  prismux_project_update: tool(["Update", "Updating", "Updated", "a project"], "project-update"),
  prismux_project_delete: tool(["Delete", "Deleting", "Deleted", "a project"], "project-delete"),
  prismux_project_clone: tool(["Clone", "Cloning", "Cloned", "a repository"], "project-clone"),
  prismux_attachment_prepare_upload: tool(
    ["Prepare", "Preparing", "Prepared", "an attachment upload"],
    "attachment-prepare",
  ),
  prismux_attachment_discard: tool(
    ["Discard", "Discarding", "Discarded", "a pending attachment"],
    "attachment-discard",
  ),
  prismux_thread_send_attachments: tool(
    ["Send", "Sending", "Sent", "attachments"],
    "attachment-send",
  ),
  html_preview: tool(["Preview", "Previewing", "Previewed", "an HTML page"], "html-preview"),
  html_render: tool(["Render", "Rendering", "Rendered", "an HTML page"], "html-render"),
  send_to_user: tool(["Send", "Sending", "Sent", "a message"], "send-to-user"),
};

export const PRISMUX_MCP_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(PRISMUX_MCP_TOOLS));

function normalizeLegacyPrismuxToolId(candidate: string): string {
  if (/^t3_/i.test(candidate)) {
    const mapped = `prismux_${candidate.slice(3)}`;
    if (Object.hasOwn(PRISMUX_MCP_TOOLS, mapped)) return mapped;
  }
  return candidate;
}

function normalizeLegacyToolIdUnderPrismuxServer(toolName: string): string {
  return /^t3_/i.test(toolName) ? `prismux_${toolName.slice(3)}` : toolName;
}

function normalizeLegacyServerName(server: string): string {
  const lower = server.toLowerCase();
  if (lower === "t3-code" || lower === "t3_code") return "prismux";
  if (lower === "t3-code-direct" || lower === "t3_code_direct") return "prismux-direct";
  return server;
}

/**
 * Normalizes raw MCP tool identifiers for UI display so historical SQLite messages
 * stored with pre-v0.2.3-rc.3 `t3-code` / `t3_*` names render cleanly as `prismux`.
 */
export function formatPrismuxMcpToolDisplayName(toolName: string): string {
  const trimmed = toolName.trim();
  if (trimmed.length === 0) return toolName;

  const mcpMatch = /^mcp__(?<server>.+?)__(?<tool>.+)$/i.exec(trimmed);
  if (mcpMatch?.groups?.server && mcpMatch.groups.tool) {
    const { server, tool: rawTool } = mcpMatch.groups;
    if (PRISMUX_MCP_SERVER_ALIASES.has(server.toLowerCase())) {
      const normalizedServer = normalizeLegacyServerName(server);
      const normalizedTool = normalizeLegacyToolIdUnderPrismuxServer(rawTool);
      return `mcp__${normalizedServer}__${normalizedTool}`;
    }
  }

  const namespaceMatch =
    /^(?<server>prismux[-_]direct|prismux|t3[-_]code[-_]direct|t3-code|t3_code)(?<sep>[.:/]|\s*·\s*)(?<tool>.+)$/i.exec(
      trimmed,
    );
  if (namespaceMatch?.groups?.server && namespaceMatch.groups.sep && namespaceMatch.groups.tool) {
    const normalizedServer = normalizeLegacyServerName(namespaceMatch.groups.server);
    const normalizedTool = normalizeLegacyToolIdUnderPrismuxServer(namespaceMatch.groups.tool);
    return `${normalizedServer}${namespaceMatch.groups.sep}${normalizedTool}`;
  }

  const threadScopedMatch = /^t3-code-(?<scope>[^_]+)_(?<tool>.+)$/i.exec(trimmed);
  if (threadScopedMatch?.groups?.scope && threadScopedMatch.groups.tool) {
    const normalizedTool = normalizeLegacyToolIdUnderPrismuxServer(threadScopedMatch.groups.tool);
    return `prismux-${threadScopedMatch.groups.scope}_${normalizedTool}`;
  }

  const normalizedBare = normalizeLegacyPrismuxToolId(trimmed);
  if (normalizedBare !== trimmed) return normalizedBare;

  return toolName;
}

function normalizePrismuxMcpToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

// Timelines resolve every work row's tool name on each update; names repeat across updates.
// ACP titles can carry whole commands, so long labels are parsed but not kept.
const toolNameCache = new Map<string, string | null>();
const TOOL_NAME_CACHE_LIMIT = 10_000;
const TOOL_NAME_CACHE_MAX_KEY_LENGTH = 256;

function resolvePrismuxMcpToolName(value: string): string | null {
  if (value.length > TOOL_NAME_CACHE_MAX_KEY_LENGTH) return parsePrismuxMcpToolName(value);
  const cached = toolNameCache.get(value);
  if (cached !== undefined) return cached;
  const name = parsePrismuxMcpToolName(value);
  if (toolNameCache.size >= TOOL_NAME_CACHE_LIMIT) toolNameCache.clear();
  toolNameCache.set(value, name);
  return name;
}

// ACP tool prefixes vary; match loosely but require a known display-name entry.
function parsePrismuxMcpToolName(value: string): string | null {
  const label = normalizePrismuxMcpToolLabel(value);
  const direct = normalizeLegacyPrismuxToolId(label);
  if (Object.hasOwn(PRISMUX_MCP_TOOLS, direct)) return direct;

  const mcpMatch = /^mcp__(?<server>.+?)__(?<tool>.+)$/i.exec(label);
  if (mcpMatch?.groups) {
    const { server, tool } = mcpMatch.groups;
    return server !== undefined &&
      tool !== undefined &&
      PRISMUX_MCP_SERVER_ALIASES.has(server.toLowerCase())
      ? normalizeLegacyPrismuxToolId(tool)
      : null;
  }

  const namespaceMatch =
    /^(?<server>prismux[-_]direct|prismux|t3[-_]code[-_]direct|t3-code|t3_code)(?:[.:/]|\s*·\s*)(?<tool>.+)$/i.exec(
      label,
    );
  if (namespaceMatch?.groups?.tool !== undefined) {
    return normalizeLegacyPrismuxToolId(namespaceMatch.groups.tool);
  }

  const prefixed = /^(?:mcp[-_]{1,2})?(?:prismux|t3[-_ ]?code)(?:__|[-_.:/ ])(?<tool>.+)$/i.exec(
    label,
  );
  const candidate = normalizeLegacyPrismuxToolId(prefixed?.groups?.tool ?? label);
  if (Object.hasOwn(PRISMUX_MCP_TOOLS, candidate)) return candidate;
  // OpenCode 2 thread prefixes can contain underscores; choose the longest known tool-name suffix.
  if (!/^(?:prismux|t3-code)-/i.test(label)) return null;
  let longest: string | null = null;
  for (const toolKey of Object.keys(PRISMUX_MCP_TOOLS)) {
    const legacyKey = toolKey.startsWith("prismux_") ? `t3_${toolKey.slice("prismux_".length)}` : null;
    if (
      (label.endsWith(`_${toolKey}`) || (legacyKey !== null && label.endsWith(`_${legacyKey}`))) &&
      toolKey.length > (longest?.length ?? 0)
    ) {
      longest = toolKey;
    }
  }
  return longest;
}

export function resolvePrismuxMcpToolId(toolName: string | null | undefined): string | null {
  const name = toolName == null ? null : resolvePrismuxMcpToolName(toolName);
  return name !== null && Object.hasOwn(PRISMUX_MCP_TOOLS, name) ? name : null;
}

type SummaryInput = Readonly<Record<string, unknown>>;

const asSummaryInput = (input: unknown): SummaryInput | undefined =>
  typeof input === "object" && input !== null ? (input as SummaryInput) : undefined;

/** Action tools present each call as the single-purpose tool its action replaced. */
const ACTION_TOOLS: Readonly<Record<string, (action: string) => string | undefined>> = {
  preview_act: (action) => `preview_${action}`,
  prismux_queue: (action) => `prismux_queue_${action}`,
  prismux_pending_request: (action) => `prismux_pending_request_${action}`,
  prismux_thread_transfer: (action) =>
    ({
      fork: "prismux_thread_fork",
      merge_back: "prismux_thread_merge_back",
      status: "prismux_thread_transfers",
    })[action],
};

/** Pass the call's input so an action tool resolves to the labels and summary of its action. */
export function resolvePrismuxMcpToolDefinition(
  toolName: string | null | undefined,
  input?: unknown,
): PrismuxMcpToolDefinition | null {
  const name = toolName == null ? null : resolvePrismuxMcpToolName(toolName);
  if (name === null || !Object.hasOwn(PRISMUX_MCP_TOOLS, name)) return null;
  const action = asSummaryInput(input)?.action;
  const actionTool = typeof action === "string" ? ACTION_TOOLS[name]?.(action) : undefined;
  return actionTool !== undefined && Object.hasOwn(PRISMUX_MCP_TOOLS, actionTool)
    ? PRISMUX_MCP_TOOLS[actionTool]!
    : PRISMUX_MCP_TOOLS[name]!;
}

/** Tools whose summary depends on which fields a call sets. */
const ACTION_SUMMARIES: Readonly<
  Record<string, (input: SummaryInput) => PrismuxMcpToolSummaryAction | undefined>
> = {
  prismux_thread_configure: ({ modelSelection }) =>
    modelSelection === undefined ? "thread-configuration" : "thread-configure",
  schedule_task: ({ scheduledTaskId }) =>
    scheduledTaskId === undefined ? "schedule-create" : "schedule-update",
};

export function resolvePrismuxMcpSummaryAction(
  toolName: string | null | undefined,
  input: unknown,
): PrismuxMcpToolSummaryAction | null {
  const definition = resolvePrismuxMcpToolDefinition(toolName, input);
  if (definition === null) return null;
  const summarize = ACTION_SUMMARIES[resolvePrismuxMcpToolName(toolName!) ?? ""];
  const fields = asSummaryInput(input);
  return (fields && summarize?.(fields)) ?? definition.summaryAction;
}

export function resolvePrismuxMcpToolPresentation(
  toolName: string | null | undefined,
  input?: unknown,
): PrismuxMcpToolPresentation | null {
  const definition = resolvePrismuxMcpToolDefinition(toolName, input);
  return definition === null ? null : { displayName: definition.displayName, logo: "prismux" };
}
