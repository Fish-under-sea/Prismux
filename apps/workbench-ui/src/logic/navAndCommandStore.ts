export interface SidebarNavItem {
  id: string;
  defaultTitle: string;
  customTitle?: string;
  defaultIcon: string;
  customIcon?: string;
  visible: boolean;
  order: number;
  paneId?:
    | "worktree-tree"
    | "pty-terminal"
    | "git-diff"
    | "live-preview"
    | "approval-inbox"
    | "chief-chat";
  section: "workspace" | "tools" | "system";
  description?: string;
}

export interface SlashCommandItem {
  id: string;
  command: string;
  defaultTitle: string;
  customTitle?: string;
  defaultIcon: string;
  customIcon?: string;
  description: string;
  visible: boolean;
  order: number;
  shortcut?: string;
  category: "workflow" | "dial" | "memory" | "workbench";
}

export interface NavAndCommandSyncPayload {
  schemaVersion: 1;
  updatedAt: number;
  machineId?: string;
  sidebarItems: SidebarNavItem[];
  slashCommands: SlashCommandItem[];
}

export type ResolvedSidebarNavItem = SidebarNavItem & {
  displayTitle: string;
  displayIcon: string;
};

export type ResolvedSlashCommandItem = SlashCommandItem & {
  displayTitle: string;
  displayIcon: string;
};

const DEFAULT_SIDEBAR_ITEMS: ReadonlyArray<SidebarNavItem> = [
  {
    id: "chief-chat",
    defaultTitle: "主秘书对话",
    defaultIcon: "✦",
    visible: true,
    order: 0,
    paneId: "chief-chat",
    section: "workspace",
    description: "任意代理接任的主秘书常驻槽位"
  },
  {
    id: "worktree-tree",
    defaultTitle: "Worktree 工作树",
    defaultIcon: "⎇",
    visible: true,
    order: 1,
    paneId: "worktree-tree",
    section: "workspace",
    description: "隔离代码分支与 agent-scratch 收编树"
  },
  {
    id: "pty-terminal",
    defaultTitle: "持久终端 PTY",
    defaultIcon: ">_",
    visible: true,
    order: 2,
    paneId: "pty-terminal",
    section: "workspace",
    description: "2 MB 环形缓冲持久终端与历史回放"
  },
  {
    id: "git-diff",
    defaultTitle: "行级 Diff 审查",
    defaultIcon: "±",
    visible: true,
    order: 3,
    paneId: "git-diff",
    section: "workspace",
    description: "高对比度红绿行级变更与审阅批注"
  },
  {
    id: "live-preview",
    defaultTitle: "实时预览",
    defaultIcon: "◫",
    visible: true,
    order: 4,
    paneId: "live-preview",
    section: "tools",
    description: "本地开发服务器与界面预览窗格"
  },
  {
    id: "approval-inbox",
    defaultTitle: "中文审批收件箱",
    defaultIcon: "⚑",
    visible: true,
    order: 5,
    paneId: "approval-inbox",
    section: "tools",
    description: "PreToolUse 三栏中文风险解说与快捷审批"
  },
  {
    id: "appearance",
    defaultTitle: "主题与背景",
    defaultIcon: "◐",
    visible: true,
    order: 6,
    section: "system",
    description: "WebWallGL 壁纸、天体三态与四区液态玻璃"
  },
  {
    id: "plugin-market",
    defaultTitle: "插件市场",
    defaultIcon: "⊞",
    visible: true,
    order: 7,
    section: "system",
    description: "官方认证区与免 Git 社区 npm 插件"
  }
];

