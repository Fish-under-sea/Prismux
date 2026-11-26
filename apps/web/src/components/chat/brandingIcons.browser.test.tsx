import { presentThreadShell } from "@prismux/client-runtime/state/models";
import {
  EnvironmentId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2TurnItem,
} from "@prismux/core-contracts";
import * as DateTime from "effect/DateTime";
import { GTProvider, initializeGT } from "gt-react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import type { WorkLogEntry } from "../../session-logic";
import { makeThreadFixture } from "../../test-fixtures";
import { PRISMUX_WORDMARK_TEXT } from "../PrismuxWordmark";
import { SidebarThreadRow, type SidebarProviderEntry } from "../sidebar/SidebarThreadRow";
import { TooltipProvider } from "../ui/tooltip";
import { resolveWorkStepsPolicy } from "./dshWorkSteps.logic";
import { SimpleWorkEntryRow } from "./TimelineWorkEntryRow";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
} from "./timelineRowContext";
import { V2LifecycleRow } from "./V2LifecycleRow";

const ENV_LOCAL = EnvironmentId.make("env-local");

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
  isWorking: true,
  isCompacting: false,
  isRevertingCheckpoint: false,
  backgroundWorktreeSetup: null,
  awaitingUser: false,
  isPreparingWorktree: false,
  providerStartingLabel: null,
  latestRunId: RunId.make("run-1"),
  liveAnswerPreview: null,
};

function makeDynamicToolEntry(input: {
  readonly id: string;
  readonly label: string;
  readonly toolName: string;
  readonly status: "completed" | "inProgress";
}): WorkLogEntry {
  const item: OrchestrationV2ProjectedTurnItem["item"] = {
    id: TurnItemId.make(input.id),
    threadId: ThreadId.make("thread-1"),
    runId: RunId.make("run-1"),
    nodeId: NodeId.make(`node-${input.id}`),
    providerThreadId: ProviderThreadId.make("pt-1"),
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: input.status === "inProgress" ? "running" : "completed",
    title: null,
    startedAt: DateTime.makeUnsafe("2026-11-26T10:00:00.000Z"),
    completedAt:
      input.status === "inProgress" ? null : DateTime.makeUnsafe("2026-11-26T10:00:00.250Z"),
    updatedAt: DateTime.makeUnsafe("2026-11-26T10:00:00.250Z"),
    type: "dynamic_tool",
    toolName: input.toolName,
    input: { target: "dsh" },
    output: input.status === "inProgress" ? undefined : "ok",
  };
  return {
    id: input.id,
    createdAt: "2026-11-26T10:00:00.000Z",
    label: input.label,
    tone: "tool",
    itemType: "dynamic_tool",
    toolLifecycleStatus: input.status,
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
    lastVisitedAt: DateTime.makeUnsafe("2026-11-26T10:06:00.000Z"),
    ...overrides,
  });
}

