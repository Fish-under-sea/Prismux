import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities, supportsFastMode } from "@t3tools/shared/model";
import { GTProvider, initializeGT } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  ComposerUnifiedOptionsFooter,
  describeComposerEffort,
} from "./ComposerModelEffort";
import { ComposerPermissionsSection } from "./ComposerFooterControls";
import { DockedPickerContext } from "./ProviderModelPicker";
import {
  isFullAccessRuntimeMode,
  resolveRuntimeModeOption,
  runtimeModeConfig,
  runtimeModeOptions,
} from "./runtimeModeConfig";
import type { TraitsSelectionInput } from "./TraitsPicker";

const CLAUDE_OPUS_MODEL: ServerProviderModel = {
  slug: "claude-opus-4-6",
  name: "Claude Opus 4.6",
  isCustom: false,
  capabilities: createModelCapabilities({
    optionDescriptors: [
      {
        id: "effort",
        label: "Effort",
        type: "select",
        role: "reasoning",
        currentValue: "high",
        options: [
          { id: "low", label: "Low" },
          { id: "medium", label: "Medium" },
          { id: "high", label: "High" },
          { id: "xhigh", label: "Extra High" },
          { id: "max", label: "Max" },
        ],
      },
      {
        id: "fastMode",
        label: "Fast mode",
        type: "boolean",
        currentValue: false,
      },
    ],
  }),
};

const CODEX_GPT_MODEL: ServerProviderModel = {
  slug: "gpt-5.4-codex",
  name: "GPT-5.4 Codex",
  isCustom: false,
  capabilities: createModelCapabilities({
    optionDescriptors: [
      {
        id: "reasoningEffort",
        label: "Reasoning effort",
        type: "select",
        role: "reasoning",
        currentValue: "medium",
        options: [
          { id: "minimal", label: "Minimal" },
          { id: "low", label: "Low" },
          { id: "medium", label: "Medium" },
          { id: "high", label: "High" },
          { id: "xhigh", label: "Extra High" },
        ],
      },
      {
        id: "serviceTier",
        label: "Speed",
        type: "select",
        currentValue: "default",
        options: [
          { id: "default", label: "Standard" },
          { id: "priority", label: "Fast" },
        ],
      },
    ],
  }),
};

const GEMINI_MODEL: ServerProviderModel = {
  slug: "gemini-2.5-pro",
  name: "Gemini 2.5 Pro",
  isCustom: false,
  capabilities: createModelCapabilities({
    optionDescriptors: [
      {
        id: "thought_level",
        label: "Thinking",
        type: "select",
        role: "reasoning",
        currentValue: "high",
        options: [
          { id: "low", label: "Low" },
          { id: "medium", label: "Medium" },
          { id: "high", label: "High" },
        ],
      },
    ],
  }),
};

