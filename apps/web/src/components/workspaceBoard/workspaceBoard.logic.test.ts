// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import type { SidebarStorageLike } from "../sidebar/prismuxSidebarQuickNav.logic";
import {
  buildWorkspaceBoardProjection,
  DEFAULT_WORKSPACE_BOARD_STATE,
  EMPTY_WORKSPACE_BOARD_FILTERS,
  getWorkspaceBoardCopy,
  inferWorkspaceBoardLane,
  moveWorkspaceCardToLane,
  pinWorkspaceCard,
  readWorkspaceBoardState,
  resetWorkspaceLaneOverrides,
  resolveWorkspaceBoardLaneDisplay,
  togglePinWorkspaceCard,
  unpinWorkspaceCard,
  WORKSPACE_BOARD_LANE_ORDER,
  WORKSPACE_BOARD_LANES,
  WORKSPACE_BOARD_STORAGE_KEY,
  writeWorkspaceBoardState,
  type WorkspaceBoardCardInput,
} from "./workspaceBoard.logic";

function createMemoryStorage(): SidebarStorageLike & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function makeCard(overrides: Partial<WorkspaceBoardCardInput> & { readonly key: string }): WorkspaceBoardCardInput {
  return {
    environmentId: "env-1",
    threadId: overrides.key,
    projectKey: "env-1:proj-1",
    projectTitle: "Prismux",
    environmentLabel: "Local",
    title: `Thread ${overrides.key}`,
    branch: "main",
    modelName: "claude-sonnet-4-6",
    updatedAt: "2026-11-24T10:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    pinnedAt: null,
    isRunning: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    hasPendingBackgroundTasks: false,
    pullRequestsCount: 0,
    ...overrides,
  };
}

