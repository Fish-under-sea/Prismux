import {
  DEFAULT_APPEARANCE_CONFIG,
  DEFAULT_TYPOGRAPHY_FALLBACKS,
  GLASS_PRESETS,
  GLASS_REGION_LIMITS,
  type AccentMode,
  type AppearanceConfig,
  type BaseThemePolarity,
  type DeepPartialAppearanceConfig,
  type GlassPreset,
  type GlassRegionId,
  type GlassRegionValues,
  type GlassRegionsConfig,
  type GlassSurfaceId,
  type GlassSurfaceOverride,
  type SidebarCornerRadius,
  type SidebarSquareCorners,
  type ThemeMode,
  type ThinkingGlassMode,
} from './types.js';
import {
  clampNumber,
  contrastRatioFromLuminance,
  hexToRgb,
  normalizeHex,
  relativeLuminance,
  rgbToHex,
  selectHighContrastInk,
  toRgbTriple,
} from './colorUtils.js';

/**
 * Minimum readability floor weights proven to guarantee >= 4.5:1 WCAG contrast
 * for body text against worst-case wallpaper pixels (#000 in light, #fff in dark),
 * even when region fill opacity is dragged all the way down to 0%.
 */
export const READABILITY_FLOOR_LIGHT = 0.5;
export const READABILITY_FLOOR_DARK = 0.59;
export const DEFAULT_LIGHT_GLASS_TINT = '#ffffff';
export const DEFAULT_DARK_GLASS_TINT = '#0d1524';
const CLAMP_CONTRAST_TARGET = 4.6; // +0.1 rounding margin for 8-bit hex quantization

export interface StyleDeclarationLike {
  setProperty(name: string, value: string): void;
  removeProperty(name: string): string | void;
}

export interface ClassListLike {
  toggle(token: string, force?: boolean): boolean | void;
  remove(...tokens: string[]): void;
}

export interface ElementLike {
  style: StyleDeclarationLike;
  classList: ClassListLike;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface DocumentLike {
  documentElement: ElementLike;
  body?: ElementLike | null;
}

export interface ApplyAppearanceOptions {
  /** Target document (defaults to globalThis.document when running in a browser). */
  document?: DocumentLike | null;
  /** Host OS accent hex color (used when accentMode === 'system'). */
  systemAccent?: string;
  /** Whether hardware GPU acceleration is available (false triggers solid glass fallback). */
  gpuAvailable?: boolean;
  /** Whether user/OS prefers reduced transparency (true triggers solid glass fallback). */
  reducedTransparency?: boolean;
  /** Whether an active Z-0 wallpaper is rendered behind the workbench. */
  wallpaperActive?: boolean;
  /** Optional sync of T3 Code's `.dark` class on `documentElement` (defaults to false). */
  syncT3DarkClass?: boolean;
}

export interface ResolvedSurfaceGlass {
  op: number;
  blur: number;
  tint: string;
  fidelity: number;
}

export interface ResolvedAppearanceRuntime {
  config: AppearanceConfig;
  polarity: BaseThemePolarity;
  isDark: boolean;
  glassActive: boolean;
  accent: string;
  accentInk: '#ffffff' | '#000000';
  accentCleared: boolean;
  glassTinted: boolean;
  clampedLightTint: string;
  clampedDarkTint: string;
  activeGlassTint: string;
  readabilityFloorBase: number;
  readabilityFloor: number;
  surfaces: Record<GlassSurfaceId, ResolvedSurfaceGlass>;
}

const VALID_THEME_MODES = new Set<ThemeMode>(['light', 'dark', 'glass']);
const VALID_POLARITIES = new Set<BaseThemePolarity>(['light', 'dark']);
const VALID_ACCENT_MODES = new Set<AccentMode>(['system', 'custom']);
const VALID_GLASS_PRESETS = new Set<GlassPreset>(['off', 'light', 'balanced', 'clear', 'custom']);
const VALID_THINKING_MODES = new Set<ThinkingGlassMode>(['off', 'glass', 'native']);
const VALID_CORNER_RADII = new Set<SidebarCornerRadius>(['native', 6, 12, 20]);
const VALID_SURFACE_IDS: readonly GlassSurfaceId[] = [
  'leftSidebar',
  'titlebar',
  'rightSidebar',
  'conversation',
  'settingsWindow',
  'thinkingTrigger',
  'floaters',
  'hoverCard',
  'filePreview',
  'sidebarContent',
] as const;

const REGION_IDS: readonly GlassRegionId[] = ['surface', 'card', 'overlay', 'control'] as const;

/**
 * Pure brightness-clamping algorithm ensuring that when `fidelity === 100`,
 * compositing the returned surface tint at the readability floor over the worst-case
 * wallpaper backdrop (#000000 in light mode, #ffffff in dark mode) retains >= 4.5:1
 * WCAG contrast against body text (#000000 in light, #ffffff in dark) at ANY surface opacity.
 *
 * When `fidelity` decreases from 100 -> 0, the clamped tint monotonically lerps
 * back toward the raw user color (0 = raw user color, 100 = full readability red line).
 */
export function clampSurfaceColorForContrast(
  hex: string,
  isDark: boolean,
  fidelity = 100,
): string {
  const clean = normalizeHex(hex, true);
  if (!clean) return isDark ? DEFAULT_DARK_GLASS_TINT : DEFAULT_LIGHT_GLASS_TINT;

  const f = clampNumber(Number.isFinite(fidelity) ? fidelity / 100 : 1, 0, 1);
  const rgb = hexToRgb(clean);
  const floor = isDark ? READABILITY_FLOOR_DARK : READABILITY_FLOOR_LIGHT;
  const worstBackdrop = isDark ? 255 : 0;

  const passes = (r: number, g: number, b: number): boolean => {
    const comp = {
      r: r * floor + worstBackdrop * (1 - floor),
      g: g * floor + worstBackdrop * (1 - floor),
      b: b * floor + worstBackdrop * (1 - floor),
    };
    const compLum = relativeLuminance(comp);
    const textLum = isDark ? 1 : 0;
    return contrastRatioFromLuminance(textLum, compLum) >= CLAMP_CONTRAST_TARGET;
  };

  let cr = rgb.r;
  let cg = rgb.g;
  let cb = rgb.b;

  if (!passes(rgb.r, rgb.g, rgb.b)) {
    const target = isDark ? 0 : 255;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 16; i++) {
      const t = (lo + hi) / 2;
      const tr = rgb.r * (1 - t) + target * t;
      const tg = rgb.g * (1 - t) + target * t;
      const tb = rgb.b * (1 - t) + target * t;
      if (passes(tr, tg, tb)) {
        hi = t;
      } else {
        lo = t;
      }
    }
    cr = rgb.r * (1 - hi) + target * hi;
    cg = rgb.g * (1 - hi) + target * hi;
    cb = rgb.b * (1 - hi) + target * hi;
  }

