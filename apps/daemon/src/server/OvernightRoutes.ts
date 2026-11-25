import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeTls from "node:tls";
import * as NodeUtil from "node:util";
import type { EncryptedPluginCredentialStore } from "@prismux/cordis-kernel";
import type { SqliteMemoryStore } from "@prismux/memory-core";
import {
  BRAND,
  isAntigravityProvider,
  type CallerScope,
  type DispatchCallerKind
} from "@prismux/protocol";
import type { DesktopIpcDispatchHub } from "../dispatch/DesktopIpcDispatchHub.js";
import {
  AntigravityGuardDeniedError,
  type AntigravityPolicyGuard
} from "../security/AntigravityPolicyGuard.js";
import {
  buildSafeCliSpawnSpec,
  decodeWindowsProcessOutput,
  findExecutableOnPath
} from "../system/WindowsEnvRefresh.js";
import {
  GmailOAuth2InboundAdapter,
  ImapIdleInboundAdapter,
  OvernightFactory,
  buildReviewDeepLink,
  escapeHtml,
  matchesFactoryTrigger,
  type FactoryInboundMode,
  type FactoryMorningReport,
  type InboundEmailMessage,
  type MailInboundAdapter,
  type OutboundMailPayload,
  type OutboundMailReceipt,
  type OutboundMailer,
  type OvernightSecretaryBrain
} from "../workflows/OvernightFactory.js";
import { BusinessRouteError } from "./DaemonBusinessRoutes.js";

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);

export const OVERNIGHT_CREDENTIAL_BUCKET = "overnight-factory" as const;
const OVERNIGHT_CONFIG_FILENAME = "overnight-factory.json" as const;
const OVERNIGHT_RUNS_FILENAME = "overnight-factory-runs.json" as const;
const MAX_PERSISTED_RUNS = 100;
const OAUTH_STATE_TTL_MS = 10 * 60_000;
const AGENT_MAIL_PROBE_CACHE_TTL_MS = 15_000;
const AGENT_MAIL_SNAPSHOT_PROBE_TIMEOUT_MS = 2_500;
const AGENT_MAIL_STATUS_TIMEOUT_MS = 8_000;
const AGENT_MAIL_INSTALL_TIMEOUT_MS = 120_000;
const AGENT_MAIL_LOGIN_URL_WAIT_MS = 10_000;
const AGENT_MAIL_LOGIN_MAX_LIFETIME_MS = 5 * 60_000;
const AGENT_MAIL_CLI_OP_TIMEOUT_MS = 15_000;

export const AGENT_MAIL_CLI_COMMAND = "agently-cli" as const;
export const AGENT_MAIL_NPM_PACKAGE = "@tencent-qqmail/agently-cli" as const;
export const AGENT_MAIL_PORTAL_URL = "https://agent.qq.com/page" as const;
export const AGENT_MAIL_DOC_URL = "https://agent.qq.com/doc/cli-setup.md" as const;

export type OvernightEmailProvider = "imap_smtp" | "gmail_oauth2" | "agent_mail";
export type OvernightNeteaseDomain = "163.com" | "126.com";
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
  | "completed"
  | "failed"
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
  "custom"
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
    smtpSecure: true
  },
  "126.com": {
    imapHost: "imap.126.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.126.com",
    smtpPort: 465,
    smtpSecure: true
  }
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
    smtpSecure: true
  },
  qq: {
    id: "qq",
    label: "QQ 邮箱",
    imapHost: "imap.qq.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.qq.com",
    smtpPort: 465,
    smtpSecure: true
  },
  agent_mail: {
    id: "agent_mail",
    label: "Agent 邮箱",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true
  },
  outlook: {
    id: "outlook",
    label: "Outlook / Exchange",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false
  },
  netease: {
    id: "netease",
    label: "网易邮箱（163 / 126）",
    imapHost: "imap.163.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.163.com",
    smtpPort: 465,
    smtpSecure: true
  },
  custom: {
    id: "custom",
    label: "自定义",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true
  }
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
  return null;
}

