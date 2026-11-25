import type {
  DaemonDiagnosticsGroupDto,
  DaemonDiagnosticsItemDto,
  DaemonDiagnosticsServicesResponse,
  DaemonDiagnosticsStatus,
} from "../daemonClient";
import type { DiagnosticsBadgeTone } from "../../components/sidebar/prismuxSidebarQuickNav.logic";
import { getActiveLocale } from "../../i18n/messages";

export type DiagnosticCategoryKey =
  | "host_core"
  | "memory_sync"
  | "ai_providers"
  | "simulators_media"
  | "network_mirrors"
  | "dormant_engines";

export const CANONICAL_DIAGNOSTIC_CATEGORIES: ReadonlyArray<DiagnosticCategoryKey> = [
  "host_core",
  "memory_sync",
  "ai_providers",
  "simulators_media",
  "network_mirrors",
  "dormant_engines",
];

export interface NormalizedDiagnosticItem {
  readonly id: string;
  readonly category: string;
  readonly name: string;
  readonly status: DaemonDiagnosticsStatus;
  readonly summary: string;
  readonly detail: string | null;
  readonly fixAction: string | null;
  readonly fixCommand: string | null;
  readonly settingsRoute: string | null;
  readonly version: string | null;
  readonly latencyMs: number | null;
}

export interface NormalizedDiagnosticGroup {
  readonly id: string;
  readonly fallbackLabel: string;
  readonly status: DaemonDiagnosticsStatus;
  readonly okCount: number;
  readonly degradedCount: number;
  readonly errorCount: number;
  readonly items: readonly NormalizedDiagnosticItem[];
}

export type DiagnosticsMemoryRetrievalState = "fts5+sqlite-vec" | "fts5-only" | "unknown";

export interface NormalizedDiagnosticsReport {
  readonly checkedAt: number;
  readonly durationMs: number | null;
  readonly cached: boolean;
  readonly summary: {
    readonly total: number;
    readonly ok: number;
    readonly degraded: number;
    readonly error: number;
  };
  readonly groups: readonly NormalizedDiagnosticGroup[];
  readonly items: readonly NormalizedDiagnosticItem[];
  readonly memoryRetrievalState: DiagnosticsMemoryRetrievalState;
  readonly memoryRetrievalDetail: string | null;
  readonly dormantEngines: readonly NormalizedDiagnosticItem[];
}

const DEFAULT_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  host_core: "Host Core",
  memory_sync: "Memory & Sync",
  ai_providers: "AI Provider CLIs",
  simulators_media: "Simulators & Media Tools",
  network_mirrors: "Network & Mirrors",
  dormant_engines: "Dormant Engines Summary",
};

const ALLOWED_SETTINGS_ROUTE_PREFIX = "/settings/";
const ALLOWED_STANDALONE_ROUTES: ReadonlySet<string> = new Set([
  "/overnight-factory",
  "/diagnostics",
]);

export function sanitizeDiagnosticsSettingsRoute(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const normalizedStandalone = trimmed.replace(/\/+$/, "");
  if (
    !trimmed.startsWith(ALLOWED_SETTINGS_ROUTE_PREFIX) &&
    !ALLOWED_STANDALONE_ROUTES.has(normalizedStandalone)
  ) {
    return null;
  }
  if (/[\s\u0000-\u001F\u007F]/.test(trimmed)) return null;
  if (trimmed.includes("..") || trimmed.includes("://")) return null;
  return trimmed;
}

/** Maps legacy diagnostic routes (`memory-sync`, `overnight-factory`, `access`, `diagnostics`) to canonical destinations. */
export function resolveDiagnosticsSettingsRoute(
  raw: string | null | undefined,
  itemId?: string,
): string | null {
  const sanitized = sanitizeDiagnosticsSettingsRoute(raw);
  if (!sanitized) return null;
  const normalizedPath = sanitized.replace(/\/+$/, "");
  if (normalizedPath === "/settings/memory-sync") {
    const normalizedId = (itemId ?? "").trim().toLowerCase();
    if (normalizedId.startsWith("sync.") || normalizedId.includes("sync")) {
      return "/settings/sync";
    }
    return "/settings/memory";
  }
  if (normalizedPath === "/settings/overnight-factory") {
    return "/overnight-factory";
  }
  if (normalizedPath === "/settings/access") {
    return "/settings/connections";
  }
  if (normalizedPath === "/settings/diagnostics" || normalizedPath === "/diagnostics") {
    return "/diagnostics";
  }
  return sanitized;
}

