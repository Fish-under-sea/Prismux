import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  MessageId,
  NodeId,
  PlanId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  type ClientSettings,
  type OrchestrationV2ProjectedTurnItem,
  type ReasoningTranslationProvider,
} from "@prismux/core-contracts";
import { resolveWorkStepsPolicy, type WorkStepsPresentationPolicy } from "./dshWorkSteps.logic";
import * as DateTime from "effect/DateTime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_REASONING_TRANSLATION_TARGET_LANGUAGE,
  makeReasoningTranslationCacheKey,
  sharedReasoningTranslationCache,
} from "../../prismux/reasoningTranslation";
import type { WorkLogEntry } from "../../session-logic";
import { DshDisclosureLeadingSlot, SimpleWorkEntryRow } from "./TimelineWorkEntryRow";
import {
  LiveWorkEntryTimelineRow,
  ThinkingTimelineRow,
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

const mockReasoningTranslationState: { provider: ReasoningTranslationProvider } = {
  provider: "off",
};

vi.mock("../../hooks/useSettings", () => ({
  useClientSettings: <T = ClientSettings,>(selector?: (settings: ClientSettings) => T) => {
    const settings: ClientSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      reasoningTranslationProvider: mockReasoningTranslationState.provider,
    };
    return selector ? selector(settings) : (settings as unknown as T);
  },
}));

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
  isWideToolActivityIcon: (icon: unknown, fallbackName: string | undefined) =>
    icon === undefined && fallbackName === "prismux",
  toolIconAcceptsTint: () => true,
  ToolActivityIconView: ({ fallbackName, muted }: { fallbackName: string; muted?: boolean }) => (
    <span data-mock-tool-icon={fallbackName} data-mock-tool-muted={String(Boolean(muted))} />
  ),
}));

