import type {
  ServerProvider,
  ServerProviderUsageWindow,
  UsageProviderKind,
} from "@prismux/core-contracts";
import type { MergedUsage } from "@prismux/core-shared/usageMerge";
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

export interface StatusBarProviderUsageLedgerEntry {
  readonly key: string;
  readonly providerKind: UsageProviderKind | string;
  readonly providerName: string;
  readonly todayTokens: number;
  readonly todayCostUsd: number;
  readonly weekTokens: number;
  readonly weekCostUsd: number;
  readonly weekRecords: number;
  readonly weekSessions: number;
  readonly cacheHitPercent: number | null;
  readonly hasQuotaWindow: boolean;
  readonly isCustomEndpoint: boolean;
}

export interface StatusBarUsageTelemetrySummary {
  readonly todayTokens: number;
  readonly todayCostUsd: number;
  readonly weekTokens: number;
  readonly weekCostUsd: number;
  readonly weekRecords: number;
  readonly weekSessions: number;
  readonly cacheHitPercent: number | null;
  readonly cacheSavingsUsd: number;
  readonly providers: readonly StatusBarProviderUsageLedgerEntry[];
}

export interface StatusBarUsageSummary {
  /** All compliant provider usage windows, sorted most urgent first. */
  readonly windows: readonly StatusBarUsageWindowEntry[];
  /** Official ACP-only Antigravity subscription entries (strictly zero unofficial quota calls). */
  readonly antigravityEntries: readonly StatusBarAntigravityAcpEntry[];
  /** Most urgent compliant window for the compact 24px status bar pill. */
  readonly primaryWindow: StatusBarUsageWindowEntry | null;
  /** Local real usage statistics (today & 7-day tokens, calls, cache hit, cost) across providers. */
  readonly telemetry: StatusBarUsageTelemetrySummary;
  /** Count of enabled non-Antigravity providers configured in connected environments. */
  readonly enabledProviderCount: number;
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

export function canonicalProviderDisplayName(rawName: string | undefined, driver?: string): string {
  const trimmed = (rawName ?? "").trim();
  const key = (driver ?? trimmed).toLowerCase();
  if (trimmed.length > 0 && !/^(codex|claudeagent|claude|antigravity|opencode|cursor|grok)$/i.test(trimmed)) {
    return trimmed;
  }
  switch (key) {
    case "codex":
      return "Codex";
    case "claudeagent":
    case "claude":
      return "Claude Code";
    case "antigravity":
      return "Antigravity";
    case "cursor":
      return "Cursor";
    case "opencode":
      return "OpenCode";
    case "grok":
      return "Grok";
    default:
      return trimmed || driver || "Provider";
  }
}

function driverToUsageKind(driver: string): UsageProviderKind | string {
  switch (driver) {
    case "claudeAgent":
      return "claude";
    case "codex":
      return "codex";
    case "cursor":
      return "cursor";
    case "opencode":
      return "opencode";
    case "antigravity":
      return "antigravity";
    default:
      return driver;
  }
}

export function formatCompactUsageTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0 tok";
  if (tokens < 1_000) return `${Math.round(tokens)} tok`;
  if (tokens < 1_000_000) {
    const k = tokens / 1_000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1)}K tok`;
  }
  if (tokens < 1_000_000_000) {
    const m = tokens / 1_000_000;
    return `${m >= 100 ? Math.round(m) : m.toFixed(1)}M tok`;
  }
  return `${(tokens / 1_000_000_000).toFixed(2)}B tok`;
}

export function formatCompactUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  if (usd < 10) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(1)}`;
  return `$${Math.round(usd)}`;
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
    if (!/^local-cli$|^authenticated$/i.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

function detectCustomEndpointProvider(provider: ServerProvider): boolean {
  const rec = provider as unknown as Record<string, unknown>;
  if (typeof rec.baseUrl === "string" && rec.baseUrl.trim().length > 0) return true;
  if (typeof rec.endpoint === "string" && rec.endpoint.trim().length > 0) return true;
  const auth = rec.auth as Record<string, unknown> | undefined;
  const authType = typeof auth?.type === "string" ? auth.type.toLowerCase() : "";
  if (authType.includes("api") || authType.includes("custom") || authType.includes("key")) {
    return true;
  }
  return false;
}

function computeCacheHitPercent(
  uncachedInput: number,
  cachedInput: number,
  cacheCreation: number,
): number | null {
  const totalInput = uncachedInput + cachedInput + cacheCreation;
  if (!Number.isFinite(totalInput) || totalInput <= 0) return null;
  return Math.round((cachedInput / totalInput) * 1000) / 10;
}

export function buildUsageTelemetrySummary(
  mergedUsage: MergedUsage | null | undefined,
  providers: readonly ServerProvider[],
  todayDayKey?: string,
  windowProviderKinds?: ReadonlySet<string>,
): StatusBarUsageTelemetrySummary {
  const todayBucket =
    mergedUsage && todayDayKey
      ? mergedUsage.daily.find((entry) => entry.day === todayDayKey) ?? null
      : mergedUsage?.daily.at(-1) ?? null;

  // Per-provider cache hit computed from mergedUsage.models
  const cacheAggByProvider = new Map<
    string,
    { uncached: number; cached: number; creation: number }
  >();
  if (mergedUsage) {
    for (const model of mergedUsage.models) {
      const cur = cacheAggByProvider.get(model.provider) ?? {
        uncached: 0,
        cached: 0,
        creation: 0,
      };
      cur.uncached += model.tokens.uncachedInputTokens;
      cur.cached += model.tokens.cachedInputTokens;
      cur.creation += model.tokens.cacheCreationTokens;
      cacheAggByProvider.set(model.provider, cur);
    }
  }

  // Track configured enabled providers by usage kind so custom-endpoint providers always show up
  const configuredByKind = new Map<
    string,
    { displayName: string; isCustomEndpoint: boolean }
  >();
  for (const provider of providers) {
    if (!provider.enabled || provider.driver === "antigravity") continue;
    const kind = driverToUsageKind(provider.driver);
    const displayName = canonicalProviderDisplayName(provider.displayName, provider.driver);
    const isCustomEndpoint = detectCustomEndpointProvider(provider);
    if (!configuredByKind.has(kind)) {
      configuredByKind.set(kind, { displayName, isCustomEndpoint });
    }
  }

  const ledgerByKind = new Map<string, StatusBarProviderUsageLedgerEntry>();

  if (mergedUsage) {
    for (const provTotals of mergedUsage.providers) {
      const kind = provTotals.provider;
      const todayProv = todayBucket?.byProvider.get(kind);
      const cacheAgg = cacheAggByProvider.get(kind);
      const configured = configuredByKind.get(kind);
      ledgerByKind.set(kind, {
        key: `usage:${kind}`,
        providerKind: kind,
        providerName: configured?.displayName ?? canonicalProviderDisplayName(undefined, kind),
        todayTokens: todayProv?.totalTokens ?? 0,
        todayCostUsd: todayProv?.costUsd ?? 0,
        weekTokens: provTotals.totalTokens,
        weekCostUsd: provTotals.costUsd,
        weekRecords: provTotals.records,
        weekSessions: provTotals.sessions,
        cacheHitPercent: cacheAgg
          ? computeCacheHitPercent(cacheAgg.uncached, cacheAgg.cached, cacheAgg.creation)
          : null,
        hasQuotaWindow: windowProviderKinds?.has(kind) ?? false,
        isCustomEndpoint: configured?.isCustomEndpoint ?? !(windowProviderKinds?.has(kind) ?? false),
      });
    }
  }

  // Ensure enabled configured providers (including custom API endpoints with 0 recent calls) appear cleanly
  for (const [kind, configured] of configuredByKind) {
    if (ledgerByKind.has(kind)) continue;
    ledgerByKind.set(kind, {
      key: `configured:${kind}`,
      providerKind: kind,
      providerName: configured.displayName,
      todayTokens: 0,
      todayCostUsd: 0,
      weekTokens: 0,
      weekCostUsd: 0,
      weekRecords: 0,
      weekSessions: 0,
      cacheHitPercent: null,
      hasQuotaWindow: windowProviderKinds?.has(kind) ?? false,
      isCustomEndpoint: configured.isCustomEndpoint || !(windowProviderKinds?.has(kind) ?? false),
    });
  }

  const providerRows = [...ledgerByKind.values()].sort(
    (a, b) =>
      b.todayTokens - a.todayTokens ||
      b.weekTokens - a.weekTokens ||
      b.weekRecords - a.weekRecords ||
      a.providerName.localeCompare(b.providerName),
  );

  const weekTokens = mergedUsage?.totalTokens ?? 0;
  const weekCostUsd = mergedUsage?.costUsd ?? 0;
  const weekRecords = mergedUsage?.records ?? 0;
  const weekSessions = mergedUsage?.sessions ?? 0;
  const cacheHitPercent = mergedUsage
    ? computeCacheHitPercent(
        mergedUsage.uncachedInputTokens,
        mergedUsage.cachedInputTokens,
        mergedUsage.cacheCreationTokens,
      )
    : null;

  return {
    todayTokens: todayBucket?.totalTokens ?? 0,
    todayCostUsd: todayBucket?.costUsd ?? 0,
    weekTokens,
    weekCostUsd,
    weekRecords,
    weekSessions,
    cacheHitPercent,
    cacheSavingsUsd: mergedUsage?.costQuality.cacheSavingsUsd ?? 0,
    providers: providerRows,
  };
}

/**
 * Collects legal usage windows across providers sorted by urgency, while strictly enforcing
 * the Antigravity ACP-only compliance boundary (zero unofficial quota scraping/display),
 * and enriches with real local today/7-day usage telemetry from Prismux's `useUsage`.
 */
export function collectStatusBarUsageSummary(
  providers: readonly ServerProvider[],
  now = Date.now(),
  mergedUsage?: MergedUsage | null,
  todayDayKey?: string,
): StatusBarUsageSummary {
  const windows: StatusBarUsageWindowEntry[] = [];
  const antigravityEntries: StatusBarAntigravityAcpEntry[] = [];
  const windowProviderKinds = new Set<string>();
  let enabledProviderCount = 0;

  for (const provider of providers) {
    if (!provider.enabled) continue;

    // HARD COMPLIANCE BOUNDARY: Antigravity must never display or call non-ACP quota endpoints.
    if (provider.driver === "antigravity") {
      const authenticated = provider.auth?.status === "authenticated";
      antigravityEntries.push({
        providerInstanceId: provider.instanceId,
        providerName: canonicalProviderDisplayName(provider.displayName, provider.driver),
        authenticated,
        tierLabel: extractAntigravityAcpTierLabel(provider),
        cliCommands: ["/usage", "/credits"],
        complianceNotice: ANTIGRAVITY_COMPLIANCE_NOTICE,
      });
      continue;
    }

    enabledProviderCount += 1;

    if (
      provider.installed === false ||
      provider.status === "disabled" ||
      provider.auth?.status !== "authenticated"
    ) {
      continue;
    }

    const rawWindows = provider.usageLimits?.windows;
    if (!Array.isArray(rawWindows) || rawWindows.length === 0) continue;

    windowProviderKinds.add(driverToUsageKind(provider.driver));

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
        providerName: canonicalProviderDisplayName(provider.displayName, provider.driver),
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

  const telemetry = buildUsageTelemetrySummary(
    mergedUsage,
    providers,
    todayDayKey,
    windowProviderKinds,
  );

  return {
    windows,
    antigravityEntries,
    primaryWindow: windows[0] ?? null,
    telemetry,
    enabledProviderCount,
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
