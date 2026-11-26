import {
  DEFAULT_MODEL_BY_PROVIDER,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@prismux/core-contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  applyProviderInstanceSettings,
  brandProviderInstanceEntries,
  deriveProviderEntriesByEnvironment,
  deriveProviderInstanceEntries,
  getDefaultProviderInstanceModel,
  isProviderInstancePickerReady,
  orderItemsByConfiguredProviderOrder,
  orderProviderInstanceEntries,
  providerInstanceEntriesFor,
  resolveConfiguredProviderLabel,
  resolveDefaultProviderModelSelection,
  resolveSelectableProviderInstance,
  shouldShowInstanceBadge,
} from "./providerInstances";

function provider(input: {
  provider: ProviderDriverKind;
  instanceId: string;
  enabled?: boolean;
  availability?: ServerProvider["availability"];
  displayName?: string;
  accentColor?: string;
  status?: ServerProvider["status"];
  models?: ServerProvider["models"];
  supportsTextGeneration?: boolean;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: input.provider,
    ...(input.supportsTextGeneration === undefined
      ? {}
      : { supportsTextGeneration: input.supportsTextGeneration }),
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    enabled: input.enabled ?? true,
    installed: true,
    version: null,
    status: input.status ?? "ready",
    ...(input.availability ? { availability: input.availability } : {}),
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: input.models ?? [],
    slashCommands: [],
    skills: [],
  };
}

const model = (slug: string, isCustom = false, isDefault = false) => ({
  slug,
  name: slug,
  isCustom,
  ...(isDefault ? { isDefault: true } : {}),
  capabilities: {},
});

describe("isProviderInstancePickerReady", () => {
  it("rejects a disabled instance even while its last probe status is ready", () => {
    const [entry] = deriveProviderInstanceEntries([
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: "codex",
        enabled: false,
      }),
    ]);

    expect(entry?.status).toBe("ready");
    expect(entry && isProviderInstancePickerReady(entry)).toBe(false);
  });

  it("offers a warning provider's models on its usable sub-providers only", () => {
    const backendModel = (slug: string, subProvider: string) => ({ ...model(slug), subProvider });
    const fx = (models: ServerProvider["models"]) => ({
      ...provider({
        provider: ProviderDriverKind.make("fx"),
        instanceId: "fx",
        status: "warning",
        models,
      }),
      subProviders: [
        { name: "Gateway" },
        { name: "Codex", unavailableReason: "Signed out. Run `fx login codex` on this machine." },
      ],
    });
    const ready = (snapshot: ServerProvider) =>
      deriveProviderInstanceEntries([snapshot]).map(isProviderInstancePickerReady)[0];

    expect(
      ready(fx([model("default", false, true), backendModel("openai/gpt-5.5", "Gateway")])),
    ).toBe(true);
    expect(ready(fx([model("default", false, true), backendModel("gpt-5.5", "Codex")]))).toBe(
      false,
    );
  });

  it("keeps offering the models a refresh retained when the catalog did not arrive in time", () => {
    const [entry] = deriveProviderInstanceEntries([
      {
        ...provider({
          provider: ProviderDriverKind.make("codex"),
          instanceId: "codex",
          status: "warning",
          models: [model("gpt-5.5", false, true), model("gpt-5.4")],
        }),
        message: "Codex did not return its model catalog in time.",
      },
    ]);

    expect(entry && isProviderInstancePickerReady(entry)).toBe(true);
    expect(
      entry && isProviderInstancePickerReady({ ...entry, models: [model("bailian", true)] }),
    ).toBe(true);
    expect(entry && isProviderInstancePickerReady({ ...entry, models: [] })).toBe(false);
  });

  it("offers a failed provider's models only while the server marks them retained", () => {
    const failed = provider({
      provider: ProviderDriverKind.make("codex"),
      instanceId: "codex",
      status: "error",
      models: [model("gpt-5.5", false, true)],
    });
    const ready = (snapshot: ServerProvider) =>
      deriveProviderInstanceEntries([snapshot]).map(isProviderInstancePickerReady)[0];

    expect(ready({ ...failed, modelsRetained: true })).toBe(true);
    expect(ready(failed)).toBe(false);
    expect(ready({ ...failed, status: "warning", auth: { status: "unknown" } })).toBe(false);
  });
});

