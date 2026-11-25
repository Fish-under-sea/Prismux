import { assert, describe, it } from "@effect/vitest";

import {
  createElectronTrayController,
  destroySharedPrismuxTrayController,
  FALLBACK_PRISMUX_TRAY_ICON_DATA_URL,
  formatPrismuxTrayStatusLabel,
  formatPrismuxTrayTooltip,
  initSharedPrismuxTrayController,
  PRISMUX_TRAY_CONNECT_MOBILE_LABEL,
  PRISMUX_TRAY_COPY_MOBILE_URL_LABEL,
  PRISMUX_TRAY_IDLE_STATUS_LABEL,
  PRISMUX_TRAY_IDLE_TOOLTIP,
  PRISMUX_TRAY_MOBILE_QR_LABEL,
  PRISMUX_TRAY_MOBILE_SIMULATOR_LABEL,
  PRISMUX_TRAY_OPEN_APP_LABEL,
  PRISMUX_TRAY_QUIT_LABEL,
  PrismuxTrayController,
  queuePendingPrismuxTrayAction,
  resolvePrismuxTrayIconCandidatePaths,
  takePendingPrismuxTrayAction,
  updateSharedPrismuxTrayMobileUrl,
  updateSharedPrismuxTrayRunningAgentsCount,
  type PrismuxTrayActions,
  type PrismuxTrayElectronApi,
  type PrismuxTrayLike,
  type PrismuxTrayMenuItemTemplate,
  type PrismuxTrayNativeImageLike,
} from "./PrismuxTrayController.ts";

interface FakeImage extends PrismuxTrayNativeImageLike {
  readonly source: string;
  readonly resizedTo?: { width?: number; height?: number; quality?: string };
}

function createFakeImage(source: string, empty = false): FakeImage {
  const image: FakeImage = {
    source,
    isEmpty: () => empty,
    resize: (options) => ({
      ...createFakeImage(`${source}@${options.width ?? "?"}x${options.height ?? "?"}`, empty),
      resizedTo: options,
    }),
  };
  return image;
}

function createFakeElectronTrayHarness(options?: {
  readonly failCreateTray?: boolean;
  readonly emptyPaths?: ReadonlySet<string>;
}) {
  const tooltips: string[] = [];
  const builtTemplates: Array<readonly PrismuxTrayMenuItemTemplate[]> = [];
  const trayListeners = new Map<string, Set<(...args: readonly unknown[]) => void>>();
  let trayCreatedCount = 0;
  let trayDestroyCount = 0;
  let trayDestroyed = false;
  let lastCreatedIcon: FakeImage | null = null;
  const loadedPaths: string[] = [];
  const loadedDataUrls: string[] = [];

  const tray: PrismuxTrayLike = {
    setToolTip: (tip) => {
      tooltips.push(tip);
    },
    setContextMenu: () => {
      // Captured via buildMenuFromTemplate.
    },
    on: (event, listener) => {
      let set = trayListeners.get(event);
      if (!set) {
        set = new Set();
        trayListeners.set(event, set);
      }
      set.add(listener);
    },
    removeListener: (event, listener) => {
      trayListeners.get(event)?.delete(listener);
    },
    destroy: () => {
      trayDestroyCount += 1;
      trayDestroyed = true;
    },
    isDestroyed: () => trayDestroyed,
  };

  const api: PrismuxTrayElectronApi = {
    createTray: (icon) => {
      if (options?.failCreateTray) {
        throw new Error("headless environment has no tray");
      }
      trayCreatedCount += 1;
      trayDestroyed = false;
      lastCreatedIcon = icon as FakeImage;
      return tray;
    },
    buildMenuFromTemplate: (template) => {
      builtTemplates.push(template);
      return { items: template };
    },
    createImageFromPath: (imagePath) => {
      loadedPaths.push(imagePath);
      const isEmpty = options?.emptyPaths?.has(imagePath) ?? false;
      return createFakeImage(`path:${imagePath}`, isEmpty);
    },
    createImageFromDataUrl: (dataUrl) => {
      loadedDataUrls.push(dataUrl);
      return createFakeImage(`dataUrl:${dataUrl.slice(0, 32)}`, false);
    },
    createEmptyImage: () => createFakeImage("empty", true),
  };

  const emitTrayEvent = (event: string) => {
    for (const listener of trayListeners.get(event) ?? []) {
      listener();
    }
  };

  return {
    api,
    tray,
    tooltips,
    builtTemplates,
    trayListeners,
    loadedPaths,
    loadedDataUrls,
    emitTrayEvent,
    getTrayCreatedCount: () => trayCreatedCount,
    getTrayDestroyCount: () => trayDestroyCount,
    getLastCreatedIcon: () => lastCreatedIcon,
    getLatestTemplate: () => builtTemplates.at(-1) ?? [],
  };
}

