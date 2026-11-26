import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@prismux/client-runtime/environment";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@prismux/core-contracts";
import { createModelSelection } from "@prismux/core-shared/model";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { DraftId, useComposerDraftStore } from "../../composerDraftStore";
import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  selectPaneOverviewOpen,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../../rightPanelStore";
import type { ThreadRouteTarget } from "../../threadRoutes";
import {
  doesWorkspaceTabMatchRouteTarget,
  resolveFocusedSplitRightPanelContext,
  resolveFollowSurfaceKindForPaneSwitch,
  resolveSplitRouteOwnership,
} from "./splitPaneIsolation.logic";
import { launchSecondaryPaneAgentDraft } from "./WorkspaceSplitContainer";
import type { QuickLaunchAgentOption } from "./workspaceQuickLaunch.logic";
import { PrismuxStageFrame, WorkspaceSplitPaneContext } from "./WorkspaceTopbarPortalContext";
import { DEFAULT_PRIMARY_PANE_ID, useWorkspaceTabsStore } from "./workspaceTabsStore";

const ENV_ID = EnvironmentId.make("env-local");
const PROJECT_ID = ProjectId.make("proj-prismux");
const DSH_THREAD_ID = ThreadId.make("thread-dsh-bash");
const CODEX_THREAD_ID = ThreadId.make("thread-codex-goose");
const CLAUDE_THREAD_ID = ThreadId.make("thread-claude-review");
const DSH_INSTANCE_ID = ProviderInstanceId.make("acp-deepseek-harness");
const CODEX_INSTANCE_ID = ProviderInstanceId.make("codex");
const CLAUDE_INSTANCE_ID = ProviderInstanceId.make("claudeAgent");

function makeProviderEntries(): ReadonlyArray<ProviderInstanceEntry> {
  return [
    {
      instanceId: DSH_INSTANCE_ID,
      driverKind: "acpRegistry",
      displayName: "DeepSeek Harness",
      enabled: true,
      isAvailable: true,
      snapshot: {
        instanceId: DSH_INSTANCE_ID,
        driver: "acpRegistry",
        displayName: "DeepSeek Harness",
        status: "ready",
        installed: true,
        models: [
          {
            slug: "deepseek-v4.1-flash",
            name: "DeepSeek V4.1 Flash",
            isDefault: true,
            isCustom: false,
          },
        ],
      },
      models: [
        {
          slug: "deepseek-v4.1-flash",
          name: "DeepSeek V4.1 Flash",
          isDefault: true,
          isCustom: false,
        },
      ],
    } as unknown as ProviderInstanceEntry,
    {
      instanceId: CODEX_INSTANCE_ID,
      driverKind: "codex",
      displayName: "Codex",
      enabled: true,
      isAvailable: true,
      snapshot: {
        instanceId: CODEX_INSTANCE_ID,
        driver: "codex",
        displayName: "Codex",
        status: "ready",
        installed: true,
        models: [
          {
            slug: "gpt-5.3-codex",
            name: "GPT-5.3 Codex",
            isDefault: true,
            isCustom: false,
          },
        ],
      },
      models: [
        {
          slug: "gpt-5.3-codex",
          name: "GPT-5.3 Codex",
          isDefault: true,
          isCustom: false,
        },
      ],
    } as unknown as ProviderInstanceEntry,
    {
      instanceId: CLAUDE_INSTANCE_ID,
      driverKind: "claudeAgent",
      displayName: "Claude Code",
      enabled: true,
      isAvailable: true,
      snapshot: {
        instanceId: CLAUDE_INSTANCE_ID,
        driver: "claudeAgent",
        displayName: "Claude Code",
        status: "ready",
        installed: true,
        models: [
          {
            slug: "claude-sonnet-4-6",
            name: "Claude Sonnet 4.6",
            isDefault: true,
            isCustom: false,
          },
        ],
      },
      models: [
        {
          slug: "claude-sonnet-4-6",
          name: "Claude Sonnet 4.6",
          isDefault: true,
          isCustom: false,
        },
      ],
    } as unknown as ProviderInstanceEntry,
  ];
}

