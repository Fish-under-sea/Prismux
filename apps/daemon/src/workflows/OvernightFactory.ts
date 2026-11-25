import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";
import tls from "node:tls";
import {
  DocumentCollector,
  ForwardIdentityGuard,
  type CollectorChunk,
  type MemoryStore
} from "@prismux/memory-core";
import {
  BRAND,
  type DispatchCallerKind,
  type DispatchReasoningEffort,
  type DispatchTaskArtifact,
  type IslandHookEvent,
  type MemoryNamespace,
  type MemoryQueryHit,
  type PrismuxDispatchEnvelope
} from "@prismux/protocol";
import { ArtifactResultBackdoor } from "../dispatch/ArtifactResultBackdoor.js";
import type { DesktopIpcDispatchHub } from "../dispatch/DesktopIpcDispatchHub.js";
import {
  TaskDispatchRouter,
  detectExplicitAntigravityPrompt
} from "../dispatch/TaskDispatchRouter.js";
import {
  AntigravityGuardDeniedError,
  AntigravityPolicyGuard
} from "../security/AntigravityPolicyGuard.js";
import {
  HandoffEngine,
  isToolAllowedInDialMode,
  type HandoffExecutionResult,
  type HandoffTranscriptMessage
} from "../handoff/HandoffEngine.js";
import {
  LifecycleHookBus,
  splitCommandLine,
  type HookDispatchResult
} from "../hooks/LifecycleHookBus.js";
import {
  WorktreeSandbox,
  type SandboxIsolationSpec,
  type WorktreeSandboxPolicy
} from "../sandbox/WorktreeSandbox.js";
import { sanitizeChildEnv } from "../core/CoreServerSupervisor.js";

export const OVERNIGHT_FACTORY_MILESTONE = "M5" as const;

export type FactoryInboundMode = "gmail-oauth2" | "imap";

export type FactoryStage =
  | "stage_a_handoff"
  | "stage_b_worktree_code"
  | "stage_c_oracle_review"
  | "stage_d_morning_report";

export const FACTORY_STAGES: readonly FactoryStage[] = [
  "stage_a_handoff",
  "stage_b_worktree_code",
  "stage_c_oracle_review",
  "stage_d_morning_report"
] as const;

export interface FactoryInboundConfig {
  mode: FactoryInboundMode;
  matchAliasOrTag: string;
  pollIntervalMs: number;
}

export interface InboundEmailMessage {
  messageId: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  textBody?: string;
  htmlBody?: string;
  rawRfc822?: string;
  labels?: string[];
  receivedAt?: number;
  historyId?: string;
  uid?: number;
}

export interface MailInboundPollResult {
  messages: InboundEmailMessage[];
  nextCursor?: string;
}

export interface MailInboundAdapter {
  readonly mode: FactoryInboundMode;
  pollIncremental(cursor?: string): Promise<MailInboundPollResult>;
  startIdle?(
    onMessage: (message: InboundEmailMessage) => Promise<void> | void
  ): Promise<() => Promise<void> | void>;
  acknowledgeProcessed?(messageId: string): Promise<void>;
}

export interface OutboundMailPayload {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
  inReplyTo?: string;
  references?: string[];
  threadId?: string;
}

export interface OutboundMailReceipt {
  messageId: string;
  acceptedAt: number;
  provider: string;
}

export interface OutboundMailer {
  send(payload: OutboundMailPayload): Promise<OutboundMailReceipt>;
}

export interface MorningReportTokenStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  model?: string;
  provider?: string;
}

export interface FactoryChangedFileStat {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
}

export interface FactoryCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  combinedOutput: string;
}

export type OvernightSecretaryBrain = "gemini-api" | "codex" | "claude-code";

export interface FactoryMorningReport {
  jobId: string;
  threadId: string;
  branchName: string;
  summary: string;
  changedFilesCount: number;
  reviewComments: string[];
  deepLink: string;
  emailSubject?: string;
  repoName?: string;
  commitSha?: string;
  changedFiles?: FactoryChangedFileStat[];
  diff?: string;
  testCommand?: string;
  testOutput?: string;
  testPassed?: boolean;
  tokenStats?: MorningReportTokenStats;
  artifact?: DispatchTaskArtifact;
  oracleReviewSkipped?: boolean;
  completedAt?: number;
  durationMs?: number;
}

export interface FactoryRepoTarget {
  repoPath: string;
  repoSlug?: string;
  workspaceNamespace?: MemoryNamespace;
  testCommand: string;
  baseBranch?: string;
}

export interface CodingAgentExecutionContext {
  jobId: string;
  threadId: string;
  attempt: number;
  maxAttempts: number;
  worktreePath: string;
  branchName: string;
  handoff: HandoffExecutionResult;
  memoryHits: MemoryQueryHit[];
  email: InboundEmailMessage;
  cleanedEmailText: string;
  testCommand: string;
  lastTestFailure?: string;
  sandbox: WorktreeSandbox;
  sandboxPolicy: WorktreeSandboxPolicy;
  isolationSpec: SandboxIsolationSpec;
  hookBus: LifecycleHookBus;
  tools: {
    readFile: (filePath: string) => Promise<string>;
    writeFile: (filePath: string, content: string) => Promise<string>;
    assertWriteAllowed: (filePath: string) => void;
    isWriteAllowed: (filePath: string) => boolean;
    runCommand: (command: string) => Promise<FactoryCommandResult>;
  };
}

export interface CodingAgentExecutionResult {
  summary?: string;
  modifiedFiles?: string[];
  notes?: string;
  tokenStats?: Partial<MorningReportTokenStats>;
}

export type CodingAgentExecutor = (
  context: CodingAgentExecutionContext
) => Promise<CodingAgentExecutionResult | void>;

export interface OracleReviewContext {
  jobId: string;
  reviewThreadId: string;
  codingThreadId: string;
  branchName: string;
  worktreePath: string;
  diff: string;
  changedFiles: FactoryChangedFileStat[];
  testCommand: string;
  testOutput: string;
  testPassed: boolean;
  handoff: HandoffExecutionResult;
  heuristicFindings: string[];
  assertReadOnlyTool: (toolName: string) => void;
}

export interface OracleReviewResult {
  comments: string[];
  tokenStats?: Partial<MorningReportTokenStats>;
}

export type OracleReviewer = (
  context: OracleReviewContext
) => Promise<string[] | OracleReviewResult>;

export interface FactoryPluginNotification {
  jobId: string;
  threadId: string;
  branchName: string;
  title: string;
  summary: string;
  changedFilesCount: number;
  testPassed: boolean;
  reviewComments: string[];
  deepLink: string;
  estimatedCostUsd: number;
  totalTokens: number;
  islandCard: IslandHookEvent;
  shortMessage: string;
}

export interface OvernightFactoryOptions extends Partial<FactoryInboundConfig> {
  memoryStore?: MemoryStore;
  handoffEngine?: HandoffEngine;
  hookBus?: LifecycleHookBus;
  sandbox?: WorktreeSandbox;
  policyGuard?: AntigravityPolicyGuard;
  dispatchRouter?: TaskDispatchRouter;
  artifactBackdoor?: ArtifactResultBackdoor;
  dispatchHub?: DesktopIpcDispatchHub;
  callerKind?: DispatchCallerKind;
  agentProvider?: string;
  agentModel?: string;
  reasoningEffort?: DispatchReasoningEffort;
  secretaryBrain?: OvernightSecretaryBrain;
  enableOracleReview?: boolean;
  outboundMailer?: OutboundMailer;
  codingExecutor?: CodingAgentExecutor;
  oracleReviewer?: OracleReviewer;
  onNotifyPlugins?: (
    notification: FactoryPluginNotification
  ) => Promise<void> | void;
  repos?: Record<string, FactoryRepoTarget>;
  defaultRepoTarget?: FactoryRepoTarget;
  worktreeBaseDir?: string;
  writableTempDirs?: string[];
  egressEnabled?: boolean;
  allowedDomains?: string[];
  maxSelfHealAttempts?: number;
  cleanupWorktree?: boolean;
  testTimeoutMs?: number;
  machineId?: string;
  now?: () => number;
}

export interface FactoryRunOptions {
  repoTarget?: FactoryRepoTarget;
  worktreePath?: string;
  writableTempDirs?: string[];
  egressEnabled?: boolean;
  allowedDomains?: string[];
  maxSelfHealAttempts?: number;
  cleanupWorktree?: boolean;
  testTimeoutMs?: number;
  callerKind?: DispatchCallerKind;
  agentProvider?: string;
  agentModel?: string;
  reasoningEffort?: DispatchReasoningEffort;
  secretaryBrain?: OvernightSecretaryBrain;
  enableOracleReview?: boolean;
  codingExecutor?: CodingAgentExecutor;
  oracleReviewer?: OracleReviewer;
  outboundMailer?: OutboundMailer;
  onNotifyPlugins?: (
    notification: FactoryPluginNotification
  ) => Promise<void> | void;
  reportRecipient?: string;
  ignoreTriggerCheck?: boolean;
}

export interface FactoryPipelineResult {
  status:
    | "completed"
    | "awaiting_human_confirmation"
    | "skipped_unmatched"
    | "skipped_duplicate";
  jobId: string;
  messageId: string;
  threadId: string;
  codingThreadId?: string;
  reviewThreadId?: string;
  branchName?: string;
  baseBranch?: string;
  baseCommitSha?: string;
  commitSha?: string;
  worktreePath?: string;
  worktreeCleaned: boolean;
  cleanedEmailText?: string;
  memoryContext: MemoryQueryHit[];
  handoff?: HandoffExecutionResult;
  diff?: string;
  changedFiles: FactoryChangedFileStat[];
  testCommand?: string;
  testOutput?: string;
  testPassed?: boolean;
  selfHealAttempts?: number;
  reviewComments: string[];
  stopHookResult?: HookDispatchResult;
  tokenStats?: MorningReportTokenStats;
  report?: FactoryMorningReport;
  reportHtml?: string;
  mailReceipt?: OutboundMailReceipt;
  notification?: FactoryPluginNotification;
  deepLink?: string;
  requiresHumanConfirmation?: boolean;
  dispatchEnvelope?: PrismuxDispatchEnvelope;
  artifact?: DispatchTaskArtifact;
  oracleReviewSkipped?: boolean;
  routedProvider?: string;
  routedModelId?: string;
  routedReasoningEffort?: DispatchReasoningEffort;
  secretaryBrain?: OvernightSecretaryBrain;
}

export function buildReviewDeepLink(threadId: string): string {
  return `${BRAND.uriScheme}://review/${encodeURIComponent(threadId)}`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeDeepLinkUrl(rawUrl: string, fallbackThreadId: string): string {
  const trimmed = rawUrl.trim();
  const expectedPrefix = `${BRAND.uriScheme}://`;
  if (trimmed.toLowerCase().startsWith(expectedPrefix.toLowerCase())) {
    return trimmed;
  }
  return buildReviewDeepLink(fallbackThreadId);
}

function normalizeMessageId(rawId: string): string {
  return rawId.trim().replace(/^<|>$/g, "").toLowerCase();
}

function normalizeAddressList(raw: string | readonly string[] | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return raw.map((item) => item.trim()).filter((item) => item.length > 0);
}

function extractEmailAddressOnly(raw: string): string {
  const angleMatch = /<([^<>]+)>/.exec(raw);
  return (angleMatch?.[1] ?? raw).trim();
}

function hasPlusAliasInRecipient(recipient: string, aliasToken: string): boolean {
  const address = extractEmailAddressOnly(recipient).toLowerCase();
  const atIndex = address.indexOf("@");
  const localPart = atIndex >= 0 ? address.slice(0, atIndex) : address;
  const normalizedAlias = aliasToken.startsWith("+")
    ? aliasToken
    : `+${aliasToken}`;
  const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}(?=$|[+.])`, "i");
  return regex.test(localPart);
}

/**
 * Checks whether an inbound email matches the Overnight Factory triggers:
 * - Recipient (`to` / `cc`) contains `+factory` plus-addressing alias
 * - Subject or labels contain `#factory` or `[Idea]` (case-insensitive)
 * - Or matches an explicit custom `matchAliasOrTag`
 */
export function matchesFactoryTrigger(
  email: InboundEmailMessage,
  matchAliasOrTag?: string
): boolean {
  const recipients = [
    ...normalizeAddressList(email.to),
    ...normalizeAddressList(email.cc)
  ];
  const labels = (email.labels ?? []).map((label) => label.trim());
  const subject = email.subject ?? "";

  if (recipients.some((addr) => hasPlusAliasInRecipient(addr, "+factory"))) {
    return true;
  }

  const tagPattern = /#factory(?=$|[^a-z0-9_-])|\[idea\]/i;
  if (tagPattern.test(subject)) {
    return true;
  }

  if (
    labels.some((label) => {
      const lower = label.toLowerCase();
      return (
        lower === "factory" ||
        lower === "#factory" ||
        lower === "idea" ||
        lower === "[idea]" ||
        tagPattern.test(label)
      );
    })
  ) {
    return true;
  }

  const custom = matchAliasOrTag?.trim();
  if (custom !== undefined && custom.length > 0) {
    const customLower = custom.toLowerCase();
    if (customLower.startsWith("+")) {
      if (recipients.some((addr) => hasPlusAliasInRecipient(addr, customLower))) {
        return true;
      }
    } else {
      if (subject.toLowerCase().includes(customLower)) {
        return true;
      }
      if (labels.some((label) => label.toLowerCase().includes(customLower))) {
        return true;
      }
      if (recipients.some((addr) => addr.toLowerCase().includes(customLower))) {
        return true;
      }
    }
  }

  return false;
}

function sanitizeSlugComponent(raw: string, maxLength = 36): string {
  const ascii = raw
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/#[a-z0-9_-]+/gi, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  let trimmed = ascii.slice(0, maxLength).replace(/-+$/g, "");
  if (trimmed.endsWith(".lock")) {
    trimmed = trimmed.slice(0, -5).replace(/-+$/g, "");
  }
  return trimmed;
}

export function buildFactoryBranchName(
  subject: string,
  timestampMs: number = Date.now()
): string {
  const date = new Date(timestampMs);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const mmdd = `${mm}${dd}`;

  const cleanedSlug = sanitizeSlugComponent(subject, 36);
  const shortHash = createHash("sha256")
    .update(subject || String(timestampMs))
    .digest("hex")
    .slice(0, 8);
  const slug = cleanedSlug.length >= 2 ? cleanedSlug : `idea-${shortHash}`;
  return `factory/${mmdd}-${slug}`;
}

function extractSearchKeywords(
  subject: string,
  body: string,
  repoSlug: string
): string {
  const stopWords = new Set<string>([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "have",
    "will",
    "please",
    "idea",
    "factory",
    "subject",
    "fix",
    "add"
  ]);

  const rawText = `${repoSlug} ${subject} ${body}`
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/#[a-z0-9_-]+/gi, " ");

  const tokens = rawText
    .split(/[^a-zA-Z0-9_\u4e00-\u9fff-]+/)
    .map((t) => t.trim())
    .filter((t) => [...t].length >= 3)
    .filter((t) => !stopWords.has(t.toLowerCase()));

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(token);
    if (unique.length >= 8) {
      break;
    }
  }

  if (unique.length === 0) {
    return `${repoSlug} architecture`.trim();
  }
  return unique.join(" ");
}

