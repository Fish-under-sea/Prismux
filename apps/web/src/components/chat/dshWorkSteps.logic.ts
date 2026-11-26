import * as DateTime from "effect/DateTime";
import type { RunId } from "@prismux/core-contracts";
import {
  DEFAULT_COLLAPSED_ASSISTANT_REPLY_MODE,
  DEFAULT_WORK_STEPS_COLLAPSE_TIMING,
  DEFAULT_WORK_STEPS_DISPLAY,
  type CollapsedAssistantReplyMode,
  type WorkStepsCollapseTiming,
  type WorkStepsDisplay,
} from "@prismux/core-contracts/settings";
import { commandDisplayText } from "@prismux/client-runtime/work-log/command-label";
import {
  liveThoughtLine,
  toolGroupAction,
  workEntryViewedImagePath,
} from "@prismux/client-runtime/work-log/presentation";
import {
  claudeSkillInvocation,
  collectToolFilePaths,
  isJavaScriptReplTool,
} from "@prismux/core-shared/toolActivity";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import type { WorkLogEntry } from "../../session-logic";
import { extractTodoChecklistFromWorkEntry } from "./AgyTodoChecklist.logic";
import {
  isSearchWorkEntry,
  isWebWorkEntry,
  normalizeSearchWorkEntry,
  normalizeWebWorkEntry,
} from "./DshSearchBlocks.logic";
import { diagnoseModelError } from "../../prismux/errorDiagnostics";
import type { WorkEntryIconName } from "./TimelineToolActivityIcon";

/** Minimum duration (ms) a live step header holds before swapping on rapid bursts (matches DSH). */
export const PROCESS_TITLE_MINIMUM_MS = 150;

/** Maximum grapheme length for live step-process detail text (`verb · detail`). */
export const LIVE_PROCESS_DETAIL_MAX_GRAPHEMES = 160;

export type WorkStepsStepGrouping = "collapsed" | "history" | "none";

export interface WorkStepsPresentationPolicy {
  readonly mode: WorkStepsDisplay;
  /** Whether completed turns emit an outer whole-turn collapsible bar. */
  readonly foldCompletedTurns: boolean;
  /** Whether outer completed turn bars stay open unconditionally regardless of collapseTiming (`expanded` never folds). */
  readonly defaultTurnFoldOpen: boolean;
  /**
   * How contiguous tool calls between assistant replies are grouped:
   * - `"collapsed"`: step groups always collapsed by default (`concise` / `standard`)
   * - `"history"`: active turn & latest completed turn (when `next-message`) render flat un-grouped; historical turns collapse
   * - `"none"`: never group steps; all thinking blocks & every tool call stay transparently flat (`detailed` / `expanded`)
   */
  readonly stepGrouping: WorkStepsStepGrouping;
  /** Whether live step-process headers append ` · <detail>` after the activity verb. */
  readonly liveProcessDetail: boolean;
  /** Whether settled (collapsed) reasoning rows preview their first line. */
  readonly settledReasoningPreview: boolean;
  /** Whether long step items (thinking body, command output, search/web blocks, file diffs, tool I/O, inline todos) default to expanded inline. */
  readonly defaultExpandLongItems: boolean;
}

const PRESENTATION_POLICY_BY_MODE: Readonly<Record<WorkStepsDisplay, WorkStepsPresentationPolicy>> =
  {
    concise: {
      mode: "concise",
      foldCompletedTurns: true,
      defaultTurnFoldOpen: false,
      stepGrouping: "collapsed",
      liveProcessDetail: false,
      settledReasoningPreview: false,
      defaultExpandLongItems: false,
    },
    standard: {
      mode: "standard",
      foldCompletedTurns: true,
      defaultTurnFoldOpen: false,
      stepGrouping: "collapsed",
      liveProcessDetail: true,
      settledReasoningPreview: true,
      defaultExpandLongItems: false,
    },
    detailed: {
      mode: "detailed",
      foldCompletedTurns: true,
      defaultTurnFoldOpen: false,
      stepGrouping: "history",
      liveProcessDetail: true,
      settledReasoningPreview: true,
      defaultExpandLongItems: false,
    },
    expanded: {
      mode: "expanded",
      foldCompletedTurns: false,
      defaultTurnFoldOpen: true,
      stepGrouping: "none",
      liveProcessDetail: false,
      settledReasoningPreview: true,
      defaultExpandLongItems: true,
    },
  };

export function resolveWorkStepsPolicy(
  display: WorkStepsDisplay | undefined = DEFAULT_WORK_STEPS_DISPLAY,
): WorkStepsPresentationPolicy {
  return PRESENTATION_POLICY_BY_MODE[display ?? DEFAULT_WORK_STEPS_DISPLAY];
}

export function shouldGroupWorkStepsForTurn(
  policy: WorkStepsPresentationPolicy,
  _options?: {
    readonly isActiveTurn: boolean;
    readonly isBottomCompletedTurn: boolean;
    readonly collapseTiming: WorkStepsCollapseTiming;
  },
): boolean {
  if (policy.stepGrouping === "none") return false;
  // Both "collapsed" (concise/standard) and "history" (detailed) converge steps inside a single ProcessGroup container.
  return true;
}

export function shouldProcessGroupDefaultOpen(
  policy: WorkStepsPresentationPolicy | null,
  _options?: {
    readonly isActiveTurn: boolean;
    readonly isBottomCompletedTurn: boolean;
    readonly collapseTiming: WorkStepsCollapseTiming;
  },
): boolean {
  if (!policy || policy.stepGrouping !== "history") return false;
  return true;
}

