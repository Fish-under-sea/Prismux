import { randomUUID } from "node:crypto";
import {
  DIAL_MODE_DESCRIPTIONS,
  type DialMode,
  type HandoffRequest,
  type HandoffResult,
  type HandoffSummary
} from "@prismux/protocol";

export interface HandoffTranscriptMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  touchedFiles?: string[];
  timestamp?: number;
}

export interface HandoffExecutionRequest extends HandoffRequest {
  transcript?: HandoffTranscriptMessage[];
}

export interface HandoffNotePersistPayload {
  sourceThreadId: string;
  newThreadId: string;
  dialMode: DialMode;
  summary: HandoffSummary;
  continuationPrompt: string;
  createdAt: number;
  targetWorkspace?: string;
  targetBranch?: string;
}

export type HandoffSummarizer = (input: {
  request: HandoffExecutionRequest;
  transcript: ReadonlyArray<HandoffTranscriptMessage>;
  fallbackSummary: HandoffSummary;
}) => Promise<Partial<HandoffSummary> | HandoffSummary>;

export interface HandoffEngineOptions {
  defaultDialMode?: DialMode;
  summarizer?: HandoffSummarizer;
  onPersistHandoffNote?: (
    note: HandoffNotePersistPayload
  ) => Promise<void> | void;
}

export interface HandoffExecutionResult extends HandoffResult {
  continuationPrompt: string;
  persistedNote: boolean;
}

export class DialModeToolDeniedError extends Error {
  readonly threadId: string;
  readonly dialMode: DialMode;
  readonly toolName: string;

  constructor(threadId: string, dialMode: DialMode, toolName: string) {
    super(
      `Thread "${threadId}" is in read-only dial mode "${dialMode}" and cannot invoke mutating tool "${toolName}".`
    );
    this.name = "DialModeToolDeniedError";
    this.threadId = threadId;
    this.dialMode = dialMode;
    this.toolName = toolName;
  }
}

const READ_ONLY_DIAL_TOOLS = new Set<string>([
  "read_file",
  "read",
  "view_file",
  "view_file_outline",
  "view_code_item",
  "cat",
  "head",
  "tail",
  "list_dir",
  "ls",
  "dir",
  "tree",
  "find_by_name",
  "glob",
  "grep_search",
  "grep",
  "ripgrep",
  "rg",
  "search",
  "code_search",
  "find_in_files",
  "git_status",
  "git_diff",
  "git_log",
  "git_show",
  "view_diff",
  "diff",
  "memory_query",
  "memory_search",
  "oracle_review",
  "inspect"
]);

const READ_ONLY_TOOL_PREFIXES = [
  "read_",
  "view_",
  "list_",
  "get_",
  "search_",
  "find_",
  "grep_",
  "diff_",
  "inspect_",
  "analyze_",
  "review_",
  "check_",
  "stat_"
] as const;

const MUTATING_TOOL_NAMES = new Set<string>([
  "write_file",
  "write_to_file",
  "write",
  "create_file",
  "edit_file",
  "edit",
  "replace_file_content",
  "multi_replace_file_content",
  "apply_patch",
  "patch_file",
  "update_file",
  "str_replace",
  "str_replace_editor",
  "delete_file",
  "remove_file",
  "unlink",
  "rm",
  "rmdir",
  "delete",
  "remove",
  "mkdir",
  "touch",
  "mv",
  "cp",
  "chmod",
  "chown",
  "run_command",
  "bash",
  "sh",
  "zsh",
  "shell",
  "exec",
  "command",
  "terminal",
  "powershell",
  "pwsh",
  "cmd",
  "git_commit",
  "git_push",
  "git_checkout",
  "git_switch",
  "git_merge",
  "git_rebase",
  "git_reset",
  "git_cherry_pick",
  "git_add",
  "git_stash",
  "memory_upsert",
  "install_plugin",
  "uninstall_plugin"
]);

const MUTATING_TOOL_SEGMENTS = new Set<string>([
  "write",
  "edit",
  "delete",
  "remove",
  "create",
  "patch",
  "modify",
  "update",
  "replace",
  "upsert",
  "commit",
  "push",
  "reset",
  "rebase",
  "merge",
  "checkout",
  "switch",
  "cherry",
  "stash",
  "exec",
  "run",
  "shell",
  "bash",
  "pwsh",
  "powershell",
  "cmd",
  "spawn",
  "kill",
  "install",
  "uninstall",
  "apply",
  "mkdir",
  "touch",
  "unlink",
  "rm",
  "rmdir",
  "mv",
  "cp",
  "chmod",
  "chown"
]);

