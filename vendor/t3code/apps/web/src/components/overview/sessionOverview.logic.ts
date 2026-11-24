import type {
  ChatAttachment,
  DiscoveredLocalServer,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
  RunId,
  ScheduledTask,
  ScheduledTaskId,
  ThreadId,
  TurnItemId,
  VcsStatusResult,
} from "@t3tools/contracts";
import type { KnownTerminalSession } from "@t3tools/client-runtime/state/terminal";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import { normalizeBtwDisplayTitle } from "../chat/btwMode";

export const DEFAULT_OVERVIEW_SECTION_LIMIT = 4;
export const OVERVIEW_DISPLAY_PREFS_STORAGE_KEY = "prismux.overview.displayPrefs.v1";
export const SIDE_QUESTIONS_STORAGE_PREFIX = "prismux.overview.sideQuestions.v1:";
const MAX_PERSISTED_SIDE_QUESTIONS = 50;
const DEFAULT_CONTEXT_SUMMARY_MAX_CHARS = 1_800;

export type OverviewSectionLimitMode = "auto" | 2 | 3 | 5 | 8;

export const OVERVIEW_SECTION_LIMIT_OPTIONS: ReadonlyArray<OverviewSectionLimitMode> = Object.freeze(
  ["auto", 2, 3, 5, 8],
);

export interface OverviewDisplayPrefs {
  readonly limitMode: OverviewSectionLimitMode;
  readonly showCompleted: boolean;
}

export const DEFAULT_OVERVIEW_DISPLAY_PREFS: OverviewDisplayPrefs = Object.freeze({
  limitMode: "auto",
  showCompleted: false,
});

export interface OverviewDiffFileStat {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
  readonly status?: string;
}

export interface OverviewDiffStats {
  readonly insertions: number;
  readonly deletions: number;
  readonly files?: ReadonlyArray<OverviewDiffFileStat>;
}

export interface FileTypeBadgeInfo {
  readonly label: string;
  readonly className: string;
}

export interface OverviewVisibleSlice<T> {
  readonly visible: ReadonlyArray<T>;
  readonly hiddenCount: number;
  readonly hasMore: boolean;
}

export interface OverviewSubagentItem {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly driver: string | null;
  readonly childThreadId: ThreadId | null;
  readonly promptPreview: string | null;
  readonly isRemote: boolean;
  readonly remoteLabel: string | null;
}

export type SideQuestionStatus = "pending" | "answered" | "offline" | "error" | "native";

export interface SideQuestionRecord {
  readonly id: string;
  readonly title: string;
  readonly question: string;
  readonly contextSummary: string;
  readonly status: SideQuestionStatus;
  readonly answer: string | null;
  readonly errorMessage?: string | null;
  readonly linkedSideThreadId?: string | null;
  readonly hints?: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OverviewSideQuestionItem {
  readonly id: string;
  readonly title: string;
  readonly question: string;
  readonly status: SideQuestionStatus;
  readonly answer: string | null;
  readonly errorMessage: string | null;
  readonly contextSummary: string;
  readonly linkedSideThreadId: ThreadId | null;
  readonly hints: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly source: "local" | "native";
}

export interface DaemonPtySessionItem {
  readonly id: string;
  readonly title: string;
  readonly command: string | null;
  readonly cwd: string | null;
  readonly pid: number | null;
  readonly alive: boolean;
  readonly stale?: boolean;
  readonly group?: string | null;
}

export interface OverviewBackgroundTaskItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly status: "running" | "idle" | "failed" | "scheduled";
  readonly kind: "daemon-pty" | "terminal" | "automation" | "server" | "command";
  readonly terminalId?: string;
  readonly serverPort?: number;
  readonly pid?: number | null;
  readonly taskId?: ScheduledTaskId;
}

export interface OverviewGoalItem {
  readonly id: string;
  readonly text: string;
  readonly status: "pending" | "running" | "completed";
}

export interface OverviewGoalsSummary {
  readonly items: ReadonlyArray<OverviewGoalItem>;
  readonly completedCount: number;
  readonly totalCount: number;
  readonly allCompleted: boolean;
}

export interface OverviewArtifactItem {
  readonly id: string;
  readonly title: string;
  readonly relativePath: string | null;
  readonly subtitle: string | null;
  readonly kind: "plan" | "markdown";
  readonly markdown: string | null;
}

export interface OverviewModifiedFileItem {
  readonly path: string;
  readonly fileName: string;
  readonly dirPath: string;
  readonly insertions: number;
  readonly deletions: number;
  readonly badge: FileTypeBadgeInfo;
  readonly toolCallItemId: TurnItemId | null;
  readonly runId: RunId | null;
}

export interface OverviewUploadItem {
  readonly id: string;
  readonly name: string;
  readonly kind: "image" | "video" | "file";
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sizeLabel: string;
  readonly attachment: ChatAttachment;
}

export interface OverviewUsedSkillItem {
  readonly id: string;
  readonly name: string;
  readonly kind: "command" | "skill";
  readonly count: number;
}

