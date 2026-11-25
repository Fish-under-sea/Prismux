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
 * Exact horizontal thumb center inset (px) matching each knob variant's half-width
 * (or concentric pill end-cap radius in orb mode) so the mascot sits cleanly inside
 * the track at both extremes (`0%` and `100%`) with zero clipping and zero leftover gap.
 */
export const REASONING_EFFORT_THUMB_INSET_PX = {
  runnerRegular: 18,
  runnerCompact: 16,
  orbRegular: 14,
  orbCompact: 12,
} as const;

export function getReasoningEffortThumbInsetPx(options?: {
  readonly showRunner?: boolean | undefined;
  readonly compact?: boolean | undefined;
}): number {
  const showRunner = options?.showRunner ?? true;
  const compact = options?.compact ?? false;
  if (showRunner) {
    return compact
      ? REASONING_EFFORT_THUMB_INSET_PX.runnerCompact
      : REASONING_EFFORT_THUMB_INSET_PX.runnerRegular;
  }
  return compact
    ? REASONING_EFFORT_THUMB_INSET_PX.orbCompact
    : REASONING_EFFORT_THUMB_INSET_PX.orbRegular;
}

const PHANTOM_EFFORT_VALUES = new Set([
  '',
  '_t3/empty',
  'default',
  't3:default',
  'provider_default',
  'provider-default',
  'providerdefault',
  'provider default',
  'model_default',
  'model-default',
  'modeldefault',
  'model default',
  'system_default',
  'system-default',
  'systemdefault',
  'system default',
  'agent_default',
  'agent-default',
  'agentdefault',
  'agent default',
  'unset',
  'inherit',
]);

const PHANTOM_EFFORT_LABELS = new Set([
  '',
  'default',
  'provider default',
  'model default',
  'system default',
  'agent default',
  'use default',
  'use provider default',
  '默认',
  '提供商默认',
  '模型默认',
  '系统默认',
]);

/**
 * Returns true for phantom/sentinel placeholder options (e.g. `"Provider default"`,
 * `"provider_default"`, `"default"`, `_t3/empty`) that should be stripped whenever
 * concrete reasoning effort levels are present.
 */
export function isPhantomReasoningEffortOption(
  value: string,
  label?: string | null | undefined,
): boolean {
  const normalizedValue = value.trim().toLowerCase();
  if (PHANTOM_EFFORT_VALUES.has(normalizedValue)) {
    return true;
  }
  if (typeof label === 'string') {
    const normalizedLabel = label
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/gu, ' ');
    if (
      PHANTOM_EFFORT_LABELS.has(normalizedLabel) ||
      /^provider default(?:\s*\(|$)/u.test(normalizedLabel)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize caller-supplied effort options (strings or rich option objects) into
 * de-duplicated discrete stops, stripping phantom `"Provider default"` sentinels
 * whenever concrete levels exist and falling back to the model family's preset when empty.
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
  if (out.length === 0) {
    return getEffortPresetForFamily(family, locale);
  }
  const concrete = out.filter((item) => !isPhantomReasoningEffortOption(item.value, item.label));
  return concrete.length > 0 ? concrete : out;
}

/** Resolve the active stop index from the current effort value (case-insensitive, with medium/high/middle fallback). */
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
  const highIdx = stops.findIndex((s) => s.value.toLowerCase() === 'high');
  if (highIdx >= 0) return highIdx;
  return Math.floor((stops.length - 1) / 2);
}

/**
 * Compute the normalized [0, 1] linear slider progress for stop `index` across
 * `count` discrete stops: `index / (count - 1)` for `count >= 2` (`0` at the leftmost
 * stop, `1` at the rightmost stop). Eliminates leftover un-filled dark track gaps at
 * both extremes across all stop counts (`2`, `3`, `4`, `5`, `6+`).
 */
export function computeReasoningEffortStopProgress(index: number, count: number): number {
  if (!Number.isFinite(count) || count <= 1) return 0;
  const safeCount = Math.floor(count);
  const clampedIndex = Math.max(0, Math.min(safeCount - 1, Math.round(index)));
  return clampedIndex / (safeCount - 1);
}

/** Compute the percentage [0, 100] slider progress `(index / (count - 1)) * 100`. */
export function computeReasoningEffortStopPercent(index: number, count: number): number {
  return computeReasoningEffortStopProgress(index, count) * 100;
}

/**
 * Compute the edge-clamped mascot center X coordinate (in px within `[0, width]`) using
 * `thumbInset + (width - 2 * thumbInset) * progress`. Ensures the mascot silhouette sits
 * crisply inside both rounded pill end caps with zero clipping and zero awkward whitespace.
 */
export function computeReasoningEffortThumbAnchorX(
  progress: number,
  width: number,
  thumbInsetPx = 0,
): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  const clampedProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const safeInset =
    Number.isFinite(thumbInsetPx) && thumbInsetPx > 0 ? Math.min(thumbInsetPx, width * 0.45) : 0;
  return safeInset + (width - 2 * safeInset) * clampedProgress;
}

/**
 * Compute the illuminated pixel-meteor track fill width (in px within `[0, width]`):
 * - At max stop (`progress >= 1` or `isMax`): returns `width` (100% full-bleed to right cap, ZERO dark stub!)
 * - At min stop (`progress <= 0`): returns `safeInset` (clean left starting aura right beneath mascot!)
 * - At intermediate stops (`0 < progress < 1`): terminates cleanly at the mascot's center anchor!
 */
export function computeReasoningEffortFillWidth(
  progress: number,
  width: number,
  thumbInsetPx = 0,
  isMax = false,
): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  const clampedProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  if (isMax || clampedProgress >= 1 - 1e-6) {
    return width;
  }
  const safeInset =
    Number.isFinite(thumbInsetPx) && thumbInsetPx > 0 ? Math.min(thumbInsetPx, width * 0.45) : 0;
  if (clampedProgress <= 1e-6) {
    return safeInset;
  }
  return safeInset + (width - 2 * safeInset) * clampedProgress;
}

/**
 * Map a pointer `clientX` on the slider track across `[rect.left + thumbInset, rect.left + width - thumbInset]`
 * clamped to `[0, 1]` and snap to the nearest stop index (`0` through `count - 1`).
 */
export function resolveReasoningEffortStopIndexFromPointer(
  clientX: number,
  rect: { readonly left: number; readonly width: number },
  count: number,
  thumbInsetPx = 0,
): number {
  if (!Number.isFinite(count) || count <= 1 || !Number.isFinite(rect.width) || rect.width <= 0) {
    return 0;
  }
  const safeCount = Math.floor(count);
  const safeInset =
    Number.isFinite(thumbInsetPx) && thumbInsetPx > 0
      ? Math.min(thumbInsetPx, rect.width * 0.45)
      : 0;
  const usableWidth = rect.width - 2 * safeInset;
  const ratio =
    usableWidth > 0
      ? (clientX - (rect.left + safeInset)) / usableWidth
      : (clientX - rect.left) / rect.width;
  const clamped = Math.max(0, Math.min(1, ratio));
  return Math.max(0, Math.min(safeCount - 1, Math.round(clamped * (safeCount - 1))));
}
