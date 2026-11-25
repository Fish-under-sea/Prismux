import { MessageId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import type { WorkLogEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { deriveMessagesTimelineRows } from "./MessagesTimeline.logic";
import {
  classifyWorkEntryActivity,
  extractReasoningSummaryLine,
  formatDshDurationCompact,
  formatDshLiveActivityLabel,
  formatDshStepGroupSummary,
  formatDshTurnFoldLabel,
  resolveTurnFoldExpanded,
  resolveWorkStepsPolicy,
  shouldGroupWorkStepsForTurn,
  shouldKeepIntermediateAssistantRepliesVisible,
  shouldTurnFoldDefaultOpen,
} from "./dshWorkSteps.logic";

type TimelineEntry = Parameters<typeof deriveMessagesTimelineRows>[0]["timelineEntries"][number];

function makeWorkEntry(overrides: Partial<WorkLogEntry> & { id: string }): WorkLogEntry {
  const { id, createdAt, label, tone, ...rest } = overrides;
  return {
    id,
    createdAt: createdAt ?? "2026-11-25T10:00:01.000Z",
    label: label ?? "Read file",
    tone: tone ?? "tool",
    ...rest,
  };
}

function makeMessage(
  id: string,
  role: "user" | "assistant",
  text: string,
  createdAt: string,
  runId: RunId | null = null,
): ChatMessage {
  return {
    id: MessageId.make(id),
    role,
    text,
    runId,
    createdAt,
    updatedAt: createdAt,
    streaming: false,
  };
}

describe("dshWorkSteps.logic", () => {
  it("resolves exact 4-mode DSH presentation policy matrix", () => {
    expect(resolveWorkStepsPolicy("concise")).toEqual({
      mode: "concise",
      foldCompletedTurns: true,
      stepGrouping: "collapsed",
      liveProcessDetail: false,
      settledReasoningPreview: false,
    });
    expect(resolveWorkStepsPolicy("standard")).toEqual({
      mode: "standard",
      foldCompletedTurns: true,
      stepGrouping: "collapsed",
      liveProcessDetail: true,
      settledReasoningPreview: true,
    });
    expect(resolveWorkStepsPolicy("detailed")).toEqual({
      mode: "detailed",
      foldCompletedTurns: true,
      stepGrouping: "history",
      liveProcessDetail: true,
      settledReasoningPreview: true,
    });
    expect(resolveWorkStepsPolicy("expanded")).toEqual({
      mode: "expanded",
      foldCompletedTurns: false,
      stepGrouping: "none",
      liveProcessDetail: false,
      settledReasoningPreview: true,
    });
  });

  it("controls grouping, default turn expansion, and intermediate reply visibility across modes & timing", () => {
    const detailed = resolveWorkStepsPolicy("detailed");
    const expanded = resolveWorkStepsPolicy("expanded");
    const standard = resolveWorkStepsPolicy("standard");

    // detailed: ungrouped on active turn & bottom completed turn when next-message; grouped on history
    expect(
      shouldGroupWorkStepsForTurn(detailed, {
        isActiveTurn: true,
        isBottomCompletedTurn: false,
        collapseTiming: "after-turn",
      }),
    ).toBe(false);
    expect(
      shouldGroupWorkStepsForTurn(detailed, {
        isActiveTurn: false,
        isBottomCompletedTurn: true,
        collapseTiming: "next-message",
      }),
    ).toBe(false);
    expect(
      shouldGroupWorkStepsForTurn(detailed, {
        isActiveTurn: false,
        isBottomCompletedTurn: true,
        collapseTiming: "after-turn",
      }),
    ).toBe(true);
    expect(
      shouldGroupWorkStepsForTurn(expanded, {
        isActiveTurn: false,
        isBottomCompletedTurn: false,
        collapseTiming: "after-turn",
      }),
    ).toBe(false);
    expect(
      shouldGroupWorkStepsForTurn(standard, {
        isActiveTurn: true,
        isBottomCompletedTurn: false,
        collapseTiming: "after-turn",
      }),
    ).toBe(true);

    const runId = RunId.make("run-latest");
    expect(
      shouldTurnFoldDefaultOpen({ isBottomCompletedTurn: true, collapseTiming: "next-message" }),
    ).toBe(true);
    expect(
      shouldTurnFoldDefaultOpen({ isBottomCompletedTurn: true, collapseTiming: "after-turn" }),
    ).toBe(false);
    expect(
      resolveTurnFoldExpanded({
        runId,
        isBottomCompletedTurn: true,
        collapseTiming: "next-message",
        collapsedRunIds: new Set(),
      }),
    ).toBe(true);
    expect(
      resolveTurnFoldExpanded({
        runId,
        isBottomCompletedTurn: true,
        collapseTiming: "next-message",
        collapsedRunIds: new Set([runId]),
      }),
    ).toBe(false);
    expect(
      resolveTurnFoldExpanded({
        runId,
        isBottomCompletedTurn: true,
        collapseTiming: "after-turn",
        expandedRunIds: new Set([runId]),
      }),
    ).toBe(true);

    expect(shouldKeepIntermediateAssistantRepliesVisible("all")).toBe(true);
    expect(shouldKeepIntermediateAssistantRepliesVisible("final-only")).toBe(false);
  });

  it("formats count-free Chinese step summary chips, live activity labels, reasoning previews, and turn labels", () => {
    const readEntry = makeWorkEntry({
      id: "w-read",
      label: "Read file",
      toolTitle: "read_file",
      toolData: { input: { file_path: "/repo/src/app.ts" } },
    });
    const searchEntry = makeWorkEntry({
      id: "w-search",
      label: "Search",
      toolTitle: "grep_search",
      toolData: { input: { query: "workStepsDisplay" } },
    });
    const editEntry = makeWorkEntry({
      id: "w-edit",
      label: "Edit",
      toolTitle: "edit_file",
      itemType: "file_change",
    });
    const cmdEntry = makeWorkEntry({
      id: "w-cmd",
      label: "Run command",
      itemType: "command_execution",
      command: "vp test run",
    });
    const webEntry = makeWorkEntry({
      id: "w-web",
      label: "Web search",
      itemType: "web_search",
    });
    const thinkEntry = makeWorkEntry({
      id: "w-think",
      label: "Thinking",
      itemType: "reasoning",
      tone: "thinking",
      detail: "## Inspecting timeline logic\nChecking edge cases",
    });

    expect(classifyWorkEntryActivity(thinkEntry)).toBe("thinking");
    expect(classifyWorkEntryActivity(readEntry)).toBe("read");
    expect(classifyWorkEntryActivity(searchEntry)).toBe("search");
    expect(classifyWorkEntryActivity(editEntry)).toBe("edit");
    expect(classifyWorkEntryActivity(cmdEntry)).toBe("commands");
    expect(classifyWorkEntryActivity(webEntry)).toBe("webSearch");

    // Count-free DSH Chinese summaries
    expect(formatDshStepGroupSummary([readEntry], "zh-CN")).toBe("已读取文件");
    expect(formatDshStepGroupSummary([readEntry, searchEntry], "zh-CN")).toBe("已读取文件并搜索代码");
    expect(formatDshStepGroupSummary([readEntry, editEntry, cmdEntry], "zh-CN")).toBe(
      "已读取文件，修改了文件，执行了命令",
    );
    expect(formatDshStepGroupSummary([readEntry, editEntry, cmdEntry, webEntry], "zh-CN")).toBe(
      "已读取文件，修改了文件，执行了命令等",
    );
    expect(formatDshStepGroupSummary([thinkEntry, readEntry], "zh-CN")).toBe("已读取文件");
    expect(formatDshStepGroupSummary([thinkEntry], "zh-CN")).toBe("已思考");

    // Live header: concise omits detail, standard includes verb · detail
    const conciseLive = formatDshLiveActivityLabel(readEntry, {
      liveProcessDetail: false,
      workspaceRoot: "/repo",
      locale: "zh-CN",
    });
    expect(conciseLive.text).toBe("正在读取文件");
    expect(conciseLive.detail).toBeNull();

    const standardLive = formatDshLiveActivityLabel(readEntry, {
      liveProcessDetail: true,
      workspaceRoot: "/repo",
      locale: "zh-CN",
    });
    expect(standardLive.verb).toBe("正在读取文件");
    expect(standardLive.detail).toBe("repo/src/app.ts");
    expect(standardLive.text).toBe("正在读取文件 · repo/src/app.ts");

    // Settled reasoning preview omitted in concise, shown in standard
    expect(
      extractReasoningSummaryLine(thinkEntry.detail, {
        live: false,
        settledReasoningPreview: false,
      }),
    ).toBeNull();
    expect(
      extractReasoningSummaryLine(thinkEntry.detail, {
        live: false,
        settledReasoningPreview: true,
      }),
    ).toBe("Inspecting timeline logic");

    // Outer turn fold labels & duration formatting
    expect(formatDshDurationCompact(12_400)).toBe("12s");
    expect(formatDshDurationCompact(75_000)).toBe("1m 15s");
    expect(
      formatDshTurnFoldLabel({ elapsedMs: 12_400, status: "completed", locale: "zh-CN" }),
    ).toEqual({
      prefix: "已完成，用时 ",
      durationNumber: "12s",
      fullText: "已完成，用时 12s",
    });
    expect(
      formatDshTurnFoldLabel({ elapsedMs: null, status: "error", locale: "zh-CN" }).fullText,
    ).toBe("处理失败");
    expect(
      formatDshTurnFoldLabel({ elapsedMs: null, status: "interrupted", locale: "zh-CN" }).fullText,
    ).toBe("已停止");
  });

  it("integrates all 4 workStepsDisplay modes, collapseTiming, and collapsedAssistantReplyMode in deriveMessagesTimelineRows", () => {
    const run1 = RunId.make("run-1");
    const run2 = RunId.make("run-2");

    const buildTwoTurnTimeline = (): ReadonlyArray<TimelineEntry> => [
      {
        id: "u-1",
        kind: "message",
        createdAt: "2026-11-25T10:00:00.000Z",
        message: makeMessage("u-1", "user", "First prompt", "2026-11-25T10:00:00.000Z"),
      },
      {
        id: "r1-think",
        kind: "work",
        createdAt: "2026-11-25T10:00:01.000Z",
        entry: makeWorkEntry({
          id: "r1-think",
          runId: run1,
          createdAt: "2026-11-25T10:00:01.000Z",
          label: "Thinking",
          itemType: "reasoning",
          tone: "thinking",
          detail: "Checking first file",
        }),
      },
      {
        id: "r1-read",
        kind: "work",
        createdAt: "2026-11-25T10:00:02.000Z",
        entry: makeWorkEntry({
          id: "r1-read",
          runId: run1,
          createdAt: "2026-11-25T10:00:02.000Z",
          label: "Read file",
          toolTitle: "read_file",
          toolData: { input: { file_path: "/repo/a.ts" } },
        }),
      },
      {
        id: "a-1-mid",
        kind: "message",
        createdAt: "2026-11-25T10:00:03.000Z",
        message: makeMessage("a-1-mid", "assistant", "Intermediate note", "2026-11-25T10:00:03.000Z", run1),
      },
      {
        id: "r1-cmd",
        kind: "work",
        createdAt: "2026-11-25T10:00:04.000Z",
        entry: makeWorkEntry({
          id: "r1-cmd",
          runId: run1,
          createdAt: "2026-11-25T10:00:04.000Z",
          label: "Run tests",
          itemType: "command_execution",
          command: "vp test run",
        }),
      },
      {
        id: "a-1-final",
        kind: "message",
        createdAt: "2026-11-25T10:00:10.000Z",
        message: makeMessage("a-1-final", "assistant", "First final answer", "2026-11-25T10:00:10.000Z", run1),
      },
      {
        id: "u-2",
        kind: "message",
        createdAt: "2026-11-25T10:01:00.000Z",
        message: makeMessage("u-2", "user", "Second prompt", "2026-11-25T10:01:00.000Z"),
      },
      {
        id: "r2-think",
        kind: "work",
        createdAt: "2026-11-25T10:01:01.000Z",
        entry: makeWorkEntry({
          id: "r2-think",
          runId: run2,
          createdAt: "2026-11-25T10:01:01.000Z",
          label: "Thinking",
          itemType: "reasoning",
          tone: "thinking",
          detail: "Checking second file",
        }),
      },
      {
        id: "r2-edit",
        kind: "work",
        createdAt: "2026-11-25T10:01:02.000Z",
        entry: makeWorkEntry({
          id: "r2-edit",
          runId: run2,
          createdAt: "2026-11-25T10:01:02.000Z",
          label: "Edit file",
          itemType: "file_change",
          changedFiles: ["/repo/b.ts"],
        }),
      },
      {
        id: "a-2-final",
        kind: "message",
        createdAt: "2026-11-25T10:01:12.000Z",
        message: makeMessage("a-2-final", "assistant", "Second final answer", "2026-11-25T10:01:12.000Z", run2),
      },
    ];

    const baseInput = {
      turnDiffSummaries: [],
      supportsConversationRollback: false,
      isWorking: false,
      activeTurnStartedAt: null,
      locale: "zh-CN",
    } as const;

    // 1. standard + after-turn + all: both completed turns fold, intermediate assistant reply stays visible
    const standardAll = deriveMessagesTimelineRows({
      ...baseInput,
      timelineEntries: buildTwoTurnTimeline(),
      workStepsDisplay: "standard",
      workStepsCollapseTiming: "after-turn",
      collapsedAssistantReplyMode: "all",
    });
    const standardFolds = standardAll.filter((r) => r.kind === "turn-fold");
    expect(standardFolds).toHaveLength(2);
    expect(standardFolds[0]!.expanded).toBe(false);
    expect(standardFolds[0]!.labelPrefix).toBe("已完成，用时 ");
    expect(standardFolds[0]!.durationNumber).toBeTruthy();
    expect(standardFolds[1]!.expanded).toBe(false);
    expect(standardFolds[1]!.labelPrefix).toBe("已完成，用时 ");
    expect(
      standardAll.some((r) => r.kind === "message" && r.message.text === "Intermediate note"),
    ).toBe(true);

    // 2. standard + after-turn + final-only: intermediate assistant reply folds inside turn 1
    const standardFinalOnly = deriveMessagesTimelineRows({
      ...baseInput,
      timelineEntries: buildTwoTurnTimeline(),
      workStepsDisplay: "standard",
      workStepsCollapseTiming: "after-turn",
      collapsedAssistantReplyMode: "final-only",
    });
    expect(
      standardFinalOnly.some((r) => r.kind === "message" && r.message.text === "Intermediate note"),
    ).toBe(false);
    expect(
      standardFinalOnly.some((r) => r.kind === "message" && r.message.text === "First final answer"),
    ).toBe(true);

    // 3. detailed + next-message: historical turn 1 folds, latest completed turn 2 stays open & flat un-grouped
    const detailedNextMsg = deriveMessagesTimelineRows({
      ...baseInput,
      timelineEntries: buildTwoTurnTimeline(),
      workStepsDisplay: "detailed",
      workStepsCollapseTiming: "next-message",
      collapsedAssistantReplyMode: "all",
    });
    const detailedFolds = detailedNextMsg.filter((r) => r.kind === "turn-fold");
    const detailedFold1 = detailedFolds.find((r) => r.runId === run1);
    const detailedFold2 = detailedFolds.find((r) => r.runId === run2);
    expect(detailedFold1?.expanded).toBe(false);
    expect(detailedFold2?.expanded).toBe(true);
    // Turn 2's thinking + file edit render flat un-grouped as standalone `work` rows!
    expect(
      detailedNextMsg.some(
        (r) => r.kind === "work" && r.groupedEntries.some((entry) => entry.id === "r2-think"),
      ),
    ).toBe(true);
    expect(
      detailedNextMsg.some(
        (r) => r.kind === "work" && r.groupedEntries.some((entry) => entry.id === "r2-edit"),
      ),
    ).toBe(true);

    // 4. expanded: NEVER folds turns or groups steps; all reasoning rows have autoExpandReasoning: true
    const expandedRows = deriveMessagesTimelineRows({
      ...baseInput,
      timelineEntries: buildTwoTurnTimeline(),
      workStepsDisplay: "expanded",
      workStepsCollapseTiming: "after-turn",
      collapsedAssistantReplyMode: "final-only",
    });
    expect(expandedRows.filter((r) => r.kind === "turn-fold")).toHaveLength(0);
    expect(expandedRows.filter((r) => r.kind === "work-toggle")).toHaveLength(0);
    const flatWorkRows = expandedRows.filter((r) => r.kind === "work");
    expect(flatWorkRows.flatMap((r) => r.groupedEntries.map((entry) => entry.id))).toEqual([
      "r1-think",
      "r1-read",
      "r1-cmd",
      "r2-think",
      "r2-edit",
    ]);
    const reasoningRows = flatWorkRows.filter((r) =>
      r.groupedEntries.some((entry) => entry.itemType === "reasoning"),
    );
    expect(reasoningRows).toHaveLength(2);
    expect(reasoningRows.every((r) => r.autoExpandReasoning === true)).toBe(true);

    // 5. concise vs standard vs detailed on active running turn
    const liveRunId = RunId.make("run-live");
    const activeEntries: ReadonlyArray<TimelineEntry> = [
      {
        id: "u-live",
        kind: "message",
        createdAt: "2026-11-25T10:02:00.000Z",
        message: makeMessage("u-live", "user", "Live task", "2026-11-25T10:02:00.000Z"),
      },
      {
        id: "live-read",
        kind: "work",
        createdAt: "2026-11-25T10:02:01.000Z",
        entry: makeWorkEntry({
          id: "live-read",
          runId: liveRunId,
          createdAt: "2026-11-25T10:02:01.000Z",
          label: "Read file",
          toolTitle: "read_file",
          toolLifecycleStatus: "inProgress",
          toolData: { input: { file_path: "/repo/src/index.ts" } },
        }),
      },
    ];
    const activeBase = {
      timelineEntries: activeEntries,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
      runningRunId: liveRunId,
      isWorking: true,
      activeTurnStartedAt: "2026-11-25T10:02:00.000Z",
      locale: "zh-CN",
    } as const;

    const conciseActive = deriveMessagesTimelineRows({
      ...activeBase,
      workStepsDisplay: "concise",
    });
    const conciseLiveRow = conciseActive.find((r) => r.kind === "work-live");
    expect(conciseLiveRow?.dshMode).toBe("concise");
    expect(conciseLiveRow?.liveProcessDetail).toBe(false);

    const standardActive = deriveMessagesTimelineRows({
      ...activeBase,
      workStepsDisplay: "standard",
    });
    const standardLiveRow = standardActive.find((r) => r.kind === "work-live");
    expect(standardLiveRow?.dshMode).toBe("standard");
    expect(standardLiveRow?.liveProcessDetail).toBe(true);

    const detailedActive = deriveMessagesTimelineRows({
      ...activeBase,
      workStepsDisplay: "detailed",
    });
    expect(detailedActive.some((r) => r.kind === "work-live")).toBe(false);
    expect(
      detailedActive.some(
        (r) => r.kind === "work" && r.groupedEntries.some((entry) => entry.id === "live-read"),
      ),
    ).toBe(true);
  });
});