function splitToolIdentifierTokens(toolName: string): string[] {
  return toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * Evaluates whether `toolName` is allowed under the given Dial mode (`agent` | `oracle` | `review`).
 * `oracle` and `review` strictly deny write, edit, delete, shell execution, and git mutation tools.
 */
export function isToolAllowedInDialMode(
  mode: DialMode,
  toolName: string,
  _toolInput?: Record<string, unknown>
): boolean {
  if (!DIAL_MODE_DESCRIPTIONS[mode].readOnly) {
    return true;
  }

  const normalized = toolName.trim().toLowerCase().replaceAll("-", "_");
  if (normalized.length === 0) {
    return false;
  }

  if (MUTATING_TOOL_NAMES.has(normalized)) {
    return false;
  }

  const tokens = splitToolIdentifierTokens(toolName);
  for (const token of tokens) {
    if (MUTATING_TOOL_SEGMENTS.has(token)) {
      return false;
    }
  }

  if (READ_ONLY_DIAL_TOOLS.has(normalized)) {
    return true;
  }

  for (const prefix of READ_ONLY_TOOL_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

const KNOWN_FILE_EXTENSIONS =
  "(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|json|jsonc|md|mdx|rs|toml|yaml|yml|sql|css|scss|html|htm|py|go|sh|bash|ps1|bat|cmd|txt|env|lock)";

const KNOWN_PATH_ROOTS =
  "(?:apps|packages|src|docs|scripts|plugins-official|vendor|tests|__tests__|\\.github|\\.work)";

const FILE_WITH_EXT_REGEX = new RegExp(
  `(?:^|[\\s(\`"'\\[【（:：,，、。;；?!！？\\u4e00-\\u9fff])((?:[a-zA-Z]:[\\\\/]|\\.{1,2}[\\\\/]|[a-zA-Z0-9._-]+(?:[\\\\/][a-zA-Z0-9._-]+)+[\\\\/]?|[a-zA-Z0-9._-]+)\\.${KNOWN_FILE_EXTENSIONS})(?=$|\\.(?=\\s|$)|[\\s)\`"'\\]】）,，、。;；:：?!！？\\u4e00-\\u9fff])`,
  "g"
);

const ROOTED_PATH_REGEX = new RegExp(
  `(?:^|[\\s(\`"'\\[【（:：,，、。;；?!！？\\u4e00-\\u9fff])(${KNOWN_PATH_ROOTS}(?:[\\\\/][a-zA-Z0-9._-]+)+)(?=$|\\.(?=\\s|$)|[\\s)\`"'\\]】）,，、。;；:：?!！？\\u4e00-\\u9fff])`,
  "g"
);

const EXPLICIT_GOAL_PREFIX =
  /^(?:[-*•]\s*)?(?:\*\*?)?(?:goal|objective|task|目标|任务|需求|目的)(?:\*\*?)?\s*[:：]\s*(.+)$/i;

const EXPLICIT_DECISION_PREFIX =
  /^(?:[-*•]\s*)?(?:\*\*?)?(?:decision|decided|architecture|conclusion|决定|决策|方案|结论|确认|采用|约定)(?:\*\*?)?\s*[:：]\s*(.+)$/i;

const EXPLICIT_QUESTION_PREFIX =
  /^(?:[-*•]\s*)?(?:\*\*?)?(?:open\s*question|question|todo|fixme|pending|blocker|risk|open|待确认|待解决|未决问题|遗留问题|问题|待办|阻塞|风险)(?:\*\*?)?\s*[:：]\s*(.+)$/i;

const DECISION_SENTENCE_PATTERN =
  /(?:决定|决策|最终采用|确定使用|已确定|已确认|统一使用|统一走|改为|保留|必须|禁止|严禁|方案为|chose\s+to|decided\s+to|agreed\s+to|we\s+will\s+use|switched\s+to|confirmed\s+that|must\s+(?:keep|use|enforce|never))/i;

const OPEN_QUESTION_SENTENCE_PATTERN =
  /(?:[?？]\s*$|尚未|还没|未确定|待定|待确认|待验证|遗留|需要确认|是否需要|是否允许|怎么处理|如何处理|not\s+yet|need(?:s)?\s+to\s+(?:verify|confirm|decide|check)|unclear\s+whether|remains?\s+open|tbd\b|todo\b|fixme\b)/i;

const GREETING_ONLY_PATTERN =
  /^(?:你好|您好|在吗|好的|收到|谢谢|多谢|明白|了解|ok|okay|thanks|thank\s+you|sure|yes|no|hello|hi|hey)[!！。.,，\s]*$/i;

function dedupeStrings(items: ReadonlyArray<string>, limit = 20): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of items) {
    const cleaned = raw.trim();
    if (cleaned.length === 0) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(cleaned);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function splitIntoClauses(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const clauses: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    if (
      EXPLICIT_GOAL_PREFIX.test(line) ||
      EXPLICIT_DECISION_PREFIX.test(line) ||
      EXPLICIT_QUESTION_PREFIX.test(line)
    ) {
      clauses.push(line);
      continue;
    }
    const parts = line.split(/(?<=\S)\.(?=\s|$)|[。；;]+/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length > 0) {
        clauses.push(trimmed);
      }
    }
  }
  return clauses;
}

function normalizeFilePathCandidate(rawPath: string): string | undefined {
  let candidate = rawPath.trim().replace(/^["'`]+|["'`]+$/g, "");
  candidate = candidate.replace(/[.,;!?)]+$/, "");
  if (candidate.length === 0) {
    return undefined;
  }
  if (/^https?:\/\//i.test(candidate) || /^ws:\/\//i.test(candidate)) {
    return undefined;
  }
  if (/^\d+(?:\.\d+)+$/.test(candidate) || /^v\d+(?:\.\d+)+$/i.test(candidate)) {
    return undefined;
  }
  return candidate.replaceAll("\\", "/");
}

function extractFilePathsFromText(text: string): string[] {
  const sanitized = text.replace(
    /(?:https?|wss?):\/\/[^\s)`"'】）,，。、;；?!！？]+/gi,
    " "
  );
  const found: string[] = [];
  const collect = (regex: RegExp) => {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null = regex.exec(sanitized);
    while (match !== null) {
      const raw = match[1];
      if (raw !== undefined) {
        const normalized = normalizeFilePathCandidate(raw);
        if (normalized !== undefined) {
          found.push(normalized);
        }
      }
      match = regex.exec(sanitized);
    }
  };

  collect(FILE_WITH_EXT_REGEX);
  collect(ROOTED_PATH_REGEX);
  return found;
}

/**
 * Deterministic high-fidelity transcript distiller that extracts `{ goal, decisions, touchedFiles, openQuestions }`
 * from multi-turn plain-text conversations, structured tags, `touchedFiles` metadata, and `additionalContext`.
 */
export function distillTranscript(
  messages: ReadonlyArray<HandoffTranscriptMessage>,
  request: HandoffRequest
): HandoffSummary {
  const explicitGoals: string[] = [];
  const userGoals: string[] = [];
  const decisions: string[] = [];
  const touchedFiles: string[] = [];
  const openQuestions: string[] = [];

  for (const msg of messages) {
    if (Array.isArray(msg.touchedFiles)) {
      for (const file of msg.touchedFiles) {
        const normalized = normalizeFilePathCandidate(file);
        if (normalized !== undefined) {
          touchedFiles.push(normalized);
        }
      }
    }

    const content = msg.content ?? "";
    if (content.trim().length === 0) {
      continue;
    }

    touchedFiles.push(...extractFilePathsFromText(content));

    const clauses = splitIntoClauses(content);
    for (const clause of clauses) {
      const goalMatch = EXPLICIT_GOAL_PREFIX.exec(clause);
      if (goalMatch?.[1] !== undefined) {
        explicitGoals.push(goalMatch[1].trim());
        continue;
      }

      const decisionMatch = EXPLICIT_DECISION_PREFIX.exec(clause);
      if (decisionMatch?.[1] !== undefined) {
        decisions.push(decisionMatch[1].trim());
        continue;
      }

      const questionMatch = EXPLICIT_QUESTION_PREFIX.exec(clause);
      if (questionMatch?.[1] !== undefined) {
        openQuestions.push(questionMatch[1].trim());
        continue;
      }

      if (GREETING_ONLY_PATTERN.test(clause)) {
        continue;
      }

      if (OPEN_QUESTION_SENTENCE_PATTERN.test(clause)) {
        openQuestions.push(clause);
        continue;
      }

      if (DECISION_SENTENCE_PATTERN.test(clause)) {
        decisions.push(clause);
        continue;
      }

      if (
        msg.role === "user" &&
        userGoals.length === 0 &&
        clause.length >= 6
      ) {
        userGoals.push(clause);
      }
    }
  }

  const additionalContext = request.additionalContext?.trim();
  if (additionalContext !== undefined && additionalContext.length > 0) {
    touchedFiles.push(...extractFilePathsFromText(additionalContext));
    for (const clause of splitIntoClauses(additionalContext)) {
      const goalMatch = EXPLICIT_GOAL_PREFIX.exec(clause);
      if (goalMatch?.[1] !== undefined) {
        explicitGoals.push(goalMatch[1].trim());
        continue;
      }
      const decisionMatch = EXPLICIT_DECISION_PREFIX.exec(clause);
      if (decisionMatch?.[1] !== undefined) {
        decisions.push(decisionMatch[1].trim());
        continue;
      }
      const questionMatch = EXPLICIT_QUESTION_PREFIX.exec(clause);
      if (questionMatch?.[1] !== undefined) {
        openQuestions.push(questionMatch[1].trim());
        continue;
      }
      if (OPEN_QUESTION_SENTENCE_PATTERN.test(clause)) {
        openQuestions.push(clause);
      } else if (DECISION_SENTENCE_PATTERN.test(clause)) {
        decisions.push(clause);
      }
    }
  }

  let goal =
    explicitGoals[0] ??
    userGoals[0] ??
    additionalContext ??
    `Continuation from ${request.sourceThreadId}`;

  if (
    additionalContext !== undefined &&
    additionalContext.length > 0 &&
    explicitGoals.length === 0 &&
    userGoals.length > 0 &&
    !goal.includes(additionalContext)
  ) {
    goal = `${goal}（补充上下文：${additionalContext}）`;
  }

  return {
    goal,
    decisions: dedupeStrings(decisions, 12),
    touchedFiles: dedupeStrings(touchedFiles, 32),
    openQuestions: dedupeStrings(openQuestions, 12)
  };
}

/**
 * Amp-inspired `/handoff` distillation engine + 3-mode Dial (`agent` | `oracle` | `review`).
 * Distills long threads into `{ goal, decisions, touchedFiles, openQuestions }`, guards tool permissions
 * by Dial mode, and opens a fresh thread ready for continuation.
 */
export class HandoffEngine {
  private readonly threadDialModes = new Map<string, DialMode>();
  private readonly handoffHistory = new Map<string, HandoffExecutionResult>();
  private readonly defaultDialMode: DialMode;
  private readonly summarizer: HandoffSummarizer | undefined;
  private readonly onPersistHandoffNote:
    | ((note: HandoffNotePersistPayload) => Promise<void> | void)
    | undefined;
  private threadSeq = 0;

  constructor(options?: HandoffEngineOptions) {
    this.defaultDialMode = options?.defaultDialMode ?? "agent";
    this.summarizer = options?.summarizer;
    this.onPersistHandoffNote = options?.onPersistHandoffNote;
  }

  getDialMode(threadId: string): DialMode {
    return this.threadDialModes.get(threadId) ?? this.defaultDialMode;
  }

  setDialMode(threadId: string, mode: DialMode): DialMode {
    this.threadDialModes.set(threadId, mode);
    return mode;
  }

  isReadOnlyMode(mode: DialMode): boolean {
    return DIAL_MODE_DESCRIPTIONS[mode].readOnly;
  }

  isToolAllowedForThread(
    threadId: string,
    toolName: string,
    toolInput?: Record<string, unknown>
  ): boolean {
    return isToolAllowedInDialMode(this.getDialMode(threadId), toolName, toolInput);
  }

  assertToolAllowedForThread(
    threadId: string,
    toolName: string,
    toolInput?: Record<string, unknown>
  ): void {
    const mode = this.getDialMode(threadId);
    if (!isToolAllowedInDialMode(mode, toolName, toolInput)) {
      throw new DialModeToolDeniedError(threadId, mode, toolName);
    }
  }

  createEmptySummary(goal: string): HandoffSummary {
    return {
      goal,
      decisions: [],
      touchedFiles: [],
      openQuestions: []
    };
  }

  distillTranscript(
    messages: ReadonlyArray<HandoffTranscriptMessage>,
    request: HandoffRequest
  ): HandoffSummary {
    return distillTranscript(messages, request);
  }

  getThreadHandoffResult(threadId: string): HandoffExecutionResult | undefined {
    return this.handoffHistory.get(threadId);
  }

  buildContinuationPrompt(input: {
    sourceThreadId: string;
    newThreadId: string;
    dialMode: DialMode;
    summary: HandoffSummary;
    targetWorkspace?: string;
    targetBranch?: string;
    additionalContext?: string;
  }): string {
    const modeDesc = DIAL_MODE_DESCRIPTIONS[input.dialMode];
    const lines: string[] = [
      `# Handoff 续跑上下文`,
      `- 新线程 ID：${input.newThreadId}`,
      `- 来源线程 ID：${input.sourceThreadId}`,
      `- 拨盘模式：${input.dialMode}（${modeDesc.label} · ${modeDesc.readOnly ? "只读护栏已开启" : "完整读写执行"}）`
    ];

    if (input.targetWorkspace !== undefined && input.targetWorkspace.length > 0) {
      lines.push(`- 目标工作区：${input.targetWorkspace}`);
    }
    if (input.targetBranch !== undefined && input.targetBranch.length > 0) {
      lines.push(`- 目标分支：${input.targetBranch}`);
    }

    lines.push("", `## 核心目标`, input.summary.goal);

    lines.push("", `## 关键决策`);
    if (input.summary.decisions.length === 0) {
      lines.push("- （暂无额外记录）");
    } else {
      for (const decision of input.summary.decisions) {
        lines.push(`- ${decision}`);
      }
    }

    lines.push("", `## 涉及文件`);
    if (input.summary.touchedFiles.length === 0) {
      lines.push("- （暂无显式文件）");
    } else {
      for (const file of input.summary.touchedFiles) {
        lines.push(`- \`${file}\``);
      }
    }

    lines.push("", `## 遗留 / 待确认问题`);
    if (input.summary.openQuestions.length === 0) {
      lines.push("- （无遗留未决问题）");
    } else {
      for (const question of input.summary.openQuestions) {
        lines.push(`- ${question}`);
      }
    }

    if (
      input.additionalContext !== undefined &&
      input.additionalContext.trim().length > 0
    ) {
      lines.push("", `## 附加指示`, input.additionalContext.trim());
    }

    return lines.join("\n");
  }

  async executeHandoff(
    request: HandoffExecutionRequest
  ): Promise<HandoffExecutionResult> {
    const dialMode = request.targetDialMode ?? this.defaultDialMode;
    const createdAt = Date.now();
    const newThreadId = `handoff-${createdAt}-${++this.threadSeq}-${randomUUID().slice(0, 6)}`;
    this.setDialMode(newThreadId, dialMode);

    const transcript = request.transcript ?? [];
    const fallbackSummary = this.distillTranscript(transcript, request);
    let summary = fallbackSummary;

    if (this.summarizer !== undefined) {
      try {
        const modelSummary = await this.summarizer({
          request,
          transcript,
          fallbackSummary
        });
        summary = {
          goal:
            typeof modelSummary.goal === "string" &&
            modelSummary.goal.trim().length > 0
              ? modelSummary.goal.trim()
              : fallbackSummary.goal,
          decisions:
            Array.isArray(modelSummary.decisions) &&
            modelSummary.decisions.length > 0
              ? dedupeStrings(modelSummary.decisions, 12)
              : fallbackSummary.decisions,
          touchedFiles:
            Array.isArray(modelSummary.touchedFiles) &&
            modelSummary.touchedFiles.length > 0
              ? dedupeStrings(
                  [
                    ...modelSummary.touchedFiles.map(
                      (item) => normalizeFilePathCandidate(item) ?? item
                    ),
                    ...fallbackSummary.touchedFiles
                  ],
                  32
                )
              : fallbackSummary.touchedFiles,
          openQuestions:
            Array.isArray(modelSummary.openQuestions) &&
            modelSummary.openQuestions.length > 0
              ? dedupeStrings(modelSummary.openQuestions, 12)
              : fallbackSummary.openQuestions
        };
      } catch {
        summary = fallbackSummary;
      }
    }

    const continuationPrompt = this.buildContinuationPrompt({
      sourceThreadId: request.sourceThreadId,
      newThreadId,
      dialMode,
      summary,
      targetWorkspace: request.targetWorkspace,
      targetBranch: request.targetBranch,
      additionalContext: request.additionalContext
    });

    let persistedNote = false;
    if (this.onPersistHandoffNote !== undefined) {
      await this.onPersistHandoffNote({
        sourceThreadId: request.sourceThreadId,
        newThreadId,
        dialMode,
        summary,
        continuationPrompt,
        createdAt,
        ...(request.targetWorkspace !== undefined
          ? { targetWorkspace: request.targetWorkspace }
          : {}),
        ...(request.targetBranch !== undefined
          ? { targetBranch: request.targetBranch }
          : {})
      });
      persistedNote = true;
    }

    const result: HandoffExecutionResult = {
      sourceThreadId: request.sourceThreadId,
      newThreadId,
      dialMode,
      summary,
      createdAt,
      continuationPrompt,
      persistedNote
    };
    this.handoffHistory.set(newThreadId, result);
    return result;
  }
}
