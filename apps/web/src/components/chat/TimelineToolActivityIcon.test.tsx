import {
  EnvironmentId,
  NodeId,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@prismux/core-contracts";
import * as DateTime from "effect/DateTime";
import { GTProvider, initializeGT } from "gt-react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import {
  PRISMUX_WORDMARK_TEXT,
  PrismuxWordmark,
  stripFixedSquareClasses,
} from "../PrismuxWordmark";
import { resolveWorkStepsPolicy } from "./dshWorkSteps.logic";
import { isWideToolActivityIcon, ToolActivityIconView } from "./TimelineToolActivityIcon";
import { SimpleWorkEntryRow } from "./TimelineWorkEntryRow";
import { LiveWorkEntryTimelineRow, WorkGroupToggleTimelineRow } from "./TimelineWorkGroupRows";
import { V2LifecycleRow } from "./V2LifecycleRow";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRow,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
} from "./timelineRowContext";

beforeAll(() => {
  initializeGT({
    defaultLocale: "zh",
    locales: ["en", "zh"],
  });
});

function makeSharedState(): TimelineRowSharedState {
  return {
    pendingApprovals: new Map(),
    respondingRequestIds: [],
    canOperateThread: true,
    onRespondToApproval: undefined,
    citationRequest: null,
    onReplyToResponse: undefined,
    listRef: { current: null },
    timestampFormat: "24-hour",
    routeThreadKey: "env-1:thread-1",
    threadRef: {
      environmentId: EnvironmentId.make("env-1"),
      threadId: ThreadId.make("thread-1"),
    },
    markdownCwd: "D:\\Fish-code\\Prismux",
    resolvedTheme: "dark",
    workspaceRoot: "D:\\Fish-code\\Prismux",
    skills: [],
    runs: [],
    activeThreadEnvironmentId: EnvironmentId.make("env-1"),
    onRevertToTurnCount: () => undefined,
    onUseArtifactTemplate: () => undefined,
    onSendAppMessage: undefined,
    onAppFullscreenChange: () => undefined,
    onRunShellCommand: undefined,
    findActive: false,
    onImageExpand: () => undefined,
    onFileOpen: () => undefined,
    onFileDownload: () => undefined,
    openPullRequest: () => undefined,
    onOpenToolDiff: () => undefined,
    onOpenTurnDiff: undefined,
    renderHtmlRender: undefined,
    turnItemSource: undefined,
    onOpenThread: () => undefined,
    workflowOpening: null,
    onForkFromRun: undefined,
    onToggleTurnFold: () => undefined,
    onToggleAttemptFold: () => undefined,
    onToggleWorkGroup: () => undefined,
    onToggleWorkEntry: () => undefined,
    onCancelWorktreeSetup: null,
    retryableWorkspacePreparationRunIds: new Set(),
    onRetryWorkspacePreparation: null,
    onWorktreeSetupWorkLocally: null,
    onOpenWorktreeSetupTerminal: null,
    workGroupViewState: {
      scrollPositions: new Map(),
      expandedEntries: new Set(),
    },
    workStepsPolicy: resolveWorkStepsPolicy("standard"),
    locale: "zh-CN",
    turnDisclosureResetCount: 0,
  };
}

const DEFAULT_ACTIVITY: TimelineRowActivityState = {
  isWorking: false,
  isCompacting: false,
  isRevertingCheckpoint: false,
  backgroundWorktreeSetup: null,
  awaitingUser: false,
  isPreparingWorktree: false,
  providerStartingLabel: null,
  latestRunId: null,
  liveAnswerPreview: null,
};

