// @effect-diagnostics nodeBuiltinImport:off - EventEmitter simulates Electron WebContents/Debugger lifecycle events in tests.
import * as NodeEvents from "node:events";
import {
  CURATED_MOBILE_VIEWPORT_PRESET_IDS,
  CURATED_MOBILE_VIEWPORT_PRESETS,
  findPreviewViewportPreset,
  resolvePreviewDeviceEmulation,
  resolvePreviewViewport,
} from "@t3tools/shared/previewViewport";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as DesktopBrowserHost from "./DesktopBrowserHost.ts";
import { applyPreviewDeviceEmulation, type PreviewCdpDebuggerLike } from "./Manager.ts";

describe("preview mobile viewport presets & CDP emulation", () => {
  it("exposes all 6 curated mobile presets with full emulation metadata", () => {
    expect(CURATED_MOBILE_VIEWPORT_PRESET_IDS).toEqual([
      "iphone-16-pro",
      "iphone-se",
      "pixel-8",
      "xiaomi-huawei-360",
      "foldable-unfolded",
      "ipad-mini",
    ]);
    expect(CURATED_MOBILE_VIEWPORT_PRESETS).toHaveLength(6);

    const byId = new Map(CURATED_MOBILE_VIEWPORT_PRESETS.map((preset) => [preset.id, preset]));
    expect(byId.get("iphone-16-pro")).toMatchObject({
      width: 393,
      height: 852,
      deviceScaleFactor: 3,
      mobile: true,
      hasTouch: true,
    });
    expect(byId.get("iphone-se")).toMatchObject({
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      mobile: true,
      hasTouch: true,
    });
    expect(byId.get("pixel-8")).toMatchObject({
      width: 412,
      height: 915,
      deviceScaleFactor: 2.625,
      mobile: true,
      hasTouch: true,
    });
    expect(byId.get("xiaomi-huawei-360")).toMatchObject({
      width: 360,
      height: 800,
      deviceScaleFactor: 3,
      mobile: true,
      hasTouch: true,
    });
    expect(byId.get("foldable-unfolded")).toMatchObject({
      width: 712,
      height: 1138,
      deviceScaleFactor: 2,
      mobile: true,
      hasTouch: true,
    });
    expect(byId.get("ipad-mini")).toMatchObject({
      width: 744,
      height: 1133,
      deviceScaleFactor: 2,
      mobile: true,
      hasTouch: true,
    });

    for (const preset of CURATED_MOBILE_VIEWPORT_PRESETS) {
      expect(preset.userAgent.length).toBeGreaterThan(20);
      expect(preset.bezelStyle).toBeTruthy();
      expect(preset.colorScheme).toBeTruthy();
    }
  });

  it("applies mobile CDP metrics, touch, UA and media overrides and cleanly restores desktop mode", async () => {
    const commands: Array<{ method: string; params?: Record<string, unknown> | undefined }> = [];
    const fakeDebugger: PreviewCdpDebuggerLike = {
      async sendCommand(method, params) {
        commands.push({ method, params });
        return {};
      },
    };

    const preset = findPreviewViewportPreset("iphone-16-pro");
    expect(preset).toBeDefined();
    const viewport = resolvePreviewViewport({
      mode: "preset",
      preset: "iphone-16-pro",
      orientation: "portrait",
    });
    const emulation = resolvePreviewDeviceEmulation(viewport, "dark", 1);
    expect(emulation).not.toBeNull();
    expect(emulation?.enabled).toBe(true);
    expect(emulation?.scale).toBe(1);

    await applyPreviewDeviceEmulation(fakeDebugger, emulation, "light");

    expect(
      commands.some((entry) => entry.method === "Emulation.setEmitTouchEventsForMouse"),
    ).toBe(false);
    expect(commands.slice(0, 4)).toEqual([
      {
        method: "Emulation.setDeviceMetricsOverride",
        params: {
          width: 393,
          height: 852,
          deviceScaleFactor: 0,
          mobile: true,
          scale: 1,
          screenWidth: 393,
          screenHeight: 852,
          positionX: 0,
          positionY: 0,
          screenOrientation: { type: "portraitPrimary", angle: 0 },
        },
      },
      {
        method: "Emulation.setTouchEmulationEnabled",
        params: {
          enabled: true,
          maxTouchPoints: 5,
        },
      },
      {
        method: "Emulation.setUserAgentOverride",
        params: {
          userAgent: preset!.userAgent,
          platform: "iPhone",
        },
      },
      {
        method: "Emulation.setEmulatedMedia",
        params: {
          features: [{ name: "prefers-color-scheme", value: "dark" }],
        },
      },
    ]);
    expect(commands[4]?.method).toBe("Runtime.evaluate");
    expect(String(commands[4]?.params?.expression)).toContain("ontouchstart");

    commands.length = 0;
    const desktopEmulation = resolvePreviewDeviceEmulation({ _tag: "fill" });
    expect(desktopEmulation).toBeNull();
    await applyPreviewDeviceEmulation(fakeDebugger, desktopEmulation, "light");

    expect(commands.slice(0, 4)).toEqual([
      {
        method: "Emulation.clearDeviceMetricsOverride",
        params: {},
      },
      {
        method: "Emulation.setTouchEmulationEnabled",
        params: {
          enabled: false,
        },
      },
      {
        method: "Emulation.setUserAgentOverride",
        params: {
          userAgent: "",
        },
      },
      {
        method: "Emulation.setEmulatedMedia",
        params: {
          features: [{ name: "prefers-color-scheme", value: "light" }],
        },
      },
    ]);
    expect(commands[4]?.method).toBe("Runtime.evaluate");
    expect(String(commands[4]?.params?.expression)).toContain("delete window.ontouchstart");
  });

  it("supports landscape rotation with landscapePrimary screenOrientation and Linux Android platform", async () => {
    const viewport = resolvePreviewViewport({
      mode: "preset",
      preset: "pixel-8",
      orientation: "landscape",
    });
    const landscape = resolvePreviewDeviceEmulation(viewport, undefined, 0.54);
    expect(landscape).not.toBeNull();
    expect(landscape?.width).toBe(915);
    expect(landscape?.height).toBe(412);
    expect(landscape?.deviceScaleFactor).toBe(2.625);
    expect(landscape?.scale).toBe(0.54);
    expect(landscape?.mobile).toBe(true);
    expect(landscape?.hasTouch).toBe(true);

    const commands: Array<{ method: string; params?: Record<string, unknown> | undefined }> = [];
    await applyPreviewDeviceEmulation(
      {
        async sendCommand(method, params) {
          commands.push({ method, params });
          return {};
        },
      },
      landscape,
    );

    expect(commands[0]).toEqual({
      method: "Emulation.setDeviceMetricsOverride",
      params: {
        width: 915,
        height: 412,
        deviceScaleFactor: 0,
        mobile: true,
        scale: 1,
        screenWidth: 915,
        screenHeight: 412,
        positionX: 0,
        positionY: 0,
        screenOrientation: { type: "landscapePrimary", angle: 90 },
      },
    });
    expect(commands[2]).toMatchObject({
      method: "Emulation.setUserAgentOverride",
      params: {
        platform: "Linux armv81",
      },
    });
  });

  it("aborts promptly with a timeout error if a CDP emulation command hangs", async () => {
    const viewport = resolvePreviewViewport({
      mode: "preset",
      preset: "iphone-16-pro",
      orientation: "portrait",
    });
    const emulation = resolvePreviewDeviceEmulation(viewport);
    const hangingDebugger: PreviewCdpDebuggerLike = {
      sendCommand: () => new Promise(() => {}),
    };

    await expect(
      applyPreviewDeviceEmulation(hangingDebugger, emulation, "system", 30),
    ).rejects.toThrow(/timed out/i);
  });

  it("replays CDP mobile emulation across did-start-navigation, did-navigate, dom-ready and did-finish-load and restores cleanly", async () => {
    const host = await Effect.runPromise(DesktopBrowserHost.make);
    const commands: Array<{ method: string; params?: Record<string, unknown> | undefined }> = [];
    const wcEmitter = Object.assign(new NodeEvents.EventEmitter(), {
      isLoadingMainFrame: () => false,
      isDestroyed: () => false,
    });
    const dbgEmitter = Object.assign(new NodeEvents.EventEmitter(), {
      sendCommand: async (method: string, params?: Record<string, unknown>) => {
        commands.push({ method, params });
        return {};
      },
    });
    const tabKey = { threadId: "thread-mobile", tabId: "tab-mobile" };
    const viewport = resolvePreviewViewport({
      mode: "preset",
      preset: "iphone-16-pro",
      orientation: "portrait",
    });
    const emulation = resolvePreviewDeviceEmulation(viewport, "dark");

    host.attach(tabKey, {
      webContents: wcEmitter as unknown as Electron.WebContents,
      debugger: dbgEmitter as unknown as Electron.Debugger,
    });
    const flushAsync = () => Effect.runPromise(Effect.sleep("15 millis"));

    host.setDeviceEmulation(tabKey, emulation);
    await flushAsync();

    const metricsCount = () =>
      commands.filter((entry) => entry.method === "Emulation.setDeviceMetricsOverride").length;
    expect(metricsCount()).toBe(1);

    // Subframe or same-document navigation should NOT needlessly replay.
    wcEmitter.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
    wcEmitter.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    await flushAsync();
    expect(metricsCount()).toBe(1);

    // Real main-frame lifecycle events must each replay CDP emulation.
    wcEmitter.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    wcEmitter.emit("did-navigate");
    wcEmitter.emit("dom-ready");
    wcEmitter.emit("did-finish-load");
    await flushAsync();
    expect(metricsCount()).toBe(5);

    // Clearing emulation restores desktop overrides immediately.
    commands.length = 0;
    host.setDeviceEmulation(tabKey, null);
    await flushAsync();
    expect(commands.map((entry) => entry.method)).toEqual([
      "Emulation.clearDeviceMetricsOverride",
      "Emulation.setTouchEmulationEnabled",
      "Emulation.setUserAgentOverride",
      "Emulation.setEmulatedMedia",
      "Runtime.evaluate",
    ]);

    host.detach(tabKey);
  });
});
