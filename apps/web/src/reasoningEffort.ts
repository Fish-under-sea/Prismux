import type {
  ModelCapabilities,
  ModelSelection,
  ProviderOptionSelection,
  ServerProvider,
  ServerSettings,
} from "@prismux/core-contracts";
import type { ResolvedProjectSettings } from "@prismux/core-shared/projectSettings";

// Kept runtime-dependency-free (mirrors MODEL_REASONING_EFFORT_OPTION_IDS) so draft hooks and
// isolated tests never pull provider-registry or contract runtime singletons at module load time.
const KNOWN_REASONING_EFFORT_OPTION_IDS: ReadonlySet<string> = new Set([
  "reasoningEffort",
  "effort",
  "reasoning",
  "variant",
  "reasoning_effort",
  "thinking_level",
  "thinkingLevel",
  "thought_level",
  "thoughtLevel",
  "thinking",
]);

function readCustomReasoningDescriptorId(
  caps: ModelCapabilities | null | undefined,
): string | null {
  const descriptors = caps?.optionDescriptors;
  if (!descriptors) return null;
  for (const descriptor of descriptors) {
    if (descriptor.type === "select" && descriptor.role === "reasoning") {
      return descriptor.id;
    }
  }
  return null;
}

export function isReasoningEffortOptionId(id: string, caps?: ModelCapabilities | null): boolean {
  if (KNOWN_REASONING_EFFORT_OPTION_IDS.has(id)) {
    return true;
  }
  const customId = readCustomReasoningDescriptorId(caps);
  return customId !== null && customId === id;
}

export function stripReasoningEffortOptions(
  options: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  caps?: ModelCapabilities | null,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  if (!options || options.length === 0) return undefined;
  const remaining = options.filter((option) => !isReasoningEffortOptionId(option.id, caps));
  return remaining.length > 0 ? remaining : undefined;
}

function findCapabilitiesForSelection(
  selection: ModelSelection,
  providers: ReadonlyArray<ServerProvider> | undefined,
): ModelCapabilities | null {
  if (!providers || providers.length === 0) return null;
  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  if (!provider) return null;
  const matchedModel = provider.models.find(
    (model) => model.slug === selection.model || model.aliases?.includes(selection.model),
  );
  return matchedModel?.capabilities ?? null;
}

export function stripReasoningEffortFromSelection(
  selection: ModelSelection,
  providers?: ReadonlyArray<ServerProvider>,
): ModelSelection {
  if (!selection.options || selection.options.length === 0) {
    return selection;
  }
  const caps = findCapabilitiesForSelection(selection, providers);
  const remaining = stripReasoningEffortOptions(selection.options, caps);
  if ((remaining?.length ?? 0) === selection.options.length) {
    return selection;
  }
  if (!remaining || remaining.length === 0) {
    return { instanceId: selection.instanceId, model: selection.model };
  }
  return {
    instanceId: selection.instanceId,
    model: selection.model,
    options: remaining.map((option) => ({ ...option })),
  };
}

/**
 * Resolves the effective project `defaultModelSelection` for a new draft thread.
 * When a project overrides `defaultReasoningEffort` while inheriting the environment's
 * `defaultModelSelection`, any stale reasoning effort saved on the inherited environment model
 * yields to the project's `defaultReasoningEffort`.
 */
export function resolveProjectDefaultModelSelectionForDraft(
  resolved: {
    readonly settings: Pick<ServerSettings, "defaultModelSelection">;
    readonly sources: Partial<
      Pick<ResolvedProjectSettings["sources"], "defaultModelSelection" | "defaultReasoningEffort">
    >;
  },
  providers?: ReadonlyArray<ServerProvider>,
): ModelSelection | null {
  const configured = resolved.settings.defaultModelSelection;
  if (configured === null) return null;
  if (
    resolved.sources.defaultReasoningEffort === "project" &&
    resolved.sources.defaultModelSelection !== "project"
  ) {
    return stripReasoningEffortFromSelection(configured, providers);
  }
  return configured;
}
