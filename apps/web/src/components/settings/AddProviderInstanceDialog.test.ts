import { ProviderDriverKind } from "@prismux/core-contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildNewProviderInstanceConfig,
  DSH_FEATURED_PRESET_HOMEPAGE_URL,
  DSH_FEATURED_PRESET_INSERT_INDEX,
  DSH_FEATURED_PRESET_LABEL,
  filterSelectableProviderDrivers,
  getProviderIdentityDraft,
  orderFeaturedProviderDrivers,
  resolveAcpRegistryWizardNavigation,
  resolveWizardNavigation,
  selectPreferredLiveProvidersByDriver,
  shouldDefaultExpandAdvancedConfig,
  updateProviderIdentityDraft,
} from "./AddProviderInstanceDialog.logic";
import { isProviderConfirmedNotInstalled } from "./providerStatus";

describe("resolveWizardNavigation", () => {
  const invalidId = { instanceIdError: "Instance ID is required." };

  // regression: #2813 the wizard advanced past an invalid instance id
  it("blocks Next from Identity to Config while the instance id is invalid", () => {
    expect(resolveWizardNavigation(1, 2, 3, invalidId)).toEqual({
      kind: "blocked",
      step: 1,
      error: "Instance ID is required.",
    });
  });

  it("stops a direct Driver-to-Config skip at Identity and surfaces its error", () => {
    expect(resolveWizardNavigation(0, 2, 3, invalidId)).toEqual({
      kind: "blocked",
      step: 1,
      error: "Instance ID is required.",
    });
  });
});

