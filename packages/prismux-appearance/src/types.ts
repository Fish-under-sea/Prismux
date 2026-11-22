export type ThemeMode = 'light' | 'dark' | 'glass';

export type BaseThemePolarity = 'light' | 'dark';

export type AccentMode = 'system' | 'custom';

export type GlassPreset = 'off' | 'light' | 'balanced' | 'clear' | 'custom';

export type GlassRegionId = 'surface' | 'card' | 'overlay' | 'control';

export type ThinkingGlassMode = 'off' | 'glass' | 'native';

export type SidebarCornerRadius = 'native' | 6 | 12 | 20;

export type GlassSurfaceId =
  | 'leftSidebar'
  | 'titlebar'
  | 'rightSidebar'
  | 'conversation'
  | 'settingsWindow'
  | 'thinkingTrigger'
  | 'floaters'
  | 'hoverCard'
  | 'filePreview'
  | 'sidebarContent';

export interface GlassRegionValues {
  /** Surface fill opacity percentage (0-100; 100 = solid, 0 = full clear with rim). */
  op: number;
  /** Backdrop blur radius in px (0-40). */
  blur: number;
}

export interface GlassRegionsConfig {
  surface: GlassRegionValues;
  card: GlassRegionValues;
  overlay: GlassRegionValues;
  control: GlassRegionValues;
}

export interface GlassSurfaceOverride {
  mode: 'inherit' | 'custom';
  /** Surface fill opacity percentage (0-100). */
  op?: number;
  /** Backdrop blur radius in px (0-60). */
  blur?: number;
  /** Surface tint hex (#rrggbb) or empty string to inherit. */
  color?: string;
  /** Surface readability fidelity (0-100). */
  fidelity?: number;
}

export interface SidebarSquareCorners {
  tl: boolean;
  tr: boolean;
  br: boolean;
  bl: boolean;
}

export interface UiCustomColors {
  enabled: boolean;
  /** Primary send / submit button tint. */
  send: string;
  /** Link foreground color. */
  link: string;
  /** File chip / code icon tint. */
  fileIcon: string;
  /** Active session tab & underline indicator tint. */
  tab: string;
  /** Reasoning / deep-diving status label & accent tint. */
  deepDiving: string;
}

export interface ThemeTypographyPalette {
  /** Heading & emphasized title color (#rrggbb or '' for theme default). */
  headingColor: string;
  /** Body & control foreground color (#rrggbb or '' for theme default). */
  textColor: string;
  /** Secondary & muted caption color (#rrggbb or '' for theme default). */
  mutedColor: string;
}

export interface AppearanceTypography {
  light: ThemeTypographyPalette;
  dark: ThemeTypographyPalette;
  /** Global UI font-family CSS stack or family name ('' = host native). */
  fontFamily: string;
  /** Global monospace / code font-family stack or name ('' = host native). */
  codeFontFamily: string;
  /** Optional base font weight override (300-700). */
  fontWeight?: number;
}

export interface AppearanceConfig {
  themeMode: ThemeMode;
  /** Polarity used underneath liquid glass surfaces (defaults to 'dark'). */
  glassBasePolarity: BaseThemePolarity;
  accentMode: AccentMode;
  accent: string;
  glassPreset: GlassPreset;
  glassRegions: GlassRegionsConfig;
  /** Light (or unified) glass tint hex (#rrggbb). */
  glassColor: string;
  /** Whether dark theme uses an independent glass tint color. */
  glassDarkSeparate: boolean;
  /** Dark theme glass tint hex (#rrggbb) when glassDarkSeparate is true. */
  glassDarkColor: string;
  /** Readability floor & luminance clamping fidelity (0-100, default 100 = >=4.5:1 WCAG floor). */
  glassFidelity: number;
  /** 360-degree Fresnel specular border intensity (0-100, default 100). */
  fresnelStrength: number;
  /** Wallpaper dim scrim percentage (0-100, default 58). */
  wallpaperDim: number;
  /** Thinking block & markdown prose glass mode. */
  thinkingMode: ThinkingGlassMode;
  /** Independent chrome glass gates. */
  leftSidebarGlass: boolean;
  titlebarGlass: boolean;
  rightSidebarGlass: boolean;
  rightSidebarFullClear: boolean;
  /** Optional per-surface independent overrides. */
  perSurfaceOverrides: Partial<Record<GlassSurfaceId, GlassSurfaceOverride>>;
  /** Unified sidebar corner radius ('native' | 6 | 12 | 20). */
  sidebarCornerRadius: SidebarCornerRadius;
  /** 4-corner explicit square (0px) overrides for left/primary sidebar. */
  sidebarSquareCorners: SidebarSquareCorners;
  /** Optional independent corner radius for right sidebar (defaults to sidebarCornerRadius). */
  rightSidebarCornerRadius?: SidebarCornerRadius;
  /** Optional independent 4-corner square overrides for right sidebar. */
  rightSidebarSquareCorners?: SidebarSquareCorners;
  /** 5 custom UI element accent overrides. */
  uiColorCustom: UiCustomColors;
  /** Text input caret color (#rrggbb or '' for native). */
  caretColor: string;
  /** Independent light/dark text palettes and global/code font families. */
  typography: AppearanceTypography;
}

