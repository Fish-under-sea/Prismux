export const STATUS_BAR_SEGMENT_IDS = [
  "usage",
  "keepAwake",
  "ports",
  "resources",
] as const;

export type StatusBarSegmentId = (typeof STATUS_BAR_SEGMENT_IDS)[number];

export type StatusBarVisibility = Readonly<Record<StatusBarSegmentId, boolean>>;

export type UsagePopoverDensity = "detailed" | "compact";
export type UsagePercentMode = "used" | "remaining";

export interface StatusBarUsagePreferences {
  readonly density: UsagePopoverDensity;
  readonly percentMode: UsagePercentMode;
}

export const STATUS_BAR_VISIBILITY_STORAGE_KEY = "prismux.statusBar.visibility.v1";
export const STATUS_BAR_USAGE_PREFS_STORAGE_KEY = "prismux.statusBar.usagePrefs.v1";

export const DEFAULT_STATUS_BAR_VISIBILITY: StatusBarVisibility = Object.freeze({
  usage: true,
  keepAwake: true,
  ports: true,
  resources: true,
});

export const DEFAULT_STATUS_BAR_USAGE_PREFS: StatusBarUsagePreferences = Object.freeze({
  density: "detailed",
  percentMode: "used",
});

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeStatusBarVisibility(raw: unknown): StatusBarVisibility {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_STATUS_BAR_VISIBILITY };
  }
  const record = raw as Record<string, unknown>;
  return {
    usage: typeof record.usage === "boolean" ? record.usage : DEFAULT_STATUS_BAR_VISIBILITY.usage,
    keepAwake:
      typeof record.keepAwake === "boolean"
        ? record.keepAwake
        : DEFAULT_STATUS_BAR_VISIBILITY.keepAwake,
    ports: typeof record.ports === "boolean" ? record.ports : DEFAULT_STATUS_BAR_VISIBILITY.ports,
    resources:
      typeof record.resources === "boolean"
        ? record.resources
        : DEFAULT_STATUS_BAR_VISIBILITY.resources,
  };
}

export function loadStatusBarVisibility(
  storage: StorageLike | null = defaultStorage(),
): StatusBarVisibility {
  if (!storage) return { ...DEFAULT_STATUS_BAR_VISIBILITY };
  try {
    const raw = storage.getItem(STATUS_BAR_VISIBILITY_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATUS_BAR_VISIBILITY };
    return normalizeStatusBarVisibility(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_STATUS_BAR_VISIBILITY };
  }
}

export function saveStatusBarVisibility(
  visibility: StatusBarVisibility,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STATUS_BAR_VISIBILITY_STORAGE_KEY, JSON.stringify(visibility));
  } catch {
    // Ignore storage quota or private mode failures.
  }
}

export function toggleStatusBarSegment(
  current: StatusBarVisibility,
  segment: StatusBarSegmentId,
): StatusBarVisibility {
  return {
    ...current,
    [segment]: !current[segment],
  };
}

export function loadStatusBarUsagePreferences(
  storage: StorageLike | null = defaultStorage(),
): StatusBarUsagePreferences {
  if (!storage) return { ...DEFAULT_STATUS_BAR_USAGE_PREFS };
  try {
    const raw = storage.getItem(STATUS_BAR_USAGE_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATUS_BAR_USAGE_PREFS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      density: parsed?.density === "compact" ? "compact" : "detailed",
      percentMode: parsed?.percentMode === "remaining" ? "remaining" : "used",
    };
  } catch {
    return { ...DEFAULT_STATUS_BAR_USAGE_PREFS };
  }
}

export function saveStatusBarUsagePreferences(
  prefs: StatusBarUsagePreferences,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STATUS_BAR_USAGE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage failures.
  }
}
