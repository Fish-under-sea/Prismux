import { useAtomValue } from "@effect/atom-react";
import {
  ProviderDriverKind,
  type ProviderInstanceId,
  type UsageProviderKind,
} from "@prismux/core-contracts";

import {
  formatAgentBrandName,
  resolveAgentBrandId,
  resolveProviderEntryDisplayName,
} from "../../prismux/agentBrand";
import {
  brandProviderInstanceEntries,
  deriveProviderInstanceEntries,
  disambiguateProviderInstanceDisplayNames,
  orderItemsByConfiguredProviderOrder,
  orderProviderInstanceEntries,
  resolveConfiguredProviderLabel,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { primaryServerProvidersAtom, primaryServerSettingsAtom } from "../../state/server";
import {
  formatUsageModelDisplayName,
  unwrapUsageModelSlug,
} from "./usageCallTelemetryStore";
import type { UsageMetric } from "./usageShortcuts";

export { formatUsageModelDisplayName, unwrapUsageModelSlug };

type UsageProviderPresentation = {
  readonly label: string;
  readonly color: string;
  readonly driverKind: ProviderDriverKind;
  readonly acpRegistryAgentId?: string | undefined;
};

export interface UsageProviderDisplayInfo {
  readonly label: string;
  readonly driverKind: ProviderDriverKind | null;
  readonly acpRegistryAgentId?: string | undefined;
  readonly acpRegistryIconUrl?: string | undefined;
  readonly instanceId?: ProviderInstanceId | undefined;
}

export const PROVIDER_PRESENTATION: Readonly<
  Record<UsageProviderKind, UsageProviderPresentation>
> = {
  codex: {
    label: "Codex",
    color: "var(--contrast-foreground)",
    driverKind: ProviderDriverKind.make("codex"),
  },
  claude: {
    label: "Claude Code",
    color: "#d97757",
    driverKind: ProviderDriverKind.make("claudeAgent"),
  },
  grok: {
    label: "Grok Build",
    color: "color-mix(in oklab, var(--contrast-foreground) 72%, var(--background))",
    driverKind: ProviderDriverKind.make("grok"),
  },
  cursor: { label: "Cursor", color: "#8b8b8b", driverKind: ProviderDriverKind.make("cursor") },
  opencode: {
    label: "OpenCode",
    color: "#5b9bbd",
    driverKind: ProviderDriverKind.make("opencode"),
  },
  antigravity: {
    label: "Antigravity",
    color: "#8c7bd1",
    driverKind: ProviderDriverKind.make("antigravity"),
  },
  pi: {
    label: "Pi",
    color: "#4d9f8a",
    driverKind: ProviderDriverKind.make("pi"),
  },
  muse: {
    label: "Muse Code",
    color: "#0866ff",
    driverKind: ProviderDriverKind.make("muse"),
  },
  dsh: {
    label: "DeepSeek Harness",
    color: "#4d6bfe",
    driverKind: ProviderDriverKind.make("acpRegistry"),
    acpRegistryAgentId: "dsh",
  },
};

export const PROVIDER_ORDER = Object.keys(PROVIDER_PRESENTATION) as UsageProviderKind[];

function isDshProviderEntry(entry: ProviderInstanceEntry): boolean {
  return (
    resolveAgentBrandId(entry.driverKind) === "dsh" ||
    resolveAgentBrandId(entry.acpRegistryAgentId) === "dsh" ||
    resolveAgentBrandId(entry.instanceId) === "dsh" ||
    resolveAgentBrandId(entry.displayName) === "dsh"
  );
}

function pickPreferredEntry(
  matches: ReadonlyArray<ProviderInstanceEntry>,
): ProviderInstanceEntry | undefined {
  if (matches.length === 0) return undefined;
  const enabled = matches.filter((entry) => entry.enabled);
  const pool = enabled.length > 0 ? enabled : matches;
  return (
    pool.find((entry) => entry.hasCustomDisplayName === true) ??
    pool.find(isDshProviderEntry) ??
    pool[0]
  );
}

function findConfiguredDshEntry(
  entries?: ReadonlyArray<ProviderInstanceEntry>,
): ProviderInstanceEntry | undefined {
  if (!entries || entries.length === 0) return undefined;
  return pickPreferredEntry(entries.filter(isDshProviderEntry));
}

function findConfiguredAcpRegistryEntry(
  entries?: ReadonlyArray<ProviderInstanceEntry>,
): ProviderInstanceEntry | undefined {
  if (!entries || entries.length === 0) return undefined;
  return pickPreferredEntry(entries.filter((entry) => entry.driverKind === "acpRegistry"));
}

export function resolveUsageProviderDisplay(
  provider: UsageProviderKind | string,
  entries?: ReadonlyArray<ProviderInstanceEntry>,
  fallbackAcpLabel?: string,
): UsageProviderDisplayInfo {
  const trimmed = (provider ?? "").trim();
  const lowered = trimmed.toLowerCase();

  if (lowered === "dsh" || resolveAgentBrandId(trimmed) === "dsh") {
    const dshEntry = findConfiguredDshEntry(entries);
    return {
      label: dshEntry
        ? resolveProviderEntryDisplayName(dshEntry)
        : PROVIDER_PRESENTATION.dsh.label,
      driverKind: dshEntry?.driverKind ?? PROVIDER_PRESENTATION.dsh.driverKind,
      acpRegistryAgentId: "dsh",
      ...(dshEntry ? { instanceId: dshEntry.instanceId } : {}),
    };
  }

  if (lowered === "acpregistry" || lowered === "acp-registry" || lowered === "acp_registry") {
    const acpEntry = findConfiguredAcpRegistryEntry(entries);
    if (acpEntry) {
      const entryIsDsh = isDshProviderEntry(acpEntry);
      return {
        label: resolveProviderEntryDisplayName(acpEntry),
        driverKind: ProviderDriverKind.make("acpRegistry"),
        acpRegistryAgentId: acpEntry.acpRegistryAgentId ?? (entryIsDsh ? "dsh" : undefined),
        ...(acpEntry.acpRegistryIconUrl ? { acpRegistryIconUrl: acpEntry.acpRegistryIconUrl } : {}),
        instanceId: acpEntry.instanceId,
      };
    }
    return {
      label: fallbackAcpLabel?.trim() || formatAgentBrandName("acpRegistry"),
      driverKind: ProviderDriverKind.make("acpRegistry"),
    };
  }

  if (trimmed in PROVIDER_PRESENTATION) {
    const info = PROVIDER_PRESENTATION[trimmed as UsageProviderKind];
    const lookupKey = info.acpRegistryAgentId ?? info.driverKind;
    const label =
      entries && entries.length > 0
        ? resolveConfiguredProviderLabel(lookupKey, entries, info.label)
        : info.label;
    return {
      label,
      driverKind: info.driverKind,
      ...(info.acpRegistryAgentId ? { acpRegistryAgentId: info.acpRegistryAgentId } : {}),
    };
  }

  if (entries && entries.length > 0) {
    const exact = entries.find(
      (entry) =>
        entry.instanceId === trimmed ||
        entry.instanceId.toLowerCase() === lowered ||
        entry.acpRegistryAgentId?.toLowerCase() === lowered,
    );
    if (exact) {
      return {
        label: resolveProviderEntryDisplayName(exact),
        driverKind: exact.driverKind,
        ...(exact.acpRegistryAgentId
          ? { acpRegistryAgentId: exact.acpRegistryAgentId }
          : isDshProviderEntry(exact)
            ? { acpRegistryAgentId: "dsh" }
            : {}),
        ...(exact.acpRegistryIconUrl ? { acpRegistryIconUrl: exact.acpRegistryIconUrl } : {}),
        instanceId: exact.instanceId,
      };
    }
    return {
      label: resolveConfiguredProviderLabel(trimmed, entries),
      driverKind: null,
    };
  }

  return {
    label: trimmed ? formatAgentBrandName(trimmed) : trimmed,
    driverKind: null,
  };
}

export function resolveUsageProviderLabel(
  provider: UsageProviderKind | string,
  entries?: ReadonlyArray<ProviderInstanceEntry>,
  fallbackAcpLabel?: string,
): string {
  return resolveUsageProviderDisplay(provider, entries, fallbackAcpLabel).label;
}

export function orderUsageProviders<T extends string>(
  providers: readonly T[],
  entries?: ReadonlyArray<ProviderInstanceEntry>,
  providerOrder?: ReadonlyArray<ProviderInstanceId> | null,
): readonly T[] {
  if (
    providers.length <= 1 ||
    (!providerOrder?.length && (!entries || entries.length === 0))
  ) {
    return providers;
  }
  return orderItemsByConfiguredProviderOrder(
    providers,
    (provider) => {
      if (provider in PROVIDER_PRESENTATION) {
        const presentation = PROVIDER_PRESENTATION[provider as UsageProviderKind];
        return presentation.acpRegistryAgentId ?? presentation.driverKind;
      }
      return provider;
    },
    entries ?? [],
    providerOrder,
  );
}

export function useConfiguredUsageProviders(overrides?: {
  readonly providerEntries?: ReadonlyArray<ProviderInstanceEntry> | undefined;
  readonly providerOrder?: ReadonlyArray<ProviderInstanceId> | null | undefined;
}) {
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const serverSettings = useAtomValue(primaryServerSettingsAtom);
  const effectiveProviderOrder =
    overrides?.providerOrder !== undefined
      ? overrides.providerOrder
      : serverSettings.providerOrder;
  const entries: ReadonlyArray<ProviderInstanceEntry> =
    overrides?.providerEntries !== undefined
      ? overrides.providerEntries
      : disambiguateProviderInstanceDisplayNames(
          orderProviderInstanceEntries(
            brandProviderInstanceEntries(
              deriveProviderInstanceEntries(serverProviders),
              serverSettings,
            ),
            serverSettings.providerOrder,
          ),
        );

  const getLabel = (provider: UsageProviderKind | string) =>
    resolveUsageProviderLabel(provider, entries);
  const orderProviders = <T extends string>(providers: readonly T[]) =>
    orderUsageProviders(providers, entries, effectiveProviderOrder);

  return {
    entries,
    providerOrder: effectiveProviderOrder,
    getLabel,
    orderProviders,
  };
}

export function providersWithUsage(
  totals: readonly {
    readonly provider: UsageProviderKind;
    readonly costUsd: number;
    readonly totalTokens: number;
  }[],
): readonly UsageProviderKind[] {
  const active = new Set(
    totals
      .filter((entry) => entry.totalTokens > 0 || entry.costUsd > 0)
      .map((entry) => entry.provider),
  );
  return PROVIDER_ORDER.filter((provider) => active.has(provider));
}

export function rankProvidersByMetric(
  providers: readonly UsageProviderKind[],
  totals: readonly {
    readonly provider: UsageProviderKind;
    readonly costUsd: number;
    readonly totalTokens: number;
  }[],
  metric: UsageMetric,
): readonly UsageProviderKind[] {
  const field = metric === "cost" ? "costUsd" : "totalTokens";
  const value = (provider: UsageProviderKind) =>
    totals.find((entry) => entry.provider === provider)?.[field] ?? 0;
  return providers.toSorted((left, right) => value(right) - value(left));
}
