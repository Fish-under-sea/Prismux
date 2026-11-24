import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export type AppearanceThemeMode = "light" | "dark" | "glass";
export type BaseThemePolarity = "light" | "dark";
export type AccentMode = "system" | "custom";
export type GlassPreset = "off" | "light" | "balanced" | "clear" | "custom";
export type ThinkingGlassMode = "off" | "glass" | "native";
export type SidebarCornerRadius = "native" | 6 | 12 | 20;

export interface GlassRegionConfig {
  op: number;
  blur: number;
}

export interface GlassRegionsConfig {
  surface: GlassRegionConfig;
  card: GlassRegionConfig;
  overlay: GlassRegionConfig;
  control: GlassRegionConfig;
}

export interface GlassSurfaceOverride {
  mode: "inherit" | "custom";
  op?: number;
  blur?: number;
  color?: string;
  fidelity?: number;
}

export type PersistedGlassZoneMode = "inherit" | "custom" | "solid";

export interface PersistedGlassZoneConfig {
  mode: PersistedGlassZoneMode;
  opacity?: number;
  blurPx?: number;
  saturation?: number;
  tint?: string;
}

export type PersistedGlassZonesConfig = {
  shellFrame: PersistedGlassZoneConfig;
  rightSidebar: PersistedGlassZoneConfig;
  mainCanvas: PersistedGlassZoneConfig;
  workPanels: PersistedGlassZoneConfig;
  composer: PersistedGlassZoneConfig;
  overlays: PersistedGlassZoneConfig;
};

export interface SidebarSquareCorners {
  tl: boolean;
  tr: boolean;
  br: boolean;
  bl: boolean;
}

export interface UiCustomColors {
  enabled: boolean;
  send: string;
  link: string;
  fileIcon: string;
  tab: string;
  deepDiving: string;
}

export interface ThemeTypographyPalette {
  headingColor: string;
  textColor: string;
  mutedColor: string;
}

export interface AppearanceTypography {
  light: ThemeTypographyPalette;
  dark: ThemeTypographyPalette;
  fontFamily: string;
  codeFontFamily: string;
  fontWeight?: number;
}

export interface WallpaperRotationGroup {
  id: string;
  name: string;
  wallpaperIds: string[];
  intervalMinutes: number;
  order: "sequence" | "random";
  trigger: "timer" | "videoEnd";
}

export interface PersistedWallpaperState {
  selectedId: string | null;
  playing: boolean;
  videoAudioEnabled: boolean;
  videoVolume: number;
  playbackRate: number;
  fpsCap: 0 | 30 | 60;
  objectFit: "cover" | "contain" | "center" | "fill";
  flipX: boolean;
  flipY: boolean;
  wallpaperBlur: number;
  wallpaperOpacity: number;
  scrim: number;
  sceneLive: boolean;
  sceneLiveFps: 15 | 30 | 60;
  pauseOnHidden: boolean;
  pauseOnBlur: boolean;
  pauseOnBattery: boolean;
  hiddenIds: string[];
  rotationEnabled: boolean;
  rotationGroupId: string;
  rotationGroups: WallpaperRotationGroup[];
  customDirs: string[];
  steamRootOverride: string;
  userPropOverrides: Record<string, Record<string, string | number | boolean>>;
}

export interface PersistedAppearanceConfig {
  schemaVersion: 1;
  updatedAt: number;
  themeMode: AppearanceThemeMode;
  glassBasePolarity: BaseThemePolarity;
  accentMode: AccentMode;
  accent: string;
  glassPreset: GlassPreset;
  glassRegions: GlassRegionsConfig;
  glassColor: string;
  glassDarkSeparate: boolean;
  glassDarkColor: string;
  glassFidelity: number;
  fresnelStrength: number;
  wallpaperDim: number;
  thinkingMode: ThinkingGlassMode;
  leftSidebarGlass: boolean;
  titlebarGlass: boolean;
  rightSidebarGlass: boolean;
  rightSidebarFullClear: boolean;
  perSurfaceOverrides: Record<string, GlassSurfaceOverride>;
  glassZones: PersistedGlassZonesConfig;
  sidebarCornerRadius: SidebarCornerRadius;
  sidebarSquareCorners: SidebarSquareCorners;
  rightSidebarCornerRadius?: SidebarCornerRadius;
  rightSidebarSquareCorners?: SidebarSquareCorners;
  uiColorCustom: UiCustomColors;
  caretColor: string;
  typography: AppearanceTypography;
  wallpaper: PersistedWallpaperState;
}

