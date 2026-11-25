import { PrismuxReasoningEffortSlider } from "@prismux/appearance";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProviderModel,
} from "@prismux/core-contracts";
import { createModelCapabilities } from "@prismux/core-shared/model";
import { GTProvider, initializeGT } from "gt-react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { Combobox } from "../ui/combobox";
import { TooltipProvider } from "../ui/tooltip";
import {
  ComposerUnifiedOptionsFooter,
  describeComposerEffort,
} from "./ComposerModelEffort";
import { ModelListRow } from "./ModelListRow";
import { ModelPickerSidebar } from "./ModelPickerSidebar";
import {
  AGY_WAIVER_REQUIRED_BADGE_TEXT,
  resolveAntigravityComplianceBlock,
} from "../../prismux/SubscriptionRiskWaiverSection";
import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  COMPOSER_PICKER_ANCHOR_CARD_SELECTORS,
  DockedPickerContext,
  computeComposerPickerAlignOffset,
  findComposerPickerAnchorCard,
  resolveModelPickerPopupAlign,
} from "./ProviderModelPicker";
import {
  DEFAULT_AGENT_SCOPED_VISIBLE_MODELS,
  filterConcreteReasoningChoices,
  formatModelSourceSubtitle,
  isPhantomReasoningEffortChoice,
  orderModelOptionsByPreference,
  orderProviderInstanceEntries,
  partitionAgentScopedModels,
  resolveConcreteReasoningValue,
  retainedModelWhileProviderLocked,
  shouldScopeModelPickerToActiveAgent,
} from "./ProviderModelPicker.logic";

beforeAll(() => {
  initializeGT({ defaultLocale: "zh" });
});

