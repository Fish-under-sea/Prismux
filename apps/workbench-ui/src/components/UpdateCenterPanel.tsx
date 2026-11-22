import React, { useEffect, useState } from "react";
import {
  BRAND,
  DEFAULT_UPDATE_POLICY,
  NETWORK_ROUTE_PREFERENCES,
  UPDATE_ENDPOINTS,
  type NetworkRoutePreference,
  type PluginRegistryOverride,
  type SourceProbeReport,
  type UpdateCheckResult,
  type UpdatePolicyConfig
} from "@prismux/protocol";
import {
  APP_CURRENT_VERSION,
  NETWORK_ROUTE_META,
  formatGhProxyPreviewUrl,
  normalizeUpdatePolicyPatch,
  resolveUiPluginRegistryOrder,
  resolveUiUpdateSourceOrder
} from "../logic/pluginMarketCatalog.js";
import { invokeTauriCommandSafe } from "../logic/visibilityBridge.js";

export interface UpdateCenterPanelProps {
  open?: boolean;
  embedded?: boolean;
  currentVersion?: string;
  portableMode?: boolean;
  policy: UpdatePolicyConfig;
  onPolicyChange: (next: UpdatePolicyConfig) => void;
  onClose?: () => void;
  onProbeSources?: (policy: UpdatePolicyConfig) => Promise<SourceProbeReport>;
  onCheckUpdates?: (policy: UpdatePolicyConfig) => Promise<UpdateCheckResult>;
  onOpenPluginMarket?: () => void;
}

interface TauriUpdaterBootstrapSnapshot {
  currentVersion?: string;
  portableMode?: boolean;
  recommendedPackageKind?: string;
}

const SAMPLE_RELEASE_ASSET_URL = `${UPDATE_ENDPOINTS.githubWebBase}/${UPDATE_ENDPOINTS.githubOwner}/${UPDATE_ENDPOINTS.githubRepo}/releases/download/v${APP_CURRENT_VERSION}/Prismux-Setup-${APP_CURRENT_VERSION}.exe`;
const SAMPLE_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function buildPreviewProbeReport(
  routePreference: NetworkRoutePreference
): SourceProbeReport {
  const preferDomestic = routePreference === "domestic";
  const githubLatency = preferDomestic ? 186 : 42;
  const giteeLatency = preferDomestic ? 28 : 64;
  const recommendedSource =
    routePreference === "global"
      ? "github"
      : routePreference === "domestic"
        ? "gitee"
        : giteeLatency < githubLatency
          ? "gitee"
          : "github";

  return {
    probedAt: Date.now(),
    recommendedSource,
    recommendedRoute: recommendedSource === "gitee" ? "domestic" : "global",
    sources: [
      {
        source: "github",
        url: `${UPDATE_ENDPOINTS.githubApiBase}/repos/${UPDATE_ENDPOINTS.githubOwner}/${UPDATE_ENDPOINTS.githubRepo}/releases`,
        reachable: true,
        statusCode: 200,
        latencyMs: githubLatency
      },
      {
        source: "gitee",
        url: `${UPDATE_ENDPOINTS.giteeApiBase}/repos/${UPDATE_ENDPOINTS.giteeOwner}/${UPDATE_ENDPOINTS.giteeRepo}/releases`,
        reachable: true,
        statusCode: 200,
        latencyMs: giteeLatency
      }
    ]
  };
}

