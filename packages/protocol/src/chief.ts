export const CHIEF_PROVIDER_KINDS = [
  "claude-code",
  "codex",
  "antigravity",
  "gemini",
  "opencode",
  "cursor",
  "acp"
] as const;

export type ChiefProviderKind = (typeof CHIEF_PROVIDER_KINDS)[number];

export const CHIEF_PROVIDER_ALIASES: Readonly<Record<string, ChiefProviderKind>> = {
  "claude-code": "claude-code",
  claude: "claude-code",
  claudeagent: "claude-code",
  "claude-agent": "claude-code",
  claude_agent: "claude-code",
  claudecode: "claude-code",
  claude_code: "claude-code",
  "claude code": "claude-code",
  codex: "codex",
  "openai-codex": "codex",
  openai_codex: "codex",
  "openai codex": "codex",
  antigravity: "antigravity",
  "antigravity-cli": "antigravity",
  antigravity_cli: "antigravity",
  "antigravity cli": "antigravity",
  agy: "antigravity",
  gemini: "gemini",
  "gemini-cli": "gemini",
  gemini_cli: "gemini",
  "gemini cli": "gemini",
  opencode: "opencode",
  "open-code": "opencode",
  open_code: "opencode",
  "open code": "opencode",
  cursor: "cursor",
  "cursor-cli": "cursor",
  "cursor-agent": "cursor",
  acp: "acp",
  acpregistry: "acp",
  "acp-registry": "acp",
  acp_registry: "acp"
};

/**
 * Normalizes a Chief provider ID or well-known alias (e.g. `claudeAgent` -> `claude-code`,
 * `agy` -> `antigravity`) into a canonical `ChiefProviderKind`, returning `null` if unknown.
 */
export function normalizeChiefProviderKind(value: unknown): ChiefProviderKind | null {
  if (typeof value !== "string") {
    return null;
  }
  const key = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) {
    return null;
  }
  return CHIEF_PROVIDER_ALIASES[key] ?? null;
}

const REASONING_EFFORT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/;

export const DEFAULT_CHIEF_SECRETARY_NAME = "主秘书" as const;
export const CHIEF_AGENTS_MD_DIR = "chief" as const;
export const CHIEF_AGENTS_MD_FILENAME = "AGENTS.md" as const;
export const MAX_CHIEF_SECRETARY_NAME_LENGTH = 32;

/**
 * Normalizes an optional Chief Secretary custom name.
 * - `undefined` -> `undefined` (leave unchanged)
 * - `null` / empty string -> `DEFAULT_CHIEF_SECRETARY_NAME` (`"主秘书"`)
 * - Non-string or > 32 chars -> `null` (invalid)
 */
export function normalizeChiefSecretaryName(value: unknown): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return DEFAULT_CHIEF_SECRETARY_NAME;
  }
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value
    .replace(/[\r\n\t\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) {
    return DEFAULT_CHIEF_SECRETARY_NAME;
  }
  if (Array.from(cleaned).length > MAX_CHIEF_SECRETARY_NAME_LENGTH) {
    return null;
  }
  return cleaned;
}

/**
 * Normalizes an optional reasoning effort token (`undefined`/`null`/`""`/`"default"` -> `undefined`).
 * Returns `null` when the supplied value is syntactically invalid.
 */
export function normalizeChiefReasoningEffort(value: unknown): string | undefined | null {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === "default") {
    return undefined;
  }
  if (!REASONING_EFFORT_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

export interface ChiefSwitchRecord {
  fromProvider?: ChiefProviderKind;
  toProvider: ChiefProviderKind;
  model?: string;
  reasoningEffort?: string;
  switchedAt: number;
}

export interface ChiefSwitchRequest {
  provider: ChiefProviderKind;
  model?: string;
  reasoningEffort?: string;
  defaultEffort?: string;
  secretaryName?: string;
}

export interface ChiefProfileUpdateRequest {
  secretaryName?: string;
}

export interface ChiefAgentsMdResponse {
  ok: boolean;
  path: string;
  content: string;
  updatedAt: number;
  secretaryName: string;
}

export interface ChiefAgentsMdUpdateRequest {
  content?: string;
  reset?: boolean;
}

export interface ChiefSystemContext {
  secretaryName: string;
  agentsMdPath: string;
  agentsMdContent: string;
  activeProvider: ChiefProviderKind;
  model?: string;
  systemPrompt: string;
}

export interface ChiefThreadSlotState {
  threadId: string;
  workspacePath: string;
  activeProvider: ChiefProviderKind;
  secretaryName?: string;
  agentsMdPath: string;
  model?: string;
  reasoningEffort?: string;
  defaultEffort?: string;
  injectedMcpServers: string[];
  createdAt: number;
  updatedAt: number;
  switchHistory: ChiefSwitchRecord[];
}

export type T3SupervisorState =
  | "stopped"
  | "starting"
  | "running"
  | "restarting"
  | "failed";

export interface T3BridgeStatus {
  supervisorState: T3SupervisorState;
  rpcConnected: boolean;
  wsUrl: string;
  protocolVersion: string;
  pid?: number;
  restartCount: number;
  lastError?: string;
}

export interface DaemonPairingInfo {
  pairingCode: string;
  expiresAt: number;
  daemonUrl: string;
}

export interface DaemonHealthResponse {
  ok: boolean;
  headless: boolean;
  version: string;
  t3Connected: boolean;
  supervisorState: T3SupervisorState;
  activeProvider: ChiefProviderKind;
  ptyCount: number;
  uptimeMs: number;
}
