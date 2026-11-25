import {
  containsUuidNoise,
  providerInstanceInitials,
  stripUuidNoise,
} from "@prismux/client-runtime/state/provider-instance-display";
import { createElement, memo, useEffect, useId, type CSSProperties, type ReactElement } from "react";

export { containsUuidNoise, stripUuidNoise };

export type AgentBrandId =
  | "codex"
  | "claude-code"
  | "antigravity"
  | "gemini"
  | "opencode"
  | "pi"
  | "cursor"
  | "dsh"
  | "glm"
  | "qwen"
  | "kimi"
  | "github-copilot"
  | "mistral-vibe"
  | "factory-droid"
  | "cline"
  | "goose"
  | "auggie"
  | "devin"
  | "kiro"
  | "openhands"
  | "hermes"
  | "minimax"
  | "grok"
  | "kilo"
  | "junie"
  | "amp"
  | "codebuddy"
  | "muse"
  | "acp"
  | "custom";

export type AcpAgentBrandKey =
  | "glm"
  | "dsh"
  | "antigravity"
  | "claude"
  | "codex"
  | "gemini"
  | "qwen"
  | "kimi"
  | "github-copilot"
  | "mistral-vibe"
  | "opencode"
  | "pi"
  | "factory-droid"
  | "cline"
  | "goose"
  | "auggie"
  | "devin"
  | "kiro"
  | "openhands"
  | "hermes"
  | "minimax"
  | "cursor"
  | "grok"
  | "kilo"
  | "junie"
  | "amp"
  | "codebuddy"
  | "muse";

export interface AgentBrandMeta {
  readonly id: AgentBrandId;
  readonly displayName: string;
  readonly canonicalProviderId: string;
  readonly accentColor: string;
  readonly glowColor: string;
}

export const GLM_BRAND_COLOR = "#3B82F6";
export const QWEN_BRAND_COLOR = "#6366F1";
export const MISTRAL_BRAND_COLOR = "#FA520F";
export const DEVIN_BRAND_COLOR = "#10B981";
export const KIRO_BRAND_COLOR = "#8B5CF6";
export const MINIMAX_BRAND_COLOR = "#F43F5E";
export const OPENHANDS_BRAND_COLOR = "#F59E0B";
export const JUNIE_BRAND_COLOR = "#22C55E";
export const AMP_BRAND_COLOR = "#F34E3F";

const CANONICAL_BRAND_META: Readonly<Record<Exclude<AgentBrandId, "custom">, AgentBrandMeta>> = {
  codex: {
    id: "codex",
    displayName: "Codex",
    canonicalProviderId: "codex",
    accentColor: "currentColor",
    glowColor: "rgba(52, 211, 153, 0.52)",
  },
  "claude-code": {
    id: "claude-code",
    displayName: "Claude Code",
    canonicalProviderId: "claude-code",
    accentColor: "#d97757",
    glowColor: "rgba(217, 119, 87, 0.62)",
  },
  antigravity: {
    id: "antigravity",
    displayName: "Antigravity",
    canonicalProviderId: "antigravity",
    accentColor: "#4285F4",
    glowColor: "rgba(66, 133, 244, 0.58)",
  },
  gemini: {
    id: "gemini",
    displayName: "Gemini CLI",
    canonicalProviderId: "gemini",
    accentColor: "#4f8df9",
    glowColor: "rgba(79, 141, 249, 0.60)",
  },
  opencode: {
    id: "opencode",
    displayName: "OpenCode",
    canonicalProviderId: "opencode",
    accentColor: "currentColor",
    glowColor: "rgba(148, 163, 184, 0.56)",
  },
  pi: {
    id: "pi",
    displayName: "Pi",
    canonicalProviderId: "pi",
    accentColor: "currentColor",
    glowColor: "rgba(148, 163, 184, 0.56)",
  },
  cursor: {
    id: "cursor",
    displayName: "Cursor",
    canonicalProviderId: "cursor",
    accentColor: "currentColor",
    glowColor: "rgba(148, 163, 184, 0.56)",
  },
  dsh: {
    id: "dsh",
    displayName: "DeepSeek Harness",
    canonicalProviderId: "dsh",
    accentColor: "#4176E6",
    glowColor: "rgba(65, 118, 230, 0.58)",
  },
  glm: {
    id: "glm",
    displayName: "GLM Agent",
    canonicalProviderId: "glm-acp-agent",
    accentColor: GLM_BRAND_COLOR,
    glowColor: "rgba(59, 130, 246, 0.58)",
  },
  qwen: {
    id: "qwen",
    displayName: "Qwen Code",
    canonicalProviderId: "qwen-code",
    accentColor: QWEN_BRAND_COLOR,
    glowColor: "rgba(99, 102, 241, 0.58)",
  },
  kimi: {
    id: "kimi",
    displayName: "Kimi Code",
    canonicalProviderId: "kimi-code",
    accentColor: "currentColor",
    glowColor: "rgba(148, 163, 184, 0.56)",
  },
  "github-copilot": {
    id: "github-copilot",
    displayName: "GitHub Copilot",
    canonicalProviderId: "github-copilot-cli",
    accentColor: "currentColor",
    glowColor: "rgba(148, 163, 184, 0.56)",
  },
  "mistral-vibe": {
    id: "mistral-vibe",
    displayName: "Mistral Vibe",
    canonicalProviderId: "mistral-vibe",
    accentColor: MISTRAL_BRAND_COLOR,
    glowColor: "rgba(250, 82, 15, 0.58)",
  },
  "factory-droid": {
    id: "factory-droid",
    displayName: "Factory Droid",
    canonicalProviderId: "factory-droid",
    accentColor: "currentColor",
    glowColor: "rgba(148, 163, 184, 0.56)",
  },
  cline: {
    id: "cline",
    displayName: "Cline",
    canonicalProviderId: "cline",
    accentColor: "currentColor",
    glowColor: "rgba(148, 163, 184, 0.56)",
  },
  goose: {
    id: "goose",
    displayName: "Goose",
    canonicalProviderId: "goose",
    accentColor: "currentColor",
    glowColor: "rgba(148, 163, 184, 0.56)",
  },
  auggie: {
    id: "auggie",
    displayName: "Auggie",
    canonicalProviderId: "auggie",
    accentColor: "currentColor",
    glowColor: "rgba(148, 163, 184, 0.56)",
  },
  devin: {
    id: "devin",
    displayName: "Devin",
    canonicalProviderId: "devin",
    accentColor: DEVIN_BRAND_COLOR,
    glowColor: "rgba(16, 185, 129, 0.58)",
  },
  kiro: {
    id: "kiro",
    displayName: "Kiro",
    canonicalProviderId: "kiro",
    accentColor: KIRO_BRAND_COLOR,
    glowColor: "rgba(139, 92, 246, 0.58)",
  },
  openhands: {
    id: "openhands",
    displayName: "OpenHands",
    canonicalProviderId: "openhands",
    accentColor: OPENHANDS_BRAND_COLOR,
    glowColor: "rgba(245, 158, 11, 0.58)",
  },
  hermes: {
    id: "hermes",
    displayName: "Hermes Agent",
    canonicalProviderId: "hermes-agent",
    accentColor: "currentColor",
    glowColor: "rgba(148, 163, 184, 0.56)",
  },
  minimax: {
    id: "minimax",
    displayName: "MiniMax Code",
    canonicalProviderId: "minimax-code",
    accentColor: MINIMAX_BRAND_COLOR,
    glowColor: "rgba(244, 63, 94, 0.58)",
  },
  grok: {
    id: "grok",
    displayName: "Grok",
    canonicalProviderId: "grok-build",
    accentColor: "currentColor",
    glowColor: "rgba(148, 163, 184, 0.56)",
  },
  kilo: {
    id: "kilo",
    displayName: "Kilo",
    canonicalProviderId: "kilo",
    accentColor: "currentColor",
    glowColor: "rgba(148, 163, 184, 0.56)",
  },
  junie: {
    id: "junie",
    displayName: "Junie",
    canonicalProviderId: "junie",
    accentColor: JUNIE_BRAND_COLOR,
    glowColor: "rgba(34, 197, 94, 0.58)",
  },
  amp: {
    id: "amp",
    displayName: "Amp",
    canonicalProviderId: "amp-acp",
    accentColor: AMP_BRAND_COLOR,
    glowColor: "rgba(243, 78, 63, 0.58)",
  },
  codebuddy: {
    id: "codebuddy",
    displayName: "CodeBuddy",
    canonicalProviderId: "codebuddy-code",
    accentColor: "currentColor",
    glowColor: "rgba(148, 163, 184, 0.56)",
  },
  muse: {
    id: "muse",
    displayName: "Muse Code",
    canonicalProviderId: "muse-code",
    accentColor: "currentColor",
    glowColor: "rgba(148, 163, 184, 0.56)",
  },
  acp: {
    id: "acp",
    displayName: "ACP",
    canonicalProviderId: "acp",
    accentColor: "currentColor",
    glowColor: "rgba(99, 102, 241, 0.48)",
  },
};

