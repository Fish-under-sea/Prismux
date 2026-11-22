import React, { useEffect, useState } from "react";
import type { OfficialPluginCatalogEntry } from "@prismux/protocol";
import {
  buildCommunityAuditDraft,
  DEFAULT_OFFICIAL_PLUGIN_CATALOG,
  PERMISSION_ZH_LABELS,
  validateNpmPackageSpec,
  type CommunityAuditDraft,
  type MarketInstalledPlugin
} from "../logic/pluginMarketCatalog.js";

export interface PluginMarketModalProps {
  open: boolean;
  onClose: () => void;
  officialCatalog?: ReadonlyArray<OfficialPluginCatalogEntry>;
  installedPlugins: MarketInstalledPlugin[];
  onInstallOfficial: (entry: OfficialPluginCatalogEntry) => Promise<void> | void;
  onInstallCommunityNpm: (request: {
    packageName: string;
    audit: CommunityAuditDraft;
    auditAccepted: boolean;
    ignoreScripts: true;
    noGit: true;
  }) => Promise<void> | void;
  onTogglePlugin: (pluginId: string, enabled: boolean) => Promise<void> | void;
  onUninstallPlugin: (pluginId: string) => Promise<void> | void;
}

export const PluginMarketModal: React.FC<PluginMarketModalProps> = ({
  open,
  onClose,
  officialCatalog = DEFAULT_OFFICIAL_PLUGIN_CATALOG,
  installedPlugins,
  onInstallOfficial,
  onInstallCommunityNpm,
  onTogglePlugin,
  onUninstallPlugin
}) => {
  const [activeTrack, setActiveTrack] = useState<"official" | "community">("official");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [npmPackageInput, setNpmPackageInput] = useState("");
  const [pendingAudit, setPendingAudit] = useState<CommunityAuditDraft | null>(null);
  const [auditConfirmed, setAuditConfirmed] = useState(false);
  const [confirmUninstallId, setConfirmUninstallId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        if (pendingAudit) {
          setPendingAudit(null);
          setAuditConfirmed(false);
          return;
        }
        if (confirmUninstallId) {
          setConfirmUninstallId(null);
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, pendingAudit, confirmUninstallId]);

  if (!open) {
    return null;
  }

  const findInstalled = (pluginId: string): MarketInstalledPlugin | undefined =>
    installedPlugins.find((p) => p.id === pluginId || p.packageName === pluginId);

  const handlePrepareCommunityInstall = (
    pkgName: string,
    overrides?: { modelVisible?: boolean; modifiesSystemPrompt?: boolean }
  ): void => {
    const check = validateNpmPackageSpec(pkgName);
    if (!check.valid) {
      setErrorText(check.error ?? "包名格式校验失败");
      return;
    }
    setErrorText(null);
    const draft = buildCommunityAuditDraft(check.normalized, overrides);
    setPendingAudit(draft);
    setAuditConfirmed(false);
  };

  return (
    <div
      className="pmx-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Prismux 双轨插件市场"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pendingAudit) {
          onClose();
        }
      }}
    >
      <div
        className="pmx-glass-overlay prismux-glass-surface"
        style={{
          width: "min(840px, 94vw)",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }}
      >
        <header
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--prismux-line, rgba(148,163,184,0.22))",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px"
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="prismux-ico" aria-hidden="true">
                ⊞
              </span>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>
                Cordis 双轨插件市场
              </h2>
            </div>
            <p className="pmx-muted" style={{ margin: "4px 0 0" }}>
              QQ / 桌宠 / 灵动岛 / SSH 四大官方插件默认绝不预装，全部按需单装与可逆卸载零残留
            </p>
          </div>
          <button type="button" className="pmx-btn" onClick={onClose}>
            关闭
          </button>
        </header>

        <div
          role="tablist"
          style={{
            padding: "12px 20px 0",
            display: "flex",
            gap: "8px",
            borderBottom: "1px solid var(--prismux-line, rgba(148,163,184,0.16))"
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTrack === "official"}
            className={`pmx-btn ${activeTrack === "official" ? "pmx-btn-selected" : ""}`}
            onClick={() => setActiveTrack("official")}
            style={{ borderRadius: "10px 10px 0 0" }}
          >
            <span className="prismux-ico" aria-hidden="true">
              ✓
            </span>
            <span>第一轨 · 官方认证区（{officialCatalog.length}）</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTrack === "community"}
            className={`pmx-btn ${activeTrack === "community" ? "pmx-btn-selected" : ""}`}
            onClick={() => setActiveTrack("community")}
            style={{ borderRadius: "10px 10px 0 0" }}
          >
            <span className="prismux-ico" aria-hidden="true">
              ⇄
            </span>
            <span>第二轨 · 社区 npm 免 Git 导入</span>
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "12px"
          }}
        >
          {errorText && (
            <div className="pmx-alert" role="alert">
              <span>{errorText}</span>
              <button
                type="button"
                className="pmx-btn pmx-btn-sm"
                onClick={() => setErrorText(null)}
              >
                忽略
              </button>
            </div>
          )}

          {activeTrack === "official" ? (
            <>
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "10px",
                  border: "1px solid rgba(59, 130, 246, 0.45)",
                  background: "rgba(37, 99, 235, 0.1)",
                  fontSize: "12.5px"
                }}
              >
                安全契约：所有官方插件均强制校验顶层{" "}
                <code>engines.prismux</code> SemVer 范围、<code>.wb-plugin</code>{" "}
                SHA-256 哈希，并写入 <code>distribution: "managed"</code>{" "}
                单写锁防止应用内热自更冲突；卸载时通过 <code>ctx.effect()</code>{" "}
                逆向清除全部路由、Hook、定时器与 DOM。
              </div>

              {officialCatalog.map((entry) => {
                const installed = findInstalled(entry.id);
                const isBusy = busyId === entry.id;
                const isConfirmingUninstall = confirmUninstallId === entry.id;

                return (
                  <article
                    key={entry.id}
                    aria-busy={isBusy}
                    style={{
                      padding: "14px 16px",
                      borderRadius: "12px",
                      border: "1px solid var(--prismux-line, rgba(148,163,184,0.24))",
                      background: "var(--prismux-control, rgba(15,23,42,0.28))",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px"
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                        flexWrap: "wrap"
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap"
                        }}
                      >
                        <strong style={{ fontSize: "14px" }}>
                          {entry.packageName}
                        </strong>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "2px 8px",
                            borderRadius: "999px",
                            background: "#1d4ed8",
                            color: "#ffffff",
                            fontSize: "12px",
                            fontWeight: 600
                          }}
                        >
                          <span className="prismux-ico" aria-hidden="true">
                            ✓
                          </span>
                          <span>官方认证</span>
                        </span>
                        <span className="pmx-muted pmx-tabular">
                          v{entry.version} · engines {entry.engines.prismux}
                        </span>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {!installed ? (
                          <>
                            <span
                              className="pmx-muted"
                              style={{
                                padding: "2px 8px",
                                borderRadius: "999px",
                                border: "1px solid var(--prismux-line, rgba(148,163,184,0.28))"
                              }}
                            >
                              未安装
                            </span>
                            <button
                              type="button"
                              className="pmx-btn pmx-btn-primary"
                              disabled={isBusy}
                              aria-busy={isBusy}
                              onClick={async () => {
                                setBusyId(entry.id);
                                setErrorText(null);
                                try {
                                  await onInstallOfficial(entry);
                                } catch (err) {
                                  setErrorText(
                                    err instanceof Error
                                      ? err.message
                                      : "官方插件安装失败"
                                  );
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                            >
                              {isBusy ? "校验并安装中..." : "按需安装"}
                            </button>
                          </>
                        ) : (
                          <>
                            <span
                              style={{
                                color: installed.enabled
                                  ? "var(--c-ok, #22c55e)"
                                  : "var(--prismux-muted, #94a3b8)",
                                fontWeight: 600,
                                fontSize: "12px"
                              }}
                            >
                              {installed.enabled ? "已启用 (managed)" : "已安装未启用"}
                            </span>
                            <button
                              type="button"
                              className={`pmx-btn ${installed.enabled ? "pmx-btn-selected" : ""}`}
                              disabled={isBusy}
                              onClick={async () => {
                                setBusyId(entry.id);
                                try {
                                  await onTogglePlugin(entry.id, !installed.enabled);
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                            >
                              {installed.enabled ? "停用" : "启用"}
                            </button>
                            {!isConfirmingUninstall ? (
                              <button
                                type="button"
                                className="pmx-btn pmx-btn-danger"
                                disabled={isBusy}
                                onClick={() => setConfirmUninstallId(entry.id)}
                              >
                                卸载
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="pmx-btn pmx-btn-danger"
                                  onClick={async () => {
                                    setBusyId(entry.id);
                                    setConfirmUninstallId(null);
                                    try {
                                      await onUninstallPlugin(entry.id);
                                    } finally {
                                      setBusyId(null);
                                    }
                                  }}
                                >
                                  确认卸载并销毁 effect
                                </button>
                                <button
                                  type="button"
                                  className="pmx-btn"
                                  onClick={() => setConfirmUninstallId(null)}
                                >
                                  取消
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div style={{ fontSize: "12.5px" }}>{entry.description}</div>

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "6px",
                        alignItems: "center"
                      }}
                    >
                      <span className="pmx-muted">
                        运行域：{entry.realms.join(" + ")}
                      </span>
                      <span className="pmx-muted">·</span>
                      <span className="pmx-muted">
                        模型可见：{entry.modelVisible ? "是（将额外审计）" : "否（0 Token）"}
                      </span>
                      <span className="pmx-muted">·</span>
                      <span className="pmx-muted pmx-tabular">
                        SHA-256：{entry.sha256 ? `${entry.sha256.slice(0, 12)}…` : "本地源码构建待签名（未告知）"}
                      </span>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {entry.permissions.map((perm) => (
                        <span
                          key={perm}
                          style={{
                            fontSize: "12px",
                            padding: "2px 8px",
                            borderRadius: "6px",
                            border: "1px solid var(--prismux-line, rgba(148,163,184,0.24))"
                          }}
                        >
                          {PERMISSION_ZH_LABELS[perm]?.label ?? perm}
                        </span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "10px",
                  border: "1px solid var(--prismux-line, rgba(148,163,184,0.26))",
                  fontSize: "12.5px"
                }}
              >
                社区免 Git 流式安装器：直接通过 HTTPS 请求 npm Registry（失败自动回退 npmmirror 镜像）流式拉取{" "}
                <code>.tgz</code> 解包并写入 <code>distribution: "managed"</code>，
                <strong>绝不调用本机 git</strong>，并
                <strong>强制禁用 preinstall / install / postinstall 脚本</strong>。
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handlePrepareCommunityInstall(npmPackageInput);
                }}
                style={{ display: "flex", gap: "8px", alignItems: "center" }}
              >
                <input
                  type="text"
                  className="pmx-input"
                  aria-label="输入社区 npm 插件包名"
                  placeholder="输入 npm 包名，例如 prismux-plugin-theme-lab 或 @scope/prismux-plugin-prompt-helper"
                  value={npmPackageInput}
                  onChange={(e) => setNpmPackageInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button type="submit" className="pmx-btn pmx-btn-primary">
                  检查并导入
                </button>
              </form>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                  alignItems: "center"
                }}
              >
                <span className="pmx-muted">快速体验审计门控示例：</span>
                <button
                  type="button"
                  className="pmx-btn pmx-btn-sm"
                  onClick={() =>
                    handlePrepareCommunityInstall("prismux-plugin-clock-widget", {
                      modelVisible: false,
                      modifiesSystemPrompt: false
                    })
                  }
                >
                  导入纯 UI 扩展（0 Token）
                </button>
                <button
                  type="button"
                  className="pmx-btn pmx-btn-sm"
                  onClick={() =>
                    handlePrepareCommunityInstall(
                      "@community/prismux-plugin-prompt-enhancer",
                      {
                        modelVisible: true,
                        modifiesSystemPrompt: true
                      }
                    )
                  }
                >
                  模拟 modelVisible: true 高危插件
                </button>
              </div>

              {installedPlugins.filter(
                (p) => !officialCatalog.some((o) => o.id === p.id)
              ).length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <strong style={{ fontSize: "13px" }}>已安装的社区插件</strong>
                  {installedPlugins
                    .filter((p) => !officialCatalog.some((o) => o.id === p.id))
                    .map((plugin) => (
                      <div
                        key={plugin.id}
                        className="pmx-kv-row"
                        style={{
                          padding: "8px 12px",
                          borderRadius: "10px",
                          border: "1px solid var(--prismux-line, rgba(148,163,184,0.24))"
                        }}
                      >
                        <span>
                          <strong>{plugin.packageName}</strong>{" "}
                          <span className="pmx-muted">
                            (modelVisible: {plugin.modelVisible ? "true" : "false"})
                          </span>
                        </span>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            type="button"
                            className="pmx-btn pmx-btn-sm"
                            onClick={() =>
                              void onTogglePlugin(plugin.id, !plugin.enabled)
                            }
                          >
                            {plugin.enabled ? "停用" : "启用"}
                          </button>
                          <button
                            type="button"
                            className="pmx-btn pmx-btn-sm pmx-btn-danger"
                            onClick={() => void onUninstallPlugin(plugin.id)}
                          >
                            卸载
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* 标黄 modelVisible: true / 权限审计二次确认卡 */}
          {pendingAudit && (
            <div
              className={
                pendingAudit.requiresYellowWarningConfirm
                  ? "pmx-warn-card"
                  : "pmx-glass-content"
              }
              role="alertdialog"
              aria-label="第三方插件权限审计二次确认"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                marginTop: "4px"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className="prismux-ico" aria-hidden="true">
                  △
                </span>
                <strong style={{ fontSize: "14px" }}>
                  {pendingAudit.modelVisible
                    ? "黄色高风险审计警告：该插件声明 modelVisible: true"
                    : "社区插件权限审计确认"}
                </strong>
              </div>

              <div className="pmx-kv-row">
                <span className="pmx-muted">目标 npm 包</span>
                <code>{pendingAudit.packageName}</code>
              </div>
              <div className="pmx-kv-row">
                <span className="pmx-muted">安装安全策略</span>
                <span>
                  免 Git 流式 Tarball · 已忽略脚本 ({pendingAudit.ignoredScripts.join("/")})
                </span>
              </div>
              <div className="pmx-kv-row">
                <span className="pmx-muted">modelVisible 状态</span>
                <strong
                  style={{
                    color: pendingAudit.modelVisible
                      ? "var(--c-warn, #f59e0b)"
                      : "var(--c-ok, #22c55e)"
                  }}
                >
                  {pendingAudit.modelVisible
                    ? "true（将向模型上下文暴露能力并产生 Token 开销）"
                    : "false（对大模型 0 Token 开销）"}
                </strong>
              </div>

              {pendingAudit.warnings.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12.5px" }}>
                  {pendingAudit.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "12.5px",
                  cursor: "pointer"
                }}
              >
                <input
                  type="checkbox"
                  checked={auditConfirmed}
                  onChange={(e) => setAuditConfirmed(e.target.checked)}
                />
                <span>
                  我已核对以上权限声明与 modelVisible 风险，确认以托管单写锁（managed）安装
                </span>
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button
                  type="button"
                  className="pmx-btn"
                  onClick={() => {
                    setPendingAudit(null);
                    setAuditConfirmed(false);
                  }}
                >
                  取消导入
                </button>
                <button
                  type="button"
                  className="pmx-btn pmx-btn-primary"
                  disabled={!auditConfirmed || busyId === pendingAudit.packageName}
                  title={
                    auditConfirmed
                      ? undefined
                      : "请先勾选确认上方权限审计说明"
                  }
                  onClick={async () => {
                    setBusyId(pendingAudit.packageName);
                    try {
                      await onInstallCommunityNpm({
                        packageName: pendingAudit.packageName,
                        audit: pendingAudit,
                        auditAccepted: true,
                        ignoreScripts: true,
                        noGit: true
                      });
                      setNpmPackageInput("");
                      setPendingAudit(null);
                      setAuditConfirmed(false);
                    } catch (err) {
                      setErrorText(
                        err instanceof Error ? err.message : "社区插件安装失败"
                      );
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  确认授权安装
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
