import type { CSSProperties } from "react";
import type { SettingsNavGroup, SettingsPath } from "./settingsSearch";

/**
 * Detail and merged sub-routes without their own sidebar entry highlight their parent nav item.
 * Keeps legacy deep links (e.g. /settings/wallpaper, /settings/archived) 100% intact.
 */
export const SETTINGS_NAV_PARENT_ALIASES: Readonly<Record<string, SettingsPath>> = {
  "/settings/wallpaper": "/settings/appearance",
  "/settings/updates": "/settings/about",
  "/settings/open-source-licenses": "/settings/about",
  "/settings/labs": "/settings/general",
  "/settings/beta": "/settings/general",
};

export interface SettingsNavItemGeometry {
  readonly y: number;
  readonly height: number;
}

export interface SettingsNavIndicatorTarget {
  readonly groupId: string;
  readonly path: SettingsPath;
}

export type SettingsNavTransitionMode = "idle" | "instant" | "slide" | "crossfade" | "enter" | "leave";

export interface SettingsNavGroupIndicatorState {
  readonly visible: boolean;
  readonly path: SettingsPath | null;
  readonly mode: SettingsNavTransitionMode;
}

export interface SettingsNavIndicatorMachineState {
  readonly current: SettingsNavIndicatorTarget | null;
  readonly mode: SettingsNavTransitionMode;
  readonly groupStates: Readonly<Record<string, SettingsNavGroupIndicatorState>>;
}

export type SettingsNavIndicatorKind = "active" | "hover";

export const SETTINGS_NAV_SLIDE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
export const SETTINGS_NAV_FADE_EASING = "cubic-bezier(0.2, 0, 0, 1)";

const INDICATOR_TIMINGS: Readonly<
  Record<
    SettingsNavIndicatorKind,
    { readonly slideMs: number; readonly fadeInMs: number; readonly fadeOutMs: number }
  >
> = {
  active: { slideMs: 230, fadeInMs: 165, fadeOutMs: 140 },
  hover: { slideMs: 185, fadeInMs: 135, fadeOutMs: 120 },
};

/** Normalize trailing slashes and resolve merged/detail aliases to the owning sidebar path. */
export function resolveSettingsNavActivePath(pathname: string): string {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const directAlias = SETTINGS_NAV_PARENT_ALIASES[normalized];
  if (directAlias) return directAlias;
  for (const [alias, parent] of Object.entries(SETTINGS_NAV_PARENT_ALIASES)) {
    if (normalized.startsWith(`${alias}/`)) {
      return parent;
    }
  }
  return normalized;
}

/** Locate the nav group and canonical path matching the current pathname (or alias). */
export function findSettingsNavTarget(
  groups: ReadonlyArray<SettingsNavGroup>,
  pathname: string,
): SettingsNavIndicatorTarget | null {
  const resolved = resolveSettingsNavActivePath(pathname);
  for (const group of groups) {
    for (const path of group.paths) {
      if (resolved === path || resolved.startsWith(`${path}/`)) {
        return { groupId: group.id, path };
      }
    }
  }
  return null;
}

export function createInitialIndicatorState(
  groups: ReadonlyArray<SettingsNavGroup>,
  initialTarget: SettingsNavIndicatorTarget | null,
  initialMode: "instant" | "enter" = "instant",
): SettingsNavIndicatorMachineState {
  const groupStates: Record<string, SettingsNavGroupIndicatorState> = {};
  for (const group of groups) {
    if (initialTarget && initialTarget.groupId === group.id) {
      groupStates[group.id] = {
        visible: true,
        path: initialTarget.path,
        mode: initialMode,
      };
    } else {
      groupStates[group.id] = {
        visible: false,
        path: null,
        mode: "idle",
      };
    }
  }
  return {
    current: initialTarget,
    mode: initialTarget ? initialMode : "idle",
    groupStates,
  };
}

/**
 * Per-group indicator state machine: slides within the same group, crossfades across groups,
 * and collapses to instant 0ms transitions when prefers-reduced-motion is active.
 */
