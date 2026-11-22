import { useCallback, useEffect, useState } from "react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  DownloadCloudIcon,
  ExternalLinkIcon,
  GlobeIcon,
  RefreshCwIcon,
  SaveIcon,
  ShieldCheckIcon,
} from "lucide-react";

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
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../../components/settings/settingsLayout";
import { usePrismuxRuntime } from "../PrismuxRuntimeProvider";

type RoutePreference = "auto" | "domestic" | "global";
type PluginRegistryOverride = "auto" | "npmmirror" | "npmjs";
type UpdateSourceId = "github" | "gitee";

interface SourceProbeView {
  readonly source: UpdateSourceId;
  readonly url: string;
  readonly reachable: boolean;
  readonly statusCode: number | null;
  readonly latencyMs: number | null;
  readonly error?: string;
}

interface ProbeReportView {
  readonly probedAt: number;
  readonly recommendedSource: UpdateSourceId;
  readonly recommendedRoute: "domestic" | "global";
  readonly sources: readonly SourceProbeView[];
}

interface UpdateAssetView {
  readonly name: string;
  readonly kind: string;
  readonly effectiveUrl: string;
  readonly sizeBytes: number | null;
  readonly sha256: string | null;
  readonly source: UpdateSourceId;
}

interface UpdateCheckView {
  readonly checkedAt: number;
  readonly currentVersion: string;
  readonly hasUpdate: boolean;
  readonly latestVersion: string | null;
  readonly tagName: string | null;
  readonly releaseName: string | null;
  readonly releaseNotes: string | null;
  readonly publishedAt: string | null;
  readonly htmlUrl: string | null;
  readonly sourceUsed: UpdateSourceId;
  readonly usedFallbackSource: boolean;
  readonly assets: readonly UpdateAssetView[];
}

interface UpdaterPolicyView {
  readonly routePreference: RoutePreference;
  readonly includePrerelease: boolean;
  readonly customGhProxyPrefix: string;
  readonly pluginRegistryOverride: PluginRegistryOverride;
  readonly timeoutMs: number;
}

interface UpdaterStatusView {
  readonly currentVersion: string;
  readonly portableMode: boolean;
  readonly policy: UpdaterPolicyView;
  readonly checking: boolean;
  readonly downloading: boolean;
  readonly lastCheck: UpdateCheckView | null;
  readonly lastProbe: ProbeReportView | null;
  readonly lastError: string | null;
}

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRoutePreference(value: unknown): RoutePreference {
  return value === "domestic" || value === "global" || value === "auto" ? value : "auto";
}

function asRegistryOverride(value: unknown): PluginRegistryOverride {
  return value === "npmmirror" || value === "npmjs" || value === "auto" ? value : "auto";
}

function asSourceId(value: unknown): UpdateSourceId {
  return value === "gitee" ? "gitee" : "github";
}

function parseProbeReport(raw: unknown): ProbeReportView | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const rawSources = Array.isArray(rec.sources) ? rec.sources : [];
  const sources: SourceProbeView[] = [];
  for (const item of rawSources) {
    const s = asRecord(item);
    if (!s) continue;
    sources.push({
      source: asSourceId(s.source),
      url: asString(s.url),
      reachable: asBoolean(s.reachable, false),
      statusCode: asNullableNumber(s.statusCode),
      latencyMs: asNullableNumber(s.latencyMs),
      ...(typeof s.error === "string" ? { error: s.error } : {}),
    });
  }
  return {
    probedAt: typeof rec.probedAt === "number" ? rec.probedAt : Date.now(),
    recommendedSource: asSourceId(rec.recommendedSource),
    recommendedRoute: rec.recommendedRoute === "domestic" ? "domestic" : "global",
    sources,
  };
}

function parseCheckResult(raw: unknown): UpdateCheckView | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const rawAssets = Array.isArray(rec.assets) ? rec.assets : [];
  const assets: UpdateAssetView[] = [];
  for (const item of rawAssets) {
    const a = asRecord(item);
    if (!a) continue;
    assets.push({
      name: asString(a.name),
      kind: asString(a.kind),
      effectiveUrl: asString(a.effectiveUrl || a.downloadUrl),
      sizeBytes: asNullableNumber(a.sizeBytes),
      sha256: typeof a.sha256 === "string" ? a.sha256 : null,
      source: asSourceId(a.source),
    });
  }
  return {
    checkedAt: typeof rec.checkedAt === "number" ? rec.checkedAt : Date.now(),
    currentVersion: asString(rec.currentVersion, "0.1.0-alpha.1"),
    hasUpdate: asBoolean(rec.hasUpdate, false),
    latestVersion: typeof rec.latestVersion === "string" ? rec.latestVersion : null,
    tagName: typeof rec.tagName === "string" ? rec.tagName : null,
    releaseName: typeof rec.releaseName === "string" ? rec.releaseName : null,
    releaseNotes: typeof rec.releaseNotes === "string" ? rec.releaseNotes : null,
    publishedAt: typeof rec.publishedAt === "string" ? rec.publishedAt : null,
    htmlUrl: typeof rec.htmlUrl === "string" ? rec.htmlUrl : null,
    sourceUsed: asSourceId(rec.sourceUsed),
    usedFallbackSource: asBoolean(rec.usedFallbackSource, false),
    assets,
  };
}