export type DeepPartialAppearanceConfig = {
  [K in keyof AppearanceConfig]?: K extends 'glassRegions'
    ? { [R in GlassRegionId]?: Partial<GlassRegionValues> }
    : K extends 'sidebarSquareCorners' | 'rightSidebarSquareCorners'
      ? Partial<SidebarSquareCorners>
      : K extends 'uiColorCustom'
        ? Partial<UiCustomColors>
        : K extends 'typography'
          ? {
              light?: Partial<ThemeTypographyPalette>;
              dark?: Partial<ThemeTypographyPalette>;
              fontFamily?: string;
              codeFontFamily?: string;
              fontWeight?: number;
            }
          : AppearanceConfig[K];
};

export const WB_THEME_FORMAT = 'prismux.wb-theme' as const;
export const WB_THEME_VERSION = 1 as const;

export interface WbThemeSnapshot {
  format: typeof WB_THEME_FORMAT;
  version: typeof WB_THEME_VERSION;
  name: string;
  author?: string;
  description?: string;
  exportedAt: string;
  appearance: AppearanceConfig;
}

export interface WbThemeImportResult {
  ok: true;
  snapshot: WbThemeSnapshot;
  strippedFields: string[];
}

export interface WbThemeImportError {
  ok: false;
  error: string;
}

export type WbThemeParseOutcome = WbThemeImportResult | WbThemeImportError;

export const GLASS_REGION_LIMITS = {
  opMin: 0,
  opMax: 100,
  blurMin: 0,
  blurMax: 40,
  surfaceBlurMax: 60,
  fidelityMin: 0,
  fidelityMax: 100,
} as const;

/**
 * Exact 4-region liquid glass presets calibrated against FISH-Dock production curves.
 */
export const GLASS_PRESETS: Record<Exclude<GlassPreset, 'custom'>, GlassRegionsConfig> = {
  off: {
    surface: { op: 100, blur: 0 },
    card: { op: 100, blur: 0 },
    overlay: { op: 100, blur: 0 },
    control: { op: 100, blur: 0 },
  },
  light: {
    surface: { op: 62, blur: 10 },
    card: { op: 46, blur: 8 },
    overlay: { op: 68, blur: 12 },
    control: { op: 52, blur: 6 },
  },
  balanced: {
    surface: { op: 38, blur: 18 },
    card: { op: 22, blur: 12 },
    overlay: { op: 45, blur: 16 },
    control: { op: 28, blur: 8 },
  },
  clear: {
    surface: { op: 18, blur: 24 },
    card: { op: 12, blur: 16 },
    overlay: { op: 25, blur: 20 },
    control: { op: 16, blur: 10 },
  },
};

export const DEFAULT_TYPOGRAPHY_FALLBACKS: Record<BaseThemePolarity, ThemeTypographyPalette> = {
  light: {
    headingColor: '#111113',
    textColor: '#1b1b1f',
    mutedColor: '#5d5d5d',
  },
  dark: {
    headingColor: '#ffffff',
    textColor: '#f5f5f7',
    mutedColor: '#a1a1a6',
  },
};

export const DEFAULT_QUICK_SWATCHES: readonly string[] = [
  '#5e9bff',
  '#005fb8',
  '#38bdf8',
  '#8b5cf6',
  '#f472b6',
  '#10b981',
  '#f59e0b',
  '#ffffff',
  '#94a3b8',
  '#0d1524',
] as const;

export const DEFAULT_APPEARANCE_CONFIG: AppearanceConfig = {
  themeMode: 'dark',
  glassBasePolarity: 'dark',
  accentMode: 'system',
  accent: '#0078d4',
  glassPreset: 'balanced',
  glassRegions: {
    surface: { ...GLASS_PRESETS.balanced.surface },
    card: { ...GLASS_PRESETS.balanced.card },
    overlay: { ...GLASS_PRESETS.balanced.overlay },
    control: { ...GLASS_PRESETS.balanced.control },
  },
  glassColor: '#ffffff',
  glassDarkSeparate: false,
  glassDarkColor: '#0d1524',
  glassFidelity: 100,
  fresnelStrength: 100,
  wallpaperDim: 58,
  thinkingMode: 'off',
  leftSidebarGlass: true,
  titlebarGlass: true,
  rightSidebarGlass: true,
  rightSidebarFullClear: false,
  perSurfaceOverrides: {},
  sidebarCornerRadius: 'native',
  sidebarSquareCorners: {
    tl: false,
    tr: false,
    br: false,
    bl: false,
  },
  uiColorCustom: {
    enabled: false,
    send: '',
    link: '',
    fileIcon: '',
    tab: '',
    deepDiving: '',
  },
  caretColor: '',
  typography: {
    light: {
      headingColor: '',
      textColor: '',
      mutedColor: '',
    },
    dark: {
      headingColor: '',
      textColor: '',
      mutedColor: '',
    },
    fontFamily: '',
    codeFontFamily: '',
  },
};