const FILE_TYPE_BADGES: Readonly<Record<string, FileTypeBadgeInfo>> = {
  ts: {
    label: "TS",
    className:
      "bg-sky-500/15 text-sky-700 ring-1 ring-sky-500/30 dark:bg-sky-400/15 dark:text-sky-300 dark:ring-sky-400/25",
  },
  tsx: {
    label: "TSX",
    className:
      "bg-cyan-500/15 text-cyan-700 ring-1 ring-cyan-500/30 dark:bg-cyan-400/15 dark:text-cyan-300 dark:ring-cyan-400/25",
  },
  js: {
    label: "JS",
    className:
      "bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/30 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/25",
  },
  mjs: {
    label: "JS",
    className:
      "bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/30 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/25",
  },
  cjs: {
    label: "JS",
    className:
      "bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/30 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/25",
  },
  jsx: {
    label: "JSX",
    className:
      "bg-yellow-500/15 text-yellow-700 ring-1 ring-yellow-500/30 dark:bg-yellow-400/15 dark:text-yellow-300 dark:ring-yellow-400/25",
  },
  css: {
    label: "CSS",
    className:
      "bg-violet-500/15 text-violet-700 ring-1 ring-violet-500/30 dark:bg-violet-400/15 dark:text-violet-300 dark:ring-violet-400/25",
  },
  scss: {
    label: "SCSS",
    className:
      "bg-fuchsia-500/15 text-fuchsia-700 ring-1 ring-fuchsia-500/30 dark:bg-fuchsia-400/15 dark:text-fuchsia-300 dark:ring-fuchsia-400/25",
  },
  json: {
    label: "JSON",
    className:
      "bg-amber-500/15 text-amber-800 ring-1 ring-amber-500/30 dark:bg-amber-300/15 dark:text-amber-200 dark:ring-amber-300/25",
  },
  md: {
    label: "MD",
    className:
      "bg-indigo-500/15 text-indigo-700 ring-1 ring-indigo-500/30 dark:bg-indigo-400/15 dark:text-indigo-300 dark:ring-indigo-400/25",
  },
  mdx: {
    label: "MDX",
    className:
      "bg-indigo-500/15 text-indigo-700 ring-1 ring-indigo-500/30 dark:bg-indigo-400/15 dark:text-indigo-300 dark:ring-indigo-400/25",
  },
  rs: {
    label: "RS",
    className:
      "bg-orange-500/15 text-orange-700 ring-1 ring-orange-500/30 dark:bg-orange-400/15 dark:text-orange-300 dark:ring-orange-400/25",
  },
  py: {
    label: "PY",
    className:
      "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 dark:bg-emerald-400/15 dark:text-emerald-300 dark:ring-emerald-400/25",
  },
  html: {
    label: "HTML",
    className:
      "bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/30 dark:bg-rose-400/15 dark:text-rose-300 dark:ring-rose-400/25",
  },
  sh: {
    label: "SH",
    className:
      "bg-teal-500/15 text-teal-700 ring-1 ring-teal-500/30 dark:bg-teal-400/15 dark:text-teal-300 dark:ring-teal-400/25",
  },
  ps1: {
    label: "PS1",
    className:
      "bg-blue-500/15 text-blue-700 ring-1 ring-blue-500/30 dark:bg-blue-400/15 dark:text-blue-300 dark:ring-blue-400/25",
  },
  sql: {
    label: "SQL",
    className:
      "bg-pink-500/15 text-pink-700 ring-1 ring-pink-500/30 dark:bg-pink-400/15 dark:text-pink-300 dark:ring-pink-400/25",
  },
  yml: {
    label: "YAML",
    className:
      "bg-purple-500/15 text-purple-700 ring-1 ring-purple-500/30 dark:bg-purple-400/15 dark:text-purple-300 dark:ring-purple-400/25",
  },
  yaml: {
    label: "YAML",
    className:
      "bg-purple-500/15 text-purple-700 ring-1 ring-purple-500/30 dark:bg-purple-400/15 dark:text-purple-300 dark:ring-purple-400/25",
  },
  toml: {
    label: "TOML",
    className:
      "bg-stone-500/15 text-stone-700 ring-1 ring-stone-500/30 dark:bg-stone-400/15 dark:text-stone-300 dark:ring-stone-400/25",
  },
  svg: {
    label: "SVG",
    className:
      "bg-lime-500/15 text-lime-700 ring-1 ring-lime-500/30 dark:bg-lime-400/15 dark:text-lime-300 dark:ring-lime-400/25",
  },
};

const DEFAULT_FILE_BADGE: FileTypeBadgeInfo = {
  label: "FILE",
  className:
    "bg-foreground/[0.08] text-foreground/75 ring-1 ring-border/60 dark:bg-white/[0.1] dark:text-foreground/80",
};

export function normalizeRepoRelativePath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
}

export function splitRelativePath(raw: string): {
  readonly fileName: string;
  readonly dirPath: string;
  readonly normalizedPath: string;
} {
  const normalizedPath = normalizeRepoRelativePath(raw);
  const slashIndex = normalizedPath.lastIndexOf("/");
  if (slashIndex < 0) {
    return {
      fileName: normalizedPath,
      dirPath: "",
      normalizedPath,
    };
  }
  return {
    fileName: normalizedPath.slice(slashIndex + 1),
    dirPath: normalizedPath.slice(0, slashIndex),
    normalizedPath,
  };
}

export function resolveFileTypeBadge(path: string): FileTypeBadgeInfo {
  const { fileName } = splitRelativePath(path);
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return DEFAULT_FILE_BADGE;
  }
  const ext = fileName.slice(dotIndex + 1).toLowerCase();
  const known = FILE_TYPE_BADGES[ext];
  if (known) return known;
  return {
    label: ext.slice(0, 4).toUpperCase(),
    className: DEFAULT_FILE_BADGE.className,
  };
}

export function formatByteSize(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return "";
  }
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

const OVERVIEW_HEADER_HEIGHT_PX = 42;
const OVERVIEW_QUICK_ACTIONS_HEIGHT_PX = 108;
const OVERVIEW_LINKED_PR_STRIP_HEIGHT_PX = 34;
const OVERVIEW_VERTICAL_PADDING_PX = 12;
const OVERVIEW_SECTION_HEADER_HEIGHT_PX = 36;
const OVERVIEW_ITEM_ROW_HEIGHT_PX = 30;
const MIN_DYNAMIC_SECTION_LIMIT = 1;
const MAX_DYNAMIC_SECTION_LIMIT = 8;

/**
 * Computes the per-section maximum visible item count based on the overview card's
 * live available height (windowed vs. fullscreen) and active section count.
 */
export function computeDynamicOverviewSectionLimit(input: {
  readonly availableHeightPx: number;
  readonly activeSectionCount: number;
  readonly limitMode?: OverviewSectionLimitMode;
  readonly hasLinkedPrs?: boolean;
}): number {
  const mode = input.limitMode ?? "auto";
  if (mode !== "auto") {
    return mode;
  }
  if (!Number.isFinite(input.availableHeightPx) || input.availableHeightPx <= 0) {
    return DEFAULT_OVERVIEW_SECTION_LIMIT;
  }
  const sectionCount = Math.max(1, Math.floor(input.activeSectionCount));
  const chromeHeight =
    OVERVIEW_HEADER_HEIGHT_PX +
    OVERVIEW_QUICK_ACTIONS_HEIGHT_PX +
    (input.hasLinkedPrs ? OVERVIEW_LINKED_PR_STRIP_HEIGHT_PX : 0) +
    OVERVIEW_VERTICAL_PADDING_PX;
  const sectionHeadersHeight = OVERVIEW_SECTION_HEADER_HEIGHT_PX * sectionCount;
  const remaining = Math.max(0, input.availableHeightPx - chromeHeight - sectionHeadersHeight);
  const rawLimit = Math.floor(remaining / sectionCount / OVERVIEW_ITEM_ROW_HEIGHT_PX);
  return Math.min(MAX_DYNAMIC_SECTION_LIMIT, Math.max(MIN_DYNAMIC_SECTION_LIMIT, rawLimit));
}

