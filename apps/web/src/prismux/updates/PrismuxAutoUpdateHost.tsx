/* oxlint-disable prismux/no-untranslated-copy -- Prismux-native Chinese updater toast and flight overlay copy */
import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowUpIcon, XIcon } from "lucide-react";

import { APP_VERSION } from "../../branding";
import { T3AppIcon } from "../../components/T3AppIcon";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { prismuxDaemonClient, type PrismuxDaemonClient } from "../daemonClient";
import { useOptionalPrismuxRuntime } from "../PrismuxRuntimeProvider";
import {
  parseCheckResult,
  parseUpdaterStatusPayload,
  resolveRuntimeVersion,
  type UpdateCheckView,
} from "../settings/prismuxUpdates.logic";
import { PrismuxUpdateReleaseModal } from "./PrismuxUpdateReleaseModal";
import {
  extractReleaseNotesPreview,
  formatVersionBadge,
  isUpdateTransferActive,
  normalizeVersionString,
  PRISMUX_UPDATE_AVAILABLE_EVENT,
  prismuxUpdateNotifierStore,
  startUpdaterStatusFallbackPoller,
  UPDATER_SSE_STALE_FALLBACK_MS,
  UPDATER_STATUS_POLL_INTERVAL_MS,
  useUpdateNotifierState,
  type RectSnapshot,
  type UpdateFlyTransition,
  type UpdateNotifierStore,
} from "./updateNotifierStore";

const STARTUP_CHECK_DELAY_MS = 4_000;
const RECENT_CHECK_FRESHNESS_MS = 5 * 60 * 1000;
const FLY_DURATION_MS = 460;

let activeHostOwnerId = 0;
let nextHostOwnerSeq = 1;
const primaryHostListeners = new Set<() => void>();

function emitPrimaryHostChange(): void {
  for (const listener of primaryHostListeners) {
    listener();
  }
}

function subscribePrimaryHost(listener: () => void): () => void {
  primaryHostListeners.add(listener);
  return () => {
    primaryHostListeners.delete(listener);
  };
}

function getPrimaryHostOwnerId(): number {
  return activeHostOwnerId;
}

export type ManualUpdateCheckOutcome =
  | {
      readonly status: "up-to-date";
      readonly currentVersion: string | null;
      readonly check: UpdateCheckView;
    }
  | {
      readonly status: "update-available";
      readonly currentVersion: string | null;
      readonly latestVersion: string;
      readonly check: UpdateCheckView;
    }
  | {
      readonly status: "error";
      readonly errorMessage: string;
    };

export interface RunPrismuxManualUpdateCheckOptions {
  readonly daemon?: Pick<PrismuxDaemonClient, "checkForUpdates">;
  readonly store?: UpdateNotifierStore;
  readonly appVersionFallback?: string;
}

/**
 * Executes an explicit user-initiated update check for the inline brand menu:
 * - Never opens the centered release modal or navigates to settings.
 * - When an update exists, immediately presents the bottom-right liquid glass toast
 *   even if that version was previously collapsed into the sidebar capsule.
 */