function buildPreviewCheckResult(
  currentVersion: string,
  policy: UpdatePolicyConfig,
  probeReport: SourceProbeReport
): UpdateCheckResult {
  const order = resolveUiUpdateSourceOrder(policy.routePreference);
  const sourceUsed =
    policy.routePreference === "auto"
      ? probeReport.recommendedSource
      : order.primarySource;
  const nextVersion = policy.includePrerelease ? "0.0.1-alpha.2" : "0.1.0";
  const assetName = `Prismux-Setup-${nextVersion}.exe`;
  const baseDownloadUrl =
    sourceUsed === "gitee"
      ? `${UPDATE_ENDPOINTS.giteeWebBase}/${UPDATE_ENDPOINTS.giteeOwner}/${UPDATE_ENDPOINTS.giteeRepo}/releases/download/v${nextVersion}/${assetName}`
      : `${UPDATE_ENDPOINTS.githubWebBase}/${UPDATE_ENDPOINTS.githubOwner}/${UPDATE_ENDPOINTS.githubRepo}/releases/download/v${nextVersion}/${assetName}`;

  const effectiveUrl =
    sourceUsed === "github"
      ? formatGhProxyPreviewUrl(baseDownloadUrl, policy.customGhProxyPrefix)
      : baseDownloadUrl;

  return {
    checkedAt: Date.now(),
    currentVersion,
    hasUpdate: false,
    latestVersion: currentVersion,
    tagName: `v${currentVersion}`,
    channel: policy.includePrerelease ? "prerelease" : "stable",
    prerelease: currentVersion.includes("-"),
    releaseName: `${BRAND.appName} v${currentVersion}`,
    releaseNotes: "当前已为浏览器预览基线版本，真实检测由本地 Daemon AppUpdater 接管。",
    publishedAt: null,
    htmlUrl:
      sourceUsed === "gitee"
        ? `${UPDATE_ENDPOINTS.giteeWebBase}/${UPDATE_ENDPOINTS.giteeOwner}/${UPDATE_ENDPOINTS.giteeRepo}/releases`
        : `${UPDATE_ENDPOINTS.githubWebBase}/${UPDATE_ENDPOINTS.githubOwner}/${UPDATE_ENDPOINTS.githubRepo}/releases`,
    sourceUsed,
    usedFallbackSource: false,
    recommendedAsset: {
      name: assetName,
      kind: "setup-exe",
      downloadUrl: baseDownloadUrl,
      effectiveUrl,
      sizeBytes: null,
      sha256: SAMPLE_SHA256,
      source: sourceUsed
    },
    assets: [],
    probeReport
  };
}

