import type { ReactNode } from "react";

export type WallpaperType = "scene" | "web" | "video" | "image";
export type WallpaperSource = "steam" | "custom" | "builtin";
export type WallpaperOrientation = "landscape" | "portrait" | "square" | "unknown";
export type ContentRating = "everyone" | "pg13" | "mature" | "unrated";
export type OrientationFilter = "all" | "landscape" | "portrait";
export type ObjectFitMode = "cover" | "contain" | "center" | "fill";
export type SwitchTransition =
  | "cut"
  | "fade"
  | "push"
  | "wipe"
  | "iris"
  | "zoom"
  | "bars"
  | "random";
export type SidebarCornerRadius = "native" | 6 | 12 | 20;
export type ThinkingGlassMode = "off" | "glass" | "native";
export type ThemeMode = "light" | "dark" | "glass";
export type BuiltinScenePresetId =
  | "aurora-prism"
  | "midnight-abyss"
  | "liquid-silk"
  | "cyber-twilight";
export type QuickPanelTabId = "wallpaper" | "appearance" | "playback";
export type QuickPanelViewMode = "cards" | "list";
export type WallpaperSettingsTabId = "library" | "appearance" | "playback" | "rotation" | "system";
export type RenderSurface = "sidebar" | "settings";
export type FpsCapValue = 0 | 30 | 60;
export type SceneLiveFpsValue = 15 | 30 | 60;
export type LiveBootDelayValue = 0 | 3 | 5 | 10;

export type UserPropType =
  | "color"
  | "bool"
  | "slider"
  | "combo"
  | "text"
  | "textinput"
  | "file"
  | "directory"
  | "group"
  | "other";

export type UserPropWireValue = string | number | boolean;

export interface UserPropOption {
  label: string;
  value: UserPropWireValue;
  condition?: string;
}

export interface UserPropDef {
  name: string;
  ptype: UserPropType;
  text: string;
  order: number;
  value: UserPropWireValue | null;
  defaultValue: UserPropWireValue | null;
  overridden: boolean;
  condition?: string;
  hidden?: boolean;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  options?: UserPropOption[];
  fileType?: string;
  files?: string[];
}

export interface WallpaperItem {
  id: string;
  title: string;
  type: WallpaperType;
  source: WallpaperSource;
  previewUrl: string | null;
  mediaUrl: string | null;
  filePath: string | null;
  dirPath?: string | null;
  width: number | null;
  height: number | null;
  orientation: WallpaperOrientation;
  contentRating: ContentRating;
  userProperties?: UserPropDef[];
  tags?: string[];
  schemeColor?: string | null;
  builtinSceneId?: BuiltinScenePresetId;
  slides?: string[];
  slideIntervalMs?: number | null;
  sceneLiveSupported?: boolean;
  webLiveSupported?: boolean;
  fileSize?: number;
  mtimeMs?: number;
}

export interface RotationGroup {
  id: string;
  name: string;
  wallpaperIds: string[];
  intervalMinutes: number;
  order: "sequence" | "random";
  trigger: "timer" | "videoEnd";
}

export type GlassChildId =
  | "settingsWindow"
  | "conversation"
  | "thinkingTrigger"
  | "floaters"
  | "filePreview"
  | "hoverCard"
  | "leftSidebar"
  | "titlebar"
  | "sidebar"
  | "sidebarContent";

export type GlassSurfacePolicyId =
  | "left-sidebar"
  | "right-sidebar"
  | "settings-window"
  | "content"
  | "declared"
  | "extra";

export type GlassModeMap = Partial<Record<GlassChildId, "inherit" | "custom">>;

export interface GlassChildOverride {
  transparency?: number;
  blur?: number;
  fidelity?: number;
  color?: string;
}

export interface GlassChildParamSpec {
  transparency?: number;
  blur?: number;
  fidelity?: number;
  color?: number;
}

export interface GlassChildSpec {
  id: Exclude<GlassChildId, "leftSidebar" | "titlebar" | "sidebar" | "sidebarContent">;
  label: string;
  hint: string;
  master?: "thinkingGlass";
  params: GlassChildParamSpec;
  defaults?: GlassChildOverride;
}

export type ThemeColorRoleId = "primary" | "secondary" | "tertiary" | "muted";

export interface ThemeColorPair {
  light: string;
  dark: string;
}

export interface TypographyRoleOverride {
  size?: number;
  weight?: number;
  family?: string;
}

export interface WallpaperSettingsState {
  // Selection & playback
  selectedId: string | null;
  /** Optional persisted wallpaper type hint used for smooth upgrade migration before catalog hydration. */
  selectedWallpaperType?: WallpaperType | null;
  playing: boolean;
  videoAudioEnabled: boolean;
  videoVolume: number;
  playbackRate: number;
  fpsCap: FpsCapValue;
  objectFit: ObjectFitMode;
  flipX: boolean;
  flipY: boolean;
  layerPositionX: number;
  layerPositionY: number;
  layerScale: number;

