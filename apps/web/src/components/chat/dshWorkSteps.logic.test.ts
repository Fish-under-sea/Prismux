import { MessageId, RunId } from "@prismux/core-contracts";
import { describe, expect, it } from "vite-plus/test";
import type { WorkLogEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { deriveMessagesTimelineRows } from "./MessagesTimeline.logic";
import {
  classifyPrimaryStepGroupActivity,
  classifyWorkEntryActivity,
  extractReadLineRangeLabel,
  extractReasoningSummaryLine,
  extractWorkEntryLiveDetail,
  extractWorkStepCollapsedPreview,
  formatDshDurationCompact,
  formatDshLiveActivityLabel,
  formatDshStepGroupSummary,
  formatDshTurnFoldLabel,
  formatFileChangeAction,
  formatThinkingHeaderLabel,
  formatWorkStepElapsedMs,
  latestCompletedParagraphFirstLine,
  localizeWorkStepLabel,
  parseCompactDiffPreview,
  resolveTurnFoldExpanded,
  resolveWorkStepsPolicy,
  shouldGroupWorkStepsForTurn,
  shouldKeepIntermediateAssistantRepliesVisible,
  shouldTurnFoldDefaultOpen,
  splitDisplayFilePath,
  stripShellCommandWrapper,
} from "./dshWorkSteps.logic";
import { workEntryDisplayLabel, workEntryIsVisibleInGroup } from "./MessagesTimeline.logic";

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
      defaultTurnFoldOpen: false,
      stepGrouping: "collapsed",
      liveProcessDetail: false,
      settledReasoningPreview: false,
      defaultExpandLongItems: false,
    });
    expect(resolveWorkStepsPolicy("standard")).toEqual({
      mode: "standard",
      foldCompletedTurns: true,
      defaultTurnFoldOpen: false,
      stepGrouping: "collapsed",
      liveProcessDetail: true,
      settledReasoningPreview: true,
      defaultExpandLongItems: false,
    });
    expect(resolveWorkStepsPolicy("detailed")).toEqual({
      mode: "detailed",
      foldCompletedTurns: true,
      defaultTurnFoldOpen: false,
      stepGrouping: "none",
      liveProcessDetail: true,
      settledReasoningPreview: true,
      defaultExpandLongItems: false,
    });
    expect(resolveWorkStepsPolicy("expanded")).toEqual({
      mode: "expanded",
      foldCompletedTurns: false,
      defaultTurnFoldOpen: true,
      stepGrouping: "none",
      liveProcessDetail: false,
      settledReasoningPreview: true,
      defaultExpandLongItems: true,
    });
  });

  it("controls grouping, default turn expansion, and intermediate reply visibility across modes & timing", () => {
    const detailed = resolveWorkStepsPolicy("detailed");
    const expanded = resolveWorkStepsPolicy("expanded");
    const standard = resolveWorkStepsPolicy("standard");

    // detailed: transparent & flat on ALL turns (never buries steps in collapsed buckets)
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
    ).toBe(false);
    expect(
      shouldGroupWorkStepsForTurn(detailed, {
        isActiveTurn: false,
        isBottomCompletedTurn: false,
        collapseTiming: "after-turn",
      }),
    ).toBe(false);
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
      shouldTurnFoldDefaultOpen({
        isBottomCompletedTurn: false,
        collapseTiming: "after-turn",
        defaultTurnFoldOpen: true,
      }),
    ).toBe(true);
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
        isBottomCompletedTurn: false,
        collapseTiming: "after-turn",
        defaultTurnFoldOpen: true,
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
    expect(formatDshStepGroupSummary([readEntry, searchEntry], "zh-CN")).toBe(
      "已读取文件并搜索代码",
    );
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
        message: makeMessage(
          "a-1-mid",
          "assistant",
          "Intermediate note",
          "2026-11-25T10:00:03.000Z",
          run1,
        ),
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
        message: makeMessage(
          "a-1-final",
          "assistant",
          "First final answer",
          "2026-11-25T10:00:10.000Z",
          run1,
        ),
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
        message: makeMessage(
          "a-2-final",
          "assistant",
          "Second final answer",
          "2026-11-25T10:01:12.000Z",
          run2,
        ),
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
      standardFinalOnly.some(
        (r) => r.kind === "message" && r.message.text === "First final answer",
      ),
    ).toBe(true);

    // 3a. detailed + after-turn: completed turns auto-collapse when answer ends,
    // and expanding a turn shows all steps transparently flat (zero work-toggle) with long items still folded
    const detailedAfterTurnRows = deriveMessagesTimelineRows({
      ...baseInput,
      timelineEntries: buildTwoTurnTimeline(),
      workStepsDisplay: "detailed",
      workStepsCollapseTiming: "after-turn",
      collapsedAssistantReplyMode: "all",
    });
    const detailedAfterTurnFolds = detailedAfterTurnRows.filter((r) => r.kind === "turn-fold");
    expect(detailedAfterTurnFolds.find((r) => r.runId === run1)?.expanded).toBe(false);
    expect(detailedAfterTurnFolds.find((r) => r.runId === run2)?.expanded).toBe(false);
    expect(detailedAfterTurnRows.filter((r) => r.kind === "work")).toHaveLength(0);
    expect(detailedAfterTurnRows.filter((r) => r.kind === "work-toggle")).toHaveLength(0);

    // Expanding both turns in detailed mode renders every step flat & un-grouped (zero work-toggle)
    const detailedExpandedBoth = deriveMessagesTimelineRows({
      ...baseInput,
      timelineEntries: buildTwoTurnTimeline(),
      expandedRunIds: new Set([run1, run2]),
      workStepsDisplay: "detailed",
      workStepsCollapseTiming: "after-turn",
      collapsedAssistantReplyMode: "all",
    });
    expect(detailedExpandedBoth.filter((r) => r.kind === "work-toggle")).toHaveLength(0);
    const detailedFlatWorkRows = detailedExpandedBoth.filter((r) => r.kind === "work");
    expect(detailedFlatWorkRows.flatMap((r) => r.groupedEntries.map((entry) => entry.id))).toEqual([
      "r1-think",
      "r1-read",
      "r1-cmd",
      "r2-think",
      "r2-edit",
    ]);
    expect(detailedFlatWorkRows.every((r) => r.autoExpandDetails === undefined)).toBe(true);
    expect(detailedFlatWorkRows.every((r) => r.autoExpandReasoning === undefined)).toBe(true);

    // 3b. detailed + next-message: bottom completed turn stays open & flat while earlier turn auto-collapses
    const detailedNextMessageRows = deriveMessagesTimelineRows({
      ...baseInput,
      timelineEntries: buildTwoTurnTimeline(),
      workStepsDisplay: "detailed",
      workStepsCollapseTiming: "next-message",
      collapsedAssistantReplyMode: "all",
    });
    const detailedNextMessageFolds = detailedNextMessageRows.filter((r) => r.kind === "turn-fold");
    expect(detailedNextMessageFolds.find((r) => r.runId === run1)?.expanded).toBe(false);
    expect(detailedNextMessageFolds.find((r) => r.runId === run2)?.expanded).toBe(true);
    expect(detailedNextMessageRows.filter((r) => r.kind === "work-toggle")).toHaveLength(0);
    expect(
      detailedNextMessageRows
        .filter((r) => r.kind === "work")
        .flatMap((r) => r.groupedEntries.map((entry) => entry.id)),
    ).toEqual(["r2-think", "r2-edit"]);

    // Manually collapsing bottom turn in detailed + next-message still folds it cleanly
    const detailedCollapsedTurn2 = deriveMessagesTimelineRows({
      ...baseInput,
      timelineEntries: buildTwoTurnTimeline(),
      collapsedRunIds: new Set([run2]),
      workStepsDisplay: "detailed",
      workStepsCollapseTiming: "next-message",
      collapsedAssistantReplyMode: "all",
    });
    const detailedCollapsedFolds = detailedCollapsedTurn2.filter((r) => r.kind === "turn-fold");
    expect(detailedCollapsedFolds.find((r) => r.runId === run1)?.expanded).toBe(false);
    expect(detailedCollapsedFolds.find((r) => r.runId === run2)?.expanded).toBe(false);

    // 3c. Completed latestRun with omitted completedAt still auto-collapses cleanly under after-turn
    const completedWithoutTimestamp = deriveMessagesTimelineRows({
      ...baseInput,
      timelineEntries: buildTwoTurnTimeline(),
      latestRun: {
        runId: run2,
        status: "completed",
        startedAt: "2026-11-25T10:01:00.000Z",
        completedAt: null,
      },
      workStepsDisplay: "detailed",
      workStepsCollapseTiming: "after-turn",
    });
    expect(
      completedWithoutTimestamp.filter((r) => r.kind === "turn-fold").find((r) => r.runId === run2)
        ?.expanded,
    ).toBe(false);

    // 4. expanded: NEVER folds turns or groups steps; ALL work rows default open inline (`autoExpandDetails: true` & `autoExpandReasoning: true`)
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
    expect(flatWorkRows.every((r) => r.autoExpandDetails === true)).toBe(true);
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

  it("strips noisy Windows/POSIX shell wrappers while keeping raw command inspectable", () => {
    const doubleEscapedPwsh = stripShellCommandWrapper(
      "\"C:\\\\Program Files\\\\PowerShell\\\\7\\\\pwsh.exe\" -Command 'pwd; ls -Name'",
    );
    expect(doubleEscapedPwsh.displayCommand).toBe("pwd; ls -Name");
    expect(doubleEscapedPwsh.wasWrapped).toBe(true);
    expect(doubleEscapedPwsh.shellLabel).toBe("pwsh");
    expect(doubleEscapedPwsh.rawCommand).toContain("pwsh.exe");

    const flaggedPwsh = stripShellCommandWrapper(
      'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "git status --short"',
    );
    expect(flaggedPwsh.displayCommand).toBe("git status --short");
    expect(flaggedPwsh.wasWrapped).toBe(true);

    const cmdWrapped = stripShellCommandWrapper('cmd.exe /c "echo hello world"');
    expect(cmdWrapped.displayCommand).toBe("echo hello world");
    expect(cmdWrapped.wasWrapped).toBe(true);
    expect(cmdWrapped.shellLabel).toBe("cmd");

    const bashWrapped = stripShellCommandWrapper("/bin/bash -lc 'rg workStepsDisplay src/'");
    expect(bashWrapped.displayCommand).toBe("rg workStepsDisplay src/");
    expect(bashWrapped.wasWrapped).toBe(true);

    const plain = stripShellCommandWrapper("vp test run");
    expect(plain.displayCommand).toBe("vp test run");
    expect(plain.wasWrapped).toBe(false);

    const cmdEntry = makeWorkEntry({
      id: "w-pwsh",
      label: "Ran command",
      itemType: "command_execution",
      command: "\"C:\\\\Program Files\\\\PowerShell\\\\7\\\\pwsh.exe\" -Command 'pwd; ls -Name'",
    });
    expect(extractWorkEntryLiveDetail(cmdEntry)).toBe("pwd; ls -Name");
    expect(workEntryDisplayLabel(cmdEntry, undefined)).toBe("pwd; ls -Name");
  });

  it("formats step durations, thinking labels, file-change actions, diff previews, and read line ranges", () => {
    expect(formatWorkStepElapsedMs(142)).toBe("142ms");
    expect(formatWorkStepElapsedMs(2_400)).toBe("2.4s");
    expect(formatWorkStepElapsedMs(12_300)).toBe("12s");
    expect(formatWorkStepElapsedMs(75_000)).toBe("1m 15s");

    expect(formatThinkingHeaderLabel({ live: true, locale: "zh-CN" })).toBe("正在思考");
    expect(formatThinkingHeaderLabel({ live: false, elapsedMs: 2_400, locale: "zh-CN" })).toBe(
      "思考了 2.4s",
    );
    expect(formatThinkingHeaderLabel({ live: false, elapsedMs: null, locale: "zh-CN" })).toBe(
      "思考",
    );
    expect(formatThinkingHeaderLabel({ live: false, elapsedMs: 2_400, locale: "en-US" })).toBe(
      "Thought for 2.4s",
    );

    expect(formatFileChangeAction("add", "zh-CN")).toEqual({ kind: "add", label: "新增" });
    expect(formatFileChangeAction("update", "zh-CN")).toEqual({ kind: "edit", label: "修改" });
    expect(formatFileChangeAction("delete", "zh-CN")).toEqual({ kind: "delete", label: "删除" });
    expect(formatFileChangeAction("rename", "zh-CN")).toEqual({ kind: "rename", label: "重命名" });
    expect(splitDisplayFilePath("Prismux/pelican.html")).toEqual({
      basename: "pelican.html",
      dirPath: "Prismux",
    });

    const unified = parseCompactDiffPreview({
      diffStr: [
        "diff --git a/pelican.html b/pelican.html",
        "--- a/pelican.html",
        "+++ b/pelican.html",
        "@@ -1,2 +1,3 @@",
        " <html>",
        "-<title>Old</title>",
        "+<title>New</title>",
        "+<body>Pelican</body>",
      ].join("\n"),
    });
    expect(unified).not.toBeNull();
    expect(unified?.additions).toBe(2);
    expect(unified?.deletions).toBe(1);
    expect(unified?.lines.map((line) => line.kind)).toEqual([
      "hunk",
      "context",
      "del",
      "add",
      "add",
    ]);

    const oldNew = parseCompactDiffPreview({ oldStr: "a\nb", newStr: "a\nc\nd" });
    expect(oldNew?.deletions).toBe(2);
    expect(oldNew?.additions).toBe(3);

    const readWithRange = makeWorkEntry({
      id: "w-read-range",
      label: "Read",
      toolData: { input: { file_path: "src/app.ts", startLine: 10, endLine: 85 } },
    });
    expect(extractReadLineRangeLabel(readWithRange)).toBe("L10-L85");

    const thinkToneOnly = makeWorkEntry({
      id: "w-think-tone",
      label: "Thinking",
      tone: "thinking",
      detail: "**Inspecting reasoning chain**\nVerifying output.",
    });
    expect(workEntryIsVisibleInGroup(thinkToneOnly, false)).toBe(true);
    expect(
      extractReasoningSummaryLine(thinkToneOnly.detail, {
        live: false,
        settledReasoningPreview: true,
      }),
    ).toBe("Inspecting reasoning chain");
  });

  it("tracks latest completed paragraph first line while streaming reasoning and picks primary group activity", () => {
    expect(
      latestCompletedParagraphFirstLine(
        "**Step 1: Read files**\nReading index.ts\n\n**Step 2: Run pwsh**\nChecking $PSVersionTable",
      ),
    ).toBe("Step 2: Run pwsh");

    // Incomplete second paragraph without newline keeps the first completed paragraph heading
    expect(
      latestCompletedParagraphFirstLine(
        "**Step 1: Read files**\nReading index.ts\n\nStep 2 still typing without newline",
      ),
    ).toBe("Step 1: Read files");

    // Live summary uses latest completed paragraph first line, and falls back to first line before first newline
    expect(
      extractReasoningSummaryLine(
        "**Step 1: Read files**\nReading index.ts\n\n**Step 2: Run pwsh**\nChecking output",
        { live: true, settledReasoningPreview: false },
      ),
    ).toBe("Step 2: Run pwsh");
    expect(
      extractReasoningSummaryLine("Initial streaming thought without newline", {
        live: true,
        settledReasoningPreview: false,
      }),
    ).toBe("Initial streaming thought without newline");

    const think = makeWorkEntry({ id: "t", itemType: "reasoning", tone: "thinking", detail: "hi" });
    const cmd1 = makeWorkEntry({ id: "c1", itemType: "command_execution", command: "ls" });
    const cmd2 = makeWorkEntry({ id: "c2", itemType: "command_execution", command: "pwd" });
    const read = makeWorkEntry({
      id: "r1",
      toolTitle: "read_file",
      toolData: { input: { file_path: "a.ts" } },
    });
    expect(classifyPrimaryStepGroupActivity([think, cmd1])).toBe("commands");
    expect(classifyPrimaryStepGroupActivity([read, cmd1, cmd2])).toBe("commands");
    expect(classifyPrimaryStepGroupActivity([read])).toBe("read");
  });

  it("keeps reasoning separate from tool groups when expanding a standard or concise turn", () => {
    const runId = RunId.make("run-sep");
    const entries: ReadonlyArray<TimelineEntry> = [
      {
        id: "u1",
        kind: "message",
        createdAt: "2026-11-25T10:00:00.000Z",
        message: makeMessage("u1", "user", "Check version", "2026-11-25T10:00:00.000Z"),
      },
      {
        id: "t1",
        kind: "work",
        createdAt: "2026-11-25T10:00:01.000Z",
        entry: makeWorkEntry({
          id: "t1",
          runId,
          itemType: "reasoning",
          tone: "thinking",
          label: "Thinking",
          detail: "User wants me to inspect pwsh.",
        }),
      },
      {
        id: "c1",
        kind: "work",
        createdAt: "2026-11-25T10:00:03.000Z",
        entry: makeWorkEntry({
          id: "c1",
          runId,
          itemType: "command_execution",
          label: "Ran command",
          command: "$PSVersionTable | Format-List",
        }),
      },
      {
        id: "a1",
        kind: "message",
        createdAt: "2026-11-25T10:00:09.000Z",
        message: makeMessage("a1", "assistant", "Done", "2026-11-25T10:00:09.000Z", runId),
      },
    ];

    for (const mode of ["concise", "standard"] as const) {
      const rows = deriveMessagesTimelineRows({
        timelineEntries: entries,
        expandedRunIds: new Set([runId]),
        turnDiffSummaries: [],
        supportsConversationRollback: false,
        isWorking: false,
        activeTurnStartedAt: null,
        workStepsDisplay: mode,
        locale: "zh-CN",
      });
      expect(rows.map((r) => r.kind)).toEqual([
        "message",
        "turn-fold",
        "work",
        "work-toggle",
        "message",
      ]);
      const reasonRow = rows[2]!;
      const toggleRow = rows[3]!;
      expect(reasonRow.kind === "work" && reasonRow.groupedEntries.map((e) => e.id)).toEqual([
        "t1",
      ]);
      expect(reasonRow.kind === "work" && reasonRow.autoExpandReasoning).toBeUndefined();
      expect(toggleRow).toMatchObject({
        kind: "work-toggle",
        summary: "已执行命令",
        dshPrimaryCategory: "commands",
        hiddenCount: 1,
      });
    }
  });

  it("localizes every English work-step verb and action header in zh-CN while preserving en-US", () => {
    const zhCases: ReadonlyArray<readonly [string, string]> = [
      ["Worked for 12s", "已完成，用时 12s"],
      ["Thought for 3.2s", "思考了 3.2s"],
      ["Ran command", "已执行命令"],
      ["Run command", "执行命令"],
      ["Running command", "正在执行命令"],
      ["Edited file", "已修改文件"],
      ["Read file", "已读取文件"],
      ["Searched", "已搜索代码"],
      ["File change", "文件修改"],
      ["Web search", "网页搜索"],
      ["Web fetch", "网页抓取"],
      ["Command", "执行命令"],
      ["Reasoning", "思考过程"],
      ["Output", "输出"],
      ["Input", "输入"],
      ["Arguments", "参数"],
      ["Result", "结果"],
      ["Subagent", "子智能体"],
      ["MCP tool", "MCP 工具"],
      ["Tool call", "工具调用"],
      ["Todo list", "任务清单"],
      ["Plan", "执行计划"],
      ["Edited app.ts", "已修改 app.ts"],
      ["Created foo.ts", "已写入 foo.ts"],
      ["Deleted old.ts", "已删除 old.ts"],
      ["Read src/a.ts", "已读取 src/a.ts"],
      ["Fetched https://example.com", "网页抓取：https://example.com"],
      ["Searched workStepsDisplay", "已搜索 workStepsDisplay"],
    ];

    for (const [input, expected] of zhCases) {
      expect(localizeWorkStepLabel(input, "zh-CN"), input).toBe(expected);
      expect(localizeWorkStepLabel(input, "en-US"), input).toBe(input);
    }
  });

  it("extracts crisp 1-line truncated collapsed previews for long work steps in detailed mode", () => {
    const cmdEntry = makeWorkEntry({
      id: "p-cmd",
      itemType: "command_execution",
      command: "vp test run",
      detail: "PASS  apps/web/src/components/chat/dshWorkSteps.logic.test.ts\nAll 12 tests passed.",
    });
    expect(extractWorkStepCollapsedPreview(cmdEntry, { locale: "zh-CN" })).toBe(
      "PASS apps/web/src/components/chat/dshWorkSteps.logic.test.ts",
    );

    const searchEntry = makeWorkEntry({
      id: "p-search",
      itemType: "file_search",
      label: "Searched",
      toolData: {
        input: { query: "workStepsDisplay" },
        output: "src/a.ts:10:const workStepsDisplay = 'detailed';\nsrc/b.ts:22:workStepsDisplay",
      },
    });
    expect(
      extractWorkStepCollapsedPreview(searchEntry, { workspaceRoot: "/repo", locale: "zh-CN" }),
    ).toContain("2 条匹配");

    const webEntry = makeWorkEntry({
      id: "p-web",
      itemType: "web_search",
      label: "Web search",
      toolData: {
        input: { query: "Prismux liquid glass" },
        output: {
          results: [
            { title: "Prismux Design Guide", url: "https://prismux.dev/design" },
            { title: "Glass Spec", url: "https://prismux.dev/glass" },
          ],
        },
      },
    });
    expect(extractWorkStepCollapsedPreview(webEntry, { locale: "zh-CN" })).toContain("2 个来源");

    const todoEntry = makeWorkEntry({
      id: "p-todo",
      label: "Updated plan",
      toolTitle: "update_steps",
      toolData: {
        input: {
          steps: [
            { title: "扫描源码", status: "completed" },
            { title: "接入组件", status: "in_progress" },
            { title: "运行测试", status: "pending" },
          ],
        },
      },
    });
    expect(extractWorkStepCollapsedPreview(todoEntry, { locale: "zh-CN" })).toBe(
      "进行中 · 1/3 步 · 接入组件",
    );

    const dynamicEntry = makeWorkEntry({
      id: "p-dyn",
      itemType: "dynamic_tool",
      label: "mcp.inspect",
      toolData: {
        input: { target: "daemon" },
        output: "healthy: all 4 services online",
      },
    });
    expect(extractWorkStepCollapsedPreview(dynamicEntry, { locale: "zh-CN" })).toBe(
      "healthy: all 4 services online",
    );
  });
});