export interface AppearanceLoadResult {
  config: PersistedAppearanceConfig;
  recoveredFromCorruption: boolean;
}

export interface AppearanceConfigStoreOptions {
  dataDir: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed.length > 0 && !seen.has(trimmed)) {
        seen.add(trimmed);
        out.push(trimmed);
      }
    }
  }
  return out;
}

function normalizeThemeMode(value: unknown, fallback: AppearanceThemeMode): AppearanceThemeMode {
  return value === "light" || value === "dark" || value === "glass" ? value : fallback;
}

function normalizeBasePolarity(value: unknown, fallback: BaseThemePolarity): BaseThemePolarity {
  return value === "light" || value === "dark" ? value : fallback;
}

function normalizeAccentMode(value: unknown, fallback: AccentMode): AccentMode {
  return value === "system" || value === "custom" ? value : fallback;
}

function normalizeGlassPreset(value: unknown, fallback: GlassPreset): GlassPreset {
  return value === "off" ||
    value === "light" ||
    value === "balanced" ||
    value === "clear" ||
    value === "custom"
    ? value
    : fallback;
}

function normalizeThinkingMode(value: unknown, fallback: ThinkingGlassMode): ThinkingGlassMode {
  return value === "off" || value === "glass" || value === "native" ? value : fallback;
}

function normalizeCornerRadius(
  value: unknown,
  fallback: SidebarCornerRadius
): SidebarCornerRadius {
  return value === "native" || value === 6 || value === 12 || value === 20
    ? value
    : fallback;
}

function normalizeFpsCap(value: unknown, fallback: 0 | 30 | 60): 0 | 30 | 60 {
  return value === 0 || value === 30 || value === 60 ? value : fallback;
}

function normalizeSceneLiveFps(value: unknown, fallback: 15 | 30 | 60): 15 | 30 | 60 {
  return value === 15 || value === 30 || value === 60 ? value : fallback;
}

function normalizeObjectFit(
  value: unknown,
  fallback: "cover" | "contain" | "center" | "fill"
): "cover" | "contain" | "center" | "fill" {
  return value === "cover" || value === "contain" || value === "center" || value === "fill"
    ? value
    : fallback;
}

function normalizeWallpaperOpacity(value: unknown, fallback: number): number {
  const safeFallback =
    typeof fallback === "number" && Number.isFinite(fallback)
      ? fallback > 90
        ? 0
        : Math.max(0, Math.min(90, fallback))
      : 0;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return safeFallback;
  }
  if (value > 90) {
    return 0;
  }
  return Math.max(0, Math.min(90, value));
}

function normalizeWallpaperScrim(value: unknown, fallback: number): number {
  const safeFallback =
    typeof fallback === "number" && Number.isFinite(fallback)
      ? Math.max(0, Math.min(0.9, fallback > 1 ? fallback / 100 : fallback))
      : 0.15;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return safeFallback;
  }
  const fraction = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(0.9, fraction));
}