function extractDirective(text: string, key: string): string | undefined {
  const regex = new RegExp(`^(?:[-*]\\s*)?${key}\\s*[:：]\\s*(.+)$`, "im");
  const match = regex.exec(text);
  return match?.[1]?.trim();
}

function extractSummarySentence(
  explicitSummary: string | undefined,
  handoff: HandoffExecutionResult,
  changedFiles: ReadonlyArray<FactoryChangedFileStat>,
  testPassed: boolean
): string {
  if (explicitSummary !== undefined && explicitSummary.trim().length > 0) {
    return explicitSummary.trim();
  }
  const fileCount = changedFiles.length;
  const totalAdd = changedFiles.reduce((acc, f) => acc + f.additions, 0);
  const totalDel = changedFiles.reduce((acc, f) => acc + f.deletions, 0);
  const statusTag = testPassed ? "单测全绿通过" : "单测未通过";
  return `${handoff.summary.goal}（共变更 ${fileCount} 个文件，+${totalAdd}/-${totalDel} 行，${statusTag}）`;
}

/**
 * Built-in static risk analyzer for Stage C read-only Oracle review.
 * Inspects added diff lines for potential unhandled errors, hardcoded secrets,
 * debug statements, dangerous execution primitives, and test coverage gaps.
 */
export function analyzeDiffStaticRisks(
  diff: string,
  changedFiles: ReadonlyArray<FactoryChangedFileStat>,
  testPassed: boolean
): string[] {
  const findings: string[] = [];
  const lines = diff.split(/\r?\n/);

  let currentFile = "";
  let hasCredentialRisk = false;
  let hasEmptyCatch = false;
  let hasDebugStatement = false;
  let hasDangerousPrimitive = false;
  let hasNullAssertionOrAny = false;

  for (const rawLine of lines) {
    if (rawLine.startsWith("+++ b/")) {
      currentFile = rawLine.slice(6).trim();
      continue;
    }
    if (!rawLine.startsWith("+") || rawLine.startsWith("+++")) {
      continue;
    }
    const added = rawLine.slice(1);

    if (
      !hasCredentialRisk &&
      /(?:api[_-]?key|secret|password|token|private[_-]?key)\s*[:=]\s*["'`][^"'`\s]{8,}["'`]|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[a-zA-Z0-9]{16,}|ghp_[a-zA-Z0-9]{20,}/i.test(
        added
      )
    ) {
      hasCredentialRisk = true;
      findings.push(
        `[Security] 疑似在 ${currentFile || "变更代码"} 中包含硬编码凭据或敏感密钥字面量，请确认并改用加密存储/环境变量。`
      );
    }

    if (
      !hasEmptyCatch &&
      (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(added) ||
        /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(added))
    ) {
      hasEmptyCatch = true;
      findings.push(
        `[Reliability] 在 ${currentFile || "变更代码"} 发现空 catch 吞没异常块，建议记录错误上下文或显式向上传递。`
      );
    }

    if (
      !hasDebugStatement &&
      /\b(?:console\.log|console\.debug|debugger)\b|\/\/\s*(?:TODO|FIXME|XXX)\b/i.test(
        added
      ) &&
      !/(?:^|\/)__tests__\/|\.test\.[cm]?[jt]sx?$/i.test(currentFile)
    ) {
      hasDebugStatement = true;
      findings.push(
        `[Hygiene] 在 ${currentFile || "变更代码"} 检测到调试语句或未清理的 TODO/FIXME 标记。`
      );
    }

    if (
      !hasDangerousPrimitive &&
      /\b(?:eval|Function)\s*\(|shell\s*:\s*true|innerHTML\s*=/.test(added)
    ) {
      hasDangerousPrimitive = true;
      findings.push(
        `[Security] 在 ${currentFile || "变更代码"} 使用了潜在注入风险原语（eval / shell:true / innerHTML），请复核输入边界。`
      );
    }

    if (
      !hasNullAssertionOrAny &&
      /:\s*any\b|\bas\s+any\b/.test(added)
    ) {
      hasNullAssertionOrAny = true;
      findings.push(
        `[Typing] 在 ${currentFile || "变更代码"} 引入了 \`any\` 宽松类型，建议收敛为显式接口或联合类型。`
      );
    }
  }

  const touchedSource = changedFiles.some(
    (f) =>
      /\.[cm]?[jt]sx?$/i.test(f.path) &&
      !/(?:^|\/)(?:__tests__|tests)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(
        f.path
      )
  );
  const touchedTest = changedFiles.some((f) =>
    /(?:^|\/)(?:__tests__|tests)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(f.path)
  );

  if (touchedSource && !touchedTest) {
    findings.push(
      "[Coverage] 本次源码改动未附带测试文件变更，建议核对回归测试与边界用例是否充分。"
    );
  }

  if (!testPassed) {
    findings.push(
      "[Tests] 验收测试尚未全部通过，合并前需人工排查失败用例。"
    );
  }

  if (findings.length === 0) {
    findings.push(
      "[Review OK] 只读 Diff 静态审计未发现硬编码凭据、空异常吞没或遗留调试语句；测试全部通过，可审阅合并。"
    );
  }

  return findings;
}

function decodeBase64Url(input: string): string {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(`${normalized}${"=".repeat(padLen)}`, "base64").toString(
    "utf8"
  );
}

function stripQuotedPrintableOrBase64(
  body: string,
  transferEncoding: string | undefined
): string {
  const enc = (transferEncoding ?? "").trim().toLowerCase();
  if (enc === "base64") {
    try {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      return body;
    }
  }
  if (enc === "quoted-printable") {
    const unfolded = body.replace(/=\r?\n/g, "");
    return unfolded.replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    );
  }
  return body;
}

/**
 * Parses a raw RFC 822 / MIME email string into a structured `InboundEmailMessage`.
 */
export function parseRawRfc822Email(
  raw: string,
  metadata?: {
    uid?: number;
    labels?: string[];
    historyId?: string;
  }
): InboundEmailMessage {
  const normalized = raw.replace(/\r\n?/g, "\n");
  const separatorIdx = normalized.indexOf("\n\n");
  const headerBlock =
    separatorIdx >= 0 ? normalized.slice(0, separatorIdx) : normalized;
  const rawBody = separatorIdx >= 0 ? normalized.slice(separatorIdx + 2) : "";

  const unfoldedLines: string[] = [];
  for (const line of headerBlock.split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfoldedLines.length > 0) {
      const idx = unfoldedLines.length - 1;
      unfoldedLines[idx] = `${unfoldedLines[idx]} ${line.trim()}`;
    } else {
      unfoldedLines.push(line);
    }
  }

  const headers = new Map<string, string>();
  for (const line of unfoldedLines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) {
      continue;
    }
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();
    if (!headers.has(key)) {
      headers.set(key, val);
    } else {
      headers.set(key, `${headers.get(key)}, ${val}`);
    }
  }

  const contentType = headers.get("content-type") ?? "";
  const decodedBody = stripQuotedPrintableOrBase64(
    rawBody,
    headers.get("content-transfer-encoding")
  );
  const isHtml = /text\/html/i.test(contentType);

  const dateHeader = headers.get("date");
  const parsedDate =
    dateHeader !== undefined ? Date.parse(dateHeader) : Number.NaN;

  const messageId =
    headers.get("message-id") ??
    `raw-${createHash("sha256").update(raw).digest("hex").slice(0, 12)}`;

  return {
    messageId,
    from: headers.get("from") ?? "",
    to: normalizeAddressList(headers.get("to")),
    cc: normalizeAddressList(headers.get("cc")),
    subject: headers.get("subject") ?? "",
    ...(isHtml ? { htmlBody: decodedBody } : { textBody: decodedBody }),
    rawRfc822: raw,
    ...(metadata?.labels !== undefined ? { labels: [...metadata.labels] } : {}),
    receivedAt: Number.isFinite(parsedDate) ? parsedDate : Date.now(),
    ...(metadata?.historyId !== undefined
      ? { historyId: metadata.historyId }
      : {}),
    ...(metadata?.uid !== undefined ? { uid: metadata.uid } : {})
  };
}

interface GmailMessagePayloadPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePayloadPart[];
}

interface GmailApiMessage {
  id?: string;
  historyId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailMessagePayloadPart & {
    headers?: Array<{ name?: string; value?: string }>;
  };
}

function extractGmailParts(
  part: GmailMessagePayloadPart | undefined,
  collector: { text?: string; html?: string }
): void {
  if (part === undefined) {
    return;
  }
  const mime = (part.mimeType ?? "").toLowerCase();
  if (part.body?.data !== undefined) {
    const decoded = decodeBase64Url(part.body.data);
    if (mime === "text/plain" && collector.text === undefined) {
      collector.text = decoded;
    } else if (mime === "text/html" && collector.html === undefined) {
      collector.html = decoded;
    } else if (collector.text === undefined && !mime.startsWith("multipart/")) {
      collector.text = decoded;
    }
  }
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      extractGmailParts(child, collector);
    }
  }
}

function convertGmailApiMessage(msg: GmailApiMessage): InboundEmailMessage {
  const headerMap = new Map<string, string>();
  for (const h of msg.payload?.headers ?? []) {
    if (typeof h.name === "string" && typeof h.value === "string") {
      headerMap.set(h.name.toLowerCase(), h.value);
    }
  }

  const bodies: { text?: string; html?: string } = {};
  extractGmailParts(msg.payload, bodies);

  const internalDateMs =
    msg.internalDate !== undefined ? Number(msg.internalDate) : Number.NaN;

  return {
    messageId: headerMap.get("message-id") ?? msg.id ?? randomUUID(),
    from: headerMap.get("from") ?? "",
    to: normalizeAddressList(headerMap.get("to")),
    cc: normalizeAddressList(headerMap.get("cc")),
    subject: headerMap.get("subject") ?? "",
    ...(bodies.text !== undefined ? { textBody: bodies.text } : {}),
    ...(bodies.html !== undefined ? { htmlBody: bodies.html } : {}),
    ...(msg.labelIds !== undefined ? { labels: [...msg.labelIds] } : {}),
    receivedAt: Number.isFinite(internalDateMs) ? internalDateMs : Date.now(),
    ...(msg.historyId !== undefined ? { historyId: msg.historyId } : {})
  };
}

export interface GmailOAuth2Config {
  userEmail: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  initialHistoryId?: string;
  apiBaseUrl?: string;
  tokenUrl?: string;
  fetchFn?: typeof fetch;
  historyFetcher?: (input: {
    startHistoryId?: string;
    accessToken: string;
    userEmail: string;
  }) => Promise<{
    messages: InboundEmailMessage[];
    historyId?: string;
  }>;
}

/**
 * Gmail OAuth2 inbound adapter with `historyId` incremental cursor tracking.
 */
export class GmailOAuth2InboundAdapter implements MailInboundAdapter {
  readonly mode: FactoryInboundMode = "gmail-oauth2";
  private readonly config: GmailOAuth2Config;
  private readonly acknowledgedMessageIds = new Set<string>();
  private historyId: string | undefined;
  private accessToken: string | undefined;
  private accessTokenExpiresAt = 0;

  constructor(config: GmailOAuth2Config) {
    this.config = config;
    this.historyId = config.initialHistoryId;
    this.accessToken = config.accessToken;
    if (config.accessToken !== undefined && config.accessToken.length > 0) {
      this.accessTokenExpiresAt = Date.now() + 300_000;
    }
  }

  getHistoryId(): string | undefined {
    return this.historyId;
  }

  setHistoryId(historyId: string): void {
    this.historyId = historyId;
  }

