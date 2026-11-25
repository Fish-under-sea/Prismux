import { ProviderDriverKind, ProviderInstanceId } from "@prismux/core-contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  orderUsageProviders,
  rankProvidersByMetric,
  resolveUsageProviderDisplay,
  resolveUsageProviderLabel,
} from "./usageProviders";

describe("rankProvidersByMetric", () => {
  it("ranks by the selected metric, highest first", () => {
    const totals = [
      { provider: "codex" as const, totalTokens: 100, costUsd: 20 },
      { provider: "claude" as const, totalTokens: 200, costUsd: 10 },
    ];
    const providers = ["codex", "claude"] as const;

    expect(rankProvidersByMetric(providers, totals, "tokens")).toEqual(["claude", "codex"]);
    expect(rankProvidersByMetric(providers, totals, "cost")).toEqual(["codex", "claude"]);
  });

  it("keeps ties in input order without reordering the shared provider list", () => {
    const totals = [
      { provider: "codex" as const, totalTokens: 10, costUsd: 1 },
      { provider: "claude" as const, totalTokens: 10, costUsd: 1 },
      { provider: "grok" as const, totalTokens: 20, costUsd: 2 },
    ];
    const providers = ["claude", "codex", "grok"] as const;

    expect(rankProvidersByMetric(providers, totals, "tokens")).toEqual(["grok", "claude", "codex"]);
    expect(providers).toEqual(["claude", "codex", "grok"]);
  });
});

describe("DSH & legacy acpRegistry provider resolution", () => {
  const customDshEntry: ProviderInstanceEntry = {
    instanceId: ProviderInstanceId.make("acpRegistry-dsh"),
    driverKind: ProviderDriverKind.make("acpRegistry"),
    displayName: "DeepSeek Studio",
    hasCustomDisplayName: true,
    acpRegistryAgentId: "dsh",
    enabled: true,
    installed: true,
    status: "ready",
    isDefault: false,
    isAvailable: true,
    snapshot: {} as ProviderInstanceEntry["snapshot"],
    models: [],
  };

  it("resolves dsh to configured custom display name (or DeepSeek Harness fallback) with dsh icon metadata", () => {
    const withCustom = resolveUsageProviderDisplay("dsh", [customDshEntry]);
    expect(withCustom.label).toBe("DeepSeek Studio");
    expect(withCustom.driverKind).toBe("acpRegistry");
    expect(withCustom.acpRegistryAgentId).toBe("dsh");

    const fallback = resolveUsageProviderDisplay("dsh", []);
    expect(fallback.label).toBe("DeepSeek Harness");
    expect(fallback.driverKind).toBe("acpRegistry");
    expect(fallback.acpRegistryAgentId).toBe("dsh");
  });

  it("resolves legacy acpRegistry logs to configured instance name or friendly fallback without leaking raw acpRegistry", () => {
    const withCustom = resolveUsageProviderDisplay("acpRegistry", [customDshEntry]);
    expect(withCustom.label).toBe("DeepSeek Studio");
    expect(withCustom.acpRegistryAgentId).toBe("dsh");

    expect(resolveUsageProviderLabel("acpRegistry", [], "ACP Agent")).toBe("ACP Agent");
    expect(resolveUsageProviderLabel("acpRegistry", [])).not.toBe("acpRegistry");
  });

  it("orders dsh accurately against configured providerOrder", () => {
    const codexEntry: ProviderInstanceEntry = {
      ...customDshEntry,
      instanceId: ProviderInstanceId.make("codex"),
      driverKind: ProviderDriverKind.make("codex"),
      displayName: "Codex",
      hasCustomDisplayName: false,
      acpRegistryAgentId: undefined,
    };
    const ordered = orderUsageProviders(
      ["codex", "dsh"],
      [codexEntry, customDshEntry],
      [customDshEntry.instanceId, codexEntry.instanceId],
    );
    expect(ordered).toEqual(["dsh", "codex"]);
  });
});
