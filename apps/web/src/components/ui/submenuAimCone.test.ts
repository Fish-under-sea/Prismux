import { describe, expect, it, vi } from "vite-plus/test";

import {
  SUBMENU_AIM_DWELL_MS,
  createSubmenuAimController,
  getSubmenuNearEdgeCorners,
  isPointInAimTriangle,
  normalizeSubmenuSide,
  type RectLike,
} from "./submenuAimCone";

describe("submenuAimCone geometry", () => {
  it("detects interior, boundary, exterior, CW/CCW, and degenerate triangles accurately", () => {
    const vertex = { x: 100, y: 100 };
    const topCorner = { x: 200, y: 50 };
    const bottomCorner = { x: 200, y: 250 };

    // Inside triangle (diagonal path toward submenu)
    expect(isPointInAimTriangle({ x: 150, y: 120 }, vertex, topCorner, bottomCorner)).toBe(true);
    // Reverse winding order yields identical result
    expect(isPointInAimTriangle({ x: 150, y: 120 }, vertex, bottomCorner, topCorner)).toBe(true);
    // Boundary edge & vertex inclusive
    expect(isPointInAimTriangle({ x: 150, y: 75 }, vertex, topCorner, bottomCorner)).toBe(true);
    expect(isPointInAimTriangle(vertex, vertex, topCorner, bottomCorner)).toBe(true);
    // Outside triangle (moving straight down away from submenu)
    expect(isPointInAimTriangle({ x: 100, y: 180 }, vertex, topCorner, bottomCorner)).toBe(false);
    expect(isPointInAimTriangle({ x: 150, y: 30 }, vertex, topCorner, bottomCorner)).toBe(false);
    // Degenerate collinear triangle rejected safely
    expect(
      isPointInAimTriangle(
        { x: 150, y: 100 },
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 300, y: 100 },
      ),
    ).toBe(false);
  });

  it("resolves near-edge corners for right, left, bottom, and top submenu placements", () => {
    const submenu: RectLike = { left: 200, right: 360, top: 100, bottom: 260 };

    // Right placement (origin to the left of submenu)
    expect(getSubmenuNearEdgeCorners(submenu, { x: 120, y: 140 })).toEqual([
      { x: 200, y: 100 },
      { x: 200, y: 260 },
    ]);
    // Left placement (origin to the right of submenu)
    expect(getSubmenuNearEdgeCorners(submenu, { x: 420, y: 140 })).toEqual([
      { x: 360, y: 100 },
      { x: 360, y: 260 },
    ]);
    // Bottom placement (origin above submenu)
    expect(getSubmenuNearEdgeCorners(submenu, { x: 260, y: 60 })).toEqual([
      { x: 200, y: 100 },
      { x: 360, y: 100 },
    ]);
    // Top placement (origin below submenu)
    expect(getSubmenuNearEdgeCorners(submenu, { x: 260, y: 310 })).toEqual([
      { x: 200, y: 260 },
      { x: 360, y: 260 },
    ]);
    // Already inside submenu -> null
    expect(getSubmenuNearEdgeCorners(submenu, { x: 250, y: 150 })).toBeNull();

    // Base UI logical sides normalize cleanly
    expect(normalizeSubmenuSide("inline-end")).toBe("right");
    expect(normalizeSubmenuSide("inline-start")).toBe("left");
    expect(normalizeSubmenuSide("top")).toBe("top");
    expect(normalizeSubmenuSide("bottom")).toBe("bottom");
  });
});

