import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTls from "node:tls";
import * as NodeUtil from "node:util";
import process from "node:process";
import type { EncryptedPluginCredentialStore } from "@prismux/cordis-kernel";
import type { SqliteMemoryStore } from "@prismux/memory-core";
import {
  BRAND,
  isAntigravityProvider,
  type CallerScope,
  type DispatchCallerKind,
} from "@prismux/protocol";
import type { ChiefThreadManager } from "../chief/ChiefThreadManager.js";
import type { DesktopIpcDispatchHub } from "../dispatch/DesktopIpcDispatchHub.js";
import {
  AntigravityGuardDeniedError,
  type AntigravityPolicyGuard,
} from "../security/AntigravityPolicyGuard.js";
import {
  buildSafeCliSpawnSpec,
  decodeWindowsProcessOutput,
  findExecutableOnPath,
  refreshWindowsEnvironmentFromRegistry,
} from "../system/WindowsEnvRefresh.js";
import {
  GmailOAuth2InboundAdapter,
  ImapIdleInboundAdapter,
  OvernightFactory,
  OvernightTaskCancelledError,
  buildReviewDeepLink,
  createDefaultOvernightCodingExecutor,
  escapeHtml,
  matchesFactoryTrigger,
  type FactoryChangedFileStat,
  type FactoryInboundMode,
  type FactoryMorningReport,
  type InboundEmailMessage,
  type MailInboundAdapter,
  type OutboundMailPayload,
  type OutboundMailReceipt,
  type OutboundMailer,
  type OvernightExecutionStage,
  type OvernightSecretaryBrain,
} from "../workflows/OvernightFactory.js";
import { BusinessRouteError } from "./DaemonBusinessRoutes.js";

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);

export const OVERNIGHT_CREDENTIAL_BUCKET = "overnight-factory" as const;
const OVERNIGHT_CONFIG_FILENAME = "overnight-factory.json" as const;
const OVERNIGHT_RUNS_FILENAME = "overnight-factory-runs.json" as const;
const OVERNIGHT_TASKS_FILENAME = "overnight-factory-tasks.json" as const;
const MAX_PERSISTED_RUNS = 100;
const MAX_PERSISTED_TASKS = 100;
const MAX_LOGS_PER_RUN = 160;
const OAUTH_STATE_TTL_MS = 10 * 60_000;
const AGENT_MAIL_PROBE_CACHE_TTL_MS = 15_000;
const AGENT_MAIL_SNAPSHOT_PROBE_TIMEOUT_MS = 8_000;
const AGENT_MAIL_STATUS_TIMEOUT_MS = 10_000;
const AGENT_MAIL_INSTALL_TIMEOUT_MS = 120_000;
const AGENT_MAIL_LOGIN_URL_WAIT_MS = 12_000;
const AGENT_MAIL_LOGIN_MAX_LIFETIME_MS = 5 * 60_000;
const AGENT_MAIL_CLI_OP_TIMEOUT_MS = 25_000;

export const AGENT_MAIL_CLI_COMMAND = "agently-cli" as const;
export const AGENT_MAIL_NPM_PACKAGE = "@tencent-qqmail/agently-cli" as const;
export const AGENT_MAIL_PORTAL_URL = "https://agent.qq.com/page" as const;
export const AGENT_MAIL_DOC_URL = "https://agent.qq.com/doc/cli-setup.md" as const;

export type OvernightEmailProvider = "imap_smtp" | "gmail_oauth2" | "agent_mail";
export type OvernightNeteaseDomain = "163.com" | "126.com" | "yeah.net";
export type OvernightCanonicalMailPresetId =
  | "gmail"
  | "qq"
  | "agent_mail"
  | "outlook"
  | "netease"
  | "custom";
/** Includes legacy `"163"` and `"126"` aliases for backwards-compatible persistence. */
export type OvernightMailPresetId = OvernightCanonicalMailPresetId | "163" | "126";
export type OvernightAgentMailAction = "status" | "install" | "login";
export type OvernightWindowMode = "scheduled" | "always";
export type OvernightRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked_whitelist"
  | "blocked_policy"
  | "awaiting_human_confirmation"
  | "skipped";

export interface OvernightMailPresetSpec {
  readonly id: OvernightCanonicalMailPresetId;
  readonly label: string;
  readonly imapHost: string;
  readonly imapPort: number;
  readonly imapSecure: boolean;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpSecure: boolean;
}

export const OVERNIGHT_MAIL_PRESET_ORDER: readonly OvernightCanonicalMailPresetId[] = [
  "gmail",
  "qq",
  "agent_mail",
  "outlook",
  "netease",
  "custom",
] as const;

export const NETEASE_MAIL_DOMAIN_HOSTS: Readonly<
  Record<
    OvernightNeteaseDomain,
    {
      readonly imapHost: string;
      readonly imapPort: number;
      readonly imapSecure: boolean;
      readonly smtpHost: string;
      readonly smtpPort: number;
      readonly smtpSecure: boolean;
    }
  >
> = {
  "163.com": {
    imapHost: "imap.163.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.163.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  "126.com": {
    imapHost: "imap.126.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.126.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  "yeah.net": {
    imapHost: "imap.yeah.net",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.yeah.net",
    smtpPort: 465,
    smtpSecure: true,
  },
};

export const OVERNIGHT_MAIL_PRESETS: Readonly<
  Record<OvernightCanonicalMailPresetId, OvernightMailPresetSpec>
> = {
  gmail: {
    id: "gmail",
    label: "谷歌邮箱 (Gmail)",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  qq: {
    id: "qq",
    label: "QQ 邮箱",
    imapHost: "imap.qq.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.qq.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  agent_mail: {
    id: "agent_mail",
    label: "Agent 邮箱",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
  },
  outlook: {
    id: "outlook",
    label: "Outlook / Exchange",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false,
  },
  netease: {
    id: "netease",
    label: "网易邮箱（163 / 126）",
    imapHost: "imap.163.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.163.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  custom: {
    id: "custom",
    label: "自定义",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
  },
};

function isOvernightEmailProvider(value: unknown): value is OvernightEmailProvider {
  return value === "imap_smtp" || value === "gmail_oauth2" || value === "agent_mail";
}

function isOvernightAgentMailAction(value: unknown): value is OvernightAgentMailAction {
  return value === "status" || value === "install" || value === "login";
}

function isOvernightMailPresetId(value: unknown): value is OvernightMailPresetId {
  return (
    value === "gmail" ||
    value === "qq" ||
    value === "agent_mail" ||
    value === "outlook" ||
    value === "netease" ||
    value === "163" ||
    value === "126" ||
    value === "custom"
  );
}

export function detectNeteaseDomainFromEmail(email: string): OvernightNeteaseDomain | null {
  const normalized = extractEmailAddress(email);
  if (normalized.endsWith("@126.com")) return "126.com";
  if (normalized.endsWith("@163.com")) return "163.com";
  if (normalized.endsWith("@yeah.net")) return "yeah.net";
  return null;
}

export function normalizeOvernightMailPresetId(
  value: unknown,
  fallback: OvernightCanonicalMailPresetId,
): OvernightCanonicalMailPresetId {
  if (value === "163" || value === "126" || value === "netease") {
    return "netease";
  }
  if (
    value === "gmail" ||
    value === "qq" ||
    value === "agent_mail" ||
    value === "outlook" ||
    value === "custom"
  ) {
    return value;
  }
  return fallback;
}

export function resolveOvernightMailPresetSpec(
  rawPreset: OvernightMailPresetId,
  email?: string,
): OvernightMailPresetSpec {
  const canonical = normalizeOvernightMailPresetId(rawPreset, "qq");
  if (canonical === "netease") {
    const emailDomain = email ? detectNeteaseDomainFromEmail(email) : null;
    const domain: OvernightNeteaseDomain =
      rawPreset === "126" ? "126.com" : (emailDomain ?? "163.com");
    const hosts = NETEASE_MAIL_DOMAIN_HOSTS[domain];
    return {
      ...OVERNIGHT_MAIL_PRESETS.netease,
      ...hosts,
    };
  }
  return OVERNIGHT_MAIL_PRESETS[canonical];
}

const ANSI_ESCAPE_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

export function stripAnsiEscapes(raw: string): string {
  return raw.replace(ANSI_ESCAPE_RE, "");
}

export function sanitizeAgentMailOutput(raw: string, maxLength = 1200): string {
  const cleaned = stripAnsiEscapes(raw)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(token|secret|password|authorization)(\s*[=:]\s*)([^\s"'&,;]+)/gi, "$1$2[REDACTED]")
    .trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength)}...`;
}

/**
 * Extracts the exact, unmodified opaque OAuth URL printed by `agently-cli auth login`.
 * Never URL-encodes, decodes, or re-serializes the captured string.
 */
export function extractOpaqueOAuthUrl(rawOutput: string): string | null {
  const cleaned = stripAnsiEscapes(rawOutput);
  const match = /https:\/\/[^\s"'<>`\r\n\u0000-\u001f\u3000-\u303f\uff00-\uffef]+/.exec(cleaned);
  return match?.[0] ?? null;
}