const DEFAULT_SLASH_COMMANDS: ReadonlyArray<SlashCommandItem> = [
  {
    id: "cmd-continue",
    command: "/continue",
    defaultTitle: "继续执行（Continue）",
    defaultIcon: "▶",
    description: "空输入幂等续跑主秘书当前线程",
    visible: true,
    order: 0,
    shortcut: "Enter",
    category: "workflow"
  },
  {
    id: "cmd-handoff",
    command: "/handoff",
    defaultTitle: "线程提纯交接",
    defaultIcon: "⇄",
    description: "提纯目标/决策/改动文件/遗留问题并在新线程续跑",
    visible: true,
    order: 1,
    shortcut: "Ctrl+Shift+H",
    category: "workflow"
  },
  {
    id: "cmd-oracle",
    command: "/oracle",
    defaultTitle: "切换 Oracle 参谋",
    defaultIcon: "◎",
    description: "切换至高阶只读架构参谋拨盘",
    visible: true,
    order: 2,
    category: "dial"
  },
  {
    id: "cmd-review",
    command: "/review",
    defaultTitle: "切换 Review 审阅",
    defaultIcon: "✓",
    description: "切换至独立只读 Diff 挑刺审阅官",
    visible: true,
    order: 3,
    category: "dial"
  },
  {
    id: "cmd-agent",
    command: "/agent",
    defaultTitle: "切换 Agent 执行",
    defaultIcon: "⚡",
    description: "恢复读写编码执行拨盘",
    visible: true,
    order: 4,
    category: "dial"
  },
  {
    id: "cmd-memory",
    command: "/memory",
    defaultTitle: "检索三域记忆",
    defaultIcon: "◈",
    description: "从 SQLite WAL + FTS5 + sqlite-vec 检索上下文",
    visible: true,
    order: 5,
    shortcut: "Ctrl+K",
    category: "memory"
  },
  {
    id: "cmd-theme",
    command: "/theme",
    defaultTitle: "主题与背景设置",
    defaultIcon: "◐",
    description: "打开全宽天体三态与四区液态玻璃抽屉",
    visible: true,
    order: 6,
    category: "workbench"
  },
  {
    id: "cmd-plugins",
    command: "/plugins",
    defaultTitle: "打开双轨插件市场",
    defaultIcon: "⊞",
    description: "按需安装官方插件或导入社区 npm 插件",
    visible: true,
    order: 7,
    category: "workbench"
  }
];

function cloneSidebarItems(items: ReadonlyArray<SidebarNavItem>): SidebarNavItem[] {
  return items
    .map((item) => ({ ...item }))
    .sort((a, b) => a.order - b.order)
    .map((item, idx) => ({ ...item, order: idx }));
}

function cloneSlashCommands(
  commands: ReadonlyArray<SlashCommandItem>
): SlashCommandItem[] {
  return commands
    .map((item) => ({ ...item }))
    .sort((a, b) => a.order - b.order)
    .map((item, idx) => ({ ...item, order: idx }));
}

function reorderArrayById<T extends { id: string; order: number }>(
  list: ReadonlyArray<T>,
  itemId: string,
  targetIndex: number
): T[] {
  const sorted = [...list].sort((a, b) => a.order - b.order);
  const fromIndex = sorted.findIndex((item) => item.id === itemId);
  if (fromIndex === -1) {
    return sorted.map((item, idx) => ({ ...item, order: idx }));
  }
  const boundedTarget = Math.max(0, Math.min(sorted.length - 1, targetIndex));
  if (fromIndex === boundedTarget) {
    return sorted.map((item, idx) => ({ ...item, order: idx }));
  }
  const [moved] = sorted.splice(fromIndex, 1);
  if (moved !== undefined) {
    sorted.splice(boundedTarget, 0, moved);
  }
  return sorted.map((item, idx) => ({ ...item, order: idx }));
}

function normalizeOverrideText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createDefaultNavAndCommandState(
  now = Date.now()
): NavAndCommandSyncPayload {
  return {
    schemaVersion: 1,
    updatedAt: now,
    sidebarItems: cloneSidebarItems(DEFAULT_SIDEBAR_ITEMS),
    slashCommands: cloneSlashCommands(DEFAULT_SLASH_COMMANDS)
  };
}

export function reorderSidebarItem(
  state: NavAndCommandSyncPayload,
  itemId: string,
  targetIndex: number,
  now = Date.now()
): NavAndCommandSyncPayload {
  return {
    ...state,
    updatedAt: now,
    sidebarItems: reorderArrayById(state.sidebarItems, itemId, targetIndex)
  };
}

export function moveSidebarItem(
  state: NavAndCommandSyncPayload,
  itemId: string,
  direction: "up" | "down",
  now = Date.now()
): NavAndCommandSyncPayload {
  const sorted = cloneSidebarItems(state.sidebarItems);
  const index = sorted.findIndex((item) => item.id === itemId);
  if (index === -1) {
    return state;
  }
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  return reorderSidebarItem(state, itemId, targetIndex, now);
}

export function toggleSidebarItemVisibility(
  state: NavAndCommandSyncPayload,
  itemId: string,
  visible?: boolean,
  now = Date.now()
): NavAndCommandSyncPayload {
  return {
    ...state,
    updatedAt: now,
    sidebarItems: state.sidebarItems.map((item) =>
      item.id === itemId
        ? { ...item, visible: visible ?? !item.visible }
        : { ...item }
    )
  };
}

