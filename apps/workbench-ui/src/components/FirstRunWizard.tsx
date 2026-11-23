import React, { useEffect, useRef, useState } from "react";
import {
  BRAND,
  CHIEF_PROVIDER_KINDS,
  type AppearanceThemeMode,
  type ChiefProviderKind
} from "@prismux/protocol";
import { APP_CURRENT_VERSION } from "../logic/pluginMarketCatalog.js";
import { formatLedgerMetric } from "../logic/usageFormatting.js";

export interface FirstRunWizardConfig {
  installPath: string;
  portableMode: boolean;
  themeMode: AppearanceThemeMode;
  chiefProvider: ChiefProviderKind;
  launchOnFinish: boolean;
  createDesktopShortcut: boolean;
}

export interface FirstRunWizardProps {
  open: boolean;
  initialConfig?: Partial<FirstRunWizardConfig>;
  diskSpaceInfo?: { requiredMb?: number | null; availableMb?: number | null };
  onComplete: (config: FirstRunWizardConfig) => void;
  onClose?: () => void;
}

const WIZARD_STEPS = [
  { index: 1, key: "welcome", title: "欢迎" },
  { index: 2, key: "path", title: "安装路径" },
  { index: 3, key: "components", title: "组件确认" },
  { index: 4, key: "installing", title: "安装中" },
  { index: 5, key: "complete", title: "完成" }
] as const;

const INSTALL_WRITE_QUEUE = [
  "apps/daemon/dist/cli.js",
  "packages/memory-core/schema/memory.db",
  "apps/workbench-ui/dist/index.html",
  "apps/workbench-ui/dist/webwallgl.js",
  "config/chief-workspace/slot.json"
] as const;

const OFFICIAL_EXCLUDED_PLUGINS = [
  { id: "qq", label: "QQ 机器人 (@prismux/plugin-qq)" },
  { id: "pet", label: "桌宠联动 (@prismux/plugin-pet)" },
  { id: "fishdock-hook", label: "FISH-Dock 灵动岛桥接 (@prismux/plugin-fishdock-hook)" },
  { id: "ssh", label: "SSH 运维面板 (@prismux/plugin-ssh)" }
] as const;

const PROVIDER_LABELS: Record<ChiefProviderKind, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity (gemini-4-neon)",
  omp: "oh-my-pi",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  cursor: "Cursor",
  acp: "ACP 通用代理"
};

