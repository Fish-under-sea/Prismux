import type * as AcpSchema from "@prismux/effect-acp/compat";
import type { AcpAdapterV2SubagentUpdate } from "@prismux/provider-acp/server/adapter";
import {
  extractAcpTodoToolPlanUpdate,
  type AcpPlanUpdate,
  type AcpToolCallState,
} from "@prismux/provider-acp/server/runtimeModel";

import type { AcpRegistrySettings } from "../settings.ts";
import { isDeepSeekHarnessSpawn } from "./dshLocal.ts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Returns true when an ACP Registry provider instance is configured to launch
 * DeepSeek Harness (`dsh`), either by local command/args or registry agent ID.
 */
export function isDeepSeekHarnessSettings(settings: AcpRegistrySettings): boolean {
  if (settings.source === "local") {
    return isDeepSeekHarnessSpawn(settings.commandPath, settings.commandArgs);
  }
  const agentId = settings.agentId.trim().toLowerCase();
  return agentId === "dsh" || agentId === "deepseek-harness" || agentId === "deepseek-harness-acp";
}

/**
 * Returns true when the ACP `initialize` handshake identifies DeepSeek Harness (`deepseek-harness-acp`).
 */
export function isDeepSeekHarnessAgentInfo(
  initializeResult: Pick<AcpSchema.InitializeResponse, "agentInfo"> | null | undefined,
): boolean {
  const name = initializeResult?.agentInfo?.name?.trim().toLowerCase() ?? "";
  return name === "deepseek-harness-acp" || name === "deepseek-harness" || name === "dsh";
}

const DSH_EXECUTE_TOOLS = new Set([
  "pwsh",
  "bash",
  "shell",
  "terminal_open",
  "terminal_send",
  "run_code",
]);
const DSH_READ_TOOLS = new Set(["read", "read_file", "read_image", "view_file"]);
const DSH_EDIT_TOOLS = new Set(["edit", "write", "write_file", "apply_patch"]);
const DSH_SEARCH_TOOLS = new Set(["glob", "grep", "web_search"]);
const DSH_FETCH_TOOLS = new Set(["web_fetch"]);
const DSH_TODO_TOOLS = new Set([
  "todo_write",
  "todowrite",
  "todo",
  "todos",
  "write_todos",
  "update_plan",
  "update_steps",
]);
const DSH_THINK_TOOLS = new Set([...DSH_TODO_TOOLS, "exit_plan_mode", "get_goal", "update_goal"]);

function extractDshFilePath(rawInput: Record<string, unknown> | undefined): string | undefined {
  return (
    asNonEmptyString(rawInput?.file_path) ??
    asNonEmptyString(rawInput?.filePath) ??
    asNonEmptyString(rawInput?.path) ??
    asNonEmptyString(rawInput?.target_file)
  );
}

function extractDshDiffContent(
  toolName: string,
  rawInput: Record<string, unknown> | undefined,
  existingContent: ReadonlyArray<AcpSchema.ToolCallContent> | null | undefined,
): ReadonlyArray<AcpSchema.ToolCallContent> | undefined {
  if (existingContent?.some((entry) => entry.type === "diff")) {
    return undefined;
  }
  const filePath = extractDshFilePath(rawInput);
  if (!filePath) return undefined;

  if (toolName === "edit" || toolName === "str_replace_editor") {
    const oldText =
      typeof rawInput?.old_string === "string"
        ? rawInput.old_string
        : typeof rawInput?.old_str === "string"
          ? rawInput.old_str
          : undefined;
    const newText =
      typeof rawInput?.new_string === "string"
        ? rawInput.new_string
        : typeof rawInput?.new_str === "string"
          ? rawInput.new_str
          : undefined;
    if (oldText !== undefined && newText !== undefined) {
      return [...(existingContent ?? []), { type: "diff", path: filePath, oldText, newText }];
    }
  }

  if (toolName === "write" || toolName === "write_file") {
    const content = typeof rawInput?.content === "string" ? rawInput.content : undefined;
    if (content !== undefined) {
      return [...(existingContent ?? []), { type: "diff", path: filePath, newText: content }];
    }
  }

  if (toolName === "str_replace_editor" && rawInput?.command === "create") {
    const fileText = typeof rawInput.file_text === "string" ? rawInput.file_text : undefined;
    if (fileText !== undefined) {
      return [...(existingContent ?? []), { type: "diff", path: filePath, newText: fileText }];
    }
  }

  return undefined;
}

