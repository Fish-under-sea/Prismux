import type {
  BuiltinScenePresetId,
  ContentRating,
  GlassChildSpec,
  GlassSurfacePolicyId,
  ObjectFitMode,
  SidebarCornerRadius,
  ThemeColorRoleId,
  WallpaperItem,
  WallpaperSettingsState,
  WallpaperType,
  WallpaperUiViewState,
} from "./types.js";

export const RATING_TIER_VALUES: readonly ContentRating[] = [
  "everyone",
  "pg13",
  "mature",
  "unrated",
];

export const TYPE_TIER_VALUES: readonly WallpaperType[] = [
  "scene",
  "web",
  "video",
  "image",
];

export const OBJECT_FIT_VALUES: readonly ObjectFitMode[] = [
  "cover",
  "contain",
  "center",
  "fill",
];

export const SIDEBAR_CORNER_RADIUS_VALUES: readonly SidebarCornerRadius[] = [
  "native",
  6,
  12,
  20,
];

export const PLAYBACK_RATE_VALUES: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];
export const FPS_CAP_VALUES: readonly (0 | 30 | 60)[] = [0, 60, 30];
export const SCENE_LIVE_FPS_VALUES: readonly (15 | 30 | 60)[] = [15, 30, 60];
export const LIVE_BOOT_DELAY_VALUES: readonly (0 | 3 | 5 | 10)[] = [0, 3, 5, 10];

export const CARD_TYPE_LABELS: Record<WallpaperType, string> = {
  scene: "场景",
  web: "网页",
  video: "视频",
  image: "图片",
};

export const RATING_LABELS: Record<ContentRating, string> = {
  everyone: "全年龄",
  pg13: "PG13",
  mature: "成人",
  unrated: "未分级",
};

export const ACCENT_PRESETS: readonly string[] = [
  "#4f8cff",
  "#38bdf8",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#f97316",
  "#10b981",
  "#eab308",
];

export const GLASS_COLOR_PRESETS: readonly string[] = [
  "#ffffff",
  "#e6f0ff",
  "#dbeafe",
  "#f3e8ff",
  "#1e293b",
  "#0d1524",
  "#18181b",
  "#0f172a",
];

export const CARET_COLOR_PRESETS: readonly string[] = [
  "#4f8cff",
  "#38bdf8",
  "#10b981",
  "#f59e0b",
  "#f43f5e",
  "#ffffff",
];

export const FONT_FAMILY_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "inherit", label: "默认" },
  { value: "Microsoft YaHei", label: "微软雅黑" },
  { value: "KaiTi", label: "楷体" },
  { value: "SimSun", label: "宋体" },
  { value: "SimHei", label: "黑体" },
  { value: "STXingkai", label: "行楷" },
  { value: "monospace", label: "等宽字体" },
];

export const THEME_COLOR_ROLES: readonly {
  id: ThemeColorRoleId;
  label: string;
  defaultLight: string;
  defaultDark: string;
}[] = [
  { id: "primary", label: "主文字", defaultLight: "#0f172a", defaultDark: "#f1f5f9" },
  { id: "secondary", label: "次级文字", defaultLight: "#475569", defaultDark: "#cbd5e1" },
  { id: "tertiary", label: "辅助说明", defaultLight: "#64748b", defaultDark: "#94a3b8" },
  { id: "muted", label: "弱化提示", defaultLight: "#94a3b8", defaultDark: "#64748b" },
];

export const TYPOGRAPHY_ROLES: readonly {
  id: string;
  label: string;
  defaultPx: number;
  defaultWeight: number;
}[] = [
  { id: "title", label: "主标题", defaultPx: 18, defaultWeight: 600 },
  { id: "heading", label: "分区标题", defaultPx: 15, defaultWeight: 600 },
  { id: "body", label: "正文", defaultPx: 14, defaultWeight: 400 },
  { id: "caption", label: "说明文字", defaultPx: 12, defaultWeight: 400 },
  { id: "code", label: "行内代码", defaultPx: 13, defaultWeight: 400 },
];

export const COMPONENT_FONT_TARGETS: readonly {
  id: string;
  label: string;
  group: string;
  defaultPx: number;
  defaultWeight: number;
}[] = [
  { id: "sidebar", label: "侧边栏列表", group: "导航", defaultPx: 13, defaultWeight: 400 },
  { id: "chat", label: "对话消息", group: "会话", defaultPx: 14, defaultWeight: 400 },
  { id: "composer", label: "输入框", group: "会话", defaultPx: 14, defaultWeight: 400 },
  { id: "codeblock", label: "代码块", group: "代码", defaultPx: 13, defaultWeight: 400 },
  { id: "terminal", label: "终端面板", group: "终端", defaultPx: 13, defaultWeight: 400 },
];