describe("applyProviderInstanceSettings", () => {
  it("uses settings when a streamed snapshot still reports a disabled default as enabled", () => {
    const entries = deriveProviderInstanceEntries([
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex" }),
    ]);
    const [entry] = applyProviderInstanceSettings(
      entries,
      {
        providerInstances: {
          [ProviderInstanceId.make("codex")]: {
            driver: ProviderDriverKind.make("codex"),
            enabled: false,
          },
        },
        projectSettingsOverrides: {},
      },
      null,
    );

    expect(entry?.enabled).toBe(false);
  });

  it.each(["constructor", "toString"])(
    "treats a removed custom instance named %s as disabled",
    (instanceId) => {
      const entries = deriveProviderInstanceEntries([
        provider({
          provider: ProviderDriverKind.make("claudeAgent"),
          instanceId,
        }),
      ]);
      const [entry] = applyProviderInstanceSettings(
        entries,
        {
          providerInstances: {},
          projectSettingsOverrides: {},
        },
        null,
      );

      expect(entry?.enabled).toBe(false);
    },
  );

  // regression: #8337 provider ids matching Object.prototype keys resolved to prototype members
  it("uses settings for a configured custom instance named constructor", () => {
    const instanceId = ProviderInstanceId.make("constructor");
    const entries = deriveProviderInstanceEntries([
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId,
      }),
    ]);
    const [entry] = applyProviderInstanceSettings(
      entries,
      {
        providerInstances: {
          [instanceId]: {
            driver: ProviderDriverKind.make("claudeAgent"),
            enabled: false,
          },
        },
        projectSettingsOverrides: {},
      },
      null,
    );

    expect(entry?.enabled).toBe(false);
  });

  it("uses the driver default for an unconfigured built-in default instance", () => {
    const entries = deriveProviderInstanceEntries([
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex", enabled: false }),
      provider({ provider: ProviderDriverKind.make("grok"), instanceId: "grok", enabled: true }),
    ]);
    const [codex, grok] = applyProviderInstanceSettings(
      entries,
      {
        providerInstances: {},
        projectSettingsOverrides: {},
      },
      null,
    );

    expect(codex?.enabled).toBe(true);
    expect(grok?.enabled).toBe(false);
  });
});