export const FirstRunWizard: React.FC<FirstRunWizardProps> = ({
  open,
  initialConfig,
  diskSpaceInfo,
  onComplete,
  onClose
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [installPath, setInstallPath] = useState(
    initialConfig?.installPath ?? "C:\\Program Files\\Prismux"
  );
  const [portableMode, setPortableMode] = useState(
    initialConfig?.portableMode ?? false
  );
  const [themeMode, setThemeMode] = useState<AppearanceThemeMode>(
    initialConfig?.themeMode ?? "liquid-glass"
  );
  const [chiefProvider, setChiefProvider] = useState<ChiefProviderKind>(
    initialConfig?.chiefProvider ?? "claude-code"
  );
  const [launchOnFinish, setLaunchOnFinish] = useState(
    initialConfig?.launchOnFinish ?? true
  );
  const [createDesktopShortcut, setCreateDesktopShortcut] = useState(
    initialConfig?.createDesktopShortcut ?? true
  );

  const [progressPercent, setProgressPercent] = useState(0);
  const [cancelConfirming, setCancelConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    setStep(1);
    setProgressPercent(0);
    setCancelConfirming(false);
  }, [open]);

  useEffect(() => {
    if (!open || step !== 4) {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    setProgressPercent(8);
    timerRef.current = setInterval(() => {
      setProgressPercent((prev) => {
        if (prev >= 100) {
          if (timerRef.current !== null) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          setStep(5);
          return 100;
        }
        return Math.min(100, prev + 16);
      });
    }, 180);

    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [open, step]);

  if (!open) {
    return null;
  }

  const currentFileIndex = Math.min(
    INSTALL_WRITE_QUEUE.length - 1,
    Math.floor((progressPercent / 100) * INSTALL_WRITE_QUEUE.length)
  );
  const currentWritingFile =
    INSTALL_WRITE_QUEUE[currentFileIndex] ?? INSTALL_WRITE_QUEUE[0];
  const paddedPercent = `${String(progressPercent).padStart(3, "0")}%`;

  const resolvedTargetDir = portableMode
    ? `${installPath.replace(/[\\/]+$/, "")}\\data`
    : installPath;

  return (
    <div
      className="pmx-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Prismux 安装与首次引导向导"
    >
      <div
        className="pmx-glass-overlay prismux-glass-surface"
        style={{
          width: "min(760px, 94vw)",
          minHeight: "460px",
          display: "grid",
          gridTemplateColumns: "200px 1fr",
          overflow: "hidden"
        }}
      >
        {/* 左侧极简静奢步进导航 */}
        <aside
          style={{
            padding: "20px 16px",
            borderRight: "1px solid var(--prismux-line, rgba(148,163,184,0.22))",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "16px"
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <img
                src="/logo.png"
                alt="Prismux"
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
              <span style={{ fontWeight: 600, fontSize: "14px", letterSpacing: "0.02em" }}>
                {BRAND.appName}
              </span>
            </div>

            <nav aria-label="安装步骤" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {WIZARD_STEPS.map((item) => {
                const isCurrent = step === item.index;
                const isDone = step > item.index;
                return (
                  <div
                    key={item.key}
                    aria-current={isCurrent ? "step" : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "6px 8px",
                      borderRadius: "8px",
                      background: isCurrent
                        ? "var(--sel-bg, rgba(59, 130, 246, 0.14))"
                        : "transparent",
                      borderLeft: isCurrent
                        ? "2px solid var(--prismux-accent, #6cb6ff)"
                        : "2px solid transparent",
                      color: isCurrent
                        ? "var(--prismux-text, #eef2f8)"
                        : "var(--prismux-muted, #94a3b8)",
                      fontWeight: isCurrent ? 600 : 400
                    }}
                  >
                    <span className="pmx-tabular" style={{ fontSize: "12px", width: "18px" }}>
                      {isDone ? "✓" : `0${item.index}`}
                    </span>
                    <span style={{ fontSize: "12.5px" }}>{item.title}</span>
                  </div>
                );
              })}
            </nav>
          </div>

          <div className="pmx-muted pmx-tabular" style={{ fontSize: "12px" }}>
            v{APP_CURRENT_VERSION} · 视觉层 0 Token 开销
          </div>
        </aside>

        {/* 右侧主体 */}
        <div
          style={{
            padding: "24px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "20px"
          }}
        >
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="pmx-muted">STEP 01 · WELCOME</div>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <img
                  src="/logo.png"
                  alt="Prismux"
                  width={52}
                  height={52}
                  style={{
                    width: "52px",
                    height: "52px",
                    borderRadius: "12px",
                    objectFit: "cover",
                    border: "1px solid var(--prismux-line, rgba(148,163,184,0.26))",
                    flexShrink: 0
                  }}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 600 }}>
                    欢迎使用 {BRAND.appName}
                  </h2>
                  <p style={{ margin: 0, fontSize: "14px" }}>
                    极简液态玻璃 AI 超级工作台与 24h 秘书系统
                  </p>
                </div>
              </div>
              <div
                style={{
                  padding: "16px",
                  borderRadius: "10px",
                  border: "1px solid var(--prismux-line, rgba(148,163,184,0.22))",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  fontSize: "12.5px"
                }}
              >
                <div className="pmx-kv-row">
                  <span className="pmx-muted">发行版本</span>
                  <span className="pmx-tabular">{APP_CURRENT_VERSION} (M4 Desktop &amp; Headless)</span>
                </div>
                <div className="pmx-kv-row">
                  <span className="pmx-muted">架构基线</span>
                  <span>24h 无头守护中枢 · 单文件 SQLite 记忆 · Tauri v2 壳</span>
                </div>
                <div className="pmx-kv-row">
                  <span className="pmx-muted">许可与隐私</span>
                  <span>本地单文件存储，跨端同步采用 Argon2id + AEAD 密封</span>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="pmx-muted">STEP 02 · INSTALL LOCATION</div>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
                选择安装路径与运行模式
              </h2>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label htmlFor="pmx-wizard-install-path" className="pmx-muted">
                  安装目录
                </label>
                <input
                  id="pmx-wizard-install-path"
                  type="text"
                  className="pmx-input"
                  value={installPath}
                  onChange={(e) => setInstallPath(e.target.value)}
                />
              </div>

              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "10px",
                  border: "1px solid var(--prismux-line, rgba(148,163,184,0.22))",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px"
                }}
              >
                <div className="pmx-kv-row">
                  <span className="pmx-muted">所需空间</span>
                  <span className="pmx-tabular">
                    {diskSpaceInfo?.requiredMb !== undefined &&
                    diskSpaceInfo.requiredMb !== null
                      ? `${formatLedgerMetric(diskSpaceInfo.requiredMb, { unit: "count" })} MB`
                      : "未告知"}
                  </span>
                </div>
                <div className="pmx-kv-row">
                  <span className="pmx-muted">目标磁盘剩余空间</span>
                  <span className="pmx-tabular">
                    {diskSpaceInfo?.availableMb !== undefined &&
                    diskSpaceInfo.availableMb !== null
                      ? `${formatLedgerMetric(diskSpaceInfo.availableMb, { unit: "count" })} MB`
                      : "未告知"}
                  </span>
                </div>
              </div>

              <label
                style={{
                  padding: "12px 16px",
                  borderRadius: "10px",
                  border: "1px solid var(--prismux-line, rgba(148,163,184,0.22))",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  cursor: "pointer"
                }}
              >
                <input
                  type="checkbox"
                  checked={portableMode}
                  onChange={(e) => setPortableMode(e.target.checked)}
                  style={{ marginTop: "3px" }}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <strong style={{ fontSize: "13px" }}>
                    启用便携模式（随附 data/ 目录，零系统残留）
                  </strong>
                  <span className="pmx-muted">
                    启用后，SQLite 记忆库、缓存、日志与配置将全部收敛于同级{" "}
                    <code>{resolvedTargetDir}</code>，不在系统用户目录写入残留。
                  </span>
                </div>
              </label>
            </div>
          )}

          {step === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="pmx-muted">STEP 03 · COMPONENTS</div>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
                极简内核组件确认
              </h2>

              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: "10px",
                  border: "1px solid var(--prismux-accent, #3b82f6)",
                  background: "var(--sel-bg, rgba(59, 130, 246, 0.1))",
                  fontSize: "13px",
                  lineHeight: 1.55
                }}
              >
                仅安装极简高效内核（守护中枢 + 工作台界面 + 单文件 SQLite
                记忆引擎）；QQ 机器人、桌宠、FISH-Dock 灵动岛、SSH
                运维四大官方独立插件默认绝不预装，安装完成后可在内置插件市场按需选装。
              </div>

              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "10px",
                  border: "1px solid var(--prismux-line, rgba(148,163,184,0.22))",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px"
                }}
              >
                <div className="pmx-kv-row">
                  <span>守护中枢（apps/daemon）</span>
                  <span style={{ color: "var(--c-ok, #22c55e)" }}>核心必装</span>
                </div>
                <div className="pmx-kv-row">
                  <span>工作台界面（apps/workbench-ui）</span>
                  <span style={{ color: "var(--c-ok, #22c55e)" }}>核心必装</span>
                </div>
                <div className="pmx-kv-row">
                  <span>单文件 SQLite 混合记忆引擎</span>
                  <span style={{ color: "var(--c-ok, #22c55e)" }}>核心必装</span>
                </div>
                <div
                  style={{
                    borderTop: "1px solid var(--prismux-line, rgba(148,163,184,0.18))",
                    marginTop: "4px",
                    paddingTop: "6px"
                  }}
                >
                  {OFFICIAL_EXCLUDED_PLUGINS.map((plugin) => (
                    <div key={plugin.id} className="pmx-kv-row">
                      <span className="pmx-muted">{plugin.label}</span>
                      <span className="pmx-muted">默认不预装</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="pmx-muted">STEP 04 · INSTALLING</div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between"
                }}
              >
                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
                  正在部署极简内核
                </h2>
                <span
                  className="pmx-tabular"
                  style={{
                    fontSize: "20px",
                    fontWeight: 600,
                    fontFamily: "ui-monospace, Consolas, monospace"
                  }}
                >
                  {paddedPercent}
                </span>
              </div>

              {/* 2px 精致工程细线进度条 */}
              <div
                role="progressbar"
                aria-valuenow={progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{
                  height: "2px",
                  width: "100%",
                  background: "var(--prismux-line, rgba(148,163,184,0.28))",
                  borderRadius: "999px",
                  overflow: "hidden"
                }}
              >
                <div
                  style={{
                    width: `${progressPercent}%`,
                    height: "100%",
                    background: "var(--prismux-accent, #6cb6ff)",
                    transition: "width 160ms cubic-bezier(0.22, 1, 0.36, 1)"
                  }}
                />
              </div>

              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--prismux-line, rgba(148,163,184,0.22))",
                  fontFamily: "ui-monospace, Consolas, monospace",
                  fontSize: "12px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
              >
                写入文件：{resolvedTargetDir}\{currentWritingFile}
              </div>

              {cancelConfirming && (
                <div className="pmx-warn-card" role="alert">
                  <div style={{ marginBottom: "8px" }}>
                    确认中止安装？已写入的临时目录文件将被安全清理。
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      className="pmx-btn pmx-btn-sm pmx-btn-danger"
                      onClick={() => {
                        setCancelConfirming(false);
                        setStep(3);
                      }}
                    >
                      确认中止并返回
                    </button>
                    <button
                      type="button"
                      className="pmx-btn pmx-btn-sm"
                      onClick={() => setCancelConfirming(false)}
                    >
                      继续安装
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 5 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="pmx-muted">STEP 05 · READY</div>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
                极简内核部署完成
              </h2>
              <p className="pmx-muted" style={{ margin: 0 }}>
                已完成极简内核初始化。请选择首次启动的默认外观模式与主秘书槽位（后续可随时热切换）。
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span className="pmx-muted">默认外观模式</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                  {(
                    [
                      { id: "light", label: "浅色" },
                      { id: "dark", label: "深色" },
                      { id: "liquid-glass", label: "液态玻璃" }
                    ] as const
                  ).map((modeOpt) => (
                    <button
                      key={modeOpt.id}
                      type="button"
                      aria-pressed={themeMode === modeOpt.id}
                      className={`pmx-btn ${themeMode === modeOpt.id ? "pmx-btn-selected" : ""}`}
                      onClick={() => setThemeMode(modeOpt.id)}
                    >
                      {modeOpt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label htmlFor="pmx-wizard-chief-select" className="pmx-muted">
                  默认主秘书代理（Chief Thread Slot）
                </label>
                <select
                  id="pmx-wizard-chief-select"
                  className="pmx-input"
                  value={chiefProvider}
                  onChange={(e) =>
                    setChiefProvider(e.target.value as ChiefProviderKind)
                  }
                >
                  {CHIEF_PROVIDER_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {PROVIDER_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    checked={launchOnFinish}
                    onChange={(e) => setLaunchOnFinish(e.target.checked)}
                  />
                  <span>立即启动 {BRAND.appName}</span>
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    checked={createDesktopShortcut}
                    onChange={(e) => setCreateDesktopShortcut(e.target.checked)}
                  />
                  <span>创建桌面快捷方式</span>
                </label>
              </div>
            </div>
          )}

          {/* 底部导航条 */}
          <footer
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              paddingTop: "12px",
              borderTop: "1px solid var(--prismux-line, rgba(148,163,184,0.2))"
            }}
          >
            <div>
              {onClose && step !== 4 && (
                <button type="button" className="pmx-btn" onClick={onClose}>
                  关闭向导
                </button>
              )}
              {step === 4 && (
                <button
                  type="button"
                  className="pmx-btn pmx-btn-danger"
                  onClick={() => setCancelConfirming(true)}
                >
                  取消安装
                </button>
              )}
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              {(step === 2 || step === 3) && (
                <button
                  type="button"
                  className="pmx-btn"
                  onClick={() => setStep((prev) => (prev === 2 ? 1 : 2))}
                >
                  上一步
                </button>
              )}

              {step === 1 && (
                <button
                  type="button"
                  className="pmx-btn pmx-btn-primary"
                  onClick={() => setStep(2)}
                >
                  开始安装 / 下一步
                </button>
              )}

              {step === 2 && (
                <button
                  type="button"
                  className="pmx-btn pmx-btn-primary"
                  onClick={() => setStep(3)}
                >
                  下一步
                </button>
              )}

              {step === 3 && (
                <button
                  type="button"
                  className="pmx-btn pmx-btn-primary"
                  onClick={() => setStep(4)}
                >
                  确认仅装极简内核并安装
                </button>
              )}

              {step === 5 && (
                <button
                  type="button"
                  className="pmx-btn pmx-btn-primary"
                  onClick={() =>
                    onComplete({
                      installPath,
                      portableMode,
                      themeMode,
                      chiefProvider,
                      launchOnFinish,
                      createDesktopShortcut
                    })
                  }
                >
                  完成并进入工作台
                </button>
              )}
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};