/**
 * Registry of sub-UI glass surfaces (single source of truth matching dsh-wallpaper-engine).
 * Only parameters genuinely wired to CSS are declared — zero dead knobs.
 */
export const GLASS_CHILDREN_REGISTRY: readonly GlassChildSpec[] = [
  {
    id: "settingsWindow",
    label: "设置窗口玻璃",
    hint: "整个设置窗口（含全部原生分区）",
    params: { transparency: 100, blur: 60 },
    defaults: { transparency: 28, blur: 20 },
  },
  {
    id: "conversation",
    label: "对话框玻璃",
    hint: "输入卡片 / 消息气泡 / 工具弹卡",
    params: { color: 0, fidelity: 100 },
    defaults: { color: "#ffffff", fidelity: 100 },
  },
  {
    id: "thinkingTrigger",
    label: "思考触发条玻璃",
    hint: "对话里「思考过程」那一行的入口条",
    master: "thinkingGlass",
    params: { transparency: 100, blur: 60 },
    defaults: { transparency: 30, blur: 16 },
  },
  {
    id: "floaters",
    label: "浮层玻璃",
    hint: "悬浮通知 / 壁纸快捷抽屉",
    params: { transparency: 100, blur: 60 },
    defaults: { transparency: 24, blur: 22 },
  },
  {
    id: "filePreview",
    label: "文件预览玻璃",
    hint: "编辑文件悬停时的改动预览浮层",
    params: { transparency: 100, blur: 60 },
    defaults: { transparency: 12, blur: 24 },
  },
  {
    id: "hoverCard",
    label: "悬停卡玻璃",
    hint: "鼠标悬停时弹出的信息卡与提示浮层",
    params: { transparency: 100, blur: 60 },
    defaults: { transparency: 18, blur: 18 },
  },
];

export const GLASS_SURFACE_POLICIES: readonly { id: GlassSurfacePolicyId; label: string }[] = [
  { id: "left-sidebar", label: "左侧栏" },
  { id: "right-sidebar", label: "右侧栏" },
  { id: "settings-window", label: "设置窗口" },
  { id: "content", label: "编辑与终端" },
  { id: "declared", label: "声明式表面" },
  { id: "extra", label: "额外选择器" },
];

export interface BuiltinSceneDefinition {
  id: string;
  presetId: BuiltinScenePresetId;
  title: string;
  schemeColor: string;
  previewUrl: string;
  tags: string[];
}

export const BUILTIN_WEBWALLGL_SCENES: readonly BuiltinSceneDefinition[] = [];

export function createBuiltinWallpapers(): WallpaperItem[] {
  return BUILTIN_WEBWALLGL_SCENES.map((scene) => ({
    id: scene.id,
    title: scene.title,
    type: "scene",
    source: "builtin",
    previewUrl: scene.previewUrl,
    mediaUrl: null,
    filePath: null,
    width: 1920,
    height: 1080,
    orientation: "landscape",
    contentRating: "everyone",
    tags: [...scene.tags],
    schemeColor: scene.schemeColor,
    builtinSceneId: scene.presetId,
    sceneLiveSupported: true,
    userProperties: [
      {
        name: "speed",
        ptype: "slider",
        text: "流动速率",
        order: 1,
        value: 1,
        defaultValue: 1,
        overridden: false,
        min: 0.2,
        max: 2.5,
        step: 0.05,
        precision: 2,
      },
      {
        name: "intensity",
        ptype: "slider",
        text: "光带强度",
        order: 2,
        value: 1,
        defaultValue: 1,
        overridden: false,
        min: 0.3,
        max: 1.8,
        step: 0.05,
        precision: 2,
      },
      {
        name: "tint",
        ptype: "color",
        text: "主色调叠加",
        order: 3,
        value: "0.22 0.74 0.97",
        defaultValue: "0.22 0.74 0.97",
        overridden: false,
      },
      {
        name: "parallax",
        ptype: "bool",
        text: "指针视差响应",
        order: 4,
        value: true,
        defaultValue: true,
        overridden: false,
      },
    ],
  }));
}

