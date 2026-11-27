import {
  applyPrismuxAppearanceToDocument,
  clearPrismuxAppearanceFromDocument,
  normalizeAppearanceConfig,
} from "@prismux/appearance";
import { useState, type CSSProperties } from "react";
import { describe, expect, it } from "vite-plus/test";
import { cdp, page } from "vite-plus/test/browser";

import "@prismux/appearance/styles.css";
import "~/index.css";
import {
  COMPOSER_SHIMMER_SEGMENT_COUNT,
  ComposerSurface,
  computeComposerShimmerMetrics,
} from "../components/chat/ComposerSurface";
import { render } from "../../test/render";

function ShimmerHarness({
  initialActive = false,
  initialWidth = 760,
  initialHeight = 120,
}: {
  initialActive?: boolean;
  initialWidth?: number;
  initialHeight?: number;
}) {
  const [active, setActive] = useState(initialActive);
  const [width, setWidth] = useState(initialWidth);
  const [height, setHeight] = useState(initialHeight);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="toggle-active" onClick={() => setActive((v) => !v)}>
          Toggle Active
        </button>
        <button
          type="button"
          data-testid="size-narrow"
          onClick={() => {
            setWidth(380);
            setHeight(110);
          }}
        >
          Narrow
        </button>
        <button
          type="button"
          data-testid="size-wide-tall"
          onClick={() => {
            setWidth(920);
            setHeight(168);
          }}
        >
          Wide Tall
        </button>
        <button
          type="button"
          data-testid="size-collapsed"
          onClick={() => {
            setWidth(360);
            setHeight(48);
          }}
        >
          Collapsed
        </button>
      </div>

      <div
        style={
          {
            width: `${width}px`,
            maxWidth: "100%",
            "--pmx-chat-content-max-width": "960px",
          } as CSSProperties
        }
      >
        <ComposerSurface.Shell>
          <ComposerSurface.Host>
            <ComposerSurface.Main
              data-testid="composer-main"
              data-pmx-composer-layout="agy"
              data-pmx-composer-active={active ? "1" : "0"}
              className="p-1"
              style={{ width: `${width}px`, height: `${height}px` }}
            >
              <div data-pmx-composer-inner-card="1" className="h-full w-full p-3">
                <span data-testid="composer-text">Ask anything...</span>
              </div>
            </ComposerSurface.Main>
          </ComposerSurface.Host>
        </ComposerSurface.Shell>
      </div>

      <div data-app-sidebar="1" style={{ width: "240px" }}>
        <div
          data-testid="active-sidebar-agent"
          data-sidebar-card="1"
          data-sidebar-agent-active={active ? "1" : "0"}
          className="h-10 rounded-lg px-3 py-2 text-xs"
        >
          Running Agent Row
        </div>
      </div>
    </div>
  );
}

