import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@prismux/core-contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@prismux/core-contracts/settings";
import { createModelSelection } from "@prismux/core-shared/model";
import { describe, expect, it } from "vite-plus/test";

import { providerInstanceEntriesFor } from "../../providerInstances";
import {
  buildDefaultReasoningEffortUpdatePatch,
  resolveDefaultModelSettingsPresentation,
} from "./ProjectDefaultsSettings.logic";

const claudeId = ProviderInstanceId.make("claudeAgent");
const high = [{ id: "effort", value: "high" }];
const savedClaude = createModelSelection(claudeId, "claude-opus-4-8", high);
function provider(input: {
  instanceId: string;
  driver: string;
  enabled?: boolean;
  availability?: ServerProvider["availability"];
  models: ReadonlyArray<string>;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver),
    enabled: input.enabled ?? true,
    installed: true,
    version: null,
    status: "ready",
    ...(input.availability ? { availability: input.availability } : {}),
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: input.models.map((slug, index) => ({
      slug,
      name: slug,
      isCustom: false,
      ...(index === 0 ? { isDefault: true } : {}),
      capabilities: {},
    })),
    slashCommands: [],
    skills: [],
  };
}

const claudeAndCodex = [
  provider({ instanceId: "codex", driver: "codex", models: ["gpt-5.6"] }),
  provider({ instanceId: "claudeAgent", driver: "claudeAgent", models: ["claude-opus-4-8"] }),
];

function present(
  providers: ReadonlyArray<ServerProvider>,
  overrides: Partial<UnifiedSettings> = {},
) {
  const settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    defaultModelSelection: savedClaude,
    ...overrides,
  };
  return resolveDefaultModelSettingsPresentation({
    entries: providerInstanceEntriesFor(providers, settings, null),
    providers,
    settings,
    projectId: null,
  });
}

const claudeOff: Partial<UnifiedSettings> = {
  providerInstances: {
    [claudeId]: { driver: ProviderDriverKind.make("claudeAgent"), enabled: false },
  },
};

describe("resolveDefaultModelSettingsPresentation", () => {
  it("keeps the saved model and explains why when its provider cannot run", () => {
    const withoutClaude = claudeAndCodex.filter((entry) => entry.instanceId !== claudeId);
    const claudeUnavailable = claudeAndCodex.map((entry) =>
      entry.instanceId === claudeId ? { ...entry, availability: "unavailable" as const } : entry,
    );
    // Settings turn Claude off before the server snapshot reflects it.
    expect(present(claudeAndCodex, claudeOff)).toEqual({
      selection: savedClaude,
      providerNote: "Claude is turned off.",
    });
    expect(present(claudeUnavailable)).toEqual({
      selection: savedClaude,
      providerNote: "Claude is unavailable.",
    });
    expect(present(withoutClaude)).toEqual({
      selection: savedClaude,
      providerNote: "This provider is not available on this environment.",
    });
  });

  it("leaves effort editable when the saved provider can run", () => {
    expect(present(claudeAndCodex)).toEqual({ selection: savedClaude, providerNote: null });
  });

  it("still follows a hidden model on the same provider", () => {
    const row = present(
      [
        provider({
          instanceId: "claudeAgent",
          driver: "claudeAgent",
          models: ["claude-sonnet-5", "claude-opus-4-8"],
        }),
      ],
      {
        providerModelPreferences: {
          [claudeId]: { hiddenModels: ["claude-opus-4-8"], modelOrder: [] },
        },
      },
    );
    expect(row.providerNote).toBeNull();
    expect(row.selection).toMatchObject({ instanceId: claudeId, model: "claude-sonnet-5" });
  });

  it("lets a project-level defaultReasoningEffort override an inherited environment model effort", () => {
    const codexId = ProviderInstanceId.make("codex");
    const codexProvider: ServerProvider = {
      ...provider({ instanceId: "codex", driver: "codex", models: ["gpt-5.6"] }),
      models: [
        {
          slug: "gpt-5.6",
          name: "GPT-5.6",
          isCustom: false,
          isDefault: true,
          capabilities: {
            optionDescriptors: [
              {
                id: "reasoningEffort",
                label: "Reasoning effort",
                type: "select",
                role: "reasoning",
                options: ["low", "medium", "high", "xhigh"].map((id) => ({
                  id,
                  label: id,
                  isDefault: id === "medium",
                })),
              },
              {
                id: "serviceTier",
                label: "Speed",
                type: "select",
                options: [
                  { id: "default", label: "Standard", isDefault: true },
                  { id: "fast", label: "Fast" },
                ],
              },
            ],
          },
        },
      ],
    };
    const settings: UnifiedSettings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      defaultModelSelection: createModelSelection(codexId, "gpt-5.6", [
        { id: "reasoningEffort", value: "low" },
        { id: "serviceTier", value: "fast" },
      ]),
      defaultReasoningEffort: "max",
    };

    const row = resolveDefaultModelSettingsPresentation({
      entries: providerInstanceEntriesFor([codexProvider], settings, null),
      providers: [codexProvider],
      settings,
      projectId: null,
      inheritDefaultModelFromEnvironment: true,
      projectOverridesDefaultReasoningEffort: true,
    });

    expect(row.providerNote).toBeNull();
    expect(row.selection).toEqual(
      createModelSelection(codexId, "gpt-5.6", [
        { id: "serviceTier", value: "fast" },
        { id: "reasoningEffort", value: "xhigh" },
      ]),
    );
  });
});