export function sliceOverviewItems<T>(
  items: ReadonlyArray<T>,
  expanded: boolean,
  limit = DEFAULT_OVERVIEW_SECTION_LIMIT,
): OverviewVisibleSlice<T> {
  const safeLimit = Math.max(1, limit);
  if (expanded || items.length <= safeLimit) {
    return {
      visible: items,
      hiddenCount: 0,
      hasMore: items.length > safeLimit,
    };
  }
  return {
    visible: items.slice(0, safeLimit),
    hiddenCount: items.length - safeLimit,
    hasMore: true,
  };
}

function clampNonNegativeInt(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

export function extractOverviewModifiedFiles(input: {
  readonly diffStats?: OverviewDiffStats | null | undefined;
  readonly gitStatus?: VcsStatusResult | null | undefined;
  readonly projection?: OrchestrationV2ThreadProjection | null | undefined;
}): ReadonlyArray<OverviewModifiedFileItem> {
  const byPath = new Map<
    string,
    {
      path: string;
      insertions: number;
      deletions: number;
      toolCallItemId: TurnItemId | null;
      runId: RunId | null;
    }
  >();

  const upsert = (entry: {
    path: string;
    insertions?: number | undefined;
    deletions?: number | undefined;
    toolCallItemId?: TurnItemId | null | undefined;
    runId?: RunId | null | undefined;
    preferCounts?: boolean | undefined;
  }) => {
    const normalized = normalizeRepoRelativePath(entry.path);
    if (!normalized) return;
    const existing = byPath.get(normalized);
    const nextInsertions = clampNonNegativeInt(entry.insertions);
    const nextDeletions = clampNonNegativeInt(entry.deletions);
    if (!existing) {
      byPath.set(normalized, {
        path: normalized,
        insertions: nextInsertions,
        deletions: nextDeletions,
        toolCallItemId: entry.toolCallItemId ?? null,
        runId: entry.runId ?? null,
      });
      return;
    }
    if (entry.preferCounts || (existing.insertions === 0 && existing.deletions === 0)) {
      existing.insertions = nextInsertions;
      existing.deletions = nextDeletions;
    } else if (nextInsertions > 0 || nextDeletions > 0) {
      existing.insertions = Math.max(existing.insertions, nextInsertions);
      existing.deletions = Math.max(existing.deletions, nextDeletions);
    }
    if (entry.toolCallItemId) {
      existing.toolCallItemId = entry.toolCallItemId;
    }
    if (entry.runId) {
      existing.runId = entry.runId;
    }
  };

  // 1. Thread turn file_change items (captures toolCallItemId & runId for direct diff jumps)
  for (const item of input.projection?.turnItems ?? []) {
    if (item.type !== "file_change") continue;
    if (item.changes && item.changes.length > 0) {
      for (const change of item.changes) {
        upsert({
          path: change.path,
          insertions: item.changes.length === 1 ? item.additions : 0,
          deletions: item.changes.length === 1 ? item.deletions : 0,
          toolCallItemId: item.id,
          runId: item.runId,
        });
      }
    } else if (item.fileName) {
      upsert({
        path: item.fileName,
        insertions: item.additions,
        deletions: item.deletions,
        toolCallItemId: item.id,
        runId: item.runId,
      });
    }
  }

  // 2. Checkpoints file summaries
  for (const checkpoint of input.projection?.checkpoints ?? []) {
    for (const file of checkpoint.files) {
      upsert({
        path: file.path,
        insertions: file.additions,
        deletions: file.deletions,
        runId: checkpoint.runId,
      });
    }
  }

  // 3. Live git workingTree files (authoritative counts for uncommitted workspace changes)
  for (const file of input.gitStatus?.workingTree.files ?? []) {
    upsert({
      path: file.path,
      insertions: file.insertions,
      deletions: file.deletions,
      preferCounts: true,
    });
  }

  // 4. Explicit caller diffStats override
  for (const file of input.diffStats?.files ?? []) {
    upsert({
      path: file.path,
      insertions: file.insertions,
      deletions: file.deletions,
      preferCounts: true,
    });
  }

  return Array.from(byPath.values()).map((entry) => {
    const split = splitRelativePath(entry.path);
    return {
      path: split.normalizedPath,
      fileName: split.fileName,
      dirPath: split.dirPath,
      insertions: entry.insertions,
      deletions: entry.deletions,
      badge: resolveFileTypeBadge(split.normalizedPath),
      toolCallItemId: entry.toolCallItemId,
      runId: entry.runId,
    };
  });
}

export function resolveOverviewDiffStats(input: {
  readonly diffStats?: OverviewDiffStats | null | undefined;
  readonly gitStatus?: VcsStatusResult | null | undefined;
  readonly branchDiffTotals?: { readonly insertions: number; readonly deletions: number } | null | undefined;
  readonly modifiedFiles?: ReadonlyArray<OverviewModifiedFileItem> | undefined;
}): { readonly insertions: number; readonly deletions: number; readonly fileCount: number } {
  const fileCount = input.modifiedFiles?.length ?? input.diffStats?.files?.length ?? input.gitStatus?.workingTree.files.length ?? 0;

  if (input.diffStats) {
    return {
      insertions: clampNonNegativeInt(input.diffStats.insertions),
      deletions: clampNonNegativeInt(input.diffStats.deletions),
      fileCount,
    };
  }

  if (
    input.branchDiffTotals &&
    (input.branchDiffTotals.insertions > 0 || input.branchDiffTotals.deletions > 0)
  ) {
    return {
      insertions: clampNonNegativeInt(input.branchDiffTotals.insertions),
      deletions: clampNonNegativeInt(input.branchDiffTotals.deletions),
      fileCount,
    };
  }

  if (input.gitStatus) {
    const wtIns = clampNonNegativeInt(input.gitStatus.workingTree.insertions);
    const wtDel = clampNonNegativeInt(input.gitStatus.workingTree.deletions);
    if (wtIns > 0 || wtDel > 0) {
      return { insertions: wtIns, deletions: wtDel, fileCount };
    }
    if (input.gitStatus.branchChanges) {
      return {
        insertions: clampNonNegativeInt(input.gitStatus.branchChanges.insertions),
        deletions: clampNonNegativeInt(input.gitStatus.branchChanges.deletions),
        fileCount,
      };
    }
  }

  const summed = (input.modifiedFiles ?? []).reduce(
    (acc, file) => ({
      insertions: acc.insertions + file.insertions,
      deletions: acc.deletions + file.deletions,
    }),
    { insertions: 0, deletions: 0 },
  );
  return {
    insertions: summed.insertions,
    deletions: summed.deletions,
    fileCount,
  };
}

const ACTIVE_SUBAGENT_STATUSES = new Set([
  "running",
  "pending",
  "starting",
  "queued",
  "waiting_input",
  "in_progress",
]);

function isRunningSubagentStatus(status: string): boolean {
  return ACTIVE_SUBAGENT_STATUSES.has(status.trim().toLowerCase());
}

export function extractOverviewSubagents(input: {
  readonly projection?: OrchestrationV2ThreadProjection | null | undefined;
  readonly relationshipShells?: ReadonlyArray<OrchestrationV2ThreadShell> | undefined;
  readonly currentThreadId: ThreadId;
  readonly activeOnly?: boolean;
}): ReadonlyArray<OverviewSubagentItem> {
  const activeOnly = input.activeOnly !== false;
  const items: OverviewSubagentItem[] = [];
  const seenKeys = new Set<string>();

  const shellById = new Map(
    (input.relationshipShells ?? []).map((shell) => [shell.id, shell] as const),
  );

  for (const agent of input.projection?.subagents ?? []) {
    const key = agent.childThreadId ?? agent.id;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const childShell = agent.childThreadId ? shellById.get(agent.childThreadId) : undefined;
    const rawTitle =
      agent.title?.trim() ||
      childShell?.title?.trim() ||
      (agent.prompt ? agent.prompt.split(/\r?\n/, 1)[0]?.slice(0, 48) : "") ||
      "子智能体";
    items.push({
      id: agent.id,
      title: formatSubagentDisplayTitle(rawTitle),
      status: childShell?.activityRunStatus ?? agent.status,
      driver: agent.driver ?? null,
      childThreadId: agent.childThreadId,
      promptPreview: agent.prompt ? agent.prompt.trim().slice(0, 120) : null,
      isRemote: agent.remoteChild !== undefined,
      remoteLabel: agent.remoteChild?.label ?? null,
    });
  }

  for (const turnItem of input.projection?.turnItems ?? []) {
    if (turnItem.type !== "subagent") continue;
    const key = turnItem.childThreadId ?? turnItem.subagentId;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const childShell = turnItem.childThreadId ? shellById.get(turnItem.childThreadId) : undefined;
    const rawTitle =
      childShell?.title?.trim() ||
      turnItem.prompt.split(/\r?\n/, 1)[0]?.trim().slice(0, 48) ||
      "子智能体";
    items.push({
      id: turnItem.subagentId,
      title: formatSubagentDisplayTitle(rawTitle),
      status: childShell?.activityRunStatus ?? turnItem.status,
      driver: turnItem.driver ?? null,
      childThreadId: turnItem.childThreadId,
      promptPreview: turnItem.prompt.trim().slice(0, 120) || null,
      isRemote: turnItem.remoteChild !== undefined,
      remoteLabel: turnItem.remoteChild?.label ?? null,
    });
  }

  for (const shell of input.relationshipShells ?? []) {
    if (shell.id === input.currentThreadId) continue;
    if (shell.lineage.parentThreadId !== input.currentThreadId) continue;
    if (shell.lineage.sideChat === true) continue;
    if (seenKeys.has(shell.id)) continue;
    seenKeys.add(shell.id);
    items.push({
      id: shell.id,
      title: formatSubagentDisplayTitle(shell.title?.trim() || "子智能体"),
      status: shell.activityRunStatus ?? shell.status ?? "idle",
      driver: null,
      childThreadId: shell.id,
      promptPreview: null,
      isRemote: false,
      remoteLabel: null,
    });
  }

  const filtered = activeOnly
    ? items.filter((item) => isRunningSubagentStatus(item.status))
    : items;

  return filtered.toSorted((a, b) => {
    const aRunning = isRunningSubagentStatus(a.status) ? 0 : 1;
    const bRunning = isRunningSubagentStatus(b.status) ? 0 : 1;
    return aRunning - bRunning;
  });
}

export function extractOverviewSideQuestions(input: {
  readonly persisted: ReadonlyArray<SideQuestionRecord>;
  readonly relationshipShells?: ReadonlyArray<OrchestrationV2ThreadShell> | undefined;
  readonly currentThreadId: ThreadId;
  readonly activeOnly?: boolean;
}): ReadonlyArray<OverviewSideQuestionItem> {
  const activeOnly = input.activeOnly !== false;
  const result: OverviewSideQuestionItem[] = [];
  const linkedThreadIds = new Set<string>();
  const shellById = new Map(
    (input.relationshipShells ?? []).map((shell) => [shell.id, shell] as const),
  );

  for (const record of input.persisted) {
    const linkedShell = record.linkedSideThreadId
      ? shellById.get(record.linkedSideThreadId as ThreadId)
      : undefined;
    if (record.linkedSideThreadId) {
      linkedThreadIds.add(record.linkedSideThreadId);
    }
    const derivedStatus: SideQuestionStatus =
      linkedShell && (linkedShell.activityRunStatus === "running" || linkedShell.status === "running")
        ? "pending"
        : record.status;

    result.push({
      id: record.id,
      title: record.title,
      question: record.question,
      status: derivedStatus,
      answer: record.answer,
      errorMessage: record.errorMessage ?? null,
      contextSummary: record.contextSummary,
      linkedSideThreadId: (record.linkedSideThreadId as ThreadId | null | undefined) ?? null,
      hints: record.hints ?? [],
      createdAt: record.createdAt,
      source: "local",
    });
  }

  for (const shell of input.relationshipShells ?? []) {
    if (shell.id === input.currentThreadId) continue;
    if (shell.lineage.parentThreadId !== input.currentThreadId) continue;
    if (shell.lineage.sideChat !== true) continue;
    if (linkedThreadIds.has(shell.id)) continue;
    linkedThreadIds.add(shell.id);
    const active = shell.activityRunStatus === "running" || shell.status === "running";
    const normalizedTitle = normalizeBtwDisplayTitle(shell.title, "旁路提问");
    result.push({
      id: `native:${shell.id}`,
      title: normalizedTitle,
      question: normalizedTitle,
      status: active ? "pending" : "native",
      answer: null,
      errorMessage: null,
      contextSummary: "",
      linkedSideThreadId: shell.id,
      hints: [],
      createdAt: String(shell.updatedAt ?? ""),
      source: "native",
    });
  }

  if (activeOnly) {
    return result.filter(
      (item) => item.status === "pending" || item.status === "offline" || item.status === "error",
    );
  }
  return result;
}

export function extractOverviewBackgroundTasks(input: {
  readonly daemonPtys?: ReadonlyArray<DaemonPtySessionItem> | undefined;
  readonly terminalSessions?: ReadonlyArray<KnownTerminalSession> | undefined;
  readonly scheduledTasks?: ReadonlyArray<ScheduledTask> | undefined;
  readonly discoveredServers?: ReadonlyArray<DiscoveredLocalServer> | undefined;
  readonly projection?: OrchestrationV2ThreadProjection | null | undefined;
  readonly currentThreadId: ThreadId;
  readonly activeOnly?: boolean;
}): ReadonlyArray<OverviewBackgroundTaskItem> {
  const activeOnly = input.activeOnly !== false;
  const tasks: OverviewBackgroundTaskItem[] = [];
  const seenIds = new Set<string>();

  const pushUnique = (task: OverviewBackgroundTaskItem) => {
    if (seenIds.has(task.id)) return;
    seenIds.add(task.id);
    tasks.push(task);
  };

  // 1. Daemon PersistentPtyPool sessions
  for (const pty of input.daemonPtys ?? []) {
    if (!pty.alive && pty.stale) continue;
    const label = pty.title?.trim() || pty.command?.trim() || `PTY ${pty.id.slice(0, 8)}`;
    const subtitleParts = [
      pty.pid ? `PID ${pty.pid}` : null,
      pty.cwd ? splitRelativePath(pty.cwd).fileName || pty.cwd : null,
      pty.group === "agent-scratch" ? "Agent PTY" : "Daemon PTY",
    ].filter(Boolean);
    pushUnique({
      id: `daemon-pty:${pty.id}`,
      title: label,
      subtitle: subtitleParts.join(" · ") || null,
      status: pty.alive ? "running" : "idle",
      kind: "daemon-pty",
      pid: pty.pid,
    });
  }

  // 2. Active T3 thread terminals
  for (const session of input.terminalSessions ?? []) {
    const summary = session.state.summary;
    const hasRunning = summary?.hasRunningSubprocess === true;
    const status =
      summary?.status === "error"
        ? "failed"
        : hasRunning || summary?.status === "running"
          ? "running"
          : "idle";
    if (status === "idle" && !summary?.label) continue;
    pushUnique({
      id: `terminal:${session.target.terminalId}`,
      title: summary?.label?.trim() || `终端 ${session.target.terminalId.slice(0, 6)}`,
      subtitle: hasRunning ? "执行中 · 会话终端" : "会话终端",
      status,
      kind: "terminal",
      terminalId: session.target.terminalId,
    });
  }

  // 3. Running / monitor command executions in current thread projection
  for (const item of input.projection?.turnItems ?? []) {
    if (item.type !== "command_execution") continue;
    const isRunning = item.status === "running" || item.status === "pending";
    if (!isRunning && item.monitor !== true) continue;
    const cmdLine = item.input.trim().split(/\r?\n/, 1)[0] ?? "后台命令";
    pushUnique({
      id: `cmd:${item.id}`,
      title: cmdLine.length > 64 ? `${cmdLine.slice(0, 61)}…` : cmdLine,
      subtitle: item.monitor ? "监视任务" : isRunning ? "运行中" : "已结束",
      status: isRunning ? "running" : item.status === "failed" ? "failed" : "idle",
      kind: "command",
    });
  }

  // 4. Discovered local dev servers started by this thread
  for (const server of input.discoveredServers ?? []) {
    pushUnique({
      id: `server:${server.pid ?? "na"}:${server.port}`,
      title: `localhost:${server.port}`,
      subtitle: [server.processName, server.terminal === null ? "Agent" : "终端"]
        .filter(Boolean)
        .join(" · "),
      status: "running",
      kind: "server",
      serverPort: server.port,
      pid: server.pid,
    });
  }

  // 5. Thread-bound scheduled tasks / automations
  for (const task of input.scheduledTasks ?? []) {
    if (task.threadId !== input.currentThreadId) continue;
    pushUnique({
      id: `automation:${task.id}`,
      title: task.title,
      subtitle: task.enabled
        ? task.lastRunStatus === "running"
          ? "定时自动化 · 运行中"
          : "定时自动化 · 已启用"
        : "定时自动化 · 已暂停",
      status:
        task.lastRunStatus === "running"
          ? "running"
          : task.lastRunStatus === "failed"
            ? "failed"
            : task.enabled
              ? "scheduled"
              : "idle",
      kind: "automation",
      taskId: task.id,
    });
  }

  const order: Record<OverviewBackgroundTaskItem["status"], number> = {
    running: 0,
    scheduled: 1,
    failed: 2,
    idle: 3,
  };
  const filtered = activeOnly
    ? tasks.filter((task) => task.status === "running" || task.status === "scheduled")
    : tasks;
  return filtered.toSorted((a, b) => order[a.status] - order[b.status]);
}

function parseMarkdownChecklistItems(markdown: string): ReadonlyArray<OverviewGoalItem> {
  const items: OverviewGoalItem[] = [];
  const lines = markdown.split(/\r?\n/);
  let insideFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^\s*```/.test(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;
    const match = /^\s*[-*+]\s+\[([ xX~/-])\]\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const marker = match[1] ?? " ";
    const text = (match[2] ?? "").trim();
    if (!text) continue;
    const status: OverviewGoalItem["status"] =
      marker === "x" || marker === "X"
        ? "completed"
        : marker === "/" || marker === "~"
          ? "running"
          : "pending";
    items.push({
      id: `md-step-${i}`,
      text,
      status,
    });
  }
  return items;
}

function finalizeOverviewGoals(
  allItems: ReadonlyArray<OverviewGoalItem>,
  activeOnly: boolean,
): OverviewGoalsSummary {
  const rawTotal = allItems.length;
  if (rawTotal === 0) {
    return { items: [], completedCount: 0, totalCount: 0, allCompleted: false };
  }
  const completedCount = allItems.filter((item) => item.status === "completed").length;
  const allCompleted = completedCount === rawTotal;
  if (activeOnly) {
    if (allCompleted) {
      return { items: [], completedCount, totalCount: 0, allCompleted: true };
    }
    return {
      items: allItems.filter((item) => item.status !== "completed"),
      completedCount,
      totalCount: rawTotal,
      allCompleted: false,
    };
  }
  return {
    items: allItems,
    completedCount,
    totalCount: rawTotal,
    allCompleted,
  };
}

export function extractOverviewGoals(input: {
  readonly projection?: OrchestrationV2ThreadProjection | null | undefined;
  readonly activeOnly?: boolean;
}): OverviewGoalsSummary {
  const activeOnly = input.activeOnly !== false;
  const projection = input.projection;
  if (!projection) {
    return { items: [], completedCount: 0, totalCount: 0, allCompleted: false };
  }

  // 1. Structured todo_list from projection.plans (latest active/completed non-superseded)
  const todoPlans = projection.plans.filter(
    (plan): plan is Extract<(typeof projection.plans)[number], { readonly kind: "todo_list" }> =>
      plan.kind === "todo_list" && plan.status !== "superseded",
  );
  const latestTodoPlan = todoPlans.at(-1);
  if (latestTodoPlan && latestTodoPlan.steps.length > 0) {
    const items: OverviewGoalItem[] = latestTodoPlan.steps.map((step) => ({
      id: step.id,
      text: step.text,
      status: step.status,
    }));
    return finalizeOverviewGoals(items, activeOnly);
  }

  // 2. Fallback to latest todo_list turn item
  for (let i = projection.turnItems.length - 1; i >= 0; i -= 1) {
    const item = projection.turnItems[i];
    if (item?.type === "todo_list" && item.steps.length > 0) {
      const items: OverviewGoalItem[] = item.steps.map((step) => ({
        id: step.id,
        text: step.text,
        status: step.status,
      }));
      return finalizeOverviewGoals(items, activeOnly);
    }
  }

  // 3. Fallback to Markdown checklist inside latest proposed_plan
  const proposedPlans = projection.plans.filter(
    (
      plan,
    ): plan is Extract<(typeof projection.plans)[number], { readonly kind: "proposed_plan" }> =>
      plan.kind === "proposed_plan" && plan.status !== "superseded",
  );
  const latestProposed = proposedPlans.at(-1);
  if (latestProposed?.markdown) {
    const parsed = parseMarkdownChecklistItems(latestProposed.markdown);
    if (parsed.length > 0) {
      return finalizeOverviewGoals(parsed, activeOnly);
    }
  }

  // 4. Fallback to explicit `/goal ...` user message directives
  const goalItems: OverviewGoalItem[] = [];
  for (const msg of projection.messages) {
    if (msg.role !== "user") continue;
    const match = /^\s*\/goal\s+(.+)$/im.exec(msg.text);
    if (match?.[1]) {
      goalItems.push({
        id: `goal-msg:${msg.id}`,
        text: match[1].trim(),
        status: "running",
      });
    }
  }
  return finalizeOverviewGoals(goalItems, activeOnly);
}

function extractFirstMarkdownHeading(markdown: string): string | null {
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^\s*#{1,3}\s+(.+?)\s*$/.exec(line);
    if (match?.[1]) {
      return match[1].replace(/[*_`]/g, "").trim();
    }
  }
  return null;
}

