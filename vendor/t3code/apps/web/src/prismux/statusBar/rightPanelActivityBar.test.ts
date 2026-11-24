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
  it("enforces the canonical 9-item order (PR -> 差异 -> 文件 -> 终端 -> 侧聊 -> 浏览器 -> 手机模拟 -> 已关联项 -> 壁纸) with zero device item", () => {
    expect([...DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER]).toEqual([
      "pull-request",
      "diff",
      "files",
      "terminal",
      "side-chat",
      "preview",
      "mobile-simulator",
      "pull-requests",
      "wallpaper",
    ]);
    expect(DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER).toHaveLength(9);
    expect(DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER as readonly string[]).not.toContain("device");
    expect(DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER as readonly string[]).not.toContain("devices");
  });

  it("reorders surface shortcuts immutably and persists across reloads", () => {
    const storage = createMemoryStorage();
    const initial = loadRightPanelActivityOrder(storage);
    expect(initial).toEqual([...DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER]);

    const reordered = reorderRightPanelActivityItems(initial, "wallpaper", "pull-request");
    expect(reordered[0]).toBe("wallpaper");
    expect(reordered[1]).toBe("pull-request");

    saveRightPanelActivityOrder(reordered, storage);
    const reloaded = loadRightPanelActivityOrder(storage);
    expect(reloaded).toEqual(reordered);
  });

  it("strips legacy device/devices entries and smoothly migrates v1/v2 default caches to canonical 9-item order", () => {
    // Old v2 6-item default cache seamlessly upgrades to the exact new 9-item order.
    const v2LegacyStorage = createMemoryStorage();
    v2LegacyStorage.setItem(
      "prismux.rightPanel.activityOrder.v2",
      JSON.stringify([
        "diff",
        "files",
        "terminal",
        "preview",
        "mobile-simulator",
        "wallpaper",
      ]),
    );
    expect(loadRightPanelActivityOrder(v2LegacyStorage)).toEqual([
      "pull-request",
      "diff",
      "files",
      "terminal",
      "side-chat",
      "preview",
      "mobile-simulator",
      "pull-requests",
      "wallpaper",
    ]);

    // Old v1 7-item default cache (with legacy device entry) seamlessly upgrades to 9-item order.
    const v1LegacyStorage = createMemoryStorage();
    v1LegacyStorage.setItem(
      "prismux.rightPanel.activityOrder.v1",
      JSON.stringify([
        "mobile-simulator",
        "preview",
        "wallpaper",
        "diff",
        "terminal",
        "device",
        "files",
      ]),
    );
    expect(loadRightPanelActivityOrder(v1LegacyStorage)).toEqual([
      "pull-request",
      "diff",
      "files",
      "terminal",
      "side-chat",
      "preview",
      "mobile-simulator",
      "pull-requests",
      "wallpaper",
    ]);

    // Custom partial order strips device/devices/unknown/duplicates and appends remaining canonical items.
    const normalized = normalizeRightPanelActivityOrder([
      "terminal",
      "device",
      "devices",
      "unknown-kind",
      "wallpaper",
      "terminal",
    ]);
    expect(normalized.slice(0, 2)).toEqual(["terminal", "wallpaper"]);
    expect(normalized).toHaveLength(9);
    expect(normalized as readonly string[]).not.toContain("device");
    expect(normalized as readonly string[]).not.toContain("devices");
    expect(new Set(normalized).size).toBe(9);
  });

  it("persists store reorderActivityBar into localStorage and supports reset", () => {
    useRightPanelStore.getState().reorderActivityBar("files", "pull-request");
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
    expect(partitionActivityBarOverflow(all, 700, 68, 30)).toEqual({
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

  it("applies Orca two-stage compact-before-overflow layout across all 9 canonical items and preserves strip slots on drag", () => {
    const items = [
      { id: "pull-request" as const, label: "PR", active: false },
      { id: "diff" as const, label: "差异", active: true },
      { id: "files" as const, label: "文件", active: false },
      { id: "terminal" as const, label: "终端", active: false },
      { id: "side-chat" as const, label: "侧聊", active: false },
      { id: "preview" as const, label: "浏览器", active: false },
      { id: "mobile-simulator" as const, label: "手机模拟", active: false },
      { id: "pull-requests" as const, label: "已关联项", active: false },
      { id: "wallpaper" as const, label: "壁纸", active: false },
    ];

    // Stage 1: Wide strip keeps all 9 tabs labeled with 0 compact & 0 overflow.
    const wide = resolveRightPanelActivityBarLayout(items, 640);
    expect(wide.visible).toHaveLength(9);
    expect(wide.overflow).toHaveLength(0);
    expect(wide.compactIds.size).toBe(0);

    // Stage 2: Default right-panel width (~360px) compacts non-active items to icon-only before spilling into More.
    const medium = resolveRightPanelActivityBarLayout(items, 360);
    expect(medium.visible).toHaveLength(9);
    expect(medium.overflow).toHaveLength(0);
    expect(medium.compactIds.has("diff")).toBe(false);
    expect(medium.compactIds.has("pull-request")).toBe(true);
    expect(medium.compactIds.has("side-chat")).toBe(true);
    expect(medium.compactIds.has("pull-requests")).toBe(true);
    expect(medium.compactIds.has("wallpaper")).toBe(true);

    // Stage 3: Narrow strip pins active item + More trigger, spilling tail items to overflow.
    const narrow = resolveRightPanelActivityBarLayout(items, 200);
    expect(narrow.visible.some((item) => item.id === "diff")).toBe(true);
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
