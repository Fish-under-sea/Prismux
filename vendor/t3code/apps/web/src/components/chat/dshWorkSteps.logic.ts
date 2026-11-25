import type { RunId } from "@t3tools/contracts";
import {
  DEFAULT_COLLAPSED_ASSISTANT_REPLY_MODE,
  DEFAULT_WORK_STEPS_COLLAPSE_TIMING,
  DEFAULT_WORK_STEPS_DISPLAY,
  type CollapsedAssistantReplyMode,
  type WorkStepsCollapseTiming,
  type WorkStepsDisplay,
} from "@t3tools/contracts/settings";
import {
  liveThoughtLine,
  toolGroupAction,
  workEntryViewedImagePath,
} from "@t3tools/client-runtime/work-log/presentation";
import { collectToolFilePaths, isJavaScriptReplTool } from "@t3tools/shared/toolActivity";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import type { WorkLogEntry } from "../../session-logic";
import type { WorkEntryIconName } from "./TimelineToolActivityIcon";

/** Minimum duration (ms) a live step header holds before swapping on rapid bursts (matches DSH). */
export const PROCESS_TITLE_MINIMUM_MS = 150;

/** Maximum grapheme length for live step-process detail text (`verb · detail`). */
export const LIVE_PROCESS_DETAIL_MAX_GRAPHEMES = 160;

export type WorkStepsStepGrouping = "collapsed" | "history" | "none";

export interface WorkStepsPresentationPolicy {
  readonly mode: WorkStepsDisplay;
  /** Whether completed turns fold behind an outer whole-turn process bar. */
  readonly foldCompletedTurns: boolean;
  /**
   * How contiguous reasoning + tool calls between assistant replies are grouped:
   * - `"collapsed"`: step groups always collapsed by default (`concise` / `standard`)
   * - `"history"`: active turn & latest completed turn (when `next-message`) render flat un-grouped; historical turns collapse (`detailed`)
   * - `"none"`: never group steps; all thinking blocks & every tool call stay flat inline (`expanded`)
   */
  readonly stepGrouping: WorkStepsStepGrouping;
  /** Whether live step-process headers append ` · <detail>` after the activity verb. */
  readonly liveProcessDetail: boolean;
  /** Whether settled (collapsed) reasoning rows preview their first line. */
  readonly settledReasoningPreview: boolean;
}

const PRESENTATION_POLICY_BY_MODE: Readonly<Record<WorkStepsDisplay, WorkStepsPresentationPolicy>> =
  {
    concise: {
      mode: "concise",
      foldCompletedTurns: true,
      stepGrouping: "collapsed",
      liveProcessDetail: false,
      settledReasoningPreview: false,
    },
    standard: {
      mode: "standard",
      foldCompletedTurns: true,
      stepGrouping: "collapsed",
      liveProcessDetail: true,
      settledReasoningPreview: true,
    },
    detailed: {
      mode: "detailed",
      foldCompletedTurns: true,
      stepGrouping: "history",
      liveProcessDetail: true,
      settledReasoningPreview: true,
    },
    expanded: {
      mode: "expanded",
      foldCompletedTurns: false,
      stepGrouping: "none",
      liveProcessDetail: false,
      settledReasoningPreview: true,
    },
  };

export function resolveWorkStepsPolicy(
  display: WorkStepsDisplay | undefined = DEFAULT_WORK_STEPS_DISPLAY,
): WorkStepsPresentationPolicy {
  return PRESENTATION_POLICY_BY_MODE[display ?? DEFAULT_WORK_STEPS_DISPLAY];
}

export function shouldGroupWorkStepsForTurn(
  policy: WorkStepsPresentationPolicy,
  options: {
    readonly isActiveTurn: boolean;
    readonly isBottomCompletedTurn: boolean;
    readonly collapseTiming: WorkStepsCollapseTiming;
  },
): boolean {
  if (policy.stepGrouping === "none") return false;
  if (policy.stepGrouping === "collapsed") return true;
  if (options.isActiveTurn) return false;
  if (options.isBottomCompletedTurn && options.collapseTiming === "next-message") return false;
  return true;
}

export function shouldTurnFoldDefaultOpen(options: {
  readonly isBottomCompletedTurn: boolean;
  readonly collapseTiming: WorkStepsCollapseTiming;
}): boolean {
  return options.isBottomCompletedTurn && options.collapseTiming === "next-message";
}

