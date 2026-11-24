import type { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";

import { formatAgentBrandName } from "../../prismux/agentBrand";
import type { ModelEsque } from "./providerIconUtils";

export const DEFAULT_AGENT_SCOPED_VISIBLE_MODELS = 6;

/** Keeps a hidden model visible while its provider is locked or turned off. */
export function retainedModelWhileProviderLocked(
  entry: {
    readonly driverKind: ProviderDriverKind;
    readonly enabled: boolean;
    readonly isAvailable: boolean;
    readonly models: ReadonlyArray<Pick<ModelEsque, "slug" | "name" | "shortName" | "subProvider">>;
  } | null,
  model: string,
): ModelEsque | undefined {
  if (!entry || (entry.enabled && entry.isAvailable) || !model) return undefined;
  if (entry.driverKind === "opencode" || entry.driverKind === "antigravity") return undefined;
  return entry.models.find((candidate) => candidate.slug === model) ?? { slug: model, name: model };
}

/**
 * Determines whether the Model Picker should open in Orca-style single-agent focused mode
 * (hiding the multi-provider icon rail and scoping default list + search to the active Agent).
 */
export function shouldScopeModelPickerToActiveAgent(input: {
  readonly scopeToActiveAgent?: boolean | undefined;
  readonly hasUnifiedFooter: boolean;
  readonly hasActiveEntry: boolean;
}): boolean {
  if (!input.hasActiveEntry) return false;
  if (input.scopeToActiveAgent !== undefined) {
    return input.scopeToActiveAgent;
  }
  return input.hasUnifiedFooter;
}

/**
 * Formats the muted second-line source subtitle for a model card in the agent-scoped picker
 * (e.g. `Codex · via OpenRouter`, `Claude Code · via Custom Proxy`, or `Codex`).
 */
export function formatModelSourceSubtitle(input: {
  readonly driverKind: ProviderDriverKind;
  readonly instanceDisplayName: string;
  readonly subProvider?: string | undefined;
  readonly isDefaultInstance?: boolean | undefined;
}): string {
  const resolvedName = formatAgentBrandName(input.driverKind, input.instanceDisplayName);
  const canonicalBrand = formatAgentBrandName(
    input.driverKind,
    input.driverKind === "acpRegistry" || input.driverKind === "openaiCompatible"
      ? resolvedName
      : undefined,
  );
  const sub = input.subProvider?.trim();
  if (sub && sub.toLowerCase() !== resolvedName.toLowerCase()) {
    return `${resolvedName} · via ${sub}`;
  }
  if (
    resolvedName.length > 0 &&
    resolvedName.toLowerCase() !== canonicalBrand.toLowerCase()
  ) {
    return input.isDefaultInstance ? resolvedName : `${canonicalBrand} · via ${resolvedName}`;
  }
  return canonicalBrand;
}

/**
 * Partitions an agent's models into primary visible cards and folded "More models (N)" overflow.
 * Always keeps the currently active model and favorited models in `primaryModels` so active picks
 * are never buried inside the fold.
 */
export function partitionAgentScopedModels<
  T extends {
    readonly slug: string;
    readonly instanceId: ProviderInstanceId;
    readonly isLegacy?: boolean | undefined;
  },
>(input: {
  readonly models: ReadonlyArray<T>;
  readonly activeModelKey: string | null;
  readonly favoriteModelKeys: ReadonlySet<string>;
  readonly keyOf: (item: T) => string;
  readonly maxPrimaryCount?: number | undefined;
}): {
  readonly primaryModels: ReadonlyArray<T>;
  readonly overflowModels: ReadonlyArray<T>;
} {
  const maxPrimaryCount = Math.max(1, input.maxPrimaryCount ?? DEFAULT_AGENT_SCOPED_VISIBLE_MODELS);
  const pinned: T[] = [];
  const regular: T[] = [];
  const legacy: T[] = [];

  for (const model of input.models) {
    const key = input.keyOf(model);
    const isActive = input.activeModelKey !== null && key === input.activeModelKey;
    const isFavorite = input.favoriteModelKeys.has(key);
    if (isActive || isFavorite) {
      pinned.push(model);
    } else if (model.isLegacy) {
      legacy.push(model);
    } else {
      regular.push(model);
    }
  }

  // Preserve original relative order among all items that land in primaryModels.
  const regularSlots = Math.max(0, maxPrimaryCount - pinned.length);
  const keptRegular = new Set(regular.slice(0, regularSlots));
  const pinnedSet = new Set(pinned);

  const primaryModels: T[] = [];
  const overflowRegular: T[] = [];
  for (const model of input.models) {
    if (pinnedSet.has(model) || keptRegular.has(model)) {
      primaryModels.push(model);
    } else if (!model.isLegacy) {
      overflowRegular.push(model);
    }
  }

  return {
    primaryModels,
    overflowModels: [...overflowRegular, ...legacy],
  };
}
