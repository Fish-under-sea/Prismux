import {
  DEFAULT_REASONING_EFFORT,
  DEFAULT_TEXT_GENERATION_MODEL,
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  defaultInstanceIdForDriver,
  type ModelCapabilities,
  type ModelSelection,
  type ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionSelection,
  type ReasoningEffortLevel,
  type ServerProvider,
  type ServerSettings,
} from "@prismux/core-contracts";
import {
  type CustomModelDefinition,
  createModelSelection,
  getReasoningEffortDescriptor,
  normalizeCustomModelSlug,
  readCustomModelEntries,
  resolveSelectableModel,
} from "@prismux/core-shared/model";
import { getComposerProviderState } from "./components/chat/composerProviderState";
import { type ClientSettings, UnifiedSettings } from "@prismux/core-contracts/settings";
import { resolveModelPreferences } from "@prismux/core-shared/serverSettings";
import * as Arr from "effect/Array";
import * as Equal from "effect/Equal";
import * as Result from "effect/Result";
import {
  getDefaultServerModel,
  getProviderModelCapabilities,
  getProviderModels,
  hasRuntimeModelCatalog,
  isRuntimeModelDefaultAlias,
  resolveSelectableProvider,
} from "./providerModels";
import {
  filterConcreteReasoningChoices,
  isPhantomReasoningEffortChoice,
} from "./components/chat/ProviderModelPicker.logic";
import { ModelEsque } from "./components/chat/providerIconUtils";
import {
  type ProviderInstanceEntry,
  brandProviderInstanceEntries,
  deriveProviderInstanceEntries,
  disambiguateProviderInstanceDisplayNames,
  NO_PROVIDER_MODEL_SELECTION,
  orderProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  resolveProjectDefaultProviderModelSelection,
} from "./providerInstances";
import { sortModelsForProviderInstance } from "./modelOrdering";
import { resolveModelShortName } from "@prismux/client-runtime/provider-clients";

export const MAX_CUSTOM_MODEL_LENGTH = 256;
const DEFAULT_TEXT_GENERATION_INSTANCE_ID = ProviderInstanceId.make("codex");

function orderedBrandedProviderInstanceEntries(
  providers: ReadonlyArray<ServerProvider>,
  settings: UnifiedSettings,
): ReadonlyArray<ProviderInstanceEntry> {
  const derived = deriveProviderInstanceEntries(providers);
  const branded = brandProviderInstanceEntries(derived, settings);
  return disambiguateProviderInstanceDisplayNames(
    orderProviderInstanceEntries(branded, settings.providerOrder),
  );
}

// Legacy per-driver buckets would leak custom-instance models into stock instances.
export function readInstanceCustomModels(
  settings: UnifiedSettings,
  instanceId: ProviderInstanceId,
  driverKind: ProviderDriverKind,
): ReadonlyArray<CustomModelDefinition> {
  if (driverKind === "antigravity") return [];
  const instance = settings.providerInstances?.[instanceId];
  const config = instance?.config;
  if (config !== null && typeof config === "object") {
    const value = (config as Record<string, unknown>).customModels;
    if (Array.isArray(value)) {
      return readCustomModelEntries(value);
    }
  }
  return [];
}

export interface AppModelOption {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  aliases?: ReadonlyArray<string>;
  badge?: "new";
  isCustom: boolean;
  isDefault?: boolean;
  isLegacy?: boolean;
  isUnavailable?: boolean;
}

function appendUnavailableDynamicModelSelection(
  options: AppModelOption[],
  rawModels: ReadonlyArray<ServerProvider["models"][number]>,
  provider: ProviderDriverKind,
  selectedModel: string | null | undefined,
  hiddenModels: ReadonlyArray<string>,
): AppModelOption[] {
  if (!hasRuntimeModelCatalog(provider)) return options;
  const slug = normalizeCustomModelSlug(selectedModel);
  if (!slug) return options;
  if (isRuntimeModelDefaultAlias(provider, slug)) return options;

  if (resolveSelectableModel(provider, slug, rawModels) !== null) return options;
  if (hiddenModels.includes(slug)) return options;
  if (options.some((option) => option.slug === slug)) return options;

  return [...options, { slug, name: slug, isCustom: false, isUnavailable: true }];
}

function toAppModelOption(
  model: ServerProvider["models"][number],
  driverKind: ProviderDriverKind,
): AppModelOption {
  const option: AppModelOption = {
    slug: model.slug,
    name: model.name,
    isCustom: model.isCustom,
  };
  const shortName = resolveModelShortName(model, driverKind);
  if (shortName) option.shortName = shortName;
  if (model.subProvider) option.subProvider = model.subProvider;
  if (model.aliases) option.aliases = model.aliases;
  if (model.badge) option.badge = model.badge;
  if (model.isDefault) option.isDefault = true;
  if (model.isLegacy) option.isLegacy = true;
  return option;
}

