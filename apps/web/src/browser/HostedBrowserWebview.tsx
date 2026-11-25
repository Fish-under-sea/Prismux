import type {
  DesktopPreviewColorScheme,
  PreviewViewportSetting,
  ScopedThreadRef,
} from "@prismux/core-contracts";
import {
  findPreviewViewportPreset,
  resolvePreviewDeviceEmulation,
  type PreviewViewportBezelStyle,
} from "@prismux/core-shared/previewViewport";
import { useShallow } from "zustand/react/shallow";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import { previewBridge } from "~/components/preview/previewBridge";
import {
  preventThumbButtonFocus,
  takeThumbButtonNavigation,
} from "~/components/preview/thumbButtons";
import { usePreviewBridge } from "~/components/preview/usePreviewBridge";
import { useClientSettingsHydrated } from "~/hooks/useSettings";
import { cn, isMacPlatform } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";

import {
  resolveBrowserSurfacePanelRect,
  type BrowserSurfaceRect,
  useBrowserSurfaceStore,
} from "./browserSurfaceStore";
import { useActiveBrowserRecordingTabIds } from "./browserRecording";
import {
  BROWSER_DEVICE_TOOLBAR_HEIGHT,
  browserViewportSettingKey,
  resolveBrowserViewportLayout,
  resolveBrowserViewportTransform,
  resolveFittedBrowserViewport,
} from "./browserViewportLayout";
import { BrowserDeviceToolbar } from "./BrowserDeviceToolbar";
import { BrowserViewportResizeHandles } from "./BrowserViewportResizeHandles";
import { acquireDesktopTab, type AcquiredDesktopTab, withDesktopTab } from "./desktopTabLifetime";
import { resolveHostedBrowserWebviewWrapperStyle } from "./hostedBrowserWebviewStyle";
import { usePreviewWebviewConfig } from "./previewWebviewConfigState";
import { useBrowserLayoutZoomFactor } from "./useBrowserLayoutZoomFactor";
import { useBrowserViewportResize } from "./useBrowserViewportResize";
import {
  INITIAL_WEBVIEW_CRASH_RECOVERY_STATE,
  planWebviewCrashRecovery,
  type WebviewCrashRecoveryState,
} from "./webviewCrashRecovery";

interface ElectronWebview extends HTMLElement {
  src: string;
  partition: string;
  preload?: string;
  webpreferences?: string;
  getWebContentsId: () => number;
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>;
}

declare global {
  interface HTMLElementTagNameMap {
    webview: ElectronWebview;
  }
}

const PHONE_BEZEL_STORAGE_KEY = "prismux.phoneSimulator.bezel.v1";

export function loadPhoneBezelEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(PHONE_BEZEL_STORAGE_KEY);
    if (raw === "false") return false;
    return true;
  } catch {
    return true;
  }
}

export function savePhoneBezelEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PHONE_BEZEL_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore storage failures.
  }
}

/**
 * Defense-in-depth viewport clamp ensuring the fixed preview wrapper NEVER overlaps
 * the bottom 20px Prismux status bar (`[data-prismux-status-bar="true"]`).
 */
export function clampBrowserRectAboveStatusBar(
  rect: BrowserSurfaceRect | null,
  viewportHeight: number,
  statusBarTop: number | null,
): BrowserSurfaceRect | null {
  if (!rect) return null;
  const maxBottom =
    typeof statusBarTop === "number" && Number.isFinite(statusBarTop) && statusBarTop > 0
      ? Math.min(viewportHeight, statusBarTop)
      : viewportHeight;
  if (!Number.isFinite(maxBottom) || maxBottom <= 0) return rect;
  const clampedHeight = Math.max(1, Math.min(rect.height, Math.floor(maxBottom - rect.y)));
  if (clampedHeight === rect.height) return rect;
  return {
    ...rect,
    height: clampedHeight,
  };
}

export interface PhoneBezelChassisLayout {
  readonly frameX: number;
  readonly frameY: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly borderWidth: number;
  readonly borderRadius: number;
  readonly innerRadius: number;
  readonly topChromeHeight: number;
  readonly bottomChromeHeight: number;
  readonly leftChromeWidth: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly viewportScale: number;
  readonly isLandscape: boolean;
}

const PHONE_BEZEL_BORDER_PX = 9;
const PHONE_BEZEL_STAGE_MARGIN_X = 12;
const PHONE_BEZEL_STAGE_MARGIN_TOP = 8;
const PHONE_BEZEL_STAGE_MARGIN_BOTTOM = 10;

/**
 * Computes an inside-fit chassis box for the Phone Simulator bezel so the entire physical
 * phone frame (border, hardware buttons, top status bar / Dynamic Island, webview screen,
 * and bottom Home Indicator) fits strictly INSIDE `[toolbarHeight + marginTop, container.height - marginBottom]`
 * with ZERO negative margins, ZERO toolbar collision, and ZERO bottom status bar overlap.
 */