describe("ProviderModelPicker.logic (Orca agent-scoped picker)", () => {
  it("enables agent-scoped mode by default when unifiedFooter is present and respects explicit override", () => {
    expect(
      shouldScopeModelPickerToActiveAgent({
        hasUnifiedFooter: true,
        hasActiveEntry: true,
      }),
    ).toBe(true);

    expect(
      shouldScopeModelPickerToActiveAgent({
        hasUnifiedFooter: false,
        hasActiveEntry: true,
      }),
    ).toBe(false);

    expect(
      shouldScopeModelPickerToActiveAgent({
        scopeToActiveAgent: true,
        hasUnifiedFooter: false,
        hasActiveEntry: true,
      }),
    ).toBe(true);

    expect(
      shouldScopeModelPickerToActiveAgent({
        scopeToActiveAgent: false,
        hasUnifiedFooter: true,
        hasActiveEntry: true,
      }),
    ).toBe(false);

    expect(
      shouldScopeModelPickerToActiveAgent({
        scopeToActiveAgent: true,
        hasUnifiedFooter: true,
        hasActiveEntry: false,
      }),
    ).toBe(false);
  });

  it("formats two-line model card source subtitles with canonical brand names", () => {
    expect(
      formatModelSourceSubtitle({
        driverKind: ProviderDriverKind.make("codex"),
        instanceDisplayName: "codex",
        isDefaultInstance: true,
      }),
    ).toBe("Codex");

    expect(
      formatModelSourceSubtitle({
        driverKind: ProviderDriverKind.make("codex"),
        instanceDisplayName: "Codex",
        subProvider: "OpenRouter",
        isDefaultInstance: true,
      }),
    ).toBe("Codex · via OpenRouter");

    expect(
      formatModelSourceSubtitle({
        driverKind: ProviderDriverKind.make("claudeAgent"),
        instanceDisplayName: "Team Claude Proxy",
        isDefaultInstance: false,
      }),
    ).toBe("Claude Code · via Team Claude Proxy");

    expect(
      formatModelSourceSubtitle({
        driverKind: ProviderDriverKind.make("antigravity"),
        instanceDisplayName: "antigravity",
        isDefaultInstance: true,
      }),
    ).toBe("Antigravity");
  });

  it("partitions models into primary visible cards and folded More models (N) while pinning active & favorites", () => {
    const codexId = ProviderInstanceId.make("codex");
    const models = Array.from({ length: 9 }, (_, i) => ({
      slug: `gpt-model-${i + 1}`,
      instanceId: codexId,
      isLegacy: i >= 7,
    }));

    const result = partitionAgentScopedModels({
      models,
      activeModelKey: `${codexId}:gpt-model-8`, // active is a legacy model at index 7!
      favoriteModelKeys: new Set([`${codexId}:gpt-model-7`]),
      keyOf: (m) => `${m.instanceId}:${m.slug}`,
      maxPrimaryCount: DEFAULT_AGENT_SCOPED_VISIBLE_MODELS,
    });

    // Active model (8) and favorited model (7) MUST stay visible in primaryModels
    expect(result.primaryModels.map((m) => m.slug)).toContain("gpt-model-8");
    expect(result.primaryModels.map((m) => m.slug)).toContain("gpt-model-7");
    expect(result.primaryModels).toHaveLength(DEFAULT_AGENT_SCOPED_VISIBLE_MODELS);
    expect(result.overflowModels.map((m) => m.slug)).toEqual([
      "gpt-model-5",
      "gpt-model-6",
      "gpt-model-9",
    ]);
  });

  it("keeps retainedModelWhileProviderLocked behavior intact", () => {
    const retained = retainedModelWhileProviderLocked(
      {
        driverKind: ProviderDriverKind.make("codex"),
        enabled: false,
        isAvailable: true,
        models: [{ slug: "gpt-5.4", name: "GPT-5.4" }],
      },
      "gpt-5.4",
    );
    expect(retained).toEqual({ slug: "gpt-5.4", name: "GPT-5.4" });
  });

  it("renders agent-scoped two-line ModelListRow with selected fill, subtitle, and preserves dsh-fish reasoning slider", () => {
    const html = renderToStaticMarkup(
      <GTProvider>
        <TooltipProvider>
          <Combobox inline items={["codex:gpt-5.4"]} open>
            <ModelListRow
              index={0}
              slug="gpt-5.4"
              name="GPT-5.4"
              instanceId={ProviderInstanceId.make("codex")}
              driverKind={ProviderDriverKind.make("codex")}
              providerDisplayName="Codex"
              isFavorite={false}
              isSelected
              showInstanceBadge={false}
              agentScoped
              sourceSubtitle="Codex · via OpenAI Direct"
              onToggleFavorite={vi.fn()}
            />
          </Combobox>
          <PrismuxReasoningEffortSlider
            modelId="gpt-5.4"
            modelName="GPT-5.4"
            provider="codex"
            options={[
              { value: "low", label: "低", shortLabel: "低" },
              { value: "medium", label: "中", shortLabel: "中" },
              { value: "high", label: "高", shortLabel: "高" },
              { value: "xhigh", label: "超高", shortLabel: "超高" },
            ]}
            value="high"
            locale="zh"
            label="思考强度"
            showStops
            showRunner
            compact
            onChange={vi.fn()}
          />
        </TooltipProvider>
      </GTProvider>,
    );

    expect(html).toContain('data-model-row-scoped="true"');
    expect(html).toContain('data-model-row-selected="true"');
    expect(html).toContain("GPT-5.4");
    expect(html).toContain("Codex · via OpenAI Direct");
    // Confirms dsh-fish reasoning slider renders cleanly alongside the picker with GPT/Codex theme & runner knob
    expect(html).toContain("思考强度");
    expect(html).toContain('type="range"');
    expect(html).toContain("pmx-re-input");
    expect(html).toContain("pmx-re-knob");
    expect(html).toContain('data-pmx-re-stop="high"');
    expect(html).toContain("思考强度 (GPT / Codex)");
  });

  it("forces start alignment for composer-owned pickers even when caller passes popupAlign='end'", () => {
    expect(
      resolveModelPickerPopupAlign({
        isComposerOwned: true,
        hasUnifiedFooter: true,
        popupAlign: "end",
      }),
    ).toBe("start");

    expect(
      resolveModelPickerPopupAlign({
        isComposerOwned: true,
        hasUnifiedFooter: false,
        popupAlign: "end",
      }),
    ).toBe("start");

    expect(
      resolveModelPickerPopupAlign({
        isComposerOwned: false,
        hasUnifiedFooter: true,
        popupAlign: "end",
      }),
    ).toBe("start");

    // Non-composer pickers (e.g. settings dropdowns) preserve explicit alignment overrides
    expect(
      resolveModelPickerPopupAlign({
        isComposerOwned: false,
        hasUnifiedFooter: false,
        popupAlign: "end",
      }),
    ).toBe("end");

    expect(resolveModelPickerPopupAlign({})).toBe("start");
  });

  it("computes exact negative horizontal alignOffset flush with the composer inner card left edge", () => {
    // Typical AGY composer: inner card left=300, '+' button + footer padding shifts model trigger to left=342
    expect(
      computeComposerPickerAlignOffset({
        triggerRect: { left: 342, right: 486, width: 144 },
        cardRect: { left: 300, right: 1020, width: 720 },
        align: "start",
        side: "top",
      }),
    ).toBe(-42);

    // Preserves fractional DPI scaling offsets cleanly
    expect(
      computeComposerPickerAlignOffset({
        triggerRect: { left: 338.5, right: 480.5, width: 142 },
        cardRect: { left: 300, right: 1020, width: 720 },
        align: "start",
        side: "top",
      }),
    ).toBe(-38.5);

    // Zero offset when already flush or on non-start / non-vertical placement / zero-width detached rect
    expect(
      computeComposerPickerAlignOffset({
        triggerRect: { left: 300, right: 440, width: 140 },
        cardRect: { left: 300, right: 1020, width: 720 },
        align: "start",
        side: "top",
      }),
    ).toBe(0);
    expect(
      computeComposerPickerAlignOffset({
        triggerRect: { left: 342, right: 486, width: 144 },
        cardRect: { left: 300, right: 1020, width: 720 },
        align: "end",
        side: "top",
      }),
    ).toBe(0);
    expect(
      computeComposerPickerAlignOffset({
        triggerRect: { left: 342, right: 486, width: 144 },
        cardRect: { left: 300, right: 1020, width: 720 },
        align: "start",
        side: "right",
      }),
    ).toBe(0);
    expect(
      computeComposerPickerAlignOffset({
        triggerRect: { left: 342, right: 342, width: 0 },
        cardRect: { left: 300, right: 1020, width: 720 },
        align: "start",
        side: "top",
      }),
    ).toBe(0);
    // Clamps positive drift so atypical wrappers never shift inward past the trigger
    expect(
      computeComposerPickerAlignOffset({
        triggerRect: { left: 280, right: 420, width: 140 },
        cardRect: { left: 300, right: 1020, width: 720 },
        align: "start",
        side: "top",
      }),
    ).toBe(0);
    // Mirrors cleanly in RTL layouts
    expect(
      computeComposerPickerAlignOffset({
        triggerRect: { left: 520, right: 660, width: 140 },
        cardRect: { left: 200, right: 700, width: 500 },
        align: "start",
        side: "top",
        isRtl: true,
      }),
    ).toBe(-40);
  });

  it("prioritizes the AGY composer inner card selector with graceful fallback", () => {
    expect(COMPOSER_PICKER_ANCHOR_CARD_SELECTORS[0]).toBe('[data-pmx-composer-inner-card="1"]');
    const innerCard = {} as HTMLElement;
    const outerCard = {} as HTMLElement;

    const triggerWithInnerCard = {
      closest: (selector: string) =>
        selector === '[data-pmx-composer-inner-card="1"]'
          ? innerCard
          : selector === '[data-pmx-composer-layout="agy"]'
            ? outerCard
            : null,
    } as unknown as Element;
    expect(findComposerPickerAnchorCard(triggerWithInnerCard)).toBe(innerCard);

    const triggerWithOuterOnly = {
      closest: (selector: string) =>
        selector === '[data-pmx-composer-layout="agy"]' ? outerCard : null,
    } as unknown as Element;
    expect(findComposerPickerAnchorCard(triggerWithOuterOnly)).toBe(outerCard);

    expect(findComposerPickerAnchorCard({ closest: () => null } as unknown as Element)).toBeNull();
    expect(findComposerPickerAnchorCard(null)).toBeNull();
  });

  it("orders provider instances by settings.providerOrder and models by providerModelPreferences[instanceId].modelOrder with stable unlisted fallback", () => {
    const codex = ProviderInstanceId.make("codex");
    const claude = ProviderInstanceId.make("claudeAgent");
    const dsh = ProviderInstanceId.make("acpRegistry_dsh");
    const agy = ProviderInstanceId.make("antigravity");

    const entries = [
      { instanceId: codex, name: "Codex" },
      { instanceId: claude, name: "Claude" },
      { instanceId: agy, name: "Antigravity" },
      { instanceId: dsh, name: "DeepSeek Harness" },
    ];

    expect(orderProviderInstanceEntries(entries, [dsh, claude]).map((e) => e.instanceId)).toEqual([
      dsh,
      claude,
      codex,
      agy,
    ]);
    expect(orderProviderInstanceEntries(entries, []).map((e) => e.instanceId)).toEqual([
      codex,
      claude,
      agy,
      dsh,
    ]);

    const models = [
      { slug: "gpt-5.4" },
      { slug: "gpt-6.2-astra" },
      { slug: "gpt-6-astra" },
      { slug: "o3" },
    ];
    expect(
      orderModelOptionsByPreference(models, ["gpt-6-astra", "o3"]).map((m) => m.slug),
    ).toEqual(["gpt-6-astra", "o3", "gpt-5.4", "gpt-6.2-astra"]);
  });

  it("filters phantom Provider default reasoning effort sentinels on DeepSeek/ACP while preserving real levels and Claude/Codex/AGY accuracy", () => {
    expect(isPhantomReasoningEffortChoice({ id: "_t3/empty", label: "Provider default" })).toBe(true);
    expect(isPhantomReasoningEffortChoice({ id: "provider_default", label: "Provider default" })).toBe(true);
    expect(isPhantomReasoningEffortChoice({ id: "default", label: "Default" })).toBe(true);
    expect(isPhantomReasoningEffortChoice({ id: "low", label: "Low" })).toBe(false);
    expect(isPhantomReasoningEffortChoice({ id: "off", label: "Off" })).toBe(false);
    expect(isPhantomReasoningEffortChoice({ id: "high", label: "High" })).toBe(false);
    expect(isPhantomReasoningEffortChoice({ id: "max", label: "Max" })).toBe(false);

    const rawDshChoices = [
      { id: "_t3/empty", label: "Provider default" },
      { id: "low", label: "Low" },
      { id: "high", label: "High" },
      { id: "max", label: "Max" },
    ];
    const concreteDshChoices = filterConcreteReasoningChoices(rawDshChoices);
    expect(concreteDshChoices.map((choice) => choice.id)).toEqual(["low", "high", "max"]);
    expect(resolveConcreteReasoningValue(concreteDshChoices, "_t3/empty", true)).toBe("high");
    expect(resolveConcreteReasoningValue(concreteDshChoices, "max", true)).toBe("max");

    const dshModel: ServerProviderModel = {
      slug: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      isCustom: false,
      capabilities: createModelCapabilities({
        optionDescriptors: [
          {
            id: "reasoning_effort",
            label: "Reasoning effort",
            type: "select",
            role: "reasoning",
            currentValue: "_t3/empty",
            options: rawDshChoices,
          },
        ],
      }),
    };

    const dshDefaultHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <TooltipProvider>
          <DockedPickerContext.Provider value={{ modelLabel: dshModel.name }}>
            <ComposerUnifiedOptionsFooter
              traits={{
                provider: ProviderDriverKind.make("acpRegistry"),
                instanceId: ProviderInstanceId.make("dsh"),
                models: [dshModel],
                model: dshModel.slug,
                modelOptions: [{ id: "reasoning_effort", value: "_t3/empty" }],
                onModelOptionsChange: vi.fn(),
              }}
            />
          </DockedPickerContext.Provider>
        </TooltipProvider>
      </GTProvider>,
    );

    expect(dshDefaultHtml).not.toContain("Provider def");
    expect(dshDefaultHtml).not.toContain("Provider default");
    expect(dshDefaultHtml).not.toContain("_t3/empty");
    expect(dshDefaultHtml).toContain('data-pmx-re-stop="low"');
    expect(dshDefaultHtml).toContain('data-pmx-re-stop="high"');
    expect(dshDefaultHtml).toContain('data-pmx-re-stop="max"');
    expect(dshDefaultHtml).toContain('data-pmx-re-value="high"');
    expect(dshDefaultHtml).toContain("--pmx-re-count:3");

    // Selecting Max hits full 100% progress & 100% full-bleed fill with zero leftover dark stub
    const dshMaxHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <TooltipProvider>
          <DockedPickerContext.Provider value={{ modelLabel: dshModel.name }}>
            <ComposerUnifiedOptionsFooter
              traits={{
                provider: ProviderDriverKind.make("acpRegistry"),
                instanceId: ProviderInstanceId.make("dsh"),
                models: [dshModel],
                model: dshModel.slug,
                modelOptions: [{ id: "reasoning_effort", value: "max" }],
                onModelOptionsChange: vi.fn(),
              }}
            />
          </DockedPickerContext.Provider>
        </TooltipProvider>
      </GTProvider>,
    );
    expect(dshMaxHtml).toContain('data-pmx-re-value="max"');
    expect(dshMaxHtml).toContain('data-pmx-re-top="1"');
    expect(dshMaxHtml).toContain("--pmx-progress:1");
    expect(dshMaxHtml).toContain("--pmx-re-fill:100%");

    // Composer trigger pill resolves cleanly to High (never "Provider default" or "_t3/empty")
    const describedDsh = describeComposerEffort(
      {
        provider: ProviderDriverKind.make("acpRegistry"),
        instanceId: ProviderInstanceId.make("dsh"),
        models: [dshModel],
        model: dshModel.slug,
        modelOptions: [{ id: "reasoning_effort", value: "_t3/empty" }],
        onModelOptionsChange: vi.fn(),
      },
      "label",
      "sm",
    );
    const describedHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>{describedDsh.suffix}</GTProvider>,
    );
    expect(describedHtml).toContain("High");
    expect(describedHtml).not.toContain("Provider");

    // Claude / Codex / AGY real levels remain 100% preserved
    const claudeLevels = [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
      { id: "max", label: "Max" },
    ];
    expect(filterConcreteReasoningChoices(claudeLevels)).toEqual(claudeLevels);
    const codexLevels = [
      { id: "minimal", label: "Minimal" },
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
    ];
    expect(filterConcreteReasoningChoices(codexLevels)).toEqual(codexLevels);
    const agyLevels = [
      { id: "off", label: "Off" },
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
    ];
    expect(filterConcreteReasoningChoices(agyLevels)).toEqual(agyLevels);
  });

  it("renders grayed-out red-ringed blocked Antigravity indicator in ModelPickerSidebar when getProviderComplianceBlock blocks it", () => {
    const codexId = ProviderInstanceId.make("codex");
    const agyId = ProviderInstanceId.make("antigravity");
    const makeEntry = (instanceId: ProviderInstanceId, driver: string, displayName: string): ProviderInstanceEntry => ({
      instanceId,
      driverKind: ProviderDriverKind.make(driver),
      displayName,
      enabled: true,
      installed: true,
      status: "ready",
      isDefault: true,
      isAvailable: true,
      models: [],
      snapshot: {
        instanceId,
        driver: ProviderDriverKind.make(driver),
        enabled: true,
        installed: true,
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-11-25T16:00:00.000Z",
        models: [],
        slashCommands: [],
        skills: [],
      } as unknown as ProviderInstanceEntry["snapshot"],
    });
    const entries = [
      makeEntry(codexId, "codex", "Codex"),
      makeEntry(agyId, "antigravity", "Antigravity"),
    ];
    const onOpenWaiver = vi.fn();

    const blockedHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <TooltipProvider>
          <ModelPickerSidebar
            selectedInstanceId={codexId}
            onSelectInstance={vi.fn()}
            onFocusSearch={vi.fn()}
            instanceEntries={entries}
            getProviderComplianceBlock={(entry) =>
              resolveAntigravityComplianceBlock({
                entry,
                waiver: { signed: false, allowAntigravityAsControlledAgent: false },
                mode: "controlled",
                onOpenWaiver,
              })
            }
          />
        </TooltipProvider>
      </GTProvider>,
    );

    expect(blockedHtml).toContain('data-model-picker-provider-blocked="true"');
    expect(blockedHtml).toContain('data-model-picker-provider-blocked-dot="true"');
    expect(blockedHtml).toContain("opacity-55");
    expect(blockedHtml).toContain("ring-destructive/80");
    expect(blockedHtml).toContain(AGY_WAIVER_REQUIRED_BADGE_TEXT);

    // Direct chat picker (no compliance block prop) keeps Antigravity completely unrestricted
    const unrestrictedHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <TooltipProvider>
          <ModelPickerSidebar
            selectedInstanceId={codexId}
            onSelectInstance={vi.fn()}
            onFocusSearch={vi.fn()}
            instanceEntries={entries}
          />
        </TooltipProvider>
      </GTProvider>,
    );
    expect(unrestrictedHtml).not.toContain('data-model-picker-provider-blocked="true"');
    expect(unrestrictedHtml).not.toContain(AGY_WAIVER_REQUIRED_BADGE_TEXT);
  });
});