export function shouldTurnFoldDefaultOpen(options: {
  readonly isBottomCompletedTurn: boolean;
  readonly collapseTiming: WorkStepsCollapseTiming;
  readonly defaultTurnFoldOpen?: boolean | undefined;
}): boolean {
  if (options.defaultTurnFoldOpen === true) return true;
  return options.isBottomCompletedTurn && options.collapseTiming === "next-message";
}

export function resolveTurnFoldExpanded(options: {
  readonly runId: RunId;
  readonly isBottomCompletedTurn: boolean;
  readonly collapseTiming: WorkStepsCollapseTiming;
  readonly defaultTurnFoldOpen?: boolean | undefined;
  readonly expandedRunIds?: ReadonlySet<RunId> | undefined;
  readonly collapsedRunIds?: ReadonlySet<RunId> | undefined;
}): boolean {
  if (
    shouldTurnFoldDefaultOpen({
      isBottomCompletedTurn: options.isBottomCompletedTurn,
      collapseTiming: options.collapseTiming,
      defaultTurnFoldOpen: options.defaultTurnFoldOpen,
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
  | "context"
  | "skill";

export type ContextInjectionSourceKind =
  | "agent-instructions"
  | "runtime-context"
  | "skill-catalog"
  | "time-context"
  | "prismux-instructions"
  | "other";

export type ContextInjectionForm = "instructions" | "catalog" | "snapshot" | "notice";

export interface ContextInjectionFileEntry {
  readonly action: "set" | "replace" | "remove";
  readonly path: string;
  readonly scope?: string | undefined;
  readonly statusLabel?: string | undefined;
}

export interface ContextInjectionSectionEntry {
  readonly name: string;
  readonly text: string;
}

export interface ContextInjectionCatalogEntry {
  readonly name: string;
  readonly description: string;
}

export interface ContextInjectionStepData {
  readonly sourceKind: ContextInjectionSourceKind;
  readonly form: ContextInjectionForm;
  readonly label: string;
  readonly sourcePath: string | null;
  readonly statusLabel: string | null;
  readonly supersedesPrevious: boolean;
  readonly files: ReadonlyArray<ContextInjectionFileEntry>;
  readonly sections: ReadonlyArray<ContextInjectionSectionEntry>;
  readonly entries: ReadonlyArray<ContextInjectionCatalogEntry>;
  readonly content: string | null;
  readonly contentOmitted: boolean;
}

export interface SkillStepData {
  readonly skillName: string;
  readonly sourcePath: string | null;
  readonly instructions: string | null;
  readonly args: string | null;
  readonly isNativeSkillTool: boolean;
}

const VALID_CONTEXT_SOURCE_KINDS = new Set<string>([
  "agent-instructions",
  "runtime-context",
  "skill-catalog",
  "time-context",
  "prismux-instructions",
  "other",
]);

const VALID_CONTEXT_FORMS = new Set<string>(["instructions", "catalog", "snapshot", "notice"]);

const NATIVE_SKILL_TOOL_NAMES = new Set(["skill", "load_skill", "use_skill", "read_skill"]);
const SKILL_MD_PATH_RE = /(?:^|[\\/])([^\\/]+)[\\/]SKILL\.md$/iu;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function inferContextAction(statusLabel: string | null): "set" | "replace" | "remove" {
  const normalized = (statusLabel ?? "").toLowerCase();
  if (normalized.includes("remove") || normalized.includes("移除")) return "remove";
  if (
    normalized.includes("update") ||
    normalized.includes("replace") ||
    normalized.includes("更新")
  )
    return "replace";
  return "set";
}

function inferContextForm(sourceKind: ContextInjectionSourceKind): ContextInjectionForm {
  if (sourceKind === "agent-instructions" || sourceKind === "prismux-instructions") {
    return "instructions";
  }
  if (sourceKind === "skill-catalog") return "catalog";
  if (sourceKind === "runtime-context" || sourceKind === "time-context") return "snapshot";
  return "notice";
}

/**
 * Defensively reads `context_injection` fields from `WorkLogEntry` / projected TurnItem so this UI
 * compiles standalone before contract merge AND consumes every field from `w2-dsh-backend` seamlessly.
 */
export function extractContextInjectionData(entry: WorkLogEntry): ContextInjectionStepData | null {
  const rawItem = asRecord(entry.projectedItem?.item ?? entry.structuredPayload);
  const rawToolData = asRecord(entry.toolData);
  const itemTypeStr =
    asNonEmptyString(rawItem?.type) ??
    asNonEmptyString(entry.itemType as unknown) ??
    asNonEmptyString(entry.sourceActivityKind);
  if (itemTypeStr !== "context_injection") {
    return null;
  }

  const rawSourceKind = asNonEmptyString(rawItem?.sourceKind ?? rawToolData?.sourceKind);
  const sourceKind: ContextInjectionSourceKind =
    rawSourceKind && VALID_CONTEXT_SOURCE_KINDS.has(rawSourceKind)
      ? (rawSourceKind as ContextInjectionSourceKind)
      : "other";
  const rawForm = asNonEmptyString(rawItem?.form ?? rawToolData?.form);
  const form: ContextInjectionForm =
    rawForm && VALID_CONTEXT_FORMS.has(rawForm)
      ? (rawForm as ContextInjectionForm)
      : inferContextForm(sourceKind);

  const sourcePath = asNonEmptyString(rawItem?.sourcePath ?? rawToolData?.sourcePath);
  const label =
    asNonEmptyString(rawItem?.label ?? rawToolData?.label) ??
    sourcePath ??
    asNonEmptyString(entry.label) ??
    sourceKind;
  const statusLabel = asNonEmptyString(rawItem?.statusLabel ?? rawToolData?.statusLabel);
  const supersedesPrevious =
    rawItem?.supersedesPrevious === true ||
    rawToolData?.supersedesPrevious === true ||
    inferContextAction(statusLabel) === "replace";

  const rawFiles = Array.isArray(rawItem?.files)
    ? rawItem.files
    : Array.isArray(rawToolData?.files)
      ? rawToolData.files
      : [];
  const parsedFiles: ContextInjectionFileEntry[] = [];
  for (const candidate of rawFiles) {
    const rec = asRecord(candidate);
    const path = asNonEmptyString(rec?.path);
    if (!path) continue;
    const rawAction = asNonEmptyString(rec?.action);
    const action: "set" | "replace" | "remove" =
      rawAction === "replace" || rawAction === "remove" || rawAction === "set"
        ? rawAction
        : inferContextAction(asNonEmptyString(rec?.statusLabel) ?? statusLabel);
    parsedFiles.push({
      action,
      path,
      scope: asNonEmptyString(rec?.scope) ?? undefined,
      statusLabel: asNonEmptyString(rec?.statusLabel) ?? undefined,
    });
  }
  if (parsedFiles.length === 0 && (sourcePath !== null || form === "instructions")) {
    parsedFiles.push({
      action: inferContextAction(statusLabel),
      path: sourcePath ?? label,
      statusLabel: statusLabel ?? undefined,
    });
  }

  const rawSections = Array.isArray(rawItem?.sections)
    ? rawItem.sections
    : Array.isArray(rawToolData?.sections)
      ? rawToolData.sections
      : [];
  const sections: ContextInjectionSectionEntry[] = [];
  for (const candidate of rawSections) {
    const rec = asRecord(candidate);
    const name = asNonEmptyString(rec?.name);
    const text = typeof rec?.text === "string" ? rec.text : null;
    if (name && text !== null) {
      sections.push({ name, text });
    }
  }

  const rawEntries = Array.isArray(rawItem?.entries)
    ? rawItem.entries
    : Array.isArray(rawToolData?.entries)
      ? rawToolData.entries
      : [];
  const entries: ContextInjectionCatalogEntry[] = [];
  for (const candidate of rawEntries) {
    const rec = asRecord(candidate);
    const name = asNonEmptyString(rec?.name);
    if (!name) continue;
    entries.push({
      name,
      description: typeof rec?.description === "string" ? rec.description : "",
    });
  }

  const content =
    typeof rawItem?.content === "string"
      ? rawItem.content
      : typeof rawToolData?.content === "string"
        ? rawToolData.content
        : typeof entry.detail === "string" && entry.detail.length > 0
          ? entry.detail
          : null;
  const contentOmitted = rawItem?.contentOmitted === true || rawToolData?.contentOmitted === true;

  return {
    sourceKind,
    form,
    label,
    sourcePath,
    statusLabel,
    supersedesPrevious,
    files: parsedFiles,
    sections,
    entries,
    content,
    contentOmitted,
  };
}

export function isContextInjectionWorkEntry(entry: WorkLogEntry): boolean {
  return extractContextInjectionData(entry) !== null;
}

function extractFrontmatterSkillName(content: string | null | undefined): string | null {
  if (!content) return null;
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  if (!frontmatterMatch?.[1]) return null;
  const nameMatch = frontmatterMatch[1].match(/^name:\s*["']?([^"'\r\n]+)["']?\s*$/mu);
  return nameMatch?.[1]?.trim() || null;
}

function readOutputTextFromEntry(entry: WorkLogEntry): string | null {
  const payload = entry.structuredPayload ?? entry.projectedItem?.item;
  if (payload?.type === "dynamic_tool") {
    if (typeof payload.output === "string" && payload.output.trim().length > 0) {
      return payload.output;
    }
    const outRec = asRecord(payload.output);
    for (const key of ["text", "content", "instructions", "output"] as const) {
      if (typeof outRec?.[key] === "string" && (outRec[key] as string).trim().length > 0) {
        return outRec[key] as string;
      }
    }
  }
  const toolData = asRecord(entry.toolData);
  if (typeof toolData?.output === "string" && toolData.output.trim().length > 0) {
    return toolData.output;
  }
  if (typeof entry.detail === "string" && entry.detail.trim().length > 0) {
    return entry.detail;
  }
  return null;
}

/**
 * Recognizes BOTH Priority 1 native skill tool invocations (DSH `skill`, Claude `Skill`, OpenCode/Pi/ACP
 * `load_skill`/`use_skill`/`read_skill`) AND Priority 2 `SKILL.md` file-read promotions.
 */
export function extractSkillStepData(entry: WorkLogEntry): SkillStepData | null {
  if (entry.itemType === "reasoning" || entry.tone === "thinking") return null;
  const payload = entry.structuredPayload ?? entry.projectedItem?.item;
  const toolData = asRecord(entry.toolData);
  const inputRec =
    payload?.type === "dynamic_tool" ? asRecord(payload.input) : asRecord(toolData?.input);
  const outputText = readOutputTextFromEntry(entry);

  // Priority 1a: Claude Skill tool
  if (payload?.type === "dynamic_tool") {
    const claudeSkill = claudeSkillInvocation(payload.toolName, payload.input);
    if (claudeSkill) {
      return {
        skillName: claudeSkill.name,
        sourcePath: asNonEmptyString(inputRec?.path ?? inputRec?.file_path ?? toolData?.path),
        instructions: outputText,
        args: claudeSkill.args ?? null,
        isNativeSkillTool: true,
      };
    }
  }

  // Priority 1b: DSH native `_meta.dshToolName === "skill"` or explicit `skillName` or native skill tool names
  const rawToolName =
    (payload?.type === "dynamic_tool"
      ? payload.toolName
      : (asNonEmptyString(toolData?.dshToolName) ?? entry.toolTitle)) ?? "";
  const normalizedToolName = rawToolName.trim().toLowerCase();
  const baseToolName = normalizedToolName.split(/[.:/]/u).at(-1) ?? normalizedToolName;
  const dshToolName = asNonEmptyString(toolData?.dshToolName)?.toLowerCase();
  const explicitSkillName = asNonEmptyString(
    toolData?.skillName ?? (asRecord(payload)?.skillName as unknown),
  );
  if (
    dshToolName === "skill" ||
    explicitSkillName !== null ||
    NATIVE_SKILL_TOOL_NAMES.has(normalizedToolName) ||
    NATIVE_SKILL_TOOL_NAMES.has(baseToolName)
  ) {
    const skillName =
      explicitSkillName ??
      asNonEmptyString(
        inputRec?.name ??
          inputRec?.skill ??
          inputRec?.skillName ??
          inputRec?.skill_name ??
          toolData?.name ??
          (payload?.type === "dynamic_tool" ? payload.title : null),
      ) ??
      extractFrontmatterSkillName(outputText) ??
      asNonEmptyString(entry.label) ??
      "skill";
    return {
      skillName,
      sourcePath: asNonEmptyString(
        inputRec?.path ?? inputRec?.file_path ?? inputRec?.filePath ?? toolData?.sourcePath,
      ),
      instructions: outputText,
      args: asNonEmptyString(inputRec?.args),
      isNativeSkillTool: true,
    };
  }

  // Priority 2: `*/SKILL.md` file read promotion
  const isReadLike =
    toolGroupAction(entry) === "read" ||
    normalizedToolName === "read" ||
    normalizedToolName === "read_file" ||
    normalizedToolName === "view_file" ||
    normalizedToolName === "read_workspace_file" ||
    baseToolName === "read_file" ||
    baseToolName === "view_file";
  if (isReadLike) {
    const candidatePaths = [
      ...(entry.changedFiles ?? []),
      ...collectToolFilePaths(inputRec ? { input: inputRec } : toolData),
      ...[inputRec?.path, inputRec?.file_path, inputRec?.filePath, inputRec?.Path, toolData?.path]
        .map(asNonEmptyString)
        .filter((p): p is string => p !== null),
    ];
    for (const candidatePath of candidatePaths) {
      const match = SKILL_MD_PATH_RE.exec(candidatePath.trim());
      if (!match?.[1]) continue;
      const skillName = extractFrontmatterSkillName(outputText) ?? match[1].trim();
      return {
        skillName,
        sourcePath: candidatePath.trim(),
        instructions: outputText,
        args: null,
        isNativeSkillTool: false,
      };
    }
  }

  return null;
}

/**
 * Deduplicates `SKILL.md` read promotions against native `skill` tool calls for the same skill
 * inside a ProcessGroup (Blueprint §4.4 zero-duplicate rule).
 */
export function dedupeSkillLoadWorkEntries(entries: ReadonlyArray<WorkLogEntry>): WorkLogEntry[] {
  const nativeSkills = new Map<string, number>();
  const parsed = entries.map((entry) => extractSkillStepData(entry));
  for (let i = 0; i < entries.length; i += 1) {
    const skill = parsed[i];
    if (skill?.isNativeSkillTool) {
      nativeSkills.set(skill.skillName.toLowerCase(), i);
    }
  }
  if (nativeSkills.size === 0) {
    return [...entries];
  }

  const result: WorkLogEntry[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const skill = parsed[i];
    if (skill && !skill.isNativeSkillTool && nativeSkills.has(skill.skillName.toLowerCase())) {
      continue;
    }
    result.push(entry);
  }
  return result;
}

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
  if (isContextInjectionWorkEntry(entry)) {
    return "context";
  }
  if (entry.itemType === "reasoning" || entry.tone === "thinking") {
    return "thinking";
  }
  if (entry.sourceActivityKind === "context-compaction") {
    return "context";
  }
  if (extractSkillStepData(entry) !== null) {
    return "skill";
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
    entry.itemType === "handoff" ||
    entry.structuredPayload?.type === "notification" ||
    entry.itemType === "notification" ||
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
    case "skill":
      return "eye";
    case "tools":
      return "wrench";
  }
}

function truncateGraphemes(text: string, maxLength = LIVE_PROCESS_DETAIL_MAX_GRAPHEMES): string {
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return `${chars
    .slice(0, Math.max(1, maxLength - 1))
    .join("")
    .trimEnd()}…`;
}

function sanitizeInlineLine(raw: string): string {
  return raw
    .replace(/\*\*/g, "")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#+\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/u)) {
    const cleaned = sanitizeInlineLine(line);
    if (cleaned.length > 0) return cleaned;
  }
  return "";
}

/**
 * Matches DSH NEXT `ReasoningRow.tsx`'s `latestCompletedParagraphFirstLine`:
 * advances to the first line of the latest paragraph whose first line has terminated with `\n`.
 */
export function latestCompletedParagraphFirstLine(text: string): string {
  let summary = "";
  let paragraphStart = 0;
  const separator = /\r?\n(?:[\t ]*\r?\n)+/gu;
  while (true) {
    const nextParagraph = separator.exec(text);
    const paragraphEnd =
      nextParagraph === null ? text.length : nextParagraph.index + nextParagraph[0].indexOf("\n");
    const newline = text.indexOf("\n", paragraphStart);
    if (newline !== -1 && newline <= paragraphEnd) {
      const candidate = sanitizeInlineLine(text.slice(paragraphStart, newline));
      if (candidate !== "") summary = candidate;
    }
    if (nextParagraph === null) return summary;
    paragraphStart = nextParagraph.index + nextParagraph[0].length;
  }
}

/**
 * Extracts a single-line reasoning summary matching DSH's ReasoningRow rules:
 * - Strips `**` markdown bold markers
 * - Live: latest completed paragraph's first line (falling back to current line when no newline yet)
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
    const completedParaLine = latestCompletedParagraphFirstLine(trimmed);
    if (completedParaLine) {
      return truncateGraphemes(completedParaLine);
    }
    const fallbackFirst = firstNonEmptyLine(trimmed);
    if (fallbackFirst) {
      return truncateGraphemes(fallbackFirst);
    }
    const cleanedLive = sanitizeInlineLine(liveThoughtLine(trimmed));
    return cleanedLive ? truncateGraphemes(cleanedLive) : null;
  }

  const firstLine = firstNonEmptyLine(trimmed);
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
  const ctxData = extractContextInjectionData(entry);
  if (ctxData) {
    return truncateGraphemes(ctxData.label);
  }
  const skillData = extractSkillStepData(entry);
  if (skillData) {
    return truncateGraphemes(skillData.skillName);
  }
  if (entry.itemType === "reasoning" || entry.tone === "thinking") {
    return extractReasoningSummaryLine(entry.detail, {
      live: true,
      settledReasoningPreview: true,
    });
  }
  if (entry.itemType === "subagent" || entry.structuredPayload?.type === "subagent") {
    const title =
      entry.structuredPayload?.type === "subagent"
        ? (entry.structuredPayload.title ?? entry.structuredPayload.prompt)
        : entry.label;
    const cleaned = title ? sanitizeInlineLine(title) : "";
    return cleaned ? truncateGraphemes(cleaned) : null;
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
    return truncateGraphemes(
      sanitizeInlineLine(stripShellCommandWrapper(entry.command).displayCommand),
    );
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
  thinking: "正在分析请求",
  read: "正在读取文件",
  readImage: "正在查看图片",
  search: "正在搜索代码",
  edit: "正在编辑文件",
  write: "正在写入文件",
  commands: "正在运行命令",
  code: "正在运行代码",
  webSearch: "正在搜索网页",
  webFetch: "正在获取网页",
  subagents: "正在协调子智能体",
  plan: "正在更新计划",
  questions: "正在等待确认",
  context: "正在注入上下文",
  skill: "正在加载技能",
  tools: "正在调用工具",
};

const PREPARING_VERB_ZH: Readonly<Partial<Record<DshActivityCategory, string>>> = {
  commands: "准备运行命令",
  read: "准备读取文件",
  search: "准备搜索代码",
  edit: "准备编辑文件",
  write: "准备写入文件",
  subagents: "准备协调子智能体",
  tools: "准备调用工具",
};

const LIVE_VERB_EN: Readonly<Record<DshActivityCategory, string>> = {
  thinking: "Analyzing request",
  read: "Reading file",
  readImage: "Viewing image",
  search: "Searching code",
  edit: "Editing file",
  write: "Writing file",
  commands: "Running command",
  code: "Running code",
  webSearch: "Searching web",
  webFetch: "Fetching web page",
  subagents: "Coordinating subagent",
  plan: "Updating plan",
  questions: "Waiting for confirmation",
  context: "Injecting context",
  skill: "Loading skill",
  tools: "Calling tool",
};

const PREPARING_VERB_EN: Readonly<Partial<Record<DshActivityCategory, string>>> = {
  commands: "Preparing command",
  read: "Preparing to read file",
  search: "Preparing to search code",
  edit: "Preparing to edit file",
  write: "Preparing to write file",
  subagents: "Preparing subagent",
  tools: "Preparing tool call",
};

function isPreparingWorkEntry(entry: WorkLogEntry): boolean {
  const rawItem = asRecord(entry.projectedItem?.item ?? entry.structuredPayload);
  return rawItem?.status === "pending" || entry.toolLifecycleStatus === "idle";
}

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
  const zh = isZhLocale(options.locale);
  const preparing = isPreparingWorkEntry(entry);
  const verb = zh
    ? ((preparing ? PREPARING_VERB_ZH[category] : undefined) ?? LIVE_VERB_ZH[category])
    : ((preparing ? PREPARING_VERB_EN[category] : undefined) ?? LIVE_VERB_EN[category]);
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
  thinking: { primary: "已完成分析", secondary: "完成了分析" },
  read: { primary: "已读取文件", secondary: "读取了文件" },
  readImage: { primary: "已查看图片", secondary: "查看了图片" },
  search: { primary: "已搜索代码", secondary: "搜索了代码" },
  edit: { primary: "修改了文件", secondary: "修改了文件" },
  write: { primary: "已写入文件", secondary: "写入了文件" },
  commands: { primary: "执行了命令", secondary: "执行了命令" },
  code: { primary: "运行了代码", secondary: "运行了代码" },
  webSearch: { primary: "已搜索网页", secondary: "搜索了网页" },
  webFetch: { primary: "已获取网页", secondary: "获取了网页" },
  subagents: { primary: "已协调子智能体", secondary: "协调了子智能体" },
  plan: { primary: "已更新计划", secondary: "更新了计划" },
  questions: { primary: "已完成交互", secondary: "完成了交互" },
  context: { primary: "已注入上下文", secondary: "注入了上下文" },
  skill: { primary: "已加载技能", secondary: "加载了技能" },
  tools: { primary: "已调用工具", secondary: "调用了工具" },
};

const CLOSED_CHIP_EN: Readonly<Record<DshActivityCategory, string>> = {
  thinking: "Analyzed request",
  read: "Read files",
  readImage: "Viewed images",
  search: "Searched code",
  edit: "Edited files",
  write: "Wrote files",
  commands: "Ran commands",
  code: "Ran code",
  webSearch: "Searched web",
  webFetch: "Fetched web pages",
  subagents: "Coordinated subagents",
  plan: "Updated plan",
  questions: "Completed prompts",
  context: "Injected context",
  skill: "Loaded skills",
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

/** Resolves the dominant non-thinking DSH activity category for a step group header icon. */
export function classifyPrimaryStepGroupActivity(
  entries: ReadonlyArray<WorkLogEntry>,
): DshActivityCategory {
  const counts = new Map<DshActivityCategory, number>();
  for (const entry of entries) {
    const category = classifyWorkEntryActivity(entry);
    if (category === "thinking") continue;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  let best: DshActivityCategory | null = null;
  let bestCount = -1;
  for (const [category, count] of counts) {
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best ?? (entries.length > 0 ? classifyWorkEntryActivity(entries[0]!) : "tools");
}

/** Formats DSH count-free step-group category summaries (sorted by frequency, up to 3 categories plus ellipsis). */
export function formatDshStepGroupSummary(
  entries: ReadonlyArray<WorkLogEntry>,
  locale?: string,
): string {
  const counts = new Map<DshActivityCategory, number>();
  const firstOrder = new Map<DshActivityCategory, number>();
  for (const [index, entry] of entries.entries()) {
    const category = classifyWorkEntryActivity(entry);
    counts.set(category, (counts.get(category) ?? 0) + 1);
    if (!firstOrder.has(category)) {
      firstOrder.set(category, index);
    }
  }
  const ordered = [...counts.keys()].toSorted(
    (a, b) =>
      (counts.get(b) ?? 0) - (counts.get(a) ?? 0) ||
      (firstOrder.get(a) ?? 0) - (firstOrder.get(b) ?? 0),
  );
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
    return `${first}并${second}`;
  }
  const first = CLOSED_CHIP_ZH[top3[0]!].primary;
  const second = CLOSED_CHIP_ZH[top3[1]!].secondary;
  const third = CLOSED_CHIP_ZH[top3[2]!].secondary;
  const joined = `${first}，${second}，${third}`;
  return hasMore ? `${joined}等` : joined;
}

export function formatDshDurationCompact(elapsedMs: number, locale?: string): string {
  const totalSeconds = Math.max(1, Math.round(elapsedMs / 1000));
  const zh = locale !== undefined && isZhLocale(locale);
  if (totalSeconds < 60) {
    return zh ? `${totalSeconds}秒` : `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    if (zh) {
      return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分`;
    }
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (zh) {
    return remMinutes > 0 ? `${hours}小时${remMinutes}分` : `${hours}小时`;
  }
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
  const zh = isZhLocale(input.locale);
  const copy = zh ? DSH_TURN_FOLD_COPY.zh : DSH_TURN_FOLD_COPY.en;
  if (input.status === "error") {
    return { prefix: copy.failed, durationNumber: null, fullText: copy.failed };
  }
  if (input.status === "interrupted") {
    return { prefix: copy.interrupted, durationNumber: null, fullText: copy.interrupted };
  }
  if (input.elapsedMs !== null && Number.isFinite(input.elapsedMs)) {
    const durationNumber = formatDshDurationCompact(input.elapsedMs, zh ? "zh" : "en");
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
  const match = rawCommand.trim().match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))/u);
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
    ioIn: "输入",
    ioOut: "输出",
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
    ioIn: "IN",
    ioOut: "OUT",
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
  if (
    (oldText !== undefined && oldText.length > 0) ||
    (newText !== undefined && newText.length > 0)
  ) {
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
  const start =
    typeof startRaw === "number" && Number.isFinite(startRaw) && startRaw > 0
      ? Math.floor(startRaw)
      : null;
  const end =
    typeof endRaw === "number" && Number.isFinite(endRaw) && endRaw > 0 ? Math.floor(endRaw) : null;
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.floor(limitRaw)
      : null;
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

const EXACT_WORK_STEP_LABELS_ZH: Readonly<Record<string, string>> = {
  worked: "已完成",
  "ran command": "已执行命令",
  "run command": "执行命令",
  "running command": "正在执行命令",
  "executed command": "已执行命令",
  "executing command": "正在执行命令",
  "failed command": "命令执行失败",
  "declined command": "已拒绝命令",
  "stopped command": "已停止命令",
  command: "执行命令",
  shell: "执行命令",
  terminal: "执行命令",
  "edited file": "已修改文件",
  "edit file": "修改文件",
  "editing file": "正在修改文件",
  "changed file": "已修改文件",
  "changing file": "正在修改文件",
  "modified file": "已修改文件",
  "file change": "文件修改",
  "file edit": "文件修改",
  "wrote file": "已写入文件",
  "write file": "写入文件",
  "writing file": "正在写入文件",
  "created file": "已创建文件",
  "create file": "创建文件",
  "creating file": "正在创建文件",
  "deleted file": "已删除文件",
  "delete file": "删除文件",
  "read file": "已读取文件",
  "reading file": "正在读取文件",
  "view file": "查看文件",
  "viewed file": "已查看文件",
  read: "已读取文件",
  searched: "已搜索代码",
  search: "搜索代码",
  searching: "正在搜索代码",
  "searched files": "已搜索文件",
  "searched code": "已搜索代码",
  "file search": "文件搜索",
  "code search": "代码搜索",
  grep: "搜索代码",
  glob: "查找文件",
  "web search": "网页搜索",
  "searched the web": "已搜索网页",
  "search web": "网页搜索",
  "search the web": "网页搜索",
  "searching web": "正在搜索网页",
  "searching the web": "正在搜索网页",
  "web fetch": "网页抓取",
  "fetched web page": "已抓取网页",
  "fetch url": "网页抓取",
  "read url": "网页抓取",
  "fetching web page": "正在抓取网页",
  "fetching url": "正在抓取网页",
  fetch: "网页抓取",
  thinking: "正在思考",
  thought: "已思考",
  reasoning: "思考过程",
  output: "输出",
  input: "输入",
  arguments: "参数",
  args: "参数",
  result: "结果",
  subagent: "子智能体",
  delegate: "调度子智能体",
  "delegated task": "子智能体任务",
  "mcp tool": "MCP 工具",
  "tool call": "工具调用",
  tool: "工具调用",
  "used tool": "已调用工具",
  "running tool": "正在调用工具",
  "calling tool": "正在调用工具",
  "todo list": "任务清单",
  todo: "任务清单",
  todos: "任务清单",
  todowrite: "更新任务清单",
  "todo write": "更新任务清单",
  "update steps": "更新任务清单",
  plan: "执行计划",
  "update plan": "更新计划",
  "updated plan": "已更新计划",
  "updating plan": "正在更新计划",
  "approval requested": "已请求批准",
  "input requested": "已请求输入",
  "answered questions": "已回答问题",
  "provider error": "模型服务错误",
  "usage limit reached": "已达到用量上限",
  "created thread": "已创建会话",
  "checkpoint captured": "已保存检查点",
};

function localizeMoreCountSuffixZh(text: string): string {
  return text.replace(/\s+\+(\d+)\s+more$/iu, "，另有 $1 个");
}

/**
 * Ensures NO raw English provider/tool action labels leak into Chinese (`zh-CN`) work-step rows,
 * while leaving file paths, queries, URLs, durations, and English locales intact.
 */
export function localizeWorkStepLabel(rawLabel: string, locale?: string): string {
  const trimmed = rawLabel.trim();
  if (!trimmed || !isZhLocale(locale)) return rawLabel;

  const exact = EXACT_WORK_STEP_LABELS_ZH[trimmed.toLowerCase()];
  if (exact) return exact;

  const patterns: ReadonlyArray<readonly [RegExp, (...args: string[]) => string]> = [
    [/^Worked for\s+(.+)$/iu, (_m, duration) => `已完成，用时 ${duration}`],
    [/^Thought for\s+(.+)$/iu, (_m, duration) => `思考了 ${duration}`],
    [/^Continued for\s+(.+)$/iu, (_m, duration) => `继续处理，用时 ${duration}`],
    [/^Running\s+(.+)$/iu, (_m, target) => `正在运行 ${target}`],
    [/^Ran\s+(.+)$/iu, (_m, target) => `已运行 ${target}`],
    [/^Failed to\s+(.+)$/iu, (_m, target) => `执行失败：${target}`],
    [/^Failed\s+(.+)$/iu, (_m, target) => `${target} 失败`],
    [/^Declined\s+(.+)$/iu, (_m, target) => `已拒绝 ${target}`],
    [/^Stopped\s+(.+)$/iu, (_m, target) => `已停止 ${target}`],
    [/^Reading\s+(.+)$/iu, (_m, target) => `正在读取 ${localizeMoreCountSuffixZh(target!)}`],
    [/^Read\s+(.+)$/iu, (_m, target) => `已读取 ${localizeMoreCountSuffixZh(target!)}`],
    [
      /^(?:Edited|Changed|Modified)\s+(.+)$/iu,
      (_m, target) => `已修改 ${localizeMoreCountSuffixZh(target!)}`,
    ],
    [
      /^(?:Editing|Changing)\s+(.+)$/iu,
      (_m, target) => `正在修改 ${localizeMoreCountSuffixZh(target!)}`,
    ],
    [
      /^(?:Wrote|Created)\s+(.+)$/iu,
      (_m, target) => `已写入 ${localizeMoreCountSuffixZh(target!)}`,
    ],
    [
      /^(?:Writing|Creating)\s+(.+)$/iu,
      (_m, target) => `正在写入 ${localizeMoreCountSuffixZh(target!)}`,
    ],
    [/^Deleted\s+(.+)$/iu, (_m, target) => `已删除 ${localizeMoreCountSuffixZh(target!)}`],
    [
      /^Searched files\s+(.+)\s+in\s+(.+)$/iu,
      (_m, glob, target) => `已在 ${target} 中搜索文件 ${glob}`,
    ],
    [/^Searched files\s+(.+)$/iu, (_m, glob) => `已搜索文件 ${glob}`],
    [/^Searched\s+(.+)\s+in\s+(.+)$/iu, (_m, query, target) => `已在 ${target} 中搜索 ${query}`],
    [/^Searched in\s+(.+)$/iu, (_m, target) => `已在 ${target} 中搜索`],
    [/^Searched\s+(.+)$/iu, (_m, query) => `已搜索 ${query}`],
    [/^Web search(?:\s*[:·-]\s*|\s+)(.+)$/iu, (_m, query) => `网页搜索：${query}`],
    [
      /^(?:Web fetch|Fetched|Fetch)(?:\s*[:·-]\s*|\s+)(.+)$/iu,
      (_m, target) => `网页抓取：${target}`,
    ],
    [
      /^Tasks\s+(\d+\/\d+)(?:\s*·\s*(.+))?$/iu,
      (_m, progress, current) => (current ? `任务 ${progress} · ${current}` : `任务 ${progress}`),
    ],
    [/^MCP(?:\s+tool)?(?:\s*[:·-]\s*|\s+)(.+)$/iu, (_m, name) => `MCP 工具：${name}`],
    [/^Tool(?:\s+call)?(?:\s*[:·-]\s*|\s+)(.+)$/iu, (_m, name) => `工具调用：${name}`],
    [/^Subagent(?:\s*[:·-]\s*|\s+)(.+)$/iu, (_m, name) => `子智能体：${name}`],
  ];

  for (const [pattern, formatter] of patterns) {
    const match = pattern.exec(trimmed);
    if (match) {
      return formatter(...match);
    }
  }
  return rawLabel;
}

function summarizeUnknownInline(value: unknown): string | null {
  if (typeof value === "string") {
    const line = firstNonEmptyLine(value);
    return line ? truncateGraphemes(line, 120) : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = summarizeUnknownInline(item);
      if (candidate) return candidate;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of [
      "text",
      "output",
      "stdout",
      "summary",
      "message",
      "content",
      "query",
      "pattern",
      "url",
      "file_path",
      "filePath",
      "path",
      "command",
    ] as const) {
      const candidate = summarizeUnknownInline(record[key]);
      if (candidate) return candidate;
    }
    try {
      const compact = sanitizeInlineLine(JSON.stringify(value));
      if (compact && compact !== "{}" && compact !== "[]") {
        return truncateGraphemes(compact, 120);
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Extracts a crisp 1-line truncated preview for folded long work-step items in `detailed` mode
 * (command stdout/stderr, search results, web blocks, file diffs, tool I/O, inline todos, errors).
 */
export function extractWorkStepCollapsedPreview(
  entry: WorkLogEntry,
  options: {
    readonly workspaceRoot?: string | undefined;
    readonly locale?: string | undefined;
    readonly headingText?: string | undefined;
  } = {},
): string | null {
  if (entry.itemType === "reasoning" || entry.tone === "thinking") {
    return null;
  }
  const headingNorm = options.headingText?.trim().toLowerCase() ?? "";
  const accept = (candidate: string | null | undefined): string | null => {
    if (!candidate) return null;
    const cleaned = truncateGraphemes(sanitizeInlineLine(candidate), 120);
    if (!cleaned) return null;
    if (headingNorm && cleaned.toLowerCase() === headingNorm) return null;
    return cleaned;
  };

  const payload = entry.projectedItem?.item ?? entry.structuredPayload;

  if (payload?.type === "error") {
    return accept(
      diagnoseModelError(payload.failure.message, {
        errorClass: payload.failure.class,
        errorCode: payload.failure.code,
      }).titleZh,
    );
  }

  if (payload?.type === "command_execution" || entry.itemType === "command_execution") {
    const rawOutput =
      payload?.type === "command_execution" ? (payload.output ?? entry.detail) : entry.detail;
    return accept(rawOutput ? firstNonEmptyLine(rawOutput) : null);
  }

  if (isSearchWorkEntry(entry)) {
    const searchData = normalizeSearchWorkEntry(entry, options.workspaceRoot, entry.detail);
    if (searchData) {
      if (searchData.kind === "matches") {
        const firstGroup = searchData.groups[0];
        const firstMatch = firstGroup?.matches[0];
        const snippet = firstGroup
          ? `${firstGroup.displayPath}${firstMatch?.lineNumber !== undefined ? `:${firstMatch.lineNumber}` : ""}${firstMatch?.text ? ` ${firstMatch.text.trim()}` : ""}`
          : "";
        return accept(snippet ? `${searchData.summaryZh} · ${snippet}` : searchData.summaryZh);
      }
      const firstPath = searchData.paths[0]?.displayPath;
      return accept(firstPath ? `${searchData.summaryZh} · ${firstPath}` : searchData.summaryZh);
    }
  }

  if (isWebWorkEntry(entry)) {
    const webData = normalizeWebWorkEntry(entry, entry.detail);
    if (webData) {
      if (webData.kind === "fetch") {
        const detail = webData.title || (webData.excerpt ? firstNonEmptyLine(webData.excerpt) : "");
        return accept(detail ? `${webData.summaryZh} · ${detail}` : webData.summaryZh);
      }
      const lead =
        webData.sources[0]?.title ??
        (webData.answerMarkdown ? firstNonEmptyLine(webData.answerMarkdown) : "");
      return accept(lead ? `${webData.summaryZh} · ${lead}` : webData.summaryZh);
    }
  }

  const todoSnapshot = extractTodoChecklistFromWorkEntry(entry);
  if (todoSnapshot) {
    const activeStep = todoSnapshot.steps.find((step) => step.status === "in_progress");
    return accept(
      activeStep
        ? `${todoSnapshot.summaryPillZh} · ${activeStep.title}`
        : todoSnapshot.summaryPillZh,
    );
  }

  if (payload?.type === "file_change") {
    if (payload.status === "failed" && payload.diffStr?.trim()) {
      return accept(diagnoseModelError(payload.diffStr).titleZh);
    }
    const parsedDiff = parseCompactDiffPreview({
      diffStr: payload.diffStr,
      oldStr: payload.oldStr,
      newStr: payload.newStr,
    });
    const highlightLine =
      parsedDiff?.lines.find(
        (line) => (line.kind === "add" || line.kind === "del") && line.text.trim(),
      ) ?? parsedDiff?.lines.find((line) => line.kind === "context" && line.text.trim());
    if (highlightLine) {
      return accept(`${highlightLine.prefix}${highlightLine.text.trim()}`);
    }
    return null;
  }

  if (payload?.type === "dynamic_tool") {
    const fromOutput = summarizeUnknownInline(payload.output);
    if (fromOutput) return accept(fromOutput);
    const fromInput = summarizeUnknownInline(payload.input);
    if (fromInput) return accept(fromInput);
  }

  if (entry.toolData !== undefined) {
    const fromToolData = summarizeUnknownInline(entry.toolData);
    if (fromToolData) return accept(fromToolData);
  }

  return accept(entry.detail ? firstNonEmptyLine(entry.detail) : null);
}
