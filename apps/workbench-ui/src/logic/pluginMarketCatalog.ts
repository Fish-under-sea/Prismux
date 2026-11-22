import {
  BRAND,
  type OfficialPluginCatalogEntry,
  type PluginDistribution,
  type PluginPermission,
  type PluginRealm
} from "@prismux/protocol";

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
 * All 5 official plugins are strictly NOT preinstalled in the minimal core.
 */
export const DEFAULT_OFFICIAL_PLUGIN_CATALOG: ReadonlyArray<OfficialPluginCatalogEntry> =
  [
    {
      id: "qq",
      packageName: `${BRAND.npmScope}/plugin-qq`,
      version: "0.1.0",
      description:
        "OneBot v11 QQ 私聊主秘书桥接与群聊隔离记忆陪聊插件（支持本机端口探测与直聊回环测试）",
      engines: { prismux: ">=0.1.0 <2.0.0" },
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
      version: "0.1.0",
      description:
        "支持定向实例绑定、租约锁（Lease Token）、进度订阅与动作/气泡分阶段交还的桌宠联动插件",
      engines: { prismux: ">=0.1.0 <2.0.0" },
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
      version: "0.1.0",
      description:
        "将 PreToolUse 中文审批单、重要邮件提醒与夜间工场回执推送至 FISH-Dock 灵动岛的桥接插件",
      engines: { prismux: ">=0.1.0 <2.0.0" },
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
      version: "0.1.0",
      description: "按需选装的 SSH 主机连接池、Web PTY 与 SFTP 运维插件",
      engines: { prismux: ">=0.1.0 <2.0.0" },
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
    },
    {
      id: "purge",
      packageName: `${BRAND.npmScope}/plugin-purge`,
      version: "0.1.0",
      description: "按需单装的模型提示词清洗与红队回滚演练插件",
      engines: { prismux: ">=0.1.0 <2.0.0" },
      realms: ["daemon", "ui"],
      permissions: ["hooks:intercept", "ui:panel"],
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
