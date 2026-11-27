import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider, ServerSettings } from "@prismux/core-contracts";

import {
  brandProviderInstanceEntries,
  containsUuidNoise,
  deriveProviderInstanceEntries,
  disambiguateProviderInstanceDisplayNames,
  orderProviderInstanceEntries,
  resolveConfiguredProviderLabel,
  type ProviderInstanceEntry,
  type ProviderInstanceOrderSettings,
} from "../providerInstances";
import { primaryServerProvidersAtom, primaryServerSettingsAtom } from "../state/server";
import {
  CANONICAL_PROVIDER_DISPLAY_NAMES,
  formatAgentBrandName,
  getCanonicalProviderDisplayName,
  resolveAcpAgentBrandKey,
  resolveAgentBrandId,
  resolveProviderEntryDisplayName,
  toCanonicalChiefProviderId,
} from "./agentBrand";

export {
  CANONICAL_PROVIDER_DISPLAY_NAMES,
  formatAgentBrandName,
  getCanonicalProviderDisplayName,
  resolveConfiguredProviderLabel,
  resolveProviderEntryDisplayName,
};

export type ConfiguredProviderSettingsSlice = Pick<ServerSettings, "providerInstances"> &
  Partial<Pick<ServerSettings, "providerOrder">>;

export interface ResolveConfiguredProviderDisplayNameInput {
  /** Provider identifier: instanceId, driver kind, usage kind, or alias (e.g. `claudeAgent`, `claude-code`, `codex`, `dsh`). */
  readonly provider?: string | null | undefined;
  /** Optional explicit provider instance ID (highest priority match in configured instances). */
  readonly instanceId?: string | null | undefined;
  /** Optional provider driver kind (e.g. `claudeAgent`, `codex`, `antigravity`, `opencode`, `pi`, `acpRegistry`). */
  readonly driverKind?: string | null | undefined;
  /** Optional ACP registry agent ID (e.g. `dsh`, `gemini-cli`). */
  readonly acpRegistryAgentId?: string | null | undefined;
  /** Pre-derived & branded provider instance entries (from `providerInstanceEntriesFor` / `useConfiguredProviderEntries`). */
  readonly providerInstances?: ReadonlyArray<ProviderInstanceEntry> | null | undefined;
  /** Raw live `ServerProvider` snapshots (used when `providerInstances` is not pre-derived). */
  readonly providers?: ReadonlyArray<ServerProvider> | null | undefined;
  /** Optional server settings carrying user-customized `providerInstances[id].displayName` and `providerOrder`. */
  readonly settings?: ConfiguredProviderSettingsSlice | null | undefined;
  /** Optional fallback display name when neither configured instances nor canonical aliases match. */
  readonly fallbackDisplayName?: string | null | undefined;
}

function buildEntriesFromSnapshots(
  providers: ReadonlyArray<ServerProvider>,
  settings?: ConfiguredProviderSettingsSlice | null,
): ReadonlyArray<ProviderInstanceEntry> {
  const derived = deriveProviderInstanceEntries(providers);
  const branded = settings ? brandProviderInstanceEntries(derived, settings) : derived;
  const ordered = orderProviderInstanceEntries(branded, settings?.providerOrder);
  return disambiguateProviderInstanceDisplayNames(ordered);
}