export function resolvePhoneBezelChassisLayout(
  container: { readonly width: number; readonly height: number },
  setting: Exclude<PreviewViewportSetting, { readonly _tag: "fill" }>,
  zoomFactor: number,
  bezelStyle: PreviewViewportBezelStyle,
  toolbarHeight = BROWSER_DEVICE_TOOLBAR_HEIGHT,
): PhoneBezelChassisLayout {
  const containerW = Math.max(120, Math.floor(container.width));
  const containerH = Math.max(160, Math.floor(container.height));
  const isLandscape = setting.width > setting.height;
  const isTablet = bezelStyle === "tablet" || bezelStyle === "foldable";
  const isClassic = bezelStyle === "classic-chin";
  const borderWidth = PHONE_BEZEL_BORDER_PX;
  const topChromeHeight = isLandscape ? 0 : 22;
  const bottomChromeHeight = isLandscape ? 12 : isClassic ? 22 : 14;
  const leftChromeWidth = isLandscape && !isTablet ? 18 : 0;

  const availFrameW = Math.max(80, containerW - PHONE_BEZEL_STAGE_MARGIN_X * 2);
  const availFrameH = Math.max(
    80,
    containerH - toolbarHeight - PHONE_BEZEL_STAGE_MARGIN_TOP - PHONE_BEZEL_STAGE_MARGIN_BOTTOM,
  );
  const availScreenW = Math.max(40, availFrameW - borderWidth * 2 - leftChromeWidth);
  const availScreenH = Math.max(
    40,
    availFrameH - borderWidth * 2 - topChromeHeight - bottomChromeHeight,
  );

  const normalizedZoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  const renderedW = setting.width * normalizedZoom;
  const renderedH = setting.height * normalizedZoom;
  const viewportScale = Math.min(1, availScreenW / renderedW, availScreenH / renderedH);
  const screenWidth = Math.max(1, Math.floor(renderedW * viewportScale));
  const screenHeight = Math.max(1, Math.floor(renderedH * viewportScale));

  const frameWidth = screenWidth + leftChromeWidth + borderWidth * 2;
  const frameHeight = screenHeight + topChromeHeight + bottomChromeHeight + borderWidth * 2;
  const frameX = Math.max(
    PHONE_BEZEL_STAGE_MARGIN_X,
    Math.round((containerW - frameWidth) / 2),
  );
  const frameY =
    toolbarHeight +
    PHONE_BEZEL_STAGE_MARGIN_TOP +
    Math.max(0, Math.floor((availFrameH - frameHeight) / 2));

  const baseRadius = isClassic ? 26 : isTablet ? 20 : 32;
  const borderRadius = Math.max(12, Math.round(baseRadius * Math.min(1, Math.max(0.65, viewportScale))));
  const innerRadius = Math.max(4, borderRadius - borderWidth);

  return {
    frameX,
    frameY,
    frameWidth,
    frameHeight,
    borderWidth,
    borderRadius,
    innerRadius,
    topChromeHeight,
    bottomChromeHeight,
    leftChromeWidth,
    screenX: frameX + borderWidth + leftChromeWidth,
    screenY: frameY + borderWidth + topChromeHeight,
    screenWidth,
    screenHeight,
    viewportScale,
    isLandscape,
  };
}

/**
 * Resolves the `<webview>` element's CSS box & transform using Electron 44 probe-verified scaling:
 * - Electron 44 OOPIF `<webview>` honors `Emulation.setDeviceMetricsOverride({ width, height, deviceScaleFactor, mobile })`
 *   as the guest layout viewport, but ignores CDP `scale` for visual shrinking into a narrower slot.
 * - Therefore CDP always keeps `scale: 1`, while `<webview>` keeps its exact logical viewport box
 *   (`logicalWidth × logicalHeight`, guarded with `minWidth`/`maxWidth: "none"` so flex ancestors never
 *   squash it) and scales visually via CSS `transform: scale(fitScale)` with `transformOrigin: "top left"`
 *   inside the `overflow-hidden` bezel screen slot (`viewportWidth × viewportHeight`).
 * - Computing `fitScale = Math.min(1, viewportWidth / logicalWidth, viewportHeight / logicalHeight)`
 *   guarantees `logicalWidth * fitScale <= viewportWidth` and `logicalHeight * fitScale <= viewportHeight`,
 *   preventing even 1px subpixel floor-rounding clipping on both right and bottom edges.
 */
export function resolveHostedWebviewRenderStyle(input: {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly viewportScale: number;
  readonly logicalWidth?: number | null;
  readonly logicalHeight?: number | null;
  readonly cdpEmulationActive: boolean;
  readonly fullDetail: boolean;
}): {
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly maxWidth: "none";
  readonly minHeight: number;
  readonly maxHeight: "none";
  readonly transform: string | undefined;
  readonly transformOrigin: "top left";
} {
  const safeScale =
    Number.isFinite(input.viewportScale) && input.viewportScale > 0 ? input.viewportScale : 1;
  const hasExplicitLogical =
    typeof input.logicalWidth === "number" &&
    Number.isFinite(input.logicalWidth) &&
    input.logicalWidth > 0 &&
    typeof input.logicalHeight === "number" &&
    Number.isFinite(input.logicalHeight) &&
    input.logicalHeight > 0;

  if (input.cdpEmulationActive && hasExplicitLogical) {
    const logicalWidth = input.logicalWidth!;
    const logicalHeight = input.logicalHeight!;
    const fitScale = Math.min(
      1,
      input.viewportWidth / logicalWidth,
      input.viewportHeight / logicalHeight,
    );
    return {
      width: logicalWidth,
      height: logicalHeight,
      minWidth: logicalWidth,
      maxWidth: "none",
      minHeight: logicalHeight,
      maxHeight: "none",
      transform: resolveBrowserViewportTransform(fitScale, input.fullDetail),
      transformOrigin: "top left",
    };
  }

  const width = input.viewportWidth / safeScale;
  const height = input.viewportHeight / safeScale;
  return {
    width,
    height,
    minWidth: width,
    maxWidth: "none",
    minHeight: height,
    maxHeight: "none",
    transform: resolveBrowserViewportTransform(safeScale, input.fullDetail),
    transformOrigin: "top left",
  };
}