export function overrideSidebarItemDisplay(
  state: NavAndCommandSyncPayload,
  itemId: string,
  patch: { customTitle?: string; customIcon?: string },
  now = Date.now()
): NavAndCommandSyncPayload {
  return {
    ...state,
    updatedAt: now,
    sidebarItems: state.sidebarItems.map((item) => {
      if (item.id !== itemId) {
        return { ...item };
      }
      const next: SidebarNavItem = { ...item };
      if ("customTitle" in patch) {
        const cleanTitle = normalizeOverrideText(patch.customTitle);
        if (cleanTitle !== undefined) {
          next.customTitle = cleanTitle;
        } else {
          delete next.customTitle;
        }
      }
      if ("customIcon" in patch) {
        const cleanIcon = normalizeOverrideText(patch.customIcon);
        if (cleanIcon !== undefined) {
          next.customIcon = cleanIcon;
        } else {
          delete next.customIcon;
        }
      }
      return next;
    })
  };
}

export function reorderSlashCommand(
  state: NavAndCommandSyncPayload,
  commandId: string,
  targetIndex: number,
  now = Date.now()
): NavAndCommandSyncPayload {
  return {
    ...state,
    updatedAt: now,
    slashCommands: reorderArrayById(state.slashCommands, commandId, targetIndex)
  };
}

export function moveSlashCommand(
  state: NavAndCommandSyncPayload,
  commandId: string,
  direction: "up" | "down",
  now = Date.now()
): NavAndCommandSyncPayload {
  const sorted = cloneSlashCommands(state.slashCommands);
  const index = sorted.findIndex((item) => item.id === commandId);
  if (index === -1) {
    return state;
  }
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  return reorderSlashCommand(state, commandId, targetIndex, now);
}

export function toggleSlashCommandVisibility(
  state: NavAndCommandSyncPayload,
  commandId: string,
  visible?: boolean,
  now = Date.now()
): NavAndCommandSyncPayload {
  return {
    ...state,
    updatedAt: now,
    slashCommands: state.slashCommands.map((item) =>
      item.id === commandId
        ? { ...item, visible: visible ?? !item.visible }
        : { ...item }
    )
  };
}

export function overrideSlashCommandDisplay(
  state: NavAndCommandSyncPayload,
  commandId: string,
  patch: { customTitle?: string; customIcon?: string },
  now = Date.now()
): NavAndCommandSyncPayload {
  return {
    ...state,
    updatedAt: now,
    slashCommands: state.slashCommands.map((item) => {
      if (item.id !== commandId) {
        return { ...item };
      }
      const next: SlashCommandItem = { ...item };
      if ("customTitle" in patch) {
        const cleanTitle = normalizeOverrideText(patch.customTitle);
        if (cleanTitle !== undefined) {
          next.customTitle = cleanTitle;
        } else {
          delete next.customTitle;
        }
      }
      if ("customIcon" in patch) {
        const cleanIcon = normalizeOverrideText(patch.customIcon);
        if (cleanIcon !== undefined) {
          next.customIcon = cleanIcon;
        } else {
          delete next.customIcon;
        }
      }
      return next;
    })
  };
}

export function getVisibleSidebarItems(
  state: NavAndCommandSyncPayload
): ResolvedSidebarNavItem[] {
  return cloneSidebarItems(state.sidebarItems)
    .filter((item) => item.visible)
    .map((item) => ({
      ...item,
      displayTitle: item.customTitle ?? item.defaultTitle,
      displayIcon: item.customIcon ?? item.defaultIcon
    }));
}

/**
 * Filters visible slash commands while preserving the user's custom sort order.
 */