function createFakeActions() {
  const events: string[] = [];
  const copiedTexts: string[] = [];
  const dispatchedActions: string[] = [];
  let openMainWindowCount = 0;
  let quitCount = 0;

  const actions: PrismuxTrayActions = {
    openMainWindow: () => {
      openMainWindowCount += 1;
      events.push("openMainWindow");
    },
    dispatchTrayAction: (action) => {
      dispatchedActions.push(action);
      events.push(`action:${action}`);
    },
    copyText: (text) => {
      copiedTexts.push(text);
      events.push(`copy:${text}`);
    },
    quitApp: () => {
      quitCount += 1;
      events.push("quitApp");
    },
  };

  return {
    actions,
    events,
    copiedTexts,
    dispatchedActions,
    getOpenMainWindowCount: () => openMainWindowCount,
    getQuitCount: () => quitCount,
  };
}

describe("PrismuxTrayController", () => {
  it("builds the exact 4-section context menu structure and updates dynamically between 0 and N running agents", () => {
    const harness = createFakeElectronTrayHarness();
    const fakeActions = createFakeActions();
    const controller = new PrismuxTrayController({
      api: harness.api,
      actions: fakeActions.actions,
      platform: "win32",
      initialMobileUrl: "http://192.168.1.42:3773/",
    });

    assert.isTrue(controller.start());
    assert.isTrue(controller.isActive());

    // Initial 0 running agents state.
    assert.equal(harness.tooltips.at(-1), PRISMUX_TRAY_IDLE_TOOLTIP);
    assert.equal(formatPrismuxTrayTooltip(0), "Prismux — 24h 守护待命中");
    assert.equal(formatPrismuxTrayStatusLabel(0), "暂无正在运行的智能体");

    const idleTemplate = harness.getLatestTemplate();
    assert.equal(idleTemplate.length, 5);
    assert.equal(idleTemplate[0]?.label, PRISMUX_TRAY_IDLE_STATUS_LABEL);
    assert.equal(idleTemplate[0]?.enabled, false);
    assert.equal(idleTemplate[1]?.type, "separator");
    assert.equal(idleTemplate[2]?.label, PRISMUX_TRAY_CONNECT_MOBILE_LABEL);
    assert.deepEqual(
      idleTemplate[2]?.submenu?.map((item) => item.label),
      [
        PRISMUX_TRAY_MOBILE_QR_LABEL,
        PRISMUX_TRAY_MOBILE_SIMULATOR_LABEL,
        PRISMUX_TRAY_COPY_MOBILE_URL_LABEL,
      ],
    );
    assert.equal(idleTemplate[2]?.submenu?.[2]?.enabled, true);
    assert.equal(idleTemplate[3]?.label, PRISMUX_TRAY_OPEN_APP_LABEL);
    assert.equal(idleTemplate[4]?.label, PRISMUX_TRAY_QUIT_LABEL);

    // Update to N = 3 running agents.
    const updated = controller.setRunningAgentsCount(3);
    assert.deepEqual(updated, { ok: true, count: 3 });
    assert.equal(harness.tooltips.at(-1), "Prismux — 3 个正在运行的智能体");
    assert.equal(harness.getLatestTemplate()[0]?.label, "3 个正在运行的智能体");
    assert.equal(harness.getLatestTemplate()[0]?.enabled, false);

    // Duplicate count + unchanged URL must not redundantly rebuild the tray menu.
    const rebuildCountBeforeDuplicate = harness.builtTemplates.length;
    const duplicate = controller.setRunningAgentsCount(3);
    assert.deepEqual(duplicate, { ok: true, count: 3 });
    assert.equal(harness.builtTemplates.length, rebuildCountBeforeDuplicate);

    // Negative / non-integer values clamp cleanly back to 0.
    const clamped = controller.setRunningAgentsCount(-4);
    assert.deepEqual(clamped, { ok: true, count: 0 });
    assert.equal(harness.tooltips.at(-1), "Prismux — 24h 守护待命中");
    assert.equal(harness.getLatestTemplate()[0]?.label, "暂无正在运行的智能体");
  });

  it("wires all 3 submenu actions under '连接到手机端' and disables copy when mobileUrl is absent", () => {
    const harness = createFakeElectronTrayHarness();
    const fakeActions = createFakeActions();
    const controller = new PrismuxTrayController({
      api: harness.api,
      actions: fakeActions.actions,
      platform: "win32",
      initialMobileUrl: null,
    });

    assert.isTrue(controller.start());

    // Without mobileUrl, "复制手机端访问地址" is gracefully disabled.
    const initialSubmenu = harness.getLatestTemplate()[2]?.submenu ?? [];
    assert.equal(initialSubmenu.length, 3);
    assert.equal(initialSubmenu[2]?.label, "复制手机端访问地址");
    assert.equal(initialSubmenu[2]?.enabled, false);
    initialSubmenu[2]?.click?.();
    assert.deepEqual(fakeActions.copiedTexts, []);

    // Trigger "手机端扫码连接与配对..." and "打开内置手机模拟器".
    initialSubmenu[0]?.click?.();
    initialSubmenu[1]?.click?.();
    assert.deepEqual(fakeActions.dispatchedActions, [
      "open-mobile-connect",
      "open-mobile-simulator",
    ]);

    // Supply a valid LAN / Tailscale URL and verify copy action enables & copies normalized URL.
    controller.setRunningAgentsCount(2, { mobileUrl: "https://prismux.tailnet.ts.net/" });
    const activeSubmenu = harness.getLatestTemplate()[2]?.submenu ?? [];
    assert.equal(activeSubmenu[2]?.enabled, true);
    activeSubmenu[2]?.click?.();
    assert.deepEqual(fakeActions.copiedTexts, ["https://prismux.tailnet.ts.net"]);

    // Clearing mobileUrl re-disables the copy action.
    controller.setRunningAgentsCount(2, { mobileUrl: null });
    assert.equal(harness.getLatestTemplate()[2]?.submenu?.[2]?.enabled, false);
  });

  it("restores and focuses the main window on '打开 Prismux', tray click, and double-click", () => {
    const harness = createFakeElectronTrayHarness();
    const fakeActions = createFakeActions();
    const controller = new PrismuxTrayController({
      api: harness.api,
      actions: fakeActions.actions,
      platform: "win32",
    });

    assert.isTrue(controller.start());

    // Menu item "打开 Prismux".
    const openItem = harness.getLatestTemplate()[3];
    assert.equal(openItem?.label, "打开 Prismux");
    openItem?.click?.();
    assert.equal(fakeActions.getOpenMainWindowCount(), 1);

    // Tray left-click & double-click.
    harness.emitTrayEvent("click");
    assert.equal(fakeActions.getOpenMainWindowCount(), 2);

    harness.emitTrayEvent("double-click");
    assert.equal(fakeActions.getOpenMainWindowCount(), 3);
  });

  it("destroys the tray before quitting on '退出' and makes repeated destroy() calls idempotent", () => {
    const harness = createFakeElectronTrayHarness();
    const fakeActions = createFakeActions();
    const order: string[] = [];

    const apiWithOrder: PrismuxTrayElectronApi = {
      ...harness.api,
      createTray: (icon) => {
        const tray = harness.api.createTray(icon);
        return {
          ...tray,
          destroy: () => {
            order.push("tray.destroy");
            tray.destroy();
          },
        };
      },
    };

    const controller = new PrismuxTrayController({
      api: apiWithOrder,
      actions: {
        ...fakeActions.actions,
        quitApp: () => {
          order.push("app.quit");
          fakeActions.actions.quitApp();
        },
      },
      platform: "win32",
    });

    assert.isTrue(controller.start());
    const quitItem = harness.getLatestTemplate()[4];
    assert.equal(quitItem?.label, "退出");
    quitItem?.click?.();

    assert.deepEqual(order, ["tray.destroy", "app.quit"]);
    assert.equal(harness.getTrayDestroyCount(), 1);
    assert.equal(fakeActions.getQuitCount(), 1);
    assert.isFalse(controller.isActive());

    // Repeated destroy() must be an idempotent no-op and never throw or call tray.destroy() twice.
    controller.destroy();
    controller.destroy();
    assert.equal(harness.getTrayDestroyCount(), 1);
    assert.isTrue(controller.getState().destroyed);
  });

  it("registers before-quit and will-quit cleanup hooks that destroy the tray exactly once", () => {
    const harness = createFakeElectronTrayHarness();
    const fakeActions = createFakeActions();
    const listeners: Record<string, Array<() => void>> = {};

    const controller = createElectronTrayController({
      api: harness.api,
      actions: fakeActions.actions,
      platform: "win32",
      app: {
        once: (event, listener) => {
          listeners[event] ??= [];
          listeners[event].push(listener);
        },
      },
    });

    assert.isNotNull(controller);
    assert.isTrue(controller!.start());
    assert.equal(listeners["before-quit"]?.length, 1);
    assert.equal(listeners["will-quit"]?.length, 1);

    for (const listener of listeners["before-quit"] ?? []) listener();
    assert.equal(harness.getTrayDestroyCount(), 1);
    assert.isFalse(controller!.isActive());

    for (const listener of listeners["will-quit"] ?? []) listener();
    assert.equal(harness.getTrayDestroyCount(), 1);
  });

  it("preserves Windows multi-DPI .ico, resizes PNG fallback, falls back to embedded PNG when files are missing, and survives headless errors", () => {
    // 1. Windows prefers .ico without resizing so OS picks the exact DPI frame.
    const winHarness = createFakeElectronTrayHarness();
    const winActions = createFakeActions();
    const winPaths = resolvePrismuxTrayIconCandidatePaths({
      platform: "win32",
      rootDir: "C:\\Prismux",
      resolveResourcePathCandidates: (fileName) => [`C:\\Prismux\\resources\\${fileName}`],
    });
    assert.isTrue(winPaths[0]?.endsWith("icon.ico"));

    const winController = new PrismuxTrayController({
      api: winHarness.api,
      actions: winActions.actions,
      platform: "win32",
      iconCandidatePaths: winPaths,
      fileExists: (p) => p.endsWith("prismux-windows.ico"),
    });
    assert.isTrue(winController.start());
    assert.isTrue(winHarness.getLastCreatedIcon()?.source.endsWith("prismux-windows.ico"));
    assert.isUndefined(winHarness.getLastCreatedIcon()?.resizedTo);
    winController.destroy();

    // 2. macOS resizes PNG cleanly to 18x18.
    const macHarness = createFakeElectronTrayHarness();
    const macController = new PrismuxTrayController({
      api: macHarness.api,
      actions: winActions.actions,
      platform: "darwin",
      iconCandidatePaths: ["/app/assets/prismux/prismux-512.png"],
      fileExists: () => true,
    });
    assert.isTrue(macController.start());
    assert.deepEqual(macHarness.getLastCreatedIcon()?.resizedTo, {
      width: 18,
      height: 18,
      quality: "best",
    });
    macController.destroy();

    // 3. Missing disk icons fall back gracefully to embedded PNG data URL.
    const fallbackHarness = createFakeElectronTrayHarness();
    const fallbackController = new PrismuxTrayController({
      api: fallbackHarness.api,
      actions: winActions.actions,
      platform: "win32",
      iconCandidatePaths: ["C:\\missing\\icon.ico"],
      fileExists: () => false,
    });
    assert.isTrue(fallbackController.start());
    assert.deepEqual(fallbackHarness.loadedDataUrls, [FALLBACK_PRISMUX_TRAY_ICON_DATA_URL]);
    fallbackController.destroy();

    // 4. Headless / OS tray error never throws and reports inactive state cleanly.
    const headlessHarness = createFakeElectronTrayHarness({ failCreateTray: true });
    const headlessController = new PrismuxTrayController({
      api: headlessHarness.api,
      actions: winActions.actions,
      platform: "linux",
    });
    assert.isFalse(headlessController.start());
    assert.isFalse(headlessController.isActive());
    assert.deepEqual(headlessController.setRunningAgentsCount(2), { ok: false, count: 2 });
    headlessController.destroy();
  });

  it("buffers pre-start state and pending tray actions cleanly through shared singleton helpers", () => {
    destroySharedPrismuxTrayController();

    const harness = createFakeElectronTrayHarness();
    const fakeActions = createFakeActions();

    // Pre-start buffered URL and count carry over as soon as the tray starts.
    updateSharedPrismuxTrayMobileUrl("http://127.0.0.1:3773/");
    const preStartResult = updateSharedPrismuxTrayRunningAgentsCount(2);
    assert.deepEqual(preStartResult, { ok: false, count: 2 });

    const controller = initSharedPrismuxTrayController({
      api: harness.api,
      actions: fakeActions.actions,
      platform: "win32",
      app: null,
    });
    assert.isNotNull(controller);
    assert.equal(harness.tooltips.at(-1), "Prismux — 2 个正在运行的智能体");
    assert.equal(harness.getLatestTemplate()[2]?.submenu?.[2]?.enabled, true);

    const liveResult = updateSharedPrismuxTrayRunningAgentsCount(0, { mobileUrl: null });
    assert.deepEqual(liveResult, { ok: true, count: 0 });
    assert.equal(harness.tooltips.at(-1), "Prismux — 24h 守护待命中");
    assert.equal(harness.getLatestTemplate()[2]?.submenu?.[2]?.enabled, false);

    // Pending action queue delivers exactly once.
    queuePendingPrismuxTrayAction({ action: "open-mobile-simulator" });
    assert.deepEqual(takePendingPrismuxTrayAction(), { action: "open-mobile-simulator" });
    assert.isNull(takePendingPrismuxTrayAction());

    destroySharedPrismuxTrayController();
    destroySharedPrismuxTrayController();
    assert.equal(harness.getTrayDestroyCount(), 1);
  });
});
