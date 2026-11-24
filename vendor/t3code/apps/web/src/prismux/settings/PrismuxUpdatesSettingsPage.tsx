import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
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
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
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
  type PluginRegistryOverride,
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
  auto: "智能测速自动选优（推荐）",
  domestic: "国内优先（Gitee Releases + npmmirror）",
  global: "国际优先（GitHub Releases + npmjs）",
};

const REGISTRY_LABELS: Readonly<Record<PluginRegistryOverride, string>> = {
  auto: "跟随线路测速自动选择",
  npmmirror: "强制使用 npmmirror（国内镜像）",
  npmjs: "强制使用 registry.npmjs.org（国际官方）",
};

const CHANNEL_LABELS: Readonly<Record<DaemonUpdateChannel, string>> = {
  stable: "稳定正式版（Stable）",
  prerelease: "Preview（Alpha / Beta）",
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
  const [registryOverride, setRegistryOverride] = useState<PluginRegistryOverride>("auto");
  const [updateChannel, setUpdateChannel] = useState<DaemonUpdateChannel>("prerelease");
  const [customGhProxyPrefix, setCustomGhProxyPrefix] = useState("");
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
        setRegistryOverride(parsed.policy.pluginRegistryOverride);
        setUpdateChannel(parsed.policy.channel);
        setCustomGhProxyPrefix(parsed.policy.customGhProxyPrefix);
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
            pluginRegistryOverride: registryOverride,
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
      registryOverride,
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
        pluginRegistryOverride: registryOverride,
        autoCheckEnabled,
      });
      prismuxUpdateNotifierStore.clearLocalAutoCheckDirty();
      await applyElectronFeedUrl(routePreference, probe?.recommendedSource);
      setStatusMsg("双源更新策略已保存，并已同步更新通道配置。");
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
    registryOverride,
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

  const content = (
    <>
      {/* Version & Quick Check Header */}
      <SettingsSection
        id="prismux-updates"
        title="Prismux 双源内更新中心"
        headerAction={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="info" className="font-mono tabular-nums">
              {runtimeVersion ? `v${runtimeVersion}` : "版本探测中"}
            </Badge>
            <Badge variant="outline">
              {updateChannel === "stable" ? "稳定正式版" : "Preview"}
            </Badge>
            <Badge variant="outline">
              {portableMode ? "便携模式 (Portable)" : "标准安装版"}
            </Badge>
            <Badge variant={daemonInfo.ready ? "success" : "warning"}>
              {daemonInfo.ready ? "Daemon 在线" : "Daemon 未连接"}
            </Badge>
          </div>
        }
      >
        <p className="px-4 py-2.5 text-xs text-muted-foreground">
          支持 GitHub Releases 与 Gitee Releases（含 3 分卷无损重组）软件内直连下载、整包 SHA-256 强制校验与一键重启升级，同时协同国内 npmmirror / 国际 npmjs 插件源。
        </p>
        <SettingsRow
          id="auto-check-updates"
          title="自动检查更新"
          description="开启后将在启动与后台定时检测 GitHub / Gitee 双源新版本，发现更新时在右下角温和提醒"
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
        <SettingsRow
          title="测速并检查最新版本"
          description="并行探测 GitHub 与 Gitee Releases 延迟，按所选通道（稳定正式版 / Preview）拉取最新发行版与校验摘要。"
          control={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={probing || checking || loading || isTransferActive}
                onClick={() => {
                  void handleProbeOnly();
                }}
              >
                <ActivityIcon className={probing ? "size-3.5 animate-spin" : "size-3.5"} />
                {probing ? "测速中…" : "仅测速线路"}
              </Button>
              <Button
                size="sm"
                disabled={checking || probing || loading || isTransferActive}
                onClick={() => {
                  void handleProbeAndCheck();
                }}
              >
                <DownloadCloudIcon className="size-3.5" />
                {checking ? "检查更新中…" : "测速并检查更新"}
              </Button>
            </div>
          }
        />

        {errorMsg ? (
          <div
            role="alert"
            className="mx-4 my-2 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <AlertTriangleIcon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 break-all">{errorMsg}</span>
          </div>
        ) : null}

        {statusMsg ? (
          <div
            role="status"
            aria-live="polite"
            className="mx-4 my-2 flex items-center gap-2 rounded-lg border border-success/35 bg-success/10 px-3 py-2 text-xs text-success-foreground"
          >
            <CheckCircle2Icon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{statusMsg}</span>
          </div>
        ) : null}

        {/* In-App Download Progress & Verified Install Ready Card */}
        {isTransferActive || hasVerifiedPackage ? (
          <div
            data-updater-transfer-card
            className="mx-4 my-3 space-y-3 rounded-xl border border-primary/30 bg-primary/[0.06] p-3.5 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] dark:bg-primary/[0.09] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
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
                    : "安装包 SHA-256 校验通过，已就绪"}
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
                    "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10.5px] transition-colors motion-reduce:transition-none",
                    step.state === "completed"
                      ? "border-emerald-500/35 bg-emerald-500/[0.09] text-emerald-800 dark:text-emerald-200"
                      : step.state === "active"
                        ? "border-primary/45 bg-primary/[0.14] font-semibold text-foreground"
                        : "border-border/50 bg-foreground/[0.025] text-muted-foreground dark:bg-white/[0.03]",
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
                        ? `正在通过内置 7za.exe 无损合并分卷…${progress.totalBytes ? `（${formatUpdateByteSize(progress.totalBytes)}）` : ""}`
                        : progress?.stage === "verifying"
                          ? `正在逐字节比对 SHA-256 摘要…${progress.totalBytes ? `（${formatUpdateByteSize(progress.totalBytes)}）` : ""}`
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
                <div className="rounded-lg border border-border/60 bg-foreground/[0.035] px-3 py-2 font-mono text-[11px] text-muted-foreground dark:bg-white/[0.045]">
                  <div
                    className="truncate text-foreground"
                    title={effectiveStatus?.downloadedFilePath ?? ""}
                  >
                    文件：{effectiveStatus?.downloadedFilePath}
                  </div>
                  <div className="mt-0.5 truncate">
                    SHA-256：{effectiveStatus?.downloadedSha256}
                  </div>
                </div>

                {portableMode ? (
                  <div className="space-y-2 rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-xs text-foreground">
                    <div className="font-medium">便携模式覆盖升级指引</div>
                    <ol className="list-decimal space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                      <li>点击下方按钮打开已校验安装包所在目录；</li>
                      <li>完全关闭正在运行的 Prismux，解压或覆盖主程序文件；</li>
                      <li>保留原目录中的 <code className="font-mono text-foreground">data/</code> 文件夹，所有记忆与配置零丢失。</li>
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

        {/* Probe Latency Cards */}
        {probe ? (
          <div className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">实时双源延迟探测结果</span>
              <span>
                推荐路线：
                <strong className="text-foreground">
                  {probe.recommendedSource === "gitee" ? "Gitee（国内）" : "GitHub（国际）"}
                </strong>
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {probe.sources.map((src) => (
                <div
                  key={src.source}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-foreground/[0.035] px-3 py-2.5 text-xs dark:bg-white/[0.045]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <GlobeIcon className="size-3.5 text-muted-foreground" />
                      <span>{src.source === "gitee" ? "Gitee Releases" : "GitHub Releases"}</span>
                      {probe.recommendedSource === src.source ? (
                        <Badge variant="info">推荐</Badge>
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {src.error ?? src.url}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge
                      variant={src.reachable ? "success" : "destructive"}
                      className="tabular-nums"
                    >
                      {src.reachable
                        ? src.latencyMs !== null
                          ? `${Math.round(src.latencyMs)} ms`
                          : "可达"
                        : "不可达"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Latest Check Result */}
        {checkResult ? (
          <div className="space-y-2.5 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldCheckIcon className="size-4 text-primary" />
                <span className="text-sm font-medium text-foreground">
                  {checkResult.hasUpdate && checkResult.latestVersion
                    ? `发现新版本：v${checkResult.latestVersion}`
                    : `已是最新版本${checkResult.currentVersion ? `（v${checkResult.currentVersion}）` : ""}`}
                </span>
                <Badge variant="outline">来源：{checkResult.sourceUsed}</Badge>
                {checkResult.usedFallbackSource ? (
                  <Badge variant="warning">已自动切换备用源</Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {checkResult.hasUpdate && recommendedAsset && !hasVerifiedPackage ? (
                  <Button
                    size="xs"
                    disabled={isTransferActive}
                    data-action="download-update-in-app"
                    onClick={() => {
                      void handleStartDownload(recommendedAsset);
                    }}
                  >
                    <DownloadIcon className="size-3" />
                    {isTransferActive ? "下载中…" : "软件内下载更新"}
                  </Button>
                ) : null}
                {safeReleaseHtmlUrl ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => openExternal(safeReleaseHtmlUrl)}
                  >
                    去浏览器打开下载
                    <ExternalLinkIcon className="size-3" />
                  </Button>
                ) : null}
              </div>
            </div>

            {displayReleaseNotes ? (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                  更新公告
                  {checkResult.releaseName &&
                  checkResult.releaseName.trim() !== checkResult.tagName &&
                  checkResult.releaseName.trim() !==
                    (checkResult.latestVersion ? `v${checkResult.latestVersion}` : "")
                    ? ` · ${checkResult.releaseName.trim()}`
                    : ""}
                </div>
                <div
                  data-testid="prismux-updates-settings-release-notes"
                  className="max-h-[min(56dvh,480px)] overflow-y-auto overscroll-contain rounded-xl border border-border/70 bg-foreground/[0.03] px-4 py-3.5 dark:bg-white/[0.035]"
                >
                  <PrismuxReleaseNotesMarkdown markdown={displayReleaseNotes} />
                </div>
              </div>
            ) : null}

            {checkResult.assets.length > 0 ? (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-muted-foreground">
                  可用安装包资产（下载后强制整包校验 SHA-256）
                </div>
                {checkResult.assets.map((asset) => (
                  <div
                    key={asset.name}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-foreground/[0.03] px-3 py-2 text-xs dark:bg-white/[0.035]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-mono text-foreground">{asset.name}</span>
                        {asset.kind === "split-7z-exe" ? (
                          <Badge variant="secondary" size="sm">
                            Gitee {asset.parts.length || 3} 分卷自动重组
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">
                        {formatSize(asset.sizeBytes)}
                        {asset.sha256 ? ` · SHA-256: ${asset.sha256.slice(0, 16)}…` : ""}
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
                        软件内下载
                      </Button>
                      {asset.effectiveUrl ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => openExternal(asset.effectiveUrl!)}
                        >
                          浏览器下载
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

      {/* Routing & Registry Policy */}
      <SettingsSection id="prismux-updates-policy" title="更新通道、双源路由与插件镜像策略">
        <p className="px-4 py-2.5 text-xs text-muted-foreground">
          收敛为「稳定正式版」与「Preview」双通道；调整更新主线路与社区插件 npm 镜像源后将立即持久化至 Daemon。
        </p>

        <SettingsRow
          id="update-track"
          title="软件更新通道"
          description="选择接收稳定正式版（Stable）或包含 Alpha / Beta 早期特性的 Preview 通道。"
          control={
            <div className="w-full sm:w-72">
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
          title="软件更新路线偏好"
          description="国内网络环境推荐「自动切换」或「国内优先（Gitee Releases + npmmirror）」。"
          control={
            <div className="w-full sm:w-72">
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

        <SettingsRow
          title="社区插件 npm Registry 源"
          description="控制插件中心流式拉取社区插件 Tarball 时使用的 Registry 地址。"
          control={
            <div className="w-full sm:w-72">
              <Select
                value={registryOverride}
                onValueChange={(val) => {
                  if (val === "auto" || val === "npmmirror" || val === "npmjs") {
                    setRegistryOverride(val);
                  }
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue>{REGISTRY_LABELS[registryOverride]}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="auto">{REGISTRY_LABELS.auto}</SelectItem>
                  <SelectItem value="npmmirror">{REGISTRY_LABELS.npmmirror}</SelectItem>
                  <SelectItem value="npmjs">{REGISTRY_LABELS.npmjs}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />

        <SettingsRow
          title="自定义 GitHub 加速前缀（可选）"
          description="仅当选择 GitHub 线路且需要中转加速时填写（例如 https://gh-proxy.com/），留空则直连。"
          control={
            <Input
              nativeInput
              size="sm"
              className="w-full font-mono sm:w-72"
              placeholder="留空默认直连"
              value={customGhProxyPrefix}
              onChange={(event) => setCustomGhProxyPrefix(event.target.value)}
            />
          }
        />

        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <Button
            size="xs"
            variant="ghost"
            disabled={loading}
            onClick={() => {
              void loadStatus();
            }}
          >
            <RefreshCwIcon className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            重新读取策略
          </Button>
          <Button
            size="sm"
            disabled={savingPolicy}
            onClick={() => {
              void handleSavePolicy();
            }}
          >
            <SaveIcon className="size-3.5" />
            {savingPolicy ? "保存中…" : "保存双源更新策略"}
          </Button>
        </div>
      </SettingsSection>
    </>
  );

  if (embedded) {
    return content;
  }

  return <SettingsPageContainer width="wide">{content}</SettingsPageContainer>;
}
