export const PROVIDER_AUTH_MODES = [
  "api_or_custom",
  "subscription_oauth",
  "local",
  "unauthenticated",
] as const;

export type ProviderAuthMode = (typeof PROVIDER_AUTH_MODES)[number];

export const PROVIDER_AUTH_SOURCES = [
  "env",
  "cli_config",
  "custom_endpoint",
  "ccs_or_magpie",
  "official_oauth",
  "cloud_iam",
  "local_runtime",
  "none",
] as const;

export type ProviderAuthSource = (typeof PROVIDER_AUTH_SOURCES)[number];

export const PROVIDER_PROBE_STATUSES = [
  "ready",
  "degraded",
  "not_installed",
  "unauthenticated",
] as const;

export type ProviderProbeStatus = (typeof PROVIDER_PROBE_STATUSES)[number];

export interface PrismuxProviderProbeSnapshot {
  providerId: string;
  displayName: string;
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  status: ProviderProbeStatus;
  authMode: ProviderAuthMode;
  authSource: ProviderAuthSource;
  endpoint: string | null;
  authLabel: string;
  checkedAt: string;
  error?: string | null;
  latencyMs?: number;
}

export interface PrismuxProviderProbeResponse {
  ok: true;
  generatedAt: string;
  providers: PrismuxProviderProbeSnapshot[];
}

export function isProviderAuthMode(value: unknown): value is ProviderAuthMode {
  return typeof value === "string" && (PROVIDER_AUTH_MODES as readonly string[]).includes(value);
}

export function isProviderAuthSource(value: unknown): value is ProviderAuthSource {
  return typeof value === "string" && (PROVIDER_AUTH_SOURCES as readonly string[]).includes(value);
}

export const CANONICAL_PROVIDER_DISPLAY_NAMES = {
  antigravity: "Antigravity",
  claudeAgent: "Claude",
  "claude-code": "Claude",
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  dsh: "DeepSeek Harness",
  gemini: "Gemini CLI",
  grok: "Grok",
  kiro: "Kiro",
  muse: "Muse Code",
  opencode: "OpenCode",
  pi: "Pi",
} as const;

const PROTOCOL_PROVIDER_DISPLAY_ALIASES: Readonly<Record<string, string>> = {
  antigravity: CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity,
  "antigravity-cli": CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity,
  antigravity_cli: CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity,
  "antigravity-acp": CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity,
  antigravity_acp: CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity,
  "google-antigravity": CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity,
  google_antigravity: CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity,
  agy: CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity,
  claudeagent: CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent,
  "claude-agent": CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent,
  claude_agent: CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent,
  "claude-code": CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent,
  claude_code: CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent,
  claudecode: CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent,
  "claude code": CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent,
  claude: CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent,
  cc: CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent,
  codex: CANONICAL_PROVIDER_DISPLAY_NAMES.codex,
  "openai-codex": CANONICAL_PROVIDER_DISPLAY_NAMES.codex,
  openai_codex: CANONICAL_PROVIDER_DISPLAY_NAMES.codex,
  cursor: CANONICAL_PROVIDER_DISPLAY_NAMES.cursor,
  "cursor-cli": CANONICAL_PROVIDER_DISPLAY_NAMES.cursor,
  "cursor-agent": CANONICAL_PROVIDER_DISPLAY_NAMES.cursor,
  dsh: CANONICAL_PROVIDER_DISPLAY_NAMES.dsh,
  "dsh-acp": CANONICAL_PROVIDER_DISPLAY_NAMES.dsh,
  "dsh-next": CANONICAL_PROVIDER_DISPLAY_NAMES.dsh,
  "deepseek-harness": CANONICAL_PROVIDER_DISPLAY_NAMES.dsh,
  deepseek_harness: CANONICAL_PROVIDER_DISPLAY_NAMES.dsh,
  "deepseek harness": CANONICAL_PROVIDER_DISPLAY_NAMES.dsh,
  gemini: CANONICAL_PROVIDER_DISPLAY_NAMES.gemini,
  "gemini-cli": CANONICAL_PROVIDER_DISPLAY_NAMES.gemini,
  gemini_cli: CANONICAL_PROVIDER_DISPLAY_NAMES.gemini,
  "gemini cli": CANONICAL_PROVIDER_DISPLAY_NAMES.gemini,
  grok: CANONICAL_PROVIDER_DISPLAY_NAMES.grok,
  kiro: CANONICAL_PROVIDER_DISPLAY_NAMES.kiro,
  muse: CANONICAL_PROVIDER_DISPLAY_NAMES.muse,
  opencode: CANONICAL_PROVIDER_DISPLAY_NAMES.opencode,
  "open-code": CANONICAL_PROVIDER_DISPLAY_NAMES.opencode,
  open_code: CANONICAL_PROVIDER_DISPLAY_NAMES.opencode,
  pi: CANONICAL_PROVIDER_DISPLAY_NAMES.pi,
  "pi-coding-agent": CANONICAL_PROVIDER_DISPLAY_NAMES.pi,
};

/**
 * Resolves any provider ID or alias into Prismux's authoritative user-facing default display name
 * (e.g. `claudeAgent` / `claude-code` -> `"Claude"`, `codex` -> `"Codex"`, `dsh` -> `"DeepSeek Harness"`).
 */
export function resolveCanonicalProviderDisplayName(
  providerIdOrAlias: string | null | undefined,
  fallbackDisplayName?: string | null,
): string {
  const custom = typeof fallbackDisplayName === "string" ? fallbackDisplayName.trim() : "";
  if (custom.length > 0) {
    const customAlias = PROTOCOL_PROVIDER_DISPLAY_ALIASES[custom.toLowerCase()];
    return customAlias ?? custom;
  }
  const raw = typeof providerIdOrAlias === "string" ? providerIdOrAlias.trim() : "";
  if (!raw) return "Agent";
  const exact = PROTOCOL_PROVIDER_DISPLAY_ALIASES[raw.toLowerCase()];
  return exact ?? raw;
}

export function isProviderProbeStatus(value: unknown): value is ProviderProbeStatus {
  return (
    typeof value === "string" && (PROVIDER_PROBE_STATUSES as readonly string[]).includes(value)
  );
}
