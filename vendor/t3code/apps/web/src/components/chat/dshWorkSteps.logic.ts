import * as DateTime from "effect/DateTime";
import type { RunId } from "@t3tools/contracts";
import {
  DEFAULT_COLLAPSED_ASSISTANT_REPLY_MODE,
  DEFAULT_WORK_STEPS_COLLAPSE_TIMING,
  DEFAULT_WORK_STEPS_DISPLAY,
  type CollapsedAssistantReplyMode,
  type WorkStepsCollapseTiming,
  type WorkStepsDisplay,
} from "@t3tools/contracts/settings";
import { commandDisplayText } from "@t3tools/client-runtime/work-log/command-label";
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
    return truncateGraphemes(sanitizeInlineLine(stripShellCommandWrapper(entry.command).displayCommand));
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

export interface StrippedShellCommand {
  readonly displayCommand: string;
  readonly rawCommand: string;
  readonly wasWrapped: boolean;
  readonly shellLabel: string | null;
}

const POWERSHELL_WRAPPER_FLAGS = new Set([
  "-noprofile",
  "-nologo",
  "-noninteractive",
  "-mta",
  "-sta",
  "-nop",
  "-noni",
]);
const POWERSHELL_WRAPPER_OPTIONS = new Set([
  "-executionpolicy",
  "-ep",
  "-windowstyle",
  "-w",
  "-workingdirectory",
  "-version",
  "-inputformat",
  "-outputformat",
  "-configurationname",
]);

function unwrapBalancedShellQuote(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 2) return trimmed;
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'").trim();
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\(["\\$`])/gu, "$1")
      .trim();
  }
  return trimmed;
}

function detectShellWrapperName(rawCommand: string): string | null {
  const match = rawCommand
    .trim()
    .match(
      /^(?:"([^"]+)"|'([^']+)'|([^\s]+))/u,
    );
  const exe = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "")
    .replaceAll("\\\\", "\\")
    .split(/[\\/]/u)
    .at(-1)
    ?.toLowerCase()
    .replace(/\.exe$/u, "");
  if (
    exe === "pwsh" ||
    exe === "powershell" ||
    exe === "cmd" ||
    exe === "bash" ||
    exe === "zsh" ||
    exe === "sh" ||
    exe === "dash" ||
    exe === "fish"
  ) {
    return exe;
  }
  return null;
}

/**
 * Strips noisy Windows / POSIX shell invocation wrappers (including double-escaped
 * `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command '...'` and `cmd.exe /c ...`)
 * so command headers & `$ <cmd>` bars stay ultra-clean while keeping `rawCommand` inspectable.
 */
export function stripShellCommandWrapper(rawCommand: string): StrippedShellCommand {
  const raw = rawCommand.trim();
  if (!raw) {
    return { displayCommand: "", rawCommand: raw, wasWrapped: false, shellLabel: null };
  }
  const shellLabel = detectShellWrapperName(raw);
  // First normalize double-escaped Windows executable paths inside the leading quoted executable.
  const normalizedLeading = raw.replace(
    /^"([A-Za-z]:\\\\[^"]+)"/u,
    (_whole, inner: string) => `"${inner.replaceAll("\\\\", "\\")}"`,
  );
  const standardDisplay = commandDisplayText(normalizedLeading).trim();
  if (standardDisplay && standardDisplay !== normalizedLeading && standardDisplay !== raw) {
    return {
      displayCommand: standardDisplay,
      rawCommand: raw,
      wasWrapped: true,
      shellLabel,
    };
  }

  // Regex fallback for wrappers with flags/escaping that strict tokenizer kept intact.
  const leadingMatch = normalizedLeading.match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))\s+([\s\S]+)$/u);
  if (leadingMatch && shellLabel !== null) {
    let rest = leadingMatch[4]!.trim();
    if (shellLabel === "pwsh" || shellLabel === "powershell") {
      // Consume leading PowerShell flags/options until -Command / -c
      while (rest.length > 0) {
        const flagMatch = rest.match(/^(-[A-Za-z]+)(?:\s+([\s\S]*))?$/u);
        if (!flagMatch) break;
        const flag = flagMatch[1]!.toLowerCase();
        const afterFlag = (flagMatch[2] ?? "").trim();
        if (flag === "-command" || flag === "-c") {
          const inner = unwrapBalancedShellQuote(afterFlag);
          if (inner) {
            return {
              displayCommand: commandDisplayText(inner).trim() || inner,
              rawCommand: raw,
              wasWrapped: true,
              shellLabel,
            };
          }
          break;
        }
        if (POWERSHELL_WRAPPER_FLAGS.has(flag)) {
          rest = afterFlag;
          continue;
        }
        if (POWERSHELL_WRAPPER_OPTIONS.has(flag)) {
          const optVal = afterFlag.match(/^(?:"[^"]*"|'[^']*'|\S+)\s*([\s\S]*)$/u);
          if (!optVal) break;
          rest = (optVal[1] ?? "").trim();
          continue;
        }
        break;
      }
    } else if (shellLabel === "cmd") {
      const cmdMatch = rest.match(/^(?:\/[a-zA-Z](?::\S+)?\s+)*\/[cCkK]\s+([\s\S]+)$/u);
      if (cmdMatch?.[1]) {
        const inner = unwrapBalancedShellQuote(cmdMatch[1]);
        if (inner) {
          return {
            displayCommand: commandDisplayText(inner).trim() || inner,
            rawCommand: raw,
            wasWrapped: true,
            shellLabel,
          };
        }
      }
    } else {
      const posixMatch = rest.match(/^(?:-[a-zA-Z]*c[a-zA-Z]*|--command)\s+([\s\S]+)$/u);
      if (posixMatch?.[1]) {
        const inner = unwrapBalancedShellQuote(posixMatch[1]);
        if (inner) {
          return {
            displayCommand: commandDisplayText(inner).trim() || inner,
            rawCommand: raw,
            wasWrapped: true,
            shellLabel,
          };
        }
      }
    }
  }

  return {
    displayCommand: standardDisplay || raw,
    rawCommand: raw,
    wasWrapped: false,
    shellLabel: null,
  };
}

function toEpochMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (DateTime.isDateTime(value)) {
    return DateTime.toEpochMillis(value);
  }
  return null;
}

export function resolveWorkEntryElapsedMs(entry: WorkLogEntry): number | null {
  const toolData =
    entry.toolData !== null && typeof entry.toolData === "object" && !Array.isArray(entry.toolData)
      ? (entry.toolData as Record<string, unknown>)
      : undefined;
  if (
    typeof toolData?.durationMs === "number" &&
    Number.isFinite(toolData.durationMs) &&
    toolData.durationMs >= 0
  ) {
    return toolData.durationMs;
  }
  const item = entry.projectedItem?.item ?? entry.structuredPayload;
  if (!item) return null;
  const startMs = toEpochMs(item.startedAt);
  const endMs = toEpochMs(item.completedAt);
  if (startMs === null || endMs === null || endMs < startMs) return null;
  return endMs - startMs;
}

export function formatWorkStepElapsedMs(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "";
  if (elapsedMs < 1_000) {
    return `${Math.max(1, Math.round(elapsedMs))}ms`;
  }
  const seconds = elapsedMs / 1_000;
  if (seconds < 10) {
    return `${seconds.toFixed(1).replace(/\.0$/u, "")}s`;
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  return formatDshDurationCompact(elapsedMs);
}

const THINKING_HEADER_COPY = {
  zh: {
    live: "正在思考",
    settled: "思考",
    settledPrefix: "思考了 ",
  },
  en: {
    live: "Thinking",
    settled: "Thought",
    settledPrefix: "Thought for ",
  },
} as const;

export function formatThinkingHeaderLabel(input: {
  readonly live: boolean;
  readonly elapsedMs?: number | null | undefined;
  readonly locale?: string | undefined;
}): string {
  const copy = THINKING_HEADER_COPY[isZhLocale(input.locale) ? "zh" : "en"];
  if (input.live) {
    return copy.live;
  }
  if (
    input.elapsedMs !== null &&
    input.elapsedMs !== undefined &&
    Number.isFinite(input.elapsedMs) &&
    input.elapsedMs >= 100
  ) {
    return `${copy.settledPrefix}${formatWorkStepElapsedMs(input.elapsedMs)}`;
  }
  return copy.settled;
}

export type FileChangeActionKind = "add" | "edit" | "delete" | "rename";

const FILE_CHANGE_ACTION_COPY: Readonly<
  Record<"zh" | "en", Readonly<Record<FileChangeActionKind, string>>>
> = {
  zh: {
    add: "新增",
    edit: "修改",
    delete: "删除",
    rename: "重命名",
  },
  en: {
    add: "Add",
    edit: "Edit",
    delete: "Delete",
    rename: "Rename",
  },
};

export function formatFileChangeAction(
  operation: string | null | undefined,
  locale?: string,
): { readonly kind: FileChangeActionKind; readonly label: string } {
  const normalized = (operation ?? "").trim().toLowerCase();
  const table = FILE_CHANGE_ACTION_COPY[isZhLocale(locale) ? "zh" : "en"];
  let kind: FileChangeActionKind = "edit";
  if (
    normalized === "add" ||
    normalized === "added" ||
    normalized === "create" ||
    normalized === "created"
  ) {
    kind = "add";
  } else if (
    normalized === "delete" ||
    normalized === "deleted" ||
    normalized === "remove" ||
    normalized === "removed"
  ) {
    kind = "delete";
  } else if (
    normalized === "rename" ||
    normalized === "renamed" ||
    normalized === "move" ||
    normalized === "moved"
  ) {
    kind = "rename";
  }
  return { kind, label: table[kind] };
}

const WORK_STEP_CARD_COPY = {
  zh: {
    copied: "已复制",
    copyCommand: "复制命令",
    copyOutput: "复制输出",
    copyResult: "复制结果",
    copyPath: "复制路径",
    copyContent: "复制内容",
    rawCommand: "原始命令",
    hideRawCommand: "隐藏原始命令",
    rawInvocation: "原始 Shell 调用",
    running: "运行中",
    executing: "执行中",
    failed: "执行失败",
    exitPrefix: "退出码 ",
    outputHeaderPrefix: "输出 · ",
    outputLinesSuffix: " 行",
    outputLineSingularSuffix: " 行",
    loadingOutput: "正在加载输出…",
    loadingContent: "正在加载内容…",
    loadOutputFailedPrefix: "加载输出失败：",
    loadFailedPrefix: "加载失败：",
    noOutput: "无输出",
    showLessOutput: "收起输出",
    showLessPreview: "收起预览",
    showLessMatches: "收起匹配",
    showAllPrefix: "展开全部 ",
    linesSuffix: " 行",
    diffLinesSuffix: " 行变更",
    matchesSuffix: " 处匹配",
    resultsSuffix: " 条结果",
    searchPattern: "搜索模式",
    arguments: "调用参数",
    returnValue: "返回结果",
    contentPreview: "文件内容预览",
    openDiffNote: " · 点击右上角「打开差异」查看完整内容",
  },
  en: {
    copied: "Copied",
    copyCommand: "Copy",
    copyOutput: "Copy output",
    copyResult: "Copy output",
    copyPath: "Copy path",
    copyContent: "Copy output",
    rawCommand: "Raw",
    hideRawCommand: "Hide raw",
    rawInvocation: "Raw shell invocation",
    running: "Running",
    executing: "Running",
    failed: "Failed",
    exitPrefix: "exit ",
    outputHeaderPrefix: "Output · ",
    outputLinesSuffix: " lines",
    outputLineSingularSuffix: " line",
    loadingOutput: "Loading output…",
    loadingContent: "Loading output…",
    loadOutputFailedPrefix: "Couldn't load output: ",
    loadFailedPrefix: "Couldn't load output: ",
    noOutput: "No output.",
    showLessOutput: "Show less",
    showLessPreview: "Show less",
    showLessMatches: "Show fewer",
    showAllPrefix: "Show all ",
    linesSuffix: " lines",
    diffLinesSuffix: " diff lines",
    matchesSuffix: " matches",
    resultsSuffix: " results",
    searchPattern: "Pattern",
    arguments: "Arguments",
    returnValue: "Output",
    contentPreview: "Content preview",
    openDiffNote: "",
  },
} as const;

export type WorkStepCardCopy = (typeof WORK_STEP_CARD_COPY)[keyof typeof WORK_STEP_CARD_COPY];

export function getWorkStepCardCopy(locale?: string): WorkStepCardCopy {
  return WORK_STEP_CARD_COPY[isZhLocale(locale) ? "zh" : "en"];
}

export function formatStepOutputHeader(lineCount: number, locale?: string): string {
  const copy = getWorkStepCardCopy(locale);
  const suffix = lineCount === 1 ? copy.outputLineSingularSuffix : copy.outputLinesSuffix;
  return `${copy.outputHeaderPrefix}${lineCount}${suffix}`;
}

export function splitDisplayFilePath(relativePath: string): {
  readonly basename: string;
  readonly dirPath: string | null;
} {
  const normalized = relativePath.trim().replaceAll("\\", "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) {
    return { basename: normalized, dirPath: null };
  }
  return {
    basename: normalized.slice(lastSlash + 1),
    dirPath: normalized.slice(0, lastSlash),
  };
}

export interface CompactDiffLine {
  readonly kind: "add" | "del" | "hunk" | "meta" | "context";
  readonly prefix: string;
  readonly text: string;
  readonly oldLine?: number;
  readonly newLine?: number;
}

export interface CompactDiffPreview {
  readonly lines: ReadonlyArray<CompactDiffLine>;
  readonly totalLines: number;
  readonly additions: number;
  readonly deletions: number;
}

export function parseCompactDiffPreview(input: {
  readonly diffStr?: string | null | undefined;
  readonly oldStr?: string | null | undefined;
  readonly newStr?: string | null | undefined;
}): CompactDiffPreview | null {
  const diffText = input.diffStr?.replace(/\r\n/gu, "\n").trimEnd();
  const lines: CompactDiffLine[] = [];
  let additions = 0;
  let deletions = 0;

  if (diffText) {
    let oldLine = 1;
    let newLine = 1;
    let hasHunk = false;
    for (const rawLine of diffText.split("\n")) {
      if (
        rawLine.startsWith("diff --git ") ||
        rawLine.startsWith("index ") ||
        rawLine.startsWith("--- ") ||
        rawLine.startsWith("+++ ") ||
        rawLine.startsWith("*** ")
      ) {
        continue;
      }
      const hunkMatch = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/u);
      if (hunkMatch) {
        hasHunk = true;
        oldLine = Number(hunkMatch[1]);
        newLine = Number(hunkMatch[2]);
        lines.push({
          kind: "hunk",
          prefix: "@@",
          text: rawLine,
        });
        continue;
      }
      if (rawLine.startsWith("+")) {
        additions += 1;
        lines.push({
          kind: "add",
          prefix: "+",
          text: rawLine.slice(1),
          ...(hasHunk ? { newLine } : {}),
        });
        newLine += 1;
        continue;
      }
      if (rawLine.startsWith("-")) {
        deletions += 1;
        lines.push({
          kind: "del",
          prefix: "-",
          text: rawLine.slice(1),
          ...(hasHunk ? { oldLine } : {}),
        });
        oldLine += 1;
        continue;
      }
      if (rawLine.startsWith("\\ No newline")) {
        lines.push({ kind: "meta", prefix: "", text: rawLine });
        continue;
      }
      lines.push({
        kind: "context",
        prefix: rawLine.startsWith(" ") ? " " : "",
        text: rawLine.startsWith(" ") ? rawLine.slice(1) : rawLine,
        ...(hasHunk ? { oldLine, newLine } : {}),
      });
      oldLine += 1;
      newLine += 1;
    }
    if (lines.length > 0) {
      return { lines, totalLines: lines.length, additions, deletions };
    }
  }

  const oldText = input.oldStr?.replace(/\r\n/gu, "\n");
  const newText = input.newStr?.replace(/\r\n/gu, "\n");
  if ((oldText !== undefined && oldText.length > 0) || (newText !== undefined && newText.length > 0)) {
    if (oldText) {
      for (const [idx, line] of oldText.split("\n").entries()) {
        deletions += 1;
        lines.push({ kind: "del", prefix: "-", text: line, oldLine: idx + 1 });
      }
    }
    if (newText) {
      for (const [idx, line] of newText.split("\n").entries()) {
        additions += 1;
        lines.push({ kind: "add", prefix: "+", text: line, newLine: idx + 1 });
      }
    }
    if (lines.length > 0) {
      return { lines, totalLines: lines.length, additions, deletions };
    }
  }
  return null;
}

