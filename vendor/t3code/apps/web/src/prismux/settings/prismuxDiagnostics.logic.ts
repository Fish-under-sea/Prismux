import type {
  DaemonDiagnosticsGroupDto,
  DaemonDiagnosticsItemDto,
  DaemonDiagnosticsServicesResponse,
  DaemonDiagnosticsStatus,
} from "../daemonClient";

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

export function sanitizeDiagnosticsSettingsRoute(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith(ALLOWED_SETTINGS_ROUTE_PREFIX)) return null;
  if (/[\s\u0000-\u001F\u007F]/.test(trimmed)) return null;
  if (trimmed.includes("..") || trimmed.includes("://")) return null;
  return trimmed;
}

/**
 * Maps legacy `/settings/memory-sync` diagnostic routes to the exact split destination:
 * `sync.*` items route to `/settings/sync`, while `memory.*` items route to `/settings/memory`.
 */
export function resolveDiagnosticsSettingsRoute(
  raw: string | null | undefined,
  itemId?: string,
): string | null {
  const sanitized = sanitizeDiagnosticsSettingsRoute(raw);
  if (!sanitized) return null;
  if (sanitized === "/settings/memory-sync" || sanitized === "/settings/memory-sync/") {
    const normalizedId = (itemId ?? "").trim().toLowerCase();
    if (normalizedId.startsWith("sync.") || normalizedId.includes("sync")) {
      return "/settings/sync";
    }
    return "/settings/memory";
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

export function normalizeDiagnosticsResponse(
  response: DaemonDiagnosticsServicesResponse,
): NormalizedDiagnosticsReport {
  const rawItems: DaemonDiagnosticsItemDto[] = Array.isArray(response.items)
    ? response.items
    : Array.isArray(response.groups)
      ? response.groups.flatMap((group) => (Array.isArray(group.items) ? group.items : []))
      : [];

  const items = rawItems.map(normalizeItem);

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
    const groupItems =
      itemsByCategory.get(categoryId) ??
      (Array.isArray(rawGroup?.items) ? rawGroup.items.map(normalizeItem) : []);
    if (groupItems.length === 0 && !rawGroup) {
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
      status: rawGroup?.status ? normalizeStatus(rawGroup.status) : computeGroupStatus(groupItems),
      okCount,
      degradedCount,
      errorCount,
      items: groupItems,
    });
  }

  const okTotal =
    typeof response.summary?.ok === "number" && Number.isFinite(response.summary.ok)
      ? response.summary.ok
      : items.filter((item) => item.status === "ok").length;
  const degradedTotal =
    typeof response.summary?.degraded === "number" && Number.isFinite(response.summary.degraded)
      ? response.summary.degraded
      : items.filter((item) => item.status === "degraded").length;
  const errorTotal =
    typeof response.summary?.error === "number" && Number.isFinite(response.summary.error)
      ? response.summary.error
      : items.filter((item) => item.status === "error").length;
  const total =
    typeof response.summary?.total === "number" && Number.isFinite(response.summary.total)
      ? response.summary.total
      : items.length;

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

export function formatDiagnosticsTimestamp(timestampMs: number | null | undefined): string {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs) || timestampMs <= 0) {
    return "—";
  }
  try {
    return new Date(timestampMs).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
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
  "/settings/overnight-factory",
  "/settings/memory-sync",
  "/settings/updates",
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
