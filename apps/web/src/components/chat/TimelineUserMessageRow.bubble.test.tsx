import {
  EnvironmentId,
  GuestMessageId,
  MessageId,
  ScheduledTaskId,
  ThreadId,
} from "@prismux/core-contracts";
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
  default: ({ text, className }: { text: string; className?: string }) => (
    <div data-mock-markdown="1" className={className}>
      <p>{text}</p>
    </div>
  ),
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

function makeSharedState(resolvedTheme: "light" | "dark" = "dark"): TimelineRowSharedState {
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
    resolvedTheme,
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

function makeMessageRow(
  text: string,
  overrides?: Partial<Extract<TimelineRow, { kind: "message" }>>,
): Extract<TimelineRow, { kind: "message" }> {
  return {
    kind: "message",
    id: "msg-bubble-1",
    createdAt: "2026-11-27T02:26:00.000Z",
    message: {
      id: MessageId.make("msg-bubble-1"),
      role: "user",
      text,
      runId: null,
      createdAt: "2026-11-27T02:26:00.000Z",
      updatedAt: "2026-11-27T02:26:00.000Z",
      streaming: false,
    },
    showAssistantMeta: false,
    showAssistantCopyButton: false,
    assistantCopyStreaming: false,
    ...overrides,
  };
}

function renderRow(
  row: Extract<TimelineRow, { kind: "message" }>,
  resolvedTheme: "light" | "dark" = "dark",
): string {
  return renderToStaticMarkup(
    <TimelineRowCtx value={makeSharedState(resolvedTheme)}>
      <TimelineRowActivityCtx value={makeActivityState()}>
        <UserMessageRow row={row} />
      </TimelineRowActivityCtx>
    </TimelineRowCtx>,
  );
}

describe("TimelineUserMessageRow compact flat bubble & tri-theme surface", () => {
  it("renders a compact flat rounded-xl bubble with px-3 py-1.5 and eliminates first/last paragraph vertical overflow", () => {
    const html = renderRow(makeMessageRow("给你的协作对象发布一个算术题"));

    // Compact flat corner radius and padding (never oversized rounded-[22px] / px-4 py-2)
    expect(html).toContain("rounded-xl");
    expect(html).toContain("px-3 py-1.5");
    expect(html).not.toContain("rounded-[22px]");
    expect(html).not.toContain("px-4 py-2");

    // Overrides unlayered `.chat-markdown.user-message-markdown p { margin: 0.65rem 0; }`
    expect(html).toContain("[&amp;_.user-message-markdown_p]:!my-1");
    expect(html).toContain("[&amp;_.user-message-markdown&gt;:first-child]:!mt-0");
    expect(html).toContain("[&amp;_.user-message-markdown&gt;:last-child]:!mb-0");

    // Compact typography inheriting tri-theme bubble text color
    expect(html).toContain("text-inherit text-sm leading-snug user-message-markdown");

    // Preserves tri-theme (Light / Dark / Liquid Glass) hooks & border/surface classes
    expect(html).toContain('data-pmx-glass-zone="userBubble"');
    expect(html).toContain('data-user-message-bubble=""');
    expect(html).toContain('data-user-message-bubble-surface="1"');
    expect(html).toContain("border border-border/55 bg-message");
  });

  it("tightens touching corners with rounded-tr-sm / rounded-br-sm for grouped user messages", () => {
    const groupedHtml = renderRow(
      makeMessageRow("连续发送的第二条消息", {
        groupedWithPrevious: true,
        groupedWithNext: true,
      }),
    );

    expect(groupedHtml).toContain("rounded-xl");
    expect(groupedHtml).toContain("rounded-tr-sm");
    expect(groupedHtml).toContain("rounded-br-sm");
    expect(groupedHtml).not.toContain("rounded-tr-md");
    expect(groupedHtml).not.toContain("rounded-br-md");
  });

  it("applies compact flat rounded-xl styling and markdown margin reset to automation and folded bubbles", () => {
    const automationRow: Extract<TimelineRow, { kind: "message" }> = {
      ...makeMessageRow("每日定时巡检任务"),
      message: {
        ...makeMessageRow("每日定时巡检任务").message,
        scheduledTaskId: ScheduledTaskId.make("task-compact-1"),
      },
    };
    const automationHtml = renderRow(automationRow, "light");

    expect(automationHtml).toContain("rounded-xl");
    expect(automationHtml).not.toContain("rounded-[22px]");
    expect(automationHtml).toContain("[&amp;_.user-message-markdown&gt;:first-child]:!mt-0");
    expect(automationHtml).toContain("[&amp;_.user-message-markdown&gt;:last-child]:!mb-0");
    expect(automationHtml).toContain('data-pmx-glass-zone="userBubble"');
    expect(automationHtml).toContain('data-user-message-bubble-surface="1"');
    expect(automationHtml).toContain("px-3 py-1.5 text-left text-sm");
  });

  it("keeps guest bubble surface distinct while inheriting compact flat bubble geometry", () => {
    const guestRow: Extract<TimelineRow, { kind: "message" }> = {
      ...makeMessageRow("Alice: 访客消息测试"),
      message: {
        ...makeMessageRow("Alice: 访客消息测试").message,
        context: {
          version: 1,
          records: [],
          guest: {
            guestMessageId: GuestMessageId.make("guest-msg-1"),
            name: "Alice",
            text: "访客消息测试",
          },
        },
      },
    };
    const guestHtml = renderRow(guestRow, "light");

    expect(guestHtml).toContain("rounded-xl");
    expect(guestHtml).toContain("px-3 py-1.5");
    expect(guestHtml).toContain("bg-guest-surface");
    expect(guestHtml).toContain("访客消息测试");
    expect(guestHtml).toContain('data-user-message-bubble=""');
    expect(guestHtml).not.toContain('data-pmx-glass-zone="userBubble"');
    expect(guestHtml).not.toContain('data-user-message-bubble-surface="1"');
  });
});
