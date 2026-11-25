import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";
import {
  DEFAULT_SECURITY_HOOK_FAILURE_POLICY,
  type ApprovalGuideCard,
  type HookExecutionResult,
  type HookFailurePolicy,
  type HookHandlerConfig,
  type HookInvocationContext,
  type LifecycleHookEvent,
  type PermissionMode,
  type RiskLevel
} from "@prismux/protocol";
import { sanitizeChildEnv } from "../core/CoreServerSupervisor.js";

export const DEFAULT_HOOK_TIMEOUT_MS = 5_000;
const MAX_HOOK_STDIO_BYTES = 1024 * 1024;
const KILL_GRACE_MS = 50;

export type HookHandlerFn = (
  context: HookInvocationContext
) => Promise<HookExecutionResult | void> | HookExecutionResult | void;

export interface CommandHookConfig extends HookHandlerConfig {
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  shell?: boolean;
}

export interface RegisteredHookEntry {
  config: CommandHookConfig;
  handler: HookHandlerFn;
}

export interface LifecycleHookBusOptions {
  defaultPermissionMode?: PermissionMode;
  enforcePermissionGate?: boolean;
}

export type ToolActionCategory =
  | "readonly"
  | "edit"
  | "delete"
  | "network"
  | "shell"
  | "high_risk";

export interface ApprovalDecisionRecord {
  requestId: string;
  sessionId: string;
  threadId: string;
  toolName: string;
  actionSignature: string;
  card: ApprovalGuideCard;
  status: "pending" | "approved" | "rejected" | "consumed";
  decisionReason?: string;
  createdAt: number;
  decidedAt?: number;
}

export interface HookDispatchResult extends HookExecutionResult {
  approvalRequired?: boolean;
  approvalRequestId?: string;
  permissionEvaluated?: boolean;
  warnings?: string[];
}

export type HookInvocationInput = HookInvocationContext & {
  approvalRequestId?: string;
};

interface RiskAssessment {
  card: ApprovalGuideCard;
  category: ToolActionCategory;
  touchesCredentials: boolean;
}

const READ_ONLY_TOOL_NAMES = new Set<string>([
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
  "memory_search"
]);

const EDIT_TOOL_NAMES = new Set<string>([
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
  "str_replace_editor"
]);

const DELETE_TOOL_NAMES = new Set<string>([
  "delete_file",
  "remove_file",
  "unlink",
  "rm",
  "rmdir",
  "delete",
  "remove"
]);

const NETWORK_TOOL_NAMES = new Set<string>([
  "fetch",
  "webfetch",
  "web_fetch",
  "http_request",
  "http",
  "curl",
  "wget",
  "request"
]);

const SHELL_TOOL_NAMES = new Set<string>([
  "bash",
  "sh",
  "zsh",
  "shell",
  "run_command",
  "exec",
  "command",
  "terminal",
  "powershell",
  "pwsh",
  "cmd"
]);

