/**
 * Spec 2: Two-stage choreographed collapse/expand state machine for Prismux's
 * persistent 54px icon-rail sidebar.
 *
 * Choreography:
 * - Collapse: fade/hide labels first (~90ms) -> then smoothly narrow width to 54px (~150ms)
 * - Expand:   smoothly widen width first (~150ms) while labels stay hidden -> then reveal labels
 * - Reduced motion (`prefers-reduced-motion: reduce` or animations disabled): instant switch (0ms)
 */

export const SIDEBAR_ICON_RAIL_WIDTH_PX = 54 as const;
export const SIDEBAR_COLLAPSE_TEXT_FADE_MS = 90 as const;
export const SIDEBAR_EXPAND_WIDTH_MS = 150 as const;

export type SidebarCollapseMotionPhase =
  | "expanded"
  | "collapsing-text"
  | "collapsed"
  | "expanding-width";

export interface SidebarMotionVisualState {
  readonly phase: SidebarCollapseMotionPhase;
  /** True only once the sidebar should occupy the narrow 54px icon rail width. */
  readonly isWidthNarrow: boolean;
  /** True while labels are faded/hidden so text never wraps or squeezes during width change. */
  readonly isTextHidden: boolean;
  /** True when fully settled into the vertical 54px icon rail layout. */
  readonly isIconRail: boolean;
}

export function resolveSidebarMotionVisualState(
  phase: SidebarCollapseMotionPhase,
): SidebarMotionVisualState {
  switch (phase) {
    case "expanded":
      return {
        phase,
        isWidthNarrow: false,
        isTextHidden: false,
        isIconRail: false,
      };
    case "collapsing-text":
      return {
        phase,
        isWidthNarrow: false,
        isTextHidden: true,
        isIconRail: false,
      };
    case "collapsed":
      return {
        phase,
        isWidthNarrow: true,
        isTextHidden: true,
        isIconRail: true,
      };
    case "expanding-width":
      return {
        phase,
        isWidthNarrow: false,
        isTextHidden: true,
        isIconRail: false,
      };
  }
}

export interface SidebarMotionTransitionPlan {
  readonly immediatePhase: SidebarCollapseMotionPhase;
  readonly delayedPhase: SidebarCollapseMotionPhase | null;
  readonly delayMs: number;
}

/**
 * Computes the two-stage choreography for transitioning between expanded and collapsed states.
 * Aborting mid-transition shortcuts cleanly without redundant delays.
 */
export function planSidebarMotionTransition(input: {
  readonly targetOpen: boolean;
  readonly currentPhase: SidebarCollapseMotionPhase;
  readonly reducedMotion: boolean;
}): SidebarMotionTransitionPlan {
  const { targetOpen, currentPhase, reducedMotion } = input;
  if (reducedMotion) {
    return {
      immediatePhase: targetOpen ? "expanded" : "collapsed",
      delayedPhase: null,
      delayMs: 0,
    };
  }

  if (!targetOpen) {
    if (currentPhase === "collapsed") {
      return { immediatePhase: "collapsed", delayedPhase: null, delayMs: 0 };
    }
    if (currentPhase === "expanding-width") {
      // Text is already hidden while widening — narrow back immediately.
      return { immediatePhase: "collapsed", delayedPhase: null, delayMs: 0 };
    }
    // Stage 1: hide/fade text first; Stage 2: narrow width to 54px icon rail.
    return {
      immediatePhase: "collapsing-text",
      delayedPhase: "collapsed",
      delayMs: SIDEBAR_COLLAPSE_TEXT_FADE_MS,
    };
  }

  if (currentPhase === "expanded") {
    return { immediatePhase: "expanded", delayedPhase: null, delayMs: 0 };
  }
  if (currentPhase === "collapsing-text") {
    // Width never narrowed yet — reveal text immediately.
    return { immediatePhase: "expanded", delayedPhase: null, delayMs: 0 };
  }
  // Stage 1: widen sidebar while keeping text hidden; Stage 2: reveal text cleanly.
  return {
    immediatePhase: "expanding-width",
    delayedPhase: "expanded",
    delayMs: SIDEBAR_EXPAND_WIDTH_MS,
  };
}

/**
 * Formats localized icon-rail tooltips combining primary name with optional live count/status summary.
 */
export function formatSidebarRailTooltip(label: string, detail?: string | null): string {
  const trimmedDetail = detail?.trim();
  if (!trimmedDetail) return label;
  return `${label} · ${trimmedDetail}`;
}

export type SidebarRailDotTone = "amber" | "primary" | "emerald" | "rose" | null;

/**
 * Maps numeric counts / pending approvals into a refined 6px status dot for the collapsed icon rail.
 */
export function resolveInboxRailDotTone(input: {
  readonly approvalCount: number;
  readonly attentionCount: number;
}): SidebarRailDotTone {
  if (input.approvalCount > 0) return "amber";
  if (input.attentionCount > 0) return "primary";
  return null;
}

export function resolvePluginsRailDotTone(installedCount: number | null): SidebarRailDotTone {
  if (installedCount !== null && installedCount > 0) return "primary";
  return null;
}
