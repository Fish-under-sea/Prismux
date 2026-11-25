import {
  EnvironmentId,
  MessageId,
  NodeId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import type { WorkLogEntry } from "../../session-logic";
import { SimpleWorkEntryRow } from "./TimelineWorkEntryRow";
import {
  LiveWorkEntryTimelineRow,
  WorkGroupSection,
  WorkGroupToggleTimelineRow,
} from "./TimelineWorkGroupRows";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  WorkGroupViewCtx,
  type TimelineRow,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
  type WorkGroupViewState,
} from "./timelineRowContext";

vi.mock("gt-react", () => ({
  useGT: () => (text: string) => text,
  useLocale: () => "zh-CN",
  useMessages: () => (text: string) => text,
  msg: (text: string) => text,
  T: ({ children }: { children?: unknown }) => children ?? null,
  Var: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock("../../state/entities", () => ({
  useThreadShell: () => null,
  useServerConfigs: () => new Map(),
}));

vi.mock("../../state/queries", () => ({
  useTurnItemDetail: () => ({ data: undefined, isPending: false, error: null }),
}));

vi.mock("../../assets/assetUrls", () => ({
  useAssetUrls: () => [],
}));

vi.mock("../../hooks/useTheme", () => ({
  useRenderedAppearance: () => "dark",
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

vi.mock("../ChatMarkdown", () => ({
  default: ({ text }: { text: string }) => <div data-mock-markdown="1">{text}</div>,
}));

vi.mock("./CommandOutputPanel", () => ({
  useCommandOutputStreaming: () => false,
  CommandOutputPanel: () => <div data-mock-command-output="1" />,
}));

vi.mock("./TimelineToolActivityIcon", () => ({
  failedToolIconClassName: "text-destructive",
  toolIconAcceptsTint: () => true,
  ToolActivityIconView: ({ fallbackName }: { fallbackName: string }) => (
    <span data-mock-tool-icon={fallbackName} />
  ),
}));

function makeSharedState(workGroupViewState?: WorkGroupViewState): TimelineRowSharedState {
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
    workGroupViewState: workGroupViewState ?? {
      scrollPositions: new Map(),
      expandedEntries: new Set(),
    },
    workStepsPolicy: {
      mode: "standard",
      foldCompletedTurns: true,
      stepGrouping: "collapsed",
      liveProcessDetail: true,
      settledReasoningPreview: true,
    },
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

function countDisclosureChevrons(html: string): number {
  return html.match(/data-disclosure-chevron="true"/gu)?.length ?? 0;
}

function makeProjectedBase(id: string, startedAtIso: string, completedAtIso: string) {
  return {
    id: TurnItemId.make(id),
    threadId: ThreadId.make("thread-1"),
    runId: RunId.make("run-1"),
    nodeId: NodeId.make(`node-${id}`),
    providerThreadId: ProviderThreadId.make("pt-1"),
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed" as const,
    title: null,
    startedAt: DateTime.makeUnsafe(startedAtIso),
    completedAt: DateTime.makeUnsafe(completedAtIso),
    updatedAt: DateTime.makeUnsafe(completedAtIso),
  };
}

describe("Expanded work steps redesign & single-chevron guarantees", () => {
  it("renders strictly one directional chevron on collapsed and expanded WorkGroupToggle headers", () => {
    const shared = makeSharedState();
    for (const expanded of [false, true]) {
      const row: Extract<TimelineRow, { kind: "work-toggle" }> = {
        kind: "work-toggle",
        id: "work-toggle:group-1",
        createdAt: "2026-11-25T08:49:00.000Z",
        groupId: "work-group:group-1",
        hiddenCount: 3,
        expanded,
        summary: "已执行命令并修改文件",
        summaryKind: "mixed",
        hasFailure: false,
      };
      const html = renderToStaticMarkup(
        <TimelineRowCtx value={shared}>
          <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
            <WorkGroupToggleTimelineRow row={row} />
          </TimelineRowActivityCtx>
        </TimelineRowCtx>,
      );
      expect(countDisclosureChevrons(html)).toBe(1);
      expect(html).toContain("已执行命令并修改文件");
      expect(html.includes("rotate-90")).toBe(expanded);
    }
  });

  it("renders strictly one directional chevron on LiveWorkEntryTimelineRow even with active shimmer overlay", () => {
    const shared = makeSharedState();
    const cmdEntry: WorkLogEntry = {
      id: "cmd-live",
      createdAt: "2026-11-25T08:49:00.000Z",
      label: "Run command",
      tone: "tool",
      itemType: "command_execution",
      toolLifecycleStatus: "inProgress",
      command: '"C:\\\\Program Files\\\\PowerShell\\\\7\\\\pwsh.exe" -Command \'pwd; ls -Name\'',
    };
    const row: Extract<TimelineRow, { kind: "work-live" }> = {
      kind: "work-live",
      id: "live-activity-row",
      createdAt: "2026-11-25T08:49:00.000Z",
      entry: cmdEntry,
      groupedEntries: [cmdEntry],
      groupId: "work-group:live",
      expanded: false,
      active: true,
      liveProcessDetail: true,
      dshMode: "standard",
    };
    const html = renderToStaticMarkup(
      <TimelineRowCtx value={shared}>
        <TimelineRowActivityCtx value={{ ...DEFAULT_ACTIVITY, isWorking: true }}>
          <LiveWorkEntryTimelineRow row={row} />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(countDisclosureChevrons(html)).toBe(1);
    expect(html).toContain("pwd; ls -Name");
    expect(html).not.toContain("pwsh.exe");
  });

  it("renders command execution with strictly one chevron, stripped header, and frosted terminal card on expand", () => {
    const rawCmd = '"C:\\\\Program Files\\\\PowerShell\\\\7\\\\pwsh.exe" -Command \'pwd; ls -Name\'';
    const item: OrchestrationV2ProjectedTurnItem["item"] = {
      ...makeProjectedBase("cmd-1", "2026-11-25T08:49:00.000Z", "2026-11-25T08:49:00.142Z"),
      type: "command_execution",
      input: rawCmd,
      output: "Path\n----\nD:\\Fish-code\\Prismux",
      exitCode: 0,
    };
    const projectedItem: OrchestrationV2ProjectedTurnItem = {
      position: 1,
      visibility: "local",
      sourceThreadId: ThreadId.make("thread-1"),
      sourceItemId: item.id,
      item,
    };
    const entry: WorkLogEntry = {
      id: "cmd-1",
      createdAt: "2026-11-25T08:49:00.000Z",
      label: "Ran command",
      tone: "tool",
      itemType: "command_execution",
      toolLifecycleStatus: "completed",
      command: rawCmd,
      rawCommand: rawCmd,
      structuredPayload: item,
      projectedItem,
      toolData: { cwd: "D:\\Fish-code\\Prismux" },
    };

    const expandedState: WorkGroupViewState = {
      scrollPositions: new Map(),
      expandedEntries: new Set(["cmd-1"]),
    };
    const shared = makeSharedState(expandedState);
    const html = renderToStaticMarkup(
      <TimelineRowCtx value={shared}>
        <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
          <WorkGroupViewCtx
            value={{
              state: expandedState,
              viewedImages: [],
              onToggleEntry: () => undefined,
              onContentReady: () => undefined,
            }}
          >
            <SimpleWorkEntryRow workEntry={entry} workspaceRoot="D:\\Fish-code\\Prismux" />
          </WorkGroupViewCtx>
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );

    expect(countDisclosureChevrons(html)).toBe(1);
    expect(html).toContain("pwd; ls -Name");
    expect(html).toContain("退出码 0");
    expect(html).toContain("142ms");
    expect(html).toContain('data-step-detail-card="command_execution"');
    expect(html).toContain("backdrop-blur-md");
    expect(html).toContain("原始命令");
    expect(html).toContain("复制命令");
    expect(html).toContain("复制输出");
    expect(html).toContain("D:\\Fish-code\\Prismux");
  });

  it("renders file_change with strictly one chevron, action badge, delta counts, and frosted inline diff preview", () => {
    const item: OrchestrationV2ProjectedTurnItem["item"] = {
      ...makeProjectedBase("edit-1", "2026-11-25T08:49:01.000Z", "2026-11-25T08:49:01.250Z"),
      type: "file_change",
      fileName: "D:\\Fish-code\\Prismux\\pelican.html",
      additions: 18,
      deletions: 4,
      diffStr: "@@ -1,2 +1,3 @@\n-old line\n+new line 1\n+new line 2",
      changes: [{ path: "D:\\Fish-code\\Prismux\\pelican.html", operation: "add" }],
    };
    const projectedItem: OrchestrationV2ProjectedTurnItem = {
      position: 2,
      visibility: "local",
      sourceThreadId: ThreadId.make("thread-1"),
      sourceItemId: item.id,
      item,
    };
    const entry: WorkLogEntry = {
      id: "edit-1",
      createdAt: "2026-11-25T08:49:01.000Z",
      label: "Changed pelican.html",
      tone: "tool",
      itemType: "file_change",
      toolLifecycleStatus: "completed",
      changedFiles: ["D:\\Fish-code\\Prismux\\pelican.html"],
      structuredPayload: item,
      projectedItem,
    };
    const expandedState: WorkGroupViewState = {
      scrollPositions: new Map(),
      expandedEntries: new Set(["edit-1"]),
    };
    const shared = makeSharedState(expandedState);
    const html = renderToStaticMarkup(
      <TimelineRowCtx value={shared}>
        <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
          <WorkGroupViewCtx
            value={{
              state: expandedState,
              viewedImages: [],
              onToggleEntry: () => undefined,
              onContentReady: () => undefined,
            }}
          >
            <SimpleWorkEntryRow workEntry={entry} workspaceRoot="D:\\Fish-code\\Prismux" />
          </WorkGroupViewCtx>
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );

    expect(countDisclosureChevrons(html)).toBe(1);
    expect(html).toContain("新增");
    expect(html).toContain("pelican.html");
    expect(html).toContain("+18");
    expect(html).toContain("-4");
    expect(html).toContain("Open diff");
    expect(html).toContain('data-step-detail-card="file_change"');
    expect(html).toContain("new line 1");
    expect(html).toContain("old line");
  });

  it("renders reasoning row with thinking duration, strictly one chevron, and frosted markdown card on expand", () => {
    const item: OrchestrationV2ProjectedTurnItem["item"] = {
      ...makeProjectedBase("reason-1", "2026-11-25T08:49:00.000Z", "2026-11-25T08:49:02.400Z"),
      type: "reasoning",
      text: "**Checking workspace layout**\nI will inspect files before creating pelican.html.",
      streaming: false,
    };
    const projectedItem: OrchestrationV2ProjectedTurnItem = {
      position: 0,
      visibility: "local",
      sourceThreadId: ThreadId.make("thread-1"),
      sourceItemId: item.id,
      item,
    };
    const entry: WorkLogEntry = {
      id: "reason-1",
      createdAt: "2026-11-25T08:49:00.000Z",
      label: "Thinking",
      tone: "thinking",
      itemType: "reasoning",
      toolLifecycleStatus: "completed",
      detail: item.text,
      structuredPayload: item,
      projectedItem,
    };
    const shared = makeSharedState();
    const collapsedHtml = renderToStaticMarkup(
      <TimelineRowCtx value={shared}>
        <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
          <SimpleWorkEntryRow workEntry={entry} workspaceRoot="D:\\Fish-code\\Prismux" />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(countDisclosureChevrons(collapsedHtml)).toBe(1);
    expect(collapsedHtml).toContain("思考了 2.4s");
    expect(collapsedHtml).toContain("Checking workspace layout");
    expect(collapsedHtml).not.toContain("**Checking");

    const expandedHtml = renderToStaticMarkup(
      <TimelineRowCtx value={shared}>
        <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
          <SimpleWorkEntryRow
            workEntry={entry}
            workspaceRoot="D:\\Fish-code\\Prismux"
            autoExpandReasoning
          />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(countDisclosureChevrons(expandedHtml)).toBe(1);
    expect(expandedHtml).toContain('data-reasoning-frosted-card="true"');
    expect(expandedHtml).toContain("backdrop-blur-md");

    // Reasoning-only expanded work group wraps in vertical tree connector rail
    const groupHtml = renderToStaticMarkup(
      <TimelineRowCtx value={shared}>
        <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
          <WorkGroupSection
            anchorKey="work-group:r"
            groupedEntries={[entry]}
            isExpandedToolGroup
          />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(groupHtml).toContain('data-work-group-tree-rail="true"');
    expect(groupHtml).toContain('data-reasoning-frosted-card="true"');
  });

  // Reference MessageId to verify contract import stays clean if extended later
  it("keeps MessageId contract type usable in timeline fixtures", () => {
    expect(String(MessageId.make("msg-1"))).toBe("msg-1");
  });
});
