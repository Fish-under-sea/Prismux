import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { GTProvider, initializeGT } from "gt-react";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodePath from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import zhCatalog from "../i18n/translations/zh.json";
import {
  MINUTES_PER_DAY,
  SKY_FRAMES_PER_DAY,
  SKY_KEYFRAMES,
  SKY_STEP_MINUTES,
  SKY_TIME_CHANGE_EVENT,
  SKY_UPDATE_INTERVAL_MS,
  computeEffectiveTopSkyContrast,
  computeMsUntilNextSkyTick,
  computeSkyScene,
  parseHexRgb,
  quantizeMinutesToSkyStep,
  resolveEffectiveSkyMinutes,
} from "./sidebarSkyBackdrop.logic";
import {
  SidebarStageBackdrop,
  StageBackdropButtonArt,
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
} from "./SidebarStageBackdrop";

vi.mock("../prismux/settings/PrismuxAppearanceIntegration", () => ({
  PrismuxAppearanceIntegration: () =>
    createElement("section", { id: "prismux-appearance", "data-testid": "prismux-appearance" }),
}));

vi.mock("./settings/TypographySettings", () => ({
  TypographySection: () => createElement("section", { id: "typography-stub" }),
}));

vi.mock("./settings/ThreadDetailsItemsRow", () => ({
  ThreadDetailsItemsRow: () => createElement("div", { id: "thread-details-stub" }),
}));

vi.mock("./settings/useScopedSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./settings/useScopedSettings")>();
  return {
    ...actual,
    useScopedSettings: () => DEFAULT_UNIFIED_SETTINGS,
    useUpdateScopedSettings: () => vi.fn(),
  };
});

vi.mock("../hooks/useHandleNewThread", () => ({
  useNewThreadHandler: () => vi.fn(),
  useHandleNewThread: () => ({
    activeThread: null,
    activeDraftThread: null,
    defaultProjectRef: null,
    handleNewThread: vi.fn(),
  }),
}));

vi.mock("../navigationHistory", () => ({
  navigateHistory: vi.fn(),
  useCanNavigateHistory: () => false,
}));

vi.mock("./settings/AdvancedSettings", () => ({
  AdvancedSettings: ({
    targetIds,
    children,
  }: {
    readonly targetIds: ReadonlyArray<string>;
    readonly children: ReactNode;
  }) =>
    createElement(
      "div",
      {
        "data-testid": "advanced-settings-probe",
        "data-target-ids": targetIds.join(","),
      },
      children,
    ),
}));