describe("buildDefaultReasoningEffortUpdatePatch", () => {
  const codexId = ProviderInstanceId.make("codex");
  const claudeIdLocal = ProviderInstanceId.make("claudeAgent");

  it("strips stale reasoning effort from defaultModelSelection and fallbackModelSelection while preserving other options", () => {
    const patch = buildDefaultReasoningEffortUpdatePatch({
      nextEffort: "max",
      isProjectScope: false,
      modelSource: "environment",
      mixedModel: false,
      mixedFallback: false,
      defaultModelSelection: createModelSelection(codexId, "gpt-5.6", [
        { id: "reasoningEffort", value: "medium" },
        { id: "serviceTier", value: "fast" },
      ]),
      fallbackModelSelection: createModelSelection(claudeIdLocal, "claude-opus-4-8", [
        { id: "effort", value: "low" },
        { id: "fastMode", value: true },
      ]),
      providers: claudeAndCodex,
    });

    expect(patch).toEqual({
      defaultReasoningEffort: "max",
      defaultModelSelection: createModelSelection(codexId, "gpt-5.6", [
        { id: "serviceTier", value: "fast" },
      ]),
      fallbackModelSelection: createModelSelection(claudeIdLocal, "claude-opus-4-8", [
        { id: "fastMode", value: true },
      ]),
    });
  });

  it("does not create a project-level defaultModelSelection override when defaultModelSelection is inherited", () => {
    const patch = buildDefaultReasoningEffortUpdatePatch({
      nextEffort: "low",
      isProjectScope: true,
      modelSource: "environment",
      mixedModel: false,
      mixedFallback: false,
      defaultModelSelection: createModelSelection(codexId, "gpt-5.6", [
        { id: "reasoningEffort", value: "high" },
      ]),
      fallbackModelSelection: createModelSelection(claudeIdLocal, "claude-opus-4-8", [
        { id: "effort", value: "high" },
      ]),
      providers: claudeAndCodex,
    });

    expect(patch).toEqual({ defaultReasoningEffort: "low" });
  });

  it("strips stale reasoning effort from a project-owned defaultModelSelection without touching fallbackModelSelection", () => {
    const patch = buildDefaultReasoningEffortUpdatePatch({
      nextEffort: "low",
      isProjectScope: true,
      modelSource: "project",
      mixedModel: false,
      mixedFallback: false,
      defaultModelSelection: createModelSelection(codexId, "gpt-5.6", [
        { id: "reasoningEffort", value: "high" },
      ]),
      fallbackModelSelection: createModelSelection(claudeIdLocal, "claude-opus-4-8", [
        { id: "effort", value: "high" },
      ]),
      providers: claudeAndCodex,
    });

    expect(patch).toEqual({
      defaultReasoningEffort: "low",
      defaultModelSelection: createModelSelection(codexId, "gpt-5.6"),
    });
  });

  it("does not overwrite mixed default or fallback models across environments", () => {
    const patch = buildDefaultReasoningEffortUpdatePatch({
      nextEffort: "medium",
      isProjectScope: false,
      modelSource: "environment",
      mixedModel: true,
      mixedFallback: true,
      defaultModelSelection: createModelSelection(codexId, "gpt-5.6", [
        { id: "reasoningEffort", value: "high" },
      ]),
      fallbackModelSelection: createModelSelection(claudeIdLocal, "claude-opus-4-8", [
        { id: "effort", value: "high" },
      ]),
      providers: claudeAndCodex,
    });

    expect(patch).toEqual({ defaultReasoningEffort: "medium" });
  });
});
