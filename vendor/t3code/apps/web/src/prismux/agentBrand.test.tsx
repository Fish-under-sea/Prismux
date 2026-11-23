import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { TooltipProvider } from "../components/ui/tooltip";
import {
  AGENT_BRAND_BREATHE_CSS,
  AgentBrandLogo,
  formatAgentBrandName,
  getAgentBrandMeta,
  resolveAgentBrandId,
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

    expect(formatAgentBrandName("omp")).toBe("oh-my-pi");
    expect(formatAgentBrandName("oh-my-pi")).toBe("oh-my-pi");
    expect(formatAgentBrandName("pi")).toBe("oh-my-pi");

    expect(formatAgentBrandName("gemini")).toBe("Gemini CLI");
    expect(formatAgentBrandName("gemini-cli")).toBe("Gemini CLI");

    expect(formatAgentBrandName("opencode")).toBe("OpenCode");
    expect(formatAgentBrandName("cursor")).toBe("Cursor");
  });

  it("preserves user custom display names while Title-Casing raw unknown ACP IDs", () => {
    expect(formatAgentBrandName("acpRegistry:team", "DeepSeek Internal")).toBe(
      "DeepSeek Internal",
    );
    expect(formatAgentBrandName("claudeAgent", "Claude")).toBe("Claude Code");
    expect(formatAgentBrandName("my-custom-acp")).toBe("My Custom ACP");
    expect(formatAgentBrandName("acmeCodeAgent")).toBe("Acme Code Agent");
    expect(formatAgentBrandName("  ")).toBe("Agent");
  });

  it("resolves brand IDs and canonical Chief provider IDs consistently", () => {
    expect(resolveAgentBrandId("claudeAgent")).toBe("claude-code");
    expect(resolveAgentBrandId("openai-codex")).toBe("codex");
    expect(resolveAgentBrandId("agy")).toBe("antigravity");
    expect(resolveAgentBrandId("oh-my-pi")).toBe("omp");
    expect(resolveAgentBrandId("unknown-bot")).toBe("custom");

    expect(toCanonicalChiefProviderId("claudeAgent")).toBe("claude-code");
    expect(toCanonicalChiefProviderId("pi")).toBe("omp");
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

    const ompHtml = renderToStaticMarkup(<AgentBrandLogo provider="omp" online />);
    expect(ompHtml).toContain('data-agent-brand="omp"');

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
});
