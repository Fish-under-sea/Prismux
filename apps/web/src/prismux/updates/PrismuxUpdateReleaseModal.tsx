/* oxlint-disable prismux/no-untranslated-copy -- Prismux-native Chinese updater release modal copy */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  DownloadIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  GlobeIcon,
  LayersIcon,
  RefreshCwIcon,
  RotateCwIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";

import { APP_VERSION } from "../../branding";
import { PrismuxAppIcon } from "../../components/PrismuxAppIcon";
import { openSafeExternalHttpsUrl, validateSafeHttpsUrl } from "../../components/settings/prismuxProviderMeta";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  createBackdropDismissGuardState,
  recordBackdropPointerDown,
  shouldDismissOnBackdropClick,
} from "../../components/ui/dialog-styles";
import { cn } from "../../lib/utils";
import {
  type DaemonUpdatePackageKind,
  prismuxDaemonClient,
} from "../daemonClient";
import { useOptionalPrismuxRuntime } from "../PrismuxRuntimeProvider";
import {
  buildUpdaterStageSteps,
  describeUpdaterProgressStage,
  extractReleaseNotesHighlights,
  formatProgressPercentDisplay,
  formatUpdaterStageWeightHint,
  resolveProgressBarPercent,
  resolveRuntimeVersion,
  selectRecommendedUpdateAsset,
  type UpdateAssetView,
} from "../settings/prismuxUpdates.logic";
import {
  formatTransferSpeed,
  formatUpdateByteSize,
  formatVersionBadge,
  hasVerifiedUpdatePackage,
  isUpdateTransferActive,
  prismuxUpdateNotifierStore,
  useUpdateNotifierState,
  type RectSnapshot,
} from "./updateNotifierStore";
import { PrismuxReleaseNotesMarkdown } from "./PrismuxReleaseNotesMarkdown";

function asPackageKind(raw: string): DaemonUpdatePackageKind | undefined {
  if (raw === "setup-exe" || raw === "portable-zip" || raw === "split-7z-exe") {
    return raw;
  }
  return undefined;
}

function formatPublishedDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return raw.slice(0, 10);
  }
}

