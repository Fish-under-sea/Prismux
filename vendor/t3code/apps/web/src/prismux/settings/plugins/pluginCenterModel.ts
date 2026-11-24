import type { DeclarativeUiPanelSpec } from "@prismux/appearance";

export type PluginStatusTabId = "all" | "installed" | "available" | "updates";
export type PluginCategoryId = "all" | "communication" | "pet" | "ops" | "theme" | "tools";
export type PluginAssignedCategory = Exclude<PluginCategoryId, "all">;
export type PluginSourceKind = "official" | "npm" | "local";
export type PluginPermissionCategory =
  | "model"
  | "prompt"
  | "network"
  | "filesystem"
  | "shell"
  | "ui"
  | "other";

export const DEFAULT_GROUP_DISPLAY_LIMIT = 12;

export const PLUGIN_STATUS_TABS: readonly {
  readonly id: PluginStatusTabId;
  readonly label: string;
}[] = [
  { id: "all", label: "全部" },
  { id: "installed", label: "已安装" },
  { id: "available", label: "可用" },
  { id: "updates", label: "有更新" },
] as const;

export const PLUGIN_CATEGORY_CHIPS: readonly {
  readonly id: PluginCategoryId;
  readonly label: string;
}[] = [
  { id: "all", label: "全部" },
  { id: "communication", label: "通信" },
  { id: "pet", label: "桌宠" },
  { id: "ops", label: "运维" },
  { id: "theme", label: "主题" },
  { id: "tools", label: "工具" },
] as const;

export const CATEGORY_LABELS: Readonly<Record<PluginCategoryId, string>> = {
  all: "全部",
  communication: "通信",
  pet: "桌宠",
  ops: "运维",
  theme: "主题",
  tools: "工具",
};

export interface PluginCapabilityContributions {
  readonly panels: readonly string[];
  readonly commands: readonly string[];
  readonly hooks: readonly string[];
  readonly routes: readonly string[];
}

export interface PluginRuntimeLogEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly level: "info" | "warn" | "error";
  readonly source: string;
  readonly message: string;
}

export interface PluginCenterItem {
  readonly id: string;
  readonly title: string;
  readonly packageName: string;
  readonly version: string;
  readonly latestVersion: string;
  readonly installedVersion?: string;
  readonly previousVersion?: string;
  readonly description: string;
  readonly enginesPrismux: string;
  readonly realms: readonly string[];
  readonly permissions: readonly string[];
  readonly modelVisible: boolean;
  readonly modifiesSystemPrompt: boolean;
  readonly sha256: string;
  readonly bytes: number;
  readonly status: string;
  readonly source: PluginSourceKind;
  readonly distribution: "managed" | "local";
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly mounted: boolean;
  readonly hasUpdate: boolean;
  readonly installedAt: number | null;
  readonly category: PluginAssignedCategory;
  readonly featured: boolean;
  readonly contributions: PluginCapabilityContributions;
  readonly declarativeUi?: DeclarativeUiPanelSpec;
}

export interface OfficialCatalogPluginRaw {
  readonly id: string;
  readonly packageName: string;
  readonly version: string;
  readonly description: string;
  readonly enginesPrismux: string;
  readonly realms: readonly string[];
  readonly permissions: readonly string[];
  readonly modelVisible: boolean;
  readonly modifiesSystemPrompt: boolean;
  readonly sha256: string;
  readonly bytes: number;
  readonly status: string;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly mounted: boolean;
  readonly installedVersion?: string;
  readonly previousVersion?: string;
  readonly distribution?: string;
  readonly category?: string;
  readonly featured?: boolean;
  readonly contributions?: Partial<PluginCapabilityContributions>;
  readonly declarativeUi?: DeclarativeUiPanelSpec;
}

export interface InstalledPluginRaw {
  readonly id: string;
  readonly packageName: string;
  readonly version: string;
  readonly previousVersion?: string;
  readonly description: string;
  readonly enginesPrismux: string;
  readonly realms: readonly string[];
  readonly permissions: readonly string[];
  readonly modelVisible: boolean;
  readonly modifiesSystemPrompt: boolean;
  readonly distribution: string;
  readonly enabled: boolean;
  readonly mounted: boolean;
  readonly source: string;
  readonly sha256: string;
  readonly installedAt: number | null;
  readonly category?: string;
  readonly contributions?: Partial<PluginCapabilityContributions>;
  readonly declarativeUi?: DeclarativeUiPanelSpec;
}

export interface EvaluatedPermissionItem {
  readonly permission: string;
  readonly label: string;
  readonly category: PluginPermissionCategory;
  readonly elevated: boolean;
}

export interface RetiredPluginItem {
  readonly id: string;
  readonly packageName: string;
  readonly titleZh: string;
  readonly titleEn: string;
  readonly status: "deprecated";
  readonly replacedByBuiltin: true;
  readonly noticeZh: string;
  readonly noticeEn: string;
  readonly detailZh?: string;
  readonly detailEn?: string;
}