export function PhoneBezelChassis(props: {
  readonly bezelStyle: PreviewViewportBezelStyle;
  readonly colorScheme: DesktopPreviewColorScheme;
  readonly label: string;
  readonly layout: PhoneBezelChassisLayout;
  readonly interactive?: boolean;
  readonly children?: ReactNode;
}) {
  const { bezelStyle, colorScheme, label, layout, interactive = false, children } = props;
  const isClassic = bezelStyle === "classic-chin";
  const isLightChrome = colorScheme === "light";
  const statusToneClass = isLightChrome
    ? "bg-white text-neutral-900"
    : "bg-neutral-950 text-neutral-100";

  return (
    <div
      data-testid="prismux-phone-bezel-frame"
      data-bezel-style={bezelStyle}
      data-orientation={layout.isLandscape ? "landscape" : "portrait"}
      className={cn(
        "absolute z-10 box-border flex flex-col bg-[#181a1f] transition-[left,top,width,height,border-radius] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        !interactive && "pointer-events-none",
      )}
      style={{
        left: layout.frameX,
        top: layout.frameY,
        width: layout.frameWidth,
        height: layout.frameHeight,
        borderRadius: layout.borderRadius,
        border: `${layout.borderWidth}px solid #181a1f`,
        boxShadow:
          "0 0 0 1px rgba(255,255,255,0.20), 0 10px 26px rgba(0,0,0,0.40), inset 0 0 0 1px rgba(255,255,255,0.08)",
      }}
    >
      {/* Side hardware buttons sit cleanly within the 12px horizontal stage margin */}
      {!layout.isLandscape ? (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-14 -left-[12px] h-6 w-[3px] rounded-l-sm bg-neutral-500/80"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-23 -left-[12px] h-9 w-[3px] rounded-l-sm bg-neutral-500/80"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-19 -right-[12px] h-11 w-[3px] rounded-r-sm bg-neutral-500/80"
          />
        </>
      ) : (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-[12px] left-16 h-[3px] w-11 rounded-t-sm bg-neutral-500/80"
        />
      )}

      {/* Inner clipped glass display stack (status bar + viewport screen + home indicator) */}
      <div
        className={cn(
          "relative flex min-h-0 flex-1 overflow-hidden",
          layout.isLandscape ? "flex-row" : "flex-col",
          isLightChrome ? "bg-white" : "bg-neutral-950",
        )}
        style={{ borderRadius: layout.innerRadius }}
      >
        {/* Portrait top status bar & camera cutout (sits ABOVE the webview screen — zero occlusion) */}
        {!layout.isLandscape && layout.topChromeHeight > 0 ? (
          <div
            aria-hidden="true"
            className={cn(
              "flex shrink-0 select-none items-center justify-between px-3 text-[10px] font-semibold tabular-nums",
              statusToneClass,
            )}
            style={{ height: layout.topChromeHeight }}
          >
            <span>9:41</span>

            {bezelStyle === "dynamic-island" ? (
              <span className="flex h-3.5 w-16 items-center justify-end rounded-full bg-neutral-950 px-1.5 shadow-inner ring-1 ring-white/15">
                <span className="size-1.5 rounded-full bg-sky-900/90 ring-1 ring-sky-400/35" />
              </span>
            ) : bezelStyle === "notch" ? (
              <span className="h-3.5 w-20 rounded-b-lg bg-neutral-950" />
            ) : bezelStyle === "punch-hole" ? (
              <span className="size-2.5 rounded-full bg-neutral-950 ring-1 ring-white/20" />
            ) : bezelStyle === "classic-chin" ? (
              <span className="h-1 w-10 rounded-full bg-neutral-600" />
            ) : (
              <span className="text-[9px] font-medium opacity-75">{label}</span>
            )}

            <span className="inline-flex items-center gap-1">
              <svg viewBox="0 0 16 10" className="h-2.5 w-3.5 fill-current">
                <rect x="0" y="6" width="2.4" height="4" rx="0.6" />
                <rect x="3.4" y="4.2" width="2.4" height="5.8" rx="0.6" />
                <rect x="6.8" y="2.2" width="2.4" height="7.8" rx="0.6" />
                <rect x="10.2" y="0.4" width="2.4" height="9.6" rx="0.6" />
              </svg>
              <span className="inline-flex h-2.5 w-4.5 items-center rounded-[3px] border border-current p-[1px]">
                <span className="h-full w-3 rounded-[1px] bg-current" />
              </span>
            </span>
          </div>
        ) : null}

        {/* Landscape left camera cutout strip */}
        {layout.isLandscape && layout.leftChromeWidth > 0 ? (
          <div
            aria-hidden="true"
            className={cn("flex shrink-0 items-center justify-center", statusToneClass)}
            style={{ width: layout.leftChromeWidth }}
          >
            {bezelStyle === "dynamic-island" || bezelStyle === "notch" ? (
              <span className="h-14 w-3 rounded-full bg-neutral-950 ring-1 ring-white/15" />
            ) : bezelStyle === "punch-hole" ? (
              <span className="size-2.5 rounded-full bg-neutral-950 ring-1 ring-white/20" />
            ) : null}
          </div>
        ) : null}

        {/* Main display area (contains webview or blank start guide) */}
        <div
          className={cn(
            "relative flex min-h-0 flex-1 flex-col overflow-hidden",
            layout.isLandscape && "min-w-0",
          )}
        >
          <div
            className="relative shrink-0 overflow-hidden"
            style={{ width: layout.screenWidth, height: layout.screenHeight }}
          >
            {children}
          </div>

          {/* Bottom Home Indicator / Classic Touch ID (sits cleanly BELOW the screen) */}
          {layout.bottomChromeHeight > 0 ? (
            <div
              aria-hidden="true"
              className={cn("flex shrink-0 items-center justify-center", statusToneClass)}
              style={{ height: layout.bottomChromeHeight }}
            >
              {isClassic ? (
                <span className="size-4 rounded-full border border-neutral-500/80 bg-neutral-900/90" />
              ) : (
                <span className="h-1 w-24 rounded-full bg-neutral-400/85" />
              )}
            </div>
          ) : null}
        </div>

        {/* Foldable subtle center hinge crease shimmer */}
        {bezelStyle === "foldable" ? (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute bg-gradient-to-r from-transparent via-white/18 to-transparent",
              layout.isLandscape ? "inset-x-0 top-1/2 h-px" : "inset-y-0 left-1/2 w-px",
            )}
          />
        ) : null}
      </div>
    </div>
  );
}

