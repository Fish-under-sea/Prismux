/**
 * Official Agent/CLI homepage metadata, strict `https:` URL validation,
 * official CLI update guidance (no silent closed-source binary downloads), and one-click `dsh` preset.
 */

import { CANONICAL_PROVIDER_DISPLAY_NAMES } from "../../prismux/agentBrand";
import { resolveConfiguredProviderDisplayName } from "../../prismux/providerDisplayName";
import type { ProviderInstanceEntry } from "../../providerInstances";

export interface PrismuxAgentCliMeta {
  readonly id: string;
  readonly displayName: string;
  readonly cliCommand: string;
  readonly homepageUrl: string;
  readonly updateCommandHint: string;
  readonly loginHint?: string;
  readonly supportsCliMode: boolean;
  readonly supportsResume: boolean;
  readonly buildResumeCommand: (input: {
    readonly command: string;
    readonly sessionId?: string | null;
  }) => string;
}

export const DSH_LOCAL_ACP_PRESET = {
  id: "dsh",
  label: `${CANONICAL_PROVIDER_DISPLAY_NAMES.dsh} (dsh)`,
  instanceId: "dsh",
  command: "dsh",
  args: ["acp"] as readonly string[],
  homepageUrl: "https://github.com/deepseek-ai/deepseek-harness",
} as const;

const SAFE_SESSION_ID_PATTERN = /^[a-zA-Z0-9._:@/-]{1,128}$/;

/**
 * Strictly validates that an external URL uses the `https:` protocol and contains no control characters.
 * Rejects `http:`, `javascript:`, `data:`, `file:`, `vbscript:`, or malformed strings.
 */
export function validateSafeHttpsUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function openSafeExternalHttpsUrl(rawUrl: string | null | undefined): boolean {
  const safeUrl = validateSafeHttpsUrl(rawUrl);
  if (!safeUrl || typeof window === "undefined") return false;
  if (window.desktopBridge?.openExternal) {
    void window.desktopBridge.openExternal(safeUrl);
    return true;
  }
  window.open(safeUrl, "_blank", "noopener,noreferrer");
  return true;
}

export interface SafeAnchorClickEvent {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly currentTarget: { readonly href: string; readonly protocol: string };
  readonly preventDefault: () => void;
}

/**
 * Aligned with stablyai/orca `openAppHttpLinkFromAnchor`, tightened to Prismux's `https:`-only red line.
 * Intercepts plain left-clicks to route through Electron's safe `openExternal` bridge while preserving
 * native middle-click / modifier-click / context-menu link behavior.
 */
export function openSafeExternalHttpsFromAnchor(event: SafeAnchorClickEvent): boolean {
  const plainLeftClick =
    event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  if (!plainLeftClick) return false;
  const safeUrl = validateSafeHttpsUrl(event.currentTarget.href);
  if (!safeUrl) {
    event.preventDefault();
    return false;
  }
  event.preventDefault();
  return openSafeExternalHttpsUrl(safeUrl);
}

/**
 * Resolves the canonical CLI executable process family for quota/process deduplication
 * (aligned with stablyai/orca `TUI_AGENT_CONFIG[agent].expectedProcess`).
 */
export function resolveAgentCliProcessFamily(input: {
  readonly driver: string;
  readonly instanceId?: string | null;
  readonly config?: unknown;
}): string {
  const meta = resolveAgentCliMeta(input);
  if (meta?.cliCommand) {
    return meta.cliCommand.toLowerCase();
  }
  return input.driver.trim().toLowerCase();
}

export function quoteShellToken(token: string): string {
  if (/^[a-zA-Z0-9._:/\\-]+$/.test(token)) {
    return token;
  }
  return `"${token.replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * Quotes a CLI executable for interactive shell execution.
 * Windows paths containing spaces (e.g. `C:\Program Files\Codex\codex.cmd`) require
 * PowerShell's call operator (`& '...'`) without backslash double-escaping so the shell
 * executes the binary instead of printing a string literal.
 */
export function quoteShellExecutable(executable: string): string {
  if (/^[a-zA-Z0-9._:/\\-]+$/.test(executable)) {
    return executable;
  }
  if (/^[a-zA-Z]:[\\/]/.test(executable) || executable.includes("\\")) {
    return `& '${executable.replace(/'/g, "''")}'`;
  }
  return quoteShellToken(executable);
}