function parseStatus(raw: unknown): UpdaterStatusView | null {
  const root = asRecord(raw);
  if (!root) return null;
  const policyRec = asRecord(root.policy);
  return {
    currentVersion: asString(root.currentVersion, "0.1.0-alpha.1"),
    portableMode: asBoolean(root.portableMode, false),
    policy: {
      routePreference: asRoutePreference(policyRec?.routePreference),
      includePrerelease: asBoolean(policyRec?.includePrerelease, true),
      customGhProxyPrefix: asString(policyRec?.customGhProxyPrefix),
      pluginRegistryOverride: asRegistryOverride(policyRec?.pluginRegistryOverride),
      timeoutMs: typeof policyRec?.timeoutMs === "number" ? policyRec.timeoutMs : 15000,
    },
    checking: asBoolean(root.checking, false),
    downloading: asBoolean(root.downloading, false),
    lastCheck: parseCheckResult(root.lastCheck),
    lastProbe: parseProbeReport(root.lastProbe),
    lastError: typeof root.lastError === "string" ? root.lastError : null,
  };
}

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return "未知大小";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * MP-04: /settings/updates
 * Real-data Dual-Source Updater & Network Routing Console:
 * - Connects to /v1/updater/status, /v1/updater/probe, /v1/updater/check, /v1/updater/policy
 * - Synchronizes Electron auto-updater feed URL via desktopBridge.prismux.setUpdateFeedUrl
 * - Displays GitHub vs Gitee probe latency, latest release metadata & SHA-256 verification info
 */