const CREDENTIAL_TARGET_PATTERN =
  /(?:^|[\\/\s"'`])(?:\.env(?:\.(?!example\b|sample\b|template\b)[a-zA-Z0-9_.-]+)?|\.ssh(?:[\\/].*)?|credentials(?:\.[a-zA-Z0-9_-]+)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|\.git-credentials|\.npmrc|\.pypirc|secrets?(?:\.[a-zA-Z0-9_-]+)?|[^\\/\s"'`]+\.(?:pem|key|pfx|p12))(?:$|[\\/\s"'`:])/i;

const HIGH_RISK_SHELL_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  summaryPrefix: string;
  reason: string;
}> = [
  {
    pattern:
      /\brm\b(?=[^;|&]*\s(?:-[a-zA-Z]*r[a-zA-Z]*|--recursive)\b)(?=[^;|&]*\s(?:-[a-zA-Z]*f[a-zA-Z]*|--force)\b)/i,
    summaryPrefix: "准备执行高危强制递归删除命令",
    reason: "命中高危规则：检测到 rm 递归强制删除指令（rm -rf），可能导致不可逆数据丢失"
  },
  {
    pattern:
      /\bremove-item\b(?=[^;|&]*\s-(?:recurse|r)\b)(?=[^;|&]*\s-(?:force|fo)\b)/i,
    summaryPrefix: "准备执行 PowerShell 强制递归删除命令",
    reason:
      "命中高危规则：检测到 Remove-Item -Recurse -Force 强制递归删除指令，可能导致不可逆数据丢失"
  },
  {
    pattern:
      /\bgit\s+push\b[^;|&]*(?:\s--force(?:-with-lease)?\b|\s-[a-zA-Z]*f[a-zA-Z]*\b)/i,
    summaryPrefix: "准备执行高危 Git 强制推送命令",
    reason: "命中高危规则：检测到 git push --force/-f 强制推送，可能覆盖远端提交历史"
  },
  {
    pattern: /\bgit\s+reset\b[^;|&]*\s--hard\b/i,
    summaryPrefix: "准备执行高危 Git 硬重置命令",
    reason: "命中高危规则：检测到 git reset --hard 硬重置，将永久丢弃未提交改动"
  },
  {
    pattern: /\bmkfs(?:\.[a-z0-9_+-]+)?\b/i,
    summaryPrefix: "准备执行高危磁盘格式化命令",
    reason: "命中高危规则：检测到 mkfs 磁盘格式化指令，可能直接擦除存储设备"
  },
  {
    pattern: /\bdd\b[^;|&]*\bif=/i,
    summaryPrefix: "准备执行高危底层块设备写入命令",
    reason: "命中高危规则：检测到 dd if= 底层数据块读写指令，存在覆写磁盘或分区风险"
  },
  {
    pattern:
      /\b(?:curl|wget|fetch|iwr|invoke-webrequest)\b[^;\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|ksh|pwsh|powershell|iex|invoke-expression)\b/i,
    summaryPrefix: "准备通过管道执行远程下载脚本",
    reason: "命中高危规则：检测到远程脚本管道执行（curl/wget ... | sh），存在任意代码执行风险"
  },
  {
    pattern: /\bchmod\b[^;|&]*\b0?777\b/i,
    summaryPrefix: "准备执行高危全开放权限修改命令",
    reason: "命中高危规则：检测到 chmod 777 将文件或目录设为全局可读写执行，存在严重提权与泄露隐患"
  }
];

const SHELL_MODIFY_CREDENTIAL_VERB_PATTERN =
  /(?:>>?|\b(?:rm|del|erase|remove-item|cp|copy|mv|move|ren|rename|touch|chmod|chown|tee|sed\s+-i|set-content|add-content|out-file|echo|printf|cat\s+.*>|vim|nano|code|truncate|install)\b)/i;

const READ_ONLY_SHELL_SINGLE_PATTERN =
  /^\s*(?:git\s+(?:status|diff|log|show|branch(?:\s+(?:--list|-a|-v|-vv))?)|ls|dir|pwd|cat|head|tail|grep|rg|ripgrep|find|which|where)\b/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase().replaceAll("-", "_");
}

function extractFirstString(
  input: Record<string, unknown> | undefined,
  keys: readonly string[]
): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  for (const key of keys) {
    const candidate = input[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return undefined;
}

function extractTargetSummary(context: HookInvocationContext): {
  command?: string;
  filePath?: string;
  url?: string;
  rawTarget?: string;
} {
  const input = context.toolInput;
  const command = extractFirstString(input, [
    "command",
    "cmd",
    "CommandLine",
    "commandLine",
    "script"
  ]);
  const filePath = extractFirstString(input, [
    "filePath",
    "file_path",
    "path",
    "targetFile",
    "TargetFile",
    "target",
    "destination",
    "dest"
  ]);
  const url = extractFirstString(input, ["url", "uri", "endpoint", "href"]);
  const fallbackSearch = extractFirstString(input, ["query", "pattern", "name"]);

  const rawTarget = command ?? filePath ?? url ?? fallbackSearch;
  return {
    ...(command !== undefined ? { command } : {}),
    ...(filePath !== undefined ? { filePath } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(rawTarget !== undefined ? { rawTarget } : {})
  };
}

function isSimpleReadOnlyShellCommand(command: string): boolean {
  if (/[><`]|\|\||&&|;|\$\(|\n/.test(command)) {
    return false;
  }
  if (command.includes("|")) {
    return false;
  }
  if (/\bgit\s+branch\b[^;|&]*\s-[dDmM]\b/i.test(command)) {
    return false;
  }
  return READ_ONLY_SHELL_SINGLE_PATTERN.test(command);
}

