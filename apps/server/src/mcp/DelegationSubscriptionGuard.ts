// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type {
  OrchestratorMcpProviderDispatchPolicy,
  ProviderInstanceConfig,
  ServerProvider,
} from "@prismux/core-contracts";
import * as HostProcess from "@prismux/core-shared/HostProcess";
import * as Context from "effect/Context";

export const SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE =
  "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED" as const;
export const SUBSCRIPTION_WAIVER_SETTINGS_ROUTE =
  "/settings/providers#subscription-risk-waiver" as const;

export type SubscriptionBlockedReasonCode =
  | "AGY_UNATTENDED_FORBIDDEN"
  | "AGY_CONTROLLED_AGENT_LOCKED"
  | "EXTERNAL_SUBSCRIPTION_SWARM_LOCKED";

export type DelegationAuthMode =
  | "api_or_custom"
  | "local"
  | "subscription_oauth"
  | "unauthenticated"
  | "unknown";

export type CanonicalProviderFamily =
  | "antigravity"
  | "claudeAgent"
  | "codex"
  | "dsh"
  | "gemini"
  | "opencode"
  | "pi"
  | "local";

export interface SubscriptionWaiverState {
  readonly signed: boolean;
  readonly waiverVersion: string | null;
  readonly signedAt: string | null;
  readonly allowAntigravityAsControlledAgent: boolean;
  readonly allowExternalSubscriptionAgentsInSwarm: boolean;
}

export interface DelegationSubscriptionGuardConfigShape {
  readonly waiverFilePath?: string;
  readonly dataDir?: string;
  readonly waiverOverride?: SubscriptionWaiverState;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  readonly platform?: NodeJS.Platform;
  readonly readTextFile?: (filePath: string) => string | null;
}

export class DelegationSubscriptionGuardConfig extends Context.Reference<DelegationSubscriptionGuardConfigShape>(
  "@prismux/server/mcp/DelegationSubscriptionGuardConfig",
  {
    defaultValue: () => ({}),
  },
) {}

export interface DelegationCallerContext {
  readonly createdBy?: string | null | undefined;
  readonly creationSource?: string | null | undefined;
  readonly threadTags?: ReadonlyArray<string> | undefined;
  readonly userMessageId?: string | null | undefined;
  readonly scheduledTaskId?: string | null | undefined;
  readonly requestNamespace?: string | null | undefined;
  readonly clientLabel?: string | null | undefined;
}

export type DelegationGuardTargetProvider = Pick<
  ServerProvider,
  "instanceId" | "driver" | "displayName" | "auth"
>;

export interface DelegationAuthClassification {
  readonly authMode: DelegationAuthMode;
  readonly canonicalProviderId: string;
  readonly targetIsAntigravity: boolean;
}

export type DelegationGuardDecision =
  | {
      readonly allowed: true;
      readonly dispatchPolicy: "direct";
      readonly authMode: DelegationAuthMode;
      readonly providerId: string;
      readonly targetIsAntigravity: boolean;
    }
  | {
      readonly allowed: false;
      readonly dispatchPolicy: Exclude<OrchestratorMcpProviderDispatchPolicy, "direct">;
      readonly code: typeof SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE;
      readonly reasonCode: SubscriptionBlockedReasonCode;
      readonly settingsRoute: typeof SUBSCRIPTION_WAIVER_SETTINGS_ROUTE;
      readonly providerId: string;
      readonly authMode: "subscription_oauth";
      readonly targetIsAntigravity: boolean;
      readonly constraint: string;
      readonly message: string;
    };

const DEFAULT_LOCKED_WAIVER: SubscriptionWaiverState = {
  signed: false,
  waiverVersion: null,
  signedAt: null,
  allowAntigravityAsControlledAgent: false,
  allowExternalSubscriptionAgentsInSwarm: false,
};

const CANONICAL_ALIAS_MAP: Readonly<Record<string, CanonicalProviderFamily>> = {
  antigravity: "antigravity",
  agy: "antigravity",
  "antigravity-cli": "antigravity",
  antigravity_cli: "antigravity",
  "antigravity-acp": "antigravity",
  antigravity_acp: "antigravity",
  "google-antigravity": "antigravity",
  google_antigravity: "antigravity",
  "google antigravity": "antigravity",
  "personal-antigravity": "antigravity",
  "personal-agy": "antigravity",
  "acp:antigravity": "antigravity",
  "acp:agy": "antigravity",
  claudeagent: "claudeAgent",
  "claude-agent": "claudeAgent",
  claude_agent: "claudeAgent",
  claude: "claudeAgent",
  cc: "claudeAgent",
  "claude-code": "claudeAgent",
  claudecode: "claudeAgent",
  claude_code: "claudeAgent",
  "claude code": "claudeAgent",
  "claude-acp": "claudeAgent",
  "claude-agent-acp": "claudeAgent",
  "acp:claude": "claudeAgent",
  "acp:claude-acp": "claudeAgent",
  codex: "codex",
  "openai-codex": "codex",
  openai_codex: "codex",
  "codex-cli": "codex",
  codex_cli: "codex",
  dsh: "dsh",
  "dsh-next": "dsh",
  dsh_next: "dsh",
  "dsh next": "dsh",
  deepseek: "dsh",
  "deepseek-harness": "dsh",
  deepseek_harness: "dsh",
  "deepseek harness": "dsh",
  "deepseek-harness-acp": "dsh",
  "acp:dsh": "dsh",
  "acp:deepseek": "dsh",
  "acp:deepseek-harness": "dsh",
  "acp:deepseek-harness-acp": "dsh",
  gemini: "gemini",
  "gemini-cli": "gemini",
  gemini_cli: "gemini",
  "gemini-api": "gemini",
  gemini_api: "gemini",
  opencode: "opencode",
  "open-code": "opencode",
  open_code: "opencode",
  "open code": "opencode",
  "opencode-v2": "opencode",
  "acp:opencode": "opencode",
  pi: "pi",
  "pi-coding-agent": "pi",
  "pi-acp": "pi",
  local: "local",
  ollama: "local",
  lmstudio: "local",
  "lm-studio": "local",
  vllm: "local",
  llamacpp: "local",
};

