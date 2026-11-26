import { pipe } from "effect/Function";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  defaultInstanceIdForDriver,
  resolveProjectProviderInstanceEnabled,
  type ModelSelection,
  type ProjectId,
  type ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
  type ServerSettings,
  type ServerProviderState,
} from "@prismux/core-contracts";
import {
  containsUuidNoise,
  disambiguateProviderInstanceDisplayNames,
  normalizeProviderAccentColor,
  resolveProviderInstanceDisplayName,
  shouldShowInstanceBadge,
} from "@prismux/client-runtime/state/provider-instance-display";
import {
  formatAgentBrandName,
  resolveAcpAgentBrandKey,
  resolveAgentBrandId,
  resolveProviderEntryDisplayName,
  toCanonicalChiefProviderId,
} from "./prismux/agentBrand";

export {
  containsUuidNoise,
  disambiguateProviderInstanceDisplayNames,
  normalizeProviderAccentColor,
  shouldShowInstanceBadge,
};

/** Placeholder for untargetable drafts. Never persist or dispatch it; disable send until replaced. */
export const NO_PROVIDER_MODEL_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("prismux_no_provider"),
  model: "",
};

export interface ProviderInstanceEntry {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly hasCustomDisplayName?: boolean | undefined;
  readonly accentColor?: string | undefined;
  readonly acpRegistryAgentId?: string | undefined;
  readonly acpRegistryIconUrl?: string | undefined;
  readonly acpCommandPath?: string | undefined;
  readonly continuationGroupKey?: string | undefined;
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly status: ServerProviderState;
  readonly isDefault: boolean;
  readonly isAvailable: boolean;
  readonly snapshot: ServerProvider;
  readonly models: ReadonlyArray<ServerProviderModel>;
}

/** Status dots share one corner per user, so a badge on one row can't move only that row's dot. */
export function hasInstanceBadge(entries: ReadonlyArray<ProviderInstanceEntry>): boolean {
  return entries.some((entry) => shouldShowInstanceBadge(entry, entries));
}

/**
 * Disabled instances may retain ready status until reconciliation. A warning still offers
 * the models of sub-providers that report no problem of their own.
 */
function isProviderInstanceHealthy(entry: ProviderInstanceEntry): boolean {
  if (!entry.enabled || !entry.isAvailable) return false;
  if (entry.status === "ready") return true;
  if (entry.status !== "warning") return false;
  const usable = new Set(
    entry.snapshot.subProviders?.flatMap((subProvider) =>
      subProvider.unavailableReason === undefined ? [subProvider.name] : [],
    ),
  );
  return entry.models.some(
    (model) => model.subProvider !== undefined && usable.has(model.subProvider),
  );
}

/** Also true after a check that only failed or ran late: an earlier check's models stay offered. */
export function isProviderInstancePickerReady(entry: ProviderInstanceEntry): boolean {
  if (isProviderInstanceHealthy(entry)) return true;
  const { subProviders, auth, modelsRetained } = entry.snapshot;
  if (!entry.enabled || !entry.isAvailable || subProviders !== undefined) return false;
  if (modelsRetained === true) return true;
  // The sign-in was confirmed, so the warning is about something else, such as a late catalog.
  return (
    entry.status === "warning" &&
    entry.installed &&
    auth.status === "authenticated" &&
    entry.models.length > 0
  );
}

export function isProviderInstancePickerVisible(entry: ProviderInstanceEntry): boolean {
  return entry.enabled;
}

