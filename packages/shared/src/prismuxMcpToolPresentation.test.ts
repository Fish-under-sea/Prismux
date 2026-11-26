import { describe, expect, it } from "vite-plus/test";

import {
  formatPrismuxMcpToolDisplayName,
  PRISMUX_MCP_TOOL_NAMES,
  resolvePrismuxMcpSummaryAction,
  resolvePrismuxMcpToolDefinition,
  resolvePrismuxMcpToolPresentation,
} from "./prismuxMcpToolPresentation.ts";

describe("formatPrismuxMcpToolDisplayName", () => {
  it("normalizes historical persisted t3-code and t3_* tool names to prismux branding", () => {
    expect(formatPrismuxMcpToolDisplayName("t3-code.t3_thread_send")).toBe(
      "prismux.prismux_thread_send",
    );
    expect(formatPrismuxMcpToolDisplayName("t3-code-direct.t3_thread_read")).toBe(
      "prismux-direct.prismux_thread_read",
    );
    expect(formatPrismuxMcpToolDisplayName("mcp__t3-code__t3_thread_launch")).toBe(
      "mcp__prismux__prismux_thread_launch",
    );
    expect(formatPrismuxMcpToolDisplayName("t3_thread_send")).toBe("prismux_thread_send");
    expect(formatPrismuxMcpToolDisplayName("prismux.prismux_thread_send")).toBe(
      "prismux.prismux_thread_send",
    );
    expect(formatPrismuxMcpToolDisplayName("t3-code.delegate_task")).toBe(
      "prismux.delegate_task",
    );
    // Unrelated external MCP servers stay untouched.
    expect(formatPrismuxMcpToolDisplayName("mcp__github__create_issue")).toBe(
      "mcp__github__create_issue",
    );
  });

  it("maps historical t3-code.t3_thread_send calls to Prismux tool presentation", () => {
    const resolved = resolvePrismuxMcpToolPresentation("t3-code.t3_thread_send");
    expect(resolved).toEqual(resolvePrismuxMcpToolPresentation("prismux.prismux_thread_send"));
    expect(resolved?.logo).toBe("prismux");
  });
});

describe("resolvePrismuxMcpToolPresentation", () => {
  it("recognizes every T3 tool across provider prefixes and completion suffixes", () => {
    for (const tool of PRISMUX_MCP_TOOL_NAMES) {
      const presentation = resolvePrismuxMcpToolPresentation(tool);
      for (const prefix of [
        "mcp__prismux__",
        "mcp__prismux__",
        "mcp__prismux__",
        "T3-code.",
        "prismux.",
        "prismux-direct.",
        "mcp__t3_code_direct__",
        "t3_code/",
        "prismux:",
        "mcp_prismux_",
        "Prismux ",
        "t3-code · ",
      ]) {
        expect(resolvePrismuxMcpToolPresentation(`${prefix}${tool} completed`), tool).toEqual(
          presentation,
        );
      }
      expect(resolvePrismuxMcpToolPresentation(`mcp__another-server__${tool}`), tool).toBeNull();
    }
  });

  it("matches OpenCode 2's per-thread server names, whose thread ids hold underscores", () => {
    expect(
      resolvePrismuxMcpToolPresentation("t3-code-thread_opencode2-adapter_delegate_task")?.displayName,
    ).toBe("Delegate a child task");
    expect(resolvePrismuxMcpToolPresentation("t3-code-thread_opencode2-adapter_not_a_tool")).toBeNull();
  });
});

describe("resolvePrismuxMcpToolDefinition", () => {
  it("labels an action tool call as the action it ran", () => {
    expect(
      resolvePrismuxMcpToolDefinition("mcp__prismux__preview_act", { action: "type" })?.labels,
    ).toEqual(resolvePrismuxMcpToolDefinition("preview_type")?.labels);
    expect(resolvePrismuxMcpToolDefinition("prismux_thread_transfer", { action: "fork" })?.displayName).toBe(
      resolvePrismuxMcpToolDefinition("prismux_thread_fork")?.displayName,
    );
    expect(resolvePrismuxMcpToolDefinition("preview_act", { action: "unknown" })?.labels[2]).toBe(
      "Used",
    );
  });
});

describe("resolvePrismuxMcpSummaryAction", () => {
  it("summarizes an action tool by the action each call ran", () => {
    expect(resolvePrismuxMcpSummaryAction("mcp__prismux__prismux_queue", { action: "list" })).toBe(
      "queue-list",
    );
    expect(resolvePrismuxMcpSummaryAction("prismux_queue", { action: "edit" })).toBe("queue-edit");
    expect(resolvePrismuxMcpSummaryAction("prismux_thread_transfer", { action: "status" })).toBe(
      "thread-transfers",
    );
    expect(resolvePrismuxMcpSummaryAction("prismux_thread_configure", {})).toBe("thread-configuration");
    expect(resolvePrismuxMcpSummaryAction("schedule_task", { scheduledTaskId: "task-1" })).toBe(
      "schedule-update",
    );
    expect(resolvePrismuxMcpSummaryAction("delegate_task", { task: "x" })).toBe("delegate");
  });
});