const FAMILY_SEARCH_ALIASES: Readonly<Record<CanonicalProviderFamily, ReadonlyArray<string>>> = {
  antigravity: ["antigravity", "agy", "google-antigravity", "antigravity-acp"],
  claudeAgent: ["claude", "claude-code", "claudecode", "claudeagent", "claude-agent", "cc"],
  codex: ["codex", "openai-codex"],
  dsh: ["dsh", "dsh-next", "deepseek", "deepseek-harness", "acp:deepseek-harness"],
  gemini: ["gemini", "gemini-cli"],
  opencode: ["opencode", "open-code"],
  pi: ["pi", "pi-coding-agent"],
  local: ["local", "ollama", "lmstudio"],
};

const FAMILY_SEARCH_PHRASES: Readonly<
  Record<CanonicalProviderFamily, ReadonlyArray<ReadonlyArray<string>>>
> = {
  antigravity: [["google", "antigravity"]],
  claudeAgent: [["claude", "code"]],
  codex: [["openai", "codex"]],
  dsh: [
    ["deepseek", "harness"],
    ["dsh", "next"],
  ],
  gemini: [["gemini", "cli"]],
  opencode: [["open", "code"]],
  pi: [["pi", "coding", "agent"]],
  local: [["lm", "studio"]],
};

const ANTIGRAVITY_PREFIX_RE = /^(?:antigravity|agy)(?:[-_:\s].*)?$/iu;
const DSH_COMMAND_BASENAME_RE = /^dsh(?:\.exe|\.cmd|\.bat)?$/iu;
const DSH_ENTRY_SCRIPT_RE =
  /(?:^|[\\/])(?:resources[\\/]app\.asar[\\/]lib[\\/]desktop-cli\.js|@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js)$/iu;
const AGY_COMMAND_BASENAME_RE = /^agy(?:\.exe|\.cmd|\.bat)?$/iu;
const CCS_MAGPIE_TOKEN_RE = /(?:^|[\s\\/:._-])(?:ccs|magpie)(?:[\s\\/:._-]|$)/iu;
const UNATTENDED_TAG_RE = /^(?:cron|scheduled(?:[-_]?task)?|overnight[-_]?factory|unattended)$/iu;
const UNATTENDED_NAMESPACE_RE =
  /(?:^|[:/_\-\s])(cron|overnight[-_]?factory|scheduled[-_]?task)(?:$|[:/_\-\s])/iu;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCompactToken(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[\s_-]+/gu, "");
}

export function normalizeProviderLookupKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^acp:/u, "")
    .replace(/[\s_]+/gu, "-")
    .replace(/-+/gu, "-");
}

/**
 * Strips a leading `acp:` prefix if present, returning the normalized slug.
 */
export function stripAcpPrefix(value: string): string {
  const trimmed = value.trim();
  return /^acp:/iu.test(trimmed) ? trimmed.slice(4).trim() : trimmed;
}

/**
 * Maps common provider names/aliases (`dsh`, `deepseek`, `deepseek-harness`,
 * `acp:deepseek-harness`, `claude`, `codex`, `agy`, `antigravity`, etc.)
 * to a canonical provider family. Returns `null` for unrecognized slugs.
 */
export function canonicalizeProviderAlias(
  raw: string | null | undefined,
): CanonicalProviderFamily | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const lower = trimmed.toLowerCase().replace(/\s+/gu, " ");
  if (Object.hasOwn(CANONICAL_ALIAS_MAP, lower)) {
    return CANONICAL_ALIAS_MAP[lower]!;
  }
  const stripped = stripAcpPrefix(lower);
  if (Object.hasOwn(CANONICAL_ALIAS_MAP, stripped)) {
    return CANONICAL_ALIAS_MAP[stripped]!;
  }
  const withoutAcpDash = stripped.replace(/^acp[-_]/u, "");
  if (Object.hasOwn(CANONICAL_ALIAS_MAP, withoutAcpDash)) {
    return CANONICAL_ALIAS_MAP[withoutAcpDash]!;
  }
  const hyphenated = withoutAcpDash.replace(/[\s_]+/gu, "-");
  if (Object.hasOwn(CANONICAL_ALIAS_MAP, hyphenated)) {
    return CANONICAL_ALIAS_MAP[hyphenated]!;
  }
  if (ANTIGRAVITY_PREFIX_RE.test(withoutAcpDash)) {
    return "antigravity";
  }
  if (/^(?:dsh|deepseek[-_]?harness)(?:[-_:\s].*)?$/iu.test(withoutAcpDash)) {
    return "dsh";
  }
  return null;
}

interface AcpRegistryConfigHints {
  readonly source?: string;
  readonly commandPath?: string;
  readonly commandArgs: ReadonlyArray<string>;
  readonly agentId?: string;
  readonly homepageUrl?: string;
  readonly homePath?: string;
}

function extractConfigHints(
  instanceConfig: ProviderInstanceConfig | undefined,
): AcpRegistryConfigHints {
  const raw = isPlainRecord(instanceConfig?.config) ? instanceConfig.config : undefined;
  const commandArgs = Array.isArray(raw?.commandArgs)
    ? raw.commandArgs.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    ...(typeof raw?.source === "string" ? { source: raw.source.trim() } : {}),
    ...(typeof raw?.commandPath === "string" ? { commandPath: raw.commandPath.trim() } : {}),
    commandArgs,
    ...(typeof raw?.agentId === "string" ? { agentId: raw.agentId.trim() } : {}),
    ...(typeof raw?.homepageUrl === "string" ? { homepageUrl: raw.homepageUrl.trim() } : {}),
    ...(typeof raw?.homePath === "string" ? { homePath: raw.homePath.trim() } : {}),
  };
}

/**
 * Identifies the canonical provider family for a registered `ServerProvider`
 * snapshot, inspecting both snapshot identity and optional `acpRegistry` config.
 */