  // Visual / effects filters
  wallpaperBlur: number;
  wallpaperOpacity: number;
  scrim: number;
  backgroundBrightness: number;
  backgroundContrast: number;
  backgroundSaturate: number;
  switchTransition: SwitchTransition;

  // Live rendering & power saving
  /** Opt-in gate for heavy Web / Steam Scene live rendering runtimes (default false). */
  advancedEngineEnabled: boolean;
  sceneLive: boolean;
  liveBootDelay: LiveBootDelayValue;
  sceneLiveFps: SceneLiveFpsValue;
  sceneAutoQuality: boolean;
  sceneSoftRenderPause: boolean;
  pauseOnHidden: boolean;
  pauseOnBlur: boolean;
  pauseOnBattery: boolean;
  startPaused: boolean;
  audioReactive: boolean;

  // Library filtering, hidden & rotation
  contentRatingFilter: ContentRating[];
  typeFilter: WallpaperType[];
  orientationFilter: OrientationFilter;
  hiddenIds: string[];
  rotationEnabled: boolean;
  rotationGroupId: string;
  rotationGroups: RotationGroup[];
  pickerLayout: "fixed" | "classic";
  userPropOverrides: Record<string, Record<string, UserPropWireValue>>;

  // Directories
  steamRootOverride: string;
  customWallpaperDir: string;

  // ── Appearance 6-section architecture ──
  // 1. 主题
  themeMode: ThemeMode;
  themeFollow: boolean;
  themeFollowLine: string;

  // 2. 细节
  border: number;

  // 3. 玻璃 UI
  glassColor: ThemeColorPair;
  glassDarkSeparate: boolean;
  glassAlpha: number;
  blur: number;
  settingsMaskStrength: number;
  extraGlassSelectors: string;
  glassFidelity: number;
  thinkingMode: ThinkingGlassMode;
  capsuleBlur: number;
  capsuleColor: string;
  leftSidebarGlass: boolean;
  titlebarGlass: boolean;
  sidebarPresent: boolean;
  sidebarGlass: boolean;
  sidebarFullClear: boolean;
  sidebarFollowGlobal: boolean;
  floaterSolidBase: boolean;
  marketStickyClip: boolean;
  marketStickyFade: number;
  glassMode: GlassModeMap;
  glassChildren: Partial<Record<GlassChildId, GlassChildOverride>>;
  glassSurfacePolicy: Record<GlassSurfacePolicyId, "auto" | "native">;

  // 4. 侧边栏圆角
  leftSidebarCornerRadius: SidebarCornerRadius;
  leftSidebarSquareTL: boolean;
  leftSidebarSquareTR: boolean;
  leftSidebarSquareBR: boolean;
  leftSidebarSquareBL: boolean;
  rightSidebarCornerRadius: SidebarCornerRadius;
  rightSidebarSquareTL: boolean;
  rightSidebarSquareTR: boolean;
  rightSidebarSquareBR: boolean;
  rightSidebarSquareBL: boolean;

  // 5. 全局 UI 配色
  accent: string;
  uiColorCustom: boolean;
  uiColorSend: string;
  uiColorLink: string;
  uiColorFileIcon: string;
  uiColorTab: string;
  uiColorDeepDiving: string;
  caretColor: string;

  // 6. 全局字体
  fontCustom: boolean;
  globalFamily: string;
  terminalFamily: string;
  themeDarkSeparate: boolean;
  themeColors: Record<ThemeColorRoleId, ThemeColorPair>;
  themeTypeOnly: boolean;
  themeTypography: Record<string, TypographyRoleOverride>;
  fontAdvanced: boolean;
  componentFonts: Record<string, TypographyRoleOverride>;
}

/** UI-only view state stored strictly in localStorage (never persisted into business config). */
export interface WallpaperUiViewState {
  qpTab: QuickPanelTabId;
  qpView: QuickPanelViewMode;
  detailOpen: boolean;
  glassUiOpen: boolean;
  cornersOpen: boolean;
  uiColorOpen: boolean;
  fontOpen: boolean;
  glassDetailOpen: boolean;
}

export type WallpaperModuleResetKey =
  | "theme"
  | "details"
  | "detail"
  | "glass"
  | "corners"
  | "uiColor"
  | "font"
  | "playback";

export interface WallpaperInventoryResult {
  wallpapers: WallpaperItem[];
  steamRoots?: string[];
  customDir?: string;
  error?: string | null;
}

export interface SystemFontsResult {
  fonts: string[];
  approximate?: boolean;
  error?: string | null;
}

