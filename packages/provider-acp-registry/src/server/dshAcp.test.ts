import { describe, expect, it } from "vite-plus/test";
import type * as AcpSchema from "@prismux/effect-acp/compat";
import { parseSessionUpdateEvent } from "@prismux/provider-acp/server/runtimeModel";
import {
  extractDshTodoPlanUpdate,
  normalizeDshSessionUpdate,
  normalizeDshToolCall,
} from "./dshAcp.ts";

describe("dshAcp todo_write normalization", () => {
  it("normalizes DSH todo_write tool calls and projects structured todo_list plan updates", () => {
    const rawNotification: AcpSchema.SessionNotification = {
      sessionId: "dsh-session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "dsh-call-todo-1",
        title: "todo_write",
        kind: "other",
        status: "in_progress",
        rawInput: {
          explanation: "Executing search card migration",
          todos: [
            { id: "t1", content: "Inspect DSH SearchBlock", status: "completed" },
            { id: "t2", content: "Build Prismux DshSearchBlock", status: "in_progress" },
            { id: "t3", content: "Run verification suite", status: "pending" },
          ],
        },
      },
    };

    const normalized = normalizeDshSessionUpdate(rawNotification);
    expect(normalized.update.sessionUpdate).toBe("tool_call");
    if (normalized.update.sessionUpdate === "tool_call") {
      expect(normalized.update.kind).toBe("think");
      expect(normalized.update.title).toBe("Update plan");
      expect(normalized.update._meta).toMatchObject({ dshToolName: "todo_write" });
    }

    const parsed = parseSessionUpdateEvent(normalized);
    const toolEvent = parsed.events.find((event) => event._tag === "ToolCallUpdated");
    expect(toolEvent).toBeDefined();
    if (!toolEvent || toolEvent._tag !== "ToolCallUpdated") return;

    expect(extractDshTodoPlanUpdate(toolEvent.toolCall)).toEqual({
      nativePlanId: "legacy",
      kind: "items",
      explanation: "Executing search card migration",
      plan: [
        { step: "Inspect DSH SearchBlock", status: "completed" },
        { step: "Build Prismux DshSearchBlock", status: "inProgress" },
        { step: "Run verification suite", status: "pending" },
      ],
    });
  });

  it("ignores non-todo DSH tools when extracting todo plans", () => {
    const normalized = normalizeDshSessionUpdate({
      sessionId: "dsh-session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "dsh-call-grep-1",
        title: "grep",
        kind: "other",
        status: "completed",
        rawInput: { pattern: "todo_write" },
      },
    });
    const parsed = parseSessionUpdateEvent(normalized);
    const toolEvent = parsed.events.find((event) => event._tag === "ToolCallUpdated");
    expect(toolEvent).toBeDefined();
    if (!toolEvent || toolEvent._tag !== "ToolCallUpdated") return;
    expect(extractDshTodoPlanUpdate(toolEvent.toolCall)).toBeUndefined();
  });

  it("preserves native DSH skill tool semantics without downgrading to generic read", () => {
    const rawNotification: AcpSchema.SessionNotification = {
      sessionId: "dsh-session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "dsh-call-skill-1",
        title: "skill",
        kind: "other",
        status: "completed",
        rawInput: { name: "core-rules-dsh" },
        content: [
          {
            type: "content",
            content: { type: "text", text: "# Core Rules\nFollow strict engineering discipline." },
          },
        ],
      },
    };

    const normalized = normalizeDshSessionUpdate(rawNotification);
    expect(normalized.update.sessionUpdate).toBe("tool_call");
    if (normalized.update.sessionUpdate === "tool_call") {
      expect(normalized.update.kind).toBe("other");
      expect(normalized.update.title).toBe("Skill: core-rules-dsh");
      expect(normalized.update._meta).toMatchObject({
        dshToolName: "skill",
        skillName: "core-rules-dsh",
      });
    }

    const parsed = parseSessionUpdateEvent(normalized);
    const toolEvent = parsed.events.find((event) => event._tag === "ToolCallUpdated");
    expect(toolEvent).toBeDefined();
    if (!toolEvent || toolEvent._tag !== "ToolCallUpdated") return;

    const merged = normalizeDshToolCall(toolEvent.toolCall);
    expect(merged.kind).toBe("other");
    expect(merged.title).toBe("Skill: core-rules-dsh");
    expect(merged.data.meta).toMatchObject({
      dshToolName: "skill",
      skillName: "core-rules-dsh",
    });
  });
});
