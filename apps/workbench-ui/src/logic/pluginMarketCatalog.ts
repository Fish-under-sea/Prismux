import {
  BRAND,
  DEFAULT_UPDATE_POLICY,
  UPDATE_ENDPOINTS,
  formatCommunityPluginPackageName,
  type NetworkRoutePreference,
  type OfficialPluginCatalogEntry,
  type PluginDistribution,
  type PluginPermission,
  type PluginRealm,
  type PluginRegistryId,
  type PluginRegistryOverride,
  type UpdatePolicyConfig,
  type UpdatePolicyPatch,
  type UpdateSourceId
} from "@prismux/protocol";

export const APP_CURRENT_VERSION = "0.0.1-alpha.1";

export interface OfficialPluginCatalogDisplayEntry
  extends OfficialPluginCatalogEntry {
  unscopedPackageName: string;
}

export interface MarketInstalledPlugin {
  id: string;
  packageName: string;
  version: string;
  distribution: PluginDistribution;
  enabled: boolean;
  realms: PluginRealm[];
  permissions: PluginPermission[];
  modelVisible: boolean;
  sha256Verified: boolean;
  installedAt: number;
}

export interface CommunityAuditDraft {
  packageName: string;
  version: string;
  realms: PluginRealm[];
  permissions: PluginPermission[];
  modelVisible: boolean;
  modifiesSystemPrompt: boolean;
  ignoredScripts: string[];
  noGitUsed: true;
  requiresYellowWarningConfirm: boolean;
  warnings: string[];
}

export const PERMISSION_ZH_LABELS: Record<string, { label: string; elevated: boolean }> = {
  "network:outbound": { label: "发起出站网络请求", elevated: false },
  "network:inbound": { label: "监听本地/入站网络端口", elevated: true },
  "memory:private-chief": { label: "读写主人私密主秘书记忆", elevated: true },
  "memory:workspace": { label: "读写工作区项目记忆", elevated: false },
  "memory:social-qq": { label: "读写隔离 QQ 群聊记忆", elevated: false },
  "hooks:subscribe": { label: "只读订阅生命周期钩子", elevated: false },
  "hooks:intercept": { label: "拦截并改写工具钩子（高风险）", elevated: true },
  "pty:spawn": { label: "创建交互式终端（PTY）", elevated: true },
  "fs:read": { label: "读取本地文件系统", elevated: false },
  "fs:write": { label: "写入本地文件系统", elevated: true },
  "ui:panel": { label: "注册工作台分屏面板", elevated: false },
  "ui:status-bar": { label: "注册顶部或底部状态组件", elevated: false },
  "pet:lease": { label: "控制桌宠实例租约与演出状态", elevated: false },
  "notifications:push": { label: "推送系统与灵动岛通知卡片", elevated: false }
};

/**
 * Built-in mirror of `plugins-official/catalog/official.json`.
 * All 4 official plugins are strictly NOT preinstalled in the minimal core.
 */
export const DEFAULT_OFFICIAL_PLUGIN_CATALOG: ReadonlyArray<OfficialPluginCatalogDisplayEntry> =
  [
    {
      id: "qq",
      packageName: `${BRAND.npmScope}/plugin-qq`,
      unscopedPackageName: formatCommunityPluginPackageName("qq"),
      version: APP_CURRENT_VERSION,
      description:
        "OneBot v11 QQ 私聊主秘书桥接与群聊隔离记忆陪聊插件（支持本机端口探测与直聊回环测试）",
      engines: { prismux: ">=0.0.1-0 <2.0.0" },
      realms: ["daemon", "ui"],
      permissions: [
        "network:outbound",
        "network:inbound",
        "memory:social-qq",
        "hooks:subscribe"
      ],
      modelVisible: false,
      sha256: null,
      bytes: null,
      status: "source-only"
    },
    {
      id: "pet",
      packageName: `${BRAND.npmScope}/plugin-pet`,
      unscopedPackageName: formatCommunityPluginPackageName("pet"),
      version: APP_CURRENT_VERSION,
      description:
        "支持定向实例绑定、租约锁（Lease Token）、进度订阅与动作/气泡分阶段交还的桌宠联动插件",
      engines: { prismux: ">=0.0.1-0 <2.0.0" },
      realms: ["ui", "daemon"],
      permissions: ["pet:lease", "ui:panel", "hooks:subscribe"],
      modelVisible: false,
      sha256: null,
      bytes: null,
      status: "source-only"
    },
    {
      id: "fishdock-hook",
      packageName: `${BRAND.npmScope}/plugin-fishdock-hook`,
      unscopedPackageName: formatCommunityPluginPackageName("fishdock-hook"),
      version: APP_CURRENT_VERSION,
      description:
        "将 PreToolUse 中文审批单、重要邮件提醒与夜间工场回执推送至 FISH-Dock 灵动岛的桥接插件",
      engines: { prismux: ">=0.0.1-0 <2.0.0" },
      realms: ["daemon"],
      permissions: ["network:outbound", "hooks:subscribe", "notifications:push"],
      modelVisible: false,
      sha256: null,
      bytes: null,
      status: "source-only"
    },
    {
      id: "ssh",
      packageName: `${BRAND.npmScope}/plugin-ssh`,
      unscopedPackageName: formatCommunityPluginPackageName("ssh"),
      version: APP_CURRENT_VERSION,
      description: "按需选装的 SSH 主机连接池、Web PTY 与 SFTP 运维插件",
      engines: { prismux: ">=0.0.1-0 <2.0.0" },
      realms: ["daemon", "ui"],
      permissions: [
        "network:outbound",
        "pty:spawn",
        "fs:read",
        "fs:write",
        "ui:panel"
      ],
      modelVisible: false,
      sha256: null,
      bytes: null,
      status: "source-only"
    }
  ];