  private async ensureAccessToken(): Promise<string> {
    if (
      this.accessToken !== undefined &&
      this.accessToken.length > 0 &&
      Date.now() < this.accessTokenExpiresAt - 15_000
    ) {
      return this.accessToken;
    }

    if (
      this.config.historyFetcher !== undefined &&
      this.config.tokenUrl === undefined
    ) {
      return this.accessToken ?? "";
    }

    const fetchImpl = this.config.fetchFn ?? fetch;
    const tokenUrl =
      this.config.tokenUrl ?? "https://oauth2.googleapis.com/token";
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.config.refreshToken,
      grant_type: "refresh_token"
    });

    const res = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!res.ok) {
      throw new Error(
        `Gmail OAuth2 token refresh failed with HTTP ${res.status}`
      );
    }
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (typeof json.access_token !== "string" || json.access_token.length === 0) {
      throw new Error("Gmail OAuth2 token response missing access_token.");
    }
    this.accessToken = json.access_token;
    const ttlSec = typeof json.expires_in === "number" ? json.expires_in : 3600;
    this.accessTokenExpiresAt = Date.now() + ttlSec * 1000;
    return this.accessToken;
  }

  private updateHistoryCursor(
    explicitHistoryId: string | undefined,
    messages: ReadonlyArray<InboundEmailMessage>
  ): void {
    let best = explicitHistoryId ?? this.historyId;
    for (const msg of messages) {
      if (msg.historyId === undefined || msg.historyId.trim().length === 0) {
        continue;
      }
      if (best === undefined) {
        best = msg.historyId;
      } else {
        const bestNum = Number(best);
        const msgNum = Number(msg.historyId);
        if (Number.isFinite(bestNum) && Number.isFinite(msgNum)) {
          if (msgNum > bestNum) {
            best = msg.historyId;
          }
        } else if (msg.historyId > best) {
          best = msg.historyId;
        }
      }
    }
    this.historyId = best;
  }

  async pollIncremental(cursor?: string): Promise<MailInboundPollResult> {
    const effectiveCursor = cursor ?? this.historyId;
    const accessToken = await this.ensureAccessToken();

    if (this.config.historyFetcher !== undefined) {
      const result = await this.config.historyFetcher({
        ...(effectiveCursor !== undefined
          ? { startHistoryId: effectiveCursor }
          : {}),
        accessToken,
        userEmail: this.config.userEmail
      });
      this.updateHistoryCursor(result.historyId, result.messages);
      return {
        messages: result.messages,
        ...(this.historyId !== undefined ? { nextCursor: this.historyId } : {})
      };
    }

    const fetchImpl = this.config.fetchFn ?? fetch;
    const apiBase = (
      this.config.apiBaseUrl ?? "https://gmail.googleapis.com/gmail/v1"
    ).replace(/\/+$/, "");
    const headers = { Authorization: `Bearer ${accessToken}` };

    const messageIds = new Set<string>();
    let latestHistoryId = effectiveCursor;

    if (effectiveCursor !== undefined && effectiveCursor.length > 0) {
      const historyUrl = `${apiBase}/users/me/history?startHistoryId=${encodeURIComponent(effectiveCursor)}&historyTypes=messageAdded`;
      const historyRes = await fetchImpl(historyUrl, { headers });
      if (historyRes.status === 404) {
        // Cursor expired; fall through to list fallback below.
        latestHistoryId = undefined;
      } else if (!historyRes.ok) {
        throw new Error(
          `Gmail history poll failed with HTTP ${historyRes.status}`
        );
      } else {
        const payload = (await historyRes.json()) as {
          historyId?: string;
          history?: Array<{
            messagesAdded?: Array<{ message?: { id?: string } }>;
          }>;
        };
        if (payload.historyId !== undefined) {
          latestHistoryId = payload.historyId;
        }
        for (const item of payload.history ?? []) {
          for (const added of item.messagesAdded ?? []) {
            if (typeof added.message?.id === "string") {
              messageIds.add(added.message.id);
            }
          }
        }
      }
    }

    if (latestHistoryId === undefined) {
      const listUrl = `${apiBase}/users/me/messages?maxResults=25&q=${encodeURIComponent("+factory OR #factory OR [Idea]")}`;
      const listRes = await fetchImpl(listUrl, { headers });
      if (!listRes.ok) {
        throw new Error(
          `Gmail messages list failed with HTTP ${listRes.status}`
        );
      }
      const listJson = (await listRes.json()) as {
        messages?: Array<{ id?: string }>;
      };
      for (const entry of listJson.messages ?? []) {
        if (typeof entry.id === "string") {
          messageIds.add(entry.id);
        }
      }
    }

    const messages: InboundEmailMessage[] = [];
    for (const id of messageIds) {
      const msgRes = await fetchImpl(
        `${apiBase}/users/me/messages/${encodeURIComponent(id)}?format=full`,
        { headers }
      );
      if (!msgRes.ok) {
        continue;
      }
      const rawMsg = (await msgRes.json()) as GmailApiMessage;
      messages.push(convertGmailApiMessage(rawMsg));
    }

    this.updateHistoryCursor(latestHistoryId, messages);
    return {
      messages,
      ...(this.historyId !== undefined ? { nextCursor: this.historyId } : {})
    };
  }

  async acknowledgeProcessed(messageId: string): Promise<void> {
    this.acknowledgedMessageIds.add(messageId);
  }

  getAcknowledgedMessageIds(): string[] {
    return [...this.acknowledgedMessageIds];
  }
}

export interface ImapIdleConfig {
  host: string;
  port: number;
  secure?: boolean;
  username: string;
  password: string;
  mailbox?: string;
  initialUid?: number;
  idlePollFallbackMs?: number;
  connectTimeoutMs?: number;
  pollHandler?: (input: {
    lastUid?: number;
    mailbox: string;
  }) => Promise<{ messages: InboundEmailMessage[]; nextUid?: number }>;
  idleHandler?: (
    onMessage: (message: InboundEmailMessage) => Promise<void> | void
  ) => Promise<() => Promise<void> | void>;
}

function escapeImapString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * Minimal IMAP IDLE / incremental UID inbound adapter over TLS/TCP or custom handlers.
 */
export class ImapIdleInboundAdapter implements MailInboundAdapter {
  readonly mode: FactoryInboundMode = "imap";
  private readonly config: ImapIdleConfig;
  private readonly acknowledgedMessageIds = new Set<string>();
  private lastUid: number | undefined;
  private activeStopper: (() => Promise<void> | void) | undefined;

  constructor(config: ImapIdleConfig) {
    this.config = config;
    this.lastUid = config.initialUid;
  }

  getLastUid(): number | undefined {
    return this.lastUid;
  }

  setLastUid(uid: number): void {
    this.lastUid = uid;
  }

  private advanceUid(
    explicitNextUid: number | undefined,
    messages: ReadonlyArray<InboundEmailMessage>
  ): void {
    let best = explicitNextUid ?? this.lastUid;
    for (const msg of messages) {
      if (msg.uid !== undefined && (best === undefined || msg.uid > best)) {
        best = msg.uid;
      }
    }
    this.lastUid = best;
  }

  async pollIncremental(cursor?: string): Promise<MailInboundPollResult> {
    const parsedCursor =
      cursor !== undefined && /^\d+$/.test(cursor)
        ? Number.parseInt(cursor, 10)
        : undefined;
    const effectiveUid = parsedCursor ?? this.lastUid;
    const mailbox = this.config.mailbox ?? "INBOX";

    if (this.config.pollHandler !== undefined) {
      const result = await this.config.pollHandler({
        ...(effectiveUid !== undefined ? { lastUid: effectiveUid } : {}),
        mailbox
      });
      this.advanceUid(result.nextUid, result.messages);
      return {
        messages: result.messages,
        ...(this.lastUid !== undefined
          ? { nextCursor: String(this.lastUid) }
          : {})
      };
    }

    const messages = await this.fetchViaImapSocket(mailbox, effectiveUid);
    this.advanceUid(undefined, messages);
    return {
      messages,
      ...(this.lastUid !== undefined
        ? { nextCursor: String(this.lastUid) }
        : {})
    };
  }

  async startIdle(
    onMessage: (message: InboundEmailMessage) => Promise<void> | void
  ): Promise<() => Promise<void>> {
    await this.stopIdle();

    if (this.config.idleHandler !== undefined) {
      const innerStop = await this.config.idleHandler(onMessage);
      const stopper = async () => {
        await innerStop();
        if (this.activeStopper === stopper) {
          this.activeStopper = undefined;
        }
      };
      this.activeStopper = stopper;
      return stopper;
    }

    let stopped = false;
    const intervalMs = Math.max(100, this.config.idlePollFallbackMs ?? 15_000);
    const timer = setInterval(() => {
      if (stopped) {
        return;
      }
      void this.pollIncremental()
        .then(async (res) => {
          for (const msg of res.messages) {
            if (stopped) {
              break;
            }
            await onMessage(msg);
          }
        })
        .catch(() => {
          // Swallow transient idle poll errors; next tick will retry.
        });
    }, intervalMs);
    timer.unref();

    const stopper = async () => {
      stopped = true;
      clearInterval(timer);
      if (this.activeStopper === stopper) {
        this.activeStopper = undefined;
      }
    };
    this.activeStopper = stopper;
    return stopper;
  }

  async stopIdle(): Promise<void> {
    if (this.activeStopper !== undefined) {
      const fn = this.activeStopper;
      this.activeStopper = undefined;
      await fn();
    }
  }

  async acknowledgeProcessed(messageId: string): Promise<void> {
    this.acknowledgedMessageIds.add(messageId);
  }

  getAcknowledgedMessageIds(): string[] {
    return [...this.acknowledgedMessageIds];
  }

  private async fetchViaImapSocket(
    mailbox: string,
    sinceUid: number | undefined
  ): Promise<InboundEmailMessage[]> {
    const timeoutMs = this.config.connectTimeoutMs ?? 10_000;
    const useTls = this.config.secure !== false;

    const socket: net.Socket | tls.TLSSocket = await new Promise(
      (resolveSocket, rejectSocket) => {
        const s = useTls
          ? tls.connect({
              host: this.config.host,
              port: this.config.port,
              servername: this.config.host
            })
          : net.connect({
              host: this.config.host,
              port: this.config.port
            });

        const timer = setTimeout(() => {
          s.destroy();
          rejectSocket(new Error("IMAP connection timed out."));
        }, timeoutMs);

        const onError = (err: Error) => {
          clearTimeout(timer);
          rejectSocket(err);
        };

        s.once("error", onError);
        s.once(useTls ? "secureConnect" : "connect", () => {
          clearTimeout(timer);
          s.off("error", onError);
          resolveSocket(s);
        });
      }
    );

    let buffer = "";
    const waiters: Array<() => void> = [];
    const notify = () => {
      while (waiters.length > 0) {
        const fn = waiters.shift();
        fn?.();
      }
    };
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      notify();
    });
    socket.on("close", notify);

    const readUntilTagged = async (tag: string): Promise<string> => {
      const start = Date.now();
      const pattern = new RegExp(`(?:^|\\r?\\n)${tag} (OK|NO|BAD)[^\\r\\n]*\\r?\\n`);
      while (!pattern.test(buffer)) {
        if (socket.destroyed || socket.closed) {
          throw new Error(`IMAP socket closed while waiting for tag ${tag}`);
        }
        if (Date.now() - start > timeoutMs) {
          throw new Error(`IMAP command ${tag} timed out.`);
        }
        await new Promise<void>((r) => waiters.push(r));
      }
      const match = pattern.exec(buffer)!;
      const endIdx = match.index + match[0].length;
      const chunk = buffer.slice(0, endIdx);
      buffer = buffer.slice(endIdx);
      if (match[1] !== "OK") {
        throw new Error(`IMAP command ${tag} failed: ${match[0].trim()}`);
      }
      return chunk;
    };

    const readGreeting = async (): Promise<void> => {
      const start = Date.now();
      while (!/\r?\n/.test(buffer)) {
        if (socket.destroyed || Date.now() - start > timeoutMs) {
          throw new Error("IMAP greeting timed out.");
        }
        await new Promise<void>((r) => waiters.push(r));
      }
      const nlIdx = buffer.indexOf("\n");
      buffer = buffer.slice(nlIdx + 1);
    };

    let seq = 0;
    const sendCommand = async (cmd: string): Promise<string> => {
      const tag = `A${++seq}`;
      socket.write(`${tag} ${cmd}\r\n`);
      return readUntilTagged(tag);
    };

    try {
      await readGreeting();
      await sendCommand(
        `LOGIN ${escapeImapString(this.config.username)} ${escapeImapString(this.config.password)}`
      );
      await sendCommand(`SELECT ${escapeImapString(mailbox)}`);

      const searchCmd =
        sinceUid !== undefined
          ? `UID SEARCH UID ${sinceUid + 1}:*`
          : "UID SEARCH ALL";
      const searchResp = await sendCommand(searchCmd);
      const searchLine = searchResp
        .split(/\r?\n/)
        .find((l) => l.startsWith("* SEARCH"));
      const uids = (searchLine ?? "")
        .replace("* SEARCH", "")
        .trim()
        .split(/\s+/)
        .filter((s) => /^\d+$/.test(s))
        .map((s) => Number.parseInt(s, 10))
        .filter((uid) => sinceUid === undefined || uid > sinceUid);

      const results: InboundEmailMessage[] = [];
      for (const uid of uids) {
        const fetchResp = await sendCommand(`UID FETCH ${uid} (UID BODY.PEEK[])`);
        const literalMatch = /\{(\d+)\}\r?\n/.exec(fetchResp);
        if (literalMatch !== null) {
          const byteCount = Number.parseInt(literalMatch[1]!, 10);
          const bodyStart = literalMatch.index + literalMatch[0].length;
          const rawMsg = fetchResp.slice(bodyStart, bodyStart + byteCount);
          results.push(parseRawRfc822Email(rawMsg, { uid }));
        }
      }

      try {
        await sendCommand("LOGOUT");
      } catch {
        // Ignore logout errors.
      }
      return results;
    } finally {
      socket.destroy();
    }
  }
}

/**
 * Milestone M5 unattended overnight pipeline:
 * Gmail/IMAP `#factory` inbound -> Stage A Memory & Handoff -> Stage B Isolated git worktree & Sandbox coding
 * -> Stage C Read-only Oracle/Review dial -> Stage D Stop hook + Rich HTML morning report + optional plugin cards.
 */
