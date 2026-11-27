import { ProviderDriverKind } from "@prismux/core-contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceIcon, providerLogoColor } from "../components/chat/ProviderInstanceIcon";
import { AntigravityIcon, DshIcon, PiIcon } from "../components/Icons";
import { TooltipProvider } from "../components/ui/tooltip";
import {
  AGENT_BRAND_BREATHE_CSS,
  AgentBrandLogo,
  DSH_BRAND_COLOR,
  DSH_FISH_LOGO_VIEWBOX,
  PI_LOGO_DOT_PATH,
  PI_LOGO_FRAME_PATH,
  PI_LOGO_VIEWBOX,
  containsUuidNoise,
  formatAgentBrandName,
  getAgentBrandMeta,
  resolveAgentBrandId,
  resolveProviderEntryDisplayName,
  stripUuidNoise,
  toCanonicalChiefProviderId,
} from "./agentBrand";
import { PrismuxChiefStatusPill } from "./PrismuxChiefStatusPill";

describe("agentBrand canonical naming & official logos", () => {
  it("formats all mainstream Agent IDs and aliases into authoritative brand names", () => {
    expect(formatAgentBrandName("codex")).toBe("Codex");
    expect(formatAgentBrandName("openai-codex")).toBe("Codex");
    expect(formatAgentBrandName("CODEX")).toBe("Codex");

    expect(formatAgentBrandName("claude")).toBe("Claude Code");
    expect(formatAgentBrandName("claudeAgent")).toBe("Claude Code");
    expect(formatAgentBrandName("claude-code")).toBe("Claude Code");
    expect(formatAgentBrandName("claudeCode")).toBe("Claude Code");

    expect(formatAgentBrandName("antigravity")).toBe("Antigravity");
    expect(formatAgentBrandName("antigravity-cli")).toBe("Antigravity");
    expect(formatAgentBrandName("agy")).toBe("Antigravity");

    expect(formatAgentBrandName("dsh")).toBe("DeepSeek Harness");
    expect(formatAgentBrandName("deepseek-harness")).toBe("DeepSeek Harness");

    expect(formatAgentBrandName("gemini")).toBe("Gemini CLI");
    expect(formatAgentBrandName("gemini-cli")).toBe("Gemini CLI");

    expect(formatAgentBrandName("opencode")).toBe("OpenCode");
    expect(formatAgentBrandName("cursor")).toBe("Cursor");
  });

  it("preserves user custom display names while Title-Casing raw unknown ACP IDs", () => {
    expect(formatAgentBrandName("acpRegistry:team", "DeepSeek Internal")).toBe("DeepSeek Internal");
    expect(formatAgentBrandName("claudeAgent", "Claude")).toBe("Claude Code");
    expect(formatAgentBrandName("my-custom-acp")).toBe("My Custom ACP");
    expect(formatAgentBrandName("acmeCodeAgent")).toBe("Acme Code Agent");
    expect(formatAgentBrandName("  ")).toBe("Agent");
  });

  it("scrubs UUID instance IDs and humanized UUID strings while preserving user custom renames", () => {
    expect(formatAgentBrandName("codex_048c43c3-0798-480e-bc42-1a2b3c4d5e6f")).toBe("Codex");
    expect(formatAgentBrandName("codex-048c43c3-0798-480e-bc42-1a2b3c4d5e6f")).toBe("Codex");
    expect(formatAgentBrandName("codex", "Codex 048c43c3 0798 480e Bc42 1...")).toBe("Codex");
    expect(formatAgentBrandName("claudeAgent_048c43c3-0798-480e-bc42-1a2b3c4d5e6f")).toBe(
      "Claude Code",
    );
    expect(formatAgentBrandName("048c43c3-0798-480e-bc42-1a2b3c4d5e6f")).toBe("Agent");
    expect(formatAgentBrandName("codex", "主力 Codex")).toBe("主力 Codex");
    expect(formatAgentBrandName("codex", "Codex (2)")).toBe("Codex (2)");
    expect(
      resolveProviderEntryDisplayName({
        driverKind: "codex",
        instanceId: "codex_048c43c3-0798-480e-bc42-1a2b3c4d5e6f",
        displayName: "工作 Codex",
      }),
    ).toBe("工作 Codex");
    expect(
      resolveProviderEntryDisplayName({
        driverKind: "claudeAgent",
        instanceId: "claudeAgent",
        displayName: "Claude",
        hasCustomDisplayName: true,
      }),
    ).toBe("Claude");
    expect(
      resolveProviderEntryDisplayName({
        driverKind: "acpRegistry",
        instanceId: "acpRegistry_dsh",
        displayName: "dsh",
        hasCustomDisplayName: true,
      }),
    ).toBe("dsh");
    expect(
      resolveProviderEntryDisplayName({
        driverKind: "claudeAgent",
        instanceId: "claudeAgent",
        displayName: "Claude",
        hasCustomDisplayName: false,
      }),
    ).toBe("Claude Code");
    expect(containsUuidNoise("Codex 048c43c3 0798 480e Bc42 1...")).toBe(true);
    expect(stripUuidNoise("Codex 048c43c3 0798 480e Bc42 1...")).toBe("Codex");
  });

  it("resolves brand IDs and canonical Chief provider IDs consistently", () => {
    expect(resolveAgentBrandId("claudeAgent")).toBe("claude-code");
    expect(resolveAgentBrandId("openai-codex")).toBe("codex");
    expect(resolveAgentBrandId("agy")).toBe("antigravity");
    expect(resolveAgentBrandId("omp")).toBe("custom");
    expect(resolveAgentBrandId("oh-my-pi")).toBe("custom");
    expect(resolveAgentBrandId("unknown-bot")).toBe("custom");

    expect(toCanonicalChiefProviderId("claudeAgent")).toBe("claude-code");
    expect(toCanonicalChiefProviderId("dsh")).toBe("dsh");
    expect(toCanonicalChiefProviderId("antigravity-cli")).toBe("antigravity");
    expect(getAgentBrandMeta("codex").displayName).toBe("Codex");
  });

  it("renders official SVG logos with online breathing vs offline calm resting states", () => {
    const breathingHtml = renderToStaticMarkup(
      <AgentBrandLogo provider="codex" online breathing size={14} />,
    );
    expect(breathingHtml).toContain('data-agent-brand="codex"');
    expect(breathingHtml).toContain('data-online="true"');
    expect(breathingHtml).toContain('data-breathing="true"');
    expect(breathingHtml).toContain("<svg");

    const offlineHtml = renderToStaticMarkup(
      <AgentBrandLogo provider="claudeAgent" online={false} breathing size={14} />,
    );
    expect(offlineHtml).toContain('data-agent-brand="claude-code"');
    expect(offlineHtml).toContain('data-online="false"');
    expect(offlineHtml).toContain('data-breathing="false"');

    const antigravityHtml = renderToStaticMarkup(
      <AgentBrandLogo provider="antigravity" online breathing />,
    );
    expect(antigravityHtml).toContain('data-agent-brand="antigravity"');
    expect(antigravityHtml).toContain("linearGradient");

    expect(AGENT_BRAND_BREATHE_CSS).toContain("@keyframes pmx-brand-breathe");
    expect(AGENT_BRAND_BREATHE_CSS).toContain("prefers-reduced-motion: reduce");
  });

  it("renders minimalist PrismuxChiefStatusPill with breathing vendor logo, canonical name, and no AGENT suffix", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <PrismuxChiefStatusPill
          provider="claudeAgent"
          model="claude-opus-4-6"
          reasoningEffort="xhigh"
          dialMode="agent"
          online
        />
      </TooltipProvider>,
    );

    expect(html).toContain('data-pmx-chief-badge=""');
    expect(html).toContain('data-pmx-chief-online="1"');
    expect(html).toContain('data-agent-brand="claude-code"');
    expect(html).toContain('data-breathing="true"');
    expect(html).toContain(">Claude Code<");
    expect(html).not.toContain(">claudeAgent<");
    expect(html).not.toContain(">Agent<");
    expect(html).not.toContain(">AGENT<");
    expect(html).toContain("claude-opus-4-6");
    expect(html).toContain("默认思考强度：XHigh");
    expect(html).not.toContain("极高");
  });

  it("renders PrismuxChiefStatusPill in low-saturation resting state when offline", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <PrismuxChiefStatusPill provider="codex" online={false} />
      </TooltipProvider>,
    );

    expect(html).toContain('data-pmx-chief-online="0"');
    expect(html).toContain('data-agent-brand="codex"');
    expect(html).toContain('data-breathing="false"');
    expect(html).toContain(">Codex<");
    expect(html).not.toContain(">codex<");
  });

  it("displays custom Chief secretaryName and independent AGENTS.md status when customized", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <PrismuxChiefStatusPill
          provider="codex"
          model="gpt-5.4"
          reasoningEffort="high"
          dialMode="oracle"
          secretaryName="猫猫"
          agentsMdPath="C:/Users/Fish/.prismux/chief/AGENTS.md"
          online
        />
      </TooltipProvider>,
    );

    expect(html).toContain('data-pmx-chief-name="猫猫"');
    expect(html).toContain(">猫猫<");
    expect(html).toContain("猫猫（主秘书槽位）· 引擎：Codex");
    expect(html).toContain("独立 AGENTS.md 已加载");
    expect(html).toContain("喊「猫猫」即可唤起");
  });

  it("renders authentic Google 4-color Antigravity SVG with unique useId gradient IDs across all icon surfaces", () => {
    const meta = getAgentBrandMeta("antigravity");
    expect(meta.accentColor).toBe("#4285F4");
    expect(meta.accentColor.toLowerCase()).not.toBe("#6366f1");
    expect(providerLogoColor(ProviderDriverKind.make("antigravity"))).toBe("#4285F4");

    // Multi-instance render across AgentBrandLogo, AntigravityIcon, and ProviderInstanceIcon (native + ACP registry)
    const multiHtml = renderToStaticMarkup(
      <div>
        <AgentBrandLogo provider="antigravity" size={20} />
        <AgentBrandLogo provider="agy" size={68} />
        <AntigravityIcon className="size-4" />
        <AntigravityIcon className="size-6" />
        <ProviderInstanceIcon
          driverKind={ProviderDriverKind.make("antigravity")}
          displayName="Antigravity"
        />
        <ProviderInstanceIcon
          driverKind={ProviderDriverKind.make("acpRegistry")}
          displayName="Antigravity"
          acpRegistryAgentId="antigravity-acp"
        />
      </div>,
    );

    // Must contain authentic Google 4-color gradient stops and vector mesh primitives
    expect(multiHtml).toContain("#4285F4");
    expect(multiHtml).toContain("#EA4335");
    expect(multiHtml).toContain("#FBBC04");
    expect(multiHtml).toContain("#34A853");
    expect(multiHtml).toContain("linearGradient");
    expect(multiHtml).toContain("radialGradient");
    expect(multiHtml).toContain("clipPath");

    // Must NOT contain legacy wrong purple/indigo gradients or raster PNG fallback
    expect(multiHtml.toLowerCase()).not.toContain("#6366f1");
    expect(multiHtml.toLowerCase()).not.toContain("#818cf8");
    expect(multiHtml.toLowerCase()).not.toContain("#c084fc");
    expect(multiHtml).not.toContain("data:image/png");

    // Every rendered instance must produce distinct gradient/clipPath IDs via React useId()
    const idMatches = [
      ...multiHtml.matchAll(/id="([^"]*agy-(?:clip|base|green|yellow|red|belly))"/g),
    ].map((m) => m[1]);
    expect(idMatches.length).toBe(6 * 6);
    expect(new Set(idMatches).size).toBe(idMatches.length);

    // Monochrome variant renders a single currentColor silhouette without gradient defs
    const monoHtml = renderToStaticMarkup(
      <AgentBrandLogo provider="antigravity" monochrome size={16} />,
    );
    expect(monoHtml).toContain('fill="currentColor"');
    expect(monoHtml).not.toContain("linearGradient");
  });

  it("registers dsh (DeepSeek Harness, #4176E6) with exact FishLogo SVG across AgentBrandLogo and ProviderInstanceIcon", () => {
    expect(resolveAgentBrandId("dsh")).toBe("dsh");
    expect(resolveAgentBrandId("deepseek-harness")).toBe("dsh");
    expect(resolveAgentBrandId("acpRegistry:dsh")).toBe("dsh");
    expect(formatAgentBrandName("dsh")).toBe("DeepSeek Harness");
    expect(toCanonicalChiefProviderId("dsh")).toBe("dsh");
    expect(getAgentBrandMeta("dsh").accentColor).toBe(DSH_BRAND_COLOR);

    const logoHtml = renderToStaticMarkup(<AgentBrandLogo provider="dsh" size={16} />);
    expect(logoHtml).toContain('data-agent-brand="dsh"');
    expect(logoHtml).toContain(`viewBox="${DSH_FISH_LOGO_VIEWBOX}"`);
    expect(logoHtml).toContain(`fill="${DSH_BRAND_COLOR}"`);

    const providerIconHtml = renderToStaticMarkup(
      <ProviderInstanceIcon
        driverKind={ProviderDriverKind.make("acpRegistry")}
        displayName="DeepSeek Harness"
        acpRegistryAgentId="dsh"
        instanceId="acpRegistry:dsh"
      />,
    );
    expect(providerIconHtml).toContain('data-dsh-brand-icon="true"');
    expect(providerIconHtml).toContain(`fill="${DSH_BRAND_COLOR}"`);
    expect(providerIconHtml).not.toContain(">DH<");

    const pureDshHtml = renderToStaticMarkup(<DshIcon className="size-5" />);
    expect(pureDshHtml).toContain(`viewBox="${DSH_FISH_LOGO_VIEWBOX}"`);
    expect(pureDshHtml).toContain(`fill="${DSH_BRAND_COLOR}"`);
    expect(pureDshHtml).not.toContain("DH");
  });

  it("supports Pi Coding Agent brand metadata and official geometric icon without matching omp", () => {
    expect(resolveAgentBrandId("pi")).toBe("pi");
    expect(resolveAgentBrandId("pi-acp")).toBe("pi");
    expect(resolveAgentBrandId("pi-coding-agent")).toBe("pi");
    expect(resolveAgentBrandId("pixel")).toBe("custom");
    expect(resolveAgentBrandId("omp")).toBe("custom");
    expect(formatAgentBrandName("pi")).toBe("Pi");
    expect(toCanonicalChiefProviderId("pi")).toBe("pi");
    expect(getAgentBrandMeta("pi").displayName).toBe("Pi");

    const piBrandHtml = renderToStaticMarkup(<AgentBrandLogo provider="pi" size={16} />);
    expect(piBrandHtml).toContain('data-agent-brand="pi"');
    expect(piBrandHtml).toContain(`viewBox="${PI_LOGO_VIEWBOX}"`);
    expect(piBrandHtml).toContain(PI_LOGO_FRAME_PATH);
    expect(piBrandHtml).toContain(PI_LOGO_DOT_PATH);

    const piIconHtml = renderToStaticMarkup(<PiIcon className="size-4" />);
    expect(piIconHtml).toContain(`viewBox="${PI_LOGO_VIEWBOX}"`);
    expect(piIconHtml).toContain(PI_LOGO_FRAME_PATH);
    expect(piIconHtml).toContain(PI_LOGO_DOT_PATH);
  });

  it("enforces block display and xMidYMid meet optical centering on all AgentBrandLogo SVGs (including non-square viewBoxes)", () => {
    for (const provider of ["dsh", "opencode", "cursor", "qwen", "glm", "kimi", "codex"]) {
      const html = renderToStaticMarkup(<AgentBrandLogo provider={provider} size={16} />);
      expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
      expect(html).toContain("display:block");
    }
    expect(AGENT_BRAND_BREATHE_CSS).toContain("line-height: 0;");
    expect(AGENT_BRAND_BREATHE_CSS).toContain(".pmx-agent-brand-logo > svg");
  });
});