export const UpdateCenterPanel: React.FC<UpdateCenterPanelProps> = ({
  open = true,
  embedded = false,
  currentVersion = APP_CURRENT_VERSION,
  portableMode = false,
  policy,
  onPolicyChange,
  onClose,
  onProbeSources,
  onCheckUpdates,
  onOpenPluginMarket
}) => {
  const [proxyDraft, setProxyDraft] = useState(policy.customGhProxyPrefix);
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [probeReport, setProbeReport] = useState<SourceProbeReport | null>(null);
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null);
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);
  const [verifySimState, setVerifySimState] = useState<{
    status: "idle" | "verified" | "rejected-missing" | "rejected-tamper";
    detail: string;
  }>({
    status: "idle",
    detail: "未执行校验：所有更新包必须携带 64 位 SHA-256 摘要，缺失或篡改 1 字节立即清理 .part 并拒装。"
  });
  const [tauriBootstrap, setTauriBootstrap] =
    useState<TauriUpdaterBootstrapSnapshot | null>(null);

  useEffect(() => {
    setProxyDraft(policy.customGhProxyPrefix);
  }, [policy.customGhProxyPrefix]);

  useEffect(() => {
    if (!open && !embedded) {
      return;
    }
    let active = true;
    void invokeTauriCommandSafe<TauriUpdaterBootstrapSnapshot>(
      "get_updater_bootstrap"
    ).then((res) => {
      if (active && res) {
        setTauriBootstrap(res);
      }
    });
    return () => {
      active = false;
    };
  }, [open, embedded]);

  useEffect(() => {
    if (!open || embedded || !onClose) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, embedded, onClose]);

  if (!embedded && !open) {
    return null;
  }

  const effectivePortable = tauriBootstrap?.portableMode ?? portableMode;
  const effectivePackageLabel =
    tauriBootstrap?.recommendedPackageKind === "portable-zip" || effectivePortable
      ? `Prismux-Portable-${currentVersion}-win-x64.zip（便携版优先）`
      : `Prismux-Setup-${currentVersion}.exe（安装版优先）`;

  const updateOrder = resolveUiUpdateSourceOrder(policy.routePreference);
  const pluginOrder = resolveUiPluginRegistryOrder(
    policy.routePreference,
    policy.pluginRegistryOverride
  );
  const proxyPreviewUrl = formatGhProxyPreviewUrl(
    SAMPLE_RELEASE_ASSET_URL,
    policy.customGhProxyPrefix
  );

  const applyPolicyPatch = (
    patch: Partial<UpdatePolicyConfig>,
    syncDraft = false
  ): void => {
    try {
      const next = normalizeUpdatePolicyPatch(policy, patch);
      setProxyError(null);
      if (syncDraft) {
        setProxyDraft(next.customGhProxyPrefix);
      }
      onPolicyChange(next);
    } catch (err) {
      setProxyError(err instanceof Error ? err.message : "策略参数校验失败");
    }
  };

  const handleRunProbe = async (): Promise<void> => {
    setProbing(true);
    try {
      if (onProbeSources) {
        const live = await onProbeSources(policy);
        setProbeReport(live);
        setPreviewNotice(null);
      } else {
        const simulated = buildPreviewProbeReport(policy.routePreference);
        setProbeReport(simulated);
        setPreviewNotice(
          "浏览器预览模式：未连接本地 Daemon，上方延迟卡片展示路由模拟结果；桌面端由 AppUpdater 并发请求 GitHub/Gitee API 实测。"
        );
      }
    } finally {
      setProbing(false);
    }
  };

  const handleRunCheck = async (): Promise<void> => {
    setChecking(true);
    try {
      if (onCheckUpdates) {
        const liveCheck = await onCheckUpdates(policy);
        setCheckResult(liveCheck);
        if (liveCheck.probeReport) {
          setProbeReport(liveCheck.probeReport);
        }
        setPreviewNotice(null);
      } else {
        const probe = probeReport ?? buildPreviewProbeReport(policy.routePreference);
        setProbeReport(probe);
        setCheckResult(buildPreviewCheckResult(currentVersion, policy, probe));
        setPreviewNotice(
          "浏览器预览模式：未连接本地 Daemon，已按当前网络路线与预发布开关生成检查状态快照。"
        );
      }
    } finally {
      setChecking(false);
    }
  };

  const content = (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* 品牌识别与当前版本基线 */}
      <div
        className="pmx-glass-content"
        style={{
          padding: "16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <img
            src="/logo.png"
            alt="Prismux Logo"
            width={48}
            height={48}
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "12px",
              objectFit: "cover",
              border: "1px solid var(--prismux-line, rgba(148,163,184,0.28))",
              flexShrink: 0
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <strong style={{ fontSize: "15px" }}>{BRAND.appName} 软件更新中心</strong>
              <span className="prismux-badge pmx-tabular">v{currentVersion}</span>
              <span className="prismux-badge">
                {effectivePortable ? "便携模式 (data/)" : "标准安装模式"}
              </span>
            </div>
            <div className="pmx-muted">
              目标包策略：{effectivePackageLabel} · 强制 64 位 SHA-256 校验与 .part 断点续传
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            className="pmx-btn"
            aria-busy={probing}
            disabled={probing}
            onClick={() => void handleRunProbe()}
          >
            {probing ? "测速中..." : "探测双源延迟"}
          </button>
          <button
            type="button"
            className="pmx-btn pmx-btn-primary"
            aria-busy={checking}
            disabled={checking}
            onClick={() => void handleRunCheck()}
          >
            {checking ? "检查中..." : "检查软件更新"}
          </button>
        </div>
      </div>

      {/* 网络路线三态切换 */}
      <section
        className="pmx-glass-content"
        aria-label="国内外双网络自动切换策略"
        style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}
      >
        <div className="pmx-kv-row">
          <strong>国内外双网络路线切换</strong>
          <span className="pmx-muted">{updateOrder.summaryZh}</span>
        </div>

        <div
          role="group"
          aria-label="网络路线偏好"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: "8px"
          }}
        >
          {NETWORK_ROUTE_PREFERENCES.map((route) => {
            const meta = NETWORK_ROUTE_META[route];
            const selected = policy.routePreference === route;
            return (
              <button
                key={route}
                type="button"
                aria-pressed={selected}
                className={`pmx-btn ${selected ? "pmx-btn-selected" : ""}`}
                style={{
                  height: "auto",
                  minHeight: "48px",
                  padding: "8px 12px",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  whiteSpace: "normal",
                  textAlign: "left"
                }}
                onClick={() => applyPolicyPatch({ routePreference: route })}
              >
                <span style={{ fontWeight: 600 }}>{meta.label}</span>
                <span className="pmx-muted" style={{ fontSize: "11.5px", lineHeight: 1.35 }}>
                  {route === "auto"
                    ? "GitHub ↔ Gitee / npm ↔ npmmirror 测速择优"
                    : route === "domestic"
                      ? "Gitee + npmmirror 主源，国际源兜底"
                      : "GitHub + npmjs 主源，国内源兜底"}
                </span>
              </button>
            );
          })}
        </div>

        <div className="pmx-muted">
          {NETWORK_ROUTE_META[policy.routePreference].description}
        </div>
      </section>

      {/* 更新通道与插件镜像源 */}
      <section
        className="pmx-glass-content"
        style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}
      >
        <div className="pmx-kv-row">
          <strong>更新通道与插件双源联动</strong>
          {onOpenPluginMarket && (
            <button
              type="button"
              className="pmx-btn pmx-btn-sm"
              onClick={onOpenPluginMarket}
            >
              打开插件市场
            </button>
          )}
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            cursor: "pointer"
          }}
        >
          <div>
            <div style={{ fontWeight: 500 }}>包含预发布版本（alpha / beta / rc）</div>
            <div className="pmx-muted">
              当前处于公开内测阶段（v{currentVersion}），默认开启以便自动接收 alpha 增量修复。
            </div>
          </div>
          <input
            type="checkbox"
            aria-label="包含预发布版本"
            checked={policy.includePrerelease}
            onChange={(e) =>
              applyPolicyPatch({ includePrerelease: e.target.checked })
            }
          />
        </label>

        <div
          style={{
            borderTop: "1px solid var(--prismux-line, rgba(148,163,184,0.2))",
            paddingTop: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}
        >
          <div className="pmx-kv-row">
            <label htmlFor="pmx-plugin-registry-override" style={{ fontWeight: 500 }}>
              Cordis 插件 npm 镜像源策略
            </label>
            <select
              id="pmx-plugin-registry-override"
              className="pmx-input"
              value={policy.pluginRegistryOverride}
              onChange={(e) =>
                applyPolicyPatch({
                  pluginRegistryOverride: e.target.value as PluginRegistryOverride
                })
              }
            >
              <option value="auto">跟随网络路线自动切换（推荐）</option>
              <option value="npmmirror">强制优先 npmmirror（registry.npmmirror.com）</option>
              <option value="npmjs">强制优先 npmjs（registry.npmjs.org）</option>
            </select>
          </div>
          <div className="pmx-muted">
            当前插件拉取顺序：{pluginOrder.summaryZh}
          </div>
        </div>
      </section>

      {/* 自定义 GitHub 加速前缀（默认留空） */}
      <section
        className="pmx-glass-content"
        style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}
      >
        <div className="pmx-kv-row">
          <label htmlFor="pmx-gh-proxy-prefix" style={{ fontWeight: 500 }}>
            自定义 GitHub 加速前缀（可选，默认留空直连）
          </label>
          <button
            type="button"
            className="pmx-btn pmx-btn-sm"
            disabled={proxyDraft.trim().length === 0 && policy.customGhProxyPrefix.length === 0}
            onClick={() => {
              setProxyDraft("");
              applyPolicyPatch({ customGhProxyPrefix: "" }, true);
            }}
          >
            清零恢复直连
          </button>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input
            id="pmx-gh-proxy-prefix"
            type="text"
            className="pmx-input"
            aria-invalid={proxyError !== null}
            placeholder="留空即不拼接任何第三方代理（如需自建可填 https://gh.example.com/）"
            value={proxyDraft}
            onChange={(e) => setProxyDraft(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="pmx-btn"
            onClick={() =>
              applyPolicyPatch({ customGhProxyPrefix: proxyDraft }, true)
            }
          >
            应用前缀
          </button>
        </div>

        {proxyError && (
          <div className="pmx-alert" role="alert">
            <span>{proxyError}</span>
          </div>
        )}

        <div className="pmx-muted" style={{ wordBreak: "break-all" }}>
          仅对 GitHub Releases 资源生效（绝不内置第三方代理；清零即恢复官方直连）：
          <code>{proxyPreviewUrl}</code>
        </div>
      </section>

      {/* 双源延迟探测与 SHA-256 校验状态卡 */}
      <section
        className="pmx-glass-content"
        style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}
      >
        <div className="pmx-kv-row">
          <strong>双源延迟探测与更新校验状态</strong>
          <span className="pmx-muted pmx-tabular">
            默认超时 {(policy.timeoutMs / 1000).toFixed(1)}s · 最多 6 跳 302 重定向
          </span>
        </div>

        {previewNotice && (
          <div
            className="pmx-warn-card"
            role="status"
            style={{ padding: "8px 12px", fontSize: "12px" }}
          >
            {previewNotice}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "8px"
          }}
        >
          {(probeReport?.sources ?? [
            {
              source: "github" as const,
              url: `${UPDATE_ENDPOINTS.githubApiBase}/repos/${UPDATE_ENDPOINTS.githubOwner}/${UPDATE_ENDPOINTS.githubRepo}/releases`,
              reachable: true,
              statusCode: null,
              latencyMs: null
            },
            {
              source: "gitee" as const,
              url: `${UPDATE_ENDPOINTS.giteeApiBase}/repos/${UPDATE_ENDPOINTS.giteeOwner}/${UPDATE_ENDPOINTS.giteeRepo}/releases`,
              reachable: true,
              statusCode: null,
              latencyMs: null
            }
          ]).map((src) => {
            const isRecommended = probeReport?.recommendedSource === src.source;
            return (
              <div
                key={src.source}
                style={{
                  padding: "12px",
                  borderRadius: "10px",
                  border: isRecommended
                    ? "1px solid var(--prismux-accent, #3b82f6)"
                    : "1px solid var(--prismux-line, rgba(148,163,184,0.24))",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px"
                }}
              >
                <div className="pmx-kv-row">
                  <strong>
                    {src.source === "github" ? "GitHub Releases" : "Gitee Releases"}
                  </strong>
                  <span className="pmx-tabular">
                    {src.latencyMs !== null ? `${src.latencyMs} ms` : "未告知"}
                  </span>
                </div>
                <div className="pmx-kv-row">
                  <span className="pmx-muted">状态</span>
                  <span>
                    {src.statusCode !== null
                      ? src.reachable
                        ? `HTTP ${src.statusCode} · 可达`
                        : `HTTP ${src.statusCode} · 不可用`
                      : "待测速"}
                    {isRecommended ? "（推荐主源）" : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {checkResult && (
          <div
            style={{
              padding: "12px",
              borderRadius: "10px",
              border: "1px solid var(--prismux-line, rgba(148,163,184,0.24))",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              fontSize: "12.5px"
            }}
          >
            <div className="pmx-kv-row">
              <strong>最近检查结果</strong>
              <span className="pmx-tabular">
                当前 v{checkResult.currentVersion} → 最新{" "}
                {checkResult.latestVersion ? `v${checkResult.latestVersion}` : "未告知"}
              </span>
            </div>
            <div className="pmx-kv-row">
              <span className="pmx-muted">采用更新源</span>
              <span>
                {checkResult.sourceUsed === "gitee" ? "Gitee Releases" : "GitHub Releases"}
                {checkResult.usedFallbackSource ? "（主源故障已自动回退）" : ""}
              </span>
            </div>
            {checkResult.recommendedAsset && (
              <div className="pmx-kv-row">
                <span className="pmx-muted">校验摘要 (.sha256)</span>
                <code className="pmx-tabular">
                  {checkResult.recommendedAsset.sha256
                    ? `${checkResult.recommendedAsset.sha256.slice(0, 16)}…（已绑定）`
                    : "缺失（已拒绝下载）"}
                </code>
              </div>
            )}
          </div>
        )}

        <div
          style={{
            padding: "12px",
            borderRadius: "10px",
            border: "1px solid var(--prismux-line, rgba(148,163,184,0.24))",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}
        >
          <div className="pmx-kv-row">
            <strong>强制 SHA-256 校验模拟状态</strong>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="pmx-btn pmx-btn-sm"
                onClick={() =>
                  setVerifySimState({
                    status: "verified",
                    detail:
                      "校验通过：.part 全量流式写入后 SHA-256 与 .sha256 文本 64 位精确一致，原子重命名为正式包。"
                  })
                }
              >
                模拟校验通过
              </button>
              <button
                type="button"
                className="pmx-btn pmx-btn-sm"
                onClick={() =>
                  setVerifySimState({
                    status: "rejected-missing",
                    detail:
                      "已拒绝下载：未检测到伴随 .sha256 或 SHA256SUMS.txt 有效 64 位摘要，禁止落地未签名安装包。"
                  })
                }
              >
                模拟缺失摘要拒装
              </button>
              <button
                type="button"
                className="pmx-btn pmx-btn-sm pmx-btn-danger"
                onClick={() =>
                  setVerifySimState({
                    status: "rejected-tamper",
                    detail:
                      "校验失败已拦截：检测到 1 字节篡改，已立即删除 .part 临时文件并终止安装。"
                  })
                }
              >
                模拟篡改拦截
              </button>
            </div>
          </div>
          <div
            role="status"
            style={{
              fontSize: "12px",
              color:
                verifySimState.status === "verified"
                  ? "var(--c-ok, #22c55e)"
                  : verifySimState.status === "idle"
                    ? "var(--prismux-muted, #94a3b8)"
                    : "var(--c-bad, #f87171)"
            }}
          >
            {verifySimState.detail}
          </div>
        </div>
      </section>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div
      className="pmx-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Prismux 软件更新中心"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose?.();
        }
      }}
    >
      <div
        className="pmx-glass-overlay prismux-glass-surface"
        style={{
          width: "min(820px, 94vw)",
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
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span className="prismux-ico" aria-hidden="true">
              ↻
            </span>
            <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>
              软件更新与国内外双源路由中心
            </h2>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="pmx-btn pmx-btn-sm"
              onClick={() => {
                setProxyDraft(DEFAULT_UPDATE_POLICY.customGhProxyPrefix);
                onPolicyChange({ ...DEFAULT_UPDATE_POLICY });
              }}
            >
              恢复默认策略
            </button>
            <button type="button" className="pmx-btn" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "16px 20px"
          }}
        >
          {content}
        </div>
      </div>
    </div>
  );
};