export function detectProviderFamily(
  provider: Pick<ServerProvider, "instanceId" | "driver" | "displayName">,
  instanceConfig?: ProviderInstanceConfig,
): CanonicalProviderFamily | null {
  if (provider.driver !== "acpRegistry") {
    const byDriver = canonicalizeProviderAlias(provider.driver);
    if (byDriver !== null) return byDriver;
  }

  const hints = extractConfigHints(instanceConfig);
  if (hints.agentId) {
    const byAgentId = canonicalizeProviderAlias(hints.agentId);
    if (byAgentId !== null) return byAgentId;
  }
  if (hints.commandPath) {
    const base = hints.commandPath.split(/[\\/]/u).at(-1) ?? "";
    if (
      DSH_COMMAND_BASENAME_RE.test(base) ||
      hints.commandArgs.some((a) => DSH_ENTRY_SCRIPT_RE.test(a))
    ) {
      return "dsh";
    }
    if (AGY_COMMAND_BASENAME_RE.test(base)) {
      return "antigravity";
    }
    const baseWithoutExt = base.replace(/\.(?:exe|cmd|bat)$/iu, "");
    const byCommand = canonicalizeProviderAlias(baseWithoutExt);
    if (byCommand !== null) return byCommand;
  }
  if (hints.homepageUrl && /deepseek[-_]?harness/iu.test(hints.homepageUrl)) {
    return "dsh";
  }

  const byInstanceId = canonicalizeProviderAlias(provider.instanceId);
  if (byInstanceId !== null) return byInstanceId;

  const byDisplayName = canonicalizeProviderAlias(provider.displayName);
  if (byDisplayName !== null) return byDisplayName;

  return null;
}

/**
 * Returns provider search aliases (single tokens + multi-word phrases) used by
 * `orchestrator_capabilities({ search })` so queries like `"dsh"`, `"deepseek"`,
 * `"deepseek-harness"`, `"claude"`, `"agy"`, or `"acp:deepseek-harness"` match.
 */
export function providerSearchMetadata(
  provider: Pick<ServerProvider, "instanceId" | "driver" | "displayName">,
  instanceConfig?: ProviderInstanceConfig,
): {
  readonly aliases: ReadonlyArray<string>;
  readonly phrases: ReadonlyArray<ReadonlyArray<string>>;
} {
  const family = detectProviderFamily(provider, instanceConfig);
  const hints = extractConfigHints(instanceConfig);
  const aliases = new Set<string>();
  if (family !== null) {
    for (const alias of FAMILY_SEARCH_ALIASES[family]) {
      aliases.add(alias);
    }
  }
  if (hints.agentId) {
    const lower = hints.agentId.toLowerCase();
    aliases.add(lower);
    aliases.add(`acp:${lower}`);
  }
  if (hints.commandPath) {
    const base = (hints.commandPath.split(/[\\/]/u).at(-1) ?? "")
      .replace(/\.(?:exe|cmd|bat)$/iu, "")
      .toLowerCase();
    if (base.length > 0) aliases.add(base);
  }
  return {
    aliases: [...aliases],
    phrases: family !== null ? FAMILY_SEARCH_PHRASES[family] : [],
  };
}

/**
 * Returns true if the registered provider represents personal Antigravity (AGY).
 */
export function isAntigravityTargetProvider(
  provider: Pick<ServerProvider, "instanceId" | "driver" | "displayName">,
  instanceConfig?: ProviderInstanceConfig,
): boolean {
  return detectProviderFamily(provider, instanceConfig) === "antigravity";
}

function readCaseInsensitiveEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  platform: NodeJS.Platform,
): string | undefined {
  const direct = env[key];
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }
  if (platform === "win32") {
    const upper = key.toUpperCase();
    for (const [candidateKey, candidateValue] of Object.entries(env)) {
      if (
        candidateKey.toUpperCase() === upper &&
        typeof candidateValue === "string" &&
        candidateValue.trim().length > 0
      ) {
        return candidateValue.trim();
      }
    }
  }
  return undefined;
}

function hasEnvValue(env: NodeJS.ProcessEnv, key: string, platform: NodeJS.Platform): boolean {
  return readCaseInsensitiveEnv(env, key, platform) !== undefined;
}

function isTruthyEnvValue(env: NodeJS.ProcessEnv, key: string, platform: NodeJS.Platform): boolean {
  const val = readCaseInsensitiveEnv(env, key, platform)?.toLowerCase();
  return val === "1" || val === "true" || val === "yes" || val === "on";
}

function hasCcsOrMagpieEnvKeys(env: NodeJS.ProcessEnv): boolean {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || value.trim().length === 0) continue;
    const upper = key.toUpperCase();
    if (
      upper.startsWith("CCS_") ||
      upper.startsWith("MAGPIE_") ||
      upper === "CLAUDE_CODE_SWITCHER"
    ) {
      return true;
    }
  }
  return false;
}

function mentionsCcsOrMagpie(raw: string | null | undefined): boolean {
  if (typeof raw !== "string" || raw.trim().length === 0) return false;
  return CCS_MAGPIE_TOKEN_RE.test(raw);
}

function sanitizeEndpointUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const cleanPath = parsed.pathname.replace(/\/+$/u, "");
    return cleanPath.length > 0 && cleanPath !== "/"
      ? `${parsed.origin}${cleanPath}`
      : parsed.origin;
  } catch {
    return null;
  }
}

function isOfficialAnthropicHost(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host === "api.anthropic.com" || host === "anthropic.com";
  } catch {
    return false;
  }
}

function isOfficialOpenAiHost(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host === "api.openai.com" || host === "chatgpt.com";
  } catch {
    return false;
  }
}

function isOfficialGoogleGeminiHost(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host === "generativelanguage.googleapis.com" || host === "aiplatform.googleapis.com";
  } catch {
    return false;
  }
}

function isLocalRuntimeEndpoint(endpoint: string | null): boolean {
  if (!endpoint) return false;
  try {
    const parsed = new URL(endpoint);
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port;
    if (host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]") {
      return port === "11434" || port === "1234" || port === "8080" || port === "11435";
    }
    return false;
  } catch {
    return false;
  }
}

