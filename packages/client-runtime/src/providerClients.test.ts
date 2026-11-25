import { ProviderDriverKind } from "@prismux/core-contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveModelShortName } from "./providerClients.ts";

describe("resolveModelShortName", () => {
  it.each([
    // OpenAI / Codex
    [{ name: "gpt-6.2-astra" }, "codex", "6.2 Astra"],
    [{ name: "gpt-6-astra" }, "codex", "6 Astra"],
    [{ name: "GPT 6.2 Astra" }, "codex", "6.2 Astra"],
    [{ name: "GPT-6.1-Sol" }, "codex", "6.1 Sol"],
    [{ name: "dragonapi/gpt-promax/gpt-6.2-astra" }, "codex", "6.2 Astra"],
    [{ name: "openai/gpt-5.4-mini" }, "codex", "5.4 Mini"],
    [{ name: "gpt-5.5" }, "codex", "GPT-5.5"],
    [{ name: "o3-mini" }, "codex", "o3 Mini"],
    // Claude
    [{ name: "claude-fable-5-2" }, "claudeAgent", "Fable 5.2"],
    [{ name: "fable-5.2" }, "claudeAgent", "Fable 5.2"],
    [{ name: "claude-opus-5-5" }, "claudeAgent", "Opus 5.5"],
    [{ name: "Claude Opus 5.5" }, "claudeAgent", "Opus 5.5"],
    [{ name: "opus-5.5" }, "claudeAgent", "Opus 5.5"],
    [{ name: "anthropic/claude-sonnet-4-6[1m]" }, "claudeAgent", "Sonnet 4.6"],
    [{ name: "us.anthropic.claude-opus-4-6-v1:0" }, "claudeAgent", "Opus 4.6"],
    // Gemini / Antigravity
    [{ name: "gemini-4-neon" }, "antigravity", "4 Neon"],
    [{ name: "gemini 4 neon" }, "antigravity", "4 Neon"],
    [{ name: "Gemini 4 Carbon" }, "antigravity", "4 Carbon"],
    [{ name: "google/gemini-3.1-pro" }, "antigravity", "3.1 Pro"],
    [{ name: "gemini-3.8-flash-high" }, "antigravity", "3.8 Flash High"],
    // Grok
    [{ name: "grok-4.7" }, "grok", "Grok 4.7"],
    [{ name: "x-ai/grok-4-fast" }, "grok", "Grok 4 Fast"],
    // DeepSeek / Qwen / GLM / dsh / gateway
    [{ name: "deepseek-r1" }, "opencode", "DeepSeek R1"],
    [{ name: "deepseek/deepseek-v3.2" }, "opencode", "DeepSeek V3.2"],
    [{ name: "qwen3-coder-plus" }, "opencode", "Qwen 3 Coder Plus"],
    [{ name: "qwen-2.5-coder-32b" }, "opencode", "Qwen 2.5 Coder 32B"],
    [{ name: "glm-4.7" }, "opencode", "GLM 4.7"],
    [{ name: "zhipu/glm-5" }, "opencode", "GLM 5"],
    [{ name: "dsh/gpt-6.2-astra" }, null, "6.2 Astra"],
    [{ name: "dsh:claude-fable-5-2" }, null, "Fable 5.2"],
    [{ name: "dsh-gemini-4-neon" }, null, "4 Neon"],
    [{ name: "NVIDIA: Nemotron 3 Super" }, null, "Nemotron 3 Super"],
    // Explicit shortName is normalized if it is a raw slug and preserved when already clean
    [{ name: "Claude Opus 5.5", shortName: "opus-5.5" }, "claudeAgent", "Opus 5.5"],
    [{ name: "Claude Opus 5.5", shortName: "Opus" }, "claudeAgent", "Opus"],
  ] as const)("normalizes %j for driver %s -> %s", (model, driver, expected) => {
    expect(
      resolveModelShortName(model, driver ? ProviderDriverKind.make(driver) : null),
    ).toBe(expected);
  });
});