export function HostedBrowserWebview(props: {
  readonly threadRef: ScopedThreadRef;
  readonly tabId: string;
  readonly runtimeTabId: string;
  readonly initialUrl: string | null;
  readonly viewport: PreviewViewportSetting;
  readonly pictureInPicture: boolean;
  /** Fixed for the tab lifetime; Electron reads partition before guest attachment. */
  readonly profileId: string | undefined;
  readonly zoomFactor: number;
  readonly serverDriven?: boolean;
  readonly serverRendering?: {
    readonly colorScheme: DesktopPreviewColorScheme;
    readonly zoomFactor: number;
  };
}) {
  const {
    threadRef,
    tabId,
    runtimeTabId,
    initialUrl,
    viewport,
    pictureInPicture,
    zoomFactor,
    profileId,
    serverDriven = false,
    serverRendering,
  } = props;
  const clientSettingsHydrated = useClientSettingsHydrated();
  const config = usePreviewWebviewConfig(threadRef.environmentId, profileId);
  const [initialSrc] = useState(() => initialUrl ?? "about:blank");
  const tabLeaseRef = useRef<AcquiredDesktopTab | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<ElectronWebview | null>(null);
  const crashRecoveryRef = useRef<WebviewCrashRecoveryState>(INITIAL_WEBVIEW_CRASH_RECOVERY_STATE);
  const [aspectRatioLocked, setAspectRatioLocked] = useState(false);
  const storeBezelEnabled = useRightPanelStore((state) => state.mobileSimulatorBezelEnabled);
  const setStoreBezelEnabled = useRightPanelStore((state) => state.setMobileSimulatorBezelEnabled);
  const storeColorScheme = useRightPanelStore((state) => state.mobileSimulatorColorScheme);
  const setStoreColorScheme = useRightPanelStore((state) => state.setMobileSimulatorColorScheme);
  const [bezelEnabled, setBezelEnabledState] = useState<boolean>(
    () => loadPhoneBezelEnabled() && storeBezelEnabled,
  );
  const [emulatedColorScheme, setEmulatedColorSchemeState] = useState<DesktopPreviewColorScheme>(
    () => serverRendering?.colorScheme ?? storeColorScheme,
  );
  const mobileSimulatorLaunchSeq = useRightPanelStore((state) => state.mobileSimulatorLaunchSeq);
  const handleBezelEnabledChange = (enabled: boolean) => {
    setBezelEnabledState(enabled);
    setStoreBezelEnabled(enabled);
    savePhoneBezelEnabled(enabled);
  };
  const handleColorSchemeChange = (scheme: DesktopPreviewColorScheme) => {
    setEmulatedColorSchemeState(scheme);
    setStoreColorScheme(scheme);
  };
  const presentation = useBrowserSurfaceStore(
    useShallow((state) => {
      const current = state.byTabId[runtimeTabId];
      return {
        content: current?.content ?? null,
        cornerRadius: current?.cornerRadius ?? 0,
        fitSourceContent: current?.fitSourceContent ?? false,
        fittedSourceContent: current?.fittedSourceContent ?? null,
        rect: resolveBrowserSurfacePanelRect(state.byTabId, runtimeTabId),
        visible: current?.visible ?? false,
        zIndex: current?.zIndex ?? 30,
      };
    }),
  );
  const backgroundActivity = useBrowserSurfaceStore(
    (state) => (state.activityByTabId[runtimeTabId] ?? 0) > 0,
  );
  const recordingActive = useActiveBrowserRecordingTabIds().has(runtimeTabId);
  usePreviewBridge({ threadRef, tabId, runtimeTabId, serverDriven });

  const serverColorScheme = serverRendering?.colorScheme;
  const serverZoomFactor = serverRendering?.zoomFactor;

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- leases the desktop preview tab for this webview and releases it on cleanup
  useEffect(() => {
    if (!clientSettingsHydrated) return;
    crashRecoveryRef.current = INITIAL_WEBVIEW_CRASH_RECOVERY_STATE;
    const lease = acquireDesktopTab(
      runtimeTabId,
      serverDriven ? { threadId: threadRef.threadId, tabId } : undefined,
    );
    tabLeaseRef.current = lease;
    return () => {
      if (tabLeaseRef.current === lease) tabLeaseRef.current = null;
      lease.release();
    };
  }, [clientSettingsHydrated, runtimeTabId, serverDriven, tabId, threadRef.threadId]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- applies the server color scheme to the desktop preview tab through the desktop bridge
  useEffect(() => {
    const bridge = window.desktopBridge?.preview;
    if (!bridge || serverColorScheme === undefined) return;
    withDesktopTab(runtimeTabId, () => bridge.setColorScheme(runtimeTabId, serverColorScheme));
  }, [runtimeTabId, serverColorScheme]);
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- applies the server zoom factor to the desktop preview tab through the desktop bridge
  useEffect(() => {
    const bridge = window.desktopBridge?.preview;
    if (!bridge || serverZoomFactor === undefined) return;
    withDesktopTab(runtimeTabId, () => bridge.setZoomFactor(runtimeTabId, serverZoomFactor));
  }, [runtimeTabId, serverZoomFactor]);

  const [webviewGeneration, setWebviewGeneration] = useState(0);
  const [recoverySrc, setRecoverySrc] = useState(initialSrc);
  const active = presentation.visible && presentation.rect !== null;
  const shown = active || pictureInPicture;
  const reportedShown = useEffectEvent(() => serverDriven && shown);
  const remountCrashedWebview = useEffectEvent(() => {
    setRecoverySrc(initialUrl ?? initialSrc);
    setWebviewGeneration((generation) => generation + 1);
  });

  const setWebviewRef = (node: HTMLElement | null) => {
    webviewRef.current = node as ElectronWebview | null;
  };

  const syncDeviceEmulationRef = useRef<() => void>(() => {});

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- registers the webview's webContents with the desktop bridge and listens for crashes and focus
  useEffect(() => {
    const webview = webviewRef.current;
    const bridge = previewBridge;
    if (!clientSettingsHydrated || !webview || !config || !bridge) return;
    let disposed = false;
    let recoveryTimeout: ReturnType<typeof setTimeout> | null = null;
    let registeredWebContentsId: number | null = null;
    const register = () => {
      const lease = tabLeaseRef.current;
      if (!lease) return;
      void (async () => {
        try {
          // Tab creation and webview attachment use separate effects; wait to avoid PreviewTabNotFoundError.
          await lease.ready;
          if (disposed || webviewRef.current !== webview) return;
          const webContentsId = webview.getWebContentsId();
          if (Number.isInteger(webContentsId) && webContentsId > 0) {
            await bridge.registerWebview(runtimeTabId, webContentsId);
            registeredWebContentsId = webContentsId;
            withDesktopTab(runtimeTabId, () => bridge.setShown(runtimeTabId, reportedShown()));
            // Replay current CDP mobile emulation right after guest webContents attaches.
            syncDeviceEmulationRef.current();
          }
        } catch {}
      })();
    };
    const replayEmulation = () => {
      if (disposed) return;
      syncDeviceEmulationRef.current();
    };
    const recoverGuest = () => {
      if (disposed || recoveryTimeout !== null) return;
      const recovery = planWebviewCrashRecovery(crashRecoveryRef.current, Date.now());
      if (!recovery) return;
      crashRecoveryRef.current = recovery.state;
      recoveryTimeout = setTimeout(() => {
        recoveryTimeout = null;
        if (!disposed) remountCrashedWebview();
      }, recovery.delayMs);
    };
    // Guest clicks never reach this document, so replay a pointerdown to dismiss host popups.
    // The guest preload reports each press, since the guest does not always take focus.
    const dismissHostPopups = () => {
      webview.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
      );
    };
    const guestPointerDown = (event: Event) => {
      // Mirrors POINTER_DOWN_HOST_CHANNEL in apps/desktop/src/preview/GuestProtocol.ts.
      if ((event as Event & { channel?: string }).channel === "preview:pointer-down") {
        dismissHostPopups();
      }
    };
    // The desktop clears a destroyed guest's id; nothing reattaches this element, so remount it.
    const unsubscribeState = bridge.onStateChange((changedTabId, state) => {
      if (changedTabId !== runtimeTabId || registeredWebContentsId === null) return;
      if (state.webContentsId !== null) return;
      registeredWebContentsId = null;
      recoverGuest();
    });
    webview.addEventListener("did-attach", register);
    webview.addEventListener("dom-ready", register);
    webview.addEventListener("did-finish-load", replayEmulation);
    webview.addEventListener("did-navigate", replayEmulation);
    webview.addEventListener("render-process-gone", recoverGuest);
    webview.addEventListener("focus", dismissHostPopups);
    webview.addEventListener("ipc-message", guestPointerDown);
    register();
    return () => {
      disposed = true;
      if (recoveryTimeout !== null) clearTimeout(recoveryTimeout);
      unsubscribeState();
      webview.removeEventListener("did-attach", register);
      webview.removeEventListener("dom-ready", register);
      webview.removeEventListener("did-finish-load", replayEmulation);
      webview.removeEventListener("did-navigate", replayEmulation);
      webview.removeEventListener("render-process-gone", recoverGuest);
      webview.removeEventListener("focus", dismissHostPopups);
      webview.removeEventListener("ipc-message", guestPointerDown);
    };
  }, [
    clientSettingsHydrated,
    config,
    runtimeTabId,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A crash recovery remounts the webview under a new key, so the listeners attach to the new element.
    webviewGeneration,
  ]);

  const statusBarTop =
    typeof document !== "undefined"
      ? (document.querySelector('[data-prismux-status-bar="true"]')?.getBoundingClientRect().top ??
        null)
      : null;
  const lastRect = clampBrowserRectAboveStatusBar(
    presentation.rect,
    typeof window !== "undefined" ? window.innerHeight : 900,
    statusBarTop,
  );
  const layoutZoomFactor = useBrowserLayoutZoomFactor(zoomFactor);
  const viewportWidth = viewport._tag === "fill" ? null : viewport.width;
  const viewportHeight = viewport._tag === "fill" ? null : viewport.height;
  const viewportAspectRatio =
    viewportWidth === null || viewportHeight === null ? null : viewportWidth / viewportHeight;
  const lockedAspectRatio =
    aspectRatioLocked && viewportAspectRatio !== null ? viewportAspectRatio : null;
  const handleAspectRatioChange = (aspectRatio: number | null) => {
    setAspectRatioLocked(aspectRatio !== null);
  };
  const content = presentation.content;
  const hiddenWidth =
    viewport._tag !== "fill"
      ? viewport.width * layoutZoomFactor
      : content
        ? content.width / content.scale
        : (lastRect?.width ?? 1280);
  const hiddenHeight =
    viewport._tag !== "fill"
      ? viewport.height * layoutZoomFactor
      : content
        ? content.height / content.scale
        : (lastRect?.height ?? 800);
  // Build from primitives on each side of the resize hook to keep both objects cached.
  const containerSize =
    active && lastRect ? lastRect : { width: hiddenWidth, height: hiddenHeight };
  const deviceToolbarVisible = active && viewport._tag !== "fill" && !presentation.fitSourceContent;
  const {
    activeDrag,
    commitViewportChange,
    effectiveViewport,
    handleResizeKeyDown,
    handleResizePointerDown,
    layout: viewportLayout,
  } = useBrowserViewportResize({
    target: { threadRef, tabId, runtimeTabId },
    viewport,
    zoomFactor: layoutZoomFactor,
    containerSize,
    deviceToolbarVisible,
    aspectRatio: lockedAspectRatio,
  });
  const fittedSourceViewport =
    presentation.fitSourceContent && lastRect
      ? resolveFittedBrowserViewport(viewport, presentation.fittedSourceContent, layoutZoomFactor)
      : null;
  const baseLayout =
    fittedSourceViewport && lastRect
      ? resolveBrowserViewportLayout(lastRect, fittedSourceViewport, layoutZoomFactor)
      : viewportLayout;

  const activePreset =
    effectiveViewport._tag === "preset"
      ? (findPreviewViewportPreset(effectiveViewport.presetId) ?? null)
      : null;
  const showPhoneBezel = Boolean(
    active &&
      bezelEnabled &&
      activePreset &&
      activePreset.bezelStyle !== "none" &&
      effectiveViewport._tag !== "fill" &&
      !fittedSourceViewport,
  );
  const bezelLayout =
    showPhoneBezel && activePreset && effectiveViewport._tag !== "fill"
      ? resolvePhoneBezelChassisLayout(
          containerSize,
          effectiveViewport,
          layoutZoomFactor,
          activePreset.bezelStyle,
        )
      : null;
  const layout = bezelLayout
    ? {
        canvasWidth: baseLayout.canvasWidth,
        canvasHeight: baseLayout.canvasHeight,
        viewportX: bezelLayout.screenX,
        viewportY: bezelLayout.screenY,
        viewportWidth: bezelLayout.screenWidth,
        viewportHeight: bezelLayout.screenHeight,
        viewportScale: bezelLayout.viewportScale,
        fillsPanel: false,
      }
    : baseLayout;

  // Consume one-click "手机模拟器" launch intent (including any preset/rotation customized on blank stage).
  const applyPendingMobileSimulator = useEffectEvent(() => {
    if (!active) return;
    const store = useRightPanelStore.getState();
    const nextViewport = store.consumeMobileSimulatorSetting();
    if (!nextViewport) return;
    handleBezelEnabledChange(store.mobileSimulatorBezelEnabled);
    if (serverColorScheme === undefined) {
      setEmulatedColorSchemeState(store.mobileSimulatorColorScheme);
    }
    store.setMobileSimulatorIdleActive(false);
    void commitViewportChange(nextViewport).catch(() => undefined);
  });

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- applies pending mobile simulator launch intent when the preview webview becomes active
  useEffect(() => {
    applyPendingMobileSimulator();
  }, [active, mobileSimulatorLaunchSeq, runtimeTabId]);

  // Keep CDP Emulation.setDeviceMetricsOverride scale fixed at 1: Electron 44 OOPIF <webview>
  // ignores CDP scale for visual shrinking, so CSS transform: scale(fitScale) handles visual fit.
  const currentDeviceEmulation = resolvePreviewDeviceEmulation(
    effectiveViewport,
    emulatedColorScheme,
    1,
  );
  const cdpEmulationActive = Boolean(currentDeviceEmulation?.enabled);

  const syncDeviceEmulation = useEffectEvent(() => {
    const bridge = window.desktopBridge?.preview;
    if (!clientSettingsHydrated || !bridge) return;
    if (typeof bridge.setDeviceEmulation === "function") {
      withDesktopTab(runtimeTabId, () =>
        bridge.setDeviceEmulation!(runtimeTabId, currentDeviceEmulation),
      );
    }
    if (currentDeviceEmulation === null && serverColorScheme === undefined) {
      withDesktopTab(runtimeTabId, () => bridge.setColorScheme(runtimeTabId, emulatedColorScheme));
    }
  });
  syncDeviceEmulationRef.current = syncDeviceEmulation;

  // Synchronize Electron CDP mobile emulation (mobile, DPR, scale=1, touch, mobile UA, color scheme) whenever viewport or color scheme changes.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- forwards viewport emulation overrides to the Electron preview bridge and restores desktop on fill/unmount
  useEffect(() => {
    syncDeviceEmulation();
  }, [
    active,
    clientSettingsHydrated,
    effectiveViewport,
    emulatedColorScheme,
    runtimeTabId,
    serverColorScheme,
    webviewGeneration,
  ]);

  const syncContentPresentation = () => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    useBrowserSurfaceStore.getState().presentContent(runtimeTabId, {
      x: layout.viewportX,
      y: layout.viewportY,
      width: layout.viewportWidth,
      height: layout.viewportHeight,
      scale: layout.viewportScale,
      scrollLeft: wrapper.scrollLeft,
      scrollTop: wrapper.scrollTop,
    });
  };

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- schedules a frame that publishes the webview layout and scroll to the browser surface store
  useEffect(() => {
    const frameId = window.requestAnimationFrame(syncContentPresentation);
    return () => window.cancelAnimationFrame(frameId);
  }, [syncContentPresentation]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- scrolls the webview wrapper element to its origin for a new tab or viewport size
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    wrapper.scrollTo({ left: 0, top: 0 });
  }, [
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A new tab or viewport size starts the canvas scrolled to its origin.
    runtimeTabId,
    viewport._tag,
    viewportHeight,
    viewportWidth,
  ]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- Report the mounted webview's visibility to the desktop host.
  useEffect(() => {
    const bridge = window.desktopBridge?.preview;
    if (!clientSettingsHydrated || !bridge || !serverDriven) return;
    withDesktopTab(runtimeTabId, () => bridge.setShown(runtimeTabId, shown));
    return () => withDesktopTab(runtimeTabId, () => bridge.setShown(runtimeTabId, false));
  }, [clientSettingsHydrated, runtimeTabId, serverDriven, shown]);

  // Captures copy the guest's raster, which a scaled guest only keeps at full detail on request.
  const fullDetail = backgroundActivity || pictureInPicture || recordingActive;
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- tells the desktop host once the guest is drawn at full detail, so its screenshot waits for that frame
  useEffect(() => {
    const bridge = window.desktopBridge?.preview;
    if (!clientSettingsHydrated || !bridge || !serverDriven || !fullDetail) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() =>
        withDesktopTab(runtimeTabId, () => bridge.setCaptureDrawn(runtimeTabId, true)),
      );
    });
    return () => {
      cancelAnimationFrame(frame);
      withDesktopTab(runtimeTabId, () => bridge.setCaptureDrawn(runtimeTabId, false));
    };
  }, [clientSettingsHydrated, fullDetail, runtimeTabId, serverDriven]);

  if (!clientSettingsHydrated || !config) return null;

  // This fixed wrapper sits outside the right panel shell, so it takes thumb presses itself.
  const navigateThumb = (direction: "back" | "forward") => {
    if (direction === "back") void previewBridge?.goBack(runtimeTabId);
    else void previewBridge?.goForward(runtimeTabId);
  };

  const renderingActive = active || backgroundActivity || pictureInPicture || recordingActive;
  const logicalWebviewWidth =
    !fittedSourceViewport && effectiveViewport._tag !== "fill"
      ? effectiveViewport.width * layoutZoomFactor
      : null;
  const logicalWebviewHeight =
    !fittedSourceViewport && effectiveViewport._tag !== "fill"
      ? effectiveViewport.height * layoutZoomFactor
      : null;
  const webviewRenderStyle = resolveHostedWebviewRenderStyle({
    viewportWidth: layout.viewportWidth,
    viewportHeight: layout.viewportHeight,
    viewportScale: layout.viewportScale,
    logicalWidth: logicalWebviewWidth,
    logicalHeight: logicalWebviewHeight,
    cdpEmulationActive,
    fullDetail,
  });
  const preserveFullDetailTransform = Boolean(webviewRenderStyle.transform && fullDetail);
  const wrapperStyle = resolveHostedBrowserWebviewWrapperStyle({
    active,
    renderingActive,
    // Electron 43 can permanently blank a macOS webview after `visibility: hidden`.
    keepPaintableWhenInactive: isMacPlatform(navigator.platform),
    cornerRadius: presentation.cornerRadius,
    zIndex: presentation.zIndex,
    rect: lastRect,
    hiddenSize: { width: hiddenWidth, height: hiddenHeight },
  });

  return (
    <div
      ref={wrapperRef}
      className="fixed overflow-hidden bg-muted/35"
      style={{ ...wrapperStyle, overscrollBehavior: "contain" }}
      onScroll={syncContentPresentation}
      onMouseDown={preventThumbButtonFocus}
      onMouseUp={(event) => takeThumbButtonNavigation(event, navigateThumb)}
      data-preview-rendering={renderingActive ? "active" : "suspended"}
      data-preview-viewport={runtimeTabId}
    >
      <div className="relative overflow-hidden" style={{ width: layout.canvasWidth, height: layout.canvasHeight }}>
        {deviceToolbarVisible && effectiveViewport._tag !== "fill" ? (
          <BrowserDeviceToolbar
            setting={effectiveViewport}
            width={Math.max(1, Math.round(active && lastRect ? lastRect.width : hiddenWidth))}
            aspectRatio={lockedAspectRatio}
            onAspectRatioChange={handleAspectRatioChange}
            onChange={commitViewportChange}
            bezelEnabled={bezelEnabled}
            onBezelEnabledChange={handleBezelEnabledChange}
            emulatedColorScheme={emulatedColorScheme}
            onEmulatedColorSchemeChange={handleColorSchemeChange}
          />
        ) : null}
        {showPhoneBezel && activePreset && bezelLayout ? (
          <PhoneBezelChassis
            bezelStyle={activePreset.bezelStyle}
            colorScheme={emulatedColorScheme}
            label={activePreset.label}
            layout={bezelLayout}
          />
        ) : null}
        <div
          // Keyed here, not on the webview: a destroyed guest's element may already be detached.
          // Always kept at the exact same tree position so toggling phone bezel never reparents <webview>.
          key={webviewGeneration}
          className={cn(
            "absolute z-20 transition-[left,top,width,height] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            !preserveFullDetailTransform && "overflow-hidden",
          )}
          style={{
            left: layout.viewportX,
            top: layout.viewportY,
            width: layout.viewportWidth,
            height: layout.viewportHeight,
            transformStyle: preserveFullDetailTransform ? "preserve-3d" : undefined,
          }}
        >
          <webview
            ref={setWebviewRef}
            // Electron needs allowpopups at attachment. React drops boolean values for unknown attributes.
            {...({ allowpopups: "true" } as unknown as { readonly allowpopups?: boolean })}
            src={webviewGeneration === 0 ? initialSrc : recoverySrc}
            partition={config.partition}
            webpreferences={config.webPreferences}
            {...(config.preloadUrl ? { preload: config.preloadUrl } : {})}
            data-preview-tab={runtimeTabId}
            data-preview-server-tab={tabId}
            data-preview-viewport-mode={effectiveViewport._tag}
            data-preview-viewport-key={browserViewportSettingKey(effectiveViewport)}
            data-preview-css-width={
              fittedSourceViewport
                ? fittedSourceViewport.width
                : effectiveViewport._tag === "fill"
                  ? Math.max(1, Math.round(layout.viewportWidth / layoutZoomFactor))
                  : effectiveViewport.width
            }
            data-preview-css-height={
              fittedSourceViewport
                ? fittedSourceViewport.height
                : effectiveViewport._tag === "fill"
                  ? Math.max(1, Math.round(layout.viewportHeight / layoutZoomFactor))
                  : effectiveViewport.height
            }
            aria-hidden={active ? undefined : true}
            className={cn(
              "absolute top-0 left-0 flex overflow-hidden bg-white",
              active && !layout.fillsPanel && !showPhoneBezel && "ring-1 ring-border/70 shadow-sm",
            )}
            style={webviewRenderStyle}
          />
        </div>
        {active && effectiveViewport._tag !== "fill" && !fittedSourceViewport ? (
          <>
            <BrowserViewportResizeHandles
              layout={layout}
              activeDirection={activeDrag?.direction ?? null}
              onPointerDown={handleResizePointerDown}
              onKeyDown={handleResizeKeyDown}
            />
            {activeDrag ? (
              <div
                className="pointer-events-none absolute z-40 -translate-x-1/2 rounded-md border border-border/80 bg-background/95 px-2 py-1 text-2xs font-medium tabular-nums text-foreground shadow-md backdrop-blur-sm"
                style={{
                  left: layout.viewportX + layout.viewportWidth / 2,
                  top: layout.viewportY + 10,
                }}
                aria-hidden="true"
              >
                {activeDrag.width} × {activeDrag.height}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
