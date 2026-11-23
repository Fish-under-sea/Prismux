import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER,
  loadRightPanelActivityOrder,
  moveStripActivityItems,
  normalizeRightPanelActivityOrder,
  partitionActivityBarOverflow,
  reorderRightPanelActivityItems,
  resolveRightPanelActivityBarLayout,
  RIGHT_PANEL_ACTIVITY_ORDER_STORAGE_KEY,
  saveRightPanelActivityOrder,
  useRightPanelStore,
  type ActivityOrderStorageLike,
} from "../../rightPanelStore";

function createMemoryStorage(): ActivityOrderStorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

beforeEach(() => {
  useRightPanelStore.getState().resetActivityBarOrder();
  useRightPanelStore.setState({
    pendingMobileSimulatorPresetId: null,
    mobileSimulatorLaunchSeq: 0,
  });
});

describe("RightPanel Activity Bar drag-reorder persistence & overflow", () => {
  it("reorders surface shortcuts immutably and persists across reloads", () => {
    const storage = createMemoryStorage();
    const initial = loadRightPanelActivityOrder(storage);
    expect(initial).toEqual([...DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER]);

    const reordered = reorderRightPanelActivityItems(initial, "wallpaper", "mobile-simulator");
    expect(reordered[0]).toBe("wallpaper");
    expect(reordered[1]).toBe("mobile-simulator");

    saveRightPanelActivityOrder(reordered, storage);
    const reloaded = loadRightPanelActivityOrder(storage);
    expect(reloaded).toEqual(reordered);
  });

  it("normalizes partial/unknown persisted orders by stripping invalid entries and appending missing defaults", () => {
    const normalized = normalizeRightPanelActivityOrder([
      "terminal",
      "unknown-kind",
      "wallpaper",
      "terminal",
    ]);
    expect(normalized.slice(0, 2)).toEqual(["terminal", "wallpaper"]);
    expect(normalized).toHaveLength(DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER.length);
    expect(new Set(normalized).size).toBe(DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER.length);
  });

  it("persists store reorderActivityBar into localStorage and supports reset", () => {
    useRightPanelStore.getState().reorderActivityBar("files", "mobile-simulator");
    expect(useRightPanelStore.getState().activityBarOrder[0]).toBe("files");

    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem(RIGHT_PANEL_ACTIVITY_ORDER_STORAGE_KEY);
      expect(saved).not.toBeNull();
      expect(JSON.parse(saved!)[0]).toBe("files");
    }

    useRightPanelStore.getState().resetActivityBarOrder();
    expect(useRightPanelStore.getState().activityBarOrder).toEqual([
      ...DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER,
    ]);
  });

  it("partitions overflowing Activity Bar items cleanly on narrow widths", () => {
    const all = [...DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER];
    expect(partitionActivityBarOverflow(all, 600, 68, 30)).toEqual({
      visible: all,
      overflow: [],
    });

    const narrow = partitionActivityBarOverflow(all, 210, 68, 30);
    // (210 - 30) / 68 = 2 visible items, rest overflow into More dropdown.
    expect(narrow.visible).toEqual(all.slice(0, 2));
    expect(narrow.overflow).toEqual(all.slice(2));
  });

  it("manages one-click Phone Simulator launch intent cleanly", () => {
    expect(useRightPanelStore.getState().consumeMobileSimulatorLaunch()).toBeNull();
    useRightPanelStore.getState().requestMobileSimulatorLaunch();
    expect(useRightPanelStore.getState().mobileSimulatorLaunchSeq).toBe(1);
    expect(useRightPanelStore.getState().consumeMobileSimulatorLaunch()).toBe("iphone-16-pro");
    expect(useRightPanelStore.getState().consumeMobileSimulatorLaunch()).toBeNull();
  });

  it("applies Orca two-stage compact-before-overflow layout and preserves strip slots on drag", () => {
    const items = [
      { id: "mobile-simulator" as const, label: "手机模拟", active: true },
      { id: "preview" as const, label: "Browser", active: false },
      { id: "wallpaper" as const, label: "壁纸", active: false },
      { id: "diff" as const, label: "Diff", active: false },
      { id: "terminal" as const, label: "Terminal", active: false },
      { id: "device" as const, label: "Device", active: false },
      { id: "files" as const, label: "Files", active: false },
    ];

    // Stage 1: Wide strip keeps every tab labeled with 0 compact & 0 overflow.
    const wide = resolveRightPanelActivityBarLayout(items, 720);
    expect(wide.visible).toHaveLength(7);
    expect(wide.overflow).toHaveLength(0);
    expect(wide.compactIds.size).toBe(0);

    // Stage 2: Medium strip compacts non-active items to icon-only before spilling into More.
    const medium = resolveRightPanelActivityBarLayout(items, 280);
    expect(medium.visible).toHaveLength(7);
    expect(medium.overflow).toHaveLength(0);
    expect(medium.compactIds.has("mobile-simulator")).toBe(false);
    expect(medium.compactIds.has("wallpaper")).toBe(true);

    // Stage 3: Narrow strip pins active item + More trigger, spilling tail items to overflow.
    const narrow = resolveRightPanelActivityBarLayout(items, 180);
    expect(narrow.visible.some((item) => item.id === "mobile-simulator")).toBe(true);
    expect(narrow.overflow.length).toBeGreaterThan(0);

    // Dragging inside visible strip never pushes another strip tab into overflow.
    const stripIds = new Set(narrow.visible.map((item) => item.id));
    if (narrow.visible.length >= 2) {
      const moved = moveStripActivityItems(
        [...DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER],
        stripIds,
        narrow.visible[1]!.id,
        narrow.visible[0]!.id,
      );
      expect(moved).not.toBeNull();
      expect(moved![0]).toBe(narrow.visible[1]!.id);
    }
  });
});
