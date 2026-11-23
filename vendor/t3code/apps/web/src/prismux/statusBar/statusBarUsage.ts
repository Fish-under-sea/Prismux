import type { ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";
import type { UsagePercentMode } from "./statusBarVisibility";

export type UsageWindowUrgency = "normal" | "warning" | "critical";

export interface StatusBarUsageWindowEntry {
  readonly key: string;
  readonly providerInstanceId: string;
  readonly providerName: string;
  readonly driver: ServerProvider["driver"];
  readonly windowId: string;
  readonly label: string;
  readonly usedPercent: number;
  readonly remainingPercent: number;
  readonly resetsAt: string | null;
  readonly resetsAtMs: number | null;
  readonly urgency: UsageWindowUrgency;
}

export interface StatusBarAntigravityAcpEntry {
  readonly providerInstanceId: string;
  readonly providerName: string;
  readonly authenticated: boolean;
  readonly tierLabel: string | null;
  readonly cliCommands: readonly ["/usage", "/credits"];
  readonly complianceNotice: string;
}

export interface StatusBarUsageSummary {
  /** All compliant provider usage windows, sorted most urgent first. */
  readonly windows: readonly StatusBarUsageWindowEntry[];
  /** Official ACP-only Antigravity subscription entries (strictly zero unofficial quota calls). */
  readonly antigravityEntries: readonly StatusBarAntigravityAcpEntry[];
  /** Most urgent compliant window for the compact 24px status bar pill. */
  readonly primaryWindow: StatusBarUsageWindowEntry | null;
}

export const USAGE_WARNING_USED_PERCENT = 80;
/**
 * Aligned with Orca `status-bar/usage/usage-health-tone.ts`:
 * >= 80% enters warning (amber), >= 90% enters critical/urgent (red).
 */
export const USAGE_URGENT_USED_PERCENT = 90;
export const USAGE_CRITICAL_USED_PERCENT = USAGE_URGENT_USED_PERCENT;

export const ANTIGRAVITY_COMPLIANCE_NOTICE =
  "Antigravity 严格遵循纯官方 ACP 协议（不调用私有配额接口）。如需查询实时配额或 Credits，请在官方 agy 终端运行 /usage 或 /credits。";

function clampPercent(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function classifyUsageUrgency(usedPercent: number): UsageWindowUrgency {
  if (usedPercent >= USAGE_URGENT_USED_PERCENT) return "critical";
  if (usedPercent >= USAGE_WARNING_USED_PERCENT) return "warning";
  return "normal";
}

function readWindowUsedPercent(window: ServerProviderUsageWindow): number | null {
  if (typeof window.usedPercent === "number" && Number.isFinite(window.usedPercent)) {
    return clampPercent(window.usedPercent);
  }
  const maybeRemaining = (window as { remainingPercent?: unknown }).remainingPercent;
  if (typeof maybeRemaining === "number" && Number.isFinite(maybeRemaining)) {
    return clampPercent(100 - maybeRemaining);
  }
  return null;
}

/**
 * Extracts only the official ACP `_meta.antigravity.tier` label already surfaced on provider auth.
 * Never performs network requests, token reads, or v1internal calls.
 */
export function extractAntigravityAcpTierLabel(provider: ServerProvider): string | null {
  const auth = provider.auth as Record<string, unknown> | undefined;
  if (!auth) return null;

  const candidateFields = [
    auth.subscriptionTier,
    auth.planName,
    auth.tierName,
    auth.label,
    auth.type,
    auth.details,
  ];
  for (const field of candidateFields) {
    if (typeof field !== "string") continue;
    const trimmed = field.trim();
    if (!trimmed) continue;
    // Strip verbose prefixes while keeping meaningful tier text (e.g. "Local agy CLI · Google AI Ultra").
    const parts = trimmed.split("·").map((segment) => segment.trim()).filter(Boolean);
    const tierPart = parts.find((part) => /google|ultra|pro|free|plus|enterprise|tier/i.test(part));
    if (tierPart) return tierPart;
    if (!/^local-cli$|^oauth-personal$|^authenticated$/i.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

/**
 * Collects legal usage windows across providers sorted by urgency, while strictly enforcing
 * the Antigravity ACP-only compliance boundary (zero unofficial quota scraping/display).
 */
export function collectStatusBarUsageSummary(
  providers: readonly ServerProvider[],
  now = Date.now(),
): StatusBarUsageSummary {
  const windows: StatusBarUsageWindowEntry[] = [];
  const antigravityEntries: StatusBarAntigravityAcpEntry[] = [];

  for (const provider of providers) {
    if (!provider.enabled) continue;

    // HARD COMPLIANCE BOUNDARY: Antigravity must never display or call non-ACP quota endpoints.
    if (provider.driver === "antigravity") {
      const authenticated = provider.auth?.status === "authenticated";
      antigravityEntries.push({
        providerInstanceId: provider.instanceId,
        providerName: provider.displayName || "Antigravity",
        authenticated,
        tierLabel: extractAntigravityAcpTierLabel(provider),
        cliCommands: ["/usage", "/credits"],
        complianceNotice: ANTIGRAVITY_COMPLIANCE_NOTICE,
      });
      continue;
    }

    const rawWindows = provider.usageLimits?.windows;
    if (!Array.isArray(rawWindows) || rawWindows.length === 0) continue;

    for (const win of rawWindows) {
      const usedPercent = readWindowUsedPercent(win);
      if (usedPercent === null) continue;
      const remainingPercent = Math.max(0, 100 - usedPercent);
      const resetsAt = typeof win.resetsAt === "string" && win.resetsAt.trim() ? win.resetsAt : null;
      const parsedReset = resetsAt ? Date.parse(resetsAt) : Number.NaN;
      const resetsAtMs = Number.isFinite(parsedReset) && parsedReset > now ? parsedReset : null;

      windows.push({
        key: `${provider.instanceId}:${win.id}`,
        providerInstanceId: provider.instanceId,
        providerName: provider.displayName || provider.driver,
        driver: provider.driver,
        windowId: win.id,
        label: win.label || win.id,
        usedPercent,
        remainingPercent,
        resetsAt,
        resetsAtMs,
        urgency: classifyUsageUrgency(usedPercent),
      });
    }
  }

  // Sort by highest usedPercent first (most urgent), tie-break by earliest reset time, then label.
  windows.sort((a, b) => {
    if (b.usedPercent !== a.usedPercent) return b.usedPercent - a.usedPercent;
    if (a.resetsAtMs !== null && b.resetsAtMs !== null && a.resetsAtMs !== b.resetsAtMs) {
      return a.resetsAtMs - b.resetsAtMs;
    }
    if (a.resetsAtMs !== null && b.resetsAtMs === null) return -1;
    if (a.resetsAtMs === null && b.resetsAtMs !== null) return 1;
    return a.providerName.localeCompare(b.providerName) || a.label.localeCompare(b.label);
  });

  return {
    windows,
    antigravityEntries,
    primaryWindow: windows[0] ?? null,
  };
}

export function formatUsageWindowValue(
  window: Pick<StatusBarUsageWindowEntry, "usedPercent" | "remainingPercent">,
  mode: UsagePercentMode,
): string {
  return mode === "remaining" ? `${window.remainingPercent}% 剩余` : `${window.usedPercent}% 已用`;
}

export function formatCompactUsageWindowValue(
  window: Pick<StatusBarUsageWindowEntry, "usedPercent" | "remainingPercent">,
  mode: UsagePercentMode,
): string {
  return mode === "remaining" ? `${window.remainingPercent}% left` : `${window.usedPercent}%`;
}

export function formatResetCountdown(resetsAtMs: number | null, now = Date.now()): string | null {
  if (resetsAtMs === null || !Number.isFinite(resetsAtMs)) return null;
  const diffMs = resetsAtMs - now;
  if (diffMs <= 0) return "即将重置";
  const totalMinutes = Math.ceil(diffMs / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m 后重置`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return remMinutes > 0 ? `${totalHours}h ${remMinutes}m` : `${totalHours}h`;
  }
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}
