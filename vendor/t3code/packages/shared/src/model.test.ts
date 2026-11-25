import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId, type ModelCapabilities } from "@t3tools/contracts";

import {
  applyClaudePromptEffortPrefix,
  buildCodexSpeedTierSelectionUpdate,
  buildExplicitProviderOptionSelectionsFromDescriptors,
  buildFastModeSelectionUpdate,
  buildProviderOptionSelectionsFromDescriptors,
  codexModelFamily,
  createModelCapabilities,
  createModelSelection,
  DEFAULT_VARIANT_CHOICE_ID,
  formatModelSlugName,
  getFastModeDescriptor,
  getFastModeOptionKey,
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  getReasoningEffortDescriptor,
  getReasoningEffortLevels,
  getUltracodeDescriptor,
  isFastModeActive,
  isUltrafastServiceTierChoice,
  readCustomModelEntries,
  modelSelectionsEqual,
  pickModelSelection,
  supportsFastMode,
  withImplicitFastModeDefault,
} from "./model.ts";

const codexCaps: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "xhigh", label: "Extra High" },
        { id: "high", label: "High", isDefault: true },
      ],
      currentValue: "high",
    },
    {
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
    },
  ],
});

describe("descriptor helpers", () => {
  it("builds dispatch options only from explicit selections", () => {
    const descriptors = getProviderOptionDescriptors({
      caps: codexCaps,
      selections: [{ id: "fastMode", value: true }],
    });

    expect(buildExplicitProviderOptionSelectionsFromDescriptors(descriptors, undefined)).toBe(
      undefined,
    );
    expect(
      buildExplicitProviderOptionSelectionsFromDescriptors(descriptors, [
        { id: "fastMode", value: true },
      ]),
    ).toEqual([{ id: "fastMode", value: true }]);
  });

  it("dispatches an old Ultracode effort as Extra High with the Ultracode toggle", () => {
    const legacy = [{ id: "effort", value: "ultracode" }];
    const descriptors = getProviderOptionDescriptors({
      caps: createModelCapabilities({
        optionDescriptors: [
          {
            id: "effort",
            label: "Reasoning",
            type: "select",
            options: [
              { id: "high", label: "High", isDefault: true },
              { id: "xhigh", label: "Extra High" },
            ],
          },
          { id: "ultracode", label: "Ultracode", type: "boolean" },
        ],
      }),
      selections: legacy,
    });

    expect(buildExplicitProviderOptionSelectionsFromDescriptors(descriptors, legacy)).toEqual([
      { id: "effort", value: "xhigh" },
      { id: "ultracode", value: true },
    ]);
  });

  it("compares complete model selections independent of option ordering", () => {
    const left = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
      { id: "reasoningEffort", value: "high" },
      { id: "fastMode", value: true },
    ]);
    const reordered = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
      { id: "fastMode", value: true },
      { id: "reasoningEffort", value: "high" },
    ]);

    expect(modelSelectionsEqual(left, reordered)).toBe(true);
    expect(
      modelSelectionsEqual(left, {
        ...reordered,
        options: [
          { id: "fastMode", value: true },
          { id: "reasoningEffort", value: "medium" },
        ],
      }),
    ).toBe(false);
    expect(modelSelectionsEqual(left, { ...reordered, model: "gpt-5.5" })).toBe(false);
  });

  it("keeps the options when the current model is picked again", () => {
    const codex = ProviderInstanceId.make("codex");
    const current = createModelSelection(codex, "gpt-5.4", [
      { id: "reasoningEffort", value: "high" },
    ]);

    expect(pickModelSelection(current, codex, "gpt-5.4")).toBe(current);
    expect(pickModelSelection(current, codex, "gpt-5.5")).toEqual({
      instanceId: "codex",
      model: "gpt-5.5",
    });
    expect(pickModelSelection(current, ProviderInstanceId.make("codex_work"), "gpt-5.4")).toEqual({
      instanceId: "codex_work",
      model: "gpt-5.4",
    });
    expect(pickModelSelection(null, codex, "gpt-5.4")).toEqual({
      instanceId: "codex",
      model: "gpt-5.4",
    });
  });
});