function normalizeStatus(raw: unknown): DaemonDiagnosticsStatus {
  if (raw === "ok" || raw === "degraded" || raw === "error") {
    return raw;
  }
  return "degraded";
}

function computeGroupStatus(items: readonly NormalizedDiagnosticItem[]): DaemonDiagnosticsStatus {
  if (items.some((item) => item.status === "error")) return "error";
  if (items.some((item) => item.status === "degraded")) return "degraded";
  return "ok";
}

function normalizeItem(raw: DaemonDiagnosticsItemDto): NormalizedDiagnosticItem {
  return {
    id: typeof raw.id === "string" ? raw.id : "unknown",
    category: typeof raw.category === "string" ? raw.category : "host_core",
    name: typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name.trim() : raw.id,
    status: normalizeStatus(raw.status),
    summary: typeof raw.summary === "string" ? raw.summary : "",
    detail: typeof raw.detail === "string" && raw.detail.trim().length > 0 ? raw.detail.trim() : null,
    fixAction:
      typeof raw.fixAction === "string" && raw.fixAction.trim().length > 0
        ? raw.fixAction.trim()
        : null,
    fixCommand:
      typeof raw.fixCommand === "string" && raw.fixCommand.trim().length > 0
        ? raw.fixCommand.trim()
        : null,
    settingsRoute: resolveDiagnosticsSettingsRoute(raw.settingsRoute, raw.id),
    version:
      typeof raw.version === "string" && raw.version.trim().length > 0 ? raw.version.trim() : null,
    latencyMs:
      typeof raw.latencyMs === "number" && Number.isFinite(raw.latencyMs) && raw.latencyMs >= 0
        ? Math.round(raw.latencyMs)
        : null,
  };
}

export function detectMemoryRetrievalState(
  items: readonly NormalizedDiagnosticItem[],
): {
  readonly state: DiagnosticsMemoryRetrievalState;
  readonly detail: string | null;
} {
  const vecItem = items.find(
    (item) => item.id === "memory.sqlite_vec" || item.id.includes("sqlite_vec"),
  );
  if (!vecItem) {
    return { state: "unknown", detail: null };
  }
  if (vecItem.status === "ok") {
    return {
      state: "fts5+sqlite-vec",
      detail: vecItem.summary || vecItem.detail,
    };
  }
  return {
    state: "fts5-only",
    detail: vecItem.summary || vecItem.detail,
  };
}

const UNINSTALLED_AI_PROVIDER_RE =
  /not_installed|not[- ]installed|uninstalled|未检测到本机\s*cli|未检测到.*cli|path\s*中未找到|未在\s*path\s*中找到|not found (?:on|in) path|command not found|cli not found|executable not found|未安装/i;
const INSTALLED_BROKEN_AI_PROVIDER_RE =
  /已发现|启动.*异常|探测异常|版本探测|version check|exit code|timed?\s*out|auth(?:entication)?\s+(?:error|failed)|登录失效/i;
const RETIRED_OMP_RE = /(?:^|[._\-\s])(?:omp|oh-my-pi)(?:$|[._\-\s])/i;

/**
 * Defensive UI parity with Daemon: omits retired `omp` and uninstalled optional AI Provider CLIs
 * so they never render yellow degraded cards or trigger the sidebar dot; keeps broken installed CLIs.
 */
