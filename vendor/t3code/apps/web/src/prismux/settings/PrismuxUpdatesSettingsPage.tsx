import { useCallback, useEffect, useState } from "react";
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
  applyUpdaterSseEvent,
  describeUpdaterProgressStage,
  parseCheckResult,
  parseProbeReport,
  parseUpdaterStatusPayload,
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
  prerelease: "公测版（Prerelease · Alpha / Beta）",
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

  const [status, setStatus] = useState<UpdaterStatusView | null>(null);
  const [probe, setProbe] = useState<ProbeReportView | null>(null);
  const [checkResult, setCheckResult] = useState<UpdateCheckView | null>(null);

  const [routePreference, setRoutePreference] = useState<RoutePreference>("auto");
  const [registryOverride, setRegistryOverride] = useState<PluginRegistryOverride>("auto");
  const [updateChannel, setUpdateChannel] = useState<DaemonUpdateChannel>("prerelease");
  const [customGhProxyPrefix, setCustomGhProxyPrefix] = useState("");

  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

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

  // Subscribe to real-time SSE download / extract / SHA-256 verification / ready events.
  useEffect(() => {
    const unsubscribe = daemon.subscribeUpdaterEvents(
      (event) => {
        setStatus((prev) => {
          const next = applyUpdaterSseEvent(prev, event, APP_VERSION);
          if (next) {
            setDownloading(next.downloading);
            if (next.lastCheck) setCheckResult(next.lastCheck);
            if (next.lastProbe) setProbe(next.lastProbe);
            if (next.progress?.stage === "error" && next.lastError) {
              setErrorMsg(next.lastError);
            }
          }
          return next;
        });
      },
      { maxReconnectAttempts: 5 },
    );
    return unsubscribe;
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
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                downloading: false,
                installState: "ready",
                downloadedFilePath: result.filePath,
                downloadedSha256: result.sha256,
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
              }
            : prev,
        );
        setStatusMsg(
          `安装包已下载并通过 SHA-256 强校验（${result.sha256.slice(0, 16)}…），现在可以执行安装。`,
        );
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setDownloading(false);
      }
    },
    [checkResult?.assets, checkResult?.recommendedAsset, daemon, status?.portableMode],
  );

  const handleInstallDownloaded = useCallback(async () => {
    const filePath = status?.downloadedFilePath;
    const expectedSha256 = status?.downloadedSha256;
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
    }
  }, [status?.downloadedFilePath, status?.downloadedSha256]);

  const handleSavePolicy = useCallback(async () => {
    setSavingPolicy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await daemon.updateUpdaterPolicy({
        routePreference,
        channel: updateChannel,
        includePrerelease: updateChannel === "prerelease",
        customGhProxyPrefix: customGhProxyPrefix.trim(),
        pluginRegistryOverride: registryOverride,
      });
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

  const runtimeVersion = resolveRuntimeVersion(status?.currentVersion, APP_VERSION);
  const progress = status?.progress ?? null;
  const isTransferActive =
    downloading ||
    progress?.stage === "downloading" ||
    progress?.stage === "extracting" ||
    progress?.stage === "verifying";
  const hasVerifiedPackage = Boolean(status?.downloadedFilePath && status?.downloadedSha256);
  const portableMode = status?.portableMode === true;
  const recommendedAsset =
    checkResult?.recommendedAsset ??
    selectRecommendedUpdateAsset(checkResult?.assets ?? [], portableMode);
  const safeReleaseHtmlUrl = validateSafeHttpsUrl(checkResult?.htmlUrl);
  const progressPercent =
    progress?.percent !== null && progress?.percent !== undefined
      ? Math.max(0, Math.min(100, Math.round(progress.percent)))
      : progress?.stage === "ready"
        ? 100
        : null;

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
              {updateChannel === "stable" ? "稳定正式版" : "公测版"}
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
          title="测速并检查最新版本"
          description="并行探测 GitHub 与 Gitee Releases 延迟，按所选通道（稳定正式版 / 公测版）拉取最新发行版与校验摘要。"
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
            className="mx-4 my-3 space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3.5 text-xs"
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
                    : "安装包 SHA-256 校验通过，已就绪"}
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
                  aria-label="Prismux 更新下载与校验进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPercent ?? 0}
                  className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full bg-primary transition-[width] duration-200"
                    style={{ width: `${progressPercent ?? 15}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
                  <span>
                    {progress?.stage === "downloading"
                      ? `已下载 ${formatSize(progress.bytesDownloaded)}${progress.totalBytes ? ` / ${formatSize(progress.totalBytes)}` : ""}`
                      : progress?.stage === "extracting"
                        ? "正在通过内置 7za.exe 无损合并分卷…"
                        : progress?.stage === "verifying"
                          ? "正在逐字节比对 SHA-256 摘要…"
                          : progress?.message ?? "处理中…"}
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
              <div className="space-y-2.5">
                <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                  <div className="truncate text-foreground" title={status?.downloadedFilePath ?? ""}>
                    文件：{status?.downloadedFilePath}
                  </div>
                  <div className="mt-0.5 truncate">
                    SHA-256：{status?.downloadedSha256}
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
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/60 px-3 py-2.5 text-xs"
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

            {checkResult.releaseNotes ? (
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/70 bg-background/50 p-3 font-sans text-xs leading-relaxed text-muted-foreground">
                {checkResult.releaseNotes}
              </pre>
            ) : null}

            {checkResult.assets.length > 0 ? (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-muted-foreground">
                  可用安装包资产（下载后强制整包校验 SHA-256）
                </div>
                {checkResult.assets.map((asset) => (
                  <div
                    key={asset.name}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs"
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
          收敛为「稳定正式版」与「公测版」双通道；调整更新主线路与社区插件 npm 镜像源后将立即持久化至 Daemon。
        </p>

        <SettingsRow
          id="update-track"
          title="软件更新通道"
          description="选择接收稳定正式版（Stable）或包含 Alpha / Beta 早期特性的公测版（Prerelease）。"
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
