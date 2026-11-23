/**
 * Effort stop presets and bilingual formatting helpers for the Prismux
 * model-aware reasoning-effort slider.
 *
 * Adapted with MIT attribution from HaoyueQin/dsh-better-reasoning-effort & dsh-fish.
 */

import type { ReasoningModelFamily } from './modelTheme.js';

export type ReasoningEffortLocale = 'zh' | 'en';

export interface ReasoningEffortOption {
  /** Canonical effort identifier passed through to backend / provider options (e.g. "low", "high", "xhigh", "max", "ultracode"). */
  readonly value: string;
  /** Human-readable full label; falls back to localized canonical label if omitted. */
  readonly label?: string | undefined;
  /** Compact short label used in dense stop buttons or composer pills; falls back to localized short label. */
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

interface EffortDictionaryEntry {
  readonly zh: string;
  readonly zhShort: string;
  readonly en: string;
  readonly enShort: string;
}

const CANONICAL_EFFORT_DICTIONARY: Readonly<Record<string, EffortDictionaryEntry>> = {
  off: { zh: '关闭', zhShort: '关', en: 'Off', enShort: 'Off' },
  none: { zh: '无', zhShort: '无', en: 'None', enShort: 'None' },
  minimal: { zh: '最小', zhShort: '最小', en: 'Minimal', enShort: 'Min' },
  low: { zh: '低', zhShort: '低', en: 'Low', enShort: 'Low' },
  medium: { zh: '中', zhShort: '中', en: 'Medium', enShort: 'Med' },
  high: { zh: '高', zhShort: '高', en: 'High', enShort: 'High' },
  xhigh: { zh: '极高', zhShort: '极高', en: 'Extra High', enShort: 'XHigh' },
  max: { zh: '最大', zhShort: '最大', en: 'Max', enShort: 'Max' },
  ultracode: { zh: 'Ultracode', zhShort: 'Ultra', en: 'Ultracode', enShort: 'Ultra' },
  ultrathink: { zh: '极致', zhShort: '极致', en: 'Ultrathink', enShort: 'Ultra' },
  extreme: { zh: '极致', zhShort: '极致', en: 'Extreme', enShort: 'Ext' },
  auto: { zh: '自动', zhShort: '自动', en: 'Auto', enShort: 'Auto' },
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

/** Return localized display label for an effort value (e.g. "xhigh" -> "极高" / "Extra High"). */
export function formatReasoningEffortLabel(
  value: string,
  locale: ReasoningEffortLocale = 'zh',
): string {
  const key = value.trim().toLowerCase();
  const hit = CANONICAL_EFFORT_DICTIONARY[key];
  if (hit) {
    return locale === 'en' ? hit.en : hit.zh;
  }
  return capitalizeToken(value);
}

/** Return localized short badge/pill label for an effort value (e.g. "medium" -> "中" / "Med"). */
export function formatReasoningEffortShortLabel(
  value: string,
  locale: ReasoningEffortLocale = 'zh',
): string {
  const key = value.trim().toLowerCase();
  const hit = CANONICAL_EFFORT_DICTIONARY[key];
  if (hit) {
    return locale === 'en' ? hit.enShort : hit.zhShort;
  }
  return capitalizeToken(value);
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