function defaultReadTextFile(filePath: string): string | null {
  try {
    return NodeFS.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Resolves the ordered list of candidate waiver JSON paths (read-only).
 * Canonical path matches `SubscriptionWaiverStore` (`<dataDir>/config/subscription-waiver.json`),
 * with transparent read-only fallback to legacy `config/antigravity-policy.json` and
 * `data/antigravity-policy.json`.
 */
export function resolveSubscriptionWaiverPaths(
  options: Pick<
    DelegationSubscriptionGuardConfigShape,
    "waiverFilePath" | "dataDir" | "env" | "homeDir" | "platform"
  > = {},
): ReadonlyArray<string> {
  const explicit = options.waiverFilePath?.trim();
  if (explicit && explicit.length > 0) {
    return [explicit];
  }
  const platform = options.platform ?? HostProcess.Platform.defaultValue();
  const env = options.env ?? HostProcess.Environment.defaultValue();
  const pathApi = platform === "win32" ? NodePath.win32 : NodePath.posix;
  const overrideDataDir =
    options.dataDir?.trim() || readCaseInsensitiveEnv(env, "PRISMUX_DATA_DIR", platform);
  const homeDir = options.homeDir?.trim() || HostProcess.HomeDirectory.defaultValue();
  const dataDir =
    overrideDataDir && overrideDataDir.length > 0
      ? overrideDataDir
      : pathApi.join(homeDir, ".prismux");
  return [
    pathApi.join(dataDir, "config", "subscription-waiver.json"),
    pathApi.join(dataDir, "config", "antigravity-policy.json"),
    pathApi.join(dataDir, "data", "antigravity-policy.json"),
  ];
}

/**
 * Parses either unified `subscription-waiver.json` or legacy `antigravity-policy.json`
 * strictly fail-closed: invalid, missing-metadata, or unsigned records always lock all toggles.
 */
export function parseSubscriptionWaiverJson(raw: string): SubscriptionWaiverState {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainRecord(parsed)) return DEFAULT_LOCKED_WAIVER;

    if (!("signed" in parsed) && "allowAntigravityAsControlledAgent" in parsed) {
      const allow = parsed.allowAntigravityAsControlledAgent === true;
      const acceptedAt =
        typeof parsed.disclaimerAcceptedAt === "string" &&
        parsed.disclaimerAcceptedAt.trim().length > 0
          ? parsed.disclaimerAcceptedAt.trim()
          : null;
      const version =
        typeof parsed.disclaimerVersion === "string" && parsed.disclaimerVersion.trim().length > 0
          ? parsed.disclaimerVersion.trim()
          : null;
      if (!allow || acceptedAt === null || version === null) {
        return DEFAULT_LOCKED_WAIVER;
      }
      return {
        signed: true,
        waiverVersion: version,
        signedAt: acceptedAt,
        allowAntigravityAsControlledAgent: true,
        allowExternalSubscriptionAgentsInSwarm: false,
      };
    }

    const signed = parsed.signed === true;
    const signedAt =
      typeof parsed.signedAt === "string" && parsed.signedAt.trim().length > 0
        ? parsed.signedAt.trim()
        : null;
    const waiverVersion =
      typeof parsed.waiverVersion === "string" && parsed.waiverVersion.trim().length > 0
        ? parsed.waiverVersion.trim()
        : null;
    if (!signed || signedAt === null || waiverVersion === null) {
      return DEFAULT_LOCKED_WAIVER;
    }

    return {
      signed: true,
      waiverVersion,
      signedAt,
      allowAntigravityAsControlledAgent: parsed.allowAntigravityAsControlledAgent === true,
      allowExternalSubscriptionAgentsInSwarm:
        parsed.allowExternalSubscriptionAgentsInSwarm === true,
    };
  } catch {
    return DEFAULT_LOCKED_WAIVER;
  }
}

/**
 * Reads the unified waiver state read-only from disk (or override).
 * Stops at the first existing candidate file so a revoked canonical waiver never
 * falls back to a stale legacy policy file.
 */
export function readSubscriptionWaiverState(
  config: DelegationSubscriptionGuardConfigShape = {},
): SubscriptionWaiverState {
  if (config.waiverOverride !== undefined) {
    return config.waiverOverride;
  }
  const readTextFile = config.readTextFile ?? defaultReadTextFile;
  for (const candidatePath of resolveSubscriptionWaiverPaths(config)) {
    const raw = readTextFile(candidatePath);
    if (raw !== null) {
      return parseSubscriptionWaiverJson(raw);
    }
  }
  return DEFAULT_LOCKED_WAIVER;
}

interface CodexConfigTomlSignals {
  readonly modelProvider: string | null;
  readonly openaiBaseUrl: string | null;
  readonly providerBaseUrl: string | null;
  readonly requiresOpenaiAuth: boolean | null;
  readonly hasCustomProvider: boolean;
  readonly hasCcsOrMagpieMarker: boolean;
}

function stripTomlInlineComment(raw: string): string {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inDouble) {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === "#" && !inSingle && !inDouble) {
      return raw.slice(0, i).trim();
    }
  }
  return raw.trim();
}

function parseTomlScalarString(raw: string): string | null {
  const cleaned = stripTomlInlineComment(raw);
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length >= 2) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'") && cleaned.length >= 2)
  ) {
    return cleaned.slice(1, -1).trim();
  }
  return cleaned.length > 0 ? cleaned : null;
}

function parseTomlScalarBoolean(raw: string): boolean | null {
  const cleaned = stripTomlInlineComment(raw).toLowerCase();
  if (cleaned === "true") return true;
  if (cleaned === "false") return false;
  return null;
}

function parseCodexRoutingConfigToml(content: string): CodexConfigTomlSignals {
  let currentSection = "";
  let modelProvider: string | null = null;
  let openaiBaseUrl: string | null = null;
  let rootRequiresOpenaiAuth: boolean | null = null;
  const providerTables = new Map<
    string,
    { baseUrl: string | null; requiresOpenaiAuth: boolean | null }
  >();

  for (const rawLine of content.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const sectionMatch = /^\[([^\]]+)\]$/u.exec(trimmed);
    if (sectionMatch !== null) {
      currentSection = sectionMatch[1]!.trim();
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed
      .slice(0, eqIdx)
      .trim()
      .replace(/^['"]|['"]$/gu, "");
    const rawVal = trimmed.slice(eqIdx + 1).trim();

    if (currentSection === "") {
      if (key === "model_provider") {
        const val = parseTomlScalarString(rawVal);
        if (val) modelProvider = val;
      } else if (key === "openai_base_url") {
        openaiBaseUrl = sanitizeEndpointUrl(parseTomlScalarString(rawVal));
      } else if (key === "requires_openai_auth") {
        rootRequiresOpenaiAuth = parseTomlScalarBoolean(rawVal);
      }
      continue;
    }

    const mpMatch = /^model_providers\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))$/u.exec(
      currentSection,
    );
    if (mpMatch !== null) {
      const providerKey = mpMatch[1] ?? mpMatch[2] ?? mpMatch[3] ?? "";
      if (!providerKey) continue;
      const entry = providerTables.get(providerKey) ?? {
        baseUrl: null,
        requiresOpenaiAuth: null,
      };
      if (key === "base_url") {
        entry.baseUrl = sanitizeEndpointUrl(parseTomlScalarString(rawVal));
      } else if (key === "requires_openai_auth") {
        entry.requiresOpenaiAuth = parseTomlScalarBoolean(rawVal);
      }
      providerTables.set(providerKey, entry);
    }
  }

  const normalizedProvider = modelProvider?.trim() || null;
  const selectedTable = normalizedProvider ? providerTables.get(normalizedProvider) : undefined;
  const hasCustomProvider =
    normalizedProvider !== null && normalizedProvider.toLowerCase() !== "openai";
  const providerBaseUrl = selectedTable?.baseUrl ?? null;
  const requiresOpenaiAuth = selectedTable?.requiresOpenaiAuth ?? rootRequiresOpenaiAuth;
  const hasCcsOrMagpieMarker =
    mentionsCcsOrMagpie(normalizedProvider) ||
    mentionsCcsOrMagpie(providerBaseUrl) ||
    mentionsCcsOrMagpie(openaiBaseUrl);

  return {
    modelProvider: normalizedProvider,
    openaiBaseUrl,
    providerBaseUrl,
    requiresOpenaiAuth,
    hasCustomProvider,
    hasCcsOrMagpieMarker,
  };
}

