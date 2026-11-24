// @effect-diagnostics-next-line nodeBuiltinImport:off
import fs from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import path from "node:path";
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import {
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../../rightPanelStore";
import { TooltipProvider } from "../ui/tooltip";
import { shouldPreservePopoverOnSubmenuDismiss } from "./WorkspaceNewTabPopover";
import { WorkspacePaneContent } from "./WorkspacePaneContent";
import { WorkspaceTabBar } from "./WorkspaceTabBar";
import { PrismuxStageFrame } from "./WorkspaceTopbarPortalContext";
import {
  buildQuickLaunchAgentOptions,
  classifyQuickLaunchUrl,
  filterQuickLaunchResults,
  resolveQuickLaunchAgentTarget,
  type QuickLaunchHistoryThread,
} from "./workspaceQuickLaunch.logic";
import {
  clampSplitRatio,
  countLeafPanes,
  DEFAULT_PRIMARY_PANE_ID,
  listLeafPaneIds,
  sanitizeRehydratedState,
  useWorkspaceTabsStore,
  WORKSPACE_MAX_SPLIT_PANES,
} from "./workspaceTabsStore";

const ENV_LOCAL = EnvironmentId.make("env-local");
const THREAD_A = ThreadId.make("thread-a");
const THREAD_B = ThreadId.make("thread-b");
const THREAD_C = ThreadId.make("thread-c");
const DRAFT_1 = "draft-1" as DraftId;

function makeProvider(input: {
  instanceId: string;
  driver: string;
  displayName?: string;
  enabled?: boolean;
  models?: ServerProvider["models"];
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver),
    ...(input.displayName ? { displayName: input.displayName } : {}),
    enabled: input.enabled ?? true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-23T00:00:00.000Z",
    models: input.models ?? [
      {
        slug: `${input.instanceId}-default`,
        name: `${input.instanceId} Default`,
        isDefault: true,
        isCustom: false,
        capabilities: {},
      },
    ],
    slashCommands: [],
    skills: [],
  };
}

