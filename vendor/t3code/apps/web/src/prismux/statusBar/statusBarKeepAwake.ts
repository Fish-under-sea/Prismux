import type { StorageLike } from "./statusBarVisibility";

export const KEEP_AWAKE_MODES = ["on", "agent", "off"] as const;
export type KeepAwakeMode = (typeof KEEP_AWAKE_MODES)[number];

export type KeepAwakeLocale = "zh" | "en";
export type KeepAwakeVisualTone = "active" | "standby" | "off";

export const KEEP_AWAKE_MODE_STORAGE_KEY = "prismux.statusBar.keepAwake.v1";
export const DEFAULT_KEEP_AWAKE_MODE: KeepAwakeMode = "off";

export interface KeepAwakeOptionDescriptor {
  readonly mode: KeepAwakeMode;
  readonly label: string;
  readonly description: string;
}

export interface KeepAwakeDerivationInput {
  readonly mode: KeepAwakeMode;
  readonly activeThreadCount: number;
  readonly activeAgentProcessCount: number;
  readonly daemonTaskBusy?: boolean;
  readonly desktopBridgeAvailable: boolean;
  readonly nativeActive?: boolean | null;
  readonly webWakeLockActive?: boolean;
  readonly locale?: KeepAwakeLocale;
}

export interface KeepAwakeDerivedState {
  readonly mode: KeepAwakeMode;
  readonly locale: KeepAwakeLocale;
  readonly title: string;
  readonly pillLabel: string;
  readonly statusBadgeText: string;
  readonly footerHint: string;
  readonly ariaLabel: string;
  readonly activeThreadCount: number;
  readonly activeAgentProcessCount: number;
  readonly activeTaskCount: number;
  readonly isAgentWorking: boolean;
  readonly shouldPreventSleep: boolean;
  readonly effectiveActive: boolean;
  readonly desktopBridgeAvailable: boolean;
  readonly visualTone: KeepAwakeVisualTone;
  readonly options: readonly KeepAwakeOptionDescriptor[];
}

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeKeepAwakeMode(raw: unknown): KeepAwakeMode {
  if (raw === "on" || raw === "agent" || raw === "off") {
    return raw;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const mode = (raw as { mode?: unknown }).mode;
    if (mode === "on" || mode === "agent" || mode === "off") {
      return mode;
    }
  }
  return DEFAULT_KEEP_AWAKE_MODE;
}

export function loadKeepAwakeMode(
  storage: StorageLike | null = defaultStorage(),
): KeepAwakeMode {
  if (!storage) return DEFAULT_KEEP_AWAKE_MODE;
  try {
    const raw = storage.getItem(KEEP_AWAKE_MODE_STORAGE_KEY);
    if (!raw) return DEFAULT_KEEP_AWAKE_MODE;
    const trimmed = raw.trim();
    if (trimmed === "on" || trimmed === "agent" || trimmed === "off") {
      return trimmed;
    }
    return normalizeKeepAwakeMode(JSON.parse(trimmed));
  } catch {
    return DEFAULT_KEEP_AWAKE_MODE;
  }
}

export function saveKeepAwakeMode(
  mode: KeepAwakeMode,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(KEEP_AWAKE_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage quota or private mode failures.
  }
}

export function resolveKeepAwakeLocale(languageSetting?: string | null): KeepAwakeLocale {
  if (typeof languageSetting === "string") {
    const normalized = languageSetting.trim().toLowerCase();
    if (normalized === "en" || normalized.startsWith("en-")) {
      return "en";
    }
  }
  return "zh";
}

export function countActiveRunningThreads(
  keptThreads: ReadonlyMap<unknown, ReadonlySet<unknown>> | null | undefined,
): number {
  if (!keptThreads) return 0;
  let total = 0;
  for (const threadIds of keptThreads.values()) {
    total += threadIds.size;
  }
  return total;
}

const OPTIONS_ZH: readonly KeepAwakeOptionDescriptor[] = Object.freeze([
  {
    mode: "on",
    label: "开启",
    description: "始终防止此电脑进入睡眠状态",
  },
  {
    mode: "agent",
    label: "代理",
    description: "代理工作时防止电脑进入睡眠状态",
  },
  {
    mode: "off",
    label: "关闭",
    description: "允许系统正常进入睡眠状态",
  },
]);

const OPTIONS_EN: readonly KeepAwakeOptionDescriptor[] = Object.freeze([
  {
    mode: "on",
    label: "On",
    description: "Always keep this computer awake",
  },
  {
    mode: "agent",
    label: "Agent",
    description: "Keep computer awake while agents are working",
  },
  {
    mode: "off",
    label: "Off",
    description: "Allow the system to sleep normally",
  },
]);

