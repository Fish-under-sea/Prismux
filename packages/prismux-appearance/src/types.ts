export type ThemeMode = 'light' | 'dark' | 'glass';

export type BaseThemePolarity = 'light' | 'dark';

export type AccentMode = 'system' | 'custom';

export type GlassPreset = 'off' | 'light' | 'balanced' | 'clear' | 'custom';

export type GlassThemeBase =
  | 'pure'
  | 'starry-violet'
  | 'emerald-stars'
  | 'sakura-drift'
  | 'ocean-caustics'
  | 'gilded-lunar';

export interface GlassThemeBaseDescriptor {
  readonly id: GlassThemeBase;
  readonly label: string;
  readonly note: string;
  readonly swatchCss: string;
}

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
 * Eight unified workbench liquid-glass zones for real-time per-zone customization:
 * shellFrame, rightSidebar, mainCanvas, workPanels, composer, overlays, userBubble, overviewPanel.
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
  /** Pure CSS / inline SVG liquid-glass theme substrate ('pure' by default for zero visual surprise). */
  glassThemeBase: GlassThemeBase;
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

export const GLASS_THEME_BASE_IDS: readonly GlassThemeBase[] = [
  'pure',
  'starry-violet',
  'emerald-stars',
  'sakura-drift',
  'ocean-caustics',
  'gilded-lunar',
] as const;