export async function runPrismuxManualUpdateCheck(
  options: RunPrismuxManualUpdateCheckOptions = {},
): Promise<ManualUpdateCheckOutcome> {
  const daemon = options.daemon ?? prismuxDaemonClient;
  const store = options.store ?? prismuxUpdateNotifierStore;
  const appVersionFallback = options.appVersionFallback ?? APP_VERSION;
  const current = store.getState();

  store.setChecking(true);
  try {
    const channel = current.updaterStatus?.policy.channel ?? "prerelease";
    const raw = await daemon.checkForUpdates<unknown>({
      channel,
      includePrerelease: channel === "prerelease",
    });
    const fallbackVersion = resolveRuntimeVersion(
      current.updaterStatus?.currentVersion,
      appVersionFallback,
    );
    const parsed = parseCheckResult(raw, fallbackVersion);
    if (!parsed) {
      return {
        status: "error",
        errorMessage: "无法解析更新检查响应",
      };
    }

    const resolvedCurrent = resolveRuntimeVersion(parsed.currentVersion, fallbackVersion) || null;
    const latestNorm = normalizeVersionString(parsed.latestVersion);
    if (parsed.hasUpdate && latestNorm) {
      store.openToastForAvailableUpdate(parsed);
      return {
        status: "update-available",
        currentVersion: resolvedCurrent,
        latestVersion: latestNorm,
        check: parsed,
      };
    }

    store.reportUpdateAvailable(parsed);
    return {
      status: "up-to-date",
      currentVersion: resolvedCurrent,
      check: parsed,
    };
  } catch (err) {
    return {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    store.setChecking(false);
  }
}

export interface PrismuxUpdateNoticeTriggerPayload {
  readonly latestVersion?: string;
  readonly currentVersion?: string;
  readonly releaseName?: string | null;
  readonly releaseNotes?: string | null;
  readonly publishedAt?: string | null;
  readonly sourceUsed?: "github" | "gitee";
  readonly htmlUrl?: string | null;
  readonly forceToast?: boolean;
}

export interface PrismuxUpdateNoticeTestBridge {
  trigger: (payload?: PrismuxUpdateNoticeTriggerPayload) => void;
  openModal: () => void;
  collapseToCapsule: () => void;
  reset: () => void;
  getState: () => ReturnType<typeof prismuxUpdateNotifierStore.getState>;
}

declare global {
  interface Window {
    __prismuxUpdateNoticeTest?: PrismuxUpdateNoticeTestBridge;
  }
}

function buildUpdateCheckFromTriggerPayload(
  payload?: PrismuxUpdateNoticeTriggerPayload | null,
): UpdateCheckView {
  const latestVersion =
    typeof payload?.latestVersion === "string" && payload.latestVersion.trim().length > 0
      ? payload.latestVersion.trim().replace(/^v/i, "")
      : "0.2.0";
  const currentVersion =
    typeof payload?.currentVersion === "string" && payload.currentVersion.trim().length > 0
      ? payload.currentVersion.trim().replace(/^v/i, "")
      : APP_VERSION;
  const sourceUsed = payload?.sourceUsed === "gitee" ? "gitee" : "github";
  return {
    checkedAt: Date.now(),
    currentVersion,
    hasUpdate: true,
    latestVersion,
    tagName: `v${latestVersion}`,
    channel: latestVersion.includes("-") ? "prerelease" : "stable",
    releaseName: payload?.releaseName ?? `Prismux v${latestVersion}`,
    releaseNotes:
      payload?.releaseNotes ??
      [
        "## 本次更新亮点",
        "- 新增自动检测更新与右下角液态玻璃温和提醒体验",
        "- 支持居中更新公告弹窗、双源直连下载与 SHA-256 强校验一键重启安装",
        "- 关闭提醒卡片后平滑收拢至左侧边栏「设置」按键正上方小胶囊",
      ].join("\n"),
    publishedAt: payload?.publishedAt ?? new Date().toISOString(),
    htmlUrl:
      payload?.htmlUrl ??
      `https://github.com/Fish-under-sea/Prismux/releases/tag/v${latestVersion}`,
    sourceUsed,
    usedFallbackSource: false,
    recommendedAsset: null,
    assets: [],
  };
}

function prefersReducedMotionNow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function measureRect(el: HTMLElement | null): RectSnapshot | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * FLIP / curved flight animation layer that smoothly shrinks and glides the
 * dismissed bottom-right update toast (or modal) directly into the sidebar
 * update capsule slot above the Settings icon.
 */
function PrismuxUpdateFlyOverlay({ transition }: { readonly transition: UpdateFlyTransition }) {
  const ghostRef = useRef<HTMLDivElement>(null);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- drives Web Animations API FLIP flight on DOM portal node
  useLayoutEffect(() => {
    const ghost = ghostRef.current;
    if (!ghost || typeof document === "undefined") {
      prismuxUpdateNotifierStore.clearFlyTransition(transition.id);
      return;
    }

    const targetEl = document.querySelector<HTMLElement>(
      '[data-prismux-update-capsule-slot="true"]',
    );
    const toRect = targetEl ? targetEl.getBoundingClientRect() : null;
    if (!toRect || toRect.width <= 0 || toRect.height <= 0 || typeof ghost.animate !== "function") {
      const quickTimer = window.setTimeout(() => {
        prismuxUpdateNotifierStore.clearFlyTransition(transition.id);
      }, 60);
      return () => window.clearTimeout(quickTimer);
    }

    const from = transition.fromRect;
    const midLeft = from.left + (toRect.left - from.left) * 0.45;
    const midTop = Math.min(window.innerHeight - 40, Math.max(from.top, toRect.top) + 18);
    const midWidth = Math.max(toRect.width, Math.min(from.width, 196));
    const midHeight = Math.max(toRect.height, 34);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      prismuxUpdateNotifierStore.clearFlyTransition(transition.id);
    };

    const anim = ghost.animate(
      [
        {
          transform: `translate3d(${from.left}px, ${from.top}px, 0) scale(1)`,
          width: `${from.width}px`,
          height: `${Math.min(from.height, 148)}px`,
          borderRadius: "16px",
          opacity: 0.96,
        },
        {
          transform: `translate3d(${midLeft}px, ${midTop}px, 0) scale(0.94)`,
          width: `${midWidth}px`,
          height: `${midHeight}px`,
          borderRadius: "9999px",
          opacity: 0.9,
          offset: 0.52,
        },
        {
          transform: `translate3d(${toRect.left}px, ${toRect.top}px, 0) scale(1)`,
          width: `${toRect.width}px`,
          height: `${toRect.height}px`,
          borderRadius: "9999px",
          opacity: 0.25,
        },
      ],
      {
        duration: FLY_DURATION_MS,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards",
      },
    );

    anim.onfinish = finish;
    anim.oncancel = finish;
    const safetyTimer = window.setTimeout(finish, FLY_DURATION_MS + 90);
    return () => {
      window.clearTimeout(safetyTimer);
      try {
        anim.cancel();
      } catch {
        // ignore
      }
    };
  }, [transition]);

  const versionText = formatVersionBadge(transition.version);

  return createPortal(
    <div
      ref={ghostRef}
      aria-hidden="true"
      data-testid="prismux-update-fly-ghost"
      data-pmx-glass-zone="overlays"
      className="dialog-glass pointer-events-none fixed top-0 left-0 z-[72] flex items-center gap-1.5 overflow-hidden border border-primary/40 px-3 text-xs font-medium text-foreground shadow-xl will-change-transform"
      style={{
        transform: `translate3d(${transition.fromRect.left}px, ${transition.fromRect.top}px, 0)`,
        width: `${transition.fromRect.width}px`,
        height: `${Math.min(transition.fromRect.height, 148)}px`,
        borderRadius: "16px",
      }}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-primary" />
      <ArrowUpIcon className="size-3 shrink-0 text-primary" />
      <span className="truncate">{versionText ? `发现新版本 ${versionText}` : "发现新版本"}</span>
    </div>,
    document.body,
  );
}