function makeDynamicToolEntry(overrides: {
  readonly id: string;
  readonly label: string;
  readonly toolName: string;
  readonly status: "completed" | "inProgress";
}): WorkLogEntry {
  const item: OrchestrationV2ProjectedTurnItem["item"] = {
    id: TurnItemId.make(overrides.id),
    threadId: ThreadId.make("thread-1"),
    runId: RunId.make("run-1"),
    nodeId: NodeId.make(`node-${overrides.id}`),
    providerThreadId: ProviderThreadId.make("pt-1"),
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: overrides.status === "inProgress" ? "running" : "completed",
    title: null,
    startedAt: DateTime.makeUnsafe("2026-11-26T10:00:00.000Z"),
    completedAt:
      overrides.status === "inProgress" ? null : DateTime.makeUnsafe("2026-11-26T10:00:00.250Z"),
    updatedAt: DateTime.makeUnsafe("2026-11-26T10:00:00.250Z"),
    type: "dynamic_tool",
    toolName: overrides.toolName,
    input: { target: "dsh" },
    output: overrides.status === "inProgress" ? undefined : "ok",
  };
  return {
    id: overrides.id,
    createdAt: "2026-11-26T10:00:00.000Z",
    label: overrides.label,
    tone: "tool",
    itemType: "dynamic_tool",
    toolLifecycleStatus: overrides.status,
    structuredPayload: item,
    projectedItem: {
      position: 1,
      visibility: "local",
      sourceThreadId: ThreadId.make("thread-1"),
      sourceItemId: item.id,
      item,
    },
  };
}

