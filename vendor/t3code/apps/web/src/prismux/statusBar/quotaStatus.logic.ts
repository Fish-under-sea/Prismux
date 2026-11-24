import type { ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";

import type {
  DaemonOfficialQuotaProviderStatus,
  DaemonOfficialQuotaSummaryResponse,
  DaemonOfficialQuotaWindowKind,
} from "../daemonClient";
import { canonicalProviderDisplayName } from "./statusBarUsage";
import type {
  StorageLike,
  UsagePercentMode,
  UsagePopoverDensity,
} from "./statusBarVisibility";

export type QuotaViewMode = UsagePopoverDensity;
export type QuotaPercentMode = UsagePercentMode;
export type QuotaTone = "normal" | "warning" | "critical";

export interface QuotaWindowItem {
  readonly id: string;
  readonly group: string;
  readonly window: DaemonOfficialQuotaWindowKind;
  readonly shortLabel: string;
  readonly detailLabel: string;
  readonly usedPercent: number;
  readonly remainingPercent: number;
  readonly resetAtIso: string | null;
  readonly resetAtMs: number | null;
  readonly tone: QuotaTone;
}

export interface QuotaAgentEntry {
  readonly id: string;
  readonly brandProvider: string;
  readonly displayName: string;
  readonly source: "official-cli" | "upstream-provider";
  readonly available: boolean;
  readonly status: DaemonOfficialQuotaProviderStatus;
  readonly error: string | null;
  readonly fetchedAt: number | null;
  readonly remainingCredits: number | null;
  readonly windows: readonly QuotaWindowItem[];
  /** Primary window shown in the bottom status bar pill & compact row (prefers weekly window). */
  readonly primaryWindow: QuotaWindowItem | null;
  /** Soonest upcoming reset timestamp across all windows (shown beside agent name in detailed view). */
  readonly soonestResetAtMs: number | null;
}

export interface QuotaStatusSummary {
  readonly agents: readonly QuotaAgentEntry[];
  readonly availableAgents: readonly QuotaAgentEntry[];
  readonly primaryAgent: QuotaAgentEntry | null;
  readonly primaryWindow: QuotaWindowItem | null;
  readonly antigravityStatus: DaemonOfficialQuotaProviderStatus | "idle";
  readonly antigravityError: string | null;
  readonly fetchedAt: number | null;
  readonly resetTimes: readonly number[];
}

export interface QuotaStatusBarPillData {
  readonly available: boolean;
  readonly brandProvider: string;
  readonly modePrefix: "已用" | "剩余";
  readonly shortLabel: string;
  readonly displayPercent: number;
  readonly tone: QuotaTone;
  readonly text: string;
}

export interface QuotaStatusBarWindowItem {
  readonly id: string;
  readonly shortLabel: string;
  readonly displayPercent: number;
  readonly tone: QuotaTone;
  readonly text: string;
}

export interface QuotaStatusBarSegmentData {
  readonly agentId: string;
  readonly brandProvider: string;
  readonly displayName: string;
  readonly tone: QuotaTone;
  readonly barWidthPercent: number;
  readonly primaryPercent: number;
  readonly windows: readonly QuotaStatusBarWindowItem[];
  readonly summaryText: string;
}

export interface QuotaStatusBarDisplayData {
  readonly viewMode: QuotaViewMode;
  readonly percentMode: QuotaPercentMode;
  readonly modePrefix: "已用" | "剩余";
  readonly tone: QuotaTone;
  readonly segments: readonly QuotaStatusBarSegmentData[];
  readonly fullText: string;
}

export interface QuotaPreferences {
  readonly viewMode: QuotaViewMode;
  readonly percentMode: QuotaPercentMode;
}

export const QUOTA_PREFS_STORAGE_KEY = "prismux.statusBar.quotaPrefs.v1";

export const DEFAULT_QUOTA_PREFERENCES: QuotaPreferences = Object.freeze({
  viewMode: "detailed",
  percentMode: "used",
});

export const QUOTA_WARNING_USED_PERCENT = 75;
export const QUOTA_CRITICAL_USED_PERCENT = 90;

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadQuotaPreferences(
  storage: StorageLike | null = defaultStorage(),
): QuotaPreferences {
  if (!storage) return { ...DEFAULT_QUOTA_PREFERENCES };
  try {
    const raw = storage.getItem(QUOTA_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_QUOTA_PREFERENCES };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      viewMode: parsed?.viewMode === "compact" ? "compact" : "detailed",
      percentMode: parsed?.percentMode === "remaining" ? "remaining" : "used",
    };
  } catch {
    return { ...DEFAULT_QUOTA_PREFERENCES };
  }
}

