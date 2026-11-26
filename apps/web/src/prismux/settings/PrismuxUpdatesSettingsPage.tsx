import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  DownloadCloudIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  GlobeIcon,
  LayersIcon,
  RefreshCwIcon,
  RotateCwIcon,
  SaveIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { APP_VERSION } from "../../branding";
import { PrismuxAppIcon } from "../../components/PrismuxAppIcon";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { cn } from "../../lib/utils";
import {
  SETTINGS_CONTROL_LG,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../../components/settings/settingsLayout";
import {
  openSafeExternalHttpsUrl,
  validateSafeHttpsUrl,
} from "../../components/settings/prismuxProviderMeta";
import {
  type DaemonUpdateChannel,
  type DaemonUpdatePackageKind,
} from "../daemonClient";
import { usePrismuxRuntime } from "../PrismuxRuntimeProvider";
import {
  formatTransferSpeed,
  formatUpdateByteSize,
  isUpdateTransferActive,
  prismuxUpdateNotifierStore,
  startUpdaterStatusFallbackPoller,
  UPDATER_SSE_STALE_FALLBACK_MS,
  UPDATER_STATUS_POLL_INTERVAL_MS,
  useUpdateNotifierState,
} from "../updates/updateNotifierStore";
import { PrismuxReleaseNotesMarkdown } from "../updates/PrismuxReleaseNotesMarkdown";
import {
  buildUpdaterStageSteps,
  describeUpdaterProgressStage,
  extractReleaseNotesHighlights,
  formatProgressPercentDisplay,
  formatUpdaterStageWeightHint,
  parseCheckResult,
  parseProbeReport,
  parseUpdaterStatusPayload,
  resolveProgressBarPercent,
  resolveRuntimeVersion,
  selectRecommendedUpdateAsset,
  type ProbeReportView,
  type RoutePreference,
  type UpdateAssetView,
  type UpdateCheckView,
  type UpdaterStatusView,
  type UpdateSourceId,
} from "./prismuxUpdates.logic";

const GITHUB_FEED_URL = "https://github.com/Fish-under-sea/Prismux/releases/latest";
const GITEE_FEED_URL = "https://gitee.com/Fish-under-sea/Prismux/releases/latest";

const ROUTE_PREFERENCE_LABELS: Readonly<Record<RoutePreference, string>> = {
  auto: "智能测速（推荐）",
  domestic: "国内优先（Gitee）",
  global: "国际优先（GitHub）",
};

const CHANNEL_LABELS: Readonly<Record<DaemonUpdateChannel, string>> = {
  stable: "稳定正式版（Stable）",
  prerelease: "Preview（Alpha / Beta / RC）",
};

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return "未知大小";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function asPackageKind(raw: string): DaemonUpdatePackageKind | undefined {
  if (raw === "setup-exe" || raw === "portable-zip" || raw === "split-7z-exe") {
    return raw;
  }
  return undefined;
}

/**
 * MP-04 / Pillar 1: /settings/updates
 * Unified Dual-Source In-App Updater:
 * - Zero hardcoded fallback version (reads real Daemon / runtime APP_VERSION)
 * - Converged two-channel track: `stable` | `prerelease` (no `nightly`)
 * - In-app streaming download via POST /v1/updater/download + GET /v1/updater/events SSE
 *   (including Gitee 3-part `.7z.001..N` download -> extract -> SHA-256 verification)
 * - Verified one-click install & restart via desktopBridge.prismux.installDownloadedUpdate
 *   (or safe folder reveal + manual overwrite guide in portable mode)
 * - Safe `https:` browser download fallback preserved
 */
export function PrismuxUpdatesSettingsPage({
  embedded = false,
}: {
  readonly embedded?: boolean;
} = {}) {
  const { daemon, daemonInfo } = usePrismuxRuntime();
  const notifierState = useUpdateNotifierState();

  const [status, setStatus] = useState<UpdaterStatusView | null>(
    () => notifierState.updaterStatus,
  );
  const [probe, setProbe] = useState<ProbeReportView | null>(
    () => notifierState.updaterStatus?.lastProbe ?? null,
  );
  const [checkResult, setCheckResult] = useState<UpdateCheckView | null>(
    () => notifierState.updaterStatus?.lastCheck ?? notifierState.availableUpdate ?? null,
  );

  const [routePreference, setRoutePreference] = useState<RoutePreference>("auto");
  const [updateChannel, setUpdateChannel] = useState<DaemonUpdateChannel>("prerelease");
  const [customGhProxyPrefix, setCustomGhProxyPrefix] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [autoCheckEnabled, setAutoCheckEnabled] = useState<boolean>(
    () => notifierState.autoCheckEnabled,
  );
  const [savingAutoCheck, setSavingAutoCheck] = useState(false);

  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(
    () => notifierState.downloading || isUpdateTransferActive(notifierState.updaterStatus),
  );
  const [installing, setInstalling] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    setAutoCheckEnabled(notifierState.autoCheckEnabled);
  }, [notifierState.autoCheckEnabled]);

  // Keep settings page bidirectionally synced with global prismuxUpdateNotifierStore
  // (shared download progress, real-time speed, verified package & check results).
  useEffect(() => {
    const sharedStatus = notifierState.updaterStatus;
    if (sharedStatus) {
      setStatus(sharedStatus);
      setDownloading(notifierState.downloading || isUpdateTransferActive(sharedStatus));
      if (sharedStatus.lastCheck) setCheckResult(sharedStatus.lastCheck);
      if (sharedStatus.lastProbe) setProbe(sharedStatus.lastProbe);
      if (sharedStatus.progress?.stage === "error" && sharedStatus.lastError) {
        setErrorMsg(sharedStatus.lastError);
      }
    } else if (notifierState.availableUpdate) {
      setCheckResult((prev) => prev ?? notifierState.availableUpdate);
    }
  }, [notifierState.availableUpdate, notifierState.downloading, notifierState.updaterStatus]);

  const applyElectronFeedUrl = useCallback(
    async (pref: RoutePreference, recommendedSource?: UpdateSourceId) => {
      const bridge = window.desktopBridge?.prismux;
      if (!bridge?.setUpdateFeedUrl) return;
      const targetFeedUrl =
        pref === "domestic"
          ? GITEE_FEED_URL
          : pref === "global"
            ? GITHUB_FEED_URL
            : recommendedSource === "gitee"
              ? GITEE_FEED_URL
              : GITHUB_FEED_URL;
      await bridge.setUpdateFeedUrl(targetFeedUrl);
    },
    [],
  );

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await daemon.fetchUpdaterStatus();
      const parsed = parseUpdaterStatusPayload(res, APP_VERSION);
      if (parsed) {
        setStatus(parsed);
        setRoutePreference(parsed.policy.routePreference);
        setUpdateChannel(parsed.policy.channel);
        setCustomGhProxyPrefix(parsed.policy.customGhProxyPrefix);
        if (parsed.policy.customGhProxyPrefix.trim().length > 0) {
          setAdvancedOpen(true);
        }
        setDownloading(parsed.downloading);
        prismuxUpdateNotifierStore.hydrateFromDaemonStatus(parsed, { syncAutoCheck: true });
        setAutoCheckEnabled(prismuxUpdateNotifierStore.getState().autoCheckEnabled);
        if (parsed.lastProbe) setProbe(parsed.lastProbe);
        if (parsed.lastCheck) setCheckResult(parsed.lastCheck);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [daemon]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Subscribe to real-time SSE download / extract / SHA-256 verification / ready events
  // with infinite exponential-backoff reconnect while mounted (cleaned up on unmount).
  useEffect(() => {
    let cancelled = false;
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
          const snap = prismuxUpdateNotifierStore.getState();
          if (snap.downloading || isUpdateTransferActive(snap.updaterStatus)) {
            void daemon
              .fetchUpdaterStatus()
              .then((raw) => {
                if (cancelled) return;
                const parsed = parseUpdaterStatusPayload(raw, APP_VERSION);
                if (parsed) {
                  prismuxUpdateNotifierStore.hydrateFromDaemonStatus(parsed, {
                    syncAutoCheck: false,
                  });
                }
              })
              .catch(() => {
                // ignore reconnect sync error
              });
          }
        },
      },
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [daemon]);

  const handleProbeOnly = useCallback(async () => {
    setProbing(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await daemon.probeUpdaterSources<unknown>();
      const parsed = parseProbeReport(res);
      if (parsed) {
        setProbe(parsed);
        setStatusMsg(
          `线路测速完成：推荐使用 ${parsed.recommendedSource === "gitee" ? "Gitee（国内）" : "GitHub（国际）"} 源。`,
        );
        if (routePreference === "auto") {
          await applyElectronFeedUrl("auto", parsed.recommendedSource);
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setProbing(false);
    }
  }, [applyElectronFeedUrl, daemon, routePreference]);

  const handleProbeAndCheck = useCallback(async () => {
    setChecking(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const probeRes = await daemon.probeUpdaterSources<unknown>();
      const parsedProbe = parseProbeReport(probeRes);
      if (parsedProbe) {
        setProbe(parsedProbe);
        if (routePreference === "auto") {
          await applyElectronFeedUrl("auto", parsedProbe.recommendedSource);
        }
      }

      const checkRes = await daemon.checkForUpdates<unknown>({
        channel: updateChannel,
        includePrerelease: updateChannel === "prerelease",
      });
      const parsedCheck = parseCheckResult(checkRes, status?.currentVersion ?? APP_VERSION);
      if (parsedCheck) {
        setCheckResult(parsedCheck);
        prismuxUpdateNotifierStore.reportUpdateAvailable(parsedCheck);
        setStatusMsg(
          parsedCheck.hasUpdate && parsedCheck.latestVersion
            ? `发现新版本 v${parsedCheck.latestVersion}（来源：${parsedCheck.sourceUsed}）。`
            : `当前版本 ${parsedCheck.currentVersion ? `v${parsedCheck.currentVersion}` : "当前构建"} 已是最新（已核验 ${parsedCheck.sourceUsed}）。`,
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, [applyElectronFeedUrl, daemon, routePreference, status?.currentVersion, updateChannel]);

  const handleStartDownload = useCallback(
    async (asset?: UpdateAssetView | null) => {
      setDownloading(true);
      prismuxUpdateNotifierStore.setDownloading(true);
      prismuxUpdateNotifierStore.setMessages({ error: null, status: null });
      setErrorMsg(null);
      setStatusMsg(null);
      try {
        const target =
          asset ??
          checkResult?.recommendedAsset ??
          selectRecommendedUpdateAsset(checkResult?.assets ?? [], status?.portableMode ?? false);
        const kind = target ? asPackageKind(target.kind) : undefined;
        const result = await daemon.downloadUpdate({
          ...(kind ? { kind } : {}),
          ...(target?.name ? { assetName: target.name } : {}),
          ...(target?.source === "github" || target?.source === "gitee"
            ? { sourceOverride: target.source }
            : {}),
        });
        const prevStatus = prismuxUpdateNotifierStore.getState().updaterStatus ?? status;
        const nextReadyStatus: UpdaterStatusView = {
          currentVersion: resolveRuntimeVersion(prevStatus?.currentVersion, APP_VERSION),
          portableMode: prevStatus?.portableMode ?? false,
          policy: prevStatus?.policy ?? {
            routePreference,
            channel: updateChannel,
            includePrerelease: updateChannel === "prerelease",
            customGhProxyPrefix: customGhProxyPrefix.trim(),
            pluginRegistryOverride: prevStatus?.policy.pluginRegistryOverride ?? "auto",
            timeoutMs: 15_000,
            autoCheckEnabled,
          },
          checking: false,
          downloading: false,
          installState: "ready",
          downloadedFilePath: result.filePath,
          downloadedSha256: result.sha256,
          lastCheck: checkResult ?? prevStatus?.lastCheck ?? null,
          lastProbe: probe ?? prevStatus?.lastProbe ?? null,
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
          lastError: null,
        };
        setStatus(nextReadyStatus);
        prismuxUpdateNotifierStore.hydrateFromDaemonStatus(nextReadyStatus, {
          syncAutoCheck: false,
        });
        const readyMsg = `安装包已下载并通过 SHA-256 强校验（${result.sha256.slice(0, 16)}…），现在可以执行安装。`;
        setStatusMsg(readyMsg);
        prismuxUpdateNotifierStore.setMessages({ error: null, status: readyMsg });
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        setErrorMsg(errMessage);
        prismuxUpdateNotifierStore.setMessages({ error: errMessage });
      } finally {
        setDownloading(false);
        prismuxUpdateNotifierStore.setDownloading(false);
      }
    },
    [
      autoCheckEnabled,
      checkResult,
      customGhProxyPrefix,
      daemon,
      probe,
      routePreference,
      status,
      updateChannel,
    ],
  );

  const handleInstallDownloaded = useCallback(async () => {
    const latestStatus = prismuxUpdateNotifierStore.getState().updaterStatus ?? status;
    const filePath = latestStatus?.downloadedFilePath;
    const expectedSha256 = latestStatus?.downloadedSha256;
    if (!filePath || !expectedSha256) {
      setErrorMsg("尚未检测到已通过 SHA-256 校验的安装包，请先完成软件内下载。");
      return;
    }
    const bridge = window.desktopBridge?.prismux;
    if (!bridge?.installDownloadedUpdate) {
      setErrorMsg("当前运行环境不支持桌面端一键安装桥接，请使用下方浏览器下载链接手动安装。");
      return;
    }
    setInstalling(true);
    prismuxUpdateNotifierStore.setInstalling(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const result = await bridge.installDownloadedUpdate({
        filePath,
        expectedSha256,
      });
      if (result.mode === "portable-opened") {
        setStatusMsg(
          result.message ||
            "便携模式已打开已校验安装包所在目录：请关闭 Prismux 后覆盖程序文件并保留 data/ 目录。",
        );
      } else {
        setStatusMsg(result.message || "正在启动已校验安装包并优雅重启 Prismux…");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
      prismuxUpdateNotifierStore.setInstalling(false);
    }
  }, [status]);

  const handleToggleAutoCheck = useCallback(
    async (checked: boolean) => {
      setAutoCheckEnabled(checked);
      prismuxUpdateNotifierStore.setAutoCheckEnabled(checked, { markLocalDirty: true });
      setErrorMsg(null);
      setStatusMsg(
        checked
          ? "已开启自动检查更新，将在启动与后台定时检测新版本并温和提醒。"
          : "已关闭自动检查更新，你仍可随时在此页手动检查最新版本。",
      );
      setSavingAutoCheck(true);
      try {
        await daemon.updateUpdaterPolicy({ autoCheckEnabled: checked });
        prismuxUpdateNotifierStore.clearLocalAutoCheckDirty();
      } catch {
        // Offline or daemon restarting: localStorage preference is already persisted and will sync once daemon reconnects.
      } finally {
        setSavingAutoCheck(false);
      }
    },
    [daemon],
  );

  const handleSavePolicy = useCallback(async () => {
    setSavingPolicy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      prismuxUpdateNotifierStore.setAutoCheckEnabled(autoCheckEnabled, { markLocalDirty: true });
      await daemon.updateUpdaterPolicy({
        routePreference,
        channel: updateChannel,
        includePrerelease: updateChannel === "prerelease",
        customGhProxyPrefix: customGhProxyPrefix.trim(),
        autoCheckEnabled,
      });
      prismuxUpdateNotifierStore.clearLocalAutoCheckDirty();
      await applyElectronFeedUrl(routePreference, probe?.recommendedSource);
      setStatusMsg("更新通道与网络策略已保存。");
      await loadStatus();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingPolicy(false);
    }
  }, [
    applyElectronFeedUrl,
    autoCheckEnabled,
    customGhProxyPrefix,
    daemon,
    loadStatus,
    probe?.recommendedSource,
    routePreference,
    updateChannel,
  ]);

  const openExternal = useCallback((url: string) => {
    if (!openSafeExternalHttpsUrl(url)) {
      setErrorMsg("已拦截非 https 外部链接。");
    }
  }, []);

  const effectiveStatus = notifierState.updaterStatus ?? status;
  const runtimeVersion = resolveRuntimeVersion(effectiveStatus?.currentVersion, APP_VERSION);
  const progress = effectiveStatus?.progress ?? null;
  const isTransferActive =
    downloading ||
    notifierState.downloading ||
    isUpdateTransferActive(effectiveStatus);
  const hasVerifiedPackage = Boolean(
    effectiveStatus?.downloadedFilePath && effectiveStatus?.downloadedSha256,
  );
  const portableMode = effectiveStatus?.portableMode === true;
  const recommendedAsset =
    checkResult?.recommendedAsset ??
    selectRecommendedUpdateAsset(checkResult?.assets ?? [], portableMode);
  const safeReleaseHtmlUrl = validateSafeHttpsUrl(checkResult?.htmlUrl);
  const displayReleaseNotes = useMemo(
    () => extractReleaseNotesHighlights(checkResult?.releaseNotes),
    [checkResult?.releaseNotes],
  );
  const barPercent = resolveProgressBarPercent(progress, hasVerifiedPackage && !isTransferActive);
  const progressPercentText = formatProgressPercentDisplay(barPercent);
  const speedText = formatTransferSpeed(notifierState.speedBytesPerSec);
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

  // Fallback status poller while transfer is active (500ms interval when SSE is silent > 700ms).
  useEffect(() => {
    if (!isTransferActive) return;
    return startUpdaterStatusFallbackPoller({
      store: prismuxUpdateNotifierStore,
      fetchStatus: () => daemon.fetchUpdaterStatus(),
      parseStatus: (raw) => parseUpdaterStatusPayload(raw, APP_VERSION),
      intervalMs: UPDATER_STATUS_POLL_INTERVAL_MS,
      staleThresholdMs: UPDATER_SSE_STALE_FALLBACK_MS,
    });
  }, [daemon, isTransferActive]);

  const heroSubtitle = isTransferActive
    ? describeUpdaterProgressStage(progress)
    : hasVerifiedPackage
      ? "新版本安装包已校验就绪，可立即升级。"
      : checkResult?.hasUpdate && checkResult.latestVersion
        ? `发现新版本 v${checkResult.latestVersion}（来源：${checkResult.sourceUsed === "gitee" ? "Gitee" : "GitHub"}）。`
        : checkResult
          ? "当前已是最新版本。"
          : "支持软件内自动校验下载与一键重启升级。";

  const content = (
    <>
      {/* Unified Version & Update Hero Card (replaces duplicate AboutVersionSection; <= 2 badges) */}
      <SettingsSection
        id="prismux-updates"
        title="版本与更新"
        headerAction={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="info" size="sm">
              {updateChannel === "stable" ? "稳定正式版" : "Preview / RC"}
            </Badge>
            <Badge
              variant={portableMode ? "outline" : daemonInfo.ready ? "success" : "warning"}
              size="sm"
            >
              {portableMode ? "便携模式" : daemonInfo.ready ? "服务在线" : "服务未连接"}
            </Badge>
          </div>
        }
      >
        <div
          id="app-version"
          data-pmx-updates-hero=""
          className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5"
        >
          <div className="flex min-w-0 items-center gap-3.5">
            <PrismuxAppIcon className="size-10 shrink-0 rounded-xl object-contain shadow-sm ring-1 ring-border/40 [[data-pmx-glass='1']_&]:ring-foreground/15" />
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-base font-semibold tracking-tight text-foreground">
                  Prismux
                </span>
                <span className="font-mono text-xs font-medium tabular-nums text-muted-foreground">
                  {runtimeVersion ? `v${runtimeVersion}` : "版本探测中"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{heroSubtitle}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={probing || checking || loading || isTransferActive}
              onClick={() => {
                void handleProbeOnly();
              }}
            >
              <ActivityIcon className={probing ? "size-3.5 animate-spin" : "size-3.5"} />
              {probing ? "测速中…" : "线路测速"}
            </Button>
            {hasVerifiedPackage && !isTransferActive ? (
              <Button
                type="button"
                size="sm"
                disabled={installing}
                data-action={portableMode ? "open-portable-update-dir" : "install-and-restart"}
                onClick={() => {
                  void handleInstallDownloaded();
                }}
              >
                {portableMode ? (
                  <FolderOpenIcon className="size-3.5" />
                ) : (
                  <RotateCwIcon className={installing ? "size-3.5 animate-spin" : "size-3.5"} />
                )}
                {installing
                  ? "正在执行…"
                  : portableMode
                    ? "打开安装包目录"
                    : "一键安装并重启"}
              </Button>
            ) : checkResult?.hasUpdate && recommendedAsset ? (
              <Button
                type="button"
                size="sm"
                disabled={isTransferActive}
                data-action="download-update-in-app"
                onClick={() => {
                  void handleStartDownload(recommendedAsset);
                }}
              >
                <DownloadIcon className="size-3.5" />
                {isTransferActive ? "下载中…" : "下载更新"}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={checking || probing || loading || isTransferActive}
                onClick={() => {
                  void handleProbeAndCheck();
                }}
              >
                <DownloadCloudIcon className="size-3.5" />
                {checking ? "检查中…" : "检查更新"}
              </Button>
            )}
          </div>
        </div>

        <SettingsRow
          id="auto-check-updates"
          title="自动检查更新"
          description="启动与后台定时检测新版本，并在发现更新时温和提醒。"
          control={
            <div className="flex items-center gap-2.5">
              <span className="text-xs text-muted-foreground">
                {autoCheckEnabled ? "已开启" : "已关闭"}
              </span>
              <Switch
                aria-label="自动检查更新"
                data-testid="prismux-auto-check-updates-switch"
                checked={autoCheckEnabled}
                disabled={savingAutoCheck}
                onCheckedChange={(checked) => {
                  void handleToggleAutoCheck(Boolean(checked));
                }}
              />
            </div>
          }
        />

        {errorMsg ? (
          <div
            role="alert"
            className="mx-4 my-2 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive sm:mx-5"
          >
            <AlertTriangleIcon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 break-all">{errorMsg}</span>
          </div>
        ) : null}

        {statusMsg ? (
          <div
            role="status"
            aria-live="polite"
            className="mx-4 my-2 flex items-center gap-2 rounded-lg border border-success/35 bg-success/10 px-3 py-2 text-xs text-success-foreground sm:mx-5"
          >
            <CheckCircle2Icon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{statusMsg}</span>
          </div>
        ) : null}

        {/* In-App Download Progress & Verified Install Ready Card */}
        {isTransferActive || hasVerifiedPackage ? (
          <div
            data-updater-transfer-card
            className="mx-4 my-3 space-y-3 rounded-xl border border-primary/30 bg-primary/[0.06] p-3.5 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] sm:mx-5 dark:bg-primary/[0.09] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                {hasVerifiedPackage && !isTransferActive ? (
                  <ShieldCheckIcon className="size-4 shrink-0 text-emerald-500" />
                ) : (
                  <RefreshCwIcon className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
                )}
                <span className="truncate">
                  {isTransferActive
                    ? describeUpdaterProgressStage(progress)
                    : "安装包完整性校验通过，已就绪"}
                </span>
              </div>
              <span
                data-testid="prismux-updates-settings-percent"
                className={cn(
                  "shrink-0 font-mono tabular-nums",
                  progressPercentText !== null
                    ? "text-[13px] font-semibold text-foreground"
                    : "text-[11px] font-medium text-muted-foreground",
                )}
              >
                {progressPercentText ?? "连接中…"}
              </span>
            </div>

            {/* 4-Stage Visual Progression Indicator */}
            <div
              data-testid="prismux-updates-settings-stages"
              className="grid grid-cols-2 gap-1.5 sm:grid-cols-4"
            >
              {stageSteps.map((step) => (
                <div
                  key={step.id}
                  data-stage-step={step.id}
                  data-stage-state={step.state}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10.5px] transition-colors motion-reduce:transition-none",
                    step.state === "completed"
                      ? "bg-emerald-500/[0.11] text-emerald-800 dark:text-emerald-200"
                      : step.state === "active"
                        ? "bg-primary/[0.16] font-semibold text-foreground"
                        : "bg-foreground/[0.03] text-muted-foreground dark:bg-white/[0.04]",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      step.state === "completed"
                        ? "bg-emerald-500"
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
                  aria-label="Prismux 更新下载与校验进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  {...(barPercent !== null ? { "aria-valuenow": Math.round(barPercent) } : {})}
                  data-progress-mode={barPercent !== null ? "determinate" : "indeterminate"}
                  data-testid="prismux-updates-settings-progressbar"
                  className="relative h-2 w-full overflow-hidden rounded-full bg-foreground/12 dark:bg-white/14"
                >
                  {barPercent !== null ? (
                    <div
                      data-testid="prismux-updates-settings-progressbar-fill"
                      className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
                      style={{ width: `${barPercent}%` }}
                    />
                  ) : (
                    <div
                      data-testid="prismux-updates-settings-progressbar-indeterminate"
                      className="h-full w-full rounded-full bg-gradient-to-r from-primary/15 via-primary/85 to-primary/15 animate-pulse motion-reduce:animate-none"
                    />
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
                  <span>
                    {progress?.stage === "downloading"
                      ? barPercent === null && progress.bytesDownloaded <= 0
                        ? "正在连接下载源…"
                        : progress.bytesDownloaded > 0 || progress.totalBytes
                          ? `已下载 ${formatUpdateByteSize(progress.bytesDownloaded)}${progress.totalBytes ? ` / ${formatUpdateByteSize(progress.totalBytes)}` : ""}`
                          : "已连接下载源，准备接收数据…"
                      : progress?.stage === "extracting"
                        ? `正在合并安装包分卷…${progress.totalBytes ? `（${formatUpdateByteSize(progress.totalBytes)}）` : ""}`
                        : progress?.stage === "verifying"
                          ? `正在校验安装包完整性…${progress.totalBytes ? `（${formatUpdateByteSize(progress.totalBytes)}）` : ""}`
                          : progress?.message ?? "正在连接下载源…"}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {speedText && progress?.stage === "downloading" ? (
                      <span
                        data-testid="prismux-updates-settings-speed"
                        className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-foreground tabular-nums dark:bg-white/[0.08]"
                      >
                        {speedText}
                      </span>
                    ) : null}
                    {progress?.totalParts && progress.totalParts > 1 ? (
                      <span
                        data-testid="prismux-updates-settings-part"
                        className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-foreground tabular-nums dark:bg-white/[0.08]"
                      >
                        <LayersIcon className="size-3" />
                        分卷 {progress.currentPart ?? 1}/{progress.totalParts}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="text-[10.5px] text-muted-foreground/85 tabular-nums">
                  {stageWeightHint}
                </div>
              </div>
            ) : null}

            {hasVerifiedPackage && !isTransferActive ? (
              <div className="space-y-2.5">
                <div className="rounded-lg bg-foreground/[0.04] px-3 py-2 font-mono text-[11px] text-muted-foreground dark:bg-white/[0.05]">
                  <div
                    className="truncate text-foreground"
                    title={effectiveStatus?.downloadedFilePath ?? ""}
                  >
                    文件：{effectiveStatus?.downloadedFilePath}
                  </div>
                </div>

                {portableMode ? (
                  <div className="space-y-1.5 rounded-lg bg-warning/10 px-3 py-2 text-xs text-foreground">
                    <div className="font-medium">便携模式升级指引</div>
                    <ol className="list-decimal space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                      <li>打开已校验安装包所在目录；</li>
                      <li>关闭 Prismux 后覆盖主程序文件并保留原 data 文件夹。</li>
                    </ol>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    size="sm"
                    disabled={installing}
                    data-action={portableMode ? "open-portable-update-dir" : "install-and-restart"}
                    onClick={() => {
                      void handleInstallDownloaded();
                    }}
                  >
                    {portableMode ? (
                      <FolderOpenIcon className="size-3.5" />
                    ) : (
                      <RotateCwIcon className={installing ? "size-3.5 animate-spin" : "size-3.5"} />
                    )}
                    {installing
                      ? "正在执行…"
                      : portableMode
                        ? "打开已校验安装包所在目录"
                        : "一键安装并重启"}
                  </Button>
                  {safeReleaseHtmlUrl ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => openExternal(safeReleaseHtmlUrl)}
                    >
                      去浏览器打开下载
                      <ExternalLinkIcon className="size-3" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Compact Probe Latency Strip */}
        {probe ? (
          <div className="space-y-2 border-t border-border/50 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">线路测速结果</span>
              <span>
                推荐：
                <strong className="text-foreground">
                  {probe.recommendedSource === "gitee" ? "Gitee（国内）" : "GitHub（国际）"}
                </strong>
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {probe.sources.map((src) => (
                <div
                  key={src.source}
                  className="flex items-center justify-between gap-2 rounded-lg bg-foreground/[0.03] px-3 py-2 text-xs dark:bg-white/[0.04]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <GlobeIcon className="size-3.5 text-muted-foreground" />
                      <span>{src.source === "gitee" ? "Gitee" : "GitHub"}</span>
                      {probe.recommendedSource === src.source ? (
                        <Badge variant="info" size="sm">
                          推荐
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <Badge
                    variant={src.reachable ? "success" : "destructive"}
                    size="sm"
                    className="shrink-0 tabular-nums"
                  >
                    {src.reachable
                      ? src.latencyMs !== null
                        ? `${Math.round(src.latencyMs)} ms`
                        : "可达"
                      : "不可达"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Latest Check Result & Release Notes */}
        {checkResult ? (
          <div className="space-y-2.5 border-t border-border/50 px-4 py-3.5 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldCheckIcon className="size-4 text-primary" />
                <span className="text-sm font-medium text-foreground">
                  {checkResult.hasUpdate && checkResult.latestVersion
                    ? `新版本 v${checkResult.latestVersion}`
                    : `已是最新版本${checkResult.currentVersion ? `（v${checkResult.currentVersion}）` : ""}`}
                </span>
                {checkResult.usedFallbackSource ? (
                  <Badge variant="warning" size="sm">
                    已切换备用源
                  </Badge>
                ) : null}
              </div>
              {safeReleaseHtmlUrl ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => openExternal(safeReleaseHtmlUrl)}
                >
                  发行说明页
                  <ExternalLinkIcon className="size-3" />
                </Button>
              ) : null}
            </div>

            {displayReleaseNotes ? (
              <div
                data-testid="prismux-updates-settings-release-notes"
                className="max-h-[min(56dvh,480px)] overflow-y-auto overscroll-contain rounded-lg bg-foreground/[0.03] px-4 py-3.5 dark:bg-white/[0.035]"
              >
                <PrismuxReleaseNotesMarkdown markdown={displayReleaseNotes} />
              </div>
            ) : null}

            {checkResult.assets.length > 0 ? (
              <div className="divide-y divide-border/50 rounded-lg bg-foreground/[0.025] dark:bg-white/[0.03]">
                {checkResult.assets.map((asset) => (
                  <div
                    key={asset.name}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-mono text-foreground">{asset.name}</span>
                        {asset.kind === "split-7z-exe" ? (
                          <Badge variant="secondary" size="sm">
                            分卷自动合并
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">
                        {formatSize(asset.sizeBytes)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        size="xs"
                        variant="secondary"
                        disabled={isTransferActive}
                        onClick={() => {
                          void handleStartDownload(asset);
                        }}
                      >
                        <DownloadIcon className="size-3" />
                        下载
                      </Button>
                      {asset.effectiveUrl ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => openExternal(asset.effectiveUrl!)}
                        >
                          浏览器
                          <ExternalLinkIcon className="size-3" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </SettingsSection>

      {/* Update Channel & Network Policy (app updates ONLY; plugin npm registry lives solely in /settings/plugins) */}
      <SettingsSection id="prismux-updates-policy" title="更新通道与网络">
        <SettingsRow
          id="update-track"
          title="软件更新通道"
          description="选择接收正式稳定版，或包含 Alpha / Beta / RC 抢先特性的 Preview 通道。"
          control={
            <div className={`${SETTINGS_CONTROL_LG} max-w-full`}>
              <Select
                value={updateChannel}
                onValueChange={(val) => {
                  if (val === "stable" || val === "prerelease") {
                    setUpdateChannel(val);
                  }
                }}
              >
                <SelectTrigger size="sm" aria-label="软件更新通道">
                  <SelectValue>{CHANNEL_LABELS[updateChannel]}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="stable">{CHANNEL_LABELS.stable}</SelectItem>
                  <SelectItem value="prerelease">{CHANNEL_LABELS.prerelease}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />

        <SettingsRow
          title="更新下载线路"
          description="根据网络环境选择软件更新下载源，国内推荐使用智能测速。"
          control={
            <div className={`${SETTINGS_CONTROL_LG} max-w-full`}>
              <Select
                value={routePreference}
                onValueChange={(val) => {
                  if (val === "auto" || val === "domestic" || val === "global") {
                    setRoutePreference(val);
                  }
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue>{ROUTE_PREFERENCE_LABELS[routePreference]}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="auto">{ROUTE_PREFERENCE_LABELS.auto}</SelectItem>
                  <SelectItem value="domestic">{ROUTE_PREFERENCE_LABELS.domestic}</SelectItem>
                  <SelectItem value="global">{ROUTE_PREFERENCE_LABELS.global}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />

        {/* Advanced proxy prefix folded by default */}
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <div className="px-4 py-2.5 sm:px-5">
            <CollapsibleTrigger
              data-testid="prismux-updates-advanced-toggle"
              className="group flex w-full cursor-pointer items-center justify-between text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <span>高级网络设置</span>
              <ChevronDownIcon className="size-3.5 transition-transform duration-150 group-data-panel-open:rotate-180 motion-reduce:transition-none" />
            </CollapsibleTrigger>
          </div>
          <CollapsiblePanel>
            <SettingsRow
              title="自定义 GitHub 加速前缀"
              description="仅在使用 GitHub 线路且需要中转加速时填写，留空则直连。"
              control={
                <Input
                  nativeInput
                  size="sm"
                  data-testid="prismux-updates-gh-proxy-input"
                  className={`${SETTINGS_CONTROL_LG} max-w-full font-mono`}
                  placeholder="留空默认直连"
                  value={customGhProxyPrefix}
                  onChange={(event) => setCustomGhProxyPrefix(event.target.value)}
                />
              }
            />
          </CollapsiblePanel>
        </Collapsible>

        <div className="flex items-center justify-between gap-2 px-4 py-3 sm:px-5">
          <Button
            size="xs"
            variant="ghost"
            disabled={loading}
            onClick={() => {
              void loadStatus();
            }}
          >
            <RefreshCwIcon className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            重新读取
          </Button>
          <Button
            size="sm"
            disabled={savingPolicy}
            onClick={() => {
              void handleSavePolicy();
            }}
          >
            <SaveIcon className="size-3.5" />
            {savingPolicy ? "保存中…" : "保存更新策略"}
          </Button>
        </div>
      </SettingsSection>
    </>
  );

  if (embedded) {
    return content;
  }

  return <SettingsPageContainer width="readable">{content}</SettingsPageContainer>;
}
