import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  CANONICAL_PROVIDER_DISPLAY_NAMES,
  type PrismuxProviderProbeResponse,
  type PrismuxProviderProbeSnapshot,
  type ProviderAuthMode,
  type ProviderAuthSource,
  type ProviderProbeStatus,
} from "@prismux/protocol";
import type { CoreRpcClient, CoreProviderSummary } from "../core/CoreRpcClient.js";
import {
  CLI_DISCOVERY_NEGATIVE_TTL_MS,
  CLI_DISCOVERY_POSITIVE_TTL_MS,
  DEFAULT_DIAGNOSTICS_CLI_TIMEOUT_MS,
  clearCliDiscoveryCaches,
  defaultCliProbe,
  findPackagedAntigravityCli,
  findPackagedAntigravityCliAsync,
  findPackagedDshDesktopCli,
  findPackagedDshDesktopCliAsync,
  getDefaultCliExtraDirs,
  isPlaceholderDshVersion,
  locateCliBinaryFastSync,
  resolveDshInstalledVersionFastSync,
  type CliProbeResult,
} from "./ServiceDiagnosticsService.js";
import {
  findExecutableOnPath,
  refreshWindowsEnvironmentFromRegistry,
  type WindowsEnvRefreshResult,
} from "./WindowsEnvRefresh.js";

const SERVER_AUTH_RPC_TIMEOUT_MS = 350;
const SERVER_AUTH_SUCCESS_TTL_MS = 5_000;
const SERVER_AUTH_FAILURE_BACKOFF_MS = 60_000;
const PROBE_ALL_CONCURRENCY_LIMIT = 3;
const TIMED_OUT_INSTALLED_CACHE_TTL_MS = 30_000;

export const AUTH_LABEL_API_CUSTOM = "API / 自定义端点注入（已放行）" as const;
export const AUTH_LABEL_CCS_MAGPIE = AUTH_LABEL_API_CUSTOM;
export const AUTH_LABEL_API_KEY = "API Key（已放行）" as const;
export const AUTH_LABEL_CLOUD_IAM = "云厂商 API / IAM（已放行）" as const;
export const AUTH_LABEL_LOCAL_RUNTIME = "本地运行时（已放行）" as const;
export const AUTH_LABEL_SUBSCRIPTION_OAUTH = "官方个人订阅 OAuth（默认锁定）" as const;
export const AUTH_LABEL_UNAUTHENTICATED = "未登录 / 未配置鉴权" as const;
export const AUTH_LABEL_NOT_INSTALLED = "未安装 CLI" as const;
export const AUTH_LABEL_UNKNOWN_ALLOWED = "未检测到个人订阅态（已放行）" as const;

export interface ProviderProbeSpec {
  readonly providerId: string;
  readonly displayName: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly diagId: string;
  readonly diagName: string;
  readonly fixAction: string;
  readonly fixCommand: string;
}

export const PRISMUX_PROBE_PROVIDER_SPECS: readonly ProviderProbeSpec[] = [
  {
    providerId: "antigravity",
    displayName: `${CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity} (agy)`,
    command: "agy",
    args: ["--version"],
    diagId: "provider.agy",
    diagName: `${CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity} CLI (agy · 纯 ACP)`,
    fixAction: "安装本机 agy CLI 并运行 ACP 登录",
    fixCommand: "agy acp --login",
  },
  {
    providerId: "claudeAgent",
    displayName: `${CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent} (claude)`,
    command: "claude",
    args: ["--version"],
    diagId: "provider.claude",
    diagName: `${CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent} CLI (claude)`,
    fixAction: `安装官方 ${CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent} CLI`,
    fixCommand: "npm install -g @anthropic-ai/claude-code",
  },
  {
    providerId: "codex",
    displayName: `${CANONICAL_PROVIDER_DISPLAY_NAMES.codex} (codex)`,
    command: "codex",
    args: ["--version"],
    diagId: "provider.codex",
    diagName: `${CANONICAL_PROVIDER_DISPLAY_NAMES.codex} CLI (codex)`,
    fixAction: `安装官方 ${CANONICAL_PROVIDER_DISPLAY_NAMES.codex} CLI`,
    fixCommand: "npm install -g @openai/codex",
  },
  {
    providerId: "dsh",
    displayName: `${CANONICAL_PROVIDER_DISPLAY_NAMES.dsh} (dsh)`,
    command: "dsh",
    args: ["--version"],
    diagId: "provider.dsh",
    diagName: `${CANONICAL_PROVIDER_DISPLAY_NAMES.dsh} CLI (dsh · ACP)`,
    fixAction: `检查本机 ${CANONICAL_PROVIDER_DISPLAY_NAMES.dsh} (DSH NEXT) 或 dsh CLI 安装`,
    fixCommand: "dsh --version",
  },
  {
    providerId: "gemini",
    displayName: `${CANONICAL_PROVIDER_DISPLAY_NAMES.gemini} (gemini)`,
    command: "gemini",
    args: ["--version"],
    diagId: "provider.gemini",
    diagName: `${CANONICAL_PROVIDER_DISPLAY_NAMES.gemini} (gemini)`,
    fixAction: `安装官方 ${CANONICAL_PROVIDER_DISPLAY_NAMES.gemini}`,
    fixCommand: "npm install -g @google/gemini-cli",
  },
  {
    providerId: "opencode",
    displayName: `${CANONICAL_PROVIDER_DISPLAY_NAMES.opencode} (opencode)`,
    command: "opencode",
    args: ["--version"],
    diagId: "provider.opencode",
    diagName: `${CANONICAL_PROVIDER_DISPLAY_NAMES.opencode} CLI (opencode)`,
    fixAction: `安装 ${CANONICAL_PROVIDER_DISPLAY_NAMES.opencode} CLI`,
    fixCommand: "npm install -g opencode-ai",
  },
] as const;

export interface ServerProviderAuthMetadata {
  status?: "authenticated" | "unauthenticated" | "unknown" | string;
  type?: string | null;
  label?: string | null;
  endpoint?: string | null;
  subscriptionType?: string | null;
  apiProvider?: string | null;
  apiKeySource?: string | null;
  authMethod?: string | null;
  requiresOpenaiAuth?: boolean | null;
  accountType?: string | null;
  launchCommand?: string | null;
}

export interface ProviderAuthClassificationInput {
  providerId: string;
  installed: boolean;
  binaryPath?: string | null;
  launchCommand?: string | null;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  workspacePath?: string;
  platform?: NodeJS.Platform;
  serverAuth?: ServerProviderAuthMetadata | null;
}

export interface ProviderAuthClassificationResult {
  authMode: ProviderAuthMode;
  authSource: ProviderAuthSource;
  endpoint: string | null;
  authLabel: string;
  explicitlyUnauthenticated: boolean;
}

export interface PrismuxProviderProbeServiceOptions {
  coreRpcClient?: CoreRpcClient;
  /** Optional uniform TTL override (used by tests); defaults to 10m positive / 5m negative. */
  cacheTtlMs?: number;
  positiveCacheTtlMs?: number;
  negativeCacheTtlMs?: number;
  cliTimeoutMs?: number;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  workspacePath?: string;
  platform?: NodeJS.Platform;
  now?: () => number;
  /** Optional configured/enabled provider IDs to scope probes unless `includeAll: true`. */
  configuredProviders?: readonly string[] | (() => readonly string[] | null | undefined);
  refreshEnv?: () => Promise<WindowsEnvRefreshResult | void> | void;
  cliProbe?: (command: string, args: string[], timeoutMs: number) => Promise<CliProbeResult>;
  locateExecutable?: (
    command: string,
    env: Record<string, string | undefined>,
    platform: NodeJS.Platform,
  ) => string | null;
  serverAuthResolver?: () => Promise<Partial<Record<string, ServerProviderAuthMetadata>>>;
}