  if (f >= 1) {
    return rgbToHex(cr, cg, cb);
  }

  return rgbToHex(
    cr * f + rgb.r * (1 - f),
    cg * f + rgb.g * (1 - f),
    cb * f + rgb.b * (1 - f),
  );
}

/**
 * Evaluates the exact WCAG contrast ratio of a glass surface tint against body text
 * over the worst-case wallpaper pixel (#000 in light mode, #fff in dark mode).
 */
export function computeWorstCaseGlassContrast(
  surfaceHex: string,
  isDark: boolean,
  fidelity = 100,
  surfaceOp = 0,
): number {
  const rgb = hexToRgb(surfaceHex);
  const f = clampNumber(fidelity / 100, 0, 1);
  const op = clampNumber(surfaceOp / 100, 0, 1);
  const floor = (isDark ? READABILITY_FLOOR_DARK : READABILITY_FLOOR_LIGHT) * f;
  const effectiveAlpha = floor + op * (1 - floor);
  const backdrop = isDark ? 255 : 0;
  const comp = {
    r: rgb.r * effectiveAlpha + backdrop * (1 - effectiveAlpha),
    g: rgb.g * effectiveAlpha + backdrop * (1 - effectiveAlpha),
    b: rgb.b * effectiveAlpha + backdrop * (1 - effectiveAlpha),
  };
  return contrastRatioFromLuminance(isDark ? 1 : 0, relativeLuminance(comp));
}

function sanitizeRegionValues(
  raw: Partial<GlassRegionValues> | undefined,
  fallback: GlassRegionValues,
): GlassRegionValues {
  const op =
    raw?.op !== undefined && Number.isFinite(Number(raw.op))
      ? Math.round(clampNumber(Number(raw.op), GLASS_REGION_LIMITS.opMin, GLASS_REGION_LIMITS.opMax))
      : fallback.op;
  const blur =
    raw?.blur !== undefined && Number.isFinite(Number(raw.blur))
      ? Math.round(
          clampNumber(Number(raw.blur), GLASS_REGION_LIMITS.blurMin, GLASS_REGION_LIMITS.blurMax),
        )
      : fallback.blur;
  return { op, blur };
}

function sanitizeCorners(
  raw: Partial<SidebarSquareCorners> | undefined,
  fallback: SidebarSquareCorners,
): SidebarSquareCorners {
  return {
    tl: typeof raw?.tl === 'boolean' ? raw.tl : fallback.tl,
    tr: typeof raw?.tr === 'boolean' ? raw.tr : fallback.tr,
    br: typeof raw?.br === 'boolean' ? raw.br : fallback.br,
    bl: typeof raw?.bl === 'boolean' ? raw.bl : fallback.bl,
  };
}

function sanitizeCornerRadius(
  raw: unknown,
  fallback: SidebarCornerRadius,
): SidebarCornerRadius {
  if (raw === 'native') return 'native';
  const asNum = typeof raw === 'string' ? Number(raw) : raw;
  if (asNum === 6 || asNum === 12 || asNum === 20) return asNum;
  return VALID_CORNER_RADII.has(fallback) ? fallback : 'native';
}