export class OvernightFactory {
  private readonly config: FactoryInboundConfig;
  private readonly memoryStore: MemoryStore | undefined;
  private readonly handoffEngine: HandoffEngine;
  private readonly hookBus: LifecycleHookBus;
  private readonly sandbox: WorktreeSandbox;
  private readonly policyGuard: AntigravityPolicyGuard;
  private readonly dispatchRouter: TaskDispatchRouter;
  private readonly artifactBackdoor: ArtifactResultBackdoor;
  private readonly dispatchHub: DesktopIpcDispatchHub | undefined;
  private readonly callerKind: DispatchCallerKind;
  private readonly agentProvider: string | undefined;
  private readonly agentModel: string | undefined;
  private readonly reasoningEffort: DispatchReasoningEffort | undefined;
  private readonly secretaryBrain: OvernightSecretaryBrain;
  private readonly enableOracleReview: boolean | undefined;
  private readonly identityGuard = new ForwardIdentityGuard();
  private readonly collector = new DocumentCollector();
  private readonly outboundMailer: OutboundMailer | undefined;
  private readonly codingExecutor: CodingAgentExecutor | undefined;
  private readonly oracleReviewer: OracleReviewer | undefined;
  private readonly onNotifyPlugins:
    | ((notification: FactoryPluginNotification) => Promise<void> | void)
    | undefined;
  private readonly repos: Record<string, FactoryRepoTarget>;
  private readonly defaultRepoTarget: FactoryRepoTarget | undefined;
  private readonly worktreeBaseDir: string | undefined;
  private readonly writableTempDirs: string[];
  private readonly egressEnabled: boolean;
  private readonly allowedDomains: string[] | undefined;
  private readonly maxSelfHealAttempts: number;
  private readonly cleanupWorktree: boolean;
  private readonly testTimeoutMs: number;
  private readonly now: () => number;

  private readonly processedMessageIds = new Set<string>();
  private readonly inFlightMessageIds = new Set<string>();

  constructor(options?: Partial<FactoryInboundConfig> | OvernightFactoryOptions) {
    const opts: OvernightFactoryOptions = options ?? {};
    this.config = {
      mode: opts.mode ?? "gmail-oauth2",
      matchAliasOrTag: opts.matchAliasOrTag ?? "#factory",
      pollIntervalMs: opts.pollIntervalMs ?? 60_000
    };
    this.memoryStore = opts.memoryStore;
    this.handoffEngine = opts.handoffEngine ?? new HandoffEngine();
    this.hookBus =
      opts.hookBus ?? new LifecycleHookBus({ defaultPermissionMode: "auto" });
    this.sandbox = opts.sandbox ?? new WorktreeSandbox();
    this.policyGuard = opts.policyGuard ?? new AntigravityPolicyGuard();
    this.dispatchRouter = opts.dispatchRouter ?? new TaskDispatchRouter();
    this.artifactBackdoor =
      opts.artifactBackdoor ??
      new ArtifactResultBackdoor({
        policyGuard: this.policyGuard,
        now: opts.now
      });
    this.dispatchHub = opts.dispatchHub;
    this.callerKind = opts.callerKind ?? "overnight_factory";
    this.agentProvider = opts.agentProvider;
    this.agentModel = opts.agentModel;
    this.reasoningEffort = opts.reasoningEffort;
    this.secretaryBrain = opts.secretaryBrain ?? "codex";
    this.enableOracleReview = opts.enableOracleReview;
    this.outboundMailer = opts.outboundMailer;
    this.codingExecutor = opts.codingExecutor;
    this.oracleReviewer = opts.oracleReviewer;
    this.onNotifyPlugins = opts.onNotifyPlugins;
    this.repos = { ...(opts.repos ?? {}) };
    this.defaultRepoTarget = opts.defaultRepoTarget;
    this.worktreeBaseDir = opts.worktreeBaseDir;
    this.writableTempDirs = [...(opts.writableTempDirs ?? [])];
    this.egressEnabled = opts.egressEnabled ?? false;
    this.allowedDomains =
      opts.allowedDomains !== undefined ? [...opts.allowedDomains] : undefined;
    this.maxSelfHealAttempts = Math.max(1, opts.maxSelfHealAttempts ?? 3);
    this.cleanupWorktree = opts.cleanupWorktree ?? true;
    this.testTimeoutMs = Math.max(500, opts.testTimeoutMs ?? 120_000);
    this.now = opts.now ?? (() => Date.now());
  }

  getInboundConfig(): FactoryInboundConfig {
    return { ...this.config };
  }

  getStages(): readonly FactoryStage[] {
    return FACTORY_STAGES;
  }

  hasProcessedMessage(messageId: string): boolean {
    return this.processedMessageIds.has(normalizeMessageId(messageId));
  }

  markMessageProcessed(messageId: string): void {
    const norm = normalizeMessageId(messageId);
    if (norm.length > 0) {
      this.processedMessageIds.add(norm);
    }
  }

  getProcessedMessageIds(): string[] {
    return [...this.processedMessageIds];
  }

  async pollInbound(
    adapter: MailInboundAdapter,
    runOptions?: FactoryRunOptions
  ): Promise<FactoryPipelineResult[]> {
    const pollResult = await adapter.pollIncremental();
    const results: FactoryPipelineResult[] = [];

    for (const email of pollResult.messages) {
      if (!matchesFactoryTrigger(email, this.config.matchAliasOrTag)) {
        continue;
      }
      if (this.hasProcessedMessage(email.messageId)) {
        results.push({
          status: "skipped_duplicate",
          jobId: `dup-${normalizeMessageId(email.messageId)}`,
          messageId: email.messageId,
          threadId: "",
          worktreeCleaned: false,
          memoryContext: [],
          changedFiles: [],
          reviewComments: []
        });
        continue;
      }

      const result = await this.runEmailPipeline(email, runOptions);
      results.push(result);
      if (result.status === "completed") {
        await adapter.acknowledgeProcessed?.(email.messageId);
      }
    }

    return results;
  }

  async runEmailPipeline(
    email: InboundEmailMessage,
    runOptions?: FactoryRunOptions
  ): Promise<FactoryPipelineResult> {
    const startedAt = this.now();
    const normMsgId = normalizeMessageId(email.messageId);

    if (
      !runOptions?.ignoreTriggerCheck &&
      !matchesFactoryTrigger(email, this.config.matchAliasOrTag)
    ) {
      return {
        status: "skipped_unmatched",
        jobId: `skip-${normMsgId || randomUUID().slice(0, 8)}`,
        messageId: email.messageId,
        threadId: "",
        worktreeCleaned: false,
        memoryContext: [],
        changedFiles: [],
        reviewComments: []
      };
    }

    if (
      this.processedMessageIds.has(normMsgId) ||
      this.inFlightMessageIds.has(normMsgId)
    ) {
      return {
        status: "skipped_duplicate",
        jobId: `dup-${normMsgId}`,
        messageId: email.messageId,
        threadId: "",
        worktreeCleaned: false,
        memoryContext: [],
        changedFiles: [],
        reviewComments: []
      };
    }

    this.inFlightMessageIds.add(normMsgId);
    const jobId = `fac-${startedAt}-${randomUUID().slice(0, 6)}`;
    let worktreePathForCleanup: string | undefined;
    let targetRepoPathForCleanup: string | undefined;
    let worktreeCreated = false;
    let worktreeCleaned = false;
    const shouldCleanupWorktree =
      runOptions?.cleanupWorktree ?? this.cleanupWorktree;

    try {
      // =====================================================================
      // Pre-flight: Parameter Backdoor Routing & AGY Hard-Lock Role Guard
      // =====================================================================
      const preClean = this.collectCleanEmailBody(email);
      const effectiveCallerKind = runOptions?.callerKind ?? this.callerKind;
      const effectiveSecretaryBrain =
        runOptions?.secretaryBrain ?? this.secretaryBrain;
      const emailProviderDirective =
        extractDirective(preClean.cleanedEmailText, "provider") ??
        extractDirective(preClean.cleanedEmailText, "agent") ??
        extractDirective(email.subject, "provider");
      const explicitProvider =
        runOptions?.agentProvider?.trim() ||
        emailProviderDirective?.trim() ||
        this.agentProvider?.trim() ||
        undefined;
      const combinedEmailPrompt = `${email.subject}\n${preClean.cleanedEmailText}`;
      const explicitAgyMention =
        detectExplicitAntigravityPrompt(combinedEmailPrompt);

      const routedTarget = this.dispatchRouter.route({
        prompt: combinedEmailPrompt,
        callerKind: effectiveCallerKind,
        ...(explicitProvider !== undefined ? { provider: explicitProvider } : {}),
        ...(runOptions?.agentModel ?? this.agentModel
          ? { modelId: (runOptions?.agentModel ?? this.agentModel)!.trim() }
          : {}),
        ...(runOptions?.reasoningEffort ?? this.reasoningEffort
          ? { reasoningEffort: runOptions?.reasoningEffort ?? this.reasoningEffort }
          : {}),
        ...(explicitAgyMention ? { explicitAntigravityRequested: true } : {})
      });

      const guardDecision = await this.policyGuard.evaluateDispatchAsync({
        callerKind: effectiveCallerKind,
        targetProvider: routedTarget.provider,
        targetModelId: routedTarget.modelId,
        explicitAntigravityRequested: routedTarget.explicitAntigravityRequested
      });

      if (!guardDecision.allowed) {
        throw new AntigravityGuardDeniedError(
          guardDecision.code ?? "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED",
          guardDecision.reason,
          guardDecision
        );
      }

      // =====================================================================
      // Stage A: DocumentCollector -> owner_chief MemoryStore -> HandoffEngine
      // =====================================================================
      const stageA = await this.runStageA(jobId, email, startedAt, runOptions);

      targetRepoPathForCleanup = stageA.repoTarget.repoPath;
      worktreePathForCleanup = stageA.worktreePath;

      // Interactive remote secretary (e.g. Gmail `#factory` via `secretary_gmail`) requesting
      // personal Antigravity: NEVER auto-send! Create isolated worktree + stage Draft-Only
      // awaiting explicit human desktop confirmation and reply clearly via email.
      if (guardDecision.decision === "stage_draft_only") {
        const repoPath = stageA.repoTarget.repoPath;
        const baseBranch = this.runGit(repoPath, [
          "rev-parse",
          "--abbrev-ref",
          "HEAD"
        ]).trim();
        const baseCommitSha = this.runGit(repoPath, ["rev-parse", "HEAD"]).trim();
        mkdirSync(dirname(stageA.worktreePath), { recursive: true });
        this.runGit(repoPath, [
          "worktree",
          "add",
          "-b",
          stageA.branchName,
          stageA.worktreePath,
          "HEAD"
        ]);
        worktreeCreated = true;

        const memoryContextSummary =
          stageA.memoryHits.length > 0
            ? stageA.memoryHits
                .slice(0, 4)
                .map((h) => `[${h.entry.namespace}] ${h.entry.title}`)
                .join("；")
            : undefined;
        const recipient =
          runOptions?.reportRecipient ?? extractEmailAddressOnly(email.from);

        const stagedBase = {
          taskId: jobId,
          workspacePath: stageA.repoTarget.repoPath,
          worktreePath: stageA.worktreePath,
          branchName: stageA.branchName,
          prompt: stageA.handoff.continuationPrompt,
          provider: routedTarget.provider,
          modelId: routedTarget.modelId,
          reasoningEffort: routedTarget.reasoningEffort,
          callerKind: effectiveCallerKind,
          taskCategory: routedTarget.taskCategory,
          confirmationReason: guardDecision.reason,
          ...(memoryContextSummary !== undefined ? { memoryContextSummary } : {}),
          replyChannel: {
            kind: "gmail" as const,
            recipient,
            inReplyTo: email.messageId,
            threadId: stageA.handoff.newThreadId
          },
          threadId: stageA.handoff.newThreadId
        };

        const dispatchEnvelope: PrismuxDispatchEnvelope =
          this.dispatchHub !== undefined
            ? this.dispatchHub.stageDraftTask(stagedBase)
            : {
                ...stagedBase,
                status: "awaiting_human_confirmation",
                mode: "draft_only",
                requiresHumanConfirmation: true,
                createdAt: new Date(this.now()).toISOString(),
                updatedAt: new Date(this.now()).toISOString()
              };

        const deepLink = buildReviewDeepLink(stageA.handoff.newThreadId);
        const draftHtml = this.renderDraftConfirmationHtml({
          jobId,
          subject: email.subject,
          branchName: stageA.branchName,
          worktreePath: stageA.worktreePath,
          memoryContextSummary,
          deepLink,
          reason: guardDecision.reason
        });

        const mailer = runOptions?.outboundMailer ?? this.outboundMailer;
        let mailReceipt: OutboundMailReceipt | undefined;
        if (mailer !== undefined && recipient.length > 0) {
          mailReceipt = await mailer.send({
            to: [recipient],
            subject: `[${BRAND.appName} 个人版 AGY 待确认草稿] ${email.subject}`,
            html: draftHtml,
            text: [
              `您的邮件明确指定调用个人版 Antigravity（AGY）。为遵守账号安全硬锁定策略，系统绝不会在无人值守/远程链路中自动触发个人版 AGY。`,
              `已完成以下前置准备（Draft-Only）：`,
              `- 任务 ID：${jobId}`,
              `- 隔离分支：${stageA.branchName}`,
              `- Worktree 路径：${stageA.worktreePath}`,
              ...(memoryContextSummary
                ? [`- 已召回记忆上下文：${memoryContextSummary}`]
                : []),
              `请打开桌面端 Prismux 点击「确认放行并发送」后正式执行：${deepLink}`
            ].join("\n"),
            inReplyTo: email.messageId,
            references: [email.messageId],
            threadId: stageA.handoff.newThreadId
          });
        }

        this.processedMessageIds.add(normMsgId);
        return {
          status: "awaiting_human_confirmation",
          jobId,
          messageId: email.messageId,
          threadId: stageA.handoff.newThreadId,
          codingThreadId: stageA.handoff.newThreadId,
          branchName: stageA.branchName,
          baseBranch,
          baseCommitSha,
          worktreePath: stageA.worktreePath,
          worktreeCleaned: false,
          cleanedEmailText: stageA.cleanedEmailText,
          memoryContext: stageA.memoryHits,
          handoff: stageA.handoff,
          changedFiles: [],
          reviewComments: [guardDecision.reason],
          reportHtml: draftHtml,
          ...(mailReceipt !== undefined ? { mailReceipt } : {}),
          deepLink,
          requiresHumanConfirmation: true,
          dispatchEnvelope,
          oracleReviewSkipped: true,
          routedProvider: routedTarget.provider,
          routedModelId: routedTarget.modelId,
          routedReasoningEffort: routedTarget.reasoningEffort,
          secretaryBrain: effectiveSecretaryBrain
        };
      }

      // =====================================================================
      // Stage B: Isolated git worktree + WorktreeSandbox + Self-heal + Commit
      // =====================================================================
      const stageB = await this.runStageB(
        jobId,
        email,
        stageA,
        runOptions,
        () => {
          worktreeCreated = true;
        }
      );

      // Extract structured deliverables directly via ArtifactResultBackdoor
      // (default v3 straight-to-email pipeline, skipping heavy Oracle second-review!).
      const totalInsertions = stageB.changedFiles.reduce(
        (sum, f) => sum + f.additions,
        0
      );
      const totalDeletions = stageB.changedFiles.reduce(
        (sum, f) => sum + f.deletions,
        0
      );
      const artifact = this.artifactBackdoor.extractArtifact({
        taskId: jobId,
        threadId: stageA.handoff.newThreadId,
        workspacePath: stageA.worktreePath,
        finalAssistantText:
          stageB.codingSummary ?? stageA.handoff.summary.goal,
        modifiedFiles: stageB.changedFiles.map((f) => f.path),
        diffStats: {
          filesChanged: stageB.changedFiles.length,
          insertions: totalInsertions,
          deletions: totalDeletions
        },
        provider: stageB.tokenStats?.provider ?? routedTarget.provider,
        modelId: stageB.tokenStats?.model ?? routedTarget.modelId,
        branchName: stageA.branchName,
        commitSha: stageB.commitSha,
        testPassed: stageB.testPassed,
        skipGitInspection: true
      });

      // =====================================================================
      // Optional Legacy Stage C: Only when caller explicitly enables Oracle review
      // =====================================================================
      const explicitReviewer = runOptions?.oracleReviewer ?? this.oracleReviewer;
      const shouldRunOracleReview =
        runOptions?.enableOracleReview === true ||
        (runOptions?.enableOracleReview !== false &&
          this.enableOracleReview !== false &&
          explicitReviewer !== undefined);

      const stageC = shouldRunOracleReview
        ? await this.runStageC(jobId, stageA, stageB, runOptions)
        : {
            reviewThreadId: stageA.handoff.newThreadId,
            reviewComments: [
              `[ArtifactResultBackdoor 直出] 已跳过重型 Oracle 二次审查，直接基于 Diff 与单测输出生成完工早报。`,
              ...analyzeDiffStaticRisks(
                stageB.diff,
                stageB.changedFiles,
                stageB.testPassed
              )
            ]
          };
      const oracleReviewSkipped = !shouldRunOracleReview;

      // =====================================================================
      // Stage D: Stop Hook + Rich HTML Morning Report + Mailer + Plugin Push
      // =====================================================================
      const stageD = await this.runStageD(
        jobId,
        startedAt,
        email,
        stageA,
        stageB,
        stageC,
        runOptions,
        {
          artifact,
          oracleReviewSkipped
        }
      );

      if (shouldCleanupWorktree && worktreeCreated) {
        this.removeWorktree(stageA.repoTarget.repoPath, stageA.worktreePath);
        worktreeCleaned = true;
      }

      this.processedMessageIds.add(normMsgId);

      return {
        status: "completed",
        jobId,
        messageId: email.messageId,
        threadId: stageC.reviewThreadId,
        codingThreadId: stageA.handoff.newThreadId,
        reviewThreadId: stageC.reviewThreadId,
        branchName: stageA.branchName,
        baseBranch: stageB.baseBranch,
        baseCommitSha: stageB.baseCommitSha,
        commitSha: stageB.commitSha,
        worktreePath: stageA.worktreePath,
        worktreeCleaned,
        cleanedEmailText: stageA.cleanedEmailText,
        memoryContext: stageA.memoryHits,
        handoff: stageA.handoff,
        diff: stageB.diff,
        changedFiles: stageB.changedFiles,
        testCommand: stageA.repoTarget.testCommand,
        testOutput: stageB.testOutput,
        testPassed: stageB.testPassed,
        selfHealAttempts: stageB.attemptsUsed,
        reviewComments: stageC.reviewComments,
        stopHookResult: stageD.stopHookResult,
        tokenStats: stageD.tokenStats,
        report: stageD.report,
        reportHtml: stageD.reportHtml,
        mailReceipt: stageD.mailReceipt,
        notification: stageD.notification,
        deepLink: stageD.report.deepLink,
        artifact,
        oracleReviewSkipped,
        routedProvider: routedTarget.provider,
        routedModelId: routedTarget.modelId,
        routedReasoningEffort: routedTarget.reasoningEffort,
        secretaryBrain: effectiveSecretaryBrain
      };
    } catch (error) {
      if (
        shouldCleanupWorktree &&
        worktreeCreated &&
        !worktreeCleaned &&
        targetRepoPathForCleanup !== undefined &&
        worktreePathForCleanup !== undefined
      ) {
        try {
          this.removeWorktree(targetRepoPathForCleanup, worktreePathForCleanup);
        } catch {
          // Preserve original pipeline failure.
        }
      }
      throw error;
    } finally {
      this.inFlightMessageIds.delete(normMsgId);
    }
  }