function isMarkdownFilePath(path: string): boolean {
  return /\.(?:md|mdx)$/i.test(path.trim());
}

export function extractOverviewArtifacts(input: {
  readonly projection?: OrchestrationV2ThreadProjection | null | undefined;
  readonly modifiedFiles?: ReadonlyArray<OverviewModifiedFileItem> | undefined;
  readonly activeOnly?: boolean;
}): ReadonlyArray<OverviewArtifactItem> {
  const activeOnly = input.activeOnly !== false;
  const artifacts: OverviewArtifactItem[] = [];
  const seenKeys = new Set<string>();
  const markdownContentByPath = new Map<string, string>();

  // Collect inline markdown contents from file_change turn items first
  for (const item of input.projection?.turnItems ?? []) {
    if (item.type !== "file_change") continue;
    const content = item.newStr ?? item.diffStr ?? null;
    if (!content) continue;
    if (isMarkdownFilePath(item.fileName)) {
      markdownContentByPath.set(normalizeRepoRelativePath(item.fileName), content);
    }
    for (const change of item.changes ?? []) {
      if (isMarkdownFilePath(change.path)) {
        markdownContentByPath.set(normalizeRepoRelativePath(change.path), content);
      }
    }
  }

  // 1. Proposed plans from projection.plans (always skip superseded; hide completed plans when activeOnly)
  let planIndex = 0;
  for (const plan of input.projection?.plans ?? []) {
    if (plan.kind !== "proposed_plan" || !plan.markdown.trim()) continue;
    if (plan.status === "superseded") continue;
    if (activeOnly && plan.status === "completed") continue;
    planIndex += 1;
    const key = `plan:${plan.id}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const title = extractFirstMarkdownHeading(plan.markdown) ?? `实施计划 #${planIndex}`;
    artifacts.push({
      id: key,
      title,
      relativePath: null,
      subtitle: plan.status === "completed" ? "已完成计划" : "会话计划文档",
      kind: "plan",
      markdown: plan.markdown,
    });
  }

  // 2. Modified/created .md / .mdx files
  for (const file of input.modifiedFiles ?? []) {
    if (!isMarkdownFilePath(file.path)) continue;
    const key = `md:${file.path.toLowerCase()}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    artifacts.push({
      id: key,
      title: file.fileName,
      relativePath: file.path,
      subtitle: file.dirPath || "工作区文档",
      kind: "markdown",
      markdown: markdownContentByPath.get(file.path) ?? null,
    });
  }

  // 3. Markdown paths referenced in assistant messages (excluding http/https URLs)
  const mdLinkRegex = /\[([^\]]+)\]\(([^)\s]+?\.(?:md|mdx)(?:#[^)\s]*)?)\)/gi;
  const inlineMdRegex = /`([A-Za-z0-9_./\\-]+\.(?:md|mdx))`/gi;

  for (const msg of input.projection?.messages ?? []) {
    if (msg.role !== "assistant" || !msg.text) continue;

    for (const match of msg.text.matchAll(mdLinkRegex)) {
      const label = (match[1] ?? "").trim();
      const rawTarget = (match[2] ?? "").replace(/#.*$/, "").trim();
      if (!rawTarget || /^https?:\/\//i.test(rawTarget)) continue;
      const cleaned = rawTarget.replace(/^file:\/\/\/?/i, "");
      const normalized = normalizeRepoRelativePath(cleaned);
      const key = `md:${normalized.toLowerCase()}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const split = splitRelativePath(normalized);
      artifacts.push({
        id: key,
        title: label || split.fileName,
        relativePath: split.normalizedPath,
        subtitle: split.dirPath || "引用文档",
        kind: "markdown",
        markdown: markdownContentByPath.get(split.normalizedPath) ?? null,
      });
    }

    for (const match of msg.text.matchAll(inlineMdRegex)) {
      const rawPath = (match[1] ?? "").trim();
      if (!rawPath || /^https?:\/\//i.test(rawPath)) continue;
      const normalized = normalizeRepoRelativePath(rawPath);
      const key = `md:${normalized.toLowerCase()}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const split = splitRelativePath(normalized);
      artifacts.push({
        id: key,
        title: split.fileName,
        relativePath: split.normalizedPath,
        subtitle: split.dirPath || "引用文档",
        kind: "markdown",
        markdown: markdownContentByPath.get(split.normalizedPath) ?? null,
      });
    }
  }

  return artifacts;
}

export function extractOverviewUploads(input: {
  readonly projection?: OrchestrationV2ThreadProjection | null | undefined;
  readonly threadAttachments?: ReadonlyArray<ChatAttachment> | undefined;
}): ReadonlyArray<OverviewUploadItem> {
  const uploads: OverviewUploadItem[] = [];
  const seen = new Set<string>();

  const pushAttachment = (attachment: ChatAttachment) => {
    const key = attachment.id || `${attachment.name}:${attachment.sizeBytes}`;
    if (seen.has(key)) return;
    seen.add(key);
    const mime = attachment.mimeType.toLowerCase();
    const kind: OverviewUploadItem["kind"] =
      attachment.type === "image" || mime.startsWith("image/")
        ? "image"
        : mime.startsWith("video/")
          ? "video"
          : "file";
    uploads.push({
      id: key,
      name: attachment.name,
      kind,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      sizeLabel: formatByteSize(attachment.sizeBytes),
      attachment,
    });
  };

  for (const message of input.projection?.messages ?? []) {
    if (message.role !== "user") continue;
    for (const attachment of message.attachments ?? []) {
      pushAttachment(attachment);
    }
  }

  for (const item of input.projection?.turnItems ?? []) {
    if (item.type !== "user_message") continue;
    for (const attachment of item.attachments ?? []) {
      pushAttachment(attachment);
    }
  }

  for (const attachment of input.threadAttachments ?? []) {
    pushAttachment(attachment);
  }

  return uploads;
}

function stripCodeFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ");
}

const SLASH_COMMAND_STOPWORDS = new Set([
  "etc",
  "usr",
  "var",
  "tmp",
  "opt",
  "bin",
  "dev",
  "home",
  "root",
  "src",
  "apps",
  "packages",
  "docs",
  "v1",
  "v2",
  "api",
]);

/**
 * Strictly read-only extraction of slash commands and skill references actually invoked
 * in the current session. Complies with AGENTS.md Red Line #2 (never a Skill Center).
 */
export function extractOverviewUsedSkills(input: {
  readonly projection?: OrchestrationV2ThreadProjection | null | undefined;
}): ReadonlyArray<OverviewUsedSkillItem> {
  const projection = input.projection;
  if (!projection) return [];

  const counts = new Map<
    string,
    { id: string; name: string; kind: "command" | "skill"; count: number }
  >();

  const record = (name: string, kind: "command" | "skill") => {
    const normalized = name.trim();
    if (!normalized) return;
    const key = `${kind}:${normalized.toLowerCase()}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { id: key, name: normalized, kind, count: 1 });
    }
  };

  const scanUserText = (rawText: string) => {
    if (!rawText) return;
    const cleaned = stripCodeFences(rawText);

    // Match genuine leading/whitespace-delimited slash commands like `/handoff`, `/plan`, `/grill-me`
    // Avoid URLs (`://...`) and multi-segment paths (`/foo/bar`)
    const slashRegex = /(?:^|[\s\n])\/([a-zA-Z][a-zA-Z0-9_-]{1,31})(?=$|[\s\n.,!?;:）)）])/g;
    for (const match of cleaned.matchAll(slashRegex)) {
      const token = (match[1] ?? "").toLowerCase();
      if (!token || SLASH_COMMAND_STOPWORDS.has(token)) continue;
      record(`/${token}`, "command");
    }

    // Match explicit `$skill-name` mentions in user prompts (e.g. `$tdd`, `$systematic-debugging`)
    const dollarSkillRegex = /(?:^|[\s\n])\$([a-zA-Z][a-zA-Z0-9_-]{1,39})(?=$|[\s\n.,!?;:])/g;
    for (const match of cleaned.matchAll(dollarSkillRegex)) {
      const skillName = match[1];
      if (!skillName) continue;
      // Ignore uppercase env vars like $PATH, $HOME, $USERNAME
      if (skillName === skillName.toUpperCase()) continue;
      record(skillName, "skill");
    }
  };

  const scannedMessageIds = new Set<string>();
  for (const message of projection.messages) {
    if (message.role !== "user") continue;
    scannedMessageIds.add(message.id);
    scanUserText(message.text);
  }

  for (const item of projection.turnItems) {
    if (item.type === "user_message") {
      if (!scannedMessageIds.has(item.messageId)) {
        scannedMessageIds.add(item.messageId);
        scanUserText(item.text);
      }
      continue;
    }

    // Detect explicit SKILL.md reads in dynamic_tool inputs or assistant text
    if (item.type === "dynamic_tool") {
      const serialized =
        typeof item.input === "string"
          ? item.input
          : item.input && typeof item.input === "object"
            ? JSON.stringify(item.input)
            : "";
      const skillPathRegex = /skills[\\/]([a-zA-Z0-9_-]+)[\\/]SKILL\.md/gi;
      for (const match of serialized.matchAll(skillPathRegex)) {
        if (match[1]) record(match[1], "skill");
      }
    }
  }

  return Array.from(counts.values()).toSorted((a, b) => b.count - a.count);
}

