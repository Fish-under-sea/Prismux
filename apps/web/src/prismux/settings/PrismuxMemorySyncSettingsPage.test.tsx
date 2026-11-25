import {
  PrismuxReasoningEffortSlider,
  computeReasoningEffortStopPercent,
  resolveReasoningEffortStopIndexFromPointer,
} from "@prismux/appearance";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@prismux/core-contracts";
import { GTProvider, initializeGT } from "gt-react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    hash,
    ...props
  }: {
    children?: unknown;
    to?: string;
    hash?: string;
    [key: string]: unknown;
  }) => (
    <a
      href={typeof to === "string" ? (hash ? `${to}#${hash}` : to) : undefined}
      data-hash={hash}
      {...props}
    >
      {children as never}
    </a>
  ),
  useNavigate: () => () => Promise.resolve(),
  useLocation: (opts?: {
    select?: (loc: { hash: string; pathname: string; state: Record<string, unknown> }) => unknown;
  }) => {
    const loc = { hash: "", pathname: "/settings/memory", state: {} };
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
      instanceId: "dsh",
      driver: "dsh",
      displayName: "DeepSeek Harness",
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

  it("merges live Prismux providers with canonical brand names and deduplicates aliases", () => {
    const options = buildChiefProviderOptions({
      serverProviders: mockProviders,
      settings: null,
      daemonAvailableProviders: ["claude-code", "codex", "antigravity", "dsh", "opencode"],
    });

    const codexOpt = options.find((o) => o.value === "codex");
    const claudeOpt = options.find((o) => o.value === "claude-code");
    const agyOpt = options.find((o) => o.value === "antigravity");
    const dshOpt = options.find((o) => o.value === "dsh");

    expect(codexOpt?.label).toBe("Codex");
    expect(claudeOpt?.label).toBe("Claude Code");
    expect(agyOpt?.label).toBe("Antigravity");
    expect(dshOpt?.label).toBe("DeepSeek Harness");

    // Ensure no raw lowercase duplicates exist.
    expect(options.filter((o) => o.value === "claude-code")).toHaveLength(1);
    expect(options.some((o) => o.value === "claudeAgent")).toBe(false);
    expect(options.some((o) => o.label === "codex")).toBe(false);

    // Ensure placeholder slugs ("antigravity-default", "default") are filtered out while real & proxy models stay.
    expect(agyOpt?.models.map((m) => m.slug)).toEqual(["gemini-3-pro", "claude-sonnet-4-5"]);
    expect(dshOpt?.models.map((m) => m.slug)).toEqual(["deepseek-r1"]);
    expect(claudeOpt?.models.map((m) => m.slug)).toEqual([
      "claude-opus-5-5",
      "custom-claude-proxy",
    ]);
    expect(claudeOpt?.models[1]?.subtitle).toContain("OpenRouter");
  });

  it("provides built-in fallback providers with DeepSeek Harness and zero oh-my-pi when server catalog is empty", () => {
    const options = buildChiefProviderOptions({
      serverProviders: [],
      settings: null,
    });
    expect(options.map((o) => o.value)).toEqual([...BUILTIN_CHIEF_FALLBACK_PROVIDERS]);
    expect(options.map((o) => o.label)).toEqual([
      "Codex",
      "Claude Code",
      "Antigravity",
      "DeepSeek Harness",
    ]);
    expect(options.some((o) => /oh-my-pi|^omp$/i.test(o.value) || /oh-my-pi/i.test(o.label))).toBe(
      false,
    );
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
    expect(astraSpec.stops.map((s) => s.label)).toEqual([
      "Minimal",
      "Low",
      "Medium",
      "High",
      "XHigh",
    ]);

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

  it("renders Chief tab with single reasoning slider ONLY (no duplicate effort select), identity, AGENTS.md, and denoised copy", () => {
    const html = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <PrismuxMemorySyncSettingsPage
          serverProvidersOverride={mockProviders}
          settingsOverride={null}
          daemonReadyOverride
          initialTabOverride="chief"
        />
      </GTProvider>,
    );

    expect(html).toContain("秘书与记忆");
    expect(html).toContain("data-pmx-chief-provider-select");
    expect(html).toContain("data-pmx-chief-model-select");
    // Single reasoning slider ONLY — duplicate effort <Select> dropdown is deleted!
    expect(html).toContain("data-pmx-chief-effort-slider");
    expect(html).not.toContain("data-pmx-chief-effort-select");
    expect(html).toContain("Codex");
    expect(html).toContain("跟随提供方默认");
    expect(html).not.toContain("可选模型覆盖（留空默认）");

    // Chief custom identity & independent AGENTS.md section
    expect(html).toContain("data-pmx-chief-name-input");
    expect(html).toContain("data-pmx-chief-agents-md-section");
    expect(html).toContain("data-pmx-chief-agents-md-editor");
    expect(html).toContain("~/.prismux/chief/AGENTS.md");
    expect(html).not.toContain("oh-my-pi");
    expect(html).not.toMatch(/magpie/i);
  });

  it("renders /settings/memory across 3 segmented tabs (chief / memory / obsidian) with fixed maintenance#diagnostics link and denoised copy", () => {
    // Tab 1: Chief
    const chiefTabHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <PrismuxMemorySettingsPage
          serverProvidersOverride={mockProviders}
          settingsOverride={null}
          daemonReadyOverride
          initialTabOverride="chief"
        />
      </GTProvider>,
    );
    expect(chiefTabHtml).toContain('id="prismux-memory"');
    expect(chiefTabHtml).toContain("data-pmx-memory-settings-page");
    expect(chiefTabHtml).toContain("主秘书与人设");
    expect(chiefTabHtml).toContain("混合记忆库");
    expect(chiefTabHtml).toContain("Obsidian 迁移");
    expect(chiefTabHtml).toContain("data-pmx-chief-provider-select");
    expect(chiefTabHtml).toContain("data-pmx-chief-effort-slider");
    expect(chiefTabHtml).not.toContain("data-pmx-chief-effort-select");
    expect(chiefTabHtml).toContain("data-pmx-chief-agents-md-editor");
    expect(chiefTabHtml).not.toContain('id="prismux-e2ee-sync"');

    // Tab 2: Memory (compact single-line KPI strip + namespace filter + fixed /settings/maintenance#diagnostics link)
    const memoryTabHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <PrismuxMemorySettingsPage
          serverProvidersOverride={mockProviders}
          settingsOverride={null}
          daemonReadyOverride
          initialTabOverride="memory"
        />
      </GTProvider>,
    );
    expect(memoryTabHtml).toContain('id="prismux-memory-engine"');
    expect(memoryTabHtml).toContain("data-pmx-memory-kpi-strip");
    expect(memoryTabHtml).toContain("data-pmx-memory-ns-filter");
    expect(memoryTabHtml).toContain('href="/settings/maintenance#diagnostics"');
    expect(memoryTabHtml).not.toContain('href="/settings/diagnostics"');
    expect(memoryTabHtml).not.toContain("POST /v1/memory/search");
    expect(memoryTabHtml).not.toContain("vec0.dll");
    expect(memoryTabHtml).not.toContain("_callerScope");

    // Tab 3: Obsidian migration
    const obsidianTabHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <PrismuxMemorySettingsPage
          serverProvidersOverride={mockProviders}
          settingsOverride={null}
          daemonReadyOverride
          initialTabOverride="obsidian"
        />
      </GTProvider>,
    );
    expect(obsidianTabHtml).toContain("data-pmx-obsidian-agent-import");
    expect(obsidianTabHtml).toContain("由主秘书 Agent 智能整理后再入库（推荐）");
    expect(obsidianTabHtml).toContain("Agent 智能扫描与整理");
  });

  it("renders /settings/sync with a single header and 2 segmented tabs (overview & channels) with denoised copy", () => {
    const syncOverviewHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <PrismuxSyncSettingsPage daemonReadyOverride initialTabOverride="overview" />
      </GTProvider>,
    );

    expect(syncOverviewHtml).toContain('id="prismux-sync"');
    expect(syncOverviewHtml).toContain("data-pmx-sync-settings-page");
    expect(syncOverviewHtml).toContain("Prismux 端到端加密同步");
    expect(syncOverviewHtml).toContain("同步概览与策略");
    expect(syncOverviewHtml).toContain("云端通道与密钥");
    expect(syncOverviewHtml).toContain('id="prismux-e2ee-sync"');
    expect(syncOverviewHtml).toContain("data-pmx-sync-upload");
    expect(syncOverviewHtml).toContain("data-pmx-sync-download");
    expect(syncOverviewHtml).toContain("data-pmx-sync-test-all");
    expect(syncOverviewHtml).toContain("data-pmx-sync-now");
    expect(syncOverviewHtml).toContain("data-pmx-sync-matrix-list");
    expect(syncOverviewHtml).not.toContain("Argon2id");
    expect(syncOverviewHtml).not.toContain("AEAD");
    expect(syncOverviewHtml).not.toContain("If-Match");
    expect(syncOverviewHtml).not.toContain('id="prismux-chief-slot"');
    expect(syncOverviewHtml).not.toContain('id="prismux-memory-engine"');
    expect(syncOverviewHtml).not.toMatch(/magpie/i);

    const syncChannelsHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <PrismuxSyncSettingsPage
          daemonReadyOverride
          initialTabOverride="channels"
          initialChannelOverride="github"
        />
      </GTProvider>,
    );
    expect(syncChannelsHtml).toContain('data-pmx-sync-channel-tab="github"');
    expect(syncChannelsHtml).toContain('data-pmx-sync-channel-tab="webdav"');
    expect(syncChannelsHtml).toContain('data-pmx-sync-channel-tab="s3"');
    expect(syncChannelsHtml).toContain('data-pmx-sync-channel="github"');
    expect(syncChannelsHtml).toContain('data-pmx-sync-channel-expanded="false"');
    expect(syncChannelsHtml).toContain("data-pmx-sync-passphrase-input");
    expect(syncChannelsHtml).toContain('id="sync-portable"');
  });

  it("aligns reasoning runner linearly across [0%, 100%] with edge-clamped full-bleed geometry for N=2..7", () => {
    const allLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    for (const count of [2, 3, 4, 5, 6, 7]) {
      const options = allLevels.slice(0, count);
      for (let i = 0; i < count; i += 1) {
        const expectedProgress = i / (count - 1);
        const expectedPercent = expectedProgress * 100;
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
        expect(html).toContain(`--pmx-progress:${expectedProgress}`);
        expect(html).toContain(`--pmx-re-progress:${expectedPercent}%`);
        expect(html).toContain(`--pmx-re-count:${count}`);

        const pointerX = 100 + expectedProgress * 600;
        expect(
          resolveReasoningEffortStopIndexFromPointer(pointerX, { left: 100, width: 600 }, count),
        ).toBe(i);
      }
    }
  });
});
