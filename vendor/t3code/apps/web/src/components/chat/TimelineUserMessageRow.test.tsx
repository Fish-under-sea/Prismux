import { EnvironmentId, MessageId, ScheduledTaskId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { UserMessageRow } from "./TimelineUserMessageRow";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRow,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
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
  useQuietThreadShell: () => null,
}));

vi.mock("../../state/environments", () => ({
  useEnvironment: () => null,
}));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: undefined }),
}));

vi.mock("../../assets/assetUrls", () => ({
  useAssetUrls: () => [],
  useAssetUrlState: () => ({ _tag: "Initial" }),
  useAssetUrlRefresh: () => () => undefined,
}));

vi.mock("~/hooks/useMediaQuery", () => ({
  useMediaQuery: () => false,
}));

vi.mock("../ChatMarkdown", () => ({
  default: ({ text }: { text: string }) => <div data-mock-markdown="1">{text}</div>,
}));

vi.mock("../DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock("./UserMessageContextChips", () => ({
  UserMessageContextReferenceChip: () => null,
}));

vi.mock("./WorkflowOpeningBlock", () => ({
  WorkflowOpeningBlock: () => null,
}));

vi.mock("./SnapShotAttachmentDetails", () => ({
  SNAP_SHOT_ATTACHMENT_FRAME_CLASS: "",
  SnapShotAttachmentDetails: () => null,
}));

vi.mock("./PierreEntryIcon", () => ({
  PierreEntryIcon: () => null,
}));

vi.mock("../files/InlineAudioPreview", () => ({
  InlineAudioPreview: () => null,
}));

vi.mock("../media/AttachmentImage", () => ({
  AttachmentImage: () => null,
}));

vi.mock("../media/MediaVideoPlayer", () => ({
  MediaVideoPlayer: () => null,
}));

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
    markdownCwd: "/work/prismux",
    resolvedTheme: "dark",
    workspaceRoot: "/work/prismux",
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
    onOpenToolDiff: undefined,
    onOpenTurnDiff: undefined,
    renderHtmlRender: undefined,
    turnItemSource: undefined,
    onOpenThread: () => undefined,
    workflowOpening: null,
    onForkFromRun: undefined,
    onToggleTurnFold: () => undefined,
    onToggleAttemptFold: () => undefined,
    onFileOpen: () => undefined,
    onFileDownload: () => undefined,
    openPullRequest: () => undefined,
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
  };
}

function makeActivityState(): TimelineRowActivityState {
  return {
    isWorking: false,
    isCompacting: false,
    isRevertingCheckpoint: false,
    awaitingUser: false,
    isPreparingWorktree: false,
    providerStartingLabel: null,
    latestRunId: null,
    backgroundWorktreeSetup: null,
    liveAnswerPreview: null,
  };
}

function makeMessageRow(text: string): Extract<TimelineRow, { kind: "message" }> {
  return {
    kind: "message",
    id: "msg-1",
    createdAt: "2026-11-25T03:00:00.000Z",
    message: {
      id: MessageId.make("msg-1"),
      role: "user",
      text,
      runId: null,
      createdAt: "2026-11-25T03:00:00.000Z",
      updatedAt: "2026-11-25T03:00:00.000Z",
      streaming: false,
    },
    showAssistantMeta: false,
    showAssistantCopyButton: false,
    assistantCopyStreaming: false,
  };
}

describe("TimelineUserMessageRow", () => {
  it("binds data-pmx-glass-zone=\"userBubble\" on user message bubbles and omits Copy prompt link", () => {
    const html = renderToStaticMarkup(
      <TimelineRowCtx value={makeSharedState()}>
        <TimelineRowActivityCtx value={makeActivityState()}>
          <UserMessageRow row={makeMessageRow("测试 8 分区液态玻璃微光气泡")} />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );

    expect(html).toContain('data-pmx-glass-zone="userBubble"');
    expect(html).toContain('data-user-message-bubble=""');
    expect(html).toContain('data-user-message-bubble-surface="1"');
    expect(html).toContain("测试 8 分区液态玻璃微光气泡");
    expect(html).not.toContain("Copy prompt link");
    expect(html).not.toContain("app.t3.codes");
  });

  it("binds data-pmx-glass-zone=\"userBubble\" on automation prompt bubbles and omits Copy prompt link", () => {
    const automationRow: Extract<TimelineRow, { kind: "message" }> = {
      ...makeMessageRow("每日定时巡检任务"),
      message: {
        ...makeMessageRow("每日定时巡检任务").message,
        scheduledTaskId: ScheduledTaskId.make("task-1"),
      },
    };
    const html = renderToStaticMarkup(
      <TimelineRowCtx value={makeSharedState()}>
        <TimelineRowActivityCtx value={makeActivityState()}>
          <UserMessageRow row={automationRow} />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );

    expect(html).toContain('data-pmx-glass-zone="userBubble"');
    expect(html).toContain('data-user-message-bubble-surface="1"');
    expect(html).not.toContain("Copy prompt link");
    expect(html).not.toContain("app.t3.codes");
  });
});
