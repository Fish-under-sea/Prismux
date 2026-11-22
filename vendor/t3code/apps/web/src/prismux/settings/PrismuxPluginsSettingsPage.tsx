import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  LockIcon,
  PackageIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  Trash2Icon,
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

interface OfficialCatalogPlugin {
  readonly id: string;
  readonly packageName: string;
  readonly version: string;
  readonly description: string;
  readonly enginesPrismux: string;
  readonly realms: readonly string[];
  readonly permissions: readonly string[];
  readonly modelVisible: boolean;
  readonly sha256: string;
  readonly bytes: number;
  readonly status: string;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly mounted: boolean;
  readonly installedVersion?: string;
  readonly distribution?: string;
}

interface InstalledPluginItem {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly realms: readonly string[];
  readonly permissions: readonly string[];
  readonly modelVisible: boolean;
  readonly distribution: string;
  readonly enabled: boolean;
  readonly mounted: boolean;
  readonly source: string;
  readonly installedAt: number | null;
}

interface PendingAuditRequest {
  readonly source: "official" | "npm";
  readonly targetLabel: string;
  readonly pluginId?: string;
  readonly packageNameOrTarball?: string;
  readonly networkPreference?: "auto" | "domestic" | "global";
  readonly reason: string;
  readonly permissions: readonly string[];
  readonly modelVisible: boolean;
}

const OFFICIAL_TITLE_MAP: Readonly<Record<string, string>> = {
  qq: "QQ 主秘书与群聊隔离插件",
  pet: "桌宠租约联动插件",
  "fishdock-hook": "FISH-Dock 灵动岛审批回执插件",
  ssh: "SSH 主机池 · Web PTY · SFTP 插件",
};

