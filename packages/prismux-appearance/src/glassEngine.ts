import {
  DEFAULT_APPEARANCE_CONFIG,
  DEFAULT_GLASS_ZONES,
  DEFAULT_TYPOGRAPHY_FALLBACKS,
  GLASS_PRESETS,
  GLASS_REGION_LIMITS,
  GLASS_THEME_BASE_IDS,
  GLASS_ZONE_CSS_NAMES,
  GLASS_ZONE_IDS,
  GLASS_ZONE_LIMITS,
  GLASS_ZONE_META,
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
  type GlassThemeBase,
  type GlassZoneConfig,
  type GlassZoneDescriptor,
  type GlassZoneId,
  type GlassZoneIdInput,
  type GlassZoneMode,
  type GlassZonesConfig,
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
export const DEFAULT_DARK_GLASS_TINT = '#000000';
/** Default inner workspace stage corner radius token (`--pmx-inner-stage-radius`). */
export const DEFAULT_INNER_STAGE_RADIUS_PX = 14;
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
  /** Optional sync of the host `.dark` class on `documentElement` (defaults to false). */
  syncDarkClass?: boolean;
  /** @deprecated Use `syncDarkClass`. */
  syncT3DarkClass?: boolean;
}

export interface ResolvedSurfaceGlass {
  op: number;
  blur: number;
  tint: string;
  fidelity: number;
}

export interface ResolvedGlassZone {
  id: GlassZoneId;
  cssName: string;
  /** User-configured zone mode ('inherit' | 'custom' | 'solid'). */
  mode: GlassZoneMode;
  /** Effective zone mode after reconciling legacy gates and active glass state. */
  effectiveMode: GlassZoneMode;
  /** Effective fill opacity percentage (0-100; 100 when solid). */
  opacity: number;
  /** Effective backdrop blur radius in px (0-48; 0 when solid). */
  blurPx: number;
  /** Effective backdrop color saturation percentage (80-240; 100 when solid). */
  saturation: number;
  /** Clamped surface tint hex (#rrggbb). */
  tint: string;
  /** Computed CSS background color (`rgba(...)` when translucent, `rgb(...)` when solid). */
  bgCss: string;
  /** Computed CSS `backdrop-filter` string (`blur(...) saturate(...) ...` or `'none'`). */
  backdropCss: string;
  /** Computed CSS border color string. */
  borderCss: string;
  /** Computed CSS Fresnel specular sheen gradient or `'none'`. */
  sheenCss: string;
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
  zones: Record<GlassZoneId, ResolvedGlassZone>;
}

const VALID_THEME_MODES = new Set<ThemeMode>(['light', 'dark', 'glass']);
const VALID_POLARITIES = new Set<BaseThemePolarity>(['light', 'dark']);
const VALID_ACCENT_MODES = new Set<AccentMode>(['system', 'custom']);
const VALID_GLASS_PRESETS = new Set<GlassPreset>(['off', 'light', 'balanced', 'clear', 'custom']);
const VALID_GLASS_THEME_BASES = new Set<GlassThemeBase>(GLASS_THEME_BASE_IDS);
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
const VALID_ZONE_MODES = new Set<GlassZoneMode>(['inherit', 'custom', 'solid']);
const ZONE_META_BY_ID: Readonly<Record<GlassZoneId, GlassZoneDescriptor>> = Object.fromEntries(
  GLASS_ZONE_META.map((item) => [item.id, item]),
) as Record<GlassZoneId, GlassZoneDescriptor>;

/**
 * Clamps surface tint brightness so `fidelity === 100` retains >= 4.5:1 WCAG contrast
 * over worst-case wallpaper pixels (#000 light, #fff dark) at any opacity; lerps to raw hex as fidelity -> 0.
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

function sanitizeGlassZoneEntry(
  id: GlassZoneId,
  raw: Partial<GlassZoneConfig> | undefined,
  fallback: GlassZoneConfig,
): GlassZoneConfig {
  const meta = ZONE_META_BY_ID[id];
  const src = raw && typeof raw === 'object' ? raw : fallback;
  const mode: GlassZoneMode =
    src.mode && VALID_ZONE_MODES.has(src.mode) ? src.mode : fallback.mode;
  const clean: GlassZoneConfig = { mode };

  const opacityRaw = src.opacity !== undefined ? src.opacity : fallback.opacity;
  if (opacityRaw !== undefined && Number.isFinite(Number(opacityRaw))) {
    clean.opacity = Math.round(
      clampNumber(Number(opacityRaw), meta.minOpacity, GLASS_ZONE_LIMITS.opacityMax),
    );
  }

  const blurRaw = src.blurPx !== undefined ? src.blurPx : fallback.blurPx;
  if (blurRaw !== undefined && Number.isFinite(Number(blurRaw))) {
    clean.blurPx = Math.round(
      clampNumber(Number(blurRaw), GLASS_ZONE_LIMITS.blurMin, GLASS_ZONE_LIMITS.blurMax),
    );
  }

  const satRaw = src.saturation !== undefined ? src.saturation : fallback.saturation;
  if (satRaw !== undefined && Number.isFinite(Number(satRaw))) {
    clean.saturation = Math.round(
      clampNumber(
        Number(satRaw),
        GLASS_ZONE_LIMITS.saturationMin,
        GLASS_ZONE_LIMITS.saturationMax,
      ),
    );
  }

  const tintRaw = src.tint !== undefined ? src.tint : fallback.tint;
  if (typeof tintRaw === 'string') {
    const normalizedTint = tintRaw === '' ? '' : normalizeHex(tintRaw, true);
    if (normalizedTint) {
      clean.tint = normalizedTint;
    }
  }

  return clean;
}

/**
 * Maps legacy pre-shellFrame zone ids (`leftSidebar`, `chromeBars`) into the unified `shellFrame` zone
 * while preserving canonical 8-zone ids (`shellFrame`, `rightSidebar`, `mainCanvas`, `workPanels`,
 * `composer`, `overlays`, `userBubble`, `overviewPanel`).
 */