export const GLASS_THEME_BASE_META: readonly GlassThemeBaseDescriptor[] = [
  {
    id: 'pure',
    label: '纯净官方',
    note: '仅叠加纯净液态玻璃，保留最通透的原版无纹理质感',
    swatchCss:
      'linear-gradient(135deg, rgba(255, 255, 255, 0.42) 0%, rgba(148, 163, 184, 0.22) 48%, rgba(255, 255, 255, 0.32) 100%), linear-gradient(180deg, #273244 0%, #1a2232 100%)',
  },
  {
    id: 'starry-violet',
    label: '星语紫夜',
    note: '斜竖紫夜流光光纹 + 星紫/靛蓝双焦星晕 + 细碎微星点阵，复刻猫猫壁纸经典',
    swatchCss:
      'radial-gradient(circle at 80% 24%, rgba(240, 197, 255, 0.88) 0 1.4px, transparent 2.4px), radial-gradient(circle at 26% 74%, rgba(196, 181, 253, 0.76) 0 1px, transparent 2px), repeating-linear-gradient(135deg, transparent 0 5px, rgba(185, 148, 238, 0.36) 5px 6.5px), radial-gradient(ellipse at 12% 10%, rgba(168, 142, 229, 0.72), transparent 64%), radial-gradient(ellipse at 90% 96%, rgba(236, 120, 184, 0.48), transparent 62%), linear-gradient(135deg, #17102c 0%, #241948 54%, #151c3a 100%)',
  },
  {
    id: 'emerald-stars',
    label: '翠星漫野',
    note: '翡翠森系柔光光晕 + 错落散布的大小与倾角各异实心/轻描边绿色五角星点阵',
    swatchCss:
      'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 36 22\'%3E%3Cpolygon points=\'10,3 11.1,6.1 14.4,6.2 11.8,8.2 12.7,11.3 10,9.5 7.3,11.3 8.2,8.2 5.6,6.2 8.9,6.1\' fill=\'%2334d399\' fill-opacity=\'0.95\'/%3E%3Cpolygon points=\'25,8 25.8,10.3 28.2,10.4 26.3,11.9 27,14.2 25,12.8 23,14.2 23.7,11.9 21.8,10.4 24.2,10.3\' fill=\'none\' stroke=\'%236ee7b7\' stroke-width=\'1.1\' stroke-opacity=\'0.95\'/%3E%3Cpolygon points=\'18,14 18.6,15.6 20.3,15.7 19,16.7 19.4,18.3 18,17.4 16.6,18.3 17,16.7 15.7,15.7 17.4,15.6\' fill=\'%2310b981\' fill-opacity=\'0.9\'/%3E%3C/svg%3E"), radial-gradient(circle at 18% 22%, rgba(52, 211, 153, 0.54), transparent 60%), radial-gradient(circle at 86% 84%, rgba(16, 185, 129, 0.44), transparent 62%), linear-gradient(135deg, #092119 0%, #0f3528 52%, #0a2520 100%)',
  },
  {
    id: 'sakura-drift',
    label: '樱雪浮岚',
    note: '绯樱暖霞柔晕 + 斜飘半透明五瓣樱影与冰晶菱光点，浅色温润治愈、深色宛如夜樱飘雪',
    swatchCss:
      'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 36 22\'%3E%3Cg fill=\'%23f9a8d4\' fill-opacity=\'0.92\' transform=\'translate(11 9) rotate(-18)\'%3E%3Cellipse cx=\'0\' cy=\'-3.2\' rx=\'1.5\' ry=\'2.7\'/%3E%3Cellipse cx=\'3\' cy=\'-1\' rx=\'1.5\' ry=\'2.7\' transform=\'rotate(72 3 -1)\'/%3E%3Cellipse cx=\'1.9\' cy=\'2.5\' rx=\'1.5\' ry=\'2.7\' transform=\'rotate(144 1.9 2.5)\'/%3E%3Cellipse cx=\'-1.9\' cy=\'2.5\' rx=\'1.5\' ry=\'2.7\' transform=\'rotate(216 -1.9 2.5)\'/%3E%3Cellipse cx=\'-3\' cy=\'-1\' rx=\'1.5\' ry=\'2.7\' transform=\'rotate(288 -3 -1)\'/%3E%3C/g%3E%3Cpolygon points=\'26,5 27.1,7.9 30,9 27.1,10.1 26,13 24.9,10.1 22,9 24.9,7.9\' fill=\'%23fce7f3\' fill-opacity=\'0.92\'/%3E%3Ccircle cx=\'20\' cy=\'16.5\' r=\'1.2\' fill=\'%23fbcfe8\' fill-opacity=\'0.82\'/%3E%3C/svg%3E"), radial-gradient(circle at 18% 20%, rgba(244, 114, 182, 0.56), transparent 62%), radial-gradient(circle at 84% 82%, rgba(251, 113, 133, 0.44), transparent 62%), linear-gradient(135deg, #2b1325 0%, #3d1c34 52%, #241830 100%)',
  },
  {
    id: 'ocean-caustics',
    label: '沧海浮光',
    note: '冰川青与深海蓝极光晕 + 细腻水波焦散交错涟漪弧纹与浮光气泡，与液态玻璃折射绝配',
    swatchCss:
      'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 36 22\'%3E%3Cpath d=\'M-2 15 Q9 6 19 13 T38 9\' fill=\'none\' stroke=\'%237dd3fc\' stroke-width=\'1.35\' stroke-opacity=\'0.88\'/%3E%3Cpath d=\'M-2 19 Q11 11 22 17 T38 14\' fill=\'none\' stroke=\'%2322d3ee\' stroke-width=\'1.05\' stroke-opacity=\'0.72\'/%3E%3Ccircle cx=\'12\' cy=\'7\' r=\'1.3\' fill=\'none\' stroke=\'%23bae6fd\' stroke-width=\'0.9\' stroke-opacity=\'0.85\'/%3E%3Ccircle cx=\'28\' cy=\'6\' r=\'0.9\' fill=\'%23e0f2fe\' fill-opacity=\'0.82\'/%3E%3C/svg%3E"), radial-gradient(circle at 18% 20%, rgba(56, 189, 248, 0.54), transparent 62%), radial-gradient(circle at 86% 84%, rgba(6, 182, 212, 0.48), transparent 64%), linear-gradient(135deg, #071e32 0%, #0b334f 52%, #082338 100%)',
  },
  {
    id: 'gilded-lunar',
    label: '鎏金织月',
    note: '琥珀暖金与玄夜紫月晕 + 纤细鎏金同心星轨弧、新月微影与金砂星尘，夜间护眼高雅质感',
    swatchCss:
      'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 36 22\'%3E%3Cpath d=\'M-2 21 A24 24 0 0 1 28 2\' fill=\'none\' stroke=\'%23fbbf24\' stroke-width=\'1\' stroke-opacity=\'0.8\'/%3E%3Cpath d=\'M4 22 A18 18 0 0 1 33 7\' fill=\'none\' stroke=\'%23f59e0b\' stroke-width=\'0.8\' stroke-opacity=\'0.6\'/%3E%3Cpath d=\'M25.5 5.2 A4.3 4.3 0 1 0 28.8 12.1 A3.3 3.3 0 1 1 25.5 5.2 Z\' fill=\'%23fde68a\' fill-opacity=\'0.95\'/%3E%3Ccircle cx=\'11\' cy=\'8\' r=\'1\' fill=\'%23fde68a\' fill-opacity=\'0.88\'/%3E%3Ccircle cx=\'17\' cy=\'15\' r=\'0.8\' fill=\'%23fcd34d\' fill-opacity=\'0.78\'/%3E%3C/svg%3E"), radial-gradient(circle at 82% 22%, rgba(251, 191, 36, 0.48), transparent 58%), radial-gradient(circle at 18% 82%, rgba(139, 92, 246, 0.42), transparent 62%), linear-gradient(135deg, #1b1328 0%, #2b1e30 52%, #191421 100%)',
  },
] as const;

export const DEFAULT_APPEARANCE_CONFIG: AppearanceConfig = {
  themeMode: 'glass',
  glassBasePolarity: 'dark',
  accentMode: 'system',
  accent: '#0078d4',
  glassPreset: 'clear',
  glassThemeBase: 'pure',
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