  private collectCleanEmailBody(email: InboundEmailMessage): {
    cleanedEmailText: string;
    chunks: CollectorChunk[];
  } {
    const sourceRef = `email:${email.messageId}`;
    let chunks: CollectorChunk[] = [];

    if (email.rawRfc822 !== undefined && email.rawRfc822.trim().length > 0) {
      chunks = this.collector.collect({
        kind: "email",
        raw: email.rawRfc822,
        sourceRef
      });
    } else if (email.textBody !== undefined && email.textBody.trim().length > 0) {
      chunks = this.collector.collect({
        kind: "email",
        raw: email.textBody,
        sourceRef
      });
    } else if (email.htmlBody !== undefined && email.htmlBody.trim().length > 0) {
      chunks = this.collector.collect({
        kind: "html",
        raw: email.htmlBody,
        sourceRef
      });
    }

    const cleanedEmailText =
      chunks.length > 0
        ? chunks.map((chunk) => chunk.text).join("\n\n").trim()
        : (email.subject ?? "").trim();

    return { cleanedEmailText, chunks };
  }

  private resolveTargetConfig(
    email: InboundEmailMessage,
    cleanedEmailText: string,
    runOptions?: FactoryRunOptions
  ): FactoryRepoTarget {
    if (runOptions?.repoTarget !== undefined) {
      return runOptions.repoTarget;
    }

    const repoDirective =
      extractDirective(cleanedEmailText, "repo") ??
      extractDirective(email.subject, "repo");
    if (repoDirective !== undefined && repoDirective in this.repos) {
      return this.repos[repoDirective]!;
    }

    const combinedText = `${email.subject}\n${cleanedEmailText}`.toLowerCase();
    for (const [key, candidate] of Object.entries(this.repos)) {
      if (combinedText.includes(key.toLowerCase())) {
        return candidate;
      }
    }

    if (this.defaultRepoTarget !== undefined) {
      return this.defaultRepoTarget;
    }

    throw new Error(
      `OvernightFactory could not resolve target repository for email "${email.subject}". Provide repoTarget or defaultRepoTarget.`
    );
  }

  private resolveUniqueBranchName(
    repoPath: string,
    subject: string,
    timestampMs: number
  ): string {
    const baseBranchName = buildFactoryBranchName(subject, timestampMs);
    if (!this.doesGitBranchExist(repoPath, baseBranchName)) {
      return baseBranchName;
    }
    const suffix = randomUUID().slice(0, 4);
    return `${baseBranchName}-${suffix}`;
  }

  private doesGitBranchExist(repoPath: string, branchName: string): boolean {
    try {
      this.runGit(repoPath, [
        "show-ref",
        "--verify",
        "--quiet",
        `refs/heads/${branchName}`
      ]);
      return true;
    } catch {
      return false;
    }
  }

  private async runStageA(
    jobId: string,
    email: InboundEmailMessage,
    startedAt: number,
    runOptions?: FactoryRunOptions
  ): Promise<{
    cleanedEmailText: string;
    repoTarget: FactoryRepoTarget;
    repoSlug: string;
    workspaceNamespace: MemoryNamespace;
    memoryHits: MemoryQueryHit[];
    branchName: string;
    worktreePath: string;
    sourceThreadId: string;
    handoff: HandoffExecutionResult;
  }> {
    const { cleanedEmailText } = this.collectCleanEmailBody(email);
    const repoTarget = this.resolveTargetConfig(
      email,
      cleanedEmailText,
      runOptions
    );
    const repoSlug =
      repoTarget.repoSlug ??
      (basename(repoTarget.repoPath)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-") ||
        "default-repo");
    const workspaceNamespace: MemoryNamespace =
      repoTarget.workspaceNamespace ?? `workspace/${repoSlug}`;

    // Query MemoryStore using authoritative `owner_chief` scope across `workspace/<repo>` + `private/chief`.
    const memoryHits: MemoryQueryHit[] = [];
    if (this.memoryStore !== undefined) {
      const namespaces: MemoryNamespace[] = [
        workspaceNamespace,
        "private/chief"
      ];
      const primaryQuery = extractSearchKeywords(
        email.subject,
        cleanedEmailText,
        repoSlug
      );

      const seenIds = new Set<string>();
      const pushHits = (hits: ReadonlyArray<MemoryQueryHit>) => {
        for (const hit of hits) {
          if (!seenIds.has(hit.entry.id)) {
            seenIds.add(hit.entry.id);
            memoryHits.push(hit);
          }
        }
      };

      const primaryRequest = this.identityGuard.bindCallerScope("owner_chief", {
        callerScope: "owner_chief",
        query: primaryQuery,
        namespaces,
        limit: 8,
        mode: "hybrid"
      });
      const primaryRes = await this.memoryStore.query(
        primaryRequest,
        "owner_chief"
      );
      pushHits(primaryRes.hits);

      if (memoryHits.length === 0) {
        const fallbackRequest = this.identityGuard.bindCallerScope(
          "owner_chief",
          {
            callerScope: "owner_chief",
            query: `${repoSlug} architecture convention stack test 规范 架构 技术栈`,
            namespaces,
            limit: 8,
            mode: "hybrid"
          }
        );
        const fallbackRes = await this.memoryStore.query(
          fallbackRequest,
          "owner_chief"
        );
        pushHits(fallbackRes.hits);
      }

      memoryHits.sort((a, b) => b.score - a.score);
    }

    const branchName = this.resolveUniqueBranchName(
      repoTarget.repoPath,
      email.subject,
      email.receivedAt ?? startedAt
    );

    const worktreeRoot =
      this.worktreeBaseDir ??
      join(tmpdir(), `${BRAND.appSlug}-factory-worktrees`);
    const worktreePath =
      runOptions?.worktreePath ?? join(worktreeRoot, jobId);

    const sourceThreadId = `factory-inbound-${jobId}`;
    const memorySummaryLines =
      memoryHits.length > 0
        ? memoryHits.map(
            (hit) =>
              `[${hit.entry.namespace}/${hit.entry.kind}] ${hit.entry.title}: ${hit.entry.content}`
          )
        : ["（暂无命中历史仓库记忆，按标准严格工程规范执行）"];

    const transcript: HandoffTranscriptMessage[] = [
      {
        role: "user",
        content: [
          `Goal: ${email.subject.replace(/\[idea\]|#factory/gi, "").trim() || email.subject}`,
          `From: ${email.from}`,
          cleanedEmailText
        ].join("\n\n")
      },
      {
        role: "assistant",
        content: [
          `Decision: 创建隔离分支 ${branchName} 于工作树 ${worktreePath}，并在完成后执行验收测试 \`${repoTarget.testCommand}\`。`,
          `仓库技术栈与规范记忆（owner_chief 跨 ${workspaceNamespace} 与 private/chief 检索）：`,
          ...memorySummaryLines
        ].join("\n")
      }
    ];

    const handoff = await this.handoffEngine.executeHandoff({
      sourceThreadId,
      targetDialMode: "agent",
      targetWorkspace: worktreePath,
      targetBranch: branchName,
      additionalContext: [
        `目标仓库：${repoTarget.repoPath}`,
        `验收命令：${repoTarget.testCommand}`,
        `分支名称：${branchName}`
      ].join("\n"),
      transcript
    });

    return {
      cleanedEmailText,
      repoTarget,
      repoSlug,
      workspaceNamespace,
      memoryHits,
      branchName,
      worktreePath,
      sourceThreadId,
      handoff
    };
  }