function PrismuxUpdateToastCardPortal({ update }: { readonly update: UpdateCheckView }) {
  const toastRef = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- schedules one requestAnimationFrame tick to trigger CSS entrance transition on mounted portal
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const versionBadge = formatVersionBadge(update.latestVersion);
  const preview = extractReleaseNotesPreview(update.releaseNotes);
  const sourceBadge = update.sourceUsed === "gitee" ? "Gitee" : "GitHub";

  const handleDismiss = () => {
    const fromRect = measureRect(toastRef.current);
    prismuxUpdateNotifierStore.collapseToCapsule(fromRect, prefersReducedMotionNow());
  };

  const handleOpen = () => {
    prismuxUpdateNotifierStore.openReleaseModal();
  };

  return createPortal(
    <aside
      ref={toastRef}
      role="status"
      aria-live="polite"
      aria-label={`发现新版本 ${versionBadge}`}
      data-testid="prismux-update-toast"
      data-pmx-glass-zone="overlays"
      className={cn(
        "dialog-glass fixed right-4 bottom-[calc(var(--pmx-status-bar-height,20px)+12px)] z-[65] w-[328px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border p-3.5 text-popover-foreground shadow-2xl/45 transition-[opacity,transform] duration-260 ease-out [-webkit-app-region:no-drag] motion-reduce:transition-none",
        entered ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-[0.97] opacity-0",
      )}
    >
      <div className="flex items-start gap-2.5">
        <T3AppIcon className="mt-0.5 size-7 shrink-0 rounded-lg object-contain ring-1 ring-border/35 [[data-pmx-glass='1']_&]:ring-foreground/15" />

        <div className="min-w-0 flex-1 cursor-pointer space-y-1" onClick={handleOpen}>
          <div className="flex flex-wrap items-center gap-1.5 pr-6">
            <span className="text-sm font-semibold tracking-tight text-foreground">
              发现新版本 {versionBadge}
            </span>
            <Badge variant="outline" size="sm">
              {sourceBadge}
            </Badge>
          </div>

          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{preview}</p>
        </div>

        <button
          type="button"
          data-testid="prismux-update-toast-close"
          aria-label="关闭更新提醒并收拢至侧边栏"
          onClick={handleDismiss}
          className="absolute top-2.5 right-2.5 inline-flex size-6 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/[0.1]"
        >
          <XIcon className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/50 pt-2.5">
        <span className="truncate font-mono text-2xs tabular-nums text-muted-foreground">
          {update.currentVersion
            ? `当前 ${formatVersionBadge(update.currentVersion)}`
            : "软件内直连升级"}
        </span>
        <Button
          type="button"
          size="xs"
          data-testid="prismux-update-toast-open"
          onClick={handleOpen}
        >
          查看更新
        </Button>
      </div>
    </aside>,
    document.body,
  );
}