function resetStores() {
  useWorkspaceTabsStore.setState({
    layout: { type: "leaf", paneId: DEFAULT_PRIMARY_PANE_ID },
    panes: {
      [DEFAULT_PRIMARY_PANE_ID]: { id: DEFAULT_PRIMARY_PANE_ID, tabIds: [], activeTabId: null },
    },
    tabs: {},
    focusedPaneId: DEFAULT_PRIMARY_PANE_ID,
    primaryPaneId: DEFAULT_PRIMARY_PANE_ID,
    activeDrag: null,
    isResizingSplit: false,
  });
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    paneOverviewOpenByPaneId: {},
    splitDockOpen: false,
    splitDockMaximized: false,
    splitGlobalWallpaperOpen: false,
    pendingMaximizeThreadKey: null,
  });
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    promotedDraftRedirects: {},
    stickyActiveProvider: null,
    stickyModelSelectionByProvider: {},
  });
}

describe("Track #9: Split-pane thread, model, overview & right sidebar isolation", () => {
  beforeEach(() => {
    resetStores();
  });

  describe("1. Split-pane thread, model & draft isolation", () => {
    it("never mirrors top DSH route onto bottom Codex pane when dragging DSH out of pane-main (screenshot bug regression)", () => {
      const store = useWorkspaceTabsStore.getState();
      const codexTabId = store.openTab(
        {
          kind: "thread",
          title: "制作鹅鹅骑自行车动画",
          providerId: "codex",
          instanceId: CODEX_INSTANCE_ID,
          model: "gpt-5.3-codex",
          environmentId: ENV_ID,
          threadId: CODEX_THREAD_ID,
        },
        "pane-main",
      );
      const dshTabId = store.openTab(
        {
          kind: "thread",
          title: "查看本机 Bash、PowerShell 环境",
          providerId: "deepseek-harness",
          instanceId: DSH_INSTANCE_ID,
          model: "deepseek-v4.1-flash",
          environmentId: ENV_ID,
          threadId: DSH_THREAD_ID,
        },
        "pane-main",
      );

      // Drag the active DSH tab to the top edge -> creates vertical split with Top=DSH, Bottom(pane-main)=Codex
      const dropResult = useWorkspaceTabsStore
        .getState()
        .dropItemIntoPane(
          { kind: "pane-tab", tabId: dshTabId, fromPaneId: "pane-main" },
          "pane-main",
          "top",
        );
      expect(dropResult).not.toBeNull();
      const topPaneId = dropResult!.paneId;
      expect(topPaneId).not.toBe("pane-main");

      const state = useWorkspaceTabsStore.getState();
      expect(state.panes[topPaneId]?.activeTabId).toBe(dshTabId);
      expect(state.panes["pane-main"]?.activeTabId).toBe(codexTabId);

      // Even while TanStack Router's shownTarget is STILL on DSH, primaryPane (Codex) MUST NOT
      // receive primaryContent! Top pane owns DSH route; bottom pane renders Codex via WorkspacePaneContent.
      const dshShownTarget: ThreadRouteTarget = {
        kind: "server",
        threadRef: scopeThreadRef(ENV_ID, DSH_THREAD_ID),
      };
      const ownership = resolveSplitRouteOwnership({
        layout: state.layout,
        panes: state.panes,
        tabs: state.tabs,
        primaryPaneId: state.primaryPaneId,
        focusedPaneId: state.focusedPaneId,
        shownTarget: dshShownTarget,
        modalOpen: false,
      });
      expect(ownership.routeOwnerPaneId).toBe(topPaneId);
      expect(ownership.ownerShowsRoute).toBe(true);
      expect(ownership.routeOwnerPaneId).not.toBe("pane-main");

      // Switching focus to pane-main (Codex) while shownTarget is STILL DSH still never mirrors DSH onto pane-main!
      useWorkspaceTabsStore.getState().focusPane("pane-main");
      const focusedState = useWorkspaceTabsStore.getState();
      const ownershipAfterFocus = resolveSplitRouteOwnership({
        layout: focusedState.layout,
        panes: focusedState.panes,
        tabs: focusedState.tabs,
        primaryPaneId: focusedState.primaryPaneId,
        focusedPaneId: focusedState.focusedPaneId,
        shownTarget: dshShownTarget,
        modalOpen: false,
      });
      expect(ownershipAfterFocus.routeOwnerPaneId).toBe(topPaneId);
      expect(ownershipAfterFocus.routeOwnerPaneId).not.toBe("pane-main");

      // If router shownTarget points to a 3rd thread not active in either pane, NO pane mirrors it!
      const unrelatedTarget: ThreadRouteTarget = {
        kind: "server",
        threadRef: scopeThreadRef(ENV_ID, CLAUDE_THREAD_ID),
      };
      const noOwner = resolveSplitRouteOwnership({
        layout: focusedState.layout,
        panes: focusedState.panes,
        tabs: focusedState.tabs,
        primaryPaneId: focusedState.primaryPaneId,
        focusedPaneId: focusedState.focusedPaneId,
        shownTarget: unrelatedTarget,
        modalOpen: false,
      });
      expect(noOwner.routeOwnerPaneId).toBeNull();
      expect(noOwner.ownerShowsRoute).toBe(false);
    });

    it("focuses the secondary pane instead of duplicating tabs when syncRouteTarget activates a thread already open in Pane B", () => {
      const store = useWorkspaceTabsStore.getState();
      store.openTab(
        {
          kind: "thread",
          title: "DSH 终端排查",
          providerId: "deepseek-harness",
          instanceId: DSH_INSTANCE_ID,
          environmentId: ENV_ID,
          threadId: DSH_THREAD_ID,
        },
        "pane-main",
      );
      const secondaryPaneId = store.splitPane(
        "pane-main",
        "horizontal",
        {
          kind: "thread",
          title: "制作鹅鹅骑自行车动画",
          providerId: "codex",
          instanceId: CODEX_INSTANCE_ID,
          environmentId: ENV_ID,
          threadId: CODEX_THREAD_ID,
        },
        "after",
      );
      expect(secondaryPaneId).not.toBeNull();
      useWorkspaceTabsStore.getState().focusPane("pane-main");
      expect(useWorkspaceTabsStore.getState().focusedPaneId).toBe("pane-main");

      // Navigating via sidebar to the Codex thread open in secondary pane focuses secondaryPaneId cleanly.
      useWorkspaceTabsStore.getState().syncRouteTarget({
        target: { kind: "server", threadRef: scopeThreadRef(ENV_ID, CODEX_THREAD_ID) },
        title: "制作鹅鹅骑自行车动画",
        providerId: "codex",
        instanceId: CODEX_INSTANCE_ID,
        environmentId: ENV_ID,
        threadId: CODEX_THREAD_ID,
        activate: true,
      });

      const after = useWorkspaceTabsStore.getState();
      expect(after.focusedPaneId).toBe(secondaryPaneId);
      // Should NOT duplicate Codex into pane-main
      const codexTabs = Object.values(after.tabs).filter(
        (t) => t.kind === "thread" && t.threadId === CODEX_THREAD_ID,
      );
      expect(codexTabs).toHaveLength(1);
    });

    it("keeps secondary-pane new drafts completely isolated from primary pane draft & model", async () => {
      const entries = makeProviderEntries();
      const projectRef = scopeProjectRef(ENV_ID, PROJECT_ID);

      // Pane A (primary) has a DSH draft with explicit DeepSeek V4.1 Flash selection
      const primaryDraftId = DraftId.make("draft-pane-a-dsh");
      const primaryThreadId = ThreadId.make("thread-draft-a");
      const draftStore = useComposerDraftStore.getState();
      draftStore.setLogicalProjectDraftThreadId(
        "logical:proj-prismux",
        projectRef,
        primaryDraftId,
        {
          threadId: primaryThreadId,
          envMode: "local",
        },
      );
      draftStore.setModelSelection(
        primaryDraftId,
        createModelSelection(DSH_INSTANCE_ID, "deepseek-v4.1-flash"),
        { explicit: true, replaceOptions: true },
      );

      const tabStore = useWorkspaceTabsStore.getState();
      tabStore.openTab(
        {
          kind: "draft",
          title: "DeepSeek Harness",
          providerId: "deepseek-harness",
          instanceId: DSH_INSTANCE_ID,
          model: "deepseek-v4.1-flash",
          environmentId: ENV_ID,
          threadId: primaryThreadId,
          draftId: primaryDraftId,
        },
        "pane-main",
      );

      // Split into Pane B and create isolated Codex + Claude drafts inside Pane B
      const paneBId = tabStore.splitPane(
        "pane-main",
        "horizontal",
        { kind: "terminal", title: "PowerShell", shell: "PowerShell" },
        "after",
      );
      expect(paneBId).not.toBeNull();

      const codexAgent: QuickLaunchAgentOption = {
        id: "codex",
        instanceId: CODEX_INSTANCE_ID,
        driverKind: "codex",
        brandId: "codex",
        displayName: "Codex",
        defaultModel: "gpt-5.3-codex",
        subtitle: "gpt-5.3-codex",
        available: true,
        recentThreads: [],
      };
      const claudeAgent: QuickLaunchAgentOption = {
        id: "claudeAgent",
        instanceId: CLAUDE_INSTANCE_ID,
        driverKind: "claudeAgent",
        brandId: "claude-code",
        displayName: "Claude Code",
        defaultModel: "claude-sonnet-4-6",
        subtitle: "claude-sonnet-4-6",
        available: true,
        recentThreads: [],
      };

      const codexCreated = await launchSecondaryPaneAgentDraft({
        agent: codexAgent,
        targetPaneId: paneBId!,
        instanceEntries: entries,
        resolveProjectRef: async () => ({ projectRef, fromScratch: false }),
      });
      expect(codexCreated).not.toBeNull();

      const claudeCreated = await launchSecondaryPaneAgentDraft({
        agent: claudeAgent,
        targetPaneId: paneBId!,
        instanceEntries: entries,
        resolveProjectRef: async () => ({ projectRef, fromScratch: false }),
      });
      expect(claudeCreated).not.toBeNull();

      // Verify all 3 drafts coexist cleanly with their own distinct explicit provider & model!
      const latestDraftStore = useComposerDraftStore.getState();
      const dshDraft = latestDraftStore.getComposerDraft(primaryDraftId);
      const codexDraft = latestDraftStore.getComposerDraft(codexCreated!.draftId);
      const claudeDraft = latestDraftStore.getComposerDraft(claudeCreated!.draftId);

      expect(dshDraft?.activeProvider).toBe(DSH_INSTANCE_ID);
      expect(dshDraft?.modelSelectionByProvider[DSH_INSTANCE_ID]?.model).toBe(
        "deepseek-v4.1-flash",
      );
      expect(dshDraft?.modelSelectionExplicit).toBe(true);

      expect(codexDraft?.activeProvider).toBe(CODEX_INSTANCE_ID);
      expect(codexDraft?.modelSelectionByProvider[CODEX_INSTANCE_ID]?.model).toBe("gpt-5.3-codex");
      expect(codexDraft?.modelSelectionExplicit).toBe(true);

      expect(claudeDraft?.activeProvider).toBe(CLAUDE_INSTANCE_ID);
      expect(claudeDraft?.modelSelectionByProvider[CLAUDE_INSTANCE_ID]?.model).toBe(
        "claude-sonnet-4-6",
      );
      expect(claudeDraft?.modelSelectionExplicit).toBe(true);

      // Primary logical project mapping was NEVER overwritten by Pane B's drafts
      expect(
        latestDraftStore.getDraftSessionByLogicalProjectKey("logical:proj-prismux")?.draftId,
      ).toBe(primaryDraftId);

      // Verify draft route target matching distinguishes drafts strictly
      const codexTab = useWorkspaceTabsStore.getState().tabs[codexCreated!.tabId];
      expect(
        doesWorkspaceTabMatchRouteTarget(codexTab, { kind: "draft", draftId: primaryDraftId }),
      ).toBe(false);
      expect(
        doesWorkspaceTabMatchRouteTarget(codexTab, {
          kind: "draft",
          draftId: codexCreated!.draftId,
        }),
      ).toBe(true);
    });
  });

  describe("2. Per-pane dedicated overview visibility isolation", () => {
    it("maintains independent open/collapsed overview state per paneId in split view while preserving single-pane thread state", () => {
      const dshRef = scopeThreadRef(ENV_ID, DSH_THREAD_ID);
      const codexRef = scopeThreadRef(ENV_ID, CODEX_THREAD_ID);

      // Default open in split view for both panes
      let rp = useRightPanelStore.getState();
      expect(
        selectPaneOverviewOpen(
          rp.paneOverviewOpenByPaneId,
          rp.threadPanelVisibilityByThreadKey,
          "pane-top",
          dshRef,
          true,
        ),
      ).toBe(true);
      expect(
        selectPaneOverviewOpen(
          rp.paneOverviewOpenByPaneId,
          rp.threadPanelVisibilityByThreadKey,
          "pane-bottom",
          codexRef,
          true,
        ),
      ).toBe(true);

      // Collapse top pane overview -> bottom pane stays OPEN!
      rp.setPaneOverviewOpen("pane-top", false);
      rp = useRightPanelStore.getState();
      expect(
        selectPaneOverviewOpen(
          rp.paneOverviewOpenByPaneId,
          rp.threadPanelVisibilityByThreadKey,
          "pane-top",
          dshRef,
          true,
        ),
      ).toBe(false);
      expect(
        selectPaneOverviewOpen(
          rp.paneOverviewOpenByPaneId,
          rp.threadPanelVisibilityByThreadKey,
          "pane-bottom",
          codexRef,
          true,
        ),
      ).toBe(true);

      // Toggle bottom pane -> bottom closes, top stays closed
      rp.togglePaneOverview("pane-bottom", true);
      rp = useRightPanelStore.getState();
      expect(
        selectPaneOverviewOpen(
          rp.paneOverviewOpenByPaneId,
          rp.threadPanelVisibilityByThreadKey,
          "pane-bottom",
          codexRef,
          true,
        ),
      ).toBe(false);

      // Re-open top pane -> top opens, bottom stays closed
      rp.togglePaneOverview("pane-top", true);
      rp = useRightPanelStore.getState();
      expect(
        selectPaneOverviewOpen(
          rp.paneOverviewOpenByPaneId,
          rp.threadPanelVisibilityByThreadKey,
          "pane-top",
          dshRef,
          true,
        ),
      ).toBe(true);
      expect(
        selectPaneOverviewOpen(
          rp.paneOverviewOpenByPaneId,
          rp.threadPanelVisibilityByThreadKey,
          "pane-bottom",
          codexRef,
          true,
        ),
      ).toBe(false);

      // Single-pane mode (inSplit = false) ignores paneOverviewOpenByPaneId and uses thread visibility!
      expect(
        selectPaneOverviewOpen(
          rp.paneOverviewOpenByPaneId,
          rp.threadPanelVisibilityByThreadKey,
          "pane-bottom",
          codexRef,
          false,
        ),
      ).toBe(true);
    });
  });

  describe("3. Split-view unified right sidebar tracking, global wallpaper & non-thread fallback", () => {
    it("follows active/focused split pane switches, handles non-thread tab fallback cleanly, and keeps global wallpaper independent", () => {
      const store = useWorkspaceTabsStore.getState();
      store.openTab(
        {
          kind: "thread",
          title: "DSH 会话",
          providerId: "deepseek-harness",
          instanceId: DSH_INSTANCE_ID,
          environmentId: ENV_ID,
          threadId: DSH_THREAD_ID,
        },
        "pane-main",
      );
      const paneBId = store.splitPane(
        "pane-main",
        "horizontal",
        {
          kind: "thread",
          title: "制作鹅鹅骑自行车动画",
          providerId: "codex",
          instanceId: CODEX_INSTANCE_ID,
          environmentId: ENV_ID,
          threadId: CODEX_THREAD_ID,
        },
        "after",
      )!;

      // Focused on Pane B -> context binds strictly to Codex
      let state = useWorkspaceTabsStore.getState();
      let ctx = resolveFocusedSplitRightPanelContext({
        layout: state.layout,
        panes: state.panes,
        tabs: state.tabs,
        focusedPaneId: state.focusedPaneId,
        primaryPaneId: state.primaryPaneId,
      });
      expect(ctx.paneId).toBe(paneBId);
      expect(ctx.threadKey).toBe(scopedThreadKey(scopeThreadRef(ENV_ID, CODEX_THREAD_ID)));
      expect(ctx.providerId).toBe("codex");
      expect(ctx.isConversationTab).toBe(true);

      // Focus Pane A -> context switches strictly to DSH
      useWorkspaceTabsStore.getState().focusPane("pane-main");
      state = useWorkspaceTabsStore.getState();
      ctx = resolveFocusedSplitRightPanelContext({
        layout: state.layout,
        panes: state.panes,
        tabs: state.tabs,
        focusedPaneId: state.focusedPaneId,
        primaryPaneId: state.primaryPaneId,
      });
      expect(ctx.paneId).toBe("pane-main");
      expect(ctx.threadKey).toBe(scopedThreadKey(scopeThreadRef(ENV_ID, DSH_THREAD_ID)));
      expect(ctx.providerId).toBe("deepseek-harness");

      // Open a non-thread simulator tab in Pane B and focus it -> clean null threadRef fallback!
      useWorkspaceTabsStore
        .getState()
        .openTab({ kind: "simulator", title: "手机模拟器", hostThreadRef: null }, paneBId);
      state = useWorkspaceTabsStore.getState();
      ctx = resolveFocusedSplitRightPanelContext({
        layout: state.layout,
        panes: state.panes,
        tabs: state.tabs,
        focusedPaneId: state.focusedPaneId,
        primaryPaneId: state.primaryPaneId,
      });
      expect(ctx.paneId).toBe(paneBId);
      expect(ctx.threadRef).toBeNull();
      expect(ctx.threadKey).toBeNull();
      expect(ctx.isConversationTab).toBe(false);

      // Verify right-panel store dock synchronization:
      const rp = useRightPanelStore.getState();
      // Global wallpaper stays open regardless of thread selection
      rp.toggleSplitGlobalWallpaper();
      expect(useRightPanelStore.getState().splitGlobalWallpaperOpen).toBe(true);

      // Opening a thread-scoped surface (e.g. from Pane B overview's "审查") opens splitDock and exits wallpaper
      const codexRef = scopeThreadRef(ENV_ID, CODEX_THREAD_ID);
      useRightPanelStore.getState().open(codexRef, "diff");
      expect(useRightPanelStore.getState().splitDockOpen).toBe(true);
      expect(useRightPanelStore.getState().splitGlobalWallpaperOpen).toBe(false);
      expect(
        selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, codexRef)
          .activeSurfaceId,
      ).toBe("diff");

      // Switching from Pane A ("diff") to Pane B ("codex") follows portable surface kind cleanly
      expect(
        resolveFollowSurfaceKindForPaneSwitch({
          previousSurface: { id: "diff", kind: "diff" },
          nextThreadHasSurfaces: false,
          nextIsServerThread: true,
          nextHasProject: true,
          nextDiffAvailable: true,
        }),
      ).toBe("diff");
      expect(
        resolveFollowSurfaceKindForPaneSwitch({
          previousSurface: { id: "diff", kind: "diff" },
          nextThreadHasSurfaces: false,
          nextIsServerThread: false,
          nextHasProject: true,
          nextDiffAvailable: false,
        }),
      ).toBe("files");
      expect(
        resolveFollowSurfaceKindForPaneSwitch({
          previousSurface: { id: "wallpaper", kind: "wallpaper" },
          nextThreadHasSurfaces: false,
          nextIsServerThread: true,
          nextHasProject: true,
          nextDiffAvailable: true,
        }),
      ).toBeNull();
      expect(
        resolveFollowSurfaceKindForPaneSwitch({
          previousSurface: {
            id: "terminal:t1",
            kind: "terminal",
            resourceId: "t1",
            terminalIds: ["t1"],
            activeTerminalId: "t1",
          },
          nextThreadHasSurfaces: false,
          nextIsServerThread: true,
          nextHasProject: true,
          nextDiffAvailable: true,
        }),
      ).toBe("show-empty");
    });
  });

  describe("4. Single-pane & maximized PrismuxStageFrame regression checks", () => {
    it("preserves 100% legacy single-pane route ownership and concave 14px stage frame outside split pane context", () => {
      const store = useWorkspaceTabsStore.getState();
      store.openTab(
        {
          kind: "thread",
          title: "单窗格会话",
          providerId: "codex",
          instanceId: CODEX_INSTANCE_ID,
          environmentId: ENV_ID,
          threadId: CODEX_THREAD_ID,
        },
        "pane-main",
      );
      const state = useWorkspaceTabsStore.getState();
      const singleOwnership = resolveSplitRouteOwnership({
        layout: state.layout,
        panes: state.panes,
        tabs: state.tabs,
        primaryPaneId: state.primaryPaneId,
        focusedPaneId: state.focusedPaneId,
        shownTarget: { kind: "server", threadRef: scopeThreadRef(ENV_ID, DSH_THREAD_ID) },
        modalOpen: false,
      });
      // Single pane always keeps primaryContent in pane-main
      expect(singleOwnership.routeOwnerPaneId).toBe("pane-main");
      expect(singleOwnership.ownerShowsRoute).toBe(true);

      // Maximized right sidebar dock sits OUTSIDE WorkspaceSplitPaneContext -> keeps full 14px concave corners!
      const maximizedMarkup = renderToStaticMarkup(
        <PrismuxStageFrame
          rightPanelOpen={false}
          glassZone="mainCanvas"
          innerDataAttributes={{ "data-right-panel-maximized-stage": "1" }}
        >
          <div>Maximized Panel</div>
        </PrismuxStageFrame>,
      );
      expect(maximizedMarkup).toContain('data-pmx-stage-frame="1"');
      expect(maximizedMarkup).toContain('data-right-panel-maximized-stage="1"');
      expect(maximizedMarkup).not.toContain('data-pmx-split-flat="1"');

      // Inside a split pane context -> renders flat split frame without double concave corners
      const splitPaneMarkup = renderToStaticMarkup(
        <WorkspaceSplitPaneContext.Provider
          value={{
            inSplit: true,
            edges: { top: true, right: false, bottom: true, left: true },
            paneId: "pane-left",
            isFocused: true,
            isPrimary: true,
          }}
        >
          <PrismuxStageFrame>
            <div>Split Pane Stage</div>
          </PrismuxStageFrame>
        </WorkspaceSplitPaneContext.Provider>,
      );
      expect(splitPaneMarkup).toContain('data-pmx-split-flat="1"');
    });
  });
});