const PROVIDER_ALIAS_MAP: Readonly<Record<string, string>> = {
  antigravity: "antigravity",
  agy: "antigravity",
  "antigravity-cli": "antigravity",
  antigravity_cli: "antigravity",
  "google-antigravity": "antigravity",
  google_antigravity: "antigravity",
  "personal-antigravity": "antigravity",
  "personal-agy": "antigravity",
  claudeagent: "claudeAgent",
  "claude-agent": "claudeAgent",
  claude_agent: "claudeAgent",
  claude: "claudeAgent",
  cc: "claudeAgent",
  "claude-code": "claudeAgent",
  claudecode: "claudeAgent",
  claude_code: "claudeAgent",
  codex: "codex",
  "openai-codex": "codex",
  openai_codex: "codex",
  dsh: "dsh",
  "dsh-next": "dsh",
  dsh_next: "dsh",
  "deepseek-harness": "dsh",
  gemini: "gemini",
  "gemini-cli": "gemini",
  gemini_cli: "gemini",
  "gemini-api": "gemini",
  gemini_api: "gemini",
  opencode: "opencode",
  "open-code": "opencode",
  open_code: "opencode",
  local: "local",
  ollama: "local",
  lmstudio: "local",
  "lm-studio": "local",
  vllm: "local",
  llamacpp: "local",
};

export function canonicalizeProbeProviderId(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (Object.hasOwn(PROVIDER_ALIAS_MAP, lower)) {
    return PROVIDER_ALIAS_MAP[lower]!;
  }
  if (/^(?:antigravity|agy)(?:[-_:\s].*)?$/i.test(lower)) {
    return "antigravity";
  }
  return trimmed;
}

function getEnvValue(
  env: Record<string, string | undefined>,
  key: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const direct = env[key];
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }
  if (platform === "win32") {
    const upper = key.toUpperCase();
    for (const [k, v] of Object.entries(env)) {
      if (k.toUpperCase() === upper && typeof v === "string" && v.trim().length > 0) {
        return v.trim();
      }
    }
  }
  return undefined;
}

function hasEnvValue(
  env: Record<string, string | undefined>,
  key: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return getEnvValue(env, key, platform) !== undefined;
}

function isTruthyEnvValue(
  env: Record<string, string | undefined>,
  key: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const val = getEnvValue(env, key, platform)?.toLowerCase();
  return val === "1" || val === "true" || val === "yes" || val === "on";
}

function hasCcsOrMagpieEnvKeys(env: Record<string, string | undefined>): boolean {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }
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

/**
 * Strips any embedded userinfo, query string, or fragment from an endpoint URL
 * so secrets in URLs can never leak into snapshots or logs.
 */
export function sanitizeEndpointUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, "");
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
  if (!endpoint) {
    return false;
  }
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

const CCS_MAGPIE_TOKEN_RE = /(?:^|[\s\\/:._-])(?:ccs|magpie)(?:[\s\\/:._-]|$)/i;

function mentionsCcsOrMagpie(raw: string | null | undefined): boolean {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return false;
  }
  return CCS_MAGPIE_TOKEN_RE.test(raw);
}

