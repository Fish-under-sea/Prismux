import { assert, describe, it } from "@effect/vitest";

import { ProviderInstanceId } from "@prismux/core-contracts";
import { createModelCapabilities, createModelSelection } from "@prismux/core-shared/model";

import { getCodexServiceTierOptionValue, normalizeCodexServiceTier } from "./codexModelOptions.ts";

describe("codexModelOptions", () => {
  it("keeps legacy persisted fast mode selections working and resets false to default", () => {
    const fast = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
      { id: "fastMode", value: true },
    ]);
    const off = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
      { id: "fastMode", value: false },
    ]);

    assert.equal(getCodexServiceTierOptionValue(fast), "fast");
    assert.equal(getCodexServiceTierOptionValue(off), "default");
  });

  it("maps legacy priority to fast, preserves ultrafast, and resets flex/unknown to default", () => {
    const codexId = ProviderInstanceId.make("codex");
    assert.equal(normalizeCodexServiceTier("priority"), "fast");
    assert.equal(normalizeCodexServiceTier("fast"), "fast");
    assert.equal(normalizeCodexServiceTier("ultrafast"), "ultrafast");
    assert.equal(normalizeCodexServiceTier("flex"), "default");
    assert.equal(normalizeCodexServiceTier("default"), "default");
    assert.equal(normalizeCodexServiceTier(undefined), undefined);

    assert.equal(
      getCodexServiceTierOptionValue(
        createModelSelection(codexId, "gpt-6-astra", [{ id: "serviceTier", value: "priority" }]),
      ),
      "fast",
    );
    assert.equal(
      getCodexServiceTierOptionValue(
        createModelSelection(codexId, "gpt-6-astra", [{ id: "serviceTier", value: "ultrafast" }]),
      ),
      "ultrafast",
    );
    assert.equal(
      getCodexServiceTierOptionValue(
        createModelSelection(codexId, "gpt-6-astra", [{ id: "serviceTier", value: "flex" }]),
      ),
      "default",
    );
  });

  it("explicitly resets service_tier to default when the model does not support the chosen tier", () => {
    const codexId = ProviderInstanceId.make("codex");
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
    const unsupportedCaps = createModelCapabilities({ optionDescriptors: [] });

    assert.equal(
      getCodexServiceTierOptionValue(
        createModelSelection(codexId, "gpt-5.4", [{ id: "serviceTier", value: "ultrafast" }]),
        fastOnlyCaps,
      ),
      "default",
    );
    assert.equal(
      getCodexServiceTierOptionValue(
        createModelSelection(codexId, "gpt-5.4", [{ id: "serviceTier", value: "fast" }]),
        fastOnlyCaps,
      ),
      "fast",
    );
    assert.equal(
      getCodexServiceTierOptionValue(
        createModelSelection(codexId, "o3-mini", [{ id: "serviceTier", value: "fast" }]),
        unsupportedCaps,
      ),
      "default",
    );
    assert.equal(
      getCodexServiceTierOptionValue(createModelSelection(codexId, "o3-mini"), unsupportedCaps),
      "default",
    );
  });
});