describe("workspaceTabsStore", () => {
  beforeEach(() => {
    useWorkspaceTabsStore.getState().resetWorkspace();
  });

  it("opens, activates, reorders, and closes tabs while selecting neighbor tab", () => {
    const store = useWorkspaceTabsStore.getState();
    const tab1 = store.openTab({
      kind: "thread",
      title: "修复登录状态",
      providerId: "codex",
      environmentId: ENV_LOCAL,
      threadId: THREAD_A,
    });
    const tab2 = store.openTab({
      kind: "terminal",
      title: "",
      shell: "PowerShell",
    });
    const tab3 = store.openTab({
      kind: "browser",
      title: "localhost:5173",
      url: "http://localhost:5173/",
    });

    let state = useWorkspaceTabsStore.getState();
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([tab1, tab2, tab3]);
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.activeTabId).toBe(tab3);
    expect(state.tabs[tab2]?.title).toBe("Terminal 1");

    // Deduplicates thread tabs by scoped thread ref
    const deduped = store.openTab({
      kind: "thread",
      title: "修复登录状态 v2",
      providerId: "codex",
      environmentId: ENV_LOCAL,
      threadId: THREAD_A,
    });
    expect(deduped).toBe(tab1);
    state = useWorkspaceTabsStore.getState();
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.activeTabId).toBe(tab1);
    expect(state.tabs[tab1]?.title).toBe("修复登录状态 v2");

    // Reorders tab3 to index 0
    store.reorderTab(DEFAULT_PRIMARY_PANE_ID, tab3, 0);
    expect(useWorkspaceTabsStore.getState().panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([
      tab3,
      tab1,
      tab2,
    ]);

    // Closing active tab1 falls back to neighbor tab2
    store.closeTab(tab1, DEFAULT_PRIMARY_PANE_ID);
    state = useWorkspaceTabsStore.getState();
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([tab3, tab2]);
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.activeTabId).toBe(tab2);
    expect(state.tabs[tab1]).toBeUndefined();
  });

  it("syncs route target and promotes draft tab to server thread in place without duplication", () => {
    const store = useWorkspaceTabsStore.getState();
    const draftTabId = store.syncRouteTarget({
      target: { kind: "draft", draftId: DRAFT_1 },
      title: "Claude Code",
      providerId: "claudeAgent",
      environmentId: ENV_LOCAL,
      threadId: THREAD_B,
    });
    expect(draftTabId).toBeTruthy();
    expect(useWorkspaceTabsStore.getState().tabs[draftTabId!]?.kind).toBe("draft");

    store.promoteDraftTab(
      DRAFT_1,
      { environmentId: ENV_LOCAL, threadId: THREAD_B },
      { title: "重构分屏布局" },
    );

    const promoted = useWorkspaceTabsStore.getState().tabs[draftTabId!];
    expect(promoted?.kind).toBe("thread");
    expect(promoted?.threadId).toBe(THREAD_B);
    expect(promoted?.draftId).toBeNull();
    expect(promoted?.title).toBe("重构分屏布局");

    // Subsequent route sync matches the promoted tab rather than creating a second one
    const syncedAgain = store.syncRouteTarget({
      target: { kind: "server", threadRef: { environmentId: ENV_LOCAL, threadId: THREAD_B } },
      title: "重构分屏布局",
      providerId: "claudeAgent",
    });
    expect(syncedAgain).toBe(draftTabId);
    expect(useWorkspaceTabsStore.getState().panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toHaveLength(1);
  });

  it("supports horizontal and vertical splits up to 3 panes, clamps split ratios, and tracks focus", () => {
    const store = useWorkspaceTabsStore.getState();
    store.openTab({
      kind: "thread",
      title: "主会话",
      providerId: "codex",
      environmentId: ENV_LOCAL,
      threadId: THREAD_A,
    });

    const rightPaneId = store.splitPane(DEFAULT_PRIMARY_PANE_ID, "horizontal", {
      kind: "agent",
      title: "Claude Code",
      providerId: "claude-code",
    });
    expect(rightPaneId).toBeTruthy();

    let state = useWorkspaceTabsStore.getState();
    expect(countLeafPanes(state.layout)).toBe(2);
    expect(state.focusedPaneId).toBe(rightPaneId);
    expect(state.layout.type).toBe("split");
    if (state.layout.type === "split") {
      expect(state.layout.direction).toBe("horizontal");
      expect(state.layout.ratio).toBe(0.5);

      store.setSplitRatio(state.layout.id, 0.99);
      const updated = useWorkspaceTabsStore.getState().layout;
      expect(updated.type === "split" ? updated.ratio : 0).toBe(clampSplitRatio(0.99));

      store.setSplitRatio(state.layout.id, 0.01);
      const updatedMin = useWorkspaceTabsStore.getState().layout;
      expect(updatedMin.type === "split" ? updatedMin.ratio : 0).toBe(clampSplitRatio(0.01));
    }

    // Add a third split vertically
    const bottomRightPaneId = store.splitPane(rightPaneId!, "vertical", {
      kind: "terminal",
      title: "PowerShell",
      shell: "PowerShell",
    });
    expect(bottomRightPaneId).toBeTruthy();
    expect(countLeafPanes(useWorkspaceTabsStore.getState().layout)).toBe(WORKSPACE_MAX_SPLIT_PANES);

    // 4th split is safely refused at max cap
    const fourthPane = store.splitPane(bottomRightPaneId!, "horizontal");
    expect(fourthPane).toBeNull();
    expect(countLeafPanes(useWorkspaceTabsStore.getState().layout)).toBe(WORKSPACE_MAX_SPLIT_PANES);

    // Focus switching updates focusedPaneId
    store.focusPane(DEFAULT_PRIMARY_PANE_ID);
    expect(useWorkspaceTabsStore.getState().focusedPaneId).toBe(DEFAULT_PRIMARY_PANE_ID);
  });

  it("auto-collapses a split pane when its last tab is closed and merges tabs when closePane is called", () => {
    const store = useWorkspaceTabsStore.getState();
    const primaryTab = store.openTab({
      kind: "thread",
      title: "左侧 Codex",
      providerId: "codex",
      environmentId: ENV_LOCAL,
      threadId: THREAD_A,
    });
    const rightPaneId = store.splitPane(DEFAULT_PRIMARY_PANE_ID, "horizontal", {
      kind: "thread",
      title: "右侧 Claude Code",
      providerId: "claude-code",
      environmentId: ENV_LOCAL,
      threadId: THREAD_B,
    })!;

    const rightTabId = useWorkspaceTabsStore.getState().panes[rightPaneId]!.activeTabId!;
    // Closing last tab in right pane auto-recovers back to 1 pane
    store.closeTab(rightTabId, rightPaneId);
    let state = useWorkspaceTabsStore.getState();
    expect(countLeafPanes(state.layout)).toBe(1);
    expect(listLeafPaneIds(state.layout)).toEqual([DEFAULT_PRIMARY_PANE_ID]);
    expect(state.focusedPaneId).toBe(DEFAULT_PRIMARY_PANE_ID);
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([primaryTab]);

    // Split again with a real thread and closePane with mergeTabs=true -> tab survives in primary pane!
    const split2 = store.splitPane(DEFAULT_PRIMARY_PANE_ID, "vertical", {
      kind: "thread",
      title: "下方 Antigravity",
      providerId: "antigravity",
      environmentId: ENV_LOCAL,
      threadId: THREAD_C,
    })!;
    const mergedTabId = useWorkspaceTabsStore.getState().panes[split2]!.activeTabId!;
    store.closePane(split2, { mergeTabs: true });

    state = useWorkspaceTabsStore.getState();
    expect(countLeafPanes(state.layout)).toBe(1);
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([primaryTab, mergedTabId]);
    expect(state.tabs[mergedTabId]?.title).toBe("下方 Antigravity");
  });

  it("moves tabs across panes and collapses emptied source pane automatically", () => {
    const store = useWorkspaceTabsStore.getState();
    const tab1 = store.openTab({
      kind: "thread",
      title: "线程 A",
      providerId: "codex",
      environmentId: ENV_LOCAL,
      threadId: THREAD_A,
    });
    const tab2 = store.openTab({
      kind: "diff",
      title: "差异",
    });

    const newPaneId = store.moveTabToNewSplit(tab2, DEFAULT_PRIMARY_PANE_ID, "horizontal")!;
    expect(newPaneId).toBeTruthy();
    expect(countLeafPanes(useWorkspaceTabsStore.getState().layout)).toBe(2);
    expect(useWorkspaceTabsStore.getState().panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([tab1]);
    expect(useWorkspaceTabsStore.getState().panes[newPaneId]?.tabIds).toEqual([tab2]);

    // Moving tab2 back into primary pane empties newPaneId -> auto-collapses to single pane
    store.moveTabToPane(tab2, newPaneId, DEFAULT_PRIMARY_PANE_ID);
    const state = useWorkspaceTabsStore.getState();
    expect(countLeafPanes(state.layout)).toBe(1);
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([tab1, tab2]);
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.activeTabId).toBe(tab2);
  });
});

