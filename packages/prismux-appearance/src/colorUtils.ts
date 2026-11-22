export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface HsvColor {
  /** Hue in degrees [0, 360). */
  h: number;
  /** Saturation in [0, 1]. */
  s: number;
  /** Value / brightness in [0, 1]. */
  v: number;
}

const HEX6_RE = /^#?([0-9a-f]{6})$/i;
const HEX3_RE = /^#?([0-9a-f]{3})$/i;

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function isValidHex6(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim());
}

/**
 * Normalizes a 3-char or 6-char hex string (with or without leading '#') into lowercase '#rrggbb'.
 * Returns '' if invalid.
 */
export function normalizeHex(input: unknown, allowShortHex = true): string {
  if (typeof input !== 'string') return '';
  const trimmed = input.trim().toLowerCase();
  const m6 = HEX6_RE.exec(trimmed);
  if (m6 && m6[1]) return `#${m6[1]}`;
  if (allowShortHex) {
    const m3 = HEX3_RE.exec(trimmed);
    if (m3 && m3[1]) {
      const expanded = m3[1]
        .split('')
        .map((c) => c + c)
        .join('');
      return `#${expanded}`;
    }
  }
  return '';
}

export function hexToRgb(hex: string): RgbColor {
  const clean = normalizeHex(hex, true);
  if (!clean) return { r: 255, g: 255, b: 255 };
  return {
    r: Number.parseInt(clean.slice(1, 3), 16),
    g: Number.parseInt(clean.slice(3, 5), 16),
    b: Number.parseInt(clean.slice(5, 7), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toByte = (v: number): string =>
    Math.round(clampNumber(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

export function toRgbTriple(hex: string, fallback = '255, 255, 255'): string {
  const clean = normalizeHex(hex, true);
  if (!clean) return fallback;
  const { r, g, b } = hexToRgb(clean);
  return `${r}, ${g}, ${b}`;
}

export function rgbToHsv(r: number, g: number, b: number): HsvColor {
  const rn = clampNumber(r, 0, 255) / 255;
  const gn = clampNumber(g, 0, 255) / 255;
  const bn = clampNumber(b, 0, 255) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const h =
    d === 0
      ? 0
      : max === rn
        ? (((gn - bn) / d + 6) % 6) * 60
        : max === gn
          ? ((bn - rn) / d + 2) * 60
          : ((rn - gn) / d + 4) * 60;
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): RgbColor {
  const sn = clampNumber(s, 0, 1);
  const vn = clampNumber(v, 0, 1);
  const c = vn * sn;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const sector = Math.floor(hh) % 6;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  switch (sector) {
    case 0:
      r1 = c; g1 = x; b1 = 0;
      break;
    case 1:
      r1 = x; g1 = c; b1 = 0;
      break;
    case 2:
      r1 = 0; g1 = c; b1 = x;
      break;
    case 3:
      r1 = 0; g1 = x; b1 = c;
      break;
    case 4:
      r1 = x; g1 = 0; b1 = c;
      break;
    default:
      r1 = c; g1 = 0; b1 = x;
      break;
  }
  const m = vn - c;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/** WCAG 2.1 sRGB channel linearization (0-255 -> 0-1). */
export function srgbChannelToLinear(channel255: number): number {
  const c = clampNumber(channel255, 0, 255) / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance for an RGB color (0-1). */
export function relativeLuminance(rgb: RgbColor): number {
  return (
    0.2126 * srgbChannelToLinear(rgb.r) +
    0.7152 * srgbChannelToLinear(rgb.g) +
    0.0722 * srgbChannelToLinear(rgb.b)
  );
}

/** WCAG 2.1 contrast ratio between two relative luminances (>= 1.0). */
export function contrastRatioFromLuminance(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2.1 contrast ratio between two hex colors. */
export function contrastRatioHex(hexA: string, hexB: string): number {
  return contrastRatioFromLuminance(
    relativeLuminance(hexToRgb(hexA)),
    relativeLuminance(hexToRgb(hexB)),
  );
}

/**
 * Picks either '#ffffff' or '#000000' for maximum WCAG contrast over an accent fill.
 * Because the white/black crossover is at L ≈ 0.1791, the winning ink always has >= 4.58:1.
 */
export function selectHighContrastInk(bgHex: string): '#ffffff' | '#000000' {
  const bgLum = relativeLuminance(hexToRgb(bgHex));
  return contrastRatioFromLuminance(1, bgLum) >= contrastRatioFromLuminance(0, bgLum)
    ? '#ffffff'
    : '#000000';
}