function normalizeKey(raw: string | null | undefined): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function resolveConfiguredNameFromSettingsOnly(
  input: Pick<
    ResolveConfiguredProviderDisplayNameInput,
    "provider" | "instanceId" | "driverKind" | "acpRegistryAgentId" | "settings"
  >,
): string | null {
  const configuredMap = input.settings?.providerInstances;
  if (!configuredMap || typeof configuredMap !== "object") {
    return null;
  }

  const lookupKeys = [
    input.instanceId,
    input.provider,
    input.acpRegistryAgentId,
    input.driverKind,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (lookupKeys.length === 0) {
    return null;
  }

  // 1. Exact instanceId key match in settings.providerInstances
  for (const key of lookupKeys) {
    const trimmed = key.trim();
    if (!Object.hasOwn(configuredMap, trimmed)) continue;
    const rawName = configuredMap[trimmed as keyof typeof configuredMap]?.displayName?.trim();
    if (rawName && !containsUuidNoise(rawName)) {
      return rawName;
    }
  }

  // 2. Canonical brand / driver match across settings.providerInstances (prefer enabled custom names)
  const targetCanonical = lookupKeys
    .map((key) => {
      const brand = resolveAgentBrandId(key);
      return brand !== "custom" && brand !== "acp"
        ? toCanonicalChiefProviderId(key)
        : normalizeKey(key);
    })
    .find(Boolean);

  if (!targetCanonical) {
    return null;
  }

  const matches: Array<{ readonly enabled: boolean; readonly displayName: string }> = [];
  for (const [id, cfg] of Object.entries(configuredMap)) {
    if (!cfg) continue;
    const rawName = cfg.displayName?.trim();
    if (!rawName || containsUuidNoise(rawName)) continue;

    const configObj =
      cfg.config !== null && typeof cfg.config === "object"
        ? (cfg.config as Record<string, unknown>)
        : null;
    const agentId = typeof configObj?.agentId === "string" ? configObj.agentId.trim() : undefined;
    const candidates = [agentId, cfg.driver !== "acpRegistry" ? cfg.driver : undefined, id];
    const matched = candidates.some((candidate) => {
      if (!candidate) return false;
      const brand = resolveAgentBrandId(candidate);
      const canonical =
        brand !== "custom" && brand !== "acp"
          ? toCanonicalChiefProviderId(candidate)
          : normalizeKey(candidate);
      return canonical === targetCanonical;
    });

    if (matched) {
      matches.push({ enabled: cfg.enabled !== false, displayName: rawName });
    }
  }

  if (matches.length === 0) {
    return null;
  }
  return (matches.find((item) => item.enabled) ?? matches[0])?.displayName ?? null;
}

/**
 * Resolves any user-facing provider display name: configured `displayName` from
 * `providerInstances` / `providers` + `settings` wins, falling back to `CANONICAL_PROVIDER_DISPLAY_NAMES`.
 */
export function resolveConfiguredProviderDisplayName(
  input: ResolveConfiguredProviderDisplayNameInput,
): string {
  const effectiveEntries: ReadonlyArray<ProviderInstanceEntry> =
    input.providerInstances && input.providerInstances.length > 0
      ? input.providerInstances
      : input.providers && input.providers.length > 0
        ? buildEntriesFromSnapshots(input.providers, input.settings)
        : [];

  const lookupKeys = [
    input.instanceId,
    input.acpRegistryAgentId,
    input.provider,
    input.driverKind && input.driverKind !== "acpRegistry" ? input.driverKind : undefined,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  const primaryKey = lookupKeys[0] ?? input.driverKind ?? "";
  const canonicalFallback = formatAgentBrandName(
    input.acpRegistryAgentId || input.driverKind || input.provider || input.instanceId,
    input.fallbackDisplayName,
  );

  if (effectiveEntries.length > 0) {
    // 1a. Exact instanceId match takes absolute precedence
    const explicitInstanceId = input.instanceId?.trim() || input.provider?.trim();
    if (explicitInstanceId) {
      const exact = effectiveEntries.find((entry) => entry.instanceId === explicitInstanceId);
      if (exact) {
        return resolveProviderEntryDisplayName(exact);
      }
    }

    // 1b. Match via acpRegistryAgentId / acpCommandPath / canonical brand ID across lookup keys
    for (const key of lookupKeys) {
      const targetBrand = resolveAgentBrandId(key);
      const exactEntryExists = effectiveEntries.some((entry) => {
        if (normalizeKey(entry.instanceId) === normalizeKey(key)) return true;
        if (
          entry.acpRegistryAgentId !== undefined &&
          normalizeKey(entry.acpRegistryAgentId) === normalizeKey(key)
        ) {
          return true;
        }
        if (targetBrand === "custom" || targetBrand === "acp") return false;
        if (entry.driverKind === "acpRegistry") {
          const acpBrand = resolveAcpAgentBrandKey({
            agentId: entry.acpRegistryAgentId,
            commandPath: entry.acpCommandPath,
            instanceId: entry.instanceId,
            displayName: entry.displayName,
          });
          if (acpBrand && resolveAgentBrandId(acpBrand) === targetBrand) {
            return true;
          }
        }
        return (
          resolveAgentBrandId(
            entry.acpRegistryAgentId ||
              (entry.driverKind !== "acpRegistry" ? entry.driverKind : entry.instanceId),
          ) === targetBrand
        );
      });
      if (exactEntryExists) {
        return resolveConfiguredProviderLabel(key, effectiveEntries, canonicalFallback);
      }
    }
  }

  // 1c. Settings-only fallback (when provider snapshots have not hydrated yet or in settings-only views)
  const fromSettings = resolveConfiguredNameFromSettingsOnly(input);
  if (fromSettings) {
    return fromSettings;
  }

  // 2. Canonical authoritative default display name
  if (primaryKey) {
    return formatAgentBrandName(primaryKey, input.fallbackDisplayName);
  }
  return canonicalFallback;
}

/**
 * Formats a slash/separator-joined list of providers (e.g. `"Codex / Claude / OpenCode"`)
 * while dynamically applying each provider's configured `displayName` when present.
 */
export function formatConfiguredProviderList(
  providers: ReadonlyArray<string>,
  options?: {
    readonly providerInstances?: ReadonlyArray<ProviderInstanceEntry> | null | undefined;
    readonly providers?: ReadonlyArray<ServerProvider> | null | undefined;
    readonly settings?: ConfiguredProviderSettingsSlice | null | undefined;
    readonly separator?: string | undefined;
  },
): string {
  const separator = options?.separator ?? " / ";
  return providers
    .map((provider) =>
      resolveConfiguredProviderDisplayName({
        provider,
        providerInstances: options?.providerInstances,
        providers: options?.providers,
        settings: options?.settings,
      }),
    )
    .join(separator);
}

/**
 * React hook returning live configured & branded `ProviderInstanceEntry[]` from primary server atoms,
 * with optional overrides for deterministic tests or non-primary environments.
 */
export function useConfiguredProviderEntries(overrides?: {
  readonly serverProvidersOverride?: ReadonlyArray<ServerProvider> | undefined;
  readonly settingsOverride?:
    | ProviderInstanceOrderSettings
    | ConfiguredProviderSettingsSlice
    | null
    | undefined;
  readonly providerEntriesOverride?: ReadonlyArray<ProviderInstanceEntry> | undefined;
}): ReadonlyArray<ProviderInstanceEntry> {
  const liveProviders = useAtomValue(primaryServerProvidersAtom);
  const liveSettings = useAtomValue(primaryServerSettingsAtom);

  if (overrides?.providerEntriesOverride !== undefined) {
    return overrides.providerEntriesOverride;
  }
  const effectiveProviders = overrides?.serverProvidersOverride ?? liveProviders;
  const effectiveSettings =
    overrides?.settingsOverride !== undefined ? overrides.settingsOverride : liveSettings;
  return buildEntriesFromSnapshots(effectiveProviders, effectiveSettings);
}

/**
 * React hook returning a live resolver function backed by configured `providerInstances` settings.
 */
export function useResolveConfiguredProviderDisplayName(overrides?: {
  readonly serverProvidersOverride?: ReadonlyArray<ServerProvider> | undefined;
  readonly settingsOverride?:
    | ProviderInstanceOrderSettings
    | ConfiguredProviderSettingsSlice
    | null
    | undefined;
  readonly providerEntriesOverride?: ReadonlyArray<ProviderInstanceEntry> | undefined;
}) {
  const liveSettings = useAtomValue(primaryServerSettingsAtom);
  const effectiveSettings =
    overrides?.settingsOverride !== undefined ? overrides.settingsOverride : liveSettings;
  const entries = useConfiguredProviderEntries(overrides);

  const resolveName = (
    input:
      | string
      | Omit<ResolveConfiguredProviderDisplayNameInput, "providerInstances" | "settings">,
  ): string => {
    if (typeof input === "string") {
      return resolveConfiguredProviderDisplayName({
        provider: input,
        providerInstances: entries,
        settings: effectiveSettings,
      });
    }
    return resolveConfiguredProviderDisplayName({
      ...input,
      providerInstances: entries,
      settings: effectiveSettings,
    });
  };

  const formatList = (providers: ReadonlyArray<string>, separator = " / "): string =>
    formatConfiguredProviderList(providers, {
      providerInstances: entries,
      settings: effectiveSettings,
      separator,
    });

  return {
    entries,
    resolveName,
    formatList,
  };
}
