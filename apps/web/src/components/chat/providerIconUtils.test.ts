import { ProviderDriverKind } from "@prismux/core-contracts";
import { describe, expect, it } from "vite-plus/test";
import { getDisplayModelName, getTriggerDisplayModelName } from "./providerIconUtils";

describe("providerIconUtils normalized capitalized short names", () => {
  it("formats raw slugs and model titles into clean capitalized trigger names with zero lowercase slugs", () => {
    const codex = ProviderDriverKind.make("codex");
    const claude = ProviderDriverKind.make("claudeAgent");
    const antigravity = ProviderDriverKind.make("antigravity");

    expect(
      getTriggerDisplayModelName({ slug: "gpt-6.2-astra", name: "gpt-6.2-astra" }, codex),
    ).toBe("6.2 Astra");
    expect(
      getTriggerDisplayModelName({ slug: "gpt-6.2-astra", name: "GPT-6.2-Astra" }, codex),
    ).toBe("6.2 Astra");
    expect(
      getTriggerDisplayModelName({ slug: "gpt-6-astra", name: "GPT-6 Astra" }, codex),
    ).toBe("6 Astra");
    expect(
      getTriggerDisplayModelName({ slug: "claude-fable-5-2", name: "claude-fable-5-2" }, claude),
    ).toBe("Fable 5.2");
    expect(
      getTriggerDisplayModelName({ slug: "fable-5.2", name: "fable-5.2" }, claude),
    ).toBe("Fable 5.2");
    expect(
      getTriggerDisplayModelName({ slug: "claude-opus-5-5", name: "Claude Opus 5.5" }, claude),
    ).toBe("Opus 5.5");
    expect(
      getTriggerDisplayModelName({ slug: "gemini-4-neon", name: "gemini-4-neon" }, antigravity),
    ).toBe("4 Neon");
    expect(
      getTriggerDisplayModelName({ slug: "gemini-4-neon", name: "Gemini 4 neon" }, antigravity),
    ).toBe("4 Neon");
    expect(
      getTriggerDisplayModelName(
        {
          slug: "gpt-6.2-astra",
          name: "OpenAI: gpt-6.2-astra",
          subProvider: "OpenAI",
        },
        codex,
      ),
    ).toBe("6.2 Astra");
  });

  it("normalizes raw lowercase slugs in getDisplayModelName while keeping full human display names intact", () => {
    expect(getDisplayModelName({ slug: "claude-opus-5-5", name: "Claude Opus 5.5" })).toBe(
      "Claude Opus 5.5",
    );
    expect(getDisplayModelName({ slug: "gpt-6.2-astra", name: "gpt-6.2-astra" })).toBe(
      "6.2 Astra",
    );
    expect(getDisplayModelName({ slug: "gemini-4-neon", name: "gemini-4-neon" })).toBe(
      "4 Neon",
    );
  });
});