export function validateNpmPackageSpec(rawSpec: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const trimmed = rawSpec.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      normalized: "",
      error: "请输入 npm 插件包名（例如 prismux-plugin-demo 或 @scope/prismux-plugin-foo）"
    };
  }
  if (/^(?:git\+|ssh:\/\/|git:\/\/|https?:\/\/.*\.git(?:#|$))/i.test(trimmed)) {
    return {
      valid: false,
      normalized: trimmed,
      error: "社区安装器采用免本机 Git 纯流式 npm Tarball 解包，请直接填写 npm 包名或本地 .wb-plugin/.tgz 文件名"
    };
  }
  const npmNamePattern =
    /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[0-9a-zA-Z._-]+)?$/;
  if (!npmNamePattern.test(trimmed)) {
    return {
      valid: false,
      normalized: trimmed,
      error: "包名格式不合法：仅支持标准 npm 包名（可带 @scope/ 与 @version）"
    };
  }
  return { valid: true, normalized: trimmed };
}

/**
 * Generates an interactive permission audit summary before installing a community npm plugin.
 * Plugins declaring `modelVisible: true` or prompt/hook/fs elevation trigger a yellow warning gate.
 */
export function buildCommunityAuditDraft(
  packageName: string,
  options: {
    modelVisible?: boolean;
    modifiesSystemPrompt?: boolean;
    permissions?: PluginPermission[];
    realms?: PluginRealm[];
    version?: string;
  } = {}
): CommunityAuditDraft {
  const lower = packageName.toLowerCase();
  const inferredModelVisible =
    options.modelVisible ??
    (lower.includes("prompt") ||
      lower.includes("agent") ||
      lower.includes("mcp") ||
      lower.includes("visible"));
  const modifiesSystemPrompt =
    options.modifiesSystemPrompt ??
    (lower.includes("prompt") || lower.includes("persona"));

  const permissions: PluginPermission[] =
    options.permissions ??
    (inferredModelVisible
      ? ["ui:panel", "hooks:intercept", "network:outbound"]
      : ["ui:panel", "hooks:subscribe"]);

  const warnings: string[] = [];
  if (inferredModelVisible) {
    warnings.push(
      "该插件声明 modelVisible: true，将向模型上下文暴露工具或扩展能力（会产生额外 Token 开销并影响代理行为）"
    );
  }
  if (modifiesSystemPrompt) {
    warnings.push("该插件可能修改或注入系统提示词，请确认来源可信后再授权安装");
  }
  for (const perm of permissions) {
    const meta = PERMISSION_ZH_LABELS[perm];
    if (meta?.elevated) {
      warnings.push(`高敏感权限：${meta.label} (${perm})`);
    }
  }

  return {
    packageName,
    version: options.version ?? "1.0.0",
    realms: options.realms ?? ["ui"],
    permissions,
    modelVisible: inferredModelVisible,
    modifiesSystemPrompt,
    ignoredScripts: ["preinstall", "install", "postinstall"],
    noGitUsed: true,
    requiresYellowWarningConfirm:
      inferredModelVisible || modifiesSystemPrompt || warnings.length > 0,
    warnings
  };
}

export const NETWORK_ROUTE_META: Record<
  NetworkRoutePreference,
  { label: string; shortLabel: string; description: string }
> = {
  auto: {
    label: "自动探测（推荐）",
    shortLabel: "自动探测",
    description:
      "并发测速 GitHub / Gitee 与 npmjs / npmmirror，自动选出最快可达线路并保留另一端自动兜底。"
  },
  domestic: {
    label: "国内镜像优先（Gitee + npmmirror）",
    shortLabel: "国内镜像优先",
    description:
      "优先从 Gitee Releases 与 npmmirror 拉取，网络异常或 404/5xx 时自动回退 GitHub / npmjs。"
  },
  global: {
    label: "国际直连优先（GitHub + npmjs）",
    shortLabel: "国际直连优先",
    description:
      "优先直连 GitHub Releases 与 registry.npmjs.org，失败时自动切换 Gitee / npmmirror 兜底。"
  }
};

export interface UiUpdateSourceResolution {
  preference: NetworkRoutePreference;
  primarySource: UpdateSourceId;
  fallbackSource: UpdateSourceId;
  primaryLabel: string;
  fallbackLabel: string;
  summaryZh: string;
}

