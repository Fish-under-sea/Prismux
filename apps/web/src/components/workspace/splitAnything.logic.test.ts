// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodePath from "node:path";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@prismux/core-contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  buildOpenTabInputFromSplitPayload,
  computeClampedSplitRatio,
  computePaneEdgesMap,
  deriveChildSplitEdges,
  hasSplitDragMime,
  mapRightPanelSurfaceKindToTabKind,
  parseSplitDragPayload,
  PRISMUX_SPLIT_DRAG_EVENT,
  PRISMUX_SPLIT_ITEM_MIME,
  readSplitDragDataTransfer,
  resolveDropPreviewOverlayClass,
  resolveDropZoneLabel,
  resolvePaneBodyCornerClasses,
  resolvePaneDropZone,
  resolvePaneOuterBorderClasses,
  resolveSplitPlacementFromZone,
  ROOT_SPLIT_PANE_EDGES,
  serializeSplitDragPayload,
  WORKSPACE_TAB_DRAG_MIME,
  writeSplitDragDataTransfer,
  type SplitDragPayload,
} from "./splitAnything.logic";
import {
  PrismuxStageFrame,
  WorkspaceSplitPaneContext,
} from "./WorkspaceTopbarPortalContext";
import {
  countLeafPanes,
  DEFAULT_PRIMARY_PANE_ID,
  listLeafPaneIds,
  splitLeafNode,
  useWorkspaceTabsStore,
  WORKSPACE_MAX_SPLIT_PANES,
  type WorkspaceSplitLayoutNode,
} from "./workspaceTabsStore";

const ENV_LOCAL = EnvironmentId.make("env-local");
const THREAD_A = ThreadId.make("thread-a");
const THREAD_B = ThreadId.make("thread-b");
const THREAD_C = ThreadId.make("thread-c");