function mapDshToolKind(
  toolName: string,
  rawInput: Record<string, unknown> | undefined,
): AcpSchema.ToolKind | undefined {
  if (DSH_EXECUTE_TOOLS.has(toolName)) return "execute";
  if (DSH_READ_TOOLS.has(toolName)) return "read";
  if (DSH_EDIT_TOOLS.has(toolName)) return "edit";
  if (toolName === "str_replace_editor") {
    return asNonEmptyString(rawInput?.command)?.toLowerCase() === "view" ? "read" : "edit";
  }
  if (DSH_SEARCH_TOOLS.has(toolName)) return "search";
  if (DSH_FETCH_TOOLS.has(toolName)) return "fetch";
  if (DSH_THINK_TOOLS.has(toolName)) return "think";
  return undefined;
}

/**
 * Upgrades DSH (`dsh acp`) `tool_call` notifications (which always emit `kind: "other"`)
 * into semantic ACP `kind`, `locations`, `diff`, and search query metadata.
 */
export function normalizeDshSessionUpdate(
  notification: AcpSchema.SessionNotification,
): AcpSchema.SessionNotification {
  const update = notification.update;
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
    return notification;
  }

  const rawTitle = asNonEmptyString(update.title);
  if (!rawTitle) return notification;
  const toolName = rawTitle.toLowerCase();
  const rawInput = asRecord(update.rawInput);

  // Only upgrade generic/unspecified kinds; preserve explicit non-"other" kinds if DSH starts sending them.
  const inferredKind =
    update.kind === undefined || update.kind === null || update.kind === "other"
      ? mapDshToolKind(toolName, rawInput)
      : undefined;

  let nextTitle: string | undefined;
  let nextRawInput: Record<string, unknown> | undefined;
  let nextLocations: ReadonlyArray<AcpSchema.ToolCallLocation> | undefined;
  let nextContent: ReadonlyArray<AcpSchema.ToolCallContent> | undefined;
  let extraMeta: Record<string, unknown> | undefined;

  if (toolName === "pwsh" || toolName === "bash" || toolName === "shell") {
    const command = asNonEmptyString(rawInput?.command);
    const description = asNonEmptyString(rawInput?.description);
    if (description) {
      nextTitle = description;
    } else if (command) {
      nextTitle = `\`${command}\``;
    }
  } else if (toolName === "skill") {
    const skillName = asNonEmptyString(rawInput?.name);
    nextTitle = skillName ? `Skill: ${skillName}` : "Skill";
    extraMeta = skillName ? { skillName } : {};
  } else if (toolName === "web_search") {
    const queries = Array.isArray(rawInput?.queries)
      ? rawInput.queries.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : [];
    if (queries.length > 0 && asNonEmptyString(rawInput?.query) === undefined) {
      nextRawInput = { ...rawInput, query: queries.join(" / ") };
    }
    nextTitle = "Web search";
  } else if (toolName === "web_fetch") {
    const url = asNonEmptyString(rawInput?.url);
    if (url && (!update.locations || update.locations.length === 0)) {
      nextLocations = [{ path: url }];
    }
    nextTitle = url ? `Fetch ${url}` : "Web fetch";
  } else if (DSH_TODO_TOOLS.has(toolName)) {
    nextTitle = "Update plan";
  } else if (toolName === "exit_plan_mode") {
    nextTitle = "Submit plan";
  }

  const filePath = extractDshFilePath(rawInput);
  if (
    filePath &&
    nextLocations === undefined &&
    (!update.locations || update.locations.length === 0) &&
    (inferredKind === "read" || inferredKind === "edit")
  ) {
    const offset =
      typeof rawInput?.offset === "number" && Number.isFinite(rawInput.offset)
        ? rawInput.offset
        : undefined;
    nextLocations = [offset !== undefined ? { path: filePath, line: offset } : { path: filePath }];
  }

  if (inferredKind === "edit") {
    nextContent = extractDshDiffContent(toolName, rawInput, update.content);
  }

  if (
    inferredKind === undefined &&
    nextTitle === undefined &&
    nextRawInput === undefined &&
    nextLocations === undefined &&
    nextContent === undefined &&
    extraMeta === undefined
  ) {
    return notification;
  }

  return {
    ...notification,
    update: {
      ...update,
      ...(inferredKind !== undefined ? { kind: inferredKind } : {}),
      ...(nextTitle !== undefined ? { title: nextTitle } : {}),
      ...(nextRawInput !== undefined ? { rawInput: nextRawInput } : {}),
      ...(nextLocations !== undefined ? { locations: nextLocations } : {}),
      ...(nextContent !== undefined ? { content: nextContent } : {}),
      _meta: {
        ...asRecord(update._meta),
        ...extraMeta,
        dshToolName: toolName,
      },
    },
  };
}