export function sanitizeResumeSessionId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || !SAFE_SESSION_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export const PRISMUX_AGENT_CLI_CATALOG: Readonly<Record<string, PrismuxAgentCliMeta>> = {
  antigravity: {
    id: "antigravity",
    displayName: CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity,
    cliCommand: "agy",
    homepageUrl: "https://antigravity.google/",
    updateCommandHint: "agy update",
    loginHint: "agy acp --login",
    supportsCliMode: true,
    supportsResume: false,
    buildResumeCommand: ({ command }) => quoteShellExecutable(command || "agy"),
  },
  agy: {
    id: "agy",
    displayName: CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity,
    cliCommand: "agy",
    homepageUrl: "https://antigravity.google/",
    updateCommandHint: "agy update",
    loginHint: "agy acp --login",
    supportsCliMode: true,
    supportsResume: false,
    buildResumeCommand: ({ command }) => quoteShellExecutable(command || "agy"),
  },
  claudeAgent: {
    id: "claudeAgent",
    displayName: CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent,
    cliCommand: "claude",
    homepageUrl: "https://docs.anthropic.com/en/docs/claude-code/overview",
    updateCommandHint: "claude update",
    supportsCliMode: true,
    supportsResume: true,
    buildResumeCommand: ({ command, sessionId }) => {
      const exe = quoteShellExecutable(command || "claude");
      const safeId = sanitizeResumeSessionId(sessionId);
      return safeId ? `${exe} --resume ${quoteShellToken(safeId)}` : `${exe} --continue`;
    },
  },
  claude: {
    id: "claude",
    displayName: CANONICAL_PROVIDER_DISPLAY_NAMES.claude,
    cliCommand: "claude",
    homepageUrl: "https://docs.anthropic.com/en/docs/claude-code/overview",
    updateCommandHint: "claude update",
    supportsCliMode: true,
    supportsResume: true,
    buildResumeCommand: ({ command, sessionId }) => {
      const exe = quoteShellExecutable(command || "claude");
      const safeId = sanitizeResumeSessionId(sessionId);
      return safeId ? `${exe} --resume ${quoteShellToken(safeId)}` : `${exe} --continue`;
    },
  },
  codex: {
    id: "codex",
    displayName: CANONICAL_PROVIDER_DISPLAY_NAMES.codex,
    cliCommand: "codex",
    homepageUrl: "https://github.com/openai/codex",
    updateCommandHint: "npm install -g @openai/codex@latest",
    supportsCliMode: true,
    supportsResume: true,
    buildResumeCommand: ({ command, sessionId }) => {
      const exe = quoteShellExecutable(command || "codex");
      const safeId = sanitizeResumeSessionId(sessionId);
      return safeId ? `${exe} resume ${quoteShellToken(safeId)}` : exe;
    },
  },
  dsh: {
    id: "dsh",
    displayName: `${CANONICAL_PROVIDER_DISPLAY_NAMES.dsh} (dsh)`,
    cliCommand: "dsh",
    homepageUrl: "https://github.com/deepseek-ai/deepseek-harness",
    updateCommandHint: "npm install -g @deepseek-ai/dsh@latest",
    supportsCliMode: true,
    supportsResume: false,
    buildResumeCommand: ({ command }) => quoteShellExecutable(command || "dsh"),
  },
  opencode: {
    id: "opencode",
    displayName: CANONICAL_PROVIDER_DISPLAY_NAMES.opencode,
    cliCommand: "opencode",
    homepageUrl: "https://opencode.ai",
    updateCommandHint: "opencode upgrade",
    supportsCliMode: true,
    supportsResume: true,
    buildResumeCommand: ({ command, sessionId }) => {
      const exe = quoteShellExecutable(command || "opencode");
      const safeId = sanitizeResumeSessionId(sessionId);
      return safeId ? `${exe} --session ${quoteShellToken(safeId)}` : exe;
    },
  },
  gemini: {
    id: "gemini",
    displayName: CANONICAL_PROVIDER_DISPLAY_NAMES.gemini,
    cliCommand: "gemini",
    homepageUrl: "https://github.com/google-gemini/gemini-cli",
    updateCommandHint: "npm install -g @google/gemini-cli@latest",
    supportsCliMode: true,
    supportsResume: true,
    buildResumeCommand: ({ command, sessionId }) => {
      const exe = quoteShellExecutable(command || "gemini");
      const safeId = sanitizeResumeSessionId(sessionId);
      return safeId ? `${exe} --resume ${quoteShellToken(safeId)}` : exe;
    },
  },
  pi: {
    id: "pi",
    displayName: CANONICAL_PROVIDER_DISPLAY_NAMES.pi,
    cliCommand: "pi",
    homepageUrl: "https://github.com/badlogic/pi-mono",
    updateCommandHint: "npm install -g @mariozechner/pi-coding-agent@latest",
    supportsCliMode: true,
    supportsResume: true,
    buildResumeCommand: ({ command, sessionId }) => {
      const exe = quoteShellExecutable(command || "pi");
      const safeId = sanitizeResumeSessionId(sessionId);
      return safeId ? `${exe} --continue ${quoteShellToken(safeId)}` : exe;
    },
  },
  cursor: {
    id: "cursor",
    displayName: CANONICAL_PROVIDER_DISPLAY_NAMES.cursor,
    cliCommand: "cursor-agent",
    homepageUrl: "https://cursor.com/cli",
    updateCommandHint: "cursor-agent update",
    supportsCliMode: true,
    supportsResume: false,
    buildResumeCommand: ({ command }) => quoteShellExecutable(command || "cursor-agent"),
  },
  kiro: {
    id: "kiro",
    displayName: CANONICAL_PROVIDER_DISPLAY_NAMES.kiro,
    cliCommand: "kiro-cli",
    homepageUrl: "https://kiro.dev",
    updateCommandHint: "kiro-cli update",
    supportsCliMode: true,
    supportsResume: false,
    buildResumeCommand: ({ command }) => quoteShellExecutable(command || "kiro-cli"),
  },
  grok: {
    id: "grok",
    displayName: CANONICAL_PROVIDER_DISPLAY_NAMES.grok,
    cliCommand: "grok",
    homepageUrl: "https://x.ai",
    updateCommandHint: "npm install -g @vibe-kit/grok-cli@latest",
    supportsCliMode: true,
    supportsResume: false,
    buildResumeCommand: ({ command }) => quoteShellExecutable(command || "grok"),
  },
};