export function createDefaultSettings(): WallpaperSettingsState {
  return {
    // Selection & playback
    selectedId: null,
    playing: true,
    videoAudioEnabled: false,
    videoVolume: 0,
    playbackRate: 1,
    fpsCap: 0,
    objectFit: "cover",
    flipX: false,
    flipY: false,
    layerPositionX: 50,
    layerPositionY: 50,
    layerScale: 100,

    // Visual filters
    wallpaperBlur: 0,
    wallpaperOpacity: 0,
    scrim: 0.15,
    backgroundBrightness: 100,
    backgroundContrast: 100,
    backgroundSaturate: 100,
    switchTransition: "fade",

    // Live & power
    sceneLive: true,
    liveBootDelay: 3,
    sceneLiveFps: 30,
    sceneAutoQuality: true,
    sceneSoftRenderPause: true,
    pauseOnHidden: true,
    pauseOnBlur: false,
    pauseOnBattery: false,
    startPaused: false,
    audioReactive: true,

    // Filtering, hidden & rotation
    contentRatingFilter: ["everyone", "pg13", "mature", "unrated"],
    typeFilter: ["scene", "web", "video", "image"],
    orientationFilter: "all",
    hiddenIds: [],
    rotationEnabled: false,
    rotationGroupId: "",
    rotationGroups: [],
    pickerLayout: "fixed",
    userPropOverrides: {},

    // Directories
    steamRootOverride: "",
    customWallpaperDir: "",

    // 1. 主题
    themeMode: "glass",
    themeFollow: false,
    themeFollowLine: "",

    // 2. 细节
    border: 0.25,

    // 3. 玻璃 UI
    glassColor: { light: "#ffffff", dark: "#0d1524" },
    glassDarkSeparate: false,
    glassAlpha: 28,
    blur: 18,
    settingsMaskStrength: 100,
    extraGlassSelectors: "",
    glassFidelity: 100,
    thinkingMode: "glass",
    capsuleBlur: 8,
    capsuleColor: "#ffffff",
    leftSidebarGlass: false,
    titlebarGlass: false,
    sidebarPresent: true,
    sidebarGlass: true,
    sidebarFullClear: false,
    sidebarFollowGlobal: true,
    floaterSolidBase: true,
    marketStickyClip: true,
    marketStickyFade: 26,
    glassMode: {},
    glassChildren: {
      sidebar: { blur: 18, transparency: 28, color: "#ffffff" },
      sidebarContent: { transparency: 22, color: "" },
      leftSidebar: { blur: 18, transparency: 28 },
      titlebar: { blur: 18, transparency: 28 },
    },
    glassSurfacePolicy: {
      "left-sidebar": "auto",
      "right-sidebar": "auto",
      "settings-window": "auto",
      content: "auto",
      declared: "auto",
      extra: "auto",
    },

    // 4. 侧边栏圆角
    leftSidebarCornerRadius: "native",
    leftSidebarSquareTL: false,
    leftSidebarSquareTR: false,
    leftSidebarSquareBR: false,
    leftSidebarSquareBL: false,
    rightSidebarCornerRadius: "native",
    rightSidebarSquareTL: false,
    rightSidebarSquareTR: false,
    rightSidebarSquareBR: false,
    rightSidebarSquareBL: false,

    // 5. 全局 UI 配色
    accent: "#4f8cff",
    uiColorCustom: false,
    uiColorSend: "",
    uiColorLink: "",
    uiColorFileIcon: "",
    uiColorTab: "",
    uiColorDeepDiving: "",
    caretColor: "",

    // 6. 全局字体
    fontCustom: false,
    globalFamily: "",
    terminalFamily: "",
    themeDarkSeparate: false,
    themeColors: {
      primary: { light: "", dark: "" },
      secondary: { light: "", dark: "" },
      tertiary: { light: "", dark: "" },
      muted: { light: "", dark: "" },
    },
    themeTypeOnly: true,
    themeTypography: {},
    fontAdvanced: false,
    componentFonts: {},
  };
}

/** Exact UI default collapse states matching dsh-wallpaper-engine quick-panel.js */
export function createDefaultUiViewState(): WallpaperUiViewState {
  return {
    qpTab: "wallpaper",
    qpView: "cards",
    detailOpen: true,
    glassUiOpen: true,
    cornersOpen: false,
    uiColorOpen: false,
    fontOpen: false,
    glassDetailOpen: false,
  };
}

/** QuickPanel virtual scrolling geometric constants (must match wallpaper-panel.css). */
export const QP_ROW_H = 34;
export const QP_ROW_GAP = 2;
export const QP_CARD_H = 92;
export const QP_CARD_GAP = 8;
export const QP_CARD_MIN = 130;
export const QP_VP_OVERSCAN = 6;
export const QP_VP_FIRST = 30;