function captureRectSnapshot(el: HTMLElement | null): RectSnapshot | null {
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

function prefersReducedMotionNow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Centered Liquid Glass Release Notes & One-Click In-App Update Modal.
 * Portaled directly onto `document.body`, visually centered on both axes,
 * dismissible via backdrop click or Escape (collapses gracefully to the
 * sidebar update capsule right above the Settings icon).
 */
export function PrismuxUpdateReleaseModal() {
  const runtime = useOptionalPrismuxRuntime();
  const daemon = runtime?.daemon ?? prismuxDaemonClient;
  const state = useUpdateNotifierState();
  const titleId = useId();
  const descId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const backdropGuardRef = useRef(createBackdropDismissGuardState());
  const [entered, setEntered] = useState(false);

  const isOpen = state.presentation === "modal";
  const update = state.availableUpdate;
  const status = state.updaterStatus;

  const isTransferActive = state.downloading || isUpdateTransferActive(status);
  const hasVerifiedPackage = hasVerifiedUpdatePackage(status);
  const isInstalling = state.installing;
  const portableMode = status?.portableMode === true;

  const currentVersion = resolveRuntimeVersion(
    update?.currentVersion ?? status?.currentVersion,
    APP_VERSION,
  );
  const latestVersion = update?.latestVersion ?? null;
  const progress = status?.progress ?? null;
  const barPercent = resolveProgressBarPercent(progress, hasVerifiedPackage && !isTransferActive);
  const progressPercentText = formatProgressPercentDisplay(barPercent);
  const speedText = formatTransferSpeed(state.speedBytesPerSec);

  const recommendedAsset: UpdateAssetView | null = update
    ? (update.recommendedAsset ?? selectRecommendedUpdateAsset(update.assets, portableMode))
    : null;

  const isSplitArchive =
    recommendedAsset?.kind === "split-7z-exe" ||
    (progress?.totalParts !== null &&
      progress?.totalParts !== undefined &&
      progress.totalParts > 1) ||
    progress?.stage === "extracting";
  const stageSteps = buildUpdaterStageSteps(
    progress,
    hasVerifiedPackage && !isTransferActive,
    isSplitArchive,
  );
  const stageWeightHint = formatUpdaterStageWeightHint(progress, isSplitArchive);

  const safeReleaseHtmlUrl =
    validateSafeHttpsUrl(update?.htmlUrl) ??
    validateSafeHttpsUrl(recommendedAsset?.effectiveUrl) ??
    "https://github.com/Fish-under-sea/Prismux/releases";

  const publishedDate = formatPublishedDate(update?.publishedAt);
  const displayReleaseNotes = extractReleaseNotesHighlights(update?.releaseNotes);

  const handleDismissToCapsule = () => {
    if (isInstalling) return;
    const fromRect = captureRectSnapshot(modalRef.current);
    prismuxUpdateNotifierStore.collapseToCapsule(fromRect, prefersReducedMotionNow());
  };

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- drives entrance requestAnimationFrame and moves DOM focus to dialog when opened
  useEffect(() => {
    if (!isOpen) return;
    const raf = window.requestAnimationFrame(() => setEntered(true));
    modalRef.current?.focus();
    return () => {
      window.cancelAnimationFrame(raf);
      setEntered(false);
    };
  }, [isOpen]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- window Escape keydown listener collapses release modal to sidebar capsule
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isInstalling) return;
      event.preventDefault();
      event.stopPropagation();
      handleDismissToCapsule();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handleDismissToCapsule, isInstalling, isOpen]);

  const handleStartDownload = async () => {
    if (isTransferActive || isInstalling) return;
    prismuxUpdateNotifierStore.setDownloading(true);
    prismuxUpdateNotifierStore.setMessages({ error: null, status: null });
    try {
      const target = recommendedAsset;
      const kind = target ? asPackageKind(target.kind) : undefined;
      const result = await daemon.downloadUpdate({
        ...(kind ? { kind } : {}),
        ...(target?.name ? { assetName: target.name } : {}),
        ...(target?.source === "github" || target?.source === "gitee"
          ? { sourceOverride: target.source }
          : {}),
      });
      const prevStatus = prismuxUpdateNotifierStore.getState().updaterStatus;
      const fallbackPolicy = prevStatus?.policy ?? {
        routePreference: "auto" as const,
        channel: "prerelease" as const,
        includePrerelease: true,
        customGhProxyPrefix: "",
        pluginRegistryOverride: "auto" as const,
        timeoutMs: 15_000,
        autoCheckEnabled: prismuxUpdateNotifierStore.getState().autoCheckEnabled,
      };
      prismuxUpdateNotifierStore.hydrateFromDaemonStatus(
        {
          currentVersion: currentVersion || APP_VERSION,
          portableMode,
          policy: fallbackPolicy,
          checking: false,
          downloading: false,
          installState: "ready",
          downloadedFilePath: result.filePath,
          downloadedSha256: result.sha256,
          lastCheck: update,
          lastProbe: prevStatus?.lastProbe ?? null,
          lastError: null,
          progress: {
            stage: "ready",
            percent: 100,
            bytesDownloaded: result.bytesDownloaded ?? result.totalBytes ?? 0,
            totalBytes: result.totalBytes ?? result.bytesDownloaded ?? null,
            currentPart: null,
            totalParts: null,
            partName: null,
            message: "SHA-256 校验通过，安装包已就绪",
            // oxlint-disable-next-line react/purity -- Date.now() runs inside async download click handler, not during render (oxc#27309)
            updatedAt: Date.now(),
          },
        },
        { syncAutoCheck: false },
      );
      prismuxUpdateNotifierStore.setMessages({
        error: null,
        status: `安装包已通过 SHA-256 强校验（${result.sha256.slice(0, 14)}…），可立即重启安装。`,
      });
    } catch (err) {
      prismuxUpdateNotifierStore.setMessages({
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      prismuxUpdateNotifierStore.setDownloading(false);
    }
  };

  const handleInstallDownloaded = async () => {
    const filePath = status?.downloadedFilePath;
    const expectedSha256 = status?.downloadedSha256;
    if (!filePath || !expectedSha256) {
      prismuxUpdateNotifierStore.setMessages({
        error: "尚未检测到已通过 SHA-256 校验的安装包，请先完成软件内下载。",
      });
      return;
    }
    const bridge = window.desktopBridge?.prismux;
    if (!bridge?.installDownloadedUpdate) {
      prismuxUpdateNotifierStore.setMessages({
        error: "当前运行环境不支持一键安装桥接，请点击「去浏览器下载」手动升级。",
      });
      return;
    }
    prismuxUpdateNotifierStore.setInstalling(true);
    prismuxUpdateNotifierStore.setMessages({ error: null, status: null });
    try {
      const result = await bridge.installDownloadedUpdate({
        filePath,
        expectedSha256,
      });
      prismuxUpdateNotifierStore.setMessages({
        error: null,
        status:
          result.mode === "portable-opened"
            ? result.message || "便携模式已打开已校验安装包所在目录，请覆盖主程序并保留 data/。"
            : result.message || "正在启动已校验安装包并优雅重启 Prismux…",
      });
    } catch (err) {
      prismuxUpdateNotifierStore.setMessages({
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      prismuxUpdateNotifierStore.setInstalling(false);
    }
  };

  if (!isOpen || (!update && !hasVerifiedPackage)) {
    return null;
  }

  const sourceLabel =
    update?.sourceUsed === "gitee" ? "Gitee Releases（国内源）" : "GitHub Releases（国际源）";
  const hasPinnedStatusBanner =
    isTransferActive ||
    hasVerifiedPackage ||
    Boolean(state.errorMessage) ||
    Boolean(state.statusMessage);

  const modalNode = (
    <div
      data-slot="prismux-update-modal-backdrop"
      data-testid="prismux-update-modal-backdrop"
      data-portal-layer="prismux-update-release-modal"
      className={cn(
        "fixed inset-0 z-[75] flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs transition-opacity duration-200 [-webkit-app-region:no-drag] motion-reduce:transition-none",
        entered ? "opacity-100" : "opacity-0",
      )}
      onPointerDownCapture={(event) => {
        recordBackdropPointerDown(backdropGuardRef.current, event, modalRef.current);
      }}
      onClick={(event) => {
        if (
          shouldDismissOnBackdropClick(backdropGuardRef.current, event, modalRef.current, {
            disabled: isInstalling,
          })
        ) {
          handleDismissToCapsule();
        }
      }}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-pmx-glass-zone="overlays"
        data-testid="prismux-update-release-modal"
        className={cn(
          "dialog-glass relative flex max-h-[min(86dvh,760px)] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border text-popover-foreground shadow-2xl/50 outline-none transition-[opacity,transform] duration-200 ease-out [-webkit-app-region:no-drag] motion-reduce:transition-none",
          entered ? "scale-100 opacity-100" : "scale-[0.975] opacity-0",
        )}
      >
        {/* Header */}
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/60 px-5 pt-4 pb-3.5">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <PrismuxAppIcon className="size-7 shrink-0 rounded-lg object-contain ring-1 ring-border/35 [[data-pmx-glass='1']_&]:ring-foreground/15" />
              <h2 id={titleId} className="text-base font-semibold tracking-tight text-foreground">
                发现新版本
              </h2>
              {latestVersion ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-2xs font-medium tabular-nums text-foreground">
                  <span>{formatVersionBadge(currentVersion) || "当前版本"}</span>
                  <ArrowRightIcon className="size-3 text-muted-foreground" aria-hidden="true" />
                  <span className="font-semibold text-primary">
                    {formatVersionBadge(latestVersion)}
                  </span>
                </span>
              ) : null}
            </div>

            <div
              id={descId}
              className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground"
            >
              <span className="inline-flex items-center gap-1">
                <GlobeIcon className="size-3 shrink-0" aria-hidden="true" />
                <span>{sourceLabel}</span>
              </span>
              {publishedDate ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">发布于 {publishedDate}</span>
                </>
              ) : null}
              {update?.usedFallbackSource ? (
                <Badge variant="warning" size="sm">
                  已切换备用源
                </Badge>
              ) : null}
              {recommendedAsset?.kind === "split-7z-exe" ? (
                <Badge variant="secondary" size="sm">
                  {recommendedAsset.parts.length || 3} 分卷自动重组
                </Badge>
              ) : null}
            </div>
          </div>

          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="关闭更新公告弹窗"
            data-testid="prismux-update-modal-close"
            disabled={isInstalling}
            onClick={handleDismissToCapsule}
            className="shrink-0"
          >
            <XIcon className="size-4" />
          </Button>
        </header>

        {/* Pinned Non-Scrolling Progress / Verified / Error / Status Slot */}
        {hasPinnedStatusBanner ? (
          <div
            data-testid="prismux-update-modal-status-slot"
            className="shrink-0 space-y-2.5 border-b border-border/50 px-5 py-3 [[data-pmx-glass='1']_&]:border-white/15 [html:not(.dark)[data-pmx-glass='1']_&]:border-black/10"
          >
            {/* Real-time download / split extraction / SHA-256 verification card */}
            {isTransferActive || hasVerifiedPackage ? (
              <section
                data-testid="prismux-update-modal-progress"
                className={cn(
                  "space-y-3 rounded-xl border p-3.5 text-xs shadow-xs",
                  hasVerifiedPackage && !isTransferActive
                    ? "border-success/35 bg-success/[0.07] dark:border-success/40 dark:bg-success/[0.11] [[data-pmx-glass='1']_&]:border-success/45 [[data-pmx-glass='1']_&]:bg-success/[0.14] [html:not(.dark)[data-pmx-glass='1']_&]:bg-success/[0.10]"
                    : "border-primary/35 bg-primary/[0.07] dark:border-primary/40 dark:bg-primary/[0.11] [[data-pmx-glass='1']_&]:border-primary/45 [[data-pmx-glass='1']_&]:bg-primary/[0.14] [html:not(.dark)[data-pmx-glass='1']_&]:border-primary/40 [html:not(.dark)[data-pmx-glass='1']_&]:bg-primary/[0.10]",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                    {hasVerifiedPackage && !isTransferActive ? (
                      <ShieldCheckIcon className="size-4 shrink-0 text-success-foreground" />
                    ) : (
                      <RefreshCwIcon className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
                    )}
                    <span className="truncate">
                      {isTransferActive
                        ? describeUpdaterProgressStage(progress)
                        : "SHA-256 整包校验通过，安装包已就绪"}
                    </span>
                  </div>
                  <span
                    data-testid="prismux-update-modal-percent"
                    className={cn(
                      "shrink-0 font-mono tabular-nums",
                      progressPercentText !== null
                        ? "text-xs font-semibold text-foreground"
                        : "text-2xs font-medium text-muted-foreground",
                    )}
                  >
                    {progressPercentText ?? "连接中…"}
                  </span>
                </div>

                {/* 4-Stage Visual Progression Indicator */}
                <div
                  data-testid="prismux-update-modal-stages"
                  className="grid grid-cols-4 gap-1.5"
                >
                  {stageSteps.map((step) => (
                    <div
                      key={step.id}
                      data-stage-step={step.id}
                      data-stage-state={step.state}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-3xs transition-colors motion-reduce:transition-none",
                        step.state === "completed"
                          ? "border-success/35 bg-success/[0.09] text-success-foreground [[data-pmx-glass='1']_&]:border-success/45 [[data-pmx-glass='1']_&]:bg-success/[0.16]"
                          : step.state === "active"
                            ? "border-primary/50 bg-primary/[0.16] font-semibold text-foreground dark:border-primary/55 dark:bg-primary/[0.22] [[data-pmx-glass='1']_&]:border-primary/60 [[data-pmx-glass='1']_&]:bg-primary/[0.24]"
                            : "border-border/50 bg-foreground/[0.025] text-muted-foreground dark:bg-white/[0.03] [[data-pmx-glass='1']_&]:border-white/15 [[data-pmx-glass='1']_&]:bg-white/[0.06] [html:not(.dark)[data-pmx-glass='1']_&]:border-black/10 [html:not(.dark)[data-pmx-glass='1']_&]:bg-black/[0.035]",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          step.state === "completed"
                            ? "bg-success"
                            : step.state === "active"
                              ? "bg-primary animate-pulse motion-reduce:animate-none"
                              : "bg-muted-foreground/40",
                        )}
                      />
                      <span className="truncate">{step.label}</span>
                    </div>
                  ))}
                </div>

                {isTransferActive ? (
                  <div className="space-y-2">
                    <div
                      role="progressbar"
                      aria-label="软件内更新下载进度"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      {...(barPercent !== null ? { "aria-valuenow": Math.round(barPercent) } : {})}
                      data-progress-mode={barPercent !== null ? "determinate" : "indeterminate"}
                      data-testid="prismux-update-modal-progressbar"
                      className="relative h-2 w-full overflow-hidden rounded-full bg-foreground/12 dark:bg-white/14 [[data-pmx-glass='1']_&]:bg-white/18 [html:not(.dark)[data-pmx-glass='1']_&]:bg-black/12"
                    >
                      {barPercent !== null ? (
                        <div
                          data-testid="prismux-update-modal-progressbar-fill"
                          className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
                          style={{ width: `${barPercent}%` }}
                        />
                      ) : (
                        <div
                          data-testid="prismux-update-modal-progressbar-indeterminate"
                          className="h-full w-full rounded-full bg-gradient-to-r from-primary/15 via-primary/85 to-primary/15 animate-pulse motion-reduce:animate-none"
                        />
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-2xs tabular-nums text-muted-foreground">
                      <span>
                        {progress?.stage === "downloading"
                          ? barPercent === null && progress.bytesDownloaded <= 0
                            ? "正在连接下载源…"
                            : progress.bytesDownloaded > 0 || progress.totalBytes
                              ? `已下载 ${formatUpdateByteSize(progress.bytesDownloaded)}${progress.totalBytes ? ` / ${formatUpdateByteSize(progress.totalBytes)}` : ""}`
                              : "已连接下载源，准备接收数据…"
                          : progress?.stage === "extracting"
                            ? `正在通过内置 7za.exe 无损合并分卷…${progress.totalBytes ? `（${formatUpdateByteSize(progress.totalBytes)}）` : ""}`
                            : progress?.stage === "verifying"
                              ? `正在逐字节核验 SHA-256 摘要…${progress.totalBytes ? `（${formatUpdateByteSize(progress.totalBytes)}）` : ""}`
                              : progress?.message ?? "正在连接下载源…"}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {speedText && progress?.stage === "downloading" ? (
                          <span
                            data-testid="prismux-update-modal-speed"
                            className="rounded-md border border-primary/25 bg-primary/[0.09] px-1.5 py-0.5 font-mono text-3xs font-medium text-foreground tabular-nums dark:border-primary/35 dark:bg-primary/[0.16] [[data-pmx-glass='1']_&]:border-primary/40 [[data-pmx-glass='1']_&]:bg-primary/[0.20]"
                          >
                            {speedText}
                          </span>
                        ) : null}
                        {progress?.totalParts && progress.totalParts > 1 ? (
                          <span
                            data-testid="prismux-update-modal-part"
                            className="inline-flex items-center gap-1 rounded-md border border-primary/25 bg-primary/[0.09] px-1.5 py-0.5 font-mono text-3xs font-medium text-foreground tabular-nums dark:border-primary/35 dark:bg-primary/[0.16] [[data-pmx-glass='1']_&]:border-primary/40 [[data-pmx-glass='1']_&]:bg-primary/[0.20]"
                          >
                            <LayersIcon className="size-3 text-primary" />
                            分卷 {progress.currentPart ?? 1}/{progress.totalParts}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="text-3xs text-muted-foreground/85 tabular-nums">
                      {stageWeightHint}
                    </div>
                  </div>
                ) : null}

                {hasVerifiedPackage && !isTransferActive ? (
                  <div className="space-y-1.5 rounded-lg border border-border/60 bg-foreground/[0.04] px-3 py-2 font-mono text-2xs text-muted-foreground dark:bg-white/[0.05] [[data-pmx-glass='1']_&]:border-white/15 [[data-pmx-glass='1']_&]:bg-white/[0.07] [html:not(.dark)[data-pmx-glass='1']_&]:border-black/10 [html:not(.dark)[data-pmx-glass='1']_&]:bg-black/[0.04]">
                    <div className="break-all text-foreground">
                      文件：{status?.downloadedFilePath}
                    </div>
                    <div className="truncate">SHA-256：{status?.downloadedSha256}</div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {state.errorMessage ? (
              <div
                role="alert"
                data-testid="prismux-update-modal-error"
                className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground [[data-pmx-glass='1']_&]:border-destructive/50 [[data-pmx-glass='1']_&]:bg-destructive/18"
              >
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span className="min-w-0 flex-1 break-all">{state.errorMessage}</span>
              </div>
            ) : null}

            {state.statusMessage ? (
              <div
                role="status"
                aria-live="polite"
                data-testid="prismux-update-modal-status"
                className="flex items-start gap-2 rounded-xl border border-success/35 bg-success/10 px-3 py-2 text-xs text-success-foreground [[data-pmx-glass='1']_&]:border-success/45 [[data-pmx-glass='1']_&]:bg-success/16"
              >
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1">{state.statusMessage}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Scrollable Release Notes */}
        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-5 py-4">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground">
                更新公告
                {update?.releaseName &&
                update.releaseName.trim() !== update.tagName &&
                update.releaseName.trim() !== formatVersionBadge(latestVersion)
                  ? ` · ${update.releaseName.trim()}`
                  : ""}
              </h3>
              {recommendedAsset?.sizeBytes ? (
                <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                  安装包 {formatUpdateByteSize(recommendedAsset.sizeBytes)}
                </span>
              ) : null}
            </div>

            <div className="rounded-xl border border-border/65 bg-foreground/[0.03] px-4 py-3.5 dark:bg-white/[0.035]">
              <PrismuxReleaseNotesMarkdown
                markdown={displayReleaseNotes}
                data-testid="prismux-update-release-notes"
                fallback={
                  <p className="text-muted-foreground">
                    此版本包含性能与液态玻璃体验优化及若干稳定性修复，支持在软件内直接下载并完成 SHA-256 强校验升级。
                  </p>
                }
              />
            </div>
          </section>
        </div>

        {/* Footer Actions */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-muted/25 px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isInstalling}
              data-testid="prismux-update-modal-later"
              onClick={handleDismissToCapsule}
            >
              稍后提醒
            </Button>
            {safeReleaseHtmlUrl ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  openSafeExternalHttpsUrl(safeReleaseHtmlUrl);
                }}
              >
                去浏览器下载
                <ExternalLinkIcon className="size-3.5" />
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {hasVerifiedPackage && !isTransferActive ? (
              <Button
                type="button"
                size="sm"
                disabled={isInstalling}
                data-testid="prismux-update-modal-install"
                onClick={() => {
                  void handleInstallDownloaded();
                }}
              >
                {portableMode ? (
                  <FolderOpenIcon className="size-3.5" />
                ) : (
                  <RotateCwIcon className={cn("size-3.5", isInstalling && "animate-spin")} />
                )}
                {isInstalling
                  ? "正在重启安装…"
                  : portableMode
                    ? "打开安装包目录"
                    : "立即重启安装"}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={isTransferActive || isInstalling}
                data-testid="prismux-update-modal-download"
                onClick={() => {
                  void handleStartDownload();
                }}
              >
                {isTransferActive ? (
                  <RefreshCwIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
                ) : (
                  <DownloadIcon className="size-3.5" />
                )}
                {isTransferActive
                  ? progress?.stage === "extracting"
                    ? progressPercentText
                      ? `合并分卷 ${progressPercentText}`
                      : "分卷重组中…"
                    : progress?.stage === "verifying"
                      ? progressPercentText
                        ? `SHA-256 校验 ${progressPercentText}`
                        : "SHA-256 校验中…"
                      : progressPercentText !== null
                        ? `下载中 ${progressPercentText}`
                        : "正在连接下载源…"
                  : "软件内一键更新"}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalNode, document.body) : modalNode;
}