describe("splitAnything.logic — drop zones, payloads, ratio clamping & outer-edge propagation", () => {
  it("resolves clamped 25% edge drop zones vs center merge and respects max-pane / self-drag guards", () => {
    const rect = { left: 100, top: 50, width: 800, height: 600 };

    // Center zone
    expect(resolvePaneDropZone(rect, 500, 350)).toBe("center");
    // Left / Right / Top / Bottom edges
    expect(resolvePaneDropZone(rect, 150, 350)).toBe("left");
    expect(resolvePaneDropZone(rect, 860, 350)).toBe("right");
    expect(resolvePaneDropZone(rect, 500, 100)).toBe("top");
    expect(resolvePaneDropZone(rect, 500, 610)).toBe("bottom");

    // Corner resolves to proportionally closer edge
    expect(resolvePaneDropZone(rect, 120, 170)).toBe("left");
    expect(resolvePaneDropZone(rect, 220, 65)).toBe("top");

    // Narrow pane clamps edge zone to max 32% so center stays reachable
    const narrowRect = { left: 0, top: 0, width: 120, height: 120 };
    expect(resolvePaneDropZone(narrowRect, 60, 60)).toBe("center");
    expect(resolvePaneDropZone(narrowRect, 15, 60)).toBe("left");

    // Self-drag of a pane's sole tab collapses edges to "center"
    expect(resolvePaneDropZone(rect, 120, 350, { isSingleTabSelfDrag: true })).toBe("center");

    // Max split panes guard collapses edges to "center"
    expect(
      resolvePaneDropZone(rect, 880, 350, {
        paneCount: WORKSPACE_MAX_SPLIT_PANES,
        maxSplitPanes: WORKSPACE_MAX_SPLIT_PANES,
      }),
    ).toBe("center");

    // Degenerate zero-size rect safely returns "center"
    expect(resolvePaneDropZone({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBe("center");
  });

  it("maps drop zones to split placements, sharp rounded-none overlay classes, and Chinese labels", () => {
    expect(resolveSplitPlacementFromZone("left")).toEqual({
      direction: "horizontal",
      position: "before",
    });
    expect(resolveSplitPlacementFromZone("right")).toEqual({
      direction: "horizontal",
      position: "after",
    });
    expect(resolveSplitPlacementFromZone("top")).toEqual({
      direction: "vertical",
      position: "before",
    });
    expect(resolveSplitPlacementFromZone("bottom")).toEqual({
      direction: "vertical",
      position: "after",
    });

    for (const zone of ["left", "right", "top", "bottom", "center"] as const) {
      const overlay = resolveDropPreviewOverlayClass(zone);
      expect(overlay).toContain("rounded-none");
      expect(overlay).toContain("border-primary/75");
      expect(overlay).toContain("bg-primary/14");
      expect(resolveDropZoneLabel(zone).length).toBeGreaterThan(0);
    }
    expect(resolveDropPreviewOverlayClass("left")).toContain("left-0 right-1/2");
    expect(resolveDropPreviewOverlayClass("right")).toContain("left-1/2 right-0");
    expect(resolveDropPreviewOverlayClass("top")).toContain("top-0 bottom-1/2");
    expect(resolveDropPreviewOverlayClass("bottom")).toContain("top-1/2 bottom-0");
    expect(resolveDropPreviewOverlayClass("center")).toContain("inset-0");
  });

  it("serializes, parses, and round-trips all 4 SplitDragPayload kinds and legacy pane-tab MIME", () => {
    const payloads: SplitDragPayload[] = [
      {
        kind: "sidebar-thread",
        environmentId: ENV_LOCAL,
        threadId: THREAD_A,
        title: "修复登录态",
        providerId: "claudeAgent",
        instanceId: ProviderInstanceId.make("claudeAgent"),
      },
      {
        kind: "right-panel-tab",
        surfaceId: "file:src/validators.ts",
        surfaceKind: "file",
        title: "validators.ts",
        hostThreadRef: { environmentId: ENV_LOCAL, threadId: THREAD_A },
        resourceId: "src/validators.ts",
        relativePath: "src/validators.ts",
      },
      {
        kind: "bottom-panel-tab",
        terminalId: "term-1",
        title: "PowerShell",
        hostThreadRef: { environmentId: ENV_LOCAL, threadId: THREAD_A },
      },
      {
        kind: "pane-tab",
        tabId: "tab-42",
        fromPaneId: "pane-main",
      },
    ];

    for (const payload of payloads) {
      const bag = new Map<string, string>();
      const fakeDt = {
        effectAllowed: "none" as DataTransfer["effectAllowed"],
        setData: (type: string, value: string) => {
          bag.set(type, value);
        },
        getData: (type: string) => bag.get(type) ?? "",
      };
      writeSplitDragDataTransfer(fakeDt, payload);
      expect(hasSplitDragMime([...bag.keys()])).toBe(true);
      expect(readSplitDragDataTransfer(fakeDt)).toMatchObject(payload);
      expect(parseSplitDragPayload(serializeSplitDragPayload(payload))).toMatchObject(payload);
    }

    // Backwards compatibility with legacy WORKSPACE_TAB_DRAG_MIME payloads
    expect(
      parseSplitDragPayload(JSON.stringify({ tabId: "tab-legacy", fromPaneId: "pane-1" })),
    ).toEqual({
      kind: "pane-tab",
      tabId: "tab-legacy",
      fromPaneId: "pane-1",
    });
    expect(hasSplitDragMime([WORKSPACE_TAB_DRAG_MIME])).toBe(true);
    expect(hasSplitDragMime([PRISMUX_SPLIT_ITEM_MIME])).toBe(true);
    expect(hasSplitDragMime(["text/plain"])).toBe(false);
    expect(parseSplitDragPayload("{bad json")).toBeNull();
  });

  it("maps every right-panel surface kind cleanly onto WorkspaceTabKind inputs", () => {
    expect(mapRightPanelSurfaceKindToTabKind("terminal")).toBe("terminal");
    expect(mapRightPanelSurfaceKindToTabKind("diff")).toBe("diff");
    expect(mapRightPanelSurfaceKindToTabKind("preview")).toBe("browser");
    expect(mapRightPanelSurfaceKindToTabKind("files")).toBe("files");
    expect(mapRightPanelSurfaceKindToTabKind("file")).toBe("files");
    expect(mapRightPanelSurfaceKindToTabKind("pull-requests")).toBe("related");
    expect(mapRightPanelSurfaceKindToTabKind("issue")).toBe("related");
    expect(mapRightPanelSurfaceKindToTabKind("device")).toBe("device");
    expect(mapRightPanelSurfaceKindToTabKind("thread")).toBe("side-chat");
    expect(mapRightPanelSurfaceKindToTabKind("side-chat-empty")).toBe("side-chat");

    const fileInput = buildOpenTabInputFromSplitPayload(
      {
        kind: "right-panel-tab",
        surfaceId: "file:src/validators.ts",
        surfaceKind: "file",
        title: "validators.ts",
        hostThreadRef: null,
        relativePath: "src/validators.ts",
      },
      { environmentId: ENV_LOCAL, threadId: THREAD_A },
    );
    expect(fileInput).toMatchObject({
      kind: "files",
      title: "validators.ts",
      resourceId: "src/validators.ts",
      environmentId: ENV_LOCAL,
      threadId: THREAD_A,
    });
  });

  it("clamps live split resize ratios with min-pane pixel guardrails", () => {
    // 1000px container -> 180px min = 0.18..0.82
    expect(computeClampedSplitRatio(500, 1000)).toBe(0.5);
    expect(computeClampedSplitRatio(50, 1000)).toBe(0.18);
    expect(computeClampedSplitRatio(980, 1000)).toBe(0.82);

    // 500px container -> 180px min = 0.36..0.64 so neither pane collapses below 180px
    expect(computeClampedSplitRatio(100, 500)).toBeCloseTo(0.36, 4);
    expect(computeClampedSplitRatio(450, 500)).toBeCloseTo(0.64, 4);

    // Invalid totals safely preserve fallback ratio
    expect(computeClampedSplitRatio(100, 0, { fallbackRatio: 0.42 })).toBe(0.42);
  });

  it("propagates {top, right, bottom, left} outer-edge flags through a 2x2 grid with zero interior border-radius", () => {
    const grid2x2: WorkspaceSplitLayoutNode = {
      type: "split",
      id: "split-root",
      direction: "vertical",
      ratio: 0.5,
      first: {
        type: "split",
        id: "split-top",
        direction: "horizontal",
        ratio: 0.5,
        first: { type: "leaf", paneId: "tl" },
        second: { type: "leaf", paneId: "tr" },
      },
      second: {
        type: "split",
        id: "split-bottom",
        direction: "horizontal",
        ratio: 0.5,
        first: { type: "leaf", paneId: "bl" },
        second: { type: "leaf", paneId: "br" },
      },
    };

    const edgeMap = computePaneEdgesMap(grid2x2);
    expect(edgeMap).toEqual({
      tl: { top: true, right: false, bottom: false, left: true },
      tr: { top: true, right: true, bottom: false, left: false },
      bl: { top: false, right: false, bottom: true, left: true },
      br: { top: false, right: true, bottom: true, left: false },
    });

    // Only the 1 outer corner per quadrant gets radius; all 3 interior corners (including the 2x2 center cross) are strictly rounded-*-none!
    expect(resolvePaneBodyCornerClasses(edgeMap.tl!, true)).toBe(
      "rounded-tl-[var(--pmx-inner-stage-radius,14px)] rounded-tr-none rounded-bl-none rounded-br-none",
    );
    expect(resolvePaneBodyCornerClasses(edgeMap.tr!, true)).toBe(
      "rounded-tl-none rounded-tr-[var(--pmx-inner-stage-radius,14px)] rounded-bl-none rounded-br-none",
    );
    expect(resolvePaneBodyCornerClasses(edgeMap.bl!, true)).toBe(
      "rounded-tl-none rounded-tr-none rounded-bl-[var(--pmx-inner-stage-radius,14px)] rounded-br-none",
    );
    expect(resolvePaneBodyCornerClasses(edgeMap.br!, true)).toBe(
      "rounded-tl-none rounded-tr-none rounded-bl-none rounded-br-[var(--pmx-inner-stage-radius,14px)]",
    );

    // Interior borders stay strictly border-*-0 so SplitResizeHandle draws the single crisp 1px hairline.
    expect(resolvePaneOuterBorderClasses(edgeMap.tl!, true)).toContain("border-r-0");
    expect(resolvePaneOuterBorderClasses(edgeMap.tl!, true)).toContain("border-b-0");
    expect(resolvePaneOuterBorderClasses(edgeMap.br!, true)).toContain("border-t-0");
    expect(resolvePaneOuterBorderClasses(edgeMap.br!, true)).toContain("border-l-0");

    // Completely interior middle column pane has all 4 corners strictly rounded-*-none.
    const hSplit = deriveChildSplitEdges(ROOT_SPLIT_PANE_EDGES, "horizontal");
    const middlePaneEdges = deriveChildSplitEdges(hSplit.second, "horizontal").first;
    expect(middlePaneEdges).toEqual({ top: true, right: false, bottom: true, left: false });
    expect(resolvePaneBodyCornerClasses(middlePaneEdges, true)).toBe(
      "rounded-tl-none rounded-tr-none rounded-bl-none rounded-br-none",
    );
  });

  it("renders PrismuxStageFrame strictly flat (rounded-none border-0, zero concave corners) inside a split pane", () => {
    const splitHtml = renderToStaticMarkup(
      createElement(
        WorkspaceSplitPaneContext.Provider,
        {
          value: { inSplit: true, edges: { top: true, right: false, bottom: false, left: true } },
        },
        createElement(PrismuxStageFrame, null, createElement("div", null, "Quadrant Content")),
      ),
    );

    expect(splitHtml).toContain('data-pmx-split-flat="1"');
    expect(splitHtml).toContain('data-pmx-glass-zone="mainCanvas"');
    expect(splitHtml).toContain("rounded-none border-0");
    expect(splitHtml).not.toContain('data-pmx-stage-frame="1"');
    expect(splitHtml).not.toContain("data-pmx-stage-corner");
    expect(splitHtml).not.toContain('data-pmx-right-frame-edge="1"');
  });

  it("verifies index.css appends WebView/iframe/canvas pointer-events shield without altering sidebar sky backdrop", () => {
    const workspaceDir = NodePath.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    );
    const indexCss = NodeFS.readFileSync(NodePath.resolve(workspaceDir, "../../index.css"), "utf8");
    expect(indexCss).toContain('[data-workspace-dragging="1"] :is(webview, iframe, canvas)');
    expect(indexCss).toContain('[data-workspace-resizing="1"] :is(webview, iframe, canvas)');
    expect(indexCss).toContain("pointer-events: none !important;");
    expect(indexCss).toContain("@utility sidebar-stage-backdrop");
    expect(PRISMUX_SPLIT_DRAG_EVENT).toBe("prismux:split-drag");
  });

  it("verifies RightPanelTabs and ThreadTerminalDrawer wire Split Anything drag-out attributes cleanly", () => {
    const workspaceDir = NodePath.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    );
    const rightPanelSource = NodeFS.readFileSync(
      NodePath.resolve(workspaceDir, "../RightPanelTabs.tsx"),
      "utf8",
    );
    expect(rightPanelSource).toContain("data-right-panel-draggable-tab");
    expect(rightPanelSource).toContain("writeSplitDragDataTransfer");
    expect(rightPanelSource).toContain("dispatchSplitDragEvent");
    expect(rightPanelSource).toContain("formatBrowserProfileLabel");
    expect(rightPanelSource).toContain("resolveBrowserProfileBadgeLabel");

    const terminalDrawerSource = NodeFS.readFileSync(
      NodePath.resolve(workspaceDir, "../ThreadTerminalDrawer.tsx"),
      "utf8",
    );
    expect(terminalDrawerSource).toContain("data-terminal-drag-tab");
    expect(terminalDrawerSource).toContain("data-terminal-drag-handle");
    expect(terminalDrawerSource).toContain("writeSplitDragDataTransfer");
    expect(terminalDrawerSource).toContain("dispatchSplitDragEvent");
  });
});

describe("workspaceTabsStore — Orca Split Anything recursive 2x2 & 8-pane behavior", () => {
  beforeEach(() => {
    useWorkspaceTabsStore.getState().resetWorkspace();
  });

  it("supports splitLeafNode with position before and after", () => {
    const leaf: WorkspaceSplitLayoutNode = { type: "leaf", paneId: "p1" };

    const after = splitLeafNode(leaf, "p1", "p2", "horizontal", "s1", 0.5, "after");
    expect(after.replaced).toBe(true);
    expect(listLeafPaneIds(after.node)).toEqual(["p1", "p2"]);

    const before = splitLeafNode(leaf, "p1", "p0", "horizontal", "s0", 0.5, "before");
    expect(before.replaced).toBe(true);
    expect(listLeafPaneIds(before.node)).toEqual(["p0", "p1"]);
  });

  it("builds a full Orca 2x2 grid (Agent + Browser + Terminal + Files/Diff) via dropItemIntoPane, supports before/after, and double-click resets ratio to 0.5", () => {
    const store = useWorkspaceTabsStore.getState();
    store.openTab({
      kind: "thread",
      title: "Claude",
      providerId: "claudeAgent",
      environmentId: ENV_LOCAL,
      threadId: THREAD_A,
    });

    // 1. Drop right-panel Browser onto RIGHT edge of main pane -> 1x2 horizontal split
    const browserDrop = store.dropItemIntoPane(
      {
        kind: "right-panel-tab",
        surfaceId: "browser:checkout",
        surfaceKind: "preview",
        title: "Checkout",
        hostThreadRef: { environmentId: ENV_LOCAL, threadId: THREAD_A },
        resourceId: "checkout-tab",
        url: "http://localhost:3000/checkout",
      },
      DEFAULT_PRIMARY_PANE_ID,
      "right",
    );
    expect(browserDrop).toBeTruthy();
    expect(countLeafPanes(useWorkspaceTabsStore.getState().layout)).toBe(2);

    // 2. Drop bottom-panel Terminal onto BOTTOM edge of main pane
    const terminalDrop = store.dropItemIntoPane(
      {
        kind: "bottom-panel-tab",
        terminalId: "term-dev",
        title: "Terminal",
        hostThreadRef: { environmentId: ENV_LOCAL, threadId: THREAD_A },
      },
      DEFAULT_PRIMARY_PANE_ID,
      "bottom",
    );
    expect(terminalDrop).toBeTruthy();
    expect(countLeafPanes(useWorkspaceTabsStore.getState().layout)).toBe(3);

    // 3. Drop right-panel File onto BOTTOM edge of browser pane -> complete 2x2 grid!
    const fileDrop = store.dropItemIntoPane(
      {
        kind: "right-panel-tab",
        surfaceId: "file:src/validators.ts",
        surfaceKind: "file",
        title: "validators.ts",
        hostThreadRef: { environmentId: ENV_LOCAL, threadId: THREAD_A },
        relativePath: "src/validators.ts",
      },
      browserDrop!.paneId,
      "bottom",
    );
    expect(fileDrop).toBeTruthy();

    const state2x2 = useWorkspaceTabsStore.getState();
    expect(countLeafPanes(state2x2.layout)).toBe(4);
    expect(state2x2.tabs[browserDrop!.tabId]?.kind).toBe("browser");
    expect(state2x2.tabs[terminalDrop!.tabId]?.kind).toBe("terminal");
    expect(state2x2.tabs[fileDrop!.tabId]?.kind).toBe("files");
    expect(state2x2.activeDrag).toBeNull();

    // Verify 2x2 edge flags have zero interior corner overlaps
    const edges = computePaneEdgesMap(state2x2.layout);
    expect(edges[DEFAULT_PRIMARY_PANE_ID]).toEqual({
      top: true,
      right: false,
      bottom: false,
      left: true,
    });
    expect(edges[browserDrop!.paneId]).toEqual({
      top: true,
      right: true,
      bottom: false,
      left: false,
    });
    expect(edges[terminalDrop!.paneId]).toEqual({
      top: false,
      right: false,
      bottom: true,
      left: true,
    });
    expect(edges[fileDrop!.paneId]).toEqual({
      top: false,
      right: true,
      bottom: true,
      left: false,
    });

    // Resize root split ratio and double-click reset back to 0.5
    expect(state2x2.layout.type).toBe("split");
    if (state2x2.layout.type === "split") {
      const rootSplitId = state2x2.layout.id;
      store.setSplitRatio(rootSplitId, 0.72);
      const resized = useWorkspaceTabsStore.getState().layout;
      expect(resized.type === "split" ? resized.ratio : 0).toBe(0.72);

      store.resetSplitRatio(rootSplitId);
      const reset = useWorkspaceTabsStore.getState().layout;
      expect(reset.type === "split" ? reset.ratio : 0).toBe(0.5);
    }

    // 4. Drop sidebar thread onto LEFT edge of main pane -> inserts BEFORE main pane!
    const leftDrop = store.dropItemIntoPane(
      {
        kind: "sidebar-thread",
        environmentId: ENV_LOCAL,
        threadId: THREAD_B,
        title: "Codex Worker",
        providerId: "codex",
      },
      DEFAULT_PRIMARY_PANE_ID,
      "left",
    );
    expect(leftDrop).toBeTruthy();
    const leafIds = listLeafPaneIds(useWorkspaceTabsStore.getState().layout);
    expect(leafIds.indexOf(leftDrop!.paneId)).toBeLessThan(
      leafIds.indexOf(DEFAULT_PRIMARY_PANE_ID),
    );

    // 5. Drop sidebar thread onto CENTER of browser pane -> merges as a new tab without creating a 6th pane
    const mergedDrop = store.dropItemIntoPane(
      {
        kind: "sidebar-thread",
        environmentId: ENV_LOCAL,
        threadId: THREAD_C,
        title: "Side Thread",
        providerId: "antigravity",
      },
      browserDrop!.paneId,
      "center",
    );
    expect(mergedDrop?.paneId).toBe(browserDrop!.paneId);
    expect(countLeafPanes(useWorkspaceTabsStore.getState().layout)).toBe(5);
    expect(useWorkspaceTabsStore.getState().panes[browserDrop!.paneId]?.tabIds).toContain(
      mergedDrop!.tabId,
    );
  });

  it("handles cross-pane pane-tab drop onto edge by moving tab into new split and collapsing emptied source pane", () => {
    const store = useWorkspaceTabsStore.getState();
    store.openTab({
      kind: "thread",
      title: "Main",
      environmentId: ENV_LOCAL,
      threadId: THREAD_A,
    });
    const rightPaneId = store.splitPane(DEFAULT_PRIMARY_PANE_ID, "horizontal", {
      kind: "diff",
      title: "Diff",
    })!;
    const rightTabId = useWorkspaceTabsStore.getState().panes[rightPaneId]!.activeTabId!;

    // Drag the sole tab from rightPane onto the TOP edge of primary pane -> converts horizontal split into vertical split (top=Diff, bottom=Main)
    const moved = store.dropItemIntoPane(
      { kind: "pane-tab", tabId: rightTabId, fromPaneId: rightPaneId },
      DEFAULT_PRIMARY_PANE_ID,
      "top",
    );
    expect(moved).toBeTruthy();
    const state = useWorkspaceTabsStore.getState();
    expect(countLeafPanes(state.layout)).toBe(2);
    expect(state.panes[rightPaneId]).toBeUndefined();
    expect(state.layout.type).toBe("split");
    if (state.layout.type === "split") {
      expect(state.layout.direction).toBe("vertical");
      expect(listLeafPaneIds(state.layout)).toEqual([moved!.paneId, DEFAULT_PRIMARY_PANE_ID]);
    }
    expect(state.focusedPaneId).toBe(moved!.paneId);
  });

  it("keeps activeDrag and isResizingSplit strictly transient (excluded from partialize)", () => {
    const store = useWorkspaceTabsStore.getState();
    store.setActiveDrag({
      kind: "sidebar-thread",
      environmentId: ENV_LOCAL,
      threadId: THREAD_A,
      title: "Dragging Thread",
    });
    store.setIsResizingSplit(true);

    expect(useWorkspaceTabsStore.getState().activeDrag?.kind).toBe("sidebar-thread");
    expect(useWorkspaceTabsStore.getState().isResizingSplit).toBe(true);

    const partialize = useWorkspaceTabsStore.persist.getOptions().partialize!;
    const persisted = partialize(useWorkspaceTabsStore.getState()) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty("activeDrag");
    expect(persisted).not.toHaveProperty("isResizingSplit");

    store.resetWorkspace();
    expect(useWorkspaceTabsStore.getState().activeDrag).toBeNull();
    expect(useWorkspaceTabsStore.getState().isResizingSplit).toBe(false);
  });
});
