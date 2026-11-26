import { presentThreadShell } from "@prismux/client-runtime/state/models";
import { scopeThreadRef, scopedThreadKey } from "@prismux/client-runtime/environment";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  type ClientSettings,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2ThreadShell,
} from "@prismux/core-contracts";
import type { LegendListRef } from "@legendapp/list/react";
import * as DateTime from "effect/DateTime";
import { GTProvider, initializeGT } from "gt-react";
import { createRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
import type { WorkLogEntry } from "../../session-logic";
import { makeThreadFixture } from "../../test-fixtures";
import { SidebarThreadRow, type SidebarProviderEntry } from "../sidebar/SidebarThreadRow";
import {
  isDelegatedChildThreadActive,
  reconcileDelegatedTreeExpansionMap,
  resolveDelegatedTreeCollapseTiming,
  resolveDelegatedTreeExpanded,
  shouldDelegatedTreeAutoExpand,
  toggleDelegatedTreeExpansion,
  type DelegatedTreeExpansionEntry,
} from "../sidebar/delegatedThreadTree.logic";
import { TooltipProvider } from "../ui/tooltip";
import { MessagesTimeline } from "./MessagesTimeline";
import { resolveWorkStepsPolicy } from "./dshWorkSteps.logic";
import { SimpleWorkEntryRow } from "./TimelineWorkEntryRow";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  WorkGroupViewCtx,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
  type WorkGroupViewState,
} from "./timelineRowContext";

const mockSettingsStore = vi.hoisted(() => {
  const defaultOverrides = (): Partial<ClientSettings> => ({
    workStepsDisplay: "detailed",
    workStepsCollapseTiming: "after-turn",
    reasoningTranslationProvider: "off",
  });
  let overrides: Partial<ClientSettings> = defaultOverrides();
  const listeners = new Set<() => void>();
  return {
    getOverrides: () => overrides,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    patch: (partial: Partial<ClientSettings>) => {
      overrides = { ...overrides, ...partial };
      for (const listener of listeners) listener();
    },
    reset: () => {
      overrides = defaultOverrides();
      for (const listener of listeners) listener();
    },
  };
});

vi.mock("../../hooks/useSettings", async (original) => {
  const actual = await original<typeof import("../../hooks/useSettings")>();
  return {
    ...actual,
    useClientSettings: <T = ClientSettings,>(selector?: (settings: ClientSettings) => T) => {
      const overrides = useSyncExternalStore(
        mockSettingsStore.subscribe,
        mockSettingsStore.getOverrides,
        mockSettingsStore.getOverrides,
      );
      const settings: ClientSettings = {
        ...DEFAULT_CLIENT_SETTINGS,
        ...overrides,
      };
      return selector ? selector(settings) : (settings as unknown as T);
    },
  };
});

const ENV_LOCAL = EnvironmentId.make("env-local");

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
    routeThreadKey: "env-local:thread-1",
    threadRef: {
      environmentId: ENV_LOCAL,
      threadId: ThreadId.make("thread-1"),
    },
    markdownCwd: "D:\\Fish-code\\Prismux",
    resolvedTheme: "dark",
    workspaceRoot: "D:\\Fish-code\\Prismux",
    skills: [],
    runs: [],
    activeThreadEnvironmentId: ENV_LOCAL,
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
    workStepsPolicy: resolveWorkStepsPolicy("detailed"),
    locale: "zh-CN",
    turnDisclosureResetCount: 0,
  };
}