export function transitionIndicatorState(
  prev: SettingsNavIndicatorMachineState,
  next: SettingsNavIndicatorTarget | null,
  options: {
    readonly groups: ReadonlyArray<SettingsNavGroup>;
    readonly reducedMotion: boolean;
    readonly initialMode?: "instant" | "enter";
  },
): SettingsNavIndicatorMachineState {
  const { groups, reducedMotion, initialMode = "enter" } = options;
  const prevTarget = prev.current;

  const isSameTarget =
    prevTarget?.groupId === next?.groupId && prevTarget?.path === next?.path;

  let mode: SettingsNavTransitionMode;
  if (isSameTarget) {
    mode = next === null ? "idle" : prev.mode;
  } else if (reducedMotion) {
    mode = "instant";
  } else if (prevTarget === null && next !== null) {
    mode = initialMode;
  } else if (prevTarget !== null && next === null) {
    mode = "leave";
  } else if (prevTarget !== null && next !== null) {
    mode = prevTarget.groupId === next.groupId ? "slide" : "crossfade";
  } else {
    mode = "idle";
  }

  const groupStates: Record<string, SettingsNavGroupIndicatorState> = {};
  for (const group of groups) {
    const prevGroup = prev.groupStates[group.id];
    const isNextGroup = next !== null && next.groupId === group.id;
    const isPrevGroup = prevTarget !== null && prevTarget.groupId === group.id;

    if (isNextGroup) {
      groupStates[group.id] = {
        visible: true,
        path: next.path,
        mode: reducedMotion ? "instant" : mode,
      };
    } else if (isPrevGroup && !isSameTarget) {
      // Keep the departing group's last path so its pill fades out in place instead of jumping.
      groupStates[group.id] = {
        visible: false,
        path: prevTarget.path,
        mode: reducedMotion ? "instant" : mode === "crossfade" ? "crossfade" : "leave",
      };
    } else {
      groupStates[group.id] = {
        visible: false,
        path: prevGroup?.path ?? null,
        mode: "idle",
      };
    }
  }

  return {
    current: next,
    mode: reducedMotion ? "instant" : mode,
    groupStates,
  };
}

/**
 * Compute GPU-composited inline style for one group's indicator pill.
 * Only transitions `transform` & `height` during intra-group `slide`;
 * during `crossfade` / `enter` / `leave`, `transitionProperty` is restricted to `opacity`
 * so the pill snaps to the target slot instantaneously and crossfades cleanly without flying across dividers.
 */
export function buildIndicatorPillStyle(params: {
  readonly state: SettingsNavGroupIndicatorState | undefined;
  readonly geometry: SettingsNavItemGeometry | undefined;
  readonly kind: SettingsNavIndicatorKind;
  readonly reducedMotion: boolean;
  readonly disableMotion?: boolean;
}): CSSProperties {
  const { state, geometry, kind, reducedMotion, disableMotion = false } = params;
  const visible = Boolean(state?.visible && geometry && geometry.height > 0);
  const y = geometry?.y ?? 0;
  const height = geometry?.height ?? 0;
  const timings = INDICATOR_TIMINGS[kind];
  const mode = state?.mode ?? "idle";

  const base: CSSProperties = {
    transform: `translate3d(0, ${y}px, 0)`,
    height: height > 0 ? `${height}px` : undefined,
    opacity: visible ? 1 : 0,
    willChange: reducedMotion ? undefined : "transform, opacity",
  };

  if (reducedMotion || disableMotion || mode === "instant" || mode === "idle") {
    return {
      ...base,
      transitionProperty: "none",
      transitionDuration: "0ms",
    };
  }

  if (mode === "slide" && visible) {
    return {
      ...base,
      transitionProperty: "transform, height, opacity",
      transitionDuration: `${timings.slideMs}ms, ${timings.slideMs}ms, ${timings.fadeInMs}ms`,
      transitionTimingFunction: `${SETTINGS_NAV_SLIDE_EASING}, ${SETTINGS_NAV_SLIDE_EASING}, ${SETTINGS_NAV_FADE_EASING}`,
    };
  }

  // crossfade / enter / leave: fade opacity only so transform snaps without crossing dividers.
  const durationMs = visible ? timings.fadeInMs : timings.fadeOutMs;
  const easing = visible ? SETTINGS_NAV_SLIDE_EASING : SETTINGS_NAV_FADE_EASING;
  return {
    ...base,
    transitionProperty: "opacity",
    transitionDuration: `${durationMs}ms`,
    transitionTimingFunction: easing,
  };
}

export function areGeometryMapsEqual(
  left: Readonly<Record<string, SettingsNavItemGeometry>>,
  right: Readonly<Record<string, SettingsNavItemGeometry>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    const a = left[key];
    const b = right[key];
    if (!a || !b || a.y !== b.y || a.height !== b.height) {
      return false;
    }
  }
  return true;
}