const KNOWN_ALIASES: Readonly<Record<string, Exclude<AgentBrandId, "custom">>> = {
  codex: "codex",
  "codex-acp": "codex",
  codex_acp: "codex",
  "codex acp": "codex",
  codexacp: "codex",
  "openai-codex": "codex",
  openai_codex: "codex",
  "openai codex": "codex",
  openaicodex: "codex",
  claude: "claude-code",
  "claude-acp": "claude-code",
  claude_acp: "claude-code",
  "claude acp": "claude-code",
  claudeacp: "claude-code",
  "claude-agent-acp": "claude-code",
  claude_agent_acp: "claude-code",
  claudeagentacp: "claude-code",
  claudeagent: "claude-code",
  "claude-agent": "claude-code",
  claude_agent: "claude-code",
  "claude agent": "claude-code",
  "claude-code": "claude-code",
  claude_code: "claude-code",
  claudecode: "claude-code",
  "claude code": "claude-code",
  antigravity: "antigravity",
  "antigravity-acp": "antigravity",
  antigravity_acp: "antigravity",
  antigravityacp: "antigravity",
  "antigravity-cli": "antigravity",
  antigravity_cli: "antigravity",
  "antigravity cli": "antigravity",
  antigravitycli: "antigravity",
  "google antigravity": "antigravity",
  googleantigravity: "antigravity",
  agy: "antigravity",
  gemini: "gemini",
  "gemini-cli": "gemini",
  gemini_cli: "gemini",
  "gemini cli": "gemini",
  geminicli: "gemini",
  "google-gemini": "gemini",
  "google gemini": "gemini",
  opencode: "opencode",
  "opencode-v2": "opencode",
  opencode_v2: "opencode",
  opencodev2: "opencode",
  "open-code": "opencode",
  open_code: "opencode",
  "open code": "opencode",
  pi: "pi",
  "pi-acp": "pi",
  pi_acp: "pi",
  "pi acp": "pi",
  piacp: "pi",
  "pi-coding-agent": "pi",
  pi_coding_agent: "pi",
  "pi coding agent": "pi",
  cursor: "cursor",
  "cursor-acp": "cursor",
  cursor_acp: "cursor",
  cursoracp: "cursor",
  "cursor-cli": "cursor",
  cursor_cli: "cursor",
  "cursor cli": "cursor",
  "cursor-agent": "cursor",
  cursor_agent: "cursor",
  "cursor agent": "cursor",
  cursoragent: "cursor",
  dsh: "dsh",
  "dsh-acp": "dsh",
  dsh_acp: "dsh",
  "dsh-cli": "dsh",
  dsh_cli: "dsh",
  "deepseek-harness": "dsh",
  deepseek_harness: "dsh",
  "deepseek harness": "dsh",
  deepseekharness: "dsh",
  "deepseek-harness-acp": "dsh",
  deepseek_harness_acp: "dsh",
  "deepseek harness (dsh)": "dsh",
  glm: "glm",
  "glm-acp": "glm",
  "glm-acp-agent": "glm",
  glm_acp_agent: "glm",
  glmacpagent: "glm",
  "glm-agent": "glm",
  "glm agent": "glm",
  glmagent: "glm",
  zhipu: "glm",
  "zhipu-glm": "glm",
  zhipuglm: "glm",
  zhipuai: "glm",
  chatglm: "glm",
  "z.ai": "glm",
  zai: "glm",
  qwen: "qwen",
  "qwen-code": "qwen",
  qwen_code: "qwen",
  "qwen code": "qwen",
  qwencode: "qwen",
  "qwen-coder": "qwen",
  "qwen coder": "qwen",
  tongyi: "qwen",
  kimi: "kimi",
  "kimi-code": "kimi",
  kimi_code: "kimi",
  "kimi code": "kimi",
  kimicode: "kimi",
  "kimi-cli": "kimi",
  "kimi cli": "kimi",
  moonshot: "kimi",
  "github-copilot": "github-copilot",
  github_copilot: "github-copilot",
  "github copilot": "github-copilot",
  githubcopilot: "github-copilot",
  "github-copilot-cli": "github-copilot",
  github_copilot_cli: "github-copilot",
  "github copilot cli": "github-copilot",
  githubcopilotcli: "github-copilot",
  copilot: "github-copilot",
  "copilot-cli": "github-copilot",
  "copilot cli": "github-copilot",
  "mistral-vibe": "mistral-vibe",
  mistral_vibe: "mistral-vibe",
  "mistral vibe": "mistral-vibe",
  mistralvibe: "mistral-vibe",
  vibe: "mistral-vibe",
  "vibe-acp": "mistral-vibe",
  "vibe acp": "mistral-vibe",
  mistral: "mistral-vibe",
  "factory-droid": "factory-droid",
  factory_droid: "factory-droid",
  "factory droid": "factory-droid",
  factorydroid: "factory-droid",
  droid: "factory-droid",
  "droid-acp": "factory-droid",
  cline: "cline",
  "cline-acp": "cline",
  "cline-cli": "cline",
  goose: "goose",
  "goose-acp": "goose",
  "goose-cli": "goose",
  auggie: "auggie",
  "auggie-cli": "auggie",
  "auggie cli": "auggie",
  augment: "auggie",
  "augment-code": "auggie",
  "augment code": "auggie",
  augmentcode: "auggie",
  devin: "devin",
  "devin-acp": "devin",
  "devin-cli": "devin",
  kiro: "kiro",
  "kiro-cli": "kiro",
  "kiro cli": "kiro",
  kirocli: "kiro",
  "kiro-acp": "kiro",
  openhands: "openhands",
  "open-hands": "openhands",
  open_hands: "openhands",
  "open hands": "openhands",
  "openhands-acp": "openhands",
  hermes: "hermes",
  "hermes-agent": "hermes",
  hermes_agent: "hermes",
  "hermes agent": "hermes",
  hermesagent: "hermes",
  "nous-hermes": "hermes",
  minimax: "minimax",
  "minimax-code": "minimax",
  minimax_code: "minimax",
  "minimax code": "minimax",
  minimaxcode: "minimax",
  "minimax-acp": "minimax",
  grok: "grok",
  "grok-build": "grok",
  grok_build: "grok",
  "grok build": "grok",
  grokbuild: "grok",
  kilo: "kilo",
  "kilo-code": "kilo",
  "kilo code": "kilo",
  kilocode: "kilo",
  junie: "junie",
  "jetbrains-junie": "junie",
  amp: "amp",
  "amp-acp": "amp",
  amp_acp: "amp",
  "amp-cli": "amp",
  "sourcegraph-amp": "amp",
  codebuddy: "codebuddy",
  "codebuddy-code": "codebuddy",
  "codebuddy code": "codebuddy",
  codebuddycode: "codebuddy",
  muse: "muse",
  "muse-code": "muse",
  "muse code": "muse",
  musecode: "muse",
  acp: "acp",
  acpregistry: "acp",
  "acp-registry": "acp",
  acp_registry: "acp",
  "acp registry": "acp",
};

const EXTRA_KNOWN_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  openaicompatible: "OpenAI Compatible",
  "openai-compatible": "OpenAI Compatible",
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  ollama: "Ollama",
};

const UPPERCASE_ACRONYMS = new Set([
  "acp",
  "ai",
  "api",
  "cli",
  "glm",
  "gpt",
  "ide",
  "llm",
  "mcp",
  "sdk",
  "ssh",
]);

function normalizeLookupKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function stripAcpPrefix(raw: string): string {
  return raw.replace(/^(?:acp[-_]?registry|local)[:/_-]+/i, "").trim();
}

function extractCommandStem(commandPath: string | null | undefined): string {
  if (!commandPath || typeof commandPath !== "string") return "";
  const trimmed = commandPath.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return "";
  const basename = trimmed.split(/[\\/]/).pop() ?? "";
  return basename.replace(/\.(?:exe|cmd|bat|sh|mjs|cjs|js|ps1|py|bin)$/i, "").trim();
}

function tokenizeIdentifier(key: string): readonly string[] {
  return key
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasAdjacentTokens(tokens: readonly string[], first: string, second: string): boolean {
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index] === first && tokens[index + 1] === second) {
      return true;
    }
  }
  return false;
}

/**
 * Matches a single candidate identifier (agentId, command stem, instanceId, or displayName)
 * against all known official agent brands, excluding the generic `"acp"` / `"custom"` buckets.
 */
function matchSpecificAgentBrand(
  rawCandidate: string | null | undefined,
): Exclude<AgentBrandId, "acp" | "custom"> | null {
  if (!rawCandidate || typeof rawCandidate !== "string") return null;
  const trimmed = rawCandidate.trim();
  if (!trimmed) return null;

  const stripped = stripAcpPrefix(trimmed);
  const candidates = stripped && stripped !== trimmed ? [stripped, trimmed] : [trimmed];

  for (const candidate of candidates) {
    const key = normalizeLookupKey(candidate);
    if (!key) continue;

    const exact = KNOWN_ALIASES[key];
    if (exact && exact !== "acp") return exact;

    const compact = key.replace(/[^a-z0-9]+/g, "");
    const compactHit = KNOWN_ALIASES[compact];
    if (compactHit && compactHit !== "acp") return compactHit;

    const tokens = tokenizeIdentifier(key);
    const tokenSet = new Set(tokens);

    if (key.startsWith("codex") || tokenSet.has("codex")) {
      return "codex";
    }
    if (key.startsWith("claude") || tokenSet.has("claude")) {
      return "claude-code";
    }
    if (
      key.startsWith("antigravity") ||
      tokenSet.has("antigravity") ||
      tokenSet.has("agy")
    ) {
      return "antigravity";
    }
    if (key.startsWith("gemini") || tokenSet.has("gemini")) {
      return "gemini";
    }
    if (
      key.startsWith("opencode") ||
      key.startsWith("open-code") ||
      tokenSet.has("opencode") ||
      hasAdjacentTokens(tokens, "open", "code")
    ) {
      return "opencode";
    }
    if (
      key === "pi" ||
      key.startsWith("pi-") ||
      key.startsWith("pi_") ||
      key.startsWith("pi:") ||
      key.startsWith("pi ")
    ) {
      return "pi";
    }
    if (key.startsWith("cursor") || tokenSet.has("cursor")) {
      return "cursor";
    }
    if (
      tokenSet.has("dsh") ||
      key.includes("deepseek-harness") ||
      key.includes("deepseek_harness") ||
      key.includes("deepseek harness") ||
      key.includes("deepseekharness")
    ) {
      return "dsh";
    }
    if (
      tokenSet.has("glm") ||
      tokenSet.has("chatglm") ||
      tokenSet.has("zhipu") ||
      tokenSet.has("zhipuai") ||
      tokenSet.has("zai") ||
      hasAdjacentTokens(tokens, "z", "ai")
    ) {
      return "glm";
    }
    if (tokenSet.has("qwen") || tokenSet.has("tongyi")) {
      return "qwen";
    }
    if (tokenSet.has("kimi") || tokenSet.has("moonshot")) {
      return "kimi";
    }
    if (tokenSet.has("copilot")) {
      return "github-copilot";
    }
    if (tokenSet.has("mistral") || tokenSet.has("vibe")) {
      return "mistral-vibe";
    }
    // Whole-token match so "android" never false-matches "droid".
    if (tokenSet.has("droid") || key.includes("factory-droid") || key.includes("factory droid")) {
      return "factory-droid";
    }
    if (tokenSet.has("cline")) {
      return "cline";
    }
    if (tokenSet.has("goose")) {
      return "goose";
    }
    if (tokenSet.has("auggie") || tokenSet.has("augment")) {
      return "auggie";
    }
    if (tokenSet.has("devin")) {
      return "devin";
    }
    if (tokenSet.has("kiro")) {
      return "kiro";
    }
    if (tokenSet.has("openhands") || hasAdjacentTokens(tokens, "open", "hands")) {
      return "openhands";
    }
    if (tokenSet.has("hermes")) {
      return "hermes";
    }
    if (tokenSet.has("minimax")) {
      return "minimax";
    }
    if (tokenSet.has("grok")) {
      return "grok";
    }
    if (tokenSet.has("kilo") || tokenSet.has("kilocode")) {
      return "kilo";
    }
    if (tokenSet.has("junie")) {
      return "junie";
    }
    if (
      key === "amp" ||
      key.startsWith("amp-") ||
      key.startsWith("amp_") ||
      key === "amp code" ||
      key.includes("sourcegraph-amp")
    ) {
      return "amp";
    }
    if (tokenSet.has("codebuddy")) {
      return "codebuddy";
    }
    if (
      key === "muse" ||
      key.startsWith("muse-") ||
      key.startsWith("muse_") ||
      key.startsWith("muse ")
    ) {
      return "muse";
    }
  }

  return null;
}

export function agentBrandIdToAcpBrandKey(
  brandId: AgentBrandId | null | undefined,
): AcpAgentBrandKey | null {
  if (!brandId || brandId === "acp" || brandId === "custom") return null;
  if (brandId === "claude-code") return "claude";
  return brandId;
}

export function acpBrandKeyToAgentBrandId(key: AcpAgentBrandKey): Exclude<AgentBrandId, "acp" | "custom"> {
  if (key === "claude") return "claude-code";
  return key;
}

export interface ResolveAcpAgentBrandInput {
  readonly agentId?: string | null | undefined;
  readonly instanceId?: string | null | undefined;
  readonly displayName?: string | null | undefined;
  readonly commandPath?: string | null | undefined;
}

/**
 * Resolves any ACP-connected agent (registry OR local command) into a known official
 * bundled brand key by checking agentId, executable basename, instanceId, and displayName
 * in authoritative priority order.
 */
export function resolveAcpAgentBrandKey(
  input: ResolveAcpAgentBrandInput,
): AcpAgentBrandKey | null {
  const candidates = [
    input.agentId,
    extractCommandStem(input.commandPath),
    input.instanceId,
    input.displayName,
  ];
  for (const candidate of candidates) {
    const matched = matchSpecificAgentBrand(candidate);
    if (matched) {
      return agentBrandIdToAcpBrandKey(matched);
    }
  }
  return null;
}

/**
 * Returns the brand's fixed accent color hex (e.g. `#3B82F6` for GLM, `#d97757` for Claude),
 * or `null` when the brand icon should inherit `currentColor` for crisp Light/Dark contrast.
 */
export function getAcpAgentBrandAccentColor(brandKey: AcpAgentBrandKey): string | null {
  const brandId = acpBrandKeyToAgentBrandId(brandKey);
  const accent = CANONICAL_BRAND_META[brandId].accentColor;
  return accent === "currentColor" ? null : accent;
}

const DEFAULT_AGENT_FALLBACK_NAME = "Agent";

