// @effect-diagnostics nodeBuiltinImport:off - Tray icon resolution probes packaged/source Prismux icon files on disk with an embedded PNG fallback.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type {
  PrismuxSetTrayRunningAgentsResult,
  PrismuxTrayAction,
  PrismuxTrayActionPayload,
} from "@t3tools/contracts";
import * as Electron from "electron";

export const PRISMUX_TRAY_IDLE_TOOLTIP = "Prismux — 24h 守护待命中";
export const PRISMUX_TRAY_IDLE_STATUS_LABEL = "暂无正在运行的智能体";
export const PRISMUX_TRAY_CONNECT_MOBILE_LABEL = "连接到手机端";
export const PRISMUX_TRAY_MOBILE_QR_LABEL = "手机端扫码连接与配对...";
export const PRISMUX_TRAY_MOBILE_SIMULATOR_LABEL = "打开内置手机模拟器";
export const PRISMUX_TRAY_COPY_MOBILE_URL_LABEL = "复制手机端访问地址";
export const PRISMUX_TRAY_OPEN_APP_LABEL = "打开 Prismux";
export const PRISMUX_TRAY_QUIT_LABEL = "退出";

/**
 * Valid embedded 16x16 Prismux prism-diamond PNG used when on-disk icon assets are missing
 * so creating the system tray can never crash the Electron main process.
 */
export const FALLBACK_PRISMUX_TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAmklEQVR4nGNgoCbgF9f6QAwmWrPfuh//A9b++E/QEHyag1f/+B+6koAhhDRHrPjxP2oZpiFYDcClOXbpj//xi1ENwTAAXfOHn//BGKY5ceGP/ykLEIagGIBLMwzDNKfN+/E/cw7EEBQD0J2NbgCy5uzZWAwAYXQ/49OMMxCRAwzd2cia8UYjMZrxGgDChDQTlRqJ1kyVzEQuAAAXvYGoSIBF4QAAAABJRU5ErkJggg==";

export interface PrismuxTrayNativeImageLike {
  isEmpty: () => boolean;
  resize?: (options: {
    width?: number;
    height?: number;
    quality?: "good" | "better" | "best";
  }) => PrismuxTrayNativeImageLike;
  setTemplateImage?: (option: boolean) => void;
}

export interface PrismuxTrayMenuItemTemplate {
  readonly id?: string;
  readonly label?: string;
  readonly type?: "normal" | "separator" | "submenu" | "checkbox" | "radio";
  readonly enabled?: boolean;
  readonly submenu?: ReadonlyArray<PrismuxTrayMenuItemTemplate>;
  readonly click?: () => void;
}

export interface PrismuxTrayMenuLike {
  readonly items?: ReadonlyArray<unknown>;
}

export interface PrismuxTrayLike {
  setToolTip: (toolTip: string) => void;
  setContextMenu: (menu: PrismuxTrayMenuLike | null) => void;
  on: (event: string, listener: (...args: readonly unknown[]) => void) => unknown;
  removeListener?: (event: string, listener: (...args: readonly unknown[]) => void) => unknown;
  destroy: () => void;
  isDestroyed: () => boolean;
}

export interface PrismuxTrayElectronApi {
  readonly createTray: (icon: PrismuxTrayNativeImageLike) => PrismuxTrayLike;
  readonly buildMenuFromTemplate: (
    template: ReadonlyArray<PrismuxTrayMenuItemTemplate>,
  ) => PrismuxTrayMenuLike;
  readonly createImageFromPath: (imagePath: string) => PrismuxTrayNativeImageLike;
  readonly createImageFromDataUrl: (dataUrl: string) => PrismuxTrayNativeImageLike;
  readonly createEmptyImage: () => PrismuxTrayNativeImageLike;
}

export interface PrismuxTrayActions {
  readonly openMainWindow: () => void | Promise<void>;
  readonly dispatchTrayAction: (action: PrismuxTrayAction) => void | Promise<void>;
  readonly copyText: (text: string) => void | Promise<void>;
  readonly quitApp: () => void | Promise<void>;
}

export interface PrismuxTrayQuitHookTarget {
  readonly once?: (event: "before-quit" | "will-quit", listener: () => void) => unknown;
}

export interface PrismuxTrayState {
  readonly active: boolean;
  readonly destroyed: boolean;
  readonly runningAgentsCount: number;
  readonly mobileUrl: string | null;
  readonly tooltip: string;
  readonly statusLabel: string;
}

