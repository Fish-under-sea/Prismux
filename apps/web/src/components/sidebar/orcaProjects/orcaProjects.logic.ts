import type { EnvironmentThreadShell } from "@prismux/client-runtime/state/models";
import { scopeThreadRef, scopedThreadKey } from "@prismux/client-runtime/environment";
import type { ResolvedKeybindingsConfig } from "@prismux/core-contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@prismux/core-shared/keybindings";
import type { DraftThreadEnvMode } from "../../../composerDraftStore";
import { resolveShortcutCommand } from "../../../keybindings";
import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  resolveThreadLastVisitedAt,
  type SidebarThreadStatus,
} from "../../Sidebar.logic";

export interface OrcaStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const ORCA_PROJECTS_PREFS_STORAGE_KEY = "prismux.sidebar.orca-projects-prefs:v1" as const;

export const ORCA_ACTIVITY_GROUP_BY_VALUES = ["status", "project", "recent"] as const;
export type OrcaActivityGroupBy = (typeof ORCA_ACTIVITY_GROUP_BY_VALUES)[number];

export interface OrcaProjectsPrefs {
  readonly unreadOnly: boolean;
  readonly showChildAgents: boolean;
  readonly hideAutomationCreated: boolean;
  readonly hideCliCreated: boolean;
  readonly groupBy: OrcaActivityGroupBy;
  readonly compactMode: boolean;
  readonly showSearch: boolean;
}

export const DEFAULT_ORCA_PROJECTS_PREFS: OrcaProjectsPrefs = {
  unreadOnly: false,
  showChildAgents: false,
  hideAutomationCreated: false,
  hideCliCreated: false,
  groupBy: "status",
  compactMode: false,
  showSearch: true,
};

function getDefaultStorage(): OrcaStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isOrcaActivityGroupBy(value: unknown): value is OrcaActivityGroupBy {
  return (
    typeof value === "string" &&
    (ORCA_ACTIVITY_GROUP_BY_VALUES as readonly string[]).includes(value)
  );
}

export function normalizeOrcaProjectsPrefs(raw: unknown): OrcaProjectsPrefs {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_ORCA_PROJECTS_PREFS;
  }
  const record = raw as Record<string, unknown>;
  return {
    unreadOnly:
      typeof record.unreadOnly === "boolean"
        ? record.unreadOnly
        : DEFAULT_ORCA_PROJECTS_PREFS.unreadOnly,
    showChildAgents:
      typeof record.showChildAgents === "boolean"
        ? record.showChildAgents
        : DEFAULT_ORCA_PROJECTS_PREFS.showChildAgents,
    hideAutomationCreated:
      typeof record.hideAutomationCreated === "boolean"
        ? record.hideAutomationCreated
        : DEFAULT_ORCA_PROJECTS_PREFS.hideAutomationCreated,
    hideCliCreated:
      typeof record.hideCliCreated === "boolean"
        ? record.hideCliCreated
        : DEFAULT_ORCA_PROJECTS_PREFS.hideCliCreated,
    groupBy: isOrcaActivityGroupBy(record.groupBy)
      ? record.groupBy
      : DEFAULT_ORCA_PROJECTS_PREFS.groupBy,
    compactMode:
      typeof record.compactMode === "boolean"
        ? record.compactMode
        : DEFAULT_ORCA_PROJECTS_PREFS.compactMode,
    showSearch:
      typeof record.showSearch === "boolean"
        ? record.showSearch
        : DEFAULT_ORCA_PROJECTS_PREFS.showSearch,
  };
}

