import {
  PrismuxReasoningEffortSlider,
  computeReasoningEffortStopPercent,
  resolveReasoningEffortStopIndexFromPointer,
} from "@prismux/appearance";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { GTProvider, initializeGT } from "gt-react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children?: unknown; [key: string]: unknown }) => (
    <a {...props}>{children as never}</a>
  ),
  useNavigate: () => () => Promise.resolve(),
  useLocation: (opts?: { select?: (loc: { hash: string; pathname: string; state: Record<string, unknown> }) => unknown }) => {
    const loc = { hash: "", pathname: "/settings/memory-sync", state: {} };
    return opts?.select ? opts.select(loc) : loc;
  },
}));

import {
  BUILTIN_CHIEF_FALLBACK_PROVIDERS,
  PrismuxMemorySettingsPage,
  PrismuxMemorySyncSettingsPage,
  buildChiefModelDropdownItems,
  buildChiefProviderOptions,
  reconcileChiefSelectionOnProviderChange,
  resolveChiefEffortSpec,
} from "./PrismuxMemorySyncSettingsPage";
import { PrismuxSyncSettingsPage } from "./PrismuxSyncSettingsPage";

function makeMockProvider(input: {
  instanceId: string;
  driver: string;
  displayName?: string;
  enabled?: boolean;
  models: ServerProvider["models"];
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver),
    ...(input.displayName ? { displayName: input.displayName } : {}),
    enabled: input.enabled ?? true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-23T00:00:00.000Z",
    models: input.models,
    slashCommands: [],
    skills: [],
  } as unknown as ServerProvider;
}