export interface PrismuxTrayControllerOptions {
  readonly api: PrismuxTrayElectronApi;
  readonly actions: PrismuxTrayActions;
  readonly platform?: NodeJS.Platform;
  readonly iconCandidatePaths?: ReadonlyArray<string>;
  readonly fileExists?: (filePath: string) => boolean;
  readonly initialRunningAgentsCount?: number;
  readonly initialMobileUrl?: string | null;
}

export interface PrismuxTrayIconResolutionEnv {
  readonly platform: NodeJS.Platform;
  readonly rootDir?: string;
  readonly resolveResourcePathCandidates?: (fileName: string) => ReadonlyArray<string>;
}

export function normalizeRunningAgentsCount(count: number): number {
  if (typeof count !== "number" || !Number.isFinite(count)) {
    return 0;
  }
  return Math.max(0, Math.floor(count));
}

export function normalizeMobileAccessUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") {
    return null;
  }
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href.replace(/\/+$/u, "");
  } catch {
    return null;
  }
}

export function formatPrismuxTrayTooltip(count: number): string {
  const safeCount = normalizeRunningAgentsCount(count);
  return safeCount > 0
    ? `Prismux — ${safeCount} 个正在运行的智能体`
    : PRISMUX_TRAY_IDLE_TOOLTIP;
}

export function formatPrismuxTrayStatusLabel(count: number): string {
  const safeCount = normalizeRunningAgentsCount(count);
  return safeCount > 0 ? `${safeCount} 个正在运行的智能体` : PRISMUX_TRAY_IDLE_STATUS_LABEL;
}

export function resolvePrismuxTrayIconCandidatePaths(
  env: PrismuxTrayIconResolutionEnv,
): readonly string[] {
  const resourceCandidates = (fileName: string): ReadonlyArray<string> =>
    env.resolveResourcePathCandidates ? env.resolveResourcePathCandidates(fileName) : [];
  const sourceAsset = (fileName: string): readonly string[] =>
    typeof env.rootDir === "string" && env.rootDir.trim().length > 0
      ? [NodePath.join(env.rootDir, "assets", "prismux", fileName)]
      : [];

  const rawPaths: string[] =
    env.platform === "win32"
      ? [
          ...resourceCandidates("icon.ico"),
          ...resourceCandidates("prismux-windows.ico"),
          ...sourceAsset("prismux-windows.ico"),
          ...resourceCandidates("icon.png"),
          ...resourceCandidates("prismux-32.png"),
          ...sourceAsset("prismux-32.png"),
          ...sourceAsset("prismux-128.png"),
          ...sourceAsset("prismux-256.png"),
          ...sourceAsset("prismux-512.png"),
        ]
      : [
          ...resourceCandidates("icon.png"),
          ...resourceCandidates("prismux-32.png"),
          ...sourceAsset("prismux-32.png"),
          ...sourceAsset("prismux-128.png"),
          ...sourceAsset("prismux-256.png"),
          ...sourceAsset("prismux-512.png"),
          ...resourceCandidates("icon.ico"),
          ...sourceAsset("prismux-windows.ico"),
        ];

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const candidate of rawPaths) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    unique.push(candidate);
  }
  return unique;
}

function defaultFileExists(filePath: string): boolean {
  try {
    return NodeFS.existsSync(filePath);
  } catch {
    return false;
  }
}

export function resolvePrismuxTrayIcon(options: {
  readonly api: Pick<
    PrismuxTrayElectronApi,
    "createImageFromPath" | "createImageFromDataUrl" | "createEmptyImage"
  >;
  readonly platform: NodeJS.Platform;
  readonly iconCandidatePaths: ReadonlyArray<string>;
  readonly fileExists?: (filePath: string) => boolean;
}): PrismuxTrayNativeImageLike {
  const exists = options.fileExists ?? defaultFileExists;

  for (const candidate of options.iconCandidatePaths) {
    if (!exists(candidate)) {
      continue;
    }
    try {
      const loaded = options.api.createImageFromPath(candidate);
      if (!loaded.isEmpty()) {
        const lower = candidate.toLowerCase();
        // Multi-resolution Windows .ico files natively scale cleanly across 100%-300% DPI.
        if (options.platform === "win32" && lower.endsWith(".ico")) {
          return loaded;
        }
        if (typeof loaded.resize === "function") {
          const targetSize =
            options.platform === "darwin" ? 18 : options.platform === "win32" ? 32 : 24;
          const resized = loaded.resize({
            width: targetSize,
            height: targetSize,
            quality: "best",
          });
          if (!resized.isEmpty()) {
            return resized;
          }
        }
        return loaded;
      }
    } catch {
      // Try next candidate path.
    }
  }

  try {
    const fallback = options.api.createImageFromDataUrl(FALLBACK_PRISMUX_TRAY_ICON_DATA_URL);
    if (!fallback.isEmpty()) {
      return fallback;
    }
  } catch {
    // Fall through to empty image so tray creation never throws because of missing artwork.
  }

  return options.api.createEmptyImage();
}