const NETWORK_PREFERENCE_LABELS: Readonly<Record<"auto" | "domestic" | "global", string>> = {
  auto: "智能测速（自动切换）",
  domestic: "国内优先（npmmirror 镜像）",
  global: "国际优先（npmjs 官方源）",
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

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function parseCatalogPlugins(payload: unknown): OfficialCatalogPlugin[] {
  const root = asRecord(payload);
  const list = Array.isArray(root?.plugins) ? root.plugins : [];
  const result: OfficialCatalogPlugin[] = [];
  for (const item of list) {
    const rec = asRecord(item);
    if (!rec) continue;
    const id = asString(rec.id);
    if (!id) continue;
    const enginesRec = asRecord(rec.engines);
    result.push({
      id,
      packageName: asString(rec.packageName, `@prismux/plugin-${id}`),
      version: asString(rec.version, "0.0.0"),
      description: asString(rec.description),
      enginesPrismux: asString(enginesRec?.prismux, "*"),
      realms: asStringArray(rec.realms),
      permissions: asStringArray(rec.permissions),
      modelVisible: asBoolean(rec.modelVisible, false),
      sha256: asString(rec.sha256),
      bytes: asNumber(rec.bytes, 0),
      status: asString(rec.status, "pending"),
      installed: asBoolean(rec.installed, false),
      enabled: asBoolean(rec.enabled, false),
      mounted: asBoolean(rec.mounted, false),
      ...(typeof rec.installedVersion === "string"
        ? { installedVersion: rec.installedVersion }
        : {}),
      ...(typeof rec.distribution === "string" ? { distribution: rec.distribution } : {}),
    });
  }
  return result;
}

function parseInstalledPlugins(payload: unknown): InstalledPluginItem[] {
  const root = asRecord(payload);
  const list = Array.isArray(root?.plugins) ? root.plugins : [];
  const result: InstalledPluginItem[] = [];
  for (const item of list) {
    const rec = asRecord(item);
    if (!rec) continue;
    const manifest = asRecord(rec.manifest);
    const id = asString(manifest?.id) || asString(rec.id);
    if (!id) continue;
    result.push({
      id,
      version: asString(manifest?.version) || asString(rec.version, "0.0.0"),
      description: asString(manifest?.description) || asString(rec.description),
      realms: asStringArray(manifest?.realms ?? rec.realms),
      permissions: asStringArray(manifest?.permissions ?? rec.permissions),
      modelVisible: asBoolean(manifest?.modelVisible ?? rec.modelVisible, false),
      distribution: asString(rec.distribution, "managed"),
      enabled: asBoolean(rec.enabled, true),
      mounted: asBoolean(rec.mounted, false),
      source: asString(rec.source, "official"),
      installedAt: typeof rec.installedAt === "number" ? rec.installedAt : null,
    });
  }
  return result;
}

function isAuditRequiredError(err: unknown): {
  required: boolean;
  message: string;
  permissions: string[];
} {
  const message = err instanceof Error ? err.message : String(err);
  const rec = asRecord(err);
  const code = asString(rec?.code);
  const status = asNumber(rec?.status, 0);
  const details = asRecord(rec?.details);
  const nestedError = asRecord(details?.error);
  const auditPayload = asRecord(nestedError?.details) ?? details;
  const permissions = asStringArray(auditPayload?.permissions);
  const reasons = asStringArray(auditPayload?.reasons);
  const required =
    code === "AUDIT_CONFIRMATION_REQUIRED" ||
    status === 409 ||
    message.includes("AUDIT_CONFIRMATION_REQUIRED") ||
    message.includes("409");
  const combinedReason = reasons.length > 0 ? `${message}（${reasons.join("；")}）` : message;
  return { required, message: combinedReason, permissions };
}

/**
 * MP-04: /settings/plugins
 * Real-data Cordis dual-track plugin center:
 * - Prominent zero-preinstall declaration for the 4 official plugins
 * - Live /v1/plugins/catalog & /v1/plugins/installed management
 * - Community npm streaming tarball import (no git, scripts disabled)
 * - Prominent security audit confirmation gate for modelVisible / prompt-modifying plugins
 */
export function PrismuxPluginsSettingsPage() {
  const { daemon, daemonInfo } = usePrismuxRuntime();

  const [catalog, setCatalog] = useState<OfficialCatalogPlugin[]>([]);
  const [installed, setInstalled] = useState<InstalledPluginItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [npmInput, setNpmInput] = useState("");
  const [networkPreference, setNetworkPreference] = useState<"auto" | "domestic" | "global">("auto");
  const [pendingAudit, setPendingAudit] = useState<PendingAuditRequest | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [catalogRes, installedRes] = await Promise.all([
        daemon.requestJson<unknown>("/v1/plugins/catalog"),
        daemon.requestJson<unknown>("/v1/plugins/installed"),
      ]);
      setCatalog(parseCatalogPlugins(catalogRes));
      setInstalled(parseInstalledPlugins(installedRes));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [daemon]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const executeOfficialInstall = useCallback(
    async (plugin: OfficialCatalogPlugin, confirmedAudit: boolean) => {
      if (plugin.modelVisible && !confirmedAudit) {
        setPendingAudit({
          source: "official",
          targetLabel: `${OFFICIAL_TITLE_MAP[plugin.id] ?? plugin.id} (${plugin.packageName})`,
          pluginId: plugin.id,
          reason: "该插件声明 modelVisible=true，可能向 AI 模型暴露工具或上下文，请在安装前逐项核对声明权限。",
          permissions: plugin.permissions,
          modelVisible: true,
        });
        return;
      }

      setBusyKey(`install:${plugin.id}`);
      setErrorMsg(null);
      setStatusMsg(null);
      try {
        await daemon.requestJson<unknown>("/v1/plugins/install", {
          method: "POST",
          body: JSON.stringify({
            source: "official",
            pluginId: plugin.id,
            confirmedAudit,
          }),
        });
        setPendingAudit(null);
        setStatusMsg(`已成功验签并安装官方插件 ${plugin.packageName}（distribution: "managed"）。`);
        await loadAll();
      } catch (err) {
        const audit = isAuditRequiredError(err);
        if (audit.required && !confirmedAudit) {
          setPendingAudit({
            source: "official",
            targetLabel: `${OFFICIAL_TITLE_MAP[plugin.id] ?? plugin.id} (${plugin.packageName})`,
            pluginId: plugin.id,
            reason: audit.message || "插件声明敏感权限或模型可见能力，需要手动二次确认。",
            permissions: audit.permissions.length > 0 ? audit.permissions : plugin.permissions,
            modelVisible: true,
          });
        } else {
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setBusyKey(null);
      }
    },
    [daemon, loadAll],
  );

  const executeNpmInstall = useCallback(
    async (pkgOrTarball: string, pref: "auto" | "domestic" | "global", confirmedAudit: boolean) => {
      const trimmed = pkgOrTarball.trim();
      if (!trimmed) {
        setErrorMsg("请输入社区插件的 npm 包名（例如 prismux-plugin-xxx）或 .tgz 地址。");
        return;
      }
      setBusyKey("install:npm");
      setErrorMsg(null);
      setStatusMsg(null);
      try {
        await daemon.requestJson<unknown>("/v1/plugins/install", {
          method: "POST",
          body: JSON.stringify({
            source: "npm",
            packageNameOrTarball: trimmed,
            networkPreference: pref,
            confirmedAudit,
          }),
        });
        setPendingAudit(null);
        setNpmInput("");
        setStatusMsg(`社区插件 ${trimmed} 已通过免 Git 流式安装（所有安装脚本已禁用）。`);
        await loadAll();
      } catch (err) {
        const audit = isAuditRequiredError(err);
        if (audit.required && !confirmedAudit) {
          setPendingAudit({
            source: "npm",
            targetLabel: trimmed,
            packageNameOrTarball: trimmed,
            networkPreference: pref,
            reason:
              audit.message ||
              "该社区插件声明了 modelVisible: true 或系统提示词注入能力，请确认来源可信后再放行安装。",
            permissions: audit.permissions,
            modelVisible: true,
          });
        } else {
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setBusyKey(null);
      }
    },
    [daemon, loadAll],
  );

  const handleTogglePlugin = useCallback(
    async (pluginId: string, enabled: boolean) => {
      setBusyKey(`toggle:${pluginId}`);
      setErrorMsg(null);
      setStatusMsg(null);
      try {
        await daemon.requestJson<unknown>("/v1/plugins/toggle", {
          method: "POST",
          body: JSON.stringify({ pluginId, enabled }),
        });
        setStatusMsg(`插件 ${pluginId} 已${enabled ? "启用" : "停用"}。`);
        await loadAll();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyKey(null);
      }
    },
    [daemon, loadAll],
  );

  const handleUninstallPlugin = useCallback(
    async (pluginId: string) => {
      setBusyKey(`uninstall:${pluginId}`);
      setErrorMsg(null);
      setStatusMsg(null);
      try {
        await daemon.requestJson<unknown>("/v1/plugins/uninstall", {
          method: "POST",
          body: JSON.stringify({ pluginId }),
        });
        setStatusMsg(`插件 ${pluginId} 已卸载并释放全部 ctx.effect() 监听（零残留）。`);
        await loadAll();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyKey(null);
      }
    },
    [daemon, loadAll],
  );

  const handleConfirmPendingAudit = useCallback(async () => {
    if (!pendingAudit) return;
    if (pendingAudit.source === "official" && pendingAudit.pluginId) {
      const target = catalog.find((item) => item.id === pendingAudit.pluginId);
      if (target) {
        await executeOfficialInstall(target, true);
      }
      return;
    }
    if (pendingAudit.source === "npm" && pendingAudit.packageNameOrTarball) {
      await executeNpmInstall(
        pendingAudit.packageNameOrTarball,
        pendingAudit.networkPreference ?? networkPreference,
        true,
      );
    }
  }, [catalog, executeNpmInstall, executeOfficialInstall, networkPreference, pendingAudit]);

  return (
    <SettingsPageContainer width="wide">
      {/* Mandatory zero-preinstall engineering declaration */}
      <div id="prismux-plugins" className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheckIcon className="size-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                四大官方插件默认零预装声明
              </h3>
              <Badge variant="info">纯净内核 · 按需安装</Badge>
              <Badge variant={daemonInfo.ready ? "success" : "warning"}>
                {daemonInfo.ready ? "Daemon 在线" : "Daemon 未连接"}
              </Badge>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              官方独立插件{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-2xs text-foreground">qq</code>、
              <code className="rounded bg-muted px-1 py-0.5 text-2xs text-foreground">pet</code>、
              <code className="rounded bg-muted px-1 py-0.5 text-2xs text-foreground">
                fishdock-hook
              </code>
              、
              <code className="rounded bg-muted px-1 py-0.5 text-2xs text-foreground">ssh</code>{" "}
              默认均不预装、不随主程序捆绑启动。所有插件均采用 Cordis 双域可逆内核（卸载零残留）、顶层{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-2xs text-foreground">
                engines.prismux
              </code>{" "}
              SemVer 校验、SHA-256 完整性验签与{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-2xs text-foreground">0600</code>{" "}
              独立加密凭据隔离。
            </p>
          </div>
          <Button
            size="xs"
            variant="outline"
            disabled={loading}
            onClick={() => {
              void loadAll();
            }}
          >
            <RefreshCwIcon className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            刷新目录
          </Button>
        </div>
      </div>

      {/* Prominent Security Permission Audit Confirmation Card */}
      {pendingAudit ? (
        <div
          role="alertdialog"
          aria-labelledby="prismux-plugin-audit-title"
          className="rounded-xl border-2 border-warning/70 bg-warning/10 p-4 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <ShieldAlertIcon className="mt-0.5 size-5 shrink-0 text-warning-foreground" />
            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <h4 id="prismux-plugin-audit-title" className="text-sm font-semibold text-foreground">
                  安全权限审计二次确认
                </h4>
                <Badge variant="warning">高敏感 · modelVisible / Prompt 审计</Badge>
              </div>
              <p className="text-xs leading-relaxed text-foreground">
                即将安装：<strong>{pendingAudit.targetLabel}</strong>
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">{pendingAudit.reason}</p>
              {pendingAudit.permissions.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">申请权限：</span>
                  {pendingAudit.permissions.map((perm) => (
                    <Badge key={perm} variant="outline" size="sm">
                      {perm}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="warning-outline"
                  disabled={busyKey !== null}
                  onClick={() => {
                    void handleConfirmPendingAudit();
                  }}
                >
                  我已审查权限风险，确认安装
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyKey !== null}
                  onClick={() => setPendingAudit(null)}
                >
                  取消安装
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {errorMsg ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive"
        >
          <AlertTriangleIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 break-all">{errorMsg}</span>
        </div>
      ) : null}

      {statusMsg ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg border border-success/35 bg-success/10 px-3.5 py-2.5 text-xs text-success-foreground"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{statusMsg}</span>
        </div>
      ) : null}

      {/* Section 1: Official Certified Plugin Catalog */}
      <SettingsSection
        id="prismux-plugins-official"
        title="官方认证插件目录"
        headerAction={
          <Badge variant="outline" className="tabular-nums">
            {catalog.length} 个官方插件
          </Badge>
        }
      >
        <p className="px-4 py-2.5 text-xs text-muted-foreground">
          实时读取 plugins-official/catalog/official.json，严格校验 SHA-256 与顶层 engines.prismux 版本范围。
        </p>
        {loading && catalog.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            正在从 Daemon 读取官方插件目录…
          </div>
        ) : catalog.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            暂无可用的官方目录条目（请确认 Prismux Daemon 正在运行）。
          </div>
        ) : (
          catalog.map((plugin) => {
            const isBusy =
              busyKey === `install:${plugin.id}` ||
              busyKey === `toggle:${plugin.id}` ||
              busyKey === `uninstall:${plugin.id}`;
            return (
              <div key={plugin.id} className="space-y-2.5 px-4 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <PackageIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        {OFFICIAL_TITLE_MAP[plugin.id] ?? plugin.id}
                      </span>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {plugin.packageName}@{plugin.version}
                      </code>
                      <Badge variant={plugin.status === "verified" ? "success" : "secondary"}>
                        {plugin.status === "verified" ? "SHA-256 已验签" : plugin.status}
                      </Badge>
                      <Badge variant={plugin.modelVisible ? "warning" : "outline"}>
                        {plugin.modelVisible ? "模型可见 · 需审计" : "0 Token 宿主纯净"}
                      </Badge>
                      {plugin.installed ? (
                        <Badge variant={plugin.mounted ? "info" : "secondary"}>
                          {plugin.mounted ? "已挂载运行" : plugin.enabled ? "已安装" : "已停用"}
                        </Badge>
                      ) : (
                        <Badge variant="outline">未预装</Badge>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {plugin.description}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {plugin.installed ? (
                      <>
                        <Switch
                          aria-label={`启用或停用 ${plugin.packageName}`}
                          checked={plugin.enabled}
                          disabled={isBusy}
                          onCheckedChange={(checked) => {
                            void handleTogglePlugin(plugin.id, Boolean(checked));
                          }}
                        />
                        <Button
                          size="xs"
                          variant="destructive-outline"
                          disabled={isBusy}
                          onClick={() => {
                            void handleUninstallPlugin(plugin.id);
                          }}
                        >
                          <Trash2Icon className="size-3.5" />
                          卸载
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="xs"
                        variant="default"
                        disabled={isBusy}
                        onClick={() => {
                          void executeOfficialInstall(plugin, false);
                        }}
                      >
                        <DownloadIcon className="size-3.5" />
                        {busyKey === `install:${plugin.id}` ? "安装中…" : "按需安装"}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
                  <span>运行域：{plugin.realms.join(" / ") || "daemon"}</span>
                  <span>体积：{formatBytes(plugin.bytes)}</span>
                  <span className="font-mono">engines.prismux: {plugin.enginesPrismux}</span>
                  {plugin.sha256 ? (
                    <span className="font-mono" title={plugin.sha256}>
                      SHA-256: {plugin.sha256.slice(0, 12)}…
                    </span>
                  ) : null}
                  {plugin.permissions.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <span>权限：</span>
                      {plugin.permissions.map((perm) => (
                        <Badge key={perm} variant="outline" className="font-mono text-[10px]">
                          {perm}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </SettingsSection>

      {/* Section 2: Community npm Streaming Tarball Import */}
      <SettingsSection id="prismux-plugins-community" title="社区 npm 插件流式导入">
        <p className="px-4 py-2.5 text-xs text-muted-foreground">
          直接通过 HTTPS 从 npm Registry 拉取 .tgz 并校验解包：完全不调用本机 git，强制禁用 preinstall / install / postinstall 生命周期脚本，自动写入 distribution: managed 托管锁。
        </p>
        <SettingsRow
          title="npm 包名或 Tarball 地址"
          description="社区插件推荐遵循 prismux-plugin-* 命名规范，且必须声明顶层 engines.prismux。"
        >
          <div className="mt-2.5 flex flex-col gap-2 pb-2 sm:flex-row sm:items-center">
            <Input
              nativeInput
              size="sm"
              className="flex-1 font-mono"
              placeholder="例如：prismux-plugin-notion 或 https://registry.npmmirror.com/.../.tgz"
              value={npmInput}
              onChange={(event) => setNpmInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void executeNpmInstall(npmInput, networkPreference, false);
                }
              }}
            />
            <div className="w-full sm:w-56">
              <Select
                value={networkPreference}
                onValueChange={(val) => {
                  if (val === "auto" || val === "domestic" || val === "global") {
                    setNetworkPreference(val);
                  }
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue>{NETWORK_PREFERENCE_LABELS[networkPreference]}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="auto">{NETWORK_PREFERENCE_LABELS.auto}</SelectItem>
                  <SelectItem value="domestic">{NETWORK_PREFERENCE_LABELS.domestic}</SelectItem>
                  <SelectItem value="global">{NETWORK_PREFERENCE_LABELS.global}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <Button
              size="sm"
              disabled={busyKey !== null || npmInput.trim().length === 0}
              onClick={() => {
                void executeNpmInstall(npmInput, networkPreference, false);
              }}
            >
              <DownloadIcon className="size-3.5" />
              {busyKey === "install:npm" ? "流式安装中…" : "安装插件"}
            </Button>
          </div>
        </SettingsRow>

        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[11px] text-muted-foreground">
          <LockIcon className="size-3.5 text-muted-foreground" />
          <span>安全契约：</span>
          <Badge variant="outline">免 Git 依赖</Badge>
          <Badge variant="outline">禁用安装脚本</Badge>
          <Badge variant="outline">顶层 SemVer 强制校验</Badge>
          <Badge variant="outline">modelVisible 强制审计</Badge>
        </div>
      </SettingsSection>

      {/* Section 3: Installed Plugins Runtime Status */}
      <SettingsSection
        id="prismux-plugins-installed"
        title="已安装插件与运行态"
        headerAction={
          <Badge variant="outline" className="tabular-nums">
            {installed.length} 项已安装
          </Badge>
        }
      >
        <p className="px-4 py-2.5 text-xs text-muted-foreground">
          所有已安装插件凭据独立隔离存放在 ~/.prismux/credentials/&lt;plugin-id&gt;.enc（0600 权限）。
        </p>
        {installed.length === 0 ? (
          <div className="px-4 py-5 text-center text-xs text-muted-foreground">
            当前尚未安装任何插件（符合 Prismux 极简零预装基线）。
          </div>
        ) : (
          installed.map((item) => {
            const isBusy =
              busyKey === `toggle:${item.id}` || busyKey === `uninstall:${item.id}`;
            return (
              <SettingsRow
                key={item.id}
                title={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span>{OFFICIAL_TITLE_MAP[item.id] ?? item.id}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      v{item.version}
                    </code>
                    <Badge variant="outline">{item.distribution}</Badge>
                    <Badge variant={item.mounted ? "success" : "secondary"}>
                      {item.mounted ? "已挂载" : "未挂载"}
                    </Badge>
                  </span>
                }
                description={
                  item.description ||
                  `来源：${item.source} · 运行域：${item.realms.join(" / ") || "daemon"}`
                }
                control={
                  <div className="flex items-center gap-2">
                    <Switch
                      aria-label={`切换插件 ${item.id} 启用状态`}
                      checked={item.enabled}
                      disabled={isBusy}
                      onCheckedChange={(checked) => {
                        void handleTogglePlugin(item.id, Boolean(checked));
                      }}
                    />
                    <Button
                      size="xs"
                      variant="destructive-outline"
                      disabled={isBusy}
                      onClick={() => {
                        void handleUninstallPlugin(item.id);
                      }}
                    >
                      <Trash2Icon className="size-3.5" />
                      卸载
                    </Button>
                  </div>
                }
              />
            );
          })
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