export function resolveTurnFoldExpanded(options: {
  readonly runId: RunId;
  readonly isBottomCompletedTurn: boolean;
  readonly collapseTiming: WorkStepsCollapseTiming;
  readonly expandedRunIds?: ReadonlySet<RunId> | undefined;
  readonly collapsedRunIds?: ReadonlySet<RunId> | undefined;
}): boolean {
  if (
    shouldTurnFoldDefaultOpen({
      isBottomCompletedTurn: options.isBottomCompletedTurn,
      collapseTiming: options.collapseTiming,
    })
  ) {
    return !(options.collapsedRunIds?.has(options.runId) ?? false);
  }
  return options.expandedRunIds?.has(options.runId) ?? false;
}

export function shouldKeepIntermediateAssistantRepliesVisible(
  mode: CollapsedAssistantReplyMode | undefined = DEFAULT_COLLAPSED_ASSISTANT_REPLY_MODE,
): boolean {
  return mode === "all";
}

export type DshActivityCategory =
  | "thinking"
  | "read"
  | "readImage"
  | "search"
  | "edit"
  | "write"
  | "commands"
  | "code"
  | "webSearch"
  | "webFetch"
  | "subagents"
  | "plan"
  | "questions"
  | "tools"
  | "context";

function isZhLocale(locale: string | undefined): boolean {
  if (!locale) return true;
  return locale.toLowerCase().startsWith("zh");
}

function workEntryToolNameLower(entry: WorkLogEntry): string {
  const payload = entry.structuredPayload;
  if (payload?.type === "dynamic_tool") {
    return (payload.toolName ?? "").trim().toLowerCase();
  }
  return (entry.toolTitle ?? entry.label ?? "").trim().toLowerCase();
}

export function classifyWorkEntryActivity(entry: WorkLogEntry): DshActivityCategory {
  if (entry.itemType === "reasoning" || entry.tone === "thinking") {
    return "thinking";
  }
  if (entry.sourceActivityKind === "context-compaction") {
    return "context";
  }
  if (workEntryViewedImagePath(entry)) {
    return "readImage";
  }
  if (entry.itemType === "todo_list") {
    return "plan";
  }
  if (
    entry.questionAnswer !== undefined ||
    entry.itemType === "user_input_request" ||
    entry.itemType === "approval_request"
  ) {
    return "questions";
  }
  if (
    entry.itemType === "subagent" ||
    entry.structuredPayload?.type === "notification" ||
    entry.projectedItem?.item.type === "thread_created"
  ) {
    return "subagents";
  }
  const toolName = workEntryToolNameLower(entry);
  if (
    entry.structuredPayload?.type === "dynamic_tool" &&
    isJavaScriptReplTool(entry.structuredPayload.toolName)
  ) {
    return "code";
  }
  if (
    toolName.includes("webfetch") ||
    toolName.includes("web_fetch") ||
    toolName.includes("fetch_url") ||
    toolName === "fetch"
  ) {
    return "webFetch";
  }
  if (
    toolName.includes("websearch") ||
    toolName.includes("web_search") ||
    entry.itemType === "web_search"
  ) {
    return "webSearch";
  }
  if (
    toolName === "write" ||
    toolName === "write_file" ||
    toolName === "create_file" ||
    toolName === "write_to_file" ||
    toolName.endsWith("_write_file")
  ) {
    return "write";
  }
  if (
    toolName.includes("todo") ||
    toolName.includes("plan") ||
    toolName.includes("task_boundary")
  ) {
    return "plan";
  }
  if (
    toolName.includes("subagent") ||
    toolName.includes("delegate") ||
    toolName === "agent" ||
    toolName === "task"
  ) {
    return "subagents";
  }
  const action = toolGroupAction(entry);
  switch (action) {
    case "read":
      return "read";
    case "code-search":
      return "search";
    case "edit":
      return "edit";
    case "command":
      return "commands";
    case "search":
      return "webSearch";
    case "browser":
      return "webFetch";
    case "thread-create":
      return "subagents";
    default:
      break;
  }
  if (entry.itemType === "file_search" || toolName.includes("grep") || toolName.includes("glob")) {
    return "search";
  }
  if (entry.itemType === "command_execution" || Boolean(entry.command?.trim())) {
    return "commands";
  }
  if (entry.itemType === "file_change") {
    return "edit";
  }
  return "tools";
}