describe("PrismuxWordmark & TimelineToolActivityIcon de-T3 branding", () => {
  it("renders exact literal Ciallo～(∠・ω< )⌒★ text, preserves color classes, strips fixed square box classes, and emits zero T3", () => {
    expect(stripFixedSquareClasses("block size-3.5 shrink-0 stroke-2 text-primary")).toBe(
      "shrink-0 text-primary",
    );
    expect(stripFixedSquareClasses("w-4 h-4 size-4 text-icon-muted opacity-70")).toBe(
      "text-icon-muted opacity-70",
    );

    const html = renderToStaticMarkup(
      <PrismuxWordmark className="block size-3.5 shrink-0 stroke-2 text-primary" aria-hidden />,
    );
    expect(html).toContain('data-prismux-wordmark="true"');
    expect(html).toContain("Ciallo～(∠・ω&lt; )⌒★");
    expect(PRISMUX_WORDMARK_TEXT).toBe("Ciallo～(∠・ω< )⌒★");
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("text-2xs");
    expect(html).toContain("text-primary");
    expect(html).not.toContain("size-3.5");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("T3");
  });

  it("replaces residual T3 icon in ToolActivityIconView with Ciallo～(∠・ω< )⌒★ and flags wide icon layout", () => {
    expect(isWideToolActivityIcon(undefined, "t3-code")).toBe(true);
    expect(isWideToolActivityIcon(undefined, "terminal")).toBe(false);
    expect(
      isWideToolActivityIcon({ _tag: "website", pageUrl: "https://example.com" }, "t3-code"),
    ).toBe(false);

    const shared = makeSharedState();
    const html = renderToStaticMarkup(
      <TimelineRowCtx value={shared}>
        <ToolActivityIconView
          icon={undefined}
          fallbackName="t3-code"
          className="block size-3.5 shrink-0 stroke-2 text-primary"
          muted={false}
        />
      </TimelineRowCtx>,
    );
    expect(html).toContain('data-prismux-wordmark="true"');
    expect(html).toContain("Ciallo～(∠・ω&lt; )⌒★");
    expect(html).toContain("text-primary");
    expect(html).not.toContain("size-3.5");
    expect(html).not.toContain("T3");
  });

  it("renders Ciallo～(∠・ω< )⌒★ without clipping on completed and running MCP orchestrator work entries, live rows, and group headers", () => {
    const shared = makeSharedState();
    const completedEntry = makeDynamicToolEntry({
      id: "mcp-done",
      label: "已获取可用代理列表",
      toolName: "mcp__t3-code__orchestrator_capabilities",
      status: "completed",
    });
    const runningEntry = makeDynamicToolEntry({
      id: "mcp-running",
      label: "正在委托子代理执行任务",
      toolName: "mcp__t3-code__delegate_task",
      status: "inProgress",
    });

    const completedHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <TimelineRowCtx value={shared}>
          <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
            <SimpleWorkEntryRow workEntry={completedEntry} workspaceRoot="D:\\Fish-code\\Prismux" />
          </TimelineRowActivityCtx>
        </TimelineRowCtx>
      </GTProvider>,
    );
    expect(completedHtml).toContain('data-prismux-wordmark="true"');
    expect(completedHtml).toContain("Ciallo～(∠・ω&lt; )⌒★");
    expect(completedHtml).toContain('data-disclosure-wide-icon="true"');
    expect(completedHtml).toContain("h-4 w-auto");
    expect(completedHtml).not.toContain("T3");

    const runningHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <TimelineRowCtx value={shared}>
          <TimelineRowActivityCtx value={{ ...DEFAULT_ACTIVITY, isWorking: true }}>
            <SimpleWorkEntryRow workEntry={runningEntry} workspaceRoot="D:\\Fish-code\\Prismux" />
          </TimelineRowActivityCtx>
        </TimelineRowCtx>
      </GTProvider>,
    );
    expect(runningHtml).toContain('data-prismux-wordmark="true"');
    expect(runningHtml).toContain("Ciallo～(∠・ω&lt; )⌒★");
    expect(runningHtml).toContain('data-disclosure-wide-icon="true"');
    expect(runningHtml).toContain("animate-pulse");
    expect(runningHtml).not.toContain("T3");

    const liveRow: Extract<TimelineRow, { kind: "work-live" }> = {
      kind: "work-live",
      id: "live-mcp",
      createdAt: "2026-11-26T10:00:00.000Z",
      entry: runningEntry,
      groupedEntries: [runningEntry],
      groupId: "work-group:mcp",
      expanded: false,
      active: true,
    };
    const liveHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <TimelineRowCtx value={shared}>
          <TimelineRowActivityCtx value={{ ...DEFAULT_ACTIVITY, isWorking: true }}>
            <LiveWorkEntryTimelineRow row={liveRow} />
          </TimelineRowActivityCtx>
        </TimelineRowCtx>
      </GTProvider>,
    );
    expect(liveHtml).toContain('data-prismux-wordmark="true"');
    expect(liveHtml).toContain("Ciallo～(∠・ω&lt; )⌒★");
    expect(liveHtml).toContain('data-disclosure-wide-icon="true"');
    expect(liveHtml).not.toContain("T3");

    const toggleRow: Extract<TimelineRow, { kind: "work-toggle" }> = {
      kind: "work-toggle",
      id: "toggle-mcp",
      createdAt: "2026-11-26T10:00:00.000Z",
      groupId: "work-group:mcp",
      hiddenCount: 2,
      expanded: false,
      summary: "已创建子线程",
      summaryKind: "thread-create",
      hasFailure: false,
    };
    const toggleHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <TimelineRowCtx value={shared}>
          <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
            <WorkGroupToggleTimelineRow row={toggleRow} />
          </TimelineRowActivityCtx>
        </TimelineRowCtx>
      </GTProvider>,
    );
    expect(toggleHtml).toContain('data-prismux-wordmark="true"');
    expect(toggleHtml).toContain("Ciallo～(∠・ω&lt; )⌒★");
    expect(toggleHtml).toContain('data-disclosure-wide-icon="true"');
    expect(toggleHtml).not.toContain("T3");
  });

  it("renders Ciallo～(∠・ω< )⌒★ cleanly in V2LifecycleRow thread_created without overflow clipping or T3 remnants", () => {
    const item: OrchestrationV2TurnItem = {
      id: TurnItemId.make("tc-1"),
      threadId: ThreadId.make("thread-1"),
      runId: RunId.make("run-1"),
      nodeId: NodeId.make("node-tc-1"),
      providerThreadId: ProviderThreadId.make("pt-1"),
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 1,
      status: "completed",
      title: "DS 付费组子代理",
      startedAt: DateTime.makeUnsafe("2026-11-26T10:00:00.000Z"),
      completedAt: DateTime.makeUnsafe("2026-11-26T10:00:01.000Z"),
      updatedAt: DateTime.makeUnsafe("2026-11-26T10:00:01.000Z"),
      type: "thread_created",
      targetThreadId: ThreadId.make("child-thread-1"),
      targetRunId: null,
      targetProviderInstanceId: ProviderInstanceId.make("dsh"),
      targetModel: "DeepSeek-V4.1-Flash",
    };

    const html = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <V2LifecycleRow
          item={item}
          environmentId={EnvironmentId.make("env-1")}
          runs={[]}
          onOpenThread={vi.fn()}
        />
      </GTProvider>,
    );

    expect(html).toContain('data-v2-item-type="thread_created"');
    expect(html).toContain('data-prismux-wordmark="true"');
    expect(html).toContain("Ciallo～(∠・ω&lt; )⌒★");
    expect(html).toContain("text-icon-muted");
    expect(html).toContain("DS 付费组子代理");
    expect(html).not.toContain("size-6 overflow-hidden");
    expect(html).not.toContain("T3");
  });
});