function BrandingVerificationStage() {
  initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });
  const shared = makeSharedState();
  const completedMcp = makeDynamicToolEntry({
    id: "mcp-1",
    label: "已获取可用代理与子线程能力",
    toolName: "mcp__prismux__orchestrator_capabilities",
    status: "completed",
  });
  const runningMcp = makeDynamicToolEntry({
    id: "mcp-2",
    label: "正在委托 DS 付费组子 agent 执行任务",
    toolName: "mcp__prismux__delegate_task",
    status: "inProgress",
  });
  const createdItem: OrchestrationV2TurnItem = {
    id: TurnItemId.make("tc-1"),
    threadId: ThreadId.make("thread-1"),
    runId: RunId.make("run-1"),
    nodeId: NodeId.make("node-tc-1"),
    providerThreadId: ProviderThreadId.make("pt-1"),
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 2,
    status: "completed",
    title: "DS 付费组子 agent",
    startedAt: DateTime.makeUnsafe("2026-11-26T10:00:01.000Z"),
    completedAt: DateTime.makeUnsafe("2026-11-26T10:00:02.000Z"),
    updatedAt: DateTime.makeUnsafe("2026-11-26T10:00:02.000Z"),
    type: "thread_created",
    targetThreadId: ThreadId.make("child-dsh-1"),
    targetRunId: null,
    targetProviderInstanceId: ProviderInstanceId.make("acpRegistry_dsh_paid"),
    targetModel: "DeepSeek-V4.1-Flash",
  };

  const codexId = ProviderInstanceId.make("codex");
  const dshPaidId = ProviderInstanceId.make("acpRegistry_048c43c3-0798-480e-bc42-1a2b3c4d5e6f");
  const claudeId = ProviderInstanceId.make("claudeAgent");
  const antigravityId = ProviderInstanceId.make("antigravity");
  const missingGeminiId = ProviderInstanceId.make(
    "acpRegistry_11112222-3333-4444-5555-666677778888",
  );
  const qwenId = ProviderInstanceId.make("acpRegistry_qwen-code");
  const glmId = ProviderInstanceId.make("acpRegistry_glm_local");
  const kimiId = ProviderInstanceId.make("acpRegistry_kimi-code");

  const providerMap = new Map<string, SidebarProviderEntry>([
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
        models: [],
      },
    ],
    [
      claudeId,
      {
        instanceId: claudeId,
        driverKind: ProviderDriverKind.make("claudeAgent"),
        enabled: true,
        displayName: "Claude Code",
        models: [],
      },
    ],
    [
      antigravityId,
      {
        instanceId: antigravityId,
        driverKind: ProviderDriverKind.make("antigravity"),
        enabled: true,
        displayName: "Antigravity",
        models: [],
      },
    ],
    [
      qwenId,
      {
        instanceId: qwenId,
        driverKind: ProviderDriverKind.make("acpRegistry"),
        acpRegistryAgentId: "qwen-code",
        enabled: true,
        displayName: "Qwen Code",
        models: [],
      },
    ],
    [
      glmId,
      {
        instanceId: glmId,
        driverKind: ProviderDriverKind.make("acpRegistry"),
        acpCommandPath: "glm-acp-agent.cmd",
        enabled: true,
        displayName: "主力智谱",
        models: [],
      },
    ],
    [
      kimiId,
      {
        instanceId: kimiId,
        driverKind: ProviderDriverKind.make("acpRegistry"),
        acpRegistryAgentId: "kimi-code",
        enabled: true,
        displayName: "Kimi Code",
        models: [],
      },
    ],
  ]);

  const parentId = ThreadId.make("parent-1");
  const parentThread = makeShell({
    id: parentId,
    title: "调用 dsh 付费组子代理",
    providerInstanceId: codexId,
    modelSelection: { instanceId: codexId, model: "gpt-6.2-astra" },
    latestRunId: RunId.make("run-parent"),
    status: "completed",
  });

  const makeChild = (
    id: string,
    title: string,
    instanceId: ProviderInstanceId,
    model: string,
    status: "completed" | "running" = "completed",
  ) =>
    makeShell({
      id: ThreadId.make(id),
      title,
      creationSource: "mcp",
      providerInstanceId: instanceId,
      modelSelection: { instanceId, model },
      latestRunId: RunId.make(`run-${id}`),
      status,
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });

  const children = [
    makeChild("child-dsh", "DS 付费组子 agent", dshPaidId, "DeepSeek-V4.1-Flash", "completed"),
    makeChild("child-claude", "Claude 代码审查", claudeId, "claude-opus-4-6", "running"),
    makeChild("child-agy", "Antigravity 界面验证", antigravityId, "claude-sonnet-4-6", "completed"),
    makeChild("child-gemini", "Gemini 检索子代理", missingGeminiId, "gemini-2.5-pro", "completed"),
    makeChild("child-qwen", "Qwen 补全子代理", qwenId, "qwen3-coder", "completed"),
    makeChild("child-glm", "GLM 智谱子代理", glmId, "glm-5", "completed"),
    makeChild("child-kimi", "Kimi 长文分析", kimiId, "kimi-k2", "completed"),
  ];

  return (
    <GTProvider locale="zh" translations={{}}>
      <TooltipProvider>
        <div
          data-testid="branding-verification-root"
          className="flex min-h-screen flex-col gap-6 bg-background p-6 text-foreground"
        >
          <section
            data-testid="deliverable-1-stage"
            className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4"
          >
            <div className="text-xs font-semibold text-muted-foreground">
              Deliverable 1 · MCP Orchestrator Wordmark &amp; Lifecycle Row
            </div>
            <TimelineRowCtx value={shared}>
              <TimelineRowActivityCtx value={DEFAULT_ACTIVITY}>
                <SimpleWorkEntryRow
                  workEntry={completedMcp}
                  workspaceRoot="D:\\Fish-code\\Prismux"
                />
                <SimpleWorkEntryRow workEntry={runningMcp} workspaceRoot="D:\\Fish-code\\Prismux" />
              </TimelineRowActivityCtx>
            </TimelineRowCtx>
            <V2LifecycleRow
              item={createdItem}
              environmentId={ENV_LOCAL}
              runs={[]}
              onOpenThread={vi.fn()}
            />
          </section>

          <section
            data-testid="deliverable-2-stage"
            className="flex w-80 flex-col gap-2 rounded-xl border border-border bg-sidebar p-3"
          >
            <div className="px-1 text-xs font-semibold text-sidebar-muted-foreground">
              Deliverable 2 · Level-2 Delegated Subagent Brand Icons
            </div>
            <ul className="m-0 flex flex-col p-0">
              <SidebarThreadRow
                thread={parentThread}
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
                delegatedChildren={children}
                delegatedTreeExpanded
                delegatedTreeHasRunning
                onToggleDelegatedTree={vi.fn()}
              />
            </ul>
          </section>
        </div>
      </TooltipProvider>
    </GTProvider>
  );
}