export function deriveProviderInstanceEntries(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ProviderInstanceEntry> {
  return providers.map((snapshot) => {
    const instanceId = snapshot.instanceId;
    const driverKind = snapshot.driver;
    const defaultId = defaultInstanceIdForDriver(driverKind);
    const isDefault = instanceId === defaultId;
    const rawSnapshotName = snapshot.displayName?.trim();
    const canonicalDriverBrand = formatAgentBrandName(driverKind);
    const formattedSnapshotName = rawSnapshotName
      ? formatAgentBrandName(driverKind, rawSnapshotName)
      : "";
    const hasCustomDisplayName = Boolean(
      rawSnapshotName &&
        !containsUuidNoise(rawSnapshotName) &&
        formattedSnapshotName.toLowerCase() === rawSnapshotName.toLowerCase() &&
        formattedSnapshotName.toLowerCase() !== canonicalDriverBrand.toLowerCase(),
    );
    return {
      instanceId,
      driverKind,
      displayName: resolveProviderInstanceDisplayName(snapshot),
      hasCustomDisplayName,
      accentColor: normalizeProviderAccentColor(snapshot.accentColor),
      ...(driverKind === "acpRegistry" && snapshot.iconUrl
        ? { acpRegistryIconUrl: snapshot.iconUrl }
        : {}),
      continuationGroupKey: snapshot.continuation?.groupKey,
      enabled: snapshot.enabled,
      installed: snapshot.installed,
      status: snapshot.status,
      isDefault,
      isAvailable: snapshot.availability !== "unavailable",
      snapshot,
      models: snapshot.models,
    } satisfies ProviderInstanceEntry;
  });
}

export type ProviderInstanceOrderSettings = Pick<
  ServerSettings,
  "providerInstances" | "projectSettingsOverrides"
> &
  Partial<Pick<ServerSettings, "providerOrder">>;

/**
 * Orders provider instance entries according to the user's persisted `providerOrder`,
 * preserving original relative order for any unlisted or newly discovered instances.
 */
export function orderProviderInstanceEntries<
  T extends { readonly instanceId: ProviderInstanceId },
>(
  entries: ReadonlyArray<T>,
  providerOrder: ReadonlyArray<ProviderInstanceId> | null | undefined,
): ReadonlyArray<T> {
  if (!providerOrder || providerOrder.length === 0 || entries.length <= 1) {
    return entries;
  }
  const rankById = new Map<ProviderInstanceId, number>();
  for (const [index, instanceId] of providerOrder.entries()) {
    if (!rankById.has(instanceId)) {
      rankById.set(instanceId, index);
    }
  }
  if (rankById.size === 0) {
    return entries;
  }
  return entries
    .map((entry, originalIndex) => ({
      entry,
      rank: rankById.get(entry.instanceId) ?? Number.POSITIVE_INFINITY,
      originalIndex,
    }))
    .toSorted((left, right) =>
      left.rank !== right.rank ? left.rank - right.rank : left.originalIndex - right.originalIndex,
    )
    .map((item) => item.entry);
}

function normalizeProviderLookupKey(raw: string | null | undefined): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function resolveLookupCanonicalId(rawKey: string): string | null {
  const trimmed = rawKey.trim();
  if (!trimmed) return null;
  const brand = resolveAgentBrandId(trimmed);
  if (brand !== "custom" && brand !== "acp") {
    return toCanonicalChiefProviderId(trimmed);
  }
  return normalizeProviderLookupKey(trimmed);
}

function resolveEntryCanonicalId(
  entry: Pick<
    ProviderInstanceEntry,
    "instanceId" | "driverKind" | "acpRegistryAgentId" | "acpCommandPath" | "displayName"
  >,
): string | null {
  if (entry.driverKind === "acpRegistry") {
    const acpBrand = resolveAcpAgentBrandKey({
      agentId: entry.acpRegistryAgentId,
      commandPath: entry.acpCommandPath,
      instanceId: entry.instanceId,
      displayName: entry.displayName,
    });
    if (acpBrand) {
      return toCanonicalChiefProviderId(acpBrand);
    }
  }
  const candidates = [
    entry.acpRegistryAgentId,
    entry.driverKind !== "acpRegistry" ? entry.driverKind : undefined,
    entry.instanceId,
    entry.displayName,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const brand = resolveAgentBrandId(candidate);
    if (brand !== "custom" && brand !== "acp") {
      return toCanonicalChiefProviderId(candidate);
    }
  }
  if (entry.acpRegistryAgentId?.trim()) {
    return normalizeProviderLookupKey(entry.acpRegistryAgentId);
  }
  if (entry.driverKind === "acpRegistry") {
    return normalizeProviderLookupKey(entry.instanceId);
  }
  return normalizeProviderLookupKey(toCanonicalChiefProviderId(entry.driverKind || entry.instanceId));
}

function pickPreferredConfiguredEntry(
  matches: ReadonlyArray<ProviderInstanceEntry>,
): ProviderInstanceEntry | undefined {
  if (matches.length === 0) return undefined;
  const enabledMatches = matches.filter((entry) => entry.enabled);
  const pool = enabledMatches.length > 0 ? enabledMatches : matches;
  return pool.find((entry) => entry.hasCustomDisplayName === true) ?? pool[0];
}

/**
 * Single-Source-of-Truth label resolver for any provider ID, instance ID, driver kind, or alias.
 * Matches exact `instanceId`, then `acpRegistryAgentId` / canonical brand ID (`toCanonicalChiefProviderId`),
 * preferring enabled configured instances with `hasCustomDisplayName` or disambiguated `displayName`,
 * and falling back to `formatAgentBrandName(idOrDriver, fallbackDisplayName)`.
 */
export function resolveConfiguredProviderLabel(
  idOrDriver: string | null | undefined,
  entries: ReadonlyArray<ProviderInstanceEntry>,
  fallbackDisplayName?: string | null,
): string {
  const trimmed = typeof idOrDriver === "string" ? idOrDriver.trim() : "";
  if (!trimmed || entries.length === 0) {
    return formatAgentBrandName(idOrDriver, fallbackDisplayName);
  }

  const exactMatch = entries.find((entry) => entry.instanceId === trimmed);
  if (exactMatch) {
    return resolveProviderEntryDisplayName(exactMatch);
  }

  const normalizedKey = normalizeProviderLookupKey(trimmed);
  const directMatches = entries.filter(
    (entry) =>
      normalizeProviderLookupKey(entry.instanceId) === normalizedKey ||
      (entry.acpRegistryAgentId !== undefined &&
        normalizeProviderLookupKey(entry.acpRegistryAgentId) === normalizedKey),
  );
  const preferredDirect = pickPreferredConfiguredEntry(directMatches);
  if (preferredDirect) {
    return resolveProviderEntryDisplayName(preferredDirect);
  }

  const lookupCanonical = resolveLookupCanonicalId(trimmed);
  if (lookupCanonical) {
    const canonicalMatches = entries.filter(
      (entry) => resolveEntryCanonicalId(entry) === lookupCanonical,
    );
    const preferredCanonical = pickPreferredConfiguredEntry(canonicalMatches);
    if (preferredCanonical) {
      return resolveProviderEntryDisplayName(preferredCanonical);
    }
  }

  return formatAgentBrandName(idOrDriver, fallbackDisplayName);
}

/**
 * Maps arbitrary provider-keyed items (Daemon probes, Status Bar cards, Usage charts,
 * Chief/Overnight selectors, Diagnostics CLIs) into the exact order configured in `智能体配置`
 * (`providerOrder` + ordered `entries`), preserving relative order for unconfigured items.
 */
export function orderItemsByConfiguredProviderOrder<T>(
  items: ReadonlyArray<T>,
  getKey: (item: T) => string | null | undefined,
  entries: ReadonlyArray<ProviderInstanceEntry>,
  providerOrder?: ReadonlyArray<ProviderInstanceId> | null,
): ReadonlyArray<T> {
  if (items.length <= 1) {
    return items;
  }
  const hasExplicitOrder = Boolean(providerOrder && providerOrder.length > 0);
  if (!hasExplicitOrder && entries.length === 0) {
    return items;
  }

  const orderedEntries = orderProviderInstanceEntries(entries, providerOrder);
  const rankByExactKey = new Map<string, number>();
  const rankByCanonicalId = new Map<string, number>();

  const recordKeyRank = (rawKey: string | null | undefined, rank: number): void => {
    const normalized = normalizeProviderLookupKey(rawKey);
    if (!normalized) return;
    if (!rankByExactKey.has(normalized)) {
      rankByExactKey.set(normalized, rank);
    }
    const canonical = resolveLookupCanonicalId(normalized);
    if (canonical && !rankByCanonicalId.has(canonical)) {
      rankByCanonicalId.set(canonical, rank);
    }
  };

  const recordEntryRank = (entry: ProviderInstanceEntry, rank: number): void => {
    recordKeyRank(entry.instanceId, rank);
    recordKeyRank(entry.acpRegistryAgentId, rank);
    const canonical = resolveEntryCanonicalId(entry);
    if (canonical && !rankByCanonicalId.has(canonical)) {
      rankByCanonicalId.set(canonical, rank);
    }
    if (entry.driverKind !== "acpRegistry") {
      recordKeyRank(entry.driverKind, rank);
    }
  };

  let nextRank = 0;
  if (hasExplicitOrder && providerOrder) {
    const entryById = new Map(orderedEntries.map((entry) => [entry.instanceId, entry] as const));
    const seenIds = new Set<ProviderInstanceId>();
    for (const instanceId of providerOrder) {
      if (seenIds.has(instanceId)) continue;
      seenIds.add(instanceId);
      const rank = nextRank++;
      recordKeyRank(instanceId, rank);
      const entry = entryById.get(instanceId);
      if (entry) {
        recordEntryRank(entry, rank);
      }
    }
    for (const entry of orderedEntries) {
      if (seenIds.has(entry.instanceId)) continue;
      recordEntryRank(entry, nextRank++);
    }
  } else {
    for (const entry of orderedEntries) {
      recordEntryRank(entry, nextRank++);
    }
  }

  if (rankByExactKey.size === 0 && rankByCanonicalId.size === 0) {
    return items;
  }

  const resolveItemRank = (item: T): number => {
    const normalized = normalizeProviderLookupKey(getKey(item));
    if (!normalized) return Number.POSITIVE_INFINITY;
    const exactRank = rankByExactKey.get(normalized);
    if (exactRank !== undefined) return exactRank;
    const canonical = resolveLookupCanonicalId(normalized);
    if (canonical) {
      const canonicalRank = rankByCanonicalId.get(canonical);
      if (canonicalRank !== undefined) return canonicalRank;
    }
    return Number.POSITIVE_INFINITY;
  };

  return items
    .map((item, originalIndex) => ({
      item,
      rank: resolveItemRank(item),
      originalIndex,
    }))
    .toSorted((left, right) =>
      left.rank !== right.rank ? left.rank - right.rank : left.originalIndex - right.originalIndex,
    )
    .map((entry) => entry.item);
}

/** Instance ids repeat across environments; lookups must stay scoped. */
export function deriveProviderEntriesByEnvironment(
  providersByEnvironment: Iterable<
    readonly [
      string,
      ReadonlyArray<ServerProvider>,
      ProviderInstanceOrderSettings?,
    ]
  >,
): ReadonlyMap<string, ReadonlyMap<string, ProviderInstanceEntry>> {
  const byEnvironment = new Map<string, ReadonlyMap<string, ProviderInstanceEntry>>();
  for (const [environmentId, providers, settings] of providersByEnvironment) {
    const derived = deriveProviderInstanceEntries(providers);
    const branded = settings ? brandProviderInstanceEntries(derived, settings) : derived;
    const ordered = orderProviderInstanceEntries(branded, settings?.providerOrder);
    const entries = disambiguateProviderInstanceDisplayNames(ordered);
    byEnvironment.set(
      environmentId,
      new Map(entries.map((entry) => [entry.instanceId as string, entry] as const)),
    );
  }
  return byEnvironment;
}

// The snapshot includes instances enabled by any project; machine settings alone do not.
export function brandProviderInstanceEntries(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  settings: Pick<ServerSettings, "providerInstances">,
): ReadonlyArray<ProviderInstanceEntry> {
  return entries.map((entry) => applyProviderInstanceBranding(entry, settings));
}

/** projectId applies project overrides; explicit null uses machine settings. */
export function applyProviderInstanceSettings(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  settings: Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides">,
  projectId: ProjectId | null,
): ReadonlyArray<ProviderInstanceEntry> {
  return entries.map((entry) => {
    const enabled = resolveProjectProviderInstanceEnabled(settings, projectId, entry.instanceId);
    return applyProviderInstanceBranding(
      enabled === entry.enabled ? entry : { ...entry, enabled },
      settings,
    );
  });
}

function applyProviderInstanceBranding(
  entry: ProviderInstanceEntry,
  settings: Pick<ServerSettings, "providerInstances">,
): ProviderInstanceEntry {
  const explicitInstance = Object.hasOwn(settings.providerInstances, entry.instanceId)
    ? settings.providerInstances[entry.instanceId]
    : undefined;
  if (explicitInstance === undefined) return entry;

  const rawExplicitName = explicitInstance.displayName?.trim();
  const hasCustomDisplayName = Boolean(rawExplicitName && !containsUuidNoise(rawExplicitName));
  const nextDisplayName = resolveProviderInstanceDisplayName({
    instanceId: entry.instanceId,
    driver: entry.driverKind,
    displayName: explicitInstance.displayName,
  });
  const nextAccentColor = normalizeProviderAccentColor(explicitInstance.accentColor);

  const syncedEntry: ProviderInstanceEntry =
    nextDisplayName === entry.displayName &&
    hasCustomDisplayName === entry.hasCustomDisplayName &&
    nextAccentColor === entry.accentColor
      ? entry
      : {
          ...entry,
          displayName: nextDisplayName,
          hasCustomDisplayName,
          accentColor: nextAccentColor,
        };

  if (syncedEntry.driverKind !== "acpRegistry") return syncedEntry;
  const config =
    explicitInstance.config !== null && typeof explicitInstance.config === "object"
      ? (explicitInstance.config as Readonly<Record<string, unknown>>)
      : null;
  if (config?.source === "local") {
    const commandPath =
      typeof config.commandPath === "string" && config.commandPath.trim()
        ? config.commandPath.trim()
        : undefined;
    return {
      ...syncedEntry,
      acpRegistryAgentId: undefined,
      acpRegistryIconUrl: undefined,
      acpCommandPath: commandPath,
    };
  }
  const agentId = config?.agentId;
  const iconUrl = config?.registryIconUrl;
  return {
    ...syncedEntry,
    acpCommandPath: undefined,
    ...(typeof agentId === "string" && agentId.trim()
      ? { acpRegistryAgentId: agentId.trim() }
      : {}),
    ...(typeof iconUrl === "string" && iconUrl.trim()
      ? { acpRegistryIconUrl: iconUrl.trim() }
      : {}),
  };
}

/** Picker order: each driver's default instance first, then its custom instances, then user's `providerOrder`. */
export function providerInstanceEntriesFor(
  providers: ReadonlyArray<ServerProvider>,
  settings: ProviderInstanceOrderSettings,
  projectId: ProjectId | null,
): ReadonlyArray<ProviderInstanceEntry> {
  return pipe(
    deriveProviderInstanceEntries(providers),
    (entries) => applyProviderInstanceSettings(entries, settings, projectId),
    sortProviderInstanceEntries,
    (entries) => orderProviderInstanceEntries(entries, settings.providerOrder),
    disambiguateProviderInstanceDisplayNames,
  );
}

function sortProviderInstanceEntries(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ReadonlyArray<ProviderInstanceEntry> {
  const byKind = new Map<ProviderDriverKind, ProviderInstanceEntry[]>();
  for (const entry of entries) {
    const bucket = byKind.get(entry.driverKind);
    if (bucket) {
      bucket.push(entry);
    } else {
      byKind.set(entry.driverKind, [entry]);
    }
  }
  const sorted: ProviderInstanceEntry[] = [];
  for (const bucket of byKind.values()) {
    const defaults = bucket.filter((entry) => entry.isDefault);
    const customs = bucket.filter((entry) => !entry.isDefault);
    sorted.push(...defaults, ...customs);
  }
  return sorted;
}

function getProviderInstanceEntry(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
): ProviderInstanceEntry | undefined {
  return deriveProviderInstanceEntries(providers).find((entry) => entry.instanceId === instanceId);
}

export function getDefaultProviderInstanceModel(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
): string | undefined {
  const entry = getProviderInstanceEntry(providers, instanceId);
  if (!entry) return undefined;
  return (
    entry.models.find((model) => model.isDefault && !model.isCustom)?.slug ??
    entry.models.find((model) => !model.isCustom)?.slug ??
    entry.models[0]?.slug ??
    DEFAULT_MODEL_BY_PROVIDER[entry.driverKind]
  );
}

const isSelectableProviderInstanceEntry = (entry: ProviderInstanceEntry): boolean =>
  entry.enabled && entry.isAvailable;

export function resolveSelectableProviderInstanceEntry(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  instanceId: ProviderInstanceId | undefined,
): ProviderInstanceEntry | undefined {
  if (instanceId !== undefined) {
    const requested = entries.find((entry) => entry.instanceId === instanceId);
    if (requested && isSelectableProviderInstanceEntry(requested)) {
      return requested;
    }
  }
  return (
    entries.find(isProviderInstanceHealthy) ??
    entries.find((entry) => isSelectableProviderInstanceEntry(entry) && entry.status !== "error")
  );
}

export function resolveSelectableProviderInstance(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId | undefined,
): ProviderInstanceId | undefined {
  const entries = deriveProviderInstanceEntries(providers);
  return resolveSelectableProviderInstanceEntry(entries, instanceId)?.instanceId;
}

export function resolveDefaultProviderModelSelection(
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection | null | undefined,
): ModelSelection | null {
  const instanceId = resolveSelectableProviderInstance(providers, selection?.instanceId);
  if (instanceId === undefined) return null;
  if (selection?.instanceId === instanceId) return selection;
  const model = getDefaultProviderInstanceModel(providers, instanceId);
  return model ? { instanceId, model } : null;
}

export function resolveProjectDefaultProviderModelSelection(
  providers: ReadonlyArray<ServerProvider>,
  settings: ServerSettings,
  projectId: ProjectId | null,
): ModelSelection | null {
  const entries = providerInstanceEntriesFor(providers, settings, projectId);
  // Matches resolveComposerProviderSelection: the first driver group wins before any other.
  const entry =
    resolveSelectableProviderInstanceEntry(
      entries.filter((candidate) => candidate.driverKind === entries[0]?.driverKind),
      undefined,
    ) ?? resolveSelectableProviderInstanceEntry(entries, undefined);
  const model = entry ? getDefaultProviderInstanceModel(providers, entry.instanceId) : undefined;
  return entry && model ? { instanceId: entry.instanceId, model } : null;
}
