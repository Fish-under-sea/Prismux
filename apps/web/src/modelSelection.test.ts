import {
  ANTIGRAVITY_DEFAULT_MODEL,
  DEFAULT_TEXT_GENERATION_MODEL,
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@prismux/core-contracts";
import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_UNIFIED_SETTINGS,
  type UnifiedSettings,
} from "@prismux/core-contracts/settings";
import { describe, expect, it } from "vite-plus/test";
import { createModelSelection } from "@prismux/core-shared/model";
import { deriveEffectiveComposerModelState } from "./composerDraftStore";
import { getComposerProviderState } from "./components/chat/composerProviderState";
import { resolveComposerProviderSelection } from "./components/ChatView.logic";
import {
  deriveProviderInstanceEntries,
  NO_PROVIDER_MODEL_SELECTION,
  providerInstanceEntriesFor,
} from "./providerInstances";
import {
  applyDefaultReasoningEffortToSelection,
  defaultModelSelectionsAreMixed,
  getAppModelOptionsForInstance,
  getCustomModelOptionsByInstance,
  getTextGenerationModelOptionsByInstance,
  resolveAppModelSelectionForInstance,
  resolveAppModelSelectionState,
  resolveClosestReasoningEffortOption,
  resolveEffectiveDefaultModelSelection,
  resolveProjectDefaultModelSelectionForDraft,
  resolveTextGenerationProviders,
  stripReasoningEffortFromSelection,
  stripReasoningEffortOptions,
} from "./modelSelection";
import { resolveModelPickerTriggerTitle } from "./components/chat/ProviderModelPicker";

function provider(input: {
  provider?: ProviderDriverKind;
  instanceId: string;
  models?: ReadonlyArray<string>;
  supportsTextGeneration?: boolean;
}): ServerProvider {
  const driver =
    input.provider ??
    (input.instanceId.startsWith("claude_")
      ? ProviderDriverKind.make("claudeAgent")
      : ProviderDriverKind.make("codex"));
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver,
    ...(input.supportsTextGeneration === undefined
      ? {}
      : { supportsTextGeneration: input.supportsTextGeneration }),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: (input.models ?? []).map((slug) => ({
      slug,
      name: slug,
      isCustom: false,
      capabilities: {},
    })),
    slashCommands: [],
    skills: [],
  };
}

function settingsWithProviderInstances(): UnifiedSettings {
  return {
    ...DEFAULT_UNIFIED_SETTINGS,
    providerInstances: {
      [ProviderInstanceId.make("claudeAgent")]: {
        driver: ProviderDriverKind.make("claudeAgent"),
        config: { customModels: [] },
      },
      [ProviderInstanceId.make("claude_openrouter")]: {
        driver: ProviderDriverKind.make("claudeAgent"),
        config: { customModels: ["openai/gpt-5.5"] },
      },
    },
  };
}

describe("scoped default model selections", () => {
  // regression: #27997 equal automatic defaults can resolve to different providers
  it("compares automatic defaults using each environment's models", () => {
    const codex = {
      projectId: null,
      settings: DEFAULT_UNIFIED_SETTINGS,
      providers: [provider({ instanceId: "codex", models: ["gpt-6-astra"] })],
    };
    const claude = {
      projectId: null,
      settings: DEFAULT_UNIFIED_SETTINGS,
      providers: [
        provider({
          instanceId: "claudeAgent",
          provider: ProviderDriverKind.make("claudeAgent"),
          models: ["claude-sonnet-4-6"],
        }),
      ],
    };

    expect(defaultModelSelectionsAreMixed(DEFAULT_CLIENT_SETTINGS, [codex, claude])).toBe(true);
    expect(defaultModelSelectionsAreMixed(DEFAULT_CLIENT_SETTINGS, [claude, codex])).toBe(true);
    expect(defaultModelSelectionsAreMixed(DEFAULT_CLIENT_SETTINGS, [codex, codex])).toBe(false);
    expect(defaultModelSelectionsAreMixed(DEFAULT_CLIENT_SETTINGS, [claude])).toBe(false);
    expect(defaultModelSelectionsAreMixed(DEFAULT_CLIENT_SETTINGS, [])).toBe(false);
    expect(
      defaultModelSelectionsAreMixed(DEFAULT_CLIENT_SETTINGS, [codex, { ...codex, providers: [] }]),
    ).toBe(true);
    expect(
      defaultModelSelectionsAreMixed(DEFAULT_CLIENT_SETTINGS, [
        codex,
        { ...codex, providers: [provider({ instanceId: "codex", models: ["gpt-6-sol"] })] },
      ]),
    ).toBe(true);

    const projectId = ProjectId.make("claude-only");
    const project = {
      projectId,
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        projectSettingsOverrides: {
          [projectId]: {
            providerInstances: { [ProviderInstanceId.make("codex")]: { enabled: false } },
          },
        },
      },
      providers: [...codex.providers, ...claude.providers],
    };
    const remoteProject = { ...claude, projectId: ProjectId.make("remote-project") };
    expect(defaultModelSelectionsAreMixed(DEFAULT_CLIENT_SETTINGS, [project, remoteProject])).toBe(
      false,
    );
    expect(defaultModelSelectionsAreMixed(DEFAULT_CLIENT_SETTINGS, [remoteProject, project])).toBe(
      false,
    );
    expect(
      defaultModelSelectionsAreMixed(DEFAULT_CLIENT_SETTINGS, [
        project,
        { ...project, projectId: ProjectId.make("other-project") },
      ]),
    ).toBe(true);

    const configured = {
      projectId: null,
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        providerModelPreferences: {
          [ProviderInstanceId.make("codex")]: {
            hiddenModels: ["gpt-6-astra"],
            modelOrder: [],
          },
        },
      },
      providers: [provider({ instanceId: "codex", models: ["gpt-6-astra", "gpt-6-sol"] })],
    };
    const inherited = { ...configured, settings: DEFAULT_SERVER_SETTINGS };
    expect(defaultModelSelectionsAreMixed(DEFAULT_CLIENT_SETTINGS, [configured, inherited])).toBe(
      true,
    );
    expect(defaultModelSelectionsAreMixed(DEFAULT_CLIENT_SETTINGS, [inherited, configured])).toBe(
      true,
    );
    const clientSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      providerModelPreferences: configured.settings.providerModelPreferences,
    };
    expect(defaultModelSelectionsAreMixed(clientSettings, [configured, inherited])).toBe(false);
    expect(defaultModelSelectionsAreMixed(clientSettings, [inherited, configured])).toBe(false);
    expect(
      defaultModelSelectionsAreMixed(clientSettings, [
        { ...inherited, settings: { ...DEFAULT_SERVER_SETTINGS, providerModelPreferences: {} } },
        inherited,
      ]),
    ).toBe(true);
  });

  it("keeps automatic, explicit, and different saved options distinct", () => {
    const providers = [provider({ instanceId: "codex", models: ["gpt-6-astra"] })];
    const selected = {
      projectId: null,
      providers,
      settings: {
        ...DEFAULT_UNIFIED_SETTINGS,
        defaultModelSelection: createModelSelection(
          ProviderInstanceId.make("codex"),
          "gpt-6-astra",
        ),
      },
    };
    expect(
      defaultModelSelectionsAreMixed(DEFAULT_CLIENT_SETTINGS, [selected, { ...selected }]),
    ).toBe(false);
    expect(
      defaultModelSelectionsAreMixed(DEFAULT_CLIENT_SETTINGS, [
        selected,
        { projectId: null, providers, settings: DEFAULT_UNIFIED_SETTINGS },
      ]),
    ).toBe(true);
    expect(
      defaultModelSelectionsAreMixed(DEFAULT_CLIENT_SETTINGS, [
        selected,
        {
          ...selected,
          settings: {
            ...selected.settings,
            defaultModelSelection: {
              ...selected.settings.defaultModelSelection,
              options: [{ id: "reasoningEffort", value: "xhigh" }],
            },
          },
        },
      ]),
    ).toBe(true);
  });
});