export const DEFAULT_RETIRED_OFFICIAL_PLUGINS: readonly RetiredPluginItem[] = [
  {
    id: "pet",
    packageName: "@prismux/plugin-pet",
    titleZh: "桌宠联动（pet）",
    titleEn: "Desktop Pet Bridge (pet)",
    status: "deprecated",
    replacedByBuiltin: true,
    noticeZh: "已停用：已被 Prismux 内置功能取代",
    noticeEn: "Deprecated: Replaced by Prismux built-in capabilities",
    detailZh: "原桌宠联动插件已从官方目录与构建链路移除，相关交互与状态反馈由 Prismux 内置工作台体验承接。",
    detailEn: "Retired from the official catalog; superseded by built-in Prismux capabilities.",
  },
  {
    id: "ssh",
    packageName: "@prismux/plugin-ssh",
    titleZh: "SSH 远程主机终端（ssh）",
    titleEn: "SSH Remote Terminal (ssh)",
    status: "deprecated",
    replacedByBuiltin: true,
    noticeZh: "已停用：已被 Prismux 内置功能取代",
    noticeEn: "Deprecated: Replaced by Prismux built-in capabilities",
    detailZh: "原 SSH 插件已从官方目录与构建链路移除，远程终端与主机连接由 Prismux 内置终端与工作区能力取代。",
    detailEn: "Retired from the official catalog; superseded by built-in Prismux terminal capabilities.",
  },
] as const;

export interface TrustAuditAssessment {
  readonly required: boolean;
  readonly severity: "critical" | "warning" | "info";
  readonly operation: "install" | "upgrade";
  readonly source: "official" | "npm" | "local";
  readonly targetLabel: string;
  readonly pluginId?: string;
  readonly packageNameOrTarball?: string;
  readonly localArchiveFileName?: string;
  readonly localArchiveBase64?: string;
  readonly networkPreference?: "auto" | "domestic" | "global";
  readonly fromVersion?: string;
  readonly toVersion?: string;
  readonly distribution: "managed" | "local";
  readonly sha256?: string;
  readonly modelVisible: boolean;
  readonly modifiesSystemPrompt: boolean;
  readonly riskReasons: readonly string[];
  readonly permissions: readonly EvaluatedPermissionItem[];
  readonly sensitivePermissions: readonly EvaluatedPermissionItem[];
}

export interface PluginCountsSummary {
  readonly all: number;
  readonly installed: number;
  readonly available: number;
  readonly updates: number;
  readonly byCategory: Readonly<Record<PluginCategoryId, number>>;
}

export interface GroupVisibilityResult<T> {
  readonly visible: readonly T[];
  readonly hiddenCount: number;
  readonly totalCount: number;
  readonly pinnedInstalledCount: number;
  readonly isTruncated: boolean;
}

export const OFFICIAL_TITLE_MAP: Readonly<Record<string, string>> = {
  qq: "QQ 主秘书与群聊隔离插件",
  "fishdock-hook": "FISH-Dock 灵动岛审批回执插件",
};

const OFFICIAL_CATEGORY_MAP: Readonly<Record<string, PluginAssignedCategory>> = {
  qq: "communication",
  "fishdock-hook": "communication",
};

const OFFICIAL_CONTRIBUTIONS_MAP: Readonly<Record<string, PluginCapabilityContributions>> = {
  qq: {
    panels: ["qq-bridge-console（QQ 私聊与群聊隔离控制台）"],
    commands: ["qq.send-test", "qq.reconnect-onebot"],
    hooks: ["Notification", "Stop"],
    routes: ["POST /plugins/qq/onebot/webhook", "GET /plugins/qq/status"],
  },
  "fishdock-hook": {
    panels: [],
    commands: ["fishdock.ping-island", "fishdock.sync-approvals"],
    hooks: ["PreToolUse", "Notification", "Stop"],
    routes: ["POST /plugins/fishdock/callback"],
  },
};