export function deriveKeepAwakeState(input: KeepAwakeDerivationInput): KeepAwakeDerivedState {
  const locale: KeepAwakeLocale = input.locale ?? "zh";
  const activeThreadCount = Math.max(0, Math.floor(input.activeThreadCount || 0));
  const activeAgentProcessCount = Math.max(0, Math.floor(input.activeAgentProcessCount || 0));
  const daemonBusyCount = input.daemonTaskBusy ? 1 : 0;
  const activeTaskCount = activeThreadCount + activeAgentProcessCount + daemonBusyCount;
  const isAgentWorking = activeTaskCount > 0;

  const shouldPreventSleep =
    input.mode === "on" || (input.mode === "agent" && isAgentWorking);

  const effectiveActive = shouldPreventSleep
    ? input.desktopBridgeAvailable
      ? input.nativeActive !== false
      : Boolean(input.webWakeLockActive)
    : false;

  const visualTone: KeepAwakeVisualTone =
    shouldPreventSleep && effectiveActive
      ? "active"
      : input.mode === "agent" || (shouldPreventSleep && !effectiveActive)
        ? "standby"
        : "off";

  const options = locale === "en" ? OPTIONS_EN : OPTIONS_ZH;
  const activeOption = options.find((item) => item.mode === input.mode) ?? options[2]!;
  const title = locale === "en" ? "Keep Awake" : "防止电脑休眠";

  let statusBadgeText: string;
  if (locale === "en") {
    if (input.mode === "off") {
      statusBadgeText = "Off · Inactive";
    } else if (input.mode === "on") {
      if (!input.desktopBridgeAvailable && !input.webWakeLockActive) {
        statusBadgeText = "On · Desktop Only";
      } else if (input.desktopBridgeAvailable && input.nativeActive === false) {
        statusBadgeText = "On · Syncing";
      } else {
        statusBadgeText = "On · Active";
      }
    } else if (isAgentWorking) {
      statusBadgeText =
        !input.desktopBridgeAvailable && !input.webWakeLockActive
          ? "Agent · Working (Desktop Only)"
          : "Agent · Active";
    } else {
      statusBadgeText = "Agent · Standby";
    }
  } else {
    if (input.mode === "off") {
      statusBadgeText = "关闭 · 未生效";
    } else if (input.mode === "on") {
      if (!input.desktopBridgeAvailable && !input.webWakeLockActive) {
        statusBadgeText = "开启 · 仅桌面端生效";
      } else if (input.desktopBridgeAvailable && input.nativeActive === false) {
        statusBadgeText = "开启 · 同步中";
      } else {
        statusBadgeText = "开启 · 防休眠中";
      }
    } else if (isAgentWorking) {
      statusBadgeText =
        !input.desktopBridgeAvailable && !input.webWakeLockActive
          ? "代理 · 工作中（仅桌面端）"
          : "代理 · 工作中生效";
    } else {
      statusBadgeText = "代理 · 待命中";
    }
  }

  let footerHint: string;
  if (!input.desktopBridgeAvailable) {
    if (locale === "en") {
      footerHint = input.webWakeLockActive
        ? "Web mode · Screen Wake Lock active (system sleep lock requires Desktop app)"
        : "Browser mode · System-level keep-awake applies in the Electron Desktop app";
    } else {
      footerHint = input.webWakeLockActive
        ? "浏览器模式 · 已启用屏幕 Wake Lock（系统级防休眠仅桌面端生效）"
        : "当前为浏览器模式 · 系统级防休眠仅在桌面端生效";
    }
  } else if (input.mode === "agent") {
    if (locale === "en") {
      footerHint = isAgentWorking
        ? `${activeTaskCount} active agent task${activeTaskCount > 1 ? "s" : ""} · sleep lock active`
        : "No running agent tasks · standing by";
    } else {
      footerHint = isAgentWorking
        ? `检测到 ${activeTaskCount} 个运行中代理任务，已自动保持唤醒`
        : "当前无运行中的代理任务，处于待命状态";
    }
  } else if (input.mode === "on") {
    footerHint =
      locale === "en"
        ? "System sleep prevention locked via Electron powerSaveBlocker"
        : "已通过系统电源管理持续阻止电脑进入睡眠";
  } else {
    footerHint =
      locale === "en"
        ? "Sleep lock released · following OS power settings"
        : "已释放防休眠锁，遵循系统默认电源计划";
  }

  const ariaLabel = `${title}：${statusBadgeText}`;

  return {
    mode: input.mode,
    locale,
    title,
    pillLabel: activeOption.label,
    statusBadgeText,
    footerHint,
    ariaLabel,
    activeThreadCount,
    activeAgentProcessCount,
    activeTaskCount,
    isAgentWorking,
    shouldPreventSleep,
    effectiveActive,
    desktopBridgeAvailable: input.desktopBridgeAvailable,
    visualTone,
    options,
  };
}