interface ClaudeSettingsSignals {
  readonly baseUrl: string | null;
  readonly hasApiKey: boolean;
  readonly hasAuthToken: boolean;
  readonly hasApiKeyHelper: boolean;
  readonly usesCloudIam: boolean;
  readonly hasCcsOrMagpieMarker: boolean;
}

/**
 * Reads ONLY non-secret routing/presence flags from Claude Code `settings.json`.
 * Security floor: NEVER reads `.credentials.json`, keyrings, or cookies.
 */
function readClaudeSettingsSignals(options: {
  readonly homeDir: string;
  readonly configHomeOverride?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly workspacePath?: string;
  readonly platform: NodeJS.Platform;
  readonly readTextFile: (filePath: string) => string | null;
}): ClaudeSettingsSignals {
  const pathApi = options.platform === "win32" ? NodePath.win32 : NodePath.posix;
  const claudeConfigDir =
    options.configHomeOverride?.trim() ||
    readCaseInsensitiveEnv(options.env, "CLAUDE_CONFIG_DIR", options.platform) ||
    pathApi.join(options.homeDir, ".claude");
  const candidateFiles = [
    pathApi.join(claudeConfigDir, "settings.json"),
    ...(options.workspacePath
      ? [
          pathApi.join(options.workspacePath, ".claude", "settings.json"),
          pathApi.join(options.workspacePath, ".claude", "settings.local.json"),
        ]
      : []),
  ];

  let baseUrl: string | null = null;
  let hasApiKey = false;
  let hasAuthToken = false;
  let hasApiKeyHelper = false;
  let usesCloudIam = false;
  let hasCcsOrMagpieMarker = false;

  for (const filePath of candidateFiles) {
    const raw = options.readTextFile(filePath);
    if (raw === null) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isPlainRecord(parsed)) continue;
      if (typeof parsed.apiKeyHelper === "string" && parsed.apiKeyHelper.trim().length > 0) {
        hasApiKeyHelper = true;
        if (mentionsCcsOrMagpie(parsed.apiKeyHelper)) hasCcsOrMagpieMarker = true;
      }
      const settingsEnv = isPlainRecord(parsed.env) ? parsed.env : null;
      if (settingsEnv) {
        const rawUrl =
          typeof settingsEnv.ANTHROPIC_BASE_URL === "string"
            ? settingsEnv.ANTHROPIC_BASE_URL
            : typeof settingsEnv.ANTHROPIC_API_URL === "string"
              ? settingsEnv.ANTHROPIC_API_URL
              : undefined;
        const sanitized = sanitizeEndpointUrl(rawUrl);
        if (sanitized !== null) {
          baseUrl = sanitized;
          if (mentionsCcsOrMagpie(sanitized)) hasCcsOrMagpieMarker = true;
        }
        if (
          typeof settingsEnv.ANTHROPIC_API_KEY === "string" &&
          settingsEnv.ANTHROPIC_API_KEY.trim().length > 0
        ) {
          hasApiKey = true;
        }
        if (
          typeof settingsEnv.ANTHROPIC_AUTH_TOKEN === "string" &&
          settingsEnv.ANTHROPIC_AUTH_TOKEN.trim().length > 0
        ) {
          hasAuthToken = true;
        }
        for (const cloudKey of [
          "CLAUDE_CODE_USE_BEDROCK",
          "CLAUDE_CODE_USE_VERTEX",
          "CLAUDE_CODE_USE_FOUNDRY",
        ]) {
          const val = String(settingsEnv[cloudKey] ?? "")
            .trim()
            .toLowerCase();
          if (val === "1" || val === "true" || val === "yes") usesCloudIam = true;
        }
        for (const [k, v] of Object.entries(settingsEnv)) {
          if (
            typeof v === "string" &&
            v.trim().length > 0 &&
            (k.toUpperCase().startsWith("CCS_") || k.toUpperCase().startsWith("MAGPIE_"))
          ) {
            hasCcsOrMagpieMarker = true;
          }
        }
      }
    } catch {
      // Ignore unreadable/malformed settings JSON cleanly.
    }
  }

  return {
    baseUrl,
    hasApiKey,
    hasAuthToken,
    hasApiKeyHelper,
    usesCloudIam,
    hasCcsOrMagpieMarker,
  };
}

function mergeInstanceEnvForClassification(
  hostEnv: NodeJS.ProcessEnv,
  instanceConfig: ProviderInstanceConfig | undefined,
): NodeJS.ProcessEnv {
  const entries = instanceConfig?.environment;
  if (!entries || entries.length === 0) return hostEnv;
  const merged: NodeJS.ProcessEnv = { ...hostEnv };
  for (const item of entries) {
    // Never resolve secrets; only preserve non-secret routing strings or a presence marker.
    merged[item.name] =
      typeof item.value === "string" ? item.value : item.sensitive ? "[secret-ref]" : "";
  }
  return merged;
}

