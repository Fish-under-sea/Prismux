// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodePath from "node:path";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProviderModel,
} from "@prismux/core-contracts";
import { createModelCapabilities, supportsFastMode } from "@prismux/core-shared/model";
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
  it("maps all 4 Prismux runtime modes to Orca permission tiers with amber full-access flag", () => {
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

  it("enforces agent-specific English Title-Case speed/mode toggles and 7-level effort tick abbreviations", () => {
    initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });

    const claudeModelWithExtra: ServerProviderModel = {
      slug: "claude-opus-5-5",
      name: "Claude Opus 5.5",
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
              { id: "minimal", label: "Minimal" },
              { id: "low", label: "Low" },
              { id: "medium", label: "Medium" },
              { id: "high", label: "High" },
              { id: "xhigh", label: "Extra High" },
              { id: "max", label: "Max" },
              { id: "ultra", label: "Ultra" },
            ],
          },
          { id: "fastMode", label: "Fast mode", type: "boolean", currentValue: false },
          { id: "ultracode", label: "Ultracode", type: "boolean", currentValue: true },
          { id: "noisyToggle", label: "Noisy Beta", type: "boolean", currentValue: true },
        ],
      }),
    };

    const codexModelWithUltraFast: ServerProviderModel = {
      slug: "gpt-6.2-astra",
      name: "GPT-6.2 Astra",
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
              { id: "max", label: "Max" },
              { id: "ultra", label: "Ultra" },
            ],
          },
          {
            id: "serviceTier",
            label: "Speed",
            type: "select",
            currentValue: "default",
            options: [
              { id: "default", label: "Standard" },
              { id: "fast", label: "Fast" },
              { id: "ultrafast", label: "Ultra Fast" },
              { id: "flex", label: "Flex" },
            ],
          },
        ],
      }),
    };

    const otherAgentWithFast: ServerProviderModel = {
      slug: "cursor-fast",
      name: "Cursor Fast",
      isCustom: false,
      capabilities: createModelCapabilities({
        optionDescriptors: [
          { id: "fastMode", label: "Fast mode", type: "boolean", currentValue: false },
          {
            id: "serviceTier",
            label: "Speed",
            type: "select",
            currentValue: "default",
            options: [
              { id: "default", label: "Standard" },
              { id: "fast", label: "Fast" },
            ],
          },
        ],
      }),
    };

    const renderFooter = (
      provider: string,
      model: ServerProviderModel,
      modelOptions: TraitsSelectionInput["modelOptions"] = [],
    ) =>
      renderToStaticMarkup(
        createElement(
          GTProvider,
          { locale: "zh", translations: {} },
          createElement(
            DockedPickerContext.Provider,
            { value: { modelLabel: model.name } },
            createElement(ComposerUnifiedOptionsFooter, {
              traits: {
                provider: ProviderDriverKind.make(provider),
                instanceId: ProviderInstanceId.make(provider),
                models: [model],
                model: model.slug,
                modelOptions,
                onModelOptionsChange: () => undefined,
              },
            }),
          ),
        ),
      );

    // 1. Claude: ONLY Fast Mode & Ultracode (English Title-Case, zero Chinese 快速, hides noisy toggles)
    //    AND 7-level effort slider uses Mini / Low / Med / High / XHigh / Max / Ultra ticks with full names in tooltip
    const claudeHtml = renderFooter("claudeAgent", claudeModelWithExtra, [
      { id: "effort", value: "ultra" },
      { id: "fastMode", value: true },
      { id: "ultracode", value: true },
    ]);
    expect(claudeHtml).toContain(">Fast Mode<");
    expect(claudeHtml).toContain(">Ultracode<");
    expect(claudeHtml).not.toContain(">快速<");
    expect(claudeHtml).not.toContain("Noisy Beta");
    for (const shortTick of ["Mini", "Low", "Med", "High", "XHigh", "Max", "Ultra"]) {
      expect(claudeHtml).toContain(`>${shortTick}<`);
    }
    expect(claudeHtml).toContain('title="Minimal"');
    expect(claudeHtml).toContain('title="Medium"');
    expect(claudeHtml).toContain('title="Extra High"');
    expect(claudeHtml).toContain('title="Ultra"');

    // 2. Codex: ONLY Fast & Ultra Fast (mutually exclusive, hides Flex / Priority)
    const codexHtml = renderFooter("codex", codexModelWithUltraFast, [
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "ultrafast" },
    ]);
    expect(codexHtml).toContain(">Fast<");
    expect(codexHtml).toContain(">Ultra Fast<");
    expect(codexHtml).not.toContain(">Flex<");
    expect(codexHtml).not.toContain(">Priority<");
    expect(codexHtml).not.toContain(">快速<");

    // 3. Other agents: ZERO extra speed/mode toggles
    const otherHtml = renderFooter("cursor", otherAgentWithFast, []);
    expect(otherHtml).not.toContain('data-composer-speed-row="true"');
    expect(otherHtml).not.toContain('data-composer-fast-mode-toggle="true"');
    expect(otherHtml).not.toContain("Fast Mode");
    expect(otherHtml).not.toContain("Ultra Fast");
  });

  it("formats canonical English effort label (never localized Chinese tiers) and FastBolt on composer pill trigger", () => {
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
    expect(suffixHtml).toContain("XHigh");
    expect(suffixHtml).not.toContain("极高");
    expect(suffixHtml).toContain("svg");
  });

  it("wires AGY 2.0 slender double-layer liquid-glass layout & footer structure in ChatComposer.tsx", () => {
    const chatDir = NodePath.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    );
    const source = NodeFS.readFileSync(NodePath.join(chatDir, "ChatComposer.tsx"), "utf8");

    // 1. Responds to dual-side drag-resize CSS variable with 960px slender default.
    expect(source).toContain("--pmx-chat-content-max-width");
    expect(source).toContain("960px");

    // 2. Dual-layer liquid-glass hooks: outer tray -> top tray -> nested inner card.
    const layoutIdx = source.indexOf('data-pmx-composer-layout="agy"');
    const topTrayIdx = source.indexOf('data-pmx-composer-top-tray="1"');
    const topTrayBarIdx = source.indexOf('<ComposerWorkspaceLocationBar variant="top-tray" />');
    const innerCardIdx = source.indexOf('data-pmx-composer-inner-card="1"');
    expect(layoutIdx).toBeGreaterThan(-1);
    expect(topTrayIdx).toBeGreaterThan(layoutIdx);
    expect(topTrayBarIdx).toBeGreaterThan(topTrayIdx);
    expect(innerCardIdx).toBeGreaterThan(topTrayBarIdx);

    // 3. Inner footer left has '+' attach & model picker (min-w-0 flex-1 overflow-x-clip);
    // right has inline telemetry + permissions + send; narrow widths (<700px) drop telemetry to wrap row.
    const leftActionsIdx = source.indexOf('data-chat-composer-actions="left"');
    const rightActionsIdx = source.indexOf('data-chat-composer-actions="right"');
    const leftControlsIdx = source.indexOf("{composerControls}", leftActionsIdx);
    const inlineTelemetryIdx = source.indexOf('placement="inline"', rightActionsIdx);
    const permissionsIdx = source.indexOf("<ComposerFooterModeControls", rightActionsIdx);
    const primaryClusterIdx = source.indexOf('data-pmx-composer-primary-cluster="true"', rightActionsIdx);
    const wrapRowIdx = source.indexOf('data-composer-telemetry-wrap-row="true"', primaryClusterIdx);
    expect(leftActionsIdx).toBeGreaterThan(innerCardIdx);
    expect(leftControlsIdx).toBeGreaterThan(leftActionsIdx);
    expect(leftControlsIdx).toBeLessThan(rightActionsIdx);
    expect(inlineTelemetryIdx).toBeGreaterThan(rightActionsIdx);
    expect(permissionsIdx).toBeGreaterThan(inlineTelemetryIdx);
    expect(primaryClusterIdx).toBeGreaterThan(permissionsIdx);
    expect(wrapRowIdx).toBeGreaterThan(primaryClusterIdx);
    expect(source).toContain("shouldWrapComposerTelemetryRow");
    expect(source).toContain("data-composer-telemetry-wrapped");
  });
});