describe("Orca-aligned Workspace Board 4-column logic", () => {
  it("defines the exact 4 Orca lanes in order with Chinese primary + English secondary bilingual headers", () => {
    expect([...WORKSPACE_BOARD_LANE_ORDER]).toEqual([
      "todo",
      "in-progress",
      "in-review",
      "done",
    ]);
    expect(WORKSPACE_BOARD_LANES.map((lane) => lane.label)).toEqual([
      "Todo",
      "In progress",
      "In review",
      "Done",
    ]);
    expect(WORKSPACE_BOARD_LANES.map((lane) => lane.zhLabel)).toEqual([
      "待办",
      "进行中",
      "评审中",
      "已完成",
    ]);
    expect(
      WORKSPACE_BOARD_LANES.map((lane) => resolveWorkspaceBoardLaneDisplay(lane, true)),
    ).toEqual([
      { primary: "待办", secondary: "Todo", accessibleLabel: "待办 Todo" },
      { primary: "进行中", secondary: "In progress", accessibleLabel: "进行中 In progress" },
      { primary: "评审中", secondary: "In review", accessibleLabel: "评审中 In review" },
      { primary: "已完成", secondary: "Done", accessibleLabel: "已完成 Done" },
    ]);
    expect(
      WORKSPACE_BOARD_LANES.map((lane) => resolveWorkspaceBoardLaneDisplay(lane, false)),
    ).toEqual([
      { primary: "Todo", secondary: null, accessibleLabel: "Todo" },
      { primary: "In progress", secondary: null, accessibleLabel: "In progress" },
      { primary: "In review", secondary: null, accessibleLabel: "In review" },
      { primary: "Done", secondary: null, accessibleLabel: "Done" },
    ]);

    const boardDir = NodePath.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    );
    const pageSrc = NodeFS.readFileSync(NodePath.join(boardDir, "WorkspaceBoardPage.tsx"), "utf8");
    expect(pageSrc).toContain("text-[13px] font-semibold text-foreground");
    expect(pageSrc).toContain("text-[11px] font-normal text-muted-foreground/55");

    expect(getWorkspaceBoardCopy("zh").pinnedDropHint).toBe(
      "拖放到此处即可固定，无需更改状态。",
    );
    expect(getWorkspaceBoardCopy("en").pinnedDropHint).toBe(
      "Drop here to pin without changing status.",
    );
  });

  it("infers default lane automatically from real thread runtime, approval/PR, and settled state", () => {
    expect(inferWorkspaceBoardLane(makeCard({ key: "t-todo" }))).toBe("todo");
    expect(inferWorkspaceBoardLane(makeCard({ key: "t-run", isRunning: true }))).toBe(
      "in-progress",
    );
    expect(
      inferWorkspaceBoardLane(makeCard({ key: "t-bg", hasPendingBackgroundTasks: true })),
    ).toBe("in-progress");
    expect(
      inferWorkspaceBoardLane(makeCard({ key: "t-approval", hasPendingApprovals: true })),
    ).toBe("in-review");
    expect(
      inferWorkspaceBoardLane(makeCard({ key: "t-pr", pullRequestsCount: 1, isRunning: false })),
    ).toBe("in-review");
    expect(
      inferWorkspaceBoardLane(makeCard({ key: "t-done", settledOverride: "settled" })),
    ).toBe("done");
    expect(
      inferWorkspaceBoardLane(
        makeCard({ key: "t-archived", archivedAt: "2026-11-24T09:00:00.000Z" }),
      ),
    ).toBe("done");
  });

  it("pins and unpins cards without changing their status lane, and moves cards across lanes cleanly", () => {
    const cards = [
      makeCard({ key: "c1", title: "Glass polish", isRunning: true, updatedAt: "2026-11-24T11:00:00.000Z" }),
      makeCard({ key: "c2", title: "Fix auth", branch: "feat/auth", updatedAt: "2026-11-24T10:30:00.000Z" }),
      makeCard({ key: "c3", title: "Review PR", pullRequestsCount: 1, updatedAt: "2026-11-24T09:30:00.000Z" }),
      makeCard({ key: "c4", title: "Shipped release", settledAt: "2026-11-24T08:00:00.000Z", updatedAt: "2026-11-24T08:00:00.000Z" }),
    ];

    // Pin c1 without changing its lane (`in-progress`).
    let state = pinWorkspaceCard(DEFAULT_WORKSPACE_BOARD_STATE, "c1");
    let projection = buildWorkspaceBoardProjection(cards, state, EMPTY_WORKSPACE_BOARD_FILTERS);
    expect(projection.pinnedCards.map((c) => c.key)).toEqual(["c1"]);
    expect(projection.lanes["in-progress"].map((c) => c.key)).toEqual(["c1"]);
    expect(state.laneOverrides).toEqual({});

    // Move c2 from `todo` -> `in-review`; c1 stays pinned in `in-progress`.
    state = moveWorkspaceCardToLane(state, "c2", "in-review");
    projection = buildWorkspaceBoardProjection(cards, state, EMPTY_WORKSPACE_BOARD_FILTERS);
    expect(projection.lanes.todo).toHaveLength(0);
    expect(projection.lanes["in-review"].map((c) => c.key)).toEqual(["c2", "c3"]);
    expect(projection.pinnedCards.map((c) => c.key)).toEqual(["c1"]);

    // Toggle unpin c1 and verify lane remains unchanged.
    state = togglePinWorkspaceCard(state, "c1", true);
    projection = buildWorkspaceBoardProjection(cards, state, EMPTY_WORKSPACE_BOARD_FILTERS);
    expect(projection.pinnedCards).toHaveLength(0);
    expect(projection.lanes["in-progress"].map((c) => c.key)).toEqual(["c1"]);

    // Unpinning a server-pinned card records an explicit unpin entry.
    const serverPinned = [makeCard({ key: "c-srv", pinnedAt: "2026-11-24T07:00:00.000Z" })];
    const unpinnedState = unpinWorkspaceCard(DEFAULT_WORKSPACE_BOARD_STATE, "c-srv");
    expect(
      buildWorkspaceBoardProjection(serverPinned, unpinnedState, EMPTY_WORKSPACE_BOARD_FILTERS)
        .pinnedCards,
    ).toHaveLength(0);

    // Resetting manual lane overrides restores c2 to `todo` while keeping pin preferences.
    const reset = resetWorkspaceLaneOverrides(state);
    expect(
      buildWorkspaceBoardProjection(cards, reset, EMPTY_WORKSPACE_BOARD_FILTERS).lanes.todo.map(
        (c) => c.key,
      ),
    ).toEqual(["c2"]);
  });

  it("filters cards by keyword, project, pinnedOnly, and activeOnly while preserving unfiltered lane totals", () => {
    const cards = [
      makeCard({ key: "a", title: "Wallpaper shader", projectKey: "p1", projectTitle: "Prismux", isRunning: true }),
      makeCard({ key: "b", title: "Tray menu", projectKey: "p2", projectTitle: "Desktop", branch: "fix/tray" }),
    ];
    const state = pinWorkspaceCard(DEFAULT_WORKSPACE_BOARD_STATE, "b");

    const byQuery = buildWorkspaceBoardProjection(cards, state, {
      ...EMPTY_WORKSPACE_BOARD_FILTERS,
      query: "fix/tray",
    });
    expect(byQuery.isFiltering).toBe(true);
    expect(byQuery.matchCount).toBe(1);
    expect(byQuery.totalCount).toBe(2);
    expect(byQuery.lanes.todo.map((c) => c.key)).toEqual(["b"]);
    expect(byQuery.laneTotals["in-progress"]).toBe(1);

    const byActive = buildWorkspaceBoardProjection(cards, state, {
      ...EMPTY_WORKSPACE_BOARD_FILTERS,
      activeOnly: true,
    });
    expect(byActive.matchCount).toBe(1);
    expect(byActive.lanes["in-progress"].map((c) => c.key)).toEqual(["a"]);

    const byPinned = buildWorkspaceBoardProjection(cards, state, {
      ...EMPTY_WORKSPACE_BOARD_FILTERS,
      pinnedOnly: true,
    });
    expect(byPinned.matchCount).toBe(1);
    expect(byPinned.pinnedCards.map((c) => c.key)).toEqual(["b"]);
  });

  it("persists and restores board state safely from storage and rejects invalid lane ids", () => {
    const storage = createMemoryStorage();
    const initial = moveWorkspaceCardToLane(
      pinWorkspaceCard(
        { ...DEFAULT_WORKSPACE_BOARD_STATE, compactMode: true, showBranchBadge: false },
        "c1",
      ),
      "c1",
      "done",
    );
    writeWorkspaceBoardState(initial, storage);
    expect(storage.data.has(WORKSPACE_BOARD_STORAGE_KEY)).toBe(true);
    expect(readWorkspaceBoardState(storage)).toEqual(initial);

    // Corrupted/invalid lane overrides are pruned safely.
    storage.setItem(
      WORKSPACE_BOARD_STORAGE_KEY,
      JSON.stringify({
        laneOverrides: { valid: "in-review", bogus: "not-a-lane" },
        pinnedKeys: ["valid", 123],
      }),
    );
    expect(readWorkspaceBoardState(storage)).toEqual({
      laneOverrides: { valid: "in-review" },
      pinnedKeys: ["valid"],
      unpinnedKeys: [],
      compactMode: false,
      showBranchBadge: true,
    });
  });
});
