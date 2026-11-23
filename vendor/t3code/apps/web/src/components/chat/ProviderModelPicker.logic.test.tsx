import { PrismuxReasoningEffortSlider } from "@prismux/appearance";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { GTProvider, initializeGT } from "gt-react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { Combobox } from "../ui/combobox";
import { TooltipProvider } from "../ui/tooltip";
import { ModelListRow } from "./ModelListRow";
import {
  COMPOSER_PICKER_ANCHOR_CARD_SELECTORS,
  computeComposerPickerAlignOffset,
  findComposerPickerAnchorCard,
  resolveModelPickerPopupAlign,
} from "./ProviderModelPicker";
import {
  DEFAULT_AGENT_SCOPED_VISIBLE_MODELS,
  formatModelSourceSubtitle,
  partitionAgentScopedModels,
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
});