function sanitizeFontStack(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim().slice(0, 240);
  // Reject CSS injection delimiters such as ';' '{' '}' or URL schemes.
  if (/[;{}<>]|url\s*\(|file:\/\//i.test(trimmed)) return '';
  return trimmed;
}

function sanitizeSurfaceOverrides(
  raw: Partial<Record<GlassSurfaceId, GlassSurfaceOverride>> | undefined,
): Partial<Record<GlassSurfaceId, GlassSurfaceOverride>> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Partial<Record<GlassSurfaceId, GlassSurfaceOverride>> = {};
  for (const id of VALID_SURFACE_IDS) {
    const entry = raw[id];
    if (!entry || typeof entry !== 'object') continue;
    const mode = entry.mode === 'custom' ? 'custom' : 'inherit';
    const cleanEntry: GlassSurfaceOverride = { mode };
    if (entry.op !== undefined && Number.isFinite(Number(entry.op))) {
      cleanEntry.op = Math.round(
        clampNumber(Number(entry.op), GLASS_REGION_LIMITS.opMin, GLASS_REGION_LIMITS.opMax),
      );
    }
    if (entry.blur !== undefined && Number.isFinite(Number(entry.blur))) {
      cleanEntry.blur = Math.round(
        clampNumber(
          Number(entry.blur),
          GLASS_REGION_LIMITS.blurMin,
          GLASS_REGION_LIMITS.surfaceBlurMax,
        ),
      );
    }
    if (typeof entry.color === 'string') {
      cleanEntry.color = normalizeHex(entry.color, true);
    }
    if (entry.fidelity !== undefined && Number.isFinite(Number(entry.fidelity))) {
      cleanEntry.fidelity = Math.round(
        clampNumber(
          Number(entry.fidelity),
          GLASS_REGION_LIMITS.fidelityMin,
          GLASS_REGION_LIMITS.fidelityMax,
        ),
      );
    }
    result[id] = cleanEntry;
  }
  return result;
}

/**
 * Merges and validates any partial config onto a base AppearanceConfig (defaulting to factory defaults).
 */
export function normalizeAppearanceConfig(
  input?: DeepPartialAppearanceConfig | null,
  base: AppearanceConfig = DEFAULT_APPEARANCE_CONFIG,
): AppearanceConfig {
  const src = input ?? {};
  const themeMode =
    src.themeMode && VALID_THEME_MODES.has(src.themeMode) ? src.themeMode : base.themeMode;
  const glassBasePolarity =
    src.glassBasePolarity && VALID_POLARITIES.has(src.glassBasePolarity)
      ? src.glassBasePolarity
      : base.glassBasePolarity;
  const accentMode =
    src.accentMode && VALID_ACCENT_MODES.has(src.accentMode) ? src.accentMode : base.accentMode;
  const accent =
    src.accent !== undefined
      ? src.accent === ''
        ? ''
        : normalizeHex(src.accent, true) || base.accent
      : base.accent;

  const glassPreset =
    src.glassPreset && VALID_GLASS_PRESETS.has(src.glassPreset)
      ? src.glassPreset
      : base.glassPreset;

  const glassRegions: GlassRegionsConfig = {
    surface: sanitizeRegionValues(src.glassRegions?.surface, base.glassRegions.surface),
    card: sanitizeRegionValues(src.glassRegions?.card, base.glassRegions.card),
    overlay: sanitizeRegionValues(src.glassRegions?.overlay, base.glassRegions.overlay),
    control: sanitizeRegionValues(src.glassRegions?.control, base.glassRegions.control),
  };

  const glassColor =
    src.glassColor !== undefined
      ? normalizeHex(src.glassColor, true) || DEFAULT_LIGHT_GLASS_TINT
      : base.glassColor;
  const glassDarkSeparate =
    typeof src.glassDarkSeparate === 'boolean' ? src.glassDarkSeparate : base.glassDarkSeparate;
  const glassDarkColor =
    src.glassDarkColor !== undefined
      ? normalizeHex(src.glassDarkColor, true) || DEFAULT_DARK_GLASS_TINT
      : base.glassDarkColor;

  const glassFidelity =
    src.glassFidelity !== undefined && Number.isFinite(Number(src.glassFidelity))
      ? Math.round(
          clampNumber(
            Number(src.glassFidelity),
            GLASS_REGION_LIMITS.fidelityMin,
            GLASS_REGION_LIMITS.fidelityMax,
          ),
        )
      : base.glassFidelity;

  const fresnelStrength =
    src.fresnelStrength !== undefined && Number.isFinite(Number(src.fresnelStrength))
      ? Math.round(clampNumber(Number(src.fresnelStrength), 0, 100))
      : base.fresnelStrength;

  const wallpaperDim =
    src.wallpaperDim !== undefined && Number.isFinite(Number(src.wallpaperDim))
      ? Math.round(clampNumber(Number(src.wallpaperDim), 0, 100))
      : base.wallpaperDim;

  const thinkingMode =
    src.thinkingMode && VALID_THINKING_MODES.has(src.thinkingMode)
      ? src.thinkingMode
      : base.thinkingMode;

  const leftSidebarGlass =
    typeof src.leftSidebarGlass === 'boolean' ? src.leftSidebarGlass : base.leftSidebarGlass;
  const titlebarGlass =
    typeof src.titlebarGlass === 'boolean' ? src.titlebarGlass : base.titlebarGlass;
  const rightSidebarGlass =
    typeof src.rightSidebarGlass === 'boolean' ? src.rightSidebarGlass : base.rightSidebarGlass;
  const rightSidebarFullClear =
    typeof src.rightSidebarFullClear === 'boolean'
      ? src.rightSidebarFullClear
      : base.rightSidebarFullClear;

  const perSurfaceOverrides = sanitizeSurfaceOverrides(
    src.perSurfaceOverrides !== undefined ? src.perSurfaceOverrides : base.perSurfaceOverrides,
  );

  const sidebarCornerRadius = sanitizeCornerRadius(
    src.sidebarCornerRadius,
    base.sidebarCornerRadius,
  );
  const sidebarSquareCorners = sanitizeCorners(src.sidebarSquareCorners, base.sidebarSquareCorners);

  const rightSidebarCornerRadius =
    src.rightSidebarCornerRadius !== undefined
      ? sanitizeCornerRadius(src.rightSidebarCornerRadius, sidebarCornerRadius)
      : base.rightSidebarCornerRadius;
  const rightSidebarSquareCorners =
    src.rightSidebarSquareCorners !== undefined
      ? sanitizeCorners(
          src.rightSidebarSquareCorners,
          base.rightSidebarSquareCorners ?? sidebarSquareCorners,
        )
      : base.rightSidebarSquareCorners;

  const uiSrc = src.uiColorCustom;
  const uiColorCustom = {
    enabled: typeof uiSrc?.enabled === 'boolean' ? uiSrc.enabled : base.uiColorCustom.enabled,
    send:
      uiSrc?.send !== undefined
        ? uiSrc.send === ''
          ? ''
          : normalizeHex(uiSrc.send, true)
        : base.uiColorCustom.send,
    link:
      uiSrc?.link !== undefined
        ? uiSrc.link === ''
          ? ''
          : normalizeHex(uiSrc.link, true)
        : base.uiColorCustom.link,
    fileIcon:
      uiSrc?.fileIcon !== undefined
        ? uiSrc.fileIcon === ''
          ? ''
          : normalizeHex(uiSrc.fileIcon, true)
        : base.uiColorCustom.fileIcon,
    tab:
      uiSrc?.tab !== undefined
        ? uiSrc.tab === ''
          ? ''
          : normalizeHex(uiSrc.tab, true)
        : base.uiColorCustom.tab,
    deepDiving:
      uiSrc?.deepDiving !== undefined
        ? uiSrc.deepDiving === ''
          ? ''
          : normalizeHex(uiSrc.deepDiving, true)
        : base.uiColorCustom.deepDiving,
  };

  const caretColor =
    src.caretColor !== undefined
      ? src.caretColor === ''
        ? ''
        : normalizeHex(src.caretColor, true)
      : base.caretColor;

  const typoSrc = src.typography;
  const normalizeTypoColor = (nextVal: string | undefined, prevVal: string): string => {
    if (nextVal === undefined) return prevVal;
    if (nextVal === '') return '';
    return normalizeHex(nextVal, true);
  };

  const fontWeightRaw = typoSrc?.fontWeight ?? base.typography.fontWeight;
  const fontWeight =
    fontWeightRaw !== undefined && Number.isFinite(Number(fontWeightRaw))
      ? Math.round(clampNumber(Number(fontWeightRaw), 300, 700))
      : undefined;

  const typography = {
    light: {
      headingColor: normalizeTypoColor(
        typoSrc?.light?.headingColor,
        base.typography.light.headingColor,
      ),
      textColor: normalizeTypoColor(typoSrc?.light?.textColor, base.typography.light.textColor),
      mutedColor: normalizeTypoColor(typoSrc?.light?.mutedColor, base.typography.light.mutedColor),
    },
    dark: {
      headingColor: normalizeTypoColor(
        typoSrc?.dark?.headingColor,
        base.typography.dark.headingColor,
      ),
      textColor: normalizeTypoColor(typoSrc?.dark?.textColor, base.typography.dark.textColor),
      mutedColor: normalizeTypoColor(typoSrc?.dark?.mutedColor, base.typography.dark.mutedColor),
    },
    fontFamily:
      typoSrc?.fontFamily !== undefined
        ? sanitizeFontStack(typoSrc.fontFamily, '')
        : base.typography.fontFamily,
    codeFontFamily:
      typoSrc?.codeFontFamily !== undefined
        ? sanitizeFontStack(typoSrc.codeFontFamily, '')
        : base.typography.codeFontFamily,
    ...(fontWeight !== undefined ? { fontWeight } : {}),
  };

  return {
    themeMode,
    glassBasePolarity,
    accentMode,
    accent,
    glassPreset,
    glassRegions,
    glassColor,
    glassDarkSeparate,
    glassDarkColor,
    glassFidelity,
    fresnelStrength,
    wallpaperDim,
    thinkingMode,
    leftSidebarGlass,
    titlebarGlass,
    rightSidebarGlass,
    rightSidebarFullClear,
    perSurfaceOverrides,
    sidebarCornerRadius,
    sidebarSquareCorners,
    ...(rightSidebarCornerRadius !== undefined ? { rightSidebarCornerRadius } : {}),
    ...(rightSidebarSquareCorners !== undefined ? { rightSidebarSquareCorners } : {}),
    uiColorCustom,
    caretColor,
    typography,
  };
}

/** Applies a named glass preset (updating all 4 regions when preset !== 'custom'). */
export function applyGlassPreset(
  config: AppearanceConfig,
  preset: GlassPreset,
): AppearanceConfig {
  if (preset === 'custom') {
    return { ...config, glassPreset: 'custom' };
  }
  const tpl = GLASS_PRESETS[preset];
  return {
    ...config,
    glassPreset: preset,
    glassRegions: {
      surface: { ...tpl.surface },
      card: { ...tpl.card },
      overlay: { ...tpl.overlay },
      control: { ...tpl.control },
    },
  };
}

/** Updates a single glass region slider and automatically switches preset to 'custom'. */
export function updateGlassRegion(
  config: AppearanceConfig,
  region: GlassRegionId,
  patch: Partial<GlassRegionValues>,
): AppearanceConfig {
  const nextRegion = sanitizeRegionValues(patch, config.glassRegions[region]);
  return {
    ...config,
    glassPreset: 'custom',
    glassRegions: {
      ...config.glassRegions,
      [region]: nextRegion,
    },
  };
}

/**
 * Transitions themeMode using FISH-Dock UX rule:
 * switching into 'glass' while preset is 'off' automatically restores 'balanced' so glass is immediately visible.
 */
export function setThemeModeWithGlassAutoWake(
  config: AppearanceConfig,
  mode: ThemeMode,
): AppearanceConfig {
  if (mode === 'glass' && config.glassPreset === 'off') {
    return {
      ...applyGlassPreset(config, 'balanced'),
      themeMode: 'glass',
    };
  }
  return { ...config, themeMode: mode };
}

export function resolveBasePolarity(config: AppearanceConfig): BaseThemePolarity {
  if (config.themeMode === 'light') return 'light';
  if (config.themeMode === 'dark') return 'dark';
  return config.glassBasePolarity;
}

export function isGlassVisuallyActive(config: AppearanceConfig): boolean {
  if (config.themeMode !== 'glass') return false;
  return REGION_IDS.some((id) => {
    const r = config.glassRegions[id];
    return r.op < 100 || r.blur > 0;
  });
}

function resolveSurfaceGlassValue(
  config: AppearanceConfig,
  id: GlassSurfaceId,
  defaultRegion: GlassRegionId,
  isDark: boolean,
  activeTint: string,
): ResolvedSurfaceGlass {
  const override = config.perSurfaceOverrides[id];
  const baseRegion = config.glassRegions[defaultRegion];
  const useCustom = override?.mode === 'custom';
  const op = useCustom && override.op !== undefined ? override.op : baseRegion.op;
  const blur = useCustom && override.blur !== undefined ? override.blur : baseRegion.blur;
  const fidelity =
    useCustom && override.fidelity !== undefined ? override.fidelity : config.glassFidelity;
  const rawColor = useCustom && override.color ? override.color : '';
  const tint = rawColor
    ? clampSurfaceColorForContrast(rawColor, isDark, fidelity)
    : useCustom && override.fidelity !== undefined
      ? clampSurfaceColorForContrast(
          isDark && config.glassDarkSeparate ? config.glassDarkColor : config.glassColor,
          isDark,
          fidelity,
        )
      : activeTint;

  return { op, blur, tint, fidelity };
}

export function resolveAppearanceRuntime(
  inputConfig: AppearanceConfig,
  opts: Pick<ApplyAppearanceOptions, 'systemAccent'> = {},
): ResolvedAppearanceRuntime {
  const config = normalizeAppearanceConfig(inputConfig);
  const polarity = resolveBasePolarity(config);
  const isDark = polarity === 'dark';
  const glassActive = isGlassVisuallyActive(config);

  const fallbackAccent = isDark ? '#5e9bff' : '#005fb8';
  const cleanSysAccent = normalizeHex(opts.systemAccent ?? '', true);
  const cleanCustomAccent = normalizeHex(config.accent, true);
  const accentCleared = config.accentMode === 'custom' && !cleanCustomAccent;
  const accent =
    config.accentMode === 'custom'
      ? cleanCustomAccent || fallbackAccent
      : cleanSysAccent || fallbackAccent;
  const accentInk = selectHighContrastInk(accent);
  const glassTinted = config.accentMode === 'system' || Boolean(cleanCustomAccent);

  const rawLightTint = normalizeHex(config.glassColor, true) || DEFAULT_LIGHT_GLASS_TINT;
  const rawDarkTint =
    config.glassDarkSeparate
      ? normalizeHex(config.glassDarkColor, true) || DEFAULT_DARK_GLASS_TINT
      : rawLightTint;

  const clampedLightTint = clampSurfaceColorForContrast(rawLightTint, false, config.glassFidelity);
  const clampedDarkTint = clampSurfaceColorForContrast(rawDarkTint, true, config.glassFidelity);
  const activeGlassTint = isDark ? clampedDarkTint : clampedLightTint;

  const readabilityFloorBase = isDark ? READABILITY_FLOOR_DARK : READABILITY_FLOOR_LIGHT;
  const readabilityFloor = readabilityFloorBase * clampNumber(config.glassFidelity / 100, 0, 1);

  const surfaces: Record<GlassSurfaceId, ResolvedSurfaceGlass> = {
    leftSidebar: resolveSurfaceGlassValue(config, 'leftSidebar', 'surface', isDark, activeGlassTint),
    titlebar: resolveSurfaceGlassValue(config, 'titlebar', 'surface', isDark, activeGlassTint),
    rightSidebar: resolveSurfaceGlassValue(
      config,
      'rightSidebar',
      'surface',
      isDark,
      activeGlassTint,
    ),
    conversation: resolveSurfaceGlassValue(config, 'conversation', 'card', isDark, activeGlassTint),
    settingsWindow: resolveSurfaceGlassValue(
      config,
      'settingsWindow',
      'overlay',
      isDark,
      activeGlassTint,
    ),
    thinkingTrigger: resolveSurfaceGlassValue(
      config,
      'thinkingTrigger',
      'card',
      isDark,
      activeGlassTint,
    ),
    floaters: resolveSurfaceGlassValue(config, 'floaters', 'overlay', isDark, activeGlassTint),
    hoverCard: resolveSurfaceGlassValue(config, 'hoverCard', 'overlay', isDark, activeGlassTint),
    filePreview: resolveSurfaceGlassValue(config, 'filePreview', 'overlay', isDark, activeGlassTint),
    sidebarContent: resolveSurfaceGlassValue(
      config,
      'sidebarContent',
      'card',
      isDark,
      activeGlassTint,
    ),
  };

  return {
    config,
    polarity,
    isDark,
    glassActive,
    accent,
    accentInk,
    accentCleared,
    glassTinted,
    clampedLightTint,
    clampedDarkTint,
    activeGlassTint,
    readabilityFloorBase,
    readabilityFloor,
    surfaces,
  };
}

function cornerSquareTokens(corners: SidebarSquareCorners): string {
  return [
    corners.tl ? 'tl' : '',
    corners.tr ? 'tr' : '',
    corners.br ? 'br' : '',
    corners.bl ? 'bl' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function syncAttr(el: ElementLike, name: string, value: string | null): void {
  if (value === null || value === '') {
    el.removeAttribute(name);
  } else {
    el.setAttribute(name, value);
  }
}

const MANAGED_ROOT_ATTRS: readonly string[] = [
  'data-pmx-theme',
  'data-pmx-mode',
  'data-pmx-glass',
  'data-pmx-sidebar-glass',
  'data-pmx-right-sidebar-glass',
  'data-pmx-right-sidebar-fullclear',
  'data-pmx-titlebar-glass',
  'data-pmx-thinking-mode',
  'data-pmx-corner-radius',
  'data-pmx-corner-square',
  'data-pmx-right-corner-radius',
  'data-pmx-right-corner-square',
  'data-pmx-ui-colors',
  'data-pmx-caret',
  'data-pmx-custom-heading',
  'data-pmx-custom-text',
  'data-pmx-custom-muted',
  'data-pmx-custom-font-sans',
  'data-pmx-custom-font-mono',
  'data-pmx-gpu',
  'data-pmx-reduced-transparency',
  'data-pmx-wallpaper',
  'data-prismux-theme',
  'data-prismux-mode',
  'data-prismux-glass',
  'data-prismux-gpu',
] as const;

const MANAGED_CSS_VARS: readonly string[] = [
  '--pmx-accent',
  '--pmx-accent-ink',
  '--prismux-accent',
  '--dock-accent',
  '--pmx-glass-tint-light',
  '--pmx-glass-tint-light-rgb',
  '--pmx-glass-tint-dark',
  '--pmx-glass-tint-dark-rgb',
  '--pmx-glass-tint',
  '--pmx-glass-tint-rgb',
  '--prismux-glass-tint',
  '--pmx-glass-fidelity',
  '--pmx-readability-floor-base',
  '--pmx-readability-floor',
  '--pmx-fresnel-strength',
  '--prismux-fresnel-strength',
  '--pmx-wallpaper-dim',
  '--prismux-wallpaper-dim',
  '--wall-veil',
  '--dock-glass-tint-surface',
  '--dock-glass-tint-card',
  '--dock-glass-tint-overlay',
  '--dock-glass-tint-rim',
  '--pmx-glass-surface-op',
  '--pmx-glass-surface-fill',
  '--pmx-glass-surface-blur',
  '--pmx-glass-card-op',
  '--pmx-glass-card-fill',
  '--pmx-glass-card-blur',
  '--pmx-glass-overlay-op',
  '--pmx-glass-overlay-fill',
  '--pmx-glass-overlay-blur',
  '--pmx-glass-control-op',
  '--pmx-glass-control-fill',
  '--pmx-glass-control-blur',
  '--dock-glass-surface-op',
  '--dock-glass-surface-blur',
  '--dock-glass-card-op',
  '--dock-glass-card-blur',
  '--dock-glass-overlay-op',
  '--dock-glass-overlay-blur',
  '--dock-glass-control-op',
  '--dock-glass-control-blur',
  '--prismux-glass-sidebar-fill',
  '--prismux-glass-sidebar-blur',
  '--prismux-glass-content-fill',
  '--prismux-glass-content-blur',
  '--prismux-glass-overlay-fill',
  '--prismux-glass-overlay-blur',
  '--prismux-glass-control-fill',
  '--prismux-glass-control-blur',
  '--pmx-left-sidebar-fill',
  '--pmx-left-sidebar-blur',
  '--pmx-titlebar-fill',
  '--pmx-titlebar-blur',
  '--pmx-right-sidebar-fill',
  '--pmx-right-sidebar-blur',
  '--pmx-right-sidebar-tint',
  '--pmx-conversation-tint',
  '--pmx-conversation-fidelity',
  '--pmx-conversation-floor',
  '--pmx-settings-window-fill',
  '--pmx-settings-window-blur',
  '--pmx-thinking-trigger-fill',
  '--pmx-thinking-trigger-blur',
  '--pmx-floaters-fill',
  '--pmx-floaters-blur',
  '--pmx-hovercard-fill',
  '--pmx-hovercard-blur',
  '--pmx-file-preview-fill',
  '--pmx-file-preview-blur',
  '--pmx-sidebar-content-fill',
  '--pmx-sidebar-content-color',
  '--pmx-sidebar-radius',
  '--pmx-right-sidebar-radius',
  '--pmx-ui-send',
  '--pmx-ui-link',
  '--pmx-ui-file-icon',
  '--pmx-ui-tab',
  '--pmx-ui-deep-diving',
  '--pmx-caret-color',
  '--pmx-heading-color',
  '--dock-heading',
  '--pmx-text-color',
  '--dock-fg',
  '--prismux-text',
  '--pmx-muted-color',
  '--dock-muted',
  '--prismux-muted',
  '--pmx-font-sans',
  '--pmx-font-mono',
  '--pmx-font-weight',
] as const;

/**
 * Applies the complete Prismux appearance state onto `document.documentElement` and `document.body`:
 * - Data attributes for T3 Code glass bridge & UI plugin sync (`data-pmx-*`, `data-prismux-*`)
 * - Clamped readability-floor tints, 4-region glass coordinates, and unconditional per-surface variables
 * - Independent light/dark typography colors, custom font families, caret color, and 5 UI accent overrides
 *
 * When glass is off (`themeMode !== 'glass'` or preset `'off'`), `data-pmx-glass="0"` guarantees
 * 100% lossless fallback to native T3 Code appearance.
 */
export function applyPrismuxAppearanceToDocument(
  state: AppearanceConfig,
  opts: ApplyAppearanceOptions = {},
): ResolvedAppearanceRuntime {
  const runtime = resolveAppearanceRuntime(state, opts);
  const doc = opts.document !== undefined ? opts.document : (globalThis.document as DocumentLike | undefined);
  if (!doc || !doc.documentElement) {
    return runtime;
  }

  const html = doc.documentElement;
  const body = doc.body ?? null;
  const targets: ElementLike[] = body ? [html, body] : [html];
  const cfg = runtime.config;
  const glassFlag = runtime.glassActive ? '1' : '0';
  const gpuFlag = opts.gpuAvailable === false ? '0' : '1';
  const reducedTransFlag = opts.reducedTransparency === true ? '1' : null;
  const wallpaperFlag = opts.wallpaperActive ? '1' : null;

  const leftCornerRadius = cfg.sidebarCornerRadius;
  const rightCornerRadius = cfg.rightSidebarCornerRadius ?? leftCornerRadius;
  const leftCornerSq = cornerSquareTokens(cfg.sidebarSquareCorners);
  const rightCornerSq = cornerSquareTokens(
    cfg.rightSidebarSquareCorners ?? cfg.sidebarSquareCorners,
  );

  const activeTypo = runtime.isDark ? cfg.typography.dark : cfg.typography.light;
  const cleanHeading = normalizeHex(activeTypo.headingColor, true);
  const cleanText = normalizeHex(activeTypo.textColor, true);
  const cleanMuted = normalizeHex(activeTypo.mutedColor, true);
  const cleanCaret = normalizeHex(cfg.caretColor, true);

  for (const el of targets) {
    syncAttr(el, 'data-pmx-theme', runtime.polarity);
    syncAttr(el, 'data-pmx-mode', cfg.themeMode);
    syncAttr(el, 'data-pmx-glass', glassFlag);
    syncAttr(el, 'data-pmx-sidebar-glass', runtime.glassActive && cfg.leftSidebarGlass ? '1' : '0');
    syncAttr(
      el,
      'data-pmx-right-sidebar-glass',
      runtime.glassActive && cfg.rightSidebarGlass ? '1' : '0',
    );
    syncAttr(
      el,
      'data-pmx-right-sidebar-fullclear',
      runtime.glassActive && cfg.rightSidebarFullClear ? '1' : '0',
    );
    syncAttr(el, 'data-pmx-titlebar-glass', runtime.glassActive && cfg.titlebarGlass ? '1' : '0');
    syncAttr(el, 'data-pmx-thinking-mode', runtime.glassActive ? cfg.thinkingMode : 'off');
    syncAttr(
      el,
      'data-pmx-corner-radius',
      leftCornerRadius === 'native' ? null : String(leftCornerRadius),
    );
    syncAttr(el, 'data-pmx-corner-square', leftCornerSq || null);
    syncAttr(
      el,
      'data-pmx-right-corner-radius',
      rightCornerRadius === 'native' ? null : String(rightCornerRadius),
    );
    syncAttr(el, 'data-pmx-right-corner-square', rightCornerSq || null);
    syncAttr(el, 'data-pmx-ui-colors', cfg.uiColorCustom.enabled ? '1' : null);
    syncAttr(el, 'data-pmx-caret', cleanCaret ? '1' : null);
    syncAttr(el, 'data-pmx-custom-heading', cleanHeading ? '1' : null);
    syncAttr(el, 'data-pmx-custom-text', cleanText ? '1' : null);
    syncAttr(el, 'data-pmx-custom-muted', cleanMuted ? '1' : null);
    syncAttr(el, 'data-pmx-custom-font-sans', cfg.typography.fontFamily ? '1' : null);
    syncAttr(el, 'data-pmx-custom-font-mono', cfg.typography.codeFontFamily ? '1' : null);
    syncAttr(el, 'data-pmx-gpu', gpuFlag);
    syncAttr(el, 'data-pmx-reduced-transparency', reducedTransFlag);
    syncAttr(el, 'data-pmx-wallpaper', wallpaperFlag);

    // Mirror official Prismux UI/UX mandate §2.6 attributes for plugins.
    syncAttr(el, 'data-prismux-theme', runtime.polarity);
    syncAttr(el, 'data-prismux-mode', cfg.themeMode);
    syncAttr(el, 'data-prismux-glass', glassFlag);
    syncAttr(el, 'data-prismux-gpu', gpuFlag);

    el.classList.toggle('pmx-light', !runtime.isDark);
    el.classList.toggle('pmx-dark', runtime.isDark);
    el.classList.toggle('pmx-glass', runtime.glassActive);
  }

  if (opts.syncT3DarkClass) {
    html.classList.toggle('dark', runtime.isDark);
  }

  const s = html.style;
  s.setProperty('--pmx-accent', runtime.accent);
  s.setProperty('--pmx-accent-ink', runtime.accentInk);
  s.setProperty('--prismux-accent', runtime.accent);
  s.setProperty('--dock-accent', runtime.accent);

  s.setProperty('--pmx-glass-tint-light', runtime.clampedLightTint);
  s.setProperty('--pmx-glass-tint-light-rgb', toRgbTriple(runtime.clampedLightTint, '255, 255, 255'));
  s.setProperty('--pmx-glass-tint-dark', runtime.clampedDarkTint);
  s.setProperty('--pmx-glass-tint-dark-rgb', toRgbTriple(runtime.clampedDarkTint, '13, 21, 36'));
  s.setProperty('--pmx-glass-tint', runtime.activeGlassTint);
  s.setProperty(
    '--pmx-glass-tint-rgb',
    toRgbTriple(runtime.activeGlassTint, runtime.isDark ? '13, 21, 36' : '255, 255, 255'),
  );
  s.setProperty('--prismux-glass-tint', runtime.activeGlassTint);

  const fidelityScalar = clampNumber(cfg.glassFidelity / 100, 0, 1);
  s.setProperty('--pmx-glass-fidelity', fidelityScalar.toFixed(4));
  s.setProperty('--pmx-readability-floor-base', runtime.readabilityFloorBase.toFixed(2));
  s.setProperty('--pmx-readability-floor', runtime.readabilityFloor.toFixed(4));

  const fresnelScalar = clampNumber(cfg.fresnelStrength / 100, 0, 1);
  s.setProperty('--pmx-fresnel-strength', fresnelScalar.toFixed(3));
  s.setProperty('--prismux-fresnel-strength', fresnelScalar.toFixed(3));

  const wallDimScalar = clampNumber(cfg.wallpaperDim / 100, 0, 1);
  s.setProperty('--pmx-wallpaper-dim', wallDimScalar.toFixed(3));
  s.setProperty('--prismux-wallpaper-dim', wallDimScalar.toFixed(3));
  s.setProperty('--wall-veil', `rgba(0, 0, 0, ${wallDimScalar.toFixed(3)})`);

  s.setProperty('--dock-glass-tint-surface', runtime.glassTinted ? '14%' : '0%');
  s.setProperty('--dock-glass-tint-card', runtime.glassTinted ? '10%' : '0%');
  s.setProperty('--dock-glass-tint-overlay', runtime.glassTinted ? '12%' : '0%');
  s.setProperty('--dock-glass-tint-rim', runtime.glassTinted ? '26%' : '0%');

  const g = cfg.glassRegions;
  s.setProperty('--pmx-glass-surface-op', (g.surface.op / 100).toFixed(3));
  s.setProperty('--pmx-glass-surface-fill', `${g.surface.op}%`);
  s.setProperty('--pmx-glass-surface-blur', `${g.surface.blur}px`);
  s.setProperty('--pmx-glass-card-op', (g.card.op / 100).toFixed(3));
  s.setProperty('--pmx-glass-card-fill', `${g.card.op}%`);
  s.setProperty('--pmx-glass-card-blur', `${g.card.blur}px`);
  s.setProperty('--pmx-glass-overlay-op', (g.overlay.op / 100).toFixed(3));
  s.setProperty('--pmx-glass-overlay-fill', `${g.overlay.op}%`);
  s.setProperty('--pmx-glass-overlay-blur', `${g.overlay.blur}px`);
  s.setProperty('--pmx-glass-control-op', (g.control.op / 100).toFixed(3));
  s.setProperty('--pmx-glass-control-fill', `${g.control.op}%`);
  s.setProperty('--pmx-glass-control-blur', `${g.control.blur}px`);

  // FISH-Dock & Prismux UI/UX mandate aliases.
  s.setProperty('--dock-glass-surface-op', (g.surface.op / 100).toFixed(3));
  s.setProperty('--dock-glass-surface-blur', `${g.surface.blur}px`);
  s.setProperty('--dock-glass-card-op', (g.card.op / 100).toFixed(3));
  s.setProperty('--dock-glass-card-blur', `${g.card.blur}px`);
  s.setProperty('--dock-glass-overlay-op', (g.overlay.op / 100).toFixed(3));
  s.setProperty('--dock-glass-overlay-blur', `${g.overlay.blur}px`);
  s.setProperty('--dock-glass-control-op', (g.control.op / 100).toFixed(3));
  s.setProperty('--dock-glass-control-blur', `${g.control.blur}px`);

  s.setProperty('--prismux-glass-sidebar-fill', `${g.surface.op}%`);
  s.setProperty('--prismux-glass-sidebar-blur', `${g.surface.blur}px`);
  s.setProperty('--prismux-glass-content-fill', `${g.card.op}%`);
  s.setProperty('--prismux-glass-content-blur', `${g.card.blur}px`);
  s.setProperty('--prismux-glass-overlay-fill', `${g.overlay.op}%`);
  s.setProperty('--prismux-glass-overlay-blur', `${g.overlay.blur}px`);
  s.setProperty('--prismux-glass-control-fill', `${g.control.op}%`);
  s.setProperty('--prismux-glass-control-blur', `${g.control.blur}px`);

  // Unconditional per-surface resolved variables (Contract ①: always write resolved value).
  const sf = runtime.surfaces;
  s.setProperty('--pmx-left-sidebar-fill', `${sf.leftSidebar.op}%`);
  s.setProperty('--pmx-left-sidebar-blur', `${sf.leftSidebar.blur}px`);
  s.setProperty('--pmx-titlebar-fill', `${sf.titlebar.op}%`);
  s.setProperty('--pmx-titlebar-blur', `${sf.titlebar.blur}px`);
  s.setProperty('--pmx-right-sidebar-fill', `${sf.rightSidebar.op}%`);
  s.setProperty('--pmx-right-sidebar-blur', `${sf.rightSidebar.blur}px`);
  s.setProperty('--pmx-right-sidebar-tint', sf.rightSidebar.tint);

  const convFid = clampNumber(sf.conversation.fidelity / 100, 0, 1);
  s.setProperty('--pmx-conversation-tint', sf.conversation.tint);
  s.setProperty('--pmx-conversation-fidelity', convFid.toFixed(4));
  s.setProperty('--pmx-conversation-floor', (runtime.readabilityFloorBase * convFid).toFixed(4));

  s.setProperty('--pmx-settings-window-fill', `${sf.settingsWindow.op}%`);
  s.setProperty('--pmx-settings-window-blur', `${sf.settingsWindow.blur}px`);
  s.setProperty('--pmx-thinking-trigger-fill', `${sf.thinkingTrigger.op}%`);
  s.setProperty('--pmx-thinking-trigger-blur', `${sf.thinkingTrigger.blur}px`);
  s.setProperty('--pmx-floaters-fill', `${sf.floaters.op}%`);
  s.setProperty('--pmx-floaters-blur', `${sf.floaters.blur}px`);
  s.setProperty('--pmx-hovercard-fill', `${Math.max(45, sf.hoverCard.op)}%`);
  s.setProperty('--pmx-hovercard-blur', `${sf.hoverCard.blur}px`);
  s.setProperty('--pmx-file-preview-fill', `${Math.max(35, sf.filePreview.op)}%`);
  s.setProperty('--pmx-file-preview-blur', `${sf.filePreview.blur}px`);
  s.setProperty('--pmx-sidebar-content-fill', `${Math.max(20, sf.sidebarContent.op)}%`);
  s.setProperty('--pmx-sidebar-content-color', sf.sidebarContent.tint);

  // Sidebar corner radius variables.
  if (leftCornerRadius !== 'native') {
    s.setProperty('--pmx-sidebar-radius', `${leftCornerRadius}px`);
  } else {
    s.removeProperty('--pmx-sidebar-radius');
  }
  if (rightCornerRadius !== 'native') {
    s.setProperty('--pmx-right-sidebar-radius', `${rightCornerRadius}px`);
  } else {
    s.removeProperty('--pmx-right-sidebar-radius');
  }

  // 5 custom UI element colors (non-destructive: fall back to effective accent when enabled).
  const ui = cfg.uiColorCustom;
  s.setProperty('--pmx-ui-send', ui.send || runtime.accent);
  s.setProperty('--pmx-ui-link', ui.link || runtime.accent);
  s.setProperty('--pmx-ui-file-icon', ui.fileIcon || runtime.accent);
  s.setProperty('--pmx-ui-tab', ui.tab || runtime.accent);
  s.setProperty('--pmx-ui-deep-diving', ui.deepDiving || (runtime.isDark ? '#6cb6ff' : runtime.accent));

  // Caret color.
  if (cleanCaret) {
    s.setProperty('--pmx-caret-color', cleanCaret);
  } else {
    s.removeProperty('--pmx-caret-color');
  }

  // Independent light/dark typography colors.
  if (cleanHeading) {
    s.setProperty('--pmx-heading-color', cleanHeading);
    s.setProperty('--dock-heading', cleanHeading);
  } else {
    s.removeProperty('--pmx-heading-color');
    s.removeProperty('--dock-heading');
  }

  if (cleanText) {
    s.setProperty('--pmx-text-color', cleanText);
    s.setProperty('--dock-fg', cleanText);
    s.setProperty('--prismux-text', cleanText);
  } else {
    s.removeProperty('--pmx-text-color');
    s.removeProperty('--dock-fg');
    s.removeProperty('--prismux-text');
  }

  if (cleanMuted) {
    s.setProperty('--pmx-muted-color', cleanMuted);
    s.setProperty('--dock-muted', cleanMuted);
    s.setProperty('--prismux-muted', cleanMuted);
  } else {
    s.removeProperty('--pmx-muted-color');
    s.removeProperty('--dock-muted');
    s.removeProperty('--prismux-muted');
  }

  if (cfg.typography.fontFamily) {
    s.setProperty('--pmx-font-sans', cfg.typography.fontFamily);
  } else {
    s.removeProperty('--pmx-font-sans');
  }

  if (cfg.typography.codeFontFamily) {
    s.setProperty('--pmx-font-mono', cfg.typography.codeFontFamily);
  } else {
    s.removeProperty('--pmx-font-mono');
  }

  if (cfg.typography.fontWeight !== undefined) {
    s.setProperty('--pmx-font-weight', String(cfg.typography.fontWeight));
  } else {
    s.removeProperty('--pmx-font-weight');
  }

  return runtime;
}

/**
 * Cleanly removes every attribute, class, and CSS variable written by `applyPrismuxAppearanceToDocument`.
 */
export function clearPrismuxAppearanceFromDocument(doc?: DocumentLike | null): void {
  const targetDoc = doc !== undefined ? doc : (globalThis.document as DocumentLike | undefined);
  if (!targetDoc || !targetDoc.documentElement) return;
  const html = targetDoc.documentElement;
  const body = targetDoc.body ?? null;
  const targets: ElementLike[] = body ? [html, body] : [html];

  for (const el of targets) {
    for (const attr of MANAGED_ROOT_ATTRS) {
      el.removeAttribute(attr);
    }
    el.classList.remove('pmx-light', 'pmx-dark', 'pmx-glass');
  }

  for (const cssVar of MANAGED_CSS_VARS) {
    html.style.removeProperty(cssVar);
  }
}

export function getTypographyFallbackPalette(polarity: BaseThemePolarity) {
  return DEFAULT_TYPOGRAPHY_FALLBACKS[polarity];
}