export function saveQuotaPreferences(
  prefs: QuotaPreferences,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(QUOTA_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota or private browsing errors.
  }
}

function clampPercent(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function classifyQuotaTone(usedPercent: number): QuotaTone {
  const clamped = clampPercent(usedPercent);
  if (clamped >= QUOTA_CRITICAL_USED_PERCENT) return "critical";
  if (clamped >= QUOTA_WARNING_USED_PERCENT) return "warning";
  return "normal";
}

export function getQuotaDisplayPercent(
  window: Pick<QuotaWindowItem, "usedPercent" | "remainingPercent">,
  percentMode: QuotaPercentMode,
): number {
  return percentMode === "remaining" ? window.remainingPercent : window.usedPercent;
}

export function getQuotaBarWidthPercent(
  window: Pick<QuotaWindowItem, "usedPercent" | "remainingPercent">,
  percentMode: QuotaPercentMode,
): number {
  const value = getQuotaDisplayPercent(window, percentMode);
  if (value <= 0) return 0;
  return Math.max(4, Math.min(100, value));
}

/**
 * Formats remaining time until quota reset in concise Chinese WITHOUT suffix,
 * matching Fig 4 compact view (`6天 14小时`, `3小时 34分钟`, `45分钟`).
 */
export function formatQuotaResetDuration(
  resetAtMs: number | null | undefined,
  now = Date.now(),
): string | null {
  if (resetAtMs === null || resetAtMs === undefined || !Number.isFinite(resetAtMs)) {
    return null;
  }
  const diffMs = resetAtMs - now;
  if (diffMs <= 0) {
    return null;
  }
  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 1) {
    return "1分钟";
  }
  if (totalMinutes < 60) {
    return `${totalMinutes}分钟`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return remMinutes > 0 ? `${totalHours}小时 ${remMinutes}分钟` : `${totalHours}小时`;
  }
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours > 0 ? `${days}天 ${remHours}小时` : `${days}天`;
}

/**
 * Formats reset countdown with `后重置` suffix, matching Fig 3 & Fig 5
 * (`6天 14小时后重置`, `3小时 34分钟后重置`, `4小时 59分钟后重置`).
 */
export function formatQuotaResetLabel(
  resetAtMs: number | null | undefined,
  now = Date.now(),
): string | null {
  if (resetAtMs === null || resetAtMs === undefined || !Number.isFinite(resetAtMs)) {
    return null;
  }
  if (resetAtMs - now <= 0) {
    return "即将重置";
  }
  const duration = formatQuotaResetDuration(resetAtMs, now);
  return duration ? `${duration}后重置` : "即将重置";
}

/**
 * Formats relative "updated at" timestamp matching Fig 5 (`更新于 刚刚`, `更新于 2 分钟前`).
 */