export function extractReadLineRangeLabel(entry: WorkLogEntry): string | null {
  const input =
    entry.structuredPayload?.type === "dynamic_tool" &&
    entry.structuredPayload.input !== null &&
    typeof entry.structuredPayload.input === "object" &&
    !Array.isArray(entry.structuredPayload.input)
      ? (entry.structuredPayload.input as Record<string, unknown>)
      : entry.toolData !== null &&
          typeof entry.toolData === "object" &&
          !Array.isArray(entry.toolData) &&
          typeof (entry.toolData as Record<string, unknown>).input === "object" &&
          (entry.toolData as Record<string, unknown>).input !== null
        ? ((entry.toolData as Record<string, unknown>).input as Record<string, unknown>)
        : undefined;
  if (!input) return null;
  const startRaw = input.startLine ?? input.StartLine ?? input.start_line ?? input.offset;
  const endRaw = input.endLine ?? input.EndLine ?? input.end_line;
  const limitRaw = input.limit ?? input.numLines ?? input.lines;
  const start = typeof startRaw === "number" && Number.isFinite(startRaw) && startRaw > 0 ? Math.floor(startRaw) : null;
  const end = typeof endRaw === "number" && Number.isFinite(endRaw) && endRaw > 0 ? Math.floor(endRaw) : null;
  const limit = typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : null;
  if (start !== null && end !== null && end >= start) {
    return `L${start}-L${end}`;
  }
  if (start !== null && limit !== null) {
    return `L${start}-L${start + limit - 1}`;
  }
  if (start !== null) {
    return `L${start}+`;
  }
  return null;
}