function makeSharedState(
  workGroupViewState?: WorkGroupViewState,
  overrides?: {
    readonly workStepsPolicy?: WorkStepsPresentationPolicy;
    readonly locale?: string;
  },
): TimelineRowSharedState {
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
    workStepsPolicy: overrides?.workStepsPolicy ?? resolveWorkStepsPolicy("standard"),
    locale: overrides?.locale ?? "zh-CN",
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

describe("1:1 DSH NEXT Thinking & Command/Tool hierarchy & disclosure guarantees", () => {
  it("renders leading icon hover-swap disclosure chevron on collapsed and expanded WorkGroupToggle headers without far-right duplicate chevrons or timestamps", () => {
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
        dshPrimaryCategory: "commands",
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
      expect(html).toContain('data-disclosure-leading="true"');
      expect(html).toMatch(/data-disclosure-leading="true"[^>]*text-primary/);
      expect(html).toMatch(/data-disclosure-chevron="true"[^>]*text-current/);
      expect(html).toContain(`data-disclosure-state="${expanded ? "open" : "closed"}"`);
      expect(html).toContain("已执行命令并修改文件");
      expect(html.includes('data-disclosure-icon-idle="true"')).toBe(!expanded);
      expect(html.includes('data-mock-tool-icon="terminal"')).toBe(!expanded);
      if (!expanded) {
        expect(html).toContain('data-mock-tool-muted="false"');
      }
    }
  });

  it("renders strictly one leading disclosure chevron on LiveWorkEntryTimelineRow even with active shimmer overlay", () => {
    const shared = makeSharedState();
    const cmdEntry: WorkLogEntry = {
      id: "cmd-live",
      createdAt: "2026-11-25T08:49:00.000Z",
      label: "Run command",
      tone: "tool",
      itemType: "command_execution",
      toolLifecycleStatus: "inProgress",
      command: "\"C:\\\\Program Files\\\\PowerShell\\\\7\\\\pwsh.exe\" -Command 'pwd; ls -Name'",
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
    expect(html).toContain('data-disclosure-leading="true"');
    expect(html).toContain("pwd; ls -Name");
    expect(html).not.toContain("pwsh.exe");
  });

  it("renders command execution with leading hover-swap chevron, clean header without timestamp noise, and 0.5px-bordered terminal card on expand", () => {
    const rawCmd =
      "\"C:\\\\Program Files\\\\PowerShell\\\\7\\\\pwsh.exe\" -Command 'pwd; ls -Name'";
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

    const collapsedShared = makeSharedState();
    const collapsedHtml = renderToStaticMarkup(
      <TimelineRowCtx value={collapsedShared}>
        <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
          <SimpleWorkEntryRow workEntry={entry} workspaceRoot="D:\\Fish-code\\Prismux" />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(countDisclosureChevrons(collapsedHtml)).toBe(1);
    expect(collapsedHtml).toContain('data-disclosure-leading="true"');
    expect(collapsedHtml).toContain('data-disclosure-state="closed"');
    expect(collapsedHtml).toContain("pwd; ls -Name");
    expect(collapsedHtml).toContain("142ms");
    expect(collapsedHtml).not.toContain("08:49");

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
    expect(html).toContain('data-disclosure-state="open"');
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

  it("renders dynamic_tool expanded view with DSH .ioCard IN/OUT sections and 0.5px hairline divider", () => {
    const item: OrchestrationV2ProjectedTurnItem["item"] = {
      ...makeProjectedBase("tool-1", "2026-11-25T08:49:00.000Z", "2026-11-25T08:49:00.320Z"),
      type: "dynamic_tool",
      toolName: "mcp.inspect",
      input: { query: "status" },
      output: "healthy",
    };
    const projectedItem: OrchestrationV2ProjectedTurnItem = {
      position: 3,
      visibility: "local",
      sourceThreadId: ThreadId.make("thread-1"),
      sourceItemId: item.id,
      item,
    };
    const entry: WorkLogEntry = {
      id: "tool-1",
      createdAt: "2026-11-25T08:49:00.000Z",
      label: "Inspect",
      tone: "tool",
      itemType: "dynamic_tool",
      toolLifecycleStatus: "completed",
      structuredPayload: item,
      projectedItem,
    };
    const expandedState: WorkGroupViewState = {
      scrollPositions: new Map(),
      expandedEntries: new Set(["tool-1"]),
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
    expect(html).toContain('data-dsh-io-card="true"');
    expect(html).toContain('data-dsh-io-section="in"');
    expect(html).toContain('data-dsh-io-divider="true"');
    expect(html).toContain('data-dsh-io-section="out"');
    expect(html).toContain(">输入<");
    expect(html).toContain(">输出<");
    expect(html).toContain("healthy");

    const enShared = makeSharedState(expandedState, { locale: "en-US" });
    const enHtml = renderToStaticMarkup(
      <TimelineRowCtx value={enShared}>
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
    expect(enHtml).toContain(">IN<");
    expect(enHtml).toContain(">OUT<");
  });

  it("renders file_change with strictly one leading chevron, action badge, delta counts, and frosted inline diff preview", () => {
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

  it("renders DSH ReasoningRow: collapsed 24px single-line preview with 2px dot, and expanded sticky header + 22px-indented full markdown body without heavy card border", () => {
    const item: OrchestrationV2ProjectedTurnItem["item"] = {
      ...makeProjectedBase("reason-1", "2026-11-25T08:49:00.000Z", "2026-11-25T08:49:05.100Z"),
      type: "reasoning",
      text: "**User wants me to think and inspect pwsh**\nFull second line reasoning details.",
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
    expect(collapsedHtml).toContain('data-reasoning-row="true"');
    expect(collapsedHtml).toContain('data-reasoning-expanded="false"');
    expect(collapsedHtml).toContain('data-disclosure-leading="true"');
    expect(collapsedHtml).toMatch(/data-disclosure-leading="true"[^>]*text-primary/);
    expect(collapsedHtml).toContain('data-disclosure-icon-idle="true"');
    expect(collapsedHtml).toContain('data-mock-tool-icon="brain" data-mock-tool-muted="false"');
    expect(collapsedHtml).toContain('data-disclosure-state="closed"');
    expect(collapsedHtml).toMatch(
      /data-reasoning-title="true"[^>]*font-medium text-primary[^>]*>思考了 5\.1s</,
    );
    expect(collapsedHtml).toContain('data-reasoning-separator="true"');
    expect(collapsedHtml).toMatch(
      /data-reasoning-summary-preview="true"[^>]*text-muted-foreground\/80/,
    );
    expect(collapsedHtml).toContain("User wants me to think and inspect pwsh");
    expect(collapsedHtml).not.toContain("**User");
    expect(collapsedHtml).not.toContain('data-reasoning-body="true"');
    expect(collapsedHtml).not.toContain("08:49");

    // Live streaming reasoning shows fade mask & latest completed paragraph first line
    const liveEntry: WorkLogEntry = {
      ...entry,
      id: "reason-live",
      toolLifecycleStatus: "inProgress",
      detail: "**First step**\nDone\n\n**Second step streaming**\nStill typing",
    };
    const streamingHtml = renderToStaticMarkup(
      <TimelineRowCtx value={shared}>
        <TimelineRowActivityCtx value={{ ...DEFAULT_ACTIVITY, isWorking: true }}>
          <SimpleWorkEntryRow workEntry={liveEntry} workspaceRoot="D:\\Fish-code\\Prismux" />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(streamingHtml).toMatch(/data-disclosure-leading="true"[^>]*text-primary/);
    expect(streamingHtml).toMatch(
      /data-reasoning-title="true"[^>]*font-medium text-primary[^>]*>正在思考/,
    );
    expect(streamingHtml).toContain('data-streaming="true"');
    expect(streamingHtml).toContain("Second step streaming");
    expect(streamingHtml).toContain("linear-gradient(to_right,black_calc(100%-48px),transparent)");

    // Expanded reasoning: sticky header, ChevronUp, hides single-line preview & dot, renders full body at pl-[22px] without frosted card box
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
    expect(expandedHtml).toContain('data-reasoning-expanded="true"');
    expect(expandedHtml).toContain('data-disclosure-state="open"');
    expect(expandedHtml).toContain("sticky top-0");
    expect(expandedHtml).toContain("bg-transparent");
    expect(expandedHtml).not.toContain("bg-background/95");
    expect(expandedHtml).not.toContain("bg-card/85");
    expect(expandedHtml).not.toContain('data-reasoning-separator="true"');
    expect(expandedHtml).not.toContain('data-reasoning-summary-preview="true"');
    expect(expandedHtml).toContain('data-reasoning-body="true"');
    expect(expandedHtml).toContain("pl-5.5");
    expect(expandedHtml).toContain("Full second line reasoning details.");
    expect(expandedHtml).not.toContain("data-reasoning-frosted-card");
  });

  it("renders expanded tool group children at L2 indentation distinct from L1 top-level thinking", () => {
    const shared = makeSharedState();
    const cmdEntry: WorkLogEntry = {
      id: "cmd-child",
      createdAt: "2026-11-25T08:49:02.000Z",
      label: "Ran command",
      tone: "tool",
      itemType: "command_execution",
      toolLifecycleStatus: "completed",
      command: "$PSVersionTable | Format-List",
    };
    const reasonEntry: WorkLogEntry = {
      id: "reason-top",
      createdAt: "2026-11-25T08:49:00.000Z",
      label: "Thinking",
      tone: "thinking",
      itemType: "reasoning",
      toolLifecycleStatus: "completed",
      detail: "Top-level thought outside tool group.",
    };

    const topLevelThinkingHtml = renderToStaticMarkup(
      <TimelineRowCtx value={shared}>
        <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
          <WorkGroupSection
            anchorKey="reason-top"
            groupedEntries={[reasonEntry]}
            isExpandedToolGroup={false}
          />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(topLevelThinkingHtml).toContain('data-reasoning-row="true"');
    expect(topLevelThinkingHtml).not.toContain('data-work-group-tree-rail="true"');
    expect(topLevelThinkingHtml).not.toContain('data-work-group-depth="2"');

    const childToolGroupHtml = renderToStaticMarkup(
      <TimelineRowCtx value={shared}>
        <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
          <WorkGroupSection
            anchorKey="work-group:cmd-child"
            groupedEntries={[cmdEntry]}
            isExpandedToolGroup
          />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(childToolGroupHtml).toContain('data-work-group-tree-rail="true"');
    expect(childToolGroupHtml).toContain('data-work-group-depth="2"');
    expect(childToolGroupHtml).toContain("ml-2.5");
    expect(childToolGroupHtml).toContain("border-l");
    expect(childToolGroupHtml).toContain("pl-3");
  });

  it("wires reasoning translation into both collapsed single-line preview and expanded ReasoningTraceContent when enabled", async () => {
    const rawDetail =
      "**Inspecting settings schema**\nChecking how client settings decode defaults.";
    const translatedDetail = "检查设置模式\n正在核对客户端设置如何解码默认值。";
    const cacheKey = makeReasoningTranslationCacheKey({
      provider: "bing",
      modelKey: "",
      targetLanguage: DEFAULT_REASONING_TRANSLATION_TARGET_LANGUAGE,
      fragmentText: rawDetail,
    });
    sharedReasoningTranslationCache.set(cacheKey, translatedDetail);

    const item: OrchestrationV2ProjectedTurnItem["item"] = {
      ...makeProjectedBase("reason-zh", "2026-11-25T08:49:00.000Z", "2026-11-25T08:49:02.400Z"),
      type: "reasoning",
      text: rawDetail,
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
      id: "reason-zh",
      createdAt: "2026-11-25T08:49:00.000Z",
      label: "Thinking",
      tone: "thinking",
      itemType: "reasoning",
      toolLifecycleStatus: "completed",
      detail: rawDetail,
      structuredPayload: item,
      projectedItem,
    };
    const shared = makeSharedState();

    mockReasoningTranslationState.provider = "bing";
    try {
      const collapsedHtml = renderToStaticMarkup(
        <TimelineRowCtx value={shared}>
          <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
            <SimpleWorkEntryRow workEntry={entry} workspaceRoot="D:\\Fish-code\\Prismux" />
          </TimelineRowActivityCtx>
        </TimelineRowCtx>,
      );
      expect(collapsedHtml).toContain('data-reasoning-summary-preview="true"');
      expect(collapsedHtml).toContain("检查设置模式");

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
      expect(expandedHtml).toContain('data-slot="reasoning-translation-body"');
      expect(expandedHtml).toContain('data-slot="reasoning-translation-toggle"');
      expect(expandedHtml).toContain("View original");
      expect(expandedHtml).toContain("正在核对客户端设置如何解码默认值。");
    } finally {
      mockReasoningTranslationState.provider = "off";
      sharedReasoningTranslationCache.clear();
    }
  });

  it("integrates DshSearchBlock, DshWebBlock (with renderMarkdown), AgyTodoChecklist inline, and LocalizedErrorCard across turn items and fallbacks", () => {
    // 1. file_search -> DshSearchBlock
    const searchItem: OrchestrationV2ProjectedTurnItem["item"] = {
      ...makeProjectedBase("search-1", "2026-11-25T08:49:00.000Z", "2026-11-25T08:49:00.200Z"),
      type: "file_search",
      pattern: "workStepsDisplay",
      results: [
        {
          fileName: "D:\\Fish-code\\Prismux\\apps\\web\\src\\a.ts",
          line: 42,
          preview: "workStepsDisplay: 'detailed'",
        },
      ],
    };
    const searchEntry: WorkLogEntry = {
      id: "search-1",
      createdAt: "2026-11-25T08:49:00.000Z",
      label: "Searched",
      tone: "tool",
      itemType: "file_search",
      toolLifecycleStatus: "completed",
      structuredPayload: searchItem,
      projectedItem: {
        position: 1,
        visibility: "local",
        sourceThreadId: ThreadId.make("thread-1"),
        sourceItemId: searchItem.id,
        item: searchItem,
      },
    };

    // 2. web_search -> DshWebBlock with renderMarkdown
    const webItem: OrchestrationV2ProjectedTurnItem["item"] = {
      ...makeProjectedBase("web-1", "2026-11-25T08:49:01.000Z", "2026-11-25T08:49:01.400Z"),
      type: "web_search",
      patterns: ["Prismux liquid glass"],
      results: [
        {
          title: "Prismux Appearance Docs",
          url: "https://prismux.dev/appearance",
          snippet: "8-zone Fresnel liquid glass",
        },
      ],
    };
    const webEntry: WorkLogEntry = {
      id: "web-1",
      createdAt: "2026-11-25T08:49:01.000Z",
      label: "Web search",
      tone: "tool",
      itemType: "web_search",
      toolLifecycleStatus: "completed",
      structuredPayload: webItem,
      projectedItem: {
        position: 2,
        visibility: "local",
        sourceThreadId: ThreadId.make("thread-1"),
        sourceItemId: webItem.id,
        item: webItem,
      },
    };

    // 2b. web_search workEntry fallback with markdown answer
    const webFallbackEntry: WorkLogEntry = {
      id: "web-fallback",
      createdAt: "2026-11-25T08:49:01.500Z",
      label: "Web search",
      tone: "tool",
      itemType: "web_search",
      toolLifecycleStatus: "completed",
      toolData: {
        input: { query: "React 19 disclosure" },
        output: {
          answer: "Use **CSS grid-template-rows** for smooth reveal.",
          results: [{ title: "CSS Grid Transitions", url: "https://developer.mozilla.org" }],
        },
      },
    };

    // 3. todo_list -> AgyTodoChecklist variant="inline"
    const todoItem: OrchestrationV2ProjectedTurnItem["item"] = {
      ...makeProjectedBase("todo-1", "2026-11-25T08:49:02.000Z", "2026-11-25T08:49:02.100Z"),
      type: "todo_list",
      planId: PlanId.make("plan-inline"),
      steps: [
        { id: "s1", text: "接入搜索卡片", status: "completed" },
        { id: "s2", text: "校验三套主题对比度", status: "running" },
      ],
    };
    const todoEntry: WorkLogEntry = {
      id: "todo-1",
      createdAt: "2026-11-25T08:49:02.000Z",
      label: "Todo list",
      tone: "tool",
      itemType: "todo_list",
      toolLifecycleStatus: "inProgress",
      structuredPayload: todoItem,
      projectedItem: {
        position: 3,
        visibility: "local",
        sourceThreadId: ThreadId.make("thread-1"),
        sourceItemId: todoItem.id,
        item: todoItem,
      },
    };

    // 4. Inline failed error row -> LocalizedErrorCard
    const errorItem: OrchestrationV2ProjectedTurnItem["item"] = {
      ...makeProjectedBase("err-1", "2026-11-25T08:49:03.000Z", "2026-11-25T08:49:03.100Z"),
      type: "error",
      status: "failed",
      failure: {
        class: "transport_error",
        code: "ECONNREFUSED",
        message: "connect ECONNREFUSED 127.0.0.1:11434",
        retryable: true,
      },
    };
    const errorEntry: WorkLogEntry = {
      id: "err-1",
      createdAt: "2026-11-25T08:49:03.000Z",
      label: "Error",
      tone: "error",
      itemType: "error",
      toolLifecycleStatus: "failed",
      structuredPayload: errorItem,
      projectedItem: {
        position: 4,
        visibility: "local",
        sourceThreadId: ThreadId.make("thread-1"),
        sourceItemId: errorItem.id,
        item: errorItem,
      },
    };

    // 5. Failed dynamic tool -> LocalizedErrorCard inside OUT section
    const failedToolItem: OrchestrationV2ProjectedTurnItem["item"] = {
      ...makeProjectedBase("tool-err", "2026-11-25T08:49:04.000Z", "2026-11-25T08:49:04.200Z"),
      type: "dynamic_tool",
      status: "failed",
      toolName: "mcp.query",
      input: { endpoint: "https://api.example.com" },
      output: "401 Unauthorized: invalid api key",
    };
    const failedToolEntry: WorkLogEntry = {
      id: "tool-err",
      createdAt: "2026-11-25T08:49:04.000Z",
      label: "MCP tool",
      tone: "error",
      itemType: "dynamic_tool",
      toolLifecycleStatus: "failed",
      structuredPayload: failedToolItem,
      projectedItem: {
        position: 5,
        visibility: "local",
        sourceThreadId: ThreadId.make("thread-1"),
        sourceItemId: failedToolItem.id,
        item: failedToolItem,
      },
    };

    // Render all under `expanded` mode (`defaultExpandLongItems: true`) so every long item defaults open inline!
    const expandedShared = makeSharedState(undefined, {
      workStepsPolicy: resolveWorkStepsPolicy("expanded"),
    });
    const renderEntry = (entry: WorkLogEntry) =>
      renderToStaticMarkup(
        <TimelineRowCtx value={expandedShared}>
          <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
            <SimpleWorkEntryRow
              workEntry={entry}
              workspaceRoot="D:\\Fish-code\\Prismux"
              autoExpandDetails
            />
          </TimelineRowActivityCtx>
        </TimelineRowCtx>,
      );

    const searchHtml = renderEntry(searchEntry);
    expect(searchHtml).toContain("已搜索");
    expect(searchHtml).toContain('data-disclosure-panel="open"');
    expect(searchHtml).toContain("grid-rows-[1fr]");
    expect(searchHtml).toContain("duration-200 ease-out motion-reduce:transition-none");
    expect(searchHtml).toContain('data-dsh-search-block="matches"');
    expect(searchHtml).toContain("apps/web/src/a.ts");

    const webHtml = renderEntry(webEntry);
    expect(webHtml).toContain("网页搜索");
    expect(webHtml).toContain('data-dsh-web-block="search"');
    expect(webHtml).toContain("Prismux Appearance Docs");

    const webFallbackHtml = renderEntry(webFallbackEntry);
    expect(webFallbackHtml).toContain('data-dsh-web-block="search"');
    expect(webFallbackHtml).toContain('data-dsh-web-answer="true"');
    expect(webFallbackHtml).toContain('data-mock-markdown="1"');

    const todoHtml = renderEntry(todoEntry);
    expect(todoHtml).toContain("任务清单");
    expect(todoHtml).toContain('data-agy-todo-checklist="inline"');
    expect(todoHtml).toContain("接入搜索卡片");
    expect(todoHtml).toContain("校验三套主题对比度");

    const errorHtml = renderEntry(errorEntry);
    expect(errorHtml).toContain('data-localized-error-card="1"');
    expect(errorHtml).toContain("网络连接中断或端点/代理不可达");
    expect(errorHtml).toContain("查看原始报错");
    expect(errorHtml).not.toContain('data-localized-error-raw="1"');

    const failedToolHtml = renderEntry(failedToolEntry);
    expect(failedToolHtml).toContain("MCP 工具");
    expect(failedToolHtml).toContain('data-localized-error-card="1"');
    expect(failedToolHtml).toContain("API 密钥或登录凭证无效（401）");
    expect(failedToolHtml).not.toContain('data-localized-error-raw="1"');

    // 3-mode theme guardrails across ALL rendered cards: zero bg-black / bg-white / text-white
    for (const html of [
      searchHtml,
      webHtml,
      webFallbackHtml,
      todoHtml,
      errorHtml,
      failedToolHtml,
    ]) {
      expect(html).not.toContain("bg-black");
      expect(html).not.toContain("bg-white");
      expect(html).not.toContain("text-white");
      expect(html).toContain("[[data-pmx-glass=&#x27;1&#x27;]_&amp;]");
    }
  });

  it("renders 1-line truncated collapsed previews in detailed mode while defaulting long items open in expanded mode", () => {
    const cmdEntry: WorkLogEntry = {
      id: "cmd-detail",
      createdAt: "2026-11-25T08:49:00.000Z",
      label: "Ran command",
      tone: "tool",
      itemType: "command_execution",
      toolLifecycleStatus: "completed",
      command: "pnpm test:scripts",
      detail: "ok 1 - scripts pass cleanly\nok 2 - zero regressions",
    };

    const detailedShared = makeSharedState(undefined, {
      workStepsPolicy: resolveWorkStepsPolicy("detailed"),
    });
    const detailedHtml = renderToStaticMarkup(
      <TimelineRowCtx value={detailedShared}>
        <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
          <SimpleWorkEntryRow workEntry={cmdEntry} workspaceRoot="D:\\Fish-code\\Prismux" />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(detailedHtml).toContain('data-disclosure-state="closed"');
    expect(detailedHtml).toContain('data-step-collapsed-preview="true"');
    expect(detailedHtml).toContain("ok 1 - scripts pass cleanly");
    expect(detailedHtml).not.toContain('data-step-detail-card="command_execution"');

    const expandedShared = makeSharedState(undefined, {
      workStepsPolicy: resolveWorkStepsPolicy("expanded"),
    });
    const expandedHtml = renderToStaticMarkup(
      <TimelineRowCtx value={expandedShared}>
        <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
          <SimpleWorkEntryRow
            workEntry={cmdEntry}
            workspaceRoot="D:\\Fish-code\\Prismux"
            autoExpandDetails
          />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(expandedHtml).toContain('data-disclosure-state="open"');
    expect(expandedHtml).toContain('data-disclosure-panel="open"');
    expect(expandedHtml).toContain('data-step-detail-card="command_execution"');
    expect(expandedHtml).not.toContain('data-step-collapsed-preview="true"');
  });

  it("applies user theme accent text-primary to thinking headers, leading tool icons, search/web card headers, and active todo indicators while preserving semantic error/emerald tints", () => {
    const shared = makeSharedState();

    // 1. Live ThinkingTimelineRow -> brain icon & label use text-primary
    const thinkingRow: Extract<TimelineRow, { kind: "thinking" }> = {
      kind: "thinking",
      id: "thinking-live-1",
      createdAt: "2026-11-25T08:49:00.000Z",
      label: "正在思考…",
      groupId: "work-group:thinking",
      expanded: false,
    };
    const thinkingHtml = renderToStaticMarkup(
      <TimelineRowCtx value={shared}>
        <TimelineRowActivityCtx value={{ ...DEFAULT_ACTIVITY, isWorking: true }}>
          <ThinkingTimelineRow row={thinkingRow} />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(thinkingHtml).toMatch(/data-disclosure-leading="true"[^>]*text-primary/);
    expect(thinkingHtml).toMatch(/data-live-activity-label="true"[^>]*font-medium text-primary/);
    expect(thinkingHtml).toContain('data-mock-tool-icon="brain" data-mock-tool-muted="false"');

    // 2. Failed WorkGroupToggle keeps text-destructive; reasoning WorkGroupToggle uses text-primary on icon + label
    const failedGroupHtml = renderToStaticMarkup(
      <TimelineRowCtx value={shared}>
        <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
          <WorkGroupToggleTimelineRow
            row={{
              kind: "work-toggle",
              id: "work-toggle:failed",
              createdAt: "2026-11-25T08:49:00.000Z",
              groupId: "work-group:failed",
              hiddenCount: 2,
              expanded: false,
              summary: "命令执行失败",
              summaryKind: "command",
              hasFailure: true,
            }}
          />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(failedGroupHtml).toMatch(/data-disclosure-leading="true"[^>]*text-destructive/);
    expect(failedGroupHtml).not.toMatch(/data-disclosure-leading="true"[^>]*text-primary/);

    const reasoningGroupHtml = renderToStaticMarkup(
      <TimelineRowCtx value={shared}>
        <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
          <WorkGroupToggleTimelineRow
            row={{
              kind: "work-toggle",
              id: "work-toggle:reasoning",
              createdAt: "2026-11-25T08:49:00.000Z",
              groupId: "work-group:reasoning",
              hiddenCount: 1,
              expanded: false,
              summary: "思考过程",
              summaryKind: "reasoning",
              hasFailure: false,
            }}
          />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(reasoningGroupHtml).toMatch(/data-disclosure-leading="true"[^>]*text-primary/);
    expect(reasoningGroupHtml).toMatch(/data-work-group-label="true"[^>]*font-medium text-primary/);

    // 3. Settled tool rows use text-primary on leading icon; failed tool uses text-destructive; completed info checkmark uses text-emerald-500
    const settledToolEntries: ReadonlyArray<WorkLogEntry> = [
      {
        id: "accent-cmd",
        createdAt: "2026-11-25T08:49:00.000Z",
        label: "Ran command",
        tone: "tool",
        itemType: "command_execution",
        toolLifecycleStatus: "completed",
        command: "git status",
      },
      {
        id: "accent-read",
        createdAt: "2026-11-25T08:49:01.000Z",
        label: "Read README.md",
        tone: "tool",
        itemType: "dynamic_tool",
        toolTitle: "read_file",
        toolLifecycleStatus: "completed",
      },
      {
        id: "accent-edit",
        createdAt: "2026-11-25T08:49:02.000Z",
        label: "Edited app.tsx",
        tone: "tool",
        itemType: "file_change",
        toolLifecycleStatus: "completed",
        changedFiles: ["apps/web/src/app.tsx"],
      },
    ];
    for (const entry of settledToolEntries) {
      const rowHtml = renderToStaticMarkup(
        <TimelineRowCtx value={shared}>
          <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
            <SimpleWorkEntryRow workEntry={entry} workspaceRoot="D:\\Fish-code\\Prismux" />
          </TimelineRowActivityCtx>
        </TimelineRowCtx>,
      );
      expect(rowHtml).toMatch(/data-disclosure-leading="true"[^>]*text-primary/);
      expect(rowHtml).toContain('data-mock-tool-muted="false"');
    }

    const failedToolHtml = renderToStaticMarkup(
      <TimelineRowCtx value={shared}>
        <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
          <SimpleWorkEntryRow
            workEntry={{
              id: "accent-fail",
              createdAt: "2026-11-25T08:49:03.000Z",
              label: "Command failed",
              tone: "error",
              itemType: "command_execution",
              toolLifecycleStatus: "failed",
              command: "exit 1",
            }}
            workspaceRoot="D:\\Fish-code\\Prismux"
          />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(failedToolHtml).toMatch(/data-disclosure-leading="true"[^>]*text-destructive/);

    const infoCheckHtml = renderToStaticMarkup(
      <TimelineRowCtx value={shared}>
        <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
          <SimpleWorkEntryRow
            workEntry={{
              id: "accent-info-check",
              createdAt: "2026-11-25T08:49:04.000Z",
              label: "Checkpoint saved",
              tone: "info",
              requestKind: "file-change",
              toolLifecycleStatus: "completed",
            }}
            workspaceRoot="D:\\Fish-code\\Prismux"
          />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(infoCheckHtml).toContain('data-mock-tool-icon="check" data-mock-tool-muted="false"');
    expect(infoCheckHtml).toMatch(/data-disclosure-leading="true"[^>]*text-success-foreground/);

    // 4. Expanded search/web headers and inline todo checklist use text-primary + emerald completed checkmark
    const expandedShared = makeSharedState(undefined, {
      workStepsPolicy: resolveWorkStepsPolicy("expanded"),
    });
    const searchItem: OrchestrationV2ProjectedTurnItem["item"] = {
      ...makeProjectedBase("accent-search", "2026-11-25T08:49:00.000Z", "2026-11-25T08:49:00.200Z"),
      type: "file_search",
      pattern: "text-primary",
      results: [{ fileName: "apps/web/src/a.ts", line: 1, preview: "text-primary" }],
    };
    const searchHtml = renderToStaticMarkup(
      <TimelineRowCtx value={expandedShared}>
        <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
          <SimpleWorkEntryRow
            workEntry={{
              id: "accent-search",
              createdAt: "2026-11-25T08:49:00.000Z",
              label: "Searched",
              tone: "tool",
              itemType: "file_search",
              toolLifecycleStatus: "completed",
              structuredPayload: searchItem,
              projectedItem: {
                position: 1,
                visibility: "local",
                sourceThreadId: ThreadId.make("thread-1"),
                sourceItemId: searchItem.id,
                item: searchItem,
              },
            }}
            workspaceRoot="D:\\Fish-code\\Prismux"
            autoExpandDetails
          />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(searchHtml).toMatch(/data-dsh-search-block="matches"[\s\S]*<svg[^>]*text-primary/);

    const todoItem: OrchestrationV2ProjectedTurnItem["item"] = {
      ...makeProjectedBase("accent-todo", "2026-11-25T08:49:02.000Z", "2026-11-25T08:49:02.100Z"),
      type: "todo_list",
      planId: PlanId.make("plan-accent"),
      steps: [
        { id: "s1", text: "已完成步骤", status: "completed" },
        { id: "s2", text: "进行中步骤", status: "running" },
      ],
    };
    const todoHtml = renderToStaticMarkup(
      <TimelineRowCtx value={expandedShared}>
        <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
          <SimpleWorkEntryRow
            workEntry={{
              id: "accent-todo",
              createdAt: "2026-11-25T08:49:02.000Z",
              label: "Todo list",
              tone: "tool",
              itemType: "todo_list",
              toolLifecycleStatus: "inProgress",
              structuredPayload: todoItem,
              projectedItem: {
                position: 2,
                visibility: "local",
                sourceThreadId: ThreadId.make("thread-1"),
                sourceItemId: todoItem.id,
                item: todoItem,
              },
            }}
            workspaceRoot="D:\\Fish-code\\Prismux"
            autoExpandDetails
          />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    expect(todoHtml).toMatch(/class="[^"]*text-primary[^"]*"[^>]*data-agy-progress-ring="active"/);
    expect(todoHtml).toContain("bg-primary");
    expect(todoHtml).toMatch(
      /class="[^"]*text-success-foreground[^"]*"[^>]*data-agy-step-indicator="completed"/,
    );
  });

  it("left-aligns disclosure chevron at the 16px leading column on wideIcon rows when collapsed and shrinks slot to size-4 when expanded", () => {
    const collapsedWideHtml = renderToStaticMarkup(
      <DshDisclosureLeadingSlot
        icon={<span data-prismux-wordmark="true">Ciallo～(∠・ω&lt; )⌒★</span>}
        expandable
        expanded={false}
        wideIcon
        iconClassName="mr-1.5 relative flex items-center justify-center h-4 w-auto text-primary"
      />,
    );
    expect(collapsedWideHtml).toContain('data-disclosure-wide-icon="true"');
    expect(collapsedWideHtml).toMatch(/data-disclosure-leading="true"[^>]*justify-start/);
    expect(collapsedWideHtml).toMatch(/data-disclosure-leading="true"[^>]*h-4 w-auto/);
    expect(collapsedWideHtml).toMatch(/data-disclosure-chevron="true"[^>]*inset-y-0 left-0 size-4/);
    expect(collapsedWideHtml).not.toMatch(/data-disclosure-chevron="true"[^>]*\binset-0\b/);

    const expandedWideHtml = renderToStaticMarkup(
      <DshDisclosureLeadingSlot
        icon={<span data-prismux-wordmark="true">Ciallo～(∠・ω&lt; )⌒★</span>}
        expandable
        expanded
        wideIcon
        iconClassName="mr-1.5 relative flex items-center justify-center h-4 w-auto text-primary"
      />,
    );
    expect(expandedWideHtml).not.toContain('data-disclosure-icon-idle="true"');
    expect(expandedWideHtml).toMatch(/data-disclosure-leading="true"[^>]*size-4/);
    expect(expandedWideHtml).not.toMatch(/data-disclosure-leading="true"[^>]*w-auto/);
    expect(expandedWideHtml).toMatch(/data-disclosure-chevron="true"[^>]*size-4 opacity-100/);
  });

  // Reference MessageId to verify contract import stays clean if extended later
  it("keeps MessageId contract type usable in timeline fixtures", () => {
    expect(String(MessageId.make("msg-1"))).toBe("msg-1");
  });
});