const IDLE_ACTIVITY: TimelineRowActivityState = {
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

function makeCommandEntry(id: string, command: string, runId = RunId.make("run-1")): WorkLogEntry {
  const item: OrchestrationV2ProjectedTurnItem["item"] = {
    id: TurnItemId.make(id),
    threadId: ThreadId.make("thread-1"),
    runId,
    nodeId: NodeId.make(`node-${id}`),
    providerThreadId: ProviderThreadId.make("pt-1"),
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: DateTime.makeUnsafe("2026-11-26T10:00:01.000Z"),
    completedAt: DateTime.makeUnsafe("2026-11-26T10:00:01.200Z"),
    updatedAt: DateTime.makeUnsafe("2026-11-26T10:00:01.200Z"),
    type: "command_execution",
    input: command,
    output: "ok",
    exitCode: 0,
  };
  return {
    id,
    runId,
    createdAt: "2026-11-26T10:00:01.000Z",
    label: "Ran command",
    tone: "tool",
    itemType: "command_execution",
    toolLifecycleStatus: "completed",
    command,
    rawCommand: command,
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

function makeWideMcpEntry(id: string, label: string, runId = RunId.make("run-1")): WorkLogEntry {
  const item: OrchestrationV2ProjectedTurnItem["item"] = {
    id: TurnItemId.make(id),
    threadId: ThreadId.make("thread-1"),
    runId,
    nodeId: NodeId.make(`node-${id}`),
    providerThreadId: ProviderThreadId.make("pt-1"),
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 2,
    status: "completed",
    title: null,
    startedAt: DateTime.makeUnsafe("2026-11-26T10:00:02.000Z"),
    completedAt: DateTime.makeUnsafe("2026-11-26T10:00:02.300Z"),
    updatedAt: DateTime.makeUnsafe("2026-11-26T10:00:02.300Z"),
    type: "dynamic_tool",
    toolName: "orchestrator_capabilities",
    input: { threadId: "child-dsh-1" },
    output: "DS 付费组子 agent 已完成核查并返回结果。",
  };
  return {
    id,
    runId,
    createdAt: "2026-11-26T10:00:02.000Z",
    label,
    tone: "tool",
    itemType: "dynamic_tool",
    toolLifecycleStatus: "completed",
    structuredPayload: item,
    projectedItem: {
      position: 2,
      visibility: "local",
      sourceThreadId: ThreadId.make("thread-1"),
      sourceItemId: item.id,
      item,
    },
  };
}

function makeShell(overrides: Partial<OrchestrationV2ThreadShell> = {}) {
  const id = overrides.id ?? ThreadId.make("t-1");
  const base = makeThreadFixture({
    environmentId: ENV_LOCAL,
    id,
    projectId: ProjectId.make("proj-1"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-6.2-astra",
    },
  }).source;
  return presentThreadShell(ENV_LOCAL, {
    ...base,
    title: "调用 dsh 付费组子代理",
    createdAt: DateTime.makeUnsafe("2026-11-26T10:00:00.000Z"),
    updatedAt: DateTime.makeUnsafe("2026-11-26T10:05:00.000Z"),
    lastVisitedAt: DateTime.makeUnsafe("2026-11-26T10:00:00.000Z"),
    ...overrides,
  });
}

function makeProviderMap() {
  const codexId = ProviderInstanceId.make("codex");
  const dshPaidId = ProviderInstanceId.make("acpRegistry_048c43c3-0798-480e-bc42-1a2b3c4d5e6f");
  return {
    codexId,
    dshPaidId,
    providerMap: new Map<string, SidebarProviderEntry>([
      [
        codexId,
        {
          instanceId: codexId,
          driverKind: ProviderDriverKind.make("codex"),
          enabled: true,
          displayName: "Codex",
          models: [],
        },
      ],
      [
        dshPaidId,
        {
          instanceId: dshPaidId,
          driverKind: ProviderDriverKind.make("acpRegistry"),
          enabled: true,
          displayName: "DS 付费组",
          models: [
            {
              slug: "paid-group",
              name: "DeepSeek V4.1 Flash",
              isCustom: false,
              capabilities: null,
            },
          ],
        },
      ],
    ]),
  };
}

function DelegatedSidebarHarness(props: {
  readonly parent: ReturnType<typeof makeShell>;
  readonly childrenThreads: readonly ReturnType<typeof makeShell>[];
  readonly collapseTiming: "after-turn" | "next-message" | "never";
}) {
  const { providerMap } = makeProviderMap();
  const parentKey = scopedThreadKey(scopeThreadRef(props.parent.environmentId, props.parent.id));
  const anyChildRunning = props.childrenThreads.some((child) =>
    isDelegatedChildThreadActive(child),
  );
  const shouldAutoExpand = shouldDelegatedTreeAutoExpand({
    parent: props.parent,
    children: props.childrenThreads,
    collapseTiming: props.collapseTiming,
  });
  const [expansionMap, setExpansionMap] = useState<
    ReadonlyMap<string, DelegatedTreeExpansionEntry>
  >(() => new Map());
  const reconciled = reconcileDelegatedTreeExpansionMap(
    expansionMap,
    new Map([[parentKey, shouldAutoExpand]]),
  );
  if (reconciled !== expansionMap) {
    setExpansionMap(reconciled);
  }
  const expanded = resolveDelegatedTreeExpanded({
    hasRunningChild: shouldAutoExpand,
    entry: reconciled.get(parentKey),
  });

  return (
    <GTProvider locale="zh" translations={{}}>
      <TooltipProvider>
        <div className="w-[300px] rounded-xl border border-border/60 bg-sidebar/90 p-2 text-sidebar-foreground">
          <ul className="m-0 flex flex-col p-0">
            <SidebarThreadRow
              thread={props.parent}
              variant="orca-compact"
              inWorkspaceCard
              variantAction="settle"
              settlementSupported
              snoozeSupported
              pinningSupported
              isPinned={false}
              dropVerb={null}
              dragOverPinned={false}
              sweepAction={null}
              snoozeWakeLabelText={null}
              wokeAt={null}
              isActive
              isRouteThread
              readOpensPullRequestsInRightPanel={() => true}
              jumpLabel={null}
              environmentLabel="Local"
              environmentMachine="desktop"
              project={null}
              projectDisplayName="Prismux"
              providerEntryByInstanceId={providerMap}
              timestampFormat="24-hour"
              onThreadClick={vi.fn()}
              onThreadActivate={vi.fn()}
              onStartRename={vi.fn()}
              onRenameTitleChange={vi.fn()}
              onCommitRename={vi.fn()}
              onCancelRename={vi.fn()}
              isRenaming={false}
              renamingTitle=""
              onContextMenu={vi.fn()}
              onSettle={vi.fn()}
              onArchive={vi.fn()}
              onDelete={vi.fn()}
              onActionSweepStart={vi.fn()}
              onUnsettle={vi.fn()}
              onSnooze={vi.fn()}
              onUnsnooze={vi.fn()}
              onUnpin={vi.fn()}
              onAcknowledgeWoke={vi.fn()}
              delegatedChildren={props.childrenThreads}
              delegatedTreeExpanded={expanded}
              delegatedTreeHasRunning={anyChildRunning}
              onToggleDelegatedTree={(key) =>
                setExpansionMap((current) =>
                  toggleDelegatedTreeExpansion(current, key, shouldAutoExpand),
                )
              }
            />
          </ul>
        </div>
      </TooltipProvider>
    </GTProvider>
  );
}

describe("v0.2.3-RC.3 Track 4 browser verification", () => {
  it("left-aligns disclosure chevron on wide Ciallo rows matching standard 16px rows and shrinks expanded slot cleanly", async () => {
    initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });
    mockSettingsStore.reset();
    await page.viewport(720, 420);
    document.documentElement.classList.add("dark");

    const shared = makeSharedState();
    const standardEntry = makeCommandEntry("cmd-align", "[regex]::Matches('凌晨', '\\p{L}+')");
    const wideEntry = makeWideMcpEntry("mcp-align", "已读取会话记录");
    const wideIdleEntry = makeWideMcpEntry("mcp-idle", "已发送到 DS 付费组子 agent");

    await using _screen = await render(
      <GTProvider locale="zh" translations={{}}>
        <TimelineRowCtx value={shared}>
          <TimelineRowActivityCtx value={IDLE_ACTIVITY}>
            <div className="flex w-[560px] flex-col gap-1 bg-background p-4 text-foreground">
              <SimpleWorkEntryRow
                workEntry={standardEntry}
                workspaceRoot="D:\\Fish-code\\Prismux"
              />
              <SimpleWorkEntryRow workEntry={wideEntry} workspaceRoot="D:\\Fish-code\\Prismux" />
              <SimpleWorkEntryRow
                workEntry={wideIdleEntry}
                workspaceRoot="D:\\Fish-code\\Prismux"
              />
            </div>
          </TimelineRowActivityCtx>
        </TimelineRowCtx>
      </GTProvider>,
      { router: "/" },
    );

    const standardRow = document.querySelector<HTMLElement>('[data-work-entry-id="cmd-align"]')!;
    const wideRow = document.querySelector<HTMLElement>('[data-work-entry-id="mcp-align"]')!;
    expect(standardRow).not.toBeNull();
    expect(wideRow).not.toBeNull();

    const standardChevron = standardRow.querySelector<HTMLElement>(
      '[data-disclosure-chevron="true"]',
    )!;
    const standardLabel = standardRow.querySelector<HTMLElement>("code")!;
    const wideLeadingSlot = wideRow.querySelector<HTMLElement>('[data-disclosure-leading="true"]')!;
    const wideChevron = wideRow.querySelector<HTMLElement>('[data-disclosure-chevron="true"]')!;
    const wideDisclosureRow = wideRow.querySelector<HTMLElement>('[data-disclosure-row="true"]')!;
    const wideLabelBeforeHover = wideDisclosureRow.lastElementChild as HTMLElement;

    const standardChevronRect = standardChevron.getBoundingClientRect();
    const wideSlotRect = wideLeadingSlot.getBoundingClientRect();
    const wideChevronRect = wideChevron.getBoundingClientRect();
    const wideLabelLeftBeforeHover = wideLabelBeforeHover.getBoundingClientRect().left;

    // Collapsed wide slot keeps wide wordmark width (>70px), yet chevron is anchored at the EXACT left 16px column!
    expect(wideSlotRect.width).toBeGreaterThan(70);
    expect(Math.abs(wideChevronRect.left - standardChevronRect.left)).toBeLessThanOrEqual(1);
    expect(wideChevronRect.width).toBeLessThanOrEqual(16.5);
    expect(wideChevronRect.left).toBeLessThan(wideSlotRect.left + 4);

    // Hovering collapsed wide row reveals left-aligned chevron without shifting row text!
    await userEvent.hover(wideDisclosureRow);
    await vi.waitFor(() => {
      expect(Number(getComputedStyle(wideChevron).opacity)).toBeGreaterThan(0.5);
    });
    expect(
      Math.abs(wideLabelBeforeHover.getBoundingClientRect().left - wideLabelLeftBeforeHover),
    ).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs(wideChevron.getBoundingClientRect().left - standardChevronRect.left),
    ).toBeLessThanOrEqual(1);

    // Expanding wide row shrinks leading slot to size-4 (16px) with zero awkward blank gap!
    await act(async () => {
      wideRow.click();
    });
    await vi.waitFor(() => {
      expect(wideRow.getAttribute("data-open")).toBe("true");
    });

    const expandedSlotRect = wideLeadingSlot.getBoundingClientRect();
    const expandedChevronRect = wideChevron.getBoundingClientRect();
    const expandedLabelRect = wideLabelBeforeHover.getBoundingClientRect();
    const standardLabelRect = standardLabel.getBoundingClientRect();

    expect(Math.abs(expandedSlotRect.width - 16)).toBeLessThanOrEqual(1);
    expect(Math.abs(expandedChevronRect.left - standardChevronRect.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(expandedLabelRect.left - standardLabelRect.left)).toBeLessThanOrEqual(1);
  });

  it("auto-collapses completed work steps immediately after final answer under default detailed + after-turn, and honors next-message and manual toggles", async () => {
    initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });
    mockSettingsStore.reset();
    await page.viewport(820, 620);
    document.documentElement.classList.add("dark");

    const run1 = RunId.make("run-live-1");
    const run2 = RunId.make("run-live-2");
    type TimelineProps = ComponentProps<typeof MessagesTimeline>;
    type Entry = TimelineProps["timelineEntries"][number];

    const listRef = createRef<LegendListRef | null>();
    const routeThreadKey = `env-local:thread-autocollapse-${Math.random().toString(36).slice(2)}`;
    const baseProps: Omit<TimelineProps, "timelineEntries" | "isWorking" | "latestRun"> = {
      listRef,
      turnDiffSummaries: [],
      runs: [],
      routeThreadKey,
      onOpenTurnDiff: () => {},
      onOpenThread: () => {},
      onForkFromRun: async () => {},
      supportsConversationRollback: false,
      onRevertToTurnCount: () => {},
      isRevertingCheckpoint: false,
      onImageExpand: () => {},
      activeThreadEnvironmentId: ENV_LOCAL,
      markdownCwd: "D:\\Fish-code\\Prismux",
      resolvedTheme: "dark",
      timestampFormat: "24-hour",
      workspaceRoot: "D:\\Fish-code\\Prismux",
      anchorMessageId: null,
      onAnchorReady: () => {},
      onAnchorSizeChanged: () => {},
      contentInsetEndAdjustment: 0,
      emptyPlaceholderInset: 0,
      liveFollowEnabled: true,
      onIsAtEndChange: () => {},
    };

    const user1: Entry = {
      id: "u-1",
      kind: "message",
      createdAt: "2026-11-26T10:00:00.000Z",
      message: {
        id: MessageId.make("u-1"),
        role: "user",
        text: "请检查工作步骤并在结束后自动收起",
        runId: null,
        createdAt: "2026-11-26T10:00:00.000Z",
        updatedAt: "2026-11-26T10:00:00.000Z",
        streaming: false,
      },
    };
    const cmd1: Entry = {
      id: "cmd-live-1",
      kind: "work",
      createdAt: "2026-11-26T10:00:01.000Z",
      entry: makeCommandEntry("cmd-live-1", "vp test run", run1),
    };
    const mcp1: Entry = {
      id: "mcp-live-1",
      kind: "work",
      createdAt: "2026-11-26T10:00:02.000Z",
      entry: makeWideMcpEntry("mcp-live-1", "已读取会话记录", run1),
    };
    const answer1Streaming: Entry = {
      id: "a-1",
      kind: "message",
      createdAt: "2026-11-26T10:00:04.000Z",
      message: {
        id: MessageId.make("a-1"),
        role: "assistant",
        text: "正在汇总检查结果...",
        runId: run1,
        createdAt: "2026-11-26T10:00:04.000Z",
        updatedAt: "2026-11-26T10:00:04.000Z",
        streaming: true,
      },
    };
    const answer1Completed: Entry = {
      id: "a-1",
      kind: "message",
      createdAt: "2026-11-26T10:00:04.000Z",
      message: {
        id: MessageId.make("a-1"),
        role: "assistant",
        text: "检查已完成，工作步骤现已自动收起。",
        runId: run1,
        createdAt: "2026-11-26T10:00:04.000Z",
        updatedAt: "2026-11-26T10:00:12.000Z",
        streaming: false,
      },
    };

    const container = document.createElement("div");
    container.style.cssText = "height: 540px; width: 780px; display: flex; flex-direction: column;";

    // 1. Live streaming phase: steps render flat & visible (no turn-fold yet)
    await using screen = await render(
      <GTProvider locale="zh" translations={{}}>
        <MessagesTimeline
          {...baseProps}
          isWorking
          runningRunId={run1}
          latestRun={{
            runId: run1,
            status: "running",
            startedAt: "2026-11-26T10:00:00.000Z",
            completedAt: null,
          }}
          timelineEntries={[user1, cmd1, mcp1, answer1Streaming]}
        />
      </GTProvider>,
      { container, router: "/" },
    );

    await vi.waitFor(() => {
      expect(container.querySelector('[data-work-entry-id="cmd-live-1"]')).not.toBeNull();
      expect(container.querySelector('[data-work-entry-id="mcp-live-1"]')).not.toBeNull();
    });
    // User inspects cmd-live-1 while turn is still streaming
    await act(async () => {
      container.querySelector<HTMLElement>('[data-work-entry-id="cmd-live-1"]')?.click();
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-work-entry-id="cmd-live-1"]')?.getAttribute("data-open"),
      ).toBe("true");
    });

    // 2. Final answer finishes under "after-turn" -> turn-fold auto-collapses immediately!
    await screen.rerender(
      <GTProvider locale="zh" translations={{}}>
        <MessagesTimeline
          {...baseProps}
          isWorking={false}
          runningRunId={null}
          latestRun={{
            runId: run1,
            status: "completed",
            startedAt: "2026-11-26T10:00:00.000Z",
            completedAt: "2026-11-26T10:00:12.000Z",
          }}
          timelineEntries={[user1, cmd1, mcp1, answer1Completed]}
        />
      </GTProvider>,
    );

    await vi.waitFor(() => {
      const foldBtn = container.querySelector<HTMLButtonElement>(
        '[data-turn-fold-bar="true"] button',
      );
      expect(foldBtn).not.toBeNull();
      expect(foldBtn?.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector('[data-work-entry-id="cmd-live-1"]')).toBeNull();
      expect(container.querySelector('[data-work-entry-id="mcp-live-1"]')).toBeNull();
      expect(container.textContent).toContain("检查已完成，工作步骤现已自动收起。");
    });

    // 3. Manual click expands cleanly (and cmd-live-1 detail card was reset, not latched open!)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-turn-fold-bar="true"] button')?.click();
    });
    await vi.waitFor(() => {
      const foldBtn = container.querySelector<HTMLButtonElement>(
        '[data-turn-fold-bar="true"] button',
      );
      expect(foldBtn?.getAttribute("aria-expanded")).toBe("true");
      const cmdEl = container.querySelector('[data-work-entry-id="cmd-live-1"]');
      expect(cmdEl).not.toBeNull();
      expect(cmdEl?.getAttribute("data-open")).toBeNull();
    });

    // Manual click again collapses cleanly
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-turn-fold-bar="true"] button')?.click();
    });
    await vi.waitFor(() => {
      const foldBtn = container.querySelector<HTMLButtonElement>(
        '[data-turn-fold-bar="true"] button',
      );
      expect(foldBtn?.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector('[data-work-entry-id="cmd-live-1"]')).toBeNull();
    });

    // 4. Switch collapseTiming to "next-message" -> latest completed turn opens, then auto-collapses when next message starts!
    await act(async () => {
      mockSettingsStore.patch({ workStepsCollapseTiming: "next-message" });
    });
    await vi.waitFor(() => {
      const foldBtn = container.querySelector<HTMLButtonElement>(
        '[data-turn-fold-bar="true"] button',
      );
      expect(foldBtn?.getAttribute("aria-expanded")).toBe("true");
    });

    const user2: Entry = {
      id: "u-2",
      kind: "message",
      createdAt: "2026-11-26T10:02:00.000Z",
      message: {
        id: MessageId.make("u-2"),
        role: "user",
        text: "开始下一轮对话",
        runId: null,
        createdAt: "2026-11-26T10:02:00.000Z",
        updatedAt: "2026-11-26T10:02:00.000Z",
        streaming: false,
      },
    };
    await screen.rerender(
      <GTProvider locale="zh" translations={{}}>
        <MessagesTimeline
          {...baseProps}
          isWorking
          runningRunId={run2}
          latestRun={{
            runId: run2,
            status: "running",
            startedAt: "2026-11-26T10:02:00.000Z",
            completedAt: null,
          }}
          timelineEntries={[user1, cmd1, mcp1, answer1Completed, user2]}
        />
      </GTProvider>,
    );
    await vi.waitFor(() => {
      const foldBtn = container.querySelector<HTMLButtonElement>(
        '[data-turn-fold-bar="true"] button',
      );
      expect(foldBtn?.getAttribute("aria-expanded")).toBe("false");
    });
  });

  it("syncs sidebar level-2 delegated tree collapse with parent final answer & workStepsCollapseTiming and keeps manual ↳ N toggle responsive", async () => {
    initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });
    mockSettingsStore.reset();
    await page.viewport(560, 420);
    document.documentElement.classList.add("dark");

    const { dshPaidId } = makeProviderMap();
    const parentId = ThreadId.make("parent-fig2");
    const childId = ThreadId.make("child-fig2");
    const turn1Start = DateTime.makeUnsafe("2026-11-26T10:00:00.000Z");
    const childCreated = DateTime.makeUnsafe("2026-11-26T10:00:05.000Z");
    const childCompleted = DateTime.makeUnsafe("2026-11-26T10:00:12.000Z");
    const parentCompleted = DateTime.makeUnsafe("2026-11-26T10:00:20.000Z");
    const turn2Start = DateTime.makeUnsafe("2026-11-26T10:03:00.000Z");

    const parentRunning = makeShell({
      id: parentId,
      latestRunId: RunId.make("run-p1"),
      status: "running",
      latestUserMessageAt: turn1Start,
      latestRunStartedAt: turn1Start,
      lastVisitedAt: turn1Start,
    });
    const childRunning = makeShell({
      id: childId,
      title: "DS 付费组子 agent",
      creationSource: "mcp",
      providerInstanceId: dshPaidId,
      modelSelection: { instanceId: dshPaidId, model: "paid-group" },
      latestRunId: RunId.make("run-c1"),
      status: "running",
      createdAt: childCreated,
      updatedAt: childCreated,
      lastVisitedAt: turn1Start,
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const childCompletedUnseen = makeShell({
      id: childId,
      title: "DS 付费组子 agent",
      creationSource: "mcp",
      providerInstanceId: dshPaidId,
      modelSelection: { instanceId: dshPaidId, model: "paid-group" },
      latestRunId: RunId.make("run-c1"),
      status: "completed",
      createdAt: childCreated,
      updatedAt: childCompleted,
      latestRunCompletedAt: childCompleted,
      lastVisitedAt: turn1Start,
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const parentCompletedUnseen = makeShell({
      id: parentId,
      latestRunId: RunId.make("run-p1"),
      status: "completed",
      latestUserMessageAt: turn1Start,
      latestRunStartedAt: turn1Start,
      latestRunCompletedAt: parentCompleted,
      updatedAt: parentCompleted,
      lastVisitedAt: turn1Start,
    });
    const parentTurn2 = makeShell({
      id: parentId,
      latestRunId: RunId.make("run-p2"),
      status: "running",
      latestUserMessageAt: turn2Start,
      latestRunStartedAt: turn2Start,
      updatedAt: turn2Start,
      lastVisitedAt: turn2Start,
    });

    const timing = resolveDelegatedTreeCollapseTiming({
      workStepsDisplay: "detailed",
      workStepsCollapseTiming: "after-turn",
    });

    // 1. Both parent & child running -> expanded with RGB conduction ON
    await using screen = await render(
      <DelegatedSidebarHarness
        parent={parentRunning}
        childrenThreads={[childRunning]}
        collapseTiming={timing}
      />,
      { router: "/" },
    );

    await vi.waitFor(() => {
      const toggle = document.querySelector<HTMLButtonElement>(
        '[data-testid="sidebar-delegated-tree-toggle"]',
      );
      expect(toggle?.getAttribute("aria-expanded")).toBe("true");
      expect(document.querySelector('[data-testid="delegated-subthread-tree"]')).not.toBeNull();
      expect(
        document
          .querySelector('[data-testid="delegated-tree-connector"]')
          ?.getAttribute("data-rgb-active"),
      ).toBe("1");
    });

    // 2. Child completes with unseen green ✓ while parent is STILL generating final answer ->
    // tree STAYS EXPANDED while RGB turns OFF!
    await screen.rerender(
      <DelegatedSidebarHarness
        parent={parentRunning}
        childrenThreads={[childCompletedUnseen]}
        collapseTiming={timing}
      />,
    );
    await vi.waitFor(() => {
      const toggle = document.querySelector<HTMLButtonElement>(
        '[data-testid="sidebar-delegated-tree-toggle"]',
      );
      expect(toggle?.getAttribute("aria-expanded")).toBe("true");
      expect(document.querySelector('[data-testid="delegated-subthread-tree"]')).not.toBeNull();
      expect(
        document
          .querySelector('[data-testid="delegated-tree-connector"]')
          ?.getAttribute("data-rgb-active"),
      ).toBe("0");
      expect(document.querySelector('[data-delegated-status="unread"]')).not.toBeNull();
    });

    // 3. Parent finishes final answer -> tree AUTO-COLLAPSES IMMEDIATELY under "after-turn"!
    await screen.rerender(
      <DelegatedSidebarHarness
        parent={parentCompletedUnseen}
        childrenThreads={[childCompletedUnseen]}
        collapseTiming={timing}
      />,
    );
    await vi.waitFor(() => {
      const toggle = document.querySelector<HTMLButtonElement>(
        '[data-testid="sidebar-delegated-tree-toggle"]',
      );
      expect(toggle?.getAttribute("aria-expanded")).toBe("false");
      expect(document.querySelector('[data-testid="delegated-subthread-tree"]')).toBeNull();
    });

    // 4. Manual click on `↳ 1` expands cleanly and second click collapses cleanly!
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="sidebar-delegated-tree-toggle"]')
        ?.click();
    });
    await vi.waitFor(() => {
      expect(
        document
          .querySelector('[data-testid="sidebar-delegated-tree-toggle"]')
          ?.getAttribute("aria-expanded"),
      ).toBe("true");
      expect(document.querySelector('[data-testid="delegated-subthread-tree"]')).not.toBeNull();
    });

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="sidebar-delegated-tree-toggle"]')
        ?.click();
    });
    await vi.waitFor(() => {
      expect(
        document
          .querySelector('[data-testid="sidebar-delegated-tree-toggle"]')
          ?.getAttribute("aria-expanded"),
      ).toBe("false");
      expect(document.querySelector('[data-testid="delegated-subthread-tree"]')).toBeNull();
    });

    // 5. Under "next-message": stays expanded after Turn 1 completes, auto-collapses when Turn 2 starts!
    await screen.rerender(
      <DelegatedSidebarHarness
        parent={parentCompletedUnseen}
        childrenThreads={[childCompletedUnseen]}
        collapseTiming="next-message"
      />,
    );
    await vi.waitFor(() => {
      expect(
        document
          .querySelector('[data-testid="sidebar-delegated-tree-toggle"]')
          ?.getAttribute("aria-expanded"),
      ).toBe("true");
    });

    await screen.rerender(
      <DelegatedSidebarHarness
        parent={parentTurn2}
        childrenThreads={[childCompletedUnseen]}
        collapseTiming="next-message"
      />,
    );
    await vi.waitFor(() => {
      expect(
        document
          .querySelector('[data-testid="sidebar-delegated-tree-toggle"]')
          ?.getAttribute("aria-expanded"),
      ).toBe("false");
    });
  });

  it("renders visual verification showcase for all 3 RC.3 Track 4 fixes", async () => {
    initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });
    mockSettingsStore.reset();
    await page.viewport(820, 620);
    document.documentElement.classList.add("dark");

    const expandedState: WorkGroupViewState = {
      scrollPositions: new Map(),
      expandedEntries: new Set(["mcp-expanded-demo"]),
    };
    const shared = makeSharedState(expandedState);
    const { dshPaidId } = makeProviderMap();
    const parentId = ThreadId.make("parent-showcase");
    const childId = ThreadId.make("child-showcase");
    const turnStart = DateTime.makeUnsafe("2026-11-26T10:00:00.000Z");
    const doneAt = DateTime.makeUnsafe("2026-11-26T10:00:12.000Z");
    const completedParent = makeShell({
      id: parentId,
      title: "调用 dsh 付费组子代理",
      latestRunId: RunId.make("run-show"),
      status: "completed",
      latestUserMessageAt: turnStart,
      latestRunStartedAt: turnStart,
      latestRunCompletedAt: doneAt,
      updatedAt: doneAt,
      lastVisitedAt: turnStart,
    });
    const completedChild = makeShell({
      id: childId,
      title: "DS 付费组子 agent",
      creationSource: "mcp",
      providerInstanceId: dshPaidId,
      modelSelection: { instanceId: dshPaidId, model: "paid-group" },
      latestRunId: RunId.make("run-show-c"),
      status: "completed",
      createdAt: turnStart,
      updatedAt: doneAt,
      latestRunCompletedAt: doneAt,
      lastVisitedAt: turnStart,
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });

    await using _screen = await render(
      <GTProvider locale="zh" translations={{}}>
        <div className="flex flex-col gap-4 bg-background p-5 text-foreground">
          <section className="rounded-xl border border-border/60 bg-card/70 p-3.5">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              1. Left-Aligned Ciallo Disclosure Slot (Hover &amp; Expanded)
            </div>
            <TimelineRowCtx value={shared}>
              <TimelineRowActivityCtx value={IDLE_ACTIVITY}>
                <WorkGroupViewCtx
                  value={{
                    state: expandedState,
                    viewedImages: [],
                    onToggleEntry: () => undefined,
                    onContentReady: () => undefined,
                  }}
                >
                  <div className="flex flex-col gap-1">
                    <SimpleWorkEntryRow
                      workEntry={makeCommandEntry(
                        "cmd-demo",
                        "[regex]::Matches('凌晨', '\\p{L}+')",
                      )}
                      workspaceRoot="D:\\Fish-code\\Prismux"
                    />
                    <SimpleWorkEntryRow
                      workEntry={makeWideMcpEntry(
                        "mcp-hover-demo",
                        "已读取会话记录（悬停态左对齐）",
                      )}
                      workspaceRoot="D:\\Fish-code\\Prismux"
                    />
                    <SimpleWorkEntryRow
                      workEntry={makeWideMcpEntry(
                        "mcp-expanded-demo",
                        "已读取会话记录（展开态紧贴左列）",
                      )}
                      workspaceRoot="D:\\Fish-code\\Prismux"
                    />
                    <SimpleWorkEntryRow
                      workEntry={makeWideMcpEntry("mcp-idle-demo", "已发送到 DS 付费组子 agent")}
                      workspaceRoot="D:\\Fish-code\\Prismux"
                    />
                  </div>
                </WorkGroupViewCtx>
              </TimelineRowActivityCtx>
            </TimelineRowCtx>
          </section>

          <section className="rounded-xl border border-border/60 bg-card/70 p-3.5">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              2. Auto-Collapsed Sidebar Delegated Tree (Parent &amp; Child Completed ✓ + after-turn)
            </div>
            <DelegatedSidebarHarness
              parent={completedParent}
              childrenThreads={[completedChild]}
              collapseTiming="after-turn"
            />
          </section>
        </div>
      </GTProvider>,
      { router: "/" },
    );

    const hoverRow = document.querySelector<HTMLElement>(
      '[data-work-entry-id="mcp-hover-demo"] [data-disclosure-row="true"]',
    )!;
    await userEvent.hover(hoverRow);
    await vi.waitFor(() => {
      const chevron = hoverRow.querySelector<HTMLElement>('[data-disclosure-chevron="true"]')!;
      expect(Number(getComputedStyle(chevron).opacity)).toBeGreaterThan(0.5);
    });
    expect(
      document
        .querySelector('[data-testid="sidebar-delegated-tree-toggle"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");

    if (import.meta.env.VITE_CAPTURE_RC3_SCREENSHOT === "1") {
      await page.screenshot({ path: "rc3-ui-collapse-slot-verification.png" });
    }
  });
});