export function isOmittedAiProviderDiagnosticItem(
  raw: Pick<DaemonDiagnosticsItemDto, "id" | "category" | "name" | "status" | "summary"> & {
    readonly detail?: string | null;
    readonly installed?: unknown;
    readonly state?: unknown;
    readonly code?: unknown;
  },
): boolean {
  const id = typeof raw.id === "string" ? raw.id.trim().toLowerCase() : "";
  const category = typeof raw.category === "string" ? raw.category.trim().toLowerCase() : "";
  const name = typeof raw.name === "string" ? raw.name.trim().toLowerCase() : "";
  const isAiProvider = category === "ai_providers" || id.startsWith("provider.");

  if (
    id === "provider.omp" ||
    id === "omp" ||
    (isAiProvider && RETIRED_OMP_RE.test(`${id} ${name}`))
  ) {
    return true;
  }

  if (!isAiProvider) {
    return false;
  }

  if (raw.installed === false) {
    return true;
  }

  const rawStatus = typeof raw.status === "string" ? raw.status.trim().toLowerCase() : "";
  const rawState = typeof raw.state === "string" ? raw.state.trim().toLowerCase() : "";
  const rawCode = typeof raw.code === "string" ? raw.code.trim().toLowerCase() : "";
  if (
    rawStatus === "not_installed" ||
    rawStatus === "not-installed" ||
    rawStatus === "uninstalled" ||
    rawState === "not_installed" ||
    rawState === "not-installed" ||
    rawState === "uninstalled" ||
    rawCode === "not_installed" ||
    rawCode === "not-installed" ||
    rawCode === "uninstalled"
  ) {
    return true;
  }

  if (rawStatus === "ok") {
    return false;
  }

  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  const detail = typeof raw.detail === "string" ? raw.detail.trim() : "";
  if (INSTALLED_BROKEN_AI_PROVIDER_RE.test(summary)) {
    return false;
  }
  if (/^missing(?:\s+cli|\s+binary|\s+executable)?$/i.test(summary)) {
    return true;
  }
  if (UNINSTALLED_AI_PROVIDER_RE.test(summary)) {
    return true;
  }
  if (
    detail.length > 0 &&
    !INSTALLED_BROKEN_AI_PROVIDER_RE.test(detail) &&
    UNINSTALLED_AI_PROVIDER_RE.test(detail)
  ) {
    return true;
  }

  return false;
}

export function normalizeDiagnosticsResponse(
  response: DaemonDiagnosticsServicesResponse,
): NormalizedDiagnosticsReport {
  const rawItems: DaemonDiagnosticsItemDto[] = Array.isArray(response.items)
    ? response.items
    : Array.isArray(response.groups)
      ? response.groups.flatMap((group) => (Array.isArray(group.items) ? group.items : []))
      : [];

  let omittedCount = 0;
  const items = rawItems
    .filter((item) => {
      if (isOmittedAiProviderDiagnosticItem(item)) {
        omittedCount += 1;
        return false;
      }
      return true;
    })
    .map(normalizeItem);

  const rawGroupsById = new Map<string, DaemonDiagnosticsGroupDto>();
  if (Array.isArray(response.groups)) {
    for (const group of response.groups) {
      if (group && typeof group.id === "string") {
        rawGroupsById.set(group.id, group);
      }
    }
  }

  const itemsByCategory = new Map<string, NormalizedDiagnosticItem[]>();
  for (const item of items) {
    const existing = itemsByCategory.get(item.category);
    if (existing) {
      existing.push(item);
    } else {
      itemsByCategory.set(item.category, [item]);
    }
  }

  const orderedCategoryIds: string[] = [...CANONICAL_DIAGNOSTIC_CATEGORIES];
  for (const groupId of rawGroupsById.keys()) {
    if (!orderedCategoryIds.includes(groupId)) {
      orderedCategoryIds.push(groupId);
    }
  }
  for (const catId of itemsByCategory.keys()) {
    if (!orderedCategoryIds.includes(catId)) {
      orderedCategoryIds.push(catId);
    }
  }

  const groups: NormalizedDiagnosticGroup[] = [];
  for (const categoryId of orderedCategoryIds) {
    const rawGroup = rawGroupsById.get(categoryId);
    const fallbackGroupItems = Array.isArray(rawGroup?.items)
      ? rawGroup.items
          .filter((item) => !isOmittedAiProviderDiagnosticItem(item))
          .map(normalizeItem)
      : [];
    const groupItems = itemsByCategory.get(categoryId) ?? fallbackGroupItems;
    if (groupItems.length === 0) {
      continue;
    }
    const okCount = groupItems.filter((item) => item.status === "ok").length;
    const degradedCount = groupItems.filter((item) => item.status === "degraded").length;
    const errorCount = groupItems.filter((item) => item.status === "error").length;
    const fallbackLabel =
      (typeof rawGroup?.label === "string" && rawGroup.label.trim().length > 0
        ? rawGroup.label.trim()
        : typeof rawGroup?.title === "string" && rawGroup.title.trim().length > 0
          ? rawGroup.title.trim()
          : DEFAULT_CATEGORY_LABELS[categoryId]) ?? categoryId;

    groups.push({
      id: categoryId,
      fallbackLabel,
      status: computeGroupStatus(groupItems),
      okCount,
      degradedCount,
      errorCount,
      items: groupItems,
    });
  }

  const computedOk = items.filter((item) => item.status === "ok").length;
  const computedDegraded = items.filter((item) => item.status === "degraded").length;
  const computedError = items.filter((item) => item.status === "error").length;
  const useComputedSummary = omittedCount > 0 || items.length > 0;

  const okTotal = useComputedSummary
    ? computedOk
    : typeof response.summary?.ok === "number" && Number.isFinite(response.summary.ok)
      ? response.summary.ok
      : 0;
  const degradedTotal = useComputedSummary
    ? computedDegraded
    : typeof response.summary?.degraded === "number" && Number.isFinite(response.summary.degraded)
      ? response.summary.degraded
      : 0;
  const errorTotal = useComputedSummary
    ? computedError
    : typeof response.summary?.error === "number" && Number.isFinite(response.summary.error)
      ? response.summary.error
      : 0;
  const total = useComputedSummary
    ? items.length
    : typeof response.summary?.total === "number" && Number.isFinite(response.summary.total)
      ? response.summary.total
      : 0;

  const memory = detectMemoryRetrievalState(items);
  const dormantEngines = items.filter(
    (item) =>
      item.category === "dormant_engines" ||
      item.id === "engine.overnight_factory" ||
      item.id === "engine.lifecycle_hook_bus" ||
      item.id === "engine.worktree_sandbox",
  );

  return {
    checkedAt:
      typeof response.checkedAt === "number" && Number.isFinite(response.checkedAt)
        ? response.checkedAt
        : Date.now(),
    durationMs:
      typeof response.durationMs === "number" && Number.isFinite(response.durationMs)
        ? Math.max(0, Math.round(response.durationMs))
        : null,
    cached: Boolean(response.cached),
    summary: {
      total,
      ok: okTotal,
      degraded: degradedTotal,
      error: errorTotal,
    },
    groups,
    items,
    memoryRetrievalState: memory.state,
    memoryRetrievalDetail: memory.detail,
    dormantEngines,
  };
}

