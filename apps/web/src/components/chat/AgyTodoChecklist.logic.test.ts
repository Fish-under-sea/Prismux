import {
  NodeId,
  PlanId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2PlanArtifact,
  type OrchestrationV2TurnItem,
} from "@prismux/core-contracts";
import * as DateTime from "effect/DateTime";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import type { WorkLogEntry } from "../../session-logic";
import {
  extractActiveTodoChecklist,
  formatAgyElapsedZh,
  normalizeAgyTodoStepStatus,
} from "./AgyTodoChecklist.logic";
import { AgyTodoChecklist } from "./AgyTodoChecklist";

const NOW = DateTime.makeUnsafe("2026-11-26T00:00:00.000Z");

function makePlan(
  id: string,
  status: OrchestrationV2PlanArtifact["status"],
  steps: ReadonlyArray<{ id: string; text: string; status: "pending" | "running" | "completed" }>,
  explanation?: string,
): OrchestrationV2PlanArtifact {
  return {
    id: PlanId.make(id),
    threadId: ThreadId.make("thread-1"),
    runId: RunId.make("run-1"),
    nodeId: NodeId.make("node-1"),
    kind: "todo_list",
    status,
    steps,
    ...(explanation ? { explanation } : {}),
  };
}

function makeBaseTurnItem(id: string) {
  return {
    id: TurnItemId.make(id),
    threadId: ThreadId.make("thread-1"),
    runId: RunId.make("run-1"),
    nodeId: NodeId.make("node-1"),
    providerThreadId: ProviderThreadId.make("pt-1"),
    providerTurnId: ProviderTurnId.make("turn-1"),
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed" as const,
    title: null,
    startedAt: NOW,
    completedAt: NOW,
    updatedAt: NOW,
  };
}