export function readOrcaProjectsPrefs(
  storage: OrcaStorageLike | null = getDefaultStorage(),
): OrcaProjectsPrefs {
  if (!storage) return DEFAULT_ORCA_PROJECTS_PREFS;
  try {
    const raw = storage.getItem(ORCA_PROJECTS_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_ORCA_PROJECTS_PREFS;
    return normalizeOrcaProjectsPrefs(JSON.parse(raw));
  } catch {
    return DEFAULT_ORCA_PROJECTS_PREFS;
  }
}

export function writeOrcaProjectsPrefs(
  prefs: OrcaProjectsPrefs,
  storage: OrcaStorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(ORCA_PROJECTS_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota or private browsing errors.
  }
}

/**
 * Counts active restricting filters for the `SlidersHorizontal` options button badge
 * (matches stablyai/orca `activity-thread-options-menu.tsx`).
 */
export function countActiveOrcaFilters(prefs: OrcaProjectsPrefs): number {
  return (
    (prefs.unreadOnly ? 1 : 0) +
    (prefs.hideAutomationCreated ? 1 : 0) +
    (prefs.hideCliCreated ? 1 : 0)
  );
}

// ---------------------------------------------------------------------------
// Global shortcut matchers (Ctrl+Shift+H, Ctrl+N, Ctrl+Enter)
// ---------------------------------------------------------------------------

export interface ShortcutKeyEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly repeat?: boolean;
  readonly defaultPrevented?: boolean;
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as {
    readonly tagName?: string;
    readonly isContentEditable?: boolean;
    readonly getAttribute?: (name: string) => string | null;
    readonly closest?: (selector: string) => Element | null;
  };
  const tag = el.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (el.isContentEditable === true || el.getAttribute?.("contenteditable") === "true") {
    return true;
  }
  if (el.closest?.("[data-terminal-owner], [contenteditable='true'], [role='textbox']")) {
    return true;
  }
  return false;
}

function isMacOSPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * Matches the active keybinding for `sidebar.collapseAllProjects`
 * (defaults to `Ctrl+Shift+H` on Windows/Linux and `Cmd+Shift+H` on macOS).
 */
export function matchCollapseAllProjectsShortcut(
  event: ShortcutKeyEventLike,
  platform = typeof navigator !== "undefined" ? navigator.platform : "Win32",
  keybindings: ResolvedKeybindingsConfig = DEFAULT_RESOLVED_KEYBINDINGS,
): boolean {
  if (event.defaultPrevented || event.repeat) return false;
  return (
    resolveShortcutCommand(event, keybindings, {
      platform,
      context: { terminalFocus: false, previewFocus: false },
    }) === "sidebar.collapseAllProjects"
  );
}

/**
 * Matches the active keybinding for `chat.new` to open the Create Workspace dialog
 * (defaults to `Ctrl+N` / `Ctrl+Shift+O` on Windows/Linux and `Cmd+N` / `Cmd+Shift+O` on macOS).
 */
export function matchCreateWorkspaceShortcut(
  event: ShortcutKeyEventLike,
  platform = typeof navigator !== "undefined" ? navigator.platform : "Win32",
  keybindings: ResolvedKeybindingsConfig = DEFAULT_RESOLVED_KEYBINDINGS,
): boolean {
  if (event.defaultPrevented || event.repeat) return false;
  return (
    resolveShortcutCommand(event, keybindings, {
      platform,
      context: { terminalFocus: false, previewFocus: false },
    }) === "chat.new"
  );
}

/**
 * Matches `Ctrl+Enter` (or `Cmd+Enter` on macOS) to submit the Create Workspace dialog.
 */
export function matchDialogSubmitShortcut(
  event: ShortcutKeyEventLike,
  platform = typeof navigator !== "undefined" ? navigator.platform : "Win32",
): boolean {
  if (event.defaultPrevented || event.repeat) return false;
  if (event.altKey || event.key !== "Enter") return false;
  if (isMacOSPlatform(platform)) {
    return event.metaKey || event.ctrlKey;
  }
  return event.ctrlKey && !event.metaKey;
}

export interface OrcaSidebarShortcutEventLike extends ShortcutKeyEventLike {
  readonly target: EventTarget | null;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation?: () => void;
}

export interface OrcaSidebarShortcutHandlerOptions {
  readonly isCommandPaletteOpen: () => boolean;
  readonly isModelPickerOpen: () => boolean;
  readonly onToggleCollapseAllProjects: () => void;
  readonly onOpenCreateWorkspace: () => void;
  readonly getKeybindings?: () => ResolvedKeybindingsConfig;
  readonly platform?: string;
}

function isInsideTerminalOrModalDialog(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { readonly closest?: (selector: string) => Element | null };
  return Boolean(
    el.closest?.(
      '[data-terminal-owner], [data-keybinding-capture], [role="dialog"], [role="alertdialog"]',
    ),
  );
}

function isMainComposerEditorTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as {
    readonly getAttribute?: (name: string) => string | null;
    readonly closest?: (selector: string) => Element | null;
  };
  if (el.getAttribute?.("data-testid") === "composer-editor") {
    return true;
  }
  return Boolean(el.closest?.('[data-testid="composer-editor"]'));
}

/**
 * Capture-phase keydown handler for Orca sidebar global shortcuts (`Ctrl+Shift+H` & `Ctrl+N`).
 * Returns `true` when consumed (preempting bubble-phase global commands like `chat.new` that
 * otherwise open the command palette) and `false` to let other scopes proceed untouched.
 *
 * Yields whenever a terminal, modal dialog, command palette, model picker, or form input is focused,
 * while permitting `Ctrl+N` / `Ctrl+Shift+H` from the auto-focused main chat composer (matching
 * Prismux's own `mod+n` `!terminalFocus` ergonomics so the chat composer never leaks `Ctrl+N`
 * down to T3's `chat.new` command-dialog).
 */
export function createOrcaSidebarShortcutHandler(
  options: OrcaSidebarShortcutHandlerOptions,
): (event: OrcaSidebarShortcutEventLike) => boolean {
  return (event) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      options.isCommandPaletteOpen() ||
      options.isModelPickerOpen() ||
      isInsideTerminalOrModalDialog(event.target)
    ) {
      return false;
    }
    if (isEditableKeyboardTarget(event.target) && !isMainComposerEditorTarget(event.target)) {
      return false;
    }
    const keybindings = options.getKeybindings?.() ?? DEFAULT_RESOLVED_KEYBINDINGS;
    if (matchCollapseAllProjectsShortcut(event, options.platform, keybindings)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      options.onToggleCollapseAllProjects();
      return true;
    }
    if (matchCreateWorkspaceShortcut(event, options.platform, keybindings)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      options.onOpenCreateWorkspace();
      return true;
    }
    return false;
  };
}

export function areAllProjectsCollapsed(
  folders: ReadonlyArray<{ readonly collapsed: boolean }>,
): boolean {
  return folders.length > 0 && folders.every((folder) => folder.collapsed);
}

/**
 * Computes the next expanded target for `Ctrl+Shift+H` / `↕` toggle:
 * if any folder is currently expanded -> collapse all (`false`);
 * if all folders are currently collapsed -> expand all (`true`).
 */
export function computeCollapseAllProjectsNextExpanded(
  folders: ReadonlyArray<{ readonly collapsed: boolean }>,
): boolean {
  const hasExpanded = folders.some((folder) => !folder.collapsed);
  return !hasExpanded;
}

// ---------------------------------------------------------------------------
// Thread provenance, activity classification, filtering & grouping
// ---------------------------------------------------------------------------

export type OrcaThreadProvenanceInput = Pick<
  EnvironmentThreadShell,
  "title" | "branch" | "lineage" | "delegatedFrom" | "linkOrigin"
> & {
  readonly source?: {
    readonly createdBy?: string | null;
    readonly creationSource?: string | null;
  } | null;
};

export function isSubagentThread(
  thread: Pick<OrcaThreadProvenanceInput, "lineage" | "delegatedFrom">,
): boolean {
  return thread.lineage?.relationshipToParent === "subagent" || thread.delegatedFrom != null;
}