function findEmailInJsonValue(value: unknown, depth = 0): string | null {
  if (depth > 4 || value === null || value === undefined) return null;
  if (typeof value === "string") {
    const agentMatch = /([a-zA-Z0-9._%+-]+@agent\.qq\.com)/i.exec(value);
    if (agentMatch?.[1]) return agentMatch[1].toLowerCase();
    const genericMatch = /^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/.exec(value.trim());
    return genericMatch?.[1]?.toLowerCase() ?? null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findEmailInJsonValue(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const priorityKeys = ["email", "address", "mail", "account", "user", "data", "aliases"];
    for (const key of priorityKeys) {
      if (key in record) {
        const found = findEmailInJsonValue(record[key], depth + 1);
        if (found) return found;
      }
    }
    for (const val of Object.values(record)) {
      const found = findEmailInJsonValue(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Extracts and parses the first valid JSON object or array from CLI stdout/stderr
 * that may contain leading/trailing non-JSON lines (such as `tip: agently-cli message +list`).
 */
export function extractJsonFromCliOutput(rawOutput: string): unknown | null {
  const cleaned = stripAnsiEscapes(rawOutput).trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    // Strip trailing `tip: ...` or surrounding log lines and scan balanced JSON payload.
  }

  const firstObj = cleaned.indexOf("{");
  const firstArr = cleaned.indexOf("[");
  let start = -1;
  if (firstObj >= 0 && firstArr >= 0) {
    start = Math.min(firstObj, firstArr);
  } else {
    start = Math.max(firstObj, firstArr);
  }
  if (start < 0) return null;

  const openChar = cleaned[start];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        const candidate = cleaned.slice(start, i + 1);
        try {
          return JSON.parse(candidate) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function extractAgentMailVersion(rawOutput: string): string | null {
  const cleaned = stripAnsiEscapes(rawOutput).trim();
  if (!cleaned) return null;
  const match = /\bv?(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?)\b/.exec(cleaned);
  return match?.[1] ?? null;
}

export interface AgentMailMeMetadata {
  email: string | null;
  scopes: string[];
  dailySendQuota: number | null;
}

export function parseAgentMailMeOutput(rawOutput: string): AgentMailMeMetadata {
  const parsed = extractJsonFromCliOutput(rawOutput);
  let email: string | null = null;
  let scopes: string[] = [];
  let dailySendQuota: number | null = null;

  if (isPlainRecord(parsed)) {
    const data = isPlainRecord(parsed["data"]) ? parsed["data"] : parsed;
    if (Array.isArray(data["aliases"])) {
      const aliases = data["aliases"].filter((entry): entry is Record<string, unknown> =>
        isPlainRecord(entry),
      );
      const primary = aliases.find((a) => a["is_primary"] === true) ?? aliases[0];
      if (primary && typeof primary["email"] === "string" && primary["email"].trim().length > 0) {
        email = primary["email"].trim().toLowerCase();
      }
    }
    if (!email) {
      email = findEmailInJsonValue(data);
    }
    if (Array.isArray(data["scopes"])) {
      scopes = data["scopes"]
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim());
    }
    if (isPlainRecord(data["rate_limits"])) {
      const rawQuota = data["rate_limits"]["daily_send_quota"];
      if (typeof rawQuota === "number" && Number.isFinite(rawQuota)) {
        dailySendQuota = rawQuota;
      }
    } else if (
      typeof data["daily_send_quota"] === "number" &&
      Number.isFinite(data["daily_send_quota"])
    ) {
      dailySendQuota = data["daily_send_quota"];
    }
  }

  if (!email) {
    email = extractAgentMailAddress(rawOutput);
  }
  return { email, scopes, dailySendQuota };
}

export function extractAgentMailAddress(rawOutput: string): string | null {
  const cleaned = stripAnsiEscapes(rawOutput).trim();
  if (!cleaned) return null;

  const directAgent = /([a-zA-Z0-9._%+-]+@agent\.qq\.com)/i.exec(cleaned);
  if (directAgent?.[1]) {
    return directAgent[1].toLowerCase();
  }

  const parsed = extractJsonFromCliOutput(cleaned);
  if (parsed !== null) {
    const fromJson = findEmailInJsonValue(parsed);
    if (fromJson) return fromJson;
  }

  const fallbackEmail = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/.exec(cleaned);
  return fallbackEmail?.[1]?.toLowerCase() ?? null;
}

export interface OvernightGmailConfig {
  clientId: string;
  redirectUri: string;
  boundEmail: string;
  connected: boolean;
  connectedAt: number | null;
  lastHistoryId?: string;
}

export interface OvernightImapSmtpConfig {
  preset: OvernightCanonicalMailPresetId;
  email: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string;
  mailbox: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  fromName: string;
  useSeparateSmtpPassword?: boolean;
}

export interface OvernightStrategyConfig {
  triggerTag: string;
  allowedSenders: string[];
  windowMode: OvernightWindowMode;
  windowStart: string;
  windowEnd: string;
  pollIntervalMinutes: number;
  targetWorkspaceDir: string;
  agentProvider: string;
  agentModel: string;
  secretaryBrain?: OvernightSecretaryBrain;
  oracleReviewEnabled: boolean;
  localWorktreeOnlyNoPush: boolean;
}

export interface OvernightFactoryPersistedConfig {
  schemaVersion: 1;
  updatedAt: number;
  enabled: boolean;
  mode: FactoryInboundMode;
  emailProvider: OvernightEmailProvider;
  agentMailAddress: string;
  testRecipient: string;
  gmail: OvernightGmailConfig;
  imapSmtp: OvernightImapSmtpConfig;
  strategy: OvernightStrategyConfig;
}

export interface OvernightAgentMailRuntimeSnapshot {
  cliInstalled: boolean;
  installed: boolean;
  version: string | null;
  cliPath?: string;
  binaryPath: string | null;
  loggedIn: boolean;
  authorizedEmail: string | null;
  address: string | null;
  configured: boolean;
  scopes?: string[];
  dailySendQuota?: number | null;
  authInProgress?: boolean;
  pendingAuthUrl?: string | null;
  lastError?: string | null;
}

export interface OvernightMailChannelStatusSummary {
  activeProvider: OvernightEmailProvider;
  configured: boolean;
  ready: boolean;
  address: string | null;
  inboundReady: boolean;
  outboundReady: boolean;
  detectedAgentMailReady: boolean;
  detectedAgentMailAddress: string | null;
  label: string;
  summary: string;
}

export interface OvernightSecretPresence {
  hasGmailClientSecret: boolean;
  hasGmailRefreshToken: boolean;
  hasImapPassword: boolean;
  hasSmtpPassword: boolean;
}

export interface OvernightMailProbeChannelResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  detail?: string;
  hint?: string;
}

export interface OvernightMailTestResult {
  ok: boolean;
  mode: FactoryInboundMode;
  emailProvider?: OvernightEmailProvider;
  checkedAt: number;
  durationMs: number;
  inbound: OvernightMailProbeChannelResult;
  outbound: OvernightMailProbeChannelResult;
  message: string;
  agentMailAction?: OvernightAgentMailAction;
  installed?: boolean;
  version?: string | null;
  cliPath?: string;
  binaryPath?: string | null;
  loggedIn?: boolean;
  configured?: boolean;
  authorizedEmail?: string | null;
  address?: string | null;
  authUrl?: string | null;
  authInProgress?: boolean;
  stdout?: string;
  stderr?: string;
  agentMail?: OvernightAgentMailRuntimeSnapshot;
}

export interface OvernightRunLogEntry {
  timestamp: number;
  level: "info" | "warn" | "error";
  stage: OvernightExecutionStage;
  message: string;
}

export interface OvernightRunRecord {
  id: string;
  jobId: string;
  messageId: string;
  threadId: string;
  subject: string;
  sender: string;
  status: OvernightRunStatus;
  stage?: OvernightExecutionStage;
  source?: "email" | "manual" | "scheduled";
  taskId?: string | null;
  workspaceDir?: string | null;
  provider?: string | null;
  model?: string | null;
  prompt?: string | null;
  verifyCommand?: string | null;
  branchName: string | null;
  commitSha?: string | null;
  changedFilesCount: number;
  changedFiles?: FactoryChangedFileStat[];
  diffSummary?: string | null;
  testPassed: boolean | null;
  oracleSummary: string;
  reviewComments: string[];
  deepLink: string | null;
  reportSent: boolean;
  reportRecipient?: string | null;
  logs?: OvernightRunLogEntry[];
  createdAt: number;
  startedAt?: number | null;
  completedAt: number;
  errorMessage: string | null;
}

export interface OvernightTaskDefinition {
  id: string;
  title: string;
  prompt: string;
  workspaceDir: string;
  provider: string;
  model: string;
  verifyCommand: string;
  triggerMode: "manual" | "scheduled" | "email";
  sendEmailReport: boolean;
  reportRecipient: string;
  allowNoFileChanges: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunId: string | null;
  lastRunStatus: OvernightRunStatus | null;
  lastRunAt: number | null;
}

export interface OvernightConfigSnapshot {
  ok: true;
  config: OvernightFactoryPersistedConfig;
  secrets: OvernightSecretPresence;
  credentialsFile: string;
  agentMail: OvernightAgentMailRuntimeSnapshot;
  mailStatus: OvernightMailChannelStatusSummary;
  runtime: {
    pollerActive: boolean;
    inAllowedWindow: boolean;
    oauthPending: boolean;
    lastPollAt: number | null;
    lastPollError: string | null;
    lastTestResult: OvernightMailTestResult | null;
    runsCount: number;
    activeRunsCount: number;
    tasksCount: number;
  };
}

export interface OvernightTestReportResult {
  ok: true;
  messageId: string;
  recipient: string;
  testRecipient: string;
  provider: string;
  sentAt: number;
  subject: string;
  htmlPreviewLength: number;
  message: string;
}

export interface OvernightPollNowResult {
  ok: true;
  polledAt: number;
  fetchedCount: number;
  matchedCount: number;
  executedCount: number;
  blockedByWhitelistCount: number;
  skippedDuplicateCount: number;
  runs: OvernightRunRecord[];
  message: string;
}

export interface OvernightGmailOAuthStartResult {
  ok: true;
  authUrl: string;
  state: string;
  redirectUri: string;
  expiresAt: number;
}

export interface OvernightGmailOAuthCallbackResult {
  statusCode: number;
  ok: boolean;
  boundEmail?: string;
  html: string;
  message: string;
}

export interface ImapProbeParams {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  mailbox: string;
  timeoutMs?: number;
}

export interface SmtpConfigParams {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
  fromName?: string;
  timeoutMs?: number;
}

export interface AgentMailCommandOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  errorMessage?: string;
}

export interface AgentMailLoginSpawnHandle {
  onStdout: (cb: (chunk: string) => void) => void;
  onStderr: (cb: (chunk: string) => void) => void;
  onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void;
  onError: (cb: (err: Error) => void) => void;
  kill: () => void;
}

export interface OvernightNetworkHooks {
  probeImap?: (params: ImapProbeParams) => Promise<OvernightMailProbeChannelResult>;
  probeSmtp?: (params: SmtpConfigParams) => Promise<OvernightMailProbeChannelResult>;
  sendSmtp?: (
    params: SmtpConfigParams,
    payload: OutboundMailPayload,
  ) => Promise<OutboundMailReceipt>;
  createInboundAdapter?: (
    config: OvernightFactoryPersistedConfig,
    secrets: ResolvedOvernightSecrets,
  ) => MailInboundAdapter | null;
  createOutboundMailer?: (
    config: OvernightFactoryPersistedConfig,
    secrets: ResolvedOvernightSecrets,
  ) => OutboundMailer | null;
  findAgentMailCli?: () => string | null;
  runAgentMailCli?: (
    cliPath: string,
    args: readonly string[],
    timeoutMs: number,
    options?: { cwd?: string },
  ) => Promise<AgentMailCommandOutput>;
  installAgentMailCli?: (timeoutMs: number) => Promise<AgentMailCommandOutput>;
  spawnAgentMailLogin?: (cliPath: string) => AgentMailLoginSpawnHandle;
  agentMailLoginUrlWaitMs?: number;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export interface ResolvedOvernightSecrets {
  gmailClientSecret?: string;
  gmailRefreshToken?: string;
  gmailAccessToken?: string;
  imapPassword?: string;
  smtpPassword?: string;
}

export interface OvernightRouteServiceOptions {
  dataDir: string;
  overnightFactory?: OvernightFactory;
  credentialStore?: EncryptedPluginCredentialStore;
  memoryStore?: SqliteMemoryStore;
  policyGuard?: AntigravityPolicyGuard;
  dispatchHub?: DesktopIpcDispatchHub;
  chiefManager?: ChiefThreadManager;
  onConfigChanged?: () => void;
  networkHooks?: OvernightNetworkHooks;
}

interface PendingGmailOAuthSession {
  state: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  createdAt: number;
  expiresAt: number;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
  const dir = NodePath.dirname(filePath);
  NodeFS.mkdirSync(dir, { recursive: true });
  const tmpPath = NodePath.join(
    dir,
    `.tmp-${NodePath.basename(filePath)}-${NodeCrypto.randomUUID()}`,
  );
  try {
    NodeFS.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    NodeFS.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      NodeFS.rmSync(tmpPath, { force: true });
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

function assertOwnerChief(trustedCallerScope: CallerScope, resourceName: string): void {
  if (trustedCallerScope !== "owner_chief") {
    throw new BusinessRouteError(
      403,
      "FORBIDDEN_SCOPE",
      `Scope "${trustedCallerScope}" is not permitted to access ${resourceName}.`,
    );
  }
}

function clampPort(raw: unknown, fallback: number): number {
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num)) return fallback;
  const int = Math.trunc(num);
  if (int < 1 || int > 65535) return fallback;
  return int;
}

function clampPollMinutes(raw: unknown, fallback = 5): number {
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(1440, Math.max(1, Math.trunc(num)));
}

function normalizeTimeHHMM(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return fallback;
  const h = Number.parseInt(match[1]!, 10);
  const m = Number.parseInt(match[2]!, 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return fallback;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function extractEmailAddress(raw: string): string {
  const angleMatch = /<([^<>]+)>/.exec(raw);
  return (angleMatch?.[1] ?? raw).trim().toLowerCase();
}

function normalizeTestRecipient(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\r\n]+/g, "").trim();
}

function isValidTestRecipientEmail(value: string): boolean {
  return value.length > 0 && value.includes("@") && !/\s/.test(value);
}

export function normalizeAllowedSenders(raw: unknown): string[] {
  const list: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        list.push(...item.split(/[\r\n,;]+/));
      }
    }
  } else if (typeof raw === "string") {
    list.push(...raw.split(/[\r\n,;]+/));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const email = extractEmailAddress(item);
    if (email.length > 0 && email.includes("@") && !seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}

export function isSenderAllowed(senderRaw: string, allowedSenders: readonly string[]): boolean {
  const normalizedSender = extractEmailAddress(senderRaw);
  if (normalizedSender.length === 0) return false;
  const normalizedList = allowedSenders
    .map((entry) => extractEmailAddress(entry))
    .filter((entry) => entry.length > 0);
  // Safety-first: if whitelist is configured, strictly enforce exact email or *@domain match.
  if (normalizedList.length === 0) {
    return false;
  }
  for (const rule of normalizedList) {
    if (rule.startsWith("*@")) {
      const domain = rule.slice(1); // "@example.com"
      if (normalizedSender.endsWith(domain)) {
        return true;
      }
    } else if (normalizedSender === rule) {
      return true;
    }
  }
  return false;
}

export function isWithinExecutionWindow(
  strategy: Pick<OvernightStrategyConfig, "windowMode" | "windowStart" | "windowEnd">,
  nowMs: number = Date.now(),
): boolean {
  if (strategy.windowMode === "always") {
    return true;
  }
  const parseMin = (hhmm: string, fallback: number): number => {
    const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
    if (!m) return fallback;
    return Number.parseInt(m[1]!, 10) * 60 + Number.parseInt(m[2]!, 10);
  };
  const startMin = parseMin(strategy.windowStart, 23 * 60);
  const endMin = parseMin(strategy.windowEnd, 7 * 60);
  if (startMin === endMin) {
    return true;
  }
  const dt = new Date(nowMs);
  const currentMin = dt.getHours() * 60 + dt.getMinutes();
  if (startMin < endMin) {
    return currentMin >= startMin && currentMin < endMin;
  }
  // Overnight wraparound (e.g. 23:00 -> 07:00)
  return currentMin >= startMin || currentMin < endMin;
}

export function createDefaultOvernightConfig(): OvernightFactoryPersistedConfig {
  const qq = OVERNIGHT_MAIL_PRESETS.qq;
  return {
    schemaVersion: 1,
    updatedAt: 0,
    enabled: false,
    mode: "imap",
    emailProvider: "imap_smtp",
    agentMailAddress: "",
    testRecipient: "",
    gmail: {
      clientId: "",
      redirectUri: "",
      boundEmail: "",
      connected: false,
      connectedAt: null,
    },
    imapSmtp: {
      preset: "qq",
      email: "",
      imapHost: qq.imapHost,
      imapPort: qq.imapPort,
      imapSecure: qq.imapSecure,
      imapUsername: "",
      mailbox: "INBOX",
      smtpHost: qq.smtpHost,
      smtpPort: qq.smtpPort,
      smtpSecure: qq.smtpSecure,
      smtpUsername: "",
      fromName: `${BRAND.appName} Overnight Factory`,
    },
    strategy: {
      triggerTag: "#factory",
      allowedSenders: [],
      windowMode: "scheduled",
      windowStart: "23:00",
      windowEnd: "07:00",
      pollIntervalMinutes: 5,
      targetWorkspaceDir: "",
      agentProvider: "codex",
      agentModel: "gpt-6.2-sol",
      secretaryBrain: "codex",
      oracleReviewEnabled: false,
      localWorktreeOnlyNoPush: true,
    },
  };
}

function normalizePersistedConfig(raw: unknown): OvernightFactoryPersistedConfig {
  const base = createDefaultOvernightConfig();
  if (!isPlainRecord(raw)) return base;

  const rawMode: FactoryInboundMode =
    raw["mode"] === "gmail-oauth2" || raw["mode"] === "imap" ? raw["mode"] : base.mode;
  const enabled = typeof raw["enabled"] === "boolean" ? raw["enabled"] : base.enabled;

  const gmailRaw = isPlainRecord(raw["gmail"]) ? raw["gmail"] : {};
  const gmail: OvernightGmailConfig = {
    clientId:
      typeof gmailRaw["clientId"] === "string" ? gmailRaw["clientId"].trim() : base.gmail.clientId,
    redirectUri:
      typeof gmailRaw["redirectUri"] === "string"
        ? gmailRaw["redirectUri"].trim()
        : base.gmail.redirectUri,
    boundEmail:
      typeof gmailRaw["boundEmail"] === "string"
        ? gmailRaw["boundEmail"].trim()
        : base.gmail.boundEmail,
    connected:
      typeof gmailRaw["connected"] === "boolean" ? gmailRaw["connected"] : base.gmail.connected,
    connectedAt:
      typeof gmailRaw["connectedAt"] === "number" && Number.isFinite(gmailRaw["connectedAt"])
        ? gmailRaw["connectedAt"]
        : null,
    ...(typeof gmailRaw["lastHistoryId"] === "string" && gmailRaw["lastHistoryId"].trim().length > 0
      ? { lastHistoryId: gmailRaw["lastHistoryId"].trim() }
      : {}),
  };

  const imapRaw = isPlainRecord(raw["imapSmtp"]) ? raw["imapSmtp"] : {};
  const presetRaw = imapRaw["preset"];
  const email =
    typeof imapRaw["email"] === "string" ? imapRaw["email"].trim() : base.imapSmtp.email;
  const preset: OvernightCanonicalMailPresetId = normalizeOvernightMailPresetId(
    presetRaw,
    base.imapSmtp.preset,
  );
  const presetSpec = isOvernightMailPresetId(presetRaw)
    ? resolveOvernightMailPresetSpec(presetRaw, email)
    : resolveOvernightMailPresetSpec(preset, email);

  const emailProvider: OvernightEmailProvider = isOvernightEmailProvider(raw["emailProvider"])
    ? raw["emailProvider"]
    : rawMode === "gmail-oauth2"
      ? "gmail_oauth2"
      : preset === "agent_mail"
        ? "agent_mail"
        : "imap_smtp";
  const mode: FactoryInboundMode = emailProvider === "gmail_oauth2" ? "gmail-oauth2" : "imap";
  const agentMailAddress =
    typeof raw["agentMailAddress"] === "string"
      ? raw["agentMailAddress"].trim()
      : base.agentMailAddress;
  const rawTestRecipient = normalizeTestRecipient(raw["testRecipient"]);
  const testRecipient =
    rawTestRecipient.length === 0 || isValidTestRecipientEmail(rawTestRecipient)
      ? rawTestRecipient
      : base.testRecipient;

  const imapSmtp: OvernightImapSmtpConfig = {
    preset: emailProvider === "agent_mail" ? "agent_mail" : preset,
    email,
    imapHost:
      typeof imapRaw["imapHost"] === "string" && imapRaw["imapHost"].trim().length > 0
        ? imapRaw["imapHost"].trim()
        : presetSpec.imapHost,
    imapPort: clampPort(imapRaw["imapPort"], presetSpec.imapPort),
    imapSecure:
      typeof imapRaw["imapSecure"] === "boolean" ? imapRaw["imapSecure"] : presetSpec.imapSecure,
    imapUsername:
      typeof imapRaw["imapUsername"] === "string"
        ? imapRaw["imapUsername"].trim()
        : base.imapSmtp.imapUsername,
    mailbox:
      typeof imapRaw["mailbox"] === "string" && imapRaw["mailbox"].trim().length > 0
        ? imapRaw["mailbox"].trim()
        : "INBOX",
    smtpHost:
      typeof imapRaw["smtpHost"] === "string" && imapRaw["smtpHost"].trim().length > 0
        ? imapRaw["smtpHost"].trim()
        : presetSpec.smtpHost,
    smtpPort: clampPort(imapRaw["smtpPort"], presetSpec.smtpPort),
    smtpSecure:
      typeof imapRaw["smtpSecure"] === "boolean" ? imapRaw["smtpSecure"] : presetSpec.smtpSecure,
    smtpUsername:
      typeof imapRaw["smtpUsername"] === "string"
        ? imapRaw["smtpUsername"].trim()
        : base.imapSmtp.smtpUsername,
    fromName:
      typeof imapRaw["fromName"] === "string" && imapRaw["fromName"].trim().length > 0
        ? imapRaw["fromName"].trim()
        : base.imapSmtp.fromName,
    ...(typeof imapRaw["useSeparateSmtpPassword"] === "boolean"
      ? { useSeparateSmtpPassword: imapRaw["useSeparateSmtpPassword"] }
      : {}),
  };

  const stratRaw = isPlainRecord(raw["strategy"]) ? raw["strategy"] : {};
  const windowMode: OvernightWindowMode =
    stratRaw["windowMode"] === "always" || stratRaw["windowMode"] === "scheduled"
      ? stratRaw["windowMode"]
      : base.strategy.windowMode;

  const strategy: OvernightStrategyConfig = {
    triggerTag:
      typeof stratRaw["triggerTag"] === "string" && stratRaw["triggerTag"].trim().length > 0
        ? stratRaw["triggerTag"].trim()
        : "#factory",
    allowedSenders: normalizeAllowedSenders(stratRaw["allowedSenders"]),
    windowMode,
    windowStart: normalizeTimeHHMM(stratRaw["windowStart"], base.strategy.windowStart),
    windowEnd: normalizeTimeHHMM(stratRaw["windowEnd"], base.strategy.windowEnd),
    pollIntervalMinutes: clampPollMinutes(
      stratRaw["pollIntervalMinutes"],
      base.strategy.pollIntervalMinutes,
    ),
    targetWorkspaceDir:
      typeof stratRaw["targetWorkspaceDir"] === "string"
        ? stratRaw["targetWorkspaceDir"].trim()
        : "",
    agentProvider:
      typeof stratRaw["agentProvider"] === "string" && stratRaw["agentProvider"].trim().length > 0
        ? stratRaw["agentProvider"].trim()
        : base.strategy.agentProvider,
    agentModel: typeof stratRaw["agentModel"] === "string" ? stratRaw["agentModel"].trim() : "",
    secretaryBrain:
      stratRaw["secretaryBrain"] === "gemini-api" ||
      stratRaw["secretaryBrain"] === "codex" ||
      stratRaw["secretaryBrain"] === "claude-code"
        ? stratRaw["secretaryBrain"]
        : base.strategy.secretaryBrain,
    oracleReviewEnabled:
      typeof stratRaw["oracleReviewEnabled"] === "boolean"
        ? stratRaw["oracleReviewEnabled"]
        : false,
    localWorktreeOnlyNoPush:
      typeof stratRaw["localWorktreeOnlyNoPush"] === "boolean"
        ? stratRaw["localWorktreeOnlyNoPush"]
        : true,
  };

  return {
    schemaVersion: 1,
    updatedAt:
      typeof raw["updatedAt"] === "number" && Number.isFinite(raw["updatedAt"])
        ? raw["updatedAt"]
        : 0,
    enabled,
    mode,
    emailProvider,
    agentMailAddress,
    testRecipient,
    gmail,
    imapSmtp,
    strategy,
  };
}

function escapeImapQuoted(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function encodeMimeHeaderUtf8(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) {
    return value.replace(/[\r\n]+/g, " ");
  }
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export function buildRfc2822MimeMessage(input: {
  fromAddress: string;
  fromName?: string;
  to: readonly string[];
  subject: string;
  html: string;
  text?: string;
  messageId: string;
  inReplyTo?: string;
  references?: readonly string[];
}): string {
  const boundary = `pmx-factory-${NodeCrypto.randomUUID().replaceAll("-", "")}`;
  const fromHeader =
    input.fromName && input.fromName.trim().length > 0
      ? `${encodeMimeHeaderUtf8(input.fromName.trim())} <${input.fromAddress}>`
      : `<${input.fromAddress}>`;
  const plainText =
    input.text ??
    input.html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const headers: string[] = [
    `From: ${fromHeader}`,
    `To: ${input.to.join(", ")}`,
    `Subject: ${encodeMimeHeaderUtf8(input.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${input.messageId}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (input.inReplyTo) {
    headers.push(`In-Reply-To: ${input.inReplyTo}`);
  }
  if (input.references && input.references.length > 0) {
    headers.push(`References: ${input.references.join(" ")}`);
  }

  const textB64 = Buffer.from(plainText, "utf8").toString("base64");
  const htmlB64 = Buffer.from(input.html, "utf8").toString("base64");
  const wrap76 = (b64: string): string => b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();

  return [
    ...headers,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(textB64),
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(htmlB64),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function dotStuffSmtpBody(rawMessage: string): string {
  const normalized = rawMessage.replace(/\r?\n/g, "\r\n");
  return normalized
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function formatImapDiagnosticError(
  err: unknown,
  params: Pick<ImapProbeParams, "host" | "port" | "secure">,
): { message: string; hint?: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("wrong version number") || lower.includes("packet length too long")) {
    return {
      message: `IMAP TLS 协议与端口不匹配（${params.host}:${params.port}）：${raw}`,
      hint: "端口 993 需开启 SSL/TLS，端口 143 需关闭隐式 SSL/TLS。",
    };
  }
  if (lower.includes("enotfound") || lower.includes("getaddrinfo")) {
    return {
      message: `无法解析 IMAP 服务器域名 ${params.host}`,
      hint: "请检查 IMAP 服务器主机地址拼写及本机 DNS/网络连接。",
    };
  }
  if (lower.includes("econnrefused")) {
    return {
      message: `IMAP 服务器拒绝连接（${params.host}:${params.port}）`,
      hint: "请核对 IMAP 端口（通常为 993）与防火墙设置。",
    };
  }
  if (lower.includes("超时") || lower.includes("etimedout")) {
    return {
      message: `连接 IMAP 服务器超时（${params.host}:${params.port}）`,
      hint: "请检查网络/代理连通性，并确认 993 端口开启 SSL/TLS。",
    };
  }
  if (
    lower.includes("login") ||
    lower.includes("auth") ||
    lower.includes("unsafe login") ||
    lower.includes("no")
  ) {
    return {
      message: raw,
      hint: "请确认已在邮箱网页端开启 IMAP/SMTP 服务，并填写「客户端授权码 / 应用专用密码」（而非网页登录密码）。",
    };
  }
  return { message: raw };
}

function formatSmtpDiagnosticError(
  err: unknown,
  params: Pick<SmtpConfigParams, "host" | "port" | "secure">,
): { message: string; hint?: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("wrong version number") || lower.includes("packet length too long")) {
    return {
      message: `SMTP SSL/TLS 与端口不匹配（${params.host}:${params.port}）`,
      hint: "465 端口需开启 SSL/TLS，587 端口需关闭 SSL/TLS（自动走 STARTTLS 升级）。",
    };
  }
  if (
    lower.includes("535") ||
    lower.includes("authentication failed") ||
    lower.includes("auth fail") ||
    lower.includes("login fail")
  ) {
    return {
      message: `SMTP 认证失败 (535)：${raw}`,
      hint: "请使用邮箱「客户端授权码 / 16 位应用专用密码」（勿用网页登录密码），并确认邮箱已开启 SMTP 服务；如未启用独立 SMTP 密码请关闭「独立 SMTP 授权码」开关。",
    };
  }
  if (
    lower.includes("553") ||
    lower.includes("501") ||
    lower.includes("mail from must equal") ||
    lower.includes("same as authorization user")
  ) {
    return {
      message: `发件人地址与 SMTP 认证账号不一致：${raw}`,
      hint: "QQ / 网易（163/126）邮箱要求发件邮箱地址与 SMTP 登录账号完全一致，请保持两者相同。",
    };
  }
  if (lower.includes("530") || lower.includes("starttls")) {
    return {
      message: `SMTP 服务器要求 TLS 加密连接：${raw}`,
      hint: "请开启 SSL/TLS（端口 465）或使用支持 STARTTLS 的 587 端口。",
    };
  }
  if (lower.includes("enotfound") || lower.includes("getaddrinfo")) {
    return {
      message: `无法解析 SMTP 服务器域名 ${params.host}`,
      hint: "请检查 SMTP 服务器主机地址拼写及本机 DNS/网络连接。",
    };
  }
  if (lower.includes("econnrefused")) {
    return {
      message: `SMTP 服务器拒绝连接（${params.host}:${params.port}）`,
      hint: "请核对 SMTP 端口（常见为 465 SSL 或 587 STARTTLS）与网络防火墙。",
    };
  }
  if (lower.includes("超时") || lower.includes("etimedout")) {
    return {
      message: `连接 SMTP 服务器超时（${params.host}:${params.port}）`,
      hint: "465 端口必须开启 SSL/TLS、587 端口需关闭隐式 SSL（走 STARTTLS）；同时请检查代理或防火墙是否拦截发信端口。",
    };
  }
  return { message: raw };
}

function isStrictFromMatchSmtpHost(host: string): boolean {
  const lower = host.trim().toLowerCase();
  return (
    lower.endsWith("qq.com") ||
    lower.endsWith("163.com") ||
    lower.endsWith("126.com") ||
    lower.endsWith("yeah.net") ||
    lower.endsWith("sina.com") ||
    lower.endsWith("aliyun.com")
  );
}

export function resolveEffectiveSmtpFromAddress(
  params: Pick<SmtpConfigParams, "host" | "username" | "fromAddress">,
): string {
  const normalizedUser = extractEmailAddress(params.username);
  const normalizedFrom = extractEmailAddress(params.fromAddress);
  if (isStrictFromMatchSmtpHost(params.host) && normalizedUser.includes("@")) {
    return normalizedUser;
  }
  if (normalizedFrom.includes("@")) {
    return normalizedFrom;
  }
  return normalizedUser || normalizedFrom;
}

/**
 * Probes IMAP TLS/TCP connectivity, authenticates with LOGIN, selects the mailbox,
 * and logs out cleanly. Never exposes credentials in error strings.
 */
export async function defaultProbeImapConnection(
  params: ImapProbeParams,
): Promise<OvernightMailProbeChannelResult> {
  const startedAt = Date.now();
  const timeoutMs = params.timeoutMs ?? 10_000;
  if (!params.host.trim()) {
    return {
      ok: false,
      latencyMs: 0,
      message: "未填写 IMAP 服务器主机地址。",
      hint: "请选择邮箱预设或手动填写 IMAP 主机地址（如 imap.qq.com）。",
    };
  }
  if (!params.username.trim()) {
    return {
      ok: false,
      latencyMs: 0,
      message: "未填写 IMAP 登录账号/邮箱。",
      hint: "请填写完整邮箱地址（例如 you@qq.com）。",
    };
  }
  if (!params.password) {
    return {
      ok: false,
      latencyMs: 0,
      message: "未填写或未保存 IMAP 授权码/密码。",
      hint: "请输入邮箱客户端授权码并点击保存或直接测试。",
    };
  }

  let socket: NodeNet.Socket | NodeTls.TLSSocket | undefined;
  try {
    socket = await new Promise<NodeNet.Socket | NodeTls.TLSSocket>(
      (resolveSocket, rejectSocket) => {
        const s = params.secure
          ? NodeTls.connect({
              host: params.host,
              port: params.port,
              servername: params.host,
            })
          : NodeNet.connect({
              host: params.host,
              port: params.port,
            });
        const timer = setTimeout(() => {
          s.destroy();
          rejectSocket(new Error(`IMAP 连接超时 (${timeoutMs}ms)`));
        }, timeoutMs);
        const onError = (err: Error) => {
          clearTimeout(timer);
          rejectSocket(err);
        };
        s.once("error", onError);
        s.once(params.secure ? "secureConnect" : "connect", () => {
          clearTimeout(timer);
          s.off("error", onError);
          resolveSocket(s);
        });
      },
    );

    socket.setTimeout(timeoutMs);
    let buffer = "";
    const waiters: Array<() => void> = [];
    const notify = () => {
      while (waiters.length > 0) {
        waiters.shift()?.();
      }
    };
    socket.on("data", (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      notify();
    });
    socket.on("timeout", () => {
      socket?.destroy();
      notify();
    });
    socket.on("close", notify);
    socket.on("error", notify);

    const waitForData = async (remainingMs: number): Promise<void> => {
      if (remainingMs <= 0) return;
      await new Promise<void>((resolveWait) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolveWait();
        };
        const timer = setTimeout(finish, remainingMs);
        waiters.push(finish);
      });
    };

    const readLine = async (label: string): Promise<string> => {
      const start = Date.now();
      while (!/\r?\n/.test(buffer)) {
        if (socket!.destroyed || socket!.closed) {
          throw new Error(`IMAP 连接在等待 ${label} 时意外关闭。`);
        }
        const remaining = timeoutMs - (Date.now() - start);
        if (remaining <= 0) {
          throw new Error(`IMAP 等待 ${label} 超时。`);
        }
        await waitForData(remaining);
      }
      const idx = buffer.indexOf("\n");
      const line = buffer.slice(0, idx + 1);
      buffer = buffer.slice(idx + 1);
      return line.trim();
    };

    const readTagged = async (tag: string, label: string): Promise<string> => {
      const start = Date.now();
      const pattern = new RegExp(`(?:^|\\r?\\n)${tag} (OK|NO|BAD)[^\\r\\n]*\\r?\\n`);
      while (!pattern.test(buffer)) {
        if (socket!.destroyed || socket!.closed) {
          throw new Error(`IMAP 连接在 ${label} 期间关闭。`);
        }
        const remaining = timeoutMs - (Date.now() - start);
        if (remaining <= 0) {
          throw new Error(`IMAP ${label} 超时。`);
        }
        await waitForData(remaining);
      }
      const match = pattern.exec(buffer)!;
      const endIdx = match.index + match[0].length;
      const chunk = buffer.slice(0, endIdx);
      buffer = buffer.slice(endIdx);
      if (match[1] !== "OK") {
        throw new Error(`IMAP ${label} 失败：${match[0].trim()}`);
      }
      return chunk;
    };

    let seq = 0;
    const sendCmd = async (cmd: string, label: string): Promise<string> => {
      const tag = `P${++seq}`;
      socket!.write(`${tag} ${cmd}\r\n`);
      return readTagged(tag, label);
    };

    await readLine("服务器问候");
    await sendCmd(
      `LOGIN ${escapeImapQuoted(params.username)} ${escapeImapQuoted(params.password)}`,
      "认证登录（请检查账号与邮箱授权码）",
    );
    const selectResp = await sendCmd(
      `SELECT ${escapeImapQuoted(params.mailbox || "INBOX")}`,
      `打开邮箱 ${params.mailbox || "INBOX"}`,
    );
    const existsMatch = /\*\s+(\d+)\s+EXISTS/i.exec(selectResp);
    try {
      await sendCmd("LOGOUT", "退出");
    } catch {
      // ignore logout errors
    }

    const latencyMs = Math.max(1, Date.now() - startedAt);
    const countNote = existsMatch ? `（收件箱共 ${existsMatch[1]} 封邮件）` : "";
    return {
      ok: true,
      latencyMs,
      message: `IMAP 登录与收件箱验证成功${countNote}`,
      detail: `${params.host}:${params.port} (${params.secure ? "TLS" : "TCP"})`,
    };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    const diag = formatImapDiagnosticError(err, params);
    return {
      ok: false,
      latencyMs,
      message: diag.message,
      detail: `${params.host}:${params.port}`,
      ...(diag.hint ? { hint: diag.hint } : {}),
    };
  } finally {
    socket?.destroy();
  }
}

async function runSmtpTransactionOnce(
  params: SmtpConfigParams,
  payload?: OutboundMailPayload,
): Promise<{ messageId: string; latencyMs: number; usedTls: boolean; authMethod: string }> {
  const startedAt = Date.now();
  const timeoutMs = params.timeoutMs ?? 12_000;
  if (!params.host.trim()) {
    throw new Error("未填写 SMTP 服务器主机地址。");
  }
  if (!params.username.trim()) {
    throw new Error("未填写 SMTP 登录账号/邮箱。");
  }
  if (!params.password) {
    throw new Error("未填写或未保存 SMTP 授权码/密码。");
  }

  let socket: NodeNet.Socket | NodeTls.TLSSocket = await new Promise(
    (resolveSocket, rejectSocket) => {
      const s = params.secure
        ? NodeTls.connect({
            host: params.host,
            port: params.port,
            servername: params.host,
          })
        : NodeNet.connect({
            host: params.host,
            port: params.port,
          });
      const timer = setTimeout(() => {
        s.destroy();
        rejectSocket(new Error(`SMTP 连接超时 (${timeoutMs}ms)`));
      }, timeoutMs);
      const onError = (err: Error) => {
        clearTimeout(timer);
        rejectSocket(err);
      };
      s.once("error", onError);
      s.once(params.secure ? "secureConnect" : "connect", () => {
        clearTimeout(timer);
        s.off("error", onError);
        resolveSocket(s);
      });
    },
  );

  let usedTls = params.secure;
  let buffer = "";
  let waiters: Array<() => void> = [];
  let activeDataHandler: ((chunk: Buffer | string) => void) | null = null;
  let activeNotifyHandler: (() => void) | null = null;

  const notify = () => {
    const pending = waiters;
    waiters = [];
    for (const fn of pending) fn();
  };

  // IMPORTANT: Never call `sock.setEncoding("utf8")` on a plain TCP socket that may be upgraded
  // via STARTTLS — string mode corrupts the subsequent binary TLS handshake in Node.js!
  const attachListeners = (sock: NodeNet.Socket | NodeTls.TLSSocket) => {
    sock.setTimeout(timeoutMs);
    const onData = (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      notify();
    };
    const onTimeout = () => {
      sock.destroy();
      notify();
    };
    activeDataHandler = onData;
    activeNotifyHandler = notify;
    sock.on("data", onData);
    sock.on("timeout", onTimeout);
    sock.on("close", notify);
    sock.on("error", notify);
  };

  const detachListeners = (sock: NodeNet.Socket | NodeTls.TLSSocket) => {
    if (activeDataHandler) sock.off("data", activeDataHandler);
    if (activeNotifyHandler) {
      sock.off("close", activeNotifyHandler);
      sock.off("error", activeNotifyHandler);
    }
    sock.removeAllListeners("timeout");
    activeDataHandler = null;
    activeNotifyHandler = null;
  };

  attachListeners(socket);

  const waitForData = async (remainingMs: number): Promise<void> => {
    if (remainingMs <= 0) return;
    await new Promise<void>((resolveWait) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolveWait();
      };
      const timer = setTimeout(finish, remainingMs);
      waiters.push(finish);
    });
  };

  const readResponse = async (label: string): Promise<{ code: number; text: string }> => {
    const start = Date.now();
    const lines: string[] = [];
    while (true) {
      while (!/\r?\n/.test(buffer)) {
        if (socket.destroyed || socket.closed) {
          throw new Error(`SMTP 连接在 ${label} 期间关闭。`);
        }
        const remaining = timeoutMs - (Date.now() - start);
        if (remaining <= 0) {
          throw new Error(`SMTP ${label} 超时。`);
        }
        await waitForData(remaining);
      }
      const nlIdx = buffer.indexOf("\n");
      const line = buffer.slice(0, nlIdx + 1).replace(/\r?\n$/, "");
      buffer = buffer.slice(nlIdx + 1);
      lines.push(line);
      const match = /^(\d{3})([ -])/.exec(line);
      if (match && match[2] === " ") {
        return {
          code: Number.parseInt(match[1]!, 10),
          text: lines.join("\n"),
        };
      }
    }
  };

  const sendCommand = async (
    cmd: string,
    expectedCodes: readonly number[],
    label: string,
  ): Promise<{ code: number; text: string }> => {
    socket.write(`${cmd}\r\n`);
    const resp = await readResponse(label);
    if (!expectedCodes.includes(resp.code)) {
      throw new Error(`SMTP ${label} 失败 (${resp.code})：${resp.text}`);
    }
    return resp;
  };

  const sendEhloOrHelo = async (label: string): Promise<{ code: number; text: string }> => {
    socket.write("EHLO prismux.dev\r\n");
    const resp = await readResponse(label);
    if (resp.code === 250) {
      return resp;
    }
    if (resp.code === 500 || resp.code === 502) {
      return sendCommand("HELO prismux.dev", [250], "HELO");
    }
    throw new Error(`SMTP ${label} 失败 (${resp.code})：${resp.text}`);
  };

  try {
    const greeting = await readResponse("服务器问候");
    if (greeting.code !== 220) {
      throw new Error(`SMTP 问候异常 (${greeting.code})：${greeting.text}`);
    }

    let ehlo = await sendEhloOrHelo("EHLO");

    if (!params.secure && /STARTTLS/i.test(ehlo.text)) {
      await sendCommand("STARTTLS", [220], "STARTTLS");
      const rawPlain = socket;
      detachListeners(rawPlain);
      rawPlain.pause();
      buffer = "";
      socket = await new Promise<NodeTls.TLSSocket>((resolveTls, rejectTls) => {
        const tlsSock = NodeTls.connect({
          socket: rawPlain,
          servername: params.host,
        });
        const timer = setTimeout(() => {
          tlsSock.destroy();
          rejectTls(new Error("SMTP STARTTLS 握手超时。"));
        }, timeoutMs);
        tlsSock.once("error", (err) => {
          clearTimeout(timer);
          rejectTls(err);
        });
        tlsSock.once("secureConnect", () => {
          clearTimeout(timer);
          resolveTls(tlsSock);
        });
      });
      usedTls = true;
      attachListeners(socket);
      ehlo = await sendEhloOrHelo("EHLO (STARTTLS)");
    }

    // Negotiate AUTH method from EHLO capabilities (support both AUTH LOGIN and AUTH PLAIN).
    const authLine = ehlo.text.split(/\r?\n/).find((line) => /^250[- ]AUTH\b/i.test(line)) ?? "";
    const advertisesLogin = /\bLOGIN\b/i.test(authLine);
    const advertisesPlain = /\bPLAIN\b/i.test(authLine);
    const preferPlainOnly = advertisesPlain && !advertisesLogin;

    let authMethod = "LOGIN";
    const runAuthPlain = async (): Promise<void> => {
      authMethod = "PLAIN";
      const token = Buffer.from(`\0${params.username}\0${params.password}`, "utf8").toString(
        "base64",
      );
      await sendCommand(`AUTH PLAIN ${token}`, [235], "SMTP AUTH PLAIN 认证");
    };

    if (preferPlainOnly) {
      await runAuthPlain();
    } else {
      socket.write("AUTH LOGIN\r\n");
      const loginStart = await readResponse("AUTH LOGIN");
      if (loginStart.code === 334) {
        await sendCommand(
          Buffer.from(params.username, "utf8").toString("base64"),
          [334],
          "SMTP 账号验证",
        );
        await sendCommand(
          Buffer.from(params.password, "utf8").toString("base64"),
          [235],
          "SMTP 密码/授权码认证",
        );
      } else if (
        (loginStart.code === 504 || loginStart.code === 500 || loginStart.code === 502) &&
        (advertisesPlain || authLine.length === 0)
      ) {
        await runAuthPlain();
      } else {
        throw new Error(`SMTP AUTH LOGIN 失败 (${loginStart.code})：${loginStart.text}`);
      }
    }

    const fromAddr = resolveEffectiveSmtpFromAddress(params);
    const messageId = `prismux-${Date.now()}-${NodeCrypto.randomUUID().slice(0, 8)}@prismux.dev`;

    if (payload) {
      const recipients = payload.to
        .map((addr) => extractEmailAddress(addr))
        .filter((addr) => addr.length > 0);
      if (recipients.length === 0) {
        throw new Error("发信收件人邮箱不能为空。");
      }

      await sendCommand(`MAIL FROM:<${fromAddr}>`, [250], "MAIL FROM");
      for (const rcpt of recipients) {
        await sendCommand(`RCPT TO:<${rcpt}>`, [250, 251], `RCPT TO ${rcpt}`);
      }
      await sendCommand("DATA", [354], "DATA");
      const mime = buildRfc2822MimeMessage({
        fromAddress: fromAddr,
        fromName: params.fromName,
        to: recipients,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        messageId,
        inReplyTo: payload.inReplyTo,
        references: payload.references,
      });
      socket.write(`${dotStuffSmtpBody(mime)}\r\n.\r\n`);
      const dataResp = await readResponse("发送邮件正文");
      if (dataResp.code !== 250) {
        throw new Error(`SMTP 正文投递失败 (${dataResp.code})：${dataResp.text}`);
      }
    } else if (fromAddr.includes("@")) {
      // Probe outbound envelope acceptance (`MAIL FROM` + `RSET`) without dispatching an email!
      await sendCommand(`MAIL FROM:<${fromAddr}>`, [250], "MAIL FROM 发件人校验");
      try {
        await sendCommand("RSET", [250], "RSET");
      } catch {
        // Some minimal servers skip RSET after MAIL FROM
      }
    }

    try {
      await sendCommand("QUIT", [221, 250], "QUIT");
    } catch {
      // ignore quit errors
    }

    return {
      messageId,
      latencyMs: Math.max(1, Date.now() - startedAt),
      usedTls,
      authMethod,
    };
  } finally {
    socket.destroy();
  }
}

async function runSmtpTransaction(
  params: SmtpConfigParams,
  payload?: OutboundMailPayload,
): Promise<{ messageId: string; latencyMs: number; usedTls: boolean; authMethod: string }> {
  try {
    return await runSmtpTransactionOnce(params, payload);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const lower = raw.toLowerCase();
    // Auto-recover classic port/TLS misconfigurations on well-known SMTP ports:
    // 1. Port 587/25 mistakenly marked `secure: true` (implicit TLS on STARTTLS port)
    if (
      params.secure &&
      (params.port === 587 || params.port === 25) &&
      (lower.includes("wrong version number") || lower.includes("packet length too long"))
    ) {
      return runSmtpTransactionOnce({ ...params, secure: false }, payload);
    }
    // 2. Port 465 mistakenly marked `secure: false` (plain TCP on implicit TLS port)
    if (
      !params.secure &&
      params.port === 465 &&
      (lower.includes("超时") || lower.includes("关闭"))
    ) {
      return runSmtpTransactionOnce({ ...params, secure: true }, payload);
    }
    throw err;
  }
}

export async function defaultProbeSmtpConnection(
  params: SmtpConfigParams,
): Promise<OvernightMailProbeChannelResult> {
  const startedAt = Date.now();
  try {
    const res = await runSmtpTransaction(params);
    const modeLabel = res.usedTls ? (params.secure ? "SSL/TLS" : "STARTTLS") : "TCP";
    return {
      ok: true,
      latencyMs: res.latencyMs,
      message: `SMTP 认证与发信通道验证成功（AUTH ${res.authMethod} · ${modeLabel}）`,
      detail: `${params.host}:${params.port} (${modeLabel})`,
    };
  } catch (err) {
    const diag = formatSmtpDiagnosticError(err, params);
    return {
      ok: false,
      latencyMs: Math.max(1, Date.now() - startedAt),
      message: diag.message,
      detail: `${params.host}:${params.port}`,
      ...(diag.hint ? { hint: diag.hint } : {}),
    };
  }
}

export async function defaultSendSmtpMail(
  params: SmtpConfigParams,
  payload: OutboundMailPayload,
): Promise<OutboundMailReceipt> {
  try {
    const res = await runSmtpTransaction(params, payload);
    return {
      messageId: res.messageId,
      acceptedAt: Date.now(),
      provider: `smtp:${params.host}`,
    };
  } catch (err) {
    const diag = formatSmtpDiagnosticError(err, params);
    throw new Error(diag.hint ? `${diag.message}（建议：${diag.hint}）` : diag.message, {
      cause: err,
    });
  }
}

function createPkceChallenge(verifier: string): string {
  return NodeCrypto.createHash("sha256")
    .update(verifier, "utf8")
    .digest("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function getAgentMailCliSearchDirs(): string[] {
  const dirs: string[] = [];
  const home = NodeOS.homedir();
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"];
    const localAppData = process.env["LOCALAPPDATA"];
    const pnpmHome = process.env["PNPM_HOME"];
    const voltaHome = process.env["VOLTA_HOME"];
    const nvmSymlink = process.env["NVM_SYMLINK"];
    const programFiles = process.env["ProgramFiles"];
    if (appData) dirs.push(NodePath.join(appData, "npm"));
    if (localAppData) {
      dirs.push(NodePath.join(localAppData, "pnpm"));
      dirs.push(NodePath.join(localAppData, "Volta", "bin"));
      dirs.push(NodePath.join(localAppData, "Programs", "nodejs"));
    }
    if (pnpmHome) dirs.push(pnpmHome);
    if (voltaHome) dirs.push(NodePath.join(voltaHome, "bin"));
    if (nvmSymlink) dirs.push(nvmSymlink);
    if (programFiles) dirs.push(NodePath.join(programFiles, "nodejs"));
    if (home) {
      dirs.push(NodePath.join(home, "AppData", "Roaming", "npm"));
      dirs.push(NodePath.join(home, "AppData", "Local", "pnpm"));
      dirs.push(NodePath.join(home, ".npm-global"));
      dirs.push(NodePath.join(home, ".local", "bin"));
    }
  } else if (home) {
    dirs.push(
      NodePath.join(home, ".npm-global", "bin"),
      NodePath.join(home, ".local", "bin"),
      NodePath.join(home, ".pnpm-global", "bin"),
      "/usr/local/bin",
      "/opt/homebrew/bin",
    );
  }
  return dirs;
}

function defaultFindAgentMailCli(): string | null {
  return findExecutableOnPath([AGENT_MAIL_CLI_COMMAND], {
    extraDirs: getAgentMailCliSearchDirs(),
  });
}

async function runSafeCommandWithOutput(
  executablePath: string,
  args: readonly string[],
  timeoutMs: number,
  options?: { cwd?: string },
): Promise<AgentMailCommandOutput> {
  const spec = buildSafeCliSpawnSpec(executablePath, args);
  try {
    const result = await execFileAsync(spec.file, spec.args, {
      timeout: timeoutMs,
      ...(options?.cwd ? { cwd: options.cwd } : {}),
      windowsHide: true,
      windowsVerbatimArguments: spec.windowsVerbatimArguments,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "buffer",
      env: { ...spec.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    return {
      exitCode: 0,
      stdout: decodeWindowsProcessOutput(result.stdout),
      stderr: decodeWindowsProcessOutput(result.stderr),
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      code?: number | string;
      killed?: boolean;
      signal?: string;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    const stdout = e.stdout !== undefined ? decodeWindowsProcessOutput(e.stdout) : "";
    const stderr = e.stderr !== undefined ? decodeWindowsProcessOutput(e.stderr) : "";
    const timedOut = Boolean(e.killed && (e.signal === "SIGTERM" || e.signal === "SIGKILL"));
    const numericCode = typeof e.code === "number" ? e.code : 1;
    return {
      exitCode: numericCode,
      stdout,
      stderr,
      timedOut,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

async function defaultRunAgentMailCli(
  cliPath: string,
  args: readonly string[],
  timeoutMs: number,
  options?: { cwd?: string },
): Promise<AgentMailCommandOutput> {
  return runSafeCommandWithOutput(cliPath, args, timeoutMs, options);
}

async function defaultInstallAgentMailCli(timeoutMs: number): Promise<AgentMailCommandOutput> {
  const npmPath = findExecutableOnPath(["npm"], {
    extraDirs: getAgentMailCliSearchDirs(),
  });
  if (!npmPath) {
    return {
      exitCode: 127,
      stdout: "",
      stderr: "",
      errorMessage:
        "未在 PATH 中找到 npm，请先安装 Node.js 或在终端手动执行 npm install -g @tencent-qqmail/agently-cli。",
    };
  }
  return runSafeCommandWithOutput(npmPath, ["install", "-g", AGENT_MAIL_NPM_PACKAGE], timeoutMs);
}

function defaultSpawnAgentMailLogin(cliPath: string): AgentMailLoginSpawnHandle {
  const spec = buildSafeCliSpawnSpec(cliPath, ["auth", "login"]);
  const child = NodeChildProcess.spawn(spec.file, spec.args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
    env: { ...spec.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  return {
    onStdout: (cb) => {
      child.stdout?.on("data", (buf: Buffer | string) => {
        cb(decodeWindowsProcessOutput(buf));
      });
    },
    onStderr: (cb) => {
      child.stderr?.on("data", (buf: Buffer | string) => {
        cb(decodeWindowsProcessOutput(buf));
      });
    },
    onExit: (cb) => {
      child.once("exit", (code, signal) => {
        cb(code, signal);
      });
    },
    onError: (cb) => {
      child.once("error", cb);
    },
    kill: () => {
      try {
        child.kill();
      } catch {
        // ignore kill errors
      }
    },
  };
}

function extractAgentMailAddressFromField(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (isPlainRecord(val)) {
    const email =
      typeof val["email"] === "string"
        ? val["email"].trim()
        : typeof val["address"] === "string"
          ? val["address"].trim()
          : "";
    const name = typeof val["name"] === "string" ? val["name"].trim() : "";
    if (name && email && !email.includes("<")) {
      return `${name} <${email}>`;
    }
    return email;
  }
  return "";
}

function extractAgentMailAddressList(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map((entry) => extractAgentMailAddressFromField(entry)).filter((s) => s.length > 0);
  }
  const single = extractAgentMailAddressFromField(val);
  return single ? [single] : [];
}

export function parseAgentMailListMessages(rawOutput: string): InboundEmailMessage[] {
  const parsed = extractJsonFromCliOutput(rawOutput);
  if (parsed === null) return [];

  let items: unknown[] = [];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (isPlainRecord(parsed)) {
    const dataField = parsed["data"];
    if (Array.isArray(parsed["messages"])) {
      items = parsed["messages"];
    } else if (isPlainRecord(dataField) && Array.isArray(dataField["data"])) {
      items = dataField["data"];
    } else if (isPlainRecord(dataField) && Array.isArray(dataField["messages"])) {
      items = dataField["messages"];
    } else if (Array.isArray(dataField)) {
      items = dataField;
    } else if (Array.isArray(parsed["items"])) {
      items = parsed["items"];
    }
  }

  const out: InboundEmailMessage[] = [];
  for (const item of items) {
    if (!isPlainRecord(item)) continue;
    const rawId = item["message_id"] ?? item["id"] ?? item["messageId"] ?? item["uid"];
    const messageId =
      typeof rawId === "string" && rawId.trim().length > 0
        ? rawId.trim()
        : typeof rawId === "number"
          ? String(rawId)
          : `agent-mail-${NodeCrypto.randomUUID().slice(0, 8)}`;
    const from = extractAgentMailAddressFromField(item["from"] ?? item["sender"]);
    const to = extractAgentMailAddressList(item["to"]);
    const cc = extractAgentMailAddressList(item["cc"]);
    const subject = typeof item["subject"] === "string" ? item["subject"] : "";
    const textBody =
      typeof item["text"] === "string"
        ? item["text"]
        : typeof item["textBody"] === "string"
          ? item["textBody"]
          : typeof item["body"] === "string"
            ? item["body"]
            : typeof item["snippet"] === "string"
              ? item["snippet"]
              : undefined;
    const htmlBody =
      typeof item["html"] === "string"
        ? item["html"]
        : typeof item["htmlBody"] === "string"
          ? item["htmlBody"]
          : undefined;
    const createdAtRaw = item["created_at"] ?? item["receivedAt"];
    const parsedTime =
      typeof createdAtRaw === "number" && Number.isFinite(createdAtRaw)
        ? createdAtRaw
        : typeof createdAtRaw === "string"
          ? Date.parse(createdAtRaw)
          : Number.NaN;
    out.push({
      messageId,
      from,
      to,
      ...(cc.length > 0 ? { cc } : {}),
      subject,
      ...(textBody !== undefined ? { textBody } : {}),
      ...(htmlBody !== undefined ? { htmlBody } : {}),
      ...(Number.isFinite(parsedTime) ? { receivedAt: parsedTime } : {}),
    });
  }
  return out;
}

function renderOAuthCallbackHtml(options: { ok: boolean; title: string; detail: string }): string {
  const badgeColor = options.ok ? "#16a34a" : "#dc2626";
  const badgeBg = options.ok ? "#dcfce7" : "#fee2e2";
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(options.title)} · ${escapeHtml(BRAND.appName)}</title>`,
    "</head>",
    "<body style=\"margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;padding:24px;\">",
    '<div style="max-width:440px;width:100%;background:#1e293b;border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,0.45);text-align:center;">',
    `<div style="display:inline-block;padding:4px 12px;border-radius:999px;background:${badgeBg};color:${badgeColor};font-size:12px;font-weight:700;margin-bottom:12px;">${options.ok ? "Gmail OAuth2 绑定成功" : "Gmail OAuth2 绑定失败"}</div>`,
    `<h1 style="margin:0 0 8px 0;font-size:18px;color:#ffffff;">${escapeHtml(options.title)}</h1>`,
    `<p style="margin:0 0 18px 0;font-size:13px;line-height:1.6;color:#cbd5e1;">${escapeHtml(options.detail)}</p>`,
    '<p style="margin:0;font-size:12px;color:#94a3b8;">你现在可以关闭此浏览器标签页并返回 Prismux 设置页。</p>',
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");
}

/**
 * Self-contained Overnight Factory control service managing non-secret JSON config,
 * write-only AES-256-GCM credentials, Gmail OAuth2, IMAP/SMTP, and Tencent Agent Mail CLI.
 */
export class OvernightRouteService {
  private readonly dataDir: string;
  private readonly configPath: string;
  private readonly runsPath: string;
  private readonly tasksPath: string;
  private readonly overnightFactory: OvernightFactory;
  private readonly credentialStore: EncryptedPluginCredentialStore | undefined;
  private readonly chiefManager: ChiefThreadManager | undefined;
  private readonly onConfigChanged: (() => void) | undefined;
  private readonly hooks: OvernightNetworkHooks;
  private readonly now: () => number;

  private config: OvernightFactoryPersistedConfig;
  private runs: OvernightRunRecord[] = [];
  private tasks: OvernightTaskDefinition[] = [];
  private lastPollAt: number | null = null;
  private lastPollError: string | null = null;
  private lastTestResult: OvernightMailTestResult | null = null;
  private pendingOAuth = new Map<string, PendingGmailOAuthSession>();
  private pollTimer: NodeJS.Timeout | undefined;
  private pollingInFlight = false;
  private activeRunControllers = new Map<string, AbortController>();
  private activeRunPromises = new Map<string, Promise<OvernightRunRecord>>();

  // Agent Mail CLI live probe cache & interactive login background handle
  private agentMailProbeCache: {
    checkedAt: number;
    cliInstalled: boolean;
    version: string | null;
    cliPath?: string;
    loggedIn: boolean;
    authorizedEmail: string | null;
    scopes: string[];
    dailySendQuota: number | null;
    lastError: string | null;
  } | null = null;
  private agentMailProbeInFlight: Promise<OvernightAgentMailRuntimeSnapshot> | null = null;
  private agentMailLoginHandle: AgentMailLoginSpawnHandle | null = null;
  private agentMailLoginTimer: NodeJS.Timeout | undefined;
  private agentMailAuthInProgress = false;
  private agentMailPendingAuthUrl: string | null = null;
  private agentMailLastError: string | null = null;

  constructor(options: OvernightRouteServiceOptions) {
    this.dataDir = options.dataDir;
    this.configPath = NodePath.join(options.dataDir, OVERNIGHT_CONFIG_FILENAME);
    this.runsPath = NodePath.join(options.dataDir, OVERNIGHT_RUNS_FILENAME);
    this.tasksPath = NodePath.join(options.dataDir, OVERNIGHT_TASKS_FILENAME);
    this.overnightFactory =
      options.overnightFactory ??
      new OvernightFactory({
        ...(options.memoryStore !== undefined ? { memoryStore: options.memoryStore } : {}),
        ...(options.policyGuard !== undefined ? { policyGuard: options.policyGuard } : {}),
        ...(options.dispatchHub !== undefined ? { dispatchHub: options.dispatchHub } : {}),
        codingExecutor: createDefaultOvernightCodingExecutor(),
      });
    this.credentialStore = options.credentialStore;
    this.chiefManager = options.chiefManager;
    this.onConfigChanged = options.onConfigChanged;
    this.hooks = options.networkHooks ?? {};
    this.now = this.hooks.now ?? (() => Date.now());

    this.config = this.loadPersistedConfig();
    this.runs = this.loadPersistedRuns();
    this.tasks = this.loadPersistedTasks();

    // Hydrate processed inbound email IDs from persisted runs so daemon restarts never duplicate work,
    // and recover any runs stranded in `queued`/`running` state from a prior abrupt shutdown.
    let recoveredOrphans = false;
    for (const run of this.runs) {
      if (run.messageId && run.source !== "manual") {
        this.overnightFactory.markMessageProcessed(run.messageId);
      }
      if (run.status === "queued" || run.status === "running") {
        run.status = "failed";
        run.stage = "failed";
        run.completedAt = this.now();
        run.errorMessage = run.errorMessage || "Daemon 重启导致上次运行中断，可点击重跑。";
        recoveredOrphans = true;
      }
    }
    if (recoveredOrphans) {
      this.persistRuns();
    }
  }

  getConfig(): OvernightFactoryPersistedConfig {
    return structuredClone(this.config);
  }

  getRunsCount(): number {
    return this.runs.length;
  }

  startSchedulerIfEnabled(): void {
    this.reconfigurePollTimer();
  }

  stop(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    for (const controller of this.activeRunControllers.values()) {
      try {
        controller.abort();
      } catch {
        // ignore abort errors during shutdown
      }
    }
    this.activeRunControllers.clear();
    this.stopActiveAgentMailLogin();
    this.pendingOAuth.clear();
  }

  private stopActiveAgentMailLogin(): void {
    if (this.agentMailLoginTimer !== undefined) {
      clearTimeout(this.agentMailLoginTimer);
      this.agentMailLoginTimer = undefined;
    }
    if (this.agentMailLoginHandle !== null) {
      const handle = this.agentMailLoginHandle;
      this.agentMailLoginHandle = null;
      handle.kill();
    }
    this.agentMailAuthInProgress = false;
    this.agentMailPendingAuthUrl = null;
  }

  private async resolveAgentMailCliPath(refreshEnvIfMissing = false): Promise<string | null> {
    const finder = this.hooks.findAgentMailCli ?? defaultFindAgentMailCli;
    try {
      const direct = finder();
      if (direct) return direct;
      if (refreshEnvIfMissing && !this.hooks.findAgentMailCli && process.platform === "win32") {
        await refreshWindowsEnvironmentFromRegistry().catch(() => undefined);
        return finder();
      }
      return null;
    } catch {
      return null;
    }
  }

  private runAgentMailCli(
    cliPath: string,
    args: readonly string[],
    timeoutMs: number,
    options?: { cwd?: string },
  ): Promise<AgentMailCommandOutput> {
    return (this.hooks.runAgentMailCli ?? defaultRunAgentMailCli)(
      cliPath,
      args,
      timeoutMs,
      options,
    );
  }

  private buildAgentMailSnapshot(base: {
    cliInstalled: boolean;
    version: string | null;
    cliPath?: string;
    loggedIn: boolean;
    authorizedEmail: string | null;
    scopes: string[];
    dailySendQuota: number | null;
    lastError: string | null;
  }): OvernightAgentMailRuntimeSnapshot {
    const resolvedEmail = base.authorizedEmail ?? (this.config.agentMailAddress || null);
    const loggedIn = Boolean(base.loggedIn || (base.cliInstalled && resolvedEmail));
    const configured = Boolean(base.cliInstalled && resolvedEmail);
    return {
      cliInstalled: base.cliInstalled,
      installed: base.cliInstalled,
      version: base.version,
      ...(base.cliPath ? { cliPath: base.cliPath } : {}),
      binaryPath: base.cliPath ?? null,
      loggedIn,
      authorizedEmail: resolvedEmail,
      address: resolvedEmail,
      configured,
      ...(base.scopes.length > 0 ? { scopes: [...base.scopes] } : {}),
      ...(base.dailySendQuota !== null ? { dailySendQuota: base.dailySendQuota } : {}),
      authInProgress: this.agentMailAuthInProgress,
      pendingAuthUrl: this.agentMailPendingAuthUrl,
      lastError: this.agentMailLastError ?? base.lastError,
    };
  }

  private buildMailChannelStatusSummary(
    secrets: OvernightSecretPresence,
    agentMail: OvernightAgentMailRuntimeSnapshot,
  ): OvernightMailChannelStatusSummary {
    const activeProvider = this.config.emailProvider;
    const detectedAgentMailReady = Boolean(agentMail.cliInstalled && agentMail.authorizedEmail);
    const detectedAgentMailAddress = agentMail.authorizedEmail ?? null;

    if (activeProvider === "agent_mail") {
      const addr = agentMail.authorizedEmail || this.config.agentMailAddress || null;
      const configured = Boolean(agentMail.cliInstalled && addr);
      const scopes = agentMail.scopes ?? [];
      const inboundReady = configured && (scopes.length === 0 || scopes.includes("mail:read"));
      const outboundReady = configured && (scopes.length === 0 || scopes.includes("mail:send"));
      return {
        activeProvider,
        configured,
        ready: configured && inboundReady && outboundReady,
        address: addr,
        inboundReady,
        outboundReady,
        detectedAgentMailReady,
        detectedAgentMailAddress,
        label: configured ? "已配置" : agentMail.cliInstalled ? "已安装 CLI · 待授权" : "未配置",
        summary: configured
          ? `Agent 邮箱已就绪（${addr}${agentMail.version ? ` · v${agentMail.version}` : ""}）`
          : agentMail.cliInstalled
            ? `已检测到 ${AGENT_MAIL_CLI_COMMAND}${agentMail.version ? ` v${agentMail.version}` : ""}，请完成 OAuth 授权登录`
            : `尚未安装 ${AGENT_MAIL_CLI_COMMAND}`,
      };
    }

    if (activeProvider === "gmail_oauth2") {
      const addr = this.config.gmail.boundEmail.trim() || null;
      const configured = Boolean(
        this.config.gmail.connected && secrets.hasGmailRefreshToken && this.config.gmail.clientId,
      );
      return {
        activeProvider,
        configured,
        ready: configured,
        address: addr,
        inboundReady: configured,
        outboundReady: configured,
        detectedAgentMailReady,
        detectedAgentMailAddress,
        label: configured ? "已配置" : "未配置",
        summary: configured
          ? `Gmail OAuth2 已绑定（${addr || "已授权"}）`
          : "Gmail OAuth2 尚未完成浏览器授权绑定",
      };
    }

    const email = this.config.imapSmtp.email.trim();
    const imapConfigured = Boolean(
      email && this.config.imapSmtp.imapHost.trim() && secrets.hasImapPassword,
    );
    const smtpConfigured = Boolean(
      email &&
      this.config.imapSmtp.smtpHost.trim() &&
      (secrets.hasSmtpPassword || secrets.hasImapPassword),
    );
    const imapSmtpConfigured = imapConfigured && smtpConfigured;

    // If IMAP/SMTP is still completely unconfigured, surface live detected Agent Mail readiness clearly!
    const effectiveConfigured = imapSmtpConfigured || detectedAgentMailReady;
    return {
      activeProvider: imapSmtpConfigured
        ? "imap_smtp"
        : detectedAgentMailReady
          ? "agent_mail"
          : "imap_smtp",
      configured: effectiveConfigured,
      ready: imapSmtpConfigured || detectedAgentMailReady,
      address: imapSmtpConfigured
        ? email
        : detectedAgentMailReady
          ? detectedAgentMailAddress
          : email || null,
      inboundReady: imapConfigured || detectedAgentMailReady,
      outboundReady: smtpConfigured || detectedAgentMailReady,
      detectedAgentMailReady,
      detectedAgentMailAddress,
      label: effectiveConfigured ? "已配置" : "未配置",
      summary: imapSmtpConfigured
        ? `IMAP/SMTP 已配置（${email}）`
        : detectedAgentMailReady
          ? `已自动检测到本机 Agent 邮箱就绪（${detectedAgentMailAddress}）`
          : "尚未配置收发邮箱凭据",
    };
  }

  private async probeAgentMailStatus(
    options: {
      force?: boolean;
      timeoutMs?: number;
      persistOnSuccess?: boolean;
    } = {},
  ): Promise<OvernightAgentMailRuntimeSnapshot> {
    const force = options.force === true;
    const timeoutMs = options.timeoutMs ?? AGENT_MAIL_SNAPSHOT_PROBE_TIMEOUT_MS;
    const now = this.now();

    if (
      !force &&
      this.agentMailProbeCache !== null &&
      now - this.agentMailProbeCache.checkedAt < AGENT_MAIL_PROBE_CACHE_TTL_MS
    ) {
      return this.buildAgentMailSnapshot(this.agentMailProbeCache);
    }

    if (!force && this.agentMailProbeInFlight !== null) {
      return this.agentMailProbeInFlight;
    }

    const execute = async (): Promise<OvernightAgentMailRuntimeSnapshot> => {
      const cliPath = await this.resolveAgentMailCliPath(force);
      if (!cliPath) {
        const entry = {
          checkedAt: this.now(),
          cliInstalled: false,
          version: null,
          loggedIn: false,
          authorizedEmail: this.config.agentMailAddress || null,
          scopes: [],
          dailySendQuota: null,
          lastError: null,
        };
        this.agentMailProbeCache = entry;
        return this.buildAgentMailSnapshot(entry);
      }

      try {
        const [meRes, verRes] = await Promise.all([
          this.runAgentMailCli(cliPath, ["+me"], timeoutMs),
          this.runAgentMailCli(cliPath, ["--version"], Math.min(timeoutMs, 3_000)).catch(() => ({
            exitCode: 1,
            stdout: "",
            stderr: "",
          })),
        ]);
        const version =
          verRes.exitCode === 0
            ? extractAgentMailVersion(`${verRes.stdout}\n${verRes.stderr}`)
            : null;
        const combined = `${meRes.stdout}\n${meRes.stderr}`;
        const meMeta = meRes.exitCode === 0 ? parseAgentMailMeOutput(combined) : null;
        const parsedEmail = meMeta?.email ?? null;
        let loggedIn = Boolean(parsedEmail);
        let lastError: string | null =
          meRes.exitCode === 0
            ? null
            : meRes.timedOut
              ? "检测 agently-cli +me 超时，请检查网络连接或点击「重新检测环境」。"
              : sanitizeAgentMailOutput(
                  meRes.stderr || meRes.stdout || meRes.errorMessage || "",
                  320,
                ) || null;

        // If `+me` failed (e.g. network hiccup or expired token), check local `auth status` quickly
        // so we accurately distinguish "not logged in" from "logged in locally, remote check failed".
        if (!parsedEmail) {
          try {
            const authStatusRes = await this.runAgentMailCli(
              cliPath,
              ["auth", "status"],
              Math.min(timeoutMs, 3_000),
            );
            const parsedAuth = extractJsonFromCliOutput(authStatusRes.stdout);
            if (isPlainRecord(parsedAuth)) {
              const authData = isPlainRecord(parsedAuth["data"]) ? parsedAuth["data"] : parsedAuth;
              if (authData["logged_in"] === true || authData["status"] === "logged_in") {
                loggedIn = true;
                if (authData["token_status"] === "expired") {
                  lastError =
                    "本地 agently-cli 登录令牌已过期，请重新点击「发起 OAuth 浏览器授权」或执行 agently-cli auth refresh。";
                } else if (meRes.timedOut) {
                  lastError =
                    "本机已登录 agently-cli，但联网校验身份（+me）超时，请检查网络后重试。";
                }
              }
            }
          } catch {
            // Older or mocked CLI may not implement `auth status`.
          }
        }

        if (parsedEmail) {
          this.agentMailLastError = null;
          if (options.persistOnSuccess !== false && parsedEmail !== this.config.agentMailAddress) {
            this.config.agentMailAddress = parsedEmail;
            this.persistConfig();
            this.onConfigChanged?.();
          }
        }

        const entry = {
          checkedAt: this.now(),
          cliInstalled: true,
          version,
          cliPath,
          loggedIn,
          authorizedEmail: parsedEmail,
          scopes: meMeta?.scopes ?? [],
          dailySendQuota: meMeta?.dailySendQuota ?? null,
          lastError,
        };
        this.agentMailProbeCache = entry;
        return this.buildAgentMailSnapshot(entry);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const entry = {
          checkedAt: this.now(),
          cliInstalled: true,
          version: null,
          cliPath,
          loggedIn: Boolean(this.config.agentMailAddress),
          authorizedEmail: this.config.agentMailAddress || null,
          scopes: [],
          dailySendQuota: null,
          lastError: sanitizeAgentMailOutput(msg, 320),
        };
        this.agentMailProbeCache = entry;
        return this.buildAgentMailSnapshot(entry);
      }
    };

    const runPromise = execute().finally(() => {
      if (this.agentMailProbeInFlight === runPromise) {
        this.agentMailProbeInFlight = null;
      }
    });
    if (!force) {
      this.agentMailProbeInFlight = runPromise;
    }
    return runPromise;
  }

  private loadPersistedConfig(): OvernightFactoryPersistedConfig {
    if (!NodeFS.existsSync(this.configPath)) {
      return createDefaultOvernightConfig();
    }
    try {
      const raw = JSON.parse(NodeFS.readFileSync(this.configPath, "utf8")) as unknown;
      return normalizePersistedConfig(raw);
    } catch {
      return createDefaultOvernightConfig();
    }
  }

  private persistConfig(): void {
    this.config = {
      ...this.config,
      updatedAt: this.now(),
    };
    writeJsonAtomic(this.configPath, this.config);
  }

  private loadPersistedTasks(): OvernightTaskDefinition[] {
    if (!NodeFS.existsSync(this.tasksPath)) {
      return [];
    }
    try {
      const parsed = JSON.parse(NodeFS.readFileSync(this.tasksPath, "utf8")) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item): item is OvernightTaskDefinition =>
            isPlainRecord(item) &&
            typeof item["id"] === "string" &&
            typeof item["prompt"] === "string",
        )
        .slice(0, MAX_PERSISTED_TASKS);
    } catch {
      return [];
    }
  }

  private persistTasks(): void {
    if (this.tasks.length > MAX_PERSISTED_TASKS) {
      this.tasks = this.tasks.slice(0, MAX_PERSISTED_TASKS);
    }
    writeJsonAtomic(this.tasksPath, this.tasks);
  }

  private loadPersistedRuns(): OvernightRunRecord[] {
    if (!NodeFS.existsSync(this.runsPath)) {
      return [];
    }
    try {
      const parsed = JSON.parse(NodeFS.readFileSync(this.runsPath, "utf8")) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item): item is OvernightRunRecord =>
            isPlainRecord(item) && typeof item["id"] === "string",
        )
        .slice(0, MAX_PERSISTED_RUNS);
    } catch {
      return [];
    }
  }

  private persistRuns(): void {
    if (this.runs.length > MAX_PERSISTED_RUNS) {
      this.runs = this.runs.slice(0, MAX_PERSISTED_RUNS);
    }
    writeJsonAtomic(this.runsPath, this.runs);
  }

  private appendRun(record: OvernightRunRecord): void {
    this.runs.unshift(record);
    if (this.runs.length > MAX_PERSISTED_RUNS) {
      this.runs.length = MAX_PERSISTED_RUNS;
    }
    this.persistRuns();
  }

  private appendRunLog(
    record: OvernightRunRecord,
    stage: OvernightExecutionStage,
    message: string,
    level: "info" | "warn" | "error" = "info",
  ): void {
    const logs = record.logs ?? [];
    logs.push({
      timestamp: this.now(),
      level,
      stage,
      message: message.slice(0, 500),
    });
    if (logs.length > MAX_LOGS_PER_RUN) {
      logs.splice(0, logs.length - MAX_LOGS_PER_RUN);
    }
    record.logs = logs;
    record.stage = stage;
    this.persistRuns();
  }

  private getCredentialFilePathDisplay(): string {
    if (this.credentialStore) {
      return this.credentialStore.getCredentialFilePath(OVERNIGHT_CREDENTIAL_BUCKET);
    }
    return NodePath.join(this.dataDir, "credentials", `${OVERNIGHT_CREDENTIAL_BUCKET}.enc`);
  }

  private openCredentials() {
    return this.credentialStore?.openForPlugin(OVERNIGHT_CREDENTIAL_BUCKET);
  }

  private async readSecrets(): Promise<ResolvedOvernightSecrets> {
    const handle = this.openCredentials();
    if (!handle) {
      return {};
    }
    const [gmailClientSecret, gmailRefreshToken, gmailAccessToken, imapPassword, smtpPassword] =
      await Promise.all([
        handle.get("gmail.clientSecret"),
        handle.get("gmail.refreshToken"),
        handle.get("gmail.accessToken"),
        handle.get("imap.password"),
        handle.get("smtp.password"),
      ]);
    return {
      ...(gmailClientSecret ? { gmailClientSecret } : {}),
      ...(gmailRefreshToken ? { gmailRefreshToken } : {}),
      ...(gmailAccessToken ? { gmailAccessToken } : {}),
      ...(imapPassword ? { imapPassword } : {}),
      ...(smtpPassword ? { smtpPassword } : {}),
    };
  }

  private async readSecretPresence(): Promise<OvernightSecretPresence> {
    const secrets = await this.readSecrets();
    return {
      hasGmailClientSecret: Boolean(secrets.gmailClientSecret),
      hasGmailRefreshToken: Boolean(secrets.gmailRefreshToken),
      hasImapPassword: Boolean(secrets.imapPassword),
      hasSmtpPassword: Boolean(secrets.smtpPassword || secrets.imapPassword),
    };
  }

  private purgeExpiredOAuthStates(): void {
    const now = this.now();
    for (const [key, session] of this.pendingOAuth.entries()) {
      if (session.expiresAt <= now) {
        this.pendingOAuth.delete(key);
      }
    }
  }

  private reconfigurePollTimer(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (!this.config.enabled) {
      return;
    }
    const intervalMs = Math.max(60_000, this.config.strategy.pollIntervalMinutes * 60_000);
    this.pollTimer = setInterval(() => {
      if (!this.config.enabled) return;
      const now = this.now();
      if (!isWithinExecutionWindow(this.config.strategy, now)) {
        return;
      }
      void this.pollNow({}, "owner_chief").catch(() => {
        // Error already recorded in lastPollError.
      });
      // Also trigger enabled scheduled overnight tasks at most once per 12h window.
      const twelveHoursMs = 12 * 60 * 60 * 1000;
      for (const task of this.tasks) {
        if (!task.enabled || task.triggerMode !== "scheduled") continue;
        if (task.lastRunAt !== null && now - task.lastRunAt < twelveHoursMs) continue;
        const alreadyRunning = this.runs.some(
          (r) => r.taskId === task.id && (r.status === "queued" || r.status === "running"),
        );
        if (alreadyRunning) continue;
        void this.runTaskById(task.id, { wait: false, source: "scheduled" }, "owner_chief").catch(
          () => {
            // Non-fatal scheduled task dispatch failure recorded on run or ignored.
          },
        );
      }
    }, intervalMs);
    this.pollTimer.unref?.();
  }

  async getConfigSnapshot(
    trustedCallerScope: CallerScope,
    options: { forceProbe?: boolean } = {},
  ): Promise<OvernightConfigSnapshot> {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/config");
    this.purgeExpiredOAuthStates();
    const [secrets, agentMail] = await Promise.all([
      this.readSecretPresence(),
      this.probeAgentMailStatus({
        force: options.forceProbe === true,
        timeoutMs: options.forceProbe
          ? AGENT_MAIL_STATUS_TIMEOUT_MS
          : AGENT_MAIL_SNAPSHOT_PROBE_TIMEOUT_MS,
        persistOnSuccess: true,
      }),
    ]);
    const mailStatus = this.buildMailChannelStatusSummary(secrets, agentMail);
    return {
      ok: true,
      config: structuredClone(this.config),
      secrets,
      credentialsFile: this.getCredentialFilePathDisplay(),
      agentMail,
      mailStatus,
      runtime: {
        pollerActive: this.pollTimer !== undefined && this.config.enabled,
        inAllowedWindow: isWithinExecutionWindow(this.config.strategy, this.now()),
        oauthPending: this.pendingOAuth.size > 0,
        lastPollAt: this.lastPollAt,
        lastPollError: this.lastPollError,
        lastTestResult: this.lastTestResult,
        runsCount: this.runs.length,
        activeRunsCount: this.activeRunControllers.size,
        tasksCount: this.tasks.length,
      },
    };
  }

  async getStatusSnapshot(
    trustedCallerScope: CallerScope,
    options: { forceProbe?: boolean } = {},
  ): Promise<
    OvernightConfigSnapshot & {
      installed: boolean;
      version: string | null;
      loggedIn: boolean;
      address: string | null;
      configured: boolean;
      binaryPath: string | null;
    }
  > {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/status");
    const snap = await this.getConfigSnapshot(trustedCallerScope, options);
    return {
      ...snap,
      installed: snap.agentMail.installed,
      version: snap.agentMail.version,
      loggedIn: snap.agentMail.loggedIn,
      address: snap.mailStatus.address,
      configured: snap.mailStatus.configured,
      binaryPath: snap.agentMail.binaryPath,
    };
  }

  async updateConfig(
    rawBody: unknown,
    trustedCallerScope: CallerScope,
  ): Promise<OvernightConfigSnapshot> {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/config");
    if (!isPlainRecord(rawBody)) {
      throw new BusinessRouteError(400, "INVALID_PARAMS", "Request body must be a JSON object.");
    }

    const next = structuredClone(this.config);

    if (typeof rawBody["enabled"] === "boolean") {
      next.enabled = rawBody["enabled"];
    }
    if (isOvernightEmailProvider(rawBody["emailProvider"])) {
      next.emailProvider = rawBody["emailProvider"];
      next.mode = rawBody["emailProvider"] === "gmail_oauth2" ? "gmail-oauth2" : "imap";
      if (rawBody["emailProvider"] === "agent_mail") {
        next.imapSmtp.preset = "agent_mail";
      }
    } else if (rawBody["mode"] === "gmail-oauth2" || rawBody["mode"] === "imap") {
      next.mode = rawBody["mode"];
      next.emailProvider = rawBody["mode"] === "gmail-oauth2" ? "gmail_oauth2" : "imap_smtp";
    }
    if (typeof rawBody["agentMailAddress"] === "string") {
      next.agentMailAddress = rawBody["agentMailAddress"].trim();
    }
    if (typeof rawBody["testRecipient"] === "string") {
      const normalizedTestRecipient = normalizeTestRecipient(rawBody["testRecipient"]);
      if (
        normalizedTestRecipient.length === 0 ||
        isValidTestRecipientEmail(normalizedTestRecipient)
      ) {
        next.testRecipient = normalizedTestRecipient;
      }
    }

    if (isPlainRecord(rawBody["gmail"])) {
      const g = rawBody["gmail"];
      if (typeof g["clientId"] === "string") next.gmail.clientId = g["clientId"].trim();
      if (typeof g["redirectUri"] === "string") next.gmail.redirectUri = g["redirectUri"].trim();
      if (typeof g["boundEmail"] === "string") next.gmail.boundEmail = g["boundEmail"].trim();
    }

    if (isPlainRecord(rawBody["imapSmtp"])) {
      const im = rawBody["imapSmtp"];
      const incomingEmail =
        typeof im["email"] === "string" ? im["email"].trim() : next.imapSmtp.email;
      if (isOvernightMailPresetId(im["preset"])) {
        const canonicalPreset = normalizeOvernightMailPresetId(im["preset"], next.imapSmtp.preset);
        next.imapSmtp.preset = canonicalPreset;
        if (
          canonicalPreset === "agent_mail" &&
          !isOvernightEmailProvider(rawBody["emailProvider"])
        ) {
          next.emailProvider = "agent_mail";
          next.mode = "imap";
        } else if (
          canonicalPreset !== "agent_mail" &&
          !isOvernightEmailProvider(rawBody["emailProvider"]) &&
          rawBody["mode"] !== "gmail-oauth2" &&
          next.emailProvider === "agent_mail"
        ) {
          next.emailProvider = "imap_smtp";
        }
        if (canonicalPreset !== "custom" && canonicalPreset !== "agent_mail") {
          const presetSpec = resolveOvernightMailPresetSpec(im["preset"], incomingEmail);
          if (typeof im["imapHost"] !== "string" || im["imapHost"].trim().length === 0) {
            next.imapSmtp.imapHost = presetSpec.imapHost;
          }
          if (im["imapPort"] === undefined) {
            next.imapSmtp.imapPort = presetSpec.imapPort;
          }
          if (typeof im["imapSecure"] !== "boolean") {
            next.imapSmtp.imapSecure = presetSpec.imapSecure;
          }
          if (typeof im["smtpHost"] !== "string" || im["smtpHost"].trim().length === 0) {
            next.imapSmtp.smtpHost = presetSpec.smtpHost;
          }
          if (im["smtpPort"] === undefined) {
            next.imapSmtp.smtpPort = presetSpec.smtpPort;
          }
          if (typeof im["smtpSecure"] !== "boolean") {
            next.imapSmtp.smtpSecure = presetSpec.smtpSecure;
          }
        }
      }
      if (typeof im["email"] === "string") {
        next.imapSmtp.email = incomingEmail;
        const detectedNetease = detectNeteaseDomainFromEmail(incomingEmail);
        if (
          detectedNetease !== null &&
          next.imapSmtp.preset === "netease" &&
          (typeof im["imapHost"] !== "string" || im["imapHost"].trim().length === 0) &&
          (typeof im["smtpHost"] !== "string" || im["smtpHost"].trim().length === 0)
        ) {
          const hosts = NETEASE_MAIL_DOMAIN_HOSTS[detectedNetease];
          next.imapSmtp.imapHost = hosts.imapHost;
          next.imapSmtp.imapPort = hosts.imapPort;
          next.imapSmtp.imapSecure = hosts.imapSecure;
          next.imapSmtp.smtpHost = hosts.smtpHost;
          next.imapSmtp.smtpPort = hosts.smtpPort;
          next.imapSmtp.smtpSecure = hosts.smtpSecure;
        }
      }
      if (
        typeof im["imapHost"] === "string" &&
        (next.imapSmtp.preset === "custom" || im["imapHost"].trim().length > 0)
      ) {
        next.imapSmtp.imapHost = im["imapHost"].trim();
      }
      if (im["imapPort"] !== undefined) {
        next.imapSmtp.imapPort = clampPort(im["imapPort"], next.imapSmtp.imapPort);
      }
      if (typeof im["imapSecure"] === "boolean") next.imapSmtp.imapSecure = im["imapSecure"];
      if (typeof im["imapUsername"] === "string") {
        next.imapSmtp.imapUsername = im["imapUsername"].trim();
      }
      if (typeof im["mailbox"] === "string" && im["mailbox"].trim().length > 0) {
        next.imapSmtp.mailbox = im["mailbox"].trim();
      }
      if (
        typeof im["smtpHost"] === "string" &&
        (next.imapSmtp.preset === "custom" || im["smtpHost"].trim().length > 0)
      ) {
        next.imapSmtp.smtpHost = im["smtpHost"].trim();
      }
      if (im["smtpPort"] !== undefined) {
        next.imapSmtp.smtpPort = clampPort(im["smtpPort"], next.imapSmtp.smtpPort);
      }
      if (typeof im["smtpSecure"] === "boolean") next.imapSmtp.smtpSecure = im["smtpSecure"];
      if (typeof im["smtpUsername"] === "string") {
        next.imapSmtp.smtpUsername = im["smtpUsername"].trim();
      }
      if (typeof im["fromName"] === "string" && im["fromName"].trim().length > 0) {
        next.imapSmtp.fromName = im["fromName"].trim();
      }
      if (typeof im["useSeparateSmtpPassword"] === "boolean") {
        next.imapSmtp.useSeparateSmtpPassword = im["useSeparateSmtpPassword"];
      }
    }

    if (isPlainRecord(rawBody["strategy"])) {
      const st = rawBody["strategy"];
      if (typeof st["triggerTag"] === "string" && st["triggerTag"].trim().length > 0) {
        next.strategy.triggerTag = st["triggerTag"].trim();
      }
      if (st["allowedSenders"] !== undefined) {
        next.strategy.allowedSenders = normalizeAllowedSenders(st["allowedSenders"]);
      }
      if (st["windowMode"] === "scheduled" || st["windowMode"] === "always") {
        next.strategy.windowMode = st["windowMode"];
      }
      if (st["windowStart"] !== undefined) {
        next.strategy.windowStart = normalizeTimeHHMM(st["windowStart"], next.strategy.windowStart);
      }
      if (st["windowEnd"] !== undefined) {
        next.strategy.windowEnd = normalizeTimeHHMM(st["windowEnd"], next.strategy.windowEnd);
      }
      if (st["pollIntervalMinutes"] !== undefined) {
        next.strategy.pollIntervalMinutes = clampPollMinutes(
          st["pollIntervalMinutes"],
          next.strategy.pollIntervalMinutes,
        );
      }
      if (typeof st["targetWorkspaceDir"] === "string") {
        next.strategy.targetWorkspaceDir = st["targetWorkspaceDir"].trim();
      }
      if (typeof st["agentProvider"] === "string" && st["agentProvider"].trim().length > 0) {
        const candidateProvider = st["agentProvider"].trim();
        if (isAntigravityProvider(candidateProvider)) {
          throw new BusinessRouteError(
            403,
            "AGY_UNATTENDED_FORBIDDEN",
            "24h 无人值守夜间工场禁止将执行节点配置为个人版 Antigravity（AGY），请使用 codex / claudeAgent / opencode。",
          );
        }
        next.strategy.agentProvider = candidateProvider;
      }
      if (typeof st["agentModel"] === "string") {
        next.strategy.agentModel = st["agentModel"].trim();
      }
      if (
        st["secretaryBrain"] === "gemini-api" ||
        st["secretaryBrain"] === "codex" ||
        st["secretaryBrain"] === "claude-code"
      ) {
        next.strategy.secretaryBrain = st["secretaryBrain"];
      }
      if (typeof st["oracleReviewEnabled"] === "boolean") {
        next.strategy.oracleReviewEnabled = st["oracleReviewEnabled"];
      }
      if (typeof st["localWorktreeOnlyNoPush"] === "boolean") {
        next.strategy.localWorktreeOnlyNoPush = st["localWorktreeOnlyNoPush"];
      }
    }

    // Write-only encrypted secrets handling (NEVER persisted to overnight-factory.json)
    const credHandle = this.openCredentials();
    const secretsBody = isPlainRecord(rawBody["secrets"]) ? rawBody["secrets"] : {};
    const writeSecretIfNonEmpty = async (key: string, value: unknown): Promise<void> => {
      if (typeof value === "string" && value.trim().length > 0) {
        if (!credHandle) {
          throw new BusinessRouteError(
            503,
            "CREDENTIAL_STORE_UNAVAILABLE",
            "Encrypted credential store is not configured.",
          );
        }
        await credHandle.set(key, value.trim());
      }
    };

    const gmailRaw = isPlainRecord(rawBody["gmail"]) ? rawBody["gmail"] : {};
    const imapRaw = isPlainRecord(rawBody["imapSmtp"]) ? rawBody["imapSmtp"] : {};

    await writeSecretIfNonEmpty(
      "gmail.clientSecret",
      secretsBody["gmailClientSecret"] ?? gmailRaw["clientSecret"],
    );
    await writeSecretIfNonEmpty(
      "gmail.refreshToken",
      secretsBody["gmailRefreshToken"] ?? gmailRaw["refreshToken"],
    );
    await writeSecretIfNonEmpty(
      "imap.password",
      secretsBody["imapPassword"] ?? imapRaw["password"] ?? imapRaw["imapPassword"],
    );
    await writeSecretIfNonEmpty(
      "smtp.password",
      secretsBody["smtpPassword"] ?? imapRaw["smtpPassword"],
    );

    // If user explicitly disabled separate SMTP password without providing a new one,
    // clear any stale separate `smtp.password` so SMTP reliably inherits `imap.password`.
    if (
      credHandle &&
      next.imapSmtp.useSeparateSmtpPassword === false &&
      !(
        typeof (secretsBody["smtpPassword"] ?? imapRaw["smtpPassword"]) === "string" &&
        String(secretsBody["smtpPassword"] ?? imapRaw["smtpPassword"]).trim().length > 0
      )
    ) {
      await credHandle.delete("smtp.password");
    }

    // Optional explicit secret clearing
    if (isPlainRecord(rawBody["clearSecrets"]) && credHandle) {
      const clear = rawBody["clearSecrets"];
      if (clear["gmailClientSecret"] === true) await credHandle.delete("gmail.clientSecret");
      if (clear["gmailRefreshToken"] === true) {
        await credHandle.delete("gmail.refreshToken");
        await credHandle.delete("gmail.accessToken");
        next.gmail.connected = false;
        next.gmail.connectedAt = null;
      }
      if (clear["imapPassword"] === true) await credHandle.delete("imap.password");
      if (clear["smtpPassword"] === true) await credHandle.delete("smtp.password");
    }

    // If refresh token was manually supplied, mark connected state if boundEmail exists
    const postSecrets = await this.readSecrets();
    if (postSecrets.gmailRefreshToken && next.gmail.boundEmail && !next.gmail.connected) {
      next.gmail.connected = true;
      next.gmail.connectedAt = this.now();
    }

    this.config = next;
    this.persistConfig();
    this.reconfigurePollTimer();
    this.onConfigChanged?.();

    return this.getConfigSnapshot(trustedCallerScope);
  }

  async startGmailOAuth(
    rawBody: unknown,
    trustedCallerScope: CallerScope,
    daemonOrigin: string,
  ): Promise<OvernightGmailOAuthStartResult> {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/oauth/gmail/start");
    this.purgeExpiredOAuthStates();

    const body = isPlainRecord(rawBody) ? rawBody : {};
    const storedSecrets = await this.readSecrets();
    const clientId =
      typeof body["clientId"] === "string" && body["clientId"].trim().length > 0
        ? body["clientId"].trim()
        : this.config.gmail.clientId;
    const clientSecret =
      typeof body["clientSecret"] === "string" && body["clientSecret"].trim().length > 0
        ? body["clientSecret"].trim()
        : (storedSecrets.gmailClientSecret ?? "");
    const defaultRedirect = `${daemonOrigin.replace(/\/+$/, "")}/v1/overnight/oauth/gmail/callback`;
    const redirectUri =
      typeof body["redirectUri"] === "string" && body["redirectUri"].trim().length > 0
        ? body["redirectUri"].trim()
        : this.config.gmail.redirectUri || defaultRedirect;

    if (!clientId) {
      throw new BusinessRouteError(
        400,
        "GMAIL_CLIENT_ID_MISSING",
        "请先填写 Google OAuth Client ID 后再启动 Gmail 授权绑定。",
      );
    }
    if (!clientSecret) {
      throw new BusinessRouteError(
        400,
        "GMAIL_CLIENT_SECRET_MISSING",
        "请先填写并保存 Google OAuth Client Secret 后再启动 Gmail 授权绑定。",
      );
    }

    // Persist clientId / redirectUri & seal clientSecret if freshly passed
    const credHandle = this.openCredentials();
    if (
      typeof body["clientSecret"] === "string" &&
      body["clientSecret"].trim().length > 0 &&
      credHandle
    ) {
      await credHandle.set("gmail.clientSecret", body["clientSecret"].trim());
    }
    this.config.gmail.clientId = clientId;
    this.config.gmail.redirectUri = redirectUri;
    this.persistConfig();

    const state = NodeCrypto.randomBytes(24).toString("base64url");
    const codeVerifier = NodeCrypto.randomBytes(32).toString("base64url");
    const codeChallenge = createPkceChallenge(codeVerifier);
    const createdAt = this.now();
    const expiresAt = createdAt + OAUTH_STATE_TTL_MS;

    this.pendingOAuth.set(state, {
      state,
      codeVerifier,
      clientId,
      clientSecret,
      redirectUri,
      createdAt,
      expiresAt,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: [
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/userinfo.email",
      ].join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    return {
      ok: true,
      authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      state,
      redirectUri,
      expiresAt,
    };
  }

  /**
   * Handles Google's OAuth2 browser redirect callback (`GET /v1/overnight/oauth/gmail/callback`).
   * Authenticated by the one-time cryptographic `state` generated in `startGmailOAuth`.
   */
  async handleGmailOAuthCallback(
    searchParams: URLSearchParams,
  ): Promise<OvernightGmailOAuthCallbackResult> {
    this.purgeExpiredOAuthStates();
    const errorParam = searchParams.get("error")?.trim();
    const state = searchParams.get("state")?.trim() ?? "";
    const code = searchParams.get("code")?.trim() ?? "";

    if (errorParam) {
      if (state) this.pendingOAuth.delete(state);
      return {
        statusCode: 400,
        ok: false,
        message: `Google OAuth 授权被拒绝：${errorParam}`,
        html: renderOAuthCallbackHtml({
          ok: false,
          title: "授权已取消或被拒绝",
          detail: `Google 返回错误：${errorParam}`,
        }),
      };
    }

    const session = this.pendingOAuth.get(state);
    if (!session) {
      return {
        statusCode: 400,
        ok: false,
        message: "无效或已过期的 OAuth state 参数，请重新在 Prismux 中发起绑定。",
        html: renderOAuthCallbackHtml({
          ok: false,
          title: "授权会话已过期",
          detail: "请返回 Prismux「夜间工场与邮箱」页面重新点击「一键浏览器登录绑定 Gmail」。",
        }),
      };
    }
    this.pendingOAuth.delete(state);

    if (!code) {
      return {
        statusCode: 400,
        ok: false,
        message: "回调缺少 authorization code。",
        html: renderOAuthCallbackHtml({
          ok: false,
          title: "缺少授权码",
          detail: "回调 URL 中未包含有效的 code 参数。",
        }),
      };
    }

    const fetchImpl = this.hooks.fetchFn ?? fetch;
    try {
      const tokenBody = new URLSearchParams({
        code,
        client_id: session.clientId,
        client_secret: session.clientSecret,
        redirect_uri: session.redirectUri,
        grant_type: "authorization_code",
        code_verifier: session.codeVerifier,
      });

      const tokenRes = await fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text().catch(() => "");
        return {
          statusCode: 502,
          ok: false,
          message: `换取 Gmail Token 失败 (HTTP ${tokenRes.status})`,
          html: renderOAuthCallbackHtml({
            ok: false,
            title: "换取访问令牌失败",
            detail: `Google Token 接口返回 HTTP ${tokenRes.status}${errText ? `：${errText.slice(0, 180)}` : ""}`,
          }),
        };
      }

      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
      };
      const accessToken = tokenJson.access_token ?? "";
      const refreshToken = tokenJson.refresh_token ?? "";
      if (!accessToken) {
        return {
          statusCode: 502,
          ok: false,
          message: "Google Token 响应缺少 access_token。",
          html: renderOAuthCallbackHtml({
            ok: false,
            title: "令牌响应异常",
            detail: "Google 未返回有效的 access_token。",
          }),
        };
      }

      // Fetch Gmail profile address
      let boundEmail = this.config.gmail.boundEmail;
      try {
        const profileRes = await fetchImpl(
          "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );
        if (profileRes.ok) {
          const profile = (await profileRes.json()) as {
            emailAddress?: string;
            historyId?: string;
          };
          if (typeof profile.emailAddress === "string" && profile.emailAddress.trim()) {
            boundEmail = profile.emailAddress.trim();
          }
          if (typeof profile.historyId === "string" && profile.historyId.trim()) {
            this.config.gmail.lastHistoryId = profile.historyId.trim();
          }
        }
      } catch {
        // Fallback to userinfo if Gmail profile call fails
        try {
          const infoRes = await fetchImpl("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (infoRes.ok) {
            const info = (await infoRes.json()) as { email?: string };
            if (typeof info.email === "string" && info.email.trim()) {
              boundEmail = info.email.trim();
            }
          }
        } catch {
          // ignore
        }
      }

      const credHandle = this.openCredentials();
      if (credHandle) {
        await credHandle.set("gmail.accessToken", accessToken);
        if (refreshToken) {
          await credHandle.set("gmail.refreshToken", refreshToken);
        }
      }

      this.config.mode = "gmail-oauth2";
      this.config.emailProvider = "gmail_oauth2";
      this.config.gmail.boundEmail = boundEmail;
      this.config.gmail.connected = true;
      this.config.gmail.connectedAt = this.now();
      if (boundEmail && this.config.strategy.allowedSenders.length === 0) {
        this.config.strategy.allowedSenders = [boundEmail.toLowerCase()];
      }
      this.persistConfig();
      this.onConfigChanged?.();

      return {
        statusCode: 200,
        ok: true,
        boundEmail,
        message: `Gmail 账号 ${boundEmail || "(已授权)"} 绑定成功，Refresh Token 已加密密封保存。`,
        html: renderOAuthCallbackHtml({
          ok: true,
          title: `已绑定 ${boundEmail || "Gmail 账号"}`,
          detail:
            "OAuth 凭据已加密保存至 ~/.prismux/credentials/overnight-factory.enc（权限 0600）。",
        }),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        statusCode: 500,
        ok: false,
        message: `Gmail OAuth 回调处理失败：${msg}`,
        html: renderOAuthCallbackHtml({
          ok: false,
          title: "绑定过程发生错误",
          detail: msg,
        }),
      };
    }
  }

  async disconnectGmail(trustedCallerScope: CallerScope): Promise<OvernightConfigSnapshot> {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/oauth/gmail/disconnect");
    const credHandle = this.openCredentials();
    if (credHandle) {
      await credHandle.delete("gmail.refreshToken");
      await credHandle.delete("gmail.accessToken");
    }
    this.config.gmail.connected = false;
    this.config.gmail.connectedAt = null;
    this.config.gmail.boundEmail = "";
    delete this.config.gmail.lastHistoryId;
    this.persistConfig();
    this.onConfigChanged?.();
    return this.getConfigSnapshot(trustedCallerScope);
  }

  private async resolveEffectiveMailInput(rawOverride?: unknown): Promise<{
    config: OvernightFactoryPersistedConfig;
    secrets: ResolvedOvernightSecrets;
  }> {
    const storedSecrets = await this.readSecrets();
    if (!isPlainRecord(rawOverride)) {
      return { config: structuredClone(this.config), secrets: storedSecrets };
    }

    const merged = structuredClone(this.config);
    if (isOvernightEmailProvider(rawOverride["emailProvider"])) {
      merged.emailProvider = rawOverride["emailProvider"];
      merged.mode = rawOverride["emailProvider"] === "gmail_oauth2" ? "gmail-oauth2" : "imap";
      if (rawOverride["emailProvider"] === "agent_mail") {
        merged.imapSmtp.preset = "agent_mail";
      }
    } else if (rawOverride["mode"] === "gmail-oauth2" || rawOverride["mode"] === "imap") {
      merged.mode = rawOverride["mode"];
      merged.emailProvider = rawOverride["mode"] === "gmail-oauth2" ? "gmail_oauth2" : "imap_smtp";
    }
    if (typeof rawOverride["agentMailAddress"] === "string") {
      merged.agentMailAddress = rawOverride["agentMailAddress"].trim();
    }
    if (typeof rawOverride["testRecipient"] === "string") {
      const normalizedTestRecipient = normalizeTestRecipient(rawOverride["testRecipient"]);
      if (
        normalizedTestRecipient.length === 0 ||
        isValidTestRecipientEmail(normalizedTestRecipient)
      ) {
        merged.testRecipient = normalizedTestRecipient;
      }
    }
    if (isPlainRecord(rawOverride["gmail"])) {
      const g = rawOverride["gmail"];
      if (typeof g["clientId"] === "string") merged.gmail.clientId = g["clientId"].trim();
      if (typeof g["boundEmail"] === "string") merged.gmail.boundEmail = g["boundEmail"].trim();
    }
    if (isPlainRecord(rawOverride["imapSmtp"])) {
      const im = rawOverride["imapSmtp"];
      const incomingEmail =
        typeof im["email"] === "string" ? im["email"].trim() : merged.imapSmtp.email;
      if (isOvernightMailPresetId(im["preset"])) {
        const canonicalPreset = normalizeOvernightMailPresetId(
          im["preset"],
          merged.imapSmtp.preset,
        );
        merged.imapSmtp.preset = canonicalPreset;
        if (
          canonicalPreset === "agent_mail" &&
          !isOvernightEmailProvider(rawOverride["emailProvider"])
        ) {
          merged.emailProvider = "agent_mail";
          merged.mode = "imap";
        }
        if (canonicalPreset !== "custom" && canonicalPreset !== "agent_mail") {
          const presetSpec = resolveOvernightMailPresetSpec(im["preset"], incomingEmail);
          if (typeof im["imapHost"] !== "string" || im["imapHost"].trim().length === 0) {
            merged.imapSmtp.imapHost = presetSpec.imapHost;
          }
          if (im["imapPort"] === undefined) {
            merged.imapSmtp.imapPort = presetSpec.imapPort;
          }
          if (typeof im["imapSecure"] !== "boolean") {
            merged.imapSmtp.imapSecure = presetSpec.imapSecure;
          }
          if (typeof im["smtpHost"] !== "string" || im["smtpHost"].trim().length === 0) {
            merged.imapSmtp.smtpHost = presetSpec.smtpHost;
          }
          if (im["smtpPort"] === undefined) {
            merged.imapSmtp.smtpPort = presetSpec.smtpPort;
          }
          if (typeof im["smtpSecure"] !== "boolean") {
            merged.imapSmtp.smtpSecure = presetSpec.smtpSecure;
          }
        }
      }
      if (typeof im["email"] === "string") merged.imapSmtp.email = incomingEmail;
      if (
        typeof im["imapHost"] === "string" &&
        (merged.imapSmtp.preset === "custom" || im["imapHost"].trim().length > 0)
      ) {
        merged.imapSmtp.imapHost = im["imapHost"].trim();
      }
      if (im["imapPort"] !== undefined) {
        merged.imapSmtp.imapPort = clampPort(im["imapPort"], merged.imapSmtp.imapPort);
      }
      if (typeof im["imapSecure"] === "boolean") merged.imapSmtp.imapSecure = im["imapSecure"];
      if (typeof im["imapUsername"] === "string") {
        merged.imapSmtp.imapUsername = im["imapUsername"].trim();
      }
      if (typeof im["mailbox"] === "string" && im["mailbox"].trim().length > 0) {
        merged.imapSmtp.mailbox = im["mailbox"].trim();
      }
      if (
        typeof im["smtpHost"] === "string" &&
        (merged.imapSmtp.preset === "custom" || im["smtpHost"].trim().length > 0)
      ) {
        merged.imapSmtp.smtpHost = im["smtpHost"].trim();
      }
      if (im["smtpPort"] !== undefined) {
        merged.imapSmtp.smtpPort = clampPort(im["smtpPort"], merged.imapSmtp.smtpPort);
      }
      if (typeof im["smtpSecure"] === "boolean") merged.imapSmtp.smtpSecure = im["smtpSecure"];
      if (typeof im["smtpUsername"] === "string") {
        merged.imapSmtp.smtpUsername = im["smtpUsername"].trim();
      }
      if (typeof im["useSeparateSmtpPassword"] === "boolean") {
        merged.imapSmtp.useSeparateSmtpPassword = im["useSeparateSmtpPassword"];
      }
    }

    const secretsOverride = isPlainRecord(rawOverride["secrets"]) ? rawOverride["secrets"] : {};
    const hasExplicitSmtpSecretOverride =
      typeof secretsOverride["smtpPassword"] === "string" &&
      secretsOverride["smtpPassword"].trim().length > 0;
    const effectiveSecrets: ResolvedOvernightSecrets = {
      ...storedSecrets,
      ...(typeof secretsOverride["gmailClientSecret"] === "string" &&
      secretsOverride["gmailClientSecret"].trim()
        ? { gmailClientSecret: secretsOverride["gmailClientSecret"].trim() }
        : {}),
      ...(typeof secretsOverride["gmailRefreshToken"] === "string" &&
      secretsOverride["gmailRefreshToken"].trim()
        ? { gmailRefreshToken: secretsOverride["gmailRefreshToken"].trim() }
        : {}),
      ...(typeof secretsOverride["imapPassword"] === "string" &&
      secretsOverride["imapPassword"].trim()
        ? { imapPassword: secretsOverride["imapPassword"].trim() }
        : {}),
      ...(hasExplicitSmtpSecretOverride
        ? { smtpPassword: (secretsOverride["smtpPassword"] as string).trim() }
        : {}),
    };
    if (merged.imapSmtp.useSeparateSmtpPassword === false && !hasExplicitSmtpSecretOverride) {
      delete effectiveSecrets.smtpPassword;
    }

    return { config: merged, secrets: effectiveSecrets };
  }

  private async refreshGmailAccessToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
  ): Promise<{ accessToken: string; scope?: string }> {
    const fetchImpl = this.hooks.fetchFn ?? fetch;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    const res = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (/invalid_grant/i.test(errText)) {
        throw new Error(
          "Gmail Refresh Token 已失效或已被撤销（invalid_grant），请点击「解除绑定」后重新完成浏览器授权。",
        );
      }
      if (/invalid_client/i.test(errText)) {
        throw new Error(
          "Google OAuth Client ID 或 Client Secret 无效（invalid_client），请核对凭据后重试。",
        );
      }
      throw new Error(
        `Gmail OAuth Token 刷新失败 (HTTP ${res.status})${errText ? `：${errText.slice(0, 160)}` : ""}`,
      );
    }
    const json = (await res.json()) as { access_token?: string; scope?: string };
    if (!json.access_token) {
      throw new Error("Gmail Token 响应缺少 access_token。");
    }
    return {
      accessToken: json.access_token,
      ...(typeof json.scope === "string" && json.scope.trim().length > 0
        ? { scope: json.scope.trim() }
        : {}),
    };
  }

  private async sendViaGmailApi(
    accessToken: string,
    fromAddress: string,
    fromName: string,
    payload: OutboundMailPayload,
  ): Promise<OutboundMailReceipt> {
    const fetchImpl = this.hooks.fetchFn ?? fetch;
    const messageId = `prismux-${Date.now()}-${NodeCrypto.randomUUID().slice(0, 8)}@prismux.local`;
    const mime = buildRfc2822MimeMessage({
      fromAddress,
      fromName,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      messageId,
      inReplyTo: payload.inReplyTo,
      references: payload.references,
    });
    const rawB64Url = Buffer.from(mime, "utf8")
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const res = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw: rawB64Url }),
    });
    if (!res.ok) {
      throw new Error(`Gmail API 发信失败 (HTTP ${res.status})`);
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return {
      messageId: json.id ?? messageId,
      acceptedAt: this.now(),
      provider: "gmail-oauth2",
    };
  }

  private persistAgentMailActiveIfUnconfigured(authorizedEmail: string | null): void {
    let changed = false;
    if (authorizedEmail && authorizedEmail !== this.config.agentMailAddress) {
      this.config.agentMailAddress = authorizedEmail;
      changed = true;
    }
    const hasOtherConfigured =
      this.config.gmail.connected || Boolean(this.config.imapSmtp.email.trim());
    if (authorizedEmail && !hasOtherConfigured && this.config.emailProvider !== "agent_mail") {
      this.config.emailProvider = "agent_mail";
      this.config.mode = "imap";
      this.config.imapSmtp.preset = "agent_mail";
      changed = true;
    }
    if (changed) {
      this.persistConfig();
      this.onConfigChanged?.();
    }
  }

  private async handleAgentMailStatusAction(startedAt: number): Promise<OvernightMailTestResult> {
    const snapshot = await this.probeAgentMailStatus({
      force: true,
      timeoutMs: AGENT_MAIL_STATUS_TIMEOUT_MS,
      persistOnSuccess: true,
    });
    if (snapshot.authorizedEmail) {
      this.persistAgentMailActiveIfUnconfigured(snapshot.authorizedEmail);
    }
    const durationMs = Math.max(1, this.now() - startedAt);
    const installed = snapshot.cliInstalled;
    const authorizedEmail = snapshot.authorizedEmail ?? null;
    const ok = installed && Boolean(authorizedEmail);
    const scopes = snapshot.scopes ?? [];
    const hasSendScope = scopes.length === 0 || scopes.includes("mail:send");
    const hasReadScope = scopes.length === 0 || scopes.includes("mail:read");
    const message = !installed
      ? `未检测到 ${AGENT_MAIL_CLI_COMMAND}，请先点击「一键安装 / 更新 CLI」安装 ${AGENT_MAIL_NPM_PACKAGE}。`
      : authorizedEmail
        ? `Agent 邮箱已配置并授权：${authorizedEmail}${snapshot.version ? `（agently-cli v${snapshot.version}）` : ""}`
        : snapshot.lastError ||
          `已安装 ${AGENT_MAIL_CLI_COMMAND}${snapshot.version ? ` v${snapshot.version}` : ""}，但尚未完成 OAuth 授权，请点击「发起 OAuth 浏览器授权」。`;

    const res: OvernightMailTestResult = {
      ok: ok && hasSendScope && hasReadScope,
      mode: "imap",
      emailProvider: "agent_mail",
      agentMailAction: "status",
      installed,
      version: snapshot.version,
      ...(snapshot.cliPath ? { cliPath: snapshot.cliPath } : {}),
      binaryPath: snapshot.binaryPath,
      loggedIn: snapshot.loggedIn,
      configured: snapshot.configured,
      authorizedEmail,
      address: authorizedEmail,
      authInProgress: Boolean(snapshot.authInProgress),
      authUrl: snapshot.pendingAuthUrl ?? null,
      agentMail: snapshot,
      checkedAt: this.now(),
      durationMs,
      inbound: {
        ok: ok && hasReadScope,
        latencyMs: durationMs,
        message:
          ok && !hasReadScope
            ? "当前 Agent 邮箱授权缺少 mail:read 收信权限，请重新发起 OAuth 授权。"
            : message,
        ...(snapshot.cliPath ? { detail: snapshot.cliPath } : {}),
      },
      outbound: {
        ok: ok && hasSendScope,
        latencyMs: durationMs,
        message:
          ok && !hasSendScope
            ? "当前 Agent 邮箱授权缺少 mail:send 发信权限，请重新发起 OAuth 授权。"
            : ok
              ? `agently-cli 发信通道就绪（${authorizedEmail}${snapshot.dailySendQuota ? ` · 日额度 ${snapshot.dailySendQuota} 封` : ""}）`
              : message,
      },
      message,
    };
    this.lastTestResult = res;
    return res;
  }

  private async handleAgentMailInstallAction(startedAt: number): Promise<OvernightMailTestResult> {
    const installFn = this.hooks.installAgentMailCli ?? defaultInstallAgentMailCli;
    const cmdOut = await installFn(AGENT_MAIL_INSTALL_TIMEOUT_MS);
    this.agentMailProbeCache = null;

    const stdout = sanitizeAgentMailOutput(cmdOut.stdout);
    const stderr = sanitizeAgentMailOutput(cmdOut.stderr);
    const snapshot = await this.probeAgentMailStatus({
      force: true,
      timeoutMs: AGENT_MAIL_SNAPSHOT_PROBE_TIMEOUT_MS,
      persistOnSuccess: true,
    });
    if (snapshot.authorizedEmail) {
      this.persistAgentMailActiveIfUnconfigured(snapshot.authorizedEmail);
    }
    const durationMs = Math.max(1, this.now() - startedAt);
    const ok = cmdOut.exitCode === 0 && snapshot.cliInstalled;
    const message = ok
      ? snapshot.authorizedEmail
        ? `已安装并验证 ${AGENT_MAIL_NPM_PACKAGE}${snapshot.version ? ` v${snapshot.version}` : ""}（当前已授权邮箱：${snapshot.authorizedEmail}）。`
        : `已成功安装 / 更新 ${AGENT_MAIL_NPM_PACKAGE}${snapshot.version ? ` v${snapshot.version}` : ""}，接下来请点击「发起 OAuth 浏览器授权」。`
      : cmdOut.timedOut
        ? `安装 ${AGENT_MAIL_NPM_PACKAGE} 超时，请检查网络连接或在终端手动运行 npm install -g ${AGENT_MAIL_NPM_PACKAGE}。`
        : `安装 ${AGENT_MAIL_NPM_PACKAGE} 失败（退出码 ${cmdOut.exitCode}）：${stderr || cmdOut.errorMessage || stdout || "未知错误"}`;

    if (!ok) {
      this.agentMailLastError = message;
    } else {
      this.agentMailLastError = null;
    }

    const res: OvernightMailTestResult = {
      ok,
      mode: "imap",
      emailProvider: "agent_mail",
      agentMailAction: "install",
      installed: snapshot.cliInstalled,
      version: snapshot.version,
      ...(snapshot.cliPath ? { cliPath: snapshot.cliPath } : {}),
      binaryPath: snapshot.binaryPath,
      loggedIn: snapshot.loggedIn,
      configured: snapshot.configured,
      authorizedEmail: snapshot.authorizedEmail ?? null,
      address: snapshot.authorizedEmail ?? null,
      authInProgress: Boolean(snapshot.authInProgress),
      authUrl: snapshot.pendingAuthUrl ?? null,
      stdout,
      stderr,
      agentMail: {
        ...snapshot,
        lastError: ok ? null : message,
      },
      checkedAt: this.now(),
      durationMs,
      inbound: {
        ok,
        latencyMs: durationMs,
        message,
      },
      outbound: {
        ok,
        latencyMs: durationMs,
        message,
      },
      message,
    };
    return res;
  }

  private async handleAgentMailLoginAction(startedAt: number): Promise<OvernightMailTestResult> {
    const cliPath = await this.resolveAgentMailCliPath(true);
    if (!cliPath) {
      const durationMs = Math.max(1, this.now() - startedAt);
      const message = `尚未安装 ${AGENT_MAIL_CLI_COMMAND}，请先执行步骤 1 安装 ${AGENT_MAIL_NPM_PACKAGE}。`;
      return {
        ok: false,
        mode: "imap",
        emailProvider: "agent_mail",
        agentMailAction: "login",
        installed: false,
        version: null,
        binaryPath: null,
        loggedIn: false,
        configured: false,
        authorizedEmail: this.config.agentMailAddress || null,
        address: this.config.agentMailAddress || null,
        authUrl: null,
        authInProgress: false,
        agentMail: {
          cliInstalled: false,
          installed: false,
          version: null,
          binaryPath: null,
          loggedIn: false,
          authorizedEmail: this.config.agentMailAddress || null,
          address: this.config.agentMailAddress || null,
          configured: false,
          authInProgress: false,
          pendingAuthUrl: null,
          lastError: message,
        },
        checkedAt: this.now(),
        durationMs,
        inbound: { ok: false, latencyMs: durationMs, message },
        outbound: { ok: false, latencyMs: durationMs, message },
        message,
      };
    }

    if (this.agentMailAuthInProgress && this.agentMailPendingAuthUrl) {
      const durationMs = Math.max(1, this.now() - startedAt);
      const message = "请点击或复制以下链接在浏览器中完成授权：";
      const existingEmail = this.config.agentMailAddress || null;
      return {
        ok: true,
        mode: "imap",
        emailProvider: "agent_mail",
        agentMailAction: "login",
        installed: true,
        version: this.agentMailProbeCache?.version ?? null,
        cliPath,
        binaryPath: cliPath,
        loggedIn: Boolean(existingEmail),
        configured: Boolean(existingEmail),
        authorizedEmail: existingEmail,
        address: existingEmail,
        authUrl: this.agentMailPendingAuthUrl,
        authInProgress: true,
        agentMail: {
          cliInstalled: true,
          installed: true,
          version: this.agentMailProbeCache?.version ?? null,
          cliPath,
          binaryPath: cliPath,
          loggedIn: Boolean(existingEmail),
          authorizedEmail: existingEmail,
          address: existingEmail,
          configured: Boolean(existingEmail),
          authInProgress: true,
          pendingAuthUrl: this.agentMailPendingAuthUrl,
          lastError: null,
        },
        checkedAt: this.now(),
        durationMs,
        inbound: { ok: true, latencyMs: durationMs, message },
        outbound: { ok: true, latencyMs: durationMs, message },
        message,
      };
    }

    this.stopActiveAgentMailLogin();
    const spawnLogin = this.hooks.spawnAgentMailLogin ?? defaultSpawnAgentMailLogin;
    const urlWaitMs = this.hooks.agentMailLoginUrlWaitMs ?? AGENT_MAIL_LOGIN_URL_WAIT_MS;
    const handle = spawnLogin(cliPath);
    this.agentMailLoginHandle = handle;
    this.agentMailAuthInProgress = true;
    this.agentMailPendingAuthUrl = null;
    this.agentMailLastError = null;

    this.agentMailLoginTimer = setTimeout(() => {
      if (this.agentMailLoginHandle === handle) {
        this.agentMailLastError = "OAuth 授权等待超时，请重新发起授权。";
        this.stopActiveAgentMailLogin();
      }
    }, AGENT_MAIL_LOGIN_MAX_LIFETIME_MS);
    this.agentMailLoginTimer.unref?.();

    let combinedOutput = "";

    const captured = await new Promise<{
      ok: boolean;
      authUrl: string | null;
      authInProgress: boolean;
      authorizedEmail: string | null;
      message: string;
    }>((resolveCapture) => {
      let settled = false;
      const finish = (outcome: {
        ok: boolean;
        authUrl: string | null;
        authInProgress: boolean;
        authorizedEmail: string | null;
        message: string;
      }) => {
        if (settled) return;
        settled = true;
        clearTimeout(waitTimer);
        resolveCapture(outcome);
      };

      const waitTimer = setTimeout(() => {
        const sanitized = sanitizeAgentMailOutput(combinedOutput, 400);
        this.agentMailLastError =
          sanitized || "启动 agently-cli auth login 超时，未捕获到浏览器授权链接。";
        if (this.agentMailLoginHandle === handle) {
          this.stopActiveAgentMailLogin();
        }
        finish({
          ok: false,
          authUrl: null,
          authInProgress: false,
          authorizedEmail: this.config.agentMailAddress || null,
          message: this.agentMailLastError,
        });
      }, urlWaitMs);
      waitTimer.unref?.();

      const inspectChunk = (chunk: string) => {
        combinedOutput += chunk;
        if (this.agentMailPendingAuthUrl === null) {
          const url = extractOpaqueOAuthUrl(combinedOutput);
          if (url) {
            this.agentMailPendingAuthUrl = url;
            finish({
              ok: true,
              authUrl: url,
              authInProgress: true,
              authorizedEmail: this.config.agentMailAddress || null,
              message: "请点击或复制以下链接在浏览器中完成授权：",
            });
          }
        }
      };

      handle.onStdout(inspectChunk);
      handle.onStderr(inspectChunk);

      handle.onError((err) => {
        const msg = `无法启动 ${AGENT_MAIL_CLI_COMMAND} auth login：${err.message}`;
        this.agentMailLastError = msg;
        if (this.agentMailLoginHandle === handle) {
          this.stopActiveAgentMailLogin();
        }
        finish({
          ok: false,
          authUrl: null,
          authInProgress: false,
          authorizedEmail: this.config.agentMailAddress || null,
          message: msg,
        });
      });

      handle.onExit((code) => {
        if (this.agentMailLoginTimer !== undefined && this.agentMailLoginHandle === handle) {
          clearTimeout(this.agentMailLoginTimer);
          this.agentMailLoginTimer = undefined;
        }
        if (this.agentMailLoginHandle === handle) {
          this.agentMailLoginHandle = null;
        }
        this.agentMailAuthInProgress = false;
        this.agentMailPendingAuthUrl = null;

        if (code === 0) {
          this.agentMailLastError = null;
          void this.probeAgentMailStatus({
            force: true,
            timeoutMs: AGENT_MAIL_STATUS_TIMEOUT_MS,
            persistOnSuccess: true,
          }).then((probed) => {
            if (probed.authorizedEmail) {
              this.persistAgentMailActiveIfUnconfigured(probed.authorizedEmail);
            }
            finish({
              ok: true,
              authUrl: null,
              authInProgress: false,
              authorizedEmail: probed.authorizedEmail ?? null,
              message: probed.authorizedEmail
                ? `邮箱地址 ${probed.authorizedEmail} 已授权成功，可以用它来收发邮件了。`
                : "Agent 邮箱 OAuth 授权已完成，请点击「检测授权身份」同步邮箱地址。",
            });
          });
        } else {
          const detail = sanitizeAgentMailOutput(combinedOutput, 400);
          const msg = `agently-cli auth login 异常退出（退出码 ${code ?? "null"}）${detail ? `：${detail}` : ""}`;
          this.agentMailLastError = msg;
          finish({
            ok: false,
            authUrl: null,
            authInProgress: false,
            authorizedEmail: this.config.agentMailAddress || null,
            message: msg,
          });
        }
      });
    });

    const durationMs = Math.max(1, this.now() - startedAt);
    const snapshot: OvernightAgentMailRuntimeSnapshot = {
      cliInstalled: true,
      installed: true,
      version: this.agentMailProbeCache?.version ?? null,
      cliPath,
      binaryPath: cliPath,
      loggedIn: Boolean(captured.authorizedEmail),
      authorizedEmail: captured.authorizedEmail,
      address: captured.authorizedEmail,
      configured: Boolean(captured.authorizedEmail),
      authInProgress: captured.authInProgress,
      pendingAuthUrl: captured.authUrl,
      lastError: captured.ok ? null : captured.message,
    };
    return {
      ok: captured.ok,
      mode: "imap",
      emailProvider: "agent_mail",
      agentMailAction: "login",
      installed: true,
      version: snapshot.version,
      cliPath,
      binaryPath: cliPath,
      loggedIn: snapshot.loggedIn,
      configured: snapshot.configured,
      authorizedEmail: captured.authorizedEmail,
      address: captured.authorizedEmail,
      authUrl: captured.authUrl,
      authInProgress: captured.authInProgress,
      agentMail: snapshot,
      checkedAt: this.now(),
      durationMs,
      inbound: {
        ok: captured.ok,
        latencyMs: durationMs,
        message: captured.message,
      },
      outbound: {
        ok: captured.ok,
        latencyMs: durationMs,
        message: captured.message,
      },
      message: captured.message,
    };
  }

  private async handleAgentMailVerifyConnection(
    startedAt: number,
  ): Promise<OvernightMailTestResult> {
    const snapshot = await this.probeAgentMailStatus({
      force: true,
      timeoutMs: AGENT_MAIL_STATUS_TIMEOUT_MS,
      persistOnSuccess: true,
    });
    const email = snapshot.authorizedEmail ?? null;
    const isValidAgentMailbox = Boolean(email && /@agent\.qq\.com$/i.test(email));
    if (isValidAgentMailbox && email) {
      this.persistAgentMailActiveIfUnconfigured(email);
    }

    const scopes = snapshot.scopes ?? [];
    const hasReadScope = scopes.length === 0 || scopes.includes("mail:read");
    const hasSendScope = scopes.length === 0 || scopes.includes("mail:send");
    const inboundOk = snapshot.cliInstalled && isValidAgentMailbox && hasReadScope;
    let outboundOk = snapshot.cliInstalled && isValidAgentMailbox && hasSendScope;
    let outboundMessage = outboundOk
      ? `Agent 邮箱发信就绪（agently-cli · ${email}${snapshot.dailySendQuota ? ` · 日额度 ${snapshot.dailySendQuota} 封` : ""}）`
      : !hasSendScope && isValidAgentMailbox
        ? "当前 Agent 邮箱授权缺少 mail:send 发信权限，请重新发起 OAuth 授权。"
        : !snapshot.cliInstalled
          ? `未检测到 ${AGENT_MAIL_CLI_COMMAND}，请先安装 ${AGENT_MAIL_NPM_PACKAGE}。`
          : email
            ? `检测到已登录邮箱 ${email}，但并非 @agent.qq.com 地址，请重新授权腾讯 Agent 邮箱。`
            : snapshot.lastError ||
              "尚未完成 Agent 邮箱 OAuth 授权，请点击「发起 OAuth 浏览器授权」后重试。";
    let outboundHint: string | undefined;

    // Validate outbound CLI send syntax with `--dry-run` (zero network spam!) when CLI is ready.
    const outboundStart = this.now();
    if (outboundOk && snapshot.cliPath && email) {
      const dryRunRes = await this.runAgentMailCli(
        snapshot.cliPath,
        [
          "message",
          "+send",
          "--to",
          email,
          "--subject",
          "Prismux send check",
          "--body",
          "Prismux outbound send verification",
          "--body-format",
          "plain",
          "--confirmed",
          "--dry-run",
        ],
        Math.min(AGENT_MAIL_STATUS_TIMEOUT_MS, 5_000),
      );
      if (dryRunRes.exitCode !== 0) {
        const combined = `${dryRunRes.stderr} ${dryRunRes.stdout}`;
        if (!/unknown flag|unknown option|unrecognized/i.test(combined)) {
          outboundOk = false;
          outboundMessage = `agently-cli 发信校验失败（退出码 ${dryRunRes.exitCode}）：${sanitizeAgentMailOutput(dryRunRes.stderr || dryRunRes.stdout || dryRunRes.errorMessage || "", 260)}`;
          outboundHint = "请确认 agently-cli 已升级至最新版本且 OAuth 令牌未过期。";
        }
      }
    }
    const outboundLatency = Math.max(1, this.now() - outboundStart);
    const durationMs = Math.max(1, this.now() - startedAt);
    const ok = inboundOk && outboundOk;

    const baseFailMsg = !snapshot.cliInstalled
      ? `未检测到 ${AGENT_MAIL_CLI_COMMAND}，请先安装 ${AGENT_MAIL_NPM_PACKAGE}。`
      : !isValidAgentMailbox
        ? email
          ? `检测到已登录邮箱 ${email}，但并非 @agent.qq.com 地址，请重新授权腾讯 Agent 邮箱。`
          : snapshot.lastError ||
            "尚未完成 Agent 邮箱 OAuth 授权，请点击「发起 OAuth 浏览器授权」后重试。"
        : !inboundOk
          ? "当前 Agent 邮箱授权缺少 mail:read 收信权限，请重新发起 OAuth 授权。"
          : outboundMessage;

    const message = ok
      ? `Agent 邮箱双向收发校验通过（${email}${snapshot.version ? ` · v${snapshot.version}` : ""}）。`
      : baseFailMsg;

    const res: OvernightMailTestResult = {
      ok,
      mode: "imap",
      emailProvider: "agent_mail",
      installed: snapshot.cliInstalled,
      version: snapshot.version,
      ...(snapshot.cliPath ? { cliPath: snapshot.cliPath } : {}),
      binaryPath: snapshot.binaryPath,
      loggedIn: snapshot.loggedIn,
      configured: snapshot.configured,
      authorizedEmail: email,
      address: email,
      authInProgress: Boolean(snapshot.authInProgress),
      authUrl: snapshot.pendingAuthUrl ?? null,
      agentMail: snapshot,
      checkedAt: this.now(),
      durationMs,
      inbound: {
        ok: inboundOk,
        latencyMs: durationMs,
        message: inboundOk ? `Agent 邮箱收信就绪（${email}）` : baseFailMsg,
        ...(snapshot.cliPath ? { detail: snapshot.cliPath } : {}),
      },
      outbound: {
        ok: outboundOk,
        latencyMs: outboundLatency,
        message: outboundMessage,
        ...(outboundHint ? { hint: outboundHint } : {}),
      },
      message,
    };
    this.lastTestResult = res;
    return res;
  }

  async testMailConnection(
    rawBody: unknown,
    trustedCallerScope: CallerScope,
  ): Promise<OvernightMailTestResult> {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/test-mail");
    const startedAt = this.now();

    if (isPlainRecord(rawBody) && isOvernightAgentMailAction(rawBody["agentMailAction"])) {
      const action = rawBody["agentMailAction"];
      if (action === "status") {
        return this.handleAgentMailStatusAction(startedAt);
      }
      if (action === "install") {
        return this.handleAgentMailInstallAction(startedAt);
      }
      return this.handleAgentMailLoginAction(startedAt);
    }

    const { config, secrets } = await this.resolveEffectiveMailInput(rawBody);

    if (config.emailProvider === "agent_mail") {
      return this.handleAgentMailVerifyConnection(startedAt);
    }

    if (config.mode === "gmail-oauth2") {
      const probeStart = this.now();
      if (!config.gmail.clientId || !secrets.gmailClientSecret) {
        const res: OvernightMailTestResult = {
          ok: false,
          mode: "gmail-oauth2",
          checkedAt: this.now(),
          durationMs: Math.max(1, this.now() - startedAt),
          inbound: {
            ok: false,
            latencyMs: 0,
            message: "缺少 Google OAuth Client ID 或已密封的 Client Secret。",
          },
          outbound: {
            ok: false,
            latencyMs: 0,
            message: "请先完成 Gmail OAuth2 配置与浏览器授权绑定。",
          },
          message: "Gmail OAuth2 尚未完成凭据配置。",
        };
        this.lastTestResult = res;
        return res;
      }
      if (!secrets.gmailRefreshToken) {
        const res: OvernightMailTestResult = {
          ok: false,
          mode: "gmail-oauth2",
          checkedAt: this.now(),
          durationMs: Math.max(1, this.now() - startedAt),
          inbound: {
            ok: false,
            latencyMs: 0,
            message: "尚未绑定 Gmail 账号（缺少已密封的 Refresh Token）。",
          },
          outbound: {
            ok: false,
            latencyMs: 0,
            message: "请先点击「一键浏览器登录绑定 Gmail」完成授权。",
          },
          message: "请先完成 Gmail 浏览器 OAuth 登录绑定。",
        };
        this.lastTestResult = res;
        return res;
      }

      try {
        const refreshed = await this.refreshGmailAccessToken(
          config.gmail.clientId,
          secrets.gmailClientSecret,
          secrets.gmailRefreshToken,
        );
        const accessToken = refreshed.accessToken;
        const fetchImpl = this.hooks.fetchFn ?? fetch;
        const profileRes = await fetchImpl(
          "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );
        if (!profileRes.ok) {
          throw new Error(`Gmail Profile 检查失败 (HTTP ${profileRes.status})`);
        }
        const profile = (await profileRes.json()) as {
          emailAddress?: string;
          messagesTotal?: number;
        };
        const latencyMs = Math.max(1, this.now() - probeStart);
        const emailLabel = profile.emailAddress ?? config.gmail.boundEmail ?? "Gmail";
        const grantedScopes = refreshed.scope
          ? refreshed.scope.split(/\s+/).filter((s) => s.length > 0)
          : [];
        const hasSendScope =
          grantedScopes.length === 0 ||
          grantedScopes.some(
            (s) =>
              s.includes("gmail.send") ||
              s.includes("gmail.compose") ||
              s.includes("mail.google.com"),
          );
        const ok = hasSendScope;
        const res: OvernightMailTestResult = {
          ok,
          mode: "gmail-oauth2",
          emailProvider: "gmail_oauth2",
          checkedAt: this.now(),
          durationMs: Math.max(1, this.now() - startedAt),
          inbound: {
            ok: true,
            latencyMs,
            message: `Gmail API 收信通道正常（${emailLabel}）`,
            ...(profile.messagesTotal !== undefined
              ? { detail: `历史邮件 ${profile.messagesTotal} 封` }
              : {}),
          },
          outbound: hasSendScope
            ? {
                ok: true,
                latencyMs,
                message: "Gmail OAuth2 发信权限就绪（gmail.send）",
              }
            : {
                ok: false,
                latencyMs,
                message: "当前 Gmail OAuth 令牌缺少 gmail.send 发信权限。",
                hint: "请在 Google Cloud 同意屏幕添加 gmail.send Scope 后解除绑定并重新授权。",
              },
          message: ok
            ? `Gmail OAuth2 收发连通性校验通过（${latencyMs} ms）。`
            : "Gmail OAuth2 收信正常，但缺少发信权限（gmail.send）。",
        };
        this.lastTestResult = res;
        return res;
      } catch (err) {
        const latencyMs = Math.max(1, this.now() - probeStart);
        const msg = err instanceof Error ? err.message : String(err);
        const res: OvernightMailTestResult = {
          ok: false,
          mode: "gmail-oauth2",
          emailProvider: "gmail_oauth2",
          checkedAt: this.now(),
          durationMs: Math.max(1, this.now() - startedAt),
          inbound: { ok: false, latencyMs, message: msg },
          outbound: { ok: false, latencyMs, message: msg },
          message: `Gmail OAuth2 连通性测试失败：${msg}`,
        };
        this.lastTestResult = res;
        return res;
      }
    }

    // IMAP / SMTP dual probe
    const imapUser = config.imapSmtp.imapUsername || config.imapSmtp.email;
    const smtpUser = config.imapSmtp.smtpUsername || config.imapSmtp.email;
    const imapPass = secrets.imapPassword ?? "";
    const smtpPass =
      config.imapSmtp.useSeparateSmtpPassword === false
        ? imapPass
        : secrets.smtpPassword || imapPass;

    const probeImap = this.hooks.probeImap ?? defaultProbeImapConnection;
    const probeSmtp = this.hooks.probeSmtp ?? defaultProbeSmtpConnection;

    const [inbound, outbound] = await Promise.all([
      probeImap({
        host: config.imapSmtp.imapHost,
        port: config.imapSmtp.imapPort,
        secure: config.imapSmtp.imapSecure,
        username: imapUser,
        password: imapPass,
        mailbox: config.imapSmtp.mailbox,
      }),
      probeSmtp({
        host: config.imapSmtp.smtpHost,
        port: config.imapSmtp.smtpPort,
        secure: config.imapSmtp.smtpSecure,
        username: smtpUser,
        password: smtpPass,
        fromAddress: config.imapSmtp.email || smtpUser,
        fromName: config.imapSmtp.fromName,
      }),
    ]);

    const ok = inbound.ok && outbound.ok;
    const durationMs = Math.max(1, this.now() - startedAt);
    const res: OvernightMailTestResult = {
      ok,
      mode: "imap",
      emailProvider: "imap_smtp",
      checkedAt: this.now(),
      durationMs,
      inbound,
      outbound,
      message: ok
        ? `IMAP 与 SMTP 双向收发连通性测试全部通过（${durationMs} ms）。`
        : !inbound.ok && !outbound.ok
          ? `IMAP 与 SMTP 均连接失败：收信(${inbound.message}) / 发信(${outbound.message})`
          : !inbound.ok
            ? `IMAP 收信验证失败：${inbound.message}`
            : `SMTP 发信验证失败：${outbound.message}`,
    };
    this.lastTestResult = res;
    return res;
  }

  private async createMailerForConfig(
    config: OvernightFactoryPersistedConfig,
    secrets: ResolvedOvernightSecrets,
  ): Promise<OutboundMailer> {
    if (this.hooks.createOutboundMailer) {
      const injected = this.hooks.createOutboundMailer(config, secrets);
      if (injected) return injected;
    }

    if (config.emailProvider === "agent_mail") {
      const cliPath = await this.resolveAgentMailCliPath(true);
      if (!cliPath) {
        throw new BusinessRouteError(
          400,
          "AGENT_MAIL_CLI_NOT_INSTALLED",
          `未检测到 ${AGENT_MAIL_CLI_COMMAND}，请先在邮箱设置中一键安装 ${AGENT_MAIL_NPM_PACKAGE}。`,
        );
      }
      let authorizedEmail =
        config.agentMailAddress || this.agentMailProbeCache?.authorizedEmail || "";
      if (!authorizedEmail) {
        const probed = await this.probeAgentMailStatus({
          force: true,
          timeoutMs: AGENT_MAIL_STATUS_TIMEOUT_MS,
          persistOnSuccess: true,
        });
        authorizedEmail = probed.authorizedEmail ?? "";
      }
      if (!authorizedEmail) {
        throw new BusinessRouteError(
          400,
          "AGENT_MAIL_NOT_AUTHORIZED",
          "Agent 邮箱尚未完成 OAuth 授权，请先点击「发起 OAuth 浏览器授权」并完成身份检测。",
        );
      }
      return {
        send: async (payload: OutboundMailPayload) => {
          const recipients = payload.to
            .map((addr) => extractEmailAddress(addr))
            .filter((addr) => addr.length > 0);
          if (recipients.length === 0) {
            throw new BusinessRouteError(400, "RECIPIENT_MISSING", "发信收件人邮箱不能为空。");
          }

          // Write HTML body to a relative temp file (`--body-file ./body.html --body-format html`)
          // to completely avoid Windows cmd.exe `< > &` redirection corruption & 8191-char limits!
          const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pmx-agm-send-"));
          const bodyFileName = "body.html";
          const bodyContent = payload.html || payload.text || payload.subject;
          const bodyFormat = payload.html ? "html" : "plain";
          NodeFS.writeFileSync(NodePath.join(tempDir, bodyFileName), bodyContent, "utf8");

          const toArgs: string[] = [];
          for (const rcpt of recipients) {
            toArgs.push("--to", rcpt);
          }

          try {
            const primaryArgs = [
              "message",
              "+send",
              ...toArgs,
              "--subject",
              payload.subject,
              "--body-file",
              `./${bodyFileName}`,
              "--body-format",
              bodyFormat,
              "--confirmed",
            ];
            let res = await this.runAgentMailCli(
              cliPath,
              primaryArgs,
              AGENT_MAIL_CLI_OP_TIMEOUT_MS,
              { cwd: tempDir },
            );

            // Handle legacy/older CLI fallback if `--body-file` flag is unrecognized.
            if (
              res.exitCode !== 0 &&
              /unknown flag|unknown option|unrecognized/i.test(`${res.stderr} ${res.stdout}`)
            ) {
              res = await this.runAgentMailCli(
                cliPath,
                [
                  "message",
                  "+send",
                  ...toArgs,
                  "--subject",
                  payload.subject,
                  "--body",
                  (payload.text ?? payload.subject).slice(0, 3500),
                  "--body-format",
                  "plain",
                  "--confirmed",
                ],
                AGENT_MAIL_CLI_OP_TIMEOUT_MS,
                { cwd: tempDir },
              );
            }

            // Handle two-step confirmation token if CLI requires explicit confirmation.
            if (res.exitCode === 0) {
              const parsedInit = extractJsonFromCliOutput(res.stdout);
              if (isPlainRecord(parsedInit)) {
                const data = isPlainRecord(parsedInit["data"]) ? parsedInit["data"] : parsedInit;
                if (
                  data["confirmation_required"] === true &&
                  typeof data["confirmation_token"] === "string" &&
                  data["confirmation_token"].trim().length > 0
                ) {
                  res = await this.runAgentMailCli(
                    cliPath,
                    [
                      "message",
                      "+send",
                      ...toArgs,
                      "--subject",
                      payload.subject,
                      "--body-file",
                      `./${bodyFileName}`,
                      "--body-format",
                      bodyFormat,
                      "--confirmation-token",
                      data["confirmation_token"].trim(),
                    ],
                    AGENT_MAIL_CLI_OP_TIMEOUT_MS,
                    { cwd: tempDir },
                  );
                }
              }
            }

            const parsedFinal = extractJsonFromCliOutput(res.stdout);
            const jsonFailed = isPlainRecord(parsedFinal) && parsedFinal["ok"] === false;

            if (res.exitCode !== 0 || jsonFailed) {
              const jsonErr =
                isPlainRecord(parsedFinal) && typeof parsedFinal["error"] === "string"
                  ? parsedFinal["error"]
                  : isPlainRecord(parsedFinal) &&
                      isPlainRecord(parsedFinal["error"]) &&
                      typeof parsedFinal["error"]["message"] === "string"
                    ? parsedFinal["error"]["message"]
                    : "";
              const detail = sanitizeAgentMailOutput(
                jsonErr || res.stderr || res.stdout || res.errorMessage || "",
                320,
              );
              throw new BusinessRouteError(
                502,
                "AGENT_MAIL_SEND_FAILED",
                `通过 ${AGENT_MAIL_CLI_COMMAND} 发信失败（退出码 ${res.exitCode}）：${detail || "请检查授权状态与网络连接"}`,
              );
            }

            let parsedId = `agent-mail-${this.now()}-${NodeCrypto.randomUUID().slice(0, 8)}`;
            if (isPlainRecord(parsedFinal)) {
              const data = isPlainRecord(parsedFinal["data"]) ? parsedFinal["data"] : parsedFinal;
              const maybeId =
                data["message_id"] ??
                data["messageId"] ??
                data["id"] ??
                parsedFinal["messageId"] ??
                parsedFinal["id"];
              if (typeof maybeId === "string" && maybeId.trim().length > 0) {
                parsedId = maybeId.trim();
              }
            }
            return {
              messageId: parsedId,
              acceptedAt: this.now(),
              provider: `agent_mail:${AGENT_MAIL_CLI_COMMAND}`,
            };
          } finally {
            try {
              NodeFS.rmSync(tempDir, { recursive: true, force: true });
            } catch {
              // ignore temp cleanup failure
            }
          }
        },
      };
    }

    if (config.mode === "gmail-oauth2") {
      if (!config.gmail.clientId || !secrets.gmailClientSecret || !secrets.gmailRefreshToken) {
        throw new BusinessRouteError(
          400,
          "GMAIL_NOT_CONFIGURED",
          "Gmail OAuth2 尚未完成绑定，无法发送早报邮件。",
        );
      }
      return {
        send: async (payload: OutboundMailPayload) => {
          const refreshed = await this.refreshGmailAccessToken(
            config.gmail.clientId,
            secrets.gmailClientSecret!,
            secrets.gmailRefreshToken!,
          );
          return this.sendViaGmailApi(
            refreshed.accessToken,
            config.gmail.boundEmail || "me",
            `${BRAND.appName} Overnight Factory`,
            payload,
          );
        },
      };
    }

    const smtpUser = config.imapSmtp.smtpUsername || config.imapSmtp.email;
    const smtpPass =
      config.imapSmtp.useSeparateSmtpPassword === false
        ? secrets.imapPassword || ""
        : secrets.smtpPassword || secrets.imapPassword || "";
    if (!config.imapSmtp.smtpHost || !smtpUser || !smtpPass) {
      throw new BusinessRouteError(
        400,
        "SMTP_NOT_CONFIGURED",
        "SMTP 主机、邮箱账号或授权码尚未完整配置，无法发送早报邮件。",
      );
    }
    const sendSmtp = this.hooks.sendSmtp ?? defaultSendSmtpMail;
    return {
      send: (payload: OutboundMailPayload) =>
        sendSmtp(
          {
            host: config.imapSmtp.smtpHost,
            port: config.imapSmtp.smtpPort,
            secure: config.imapSmtp.smtpSecure,
            username: smtpUser,
            password: smtpPass,
            fromAddress: config.imapSmtp.email || smtpUser,
            fromName: config.imapSmtp.fromName,
          },
          payload,
        ),
    };
  }

  async sendTestMorningReport(
    rawBody: unknown,
    trustedCallerScope: CallerScope,
  ): Promise<OvernightTestReportResult> {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/send-test-report");
    const body = isPlainRecord(rawBody) ? rawBody : {};
    const { config, secrets } = await this.resolveEffectiveMailInput(body);

    if (config.emailProvider === "agent_mail" && !config.agentMailAddress) {
      await this.probeAgentMailStatus({
        force: false,
        timeoutMs: AGENT_MAIL_SNAPSHOT_PROBE_TIMEOUT_MS,
        persistOnSuccess: true,
      });
    }

    const explicitRecipient =
      typeof body["recipient"] === "string" ? normalizeTestRecipient(body["recipient"]) : "";
    const defaultRecipient =
      config.testRecipient.trim() ||
      (config.emailProvider === "agent_mail"
        ? config.agentMailAddress ||
          this.agentMailProbeCache?.authorizedEmail ||
          config.strategy.allowedSenders[0] ||
          ""
        : config.mode === "gmail-oauth2"
          ? config.gmail.boundEmail || config.strategy.allowedSenders[0] || ""
          : config.imapSmtp.email || config.strategy.allowedSenders[0] || "");
    const recipient = explicitRecipient || defaultRecipient;
    if (!isValidTestRecipientEmail(recipient)) {
      throw new BusinessRouteError(
        400,
        "RECIPIENT_MISSING",
        "请先配置绑定邮箱或填写测试收件人邮箱地址。",
      );
    }

    if (
      isValidTestRecipientEmail(explicitRecipient) &&
      explicitRecipient !== this.config.testRecipient
    ) {
      this.config.testRecipient = explicitRecipient;
      this.persistConfig();
      this.onConfigChanged?.();
    }

    const sampleThreadId = `overnight-test-${this.now()}`;
    const sampleReport: FactoryMorningReport = {
      jobId: `fac-test-${this.now()}`,
      threadId: sampleThreadId,
      branchName: "factory/test-morning-report",
      repoName: config.strategy.targetWorkspaceDir
        ? NodePath.basename(config.strategy.targetWorkspaceDir)
        : BRAND.appName,
      summary:
        "这是一封来自 Prismux 夜间全自动工场的连通性测试完工早报，用于验证 HTML 样式、Diff 高亮与桌面端深度链接唤醒。",
      changedFilesCount: 2,
      changedFiles: [
        { path: "src/overnight/demo.ts", status: "modified", additions: 14, deletions: 2 },
        { path: "src/overnight/demo.test.ts", status: "added", additions: 28, deletions: 0 },
      ],
      diff: [
        "diff --git a/src/overnight/demo.ts b/src/overnight/demo.ts",
        "@@ -1,3 +1,5 @@",
        " export function overnightReady() {",
        "-  return false;",
        "+  return true;",
        " }",
      ].join("\n"),
      testCommand: "pnpm test",
      testOutput: "✔ Overnight Factory mail pipeline verified (2/2 passed)",
      testPassed: true,
      reviewComments: [
        "[Review OK] 测试早报演练通过：隔离 Worktree 本地分支模式生效，未自动推送远端。",
      ],
      deepLink: buildReviewDeepLink(sampleThreadId),
      tokenStats: {
        inputTokens: 1280,
        outputTokens: 420,
        totalTokens: 1700,
        estimatedCostUsd: 0.0042,
        model: config.strategy.agentModel || config.strategy.agentProvider,
      },
    };

    const html = this.overnightFactory.renderMorningReportHtml(sampleReport);
    const subject = `[${BRAND.appName} 夜间工场] 测试完工早报 · 通道验证成功`;
    const mailer = await this.createMailerForConfig(config, secrets);
    const receipt = await mailer.send({
      to: [recipient],
      subject,
      html,
      text: `${sampleReport.summary}\n审阅链接：${sampleReport.deepLink}`,
    });

    return {
      ok: true,
      messageId: receipt.messageId,
      recipient,
      testRecipient: this.config.testRecipient,
      provider: receipt.provider,
      sentAt: receipt.acceptedAt,
      subject,
      htmlPreviewLength: html.length,
      message: `测试早报已成功发送至 ${recipient}（通道 ${receipt.provider}）。`,
    };
  }

  private async createInboundAdapterForConfig(
    config: OvernightFactoryPersistedConfig,
    secrets: ResolvedOvernightSecrets,
  ): Promise<MailInboundAdapter> {
    if (this.hooks.createInboundAdapter) {
      const injected = this.hooks.createInboundAdapter(config, secrets);
      if (injected) return injected;
    }

    if (config.emailProvider === "agent_mail") {
      const cliPath = await this.resolveAgentMailCliPath(true);
      if (!cliPath) {
        throw new BusinessRouteError(
          400,
          "AGENT_MAIL_CLI_NOT_INSTALLED",
          `未检测到 ${AGENT_MAIL_CLI_COMMAND}，请先在邮箱设置中一键安装 ${AGENT_MAIL_NPM_PACKAGE}。`,
        );
      }
      let authorizedEmail =
        config.agentMailAddress || this.agentMailProbeCache?.authorizedEmail || "";
      if (!authorizedEmail) {
        const probed = await this.probeAgentMailStatus({
          force: true,
          timeoutMs: AGENT_MAIL_STATUS_TIMEOUT_MS,
          persistOnSuccess: true,
        });
        authorizedEmail = probed.authorizedEmail ?? "";
      }
      if (!authorizedEmail) {
        throw new BusinessRouteError(
          400,
          "AGENT_MAIL_NOT_AUTHORIZED",
          "Agent 邮箱尚未完成 OAuth 授权，请先完成授权后再拉取邮件。",
        );
      }
      return {
        mode: "imap",
        pollIncremental: async () => {
          const res = await this.runAgentMailCli(
            cliPath,
            ["message", "+list", "--dir", "inbox", "--limit", "20"],
            AGENT_MAIL_CLI_OP_TIMEOUT_MS,
          );
          if (res.exitCode !== 0) {
            const detail = sanitizeAgentMailOutput(
              res.stderr || res.stdout || res.errorMessage || "",
              320,
            );
            throw new BusinessRouteError(
              502,
              "AGENT_MAIL_POLL_FAILED",
              `通过 ${AGENT_MAIL_CLI_COMMAND} 拉取邮件失败（退出码 ${res.exitCode}）：${detail || "请检查授权状态"}`,
            );
          }
          const listed = parseAgentMailListMessages(res.stdout);
          const triggerTag = config.strategy.triggerTag || "#factory";
          // Hydrate full message body via `message +read --id <id>` for matched trigger emails.
          const hydrated: InboundEmailMessage[] = [];
          for (const msg of listed) {
            if (
              matchesFactoryTrigger(msg, triggerTag) &&
              msg.messageId.startsWith("msg_") &&
              !this.overnightFactory.hasProcessedMessage(msg.messageId)
            ) {
              try {
                const readRes = await this.runAgentMailCli(
                  cliPath,
                  ["message", "+read", "--id", msg.messageId],
                  AGENT_MAIL_CLI_OP_TIMEOUT_MS,
                );
                if (readRes.exitCode === 0) {
                  const parsedRead = extractJsonFromCliOutput(readRes.stdout);
                  if (isPlainRecord(parsedRead)) {
                    const data = isPlainRecord(parsedRead["data"])
                      ? parsedRead["data"]
                      : parsedRead;
                    const fullBody = typeof data["body"] === "string" ? data["body"] : undefined;
                    const bodyFmt =
                      typeof data["body_format"] === "string"
                        ? data["body_format"].toUpperCase()
                        : "PLAIN";
                    const fullTo = extractAgentMailAddressList(data["to"]);
                    const fullFrom = extractAgentMailAddressFromField(data["from"]);
                    hydrated.push({
                      ...msg,
                      ...(fullFrom ? { from: fullFrom } : {}),
                      ...(fullTo.length > 0 ? { to: fullTo } : {}),
                      ...(fullBody !== undefined
                        ? bodyFmt === "HTML"
                          ? { htmlBody: fullBody }
                          : { textBody: fullBody }
                        : {}),
                    });
                    continue;
                  }
                }
              } catch {
                // Fall back to snippet when `+read` fails
              }
            }
            hydrated.push(msg);
          }
          return {
            messages: hydrated,
          };
        },
      };
    }

    if (config.mode === "gmail-oauth2") {
      if (!config.gmail.clientId || !secrets.gmailClientSecret || !secrets.gmailRefreshToken) {
        throw new BusinessRouteError(
          400,
          "GMAIL_NOT_CONFIGURED",
          "Gmail OAuth2 尚未绑定，请先完成浏览器 OAuth 登录。",
        );
      }
      return new GmailOAuth2InboundAdapter({
        userEmail: config.gmail.boundEmail || "me",
        clientId: config.gmail.clientId,
        clientSecret: secrets.gmailClientSecret,
        refreshToken: secrets.gmailRefreshToken,
        ...(secrets.gmailAccessToken ? { accessToken: secrets.gmailAccessToken } : {}),
        ...(config.gmail.lastHistoryId ? { initialHistoryId: config.gmail.lastHistoryId } : {}),
        ...(this.hooks.fetchFn ? { fetchFn: this.hooks.fetchFn } : {}),
      });
    }

    const imapUser = config.imapSmtp.imapUsername || config.imapSmtp.email;
    const imapPass = secrets.imapPassword ?? "";
    if (!config.imapSmtp.imapHost || !imapUser || !imapPass) {
      throw new BusinessRouteError(
        400,
        "IMAP_NOT_CONFIGURED",
        "IMAP 主机、邮箱账号或授权码尚未完整配置，无法拉取邮件。",
      );
    }
    return new ImapIdleInboundAdapter({
      host: config.imapSmtp.imapHost,
      port: config.imapSmtp.imapPort,
      secure: config.imapSmtp.imapSecure,
      username: imapUser,
      password: imapPass,
      mailbox: config.imapSmtp.mailbox,
    });
  }

  async pollNow(
    rawBody: unknown,
    trustedCallerScope: CallerScope,
  ): Promise<OvernightPollNowResult> {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/poll-now");
    if (this.pollingInFlight) {
      throw new BusinessRouteError(409, "POLL_IN_PROGRESS", "夜间工场正在拉取邮件中，请稍候片刻。");
    }

    this.pollingInFlight = true;
    const polledAt = this.now();
    try {
      const body = isPlainRecord(rawBody) ? rawBody : {};
      const { config, secrets } = await this.resolveEffectiveMailInput(body);
      const adapter = await this.createInboundAdapterForConfig(config, secrets);
      const pollResult = await adapter.pollIncremental();

      if (
        config.mode === "gmail-oauth2" &&
        pollResult.nextCursor &&
        pollResult.nextCursor !== this.config.gmail.lastHistoryId
      ) {
        this.config.gmail.lastHistoryId = pollResult.nextCursor;
        this.persistConfig();
      }

      let matchedCount = 0;
      let executedCount = 0;
      let blockedByWhitelistCount = 0;
      let skippedDuplicateCount = 0;
      const newRuns: OvernightRunRecord[] = [];

      const triggerTag = config.strategy.triggerTag || "#factory";

      for (const email of pollResult.messages) {
        if (!matchesFactoryTrigger(email, triggerTag)) {
          continue;
        }
        matchedCount += 1;

        if (this.overnightFactory.hasProcessedMessage(email.messageId)) {
          skippedDuplicateCount += 1;
          continue;
        }

        // Physical security boundary: enforce sender whitelist before any code execution!
        if (!isSenderAllowed(email.from, config.strategy.allowedSenders)) {
          blockedByWhitelistCount += 1;
          this.overnightFactory.markMessageProcessed(email.messageId);
          const blockedRecord: OvernightRunRecord = {
            id: `run-${polledAt}-${NodeCrypto.randomUUID().slice(0, 6)}`,
            jobId: `blocked-${NodeCrypto.randomUUID().slice(0, 8)}`,
            messageId: email.messageId,
            threadId: "",
            subject: email.subject || "(无主题)",
            sender: extractEmailAddress(email.from) || email.from,
            status: "blocked_whitelist",
            stage: "failed",
            source: "email",
            branchName: null,
            changedFilesCount: 0,
            testPassed: null,
            oracleSummary:
              config.strategy.allowedSenders.length === 0
                ? "发件人白名单为空，已按安全策略拦截陌生邮件触发。"
                : "发件人不在白名单中，已物理拦截代码执行。",
            reviewComments: [],
            deepLink: null,
            reportSent: false,
            createdAt: polledAt,
            completedAt: this.now(),
            errorMessage: "发件人未命中白名单（已安全拦截）。",
          };
          this.appendRun(blockedRecord);
          newRuns.push(blockedRecord);
          continue;
        }

        const runRecord = await this.executeInboundEmailJob(email, config, secrets);
        executedCount += 1;
        newRuns.push(runRecord);
        if (runRecord.status === "completed") {
          await adapter.acknowledgeProcessed?.(email.messageId);
        }
      }

      this.lastPollAt = polledAt;
      this.lastPollError = null;

      return {
        ok: true,
        polledAt,
        fetchedCount: pollResult.messages.length,
        matchedCount,
        executedCount,
        blockedByWhitelistCount,
        skippedDuplicateCount,
        runs: newRuns,
        message:
          matchedCount === 0
            ? `已扫描 ${pollResult.messages.length} 封邮件，暂无匹配 ${triggerTag} 的新任务。`
            : `已扫描 ${pollResult.messages.length} 封邮件：匹配 ${matchedCount} 封，执行 ${executedCount} 项，白名单拦截 ${blockedByWhitelistCount} 项。`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastPollAt = polledAt;
      this.lastPollError = msg;
      if (err instanceof BusinessRouteError) {
        throw err;
      }
      throw new BusinessRouteError(502, "OVERNIGHT_POLL_FAILED", msg);
    } finally {
      this.pollingInFlight = false;
    }
  }

  private resolveEffectiveAgentProvider(requestedProvider?: string): string {
    const raw = (requestedProvider ?? this.config.strategy.agentProvider ?? "codex").trim();
    if (!raw || raw.toLowerCase() === "chief") {
      try {
        const slot = this.chiefManager?.getSlot();
        if (slot?.activeProvider) {
          return slot.activeProvider;
        }
      } catch {
        // fallback below
      }
      return "codex";
    }
    return raw;
  }

  private assertProviderAllowedForUnattended(provider: string): void {
    if (isAntigravityProvider(provider)) {
      throw new BusinessRouteError(
        403,
        "AGY_UNATTENDED_FORBIDDEN",
        "24h 无人值守夜间工场严禁使用个人版 Antigravity（AGY），请改选 Codex / Claude Code / OpenCode / DSH 等合规代理。",
      );
    }
  }

  private resolveDefaultReportRecipient(config: OvernightFactoryPersistedConfig): string {
    if (config.emailProvider === "agent_mail") {
      return (
        config.agentMailAddress ||
        this.agentMailProbeCache?.authorizedEmail ||
        config.strategy.allowedSenders[0] ||
        ""
      );
    }
    if (config.mode === "gmail-oauth2") {
      return config.gmail.boundEmail || config.strategy.allowedSenders[0] || "";
    }
    return config.imapSmtp.email || config.strategy.allowedSenders[0] || "";
  }

  private async executeJobIntoRunRecord(input: {
    record: OvernightRunRecord;
    email: InboundEmailMessage;
    workspaceDir: string;
    provider: string;
    model: string;
    verifyCommand: string;
    sendEmailReport: boolean;
    reportRecipient: string;
    allowNoFileChanges: boolean;
    config: OvernightFactoryPersistedConfig;
    secrets: ResolvedOvernightSecrets;
    controller: AbortController;
  }): Promise<OvernightRunRecord> {
    const {
      record,
      email,
      workspaceDir,
      provider,
      model,
      verifyCommand,
      config,
      secrets,
      controller,
    } = input;
    record.status = "running";
    record.stage = "preparing_worktree";
    record.startedAt = this.now();
    this.appendRunLog(
      record,
      "preparing_worktree",
      `开始执行任务「${record.subject}」（工作区：${workspaceDir}，代理：${provider}${model ? ` / ${model}` : ""}）`,
    );

    if (!workspaceDir || !NodeFS.existsSync(workspaceDir)) {
      record.status = "failed";
      record.stage = "failed";
      record.completedAt = this.now();
      record.oracleSummary = "目标工作区目录未配置或路径不存在，已中止本次任务。";
      record.errorMessage = "请先设置有效的本地 Git 目标工作区目录。";
      this.appendRunLog(record, "failed", record.errorMessage, "error");
      return record;
    }

    let outboundMailer: OutboundMailer | undefined;
    if (input.sendEmailReport) {
      try {
        outboundMailer = await this.createMailerForConfig(config, secrets);
      } catch (mailErr) {
        const reason = mailErr instanceof Error ? mailErr.message : String(mailErr);
        this.appendRunLog(
          record,
          "preparing_worktree",
          `邮箱发信通道暂不可用（任务将继续执行，完成后跳过邮件回执）：${reason}`,
          "warn",
        );
        outboundMailer = undefined;
      }
    }

    const effectiveTestCommand =
      verifyCommand.trim().length > 0
        ? verifyCommand.trim()
        : `"${process.execPath}" -e "process.exit(0)"`;

    try {
      const callerKind: DispatchCallerKind = "overnight_factory";
      const result = await this.overnightFactory.runEmailPipeline(email, {
        repoTarget: {
          repoPath: workspaceDir,
          repoSlug: NodePath.basename(workspaceDir),
          testCommand: effectiveTestCommand,
        },
        callerKind,
        agentProvider: provider,
        ...(model ? { agentModel: model } : {}),
        ...(config.strategy.secretaryBrain
          ? { secretaryBrain: config.strategy.secretaryBrain }
          : {}),
        enableOracleReview: config.strategy.oracleReviewEnabled,
        outboundMailer,
        ...(input.reportRecipient ? { reportRecipient: input.reportRecipient } : {}),
        ignoreTriggerCheck: true,
        allowNoFileChanges: input.allowNoFileChanges,
        signal: controller.signal,
        onProgress: (evt) => {
          if (evt.branchName && !record.branchName) {
            record.branchName = evt.branchName;
          }
          this.appendRunLog(record, evt.stage, evt.message, evt.level ?? "info");
        },
      });

      if (controller.signal.aborted) {
        record.status = "cancelled";
        record.stage = "cancelled";
        record.completedAt = this.now();
        this.persistRuns();
        return record;
      }

      const completedAt = this.now();
      record.jobId = result.jobId;
      record.threadId = result.threadId;
      record.status =
        result.status === "completed"
          ? "completed"
          : result.status === "awaiting_human_confirmation"
            ? "awaiting_human_confirmation"
            : "skipped";
      record.stage = record.status === "completed" ? "completed" : "reporting";
      record.branchName = result.branchName ?? record.branchName;
      record.commitSha = result.commitSha ?? null;
      record.changedFilesCount = result.changedFiles.length;
      record.changedFiles = result.changedFiles;
      record.diffSummary = result.diff ? result.diff.slice(0, 4000) : null;
      record.testPassed = result.testPassed ?? null;
      record.oracleSummary =
        result.report?.summary ??
        result.artifact?.plainLanguageSummary ??
        result.reviewComments[0] ??
        (config.strategy.localWorktreeOnlyNoPush
          ? "已完成隔离 Worktree 分支提交（仅本地分支，未自动 push）。"
          : "任务已完成。");
      record.reviewComments = result.reviewComments;
      record.deepLink =
        result.deepLink ?? (result.threadId ? buildReviewDeepLink(result.threadId) : null);
      record.reportSent = Boolean(result.mailReceipt);
      record.reportRecipient = result.mailReceipt ? input.reportRecipient || record.sender : null;
      record.completedAt = completedAt;
      record.errorMessage = null;
      this.persistRuns();
      return record;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isCancelled = err instanceof OvernightTaskCancelledError || controller.signal.aborted;
      const isPolicyBlocked = err instanceof AntigravityGuardDeniedError;
      record.status = isCancelled ? "cancelled" : isPolicyBlocked ? "blocked_policy" : "failed";
      record.stage = isCancelled ? "cancelled" : "failed";
      record.testPassed = isPolicyBlocked || isCancelled ? null : false;
      record.oracleSummary = isCancelled
        ? "任务已手动取消并清理临时工作树。"
        : isPolicyBlocked
          ? `安全策略拦截：${msg}`
          : `执行失败：${msg}`;
      record.completedAt = this.now();
      record.errorMessage = msg;
      this.appendRunLog(record, record.stage, record.oracleSummary, isCancelled ? "warn" : "error");

      if (
        !isCancelled &&
        !isPolicyBlocked &&
        input.sendEmailReport &&
        outboundMailer &&
        input.reportRecipient &&
        input.reportRecipient.includes("@")
      ) {
        try {
          const failureHtml = [
            "<!doctype html>",
            '<html lang="zh-CN"><body style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;padding:20px;background:#0f172a;color:#f8fafc;">',
            `<div style="max-width:640px;margin:0 auto;background:#1e293b;border-radius:12px;padding:20px;border:1px solid rgba(248,113,113,0.4);">`,
            `<h2 style="margin:0 0 8px 0;color:#fca5a5;">${escapeHtml(BRAND.appName)} 夜间全自动工场任务失败通知</h2>`,
            `<p style="margin:0 0 12px 0;color:#e2e8f0;">任务：<strong>${escapeHtml(record.subject)}</strong></p>`,
            `<p style="margin:0 0 12px 0;color:#cbd5e1;">工作区：<code>${escapeHtml(workspaceDir)}</code> · 代理：<code>${escapeHtml(provider)}</code></p>`,
            `<pre style="white-space:pre-wrap;word-break:break-word;background:#0f172a;padding:12px;border-radius:8px;color:#fecaca;">${escapeHtml(msg)}</pre>`,
            "</div></body></html>",
          ].join("\n");
          await outboundMailer.send({
            to: [input.reportRecipient],
            subject: `[${BRAND.appName} Overnight] 任务执行失败：${record.subject}`,
            html: failureHtml,
            text: `${BRAND.appName} 夜间全自动工场任务失败\n任务：${record.subject}\n工作区：${workspaceDir}\n错误：${msg}`,
          });
          record.reportSent = true;
          record.reportRecipient = input.reportRecipient;
          this.appendRunLog(
            record,
            "failed",
            `已向 ${input.reportRecipient} 发送失败通知邮件。`,
            "info",
          );
        } catch (mailErr) {
          const mailReason = mailErr instanceof Error ? mailErr.message : String(mailErr);
          this.appendRunLog(record, "failed", `失败通知邮件发送未成功：${mailReason}`, "warn");
        }
      }

      return record;
    }
  }

  private async executeInboundEmailJob(
    email: InboundEmailMessage,
    config: OvernightFactoryPersistedConfig,
    secrets: ResolvedOvernightSecrets,
  ): Promise<OvernightRunRecord> {
    const startedAt = this.now();
    const sender = extractEmailAddress(email.from) || email.from;
    const workspaceDir = config.strategy.targetWorkspaceDir.trim();
    const resolvedProvider = this.resolveEffectiveAgentProvider(config.strategy.agentProvider);
    const runId = `run-${startedAt}-${NodeCrypto.randomUUID().slice(0, 6)}`;
    const record: OvernightRunRecord = {
      id: runId,
      jobId: `fac-${startedAt}-${NodeCrypto.randomUUID().slice(0, 6)}`,
      messageId: email.messageId,
      threadId: "",
      subject: email.subject || "(无主题)",
      sender,
      status: "queued",
      stage: "queued",
      source: "email",
      taskId: null,
      workspaceDir: workspaceDir || null,
      provider: resolvedProvider,
      model: config.strategy.agentModel || null,
      prompt: email.textBody ?? email.htmlBody ?? email.subject ?? "",
      branchName: null,
      commitSha: null,
      changedFilesCount: 0,
      changedFiles: [],
      diffSummary: null,
      testPassed: null,
      oracleSummary: "",
      reviewComments: [],
      deepLink: null,
      reportSent: false,
      reportRecipient: sender,
      logs: [],
      createdAt: startedAt,
      startedAt: null,
      completedAt: startedAt,
      errorMessage: null,
    };
    this.appendRun(record);

    const controller = new AbortController();
    this.activeRunControllers.set(runId, controller);
    try {
      return await this.executeJobIntoRunRecord({
        record,
        email,
        workspaceDir,
        provider: resolvedProvider,
        model: config.strategy.agentModel,
        verifyCommand: "",
        sendEmailReport: true,
        reportRecipient: sender,
        allowNoFileChanges: true,
        config,
        secrets,
        controller,
      });
    } finally {
      this.activeRunControllers.delete(runId);
    }
  }

  listTasks(trustedCallerScope: CallerScope): {
    ok: true;
    tasks: OvernightTaskDefinition[];
    total: number;
  } {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/tasks");
    return {
      ok: true,
      tasks: structuredClone(this.tasks),
      total: this.tasks.length,
    };
  }

  createTask(
    rawBody: unknown,
    trustedCallerScope: CallerScope,
  ): { ok: true; task: OvernightTaskDefinition } {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/tasks");
    if (!isPlainRecord(rawBody)) {
      throw new BusinessRouteError(400, "INVALID_PARAMS", "任务参数必须为 JSON 对象。");
    }
    const prompt = typeof rawBody["prompt"] === "string" ? rawBody["prompt"].trim() : "";
    if (!prompt) {
      throw new BusinessRouteError(400, "TASK_PROMPT_REQUIRED", "请填写夜间任务目标或执行提示词。");
    }
    const workspaceDir =
      typeof rawBody["workspaceDir"] === "string" && rawBody["workspaceDir"].trim().length > 0
        ? rawBody["workspaceDir"].trim()
        : this.config.strategy.targetWorkspaceDir.trim();
    const rawProvider =
      typeof rawBody["provider"] === "string" && rawBody["provider"].trim().length > 0
        ? rawBody["provider"].trim()
        : this.config.strategy.agentProvider;
    const effectiveProvider = this.resolveEffectiveAgentProvider(rawProvider);
    this.assertProviderAllowedForUnattended(effectiveProvider);

    const title =
      typeof rawBody["title"] === "string" && rawBody["title"].trim().length > 0
        ? rawBody["title"].trim()
        : prompt.split(/\r?\n/)[0]!.slice(0, 60);
    const triggerMode: OvernightTaskDefinition["triggerMode"] =
      rawBody["triggerMode"] === "scheduled" || rawBody["triggerMode"] === "email"
        ? rawBody["triggerMode"]
        : "manual";
    const now = this.now();
    const task: OvernightTaskDefinition = {
      id: `task-${now}-${NodeCrypto.randomUUID().slice(0, 6)}`,
      title,
      prompt,
      workspaceDir,
      provider: rawProvider,
      model:
        typeof rawBody["model"] === "string"
          ? rawBody["model"].trim()
          : this.config.strategy.agentModel,
      verifyCommand:
        typeof rawBody["verifyCommand"] === "string" ? rawBody["verifyCommand"].trim() : "",
      triggerMode,
      sendEmailReport: rawBody["sendEmailReport"] !== false,
      reportRecipient:
        typeof rawBody["reportRecipient"] === "string"
          ? rawBody["reportRecipient"].trim()
          : this.resolveDefaultReportRecipient(this.config),
      allowNoFileChanges: rawBody["allowNoFileChanges"] !== false,
      enabled: rawBody["enabled"] !== false,
      createdAt: now,
      updatedAt: now,
      lastRunId: null,
      lastRunStatus: null,
      lastRunAt: null,
    };
    this.tasks.unshift(task);
    this.persistTasks();
    return { ok: true, task: structuredClone(task) };
  }

  updateTask(
    taskId: string,
    rawBody: unknown,
    trustedCallerScope: CallerScope,
  ): { ok: true; task: OvernightTaskDefinition } {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/tasks");
    if (!isPlainRecord(rawBody)) {
      throw new BusinessRouteError(400, "INVALID_PARAMS", "任务更新参数必须为 JSON 对象。");
    }
    const task = this.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new BusinessRouteError(404, "TASK_NOT_FOUND", `未找到夜间任务：${taskId}`);
    }
    if (typeof rawBody["provider"] === "string" && rawBody["provider"].trim().length > 0) {
      const effectiveProvider = this.resolveEffectiveAgentProvider(rawBody["provider"].trim());
      this.assertProviderAllowedForUnattended(effectiveProvider);
      task.provider = rawBody["provider"].trim();
    }
    if (typeof rawBody["title"] === "string" && rawBody["title"].trim().length > 0) {
      task.title = rawBody["title"].trim();
    }
    if (typeof rawBody["prompt"] === "string" && rawBody["prompt"].trim().length > 0) {
      task.prompt = rawBody["prompt"].trim();
    }
    if (typeof rawBody["workspaceDir"] === "string") {
      task.workspaceDir = rawBody["workspaceDir"].trim();
    }
    if (typeof rawBody["model"] === "string") {
      task.model = rawBody["model"].trim();
    }
    if (typeof rawBody["verifyCommand"] === "string") {
      task.verifyCommand = rawBody["verifyCommand"].trim();
    }
    if (
      rawBody["triggerMode"] === "manual" ||
      rawBody["triggerMode"] === "scheduled" ||
      rawBody["triggerMode"] === "email"
    ) {
      task.triggerMode = rawBody["triggerMode"];
    }
    if (typeof rawBody["sendEmailReport"] === "boolean") {
      task.sendEmailReport = rawBody["sendEmailReport"];
    }
    if (typeof rawBody["reportRecipient"] === "string") {
      task.reportRecipient = rawBody["reportRecipient"].trim();
    }
    if (typeof rawBody["allowNoFileChanges"] === "boolean") {
      task.allowNoFileChanges = rawBody["allowNoFileChanges"];
    }
    if (typeof rawBody["enabled"] === "boolean") {
      task.enabled = rawBody["enabled"];
    }
    task.updatedAt = this.now();
    this.persistTasks();
    return { ok: true, task: structuredClone(task) };
  }

  deleteTask(taskId: string, trustedCallerScope: CallerScope): { ok: true; deletedId: string } {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/tasks");
    const idx = this.tasks.findIndex((item) => item.id === taskId);
    if (idx < 0) {
      throw new BusinessRouteError(404, "TASK_NOT_FOUND", `未找到夜间任务：${taskId}`);
    }
    this.tasks.splice(idx, 1);
    this.persistTasks();
    return { ok: true, deletedId: taskId };
  }

  async runTaskById(
    taskId: string,
    rawBody: unknown,
    trustedCallerScope: CallerScope,
  ): Promise<{ ok: true; run: OvernightRunRecord; message: string }> {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/tasks");
    const task = this.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new BusinessRouteError(404, "TASK_NOT_FOUND", `未找到夜间任务：${taskId}`);
    }
    const body = isPlainRecord(rawBody) ? rawBody : {};
    return this.runManualTask(
      {
        taskId: task.id,
        title: task.title,
        prompt: task.prompt,
        workspaceDir: task.workspaceDir,
        provider: task.provider,
        model: task.model,
        verifyCommand: task.verifyCommand,
        sendEmailReport: task.sendEmailReport,
        reportRecipient: task.reportRecipient,
        allowNoFileChanges: task.allowNoFileChanges,
        wait: body["wait"] === true,
        ...(body["source"] === "scheduled" ? { source: "scheduled" } : {}),
      },
      trustedCallerScope,
    );
  }

  async runManualTask(
    rawBody: unknown,
    trustedCallerScope: CallerScope,
  ): Promise<{ ok: true; run: OvernightRunRecord; message: string }> {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/run-now");
    if (!isPlainRecord(rawBody)) {
      throw new BusinessRouteError(400, "INVALID_PARAMS", "执行参数必须为 JSON 对象。");
    }

    const prompt = typeof rawBody["prompt"] === "string" ? rawBody["prompt"].trim() : "";
    if (!prompt) {
      throw new BusinessRouteError(
        400,
        "TASK_PROMPT_REQUIRED",
        "请填写需要夜间工场执行的任务提示词。",
      );
    }
    const workspaceDir =
      typeof rawBody["workspaceDir"] === "string" && rawBody["workspaceDir"].trim().length > 0
        ? rawBody["workspaceDir"].trim()
        : this.config.strategy.targetWorkspaceDir.trim();
    if (!workspaceDir) {
      throw new BusinessRouteError(
        400,
        "WORKSPACE_REQUIRED",
        "请先选择或填写有效的本地 Git 目标工作区目录。",
      );
    }

    const requestedProvider =
      typeof rawBody["provider"] === "string" && rawBody["provider"].trim().length > 0
        ? rawBody["provider"].trim()
        : this.config.strategy.agentProvider;
    const effectiveProvider = this.resolveEffectiveAgentProvider(requestedProvider);
    this.assertProviderAllowedForUnattended(effectiveProvider);

    const model =
      typeof rawBody["model"] === "string"
        ? rawBody["model"].trim()
        : this.config.strategy.agentModel;
    const verifyCommand =
      typeof rawBody["verifyCommand"] === "string" ? rawBody["verifyCommand"].trim() : "";
    const title =
      typeof rawBody["title"] === "string" && rawBody["title"].trim().length > 0
        ? rawBody["title"].trim()
        : prompt.split(/\r?\n/)[0]!.slice(0, 64);
    const taskId =
      typeof rawBody["taskId"] === "string" && rawBody["taskId"].trim().length > 0
        ? rawBody["taskId"].trim()
        : null;
    const sendEmailReport = rawBody["sendEmailReport"] !== false;
    const allowNoFileChanges = rawBody["allowNoFileChanges"] !== false;
    const wait = rawBody["wait"] === true;

    const { config, secrets } = await this.resolveEffectiveMailInput(rawBody);
    const reportRecipient =
      typeof rawBody["reportRecipient"] === "string" && rawBody["reportRecipient"].trim().length > 0
        ? rawBody["reportRecipient"].trim()
        : this.resolveDefaultReportRecipient(config);

    const startedAt = this.now();
    const runId = `run-${startedAt}-${NodeCrypto.randomUUID().slice(0, 6)}`;
    const messageId = `<manual-${runId}@prismux.local>`;
    const sender = reportRecipient || "manual@prismux.local";

    const runSource: OvernightRunRecord["source"] =
      rawBody["source"] === "scheduled" ? "scheduled" : "manual";
    const record: OvernightRunRecord = {
      id: runId,
      jobId: `fac-manual-${NodeCrypto.randomUUID().slice(0, 6)}`,
      messageId,
      threadId: "",
      subject: title,
      sender,
      status: "queued",
      stage: "queued",
      source: runSource,
      taskId,
      workspaceDir,
      provider: effectiveProvider,
      model: model || null,
      prompt,
      verifyCommand: verifyCommand || null,
      branchName: null,
      commitSha: null,
      changedFilesCount: 0,
      changedFiles: [],
      diffSummary: null,
      testPassed: null,
      oracleSummary: "任务已加入夜间工场执行队列...",
      reviewComments: [],
      deepLink: null,
      reportSent: false,
      reportRecipient: sendEmailReport ? reportRecipient || null : null,
      logs: [
        {
          timestamp: startedAt,
          level: "info",
          stage: "queued",
          message: `已创建手动执行任务「${title}」（代理：${effectiveProvider}${model ? ` / ${model}` : ""}）`,
        },
      ],
      createdAt: startedAt,
      startedAt: null,
      completedAt: startedAt,
      errorMessage: null,
    };
    this.appendRun(record);

    const syntheticEmail: InboundEmailMessage = {
      messageId,
      from: sender,
      to: [sender],
      subject: title,
      textBody: prompt,
      receivedAt: startedAt,
    };

    const controller = new AbortController();
    this.activeRunControllers.set(runId, controller);

    const execPromise = this.executeJobIntoRunRecord({
      record,
      email: syntheticEmail,
      workspaceDir,
      provider: effectiveProvider,
      model,
      verifyCommand,
      sendEmailReport,
      reportRecipient,
      allowNoFileChanges,
      config,
      secrets,
      controller,
    }).finally(() => {
      this.activeRunControllers.delete(runId);
      this.activeRunPromises.delete(runId);
      if (taskId) {
        const linkedTask = this.tasks.find((t) => t.id === taskId);
        if (linkedTask) {
          linkedTask.lastRunId = record.id;
          linkedTask.lastRunStatus = record.status;
          linkedTask.lastRunAt = record.completedAt;
          this.persistTasks();
        }
      }
    });
    this.activeRunPromises.set(runId, execPromise);

    if (wait) {
      const completed = await execPromise;
      return {
        ok: true,
        run: structuredClone(completed),
        message:
          completed.status === "completed"
            ? `任务「${title}」已完成（分支：${completed.branchName ?? "-"}）。`
            : completed.status === "cancelled"
              ? `任务「${title}」已取消。`
              : `任务「${title}」执行结束（${completed.status}）：${completed.errorMessage ?? completed.oracleSummary}`,
      };
    }

    // Background execution: prevent unhandled rejection & return live queued/running record immediately.
    void execPromise.catch(() => undefined);
    return {
      ok: true,
      run: structuredClone(record),
      message: `已启动夜间工场任务「${title}」，正在隔离 Worktree 中执行。`,
    };
  }

  getRunById(
    runId: string,
    trustedCallerScope: CallerScope,
  ): { ok: true; run: OvernightRunRecord } {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/runs");
    const run = this.runs.find((item) => item.id === runId);
    if (!run) {
      throw new BusinessRouteError(404, "RUN_NOT_FOUND", `未找到运行记录：${runId}`);
    }
    return { ok: true, run: structuredClone(run) };
  }

  cancelRun(
    runId: string,
    trustedCallerScope: CallerScope,
  ): { ok: true; run: OvernightRunRecord; message: string } {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/runs");
    const run = this.runs.find((item) => item.id === runId);
    if (!run) {
      throw new BusinessRouteError(404, "RUN_NOT_FOUND", `未找到运行记录：${runId}`);
    }
    const controller = this.activeRunControllers.get(runId);
    if (controller) {
      controller.abort();
      this.activeRunControllers.delete(runId);
    }
    if (run.status === "queued" || run.status === "running") {
      run.status = "cancelled";
      run.stage = "cancelled";
      run.completedAt = this.now();
      run.errorMessage = "用户已手动取消该任务。";
      run.oracleSummary = "任务已手动取消并清理临时工作树。";
      this.appendRunLog(run, "cancelled", "用户触发取消操作，正在终止子进程并清理工作树。", "warn");
    }
    return {
      ok: true,
      run: structuredClone(run),
      message: `已取消运行记录「${run.subject}」。`,
    };
  }

  async retryRun(
    runId: string,
    rawBody: unknown,
    trustedCallerScope: CallerScope,
  ): Promise<{ ok: true; run: OvernightRunRecord; message: string }> {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/runs");
    const existing = this.runs.find((item) => item.id === runId);
    if (!existing) {
      throw new BusinessRouteError(404, "RUN_NOT_FOUND", `未找到运行记录：${runId}`);
    }
    const body = isPlainRecord(rawBody) ? rawBody : {};
    return this.runManualTask(
      {
        taskId: existing.taskId ?? undefined,
        title: existing.subject,
        prompt: existing.prompt || existing.subject,
        workspaceDir: existing.workspaceDir || this.config.strategy.targetWorkspaceDir,
        provider: existing.provider || this.config.strategy.agentProvider,
        model: existing.model || this.config.strategy.agentModel,
        verifyCommand: existing.verifyCommand || "",
        sendEmailReport: Boolean(existing.reportRecipient),
        reportRecipient: existing.reportRecipient || "",
        wait: body["wait"] === true,
      },
      trustedCallerScope,
    );
  }

  deleteRun(runId: string, trustedCallerScope: CallerScope): { ok: true; deletedId: string } {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/runs");
    if (this.activeRunControllers.has(runId)) {
      throw new BusinessRouteError(409, "RUN_ACTIVE", "运行中的任务无法删除，请先取消运行。");
    }
    const idx = this.runs.findIndex((item) => item.id === runId);
    if (idx < 0) {
      throw new BusinessRouteError(404, "RUN_NOT_FOUND", `未找到运行记录：${runId}`);
    }
    this.runs.splice(idx, 1);
    this.persistRuns();
    return { ok: true, deletedId: runId };
  }

  getRuns(
    rawLimit: number | null,
    trustedCallerScope: CallerScope,
  ): {
    ok: true;
    runs: OvernightRunRecord[];
    total: number;
    activeRunsCount: number;
    lastPollAt: number | null;
    lastPollError: string | null;
  } {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/runs");
    const limit =
      typeof rawLimit === "number" && Number.isFinite(rawLimit)
        ? Math.min(MAX_PERSISTED_RUNS, Math.max(1, Math.trunc(rawLimit)))
        : 30;
    return {
      ok: true,
      runs: this.runs.slice(0, limit),
      total: this.runs.length,
      activeRunsCount: this.activeRunControllers.size,
      lastPollAt: this.lastPollAt,
      lastPollError: this.lastPollError,
    };
  }
}