function readConfigField(config: unknown, key: string): string | null {
  if (config === null || typeof config !== "object") return null;
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeExecutableBasename(rawPath: string | null): string | null {
  if (!rawPath) return null;
  const segments = rawPath.split(/[\\/]/).filter(Boolean);
  const last = segments.at(-1) ?? rawPath;
  return last.replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
}

export function resolveAgentCliMeta(input: {
  readonly driver: string;
  readonly instanceId?: string | null;
  readonly config?: unknown;
  readonly displayName?: string | null;
}): PrismuxAgentCliMeta | null {
  const direct = PRISMUX_AGENT_CLI_CATALOG[input.driver];
  if (direct) return direct;

  if (input.driver === "acpRegistry") {
    const commandPath = readConfigField(input.config, "commandPath");
    const agentId = readConfigField(input.config, "agentId")?.toLowerCase() ?? null;
    const exeName = normalizeExecutableBasename(commandPath);
    if (
      exeName === "dsh" ||
      agentId === "dsh" ||
      agentId === "deepseek-harness-acp" ||
      input.instanceId?.toLowerCase().startsWith("dsh")
    ) {
      return PRISMUX_AGENT_CLI_CATALOG.dsh ?? null;
    }
    if (exeName === "agy" || agentId === "antigravity" || agentId === "agy") {
      return PRISMUX_AGENT_CLI_CATALOG.antigravity ?? null;
    }
    if (exeName && PRISMUX_AGENT_CLI_CATALOG[exeName]) {
      return PRISMUX_AGENT_CLI_CATALOG[exeName] ?? null;
    }
    if (agentId && PRISMUX_AGENT_CLI_CATALOG[agentId]) {
      return PRISMUX_AGENT_CLI_CATALOG[agentId] ?? null;
    }
    const source = readConfigField(input.config, "source");
    if (source === "local" && commandPath) {
      return {
        id: agentId ?? exeName ?? "local-acp",
        displayName: input.displayName?.trim() || commandPath,
        cliCommand: commandPath,
        homepageUrl: "",
        updateCommandHint: "",
        supportsCliMode: true,
        supportsResume: false,
        buildResumeCommand: ({ command }) => quoteShellExecutable(command || commandPath),
      };
    }
    return null;
  }

  return null;
}

export function resolveSafeAgentHomepageUrl(input: {
  readonly driver: string;
  readonly instanceId?: string | null;
  readonly config?: unknown;
  readonly displayName?: string | null;
  readonly documentationUrl?: string | null;
  readonly websiteUrl?: string | null;
}): string | null {
  const candidates = [
    input.websiteUrl,
    input.documentationUrl,
    readConfigField(input.config, "homepageUrl"),
    resolveAgentCliMeta(input)?.homepageUrl,
  ];
  for (const candidate of candidates) {
    const safe = validateSafeHttpsUrl(candidate);
    if (safe) return safe;
  }
  return null;
}

export function supportsDualLaunchMode(input: {
  readonly driver: string;
  readonly instanceId?: string | null;
  readonly config?: unknown;
}): boolean {
  const meta = resolveAgentCliMeta(input);
  return meta?.supportsCliMode === true;
}

export function buildContinueInTerminalCommand(input: {
  readonly driver: string;
  readonly instanceId?: string | null;
  readonly config?: unknown;
  readonly displayName?: string | null;
  readonly sessionId?: string | null;
  readonly binaryPath?: string | null;
  readonly providerInstances?: ReadonlyArray<ProviderInstanceEntry> | null;
}): {
  readonly command: string;
  readonly cliCommand: string;
  readonly label: string;
  readonly supportsResume: boolean;
} {
  const meta = resolveAgentCliMeta(input);
  const configuredBinary =
    input.binaryPath?.trim() ||
    readConfigField(input.config, "binaryPath") ||
    readConfigField(input.config, "commandPath");
  const resolvedLabel =
    input.displayName?.trim() ||
    resolveConfiguredProviderDisplayName({
      provider: input.driver,
      instanceId: input.instanceId,
      driverKind: input.driver,
      providerInstances: input.providerInstances,
      fallbackDisplayName: meta?.displayName ?? configuredBinary ?? input.driver,
    });
  if (!meta) {
    const fallbackExe = configuredBinary || input.driver || "sh";
    return {
      command: quoteShellExecutable(fallbackExe),
      cliCommand: fallbackExe,
      label:
        input.displayName?.trim() ||
        (input.providerInstances?.length ? resolvedLabel : fallbackExe),
      supportsResume: false,
    };
  }
  const executable = configuredBinary || meta.cliCommand;
  return {
    command: meta.buildResumeCommand({
      command: executable,
      sessionId: input.sessionId ?? null,
    }),
    cliCommand: executable,
    label: resolvedLabel,
    supportsResume: meta.supportsResume && sanitizeResumeSessionId(input.sessionId) !== null,
  };
}