export function dshActivityCategoryIconName(category: DshActivityCategory): WorkEntryIconName {
  switch (category) {
    case "thinking":
      return "brain";
    case "read":
    case "readImage":
      return "eye";
    case "search":
      return "search";
    case "edit":
    case "write":
      return "square-pen";
    case "commands":
      return "terminal";
    case "code":
      return "code";
    case "webSearch":
      return "globe";
    case "webFetch":
      return "browser";
    case "subagents":
      return "bot";
    case "plan":
      return "list-todo";
    case "questions":
      return "message-circle";
    case "context":
      return "zap";
    case "tools":
      return "wrench";
  }
}

function truncateGraphemes(text: string, maxLength = LIVE_PROCESS_DETAIL_MAX_GRAPHEMES): string {
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return `${chars.slice(0, Math.max(1, maxLength - 1)).join("").trimEnd()}…`;
}

function sanitizeInlineLine(raw: string): string {
  return raw
    .replace(/\*\*/g, "")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#+\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts a single-line reasoning summary matching DSH's ReasoningRow rules:
 * - Strips `**` markdown bold markers
 * - Live: latest completed paragraph's first line (falling back to current line)
 * - Settled: first non-empty line, or `null` when `!settledReasoningPreview` (`concise`)
 */
export function extractReasoningSummaryLine(
  text: string | null | undefined,
  options: {
    readonly live: boolean;
    readonly settledReasoningPreview: boolean;
  },
): string | null {
  if (!options.live && !options.settledReasoningPreview) {
    return null;
  }
  const trimmed = text?.trim();
  if (!trimmed) return null;

  if (options.live) {
    const liveLine = liveThoughtLine(trimmed);
    const cleanedLive = sanitizeInlineLine(liveLine);
    if (cleanedLive) {
      return truncateGraphemes(cleanedLive);
    }
    const paragraphs = trimmed
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
    const targetParagraph =
      paragraphs.length >= 2 ? paragraphs[paragraphs.length - 2]! : paragraphs[0]!;
    const firstLine = targetParagraph
      .split(/\r?\n/)
      .map(sanitizeInlineLine)
      .find((line) => line.length > 0);
    return firstLine ? truncateGraphemes(firstLine) : null;
  }

  const firstLine = trimmed
    .split(/\r?\n/)
    .map(sanitizeInlineLine)
    .find((line) => line.length > 0);
  return firstLine ? truncateGraphemes(firstLine) : null;
}

const LIVE_DETAIL_ARG_KEYS = [
  "title",
  "description",
  "objective",
  "task",
  "question",
  "command",
  "query",
  "pattern",
  "url",
  "file_path",
  "filePath",
  "path",
] as const;

function readRecordStringField(
  record: Record<string, unknown> | undefined,
  workspaceRoot?: string,
): string | null {
  if (!record) return null;
  for (const key of LIVE_DETAIL_ARG_KEYS) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const cleaned = sanitizeInlineLine(value);
    if (!cleaned) continue;
    if (key === "file_path" || key === "filePath" || key === "path") {
      return truncateGraphemes(formatWorkspaceRelativePath(cleaned, workspaceRoot));
    }
    return truncateGraphemes(cleaned);
  }
  return null;
}

export function extractWorkEntryLiveDetail(
  entry: WorkLogEntry,
  workspaceRoot?: string,
): string | null {
  if (entry.itemType === "reasoning" || entry.tone === "thinking") {
    return extractReasoningSummaryLine(entry.detail, {
      live: true,
      settledReasoningPreview: true,
    });
  }
  const structuredInput =
    entry.structuredPayload?.type === "dynamic_tool" &&
    entry.structuredPayload.input !== null &&
    typeof entry.structuredPayload.input === "object" &&
    !Array.isArray(entry.structuredPayload.input)
      ? (entry.structuredPayload.input as Record<string, unknown>)
      : undefined;
  const fromStructured = readRecordStringField(structuredInput, workspaceRoot);
  if (fromStructured) return fromStructured;

  const toolDataRecord =
    entry.toolData !== null && typeof entry.toolData === "object" && !Array.isArray(entry.toolData)
      ? (entry.toolData as Record<string, unknown>)
      : undefined;
  const fromToolDataInput =
    toolDataRecord?.input !== null &&
    typeof toolDataRecord?.input === "object" &&
    !Array.isArray(toolDataRecord?.input)
      ? readRecordStringField(toolDataRecord.input as Record<string, unknown>, workspaceRoot)
      : null;
  if (fromToolDataInput) return fromToolDataInput;

  const fromToolData = readRecordStringField(toolDataRecord, workspaceRoot);
  if (fromToolData) return fromToolData;

  if (entry.command?.trim()) {
    return truncateGraphemes(sanitizeInlineLine(entry.command));
  }
  const paths = [
    ...(entry.changedFiles ?? []),
    ...collectToolFilePaths(structuredInput ? { input: structuredInput } : toolDataRecord),
  ];
  const firstPath = paths[0]?.trim();
  if (firstPath) {
    return truncateGraphemes(formatWorkspaceRelativePath(firstPath, workspaceRoot));
  }
  const firstDetailLine = entry.detail
    ?.split(/\r?\n/)
    .map(sanitizeInlineLine)
    .find((line) => line.length > 0);
  return firstDetailLine ? truncateGraphemes(firstDetailLine) : null;
}