export function createDefaultAppearanceConfig(): PersistedAppearanceConfig {
  return {
    schemaVersion: 1,
    updatedAt: Date.now(),
    themeMode: "dark",
    glassBasePolarity: "dark",
    accentMode: "system",
    accent: "#0078d4",
    glassPreset: "balanced",
    glassRegions: {
      surface: { op: 38, blur: 18 },
      card: { op: 22, blur: 12 },
      overlay: { op: 45, blur: 16 },
      control: { op: 28, blur: 8 }
    },
    glassColor: "#ffffff",
    glassDarkSeparate: false,
    glassDarkColor: "#0d1524",
    glassFidelity: 100,
    fresnelStrength: 100,
    wallpaperDim: 58,
    thinkingMode: "off",
    leftSidebarGlass: true,
    titlebarGlass: true,
    rightSidebarGlass: true,
    rightSidebarFullClear: false,
    perSurfaceOverrides: {},
    glassZones: {
      shellFrame: { mode: "inherit" },
      rightSidebar: { mode: "inherit" },
      mainCanvas: { mode: "inherit" },
      workPanels: { mode: "inherit" },
      composer: { mode: "inherit" },
      overlays: { mode: "inherit" }
    },
    sidebarCornerRadius: "native",
    sidebarSquareCorners: {
      tl: false,
      tr: false,
      br: false,
      bl: false
    },
    uiColorCustom: {
      enabled: false,
      send: "",
      link: "",
      fileIcon: "",
      tab: "",
      deepDiving: ""
    },
    caretColor: "",
    typography: {
      light: {
        headingColor: "",
        textColor: "",
        mutedColor: ""
      },
      dark: {
        headingColor: "",
        textColor: "",
        mutedColor: ""
      },
      fontFamily: "",
      codeFontFamily: ""
    },
    wallpaper: {
      selectedId: "builtin-aurora-prism",
      playing: true,
      videoAudioEnabled: false,
      videoVolume: 0.35,
      playbackRate: 1,
      fpsCap: 60,
      objectFit: "cover",
      flipX: false,
      flipY: false,
      wallpaperBlur: 0,
      wallpaperOpacity: 0,
      scrim: 0.15,
      sceneLive: true,
      sceneLiveFps: 30,
      pauseOnHidden: true,
      pauseOnBlur: false,
      pauseOnBattery: true,
      hiddenIds: [],
      rotationEnabled: false,
      rotationGroupId: "default",
      rotationGroups: [
        {
          id: "default",
          name: "Default Rotation",
          wallpaperIds: [],
          intervalMinutes: 15,
          order: "sequence",
          trigger: "timer"
        }
      ],
      customDirs: [],
      steamRootOverride: "",
      userPropOverrides: {}
    }
  };
}

function normalizeRotationGroups(
  raw: unknown,
  fallback: WallpaperRotationGroup[]
): WallpaperRotationGroup[] {
  if (!Array.isArray(raw)) {
    return fallback.map((g) => ({ ...g, wallpaperIds: [...g.wallpaperIds] }));
  }
  const out: WallpaperRotationGroup[] = [];
  for (const item of raw) {
    if (!isPlainRecord(item)) {
      continue;
    }
    const id = readString(item["id"], "").trim();
    if (id.length === 0) {
      continue;
    }
    out.push({
      id,
      name: readString(item["name"], id),
      wallpaperIds: readStringArray(item["wallpaperIds"], []),
      intervalMinutes: clampNumber(item["intervalMinutes"], 1, 1440, 15),
      order: item["order"] === "random" ? "random" : "sequence",
      trigger: item["trigger"] === "videoEnd" ? "videoEnd" : "timer"
    });
  }
  return out.length > 0
    ? out
    : fallback.map((g) => ({ ...g, wallpaperIds: [...g.wallpaperIds] }));
}

function normalizeGlassRegion(
  raw: unknown,
  fallback: GlassRegionConfig
): GlassRegionConfig {
  if (!isPlainRecord(raw)) {
    return { ...fallback };
  }
  return {
    op: clampNumber(raw["op"], 0, 100, fallback.op),
    blur: clampNumber(raw["blur"], 0, 40, fallback.blur)
  };
}

