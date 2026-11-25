import { ProviderDriverKind, ProviderInstanceId } from "@prismux/core-contracts";
import { GTProvider, initializeGT } from "gt-react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import {
  AgentBrandLogo,
  DEVIN_BRAND_COLOR,
  DSH_BRAND_COLOR,
  GLM_BRAND_COLOR,
  KIRO_BRAND_COLOR,
  MINIMAX_BRAND_COLOR,
  MISTRAL_BRAND_COLOR,
  OPENHANDS_BRAND_COLOR,
  QWEN_BRAND_COLOR,
  resolveAcpAgentBrandKey,
  type AcpAgentBrandKey,
} from "../../prismux/agentBrand";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { TooltipProvider } from "../ui/tooltip";
import { ModelPickerSidebar } from "./ModelPickerSidebar";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

const GENERIC_ACP_HEXAGON_VIEWBOX = 'viewBox="0 0 576 220"';
const LEGACY_AGENT_BRAND_HEXAGON_PATH = "M12 2.8L20 7.4V16.6L12 21.2L4 16.6V7.4L12 2.8Z";

beforeAll(() => {
  initializeGT({ defaultLocale: "zh" });
});

describe("resolveAcpAgentBrandKey", () => {
  it("matches every official ACP Registry agent ID, local CLI command path, and display name", () => {
    const cases: ReadonlyArray<{
      readonly input: Parameters<typeof resolveAcpAgentBrandKey>[0];
      readonly expected: AcpAgentBrandKey;
    }> = [
      { input: { agentId: "glm-acp-agent" }, expected: "glm" },
      { input: { displayName: "GLM Agent" }, expected: "glm" },
      {
        input: {
          displayName: "我的代码助手",
          commandPath: "C:\\Users\\Fish\\AppData\\Roaming\\npm\\glm-acp-agent.cmd",
        },
        expected: "glm",
      },
      { input: { displayName: "Zhipu ChatGLM" }, expected: "glm" },
      { input: { agentId: "dsh" }, expected: "dsh" },
      { input: { commandPath: "/usr/local/bin/dsh" }, expected: "dsh" },
      { input: { displayName: "DeepSeek Harness" }, expected: "dsh" },
      { input: { agentId: "antigravity-acp" }, expected: "antigravity" },
      { input: { commandPath: "agy.exe", displayName: "Work Agent" }, expected: "antigravity" },
      { input: { agentId: "claude-acp" }, expected: "claude" },
      { input: { commandPath: "claude-agent-acp.cmd" }, expected: "claude" },
      { input: { agentId: "codex-acp" }, expected: "codex" },
      { input: { agentId: "gemini" }, expected: "gemini" },
      { input: { displayName: "Gemini CLI" }, expected: "gemini" },
      { input: { agentId: "qwen-code" }, expected: "qwen" },
      { input: { instanceId: "acpRegistry:qwen-code" }, expected: "qwen" },
      { input: { agentId: "kimi-code" }, expected: "kimi" },
      { input: { commandPath: "/opt/homebrew/bin/kimi" }, expected: "kimi" },
      { input: { displayName: "Moonshot Kimi" }, expected: "kimi" },
      { input: { agentId: "github-copilot-cli" }, expected: "github-copilot" },
      { input: { commandPath: "copilot.exe" }, expected: "github-copilot" },
      { input: { agentId: "mistral-vibe" }, expected: "mistral-vibe" },
      { input: { commandPath: "vibe-acp" }, expected: "mistral-vibe" },
      { input: { agentId: "opencode" }, expected: "opencode" },
      { input: { agentId: "opencode-v2" }, expected: "opencode" },
      { input: { agentId: "pi-acp" }, expected: "pi" },
      { input: { agentId: "factory-droid" }, expected: "factory-droid" },
      { input: { commandPath: "droid" }, expected: "factory-droid" },
      { input: { agentId: "cline" }, expected: "cline" },
      { input: { agentId: "goose" }, expected: "goose" },
      { input: { agentId: "auggie" }, expected: "auggie" },
      { input: { displayName: "Augment Code" }, expected: "auggie" },
      { input: { agentId: "devin" }, expected: "devin" },
      { input: { agentId: "kiro" }, expected: "kiro" },
      { input: { displayName: "Kiro CLI" }, expected: "kiro" },
      { input: { agentId: "openhands" }, expected: "openhands" },
      { input: { displayName: "OpenHands" }, expected: "openhands" },
      { input: { agentId: "hermes-agent" }, expected: "hermes" },
      { input: { displayName: "Hermes" }, expected: "hermes" },
      { input: { agentId: "minimax-code" }, expected: "minimax" },
      { input: { displayName: "MiniMax" }, expected: "minimax" },
      { input: { agentId: "cursor" }, expected: "cursor" },
      { input: { commandPath: "cursor-agent" }, expected: "cursor" },
      { input: { agentId: "grok-build" }, expected: "grok" },
      { input: { agentId: "kilo" }, expected: "kilo" },
      { input: { agentId: "junie" }, expected: "junie" },
      { input: { agentId: "amp-acp" }, expected: "amp" },
    ];

    for (const { input, expected } of cases) {
      expect(resolveAcpAgentBrandKey(input)).toBe(expected);
    }
  });

  it("avoids false positives on unrelated custom agent names", () => {
    expect(resolveAcpAgentBrandKey({ displayName: "Android Helper" })).toBeNull();
    expect(resolveAcpAgentBrandKey({ displayName: "oh-my-pi" })).toBeNull();
    expect(resolveAcpAgentBrandKey({ displayName: "omp" })).toBeNull();
    expect(resolveAcpAgentBrandKey({ displayName: "Pixel Bot" })).toBeNull();
    expect(resolveAcpAgentBrandKey({ displayName: "Example Agent" })).toBeNull();
    expect(resolveAcpAgentBrandKey({ displayName: "Incline Helper" })).toBeNull();
    expect(
      resolveAcpAgentBrandKey({
        displayName: "DeepSeek Internal",
        instanceId: "acpRegistry:team",
      }),
    ).toBeNull();
    expect(resolveAcpAgentBrandKey({ displayName: "My Custom Agent" })).toBeNull();
  });
});