describe("deriveProviderEntriesByEnvironment", () => {
  it("resolves registry branding from each environment's settings", () => {
    const instanceId = "custom-acp";
    const snapshot = provider({ provider: ProviderDriverKind.make("acpRegistry"), instanceId });
    const byEnvironment = deriveProviderEntriesByEnvironment(
      ["devin", "other-agent"].map(
        (agentId) =>
          [
            agentId,
            [snapshot],
            {
              providerInstances: {
                [instanceId]: {
                  driver: ProviderDriverKind.make("acpRegistry"),
                  enabled: true,
                  config: { agentId, registryIconUrl: `https://example.com/${agentId}.svg` },
                },
              },
              projectSettingsOverrides: {},
            },
          ] as const,
      ),
    );
    expect(byEnvironment.get("devin")?.get(instanceId)?.acpRegistryAgentId).toBe("devin");
    expect(byEnvironment.get("devin")?.get(instanceId)?.acpRegistryIconUrl).toBe(
      "https://example.com/devin.svg",
    );
    expect(byEnvironment.get("other-agent")?.get(instanceId)?.acpRegistryAgentId).toBe(
      "other-agent",
    );
  });

  // regression: #7292 sidebar provider icons resolved from the wrong environment
  it("keeps same-id default instances distinct per environment", () => {
    const byEnvironment = deriveProviderEntriesByEnvironment([
      [
        "local",
        [
          provider({
            provider: ProviderDriverKind.make("claude"),
            instanceId: "claude",
            displayName: "Claude Local",
            accentColor: "#112233",
          }),
        ],
      ],
      [
        "remote",
        [
          provider({
            provider: ProviderDriverKind.make("claude"),
            instanceId: "claude",
            displayName: "Claude Remote",
            accentColor: "#445566",
          }),
        ],
      ],
    ]);

    expect(byEnvironment.get("local")?.get("claude")?.displayName).toBe("Claude Local");
    expect(byEnvironment.get("local")?.get("claude")?.accentColor).toBe("#112233");
    expect(byEnvironment.get("remote")?.get("claude")?.displayName).toBe("Claude Remote");
    expect(byEnvironment.get("remote")?.get("claude")?.accentColor).toBe("#445566");
  });

  it("keeps an instance a project turns on as a sibling for the instance badge", () => {
    const codex = ProviderDriverKind.make("codex");
    const byEnvironment = deriveProviderEntriesByEnvironment([
      [
        "local",
        [
          provider({ provider: codex, instanceId: "codex" }),
          provider({ provider: codex, instanceId: "codex_work" }),
        ],
        {
          providerInstances: {
            [ProviderInstanceId.make("codex_work")]: { driver: codex, enabled: false },
          },
          projectSettingsOverrides: {
            [ProjectId.make("project-work")]: {
              providerInstances: { [ProviderInstanceId.make("codex_work")]: { enabled: true } },
            },
          },
        },
      ],
    ]);
    const entries = byEnvironment.get("local");
    const personal = entries?.get("codex");

    expect(personal && shouldShowInstanceBadge(personal, entries?.values() ?? [])).toBe(true);
  });
});

describe("brandProviderInstanceEntries", () => {
  it("keeps an instance a project turns on as a sibling for the instance badge", () => {
    const codex = ProviderDriverKind.make("codex");
    const settings = {
      providerInstances: {
        [ProviderInstanceId.make("codex_work")]: { driver: codex, enabled: false },
      },
      projectSettingsOverrides: {
        [ProjectId.make("project-work")]: {
          providerInstances: { [ProviderInstanceId.make("codex_work")]: { enabled: true } },
        },
      },
    };
    const entries = brandProviderInstanceEntries(
      deriveProviderInstanceEntries([
        provider({ provider: codex, instanceId: "codex" }),
        provider({ provider: codex, instanceId: "codex_work" }),
      ]),
      settings,
    );
    const personal = entries.find((entry) => entry.instanceId === "codex");

    expect(personal && shouldShowInstanceBadge(personal, entries)).toBe(true);
  });
});

describe("resolveSelectableProviderInstance", () => {
  it("falls back to the first enabled and available instance", () => {
    const disabled = ProviderInstanceId.make("codex");
    const fallback = ProviderInstanceId.make("claudeAgent");
    const providers = [
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: disabled,
        enabled: false,
      }),
      provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: fallback }),
    ];

    expect(resolveSelectableProviderInstance(providers, disabled)).toBe(fallback);
  });

  it("prefers a ready instance over an enabled one whose driver cannot start", () => {
    const notInstalled = ProviderInstanceId.make("codex");
    const ready = ProviderInstanceId.make("claudeAgent");
    const providers = [
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: notInstalled,
        status: "error",
      }),
      provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: ready }),
    ];

    expect(resolveSelectableProviderInstance(providers, undefined)).toBe(ready);
  });

  it("keeps a requested instance even when its probe errored", () => {
    const requested = ProviderInstanceId.make("codex");
    const providers = [
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: requested,
        status: "error",
      }),
      provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: "claudeAgent" }),
    ];

    expect(resolveSelectableProviderInstance(providers, requested)).toBe(requested);
  });

  // regression: #4117 users without Codex got a broken default provider
  it("does not invent an errored instance as a new-user default", () => {
    const notInstalled = ProviderInstanceId.make("codex");
    const providers = [
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: notInstalled,
        status: "error",
      }),
    ];

    expect(resolveSelectableProviderInstance(providers, undefined)).toBeUndefined();
  });

  it("does not return disabled, unavailable, or unknown instances when none are sendable", () => {
    const disabled = ProviderInstanceId.make("codex");
    const unavailable = ProviderInstanceId.make("claudeAgent");
    const unknown = ProviderInstanceId.make("removed_instance");
    const providers = [
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: disabled,
        enabled: false,
      }),
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: unavailable,
        availability: "unavailable",
      }),
    ];

    expect(resolveSelectableProviderInstance(providers, disabled)).toBeUndefined();
    expect(resolveSelectableProviderInstance(providers, unavailable)).toBeUndefined();
    expect(resolveSelectableProviderInstance(providers, unknown)).toBeUndefined();
  });
});