describe("v0.2.3-RC.2 Track A browser rendering verification", () => {
  it("renders unclipped Ciallo～(∠・ω< )⌒★ orchestrator badges and DeepSeek whale + multi-vendor delegated subagent icons in real Chrome", async () => {
    await page.viewport(760, 560);
    document.documentElement.classList.add("dark");
    await using _screen = await render(<BrandingVerificationStage />, { router: "/" });

    const root = document.querySelector<HTMLElement>('[data-testid="branding-verification-root"]');
    expect(root).not.toBeNull();
    const visibleText = root?.textContent ?? "";
    expect(visibleText).not.toContain("T3");

    // 1. All 3 orchestrator wordmarks render full Ciallo～(∠・ω< )⌒★ cleanly with non-clipped width
    const wordmarks = Array.from(
      document.querySelectorAll<HTMLElement>('[data-prismux-wordmark="true"]'),
    );
    expect(wordmarks.length).toBe(3);
    for (const badge of wordmarks) {
      expect(badge.textContent).toBe(PRISMUX_WORDMARK_TEXT);
      const rect = badge.getBoundingClientRect();
      expect(rect.width).toBeGreaterThan(70);
      expect(rect.height).toBeGreaterThanOrEqual(10);
      expect(badge.scrollWidth).toBeLessThanOrEqual(badge.clientWidth + 1);
    }

    // 2. Delegated DSH subagent renders DeepSeek whale SVG (NOT [AR]) with non-zero rendered bounds
    const dshSvg = document.querySelector<SVGSVGElement>('[data-dsh-brand-icon="true"]');
    expect(dshSvg).not.toBeNull();
    const dshRect = dshSvg!.getBoundingClientRect();
    expect(dshRect.width).toBeGreaterThanOrEqual(10);
    expect(dshRect.height).toBeGreaterThanOrEqual(10);

    const childRows = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="delegated-child-row"]'),
    );
    expect(childRows.length).toBe(7);
    for (const row of childRows) {
      expect(row.textContent ?? "").not.toContain("AR");
      const brandSlot = row.querySelector<HTMLElement>("[data-agent-brand]");
      expect(brandSlot).not.toBeNull();
      const visibleSvgs = Array.from(brandSlot!.querySelectorAll("svg")).filter(
        (el) => !el.classList.contains("size-0"),
      );
      expect(visibleSvgs.length).toBeGreaterThanOrEqual(1);
      const svgRect = visibleSvgs[0]!.getBoundingClientRect();
      expect(svgRect.width).toBeGreaterThanOrEqual(10);
      expect(svgRect.height).toBeGreaterThanOrEqual(10);
    }

    if (import.meta.env.VITE_CAPTURE_BRANDING_SCREENSHOT === "1") {
      await page.screenshot({ path: "rc2-icons-branding-verification.png" });
    }
  });
});