const OFFICIAL_DECLARATIVE_UI_MAP: Readonly<Record<string, DeclarativeUiPanelSpec>> = {
  qq: {
    ui: "components",
    schemaVersion: 1,
    title: "QQ 桥接与群聊硬隔离配置",
    description: "通过 Cordis 受限声明式液态玻璃组件配置 OneBot v11 连接，保持对模型 0 Token 开销。",
    atoms: [
      { key: "onebotWsUrl", type: "string", defaultValue: "ws://127.0.0.1:3001", persist: true },
      { key: "groupIsolationStrict", type: "boolean", defaultValue: true, persist: true },
      { key: "autoReconnect", type: "boolean", defaultValue: true, persist: true },
    ],
    actions: [
      { id: "qq:test-loopback", label: "测试回环连通性" },
      {
        id: "qq:reset-session",
        label: "重置桥接会话",
        confirm: true,
        confirmMessage: "确认重置 OneBot 会话状态？现有消息隔离策略将保持不变。",
      },
    ],
    root: {
      type: "Stack",
      direction: "column",
      gap: "sm",
      children: [
        {
          type: "Card",
          title: "OneBot v11 通道",
          subtitle: "仅监听授权本地回环地址，私聊直达主秘书、群聊物理隔离。",
          children: [
            {
              type: "Stack",
              direction: "row",
              gap: "xs",
              wrap: true,
              children: [
                { type: "Badge", label: "0 Token 视觉层", variant: "info" },
                { type: "Badge", label: "qq_group 硬隔离", variant: "success" },
              ],
            },
            {
              type: "Input",
              label: "OneBot WebSocket 地址",
              atomKey: "onebotWsUrl",
              inputType: "url",
              placeholder: "ws://127.0.0.1:3001",
            },
            {
              type: "Switch",
              label: "强制群聊记忆硬隔离",
              description: "锁定 WHERE namespace = 'social/qq-group-' || :gid，禁止访问 private/chief。",
              atomKey: "groupIsolationStrict",
            },
            {
              type: "Switch",
              label: "断线自动指数退避重连",
              atomKey: "autoReconnect",
            },
            {
              type: "Stack",
              direction: "row",
              gap: "sm",
              wrap: true,
              children: [
                {
                  type: "Button",
                  label: "测试回环连通性",
                  actionId: "qq:test-loopback",
                  variant: "primary",
                  size: "sm",
                },
                {
                  type: "Button",
                  label: "重置桥接会话",
                  actionId: "qq:reset-session",
                  variant: "outline",
                  size: "sm",
                },
              ],
            },
          ],
        },
        {
          type: "Table",
          caption: "通道作用域隔离策略",
          compact: true,
          columns: [
            { key: "scope", label: "来源作用域", mono: true },
            { key: "memory", label: "允许读取记忆域", mono: true },
            { key: "chief", label: "主秘书权限", align: "center" },
          ],
          rows: [
            { scope: "owner_private", memory: "private/chief + workspace/*", chief: true },
            { scope: "qq_group:<gid>", memory: "social/qq-group-<gid>", chief: false },
          ],
        },
      ],
    },
  },
};

const PERMISSION_META: Readonly<
  Record<string, { label: string; category: PluginPermissionCategory; elevated: boolean }>
> = {
  "network:outbound": {
    label: "发起出站网络请求（需确认目标域名可信）",
    category: "network",
    elevated: true,
  },
  "network:inbound": {
    label: "监听入站网络请求与本地端口（高敏网络权限）",
    category: "network",
    elevated: true,
  },
  "memory:private-chief": {
    label: "读写私密主秘书记忆 private/chief（高敏隐私）",
    category: "prompt",
    elevated: true,
  },
  "memory:workspace": {
    label: "读写当前工作区项目记忆 workspace/*",
    category: "other",
    elevated: false,
  },
  "memory:social-qq": {
    label: "读写隔离 QQ 群聊记忆 social/qq-group-*",
    category: "other",
    elevated: false,
  },
  "hooks:subscribe": {
    label: "只读订阅生命周期钩子事件",
    category: "other",
    elevated: false,
  },
  "hooks:intercept": {
    label: "拦截并改写工具调用与模型生命周期钩子（可影响提示词与执行）",
    category: "prompt",
    elevated: true,
  },
  "pty:spawn": {
    label: "创建交互式终端 / Shell 会话（高敏 Shell 权限）",
    category: "shell",
    elevated: true,
  },
  "shell:exec": {
    label: "执行本地系统 Shell 命令（高敏 Shell 权限）",
    category: "shell",
    elevated: true,
  },
  "process:spawn": {
    label: "启动外部子进程（高敏 Shell 权限）",
    category: "shell",
    elevated: true,
  },
  "fs:read": {
    label: "读取本地文件系统（敏感文件权限）",
    category: "filesystem",
    elevated: true,
  },
  "fs:write": {
    label: "写入或修改本地文件系统（高敏文件权限）",
    category: "filesystem",
    elevated: true,
  },
  "ui:panel": {
    label: "注册声明式工作台面板（0 Token 宿主层）",
    category: "ui",
    elevated: false,
  },
  "ui:status-bar": {
    label: "注册状态栏与顶栏胶囊组件（0 Token 宿主层）",
    category: "ui",
    elevated: false,
  },
  "pet:lease": {
    label: "管理桌宠实例租约与分阶段交还",
    category: "ui",
    elevated: false,
  },
  "notifications:push": {
    label: "推送桌面或灵动岛通知",
    category: "other",
    elevated: false,
  },
  "prompt:modify": {
    label: "修改或注入大模型系统提示词（高危 Prompt 权限）",
    category: "prompt",
    elevated: true,
  },
  "system-prompt:modify": {
    label: "修改系统提示词（高危 Prompt 权限）",
    category: "prompt",
    elevated: true,
  },
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

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "未告知";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Lightweight SemVer 2.0 comparator returning -1, 0, or 1.
 */
export function comparePluginSemver(a: string, b: string): number {
  const parse = (raw: string) => {
    const cleaned = raw.trim().replace(/^v/i, "").split("+")[0] ?? "";
    const [corePart = "", prePart = ""] = cleaned.split("-", 2);
    const nums = corePart.split(".").map((n) => Number.parseInt(n, 10));
    if (nums.length < 3 || nums.some((n) => !Number.isFinite(n) || n < 0)) {
      return null;
    }
    return {
      major: nums[0] ?? 0,
      minor: nums[1] ?? 0,
      patch: nums[2] ?? 0,
      pre: prePart ? prePart.split(".") : [],
    };
  };

  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) {
    return a.localeCompare(b);
  }
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;

  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;

  const maxLen = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < maxLen; i += 1) {
    const idA = pa.pre[i];
    const idB = pb.pre[i];
    if (idA === undefined) return -1;
    if (idB === undefined) return 1;
    const numA = /^\d+$/.test(idA) ? Number(idA) : null;
    const numB = /^\d+$/.test(idB) ? Number(idB) : null;
    if (numA !== null && numB !== null) {
      if (numA !== numB) return numA > numB ? 1 : -1;
    } else if (numA !== null) {
      return -1;
    } else if (numB !== null) {
      return 1;
    } else if (idA !== idB) {
      return idA > idB ? 1 : -1;
    }
  }
  return 0;
}

