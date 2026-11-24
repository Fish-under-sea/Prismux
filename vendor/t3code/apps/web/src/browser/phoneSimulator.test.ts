import {
  CURATED_MOBILE_VIEWPORT_PRESET_IDS,
  CURATED_MOBILE_VIEWPORT_PRESETS,
  DEFAULT_MOBILE_SIMULATOR_PRESET_ID,
  resolvePreviewDeviceEmulation,
  resolvePreviewViewport,
} from "@t3tools/shared/previewViewport";
import { GTProvider, initializeGT } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { PhoneSimulatorBlankStage } from "~/components/RightPanelTabs";
import { useRightPanelStore } from "~/rightPanelStore";
import { BROWSER_DEVICE_TOOLBAR_HEIGHT } from "./browserViewportLayout";
import {
  clampBrowserRectAboveStatusBar,
  resolveHostedWebviewRenderStyle,
  resolvePhoneBezelChassisLayout,
} from "./HostedBrowserWebview";

describe("Phone Simulator presets and CDP device emulation mapping", () => {
  it("exposes all 6 curated mobile presets with iPhone 16 Pro as default", () => {
    expect(DEFAULT_MOBILE_SIMULATOR_PRESET_ID).toBe("iphone-16-pro");
    expect(CURATED_MOBILE_VIEWPORT_PRESET_IDS).toEqual([
      "iphone-16-pro",
      "iphone-se",
      "pixel-8",
      "xiaomi-huawei-360",
      "foldable-unfolded",
      "ipad-mini",
    ]);
    expect(CURATED_MOBILE_VIEWPORT_PRESETS).toHaveLength(6);
    for (const preset of CURATED_MOBILE_VIEWPORT_PRESETS) {
      expect(preset.mobile).toBe(true);
      expect(preset.hasTouch).toBe(true);
      expect(preset.bezelStyle).not.toBe("none");
      expect(preset.userAgent.length).toBeGreaterThan(20);
    }
  });

  it("emits mobile CDP emulation payload for phone presets and restores desktop null on fill/freeform", () => {
    const iphoneViewport = resolvePreviewViewport({
      mode: "preset",
      preset: DEFAULT_MOBILE_SIMULATOR_PRESET_ID,
    });
    const emulation = resolvePreviewDeviceEmulation(iphoneViewport, "dark");
    expect(emulation).not.toBeNull();
    expect(emulation).toMatchObject({
      enabled: true,
      presetId: "iphone-16-pro",
      width: 393,
      height: 852,
      deviceScaleFactor: 3,
      mobile: true,
      hasTouch: true,
      colorScheme: "dark",
    });

    // Landscape rotation preserves preset metadata with swapped dimensions.
    const landscapeViewport = resolvePreviewViewport({
      mode: "preset",
      preset: "xiaomi-huawei-360",
      orientation: "landscape",
    });
    const landscapeEmulation = resolvePreviewDeviceEmulation(landscapeViewport, "light");
    expect(landscapeEmulation).toMatchObject({
      presetId: "xiaomi-huawei-360",
      width: 800,
      height: 360,
      mobile: true,
      colorScheme: "light",
    });

    // Returning to desktop fill or freeform clears CDP emulation cleanly.
    expect(resolvePreviewDeviceEmulation({ _tag: "fill" })).toBeNull();
    expect(
      resolvePreviewDeviceEmulation({ _tag: "freeform", width: 1280, height: 800 }),
    ).toBeNull();
  });

  it("clamps preview wrapper strictly above bottom 20px status bar and fits phone chassis inside panel bounds", () => {
    // Reproduces verifier Bug 3b: slot rect extending down to y=902 on a 900px window with 20px status bar (top=880).
    const clamped = clampBrowserRectAboveStatusBar(
      { x: 900, y: 112, width: 540, height: 790 },
      900,
      880,
    );
    expect(clamped).not.toBeNull();
    expect(clamped!.y + clamped!.height).toBeLessThanOrEqual(880);

    const portraitViewport = resolvePreviewViewport({
      mode: "preset",
      preset: "iphone-16-pro",
    });
    if (portraitViewport._tag === "fill") throw new Error("expected preset");
    const portraitChassis = resolvePhoneBezelChassisLayout(
      { width: 540, height: 764 },
      portraitViewport,
      1,
      "dynamic-island",
    );
    // Zero toolbar overlap and strictly above bottom edge (zero negative margins).
    expect(portraitChassis.frameY).toBeGreaterThanOrEqual(BROWSER_DEVICE_TOOLBAR_HEIGHT + 8);
    expect(portraitChassis.frameY + portraitChassis.frameHeight).toBeLessThanOrEqual(764 - 10);
    // Screen sits strictly below top status bar and above bottom home indicator.
    expect(portraitChassis.screenY).toBeGreaterThanOrEqual(
      portraitChassis.frameY + portraitChassis.borderWidth + portraitChassis.topChromeHeight,
    );
    expect(
      portraitChassis.screenY +
        portraitChassis.screenHeight +
        portraitChassis.bottomChromeHeight +
        portraitChassis.borderWidth,
    ).toBeLessThanOrEqual(portraitChassis.frameY + portraitChassis.frameHeight);

    const landscapeViewport = resolvePreviewViewport({
      mode: "preset",
      preset: "iphone-16-pro",
      orientation: "landscape",
    });
    if (landscapeViewport._tag === "fill") throw new Error("expected preset");
    const landscapeChassis = resolvePhoneBezelChassisLayout(
      { width: 540, height: 764 },
      landscapeViewport,
      1,
      "dynamic-island",
    );
    expect(landscapeChassis.isLandscape).toBe(true);
    expect(landscapeChassis.frameX).toBeGreaterThanOrEqual(12);
    expect(landscapeChassis.frameX + landscapeChassis.frameWidth).toBeLessThanOrEqual(540 - 12);
    expect(landscapeChassis.frameY + landscapeChassis.frameHeight).toBeLessThanOrEqual(764 - 10);
  });

  it("activates blank-page Phone Simulator immediately and preserves custom preset/orientation until handoff", () => {
    const store = useRightPanelStore.getState();
    store.setMobileSimulatorIdleActive(false);
    store.setPendingMobileSimulatorSetting(null);

    store.requestMobileSimulatorLaunch();
    expect(useRightPanelStore.getState().mobileSimulatorIdleActive).toBe(true);
    expect(useRightPanelStore.getState().pendingMobileSimulatorPresetId).toBe("iphone-16-pro");

    // User rotates phone while still on the blank start guide.
    const rotated = resolvePreviewViewport({
      mode: "preset",
      preset: "pixel-8",
      orientation: "landscape",
    });
    if (rotated._tag === "fill") throw new Error("expected preset");
    useRightPanelStore.getState().setPendingMobileSimulatorSetting(rotated);

    // When a real URL loads, HostedBrowserWebview consumes the exact customized setting.
    const consumed = useRightPanelStore.getState().consumeMobileSimulatorSetting();
    expect(consumed).toEqual(rotated);
    expect(useRightPanelStore.getState().consumeMobileSimulatorSetting()).toBeNull();
  });

  it("renders PhoneSimulatorBlankStage cleanly with device toolbar and phone bezel (zero React #185 loop)", () => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });
    const store = useRightPanelStore.getState();
    store.requestMobileSimulatorLaunch("iphone-16-pro");

    const html = renderToStaticMarkup(
      createElement(GTProvider, { locale: "en", translations: {} }, createElement(PhoneSimulatorBlankStage)),
    );
    expect(html).toContain("prismux-phone-simulator-blank-stage");
    expect(html).toContain("prismux-phone-bezel-frame");
    expect(html).toContain("Prismux 手机模拟已就绪");
    expect(html).not.toContain("手机模拟器");
    expect(html).toContain("iPhone 16 Pro");
    expect(html).toContain("393 × 852");
    expect(html).toContain("phone-simulator-quick-url-input");
  });

  it("scales logical mobile webview via CSS fitScale with CDP scale=1 for zero right/bottom clipping", () => {
    const portraitViewport = resolvePreviewViewport({ mode: "preset", preset: "iphone-16-pro" });
    const emulation = resolvePreviewDeviceEmulation(portraitViewport, "dark", 1);
    expect(emulation?.scale).toBe(1);

    // Portrait 393×852 fitted into a 306×665 bezel slot: webview keeps exact logical 393×852 box
    // (minWidth/maxWidth locked against flex squash) and scales by min(306/393, 665/852) <= slot.
    const portraitStyle = resolveHostedWebviewRenderStyle({
      viewportWidth: 306,
      viewportHeight: 665,
      viewportScale: 665 / 852,
      logicalWidth: 393,
      logicalHeight: 852,
      cdpEmulationActive: true,
      fullDetail: false,
    });
    expect(portraitStyle.width).toBe(393);
    expect(portraitStyle.height).toBe(852);
    expect(portraitStyle.minWidth).toBe(393);
    expect(portraitStyle.maxWidth).toBe("none");
    expect(portraitStyle.minHeight).toBe(852);
    expect(portraitStyle.maxHeight).toBe("none");
    expect(portraitStyle.transformOrigin).toBe("top left");
    const portraitScaleMatch = portraitStyle.transform?.match(/^scale\((.+)\)$/);
    expect(portraitScaleMatch).not.toBeNull();
    const portraitFitScale = Number(portraitScaleMatch![1]);
    expect(portraitStyle.width * portraitFitScale).toBeLessThanOrEqual(306 + 1e-6);
    expect(portraitStyle.height * portraitFitScale).toBeLessThanOrEqual(665 + 1e-6);

    // Landscape 852×393 fitted into a 480×221 bezel slot: exact logical 852×393 + fitScale <= slot.
    const landscapeStyle = resolveHostedWebviewRenderStyle({
      viewportWidth: 480,
      viewportHeight: 221,
      viewportScale: 480 / 852,
      logicalWidth: 852,
      logicalHeight: 393,
      cdpEmulationActive: true,
      fullDetail: false,
    });
    expect(landscapeStyle.width).toBe(852);
    expect(landscapeStyle.height).toBe(393);
    const landscapeScaleMatch = landscapeStyle.transform?.match(/^scale\((.+)\)$/);
    expect(landscapeScaleMatch).not.toBeNull();
    const landscapeFitScale = Number(landscapeScaleMatch![1]);
    expect(landscapeStyle.width * landscapeFitScale).toBeLessThanOrEqual(480 + 1e-6);
    expect(landscapeStyle.height * landscapeFitScale).toBeLessThanOrEqual(221 + 1e-6);

    // Desktop non-CDP mode: retains CSS transform scaling.
    const desktopStyle = resolveHostedWebviewRenderStyle({
      viewportWidth: 640,
      viewportHeight: 400,
      viewportScale: 0.5,
      cdpEmulationActive: false,
      fullDetail: false,
    });
    expect(desktopStyle.width).toBe(1280);
    expect(desktopStyle.height).toBe(800);
    expect(desktopStyle.transform).toBe("scale(0.5)");
  });
});
