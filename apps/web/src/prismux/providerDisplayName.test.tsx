import {
  DEFAULT_UNIFIED_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@prismux/core-contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  PRISMUX_AGENT_CLI_CATALOG,
  buildContinueInTerminalCommand,
  resolveAgentCliMeta,
} from "../components/settings/prismuxProviderMeta";
import { getProviderUpdateSidebarPillView } from "../components/ProviderUpdateLaunchNotification.logic";
import {
  PROVIDER_PRESENTATION,
  resolveUsageProviderDisplay,
  resolveUsageProviderLabel,
} from "../components/usage/usageProviders";
import { providerInstanceEntriesFor, type ProviderInstanceEntry } from "../providerInstances";
import { AntigravityControlledLockSection } from "./AntigravityControlledLockSection";
import { AgyWelcomeGreeting } from "./AgyWelcomeHero";
import {
  CANONICAL_PROVIDER_DISPLAY_NAMES,
  formatAgentBrandName,
  getCanonicalProviderDisplayName,
} from "./agentBrand";
import {
  formatConfiguredProviderList,
  resolveConfiguredProviderDisplayName,
} from "./providerDisplayName";
import { PluginCreatorGuideModal } from "./settings/plugins/PluginCreatorGuideModal";
import { ResourcesStatusPopover } from "./statusBar/ResourcesStatusPopover";
import { aggregateQuotaSummary } from "./statusBar/quotaStatus.logic";
import {
  canonicalProviderDisplayName,
  collectStatusBarUsageSummary,
} from "./statusBar/statusBarUsage";
import { SubscriptionRiskWaiverSection } from "./SubscriptionRiskWaiverSection";

function makeServerProvider(input: {
  readonly instanceId: string;
  readonly driver: string;
  readonly displayName?: string;
  readonly enabled?: boolean;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver),
    displayName: input.displayName,
    enabled: input.enabled ?? true,
    installed: true,
    status: "ready",
    availability: "available",
    checkedAt: "2026-11-27T00:00:00.000Z",
    auth: { status: "authenticated" },
    models: [],
    usageLimits: {
      checkedAt: "2026-11-27T00:00:00.000Z",
      windows: [{ id: "5h", kind: "session", label: "5h", usedPercent: 40 }],
    },
  } as unknown as ServerProvider;
}