const LIVE_VERB_ZH: Readonly<Record<DshActivityCategory, string>> = {
  thinking: "正在思考",
  read: "正在读取文件",
  readImage: "正在查看图片",
  search: "正在搜索代码",
  edit: "正在修改文件",
  write: "正在写入文件",
  commands: "正在执行命令",
  code: "正在运行代码",
  webSearch: "正在搜索网页",
  webFetch: "正在获取网页",
  subagents: "正在调度子代理",
  plan: "正在更新计划",
  questions: "正在等待确认",
  context: "正在整理上下文",
  tools: "正在调用工具",
};

const LIVE_VERB_EN: Readonly<Record<DshActivityCategory, string>> = {
  thinking: "Thinking",
  read: "Reading file",
  readImage: "Viewing image",
  search: "Searching code",
  edit: "Editing file",
  write: "Writing file",
  commands: "Running command",
  code: "Running code",
  webSearch: "Searching web",
  webFetch: "Fetching web page",
  subagents: "Running subagent",
  plan: "Updating plan",
  questions: "Waiting for confirmation",
  context: "Compacting context",
  tools: "Calling tool",
};

export function formatDshLiveActivityLabel(
  entry: WorkLogEntry,
  options: {
    readonly liveProcessDetail: boolean;
    readonly workspaceRoot?: string | undefined;
    readonly locale?: string | undefined;
  },
): {
  readonly verb: string;
  readonly detail: string | null;
  readonly text: string;
  readonly category: DshActivityCategory;
} {
  const category = classifyWorkEntryActivity(entry);
  const verb = isZhLocale(options.locale) ? LIVE_VERB_ZH[category] : LIVE_VERB_EN[category];
  const detail = options.liveProcessDetail
    ? extractWorkEntryLiveDetail(entry, options.workspaceRoot)
    : null;
  return {
    verb,
    detail,
    text: detail ? `${verb} · ${detail}` : verb,
    category,
  };
}

const CLOSED_CHIP_ZH: Readonly<
  Record<DshActivityCategory, { readonly primary: string; readonly secondary: string }>
> = {
  thinking: { primary: "已思考", secondary: "进行了思考" },
  read: { primary: "已读取文件", secondary: "读取了文件" },
  readImage: { primary: "已查看图片", secondary: "查看了图片" },
  search: { primary: "已搜索代码", secondary: "搜索了代码" },
  edit: { primary: "已修改文件", secondary: "修改了文件" },
  write: { primary: "已写入文件", secondary: "写入了文件" },
  commands: { primary: "已执行命令", secondary: "执行了命令" },
  code: { primary: "已运行代码", secondary: "运行了代码" },
  webSearch: { primary: "已搜索网页", secondary: "搜索了网页" },
  webFetch: { primary: "已获取网页", secondary: "获取了网页" },
  subagents: { primary: "已调用子代理", secondary: "调用了子代理" },
  plan: { primary: "已更新计划", secondary: "更新了计划" },
  questions: { primary: "已完成交互", secondary: "完成了交互" },
  context: { primary: "已整理上下文", secondary: "整理了上下文" },
  tools: { primary: "已调用工具", secondary: "调用了工具" },
};

const CLOSED_CHIP_EN: Readonly<Record<DshActivityCategory, string>> = {
  thinking: "Thought",
  read: "Read files",
  readImage: "Viewed images",
  search: "Searched code",
  edit: "Edited files",
  write: "Wrote files",
  commands: "Ran commands",
  code: "Ran code",
  webSearch: "Searched web",
  webFetch: "Fetched web pages",
  subagents: "Ran subagents",
  plan: "Updated plan",
  questions: "Completed prompts",
  context: "Compacted context",
  tools: "Used tools",
};

