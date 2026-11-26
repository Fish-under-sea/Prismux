import { assert, describe, it } from "@effect/vitest";

import {
  buildPrismuxOrchestrationSections,
  detectPrismuxPromptIntent,
  PRISMUX_ACP_MCP_FALLBACK_INSTRUCTIONS,
  PRISMUX_DEVICE_TOOL_INSTRUCTIONS,
  PRISMUX_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH,
  PRISMUX_LINKED_ENVIRONMENTS_INSTRUCTIONS,
  PRISMUX_ORCHESTRATION_INSTRUCTIONS,
  PRISMUX_VISUALS_AND_PREVIEW_SECTION,
  prismuxAcpPromptWithInstructions,
  prismuxOrchestrationPrompt,
  prismuxOrchestrationSystemPrompt,
  resolvePrismuxAcpPromptPlan,
  stripPrismuxSenderPrefix,
} from "./orchestrationInstructions.ts";

describe("Prismux device instructions", () => {
  it("route device work through device_open and give Claude the line that loads the tools", () => {
    for (const intent of ["`device_list`", "`device_open`", "`agent-device`", "ssh", "`hostId`"]) {
      assert.include(PRISMUX_DEVICE_TOOL_INSTRUCTIONS, intent);
    }
    assert.notInclude(PRISMUX_DEVICE_TOOL_INSTRUCTIONS, "ToolSearch");
    const loadLine =
      " Load them with ToolSearch `select:mcp__prismux__device_list,mcp__prismux__device_open,mcp__prismux__device_screenshot,mcp__prismux__device_close`.";
    assert.include(PRISMUX_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH, loadLine);
    assert.equal(
      PRISMUX_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH.replace(loadLine, ""),
      PRISMUX_DEVICE_TOOL_INSTRUCTIONS,
    );
  });

  it("open the app before the returned command's snapshots, screenshots and input", () => {
    assert.include(
      PRISMUX_DEVICE_TOOL_INSTRUCTIONS,
      "its snapshots, screenshots and input need `open <app>` first,",
    );
  });

  it("keep the failure rule from taking over or closing a session another thread holds", () => {
    // agent-device's DEVICE_IN_USE advice is to rerun with the owner's --session or close it first.
    assert.include(
      PRISMUX_DEVICE_TOOL_INSTRUCTIONS,
      "follow its advice once, but never reuse or close another session; if it still fails,",
    );
  });

  it("reach OpenCode and Cursor only when device access is held AND the prompt or session needs devices", () => {
    assert.include(
      prismuxOrchestrationSystemPrompt(true, true, { prompt: "Test on iOS simulator" }),
      PRISMUX_DEVICE_TOOL_INSTRUCTIONS,
    );
    assert.notInclude(
      prismuxOrchestrationSystemPrompt(true, true, { prompt: "Explain this helper function." }),
      "## Prismux devices",
    );
    assert.include(
      prismuxOrchestrationSystemPrompt(true, true, { hasOpenDeviceSession: true }),
      PRISMUX_DEVICE_TOOL_INSTRUCTIONS,
    );
    assert.notInclude(
      prismuxOrchestrationSystemPrompt(true, false, { prompt: "Test on iOS simulator" }),
      "## Prismux devices",
    );
    assert.isUndefined(prismuxOrchestrationSystemPrompt(false, true));

    const firstRun = (hasDeviceTools: boolean, prompt = "Check the login screen on iOS simulator.") =>
      prismuxOrchestrationPrompt({
        prompt,
        hasPrismuxMcp: true,
        hasDeviceTools,
        orchestrationDelivered: false,
        deviceInstructionsDelivered: false,
      });
    assert.include(firstRun(true), PRISMUX_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(firstRun(true, "Refactor foo.ts."), "## Prismux devices");
    assert.notInclude(firstRun(false), "## Prismux devices");

    const laterRun = (deviceInstructionsDelivered: boolean) =>
      prismuxOrchestrationPrompt({
        prompt: "Check the Android emulator login screen.",
        hasPrismuxMcp: true,
        hasDeviceTools: true,
        orchestrationDelivered: true,
        deviceInstructionsDelivered,
      });
    assert.include(laterRun(false), PRISMUX_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(laterRun(false), PRISMUX_ORCHESTRATION_INSTRUCTIONS.trim());
    assert.equal(laterRun(true), "Check the Android emulator login screen.");

    // A provider's own guidance reaches a conversation that already had the rest.
    const providerRun = (providerInstructionsDelivered: boolean) =>
      prismuxOrchestrationPrompt({
        prompt: "Check the login screen.",
        hasPrismuxMcp: true,
        hasDeviceTools: false,
        orchestrationDelivered: true,
        deviceInstructionsDelivered: false,
        providerInstructions: "Mark awaited shells.",
        providerInstructionsDelivered,
      });
    assert.include(providerRun(false), "Mark awaited shells.");
    assert.notInclude(providerRun(false), PRISMUX_ORCHESTRATION_INSTRUCTIONS.trim());
    assert.equal(providerRun(true), "Check the login screen.");
  });

  it("injects ACP device/browser/visuals/linked-env blocks strictly on demand and tracks incremental delivery", () => {
    const baseState = {
      interactionMode: "default" as const,
      hasPrismuxMcp: true,
      hasDeviceTools: true,
      hasBrowserTools: true,
    };
    const turn1 = resolvePrismuxAcpPromptPlan({
      prompt: "Explain this helper function.",
      state: baseState,
    });
    assert.include(turn1.text, "## Prismux orchestration");
    assert.notInclude(turn1.text, "## Prismux devices");
    assert.notInclude(turn1.text, "## Prismux browser");
    assert.notInclude(turn1.text, "### Visuals and preview");
    assert.notInclude(turn1.text, "prismux_environment_links");

    // Turn 2 asks for iOS simulator -> delivers ONLY device block without repeating orchestration
    const turn2 = resolvePrismuxAcpPromptPlan({
      prompt: "Check the login screen on iOS simulator.",
      state: baseState,
      previousState: turn1.nextState,
    });
    assert.include(turn2.text, PRISMUX_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(turn2.text, "## Prismux orchestration");
    assert.notInclude(turn2.text, "## Prismux browser");

    // Turn 3 plain follow-up -> bare prompt text
    const turn3 = resolvePrismuxAcpPromptPlan({
      prompt: "Again.",
      state: baseState,
      previousState: turn2.nextState,
    });
    assert.equal(turn3.text, "Again.");

    // Turn 4 asks for browser screenshot -> delivers browser + visuals blocks once
    const turn4 = resolvePrismuxAcpPromptPlan({
      prompt: "Open http://localhost:3000 in the browser and take a screenshot.",
      state: baseState,
      previousState: turn3.nextState,
    });
    assert.include(turn4.text, "## Prismux browser");
    assert.include(turn4.text, PRISMUX_VISUALS_AND_PREVIEW_SECTION);
    assert.notInclude(turn4.text, "## Prismux devices");
  });

  it("keeps delegated child prompts ultra-light with zero irrelevant boilerplate and zero T3 residue", () => {
    const childPrompt =
      '[Prismux: the agent in Prismux thread "e728d2b5-2bc3-4dac-a87e-d8e842146fac" sent this message, not the user.]\n\n' +
      "初稿实数为 104 个汉字。请出定稿：删掉「最后」和「从前」，其余汉字保留不变，给末句的直接引语加引号，分段输出小说正文即可。";

    assert.equal(
      stripPrismuxSenderPrefix(childPrompt),
      "初稿实数为 104 个汉字。请出定稿：删掉「最后」和「从前」，其余汉字保留不变，给末句的直接引语加引号，分段输出小说正文即可。",
    );
    const intent = detectPrismuxPromptIntent(childPrompt);
    assert.isFalse(intent.needsDevice);
    assert.isFalse(intent.needsBrowser);
    assert.isFalse(intent.needsVisuals);
    assert.isFalse(intent.needsPullRequestLinking);
    assert.isFalse(intent.needsLinkedEnvironments);
    assert.isFalse(intent.needsDelegation);

    const emitted = prismuxAcpPromptWithInstructions({
      prompt: childPrompt,
      state: {
        interactionMode: "default",
        hasPrismuxMcp: true,
        hasBrowserTools: true,
        hasDeviceTools: true,
        isSubagent: true,
      },
    });
    // ZERO instruction wrapper for a plain delegated prose child!
    assert.equal(emitted, childPrompt);
    assert.notInclude(emitted, "<prismux_instructions>");
    assert.notInclude(emitted, "## Prismux devices");
    assert.notInclude(emitted, "## Prismux browser");
    assert.notInclude(emitted, "## Prismux orchestration");
    assert.notInclude(emitted, "ACP fallback");
    assert.notMatch(emitted, /\bt3[-_ ]?code\b|\bt3_[a-z]|T3_ACP_MCP/i);

    // Delegated child with explicit device task STILL receives device guidance
    const deviceChild = prismuxAcpPromptWithInstructions({
      prompt: "在 Android 模拟器上验证登录按钮。",
      state: {
        interactionMode: "default",
        hasPrismuxMcp: true,
        hasDeviceTools: true,
        isSubagent: true,
      },
    });
    assert.include(deviceChild, PRISMUX_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(deviceChild, "## Prismux orchestration");
    assert.notInclude(deviceChild, "ACP fallback");
  });

  it("omits ACP terminal fallback when the ACP session advertises native MCP support", () => {
    const withNativeMcp = prismuxAcpPromptWithInstructions({
      prompt: "Help me refactor this module.",
      state: {
        interactionMode: "default",
        hasPrismuxMcp: true,
        hasDeviceTools: false,
        hasNativeMcp: true,
      },
    });
    assert.include(withNativeMcp, "## Prismux orchestration");
    assert.notInclude(withNativeMcp, PRISMUX_ACP_MCP_FALLBACK_INSTRUCTIONS);

    const withoutNativeMcp = prismuxAcpPromptWithInstructions({
      prompt: "Help me refactor this module.",
      state: {
        interactionMode: "default",
        hasPrismuxMcp: true,
        hasDeviceTools: false,
        hasNativeMcp: false,
      },
    });
    assert.include(withoutNativeMcp, PRISMUX_ACP_MCP_FALLBACK_INSTRUCTIONS);
  });

  it("gates linked-environment lines on demand", () => {
    const plain = buildPrismuxOrchestrationSections({ prompt: "Refactor utils.ts" }).join("\n");
    assert.notInclude(plain, PRISMUX_LINKED_ENVIRONMENTS_INSTRUCTIONS);

    const vps = buildPrismuxOrchestrationSections({
      prompt: "Delegate this build to my VPS",
    }).join("\n");
    assert.include(vps, PRISMUX_LINKED_ENVIRONMENTS_INSTRUCTIONS);
  });
});

describe("Prismux cross-agent orchestration routing", () => {
  it("routes cross-agent requests (dsh/deepseek/claude/codex/agy) through orchestrator_capabilities and delegate_task with zero T3 residue", () => {
    assert.include(PRISMUX_ORCHESTRATION_INSTRUCTIONS, "`dsh`/`deepseek`");
    assert.include(PRISMUX_ORCHESTRATION_INSTRUCTIONS, "`claude`");
    assert.include(PRISMUX_ORCHESTRATION_INSTRUCTIONS, "`codex`");
    assert.include(PRISMUX_ORCHESTRATION_INSTRUCTIONS, "`agy`");
    assert.include(
      PRISMUX_ORCHESTRATION_INSTRUCTIONS,
      "call `orchestrator_capabilities` once then `delegate_task`; never run another agent's CLI in shell.",
    );
    assert.notMatch(
      PRISMUX_ORCHESTRATION_INSTRUCTIONS +
        PRISMUX_LINKED_ENVIRONMENTS_INSTRUCTIONS +
        PRISMUX_VISUALS_AND_PREVIEW_SECTION +
        PRISMUX_ACP_MCP_FALLBACK_INSTRUCTIONS,
      /\bT3\b|\bt3[-_ ]?code\b|\bt3_[a-z]|T3_ACP_MCP/,
    );
  });
});