function normalizePerSurfaceOverrides(
  raw: unknown,
  fallback: Record<string, GlassSurfaceOverride>
): Record<string, GlassSurfaceOverride> {
  if (!isPlainRecord(raw)) {
    return { ...fallback };
  }
  const out: Record<string, GlassSurfaceOverride> = {};
  for (const [surfaceId, val] of Object.entries(raw)) {
    if (!isPlainRecord(val)) {
      continue;
    }
    out[surfaceId] = {
      mode: val["mode"] === "custom" ? "custom" : "inherit",
      ...(typeof val["op"] === "number"
        ? { op: clampNumber(val["op"], 0, 100, 38) }
        : {}),
      ...(typeof val["blur"] === "number"
        ? { blur: clampNumber(val["blur"], 0, 60, 16) }
        : {}),
      ...(typeof val["color"] === "string" ? { color: val["color"] } : {}),
      ...(typeof val["fidelity"] === "number"
        ? { fidelity: clampNumber(val["fidelity"], 0, 100, 100) }
        : {})
    };
  }
  return out;
}

function normalizeGlassZoneEntry(
  raw: unknown,
  fallback: PersistedGlassZoneConfig,
  minOpacity = 0
): PersistedGlassZoneConfig {
  if (!isPlainRecord(raw)) {
    return { ...fallback };
  }
  const mode: PersistedGlassZoneMode =
    raw["mode"] === "custom" || raw["mode"] === "solid" || raw["mode"] === "inherit"
      ? raw["mode"]
      : fallback.mode;
  const opacityRaw = raw["opacity"] !== undefined ? raw["opacity"] : fallback.opacity;
  const blurRaw = raw["blurPx"] !== undefined ? raw["blurPx"] : fallback.blurPx;
  const satRaw = raw["saturation"] !== undefined ? raw["saturation"] : fallback.saturation;
  const tintRaw = raw["tint"] !== undefined ? raw["tint"] : fallback.tint;
  return {
    mode,
    ...(typeof opacityRaw === "number" && Number.isFinite(opacityRaw)
      ? { opacity: Math.round(clampNumber(opacityRaw, minOpacity, 100, fallback.opacity ?? 50)) }
      : {}),
    ...(typeof blurRaw === "number" && Number.isFinite(blurRaw)
      ? { blurPx: Math.round(clampNumber(blurRaw, 0, 48, fallback.blurPx ?? 16)) }
      : {}),
    ...(typeof satRaw === "number" && Number.isFinite(satRaw)
      ? { saturation: Math.round(clampNumber(satRaw, 80, 240, fallback.saturation ?? 110)) }
      : {}),
    ...(typeof tintRaw === "string" && tintRaw.trim().length > 0 ? { tint: tintRaw.trim() } : {})
  };
}

function normalizeGlassZones(
  raw: unknown,
  fallback: PersistedGlassZonesConfig
): PersistedGlassZonesConfig {
  if (!isPlainRecord(raw)) {
    return {
      shellFrame: { ...fallback.shellFrame },
      rightSidebar: { ...fallback.rightSidebar },
      mainCanvas: { ...fallback.mainCanvas },
      workPanels: { ...fallback.workPanels },
      composer: { ...fallback.composer },
      overlays: { ...fallback.overlays }
    };
  }
  const legacyShell = isPlainRecord(raw["leftSidebar"])
    ? raw["leftSidebar"]
    : isPlainRecord(raw["chromeBars"])
      ? raw["chromeBars"]
      : undefined;
  return {
    shellFrame: normalizeGlassZoneEntry(raw["shellFrame"] ?? legacyShell, fallback.shellFrame, 0),
    rightSidebar: normalizeGlassZoneEntry(raw["rightSidebar"], fallback.rightSidebar, 0),
    mainCanvas: normalizeGlassZoneEntry(raw["mainCanvas"], fallback.mainCanvas, 0),
    workPanels: normalizeGlassZoneEntry(raw["workPanels"], fallback.workPanels, 0),
    composer: normalizeGlassZoneEntry(raw["composer"], fallback.composer, 0),
    overlays: normalizeGlassZoneEntry(raw["overlays"], fallback.overlays, 68)
  };
}