const DSH_FALLBACK_STEP_SUMMARY = {
  zh: "已执行步骤",
  en: "Completed steps",
} as const;

const DSH_TURN_FOLD_COPY = {
  zh: {
    failed: "处理失败",
    interrupted: "已停止",
    completedPrefix: "已完成，用时 ",
    completed: "已完成",
  },
  en: {
    failed: "Failed",
    interrupted: "Stopped",
    completedPrefix: "Completed in ",
    completed: "Completed",
  },
} as const;

/** Formats DSH count-free step-group category summaries (up to 3 categories plus ellipsis). */
export function formatDshStepGroupSummary(
  entries: ReadonlyArray<WorkLogEntry>,
  locale?: string,
): string {
  const ordered: DshActivityCategory[] = [];
  const seen = new Set<DshActivityCategory>();
  for (const entry of entries) {
    const category = classifyWorkEntryActivity(entry);
    if (!seen.has(category)) {
      seen.add(category);
      ordered.push(category);
    }
  }
  const nonThinking = ordered.filter((category) => category !== "thinking");
  const categories = nonThinking.length > 0 ? nonThinking : ordered;
  if (categories.length === 0) {
    return isZhLocale(locale) ? DSH_FALLBACK_STEP_SUMMARY.zh : DSH_FALLBACK_STEP_SUMMARY.en;
  }

  const top3 = categories.slice(0, 3);
  const hasMore = categories.length > 3;

  if (!isZhLocale(locale)) {
    const labels = top3.map((cat) => CLOSED_CHIP_EN[cat]);
    let joined: string;
    if (labels.length === 1) {
      joined = labels[0]!;
    } else if (labels.length === 2) {
      joined = `${labels[0]} and ${labels[1]!.charAt(0).toLowerCase()}${labels[1]!.slice(1)}`;
    } else {
      joined = labels.join(", ");
    }
    return hasMore ? `${joined}, etc.` : joined;
  }

  if (top3.length === 1) {
    return CLOSED_CHIP_ZH[top3[0]!].primary;
  }
  if (top3.length === 2) {
    const first = CLOSED_CHIP_ZH[top3[0]!].primary;
    const second = CLOSED_CHIP_ZH[top3[1]!].primary;
    if (first.startsWith("已") && second.startsWith("已")) {
      return `${first}并${second.slice(1)}`;
    }
    return `${first}，${second}`;
  }
  const first = CLOSED_CHIP_ZH[top3[0]!].primary;
  const second = CLOSED_CHIP_ZH[top3[1]!].secondary;
  const third = CLOSED_CHIP_ZH[top3[2]!].secondary;
  const joined = `${first}，${second}，${third}`;
  return hasMore ? `${joined}等` : joined;
}

export function formatDshDurationCompact(elapsedMs: number): string {
  const totalSeconds = Math.max(1, Math.round(elapsedMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

export interface FormattedTurnFoldLabel {
  readonly prefix: string;
  readonly durationNumber: string | null;
  readonly fullText: string;
}

export function formatDshTurnFoldLabel(input: {
  readonly elapsedMs: number | null;
  readonly status: "completed" | "interrupted" | "error";
  readonly locale?: string | undefined;
}): FormattedTurnFoldLabel {
  const copy = isZhLocale(input.locale) ? DSH_TURN_FOLD_COPY.zh : DSH_TURN_FOLD_COPY.en;
  if (input.status === "error") {
    return { prefix: copy.failed, durationNumber: null, fullText: copy.failed };
  }
  if (input.status === "interrupted") {
    return { prefix: copy.interrupted, durationNumber: null, fullText: copy.interrupted };
  }
  if (input.elapsedMs !== null && Number.isFinite(input.elapsedMs)) {
    const durationNumber = formatDshDurationCompact(input.elapsedMs);
    return {
      prefix: copy.completedPrefix,
      durationNumber,
      fullText: `${copy.completedPrefix}${durationNumber}`,
    };
  }
  return { prefix: copy.completed, durationNumber: null, fullText: copy.completed };
}

export const DEFAULT_WORK_STEPS_SETTINGS = {
  workStepsDisplay: DEFAULT_WORK_STEPS_DISPLAY,
  workStepsCollapseTiming: DEFAULT_WORK_STEPS_COLLAPSE_TIMING,
  collapsedAssistantReplyMode: DEFAULT_COLLAPSED_ASSISTANT_REPLY_MODE,
} as const;