/**
 * Computes the sidebar health dot tone strictly from the normalized report so
 * uninstalled optional AI Provider CLIs omitted during normalization can never
 * trigger a false-positive amber warning dot.
 */
export function resolveNormalizedDiagnosticsBadgeTone(
  report: NormalizedDiagnosticsReport | null | undefined,
): DiagnosticsBadgeTone {
  if (!report) return null;
  if (report.summary.error > 0 || report.items.some((item) => item.status === "error")) {
    return "error";
  }
  if (report.summary.degraded > 0 || report.items.some((item) => item.status === "degraded")) {
    return "degraded";
  }
  if (report.items.length > 0 || report.summary.ok > 0) {
    return "ok";
  }
  return null;
}

export function isDiagnosticsStandalonePathname(pathname: string): boolean {
  const normalized = pathname.trim().replace(/\/+$/, "");
  return normalized === "/diagnostics";
}

export function isDiagnosticsViewPathname(pathname: string): boolean {
  const normalized = pathname.trim().replace(/\/+$/, "");
  return normalized === "/diagnostics" || normalized === "/settings/diagnostics";
}

export function isDiagnosticsEscapeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }
  return target.isContentEditable || target.closest("[role='dialog']") !== null;
}

export interface DiagnosticsStandaloneCopy {
  readonly isZh: boolean;
  readonly closeLabel: string;
  readonly closeTooltip: string;
  readonly copyFixLabel: string;
  readonly summaryHealthyPill: (ok: number, total: number) => string;
  readonly summaryDegradedPill: (degraded: number) => string;
  readonly summaryErrorPill: (error: number) => string;
}

/* oxlint-disable prismux/no-untranslated-copy -- locale-switched bilingual standalone diagnostics copy */
const ZH_STANDALONE_COPY: DiagnosticsStandaloneCopy = {
  isZh: true,
  closeLabel: "关闭服务体检面板",
  closeTooltip: "返回主会话 (Esc)",
  copyFixLabel: "复制修复",
  summaryHealthyPill: (ok, total) => `${ok}/${total} 正常`,
  summaryDegradedPill: (degraded) => `${degraded} 降级`,
  summaryErrorPill: (error) => `${error} 异常`,
};

