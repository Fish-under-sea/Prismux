import type { ProviderDriverKind, ProviderInstanceId } from "@prismux/core-contracts";

import {
  formatAgentBrandName,
  resolveProviderEntryDisplayName,
} from "../../prismux/agentBrand";
import { orderProviderInstanceEntries } from "../../providerInstances";
import type { ModelEsque } from "./providerIconUtils";

export { orderProviderInstanceEntries };

export const DEFAULT_AGENT_SCOPED_VISIBLE_MODELS = 6;

/**
 * Orders a single provider instance's models according to `providerModelPreferences[instanceId].modelOrder`,
 * preserving original relative order for models not explicitly listed.
 */
export function orderModelOptionsByPreference<T extends { readonly slug: string }>(
  models: ReadonlyArray<T>,
  modelOrder: ReadonlyArray<string> | null | undefined,
): ReadonlyArray<T> {
  if (!modelOrder || modelOrder.length === 0 || models.length <= 1) {
    return models;
  }
  const rankBySlug = new Map<string, number>();
  for (const [index, slug] of modelOrder.entries()) {
    if (!rankBySlug.has(slug)) {
      rankBySlug.set(slug, index);
    }
  }
  if (rankBySlug.size === 0) {
    return models;
  }
  return models
    .map((model, originalIndex) => ({
      model,
      rank: rankBySlug.get(model.slug) ?? Number.POSITIVE_INFINITY,
      originalIndex,
    }))
    .toSorted((left, right) =>
      left.rank !== right.rank ? left.rank - right.rank : left.originalIndex - right.originalIndex,
    )
    .map((item) => item.model);
}

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
  readonly hasCustomDisplayName?: boolean | undefined;
  readonly subProvider?: string | undefined;
  readonly isDefaultInstance?: boolean | undefined;
}): string {
  const resolvedName = resolveProviderEntryDisplayName({
    driverKind: input.driverKind,
    displayName: input.instanceDisplayName,
    hasCustomDisplayName: input.hasCustomDisplayName,
  });
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

const PHANTOM_REASONING_CHOICE_IDS = new Set([
  "",
  "_t3/empty",
  "default",
  "t3:default",
  "provider_default",
  "provider-default",
  "providerdefault",
  "provider default",
  "model_default",
  "model-default",
  "modeldefault",
  "model default",
  "system_default",
  "system-default",
  "systemdefault",
  "system default",
  "agent_default",
  "agent-default",
  "agentdefault",
  "agent default",
  "unset",
  "inherit",
]);

const PHANTOM_REASONING_CHOICE_LABELS = new Set([
  "",
  "default",
  "provider default",
  "model default",
  "system default",
  "agent default",
  "use default",
  "use provider default",
  "默认",
  "提供商默认",
  "模型默认",
  "系统默认",
]);

/**
 * Detects phantom/sentinel reasoning-effort choices (e.g. DeepSeek Harness / ACP
 * `"Provider default"`, `"provider_default"`, `"default"`, or `_t3/empty`).
 */
export function isPhantomReasoningEffortChoice(choice: {
  readonly id: string;
  readonly label?: string | null | undefined;
}): boolean {
  const normalizedId = choice.id.trim().toLowerCase();
  if (PHANTOM_REASONING_CHOICE_IDS.has(normalizedId)) {
    return true;
  }
  const normalizedLabel = (choice.label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, " ");
  return (
    PHANTOM_REASONING_CHOICE_LABELS.has(normalizedLabel) ||
    /^provider default(?:\s*\(|$)/u.test(normalizedLabel)
  );
}

/**
 * Filters out phantom `"Provider default"` / sentinel options from a reasoning-effort choice list
 * whenever at least one concrete effort level exists (preserving all real levels like Low/Medium/High/Max).
 */
export function filterConcreteReasoningChoices<
  T extends { readonly id: string; readonly label: string },
>(choices: ReadonlyArray<T>): ReadonlyArray<T> {
  if (choices.length === 0) return choices;
  const concrete = choices.filter((choice) => !isPhantomReasoningEffortChoice(choice));
  return concrete.length > 0 ? concrete : choices;
}

/**
 * Resolves the effective concrete reasoning-effort value for display/selection.
 * When `currentValue` matches a concrete option, preserves it; when it pointed at a
 * stripped phantom sentinel (e.g. `"provider_default"` / `"_t3/empty"` / `"default"`),
 * falls back cleanly to the model's concrete default or `medium` / `high` / middle stop.
 */
export function resolveConcreteReasoningValue<
  T extends { readonly id: string; readonly label: string; readonly isDefault?: boolean | undefined },
>(
  concreteChoices: ReadonlyArray<T>,
  currentValue: string | null | undefined,
  hadPhantomChoices = false,
): string | null {
  if (concreteChoices.length === 0) {
    return currentValue ?? null;
  }
  const trimmed = currentValue?.trim();
  if (trimmed) {
    const exact = concreteChoices.find((choice) => choice.id === trimmed);
    if (exact) return exact.id;
    const lowered = trimmed.toLowerCase();
    const ci = concreteChoices.find((choice) => choice.id.trim().toLowerCase() === lowered);
    if (ci) return ci.id;
  }
  const shouldFallback =
    hadPhantomChoices ||
    (trimmed !== undefined &&
      trimmed.length > 0 &&
      isPhantomReasoningEffortChoice({ id: trimmed, label: "" }));
  if (!shouldFallback) {
    return currentValue ?? null;
  }
  const markedDefault = concreteChoices.find((choice) => choice.isDefault);
  if (markedDefault) return markedDefault.id;
  const medium = concreteChoices.find((choice) => choice.id.trim().toLowerCase() === "medium");
  if (medium) return medium.id;
  const high = concreteChoices.find((choice) => choice.id.trim().toLowerCase() === "high");
  if (high) return high.id;
  return concreteChoices[Math.floor((concreteChoices.length - 1) / 2)]?.id ?? null;
}