export function formatQuotaUpdatedAgo(
  fetchedAtMs: number | null | undefined,
  now = Date.now(),
): string {
  if (fetchedAtMs === null || fetchedAtMs === undefined || !Number.isFinite(fetchedAtMs)) {
    return "尚未更新";
  }
  const elapsedMs = Math.max(0, now - fetchedAtMs);
  if (elapsedMs < 60_000) {
    return "更新于 刚刚";
  }
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) {
    return `更新于 ${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `更新于 ${hours} 小时前`;
  }
  const days = Math.floor(hours / 24);
  return `更新于 ${days} 天前`;
}

function selectPrimaryAgentWindow(windows: readonly QuotaWindowItem[]): QuotaWindowItem | null {
  if (windows.length === 0) return null;
  // Critical short windows take immediate visibility priority.
  const critical = windows
    .filter((w) => w.usedPercent >= QUOTA_CRITICAL_USED_PERCENT)
    .sort((a, b) => b.usedPercent - a.usedPercent);
  if (critical[0]) {
    return critical[0];
  }
  // Prefer weekly window (matches Fig 1 `Gemini 周 7%` & Fig 4 `6天 14小时 7%`), highest used first.
  const weeklyWindows = windows.filter((w) => w.window === "weekly");
  if (weeklyWindows.length > 0) {
    return [...weeklyWindows].sort((a, b) => b.usedPercent - a.usedPercent)[0] ?? weeklyWindows[0]!;
  }
  return [...windows].sort((a, b) => b.usedPercent - a.usedPercent)[0] ?? windows[0]!;
}

function findSoonestFutureResetMs(
  windows: readonly QuotaWindowItem[],
  now: number,
): number | null {
  let soonest: number | null = null;
  for (const win of windows) {
    if (win.resetAtMs === null || !Number.isFinite(win.resetAtMs)) continue;
    if (win.resetAtMs <= now) continue;
    if (soonest === null || win.resetAtMs < soonest) {
      soonest = win.resetAtMs;
    }
  }
  return soonest;
}

function readUpstreamWindowPercent(win: ServerProviderUsageWindow): number | null {
  if (typeof win.usedPercent === "number" && Number.isFinite(win.usedPercent)) {
    return clampPercent(win.usedPercent);
  }
  const maybeRemaining = (win as { remainingPercent?: unknown }).remainingPercent;
  if (typeof maybeRemaining === "number" && Number.isFinite(maybeRemaining)) {
    return clampPercent(100 - maybeRemaining);
  }
  return null;
}

function normalizeUpstreamWindowKind(win: ServerProviderUsageWindow): {
  kind: DaemonOfficialQuotaWindowKind;
  shortLabel: string;
  detailLabel: string;
} {
  const rawLabel = (win.label || win.id || "").trim();
  const lower = `${win.kind ?? ""} ${rawLabel} ${win.id ?? ""}`.toLowerCase();
  if (win.kind === "weekly" || lower.includes("week") || /\b7\s*d\b/.test(lower)) {
    return {
      kind: "weekly",
      shortLabel: rawLabel && rawLabel !== "7d" ? rawLabel : "周",
      detailLabel: rawLabel && rawLabel !== "7d" ? rawLabel : "每周",
    };
  }
  if (win.kind === "session" || /\b5\s*h\b/.test(lower) || lower.includes("five hour")) {
    return {
      kind: "5h",
      shortLabel: "5h",
      detailLabel: "5h",
    };
  }
  const fallback = rawLabel || "额度";
  return {
    kind: "other",
    shortLabel: fallback,
    detailLabel: fallback,
  };
}

/**
 * Aggregates 100% compliant quota data from:
 * 1. Prismux Daemon's official `agy -p "/usage"` CLI snapshot (Antigravity)
 * 2. T3 Code upstream compliant provider snapshots (Codex / Claude Code / etc., strictly excluding Antigravity)
 */
export function aggregateQuotaSummary(
  daemonQuota: DaemonOfficialQuotaSummaryResponse | null | undefined,
  upstreamProviders: readonly ServerProvider[] = [],
  now = Date.now(),
): QuotaStatusSummary {
  const agents: QuotaAgentEntry[] = [];
  const resetTimes: number[] = [];

  // 1. Official Antigravity quota from Prismux Daemon (`agy -p "/usage"`).
  const agy = daemonQuota?.antigravity ?? null;
  if (agy && agy.available && Array.isArray(agy.windows) && agy.windows.length > 0) {
    const windows: QuotaWindowItem[] = agy.windows.map((win) => {
      const parsedMs =
        typeof win.resetAtMs === "number" && Number.isFinite(win.resetAtMs)
          ? win.resetAtMs
          : win.resetAtIso
            ? Date.parse(win.resetAtIso)
            : Number.NaN;
      const resetAtMs = Number.isFinite(parsedMs) ? parsedMs : null;
      if (resetAtMs !== null) {
        resetTimes.push(resetAtMs);
      }
      const usedPercent = clampPercent(win.usedPercent);
      const remainingPercent = clampPercent(
        typeof win.remainingPercent === "number" ? win.remainingPercent : 100 - usedPercent,
      );
      return {
        id: win.id,
        group: win.group,
        window: win.window,
        shortLabel: win.shortLabel,
        detailLabel: win.detailLabel,
        usedPercent,
        remainingPercent,
        resetAtIso: win.resetAtIso ?? null,
        resetAtMs,
        tone: classifyQuotaTone(usedPercent),
      };
    });

    agents.push({
      id: "antigravity",
      brandProvider: "antigravity",
      displayName: agy.displayName || "Antigravity",
      source: "official-cli",
      available: true,
      status: agy.status,
      error: null,
      fetchedAt: typeof agy.fetchedAt === "number" ? agy.fetchedAt : daemonQuota?.fetchedAt ?? null,
      remainingCredits:
        typeof agy.remainingCredits === "number" ? agy.remainingCredits : null,
      windows,
      primaryWindow: selectPrimaryAgentWindow(windows),
      soonestResetAtMs: findSoonestFutureResetMs(windows, now),
    });
  }

  // 2. Upstream compliant providers from T3 Code (Codex / Claude Code / etc., never Antigravity).
  for (const provider of upstreamProviders) {
    if (!provider.enabled || provider.driver === "antigravity") continue;
    const rawWindows = provider.usageLimits?.windows;
    if (!Array.isArray(rawWindows) || rawWindows.length === 0) continue;

    const windows: QuotaWindowItem[] = [];
    for (const rawWin of rawWindows) {
      const usedPercent = readUpstreamWindowPercent(rawWin);
      if (usedPercent === null) continue;
      const remainingPercent = clampPercent(100 - usedPercent);
      const resetAtIso =
        typeof rawWin.resetsAt === "string" && rawWin.resetsAt.trim().length > 0
          ? rawWin.resetsAt.trim()
          : null;
      const parsedReset = resetAtIso ? Date.parse(resetAtIso) : Number.NaN;
      const resetAtMs = Number.isFinite(parsedReset) ? parsedReset : null;
      if (resetAtMs !== null) {
        resetTimes.push(resetAtMs);
      }
      const normalized = normalizeUpstreamWindowKind(rawWin);
      windows.push({
        id: `${provider.instanceId}:${rawWin.id}`,
        group: canonicalProviderDisplayName(provider.displayName, provider.driver),
        window: normalized.kind,
        shortLabel: normalized.shortLabel,
        detailLabel: normalized.detailLabel,
        usedPercent,
        remainingPercent,
        resetAtIso,
        resetAtMs,
        tone: classifyQuotaTone(usedPercent),
      });
    }

    if (windows.length === 0) continue;

    const checkedAtMs =
      typeof provider.usageLimits?.checkedAt === "string"
        ? Date.parse(provider.usageLimits.checkedAt)
        : Number.NaN;

    agents.push({
      id: provider.instanceId,
      brandProvider: provider.driver,
      displayName: canonicalProviderDisplayName(provider.displayName, provider.driver),
      source: "upstream-provider",
      available: true,
      status: "ok",
      error: null,
      fetchedAt: Number.isFinite(checkedAtMs) ? checkedAtMs : null,
      remainingCredits: null,
      windows,
      primaryWindow: selectPrimaryAgentWindow(windows),
      soonestResetAtMs: findSoonestFutureResetMs(windows, now),
    });
  }

  const availableAgents = agents.filter((a) => a.available && a.windows.length > 0);
  const primaryAgent = availableAgents[0] ?? null;
  const primaryWindow = primaryAgent?.primaryWindow ?? null;

  return {
    agents,
    availableAgents,
    primaryAgent,
    primaryWindow,
    antigravityStatus: agy ? agy.status : "idle",
    antigravityError: agy && !agy.available ? agy.error ?? "未检测到官方 agy CLI 登录态" : null,
    fetchedAt:
      agy?.fetchedAt ??
      daemonQuota?.fetchedAt ??
      primaryAgent?.fetchedAt ??
      null,
    resetTimes,
  };
}

function toneRank(tone: QuotaTone): number {
  if (tone === "critical") return 2;
  if (tone === "warning") return 1;
  return 0;
}

function pickMoreSevereTone(a: QuotaTone, b: QuotaTone): QuotaTone {
  return toneRank(b) > toneRank(a) ? b : a;
}

/**
 * Builds the compact bottom status-bar pill representation matching Fig 1:
 * `已用 [AGY] Gemini 周 7%` or `剩余 [AGY] Gemini 周 93%`.
 */
export function buildQuotaStatusBarPill(
  summary: QuotaStatusSummary,
  percentMode: QuotaPercentMode,
): QuotaStatusBarPillData | null {
  const agent = summary.primaryAgent;
  const win = summary.primaryWindow;
  if (!agent || !win) {
    return null;
  }
  const modePrefix = percentMode === "remaining" ? "剩余" : "已用";
  const displayPercent = getQuotaDisplayPercent(win, percentMode);
  return {
    available: true,
    brandProvider: agent.brandProvider,
    modePrefix,
    shortLabel: win.shortLabel,
    displayPercent,
    tone: win.tone,
    text: `${modePrefix} ${win.shortLabel} ${displayPercent}%`,
  };
}

/**
 * Builds the bottom status-bar quota readout synced with `prefs.viewMode` (`detailed` vs `compact`)
 * and `prefs.percentMode` (`used` vs `remaining`), mirroring Orca's `StatusBarProviderSegment`:
 * - `compact`: 1 primary window per available agent (`剩余 [AGY] Gemini 周 90%`)
 * - `detailed`: inline mini progress bar + all quota windows separated by ` · `
 *   (`剩余 [AGY] [████░] Gemini 周 90% · Gemini 5h 84% · Claude/GPT 周 100% · Claude/GPT 5h 100%`)
 */
export function buildQuotaStatusBarDisplay(
  summary: QuotaStatusSummary,
  prefs: QuotaPreferences,
): QuotaStatusBarDisplayData | null {
  if (summary.availableAgents.length === 0) {
    return null;
  }

  const modePrefix: "已用" | "剩余" = prefs.percentMode === "remaining" ? "剩余" : "已用";
  const segments: QuotaStatusBarSegmentData[] = [];
  let overallTone: QuotaTone = "normal";

  for (const agent of summary.availableAgents) {
    const primaryWin = agent.primaryWindow ?? agent.windows[0] ?? null;
    if (!primaryWin) continue;

    const selectedWindows = prefs.viewMode === "detailed" ? agent.windows : [primaryWin];
    const windows: QuotaStatusBarWindowItem[] = [];
    let segmentTone: QuotaTone = primaryWin.tone;

    for (const win of selectedWindows) {
      const displayPercent = getQuotaDisplayPercent(win, prefs.percentMode);
      segmentTone = pickMoreSevereTone(segmentTone, win.tone);
      windows.push({
        id: win.id,
        shortLabel: win.shortLabel,
        displayPercent,
        tone: win.tone,
        text: `${win.shortLabel} ${displayPercent}%`,
      });
    }

    if (windows.length === 0) continue;

    overallTone = pickMoreSevereTone(overallTone, segmentTone);
    segments.push({
      agentId: agent.id,
      brandProvider: agent.brandProvider,
      displayName: agent.displayName,
      tone: segmentTone,
      barWidthPercent: getQuotaBarWidthPercent(primaryWin, prefs.percentMode),
      primaryPercent: getQuotaDisplayPercent(primaryWin, prefs.percentMode),
      windows,
      summaryText: windows.map((w) => w.text).join(" · "),
    });
  }

  if (segments.length === 0) {
    return null;
  }

  const fullText =
    segments.length === 1
      ? `${modePrefix} ${segments[0]!.summaryText}`
      : `${modePrefix} ${segments.map((seg) => `${seg.displayName} ${seg.summaryText}`).join(" | ")}`;

  return {
    viewMode: prefs.viewMode,
    percentMode: prefs.percentMode,
    modePrefix,
    tone: overallTone,
    segments,
    fullText,
  };
}