describe("ProviderInstanceIcon official ACP brand icons", () => {
  const acpDriver = ProviderDriverKind.make("acpRegistry");

  it("renders official Zhipu GLM SVG for registry, local displayName, and renamed local commandPath without hexagon nut", () => {
    const registryGlm = renderToStaticMarkup(
      <ProviderInstanceIcon
        driverKind={acpDriver}
        displayName="GLM Agent"
        acpRegistryAgentId="glm-acp-agent"
      />,
    );
    const localGlmByName = renderToStaticMarkup(
      <ProviderInstanceIcon
        driverKind={acpDriver}
        displayName="GLM Agent"
        instanceId="acpRegistry_048c43c3-0798-480e-bc42-1a2b3c4d5e6f"
      />,
    );
    const localGlmByCmd = renderToStaticMarkup(
      <ProviderInstanceIcon
        driverKind={acpDriver}
        displayName="主力智谱代理"
        acpCommandPath="C:\\Users\\Fish\\AppData\\Roaming\\npm\\glm-acp-agent.cmd"
      />,
    );

    for (const html of [registryGlm, localGlmByName, localGlmByCmd]) {
      expect(html).toContain('data-acp-brand="glm"');
      expect(html).toContain('data-acp-brand-icon="glm"');
      expect(html).toContain(`fill="${GLM_BRAND_COLOR}"`);
      expect(html).not.toContain(GENERIC_ACP_HEXAGON_VIEWBOX);
      expect(html).not.toContain('data-slot="acp-icon-fallback"');
    }
    // Local GLM commands have no CDN URL and must not emit an external <img> request.
    expect(localGlmByName).not.toContain("<img");
    expect(localGlmByCmd).not.toContain("<img");
  });

  it("renders bundled official brand SVGs for every known ACP agent and never falls back to the hexagon nut", () => {
    const agents: ReadonlyArray<{
      readonly displayName: string;
      readonly agentId?: string;
      readonly expectedMarker: string;
      readonly expectedColor?: string;
    }> = [
      {
        displayName: "Kimi Code",
        agentId: "kimi-code",
        expectedMarker: 'data-acp-brand-icon="kimi"',
      },
      {
        displayName: "Qwen Code",
        agentId: "qwen-code",
        expectedMarker: 'data-acp-brand-icon="qwen"',
        expectedColor: QWEN_BRAND_COLOR,
      },
      {
        displayName: "GitHub Copilot",
        agentId: "github-copilot-cli",
        expectedMarker: 'data-acp-brand-icon="github-copilot"',
      },
      {
        displayName: "Claude Agent",
        agentId: "claude-acp",
        expectedMarker: 'data-acp-brand-icon="claude"',
      },
      {
        displayName: "Codex",
        agentId: "codex-acp",
        expectedMarker: 'data-acp-brand-icon="codex"',
      },
      {
        displayName: "Gemini CLI",
        agentId: "gemini",
        expectedMarker: 'data-acp-brand-icon="gemini"',
      },
      {
        displayName: "Mistral Vibe",
        agentId: "mistral-vibe",
        expectedMarker: 'data-acp-brand-icon="mistral-vibe"',
        expectedColor: MISTRAL_BRAND_COLOR,
      },
      {
        displayName: "Factory Droid",
        agentId: "factory-droid",
        expectedMarker: 'data-acp-brand-icon="factory-droid"',
      },
      {
        displayName: "Cline",
        agentId: "cline",
        expectedMarker: 'data-acp-brand-icon="cline"',
      },
      {
        displayName: "goose",
        agentId: "goose",
        expectedMarker: 'data-acp-brand-icon="goose"',
      },
      {
        displayName: "Auggie CLI",
        agentId: "auggie",
        expectedMarker: 'data-acp-brand-icon="auggie"',
      },
      {
        displayName: "Devin",
        agentId: "devin",
        expectedMarker: 'data-acp-brand-icon="devin"',
        expectedColor: DEVIN_BRAND_COLOR,
      },
      {
        displayName: "Kiro CLI",
        agentId: "kiro",
        expectedMarker: 'data-acp-brand-icon="kiro"',
        expectedColor: KIRO_BRAND_COLOR,
      },
      {
        displayName: "OpenHands",
        agentId: "openhands",
        expectedMarker: 'data-acp-brand-icon="openhands"',
        expectedColor: OPENHANDS_BRAND_COLOR,
      },
      {
        displayName: "Hermes Agent",
        agentId: "hermes-agent",
        expectedMarker: 'data-acp-brand-icon="hermes"',
      },
      {
        displayName: "MiniMax Code",
        agentId: "minimax-code",
        expectedMarker: 'data-acp-brand-icon="minimax"',
        expectedColor: MINIMAX_BRAND_COLOR,
      },
      {
        displayName: "OpenCode",
        agentId: "opencode",
        expectedMarker: 'data-acp-brand-icon="opencode"',
      },
      {
        displayName: "pi ACP",
        agentId: "pi-acp",
        expectedMarker: 'data-acp-brand-icon="pi"',
      },
      {
        displayName: "Cursor",
        agentId: "cursor",
        expectedMarker: 'data-acp-brand-icon="cursor"',
      },
      {
        displayName: "DeepSeek Harness",
        agentId: "dsh",
        expectedMarker: 'data-dsh-brand-icon="true"',
        expectedColor: DSH_BRAND_COLOR,
      },
      {
        displayName: "Google Antigravity",
        agentId: "antigravity-acp",
        expectedMarker: "#4285F4",
      },
    ];

    for (const agent of agents) {
      const html = renderToStaticMarkup(
        <ProviderInstanceIcon
          driverKind={acpDriver}
          displayName={agent.displayName}
          acpRegistryAgentId={agent.agentId}
        />,
      );
      expect(html, `expected official icon marker for ${agent.displayName}`).toContain(
        agent.expectedMarker,
      );
      if (agent.expectedColor) {
        expect(html, `expected brand color for ${agent.displayName}`).toContain(
          agent.expectedColor,
        );
      }
      expect(html).not.toContain(GENERIC_ACP_HEXAGON_VIEWBOX);
      expect(html).not.toContain('data-slot="acp-icon-fallback"');
      expect(html).not.toContain(LEGACY_AGENT_BRAND_HEXAGON_PATH);
    }
  });

  it("renders a sleek branded monogram pill instead of the hexagon nut for truly custom unknown ACP agents", () => {
    const html = renderToStaticMarkup(
      <ProviderInstanceIcon
        driverKind={acpDriver}
        displayName="My Custom Agent"
        instanceId="acpRegistry_custom-bot"
      />,
    );

    expect(html).toContain('data-acp-brand="custom"');
    expect(html).toContain('data-slot="acp-icon-monogram"');
    expect(html).toContain('data-acp-brand-monogram="MC"');
    expect(html).toContain(">MC<");
    expect(html).not.toContain(GENERIC_ACP_HEXAGON_VIEWBOX);
    expect(html).not.toContain('data-slot="acp-icon-fallback"');
  });

  it("renders official logos in AgentBrandLogo and ModelPickerSidebar for local GLM and registry ACP agents without hexagon nuts", () => {
    const glmLogoHtml = renderToStaticMarkup(<AgentBrandLogo provider="GLM Agent" size={16} />);
    expect(glmLogoHtml).toContain('data-agent-brand="glm"');
    expect(glmLogoHtml).toContain(`fill="${GLM_BRAND_COLOR}"`);
    expect(glmLogoHtml).not.toContain(LEGACY_AGENT_BRAND_HEXAGON_PATH);

    const customLogoHtml = renderToStaticMarkup(
      <AgentBrandLogo provider="My Local Bot" size={16} />,
    );
    expect(customLogoHtml).toContain('data-agent-brand="custom"');
    expect(customLogoHtml).toContain('data-agent-brand-monogram="ML"');
    expect(customLogoHtml).not.toContain(LEGACY_AGENT_BRAND_HEXAGON_PATH);

    const makeEntry = (
      id: string,
      displayName: string,
      acpRegistryAgentId?: string,
    ): ProviderInstanceEntry => {
      const instanceId = ProviderInstanceId.make(id);
      return {
        instanceId,
        driverKind: acpDriver,
        displayName,
        ...(acpRegistryAgentId ? { acpRegistryAgentId } : {}),
        enabled: true,
        installed: true,
        status: "ready",
        isDefault: false,
        isAvailable: true,
        models: [],
        snapshot: {
          instanceId,
          driver: acpDriver,
          displayName,
          enabled: true,
          installed: true,
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: "2026-11-26T00:00:00.000Z",
          models: [],
          slashCommands: [],
          skills: [],
        } as unknown as ProviderInstanceEntry["snapshot"],
      };
    };

    const entries = [
      makeEntry("local-glm", "GLM Agent"),
      makeEntry("kimi-inst", "Kimi Code", "kimi-code"),
      makeEntry("acme-inst", "Acme Bot"),
    ];

    const sidebarHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <TooltipProvider>
          <ModelPickerSidebar
            selectedInstanceId={entries[0]!.instanceId}
            onSelectInstance={vi.fn()}
            onFocusSearch={vi.fn()}
            instanceEntries={entries}
          />
        </TooltipProvider>
      </GTProvider>,
    );

    expect(sidebarHtml).toContain('data-acp-brand-icon="glm"');
    expect(sidebarHtml).toContain('data-acp-brand-icon="kimi"');
    expect(sidebarHtml).toContain('data-acp-brand-monogram="AB"');
    expect(sidebarHtml).not.toContain(GENERIC_ACP_HEXAGON_VIEWBOX);
    expect(sidebarHtml).not.toContain('data-slot="acp-icon-fallback"');
  });
});