export interface UiPluginRegistryResolution {
  effectiveMode: "auto-probe" | "domestic-first" | "global-first";
  primaryId: PluginRegistryId;
  fallbackId: PluginRegistryId;
  primaryUrl: string;
  fallbackUrl: string;
  summaryZh: string;
}

export function resolveUiUpdateSourceOrder(
  routePreference: NetworkRoutePreference = "auto"
): UiUpdateSourceResolution {
  if (routePreference === "domestic") {
    return {
      preference: routePreference,
      primarySource: "gitee",
      fallbackSource: "github",
      primaryLabel: "Gitee Releases",
      fallbackLabel: "GitHub Releases",
      summaryZh: "国内优先：Gitee Releases 主源 → GitHub Releases 备用回退"
    };
  }
  if (routePreference === "global") {
    return {
      preference: routePreference,
      primarySource: "github",
      fallbackSource: "gitee",
      primaryLabel: "GitHub Releases",
      fallbackLabel: "Gitee Releases",
      summaryZh: "国际优先：GitHub Releases 主源 → Gitee Releases 备用回退"
    };
  }
  return {
    preference: "auto",
    primarySource: "github",
    fallbackSource: "gitee",
    primaryLabel: "并发测速择优（GitHub ↔ Gitee）",
    fallbackLabel: "另一端自动回退",
    summaryZh: "自动探测：并发测速 GitHub ↔ Gitee，优先最快可达源并自动回退"
  };
}

export function resolveUiPluginRegistryOrder(
  routePreference: NetworkRoutePreference = "auto",
  pluginRegistryOverride: PluginRegistryOverride = "auto"
): UiPluginRegistryResolution {
  const effectiveSelector: "auto" | PluginRegistryId =
    pluginRegistryOverride !== "auto"
      ? pluginRegistryOverride
      : routePreference === "domestic"
        ? "npmmirror"
        : routePreference === "global"
          ? "npmjs"
          : "auto";

  if (effectiveSelector === "npmmirror") {
    return {
      effectiveMode: "domestic-first",
      primaryId: "npmmirror",
      fallbackId: "npmjs",
      primaryUrl: UPDATE_ENDPOINTS.npmMirrorRegistry,
      fallbackUrl: UPDATE_ENDPOINTS.npmRegistry,
      summaryZh: "npmmirror 国内镜像优先 → registry.npmjs.org 自动回退"
    };
  }
  if (effectiveSelector === "npmjs") {
    return {
      effectiveMode: "global-first",
      primaryId: "npmjs",
      fallbackId: "npmmirror",
      primaryUrl: UPDATE_ENDPOINTS.npmRegistry,
      fallbackUrl: UPDATE_ENDPOINTS.npmMirrorRegistry,
      summaryZh: "registry.npmjs.org 国际直连优先 → npmmirror 自动回退"
    };
  }
  return {
    effectiveMode: "auto-probe",
    primaryId: "npmjs",
    fallbackId: "npmmirror",
    primaryUrl: UPDATE_ENDPOINTS.npmRegistry,
    fallbackUrl: UPDATE_ENDPOINTS.npmMirrorRegistry,
    summaryZh: "npm ↔ npmmirror 并发测速择优（自动切换/404 与 5xx 回退）"
  };
}

export function formatGhProxyPreviewUrl(
  rawUrl: string,
  customGhProxyPrefix: string
): string {
  const cleanPrefix = customGhProxyPrefix.trim();
  if (cleanPrefix.length === 0) {
    return rawUrl;
  }
  if (rawUrl.startsWith(cleanPrefix)) {
    return rawUrl;
  }
  if (
    cleanPrefix.endsWith("/") ||
    cleanPrefix.endsWith("=") ||
    cleanPrefix.endsWith("?")
  ) {
    return `${cleanPrefix}${rawUrl}`;
  }
  return `${cleanPrefix}/${rawUrl}`;
}

export function normalizeUpdatePolicyPatch(
  current: UpdatePolicyConfig = DEFAULT_UPDATE_POLICY,
  patch: UpdatePolicyPatch = {}
): UpdatePolicyConfig {
  const nextPrefix =
    patch.customGhProxyPrefix !== undefined
      ? patch.customGhProxyPrefix.trim()
      : current.customGhProxyPrefix.trim();

  if (nextPrefix.length > 0 && !/^https?:\/\//i.test(nextPrefix)) {
    throw new Error("自定义 GitHub 加速前缀必须以 http:// 或 https:// 开头，或留空。");
  }

  return {
    routePreference: patch.routePreference ?? current.routePreference,
    includePrerelease: patch.includePrerelease ?? current.includePrerelease,
    customGhProxyPrefix: nextPrefix,
    pluginRegistryOverride:
      patch.pluginRegistryOverride ?? current.pluginRegistryOverride,
    timeoutMs:
      patch.timeoutMs !== undefined && Number.isFinite(patch.timeoutMs)
        ? Math.max(100, Math.min(300_000, Math.round(patch.timeoutMs)))
        : current.timeoutMs
  };
}