export function resolvePluginCategory(input: {
  id: string;
  packageName?: string | undefined;
  description?: string | undefined;
  category?: string | undefined;
  permissions?: readonly string[] | undefined;
}): PluginAssignedCategory {
  if (
    input.category === "communication" ||
    input.category === "pet" ||
    input.category === "ops" ||
    input.category === "theme" ||
    input.category === "tools"
  ) {
    return input.category;
  }
  const known = OFFICIAL_CATEGORY_MAP[input.id];
  if (known) return known;

  const haystack = `${input.id} ${input.packageName ?? ""} ${input.description ?? ""}`.toLowerCase();
  const perms = input.permissions ?? [];

  if (/(pet|mascot|avatar|live2d|vrm|桌宠)/.test(haystack) || perms.includes("pet:lease")) {
    return "pet";
  }
  if (
    /(qq|telegram|slack|discord|wechat|feishu|dingtalk|mail|chat|hook|island|notify|通信|通知)/.test(
      haystack,
    ) ||
    perms.includes("memory:social-qq") ||
    perms.includes("notifications:push")
  ) {
    return "communication";
  }
  if (
    /(ssh|sftp|docker|k8s|kube|server|ops|terminal|pty|deploy|devops|运维)/.test(haystack) ||
    perms.includes("pty:spawn")
  ) {
    return "ops";
  }
  if (/(theme|glass|wallpaper|skin|appearance|color|font|主题|壁纸|外观)/.test(haystack)) {
    return "theme";
  }
  return "tools";
}

function parseContributions(raw: unknown): Partial<PluginCapabilityContributions> | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  return {
    panels: asStringArray(rec.panels),
    commands: asStringArray(rec.commands),
    hooks: asStringArray(rec.hooks),
    routes: asStringArray(rec.routes),
  };
}

function resolvePluginContributions(
  id: string,
  explicit: Partial<PluginCapabilityContributions> | undefined,
  realms: readonly string[],
  permissions: readonly string[],
): PluginCapabilityContributions {
  const preset = OFFICIAL_CONTRIBUTIONS_MAP[id];
  const panels =
    explicit?.panels && explicit.panels.length > 0
      ? explicit.panels
      : preset
        ? preset.panels
        : permissions.includes("ui:panel") || realms.includes("ui")
          ? [`${id}-panel（声明式扩展面板）`]
          : [];
  const commands =
    explicit?.commands && explicit.commands.length > 0
      ? explicit.commands
      : (preset?.commands ?? []);
  const hooks =
    explicit?.hooks && explicit.hooks.length > 0
      ? explicit.hooks
      : preset
        ? preset.hooks
        : permissions.some((p) => p.startsWith("hooks:"))
          ? ["LifecycleHookBus 订阅"]
          : [];
  const routes =
    explicit?.routes && explicit.routes.length > 0
      ? explicit.routes
      : preset
        ? preset.routes
        : realms.includes("daemon") && permissions.includes("network:inbound")
          ? [`/plugins/${id}/*`]
          : [];
  return { panels, commands, hooks, routes };
}

function parseDeclarativeUiField(raw: unknown): DeclarativeUiPanelSpec | undefined {
  const rec = asRecord(raw);
  if (!rec || rec.ui !== "components" || !asRecord(rec.root)) {
    return undefined;
  }
  return rec as unknown as DeclarativeUiPanelSpec;
}