describe("getDefaultProviderInstanceModel", () => {
  it("uses the instance's own models, not the default instance of the kind", () => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claude_openrouter",
        models: [model("openai/gpt-5.5", true), model("claude-opus-4-8")],
      }),
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claudeAgent",
        models: [model("claude-sonnet-5")],
      }),
    ];

    expect(
      getDefaultProviderInstanceModel(providers, ProviderInstanceId.make("claude_openrouter")),
    ).toBe("claude-opus-4-8");
  });

  it("falls back to the driver default when the instance reports no models", () => {
    const providers = [
      provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: "claudeAgent" }),
    ];

    const resolved = getDefaultProviderInstanceModel(
      providers,
      ProviderInstanceId.make("claudeAgent"),
    );
    expect(resolved).toBe(DEFAULT_MODEL_BY_PROVIDER[ProviderDriverKind.make("claudeAgent")]);
  });

  it("honors the instance's declared default before model-list order", () => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claudeAgent",
        models: [model("claude-sonnet-5"), model("claude-opus-4-8", false, true)],
      }),
    ];

    expect(getDefaultProviderInstanceModel(providers, ProviderInstanceId.make("claudeAgent"))).toBe(
      "claude-opus-4-8",
    );
  });
});

describe("resolveDefaultProviderModelSelection", () => {
  // regression: #4117 users without Codex got a broken default provider
  it.each([
    ["codex", "codex", "gpt-5.6"],
    ["claudeAgent", "claudeAgent", "claude-fable-5"],
    ["cursor", "cursor", "composer-2"],
  ])("uses the only available %s instance", (driver, instanceId, modelSlug) => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make(driver),
        instanceId,
        models: [model(modelSlug, false, true)],
      }),
    ];

    expect(resolveDefaultProviderModelSelection(providers, null)).toEqual({
      instanceId,
      model: modelSlug,
    });
  });

  it("preserves a valid stored selection including its options", () => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claudeAgent",
        models: [model("claude-opus-4-8")],
      }),
    ];
    const stored = {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "custom-model",
      options: [{ id: "effort", value: "high" }],
    };

    expect(resolveDefaultProviderModelSelection(providers, stored)).toBe(stored);
  });

  it("replaces a stale stored instance with the first ready instance and its model", () => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: "codex",
        status: "warning",
        models: [model("gpt-5.6")],
      }),
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claudeAgent",
        models: [model("claude-opus-4-8", false, true)],
      }),
    ];

    expect(
      resolveDefaultProviderModelSelection(providers, {
        instanceId: ProviderInstanceId.make("removed-provider"),
        model: "stale-model",
      }),
    ).toEqual({ instanceId: "claudeAgent", model: "claude-opus-4-8" });
  });

  // regression: #4117 users without Codex got a broken default provider
  it.each([{ enabled: false }, { availability: "unavailable" as const }])(
    "replaces an unavailable stored instance deterministically",
    (requestedState) => {
      const providers = [
        provider({
          provider: ProviderDriverKind.make("codex"),
          instanceId: "codex",
          models: [model("gpt-5.6")],
          ...requestedState,
        }),
        provider({
          provider: ProviderDriverKind.make("claudeAgent"),
          instanceId: "claudeAgent",
          models: [model("claude-opus-4-8", false, true)],
        }),
      ];

      expect(
        resolveDefaultProviderModelSelection(providers, {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.6",
        }),
      ).toEqual({ instanceId: "claudeAgent", model: "claude-opus-4-8" });
    },
  );

  it("returns no selection for empty, disabled, unavailable, or error-only profiles", () => {
    expect(resolveDefaultProviderModelSelection([], null)).toBeNull();
    expect(
      resolveDefaultProviderModelSelection(
        [
          provider({
            provider: ProviderDriverKind.make("codex"),
            instanceId: "codex",
            enabled: false,
          }),
        ],
        null,
      ),
    ).toBeNull();
    expect(
      resolveDefaultProviderModelSelection(
        [
          provider({
            provider: ProviderDriverKind.make("codex"),
            instanceId: "codex",
            availability: "unavailable",
          }),
        ],
        null,
      ),
    ).toBeNull();
    expect(
      resolveDefaultProviderModelSelection(
        [
          provider({
            provider: ProviderDriverKind.make("codex"),
            instanceId: "codex",
            status: "error",
          }),
        ],
        null,
      ),
    ).toBeNull();
  });
});