describe("ACP Registry wizard", () => {
  it("requires a prepared result or valid manual configuration before Identity", () => {
    expect(
      resolveAcpRegistryWizardNavigation(0, 1, {
        instanceIdError: null,
        selectionError: "Select an ACP or configure one manually.",
      }),
    ).toEqual({
      kind: "blocked",
      step: 0,
      error: "Select an ACP or configure one manually.",
    });

    expect(
      resolveAcpRegistryWizardNavigation(0, 1, {
        instanceIdError: null,
        selectionError: null,
      }),
    ).toEqual({ kind: "navigate", step: 1 });
  });

  it("keeps registry-prefilled identity separate from other drivers", () => {
    const registryDrafts = updateProviderIdentityDraft({}, "acpRegistry", {
      label: "Gemini CLI",
      instanceIdOverride: "acpRegistry_gemini_cli",
    });

    expect(getProviderIdentityDraft(registryDrafts, "codex")).toEqual({
      label: "",
      accentColor: "",
      instanceIdOverride: null,
    });

    const drafts = updateProviderIdentityDraft(registryDrafts, "codex", {
      label: "Work",
      instanceIdOverride: "codex_work",
    });
    expect(getProviderIdentityDraft(drafts, "acpRegistry")).toMatchObject({
      label: "Gemini CLI",
      instanceIdOverride: "acpRegistry_gemini_cli",
    });
  });

  it("excludes retired fx and acpRegistry while keeping restored pi in selectable providers", () => {
    const filtered = filterSelectableProviderDrivers([
      { driverKind: "codex" },
      { driverKind: "claudeAgent" },
      { driverKind: "antigravity" },
      { driverKind: "opencode" },
      { driverKind: "pi" },
      { driverKind: "fx" },
      { driverKind: "acpRegistry" },
    ]);
    expect(filtered.map((item) => item.driverKind)).toEqual([
      "codex",
      "claudeAgent",
      "antigravity",
      "opencode",
      "pi",
    ]);
  });

  it("orders featured 2x2 grid strictly as Antigravity | Codex / Claude | DSH", () => {
    const ordered = orderFeaturedProviderDrivers([
      { driverKind: "codex" },
      { driverKind: "claudeAgent" },
      { driverKind: "antigravity" },
    ]);
    expect(ordered.map((item) => item.driverKind)).toEqual([
      "antigravity",
      "codex",
      "claudeAgent",
    ]);
    expect(DSH_FEATURED_PRESET_INSERT_INDEX).toBe(3);
    expect(DSH_FEATURED_PRESET_LABEL).toBe("DSH");
  });

  it("builds enabled-by-default verified configs for all agents and collapses Advanced except for manual custom Local ACP", () => {
    expect(
      buildNewProviderInstanceConfig({
        driver: ProviderDriverKind.make("acpRegistry"),
        label: "",
        isLocalAcp: true,
        selectedFeaturedPreset: "dsh",
      }),
    ).toEqual({
      driver: ProviderDriverKind.make("acpRegistry"),
      displayName: "DSH",
      enabled: true,
      config: {
        source: "local",
        commandPath: "dsh",
        commandArgs: ["acp"],
        homepageUrl: DSH_FEATURED_PRESET_HOMEPAGE_URL,
      },
    });

    expect(
      buildNewProviderInstanceConfig({
        driver: ProviderDriverKind.make("antigravity"),
        label: "Antigravity CLI",
        isLocalAcp: false,
        selectedFeaturedPreset: null,
      }),
    ).toEqual({
      driver: ProviderDriverKind.make("antigravity"),
      displayName: "Antigravity CLI",
      enabled: true,
      config: { authMethod: "local-cli" },
    });

    expect(
      buildNewProviderInstanceConfig({
        driver: ProviderDriverKind.make("codex"),
        label: "Codex",
        isLocalAcp: false,
        selectedFeaturedPreset: null,
      }),
    ).toEqual({
      driver: ProviderDriverKind.make("codex"),
      displayName: "Codex",
      enabled: true,
      config: { setupMode: "existing" },
    });

    for (const driverName of ["claudeAgent", "opencode", "pi"] as const) {
      expect(
        buildNewProviderInstanceConfig({
          driver: ProviderDriverKind.make(driverName),
          label: driverName,
          isLocalAcp: false,
          selectedFeaturedPreset: null,
        }).enabled,
      ).toBe(true);
    }

    expect(
      shouldDefaultExpandAdvancedConfig({ isLocalAcp: false, selectedFeaturedPreset: null }),
    ).toBe(false);
    expect(
      shouldDefaultExpandAdvancedConfig({ isLocalAcp: true, selectedFeaturedPreset: "dsh" }),
    ).toBe(false);
    expect(
      shouldDefaultExpandAdvancedConfig({ isLocalAcp: true, selectedFeaturedPreset: null }),
    ).toBe(true);
  });

  it("prefers enabled+installed > enabled > disabled in liveProvidersByDriver and never marks disabled providers as not installed", () => {
    const disabledClaude = {
      instanceId: "claudeAgent",
      driver: "claudeAgent",
      enabled: false,
      installed: false,
      status: "disabled" as const,
    };
    const enabledInstalledClaude = {
      instanceId: "claudeAgent_work",
      driver: "claudeAgent",
      enabled: true,
      installed: true,
      status: "ready" as const,
    };
    const disabledCodex = {
      instanceId: "codex",
      driver: "codex",
      enabled: false,
      installed: false,
      status: "disabled" as const,
    };
    const enabledMissingCodex = {
      instanceId: "codex_custom",
      driver: "codex",
      enabled: true,
      installed: false,
      status: "error" as const,
    };
    const disabledOnlyAgy = {
      instanceId: "antigravity",
      driver: "antigravity",
      enabled: false,
      installed: false,
      status: "disabled" as const,
    };

    const byDriver = selectPreferredLiveProvidersByDriver([
      disabledClaude,
      enabledInstalledClaude,
      disabledCodex,
      enabledMissingCodex,
      disabledOnlyAgy,
    ]);

    expect(byDriver.get("claudeAgent")?.instanceId).toBe("claudeAgent_work");
    expect(isProviderConfirmedNotInstalled(byDriver.get("claudeAgent"))).toBe(false);

    expect(byDriver.get("codex")?.instanceId).toBe("codex_custom");
    expect(isProviderConfirmedNotInstalled(byDriver.get("codex"))).toBe(true);

    expect(byDriver.get("antigravity")?.instanceId).toBe("antigravity");
    expect(isProviderConfirmedNotInstalled(byDriver.get("antigravity"))).toBe(false);
  });
});
