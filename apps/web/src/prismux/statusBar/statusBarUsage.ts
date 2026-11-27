import type {
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageWindow,
  UsageProviderKind,
  UsageSummaryInput,
} from "@prismux/core-contracts";
import type { MergedUsage } from "@prismux/core-shared/usageMerge";
import {
  orderItemsByConfiguredProviderOrder,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { formatAgentBrandName, resolveAcpAgentBrandKey } from "../agentBrand";
import { resolveConfiguredProviderDisplayName } from "../providerDisplayName";
import type { UsagePercentMode } from "./statusBarVisibility";

export interface StatusBarProviderDisplayOptions {
  readonly entries?: ReadonlyArray<ProviderInstanceEntry> | undefined;
  readonly providerOrder?: ReadonlyArray<ProviderInstanceId> | null | undefined;
}

export interface PrismuxProviderProbeSnapshot {
  readonly providerId: string;
  readonly displayName?: string | undefined;
  readonly installed?: boolean | undefined;
  readonly version?: string | null | undefined;
  readonly binaryPath?: string | null | undefined;
  readonly status?: string | undefined;
  readonly authMode:
    | "api_or_custom"
    | "subscription_oauth"
    | "local"
    | "unauthenticated"
    | "unknown"
    | string;
  readonly authSource: string;
  readonly endpoint?: string | null | undefined;
  readonly authLabel?: string | undefined;
  readonly checkedAt?: string | undefined;
}

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

/** Bottom-left Today/7-day local token telemetry background auto-refresh interval: 30 minutes. */
export const STATUS_BAR_USAGE_AUTO_REFRESH_INTERVAL_MS = 30 * 60 * 1_000;

export function isSameUsageWindow(a: UsageSummaryInput, b: UsageSummaryInput): boolean {
  return (
    a.sinceDay === b.sinceDay &&
    a.untilDay === b.untilDay &&
    a.timeZone === b.timeZone &&
    (a.resolution ?? "day") === (b.resolution ?? "day") &&
    a.sinceTime === b.sinceTime &&
    a.untilTime === b.untilTime
  );
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
  const driverTrimmed = (driver ?? "").trim();
  if (!trimmed && !driverTrimmed) {
    return "Provider";
  }
  return formatAgentBrandName(driverTrimmed || trimmed, trimmed || undefined);
}

export function normalizeUsageProviderKind(raw: string): UsageProviderKind | string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  switch (lower) {
    case "claudeagent":
    case "claude-agent":
    case "claude_agent":
    case "claude":
    case "claude-code":
    case "claude_code":
    case "claudecode":
    case "cc":
      return "claude";
    case "codex":
    case "openai-codex":
    case "openai_codex":
      return "codex";
    case "antigravity":
    case "agy":
    case "antigravity-cli":
    case "antigravity_cli":
    case "google-antigravity":
    case "google_antigravity":
    case "personal-antigravity":
    case "personal-agy":
      return "antigravity";
    case "cursor":
      return "cursor";
    case "opencode":
    case "open-code":
    case "open_code":
      return "opencode";
    case "dsh":
    case "dsh-acp":
    case "dsh_acp":
    case "dsh-cli":
    case "dsh_cli":
    case "dsh-next":
    case "dsh_next":
    case "deepseek-harness":
    case "deepseek_harness":
    case "deepseek-harness-acp":
    case "deepseek_harness_acp":
      return "dsh";
    case "pi":
    case "pi-coding-agent":
      return "pi";
    case "grok":
      return "grok";
    case "muse":
      return "muse";
    case "gemini":
    case "gemini-cli":
    case "gemini_cli":
      return "gemini";
    default:
      if (/^(?:antigravity|agy)(?:[-_:\s].*)?$/i.test(lower)) {
        return "antigravity";
      }
      return trimmed;
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
    const parts = trimmed
      .split("·")
      .map((segment) => segment.trim())
      .filter(Boolean);
    const tierPart = parts.find((part) => /google|ultra|pro|free|plus|enterprise|tier/i.test(part));
    if (tierPart) return tierPart;
    if (!/^local-cli$|^authenticated$/i.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

/**
 * Resolves the canonical usage provider kind for a `ServerProvider`.
 * For `acpRegistry` instances, resolves via `resolveAcpAgentBrandKey` (checking
 * `acpRegistryAgentId`, `acpCommandPath`, `instanceId`, and `displayName`) and falls back
 * to `acpRegistryAgentId` or `instanceId` — never raw `"acpRegistry"`.
 */
export function resolveServerProviderUsageKind(
  provider: ServerProvider,
  entries?: ReadonlyArray<ProviderInstanceEntry>,
): UsageProviderKind | string {
  if (provider.driver === "acpRegistry") {
    const entry = entries?.find((candidate) => candidate.instanceId === provider.instanceId);
    const acpBrand = resolveAcpAgentBrandKey({
      agentId: entry?.acpRegistryAgentId,
      commandPath: entry?.acpCommandPath,
      instanceId: provider.instanceId,
      displayName: entry?.displayName ?? provider.displayName,
    });
    if (acpBrand) {
      return normalizeUsageProviderKind(acpBrand);
    }
    const fallback = entry?.acpRegistryAgentId?.trim().toLowerCase() || provider.instanceId;
    return normalizeUsageProviderKind(fallback);
  }
  return normalizeUsageProviderKind(provider.driver);
}

function detectCustomEndpointProvider(
  provider: ServerProvider,
  entries?: ReadonlyArray<ProviderInstanceEntry>,
): boolean {
  if (resolveServerProviderUsageKind(provider, entries) === "antigravity") {
    // Official local `agy` CLI account login is never a custom endpoint.
    return false;
  }
  const rec = provider as unknown as Record<string, unknown>;
  if (typeof rec.baseUrl === "string" && rec.baseUrl.trim().length > 0) return true;
  if (typeof rec.endpoint === "string" && rec.endpoint.trim().length > 0) return true;
  const auth = rec.auth as Record<string, unknown> | undefined;
  if (typeof auth?.endpoint === "string" && auth.endpoint.trim().length > 0) return true;
  if (typeof auth?.baseUrl === "string" && auth.baseUrl.trim().length > 0) return true;
  if (auth?.requiresOpenaiAuth === false) return true;
  const authType = typeof auth?.type === "string" ? auth.type.trim().toLowerCase() : "";
  if (authType === "customendpoint" || authType.includes("custom")) {
    return true;
  }
  return false;
}

/**
 * Classifies whether a provider uses a custom/proxy endpoint from the authoritative
 * Daemon `PrismuxProviderProbeService` snapshot.
 * Returns `null` only when the probe itself is indeterminate (`unauthenticated`/`unknown`
 * with no auth source) so `ServerProvider` metadata can still provide a safe fallback.
 */
function classifyProbeSnapshotCustomEndpoint(
  snapshot: PrismuxProviderProbeSnapshot,
): boolean | null {
  const authMode = snapshot.authMode.trim().toLowerCase();
  const authSource = snapshot.authSource.trim().toLowerCase();
  if (authMode === "subscription_oauth" || authSource === "official_oauth") {
    return false;
  }
  if (
    authSource === "ccs_or_magpie" ||
    authSource === "custom_endpoint" ||
    (authMode === "api_or_custom" &&
      typeof snapshot.endpoint === "string" &&
      snapshot.endpoint.trim().length > 0)
  ) {
    return true;
  }
  if (
    (authMode === "unauthenticated" || authMode === "unknown") &&
    (authSource === "none" || authSource === "")
  ) {
    return null;
  }
  return false;
}

function resolveProviderIsCustomEndpoint(
  normalizedKind: string,
  configured: { readonly isCustomEndpoint: boolean } | undefined,
  probeSnapshot: PrismuxProviderProbeSnapshot | undefined,
): boolean {
  if (probeSnapshot) {
    const fromProbe = classifyProbeSnapshotCustomEndpoint(probeSnapshot);
    if (fromProbe !== null) {
      return fromProbe;
    }
  }
  if (normalizedKind === "antigravity") {
    return false;
  }
  // Never guess custom endpoint solely from missing quota windows; unknown defaults to false ("本地统计").
  return configured?.isCustomEndpoint ?? false;
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

function resolveStatusBarProviderName(
  idOrDriver: string,
  fallbackDisplayName: string | undefined,
  driver: string | undefined,
  entries: ReadonlyArray<ProviderInstanceEntry> | undefined,
): string {
  const fallback = canonicalProviderDisplayName(fallbackDisplayName, driver ?? idOrDriver);
  return resolveConfiguredProviderDisplayName({
    provider: idOrDriver,
    instanceId: idOrDriver,
    driverKind: driver,
    providerInstances: entries,
    fallbackDisplayName: fallback,
  });
}

export function buildUsageTelemetrySummary(
  mergedUsage: MergedUsage | null | undefined,
  providers: readonly ServerProvider[],
  todayDayKey?: string,
  windowProviderKinds?: ReadonlySet<string>,
  probeSnapshots?: readonly PrismuxProviderProbeSnapshot[] | null,
  displayOptions?: StatusBarProviderDisplayOptions,
): StatusBarUsageTelemetrySummary {
  const todayBucket =
    mergedUsage && todayDayKey
      ? (mergedUsage.daily.find((entry) => entry.day === todayDayKey) ?? null)
      : (mergedUsage?.daily.at(-1) ?? null);

  // Per-provider today totals aggregated by normalized usage provider kind
  const todayByNormalizedKind = new Map<string, { totalTokens: number; costUsd: number }>();
  if (todayBucket) {
    for (const [rawKey, totals] of todayBucket.byProvider) {
      const normalized = normalizeUsageProviderKind(rawKey);
      const cur = todayByNormalizedKind.get(normalized) ?? { totalTokens: 0, costUsd: 0 };
      cur.totalTokens += totals.totalTokens;
      cur.costUsd += totals.costUsd;
      todayByNormalizedKind.set(normalized, cur);
    }
  }

  // Per-provider cache hit computed from mergedUsage.models (keyed by normalized provider kind)
  const cacheAggByProvider = new Map<
    string,
    { uncached: number; cached: number; creation: number }
  >();
  if (mergedUsage) {
    for (const model of mergedUsage.models) {
      const normalized = normalizeUsageProviderKind(model.provider);
      const cur = cacheAggByProvider.get(normalized) ?? {
        uncached: 0,
        cached: 0,
        creation: 0,
      };
      cur.uncached += model.tokens.uncachedInputTokens;
      cur.cached += model.tokens.cachedInputTokens;
      cur.creation += model.tokens.cacheCreationTokens;
      cacheAggByProvider.set(normalized, cur);
    }
  }

  // Index authoritative Daemon provider probe snapshots by normalized usage provider kind.
  const probeByKind = new Map<string, PrismuxProviderProbeSnapshot>();
  if (probeSnapshots) {
    for (const snapshot of probeSnapshots) {
      const kind = normalizeUsageProviderKind(snapshot.providerId);
      if (!kind) continue;
      const existing = probeByKind.get(kind);
      if (
        !existing ||
        (existing.authMode === "unauthenticated" && snapshot.authMode !== "unauthenticated")
      ) {
        probeByKind.set(kind, snapshot);
      }
    }
  }

  // Track configured providers (including Antigravity auth classification) by normalized usage kind.
  // Antigravity is classified (never custom endpoint) while staying excluded from 0-usage auto-insertion.
  const configuredByKind = new Map<
    string,
    { displayName: string; isCustomEndpoint: boolean; enabled: boolean; autoInsert: boolean }
  >();
  for (const provider of providers) {
    const kind = resolveServerProviderUsageKind(provider, displayOptions?.entries);
    const displayName = resolveStatusBarProviderName(
      provider.instanceId,
      provider.displayName,
      provider.driver === "acpRegistry" ? kind : provider.driver,
      displayOptions?.entries,
    );
    const isCustomEndpoint = detectCustomEndpointProvider(provider, displayOptions?.entries);
    const isAntigravity = kind === "antigravity";
    const autoInsert = provider.enabled && !isAntigravity;
    const existing = configuredByKind.get(kind);
    if (!existing) {
      configuredByKind.set(kind, {
        displayName,
        isCustomEndpoint,
        enabled: provider.enabled,
        autoInsert,
      });
    } else if (provider.enabled && !existing.enabled) {
      configuredByKind.set(kind, {
        displayName,
        isCustomEndpoint,
        enabled: true,
        autoInsert,
      });
    } else if (provider.enabled === existing.enabled) {
      configuredByKind.set(kind, {
        displayName: existing.displayName,
        isCustomEndpoint: existing.isCustomEndpoint || isCustomEndpoint,
        enabled: existing.enabled,
        autoInsert: existing.autoInsert || autoInsert,
      });
    }
  }

  const normalizedWindowKinds = new Set<string>();
  if (windowProviderKinds) {
    for (const kind of windowProviderKinds) {
      normalizedWindowKinds.add(normalizeUsageProviderKind(kind));
    }
  }

  const ledgerByKind = new Map<string, StatusBarProviderUsageLedgerEntry>();
  const seenNormalizedKinds = new Set<string>();

  if (mergedUsage) {
    for (const provTotals of mergedUsage.providers) {
      const kind = provTotals.provider;
      const normalizedKind = normalizeUsageProviderKind(kind);
      seenNormalizedKinds.add(normalizedKind);
      const todayProv = todayByNormalizedKind.get(normalizedKind);
      const cacheAgg = cacheAggByProvider.get(normalizedKind);
      const configured = configuredByKind.get(normalizedKind);
      const probeSnapshot = probeByKind.get(normalizedKind);
      const hasQuotaWindow = normalizedWindowKinds.has(normalizedKind);
      const isCustomEndpoint = resolveProviderIsCustomEndpoint(
        normalizedKind,
        configured,
        probeSnapshot,
      );
      const existingLedger = ledgerByKind.get(normalizedKind);
      if (existingLedger) {
        ledgerByKind.set(normalizedKind, {
          ...existingLedger,
          weekTokens: existingLedger.weekTokens + provTotals.totalTokens,
          weekCostUsd: existingLedger.weekCostUsd + provTotals.costUsd,
          weekRecords: existingLedger.weekRecords + provTotals.records,
          weekSessions: existingLedger.weekSessions + provTotals.sessions,
          hasQuotaWindow: existingLedger.hasQuotaWindow || hasQuotaWindow,
          isCustomEndpoint: existingLedger.isCustomEndpoint || isCustomEndpoint,
        });
      } else {
        ledgerByKind.set(normalizedKind, {
          key: `usage:${normalizedKind}`,
          providerKind: normalizedKind,
          providerName:
            configured?.displayName ??
            resolveStatusBarProviderName(
              normalizedKind,
              undefined,
              normalizedKind,
              displayOptions?.entries,
            ),
          todayTokens: todayProv?.totalTokens ?? 0,
          todayCostUsd: todayProv?.costUsd ?? 0,
          weekTokens: provTotals.totalTokens,
          weekCostUsd: provTotals.costUsd,
          weekRecords: provTotals.records,
          weekSessions: provTotals.sessions,
          cacheHitPercent: cacheAgg
            ? computeCacheHitPercent(cacheAgg.uncached, cacheAgg.cached, cacheAgg.creation)
            : null,
          hasQuotaWindow,
          isCustomEndpoint,
        });
      }
    }
  }

  // Ensure enabled configured non-Antigravity providers (including custom API endpoints with 0 recent calls) appear cleanly
  for (const [kind, configured] of configuredByKind) {
    if (!configured.autoInsert || seenNormalizedKinds.has(kind) || ledgerByKind.has(kind)) continue;
    const hasQuotaWindow = normalizedWindowKinds.has(kind);
    const isCustomEndpoint = resolveProviderIsCustomEndpoint(
      kind,
      configured,
      probeByKind.get(kind),
    );
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
      hasQuotaWindow,
      isCustomEndpoint,
    });
  }

  const defaultSortedRows = [...ledgerByKind.values()].sort(
    (a, b) =>
      b.todayTokens - a.todayTokens ||
      b.weekTokens - a.weekTokens ||
      b.weekRecords - a.weekRecords ||
      a.providerName.localeCompare(b.providerName),
  );
  const providerRows =
    displayOptions?.providerOrder && displayOptions.providerOrder.length > 0
      ? orderItemsByConfiguredProviderOrder(
          defaultSortedRows,
          (row) => row.providerKind,
          displayOptions.entries ?? [],
          displayOptions.providerOrder,
        )
      : defaultSortedRows;

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
  probeSnapshots?: readonly PrismuxProviderProbeSnapshot[] | null,
  displayOptions?: StatusBarProviderDisplayOptions,
): StatusBarUsageSummary {
  const windows: StatusBarUsageWindowEntry[] = [];
  const antigravityEntries: StatusBarAntigravityAcpEntry[] = [];
  const windowProviderKinds = new Set<string>();
  let enabledProviderCount = 0;

  for (const provider of providers) {
    if (!provider.enabled) continue;

    const providerKind = resolveServerProviderUsageKind(provider, displayOptions?.entries);

    // HARD COMPLIANCE BOUNDARY: Antigravity must never display or call non-ACP quota endpoints.
    if (providerKind === "antigravity") {
      const authenticated = provider.auth?.status === "authenticated";
      antigravityEntries.push({
        providerInstanceId: provider.instanceId,
        providerName: resolveStatusBarProviderName(
          provider.instanceId,
          provider.displayName,
          provider.driver === "acpRegistry" ? providerKind : provider.driver,
          displayOptions?.entries,
        ),
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

    windowProviderKinds.add(providerKind);

    for (const win of rawWindows) {
      const usedPercent = readWindowUsedPercent(win);
      if (usedPercent === null) continue;
      const remainingPercent = Math.max(0, 100 - usedPercent);
      const resetsAt =
        typeof win.resetsAt === "string" && win.resetsAt.trim() ? win.resetsAt : null;
      const parsedReset = resetsAt ? Date.parse(resetsAt) : Number.NaN;
      const resetsAtMs = Number.isFinite(parsedReset) && parsedReset > now ? parsedReset : null;

      windows.push({
        key: `${provider.instanceId}:${win.id}`,
        providerInstanceId: provider.instanceId,
        providerName: resolveStatusBarProviderName(
          provider.instanceId,
          provider.displayName,
          provider.driver,
          displayOptions?.entries,
        ),
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

  const orderedAntigravityEntries =
    displayOptions?.providerOrder && displayOptions.providerOrder.length > 0
      ? orderItemsByConfiguredProviderOrder(
          antigravityEntries,
          (entry) => entry.providerInstanceId,
          displayOptions.entries ?? [],
          displayOptions.providerOrder,
        )
      : antigravityEntries;

  const telemetry = buildUsageTelemetrySummary(
    mergedUsage,
    providers,
    todayDayKey,
    windowProviderKinds,
    probeSnapshots,
    displayOptions,
  );

  return {
    windows,
    antigravityEntries: orderedAntigravityEntries,
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