export function filterSlashCommands(
  state: NavAndCommandSyncPayload,
  query: string,
  options: { includeHidden?: boolean } = {}
): ResolvedSlashCommandItem[] {
  const normalized = query.trim().toLowerCase().replace(/^\/+/, "");
  const sorted = cloneSlashCommands(state.slashCommands);
  return sorted
    .filter((item) => (options.includeHidden ? true : item.visible))
    .filter((item) => {
      if (normalized.length === 0) {
        return true;
      }
      const haystack = [
        item.command,
        item.command.replace(/^\/+/, ""),
        item.defaultTitle,
        item.customTitle ?? "",
        item.description
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    })
    .map((item) => ({
      ...item,
      displayTitle: item.customTitle ?? item.defaultTitle,
      displayIcon: item.customIcon ?? item.defaultIcon
    }));
}

/**
 * Wraps keyboard highlight index cleanly across ↑ / ↓ navigation.
 */
export function moveCommandHighlightIndex(
  currentIndex: number,
  totalCount: number,
  key: "ArrowUp" | "ArrowDown"
): number {
  if (totalCount <= 0) {
    return -1;
  }
  if (currentIndex < 0 || currentIndex >= totalCount) {
    return key === "ArrowDown" ? 0 : totalCount - 1;
  }
  if (key === "ArrowDown") {
    return (currentIndex + 1) % totalCount;
  }
  return (currentIndex - 1 + totalCount) % totalCount;
}

/**
 * Prevents closing popovers when wheel/pointer events originate inside the popover list.
 */
export function shouldIgnorePopoverCloseOnEventTarget(
  popoverEl: { contains(node: unknown): boolean } | null | undefined,
  target: unknown
): boolean {
  if (!popoverEl || target === null || target === undefined) {
    return false;
  }
  try {
    return popoverEl.contains(target);
  } catch {
    return false;
  }
}

export function exportNavAndCommandSyncPayload(
  state: NavAndCommandSyncPayload,
  machineId?: string
): string {
  const payload: NavAndCommandSyncPayload = {
    schemaVersion: 1,
    updatedAt: state.updatedAt,
    ...(machineId !== undefined && machineId.trim().length > 0
      ? { machineId: machineId.trim() }
      : state.machineId !== undefined
        ? { machineId: state.machineId }
        : {}),
    sidebarItems: cloneSidebarItems(state.sidebarItems),
    slashCommands: cloneSlashCommands(state.slashCommands)
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Restores a synced navigation & command ordering snapshot while retaining any newly
 * introduced default items so cross-device / cross-version sync stays lossless.
 */
export function restoreNavAndCommandSyncPayload(
  rawJson: string,
  baseState: NavAndCommandSyncPayload = createDefaultNavAndCommandState()
): NavAndCommandSyncPayload {
  const parsed = JSON.parse(rawJson) as Partial<NavAndCommandSyncPayload> | null;
  if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== 1) {
    throw new Error("无效的导航与命令同步配置：缺少 schemaVersion=1。");
  }

  const incomingSidebar = Array.isArray(parsed.sidebarItems)
    ? parsed.sidebarItems
    : [];
  const incomingBySidebarId = new Map<string, Partial<SidebarNavItem>>();
  for (const item of incomingSidebar) {
    if (item && typeof item.id === "string") {
      incomingBySidebarId.set(item.id, item);
    }
  }

  const mergedSidebar: SidebarNavItem[] = baseState.sidebarItems.map((base) => {
    const incoming = incomingBySidebarId.get(base.id);
    if (!incoming) {
      return { ...base, order: base.order + 1000 };
    }
    const cleanTitle = normalizeOverrideText(incoming.customTitle);
    const cleanIcon = normalizeOverrideText(incoming.customIcon);
    return {
      ...base,
      visible:
        typeof incoming.visible === "boolean" ? incoming.visible : base.visible,
      order: typeof incoming.order === "number" ? incoming.order : base.order,
      ...(cleanTitle !== undefined ? { customTitle: cleanTitle } : {}),
      ...(cleanIcon !== undefined ? { customIcon: cleanIcon } : {})
    };
  });

  const incomingCommands = Array.isArray(parsed.slashCommands)
    ? parsed.slashCommands
    : [];
  const incomingByCommandId = new Map<string, Partial<SlashCommandItem>>();
  for (const cmd of incomingCommands) {
    if (cmd && typeof cmd.id === "string") {
      incomingByCommandId.set(cmd.id, cmd);
    }
  }

  const mergedCommands: SlashCommandItem[] = baseState.slashCommands.map(
    (base) => {
      const incoming = incomingByCommandId.get(base.id);
      if (!incoming) {
        return { ...base, order: base.order + 1000 };
      }
      const cleanTitle = normalizeOverrideText(incoming.customTitle);
      const cleanIcon = normalizeOverrideText(incoming.customIcon);
      return {
        ...base,
        visible:
          typeof incoming.visible === "boolean"
            ? incoming.visible
            : base.visible,
        order:
          typeof incoming.order === "number" ? incoming.order : base.order,
        ...(cleanTitle !== undefined ? { customTitle: cleanTitle } : {}),
        ...(cleanIcon !== undefined ? { customIcon: cleanIcon } : {})
      };
    }
  );

  return {
    schemaVersion: 1,
    updatedAt:
      typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    ...(typeof parsed.machineId === "string" && parsed.machineId.trim().length > 0
      ? { machineId: parsed.machineId.trim() }
      : {}),
    sidebarItems: cloneSidebarItems(mergedSidebar),
    slashCommands: cloneSlashCommands(mergedCommands)
  };
}
