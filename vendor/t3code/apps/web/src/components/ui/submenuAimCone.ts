import { useCallback, useEffect, useMemo, useRef } from "react";

/** Dwell timeout (ms) before switching when a mouse cursor stays inside the safe aim triangle. */
export const SUBMENU_AIM_DWELL_MS = 300;

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface RectLike {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export type SubmenuPlacement = "right" | "left" | "bottom" | "top";

export interface SubmenuAimDecision {
  readonly blocked: boolean;
  readonly reason:
    | "non-mouse"
    | "no-submenu"
    | "inside-submenu"
    | "inside-triangle"
    | "outside-triangle"
    | "no-vertex";
}

export interface SubmenuAimEvaluateInput {
  readonly pointerType: string;
  readonly point: Point2D;
  readonly submenuRect: RectLike | null;
  readonly preferredSide?: SubmenuPlacement | undefined;
  readonly onSwitch: () => void;
}

export interface SubmenuAimControllerOptions {
  readonly dwellMs?: number | undefined;
  readonly setTimer?: ((fn: () => void, ms: number) => unknown) | undefined;
  readonly clearTimer?: ((handle: unknown) => void) | undefined;
}

export interface SubmenuAimController {
  /** Record pointer movement without forcing a switch (updates previous vertex history). */
  readonly trackPointer: (point: Point2D, pointerType?: string) => void;
  /** Evaluate whether hovering a sibling item should be delayed by the safe aim triangle. */
  readonly evaluateHover: (input: SubmenuAimEvaluateInput) => SubmenuAimDecision;
  /** Check whether a mouse coordinate currently falls inside the active aim triangle. */
  readonly isInsideAimCone: (
    point: Point2D,
    submenuRect: RectLike | null,
    preferredSide?: SubmenuPlacement,
  ) => boolean;
  /** Cancel any pending dwell switch (e.g. when entering submenu or closing menu). */
  readonly cancelPendingSwitch: () => void;
  /** Reset all tracked pointer coordinates and timers. */
  readonly reset: () => void;
  /** Inspect whether a 300ms dwell timer is currently armed. */
  readonly hasPendingSwitch: () => boolean;
  /** Latest recorded anchor vertex (previous mouse position). */
  readonly getAnchorVertex: () => Point2D | null;
}

function isFinitePoint(point: Point2D | null | undefined): point is Point2D {
  return (
    point !== null &&
    point !== undefined &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

function isValidRect(rect: RectLike | null | undefined): rect is RectLike {
  return (
    rect !== null &&
    rect !== undefined &&
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.right) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.bottom) &&
    rect.right > rect.left &&
    rect.bottom > rect.top
  );
}

export function isPointInRect(point: Point2D, rect: RectLike): boolean {
  if (!isFinitePoint(point) || !isValidRect(rect)) return false;
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

function cross2D(a: Point2D, b: Point2D, p: Point2D): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/**
 * Exact 2D point-in-triangle test using signed cross-product orientation.
 * Handles both clockwise and counter-clockwise vertex ordering, includes edges,
 * and rejects degenerate zero-area triangles safely.
 */
export function isPointInAimTriangle(
  point: Point2D,
  vertex: Point2D,
  cornerA: Point2D,
  cornerB: Point2D,
): boolean {
  if (
    !isFinitePoint(point) ||
    !isFinitePoint(vertex) ||
    !isFinitePoint(cornerA) ||
    !isFinitePoint(cornerB)
  ) {
    return false;
  }

  // Reject degenerate (collinear or zero-area) triangles.
  const doubleArea = Math.abs(cross2D(vertex, cornerA, cornerB));
  if (doubleArea < 1e-6) {
    return false;
  }

  const d1 = cross2D(vertex, cornerA, point);
  const d2 = cross2D(cornerA, cornerB, point);
  const d3 = cross2D(cornerB, vertex, point);

  const eps = 1e-6;
  const hasNeg = d1 < -eps || d2 < -eps || d3 < -eps;
  const hasPos = d1 > eps || d2 > eps || d3 > eps;
  return !(hasNeg && hasPos);
}

/** Normalize Base UI / Floating UI `data-side` strings to cardinal SubmenuPlacement. */
export function normalizeSubmenuSide(
  side: string | null | undefined,
): SubmenuPlacement | undefined {
  if (!side) return undefined;
  if (side === "right" || side === "inline-end") return "right";
  if (side === "left" || side === "inline-start") return "left";
  if (side === "bottom") return "bottom";
  if (side === "top") return "top";
  return undefined;
}

/**
 * Return the two corner points of the submenu's edge nearest to `origin`
 * (automatically adapting to right, left, bottom, or top submenu placement).
 * Returns `null` if the rect is invalid or `origin` already lies inside `menuRect`.
 */
export function getSubmenuNearEdgeCorners(
  menuRect: RectLike,
  origin: Point2D,
  preferredSide?: SubmenuPlacement,
  edgePadding = 0,
): readonly [Point2D, Point2D] | null {
  if (!isValidRect(menuRect) || !isFinitePoint(origin)) {
    return null;
  }
  if (isPointInRect(origin, menuRect)) {
    return null;
  }

  const pad = Number.isFinite(edgePadding) && edgePadding > 0 ? edgePadding : 0;

  let side: SubmenuPlacement | null = preferredSide ?? null;
  if (side === null) {
    if (origin.x <= menuRect.left) {
      side = "right";
    } else if (origin.x >= menuRect.right) {
      side = "left";
    } else if (origin.y <= menuRect.top) {
      side = "bottom";
    } else if (origin.y >= menuRect.bottom) {
      side = "top";
    }
  }

  if (side === "right") {
    return [
      { x: menuRect.left, y: menuRect.top - pad },
      { x: menuRect.left, y: menuRect.bottom + pad },
    ];
  }
  if (side === "left") {
    return [
      { x: menuRect.right, y: menuRect.top - pad },
      { x: menuRect.right, y: menuRect.bottom + pad },
    ];
  }
  if (side === "bottom") {
    return [
      { x: menuRect.left - pad, y: menuRect.top },
      { x: menuRect.right + pad, y: menuRect.top },
    ];
  }
  if (side === "top") {
    return [
      { x: menuRect.left - pad, y: menuRect.bottom },
      { x: menuRect.right + pad, y: menuRect.bottom },
    ];
  }
  return null;
}

/**
 * Framework-agnostic state machine implementing the safe-triangle hover aim cone:
 * - Only guards `pointerType === "mouse"` hover events (keyboard & touch bypass immediately).
 * - Uses the preceding mouse position as triangle vertex and submenu near edge as base.
 * - Inside triangle: holds open submenu and resets a 300ms dwell timer before switching.
 * - Outside triangle: cancels timer and switches immediately.
 */
export function createSubmenuAimController(
  options: SubmenuAimControllerOptions = {},
): SubmenuAimController {
  const dwellMs = options.dwellMs ?? SUBMENU_AIM_DWELL_MS;
  const setTimerFn = options.setTimer ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const clearTimerFn =
    options.clearTimer ?? ((handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));

  let prevPoint: Point2D | null = null;
  let lastPoint: Point2D | null = null;
  let timerHandle: unknown = null;
  let pendingSwitch: (() => void) | null = null;

  const cancelPendingSwitch = (): void => {
    if (timerHandle !== null) {
      clearTimerFn(timerHandle);
      timerHandle = null;
    }
    pendingSwitch = null;
  };

  const trackPointer = (point: Point2D, pointerType = "mouse"): void => {
    if (pointerType !== "mouse" || !isFinitePoint(point)) return;
    if (lastPoint !== null && (lastPoint.x !== point.x || lastPoint.y !== point.y)) {
      prevPoint = lastPoint;
    } else if (prevPoint === null) {
      prevPoint = point;
    }
    lastPoint = point;
  };

  const isInsideAimCone = (
    point: Point2D,
    submenuRect: RectLike | null,
    preferredSide?: SubmenuPlacement,
  ): boolean => {
    if (!isFinitePoint(point) || !isValidRect(submenuRect)) return false;
    if (isPointInRect(point, submenuRect)) return true;
    const vertex = prevPoint ?? lastPoint;
    if (!vertex) return false;
    const corners = getSubmenuNearEdgeCorners(submenuRect, vertex, preferredSide);
    if (!corners) return false;
    return isPointInAimTriangle(point, vertex, corners[0], corners[1]);
  };

  const evaluateHover = (input: SubmenuAimEvaluateInput): SubmenuAimDecision => {
    // Strictly preserve keyboard & touch interaction: only intercept mouse hover.
    if (input.pointerType !== "mouse") {
      cancelPendingSwitch();
      input.onSwitch();
      return { blocked: false, reason: "non-mouse" };
    }

    if (!isValidRect(input.submenuRect)) {
      cancelPendingSwitch();
      trackPointer(input.point, "mouse");
      input.onSwitch();
      return { blocked: false, reason: "no-submenu" };
    }

    if (isPointInRect(input.point, input.submenuRect)) {
      cancelPendingSwitch();
      trackPointer(input.point, "mouse");
      return { blocked: true, reason: "inside-submenu" };
    }

    const vertex = prevPoint ?? lastPoint;
    if (!vertex) {
      trackPointer(input.point, "mouse");
      cancelPendingSwitch();
      input.onSwitch();
      return { blocked: false, reason: "no-vertex" };
    }

    const corners = getSubmenuNearEdgeCorners(input.submenuRect, vertex, input.preferredSide);
    const inCone =
      corners !== null && isPointInAimTriangle(input.point, vertex, corners[0], corners[1]);

    // Advance vertex history AFTER testing current point against the preceding vertex.
    trackPointer(input.point, "mouse");

    if (inCone) {
      // Inside safe triangle: keep current submenu open and arm/reset 300ms dwell timer.
      if (timerHandle !== null) {
        clearTimerFn(timerHandle);
      }
      pendingSwitch = input.onSwitch;
      timerHandle = setTimerFn(() => {
        const fn = pendingSwitch;
        timerHandle = null;
        pendingSwitch = null;
        fn?.();
      }, dwellMs);
      return { blocked: true, reason: "inside-triangle" };
    }

    // Outside safe triangle: cancel dwell timer and switch immediately.
    cancelPendingSwitch();
    input.onSwitch();
    return { blocked: false, reason: "outside-triangle" };
  };

  const reset = (): void => {
    cancelPendingSwitch();
    prevPoint = null;
    lastPoint = null;
  };

  return {
    trackPointer,
    evaluateHover,
    isInsideAimCone,
    cancelPendingSwitch,
    reset,
    hasPendingSwitch: () => timerHandle !== null,
    getAnchorVertex: () => prevPoint ?? lastPoint,
  };
}

export interface UseSubmenuAimConeOptions {
  readonly dwellMs?: number | undefined;
}

export interface ActiveSubmenuRegistration {
  readonly id: string;
  readonly getTriggerElement: () => HTMLElement | null;
  readonly getPopupElement: () => HTMLElement | null;
  readonly close: () => void;
}

export interface SubmenuAimConeHandle {
  readonly controller: SubmenuAimController;
  readonly registerActiveSubmenu: (entry: ActiveSubmenuRegistration) => void;
  readonly unregisterActiveSubmenu: (id: string) => void;
  readonly getActiveSubmenu: () => ActiveSubmenuRegistration | null;
  /** Read bounding rect + inferred placement of the currently open submenu popup. */
  readonly getActiveSubmenuGeometry: () => {
    readonly rect: RectLike;
    readonly side: SubmenuPlacement | undefined;
  } | null;
  /** Handle mouse move capture on the parent menu container. */
  readonly handleParentPointerMoveCapture: (event: {
    readonly pointerType: string;
    readonly clientX: number;
    readonly clientY: number;
    readonly target: EventTarget | null;
    readonly stopPropagation: () => void;
  }) => SubmenuAimDecision | null;
  /** Decide whether a mouse-initiated submenu close should be deferred by the aim cone. */
  readonly shouldDeferSubmenuClose: (
    submenuId: string,
    pointerEvent: { readonly pointerType?: string; readonly clientX?: number; readonly clientY?: number } | null,
    onAllowClose: () => void,
  ) => boolean;
}

/**
 * React hook coordinating safe-triangle hover protection for nested submenus inside a parent menu.
 * Never intercepts keyboard or touch interactions.
 */
export function useSubmenuAimCone(
  options: UseSubmenuAimConeOptions = {},
): SubmenuAimConeHandle {
  const dwellMs = options.dwellMs ?? SUBMENU_AIM_DWELL_MS;
  const controllerRef = useRef<SubmenuAimController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createSubmenuAimController({ dwellMs });
  }
  const activeSubmenuRef = useRef<ActiveSubmenuRegistration | null>(null);

  useEffect(() => {
    return () => {
      controllerRef.current?.reset();
      activeSubmenuRef.current = null;
    };
  }, []);

  const registerActiveSubmenu = useCallback((entry: ActiveSubmenuRegistration) => {
    activeSubmenuRef.current = entry;
    controllerRef.current?.cancelPendingSwitch();
  }, []);

  const unregisterActiveSubmenu = useCallback((id: string) => {
    if (activeSubmenuRef.current?.id === id) {
      activeSubmenuRef.current = null;
      controllerRef.current?.cancelPendingSwitch();
    }
  }, []);

  const getActiveSubmenu = useCallback(() => activeSubmenuRef.current, []);

  const getActiveSubmenuGeometry = useCallback(() => {
    const active = activeSubmenuRef.current;
    const popup = active?.getPopupElement();
    if (!popup) return null;
    const rect = popup.getBoundingClientRect();
    if (!isValidRect(rect)) return null;
    const positioner = popup.closest<HTMLElement>("[data-side]");
    const side = normalizeSubmenuSide(
      popup.getAttribute("data-side") ?? positioner?.getAttribute("data-side"),
    );
    return { rect, side };
  }, []);

  const handleParentPointerMoveCapture = useCallback(
    (event: {
      readonly pointerType: string;
      readonly clientX: number;
      readonly clientY: number;
      readonly target: EventTarget | null;
      readonly stopPropagation: () => void;
    }): SubmenuAimDecision | null => {
      const controller = controllerRef.current;
      if (!controller) return null;
      if (event.pointerType !== "mouse") return null;

      const point: Point2D = { x: event.clientX, y: event.clientY };
      const active = activeSubmenuRef.current;
      if (!active) {
        controller.trackPointer(point, "mouse");
        return null;
      }

      const geometry = getActiveSubmenuGeometry();
      if (!geometry) {
        controller.trackPointer(point, "mouse");
        return null;
      }

      const targetEl = event.target instanceof HTMLElement ? event.target : null;
      const triggerEl = active.getTriggerElement();
      const popupEl = active.getPopupElement();

      // Hovering inside the open submenu or its own trigger: keep open and cancel pending close.
      if (
        (popupEl && targetEl && popupEl.contains(targetEl)) ||
        (triggerEl && targetEl && triggerEl.contains(targetEl))
      ) {
        controller.cancelPendingSwitch();
        controller.trackPointer(point, "mouse");
        return null;
      }

      const siblingItem = targetEl?.closest<HTMLElement>(
        '[data-slot="menu-item"], [data-slot="menu-sub-trigger"], [data-slot="menu-checkbox-item"], [data-slot="menu-radio-item"]',
      );
      if (!siblingItem) {
        controller.trackPointer(point, "mouse");
        return null;
      }

      const decision = controller.evaluateHover({
        pointerType: event.pointerType,
        point,
        submenuRect: geometry.rect,
        preferredSide: geometry.side,
        onSwitch: () => {
          active.close();
          if (siblingItem.isConnected) {
            siblingItem.dispatchEvent(
              new PointerEvent("pointermove", {
                bubbles: true,
                pointerType: "mouse",
                clientX: point.x,
                clientY: point.y,
              }),
            );
          }
        },
      });

      if (decision.blocked) {
        event.stopPropagation();
      }
      return decision;
    },
    [getActiveSubmenuGeometry],
  );

  const shouldDeferSubmenuClose = useCallback(
    (
      submenuId: string,
      pointerEvent: {
        readonly pointerType?: string;
        readonly clientX?: number;
        readonly clientY?: number;
      } | null,
      onAllowClose: () => void,
    ): boolean => {
      const controller = controllerRef.current;
      const active = activeSubmenuRef.current;
      if (!controller || !active || active.id !== submenuId) return false;
      if (!pointerEvent) return false;
      // Only defer mouse hover transitions; never touch, pen, or keyboard events.
      if (pointerEvent.pointerType !== undefined && pointerEvent.pointerType !== "mouse") {
        return false;
      }
      if (
        typeof pointerEvent.clientX !== "number" ||
        typeof pointerEvent.clientY !== "number"
      ) {
        return false;
      }
      const geometry = getActiveSubmenuGeometry();
      if (!geometry) return false;
      const decision = controller.evaluateHover({
        pointerType: "mouse",
        point: { x: pointerEvent.clientX, y: pointerEvent.clientY },
        submenuRect: geometry.rect,
        preferredSide: geometry.side,
        onSwitch: onAllowClose,
      });
      return decision.blocked;
    },
    [getActiveSubmenuGeometry],
  );

  return useMemo(
    () => ({
      controller: controllerRef.current!,
      registerActiveSubmenu,
      unregisterActiveSubmenu,
      getActiveSubmenu,
      getActiveSubmenuGeometry,
      handleParentPointerMoveCapture,
      shouldDeferSubmenuClose,
    }),
    [
      getActiveSubmenu,
      getActiveSubmenuGeometry,
      handleParentPointerMoveCapture,
      registerActiveSubmenu,
      shouldDeferSubmenuClose,
      unregisterActiveSubmenu,
    ],
  );
}