describe("AgyTodoChecklist.logic", () => {
  it("formats elapsed durations in concise Chinese matching AGY pill conventions", () => {
    expect(formatAgyElapsedZh(500)).toBe("已进行 1s");
    expect(formatAgyElapsedZh(45_000)).toBe("已进行 45s");
    expect(formatAgyElapsedZh(125_000)).toBe("已进行 2m");
    expect(formatAgyElapsedZh(3_600_000)).toBe("已进行 1h");
    expect(formatAgyElapsedZh(4_320_000)).toBe("已进行 1h 12m");
  });

  it("normalizes cross-agent step statuses reliably", () => {
    expect(normalizeAgyTodoStepStatus("done")).toBe("completed");
    expect(normalizeAgyTodoStepStatus("completed")).toBe("completed");
    expect(normalizeAgyTodoStepStatus("running")).toBe("in_progress");
    expect(normalizeAgyTodoStepStatus("inProgress")).toBe("in_progress");
    expect(normalizeAgyTodoStepStatus("in_progress")).toBe("in_progress");
    expect(normalizeAgyTodoStepStatus("error")).toBe("failed");
    expect(normalizeAgyTodoStepStatus("cancelled")).toBe("skipped");
    expect(normalizeAgyTodoStepStatus("skipped")).toBe("skipped");
    expect(normalizeAgyTodoStepStatus("queued")).toBe("pending");
  });

  it("prioritizes latest non-superseded todo_list plan over turn items and dynamic tools", () => {
    const superseded = makePlan("plan-old", "superseded", [
      { id: "1", text: "Old step", status: "pending" },
    ]);
    const active = makePlan("plan-active", "active", [
      { id: "1", text: "Complete initial tracks", status: "completed" },
      { id: "2", text: "Apply provider order", status: "running" },
      { id: "3", text: "Match DSH hierarchy", status: "completed" },
      { id: "4", text: "Fix tab harness", status: "completed" },
      { id: "5", text: "Fix text hierarchy", status: "running" },
      { id: "6", text: "Add CoT translation", status: "running" },
      { id: "7", text: "Verify builds & tests", status: "pending" },
    ]);
    const dynamicItem: OrchestrationV2TurnItem = {
      ...makeBaseTurnItem("item-dyn"),
      type: "dynamic_tool",
      toolName: "TodoWrite",
      input: { todos: [{ content: "Fallback step", status: "pending" }] },
    };

    const result = extractActiveTodoChecklist({
      plans: [active, superseded],
      turnItems: [dynamicItem],
      turnStartedAtMs: 1_000_000,
      nowMs: 1_125_000,
      isTurnWorking: true,
    });

    expect(result).not.toBeNull();
    expect(result?.source).toBe("plan");
    expect(result?.completedCount).toBe(3);
    expect(result?.inProgressCount).toBe(3);
    expect(result?.pendingCount).toBe(1);
    expect(result?.totalCount).toBe(7);
    expect(result?.progressRatio).toBeCloseTo(3 / 7, 5);
    expect(result?.allCompleted).toBe(false);
    expect(result?.hasActiveWork).toBe(true);
    expect(result?.elapsedLabelZh).toBe("已进行 2m");
    expect(result?.stepCountLabelZh).toBe("3/7 步");
  });

  it("falls back to latest todo_list turn item when no active plan exists", () => {
    const todoItem: OrchestrationV2TurnItem = {
      ...makeBaseTurnItem("item-todo"),
      type: "todo_list",
      planId: PlanId.make("p-1"),
      steps: [
        { id: "1", text: "Step A", status: "completed" },
        { id: "2", text: "Step B", status: "completed" },
      ],
    };

    const result = extractActiveTodoChecklist({
      plans: [],
      turnItems: [todoItem],
      isTurnWorking: false,
    });

    expect(result?.source).toBe("turn_item");
    expect(result?.allCompleted).toBe(true);
    expect(result?.hasActiveWork).toBe(false);
    expect(result?.elapsedLabelZh).toBe("已完成");
    expect(result?.stepCountLabelZh).toBe("2/2 步");
  });

  it("parses fallback structured dynamic_tool payloads across all agent tool naming variants", () => {
    const entries: ReadonlyArray<WorkLogEntry> = [
      {
        id: "w-1",
        createdAt: "2026-11-26T00:00:00.000Z",
        label: "Running update_steps",
        tone: "tool",
        toolTitle: "Running update_steps",
        structuredPayload: {
          ...makeBaseTurnItem("item-agy"),
          type: "dynamic_tool",
          toolName: "update_steps",
          input: {
            explanation: "AGY checklist",
            steps: [
              { title: "Scan codebase", status: "done" },
              { title: "Edit component", status: "in_progress" },
              { title: "Skip deprecated check", status: "skipped" },
              { title: "Failed lint step", status: "failed" },
            ],
          },
        },
      },
    ];

    const result = extractActiveTodoChecklist({
      plans: [],
      turnItems: [],
      workEntries: entries,
      turnStartedAtMs: 10_000,
      nowMs: 55_000,
    });

    expect(result?.source).toBe("dynamic_tool");
    expect(result?.explanation).toBe("AGY checklist");
    expect(result?.completedCount).toBe(1);
    expect(result?.inProgressCount).toBe(1);
    expect(result?.skippedCount).toBe(1);
    expect(result?.failedCount).toBe(1);
    expect(result?.elapsedLabelZh).toBe("已进行 45s");
    expect(result?.stepCountLabelZh).toBe("1/4 步");
  });

  it("renders AGY header pill, 4-dot pulsing grid, progress ring, and frosted Liquid Glass card", () => {
    const plan = makePlan(
      "plan-render",
      "active",
      [
        { id: "1", text: "完成底座收编", status: "completed" },
        { id: "2", text: "适配液态玻璃样式", status: "running" },
        { id: "3", text: "运行单测验证", status: "pending" },
      ],
      "阶段进度追踪",
    );

    const snapshot = extractActiveTodoChecklist({
      plans: [plan],
      turnStartedAtMs: 1_000_000,
      nowMs: 1_125_000,
      isTurnWorking: true,
    });
    const html = renderToStaticMarkup(
      createElement(AgyTodoChecklist, {
        variant: "dock",
        snapshot,
      }),
    );

    expect(html).toContain("已进行 2m");
    expect(html).toContain("1/3 步");
    expect(html).toContain("完成底座收编");
    expect(html).toContain("适配液态玻璃样式");
    expect(html).toContain("运行单测验证");
    expect(html).toContain('data-agy-progress-ring="active"');
    expect(html).toContain('data-agy-step-indicator="in_progress"');
    expect(html).toContain('data-agy-step-indicator="completed"');
    expect(html).toContain('data-agy-step-indicator="pending"');
    expect(html).toContain("[[data-pmx-glass=&#x27;1&#x27;]_&amp;]");
    expect(html).not.toContain("bg-black");
    expect(html).not.toContain("bg-white");
    expect(html).not.toContain("text-white");
  });
});
