// @effect-diagnostics-next-line nodeBuiltinImport:off
import fs from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import path from "node:path";
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
  type ServerSettings,
} from "@prismux/core-contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import {
  deriveProviderInstanceEntries,
  providerInstanceEntriesFor,
} from "../../providerInstances";
import {
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../../rightPanelStore";
import { TooltipProvider } from "../ui/tooltip";
import { shouldPreservePopoverOnSubmenuDismiss } from "./WorkspaceNewTabPopover";
import {
  launchPrimaryAgentDraft,
  resolvePendingDraftBindingForSync,
  resolveProviderBrandIdForEntry,
  resolveWorkspaceRouteProviderMetadata,
  type PendingDraftTabBinding,
} from "./WorkspaceSplitContainer";
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
  findPrimaryUnusedDraftTab,
  getLiveComposerDraftStateLookup,
  isUnusedDraftTab,
  listLeafPaneIds,
  sanitizePersistedWorkspaceTabsState,
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
  installed?: boolean;
  status?: ServerProvider["status"];
  authStatus?: ServerProvider["auth"]["status"];
  models?: ServerProvider["models"];
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver),
    ...(input.displayName ? { displayName: input.displayName } : {}),
    enabled: input.enabled ?? true,
    installed: input.installed ?? true,
    version: "1.0.0",
    status: input.status ?? "ready",
    auth: { status: input.authStatus ?? "authenticated" },
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

  it("supports horizontal and vertical splits up to 8 panes, clamps split ratios, and tracks focus", () => {
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

      store.resetSplitRatio(state.layout.id);
      const resetRatio = useWorkspaceTabsStore.getState().layout;
      expect(resetRatio.type === "split" ? resetRatio.ratio : 0).toBe(0.5);
    }

    // Recursively split up to WORKSPACE_MAX_SPLIT_PANES (8) panes
    expect(WORKSPACE_MAX_SPLIT_PANES).toBe(8);
    let lastPaneId = rightPaneId!;
    for (let count = 3; count <= WORKSPACE_MAX_SPLIT_PANES; count += 1) {
      const nextPane = store.splitPane(lastPaneId, count % 2 === 0 ? "horizontal" : "vertical", {
        kind: "terminal",
        title: `Terminal ${count}`,
        shell: "PowerShell",
      });
      expect(nextPane).toBeTruthy();
      lastPaneId = nextPane!;
    }
    expect(countLeafPanes(useWorkspaceTabsStore.getState().layout)).toBe(WORKSPACE_MAX_SPLIT_PANES);

    // 9th split is safely refused at max cap
    const overflowPane = store.splitPane(lastPaneId, "horizontal");
    expect(overflowPane).toBeNull();
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
      makeProvider({ instanceId: "dsh", driver: "acpRegistry", displayName: "DeepSeek Harness (dsh)" }),
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
      "DeepSeek Harness (dsh)",
    ]);
    expect(agents[3]?.brandId).toBe("dsh");
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
  it("renders shellFrame glass zone, canonical brand tabs, + trigger, and pane ⋯ menu without standalone outer split buttons", () => {
    const newTabPopover = {
      openTabs: [],
      historyThreads: [],
      agents: [],
      onActivateOpenTab: vi.fn(),
      onOpenHistoryThread: vi.fn(),
      onLaunchAgent: vi.fn(),
      onRunQuickTool: vi.fn(),
      onOpenUrl: vi.fn(),
      onOpenAgentSettings: vi.fn(),
    };

    const splitPaneHtml = renderToStaticMarkup(
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
          newTabPopover={newTabPopover}
          onActivateTab={vi.fn()}
          onCloseTab={vi.fn()}
          onSplitPane={vi.fn()}
          onResetSplitRatio={vi.fn()}
          onClosePane={vi.fn()}
          onMoveTabToPane={vi.fn()}
          onReorderTab={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(splitPaneHtml).toContain('data-pmx-glass-zone="shellFrame"');
    expect(splitPaneHtml).not.toContain("border-b border-border/60");
    expect(splitPaneHtml).toContain('data-workspace-tab="tab-1"');
    expect(splitPaneHtml).toContain('data-agent-brand="codex"');
    expect(splitPaneHtml).toContain("Terminal 1");
    expect(splitPaneHtml).toContain('data-workspace-new-tab-trigger="pane-left"');
    expect(splitPaneHtml).toContain('data-workspace-pane-menu="pane-left"');
    expect(splitPaneHtml).toContain('data-workspace-close-pane="pane-left"');
    // Standalone outer 左右分屏 / 上下分屏 buttons must not clutter split pane tab bars
    expect(splitPaneHtml).not.toContain('data-workspace-split-horizontal=');
    expect(splitPaneHtml).not.toContain('data-workspace-split-vertical=');
    expect(splitPaneHtml).not.toContain('aria-label="左右分屏"');
    expect(splitPaneHtml).not.toContain('aria-label="上下分屏"');

    const singlePaneHtml = renderToStaticMarkup(
      <TooltipProvider>
        <WorkspaceTabBar
          pane={{
            id: "pane-main",
            tabIds: ["tab-1"],
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
          ]}
          isFocused
          paneCount={1}
          otherPaneIds={[]}
          touchesTopEdge
          touchesLeftEdge
          touchesRightEdge
          newTabPopover={newTabPopover}
          onActivateTab={vi.fn()}
          onCloseTab={vi.fn()}
          onSplitPane={vi.fn()}
          onClosePane={vi.fn()}
          onMoveTabToPane={vi.fn()}
          onReorderTab={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(singlePaneHtml).toContain('data-workspace-pane-menu="pane-main"');
    expect(singlePaneHtml).not.toContain('data-workspace-split-horizontal=');
    expect(singlePaneHtml).not.toContain('data-workspace-split-vertical=');
    expect(singlePaneHtml).not.toContain('data-workspace-close-pane=');
    expect(singlePaneHtml).not.toContain('aria-label="左右分屏"');
    expect(singlePaneHtml).not.toContain('aria-label="上下分屏"');

    // Verify split actions live exclusively inside the ⋯ MenuPopup and Reset Split Ratio is wired.
    const workspaceDir = path.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    );
    const tabBarSource = fs.readFileSync(path.join(workspaceDir, "WorkspaceTabBar.tsx"), "utf8");
    expect(tabBarSource).not.toContain("data-workspace-split-horizontal");
    expect(tabBarSource).not.toContain("data-workspace-split-vertical");
    const menuPopupStart = tabBarSource.indexOf("<MenuPopup");
    expect(menuPopupStart).toBeGreaterThan(-1);
    const menuPopupSlice = tabBarSource.slice(menuPopupStart);
    expect(menuPopupSlice).toContain("data-workspace-menu-split-horizontal");
    expect(menuPopupSlice).toContain("data-workspace-menu-split-vertical");
    expect(menuPopupSlice).toContain("data-workspace-menu-reset-split-ratio");
    expect(menuPopupSlice).toContain("data-workspace-menu-close-pane");
    expect(menuPopupSlice).toContain("左右分屏");
    expect(menuPopupSlice).toContain("上下分屏");
    expect(menuPopupSlice).toContain("重置分屏比例");
    expect(menuPopupSlice).toContain("关闭当前分屏");

    const splitContainerSource = fs.readFileSync(
      path.join(workspaceDir, "WorkspaceSplitContainer.tsx"),
      "utf8",
    );
    expect(splitContainerSource).toContain("onResetSplitRatio={");
    expect(splitContainerSource).toContain("resetSplitRatio(parentSplitId)");
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
    expect(splitSource).not.toContain("forceNew: true");
  });
});

describe("single unused draft tab invariant", () => {
  const PROJECT_REF = {
    environmentId: ENV_LOCAL,
    projectId: ProjectId.make("proj-single-draft"),
  };
  const LOGICAL_PROJECT_KEY = "logical:proj-single-draft";
  const DRAFT_A = "draft-single-a" as DraftId;
  const DRAFT_B = "draft-single-b" as DraftId;
  const DRAFT_C = "draft-single-c" as DraftId;
  const DRAFT_EXPIRED = "draft-single-expired" as DraftId;

  const providers = deriveProviderInstanceEntries([
    makeProvider({ instanceId: "codex", driver: "codex" }),
    makeProvider({ instanceId: "claudeAgent", driver: "claudeAgent" }),
    makeProvider({ instanceId: "antigravity", driver: "antigravity" }),
  ]);
  const agentOptions = buildQuickLaunchAgentOptions({
    instanceEntries: providers,
    historyThreads: [],
  });
  const codexAgent = agentOptions.find((agent) => agent.brandId === "codex")!;
  const claudeAgent = agentOptions.find((agent) => agent.brandId === "claude-code")!;
  const antigravityAgent = agentOptions.find((agent) => agent.brandId === "antigravity")!;

  beforeEach(() => {
    useWorkspaceTabsStore.getState().resetWorkspace();
    const draftStore = useComposerDraftStore.getState();
    for (const draftId of [DRAFT_A, DRAFT_B, DRAFT_C, DRAFT_EXPIRED]) {
      draftStore.clearDraftThread(draftId);
    }
  });

  it("classifies unused blank draft/agent tabs cleanly via isUnusedDraftTab", () => {
    const draftStore = useComposerDraftStore.getState();
    draftStore.setLogicalProjectDraftThreadId(LOGICAL_PROJECT_KEY, PROJECT_REF, DRAFT_A, {
      threadId: THREAD_A,
    });
    const liveLookup = getLiveComposerDraftStateLookup();

    expect(
      isUnusedDraftTab(
        {
          id: "tab-agent",
          kind: "agent",
          title: "Codex",
          providerId: "codex",
          createdAt: 1,
          lastActiveAt: 1,
        },
        liveLookup,
      ),
    ).toBe(true);

    const draftTab = {
      id: "tab-draft",
      kind: "draft" as const,
      title: "Codex",
      providerId: "codex",
      draftId: DRAFT_A,
      createdAt: 1,
      lastActiveAt: 1,
    };
    expect(isUnusedDraftTab(draftTab, liveLookup)).toBe(true);

    // Populating user prompt content disqualifies it as an unused blank draft.
    draftStore.setPrompt(DRAFT_A, "帮我排查登录 bug");
    expect(isUnusedDraftTab(draftTab, getLiveComposerDraftStateLookup())).toBe(false);

    // Clearing prompt returns it to unused state, while promotedTo disqualifies it.
    draftStore.setPrompt(DRAFT_A, "   ");
    expect(isUnusedDraftTab(draftTab, getLiveComposerDraftStateLookup())).toBe(true);
    expect(
      isUnusedDraftTab(draftTab, {
        getDraftSession: () => ({
          promotedTo: { environmentId: ENV_LOCAL, threadId: THREAD_A },
        }),
        getComposerDraft: () => null,
      }),
    ).toBe(false);

    // Server thread and tool tabs are never unused draft tabs.
    expect(
      isUnusedDraftTab(
        {
          id: "tab-thread",
          kind: "thread",
          title: "正式会话",
          environmentId: ENV_LOCAL,
          threadId: THREAD_A,
          createdAt: 1,
          lastActiveAt: 1,
        },
        liveLookup,
      ),
    ).toBe(false);
    expect(
      isUnusedDraftTab(
        {
          id: "tab-terminal",
          kind: "terminal",
          title: "Terminal 1",
          createdAt: 1,
          lastActiveAt: 1,
        },
        liveLookup,
      ),
    ).toBe(false);
  });

  it("keeps strictly 1 unused draft tab across repeated + launches and switches Agent/Model in place", async () => {
    const navigatedTo: string[] = [];
    let nextDraftCounter = 0;
    const draftIds = [DRAFT_A, DRAFT_B, DRAFT_C];
    const threadIds = [THREAD_A, THREAD_B, THREAD_C];
    const handleNewThread = vi.fn(
      async (
        projectRef: typeof PROJECT_REF,
        options?: { readonly forceNew?: boolean; readonly modelSelection?: { instanceId: ProviderInstanceId; model: string } | null },
      ) => {
        expect(options?.forceNew).toBe(false);
        const idx = nextDraftCounter++;
        const draftId = draftIds[idx]!;
        const threadId = threadIds[idx]!;
        const draftStore = useComposerDraftStore.getState();
        draftStore.setLogicalProjectDraftThreadId(LOGICAL_PROJECT_KEY, projectRef, draftId, {
          threadId,
        });
        if (options?.modelSelection) {
          draftStore.setModelSelection(draftId, options.modelSelection, {
            explicit: true,
            replaceOptions: true,
          });
        }
        return { draftId, threadId };
      },
    );

    const runLaunch = (agent: typeof codexAgent) =>
      launchPrimaryAgentDraft({
        agent,
        resolvedPaneId: DEFAULT_PRIMARY_PANE_ID,
        instanceEntries: providers,
        resolveProjectRef: async () => ({ projectRef: PROJECT_REF, fromScratch: false }),
        handleNewThread,
        onNavigateToDraft: (draftId) => navigatedTo.push(`/draft/${draftId}`),
        onNavigateHome: () => navigatedTo.push("/"),
      });

    // 1. First launch (+ -> Codex) creates 1 unused draft tab.
    const firstTabId = await runLaunch(codexAgent);
    expect(firstTabId).toBeTruthy();
    expect(handleNewThread).toHaveBeenCalledTimes(1);
    let state = useWorkspaceTabsStore.getState();
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([firstTabId]);
    expect(state.tabs[firstTabId!]).toMatchObject({
      kind: "draft",
      draftId: DRAFT_A,
      providerId: "codex",
      instanceId: "codex",
      model: "codex-default",
      title: "Codex",
    });

    // 2. Repeatedly clicking + -> Codex MUST NOT create a second tab or call handleNewThread.
    const secondTabId = await runLaunch(codexAgent);
    const thirdTabId = await runLaunch(codexAgent);
    expect(secondTabId).toBe(firstTabId);
    expect(thirdTabId).toBe(firstTabId);
    expect(handleNewThread).toHaveBeenCalledTimes(1);
    expect(useWorkspaceTabsStore.getState().panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([
      firstTabId,
    ]);

    // 3. Switching + -> Claude Code -> Antigravity mutates the SAME tab & draft modelSelection in place.
    const claudeTabId = await runLaunch(claudeAgent);
    expect(claudeTabId).toBe(firstTabId);
    expect(handleNewThread).toHaveBeenCalledTimes(1);
    state = useWorkspaceTabsStore.getState();
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([firstTabId]);
    expect(state.tabs[firstTabId!]).toMatchObject({
      kind: "draft",
      draftId: DRAFT_A,
      providerId: "claude-code",
      instanceId: "claudeAgent",
      model: "claudeAgent-default",
      title: "Claude Code",
    });
    expect(useComposerDraftStore.getState().getComposerDraft(DRAFT_A)?.activeProvider).toBe(
      "claudeAgent",
    );

    const agyTabId = await runLaunch(antigravityAgent);
    expect(agyTabId).toBe(firstTabId);
    expect(handleNewThread).toHaveBeenCalledTimes(1);
    state = useWorkspaceTabsStore.getState();
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([firstTabId]);
    expect(state.tabs[firstTabId!]).toMatchObject({
      kind: "draft",
      draftId: DRAFT_A,
      providerId: "antigravity",
      instanceId: "antigravity",
      model: "antigravity-default",
      title: "Antigravity",
    });
    expect(useComposerDraftStore.getState().getComposerDraft(DRAFT_A)?.activeProvider).toBe(
      "antigravity",
    );
    expect(navigatedTo).toEqual([
      `/draft/${DRAFT_A}`,
      `/draft/${DRAFT_A}`,
      `/draft/${DRAFT_A}`,
      `/draft/${DRAFT_A}`,
    ]);

    // 4. Once user types content in DRAFT_A, launching another Agent creates 1 new unused draft tab,
    //    and subsequent launches reuse that new unused tab without touching the populated draft.
    useComposerDraftStore.getState().setPrompt(DRAFT_A, "保留这段已输入内容");
    const secondUnusedTabId = await runLaunch(codexAgent);
    expect(secondUnusedTabId).not.toBe(firstTabId);
    expect(handleNewThread).toHaveBeenCalledTimes(2);
    expect(useWorkspaceTabsStore.getState().panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([
      firstTabId,
      secondUnusedTabId,
    ]);

    const switchedSecondId = await runLaunch(claudeAgent);
    expect(switchedSecondId).toBe(secondUnusedTabId);
    expect(handleNewThread).toHaveBeenCalledTimes(2);
    expect(useWorkspaceTabsStore.getState().panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([
      firstTabId,
      secondUnusedTabId,
    ]);
    expect(useWorkspaceTabsStore.getState().tabs[secondUnusedTabId!]?.title).toBe("Claude Code");
  });

  it("never creates new tabs when switching between existing server threads and an unused draft tab", () => {
    const store = useWorkspaceTabsStore.getState();
    useComposerDraftStore
      .getState()
      .setLogicalProjectDraftThreadId(LOGICAL_PROJECT_KEY, PROJECT_REF, DRAFT_A, {
        threadId: THREAD_B,
      });

    const threadTabId = store.openTab({
      kind: "thread",
      title: "已有正式会话",
      providerId: "codex",
      environmentId: ENV_LOCAL,
      threadId: THREAD_A,
    });
    const draftTabId = store.openTab({
      kind: "draft",
      title: "Codex",
      providerId: "codex",
      instanceId: ProviderInstanceId.make("codex"),
      model: "codex-default",
      environmentId: ENV_LOCAL,
      threadId: THREAD_B,
      draftId: DRAFT_A,
    });

    // Switch back to server thread tab and sync its route target.
    store.activateTab(DEFAULT_PRIMARY_PANE_ID, threadTabId);
    const syncedThread = store.syncRouteTarget({
      target: { kind: "server", threadRef: { environmentId: ENV_LOCAL, threadId: THREAD_A } },
      title: "已有正式会话",
      providerId: "codex",
    });
    expect(syncedThread).toBe(threadTabId);
    let state = useWorkspaceTabsStore.getState();
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([threadTabId, draftTabId]);
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.activeTabId).toBe(threadTabId);

    // Switch back to the live blank draft tab and sync its route target -> count stays 2.
    store.activateTab(DEFAULT_PRIMARY_PANE_ID, draftTabId);
    const syncedDraft = store.syncRouteTarget({
      target: { kind: "draft", draftId: DRAFT_A },
      title: "Codex",
      providerId: "codex",
    });
    expect(syncedDraft).toBe(draftTabId);
    state = useWorkspaceTabsStore.getState();
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([threadTabId, draftTabId]);
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.activeTabId).toBe(draftTabId);
  });

  it("allows opening 1 new blank draft tab after the previous draft is promoted to a server thread", () => {
    const store = useWorkspaceTabsStore.getState();
    const firstTabId = store.syncRouteTarget({
      target: { kind: "draft", draftId: DRAFT_A },
      title: "Codex",
      providerId: "codex",
      instanceId: ProviderInstanceId.make("codex"),
      model: "codex-default",
      environmentId: ENV_LOCAL,
      threadId: THREAD_A,
    })!;

    // Before promotion, syncing another blank draft reuses firstTabId in place.
    const reusedBeforePromote = store.syncRouteTarget({
      target: { kind: "draft", draftId: DRAFT_B },
      title: "Claude Code",
      providerId: "claudeAgent",
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claudeAgent-default",
      environmentId: ENV_LOCAL,
      threadId: THREAD_B,
    });
    expect(reusedBeforePromote).toBe(firstTabId);
    expect(useWorkspaceTabsStore.getState().panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([
      firstTabId,
    ]);

    // Promote DRAFT_B to a real server thread -> tab becomes kind: "thread".
    store.promoteDraftTab(
      DRAFT_B,
      { environmentId: ENV_LOCAL, threadId: THREAD_B },
      { title: "已完成首条提问" },
    );
    expect(useWorkspaceTabsStore.getState().tabs[firstTabId]?.kind).toBe("thread");

    // Now opening a new blank draft creates a brand-new 2nd tab cleanly.
    const nextDraftTabId = store.openTab({
      kind: "draft",
      title: "Antigravity",
      providerId: "antigravity",
      instanceId: ProviderInstanceId.make("antigravity"),
      model: "antigravity-default",
      environmentId: ENV_LOCAL,
      threadId: THREAD_C,
      draftId: DRAFT_C,
    });
    expect(nextDraftTabId).not.toBe(firstTabId);
    expect(useWorkspaceTabsStore.getState().panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([
      firstTabId,
      nextDraftTabId,
    ]);
  });

  it("deduplicates legacy multiple draft/agent tabs down to at most 1 in sanitizePersistedWorkspaceTabsState", () => {
    const sanitized = sanitizePersistedWorkspaceTabsState({
      layout: { type: "leaf", paneId: DEFAULT_PRIMARY_PANE_ID },
      panes: {
        [DEFAULT_PRIMARY_PANE_ID]: {
          id: DEFAULT_PRIMARY_PANE_ID,
          tabIds: [
            "tab-thread-1",
            "tab-draft-1",
            "tab-draft-2",
            "tab-draft-3",
            "tab-agent-unbacked",
            "tab-agent-legacy-backed",
          ],
          activeTabId: "tab-draft-2",
        },
      },
      tabs: {
        "tab-thread-1": {
          id: "tab-thread-1",
          kind: "thread",
          title: "历史对话",
          providerId: "codex",
          environmentId: ENV_LOCAL,
          threadId: THREAD_A,
          createdAt: 1,
          lastActiveAt: 10,
        },
        "tab-draft-1": {
          id: "tab-draft-1",
          kind: "draft",
          title: "Codex",
          providerId: "codex",
          draftId: DRAFT_A,
          createdAt: 2,
          lastActiveAt: 20,
        },
        "tab-draft-2": {
          id: "tab-draft-2",
          kind: "draft",
          title: "Codex",
          providerId: "codex",
          draftId: DRAFT_B,
          createdAt: 3,
          lastActiveAt: 30,
        },
        "tab-draft-3": {
          id: "tab-draft-3",
          kind: "draft",
          title: "Codex",
          providerId: "codex",
          draftId: DRAFT_C,
          createdAt: 4,
          lastActiveAt: 40,
        },
        "tab-agent-unbacked": {
          id: "tab-agent-unbacked",
          kind: "agent",
          title: "Codex",
          providerId: "codex",
          createdAt: 5,
          lastActiveAt: 50,
        },
        "tab-agent-legacy-backed": {
          id: "tab-agent-legacy-backed",
          kind: "agent",
          title: "Claude Code",
          providerId: "claudeAgent",
          draftId: DRAFT_EXPIRED,
          createdAt: 6,
          lastActiveAt: 60,
        },
      },
      focusedPaneId: DEFAULT_PRIMARY_PANE_ID,
      primaryPaneId: DEFAULT_PRIMARY_PANE_ID,
      terminalCounter: 0,
    });

    // Preserves the active draft tab and the real thread tab, stripping all other duplicate unused drafts/agents.
    expect(sanitized.panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([
      "tab-thread-1",
      "tab-draft-2",
    ]);
    expect(sanitized.panes[DEFAULT_PRIMARY_PANE_ID]?.activeTabId).toBe("tab-draft-2");
    expect(sanitized.tabs["tab-draft-1"]).toBeUndefined();
    expect(sanitized.tabs["tab-draft-3"]).toBeUndefined();
    expect(sanitized.tabs["tab-agent-unbacked"]).toBeUndefined();
    expect(sanitized.tabs["tab-agent-legacy-backed"]).toBeUndefined();

    // Preserves a draft with user-authored content alongside at most 1 unused draft tab.
    useComposerDraftStore.getState().setPrompt(DRAFT_A, "尚未发送的重要草稿");
    const withUserDraft = sanitizePersistedWorkspaceTabsState(
      {
        layout: { type: "leaf", paneId: DEFAULT_PRIMARY_PANE_ID },
        panes: {
          [DEFAULT_PRIMARY_PANE_ID]: {
            id: DEFAULT_PRIMARY_PANE_ID,
            tabIds: ["tab-draft-user", "tab-draft-empty-1", "tab-draft-empty-2"],
            activeTabId: "tab-draft-user",
          },
        },
        tabs: {
          "tab-draft-user": {
            id: "tab-draft-user",
            kind: "draft",
            title: "Codex",
            providerId: "codex",
            draftId: DRAFT_A,
            createdAt: 1,
            lastActiveAt: 10,
          },
          "tab-draft-empty-1": {
            id: "tab-draft-empty-1",
            kind: "draft",
            title: "Codex",
            providerId: "codex",
            draftId: DRAFT_B,
            createdAt: 2,
            lastActiveAt: 20,
          },
          "tab-draft-empty-2": {
            id: "tab-draft-empty-2",
            kind: "draft",
            title: "Claude Code",
            providerId: "claudeAgent",
            draftId: DRAFT_C,
            createdAt: 3,
            lastActiveAt: 30,
          },
        },
        focusedPaneId: DEFAULT_PRIMARY_PANE_ID,
        primaryPaneId: DEFAULT_PRIMARY_PANE_ID,
        terminalCounter: 0,
      },
      getLiveComposerDraftStateLookup(),
    );

    expect(withUserDraft.panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([
      "tab-draft-user",
      "tab-draft-empty-2",
    ]);
    expect(withUserDraft.tabs["tab-draft-empty-1"]).toBeUndefined();

    // Runtime store action pruneDuplicateDraftTabs collapses redundant empty drafts once emptied.
    const store = useWorkspaceTabsStore.getState();
    const t1 = store.openTab({ kind: "draft", title: "Codex", providerId: "codex", draftId: DRAFT_A });
    const t2 = store.openTab({ kind: "draft", title: "Claude Code", providerId: "claudeAgent", draftId: DRAFT_B });
    expect(useWorkspaceTabsStore.getState().panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([t1, t2]);
    useComposerDraftStore.getState().setPrompt(DRAFT_A, "");
    store.pruneDuplicateDraftTabs();
    expect(useWorkspaceTabsStore.getState().panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([t2]);
    expect(useWorkspaceTabsStore.getState().tabs[t1]).toBeUndefined();
  });

  it("reuses target tab in-place without duplication when syncRouteTarget races ahead of materialize/openTab", async () => {
    const store = useWorkspaceTabsStore.getState();
    const threadTabId = store.openTab({
      kind: "thread",
      title: "正式会话",
      providerId: "codex",
      environmentId: ENV_LOCAL,
      threadId: THREAD_A,
    });
    // Simulate an expired draft tab restored across reload (no session in composerDraftStore).
    const expiredTabId = store.openTab({
      kind: "draft",
      title: "Codex",
      providerId: "codex",
      instanceId: ProviderInstanceId.make("codex"),
      draftId: DRAFT_EXPIRED,
    });
    expect(
      findPrimaryUnusedDraftTab(
        useWorkspaceTabsStore.getState(),
        getLiveComposerDraftStateLookup(),
      )?.id,
    ).toBe(expiredTabId);

    let pendingBinding: PendingDraftTabBinding | null = null;
    const handleNewThreadWithSyncRace = vi.fn(async (projectRef: typeof PROJECT_REF) => {
      useComposerDraftStore
        .getState()
        .setLogicalProjectDraftThreadId(LOGICAL_PROJECT_KEY, projectRef, DRAFT_B, {
          threadId: THREAD_B,
        });
      // Simulate React effect firing syncRouteTarget during router.navigate BEFORE handleNewThread resolves!
      const syncedId = useWorkspaceTabsStore.getState().syncRouteTarget({
        target: { kind: "draft", draftId: DRAFT_B },
        title: pendingBinding?.title ?? "Claude Code",
        providerId: pendingBinding?.providerId ?? "claudeAgent",
        instanceId: pendingBinding?.instanceId ?? ProviderInstanceId.make("claudeAgent"),
        model: pendingBinding?.model ?? "claudeAgent-default",
        environmentId: projectRef.environmentId,
        threadId: THREAD_B,
        activate: true,
        reuseUnusedDraftTabId: pendingBinding?.tabId ?? null,
      });
      expect(syncedId).toBe(expiredTabId);
      return { draftId: DRAFT_B, threadId: THREAD_B };
    });

    const resultTabId = await launchPrimaryAgentDraft({
      agent: claudeAgent,
      resolvedPaneId: DEFAULT_PRIMARY_PANE_ID,
      instanceEntries: providers,
      resolveProjectRef: async () => ({ projectRef: PROJECT_REF, fromScratch: false }),
      handleNewThread: handleNewThreadWithSyncRace,
      onNavigateToDraft: vi.fn(),
      onNavigateHome: vi.fn(),
      setPendingBinding: (binding) => {
        pendingBinding = binding;
      },
      getPendingBinding: () => pendingBinding,
    });

    expect(resultTabId).toBe(expiredTabId);
    expect(pendingBinding).toBeNull();
    const finalState = useWorkspaceTabsStore.getState();
    expect(finalState.panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([threadTabId, expiredTabId]);
    expect(finalState.panes[DEFAULT_PRIMARY_PANE_ID]?.activeTabId).toBe(expiredTabId);
    expect(finalState.tabs[expiredTabId]).toMatchObject({
      kind: "draft",
      draftId: DRAFT_B,
      threadId: THREAD_B,
      providerId: "claude-code",
      instanceId: "claudeAgent",
      model: "claudeAgent-default",
      title: "Claude Code",
    });
  });

  it("syncs scratch/no-project draft tab icon and display title from real selected/default provider instead of stale-defaulting to Codex", () => {
    const SCRATCH_PROJECT_ID = ProjectId.make("proj-scratch");
    const SCRATCH_DRAFT_ID = "draft-scratch-agy" as DraftId;
    const CODEX_ID = ProviderInstanceId.make("codex");
    const CLAUDE_ID = ProviderInstanceId.make("claudeAgent");
    const AGY_ID = ProviderInstanceId.make("antigravity");

    const serverProviders: ReadonlyArray<ServerProvider> = [
      makeProvider({ instanceId: "codex", driver: "codex" }),
      makeProvider({ instanceId: "claudeAgent", driver: "claudeAgent" }),
      makeProvider({
        instanceId: "antigravity",
        driver: "antigravity",
        displayName: "区区",
        models: [
          {
            slug: "4-neon",
            name: "4 Neon",
            isDefault: true,
            isCustom: false,
            capabilities: {},
          },
        ],
      }),
    ];

    const settingsWithAgyDefault: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      defaultModelSelection: { instanceId: AGY_ID, model: "4-neon" },
      providerInstances: {
        ...DEFAULT_SERVER_SETTINGS.providerInstances,
        [AGY_ID]: {
          driver: ProviderDriverKind.make("antigravity"),
          displayName: "区区",
          enabled: true,
        },
      },
    };
    const entries = providerInstanceEntriesFor(
      serverProviders,
      settingsWithAgyDefault,
      SCRATCH_PROJECT_ID,
    );

    // 1. Fresh scratch (`无项目 ~`) draft with empty composerDraft must resolve Antigravity (defaultModelSelection), NEVER Codex!
    const scratchDefaultMeta = resolveWorkspaceRouteProviderMetadata({
      shownTarget: { kind: "draft", draftId: SCRATCH_DRAFT_ID },
      routeKey: `draft:${SCRATCH_DRAFT_ID}`,
      routeThreadShell: null,
      routeComposerDraft: null,
      stickyActiveProvider: null,
      stickyModelSelectionByProvider: {},
      providers: serverProviders,
      settings: settingsWithAgyDefault,
      instanceEntries: entries,
      activeProject: null,
      activeProjectId: SCRATCH_PROJECT_ID,
      now: Date.parse("2026-11-25T08:00:00Z"),
    });
    expect(scratchDefaultMeta).toMatchObject({
      instanceId: AGY_ID,
      providerId: "antigravity",
      model: "4-neon",
      title: "区区",
    });

    // Reusing a stale Codex unused draft tab for this scratch draft must immediately overwrite both logo (providerId) and title.
    const store = useWorkspaceTabsStore.getState();
    const staleCodexTabId = store.openTab({
      kind: "draft",
      title: "Codex",
      providerId: "codex",
      instanceId: CODEX_ID,
      draftId: DRAFT_A,
    });
    const syncedTabId = store.syncRouteTarget({
      target: { kind: "draft", draftId: SCRATCH_DRAFT_ID },
      title: scratchDefaultMeta.title,
      providerId: scratchDefaultMeta.providerId,
      instanceId: scratchDefaultMeta.instanceId,
      model: scratchDefaultMeta.model,
      reuseUnusedDraftTabId: staleCodexTabId,
    });
    expect(syncedTabId).toBe(staleCodexTabId);
    const tabAfterScratch = useWorkspaceTabsStore.getState().tabs[staleCodexTabId]!;
    expect(tabAfterScratch).toMatchObject({
      kind: "draft",
      draftId: SCRATCH_DRAFT_ID,
      providerId: "antigravity",
      instanceId: AGY_ID,
      model: "4-neon",
      title: "区区",
    });

    const tabBarHtml = renderToStaticMarkup(
      <TooltipProvider>
        <WorkspaceTabBar
          pane={{
            id: DEFAULT_PRIMARY_PANE_ID,
            tabIds: [staleCodexTabId],
            activeTabId: staleCodexTabId,
          }}
          tabs={[tabAfterScratch]}
          isFocused
          paneCount={1}
          otherPaneIds={[]}
          touchesTopEdge
          touchesLeftEdge
          touchesRightEdge
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
    expect(tabBarHtml).toContain('data-agent-brand="antigravity"');
    expect(tabBarHtml).toContain("区区");
    expect(tabBarHtml).not.toContain('data-agent-brand="codex"');
    expect(tabBarHtml).not.toContain(">Codex<");

    // 2. Switching provider in composer on the untitled scratch draft immediately updates tab icon & label.
    const switchedToClaudeMeta = resolveWorkspaceRouteProviderMetadata({
      shownTarget: { kind: "draft", draftId: SCRATCH_DRAFT_ID },
      routeKey: `draft:${SCRATCH_DRAFT_ID}`,
      routeThreadShell: null,
      routeComposerDraft: {
        activeProvider: CLAUDE_ID,
        modelSelectionByProvider: {
          [CLAUDE_ID]: { instanceId: CLAUDE_ID, model: "claude-sonnet-4-6" },
        },
        modelSelectionExplicit: true,
      },
      stickyActiveProvider: AGY_ID,
      stickyModelSelectionByProvider: {
        [AGY_ID]: { instanceId: AGY_ID, model: "4-neon" },
      },
      providers: serverProviders,
      settings: settingsWithAgyDefault,
      instanceEntries: entries,
      activeProject: null,
      activeProjectId: SCRATCH_PROJECT_ID,
      now: Date.parse("2026-11-25T08:00:00Z"),
    });
    expect(switchedToClaudeMeta).toMatchObject({
      instanceId: CLAUDE_ID,
      providerId: "claudeAgent",
      model: "claude-sonnet-4-6",
      title: "Claude Code",
    });

    store.syncRouteTarget({
      target: { kind: "draft", draftId: SCRATCH_DRAFT_ID },
      title: switchedToClaudeMeta.title,
      providerId: switchedToClaudeMeta.providerId,
      instanceId: switchedToClaudeMeta.instanceId,
      model: switchedToClaudeMeta.model,
      activate: false,
    });
    expect(useWorkspaceTabsStore.getState().tabs[staleCodexTabId]).toMatchObject({
      providerId: "claudeAgent",
      instanceId: CLAUDE_ID,
      model: "claude-sonnet-4-6",
      title: "Claude Code",
    });

    // 3. When defaultModelSelection is unset and Codex is unhealthy/unavailable while Antigravity is ready,
    //    scratch draft resolves healthy Antigravity rather than blindly falling back to entries[0] (Codex).
    const settingsWithAgyEnabledNoDefault: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      defaultModelSelection: null,
      providerInstances: {
        ...DEFAULT_SERVER_SETTINGS.providerInstances,
        [AGY_ID]: {
          driver: ProviderDriverKind.make("antigravity"),
          enabled: true,
        },
      },
    };
    const unhealthyCodexProviders: ReadonlyArray<ServerProvider> = [
      makeProvider({
        instanceId: "codex",
        driver: "codex",
        installed: false,
        status: "error",
        authStatus: "unauthenticated",
      }),
      makeProvider({ instanceId: "antigravity", driver: "antigravity" }),
    ];
    const unhealthyCodexEntries = providerInstanceEntriesFor(
      unhealthyCodexProviders,
      settingsWithAgyEnabledNoDefault,
      SCRATCH_PROJECT_ID,
    );
    const healthyFallbackMeta = resolveWorkspaceRouteProviderMetadata({
      shownTarget: { kind: "draft", draftId: SCRATCH_DRAFT_ID },
      routeKey: `draft:${SCRATCH_DRAFT_ID}`,
      routeThreadShell: null,
      routeComposerDraft: null,
      stickyActiveProvider: null,
      stickyModelSelectionByProvider: {},
      providers: unhealthyCodexProviders,
      settings: settingsWithAgyEnabledNoDefault,
      instanceEntries: unhealthyCodexEntries,
      activeProject: null,
      activeProjectId: SCRATCH_PROJECT_ID,
      now: Date.parse("2026-11-25T08:00:00Z"),
    });
    expect(healthyFallbackMeta).toMatchObject({
      instanceId: AGY_ID,
      providerId: "antigravity",
      title: "Antigravity",
    });

    // 4. Sticky provider & matching live ChatView snapshot apply immediately, while stale-route snapshots are ignored
    //    and real server thread titles are never overwritten.
    const stickyMeta = resolveWorkspaceRouteProviderMetadata({
      shownTarget: { kind: "draft", draftId: SCRATCH_DRAFT_ID },
      routeKey: `draft:${SCRATCH_DRAFT_ID}`,
      routeThreadShell: null,
      routeComposerDraft: null,
      stickyActiveProvider: AGY_ID,
      stickyModelSelectionByProvider: {
        [AGY_ID]: { instanceId: AGY_ID, model: "4-neon" },
      },
      providers: serverProviders,
      settings: settingsWithAgyEnabledNoDefault,
      instanceEntries: providerInstanceEntriesFor(
        serverProviders,
        settingsWithAgyEnabledNoDefault,
        SCRATCH_PROJECT_ID,
      ),
      activeProject: null,
      activeProjectId: SCRATCH_PROJECT_ID,
      activeChatProvider: {
        routeKey: "draft:some-other-draft",
        instanceId: CODEX_ID,
        providerId: "codex",
        model: "codex-default",
        displayName: "Codex",
      },
      now: Date.parse("2026-11-25T08:00:00Z"),
    });
    expect(stickyMeta).toMatchObject({
      instanceId: AGY_ID,
      providerId: "antigravity",
      model: "4-neon",
      title: "Antigravity",
    });

    const serverMeta = resolveWorkspaceRouteProviderMetadata({
      shownTarget: { kind: "server", threadRef: { environmentId: ENV_LOCAL, threadId: THREAD_A } },
      routeKey: `server:${ENV_LOCAL}:${THREAD_A}`,
      routeThreadShell: {
        title: "排查顶栏标签同步",
        modelSelection: { instanceId: AGY_ID, model: "4-neon" },
      },
      routeComposerDraft: null,
      stickyActiveProvider: CODEX_ID,
      stickyModelSelectionByProvider: {},
      providers: serverProviders,
      settings: settingsWithAgyDefault,
      instanceEntries: entries,
      activeProject: null,
      activeProjectId: SCRATCH_PROJECT_ID,
      activeChatProvider: {
        routeKey: `server:${ENV_LOCAL}:${THREAD_A}`,
        instanceId: AGY_ID,
        providerId: "antigravity",
        model: "4-neon",
        displayName: "区区",
      },
      now: Date.parse("2026-11-25T08:00:00Z"),
    });
    expect(serverMeta).toMatchObject({
      instanceId: AGY_ID,
      providerId: "antigravity",
      model: "4-neon",
      title: "排查顶栏标签同步",
    });

    // 5. Non-explicit stale Codex on a scratch draft yields to matching live ChatView Antigravity snapshot,
    //    while an explicit composer switch (modelSelectionExplicit: true) immediately overrides even before ChatView commits.
    const liveScratchOverride = resolveWorkspaceRouteProviderMetadata({
      shownTarget: { kind: "draft", draftId: SCRATCH_DRAFT_ID },
      routeKey: `draft:${SCRATCH_DRAFT_ID}`,
      routeThreadShell: null,
      routeComposerDraft: {
        activeProvider: CODEX_ID,
        modelSelectionByProvider: {
          [CODEX_ID]: { instanceId: CODEX_ID, model: "codex-default" },
        },
        modelSelectionExplicit: false,
      },
      stickyActiveProvider: CODEX_ID,
      stickyModelSelectionByProvider: {},
      providers: serverProviders,
      settings: settingsWithAgyDefault,
      instanceEntries: entries,
      activeProject: null,
      activeProjectId: SCRATCH_PROJECT_ID,
      activeChatProvider: {
        routeKey: `draft:${SCRATCH_DRAFT_ID}`,
        instanceId: AGY_ID,
        providerId: "antigravity",
        model: "4-neon",
        displayName: "区区",
      },
      now: Date.parse("2026-11-25T08:00:00Z"),
    });
    expect(liveScratchOverride).toMatchObject({
      instanceId: AGY_ID,
      providerId: "antigravity",
      model: "4-neon",
      title: "区区",
    });

    const explicitSwitchBeforeSnapshot = resolveWorkspaceRouteProviderMetadata({
      shownTarget: { kind: "draft", draftId: SCRATCH_DRAFT_ID },
      routeKey: `draft:${SCRATCH_DRAFT_ID}`,
      routeThreadShell: null,
      routeComposerDraft: {
        activeProvider: CLAUDE_ID,
        modelSelectionByProvider: {
          [CLAUDE_ID]: { instanceId: CLAUDE_ID, model: "claude-sonnet-4-6" },
        },
        modelSelectionExplicit: true,
      },
      stickyActiveProvider: AGY_ID,
      stickyModelSelectionByProvider: {},
      providers: serverProviders,
      settings: settingsWithAgyDefault,
      instanceEntries: entries,
      activeProject: null,
      activeProjectId: SCRATCH_PROJECT_ID,
      activeChatProvider: {
        routeKey: `draft:${SCRATCH_DRAFT_ID}`,
        instanceId: AGY_ID,
        providerId: "antigravity",
        model: "4-neon",
        displayName: "区区",
      },
      now: Date.parse("2026-11-25T08:00:00Z"),
    });
    expect(explicitSwitchBeforeSnapshot).toMatchObject({
      instanceId: CLAUDE_ID,
      providerId: "claudeAgent",
      model: "claude-sonnet-4-6",
      title: "Claude Code",
    });
  });

  it("removes topbar handoff button in ChatView and leaves zero omp/oh-my-pi references in workspace modules", () => {
    const workspaceDir = path.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    );
    const chatViewSource = fs.readFileSync(path.resolve(workspaceDir, "../ChatView.tsx"), "utf8");
    const quickLaunchSource = fs.readFileSync(
      path.join(workspaceDir, "workspaceQuickLaunch.logic.ts"),
      "utf8",
    );
    const tabsStoreSource = fs.readFileSync(
      path.join(workspaceDir, "workspaceTabsStore.ts"),
      "utf8",
    );

    // Topbar "交接给智能体" button must stay removed while underlying handoff/continuation remains intact.
    expect(chatViewSource).not.toContain("交接给智能体");
    expect(chatViewSource).not.toContain('data-action="hand-off-to-agent"');
    expect(chatViewSource).toContain("supportsProviderSwitchingViaHandoff");
    expect(chatViewSource).toContain("AgentSessionContinuationDialog");

    // Zero omp / oh-my-pi references in workspace quick launch & tab store.
    expect(quickLaunchSource).not.toMatch(/\bomp\b|oh-my-pi/i);
    expect(tabsStoreSource).not.toMatch(/\bomp\b|oh-my-pi/i);
  });

  it("applies providerOrder and custom displayName in + quick launch while keeping DSH blue whale brand", () => {
    const DSH_ID = ProviderInstanceId.make("dsh");
    const CODEX_ID = ProviderInstanceId.make("codex");
    const CLAUDE_ID = ProviderInstanceId.make("claudeAgent");
    const AGY_ID = ProviderInstanceId.make("antigravity");

    const entries = deriveProviderInstanceEntries([
      makeProvider({ instanceId: "codex", driver: "codex", displayName: "主力 Codex" }),
      makeProvider({ instanceId: "claudeAgent", driver: "claudeAgent", displayName: "架构师 Claude" }),
      makeProvider({ instanceId: "antigravity", driver: "antigravity", displayName: "小反重" }),
      makeProvider({ instanceId: "dsh", driver: "acpRegistry", displayName: "深海鲸鱼" }),
    ]);

    const ordered = buildQuickLaunchAgentOptions({
      instanceEntries: entries,
      historyThreads: [],
      providerOrder: [DSH_ID, AGY_ID, CLAUDE_ID, CODEX_ID],
    });

    expect(ordered.map((a) => a.instanceId)).toEqual([DSH_ID, AGY_ID, CLAUDE_ID, CODEX_ID]);
    expect(ordered.map((a) => a.displayName)).toEqual([
      "深海鲸鱼",
      "小反重",
      "架构师 Claude",
      "主力 Codex",
    ]);
    // Custom-renamed acpRegistry DSH entry MUST still resolve brandId === "dsh" (blue whale icon)!
    expect(ordered[0]?.brandId).toBe("dsh");
    expect(resolveProviderBrandIdForEntry(entries[3]!)).toBe("dsh");
  });

  it("consumes pendingDraftTabBinding once applied and NEVER reverts composer provider/model switches", () => {
    const CODEX_ID = ProviderInstanceId.make("codex");
    const DSH_ID = ProviderInstanceId.make("dsh");
    const token = {};
    const binding: PendingDraftTabBinding = {
      token,
      tabId: "tab-1",
      originRouteKey: "server:env-local:thread-old",
      title: "Codex",
      providerId: "codex",
      instanceId: CODEX_ID,
      model: "gpt-5.4",
    };

    // 1. While still on server route awaiting navigation, binding stays intact and unapplied.
    const whileOnServer = resolvePendingDraftBindingForSync({
      shownTarget: { kind: "server", threadRef: { environmentId: ENV_LOCAL, threadId: THREAD_A } },
      routeKey: `server:${ENV_LOCAL}:${THREAD_A}`,
      pendingBinding: binding,
      routeComposerDraft: null,
    });
    expect(whileOnServer).toEqual({ applied: null, shouldClear: false });

    // 2. Upon landing on target draft, binding applies ONCE and signals shouldClear: true so it cannot stick.
    const firstDraftSync = resolvePendingDraftBindingForSync({
      shownTarget: { kind: "draft", draftId: DRAFT_A },
      routeKey: `draft:${DRAFT_A}`,
      pendingBinding: binding,
      routeComposerDraft: null,
    });
    expect(firstDraftSync).toEqual({ applied: binding, shouldClear: true });

    // 3. If user switches provider/model explicitly in composer while a stale binding is present,
    //    it MUST be ignored AND cleared immediately instead of reverting the tab!
    const afterComposerSwitch = resolvePendingDraftBindingForSync({
      shownTarget: { kind: "draft", draftId: DRAFT_A },
      routeKey: `draft:${DRAFT_A}`,
      pendingBinding: binding,
      routeComposerDraft: {
        activeProvider: DSH_ID,
        modelSelectionByProvider: {
          [DSH_ID]: { instanceId: DSH_ID, model: "deepseek-reasoner" },
        },
        modelSelectionExplicit: true,
      },
    });
    expect(afterComposerSwitch).toEqual({ applied: null, shouldClear: true });

    // 4. Even switching only the model on the same provider invalidates the stale pending binding.
    const afterModelSwitch = resolvePendingDraftBindingForSync({
      shownTarget: { kind: "draft", draftId: DRAFT_A },
      routeKey: `draft:${DRAFT_A}`,
      pendingBinding: binding,
      routeComposerDraft: {
        activeProvider: CODEX_ID,
        modelSelectionByProvider: {
          [CODEX_ID]: { instanceId: CODEX_ID, model: "o3-pro" },
        },
        modelSelectionExplicit: true,
      },
    });
    expect(afterModelSwitch).toEqual({ applied: null, shouldClear: true });
  });

  it("trusts real server thread live harness (including acpRegistry DSH) and preserves instanceId/model in promoteDraftTab", () => {
    const CODEX_ID = ProviderInstanceId.make("codex");
    const DSH_ID = ProviderInstanceId.make("dsh");

    const serverProviders: ReadonlyArray<ServerProvider> = [
      makeProvider({ instanceId: "codex", driver: "codex" }),
      makeProvider({
        instanceId: "dsh",
        driver: "acpRegistry",
        displayName: "我的深海鲸",
        status: "error",
        models: [
          {
            slug: "deepseek-reasoner",
            name: "DeepSeek Reasoner",
            isDefault: true,
            isCustom: false,
            capabilities: {},
          },
        ],
      }),
    ];
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      defaultModelSelection: { instanceId: CODEX_ID, model: "codex-default" },
      providerInstances: {
        ...DEFAULT_SERVER_SETTINGS.providerInstances,
        [DSH_ID]: {
          driver: ProviderDriverKind.make("acpRegistry"),
          displayName: "我的深海鲸",
          enabled: true,
          config: { agentId: "dsh" },
        },
      },
    };
    const entries = providerInstanceEntriesFor(serverProviders, settings, null);

    // Server thread running on DSH (even while provider status is "error" and stickyActiveProvider is Codex)
    // MUST resolve DSH ("dsh") instead of falling back to Codex!
    const dshServerMeta = resolveWorkspaceRouteProviderMetadata({
      shownTarget: { kind: "server", threadRef: { environmentId: ENV_LOCAL, threadId: THREAD_A } },
      routeKey: `server:${ENV_LOCAL}:${THREAD_A}`,
      routeThreadShell: {
        title: "排查 DSH 思考层级",
        modelSelection: { instanceId: DSH_ID, model: "deepseek-reasoner" },
        runtime: { providerInstanceId: DSH_ID },
      },
      routeComposerDraft: {
        activeProvider: CODEX_ID,
        modelSelectionByProvider: {
          [CODEX_ID]: { instanceId: CODEX_ID, model: "codex-default" },
        },
        modelSelectionExplicit: false,
      },
      stickyActiveProvider: CODEX_ID,
      stickyModelSelectionByProvider: {
        [CODEX_ID]: { instanceId: CODEX_ID, model: "codex-default" },
      },
      providers: serverProviders,
      settings,
      instanceEntries: entries,
      activeProject: null,
      activeProjectId: null,
    });
    expect(dshServerMeta).toMatchObject({
      instanceId: DSH_ID,
      providerId: "dsh",
      model: "deepseek-reasoner",
      title: "排查 DSH 思考层级",
    });

    // promoteDraftTab MUST preserve & apply instanceId, model, providerId, and title!
    const store = useWorkspaceTabsStore.getState();
    const tabId = store.openTab({
      kind: "draft",
      title: "Codex",
      providerId: "codex",
      instanceId: CODEX_ID,
      model: "codex-default",
      environmentId: ENV_LOCAL,
      threadId: THREAD_A,
      draftId: DRAFT_A,
    });
    store.promoteDraftTab(
      DRAFT_A,
      { environmentId: ENV_LOCAL, threadId: THREAD_A },
      {
        title: "排查 DSH 思考层级",
        providerId: "dsh",
        instanceId: DSH_ID,
        model: "deepseek-reasoner",
      },
    );
    expect(useWorkspaceTabsStore.getState().tabs[tabId]).toMatchObject({
      kind: "thread",
      draftId: null,
      environmentId: ENV_LOCAL,
      threadId: THREAD_A,
      title: "排查 DSH 思考层级",
      providerId: "dsh",
      instanceId: DSH_ID,
      model: "deepseek-reasoner",
    });
  });

  it("promotes matching draft tab in-place during syncRouteTarget and reconciles phantom 新会话 tabs on model error", () => {
    const store = useWorkspaceTabsStore.getState();
    const DSH_ID = ProviderInstanceId.make("dsh");
    const CODEX_ID = ProviderInstanceId.make("codex");
    const DRAFT_ZOMBIE = "draft-zombie-promoted" as DraftId;
    const DRAFT_ORPHAN = "draft-orphan-failed" as DraftId;
    const DRAFT_LIVE = "draft-live-keep" as DraftId;

    // 1. Draft tab D1 has threadId T1. Model errors AFTER server creates T1 and router jumps straight
    //    to /env/T1 before promoteDraftTab runs -> syncRouteTarget MUST promote D1 in-place (ZERO duplicate tab!).
    const d1TabId = store.openTab({
      kind: "draft",
      title: "新会话",
      providerId: "dsh",
      instanceId: DSH_ID,
      model: "deepseek-reasoner",
      environmentId: ENV_LOCAL,
      threadId: THREAD_A,
      draftId: DRAFT_A,
    });

    const syncedServerTabId = store.syncRouteTarget({
      target: { kind: "server", threadRef: { environmentId: ENV_LOCAL, threadId: THREAD_A } },
      title: "首轮报错但已建线程",
      providerId: "dsh",
      instanceId: DSH_ID,
      model: "deepseek-reasoner",
      draftLookup: {
        getDraftSession: () => null,
        getComposerDraft: () => null,
        getPromotedDraftRedirect: (id) =>
          id === DRAFT_A ? { environmentId: ENV_LOCAL, threadId: THREAD_A } : null,
      },
    });
    expect(syncedServerTabId).toBe(d1TabId);
    let state = useWorkspaceTabsStore.getState();
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([d1TabId]);
    expect(state.tabs[d1TabId]).toMatchObject({
      kind: "thread",
      draftId: null,
      environmentId: ENV_LOCAL,
      threadId: THREAD_A,
      title: "首轮报错但已建线程",
      providerId: "dsh",
      instanceId: DSH_ID,
      model: "deepseek-reasoner",
    });

    // 2. Even if a zombie draft tab whose draftId already promoted via promotedTo/redirect exists alongside
    //    an existing server tab (or an orphan draft tab whose draft session vanished after error),
    //    reconcileDraftTabs immediately merges/prunes them without needing a click!
    const zombieDraftTabId = store.openTab({
      kind: "draft",
      title: "新会话",
      providerId: "codex",
      instanceId: CODEX_ID,
      draftId: DRAFT_ZOMBIE,
      reuseExisting: false,
    });
    const orphanDraftTabId = store.openTab({
      kind: "draft",
      title: "新会话",
      providerId: "codex",
      instanceId: CODEX_ID,
      draftId: DRAFT_ORPHAN,
      reuseExisting: false,
    });
    const liveDraftTabId = store.openTab({
      kind: "draft",
      title: "Codex",
      providerId: "codex",
      instanceId: CODEX_ID,
      draftId: DRAFT_LIVE,
      reuseExisting: false,
    });
    // Switch active tab back to the real server thread T1.
    store.activateTab(DEFAULT_PRIMARY_PANE_ID, d1TabId);

    store.reconcileDraftTabs({
      activeRouteTarget: {
        kind: "server",
        threadRef: { environmentId: ENV_LOCAL, threadId: THREAD_A },
      },
      lookup: {
        getDraftSession: (id) => (id === DRAFT_LIVE ? { promotedTo: null } : null),
        getComposerDraft: () => null,
        getPromotedDraftRedirect: (id) =>
          id === DRAFT_ZOMBIE ? { environmentId: ENV_LOCAL, threadId: THREAD_A } : null,
      },
    });

    state = useWorkspaceTabsStore.getState();
    // Zombie promoted draft & orphan vanished draft are BOTH eliminated immediately;
    // real server thread tab & legitimate live draft tab stay intact!
    expect(state.tabs[zombieDraftTabId]).toBeUndefined();
    expect(state.tabs[orphanDraftTabId]).toBeUndefined();
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.tabIds).toEqual([d1TabId, liveDraftTabId]);
    expect(state.panes[DEFAULT_PRIMARY_PANE_ID]?.activeTabId).toBe(d1TabId);
  });
});