describe("PrismuxMemorySyncSettingsPage Chief Thread Slot logic & rendering", () => {
  beforeAll(async () => {
    await initializeGT({
      defaultLocale: "zh",
      locales: ["en", "zh"],
      loadTranslations: async () => ({}),
      cacheExpiryTime: null,
    });
  });

  const mockProviders: ServerProvider[] = [
    makeMockProvider({
      instanceId: "codex",
      driver: "codex",
      displayName: "codex",
      models: [
        {
          slug: "gpt-6-astra",
          name: "GPT-6 Astra",
          isCustom: false,
          isDefault: true,
          capabilities: {
            optionDescriptors: [
              {
                type: "select",
                id: "reasoningEffort",
                label: "Reasoning effort",
                options: [
                  { id: "minimal", label: "Minimal" },
                  { id: "low", label: "Low" },
                  { id: "medium", label: "Medium", isDefault: true },
                  { id: "high", label: "High" },
                  { id: "xhigh", label: "Extra High" },
                ],
              },
            ],
          },
        } as ServerProvider["models"][number],
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
        } as ServerProvider["models"][number],
      ],
    }),
    makeMockProvider({
      instanceId: "claudeAgent",
      driver: "claudeAgent",
      displayName: "Claude",
      models: [
        {
          slug: "claude-opus-5-5",
          name: "Claude Opus 5.5",
          isCustom: false,
          isDefault: true,
        } as ServerProvider["models"][number],
        {
          slug: "custom-claude-proxy",
          name: "Claude Proxy",
          subProvider: "OpenRouter",
          isCustom: true,
        } as ServerProvider["models"][number],
      ],
    }),
    makeMockProvider({
      instanceId: "antigravity",
      driver: "antigravity",
      models: [
        {
          slug: "antigravity-default",
          name: "Default",
          isCustom: false,
          isDefault: true,
        } as ServerProvider["models"][number],
        {
          slug: "gemini-3-pro",
          name: "Gemini 3 Pro",
          isCustom: false,
        } as ServerProvider["models"][number],
        {
          slug: "claude-sonnet-4-5",
          name: "Claude Sonnet 4.5",
          subProvider: "Anthropic",
          isCustom: false,
        } as ServerProvider["models"][number],
      ],
    }),
    makeMockProvider({
      instanceId: "pi",
      driver: "pi",
      displayName: "Pi",
      models: [
        {
          slug: "default",
          name: "Default",
          isCustom: false,
          isDefault: true,
        } as ServerProvider["models"][number],
        {
          slug: "deepseek-r1",
          name: "DeepSeek R1",
          isCustom: false,
        } as ServerProvider["models"][number],
      ],
    }),
  ];

  it("merges live T3 Code providers with canonical brand names and deduplicates aliases", () => {
    const options = buildChiefProviderOptions({
      serverProviders: mockProviders,
      settings: null,
      daemonAvailableProviders: ["claude-code", "codex", "antigravity", "omp", "opencode"],
    });

    const codexOpt = options.find((o) => o.value === "codex");
    const claudeOpt = options.find((o) => o.value === "claude-code");
    const agyOpt = options.find((o) => o.value === "antigravity");
    const ompOpt = options.find((o) => o.value === "omp");

    expect(codexOpt?.label).toBe("Codex");
    expect(claudeOpt?.label).toBe("Claude Code");
    expect(agyOpt?.label).toBe("Antigravity");
    expect(ompOpt?.label).toBe("oh-my-pi");

    // Ensure no raw lowercase duplicates exist.
    expect(options.filter((o) => o.value === "claude-code")).toHaveLength(1);
    expect(options.some((o) => o.value === "claudeAgent")).toBe(false);
    expect(options.some((o) => o.label === "codex")).toBe(false);

    // Ensure placeholder slugs ("antigravity-default", "default") are filtered out while real & proxy models stay.
    expect(agyOpt?.models.map((m) => m.slug)).toEqual(["gemini-3-pro", "claude-sonnet-4-5"]);
    expect(ompOpt?.models.map((m) => m.slug)).toEqual(["deepseek-r1"]);
    expect(claudeOpt?.models.map((m) => m.slug)).toEqual([
      "claude-opus-5-5",
      "custom-claude-proxy",
    ]);
    expect(claudeOpt?.models[1]?.subtitle).toContain("OpenRouter");
  });

  it("provides built-in fallback providers when server catalog is empty", () => {
    const options = buildChiefProviderOptions({
      serverProviders: [],
      settings: null,
    });
    expect(options.map((o) => o.value)).toEqual([...BUILTIN_CHIEF_FALLBACK_PROVIDERS]);
    expect(options.map((o) => o.label)).toEqual([
      "Codex",
      "Claude Code",
      "Antigravity",
      "oh-my-pi",
    ]);
  });

  it("preserves a compatibility fallback model item when a saved custom model is absent from the catalog", () => {
    const options = buildChiefProviderOptions({
      serverProviders: mockProviders,
      settings: null,
    });
    const codexOpt = options.find((o) => o.value === "codex");
    const items = buildChiefModelDropdownItems({
      providerOption: codexOpt,
      selectedModel: "legacy-custom-gpt-4.9",
    });

    expect(items[0]?.slug).toBe("legacy-custom-gpt-4.9");
    expect(items[0]?.label).toBe("当前配置：legacy-custom-gpt-4.9");
    expect(items[0]?.isCompatibilityFallback).toBe(true);
    expect(items.slice(1).map((m) => m.slug)).toEqual(["gpt-6-astra", "gpt-5.4"]);
  });

  it("resolves model-aware reasoning effort stops from capabilities and family presets", () => {
    const options = buildChiefProviderOptions({
      serverProviders: mockProviders,
      settings: null,
    });
    const codexOpt = options.find((o) => o.value === "codex")!;
    const astraModel = codexOpt.models.find((m) => m.slug === "gpt-6-astra");

    // Uses explicit model capabilities when present.
    const astraSpec = resolveChiefEffortSpec({
      provider: "codex",
      modelSlug: "gpt-6-astra",
      modelOption: astraModel,
    });
    expect(astraSpec.source).toBe("model-capabilities");
    expect(astraSpec.stops.map((s) => s.value)).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    // Effort labels must use unambiguous English terms rather than localized Chinese tiers.
    expect(astraSpec.stops.map((s) => s.label)).toEqual([
      "Minimal",
      "Low",
      "Medium",
      "High",
      "XHigh",
    ]);

    // Falls back to OpenAI/Codex family preset when model has no explicit descriptor.
    const codexDefaultSpec = resolveChiefEffortSpec({
      provider: "codex",
      modelSlug: "",
    });
    expect(codexDefaultSpec.source).toBe("model-family-preset");
    expect(codexDefaultSpec.stops.map((s) => s.value)).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(codexDefaultSpec.stops.map((s) => s.label)).toEqual([
      "Minimal",
      "Low",
      "Medium",
      "High",
      "XHigh",
      "Max",
    ]);

    // Claude Code family preset includes ultracode with English stop labels.
    const claudeSpec = resolveChiefEffortSpec({
      provider: "claude-code",
      modelSlug: "claude-opus-5-5",
    });
    expect(claudeSpec.familyId).toBe("claude");
    expect(claudeSpec.stops.map((s) => s.value)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultracode",
    ]);
    expect(claudeSpec.stops.map((s) => s.label)).toEqual([
      "Low",
      "Medium",
      "High",
      "XHigh",
      "Max",
      "Ultracode",
    ]);

    // Multi-model gateway (Antigravity running Claude model) detects Claude model-first.
    const gatewayClaudeSpec = resolveChiefEffortSpec({
      provider: "antigravity",
      modelSlug: "claude-sonnet-4-5",
    });
    expect(gatewayClaudeSpec.familyId).toBe("claude");
    expect(gatewayClaudeSpec.stops.some((s) => s.value === "ultracode")).toBe(true);
  });

  it("reconciles model and reasoning effort automatically when switching providers", () => {
    const options = buildChiefProviderOptions({
      serverProviders: mockProviders,
      settings: null,
    });

    // Switching Codex (gpt-5.4 + minimal) -> Claude Code resets incompatible model and effort ("minimal" is not in Claude stops).
    const toClaude = reconcileChiefSelectionOnProviderChange({
      nextProviderRaw: "claudeAgent",
      providerOptions: options,
      currentModel: "gpt-5.4",
      currentEffort: "minimal",
    });
    expect(toClaude).toEqual({
      provider: "claude-code",
      model: "",
      reasoningEffort: "",
    });

    // Switching Codex (gpt-5.4 + high) -> Claude Code resets model, keeps shared valid effort ("high").
    const toClaudeKeepEffort = reconcileChiefSelectionOnProviderChange({
      nextProviderRaw: "claude-code",
      providerOptions: options,
      currentModel: "gpt-5.4",
      currentEffort: "high",
    });
    expect(toClaudeKeepEffort).toEqual({
      provider: "claude-code",
      model: "",
      reasoningEffort: "high",
    });

    // Switching to Antigravity when current model exists in Antigravity keeps both model and effort.
    const toAgySharedModel = reconcileChiefSelectionOnProviderChange({
      nextProviderRaw: "antigravity",
      providerOptions: options,
      currentModel: "claude-sonnet-4-5",
      currentEffort: "ultracode",
    });
    expect(toAgySharedModel).toEqual({
      provider: "antigravity",
      model: "claude-sonnet-4-5",
      reasoningEffort: "ultracode",
    });
  });

  it("renders canonical Chief controls, custom identity + independent AGENTS.md, Obsidian Agent curation card, and Prismux E2EE Sync brand", () => {
    const html = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <PrismuxMemorySyncSettingsPage
          serverProvidersOverride={mockProviders}
          settingsOverride={null}
          daemonReadyOverride
        />
      </GTProvider>,
    );

    expect(html).toContain("data-pmx-chief-provider-select");
    expect(html).toContain("data-pmx-chief-model-select");
    expect(html).toContain("data-pmx-chief-effort-select");
    expect(html).toContain("data-pmx-chief-effort-slider");
    expect(html).toContain("Codex");
    expect(html).toContain("跟随该提供方默认模型（留空）");
    expect(html).toContain("跟随提供方默认");
    expect(html).not.toContain("可选模型覆盖（留空默认）");

    // 1. Chief custom identity & independent AGENTS.md section
    expect(html).toContain("data-pmx-chief-name-input");
    expect(html).toContain("data-pmx-chief-agents-md-section");
    expect(html).toContain("data-pmx-chief-agents-md-editor");
    expect(html).toContain("~/.prismux/chief/AGENTS.md");
    expect(html).toContain("切换任意底层引擎不重置");

    // 2. Obsidian Agent-curated migration card (default Agent curation enabled)
    expect(html).toContain("data-pmx-obsidian-agent-import");
    expect(html).toContain("由主秘书 Agent 智能整理后再入库（推荐）");
    expect(html).toContain("Agent 智能扫描与整理");

    // 3. Brand rename: Prismux E2EE Sync with zero user-facing Magpie mentions
    expect(html).toContain("Prismux 端到端加密同步");
    expect(html).toContain("Prismux 端到端加密同步（Argon2id + AEAD）");
    expect(html).not.toMatch(/magpie/i);
  });

  it("cleanly splits /settings/memory (Chief + AGENTS.md + SQLite + Obsidian) and /settings/sync (E2EE Sync + collapsible channels)", () => {
    const memoryHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <PrismuxMemorySettingsPage
          serverProvidersOverride={mockProviders}
          settingsOverride={null}
          daemonReadyOverride
        />
      </GTProvider>,
    );

    expect(memoryHtml).toContain('id="prismux-memory"');
    expect(memoryHtml).toContain("data-pmx-memory-settings-page");
    expect(memoryHtml).toContain("data-pmx-chief-provider-select");
    expect(memoryHtml).toContain("data-pmx-chief-agents-md-editor");
    expect(memoryHtml).toContain('id="prismux-memory-engine"');
    expect(memoryHtml).toContain("data-pmx-obsidian-agent-import");
    // Sync section must NOT be rendered on /settings/memory
    expect(memoryHtml).not.toContain('id="prismux-e2ee-sync"');
    expect(memoryHtml).not.toContain('data-pmx-sync-channel="webdav"');

    const syncHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <PrismuxSyncSettingsPage daemonReadyOverride />
      </GTProvider>,
    );

    expect(syncHtml).toContain('id="prismux-sync"');
    expect(syncHtml).toContain("data-pmx-sync-settings-page");
    expect(syncHtml).toContain('id="prismux-e2ee-sync"');
    expect(syncHtml).toContain("Prismux 端到端加密同步（Argon2id + AEAD）");
    expect(syncHtml).toContain('data-pmx-sync-channel="webdav"');
    expect(syncHtml).toContain('data-pmx-sync-channel="s3"');
    expect(syncHtml).toContain('data-pmx-sync-channel="github"');
    expect(syncHtml).toContain('data-pmx-sync-channel-expanded="false"');
    expect(syncHtml).toContain("同步域矩阵（Upload / Download 独立控制）");
    // Chief / Memory sections must NOT be rendered on /settings/sync
    expect(syncHtml).not.toContain('id="prismux-chief-slot"');
    expect(syncHtml).not.toContain('id="prismux-memory-engine"');
    expect(syncHtml).not.toContain("data-pmx-chief-agents-md-editor");
    expect(syncHtml).not.toMatch(/magpie/i);
  });

  it("centers dsh-fish reasoning runner at ((i + 0.5) / N) * 100% and aligns pointer hit cells for N=2..7", () => {
    const allLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    for (const count of [2, 3, 4, 5, 6, 7]) {
      const options = allLevels.slice(0, count);
      for (let i = 0; i < count; i += 1) {
        const expectedPercent = ((i + 0.5) / count) * 100;
        expect(computeReasoningEffortStopPercent(i, count)).toBeCloseTo(expectedPercent, 9);

        const html = renderToStaticMarkup(
          <PrismuxReasoningEffortSlider
            modelId="gemini-2.5-pro"
            provider="antigravity"
            options={options}
            value={options[i]}
            showStops
            showRunner
            compact
          />,
        );
        expect(html).toContain(`--pmx-re-progress:${expectedPercent}%`);
        expect(html).toContain(`--pmx-re-count:${count}`);

        const cellCenterX = 100 + ((i + 0.5) / count) * 600;
        expect(
          resolveReasoningEffortStopIndexFromPointer(cellCenterX, { left: 100, width: 600 }, count),
        ).toBe(i);
      }
    }
  });
});
