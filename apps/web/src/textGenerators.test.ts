import { ProviderDriverKind, ProviderInstanceId } from "@prismux/core-contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  nextTextGeneratorId,
  TEXT_GENERATOR_PRESETS,
  textGeneratorBrand,
} from "./textGenerators";

describe("nextTextGeneratorId", () => {
  it("skips ids that would make a selection name another target", () => {
    const settings = {
      providerInstances: {
        [ProviderInstanceId.make("openai")]: { driver: ProviderDriverKind.make("codex") },
      },
      textGenerators: {
        [ProviderInstanceId.make("openai-2")]: {
          kind: "openaiCompatible" as const,
          baseUrl: "https://api.openai.com/v1",
          apiKey: "",
          enabled: true,
        },
      },
    };
    const providers = [{ instanceId: ProviderInstanceId.make("openai-3") }];

    expect(nextTextGeneratorId("openai", settings, providers)).toBe("openai-4");
    // A driver's default instance id is taken even before it has a snapshot or config.
    expect(nextTextGeneratorId("codex", settings, [])).toBe("codex-2");
    expect(nextTextGeneratorId("gemini", settings, providers)).toBe("gemini");
  });
});

describe("TEXT_GENERATOR_PRESETS", () => {
  it("lists OpenAI, Anthropic, Gemini (OpenAI-compatible), and Custom in exact order", () => {
    expect(TEXT_GENERATOR_PRESETS.map((preset) => preset.id)).toEqual([
      "openai",
      "anthropic",
      "gemini",
      "custom",
    ]);
    expect(TEXT_GENERATOR_PRESETS[2]).toEqual({
      id: "gemini",
      label: "Gemini",
      kind: "openaiCompatible",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    });
  });
});

describe("textGeneratorBrand", () => {
  it.each([
    ["anthropic", "https://proxy.example/v1", "anthropic"],
    ["openaiCompatible", "https://generativelanguage.googleapis.com/v1beta/openai", "gemini"],
    ["openaiCompatible", "https://openrouter.ai/api/v1", "openrouter"],
    ["openaiCompatible", "https://api.openai.com/v1", "openai"],
    ["openaiCompatible", "http://localhost:11434/v1", "ollama"],
    ["openaiCompatible", "http://localhost:1234/v1", "openaiCompatible"],
  ] as const)("%s at %s shows the %s icon", (kind, baseUrl, brand) => {
    expect(textGeneratorBrand({ kind, baseUrl })).toBe(brand);
  });
});
