import { describe, expect, it, vi } from "vite-plus/test";

import {
  findWorkspaceListeningPorts,
  formatPortMicroBadgeLabel,
  nextToolbarFocusIndex,
  resolveAgentRuntimeLamp,
  resolvePrimaryPortUrl,
  resolveSidebarUtilityOverflow,
  resolveToolbarItemOwningFocus,
  SIDEBAR_LOW_HEIGHT_COMPACT_PX,
  SIDEBAR_UTILITY_ITEM_ATTR,
  SIDEBAR_VERY_LOW_HEIGHT_PX,
  stopActivationKeyPropagation,
} from "./sidebarMicroIndicators";

describe("left sidebar micro-indicators", () => {
  it("maps active Agent runtime statuses to running / approval / idle lamps", () => {
    expect(resolveAgentRuntimeLamp("working").state).toBe("running");
    expect(resolveAgentRuntimeLamp("preparing").state).toBe("running");
    expect(resolveAgentRuntimeLamp("approval").state).toBe("approval");
    expect(resolveAgentRuntimeLamp("input").state).toBe("approval");
    expect(resolveAgentRuntimeLamp("request").state).toBe("approval");
    expect(resolveAgentRuntimeLamp("done").state).toBe("idle");
    expect(resolveAgentRuntimeLamp(null).state).toBe("idle");
  });

  it("matches shared Daemon port scan results to workspace/worktree paths and formats compact badges", () => {
    const ports = [
      {
        port: 5173,
        pid: 1001,
        processName: "node.exe",
        host: "0.0.0.0",
        cwd: "D:\\Fish-code\\AGY\\Prismux\\vendor\\t3code\\apps\\web",
        scope: "workspace" as const,
        protected: false,
      },
      {
        port: 3001,
        pid: 1002,
        processName: "node.exe",
        host: "127.0.0.1",
        cwd: "D:/Fish-code/AGY/Prismux/apps/daemon",
        scope: "workspace" as const,
        protected: false,
      },
      {
        port: 9222,
        pid: 2000,
        processName: "chrome.exe",
        cwd: "C:\\Other",
        scope: "external" as const,
        protected: false,
      },
    ];

    const matched = findWorkspaceListeningPorts(ports, "D:\\Fish-code\\AGY\\Prismux");
    expect(matched.map((p) => p.port)).toEqual([3001, 5173]);
    expect(formatPortMicroBadgeLabel(matched)).toBe(":3001 +1");
    expect(resolvePrimaryPortUrl(matched)).toBe("http://127.0.0.1:3001");

    expect(formatPortMicroBadgeLabel([matched[0]!])).toBe(":3001");
    expect(formatPortMicroBadgeLabel([])).toBeNull();
  });

  it("folds sidebar footer navigation items into More menu when window height or width shrinks", () => {
    const items = ["settings", "wallpaper", "pull-requests", "issues", "usage"] as const;

    const tall = resolveSidebarUtilityOverflow(items, {
      viewportHeight: 900,
      containerWidth: 260,
    });
    expect(tall.collapsedByHeight).toBe(false);
    expect(tall.overflowIds).toEqual([]);
    expect(tall.visibleIds.size).toBe(5);

    const compactHeight = resolveSidebarUtilityOverflow(items, {
      viewportHeight: SIDEBAR_LOW_HEIGHT_COMPACT_PX - 20,
      containerWidth: 260,
    });
    expect(compactHeight.collapsedByHeight).toBe(true);
    expect([...compactHeight.visibleIds]).toEqual(["settings", "wallpaper"]);
    expect(compactHeight.overflowIds).toEqual(["pull-requests", "issues", "usage"]);

    const veryShort = resolveSidebarUtilityOverflow(items, {
      viewportHeight: SIDEBAR_VERY_LOW_HEIGHT_PX - 30,
      containerWidth: 260,
    });
    expect(veryShort.collapsedByHeight).toBe(true);
    expect([...veryShort.visibleIds]).toEqual(["settings"]);
    expect(veryShort.overflowIds).toEqual(["wallpaper", "pull-requests", "issues", "usage"]);

    const narrowWidth = resolveSidebarUtilityOverflow(items, {
      viewportHeight: 900,
      containerWidth: 160,
    });
    expect(narrowWidth.overflowIds.length).toBeGreaterThan(0);
  });

  it("computes WAI-ARIA APG roving focus indices and stops activation key propagation (Orca AppRail)", () => {
    expect(nextToolbarFocusIndex("ArrowRight", 0, 4, "horizontal")).toBe(1);
    expect(nextToolbarFocusIndex("ArrowRight", 3, 4, "horizontal")).toBe(0);
    expect(nextToolbarFocusIndex("ArrowLeft", 0, 4, "horizontal")).toBe(3);
    expect(nextToolbarFocusIndex("Home", 2, 4, "horizontal")).toBe(0);
    expect(nextToolbarFocusIndex("End", 1, 4, "horizontal")).toBe(3);
    expect(nextToolbarFocusIndex("ArrowDown", 0, 4, "horizontal")).toBeNull();
    expect(nextToolbarFocusIndex("ArrowDown", 0, 4, "vertical")).toBe(1);

    const stopEnter = vi.fn();
    stopActivationKeyPropagation({ key: "Enter", stopPropagation: stopEnter });
    expect(stopEnter).toHaveBeenCalledTimes(1);

    const stopEscape = vi.fn();
    stopActivationKeyPropagation({ key: "Escape", stopPropagation: stopEscape });
    expect(stopEscape).not.toHaveBeenCalled();
  });

  it("traces focus ownership across direct toolbar items and aria-labelledby portalled menus", () => {
    const ownedButton = {
      closest: (sel: string) => (sel === `[${SIDEBAR_UTILITY_ITEM_ATTR}]` ? ownedButton : null),
      getAttribute: (name: string) => (name === SIDEBAR_UTILITY_ITEM_ATTR ? "more" : null),
    } as unknown as Element;
    const toolbar = {
      contains: (node: unknown) => node === ownedButton,
    } as unknown as ParentNode;

    // Direct focus inside toolbar.
    expect(resolveToolbarItemOwningFocus(toolbar, ownedButton, null)).toBe("more");

    // Focus inside a portalled menu linked via aria-labelledby -> trigger button id.
    const menuPopup = {
      getAttribute: (name: string) => (name === "aria-labelledby" ? "more-trigger-id" : null),
    };
    const menuItem = {
      closest: (sel: string) => (sel === "[aria-labelledby]" ? menuPopup : null),
    } as unknown as Element;
    const doc = {
      getElementById: (id: string) => (id === "more-trigger-id" ? ownedButton : null),
    };

    expect(resolveToolbarItemOwningFocus(toolbar, menuItem, doc)).toBe("more");
  });
});