export function classifyPermission(permission: string): EvaluatedPermissionItem {
  const known = PERMISSION_META[permission];
  if (known) {
    return {
      permission,
      label: known.label,
      category: known.category,
      elevated: known.elevated,
    };
  }
  const lower = permission.toLowerCase();
  if (lower.startsWith("prompt:") || lower.includes("system-prompt") || lower.startsWith("model:")) {
    return {
      permission,
      label: `模型/提示词能力 (${permission})`,
      category: "prompt",
      elevated: true,
    };
  }
  if (lower.startsWith("network:") || lower.startsWith("net:") || lower.startsWith("http:")) {
    return {
      permission,
      label: `网络访问权限 (${permission})`,
      category: "network",
      elevated: true,
    };
  }
  if (lower.startsWith("fs:") || lower.startsWith("file:")) {
    return {
      permission,
      label: `文件系统权限 (${permission})`,
      category: "filesystem",
      elevated: true,
    };
  }
  if (lower.startsWith("shell:") || lower.startsWith("pty:") || lower.startsWith("process:") || lower.startsWith("exec:")) {
    return {
      permission,
      label: `Shell / 进程执行权限 (${permission})`,
      category: "shell",
      elevated: true,
    };
  }
  if (lower.startsWith("ui:")) {
    return {
      permission,
      label: `界面扩展权限 (${permission})`,
      category: "ui",
      elevated: false,
    };
  }
  return {
    permission,
    label: `自定义权限 (${permission})`,
    category: "other",
    elevated: false,
  };
}

export function evaluatePluginTrustAudit(
  input: {
    source: "official" | "npm" | "local";
    targetLabel: string;
    pluginId?: string | undefined;
    packageNameOrTarball?: string | undefined;
    localArchiveFileName?: string | undefined;
    localArchiveBase64?: string | undefined;
    networkPreference?: "auto" | "domestic" | "global" | undefined;
    fromVersion?: string | undefined;
    toVersion?: string | undefined;
    distribution?: "managed" | "local" | undefined;
    sha256?: string | undefined;
    modelVisible: boolean;
    modifiesSystemPrompt?: boolean | undefined;
    permissions: readonly string[];
    extraReasons?: readonly string[] | undefined;
    forceRequired?: boolean | undefined;
  },
  operation: "install" | "upgrade",
): TrustAuditAssessment {
  const allPermissions = input.permissions.map(classifyPermission);
  const sensitivePermissions = allPermissions.filter(
    (item) =>
      item.elevated ||
      item.category === "model" ||
      item.category === "prompt" ||
      item.category === "network" ||
      item.category === "filesystem" ||
      item.category === "shell",
  );

  const modifiesSystemPrompt =
    Boolean(input.modifiesSystemPrompt) ||
    allPermissions.some(
      (p) =>
        p.category === "prompt" ||
        p.permission === "hooks:intercept" ||
        p.permission.toLowerCase().includes("prompt"),
    );

  const riskReasons: string[] = [];
  if (input.modelVisible) {
    riskReasons.push(
      "该插件声明 modelVisible: true，可能向 AI 模型暴露工具、上下文或消耗额外 Token。",
    );
  }
  if (modifiesSystemPrompt) {
    riskReasons.push(
      "该插件涉及系统提示词改写、私密主秘书记忆访问或钩子拦截能力，可能改变代理执行行为。",
    );
  }
  if (sensitivePermissions.some((p) => p.category === "shell")) {
    riskReasons.push("该插件申请 Shell / PTY 进程执行权限，可启动本地或远程终端会话。");
  }
  if (sensitivePermissions.some((p) => p.category === "filesystem")) {
    riskReasons.push("该插件申请本地文件系统读写权限，请确认来源可信后再放行。");
  }
  if (sensitivePermissions.some((p) => p.category === "network")) {
    riskReasons.push("该插件申请网络通信或本地端口监听权限，请核验目标地址与完整性摘要。");
  }
  for (const extra of input.extraReasons ?? []) {
    const trimmed = extra.trim();
    if (trimmed.length > 0 && !riskReasons.includes(trimmed)) {
      riskReasons.push(trimmed);
    }
  }

  const required =
    Boolean(input.forceRequired) ||
    input.modelVisible ||
    modifiesSystemPrompt ||
    sensitivePermissions.length > 0;

  const severity: TrustAuditAssessment["severity"] =
    input.modelVisible ||
    modifiesSystemPrompt ||
    sensitivePermissions.some((p) => p.category === "shell")
      ? "critical"
      : required
        ? "warning"
        : "info";

  return {
    required,
    severity,
    operation,
    source: input.source,
    targetLabel: input.targetLabel,
    ...(input.pluginId !== undefined ? { pluginId: input.pluginId } : {}),
    ...(input.packageNameOrTarball !== undefined
      ? { packageNameOrTarball: input.packageNameOrTarball }
      : {}),
    ...(input.localArchiveFileName !== undefined
      ? { localArchiveFileName: input.localArchiveFileName }
      : {}),
    ...(input.localArchiveBase64 !== undefined
      ? { localArchiveBase64: input.localArchiveBase64 }
      : {}),
    ...(input.networkPreference !== undefined
      ? { networkPreference: input.networkPreference }
      : {}),
    ...(input.fromVersion !== undefined ? { fromVersion: input.fromVersion } : {}),
    ...(input.toVersion !== undefined ? { toVersion: input.toVersion } : {}),
    distribution: input.distribution ?? "managed",
    ...(input.sha256 ? { sha256: input.sha256 } : {}),
    modelVisible: input.modelVisible,
    modifiesSystemPrompt,
    riskReasons,
    permissions: allPermissions,
    sensitivePermissions,
  };
}