function safeInvokeCallback(fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (
      result !== null &&
      typeof result === "object" &&
      "catch" in result &&
      typeof result.catch === "function"
    ) {
      void result.catch(() => undefined);
    }
  } catch {
    // Tray callbacks must never bring down the Electron main process.
  }
}

export class PrismuxTrayController {
  private readonly api: PrismuxTrayElectronApi;
  private readonly actions: PrismuxTrayActions;
  private readonly platform: NodeJS.Platform;
  private readonly iconCandidatePaths: ReadonlyArray<string>;
  private readonly fileExists: (filePath: string) => boolean;

  private tray: PrismuxTrayLike | null = null;
  private destroyed = false;
  private runningAgentsCount: number;
  private mobileUrl: string | null;
  private readonly handleIconActivate: () => void;

  constructor(options: PrismuxTrayControllerOptions) {
    this.api = options.api;
    this.actions = options.actions;
    this.platform = options.platform ?? process.platform;
    this.iconCandidatePaths = options.iconCandidatePaths ?? [];
    this.fileExists = options.fileExists ?? defaultFileExists;
    this.runningAgentsCount = normalizeRunningAgentsCount(options.initialRunningAgentsCount ?? 0);
    this.mobileUrl = normalizeMobileAccessUrl(options.initialMobileUrl);
    this.handleIconActivate = () => {
      safeInvokeCallback(() => this.actions.openMainWindow());
    };
  }

  start(): boolean {
    if (this.destroyed) {
      return false;
    }
    if (this.isActive()) {
      return true;
    }

    let createdTray: PrismuxTrayLike | null = null;
    try {
      const icon = resolvePrismuxTrayIcon({
        api: this.api,
        platform: this.platform,
        iconCandidatePaths: this.iconCandidatePaths,
        fileExists: this.fileExists,
      });
      createdTray = this.api.createTray(icon);
      createdTray.on("click", this.handleIconActivate);
      createdTray.on("double-click", this.handleIconActivate);
      this.tray = createdTray;
      this.refreshPresentation();
      return true;
    } catch {
      if (createdTray !== null) {
        try {
          if (!createdTray.isDestroyed()) {
            createdTray.destroy();
          }
        } catch {
          // Ignore partial tray teardown failure in headless environments.
        }
      }
      this.tray = null;
      return false;
    }
  }

  isActive(): boolean {
    if (this.destroyed || this.tray === null) {
      return false;
    }
    try {
      return !this.tray.isDestroyed();
    } catch {
      return false;
    }
  }

  getState(): PrismuxTrayState {
    return {
      active: this.isActive(),
      destroyed: this.destroyed,
      runningAgentsCount: this.runningAgentsCount,
      mobileUrl: this.mobileUrl,
      tooltip: formatPrismuxTrayTooltip(this.runningAgentsCount),
      statusLabel: formatPrismuxTrayStatusLabel(this.runningAgentsCount),
    };
  }

  getMenuTemplate(): readonly PrismuxTrayMenuItemTemplate[] {
    const mobileUrl = this.mobileUrl;
    return [
      {
        id: "running-agents-status",
        label: formatPrismuxTrayStatusLabel(this.runningAgentsCount),
        enabled: false,
      },
      {
        type: "separator",
      },
      {
        id: "connect-mobile",
        label: PRISMUX_TRAY_CONNECT_MOBILE_LABEL,
        submenu: [
          {
            id: "mobile-qr-connect",
            label: PRISMUX_TRAY_MOBILE_QR_LABEL,
            click: () => {
              safeInvokeCallback(() => this.actions.dispatchTrayAction("open-mobile-connect"));
            },
          },
          {
            id: "mobile-simulator",
            label: PRISMUX_TRAY_MOBILE_SIMULATOR_LABEL,
            click: () => {
              safeInvokeCallback(() => this.actions.dispatchTrayAction("open-mobile-simulator"));
            },
          },
          {
            id: "copy-mobile-url",
            label: PRISMUX_TRAY_COPY_MOBILE_URL_LABEL,
            enabled: mobileUrl !== null,
            click: () => {
              if (mobileUrl === null) return;
              safeInvokeCallback(() => this.actions.copyText(mobileUrl));
            },
          },
        ],
      },
      {
        id: "open-prismux",
        label: PRISMUX_TRAY_OPEN_APP_LABEL,
        click: () => {
          safeInvokeCallback(() => this.actions.openMainWindow());
        },
      },
      {
        id: "quit-prismux",
        label: PRISMUX_TRAY_QUIT_LABEL,
        click: () => {
          this.destroy();
          safeInvokeCallback(() => this.actions.quitApp());
        },
      },
    ];
  }