const EN_STANDALONE_COPY: DiagnosticsStandaloneCopy = {
  isZh: false,
  closeLabel: "Close service diagnostics",
  closeTooltip: "Return to main session (Esc)",
  copyFixLabel: "Copy fix",
  summaryHealthyPill: (ok, total) => `${ok}/${total} healthy`,
  summaryDegradedPill: (degraded) => `${degraded} degraded`,
  summaryErrorPill: (error) => `${error} errors`,
};
/* oxlint-enable prismux/no-untranslated-copy */

export function getDiagnosticsStandaloneCopy(
  locale: string | null | undefined,
): DiagnosticsStandaloneCopy {
  const normalized = (locale ?? getActiveLocale() ?? "en").toLowerCase();
  return normalized.startsWith("zh") ? ZH_STANDALONE_COPY : EN_STANDALONE_COPY;
}

const COPYRIGHT_BOILERPLATE_RE = /\s*(?:[:：\-—|·]\s*)?copyright\s*(?:\(c\)|©)[^）)\r\n]*/gi;
const SEVEN_ZIP_VARIANT_RE = /\b(7-Zip)\s*\([a-z]+\)\s+/gi;
const WRAPPED_SEVEN_ZIP_ZH_RE = /^(可用|已安装|Available|Ready)\s*（\s*(7-Zip[^）]+?)\s*）$/i;
const WRAPPED_SEVEN_ZIP_EN_RE = /^(可用|已安装|Available|Ready)\s*\(\s*(7-Zip.+?)\s*\)$/i;

/**
 * Strips noisy copyright boilerplate (e.g. 7-Zip's `: Copyright (c) 1999-2024 Igor Pavlov : ...`)
 * from displayed version pills while callers preserve the full raw string in `title`.
 */
export function formatCompactDiagnosticVersion(version: string | null): string | null {
  if (typeof version !== "string") return null;
  const collapsed = version.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  const cleaned = collapsed
    .replace(COPYRIGHT_BOILERPLATE_RE, "")
    .replace(SEVEN_ZIP_VARIANT_RE, "$1 ")
    .replace(/\s*[:：\-—]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : collapsed;
}

/**
 * Normalizes multi-line or copyright-bloated diagnostic summaries (such as 7-Zip banners)
 * into a crisp single-line summary while callers preserve the full raw text in `title`.
 */
export function formatCompactDiagnosticSummary(summary: string): string {
  const collapsed = summary.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "";
  const stripped = collapsed
    .replace(COPYRIGHT_BOILERPLATE_RE, "")
    .replace(SEVEN_ZIP_VARIANT_RE, "$1 ")
    .replace(/\s*[:：\-—]\s*([）)])/g, "$1")
    .replace(/\s+([）)])/g, "$1")
    .replace(/\s*[:：\-—]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const wrappedMatch =
    WRAPPED_SEVEN_ZIP_ZH_RE.exec(stripped) ?? WRAPPED_SEVEN_ZIP_EN_RE.exec(stripped);
  if (wrappedMatch?.[1] && wrappedMatch[2]) {
    return `${wrappedMatch[1]} · ${wrappedMatch[2].trim()}`;
  }
  return stripped.length > 0 ? stripped : collapsed;
}

export const DORMANT_ENGINES_GROUP_ID = "dormant_engines" as const;

export type DiagnosticStatusFilter = "all" | DaemonDiagnosticsStatus;

export interface FilteredDiagnosticsView {
  readonly activeGroups: readonly NormalizedDiagnosticGroup[];
  readonly dormantGroup: NormalizedDiagnosticGroup | null;
  readonly visibleActiveItemCount: number;
  readonly visibleDormantItemCount: number;
  readonly totalVisibleCount: number;
  readonly isFiltered: boolean;
}

/**
 * Toggles a KPI status filter tile: clicking `"all"` or clicking the currently active
 * status resets the filter back to `"all"`.
 */
export function toggleDiagnosticStatusFilter(
  current: DiagnosticStatusFilter,
  next: DiagnosticStatusFilter,
): DiagnosticStatusFilter {
  if (next === "all" || current === next) {
    return "all";
  }
  return next;
}