function readInstanceModelPreferences(
  settings: UnifiedSettings,
  instanceId: ProviderInstanceId,
): { readonly hiddenModels: ReadonlyArray<string>; readonly modelOrder: ReadonlyArray<string> } {
  return (
    settings.providerModelPreferences?.[instanceId] ?? {
      hiddenModels: [],
      modelOrder: [],
    }
  );
}

function applyInstanceModelPreferences(
  options: ReadonlyArray<AppModelOption>,
  preferences: {
    readonly hiddenModels: ReadonlyArray<string>;
    readonly modelOrder: ReadonlyArray<string>;
  },
): AppModelOption[] {
  const hiddenModels = new Set(preferences.hiddenModels);
  return sortModelsForProviderInstance(
    options.filter((option) => option.isCustom || !hiddenModels.has(option.slug)),
    { modelOrder: preferences.modelOrder },
  );
}

function normalizeCustomModelEntries(
  models: ReadonlyArray<CustomModelDefinition>,
  builtInModelSlugs: ReadonlySet<string>,
): CustomModelDefinition[] {
  const normalizedModels: CustomModelDefinition[] = [];
  const seen = new Set<string>();

  for (const candidate of models) {
    if (
      candidate.slug.length > MAX_CUSTOM_MODEL_LENGTH ||
      builtInModelSlugs.has(candidate.slug) ||
      seen.has(candidate.slug)
    ) {
      continue;
    }

    seen.add(candidate.slug);
    normalizedModels.push(candidate);
  }

  return normalizedModels;
}

function getAppModelOptions(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderDriverKind,
  selectedModel?: string | null,
): AppModelOption[] {
  const rawModels = getProviderModels(providers, provider);
  // Server custom-model snapshots can lag removals; rebuild custom rows from settings.
  const options: AppModelOption[] = rawModels
    .filter((model) => !model.isCustom)
    .map((model) => toAppModelOption(model, provider));
  const seen = new Set(options.map((option) => option.slug));
  const builtInModelSlugs = new Set(
    Arr.filterMap(getProviderModels(providers, provider), (model) =>
      model.isCustom ? Result.failVoid : Result.succeed(model.slug),
    ),
  );

  const defaultInstanceId = defaultInstanceIdForDriver(provider);
  const customModels = readInstanceCustomModels(settings, defaultInstanceId, provider);
  for (const entry of normalizeCustomModelEntries(customModels, builtInModelSlugs)) {
    if (seen.has(entry.slug)) {
      continue;
    }

    seen.add(entry.slug);
    const shortName = resolveModelShortName(entry, provider);
    options.push({
      slug: entry.slug,
      name: entry.name,
      isCustom: true,
      ...(shortName ? { shortName } : {}),
    });
  }

  const preferences = readInstanceModelPreferences(settings, defaultInstanceId);
  return appendUnavailableDynamicModelSelection(
    applyInstanceModelPreferences(options, preferences),
    rawModels,
    provider,
    selectedModel,
    preferences.hiddenModels,
  );
}

export function getAppModelOptionsForInstance(
  settings: UnifiedSettings,
  entry: ProviderInstanceEntry,
  selectedModel?: string | null,
): AppModelOption[] {
  const options: AppModelOption[] = entry.models
    .filter((model) => !model.isCustom)
    .map((model) => toAppModelOption(model, entry.driverKind));
  const seen = new Set(options.map((option) => option.slug));
  const builtInModelSlugs = new Set(
    Arr.filterMap(entry.models, (model) =>
      model.isCustom ? Result.failVoid : Result.succeed(model.slug),
    ),
  );

  const customModels = readInstanceCustomModels(settings, entry.instanceId, entry.driverKind);
  for (const custom of normalizeCustomModelEntries(customModels, builtInModelSlugs)) {
    if (seen.has(custom.slug)) {
      continue;
    }

    seen.add(custom.slug);
    const shortName = resolveModelShortName(custom, entry.driverKind);
    options.push({
      slug: custom.slug,
      name: custom.name,
      isCustom: true,
      ...(shortName ? { shortName } : {}),
    });
  }

  const preferences = readInstanceModelPreferences(settings, entry.instanceId);
  return appendUnavailableDynamicModelSelection(
    applyInstanceModelPreferences(options, preferences),
    entry.models,
    entry.driverKind,
    selectedModel,
    preferences.hiddenModels,
  );
}