function isLocalhostEndpoint(endpoint: string | null): boolean {
  if (!endpoint) {
    return false;
  }
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ClaudeSettingsSignals {
  baseUrl: string | null;
  hasApiKey: boolean;
  hasAuthToken: boolean;
  hasApiKeyHelper: boolean;
  usesCloudIam: boolean;
  hasCcsOrMagpieMarker: boolean;
}

/**
 * Reads ONLY non-secret routing & presence signals from Claude Code settings.json files.
 * Security floor: NEVER reads `.credentials.json`, keyrings, or cookies; NEVER returns token values.
 */
function readClaudeSettingsSignals(options: {
  homeDir: string;
  env: Record<string, string | undefined>;
  workspacePath?: string;
  platform: NodeJS.Platform;
}): ClaudeSettingsSignals {
  const claudeConfigDir =
    getEnvValue(options.env, "CLAUDE_CONFIG_DIR", options.platform) ??
    join(options.homeDir, ".claude");
  const candidateFiles = [
    join(claudeConfigDir, "settings.json"),
    ...(options.workspacePath
      ? [
          join(options.workspacePath, ".claude", "settings.json"),
          join(options.workspacePath, ".claude", "settings.local.json"),
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
    if (!existsSync(filePath)) {
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      if (!isPlainRecord(parsed)) {
        continue;
      }
      if (typeof parsed["apiKeyHelper"] === "string" && parsed["apiKeyHelper"].trim().length > 0) {
        hasApiKeyHelper = true;
        if (mentionsCcsOrMagpie(parsed["apiKeyHelper"])) {
          hasCcsOrMagpieMarker = true;
        }
      }
      const settingsEnv = isPlainRecord(parsed["env"]) ? parsed["env"] : null;
      if (settingsEnv) {
        const rawUrl =
          typeof settingsEnv["ANTHROPIC_BASE_URL"] === "string"
            ? settingsEnv["ANTHROPIC_BASE_URL"]
            : typeof settingsEnv["ANTHROPIC_API_URL"] === "string"
              ? settingsEnv["ANTHROPIC_API_URL"]
              : undefined;
        const sanitized = sanitizeEndpointUrl(rawUrl);
        if (sanitized !== null) {
          baseUrl = sanitized;
          if (mentionsCcsOrMagpie(sanitized)) {
            hasCcsOrMagpieMarker = true;
          }
        }
        if (
          typeof settingsEnv["ANTHROPIC_API_KEY"] === "string" &&
          settingsEnv["ANTHROPIC_API_KEY"].trim().length > 0
        ) {
          hasApiKey = true;
        }
        if (
          typeof settingsEnv["ANTHROPIC_AUTH_TOKEN"] === "string" &&
          settingsEnv["ANTHROPIC_AUTH_TOKEN"].trim().length > 0
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
          if (val === "1" || val === "true" || val === "yes") {
            usesCloudIam = true;
          }
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
      // Ignore unreadable or invalid settings JSON cleanly.
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

interface CodexConfigTomlSignals {
  modelProvider: string | null;
  openaiBaseUrl: string | null;
  providerBaseUrl: string | null;
  requiresOpenaiAuth: boolean | null;
  hasCustomProvider: boolean;
  hasCcsOrMagpieMarker: boolean;
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

/**
 * Reads ONLY non-secret routing fields (`model_provider`, `openai_base_url`,
 * `[model_providers.<id>].base_url`, `requires_openai_auth`) from `~/.codex/config.toml`.
 * Security floor: NEVER reads `auth.json` or any OAuth/token/API-key secrets.
 */
export function parseCodexRoutingConfigToml(content: string): CodexConfigTomlSignals {
  let currentSection = "";
  let modelProvider: string | null = null;
  let openaiBaseUrl: string | null = null;
  let rootRequiresOpenaiAuth: boolean | null = null;
  const providerTables = new Map<
    string,
    { baseUrl: string | null; requiresOpenaiAuth: boolean | null }
  >();

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const sectionMatch = /^\[([^\]]+)\]$/.exec(trimmed);
    if (sectionMatch !== null) {
      currentSection = sectionMatch[1]!.trim();
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) {
      continue;
    }
    const key = trimmed
      .slice(0, eqIdx)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    const rawVal = trimmed.slice(eqIdx + 1).trim();

    if (currentSection === "") {
      if (key === "model_provider") {
        const val = parseTomlScalarString(rawVal);
        if (val) modelProvider = val;
      } else if (key === "openai_base_url") {
        const val = parseTomlScalarString(rawVal);
        openaiBaseUrl = sanitizeEndpointUrl(val);
      } else if (key === "requires_openai_auth") {
        rootRequiresOpenaiAuth = parseTomlScalarBoolean(rawVal);
      }
      continue;
    }

    const mpMatch = /^model_providers\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))$/.exec(
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
        const val = parseTomlScalarString(rawVal);
        entry.baseUrl = sanitizeEndpointUrl(val);
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

function readCodexConfigSignals(options: {
  homeDir: string;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}): CodexConfigTomlSignals {
  const codexHome =
    getEnvValue(options.env, "CODEX_HOME", options.platform) ?? join(options.homeDir, ".codex");
  const configPath = join(codexHome, "config.toml");
  if (!existsSync(configPath)) {
    return {
      modelProvider: null,
      openaiBaseUrl: null,
      providerBaseUrl: null,
      requiresOpenaiAuth: null,
      hasCustomProvider: false,
      hasCcsOrMagpieMarker: false,
    };
  }
  try {
    return parseCodexRoutingConfigToml(readFileSync(configPath, "utf8"));
  } catch {
    return {
      modelProvider: null,
      openaiBaseUrl: null,
      providerBaseUrl: null,
      requiresOpenaiAuth: null,
      hasCustomProvider: false,
      hasCcsOrMagpieMarker: false,
    };
  }
}

function normalizeToken(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[\s_-]+/g, "");
}

function isClaudeApiOrCloudServerAuth(serverAuth: ServerProviderAuthMetadata | null | undefined): {
  kind: "cloud_iam" | "custom_endpoint" | "api_key" | null;
  endpoint: string | null;
} {
  if (!serverAuth) {
    return { kind: null, endpoint: null };
  }
  const typeNorm = normalizeToken(serverAuth.type);
  const apiProviderNorm = normalizeToken(serverAuth.apiProvider);
  const authMethodNorm = normalizeToken(serverAuth.authMethod);
  const cleanEndpoint = sanitizeEndpointUrl(serverAuth.endpoint);

  if (
    typeNorm === "bedrock" ||
    typeNorm === "vertex" ||
    typeNorm === "foundry" ||
    typeNorm === "cloudiam" ||
    apiProviderNorm === "bedrock" ||
    apiProviderNorm === "vertex" ||
    apiProviderNorm === "foundry"
  ) {
    return { kind: "cloud_iam", endpoint: cleanEndpoint };
  }

  if (
    typeNorm === "customendpoint" ||
    (cleanEndpoint !== null && !isOfficialAnthropicHost(cleanEndpoint))
  ) {
    return { kind: "custom_endpoint", endpoint: cleanEndpoint };
  }

  if (
    typeNorm === "apikey" ||
    typeNorm === "anthropicapikey" ||
    typeNorm === "anthropicauthtoken" ||
    authMethodNorm === "apikey" ||
    authMethodNorm === "anthropicapikey" ||
    authMethodNorm === "anthropicauthtoken" ||
    (typeof serverAuth.apiKeySource === "string" &&
      serverAuth.apiKeySource.trim().length > 0 &&
      serverAuth.apiKeySource.trim().toLowerCase() !== "none")
  ) {
    return { kind: "api_key", endpoint: cleanEndpoint };
  }

  return { kind: null, endpoint: cleanEndpoint };
}

function isClaudeExplicitSubscription(
  serverAuth: ServerProviderAuthMetadata | null | undefined,
): boolean {
  if (!serverAuth) {
    return false;
  }
  if (
    typeof serverAuth.subscriptionType === "string" &&
    serverAuth.subscriptionType.trim().length > 0
  ) {
    return true;
  }
  const typeNorm = normalizeToken(serverAuth.type);
  if (typeNorm.length === 0 || typeNorm === "unknown" || typeNorm === "none") {
    return false;
  }
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

function isCodexExplicitChatGptSubscription(
  serverAuth: ServerProviderAuthMetadata | null | undefined,
): boolean {
  if (!serverAuth) {
    return false;
  }
  const acctNorm = normalizeToken(serverAuth.accountType);
  if (acctNorm === "chatgpt" || acctNorm === "codexchatgpt") {
    return true;
  }
  const typeNorm = normalizeToken(serverAuth.type);
  if (
    typeNorm === "chatgpt" ||
    typeNorm === "codexchatgpt" ||
    typeNorm === "chatgptoauth" ||
    typeNorm === "officialoauth" ||
    typeNorm === "subscriptionoauth" ||
    typeNorm === "oauth" ||
    typeNorm.includes("chatgpt")
  ) {
    return true;
  }
  if (
    typeof serverAuth.subscriptionType === "string" &&
    serverAuth.subscriptionType.trim().length > 0
  ) {
    return true;
  }
  return false;
}

/**
 * Pure deterministic auth classifier with ZERO false positives on CCS / Magpie API injection.
 *
 * Security floor:
 * - Never reads plaintext OAuth token files, OS keyrings, or cookies.
 * - Never maps `auth.status === "unknown"` to `subscription_oauth`.
 */
export function classifyProviderAuth(
  input: ProviderAuthClassificationInput,
): ProviderAuthClassificationResult {
  const providerId = canonicalizeProbeProviderId(input.providerId);
  const env = input.env ?? process.env;
  const homeDir = input.homeDir ?? homedir();
  const platform = input.platform ?? process.platform;
  const serverAuth = input.serverAuth ?? null;
  const explicitlyUnauthenticated = normalizeToken(serverAuth?.status) === "unauthenticated";

  const wrapperIsCcsOrMagpie =
    mentionsCcsOrMagpie(input.launchCommand) ||
    mentionsCcsOrMagpie(serverAuth?.launchCommand) ||
    mentionsCcsOrMagpie(input.binaryPath);
  const envHasCcsOrMagpie = hasCcsOrMagpieEnvKeys(env);

  // ── 1. Claude Code (`claudeAgent` / `cc`) ─────────────────────────────────
  if (providerId === "claudeAgent") {
    const settings = readClaudeSettingsSignals({
      homeDir,
      env,
      workspacePath: input.workspacePath,
      platform,
    });
    const envBaseUrl = sanitizeEndpointUrl(
      getEnvValue(env, "ANTHROPIC_BASE_URL", platform) ??
        getEnvValue(env, "ANTHROPIC_API_URL", platform),
    );
    const serverSignal = isClaudeApiOrCloudServerAuth(serverAuth);
    const effectiveEndpoint = envBaseUrl ?? settings.baseUrl ?? serverSignal.endpoint ?? null;

    const envCloudIam =
      isTruthyEnvValue(env, "CLAUDE_CODE_USE_BEDROCK", platform) ||
      isTruthyEnvValue(env, "CLAUDE_CODE_USE_VERTEX", platform) ||
      isTruthyEnvValue(env, "CLAUDE_CODE_USE_FOUNDRY", platform) ||
      hasEnvValue(env, "AWS_BEARER_TOKEN_BEDROCK", platform);

    if (serverSignal.kind === "cloud_iam" || envCloudIam || settings.usesCloudIam) {
      return {
        authMode: "api_or_custom",
        authSource: "cloud_iam",
        endpoint: effectiveEndpoint,
        authLabel: AUTH_LABEL_CLOUD_IAM,
        explicitlyUnauthenticated: false,
      };
    }

    const hasCustomEndpoint =
      (effectiveEndpoint !== null && !isOfficialAnthropicHost(effectiveEndpoint)) ||
      serverSignal.kind === "custom_endpoint";

    const isCcsOrMagpie =
      wrapperIsCcsOrMagpie ||
      settings.hasCcsOrMagpieMarker ||
      mentionsCcsOrMagpie(effectiveEndpoint) ||
      (envHasCcsOrMagpie &&
        (hasCustomEndpoint ||
          hasEnvValue(env, "ANTHROPIC_API_KEY", platform) ||
          hasEnvValue(env, "ANTHROPIC_AUTH_TOKEN", platform) ||
          settings.hasApiKey ||
          settings.hasAuthToken ||
          settings.hasApiKeyHelper));

    if (isCcsOrMagpie) {
      return {
        authMode: "api_or_custom",
        authSource: "ccs_or_magpie",
        endpoint: effectiveEndpoint,
        authLabel: AUTH_LABEL_CCS_MAGPIE,
        explicitlyUnauthenticated: false,
      };
    }

    if (hasCustomEndpoint) {
      return {
        authMode: "api_or_custom",
        authSource: "custom_endpoint",
        endpoint: effectiveEndpoint,
        authLabel: AUTH_LABEL_API_CUSTOM,
        explicitlyUnauthenticated: false,
      };
    }

    const envHasApiKey =
      hasEnvValue(env, "ANTHROPIC_API_KEY", platform) ||
      hasEnvValue(env, "ANTHROPIC_AUTH_TOKEN", platform);

    if (
      envHasApiKey ||
      settings.hasApiKey ||
      settings.hasAuthToken ||
      settings.hasApiKeyHelper ||
      serverSignal.kind === "api_key"
    ) {
      return {
        authMode: "api_or_custom",
        authSource: envHasApiKey ? "env" : "cli_config",
        endpoint: effectiveEndpoint,
        authLabel: settings.hasApiKeyHelper ? AUTH_LABEL_API_CUSTOM : AUTH_LABEL_API_KEY,
        explicitlyUnauthenticated: false,
      };
    }

    // ONLY classify as subscription_oauth if NONE of the API/custom overrides exist
    // AND an explicit official first-party subscription is confirmed.
    if (isClaudeExplicitSubscription(serverAuth)) {
      return {
        authMode: "subscription_oauth",
        authSource: "official_oauth",
        endpoint: null,
        authLabel: AUTH_LABEL_SUBSCRIPTION_OAUTH,
        explicitlyUnauthenticated: false,
      };
    }

    if (!input.installed) {
      return {
        authMode: "unauthenticated",
        authSource: "none",
        endpoint: null,
        authLabel: AUTH_LABEL_NOT_INSTALLED,
        explicitlyUnauthenticated: false,
      };
    }

    return {
      authMode: "unauthenticated",
      authSource: "none",
      endpoint: null,
      authLabel: explicitlyUnauthenticated
        ? AUTH_LABEL_UNAUTHENTICATED
        : AUTH_LABEL_UNKNOWN_ALLOWED,
      explicitlyUnauthenticated,
    };
  }

  // ── 2. Codex (`codex`) ────────────────────────────────────────────────────
  if (providerId === "codex") {
    const toml = readCodexConfigSignals({ homeDir, env, platform });
    const envBaseUrl = sanitizeEndpointUrl(
      getEnvValue(env, "OPENAI_BASE_URL", platform) ??
        getEnvValue(env, "OPENAI_API_BASE", platform),
    );
    const serverEndpoint = sanitizeEndpointUrl(serverAuth?.endpoint);
    const effectiveEndpoint =
      envBaseUrl ?? toml.providerBaseUrl ?? toml.openaiBaseUrl ?? serverEndpoint ?? null;

    const serverTypeNorm = normalizeToken(serverAuth?.type);
    const serverAccountNorm = normalizeToken(serverAuth?.accountType);
    const hasCustomEndpoint =
      (effectiveEndpoint !== null && !isOfficialOpenAiHost(effectiveEndpoint)) ||
      toml.hasCustomProvider ||
      serverTypeNorm === "customendpoint";
    const requiresOpenaiAuthFalse =
      serverAuth?.requiresOpenaiAuth === false || toml.requiresOpenaiAuth === false;
    const envHasOpenAiKey = hasEnvValue(env, "OPENAI_API_KEY", platform);
    const serverIsApiKey = serverTypeNorm === "apikey" || serverAccountNorm === "apikey";

    const isCcsOrMagpie =
      wrapperIsCcsOrMagpie ||
      toml.hasCcsOrMagpieMarker ||
      mentionsCcsOrMagpie(effectiveEndpoint) ||
      (envHasCcsOrMagpie && (hasCustomEndpoint || envHasOpenAiKey || requiresOpenaiAuthFalse));

    if (isCcsOrMagpie) {
      return {
        authMode: "api_or_custom",
        authSource: "ccs_or_magpie",
        endpoint: effectiveEndpoint,
        authLabel: AUTH_LABEL_CCS_MAGPIE,
        explicitlyUnauthenticated: false,
      };
    }

    if (hasCustomEndpoint) {
      return {
        authMode: "api_or_custom",
        authSource: isLocalhostEndpoint(effectiveEndpoint) ? "ccs_or_magpie" : "custom_endpoint",
        endpoint: effectiveEndpoint,
        authLabel: isLocalhostEndpoint(effectiveEndpoint)
          ? AUTH_LABEL_CCS_MAGPIE
          : AUTH_LABEL_API_CUSTOM,
        explicitlyUnauthenticated: false,
      };
    }

    // Even when `auth.status === "unknown"`, `requiresOpenaiAuth === false` MUST classify as `api_or_custom`!
    if (requiresOpenaiAuthFalse) {
      return {
        authMode: "api_or_custom",
        authSource: "custom_endpoint",
        endpoint: effectiveEndpoint,
        authLabel: AUTH_LABEL_API_CUSTOM,
        explicitlyUnauthenticated: false,
      };
    }

    if (serverIsApiKey || envHasOpenAiKey) {
      return {
        authMode: "api_or_custom",
        authSource: envHasOpenAiKey ? "env" : "cli_config",
        endpoint: effectiveEndpoint,
        authLabel: AUTH_LABEL_API_KEY,
        explicitlyUnauthenticated: false,
      };
    }

    // ONLY classify as subscription_oauth if NONE of the API/custom overrides exist
    // AND explicit ChatGPT personal subscription is confirmed.
    if (isCodexExplicitChatGptSubscription(serverAuth)) {
      return {
        authMode: "subscription_oauth",
        authSource: "official_oauth",
        endpoint: null,
        authLabel: AUTH_LABEL_SUBSCRIPTION_OAUTH,
        explicitlyUnauthenticated: false,
      };
    }

    if (!input.installed) {
      return {
        authMode: "unauthenticated",
        authSource: "none",
        endpoint: null,
        authLabel: AUTH_LABEL_NOT_INSTALLED,
        explicitlyUnauthenticated: false,
      };
    }

    return {
      authMode: "unauthenticated",
      authSource: "none",
      endpoint: null,
      authLabel: explicitlyUnauthenticated
        ? AUTH_LABEL_UNAUTHENTICATED
        : AUTH_LABEL_UNKNOWN_ALLOWED,
      explicitlyUnauthenticated,
    };
  }

  // ── 3. Antigravity (`antigravity` / `agy`) ────────────────────────────────
  if (providerId === "antigravity") {
    const serverTypeNorm = normalizeToken(serverAuth?.type);
    const serverApiProviderNorm = normalizeToken(serverAuth?.apiProvider);
    const explicitLocalOauth =
      serverTypeNorm === "localcli" ||
      serverTypeNorm === "officialoauth" ||
      serverTypeNorm === "subscriptionoauth" ||
      serverTypeNorm === "agycli" ||
      serverTypeNorm === "oauth" ||
      serverTypeNorm === "subscription";

    if (!explicitLocalOauth) {
      const hasVertex =
        serverTypeNorm === "vertex" ||
        serverApiProviderNorm === "vertex" ||
        hasEnvValue(env, "VERTEX_API_KEY", platform) ||
        isTruthyEnvValue(env, "GOOGLE_GENAI_USE_VERTEXAI", platform);
      const hasGeminiApiKey =
        serverTypeNorm === "apikey" || hasEnvValue(env, "GEMINI_API_KEY", platform);

      if (hasVertex) {
        return {
          authMode: "api_or_custom",
          authSource: "cloud_iam",
          endpoint: sanitizeEndpointUrl(serverAuth?.endpoint),
          authLabel: AUTH_LABEL_CLOUD_IAM,
          explicitlyUnauthenticated: false,
        };
      }
      if (hasGeminiApiKey) {
        return {
          authMode: "api_or_custom",
          authSource: "env",
          endpoint: sanitizeEndpointUrl(serverAuth?.endpoint),
          authLabel: AUTH_LABEL_API_KEY,
          explicitlyUnauthenticated: false,
        };
      }
    }

    if (!input.installed) {
      return {
        authMode: "unauthenticated",
        authSource: "none",
        endpoint: null,
        authLabel: AUTH_LABEL_NOT_INSTALLED,
        explicitlyUnauthenticated: false,
      };
    }

    if (explicitlyUnauthenticated) {
      return {
        authMode: "unauthenticated",
        authSource: "none",
        endpoint: null,
        authLabel: AUTH_LABEL_UNAUTHENTICATED,
        explicitlyUnauthenticated: true,
      };
    }

    // Local `agy` CLI personal login = `subscription_oauth`.
    return {
      authMode: "subscription_oauth",
      authSource: "official_oauth",
      endpoint: null,
      authLabel: AUTH_LABEL_SUBSCRIPTION_OAUTH,
      explicitlyUnauthenticated: false,
    };
  }

  // ── 4. Local runtimes (`local` / Ollama / LM Studio) ──────────────────────
  if (providerId === "local") {
    return {
      authMode: "local",
      authSource: "local_runtime",
      endpoint: sanitizeEndpointUrl(serverAuth?.endpoint),
      authLabel: AUTH_LABEL_LOCAL_RUNTIME,
      explicitlyUnauthenticated: false,
    };
  }

  // ── 5. DSH (`dsh`) / OpenCode (`opencode`) ────────────────────────────────
  if (providerId === "dsh" || providerId === "opencode") {
    const endpoint = sanitizeEndpointUrl(
      serverAuth?.endpoint ??
        (providerId === "dsh"
          ? getEnvValue(env, "DEEPSEEK_BASE_URL", platform)
          : getEnvValue(env, "OPENCODE_BASE_URL", platform)),
    );
    if (!input.installed) {
      return {
        authMode: "unauthenticated",
        authSource: "none",
        endpoint,
        authLabel: AUTH_LABEL_NOT_INSTALLED,
        explicitlyUnauthenticated: false,
      };
    }
    if (isLocalRuntimeEndpoint(endpoint)) {
      return {
        authMode: "local",
        authSource: "local_runtime",
        endpoint,
        authLabel: AUTH_LABEL_LOCAL_RUNTIME,
        explicitlyUnauthenticated: false,
      };
    }
    if (wrapperIsCcsOrMagpie || mentionsCcsOrMagpie(endpoint)) {
      return {
        authMode: "api_or_custom",
        authSource: "ccs_or_magpie",
        endpoint,
        authLabel: AUTH_LABEL_CCS_MAGPIE,
        explicitlyUnauthenticated: false,
      };
    }
    const hasKey =
      providerId === "dsh"
        ? hasEnvValue(env, "DEEPSEEK_API_KEY", platform)
        : hasEnvValue(env, "OPENCODE_API_KEY", platform) ||
          hasEnvValue(env, "OPENAI_API_KEY", platform) ||
          hasEnvValue(env, "ANTHROPIC_API_KEY", platform);
    return {
      authMode: "api_or_custom",
      authSource: endpoint ? "custom_endpoint" : hasKey ? "env" : "cli_config",
      endpoint,
      authLabel: endpoint ? AUTH_LABEL_API_CUSTOM : AUTH_LABEL_API_CUSTOM,
      explicitlyUnauthenticated: false,
    };
  }

  // ── 6. Gemini CLI (`gemini`) ──────────────────────────────────────────────
  if (providerId === "gemini") {
    const endpoint = sanitizeEndpointUrl(
      getEnvValue(env, "GEMINI_BASE_URL", platform) ?? serverAuth?.endpoint,
    );
    const hasVertex =
      normalizeToken(serverAuth?.type) === "vertex" ||
      normalizeToken(serverAuth?.apiProvider) === "vertex" ||
      hasEnvValue(env, "VERTEX_API_KEY", platform) ||
      isTruthyEnvValue(env, "GOOGLE_GENAI_USE_VERTEXAI", platform);
    const hasGeminiKey =
      normalizeToken(serverAuth?.type) === "apikey" ||
      hasEnvValue(env, "GEMINI_API_KEY", platform) ||
      hasEnvValue(env, "GOOGLE_API_KEY", platform);

    if (hasVertex) {
      return {
        authMode: "api_or_custom",
        authSource: "cloud_iam",
        endpoint,
        authLabel: AUTH_LABEL_CLOUD_IAM,
        explicitlyUnauthenticated: false,
      };
    }
    if (endpoint !== null && !isOfficialGoogleGeminiHost(endpoint)) {
      return {
        authMode: "api_or_custom",
        authSource: mentionsCcsOrMagpie(endpoint) ? "ccs_or_magpie" : "custom_endpoint",
        endpoint,
        authLabel: mentionsCcsOrMagpie(endpoint) ? AUTH_LABEL_CCS_MAGPIE : AUTH_LABEL_API_CUSTOM,
        explicitlyUnauthenticated: false,
      };
    }
    if (hasGeminiKey) {
      return {
        authMode: "api_or_custom",
        authSource: "env",
        endpoint,
        authLabel: AUTH_LABEL_API_KEY,
        explicitlyUnauthenticated: false,
      };
    }
    const typeNorm = normalizeToken(serverAuth?.type);
    if (
      typeNorm === "oauth" ||
      typeNorm === "googleoauth" ||
      typeNorm === "officialoauth" ||
      typeNorm === "subscription" ||
      typeNorm === "subscriptionoauth"
    ) {
      return {
        authMode: "subscription_oauth",
        authSource: "official_oauth",
        endpoint: null,
        authLabel: AUTH_LABEL_SUBSCRIPTION_OAUTH,
        explicitlyUnauthenticated: false,
      };
    }
    if (!input.installed) {
      return {
        authMode: "unauthenticated",
        authSource: "none",
        endpoint: null,
        authLabel: AUTH_LABEL_NOT_INSTALLED,
        explicitlyUnauthenticated: false,
      };
    }
    return {
      authMode: "unauthenticated",
      authSource: "none",
      endpoint: null,
      authLabel: explicitlyUnauthenticated
        ? AUTH_LABEL_UNAUTHENTICATED
        : AUTH_LABEL_UNKNOWN_ALLOWED,
      explicitlyUnauthenticated,
    };
  }

  // ── 7. Generic / unknown third-party provider defaults to non-blocking ────
  return {
    authMode: input.installed ? "api_or_custom" : "unauthenticated",
    authSource: input.installed ? "cli_config" : "none",
    endpoint: sanitizeEndpointUrl(serverAuth?.endpoint),
    authLabel: input.installed ? AUTH_LABEL_API_CUSTOM : AUTH_LABEL_NOT_INSTALLED,
    explicitlyUnauthenticated: false,
  };
}

function extractServerAuthFromSummary(
  summary: CoreProviderSummary,
): ServerProviderAuthMetadata | null {
  const auth = isPlainRecord(summary["auth"]) ? summary["auth"] : null;
  const account = isPlainRecord(summary["account"]) ? summary["account"] : null;
  const endpointRaw =
    typeof auth?.["endpoint"] === "string"
      ? auth["endpoint"]
      : typeof summary["endpoint"] === "string"
        ? summary["endpoint"]
        : null;
  const requiresOpenaiAuth =
    typeof auth?.["requiresOpenaiAuth"] === "boolean"
      ? auth["requiresOpenaiAuth"]
      : typeof account?.["requiresOpenaiAuth"] === "boolean"
        ? account["requiresOpenaiAuth"]
        : typeof summary["requiresOpenaiAuth"] === "boolean"
          ? summary["requiresOpenaiAuth"]
          : null;

  const meta: ServerProviderAuthMetadata = {
    ...(typeof auth?.["status"] === "string" ? { status: auth["status"] } : {}),
    ...(typeof auth?.["type"] === "string" ? { type: auth["type"] } : {}),
    ...(typeof auth?.["label"] === "string" ? { label: auth["label"] } : {}),
    ...(endpointRaw !== null ? { endpoint: endpointRaw } : {}),
    ...(typeof auth?.["subscriptionType"] === "string"
      ? { subscriptionType: auth["subscriptionType"] }
      : typeof summary["subscriptionType"] === "string"
        ? { subscriptionType: summary["subscriptionType"] }
        : {}),
    ...(typeof auth?.["apiProvider"] === "string" ? { apiProvider: auth["apiProvider"] } : {}),
    ...(typeof auth?.["apiKeySource"] === "string" ? { apiKeySource: auth["apiKeySource"] } : {}),
    ...(typeof auth?.["authMethod"] === "string" ? { authMethod: auth["authMethod"] } : {}),
    ...(requiresOpenaiAuth !== null ? { requiresOpenaiAuth } : {}),
    ...(typeof account?.["type"] === "string"
      ? { accountType: account["type"] }
      : typeof auth?.["accountType"] === "string"
        ? { accountType: auth["accountType"] }
        : {}),
    ...(typeof summary["launchCommand"] === "string"
      ? { launchCommand: summary["launchCommand"] }
      : {}),
  };

  return Object.keys(meta).length > 0 ? meta : null;
}

/**
 * Unified single-source-of-truth provider probe serving:
 * - `GET /v1/providers/probe`
 * - `ServiceDiagnosticsService` (`ai_providers`)
 * - `OfficialQuotaService` (AGY executable lookup)
 * - `SubscriptionOrchestrationGuard` (Swarm & cross-agent auth classification)
 */
export class PrismuxProviderProbeService {
  private readonly coreRpcClient: CoreRpcClient | undefined;
  private readonly positiveCacheTtlMs: number;
  private readonly negativeCacheTtlMs: number;
  private readonly cliTimeoutMs: number;
  private readonly env: Record<string, string | undefined>;
  private readonly homeDir: string;
  private readonly workspacePath: string | undefined;
  private readonly platform: NodeJS.Platform;
  private readonly now: () => number;
  private readonly customCliProbe: boolean;
  private readonly customLocateExecutable: boolean;
  private readonly refreshEnvFn: () => Promise<WindowsEnvRefreshResult | void> | void;
  private readonly cliProbeFn: (
    command: string,
    args: string[],
    timeoutMs: number,
    options?: { refresh?: boolean; deepScan?: boolean },
  ) => Promise<CliProbeResult>;
  private readonly locateExecutableFn: (
    command: string,
    env: Record<string, string | undefined>,
    platform: NodeJS.Platform,
  ) => string | null;
  private readonly serverAuthResolver:
    | (() => Promise<Partial<Record<string, ServerProviderAuthMetadata>>>)
    | undefined;
  private configuredProvidersSource:
    | readonly string[]
    | (() => readonly string[] | null | undefined)
    | undefined;

  private readonly cache = new Map<
    string,
    { snapshot: PrismuxProviderProbeSnapshot; expiresAt: number }
  >();
  private lastServerAuthByProvider = new Map<string, ServerProviderAuthMetadata>();
  private inflightServerAuthFetch: Promise<Map<string, ServerProviderAuthMetadata>> | null = null;
  private serverAuthFetchedAt = 0;
  private serverAuthBackoffUntil = 0;

  constructor(options: PrismuxProviderProbeServiceOptions = {}) {
    this.coreRpcClient = options.coreRpcClient;
    if (options.cacheTtlMs !== undefined) {
      const uniform = Math.max(0, options.cacheTtlMs);
      this.positiveCacheTtlMs = Math.max(0, options.positiveCacheTtlMs ?? uniform);
      this.negativeCacheTtlMs = Math.max(0, options.negativeCacheTtlMs ?? uniform);
    } else {
      this.positiveCacheTtlMs = Math.max(
        0,
        options.positiveCacheTtlMs ?? CLI_DISCOVERY_POSITIVE_TTL_MS,
      );
      this.negativeCacheTtlMs = Math.max(
        0,
        options.negativeCacheTtlMs ?? CLI_DISCOVERY_NEGATIVE_TTL_MS,
      );
    }
    this.cliTimeoutMs = Math.max(200, options.cliTimeoutMs ?? DEFAULT_DIAGNOSTICS_CLI_TIMEOUT_MS);
    this.env = options.env ?? process.env;
    this.homeDir = options.homeDir ?? homedir();
    this.workspacePath = options.workspacePath;
    this.platform = options.platform ?? process.platform;
    this.now = options.now ?? (() => Date.now());
    this.configuredProvidersSource = options.configuredProviders;
    this.customCliProbe = options.cliProbe !== undefined;
    this.customLocateExecutable = options.locateExecutable !== undefined;
    this.refreshEnvFn =
      options.refreshEnv ??
      (() =>
        refreshWindowsEnvironmentFromRegistry({
          targetEnv: this.env,
          platform: this.platform,
        }));
    this.cliProbeFn = options.cliProbe
      ? (command, args, timeoutMs) => options.cliProbe!(command, args, timeoutMs)
      : (command, args, timeoutMs, probeOpts) =>
          defaultCliProbe(command, args, timeoutMs, {
            env: this.env,
            platform: this.platform,
            refresh: probeOpts?.refresh === true,
            deepScan: probeOpts?.deepScan === true,
          });
    this.locateExecutableFn =
      options.locateExecutable ??
      ((command, env, platform) => {
        const direct = findExecutableOnPath([command], {
          env,
          platform,
          extraDirs: getDefaultCliExtraDirs(env, platform, this.homeDir),
        });
        if (direct) {
          return direct;
        }
        const normalizedCommand = command.trim().toLowerCase();
        if (normalizedCommand === "dsh") {
          return findPackagedDshDesktopCli(env, platform, this.homeDir)?.executablePath ?? null;
        }
        if (normalizedCommand === "agy") {
          return findPackagedAntigravityCli(env, platform, this.homeDir);
        }
        return null;
      });
    this.serverAuthResolver = options.serverAuthResolver;
  }

  setConfiguredProviders(providers: readonly string[] | null): void {
    this.configuredProvidersSource = providers ?? undefined;
  }

  private resolveConfiguredProviderIds(): string[] | null {
    const raw =
      typeof this.configuredProvidersSource === "function"
        ? this.configuredProvidersSource()
        : this.configuredProvidersSource;
    if (raw === undefined || raw === null) {
      return null;
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of raw) {
      const canonical = canonicalizeProbeProviderId(item);
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      out.push(canonical);
    }
    return out;
  }

  hasCustomCliProbe(): boolean {
    return this.customCliProbe;
  }

  clearCache(): void {
    this.cache.clear();
    this.serverAuthFetchedAt = 0;
    this.serverAuthBackoffUntil = 0;
    if (!this.customCliProbe) {
      clearCliDiscoveryCaches();
    }
  }

  getProviderSpec(providerId: string): ProviderProbeSpec | undefined {
    const canonical = canonicalizeProbeProviderId(providerId);
    return PRISMUX_PROBE_PROVIDER_SPECS.find((s) => s.providerId === canonical);
  }

  getCachedSnapshot(providerId: string): PrismuxProviderProbeSnapshot | null {
    const canonical = canonicalizeProbeProviderId(providerId);
    const entry = this.cache.get(canonical);
    if (!entry) {
      return null;
    }
    if (this.now() >= entry.expiresAt) {
      this.cache.delete(canonical);
      return null;
    }
    return entry.snapshot;
  }

  /**
   * Pure-FS zero-subprocess executable locator (<10ms; never runs `reg.exe` or CLI processes).
   */
  locateProviderExecutableFast(
    providerId: string,
    overrideEnv?: Record<string, string | undefined>,
    overridePlatform?: NodeJS.Platform,
  ): string | null {
    const spec = this.getProviderSpec(providerId);
    if (!spec) {
      return null;
    }
    if (this.customLocateExecutable) {
      return this.locateExecutableFn(
        spec.command,
        overrideEnv ?? this.env,
        overridePlatform ?? this.platform,
      );
    }
    return locateCliBinaryFastSync(spec.command, {
      env: overrideEnv ?? this.env,
      platform: overridePlatform ?? this.platform,
      homeDir: this.homeDir,
    });
  }

  /**
   * Pure-FS zero-subprocess snapshot fallback used when diagnostics safety timers trigger.
   * Never spawns `reg.exe` or any CLI subprocess.
   */
  getFastFallbackSnapshotSync(providerId: string): PrismuxProviderProbeSnapshot {
    const canonical = canonicalizeProbeProviderId(providerId);
    const cached = this.getCachedSnapshot(canonical);
    if (cached) {
      return cached;
    }
    const spec = this.getProviderSpec(canonical);
    const binaryPath = spec ? this.locateProviderExecutableFast(canonical) : null;
    const installed = canonical === "local" ? true : binaryPath !== null;
    const version =
      canonical === "dsh" && installed
        ? resolveDshInstalledVersionFastSync({
            binaryPath,
            env: this.env,
            platform: this.platform,
            homeDir: this.homeDir,
          })
        : null;
    const serverAuth = this.lastServerAuthByProvider.get(canonical) ?? null;
    const classification = classifyProviderAuth({
      providerId: canonical,
      installed,
      binaryPath,
      env: this.env,
      homeDir: this.homeDir,
      workspacePath: this.workspacePath,
      platform: this.platform,
      serverAuth,
    });
    const status: ProviderProbeStatus = !installed
      ? "not_installed"
      : classification.explicitlyUnauthenticated
        ? "unauthenticated"
        : "ready";

    return {
      providerId: canonical,
      displayName: spec?.displayName ?? canonical,
      installed,
      version,
      binaryPath,
      status,
      authMode: classification.authMode,
      authSource: classification.authSource,
      endpoint: classification.endpoint,
      authLabel: classification.authLabel,
      checkedAt: new Date(this.now()).toISOString(),
    };
  }

  /**
   * Synchronous zero-subprocess executable locator (used by OfficialQuotaService and sync guards).
   */
  locateProviderExecutable(
    providerId: string,
    overrideEnv?: Record<string, string | undefined>,
    overridePlatform?: NodeJS.Platform,
  ): string | null {
    const spec = this.getProviderSpec(providerId);
    if (!spec) {
      return null;
    }
    return this.locateExecutableFn(
      spec.command,
      overrideEnv ?? this.env,
      overridePlatform ?? this.platform,
    );
  }

  /**
   * Fast synchronous classification using cache + env + non-secret config files + cached server metadata.
   */
  getCachedOrClassifySync(
    providerId: string,
    overrides?: {
      serverAuth?: ServerProviderAuthMetadata | null;
      launchCommand?: string | null;
    },
  ): PrismuxProviderProbeSnapshot {
    const canonical = canonicalizeProbeProviderId(providerId);
    if (!overrides) {
      const cached = this.getCachedSnapshot(canonical);
      if (cached) {
        return cached;
      }
    }
    const spec = this.getProviderSpec(canonical);
    const binaryPath = spec ? this.locateProviderExecutable(canonical) : null;
    const installed = canonical === "local" ? true : binaryPath !== null;
    const serverAuth =
      overrides?.serverAuth !== undefined
        ? overrides.serverAuth
        : (this.lastServerAuthByProvider.get(canonical) ?? null);
    const classification = classifyProviderAuth({
      providerId: canonical,
      installed,
      binaryPath,
      launchCommand: overrides?.launchCommand,
      env: this.env,
      homeDir: this.homeDir,
      workspacePath: this.workspacePath,
      platform: this.platform,
      serverAuth,
    });
    const status: ProviderProbeStatus = !installed
      ? "not_installed"
      : classification.explicitlyUnauthenticated
        ? "unauthenticated"
        : "ready";

    return {
      providerId: canonical,
      displayName: spec?.displayName ?? canonical,
      installed,
      version: null,
      binaryPath,
      status,
      authMode: classification.authMode,
      authSource: classification.authSource,
      endpoint: classification.endpoint,
      authLabel: classification.authLabel,
      checkedAt: new Date(this.now()).toISOString(),
    };
  }

  async probeProvider(
    providerId: string,
    options: {
      refresh?: boolean;
      timeoutMs?: number;
      serverAuth?: ServerProviderAuthMetadata | null;
      skipEnvRefresh?: boolean;
      deepScan?: boolean;
    } = {},
  ): Promise<PrismuxProviderProbeSnapshot> {
    const canonical = canonicalizeProbeProviderId(providerId);
    if (!options.refresh && !options.deepScan && options.serverAuth === undefined) {
      const cached = this.getCachedSnapshot(canonical);
      if (cached) {
        return cached;
      }
    }

    if (options.refresh && !options.skipEnvRefresh) {
      if (!this.customCliProbe) {
        clearCliDiscoveryCaches();
      }
      try {
        await this.refreshEnvFn();
      } catch {
        // Environment refresh failures are non-fatal.
      }
    }

    const effectiveTimeoutMs = options.timeoutMs ?? this.cliTimeoutMs;
    const spec = this.getProviderSpec(canonical);

    // Rule A: Pure-FS binary presence check BEFORE any Core RPC or subprocess spawn.
    // Uninstalled CLIs immediately return `not_installed` (<10ms, 0 spawns) without
    // ever blocking on `fetchServerAuthMap()` or spawning a `--version` process.
    if (!this.customCliProbe && spec !== undefined) {
      const precheckStarted = performance.now();
      const installedPath = await this.locateBinaryBeforeProbeAsync(spec, {
        refresh: options.refresh === true,
        deepScan: options.deepScan === true,
      });
      if (installedPath === null) {
        const latencyMs = Math.max(0, Math.round(performance.now() - precheckStarted));
        const serverAuth =
          options.serverAuth !== undefined
            ? options.serverAuth
            : this.serverAuthResolver
              ? ((await this.fetchServerAuthMap(effectiveTimeoutMs)).get(canonical) ?? null)
              : null;
        return this.finalizeProbeSnapshot(
          spec,
          {
            found: false,
            path: null,
            version: null,
            latencyMs,
            error: `PATH 中未找到 ${spec.command}`,
          },
          serverAuth,
        );
      }
    }

    const serverAuthMap =
      options.serverAuth !== undefined
        ? new Map<string, ServerProviderAuthMetadata>(
            options.serverAuth ? [[canonical, options.serverAuth]] : [],
          )
        : await this.fetchServerAuthMap(effectiveTimeoutMs);

    return this.probeSingleWithServerAuth(
      canonical,
      serverAuthMap.get(canonical) ?? null,
      effectiveTimeoutMs,
      {
        refresh: options.refresh === true,
        deepScan: options.deepScan === true,
      },
    );
  }

  async probeAll(
    options: {
      provider?: string | null;
      providers?: readonly string[] | null;
      includeAll?: boolean;
      refresh?: boolean;
      deepScan?: boolean;
      timeoutMs?: number;
    } = {},
  ): Promise<PrismuxProviderProbeResponse> {
    const refresh = options.refresh === true;
    const deepScan = options.deepScan === true;
    const providerFilter = options.provider?.trim();
    const targetSpecs: readonly ProviderProbeSpec[] = providerFilter
      ? (() => {
          const canonical = canonicalizeProbeProviderId(providerFilter);
          const matched = PRISMUX_PROBE_PROVIDER_SPECS.find((s) => s.providerId === canonical);
          return matched ? [matched] : [];
        })()
      : options.includeAll === true
        ? PRISMUX_PROBE_PROVIDER_SPECS
        : (() => {
            const scoped =
              options.providers !== undefined && options.providers !== null
                ? options.providers.map(canonicalizeProbeProviderId).filter(Boolean)
                : this.resolveConfiguredProviderIds();
            if (scoped === null) {
              return PRISMUX_PROBE_PROVIDER_SPECS;
            }
            const allowed = new Set(scoped);
            return PRISMUX_PROBE_PROVIDER_SPECS.filter((s) => allowed.has(s.providerId));
          })();

    if (targetSpecs.length === 0) {
      const canonical = providerFilter ? canonicalizeProbeProviderId(providerFilter) : "";
      if (canonical === "local") {
        const localSnap = this.getCachedOrClassifySync("local");
        return {
          ok: true,
          generatedAt: new Date(this.now()).toISOString(),
          providers: [localSnap],
        };
      }
      return {
        ok: true,
        generatedAt: new Date(this.now()).toISOString(),
        providers: [],
      };
    }

    if (refresh) {
      if (!this.customCliProbe) {
        clearCliDiscoveryCaches();
      }
      try {
        await this.refreshEnvFn();
      } catch {
        // Environment refresh failures are non-fatal.
      }
    }

    const timeoutMs = options.timeoutMs ?? this.cliTimeoutMs;

    // Rule A: Pre-filter presence in pure FS before fetching server auth or spawning CLIs.
    const precheckedBinaryById = new Map<string, string | null>();
    if (!this.customCliProbe) {
      await Promise.all(
        targetSpecs.map(async (spec) => {
          if (!refresh && !deepScan && this.getCachedSnapshot(spec.providerId) !== null) {
            return;
          }
          const foundPath = await this.locateBinaryBeforeProbeAsync(spec, {
            refresh,
            deepScan,
          });
          precheckedBinaryById.set(spec.providerId, foundPath);
        }),
      );
    }

    const needServerAuth = targetSpecs.some((spec) => {
      if (!refresh && !deepScan && this.getCachedSnapshot(spec.providerId) !== null) {
        return false;
      }
      if (this.customCliProbe || this.serverAuthResolver) {
        return true;
      }
      return precheckedBinaryById.get(spec.providerId) !== null;
    });
    const serverAuthMap = needServerAuth
      ? await this.fetchServerAuthMap(timeoutMs)
      : this.lastServerAuthByProvider;

    const results = new Array<PrismuxProviderProbeSnapshot>(targetSpecs.length);
    let nextIndex = 0;
    const workerCount = Math.min(PROBE_ALL_CONCURRENCY_LIMIT, targetSpecs.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const current = nextIndex;
        nextIndex += 1;
        if (current >= targetSpecs.length) break;
        const spec = targetSpecs[current]!;
        if (!refresh && !deepScan) {
          const cached = this.getCachedSnapshot(spec.providerId);
          if (cached) {
            results[current] = cached;
            continue;
          }
        }
        if (
          !this.customCliProbe &&
          precheckedBinaryById.has(spec.providerId) &&
          precheckedBinaryById.get(spec.providerId) === null
        ) {
          results[current] = this.finalizeProbeSnapshot(
            spec,
            {
              found: false,
              path: null,
              version: null,
              latencyMs: 0,
              error: `PATH 中未找到 ${spec.command}`,
            },
            serverAuthMap.get(spec.providerId) ?? null,
          );
          continue;
        }
        results[current] = await this.probeSingleWithServerAuth(
          spec.providerId,
          serverAuthMap.get(spec.providerId) ?? null,
          timeoutMs,
          { refresh, deepScan },
        );
      }
    });
    await Promise.all(workers);

    return {
      ok: true,
      generatedAt: new Date(this.now()).toISOString(),
      providers: results,
    };
  }

  private async locateBinaryBeforeProbeAsync(
    spec: ProviderProbeSpec,
    options: { refresh?: boolean; deepScan?: boolean },
  ): Promise<string | null> {
    const fast = this.locateProviderExecutableFast(spec.providerId);
    if (fast !== null) {
      return fast;
    }
    if (this.customLocateExecutable) {
      return null;
    }
    if (spec.providerId === "antigravity") {
      return findPackagedAntigravityCliAsync(this.env, this.platform, this.homeDir, {
        deepScan: options.deepScan === true,
        bypassCache: options.refresh === true,
      });
    }
    if (spec.providerId === "dsh") {
      const packaged = await findPackagedDshDesktopCliAsync(this.env, this.platform, this.homeDir, {
        deepScan: options.deepScan === true,
        bypassCache: options.refresh === true,
      });
      return packaged?.executablePath ?? null;
    }
    return null;
  }

  private async fetchServerAuthMap(
    timeoutMs: number = this.cliTimeoutMs,
  ): Promise<Map<string, ServerProviderAuthMetadata>> {
    if (this.serverAuthResolver) {
      const map = new Map<string, ServerProviderAuthMetadata>();
      try {
        const resolved = await this.serverAuthResolver();
        for (const [rawId, meta] of Object.entries(resolved)) {
          if (meta) {
            map.set(canonicalizeProbeProviderId(rawId), meta);
          }
        }
        this.lastServerAuthByProvider = map;
        return map;
      } catch {
        return this.lastServerAuthByProvider;
      }
    }

    const coreRpc = this.coreRpcClient;
    if (!coreRpc?.isConnected()) {
      return new Map<string, ServerProviderAuthMetadata>();
    }
    if (
      typeof coreRpc.isLegacyMethodAvailable === "function" &&
      !coreRpc.isLegacyMethodAvailable("provider.list")
    ) {
      return this.lastServerAuthByProvider;
    }

    const nowMs = this.now();
    if (nowMs < this.serverAuthBackoffUntil) {
      return this.lastServerAuthByProvider;
    }
    if (
      this.serverAuthFetchedAt > 0 &&
      nowMs - this.serverAuthFetchedAt < SERVER_AUTH_SUCCESS_TTL_MS
    ) {
      return this.lastServerAuthByProvider;
    }
    if (this.inflightServerAuthFetch !== null) {
      return this.inflightServerAuthFetch;
    }

    const rpcTimeoutMs = Math.min(
      SERVER_AUTH_RPC_TIMEOUT_MS,
      Math.max(150, Math.floor(timeoutMs / 4)),
    );

    const run = (async (): Promise<Map<string, ServerProviderAuthMetadata>> => {
      const map = new Map<string, ServerProviderAuthMetadata>();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const listPromise = coreRpc.listProviders(rpcTimeoutMs);
        // Prevent late timeouts from custom mock clients from triggering UnhandledPromiseRejection.
        listPromise.catch(() => undefined);
        const list = await Promise.race<CoreProviderSummary[] | null>([
          listPromise,
          new Promise<null>((resolveTimeout) => {
            timer = setTimeout(() => resolveTimeout(null), rpcTimeoutMs + 50);
          }),
        ]);
        if (list === null) {
          this.serverAuthBackoffUntil = this.now() + SERVER_AUTH_FAILURE_BACKOFF_MS;
          return this.lastServerAuthByProvider;
        }
        for (const item of list) {
          const canonical = canonicalizeProbeProviderId(item.id);
          const meta = extractServerAuthFromSummary(item);
          if (meta) {
            map.set(canonical, meta);
          }
        }
        this.lastServerAuthByProvider = map;
        this.serverAuthFetchedAt = this.now();
        this.serverAuthBackoffUntil = 0;
        return map;
      } catch {
        this.serverAuthBackoffUntil = this.now() + SERVER_AUTH_FAILURE_BACKOFF_MS;
        return this.lastServerAuthByProvider;
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      }
    })().finally(() => {
      if (this.inflightServerAuthFetch === run) {
        this.inflightServerAuthFetch = null;
      }
    });

    this.inflightServerAuthFetch = run;
    return run;
  }

  private async probeSingleWithServerAuth(
    canonicalProviderId: string,
    serverAuth: ServerProviderAuthMetadata | null,
    timeoutMs: number,
    probeOpts?: { refresh?: boolean; deepScan?: boolean },
  ): Promise<PrismuxProviderProbeSnapshot> {
    const spec = this.getProviderSpec(canonicalProviderId);
    if (!spec) {
      return this.getCachedOrClassifySync(canonicalProviderId, { serverAuth });
    }

    const cliResult = await this.cliProbeFn(spec.command, [...spec.args], timeoutMs, probeOpts);
    return this.finalizeProbeSnapshot(spec, cliResult, serverAuth);
  }

  private finalizeProbeSnapshot(
    spec: ProviderProbeSpec,
    cliResult: CliProbeResult,
    serverAuth: ServerProviderAuthMetadata | null,
  ): PrismuxProviderProbeSnapshot {
    const installed = cliResult.found;
    const binaryPath = cliResult.path ?? null;
    let version = cliResult.version ?? null;
    let cliError = cliResult.error ?? null;
    if (spec.providerId === "dsh" && installed && (!version || isPlaceholderDshVersion(version))) {
      const resolvedDshVersion = resolveDshInstalledVersionFastSync({
        binaryPath,
        env: this.env,
        platform: this.platform,
        homeDir: this.homeDir,
      });
      if (resolvedDshVersion) {
        version = resolvedDshVersion;
        if (!cliResult.version && cliError) {
          cliError = null;
        }
      }
    }

    const classification = classifyProviderAuth({
      providerId: spec.providerId,
      installed,
      binaryPath,
      env: this.env,
      homeDir: this.homeDir,
      workspacePath: this.workspacePath,
      platform: this.platform,
      serverAuth,
    });

    // Rule B: If the CLI binary is confirmed present on disk and auth mode is resolved,
    // a slow `--version` timeout degrades gracefully to `ready` (instead of false degraded
    // failure), while genuine non-timeout launch/exit crashes remain `degraded`.
    const gracefulSlowVersion =
      installed && binaryPath !== null && cliResult.timedOut === true && !version;
    if (gracefulSlowVersion) {
      cliError = null;
    }

    let status: ProviderProbeStatus;
    if (!installed) {
      status = "not_installed";
    } else if (!gracefulSlowVersion && (!version || cliError)) {
      status = "degraded";
    } else if (classification.explicitlyUnauthenticated) {
      status = "unauthenticated";
    } else {
      status = "ready";
    }

    const checkedAtMs = this.now();
    const snapshot: PrismuxProviderProbeSnapshot = {
      providerId: spec.providerId,
      displayName: spec.displayName,
      installed,
      version,
      binaryPath,
      status,
      authMode: classification.authMode,
      authSource: classification.authSource,
      endpoint: classification.endpoint,
      authLabel: classification.authLabel,
      checkedAt: new Date(checkedAtMs).toISOString(),
      ...(cliError ? { error: cliError } : {}),
      latencyMs: cliResult.latencyMs,
    };

    const ttlMs = gracefulSlowVersion
      ? Math.min(this.negativeCacheTtlMs, TIMED_OUT_INSTALLED_CACHE_TTL_MS)
      : installed && !cliError
        ? this.positiveCacheTtlMs
        : this.negativeCacheTtlMs;
    if (ttlMs > 0) {
      this.cache.set(spec.providerId, {
        snapshot,
        expiresAt: checkedAtMs + ttlMs,
      });
    }

    return snapshot;
  }
}