describe("createSubmenuAimController state machine", () => {
  it("blocks sibling hover inside the triangle and switches after 300ms dwell", () => {
    vi.useFakeTimers();
    try {
      const controller = createSubmenuAimController();
      const submenu: RectLike = { left: 200, right: 360, top: 60, bottom: 260 };
      const onSwitch = vi.fn();

      // Mouse starts on trigger item
      controller.trackPointer({ x: 100, y: 100 }, "mouse");

      // Diagonal move crossing a sibling item inside the triangle toward right submenu
      const decision = controller.evaluateHover({
        pointerType: "mouse",
        point: { x: 150, y: 145 },
        submenuRect: submenu,
        preferredSide: "right",
        onSwitch,
      });

      expect(decision).toEqual({ blocked: true, reason: "inside-triangle" });
      expect(onSwitch).not.toHaveBeenCalled();
      expect(controller.hasPendingSwitch()).toBe(true);

      // At 299ms still held open
      vi.advanceTimersByTime(SUBMENU_AIM_DWELL_MS - 1);
      expect(onSwitch).not.toHaveBeenCalled();

      // At 300ms dwell expires and executes switch
      vi.advanceTimersByTime(1);
      expect(onSwitch).toHaveBeenCalledTimes(1);
      expect(controller.hasPendingSwitch()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels dwell timer and switches immediately when mouse exits the triangle", () => {
    vi.useFakeTimers();
    try {
      const controller = createSubmenuAimController();
      const submenu: RectLike = { left: 200, right: 360, top: 60, bottom: 260 };
      const firstSwitch = vi.fn();
      const exitSwitch = vi.fn();

      controller.trackPointer({ x: 100, y: 100 }, "mouse");
      const held = controller.evaluateHover({
        pointerType: "mouse",
        point: { x: 140, y: 130 },
        submenuRect: submenu,
        preferredSide: "right",
        onSwitch: firstSwitch,
      });
      expect(held.blocked).toBe(true);

      // User moves straight down / left outside the aim triangle -> immediate switch
      const exited = controller.evaluateHover({
        pointerType: "mouse",
        point: { x: 90, y: 220 },
        submenuRect: submenu,
        preferredSide: "right",
        onSwitch: exitSwitch,
      });
      expect(exited).toEqual({ blocked: false, reason: "outside-triangle" });
      expect(exitSwitch).toHaveBeenCalledTimes(1);
      expect(controller.hasPendingSwitch()).toBe(false);

      // Even after advancing past 300ms, the cancelled firstSwitch never fires
      vi.advanceTimersByTime(500);
      expect(firstSwitch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports left-opening submenus and cancels pending switch upon entering submenu", () => {
    vi.useFakeTimers();
    try {
      const controller = createSubmenuAimController();
      const leftSubmenu: RectLike = { left: 40, right: 180, top: 80, bottom: 240 };
      const onSwitch = vi.fn();

      controller.trackPointer({ x: 260, y: 120 }, "mouse");
      const held = controller.evaluateHover({
        pointerType: "mouse",
        point: { x: 215, y: 145 },
        submenuRect: leftSubmenu,
        preferredSide: "left",
        onSwitch,
      });
      expect(held).toEqual({ blocked: true, reason: "inside-triangle" });

      // Cursor arrives inside the submenu before 300ms -> cancels pending switch
      const entered = controller.evaluateHover({
        pointerType: "mouse",
        point: { x: 150, y: 150 },
        submenuRect: leftSubmenu,
        preferredSide: "left",
        onSwitch,
      });
      expect(entered).toEqual({ blocked: true, reason: "inside-submenu" });
      vi.advanceTimersByTime(500);
      expect(onSwitch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never intercepts touch, pen, or keyboard interactions", () => {
    const controller = createSubmenuAimController();
    const submenu: RectLike = { left: 200, right: 360, top: 60, bottom: 260 };
    const touchSwitch = vi.fn();
    const penSwitch = vi.fn();
    const keyboardSwitch = vi.fn();

    controller.trackPointer({ x: 100, y: 100 }, "mouse");

    expect(
      controller.evaluateHover({
        pointerType: "touch",
        point: { x: 150, y: 140 },
        submenuRect: submenu,
        onSwitch: touchSwitch,
      }),
    ).toEqual({ blocked: false, reason: "non-mouse" });
    expect(touchSwitch).toHaveBeenCalledTimes(1);

    expect(
      controller.evaluateHover({
        pointerType: "pen",
        point: { x: 150, y: 140 },
        submenuRect: submenu,
        onSwitch: penSwitch,
      }),
    ).toEqual({ blocked: false, reason: "non-mouse" });
    expect(penSwitch).toHaveBeenCalledTimes(1);

    expect(
      controller.evaluateHover({
        pointerType: "",
        point: { x: 150, y: 140 },
        submenuRect: submenu,
        onSwitch: keyboardSwitch,
      }),
    ).toEqual({ blocked: false, reason: "non-mouse" });
    expect(keyboardSwitch).toHaveBeenCalledTimes(1);
  });
});