function createActionSignature(context: HookInvocationContext): string {
  const toolName = normalizeToolName(context.toolName ?? "unknown_tool");
  const serializedInput = stableStringify(context.toolInput ?? {});
  return `${toolName}:${serializedInput}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return `{${entries
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
    .join(",")}}`;
}

/**
 * Splits a shell-style command string into executable + args without spawning an intermediate shell,
 * preserving Windows backslashes inside paths while honoring single/double quoted segments.
 */
export function splitCommandLine(commandLine: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let hasToken = false;

  for (let i = 0; i < commandLine.length; i += 1) {
    const ch = commandLine[i];
    if (ch === undefined) {
      continue;
    }

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
      hasToken = true;
      continue;
    }

    if (inDouble) {
      if (ch === "\\" && commandLine[i + 1] === '"') {
        current += '"';
        i += 1;
        hasToken = true;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      } else {
        current += ch;
      }
      hasToken = true;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      hasToken = true;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      hasToken = true;
      continue;
    }

    if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }

    current += ch;
    hasToken = true;
  }

  if (inSingle || inDouble) {
    throw new Error("Command line contains an unterminated quote.");
  }

  if (hasToken) {
    tokens.push(current);
  }

  return tokens;
}

class HookExecutionFailure extends Error {
  readonly exitCode: number | null;
  readonly timedOut: boolean;

  constructor(
    message: string,
    options: { exitCode?: number | null; timedOut?: boolean } = {}
  ) {
    super(message);
    this.name = "HookExecutionFailure";
    this.exitCode = options.exitCode ?? null;
    this.timedOut = options.timedOut ?? false;
  }
}

async function runWithTimeout<T>(
  fn: () => Promise<T> | T,
  timeoutMs: number,
  hookId: string
): Promise<T> {
  const effectiveTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs >= 0
      ? timeoutMs
      : DEFAULT_HOOK_TIMEOUT_MS;

  let timer: NodeJS.Timeout | undefined;
  const executionPromise = Promise.resolve().then(() => fn());
  // Suppress unhandled rejection if timeout settles first and the handler rejects later.
  executionPromise.catch(() => {});

  const timeoutPromise = new Promise<never>((_, rejectTimeout) => {
    timer = setTimeout(() => {
      rejectTimeout(
        new HookExecutionFailure(
          `Hook ${hookId} timed out after ${effectiveTimeoutMs}ms`,
          { timedOut: true }
        )
      );
    }, effectiveTimeoutMs);
  });

  try {
    return await Promise.race([executionPromise, timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }
}

function appendChunkBounded(
  current: string,
  chunkText: string
): { next: string; truncated: boolean } {
  if (current.length >= MAX_HOOK_STDIO_BYTES) {
    return { next: current, truncated: true };
  }
  const remaining = MAX_HOOK_STDIO_BYTES - current.length;
  if (chunkText.length <= remaining) {
    return { next: current + chunkText, truncated: false };
  }
  return {
    next: current + chunkText.slice(0, remaining),
    truncated: true
  };
}

function cleanupChildStreams(child: ChildProcess): void {
  try {
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
  } catch {
    // Ignore stream cleanup failures.
  }
}

async function executeExternalCommandHook(
  config: CommandHookConfig,
  context: HookInvocationContext
): Promise<HookExecutionResult> {
  const rawCommand = config.command?.trim() ?? "";
  if (rawCommand.length === 0) {
    throw new HookExecutionFailure(
      `Command hook ${config.id} is missing a non-empty command.`
    );
  }

  let executable: string;
  let args: string[];
  const useShell = config.shell === true;

  if (config.args !== undefined) {
    executable = rawCommand;
    args = [...config.args];
  } else if (useShell) {
    executable = rawCommand;
    args = [];
  } else {
    const parsedTokens = splitCommandLine(rawCommand);
    const first = parsedTokens[0];
    if (first === undefined || first.length === 0) {
      throw new HookExecutionFailure(
        `Command hook ${config.id} resolved to an empty executable.`
      );
    }
    executable = first;
    args = parsedTokens.slice(1);
  }

  const effectiveTimeoutMs =
    Number.isFinite(config.timeoutMs) && config.timeoutMs >= 0
      ? config.timeoutMs
      : DEFAULT_HOOK_TIMEOUT_MS;

  const childEnv = sanitizeChildEnv({
    ...process.env,
    ...config.env
  });

  return new Promise<HookExecutionResult>((resolveResult, rejectResult) => {
    let settled = false;
    let timedOut = false;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let killFallbackTimer: NodeJS.Timeout | undefined;

    let stdoutBuffer = "";
    let stderrBuffer = "";
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");

    const clearTimers = () => {
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }
      if (killFallbackTimer !== undefined) {
        clearTimeout(killFallbackTimer);
        killFallbackTimer = undefined;
      }
    };

    const settleResolve = (value: HookExecutionResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      resolveResult(value);
    };

    const settleReject = (err: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      rejectResult(err);
    };

    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
        cwd: config.cwd,
        env: childEnv,
        shell: useShell,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (spawnErr) {
      const msg =
        spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      settleReject(
        new HookExecutionFailure(
          `Failed to spawn hook command (${config.id}): ${msg}`
        )
      );
      return;
    }

    const terminateProcess = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore if already terminated.
      }
      killFallbackTimer = setTimeout(() => {
        killFallbackTimer = undefined;
        try {
          child.kill("SIGKILL");
        } catch {
          // Ignore if already dead.
        }
        cleanupChildStreams(child);
        settleReject(
          new HookExecutionFailure(
            `Hook ${config.id} timed out after ${effectiveTimeoutMs}ms`,
            { timedOut: true }
          )
        );
      }, KILL_GRACE_MS);
      killFallbackTimer.unref();
    };

    timeoutTimer = setTimeout(() => {
      timeoutTimer = undefined;
      timedOut = true;
      terminateProcess();
    }, effectiveTimeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text =
        typeof chunk === "string" ? chunk : stdoutDecoder.write(chunk);
      stdoutBuffer = appendChunkBounded(stdoutBuffer, text).next;
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text =
        typeof chunk === "string" ? chunk : stderrDecoder.write(chunk);
      stderrBuffer = appendChunkBounded(stderrBuffer, text).next;
    });

    child.stdout?.on("error", () => {
      // Ignore stream errors during teardown.
    });

    child.stderr?.on("error", () => {
      // Ignore stream errors during teardown.
    });

    child.stdin?.on("error", () => {
      // Child may exit before reading full stdin payload (EPIPE).
    });

    child.once("error", (error: Error) => {
      cleanupChildStreams(child);
      settleReject(
        new HookExecutionFailure(
          `Hook command ${config.id} failed to start: ${error.message}`
        )
      );
    });

    child.once("close", (code, signal) => {
      stdoutBuffer += stdoutDecoder.end();
      stderrBuffer += stderrDecoder.end();
      cleanupChildStreams(child);

      if (timedOut) {
        settleReject(
          new HookExecutionFailure(
            `Hook ${config.id} timed out after ${effectiveTimeoutMs}ms`,
            { exitCode: code, timedOut: true }
          )
        );
        return;
      }

      const trimmedStderr = stderrBuffer.trim();
      const trimmedStdout = stdoutBuffer.trim();

      if (code === 2) {
        settleResolve({
          decision: "block",
          exitCode: 2,
          feedback:
            trimmedStderr.length > 0
              ? trimmedStderr
              : `Hook ${config.id} blocked execution with exit code 2.`
        });
        return;
      }

      if (code === 0) {
        if (trimmedStdout.length > 0) {
          try {
            const parsed = JSON.parse(trimmedStdout) as unknown;
            if (isRecord(parsed)) {
              const parsedFeedback =
                typeof parsed.feedback === "string"
                  ? parsed.feedback
                  : trimmedStderr.length > 0
                    ? trimmedStderr
                    : undefined;

              if (parsed.decision === "block") {
                settleResolve({
                  decision: "block",
                  exitCode:
                    typeof parsed.exitCode === "number" ? parsed.exitCode : 2,
                  ...(parsedFeedback !== undefined
                    ? { feedback: parsedFeedback }
                    : {})
                });
                return;
              }

              if (
                parsed.decision === "modify" &&
                isRecord(parsed.modifiedInput)
              ) {
                settleResolve({
                  decision: "modify",
                  exitCode: 0,
                  modifiedInput: parsed.modifiedInput,
                  ...(parsedFeedback !== undefined
                    ? { feedback: parsedFeedback }
                    : {})
                });
                return;
              }

              if (parsed.decision === "allow") {
                settleResolve({
                  decision: "allow",
                  exitCode: 0,
                  ...(parsedFeedback !== undefined
                    ? { feedback: parsedFeedback }
                    : {})
                });
                return;
              }
            }
          } catch {
            // Non-JSON stdout on exit code 0 defaults to allow.
          }
        }

        settleResolve({
          decision: "allow",
          exitCode: 0
        });
        return;
      }

      const reasonParts = [
        `Hook ${config.id} exited abnormally (code=${String(code)}, signal=${String(signal)})`
      ];
      if (trimmedStderr.length > 0) {
        reasonParts.push(`stderr=${trimmedStderr}`);
      }
      settleReject(
        new HookExecutionFailure(reasonParts.join("; "), { exitCode: code })
      );
    });

    try {
      if (child.stdin !== null && !child.stdin.destroyed) {
        child.stdin.end(`${JSON.stringify(context)}\n`);
      }
    } catch {
      // Handled via stdin error / close listeners.
    }
  });
}

/**
 * Deterministic lifecycle hook bus (SessionStart, PreToolUse, PostToolUse, Notification, SubagentStop, Stop).
 * Security-critical hooks force `onFailure: "block"` (fail-closed), exit code 2 feeds stderr back to the agent,
 * and PreToolUse integrates Chinese ApprovalGuide risk cards with 4-tier permission gating.
 */
export class LifecycleHookBus {
  private readonly handlers = new Map<
    LifecycleHookEvent,
    RegisteredHookEntry[]
  >();
  private readonly commandEntries = new WeakSet<RegisteredHookEntry>();
  private readonly approvalRecords = new Map<string, ApprovalDecisionRecord>();
  private readonly enforcePermissionGate: boolean;
  private permissionMode: PermissionMode;
  private approvalSeq = 0;

  constructor(options: LifecycleHookBusOptions = {}) {
    this.permissionMode = options.defaultPermissionMode ?? "supervised";
    this.enforcePermissionGate = options.enforcePermissionGate ?? true;
  }

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
  }

  getRegisteredHooks(
    event?: LifecycleHookEvent
  ): ReadonlyArray<RegisteredHookEntry> {
    if (event !== undefined) {
      return [...(this.handlers.get(event) ?? [])];
    }
    const all: RegisteredHookEntry[] = [];
    for (const entries of this.handlers.values()) {
      all.push(...entries);
    }
    return all;
  }

  clear(event?: LifecycleHookEvent): void {
    if (event !== undefined) {
      this.handlers.delete(event);
      return;
    }
    this.handlers.clear();
  }

  register(config: CommandHookConfig, handler?: HookHandlerFn): () => void {
    const hasCommand =
      typeof config.command === "string" && config.command.trim().length > 0;
    if (handler === undefined && !hasCommand) {
      throw new Error(
        `Hook ${config.id} must provide either a handler function or a non-empty command.`
      );
    }

    const resolvedConfig: CommandHookConfig = {
      ...config,
      onFailure: config.securityCritical
        ? "block"
        : (config.onFailure ?? DEFAULT_SECURITY_HOOK_FAILURE_POLICY)
    };

    const isBuiltInCommandHandler = handler === undefined && hasCommand;
    const resolvedHandler: HookHandlerFn =
      handler ??
      ((invocationContext) =>
        executeExternalCommandHook(resolvedConfig, invocationContext));

    const list = this.handlers.get(resolvedConfig.event) ?? [];
    const entry: RegisteredHookEntry = {
      config: resolvedConfig,
      handler: resolvedHandler
    };
    if (isBuiltInCommandHandler) {
      this.commandEntries.add(entry);
    }
    list.push(entry);
    this.handlers.set(resolvedConfig.event, list);

    return () => {
      const current = this.handlers.get(resolvedConfig.event);
      if (current === undefined) {
        return;
      }
      this.handlers.set(
        resolvedConfig.event,
        current.filter((item) => item !== entry)
      );
    };
  }

  registerCommandHook(
    config: CommandHookConfig & { command: string }
  ): () => void {
    if (config.command.trim().length === 0) {
      throw new Error(`Command hook ${config.id} cannot have an empty command.`);
    }
    return this.register(config);
  }

  translatePreToolApproval(context: HookInvocationContext): ApprovalGuideCard {
    return this.assessPreToolRisk(context).card;
  }

  getApprovalRecord(requestId: string): ApprovalDecisionRecord | undefined {
    const record = this.approvalRecords.get(requestId);
    return record === undefined ? undefined : { ...record };
  }

  listApprovalRecords(): ApprovalDecisionRecord[] {
    return Array.from(this.approvalRecords.values()).map((record) => ({
      ...record
    }));
  }

  recordApprovalDecision(
    requestId: string,
    allow: boolean,
    reason?: string
  ): ApprovalDecisionRecord {
    const record = this.approvalRecords.get(requestId);
    if (record === undefined) {
      throw new Error(`Approval request "${requestId}" does not exist.`);
    }

    const targetStatus = allow ? "approved" : "rejected";
    if (record.status !== "pending") {
      if (record.status === targetStatus) {
        return { ...record };
      }
      throw new Error(
        `Approval request "${requestId}" is already finalized with status "${record.status}".`
      );
    }

    record.status = targetStatus;
    record.decidedAt = Date.now();
    if (reason !== undefined && reason.trim().length > 0) {
      record.decisionReason = reason.trim();
    } else if (!allow) {
      record.decisionReason = "人工审批驳回该操作";
    } else {
      record.decisionReason = "人工审批已放行";
    }

    return { ...record };
  }

  evaluatePermission(context: HookInvocationInput): HookDispatchResult {
    const mode = context.permissionMode ?? this.permissionMode;
    const assessment = this.assessPreToolRisk({
      ...context,
      permissionMode: mode
    });
    const { card, category, touchesCredentials } = assessment;

    if (mode === "auto") {
      return {
        decision: "allow",
        exitCode: 0,
        approvalGuide: card,
        permissionEvaluated: true
      };
    }

    if (mode === "plan") {
      if (category === "readonly" && !touchesCredentials) {
        return {
          decision: "allow",
          exitCode: 0,
          approvalGuide: card,
          permissionEvaluated: true
        };
      }
      return {
        decision: "block",
        exitCode: 2,
        feedback: `当前处于只读规划模式（plan），已禁止变更类工具：${card.actionSummary}`,
        approvalGuide: card,
        permissionEvaluated: true
      };
    }

    if (mode === "acceptEdits") {
      if (
        (category === "readonly" || category === "edit") &&
        !touchesCredentials &&
        card.riskLevel !== "high"
      ) {
        return {
          decision: "allow",
          exitCode: 0,
          approvalGuide: card,
          permissionEvaluated: true
        };
      }

      return {
        decision: "block",
        exitCode: 2,
        feedback: `当前模式（acceptEdits）仅自动放行常规文件编辑，已拦截未授权操作：${card.triggerReason}`,
        approvalGuide: card,
        permissionEvaluated: true
      };
    }

    // `supervised` mode
    if (card.riskLevel === "low" && category === "readonly" && !touchesCredentials) {
      return {
        decision: "allow",
        exitCode: 0,
        approvalGuide: card,
        permissionEvaluated: true
      };
    }

    const actionSignature = createActionSignature(context);
    const matchingRecord = this.findMatchingApprovalRecord(
      context,
      actionSignature
    );

    if (matchingRecord !== undefined) {
      if (matchingRecord.status === "approved") {
        matchingRecord.status = "consumed";
        return {
          decision: "allow",
          exitCode: 0,
          feedback:
            matchingRecord.decisionReason ??
            `审批单 ${matchingRecord.requestId} 已批准放行`,
          approvalGuide: card,
          approvalRequestId: matchingRecord.requestId,
          permissionEvaluated: true
        };
      }

      if (matchingRecord.status === "rejected") {
        return {
          decision: "block",
          exitCode: 2,
          feedback: `审批已驳回（${matchingRecord.requestId}）：${matchingRecord.decisionReason ?? "拒绝执行"}`,
          approvalGuide: card,
          approvalRequired: false,
          approvalRequestId: matchingRecord.requestId,
          permissionEvaluated: true
        };
      }

      if (matchingRecord.status === "pending") {
        return {
          decision: "block",
          exitCode: 2,
          feedback: `操作仍等待人工审批（${matchingRecord.requestId}）：${card.actionSummary}`,
          approvalGuide: card,
          approvalRequired: true,
          approvalRequestId: matchingRecord.requestId,
          permissionEvaluated: true
        };
      }
    }

    const requestId = `apr-${Date.now()}-${++this.approvalSeq}-${randomUUID().slice(0, 6)}`;
    const pendingRecord: ApprovalDecisionRecord = {
      requestId,
      sessionId: context.sessionId,
      threadId: context.threadId,
      toolName: card.toolName,
      actionSignature,
      card,
      status: "pending",
      createdAt: Date.now()
    };
    this.approvalRecords.set(requestId, pendingRecord);

    const levelLabel = card.riskLevel === "high" ? "高危" : "中危";
    return {
      decision: "block",
      exitCode: 2,
      feedback: `监督模式（supervised）需要人工审批【${levelLabel}】：${card.actionSummary}（审批单号：${requestId}）`,
      approvalGuide: card,
      approvalRequired: true,
      approvalRequestId: requestId,
      permissionEvaluated: true
    };
  }

  async emit(context: HookInvocationInput): Promise<HookDispatchResult> {
    const resolvedPermissionMode = context.permissionMode ?? this.permissionMode;
    let workingContext: HookInvocationInput = {
      ...context,
      permissionMode: resolvedPermissionMode
    };

    let hasModification = false;
    let latestModifiedInput: Record<string, unknown> | undefined;
    let latestFeedback: string | undefined;
    const warnings: string[] = [];
    let appliedNonBlockingPolicy: HookFailurePolicy | undefined;

    const entries = [...(this.handlers.get(workingContext.event) ?? [])];
    for (const entry of entries) {
      const failurePolicy: HookFailurePolicy = entry.config.securityCritical
        ? "block"
        : entry.config.onFailure;

      try {
        // External command hooks enforce timeout + child cleanup inside executeExternalCommandHook;
        // function hooks are wrapped with runWithTimeout here with guaranteed clearTimeout.
        const result = this.commandEntries.has(entry)
          ? await entry.handler(workingContext)
          : await runWithTimeout(
              () => entry.handler(workingContext),
              entry.config.timeoutMs,
              entry.config.id
            );

        if (result === undefined) {
          continue;
        }

        if (result.exitCode === 2 || result.decision === "block") {
          return {
            ...result,
            decision: "block",
            exitCode: result.exitCode === 0 ? 2 : result.exitCode,
            approvalGuide:
              result.approvalGuide ??
              (workingContext.event === "PreToolUse"
                ? this.translatePreToolApproval(workingContext)
                : undefined),
            ...(entry.config.securityCritical || failurePolicy === "block"
              ? {
                  failurePolicyApplied:
                    result.failurePolicyApplied ??
                    (entry.config.securityCritical ? "block" : undefined)
                }
              : {}),
            ...(warnings.length > 0 ? { warnings } : {})
          };
        }

        if (
          result.decision === "modify" &&
          result.modifiedInput !== undefined
        ) {
          hasModification = true;
          latestModifiedInput = result.modifiedInput;
          workingContext = {
            ...workingContext,
            toolInput: result.modifiedInput
          };
        }

        if (typeof result.feedback === "string" && result.feedback.length > 0) {
          latestFeedback = result.feedback;
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        if (failurePolicy === "block") {
          return {
            decision: "block",
            exitCode: 2,
            feedback: `Hook ${entry.config.id} failed under fail-closed policy: ${message}`,
            failurePolicyApplied: "block",
            ...(workingContext.event === "PreToolUse"
              ? { approvalGuide: this.translatePreToolApproval(workingContext) }
              : {}),
            ...(warnings.length > 0 ? { warnings } : {})
          };
        }

        if (failurePolicy === "warn") {
          appliedNonBlockingPolicy = "warn";
          warnings.push(`Hook ${entry.config.id} warned on failure: ${message}`);
        } else {
          appliedNonBlockingPolicy = appliedNonBlockingPolicy ?? "ignore";
        }
      }
    }

    if (
      this.enforcePermissionGate &&
      workingContext.event === "PreToolUse"
    ) {
      const gateResult = this.evaluatePermission(workingContext);
      if (gateResult.decision === "block") {
        return {
          ...gateResult,
          ...(hasModification && latestModifiedInput !== undefined
            ? { modifiedInput: latestModifiedInput }
            : {}),
          ...(warnings.length > 0 ? { warnings } : {})
        };
      }

      if (hasModification && latestModifiedInput !== undefined) {
        return {
          decision: "modify",
          exitCode: 0,
          modifiedInput: latestModifiedInput,
          ...(gateResult.approvalGuide !== undefined
            ? { approvalGuide: gateResult.approvalGuide }
            : {}),
          ...(gateResult.approvalRequestId !== undefined
            ? { approvalRequestId: gateResult.approvalRequestId }
            : {}),
          ...(gateResult.feedback !== undefined
            ? { feedback: gateResult.feedback }
            : latestFeedback !== undefined
              ? { feedback: latestFeedback }
              : {}),
          ...(appliedNonBlockingPolicy !== undefined
            ? { failurePolicyApplied: appliedNonBlockingPolicy }
            : {}),
          ...(warnings.length > 0 ? { warnings } : {}),
          permissionEvaluated: true
        };
      }

      return {
        ...gateResult,
        ...(latestFeedback !== undefined && gateResult.feedback === undefined
          ? { feedback: latestFeedback }
          : {}),
        ...(appliedNonBlockingPolicy !== undefined
          ? { failurePolicyApplied: appliedNonBlockingPolicy }
          : {}),
        ...(warnings.length > 0 ? { warnings } : {})
      };
    }

    if (hasModification && latestModifiedInput !== undefined) {
      return {
        decision: "modify",
        exitCode: 0,
        modifiedInput: latestModifiedInput,
        ...(latestFeedback !== undefined ? { feedback: latestFeedback } : {}),
        ...(appliedNonBlockingPolicy !== undefined
          ? { failurePolicyApplied: appliedNonBlockingPolicy }
          : {}),
        ...(warnings.length > 0 ? { warnings } : {})
      };
    }

    return {
      decision: "allow",
      exitCode: 0,
      ...(latestFeedback !== undefined ? { feedback: latestFeedback } : {}),
      ...(appliedNonBlockingPolicy !== undefined
        ? { failurePolicyApplied: appliedNonBlockingPolicy }
        : {}),
      ...(warnings.length > 0 ? { warnings } : {})
    };
  }

  private findMatchingApprovalRecord(
    context: HookInvocationInput,
    actionSignature: string
  ): ApprovalDecisionRecord | undefined {
    if (context.approvalRequestId !== undefined) {
      const exact = this.approvalRecords.get(context.approvalRequestId);
      if (
        exact !== undefined &&
        exact.actionSignature === actionSignature &&
        exact.sessionId === context.sessionId &&
        exact.threadId === context.threadId
      ) {
        return exact;
      }
      return undefined;
    }

    const candidates = Array.from(this.approvalRecords.values()).reverse();
    for (const candidate of candidates) {
      if (
        candidate.sessionId === context.sessionId &&
        candidate.threadId === context.threadId &&
        candidate.actionSignature === actionSignature &&
        candidate.status === "approved"
      ) {
        return candidate;
      }
    }
    return undefined;
  }

  private assessPreToolRisk(context: HookInvocationContext): RiskAssessment {
    const rawToolName = context.toolName ?? "unknown_tool";
    const normalizedTool = normalizeToolName(rawToolName);
    const { command, filePath, url, rawTarget } = extractTargetSummary(context);
    const targetText = [command, filePath, url, rawTarget]
      .filter((item): item is string => item !== undefined)
      .join(" ");

    const touchesCredentials =
      targetText.length > 0 && CREDENTIAL_TARGET_PATTERN.test(targetText);
    const modeLabel = context.permissionMode ?? this.permissionMode;

    // 1. Shell-based command analysis (highest precedence for destructive commands)
    if (command !== undefined || SHELL_TOOL_NAMES.has(normalizedTool)) {
      const effectiveCommand = command ?? rawTarget ?? "";

      for (const rule of HIGH_RISK_SHELL_PATTERNS) {
        if (rule.pattern.test(effectiveCommand)) {
          return {
            category: "high_risk",
            touchesCredentials,
            card: {
              toolName: rawToolName,
              actionSummary: `${rule.summaryPrefix}：${effectiveCommand}`,
              riskLevel: "high",
              triggerReason: `${rule.reason}（事件：${context.event}，模式：${modeLabel}）`,
              ...(rawTarget !== undefined
                ? { rawCommandOrTarget: rawTarget }
                : {})
            }
          };
        }
      }

      if (
        touchesCredentials &&
        SHELL_MODIFY_CREDENTIAL_VERB_PATTERN.test(effectiveCommand)
      ) {
        return {
          category: "high_risk",
          touchesCredentials: true,
          card: {
            toolName: rawToolName,
            actionSummary: `准备通过命令行修改或删除敏感凭据/密钥文件：${effectiveCommand}`,
            riskLevel: "high",
            triggerReason: `命中高危规则：命令行操作涉及修改敏感凭据或密钥文件（.env/.ssh/credentials）（事件：${context.event}，模式：${modeLabel}）`,
            ...(rawTarget !== undefined
              ? { rawCommandOrTarget: rawTarget }
              : {})
          }
        };
      }

      if (effectiveCommand.length > 0 && isSimpleReadOnlyShellCommand(effectiveCommand)) {
        const readRiskLevel: RiskLevel = touchesCredentials ? "medium" : "low";
        return {
          category: "readonly",
          touchesCredentials,
          card: {
            toolName: rawToolName,
            actionSummary: `准备执行只读信息查询命令：${effectiveCommand}`,
            riskLevel: readRiskLevel,
            triggerReason: touchesCredentials
              ? `命中中危规则：只读查询涉及敏感凭据文件，需注意内容脱敏（事件：${context.event}，模式：${modeLabel}）`
              : `命中低危规则：属于只读查看或检索命令（git status/diff/ls/grep 等），无写入副作用（事件：${context.event}，模式：${modeLabel}）`,
            ...(rawTarget !== undefined
              ? { rawCommandOrTarget: rawTarget }
              : {})
          }
        };
      }

      // Medium-risk shell commands (git commit/checkout, builds, general scripts)
      const isGitStateChange = /\bgit\s+(?:commit|checkout|switch|merge|rebase|cherry-pick|stash|add|push)\b/i.test(
        effectiveCommand
      );
      const isOutboundCommand = /\b(?:curl|wget|fetch|http|npm\s+publish)\b/i.test(
        effectiveCommand
      );
      const actionSummary = isGitStateChange
        ? `准备执行 Git 变更命令：${effectiveCommand}`
        : isOutboundCommand
          ? `准备执行网络请求相关命令：${effectiveCommand}`
          : `准备执行终端命令：${effectiveCommand || rawToolName}`;
      const triggerReason = isGitStateChange
        ? `命中中危规则：Git 状态变更命令（commit/checkout 等）会修改仓库工作区或历史（事件：${context.event}，模式：${modeLabel}）`
        : isOutboundCommand
          ? `命中中危规则：命令行包含外网传输指令，存在数据出站风险（事件：${context.event}，模式：${modeLabel}）`
          : `命中中危规则：常规 Shell 命令执行可能修改工作区状态（事件：${context.event}，模式：${modeLabel}）`;

      return {
        category: "shell",
        touchesCredentials,
        card: {
          toolName: rawToolName,
          actionSummary,
          riskLevel: "medium",
          triggerReason,
          ...(rawTarget !== undefined
            ? { rawCommandOrTarget: rawTarget }
            : {})
        }
      };
    }

    // 2. Delete operations
    if (
      DELETE_TOOL_NAMES.has(normalizedTool) ||
      normalizedTool.startsWith("delete_") ||
      normalizedTool.startsWith("remove_")
    ) {
      const targetDesc = filePath ?? rawTarget ?? "目标文件";
      return {
        category: touchesCredentials ? "high_risk" : "delete",
        touchesCredentials,
        card: {
          toolName: rawToolName,
          actionSummary: touchesCredentials
            ? `准备删除敏感凭据/密钥文件：${targetDesc}`
            : `准备删除文件或目录：${targetDesc}`,
          riskLevel: touchesCredentials ? "high" : "medium",
          triggerReason: touchesCredentials
            ? `命中高危规则：删除敏感凭据或密钥文件（.env/.ssh/credentials）将造成严重服务中断或丢失（事件：${context.event}，模式：${modeLabel}）`
            : `命中中危规则：常规文件或目录删除操作不可直接撤回（事件：${context.event}，模式：${modeLabel}）`,
          ...(rawTarget !== undefined
            ? { rawCommandOrTarget: rawTarget }
            : {})
        }
      };
    }

    // 3. File write / edit / patch operations
    if (
      EDIT_TOOL_NAMES.has(normalizedTool) ||
      normalizedTool.startsWith("write_") ||
      normalizedTool.startsWith("edit_") ||
      normalizedTool.startsWith("create_") ||
      normalizedTool.startsWith("patch_") ||
      normalizedTool.startsWith("update_")
    ) {
      const targetDesc = filePath ?? rawTarget ?? "目标文件";
      if (touchesCredentials) {
        return {
          category: "high_risk",
          touchesCredentials: true,
          card: {
            toolName: rawToolName,
            actionSummary: `准备修改敏感凭据/密钥文件：${targetDesc}`,
            riskLevel: "high",
            triggerReason: `命中高危规则：修改或覆盖凭据密钥文件（.env/.ssh/credentials）属于高敏感操作（事件：${context.event}，模式：${modeLabel}）`,
            ...(rawTarget !== undefined
              ? { rawCommandOrTarget: rawTarget }
              : {})
          }
        };
      }

      return {
        category: "edit",
        touchesCredentials: false,
        card: {
          toolName: rawToolName,
          actionSummary: `准备写入或编辑文件：${targetDesc}`,
          riskLevel: "medium",
          triggerReason: `命中中危规则：常规文件写入、编辑或覆盖会改动工作区源码或配置（事件：${context.event}，模式：${modeLabel}）`,
          ...(rawTarget !== undefined
            ? { rawCommandOrTarget: rawTarget }
            : {})
        }
      };
    }

    // 4. Outbound network / fetch operations
    if (
      NETWORK_TOOL_NAMES.has(normalizedTool) ||
      normalizedTool.includes("fetch") ||
      normalizedTool.includes("http") ||
      url !== undefined
    ) {
      const targetDesc = url ?? rawTarget ?? "外部接口";
      return {
        category: "network",
        touchesCredentials,
        card: {
          toolName: rawToolName,
          actionSummary: `准备发起出站 HTTP/网络请求：${targetDesc}`,
          riskLevel: "medium",
          triggerReason: `命中中危规则：出站 HTTP/fetch 请求可能向外部发送上下文数据或触发外部副作用（事件：${context.event}，模式：${modeLabel}）`,
          ...(rawTarget !== undefined
            ? { rawCommandOrTarget: rawTarget }
            : {})
        }
      };
    }

    // 5. Read-only file view, listing, search, git inspection
    if (
      READ_ONLY_TOOL_NAMES.has(normalizedTool) ||
      normalizedTool.startsWith("read_") ||
      normalizedTool.startsWith("view_") ||
      normalizedTool.startsWith("list_") ||
      normalizedTool.startsWith("get_") ||
      normalizedTool.startsWith("search_") ||
      normalizedTool.startsWith("find_") ||
      normalizedTool.startsWith("grep_")
    ) {
      const targetDesc = filePath ?? rawTarget ?? rawToolName;
      return {
        category: "readonly",
        touchesCredentials,
        card: {
          toolName: rawToolName,
          actionSummary: `准备只读查看或检索：${targetDesc}`,
          riskLevel: touchesCredentials ? "medium" : "low",
          triggerReason: touchesCredentials
            ? `命中中危规则：读取敏感凭据路径（.env/.ssh/credentials）需防止凭据外泄（事件：${context.event}，模式：${modeLabel}）`
            : `命中低危规则：只读文件查看、目录列表或代码检索无副作用（事件：${context.event}，模式：${modeLabel}）`,
          ...(rawTarget !== undefined
            ? { rawCommandOrTarget: rawTarget }
            : {})
        }
      };
    }

    // 6. Unknown tools default conservatively to medium risk.
    return {
      category: "shell",
      touchesCredentials,
      card: {
        toolName: rawToolName,
        actionSummary: `准备调用工具 ${rawToolName}${rawTarget !== undefined ? `（${rawTarget}）` : ""}`,
        riskLevel: touchesCredentials ? "high" : "medium",
        triggerReason: touchesCredentials
          ? `命中高危规则：工具操作涉及敏感凭据或密钥路径（事件：${context.event}，模式：${modeLabel}）`
          : `命中中危规则：未分类工具调用默认按潜在状态变更操作评估（事件：${context.event}，模式：${modeLabel}）`,
        ...(rawTarget !== undefined ? { rawCommandOrTarget: rawTarget } : {})
      }
    };
  }
}
