import { createElement, memo, useEffect, useId, type CSSProperties, type ReactElement } from "react";

export type AgentBrandId =
  | "codex"
  | "claude-code"
  | "antigravity"
  | "omp"
  | "gemini"
  | "opencode"
  | "cursor"
  | "acp"
  | "custom";

export interface AgentBrandMeta {
  readonly id: AgentBrandId;
  readonly displayName: string;
  readonly canonicalProviderId: string;
  readonly accentColor: string;
  readonly glowColor: string;
}

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
  omp: {
    id: "omp",
    displayName: "oh-my-pi",
    canonicalProviderId: "omp",
    accentColor: "#10b981",
    glowColor: "rgba(16, 185, 129, 0.58)",
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
  cursor: {
    id: "cursor",
    displayName: "Cursor",
    canonicalProviderId: "cursor",
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
  "openai-codex": "codex",
  openai_codex: "codex",
  "openai codex": "codex",
  openaicodex: "codex",
  claude: "claude-code",
  claudeagent: "claude-code",
  "claude-agent": "claude-code",
  claude_agent: "claude-code",
  "claude agent": "claude-code",
  "claude-code": "claude-code",
  claude_code: "claude-code",
  claudecode: "claude-code",
  "claude code": "claude-code",
  antigravity: "antigravity",
  "antigravity-cli": "antigravity",
  antigravity_cli: "antigravity",
  "antigravity cli": "antigravity",
  antigravitycli: "antigravity",
  agy: "antigravity",
  omp: "omp",
  "oh-my-pi": "omp",
  oh_my_pi: "omp",
  "oh my pi": "omp",
  ohmypi: "omp",
  pi: "omp",
  "pi-coding-agent": "omp",
  gemini: "gemini",
  "gemini-cli": "gemini",
  gemini_cli: "gemini",
  "gemini cli": "gemini",
  geminicli: "gemini",
  opencode: "opencode",
  "open-code": "opencode",
  open_code: "opencode",
  "open code": "opencode",
  cursor: "cursor",
  "cursor-cli": "cursor",
  cursor_cli: "cursor",
  "cursor cli": "cursor",
  "cursor-agent": "cursor",
  acp: "acp",
  acpregistry: "acp",
  "acp-registry": "acp",
  acp_registry: "acp",
  "acp registry": "acp",
};

const EXTRA_KNOWN_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  grok: "Grok",
  kiro: "Kiro",
  muse: "Muse Code",
  "muse-code": "Muse Code",
  "muse code": "Muse Code",
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

function smartTitleCase(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "Agent";

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

  const exact = KNOWN_ALIASES[key];
  if (exact) return exact;

  // Match compound instance IDs such as "codex-work", "claudeAgent:team", "acpRegistry:foo".
  const compact = key.replace(/[^a-z0-9]+/g, "");
  const compactHit = KNOWN_ALIASES[compact];
  if (compactHit) return compactHit;

  if (key.startsWith("codex") || key.includes("openai-codex") || key.includes("openai_codex")) {
    return "codex";
  }
  if (key.startsWith("claude")) {
    return "claude-code";
  }
  if (key.startsWith("antigravity") || key === "agy" || key.startsWith("agy-") || key.startsWith("agy_")) {
    return "antigravity";
  }
  if (
    key === "omp" ||
    key.startsWith("omp-") ||
    key.startsWith("omp_") ||
    key.includes("oh-my-pi") ||
    key.includes("oh_my_pi") ||
    key === "pi" ||
    key.startsWith("pi-") ||
    key.startsWith("pi_")
  ) {
    return "omp";
  }
  if (key.startsWith("gemini")) {
    return "gemini";
  }
  if (key.startsWith("opencode") || key.startsWith("open-code")) {
    return "opencode";
  }
  if (key.startsWith("cursor")) {
    return "cursor";
  }
  if (key.startsWith("acp")) {
    return "acp";
  }

  return "custom";
}

/**
 * Map a T3 Code driver ID or alias into the canonical Chief provider ID accepted by Prismux Daemon.
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
 * Authoritative brand formatter for all Prismux UI surfaces (tabs, launcher, Chief pill, settings).
 * Eliminates raw lowercase IDs like `codex` / `claudeAgent` while preserving custom ACP display names.
 */
export function formatAgentBrandName(
  providerIdOrName: string | null | undefined,
  customDisplayName?: string | null,
): string {
  const trimmedCustom = typeof customDisplayName === "string" ? customDisplayName.trim() : "";
  if (trimmedCustom.length > 0) {
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

  const trimmedRaw = typeof providerIdOrName === "string" ? providerIdOrName.trim() : "";
  if (!trimmedRaw) {
    return "Agent";
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

  return smartTitleCase(trimmedRaw);
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
  /** Provider ID, driver kind, or display name (e.g. "codex", "claudeAgent", "antigravity", "omp"). */
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

function renderBrandSvg(
  brandId: AgentBrandId,
  size: number,
  monochrome: boolean,
  gradientPrefix: string,
  iconClassName?: string,
): ReactElement {
  const baseProps = {
    width: size,
    height: size,
    className: iconClassName,
    "aria-hidden": true as const,
    focusable: false as const,
    style: { width: size, height: size, display: "block" } satisfies CSSProperties,
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

    case "antigravity": {
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 24 24", fill: "none" },
        ...renderAntigravitySvgContent(gradientPrefix, monochrome),
      );
    }

    case "omp":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 24 24", fill: "none" },
        createElement("path", {
          d: "M4.5 7.4C5.4 6.2 6.8 5.8 9.2 5.8H19.5",
          stroke: monochrome ? "currentColor" : "#10b981",
          strokeWidth: 2.3,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }),
        createElement("path", {
          d: "M9.4 6.2L8.1 16.4C7.9 17.8 7.1 18.6 6.1 18.6",
          stroke: monochrome ? "currentColor" : "#10b981",
          strokeWidth: 2.3,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }),
        createElement("path", {
          d: "M15.1 6.2L14.4 15.7C14.3 17.4 15.1 18.6 16.6 18.6C17.6 18.6 18.4 18.1 18.9 17.2",
          stroke: monochrome ? "currentColor" : "#10b981",
          strokeWidth: 2.3,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }),
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
                { id: gradId, x1: "3", y1: "3", x2: "21", y2: "21", gradientUnits: "userSpaceOnUse" },
                createElement("stop", { offset: "0%", stopColor: "#4285f4" }),
                createElement("stop", { offset: "55%", stopColor: "#9b72cb" }),
                createElement("stop", { offset: "100%", stopColor: "#d96570" }),
              ),
            ),
        createElement("path", {
          d: "M12 2C12.8 7.5 16.5 11.2 22 12C16.5 12.8 12.8 16.5 12 22C11.2 16.5 7.5 12.8 2 12C7.5 11.2 11.2 7.5 12 2Z",
          fill: monochrome ? "currentColor" : `url(#${gradId})`,
        }),
      );
    }

    case "opencode":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 24 24", fill: "none" },
        createElement("rect", {
          x: 3.25,
          y: 3.25,
          width: 17.5,
          height: 17.5,
          rx: 4,
          stroke: "currentColor",
          strokeWidth: 2,
        }),
        createElement("path", {
          d: "M8.5 9.2L6.2 12L8.5 14.8M15.5 9.2L17.8 12L15.5 14.8M13.1 8.5L10.9 15.5",
          stroke: "currentColor",
          strokeWidth: 1.9,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }),
      );

    case "cursor":
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 466.73 532.09", fill: "currentColor" },
        createElement("path", { d: CURSOR_PRISM_PATH }),
      );

    case "acp":
    case "custom":
    default:
      return createElement(
        "svg",
        { ...baseProps, viewBox: "0 0 24 24", fill: "none" },
        createElement("path", {
          d: "M12 2.8L20 7.4V16.6L12 21.2L4 16.6V7.4L12 2.8Z",
          stroke: "currentColor",
          strokeWidth: 1.9,
          strokeLinejoin: "round",
        }),
        createElement("circle", { cx: 12, cy: 12, r: 2.6, fill: "currentColor" }),
      );
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
    renderBrandSvg(meta.id, size, monochrome, gradientPrefix, iconClassName),
  );
});