function buildFilteredGroup(
  id: string,
  fallbackLabel: string,
  items: readonly NormalizedDiagnosticItem[],
): NormalizedDiagnosticGroup {
  const okCount = items.filter((item) => item.status === "ok").length;
  const degradedCount = items.filter((item) => item.status === "degraded").length;
  const errorCount = items.filter((item) => item.status === "error").length;
  return {
    id,
    fallbackLabel,
    status: computeGroupStatus(items),
    okCount,
    degradedCount,
    errorCount,
    items,
  };
}

/**
 * Splits a normalized diagnostics report into operational groups + a single deduplicated
 * `dormant_engines` read-only summary group, then applies the active status filter and
 * automatically hides groups that have zero matching checks.
 */
export function filterDiagnosticsReport(
  report: NormalizedDiagnosticsReport,
  statusFilter: DiagnosticStatusFilter,
): FilteredDiagnosticsView {
  const matchesStatus = (item: NormalizedDiagnosticItem) =>
    statusFilter === "all" || item.status === statusFilter;

  const rawDormantGroup = report.groups.find((group) => group.id === DORMANT_ENGINES_GROUP_ID);
  const seenDormantIds = new Set<string>();
  const allDormantItems: NormalizedDiagnosticItem[] = [];
  for (const item of [...(rawDormantGroup?.items ?? []), ...report.dormantEngines]) {
    if (!seenDormantIds.has(item.id)) {
      seenDormantIds.add(item.id);
      allDormantItems.push(item);
    }
  }

  const activeGroups: NormalizedDiagnosticGroup[] = [];
  let visibleActiveItemCount = 0;

  for (const group of report.groups) {
    if (group.id === DORMANT_ENGINES_GROUP_ID) {
      continue;
    }
    const filteredItems = group.items.filter(
      (item) => !seenDormantIds.has(item.id) && matchesStatus(item),
    );
    if (filteredItems.length === 0) {
      continue;
    }
    visibleActiveItemCount += filteredItems.length;
    activeGroups.push(buildFilteredGroup(group.id, group.fallbackLabel, filteredItems));
  }

  const filteredDormantItems = allDormantItems.filter(matchesStatus);
  const dormantGroup =
    filteredDormantItems.length > 0
      ? buildFilteredGroup(
          DORMANT_ENGINES_GROUP_ID,
          rawDormantGroup?.fallbackLabel ??
            DEFAULT_CATEGORY_LABELS[DORMANT_ENGINES_GROUP_ID] ??
            "Dormant Engines Summary",
          filteredDormantItems,
        )
      : null;

  const visibleDormantItemCount = dormantGroup?.items.length ?? 0;

  return {
    activeGroups,
    dormantGroup,
    visibleActiveItemCount,
    visibleDormantItemCount,
    totalVisibleCount: visibleActiveItemCount + visibleDormantItemCount,
    isFiltered: statusFilter !== "all",
  };
}

export function formatDiagnosticsTimestamp(timestampMs: number | null | undefined): string {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs) || timestampMs <= 0) {
    // oxlint-disable-next-line prismux/no-em-dash-copy -- standard tabular empty-metric placeholder
    return "—";
  }
  try {
    return new Date(timestampMs).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    // oxlint-disable-next-line prismux/no-em-dash-copy -- standard tabular empty-metric placeholder
    return "—";
  }
}

export const DIAGNOSTICS_AUTO_REFRESH_COOLDOWN_MS = 3_000;

export type DiagnosticsRefreshReason =
  | "mount"
  | "manual"
  | "focus"
  | "visibility"
  | "plugin-mutated"
  | "settings-left"
  | "external";

export interface DiagnosticsReportEvent {
  readonly response: DaemonDiagnosticsServicesResponse;
  readonly report: NormalizedDiagnosticsReport;
}

type DiagnosticsReportListener = (event: DiagnosticsReportEvent) => void;
type DiagnosticsRefreshRequestListener = (reason: DiagnosticsRefreshReason) => void;

const DIAGNOSTICS_MUTATION_SETTINGS_PATHS: ReadonlySet<string> = new Set([
  "/settings/providers",
  "/settings/plugins",
  "/settings/memory",
  "/settings/sync",
  "/overnight-factory",
  "/settings/memory-sync",
  "/settings/updates",
  "/settings/about",
  "/settings/wallpaper",
]);

