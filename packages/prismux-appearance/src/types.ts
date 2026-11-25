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

/**
 * Eight unified workbench liquid-glass zones exposed for real-time per-zone customization:
 * - `shellFrame`: Monolithic closed picture-frame shell (Left Sidebar + Top Bar + Bottom Status Bar + Right Edge)
 * - `rightSidebar`: Expandable right feature sidebar (defaults to following `shellFrame`, independently tunable)
 * - `mainCanvas`: Central rounded inner workspace canvas (defaults crystal-clear with 0px blur & zero tint shift)
 * - `workPanels`: Unified frosted-glass zone for Tasks, Workspace Board & Scheduled Tasks main panels
 * - `composer`: Message composer & cards
 * - `overlays`: Modals, popovers, dropdowns & settings panels
 * - `userBubble`: Chat timeline user message capsule bubbles with directional Fresnel specular rim
 * - `overviewPanel`: Floating session overview card decoupled from `rightSidebar`
 */
export type GlassZoneId =
  | 'shellFrame'
  | 'rightSidebar'
  | 'mainCanvas'
  | 'workPanels'
  | 'composer'
  | 'overlays'
  | 'userBubble'
  | 'overviewPanel';

/** Legacy pre-shellFrame zone ids automatically migrated into `shellFrame` for 100% backward compatibility. */
export type LegacyGlassZoneId = 'leftSidebar' | 'chromeBars';

/** Zone identifier input accepted by mutators/normalizers (canonical 8-zone or legacy aliases). */
export type GlassZoneIdInput = GlassZoneId | LegacyGlassZoneId;

export type GlassZoneMode = 'inherit' | 'custom' | 'solid';

export interface GlassZoneConfig {
  /** 'inherit' follows global glass settings (or shellFrame for rightSidebar), 'custom' uses independent sliders, 'solid' disables glass for opaque fill. */
  mode: GlassZoneMode;
  /** Surface fill opacity percentage (0-100; overlays enforces >= 68% readability floor). */
  opacity?: number;
  /** Backdrop blur radius in px (0-48). */
  blurPx?: number;
  /** Optional backdrop color saturation percentage (80-240). Omit to inherit zone default. */
  saturation?: number;
  /** Optional independent tint hex (#rrggbb) or '' to inherit global glass tint. */
  tint?: string;
}

export type GlassZonesConfig = Record<GlassZoneId, GlassZoneConfig>;

export interface GlassZoneDescriptor {
  readonly id: GlassZoneId;
  readonly cssName: string;
  readonly title: string;
  readonly compactTitle?: string;
  readonly shortLabel: string;
  readonly note: string;
  readonly compactNote?: string;
  readonly defaultRegion: GlassRegionId;
  readonly defaultSaturation: number;
  readonly minOpacity: number;
  readonly pinnedInCompact?: boolean;
}

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
  /** Eight unified workbench glass zones (shellFrame, rightSidebar, mainCanvas, workPanels, composer, overlays, userBubble, overviewPanel). */
  glassZones: GlassZonesConfig;
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
    : K extends 'glassZones'
      ? { [Z in GlassZoneIdInput]?: Partial<GlassZoneConfig> }
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

export const GLASS_ZONE_LIMITS = {
  opacityMin: 0,
  opacityMax: 100,
  /** Built-in readability floor for overlays (modals, menus, drawers) guaranteeing >= 4.5:1 text contrast. */
  overlaysOpacityMin: 68,
  blurMin: 0,
  blurMax: 48,
  saturationMin: 80,
  saturationMax: 240,
  /** Natural native frosted-glass saturation baseline (105%-115%) avoiding warm/vivid color distortion. */
  defaultSaturation: 110,
} as const;

export const GLASS_ZONE_IDS: readonly GlassZoneId[] = [
  'shellFrame',
  'rightSidebar',
  'mainCanvas',
  'workPanels',
  'composer',
  'overlays',
  'userBubble',
  'overviewPanel',
] as const;

export const GLASS_ZONE_CSS_NAMES: Readonly<Record<GlassZoneId, string>> = {
  shellFrame: 'shell-frame',
  rightSidebar: 'right-sidebar',
  mainCanvas: 'main-canvas',
  workPanels: 'work-panels',
  composer: 'composer',
  overlays: 'overlays',
  userBubble: 'user-bubble',
  overviewPanel: 'overview-panel',
};