export function normalizeOvernightMailPresetId(
  value: unknown,
  fallback: OvernightCanonicalMailPresetId
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
  email?: string
): OvernightMailPresetSpec {
  const canonical = normalizeOvernightMailPresetId(rawPreset, "qq");
  if (canonical === "netease") {
    const emailDomain = email ? detectNeteaseDomainFromEmail(email) : null;
    const domain: OvernightNeteaseDomain =
      rawPreset === "126" ? "126.com" : emailDomain ?? "163.com";
    const hosts = NETEASE_MAIL_DOMAIN_HOSTS[domain];
    return {
      ...OVERNIGHT_MAIL_PRESETS.netease,
      ...hosts
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

export function extractAgentMailAddress(rawOutput: string): string | null {
  const cleaned = stripAnsiEscapes(rawOutput).trim();
  if (!cleaned) return null;

  const directAgent = /([a-zA-Z0-9._%+-]+@agent\.qq\.com)/i.exec(cleaned);
  if (directAgent?.[1]) {
    return directAgent[1].toLowerCase();
  }

  if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
    try {
      const parsed = JSON.parse(cleaned) as unknown;
      const fromJson = findEmailInJsonValue(parsed);
      if (fromJson) return fromJson;
    } catch {
      // fall through to regex match
    }
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
  gmail: OvernightGmailConfig;
  imapSmtp: OvernightImapSmtpConfig;
  strategy: OvernightStrategyConfig;
}

export interface OvernightAgentMailRuntimeSnapshot {
  cliInstalled: boolean;
  cliPath?: string;
  authorizedEmail?: string | null;
  authInProgress?: boolean;
  pendingAuthUrl?: string | null;
  lastError?: string | null;
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
  cliPath?: string;
  authorizedEmail?: string | null;
  authUrl?: string | null;
  authInProgress?: boolean;
  stdout?: string;
  stderr?: string;
  agentMail?: OvernightAgentMailRuntimeSnapshot;
}

export interface OvernightRunRecord {
  id: string;
  jobId: string;
  messageId: string;
  threadId: string;
  subject: string;
  sender: string;
  status: OvernightRunStatus;
  branchName: string | null;
  changedFilesCount: number;
  testPassed: boolean | null;
  oracleSummary: string;
  reviewComments: string[];
  deepLink: string | null;
  reportSent: boolean;
  createdAt: number;
  completedAt: number;
  errorMessage: string | null;
}

export interface OvernightConfigSnapshot {
  ok: true;
  config: OvernightFactoryPersistedConfig;
  secrets: OvernightSecretPresence;
  credentialsFile: string;
  agentMail: OvernightAgentMailRuntimeSnapshot;
  runtime: {
    pollerActive: boolean;
    inAllowedWindow: boolean;
    oauthPending: boolean;
    lastPollAt: number | null;
    lastPollError: string | null;
    lastTestResult: OvernightMailTestResult | null;
    runsCount: number;
  };
}

export interface OvernightTestReportResult {
  ok: true;
  messageId: string;
  recipient: string;
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
    payload: OutboundMailPayload
  ) => Promise<OutboundMailReceipt>;
  createInboundAdapter?: (
    config: OvernightFactoryPersistedConfig,
    secrets: ResolvedOvernightSecrets
  ) => MailInboundAdapter | null;
  createOutboundMailer?: (
    config: OvernightFactoryPersistedConfig,
    secrets: ResolvedOvernightSecrets
  ) => OutboundMailer | null;
  findAgentMailCli?: () => string | null;
  runAgentMailCli?: (
    cliPath: string,
    args: readonly string[],
    timeoutMs: number
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
    `.tmp-${NodePath.basename(filePath)}-${NodeCrypto.randomUUID()}`
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

function assertOwnerChief(
  trustedCallerScope: CallerScope,
  resourceName: string
): void {
  if (trustedCallerScope !== "owner_chief") {
    throw new BusinessRouteError(
      403,
      "FORBIDDEN_SCOPE",
      `Scope "${trustedCallerScope}" is not permitted to access ${resourceName}.`
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

export function isSenderAllowed(
  senderRaw: string,
  allowedSenders: readonly string[]
): boolean {
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
  nowMs: number = Date.now()
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
    gmail: {
      clientId: "",
      redirectUri: "",
      boundEmail: "",
      connected: false,
      connectedAt: null
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
      fromName: `${BRAND.appName} Overnight Factory`
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
      localWorktreeOnlyNoPush: true
    }
  };
}

function normalizePersistedConfig(raw: unknown): OvernightFactoryPersistedConfig {
  const base = createDefaultOvernightConfig();
  if (!isPlainRecord(raw)) return base;

  const rawMode: FactoryInboundMode =
    raw["mode"] === "gmail-oauth2" || raw["mode"] === "imap"
      ? raw["mode"]
      : base.mode;
  const enabled =
    typeof raw["enabled"] === "boolean" ? raw["enabled"] : base.enabled;

  const gmailRaw = isPlainRecord(raw["gmail"]) ? raw["gmail"] : {};
  const gmail: OvernightGmailConfig = {
    clientId:
      typeof gmailRaw["clientId"] === "string"
        ? gmailRaw["clientId"].trim()
        : base.gmail.clientId,
    redirectUri:
      typeof gmailRaw["redirectUri"] === "string"
        ? gmailRaw["redirectUri"].trim()
        : base.gmail.redirectUri,
    boundEmail:
      typeof gmailRaw["boundEmail"] === "string"
        ? gmailRaw["boundEmail"].trim()
        : base.gmail.boundEmail,
    connected:
      typeof gmailRaw["connected"] === "boolean"
        ? gmailRaw["connected"]
        : base.gmail.connected,
    connectedAt:
      typeof gmailRaw["connectedAt"] === "number" &&
      Number.isFinite(gmailRaw["connectedAt"])
        ? gmailRaw["connectedAt"]
        : null,
    ...(typeof gmailRaw["lastHistoryId"] === "string" &&
    gmailRaw["lastHistoryId"].trim().length > 0
      ? { lastHistoryId: gmailRaw["lastHistoryId"].trim() }
      : {})
  };

  const imapRaw = isPlainRecord(raw["imapSmtp"]) ? raw["imapSmtp"] : {};
  const presetRaw = imapRaw["preset"];
  const email =
    typeof imapRaw["email"] === "string"
      ? imapRaw["email"].trim()
      : base.imapSmtp.email;
  const preset: OvernightCanonicalMailPresetId = normalizeOvernightMailPresetId(
    presetRaw,
    base.imapSmtp.preset
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

  const imapSmtp: OvernightImapSmtpConfig = {
    preset: emailProvider === "agent_mail" ? "agent_mail" : preset,
    email,
    imapHost:
      typeof imapRaw["imapHost"] === "string" && imapRaw["imapHost"].trim().length > 0
        ? imapRaw["imapHost"].trim()
        : presetSpec.imapHost,
    imapPort: clampPort(imapRaw["imapPort"], presetSpec.imapPort),
    imapSecure:
      typeof imapRaw["imapSecure"] === "boolean"
        ? imapRaw["imapSecure"]
        : presetSpec.imapSecure,
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
      typeof imapRaw["smtpSecure"] === "boolean"
        ? imapRaw["smtpSecure"]
        : presetSpec.smtpSecure,
    smtpUsername:
      typeof imapRaw["smtpUsername"] === "string"
        ? imapRaw["smtpUsername"].trim()
        : base.imapSmtp.smtpUsername,
    fromName:
      typeof imapRaw["fromName"] === "string" && imapRaw["fromName"].trim().length > 0
        ? imapRaw["fromName"].trim()
        : base.imapSmtp.fromName
  };

  const stratRaw = isPlainRecord(raw["strategy"]) ? raw["strategy"] : {};
  const windowMode: OvernightWindowMode =
    stratRaw["windowMode"] === "always" || stratRaw["windowMode"] === "scheduled"
      ? stratRaw["windowMode"]
      : base.strategy.windowMode;

  const strategy: OvernightStrategyConfig = {
    triggerTag:
      typeof stratRaw["triggerTag"] === "string" &&
      stratRaw["triggerTag"].trim().length > 0
        ? stratRaw["triggerTag"].trim()
        : "#factory",
    allowedSenders: normalizeAllowedSenders(stratRaw["allowedSenders"]),
    windowMode,
    windowStart: normalizeTimeHHMM(stratRaw["windowStart"], base.strategy.windowStart),
    windowEnd: normalizeTimeHHMM(stratRaw["windowEnd"], base.strategy.windowEnd),
    pollIntervalMinutes: clampPollMinutes(
      stratRaw["pollIntervalMinutes"],
      base.strategy.pollIntervalMinutes
    ),
    targetWorkspaceDir:
      typeof stratRaw["targetWorkspaceDir"] === "string"
        ? stratRaw["targetWorkspaceDir"].trim()
        : "",
    agentProvider:
      typeof stratRaw["agentProvider"] === "string" &&
      stratRaw["agentProvider"].trim().length > 0
        ? stratRaw["agentProvider"].trim()
        : base.strategy.agentProvider,
    agentModel:
      typeof stratRaw["agentModel"] === "string"
        ? stratRaw["agentModel"].trim()
        : "",
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
        : true
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
    gmail,
    imapSmtp,
    strategy
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
    `Content-Type: multipart/alternative; boundary="${boundary}"`
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
    ""
  ].join("\r\n");
}

function dotStuffSmtpBody(rawMessage: string): string {
  const normalized = rawMessage.replace(/\r?\n/g, "\r\n");
  return normalized
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

/**
 * Probes IMAP TLS/TCP connectivity, authenticates with LOGIN, selects the mailbox,
 * and logs out cleanly. Never exposes credentials in error strings.
 */
export async function defaultProbeImapConnection(
  params: ImapProbeParams
): Promise<OvernightMailProbeChannelResult> {
  const startedAt = Date.now();
  const timeoutMs = params.timeoutMs ?? 10_000;
  if (!params.host.trim()) {
    return { ok: false, latencyMs: 0, message: "未填写 IMAP 服务器主机地址。" };
  }
  if (!params.username.trim()) {
    return { ok: false, latencyMs: 0, message: "未填写 IMAP 登录账号/邮箱。" };
  }
  if (!params.password) {
    return { ok: false, latencyMs: 0, message: "未填写或未保存 IMAP 授权码/密码。" };
  }

  let socket: NodeNet.Socket | NodeTls.TLSSocket | undefined;
  try {
    socket = await new Promise<NodeNet.Socket | NodeTls.TLSSocket>((resolveSocket, rejectSocket) => {
      const s = params.secure
        ? NodeTls.connect({
            host: params.host,
            port: params.port,
            servername: params.host
          })
        : NodeNet.connect({
            host: params.host,
            port: params.port
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
    });

    let buffer = "";
    const waiters: Array<() => void> = [];
    const notify = () => {
      while (waiters.length > 0) {
        waiters.shift()?.();
      }
    };
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      notify();
    });
    socket.on("close", notify);
    socket.on("error", notify);

    const readLine = async (label: string): Promise<string> => {
      const start = Date.now();
      while (!/\r?\n/.test(buffer)) {
        if (socket!.destroyed || socket!.closed) {
          throw new Error(`IMAP 连接在等待 ${label} 时意外关闭。`);
        }
        if (Date.now() - start > timeoutMs) {
          throw new Error(`IMAP 等待 ${label} 超时。`);
        }
        await new Promise<void>((r) => waiters.push(r));
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
        if (Date.now() - start > timeoutMs) {
          throw new Error(`IMAP ${label} 超时。`);
        }
        await new Promise<void>((r) => waiters.push(r));
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
      "认证登录（请检查账号与邮箱授权码）"
    );
    const selectResp = await sendCmd(
      `SELECT ${escapeImapQuoted(params.mailbox || "INBOX")}`,
      `打开邮箱 ${params.mailbox || "INBOX"}`
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
      detail: `${params.host}:${params.port} (${params.secure ? "TLS" : "TCP"})`
    };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    return {
      ok: false,
      latencyMs,
      message: err instanceof Error ? err.message : String(err),
      detail: `${params.host}:${params.port}`
    };
  } finally {
    socket?.destroy();
  }
}

async function runSmtpTransaction(
  params: SmtpConfigParams,
  payload?: OutboundMailPayload
): Promise<{ messageId: string; latencyMs: number }> {
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

  let socket: NodeNet.Socket | NodeTls.TLSSocket = await new Promise((resolveSocket, rejectSocket) => {
    const s = params.secure
      ? NodeTls.connect({
          host: params.host,
          port: params.port,
          servername: params.host
        })
      : NodeNet.connect({
          host: params.host,
          port: params.port
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
  });

  let buffer = "";
  let waiters: Array<() => void> = [];
  const attachListeners = (sock: NodeNet.Socket | NodeTls.TLSSocket) => {
    const notify = () => {
      const pending = waiters;
      waiters = [];
      for (const fn of pending) fn();
    };
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      buffer += chunk;
      notify();
    });
    sock.on("close", notify);
    sock.on("error", notify);
  };
  attachListeners(socket);

  const readResponse = async (label: string): Promise<{ code: number; text: string }> => {
    const start = Date.now();
    const lines: string[] = [];
    while (true) {
      while (!/\r?\n/.test(buffer)) {
        if (socket.destroyed || socket.closed) {
          throw new Error(`SMTP 连接在 ${label} 期间关闭。`);
        }
        if (Date.now() - start > timeoutMs) {
          throw new Error(`SMTP ${label} 超时。`);
        }
        await new Promise<void>((r) => waiters.push(r));
      }
      const nlIdx = buffer.indexOf("\n");
      const line = buffer.slice(0, nlIdx + 1).replace(/\r?\n$/, "");
      buffer = buffer.slice(nlIdx + 1);
      lines.push(line);
      const match = /^(\d{3})([ -])/.exec(line);
      if (match && match[2] === " ") {
        return {
          code: Number.parseInt(match[1]!, 10),
          text: lines.join("\n")
        };
      }
    }
  };

  const sendCommand = async (
    cmd: string,
    expectedCodes: readonly number[],
    label: string
  ): Promise<{ code: number; text: string }> => {
    socket.write(`${cmd}\r\n`);
    const resp = await readResponse(label);
    if (!expectedCodes.includes(resp.code)) {
      throw new Error(`SMTP ${label} 失败 (${resp.code})：${resp.text}`);
    }
    return resp;
  };

  try {
    const greeting = await readResponse("服务器问候");
    if (greeting.code !== 220) {
      throw new Error(`SMTP 问候异常 (${greeting.code})：${greeting.text}`);
    }

    let ehlo = await sendCommand("EHLO prismux.local", [250], "EHLO");

    if (!params.secure && /STARTTLS/i.test(ehlo.text)) {
      await sendCommand("STARTTLS", [220], "STARTTLS");
      const rawPlain = socket;
      rawPlain.removeAllListeners("data");
      rawPlain.removeAllListeners("close");
      rawPlain.removeAllListeners("error");
      buffer = "";
      socket = await new Promise<NodeTls.TLSSocket>((resolveTls, rejectTls) => {
        const tlsSock = NodeTls.connect({
          socket: rawPlain,
          servername: params.host
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
      attachListeners(socket);
      ehlo = await sendCommand("EHLO prismux.local", [250], "EHLO (TLS)");
    }

    await sendCommand("AUTH LOGIN", [334], "AUTH LOGIN");
    await sendCommand(
      Buffer.from(params.username, "utf8").toString("base64"),
      [334],
      "SMTP 账号验证"
    );
    await sendCommand(
      Buffer.from(params.password, "utf8").toString("base64"),
      [235],
      "SMTP 密码/授权码认证"
    );

    const messageId = `prismux-${Date.now()}-${NodeCrypto.randomUUID().slice(0, 8)}@prismux.local`;

    if (payload) {
      const fromAddr = extractEmailAddress(params.fromAddress || params.username);
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
        references: payload.references
      });
      socket.write(`${dotStuffSmtpBody(mime)}\r\n.\r\n`);
      const dataResp = await readResponse("发送邮件正文");
      if (dataResp.code !== 250) {
        throw new Error(`SMTP 正文投递失败 (${dataResp.code})：${dataResp.text}`);
      }
    }

    try {
      await sendCommand("QUIT", [221, 250], "QUIT");
    } catch {
      // ignore quit errors
    }

    return {
      messageId,
      latencyMs: Math.max(1, Date.now() - startedAt)
    };
  } finally {
    socket.destroy();
  }
}

export async function defaultProbeSmtpConnection(
  params: SmtpConfigParams
): Promise<OvernightMailProbeChannelResult> {
  const startedAt = Date.now();
  try {
    const res = await runSmtpTransaction(params);
    return {
      ok: true,
      latencyMs: res.latencyMs,
      message: "SMTP 认证与发信通道验证成功",
      detail: `${params.host}:${params.port} (${params.secure ? "TLS" : "STARTTLS/TCP"})`
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.max(1, Date.now() - startedAt),
      message: err instanceof Error ? err.message : String(err),
      detail: `${params.host}:${params.port}`
    };
  }
}

export async function defaultSendSmtpMail(
  params: SmtpConfigParams,
  payload: OutboundMailPayload
): Promise<OutboundMailReceipt> {
  const res = await runSmtpTransaction(params, payload);
  return {
    messageId: res.messageId,
    acceptedAt: Date.now(),
    provider: `smtp:${params.host}`
  };
}

function createPkceChallenge(verifier: string): string {
  return NodeCrypto.createHash("sha256")
    .update(verifier, "utf8")
    .digest("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function defaultFindAgentMailCli(): string | null {
  return findExecutableOnPath([AGENT_MAIL_CLI_COMMAND]);
}

async function runSafeCommandWithOutput(
  executablePath: string,
  args: readonly string[],
  timeoutMs: number
): Promise<AgentMailCommandOutput> {
  const spec = buildSafeCliSpawnSpec(executablePath, args);
  try {
    const result = await execFileAsync(spec.file, spec.args, {
      timeout: timeoutMs,
      windowsHide: true,
      windowsVerbatimArguments: spec.windowsVerbatimArguments,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "buffer",
      env: { ...spec.env, NO_COLOR: "1", FORCE_COLOR: "0" }
    });
    return {
      exitCode: 0,
      stdout: decodeWindowsProcessOutput(result.stdout),
      stderr: decodeWindowsProcessOutput(result.stderr)
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
      errorMessage: err instanceof Error ? err.message : String(err)
    };
  }
}

async function defaultRunAgentMailCli(
  cliPath: string,
  args: readonly string[],
  timeoutMs: number
): Promise<AgentMailCommandOutput> {
  return runSafeCommandWithOutput(cliPath, args, timeoutMs);
}

async function defaultInstallAgentMailCli(timeoutMs: number): Promise<AgentMailCommandOutput> {
  const npmPath = findExecutableOnPath(["npm"]);
  if (!npmPath) {
    return {
      exitCode: 127,
      stdout: "",
      stderr: "",
      errorMessage: "未在 PATH 中找到 npm，请先安装 Node.js 或在终端手动执行 npm install -g @tencent-qqmail/agently-cli。"
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
    env: { ...spec.env, NO_COLOR: "1", FORCE_COLOR: "0" }
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
    }
  };
}

function parseAgentMailListMessages(rawOutput: string): InboundEmailMessage[] {
  const cleaned = stripAnsiEscapes(rawOutput).trim();
  if (!cleaned) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  const items: unknown[] = Array.isArray(parsed)
    ? parsed
    : isPlainRecord(parsed) && Array.isArray(parsed["messages"])
      ? parsed["messages"]
      : isPlainRecord(parsed) && Array.isArray(parsed["data"])
        ? parsed["data"]
        : isPlainRecord(parsed) && Array.isArray(parsed["items"])
          ? parsed["items"]
          : [];

  const out: InboundEmailMessage[] = [];
  for (const item of items) {
    if (!isPlainRecord(item)) continue;
    const rawId = item["id"] ?? item["messageId"] ?? item["message_id"] ?? item["uid"];
    const messageId =
      typeof rawId === "string" && rawId.trim().length > 0
        ? rawId.trim()
        : typeof rawId === "number"
          ? String(rawId)
          : `agent-mail-${NodeCrypto.randomUUID().slice(0, 8)}`;
    const fromVal = item["from"] ?? item["sender"] ?? "";
    const from =
      typeof fromVal === "string"
        ? fromVal
        : isPlainRecord(fromVal) && typeof fromVal["address"] === "string"
          ? fromVal["address"]
          : isPlainRecord(fromVal) && typeof fromVal["email"] === "string"
            ? fromVal["email"]
            : "";
    const toVal = item["to"];
    const to = Array.isArray(toVal)
      ? toVal.filter((entry): entry is string => typeof entry === "string")
      : typeof toVal === "string" && toVal.trim().length > 0
        ? [toVal.trim()]
        : [];
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
    out.push({
      messageId,
      from,
      to,
      subject,
      ...(textBody !== undefined ? { textBody } : {}),
      ...(htmlBody !== undefined ? { htmlBody } : {})
    });
  }
  return out;
}

function renderOAuthCallbackHtml(options: {
  ok: boolean;
  title: string;
  detail: string;
}): string {
  const badgeColor = options.ok ? "#16a34a" : "#dc2626";
  const badgeBg = options.ok ? "#dcfce7" : "#fee2e2";
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(options.title)} · ${escapeHtml(BRAND.appName)}</title>`,
    "</head>",
    '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'PingFang SC\',sans-serif;padding:24px;">',
    '<div style="max-width:440px;width:100%;background:#1e293b;border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,0.45);text-align:center;">',
    `<div style="display:inline-block;padding:4px 12px;border-radius:999px;background:${badgeBg};color:${badgeColor};font-size:12px;font-weight:700;margin-bottom:12px;">${options.ok ? "Gmail OAuth2 绑定成功" : "Gmail OAuth2 绑定失败"}</div>`,
    `<h1 style="margin:0 0 8px 0;font-size:18px;color:#ffffff;">${escapeHtml(options.title)}</h1>`,
    `<p style="margin:0 0 18px 0;font-size:13px;line-height:1.6;color:#cbd5e1;">${escapeHtml(options.detail)}</p>`,
    '<p style="margin:0;font-size:12px;color:#94a3b8;">你现在可以关闭此浏览器标签页并返回 Prismux 设置页。</p>',
    "</div>",
    "</body>",
    "</html>"
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
  private readonly overnightFactory: OvernightFactory;
  private readonly credentialStore: EncryptedPluginCredentialStore | undefined;
  private readonly onConfigChanged: (() => void) | undefined;
  private readonly hooks: OvernightNetworkHooks;
  private readonly now: () => number;

  private config: OvernightFactoryPersistedConfig;
  private runs: OvernightRunRecord[] = [];
  private lastPollAt: number | null = null;
  private lastPollError: string | null = null;
  private lastTestResult: OvernightMailTestResult | null = null;
  private pendingOAuth = new Map<string, PendingGmailOAuthSession>();
  private pollTimer: NodeJS.Timeout | undefined;
  private pollingInFlight = false;

  // Agent Mail CLI live probe cache & interactive login background handle
  private agentMailProbeCache: {
    checkedAt: number;
    cliInstalled: boolean;
    cliPath?: string;
    authorizedEmail: string | null;
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
    this.overnightFactory =
      options.overnightFactory ??
      new OvernightFactory({
        ...(options.memoryStore !== undefined
          ? { memoryStore: options.memoryStore }
          : {}),
        ...(options.policyGuard !== undefined
          ? { policyGuard: options.policyGuard }
          : {}),
        ...(options.dispatchHub !== undefined
          ? { dispatchHub: options.dispatchHub }
          : {})
      });
    this.credentialStore = options.credentialStore;
    this.onConfigChanged = options.onConfigChanged;
    this.hooks = options.networkHooks ?? {};
    this.now = this.hooks.now ?? (() => Date.now());

    this.config = this.loadPersistedConfig();
    this.runs = this.loadPersistedRuns();
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

  private resolveAgentMailCliPath(): string | null {
    try {
      return (this.hooks.findAgentMailCli ?? defaultFindAgentMailCli)();
    } catch {
      return null;
    }
  }

  private runAgentMailCli(
    cliPath: string,
    args: readonly string[],
    timeoutMs: number
  ): Promise<AgentMailCommandOutput> {
    return (this.hooks.runAgentMailCli ?? defaultRunAgentMailCli)(cliPath, args, timeoutMs);
  }

  private buildAgentMailSnapshot(base: {
    cliInstalled: boolean;
    cliPath?: string;
    authorizedEmail: string | null;
    lastError: string | null;
  }): OvernightAgentMailRuntimeSnapshot {
    const resolvedEmail = base.authorizedEmail ?? (this.config.agentMailAddress || null);
    return {
      cliInstalled: base.cliInstalled,
      ...(base.cliPath ? { cliPath: base.cliPath } : {}),
      authorizedEmail: resolvedEmail,
      authInProgress: this.agentMailAuthInProgress,
      pendingAuthUrl: this.agentMailPendingAuthUrl,
      lastError: this.agentMailLastError ?? base.lastError
    };
  }

  private async probeAgentMailStatus(options: {
    force?: boolean;
    timeoutMs?: number;
    persistOnSuccess?: boolean;
  } = {}): Promise<OvernightAgentMailRuntimeSnapshot> {
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
      const cliPath = this.resolveAgentMailCliPath();
      if (!cliPath) {
        const entry = {
          checkedAt: this.now(),
          cliInstalled: false,
          authorizedEmail: this.config.agentMailAddress || null,
          lastError: null
        };
        this.agentMailProbeCache = entry;
        return this.buildAgentMailSnapshot(entry);
      }

      try {
        const res = await this.runAgentMailCli(cliPath, ["+me"], timeoutMs);
        const combined = `${res.stdout}\n${res.stderr}`;
        const parsedEmail = res.exitCode === 0 ? extractAgentMailAddress(combined) : null;
        const lastError =
          res.exitCode === 0
            ? null
            : res.timedOut
              ? "检测 agently-cli +me 超时，请稍后重试。"
              : sanitizeAgentMailOutput(res.stderr || res.stdout || res.errorMessage || "", 320) ||
                null;

        if (parsedEmail) {
          this.agentMailLastError = null;
          if (
            options.persistOnSuccess !== false &&
            parsedEmail !== this.config.agentMailAddress
          ) {
            this.config.agentMailAddress = parsedEmail;
            this.persistConfig();
            this.onConfigChanged?.();
          }
        }

        const entry = {
          checkedAt: this.now(),
          cliInstalled: true,
          cliPath,
          authorizedEmail: parsedEmail,
          lastError
        };
        this.agentMailProbeCache = entry;
        return this.buildAgentMailSnapshot(entry);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const entry = {
          checkedAt: this.now(),
          cliInstalled: true,
          cliPath,
          authorizedEmail: this.config.agentMailAddress || null,
          lastError: sanitizeAgentMailOutput(msg, 320)
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
      updatedAt: this.now()
    };
    writeJsonAtomic(this.configPath, this.config);
  }

  private loadPersistedRuns(): OvernightRunRecord[] {
    if (!NodeFS.existsSync(this.runsPath)) {
      return [];
    }
    try {
      const parsed = JSON.parse(NodeFS.readFileSync(this.runsPath, "utf8")) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is OvernightRunRecord => isPlainRecord(item) && typeof item["id"] === "string")
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
    const [
      gmailClientSecret,
      gmailRefreshToken,
      gmailAccessToken,
      imapPassword,
      smtpPassword
    ] = await Promise.all([
      handle.get("gmail.clientSecret"),
      handle.get("gmail.refreshToken"),
      handle.get("gmail.accessToken"),
      handle.get("imap.password"),
      handle.get("smtp.password")
    ]);
    return {
      ...(gmailClientSecret ? { gmailClientSecret } : {}),
      ...(gmailRefreshToken ? { gmailRefreshToken } : {}),
      ...(gmailAccessToken ? { gmailAccessToken } : {}),
      ...(imapPassword ? { imapPassword } : {}),
      ...(smtpPassword ? { smtpPassword } : {})
    };
  }

  private async readSecretPresence(): Promise<OvernightSecretPresence> {
    const secrets = await this.readSecrets();
    return {
      hasGmailClientSecret: Boolean(secrets.gmailClientSecret),
      hasGmailRefreshToken: Boolean(secrets.gmailRefreshToken),
      hasImapPassword: Boolean(secrets.imapPassword),
      hasSmtpPassword: Boolean(secrets.smtpPassword || secrets.imapPassword)
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
    const intervalMs = Math.max(
      60_000,
      this.config.strategy.pollIntervalMinutes * 60_000
    );
    this.pollTimer = setInterval(() => {
      if (!this.config.enabled) return;
      if (!isWithinExecutionWindow(this.config.strategy, this.now())) {
        return;
      }
      void this.pollNow({}, "owner_chief").catch(() => {
        // Error already recorded in lastPollError.
      });
    }, intervalMs);
    this.pollTimer.unref?.();
  }

  async getConfigSnapshot(
    trustedCallerScope: CallerScope
  ): Promise<OvernightConfigSnapshot> {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/config");
    this.purgeExpiredOAuthStates();
    const [secrets, agentMail] = await Promise.all([
      this.readSecretPresence(),
      this.probeAgentMailStatus({
        force: false,
        timeoutMs: AGENT_MAIL_SNAPSHOT_PROBE_TIMEOUT_MS,
        persistOnSuccess: true
      })
    ]);
    return {
      ok: true,
      config: structuredClone(this.config),
      secrets,
      credentialsFile: this.getCredentialFilePathDisplay(),
      agentMail,
      runtime: {
        pollerActive: this.pollTimer !== undefined && this.config.enabled,
        inAllowedWindow: isWithinExecutionWindow(this.config.strategy, this.now()),
        oauthPending: this.pendingOAuth.size > 0,
        lastPollAt: this.lastPollAt,
        lastPollError: this.lastPollError,
        lastTestResult: this.lastTestResult,
        runsCount: this.runs.length
      }
    };
  }

  async updateConfig(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): Promise<OvernightConfigSnapshot> {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/config");
    if (!isPlainRecord(rawBody)) {
      throw new BusinessRouteError(
        400,
        "INVALID_PARAMS",
        "Request body must be a JSON object."
      );
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

    if (isPlainRecord(rawBody["gmail"])) {
      const g = rawBody["gmail"];
      if (typeof g["clientId"] === "string") next.gmail.clientId = g["clientId"].trim();
      if (typeof g["redirectUri"] === "string") next.gmail.redirectUri = g["redirectUri"].trim();
      if (typeof g["boundEmail"] === "string") next.gmail.boundEmail = g["boundEmail"].trim();
    }

    if (isPlainRecord(rawBody["imapSmtp"])) {
      const im = rawBody["imapSmtp"];
      const incomingEmail = typeof im["email"] === "string" ? im["email"].trim() : next.imapSmtp.email;
      if (isOvernightMailPresetId(im["preset"])) {
        const canonicalPreset = normalizeOvernightMailPresetId(im["preset"], next.imapSmtp.preset);
        next.imapSmtp.preset = canonicalPreset;
        if (canonicalPreset === "agent_mail" && !isOvernightEmailProvider(rawBody["emailProvider"])) {
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
      if (typeof im["imapHost"] === "string" && (next.imapSmtp.preset === "custom" || im["imapHost"].trim().length > 0)) {
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
      if (typeof im["smtpHost"] === "string" && (next.imapSmtp.preset === "custom" || im["smtpHost"].trim().length > 0)) {
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
        next.strategy.windowStart = normalizeTimeHHMM(
          st["windowStart"],
          next.strategy.windowStart
        );
      }
      if (st["windowEnd"] !== undefined) {
        next.strategy.windowEnd = normalizeTimeHHMM(
          st["windowEnd"],
          next.strategy.windowEnd
        );
      }
      if (st["pollIntervalMinutes"] !== undefined) {
        next.strategy.pollIntervalMinutes = clampPollMinutes(
          st["pollIntervalMinutes"],
          next.strategy.pollIntervalMinutes
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
            "24h 无人值守夜间工场禁止将执行节点配置为个人版 Antigravity（AGY），请使用 codex / claudeAgent / opencode。"
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
    const writeSecretIfNonEmpty = async (
      key: string,
      value: unknown
    ): Promise<void> => {
      if (typeof value === "string" && value.trim().length > 0) {
        if (!credHandle) {
          throw new BusinessRouteError(
            503,
            "CREDENTIAL_STORE_UNAVAILABLE",
            "Encrypted credential store is not configured."
          );
        }
        await credHandle.set(key, value.trim());
      }
    };

    const gmailRaw = isPlainRecord(rawBody["gmail"]) ? rawBody["gmail"] : {};
    const imapRaw = isPlainRecord(rawBody["imapSmtp"]) ? rawBody["imapSmtp"] : {};

    await writeSecretIfNonEmpty(
      "gmail.clientSecret",
      secretsBody["gmailClientSecret"] ?? gmailRaw["clientSecret"]
    );
    await writeSecretIfNonEmpty(
      "gmail.refreshToken",
      secretsBody["gmailRefreshToken"] ?? gmailRaw["refreshToken"]
    );
    await writeSecretIfNonEmpty(
      "imap.password",
      secretsBody["imapPassword"] ?? imapRaw["password"] ?? imapRaw["imapPassword"]
    );
    await writeSecretIfNonEmpty(
      "smtp.password",
      secretsBody["smtpPassword"] ?? imapRaw["smtpPassword"]
    );

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
    daemonOrigin: string
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
        "请先填写 Google OAuth Client ID 后再启动 Gmail 授权绑定。"
      );
    }
    if (!clientSecret) {
      throw new BusinessRouteError(
        400,
        "GMAIL_CLIENT_SECRET_MISSING",
        "请先填写并保存 Google OAuth Client Secret 后再启动 Gmail 授权绑定。"
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
      expiresAt
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: [
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/userinfo.email"
      ].join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256"
    });

    return {
      ok: true,
      authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      state,
      redirectUri,
      expiresAt
    };
  }

  /**
   * Handles Google's OAuth2 browser redirect callback (`GET /v1/overnight/oauth/gmail/callback`).
   * Authenticated by the one-time cryptographic `state` generated in `startGmailOAuth`.
   */
  async handleGmailOAuthCallback(
    searchParams: URLSearchParams
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
          detail: `Google 返回错误：${errorParam}`
        })
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
          detail: "请返回 Prismux「夜间工场与邮箱」页面重新点击「一键浏览器登录绑定 Gmail」。"
        })
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
          detail: "回调 URL 中未包含有效的 code 参数。"
        })
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
        code_verifier: session.codeVerifier
      });

      const tokenRes = await fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString()
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
            detail: `Google Token 接口返回 HTTP ${tokenRes.status}${errText ? `：${errText.slice(0, 180)}` : ""}`
          })
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
            detail: "Google 未返回有效的 access_token。"
          })
        };
      }

      // Fetch Gmail profile address
      let boundEmail = this.config.gmail.boundEmail;
      try {
        const profileRes = await fetchImpl(
          "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          {
            headers: { Authorization: `Bearer ${accessToken}` }
          }
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
          const infoRes = await fetchImpl(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
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
          detail: "OAuth 凭据已加密保存至 ~/.prismux/credentials/overnight-factory.enc（权限 0600）。"
        })
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
          detail: msg
        })
      };
    }
  }

  async disconnectGmail(
    trustedCallerScope: CallerScope
  ): Promise<OvernightConfigSnapshot> {
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
        const canonicalPreset = normalizeOvernightMailPresetId(im["preset"], merged.imapSmtp.preset);
        merged.imapSmtp.preset = canonicalPreset;
        if (canonicalPreset === "agent_mail" && !isOvernightEmailProvider(rawOverride["emailProvider"])) {
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
      if (typeof im["imapHost"] === "string" && (merged.imapSmtp.preset === "custom" || im["imapHost"].trim().length > 0)) {
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
      if (typeof im["smtpHost"] === "string" && (merged.imapSmtp.preset === "custom" || im["smtpHost"].trim().length > 0)) {
        merged.imapSmtp.smtpHost = im["smtpHost"].trim();
      }
      if (im["smtpPort"] !== undefined) {
        merged.imapSmtp.smtpPort = clampPort(im["smtpPort"], merged.imapSmtp.smtpPort);
      }
      if (typeof im["smtpSecure"] === "boolean") merged.imapSmtp.smtpSecure = im["smtpSecure"];
      if (typeof im["smtpUsername"] === "string") {
        merged.imapSmtp.smtpUsername = im["smtpUsername"].trim();
      }
    }

    const secretsOverride = isPlainRecord(rawOverride["secrets"])
      ? rawOverride["secrets"]
      : {};
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
      ...(typeof secretsOverride["smtpPassword"] === "string" &&
      secretsOverride["smtpPassword"].trim()
        ? { smtpPassword: secretsOverride["smtpPassword"].trim() }
        : {})
    };

    return { config: merged, secrets: effectiveSecrets };
  }

  private async refreshGmailAccessToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string
  ): Promise<string> {
    const fetchImpl = this.hooks.fetchFn ?? fetch;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    });
    const res = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!res.ok) {
      throw new Error(`Gmail OAuth Token 刷新失败 (HTTP ${res.status})`);
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
      throw new Error("Gmail Token 响应缺少 access_token。");
    }
    return json.access_token;
  }

  private async sendViaGmailApi(
    accessToken: string,
    fromAddress: string,
    fromName: string,
    payload: OutboundMailPayload
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
      references: payload.references
    });
    const rawB64Url = Buffer.from(mime, "utf8")
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const res = await fetchImpl(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ raw: rawB64Url })
      }
    );
    if (!res.ok) {
      throw new Error(`Gmail API 发信失败 (HTTP ${res.status})`);
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return {
      messageId: json.id ?? messageId,
      acceptedAt: this.now(),
      provider: "gmail-oauth2"
    };
  }

  private async handleAgentMailStatusAction(startedAt: number): Promise<OvernightMailTestResult> {
    const snapshot = await this.probeAgentMailStatus({
      force: true,
      timeoutMs: AGENT_MAIL_STATUS_TIMEOUT_MS,
      persistOnSuccess: true
    });
    const durationMs = Math.max(1, this.now() - startedAt);
    const installed = snapshot.cliInstalled;
    const authorizedEmail = snapshot.authorizedEmail ?? null;
    const ok = installed && Boolean(authorizedEmail);
    const message = !installed
      ? `未检测到 ${AGENT_MAIL_CLI_COMMAND}，请先点击「一键安装 / 更新 CLI」安装 ${AGENT_MAIL_NPM_PACKAGE}。`
      : authorizedEmail
        ? `Agent 邮箱已授权：${authorizedEmail}`
        : snapshot.lastError ||
          `已安装 ${AGENT_MAIL_CLI_COMMAND}，但尚未完成 OAuth 授权，请点击「发起 OAuth 浏览器授权」。`;

    const res: OvernightMailTestResult = {
      ok,
      mode: "imap",
      emailProvider: "agent_mail",
      agentMailAction: "status",
      installed,
      ...(snapshot.cliPath ? { cliPath: snapshot.cliPath } : {}),
      authorizedEmail,
      authInProgress: Boolean(snapshot.authInProgress),
      authUrl: snapshot.pendingAuthUrl ?? null,
      agentMail: snapshot,
      checkedAt: this.now(),
      durationMs,
      inbound: {
        ok,
        latencyMs: durationMs,
        message,
        ...(snapshot.cliPath ? { detail: snapshot.cliPath } : {})
      },
      outbound: {
        ok,
        latencyMs: durationMs,
        message: ok
          ? `agently-cli 发信通道就绪（${authorizedEmail}）`
          : message
      },
      message
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
      persistOnSuccess: true
    });
    const durationMs = Math.max(1, this.now() - startedAt);
    const ok = cmdOut.exitCode === 0 && snapshot.cliInstalled;
    const message = ok
      ? snapshot.authorizedEmail
        ? `已安装并验证 ${AGENT_MAIL_NPM_PACKAGE}（当前已授权邮箱：${snapshot.authorizedEmail}）。`
        : `已成功安装 / 更新 ${AGENT_MAIL_NPM_PACKAGE}，接下来请点击「发起 OAuth 浏览器授权」。`
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
      ...(snapshot.cliPath ? { cliPath: snapshot.cliPath } : {}),
      authorizedEmail: snapshot.authorizedEmail ?? null,
      authInProgress: Boolean(snapshot.authInProgress),
      authUrl: snapshot.pendingAuthUrl ?? null,
      stdout,
      stderr,
      agentMail: {
        ...snapshot,
        lastError: ok ? null : message
      },
      checkedAt: this.now(),
      durationMs,
      inbound: {
        ok,
        latencyMs: durationMs,
        message
      },
      outbound: {
        ok,
        latencyMs: durationMs,
        message
      },
      message
    };
    return res;
  }

  private async handleAgentMailLoginAction(startedAt: number): Promise<OvernightMailTestResult> {
    const cliPath = this.resolveAgentMailCliPath();
    if (!cliPath) {
      const durationMs = Math.max(1, this.now() - startedAt);
      const message = `尚未安装 ${AGENT_MAIL_CLI_COMMAND}，请先执行步骤 1 安装 ${AGENT_MAIL_NPM_PACKAGE}。`;
      return {
        ok: false,
        mode: "imap",
        emailProvider: "agent_mail",
        agentMailAction: "login",
        installed: false,
        authorizedEmail: this.config.agentMailAddress || null,
        authUrl: null,
        authInProgress: false,
        agentMail: {
          cliInstalled: false,
          authorizedEmail: this.config.agentMailAddress || null,
          authInProgress: false,
          pendingAuthUrl: null,
          lastError: message
        },
        checkedAt: this.now(),
        durationMs,
        inbound: { ok: false, latencyMs: durationMs, message },
        outbound: { ok: false, latencyMs: durationMs, message },
        message
      };
    }

    if (this.agentMailAuthInProgress && this.agentMailPendingAuthUrl) {
      const durationMs = Math.max(1, this.now() - startedAt);
      const message = "请点击或复制以下链接在浏览器中完成授权：";
      return {
        ok: true,
        mode: "imap",
        emailProvider: "agent_mail",
        agentMailAction: "login",
        installed: true,
        cliPath,
        authorizedEmail: this.config.agentMailAddress || null,
        authUrl: this.agentMailPendingAuthUrl,
        authInProgress: true,
        agentMail: {
          cliInstalled: true,
          cliPath,
          authorizedEmail: this.config.agentMailAddress || null,
          authInProgress: true,
          pendingAuthUrl: this.agentMailPendingAuthUrl,
          lastError: null
        },
        checkedAt: this.now(),
        durationMs,
        inbound: { ok: true, latencyMs: durationMs, message },
        outbound: { ok: true, latencyMs: durationMs, message },
        message
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
          message: this.agentMailLastError
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
              message: "请点击或复制以下链接在浏览器中完成授权："
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
          message: msg
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
            persistOnSuccess: true
          }).then((probed) => {
            finish({
              ok: true,
              authUrl: null,
              authInProgress: false,
              authorizedEmail: probed.authorizedEmail ?? null,
              message: probed.authorizedEmail
                ? `邮箱地址 ${probed.authorizedEmail} 已授权成功，可以用它来收发邮件了。`
                : "Agent 邮箱 OAuth 授权已完成，请点击「检测授权身份」同步邮箱地址。"
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
            message: msg
          });
        }
      });
    });

    const durationMs = Math.max(1, this.now() - startedAt);
    const snapshot: OvernightAgentMailRuntimeSnapshot = {
      cliInstalled: true,
      cliPath,
      authorizedEmail: captured.authorizedEmail,
      authInProgress: captured.authInProgress,
      pendingAuthUrl: captured.authUrl,
      lastError: captured.ok ? null : captured.message
    };
    return {
      ok: captured.ok,
      mode: "imap",
      emailProvider: "agent_mail",
      agentMailAction: "login",
      installed: true,
      cliPath,
      authorizedEmail: captured.authorizedEmail,
      authUrl: captured.authUrl,
      authInProgress: captured.authInProgress,
      agentMail: snapshot,
      checkedAt: this.now(),
      durationMs,
      inbound: {
        ok: captured.ok,
        latencyMs: durationMs,
        message: captured.message
      },
      outbound: {
        ok: captured.ok,
        latencyMs: durationMs,
        message: captured.message
      },
      message: captured.message
    };
  }

  private async handleAgentMailVerifyConnection(
    startedAt: number
  ): Promise<OvernightMailTestResult> {
    const snapshot = await this.probeAgentMailStatus({
      force: true,
      timeoutMs: AGENT_MAIL_STATUS_TIMEOUT_MS,
      persistOnSuccess: true
    });
    const durationMs = Math.max(1, this.now() - startedAt);
    const email = snapshot.authorizedEmail ?? null;
    const isValidAgentMailbox = Boolean(email && /@agent\.qq\.com$/i.test(email));
    const ok = snapshot.cliInstalled && isValidAgentMailbox;
    const message = !snapshot.cliInstalled
      ? `未检测到 ${AGENT_MAIL_CLI_COMMAND}，请先安装 ${AGENT_MAIL_NPM_PACKAGE}。`
      : isValidAgentMailbox
        ? `Agent 邮箱连通性校验通过（${email}）。`
        : email
          ? `检测到已登录邮箱 ${email}，但并非 @agent.qq.com 地址，请重新授权腾讯 Agent 邮箱。`
          : snapshot.lastError ||
            "尚未完成 Agent 邮箱 OAuth 授权，请点击「发起 OAuth 浏览器授权」后重试。";

    const res: OvernightMailTestResult = {
      ok,
      mode: "imap",
      emailProvider: "agent_mail",
      installed: snapshot.cliInstalled,
      ...(snapshot.cliPath ? { cliPath: snapshot.cliPath } : {}),
      authorizedEmail: email,
      authInProgress: Boolean(snapshot.authInProgress),
      authUrl: snapshot.pendingAuthUrl ?? null,
      agentMail: snapshot,
      checkedAt: this.now(),
      durationMs,
      inbound: {
        ok,
        latencyMs: durationMs,
        message: ok ? `Agent 邮箱收信就绪（${email}）` : message,
        ...(snapshot.cliPath ? { detail: snapshot.cliPath } : {})
      },
      outbound: {
        ok,
        latencyMs: durationMs,
        message: ok ? `Agent 邮箱发信就绪（agently-cli · ${email}）` : message
      },
      message
    };
    this.lastTestResult = res;
    return res;
  }

  async testMailConnection(
    rawBody: unknown,
    trustedCallerScope: CallerScope
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
            message: "缺少 Google OAuth Client ID 或已密封的 Client Secret。"
          },
          outbound: {
            ok: false,
            latencyMs: 0,
            message: "请先完成 Gmail OAuth2 配置与浏览器授权绑定。"
          },
          message: "Gmail OAuth2 尚未完成凭据配置。"
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
            message: "尚未绑定 Gmail 账号（缺少已密封的 Refresh Token）。"
          },
          outbound: {
            ok: false,
            latencyMs: 0,
            message: "请先点击「一键浏览器登录绑定 Gmail」完成授权。"
          },
          message: "请先完成 Gmail 浏览器 OAuth 登录绑定。"
        };
        this.lastTestResult = res;
        return res;
      }

      try {
        const accessToken = await this.refreshGmailAccessToken(
          config.gmail.clientId,
          secrets.gmailClientSecret,
          secrets.gmailRefreshToken
        );
        const fetchImpl = this.hooks.fetchFn ?? fetch;
        const profileRes = await fetchImpl(
          "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          {
            headers: { Authorization: `Bearer ${accessToken}` }
          }
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
        const res: OvernightMailTestResult = {
          ok: true,
          mode: "gmail-oauth2",
          checkedAt: this.now(),
          durationMs: Math.max(1, this.now() - startedAt),
          inbound: {
            ok: true,
            latencyMs,
            message: `Gmail API 收信通道正常（${emailLabel}）`,
            ...(profile.messagesTotal !== undefined
              ? { detail: `历史邮件 ${profile.messagesTotal} 封` }
              : {})
          },
          outbound: {
            ok: true,
            latencyMs,
            message: "Gmail OAuth2 发信权限就绪（gmail.send）"
          },
          message: `Gmail OAuth2 收发连通性校验通过（${latencyMs} ms）。`
        };
        this.lastTestResult = res;
        return res;
      } catch (err) {
        const latencyMs = Math.max(1, this.now() - probeStart);
        const msg = err instanceof Error ? err.message : String(err);
        const res: OvernightMailTestResult = {
          ok: false,
          mode: "gmail-oauth2",
          checkedAt: this.now(),
          durationMs: Math.max(1, this.now() - startedAt),
          inbound: { ok: false, latencyMs, message: msg },
          outbound: { ok: false, latencyMs, message: msg },
          message: `Gmail OAuth2 连通性测试失败：${msg}`
        };
        this.lastTestResult = res;
        return res;
      }
    }

    // IMAP / SMTP dual probe
    const imapUser = config.imapSmtp.imapUsername || config.imapSmtp.email;
    const smtpUser = config.imapSmtp.smtpUsername || config.imapSmtp.email;
    const imapPass = secrets.imapPassword ?? "";
    const smtpPass = secrets.smtpPassword || imapPass;

    const probeImap = this.hooks.probeImap ?? defaultProbeImapConnection;
    const probeSmtp = this.hooks.probeSmtp ?? defaultProbeSmtpConnection;

    const [inbound, outbound] = await Promise.all([
      probeImap({
        host: config.imapSmtp.imapHost,
        port: config.imapSmtp.imapPort,
        secure: config.imapSmtp.imapSecure,
        username: imapUser,
        password: imapPass,
        mailbox: config.imapSmtp.mailbox
      }),
      probeSmtp({
        host: config.imapSmtp.smtpHost,
        port: config.imapSmtp.smtpPort,
        secure: config.imapSmtp.smtpSecure,
        username: smtpUser,
        password: smtpPass,
        fromAddress: config.imapSmtp.email || smtpUser,
        fromName: config.imapSmtp.fromName
      })
    ]);

    const ok = inbound.ok && outbound.ok;
    const durationMs = Math.max(1, this.now() - startedAt);
    const res: OvernightMailTestResult = {
      ok,
      mode: "imap",
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
            : `SMTP 发信验证失败：${outbound.message}`
    };
    this.lastTestResult = res;
    return res;
  }

  private createMailerForConfig(
    config: OvernightFactoryPersistedConfig,
    secrets: ResolvedOvernightSecrets
  ): OutboundMailer {
    if (this.hooks.createOutboundMailer) {
      const injected = this.hooks.createOutboundMailer(config, secrets);
      if (injected) return injected;
    }

    if (config.emailProvider === "agent_mail") {
      const cliPath = this.resolveAgentMailCliPath();
      if (!cliPath) {
        throw new BusinessRouteError(
          400,
          "AGENT_MAIL_CLI_NOT_INSTALLED",
          `未检测到 ${AGENT_MAIL_CLI_COMMAND}，请先在邮箱设置中一键安装 ${AGENT_MAIL_NPM_PACKAGE}。`
        );
      }
      const authorizedEmail =
        config.agentMailAddress || this.agentMailProbeCache?.authorizedEmail || "";
      if (!authorizedEmail) {
        throw new BusinessRouteError(
          400,
          "AGENT_MAIL_NOT_AUTHORIZED",
          "Agent 邮箱尚未完成 OAuth 授权，请先点击「发起 OAuth 浏览器授权」并完成身份检测。"
        );
      }
      return {
        send: async (payload: OutboundMailPayload) => {
          const recipient = payload.to[0];
          if (!recipient) {
            throw new BusinessRouteError(400, "RECIPIENT_MISSING", "发信收件人邮箱不能为空。");
          }
          const primaryArgs = [
            "message",
            "+send",
            "--to",
            recipient,
            "--subject",
            payload.subject,
            "--html",
            payload.html,
            "--confirmed",
            "--json"
          ];
          let res = await this.runAgentMailCli(cliPath, primaryArgs, AGENT_MAIL_CLI_OP_TIMEOUT_MS);
          if (res.exitCode !== 0 && /unknown option|unrecognized/i.test(`${res.stderr} ${res.stdout}`)) {
            res = await this.runAgentMailCli(
              cliPath,
              [
                "message",
                "+send",
                "--to",
                recipient,
                "--subject",
                payload.subject,
                "--text",
                payload.text ?? payload.subject
              ],
              AGENT_MAIL_CLI_OP_TIMEOUT_MS
            );
          }
          if (res.exitCode !== 0) {
            const detail = sanitizeAgentMailOutput(res.stderr || res.stdout || res.errorMessage || "", 320);
            throw new BusinessRouteError(
              502,
              "AGENT_MAIL_SEND_FAILED",
              `通过 ${AGENT_MAIL_CLI_COMMAND} 发信失败（退出码 ${res.exitCode}）：${detail || "请检查授权状态"}`
            );
          }
          let parsedId = `agent-mail-${this.now()}-${NodeCrypto.randomUUID().slice(0, 8)}`;
          try {
            const parsed = JSON.parse(stripAnsiEscapes(res.stdout).trim()) as unknown;
            if (isPlainRecord(parsed)) {
              const maybeId = parsed["messageId"] ?? parsed["id"];
              if (typeof maybeId === "string" && maybeId.trim().length > 0) {
                parsedId = maybeId.trim();
              }
            }
          } catch {
            // keep generated messageId when CLI returns plain text confirmation
          }
          return {
            messageId: parsedId,
            acceptedAt: this.now(),
            provider: `agent_mail:${AGENT_MAIL_CLI_COMMAND}`
          };
        }
      };
    }

    if (config.mode === "gmail-oauth2") {
      if (!config.gmail.clientId || !secrets.gmailClientSecret || !secrets.gmailRefreshToken) {
        throw new BusinessRouteError(
          400,
          "GMAIL_NOT_CONFIGURED",
          "Gmail OAuth2 尚未完成绑定，无法发送早报邮件。"
        );
      }
      return {
        send: async (payload: OutboundMailPayload) => {
          const accessToken = await this.refreshGmailAccessToken(
            config.gmail.clientId,
            secrets.gmailClientSecret!,
            secrets.gmailRefreshToken!
          );
          return this.sendViaGmailApi(
            accessToken,
            config.gmail.boundEmail || "me",
            `${BRAND.appName} Overnight Factory`,
            payload
          );
        }
      };
    }

    const smtpUser = config.imapSmtp.smtpUsername || config.imapSmtp.email;
    const smtpPass = secrets.smtpPassword || secrets.imapPassword || "";
    if (!config.imapSmtp.smtpHost || !smtpUser || !smtpPass) {
      throw new BusinessRouteError(
        400,
        "SMTP_NOT_CONFIGURED",
        "SMTP 主机、邮箱账号或授权码尚未完整配置，无法发送早报邮件。"
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
            fromName: config.imapSmtp.fromName
          },
          payload
        )
    };
  }

  async sendTestMorningReport(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): Promise<OvernightTestReportResult> {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/send-test-report");
    const body = isPlainRecord(rawBody) ? rawBody : {};
    const { config, secrets } = await this.resolveEffectiveMailInput(body);

    if (config.emailProvider === "agent_mail" && !config.agentMailAddress) {
      await this.probeAgentMailStatus({
        force: false,
        timeoutMs: AGENT_MAIL_SNAPSHOT_PROBE_TIMEOUT_MS,
        persistOnSuccess: true
      });
    }

    const explicitRecipient =
      typeof body["recipient"] === "string" && body["recipient"].trim().length > 0
        ? body["recipient"].trim()
        : "";
    const defaultRecipient =
      config.emailProvider === "agent_mail"
        ? config.agentMailAddress ||
          this.agentMailProbeCache?.authorizedEmail ||
          config.strategy.allowedSenders[0] ||
          ""
        : config.mode === "gmail-oauth2"
          ? config.gmail.boundEmail || config.strategy.allowedSenders[0] || ""
          : config.imapSmtp.email || config.strategy.allowedSenders[0] || "";
    const recipient = explicitRecipient || defaultRecipient;
    if (!recipient || !recipient.includes("@")) {
      throw new BusinessRouteError(
        400,
        "RECIPIENT_MISSING",
        "请先配置绑定邮箱或填写测试收件人邮箱地址。"
      );
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
        { path: "src/overnight/demo.test.ts", status: "added", additions: 28, deletions: 0 }
      ],
      diff: [
        "diff --git a/src/overnight/demo.ts b/src/overnight/demo.ts",
        "@@ -1,3 +1,5 @@",
        " export function overnightReady() {",
        "-  return false;",
        "+  return true;",
        " }"
      ].join("\n"),
      testCommand: "pnpm test",
      testOutput: "✔ Overnight Factory mail pipeline verified (2/2 passed)",
      testPassed: true,
      reviewComments: [
        "[Review OK] 测试早报演练通过：隔离 Worktree 本地分支模式生效，未自动推送远端。"
      ],
      deepLink: buildReviewDeepLink(sampleThreadId),
      tokenStats: {
        inputTokens: 1280,
        outputTokens: 420,
        totalTokens: 1700,
        estimatedCostUsd: 0.0042,
        model: config.strategy.agentModel || config.strategy.agentProvider
      }
    };

    const html = this.overnightFactory.renderMorningReportHtml(sampleReport);
    const subject = `[${BRAND.appName} 夜间工场] 测试完工早报 · 通道验证成功`;
    const mailer = this.createMailerForConfig(config, secrets);
    const receipt = await mailer.send({
      to: [recipient],
      subject,
      html,
      text: `${sampleReport.summary}\n审阅链接：${sampleReport.deepLink}`
    });

    return {
      ok: true,
      messageId: receipt.messageId,
      recipient,
      provider: receipt.provider,
      sentAt: receipt.acceptedAt,
      subject,
      htmlPreviewLength: html.length,
      message: `测试早报已成功发送至 ${recipient}（通道 ${receipt.provider}）。`
    };
  }

  private createInboundAdapterForConfig(
    config: OvernightFactoryPersistedConfig,
    secrets: ResolvedOvernightSecrets
  ): MailInboundAdapter {
    if (this.hooks.createInboundAdapter) {
      const injected = this.hooks.createInboundAdapter(config, secrets);
      if (injected) return injected;
    }

    if (config.emailProvider === "agent_mail") {
      const cliPath = this.resolveAgentMailCliPath();
      if (!cliPath) {
        throw new BusinessRouteError(
          400,
          "AGENT_MAIL_CLI_NOT_INSTALLED",
          `未检测到 ${AGENT_MAIL_CLI_COMMAND}，请先在邮箱设置中一键安装 ${AGENT_MAIL_NPM_PACKAGE}。`
        );
      }
      const authorizedEmail =
        config.agentMailAddress || this.agentMailProbeCache?.authorizedEmail || "";
      if (!authorizedEmail) {
        throw new BusinessRouteError(
          400,
          "AGENT_MAIL_NOT_AUTHORIZED",
          "Agent 邮箱尚未完成 OAuth 授权，请先完成授权后再拉取邮件。"
        );
      }
      return {
        mode: "imap",
        pollIncremental: async () => {
          const res = await this.runAgentMailCli(
            cliPath,
            ["message", "+list", "--limit", "20", "--json"],
            AGENT_MAIL_CLI_OP_TIMEOUT_MS
          );
          if (res.exitCode !== 0) {
            const detail = sanitizeAgentMailOutput(res.stderr || res.stdout || res.errorMessage || "", 320);
            throw new BusinessRouteError(
              502,
              "AGENT_MAIL_POLL_FAILED",
              `通过 ${AGENT_MAIL_CLI_COMMAND} 拉取邮件失败（退出码 ${res.exitCode}）：${detail || "请检查授权状态"}`
            );
          }
          return {
            messages: parseAgentMailListMessages(res.stdout)
          };
        }
      };
    }

    if (config.mode === "gmail-oauth2") {
      if (!config.gmail.clientId || !secrets.gmailClientSecret || !secrets.gmailRefreshToken) {
        throw new BusinessRouteError(
          400,
          "GMAIL_NOT_CONFIGURED",
          "Gmail OAuth2 尚未绑定，请先完成浏览器 OAuth 登录。"
        );
      }
      return new GmailOAuth2InboundAdapter({
        userEmail: config.gmail.boundEmail || "me",
        clientId: config.gmail.clientId,
        clientSecret: secrets.gmailClientSecret,
        refreshToken: secrets.gmailRefreshToken,
        ...(secrets.gmailAccessToken ? { accessToken: secrets.gmailAccessToken } : {}),
        ...(config.gmail.lastHistoryId ? { initialHistoryId: config.gmail.lastHistoryId } : {}),
        ...(this.hooks.fetchFn ? { fetchFn: this.hooks.fetchFn } : {})
      });
    }

    const imapUser = config.imapSmtp.imapUsername || config.imapSmtp.email;
    const imapPass = secrets.imapPassword ?? "";
    if (!config.imapSmtp.imapHost || !imapUser || !imapPass) {
      throw new BusinessRouteError(
        400,
        "IMAP_NOT_CONFIGURED",
        "IMAP 主机、邮箱账号或授权码尚未完整配置，无法拉取邮件。"
      );
    }
    return new ImapIdleInboundAdapter({
      host: config.imapSmtp.imapHost,
      port: config.imapSmtp.imapPort,
      secure: config.imapSmtp.imapSecure,
      username: imapUser,
      password: imapPass,
      mailbox: config.imapSmtp.mailbox
    });
  }

  async pollNow(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): Promise<OvernightPollNowResult> {
    assertOwnerChief(trustedCallerScope, "/v1/overnight/poll-now");
    if (this.pollingInFlight) {
      throw new BusinessRouteError(
        409,
        "POLL_IN_PROGRESS",
        "夜间工场正在拉取邮件中，请稍候片刻。"
      );
    }

    this.pollingInFlight = true;
    const polledAt = this.now();
    try {
      const body = isPlainRecord(rawBody) ? rawBody : {};
      const { config, secrets } = await this.resolveEffectiveMailInput(body);
      const adapter = this.createInboundAdapterForConfig(config, secrets);
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
            errorMessage: "发件人未命中白名单（已安全拦截）。"
          };
          this.appendRun(blockedRecord);
          newRuns.push(blockedRecord);
          continue;
        }

        const runRecord = await this.executeInboundEmailJob(email, config, secrets);
        executedCount += 1;
        this.appendRun(runRecord);
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
            : `已扫描 ${pollResult.messages.length} 封邮件：匹配 ${matchedCount} 封，执行 ${executedCount} 项，白名单拦截 ${blockedByWhitelistCount} 项。`
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

  private async executeInboundEmailJob(
    email: InboundEmailMessage,
    config: OvernightFactoryPersistedConfig,
    secrets: ResolvedOvernightSecrets
  ): Promise<OvernightRunRecord> {
    const startedAt = this.now();
    const sender = extractEmailAddress(email.from) || email.from;
    const workspaceDir = config.strategy.targetWorkspaceDir.trim();

    if (!workspaceDir || !NodeFS.existsSync(workspaceDir)) {
      this.overnightFactory.markMessageProcessed(email.messageId);
      return {
        id: `run-${startedAt}-${NodeCrypto.randomUUID().slice(0, 6)}`,
        jobId: `fac-cfg-${NodeCrypto.randomUUID().slice(0, 6)}`,
        messageId: email.messageId,
        threadId: "",
        subject: email.subject || "(无主题)",
        sender,
        status: "failed",
        branchName: null,
        changedFilesCount: 0,
        testPassed: null,
        oracleSummary: "目标工作区目录未配置或路径不存在，已中止本次任务。",
        reviewComments: [],
        deepLink: null,
        reportSent: false,
        createdAt: startedAt,
        completedAt: this.now(),
        errorMessage: "请先在「执行策略」中设置有效的本地 Git 目标工作区目录。"
      };
    }

    let outboundMailer: OutboundMailer | undefined;
    try {
      outboundMailer = this.createMailerForConfig(config, secrets);
    } catch {
      outboundMailer = undefined;
    }

    try {
      const callerKind: DispatchCallerKind = "overnight_factory";
      const result = await this.overnightFactory.runEmailPipeline(email, {
        repoTarget: {
          repoPath: workspaceDir,
          repoSlug: NodePath.basename(workspaceDir),
          testCommand: "node -e \"process.exit(0)\""
        },
        callerKind,
        agentProvider: config.strategy.agentProvider,
        ...(config.strategy.agentModel
          ? { agentModel: config.strategy.agentModel }
          : {}),
        ...(config.strategy.secretaryBrain
          ? { secretaryBrain: config.strategy.secretaryBrain }
          : {}),
        enableOracleReview: config.strategy.oracleReviewEnabled,
        outboundMailer,
        ignoreTriggerCheck: true
      });

      const completedAt = this.now();
      return {
        id: `run-${startedAt}-${NodeCrypto.randomUUID().slice(0, 6)}`,
        jobId: result.jobId,
        messageId: email.messageId,
        threadId: result.threadId,
        subject: email.subject || "(无主题)",
        sender,
        status:
          result.status === "completed"
            ? "completed"
            : result.status === "awaiting_human_confirmation"
              ? "awaiting_human_confirmation"
              : "skipped",
        branchName: result.branchName ?? null,
        changedFilesCount: result.changedFiles.length,
        testPassed: result.testPassed ?? null,
        oracleSummary:
          result.artifact?.plainLanguageSummary ??
          result.reviewComments[0] ??
          (config.strategy.localWorktreeOnlyNoPush
            ? "已完成隔离 Worktree 分支提交（仅本地分支，未自动 push）。"
            : "任务已完成。"),
        reviewComments: result.reviewComments,
        deepLink: result.deepLink ?? (result.threadId ? buildReviewDeepLink(result.threadId) : null),
        reportSent: Boolean(result.mailReceipt),
        createdAt: startedAt,
        completedAt,
        errorMessage: null
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isPolicyBlocked = err instanceof AntigravityGuardDeniedError;
      return {
        id: `run-${startedAt}-${NodeCrypto.randomUUID().slice(0, 6)}`,
        jobId: isPolicyBlocked
          ? `fac-policy-${NodeCrypto.randomUUID().slice(0, 6)}`
          : `fac-err-${NodeCrypto.randomUUID().slice(0, 6)}`,
        messageId: email.messageId,
        threadId: "",
        subject: email.subject || "(无主题)",
        sender,
        status: isPolicyBlocked ? "blocked_policy" : "failed",
        branchName: null,
        changedFilesCount: 0,
        testPassed: isPolicyBlocked ? null : false,
        oracleSummary: isPolicyBlocked ? `安全策略拦截：${msg}` : `执行失败：${msg}`,
        reviewComments: [],
        deepLink: null,
        reportSent: false,
        createdAt: startedAt,
        completedAt: this.now(),
        errorMessage: msg
      };
    }
  }

  getRuns(
    rawLimit: number | null,
    trustedCallerScope: CallerScope
  ): {
    ok: true;
    runs: OvernightRunRecord[];
    total: number;
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
      lastPollAt: this.lastPollAt,
      lastPollError: this.lastPollError
    };
  }
}
