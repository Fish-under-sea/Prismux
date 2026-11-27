import { EnvironmentId, MessageId, ThreadId } from "@prismux/core-contracts";
import { GTProvider, initializeGT } from "gt-react";
import { describe, expect, it } from "vite-plus/test";

import "@prismux/appearance/styles.css";
import "~/index.css";
import { render } from "../../../test/render";
import { UserMessageRow } from "./TimelineUserMessageRow";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRow,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
} from "./timelineRowContext";

function useThemeGuard(): Disposable {
  const prevDark = document.documentElement.classList.contains("dark");
  const prevGlass = document.documentElement.dataset.pmxGlass;
  const prevTheme = document.documentElement.dataset.pmxTheme;
  return {
    [Symbol.dispose]() {
      document.documentElement.classList.toggle("dark", prevDark);
      if (prevGlass === undefined) delete document.documentElement.dataset.pmxGlass;
      else document.documentElement.dataset.pmxGlass = prevGlass;
      if (prevTheme === undefined) delete document.documentElement.dataset.pmxTheme;
      else document.documentElement.dataset.pmxTheme = prevTheme;
    },
  };
}

function makeSharedState(resolvedTheme: "light" | "dark"): TimelineRowSharedState {
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

function makeMessageRow(text: string): Extract<TimelineRow, { kind: "message" }> {
  return {
    kind: "message",
    id: "msg-browser-bubble",
    createdAt: "2026-11-27T02:26:00.000Z",
    message: {
      id: MessageId.make("msg-browser-bubble"),
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
  };
}

describe("TimelineUserMessageRow real-Chrome bubble geometry & tri-theme CSS verification", () => {
  it("eliminates first/last paragraph vertical margin and renders compact flat geometry across Light, Dark, and Light/Dark Liquid Glass", async () => {
    using _theme = useThemeGuard();
    initializeGT({ defaultLocale: "zh", locales: ["zh", "en"] });

    const container = document.createElement("div");
    container.style.width = "640px";
    container.style.padding = "16px";

    await using screen = await render(
      <GTProvider locale="zh" translations={{}}>
        <TimelineRowCtx value={makeSharedState("dark")}>
          <TimelineRowActivityCtx value={makeActivityState()}>
            <div data-testid="single-line">
              <UserMessageRow row={makeMessageRow("给你的协作对象发布一个算术题")} />
            </div>
            <div data-testid="multi-para">
              <UserMessageRow row={makeMessageRow("第一段说明\n\n第二段要求")} />
            </div>
          </TimelineRowActivityCtx>
        </TimelineRowCtx>
      </GTProvider>,
      { container, router: false },
    );

    const singleBubble = screen.container.querySelector<HTMLElement>(
      '[data-testid="single-line"] [data-user-message-bubble]',
    );
    const singlePara = singleBubble?.querySelector<HTMLParagraphElement>("p");
    expect(singleBubble).toBeTruthy();
    expect(singlePara).toBeTruthy();

    // Verify Tailwind `!` utilities beat unlayered `.chat-markdown.user-message-markdown p { margin: 0.65rem 0; }`
    const singleParaStyle = getComputedStyle(singlePara!);
    expect(singleParaStyle.marginTop).toBe("0px");
    expect(singleParaStyle.marginBottom).toBe("0px");

    const singleBubbleStyle = getComputedStyle(singleBubble!);
    expect(singleBubbleStyle.borderRadius).toBe("12px");
    expect(singleBubbleStyle.paddingTop).toBe("6px");
    expect(singleBubbleStyle.paddingBottom).toBe("6px");
    expect(singleBubbleStyle.paddingLeft).toBe("12px");
    expect(singleBubbleStyle.paddingRight).toBe("12px");
    expect(singleBubble!.getBoundingClientRect().height).toBeLessThanOrEqual(42);

    // Multi-paragraph: zero outer top/bottom margin, tight 4px inter-paragraph rhythm
    const multiParas = screen.container.querySelectorAll<HTMLParagraphElement>(
      '[data-testid="multi-para"] [data-user-message-bubble] p',
    );
    expect(multiParas.length).toBe(2);
    expect(getComputedStyle(multiParas[0]!).marginTop).toBe("0px");
    expect(getComputedStyle(multiParas[0]!).marginBottom).toBe("4px");
    expect(getComputedStyle(multiParas[1]!).marginTop).toBe("4px");
    expect(getComputedStyle(multiParas[1]!).marginBottom).toBe("0px");

    // Mode 1: Light solid
    document.documentElement.classList.remove("dark");
    document.documentElement.dataset.pmxTheme = "light";
    document.documentElement.dataset.pmxGlass = "0";
    const lightSolid = getComputedStyle(singleBubble!);
    expect(lightSolid.backgroundColor).toBe("rgb(237, 243, 254)");
    expect(getComputedStyle(singlePara!).color).toBe("rgb(15, 23, 42)");
    expect(lightSolid.backdropFilter).toBe("none");

    // Mode 2: Dark solid
    document.documentElement.classList.add("dark");
    document.documentElement.dataset.pmxTheme = "dark";
    document.documentElement.dataset.pmxGlass = "0";
    const darkSolid = getComputedStyle(singleBubble!);
    expect(darkSolid.backgroundColor).toBe("rgb(36, 38, 43)");
    expect(getComputedStyle(singlePara!).color).toBe("rgba(248, 250, 252, 0.96)");
    expect(darkSolid.backdropFilter).toBe("none");

    // Mode 3: Dark Liquid Glass
    document.documentElement.classList.add("dark");
    document.documentElement.dataset.pmxTheme = "dark";
    document.documentElement.dataset.pmxGlass = "1";
    const darkGlass = getComputedStyle(singleBubble!);
    expect(darkGlass.backdropFilter).toContain("blur(");
    expect(darkGlass.borderRadius).toBe("12px");
    expect(getComputedStyle(singlePara!).color).toBe("rgba(255, 255, 255, 0.98)");

    // Mode 4: Light Liquid Glass
    document.documentElement.classList.remove("dark");
    document.documentElement.dataset.pmxTheme = "light";
    document.documentElement.dataset.pmxGlass = "1";
    const lightGlass = getComputedStyle(singleBubble!);
    expect(lightGlass.backdropFilter).toContain("blur(");
    expect(lightGlass.borderRadius).toBe("12px");
    expect(getComputedStyle(singlePara!).color).toBe("rgba(15, 23, 42, 0.96)");
  });
});
