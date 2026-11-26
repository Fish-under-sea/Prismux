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
  LockIcon,
  PackageIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";

import { SETTINGS_CONTROL_LG, SettingsSection } from "../../../components/settings/settingsLayout";
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
import { Toggle, ToggleGroup } from "../../../components/ui/toggle-group";
import { cn } from "../../../lib/utils";
import { requestDiagnosticsRefresh } from "../prismuxDiagnostics.logic";
import { PluginCreatorGuideModal } from "./PluginCreatorGuideModal";
import { PluginDetailDrawer } from "./PluginDetailDrawer";
import { PluginRollbackDialog } from "./PluginRollbackDialog";
import { PluginTrustAuditModal } from "./PluginTrustAuditModal";
import {
  CATEGORY_LABELS,
  DEFAULT_GROUP_DISPLAY_LIMIT,
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
  /** Kept for caller compatibility; retired plugins are enforced in backend/catalog without cluttering UI. */
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

export type PluginRegistryOverrideValue = "auto" | "npmmirror" | "npmjs";

export function pluginRegistryOverrideToNetworkPreference(
  override: PluginRegistryOverrideValue,
): "auto" | "domestic" | "global" {
  if (override === "npmmirror") return "domestic";
  if (override === "npmjs") return "global";
  return "auto";
}

export function parsePluginRegistryOverrideFromUpdaterStatus(
  payload: unknown,
): PluginRegistryOverrideValue {
  if (typeof payload !== "object" || payload === null) return "auto";
  const policy = (payload as Record<string, unknown>).policy;
  if (typeof policy !== "object" || policy === null) return "auto";
  const raw = (policy as Record<string, unknown>).pluginRegistryOverride;
  if (raw === "npmmirror" || raw === "npmjs" || raw === "auto") {
    return raw;
  }
  return "auto";
}

const REGISTRY_OVERRIDE_LABELS: Readonly<Record<PluginRegistryOverrideValue, string>> = {
  auto: "智能测速（自动切换）",
  npmmirror: "国内镜像（npmmirror）",
  npmjs: "国际官方（npmjs）",
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
  skipInitialFetch = false,
  groupDisplayLimit = DEFAULT_GROUP_DISPLAY_LIMIT,
}: PrismuxPluginCenterViewProps) {
  const [catalogRaw, setCatalogRaw] = useState<OfficialCatalogPluginRaw[]>(() =>
    initialCatalog ? [...initialCatalog] : [],
  );
  const [installedRaw, setInstalledRaw] = useState<InstalledPluginRaw[]>(() =>
    initialInstalled ? [...initialInstalled] : [],
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

  // Community npm, local archive import & creator guide state (single source of truth in Daemon policy)
  const [npmInput, setNpmInput] = useState("");
  const [registryOverride, setRegistryOverride] = useState<PluginRegistryOverrideValue>("auto");
  const [savingRegistry, setSavingRegistry] = useState(false);
  const [creatorGuideOpen, setCreatorGuideOpen] = useState(false);
  const localFileInputRef = useRef<HTMLInputElement>(null);
  const networkPreference = pluginRegistryOverrideToNetworkPreference(registryOverride);

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
      const [catalogRes, installedRes, updaterRes] = await Promise.all([
        daemon.requestJson<unknown>("/v1/plugins/catalog"),
        daemon.requestJson<unknown>("/v1/plugins/installed"),
        daemon.requestJson<unknown>("/v1/updater/status").catch(() => null),
      ]);
      setCatalogRaw(parseCatalogPluginsPayload(catalogRes));
      setInstalledRaw(parseInstalledPluginsPayload(installedRes));
      if (updaterRes !== null) {
        setRegistryOverride(parsePluginRegistryOverrideFromUpdaterStatus(updaterRes));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [daemon]);

  const handleRegistryOverrideChange = useCallback(
    async (next: PluginRegistryOverrideValue) => {
      setRegistryOverride(next);
      setSavingRegistry(true);
      setErrorMsg(null);
      try {
        await daemon.requestJson<unknown>("/v1/updater/policy", {
          method: "POST",
          body: JSON.stringify({ pluginRegistryOverride: next }),
        });
        setStatusMsg(`插件下载源已切换为「${REGISTRY_OVERRIDE_LABELS[next]}」。`);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingRegistry(false);
      }
    },
    [daemon],
  );

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

  // Only surface categories that actually contain plugins (`count > 0`), and hide the
  // redundant secondary category strip completely when <= 1 category exists.
  const visibleCategoryChips = useMemo(() => {
    const populated = PLUGIN_CATEGORY_CHIPS.filter(
      (chip) => chip.id !== "all" && counts.byCategory[chip.id] > 0,
    );
    if (populated.length < 2) {
      return [];
    }
    const allChip = PLUGIN_CATEGORY_CHIPS.find((chip) => chip.id === "all");
    return allChip ? [allChip, ...populated] : populated;
  }, [counts.byCategory]);

  useEffect(() => {
    if (activeCategory !== "all" && counts.byCategory[activeCategory] === 0) {
      setActiveCategory("all");
    }
  }, [activeCategory, counts.byCategory]);

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
            [pluginId]: [
              ...remoteEntries,
              ...(prev[pluginId] ?? []).filter((e) => e.id.startsWith("local-")),
            ].slice(0, 120),
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
          `已校验并${verb}官方插件 ${plugin.packageName}@${plugin.latestVersion}。`,
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
    [
      appendPluginLog,
      daemon,
      daemonReady,
      loadAll,
      networkPreference,
      recordPreviousVersion,
      skipInitialFetch,
    ],
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
          `已安全导入本地扩展 ${installedId}${installedVer ? `@${installedVer}` : ""}。`,
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
        setStatusMsg(`插件 ${pluginId} 已安全卸载，不留残留。`);
        appendPluginLog(
          pluginId,
          "info",
          "cordis-host",
          "已安全卸载，全部监听、面板、路由与订阅已清理。",
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
        className="group/plugin-card relative flex h-full flex-col justify-between gap-4 rounded-xl border border-border/60 bg-foreground/[0.025] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-all duration-150 hover:border-primary/45 hover:bg-foreground/[0.045] has-[[data-plugin-row-name]:focus-visible]:ring-2 has-[[data-plugin-row-name]:focus-visible]:ring-ring dark:bg-white/[0.035] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] dark:hover:bg-white/[0.055]"
      >
        <div className="space-y-3">
          {/* Card Top: Icon + Title + Version + Status */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span
                aria-hidden="true"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary"
              >
                <PackageIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <h4
                  className="truncate text-sm font-semibold text-foreground"
                  title={plugin.title}
                >
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
                <div className="flex flex-wrap items-center gap-1.5">
                  <code className="rounded bg-foreground/[0.055] px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground dark:bg-white/[0.07]">
                    v{plugin.installedVersion ?? plugin.version}
                  </code>
                  {plugin.hasUpdate ? (
                    <Badge variant="info" size="sm" className="tabular-nums">
                      可升至 v{plugin.latestVersion}
                    </Badge>
                  ) : null}
                  {visibleCategoryChips.length > 0 ? (
                    <Badge variant="secondary" size="sm">
                      {CATEGORY_LABELS[plugin.category]}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>

            {plugin.installed ? (
              <Badge
                variant={plugin.mounted ? "success" : "secondary"}
                size="sm"
                className="shrink-0"
              >
                {plugin.mounted ? "已挂载" : plugin.enabled ? "已安装" : "已停用"}
              </Badge>
            ) : (
              <Badge variant="outline" size="sm" className="shrink-0">
                未预装
              </Badge>
            )}
          </div>

          {/* Concise Summary */}
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {plugin.description || "暂无说明"}
          </p>

          {/* Restrained Trust & Capability Tags */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={plugin.source === "official" ? "success" : "info"} size="sm">
              {plugin.source === "official" ? "官方认证" : "社区 npm"}
            </Badge>
            <Badge variant={plugin.modelVisible ? "warning" : "outline"} size="sm">
              {plugin.modelVisible ? "影响 AI 行为 · 需确认" : "纯界面扩展"}
            </Badge>
            {plugin.declarativeUi ? (
              <Badge variant="outline" size="sm">
                声明式 UI
              </Badge>
            ) : null}
          </div>
        </div>

        {/* Unified Bottom Action Bar */}
        <div className="space-y-2.5 border-t border-border/50 pt-3">
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate font-mono">{plugin.packageName}</span>
            <span className="shrink-0 tabular-nums">{formatBytes(plugin.bytes)}</span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors group-hover/plugin-card:text-foreground">
              <EyeIcon className="size-3.5" aria-hidden="true" />
              详情
            </span>

            {/* Sibling action slot lifted above stretched card link */}
            <div className="relative z-10 ml-auto flex items-center justify-end gap-2">
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
    showToolbar?: boolean;
  }) => {
    const isExpanded = Boolean(expandedGroups[params.groupKey]);
    const canToggleExpand =
      !isFiltering &&
      (params.visibility.isTruncated ||
        (isExpanded && params.visibility.totalCount > groupDisplayLimit));

    return (
      <SettingsSection
        id={params.id}
        title={params.title}
        icon={<PackageIcon className="size-4 text-primary" aria-hidden="true" />}
        headerAction={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="tabular-nums">
              {params.visibility.totalCount} 项
            </Badge>
            {!isFiltering && params.visibility.isTruncated ? (
              <span className="text-xs tabular-nums text-muted-foreground">
                已展示 {params.visibility.visible.length} / {params.visibility.totalCount}
              </span>
            ) : null}
            {!isFiltering && params.visibility.pinnedInstalledCount > 0 ? (
              <Badge variant="info" size="sm" className="tabular-nums">
                已安装 {params.visibility.pinnedInstalledCount}
              </Badge>
            ) : null}
          </div>
        }
        data-testid={`plugin-group-${params.groupKey}`}
      >
        <div className="space-y-4 p-4">
          {/* Streamlined Single-Row Filter Bar (Segmented Status + Compact Search + Refresh) */}
          {params.showToolbar ? (
            <div className="space-y-2.5">
              <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
                <ToggleGroup
                  variant="segmented"
                  aria-label="插件状态筛选"
                  value={[activeTab]}
                  onValueChange={(next) => {
                    const selected = next[0];
                    if (
                      selected === "all" ||
                      selected === "installed" ||
                      selected === "available" ||
                      selected === "updates"
                    ) {
                      setActiveTab(selected);
                    }
                  }}
                >
                  {PLUGIN_STATUS_TABS.map((tab) => {
                    const badgeCount =
                      tab.id === "all"
                        ? counts.all
                        : tab.id === "installed"
                          ? counts.installed
                          : tab.id === "available"
                            ? counts.available
                            : counts.updates;
                    const labelText =
                      tab.id === "installed" || tab.id === "updates"
                        ? `${tab.label} (${badgeCount})`
                        : `${tab.label} ${badgeCount}`;
                    return (
                      <Toggle
                        key={tab.id}
                        value={tab.id}
                        data-testid={`plugin-tab-${tab.id}`}
                        className="tabular-nums"
                      >
                        {labelText}
                      </Toggle>
                    );
                  })}
                </ToggleGroup>

                <div className="flex items-center gap-2 lg:w-full lg:max-w-xs">
                  <div className="relative flex-1">
                    <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      nativeInput
                      size="sm"
                      aria-label="搜索插件"
                      data-testid="plugin-search-input"
                      className="pl-8 pr-7"
                      placeholder="搜索名称、包名或能力…"
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
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label="刷新插件目录"
                    title="刷新插件目录"
                    disabled={loading}
                    onClick={() => {
                      void loadAll();
                    }}
                  >
                    <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
                  </Button>
                </div>
              </div>

              {/* Dynamic Non-Zero Category Chips (hidden when <= 1 category exists; zero empty "0" badges) */}
              {visibleCategoryChips.length > 0 ? (
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  role="group"
                  aria-label="插件分类筛选"
                >
                  {visibleCategoryChips.map((chip) => {
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
                        className={cn(
                          "inline-flex h-6.5 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                          active
                            ? "border-primary/55 bg-primary/15 text-foreground"
                            : "border-border/60 bg-transparent text-muted-foreground hover:border-border hover:text-foreground",
                        )}
                      >
                        <span>{chip.label}</span>
                        <span className="text-[10.5px] opacity-75">{chipCount}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          <p className="text-xs leading-relaxed text-muted-foreground">{params.subtitle}</p>

          {loading && allPlugins.length === 0 ? (
            <div className="rounded-xl border border-border/50 bg-foreground/[0.02] px-4 py-8 text-center text-xs text-muted-foreground dark:bg-white/[0.025]">
              正在从 Prismux Daemon 读取插件目录与运行态…
            </div>
          ) : params.visibility.visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border/60 bg-foreground/[0.02] px-4 py-7 text-center text-xs text-muted-foreground dark:bg-white/[0.025]">
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
            <ul className="grid list-none grid-cols-1 gap-3.5 md:grid-cols-2">
              {params.visibility.visible.map(renderPluginCard)}
            </ul>
          )}

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
        </div>
      </SettingsSection>
    );
  };

  return (
    <div className="space-y-6" data-testid="prismux-plugin-center">
      {/* Compact Zero-Preinstall Status Banner (<= 2 header badges, denoised copy) */}
      <div
        id="prismux-plugins"
        className="rounded-xl border border-border/60 bg-card/40 px-4 py-3.5 shadow-xs/5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-foreground">
                官方插件默认零预装声明
              </h3>
              <Badge variant="info" size="sm">
                按需安装
              </Badge>
              <Badge variant={daemonReady ? "success" : "warning"} size="sm">
                {daemonReady ? "服务在线" : "服务未连接"}
              </Badge>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              官方独立插件{" "}
              <code className="rounded bg-foreground/[0.06] px-1 py-0.5 font-mono text-[11px] text-foreground dark:bg-white/[0.08]">
                qq
              </code>{" "}
              默认不预装，按需安装并支持随时无残留卸载。
            </p>
          </div>
        </div>
      </div>

      {/* Inline status / error banners */}
      {errorMsg ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive"
        >
          <AlertTriangleIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 break-all">{errorMsg}</span>
        </div>
      ) : null}

      {statusMsg ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-xl border border-success/35 bg-success/10 px-3.5 py-2.5 text-xs text-success-foreground"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{statusMsg}</span>
        </div>
      ) : null}

      {/* Official Certified Catalog */}
      {renderGroupSection({
        groupKey: "official",
        id: "prismux-plugins-official",
        title: "官方认证插件目录",
        subtitle: "经过官方校验的精选扩展，支持一键按需安装与升级。",
        visibility: officialVisibility,
        emptyText:
          activeTab === "updates"
            ? "当前所有已安装官方插件均为最新版本。"
            : "当前筛选条件下没有匹配的官方插件。",
        showToolbar: true,
      })}

      {/* Community Installed Group (shown only when community plugins exist) */}
      {communityGroupItems.length > 0
        ? renderGroupSection({
            groupKey: "community",
            id: "prismux-plugins-community-installed",
            title: "社区与扩展插件",
            subtitle: "已安装的第三方扩展，由插件中心统一管理并隔离凭据。",
            visibility: communityVisibility,
            emptyText: "当前筛选条件下没有匹配的社区插件。",
          })
        : null}

      {/* Community npm Import & Single-Source npm Registry Selector */}
      <SettingsSection
        id="prismux-plugins-community"
        title="社区 npm 插件流式导入"
        icon={<DownloadIcon className="size-4 text-primary" aria-hidden="true" />}
        headerAction={
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid="plugin-creator-guide-btn"
            className="border-primary/45 bg-primary/10 text-foreground hover:border-primary/70 hover:bg-primary/18"
            onClick={() => setCreatorGuideOpen(true)}
          >
            <SparklesIcon className="size-3.5 text-primary" aria-hidden="true" />
            创作指引
          </Button>
        }
      >
        <div className="space-y-3.5 p-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            输入 npm 包名或导入本地扩展包，安装全程不依赖本地 Git 且自动禁用安装脚本。
          </p>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              nativeInput
              size="sm"
              aria-label="npm 包名或 Tarball 地址"
              className="flex-1 font-mono"
              placeholder="例如：prismux-plugin-notion 或 .tgz 地址"
              value={npmInput}
              onChange={(event) => setNpmInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void executeNpmInstall(npmInput, networkPreference, false);
                }
              }}
            />
            <div className={`${SETTINGS_CONTROL_LG} max-w-full shrink-0`}>
              <Select
                value={registryOverride}
                disabled={savingRegistry}
                onValueChange={(val) => {
                  if (val === "auto" || val === "npmmirror" || val === "npmjs") {
                    void handleRegistryOverrideChange(val);
                  }
                }}
              >
                <SelectTrigger size="sm" aria-label="插件 npm 镜像源" data-testid="plugin-registry-select">
                  <SelectValue>{REGISTRY_OVERRIDE_LABELS[registryOverride]}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="auto">{REGISTRY_OVERRIDE_LABELS.auto}</SelectItem>
                  <SelectItem value="npmmirror">{REGISTRY_OVERRIDE_LABELS.npmmirror}</SelectItem>
                  <SelectItem value="npmjs">{REGISTRY_OVERRIDE_LABELS.npmjs}</SelectItem>
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
              {busyKey === "install:npm" ? "安装中…" : "安装插件"}
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

          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
            <LockIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>安全保护：</span>
            <Badge variant="outline" size="sm">
              免 Git 依赖
            </Badge>
            <Badge variant="outline" size="sm">
              禁用安装脚本
            </Badge>
            <Badge variant="outline" size="sm">
              版本兼容校验
            </Badge>
            <Badge variant="outline" size="sm">
              敏感权限二次确认
            </Badge>
          </div>
        </div>
      </SettingsSection>

      {/* Screen-reader live result announcement when narrowed */}
      <p className="sr-only" aria-live="polite">
        {isFiltering ? `已筛选出 ${filteredPlugins.length} 个匹配插件` : ""}
      </p>

      {/* Plugin Creator Guide Modal (Official Docs + Coding Agent Prompt Generator) */}
      <PluginCreatorGuideModal
        open={creatorGuideOpen}
        onClose={() => setCreatorGuideOpen(false)}
      />

      {/* Plugin Detail Drawer */}
      <PluginDetailDrawer
        plugin={selectedPlugin}
        logs={selectedPlugin ? (logsByPlugin[selectedPlugin.id] ?? []) : []}
        loadingLogs={selectedPlugin !== null && loadingLogsFor === selectedPlugin.id}
        busyKey={busyKey}
        suspendEscape={Boolean(pendingAudit || pendingRollbackPlugin || creatorGuideOpen)}
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