export function parseCatalogPluginsPayload(payload: unknown): OfficialCatalogPluginRaw[] {
  const root = asRecord(payload);
  const list = Array.isArray(root?.plugins) ? root.plugins : [];
  const result: OfficialCatalogPluginRaw[] = [];
  for (const item of list) {
    const rec = asRecord(item);
    if (!rec) continue;
    const id = asString(rec.id);
    if (!id) continue;
    const status = asString(rec.status, "pending");
    if (status === "deprecated") continue;
    const enginesRec = asRecord(rec.engines);
    const permissions = asStringArray(rec.permissions);
    const parsedContributions = parseContributions(rec.contributions ?? rec.contributes);
    const parsedDeclarativeUi = parseDeclarativeUiField(rec.declarativeUi ?? rec.declarativePanel);
    result.push({
      id,
      packageName: asString(rec.packageName, `@prismux/plugin-${id}`),
      version: asString(rec.version, "0.0.0"),
      description: asString(rec.description),
      enginesPrismux: asString(enginesRec?.prismux, "*"),
      realms: asStringArray(rec.realms),
      permissions,
      modelVisible: asBoolean(rec.modelVisible, false),
      modifiesSystemPrompt:
        asBoolean(rec.modifiesSystemPrompt, false) ||
        permissions.some((p) => p === "hooks:intercept" || p.toLowerCase().includes("prompt")),
      sha256: asString(rec.sha256),
      bytes: asNumber(rec.bytes, 0),
      status,
      installed: asBoolean(rec.installed, false),
      enabled: asBoolean(rec.enabled, false),
      mounted: asBoolean(rec.mounted, false),
      ...(typeof rec.installedVersion === "string" ? { installedVersion: rec.installedVersion } : {}),
      ...(typeof rec.previousVersion === "string" ? { previousVersion: rec.previousVersion } : {}),
      ...(typeof rec.distribution === "string" ? { distribution: rec.distribution } : {}),
      ...(typeof rec.category === "string" ? { category: rec.category } : {}),
      ...(typeof rec.featured === "boolean" ? { featured: rec.featured } : {}),
      ...(parsedContributions !== undefined ? { contributions: parsedContributions } : {}),
      ...(parsedDeclarativeUi !== undefined ? { declarativeUi: parsedDeclarativeUi } : {}),
    });
  }
  return result;
}

export function parseRetiredPluginsPayload(payload: unknown): RetiredPluginItem[] {
  const root = asRecord(payload);
  const rawList = Array.isArray(root?.retiredPlugins) ? root.retiredPlugins : [];
  const parsed: RetiredPluginItem[] = [];
  for (const item of rawList) {
    const rec = asRecord(item);
    if (!rec) continue;
    const id = asString(rec.id);
    if (!id) continue;
    parsed.push({
      id,
      packageName: asString(rec.packageName, `@prismux/plugin-${id}`),
      titleZh: asString(rec.titleZh, id),
      titleEn: asString(rec.titleEn, id),
      status: "deprecated",
      replacedByBuiltin: true,
      noticeZh: asString(rec.noticeZh, "已停用：已被 Prismux 内置功能取代"),
      noticeEn: asString(rec.noticeEn, "Deprecated: Replaced by Prismux built-in capabilities"),
      ...(typeof rec.detailZh === "string" ? { detailZh: rec.detailZh } : {}),
      ...(typeof rec.detailEn === "string" ? { detailEn: rec.detailEn } : {}),
    });
  }
  return parsed.length > 0 ? parsed : [...DEFAULT_RETIRED_OFFICIAL_PLUGINS];
}

export function parseInstalledPluginsPayload(payload: unknown): InstalledPluginRaw[] {
  const root = asRecord(payload);
  const list = Array.isArray(root?.plugins) ? root.plugins : [];
  const result: InstalledPluginRaw[] = [];
  for (const item of list) {
    const rec = asRecord(item);
    if (!rec) continue;
    const manifest = asRecord(rec.manifest);
    const id = asString(manifest?.id) || asString(rec.id);
    if (!id) continue;
    const permissions = asStringArray(manifest?.permissions ?? rec.permissions);
    const enginesRec = asRecord(manifest?.engines ?? rec.engines);
    const parsedContributions = parseContributions(
      manifest?.contributions ?? rec.contributions ?? rec.contributes,
    );
    const parsedDeclarativeUi = parseDeclarativeUiField(
      manifest?.declarativeUi ?? rec.declarativeUi ?? rec.declarativePanel,
    );
    result.push({
      id,
      packageName: asString(rec.packageName, asString(manifest?.packageName, id)),
      version: asString(manifest?.version) || asString(rec.version, "0.0.0"),
      ...(typeof rec.previousVersion === "string" ? { previousVersion: rec.previousVersion } : {}),
      description: asString(manifest?.description) || asString(rec.description),
      enginesPrismux: asString(enginesRec?.prismux, "*"),
      realms: asStringArray(manifest?.realms ?? rec.realms),
      permissions,
      modelVisible: asBoolean(manifest?.modelVisible ?? rec.modelVisible, false),
      modifiesSystemPrompt:
        asBoolean(manifest?.modifiesSystemPrompt ?? rec.modifiesSystemPrompt, false) ||
        permissions.some((p) => p === "hooks:intercept" || p.toLowerCase().includes("prompt")),
      distribution: asString(rec.distribution, "managed"),
      enabled: asBoolean(rec.enabled, true),
      mounted: asBoolean(rec.mounted, false),
      source: asString(rec.source, "official"),
      sha256: asString(rec.sha256),
      installedAt: typeof rec.installedAt === "number" ? rec.installedAt : null,
      ...(typeof manifest?.category === "string"
        ? { category: manifest.category }
        : typeof rec.category === "string"
          ? { category: rec.category }
          : {}),
      ...(parsedContributions !== undefined ? { contributions: parsedContributions } : {}),
      ...(parsedDeclarativeUi !== undefined ? { declarativeUi: parsedDeclarativeUi } : {}),
    });
  }
  return result;
}