export function resolveAppModelSelection(
  provider: ProviderDriverKind,
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedModel: string | null | undefined,
): string {
  const resolvedProvider = resolveSelectableProvider(providers, provider);
  const options = getAppModelOptions(settings, providers, resolvedProvider, selectedModel);
  return (
    resolveSelectableModel(resolvedProvider, selectedModel, options) ??
    getDefaultServerModel(providers, resolvedProvider)
  );
}

export function resolveAppModelSelectionForInstance(
  instanceId: ProviderInstanceId,
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedModel: string | null | undefined,
  resolutionOptions?: { readonly preserveUnavailableSelection?: boolean },
): string | null {
  const entry = orderedBrandedProviderInstanceEntries(providers, settings).find(
    (candidate) => candidate.instanceId === instanceId,
  );
  if (!entry) return null;
  const options = getAppModelOptionsForInstance(
    settings,
    entry,
    resolutionOptions?.preserveUnavailableSelection ? selectedModel : null,
  );
  const resolvedSelection = resolveSelectableModel(entry.driverKind, selectedModel, options);
  if (resolvedSelection) {
    return resolvedSelection;
  }
  if (resolutionOptions?.preserveUnavailableSelection && hasRuntimeModelCatalog(entry.driverKind)) {
    const unavailableSelection = normalizeCustomModelSlug(selectedModel);
    const hiddenModels = readInstanceModelPreferences(settings, entry.instanceId).hiddenModels;
    if (
      unavailableSelection &&
      !hiddenModels.includes(unavailableSelection) &&
      resolveSelectableModel(entry.driverKind, selectedModel, entry.models) === null &&
      !isRuntimeModelDefaultAlias(entry.driverKind, unavailableSelection)
    ) {
      return unavailableSelection;
    }
  }
  return options.find((option) => option.isDefault)?.slug ?? options[0]?.slug ?? null;
}

const REASONING_EFFORT_RANK: Readonly<Record<string, number>> = {
  off: 0,
  none: 0,
  minimal: 0.5,
  low: 1,
  medium: 2,
  med: 2,
  normal: 2,
  standard: 2,
  high: 3,
  xhigh: 3.5,
  extra_high: 3.5,
  "extra-high": 3.5,
  very_high: 3.5,
  max: 4,
  maximum: 4,
  highest: 4,
  ultrathink: 4,
  ultracode: 4,
};

const TARGET_EFFORT_RANK: Readonly<Record<ReasoningEffortLevel, number>> = {
  low: 1,
  medium: 2,
  high: 3,
  max: 4,
};

const TARGET_EFFORT_FRACTION: Readonly<Record<ReasoningEffortLevel, number>> = {
  low: 0,
  medium: 1 / 3,
  high: 2 / 3,
  max: 1,
};

function readReasoningChoiceRank(choice: {
  readonly id: string;
  readonly label?: string | undefined;
}): number | null {
  const byId = REASONING_EFFORT_RANK[choice.id.trim().toLowerCase()];
  if (byId !== undefined) return byId;
  if (choice.label) {
    const normalizedLabel = choice.label.trim().toLowerCase().replace(/\s+/gu, "_");
    const byLabel = REASONING_EFFORT_RANK[normalizedLabel];
    if (byLabel !== undefined) return byLabel;
  }
  return null;
}

/**
 * Maps a global `ReasoningEffortLevel` (`low` / `medium` / `high` / `max`) to a model's
 * closest supported concrete reasoning effort option (skipping phantom sentinels and
 * prompt-injected values).
 */