describe("Orca composer redesign, 4-tier permissions, reasoning slider & fast mode", () => {
  it("maps all 4 T3 Code runtime modes to Orca permission tiers with amber full-access flag", () => {
    expect(runtimeModeOptions).toEqual([
      "approval-required",
      "auto-accept-edits",
      "auto",
      "full-access",
    ]);
    expect(isFullAccessRuntimeMode("full-access")).toBe(true);
    expect(isFullAccessRuntimeMode("approval-required")).toBe(false);
    expect(isFullAccessRuntimeMode("auto-accept-edits")).toBe(false);
    expect(isFullAccessRuntimeMode("auto")).toBe(false);

    for (const mode of runtimeModeOptions) {
      expect(runtimeModeConfig[mode].icon).toBeDefined();
      expect(runtimeModeConfig[mode].label).toBeTruthy();
      expect(runtimeModeConfig[mode].description).toBeTruthy();
    }
  });

  it("renders Orca vertical 4-tier permission list with amber full-access accent", () => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });
    const options = runtimeModeOptions.map((mode) => resolveRuntimeModeOption(mode));
    const html = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "en", translations: {} },
        createElement(
          MenuPrimitive.Root,
          { open: true },
          createElement(ComposerPermissionsSection, {
            runtimeMode: "full-access",
            runtimeModeOptions: options,
            onRuntimeModeChange: () => undefined,
          }),
        ),
      ),
    );
    expect(html).toContain("Ask for approval");
    expect(html).toContain("Accept edits");
    expect(html).toContain("Approve for me");
    expect(html).toContain("Full access");
    expect(html).toContain("data-permission-option=\"full-access\"");
    expect(html).toContain("text-amber-700");
  });

  it("renders model-aware reasoning effort slider + Fast Mode toggle for Claude and Codex, hiding Speed when unsupported", () => {
    initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });

    const renderFooter = (
      provider: string,
      model: ServerProviderModel,
      modelOptions: TraitsSelectionInput["modelOptions"] = [],
    ) => {
      const traits: TraitsSelectionInput = {
        provider: ProviderDriverKind.make(provider),
        instanceId: ProviderInstanceId.make(provider),
        models: [model],
        model: model.slug,
        modelOptions,
        onModelOptionsChange: () => undefined,
      };
      return renderToStaticMarkup(
        createElement(
          GTProvider,
          { locale: "zh", translations: {} },
          createElement(
            DockedPickerContext.Provider,
            { value: { modelLabel: model.name } },
            createElement(ComposerUnifiedOptionsFooter, { traits }),
          ),
        ),
      );
    };

    // Claude Opus: detects claude family + renders Fast Mode boolean toggle
    expect(supportsFastMode(CLAUDE_OPUS_MODEL.capabilities)).toBe(true);
    const claudeHtml = renderFooter("claudeAgent", CLAUDE_OPUS_MODEL, [
      { id: "effort", value: "xhigh" },
      { id: "fastMode", value: true },
    ]);
    expect(claudeHtml).toContain('data-composer-unified-options="true"');
    expect(claudeHtml).toContain('data-pmx-re-theme="claude"');
    expect(claudeHtml).toContain('data-composer-fast-mode-toggle="true"');
    expect(claudeHtml).toContain('aria-pressed="true"');

    // Codex GPT-5.4: detects openai family + renders single-toggle serviceTier Fast button
    expect(supportsFastMode(CODEX_GPT_MODEL.capabilities)).toBe(true);
    const codexHtml = renderFooter("codex", CODEX_GPT_MODEL, [
      { id: "reasoningEffort", value: "medium" },
      { id: "serviceTier", value: "priority" },
    ]);
    expect(codexHtml).toContain('data-pmx-re-theme="openai"');
    expect(codexHtml).toContain('data-composer-fast-mode-toggle="true"');
    expect(codexHtml).toContain('aria-pressed="true"');

    // Gemini without Fast Mode: detects gemini family + omits Speed row cleanly
    expect(supportsFastMode(GEMINI_MODEL.capabilities)).toBe(false);
    const geminiHtml = renderFooter("antigravity", GEMINI_MODEL);
    expect(geminiHtml).toContain('data-pmx-re-theme="gemini"');
    expect(geminiHtml).not.toContain('data-composer-speed-row="true"');
    expect(geminiHtml).not.toContain('data-composer-fast-mode-toggle="true"');
  });

  it("formats localized Chinese short effort label and FastBolt on composer pill trigger", () => {
    initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });
    const traits: TraitsSelectionInput = {
      provider: ProviderDriverKind.make("claudeAgent"),
      instanceId: ProviderInstanceId.make("claude"),
      models: [CLAUDE_OPUS_MODEL],
      model: CLAUDE_OPUS_MODEL.slug,
      modelOptions: [
        { id: "effort", value: "xhigh" },
        { id: "fastMode", value: true },
      ],
      onModelOptionsChange: () => undefined,
    };
    const described = describeComposerEffort(traits, "label", "sm", undefined, "zh");
    const suffixHtml = renderToStaticMarkup(
      createElement(GTProvider, { locale: "zh", translations: {} }, described.suffix),
    );
    expect(suffixHtml).toContain("极高");
    expect(suffixHtml).toContain("svg");
  });
});