export function mergePluginCenterItems(
  catalog: readonly OfficialCatalogPluginRaw[],
  installed: readonly InstalledPluginRaw[],
  previousVersionsById?: Readonly<Record<string, string>>,
): PluginCenterItem[] {
  const installedMap = new Map(installed.map((item) => [item.id, item]));
  const result: PluginCenterItem[] = [];
  const seen = new Set<string>();

  for (const cat of catalog) {
    seen.add(cat.id);
    const inst = installedMap.get(cat.id);
    const isInstalled = cat.installed || inst !== undefined;
    const installedVersion = inst?.version ?? cat.installedVersion ?? (isInstalled ? cat.version : undefined);
    const hasUpdate =
      isInstalled &&
      installedVersion !== undefined &&
      comparePluginSemver(cat.version, installedVersion) > 0;
    const previousVersion =
      inst?.previousVersion ?? cat.previousVersion ?? previousVersionsById?.[cat.id];
    const realms = inst?.realms.length ? inst.realms : cat.realms;
    const permissions = inst?.permissions.length ? inst.permissions : cat.permissions;
    const category = resolvePluginCategory({
      id: cat.id,
      packageName: cat.packageName,
      description: cat.description,
      category: cat.category ?? inst?.category,
      permissions,
    });
    const declarativeUi =
      inst?.declarativeUi ?? cat.declarativeUi ?? OFFICIAL_DECLARATIVE_UI_MAP[cat.id];

    result.push({
      id: cat.id,
      title: OFFICIAL_TITLE_MAP[cat.id] ?? cat.id,
      packageName: cat.packageName,
      version: installedVersion ?? cat.version,
      latestVersion: cat.version,
      ...(installedVersion !== undefined ? { installedVersion } : {}),
      ...(previousVersion !== undefined && previousVersion !== installedVersion
        ? { previousVersion }
        : {}),
      description: cat.description || inst?.description || "",
      enginesPrismux: cat.enginesPrismux,
      realms,
      permissions,
      modelVisible: inst?.modelVisible ?? cat.modelVisible,
      modifiesSystemPrompt: inst?.modifiesSystemPrompt ?? cat.modifiesSystemPrompt,
      sha256: cat.sha256 || inst?.sha256 || "",
      bytes: cat.bytes,
      status: cat.status,
      source: "official",
      distribution: (inst?.distribution ?? cat.distribution) === "local" ? "local" : "managed",
      installed: isInstalled,
      enabled: inst ? inst.enabled : cat.enabled,
      mounted: inst ? inst.mounted : cat.mounted,
      hasUpdate,
      installedAt: inst?.installedAt ?? null,
      category,
      featured: cat.featured ?? Boolean(OFFICIAL_TITLE_MAP[cat.id]),
      contributions: resolvePluginContributions(
        cat.id,
        inst?.contributions ?? cat.contributions,
        realms,
        permissions,
      ),
      ...(declarativeUi ? { declarativeUi } : {}),
    });
  }

  for (const inst of installed) {
    if (seen.has(inst.id)) continue;
    const previousVersion = inst.previousVersion ?? previousVersionsById?.[inst.id];
    const category = resolvePluginCategory({
      id: inst.id,
      packageName: inst.packageName,
      description: inst.description,
      category: inst.category,
      permissions: inst.permissions,
    });
    const source: PluginSourceKind =
      inst.source === "official" ? "official" : inst.source === "local" ? "local" : "npm";
    const declarativeUi = inst.declarativeUi ?? OFFICIAL_DECLARATIVE_UI_MAP[inst.id];

    result.push({
      id: inst.id,
      title: OFFICIAL_TITLE_MAP[inst.id] ?? inst.id,
      packageName: inst.packageName,
      version: inst.version,
      latestVersion: inst.version,
      installedVersion: inst.version,
      ...(previousVersion !== undefined && previousVersion !== inst.version
        ? { previousVersion }
        : {}),
      description: inst.description,
      enginesPrismux: inst.enginesPrismux,
      realms: inst.realms,
      permissions: inst.permissions,
      modelVisible: inst.modelVisible,
      modifiesSystemPrompt: inst.modifiesSystemPrompt,
      sha256: inst.sha256,
      bytes: 0,
      status: "installed",
      source,
      distribution: inst.distribution === "local" ? "local" : "managed",
      installed: true,
      enabled: inst.enabled,
      mounted: inst.mounted,
      hasUpdate: false,
      installedAt: inst.installedAt,
      category,
      featured: false,
      contributions: resolvePluginContributions(
        inst.id,
        inst.contributions,
        inst.realms,
        inst.permissions,
      ),
      ...(declarativeUi ? { declarativeUi } : {}),
    });
  }

  return result;
}