export function resolveClosestReasoningEffortOption(
  caps: ModelCapabilities | null | undefined,
  desiredEffort: ReasoningEffortLevel = DEFAULT_REASONING_EFFORT,
): ProviderOptionSelection | null {
  const descriptor = getReasoningEffortDescriptor(caps);
  if (!descriptor) return null;
  if (descriptor.type === "boolean") {
    return { id: descriptor.id, value: desiredEffort !== "low" };
  }
  const selectable = descriptor.promptInjectedValues?.length
    ? descriptor.options.filter((choice) => !descriptor.promptInjectedValues?.includes(choice.id))
    : descriptor.options;
  const concrete = filterConcreteReasoningChoices(selectable);
  if (concrete.length === 0) return null;

  const exact = concrete.find((choice) => choice.id.trim().toLowerCase() === desiredEffort);
  if (exact) {
    return { id: descriptor.id, value: exact.id };
  }

  const ranked = concrete
    .map((choice, index) => ({
      choice,
      index,
      rank: readReasoningChoiceRank(choice),
    }))
    .filter((entry): entry is { choice: (typeof concrete)[number]; index: number; rank: number } =>
      entry.rank !== null,
    );

  if (ranked.length > 0) {
    const nonOff = ranked.filter((entry) => entry.rank > 0);
    const pool = nonOff.length > 0 ? nonOff : ranked;
    const targetRank = TARGET_EFFORT_RANK[desiredEffort];
    const preferHigherOnTie = desiredEffort !== "low";
    let best = pool[0]!;
    let bestDistance = Math.abs(best.rank - targetRank);
    for (const candidate of pool.slice(1)) {
      const distance = Math.abs(candidate.rank - targetRank);
      const isCloser = distance < bestDistance - 1e-9;
      const isPreferredTie =
        Math.abs(distance - bestDistance) <= 1e-9 &&
        (preferHigherOnTie ? candidate.rank > best.rank : candidate.rank < best.rank);
      if (isCloser || isPreferredTie) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return { id: descriptor.id, value: best.choice.id };
  }

  const fallbackIndex = Math.min(
    concrete.length - 1,
    Math.max(0, Math.round(TARGET_EFFORT_FRACTION[desiredEffort] * (concrete.length - 1))),
  );
  const fallbackChoice = concrete[fallbackIndex];
  return fallbackChoice ? { id: descriptor.id, value: fallbackChoice.id } : null;
}

/**
 * Applies `defaultReasoningEffort` to a model selection when it has no explicit concrete
 * per-model reasoning override (preserving any explicit user-chosen effort option intact).
 */
export function applyDefaultReasoningEffortToSelection(
  selection: ModelSelection,
  providers: ReadonlyArray<ServerProvider>,
  defaultReasoningEffort: ReasoningEffortLevel = DEFAULT_REASONING_EFFORT,
): ModelSelection {
  const entry = deriveProviderInstanceEntries(providers).find(
    (candidate) => candidate.instanceId === selection.instanceId,
  );
  if (!entry) return selection;

  const caps = getProviderModelCapabilities(entry.models, selection.model, entry.driverKind);
  const descriptor = getReasoningEffortDescriptor(caps);
  if (!descriptor) return selection;

  const existingOption = selection.options?.find((option) => option.id === descriptor.id);
  if (existingOption !== undefined) {
    if (typeof existingOption.value === "boolean") {
      return selection;
    }
    const matchingChoice =
      descriptor.type !== "boolean"
        ? descriptor.options.find((choice) => choice.id === existingOption.value)
        : undefined;
    if (
      !isPhantomReasoningEffortChoice({
        id: existingOption.value,
        label: matchingChoice?.label ?? existingOption.value,
      })
    ) {
      return selection;
    }
  }

  const resolvedEffort = resolveClosestReasoningEffortOption(caps, defaultReasoningEffort);
  if (!resolvedEffort) return selection;

  const preservedOptions = (selection.options ?? []).filter(
    (option) => option.id !== descriptor.id,
  );
  return createModelSelection(selection.instanceId, selection.model, [
    ...preservedOptions,
    resolvedEffort,
  ]);
}

// New drafts carry the stored selection; capabilities resolve its raw options later.
export function resolveEffectiveDefaultModelSelection(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection,
): ModelSelection {
  const model = resolveAppModelSelectionForInstance(
    selection.instanceId,
    settings,
    providers,
    selection.model,
    { preserveUnavailableSelection: true },
  );
  const resolved =
    model === null || model === selection.model ? selection : { ...selection, model };
  return applyDefaultReasoningEffortToSelection(
    resolved,
    providers,
    settings.defaultReasoningEffort ?? DEFAULT_REASONING_EFFORT,
  );
}

export function defaultModelSelectionsAreMixed(
  clientSettings: ClientSettings,
  targets: ReadonlyArray<{
    projectId: ProjectId | null;
    settings: ServerSettings;
    providers: ReadonlyArray<ServerProvider>;
  }>,
): boolean {
  const selections = targets.map(({ projectId, settings, providers }) => {
    const stored = settings.defaultModelSelection;
    const selection =
      stored === null
        ? resolveProjectDefaultProviderModelSelection(providers, settings, projectId)
        : resolveDefaultProviderModelSelection(providers, stored);
    return {
      stored,
      effective: selection
        ? resolveEffectiveDefaultModelSelection(
            {
              ...clientSettings,
              ...settings,
              ...resolveModelPreferences(settings, clientSettings),
            },
            providers,
            selection,
          )
        : null,
    };
  });
  return selections.some((selection) => !Equal.equals(selection, selections[0]));
}

export function getCustomModelOptionsByInstance(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedInstanceId?: ProviderInstanceId | null,
  selectedModel?: string | null,
): ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>> {
  const out = new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>();
  for (const entry of orderedBrandedProviderInstanceEntries(providers, settings)) {
    out.set(
      entry.instanceId,
      getAppModelOptionsForInstance(
        settings,
        entry,
        entry.instanceId === selectedInstanceId ? selectedModel : null,
      ),
    );
  }
  return out;
}

function getTextGenerationModelOptionsForInstance(
  settings: UnifiedSettings,
  entry: ProviderInstanceEntry,
  selectedModel?: string | null,
): AppModelOption[] {
  const unsupported = new Set(
    entry.models
      .filter((model) => model.supportsTextGeneration === false)
      .map((model) => model.slug),
  );
  // Filter after custom entries are rebuilt so a display-name override cannot restore a model.
  return getAppModelOptionsForInstance(settings, entry, selectedModel).filter(
    (option) => !unsupported.has(option.slug),
  );
}

export interface TextGenerationEligibilityOptions {
  /**
   * Whether personal-subscription Antigravity (AGY) is explicitly allowed for
   * controlled/automated text generation (`waiver.signed && waiver.allowAntigravityAsControlledAgent`).
   * Defaults to `false`, strictly excluding AGY until signed and unlocked.
   */
  readonly allowAntigravityTextGeneration?: boolean | undefined;
}

// Excludes unsupported providers and gates antigravity behind an explicit waiver unlock; keeps all other enabled agents.
export function resolveTextGenerationProviders(
  providers: ReadonlyArray<ServerProvider>,
  eligibility?: TextGenerationEligibilityOptions,
): ReadonlyArray<ServerProvider> {
  const allowAntigravity = eligibility?.allowAntigravityTextGeneration === true;
  return providers.filter((provider) => {
    if (provider.supportsTextGeneration === false) {
      return false;
    }
    if (provider.driver === "antigravity" && !allowAntigravity) {
      return false;
    }
    return true;
  });
}

export function getTextGenerationModelOptionsByInstance(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedInstanceId?: ProviderInstanceId | null,
  selectedModel?: string | null,
  eligibility?: TextGenerationEligibilityOptions,
): ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>> {
  return new Map(
    orderedBrandedProviderInstanceEntries(
      resolveTextGenerationProviders(providers, eligibility),
      settings,
    ).map((entry) => [
      entry.instanceId,
      getTextGenerationModelOptionsForInstance(
        settings,
        entry,
        entry.instanceId === selectedInstanceId ? selectedModel : null,
      ),
    ]),
  );
}

export function selectsPlanAgent(options: ModelSelection["options"]): boolean {
  return options?.some((option) => option.id === "agent" && option.value === "plan") ?? false;
}

export function resolveAppModelSelectionState(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  eligibility?: TextGenerationEligibilityOptions,
): ModelSelection {
  const selection = settings.textGenerationModelSelection ?? {
    instanceId: DEFAULT_TEXT_GENERATION_INSTANCE_ID,
    model: DEFAULT_TEXT_GENERATION_MODEL,
  };
  const supportedProviders = resolveTextGenerationProviders(providers, eligibility);
  const entries = orderedBrandedProviderInstanceEntries(supportedProviders, settings);
  const selectedEntry = entries.find(
    (entry) => entry.instanceId === selection.instanceId && entry.enabled && entry.isAvailable,
  );
  const entry =
    selectedEntry ?? entries.find((candidate) => candidate.enabled && candidate.isAvailable);
  if (entry) {
    const selectedModel = selectedEntry ? selection.model : null;
    // Use the cheap generation default; the catalog default is the expensive chat flagship.
    const options = getTextGenerationModelOptionsForInstance(settings, entry);
    const model =
      resolveSelectableModel(entry.driverKind, selectedModel, options) ??
      resolveSelectableModel(
        entry.driverKind,
        DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[entry.driverKind],
        options,
      ) ??
      options.find((option) => option.isDefault)?.slug ??
      options[0]?.slug ??
      entry.models.find((model) => model.supportsTextGeneration !== false)?.slug ??
      DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[entry.driverKind];
    if (!model) {
      return createModelSelection(entry.instanceId, "", []);
    }
    const provider = entry.driverKind;
    const { modelOptionsForDispatch } = getComposerProviderState({
      provider,
      model,
      models: entry.models,
      modelOptions: selectedEntry ? selection.options : undefined,
      includePlanAgent: selectsPlanAgent(selection.options),
    });

    return createModelSelection(entry.instanceId, model, modelOptionsForDispatch);
  }

  return NO_PROVIDER_MODEL_SELECTION;
}