describe("applyClaudePromptEffortPrefix", () => {
  it("keeps slash commands intact when ultrathink is selected", () => {
    expect(applyClaudePromptEffortPrefix("/compact", "ultrathink")).toBe("/compact");
    expect(applyClaudePromptEffortPrefix(" /compact keep recent errors ", "ultrathink")).toBe(
      "/compact keep recent errors",
    );
    expect(applyClaudePromptEffortPrefix(" /review src/model.ts ", "ultrathink")).toBe(
      "/review src/model.ts",
    );
    expect(applyClaudePromptEffortPrefix("/security-review", "ultrathink")).toBe(
      "/security-review",
    );
    expect(applyClaudePromptEffortPrefix("/plugin:skill run", "ultrathink")).toBe(
      "/plugin:skill run",
    );
    expect(applyClaudePromptEffortPrefix("/deploy.prod to staging", "ultrathink")).toBe(
      "/deploy.prod to staging",
    );
  });

  it("still adds the ultrathink prefix to ordinary prompts", () => {
    expect(applyClaudePromptEffortPrefix("Investigate this failure", "ultrathink")).toBe(
      "Ultrathink:\nInvestigate this failure",
    );
    expect(applyClaudePromptEffortPrefix("/home/theo/app.ts crashed on load", "ultrathink")).toBe(
      "Ultrathink:\n/home/theo/app.ts crashed on load",
    );
  });
});

describe("readCustomModelEntries", () => {
  const capabilities: ModelCapabilities = {
    optionDescriptors: [
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [{ id: "high", label: "High", isDefault: true }],
        currentValue: "high",
      },
    ],
  };

  it("resolves bare slugs and entries, trimming and deduplicating on slug", () => {
    expect(
      readCustomModelEntries([
        " bare ",
        { slug: "named", name: " Named ", capabilities },
        "bare",
        { slug: "named", name: "Second" },
        "",
        { name: "no slug" },
        42,
      ]),
    ).toEqual([
      { slug: "bare", name: "bare", capabilities: null },
      { slug: "named", name: "Named", capabilities },
    ]);
  });

  it("drops unparseable capabilities but keeps the entry", () => {
    expect(
      readCustomModelEntries([{ slug: "x", capabilities: { optionDescriptors: "nope" } }]),
    ).toEqual([{ slug: "x", name: "x", capabilities: null }]);
    expect(readCustomModelEntries("not a list")).toEqual([]);
  });
});

describe("provider-reported option display", () => {
  const selection = createModelSelection(ProviderInstanceId.make("opencode"), "ling");
  const reported = { ...selection, options: [{ id: "variant", value: "default" }] };
  const descriptor = {
    id: "variant",
    label: "Reasoning",
    type: "select" as const,
    options: [
      { id: "none", label: "None" },
      { id: "thinking", label: "Thinking" },
    ],
  };

  it("shows explicit reports without adding a choice or a dispatch option", () => {
    expect(getProviderOptionCurrentLabel(descriptor, selection, reported)).toBe("Default");
    expect(
      getProviderOptionCurrentLabel(descriptor, selection, {
        ...reported,
        options: [{ id: "variant", value: "thinking" }],
      }),
    ).toBe("Thinking");
    expect(
      getProviderOptionCurrentLabel(
        { ...descriptor, currentValue: "none" },
        { ...selection, options: [{ id: "variant", value: "none" }] },
        reported,
      ),
    ).toBe("None");
    expect(descriptor.options.map((option) => option.id)).toEqual(["none", "thinking"]);
    expect(buildProviderOptionSelectionsFromDescriptors([descriptor])).toBeUndefined();
    expect(getProviderOptionCurrentLabel(descriptor, selection)).toBe("Unknown");
    const effortDescriptor = { ...descriptor, id: "effort", currentValue: "default" };
    expect(getProviderOptionCurrentLabel(effortDescriptor, selection)).toBeUndefined();
    expect(
      getProviderOptionCurrentLabel(effortDescriptor, selection, {
        ...reported,
        model: "other",
        options: [{ id: "effort", value: "default" }],
      }),
    ).toBeUndefined();
    expect(
      getProviderOptionCurrentLabel(effortDescriptor, selection, {
        ...reported,
        options: [{ id: "effort", value: "default" }],
      }),
    ).toBe("Default");
    expect(
      getProviderOptionCurrentLabel({ ...descriptor, currentValue: "thinking" }, selection),
    ).toBe("Unknown");
  });

  it("shows the catalog's Default choice while no variant is chosen", () => {
    const withDefault = {
      ...descriptor,
      options: [{ id: DEFAULT_VARIANT_CHOICE_ID, label: "Default" }, ...descriptor.options],
      currentValue: DEFAULT_VARIANT_CHOICE_ID,
    };
    expect(getProviderOptionCurrentValue(withDefault, selection)).toBe(DEFAULT_VARIANT_CHOICE_ID);
    expect(getProviderOptionCurrentLabel(withDefault, selection)).toBe("Default");
    expect(
      getProviderOptionCurrentLabel(withDefault, selection, {
        ...reported,
        options: [{ id: "variant", value: "thinking" }],
      }),
    ).toBe("Thinking");
  });

  it.each([
    { ...selection, model: "other" },
    { ...selection, instanceId: ProviderInstanceId.make("other") },
    { ...selection, options: [{ id: "variant", value: "none" }] },
  ])("ignores reports after changing the model, instance, or option: %j", (selected) => {
    expect(getProviderOptionCurrentLabel(descriptor, selected, reported)).toBe("Unknown");
  });
});