function isClaudeExplicitSubscription(auth: ServerProvider["auth"]): boolean {
  if (typeof auth.subscriptionType === "string" && auth.subscriptionType.trim().length > 0) {
    return true;
  }
  const typeNorm = normalizeCompactToken(auth.type);
  if (typeNorm.length === 0 || typeNorm === "unknown" || typeNorm === "none") return false;
  return (
    typeNorm === "oauth" ||
    typeNorm === "claudeoauth" ||
    typeNorm === "firstpartyoauth" ||
    typeNorm === "subscription" ||
    typeNorm === "subscriptionoauth" ||
    typeNorm === "free" ||
    typeNorm === "pro" ||
    typeNorm === "max" ||
    typeNorm === "max5" ||
    typeNorm === "max5x" ||
    typeNorm === "max20" ||
    typeNorm === "max20x" ||
    typeNorm === "ultra" ||
    typeNorm === "team" ||
    typeNorm === "enterprise" ||
    typeNorm.includes("subscription")
  );
}

function isCodexExplicitChatGptSubscription(auth: ServerProvider["auth"]): boolean {
  if (typeof auth.subscriptionType === "string" && auth.subscriptionType.trim().length > 0) {
    return true;
  }
  const typeNorm = normalizeCompactToken(auth.type);
  return (
    typeNorm === "chatgpt" ||
    typeNorm === "codexchatgpt" ||
    typeNorm === "chatgptoauth" ||
    typeNorm === "officialoauth" ||
    typeNorm === "subscriptionoauth" ||
    typeNorm === "oauth" ||
    typeNorm.includes("chatgpt")
  );
}

/**
 * Classifies a target `ServerProvider`'s auth mode using non-secret signals only,
 * matching `PrismuxProviderProbeService.classifyProviderAuth` semantics with zero
 * false positives on API keys, custom endpoints, CCS/Magpie, Cloud IAM, DSH, or `unknown`.
 */