describe("instance-scoped model selection", () => {
  it("keeps custom models on the provider instance that declared them", () => {
    const providers = [
      provider({
        instanceId: "claudeAgent",
        models: ["claude-sonnet-4-6"],
      }),
      provider({
        instanceId: "claude_openrouter",
        models: ["claude-sonnet-4-6"],
      }),
    ];
    const entries = deriveProviderInstanceEntries(providers);
    const stock = entries.find((entry) => entry.instanceId === "claudeAgent")!;
    const openrouter = entries.find((entry) => entry.instanceId === "claude_openrouter")!;

    expect(
      getAppModelOptionsForInstance(settingsWithProviderInstances(), stock).map(
        (option) => option.slug,
      ),
    ).not.toContain("openai/gpt-5.5");
    expect(
      getAppModelOptionsForInstance(settingsWithProviderInstances(), openrouter).map(
        (option) => option.slug,
      ),
    ).toContain("openai/gpt-5.5");
  });

  it("preserves a custom slug that collides with a provider alias", () => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claude_openrouter",
        models: ["claude-opus-4-8"],
      }),
    ];
    const settings: UnifiedSettings = {
      ...settingsWithProviderInstances(),
      providerInstances: {
        ...settingsWithProviderInstances().providerInstances,
        [ProviderInstanceId.make("claude_openrouter")]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          config: { customModels: ["opus"] },
        },
      },
    };
    const openrouter = deriveProviderInstanceEntries(providers)[0]!;

    expect(
      getAppModelOptionsForInstance(settings, openrouter).map((option) => option.slug),
    ).toEqual(["claude-opus-4-8", "opus"]);
    expect(
      resolveAppModelSelectionForInstance(
        ProviderInstanceId.make("claude_openrouter"),
        settings,
        providers,
        "opus",
      ),
    ).toBe("opus");
  });

  it("offers and resolves every saved custom model, past the first 32", () => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claude_openrouter",
      }),
    ];
    const customModels = Array.from({ length: 40 }, (_, index) => `proxy/model-${index + 1}`);
    const settings: UnifiedSettings = {
      ...settingsWithProviderInstances(),
      providerInstances: {
        ...settingsWithProviderInstances().providerInstances,
        [ProviderInstanceId.make("claude_openrouter")]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          config: { customModels },
        },
      },
    };
    const openrouter = deriveProviderInstanceEntries(providers)[0]!;

    expect(
      getAppModelOptionsForInstance(settings, openrouter).map((option) => option.slug),
    ).toEqual(customModels);
    expect(
      resolveAppModelSelectionForInstance(
        ProviderInstanceId.make("claude_openrouter"),
        settings,
        providers,
        "proxy/model-40",
      ),
    ).toBe("proxy/model-40");
  });

  it("drops server-reported custom rows that are no longer in settings", () => {
    const baseProvider = provider({
      instanceId: "claude_openrouter",
      models: ["claude-sonnet-4-6"],
    });
    const providers = [
      {
        ...baseProvider,
        models: [
          ...baseProvider.models,
          { slug: "removed/custom", name: "removed/custom", isCustom: true, capabilities: {} },
        ],
      },
    ];
    const openrouter = deriveProviderInstanceEntries(providers)[0]!;

    expect(
      getAppModelOptionsForInstance(settingsWithProviderInstances(), openrouter).map(
        (option) => option.slug,
      ),
    ).toEqual(["claude-sonnet-4-6", "openai/gpt-5.5"]);
  });

  it("falls back when the selected model is hidden", () => {
    const providers = [
      provider({
        instanceId: "claudeAgent",
        models: ["claude-opus-4-6", "claude-sonnet-4-6"],
      }),
    ];
    const settings: UnifiedSettings = {
      ...settingsWithProviderInstances(),
      providerModelPreferences: {
        [ProviderInstanceId.make("claudeAgent")]: {
          hiddenModels: ["claude-opus-4-6"],
          modelOrder: [],
        },
      },
    };

    expect(
      resolveAppModelSelectionForInstance(
        ProviderInstanceId.make("claudeAgent"),
        settings,
        providers,
        "claude-opus-4-6",
      ),
    ).toBe("claude-sonnet-4-6");
    expect(
      resolveAppModelSelectionForInstance(
        ProviderInstanceId.make("claudeAgent"),
        settings,
        providers,
        "claude-opus-4-6",
        { preserveUnavailableSelection: true },
      ),
    ).toBe("claude-sonnet-4-6");
  });

  it("falls back instead of resolving a custom slug against the wrong instance", () => {
    const providers = [
      provider({
        instanceId: "claudeAgent",
        models: ["claude-sonnet-4-6"],
      }),
      provider({
        instanceId: "claude_openrouter",
        models: ["claude-sonnet-4-6"],
      }),
    ];

    expect(
      resolveAppModelSelectionForInstance(
        ProviderInstanceId.make("claudeAgent"),
        settingsWithProviderInstances(),
        providers,
        "openai/gpt-5.5",
      ),
    ).toBe("claude-sonnet-4-6");
  });

  describe.each([
    {
      driverName: "pi",
      availableModel: "default",
      missingModel: "anthropic/claude-sonnet-4",
    },
    {
      driverName: "acpRegistry",
      availableModel: "default",
      missingModel: "gateway/chosen-model",
    },
    {
      driverName: "opencode",
      availableModel: "opencode/big-pickle",
      missingModel: "opencode/kimi-k3",
    },
    {
      driverName: "antigravity",
      availableModel: "gemini-3.1-pro",
      missingModel: "gemini-3.1-pro-high",
    },
    {
      driverName: "cursor",
      availableModel: "auto-smart",
      missingModel: "claude-opus-5-5",
    },
  ])("$driverName catalog gaps", ({ driverName, availableModel, missingModel }) => {
    it("preserves a selected model when a catalog refresh no longer contains it", () => {
      const providers = [
        provider({
          provider: ProviderDriverKind.make(driverName),
          instanceId: driverName,
          models: [availableModel],
        }),
      ];

      expect(
        resolveAppModelSelectionForInstance(
          ProviderInstanceId.make(driverName),
          settingsWithProviderInstances(),
          providers,
          missingModel,
          { preserveUnavailableSelection: true },
        ),
      ).toBe(missingModel);
      expect(
        resolveAppModelSelectionForInstance(
          ProviderInstanceId.make(driverName),
          settingsWithProviderInstances(),
          providers,
          missingModel,
        ),
      ).toBe(availableModel);
    });

    it("adds the selected missing model as an unavailable option", () => {
      const providers = [
        provider({
          provider: ProviderDriverKind.make(driverName),
          instanceId: driverName,
          models: [availableModel],
        }),
      ];
      const entry = deriveProviderInstanceEntries(providers)[0]!;

      expect(
        getAppModelOptionsForInstance(settingsWithProviderInstances(), entry, missingModel),
      ).toEqual([
        expect.objectContaining({ slug: availableModel }),
        expect.objectContaining({
          slug: missingModel,
          name: missingModel,
          isUnavailable: true,
        }),
      ]);
    });

    it("does not resurrect a hidden model when the raw catalog omits it", () => {
      const instanceId = ProviderInstanceId.make(driverName);
      const driver = ProviderDriverKind.make(driverName);
      const settings: UnifiedSettings = {
        ...settingsWithProviderInstances(),
        providerModelPreferences: {
          [instanceId]: {
            hiddenModels: [missingModel],
            modelOrder: [],
          },
        },
      };
      const providers = [provider({ provider: driver, instanceId, models: [] })];
      const entry = deriveProviderInstanceEntries(providers)[0]!;

      expect(getAppModelOptionsForInstance(settings, entry, missingModel)).toEqual([]);
      expect(
        resolveAppModelSelectionForInstance(instanceId, settings, providers, missingModel, {
          preserveUnavailableSelection: true,
        }),
      ).toBeNull();
    });
  });

  it("falls back from an explicit non-OpenCode draft with a missing model", () => {
    const instanceId = ProviderInstanceId.make("codex");
    const driver = ProviderDriverKind.make("codex");
    const providers = [provider({ provider: driver, instanceId, models: ["gpt-5.6-sol"] })];
    const state = deriveEffectiveComposerModelState({
      threadStarted: false,
      draft: {
        activeProvider: instanceId,
        modelSelectionByProvider: {
          [instanceId]: createModelSelection(instanceId, "gpt-missing", [
            { id: "effort", value: "max" },
          ]),
        },
      },
      providers,
      selectedProvider: driver,
      selectedInstanceId: instanceId,
      threadModelSelection: null,
      projectModelSelection: null,
      settings: settingsWithProviderInstances(),
    });
    const dispatch = getComposerProviderState({
      provider: driver,
      model: state.selectedModel,
      models: providers[0]!.models,
      modelOptions: state.modelOptions?.[instanceId],
    });

    expect(state.selectedModel).toBe("gpt-5.6-sol");
    expect(dispatch.modelOptionsForDispatch).toBeUndefined();
  });

  it("sends a Cursor thread's stored model and options when the catalog lacks them", () => {
    const instanceId = ProviderInstanceId.make("cursor");
    const driver = ProviderDriverKind.make("cursor");
    const stored = createModelSelection(instanceId, "claude-opus-5-5", [
      { id: "effort", value: "medium" },
    ]);
    const providers = [provider({ provider: driver, instanceId, models: ["auto-smart"] })];
    const state = deriveEffectiveComposerModelState({
      threadStarted: false,
      draft: null,
      providers,
      selectedProvider: driver,
      selectedInstanceId: instanceId,
      threadModelSelection: stored,
      projectModelSelection: null,
      settings: settingsWithProviderInstances(),
    });
    const dispatch = getComposerProviderState({
      provider: driver,
      model: state.selectedModel,
      models: providers[0]!.models,
      modelOptions: state.modelOptions?.[instanceId],
    });

    expect(
      createModelSelection(instanceId, state.selectedModel, dispatch.modelOptionsForDispatch),
    ).toEqual(stored);
  });

  it("preserves an explicit draft OpenCode selection while the catalog is empty", () => {
    const instanceId = ProviderInstanceId.make("opencode_work");
    const driver = ProviderDriverKind.make("opencode");
    const draftSelection = createModelSelection(instanceId, "openrouter/kimi-k3", [
      { id: "variant", value: "max" },
      { id: "agent", value: "build" },
    ]);
    const providers = [provider({ provider: driver, instanceId, models: [] })];
    const state = deriveEffectiveComposerModelState({
      threadStarted: false,
      draft: {
        activeProvider: instanceId,
        modelSelectionByProvider: { [instanceId]: draftSelection },
      },
      providers,
      selectedProvider: driver,
      selectedInstanceId: instanceId,
      threadModelSelection: null,
      projectModelSelection: null,
      settings: settingsWithProviderInstances(),
    });

    expect(state.selectedModel).toBe("openrouter/kimi-k3");
    expect(state.modelOptions?.[instanceId]).toEqual(draftSelection.options);
  });

  it("preserves the Antigravity model in drafts and existing threads after sign-out", () => {
    const instanceId = ProviderInstanceId.make("antigravity_work");
    const driver = ProviderDriverKind.make("antigravity");
    const saved = createModelSelection(instanceId, "gemini-3.1-pro-high");
    const providers = [
      {
        ...provider({ provider: driver, instanceId, models: [] }),
        status: "error" as const,
        auth: { status: "unauthenticated" as const },
      },
    ];
    for (const draft of [
      null,
      { activeProvider: instanceId, modelSelectionByProvider: { [instanceId]: saved } },
    ]) {
      const state = deriveEffectiveComposerModelState({
        threadStarted: false,
        draft,
        providers,
        selectedProvider: driver,
        selectedInstanceId: instanceId,
        threadModelSelection: saved,
        projectModelSelection: null,
        settings: settingsWithProviderInstances(),
      });
      expect(state.selectedModel).toBe(saved.model);
    }
  });

  it("does not borrow a default model while a new Antigravity account has no catalog", () => {
    const driver = ProviderDriverKind.make("antigravity");
    const instanceId = ProviderInstanceId.make("antigravity_work");
    const providers = [
      provider({ instanceId: "codex", models: ["gpt-5.6-sol"] }),
      provider({ provider: driver, instanceId: "antigravity", models: ["gemini-other-account"] }),
      provider({ provider: driver, instanceId, models: [] }),
    ];

    const otherAccountId = ProviderInstanceId.make("antigravity");
    for (const draft of [
      null,
      {
        activeProvider: instanceId,
        modelSelectionByProvider: {
          [otherAccountId]: createModelSelection(otherAccountId, "gemini-other-account"),
        },
      },
    ]) {
      const state = deriveEffectiveComposerModelState({
        threadStarted: false,
        draft,
        providers,
        selectedProvider: driver,
        selectedInstanceId: instanceId,
        threadModelSelection: null,
        projectModelSelection: createModelSelection(
          ProviderInstanceId.make("codex"),
          "gpt-5.6-sol",
        ),
        settings: settingsWithProviderInstances(),
      });
      expect(state.selectedModel).toBe("");
    }
  });

  it("offers only account catalog models for Antigravity despite custom model settings", () => {
    const driver = ProviderDriverKind.make("antigravity");
    const customId = ProviderInstanceId.make("antigravity_work");
    const nativeModel = "gemini-3.1-pro";
    const settings: UnifiedSettings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("antigravity")]: {
          driver,
          config: { customModels: ["api-only-model"] },
        },
        [customId]: { driver, config: { customModels: ["unknown-model"] } },
      },
    };
    const entries = deriveProviderInstanceEntries([
      provider({ provider: driver, instanceId: "antigravity", models: [nativeModel] }),
      provider({ provider: driver, instanceId: customId, models: [nativeModel] }),
    ]);

    for (const entry of entries) {
      expect(getAppModelOptionsForInstance(settings, entry).map((model) => model.slug)).toEqual([
        nativeModel,
      ]);
    }
  });

  it.each([
    { driver: "antigravity", marker: ANTIGRAVITY_DEFAULT_MODEL, nativeModel: "gemini-3.1-pro" },
    { driver: "acpRegistry", marker: "default", nativeModel: "agent-model" },
  ])(
    "resolves the $driver default marker without creating an unavailable model",
    ({ driver, marker, nativeModel }) => {
      const instanceId = ProviderInstanceId.make(`${driver}_work`);
      const base = provider({
        provider: ProviderDriverKind.make(driver),
        instanceId,
        models: [nativeModel],
      });
      const liveProvider = {
        ...base,
        models: base.models.map((model) => ({
          ...model,
          isDefault: true,
          ...(driver === "antigravity" ? { aliases: [marker] } : {}),
        })),
      };
      const settings = settingsWithProviderInstances();

      expect(
        getAppModelOptionsForInstance(
          settings,
          deriveProviderInstanceEntries([liveProvider])[0]!,
          marker,
        ).map((model) => model.slug),
      ).toEqual([nativeModel]);
      expect(
        resolveAppModelSelectionForInstance(instanceId, settings, [liveProvider], marker, {
          preserveUnavailableSelection: true,
        }),
      ).toBe(nativeModel);

      const hiddenSettings: UnifiedSettings = {
        ...settings,
        providerModelPreferences: {
          [instanceId]: { hiddenModels: [nativeModel], modelOrder: [] },
        },
      };
      expect(
        resolveAppModelSelectionForInstance(instanceId, hiddenSettings, [liveProvider], marker, {
          preserveUnavailableSelection: true,
        }),
      ).toBeNull();
      expect(
        getAppModelOptionsForInstance(
          settings,
          deriveProviderInstanceEntries([{ ...base, models: [] }])[0]!,
          marker,
        ),
      ).toEqual([]);
    },
  );

  it("preserves saved options through dispatch when the model is absent from the catalog", () => {
    const instanceId = ProviderInstanceId.make("opencode");
    const driver = ProviderDriverKind.make("opencode");
    const providers = [provider({ provider: driver, instanceId, models: ["opencode/big-pickle"] })];
    const saved = createModelSelection(instanceId, "opencode/kimi-k3", [
      { id: "variant", value: "max" },
      { id: "agent", value: "build" },
    ]);
    const state = deriveEffectiveComposerModelState({
      threadStarted: false,
      draft: null,
      providers,
      selectedProvider: driver,
      selectedInstanceId: instanceId,
      threadModelSelection: saved,
      projectModelSelection: null,
      settings: settingsWithProviderInstances(),
    });
    const dispatch = getComposerProviderState({
      provider: driver,
      model: state.selectedModel,
      models: providers[0]!.models,
      modelOptions: state.modelOptions?.[instanceId],
    });

    expect(
      createModelSelection(instanceId, state.selectedModel, dispatch.modelOptionsForDispatch),
    ).toEqual(saved);
  });

  describe("composer model option precedence", () => {
    const instanceId = ProviderInstanceId.make("claudeAgent");
    const driver = ProviderDriverKind.make("claudeAgent");
    const base = provider({ provider: driver, instanceId, models: ["claude-opus-5-5"] });
    const providers = [
      {
        ...base,
        models: base.models.map((model) => ({
          ...model,
          capabilities: {
            optionDescriptors: [
              {
                id: "effort",
                label: "Effort",
                type: "select" as const,
                options: [
                  { id: "medium", label: "Medium", isDefault: true },
                  { id: "high", label: "High" },
                ],
                currentValue: "medium",
              },
            ],
          },
        })),
      },
    ];
    const settingsDefault = createModelSelection(instanceId, "claude-opus-5-5", [
      { id: "effort", value: "high" },
    ]);
    const dispatchedSelection = (
      threadModelSelection: ReturnType<typeof createModelSelection> | null,
    ) => {
      const state = deriveEffectiveComposerModelState({
        threadStarted: false,
        draft: null,
        providers,
        selectedProvider: driver,
        selectedInstanceId: instanceId,
        threadModelSelection,
        projectModelSelection: settingsDefault,
        settings: settingsWithProviderInstances(),
      });
      const dispatch = getComposerProviderState({
        provider: driver,
        model: state.selectedModel,
        models: providers[0]!.models,
        modelOptions: state.modelOptions?.[instanceId],
      });
      return createModelSelection(
        instanceId,
        state.selectedModel,
        dispatch.modelOptionsForDispatch,
      );
    };

    it("does not inherit settings options for an optionless existing thread", () => {
      const threadSelection = createModelSelection(instanceId, "claude-opus-5-5");
      expect(dispatchedSelection(threadSelection)).toEqual(threadSelection);
    });

    it("keeps the options it was saved with", () => {
      const threadSelection = createModelSelection(instanceId, "claude-opus-5-5", [
        { id: "effort", value: "medium" },
      ]);
      expect(dispatchedSelection(threadSelection)).toEqual(threadSelection);
    });

    it("leaves the settings default's options in place before a thread exists", () => {
      expect(dispatchedSelection(null)).toEqual(settingsDefault);
    });
  });

  it("keeps a custom-instance draft model while dropping unsupported options", () => {
    const instanceId = ProviderInstanceId.make("claude_openrouter");
    const driver = ProviderDriverKind.make("claudeAgent");
    const providers = [
      provider({ provider: driver, instanceId: "claudeAgent", models: ["claude-opus-5"] }),
      provider({ provider: driver, instanceId, models: ["claude-opus-5"] }),
    ];
    const threadSelection = createModelSelection(instanceId, "claude-opus-5", [
      { id: "effort", value: "high" },
    ]);
    const draftSelection = createModelSelection(instanceId, "openai/gpt-5.5", [
      { id: "effort", value: "max" },
    ]);
    const state = deriveEffectiveComposerModelState({
      threadStarted: false,
      draft: {
        activeProvider: instanceId,
        modelSelectionByProvider: { [instanceId]: draftSelection },
      },
      providers,
      selectedProvider: driver,
      selectedInstanceId: instanceId,
      threadModelSelection: threadSelection,
      projectModelSelection: null,
      settings: settingsWithProviderInstances(),
    });
    const dispatch = getComposerProviderState({
      provider: driver,
      model: state.selectedModel,
      models: providers[1]!.models,
      modelOptions: state.modelOptions?.[instanceId],
    });

    expect(
      createModelSelection(instanceId, state.selectedModel, dispatch.modelOptionsForDispatch),
    ).toEqual(createModelSelection(instanceId, "openai/gpt-5.5"));
  });

  it("keeps a thread's stored options while the draft holds options for another provider", () => {
    const codex = ProviderInstanceId.make("codex");
    const claude = ProviderInstanceId.make("claudeAgent");
    const providers = [
      provider({ instanceId: "codex", models: ["gpt-5.5", "gpt-5.4"] }),
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claudeAgent",
        models: ["claude-opus-5-5"],
      }),
    ];
    const stored = createModelSelection(codex, "gpt-5.5", [
      { id: "reasoningEffort", value: "high" },
      { id: "fastMode", value: true },
    ]);
    const claudePick = createModelSelection(claude, "claude-opus-5-5", [
      { id: "effort", value: "max" },
    ]);
    const optionsFor = (
      draftSelections: Record<string, ReturnType<typeof createModelSelection>>,
      threadModelSelection = stored,
    ) =>
      deriveEffectiveComposerModelState({
        threadStarted: true,
        draft: {
          activeProvider: codex,
          modelSelectionByProvider: draftSelections,
          modelSelectionExplicit: true,
        },
        providers,
        selectedProvider: ProviderDriverKind.make("codex"),
        selectedInstanceId: codex,
        requestedInstanceId: claude,
        threadModelSelection,
        projectModelSelection: null,
        settings: DEFAULT_UNIFIED_SETTINGS,
      }).modelOptions;

    expect(
      optionsFor({ [claude]: claudePick, [codex]: createModelSelection(codex, "gpt-5.5") }),
    ).toEqual({ [claude]: claudePick.options, [codex]: stored.options });
    // Claude turned off after an unsent pick: the composer is back on the thread's instance.
    expect(optionsFor({ [claude]: claudePick })?.[codex]).toEqual(stored.options);
    const fastOff = createModelSelection(codex, "gpt-5.5", [
      { id: "reasoningEffort", value: "high" },
      { id: "fastMode", value: false },
    ]);
    expect(optionsFor({ [claude]: claudePick, [codex]: fastOff })?.[codex]).toEqual(
      fastOff.options,
    );
    // A stored alias of the shown model still counts as that model.
    const storedAlias = createModelSelection(codex, "gpt-5-codex", stored.options);
    expect(optionsFor({ [claude]: claudePick }, storedAlias)?.[codex]).toEqual(stored.options);
    const storedOtherModel = createModelSelection(codex, "gpt-5.4", stored.options);
    expect(
      optionsFor(
        { [claude]: claudePick, [codex]: createModelSelection(codex, "gpt-5.5") },
        storedOtherModel,
      )?.[codex],
    ).toBeUndefined();
  });

  it("keeps the default instance's draft model off a custom instance of the same driver", () => {
    const driver = ProviderDriverKind.make("opencode");
    const defaultInstanceId = ProviderInstanceId.make("opencode");
    const kimiInstanceId = ProviderInstanceId.make("kimi_api");
    const kimiModel = "kimi-code-plan-global/k3.1-pro";
    const providers = [
      provider({
        provider: driver,
        instanceId: defaultInstanceId,
        models: ["opencode-go/kimi-k3.1-pro"],
      }),
      provider({ provider: driver, instanceId: kimiInstanceId, models: [kimiModel] }),
    ];
    const state = deriveEffectiveComposerModelState({
      threadStarted: false,
      draft: {
        activeProvider: kimiInstanceId,
        modelSelectionByProvider: {
          [defaultInstanceId]: createModelSelection(defaultInstanceId, "opencode-go/kimi-k3.1-pro"),
        },
      },
      providers,
      selectedProvider: driver,
      selectedInstanceId: kimiInstanceId,
      threadModelSelection: null,
      projectModelSelection: null,
      settings: DEFAULT_UNIFIED_SETTINGS,
    });

    expect(state.selectedModel).toBe(kimiModel);
  });

  it("self-heals a persisted selection pointing at a text-generation-incapable instance", () => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make("acpRegistry"),
        instanceId: "acp_gemini",
        models: ["default"],
        supportsTextGeneration: false,
      }),
      provider({
        instanceId: "codex",
        models: ["gpt-5.6-luna"],
      }),
    ];
    const settings: UnifiedSettings = {
      ...settingsWithProviderInstances(),
      textGenerationModelSelection: {
        instanceId: ProviderInstanceId.make("acp_gemini"),
        model: "default",
      },
    };

    expect(resolveAppModelSelectionState(settings, providers).instanceId).toBe(
      ProviderInstanceId.make("codex"),
    );
  });
  it("falls back to the text generation default, not the chat default, for a removed model", () => {
    const codex = provider({ instanceId: "codex", models: ["gpt-6-astra", "gpt-6-luna"] });
    const providers = [
      { ...codex, models: codex.models.map((m, i) => (i === 0 ? { ...m, isDefault: true } : m)) },
    ];
    const settings: UnifiedSettings = {
      ...settingsWithProviderInstances(),
      textGenerationModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.6-luna",
      ),
    };

    expect(resolveAppModelSelectionState(settings, providers).model).toBe(
      DEFAULT_TEXT_GENERATION_MODEL,
    );
  });

  it("does not select a provider that cannot generate system text", () => {
    const instanceId = ProviderInstanceId.make("antigravity");
    const unsupported = {
      ...provider({
        provider: ProviderDriverKind.make("antigravity"),
        instanceId,
        models: ["gemini-3.1-pro"],
      }),
      supportsTextGeneration: false,
    };
    const supported = provider({ instanceId: "codex", models: ["gpt-5.6-sol"] });
    const settings = {
      ...settingsWithProviderInstances(),
      textGenerationModelSelection: createModelSelection(instanceId, "gemini-3.1-pro"),
    };

    expect(resolveAppModelSelectionState(settings, [unsupported, supported])).toEqual(
      createModelSelection(supported.instanceId, "gpt-5.6-sol"),
    );
    expect(resolveAppModelSelectionState(settings, [unsupported])).toEqual(
      NO_PROVIDER_MODEL_SELECTION,
    );
  });

  it("excludes customized extension models while preserving unknown custom and thread models", () => {
    const pi = provider({
      provider: ProviderDriverKind.make("pi"),
      instanceId: "pi",
      models: ["default", "demo/demo-model"],
    });
    const providers = [
      {
        ...pi,
        models: pi.models.map((model) =>
          model.slug === "demo/demo-model" ? { ...model, supportsTextGeneration: false } : model,
        ),
      },
    ];
    const settings: UnifiedSettings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [pi.instanceId]: {
          driver: ProviderDriverKind.make("pi"),
          config: {
            customModels: [
              { slug: "demo/demo-model", name: "My extension model" },
              { slug: "unknown/model", name: "My custom model" },
            ],
          },
        },
      },
      textGenerationModelSelection: createModelSelection(pi.instanceId, "demo/demo-model"),
    };
    const supported = providers.filter((provider) => provider.supportsTextGeneration !== false);
    expect(
      getTextGenerationModelOptionsByInstance(settings, supported, pi.instanceId, "demo/demo-model")
        .get(pi.instanceId)
        ?.map((option) => option.slug),
    ).toEqual(["default", "unknown/model"]);
    expect(resolveAppModelSelectionState(settings, supported)).toEqual(
      createModelSelection(pi.instanceId, "default"),
    );
    expect(
      resolveAppModelSelectionState(
        {
          ...settings,
          textGenerationModelSelection: createModelSelection(pi.instanceId, "unknown/model"),
        },
        supported,
      ).model,
    ).toBe("unknown/model");
    expect(
      getCustomModelOptionsByInstance(settings, providers)
        .get(pi.instanceId)
        ?.map((option) => option.slug),
    ).toEqual(["default", "demo/demo-model", "unknown/model"]);
  });
});