describe("withImplicitFastModeDefault", () => {
  // regression: #2981 a remembered Fast mode choice must survive the implicit default on new chats
  it("injects fastMode false only when the model exposes fastMode and no selection exists", () => {
    const caps = createModelCapabilities({
      optionDescriptors: [{ id: "fastMode", label: "Fast", type: "boolean", currentValue: true }],
    });

    expect(withImplicitFastModeDefault(caps, undefined)).toEqual([
      { id: "fastMode", value: false },
    ]);
    expect(withImplicitFastModeDefault(caps, [{ id: "fastMode", value: true }])).toEqual([
      { id: "fastMode", value: true },
    ]);
  });
});

describe("unified fastMode and reasoning capability helpers", () => {
  it("resolves Claude boolean fastMode, effort levels (excluding prompt-injected), and ultracode", () => {
    const claudeCaps = createModelCapabilities({
      optionDescriptors: [
        {
          id: "effort",
          label: "Reasoning",
          type: "select",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium", isDefault: true },
            { id: "high", label: "High" },
            { id: "xhigh", label: "Extra High" },
            { id: "max", label: "Max" },
            { id: "ultrathink", label: "Ultrathink" },
          ],
          promptInjectedValues: ["ultrathink"],
        },
        { id: "ultracode", label: "Ultracode", type: "boolean" },
        { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: true },
      ],
    });
    const claudeId = ProviderInstanceId.make("claudeAgent");

    expect(supportsFastMode(claudeCaps)).toBe(true);
    expect(getFastModeOptionKey(claudeCaps)).toBe("fastMode");
    expect(getFastModeDescriptor(claudeCaps)?.isSingleFastToggle).toBe(true);
    // Unselected Cursor/provider default currentValue: true must not appear user-enabled.
    expect(isFastModeActive(claudeCaps, createModelSelection(claudeId, "claude-opus-5-5"))).toBe(
      false,
    );
    expect(
      isFastModeActive(
        claudeCaps,
        createModelSelection(claudeId, "claude-opus-5-5", [{ id: "fastMode", value: true }]),
      ),
    ).toBe("fast");
    expect(buildFastModeSelectionUpdate(claudeCaps, true)).toEqual({ id: "fastMode", value: true });
    expect(buildFastModeSelectionUpdate(claudeCaps, false)).toEqual({
      id: "fastMode",
      value: false,
    });
    expect(getReasoningEffortDescriptor(claudeCaps)?.id).toBe("effort");
    expect(getReasoningEffortLevels(claudeCaps).map((choice) => choice.id)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(
      getReasoningEffortLevels(claudeCaps, { includePromptInjected: true }).map(
        (choice) => choice.id,
      ),
    ).toEqual(["low", "medium", "high", "xhigh", "max", "ultrathink"]);
    expect(getUltracodeDescriptor(claudeCaps)?.id).toBe("ultracode");
  });

  it("resolves Codex serviceTier speed controls for single-fast, multi-tier, and flex-only models", () => {
    const codexId = ProviderInstanceId.make("codex");
    const singleFastCaps = createModelCapabilities({
      optionDescriptors: [
        {
          id: "reasoningEffort",
          label: "Reasoning",
          type: "select",
          options: [
            { id: "minimal", label: "Minimal" },
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium", isDefault: true },
            { id: "high", label: "High" },
            { id: "xhigh", label: "Extra High" },
            { id: "max", label: "Max" },
            { id: "ultra", label: "Ultra" },
          ],
          currentValue: "medium",
        },
        {
          id: "serviceTier",
          label: "Service Tier",
          type: "select",
          options: [
            { id: "default", label: "Standard", isDefault: true },
            { id: "priority", label: "Fast" },
          ],
          currentValue: "default",
        },
      ],
    });

    expect(supportsFastMode(singleFastCaps)).toBe(true);
    expect(getFastModeOptionKey(singleFastCaps)).toBe("serviceTier");
    const singleControl = getFastModeDescriptor(singleFastCaps);
    expect(singleControl?.kind).toBe("serviceTier");
    expect(singleControl?.isSingleFastToggle).toBe(true);
    expect(buildFastModeSelectionUpdate(singleFastCaps, true)).toEqual({
      id: "serviceTier",
      value: "priority",
    });
    expect(buildFastModeSelectionUpdate(singleFastCaps, false)).toEqual({
      id: "serviceTier",
      value: "default",
    });
    expect(
      isFastModeActive(
        singleFastCaps,
        createModelSelection(codexId, "gpt-6-astra", [{ id: "serviceTier", value: "priority" }]),
      ),
    ).toBe("fast");
    expect(getReasoningEffortLevels(singleFastCaps).map((choice) => choice.id)).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);

    const multiTierCaps = createModelCapabilities({
      optionDescriptors: [
        {
          id: "serviceTier",
          label: "Service Tier",
          type: "select",
          options: [
            { id: "default", label: "Standard", isDefault: true },
            { id: "priority", label: "Fast" },
            { id: "ultrafast", label: "Ultrafast" },
          ],
          currentValue: "default",
        },
      ],
    });
    expect(supportsFastMode(multiTierCaps)).toBe(true);
    expect(getFastModeDescriptor(multiTierCaps)?.isSingleFastToggle).toBe(false);
    expect(
      isFastModeActive(
        multiTierCaps,
        createModelSelection(codexId, "gpt-6.1-sol", [{ id: "serviceTier", value: "ultrafast" }]),
      ),
    ).toBe("ultrafast");

    const flexOnlyCaps = createModelCapabilities({
      optionDescriptors: [
        {
          id: "serviceTier",
          label: "Service Tier",
          type: "select",
          options: [
            { id: "default", label: "Standard", isDefault: true },
            { id: "flex", label: "Flex" },
          ],
          currentValue: "default",
        },
      ],
    });
    expect(supportsFastMode(flexOnlyCaps)).toBe(false);
    expect(getFastModeOptionKey(flexOnlyCaps)).toBeNull();
    expect(getFastModeDescriptor(flexOnlyCaps)?.kind).toBe("serviceTier");
  });

  it("prefers role=reasoning for ACP / Antigravity / OMP models and falls back to boolean thinking", () => {
    const acpCaps = createModelCapabilities({
      optionDescriptors: [
        {
          id: "custom_thought",
          label: "Thinking",
          type: "select",
          role: "reasoning",
          options: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
          currentValue: "high",
        },
      ],
    });
    expect(getReasoningEffortDescriptor(acpCaps)?.id).toBe("custom_thought");
    expect(supportsFastMode(acpCaps)).toBe(false);

    const haikuCaps = createModelCapabilities({
      optionDescriptors: [{ id: "thinking", label: "Thinking", type: "boolean", currentValue: true }],
    });
    expect(getReasoningEffortDescriptor(haikuCaps)?.id).toBe("thinking");
    expect(getReasoningEffortLevels(haikuCaps)).toEqual([]);
  });

  it("recognizes Ultra Fast label and resets Codex speed tier to default when unsupported or off", () => {
    expect(isUltrafastServiceTierChoice({ id: "ultrafast", label: "Ultra Fast" })).toBe(true);
    const fullCaps = createModelCapabilities({
      optionDescriptors: [
        {
          id: "serviceTier",
          label: "Service Tier",
          type: "select",
          options: [
            { id: "default", label: "Standard", isDefault: true },
            { id: "fast", label: "Fast" },
            { id: "ultrafast", label: "Ultra Fast" },
          ],
          currentValue: "default",
        },
      ],
    });
    const fastOnlyCaps = createModelCapabilities({
      optionDescriptors: [
        {
          id: "serviceTier",
          label: "Service Tier",
          type: "select",
          options: [
            { id: "default", label: "Standard", isDefault: true },
            { id: "fast", label: "Fast" },
          ],
          currentValue: "default",
        },
      ],
    });
    expect(buildCodexSpeedTierSelectionUpdate(fullCaps, "fast")).toEqual({
      id: "serviceTier",
      value: "fast",
    });
    expect(buildCodexSpeedTierSelectionUpdate(fullCaps, "ultrafast")).toEqual({
      id: "serviceTier",
      value: "ultrafast",
    });
    expect(buildCodexSpeedTierSelectionUpdate(fullCaps, "default")).toEqual({
      id: "serviceTier",
      value: "default",
    });
    expect(buildCodexSpeedTierSelectionUpdate(fastOnlyCaps, "ultrafast")).toEqual({
      id: "serviceTier",
      value: "default",
    });
    expect(buildCodexSpeedTierSelectionUpdate(null, "fast")).toEqual({
      id: "serviceTier",
      value: "default",
    });
  });
});

