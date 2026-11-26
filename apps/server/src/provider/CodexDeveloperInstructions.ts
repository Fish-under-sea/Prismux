import type { V2TurnStartParams__AdditionalContextEntry } from "@prismux/effect-codex-app-server/schema";
import { buildRuntimeInstructions } from "@prismux/provider-core/server/runtimeInstructions";

import {
  buildPrismuxOrchestrationSections,
  detectPrismuxPromptIntent,
  PRISMUX_BROWSER_TOOL_INSTRUCTIONS,
  PRISMUX_DEVICE_TOOL_INSTRUCTIONS,
} from "@prismux/provider-core/server/orchestrationInstructions";

/** Codex silently truncates additionalContext values over 1,000 tokens, counted as UTF-8 bytes / 4. */
export const CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES = 4_000;

export interface PrismuxToolAvailability {
  readonly browser: boolean;
  readonly device: boolean;
  readonly prompt?: string | undefined;
  readonly isSubagent?: boolean | undefined;
  readonly hasOpenPreview?: boolean | undefined;
  readonly hasOpenDeviceSession?: boolean | undefined;
  readonly hasLinkedEnvironments?: boolean | undefined;
  readonly isGitProject?: boolean | undefined;
  readonly pullRequestLinking?: boolean | undefined;
}

const normalizeAvailability = (
  availability: boolean | PrismuxToolAvailability,
): PrismuxToolAvailability =>
  typeof availability === "boolean" ? { browser: availability, device: false } : availability;

/** Instructions for unavailable or irrelevant tools would waste context and steer the model wrong. */
const toolInstructions = (availability: boolean | PrismuxToolAvailability): string => {
  const tools = normalizeAvailability(availability);
  const intent =
    tools.prompt === undefined ? undefined : detectPrismuxPromptIntent(tools.prompt);
  const includeBrowser =
    tools.browser && (tools.hasOpenPreview === true || intent?.needsBrowser === true);
  const includeDevice =
    tools.device && (tools.hasOpenDeviceSession === true || intent?.needsDevice === true);
  return [
    includeBrowser ? PRISMUX_BROWSER_TOOL_INSTRUCTIONS.trim() : "",
    includeDevice ? PRISMUX_DEVICE_TOOL_INSTRUCTIONS : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

export interface CodexRuntimeInfo {
  readonly model: string;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}

/** Keep this outside collaboration mode; model-catalog mode text overrides client developer_instructions. */
export function buildCodexAdditionalContext(
  runtime: CodexRuntimeInfo,
  toolsAvailable: boolean | PrismuxToolAvailability = true,
): Record<string, V2TurnStartParams__AdditionalContextEntry> {
  const normalized = normalizeAvailability(toolsAvailable);
  const tools = toolInstructions(normalized);
  const orchestrationSections = buildPrismuxOrchestrationSections({
    prompt: normalized.prompt,
    isSubagent: normalized.isSubagent,
    hasLinkedEnvironments: normalized.hasLinkedEnvironments,
    hasOpenPreview: normalized.hasOpenPreview,
  });
  // Split values to fit per-entry caps; number keys because Codex emits them in key order.
  return {
    ...Object.fromEntries(
      orchestrationSections.map((section, index) => [
        `prismux_orchestration_${String(index + 1).padStart(2, "0")}`,
        { kind: "application" as const, value: section },
      ]),
    ),
    prismux_runtime: {
      kind: "application",
      value: buildRuntimeInstructions({
        harness: "Codex",
        ...runtime,
        ...(normalized.prompt !== undefined ? { prompt: normalized.prompt } : {}),
        ...(normalized.isSubagent !== undefined ? { isSubagent: normalized.isSubagent } : {}),
        ...(normalized.isGitProject !== undefined
          ? { isGitProject: normalized.isGitProject }
          : {}),
        ...(normalized.pullRequestLinking !== undefined
          ? { pullRequestLinking: normalized.pullRequestLinking }
          : normalized.prompt === undefined
            ? { pullRequestLinking: false }
            : {}),
      }),
    },
    ...(tools ? { prismux_tools: { kind: "application", value: tools } } : {}),
  };
}
