import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
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
  SparklesIcon,
  XIcon,
} from "lucide-react";

import { APP_VERSION } from "../../branding";
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
  describeUpdaterProgressStage,
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
  parseReleaseNotesBlocks,
  prismuxUpdateNotifierStore,
  useUpdateNotifierState,
  type RectSnapshot,
} from "./updateNotifierStore";

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

function renderInlineMarkdown(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const token = match[0] ?? "";
    if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      tokens.push(
        <code
          key={`c-${key++}`}
          className="rounded bg-foreground/[0.08] px-1 py-0.5 font-mono text-[11px] text-foreground dark:bg-white/10"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      tokens.push(
        <strong key={`b-${key++}`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      tokens.push(token);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }
  return tokens;
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
  const progressPercent =
    progress?.percent !== null && progress?.percent !== undefined
      ? Math.max(0, Math.min(100, Math.round(progress.percent)))
      : progress?.stage === "ready"
        ? 100
        : null;
  const speedText = formatTransferSpeed(state.speedBytesPerSec);

  const recommendedAsset = useMemo<UpdateAssetView | null>(() => {
    if (!update) return null;
    return (
      update.recommendedAsset ??
      selectRecommendedUpdateAsset(update.assets, portableMode)
    );
  }, [portableMode, update]);

  const safeReleaseHtmlUrl =
    validateSafeHttpsUrl(update?.htmlUrl) ??
    validateSafeHttpsUrl(recommendedAsset?.effectiveUrl) ??
    "https://github.com/Fish-under-sea/Prismux/releases";

  const releaseBlocks = useMemo(
    () => parseReleaseNotesBlocks(update?.releaseNotes),
    [update?.releaseNotes],
  );
  const publishedDate = formatPublishedDate(update?.publishedAt);

  const handleDismissToCapsule = useCallback(() => {
    if (isInstalling) return;
    const fromRect = captureRectSnapshot(modalRef.current);
    prismuxUpdateNotifierStore.collapseToCapsule(fromRect, prefersReducedMotionNow());
  }, [isInstalling]);

  useEffect(() => {
    if (!isOpen) {
      setEntered(false);
      return;
    }
    const raf = window.requestAnimationFrame(() => setEntered(true));
    modalRef.current?.focus();
    return () => window.cancelAnimationFrame(raf);
  }, [isOpen]);

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

  const handleStartDownload = useCallback(async () => {
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
  }, [currentVersion, daemon, isInstalling, isTransferActive, portableMode, recommendedAsset, update]);

  const handleInstallDownloaded = useCallback(async () => {
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
  }, [status?.downloadedFilePath, status?.downloadedSha256]);

  if (!isOpen || (!update && !hasVerifiedPackage)) {
    return null;
  }

  const sourceLabel =
    update?.sourceUsed === "gitee" ? "Gitee Releases（国内源）" : "GitHub Releases（国际源）";

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
          "dialog-glass relative flex max-h-[min(82dvh,640px)] w-full max-w-[540px] flex-col overflow-hidden rounded-2xl border text-popover-foreground shadow-2xl/50 outline-none transition-[opacity,transform] duration-200 ease-out [-webkit-app-region:no-drag] motion-reduce:transition-none",
          entered ? "scale-100 opacity-100" : "scale-[0.975] opacity-0",
        )}
      >
        {/* Header */}
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/60 px-5 pt-4 pb-3.5">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/25"
              >
                <SparklesIcon className="size-4" />
              </span>
              <h2 id={titleId} className="text-base font-semibold tracking-tight text-foreground">
                发现新版本
              </h2>
              {latestVersion ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-foreground">
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
              className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground"
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

        {/* Scrollable Release Notes + Transfer Progress */}
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
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  安装包 {formatUpdateByteSize(recommendedAsset.sizeBytes)}
                </span>
              ) : null}
            </div>

            <div
              data-testid="prismux-update-release-notes"
              className="space-y-2.5 rounded-xl border border-border/65 bg-foreground/[0.03] px-4 py-3 text-xs leading-relaxed text-foreground/90 dark:bg-white/[0.035]"
            >
              {releaseBlocks.length > 0 ? (
                releaseBlocks.map((block, index) => {
                  if (block.type === "heading") {
                    return (
                      <h4
                        key={`h-${index}`}
                        className={cn(
                          "font-semibold text-foreground",
                          block.level === 1
                            ? "text-[13.5px]"
                            : block.level === 2
                              ? "text-[12.5px]"
                              : "text-xs",
                          index > 0 && "pt-1",
                        )}
                      >
                        {block.text}
                      </h4>
                    );
                  }
                  if (block.type === "list") {
                    return (
                      <ul key={`l-${index}`} className="list-disc space-y-1 pl-4 text-foreground/88">
                        {block.items.map((item, itemIdx) => (
                          <li key={`li-${itemIdx}`} className="leading-relaxed">
                            {renderInlineMarkdown(item)}
                          </li>
                        ))}
                      </ul>
                    );
                  }
                  return (
                    <p key={`p-${index}`} className="text-foreground/85">
                      {renderInlineMarkdown(block.text)}
                    </p>
                  );
                })
              ) : (
                <p className="text-muted-foreground">
                  此版本包含性能与液态玻璃体验优化及若干稳定性修复，支持在软件内直接下载并完成 SHA-256 强校验升级。
                </p>
              )}
            </div>
          </section>

          {/* Real-time download / split extraction / SHA-256 verification card */}
          {isTransferActive || hasVerifiedPackage ? (
            <section
              data-testid="prismux-update-modal-progress"
              className="space-y-2.5 rounded-xl border border-primary/30 bg-primary/[0.06] p-3.5 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  {hasVerifiedPackage && !isTransferActive ? (
                    <ShieldCheckIcon className="size-4 text-emerald-500" />
                  ) : (
                    <RefreshCwIcon className="size-4 animate-spin text-primary" />
                  )}
                  <span>
                    {isTransferActive
                      ? describeUpdaterProgressStage(progress)
                      : "SHA-256 整包校验通过，安装包已就绪"}
                  </span>
                </div>
                {progressPercent !== null ? (
                  <span className="font-mono font-semibold tabular-nums text-foreground">
                    {progressPercent}%
                  </span>
                ) : null}
              </div>

              {isTransferActive ? (
                <div className="space-y-1.5">
                  <div
                    role="progressbar"
                    aria-label="软件内更新下载进度"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progressPercent ?? 0}
                    className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10 dark:bg-white/12"
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-200"
                      style={{ width: `${progressPercent ?? 14}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums text-muted-foreground">
                    <span>
                      {progress?.stage === "downloading"
                        ? `已下载 ${formatUpdateByteSize(progress.bytesDownloaded)}${progress.totalBytes ? ` / ${formatUpdateByteSize(progress.totalBytes)}` : ""}${speedText ? ` · ${speedText}` : ""}`
                        : progress?.stage === "extracting"
                          ? "正在通过内置 7za.exe 无损合并分卷…"
                          : progress?.stage === "verifying"
                            ? "正在逐字节核验 SHA-256 摘要…"
                            : progress?.message ?? "正在处理更新包…"}
                    </span>
                    {progress?.totalParts && progress.totalParts > 1 ? (
                      <span className="inline-flex items-center gap-1 font-mono">
                        <LayersIcon className="size-3" />
                        分卷 {progress.currentPart ?? 1}/{progress.totalParts}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {hasVerifiedPackage && !isTransferActive ? (
                <div className="space-y-1.5 rounded-lg border border-border/60 bg-background/55 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                  <div className="truncate text-foreground" title={status?.downloadedFilePath ?? ""}>
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
              className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1 break-all">{state.errorMessage}</span>
            </div>
          ) : null}

          {state.statusMessage ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
            >
              <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">{state.statusMessage}</span>
            </div>
          ) : null}
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
                  <RefreshCwIcon className="size-3.5 animate-spin" />
                ) : (
                  <DownloadIcon className="size-3.5" />
                )}
                {isTransferActive
                  ? progress?.stage === "extracting"
                    ? "分卷重组中…"
                    : progress?.stage === "verifying"
                      ? "SHA-256 校验中…"
                      : progressPercent !== null
                        ? `下载中 ${progressPercent}%`
                        : "正在下载…"
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