import { AppearanceSettingsPanel } from "./settings/AppearanceSettingsPanel";
import { SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { Sidebar, SidebarProvider } from "./ui/sidebar";
import { TooltipProvider } from "./ui/tooltip";

function rgbDistance(hexA: string, hexB: string): number {
  const a = parseHexRgb(hexA);
  const b = parseHexRgb(hexB);
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

afterEach(() => {
  delete (globalThis as typeof globalThis & { __PRISMUX_SKY_MINUTES__?: number })
    .__PRISMUX_SKY_MINUTES__;
});

describe("sidebarSkyBackdrop.logic 24-hour dynamic sky physics", () => {
  it("uses a 5-minute discrete cadence (288 frames/day) aligned to clock boundaries", () => {
    expect(SKY_STEP_MINUTES).toBe(5);
    expect(SKY_FRAMES_PER_DAY).toBe(288);
    expect(SKY_UPDATE_INTERVAL_MS).toBe(300_000);
    expect(SKY_KEYFRAMES.length).toBe(9);
    expect(SKY_TIME_CHANGE_EVENT).toBe("prismux:sky-time-change");

    expect(quantizeMinutesToSkyStep(0)).toBe(0);
    expect(quantizeMinutesToSkyStep(633)).toBe(630); // 10:33 -> 10:30
    expect(quantizeMinutesToSkyStep(1439)).toBe(1435); // 23:59 -> 23:55
    expect(quantizeMinutesToSkyStep(1445)).toBe(5); // wraps next day
    expect(quantizeMinutesToSkyStep(-3)).toBe(1435); // wraps negative safely

    // At 10:02:15.500 -> 2m 44.5s until 10:05:00.000
    const sampleDate = new Date(2026, 10, 24, 10, 2, 15, 500);
    expect(computeMsUntilNextSkyTick(sampleDate)).toBe(164_500);

    // At exact 10:05:00.000 -> full 5m until 10:10:00.000
    const boundaryDate = new Date(2026, 10, 24, 10, 5, 0, 0);
    expect(computeMsUntilNextSkyTick(boundaryDate)).toBe(300_000);
  });

  it("supports deterministic minutesOverride and window.__PRISMUX_SKY_MINUTES__ QA overrides", () => {
    const fixedNow = new Date(2026, 10, 24, 12, 34, 0, 0);
    expect(resolveEffectiveSkyMinutes({ now: fixedNow })).toBe(750); // 12:30

    (globalThis as typeof globalThis & { __PRISMUX_SKY_MINUTES__?: number })
      .__PRISMUX_SKY_MINUTES__ = 350; // 05:50
    expect(resolveEffectiveSkyMinutes({ now: fixedNow })).toBe(350);

    // Explicit prop override wins over global override
    expect(resolveEffectiveSkyMinutes({ now: fixedNow, minutesOverride: 1070 })).toBe(1070);
  });

  it("interpolates smoothly across all 288 5-minute steps with zero jarring jumps or midnight seam", () => {
    let maxStepSkyJump = 0;
    for (let step = 0; step < SKY_FRAMES_PER_DAY; step += 1) {
      const current = computeSkyScene(step * SKY_STEP_MINUTES);
      const next = computeSkyScene(((step + 1) * SKY_STEP_MINUTES) % MINUTES_PER_DAY);
      const jump = rgbDistance(current.palette.skyTop, next.palette.skyTop);
      if (jump > maxStepSkyJump) maxStepSkyJump = jump;

      // Every single 5-minute step across 24h must preserve >= 4.5:1 WCAG AA contrast for white header text.
      const contrast = computeEffectiveTopSkyContrast(current);
      expect(
        contrast.minHeaderContrast,
        `step ${step} (${current.minutes}m, phase=${current.phase})`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    // Consecutive 5-minute steps remain buttery smooth (small sRGB delta).
    expect(maxStepSkyJump).toBeLessThan(18);

    // Cloud drift is strictly periodic at 23:55 -> 00:00 (zero wrap-around jump).
    const beforeMidnight = computeSkyScene(1435);
    const midnight = computeSkyScene(0);
    expect(Math.abs(beforeMidnight.clouds.highDriftX - midnight.clouds.highDriftX)).toBeLessThan(1);
    expect(Math.abs(beforeMidnight.clouds.midDriftX - midnight.clouds.midDriftX)).toBeLessThan(1);
    expect(Math.abs(beforeMidnight.clouds.nearDriftX - midnight.clouds.nearDriftX)).toBeLessThan(1);
  });

  it("drives realistic sun & crescent moon parabolic arcs, starfield, and cloud palette shifts", () => {
    const midnight = computeSkyScene(0); // 00:00
    const sunrise = computeSkyScene(6 * 60 + 15); // 06:15
    const blueSky = computeSkyScene(10 * 60 + 30); // 10:30
    const noon = computeSkyScene(12 * 60 + 10); // 12:10
    const sunset = computeSkyScene(18 * 60 + 10); // 18:10
    const moonrise = computeSkyScene(19 * 60 + 45); // 19:45
    const starryNight = computeSkyScene(22 * 60 + 30); // 22:30

    // Midnight: high crescent moon + full stars, no sun
    expect(midnight.sun.visible).toBe(false);
    expect(midnight.moon.visible).toBe(true);
    expect(midnight.moon.y).toBeLessThan(26);
    expect(midnight.palette.starVisibility).toBe(1);

    // Sunrise (06:15): rising sun on left-eastern arc, warm apricot-gold horizon, stars gone
    expect(sunrise.sun.visible).toBe(true);
    expect(sunrise.sun.x).toBeLessThan(90);
    expect(sunrise.sun.y).toBeGreaterThan(40);
    expect(sunrise.moon.visible).toBe(false);
    expect(sunrise.palette.starVisibility).toBe(0);
    const sunriseHorizonRgb = parseHexRgb(sunrise.palette.skyHorizon);
    expect(sunriseHorizonRgb.r).toBeGreaterThan(220);

    // Morning blue sky (10:30): bright azure sky, climbing sun, pure white sunlit cumulus clouds, no moon/stars
    expect(blueSky.sun.visible).toBe(true);
    expect(blueSky.moon.visible).toBe(false);
    expect(blueSky.palette.starVisibility).toBe(0);
    expect(blueSky.sun.x).toBeGreaterThan(sunrise.sun.x);
    expect(blueSky.sun.y).toBeLessThan(sunrise.sun.y);
    const blueSkyMidRgb = parseHexRgb(blueSky.palette.skyMid);
    expect(blueSkyMidRgb.b).toBeGreaterThan(blueSkyMidRgb.r + 100);
    const dayCloudTopRgb = parseHexRgb(blueSky.palette.cloudHighlight);
    expect(dayCloudTopRgb.r).toBeGreaterThan(245);
    expect(dayCloudTopRgb.g).toBeGreaterThan(245);
    expect(dayCloudTopRgb.b).toBeGreaterThan(245);

    // Solar noon (~12:10): sun crests near highest point of arc (y ~ 18)
    expect(noon.sun.y).toBeLessThan(21);
    expect(noon.sun.y).toBeLessThan(blueSky.sun.y);

    // Golden sunset (18:10): setting sun on right-western arc, fiery coral/amber clouds
    expect(sunset.sun.visible).toBe(true);
    expect(sunset.sun.x).toBeGreaterThan(220);
    expect(sunset.sun.y).toBeGreaterThan(45);
    const sunsetCloudBodyRgb = parseHexRgb(sunset.palette.cloudBody);
    expect(sunsetCloudBodyRgb.r).toBeGreaterThan(sunsetCloudBodyRgb.b + 80);

    // Moonrise (19:45): sun set, crescent moon rising on eastern arc, emerging stars
    expect(moonrise.sun.visible).toBe(false);
    expect(moonrise.moon.visible).toBe(true);
    expect(moonrise.moon.x).toBeLessThan(100);
    expect(moonrise.palette.starVisibility).toBeGreaterThan(0.5);

    // Starry night (22:30): deep midnight palette, moon climbing higher, bright starfield, dark indigo clouds
    expect(starryNight.sun.visible).toBe(false);
    expect(starryNight.moon.visible).toBe(true);
    expect(starryNight.moon.x).toBeGreaterThan(moonrise.moon.x);
    expect(starryNight.moon.y).toBeLessThan(moonrise.moon.y);
    expect(starryNight.palette.starVisibility).toBeGreaterThan(0.9);
    const nightCloudBodyRgb = parseHexRgb(starryNight.palette.cloudBody);
    expect(nightCloudBodyRgb.r).toBeLessThan(60);
    expect(nightCloudBodyRgb.b).toBeGreaterThan(nightCloudBodyRgb.r + 30);
  });
});

describe("SidebarStageBackdrop default-on rendering & compact button art", () => {
  it("always resolves active sky backdrop regardless of release channel or legacy mode and suppresses Dev/Nightly pills", () => {
    for (const stage of ["", "Latest", "Dev", "Nightly", "Preview"]) {
      expect(resolveSidebarStageBackdropVariant(stage)).toBe("sky");
      expect(resolveSidebarStageBackdropVariant(stage, "none")).toBe("sky");
      expect(resolveSidebarStageBackdropVariant(stage, "pill")).toBe("sky");
      expect(resolveSidebarStageBackdropVariant(stage, "artwork")).toBe("sky");
      expect(resolveSidebarStageBackdropVariant(stage, "dev-artwork")).toBe("sky");
      expect(resolveSidebarStageBackdropVariant(stage, "nightly-artwork")).toBe("sky");
      expect(resolveEnvironmentIdentificationPillLabel(stage)).toBeNull();
    }
  });

  it("renders sculpted clouds, sun during daytime, and crescent moon + starfield at night", () => {
    const dayHtml = renderToStaticMarkup(
      createElement(SidebarStageBackdrop, { minutesOverride: 10 * 60 + 30 }),
    );
    expect(dayHtml).toContain('data-stage-backdrop="sky"');
    expect(dayHtml).toContain('data-stage-art="sky"');
    expect(dayHtml).toContain('viewBox="0 0 288 80"');
    expect(dayHtml).toContain('data-sky-body="sun"');
    expect(dayHtml).not.toContain('data-sky-body="moon"');
    expect(dayHtml).not.toContain('data-sky-layer="stars"');
    expect(dayHtml).toContain('data-sky-layer="clouds-cirrus"');
    expect(dayHtml).toContain('data-sky-layer="clouds-mid"');
    expect(dayHtml).toContain('data-sky-layer="clouds-near"');

    const sunsetHtml = renderToStaticMarkup(
      createElement(SidebarStageBackdrop, { minutesOverride: 18 * 60 + 10 }),
    );
    expect(sunsetHtml).toContain('data-sky-phase="sunset"');
    expect(sunsetHtml).toContain('data-sky-body="sun"');

    const nightHtml = renderToStaticMarkup(
      createElement(SidebarStageBackdrop, { minutesOverride: 22 * 60 + 30 }),
    );
    expect(nightHtml).toContain('data-sky-body="moon"');
    expect(nightHtml).toContain('data-sky-layer="stars"');
    expect(nightHtml).not.toContain('data-sky-body="sun"');
    expect(nightHtml).toContain('data-sky-layer="clouds-near"');

    // Compact send-button artwork mirrors day vs night sky cleanly.
    const compactDay = renderToStaticMarkup(
      createElement(StageBackdropButtonArt, { minutesOverride: 10 * 60 + 30 }),
    );
    const compactNight = renderToStaticMarkup(
      createElement(StageBackdropButtonArt, { minutesOverride: 22 * 60 + 30 }),
    );
    expect(compactDay).toContain('data-stage-art="sky-compact"');
    expect(compactDay).toContain('viewBox="0 0 36 36"');
    expect(compactNight).toContain('data-stage-art="sky-compact"');
    expect(compactNight).toContain("<mask");
  });

  it("mounts default-on dynamic sky backdrop inside SidebarChromeHeader in both expanded and 54px rail states without Dev/Nightly pills", async () => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });
    const zhTranslations = { zh: zhCatalog } as unknown as NonNullable<
      Parameters<typeof GTProvider>[0]["translations"]
    >;
    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    const RouterContextWrapper = RouterContextProvider as React.ComponentType<{
      readonly router: unknown;
      readonly children?: ReactNode;
    }>;

    (globalThis as typeof globalThis & { __PRISMUX_SKY_MINUTES__?: number })
      .__PRISMUX_SKY_MINUTES__ = 10 * 60 + 30;

    for (const defaultOpen of [true, false]) {
      const html = renderToStaticMarkup(
        createElement(
          RouterContextWrapper,
          { router },
          createElement(
            GTProvider,
            { locale: "zh", translations: zhTranslations },
            createElement(
              TooltipProvider,
              null,
              createElement(
                SidebarProvider,
                { defaultOpen },
                createElement(
                  Sidebar,
                  { side: "left", collapsible: "icon" },
                  createElement(SidebarChromeHeader, { isElectron: true }),
                ),
              ),
            ),
          ),
        ),
      );
      expect(html).toContain('data-stage-backdrop="sky"');
      expect(html).toContain('data-stage-art="sky"');
      expect(html).toContain('data-sky-body="sun"');
      expect(html).not.toContain('data-environment-identification="pill"');
      expect(html).not.toContain(">Dev<");
      expect(html).not.toContain(">Nightly<");
    }
  });
});

describe("AppearanceSettingsPanel deduplication", () => {
  it("omits Colors & themes, Glass opacity, and Environment identification while retaining Panel animations and Composer context", async () => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });
    const zhTranslations = { zh: zhCatalog } as unknown as NonNullable<
      Parameters<typeof GTProvider>[0]["translations"]
    >;
    const rootRoute = createRootRoute();
    const appearanceRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/settings/appearance",
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([appearanceRoute]),
      history: createMemoryHistory({ initialEntries: ["/settings/appearance"] }),
    });
    await router.load();
    const RouterContextWrapper = RouterContextProvider as React.ComponentType<{
      readonly router: unknown;
      readonly children?: ReactNode;
    }>;

    const html = renderToStaticMarkup(
      createElement(
        RouterContextWrapper,
        { router },
        createElement(
          GTProvider,
          { locale: "zh", translations: zhTranslations },
          createElement(AppearanceSettingsPanel),
        ),
      ),
    );

    // Prismux optical appearance hub stays mounted at top.
    expect(html).toContain('id="prismux-appearance"');

    // Legacy duplicate sections & rows are completely absent.
    expect(html).not.toContain('id="appearance"');
    expect(html).not.toContain("Colors &amp; themes");
    expect(html).not.toContain("颜色与主题");
    expect(html).not.toContain('id="setting-glass-opacity"');
    expect(html).not.toContain('id="glass-opacity"');
    expect(html).not.toContain("毛玻璃不透明度");
    expect(html).not.toContain('id="environment-identification"');
    expect(html).not.toContain("环境标识");

    // Non-duplicate Advanced controls remain intact and searchable.
    expect(html).toContain('data-target-ids="panel-animations,composer-context"');
    expect(html).toContain('id="panel-animations"');
    expect(html).toContain('id="panel-animation-duration"');
    expect(html).toContain('id="composer-context"');

    // Source-level sanity check: dead imports/state were cleaned up.
    const componentsDir = NodePath.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    );
    const panelSource = NodeFS.readFileSync(
      NodePath.join(componentsDir, "settings", "AppearanceSettingsPanel.tsx"),
      "utf8",
    );
    expect(panelSource).not.toContain("ThemeLibrary");
    expect(panelSource).not.toContain("setting-glass-opacity");
    expect(panelSource).not.toContain("environment-identification");
    expect(panelSource).not.toContain("useEnvironmentIdentificationMode");
  });
});