describe("resolveAppModelSelectionState with the opencode plan agent", () => {
  const instanceId = ProviderInstanceId.make("opencode");
  const model = "opencode/gpt-5.4";
  const opencode: ServerProvider = {
    ...provider({ provider: ProviderDriverKind.make("opencode"), instanceId: "opencode" }),
    models: [
      {
        slug: model,
        name: model,
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            {
              id: "agent",
              label: "Agent",
              type: "select",
              options: [
                { id: "build", label: "Build", isDefault: true },
                { id: "plan", label: "Plan" },
              ],
              currentValue: "build",
            },
          ],
        },
      },
    ],
  };
  const settings: UnifiedSettings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    textGenerationModelSelection: createModelSelection(instanceId, model, [
      { id: "agent", value: "plan" },
    ]),
  };

  it("keeps a stored plan agent this device did not pick", () => {
    expect(resolveAppModelSelectionState(settings, [opencode])).toEqual(
      createModelSelection(instanceId, model, [{ id: "agent", value: "plan" }]),
    );
  });
});

describe("default model settings and new-thread composer parity", () => {
  it.each([
    ["hidden", "claudeAgent", "claude-opus-5", "claude-opus-5-5", "medium"],
    ["visible", "claudeAgent", "claude-opus-5", "claude-opus-5", "max"],
    ["unavailable", "opencode", "openrouter/kimi-k3", "openrouter/kimi-k3", null],
  ] as const)(
    "resolves the %s default and its traits",
    (visibility, kind, model, expectedModel, effort) => {
      const driver = ProviderDriverKind.make(kind);
      const instanceId = ProviderInstanceId.make(`${kind}_work`);
      const snapshot = provider({ provider: driver, instanceId });
      const models: ServerProvider["models"] = ["claude-opus-5-5", "claude-opus-5"].map(
        (slug, index) => ({
          slug,
          name: slug,
          isCustom: false,
          capabilities: {
            optionDescriptors: [
              {
                id: "effort",
                label: "Effort",
                type: "select",
                options: (index === 0 ? ["medium", "high"] : ["high", "max"]).map(
                  (id, optionIndex) => ({ id, label: id, isDefault: optionIndex === 0 }),
                ),
              },
            ],
          },
        }),
      );
      const providers = [{ ...snapshot, models }];
      const stored = createModelSelection(instanceId, model, [{ id: "effort", value: "max" }]);
      const settings: UnifiedSettings = {
        ...settingsWithProviderInstances(),
        providerModelPreferences: {
          [instanceId]: { hiddenModels: visibility === "hidden" ? [model] : [], modelOrder: [] },
        },
      };
      // ChatView builds the local draft with the project default as its thread selection.
      const composer = deriveEffectiveComposerModelState({
        threadStarted: false,
        draft: null,
        providers,
        selectedProvider: driver,
        selectedInstanceId: instanceId,
        threadModelSelection: stored,
        projectModelSelection: stored,
        settings,
      });
      const effective = resolveEffectiveDefaultModelSelection(settings, providers, stored);
      const traits = (model: string, modelOptions: typeof stored.options) =>
        getComposerProviderState({
          provider: driver,
          model,
          models,
          modelOptions,
        });
      const composerTraits = traits(composer.selectedModel, composer.modelOptions?.[instanceId]);

      expect(composer.selectedModel).toBe(expectedModel);
      expect(traits(effective.model, effective.options)).toEqual(composerTraits);
      expect(effective).toEqual({ ...stored, model: composer.selectedModel });
      expect(composerTraits.promptEffort).toBe(effort);
    },
  );
});