let latestDiagnosticsResponse: DaemonDiagnosticsServicesResponse | null = null;
let latestNormalizedDiagnosticsReport: NormalizedDiagnosticsReport | null = null;
const diagnosticsReportListeners = new Set<DiagnosticsReportListener>();
const diagnosticsRefreshRequestListeners = new Set<DiagnosticsRefreshRequestListener>();

/**
 * Publishes a freshly fetched diagnostics response so both the Diagnostics page
 * and the left sidebar status indicator stay strictly in sync.
 */
export function publishDiagnosticsReport(
  response: DaemonDiagnosticsServicesResponse,
): NormalizedDiagnosticsReport {
  const report = normalizeDiagnosticsResponse(response);
  latestDiagnosticsResponse = response;
  latestNormalizedDiagnosticsReport = report;
  const event: DiagnosticsReportEvent = { response, report };
  for (const listener of diagnosticsReportListeners) {
    try {
      listener(event);
    } catch {
      // Isolate listener errors
    }
  }
  return report;
}

export function getLatestDiagnosticsResponse(): DaemonDiagnosticsServicesResponse | null {
  return latestDiagnosticsResponse;
}

export function getLatestNormalizedDiagnosticsReport(): NormalizedDiagnosticsReport | null {
  return latestNormalizedDiagnosticsReport;
}

export function subscribeDiagnosticsReport(listener: DiagnosticsReportListener): () => void {
  diagnosticsReportListeners.add(listener);
  return () => {
    diagnosticsReportListeners.delete(listener);
  };
}

/**
 * Broadcasts an explicit hot-reload request (e.g. after installing/uninstalling
 * a plugin or changing provider settings) so active views and the sidebar badge
 * immediately re-probe Daemon with `force=1`.
 */
export function requestDiagnosticsRefresh(
  reason: DiagnosticsRefreshReason = "external",
): void {
  for (const listener of diagnosticsRefreshRequestListeners) {
    try {
      listener(reason);
    } catch {
      // Isolate listener errors
    }
  }
}

export function subscribeDiagnosticsRefreshRequest(
  listener: DiagnosticsRefreshRequestListener,
): () => void {
  diagnosticsRefreshRequestListeners.add(listener);
  return () => {
    diagnosticsRefreshRequestListeners.delete(listener);
  };
}

export function resetDiagnosticsLiveStoreForTests(): void {
  latestDiagnosticsResponse = null;
  latestNormalizedDiagnosticsReport = null;
  diagnosticsReportListeners.clear();
  diagnosticsRefreshRequestListeners.clear();
}

export function isDiagnosticsAutoRefreshSettingsPath(pathname: string): boolean {
  const normalized = pathname.trim().replace(/\/+$/, "");
  return DIAGNOSTICS_MUTATION_SETTINGS_PATHS.has(normalized);
}

export interface DiagnosticsRefreshController {
  trigger(reason: DiagnosticsRefreshReason, options?: { bypassCooldown?: boolean }): boolean;
  markRefreshed(timestampMs?: number): void;
  getLastTriggeredAt(): number;
}

/**
 * Coalesces / throttles automatic hot-reload triggers (such as window `focus`
 * and `visibilitychange`) with a default 3-second cooldown to prevent probe
 * storms while still allowing immediate explicit refreshes.
 */
export function createDiagnosticsRefreshController(
  onRefresh: (reason: DiagnosticsRefreshReason) => void,
  options?: {
    cooldownMs?: number;
    now?: () => number;
  },
): DiagnosticsRefreshController {
  const cooldownMs = Math.max(0, options?.cooldownMs ?? DIAGNOSTICS_AUTO_REFRESH_COOLDOWN_MS);
  const now = options?.now ?? (() => Date.now());
  let lastTriggeredAt = -Infinity;

  return {
    trigger(reason, triggerOptions) {
      const current = now();
      const bypass = triggerOptions?.bypassCooldown === true;
      if (!bypass && current - lastTriggeredAt < cooldownMs) {
        return false;
      }
      lastTriggeredAt = current;
      onRefresh(reason);
      return true;
    },
    markRefreshed(timestampMs) {
      lastTriggeredAt = timestampMs ?? now();
    },
    getLastTriggeredAt() {
      return lastTriggeredAt;
    },
  };
}