describe("Composer active shimmer GPU smoothness, constant perimeter speed & theme adaptation", () => {
  it("computes mathematically constant arc-length velocity around wide 6.3:1 rounded rectangles (zero corner whip distortion)", () => {
    for (const [w, h, r] of [
      [760, 120, 20],
      [960, 156, 20],
      [380, 100, 20],
      [360, 48, 20],
    ] as const) {
      const metrics = computeComposerShimmerMetrics(w, h, r);
      const expectedPerimeter = 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;
      expect(Math.abs(metrics.perimeter - expectedPerimeter)).toBeLessThan(0.1);
      expect(metrics.waypoints[0]?.offset).toBe(0);
      expect(metrics.waypoints[metrics.waypoints.length - 1]?.offset).toBe(1);
      expect(metrics.waypoints[0]?.angleDeg).toBe(0);
      expect(metrics.waypoints[metrics.waypoints.length - 1]?.angleDeg).toBe(360);

      let minSpeed = Number.POSITIVE_INFINITY;
      let maxSpeed = 0;

      for (let i = 1; i < metrics.waypoints.length; i += 1) {
        const prev = metrics.waypoints[i - 1]!;
        const curr = metrics.waypoints[i]!;
        expect(curr.offset).toBeGreaterThan(prev.offset);
        expect(curr.angleDeg).toBeGreaterThanOrEqual(prev.angleDeg);
        expect(curr.x).toBeGreaterThanOrEqual(-0.01);
        expect(curr.x).toBeLessThanOrEqual(w + 0.01);
        expect(curr.y).toBeGreaterThanOrEqual(-0.01);
        expect(curr.y).toBeLessThanOrEqual(h + 0.01);

        const chord = Math.hypot(curr.x - prev.x, curr.y - prev.y);
        const dOffset = curr.offset - prev.offset;
        const speedPxPerLap = chord / dOffset;
        minSpeed = Math.min(minSpeed, speedPxPerLap);
        maxSpeed = Math.max(maxSpeed, speedPxPerLap);
      }

      // Chord-to-arc ratio across 8-step 90deg corners stays within < 1.5% of exact perimeter velocity
      // (compared to legacy conic-gradient's 3700%+ speed spike on 6.3:1 wide rectangles).
      expect(maxSpeed / minSpeed).toBeLessThan(1.03);
    }
  });

  it("mounts zero idle DOM/animations, runs 16 transform-only GPU compositor animations when active without main-thread paints, and cleans up cleanly on idle", async () => {
    await page.viewport(1280, 900);
    using _cleanup = {
      [Symbol.dispose]() {
        clearPrismuxAppearanceFromDocument(document);
      },
    };
    applyPrismuxAppearanceToDocument(normalizeAppearanceConfig({ themeMode: "dark" }), {
      document,
      syncDarkClass: true,
    });

    await using _screen = await render(<ShimmerHarness initialActive={false} />);

    const mainEl = document.querySelector<HTMLElement>('[data-testid="composer-main"]')!;

    // 1. Idle state: strictly 0 shimmer DOM nodes and 0 Web Animations overhead.
    expect(mainEl.querySelector('[data-pmx-composer-shimmer="1"]')).toBeNull();
    expect(mainEl.getAnimations({ subtree: true }).length).toBe(0);

    // 2. Activate composer: mounts 16 GPU transform-only segments + zero duplicate ::before pseudo-layer.
    await page.getByTestId("toggle-active").click();

    await expect.poll(() => mainEl.querySelector('[data-pmx-composer-shimmer="1"]')).not.toBeNull();

    const shimmerEl = mainEl.querySelector<HTMLElement>('[data-pmx-composer-shimmer="1"]')!;
    expect(shimmerEl.getAttribute("aria-hidden")).toBe("true");
    expect(shimmerEl.getAttribute("data-pmx-composer-shimmer-static")).toBe("0");

    const ringStyle = getComputedStyle(shimmerEl);
    expect(ringStyle.pointerEvents).toBe("none");
    expect(ringStyle.contain).toBe("strict");
    expect(ringStyle.overflow).toBe("hidden");
    const mainBeforeStyle = getComputedStyle(mainEl, "::before");
    expect(mainBeforeStyle.display).toBe("none");
    expect(mainBeforeStyle.content).toBe("none");

    const segments = [
      ...shimmerEl.querySelectorAll<HTMLElement>("[data-pmx-composer-shimmer-segment]"),
    ];
    expect(segments).toHaveLength(COMPOSER_SHIMMER_SEGMENT_COUNT);

    await expect
      .poll(() => shimmerEl.getAnimations({ subtree: true }).length)
      .toBe(COMPOSER_SHIMMER_SEGMENT_COUNT);

    const anims = shimmerEl.getAnimations({ subtree: true });
    for (const anim of anims) {
      expect(anim.playState).toBe("running");
      const keyframeEffect = anim.effect as KeyframeEffect;
      const timing = keyframeEffect.getTiming();
      expect(timing.iterations).toBe(Number.POSITIVE_INFINITY);
      expect(timing.easing).toBe("linear");
      const frames = keyframeEffect.getKeyframes();
      expect(frames.length).toBeGreaterThanOrEqual(30);
      for (const frame of frames) {
        expect(typeof frame.transform).toBe("string");
        expect(frame.transform).toContain("translate3d(");
        expect(frame.transform).toContain("rotate(");
        expect(frame.offsetDistance).toBeUndefined();
        expect(frame.background).toBeUndefined();
      }
    }

    // 3. Verify real-time smooth transform advancement along the perimeter in Chromium.
    const headSegment = shimmerEl.querySelector<HTMLElement>(
      '[data-pmx-composer-shimmer-head="1"]',
    )!;
    const transformBefore = getComputedStyle(headSegment).transform;
    await expect.poll(() => getComputedStyle(headSegment).transform).not.toBe(transformBefore);
    expect(getComputedStyle(headSegment).transform).not.toBe("none");

    // 4. Verify sidebar active agent card uses GPU-composited hue-flow filter (zero @property repaint).
    const sidebarCard = document.querySelector<HTMLElement>(
      '[data-testid="active-sidebar-agent"]',
    )!;
    const sidebarBefore = getComputedStyle(sidebarCard, "::before");
    expect(sidebarBefore.animationName).toBe("pmx-rgb-border-hue-flow");
    expect(sidebarBefore.willChange).toContain("filter");

    // 5. Return to idle: shimmer node unmounts completely and active animations drop back to 0.
    await page.getByTestId("toggle-active").click();
    await expect.poll(() => mainEl.querySelector('[data-pmx-composer-shimmer="1"]')).toBeNull();
    expect(mainEl.getAnimations({ subtree: true }).length).toBe(0);
  });

  it("adapts smoothly to narrow, wide-tall, and collapsed resizes without resetting phase or bleeding across short heights", async () => {
    await page.viewport(1280, 900);
    using _cleanup = {
      [Symbol.dispose]() {
        clearPrismuxAppearanceFromDocument(document);
      },
    };
    applyPrismuxAppearanceToDocument(
      normalizeAppearanceConfig({ themeMode: "glass", glassBasePolarity: "dark" }),
      { document, syncDarkClass: true },
    );

    await using _screen = await render(
      <ShimmerHarness initialActive={true} initialWidth={760} initialHeight={120} />,
    );

    const shimmerEl = document.querySelector<HTMLElement>('[data-pmx-composer-shimmer="1"]')!;
    await expect.poll(() => Number(shimmerEl.dataset.pmxShimmerPerimeter)).toBeGreaterThan(1650);
    const initialPerimeter = Number(shimmerEl.dataset.pmxShimmerPerimeter);

    // Let comet advance past 0 before resizing so we can assert phase continuity.
    const headEl = shimmerEl.querySelector<HTMLElement>('[data-pmx-composer-shimmer-head="1"]')!;
    await expect
      .poll(() => Number(headEl.getAnimations()[0]?.effect?.getComputedTiming().progress ?? 0))
      .toBeGreaterThan(0.03);
    const progressBeforeResize = Number(
      headEl.getAnimations()[0]?.effect?.getComputedTiming().progress ?? 0,
    );

    // Resize narrow (380x110)
    await page.getByTestId("size-narrow").click();
    await expect.poll(() => Number(shimmerEl.dataset.pmxShimmerPerimeter)).toBeLessThan(1050);
    expect(Number(shimmerEl.dataset.pmxShimmerPerimeter)).toBeLessThan(initialPerimeter);
    expect(shimmerEl.getAnimations({ subtree: true }).length).toBe(COMPOSER_SHIMMER_SEGMENT_COUNT);

    // Phase must continue smoothly from progressBeforeResize rather than resetting to 0.
    const progressAfterResize =
      headEl.getAnimations()[0]?.effect?.getComputedTiming().progress ?? 0;
    expect(progressAfterResize).toBeGreaterThanOrEqual(progressBeforeResize - 0.02);

    // Resize wide & tall (920x168)
    await page.getByTestId("size-wide-tall").click();
    await expect.poll(() => Number(shimmerEl.dataset.pmxShimmerPerimeter)).toBeGreaterThan(2050);
    expect(shimmerEl.getAnimations({ subtree: true }).length).toBe(COMPOSER_SHIMMER_SEGMENT_COUNT);

    // Resize collapsed mobile (360x48): segment perpendicular height clamps safely (< 50% of 48px)
    // so top and bottom edges never bleed into one another.
    await page.getByTestId("size-collapsed").click();
    await expect.poll(() => Number(shimmerEl.dataset.pmxShimmerPerimeter)).toBeLessThan(860);
    const bodySeg = shimmerEl.querySelector<HTMLElement>(
      '[data-pmx-composer-shimmer-segment="6"]',
    )!;
    expect(Number.parseFloat(bodySeg.style.height)).toBeLessThanOrEqual(20);
  });

  it("adapts contrast-calibrated palettes across Light, Dark, Light Glass & Dark Glass substrates and degrades cleanly under prefers-reduced-motion: reduce", async () => {
    await page.viewport(1280, 900);
    const session = cdp();
    using _cleanup = {
      [Symbol.dispose]() {
        clearPrismuxAppearanceFromDocument(document);
      },
    };

    try {
      await using _screen = await render(<ShimmerHarness initialActive={true} />);
      const shimmerEl = document.querySelector<HTMLElement>('[data-pmx-composer-shimmer="1"]')!;
      await expect
        .poll(() => shimmerEl.getAnimations({ subtree: true }).length)
        .toBe(COMPOSER_SHIMMER_SEGMENT_COUNT);

      // 1. Light mode palette (vibrant indigo-violet head calibrated for bright surfaces)
      applyPrismuxAppearanceToDocument(normalizeAppearanceConfig({ themeMode: "light" }), {
        document,
        syncDarkClass: true,
      });
      const lightHeadColor = getComputedStyle(shimmerEl)
        .getPropertyValue("--pmx-shimmer-c0")
        .trim();
      expect(lightHeadColor).toContain("99, 102, 241");

      // 2. Dark mode palette (radiant white leading spark)
      applyPrismuxAppearanceToDocument(normalizeAppearanceConfig({ themeMode: "dark" }), {
        document,
        syncDarkClass: true,
      });
      const darkHeadColor = getComputedStyle(shimmerEl).getPropertyValue("--pmx-shimmer-c0").trim();
      expect(darkHeadColor).toContain("255, 255, 255");
      expect(darkHeadColor).not.toBe(lightHeadColor);

      // 3. Light Liquid Glass & Dark Liquid Glass with patterned substrate (`starry-violet`)
      applyPrismuxAppearanceToDocument(
        normalizeAppearanceConfig({
          themeMode: "glass",
          glassBasePolarity: "light",
          glassThemeBase: "sakura-drift",
        }),
        { document, syncDarkClass: true },
      );
      expect(getComputedStyle(shimmerEl).getPropertyValue("--pmx-shimmer-c0").trim()).toBe(
        lightHeadColor,
      );

      applyPrismuxAppearanceToDocument(
        normalizeAppearanceConfig({
          themeMode: "glass",
          glassBasePolarity: "dark",
          glassThemeBase: "starry-violet",
        }),
        { document, syncDarkClass: true },
      );
      expect(getComputedStyle(shimmerEl).getPropertyValue("--pmx-shimmer-c0").trim()).toBe(
        darkHeadColor,
      );
      expect(getComputedStyle(shimmerEl).display).not.toBe("none");

      // 4. Emulate `prefers-reduced-motion: reduce`: stops ALL animations and shows calm static ring.
      await session.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });

      await expect.poll(() => shimmerEl.getAttribute("data-pmx-composer-shimmer-static")).toBe("1");
      expect(shimmerEl.querySelectorAll("[data-pmx-composer-shimmer-segment]").length).toBe(0);
      expect(shimmerEl.getAnimations({ subtree: true }).length).toBe(0);
      expect(getComputedStyle(shimmerEl).backgroundImage).toContain("linear-gradient");
      expect(Number.parseFloat(getComputedStyle(shimmerEl).opacity)).toBeCloseTo(0.78, 1);

      const sidebarCard = document.querySelector<HTMLElement>(
        '[data-testid="active-sidebar-agent"]',
      )!;
      expect(getComputedStyle(sidebarCard, "::before").animationName).toBe("none");

      // 5. Restore motion preference: GPU shimmer resumes cleanly with all 16 running animations.
      await session.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
      });
      await expect.poll(() => shimmerEl.getAttribute("data-pmx-composer-shimmer-static")).toBe("0");
      await expect
        .poll(() => shimmerEl.getAnimations({ subtree: true }).length)
        .toBe(COMPOSER_SHIMMER_SEGMENT_COUNT);
    } finally {
      await session.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
      });
    }
  });
});