describe("composer fallback to another instance of the same driver", () => {
  const claude = ProviderDriverKind.make("claudeAgent");
  const codex = ProviderDriverKind.make("codex");
  const disabled = ProviderInstanceId.make("claudeAgent");
  const fallback = ProviderInstanceId.make("claude_team");
  const effortModels: ServerProvider["models"] = [
    {
      slug: "claude-opus-5-5",
      name: "Claude Opus 5.5",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Effort",
            type: "select",
            options: ["medium", "high", "xhigh"].map((id) => ({
              id,
              label: id,
              isDefault: id === "medium",
            })),
          },
        ],
      },
    },
  ];
  const providers: ReadonlyArray<ServerProvider> = [
    {
      ...provider({ provider: claude, instanceId: disabled }),
      enabled: false,
      models: effortModels,
    },
    { ...provider({ provider: claude, instanceId: fallback }), models: effortModels },
  ];
  const picked = createModelSelection(disabled, "claude-opus-5-5", [
    { id: "effort", value: "xhigh" },
  ]);

  // The same steps useComposerProviderModel takes, without the draft store.
  function composerFor(input: {
    readonly providers: ReadonlyArray<ServerProvider>;
    readonly draft?: Parameters<typeof deriveEffectiveComposerModelState>[0]["draft"];
    readonly threadModelSelection: ReturnType<typeof createModelSelection>;
    readonly customModels?: Partial<Record<string, ReadonlyArray<string>>>;
  }) {
    const settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: Object.fromEntries(
        input.providers.map((provider) => [
          provider.instanceId,
          {
            driver: provider.driver,
            enabled: provider.enabled,
            config: {
              customModels: (input.customModels?.[provider.instanceId] ?? []).map((slug) => ({
                slug,
                name: slug,
                capabilities: null,
              })),
            },
          },
        ]),
      ),
    };
    const selection = resolveComposerProviderSelection({
      entries: providerInstanceEntriesFor(input.providers, settings, null),
      candidateInstanceIds: [input.threadModelSelection.instanceId],
      lockedProvider: null,
      lockedInstanceId: undefined,
    });
    const selectedInstanceId = selection.selectedProviderEntry!.instanceId;
    const selectedProvider = selection.selectedProviderEntry!.driverKind;
    const state = deriveEffectiveComposerModelState({
      threadStarted: false,
      draft: input.draft ?? null,
      providers: input.providers,
      selectedProvider,
      selectedInstanceId,
      requestedInstanceId: selection.requestedInstanceId,
      threadModelSelection: input.threadModelSelection,
      projectModelSelection: null,
      settings,
    });
    const traits = getComposerProviderState({
      provider: selectedProvider,
      model: state.selectedModel,
      models: selection.selectedProviderEntry!.models,
      modelOptions: state.modelOptions?.[selectedInstanceId],
    });
    return { selectedInstanceId, state, traits };
  }

  it("keeps the requested instance's effort on the fallback instance", () => {
    const { selectedInstanceId, state, traits } = composerFor({
      providers,
      threadModelSelection: picked,
    });

    expect(selectedInstanceId).toBe(fallback);
    expect(state.selectedModel).toBe("claude-opus-5-5");
    expect(traits.promptEffort).toBe("xhigh");
    expect(
      createModelSelection(fallback, state.selectedModel, traits.modelOptionsForDispatch),
    ).toEqual(
      createModelSelection(fallback, "claude-opus-5-5", [{ id: "effort", value: "xhigh" }]),
    );
  });

  it("keeps options the fallback instance already has", () => {
    const { traits } = composerFor({
      providers,
      threadModelSelection: picked,
      draft: {
        activeProvider: disabled,
        modelSelectionByProvider: {
          [disabled]: picked,
          [fallback]: createModelSelection(fallback, "claude-opus-5-5", [
            { id: "effort", value: "high" },
          ]),
        },
      },
    });

    expect(traits.promptEffort).toBe("high");
  });

  it("does not carry options picked with another model", () => {
    // An optionless draft pick takes its options from the thread, which holds another model.
    const { state, traits } = composerFor({
      providers,
      threadModelSelection: createModelSelection(disabled, "claude-sonnet-4-6", [
        { id: "effort", value: "high" },
      ]),
      draft: {
        activeProvider: disabled,
        modelSelectionByProvider: { [disabled]: createModelSelection(disabled, "claude-opus-5-5") },
      },
    });

    expect(state.selectedModel).toBe("claude-opus-5-5");
    expect(traits.promptEffort).toBe("medium");
    expect(traits.modelOptionsForDispatch).toBeUndefined();
  });

  describe("with model aliases", () => {
    const reasoningModel = (
      slug: string,
      id: string,
      extra: Partial<ServerProvider["models"][number]> = {},
    ): ServerProvider["models"][number] => ({
      slug,
      name: slug,
      isCustom: false,
      ...extra,
      capabilities: {
        optionDescriptors: [
          {
            id,
            label: id,
            type: "select",
            options: ["medium", "high", "xhigh"].map((value) => ({
              id: value,
              label: value,
              isDefault: value === "medium",
            })),
          },
        ],
      },
    });

    it.each([
      ["5.4", "gpt-5.4"],
      ["gpt-5-codex", "gpt-5.4"],
      ["gpt-5.4", "5.4"],
    ])("keeps the effort from %s on fallback %s", (savedModel, fallbackModel) => {
      const disabledCodex = ProviderInstanceId.make("codex");
      const fallbackCodex = ProviderInstanceId.make("codex_team");
      const models = [reasoningModel(fallbackModel, "reasoningEffort")];
      const { selectedInstanceId, state, traits } = composerFor({
        providers: [
          { ...provider({ provider: codex, instanceId: disabledCodex }), enabled: false, models },
          { ...provider({ provider: codex, instanceId: fallbackCodex }), models },
        ],
        threadModelSelection: createModelSelection(disabledCodex, savedModel, [
          { id: "reasoningEffort", value: "xhigh" },
        ]),
      });

      expect(selectedInstanceId).toBe(fallbackCodex);
      expect(state.selectedModel).toBe(fallbackModel);
      expect(traits.promptEffort).toBe("xhigh");
    });

    it.each([
      {
        // A disabled Codex instance reports only its custom models.
        state: "disabled",
        requested: {
          enabled: false,
          models: [reasoningModel("5.4", "reasoningEffort", { isCustom: true })],
        },
      },
      {
        // An unavailable instance reports no models; its custom models are only in settings.
        state: "unavailable",
        requested: { enabled: false, availability: "unavailable" as const, models: [] },
      },
    ])(
      "does not alias-expand a custom model named 5.4 when the requested instance is $state",
      ({ requested }) => {
        const disabledCodex = ProviderInstanceId.make("codex");
        const { state, traits } = composerFor({
          providers: [
            { ...provider({ provider: codex, instanceId: disabledCodex }), ...requested },
            {
              ...provider({ provider: codex, instanceId: "codex_team" }),
              models: [reasoningModel("gpt-5.4", "reasoningEffort")],
            },
          ],
          customModels: { [disabledCodex]: ["5.4"] },
          threadModelSelection: createModelSelection(disabledCodex, "5.4", [
            { id: "reasoningEffort", value: "xhigh" },
          ]),
        });

        expect(state.selectedModel).toBe("gpt-5.4");
        expect(traits.modelOptionsForDispatch).toBeUndefined();
      },
    );

    it("does not alias-expand the fallback instance's custom model", () => {
      const { state, traits } = composerFor({
        providers: [
          { ...provider({ provider: codex, instanceId: "codex" }), enabled: false },
          {
            ...provider({ provider: codex, instanceId: "codex_team" }),
            models: [reasoningModel("5.4", "reasoningEffort", { isCustom: true })],
          },
        ],
        customModels: { codex_team: ["5.4"] },
        threadModelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
          { id: "reasoningEffort", value: "xhigh" },
        ]),
      });

      expect(state.selectedModel).toBe("5.4");
      expect(traits.modelOptionsForDispatch).toBeUndefined();
    });

    it("does not carry options through an alias that names another model per instance", () => {
      // "antigravity-default" is each Antigravity instance's current model.
      const antigravity = ProviderDriverKind.make("antigravity");
      const disabledAntigravity = ProviderInstanceId.make("antigravity");
      const current = { isDefault: true, aliases: [ANTIGRAVITY_DEFAULT_MODEL] };
      const { state, traits } = composerFor({
        providers: [
          {
            ...provider({ provider: antigravity, instanceId: disabledAntigravity }),
            enabled: false,
            models: [reasoningModel("gemini-3-pro", "thinking", current)],
          },
          {
            ...provider({ provider: antigravity, instanceId: "antigravity_work" }),
            models: [reasoningModel("claude-sonnet-4-6", "thinking", current)],
          },
        ],
        threadModelSelection: createModelSelection(disabledAntigravity, ANTIGRAVITY_DEFAULT_MODEL, [
          { id: "thinking", value: "high" },
        ]),
      });

      expect(state.selectedModel).toBe("claude-sonnet-4-6");
      expect(traits.modelOptionsForDispatch).toBeUndefined();
    });
  });

  it("does not carry options to another driver", () => {
    const codexOnly: ReadonlyArray<ServerProvider> = [
      {
        ...provider({ provider: claude, instanceId: disabled }),
        enabled: false,
        models: effortModels,
      },
      provider({ provider: codex, instanceId: "codex", models: ["gpt-6-astra"] }),
    ];
    const { selectedInstanceId, state } = composerFor({
      providers: codexOnly,
      threadModelSelection: picked,
    });

    expect(selectedInstanceId).toBe(ProviderInstanceId.make("codex"));
    expect(state.modelOptions?.[selectedInstanceId]).toBeUndefined();
  });
});