describe("Single Source of Truth provider display names (CANONICAL_PROVIDER_DISPLAY_NAMES)", () => {
  it("uses canonical default names across agentBrand, CLI meta, usage, and statusBar (Claude without Code)", () => {
    expect(CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent).toBe("Claude");
    expect(CANONICAL_PROVIDER_DISPLAY_NAMES["claude-code"]).toBe("Claude");
    expect(CANONICAL_PROVIDER_DISPLAY_NAMES.claude).toBe("Claude");
    expect(CANONICAL_PROVIDER_DISPLAY_NAMES.codex).toBe("Codex");
    expect(CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity).toBe("Antigravity");
    expect(CANONICAL_PROVIDER_DISPLAY_NAMES.opencode).toBe("OpenCode");
    expect(CANONICAL_PROVIDER_DISPLAY_NAMES.pi).toBe("Pi");
    expect(CANONICAL_PROVIDER_DISPLAY_NAMES.cursor).toBe("Cursor");
    expect(CANONICAL_PROVIDER_DISPLAY_NAMES.dsh).toBe("DeepSeek Harness");

    // Agent brand & alias formatting
    expect(formatAgentBrandName("claude")).toBe("Claude");
    expect(formatAgentBrandName("claudeAgent")).toBe("Claude");
    expect(formatAgentBrandName("claude-code")).toBe("Claude");
    expect(formatAgentBrandName("claudeCode")).toBe("Claude");
    expect(formatAgentBrandName("claudeAgent", "Claude Code")).toBe("Claude");
    expect(getCanonicalProviderDisplayName("codex")).toBe("Codex");
    expect(getCanonicalProviderDisplayName("antigravity")).toBe("Antigravity");
    expect(getCanonicalProviderDisplayName("opencode")).toBe("OpenCode");
    expect(getCanonicalProviderDisplayName("pi")).toBe("Pi");

    // CLI catalog & continue-in-terminal metadata
    expect(PRISMUX_AGENT_CLI_CATALOG.claudeAgent?.displayName).toBe("Claude");
    expect(PRISMUX_AGENT_CLI_CATALOG.claude?.displayName).toBe("Claude");
    expect(resolveAgentCliMeta({ driver: "claudeAgent" })?.displayName).toBe("Claude");
    expect(buildContinueInTerminalCommand({ driver: "claudeAgent" }).label).toBe("Claude");

    // Usage presentation & resolver
    expect(PROVIDER_PRESENTATION.claude.label).toBe("Claude");
    expect(resolveUsageProviderLabel("claude")).toBe("Claude");
    expect(resolveUsageProviderLabel("codex")).toBe("Codex");
    expect(resolveUsageProviderLabel("antigravity")).toBe("Antigravity");
    expect(resolveUsageProviderLabel("opencode")).toBe("OpenCode");
    expect(resolveUsageProviderLabel("pi")).toBe("Pi");

    // Status bar canonical helper
    expect(canonicalProviderDisplayName(undefined, "claudeAgent")).toBe("Claude");
    expect(canonicalProviderDisplayName("Claude Code", "claudeAgent")).toBe("Claude");
    expect(canonicalProviderDisplayName("Claude", "claudeAgent")).toBe("Claude");
    expect(canonicalProviderDisplayName(undefined, "codex")).toBe("Codex");
  });

  it("prioritizes configured providerInstances displayName across resolver, Usage, StatusBar, Quota, CLI meta, and Resources", () => {
    const claudeId = ProviderInstanceId.make("claudeAgent");
    const codexId = ProviderInstanceId.make("codex");
    const agyId = ProviderInstanceId.make("antigravity");
    const openCodeId = ProviderInstanceId.make("opencode");
    const dshId = ProviderInstanceId.make("acp_dsh_local");

    const providers: ReadonlyArray<ServerProvider> = [
      makeServerProvider({ instanceId: claudeId, driver: "claudeAgent", displayName: "Claude" }),
      makeServerProvider({ instanceId: codexId, driver: "codex", displayName: "Codex" }),
      makeServerProvider({ instanceId: agyId, driver: "antigravity", displayName: "Antigravity" }),
      makeServerProvider({ instanceId: openCodeId, driver: "opencode", displayName: "OpenCode" }),
      makeServerProvider({
        instanceId: dshId,
        driver: "acpRegistry",
        displayName: "DeepSeek Harness",
      }),
    ];

    const settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerOrder: [claudeId, codexId, agyId, openCodeId, dshId],
      providerInstances: {
        [claudeId]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: true,
          displayName: "主力 Claude",
        },
        [codexId]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          displayName: "企业 Codex",
        },
        [agyId]: {
          driver: ProviderDriverKind.make("antigravity"),
          enabled: true,
          displayName: "指挥官 AGY",
        },
        [openCodeId]: {
          driver: ProviderDriverKind.make("opencode"),
          enabled: true,
          displayName: "极速 OpenCode",
        },
        [dshId]: {
          driver: ProviderDriverKind.make("acpRegistry"),
          enabled: true,
          displayName: "本地深求",
          config: { source: "local", commandPath: "C:\\bin\\dsh.exe" },
        },
      },
      projectSettingsOverrides: {},
    };

    const entries: ReadonlyArray<ProviderInstanceEntry> = providerInstanceEntriesFor(
      providers,
      settings,
      null,
    );

    // 1. Unified resolver (from entries, snapshots + settings, and settings-only)
    expect(
      resolveConfiguredProviderDisplayName({
        provider: "claude-code",
        providerInstances: entries,
      }),
    ).toBe("主力 Claude");
    expect(
      resolveConfiguredProviderDisplayName({
        driverKind: "codex",
        providers,
        settings,
      }),
    ).toBe("企业 Codex");
    expect(
      resolveConfiguredProviderDisplayName({
        instanceId: claudeId,
        settings,
      }),
    ).toBe("主力 Claude");
    expect(
      resolveConfiguredProviderDisplayName({
        provider: "dsh",
        providerInstances: entries,
      }),
    ).toBe("本地深求");
    expect(
      formatConfiguredProviderList(["codex", "claudeAgent", "opencode"], {
        providerInstances: entries,
      }),
    ).toBe("企业 Codex / 主力 Claude / 极速 OpenCode");

    // 2. Usage consumers
    expect(resolveUsageProviderDisplay("claude", entries).label).toBe("主力 Claude");
    expect(resolveUsageProviderDisplay("codex", entries).label).toBe("企业 Codex");
    expect(resolveUsageProviderDisplay("antigravity", entries).label).toBe("指挥官 AGY");
    expect(resolveUsageProviderDisplay("dsh", entries).label).toBe("本地深求");

    // 3. Status bar usage & quota consumers
    const fixedNow = Date.parse("2026-11-27T08:00:00Z");
    const statusBarSummary = collectStatusBarUsageSummary(
      providers,
      fixedNow,
      null,
      undefined,
      null,
      { entries, providerOrder: settings.providerOrder },
    );
    expect(statusBarSummary.windows.map((win) => win.providerName)).toContain("主力 Claude");
    expect(statusBarSummary.windows.map((win) => win.providerName)).toContain("企业 Codex");
    expect(statusBarSummary.antigravityEntries[0]?.providerName).toBe("指挥官 AGY");

    const quotaSummary = aggregateQuotaSummary(null, providers, fixedNow, null, {
      entries,
      providerOrder: settings.providerOrder,
    });
    expect(quotaSummary.agents.map((agent) => agent.displayName)).toContain("主力 Claude");
    expect(quotaSummary.agents.map((agent) => agent.displayName)).toContain("企业 Codex");

    // 4. Continue-in-terminal metadata
    expect(
      buildContinueInTerminalCommand({
        driver: "claudeAgent",
        instanceId: claudeId,
        providerInstances: entries,
      }).label,
    ).toBe("主力 Claude");

    // 5. ResourcesStatusPopover resolves agent process labels via configured provider names
    const resourcesHtml = renderToStaticMarkup(
      <ResourcesStatusPopover
        raw={{
          ok: true,
          processes: [
            {
              pid: 2101,
              name: "Claude",
              processName: "claude.exe",
              role: "agent",
              category: "agent",
              cpuPercent: 1.5,
              memoryBytes: 64 * 1024 * 1024,
            },
          ],
          workspaces: [],
        }}
        loading={false}
        error={null}
        daemonReady={true}
        configuredProviderEntries={entries}
        onRefresh={async () => {}}
        onKillPty={async (sessionId) => ({ ok: true, sessionId })}
      />,
    );
    expect(resourcesHtml).toContain("主力 Claude");
    expect(resourcesHtml).not.toContain("Claude Code");
  });

  it("renders configured provider display names in Security, Welcome Hero, and Plugin Creator UI surfaces without hardcoded Claude Code", () => {
    const claudeId = ProviderInstanceId.make("claudeAgent");
    const codexId = ProviderInstanceId.make("codex");
    const openCodeId = ProviderInstanceId.make("opencode");
    const providers: ReadonlyArray<ServerProvider> = [
      makeServerProvider({ instanceId: claudeId, driver: "claudeAgent" }),
      makeServerProvider({ instanceId: codexId, driver: "codex" }),
      makeServerProvider({ instanceId: openCodeId, driver: "opencode" }),
    ];
    const settings = {
      providerOrder: [codexId, claudeId, openCodeId],
      providerInstances: {
        [claudeId]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: true,
          displayName: "主力 Claude",
        },
        [codexId]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          displayName: "企业 Codex",
        },
        [openCodeId]: {
          driver: ProviderDriverKind.make("opencode"),
          enabled: true,
          displayName: "轻快 OpenCode",
        },
      },
      projectSettingsOverrides: {},
    };
    const mockDaemon = {
      requestJson: vi.fn(async () => ({})) as never,
    };

    // 1. SubscriptionRiskWaiverSection renders custom configured names in Switch B & description
    const waiverHtml = renderToStaticMarkup(
      <SubscriptionRiskWaiverSection
        daemon={mockDaemon}
        serverProvidersOverride={providers}
        settingsOverride={settings}
      />,
    );
    expect(waiverHtml).toContain(
      "允许将官方个人订阅态外部 Agent（企业 Codex / 主力 Claude 等）拉入蜂群与跨代理指挥",
    );
    expect(waiverHtml).not.toContain("Claude Code");

    // 2. AntigravityControlledLockSection renders configured names instead of hardcoded Claude Code
    const lockHtml = renderToStaticMarkup(
      <AntigravityControlledLockSection
        daemon={mockDaemon}
        serverProvidersOverride={providers}
        settingsOverride={settings}
      />,
    );
    expect(lockHtml).toContain("企业 Codex / 主力 Claude / 轻快 OpenCode");
    expect(lockHtml).not.toContain("Claude Code");

    // 3. AgyWelcomeGreeting uses canonical/configured label for aria-label (never raw "claude-code")
    const defaultHeroHtml = renderToStaticMarkup(
      <AgyWelcomeGreeting
        userName="Fish"
        provider="claudeAgent"
        locale="zh"
        initialDate={new Date(2026, 5, 1, 10, 0)}
        rng={() => 0.5}
      />,
    );
    expect(defaultHeroHtml).toContain('aria-label="Claude"');
    expect(defaultHeroHtml).not.toContain('aria-label="claude-code"');

    const customHeroHtml = renderToStaticMarkup(
      <AgyWelcomeGreeting
        userName="Fish"
        provider="claudeAgent"
        providerDisplayName="主力 Claude"
        locale="zh"
        initialDate={new Date(2026, 5, 1, 10, 0)}
        rng={() => 0.5}
      />,
    );
    expect(customHeroHtml).toContain('aria-label="主力 Claude"');

    // 4. PluginCreatorGuideModal uses canonical default list without hardcoded Claude Code
    const modalHtml = renderToStaticMarkup(
      <PluginCreatorGuideModal open={true} onClose={() => undefined} />,
    );
    expect(modalHtml).toContain("Codex / Claude / Antigravity");
    expect(modalHtml).not.toContain("Claude Code");

    // 5. Provider update sidebar pill uses configured displayName when present
    const updatePill = getProviderUpdateSidebarPillView([
      {
        ...makeServerProvider({
          instanceId: claudeId,
          driver: "claudeAgent",
          displayName: "主力 Claude",
        }),
        updateState: {
          status: "running",
          message: "Updating provider.",
          startedAt: "2026-11-27T00:00:00.000Z",
          finishedAt: null,
        },
      } as unknown as ServerProvider,
    ]);
    expect(updatePill?.title).toContain("主力 Claude");
  });
});