  private async runStageB(
    jobId: string,
    email: InboundEmailMessage,
    stageA: {
      cleanedEmailText: string;
      repoTarget: FactoryRepoTarget;
      memoryHits: MemoryQueryHit[];
      branchName: string;
      worktreePath: string;
      handoff: HandoffExecutionResult;
    },
    runOptions: FactoryRunOptions | undefined,
    onWorktreeCreated: () => void
  ): Promise<{
    baseBranch: string;
    baseCommitSha: string;
    commitSha: string;
    diff: string;
    changedFiles: FactoryChangedFileStat[];
    testOutput: string;
    testPassed: boolean;
    attemptsUsed: number;
    codingSummary?: string;
    tokenStats?: Partial<MorningReportTokenStats>;
  }> {
    const codingExecutor = runOptions?.codingExecutor ?? this.codingExecutor;
    if (codingExecutor === undefined) {
      throw new Error(
        "OvernightFactory Stage B requires a CodingAgentExecutor (pass codingExecutor in options or runEmailPipeline)."
      );
    }

    const repoPath = stageA.repoTarget.repoPath;
    const baseBranch = this.runGit(repoPath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD"
    ]).trim();
    const baseCommitSha = this.runGit(repoPath, ["rev-parse", "HEAD"]).trim();

    mkdirSync(dirname(stageA.worktreePath), { recursive: true });
    this.runGit(repoPath, [
      "worktree",
      "add",
      "-b",
      stageA.branchName,
      stageA.worktreePath,
      "HEAD"
    ]);
    onWorktreeCreated();