export function classifyDelegationTargetAuth(input: {
  readonly provider: DelegationGuardTargetProvider;
  readonly instanceConfig?: ProviderInstanceConfig | undefined;
  readonly workspacePath?: string | undefined;
  readonly config?: DelegationSubscriptionGuardConfigShape | undefined;
}): DelegationAuthClassification {
  const { provider, instanceConfig } = input;
  const config = input.config ?? {};
  const platform = config.platform ?? HostProcess.Platform.defaultValue();
  const baseEnv = config.env ?? HostProcess.Environment.defaultValue();
  const env = mergeInstanceEnvForClassification(baseEnv, instanceConfig);
  const homeDir = config.homeDir ?? HostProcess.HomeDirectory.defaultValue();
  const readTextFile = config.readTextFile ?? defaultReadTextFile;
  const pathApi = platform === "win32" ? NodePath.win32 : NodePath.posix;
  const family = detectProviderFamily(provider, instanceConfig);
  const canonicalProviderId = family ?? provider.instanceId;
  const hints = extractConfigHints(instanceConfig);
  const auth = provider.auth;
  const envHasCcsOrMagpie = hasCcsOrMagpieEnvKeys(env);

  // 1. Personal Antigravity (`antigravity` / `agy`) — fail-closed to `subscription_oauth`
  // unless an explicit Vertex / Gemini API key mode is configured without local OAuth.
  if (family === "antigravity") {
    const typeNorm = normalizeCompactToken(auth.type);
    const explicitLocalOauth =
      typeNorm === "localcli" ||
      typeNorm === "officialoauth" ||
      typeNorm === "subscriptionoauth" ||
      typeNorm === "agycli" ||
      typeNorm === "oauth" ||
      typeNorm === "subscription";
    if (!explicitLocalOauth) {
      const hasVertex =
        typeNorm === "vertex" ||
        hasEnvValue(env, "VERTEX_API_KEY", platform) ||
        isTruthyEnvValue(env, "GOOGLE_GENAI_USE_VERTEXAI", platform);
      const hasGeminiApiKey = typeNorm === "apikey" || hasEnvValue(env, "GEMINI_API_KEY", platform);
      if (hasVertex || hasGeminiApiKey) {
        return {
          authMode: "api_or_custom",
          canonicalProviderId: "antigravity",
          targetIsAntigravity: true,
        };
      }
    }
    return {
      authMode: "subscription_oauth",
      canonicalProviderId: "antigravity",
      targetIsAntigravity: true,
    };
  }

  // 2. Local runtimes (`local` / Ollama / LM Studio) -> always direct.
  if (family === "local") {
    return {
      authMode: "local",
      canonicalProviderId: "local",
      targetIsAntigravity: false,
    };
  }

  // 3. DSH (`dsh`) / OpenCode (`opencode`) / Pi (`pi`) -> `api_or_custom` or `local`, direct.
  if (family === "dsh" || family === "opencode" || family === "pi") {
    const endpoint = sanitizeEndpointUrl(
      auth.endpoint ??
        (family === "dsh"
          ? readCaseInsensitiveEnv(env, "DEEPSEEK_BASE_URL", platform)
          : readCaseInsensitiveEnv(env, "OPENCODE_BASE_URL", platform)),
    );
    return {
      authMode: isLocalRuntimeEndpoint(endpoint) ? "local" : "api_or_custom",
      canonicalProviderId: family,
      targetIsAntigravity: false,
    };
  }

  // 4. Codex (`codex`)
  if (family === "codex") {
    const codexHome =
      hints.homePath ||
      readCaseInsensitiveEnv(env, "CODEX_HOME", platform) ||
      pathApi.join(homeDir, ".codex");
    const tomlRaw = readTextFile(pathApi.join(codexHome, "config.toml"));
    const toml: CodexConfigTomlSignals =
      tomlRaw === null
        ? {
            modelProvider: null,
            openaiBaseUrl: null,
            providerBaseUrl: null,
            requiresOpenaiAuth: null,
            hasCustomProvider: false,
            hasCcsOrMagpieMarker: false,
          }
        : parseCodexRoutingConfigToml(tomlRaw);
    const envBaseUrl = sanitizeEndpointUrl(
      readCaseInsensitiveEnv(env, "OPENAI_BASE_URL", platform) ??
        readCaseInsensitiveEnv(env, "OPENAI_API_BASE", platform),
    );
    const effectiveEndpoint =
      envBaseUrl ??
      toml.providerBaseUrl ??
      toml.openaiBaseUrl ??
      sanitizeEndpointUrl(auth.endpoint) ??
      null;
    const typeNorm = normalizeCompactToken(auth.type);
    const hasCustomEndpoint =
      (effectiveEndpoint !== null && !isOfficialOpenAiHost(effectiveEndpoint)) ||
      toml.hasCustomProvider ||
      typeNorm === "customendpoint";
    const requiresOpenaiAuthFalse =
      auth.requiresOpenaiAuth === false || toml.requiresOpenaiAuth === false;
    const envHasOpenAiKey = hasEnvValue(env, "OPENAI_API_KEY", platform);
    const isApiKey = typeNorm === "apikey" || envHasOpenAiKey;
    const isCcsOrMagpie =
      toml.hasCcsOrMagpieMarker ||
      mentionsCcsOrMagpie(effectiveEndpoint) ||
      (envHasCcsOrMagpie && (hasCustomEndpoint || envHasOpenAiKey || requiresOpenaiAuthFalse));

    if (isCcsOrMagpie || hasCustomEndpoint || requiresOpenaiAuthFalse || isApiKey) {
      return {
        authMode: isLocalRuntimeEndpoint(effectiveEndpoint) ? "local" : "api_or_custom",
        canonicalProviderId: "codex",
        targetIsAntigravity: false,
      };
    }
    if (isCodexExplicitChatGptSubscription(auth)) {
      return {
        authMode: "subscription_oauth",
        canonicalProviderId: "codex",
        targetIsAntigravity: false,
      };
    }
    return {
      authMode: auth.status === "unauthenticated" ? "unauthenticated" : "unknown",
      canonicalProviderId: "codex",
      targetIsAntigravity: false,
    };
  }

  // 5. Claude Code (`claudeAgent`)
  if (family === "claudeAgent") {
    const settings = readClaudeSettingsSignals({
      homeDir,
      ...(hints.homePath ? { configHomeOverride: hints.homePath } : {}),
      env,
      ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
      platform,
      readTextFile,
    });
    const envBaseUrl = sanitizeEndpointUrl(
      readCaseInsensitiveEnv(env, "ANTHROPIC_BASE_URL", platform) ??
        readCaseInsensitiveEnv(env, "ANTHROPIC_API_URL", platform),
    );
    const authEndpoint = sanitizeEndpointUrl(auth.endpoint);
    const effectiveEndpoint = envBaseUrl ?? settings.baseUrl ?? authEndpoint ?? null;
    const typeNorm = normalizeCompactToken(auth.type);
    const isCloudIam =
      typeNorm === "bedrock" ||
      typeNorm === "vertex" ||
      typeNorm === "foundry" ||
      typeNorm === "cloudiam" ||
      settings.usesCloudIam ||
      isTruthyEnvValue(env, "CLAUDE_CODE_USE_BEDROCK", platform) ||
      isTruthyEnvValue(env, "CLAUDE_CODE_USE_VERTEX", platform) ||
      isTruthyEnvValue(env, "CLAUDE_CODE_USE_FOUNDRY", platform) ||
      hasEnvValue(env, "AWS_BEARER_TOKEN_BEDROCK", platform);
    const hasCustomEndpoint =
      (effectiveEndpoint !== null && !isOfficialAnthropicHost(effectiveEndpoint)) ||
      typeNorm === "customendpoint";
    const hasApiKey =
      hasEnvValue(env, "ANTHROPIC_API_KEY", platform) ||
      hasEnvValue(env, "ANTHROPIC_AUTH_TOKEN", platform) ||
      settings.hasApiKey ||
      settings.hasAuthToken ||
      settings.hasApiKeyHelper ||
      typeNorm === "apikey" ||
      typeNorm === "anthropicapikey" ||
      typeNorm === "anthropicauthtoken";
    const isCcsOrMagpie =
      settings.hasCcsOrMagpieMarker ||
      mentionsCcsOrMagpie(effectiveEndpoint) ||
      (envHasCcsOrMagpie && (hasCustomEndpoint || hasApiKey));

    if (isCloudIam || isCcsOrMagpie || hasCustomEndpoint || hasApiKey) {
      return {
        authMode: isLocalRuntimeEndpoint(effectiveEndpoint) ? "local" : "api_or_custom",
        canonicalProviderId: "claudeAgent",
        targetIsAntigravity: false,
      };
    }
    if (isClaudeExplicitSubscription(auth)) {
      return {
        authMode: "subscription_oauth",
        canonicalProviderId: "claudeAgent",
        targetIsAntigravity: false,
      };
    }
    return {
      authMode: auth.status === "unauthenticated" ? "unauthenticated" : "unknown",
      canonicalProviderId: "claudeAgent",
      targetIsAntigravity: false,
    };
  }

  // 6. Gemini CLI (`gemini`)
  if (family === "gemini") {
    const endpoint = sanitizeEndpointUrl(
      readCaseInsensitiveEnv(env, "GEMINI_BASE_URL", platform) ?? auth.endpoint,
    );
    const typeNorm = normalizeCompactToken(auth.type);
    const hasApiOrCloud =
      typeNorm === "vertex" ||
      typeNorm === "apikey" ||
      hasEnvValue(env, "VERTEX_API_KEY", platform) ||
      isTruthyEnvValue(env, "GOOGLE_GENAI_USE_VERTEXAI", platform) ||
      hasEnvValue(env, "GEMINI_API_KEY", platform) ||
      hasEnvValue(env, "GOOGLE_API_KEY", platform) ||
      (endpoint !== null && !isOfficialGoogleGeminiHost(endpoint));
    if (hasApiOrCloud) {
      return {
        authMode: "api_or_custom",
        canonicalProviderId: "gemini",
        targetIsAntigravity: false,
      };
    }
    if (
      typeNorm === "oauth" ||
      typeNorm === "googleoauth" ||
      typeNorm === "officialoauth" ||
      typeNorm === "subscription" ||
      typeNorm === "subscriptionoauth"
    ) {
      return {
        authMode: "subscription_oauth",
        canonicalProviderId: "gemini",
        targetIsAntigravity: false,
      };
    }
    return {
      authMode: auth.status === "unauthenticated" ? "unauthenticated" : "unknown",
      canonicalProviderId: "gemini",
      targetIsAntigravity: false,
    };
  }

  // 7. Generic / unknown third-party ACP/provider defaults to non-blocking `api_or_custom`.
  return {
    authMode: "api_or_custom",
    canonicalProviderId,
    targetIsAntigravity: false,
  };
}