export function buildSideQuestionContextSummary(input: {
  readonly threadTitle?: string | null | undefined;
  readonly cwd?: string | null | undefined;
  readonly projection?: OrchestrationV2ThreadProjection | null | undefined;
  readonly modifiedFiles?: ReadonlyArray<OverviewModifiedFileItem> | undefined;
  readonly maxChars?: number | undefined;
}): string {
  const maxChars = Math.max(300, input.maxChars ?? DEFAULT_CONTEXT_SUMMARY_MAX_CHARS);
  const parts: string[] = [];

  if (input.threadTitle?.trim()) {
    parts.push(`当前会话：${input.threadTitle.trim()}`);
  }
  if (input.cwd?.trim()) {
    parts.push(`工作目录：${input.cwd.trim()}`);
  }

  const files = (input.modifiedFiles ?? []).slice(0, 8);
  if (files.length > 0) {
    parts.push(`已修改文件：${files.map((f) => f.path).join("、")}`);
  }

  const recentMessages = (input.projection?.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.text.trim().length > 0)
    .slice(-4);

  if (recentMessages.length > 0) {
    const excerpts = recentMessages.map((m) => {
      const role = m.role === "user" ? "用户" : "助手";
      const snippet = m.text.trim().replace(/\s+/g, " ").slice(0, 260);
      return `- [${role}] ${snippet}`;
    });
    parts.push(`近期对话摘要：\n${excerpts.join("\n")}`);
  }

  const joined = parts.join("\n");
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, maxChars - 1)}…`;
}

export function buildSideQuestionPrompt(question: string, contextSummary: string): string {
  const trimmedQuestion = question.trim();
  const lines = [
    "[旁路只读提问 · Read-Only Side Question]",
    "请仅针对下面的问题进行简洁、准确的只读回答，不要修改任何工作区文件，也不要执行破坏性命令。",
  ];
  if (contextSummary.trim()) {
    lines.push("", "【当前主会话上下文摘要】", contextSummary.trim());
  }
  lines.push("", "【提问】", trimmedQuestion);
  return lines.join("\n");
}

export function deriveSideQuestionTitle(question: string): string {
  const firstLine = question.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!firstLine) return "旁路提问";
  return firstLine.length > 44 ? `${firstLine.slice(0, 43)}…` : firstLine;
}

export function sideQuestionStorageKey(environmentId: string, threadId: string): string {
  return `${SIDE_QUESTIONS_STORAGE_PREFIX}${environmentId}:${threadId}`;
}

function resolveBrowserStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeOverviewLimitMode(value: unknown): OverviewSectionLimitMode {
  if (value === "auto" || value === 2 || value === 3 || value === 5 || value === 8) {
    return value;
  }
  return DEFAULT_OVERVIEW_DISPLAY_PREFS.limitMode;
}

export function loadOverviewDisplayPrefs(storage?: Storage | null): OverviewDisplayPrefs {
  const target = resolveBrowserStorage(storage);
  if (!target) return DEFAULT_OVERVIEW_DISPLAY_PREFS;
  try {
    const raw = target.getItem(OVERVIEW_DISPLAY_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_OVERVIEW_DISPLAY_PREFS;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return DEFAULT_OVERVIEW_DISPLAY_PREFS;
    const rec = parsed as Record<string, unknown>;
    return {
      limitMode: normalizeOverviewLimitMode(rec.limitMode),
      showCompleted: rec.showCompleted === true,
    };
  } catch {
    return DEFAULT_OVERVIEW_DISPLAY_PREFS;
  }
}

export function saveOverviewDisplayPrefs(
  prefs: OverviewDisplayPrefs,
  storage?: Storage | null,
): void {
  const target = resolveBrowserStorage(storage);
  if (!target) return;
  try {
    target.setItem(
      OVERVIEW_DISPLAY_PREFS_STORAGE_KEY,
      JSON.stringify({
        limitMode: normalizeOverviewLimitMode(prefs.limitMode),
        showCompleted: prefs.showCompleted === true,
      }),
    );
  } catch {
    // Ignore quota / private mode failures gracefully.
  }
}

export function loadPersistedSideQuestions(
  environmentId: string,
  threadId: string,
  storage?: Storage | null,
): ReadonlyArray<SideQuestionRecord> {
  const target = resolveBrowserStorage(storage);
  if (!target) return [];
  try {
    const raw = target.getItem(sideQuestionStorageKey(environmentId, threadId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is SideQuestionRecord => {
      if (!entry || typeof entry !== "object") return false;
      const rec = entry as Record<string, unknown>;
      return (
        typeof rec.id === "string" &&
        typeof rec.title === "string" &&
        typeof rec.question === "string" &&
        typeof rec.status === "string" &&
        typeof rec.createdAt === "string"
      );
    });
  } catch {
    return [];
  }
}

export function savePersistedSideQuestions(
  environmentId: string,
  threadId: string,
  records: ReadonlyArray<SideQuestionRecord>,
  storage?: Storage | null,
): void {
  const target = resolveBrowserStorage(storage);
  if (!target) return;
  try {
    target.setItem(
      sideQuestionStorageKey(environmentId, threadId),
      JSON.stringify(records.slice(0, MAX_PERSISTED_SIDE_QUESTIONS)),
    );
  } catch {
    // Ignore quota / private mode failures gracefully.
  }
}

export function createSideQuestionRecord(input: {
  readonly id?: string;
  readonly question: string;
  readonly contextSummary: string;
  readonly status?: SideQuestionStatus;
  readonly answer?: string | null;
  readonly errorMessage?: string | null;
  readonly linkedSideThreadId?: string | null;
  readonly hints?: ReadonlyArray<string>;
  readonly nowIso?: string;
}): SideQuestionRecord {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const id =
    input.id ??
    `sq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: deriveSideQuestionTitle(input.question),
    question: input.question.trim(),
    contextSummary: input.contextSummary,
    status: input.status ?? "pending",
    answer: input.answer ?? null,
    errorMessage: input.errorMessage ?? null,
    linkedSideThreadId: input.linkedSideThreadId ?? null,
    hints: input.hints ? [...input.hints] : [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function upsertSideQuestionRecord(
  records: ReadonlyArray<SideQuestionRecord>,
  next: SideQuestionRecord,
): ReadonlyArray<SideQuestionRecord> {
  const index = records.findIndex((item) => item.id === next.id);
  if (index < 0) {
    return [next, ...records].slice(0, MAX_PERSISTED_SIDE_QUESTIONS);
  }
  const copy = [...records];
  copy[index] = next;
  return copy;
}

export function removeSideQuestionRecord(
  records: ReadonlyArray<SideQuestionRecord>,
  id: string,
): ReadonlyArray<SideQuestionRecord> {
  return records.filter((item) => item.id !== id);
}