export function PrismuxUpdatesSettingsPage() {
  const { daemon, daemonInfo } = usePrismuxRuntime();

  const [status, setStatus] = useState<UpdaterStatusView | null>(null);
  const [probe, setProbe] = useState<ProbeReportView | null>(null);
  const [checkResult, setCheckResult] = useState<UpdateCheckView | null>(null);

  const [routePreference, setRoutePreference] = useState<RoutePreference>("auto");
  const [registryOverride, setRegistryOverride] = useState<PluginRegistryOverride>("auto");
  const [includePrerelease, setIncludePrerelease] = useState(true);
  const [customGhProxyPrefix, setCustomGhProxyPrefix] = useState("");

  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [checking, setChecking] = useState(false);
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
      const res = await daemon.requestJson<unknown>("/v1/updater/status");
      const parsed = parseStatus(res);
      if (parsed) {
        setStatus(parsed);
        setRoutePreference(parsed.policy.routePreference);
        setRegistryOverride(parsed.policy.pluginRegistryOverride);
        setIncludePrerelease(parsed.policy.includePrerelease);
        setCustomGhProxyPrefix(parsed.policy.customGhProxyPrefix);
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

  const handleProbeOnly = useCallback(async () => {
    setProbing(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await daemon.requestJson<unknown>("/v1/updater/probe", {
        method: "POST",
      });
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
      const probeRes = await daemon.requestJson<unknown>("/v1/updater/probe", {
        method: "POST",
      });
      const parsedProbe = parseProbeReport(probeRes);
      if (parsedProbe) {
        setProbe(parsedProbe);
        if (routePreference === "auto") {
          await applyElectronFeedUrl("auto", parsedProbe.recommendedSource);
        }
      }

      const checkRes = await daemon.requestJson<unknown>("/v1/updater/check", {
        method: "POST",
        body: JSON.stringify({
          channel: includePrerelease ? "prerelease" : "stable",
        }),
      });
      const parsedCheck = parseCheckResult(checkRes);
      if (parsedCheck) {
        setCheckResult(parsedCheck);
        setStatusMsg(
          parsedCheck.hasUpdate && parsedCheck.latestVersion
            ? `发现新版本 v${parsedCheck.latestVersion}（来源：${parsedCheck.sourceUsed}）。`
            : `当前版本 v${parsedCheck.currentVersion} 已是最新（已核验 ${parsedCheck.sourceUsed}）。`,
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, [applyElectronFeedUrl, daemon, includePrerelease, routePreference]);

  const handleSavePolicy = useCallback(async () => {
    setSavingPolicy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await daemon.requestJson<unknown>("/v1/updater/policy", {
        method: "POST",
        body: JSON.stringify({
          routePreference,
          includePrerelease,
          customGhProxyPrefix: customGhProxyPrefix.trim(),
          pluginRegistryOverride: registryOverride,
        }),
      });
      await applyElectronFeedUrl(routePreference, probe?.recommendedSource);
      setStatusMsg("双源更新策略已保存，并已同步 Electron 更新源地址。");
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
    includePrerelease,
    loadStatus,
    probe?.recommendedSource,
    registryOverride,
    routePreference,
  ]);

  const openExternal = useCallback((url: string) => {
    if (window.desktopBridge?.openExternal) {
      void window.desktopBridge.openExternal(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  return (
    <SettingsPageContainer width="wide">
      {/* Version & Quick Check Header */}
      <SettingsSection
        id="prismux-updates"
        title="Prismux 双源更新中心"
        headerAction={
          <div className="flex items-center gap-1.5">
            <Badge variant="info" className="font-mono">
              v{status?.currentVersion ?? "0.1.0-alpha.1"}
            </Badge>
            <Badge variant="outline">
              {status?.portableMode ? "便携模式 (Portable)" : "标准安装版"}
            </Badge>
            <Badge variant={daemonInfo.ready ? "success" : "warning"}>
              {daemonInfo.ready ? "Daemon 在线" : "Daemon 未连接"}
            </Badge>
          </div>
        }
      >
        <p className="px-4 py-2.5 text-xs text-muted-foreground">
          支持 GitHub Releases 与 Gitee Releases 自动测速容灾、SHA-256 强制完整性校验，以及国内 npmmirror / 国际 npmjs 插件源协同路由。
        </p>
        <SettingsRow
          title="测速并检查最新版本"
          description="并行探测 GitHub 与 Gitee Releases API 延迟，选择最优线路拉取最新发行版元信息与 SHA-256 校验值。"
          control={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={probing || checking || loading}
                onClick={() => {
                  void handleProbeOnly();
                }}
              >
                <ActivityIcon className={probing ? "size-3.5 animate-spin" : "size-3.5"} />
                {probing ? "测速中…" : "仅测速线路"}
              </Button>
              <Button
                size="sm"
                disabled={checking || probing || loading}
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
                    <Badge variant={src.reachable ? "success" : "destructive"}>
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
                    : `已是最新版本（v${checkResult.currentVersion}）`}
                </span>
                <Badge variant="outline">来源：{checkResult.sourceUsed}</Badge>
                {checkResult.usedFallbackSource ? (
                  <Badge variant="warning">已自动切换备用源</Badge>
                ) : null}
              </div>
              {checkResult.htmlUrl ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => openExternal(checkResult.htmlUrl!)}
                >
                  查看发行说明
                  <ExternalLinkIcon className="size-3" />
                </Button>
              ) : null}
            </div>

            {checkResult.releaseNotes ? (
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/70 bg-background/50 p-3 font-sans text-xs leading-relaxed text-muted-foreground">
                {checkResult.releaseNotes}
              </pre>
            ) : null}

            {checkResult.assets.length > 0 ? (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-muted-foreground">
                  可用安装包资产（下载前强制校验 SHA-256）
                </div>
                {checkResult.assets.map((asset) => (
                  <div
                    key={asset.name}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-foreground">{asset.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatSize(asset.sizeBytes)}
                        {asset.sha256 ? ` · SHA-256: ${asset.sha256.slice(0, 16)}…` : ""}
                      </div>
                    </div>
                    {asset.effectiveUrl ? (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => openExternal(asset.effectiveUrl)}
                      >
                        下载资产
                        <ExternalLinkIcon className="size-3" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </SettingsSection>

      {/* Routing & Registry Policy */}
      <SettingsSection id="prismux-updates-policy" title="双源路由与插件镜像策略">
        <p className="px-4 py-2.5 text-xs text-muted-foreground">
          调整更新下载主线路与社区插件 npm 镜像源；保存后立即持久化到 Daemon 并同步桌面端更新 Feed。
        </p>
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
          title="接收 Alpha / Beta 预发布版本"
          description="开启后将检查包含预发布标签（如 v0.1.0-alpha.x）的早期构建。"
          control={
            <Switch
              aria-label="接收预发布版本"
              checked={includePrerelease}
              onCheckedChange={(checked) => setIncludePrerelease(Boolean(checked))}
            />
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
    </SettingsPageContainer>
  );
}