describe("text generation provider eligibility, AGY waiver gating, and multi-agent coverage", () => {
  const agy = provider({
    provider: ProviderDriverKind.make("antigravity"),
    instanceId: "antigravity",
    models: ["gemini-4-neon"],
    supportsTextGeneration: true,
  });
  const dsh = provider({
    provider: ProviderDriverKind.make("acpRegistry"),
    instanceId: "dsh",
    models: ["deepseek-v4.1-flash", "deepseek-v4-pro"],
    supportsTextGeneration: true,
  });
  const opencode = provider({
    provider: ProviderDriverKind.make("opencode"),
    instanceId: "opencode",
    models: ["opencode/big-pickle"],
    supportsTextGeneration: true,
  });
  const pi = provider({
    provider: ProviderDriverKind.make("pi"),
    instanceId: "pi",
    models: ["default"],
    supportsTextGeneration: true,
  });
  const codex = provider({
    provider: ProviderDriverKind.make("codex"),
    instanceId: "codex",
    models: ["gpt-6.2-astra", "gpt-6-luna"],
    supportsTextGeneration: true,
  });
  const claude = provider({
    provider: ProviderDriverKind.make("claudeAgent"),
    instanceId: "claudeAgent",
    models: ["claude-haiku-5-5"],
    supportsTextGeneration: true,
  });
  const allEnabled = [agy, dsh, opencode, pi, codex, claude];

  it("excludes antigravity by default until waiver is signed while keeping DSH and all other enabled agents", () => {
    const unsignedProviders = resolveTextGenerationProviders(allEnabled);
    expect(unsignedProviders.map((entry) => entry.instanceId)).toEqual([
      dsh.instanceId,
      opencode.instanceId,
      pi.instanceId,
      codex.instanceId,
      claude.instanceId,
    ]);

    const optionsByInstance = getTextGenerationModelOptionsByInstance(
      DEFAULT_UNIFIED_SETTINGS,
      allEnabled,
      null,
      null,
      { allowAntigravityTextGeneration: false },
    );
    expect(optionsByInstance.has(agy.instanceId)).toBe(false);
    expect(optionsByInstance.get(dsh.instanceId)?.map((model) => model.slug)).toEqual([
      "deepseek-v4.1-flash",
      "deepseek-v4-pro",
    ]);
    expect(optionsByInstance.get(opencode.instanceId)?.map((model) => model.slug)).toEqual([
      "opencode/big-pickle",
    ]);
    expect(optionsByInstance.get(pi.instanceId)?.map((model) => model.slug)).toEqual(["default"]);
    expect(optionsByInstance.has(codex.instanceId)).toBe(true);
    expect(optionsByInstance.has(claude.instanceId)).toBe(true);
  });

  it("gracefully falls back from a previously selected AGY text-gen model when waiver is unsigned, and restores AGY when signed", () => {
    const agySelectedSettings: UnifiedSettings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerOrder: [],
      textGenerationModelSelection: createModelSelection(agy.instanceId, "gemini-4-neon"),
    };

    const unsignedResolved = resolveAppModelSelectionState(agySelectedSettings, allEnabled, {
      allowAntigravityTextGeneration: false,
    });
    expect(unsignedResolved.instanceId).toBe(dsh.instanceId);
    expect(unsignedResolved.model).toBe("deepseek-v4.1-flash");

    // When only AGY exists and waiver is unsigned, falls back safely to NO_PROVIDER_MODEL_SELECTION without crashing.
    expect(
      resolveAppModelSelectionState(agySelectedSettings, [agy], {
        allowAntigravityTextGeneration: false,
      }),
    ).toEqual(NO_PROVIDER_MODEL_SELECTION);

    // Once waiver is signed & allowAntigravityAsControlledAgent is enabled, AGY is included and selectable.
    const signedProviders = resolveTextGenerationProviders(allEnabled, {
      allowAntigravityTextGeneration: true,
    });
    expect(signedProviders.map((entry) => entry.instanceId)).toContain(agy.instanceId);
    const signedResolved = resolveAppModelSelectionState(agySelectedSettings, allEnabled, {
      allowAntigravityTextGeneration: true,
    });
    expect(signedResolved.instanceId).toBe(agy.instanceId);
    expect(signedResolved.model).toBe("gemini-4-neon");
  });

  it("selects DSH / ACP Registry cleanly as a text generation provider", () => {
    const dshSelected: UnifiedSettings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      textGenerationModelSelection: createModelSelection(dsh.instanceId, "deepseek-v4.1-flash"),
    };
    expect(resolveAppModelSelectionState(dshSelected, allEnabled)).toEqual(
      createModelSelection(dsh.instanceId, "deepseek-v4.1-flash"),
    );
  });
});