export function computePluginCounts(items: readonly PluginCenterItem[]): PluginCountsSummary {
  const byCategory: Record<PluginCategoryId, number> = {
    all: items.length,
    communication: 0,
    pet: 0,
    ops: 0,
    theme: 0,
    tools: 0,
  };
  let installed = 0;
  let available = 0;
  let updates = 0;

  for (const item of items) {
    byCategory[item.category] += 1;
    if (item.installed) {
      installed += 1;
    } else {
      available += 1;
    }
    if (item.hasUpdate) {
      updates += 1;
    }
  }

  return {
    all: items.length,
    installed,
    available,
    updates,
    byCategory,
  };
}

export function filterPluginCenterItems(
  items: readonly PluginCenterItem[],
  options: {
    readonly tab: PluginStatusTabId;
    readonly category: PluginCategoryId;
    readonly query: string;
  },
): PluginCenterItem[] {
  const normalizedQuery = options.query.trim().toLowerCase();

  return items.filter((item) => {
    if (options.tab === "installed" && !item.installed) return false;
    if (options.tab === "available" && item.installed) return false;
    if (options.tab === "updates" && !item.hasUpdate) return false;

    if (options.category !== "all" && item.category !== options.category) {
      return false;
    }

    if (normalizedQuery.length > 0) {
      const searchBlob = [
        item.id,
        item.title,
        item.packageName,
        item.description,
        CATEGORY_LABELS[item.category],
        item.source,
        ...item.permissions,
        ...item.realms,
        ...item.contributions.panels,
        ...item.contributions.commands,
        ...item.contributions.hooks,
        ...item.contributions.routes,
      ]
        .join(" ")
        .toLowerCase();
      if (!searchBlob.includes(normalizedQuery)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Issue #8 Group Cap & Pinned-Installed Rule (aligned with stablyai/orca
 * `PluginManager.tsx` `cappedPluginRows` & `PluginCatalogGroups.tsx`):
 * - When actively searching/filtering OR when user expanded the group: show ALL items.
 * - In default browsing state: keep the first `limit` (12) items in original catalog
 *   order PLUS every installed plugin past index `limit` so installing a plugin never
 *   moves its card across the grid and no installed plugin is ever truncated!
 */
export function selectVisiblePluginsForGroup<T extends { readonly installed: boolean }>(
  items: readonly T[],
  options: {
    readonly isFiltering: boolean;
    readonly expanded: boolean;
    readonly limit?: number;
  },
): GroupVisibilityResult<T> {
  const limit = Math.max(1, options.limit ?? DEFAULT_GROUP_DISPLAY_LIMIT);

  if (options.isFiltering || options.expanded || items.length <= limit) {
    const pinnedInstalledCount = items.filter((item) => item.installed).length;
    return {
      visible: items,
      hiddenCount: 0,
      totalCount: items.length,
      pinnedInstalledCount,
      isTruncated: false,
    };
  }

  const visible = items.filter((item, index) => index < limit || item.installed);
  const pinnedInstalledCount = visible.filter((item) => item.installed).length;
  const hiddenCount = items.length - visible.length;

  return {
    visible,
    hiddenCount,
    totalCount: items.length,
    pinnedInstalledCount,
    isTruncated: hiddenCount > 0,
  };
}

export function isAuditRequiredError(err: unknown): {
  required: boolean;
  message: string;
  permissions: string[];
  reasons: string[];
} {
  const message = err instanceof Error ? err.message : String(err);
  const rec = asRecord(err);
  const code = asString(rec?.code);
  const status = asNumber(rec?.status, 0);
  const details = asRecord(rec?.details);
  const nestedError = asRecord(details?.error);
  const auditPayload = asRecord(nestedError?.details) ?? details;
  const rawPermissions = Array.isArray(auditPayload?.permissions) ? auditPayload.permissions : [];
  const permissions: string[] = [];
  for (const item of rawPermissions) {
    if (typeof item === "string" && item.trim().length > 0) {
      permissions.push(item.trim());
    } else {
      const obj = asRecord(item);
      const perm = asString(obj?.permission).trim();
      if (perm.length > 0) {
        permissions.push(perm);
      }
    }
  }
  const reasons = asStringArray(auditPayload?.warnings ?? auditPayload?.reasons);
  const required =
    code === "AUDIT_CONFIRMATION_REQUIRED" ||
    status === 409 ||
    message.includes("AUDIT_CONFIRMATION_REQUIRED") ||
    message.includes("409");
  return { required, message, permissions, reasons };
}
