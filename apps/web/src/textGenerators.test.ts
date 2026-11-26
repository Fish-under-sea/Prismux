import { EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@prismux/core-contracts";
import { AtomRegistry } from "effect/reactivity";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { appAtomRegistry } from "./rpc/atomRegistry";
import {
  __textGeneratorsTesting,
  MAX_TEXT_GENERATOR_REFRESH_KEYS,
  nextTextGeneratorId,
  rereadTextGeneratorModels,
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

describe("rereadTextGeneratorModels bounded refresh counts", () => {
  afterEach(() => {
    __textGeneratorsTesting.resetRefreshCountsForTests();
  });

  it("evicts derived refreshCountAtom nodes after unsubscribe and bounds stored keys by LRU", () => {
    const environmentId = EnvironmentId.make("env-text-gen");
    const firstId = ProviderInstanceId.make("gen-0");
    const watchedAtom = __textGeneratorsTesting.refreshCountAtomForTest(environmentId, firstId);
    const observed: number[] = [];
    const unsubscribe = appAtomRegistry.subscribe(watchedAtom, (count) => {
      observed.push(count);
    });

    rereadTextGeneratorModels(environmentId, firstId);
    expect(observed).toEqual([1]);
    unsubscribe();

    const scheduledTasks = new Set<() => void>();
    const probeRegistry = AtomRegistry.make({
      scheduleTask: (task) => {
        scheduledTasks.add(task);
        return () => {
          scheduledTasks.delete(task);
        };
      },
    });
    try {
      const stopProbe = probeRegistry.subscribe(watchedAtom, () => {});
      expect(probeRegistry.getNodes().has(watchedAtom)).toBe(true);
      stopProbe();
      for (const task of scheduledTasks) {
        scheduledTasks.delete(task);
        task();
      }
      expect(probeRegistry.getNodes().has(watchedAtom)).toBe(false);
    } finally {
      probeRegistry.dispose();
    }

    for (let i = 1; i <= MAX_TEXT_GENERATOR_REFRESH_KEYS + 10; i += 1) {
      rereadTextGeneratorModels(environmentId, ProviderInstanceId.make(`gen-${i}`));
    }

    expect(__textGeneratorsTesting.getRefreshCountEntryCount()).toBe(
      MAX_TEXT_GENERATOR_REFRESH_KEYS,
    );
    expect(__textGeneratorsTesting.readRefreshCount(environmentId, firstId)).toBe(0);
    expect(
      __textGeneratorsTesting.readRefreshCount(
        environmentId,
        ProviderInstanceId.make(`gen-${MAX_TEXT_GENERATOR_REFRESH_KEYS + 10}`),
      ),
    ).toBe(1);
  });
});
