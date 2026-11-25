import { describe, expect, it } from "vite-plus/test";

import {
  formatSidebarRailTooltip,
  planSidebarMotionTransition,
  resolveInboxRailDotTone,
  resolvePluginsRailDotTone,
  resolveSidebarMotionVisualState,
  resolveSidebarRailThreadTooltip,
  SIDEBAR_COLLAPSE_TEXT_FADE_MS,
  SIDEBAR_EXPANDED_TOOLTIP_DELAY_MS,
  SIDEBAR_EXPAND_WIDTH_MS,
  SIDEBAR_ICON_RAIL_WIDTH_PX,
  SIDEBAR_RAIL_TOOLTIP_CLOSE_DELAY_MS,
  SIDEBAR_RAIL_TOOLTIP_DELAY_MS,
  SIDEBAR_RAIL_TOOLTIP_TIMEOUT_MS,
} from "./sidebarIconRailMotion";

describe("sidebar icon-rail two-stage collapse choreography (Spec 2)", () => {
  it("keeps icon-rail width within the 52-56px persistent rail band", () => {
    expect(SIDEBAR_ICON_RAIL_WIDTH_PX).toBeGreaterThanOrEqual(52);
    expect(SIDEBAR_ICON_RAIL_WIDTH_PX).toBeLessThanOrEqual(56);
    expect(SIDEBAR_ICON_RAIL_WIDTH_PX).toBe(54);
  });

  it("hides text first (~90ms) before narrowing width when collapsing", () => {
    const plan = planSidebarMotionTransition({
      targetOpen: false,
      currentPhase: "expanded",
      reducedMotion: false,
    });
    expect(plan).toEqual({
      immediatePhase: "collapsing-text",
      delayedPhase: "collapsed",
      delayMs: SIDEBAR_COLLAPSE_TEXT_FADE_MS,
    });

    const stage1 = resolveSidebarMotionVisualState(plan.immediatePhase);
    expect(stage1.isTextHidden).toBe(true);
    expect(stage1.isWidthNarrow).toBe(false);
    expect(stage1.isIconRail).toBe(false);

    const stage2 = resolveSidebarMotionVisualState(plan.delayedPhase!);
    expect(stage2.isTextHidden).toBe(true);
    expect(stage2.isWidthNarrow).toBe(true);
    expect(stage2.isIconRail).toBe(true);
  });

  it("widens width first (~150ms) while keeping text hidden before revealing text when expanding", () => {
    const plan = planSidebarMotionTransition({
      targetOpen: true,
      currentPhase: "collapsed",
      reducedMotion: false,
    });
    expect(plan).toEqual({
      immediatePhase: "expanding-width",
      delayedPhase: "expanded",
      delayMs: SIDEBAR_EXPAND_WIDTH_MS,
    });

    const stage1 = resolveSidebarMotionVisualState(plan.immediatePhase);
    expect(stage1.isWidthNarrow).toBe(false);
    expect(stage1.isTextHidden).toBe(true);
    expect(stage1.isIconRail).toBe(false);

    const stage2 = resolveSidebarMotionVisualState(plan.delayedPhase!);
    expect(stage2.isWidthNarrow).toBe(false);
    expect(stage2.isTextHidden).toBe(false);
    expect(stage2.isIconRail).toBe(false);
  });

  it("degrades instantaneously to 0ms when prefers-reduced-motion is active", () => {
    expect(
      planSidebarMotionTransition({
        targetOpen: false,
        currentPhase: "expanded",
        reducedMotion: true,
      }),
    ).toEqual({ immediatePhase: "collapsed", delayedPhase: null, delayMs: 0 });

    expect(
      planSidebarMotionTransition({
        targetOpen: true,
        currentPhase: "collapsed",
        reducedMotion: true,
      }),
    ).toEqual({ immediatePhase: "expanded", delayedPhase: null, delayMs: 0 });
  });

  it("shortcuts mid-transition reversal cleanly without stalling", () => {
    expect(
      planSidebarMotionTransition({
        targetOpen: true,
        currentPhase: "collapsing-text",
        reducedMotion: false,
      }),
    ).toEqual({ immediatePhase: "expanded", delayedPhase: null, delayMs: 0 });

    expect(
      planSidebarMotionTransition({
        targetOpen: false,
        currentPhase: "expanding-width",
        reducedMotion: false,
      }),
    ).toEqual({ immediatePhase: "collapsed", delayedPhase: null, delayMs: 0 });
  });

  it("converts numeric badges into 6px dot tones and builds complete localized tooltips", () => {
    expect(resolveInboxRailDotTone({ approvalCount: 2, attentionCount: 3 })).toBe("amber");
    expect(resolveInboxRailDotTone({ approvalCount: 0, attentionCount: 2 })).toBe("primary");
    expect(resolveInboxRailDotTone({ approvalCount: 0, attentionCount: 0 })).toBeNull();

    expect(resolvePluginsRailDotTone(0)).toBeNull();
    expect(resolvePluginsRailDotTone(null)).toBeNull();
    expect(resolvePluginsRailDotTone(2)).toBe("primary");

    expect(formatSidebarRailTooltip("Plugins", "0")).toBe("Plugins · 0");
    expect(formatSidebarRailTooltip("Automations", null)).toBe("Automations");
  });

  it("configures snappy collapsed rail tooltip timing and concise project/thread tooltip labels", () => {
    expect(SIDEBAR_RAIL_TOOLTIP_DELAY_MS).toBeGreaterThan(0);
    expect(SIDEBAR_RAIL_TOOLTIP_DELAY_MS).toBeLessThanOrEqual(150);
    expect(SIDEBAR_RAIL_TOOLTIP_CLOSE_DELAY_MS).toBe(0);
    expect(SIDEBAR_RAIL_TOOLTIP_TIMEOUT_MS).toBeGreaterThanOrEqual(300);
    expect(SIDEBAR_EXPANDED_TOOLTIP_DELAY_MS).toBeGreaterThan(SIDEBAR_RAIL_TOOLTIP_DELAY_MS);

    expect(
      resolveSidebarRailThreadTooltip({
        threadTitle: "优化侧边栏",
        projectDisplayName: "Prismux",
        lampState: "idle",
        statusText: "空闲",
        fallbackTitle: "新建会话",
      }),
    ).toEqual({
      primary: "优化侧边栏",
      secondary: "Prismux",
      ariaLabel: "优化侧边栏 (Prismux)",
    });

    expect(
      resolveSidebarRailThreadTooltip({
        threadTitle: "修复单测",
        projectDisplayName: "Prismux",
        lampState: "running",
        statusText: "运行中",
        fallbackTitle: "新建会话",
      }),
    ).toEqual({
      primary: "修复单测",
      secondary: "Prismux · 运行中",
      ariaLabel: "修复单测 (Prismux · 运行中)",
    });

    expect(
      resolveSidebarRailThreadTooltip({
        threadTitle: "   ",
        projectDisplayName: "Prismux",
        lampState: "idle",
        statusText: "空闲",
        fallbackTitle: "新建会话",
      }),
    ).toEqual({
      primary: "Prismux",
      secondary: null,
      ariaLabel: "Prismux",
    });

    expect(
      resolveSidebarRailThreadTooltip({
        threadTitle: "Prismux",
        projectDisplayName: "Prismux",
        lampState: "approval",
        statusText: "待审批",
        fallbackTitle: "新建会话",
      }),
    ).toEqual({
      primary: "Prismux",
      secondary: "待审批",
      ariaLabel: "Prismux (待审批)",
    });
  });
});
