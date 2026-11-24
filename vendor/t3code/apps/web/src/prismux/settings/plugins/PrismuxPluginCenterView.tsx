import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeclarativeActionEvent, DeclarativeAtomValue } from "@prismux/appearance";
import {
  AlertTriangleIcon,
  ArrowUpCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  EyeIcon,
  InfoIcon,
  LockIcon,
  PackageIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";

import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { PluginDetailDrawer } from "./PluginDetailDrawer";
import { PluginRollbackDialog } from "./PluginRollbackDialog";
import { PluginTrustAuditModal } from "./PluginTrustAuditModal";
import { requestDiagnosticsRefresh } from "../prismuxDiagnostics.logic";
import {
  CATEGORY_LABELS,
  DEFAULT_GROUP_DISPLAY_LIMIT,
  DEFAULT_RETIRED_OFFICIAL_PLUGINS,
  PLUGIN_CATEGORY_CHIPS,
  PLUGIN_STATUS_TABS,
  computePluginCounts,
  evaluatePluginTrustAudit,
  filterPluginCenterItems,
  formatBytes,
  isAuditRequiredError,
  mergePluginCenterItems,
  parseCatalogPluginsPayload,
  parseInstalledPluginsPayload,
  parseRetiredPluginsPayload,
  selectVisiblePluginsForGroup,
  type InstalledPluginRaw,
  type OfficialCatalogPluginRaw,
  type PluginCategoryId,
  type PluginCenterItem,
  type PluginRuntimeLogEntry,
  type PluginStatusTabId,
  type RetiredPluginItem,
  type TrustAuditAssessment,
} from "./pluginCenterModel";

export interface PluginCenterDaemonTransport {
  requestJson<T>(path: string, init?: RequestInit): Promise<T>;
}

export interface PrismuxPluginCenterViewProps {
  readonly daemon: PluginCenterDaemonTransport;
  readonly daemonReady: boolean;
  /** Optional preloaded items (useful for tests or SSR). */
  readonly initialCatalog?: readonly OfficialCatalogPluginRaw[];
  readonly initialInstalled?: readonly InstalledPluginRaw[];
  readonly initialRetired?: readonly RetiredPluginItem[];
  /** Disable automatic mount fetch when initial data is injected by tests. */
  readonly skipInitialFetch?: boolean;
  /** Optional override for group truncation limit (defaults to 12). */
  readonly groupDisplayLimit?: number;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(parts.join(""));
}

const NETWORK_PREFERENCE_LABELS: Readonly<Record<"auto" | "domestic" | "global", string>> = {
  auto: "智能测速（自动切换）",
  domestic: "国内优先（npmmirror 镜像）",
  global: "国际优先（npmjs 官方源）",
};

const PREV_VERSION_STORAGE_KEY = "prismux.plugins.previousVersions.v1";

function readPreviousVersionMap(): Record<string, string> {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(PREV_VERSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim().length > 0) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writePreviousVersionMap(next: Readonly<Record<string, string>>): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(PREV_VERSION_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures.
  }
}

function parseRemoteLogs(payload: unknown): PluginRuntimeLogEntry[] {
  if (typeof payload !== "object" || payload === null) return [];
  const root = payload as Record<string, unknown>;
  const rawList = Array.isArray(root.logs) ? root.logs : Array.isArray(payload) ? payload : [];
  const out: PluginRuntimeLogEntry[] = [];
  for (let i = 0; i < rawList.length; i += 1) {
    const item = rawList[i];
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const message = typeof rec.message === "string" ? rec.message : "";
    if (!message) continue;
    const rawLevel = rec.level;
    const level: PluginRuntimeLogEntry["level"] =
      rawLevel === "warn" || rawLevel === "error" ? rawLevel : "info";
    out.push({
      id: typeof rec.id === "string" ? rec.id : `remote-${i}-${Date.now()}`,
      timestamp: typeof rec.timestamp === "number" ? rec.timestamp : Date.now(),
      level,
      source: typeof rec.source === "string" ? rec.source : "daemon",
      message,
    });
  }
  return out;
}

export function PrismuxPluginCenterView({
  daemon,
  daemonReady,
  initialCatalog,
  initialInstalled,
  initialRetired,
  skipInitialFetch = false,
  groupDisplayLimit = DEFAULT_GROUP_DISPLAY_LIMIT,
}: PrismuxPluginCenterViewProps) {
  const [catalogRaw, setCatalogRaw] = useState<OfficialCatalogPluginRaw[]>(() =>
    initialCatalog ? [...initialCatalog] : [],
  );
  const [installedRaw, setInstalledRaw] = useState<InstalledPluginRaw[]>(() =>
    initialInstalled ? [...initialInstalled] : [],
  );
  const [retiredPlugins, setRetiredPlugins] = useState<RetiredPluginItem[]>(() =>
    initialRetired ? [...initialRetired] : [...DEFAULT_RETIRED_OFFICIAL_PLUGINS],
  );
  const [previousVersions, setPreviousVersions] = useState<Record<string, string>>(() =>
    readPreviousVersionMap(),
  );

  const [loading, setLoading] = useState(!skipInitialFetch);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Navigation & filtering state
  const [activeTab, setActiveTab] = useState<PluginStatusTabId>("all");
  const [activeCategory, setActiveCategory] = useState<PluginCategoryId>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Community npm & local archive import state
  const [npmInput, setNpmInput] = useState("");
  const [networkPreference, setNetworkPreference] = useState<"auto" | "domestic" | "global">(
    "auto",
  );
  const localFileInputRef = useRef<HTMLInputElement>(null);

  // Detail drawer, runtime logs, rollback dialog & trust audit modal
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [pendingAudit, setPendingAudit] = useState<TrustAuditAssessment | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [pendingRollbackPlugin, setPendingRollbackPlugin] = useState<PluginCenterItem | null>(null);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [logsByPlugin, setLogsByPlugin] = useState<Record<string, PluginRuntimeLogEntry[]>>({});
  const [loadingLogsFor, setLoadingLogsFor] = useState<string | null>(null);

  const logSeqRef = useRef(0);
  const prevDaemonReadyRef = useRef(daemonReady);

  const appendPluginLog = useCallback(
    (
      pluginId: string,
      level: PluginRuntimeLogEntry["level"],
      source: string,
      message: string,
    ) => {
      logSeqRef.current += 1;
      const entry: PluginRuntimeLogEntry = {
        id: `local-${pluginId}-${logSeqRef.current}`,
        timestamp: Date.now(),
        level,
        source,
        message,
      };
      setLogsByPlugin((prev) => ({
        ...prev,
        [pluginId]: [entry, ...(prev[pluginId] ?? [])].slice(0, 100),
      }));
    },
    [],
  );

  const recordPreviousVersion = useCallback((pluginId: string, prevVersion: string | undefined) => {
    if (!prevVersion) return;
    setPreviousVersions((prev) => {
      const next = { ...prev, [pluginId]: prevVersion };
      writePreviousVersionMap(next);
      return next;
    });
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [catalogRes, installedRes] = await Promise.all([
        daemon.requestJson<unknown>("/v1/plugins/catalog"),
        daemon.requestJson<unknown>("/v1/plugins/installed"),
      ]);
      setCatalogRaw(parseCatalogPluginsPayload(catalogRes));
      setRetiredPlugins(parseRetiredPluginsPayload(catalogRes));
      setInstalledRaw(parseInstalledPluginsPayload(installedRes));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [daemon]);

  useEffect(() => {
    if (!skipInitialFetch) {
      void loadAll();
    }
  }, [loadAll, skipInitialFetch]);

  useEffect(() => {
    if (!skipInitialFetch && daemonReady && !prevDaemonReadyRef.current) {
      void loadAll();
    }
    prevDaemonReadyRef.current = daemonReady;
  }, [daemonReady, loadAll, skipInitialFetch]);

  const allPlugins = useMemo(
    () => mergePluginCenterItems(catalogRaw, installedRaw, previousVersions),
    [catalogRaw, installedRaw, previousVersions],
  );

  const counts = useMemo(() => computePluginCounts(allPlugins), [allPlugins]);

  const filteredPlugins = useMemo(
    () =>
      filterPluginCenterItems(allPlugins, {
        tab: activeTab,
        category: activeCategory,
        query: searchQuery,
      }),
    [activeCategory, activeTab, allPlugins, searchQuery],
  );

  const isFiltering =
    searchQuery.trim().length > 0 || activeTab !== "all" || activeCategory !== "all";

  const featuredPlugins = useMemo(() => {
    if (searchQuery.trim().length > 0 || activeCategory !== "all") return [];
    if (activeTab !== "all" && activeTab !== "available") return [];
    return allPlugins.filter((item) => item.featured).slice(0, 4);
  }, [activeCategory, activeTab, allPlugins, searchQuery]);

  const officialGroupItems = useMemo(
    () => filteredPlugins.filter((item) => item.source === "official"),
    [filteredPlugins],
  );
  const communityGroupItems = useMemo(
    () => filteredPlugins.filter((item) => item.source !== "official"),
    [filteredPlugins],
  );

  const officialVisibility = useMemo(
    () =>
      selectVisiblePluginsForGroup(officialGroupItems, {
        isFiltering,
        expanded: Boolean(expandedGroups.official),
        limit: groupDisplayLimit,
      }),
    [expandedGroups.official, groupDisplayLimit, isFiltering, officialGroupItems],
  );

  const communityVisibility = useMemo(
    () =>
      selectVisiblePluginsForGroup(communityGroupItems, {
        isFiltering,
        expanded: Boolean(expandedGroups.community),
        limit: groupDisplayLimit,
      }),
    [communityGroupItems, expandedGroups.community, groupDisplayLimit, isFiltering],
  );

  const selectedPlugin = useMemo(
    () => (selectedPluginId ? allPlugins.find((p) => p.id === selectedPluginId) ?? null : null),
    [allPlugins, selectedPluginId],
  );

  const fetchPluginLogs = useCallback(
    async (pluginId: string) => {
      setLoadingLogsFor(pluginId);
      try {
        const res = await daemon.requestJson<unknown>(
          `/v1/plugins/logs?pluginId=${encodeURIComponent(pluginId)}`,
        );
        const remoteEntries = parseRemoteLogs(res);
        if (remoteEntries.length > 0) {
          setLogsByPlugin((prev) => ({
            ...prev,
            [pluginId]: [...remoteEntries, ...(prev[pluginId] ?? []).filter((e) => e.id.startsWith("local-"))].slice(
              0,
              120,
            ),
          }));
        }
      } catch {
        // Older daemon builds may not expose /v1/plugins/logs; gracefully retain local event trace.
      } finally {
        setLoadingLogsFor((current) => (current === pluginId ? null : current));
      }
    },
    [daemon],
  );

  const handleOpenDetail = useCallback(
    (plugin: PluginCenterItem) => {
      setSelectedPluginId(plugin.id);
      if (!logsByPlugin[plugin.id] || logsByPlugin[plugin.id]!.length === 0) {
        appendPluginLog(
          plugin.id,
          "info",
          "plugin-center",
          `已打开插件详情：${plugin.packageName}@${plugin.installedVersion ?? plugin.version}（distribution=${plugin.distribution}，modelVisible=${String(plugin.modelVisible)}）。`,
        );
      }
      if (!skipInitialFetch) {
        void fetchPluginLogs(plugin.id);
      }
    },
    [appendPluginLog, fetchPluginLogs, logsByPlugin, skipInitialFetch],
  );

  const executeOfficialInstallOrUpgrade = useCallback(
    async (
      plugin: PluginCenterItem,
      operation: "install" | "upgrade",
      confirmedAudit: boolean,
    ) => {
      const assessment = evaluatePluginTrustAudit(
        {
          source: "official",
          targetLabel: `${plugin.title} (${plugin.packageName})`,
          pluginId: plugin.id,
          fromVersion: plugin.installedVersion,
          toVersion: plugin.latestVersion,
          distribution: plugin.distribution,
          sha256: plugin.sha256,
          modelVisible: plugin.modelVisible,
          modifiesSystemPrompt: plugin.modifiesSystemPrompt,
          permissions: plugin.permissions,
        },
        operation,
      );

      if (assessment.required && !confirmedAudit) {
        setAuditError(null);
        setPendingAudit(assessment);
        return;
      }

      setBusyKey(`${operation}:${plugin.id}`);
      setErrorMsg(null);
      setAuditError(null);
      setStatusMsg(null);
      try {
        if (operation === "upgrade" && plugin.installedVersion) {
          recordPreviousVersion(plugin.id, plugin.installedVersion);
        }
        await daemon.requestJson<unknown>("/v1/plugins/install", {
          method: "POST",
          body: JSON.stringify({
            source: "official",
            pluginId: plugin.id,
            networkPreference,
            confirmedAudit,
          }),
        });
        setPendingAudit(null);
        setAuditError(null);
        const verb = operation === "upgrade" ? "升级" : "安装";
        setStatusMsg(
          `已成功验签并${verb}官方插件 ${plugin.packageName}@${plugin.latestVersion}（distribution: "managed"）。`,
        );
        appendPluginLog(
          plugin.id,
          "info",
          "installer",
          `已完成${verb}（v${plugin.latestVersion}，confirmedAudit=${String(confirmedAudit)}）。`,
        );
        if (!skipInitialFetch) {
          await loadAll();
        }
        requestDiagnosticsRefresh("plugin-mutated");
      } catch (err) {
        const auditErr = isAuditRequiredError(err);
        if (auditErr.required && !confirmedAudit) {
          setAuditError(null);
          setPendingAudit(
            evaluatePluginTrustAudit(
              {
                source: "official",
                targetLabel: `${plugin.title} (${plugin.packageName})`,
                pluginId: plugin.id,
                fromVersion: plugin.installedVersion,
                toVersion: plugin.latestVersion,
                distribution: plugin.distribution,
                sha256: plugin.sha256,
                modelVisible: true,
                modifiesSystemPrompt: plugin.modifiesSystemPrompt,
                permissions:
                  auditErr.permissions.length > 0 ? auditErr.permissions : plugin.permissions,
                extraReasons:
                  auditErr.reasons.length > 0 ? auditErr.reasons : [auditErr.message],
                forceRequired: true,
              },
              operation,
            ),
          );
        } else {
          const rawMsg = err instanceof Error ? err.message : String(err);
          const msg = !daemonReady
            ? `Prismux Daemon 未连接，无法执行插件安装（${rawMsg}）。请等待 Daemon 就绪后重试。`
            : rawMsg;
          setErrorMsg(msg);
          setAuditError(msg);
          appendPluginLog(plugin.id, "error", "installer", `安装/升级失败：${msg}`);
        }
      } finally {
        setBusyKey(null);
      }
    },
    [appendPluginLog, daemon, daemonReady, loadAll, networkPreference, recordPreviousVersion, skipInitialFetch],
  );

  const executeNpmInstall = useCallback(
    async (
      pkgOrTarball: string,
      pref: "auto" | "domestic" | "global",
      confirmedAudit: boolean,
    ) => {
      const trimmed = pkgOrTarball.trim();
      if (!trimmed) {
        setErrorMsg("请输入社区插件的 npm 包名（例如 prismux-plugin-xxx）或 .tgz 地址。");
        return;
      }
      setBusyKey("install:npm");
      setErrorMsg(null);
      setAuditError(null);
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
        setAuditError(null);
        setNpmInput("");
        setStatusMsg(`社区插件 ${trimmed} 已通过免 Git 流式安装（所有安装脚本已禁用）。`);
        if (!skipInitialFetch) {
          await loadAll();
        }
        requestDiagnosticsRefresh("plugin-mutated");
      } catch (err) {
        const auditErr = isAuditRequiredError(err);
        if (auditErr.required && !confirmedAudit) {
          setAuditError(null);
          setPendingAudit(
            evaluatePluginTrustAudit(
              {
                source: "npm",
                targetLabel: trimmed,
                packageNameOrTarball: trimmed,
                networkPreference: pref,
                distribution: "managed",
                modelVisible: true,
                permissions: auditErr.permissions,
                extraReasons:
                  auditErr.reasons.length > 0
                    ? auditErr.reasons
                    : [
                        auditErr.message ||
                          "该社区插件声明了 modelVisible: true 或敏感权限，请人工审计后再放行安装。",
                      ],
                forceRequired: true,
              },
              "install",
            ),
          );
        } else {
          const rawMsg = err instanceof Error ? err.message : String(err);
          const msg = !daemonReady
            ? `Prismux Daemon 未连接，无法执行社区插件安装（${rawMsg}）。`
            : rawMsg;
          setErrorMsg(msg);
          setAuditError(msg);
        }
      } finally {
        setBusyKey(null);
      }
    },
    [daemon, daemonReady, loadAll, skipInitialFetch],
  );

  const executeLocalArchiveInstall = useCallback(
    async (fileName: string, archiveBase64: string, confirmedAudit: boolean) => {
      setBusyKey("install:local");
      setErrorMsg(null);
      setAuditError(null);
      setStatusMsg(null);
      try {
        const res = await daemon.requestJson<{
          plugin?: { manifest?: { id?: string; version?: string }; packageName?: string };
        }>("/v1/plugins/install", {
          method: "POST",
          body: JSON.stringify({
            source: "local-archive",
            fileName,
            archiveBase64,
            confirmedAudit,
          }),
        });
        setPendingAudit(null);
        setAuditError(null);
        const installedId = res?.plugin?.manifest?.id ?? fileName;
        const installedVer = res?.plugin?.manifest?.version;
        setStatusMsg(
          `已成功导入并安装本地插件归档 ${installedId}${installedVer ? `@${installedVer}` : ""}（distribution: "managed"，脚本已禁用）。`,
        );
        if (!skipInitialFetch) {
          await loadAll();
        }
        requestDiagnosticsRefresh("plugin-mutated");
      } catch (err) {
        const auditErr = isAuditRequiredError(err);
        if (auditErr.required && !confirmedAudit) {
          setAuditError(null);
          setPendingAudit(
            evaluatePluginTrustAudit(
              {
                source: "local",
                targetLabel: fileName,
                localArchiveFileName: fileName,
                localArchiveBase64: archiveBase64,
                distribution: "managed",
                modelVisible: true,
                permissions: auditErr.permissions,
                extraReasons:
                  auditErr.reasons.length > 0
                    ? auditErr.reasons
                    : [
                        auditErr.message ||
                          "该本地归档插件声明了 modelVisible: true 或敏感权限，请人工审计后再放行安装。",
                      ],
                forceRequired: true,
              },
              "install",
            ),
          );
        } else {
          const rawMsg = err instanceof Error ? err.message : String(err);
          const msg = !daemonReady
            ? `Prismux Daemon 未连接，无法导入本地插件归档（${rawMsg}）。`
            : rawMsg;
          setErrorMsg(msg);
          setAuditError(msg);
        }
      } finally {
        setBusyKey(null);
      }
    },
    [daemon, daemonReady, loadAll, skipInitialFetch],
  );

  const handleLocalArchiveFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset input so choosing the same file again still fires onChange.
      event.target.value = "";
      if (!file) return;
      try {
        const buffer = await file.arrayBuffer();
        const base64 = arrayBufferToBase64(buffer);
        await executeLocalArchiveInstall(file.name, base64, false);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    },
    [executeLocalArchiveInstall],
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
        appendPluginLog(
          pluginId,
          "info",
          "cordis-host",
          enabled ? "已启用并挂载插件作用域。" : "已停用并释放插件作用域资源。",
        );
        if (!skipInitialFetch) {
          await loadAll();
        }
        requestDiagnosticsRefresh("plugin-mutated");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
        appendPluginLog(pluginId, "error", "cordis-host", `切换状态失败：${msg}`);
      } finally {
        setBusyKey(null);
      }
    },
    [appendPluginLog, daemon, loadAll, skipInitialFetch],
  );

  const handleRollbackPlugin = useCallback(
    async (plugin: PluginCenterItem) => {
      if (!plugin.previousVersion) return;
      setBusyKey(`rollback:${plugin.id}`);
      setErrorMsg(null);
      setRollbackError(null);
      setStatusMsg(null);
      try {
        await daemon.requestJson<unknown>("/v1/plugins/rollback", {
          method: "POST",
          body: JSON.stringify({
            pluginId: plugin.id,
            targetVersion: plugin.previousVersion,
          }),
        });
        setPendingRollbackPlugin(null);
        setStatusMsg(`插件 ${plugin.packageName} 已一键回滚至 v${plugin.previousVersion}。`);
        appendPluginLog(
          plugin.id,
          "warn",
          "rollback",
          `已触发一键回滚：v${plugin.installedVersion ?? plugin.version} → v${plugin.previousVersion}。`,
        );
        if (!skipInitialFetch) {
          await loadAll();
        }
        requestDiagnosticsRefresh("plugin-mutated");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setRollbackError(msg);
        setErrorMsg(`回滚失败：${msg}`);
        appendPluginLog(plugin.id, "error", "rollback", `一键回滚失败：${msg}`);
      } finally {
        setBusyKey(null);
      }
    },
    [appendPluginLog, daemon, loadAll, skipInitialFetch],
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
        setStatusMsg(`插件 ${pluginId} 已安全卸载并释放全部 ctx.effect() 监听（零残留）。`);
        appendPluginLog(
          pluginId,
          "info",
          "cordis-host",
          "已安全卸载，全部监听、面板、路由与订阅已通过 ctx.effect() 零残留清理。",
        );
        if (!skipInitialFetch) {
          await loadAll();
        }
        requestDiagnosticsRefresh("plugin-mutated");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
        appendPluginLog(pluginId, "error", "cordis-host", `安全卸载失败：${msg}`);
      } finally {
        setBusyKey(null);
      }
    },
    [appendPluginLog, daemon, loadAll, skipInitialFetch],
  );

  const handleConfirmPendingAudit = useCallback(async () => {
    if (!pendingAudit) return;
    if (pendingAudit.source === "official" && pendingAudit.pluginId) {
      const target = allPlugins.find((item) => item.id === pendingAudit.pluginId);
      if (target) {
        await executeOfficialInstallOrUpgrade(target, pendingAudit.operation, true);
      }
      return;
    }
    if (pendingAudit.source === "npm" && pendingAudit.packageNameOrTarball) {
      await executeNpmInstall(
        pendingAudit.packageNameOrTarball,
        pendingAudit.networkPreference ?? networkPreference,
        true,
      );
      return;
    }
    if (
      pendingAudit.source === "local" &&
      pendingAudit.localArchiveFileName &&
      pendingAudit.localArchiveBase64
    ) {
      await executeLocalArchiveInstall(
        pendingAudit.localArchiveFileName,
        pendingAudit.localArchiveBase64,
        true,
      );
    }
  }, [
    allPlugins,
    executeLocalArchiveInstall,
    executeNpmInstall,
    executeOfficialInstallOrUpgrade,
    networkPreference,
    pendingAudit,
  ]);

  const handleDeclarativeAction = useCallback(
    (plugin: PluginCenterItem, event: DeclarativeActionEvent) => {
      appendPluginLog(
        plugin.id,
        "info",
        "declarative-ui",
        `执行受控动作 "${event.actionId}"（payload=${JSON.stringify(event.payload ?? {})}）`,
      );
      setStatusMsg(`已触发插件 ${plugin.title} 的声明式动作：${event.actionId}`);
    },
    [appendPluginLog],
  );

  const handleDeclarativeAtomChange = useCallback(
    (plugin: PluginCenterItem, key: string, value: DeclarativeAtomValue) => {
      appendPluginLog(
        plugin.id,
        "info",
        "declarative-atom",
        `已持久化状态 atom "${key}" = ${JSON.stringify(value)}`,
      );
    },
    [appendPluginLog],
  );

  const renderPluginCard = (plugin: PluginCenterItem) => {
    const isBusy =
      busyKey === `install:${plugin.id}` ||
      busyKey === `upgrade:${plugin.id}` ||
      busyKey === `toggle:${plugin.id}` ||
      busyKey === `rollback:${plugin.id}` ||
      busyKey === `uninstall:${plugin.id}`;

    return (
      <li
        key={plugin.id}
        data-testid={`plugin-card-${plugin.id}`}
        data-installed={plugin.installed ? "1" : "0"}
        className="group/plugin-card relative flex flex-col justify-between gap-3 rounded-xl border border-border/80 bg-card/80 p-4 shadow-xs transition-colors hover:border-primary/40 has-[[data-plugin-row-name]:focus-visible]:ring-2 has-[[data-plugin-row-name]:focus-visible]:ring-ring"
      >
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-1.5">
                <PackageIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <h4 className="min-w-0 truncate text-sm font-semibold text-foreground" title={plugin.title}>
                  <button
                    type="button"
                    data-plugin-row-name=""
                    aria-label={`${plugin.title}（${plugin.installed ? "已安装" : "未预装"}，查看详情）`}
                    className="text-left outline-none after:absolute after:inset-0 after:content-['']"
                    onClick={() => handleOpenDetail(plugin)}
                  >
                    {plugin.title}
                  </button>
                </h4>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                  v{plugin.installedVersion ?? plugin.version}
                </code>
                <Badge variant="secondary" size="sm">
                  {CATEGORY_LABELS[plugin.category]}
                </Badge>
                {plugin.hasUpdate ? (
                  <Badge variant="info" size="sm" className="tabular-nums">
                    更新 v{plugin.latestVersion}
                  </Badge>
                ) : null}
              </div>
            </div>
            {plugin.installed ? (
              <Badge variant={plugin.mounted ? "success" : "secondary"} size="sm">
                {plugin.mounted ? "已挂载" : plugin.enabled ? "已安装" : "已停用"}
              </Badge>
            ) : (
              <Badge variant="outline" size="sm">
                未预装
              </Badge>
            )}
          </div>

          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {plugin.description || "暂无说明"}
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={plugin.source === "official" ? "success" : "info"} size="sm">
              {plugin.source === "official" ? "官方认证" : "社区 npm"}
            </Badge>
            <Badge variant={plugin.modelVisible ? "warning" : "outline"} size="sm">
              {plugin.modelVisible ? "modelVisible · 需审计" : "0 Token 纯净"}
            </Badge>
            {plugin.declarativeUi ? (
              <Badge variant="outline" size="sm">
                声明式 UI
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="space-y-2 border-t border-border/60 pt-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="truncate font-mono">{plugin.packageName}</span>
            <span className="tabular-nums">{formatBytes(plugin.bytes)}</span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground group-hover/plugin-card:text-foreground">
              <EyeIcon className="size-3.5" aria-hidden="true" />
              点击卡片查看详情
            </span>

            {/* Sibling action slot lifted above the stretched title link (2 tab stops, non-shifting width). */}
            <div className="relative z-10 ml-auto flex min-w-28 items-center justify-end gap-2">
              {plugin.installed && plugin.hasUpdate ? (
                <Button
                  size="xs"
                  variant="default"
                  disabled={isBusy}
                  onClick={() => {
                    void executeOfficialInstallOrUpgrade(plugin, "upgrade", false);
                  }}
                >
                  <ArrowUpCircleIcon className="size-3.5" />
                  升级
                </Button>
              ) : null}

              {plugin.installed ? (
                <Switch
                  aria-label={`启用或停用 ${plugin.title}`}
                  checked={plugin.enabled}
                  disabled={isBusy}
                  onCheckedChange={(checked) => {
                    void handleTogglePlugin(plugin.id, Boolean(checked));
                  }}
                />
              ) : (
                <Button
                  size="xs"
                  variant="default"
                  disabled={isBusy}
                  onClick={() => {
                    void executeOfficialInstallOrUpgrade(plugin, "install", false);
                  }}
                >
                  <DownloadIcon className="size-3.5" />
                  {busyKey === `install:${plugin.id}` ? "安装中…" : "按需安装"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </li>
    );
  };

  const renderGroupSection = (params: {
    groupKey: "official" | "community";
    id: string;
    title: string;
    subtitle: string;
    visibility: ReturnType<typeof selectVisiblePluginsForGroup<PluginCenterItem>>;
    emptyText: string;
  }) => {
    const isExpanded = Boolean(expandedGroups[params.groupKey]);
    const canToggleExpand =
      !isFiltering &&
      (params.visibility.isTruncated ||
        (isExpanded && params.visibility.totalCount > groupDisplayLimit));

    return (
      <section
        id={params.id}
        className="@container/plugin-catalog space-y-3"
        data-testid={`plugin-group-${params.groupKey}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{params.title}</h3>
              <Badge variant="outline" className="tabular-nums">
                {params.visibility.totalCount} 项
              </Badge>
              {!isFiltering && params.visibility.isTruncated ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  已展示 {params.visibility.visible.length} / 共 {params.visibility.totalCount} 项
                </span>
              ) : null}
              {!isFiltering && params.visibility.pinnedInstalledCount > 0 ? (
                <Badge variant="info" size="sm" className="tabular-nums">
                  已置留 {params.visibility.pinnedInstalledCount} 项已安装
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{params.subtitle}</p>
          </div>
        </div>

        {params.visibility.visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border/70 bg-muted/15 px-4 py-6 text-center text-xs text-muted-foreground">
            <span>{params.emptyText}</span>
            {searchQuery.trim().length > 0 || activeCategory !== "all" ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setSearchQuery("");
                  setActiveCategory("all");
                }}
              >
                清空搜索与筛选
              </Button>
            ) : activeTab === "installed" ? (
              <Button size="xs" variant="outline" onClick={() => setActiveTab("all")}>
                浏览全部插件
              </Button>
            ) : activeTab === "available" || activeTab === "updates" ? (
              <Button size="xs" variant="outline" onClick={() => setActiveTab("installed")}>
                查看已安装插件
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="grid list-none grid-cols-1 gap-3 @min-[460px]/plugin-catalog:grid-cols-2 @min-[720px]/plugin-catalog:grid-cols-3 @min-[1056px]/plugin-catalog:grid-cols-4">
            {params.visibility.visible.map(renderPluginCard)}
          </ul>
        )}

        {/* Full-width bottom expand toggle (aligned with stablyai/orca PluginListGroup.tsx). */}
        {canToggleExpand ? (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() =>
              setExpandedGroups((prev) => ({
                ...prev,
                [params.groupKey]: !isExpanded,
              }))
            }
          >
            {isExpanded ? (
              <>
                <ChevronUpIcon className="size-3.5" />
                收起至默认 {groupDisplayLimit} 项
              </>
            ) : (
              <>
                <ChevronDownIcon className="size-3.5" />
                展开全部 {params.visibility.totalCount} 个插件（剩余 {params.visibility.hiddenCount} 项）
              </>
            )}
          </Button>
        ) : null}
      </section>
    );
  };

  return (
    <div className="space-y-6" data-testid="prismux-plugin-center">
      {/* Mandatory zero-preinstall engineering declaration */}
      <div
        id="prismux-plugins"
        className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3.5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheckIcon className="size-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                两大官方插件默认零预装声明
              </h3>
              <Badge variant="info">纯净内核 · 按需安装</Badge>
              <Badge variant={daemonReady ? "success" : "warning"}>
                {daemonReady ? "Daemon 在线" : "Daemon 未连接"}
              </Badge>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              官方独立插件{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-2xs text-foreground">qq</code> 与{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-2xs text-foreground">
                fishdock-hook
              </code>{" "}
              默认均不预装、不随主程序捆绑启动（原{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-2xs text-foreground">pet</code>、
              <code className="rounded bg-muted px-1 py-0.5 text-2xs text-foreground">ssh</code>{" "}
              插件已停用，已被 Prismux 内置功能取代）。所有插件均采用 Cordis 双域可逆内核（卸载零残留）、受限声明式液态玻璃原语（零 HTML 注入）、顶层{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-2xs text-foreground">
                engines.prismux
              </code>{" "}
              SemVer 校验、SHA-256 验签与{" "}
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

      {/* Inline status / error banners */}
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

      {/* Four-state segmented filter Tabs + Instant Search + Secondary Category Chips */}
      <div className="space-y-3 rounded-xl border border-border/80 bg-card/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Segmented Tabs */}
          <div
            role="tablist"
            aria-label="插件状态筛选"
            className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border/70 bg-muted/40 p-1"
          >
            {PLUGIN_STATUS_TABS.map((tab) => {
              const selected = activeTab === tab.id;
              const badgeCount =
                tab.id === "all"
                  ? counts.all
                  : tab.id === "installed"
                    ? counts.installed
                    : tab.id === "available"
                      ? counts.available
                      : counts.updates;
              const tabText =
                tab.id === "installed"
                  ? `${tab.label} (${badgeCount})`
                  : tab.id === "updates"
                    ? `${tab.label} (${badgeCount})`
                    : tab.label;

              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-testid={`plugin-tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                    selected
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>{tabText}</span>
                  {tab.id === "all" || tab.id === "available" ? (
                    <span className="text-[11px] opacity-75">{badgeCount}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Instant Search with One-Click Clear */}
          <div className="relative w-full lg:max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              nativeInput
              size="sm"
              aria-label="搜索插件"
              data-testid="plugin-search-input"
              className="pl-8 pr-8"
              placeholder="搜索插件名称、包名、权限或能力…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && searchQuery.length > 0) {
                  setSearchQuery("");
                }
              }}
            />
            {searchQuery.length > 0 ? (
              <button
                type="button"
                aria-label="清空搜索"
                data-testid="plugin-search-clear"
                onClick={() => setSearchQuery("")}
                className="absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <XIcon className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Secondary Category Chips */}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="插件分类筛选">
          {PLUGIN_CATEGORY_CHIPS.map((chip) => {
            const active = activeCategory === chip.id;
            const chipCount = counts.byCategory[chip.id];
            return (
              <button
                key={chip.id}
                type="button"
                aria-pressed={active}
                data-testid={`plugin-category-${chip.id}`}
                onClick={() =>
                  setActiveCategory((current) =>
                    chip.id !== "all" && current === chip.id ? "all" : chip.id,
                  )
                }
                className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                  active
                    ? "border-primary/60 bg-primary/15 text-foreground"
                    : "border-border/70 bg-transparent text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                <span>{chip.label}</span>
                <span className="text-[11px] opacity-75">{chipCount}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Featured Recommendations */}
      {featuredPlugins.length > 0 ? (
        <section
          className="space-y-3 rounded-xl border border-border/80 bg-muted/15 p-4"
          data-testid="plugin-featured-section"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <SparklesIcon className="size-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">精选推荐</h3>
              <Badge variant="outline" size="sm">
                全部默认零预装 · 按需验签启用
              </Badge>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {featuredPlugins.map((plugin) => (
              <div
                key={`featured-${plugin.id}`}
                className="flex flex-col justify-between gap-2.5 rounded-xl border border-border/70 bg-card/85 p-3.5"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-foreground">
                      {plugin.title}
                    </span>
                    <Badge variant="secondary" size="sm">
                      {CATEGORY_LABELS[plugin.category]}
                    </Badge>
                  </div>
                  <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                    {plugin.description}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <Button size="xs" variant="ghost" onClick={() => handleOpenDetail(plugin)}>
                    查看详情
                  </Button>
                  {plugin.installed ? (
                    <Badge variant="success" size="sm">
                      已安装 v{plugin.installedVersion ?? plugin.version}
                    </Badge>
                  ) : (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busyKey !== null}
                      onClick={() => {
                        void executeOfficialInstallOrUpgrade(plugin, "install", false);
                      }}
                    >
                      <DownloadIcon className="size-3" />
                      安装
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Official Certified Group */}
      {loading && allPlugins.length === 0 ? (
        <div className="rounded-xl border border-border/70 bg-muted/15 px-4 py-8 text-center text-xs text-muted-foreground">
          正在从 Prismux Daemon 读取插件目录与运行态…
        </div>
      ) : (
        <>
          {renderGroupSection({
            groupKey: "official",
            id: "prismux-plugins-official",
            title: "官方认证插件目录",
            subtitle:
              "实时读取 plugins-official/catalog/official.json，支持 GitHub / Gitee Release 与 npm 镜像多源自动回退，严格校验 SHA-256 与顶层 engines.prismux 版本范围。",
            visibility: officialVisibility,
            emptyText:
              activeTab === "updates"
                ? "当前所有已安装官方插件均为最新版本。"
                : "当前筛选条件下没有匹配的官方插件。",
          })}

          {/* Restrained read-only notice for retired official plugins (pet / ssh) */}
          {retiredPlugins.length > 0 ? (
            <section
              id="prismux-plugins-retired"
              data-testid="plugin-retired-section"
              className="space-y-2.5 rounded-xl border border-border/60 bg-muted/20 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <InfoIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-xs font-semibold text-muted-foreground">已停用插件说明</h3>
                <Badge variant="outline" size="sm">
                  仅作历史说明 · 不可安装
                </Badge>
              </div>
              <ul className="grid list-none grid-cols-1 gap-2.5 sm:grid-cols-2">
                {retiredPlugins.map((retired) => (
                  <li
                    key={`retired-${retired.id}`}
                    data-testid={`plugin-retired-${retired.id}`}
                    className="flex flex-col gap-1.5 rounded-lg border border-border/50 bg-background/40 px-3.5 py-2.5 opacity-80"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-xs font-medium text-foreground/80">
                          {retired.titleZh}
                        </span>
                        <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {retired.packageName}
                        </code>
                      </div>
                      <Badge variant="secondary" size="sm">
                        已停用
                      </Badge>
                    </div>
                    <p className="text-xs font-medium text-muted-foreground">{retired.noticeZh}</p>
                    {retired.detailZh ? (
                      <p className="text-[11px] leading-relaxed text-muted-foreground/85">
                        {retired.detailZh}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {communityGroupItems.length > 0 ? (
            renderGroupSection({
              groupKey: "community",
              id: "prismux-plugins-community-installed",
              title: "社区与扩展插件",
              subtitle:
                "通过免 Git 流式 npm 安装器引入的第三方扩展，全部受 distribution: managed 单写锁与独立 0600 凭据保护。",
              visibility: communityVisibility,
              emptyText: "当前筛选条件下没有匹配的社区插件。",
            })
          ) : null}
        </>
      )}

      {/* Community npm Streaming Tarball Import */}
      <section
        id="prismux-plugins-community"
        className="space-y-3 rounded-xl border border-border/80 bg-card/70 p-4"
      >
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">社区 npm 插件流式导入</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            直接通过 HTTPS 从 npm Registry 拉取 .tgz 并校验解包：完全不调用本机 git，强制禁用 preinstall / install / postinstall 生命周期脚本，自动写入 distribution: managed 托管锁。
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            nativeInput
            size="sm"
            aria-label="npm 包名或 Tarball 地址"
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
          <input
            ref={localFileInputRef}
            type="file"
            accept=".wb-plugin,.tgz,.tar.gz"
            aria-label="选择本地 .wb-plugin 插件归档"
            data-testid="plugin-local-archive-input"
            className="hidden"
            onChange={(event) => {
              void handleLocalArchiveFileChange(event);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            data-testid="plugin-local-archive-btn"
            disabled={busyKey !== null}
            onClick={() => {
              localFileInputRef.current?.click();
            }}
          >
            <UploadIcon className="size-3.5" />
            {busyKey === "install:local" ? "导入中…" : "导入本地 .wb-plugin"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <LockIcon className="size-3.5 text-muted-foreground" />
          <span>安全契约：</span>
          <Badge variant="outline">免 Git 依赖</Badge>
          <Badge variant="outline">禁用安装脚本</Badge>
          <Badge variant="outline">顶层 SemVer 强制校验</Badge>
          <Badge variant="outline">modelVisible 强制审计</Badge>
        </div>
      </section>

      {/* Screen-reader live result announcement when narrowed (aligned with stablyai/orca PluginManager). */}
      <p className="sr-only" aria-live="polite">
        {isFiltering ? `已筛选出 ${filteredPlugins.length} 个匹配插件` : ""}
      </p>

      {/* Plugin Detail Drawer */}
      <PluginDetailDrawer
        plugin={selectedPlugin}
        logs={selectedPlugin ? (logsByPlugin[selectedPlugin.id] ?? []) : []}
        loadingLogs={selectedPlugin !== null && loadingLogsFor === selectedPlugin.id}
        busyKey={busyKey}
        suspendEscape={Boolean(pendingAudit || pendingRollbackPlugin)}
        onClose={() => setSelectedPluginId(null)}
        onInstallOrUpgrade={(plugin, operation) => {
          void executeOfficialInstallOrUpgrade(plugin, operation, false);
        }}
        onToggle={(pluginId, enabled) => {
          void handleTogglePlugin(pluginId, enabled);
        }}
        onRollback={(plugin) => {
          setRollbackError(null);
          setPendingRollbackPlugin(plugin);
        }}
        onUninstall={(pluginId) => {
          void handleUninstallPlugin(pluginId);
        }}
        onRefreshLogs={(pluginId) => {
          void fetchPluginLogs(pluginId);
        }}
        onClearLogs={(pluginId) => {
          setLogsByPlugin((prev) => ({ ...prev, [pluginId]: [] }));
        }}
        onDeclarativeAction={handleDeclarativeAction}
        onDeclarativeAtomChange={handleDeclarativeAtomChange}
      />

      {/* Dedicated Rollback Confirmation Dialog (Cancel holds initial focus) */}
      <PluginRollbackDialog
        plugin={pendingRollbackPlugin}
        busy={
          pendingRollbackPlugin !== null && busyKey === `rollback:${pendingRollbackPlugin.id}`
        }
        error={rollbackError}
        onCancel={() => {
          setRollbackError(null);
          setPendingRollbackPlugin(null);
        }}
        onConfirm={handleRollbackPlugin}
      />

      {/* Pre-install / Pre-upgrade Trust Audit Modal */}
      <PluginTrustAuditModal
        audit={pendingAudit}
        busy={busyKey !== null}
        error={auditError}
        onConfirm={handleConfirmPendingAudit}
        onCancel={() => {
          setAuditError(null);
          setPendingAudit(null);
        }}
      />
    </div>
  );
}