describe("provider icon metadata", () => {
  it("clears stale registry branding when an instance switches to a local command", () => {
    const instanceId = ProviderInstanceId.make("custom-acp");
    const driver = ProviderDriverKind.make("acpRegistry");
    const iconUrl = "https://cdn.agentclientprotocol.com/registry/icons/swe-agent.svg";
    const snapshots = deriveProviderInstanceEntries([
      { ...provider({ provider: driver, instanceId }), iconUrl },
    ]);
    const registryConfig = { agentId: "swe-agent", registryIconUrl: iconUrl };
    const brandedEntries = applyProviderInstanceSettings(
      snapshots,
      {
        providerInstances: { [instanceId]: { driver, enabled: true, config: registryConfig } },
        projectSettingsOverrides: {},
      },
      null,
    );
    expect(brandedEntries[0]?.acpRegistryAgentId).toBe("swe-agent");
    expect(brandedEntries[0]?.acpRegistryIconUrl).toBe(iconUrl);

    const [localEntry] = applyProviderInstanceSettings(
      brandedEntries,
      {
        providerInstances: {
          [instanceId]: {
            driver,
            enabled: false,
            config: { ...registryConfig, source: "local", commandPath: "dsh" },
          },
        },
        projectSettingsOverrides: {},
      },
      null,
    );
    expect(localEntry?.acpRegistryAgentId).toBeUndefined();
    expect(localEntry?.acpRegistryIconUrl).toBeUndefined();
    expect(localEntry?.acpCommandPath).toBe("dsh");
    expect(localEntry?.enabled).toBe(false);
    expect(localEntry?.snapshot).toBe(snapshots[0]?.snapshot);

    const [restoredEntry] = applyProviderInstanceSettings(
      localEntry ? [localEntry] : [],
      {
        providerInstances: { [instanceId]: { driver, enabled: true, config: registryConfig } },
        projectSettingsOverrides: {},
      },
      null,
    );
    expect(restoredEntry?.acpRegistryAgentId).toBe("swe-agent");
    expect(restoredEntry?.acpRegistryIconUrl).toBe(iconUrl);
    expect(restoredEntry?.acpCommandPath).toBeUndefined();
    expect(restoredEntry?.enabled).toBe(true);
  });

  it("syncs settings displayName immediately, scrubs UUID instance IDs, and disambiguates unnamed siblings", () => {
    const codex = ProviderDriverKind.make("codex");
    const uuidId = ProviderInstanceId.make("codex_048c43c3-0798-480e-bc42-1a2b3c4d5e6f");
    const snapshots = [
      provider({ provider: codex, instanceId: uuidId, displayName: "ChatGPT - Personal" }),
    ];

    // Rename in settings to "Codex" takes effect immediately without leaking UUID
    const renamed = applyProviderInstanceSettings(
      deriveProviderInstanceEntries(snapshots),
      {
        providerInstances: {
          [uuidId]: { driver: codex, enabled: true, displayName: "Codex" },
        },
        projectSettingsOverrides: {},
      },
      null,
    );
    expect(renamed[0]?.displayName).toBe("Codex");

    // Rename in settings to custom label syncs before server snapshot refreshes
    const customRenamed = applyProviderInstanceSettings(
      deriveProviderInstanceEntries(snapshots),
      {
        providerInstances: {
          [uuidId]: { driver: codex, enabled: true, displayName: "主力 Codex" },
        },
        projectSettingsOverrides: {},
      },
      null,
    );
    expect(customRenamed[0]?.displayName).toBe("主力 Codex");

    // Clearing displayName on UUID instance falls back cleanly to "Codex", never UUID text
    const cleared = applyProviderInstanceSettings(
      deriveProviderInstanceEntries(snapshots),
      {
        providerInstances: {
          [uuidId]: { driver: codex, enabled: true },
        },
        projectSettingsOverrides: {},
      },
      null,
    );
    expect(cleared[0]?.displayName).toBe("Codex");
  });
});