    const activeWorktreeBranch = this.runGit(stageA.worktreePath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD"
    ]).trim();
    if (
      activeWorktreeBranch === "main" ||
      activeWorktreeBranch === "master" ||
      activeWorktreeBranch !== stageA.branchName
    ) {
      throw new Error(
        `Safety check failed: worktree branch "${activeWorktreeBranch}" must equal isolated branch "${stageA.branchName}" and never mutate main/master.`
      );
    }

    const policy = this.sandbox.createPolicy({
      worktreePath: stageA.worktreePath,
      writableTempDirs:
        runOptions?.writableTempDirs ?? this.writableTempDirs,
      egressEnabled: runOptions?.egressEnabled ?? this.egressEnabled,
      allowedDomains: runOptions?.allowedDomains ?? this.allowedDomains
    });
    const isolationSpec = this.sandbox.buildIsolationSpec(
      policy,
      process.execPath,
      []
    );

    const sessionId = `factory-sess-${jobId}`;
    const threadId = stageA.handoff.newThreadId;
    const testTimeoutMs =
      runOptions?.testTimeoutMs ?? this.testTimeoutMs;
    const maxAttempts = Math.max(
      1,
      runOptions?.maxSelfHealAttempts ?? this.maxSelfHealAttempts
    );

    await this.hookBus.emit({
      event: "SessionStart",
      sessionId,
      threadId,
      permissionMode: "auto",
      toolName: "overnight_factory_stage_b",
      toolInput: {
        worktreePath: stageA.worktreePath,
        branchName: stageA.branchName
      },
      timestamp: this.now()
    });

    const resolveWorktreeTarget = (filePath: string): string =>
      isAbsolute(filePath)
        ? resolve(filePath)
        : resolve(stageA.worktreePath, filePath);

    const tools = {
      readFile: async (filePath: string): Promise<string> => {
        const resolved = resolveWorktreeTarget(filePath);
        const pre = await this.hookBus.emit({
          event: "PreToolUse",
          sessionId,
          threadId,
          permissionMode: "auto",
          toolName: "read_file",
          toolInput: { filePath: resolved },
          timestamp: this.now()
        });
        if (pre.decision === "block") {
          throw new Error(
            pre.feedback ?? `PreToolUse blocked read_file on ${resolved}`
          );
        }
        const content = readFileSync(resolved, "utf8");
        await this.hookBus.emit({
          event: "PostToolUse",
          sessionId,
          threadId,
          permissionMode: "auto",
          toolName: "read_file",
          toolInput: { filePath: resolved },
          toolOutput: { bytes: Buffer.byteLength(content, "utf8") },
          timestamp: this.now()
        });
        return content;
      },
      assertWriteAllowed: (filePath: string): void => {
        const resolved = resolveWorktreeTarget(filePath);
        this.sandbox.assertWriteTargetAllowed(policy, resolved);
      },
      isWriteAllowed: (filePath: string): boolean => {
        const resolved = resolveWorktreeTarget(filePath);
        return this.sandbox.isWriteTargetAllowed(policy, resolved);
      },
      writeFile: async (filePath: string, content: string): Promise<string> => {
        const resolved = resolveWorktreeTarget(filePath);
        this.sandbox.assertWriteTargetAllowed(policy, resolved);
        const pre = await this.hookBus.emit({
          event: "PreToolUse",
          sessionId,
          threadId,
          permissionMode: "auto",
          toolName: "write_file",
          toolInput: { filePath: resolved, bytes: Buffer.byteLength(content) },
          timestamp: this.now()
        });
        if (pre.decision === "block") {
          throw new Error(
            pre.feedback ?? `PreToolUse blocked write_file on ${resolved}`
          );
        }
        mkdirSync(dirname(resolved), { recursive: true });
        writeFileSync(resolved, content, "utf8");
        await this.hookBus.emit({
          event: "PostToolUse",
          sessionId,
          threadId,
          permissionMode: "auto",
          toolName: "write_file",
          toolInput: { filePath: resolved },
          toolOutput: { written: true },
          timestamp: this.now()
        });
        return resolved;
      },
      runCommand: async (command: string): Promise<FactoryCommandResult> => {
        const pre = await this.hookBus.emit({
          event: "PreToolUse",
          sessionId,
          threadId,
          permissionMode: "auto",
          toolName: "run_command",
          toolInput: { command },
          timestamp: this.now()
        });
        if (pre.decision === "block") {
          throw new Error(
            pre.feedback ?? `PreToolUse blocked command: ${command}`
          );
        }
        const cmdResult = await this.executeSandboxedCommand(
          command,
          stageA.worktreePath,
          isolationSpec.env,
          testTimeoutMs
        );
        await this.hookBus.emit({
          event: "PostToolUse",
          sessionId,
          threadId,
          permissionMode: "auto",
          toolName: "run_command",
          toolInput: { command },
          toolOutput: { exitCode: cmdResult.exitCode },
          timestamp: this.now()
        });
        return cmdResult;
      }
    };

    let lastTestFailure: string | undefined;
    let testOutput = "";
    let testPassed = false;
    let attemptsUsed = 0;
    let codingResult: CodingAgentExecutionResult | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attemptsUsed = attempt;
      const execRes = await codingExecutor({
        jobId,
        threadId,
        attempt,
        maxAttempts,
        worktreePath: stageA.worktreePath,
        branchName: stageA.branchName,
        handoff: stageA.handoff,
        memoryHits: stageA.memoryHits,
        email,
        cleanedEmailText: stageA.cleanedEmailText,
        testCommand: stageA.repoTarget.testCommand,
        ...(lastTestFailure !== undefined ? { lastTestFailure } : {}),
        sandbox: this.sandbox,
        sandboxPolicy: policy,
        isolationSpec,
        hookBus: this.hookBus,
        tools
      });
      if (execRes !== undefined) {
        codingResult = execRes;
      }

      const testRun = await tools.runCommand(stageA.repoTarget.testCommand);
      testOutput = testRun.combinedOutput;
      testPassed = testRun.exitCode === 0;
      if (testPassed) {
        break;
      }
      lastTestFailure = testOutput;
    }

    if (!testPassed) {
      throw new Error(
        `OvernightFactory Stage B tests failed after ${attemptsUsed} attempt(s) for command "${stageA.repoTarget.testCommand}":\n${testOutput}`
      );
    }

    // Stage ONLY concrete changed/untracked files inside worktree (never `git add .` / `-A`).
    const filesToStage = this.collectGitChangedPaths(stageA.worktreePath);
    if (filesToStage.length === 0) {
      throw new Error(
        `OvernightFactory Stage B produced no file changes in worktree "${stageA.worktreePath}".`
      );
    }

    this.runGit(stageA.worktreePath, ["add", "--", ...filesToStage]);

    const commitMessage = `feat(factory): ${stageA.handoff.summary.goal.slice(0, 72).replace(/\r?\n/g, " ")}`;
    const commitArgs = this.buildGitCommitArgs(
      stageA.worktreePath,
      commitMessage
    );
    this.runGit(stageA.worktreePath, commitArgs);

    const commitSha = this.runGit(stageA.worktreePath, [
      "rev-parse",
      "HEAD"
    ]).trim();
    const diff = this.runGit(stageA.worktreePath, ["diff", "HEAD~1"]);
    const changedFiles = this.collectDiffStats(stageA.worktreePath);

    return {
      baseBranch,
      baseCommitSha,
      commitSha,
      diff,
      changedFiles,
      testOutput,
      testPassed,
      attemptsUsed,
      ...(codingResult?.summary !== undefined
        ? { codingSummary: codingResult.summary }
        : {}),
      ...(codingResult?.tokenStats !== undefined
        ? { tokenStats: codingResult.tokenStats }
        : {})
    };
  }

  private async runStageC(
    jobId: string,
    stageA: {
      branchName: string;
      worktreePath: string;
      repoTarget: FactoryRepoTarget;
      handoff: HandoffExecutionResult;
    },
    stageB: {
      diff: string;
      changedFiles: FactoryChangedFileStat[];
      testOutput: string;
      testPassed: boolean;
    },
    runOptions?: FactoryRunOptions
  ): Promise<{
    reviewThreadId: string;
    reviewComments: string[];
    reviewTokenStats?: Partial<MorningReportTokenStats>;
  }> {
    const reviewHandoff = await this.handoffEngine.executeHandoff({
      sourceThreadId: stageA.handoff.newThreadId,
      targetDialMode: "review",
      targetWorkspace: stageA.worktreePath,
      targetBranch: stageA.branchName,
      additionalContext: `只读审阅分支 ${stageA.branchName} 的 git diff 与单测结果。`,
      transcript: [
        {
          role: "assistant",
          content: `Goal: 对分支 ${stageA.branchName} 执行独立只读 Review。\n变更文件：${stageB.changedFiles.map((f) => f.path).join(", ")}`,
          touchedFiles: stageB.changedFiles.map((f) => f.path)
        }
      ]
    });

    const reviewThreadId = reviewHandoff.newThreadId;
    this.handoffEngine.setDialMode(reviewThreadId, "review");

    // Enforce read-only invariant in Review dial mode.
    if (
      isToolAllowedInDialMode("review", "write_file") ||
      this.handoffEngine.isToolAllowedForThread(reviewThreadId, "write_file")
    ) {
      throw new Error(
        `Dial mode invariant violated: write_file must be denied in review mode for thread "${reviewThreadId}".`
      );
    }

    const assertReadOnlyTool = (toolName: string): void => {
      this.handoffEngine.assertToolAllowedForThread(reviewThreadId, toolName);
    };

    assertReadOnlyTool("git_diff");
    assertReadOnlyTool("read_file");

    const heuristicFindings = analyzeDiffStaticRisks(
      stageB.diff,
      stageB.changedFiles,
      stageB.testPassed
    );

    const oracleReviewer = runOptions?.oracleReviewer ?? this.oracleReviewer;
    let customComments: string[] = [];
    let reviewTokenStats: Partial<MorningReportTokenStats> | undefined;

    if (oracleReviewer !== undefined) {
      const reviewResult = await oracleReviewer({
        jobId,
        reviewThreadId,
        codingThreadId: stageA.handoff.newThreadId,
        branchName: stageA.branchName,
        worktreePath: stageA.worktreePath,
        diff: stageB.diff,
        changedFiles: stageB.changedFiles,
        testCommand: stageA.repoTarget.testCommand,
        testOutput: stageB.testOutput,
        testPassed: stageB.testPassed,
        handoff: reviewHandoff,
        heuristicFindings,
        assertReadOnlyTool
      });

      if (Array.isArray(reviewResult)) {
        customComments = reviewResult;
      } else {
        customComments = reviewResult.comments;
        reviewTokenStats = reviewResult.tokenStats;
      }
    }

    const mergedComments: string[] = [];
    const seen = new Set<string>();
    const appendComment = (item: string) => {
      const cleaned = item.trim();
      if (cleaned.length === 0) {
        return;
      }
      if (!seen.has(cleaned)) {
        seen.add(cleaned);
        mergedComments.push(cleaned);
      }
    };

    for (const c of customComments) {
      appendComment(c);
    }
    for (const h of heuristicFindings) {
      if (customComments.length > 0 && h.startsWith("[Review OK]")) {
        continue;
      }
      appendComment(h);
    }

    return {
      reviewThreadId,
      reviewComments: mergedComments,
      ...(reviewTokenStats !== undefined ? { reviewTokenStats } : {})
    };
  }

  private async runStageD(
    jobId: string,
    startedAt: number,
    email: InboundEmailMessage,
    stageA: {
      repoSlug: string;
      repoTarget: FactoryRepoTarget;
      branchName: string;
      handoff: HandoffExecutionResult;
    },
    stageB: {
      commitSha: string;
      diff: string;
      changedFiles: FactoryChangedFileStat[];
      testOutput: string;
      testPassed: boolean;
      codingSummary?: string;
      tokenStats?: Partial<MorningReportTokenStats>;
    },
    stageC: {
      reviewThreadId: string;
      reviewComments: string[];
      reviewTokenStats?: Partial<MorningReportTokenStats>;
    },
    runOptions?: FactoryRunOptions,
    backdoorMeta?: {
      artifact?: DispatchTaskArtifact;
      oracleReviewSkipped?: boolean;
    }
  ): Promise<{
    stopHookResult: HookDispatchResult;
    tokenStats: MorningReportTokenStats;
    report: FactoryMorningReport;
    reportHtml: string;
    mailReceipt?: OutboundMailReceipt;
    notification?: FactoryPluginNotification;
  }> {
    const completedAt = this.now();
    const deepLink = buildReviewDeepLink(stageC.reviewThreadId);
    const summary = extractSummarySentence(
      stageB.codingSummary,
      stageA.handoff,
      stageB.changedFiles,
      stageB.testPassed
    );

    const tokenStats = this.mergeTokenStats(
      stageB.tokenStats,
      stageC.reviewTokenStats
    );

    const stopHookResult = await this.hookBus.emit({
      event: "Stop",
      sessionId: `factory-sess-${jobId}`,
      threadId: stageC.reviewThreadId,
      permissionMode: "auto",
      toolName: "overnight_factory_report",
      toolInput: {
        jobId,
        branchName: stageA.branchName,
        commitSha: stageB.commitSha,
        changedFilesCount: stageB.changedFiles.length,
        testPassed: stageB.testPassed
      },
      toolOutput: {
        summary,
        deepLink,
        tokenStats
      },
      timestamp: completedAt
    });

    if (stopHookResult.decision === "block") {
      throw new Error(
        stopHookResult.feedback ??
          `Stop hook blocked OvernightFactory report delivery for job "${jobId}".`
      );
    }

    const report: FactoryMorningReport = {
      jobId,
      threadId: stageC.reviewThreadId,
      branchName: stageA.branchName,
      summary,
      changedFilesCount: stageB.changedFiles.length,
      reviewComments: stageC.reviewComments,
      deepLink,
      emailSubject: email.subject,
      repoName: stageA.repoSlug,
      commitSha: stageB.commitSha,
      changedFiles: stageB.changedFiles,
      diff: stageB.diff,
      testCommand: stageA.repoTarget.testCommand,
      testOutput: stageB.testOutput,
      testPassed: stageB.testPassed,
      tokenStats,
      ...(backdoorMeta?.artifact !== undefined
        ? { artifact: backdoorMeta.artifact }
        : {}),
      ...(backdoorMeta?.oracleReviewSkipped !== undefined
        ? { oracleReviewSkipped: backdoorMeta.oracleReviewSkipped }
        : {}),
      completedAt,
      durationMs: Math.max(0, completedAt - startedAt)
    };

    const reportHtml = this.renderMorningReportHtml(report);

    const mailer = runOptions?.outboundMailer ?? this.outboundMailer;
    let mailReceipt: OutboundMailReceipt | undefined;
    if (mailer !== undefined) {
      const recipient =
        runOptions?.reportRecipient ?? extractEmailAddressOnly(email.from);
      if (recipient.length > 0) {
        mailReceipt = await mailer.send({
          to: [recipient],
          subject: `[${BRAND.appName} 夜间工场早报] ${email.subject}`,
          html: reportHtml,
          text: [
            `${BRAND.appName} 夜间工场完工早报`,
            `成果总结：${report.summary}`,
            `交付分支：${report.branchName} (${stageB.commitSha})`,
            `变更文件数：${report.changedFilesCount}`,
            `Oracle 评语：\n${report.reviewComments.map((c) => `- ${c}`).join("\n")}`,
            `Token 消耗：${tokenStats.totalTokens}（估算 $${tokenStats.estimatedCostUsd.toFixed(4)}）`,
            `工作台审阅深链：${deepLink}`
          ].join("\n\n"),
          inReplyTo: email.messageId,
          references: [email.messageId],
          threadId: report.threadId
        });
      }
    }

    const notifyPlugins =
      runOptions?.onNotifyPlugins ?? this.onNotifyPlugins;
    let notification: FactoryPluginNotification | undefined;
    if (notifyPlugins !== undefined) {
      const islandCard: IslandHookEvent = {
        cardId: `island-factory-${jobId}`,
        kind: "factory_complete",
        title: `${BRAND.appName} 夜间工场完工 · ${stageA.repoSlug}`,
        subtitle: report.summary,
        deepLink,
        actions: ["open_workbench", "dismiss"],
        createdAt: completedAt
      };
      notification = {
        jobId,
        threadId: report.threadId,
        branchName: report.branchName,
        title: islandCard.title,
        summary: report.summary,
        changedFilesCount: report.changedFilesCount,
        testPassed: stageB.testPassed,
        reviewComments: [...report.reviewComments],
        deepLink,
        estimatedCostUsd: tokenStats.estimatedCostUsd,
        totalTokens: tokenStats.totalTokens,
        islandCard,
        shortMessage: `【${BRAND.appName} 早报】${report.summary} | 分支 ${report.branchName} | ${deepLink}`
      };
      await notifyPlugins(notification);
    }

    return {
      stopHookResult,
      tokenStats,
      report,
      reportHtml,
      ...(mailReceipt !== undefined ? { mailReceipt } : {}),
      ...(notification !== undefined ? { notification } : {})
    };
  }

  private mergeTokenStats(
    codingStats?: Partial<MorningReportTokenStats>,
    reviewStats?: Partial<MorningReportTokenStats>
  ): MorningReportTokenStats {
    const inputTokens =
      (codingStats?.inputTokens ?? 0) + (reviewStats?.inputTokens ?? 0);
    const outputTokens =
      (codingStats?.outputTokens ?? 0) + (reviewStats?.outputTokens ?? 0);
    const explicitTotal =
      (codingStats?.totalTokens ?? 0) + (reviewStats?.totalTokens ?? 0);
    const totalTokens =
      explicitTotal > 0 ? explicitTotal : inputTokens + outputTokens;
    const estimatedCostUsd =
      (codingStats?.estimatedCostUsd ?? 0) +
      (reviewStats?.estimatedCostUsd ?? 0);

    const model = codingStats?.model ?? reviewStats?.model;
    const provider = codingStats?.provider ?? reviewStats?.provider;
    return {
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd,
      ...(model !== undefined ? { model } : {}),
      ...(provider !== undefined ? { provider } : {})
    };
  }

  private runGit(cwd: string, args: string[]): string {
    return execFileSync("git", args, {
      cwd,
      env: sanitizeChildEnv(process.env),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    });
  }

  private buildGitCommitArgs(worktreePath: string, message: string): string[] {
    let hasName = false;
    let hasEmail = false;
    try {
      hasName =
        this.runGit(worktreePath, ["config", "user.name"]).trim().length > 0;
    } catch {
      hasName = false;
    }
    try {
      hasEmail =
        this.runGit(worktreePath, ["config", "user.email"]).trim().length > 0;
    } catch {
      hasEmail = false;
    }

    const args: string[] = [];
    if (!hasName) {
      args.push("-c", `user.name=${BRAND.appName} Overnight Factory`);
    }
    if (!hasEmail) {
      args.push("-c", `user.email=factory@${BRAND.appSlug}.local`);
    }
    args.push("commit", "-m", message);
    return args;
  }

  private collectGitChangedPaths(worktreePath: string): string[] {
    const raw = execFileSync(
      "git",
      ["-c", "core.quotePath=false", "status", "--porcelain=v1", "-z", "-uall"],
      {
        cwd: worktreePath,
        env: sanitizeChildEnv(process.env),
        encoding: "utf8",
        windowsHide: true
      }
    );

    const tokens = raw.split("\0").filter((t) => t.length > 0);
    const files: string[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const entry = tokens[i]!;
      if (entry.length < 4) {
        continue;
      }
      const statusCode = entry.slice(0, 2);
      const filePath = entry.slice(3);
      if (filePath.length > 0) {
        files.push(filePath);
      }
      // Renamed or copied porcelain -z entries have an extra old-path token immediately after.
      if (statusCode.includes("R") || statusCode.includes("C")) {
        i += 1;
      }
    }
    return [...new Set(files)];
  }

  private collectDiffStats(worktreePath: string): FactoryChangedFileStat[] {
    const numstatRaw = this.runGit(worktreePath, [
      "diff",
      "--numstat",
      "HEAD~1"
    ]);
    const nameStatusRaw = this.runGit(worktreePath, [
      "diff",
      "--name-status",
      "HEAD~1"
    ]);

    const statusByPath = new Map<string, FactoryChangedFileStat["status"]>();
    for (const line of nameStatusRaw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const parts = trimmed.split("\t");
      const code = parts[0]?.[0] ?? "M";
      const filePath = parts[parts.length - 1] ?? "";
      if (filePath.length === 0) {
        continue;
      }
      const mapped: FactoryChangedFileStat["status"] =
        code === "A"
          ? "added"
          : code === "D"
            ? "deleted"
            : code === "R"
              ? "renamed"
              : "modified";
      statusByPath.set(filePath, mapped);
    }

    const stats: FactoryChangedFileStat[] = [];
    for (const line of numstatRaw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const parts = trimmed.split("\t");
      if (parts.length < 3) {
        continue;
      }
      const addStr = parts[0]!;
      const delStr = parts[1]!;
      const filePath = parts.slice(2).join("\t");
      const additions = /^\d+$/.test(addStr) ? Number.parseInt(addStr, 10) : 0;
      const deletions = /^\d+$/.test(delStr) ? Number.parseInt(delStr, 10) : 0;
      stats.push({
        path: filePath,
        status: statusByPath.get(filePath) ?? "modified",
        additions,
        deletions
      });
    }
    return stats;
  }

  private removeWorktree(repoPath: string, worktreePath: string): void {
    try {
      this.runGit(repoPath, ["worktree", "remove", "--force", worktreePath]);
    } finally {
      if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true });
      }
      try {
        this.runGit(repoPath, ["worktree", "prune"]);
      } catch {
        // Ignore prune failures.
      }
    }
  }

  private async executeSandboxedCommand(
    command: string,
    cwd: string,
    env: Record<string, string>,
    timeoutMs: number
  ): Promise<FactoryCommandResult> {
    const hasShellMeta = /[|&;<>`$\n]/.test(command);
    let executable = command;
    let args: string[] = [];
    let useShell = hasShellMeta;

    if (!hasShellMeta) {
      const parsed = splitCommandLine(command);
      if (parsed.length === 0 || parsed[0] === undefined) {
        throw new Error("Command line cannot be empty.");
      }
      executable = parsed[0];
      args = parsed.slice(1);
      if (
        process.platform === "win32" &&
        isAbsolute(executable) &&
        !existsSync(executable)
      ) {
        let candidate = executable;
        for (let i = 1; i < parsed.length; i += 1) {
          candidate = `${candidate} ${parsed[i]!}`;
          if (existsSync(candidate)) {
            executable = candidate;
            args = parsed.slice(i + 1);
            break;
          }
        }
      }
      if (
        process.platform === "win32" &&
        (/\.(?:cmd|bat)$/i.test(executable) ||
          ["npm", "pnpm", "npx", "yarn"].includes(executable.toLowerCase()))
      ) {
        useShell = true;
        executable = command;
        args = [];
      }
    }

    const childEnv: Record<string, string> = { ...env };
    // Prevent Node's `node --test` recursion guard from silently skipping isolated worktree tests
    // when OvernightFactory itself is executed inside a parent `node --test` process.
    delete childEnv.NODE_TEST_CONTEXT;

    return new Promise<FactoryCommandResult>((resolveResult, rejectResult) => {
      let settled = false;
      let stdout = "";
      let stderr = "";
      const stdoutDec = new StringDecoder("utf8");
      const stderrDec = new StringDecoder("utf8");

      const child = spawn(executable, args, {
        cwd,
        env: childEnv,
        shell: useShell,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          child.kill("SIGTERM");
        } catch {
          // Ignore kill failures.
        }
        rejectResult(
          new Error(`Command timed out after ${timeoutMs}ms: ${command}`)
        );
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : stdoutDec.write(chunk);
        if (stdout.length < 512 * 1024) {
          stdout += text;
        }
      });

      child.stderr?.on("data", (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : stderrDec.write(chunk);
        if (stderr.length < 512 * 1024) {
          stderr += text;
        }
      });

      child.once("error", (err: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        rejectResult(err);
      });

      child.once("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        stdout += stdoutDec.end();
        stderr += stderrDec.end();
        const combinedOutput = [stdout.trim(), stderr.trim()]
          .filter((s) => s.length > 0)
          .join("\n");
        resolveResult({
          exitCode: code ?? 1,
          stdout,
          stderr,
          combinedOutput
        });
      });
    });
  }

  private renderDiffHtmlBlock(rawDiff: string | undefined): string {
    if (rawDiff === undefined || rawDiff.trim().length === 0) {
      return `<div style="padding:12px 14px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;color:#57606a;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;">（无代码 Diff 内容）</div>`;
    }

    const lines = rawDiff.replace(/\r\n?/g, "\n").split("\n");
    const maxLines = 400;
    const truncated = lines.length > maxLines;
    const visibleLines = truncated ? lines.slice(0, maxLines) : lines;

    const renderedLines = visibleLines.map((line) => {
      const escaped = line.length > 0 ? escapeHtml(line) : "&nbsp;";
      if (line.startsWith("+++") || line.startsWith("---")) {
        return `<div style="padding:1px 10px;background:#f6f8fa;color:#57606a;font-weight:600;white-space:pre-wrap;word-break:break-all;">${escaped}</div>`;
      }
      if (line.startsWith("diff --git") || line.startsWith("index ")) {
        return `<div style="padding:2px 10px;background:#f1f5f9;color:#475569;font-weight:600;border-top:1px solid #e2e8f0;white-space:pre-wrap;word-break:break-all;">${escaped}</div>`;
      }
      if (line.startsWith("@@")) {
        return `<div style="padding:2px 10px;background:#ddf4ff;color:#0550ae;font-weight:600;white-space:pre-wrap;word-break:break-all;">${escaped}</div>`;
      }
      if (line.startsWith("+")) {
        return `<div data-diff="add" style="padding:1px 10px;background:#dafbe1;color:#116329;white-space:pre-wrap;word-break:break-all;">${escaped}</div>`;
      }
      if (line.startsWith("-")) {
        return `<div data-diff="del" style="padding:1px 10px;background:#ffebe9;color:#cf222e;white-space:pre-wrap;word-break:break-all;">${escaped}</div>`;
      }
      return `<div style="padding:1px 10px;background:#ffffff;color:#24292f;white-space:pre-wrap;word-break:break-all;">${escaped}</div>`;
    });

    if (truncated) {
      renderedLines.push(
        `<div style="padding:6px 10px;background:#f6f8fa;color:#57606a;font-style:italic;">... 已截断其余 ${lines.length - maxLines} 行 Diff</div>`
      );
    }

    return `<div style="border:1px solid #d0d7de;border-radius:8px;overflow:hidden;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.55;">${renderedLines.join("")}</div>`;
  }

  private renderDraftConfirmationHtml(input: {
    jobId: string;
    subject: string;
    branchName: string;
    worktreePath: string;
    memoryContextSummary?: string;
    deepLink: string;
    reason: string;
  }): string {
    const safeAppName = escapeHtml(BRAND.appName);
    const safeSubject = escapeHtml(input.subject);
    const safeJobId = escapeHtml(input.jobId);
    const safeBranch = escapeHtml(input.branchName);
    const safeWorktree = escapeHtml(input.worktreePath);
    const safeReason = escapeHtml(input.reason);
    const safeDeepLink = escapeHtml(input.deepLink);
    const safeMemory = input.memoryContextSummary
      ? escapeHtml(input.memoryContextSummary)
      : "（未命中额外记忆条目）";

    return [
      `<!doctype html>`,
      `<html lang="zh-CN">`,
      `<head><meta charset="utf-8"><title>${safeAppName} 个人版 AGY 草稿待确认</title></head>`,
      `<body style="margin:0;padding:24px 12px;background:#f4f6fb;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;">`,
      `<div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #f59e0b;border-radius:14px;overflow:hidden;">`,
      `<div style="padding:20px 24px;background:#fffbeb;border-bottom:1px solid #fde68a;">`,
      `<div style="font-size:12px;font-weight:700;color:#b45309;">${safeAppName} · 个人版 Antigravity（AGY）硬锁定安全拦截</div>`,
      `<h1 style="margin:6px 0 0 0;font-size:18px;color:#78350f;">任务已就位至 Draft-Only 草稿，等待本人桌面端确认放行</h1>`,
      `</div>`,
      `<div style="padding:20px 24px;font-size:14px;line-height:1.65;color:#1e293b;">`,
      `<p style="margin:0 0 12px 0;">${safeReason}</p>`,
      `<ul style="margin:0 0 16px 0;padding-left:20px;">`,
      `<li><strong>原始主题：</strong>${safeSubject}</li>`,
      `<li><strong>任务 ID：</strong><code>${safeJobId}</code></li>`,
      `<li><strong>隔离分支：</strong><code>${safeBranch}</code></li>`,
      `<li><strong>Worktree 目录：</strong><code>${safeWorktree}</code></li>`,
      `<li><strong>已召回记忆：</strong>${safeMemory}</li>`,
      `</ul>`,
      `<div style="padding:14px 16px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;text-align:center;">`,
      `<div style="margin-bottom:8px;font-size:13px;color:#334155;">请回到桌面端确认草稿内容后手动点击「确认放行并发送」</div>`,
      `<a href="${safeDeepLink}" style="display:inline-block;padding:10px 18px;background:#d97706;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">在 ${safeAppName} 桌面端确认放行</a>`,
      `</div>`,
      `</div>`,
      `</div>`,
      `</body>`,
      `</html>`
    ].join("\n");
  }

  /**
   * Renders an XSS-safe, email-client-compatible minimalist HTML morning report containing all 7 required sections.
   */
  renderMorningReportHtml(report: FactoryMorningReport): string {
    const safeAppName = escapeHtml(BRAND.appName);
    const safeJobId = escapeHtml(report.jobId);
    const safeThreadId = escapeHtml(report.threadId);
    const safeBranchName = escapeHtml(report.branchName);
    const safeSummary = escapeHtml(report.summary);
    const safeDeepLinkUrl = sanitizeDeepLinkUrl(
      report.deepLink,
      report.threadId
    );
    const safeDeepLink = escapeHtml(safeDeepLinkUrl);
    const safeRepoName = escapeHtml(report.repoName ?? "Workspace");
    const safeCommitSha =
      report.commitSha !== undefined
        ? escapeHtml(report.commitSha.slice(0, 12))
        : "";
    const safeTestCommand =
      report.testCommand !== undefined
        ? escapeHtml(report.testCommand)
        : "（未指定测试命令）";
    const safeTestOutput = escapeHtml(
      report.testOutput !== undefined && report.testOutput.trim().length > 0
        ? report.testOutput
        : "（无单测输出记录）"
    );

    const testBadgeBg =
      report.testPassed === false
        ? "#ffebe9"
        : report.testPassed === true
          ? "#dafbe1"
          : "#f1f5f9";
    const testBadgeFg =
      report.testPassed === false
        ? "#cf222e"
        : report.testPassed === true
          ? "#116329"
          : "#475569";
    const testBadgeLabel =
      report.testPassed === false
        ? "FAILED"
        : report.testPassed === true
          ? "PASSED"
          : "PENDING";

    const changedFiles = report.changedFiles ?? [];
    const totalAdditions = changedFiles.reduce(
      (sum, f) => sum + f.additions,
      0
    );
    const totalDeletions = changedFiles.reduce(
      (sum, f) => sum + f.deletions,
      0
    );

    const fileRowsHtml =
      changedFiles.length > 0
        ? changedFiles
            .map((file) => {
              const safePath = escapeHtml(file.path);
              const safeStatus = escapeHtml(file.status.toUpperCase());
              return [
                `<tr>`,
                `<td style="padding:8px 12px;border-top:1px solid #e2e8f0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:#0f172a;word-break:break-all;">${safePath}</td>`,
                `<td style="padding:8px 12px;border-top:1px solid #e2e8f0;font-size:12px;color:#475569;">${safeStatus}</td>`,
                `<td style="padding:8px 12px;border-top:1px solid #e2e8f0;font-family:ui-monospace,monospace;font-size:12px;color:#116329;text-align:right;">+${file.additions}</td>`,
                `<td style="padding:8px 12px;border-top:1px solid #e2e8f0;font-family:ui-monospace,monospace;font-size:12px;color:#cf222e;text-align:right;">-${file.deletions}</td>`,
                `</tr>`
              ].join("");
            })
            .join("")
        : `<tr><td colspan="4" style="padding:10px 12px;border-top:1px solid #e2e8f0;color:#475569;font-size:13px;">共修改 ${report.changedFilesCount} 个文件</td></tr>`;

    const reviewItems =
      report.reviewComments.length > 0
        ? report.reviewComments
        : ["（暂无额外 Oracle 审阅意见）"];
    const reviewListHtml = reviewItems
      .map(
        (comment) =>
          `<li style="margin:0 0 8px 0;padding:8px 12px;background:#f8fafc;border-left:3px solid #2563eb;border-radius:4px;color:#1e293b;font-size:13px;line-height:1.55;">${escapeHtml(comment)}</li>`
      )
      .join("");

    const tokenStats: MorningReportTokenStats = report.tokenStats ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0
    };
    const modelLine =
      tokenStats.model !== undefined
        ? ` · 模型 ${escapeHtml(tokenStats.model)}`
        : "";

    const diffBlockHtml = this.renderDiffHtmlBlock(report.diff);

    return [
      `<!doctype html>`,
      `<html lang="zh-CN">`,
      `<head>`,
      `<meta charset="utf-8">`,
      `<meta name="viewport" content="width=device-width,initial-scale=1">`,
      `<title>${safeAppName} 夜间工场完工早报</title>`,
      `</head>`,
      `<body style="margin:0;padding:24px 12px;background:#f4f6fb;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;">`,
      `<div style="max-width:780px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.06);">`,
      // Header
      `<div style="padding:22px 26px;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#f8fafc;">`,
      `<div style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#93c5fd;font-weight:600;">${safeAppName} Overnight Factory · ${safeRepoName}</div>`,
      `<h1 style="margin:6px 0 10px 0;font-size:20px;line-height:1.35;font-weight:700;color:#ffffff;">夜间全自动工场完工早报</h1>`,
      `<div style="font-size:12px;color:#cbd5e1;line-height:1.6;">`,
      `<span>任务 ID：<code style="color:#e2e8f0;">${safeJobId}</code></span>`,
      ` · <span>线程：<code style="color:#e2e8f0;">${safeThreadId}</code></span>`,
      ` · <span>交付分支：<code style="color:#86efac;">${safeBranchName}</code></span>`,
      safeCommitSha.length > 0
        ? ` · <span>Commit：<code style="color:#e2e8f0;">${safeCommitSha}</code></span>`
        : "",
      `</div>`,
      `</div>`,
      // Body container
      `<div style="padding:22px 26px;">`,
      // 1. One-sentence summary
      `<section style="margin-bottom:20px;">`,
      `<h2 style="margin:0 0 8px 0;font-size:14px;color:#334155;letter-spacing:0.02em;">1. 一句话成果总结</h2>`,
      `<div style="padding:14px 16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;font-size:14px;line-height:1.6;color:#1e3a8a;font-weight:500;">${safeSummary}</div>`,
      `</section>`,
      // 2. Changed files table
      `<section style="margin-bottom:20px;">`,
      `<h2 style="margin:0 0 8px 0;font-size:14px;color:#334155;">2. 修改文件统计（${report.changedFilesCount} 个文件 · <span style="color:#116329;">+${totalAdditions}</span> / <span style="color:#cf222e;">-${totalDeletions}</span>）</h2>`,
      `<table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">`,
      `<thead><tr style="background:#f8fafc;text-align:left;font-size:12px;color:#475569;">`,
      `<th style="padding:8px 12px;font-weight:600;">文件路径</th>`,
      `<th style="padding:8px 12px;font-weight:600;">状态</th>`,
      `<th style="padding:8px 12px;font-weight:600;text-align:right;">新增</th>`,
      `<th style="padding:8px 12px;font-weight:600;text-align:right;">删除</th>`,
      `</tr></thead>`,
      `<tbody>${fileRowsHtml}</tbody>`,
      `</table>`,
      `</section>`,
      // 3. Colorized Diff block
      `<section style="margin-bottom:20px;">`,
      `<h2 style="margin:0 0 8px 0;font-size:14px;color:#334155;">3. 关键 Diff 高亮（绿 + / 红 -）</h2>`,
      diffBlockHtml,
      `</section>`,
      // 4. Full unit test output
      `<section style="margin-bottom:20px;">`,
      `<h2 style="margin:0 0 8px 0;font-size:14px;color:#334155;">4. 单测完整输出 <span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;background:${testBadgeBg};color:${testBadgeFg};font-size:11px;font-weight:700;">${testBadgeLabel}</span></h2>`,
      `<div style="margin-bottom:6px;font-size:12px;color:#475569;">命令：<code>${safeTestCommand}</code></div>`,
      `<pre style="margin:0;padding:12px 14px;background:#0f172a;color:#e2e8f0;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;overflow-x:auto;white-space:pre-wrap;word-break:break-word;">${safeTestOutput}</pre>`,
      `</section>`,
      // 5. Oracle review comments
      `<section style="margin-bottom:20px;">`,
      `<h2 style="margin:0 0 8px 0;font-size:14px;color:#334155;">5. Oracle 只读审阅评语</h2>`,
      `<ul style="list-style:none;margin:0;padding:0;">${reviewListHtml}</ul>`,
      `</section>`,
      // 6. Token consumption & estimated cost
      `<section style="margin-bottom:22px;">`,
      `<h2 style="margin:0 0 8px 0;font-size:14px;color:#334155;">6. Token 消耗与估算成本${modelLine}</h2>`,
      `<table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;"><tr>`,
      `<td style="padding:10px 14px;width:25%;border-right:1px solid #e2e8f0;"><div style="font-size:11px;color:#64748b;">输入 Tokens</div><div style="font-size:15px;font-weight:700;color:#0f172a;">${tokenStats.inputTokens.toLocaleString("en-US")}</div></td>`,
      `<td style="padding:10px 14px;width:25%;border-right:1px solid #e2e8f0;"><div style="font-size:11px;color:#64748b;">输出 Tokens</div><div style="font-size:15px;font-weight:700;color:#0f172a;">${tokenStats.outputTokens.toLocaleString("en-US")}</div></td>`,
      `<td style="padding:10px 14px;width:25%;border-right:1px solid #e2e8f0;"><div style="font-size:11px;color:#64748b;">总计 Tokens</div><div style="font-size:15px;font-weight:700;color:#0f172a;">${tokenStats.totalTokens.toLocaleString("en-US")}</div></td>`,
      `<td style="padding:10px 14px;width:25%;"><div style="font-size:11px;color:#64748b;">估算成本 (USD)</div><div style="font-size:15px;font-weight:700;color:#0369a1;">$${tokenStats.estimatedCostUsd.toFixed(4)}</div></td>`,
      `</tr></table>`,
      `</section>`,
      // 7. One-click deep link CTA
      `<section style="padding:16px 18px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;text-align:center;">`,
      `<div style="margin-bottom:10px;font-size:13px;color:#334155;">7. 一键唤醒桌面工作台审阅并合并分支 <code>${safeBranchName}</code></div>`,
      `<a href="${safeDeepLink}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">在 ${safeAppName} 中审阅合并</a>`,
      `<div style="margin-top:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:#64748b;word-break:break-all;">${safeDeepLink}</div>`,
      `</section>`,
      `</div>`,
      `</div>`,
      `</body>`,
      `</html>`
    ].join("\n");
  }
}