/**
 * Ensures merged DSH tool-call states retain clean skill titles and synthesized diffs
 * even after `tool_call_update` replaces `content` with plain tool output text.
 */
export function normalizeDshToolCall(toolCall: AcpToolCallState): AcpToolCallState {
  const meta = asRecord(toolCall.data.meta);
  const dshToolName =
    asNonEmptyString(meta?.dshToolName)?.toLowerCase() ??
    asNonEmptyString(toolCall.data.title)?.toLowerCase();
  const rawInput = asRecord(toolCall.data.rawInput);

  if (dshToolName === "skill") {
    const skillName = asNonEmptyString(rawInput?.name) ?? asNonEmptyString(meta?.skillName);
    const preservedKind =
      toolCall.kind === undefined || toolCall.kind === "read" ? "other" : toolCall.kind;
    return {
      ...toolCall,
      kind: preservedKind,
      title: skillName ? `Skill: ${skillName}` : (toolCall.title ?? "Skill"),
      data: {
        ...toolCall.data,
        kind: preservedKind,
        meta: {
          ...meta,
          dshToolName: "skill",
          ...(skillName ? { skillName } : {}),
        },
      },
    };
  }

  if (dshToolName && (toolCall.kind === "edit" || DSH_EDIT_TOOLS.has(dshToolName))) {
    const existingContent = Array.isArray(toolCall.data.content)
      ? (toolCall.data.content as ReadonlyArray<AcpSchema.ToolCallContent>)
      : undefined;
    const withDiff = extractDshDiffContent(dshToolName, rawInput, existingContent);
    if (withDiff !== undefined) {
      return {
        ...toolCall,
        kind: "edit",
        data: {
          ...toolCall.data,
          kind: "edit",
          content: withDiff,
        },
      };
    }
  }

  return toolCall;
}

/**
 * Extracts structured `todo_list` plan updates from DeepSeek Harness `todo_write` / `update_plan` calls.
 */
export function extractDshTodoPlanUpdate(toolCall: AcpToolCallState): AcpPlanUpdate | undefined {
  const meta = asRecord(toolCall.data.meta);
  const dshToolName =
    asNonEmptyString(meta?.dshToolName)?.toLowerCase() ??
    asNonEmptyString(toolCall.data.title)?.toLowerCase();
  if (
    dshToolName !== undefined &&
    !DSH_TODO_TOOLS.has(dshToolName) &&
    dshToolName !== "update plan"
  ) {
    return undefined;
  }
  return extractAcpTodoToolPlanUpdate(toolCall);
}

