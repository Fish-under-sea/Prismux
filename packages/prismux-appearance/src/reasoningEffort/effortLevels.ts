/**
 * Effort stop presets and canonical English formatting helpers for the Prismux
 * model-aware reasoning-effort slider and composer badges.
 *
 * Reasoning-effort tier labels stay in standard English (`Minimal`, `Low`,
 * `Medium`, `High`, `XHigh`, `Max`, `Ultracode`) across all UI locales so
 * users always see unambiguous provider-native effort levels.
 *
 * Adapted with MIT attribution from HaoyueQin/dsh-better-reasoning-effort & dsh-fish.
 */

import type { ReasoningModelFamily } from './modelTheme.js';

export type ReasoningEffortLocale = 'zh' | 'en';

export interface ReasoningEffortOption {
  /** Canonical effort identifier passed through to backend / provider options (e.g. "low", "high", "xhigh", "max", "ultracode"). */
  readonly value: string;
  /** Human-readable display label; defaults to canonical English effort label if omitted. */
  readonly label?: string | undefined;
  /** Compact pill label; defaults to canonical English effort label if omitted. */
  readonly shortLabel?: string | undefined;
  /** Optional tooltip / description copy. */
  readonly description?: string | undefined;
}

export interface NormalizedReasoningEffortOption {
  readonly value: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly description?: string;
}

/** Canonical English effort-level labels shared across slider stops, badges, composer triggers & settings. */
export const CANONICAL_EFFORT_LABELS: Readonly<Record<string, string>> = {
  off: 'Off',
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  extra_high: 'XHigh',
  'extra-high': 'XHigh',
  'extra high': 'XHigh',
  max: 'Max',
  ultracode: 'Ultracode',
  ultrathink: 'Ultrathink',
  extreme: 'Extreme',
  auto: 'Auto',
};

const FAMILY_DEFAULT_LEVEL_VALUES: Readonly<Record<ReasoningModelFamily, readonly string[]>> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
  openai: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  gemini: ['off', 'low', 'medium', 'high', 'max'],
  deepseek: ['off', 'low', 'medium', 'high', 'max'],
  kimi: ['off', 'low', 'medium', 'high', 'max'],
  glm: ['off', 'low', 'medium', 'high', 'max'],
  qwen: ['off', 'low', 'medium', 'high', 'max'],
  minimax: ['off', 'low', 'medium', 'high', 'max'],
};

function capitalizeToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Return the canonical English label for an effort level (e.g. "minimal" -> "Minimal",
 * "low" -> "Low", "medium" -> "Medium", "high" -> "High", "xhigh" -> "XHigh",
 * "max" -> "Max", "ultracode" -> "Ultracode").
 */
export function formatEffortLabel(level: string): string {
  const key = level.trim().toLowerCase();
  const hit = CANONICAL_EFFORT_LABELS[key];
  if (hit) {
    return hit;
  }
  return capitalizeToken(level);
}

/** Return canonical English display label for an effort value regardless of UI locale. */
export function formatReasoningEffortLabel(
  value: string,
  _locale: ReasoningEffortLocale = 'en',
): string {
  return formatEffortLabel(value);
}

/** Return canonical English short pill label for an effort value regardless of UI locale. */
export function formatReasoningEffortShortLabel(
  value: string,
  _locale: ReasoningEffortLocale = 'en',
): string {
  return formatEffortLabel(value);
}

/** Return the default discrete effort stops for a recognized model family. */
export function getEffortPresetForFamily(
  family: ReasoningModelFamily,
  locale: ReasoningEffortLocale = 'zh',
): readonly NormalizedReasoningEffortOption[] {
  const values = FAMILY_DEFAULT_LEVEL_VALUES[family] ?? FAMILY_DEFAULT_LEVEL_VALUES.deepseek;
  return values.map((value) => ({
    value,
    label: formatReasoningEffortLabel(value, locale),
    shortLabel: formatReasoningEffortShortLabel(value, locale),
  }));
}

/**
 * Normalize caller-supplied effort options (strings or rich option objects) into
 * de-duplicated discrete stops, falling back to the model family's preset when empty.
 */
export function normalizeReasoningEffortOptions(
  options: readonly (string | ReasoningEffortOption)[] | undefined,
  family: ReasoningModelFamily,
  locale: ReasoningEffortLocale = 'zh',
): readonly NormalizedReasoningEffortOption[] {
  if (!options || options.length === 0) {
    return getEffortPresetForFamily(family, locale);
  }
  const seen = new Set<string>();
  const out: NormalizedReasoningEffortOption[] = [];
  for (const item of options) {
    if (typeof item === 'string') {
      const value = item.trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push({
        value,
        label: formatReasoningEffortLabel(value, locale),
        shortLabel: formatReasoningEffortShortLabel(value, locale),
      });
      continue;
    }
    const value = item.value.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const label = item.label?.trim() || formatReasoningEffortLabel(value, locale);
    const shortLabel = item.shortLabel?.trim() || formatReasoningEffortShortLabel(value, locale);
    const normalized: NormalizedReasoningEffortOption =
      item.description !== undefined
        ? { value, label, shortLabel, description: item.description }
        : { value, label, shortLabel };
    out.push(normalized);
  }
  return out.length > 0 ? out : getEffortPresetForFamily(family, locale);
}

/** Resolve the active stop index from the current effort value (case-insensitive, with middle fallback). */
export function resolveEffortStopIndex(
  stops: readonly NormalizedReasoningEffortOption[],
  value: string | null | undefined,
): number {
  if (stops.length === 0) return 0;
  if (typeof value === 'string' && value.trim().length > 0) {
    const exact = stops.findIndex((s) => s.value === value);
    if (exact >= 0) return exact;
    const lowered = value.trim().toLowerCase();
    const ci = stops.findIndex((s) => s.value.toLowerCase() === lowered);
    if (ci >= 0) return ci;
  }
  const mediumIdx = stops.findIndex((s) => s.value.toLowerCase() === 'medium');
  if (mediumIdx >= 0) return mediumIdx;
  return Math.floor((stops.length - 1) / 2);
}

/**
 * Compute the normalized [0, 1] horizontal center position for stop `index`
 * inside an equal-width `count`-column grid: `(index + 0.5) / count`.
 * Aligns the running chibi center, flare focus, and radiation beam origin
 * mathematically (0.00px delta) with the centerline of the `index`-th label pill below.
 */
export function computeReasoningEffortStopProgress(index: number, count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const safeCount = Math.floor(count);
  const clampedIndex = Math.max(0, Math.min(safeCount - 1, Math.round(index)));
  return (clampedIndex + 0.5) / safeCount;
}

/** Compute the percentage [0, 100] centerline offset `((index + 0.5) / count) * 100`. */
export function computeReasoningEffortStopPercent(index: number, count: number): number {
  return computeReasoningEffortStopProgress(index, count) * 100;
}

/**
 * Map a pointer `clientX` on the slider track to its corresponding equal-width
 * grid stop index via `Math.floor(((clientX - rect.left) / rect.width) * count)`.
 */
export function resolveReasoningEffortStopIndexFromPointer(
  clientX: number,
  rect: { readonly left: number; readonly width: number },
  count: number,
): number {
  if (!Number.isFinite(count) || count <= 1 || !Number.isFinite(rect.width) || rect.width <= 0) {
    return 0;
  }
  const safeCount = Math.floor(count);
  const raw = Math.floor(((clientX - rect.left) / rect.width) * safeCount);
  return Math.max(0, Math.min(safeCount - 1, raw));
}