describe("defaultReasoningEffort resolution and clamping across providers", () => {
  const codexProvider: ServerProvider = {
    ...provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex" }),
    models: [
      {
        slug: "gpt-6.2-astra",
        name: "GPT 6.2 Astra",
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            {
              id: "reasoningEffort",
              label: "Reasoning effort",
              type: "select",
              role: "reasoning",
              options: ["minimal", "low", "medium", "high", "xhigh"].map((id) => ({
                id,
                label: id,
                isDefault: id === "medium",
              })),
            },
          ],
        },
      },
    ],
  };

  const dshProvider: ServerProvider = {
    ...provider({ provider: ProviderDriverKind.make("acpRegistry"), instanceId: "dsh" }),
    models: [
      {
        slug: "deepseek-v4.1-flash",
        name: "DeepSeek-V4.1-Flash",
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            {
              id: "reasoning_effort",
              label: "Reasoning effort",
              type: "select",
              role: "reasoning",
              currentValue: "_t3/empty",
              options: [
                { id: "_t3/empty", label: "Provider default" },
                { id: "low", label: "Low" },
                { id: "high", label: "High" },
                { id: "max", label: "Max" },
              ],
            },
          ],
        },
      },
    ],
  };

  const agyProvider: ServerProvider = {
    ...provider({ provider: ProviderDriverKind.make("antigravity"), instanceId: "antigravity" }),
    models: [
      {
        slug: "gemini-4-neon",
        name: "Gemini 4 Neon",
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            {
              id: "thought_level",
              label: "Thinking",
              type: "select",
              role: "reasoning",
              options: [
                { id: "off", label: "Off" },
                { id: "low", label: "Low" },
                { id: "medium", label: "Medium", isDefault: true },
                { id: "high", label: "High" },
              ],
            },
          ],
        },
      },
    ],
  };

  const claudeTwoTierProvider: ServerProvider = {
    ...provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: "claudeAgent" }),
    models: [
      {
        slug: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            {
              id: "effort",
              label: "Effort",
              type: "select",
              options: [
                { id: "medium", label: "Medium", isDefault: true },
                { id: "high", label: "High" },
              ],
            },
          ],
        },
      },
    ],
  };

  const providers = [codexProvider, dshProvider, agyProvider, claudeTwoTierProvider];

  it("maps defaultReasoningEffort cleanly to each provider's closest supported concrete level", () => {
    // Codex: exact match for low/medium/high, clamps max -> xhigh
    expect(
      resolveClosestReasoningEffortOption(codexProvider.models[0]!.capabilities, "high"),
    ).toEqual({
      id: "reasoningEffort",
      value: "high",
    });
    expect(
      resolveClosestReasoningEffortOption(codexProvider.models[0]!.capabilities, "max"),
    ).toEqual({
      id: "reasoningEffort",
      value: "xhigh",
    });

    // DSH: strips phantom _t3/empty, maps medium -> high, high -> high, max -> max
    expect(
      resolveClosestReasoningEffortOption(dshProvider.models[0]!.capabilities, "medium"),
    ).toEqual({
      id: "reasoning_effort",
      value: "high",
    });
    expect(
      resolveClosestReasoningEffortOption(dshProvider.models[0]!.capabilities, "high"),
    ).toEqual({
      id: "reasoning_effort",
      value: "high",
    });
    expect(resolveClosestReasoningEffortOption(dshProvider.models[0]!.capabilities, "max")).toEqual(
      {
        id: "reasoning_effort",
        value: "max",
      },
    );

    // Antigravity: clamps max -> high, keeps low -> low (never turns off)
    expect(resolveClosestReasoningEffortOption(agyProvider.models[0]!.capabilities, "max")).toEqual(
      {
        id: "thought_level",
        value: "high",
      },
    );
    expect(resolveClosestReasoningEffortOption(agyProvider.models[0]!.capabilities, "low")).toEqual(
      {
        id: "thought_level",
        value: "low",
      },
    );

    // Two-tier Claude: clamps low -> medium and max -> high
    expect(
      resolveClosestReasoningEffortOption(claudeTwoTierProvider.models[0]!.capabilities, "low"),
    ).toEqual({ id: "effort", value: "medium" });
    expect(
      resolveClosestReasoningEffortOption(claudeTwoTierProvider.models[0]!.capabilities, "max"),
    ).toEqual({ id: "effort", value: "high" });
  });

  it("applies settings.defaultReasoningEffort (default high) when no explicit per-model override exists and preserves explicit overrides", () => {
    const bareCodex = createModelSelection(ProviderInstanceId.make("codex"), "gpt-6.2-astra");
    expect(
      resolveEffectiveDefaultModelSelection(DEFAULT_UNIFIED_SETTINGS, providers, bareCodex),
    ).toEqual(
      createModelSelection(ProviderInstanceId.make("codex"), "gpt-6.2-astra", [
        { id: "reasoningEffort", value: "high" },
      ]),
    );

    const maxSettings: UnifiedSettings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      defaultReasoningEffort: "max",
    };
    expect(resolveEffectiveDefaultModelSelection(maxSettings, providers, bareCodex)).toEqual(
      createModelSelection(ProviderInstanceId.make("codex"), "gpt-6.2-astra", [
        { id: "reasoningEffort", value: "xhigh" },
      ]),
    );

    // Explicit per-model effort override always wins over defaultReasoningEffort.
    const explicitLow = createModelSelection(ProviderInstanceId.make("codex"), "gpt-6.2-astra", [
      { id: "reasoningEffort", value: "low" },
    ]);
    expect(resolveEffectiveDefaultModelSelection(maxSettings, providers, explicitLow)).toEqual(
      explicitLow,
    );

    // Phantom sentinel on DSH is replaced by configured defaultReasoningEffort ("high").
    const phantomDsh = createModelSelection(ProviderInstanceId.make("dsh"), "deepseek-v4.1-flash", [
      { id: "reasoning_effort", value: "_t3/empty" },
    ]);
    expect(applyDefaultReasoningEffortToSelection(phantomDsh, providers, "high")).toEqual(
      createModelSelection(ProviderInstanceId.make("dsh"), "deepseek-v4.1-flash", [
        { id: "reasoning_effort", value: "high" },
      ]),
    );
  });

  it("maps boolean thinking models and strips reasoning options while preserving non-reasoning options", () => {
    const booleanProvider: ServerProvider = {
      ...provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: "claude_bool" }),
      models: [
        {
          slug: "claude-sonnet-bool",
          name: "Claude Sonnet Bool",
          isCustom: false,
          capabilities: {
            optionDescriptors: [
              { id: "thinking", label: "Thinking", type: "boolean", currentValue: false },
              { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: false },
            ],
          },
        },
      ],
    };

    expect(
      resolveClosestReasoningEffortOption(booleanProvider.models[0]!.capabilities, "low"),
    ).toEqual({ id: "thinking", value: false });
    expect(
      resolveClosestReasoningEffortOption(booleanProvider.models[0]!.capabilities, "high"),
    ).toEqual({ id: "thinking", value: true });
    expect(
      resolveClosestReasoningEffortOption(booleanProvider.models[0]!.capabilities, "max"),
    ).toEqual({ id: "thinking", value: true });

    expect(
      stripReasoningEffortOptions([
        { id: "reasoningEffort", value: "low" },
        { id: "serviceTier", value: "fast" },
      ]),
    ).toEqual([{ id: "serviceTier", value: "fast" }]);

    const selectionWithCustomReasoning = createModelSelection(
      ProviderInstanceId.make("claude_bool"),
      "claude-sonnet-bool",
      [
        { id: "thinking", value: true },
        { id: "fastMode", value: true },
      ],
    );
    expect(
      stripReasoningEffortFromSelection(selectionWithCustomReasoning, [booleanProvider]),
    ).toEqual(
      createModelSelection(ProviderInstanceId.make("claude_bool"), "claude-sonnet-bool", [
        { id: "fastMode", value: true },
      ]),
    );
  });

  it("applies defaultReasoningEffort to new drafts across providers, async provider hydration, and preserves manual/existing thread effort", () => {
    const codexId = ProviderInstanceId.make("codex");
    const claudeId = ProviderInstanceId.make("claudeAgent");
    const agyId = ProviderInstanceId.make("antigravity");
    const maxSettings: UnifiedSettings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      defaultReasoningEffort: "max",
    };
    const lowSettings: UnifiedSettings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      defaultReasoningEffort: "low",
    };

    // 1. Before providers hydrate (providers = []), draft gracefully returns no options without crashing.
    const beforeHydration = deriveEffectiveComposerModelState({
      draft: null,
      threadStarted: false,
      providers: [],
      selectedProvider: ProviderDriverKind.make("codex"),
      selectedInstanceId: codexId,
      threadModelSelection: null,
      projectModelSelection: null,
      settings: maxSettings,
      applyDefaultReasoningEffort: true,
    });
    expect(beforeHydration.modelOptions).toBeNull();

    // 2. After providers hydrate, blank draft immediately resolves defaultReasoningEffort ("max" -> Codex "xhigh").
    const afterHydration = deriveEffectiveComposerModelState({
      draft: null,
      threadStarted: false,
      providers,
      selectedProvider: ProviderDriverKind.make("codex"),
      selectedInstanceId: codexId,
      threadModelSelection: null,
      projectModelSelection: null,
      settings: maxSettings,
      applyDefaultReasoningEffort: true,
    });
    expect(afterHydration.modelOptions?.[codexId]).toEqual([
      { id: "reasoningEffort", value: "xhigh" },
    ]);
    const codexDispatch = getComposerProviderState({
      provider: ProviderDriverKind.make("codex"),
      model: afterHydration.selectedModel,
      models: codexProvider.models,
      modelOptions: afterHydration.modelOptions?.[codexId],
    });
    expect(codexDispatch.promptEffort).toBe("xhigh");
    expect(codexDispatch.modelOptionsForDispatch).toEqual([
      { id: "reasoningEffort", value: "xhigh" },
    ]);

    // 3. Changing settings.defaultReasoningEffort immediately reflects on an untouched draft and across providers.
    const lowDraftCodex = deriveEffectiveComposerModelState({
      draft: null,
      threadStarted: false,
      providers,
      selectedProvider: ProviderDriverKind.make("codex"),
      selectedInstanceId: codexId,
      threadModelSelection: null,
      projectModelSelection: null,
      settings: lowSettings,
      applyDefaultReasoningEffort: true,
    });
    expect(lowDraftCodex.modelOptions?.[codexId]).toEqual([
      { id: "reasoningEffort", value: "low" },
    ]);

    const maxDraftClaude = deriveEffectiveComposerModelState({
      draft: null,
      threadStarted: false,
      providers,
      selectedProvider: ProviderDriverKind.make("claudeAgent"),
      selectedInstanceId: claudeId,
      threadModelSelection: null,
      projectModelSelection: null,
      settings: maxSettings,
      applyDefaultReasoningEffort: true,
    });
    expect(maxDraftClaude.modelOptions?.[claudeId]).toEqual([{ id: "effort", value: "high" }]);

    const maxDraftAgy = deriveEffectiveComposerModelState({
      draft: null,
      threadStarted: false,
      providers,
      selectedProvider: ProviderDriverKind.make("antigravity"),
      selectedInstanceId: agyId,
      threadModelSelection: null,
      projectModelSelection: null,
      settings: maxSettings,
      applyDefaultReasoningEffort: true,
    });
    expect(maxDraftAgy.modelOptions?.[agyId]).toEqual([{ id: "thought_level", value: "high" }]);

    // 4. Explicit project-level defaultReasoningEffort argument overrides global settings.defaultReasoningEffort.
    const projectLowDraft = deriveEffectiveComposerModelState({
      draft: null,
      threadStarted: false,
      providers,
      selectedProvider: ProviderDriverKind.make("codex"),
      selectedInstanceId: codexId,
      threadModelSelection: null,
      projectModelSelection: null,
      settings: maxSettings,
      applyDefaultReasoningEffort: true,
      defaultReasoningEffort: "low",
    });
    expect(projectLowDraft.modelOptions?.[codexId]).toEqual([
      { id: "reasoningEffort", value: "low" },
    ]);

    // 5. Manual user override in the draft is never clobbered by defaultReasoningEffort.
    const manualDraft = deriveEffectiveComposerModelState({
      draft: {
        activeProvider: codexId,
        modelSelectionExplicit: true,
        modelSelectionByProvider: {
          [codexId]: createModelSelection(codexId, "gpt-6.2-astra", [
            { id: "reasoningEffort", value: "low" },
          ]),
        },
      },
      threadStarted: false,
      providers,
      selectedProvider: ProviderDriverKind.make("codex"),
      selectedInstanceId: codexId,
      threadModelSelection: null,
      projectModelSelection: null,
      settings: maxSettings,
      applyDefaultReasoningEffort: true,
    });
    expect(manualDraft.modelOptions?.[codexId]).toEqual([{ id: "reasoningEffort", value: "low" }]);

    // 6. Existing started threads are NEVER overwritten by defaultReasoningEffort.
    const existingStartedThread = deriveEffectiveComposerModelState({
      draft: null,
      threadStarted: true,
      providers,
      selectedProvider: ProviderDriverKind.make("codex"),
      selectedInstanceId: codexId,
      threadModelSelection: createModelSelection(codexId, "gpt-6.2-astra", [
        { id: "reasoningEffort", value: "low" },
      ]),
      projectModelSelection: null,
      settings: maxSettings,
      applyDefaultReasoningEffort: true,
    });
    expect(existingStartedThread.modelOptions?.[codexId]).toEqual([
      { id: "reasoningEffort", value: "low" },
    ]);

    // 7. Project defaultReasoningEffort override strips inherited environment reasoning effort.
    const envSelectionWithLow = createModelSelection(codexId, "gpt-6.2-astra", [
      { id: "reasoningEffort", value: "low" },
      { id: "serviceTier", value: "fast" },
    ]);
    expect(
      resolveProjectDefaultModelSelectionForDraft(
        {
          settings: {
            defaultModelSelection: envSelectionWithLow,
          },
          sources: {
            defaultModelSelection: "environment",
            defaultReasoningEffort: "project",
          },
        },
        providers,
      ),
    ).toEqual(
      createModelSelection(codexId, "gpt-6.2-astra", [{ id: "serviceTier", value: "fast" }]),
    );
  });

  it("displays full canonical model names on ProviderModelPicker when displayFullModelName is enabled", () => {
    const samples = [
      {
        driverKind: ProviderDriverKind.make("antigravity"),
        model: { slug: "gemini-4-neon", name: "Gemini 4 Neon", shortName: "4 Neon" },
        shortTitle: "4 Neon",
        fullTitle: "Gemini 4 Neon",
      },
      {
        driverKind: ProviderDriverKind.make("codex"),
        model: { slug: "gpt-6.2-astra", name: "GPT 6.2 Astra", shortName: "6.2 Astra" },
        shortTitle: "6.2 Astra",
        fullTitle: "GPT 6.2 Astra",
      },
      {
        driverKind: ProviderDriverKind.make("claudeAgent"),
        model: { slug: "claude-opus-5-5", name: "Claude Opus 5.5", shortName: "Opus 5.5" },
        shortTitle: "Opus 5.5",
        fullTitle: "Claude Opus 5.5",
      },
      {
        driverKind: ProviderDriverKind.make("acpRegistry"),
        model: { slug: "deepseek-v4.1-flash", name: "DeepSeek-V4.1-Flash" },
        shortTitle: "DeepSeek V4.1 Flash",
        fullTitle: "DeepSeek-V4.1-Flash",
      },
    ];

    for (const sample of samples) {
      expect(
        resolveModelPickerTriggerTitle({
          selectedModel: sample.model,
          driverKind: sample.driverKind,
          model: sample.model.slug,
          displayFullModelName: true,
          chooseModelLabel: "Choose model",
        }),
      ).toBe(sample.fullTitle);
      expect(
        resolveModelPickerTriggerTitle({
          selectedModel: sample.model,
          driverKind: sample.driverKind,
          model: sample.model.slug,
          displayFullModelName: false,
          chooseModelLabel: "Choose model",
        }),
      ).toBe(sample.shortTitle);
    }
  });

  it("orders custom & text-generation model maps and fallback selection by settings.providerOrder", () => {
    const codexId = ProviderInstanceId.make("codex");
    const claudeId = ProviderInstanceId.make("claudeAgent");
    const dshId = ProviderInstanceId.make("acpRegistry_dsh");
    const providers: ServerProvider[] = [
      provider({
        instanceId: codexId,
        provider: ProviderDriverKind.make("codex"),
        models: ["gpt-5.4"],
      }),
      provider({
        instanceId: claudeId,
        provider: ProviderDriverKind.make("claudeAgent"),
        models: ["claude-sonnet-4-6"],
      }),
      provider({
        instanceId: dshId,
        provider: ProviderDriverKind.make("acpRegistry"),
        models: ["deepseek-chat"],
      }),
    ];
    const orderedSettings: UnifiedSettings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerOrder: [dshId, claudeId, codexId],
      providerInstances: {
        [dshId]: {
          driver: ProviderDriverKind.make("acpRegistry"),
          enabled: true,
          displayName: "我的深度求索",
          config: { agentId: "dsh" },
        },
        [claudeId]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: true,
          displayName: "主力 Claude",
        },
      },
      textGenerationModelSelection: {
        instanceId: ProviderInstanceId.make("removed_instance"),
        model: "missing",
      },
    };

    expect([...getCustomModelOptionsByInstance(orderedSettings, providers).keys()]).toEqual([
      dshId,
      claudeId,
      codexId,
    ]);
    expect([...getTextGenerationModelOptionsByInstance(orderedSettings, providers).keys()]).toEqual(
      [dshId, claudeId, codexId],
    );
    expect(resolveAppModelSelectionState(orderedSettings, providers).instanceId).toBe(dshId);
  });
});