/**
 * Extracts markdown plans submitted through DeepSeek Harness's `exit_plan_mode` tool.
 */
export function extractDshProposedPlanMarkdown(toolCall: AcpToolCallState): string | undefined {
  const meta = asRecord(toolCall.data.meta);
  const dshToolName =
    asNonEmptyString(meta?.dshToolName)?.toLowerCase() ??
    asNonEmptyString(toolCall.data.title)?.toLowerCase();
  if (dshToolName !== "exit_plan_mode") return undefined;
  return asNonEmptyString(asRecord(toolCall.data.rawInput)?.plan);
}

/**
 * Extracts subagent delegation metadata from DeepSeek Harness `subagent` / `subagent_fork` calls.
 */
export function extractDshSubagentUpdate(
  toolCall: AcpToolCallState,
): AcpAdapterV2SubagentUpdate | undefined {
  const meta = asRecord(toolCall.data.meta);
  const dshToolName =
    asNonEmptyString(meta?.dshToolName)?.toLowerCase() ??
    asNonEmptyString(toolCall.data.title)?.toLowerCase();
  if (dshToolName !== "subagent" && dshToolName !== "subagent_fork") {
    return undefined;
  }
  const input = asRecord(toolCall.data.rawInput);
  const prompt =
    asNonEmptyString(input?.prompt) ??
    asNonEmptyString(input?.task) ??
    asNonEmptyString(input?.message) ??
    "";
  if (prompt.length === 0) return undefined;
  const title =
    asNonEmptyString(input?.name) ??
    asNonEmptyString(input?.description) ??
    asNonEmptyString(input?.label) ??
    null;
  const model = asNonEmptyString(input?.model) ?? null;
  const outputContent = Array.isArray(toolCall.data.content)
    ? toolCall.data.content
        .flatMap((entry) => {
          const rec = asRecord(entry);
          const inner = asRecord(rec?.content);
          return rec?.type === "content" && inner?.type === "text" && typeof inner.text === "string"
            ? [inner.text]
            : [];
        })
        .join("\n")
        .trim()
    : "";
  const status =
    toolCall.status === "failed"
      ? "failed"
      : toolCall.status === "completed"
        ? "completed"
        : "running";
  return {
    nativeTaskId: toolCall.toolCallId,
    childSessionId: `dsh-subagent:${toolCall.toolCallId}`,
    prompt,
    title,
    model,
    status,
    result: outputContent.length > 0 ? outputContent : null,
  };
}

/**
 * Matches Prismux composer inline skill mentions (`$skill-name`) and explicit `/skill:name`
 * tokens so DeepSeek Harness's `@deepseek-ai/dsh-tool-skill` (`SKILL_GESTURE` = `/<name>`)
 * natively loads and injects `<skill_content>` before the model step.
 */
const DSH_SKILL_MENTION_PATTERN =
  /(^|\s)(?:\$(?![0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?(?:\s|$))|\/skill:)([a-zA-Z0-9][a-zA-Z0-9_-]*)(?=\s|$)/gu;

export function rewriteDshUserText(
  text: string,
  knownSkillNames: ReadonlyMap<string, string>,
  mentionsFrom = 0,
): string {
  if (knownSkillNames.size === 0 || mentionsFrom >= text.length) return text;
  const prefix = mentionsFrom > 0 ? text.slice(0, mentionsFrom) : "";
  const target = mentionsFrom > 0 ? text.slice(mentionsFrom) : text;
  const rewritten = target.replace(
    DSH_SKILL_MENTION_PATTERN,
    (fullMatch, leadingWhitespace: string, rawName: string) => {
      const canonical = knownSkillNames.get(rawName.trim().toLowerCase());
      if (canonical === undefined) return fullMatch;
      return `${leadingWhitespace}/${canonical}`;
    },
  );
  return prefix + rewritten;
}