function normalizeUserPropOverrides(
  raw: unknown,
  fallback: Record<string, Record<string, string | number | boolean>>
): Record<string, Record<string, string | number | boolean>> {
  if (!isPlainRecord(raw)) {
    return { ...fallback };
  }
  const out: Record<string, Record<string, string | number | boolean>> = {};
  for (const [wallpaperId, props] of Object.entries(raw)) {
    if (!isPlainRecord(props)) {
      continue;
    }
    const cleanProps: Record<string, string | number | boolean> = {};
    for (const [propKey, propVal] of Object.entries(props)) {
      if (
        typeof propVal === "string" ||
        typeof propVal === "number" ||
        typeof propVal === "boolean"
      ) {
        cleanProps[propKey] = propVal;
      }
    }
    out[wallpaperId] = cleanProps;
  }
  return out;
}

export function mergeAppearanceConfig(
  base: PersistedAppearanceConfig,
  rawPatch: Record<string, unknown>
): PersistedAppearanceConfig {
  const glassRegionsRaw = isPlainRecord(rawPatch["glassRegions"])
    ? rawPatch["glassRegions"]
    : {};
  const squareRaw = isPlainRecord(rawPatch["sidebarSquareCorners"])
    ? rawPatch["sidebarSquareCorners"]
    : {};
  const uiColorRaw = isPlainRecord(rawPatch["uiColorCustom"])
    ? rawPatch["uiColorCustom"]
    : {};
  const typoRaw = isPlainRecord(rawPatch["typography"])
    ? rawPatch["typography"]
    : {};
  const typoLightRaw = isPlainRecord(typoRaw["light"]) ? typoRaw["light"] : {};
  const typoDarkRaw = isPlainRecord(typoRaw["dark"]) ? typoRaw["dark"] : {};

  // Support both nested `wallpaper: {...}` and flat convenience aliases
  const wallpaperPatch: Record<string, unknown> = isPlainRecord(rawPatch["wallpaper"])
    ? { ...rawPatch["wallpaper"] }
    : {};
  if ("selectedWallpaperId" in rawPatch && !("selectedId" in wallpaperPatch)) {
    wallpaperPatch["selectedId"] = rawPatch["selectedWallpaperId"];
  }
  if ("selectedId" in rawPatch && !("selectedId" in wallpaperPatch)) {
    wallpaperPatch["selectedId"] = rawPatch["selectedId"];
  }
  if ("hiddenIds" in rawPatch && !("hiddenIds" in wallpaperPatch)) {
    wallpaperPatch["hiddenIds"] = rawPatch["hiddenIds"];
  }
  if ("rotationGroups" in rawPatch && !("rotationGroups" in wallpaperPatch)) {
    wallpaperPatch["rotationGroups"] = rawPatch["rotationGroups"];
  }
  if ("rotationEnabled" in rawPatch && !("rotationEnabled" in wallpaperPatch)) {
    wallpaperPatch["rotationEnabled"] = rawPatch["rotationEnabled"];
  }
  if ("rotationGroupId" in rawPatch && !("rotationGroupId" in wallpaperPatch)) {
    wallpaperPatch["rotationGroupId"] = rawPatch["rotationGroupId"];
  }
  if ("customDirs" in rawPatch && !("customDirs" in wallpaperPatch)) {
    wallpaperPatch["customDirs"] = rawPatch["customDirs"];
  }
  if ("steamRootOverride" in rawPatch && !("steamRootOverride" in wallpaperPatch)) {
    wallpaperPatch["steamRootOverride"] = rawPatch["steamRootOverride"];
  }

  const nextSelectedId =
    wallpaperPatch["selectedId"] === null
      ? null
      : typeof wallpaperPatch["selectedId"] === "string"
        ? wallpaperPatch["selectedId"].trim() || null
        : base.wallpaper.selectedId;

  const fontWeightRaw = typoRaw["fontWeight"];
  const nextFontWeight =
    typeof fontWeightRaw === "number" && Number.isFinite(fontWeightRaw)
      ? clampNumber(fontWeightRaw, 100, 900, 400)
      : base.typography.fontWeight;

  const rightCornerRaw = rawPatch["rightSidebarCornerRadius"];
  const nextRightCornerRadius =
    rightCornerRaw !== undefined
      ? normalizeCornerRadius(
          rightCornerRaw,
          base.rightSidebarCornerRadius ?? base.sidebarCornerRadius
        )
      : base.rightSidebarCornerRadius;

  return {
    schemaVersion: 1,
    updatedAt: Date.now(),
    themeMode: normalizeThemeMode(rawPatch["themeMode"], base.themeMode),
    glassBasePolarity: normalizeBasePolarity(
      rawPatch["glassBasePolarity"],
      base.glassBasePolarity
    ),
    accentMode: normalizeAccentMode(rawPatch["accentMode"], base.accentMode),
    accent: readString(rawPatch["accent"], base.accent),
    glassPreset: normalizeGlassPreset(rawPatch["glassPreset"], base.glassPreset),
    glassRegions: {
      surface: normalizeGlassRegion(
        glassRegionsRaw["surface"],
        base.glassRegions.surface
      ),
      card: normalizeGlassRegion(glassRegionsRaw["card"], base.glassRegions.card),
      overlay: normalizeGlassRegion(
        glassRegionsRaw["overlay"],
        base.glassRegions.overlay
      ),
      control: normalizeGlassRegion(
        glassRegionsRaw["control"],
        base.glassRegions.control
      )
    },
    glassColor: readString(rawPatch["glassColor"], base.glassColor),
    glassDarkSeparate: readBoolean(
      rawPatch["glassDarkSeparate"],
      base.glassDarkSeparate
    ),
    glassDarkColor: readString(rawPatch["glassDarkColor"], base.glassDarkColor),
    glassFidelity: clampNumber(
      rawPatch["glassFidelity"],
      0,
      100,
      base.glassFidelity
    ),
    fresnelStrength: clampNumber(
      rawPatch["fresnelStrength"],
      0,
      100,
      base.fresnelStrength
    ),
    wallpaperDim: clampNumber(
      rawPatch["wallpaperDim"],
      0,
      100,
      base.wallpaperDim
    ),
    thinkingMode: normalizeThinkingMode(rawPatch["thinkingMode"], base.thinkingMode),
    leftSidebarGlass: readBoolean(
      rawPatch["leftSidebarGlass"],
      base.leftSidebarGlass
    ),
    titlebarGlass: readBoolean(rawPatch["titlebarGlass"], base.titlebarGlass),
    rightSidebarGlass: readBoolean(
      rawPatch["rightSidebarGlass"],
      base.rightSidebarGlass
    ),
    rightSidebarFullClear: readBoolean(
      rawPatch["rightSidebarFullClear"],
      base.rightSidebarFullClear
    ),
    perSurfaceOverrides:
      "perSurfaceOverrides" in rawPatch
        ? normalizePerSurfaceOverrides(
            rawPatch["perSurfaceOverrides"],
            base.perSurfaceOverrides
          )
        : base.perSurfaceOverrides,
    glassZones:
      "glassZones" in rawPatch
        ? normalizeGlassZones(rawPatch["glassZones"], base.glassZones)
        : base.glassZones,
    sidebarCornerRadius: normalizeCornerRadius(
      rawPatch["sidebarCornerRadius"],
      base.sidebarCornerRadius
    ),
    sidebarSquareCorners: {
      tl: readBoolean(squareRaw["tl"], base.sidebarSquareCorners.tl),
      tr: readBoolean(squareRaw["tr"], base.sidebarSquareCorners.tr),
      br: readBoolean(squareRaw["br"], base.sidebarSquareCorners.br),
      bl: readBoolean(squareRaw["bl"], base.sidebarSquareCorners.bl)
    },
    ...(nextRightCornerRadius !== undefined
      ? { rightSidebarCornerRadius: nextRightCornerRadius }
      : {}),
    ...(isPlainRecord(rawPatch["rightSidebarSquareCorners"])
      ? {
          rightSidebarSquareCorners: {
            tl: readBoolean(
              rawPatch["rightSidebarSquareCorners"]["tl"],
              base.rightSidebarSquareCorners?.tl ?? false
            ),
            tr: readBoolean(
              rawPatch["rightSidebarSquareCorners"]["tr"],
              base.rightSidebarSquareCorners?.tr ?? false
            ),
            br: readBoolean(
              rawPatch["rightSidebarSquareCorners"]["br"],
              base.rightSidebarSquareCorners?.br ?? false
            ),
            bl: readBoolean(
              rawPatch["rightSidebarSquareCorners"]["bl"],
              base.rightSidebarSquareCorners?.bl ?? false
            )
          }
        }
      : base.rightSidebarSquareCorners !== undefined
        ? { rightSidebarSquareCorners: base.rightSidebarSquareCorners }
        : {}),
    uiColorCustom: {
      enabled: readBoolean(uiColorRaw["enabled"], base.uiColorCustom.enabled),
      send: readString(uiColorRaw["send"], base.uiColorCustom.send),
      link: readString(uiColorRaw["link"], base.uiColorCustom.link),
      fileIcon: readString(uiColorRaw["fileIcon"], base.uiColorCustom.fileIcon),
      tab: readString(uiColorRaw["tab"], base.uiColorCustom.tab),
      deepDiving: readString(
        uiColorRaw["deepDiving"],
        base.uiColorCustom.deepDiving
      )
    },
    caretColor: readString(rawPatch["caretColor"], base.caretColor),
    typography: {
      light: {
        headingColor: readString(
          typoLightRaw["headingColor"],
          base.typography.light.headingColor
        ),
        textColor: readString(
          typoLightRaw["textColor"],
          base.typography.light.textColor
        ),
        mutedColor: readString(
          typoLightRaw["mutedColor"],
          base.typography.light.mutedColor
        )
      },
      dark: {
        headingColor: readString(
          typoDarkRaw["headingColor"],
          base.typography.dark.headingColor
        ),
        textColor: readString(
          typoDarkRaw["textColor"],
          base.typography.dark.textColor
        ),
        mutedColor: readString(
          typoDarkRaw["mutedColor"],
          base.typography.dark.mutedColor
        )
      },
      fontFamily: readString(typoRaw["fontFamily"], base.typography.fontFamily),
      codeFontFamily: readString(
        typoRaw["codeFontFamily"],
        base.typography.codeFontFamily
      ),
      ...(nextFontWeight !== undefined ? { fontWeight: nextFontWeight } : {})
    },
    wallpaper: {
      selectedId: nextSelectedId,
      playing: readBoolean(wallpaperPatch["playing"], base.wallpaper.playing),
      videoAudioEnabled: readBoolean(
        wallpaperPatch["videoAudioEnabled"],
        base.wallpaper.videoAudioEnabled
      ),
      videoVolume: clampNumber(
        wallpaperPatch["videoVolume"],
        0,
        1,
        base.wallpaper.videoVolume
      ),
      playbackRate: clampNumber(
        wallpaperPatch["playbackRate"],
        0.25,
        4,
        base.wallpaper.playbackRate
      ),
      fpsCap: normalizeFpsCap(wallpaperPatch["fpsCap"], base.wallpaper.fpsCap),
      objectFit: normalizeObjectFit(
        wallpaperPatch["objectFit"],
        base.wallpaper.objectFit
      ),
      flipX: readBoolean(wallpaperPatch["flipX"], base.wallpaper.flipX),
      flipY: readBoolean(wallpaperPatch["flipY"], base.wallpaper.flipY),
      wallpaperBlur: clampNumber(
        wallpaperPatch["wallpaperBlur"],
        0,
        64,
        base.wallpaper.wallpaperBlur
      ),
      wallpaperOpacity: normalizeWallpaperOpacity(
        wallpaperPatch["wallpaperOpacity"],
        base.wallpaper.wallpaperOpacity
      ),
      scrim: normalizeWallpaperScrim(wallpaperPatch["scrim"], base.wallpaper.scrim),
      sceneLive: readBoolean(
        wallpaperPatch["sceneLive"],
        base.wallpaper.sceneLive
      ),
      sceneLiveFps: normalizeSceneLiveFps(
        wallpaperPatch["sceneLiveFps"],
        base.wallpaper.sceneLiveFps
      ),
      pauseOnHidden: readBoolean(
        wallpaperPatch["pauseOnHidden"],
        base.wallpaper.pauseOnHidden
      ),
      pauseOnBlur: readBoolean(
        wallpaperPatch["pauseOnBlur"],
        base.wallpaper.pauseOnBlur
      ),
      pauseOnBattery: readBoolean(
        wallpaperPatch["pauseOnBattery"],
        base.wallpaper.pauseOnBattery
      ),
      hiddenIds:
        "hiddenIds" in wallpaperPatch
          ? readStringArray(wallpaperPatch["hiddenIds"], base.wallpaper.hiddenIds)
          : base.wallpaper.hiddenIds,
      rotationEnabled: readBoolean(
        wallpaperPatch["rotationEnabled"],
        base.wallpaper.rotationEnabled
      ),
      rotationGroupId: readString(
        wallpaperPatch["rotationGroupId"],
        base.wallpaper.rotationGroupId
      ),
      rotationGroups:
        "rotationGroups" in wallpaperPatch
          ? normalizeRotationGroups(
              wallpaperPatch["rotationGroups"],
              base.wallpaper.rotationGroups
            )
          : base.wallpaper.rotationGroups,
      customDirs:
        "customDirs" in wallpaperPatch
          ? readStringArray(
              wallpaperPatch["customDirs"],
              base.wallpaper.customDirs
            )
          : base.wallpaper.customDirs,
      steamRootOverride: readString(
        wallpaperPatch["steamRootOverride"],
        base.wallpaper.steamRootOverride
      ),
      userPropOverrides:
        "userPropOverrides" in wallpaperPatch
          ? normalizeUserPropOverrides(
              wallpaperPatch["userPropOverrides"],
              base.wallpaper.userPropOverrides
            )
          : base.wallpaper.userPropOverrides
    }
  };
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(
    dir,
    `.tmp-${basename(filePath)}-${process.pid}-${randomUUID()}`
  );
  try {
    writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

/**
 * Atomic, corruption-tolerant persistence manager for `<dataDir>/appearance.json`.
 */
export class AppearanceConfigStore {
  readonly filePath: string;
  private cached: PersistedAppearanceConfig | null = null;
  private recoveredAtLoad = false;

  constructor(options: AppearanceConfigStoreOptions) {
    this.filePath = join(resolve(options.dataDir), "appearance.json");
  }

  get(): AppearanceLoadResult {
    if (this.cached !== null) {
      return {
        config: this.cached,
        recoveredFromCorruption: this.recoveredAtLoad
      };
    }
    if (!existsSync(this.filePath)) {
      const defaults = createDefaultAppearanceConfig();
      this.cached = defaults;
      this.recoveredAtLoad = false;
      return { config: defaults, recoveredFromCorruption: false };
    }

    try {
      const rawText = readFileSync(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(rawText);
      if (!isPlainRecord(parsed)) {
        throw new Error("Appearance config JSON must be an object.");
      }
      const normalized = mergeAppearanceConfig(
        createDefaultAppearanceConfig(),
        parsed
      );
      this.cached = normalized;
      this.recoveredAtLoad = false;
      return { config: normalized, recoveredFromCorruption: false };
    } catch {
      // Preserve corrupt file for diagnostics before recovering cleanly
      try {
        copyFileSync(
          this.filePath,
          `${this.filePath}.corrupt-${Date.now()}`
        );
      } catch {
        // ignore backup error
      }
      const defaults = createDefaultAppearanceConfig();
      writeJsonAtomic(this.filePath, defaults);
      this.cached = defaults;
      this.recoveredAtLoad = true;
      return { config: defaults, recoveredFromCorruption: true };
    }
  }

  update(patch: Record<string, unknown>): PersistedAppearanceConfig {
    const current = this.get().config;
    const next = mergeAppearanceConfig(current, patch);
    writeJsonAtomic(this.filePath, next);
    this.cached = next;
    this.recoveredAtLoad = false;
    return next;
  }
}