export interface ThemeHeroRenderContext {
  surface: RenderSurface;
  themeMode: ThemeMode;
  onChangeThemeMode: (mode: ThemeMode) => void;
  settings: WallpaperSettingsState;
}

export interface ColorTriggerRenderContext {
  value: string;
  label: string;
  onChange: (hex: string) => void;
  onClear?: () => void;
}

export interface GlassPresetsRenderContext {
  settings: WallpaperSettingsState;
  onApplyPatch: (patch: Partial<WallpaperSettingsState>) => void;
}

export interface InlineAppearanceRenderContext {
  /** Returns to the wallpaper library / playback view inside the right sidebar without route navigation. */
  onBack: () => void;
  /** Optional secondary shortcut to open the full /settings/appearance page. */
  onOpenFullSettings?: () => void;
  /** True when mounted inside the compact right-sidebar panel (320-420px). */
  compact: boolean;
}

/** Pluggable bridge so @prismux/appearance can mount CelestialThemeCapsule / InlineAppearanceStudio seamlessly without hard coupling. */
export interface AppearanceBridge {
  onAppearanceChange?: (settings: WallpaperSettingsState) => void;
  onThemeModeChange?: (mode: ThemeMode) => void;
  renderThemeHero?: (ctx: ThemeHeroRenderContext) => ReactNode;
  renderThemeCapsule?: (ctx: ThemeHeroRenderContext) => ReactNode;
  renderColorTrigger?: (ctx: ColorTriggerRenderContext) => ReactNode;
  renderGlassPresets?: (ctx: GlassPresetsRenderContext) => ReactNode;
  /** Renders the live in-place Appearance & Liquid Glass studio inside WallpaperQuickPanel. */
  renderInlineAppearance?: (ctx: InlineAppearanceRenderContext) => ReactNode;
}

export interface WallpaperHostAdapter {
  listWallpapers?: (opts?: {
    forceRefresh?: boolean;
    steamRootOverride?: string;
    customDir?: string;
  }) => Promise<WallpaperInventoryResult>;
  importLocalFiles?: (files: FileList | File[]) => Promise<WallpaperItem[]>;
  pickLocalFiles?: () => Promise<WallpaperItem[]>;
  refreshSteamLibrary?: (steamRootOverride?: string) => Promise<WallpaperInventoryResult>;
  selectDirectory?: (kind: "steam" | "custom", currentPath?: string) => Promise<string | null>;
  openSettingsSection?: (section: WallpaperSettingsTabId | "") => void;
  querySystemFonts?: (forceRefresh?: boolean) => Promise<SystemFontsResult>;
  loadUserProperties?: (wallpaper: WallpaperItem) => Promise<UserPropDef[]>;
  saveSettings?: (settings: WallpaperSettingsState) => Promise<void> | void;
  /** Optional immediate daemon persistence hook invoked when toggling advancedEngineEnabled so live assets unlock before mount. */
  onAdvancedEngineToggle?: (enabled: boolean) => Promise<void> | void;
  appearanceBridge?: AppearanceBridge;
}

export interface GatedSelectionAttempt {
  wallpaper: WallpaperItem;
  timestamp: number;
}

export interface WallpaperRuntimeSnapshot {
  settings: WallpaperSettingsState;
  ui: WallpaperUiViewState;
  wallpapers: WallpaperItem[];
  steamRoots: string[];
  customDir: string;
  loaded: boolean;
  loading: boolean;
  inventoryError: string | null;
  videoError: string | null;
  /** Monotonic counter bumped when user re-selects the active wallpaper or resumes after error to force stage media recovery. */
  mediaRecoveryNonce: number;
  /** Last resolved non-blob active wallpaper retained across transient inventory loading/error states. */
  retainedWallpaper?: WallpaperItem | null;
  gatedAttempt: GatedSelectionAttempt | null;
  qpSearch: string;
  settingsSearch: string;
  propsPanelOpen: boolean;
  propsLoading: boolean;
  propsError: string | null;
  propsMap: Record<string, UserPropDef[]>;
  systemFonts: string[];
  systemFontsLoading: boolean;
  systemFontsApproximate: boolean;
  systemFontsError: string | null;
  occluded: boolean;
  audioEnergy: number | number[];
}

export interface VirtualWindowInput {
  count: number;
  itemHeight: number;
  gap: number;
  cols: number;
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
}

export interface VirtualWindowResult {
  start: number;
  end: number;
  cols: number;
  totalRows: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

export interface WallpaperFilterCounts {
  ratings: Record<ContentRating, number>;
  types: Record<WallpaperType, number>;
  orientations: {
    all: number;
    landscape: number;
    portrait: number;
    unknown: number;
  };
}