  setRunningAgentsCount(
    count: number,
    extra?: { readonly mobileUrl?: string | null },
  ): PrismuxSetTrayRunningAgentsResult {
    const nextCount = normalizeRunningAgentsCount(count);
    const hasMobileUrlUpdate = extra !== undefined && "mobileUrl" in extra;
    const nextMobileUrl = hasMobileUrlUpdate
      ? normalizeMobileAccessUrl(extra.mobileUrl)
      : this.mobileUrl;

    const changed = nextCount !== this.runningAgentsCount || nextMobileUrl !== this.mobileUrl;
    this.runningAgentsCount = nextCount;
    this.mobileUrl = nextMobileUrl;

    if (changed && this.isActive()) {
      this.refreshPresentation();
    }

    return {
      ok: this.isActive(),
      count: this.runningAgentsCount,
    };
  }

  setMobileUrl(url: string | null): void {
    const nextMobileUrl = normalizeMobileAccessUrl(url);
    if (nextMobileUrl === this.mobileUrl) {
      return;
    }
    this.mobileUrl = nextMobileUrl;
    if (this.isActive()) {
      this.refreshPresentation();
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    const current = this.tray;
    this.tray = null;
    if (current === null) {
      return;
    }
    try {
      current.removeListener?.("click", this.handleIconActivate);
      current.removeListener?.("double-click", this.handleIconActivate);
    } catch {
      // Ignore listener removal errors during shutdown.
    }
    try {
      if (!current.isDestroyed()) {
        current.destroy();
      }
    } catch {
      // Ignore Electron shutdown teardown errors so quit stays clean.
    }
  }

  private refreshPresentation(): void {
    if (!this.isActive() || this.tray === null) {
      return;
    }
    try {
      this.tray.setToolTip(formatPrismuxTrayTooltip(this.runningAgentsCount));
      const menu = this.api.buildMenuFromTemplate(this.getMenuTemplate());
      this.tray.setContextMenu(menu);
    } catch {
      // Never throw on OS tray refresh errors.
    }
  }
}

export function createElectronTrayApi(): PrismuxTrayElectronApi | null {
  const electronAny = Electron as unknown as {
    readonly Tray?: typeof Electron.Tray;
    readonly Menu?: typeof Electron.Menu;
    readonly nativeImage?: typeof Electron.nativeImage;
  };
  if (
    typeof electronAny.Tray !== "function" ||
    typeof electronAny.Menu?.buildFromTemplate !== "function" ||
    typeof electronAny.nativeImage?.createFromPath !== "function" ||
    typeof electronAny.nativeImage?.createFromDataURL !== "function" ||
    typeof electronAny.nativeImage?.createEmpty !== "function"
  ) {
    return null;
  }

  const TrayCtor = electronAny.Tray;
  const MenuApi = electronAny.Menu;
  const NativeImageApi = electronAny.nativeImage;

  return {
    createTray: (icon) =>
      new TrayCtor(icon as unknown as Electron.NativeImage) as unknown as PrismuxTrayLike,
    buildMenuFromTemplate: (template) =>
      MenuApi.buildFromTemplate(
        template as unknown as Electron.MenuItemConstructorOptions[],
      ) as unknown as PrismuxTrayMenuLike,
    createImageFromPath: (imagePath) =>
      NativeImageApi.createFromPath(imagePath) as unknown as PrismuxTrayNativeImageLike,
    createImageFromDataUrl: (dataUrl) =>
      NativeImageApi.createFromDataURL(dataUrl) as unknown as PrismuxTrayNativeImageLike,
    createEmptyImage: () =>
      NativeImageApi.createEmpty() as unknown as PrismuxTrayNativeImageLike,
  };
}

export function createElectronTrayController(options: {
  readonly actions: PrismuxTrayActions;
  readonly platform?: NodeJS.Platform;
  readonly iconCandidatePaths?: ReadonlyArray<string>;
  readonly fileExists?: (filePath: string) => boolean;
  readonly initialRunningAgentsCount?: number;
  readonly initialMobileUrl?: string | null;
  readonly api?: PrismuxTrayElectronApi | null;
  readonly app?: PrismuxTrayQuitHookTarget | null;
}): PrismuxTrayController | null {
  const api = options.api !== undefined ? options.api : createElectronTrayApi();
  if (api === null) {
    return null;
  }

  const controller = new PrismuxTrayController({
    api,
    actions: options.actions,
    platform: options.platform ?? process.platform,
    iconCandidatePaths: options.iconCandidatePaths ?? [],
    ...(options.fileExists ? { fileExists: options.fileExists } : {}),
    initialRunningAgentsCount: options.initialRunningAgentsCount ?? 0,
    initialMobileUrl: options.initialMobileUrl ?? null,
  });

  const appTarget: PrismuxTrayQuitHookTarget | null =
    options.app !== undefined
      ? options.app
      : ((Electron.app as unknown as PrismuxTrayQuitHookTarget | undefined) ?? null);

  if (appTarget && typeof appTarget.once === "function") {
    const destroyOnQuit = () => {
      controller.destroy();
    };
    appTarget.once("before-quit", destroyOnQuit);
    appTarget.once("will-quit", destroyOnQuit);
  }

  return controller;
}

// Shared desktop tray singleton & buffered pre-start state so DesktopApp and IPC handlers stay decoupled.
let sharedTrayController: PrismuxTrayController | null = null;
let bufferedRunningAgentsCount = 0;
let bufferedMobileUrl: string | null = null;
let pendingTrayAction: PrismuxTrayActionPayload | null = null;

export function initSharedPrismuxTrayController(options: {
  readonly actions: PrismuxTrayActions;
  readonly platform?: NodeJS.Platform;
  readonly iconCandidatePaths?: ReadonlyArray<string>;
  readonly fileExists?: (filePath: string) => boolean;
  readonly api?: PrismuxTrayElectronApi | null;
  readonly app?: PrismuxTrayQuitHookTarget | null;
}): PrismuxTrayController | null {
  if (sharedTrayController !== null && sharedTrayController.isActive()) {
    return sharedTrayController;
  }
  sharedTrayController?.destroy();
  sharedTrayController = null;

  const controller = createElectronTrayController({
    ...options,
    initialRunningAgentsCount: bufferedRunningAgentsCount,
    initialMobileUrl: bufferedMobileUrl,
  });
  if (controller === null) {
    return null;
  }
  const started = controller.start();
  if (!started) {
    controller.destroy();
    return null;
  }
  sharedTrayController = controller;
  return controller;
}

export function getSharedPrismuxTrayController(): PrismuxTrayController | null {
  return sharedTrayController;
}

export function updateSharedPrismuxTrayRunningAgentsCount(
  count: number,
  extra?: { readonly mobileUrl?: string | null },
): PrismuxSetTrayRunningAgentsResult {
  bufferedRunningAgentsCount = normalizeRunningAgentsCount(count);
  if (extra !== undefined && "mobileUrl" in extra) {
    bufferedMobileUrl = normalizeMobileAccessUrl(extra.mobileUrl);
  }
  if (sharedTrayController !== null) {
    return sharedTrayController.setRunningAgentsCount(
      bufferedRunningAgentsCount,
      extra !== undefined && "mobileUrl" in extra ? { mobileUrl: bufferedMobileUrl } : undefined,
    );
  }
  return {
    ok: false,
    count: bufferedRunningAgentsCount,
  };
}

export function updateSharedPrismuxTrayMobileUrl(url: string | null): void {
  bufferedMobileUrl = normalizeMobileAccessUrl(url);
  sharedTrayController?.setMobileUrl(bufferedMobileUrl);
}

export function queuePendingPrismuxTrayAction(payload: PrismuxTrayActionPayload): void {
  pendingTrayAction = payload;
}

export function takePendingPrismuxTrayAction(): PrismuxTrayActionPayload | null {
  const next = pendingTrayAction;
  pendingTrayAction = null;
  return next;
}

export function destroySharedPrismuxTrayController(): void {
  pendingTrayAction = null;
  const current = sharedTrayController;
  sharedTrayController = null;
  current?.destroy();
}
