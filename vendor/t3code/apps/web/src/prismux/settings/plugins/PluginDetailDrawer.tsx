import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DeclarativeGlassRenderer,
  type DeclarativeActionEvent,
  type DeclarativeAtomValue,
} from "@prismux/appearance";
import {
  ArrowUpCircleIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  HistoryIcon,
  LockIcon,
  PackageIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Switch } from "../../../components/ui/switch";
import { useNativeTitlebarHeight } from "../../../lib/windowControlsOverlay";
import {
  CATEGORY_LABELS,
  classifyPermission,
  formatBytes,
  type PluginCenterItem,
  type PluginRuntimeLogEntry,
} from "./pluginCenterModel";

export interface PluginDetailDrawerProps {
  readonly plugin: PluginCenterItem | null;
  readonly logs: readonly PluginRuntimeLogEntry[];
  readonly loadingLogs?: boolean;
  readonly busyKey: string | null;
  readonly suspendEscape?: boolean;
  readonly onClose: () => void;
  readonly onInstallOrUpgrade: (plugin: PluginCenterItem, operation: "install" | "upgrade") => void;
  readonly onToggle: (pluginId: string, enabled: boolean) => void;
  readonly onRollback: (plugin: PluginCenterItem) => void;
  readonly onUninstall: (pluginId: string) => void;
  readonly onRefreshLogs: (pluginId: string) => void;
  readonly onClearLogs: (pluginId: string) => void;
  readonly onDeclarativeAction: (plugin: PluginCenterItem, event: DeclarativeActionEvent) => void;
  readonly onDeclarativeAtomChange: (
    plugin: PluginCenterItem,
    key: string,
    value: DeclarativeAtomValue,
  ) => void;
}

function formatLogTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return "--:--:--";
  }
}

function formatInstallDate(ts: number | null): string {
  if (!ts) return "未安装";
  try {
    return new Date(ts).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return "未知时间";
  }
}

/**
 * Right-side Plugin Detail Drawer:
 * - Version, distribution source & `distribution: "managed"` lock status
 * - Capability contributions (Panels, Commands, Hooks, Routes)
 * - `modelVisible` & permission declarations
 * - Inline `DeclarativeGlassRenderer` preview/config when plugin provides `ui: "components"`
 * - Runtime log viewer with level filtering
 * - One-click rollback & two-step safe uninstall
 */