/**
 * Detects whether the calling thread/run originates from an unattended path
 * (scheduled task, cron, overnight factory, or system/server-created automation).
 */
export function isUnattendedDelegationCaller(caller: DelegationCallerContext): boolean {
  if (typeof caller.scheduledTaskId === "string" && caller.scheduledTaskId.trim().length > 0) {
    return true;
  }
  if (
    typeof caller.userMessageId === "string" &&
    caller.userMessageId.startsWith("scheduled-task-message:")
  ) {
    return true;
  }
  if (caller.createdBy === "system" || caller.creationSource === "server") {
    return true;
  }
  if (caller.threadTags?.some((tag) => UNATTENDED_TAG_RE.test(tag.trim()))) {
    return true;
  }
  if (
    (typeof caller.requestNamespace === "string" &&
      UNATTENDED_NAMESPACE_RE.test(caller.requestNamespace)) ||
    (typeof caller.clientLabel === "string" && UNATTENDED_NAMESPACE_RE.test(caller.clientLabel))
  ) {
    return true;
  }
  return false;
}

/**
 * Evaluates the AGY & personal `subscription_oauth` delegation policy:
 * API/custom/local pass directly; personal AGY blocks unattended callers permanently and requires
 * signed waiver + controlled toggle interactively; external personal OAuth requires signed waiver.
 */
export function evaluateDelegationSubscriptionGuard(input: {
  readonly provider: DelegationGuardTargetProvider;
  readonly instanceConfig?: ProviderInstanceConfig | undefined;
  readonly workspacePath?: string | undefined;
  readonly caller: DelegationCallerContext;
  readonly config?: DelegationSubscriptionGuardConfigShape | undefined;
}): DelegationGuardDecision {
  const classification = classifyDelegationTargetAuth({
    provider: input.provider,
    instanceConfig: input.instanceConfig,
    workspacePath: input.workspacePath,
    config: input.config,
  });

  if (classification.authMode === "api_or_custom" || classification.authMode === "local") {
    return {
      allowed: true,
      dispatchPolicy: "direct",
      authMode: classification.authMode,
      providerId: classification.canonicalProviderId,
      targetIsAntigravity: classification.targetIsAntigravity,
    };
  }

  if (!classification.targetIsAntigravity && classification.authMode !== "subscription_oauth") {
    return {
      allowed: true,
      dispatchPolicy: "direct",
      authMode: classification.authMode,
      providerId: classification.canonicalProviderId,
      targetIsAntigravity: false,
    };
  }

  const waiver = readSubscriptionWaiverState(input.config);
  const unattended = isUnattendedDelegationCaller(input.caller);

  if (classification.targetIsAntigravity) {
    if (unattended) {
      return {
        allowed: false,
        dispatchPolicy: "blocked",
        code: SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE,
        reasonCode: "AGY_UNATTENDED_FORBIDDEN",
        settingsRoute: SUBSCRIPTION_WAIVER_SETTINGS_ROUTE,
        providerId: "antigravity",
        authMode: "subscription_oauth",
        targetIsAntigravity: true,
        constraint: "Blocked in unattended/scheduled runs (AGY_UNATTENDED_FORBIDDEN).",
        message:
          "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED (AGY_UNATTENDED_FORBIDDEN): Unattended / cron / overnight_factory / scheduled task threads are permanently blocked from delegating to personal Antigravity (AGY), even when the risk waiver is signed. Use DSH, API-key Codex/Claude, or a local provider instead.",
      };
    }

    if (!(waiver.signed && waiver.allowAntigravityAsControlledAgent)) {
      return {
        allowed: false,
        dispatchPolicy: "waiver_required",
        code: SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE,
        reasonCode: "AGY_CONTROLLED_AGENT_LOCKED",
        settingsRoute: SUBSCRIPTION_WAIVER_SETTINGS_ROUTE,
        providerId: "antigravity",
        authMode: "subscription_oauth",
        targetIsAntigravity: true,
        constraint: `Requires signed subscription waiver + controlled-agent toggle (${SUBSCRIPTION_WAIVER_SETTINGS_ROUTE}).`,
        message: `ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED (AGY_CONTROLLED_AGENT_LOCKED): Personal Antigravity (AGY) is locked against cross-agent delegation by default. Sign the unified Subscription Risk Waiver and enable controlled Antigravity mode in Settings → Providers (${SUBSCRIPTION_WAIVER_SETTINGS_ROUTE}), or delegate to an API/local provider such as DSH.`,
      };
    }

    return {
      allowed: true,
      dispatchPolicy: "direct",
      authMode: "subscription_oauth",
      providerId: "antigravity",
      targetIsAntigravity: true,
    };
  }

  // External personal subscription OAuth agent (e.g. ChatGPT Codex / Claude personal OAuth)
  if (!(waiver.signed && waiver.allowExternalSubscriptionAgentsInSwarm)) {
    return {
      allowed: false,
      dispatchPolicy: "waiver_required",
      code: SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE,
      reasonCode: "EXTERNAL_SUBSCRIPTION_SWARM_LOCKED",
      settingsRoute: SUBSCRIPTION_WAIVER_SETTINGS_ROUTE,
      providerId: classification.canonicalProviderId,
      authMode: "subscription_oauth",
      targetIsAntigravity: false,
      constraint: `Requires signed subscription waiver for personal OAuth delegation (${SUBSCRIPTION_WAIVER_SETTINGS_ROUTE}).`,
      message: `ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED (EXTERNAL_SUBSCRIPTION_SWARM_LOCKED): Provider "${classification.canonicalProviderId}" runs on a personal subscription OAuth account, which is locked for cross-agent delegation by default. Use API key / custom endpoint / CCS / Magpie mode for direct dispatch, or sign the Subscription Risk Waiver in Settings → Providers (${SUBSCRIPTION_WAIVER_SETTINGS_ROUTE}).`,
    };
  }

  return {
    allowed: true,
    dispatchPolicy: "direct",
    authMode: "subscription_oauth",
    providerId: classification.canonicalProviderId,
    targetIsAntigravity: false,
  };
}