describe("global provider SSOT ordering & custom naming helpers", () => {
  it("orders providerInstanceEntriesFor and deriveProviderEntriesByEnvironment by settings.providerOrder", () => {
    const codexId = ProviderInstanceId.make("codex");
    const claudeId = ProviderInstanceId.make("claudeAgent");
    const dshId = ProviderInstanceId.make("acpRegistry_dsh");
    const snapshots: ServerProvider[] = [
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: codexId }),
      provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: claudeId }),
      provider({ provider: ProviderDriverKind.make("acpRegistry"), instanceId: dshId }),
    ];
    const settings = {
      providerOrder: [dshId, claudeId, codexId],
      providerInstances: {
        [codexId]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          displayName: "主力 Codex",
        },
        [claudeId]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: true,
          displayName: "Claude",
        },
        [dshId]: {
          driver: ProviderDriverKind.make("acpRegistry"),
          enabled: true,
          displayName: "深度求索",
          config: { agentId: "dsh" },
        },
      },
      projectSettingsOverrides: {},
    };

    const pickerEntries = providerInstanceEntriesFor(snapshots, settings, null);
    expect(pickerEntries.map((entry) => entry.instanceId)).toEqual([dshId, claudeId, codexId]);
    expect(pickerEntries.map((entry) => entry.displayName)).toEqual([
      "深度求索",
      "Claude",
      "主力 Codex",
    ]);

    // Map insertion order in deriveProviderEntriesByEnvironment matches providerOrder
    const byEnv = deriveProviderEntriesByEnvironment([["local", snapshots, settings]]);
    expect([...(byEnv.get("local")?.keys() ?? [])]).toEqual([dshId, claudeId, codexId]);

    // orderProviderInstanceEntries preserves relative order for unlisted instances
    const partial = orderProviderInstanceEntries(pickerEntries, [codexId]);
    expect(partial.map((entry) => entry.instanceId)).toEqual([codexId, dshId, claudeId]);
  });

  it("resolves configured custom labels via instanceId, acpRegistryAgentId, or canonical brand ID", () => {
    const codexId = ProviderInstanceId.make("codex");
    const claudeId = ProviderInstanceId.make("claudeAgent");
    const claudeDisabledId = ProviderInstanceId.make("claude_old");
    const dshId = ProviderInstanceId.make("acp_custom_1");
    const entries = providerInstanceEntriesFor(
      [
        provider({ provider: ProviderDriverKind.make("codex"), instanceId: codexId }),
        provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: claudeDisabledId }),
        provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: claudeId }),
        provider({ provider: ProviderDriverKind.make("acpRegistry"), instanceId: dshId }),
      ],
      {
        providerOrder: [dshId, claudeId, codexId],
        providerInstances: {
          [codexId]: {
            driver: ProviderDriverKind.make("codex"),
            enabled: true,
            displayName: "主力 Codex",
          },
          [claudeDisabledId]: {
            driver: ProviderDriverKind.make("claudeAgent"),
            enabled: false,
            displayName: "禁用 Claude",
          },
          [claudeId]: {
            driver: ProviderDriverKind.make("claudeAgent"),
            enabled: true,
            displayName: "Claude",
          },
          [dshId]: {
            driver: ProviderDriverKind.make("acpRegistry"),
            enabled: true,
            displayName: "我的 DSH",
            config: { agentId: "dsh" },
          },
        },
        projectSettingsOverrides: {},
      },
      null,
    );

    expect(resolveConfiguredProviderLabel("codex", entries)).toBe("主力 Codex");
    expect(resolveConfiguredProviderLabel("claude-code", entries)).toBe("Claude");
    expect(resolveConfiguredProviderLabel("dsh", entries)).toBe("我的 DSH");
    expect(resolveConfiguredProviderLabel("deepseek-harness", entries)).toBe("我的 DSH");
    expect(resolveConfiguredProviderLabel("acp_custom_1", entries)).toBe("我的 DSH");
    expect(resolveConfiguredProviderLabel("cursor", entries, "Cursor CLI")).toBe("Cursor");
    expect(resolveConfiguredProviderLabel("cursor", entries, "My Cursor")).toBe("My Cursor");
  });

  it("orders arbitrary provider-keyed items by configured providerOrder and keeps unconfigured items stable", () => {
    const codexId = ProviderInstanceId.make("codex");
    const claudeId = ProviderInstanceId.make("claudeAgent");
    const dshId = ProviderInstanceId.make("acp_dsh_slot");
    const entries = providerInstanceEntriesFor(
      [
        provider({ provider: ProviderDriverKind.make("codex"), instanceId: codexId }),
        provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: claudeId }),
        provider({ provider: ProviderDriverKind.make("acpRegistry"), instanceId: dshId }),
      ],
      {
        providerOrder: [dshId, claudeId, codexId],
        providerInstances: {
          [dshId]: {
            driver: ProviderDriverKind.make("acpRegistry"),
            enabled: true,
            displayName: "极速 DSH",
            config: { agentId: "dsh" },
          },
        },
        projectSettingsOverrides: {},
      },
      null,
    );

    const items = [
      { id: "cursor", label: "Cursor" },
      { id: "codex", label: "Codex" },
      { id: "gemini", label: "Gemini" },
      { id: "claude-code", label: "Claude" },
      { id: "dsh", label: "DSH" },
    ];
    const ordered = orderItemsByConfiguredProviderOrder(
      items,
      (item) => item.id,
      entries,
      [dshId, claudeId, codexId],
    );
    expect(ordered.map((item) => item.id)).toEqual([
      "dsh",
      "claude-code",
      "codex",
      "cursor",
      "gemini",
    ]);
  });

  it("resolves renamed local ACP command entries via acpCommandPath without setting acpRegistryAgentId", () => {
    const localDshId = ProviderInstanceId.make("acp_local_custom_7");
    const entries = providerInstanceEntriesFor(
      [
        provider({
          provider: ProviderDriverKind.make("acpRegistry"),
          instanceId: localDshId,
          displayName: "我的本地助手",
        }),
      ],
      {
        providerOrder: [localDshId],
        providerInstances: {
          [localDshId]: {
            driver: ProviderDriverKind.make("acpRegistry"),
            enabled: true,
            displayName: "我的本地助手",
            config: {
              source: "local",
              commandPath: "C:\\Tools\\DeepSeek\\dsh.exe",
            },
          },
        },
        projectSettingsOverrides: {},
      },
      null,
    );

    expect(entries[0]?.acpRegistryAgentId).toBeUndefined();
    expect(entries[0]?.acpCommandPath).toBe("C:\\Tools\\DeepSeek\\dsh.exe");
    expect(resolveConfiguredProviderLabel("dsh", entries)).toBe("我的本地助手");
    expect(resolveConfiguredProviderLabel("deepseek-harness", entries)).toBe("我的本地助手");
  });
});