function smartTitleCase(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_AGENT_FALLBACK_NAME;

  // Preserve intentional mixed-case human display names with spaces (e.g. "My Custom Bot", "DeepSeek Studio").
  const looksLikeRawIdentifier =
    !/\s/.test(trimmed) &&
    (/^[^A-Z]+$/.test(trimmed) || /[_-]/.test(trimmed) || /^[a-z]+[A-Z]/.test(trimmed));

  if (!looksLikeRawIdentifier) {
    return trimmed;
  }

  const tokens = trimmed
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return trimmed;

  return tokens
    .map((token) => {
      const lower = token.toLowerCase();
      if (UPPERCASE_ACRONYMS.has(lower)) {
        return lower.toUpperCase();
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/**
 * Resolve a provider ID, driver kind, or display name into a canonical AgentBrandId.
 */
export function resolveAgentBrandId(providerIdOrName: string | null | undefined): AgentBrandId {
  if (!providerIdOrName || typeof providerIdOrName !== "string") {
    return "custom";
  }
  const key = normalizeLookupKey(providerIdOrName);
  if (!key) return "custom";

  const specific = matchSpecificAgentBrand(providerIdOrName);
  if (specific) return specific;

  const exact = KNOWN_ALIASES[key];
  if (exact) return exact;

  const compact = key.replace(/[^a-z0-9]+/g, "");
  const compactHit = KNOWN_ALIASES[compact];
  if (compactHit) return compactHit;

  if (key.startsWith("acp")) {
    return "acp";
  }

  return "custom";
}

/**
 * Map a Prismux driver ID or alias into the canonical Chief provider ID accepted by Prismux Daemon.
 */
export function toCanonicalChiefProviderId(providerIdOrName: string | null | undefined): string {
  const brand = resolveAgentBrandId(providerIdOrName);
  if (brand !== "custom") {
    return CANONICAL_BRAND_META[brand].canonicalProviderId;
  }
  const trimmed = (providerIdOrName ?? "").trim();
  return trimmed || "codex";
}

/**
 * Authoritative brand formatter for all Prismux UI surfaces: honors user display names,
 * scrubs UUID noise, and falls back to canonical vendor display names.
 */
export function formatAgentBrandName(
  providerIdOrName: string | null | undefined,
  customDisplayName?: string | null,
): string {
  const resolveRawFallback = (): string => {
    const trimmedRaw = typeof providerIdOrName === "string" ? providerIdOrName.trim() : "";
    if (!trimmedRaw) {
      return DEFAULT_AGENT_FALLBACK_NAME;
    }

    const rawKey = normalizeLookupKey(trimmedRaw);
    const directBrand = KNOWN_ALIASES[rawKey];
    if (directBrand) {
      return CANONICAL_BRAND_META[directBrand].displayName;
    }

    const extra = EXTRA_KNOWN_DISPLAY_NAMES[rawKey];
    if (extra) {
      return extra;
    }

    if (containsUuidNoise(trimmedRaw)) {
      const resolvedBrand = resolveAgentBrandId(trimmedRaw);
      if (resolvedBrand !== "custom") {
        return CANONICAL_BRAND_META[resolvedBrand].displayName;
      }
      const cleanedRaw = stripUuidNoise(trimmedRaw);
      if (!cleanedRaw) {
        return DEFAULT_AGENT_FALLBACK_NAME;
      }
      const cleanedKey = normalizeLookupKey(cleanedRaw);
      const cleanedBrand = KNOWN_ALIASES[cleanedKey];
      if (cleanedBrand) {
        return CANONICAL_BRAND_META[cleanedBrand].displayName;
      }
      const cleanedExtra = EXTRA_KNOWN_DISPLAY_NAMES[cleanedKey];
      if (cleanedExtra) {
        return cleanedExtra;
      }
      return smartTitleCase(cleanedRaw);
    }

    return smartTitleCase(trimmedRaw);
  };

  const trimmedCustom = typeof customDisplayName === "string" ? customDisplayName.trim() : "";
  if (trimmedCustom.length > 0) {
    if (containsUuidNoise(trimmedCustom)) {
      const cleanedCustom = stripUuidNoise(trimmedCustom);
      if (cleanedCustom.length === 0) {
        return resolveRawFallback();
      }
      const cleanedKey = normalizeLookupKey(cleanedCustom);
      const cleanedBrand = KNOWN_ALIASES[cleanedKey];
      if (cleanedBrand) {
        return CANONICAL_BRAND_META[cleanedBrand].displayName;
      }
      const cleanedExtra = EXTRA_KNOWN_DISPLAY_NAMES[cleanedKey];
      if (cleanedExtra) {
        return cleanedExtra;
      }
      return cleanedCustom;
    }
    const customKey = normalizeLookupKey(trimmedCustom);
    const customBrand = KNOWN_ALIASES[customKey];
    if (customBrand) {
      return CANONICAL_BRAND_META[customBrand].displayName;
    }
    const extraCustom = EXTRA_KNOWN_DISPLAY_NAMES[customKey];
    if (extraCustom) {
      return extraCustom;
    }
    return trimmedCustom;
  }

  return resolveRawFallback();
}

export interface ProviderEntryDisplayInput {
  readonly driverKind: string;
  readonly displayName?: string | null | undefined;
  readonly instanceId?: string | null | undefined;
  readonly hasCustomDisplayName?: boolean | undefined;
}

/**
 * Unified display-name resolver for any ProviderInstanceEntry across the entire workbench
 * (`+` quick launcher, tabs, model picker, sidebar, welcome stage, and Chief selector).
 * Always honors the user's custom display name (even on default instances) and never leaks UUIDs.
 */
export function resolveProviderEntryDisplayName(entry: ProviderEntryDisplayInput): string {
  if (entry.hasCustomDisplayName === true) {
    const trimmedCustom = typeof entry.displayName === "string" ? entry.displayName.trim() : "";
    if (trimmedCustom.length > 0 && !containsUuidNoise(trimmedCustom)) {
      return trimmedCustom;
    }
  }
  return formatAgentBrandName(entry.driverKind || entry.instanceId, entry.displayName);
}

/**
 * Return full brand metadata (canonical ID, display name, accent & breathing glow colors).
 */
export function getAgentBrandMeta(
  providerIdOrName: string | null | undefined,
  customDisplayName?: string | null,
): AgentBrandMeta {
  const brandId = resolveAgentBrandId(providerIdOrName);
  const displayName = formatAgentBrandName(providerIdOrName, customDisplayName);
  if (brandId !== "custom") {
    return {
      ...CANONICAL_BRAND_META[brandId],
      displayName,
    };
  }
  return {
    id: "custom",
    displayName,
    canonicalProviderId: (providerIdOrName ?? "").trim() || "acp",
    accentColor: "currentColor",
    glowColor: "rgba(99, 102, 241, 0.45)",
  };
}

export const AGENT_BRAND_STYLE_ID = "pmx-agent-brand-keyframes";

export const AGENT_BRAND_BREATHE_CSS = `
@keyframes pmx-brand-breathe {
  0%, 100% {
    opacity: 1;
    filter: drop-shadow(0 0 3.5px var(--pmx-brand-glow, currentColor)) brightness(1.06);
  }
  50% {
    opacity: 0.46;
    filter: drop-shadow(0 0 0px transparent) brightness(0.86);
  }
}

.pmx-agent-brand-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 1;
  transition: opacity 220ms ease, filter 220ms ease;
}

.pmx-agent-brand-logo[data-breathing="true"] {
  animation: pmx-brand-breathe 2.8s cubic-bezier(0.42, 0, 0.58, 1) infinite;
  will-change: opacity, filter;
}

.pmx-agent-brand-logo[data-online="false"] {
  opacity: 0.45;
  filter: saturate(0.22) grayscale(0.5);
  animation: none;
}

@media (prefers-reduced-motion: reduce) {
  .pmx-agent-brand-logo[data-breathing="true"] {
    animation: none;
    will-change: auto;
    opacity: 1;
    filter: drop-shadow(0 0 2px var(--pmx-brand-glow, currentColor));
  }
}

:root[data-pmx-reduced-motion="1"] .pmx-agent-brand-logo[data-breathing="true"],
:root[data-pmx-gpu="0"] .pmx-agent-brand-logo[data-breathing="true"],
:root[data-prismux-gpu="0"] .pmx-agent-brand-logo[data-breathing="true"] {
  animation: none;
  will-change: auto;
  opacity: 1;
}
`.trim();

function ensureAgentBrandStyles(): void {
  if (typeof document === "undefined" || !document.head) {
    return;
  }
  if (document.getElementById(AGENT_BRAND_STYLE_ID)) {
    return;
  }
  const styleEl = document.createElement("style");
  styleEl.id = AGENT_BRAND_STYLE_ID;
  styleEl.textContent = AGENT_BRAND_BREATHE_CSS;
  document.head.appendChild(styleEl);
}

const OPENAI_CODEX_PATH =
  "M252.794 108.802C289.191 99.0484 326.265 110.305 351.148 135.135C385.113 126.072 422.85 134.862 449.492 161.505C476.136 188.149 484.925 225.888 475.862 259.85V259.854C500.696 284.735 511.95 321.81 502.198 358.207C492.447 394.602 464.161 421.084 430.215 430.217C421.083 464.162 394.603 492.448 358.206 502.199C321.812 511.951 284.734 500.693 259.852 475.864C225.887 484.927 188.15 476.137 161.507 449.495C134.864 422.851 126.073 385.111 135.136 351.149C110.304 326.266 99.0496 289.192 108.801 252.795C118.552 216.4 146.84 189.918 180.784 180.785C189.917 146.841 216.396 118.553 252.794 108.802ZM374.292 407.145C374.292 411.271 372.092 415.086 368.517 417.148L283.723 466.102C302.487 480.585 327.555 486.459 352.217 479.852C386.997 470.532 410.068 439.312 410.555 405.006V317.717C410.555 315.08 409.125 312.621 406.843 311.303L374.292 292.509V407.145ZM251.868 415.897C248.296 417.959 243.893 417.959 240.317 415.897L155.526 366.942C152.366 390.436 159.811 415.08 177.866 433.136H177.863C203.325 458.594 241.896 462.962 271.85 446.232L347.449 402.586C349.735 401.268 351.148 398.8 351.148 396.163V358.579L251.868 415.897ZM368.602 220.628C366.319 219.309 363.474 219.318 361.191 220.637L328.641 239.431L427.921 296.749C431.496 298.811 433.697 302.627 433.697 306.752V404.661C455.622 395.654 473.244 376.881 479.851 352.218C489.169 317.442 473.668 281.85 444.201 264.274L368.602 220.628ZM177.303 206.34C155.377 215.348 137.756 234.122 131.148 258.783C121.832 293.561 137.331 329.153 166.799 346.727L242.398 390.373C244.68 391.692 247.525 391.684 249.807 390.366L282.357 371.572L183.078 314.253C179.504 312.189 177.303 308.375 177.303 304.251V206.34ZM259.849 279.145V331.858L305.5 358.213L351.15 331.858V279.145L305.5 252.789L259.849 279.145ZM327.276 144.9C308.512 130.418 283.445 124.543 258.782 131.15C224.002 140.471 200.931 171.691 200.445 205.995V293.286C200.445 295.923 201.875 298.381 204.158 299.7L236.707 318.493V203.856C236.707 199.731 238.909 195.916 242.483 193.853L327.276 144.9ZM433.137 177.867C407.675 152.407 369.103 148.038 339.149 164.769L263.55 208.415C261.265 209.734 259.852 212.202 259.852 214.838V252.423L359.132 195.105C362.703 193.041 367.108 193.041 370.682 195.105L455.473 244.06C458.635 220.567 451.189 195.922 433.135 177.867H433.137Z";

const CLAUDE_STARBURST_PATH =
  "m50.228 170.321 50.357-28.257.843-2.463-.843-1.361h-2.462l-8.426-.518-28.775-.778-24.952-1.037-24.175-1.296-6.092-1.297L0 125.796l.583-3.759 5.12-3.434 7.324.648 16.202 1.101 24.304 1.685 17.629 1.037 26.118 2.722h4.148l.583-1.685-1.426-1.037-1.101-1.037-25.147-17.045-27.22-18.017-14.258-10.37-7.713-5.25-3.888-4.925-1.685-10.758 7-7.713 9.397.649 2.398.648 9.527 7.323 20.35 15.75L94.817 91.9l3.889 3.24 1.555-1.102.195-.777-1.75-2.917-14.453-26.118-15.425-26.572-6.87-11.018-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0 82.05 1.426l4.472 3.888 6.61 15.101 10.694 23.786 16.591 32.34 4.861 9.592 2.592 8.879.973 2.722h1.685v-1.556l1.36-18.211 2.528-22.36 2.463-28.776.843-8.1 4.018-9.722 7.971-5.25 6.222 2.981 5.12 7.324-.713 4.73-3.046 19.768-5.962 30.98-3.889 20.739h2.268l2.593-2.593 10.499-13.934 17.628-22.036 7.778-8.749 9.073-9.657 5.833-4.601h11.018l8.1 12.055-3.628 12.443-11.342 14.388-9.398 12.184-13.48 18.147-8.426 14.518.778 1.166 2.01-.194 30.46-6.481 16.462-2.982 19.637-3.37 8.88 4.148.971 4.213-3.5 8.62-20.998 5.184-24.628 4.926-36.682 8.685-.454.324.519.648 16.526 1.555 7.065.389h17.304l32.21 2.398 8.426 5.574 5.055 6.805-.843 5.184-12.962 6.611-17.498-4.148-40.83-9.721-14-3.5h-1.944v1.167l11.666 11.406 21.387 19.314 26.767 24.887 1.36 6.157-3.434 4.86-3.63-.518-23.526-17.693-9.073-7.972-20.545-17.304h-1.36v1.814l4.73 6.935 25.017 37.59 1.296 11.536-1.814 3.76-6.481 2.268-7.13-1.297-14.647-20.544-15.1-23.138-12.185-20.739-1.49.843-7.194 77.448-3.37 3.953-7.778 2.981-6.48-4.925-3.436-7.972 3.435-15.749 4.148-20.544 3.37-16.333 3.046-20.285 1.815-6.74-.13-.454-1.49.194-15.295 20.999-23.267 31.433-18.406 19.702-4.407 1.75-7.648-3.954.713-7.064 4.277-6.286 25.47-32.405 15.36-20.092 9.917-11.6-.065-1.686h-.583L44.07 198.125l-12.055 1.555-5.185-4.86.648-7.972 2.463-2.593 20.35-13.999-.064.065Z";

const CURSOR_PRISM_PATH =
  "M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z";

const GEMINI_SPARK_PATH =
  "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81";

const GLM_ZAI_PATH =
  "M8.07 1.333L6.618 3.302H.435L1.887 1.333h6.184zM15.503 12.699L14.052 14.667h-6.161l1.449-1.968h6.163zM16 1.333L6.176 14.667H0L9.824 1.333H16z";

const QWEN_MARK_PATH =
  "m140.93 85-16.35-28.33-1.93-3.34 8.66-15a3.323 3.323 0 0 0 0-3.34l-9.62-16.67c-.3-.51-.72-.93-1.22-1.22s-1.07-.45-1.67-.45H82.23l-8.66-15a3.33 3.33 0 0 0-2.89-1.67H51.43c-.59 0-1.17.16-1.66.45-.5.29-.92.71-1.22 1.22L32.19 29.98l-1.92 3.33H12.96c-.59 0-1.17.16-1.66.45-.5.29-.93.71-1.22 1.22L.45 51.66a3.323 3.323 0 0 0 0 3.34l18.28 31.67-8.66 15a3.32 3.32 0 0 0 0 3.34l9.62 16.67c.3.51.72.93 1.22 1.22s1.07.45 1.67.45h36.56l8.66 15a3.35 3.35 0 0 0 2.89 1.67h19.25a3.34 3.34 0 0 0 2.89-1.67l18.28-31.67h17.32c.6 0 1.17-.16 1.67-.45s.92-.71 1.22-1.22l9.62-16.67a3.323 3.323 0 0 0 0-3.34ZM51.44 3.33 61.07 20l-9.63 16.66h76.98l-9.62 16.66H45.67l-11.54-20zM57.21 120H22.58l9.63-16.67h19.25l-38.5-66.67h19.25l9.62 16.67L68.78 100l-11.55 20Zm61.59-33.34-9.62-16.67-38.49 66.67-9.63-16.67 9.63-16.66 26.94-46.67h23.1l17.32 30z";

const KIMI_MOONSHOT_PATH =
  "M19.514 7.342C19.711 7.862 19.814 8.413 19.816 8.969C19.816 12.494 15.998 14.697 12.946 12.934C11.529 12.116 10.657 10.605 10.657 8.969C10.657 5.646 14.085 3.431 17.115 4.793C15.26 3.373 12.99 2.607 10.655 2.612C4.772 2.614 0.005 7.381 0 13.265C0.002 19.148 4.772 23.918 10.655 23.92C16.538 23.916 21.306 19.147 21.31 13.265C21.312 11.155 20.687 9.095 19.514 7.342ZM14.841 4.666C14.841 8.191 18.657 10.395 21.709 8.632C23.127 7.814 24 6.302 24 4.666C24 1.14 20.184-1.061 17.13 0.699C15.714 1.519 14.841 3.03 14.841 4.666";

const GITHUB_COPILOT_SHELL_PATH =
  "M7.99816 14.2779C12.0678 14.2779 14.9997 11.6274 14.9997 10.9574V9.3189C14.939 8.77306 14.4165 7.82349 13.6074 7.48636C13.5959 7.42498 13.5859 7.36153 13.5756 7.29542C13.5506 7.13548 13.5231 6.95977 13.4649 6.75954C13.6409 6.31508 13.6873 5.81187 13.6873 5.31135C13.6873 4.54947 13.5757 3.76321 13.0811 3.13712C12.5745 2.4959 11.7737 2.15372 10.6972 2.03411C9.64215 1.91688 8.71828 2.06409 8.12157 2.70342C8.07827 2.74981 8.0345 2.79812 7.99655 2.84746C7.95861 2.79812 7.91805 2.74981 7.87475 2.70342C7.27804 2.06409 6.35416 1.91688 5.29908 2.03411C4.22263 2.15372 3.42181 2.4959 2.91521 3.13712C2.42057 3.76321 2.30905 4.54947 2.30905 5.31135C2.30905 5.81187 2.35539 6.31508 2.53142 6.75954C2.47323 6.95977 2.44574 7.13542 2.42072 7.29536C2.41037 7.3615 2.40044 7.42496 2.38893 7.48636C1.57983 7.82349 1.05728 8.77306 0.996582 9.3189V10.9574C0.996582 11.6274 3.92849 14.2779 7.99816 14.2779ZM10.5523 3.33859C9.63863 3.23707 9.25001 3.41798 9.0811 3.59896C8.90273 3.79007 8.76738 4.19254 8.86971 5.0112C8.94909 5.64627 9.13423 6.08757 9.41018 6.36929C9.67188 6.63645 10.0966 6.8426 10.8435 6.8426C11.6506 6.8426 11.9631 6.66867 12.1051 6.51046C12.2619 6.33577 12.3748 6.00462 12.3748 5.31135C12.3748 4.64141 12.2675 4.22455 12.0513 3.95077C11.8469 3.69214 11.4446 3.43773 10.5523 3.33859ZM6.91639 3.59896C6.74748 3.41798 6.35886 3.23707 5.44518 3.33859C4.55289 3.43773 4.15058 3.69214 3.94624 3.95077C3.72994 4.22455 3.62271 4.64141 3.62271 5.31135C3.62271 6.00462 3.73563 6.33577 3.89239 6.51046C4.03436 6.66867 4.34693 6.8426 5.15396 6.8426C5.90092 6.8426 6.32561 6.63645 6.58731 6.36929C6.86326 6.08757 7.0484 5.64627 7.12778 5.0112C7.23011 4.19254 7.09476 3.79007 6.91639 3.59896ZM7.99818 12.9788C9.99307 12.9788 12.0088 12.0076 12.3748 11.7248V8.00133L12.3546 7.90026C11.9257 8.08369 11.4142 8.1551 10.8435 8.1551C9.84049 8.1551 9.04148 7.86851 8.47257 7.28773C8.28092 7.09208 8.12536 6.87308 7.99978 6.6378C7.8742 6.87308 7.71544 7.09208 7.52378 7.28773C6.95488 7.86851 6.15587 8.1551 5.15283 8.1551C4.58212 8.1551 4.07068 8.08369 3.6418 7.90026L3.62158 8.00133V11.7248C3.98755 12.0076 6.00329 12.9788 7.99818 12.9788Z";
const GITHUB_COPILOT_EYE_L_PATH =
  "M6.46854 9.0301C6.83097 9.0301 7.12479 9.32391 7.12479 9.68635V10.9988C7.12479 11.3613 6.83097 11.6551 6.46854 11.6551C6.1061 11.6551 5.81229 11.3613 5.81229 10.9988V9.68635C5.81229 9.32391 6.1061 9.0301 6.46854 9.0301Z";
const GITHUB_COPILOT_EYE_R_PATH =
  "M10.1873 9.68635C10.1873 9.32391 9.89347 9.0301 9.53104 9.0301C9.1686 9.0301 8.87479 9.32391 8.87479 9.68635V10.9988C8.87479 11.3613 9.1686 11.6551 9.53104 11.6551C9.89347 11.6551 10.1873 11.3613 10.1873 10.9988V9.68635Z";

const MISTRAL_PIXEL_PATHS: readonly string[] = [
  "M8.8147 5.35803H5.35791V8.46914H8.8147V5.35803Z",
  "M22.6419 5.35803H19.1851V8.46914H22.6419V5.35803Z",
  "M15.7283 15.7284H12.2715V18.8395H15.7283V15.7284Z",
  "M8.8147 15.7284H5.35791V18.8395H8.8147V15.7284Z",
  "M22.6419 15.7284H19.1851V18.8395H22.6419V15.7284Z",
  "M12.2715 8.81482H5.35791V11.9259H12.2715V8.81482Z",
  "M12.2718 19.1852H1.90137V22.2963H12.2718V19.1852Z",
  "M26.0989 19.1852H15.7285V22.2963H26.0989V19.1852Z",
  "M22.6419 12.2716H5.35791V15.3827H22.6419V12.2716Z",
  "M22.6421 8.81482H15.7285V11.9259H22.6421V8.81482Z",
];

const FACTORY_DROID_PATH =
  "M622.037 192.524a10.58 10.58 0 0 1-4.056-2.001 10.573 10.573 0 0 1-3.98-7.89 10.595 10.595 0 0 1 .804-4.452c20.214-49.194 29.134-88.555 14.74-105.033-38.123-43.716-191.004 43.219-239.75 72.663a10.596 10.596 0 0 1-10.841.041 10.576 10.576 0 0 1-4.396-5.07c-20.491-49.089-42.031-83.233-63.865-84.714-57.871-3.96-104.516 165.624-118.17 220.895a10.574 10.574 0 0 1-1.993 4.057 10.572 10.572 0 0 1-7.884 3.977 10.586 10.586 0 0 1-4.447-.802c-49.194-20.215-88.572-29.134-105.033-14.74-43.717 38.123 43.202 191.005 72.644 239.75a10.553 10.553 0 0 1 1.454 4.279 10.573 10.573 0 0 1-6.481 10.958c-49.072 20.491-83.216 42.031-84.715 63.864-3.944 57.871 165.624 104.516 220.913 118.171a10.566 10.566 0 0 1 5.658 3.601 10.57 10.57 0 0 1 2.355 6.281 10.58 10.58 0 0 1-.799 4.442c-20.214 49.194-29.134 88.572-14.739 105.033 38.121 43.717 191.021-43.202 239.767-72.644a10.566 10.566 0 0 1 15.238 5.027c20.489 49.072 42.013 83.216 63.862 84.715 57.871 3.944 104.516-165.624 118.153-220.913a10.603 10.603 0 0 1 9.895-8.021 10.566 10.566 0 0 1 4.449.808c49.193 20.214 88.553 29.116 105.032 14.738 43.718-38.121-43.219-191.022-72.663-239.767a10.602 10.602 0 0 1 1.326-12.655 10.604 10.604 0 0 1 3.703-2.582c49.089-20.49 83.233-42.031 84.714-63.863 3.96-57.871-165.624-104.516-220.895-118.153Zm-66.394-55.478c11.123 19.938-46.196 152.797-88.83 245.724a8.36 8.36 0 0 1-8.239 4.855 8.374 8.374 0 0 1-7.412-6.043c-17.219-60.42-36.899-131.411-57.957-191.675a10.557 10.557 0 0 1 4.924-12.759c52.586-28.721 142.568-66.86 157.514-40.102ZM303.635 153.49c21.953 6.233 75.365 140.709 110.92 236.564a8.364 8.364 0 0 1-2.394 9.249 8.364 8.364 0 0 1-9.504.978c-54.943-30.493-119.013-66.824-176.522-94.546a10.565 10.565 0 0 1-5.528-12.501c16.926-57.44 53.532-148.095 83.028-139.744ZM137.064 343.322c19.921-11.123 152.795 46.197 245.707 88.83a8.369 8.369 0 0 1-1.189 15.652c-60.401 17.219-131.411 36.899-191.675 57.957a10.552 10.552 0 0 1-12.742-4.925c-28.668-52.584-66.876-142.568-40.101-157.514Zm16.443 252.009c6.217-21.953 140.709-75.365 236.564-110.921a8.368 8.368 0 0 1 10.227 11.898c-30.511 54.945-66.842 119.014-94.563 176.507a10.548 10.548 0 0 1-5.229 5.075 10.544 10.544 0 0 1-7.271.468c-57.441-16.822-148.095-53.531-139.728-83.027ZM343.34 761.902c-11.14-19.922 46.197-152.796 88.829-245.707a8.383 8.383 0 0 1 5.713-4.66 8.38 8.38 0 0 1 7.182 1.664 8.371 8.371 0 0 1 2.758 4.184c17.217 60.403 36.898 131.412 57.957 191.675a10.558 10.558 0 0 1-4.942 12.743c-52.568 28.668-142.568 66.875-157.445 40.101h-.052Zm252.009-16.443c-21.971-6.216-75.383-140.709-110.939-236.564a8.37 8.37 0 0 1 11.916-10.228c54.926 30.494 119.014 66.842 176.506 94.563a10.538 10.538 0 0 1 5.527 12.502c-16.909 57.526-53.515 148.094-83.01 139.727Zm166.57-189.834c-19.938 11.141-152.796-46.197-245.724-88.83a8.367 8.367 0 0 1-2.993-12.892 8.378 8.378 0 0 1 4.182-2.759c60.419-17.218 131.41-36.899 191.675-57.958a10.577 10.577 0 0 1 12.758 4.943c28.652 52.568 66.86 142.569 40.102 157.496Zm-16.444-252.009c-6.232 21.971-140.709 75.383-236.562 110.94a8.371 8.371 0 0 1-10.229-11.917c30.495-54.926 66.825-119.012 94.547-176.505a10.555 10.555 0 0 1 12.5-5.528c57.441 16.909 148.096 53.516 139.744 83.01Z";

const CLINE_SHELL_PATH =
  "M65.45 16.3c10.89 0 19.71 8.86 19.71 19.8v6.6l5.74 11.46a4.48 4.48 0 0 1-.01 3.6L85.16 69.1v6.6c0 10.94-8.83 19.8-19.71 19.8H26.02c-10.89 0-19.71-8.86-19.71-19.8v-6.6L.45 57.8a4.48 4.48 0 0 1-.01-3.67L6.31 42.7v-6.6c0-10.94 8.83-19.8 19.71-19.8h39.43zm-2.52 5.7H29.19c-9.32 0-16.87 7.56-16.87 16.88v5.62l-4.88 9.46a4.48 4.48 0 0 0 .01 3.68l4.87 9.36v5.62c0 9.32 7.55 16.88 16.87 16.88h33.74c9.32 0 16.87-7.55 16.87-16.88V67l4.77-9.39a4.48 4.48 0 0 0 0-3.61L79.8 44.5v-5.62C79.8 29.56 72.25 22 62.93 22z";

const GOOSE_MARK_PATH =
  "M20.9093 19.3861L19.5185 18.2413C18.7624 17.619 18.1189 16.8713 17.6157 16.0313C16.9205 14.8706 15.9599 13.8912 14.8133 13.1735L14.2533 12.8475C14.0614 12.7141 13.9276 12.5062 13.9086 12.2716C13.8963 12.1204 13.9326 11.9852 14.0171 11.8662C14.3087 11.4553 15.896 9.74698 16.1722 9.51845C16.528 9.22442 16.9243 8.97987 17.2921 8.69986C17.3443 8.66 17.3968 8.62035 17.4485 8.57989C17.4503 8.57808 17.4529 8.57668 17.4545 8.57508C17.5725 8.48195 17.6838 8.383 17.7724 8.26563C18.2036 7.76631 18.195 7.3443 18.195 7.3443C18.195 7.3443 18.1954 7.3439 18.1956 7.3437C18.1497 7.23133 17.9847 6.88163 17.6492 6.71759C17.9458 6.71178 18.2805 6.82294 18.4323 6.97156C18.6148 6.68534 18.7328 6.49967 18.9162 6.18762C18.9599 6.11352 18.9831 5.97652 18.8996 5.89981C18.8996 5.89981 18.8992 5.89981 18.8988 5.89981C18.8988 5.89981 18.8988 5.8994 18.8988 5.899C18.8972 5.8974 18.8952 5.8962 18.8936 5.8946C18.892 5.893 18.891 5.89119 18.8892 5.88939C18.8892 5.88939 18.8888 5.88939 18.8884 5.88939C18.8884 5.88939 18.8884 5.88899 18.8884 5.88859C18.885 5.88518 18.8812 5.88258 18.8776 5.87938C18.8754 5.87717 18.8736 5.87457 18.8716 5.87217C18.8692 5.87016 18.8665 5.86836 18.8643 5.86616C18.8609 5.86275 18.8587 5.85855 18.8551 5.85534C18.8551 5.85534 18.8545 5.85514 18.8543 5.85534C18.8543 5.85534 18.8543 5.85494 18.8543 5.85454C18.8527 5.85294 18.8507 5.85174 18.8491 5.85013C18.8475 5.84853 18.8463 5.84653 18.8447 5.84493C18.8447 5.84493 18.8441 5.84473 18.8439 5.84493C18.8439 5.84493 18.8439 5.84453 18.8439 5.84413C18.7672 5.7606 18.6302 5.78384 18.5561 5.8275C18.1503 6.06625 17.7555 6.32322 17.3996 6.54855C17.3996 6.54855 16.9778 6.53973 16.4783 6.97116C16.3607 7.05989 16.2618 7.17125 16.1688 7.28902C16.167 7.29082 16.1654 7.29322 16.164 7.29503C16.1234 7.3465 16.0837 7.39898 16.0441 7.45145C15.7639 7.81939 15.5195 8.21556 15.2255 8.57128C14.9971 8.84768 13.2887 10.4348 12.8777 10.7264C12.7587 10.8109 12.6237 10.8474 12.4723 10.835C12.2379 10.8161 12.0298 10.6821 11.8965 10.4903L11.5704 9.93024C10.8527 8.78318 9.87332 7.82299 8.71264 7.12778C7.87262 6.62466 7.12514 5.98092 6.50264 5.22503L5.35778 3.83421C5.3013 3.76571 5.19314 3.77693 5.15268 3.85585C5.02249 4.10941 4.77393 4.64479 4.58346 5.36483C4.57885 5.38186 4.58286 5.39988 4.59407 5.4135C4.83082 5.69952 5.37901 6.32983 6.03196 6.863C6.07742 6.90005 6.04017 6.97336 5.98369 6.95774C5.42047 6.80432 4.87288 6.55796 4.46308 6.34805C4.42964 6.33103 4.38918 6.35226 4.38437 6.38951C4.32068 6.89985 4.30425 7.46027 4.37155 8.05112C4.37355 8.07035 4.38577 8.08697 4.4036 8.09479C4.87088 8.29808 5.61816 8.59311 6.40269 8.78078C6.45958 8.7944 6.45777 8.87632 6.40029 8.88733C5.78941 9.0023 5.14968 9.02794 4.62973 9.02113C4.59327 9.02073 4.56643 9.05518 4.57625 9.09023C4.6806 9.45896 4.822 9.8339 5.00847 10.2115C5.08559 10.3811 5.16951 10.5475 5.25944 10.7104C5.27486 10.7382 5.3047 10.7548 5.33655 10.7534C5.76577 10.7324 6.28452 10.6871 6.80608 10.595C6.89501 10.5794 6.94268 10.6964 6.86757 10.7466C6.51345 10.9834 6.13571 11.1873 5.7844 11.3551C5.73733 11.3777 5.72211 11.4378 5.75315 11.4797C5.96186 11.7625 6.19139 12.0301 6.44075 12.2794C6.44075 12.2794 7.66853 13.5441 7.70198 13.6432C8.41841 12.9096 9.59612 12.0964 10.8966 11.3864C9.15488 12.8036 8.18387 13.8499 7.69517 14.4444L7.35447 14.9225C7.17742 15.1708 7.02379 15.4346 6.89541 15.7112C6.46579 16.6356 5.75756 18.5051 5.75756 18.5051C5.70328 18.6515 5.74754 18.7959 5.84168 18.89C5.84388 18.8922 5.84609 18.8944 5.84849 18.8964C5.85069 18.8986 5.8527 18.901 5.8549 18.9032C5.94924 18.9976 6.09345 19.0416 6.23986 18.9874C6.23986 18.9874 8.10897 18.2791 9.03371 17.8495C9.31031 17.7211 9.57429 17.5673 9.82245 17.3905L10.349 17.0153C10.6278 16.8166 11.0096 16.8483 11.2517 17.0904L12.4655 18.3042C12.7148 18.5535 12.9824 18.7831 13.2652 18.9918C13.3073 19.0226 13.3672 19.0076 13.3898 18.9605C13.5579 18.6094 13.7618 18.2313 13.9983 17.8774C14.0486 17.8022 14.1657 17.8501 14.1499 17.9388C14.0576 18.4606 14.0127 18.9794 13.9915 19.4084C13.9899 19.44 14.0067 19.4701 14.0345 19.4855C14.1972 19.5756 14.3636 19.6595 14.5335 19.7364C14.911 19.9229 15.2862 20.0645 15.6547 20.1687C15.6897 20.1785 15.7242 20.1516 15.7238 20.1152C15.7168 19.595 15.7424 18.9553 15.8576 18.3446C15.8684 18.2869 15.9503 18.2851 15.9641 18.3422C16.1516 19.127 16.4466 19.8742 16.6501 20.3413C16.6579 20.3591 16.6744 20.3712 16.6938 20.3734C17.2847 20.4407 17.8451 20.4242 18.3554 20.3606C18.3929 20.3559 18.4141 20.3155 18.3969 20.2818C18.187 19.872 17.9406 19.3241 17.7872 18.7612C17.7718 18.7046 17.8449 18.6675 17.8819 18.713C18.4151 19.3659 19.0454 19.9141 19.3314 20.1508C19.345 20.1621 19.3633 20.1659 19.3801 20.1615C20.1003 19.9712 20.6357 19.7226 20.8891 19.5922C20.968 19.5518 20.9792 19.4436 20.9107 19.3871L20.9093 19.3861Z";

const AUGGIE_BRACKETS_PATH =
  "M9.972 13.193h2.577q.187 0 .277-.09t.091-.294V10.47q0-.324.133-.59.135-.27.36-.424a1 1 0 0 1 .099-.06 1 1 0 0 1-.1-.058 1.1 1.1 0 0 1-.359-.424 1.3 1.3 0 0 1-.133-.59v-2.33q0-.202-.091-.293t-.277-.089H9.972a.38.38 0 0 1-.294-.124.4.4 0 0 1-.108-.281q.002-.176.131-.293a.46.46 0 0 1 .313-.111h2.775c.36 0 .642.097.836.288q.293.29.294.832V8.24q0 .39.152.562.148.168.555.178a.4.4 0 0 1 .27.128.41.41 0 0 1 .104.287.44.44 0 0 1-.1.282.34.34 0 0 1-.277.132c-.266.006-.452.066-.55.177q-.151.174-.152.573v2.318c0 .235-.043.44-.128.607a.85.85 0 0 1-.389.387 1.3 1.3 0 0 1-.534.124V14h-2.854a.45.45 0 0 1-.315-.118.38.38 0 0 1-.129-.286q0-.164.109-.282a.38.38 0 0 1 .293-.123zM1.103 9.108a.4.4 0 0 1 .276-.128q.4-.008.55-.177.15-.173.151-.562V5.923q.002-.543.294-.832c.195-.191.477-.288.836-.288h2.775q.188 0 .313.111a.37.37 0 0 1 .131.293.4.4 0 0 1-.108.281.38.38 0 0 1-.293.123H3.45q-.186 0-.277.09t-.092.292v2.33c0 .213-.044.413-.133.59a1.1 1.1 0 0 1-.359.424 1 1 0 0 1-.1.059 1 1 0 0 1 .1.059q.225.156.359.423t.133.59v2.34q0 .203.092.293.088.09.277.089h2.577a.38.38 0 0 1 .294.123q.108.12.108.281a.38.38 0 0 1-.13.286.45.45 0 0 1-.314.118l-2.775-.003a1.4 1.4 0 0 1-.613-.126.87.87 0 0 1-.388-.387 1.34 1.34 0 0 1-.129-.608v-2.318q0-.4-.151-.572-.151-.168-.55-.177a.35.35 0 0 1-.278-.132.42.42 0 0 1-.102-.28q0-.173.103-.287";
const AUGGIE_FACE_PATH =
  "M5.437 10.36a.986.986 0 0 1-.994-.975c0-.538.446-.976.994-.976s.994.438.994.976a.986.986 0 0 1-.994.976M10.562 8.41c.548 0 .994.437.994.975a.986.986 0 0 1-.994.976.986.986 0 0 1-.994-.976c0-.538.446-.976.994-.976M8.74 2c.37 0 .446.15.446.275v.034q0 .034-.009.201-.01.162-.017.549-.018.378-.044 1.06c0 .106-.065.233-.375.233-.311 0-.376-.126-.376-.23l-.07-1.835v-.003c0-.13.078-.284.446-.284M7.256 2c.369 0 .446.15.446.275v.034q0 .034-.01.201-.007.162-.017.549-.017.378-.043 1.06c0 .106-.065.233-.376.233-.31 0-.375-.126-.375-.23l-.07-1.835v-.003C6.81 2.154 6.887 2 7.256 2";

const DEVIN_MARK_PATH =
  "M1.84577e-10 100.797V38.6224C1.88813e-05 35.8899 1.45777 33.365 3.82414 31.9988L57.6539 0.920185C60.0203 -0.446051 62.9358 -0.446051 65.3022 0.920185L119.132 31.9988C121.498 33.3651 122.956 35.8899 122.956 38.6224V70.375C123.192 80.9262 128.769 91.103 138.577 96.7655C148.384 102.428 159.986 102.169 169.242 97.0979L196.74 81.2217C199.107 79.8554 202.022 79.8554 204.388 81.2217L258.218 112.3C260.585 113.667 262.042 116.191 262.042 118.924V181.081C262.042 183.814 260.585 186.339 258.218 187.705L204.388 218.783C202.022 220.15 199.107 220.15 196.74 218.783L169.464 203.036C160.173 197.847 148.465 197.536 138.579 203.244C128.772 208.906 123.195 219.083 122.959 229.634V261.378C122.959 264.111 121.501 266.635 119.135 268.002L65.3048 299.08C62.9384 300.447 60.0229 300.447 57.6566 299.08L3.82673 268.002C1.46036 266.635 0.00260562 264.111 0.00260562 261.378V199.221C0.0026245 196.488 1.46038 193.963 3.82675 192.597L57.6565 161.519C60.0229 160.152 62.9384 160.152 65.3048 161.519L92.8656 177.431C102.11 182.467 113.679 182.711 123.463 177.062C133.349 171.355 138.934 161.06 139.086 150.419C138.85 139.868 133.274 128.601 123.466 122.938C113.658 117.276 102.056 117.534 92.8007 122.606L65.1758 138.645C62.7991 140.025 59.8649 140.024 57.4894 138.642L3.80216 107.407C1.44816 106.038 -1.88809e-05 103.52 1.84577e-10 100.797Z";

const KIRO_GHOST_PATH =
  "M17.383 5.422a7.556 7.556 0 0 1 6.008 3.805c.148.257.406.796.52 1.085.394 1 .632 2.157.769 3.75.035.38.05 1.965.023 2.407-.125 2.168-.625 4.183-1.515 6.078a9.77 9.77 0 0 1-.801 1.437c-.93 1.305-2.320 2.332-3.480 2.570-.895.184-1.602-.1-2.048-.827a3.420 3.420 0 0 1-.25-.528c-.035-.097-.062-.129-.086-.09-.003.008-.09.075-.191.153-.95.722-2.02 1.175-3.059 1.293-.273.03-.859.023-1.085-.016-.715-.121-1.286-.441-1.649-.93a2.563 2.563 0 0 1-.328-.632c-.117-.36-.156-.813-.117-1.227.054-.55.226-1.184.484-1.766a.48.48 0 0 0 .043-.117 2.11 2.11 0 0 0-.137.055c-.363.16-.898.305-1.308.351-.844.098-1.426-.14-1.715-.699-.106-.203-.149-.39-.16-.676-.008-.261.008-.43.066-.656.059-.23.121-.367.403-.89.382-.72.492-.946.636-1.348.328-.899.48-1.723.688-3.754.148-1.469.254-2.14.433-2.766.028-.09.078-.277.114-.414.796-3.074 3.113-5.183 6.148-5.601.129-.016.309-.04.399-.047.238-.016.96-.02 1.195 0ZM16.754 11.336a.815.815 0 0 0-.375.219c-.176.18-.293.441-.356.804-.039.235-.058.602-.039.868.028.406.082.64.204.894.128.262.304.426.546.496.106.031.383.031.5 0 .422-.113.703-.531.801-1.191a4.822 4.822 0 0 0-.012-.95c-.062-.378-.183-.675-.359-.863a.808.808 0 0 0-.648-.293.804.804 0 0 0-.262.016ZM20.375 11.328a1.01 1.01 0 0 0-.363.188c-.164.144-.293.402-.364.718-.05.23-.07.426-.07.743 0 .32.02.511.07.742.11.496.352.808.688.898.121.031.379.031.5 0 .402-.105.68-.5.781-1.11.035-.198.047-.648.024-.87-.063-.63-.293-1.059-.649-1.23a1.513 1.513 0 0 0-.219-.079 1.362 1.362 0 0 0-.398 0Z";

const MINIMAX_MARK_PATH = "M2 3h3l3 5 3-5h3v10h-2V6.5l-4 6-4-6V13H2V3Z";

const GROK_MARK_PATH =
  "M0.58392448,14.9254204 L0.8326,14.66295 C2.004465,13.42985 3.1678,12.2082 2.45814,10.48105 C1.50813,8.1701 2.061355,5.4619 3.820575,3.70057 C5.6495,1.8709 8.3431,1.40957 10.59295,2.336505 C11.0907,2.52161 11.5245,2.785025 11.86295,3.02993 L9.98425,3.89849 C8.235,3.163775 6.23115,3.66355 5.0081,4.88809 C3.354105,6.5426 3.019895,9.4117 4.95835,11.2656 L-0.335,15.99995 C-0.066496,15.62975 0.2538896,15.275934 0.58392448,14.9254204 Z M14.0391,2.288155 L16.33165,2.57749377e-12 L16.20795,0.172288 C14.4658,2.574355 13.6153,3.749045 14.29795,6.6879 C14.76445,8.68415 14.261,10.90255 12.63545,12.53005 C10.5861,14.58325 7.3066,15.0403 4.6059,13.19215 L6.48885,12.3193 C8.2125,12.99705 10.0983,12.69945 11.4536,11.34255 C12.80895,9.9856 13.1133,8.00925 12.4321,6.3647 C12.30265,6.05285 11.9144,5.97455 11.64275,6.1753 L6.102,10.27035 L14.0391,2.288155 Z";

const KILO_MARK_PATH =
  "M27.9998324,34.6666921h6.6666279v5.3333023h-8.3809037l-3.6190266-3.6190266v-8.3809037h5.3333023v6.6666279ZM39.9997627,26.2857884l-3.6190266-3.6190266h-8.3809037v5.3333023h6.6666279v6.6666279h5.3333023v-8.3809037ZM17.3332326,22.6667578h-5.3333023v5.3333023h5.3333023v-5.3333023ZM0,36.3809638l3.6190266,3.6190266h13.714206v-5.3333023H5.3333023v-11.9999302H0v13.714206ZM33.9600959,11.9999247V3.619021L30.3410693-.0000056h-7.6745392v5.3333023h5.9602634v6.6666279h-5.9602634v5.3333023h17.3332326v-5.3333023h-6.0396668ZM5.3333023,0H0v17.3332326h5.3333023v-5.9999651h6.6666279v5.9999651h5.3333023v-5.9999651l-5.3333023-5.3333023h-6.6666279V0ZM17.3332326,0h-5.3333023v5.9999651h5.3333023V0Z";

const AMP_MARK_PATHS: readonly string[] = [
  "M13.9197 13.61L17.3816 26.566L14.242 27.4049L11.2645 16.2643L0.119926 13.2906L0.957817 10.15L13.9197 13.61Z",
  "M13.7391 16.0892L4.88169 24.9056L2.58872 22.6019L11.4461 13.7865L13.7391 16.0892Z",
  "M18.9386 8.58315L22.4005 21.5392L19.2609 22.3781L16.2833 11.2374L5.13879 8.26381L5.97668 5.12318L18.9386 8.58315Z",
  "M23.9803 3.55632L27.4422 16.5124L24.3025 17.3512L21.325 6.21062L10.1805 3.23698L11.0183 0.0963593L23.9803 3.55632Z",
];

const CODEBUDDY_MAIN_PATH =
  "M12.13 1.25c.15-.14.16-.14.28-.15.18 0 .36.08.64.34.68.62 1.61 1.89 2.2 2.97l.22.42.32.16c.3.16.81.48 1.02.65.09.08.11.08.21.04.45-.18 1.09.05 1.65.6.51.49 1 1.33 1.18 2.03.03.11.06.36.07.54.04.64-.16 1.14-.55 1.37-.08.04-.08.06-.08.26.02.95-.23 1.89-.74 2.82-.58 1.04-1.6 2.11-2.98 3.12-.74.55-2.5 1.58-3.3 1.95-1.9.86-3.43 1.2-4.76 1.03-.79-.09-1.69-.41-2.22-.77-.14-.1-.16-.1-.27-.07-.57.16-1.31-.18-1.94-.88-.25-.28-.66-.98-.79-1.35-.3-.87-.25-1.65.16-2.12.11-.12.09-.33.09-.33-.04-.33-.05-.82-.04-1.14v-.3l-.43-.79c-.68-1.23-1.12-2.25-1.28-3.04-.09-.43-.09-.62.02-.77.07-.09.28-.18.54-.22.66-.12 2.09-.01 3.69.27l.16.03.36-.32c.61-.54 1.01-.84 1.75-1.31.77-.48 1.64-.89 2.62-1.2l.32-.1.17-.46c.62-1.65 1.25-2.86 1.71-3.27h0Zm-5.19 8.45c-.7.41-1.05.61-1.3.84-1.04.93-1.43 2.39-.99 3.71.11.33.31.68.71 1.39.41.71.61 1.06.83 1.32.92 1.05 2.37 1.45 3.68 1 .32-.11.68-.31 1.38-.72l4.02-2.34c.7-.41 1.05-.61 1.3-.84 1.04-.93 1.43-2.39.99-3.71-.11-.33-.31-.68-.71-1.39s-.61-1.06-.83-1.32c-.92-1.05-2.37-1.45-3.68-1-.32.11-.67.31-1.38.72l-4.02 2.34Z";

const MUSE_WAVE_PATH =
  "M9.12 5.39C9.87 5.39 10.39 5.85 10.39 6.72C10.39 7.59 10.23 8.77 10.02 10.34C9.88 11.54 9.65 13.08 9.54 13.76C9.77 13.32 10.3 12.31 10.39 12.11C11.5 9.87 12.67 7.87 13.01 7.33C13.45 6.6 13.9 6.32 14.47 6.32C15.21 6.32 15.62 6.91 15.62 7.87C15.62 8.62 15.51 9.95 15.36 11.34C15.29 11.95 15.18 13.21 15.1 14.05C15.82 12.77 17.15 10.41 17.69 9.59C18.15 8.87 18.62 8.41 19.29 8.41C19.88 8.41 20.46 8.78 20.43 9.8C20.36 11.31 20.15 14.53 20.05 16.01C20.85 14.83 21.55 13.7 21.9 13.12C22.23 12.57 22.55 12.11 23.15 12.11C23.66 12.11 24 12.45 24 13.02C24 13.59 23.59 14.29 23.23 14.92C22.87 15.55 22.16 16.59 21.73 17.13C21.32 17.65 21.03 17.97 20.75 18.18C20.41 18.46 20.06 18.61 19.54 18.61C19.08 18.61 18.7 18.46 18.44 18.18C18.16 17.89 18.03 17.46 18.01 16.94C18 16.41 18.06 15.44 18.15 14.58C18.23 13.57 18.33 12.61 18.4 11.96C17.68 13.28 16.17 16 15.49 17.07C14.83 18.12 14.52 18.48 13.82 18.48C13.11 18.48 12.82 17.99 12.8 17.23C12.79 16.41 13.39 11.58 13.61 9.88C13.24 10.64 12.43 12.34 11.93 13.36C11.42 14.41 10.55 16.17 9.94 17.2C9.5 17.94 8.98 18.48 8.24 18.48C7.5 18.48 7.16 17.9 7.16 17.08C7.16 16.26 7.3 15.05 7.57 13.39C7.66 12.79 8.17 9.58 8.4 8.16C8.08 8.66 7.6 9.42 7.27 9.87C6.9 10.37 6.6 10.57 6.18 10.57C5.93 10.57 5.72 10.45 5.57 10.31C5.39 10.14 5.28 9.9 5.28 9.64C5.28 9.27 5.38 8.95 5.87 8.29C6.37 7.58 6.95 6.82 7.45 6.3C8.02 5.71 8.51 5.39 9.12 5.39Z";
const MUSE_CHEVRON_PATH =
  "M0.98 6.3C1.54 6.3 1.85 6.63 2.31 7.32C2.76 8.01 4.16 10.1 4.62 10.82C5.04 11.49 5.22 11.81 5.22 12.29C5.22 12.76 4.97 13.23 4.51 14.03C4.05 14.74 2.76 16.77 2.31 17.46C1.85 18.15 1.53 18.48 0.97 18.48C0.35 18.48 0 18.01 0 17.54C0 17.08 0.27 16.76 0.59 16.28C1.22 15.35 2.71 13.06 3.18 12.39C2.69 11.66 1.08 9.29 0.61 8.58C0.29 8.1 0 7.72 0 7.24C0 6.76 0.35 6.3 0.98 6.3Z";

const OPENHANDS_LEFT_HAND_PATH =
  "M4.2 14.6C3.5 11.2 4.4 7.5 6.8 5.1C7.3 4.6 8.1 4.9 8.1 5.6V10.6C8.1 11.1 8.8 11.3 9.1 10.8L10.3 8.5C10.7 7.8 11.7 8.1 11.7 8.9V18.8C11.7 19.6 10.9 20.1 10.2 19.8C7.1 18.6 4.8 16.9 4.2 14.6Z";
const OPENHANDS_RIGHT_HAND_PATH =
  "M19.8 14.6C20.5 11.2 19.6 7.5 17.2 5.1C16.7 4.6 15.9 4.9 15.9 5.6V10.6C15.9 11.1 15.2 11.3 14.9 10.8L13.7 8.5C13.3 7.8 12.3 8.1 12.3 8.9V18.8C12.3 19.6 13.1 20.1 13.8 19.8C16.9 18.6 19.2 16.9 19.8 14.6Z";

const HERMES_WINGS_PATH =
  "M12 4.2L13.4 9.1H10.6L12 4.2ZM10.9 10.7H13.1V19.6C13.1 20.2 12.6 20.7 12 20.7C11.4 20.7 10.9 20.2 10.9 19.6V10.7ZM1.8 6.6C5.1 6.7 7.9 7.8 9.9 10.2L9.2 12.4C6.9 11.3 4.5 10.3 2.5 8.8C1.7 8.2 1.2 7.2 1.8 6.6ZM3.7 11.2C5.8 11.8 7.7 12.7 9.3 14L8.8 15.9C6.8 15.1 5 14 3.5 12.6C3 12.1 3.1 11.1 3.7 11.2ZM22.2 6.6C18.9 6.7 16.1 7.8 14.1 10.2L14.8 12.4C17.1 11.3 19.5 10.3 21.5 8.8C22.3 8.2 22.8 7.2 22.2 6.6ZM20.3 11.2C18.2 11.8 16.3 12.7 14.7 14L15.2 15.9C17.2 15.1 19 14 20.5 12.6C21 12.1 20.9 11.1 20.3 11.2Z";

export const DSH_BRAND_COLOR = "#4176E6";
export const DSH_FISH_LOGO_VIEWBOX = "0 0 23.16 17.04";
export const DSH_FISH_LOGO_PATH =
  "M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z";
export const PI_LOGO_VIEWBOX = "165.29 165.29 469.43 469.43";
export const PI_LOGO_FRAME_PATH =
  "M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z";
export const PI_LOGO_DOT_PATH = "M517.36 400H634.72V634.72H517.36Z";

/**
 * Official Google Antigravity A-arch silhouette (24x24 viewBox), fitted 1:1 to
 * the native Antigravity application icon (smooth parabolic crown, flared concave
 * flanks, rounded legs, and open inner arch).
 */
export const ANTIGRAVITY_LOGO_PATH =
  "M 12 2.81 C 14.78 2.81 16.10 5.30 17.78 11.94 C 18.92 16.45 20.22 18.58 21.64 20.02 C 22.18 20.56 21.88 21.22 21.02 21.19 C 20.48 21.17 20.08 20.84 19.62 20.46 C 17.92 19.10 16.96 17.42 15.72 15.20 C 14.75 13.68 13.86 12.75 12.00 12.75 C 10.14 12.75 9.25 13.68 8.28 15.20 C 7.04 17.42 6.08 19.10 4.38 20.46 C 3.92 20.84 3.52 21.17 2.98 21.19 C 2.12 21.22 1.82 20.56 2.36 20.02 C 3.78 18.58 5.08 16.45 6.22 11.94 C 7.90 5.30 9.22 2.81 12 2.81 Z";

/**
 * Renders the interior SVG elements (`<defs>` + clipped Google 4-color fluid mesh
 * `#34A853` green -> `#FBBC04` yellow -> `#EA4335` red -> `#4285F4` blue) for the
 * official Google Antigravity icon using caller-supplied `useId()` prefix to prevent
 * multi-instance gradient/clipPath ID collisions.
 */
export function renderAntigravitySvgContent(
  idPrefix: string,
  monochrome = false,
): readonly ReactElement[] {
  if (monochrome) {
    return [
      createElement("path", {
        key: "mono",
        d: ANTIGRAVITY_LOGO_PATH,
        fill: "currentColor",
      }),
    ];
  }

  const clipId = `${idPrefix}-agy-clip`;
  const baseGradId = `${idPrefix}-agy-base`;
  const greenGradId = `${idPrefix}-agy-green`;
  const yellowGradId = `${idPrefix}-agy-yellow`;
  const redGradId = `${idPrefix}-agy-red`;
  const bellyGradId = `${idPrefix}-agy-belly`;

  return [
    createElement(
      "defs",
      { key: "defs" },
      createElement(
        "clipPath",
        { id: clipId },
        createElement("path", { d: ANTIGRAVITY_LOGO_PATH }),
      ),
      createElement(
        "linearGradient",
        {
          id: baseGradId,
          x1: "2.5",
          y1: "21",
          x2: "18.5",
          y2: "5",
          gradientUnits: "userSpaceOnUse",
        },
        createElement("stop", { offset: "0%", stopColor: "#60A8FC" }),
        createElement("stop", { offset: "30%", stopColor: "#4285F4" }),
        createElement("stop", { offset: "68%", stopColor: "#3186FF" }),
        createElement("stop", { offset: "100%", stopColor: "#4285F4" }),
      ),
      createElement(
        "radialGradient",
        {
          id: greenGradId,
          cx: "7.4",
          cy: "6.6",
          r: "6.8",
          gradientUnits: "userSpaceOnUse",
        },
        createElement("stop", { offset: "0%", stopColor: "#34A853", stopOpacity: 0.98 }),
        createElement("stop", { offset: "42%", stopColor: "#4CC25E", stopOpacity: 0.72 }),
        createElement("stop", { offset: "100%", stopColor: "#34A853", stopOpacity: 0 }),
      ),
      createElement(
        "radialGradient",
        {
          id: yellowGradId,
          cx: "10.4",
          cy: "3.0",
          r: "5.5",
          gradientUnits: "userSpaceOnUse",
        },
        createElement("stop", { offset: "0%", stopColor: "#FBBC04", stopOpacity: 1 }),
        createElement("stop", { offset: "50%", stopColor: "#FBBC04", stopOpacity: 0.78 }),
        createElement("stop", { offset: "100%", stopColor: "#FBBC04", stopOpacity: 0 }),
      ),
      createElement(
        "radialGradient",
        {
          id: redGradId,
          cx: "14.9",
          cy: "4.4",
          r: "6.8",
          gradientUnits: "userSpaceOnUse",
        },
        createElement("stop", { offset: "0%", stopColor: "#EA4335", stopOpacity: 0.98 }),
        createElement("stop", { offset: "44%", stopColor: "#F25C43", stopOpacity: 0.72 }),
        createElement("stop", { offset: "100%", stopColor: "#EA4335", stopOpacity: 0 }),
      ),
      createElement(
        "radialGradient",
        {
          id: bellyGradId,
          cx: "12.0",
          cy: "12.4",
          r: "5.4",
          gradientUnits: "userSpaceOnUse",
        },
        createElement("stop", { offset: "0%", stopColor: "#3589FF", stopOpacity: 0.88 }),
        createElement("stop", { offset: "55%", stopColor: "#4285F4", stopOpacity: 0.42 }),
        createElement("stop", { offset: "100%", stopColor: "#4285F4", stopOpacity: 0 }),
      ),
    ),
    createElement(
      "g",
      { key: "mesh", clipPath: `url(#${clipId})` },
      createElement("rect", { x: 0, y: 0, width: 24, height: 24, fill: `url(#${baseGradId})` }),
      createElement("rect", { x: 0, y: 0, width: 24, height: 24, fill: `url(#${greenGradId})` }),
      createElement("rect", { x: 0, y: 0, width: 24, height: 24, fill: `url(#${yellowGradId})` }),
      createElement("rect", { x: 0, y: 0, width: 24, height: 24, fill: `url(#${redGradId})` }),
      createElement("rect", { x: 0, y: 0, width: 24, height: 24, fill: `url(#${bellyGradId})` }),
    ),
  ];
}

export interface AgentBrandLogoProps {
  /** Provider ID, driver kind, or display name (e.g. "codex", "claudeAgent", "antigravity", "dsh", "glm-acp-agent"). */
  readonly provider: string | null | undefined;
  /** Online status: false renders calm low-saturation resting state (default true). */
  readonly online?: boolean;
  /** Enable gentle luminance breathing pulse when online (default false). */
  readonly breathing?: boolean;
  /** Rendered SVG width/height in pixels (default 14). */
  readonly size?: number;
  /** Extra classes for the outer wrapper span. */
  readonly className?: string;
  /** Extra classes for the inner SVG element. */
  readonly iconClassName?: string;
  /** Use currentColor monochrome fill instead of vendor brand pigment (default false). */
  readonly monochrome?: boolean;
  /** Optional accessible title; omit for decorative icons inside labeled buttons. */
  readonly title?: string;
}

function resolveMonogramInitials(raw: string | null | undefined): string {
  const cleaned = typeof raw === "string" ? stripUuidNoise(stripAcpPrefix(raw)).trim() : "";
  if (!cleaned) return "AC";
  const initials = providerInstanceInitials(cleaned).trim();
  return initials.length > 0 ? initials : "AC";
}

/**
 * Renders the bundled official brand vector SVG for any known `AgentBrandId`
 * (or a sleek rounded-square monogram mark for truly unknown custom agents — NEVER a generic hexagon nut).
 */
export function renderBundledBrandSvg(options: {
  readonly brandId: AgentBrandId;
  readonly gradientPrefix: string;
  readonly monochrome?: boolean | undefined;
  readonly size?: number | undefined;
  readonly className?: string | undefined;
  readonly fallbackLabel?: string | null | undefined;
  readonly dataAttributes?: Readonly<Record<string, string | undefined>> | undefined;
}): ReactElement {
  const {
    brandId,
    gradientPrefix,
    monochrome = false,
    size,
    className,
    fallbackLabel,
    dataAttributes,
  } = options;

  const baseProps = {
    ...(size !== undefined
      ? {
          width: size,
          height: size,
          style: { width: size, height: size, display: "block" } satisfies CSSProperties,
        }
      : {}),
    className,
    "aria-hidden": true as const,
    focusable: false as const,
    ...dataAttributes,
  };

  switch (brandId) {
    case "codex":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "100 100 411 411", fill: "currentColor" },
        createElement("path", {
          fillRule: "evenodd",
          clipRule: "evenodd",
          d: OPENAI_CODEX_PATH,
        }),
      );

    case "claude-code":
      return createElement(
        "svg",
        {
          ...baseProps,
          viewBox: "0 0 256 257",
          fill: monochrome ? "currentColor" : "#d97757",
        },
        createElement("path", { d: CLAUDE_STARBURST_PATH }),
      );

    case "antigravity":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 24 24", fill: "none" },
        ...renderAntigravitySvgContent(gradientPrefix, monochrome),
      );

    case "gemini": {
      const gradId = `${gradientPrefix}-gemini`;
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 24 24", fill: "none" },
        monochrome
          ? null
          : createElement(
              "defs",
              null,
              createElement(
                "linearGradient",
                { id: gradId, x1: "2", y1: "2", x2: "22", y2: "22", gradientUnits: "userSpaceOnUse" },
                createElement("stop", { offset: "0%", stopColor: "#4285F4" }),
                createElement("stop", { offset: "55%", stopColor: "#9B72CB" }),
                createElement("stop", { offset: "100%", stopColor: "#D96570" }),
              ),
            ),
        createElement("path", {
          d: GEMINI_SPARK_PATH,
          fill: monochrome ? "currentColor" : `url(#${gradId})`,
        }),
      );
    }

    case "opencode":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 32 40", fill: "currentColor" },
        createElement("path", { d: "M24 32H8V16H24V32Z", opacity: 0.35 }),
        createElement("path", { d: "M24 8H8V32H24V8ZM32 40H0V0H32V40Z", fillRule: "evenodd" }),
      );

    case "pi":
      return createElement(
        "svg",
        { ...baseProps, viewBox: PI_LOGO_VIEWBOX, fill: "currentColor" },
        createElement("path", { d: PI_LOGO_FRAME_PATH, fillRule: "evenodd" }),
        createElement("path", { d: PI_LOGO_DOT_PATH }),
      );

    case "cursor":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 466.73 532.09", fill: "currentColor" },
        createElement("path", { d: CURSOR_PRISM_PATH }),
      );

    case "dsh":
      return createElement(
        "svg",
        {
          ...baseProps,
          viewBox: DSH_FISH_LOGO_VIEWBOX,
          fill: monochrome ? "currentColor" : DSH_BRAND_COLOR,
        },
        createElement("path", { d: DSH_FISH_LOGO_PATH }),
      );

    case "glm":
      return createElement(
        "svg",
        {
          ...baseProps,
          viewBox: "0 0 16 16",
          fill: monochrome ? "currentColor" : GLM_BRAND_COLOR,
        },
        createElement("path", {
          d: GLM_ZAI_PATH,
          fillRule: "evenodd",
          clipRule: "evenodd",
        }),
      );

    case "qwen":
      return createElement(
        "svg",
        {
          ...baseProps,
          viewBox: "0 0 141.38 140",
          fill: monochrome ? "currentColor" : QWEN_BRAND_COLOR,
        },
        createElement("path", { d: QWEN_MARK_PATH }),
      );

    case "kimi":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 24 24", fill: "currentColor" },
        createElement("path", { d: KIMI_MOONSHOT_PATH }),
      );

    case "github-copilot":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 16 16", fill: "currentColor" },
        createElement("path", {
          d: GITHUB_COPILOT_SHELL_PATH,
          fillRule: "evenodd",
          clipRule: "evenodd",
        }),
        createElement("path", { d: GITHUB_COPILOT_EYE_L_PATH }),
        createElement("path", { d: GITHUB_COPILOT_EYE_R_PATH }),
      );

    case "mistral-vibe":
      return createElement(
        "svg",
        {
          ...baseProps,
          viewBox: "0 0 28 28",
          fill: monochrome ? "currentColor" : MISTRAL_BRAND_COLOR,
        },
        ...MISTRAL_PIXEL_PATHS.map((d, index) => createElement("path", { key: index, d })),
      );

    case "factory-droid":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 900 900", fill: "currentColor" },
        createElement("path", { d: FACTORY_DROID_PATH }),
      );

    case "cline":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 92 96", fill: "currentColor" },
        createElement("path", { d: CLINE_SHELL_PATH }),
        createElement("circle", { cx: 45.73, cy: 11, r: 11 }),
        createElement("rect", {
          x: 31,
          y: 44.5,
          width: 5,
          height: 22,
          rx: 2.5,
          stroke: "currentColor",
          strokeWidth: 8,
        }),
        createElement("rect", {
          x: 55,
          y: 44.5,
          width: 5,
          height: 22,
          rx: 2.5,
          stroke: "currentColor",
          strokeWidth: 8,
        }),
      );

    case "goose":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 24 24", fill: "currentColor" },
        createElement("path", { d: GOOSE_MARK_PATH }),
      );

    case "auggie":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 16 16", fill: "currentColor" },
        createElement("path", { d: AUGGIE_BRACKETS_PATH }),
        createElement("path", { d: AUGGIE_FACE_PATH }),
      );

    case "devin":
      return createElement(
        "svg",
        {
          ...baseProps,
          viewBox: "0 0 263 300",
          fill: monochrome ? "currentColor" : DEVIN_BRAND_COLOR,
        },
        createElement("path", { d: DEVIN_MARK_PATH }),
      );

    case "kiro":
      return createElement(
        "svg",
        {
          ...baseProps,
          viewBox: "0 0 32 32",
          fill: monochrome ? "currentColor" : KIRO_BRAND_COLOR,
        },
        createElement("path", {
          d: KIRO_GHOST_PATH,
          fillRule: "evenodd",
          clipRule: "evenodd",
        }),
      );

    case "openhands":
      return createElement(
        "svg",
        {
          ...baseProps,
          viewBox: "0 0 24 24",
          fill: monochrome ? "currentColor" : OPENHANDS_BRAND_COLOR,
        },
        createElement("path", { d: OPENHANDS_LEFT_HAND_PATH }),
        createElement("path", { d: OPENHANDS_RIGHT_HAND_PATH }),
      );

    case "hermes":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 24 24", fill: "currentColor" },
        createElement("path", { d: HERMES_WINGS_PATH }),
      );

    case "minimax":
      return createElement(
        "svg",
        {
          ...baseProps,
          viewBox: "0 0 16 16",
          fill: monochrome ? "currentColor" : MINIMAX_BRAND_COLOR,
        },
        createElement("path", { d: MINIMAX_MARK_PATH }),
      );

    case "grok":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 16 16", fill: "currentColor" },
        createElement("path", { d: GROK_MARK_PATH }),
      );

    case "kilo":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 40 40", fill: "currentColor" },
        createElement("path", { d: KILO_MARK_PATH }),
      );

    case "junie":
      return createElement(
        "svg",
        {
          ...baseProps,
          viewBox: "0 0 40 40",
          fill: monochrome ? "currentColor" : JUNIE_BRAND_COLOR,
        },
        createElement("path", {
          d: "M25 15H35V16.75C35 29 30.5001 35 16.5001 35H15V25H16.5001C22.6251 25 25 22.875 25 16.75V15Z",
        }),
        createElement("rect", { x: 5, y: 15, width: 10, height: 10 }),
        createElement("rect", { x: 15, y: 5, width: 10, height: 10 }),
      );

    case "amp":
      return createElement(
        "svg",
        {
          ...baseProps,
          viewBox: "0 0 28 28",
          fill: monochrome ? "currentColor" : AMP_BRAND_COLOR,
        },
        ...AMP_MARK_PATHS.map((d, index) => createElement("path", { key: index, d })),
      );

    case "codebuddy":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 16 16", fill: "currentColor" },
        createElement("path", { d: CODEBUDDY_MAIN_PATH }),
        createElement("path", {
          d: "M8.02 12.13c.38-.22.87-.09 1.09.29l.86 1.5c.22.38.09.88-.29 1.09-.38.22-.86.09-1.09-.29l-.86-1.5c-.22-.38-.09-.87.29-1.09Z",
          fillOpacity: 0.4,
        }),
        createElement("path", {
          d: "M12.31 9.64c.38-.22.87-.09 1.09.29l.86 1.5c.22.38.09.87-.29 1.09s-.87.09-1.09-.29l-.86-1.5c-.22-.38-.09-.88.29-1.09Z",
          fillOpacity: 0.4,
        }),
      );

    case "muse":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 24 24", fill: "currentColor" },
        createElement("path", { d: MUSE_WAVE_PATH }),
        createElement("path", { d: MUSE_CHEVRON_PATH }),
      );

    case "acp":
    case "custom":
    default: {
      const initials = resolveMonogramInitials(fallbackLabel);
      return createElement(
        "svg",
        {
          ...baseProps,
          viewBox: "0 0 24 24",
          fill: "none",
          "data-agent-brand-monogram": initials,
        },
        createElement("rect", {
          x: 2,
          y: 2,
          width: 20,
          height: 20,
          rx: 6,
          fill: "currentColor",
          fillOpacity: 0.1,
          stroke: "currentColor",
          strokeOpacity: 0.35,
          strokeWidth: 1.5,
        }),
        createElement(
          "text",
          {
            x: 12,
            y: 12.6,
            textAnchor: "middle",
            dominantBaseline: "central",
            fill: "currentColor",
            fontSize: initials.length > 1 ? 9.5 : 11,
            fontWeight: 700,
            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
            letterSpacing: "-0.02em",
          },
          initials,
        ),
      );
    }
  }
}