export function isAutomationCreatedThread(thread: OrcaThreadProvenanceInput): boolean {
  if (
    thread.source?.creationSource === "server" ||
    thread.source?.createdBy === "system" ||
    thread.source?.createdBy === "agent"
  ) {
    return true;
  }
  if (
    typeof thread.branch === "string" &&
    /^(?:automation|scheduled|factory|cron)\//i.test(thread.branch)
  ) {
    return true;
  }
  return /^(?:\[?(?:automation|scheduled|cron|factory)\]?[:\s]|#factory\b)/i.test(thread.title);
}

export function isCliCreatedThread(thread: OrcaThreadProvenanceInput): boolean {
  if (
    thread.source?.creationSource === "mcp" ||
    thread.source?.creationSource === "provider" ||
    thread.linkOrigin != null
  ) {
    return true;
  }
  return /^\[?cli\]?[:\s]/i.test(thread.title);
}

export type OrcaActivityStatusBucket = "attention" | "working" | "unread" | "failed" | "completed";

export const ORCA_ACTIVITY_STATUS_ORDER: readonly OrcaActivityStatusBucket[] = [
  "attention",
  "working",
  "unread",
  "failed",
  "completed",
];

const ATTENTION_ROW_STATUSES = new Set<SidebarThreadStatus>(["approval", "input", "request"]);

export interface OrcaActivityItem {
  readonly key: string;
  readonly thread: EnvironmentThreadShell;
  readonly rowStatus: SidebarThreadStatus;
  readonly bucket: OrcaActivityStatusBucket;
  readonly isUnread: boolean;
  readonly isSubagent: boolean;
  readonly isAutomationCreated: boolean;
  readonly isCliCreated: boolean;
  readonly isCompleted: boolean;
  readonly projectKey: string;
  readonly projectName: string;
  readonly providerId: string;
  readonly providerLabel: string;
  readonly activityTimestamp: string;
  readonly activityTimestampMs: number;
}

export function resolveThreadActivityIso(
  thread: Pick<EnvironmentThreadShell, "latestRun" | "updatedAt" | "createdAt">,
): string {
  return thread.latestRun?.completedAt ?? thread.updatedAt ?? thread.createdAt;
}

export function isThreadVisitedAfter(
  lastVisitedAt: string | null | undefined,
  referenceIso: string | null | undefined,
): boolean {
  if (!lastVisitedAt || !referenceIso) return false;
  const visitedMs = Date.parse(lastVisitedAt);
  const referenceMs = Date.parse(referenceIso);
  if (!Number.isFinite(visitedMs) || !Number.isFinite(referenceMs)) return false;
  return visitedMs >= referenceMs;
}

export function buildOrcaActivityItem(input: {
  readonly thread: EnvironmentThreadShell;
  readonly localLastVisitedAt?: string | null | undefined;
  readonly projectName: string;
  readonly providerLabel: string;
  readonly providerDriverKind?: string | null | undefined;
}): OrcaActivityItem {
  const { thread, localLastVisitedAt, projectName, providerLabel, providerDriverKind } = input;
  const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
  const lastVisitedAt = resolveThreadLastVisitedAt(
    thread.lastVisitedAt,
    localLastVisitedAt ?? undefined,
  );
  const effectiveThread = { ...thread, lastVisitedAt };
  const rowStatus = resolveSidebarRowStatus(effectiveThread);
  const activityTimestamp = resolveThreadActivityIso(thread);
  const activityTimestampMs = Number.isFinite(Date.parse(activityTimestamp))
    ? Date.parse(activityTimestamp)
    : 0;

  const isAttention = ATTENTION_ROW_STATUSES.has(rowStatus);
  const hasUnreadReady = rowStatus === "ready" && hasUnseenCompletion(effectiveThread);
  const hasUnreadAttention = isAttention && !isThreadVisitedAfter(lastVisitedAt, activityTimestamp);
  const isUnread = hasUnreadReady || hasUnreadAttention;

  let bucket: OrcaActivityStatusBucket;
  if (isAttention) {
    bucket = "attention";
  } else if (rowStatus === "working") {
    bucket = "working";
  } else if (rowStatus === "failed") {
    bucket = "failed";
  } else if (hasUnreadReady) {
    bucket = "unread";
  } else {
    bucket = "completed";
  }

  const isCompleted =
    bucket === "completed" ||
    (bucket === "unread" && thread.settledOverride !== "settled") ||
    thread.settledOverride === "settled";

  return {
    key,
    thread,
    rowStatus,
    bucket,
    isUnread,
    isSubagent: isSubagentThread(thread),
    isAutomationCreated: isAutomationCreatedThread(thread),
    isCliCreated: isCliCreatedThread(thread),
    isCompleted,
    projectKey: `${thread.environmentId}:${thread.projectId}`,
    projectName,
    providerId:
      providerDriverKind ?? thread.modelSelection?.instanceId ?? thread.providerInstanceId,
    providerLabel,
    activityTimestamp,
    activityTimestampMs,
  };
}

export type OrcaActivityBadgeTone = "attention" | "working" | "unread" | "idle";

export interface OrcaActivityBadgeSummary {
  readonly attentionCount: number;
  readonly workingCount: number;
  readonly unreadCount: number;
  readonly completedCount: number;
  readonly displayCount: number;
  readonly tone: OrcaActivityBadgeTone;
}

/**
 * Computes Orca's `SidebarActivityBadge` (`🔔•N`) summary from live activity items.
 * Prioritizes pending approvals/inputs -> active working agents -> unread completions -> 0 (idle).
 */
export function summarizeOrcaActivityBadge(
  items: ReadonlyArray<Pick<OrcaActivityItem, "bucket" | "isUnread" | "isCompleted">>,
): OrcaActivityBadgeSummary {
  let attentionCount = 0;
  let workingCount = 0;
  let unreadCount = 0;
  let completedCount = 0;

  for (const item of items) {
    if (item.bucket === "attention") attentionCount += 1;
    if (item.bucket === "working") workingCount += 1;
    if (item.isUnread) unreadCount += 1;
    if (item.isCompleted) completedCount += 1;
  }

  if (attentionCount > 0) {
    return {
      attentionCount,
      workingCount,
      unreadCount,
      completedCount,
      displayCount: attentionCount,
      tone: "attention",
    };
  }
  if (workingCount > 0) {
    return {
      attentionCount,
      workingCount,
      unreadCount,
      completedCount,
      displayCount: workingCount,
      tone: "working",
    };
  }
  if (unreadCount > 0) {
    return {
      attentionCount,
      workingCount,
      unreadCount,
      completedCount,
      displayCount: unreadCount,
      tone: "unread",
    };
  }
  return {
    attentionCount: 0,
    workingCount: 0,
    unreadCount: 0,
    completedCount,
    displayCount: 0,
    tone: "idle",
  };
}

export function filterOrcaActivityItems(
  items: ReadonlyArray<OrcaActivityItem>,
  prefs: Pick<
    OrcaProjectsPrefs,
    "unreadOnly" | "showChildAgents" | "hideAutomationCreated" | "hideCliCreated"
  >,
  searchQuery = "",
): OrcaActivityItem[] {
  const trimmedQuery = searchQuery.trim().toLowerCase();
  return items.filter((item) => {
    if (item.thread.archivedAt !== null || item.thread.deletedAt !== null) {
      return false;
    }
    if (!prefs.showChildAgents && item.isSubagent) {
      return false;
    }
    if (prefs.hideAutomationCreated && item.isAutomationCreated) {
      return false;
    }
    if (prefs.hideCliCreated && item.isCliCreated) {
      return false;
    }
    if (prefs.unreadOnly && !item.isUnread) {
      return false;
    }
    if (trimmedQuery.length > 0) {
      const haystack = [
        item.thread.title,
        item.projectName,
        item.thread.branch ?? "",
        item.providerLabel,
        item.bucket,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(trimmedQuery)) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Applies persisted Orca sidebar filter toggles (`unreadOnly`, `hideAutomationCreated`,
 * `hideCliCreated`) directly to the main Projects tree threads as well.
 */
export function filterSidebarProjectThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  prefs: Pick<
    OrcaProjectsPrefs,
    "unreadOnly" | "showChildAgents" | "hideAutomationCreated" | "hideCliCreated"
  >,
  localLastVisitedAtById: Readonly<Record<string, string | undefined>>,
): EnvironmentThreadShell[] {
  return threads.filter((thread) => {
    if (prefs.hideAutomationCreated && isAutomationCreatedThread(thread)) {
      return false;
    }
    if (prefs.hideCliCreated && isCliCreatedThread(thread)) {
      return false;
    }
    if (prefs.unreadOnly) {
      const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      const lastVisitedAt = resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        localLastVisitedAtById[key],
      );
      const effectiveThread = { ...thread, lastVisitedAt };
      const status = resolveSidebarRowStatus(effectiveThread);
      const isAttention = ATTENTION_ROW_STATUSES.has(status);
      const activityIso = resolveThreadActivityIso(thread);
      const isUnread =
        (status === "ready" && hasUnseenCompletion(effectiveThread)) ||
        (isAttention && !isThreadVisitedAfter(lastVisitedAt, activityIso));
      if (!isUnread) return false;
    }
    return true;
  });
}

export interface OrcaActivityGroup {
  readonly key: string;
  readonly label: string;
  readonly bucket?: OrcaActivityStatusBucket;
  readonly items: readonly OrcaActivityItem[];
}

export interface OrcaActivityGroupLabels {
  readonly statusLabels: Readonly<Record<OrcaActivityStatusBucket, string>>;
  readonly noProjectLabel: string;
  readonly recentLabel: string;
}

export function groupOrcaActivityItems(
  items: ReadonlyArray<OrcaActivityItem>,
  groupBy: OrcaActivityGroupBy,
  labels: OrcaActivityGroupLabels,
): OrcaActivityGroup[] {
  if (items.length === 0) return [];

  const sortedByRecency = [...items].toSorted(
    (left, right) => right.activityTimestampMs - left.activityTimestampMs,
  );

  if (groupBy === "recent") {
    return [
      {
        key: "recent",
        label: labels.recentLabel,
        items: sortedByRecency,
      },
    ];
  }

  if (groupBy === "status") {
    const byBucket = new Map<OrcaActivityStatusBucket, OrcaActivityItem[]>();
    for (const item of sortedByRecency) {
      const list = byBucket.get(item.bucket);
      if (list) {
        list.push(item);
      } else {
        byBucket.set(item.bucket, [item]);
      }
    }
    const groups: OrcaActivityGroup[] = [];
    for (const bucket of ORCA_ACTIVITY_STATUS_ORDER) {
      const bucketItems = byBucket.get(bucket);
      if (bucketItems && bucketItems.length > 0) {
        groups.push({
          key: `status:${bucket}`,
          label: labels.statusLabels[bucket],
          bucket,
          items: bucketItems,
        });
      }
    }
    return groups;
  }

  // groupBy === "project"
  const byProject = new Map<string, { label: string; items: OrcaActivityItem[] }>();
  for (const item of sortedByRecency) {
    const existing = byProject.get(item.projectKey);
    if (existing) {
      existing.items.push(item);
    } else {
      byProject.set(item.projectKey, {
        label: item.projectName || labels.noProjectLabel,
        items: [item],
      });
    }
  }
  return [...byProject.entries()].map(([projectKey, group]) => ({
    key: `project:${projectKey}`,
    label: group.label,
    items: group.items,
  }));
}

// ---------------------------------------------------------------------------
// Add Project: Clone URL & New Project validation
// ---------------------------------------------------------------------------

export type GitCloneUrlValidationResult =
  | { readonly ok: true; readonly normalizedUrl: string; readonly folderName: string }
  | { readonly ok: false; readonly reason: "empty" | "invalid" };

const SHORTHAND_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SCP_SSH_PATTERN = /^[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+:[A-Za-z0-9_./-]+$/;

export function inferRepoFolderNameFromUrl(url: string): string {
  const cleaned = url.trim().replace(/[\\/]+$/, "");
  const lastSegment = cleaned.split(/[/:]/).filter(Boolean).at(-1) ?? "";
  const withoutGit = lastSegment.replace(/\.git$/i, "");
  return withoutGit.replace(/[^A-Za-z0-9._-]+/g, "-") || "repository";
}

export function validateAndNormalizeGitCloneUrl(rawInput: string): GitCloneUrlValidationResult {
  const trimmed = rawInput
    .trim()
    .replace(/^git\s+clone\s+/i, "")
    .trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, reason: "invalid" };
  }

  if (SHORTHAND_REPO_PATTERN.test(trimmed)) {
    const cleanShorthand = trimmed.replace(/\.git$/i, "");
    const normalizedUrl = `https://github.com/${cleanShorthand}.git`;
    return {
      ok: true,
      normalizedUrl,
      folderName: inferRepoFolderNameFromUrl(normalizedUrl),
    };
  }

  if (SCP_SSH_PATTERN.test(trimmed)) {
    return {
      ok: true,
      normalizedUrl: trimmed,
      folderName: inferRepoFolderNameFromUrl(trimmed),
    };
  }

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (
      protocol !== "https:" &&
      protocol !== "http:" &&
      protocol !== "ssh:" &&
      protocol !== "git:"
    ) {
      return { ok: false, reason: "invalid" };
    }
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (!parsed.hostname || pathParts.length === 0) {
      return { ok: false, reason: "invalid" };
    }
    return {
      ok: true,
      normalizedUrl: trimmed,
      folderName: inferRepoFolderNameFromUrl(trimmed),
    };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export type NewProjectNameValidationResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: "empty" | "invalid" };

export function validateNewProjectName(rawName: string): NewProjectNameValidationResult {
  const trimmed = rawName.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("..") ||
    /[\\/:*?"<>|]/.test(trimmed)
  ) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, name: trimmed };
}

// ---------------------------------------------------------------------------
// Create Workspace Dialog (`Ctrl+N`) payload builder & Emoji picker defaults
// ---------------------------------------------------------------------------

export const NO_PROJECT_SELECTION_VALUE = "__prismux_no_project__" as const;
export const DEFAULT_AGENT_SELECTION_VALUE = "__prismux_default_agent__" as const;

export interface OrcaWorkspaceAgentOption {
  readonly id: string;
  readonly providerInstanceId: string;
  readonly driverKind: string;
  readonly model: string;
  readonly displayName: string;
  readonly modelLabel: string;
  readonly online: boolean;
}

export interface CreateWorkspaceFormState {
  readonly projectSelection: string;
  readonly environmentId: string | null;
  readonly workspaceName: string;
  readonly agentOptionId: string;
  readonly envMode: DraftThreadEnvMode;
  readonly branch: string;
  readonly initialPrompt: string;
  readonly createMore: boolean;
}

export interface CreateWorkspacePayload {
  readonly isScratchProject: boolean;
  readonly projectKey: string | null;
  readonly environmentId: string;
  readonly workspaceName: string | null;
  readonly agentOptionId: string | null;
  readonly envMode: DraftThreadEnvMode;
  readonly branch: string | null;
  readonly initialPrompt: string | null;
  readonly createMore: boolean;
}

export type BuildCreateWorkspacePayloadResult =
  | { readonly ok: true; readonly payload: CreateWorkspacePayload }
  | { readonly ok: false; readonly reason: "missing-environment" };

export function buildCreateWorkspacePayload(
  state: CreateWorkspaceFormState,
): BuildCreateWorkspacePayloadResult {
  if (!state.environmentId || state.environmentId.trim().length === 0) {
    return { ok: false, reason: "missing-environment" };
  }
  const isScratchProject =
    state.projectSelection === NO_PROJECT_SELECTION_VALUE ||
    state.projectSelection.trim().length === 0;
  const trimmedName = state.workspaceName.trim();
  const trimmedBranch = state.branch.trim();
  const trimmedPrompt = state.initialPrompt.trim();
  const agentOptionId =
    state.agentOptionId === DEFAULT_AGENT_SELECTION_VALUE || state.agentOptionId.trim().length === 0
      ? null
      : state.agentOptionId;

  return {
    ok: true,
    payload: {
      isScratchProject,
      projectKey: isScratchProject ? null : state.projectSelection,
      environmentId: state.environmentId,
      workspaceName: trimmedName.length > 0 ? trimmedName : null,
      agentOptionId,
      envMode: state.envMode,
      branch: trimmedBranch.length > 0 ? trimmedBranch : null,
      initialPrompt: trimmedPrompt.length > 0 ? trimmedPrompt : null,
      createMore: state.createMore,
    },
  };
}

export interface OrcaEmojiEntry {
  readonly emoji: string;
  readonly shortcode: string;
}

/**
 * Curated 48 workspace emojis matching stablyai/orca
 * `src/renderer/src/lib/workspace/display/workspace-emoji-picker-defaults.ts`.
 */
export const ORCA_WORKSPACE_EMOJI_DEFAULTS: readonly OrcaEmojiEntry[] = [
  { emoji: "🚀", shortcode: "rocket" },
  { emoji: "🐛", shortcode: "bug" },
  { emoji: "✨", shortcode: "sparkles" },
  { emoji: "🔥", shortcode: "fire" },
  { emoji: "⚡", shortcode: "zap" },
  { emoji: "🧪", shortcode: "test_tube" },
  { emoji: "📦", shortcode: "package" },
  { emoji: "🔧", shortcode: "wrench" },
  { emoji: "🔨", shortcode: "hammer" },
  { emoji: "🔩", shortcode: "nut_and_bolt" },
  { emoji: "🚧", shortcode: "construction" },
  { emoji: "🚨", shortcode: "rotating_light" },
  { emoji: "🔒", shortcode: "lock" },
  { emoji: "🔑", shortcode: "key" },
  { emoji: "🛡", shortcode: "shield" },
  { emoji: "🧹", shortcode: "broom" },
  { emoji: "📝", shortcode: "memo" },
  { emoji: "📚", shortcode: "books" },
  { emoji: "🔖", shortcode: "bookmark" },
  { emoji: "📌", shortcode: "pushpin" },
  { emoji: "📎", shortcode: "paperclip" },
  { emoji: "🔗", shortcode: "link" },
  { emoji: "📋", shortcode: "clipboard" },
  { emoji: "📆", shortcode: "calendar" },
  { emoji: "💡", shortcode: "bulb" },
  { emoji: "🔍", shortcode: "mag" },
  { emoji: "👀", shortcode: "eyes" },
  { emoji: "💬", shortcode: "speech_balloon" },
  { emoji: "🔔", shortcode: "bell" },
  { emoji: "🛟", shortcode: "lifebuoy" },
  { emoji: "🤖", shortcode: "robot" },
  { emoji: "🔬", shortcode: "microscope" },
  { emoji: "✅", shortcode: "white_check_mark" },
  { emoji: "⛔", shortcode: "no_entry" },
  { emoji: "⌛", shortcode: "hourglass" },
  { emoji: "🏆", shortcode: "trophy" },
  { emoji: "⭐", shortcode: "star" },
  { emoji: "🎉", shortcode: "tada" },
  { emoji: "🎯", shortcode: "dart" },
  { emoji: "🧩", shortcode: "puzzle_piece" },
  { emoji: "🌱", shortcode: "seedling" },
  { emoji: "🌸", shortcode: "cherry_blossom" },
  { emoji: "🌈", shortcode: "rainbow" },
  { emoji: "🌻", shortcode: "sunflower" },
  { emoji: "🌙", shortcode: "crescent_moon" },
  { emoji: "💜", shortcode: "purple_heart" },
  { emoji: "☕", shortcode: "coffee" },
  { emoji: "👻", shortcode: "ghost" },
] as const;

export function insertEmojiAtSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  emoji: string,
): { readonly value: string; readonly cursor: number } {
  const safeStart = Math.max(0, Math.min(selectionStart, value.length));
  const safeEnd = Math.max(safeStart, Math.min(selectionEnd, value.length));
  const before = value.slice(0, safeStart);
  const after = value.slice(safeEnd);
  const needsTrailingSpace = after.length > 0 && !/^\s/.test(after);
  const insertion = needsTrailingSpace ? `${emoji} ` : emoji;
  const nextValue = `${before}${insertion}${after}`;
  return {
    value: nextValue,
    cursor: before.length + insertion.length,
  };
}

export function formatLocalEnvironmentDisplayLabel(input: {
  readonly rawLabel: string;
  readonly platformOs?: string | null;
  readonly isPrimary: boolean;
  readonly isZh: boolean;
}): string {
  if (!input.isPrimary) {
    return input.rawLabel;
  }
  const os = (
    input.platformOs ?? (typeof navigator !== "undefined" ? navigator.platform : "")
  ).toLowerCase();
  if (os.includes("darwin") || os.includes("mac")) {
    return input.isZh ? "本地 macOS" : "Local macOS";
  }
  if (os.includes("win")) {
    return input.isZh ? "本地 Windows" : "Local Windows";
  }
  if (os.includes("linux")) {
    return input.isZh ? "本地 Linux" : "Local Linux";
  }
  return input.rawLabel || (input.isZh ? "本地环境" : "Local");
}
