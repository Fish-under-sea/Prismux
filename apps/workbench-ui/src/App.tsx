import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BRAND,
  CHIEF_PROVIDER_KINDS,
  DEFAULT_UPDATE_POLICY,
  DIAL_MODES,
  DIAL_MODE_DESCRIPTIONS,
  type ChiefProviderKind,
  type DialMode,
  type LayoutPresetId,
  type OfficialPluginCatalogEntry,
  type ReasoningModelProfile,
  type UpdatePolicyConfig,
  type UsageLedgerSummary
} from "@prismux/protocol";
import {
  ApprovalGuidePanel,
  type PendingApprovalItem
} from "./components/ApprovalGuidePanel.js";
import { FirstRunWizard, type FirstRunWizardConfig } from "./components/FirstRunWizard.js";
import { FloatingCapsules } from "./components/FloatingCapsules.js";
import {
  NavAndCommandOrder,
  SlashCommandPalette
} from "./components/NavAndCommandOrder.js";
import { PluginMarketModal } from "./components/PluginMarketModal.js";
import { ReasoningEffortCard } from "./components/ReasoningEffortCard.js";
import { SplitWorkspace } from "./components/SplitWorkspace.js";
import { ThemeBackgroundPanel } from "./components/ThemeBackgroundPanel.js";
import { UpdateCenterPanel } from "./components/UpdateCenterPanel.js";
import { UsageLedgerBar } from "./components/UsageLedgerBar.js";
import { WallpaperViewport } from "./components/WallpaperViewport.js";
import {
  PRESET_TREES,
  resizeSplit,
  WORKBENCH_PANE_TITLES,
  type SplitNode,
  type WorkbenchPaneId
} from "./layout/splitTree.js";
import {
  EmptyContinueSubmissionLatch,
  type SubmissionIntent
} from "./logic/emptyInputContinue.js";
import {
  createDefaultNavAndCommandState,
  getVisibleSidebarItems,
  type NavAndCommandSyncPayload,
  type SlashCommandItem
} from "./logic/navAndCommandStore.js";
import {
  APP_CURRENT_VERSION,
  DEFAULT_OFFICIAL_PLUGIN_CATALOG,
  type CommunityAuditDraft,
  type MarketInstalledPlugin
} from "./logic/pluginMarketCatalog.js";
import {
  extractVisibilityPayload,
  getTauriRuntime,
  invokeTauriCommandSafe,
  resolveVisibilityOcclusion,
  type VisibilitySignalPayload
} from "./logic/visibilityBridge.js";
import { WORKBENCH_COMPONENTS_CSS } from "./logic/workbenchStyles.js";
import {
  applyAppearanceToDocument,
  DEFAULT_APPEARANCE_STATE,
  installPrismuxThemeBridge,
  parseWbThemeImport,
  sanitizeWbThemeForExport,
  subscribeFishDockThemeBridge,
  type PrismuxAppearanceState,
  type WallpaperCatalogItem,
  type WbThemeBundle
} from "./theme/themeEngine.js";

const PROVIDER_DISPLAY_NAMES: Record<ChiefProviderKind, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  acp: "ACP"
};

const INITIAL_WALLPAPERS: WallpaperCatalogItem[] = [
  {
    id: "builtin-aurora-prism",
    title: "WebWallGL · 极光棱镜流体",
    sourceType: "scene",
    sourcePath: "aurora-prism",
    previewLabel: "内置 WebGL2 实时着色器（0 Token）",
    tags: ["WebWallGL", "内置"]
  },
  {
    id: "builtin-midnight-tide",
    title: "WebWallGL · 午夜深海星轨",
    sourceType: "scene",
    sourcePath: "midnight-tide",
    previewLabel: "深邃暗色折射场",
    tags: ["WebWallGL", "深海"]
  },
  {
    id: "builtin-quiet-none",
    title: "纯色静态底座（关闭动态壁纸）",
    sourceType: "none",
    previewLabel: "零 GPU 壁纸开销",
    tags: ["节能"]
  }
];

const INITIAL_APPROVALS: PendingApprovalItem[] = [
  {
    requestId: "req-demo-01",
    threadId: "chief",
    createdAt: Date.now(),
    status: "pending",
    card: {
      toolName: "run_command",
      actionSummary: "准备在隔离 Worktree 中执行高危 Git 硬重置检查脚本",
      riskLevel: "high",
      triggerReason:
        "命中高危规则：检测到 git reset --hard 指令，可能丢弃未暂存的工作树修改",
      rawCommandOrTarget: "git -C .work/worktree-1122 reset --hard HEAD~1"
    }
  },
  {
    requestId: "req-demo-02",
    threadId: "chief",
    createdAt: Date.now() - 12_000,
    status: "pending",
    card: {
      toolName: "write_file",
      actionSummary: "准备更新工作区夜间工场配置模板",
      riskLevel: "medium",
      triggerReason: "命中中危文件写入规则：在 supervised 权限模式下需人类确认放行",
      rawCommandOrTarget: "apps/daemon/src/workflows/OvernightFactory.ts"
    }
  }
];

const INITIAL_USAGE_ENTRIES: UsageLedgerSummary[] = [
  {
    machineId: "fish-win11-primary",
    providerId: "claude-code",
    todayTokens: 48_250,
    weekTokens: 312_400,
    quotaUsedRatio: 0.34,
    estimatedCostUsd: 1.42
  },
  {
    machineId: "fish-win11-primary",
    providerId: "deepseek",
    todayTokens: 29_100,
    weekTokens: 164_800,
    quotaUsedRatio: 0.19,
    estimatedCostUsd: 0.18
  }
];