export function PluginDetailDrawer({
  plugin,
  logs,
  loadingLogs = false,
  busyKey,
  suspendEscape = false,
  onClose,
  onInstallOrUpgrade,
  onToggle,
  onRollback,
  onUninstall,
  onRefreshLogs,
  onClearLogs,
  onDeclarativeAction,
  onDeclarativeAtomChange,
}: PluginDetailDrawerProps) {
  const titleId = useId();
  const rollbackDisabledId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nativeTitlebarHeight = useNativeTitlebarHeight();
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [logLevelFilter, setLogLevelFilter] = useState<"all" | "info" | "warn" | "error">("all");
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);

  useEffect(() => {
    if (typeof document !== "undefined") {
      setPortalHost(document.body);
    }
  }, []);

  useEffect(() => {
    setConfirmingUninstall(false);
    setLogLevelFilter("all");
    setCopiedLogs(false);
    if (plugin?.id) {
      // Aligned with stablyai/orca PluginDetailPage: focus heading on plugin open for A11y.
      headingRef.current?.focus();
    }
  }, [plugin?.id, portalHost]);

  useEffect(() => {
    if (!plugin || suspendEscape) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (confirmingUninstall) {
          setConfirmingUninstall(false);
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [confirmingUninstall, onClose, plugin, suspendEscape]);

  const filteredLogs = useMemo(() => {
    if (logLevelFilter === "all") return logs;
    return logs.filter((entry) => entry.level === logLevelFilter);
  }, [logLevelFilter, logs]);

  if (!plugin) {
    return null;
  }

  const isBusy =
    busyKey === `install:${plugin.id}` ||
    busyKey === `upgrade:${plugin.id}` ||
    busyKey === `toggle:${plugin.id}` ||
    busyKey === `rollback:${plugin.id}` ||
    busyKey === `uninstall:${plugin.id}`;

  const evaluatedPermissions = plugin.permissions.map(classifyPermission);
  const canRollback = Boolean(plugin.installed && plugin.previousVersion);
  const contributionBuckets = [
    { key: "panels", label: "面板 (Panels)", items: plugin.contributions.panels },
    { key: "commands", label: "命令 (Commands)", items: plugin.contributions.commands },
    { key: "hooks", label: "钩子 (Hooks)", items: plugin.contributions.hooks },
    { key: "routes", label: "路由 (Routes)", items: plugin.contributions.routes },
  ] as const;
  const headerSafeTopStyle =
    nativeTitlebarHeight > 0
      ? { paddingTop: `${nativeTitlebarHeight + 12}px` }
      : { paddingTop: "max(1rem, calc(env(titlebar-area-height, 0px) + 0.75rem))" };

  const drawerContent = (
    <div
      className="fixed top-0 right-0 bottom-6 left-0 z-[70] flex justify-end bg-black/55 backdrop-blur-xs [-webkit-app-region:no-drag]"
      data-slot="plugin-detail-drawer-backdrop"
      data-portal-layer="plugin-detail-drawer"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="plugin-detail-drawer"
        className="pmx-plugin-overlay-surface relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-border text-popover-foreground shadow-2xl transition-transform duration-240 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      >
        {/* Header */}
        <header
          style={headerSafeTopStyle}
          className="flex shrink-0 items-start justify-between gap-3 border-b border-border/70 px-5 pb-4"
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <PackageIcon className="size-4 shrink-0 text-primary" />
              <h3
                id={titleId}
                ref={headingRef}
                tabIndex={-1}
                className="text-base font-semibold text-foreground outline-none"
              >
                {plugin.title}
              </h3>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                v{plugin.installedVersion ?? plugin.version}
              </code>
              {plugin.hasUpdate ? (
                <Badge variant="info" className="tabular-nums">
                  可升级至 v{plugin.latestVersion}
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={plugin.source === "official" ? "success" : "info"}>
                {plugin.source === "official"
                  ? "官方认证"
                  : plugin.source === "npm"
                    ? "社区 npm"
                    : "本地源码"}
              </Badge>
              <Badge variant="outline">distribution: {plugin.distribution}</Badge>
              <Badge variant="secondary">{CATEGORY_LABELS[plugin.category]}</Badge>
              <Badge variant={plugin.modelVisible ? "warning" : "outline"}>
                {plugin.modelVisible ? "modelVisible: true · 模型可见" : "0 Token 宿主纯净"}
              </Badge>
              {plugin.installed ? (
                <Badge variant={plugin.mounted ? "success" : "secondary"}>
                  {plugin.mounted ? "已挂载运行" : plugin.enabled ? "已安装" : "已停用"}
                </Badge>
              ) : (
                <Badge variant="outline">未预装</Badge>
              )}
            </div>
          </div>

          <Button
            size="icon-sm"
            variant="outline"
            className="shrink-0"
            aria-label="关闭插件详情抽屉"
            onClick={onClose}
          >
            <XIcon className="size-4" />
          </Button>
        </header>

        {/* Scrollable Content */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 text-xs">
          {/* Overview & Distribution Metadata */}
          <section className="space-y-2.5 rounded-xl border border-border/70 bg-muted/20 p-3.5">
            <p className="leading-relaxed text-foreground">
              {plugin.description || "暂无插件简介。"}
            </p>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
              <div className="flex min-w-0 items-baseline gap-1.5">
                <dt className="shrink-0 text-muted-foreground">包标识：</dt>
                <dd className="min-w-0 truncate font-mono text-foreground">{plugin.packageName}</dd>
              </div>
              <div className="flex min-w-0 items-baseline gap-1.5">
                <dt className="shrink-0 text-muted-foreground">engines.prismux：</dt>
                <dd className="min-w-0 break-words font-mono text-foreground">
                  {plugin.enginesPrismux}
                </dd>
              </div>
              <div className="flex min-w-0 items-baseline gap-1.5">
                <dt className="shrink-0 text-muted-foreground">运行域：</dt>
                <dd className="min-w-0 text-foreground">{plugin.realms.join(" / ") || "daemon"}</dd>
              </div>
              <div className="flex min-w-0 items-baseline gap-1.5">
                <dt className="shrink-0 text-muted-foreground">包体积：</dt>
                <dd className="min-w-0 tabular-nums text-foreground">
                  {formatBytes(plugin.bytes)}
                </dd>
              </div>
              <div className="flex min-w-0 items-baseline gap-1.5">
                <dt className="shrink-0 text-muted-foreground">安装时间：</dt>
                <dd className="min-w-0 tabular-nums text-foreground">
                  {formatInstallDate(plugin.installedAt)}
                </dd>
              </div>
              <div className="flex min-w-0 items-baseline gap-1.5">
                <dt className="shrink-0 text-muted-foreground">凭据隔离：</dt>
                <dd className="min-w-0 truncate font-mono text-[11px] text-foreground">
                  ~/.prismux/credentials/{plugin.id}.enc (0600)
                </dd>
              </div>
            </dl>
            {plugin.sha256 ? (
              <div className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5">
                <span className="text-muted-foreground">SHA-256：</span>
                <code className="break-all font-mono text-[11px] text-foreground">
                  {plugin.sha256}
                </code>
              </div>
            ) : null}
            {plugin.distribution === "managed" ? (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <LockIcon className="size-3.5 shrink-0 text-primary" />
                <span>
                  已启用 managed 单写锁：禁止插件在运行期私自热自更，升级与回滚统一由宿主插件中心原子替换。
                </span>
              </div>
            ) : null}
          </section>

          {/* Capability Contributions */}
          <section className="space-y-2.5">
            <h4 className="text-sm font-semibold text-foreground">能力贡献清单</h4>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {contributionBuckets.map((bucket) => (
                <div
                  key={bucket.key}
                  className="rounded-xl border border-border/70 bg-muted/15 p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{bucket.label}</span>
                    <Badge variant="outline" size="sm" className="tabular-nums">
                      {bucket.items.length > 0 ? `${bucket.items.length} 项` : "未声明"}
                    </Badge>
                  </div>
                  {bucket.items.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">该插件未声明此类贡献项。</p>
                  ) : (
                    <ul className="space-y-1">
                      {bucket.items.map((entry) => (
                        <li
                          key={entry}
                          className="truncate rounded bg-background/60 px-2 py-1 font-mono text-[11px] text-foreground"
                          title={entry}
                        >
                          {entry}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Model Visibility & Permissions */}
          <section className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-foreground">modelVisible 与权限声明</h4>
              {plugin.modelVisible || plugin.modifiesSystemPrompt ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-warning-foreground">
                  <ShieldAlertIcon className="size-3.5" />
                  需信任审计确认
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] text-success-foreground">
                  <ShieldCheckIcon className="size-3.5" />
                  对大模型 0 Token 零注入
                </span>
              )}
            </div>
            {evaluatedPermissions.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-muted/15 px-3 py-2.5 text-muted-foreground">
                <ShieldCheckIcon className="size-4 shrink-0 text-success-foreground" />
                <span>仅访问插件自身隔离目录（无外部系统权限，对大模型 0 Token 纯净）。</span>
              </div>
            ) : (
              <ul className="divide-y divide-border/60 rounded-xl border border-border/70 bg-muted/15">
                {evaluatedPermissions.map((perm) => (
                  <li
                    key={perm.permission}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <code className="font-mono text-[11px] text-foreground">
                        {perm.permission}
                      </code>
                      <p className="text-[11px] text-muted-foreground">{perm.label}</p>
                    </div>
                    <Badge variant={perm.elevated ? "warning" : "outline"} size="sm">
                      {perm.elevated ? "敏感权限" : "常规"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Declarative Liquid Glass UI Preview / Configuration */}
          {plugin.declarativeUi ? (
            <section className="space-y-2.5" data-testid="plugin-declarative-ui-section">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <SparklesIcon className="size-4 text-primary" />
                  声明式液态玻璃界面（ui: &quot;components&quot;）
                </h4>
                <Badge variant="info" size="sm">
                  受限 8 原语 · 零 HTML 注入
                </Badge>
              </div>
              <DeclarativeGlassRenderer
                spec={plugin.declarativeUi}
                compact
                persistKey={`prismux.plugin.atoms.${plugin.id}`}
                ariaLabel={`${plugin.title} 声明式配置区`}
                onAtomChange={(key, value) => onDeclarativeAtomChange(plugin, key, value)}
                onAction={(event) => onDeclarativeAction(plugin, event)}
              />
            </section>
          ) : null}

          {/* Runtime Log Viewer */}
          <section className="space-y-2.5" data-testid="plugin-runtime-logs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <ScrollTextIcon className="size-4 text-muted-foreground" />
                运行日志查看器
              </h4>
              <div className="flex flex-wrap items-center gap-1.5">
                {(["all", "info", "warn", "error"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    aria-pressed={logLevelFilter === lvl}
                    onClick={() => setLogLevelFilter(lvl)}
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                      logLevelFilter === lvl
                        ? "border-primary/60 bg-primary/15 text-foreground"
                        : "border-border/70 bg-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {lvl === "all" ? "全部" : lvl.toUpperCase()}
                  </button>
                ))}
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={loadingLogs}
                  onClick={() => onRefreshLogs(plugin.id)}
                >
                  <RefreshCwIcon className={loadingLogs ? "size-3 animate-spin" : "size-3"} />
                  刷新
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={filteredLogs.length === 0}
                  onClick={() => {
                    const text = filteredLogs
                      .map(
                        (entry) =>
                          `${formatLogTime(entry.timestamp)} ${entry.level.toUpperCase().padEnd(5)} [${entry.source}] ${entry.message}`,
                      )
                      .join("\n");
                    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                      void navigator.clipboard.writeText(text).then(() => {
                        setCopiedLogs(true);
                        window.setTimeout(() => setCopiedLogs(false), 1800);
                      });
                    }
                  }}
                >
                  {copiedLogs ? (
                    <>
                      <CheckIcon className="size-3" />
                      已复制
                    </>
                  ) : (
                    <>
                      <CopyIcon className="size-3" />
                      复制日志
                    </>
                  )}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={logs.length === 0}
                  onClick={() => onClearLogs(plugin.id)}
                >
                  清空
                </Button>
              </div>
            </div>

            <div
              tabIndex={0}
              aria-label="插件运行日志输出"
              className="max-h-52 overflow-y-auto rounded-xl border border-border/70 bg-background/70 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {filteredLogs.length === 0 ? (
                <div className="px-3.5 py-5 text-center font-sans text-xs text-muted-foreground">
                  暂无匹配的运行日志（执行启停、安装、声明式操作后将实时记录）。
                </div>
              ) : (
                <ul className="divide-y divide-border/50">
                  {filteredLogs.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-2 px-3 py-1.5">
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatLogTime(entry.timestamp)}
                      </span>
                      <Badge
                        size="sm"
                        variant={
                          entry.level === "error"
                            ? "error"
                            : entry.level === "warn"
                              ? "warning"
                              : "outline"
                        }
                      >
                        {entry.level.toUpperCase()}
                      </Badge>
                      <span className="min-w-0 flex-1 break-all text-foreground">
                        [{entry.source}] {entry.message}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        {/* Footer Actions: Toggle, Upgrade/Install, Rollback, Safe Uninstall */}
        <footer className="space-y-2 border-t border-border/70 bg-muted/25 px-5 py-3.5">
          {confirmingUninstall ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs"
            >
              <span className="text-foreground">
                确认安全卸载 <strong>{plugin.title}</strong>？将释放全部 ctx.effect() 监听、路由与声明式面板（零残留）。
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={isBusy}
                  onClick={() => setConfirmingUninstall(false)}
                >
                  取消
                </Button>
                <Button
                  size="xs"
                  variant="destructive"
                  disabled={isBusy}
                  onClick={() => {
                    setConfirmingUninstall(false);
                    onUninstall(plugin.id);
                  }}
                >
                  确认安全卸载
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            {plugin.installed ? (
              <div className="flex items-center gap-2.5">
                <Switch
                  aria-label={`启用或停用 ${plugin.title}`}
                  checked={plugin.enabled}
                  disabled={isBusy}
                  onCheckedChange={(checked) => onToggle(plugin.id, Boolean(checked))}
                />
                <span className="text-xs text-foreground">
                  {plugin.enabled ? "已启用" : "已停用"}
                </span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">
                该插件当前未预装，可按需验签安装。
              </span>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {plugin.installed && plugin.hasUpdate ? (
                <Button
                  size="xs"
                  variant="default"
                  disabled={isBusy}
                  onClick={() => onInstallOrUpgrade(plugin, "upgrade")}
                >
                  <ArrowUpCircleIcon className="size-3.5" />
                  升级至 v{plugin.latestVersion}
                </Button>
              ) : null}

              {plugin.installed ? (
                <>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!canRollback || isBusy}
                    aria-describedby={!canRollback ? rollbackDisabledId : undefined}
                    onClick={() => onRollback(plugin)}
                  >
                    <HistoryIcon className="size-3.5" />
                    {plugin.previousVersion
                      ? `一键回滚至 v${plugin.previousVersion}`
                      : "一键回滚"}
                  </Button>
                  <Button
                    size="xs"
                    variant="destructive-outline"
                    disabled={isBusy}
                    onClick={() => setConfirmingUninstall(true)}
                  >
                    <Trash2Icon className="size-3.5" />
                    安全卸载
                  </Button>
                </>
              ) : (
                <Button
                  size="xs"
                  variant="default"
                  disabled={isBusy}
                  onClick={() => onInstallOrUpgrade(plugin, "install")}
                >
                  <DownloadIcon className="size-3.5" />
                  {busyKey === `install:${plugin.id}` ? "安装中…" : "按需安装"}
                </Button>
              )}
            </div>
          </div>

          {plugin.installed && !canRollback ? (
            <p id={rollbackDisabledId} className="text-[11px] text-muted-foreground">
              当前暂无可回滚的历史版本快照（完成一次升级后将自动记录上一版本用于一键回滚）。
            </p>
          ) : null}
        </footer>
      </aside>
    </div>
  );

  return portalHost ? createPortal(drawerContent, portalHost) : drawerContent;
}