export function canonicalizeGlassZoneId(id: GlassZoneIdInput): GlassZoneId {
  if (id === 'leftSidebar' || id === 'chromeBars') return 'shellFrame';
  return id;
}

function sanitizeGlassZones(
  raw: Partial<Record<GlassZoneIdInput, Partial<GlassZoneConfig>>> | undefined,
  base: GlassZonesConfig = DEFAULT_GLASS_ZONES,
): GlassZonesConfig {
  const legacyLeft = raw?.leftSidebar;
  const legacyChrome = raw?.chromeBars;
  const rawShellFrame =
    raw?.shellFrame ??
    (legacyLeft?.mode && legacyLeft.mode !== 'inherit'
      ? legacyLeft
      : legacyChrome?.mode && legacyChrome.mode !== 'inherit'
        ? legacyChrome
        : legacyLeft ?? legacyChrome);

  return {
    shellFrame: sanitizeGlassZoneEntry('shellFrame', rawShellFrame, base.shellFrame),
    rightSidebar: sanitizeGlassZoneEntry('rightSidebar', raw?.rightSidebar, base.rightSidebar),
    mainCanvas: sanitizeGlassZoneEntry('mainCanvas', raw?.mainCanvas, base.mainCanvas),
    workPanels: sanitizeGlassZoneEntry(
      'workPanels',
      raw?.workPanels,
      base.workPanels ?? DEFAULT_GLASS_ZONES.workPanels,
    ),
    composer: sanitizeGlassZoneEntry('composer', raw?.composer, base.composer),
    overlays: sanitizeGlassZoneEntry('overlays', raw?.overlays, base.overlays),
    userBubble: sanitizeGlassZoneEntry(
      'userBubble',
      raw?.userBubble,
      base.userBubble ?? DEFAULT_GLASS_ZONES.userBubble,
    ),
    overviewPanel: sanitizeGlassZoneEntry(
      'overviewPanel',
      raw?.overviewPanel,
      base.overviewPanel ?? DEFAULT_GLASS_ZONES.overviewPanel,
    ),
  };
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

  const fallbackGlassThemeBase: GlassThemeBase =
    base.glassThemeBase && VALID_GLASS_THEME_BASES.has(base.glassThemeBase)
      ? base.glassThemeBase
      : 'pure';
  const glassThemeBase: GlassThemeBase =
    src.glassThemeBase !== undefined
      ? VALID_GLASS_THEME_BASES.has(src.glassThemeBase)
        ? src.glassThemeBase
        : 'pure'
      : fallbackGlassThemeBase;

  const isNamedActivePreset =
    glassPreset === 'light' || glassPreset === 'balanced' || glassPreset === 'clear';
  const presetFallbackRegions =
    isNamedActivePreset && src.glassPreset === glassPreset
      ? GLASS_PRESETS[glassPreset]
      : base.glassRegions;

  const rawRegions: GlassRegionsConfig = {
    surface: sanitizeRegionValues(src.glassRegions?.surface, presetFallbackRegions.surface),
    card: sanitizeRegionValues(src.glassRegions?.card, presetFallbackRegions.card),
    overlay: sanitizeRegionValues(src.glassRegions?.overlay, presetFallbackRegions.overlay),
    control: sanitizeRegionValues(src.glassRegions?.control, presetFallbackRegions.control),
  };

  // Backfill stale zero/off-state region residue (`{ op: 0|100, blur: 0 }`) when a named
  // active preset (`light` | `balanced` | `clear`) is selected so default glass never drops to blur: 0px.
  const isStaleZeroOrOffRegion = (r: GlassRegionValues): boolean =>
    r.blur === 0 && (r.op === 0 || r.op === 100);

  let glassRegions: GlassRegionsConfig = rawRegions;
  if (isNamedActivePreset) {
    const namedTpl = GLASS_PRESETS[glassPreset];
    const allRegionsZeroBlur = REGION_IDS.every((id) => isStaleZeroOrOffRegion(rawRegions[id]));
    const explicitNamedPreset = src.glassPreset === glassPreset;
    if (allRegionsZeroBlur) {
      glassRegions = {
        surface: { ...namedTpl.surface },
        card: { ...namedTpl.card },
        overlay: { ...namedTpl.overlay },
        control: { ...namedTpl.control },
      };
    } else if (explicitNamedPreset) {
      glassRegions = {
        surface: isStaleZeroOrOffRegion(rawRegions.surface)
          ? { ...namedTpl.surface }
          : rawRegions.surface,
        card: isStaleZeroOrOffRegion(rawRegions.card) ? { ...namedTpl.card } : rawRegions.card,
        overlay: isStaleZeroOrOffRegion(rawRegions.overlay)
          ? { ...namedTpl.overlay }
          : rawRegions.overlay,
        control: isStaleZeroOrOffRegion(rawRegions.control)
          ? { ...namedTpl.control }
          : rawRegions.control,
      };
    }
  }

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

  const glassZones = sanitizeGlassZones(
    src.glassZones,
    base.glassZones ?? DEFAULT_GLASS_ZONES,
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
    glassThemeBase,
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
    glassZones,
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
 * Updates one workbench glass zone (migrating legacy `leftSidebar`/`chromeBars` onto `shellFrame`).
 * Seeds missing custom opacity/blur from effective inherited values to avoid visual jumps.
 */
export function updateGlassZone(
  config: AppearanceConfig,
  zoneIdInput: GlassZoneIdInput,
  patch: Partial<GlassZoneConfig>,
): AppearanceConfig {
  const zoneId = canonicalizeGlassZoneId(zoneIdInput);
  const normalized = normalizeAppearanceConfig(config);
  const existing = normalized.glassZones[zoneId];
  const nextMode: GlassZoneMode =
    patch.mode && VALID_ZONE_MODES.has(patch.mode) ? patch.mode : existing.mode;

  let seededPatch: Partial<GlassZoneConfig> = { ...patch, mode: nextMode };
  if (
    nextMode === 'custom' &&
    (existing.opacity === undefined || existing.blurPx === undefined) &&
    (patch.opacity === undefined || patch.blurPx === undefined)
  ) {
    const rt = resolveAppearanceRuntime(normalized);
    const currentZone = rt.zones[zoneId];
    const meta = ZONE_META_BY_ID[zoneId];
    const fallbackOpacity =
      currentZone.effectiveMode === 'solid'
        ? Math.max(meta.minOpacity, normalized.glassRegions[meta.defaultRegion].op)
        : currentZone.opacity;
    const fallbackBlur =
      currentZone.effectiveMode === 'solid'
        ? normalized.glassRegions[meta.defaultRegion].blur
        : currentZone.blurPx;
    seededPatch = {
      opacity: existing.opacity ?? fallbackOpacity,
      blurPx: existing.blurPx ?? fallbackBlur,
      saturation: existing.saturation ?? meta.defaultSaturation,
      ...patch,
      mode: 'custom',
    };
  }

  const nextEntry = sanitizeGlassZoneEntry(zoneId, seededPatch, existing);

  // When explicitly setting a zone back to 'inherit', also reconcile legacy gates for that zone
  // so "恢复跟随全局" always genuinely follows global glass state.
  let leftSidebarGlass = normalized.leftSidebarGlass;
  let rightSidebarGlass = normalized.rightSidebarGlass;
  let rightSidebarFullClear = normalized.rightSidebarFullClear;
  let titlebarGlass = normalized.titlebarGlass;
  let perSurfaceOverrides = normalized.perSurfaceOverrides;

  if (nextMode === 'inherit') {
    if (zoneId === 'shellFrame') {
      leftSidebarGlass = true;
      titlebarGlass = true;
      if (perSurfaceOverrides.leftSidebar?.mode === 'custom') {
        perSurfaceOverrides = { ...perSurfaceOverrides, leftSidebar: { mode: 'inherit' } };
      }
      if (perSurfaceOverrides.titlebar?.mode === 'custom') {
        perSurfaceOverrides = { ...perSurfaceOverrides, titlebar: { mode: 'inherit' } };
      }
    } else if (zoneId === 'rightSidebar') {
      rightSidebarGlass = true;
      rightSidebarFullClear = false;
      if (perSurfaceOverrides.rightSidebar?.mode === 'custom') {
        perSurfaceOverrides = { ...perSurfaceOverrides, rightSidebar: { mode: 'inherit' } };
      }
    }
  }

  return {
    ...normalized,
    leftSidebarGlass,
    rightSidebarGlass,
    rightSidebarFullClear,
    titlebarGlass,
    perSurfaceOverrides,
    glassZones: {
      ...normalized.glassZones,
      [zoneId]: nextEntry,
    },
  };
}

/** Resets a single glass zone cleanly back to `'inherit'` (following global glass / shellFrame). */
export function resetGlassZone(
  config: AppearanceConfig,
  zoneIdInput: GlassZoneIdInput,
): AppearanceConfig {
  const zoneId = canonicalizeGlassZoneId(zoneIdInput);
  const normalized = normalizeAppearanceConfig(config);
  const next = updateGlassZone(normalized, zoneId, { mode: 'inherit' });
  return {
    ...next,
    glassZones: {
      ...next.glassZones,
      [zoneId]: { mode: 'inherit' },
    },
  };
}

/** Resets all 8 glass zones (plus legacy surface gates) back to `'inherit'`. */
export function resetAllGlassZones(config: AppearanceConfig): AppearanceConfig {
  const normalized = normalizeAppearanceConfig(config);
  return {
    ...normalized,
    leftSidebarGlass: true,
    rightSidebarGlass: true,
    rightSidebarFullClear: false,
    titlebarGlass: true,
    perSurfaceOverrides: {},
    glassZones: {
      shellFrame: { mode: 'inherit' },
      rightSidebar: { mode: 'inherit' },
      mainCanvas: { mode: 'inherit' },
      workPanels: { mode: 'inherit' },
      composer: { mode: 'inherit' },
      overlays: { mode: 'inherit' },
      userBubble: { mode: 'inherit' },
      overviewPanel: { mode: 'inherit' },
    },
  };
}

/** Counts how many of the 8 workbench zones diverge from `'inherit'` (`'custom'` or `'solid'`). */
export function countCustomizedGlassZones(config: AppearanceConfig): number {
  const normalized = normalizeAppearanceConfig(config);
  let count = 0;
  for (const id of GLASS_ZONE_IDS) {
    const entry = normalized.glassZones[id];
    if (entry.mode !== 'inherit') {
      count += 1;
      continue;
    }
    if (
      (id === 'shellFrame' && (!normalized.leftSidebarGlass || !normalized.titlebarGlass)) ||
      (id === 'rightSidebar' && (!normalized.rightSidebarGlass || normalized.rightSidebarFullClear))
    ) {
      count += 1;
    }
  }
  return count;
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

/**
 * Selects a liquid-glass theme substrate; choosing any non-`pure` substrate while glass mode is
 * inactive (or preset is `'off'`) smoothly wakes Liquid Glass so the substrate is immediately visible.
 */
export function setGlassThemeBaseWithAutoWake(
  config: AppearanceConfig,
  base: GlassThemeBase,
): AppearanceConfig {
  const safeBase: GlassThemeBase = VALID_GLASS_THEME_BASES.has(base) ? base : 'pure';
  const woken =
    safeBase !== 'pure' && (config.themeMode !== 'glass' || config.glassPreset === 'off')
      ? setThemeModeWithGlassAutoWake(config, 'glass')
      : config;
  return {
    ...woken,
    glassThemeBase: safeBase,
  };
}

export function resolveBasePolarity(config: AppearanceConfig): BaseThemePolarity {
  if (config.themeMode === 'light') return 'light';
  if (config.themeMode === 'dark') return 'dark';
  return config.glassBasePolarity;
}

export function isGlassVisuallyActive(config: AppearanceConfig): boolean {
  if (config.themeMode !== 'glass') return false;
  const anyRegionActive = REGION_IDS.some((id) => {
    const r = config.glassRegions[id];
    return r.op < 100 || r.blur > 0;
  });
  if (anyRegionActive) return true;
  if (!config.glassZones) return false;
  return GLASS_ZONE_IDS.some((id) => {
    const z = config.glassZones[id];
    if (!z || z.mode !== 'custom') return false;
    return (z.opacity !== undefined && z.opacity < 100) || (z.blurPx !== undefined && z.blurPx > 0);
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

function buildZoneBorderCss(isDark: boolean, fresnelScalar: number): string {
  if (isDark) {
    const a = clampNumber(0.1 + 0.12 * fresnelScalar, 0.08, 0.28);
    return `rgba(255, 255, 255, ${a.toFixed(3)})`;
  }
  const a = clampNumber(0.1 + 0.08 * fresnelScalar, 0.08, 0.24);
  return `rgba(15, 23, 42, ${a.toFixed(3)})`;
}

function buildZoneSheenCss(isDark: boolean, fresnelScalar: number, id: GlassZoneId): string {
  if (fresnelScalar <= 0.01) return 'none';
  // Monolithic outer-frame zones (shellFrame & rightSidebar) share a height-invariant
  // uniform specular glaze so the left sidebar, top bar, bottom status bar, right edge,
  // right sidebar, and 14px concave corner fillets merge with 0.0 RGB discontinuity.
  const isOuterFrameZone = id === 'shellFrame' || id === 'rightSidebar';
  if (isOuterFrameZone) {
    const glaze = (isDark ? 0.028 : 0.09) * fresnelScalar;
    return `linear-gradient(180deg, rgba(255, 255, 255, ${glaze.toFixed(4)}) 0%, rgba(255, 255, 255, ${glaze.toFixed(4)}) 100%)`;
  }
  if (id === 'userBubble') {
    if (isDark) {
      const tl = 0.075 * fresnelScalar;
      const mid = 0.012 * fresnelScalar;
      const br = 0.022 * fresnelScalar;
      return `linear-gradient(135deg, rgba(255, 255, 255, ${tl.toFixed(4)}) 0%, rgba(255, 255, 255, ${mid.toFixed(4)}) 42%, rgba(255, 255, 255, 0) 70%, rgba(255, 255, 255, ${br.toFixed(4)}) 100%)`;
    }
    const tl = 0.32 * fresnelScalar;
    const mid = 0.06 * fresnelScalar;
    const br = 0.1 * fresnelScalar;
    return `linear-gradient(135deg, rgba(255, 255, 255, ${tl.toFixed(4)}) 0%, rgba(255, 255, 255, ${mid.toFixed(4)}) 48%, rgba(255, 255, 255, ${br.toFixed(4)}) 100%)`;
  }
  if (isDark) {
    const top = (id === 'mainCanvas' ? 0.045 : id === 'overviewPanel' ? 0.055 : 0.065) * fresnelScalar;
    const mid = (id === 'mainCanvas' ? 0.0 : id === 'overviewPanel' ? 0.01 : 0.016) * fresnelScalar;
    const bot = (id === 'mainCanvas' ? 0.02 : id === 'overviewPanel' ? 0.024 : 0.032) * fresnelScalar;
    return `linear-gradient(180deg, rgba(255, 255, 255, ${top.toFixed(4)}) 0%, rgba(255, 255, 255, ${mid.toFixed(4)}) 46%, rgba(255, 255, 255, ${bot.toFixed(4)}) 100%)`;
  }
  const top = (id === 'mainCanvas' ? 0.16 : id === 'overviewPanel' ? 0.22 : 0.24) * fresnelScalar;
  const bot = (id === 'mainCanvas' ? 0.04 : id === 'overviewPanel' ? 0.06 : 0.08) * fresnelScalar;
  return `linear-gradient(180deg, rgba(255, 255, 255, ${top.toFixed(4)}) 0%, rgba(255, 255, 255, 0) 48%, rgba(255, 255, 255, ${bot.toFixed(4)}) 100%)`;
}

function resolveZoneGlassValue(
  config: AppearanceConfig,
  id: GlassZoneId,
  isDark: boolean,
  glassActive: boolean,
  activeTint: string,
  surfaces: Record<GlassSurfaceId, ResolvedSurfaceGlass>,
  shellFrameResolved?: ResolvedGlassZone,
): ResolvedGlassZone {
  const meta = ZONE_META_BY_ID[id];
  const cssName = GLASS_ZONE_CSS_NAMES[id];
  const zoneCfg = config.glassZones[id] ?? { mode: 'inherit' };
  const fidelityScalar = clampNumber(config.glassFidelity / 100, 0, 1);
  const fresnelScalar = clampNumber(config.fresnelStrength / 100, 0, 1);

  let effectiveMode: GlassZoneMode = zoneCfg.mode;
  if (effectiveMode === 'inherit') {
    if (
      (id === 'shellFrame' && (!config.leftSidebarGlass || !config.titlebarGlass)) ||
      (id === 'rightSidebar' && !config.rightSidebarGlass)
    ) {
      effectiveMode = 'solid';
    }
  }

  // Right feature sidebar follows the monolithic `shellFrame` by default when in pure `'inherit'` mode
  // (unless legacy `rightSidebarFullClear` or `perSurfaceOverrides.rightSidebar` overrides it).
  if (
    id === 'rightSidebar' &&
    glassActive &&
    effectiveMode === 'inherit' &&
    !config.rightSidebarFullClear &&
    config.perSurfaceOverrides.rightSidebar?.mode !== 'custom' &&
    shellFrameResolved &&
    shellFrameResolved.effectiveMode !== 'inherit'
  ) {
    return {
      id,
      cssName,
      mode: zoneCfg.mode,
      effectiveMode: 'inherit',
      opacity: shellFrameResolved.opacity,
      blurPx: shellFrameResolved.blurPx,
      saturation: shellFrameResolved.saturation,
      tint: shellFrameResolved.tint,
      bgCss: shellFrameResolved.bgCss,
      backdropCss: shellFrameResolved.backdropCss,
      borderCss: shellFrameResolved.borderCss,
      sheenCss: shellFrameResolved.sheenCss,
    };
  }

  let tint = activeTint;
  if (zoneCfg.mode === 'custom' && zoneCfg.tint) {
    tint = clampSurfaceColorForContrast(zoneCfg.tint, isDark, config.glassFidelity);
  } else if (zoneCfg.mode === 'inherit') {
    if (id === 'shellFrame') {
      if (config.perSurfaceOverrides.leftSidebar?.mode === 'custom') {
        tint = surfaces.leftSidebar.tint;
      } else if (config.perSurfaceOverrides.titlebar?.mode === 'custom') {
        tint = surfaces.titlebar.tint;
      }
    } else if (id === 'rightSidebar' && config.perSurfaceOverrides.rightSidebar?.mode === 'custom') {
      tint = surfaces.rightSidebar.tint;
    } else if (id === 'mainCanvas' && config.perSurfaceOverrides.conversation?.mode === 'custom') {
      tint = surfaces.conversation.tint;
    }
  }

  const rgb = hexToRgb(tint);
  const solidBg = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  const solidBorder = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.14)';

  if (!glassActive || effectiveMode === 'solid') {
    return {
      id,
      cssName,
      mode: zoneCfg.mode,
      effectiveMode: 'solid',
      opacity: 100,
      blurPx: 0,
      saturation: 100,
      tint,
      bgCss: solidBg,
      backdropCss: 'none',
      borderCss: solidBorder,
      sheenCss: 'none',
    };
  }

  // Compute inherited baseline opacity & blur for this zone.
  const baseRegion = config.glassRegions[meta.defaultRegion];
  let inheritedRawOp = baseRegion.op;
  let inheritedBlur = baseRegion.blur;

  if (id === 'shellFrame') {
    if (config.perSurfaceOverrides.leftSidebar?.mode === 'custom') {
      inheritedRawOp = surfaces.leftSidebar.op;
      inheritedBlur = surfaces.leftSidebar.blur;
    } else if (config.perSurfaceOverrides.titlebar?.mode === 'custom') {
      inheritedRawOp = surfaces.titlebar.op;
      inheritedBlur = surfaces.titlebar.blur;
    }
  } else if (id === 'rightSidebar' && config.perSurfaceOverrides.rightSidebar?.mode === 'custom') {
    inheritedRawOp = surfaces.rightSidebar.op;
    inheritedBlur = surfaces.rightSidebar.blur;
  } else if (id === 'overlays' && config.perSurfaceOverrides.settingsWindow?.mode === 'custom') {
    inheritedRawOp = surfaces.settingsWindow.op;
    inheritedBlur = surfaces.settingsWindow.blur;
  } else if (id === 'mainCanvas') {
    if (config.perSurfaceOverrides.conversation?.mode === 'custom') {
      inheritedRawOp = surfaces.conversation.op;
      inheritedBlur = surfaces.conversation.blur;
    } else {
      // Arc / AGY 2.0 crystal-clear framed stage window: default mainCanvas reveals Z-0 wallpaper
      // sharply with 0px blur while the surrounding monolithic frame carries the frosted liquid glass.
      // Users still retain full freedom to dial custom blur/opacity or solid in 8-zone controls.
      inheritedBlur = 0;
    }
  } else if (id === 'workPanels') {
    // Dedicated frosted-glass readability baseline for Tasks, Workspace Board & Scheduled Tasks.
    inheritedBlur = inheritedBlur > 0 ? Math.max(12, inheritedBlur) : 0;
  } else if (id === 'userBubble') {
    // Airy crystal-frosted blur for chat user message pills (14px balanced, 18px clear).
    inheritedBlur =
      inheritedBlur > 0 ? clampNumber(Math.max(14, inheritedBlur + 2), 0, GLASS_ZONE_LIMITS.blurMax) : 0;
  } else if (id === 'overviewPanel') {
    // Crisp frosted blur for floating Session Overview card (16px balanced, 20px clear)
    // so wallpaper color glows softly behind sharp >= 4.5:1 foreground typography.
    inheritedBlur =
      inheritedBlur > 0 ? clampNumber(Math.max(16, inheritedBlur + 4), 0, GLASS_ZONE_LIMITS.blurMax) : 0;
  }

  let inheritedAlpha: number;
  if (id === 'rightSidebar' && effectiveMode === 'inherit' && config.rightSidebarFullClear) {
    inheritedAlpha = 0;
  } else if (id === 'mainCanvas') {
    if (config.perSurfaceOverrides.conversation?.mode === 'custom') {
      const floor = 0.14 * fidelityScalar;
      inheritedAlpha = floor + ((inheritedRawOp * 0.55) / 100) * (1 - floor);
    } else {
      // Whisper-light strictly achromatic clear veil: clear ~4%, balanced ~6%, light ~8% (0px blur, zero tint shift).
      inheritedAlpha = clampNumber(0.02 + (inheritedRawOp / 100) * 0.1, 0.02, 0.12);
    }
  } else if (id === 'workPanels') {
    // High-legibility frosted glass default: dark balanced ~67%, light balanced ~72% (never washed-out or bare over vivid wallpapers).
    const floor = (isDark ? 0.56 : 0.64) * fidelityScalar;
    const minFloor = (isDark ? 0.52 : 0.6) * fidelityScalar;
    inheritedAlpha = clampNumber(floor + (inheritedRawOp / 100) * (1 - floor) * 0.7, minFloor, 0.94);
  } else if (id === 'userBubble') {
    // Airy translucent frosted user bubble default:
    // Dark Glass: clear ~19%, balanced ~24%, light ~34% (eliminating murky ~59% solid mix).
    // Light Glass: clear ~32%, balanced ~37%, light ~48% (soft snow-mist glass over crisp slate ink).
    if (isDark) {
      const floor = 0.14 * fidelityScalar;
      inheritedAlpha = clampNumber(floor + (inheritedRawOp / 100) * 0.44, 0.12 * fidelityScalar, 0.62);
    } else {
      const floor = 0.26 * fidelityScalar;
      inheritedAlpha = clampNumber(floor + (inheritedRawOp / 100) * 0.48, 0.22 * fidelityScalar, 0.72);
    }
  } else if (id === 'overviewPanel') {
    // Clean translucent single-pass floating overview card default (decoupled from rightSidebar):
    // Dark Glass: clear ~30%, balanced ~35%, light ~47% (eliminating opaque dark stacking).
    // Light Glass: clear ~42%, balanced ~47%, light ~59% (airy luminous frost with crisp >= 4.5:1 slate ink).
    if (isDark) {
      const floor = 0.24 * fidelityScalar;
      inheritedAlpha = clampNumber(floor + (inheritedRawOp / 100) * 0.5, 0.2 * fidelityScalar, 0.74);
    } else {
      const floor = 0.36 * fidelityScalar;
      inheritedAlpha = clampNumber(floor + (inheritedRawOp / 100) * 0.5, 0.3 * fidelityScalar, 0.8);
    }
  } else if (id === 'composer') {
    const floor = 0.34 * fidelityScalar;
    inheritedAlpha = floor + (inheritedRawOp / 100) * (1 - floor);
  } else if (id === 'overlays') {
    const floor = GLASS_ZONE_LIMITS.overlaysOpacityMin / 100;
    inheritedAlpha = clampNumber(floor + (inheritedRawOp / 100) * 0.24, floor, 0.96);
  } else {
    // Unified outer-frame optics (shellFrame & rightSidebar): identical opacity, blur,
    // saturation & glaze in inherit mode so the closed outer frame forms a single seamless bezel.
    const floor = 0.22 * fidelityScalar;
    inheritedAlpha = floor + (inheritedRawOp / 100) * (1 - floor);
  }

  const inheritedOpacity = Math.round(
    clampNumber(inheritedAlpha * 100, meta.minOpacity, GLASS_ZONE_LIMITS.opacityMax),
  );
  const clampedInheritedBlur = Math.round(
    clampNumber(inheritedBlur, GLASS_ZONE_LIMITS.blurMin, GLASS_ZONE_LIMITS.blurMax),
  );

  const opacity =
    effectiveMode === 'custom' && zoneCfg.opacity !== undefined
      ? Math.round(clampNumber(zoneCfg.opacity, meta.minOpacity, GLASS_ZONE_LIMITS.opacityMax))
      : inheritedOpacity;

  const blurPx =
    effectiveMode === 'custom' && zoneCfg.blurPx !== undefined
      ? Math.round(clampNumber(zoneCfg.blurPx, GLASS_ZONE_LIMITS.blurMin, GLASS_ZONE_LIMITS.blurMax))
      : clampedInheritedBlur;

  const saturation =
    effectiveMode === 'custom' && zoneCfg.saturation !== undefined
      ? Math.round(
          clampNumber(
            zoneCfg.saturation,
            GLASS_ZONE_LIMITS.saturationMin,
            GLASS_ZONE_LIMITS.saturationMax,
          ),
        )
      : meta.defaultSaturation;

  const fullClearLegacy =
    id === 'rightSidebar' && effectiveMode === 'inherit' && config.rightSidebarFullClear;
  const clearMainCanvasDefault =
    id === 'mainCanvas' &&
    effectiveMode === 'inherit' &&
    config.perSurfaceOverrides.conversation?.mode !== 'custom' &&
    blurPx === 0;

  const alpha = clampNumber(opacity / 100, meta.minOpacity / 100, 1);
  const bgRgb = clearMainCanvasDefault
    ? isDark
      ? { r: 0, g: 0, b: 0 }
      : { r: 255, g: 255, b: 255 }
    : rgb;
  const bgCss =
    alpha >= 0.999
      ? solidBg
      : alpha <= 0.001
        ? 'rgba(0, 0, 0, 0)'
        : `rgba(${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b}, ${alpha.toFixed(3)})`;

  const backdropCss =
    blurPx > 0
      ? `blur(${blurPx}px) saturate(${(saturation / 100).toFixed(2)})`
      : 'none';

  const sheenCss =
    fullClearLegacy || clearMainCanvasDefault || (alpha >= 0.999 && blurPx === 0)
      ? 'none'
      : buildZoneSheenCss(isDark, fresnelScalar, id);
  const borderCss = buildZoneBorderCss(isDark, fresnelScalar);

  return {
    id,
    cssName,
    mode: zoneCfg.mode,
    effectiveMode,
    opacity,
    blurPx,
    saturation,
    tint,
    bgCss,
    backdropCss,
    borderCss,
    sheenCss,
  };
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

  const shellFrameZone = resolveZoneGlassValue(
    config,
    'shellFrame',
    isDark,
    glassActive,
    activeGlassTint,
    surfaces,
  );
  const zones: Record<GlassZoneId, ResolvedGlassZone> = {
    shellFrame: shellFrameZone,
    rightSidebar: resolveZoneGlassValue(
      config,
      'rightSidebar',
      isDark,
      glassActive,
      activeGlassTint,
      surfaces,
      shellFrameZone,
    ),
    mainCanvas: resolveZoneGlassValue(
      config,
      'mainCanvas',
      isDark,
      glassActive,
      activeGlassTint,
      surfaces,
    ),
    workPanels: resolveZoneGlassValue(
      config,
      'workPanels',
      isDark,
      glassActive,
      activeGlassTint,
      surfaces,
    ),
    composer: resolveZoneGlassValue(
      config,
      'composer',
      isDark,
      glassActive,
      activeGlassTint,
      surfaces,
    ),
    overlays: resolveZoneGlassValue(
      config,
      'overlays',
      isDark,
      glassActive,
      activeGlassTint,
      surfaces,
    ),
    userBubble: resolveZoneGlassValue(
      config,
      'userBubble',
      isDark,
      glassActive,
      activeGlassTint,
      surfaces,
    ),
    overviewPanel: resolveZoneGlassValue(
      config,
      'overviewPanel',
      isDark,
      glassActive,
      activeGlassTint,
      surfaces,
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
    zones,
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

const LEGACY_SHELL_FRAME_CSS_NAMES = ['left-sidebar', 'chrome-bars'] as const;

const ZONE_ROOT_ATTRS: readonly string[] = [
  ...GLASS_ZONE_IDS.map((id) => `data-pmx-zone-${GLASS_ZONE_CSS_NAMES[id]}-mode`),
  ...LEGACY_SHELL_FRAME_CSS_NAMES.map((name) => `data-pmx-zone-${name}-mode`),
];

const ZONE_CSS_VARS: readonly string[] = [
  ...GLASS_ZONE_IDS.map((id) => GLASS_ZONE_CSS_NAMES[id]),
  ...LEGACY_SHELL_FRAME_CSS_NAMES,
].flatMap((cssName) => {
  const prefix = `--pmx-glass-zone-${cssName}`;
  return [
    `${prefix}-bg`,
    `${prefix}-blur`,
    `${prefix}-saturation`,
    `${prefix}-opacity`,
    `${prefix}-border`,
    `${prefix}-backdrop`,
    `${prefix}-sheen`,
  ];
});

const MANAGED_ROOT_ATTRS: readonly string[] = [
  'data-pmx-theme',
  'data-pmx-mode',
  'data-pmx-glass',
  'data-pmx-glass-base',
  'data-pmx-glass-base-selected',
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
  'data-pmx-wallpaper-visible',
  'data-prismux-theme',
  'data-prismux-mode',
  'data-prismux-glass',
  'data-prismux-gpu',
  ...ZONE_ROOT_ATTRS,
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
  '--pmx-inner-stage-radius',
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
  '--pmx-glass-work-panels-bg',
  '--pmx-glass-work-panels-card-bg',
  '--pmx-glass-work-panels-blur',
  '--pmx-glass-work-panels-border',
  '--pmx-glass-work-panels-backdrop',
  '--pmx-glass-work-panels-sheen',
  ...ZONE_CSS_VARS,
] as const;

/**
 * Applies appearance attributes, clamped glass/zone tokens, typography, and UI overrides to `document`.
 * Sets `data-pmx-glass="0"` when glass is inactive for lossless fallback to native Prismux styles.
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

  const forceSolidZones =
    !runtime.glassActive || opts.gpuAvailable === false || opts.reducedTransparency === true;
  const effectiveGlassBase: GlassThemeBase = forceSolidZones ? 'pure' : cfg.glassThemeBase;

  for (const el of targets) {
    syncAttr(el, 'data-pmx-theme', runtime.polarity);
    syncAttr(el, 'data-pmx-mode', cfg.themeMode);
    syncAttr(el, 'data-pmx-glass', glassFlag);
    syncAttr(el, 'data-pmx-glass-base', effectiveGlassBase);
    syncAttr(el, 'data-pmx-glass-base-selected', cfg.glassThemeBase);
    syncAttr(
      el,
      'data-pmx-sidebar-glass',
      runtime.glassActive && runtime.zones.shellFrame.effectiveMode !== 'solid' ? '1' : '0',
    );
    syncAttr(
      el,
      'data-pmx-right-sidebar-glass',
      runtime.glassActive && runtime.zones.rightSidebar.effectiveMode !== 'solid' ? '1' : '0',
    );
    syncAttr(
      el,
      'data-pmx-right-sidebar-fullclear',
      runtime.glassActive &&
        cfg.rightSidebarFullClear &&
        cfg.glassZones.rightSidebar.mode === 'inherit'
        ? '1'
        : '0',
    );
    syncAttr(
      el,
      'data-pmx-titlebar-glass',
      runtime.glassActive && runtime.zones.shellFrame.effectiveMode !== 'solid' ? '1' : '0',
    );
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
    syncAttr(el, 'data-pmx-wallpaper-visible', wallpaperFlag);

    // Per-zone effective mode attributes (`inherit` | `custom` | `solid`) + legacy shellFrame aliases.
    for (const zoneId of GLASS_ZONE_IDS) {
      const zone = runtime.zones[zoneId];
      syncAttr(
        el,
        `data-pmx-zone-${zone.cssName}-mode`,
        forceSolidZones ? 'solid' : zone.effectiveMode,
      );
    }
    const shellFrameModeAttr = forceSolidZones ? 'solid' : runtime.zones.shellFrame.effectiveMode;
    for (const legacyCssName of LEGACY_SHELL_FRAME_CSS_NAMES) {
      syncAttr(el, `data-pmx-zone-${legacyCssName}-mode`, shellFrameModeAttr);
    }

    // Mirror official Prismux UI/UX mandate §2.6 attributes for plugins.
    syncAttr(el, 'data-prismux-theme', runtime.polarity);
    syncAttr(el, 'data-prismux-mode', cfg.themeMode);
    syncAttr(el, 'data-prismux-glass', glassFlag);
    syncAttr(el, 'data-prismux-gpu', gpuFlag);

    el.classList.toggle('pmx-light', !runtime.isDark);
    el.classList.toggle('pmx-dark', runtime.isDark);
    el.classList.toggle('pmx-glass', runtime.glassActive);
  }

  if (opts.syncDarkClass ?? opts.syncT3DarkClass) {
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
  s.setProperty('--pmx-glass-tint-dark-rgb', toRgbTriple(runtime.clampedDarkTint, '0, 0, 0'));
  s.setProperty('--pmx-glass-tint', runtime.activeGlassTint);
  s.setProperty(
    '--pmx-glass-tint-rgb',
    toRgbTriple(runtime.activeGlassTint, runtime.isDark ? '0, 0, 0' : '255, 255, 255'),
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
  const shellZoneCfg = cfg.glassZones.shellFrame;
  const rightZoneCfg = cfg.glassZones.rightSidebar;
  s.setProperty(
    '--pmx-left-sidebar-fill',
    `${shellZoneCfg.mode === 'custom' ? runtime.zones.shellFrame.opacity : sf.leftSidebar.op}%`,
  );
  s.setProperty(
    '--pmx-left-sidebar-blur',
    `${shellZoneCfg.mode === 'custom' ? runtime.zones.shellFrame.blurPx : sf.leftSidebar.blur}px`,
  );
  s.setProperty(
    '--pmx-titlebar-fill',
    `${shellZoneCfg.mode === 'custom' ? runtime.zones.shellFrame.opacity : sf.titlebar.op}%`,
  );
  s.setProperty(
    '--pmx-titlebar-blur',
    `${shellZoneCfg.mode === 'custom' ? runtime.zones.shellFrame.blurPx : sf.titlebar.blur}px`,
  );
  s.setProperty(
    '--pmx-right-sidebar-fill',
    `${rightZoneCfg.mode === 'custom' ? runtime.zones.rightSidebar.opacity : sf.rightSidebar.op}%`,
  );
  s.setProperty(
    '--pmx-right-sidebar-blur',
    `${rightZoneCfg.mode === 'custom' ? runtime.zones.rightSidebar.blurPx : sf.rightSidebar.blur}px`,
  );
  s.setProperty('--pmx-right-sidebar-tint', runtime.zones.rightSidebar.tint);

  // Unified 8-zone liquid glass CSS custom properties (+ mirrored legacy left-sidebar/chrome-bars aliases).
  const solidFallbackBorder = runtime.isDark
    ? 'rgba(255, 255, 255, 0.12)'
    : 'rgba(15, 23, 42, 0.14)';
  const writeZoneCssProps = (cssName: string, zone: ResolvedGlassZone): void => {
    const prefix = `--pmx-glass-zone-${cssName}`;
    if (forceSolidZones) {
      const rgb = hexToRgb(zone.tint);
      s.setProperty(`${prefix}-bg`, `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
      s.setProperty(`${prefix}-blur`, '0px');
      s.setProperty(`${prefix}-saturation`, '1');
      s.setProperty(`${prefix}-opacity`, '1.000');
      s.setProperty(`${prefix}-border`, solidFallbackBorder);
      s.setProperty(`${prefix}-backdrop`, 'none');
      s.setProperty(`${prefix}-sheen`, 'none');
    } else {
      s.setProperty(`${prefix}-bg`, zone.bgCss);
      s.setProperty(`${prefix}-blur`, `${zone.blurPx}px`);
      s.setProperty(`${prefix}-saturation`, (zone.saturation / 100).toFixed(2));
      s.setProperty(`${prefix}-opacity`, (zone.opacity / 100).toFixed(3));
      s.setProperty(`${prefix}-border`, zone.borderCss);
      s.setProperty(`${prefix}-backdrop`, zone.backdropCss);
      s.setProperty(`${prefix}-sheen`, zone.sheenCss);
    }
  };
  for (const zoneId of GLASS_ZONE_IDS) {
    const zone = runtime.zones[zoneId];
    writeZoneCssProps(zone.cssName, zone);
  }
  for (const legacyCssName of LEGACY_SHELL_FRAME_CSS_NAMES) {
    writeZoneCssProps(legacyCssName, runtime.zones.shellFrame);
  }

  // Dedicated semantic aliases for the `workPanels` zone (Tasks / Workspace Board / Scheduled Tasks).
  const workPanelsZone = runtime.zones.workPanels;
  const workPanelsTintRgb = hexToRgb(workPanelsZone.tint);
  if (forceSolidZones || workPanelsZone.effectiveMode === 'solid') {
    const solidCardBg = runtime.isDark
      ? `rgb(${Math.min(255, workPanelsTintRgb.r + 11)}, ${Math.min(255, workPanelsTintRgb.g + 12)}, ${Math.min(255, workPanelsTintRgb.b + 15)})`
      : 'rgb(255, 255, 255)';
    s.setProperty(
      '--pmx-glass-work-panels-bg',
      `rgb(${workPanelsTintRgb.r}, ${workPanelsTintRgb.g}, ${workPanelsTintRgb.b})`,
    );
    s.setProperty('--pmx-glass-work-panels-card-bg', solidCardBg);
    s.setProperty('--pmx-glass-work-panels-blur', '0px');
    s.setProperty('--pmx-glass-work-panels-border', solidFallbackBorder);
    s.setProperty('--pmx-glass-work-panels-backdrop', 'none');
    s.setProperty('--pmx-glass-work-panels-sheen', 'none');
  } else {
    const panelAlpha = clampNumber(workPanelsZone.opacity / 100, 0, 1);
    const cardAlpha = runtime.isDark
      ? clampNumber(0.26 + panelAlpha * 0.42, 0.26, 0.74)
      : clampNumber(0.46 + panelAlpha * 0.42, 0.46, 0.9);
    const cardRgb = runtime.isDark
      ? {
          r: Math.min(255, workPanelsTintRgb.r + 10),
          g: Math.min(255, workPanelsTintRgb.g + 12),
          b: Math.min(255, workPanelsTintRgb.b + 16),
        }
      : {
          r: Math.min(255, Math.round(workPanelsTintRgb.r * 0.35 + 255 * 0.65)),
          g: Math.min(255, Math.round(workPanelsTintRgb.g * 0.35 + 255 * 0.65)),
          b: Math.min(255, Math.round(workPanelsTintRgb.b * 0.35 + 255 * 0.65)),
        };
    s.setProperty('--pmx-glass-work-panels-bg', workPanelsZone.bgCss);
    s.setProperty(
      '--pmx-glass-work-panels-card-bg',
      `rgba(${cardRgb.r}, ${cardRgb.g}, ${cardRgb.b}, ${cardAlpha.toFixed(3)})`,
    );
    s.setProperty('--pmx-glass-work-panels-blur', `${workPanelsZone.blurPx}px`);
    s.setProperty('--pmx-glass-work-panels-border', workPanelsZone.borderCss);
    s.setProperty('--pmx-glass-work-panels-backdrop', workPanelsZone.backdropCss);
    s.setProperty('--pmx-glass-work-panels-sheen', workPanelsZone.sheenCss);
  }

  // Default inner workspace stage corner radius token (fixed 14px; no corner slider UI).
  s.setProperty('--pmx-inner-stage-radius', `${DEFAULT_INNER_STAGE_RADIUS_PX}px`);

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