/**
 * Bottom-right liquid glass notification card hovering cleanly above the 20px status bar.
 */
export function PrismuxUpdateToastCard() {
  const state = useUpdateNotifierState();

  const visible =
    state.presentation === "toast" &&
    Boolean(state.availableUpdate?.hasUpdate && state.availableUpdate.latestVersion);

  if (!visible || !state.availableUpdate || typeof document === "undefined") {
    return null;
  }

  return <PrismuxUpdateToastCardPortal update={state.availableUpdate} />;
}

/**
 * Global auto-update controller & portal host mounted once inside SidebarChromeFooter.
 * Owns background auto-check timers, Daemon SSE subscription, bottom-right toast,
 * curved FLIP flight animation, and centered release notes modal.
 */
export const PrismuxAutoUpdateHost = memo(function PrismuxAutoUpdateHost() {
  const runtime = useOptionalPrismuxRuntime();
  const daemon = runtime?.daemon ?? prismuxDaemonClient;
  const daemonReady = runtime?.daemonInfo.ready ?? false;
  const state = useUpdateNotifierState();
  const [ownerId] = useState<number>(() => nextHostOwnerSeq++);
  const daemonManagesScheduleRef = useRef<boolean>(false);
  const primaryOwnerId = useSyncExternalStore(
    subscribePrimaryHost,
    getPrimaryHostOwnerId,
    getPrimaryHostOwnerId,
  );
  const isPrimaryHost = primaryOwnerId === ownerId;

  // Claim single-instance host ownership so portals & timers never duplicate across sidebars.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- registers and releases module-level singleton host ownership across sidebar mounts
  useEffect(() => {
    if (activeHostOwnerId === 0) {
      activeHostOwnerId = ownerId;
      emitPrimaryHostChange();
    }
    return () => {
      if (activeHostOwnerId === ownerId) {
        activeHostOwnerId = 0;
        emitPrimaryHostChange();
      }
    };
  }, [ownerId]);

  const runSilentUpdateCheck = async () => {
    const current = prismuxUpdateNotifierStore.getState();
    if (!current.autoCheckEnabled || current.checking || current.downloading) {
      return;
    }
    prismuxUpdateNotifierStore.setChecking(true);
    try {
      const channel = current.updaterStatus?.policy.channel ?? "prerelease";
      const res = await daemon.checkForUpdates<unknown>({
        channel,
        includePrerelease: channel === "prerelease",
      });
      const parsed = parseCheckResult(res, current.updaterStatus?.currentVersion ?? APP_VERSION);
      if (parsed) {
        prismuxUpdateNotifierStore.reportUpdateAvailable(parsed);
      }
    } catch {
      // Silent background check failures stay non-intrusive.
    } finally {
      prismuxUpdateNotifierStore.setChecking(false);
    }
  };

  // Hydrate initial updater status + subscribe to real-time SSE events when daemon is ready.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to Daemon updater SSE stream and hydrates initial updater status while mounted
  useEffect(() => {
    if (!isPrimaryHost || !daemonReady) return;
    let cancelled = false;

    const syncStatusOnce = () => {
      void daemon
        .fetchUpdaterStatus()
        .then(async (raw) => {
          if (cancelled) return;
          if (
            raw &&
            typeof raw === "object" &&
            typeof raw.nextAutoCheckAt === "number" &&
            Number.isFinite(raw.nextAutoCheckAt)
          ) {
            daemonManagesScheduleRef.current = true;
          }
          const parsed = parseUpdaterStatusPayload(raw, APP_VERSION);
          if (!parsed) return;
          if (prismuxUpdateNotifierStore.isLocalAutoCheckDirty()) {
            const desired = prismuxUpdateNotifierStore.getState().autoCheckEnabled;
            prismuxUpdateNotifierStore.hydrateFromDaemonStatus(parsed, { syncAutoCheck: false });
            if (parsed.policy.autoCheckEnabled !== desired) {
              try {
                await daemon.updateUpdaterPolicy({ autoCheckEnabled: desired });
                prismuxUpdateNotifierStore.clearLocalAutoCheckDirty();
              } catch {
                // Keep local preference until daemon accepts update.
              }
            } else {
              prismuxUpdateNotifierStore.clearLocalAutoCheckDirty();
            }
          } else {
            prismuxUpdateNotifierStore.hydrateFromDaemonStatus(parsed, { syncAutoCheck: true });
          }
        })
        .catch(() => {
          // Offline or daemon restarting; local preference remains active.
        });
    };

    syncStatusOnce();

    // Infinite exponential-backoff reconnect while mounted (unbounded reconnect attempts).
    const unsubscribe = daemon.subscribeUpdaterEvents(
      (event) => {
        if (cancelled) return;
        prismuxUpdateNotifierStore.applySseEvent(event, APP_VERSION);
      },
      {
        reconnectDelayMs: 1_000,
        maxReconnectDelayMs: 15_000,
        onOpen: () => {
          if (cancelled) return;
          const current = prismuxUpdateNotifierStore.getState();
          if (current.downloading || isUpdateTransferActive(current.updaterStatus)) {
            syncStatusOnce();
          }
        },
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [daemon, daemonReady, isPrimaryHost]);

  const isTransferActive = state.downloading || isUpdateTransferActive(state.updaterStatus);

  // Fallback status poller while download / extraction / verification is active:
  // If SSE goes silent > 700ms, poll GET /v1/updater/status every 500ms so progress never freezes.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- manages interval fallback poller lifecycle during active updater transfer
  useEffect(() => {
    if (!isPrimaryHost || !daemonReady || !isTransferActive) return;
    return startUpdaterStatusFallbackPoller({
      store: prismuxUpdateNotifierStore,
      fetchStatus: () => daemon.fetchUpdaterStatus(),
      parseStatus: (raw) => parseUpdaterStatusPayload(raw, APP_VERSION),
      intervalMs: UPDATER_STATUS_POLL_INTERVAL_MS,
      staleThresholdMs: UPDATER_SSE_STALE_FALLBACK_MS,
    });
  }, [daemon, daemonReady, isPrimaryHost, isTransferActive]);

  // Daemon owns scheduled background update checks and broadcasts results over SSE.
  // Eliminate redundant 4-hour browser polling; only run a single fallback startup check if Daemon
  // has neither reported a recent check nor scheduled its own `nextAutoCheckAt`.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- schedules one fallback startup update check timer when daemon schedule is absent
  useEffect(() => {
    if (!isPrimaryHost || !daemonReady || !state.autoCheckEnabled) return;

    const startupTimer = window.setTimeout(() => {
      if (daemonManagesScheduleRef.current) {
        return;
      }
      const snapshot = prismuxUpdateNotifierStore.getState();
      const lastCheckedAt = snapshot.updaterStatus?.lastCheck?.checkedAt ?? 0;
      const isFresh = lastCheckedAt > 0 && Date.now() - lastCheckedAt < RECENT_CHECK_FRESHNESS_MS;
      if (!isFresh) {
        void runSilentUpdateCheck();
      }
    }, STARTUP_CHECK_DELAY_MS);

    return () => {
      window.clearTimeout(startupTimer);
    };
  }, [daemonReady, isPrimaryHost, runSilentUpdateCheck, state.autoCheckEnabled]);

  // Lightweight event & test hook for verification (zero mock data fired on startup in production).
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- registers window update notice event listener and verification bridge while mounted
  useEffect(() => {
    if (!isPrimaryHost || typeof window === "undefined") return;

    const triggerNotice = (payload?: PrismuxUpdateNoticeTriggerPayload) => {
      const check = buildUpdateCheckFromTriggerPayload(payload);
      prismuxUpdateNotifierStore.reportUpdateAvailable(check, {
        forceToast: payload?.forceToast !== false,
      });
    };

    const handleCustomEvent = (event: Event) => {
      const detail =
        event instanceof CustomEvent && event.detail && typeof event.detail === "object"
          ? (event.detail as PrismuxUpdateNoticeTriggerPayload)
          : undefined;
      triggerNotice(detail);
    };

    window.addEventListener(PRISMUX_UPDATE_AVAILABLE_EVENT, handleCustomEvent);
    window.__prismuxUpdateNoticeTest = {
      trigger: triggerNotice,
      openModal: () => prismuxUpdateNotifierStore.openReleaseModal(),
      collapseToCapsule: () => {
        const toastEl = document.querySelector<HTMLElement>('[data-testid="prismux-update-toast"]');
        const modalEl = document.querySelector<HTMLElement>(
          '[data-testid="prismux-update-release-modal"]',
        );
        const fromRect = measureRect(toastEl ?? modalEl);
        prismuxUpdateNotifierStore.collapseToCapsule(fromRect, prefersReducedMotionNow());
      },
      reset: () => prismuxUpdateNotifierStore.dismissAllForReset(),
      getState: () => prismuxUpdateNotifierStore.getState(),
    };

    return () => {
      window.removeEventListener(PRISMUX_UPDATE_AVAILABLE_EVENT, handleCustomEvent);
      delete window.__prismuxUpdateNoticeTest;
    };
  }, [isPrimaryHost]);

  if (!isPrimaryHost) {
    return null;
  }

  return (
    <>
      <PrismuxUpdateToastCard />
      {state.flyTransition ? <PrismuxUpdateFlyOverlay transition={state.flyTransition} /> : null}
      <PrismuxUpdateReleaseModal />
    </>
  );
});