export const GLASS_ZONE_META: readonly GlassZoneDescriptor[] = [
  {
    id: 'shellFrame',
    cssName: 'shell-frame',
    title: '窗口外框（左侧边栏、顶栏与底栏）',
    compactTitle: '窗口外框',
    shortLabel: '窗口外框',
    note: '左侧边栏、顶部标签栏、底部状态栏与右侧细边连体统一调节，零拼接色差',
    compactNote: '左侧边栏、顶栏、底栏与右细边统一连体',
    defaultRegion: 'surface',
    defaultSaturation: 110,
    minOpacity: GLASS_ZONE_LIMITS.opacityMin,
    pinnedInCompact: true,
  },
  {
    id: 'rightSidebar',
    cssName: 'right-sidebar',
    title: '右侧功能边栏',
    compactTitle: '右侧功能边栏',
    shortLabel: '右侧栏',
    note: '展开壁纸、差异、文件、终端、浏览器与手机模拟面板时独立微调（默认跟随外框）',
    compactNote: '展开功能面板独立微调，默认跟随外框',
    defaultRegion: 'surface',
    defaultSaturation: 110,
    minOpacity: GLASS_ZONE_LIMITS.opacityMin,
    pinnedInCompact: true,
  },
  {
    id: 'mainCanvas',
    cssName: 'main-canvas',
    title: '主内容画布',
    shortLabel: '主画布',
    note: '中央圆角画窗，默认清透 1:1 还原原生壁纸色彩',
    defaultRegion: 'surface',
    defaultSaturation: 105,
    minOpacity: GLASS_ZONE_LIMITS.opacityMin,
  },
  {
    id: 'workPanels',
    cssName: 'work-panels',
    title: '工作面板',
    compactTitle: '工作面板',
    shortLabel: '工作面板',
    note: '任务面板、工作区板与定时任务统一调节',
    compactNote: '任务面板、工作区板与定时任务统一调节',
    defaultRegion: 'surface',
    defaultSaturation: 108,
    minOpacity: GLASS_ZONE_LIMITS.opacityMin,
  },
  {
    id: 'composer',
    cssName: 'composer',
    title: '输入框与卡片',
    shortLabel: '输入框',
    note: '消息输入框、工具卡与控制条',
    defaultRegion: 'card',
    defaultSaturation: 108,
    minOpacity: GLASS_ZONE_LIMITS.opacityMin,
  },
  {
    id: 'overlays',
    cssName: 'overlays',
    title: '弹窗与设置面板',
    shortLabel: '弹窗层',
    note: '弹窗、下拉菜单与设置面板（内置高可读下限）',
    defaultRegion: 'overlay',
    defaultSaturation: 108,
    minOpacity: GLASS_ZONE_LIMITS.overlaysOpacityMin,
  },
  {
    id: 'userBubble',
    cssName: 'user-bubble',
    title: '用户消息气泡',
    compactTitle: '用户消息气泡',
    shortLabel: '消息气泡',
    note: '对话流用户消息胶囊与左上微光液态玻璃折射边（默认清透磨砂）',
    compactNote: '对话用户胶囊与微光折射边缘',
    defaultRegion: 'card',
    defaultSaturation: 110,
    minOpacity: GLASS_ZONE_LIMITS.opacityMin,
  },
  {
    id: 'overviewPanel',
    cssName: 'overview-panel',
    title: '概览面板',
    compactTitle: '概览面板',
    shortLabel: '概览面板',
    note: '悬浮会话概览卡（与右侧功能边栏解耦，默认轻透单层磨砂）',
    compactNote: '悬浮会话概览卡独立调节',
    defaultRegion: 'card',
    defaultSaturation: 110,
    minOpacity: GLASS_ZONE_LIMITS.opacityMin,
  },
] as const;

export const DEFAULT_GLASS_ZONES: GlassZonesConfig = {
  shellFrame: { mode: 'inherit' },
  rightSidebar: { mode: 'inherit' },
  mainCanvas: { mode: 'inherit' },
  workPanels: { mode: 'inherit' },
  composer: { mode: 'inherit' },
  overlays: { mode: 'inherit' },
  userBubble: { mode: 'inherit' },
  overviewPanel: { mode: 'inherit' },
};

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
    mutedColor: '#5c6470',
  },
  dark: {
    headingColor: '#ffffff',
    textColor: '#f5f5f7',
    mutedColor: '#98a1b2',
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
  themeMode: 'glass',
  glassBasePolarity: 'dark',
  accentMode: 'system',
  accent: '#0078d4',
  glassPreset: 'clear',
  glassRegions: {
    surface: { ...GLASS_PRESETS.clear.surface },
    card: { ...GLASS_PRESETS.clear.card },
    overlay: { ...GLASS_PRESETS.clear.overlay },
    control: { ...GLASS_PRESETS.clear.control },
  },
  glassColor: '#ffffff',
  glassDarkSeparate: true,
  glassDarkColor: '#000000',
  glassFidelity: 100,
  fresnelStrength: 100,
  wallpaperDim: 58,
  thinkingMode: 'off',
  leftSidebarGlass: true,
  titlebarGlass: true,
  rightSidebarGlass: true,
  rightSidebarFullClear: false,
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