/**
 * Official vendor SVG logo with gentle luminance breathing animation when online.
 * Respects `prefers-reduced-motion: reduce` and `[data-pmx-gpu="0"]` static degradation.
 */
export const AgentBrandLogo = memo(function AgentBrandLogo({
  provider,
  online = true,
  breathing = false,
  size = 14,
  className,
  iconClassName,
  monochrome = false,
  title,
}: AgentBrandLogoProps): ReactElement {
  const rawId = useId();
  const gradientPrefix = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const meta = getAgentBrandMeta(provider);
  const isBreathing = online && breathing;

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- injects one-time CSS breathing keyframes style element into document.head
  useEffect(() => {
    ensureAgentBrandStyles();
  }, []);

  const wrapperStyle = {
    "--pmx-brand-glow": meta.glowColor,
    width: size,
    height: size,
  } as CSSProperties;

  return createElement(
    "span",
    {
      className: className ? `pmx-agent-brand-logo ${className}` : "pmx-agent-brand-logo",
      "data-agent-brand": meta.id,
      "data-online": String(online),
      "data-breathing": String(isBreathing),
      style: wrapperStyle,
      title,
      ...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true }),
    },
    renderBundledBrandSvg({
      brandId: meta.id,
      gradientPrefix,
      monochrome,
      size,
      className: iconClassName,
      fallbackLabel: provider,
    }),
  );
});
