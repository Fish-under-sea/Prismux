import { useAtomValue } from "@effect/atom-react";
import {
  ProviderDriverKind,
  type ProviderInstanceId,
  type UsageProviderKind,
} from "@prismux/core-contracts";

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
import type { UsageMetric } from "./usageShortcuts";

type UsageProviderPresentation = {
  readonly label: string;
  readonly color: string;
  readonly driverKind: ProviderDriverKind;
};

export const PROVIDER_PRESENTATION = {
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
} satisfies Record<UsageProviderKind, UsageProviderPresentation>;

export const PROVIDER_ORDER = Object.keys(PROVIDER_PRESENTATION) as UsageProviderKind[];

export function resolveUsageProviderLabel(
  provider: UsageProviderKind | string,
  entries?: ReadonlyArray<ProviderInstanceEntry>,
): string {
  const presentation =
    provider in PROVIDER_PRESENTATION
      ? PROVIDER_PRESENTATION[provider as UsageProviderKind]
      : undefined;
  if (entries && entries.length > 0) {
    return resolveConfiguredProviderLabel(
      presentation?.driverKind ?? provider,
      entries,
      presentation?.label,
    );
  }
  return presentation?.label ?? provider;
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
    (provider) =>
      provider in PROVIDER_PRESENTATION
        ? PROVIDER_PRESENTATION[provider as UsageProviderKind].driverKind
        : provider,
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