describe("workspaceQuickLaunch.logic", () => {
  it("classifies valid http(s)/localhost/domain URLs and rejects unsafe schemes or plain text", () => {
    expect(classifyQuickLaunchUrl("https://github.com/Fish-under-sea/Prismux")).toEqual({
      raw: "https://github.com/Fish-under-sea/Prismux",
      normalizedUrl: "https://github.com/Fish-under-sea/Prismux",
      displayHost: "github.com",
    });
    expect(classifyQuickLaunchUrl("localhost:5173/app")?.normalizedUrl).toBe(
      "http://localhost:5173/app",
    );
    expect(classifyQuickLaunchUrl("docs.prismux.dev")?.normalizedUrl).toBe(
      "https://docs.prismux.dev/",
    );
    expect(classifyQuickLaunchUrl("javascript:alert(1)")).toBeNull();
    expect(classifyQuickLaunchUrl("file:///C:/Windows/System32")).toBeNull();
    expect(classifyQuickLaunchUrl("data:text/html,hi")).toBeNull();
    expect(classifyQuickLaunchUrl("codex model")).toBeNull();
  });

  it("builds dynamic agent options with canonical names & recent threads and filters omnibox search", () => {
    const entries = deriveProviderInstanceEntries([
      makeProvider({ instanceId: "claudeAgent", driver: "claudeAgent" }),
      makeProvider({ instanceId: "codex", driver: "codex" }),
      makeProvider({ instanceId: "antigravity", driver: "antigravity" }),
      makeProvider({ instanceId: "omp", driver: "acpRegistry", displayName: "omp" }),
      makeProvider({ instanceId: "disabled-one", driver: "cursor", enabled: false }),
    ]);

    const historyThreads: QuickLaunchHistoryThread[] = [
      {
        environmentId: ENV_LOCAL,
        threadId: THREAD_A,
        title: "优化液态玻璃模糊度",
        projectName: "Prismux",
        providerId: "claudeAgent",
        instanceId: ProviderInstanceId.make("claudeAgent"),
      },
      {
        environmentId: ENV_LOCAL,
        threadId: THREAD_B,
        title: "实现 PTY 环形缓冲",
        projectName: "Prismux",
        providerId: "codex",
        instanceId: ProviderInstanceId.make("codex"),
      },
    ];

    const agents = buildQuickLaunchAgentOptions({
      instanceEntries: entries,
      historyThreads,
    });
    expect(agents.map((a) => a.displayName)).toEqual([
      "Claude Code",
      "Codex",
      "Antigravity",
      "oh-my-pi",
    ]);
    expect(agents[0]?.recentThreads.map((t) => t.title)).toEqual(["优化液态玻璃模糊度"]);
    expect(agents[1]?.recentThreads.map((t) => t.title)).toEqual(["实现 PTY 环形缓冲"]);

    const openTabs = [
      {
        paneId: DEFAULT_PRIMARY_PANE_ID,
        tab: {
          id: "tab-term-1",
          kind: "terminal" as const,
          title: "Terminal 1",
          shell: "PowerShell",
          createdAt: 1,
          lastActiveAt: 1,
        },
      },
    ];

    const filteredClaude = filterQuickLaunchResults("claude", {
      openTabs,
      historyThreads,
      agents,
    });
    expect(filteredClaude.isSearching).toBe(true);
    expect(filteredClaude.agents.map((a) => a.displayName)).toEqual(["Claude Code"]);
    expect(filteredClaude.historyThreads.map((t) => t.title)).toEqual(["优化液态玻璃模糊度"]);

    const filteredTool = filterQuickLaunchResults("终端", {
      openTabs,
      historyThreads,
      agents,
    });
    expect(filteredTool.tools.some((t) => t.id === "terminal")).toBe(true);

    const filteredUrl = filterQuickLaunchResults("localhost:3000", {
      openTabs,
      historyThreads,
      agents,
    });
    expect(filteredUrl.urlTarget?.normalizedUrl).toBe("http://localhost:3000/");
  });

  it("syncs custom provider renames cleanly in quick launch options and never leaks UUID instance IDs", () => {
    const codexDriver = ProviderDriverKind.make("codex");
    const claudeDriver = ProviderDriverKind.make("claudeAgent");
    const uuidId1 = ProviderInstanceId.make("codex_048c43c3-0798-480e-bc42-1a2b3c4d5e6f");
    const uuidId2 = ProviderInstanceId.make("codex_88888888-1111-4222-8333-444444444444");

    // 1. UUID instance explicitly renamed to "Codex" + default Claude renamed to "我的克劳德"
    const renamedEntries = deriveProviderInstanceEntries([
      makeProvider({ instanceId: uuidId1, driver: codexDriver, displayName: "Codex" }),
      makeProvider({ instanceId: "claudeAgent", driver: claudeDriver, displayName: "我的克劳德" }),
    ]);
    const renamedAgents = buildQuickLaunchAgentOptions({
      instanceEntries: renamedEntries,
      historyThreads: [],
    });
    expect(renamedAgents.map((a) => a.displayName)).toEqual(["Codex", "我的克劳德"]);
    expect(renamedAgents.every((a) => !/[0-9a-f]{8}/i.test(a.displayName))).toBe(true);

    // 2. Multiple unnamed UUID Codex instances use clean minimal numbering "Codex", "Codex (2)"
    const multiUnnamedEntries = deriveProviderInstanceEntries([
      makeProvider({ instanceId: uuidId1, driver: codexDriver }),
      makeProvider({ instanceId: uuidId2, driver: codexDriver }),
    ]);
    const multiUnnamedAgents = buildQuickLaunchAgentOptions({
      instanceEntries: multiUnnamedEntries,
      historyThreads: [],
    });
    expect(multiUnnamedAgents.map((a) => a.displayName)).toEqual(["Codex", "Codex (2)"]);
  });

  it("resolves valid provider instance & default model for Codex, Claude Code, and Antigravity even before server hydration", () => {
    // 1. Hydrated server providers
    const entries = deriveProviderInstanceEntries([
      makeProvider({ instanceId: "codex", driver: "codex" }),
      makeProvider({ instanceId: "claudeAgent", driver: "claudeAgent" }),
      makeProvider({ instanceId: "antigravity", driver: "antigravity" }),
    ]);
    const agents = buildQuickLaunchAgentOptions({ instanceEntries: entries, historyThreads: [] });
    const resolvedHydrated = agents.map((agent) => resolveQuickLaunchAgentTarget(agent, entries));
    expect(resolvedHydrated.map((r) => r.modelSelection)).toEqual([
      { instanceId: "codex", model: "codex-default" },
      { instanceId: "claudeAgent", model: "claudeAgent-default" },
      { instanceId: "antigravity", model: "antigravity-default" },
    ]);

    // 2. Fallback agents when instanceEntries is empty (blank workspace / offline before config load)
    const fallbackAgents = buildQuickLaunchAgentOptions({ instanceEntries: [], historyThreads: [] });
    const claudeFallback = resolveQuickLaunchAgentTarget(
      fallbackAgents.find((a) => a.brandId === "claude-code")!,
      [],
    );
    const codexFallback = resolveQuickLaunchAgentTarget(
      fallbackAgents.find((a) => a.brandId === "codex")!,
      [],
    );
    const agyFallback = resolveQuickLaunchAgentTarget(
      fallbackAgents.find((a) => a.brandId === "antigravity")!,
      [],
    );
    expect(claudeFallback.modelSelection?.instanceId).toBe("claudeAgent");
    expect(claudeFallback.model).toBeTruthy();
    expect(codexFallback.modelSelection?.instanceId).toBe("codex");
    expect(codexFallback.model).toBeTruthy();
    expect(agyFallback.modelSelection).toEqual({
      instanceId: "antigravity",
      model: ANTIGRAVITY_DEFAULT_MODEL,
    });
  });

  it("preserves previous empty draft sessions when preservePreviousDraft is set for multi-agent main tabs", () => {
    const draftStore = useComposerDraftStore.getState();
    const projectRef = { environmentId: ENV_LOCAL, projectId: ProjectId.make("proj-multi-tab") };
    const logicalKey = "logical:proj-multi-tab";
    const draftCodex = "draft-codex-tab" as DraftId;
    const draftClaude = "draft-claude-tab" as DraftId;

    draftStore.setLogicalProjectDraftThreadId(logicalKey, projectRef, draftCodex, {
      threadId: THREAD_A,
    });
    draftStore.setModelSelection(
      draftCodex,
      { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      { explicit: true, replaceOptions: true },
    );

    draftStore.setLogicalProjectDraftThreadId(logicalKey, projectRef, draftClaude, {
      threadId: THREAD_B,
      preservePreviousDraft: true,
    });
    draftStore.setModelSelection(
      draftClaude,
      { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-sonnet-4-6" },
      { explicit: true, replaceOptions: true },
    );

    const latest = useComposerDraftStore.getState();
    expect(latest.getDraftSession(draftCodex)).not.toBeNull();
    expect(latest.getDraftSession(draftClaude)).not.toBeNull();
    expect(latest.getComposerDraft(draftCodex)?.activeProvider).toBe("codex");
    expect(latest.getComposerDraft(draftClaude)?.activeProvider).toBe("claudeAgent");

    latest.clearDraftThread(draftCodex);
    latest.clearDraftThread(draftClaude);
  });
});

describe("WorkspaceTabBar markup", () => {
  it("renders chromeBars glass zone, canonical brand tabs, + trigger, and horizontal/vertical/close split controls", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <WorkspaceTabBar
          pane={{
            id: "pane-left",
            tabIds: ["tab-1", "tab-2"],
            activeTabId: "tab-1",
          }}
          tabs={[
            {
              id: "tab-1",
              kind: "thread",
              title: "Codex",
              providerId: "codex",
              createdAt: 1,
              lastActiveAt: 2,
            },
            {
              id: "tab-2",
              kind: "terminal",
              title: "Terminal 1",
              shell: "PowerShell",
              createdAt: 1,
              lastActiveAt: 1,
            },
          ]}
          isFocused
          paneCount={2}
          otherPaneIds={["pane-right"]}
          touchesTopEdge
          touchesLeftEdge
          touchesRightEdge={false}
          newTabPopover={{
            openTabs: [],
            historyThreads: [],
            agents: [],
            onActivateOpenTab: vi.fn(),
            onOpenHistoryThread: vi.fn(),
            onLaunchAgent: vi.fn(),
            onRunQuickTool: vi.fn(),
            onOpenUrl: vi.fn(),
            onOpenAgentSettings: vi.fn(),
          }}
          onActivateTab={vi.fn()}
          onCloseTab={vi.fn()}
          onSplitPane={vi.fn()}
          onClosePane={vi.fn()}
          onMoveTabToPane={vi.fn()}
          onReorderTab={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(html).toContain('data-pmx-glass-zone="shellFrame"');
    expect(html).not.toContain("border-b border-border/60");
    expect(html).toContain('data-workspace-tab="tab-1"');
    expect(html).toContain('data-agent-brand="codex"');
    expect(html).toContain("Terminal 1");
    expect(html).toContain('data-workspace-new-tab-trigger="pane-left"');
    expect(html).toContain('data-workspace-split-horizontal="pane-left"');
    expect(html).toContain('data-workspace-split-vertical="pane-left"');
    expect(html).toContain('data-workspace-close-pane="pane-left"');
  });

  it("renders seamless concave stage frame with 4 inverted corners, 7px right shellFrame edge when closed, and right-open handoff", () => {
    const closedHtml = renderToStaticMarkup(
      <PrismuxStageFrame rightPanelOpen={false}>
        <div>Stage Content</div>
      </PrismuxStageFrame>,
    );
    expect(closedHtml).toContain('data-pmx-stage-frame="1"');
    expect(closedHtml).toContain('data-pmx-right-open="0"');
    expect(closedHtml).toContain('data-pmx-right-frame-edge="1"');
    expect(closedHtml).toContain('data-pmx-glass-zone="shellFrame"');
    expect(closedHtml).toContain('data-pmx-stage-corner="tl"');
    expect(closedHtml).toContain('data-pmx-stage-corner="tr"');
    expect(closedHtml).toContain('data-pmx-stage-corner="bl"');
    expect(closedHtml).toContain('data-pmx-stage-corner="br"');
    expect(closedHtml).toContain('data-pmx-inner-stage="1"');
    expect(closedHtml).not.toContain("mx-1.5");

    const openHtml = renderToStaticMarkup(
      <PrismuxStageFrame rightPanelOpen>
        <div>Stage Content</div>
      </PrismuxStageFrame>,
    );
    expect(openHtml).toContain('data-pmx-stage-frame="1"');
    expect(openHtml).toContain('data-pmx-right-open="1"');
    expect(openHtml).not.toContain('data-pmx-right-frame-edge="1"');
    expect(openHtml).toContain('data-pmx-stage-corner="tl"');
    expect(openHtml).toContain('data-pmx-stage-corner="tr"');
    expect(openHtml).toContain('data-pmx-stage-corner="bl"');
    expect(openHtml).toContain('data-pmx-stage-corner="br"');
    expect(openHtml).toContain('data-pmx-inner-stage="1"');
    expect(openHtml).not.toContain("mx-1.5");
    expect(openHtml).not.toContain("mb-1.5");
    expect(openHtml).not.toContain("m-2");
    expect(closedHtml).not.toContain("mb-1.5");
    expect(closedHtml).not.toContain("m-2");
  });

  it("hosts quick-launched multi-agent sessions smoothly inside the right sidebar store without splitting main pane", () => {
    const hostRef = { environmentId: ENV_LOCAL, threadId: THREAD_A };
    useRightPanelStore.getState().removeThread(hostRef);

    const surfaceId = useRightPanelStore.getState().openAgentSession(hostRef, {
      title: "Claude Code",
      providerId: "claude-code",
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-sonnet-4-6",
    });

    const panelState = selectThreadRightPanelState(
      useRightPanelStore.getState().byThreadKey,
      hostRef,
    );
    expect(panelState.isOpen).toBe(true);
    expect(panelState.activeSurfaceId).toBe(surfaceId);

    const activeSurface = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      hostRef,
    );
    expect(activeSurface).toMatchObject({
      id: surfaceId,
      kind: "agent-session",
      title: "Claude Code",
      providerId: "claude-code",
    });

    // Promoting / binding a created server thread updates the right-sidebar session in place
    useRightPanelStore.getState().updateAgentSession(hostRef, surfaceId, {
      title: "优化液态玻璃",
      environmentId: ENV_LOCAL,
      threadId: THREAD_B,
    });
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, hostRef),
    ).toMatchObject({
      id: surfaceId,
      kind: "agent-session",
      title: "优化液态玻璃",
      environmentId: ENV_LOCAL,
      threadId: THREAD_B,
    });

    useRightPanelStore.getState().removeThread(hostRef);
  });

  it("toggles the right wallpaper sidebar open, switches to wallpaper from another tab, and collapses when already on wallpaper", () => {
    const hostRef = { environmentId: ENV_LOCAL, threadId: THREAD_A };
    useRightPanelStore.getState().removeThread(hostRef);

    // 1. Closed -> opens right panel directly on wallpaper tab
    useRightPanelStore.getState().toggle(hostRef, "wallpaper");
    let state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, hostRef);
    expect(state.isOpen).toBe(true);
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, hostRef)?.kind).toBe(
      "wallpaper",
    );

    // 2. Switch to another tab (diff) -> clicking wallpaper toggle switches back to wallpaper without collapsing
    useRightPanelStore.getState().open(hostRef, "diff");
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, hostRef)?.kind).toBe(
      "diff",
    );
    useRightPanelStore.getState().toggle(hostRef, "wallpaper");
    state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, hostRef);
    expect(state.isOpen).toBe(true);
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, hostRef)?.kind).toBe(
      "wallpaper",
    );

    // 3. Already open and active on wallpaper -> clicking wallpaper toggle collapses right panel
    useRightPanelStore.getState().toggle(hostRef, "wallpaper");
    state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, hostRef);
    expect(state.isOpen).toBe(false);

    useRightPanelStore.getState().removeThread(hostRef);
  });

  it("preserves parent WorkspaceNewTabPopover during outside-press/focus-out targeting the body-portaled submenu without blocking Escape or real outside clicks", () => {
    const insideButton = { id: "submenu-new-codex-btn" } as unknown as Node;
    const outsideNode = { id: "outside-canvas" } as unknown as Node;
    const submenuEl = {
      contains(node: Node | null) {
        return node === insideButton;
      },
    };

    // Clicking a button inside the portaled submenu triggers outside-press & focus-out -> must preserve popover
    expect(
      shouldPreservePopoverOnSubmenuDismiss({
        nextOpen: false,
        reason: "outside-press",
        event: { target: insideButton },
        submenuEl,
      }),
    ).toBe(true);
    expect(
      shouldPreservePopoverOnSubmenuDismiss({
        nextOpen: false,
        reason: "outside-press",
        event: { target: outsideNode, composedPath: () => [insideButton, outsideNode] },
        submenuEl,
      }),
    ).toBe(true);
    expect(
      shouldPreservePopoverOnSubmenuDismiss({
        nextOpen: false,
        reason: "focus-out",
        event: { relatedTarget: insideButton },
        submenuEl,
      }),
    ).toBe(true);
    expect(
      shouldPreservePopoverOnSubmenuDismiss({
        nextOpen: false,
        reason: "focus-out",
        event: { target: outsideNode },
        submenuEl,
        activeElement: insideButton,
      }),
    ).toBe(true);

    // True outside click closes cleanly
    expect(
      shouldPreservePopoverOnSubmenuDismiss({
        nextOpen: false,
        reason: "outside-press",
        event: { target: outsideNode },
        submenuEl,
      }),
    ).toBe(false);

    // Escape key ALWAYS closes even when focus/target is inside the submenu
    expect(
      shouldPreservePopoverOnSubmenuDismiss({
        nextOpen: false,
        reason: "escape-key",
        event: { target: insideButton },
        submenuEl,
        activeElement: insideButton,
      }),
    ).toBe(false);
  });

  it("never renders the retired simplistic '开始与 新会话 聊天' blank stage and purges legacy primary agent tabs on rehydration", () => {
    const htmlWithGenericTitle = renderToStaticMarkup(
      <TooltipProvider>
        <WorkspacePaneContent
          paneId="pane-right"
          tab={{
            id: "tab-agent-legacy",
            kind: "agent",
            title: "新会话",
            providerId: null,
            createdAt: 1,
            lastActiveAt: 1,
          }}
          activeHostThreadRef={null}
          environmentId={null}
          instanceEntries={deriveProviderInstanceEntries([
            makeProvider({ instanceId: "codex", driver: "codex" }),
          ])}
          modelOptionsByInstance={new Map()}
          historyThreads={[]}
          onUpdateTab={vi.fn()}
          onOpenHistoryThreadInPane={vi.fn()}
          onLaunchAgentPrompt={vi.fn()}
          onOpenQuickTool={vi.fn()}
          onOpenConversationInMainChat={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(htmlWithGenericTitle).toContain('data-workspace-chat-handoff="true"');
    expect(htmlWithGenericTitle).toContain("Codex");
    expect(htmlWithGenericTitle).not.toContain('data-workspace-agent-stage="true"');
    expect(htmlWithGenericTitle).not.toContain("开始与");
    expect(htmlWithGenericTitle).not.toContain("新会话");
    expect(htmlWithGenericTitle).not.toContain("检查代码、解释输出或进行修改");
    expect(htmlWithGenericTitle).not.toContain("提问或描述要修改的任务");
    expect(htmlWithGenericTitle).not.toContain("PowerShell 终端");
    expect(htmlWithGenericTitle).not.toContain("查看差异");

    // Rehydration strips legacy unbacked primary-pane "agent" tabs while keeping valid threads/tools.
    const rehydrated = sanitizeRehydratedState({
      layout: { type: "leaf", paneId: DEFAULT_PRIMARY_PANE_ID },
      panes: {
        [DEFAULT_PRIMARY_PANE_ID]: {
          id: DEFAULT_PRIMARY_PANE_ID,
          tabIds: ["tab-stale-agent", "tab-live-thread"],
          activeTabId: "tab-stale-agent",
        },
      },
      tabs: {
        "tab-stale-agent": {
          id: "tab-stale-agent",
          kind: "agent",
          title: "新会话",
          providerId: null,
          createdAt: 1,
          lastActiveAt: 1,
        },
        "tab-live-thread": {
          id: "tab-live-thread",
          kind: "thread",
          title: "主会话",
          providerId: "codex",
          environmentId: ENV_LOCAL,
          threadId: THREAD_A,
          createdAt: 2,
          lastActiveAt: 2,
        },
      },
      focusedPaneId: DEFAULT_PRIMARY_PANE_ID,
      primaryPaneId: DEFAULT_PRIMARY_PANE_ID,
      terminalCounter: 0,
    });
    expect(rehydrated.tabs["tab-stale-agent"]).toBeUndefined();
    expect(rehydrated.panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual(["tab-live-thread"]);
    expect(rehydrated.panes[DEFAULT_PRIMARY_PANE_ID]?.activeTabId).toBe("tab-live-thread");

    // Verify WorkspaceSplitContainer routes primary-pane conversation tabs to full ChatView and never downgrades pruned drafts to kind: "agent".
    const workspaceDir = path.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    );
    const splitSource = fs.readFileSync(
      path.join(workspaceDir, "WorkspaceSplitContainer.tsx"),
      "utf8",
    );
    expect(splitSource).toContain('activeTab.kind === "agent"');
    expect(splitSource).not.toContain('kind: "agent",\n          draftId: null');
  });
});