describe("formatModelSlugName", () => {
  it.each([
    ["gpt-6.2-astra", "6.2 Astra"],
    ["gpt-6-astra", "6 Astra"],
    ["GPT 6.2 Astra", "6.2 Astra"],
    ["dragonapi/gpt-promax/gpt-6.2-astra", "6.2 Astra"],
    ["openai.gpt-6.1-sol", "6.1 Sol"],
    ["gpt-5.4-mini", "5.4 Mini"],
    ["gpt-5.3-codex-spark", "5.3 Codex Spark"],
    ["gpt-5.5", "GPT-5.5"],
    ["gpt-oss-120b-medium", "GPT-OSS 120B Medium"],
    ["o3-mini", "o3 Mini"],
    ["o4-mini", "o4 Mini"],
    ["claude-fable-5-2", "Fable 5.2"],
    ["fable-5.2", "Fable 5.2"],
    ["fable-5-2", "Fable 5.2"],
    ["claude-opus-5-5", "Opus 5.5"],
    ["opus-5.5", "Opus 5.5"],
    ["claude-opus-5-5-20260101", "Opus 5.5"],
    ["claude-opus-4-6[1m]", "Opus 4.6"],
    ["us.anthropic.claude-opus-4-6-v1:0", "Opus 4.6"],
    ["claude-sonnet-4-6", "Sonnet 4.6"],
    ["claude-haiku-4-5-20251001", "Haiku 4.5"],
    ["gemini-4-neon", "4 Neon"],
    ["gemini 4 neon", "4 Neon"],
    ["Gemini 4 Neon", "4 Neon"],
    ["google/gemini-4-carbon", "4 Carbon"],
    ["gemini-2-5-pro", "2.5 Pro"],
    ["gemini-3.8-flash-high", "3.8 Flash High"],
    ["Gemini 3.8 Flash (High)", "3.8 Flash (High)"],
    ["gemini-4", "Gemini 4"],
    ["grok-4.7", "Grok 4.7"],
    ["x-ai/grok-4-fast", "Grok 4 Fast"],
    ["deepseek-r1", "DeepSeek R1"],
    ["deepseek/deepseek-v3.2", "DeepSeek V3.2"],
    ["deepseek-v3-2", "DeepSeek V3.2"],
    ["deepseek-reasoner", "DeepSeek Reasoner"],
    ["qwen3-coder-plus", "Qwen 3 Coder Plus"],
    ["qwen-2.5-coder-32b", "Qwen 2.5 Coder 32B"],
    ["qwen/qwen3-235b-a22b", "Qwen 3 235B A22B"],
    ["glm-4.7", "GLM 4.7"],
    ["glm-4-7", "GLM 4.7"],
    ["zhipu/glm-5", "GLM 5"],
    ["glm-4.5-air", "GLM 4.5 Air"],
    ["dsh/gpt-6.2-astra", "6.2 Astra"],
    ["dsh:claude-fable-5-2", "Fable 5.2"],
    ["dsh-gemini-4-neon", "4 Neon"],
    ["NVIDIA: Nemotron 3 Super", "Nemotron 3 Super"],
    ["composer-1", "Composer 1"],
  ] as const)("formats %s -> %s", (raw, expected) => {
    expect(formatModelSlugName(raw)).toBe(expected);
  });

  it("extracts codexModelFamily across openai. and gateway slash prefixes", () => {
    expect(codexModelFamily("openai.gpt-6-astra")).toBe("gpt-6-astra");
    expect(codexModelFamily("dragonapi/gpt-promax/gpt-6.2-astra")).toBe("gpt-6.2-astra");
    expect(codexModelFamily("gpt-6-astra")).toBe("gpt-6-astra");
  });
});