interface ChatTranscriptEntry {
  id: string;
  role: "user" | "chief" | "system";
  content: string;
  timestamp: string;
}

export interface WorkbenchAppProps {
  initialAppearance?: PrismuxAppearanceState;
  initialWizardOpen?: boolean;
}

function getPresetSplitTree(preset: LayoutPresetId): SplitNode {
  const base = PRESET_TREES[preset];
  if (preset === "multi-agent-coding") {
    return resizeSplit(base, "split-right-stack", 0.46);
  }
  return base;
}

export const App: React.FC<WorkbenchAppProps> = ({
  initialAppearance = DEFAULT_APPEARANCE_STATE,
  initialWizardOpen = false
}) => {
  const [appearance, setAppearance] =
    useState<PrismuxAppearanceState>(initialAppearance);
  const [splitRoot, setSplitRoot] = useState<SplitNode>(
    () => getPresetSplitTree(initialAppearance.layoutPreset)
  );

  const [chiefProvider, setChiefProvider] =
    useState<ChiefProviderKind>("claude-code");
  const [dialMode, setDialMode] = useState<DialMode>("agent");
  const [reasoningProfile, setReasoningProfile] = useState<ReasoningModelProfile>({
    providerId: "deepseek",
    modelId: "deepseek-r1",
    effort: "high",
    tokenBudget: 16384,
    supportsMultimodal: false,
    multimodalEnabled: false
  });

  const [navState, setNavState] = useState<NavAndCommandSyncPayload>(() =>
    createDefaultNavAndCommandState()
  );
  const [approvals, setApprovals] =
    useState<PendingApprovalItem[]>(INITIAL_APPROVALS);
  const [installedPlugins, setInstalledPlugins] = useState<MarketInstalledPlugin[]>(
    []
  );
  const [wallpapers, setWallpapers] =
    useState<WallpaperCatalogItem[]>(INITIAL_WALLPAPERS);
  const [usageEntries] = useState<UsageLedgerSummary[]>(INITIAL_USAGE_ENTRIES);

  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"theme" | "nav" | "updater">("theme");
  const [updateCenterOpen, setUpdateCenterOpen] = useState(false);
  const [updatePolicy, setUpdatePolicy] = useState<UpdatePolicyConfig>(() => ({
    ...DEFAULT_UPDATE_POLICY
  }));
  const [marketOpen, setMarketOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(initialWizardOpen);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [standbyChatOpen, setStandbyChatOpen] = useState(false);
  const [rightPaneSubTab, setRightPaneSubTab] = useState<"approvals" | "reasoning">(
    "approvals"
  );
  const [scratchAdopted, setScratchAdopted] = useState(false);
  const [themeBanner, setThemeBanner] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [exportedThemePreview, setExportedThemePreview] = useState<string | null>(
    null
  );

  const [chatLog, setChatLog] = useState<ChatTranscriptEntry[]>([
    {
      id: "msg-1",
      role: "system",
      content:
        "主秘书槽位已就绪（Chief Thread Slot）；视觉层严格保持对大模型 0 Token 开销。",
      timestamp: "23:30"
    },
    {
      id: "msg-2",
      role: "chief",
      content:
        "已完成夜间工作树预检。留空输入框直接按 Enter 或点击发送，可单路径幂等续跑当前任务。",
      timestamp: "23:34"
    }
  ]);

  const [documentHidden, setDocumentHidden] = useState<boolean>(() =>
    typeof document !== "undefined" ? document.hidden : false
  );
  const [visibilitySignal, setVisibilitySignal] =
    useState<VisibilitySignalPayload | null>(null);
  const [audioBands, setAudioBands] = useState<number[]>([]);

  const submitLatchRef = useRef<EmptyContinueSubmissionLatch | null>(null);
  if (submitLatchRef.current === null) {
    submitLatchRef.current = new EmptyContinueSubmissionLatch();
  }
  const paletteTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Sync Prismux appearance to document root attributes & CSS custom properties
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;
  const listenersRef = useRef(new Set<(s: PrismuxAppearanceState) => void>());

  useEffect(() => {
    applyAppearanceToDocument(appearance, document);
    for (const listener of listenersRef.current) {
      listener(appearance);
    }
  }, [appearance]);

  // Install window.prismux theme & glass JS bridge
  useEffect(() => {
    return installPrismuxThemeBridge(
      () => appearanceRef.current,
      (cb) => {
        listenersRef.current.add(cb);
        return () => {
          listenersRef.current.delete(cb);
        };
      }
    );
  }, []);

  // Optional FISH-Dock theme bridge subscription
  useEffect(() => {
    if (!appearance.glass.followFishDockTheme) {
      return;
    }
    return subscribeFishDockThemeBridge((partial) => {
      setAppearance((prev) => ({
        ...prev,
        ...partial,
        glass: partial.glass ? { ...prev.glass, ...partial.glass } : prev.glass,
        typography: partial.typography
          ? { ...prev.typography, ...partial.typography }
          : prev.typography
      }));
    });
  }, [appearance.glass.followFishDockTheme]);

  // Visibility & 0 FPS Occlusion listeners (document + custom event + Tauri native event)
  useEffect(() => {
    const onVisibilityChange = (): void => {
      setDocumentHidden(document.hidden);
    };
    const onCustomVisibility = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail;
      const parsed = extractVisibilityPayload(detail);
      if (parsed) {
        setVisibilitySignal(parsed);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("prismux:visibility", onCustomVisibility);

    let unlistenTauri: (() => void) | null = null;
    const tauri = getTauriRuntime();
    if (tauri?.event?.listen) {
      void tauri.event
        .listen("prismux://visibility", (ev) => {
          const parsed = extractVisibilityPayload(ev.payload);
          if (parsed) {
            setVisibilitySignal(parsed);
          }
        })
        .then((unlisten) => {
          unlistenTauri = unlisten;
        })
        .catch(() => {});
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("prismux:visibility", onCustomVisibility);
      unlistenTauri?.();
    };
  }, []);

  const effectiveOccluded = resolveVisibilityOcclusion({
    documentHidden,
    pauseWhenOccluded: appearance.wallpaper.pauseWhenOccluded,
    signal: visibilitySignal
  });

  // System audio FFT spectrum bridge (silently suspended while occluded)
  useEffect(() => {
    if (!appearance.wallpaper.audioReactive || effectiveOccluded) {
      setAudioBands([]);
      return;
    }
    let active = true;
    const poll = async (): Promise<void> => {
      const res = await invokeTauriCommandSafe<{ bands?: number[] }>(
        "get_audio_spectrum"
      );
      if (active && res && Array.isArray(res.bands)) {
        setAudioBands(res.bands);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 120);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [appearance.wallpaper.audioReactive, effectiveOccluded]);

  // Global keyboard shortcut "/" or Ctrl+K to open command palette when not typing
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const isEditing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable === true;
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !isEditing)) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  const switchLayoutPreset = useCallback((nextPreset: LayoutPresetId) => {
    setAppearance((prev) => ({
      ...prev,
      layoutPreset: nextPreset
    }));
    setSplitRoot(getPresetSplitTree(nextPreset));
    if (nextPreset === "multi-agent-coding") {
      setStandbyChatOpen(false);
    }
  }, []);

  const handleChiefSwitch = useCallback((nextProvider: ChiefProviderKind) => {
    setChiefProvider(nextProvider);
    setChatLog((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}`,
        role: "system",
        content: `主秘书大脑已热切换为 ${PROVIDER_DISPLAY_NAMES[nextProvider]}，上下文槽位保持连续。`,
        timestamp: new Date().toTimeString().slice(0, 5)
      }
    ]);
  }, []);

  const handlePromptSubmit = useCallback(async (intent: SubmissionIntent) => {
    setChatLog((prev) => [
      ...prev,
      {
        id: `msg-u-${Date.now()}`,
        role: "user",
        content: intent.text,
        timestamp: new Date().toTimeString().slice(0, 5)
      },
      {
        id: `msg-a-${Date.now() + 1}`,
        role: "chief",
        content: intent.isAutoContinue
          ? `[${PROVIDER_DISPLAY_NAMES[chiefProvider]} · ${dialMode}] 已接收标准 Continue 指令，继续推进当前主秘书线程。`
          : `[${PROVIDER_DISPLAY_NAMES[chiefProvider]} · ${dialMode}] 已受理指令：「${intent.text}」`,
        timestamp: new Date().toTimeString().slice(0, 5)
      }
    ]);
  }, [chiefProvider, dialMode]);

  const handleApprovalDecision = useCallback(
    (requestId: string, allow: boolean, reason?: string) => {
      setApprovals((prev) =>
        prev.map((item) =>
          item.requestId === requestId
            ? { ...item, status: allow ? "approved" : "rejected" }
            : item
        )
      );
      setChatLog((prev) => [
        ...prev,
        {
          id: `msg-ap-${Date.now()}`,
          role: "system",
          content: `审批单 ${requestId} 已${allow ? "放行执行" : "驳回拦截"}${reason ? `（${reason}）` : ""}`,
          timestamp: new Date().toTimeString().slice(0, 5)
        }
      ]);
    },
    []
  );

  const handleTriggerHandoff = useCallback(() => {
    setChatLog((prev) => [
      ...prev,
      {
        id: `msg-ho-${Date.now()}`,
        role: "system",
        content:
          "已执行 /handoff：提纯 { goal: 'M4 工作台联调', decisions: ['采用 4 区 Fresnel 玻璃'], touchedFiles: ['apps/workbench-ui/src/App.tsx'], openQuestions: [] } 并无缝续跑新线程。",
        timestamp: new Date().toTimeString().slice(0, 5)
      }
    ]);
  }, []);

  const handleExecuteSlashCommand = useCallback(
    (command: SlashCommandItem) => {
      switch (command.command) {
        case "/continue":
          void submitLatchRef.current?.submitOnce("", handlePromptSubmit, {
            trigger: "shortcut",
            threadId: "chief"
          });
          break;
        case "/handoff":
          handleTriggerHandoff();
          break;
        case "/oracle":
          setDialMode("oracle");
          break;
        case "/review":
          setDialMode("review");
          break;
        case "/agent":
          setDialMode("agent");
          break;
        case "/theme":
          setSettingsTab("theme");
          setSettingsDrawerOpen(true);
          break;
        case "/plugins":
          setMarketOpen(true);
          break;
        default:
          setChatLog((prev) => [
            ...prev,
            {
              id: `msg-cmd-${Date.now()}`,
              role: "system",
              content: `已执行斜杠指令 ${command.command}（${command.customTitle ?? command.defaultTitle}）`,
              timestamp: new Date().toTimeString().slice(0, 5)
            }
          ]);
      }
    },
    [handlePromptSubmit, handleTriggerHandoff]
  );

  const handleScanSteam = useCallback(async () => {
    const scanned = await invokeTauriCommandSafe<
      Array<{
        workshopId: string;
        title: string;
        wallpaperType: "scene" | "web" | "video" | "image";
        entryFile?: string;
        tags?: string[];
      }>
    >("scan_steam_wallpapers");

    if (Array.isArray(scanned) && scanned.length > 0) {
      setWallpapers((prev) => {
        const merged = [...prev];
        for (const item of scanned) {
          const id = `steam-${item.workshopId}`;
          if (!merged.some((w) => w.id === id)) {
            merged.push({
              id,
              title: item.title,
              sourceType: item.wallpaperType,
              sourcePath: item.entryFile ?? item.workshopId,
              previewLabel: `Steam 431960 · ${item.workshopId}`,
              tags: item.tags ?? ["Steam 431960"]
            });
          }
        }
        return merged;
      });
      setThemeBanner({
        kind: "ok",
        text: `已扫描 Steam 431960 创意工坊，发现 ${scanned.length} 项壁纸`
      });
      return;
    }

    setThemeBanner({
      kind: "ok",
      text: "浏览器预览模式：未检测到桌面 Tauri Steam 431960 进程，保留内置 WebWallGL 场景目录"
    });
  }, []);

  const handleExportTheme = useCallback(() => {
    const rawBundle: WbThemeBundle & Record<string, unknown> = {
      schemaVersion: 1,
      name: `${BRAND.appName} Preset (${appearance.themeMode})`,
      exportedAt: new Date().toISOString(),
      themeMode: appearance.themeMode,
      layoutPreset: appearance.layoutPreset,
      glass: appearance.glass,
      wallpaper: {
        sourceType: appearance.wallpaper.sourceType,
        ...(appearance.wallpaper.steamWorkshopId
          ? { steamWorkshopId: appearance.wallpaper.steamWorkshopId }
          : {}),
        veilOpacity: appearance.wallpaper.veilOpacity,
        vignetteStrength: appearance.wallpaper.vignetteStrength,
        blurPx: appearance.wallpaper.blurPx,
        fpsLimit: appearance.wallpaper.fpsLimit,
        pauseWhenOccluded: appearance.wallpaper.pauseWhenOccluded,
        audioReactive: appearance.wallpaper.audioReactive
      },
      typography: appearance.typography,
      splitTree: splitRoot
    };
    const sanitized = sanitizeWbThemeForExport(rawBundle);
    const jsonText = JSON.stringify(sanitized, null, 2);
    setExportedThemePreview(jsonText);
    setThemeBanner({
      kind: "ok",
      text: "已导出 .wb-theme 预设包（已强制剥离本机路径与一切凭据字段）"
    });
  }, [appearance, splitRoot]);

  const handleImportTheme = useCallback((rawJson: string) => {
    try {
      const parsed = parseWbThemeImport(rawJson);
      setAppearance((prev) => ({
        ...prev,
        themeMode: parsed.themeMode,
        layoutPreset: parsed.layoutPreset,
        glass: parsed.glass,
        wallpaper: {
          ...prev.wallpaper,
          ...parsed.wallpaper
        },
        typography: parsed.typography
      }));
      if (parsed.splitTree) {
        setSplitRoot(parsed.splitTree);
      } else {
        setSplitRoot(PRESET_TREES[parsed.layoutPreset]);
      }
      setThemeBanner({
        kind: "ok",
        text: `已导入并应用主题预设「${parsed.name}」`
      });
    } catch (err) {
      setThemeBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "导入 .wb-theme 失败"
      });
    }
  }, []);

  const handleInstallOfficial = useCallback(
    async (entry: OfficialPluginCatalogEntry) => {
      setInstalledPlugins((prev) => {
        if (prev.some((p) => p.id === entry.id)) {
          return prev;
        }
        return [
          ...prev,
          {
            id: entry.id,
            packageName: entry.packageName,
            version: entry.version,
            distribution: "managed",
            enabled: true,
            realms: entry.realms,
            permissions: entry.permissions,
            modelVisible: entry.modelVisible,
            sha256Verified: true,
            installedAt: Date.now()
          }
        ];
      });
    },
    []
  );

  const handleInstallCommunityNpm = useCallback(
    async (request: {
      packageName: string;
      audit: CommunityAuditDraft;
      auditAccepted: boolean;
      ignoreScripts: true;
      noGit: true;
    }) => {
      if (!request.auditAccepted) {
        throw new Error("未确认社区插件权限审计条款");
      }
      setInstalledPlugins((prev) => {
        if (prev.some((p) => p.packageName === request.packageName)) {
          return prev;
        }
        return [
          ...prev,
          {
            id: request.packageName,
            packageName: request.packageName,
            version: request.audit.version,
            distribution: "managed",
            enabled: true,
            realms: request.audit.realms,
            permissions: request.audit.permissions,
            modelVisible: request.audit.modelVisible,
            sha256Verified: false,
            installedAt: Date.now()
          }
        ];
      });
    },
    []
  );

  const visibleSidebarItems = useMemo(
    () => getVisibleSidebarItems(navState),
    [navState]
  );

  const pendingApprovalCount = useMemo(
    () => approvals.filter((item) => (item.status ?? "pending") === "pending").length,
    [approvals]
  );

  const renderPane = useCallback(
    (paneId: WorkbenchPaneId): React.ReactNode => {
      switch (paneId) {
        case "worktree-tree":
          return (
            <div
              style={{
                padding: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                height: "100%",
                overflowY: "auto"
              }}
            >
              <div>
                <div className="pmx-muted" style={{ marginBottom: "6px" }}>
                  可见侧栏导航（可拖拽排序）
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {visibleSidebarItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="pmx-list-row pmx-btn"
                      style={{
                        justifyContent: "flex-start",
                        width: "100%",
                        background: "transparent",
                        borderColor: "transparent"
                      }}
                      onClick={() => {
                        if (item.id === "appearance") {
                          setSettingsTab("theme");
                          setSettingsDrawerOpen(true);
                        } else if (item.id === "plugin-market") {
                          setMarketOpen(true);
                        }
                      }}
                    >
                      <span className="prismux-ico" aria-hidden="true">
                        {item.displayIcon}
                      </span>
                      <span>{item.displayTitle}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div
                style={{
                  borderTop: "1px solid var(--prismux-line, rgba(148,163,184,0.2))",
                  paddingTop: "10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px"
                }}
              >
                <div className="pmx-muted">Worktree 隔离分支树</div>
                <div className="pmx-kv-row">
                  <span>● main（只读受护）</span>
                  <span className="pmx-muted">HEAD</span>
                </div>
                <div className="pmx-kv-row">
                  <span>⎇ factory/1122-glass-ui</span>
                  <span style={{ color: "var(--c-ok, #22c55e)" }}>+4 files</span>
                </div>
                <div
                  style={{
                    padding: "8px",
                    borderRadius: "8px",
                    border: "1px solid var(--prismux-line, rgba(148,163,184,0.2))",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px"
                  }}
                >
                  <div className="pmx-kv-row">
                    <span className="pmx-muted">agent-scratch</span>
                    <span className="pmx-tabular">.claude/worktrees/01</span>
                  </div>
                  <button
                    type="button"
                    className="pmx-btn pmx-btn-sm"
                    disabled={scratchAdopted}
                    title={
                      scratchAdopted
                        ? "已收编为正式项目线程"
                        : "收编代理临时工作树为正式线程"
                    }
                    onClick={() => setScratchAdopted(true)}
                  >
                    {scratchAdopted ? "已收编为正式线程" : "一键收编线程"}
                  </button>
                </div>
              </div>
            </div>
          );

        case "pty-terminal":
          return (
            <div
              style={{
                padding: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                height: "100%",
                fontFamily: "ui-monospace, Consolas, monospace",
                fontSize: "12px"
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between"
                }}
              >
                <span className="pmx-muted">
                  PersistentPtyPool · 环形缓冲 2.00 MB
                </span>
                <span style={{ color: "var(--c-ok, #22c55e)" }}>
                  已同步无损回放
                </span>
              </div>
              <pre
                style={{
                  margin: 0,
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: "8px",
                  background: "rgba(12, 17, 27, 0.56)",
                  border: "1px solid var(--prismux-line, rgba(148,163,184,0.22))",
                  overflow: "auto",
                  lineHeight: 1.55
                }}
              >
                {[
                  "$ prismux daemon status --headless",
                  "[daemon] T3 Bridge connected (ELECTRON_RUN_AS_NODE stripped)",
                  `[chief] active slot: ${PROVIDER_DISPLAY_NAMES[chiefProvider]} (${dialMode})`,
                  "[pty-01] replay seq 1042..1048 restored (0 bytes lost)",
                  "$ pnpm --filter @prismux/workbench-ui test"
                ].join("\n")}
              </pre>
            </div>
          );

        case "git-diff":
          return (
            <div
              style={{
                padding: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                height: "100%",
                overflowY: "auto",
                fontFamily: "ui-monospace, Consolas, monospace",
                fontSize: "12px"
              }}
            >
              <div className="pmx-kv-row" style={{ fontFamily: "inherit" }}>
                <strong>apps/workbench-ui/src/App.tsx</strong>
                <span className="pmx-muted">Oracle / Review 实时 Diff</span>
              </div>
              <div
                style={{
                  borderRadius: "8px",
                  border: "1px solid var(--prismux-line, rgba(148,163,184,0.24))",
                  overflow: "hidden"
                }}
              >
                <div
                  style={{
                    padding: "4px 10px",
                    background: "rgba(220, 38, 38, 0.16)",
                    color: "var(--c-bad, #ff858d)"
                  }}
                >
                  - const occluded = false;
                </div>
                <div
                  style={{
                    padding: "4px 10px",
                    background: "rgba(22, 163, 74, 0.16)",
                    color: "var(--c-ok, #4ade80)"
                  }}
                >
                  + const occluded = resolveVisibilityOcclusion(&#123;
                  documentHidden, pauseWhenOccluded, signal &#125;);
                </div>
              </div>
            </div>
          );

        case "approval-inbox":
          return (
            <div
              className="pmx-approval-inbox-shell"
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                minHeight: 0,
                overflow: "hidden",
                gap: "8px"
              }}
            >
              <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={rightPaneSubTab === "approvals"}
                  className={`pmx-btn pmx-btn-sm ${
                    rightPaneSubTab === "approvals" ? "pmx-btn-selected" : ""
                  }`}
                  onClick={() => setRightPaneSubTab("approvals")}
                >
                  中文审批与续跑（{pendingApprovalCount}）
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={rightPaneSubTab === "reasoning"}
                  className={`pmx-btn pmx-btn-sm ${
                    rightPaneSubTab === "reasoning" ? "pmx-btn-selected" : ""
                  }`}
                  onClick={() => setRightPaneSubTab("reasoning")}
                >
                  思考强度直调卡
                </button>
              </div>
              <div
                style={{
                  flex: "1 1 0",
                  minHeight: 0,
                  overflow: rightPaneSubTab === "approvals" ? "hidden" : "auto",
                  display: "flex",
                  flexDirection: "column"
                }}
              >
                {rightPaneSubTab === "approvals" ? (
                  <ApprovalGuidePanel
                    approvals={approvals}
                    onDecide={handleApprovalDecision}
                    onSubmitPrompt={handlePromptSubmit}
                    latch={submitLatchRef.current ?? undefined}
                  />
                ) : (
                  <ReasoningEffortCard
                    profile={reasoningProfile}
                    themeMode={appearance.themeMode}
                    onChange={setReasoningProfile}
                  />
                )}
              </div>
            </div>
          );

        case "live-preview":
          return (
            <div
              style={{
                padding: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                height: "100%",
                overflowY: "auto"
              }}
            >
              <div className="pmx-kv-row">
                <strong>角色拨盘（Dial）与 Handoff</strong>
                <div style={{ display: "flex", gap: "6px" }}>
                  {DIAL_MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={dialMode === m}
                      className={`pmx-btn pmx-btn-sm ${
                        dialMode === m ? "pmx-btn-selected" : ""
                      }`}
                      onClick={() => setDialMode(m)}
                    >
                      {DIAL_MODE_DESCRIPTIONS[m].label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pmx-muted">
                {DIAL_MODE_DESCRIPTIONS[dialMode].purpose}
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="pmx-btn pmx-btn-sm"
                  onClick={handleTriggerHandoff}
                >
                  执行 /handoff 提纯交接
                </button>
                <button
                  type="button"
                  className="pmx-btn pmx-btn-sm"
                  onClick={() => setPaletteOpen(true)}
                >
                  打开 / 快捷指令
                </button>
              </div>
              <div
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "10px",
                  border: "1px solid var(--prismux-line, rgba(148,163,184,0.22))",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  overflowY: "auto"
                }}
              >
                {chatLog.slice(-4).map((msg) => (
                  <div key={msg.id} style={{ fontSize: "12.5px" }}>
                    <span className="pmx-muted pmx-tabular">[{msg.timestamp}] </span>
                    <strong>{msg.role === "user" ? "主人" : msg.role === "chief" ? "主秘书" : "系统"}：</strong>
                    <span>{msg.content}</span>
                  </div>
                ))}
              </div>
            </div>
          );

        case "chief-chat":
        default:
          return (
            <div
              style={{
                padding: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                height: "100%",
                overflowY: "auto"
              }}
            >
              <ReasoningEffortCard
                profile={reasoningProfile}
                themeMode={appearance.themeMode}
                onChange={setReasoningProfile}
              />
              <ApprovalGuidePanel
                approvals={approvals}
                onDecide={handleApprovalDecision}
                onSubmitPrompt={handlePromptSubmit}
                latch={submitLatchRef.current ?? undefined}
              />
            </div>
          );
      }
    },
    [
      appearance.themeMode,
      approvals,
      chatLog,
      chiefProvider,
      dialMode,
      handleApprovalDecision,
      handlePromptSubmit,
      handleTriggerHandoff,
      pendingApprovalCount,
      reasoningProfile,
      rightPaneSubTab,
      scratchAdopted,
      visibleSidebarItems
    ]
  );

  const isStandby = appearance.layoutPreset === "secretary-standby";

  return (
    <div className="pmx-shell" data-pane-preset={appearance.layoutPreset}>
      <style id="prismux-workbench-ui-components">{WORKBENCH_COMPONENTS_CSS}</style>

      {/* Z-0 / Z-1 动态壁纸层 */}
      <WallpaperViewport
        wallpaper={appearance.wallpaper}
        occluded={effectiveOccluded}
        audioBands={audioBands}
        themeMode={appearance.themeMode}
      />

      {/* 顶部玻璃服务条（liquid-glass 模式下自动透明融合） */}
      <header className="pmx-topbar prismux-topbar prismux-glass-sidebar">
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <img
              src="/logo.png"
              alt="Prismux Logo"
              width={24}
              height={24}
              style={{
                width: "24px",
                height: "24px",
                borderRadius: "6px",
                objectFit: "cover",
                flexShrink: 0
              }}
            />
            <strong style={{ fontSize: "14px", letterSpacing: "0.02em" }}>
              {BRAND.appName}
            </strong>
            <button
              type="button"
              className="pmx-btn pmx-btn-sm pmx-btn-pill pmx-tabular"
              title="打开软件更新与国内外双源路由中心"
              aria-label={`当前版本 v${APP_CURRENT_VERSION}，点击打开软件更新中心`}
              onClick={() => setUpdateCenterOpen(true)}
            >
              v{APP_CURRENT_VERSION}
            </button>
          </div>

          <span
            className="prismux-badge pmx-tabular"
            title="壁纸、玻璃与主题外观严格不向任何大模型注入 Tool Schema"
          >
            0 Token 视觉层
          </span>

          {effectiveOccluded && (
            <span
              className="prismux-badge pmx-tabular"
              style={{ color: "var(--c-warn, #fbbf24)" }}
            >
              0 FPS 遮挡节能休眠
            </span>
          )}

          {/* 主秘书热切换器 */}
          <div
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            aria-label="主秘书槽位热切换"
          >
            <span className="pmx-muted">主秘书：</span>
            <select
              aria-label="切换主秘书代理"
              className="pmx-input"
              value={chiefProvider}
              onChange={(e) =>
                handleChiefSwitch(e.target.value as ChiefProviderKind)
              }
              style={{ height: "28px", minHeight: "28px", padding: "0 8px" }}
            >
              {CHIEF_PROVIDER_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {PROVIDER_DISPLAY_NAMES[kind]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 双预设秒切 + 工具入口 */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <div
            role="group"
            aria-label="工作台双预设秒切"
            style={{ display: "inline-flex", gap: "4px" }}
          >
            <button
              type="button"
              aria-pressed={isStandby}
              className={`pmx-btn pmx-btn-pill ${isStandby ? "pmx-btn-selected" : ""}`}
              onClick={() => switchLayoutPreset("secretary-standby")}
            >
              秘书待机
            </button>
            <button
              type="button"
              aria-pressed={!isStandby}
              className={`pmx-btn pmx-btn-pill ${!isStandby ? "pmx-btn-selected" : ""}`}
              onClick={() => switchLayoutPreset("multi-agent-coding")}
            >
              多代理编码
            </button>
          </div>

          <button
            ref={paletteTriggerRef}
            type="button"
            className="pmx-btn"
            onClick={() => setPaletteOpen(true)}
          >
            <span className="prismux-ico" aria-hidden="true">
              /
            </span>
            <span>命令</span>
          </button>

          <button
            type="button"
            className="pmx-btn"
            onClick={() => {
              setSettingsTab("theme");
              setSettingsDrawerOpen(true);
            }}
          >
            <span className="prismux-ico" aria-hidden="true">
              ◐
            </span>
            <span>主题与背景</span>
          </button>

          <button
            type="button"
            className="pmx-btn"
            onClick={() => {
              setSettingsTab("nav");
              setSettingsDrawerOpen(true);
            }}
          >
            <span className="prismux-ico" aria-hidden="true">
              ☰
            </span>
            <span>导航与命令</span>
          </button>

          <button
            type="button"
            className="pmx-btn"
            onClick={() => setMarketOpen(true)}
          >
            <span className="prismux-ico" aria-hidden="true">
              ⊞
            </span>
            <span>插件市场</span>
          </button>

          <button
            type="button"
            className="pmx-btn"
            onClick={() => setWizardOpen(true)}
          >
            <span>安装引导</span>
          </button>
        </div>
      </header>

      {/* 主画幅区域 */}
      <main className="pmx-main-stage">
        {isStandby ? (
          /* 秘书待机模式：让出 85%-90% 纯净动态壁纸视口 */
          <div
            style={{
              flex: 1,
              minHeight: 0,
              position: "relative",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              pointerEvents: "none"
            }}
          >
            {standbyChatOpen && (
              <div
                className="pmx-glass-overlay prismux-glass-surface"
                style={{
                  pointerEvents: "auto",
                  width: "min(580px, 92vw)",
                  maxHeight: "62vh",
                  margin: "0 auto 12px",
                  overflow: "auto",
                  padding: "12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between"
                  }}
                >
                  <strong>
                    主秘书快捷对话（{PROVIDER_DISPLAY_NAMES[chiefProvider]}）
                  </strong>
                  <button
                    type="button"
                    className="pmx-btn pmx-btn-sm"
                    onClick={() => setStandbyChatOpen(false)}
                  >
                    收起释放壁纸视野
                  </button>
                </div>
                {renderPane("chief-chat")}
              </div>
            )}
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <SplitWorkspace
              root={splitRoot}
              onChangeRoot={setSplitRoot}
              renderPane={renderPane}
            />
          </div>
        )}

        {/* Z-2 浮动玻璃胶囊 */}
        <FloatingCapsules
          standbyMode={isStandby}
          pendingApprovals={pendingApprovalCount}
          unreadEmails={2}
          onQuickContinue={() => {
            void submitLatchRef.current?.submitOnce("", handlePromptSubmit, {
              trigger: "capsule",
              threadId: "chief"
            });
            setStandbyChatOpen(true);
          }}
          onOpenApprovals={() => {
            if (isStandby) {
              setStandbyChatOpen(true);
            } else {
              setRightPaneSubTab("approvals");
            }
          }}
          onOpenSettings={() => {
            setSettingsTab("theme");
            setSettingsDrawerOpen(true);
          }}
          onSwitchPreset={() =>
            switchLayoutPreset(
              isStandby ? "multi-agent-coding" : "secretary-standby"
            )
          }
        />
      </main>

      {/* 底部紧凑 Token 台账速览条 */}
      <UsageLedgerBar
        entries={usageEntries}
        overnightEstimate={{
          estimatedCostUsd: 0.24,
          windowLabel: "夜间峰谷估算"
        }}
        activeMachineId="fish-win11-primary"
      />

      {/* / 斜杠快捷指令面板 */}
      <SlashCommandPalette
        open={paletteOpen}
        state={navState}
        onClose={() => setPaletteOpen(false)}
        onExecuteCommand={handleExecuteSlashCommand}
        returnFocusTo={paletteTriggerRef.current}
      />

      {/* 右侧滑出设置抽屉（主题与背景 + 导航与命令） */}
      {settingsDrawerOpen && (
        <div
          className="pmx-drawer-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="工作台设置抽屉"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSettingsDrawerOpen(false);
            }
          }}
        >
          <aside className="pmx-drawer pmx-glass-overlay prismux-glass-surface">
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--prismux-line, rgba(148,163,184,0.22))",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px"
              }}
            >
              <div role="tablist" style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === "theme"}
                  className={`pmx-btn ${
                    settingsTab === "theme" ? "pmx-btn-selected" : ""
                  }`}
                  onClick={() => setSettingsTab("theme")}
                >
                  主题与背景
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === "nav"}
                  className={`pmx-btn ${
                    settingsTab === "nav" ? "pmx-btn-selected" : ""
                  }`}
                  onClick={() => setSettingsTab("nav")}
                >
                  导航与命令
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === "updater"}
                  className={`pmx-btn ${
                    settingsTab === "updater" ? "pmx-btn-selected" : ""
                  }`}
                  onClick={() => setSettingsTab("updater")}
                >
                  软件更新
                </button>
              </div>
              <button
                type="button"
                className="pmx-btn pmx-btn-sm"
                onClick={() => setSettingsDrawerOpen(false)}
              >
                关闭
              </button>
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "12px"
              }}
            >
              {themeBanner && (
                <div
                  className={themeBanner.kind === "error" ? "pmx-alert" : "pmx-glass-content"}
                  role={themeBanner.kind === "error" ? "alert" : "status"}
                  style={
                    themeBanner.kind === "ok"
                      ? { padding: "8px 12px", fontSize: "12.5px" }
                      : undefined
                  }
                >
                  <span>{themeBanner.text}</span>
                  <button
                    type="button"
                    className="pmx-btn pmx-btn-sm"
                    onClick={() => setThemeBanner(null)}
                  >
                    收起
                  </button>
                </div>
              )}

              {settingsTab === "theme" ? (
                <>
                  <ThemeBackgroundPanel
                    state={appearance}
                    onChange={setAppearance}
                    wallpapers={wallpapers}
                    onScanSteam={handleScanSteam}
                    onExportTheme={handleExportTheme}
                    onImportTheme={handleImportTheme}
                  />
                  {exportedThemePreview && (
                    <div
                      style={{
                        padding: "12px",
                        borderRadius: "10px",
                        border: "1px solid var(--prismux-line, rgba(148,163,184,0.24))",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px"
                      }}
                    >
                      <div className="pmx-kv-row">
                        <strong>.wb-theme 导出预览（无本机路径/凭据）</strong>
                        <button
                          type="button"
                          className="pmx-btn pmx-btn-sm"
                          onClick={() => setExportedThemePreview(null)}
                        >
                          关闭预览
                        </button>
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          maxHeight: "140px",
                          overflow: "auto",
                          fontSize: "12px",
                          fontFamily: "ui-monospace, Consolas, monospace"
                        }}
                      >
                        {exportedThemePreview}
                      </pre>
                    </div>
                  )}
                </>
              ) : settingsTab === "nav" ? (
                <NavAndCommandOrder
                  state={navState}
                  onChange={setNavState}
                  onExecuteCommand={handleExecuteSlashCommand}
                  onNavigateSidebarItem={(item) => {
                    if (item.paneId && isStandby) {
                      switchLayoutPreset("multi-agent-coding");
                    }
                    setSettingsDrawerOpen(false);
                  }}
                  machineId="fish-win11-primary"
                />
              ) : (
                <UpdateCenterPanel
                  embedded
                  currentVersion={APP_CURRENT_VERSION}
                  policy={updatePolicy}
                  onPolicyChange={setUpdatePolicy}
                  onOpenPluginMarket={() => {
                    setSettingsDrawerOpen(false);
                    setMarketOpen(true);
                  }}
                />
              )}
            </div>
          </aside>
        </div>
      )}

      {/* 软件更新中心弹窗 */}
      <UpdateCenterPanel
        open={updateCenterOpen}
        currentVersion={APP_CURRENT_VERSION}
        policy={updatePolicy}
        onPolicyChange={setUpdatePolicy}
        onClose={() => setUpdateCenterOpen(false)}
        onOpenPluginMarket={() => {
          setUpdateCenterOpen(false);
          setMarketOpen(true);
        }}
      />

      {/* 双轨插件市场 */}
      <PluginMarketModal
        open={marketOpen}
        onClose={() => setMarketOpen(false)}
        officialCatalog={DEFAULT_OFFICIAL_PLUGIN_CATALOG}
        installedPlugins={installedPlugins}
        networkPreference={updatePolicy.routePreference}
        pluginRegistryOverride={updatePolicy.pluginRegistryOverride}
        onOpenUpdateCenter={() => {
          setMarketOpen(false);
          setUpdateCenterOpen(true);
        }}
        onInstallOfficial={handleInstallOfficial}
        onInstallCommunityNpm={handleInstallCommunityNpm}
        onTogglePlugin={async (pluginId, enabled) => {
          setInstalledPlugins((prev) =>
            prev.map((p) => (p.id === pluginId ? { ...p, enabled } : p))
          );
        }}
        onUninstallPlugin={async (pluginId) => {
          setInstalledPlugins((prev) => prev.filter((p) => p.id !== pluginId));
        }}
      />

      {/* 克制 5 步首次引导向导 */}
      <FirstRunWizard
        open={wizardOpen}
        initialConfig={{
          themeMode: appearance.themeMode,
          chiefProvider
        }}
        diskSpaceInfo={{ requiredMb: 142, availableMb: 84200 }}
        onClose={() => setWizardOpen(false)}
        onComplete={(config: FirstRunWizardConfig) => {
          setAppearance((prev) => ({
            ...prev,
            themeMode: config.themeMode
          }));
          setChiefProvider(config.chiefProvider);
          setWizardOpen(false);
        }}
      />
    </div>
  );
};

export default App;
