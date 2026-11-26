import * as NodeAssert from "node:assert/strict";

import { PRISMUX_DEVICE_TOOL_INSTRUCTIONS } from "@prismux/provider-core/server/orchestrationInstructions";
import { describe, it } from "vite-plus/test";

import {
  buildCodexAdditionalContext,
  CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES,
} from "./CodexDeveloperInstructions.ts";

describe("buildCodexAdditionalContext", () => {
  describe.each([
    { model: "custom-model", modelName: "Custom 🦊 Model", reasoningEffort: "xhigh" },
  ])("with runtime $model", (runtime) => {
    it.each([undefined, { browser: true, device: true }])(
      "keeps every entry within Codex's per-entry cap with tools %j",
      (availability) => {
        const context = buildCodexAdditionalContext(runtime, availability);

        for (const [key, entry] of Object.entries(context)) {
          // Codex counts ceil(UTF-8 bytes / 4) tokens, excluding keys and wrappers.
          const bytes = Buffer.byteLength(entry.value, "utf8");
          const limit = CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES;
          NodeAssert.ok(
            bytes <= limit,
            `${key}: ${bytes} UTF-8 bytes exceeds Codex's ${limit}-byte per-entry cap by ${bytes - limit} bytes; split the instructions into separate entries to avoid silent truncation`,
          );
        }
      },
    );
  });
});

describe("Codex runtime context", () => {
  it("flattens multiline metadata into single-line runtime info", () => {
    const instructions = runtimeInstructions({
      model: "gpt\n5.3\ncodex",
      reasoningEffort: " high\neffort ",
    });

    NodeAssert.match(instructions, /as gpt 5\.3 codex with high effort reasoning effort/);
    NodeAssert.doesNotMatch(instructions, /<runtime_info>[^<]*\n/);
  });
});

describe("Codex orchestration context", () => {
  it("routes subagents native first, delegate_task for the rest", () => {
    const orchestration = Object.entries(buildCodexAdditionalContext({ model: "gpt-6.1-sol" }))
      .filter(([key]) => key.startsWith("prismux_orchestration_"))
      .map(([, entry]) => entry.value)
      .join("\n");

    NodeAssert.ok(orchestration.includes("use your native tool when the child uses your provider"));
    NodeAssert.ok(orchestration.includes("`run_in_background:false`"));
    NodeAssert.ok(orchestration.includes("A native type on another provider's model"));
    NodeAssert.ok(
      orchestration.includes("Background agent: `delegate_task`, never a background `Agent`."),
    );
    NodeAssert.ok(
      orchestration.includes("Every new delegate review or re-check is a new `delegate_task`"),
    );
    NodeAssert.ok(orchestration.includes("never a `prismux_thread_send`"));
    NodeAssert.ok(!orchestration.includes("inheritedOptions"));
    NodeAssert.ok(!orchestration.includes("Prefer native"));
    // The ACP terminal fallback is ACP-only; Codex agents never need it.
    NodeAssert.ok(!orchestration.includes("acp-mcp-call"));
  });
});

describe("Codex device and on-demand context", () => {
  it("adds device/browser/PR blocks strictly on demand and keeps delegated children minimal", () => {
    const tools = (device: boolean, prompt?: string) =>
      buildCodexAdditionalContext(
        { model: "gpt-6.1-sol" },
        { browser: true, device, prompt },
      ).prismux_tools?.value ?? "";

    // Plain prompt without device/browser intent gets zero device/browser dump
    NodeAssert.equal(tools(true, "Explain this helper function."), "");
    NodeAssert.ok(
      tools(true, "Launch the app on iOS simulator and screenshot it.").includes(
        PRISMUX_DEVICE_TOOL_INSTRUCTIONS,
      ),
    );
    NodeAssert.ok(!tools(true, "Check iOS simulator").includes("ToolSearch"));
    NodeAssert.ok(!tools(false, "Check iOS simulator").includes("## Prismux devices"));
    NodeAssert.ok(
      tools(false, "Open http://localhost:3000 in the browser").includes("## Prismux browser"),
    );

    // Delegated child with plain prose task gets ONLY prismux_runtime (no parent orchestration)
    const childCtx = buildCodexAdditionalContext(
      { model: "gpt-6.1-sol" },
      {
        browser: true,
        device: true,
        isSubagent: true,
        prompt: "删掉「最后」和「从前」，分段输出小说正文即可。",
      },
    );
    NodeAssert.deepEqual(Object.keys(childCtx), ["prismux_runtime"]);
    NodeAssert.ok(!childCtx.prismux_runtime!.value.includes("<pull_request_linking>"));
  });
});

function runtimeInstructions(runtime: Parameters<typeof buildCodexAdditionalContext>[0]) {
  return buildCodexAdditionalContext(runtime).prismux_runtime!.value;
}
