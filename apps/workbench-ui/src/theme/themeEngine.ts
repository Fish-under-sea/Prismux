import {
  APPEARANCE_THEME_MODES,
  DEFAULT_FOUR_REGION_GLASS_SETTINGS,
  DEFAULT_TYPOGRAPHY_COLOR_SETTINGS,
  DEFAULT_WALLPAPER_SETTINGS,
  GLASS_PRESET_KINDS,
  LAYOUT_PRESET_IDS,
  type AppearanceThemeMode,
  type FourRegionGlassSettings,
  type GlassPresetKind,
  type GlassRegionConfig,
  type LayoutPresetId,
  type TypographyColorSettings,
  type WallpaperSettings
} from "@prismux/protocol";
import {
  WORKBENCH_PANE_TITLES,
  clampSplitRatio,
  type SplitNode,
  type WorkbenchPaneId
} from "../layout/splitTree.js";

export interface PrismuxAppearanceState {
  themeMode: AppearanceThemeMode;
  layoutPreset: LayoutPresetId;
  glass: FourRegionGlassSettings & { enabled: boolean };
  wallpaper: WallpaperSettings;
  typography: TypographyColorSettings;
}

export interface WallpaperCatalogItem {
  id: string;
  title: string;
  sourceType: WallpaperSettings["sourceType"];
  sourcePath?: string;
  previewLabel?: string;
  tags?: string[];
}

export interface WbThemeBundle {
  schemaVersion: 1;
  name: string;
  exportedAt: string;
  themeMode: AppearanceThemeMode;
  layoutPreset: LayoutPresetId;
  glass: PrismuxAppearanceState["glass"];
  wallpaper: Omit<WallpaperSettings, "sourcePath">;
  typography: TypographyColorSettings;
  splitTree?: SplitNode;
}

export type TypographyColorSettingsExtended = TypographyColorSettings & {
  lightControlFgColor?: string;
  darkControlFgColor?: string;
};

export interface PrismuxThemeGlobalBridge {
  theme: {
    current: () => PrismuxAppearanceState;
    onChange: (cb: (state: PrismuxAppearanceState) => void) => () => void;
  };
  glass: () => PrismuxAppearanceState["glass"];
  onGlass: (cb: (glass: PrismuxAppearanceState["glass"]) => void) => () => void;
}

export interface FishDockThemeBridge {
  current?: () => Record<string, unknown>;
  getState?: () => Record<string, unknown>;
  onChange?: (cb: (payload: Record<string, unknown>) => void) => (() => void) | void;
  subscribe?: (cb: (payload: Record<string, unknown>) => void) => (() => void) | void;
}

declare global {
  interface Window {
    prismux?: PrismuxThemeGlobalBridge & Record<string, unknown>;
    FishDock?: {
      theme?: FishDockThemeBridge;
      [key: string]: unknown;
    };
  }
}

export const GLASS_PRESETS: Record<
  "off" | "light" | "balanced" | "clear",
  Omit<FourRegionGlassSettings, "preset" | "followFishDockTheme">
> = {
  off: {
    sidebar: { fill: 100, blur: 0 },
    content: { fill: 100, blur: 0 },
    overlay: { fill: 100, blur: 0 },
    control: { fill: 100, blur: 0 },
    fresnelRimOpacity: 0
  },
  light: {
    sidebar: { fill: 86, blur: 12 },
    content: { fill: 92, blur: 10 },
    overlay: { fill: 95, blur: 14 },
    control: { fill: 88, blur: 10 },
    fresnelRimOpacity: 0.3
  },
  balanced: {
    sidebar: { ...DEFAULT_FOUR_REGION_GLASS_SETTINGS.sidebar },
    content: { ...DEFAULT_FOUR_REGION_GLASS_SETTINGS.content },
    overlay: { ...DEFAULT_FOUR_REGION_GLASS_SETTINGS.overlay },
    control: { ...DEFAULT_FOUR_REGION_GLASS_SETTINGS.control },
    fresnelRimOpacity: DEFAULT_FOUR_REGION_GLASS_SETTINGS.fresnelRimOpacity
  },
  clear: {
    sidebar: { fill: 28, blur: 24 },
    content: { fill: 34, blur: 22 },
    overlay: { fill: 68, blur: 26 },
    control: { fill: 32, blur: 18 },
    fresnelRimOpacity: 0.68
  }
};

export const DEFAULT_APPEARANCE_STATE: PrismuxAppearanceState = {
  themeMode: "liquid-glass",
  layoutPreset: "secretary-standby",
  glass: {
    sidebar: { ...DEFAULT_FOUR_REGION_GLASS_SETTINGS.sidebar },
    content: { ...DEFAULT_FOUR_REGION_GLASS_SETTINGS.content },
    overlay: { ...DEFAULT_FOUR_REGION_GLASS_SETTINGS.overlay },
    control: { ...DEFAULT_FOUR_REGION_GLASS_SETTINGS.control },
    preset: DEFAULT_FOUR_REGION_GLASS_SETTINGS.preset,
    fresnelRimOpacity: DEFAULT_FOUR_REGION_GLASS_SETTINGS.fresnelRimOpacity,
    followFishDockTheme: DEFAULT_FOUR_REGION_GLASS_SETTINGS.followFishDockTheme,
    enabled: true
  },
  wallpaper: {
    ...DEFAULT_WALLPAPER_SETTINGS,
    sourceType: "scene",
    sourcePath: "aurora-prism"
  },
  typography: {
    ...DEFAULT_TYPOGRAPHY_COLOR_SETTINGS
  }
};

const SENSITIVE_STRIP_KEYS = new Set<string>([
  "sourcepath",
  "vaultpath",
  "executabledir",
  "localpath",
  "workshopdir",
  "steampath",
  "installpath",
  "workspacepath",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "password",
  "secret",
  "secretaccesskey",
  "passphrase",
  "privatekey",
  "credential",
  "credentials",
  "authheader"
]);

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function clampRegion(
  region: Partial<GlassRegionConfig> | undefined,
  fallback: GlassRegionConfig
): GlassRegionConfig {
  return {
    fill: Math.round(
      clampNumber(typeof region?.fill === "number" ? region.fill : fallback.fill, 0, 100, fallback.fill)
    ),
    blur: Math.round(
      clampNumber(typeof region?.blur === "number" ? region.blur : fallback.blur, 0, 40, fallback.blur)
    )
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeColorString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) {
    return fallback;
  }
  // Reject potential CSS injection sequences
  if (/[;{}<>]/.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

function parseHexToRgb(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const r = Number.parseInt((hex[0] ?? "0") + (hex[0] ?? "0"), 16);
    const g = Number.parseInt((hex[1] ?? "0") + (hex[1] ?? "0"), 16);
    const b = Number.parseInt((hex[2] ?? "0") + (hex[2] ?? "0"), 16);
    return [r, g, b];
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return [r, g, b];
  }
  return null;
}

function relativeLuminance(rgb: [number, number, number]): number {
  const channels = rgb.map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function contrastRatioHex(fgHex: string, bgHex: string): number | null {
  const fg = parseHexToRgb(fgHex);
  const bg = parseHexToRgb(bgHex);
  if (!fg || !bg) {
    return null;
  }
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function isGlassVisuallyActive(state: PrismuxAppearanceState): boolean {
  if (state.themeMode !== "liquid-glass" || !state.glass.enabled) {
    return false;
  }
  const { sidebar, content, overlay, control } = state.glass;
  return (
    sidebar.fill < 100 ||
    sidebar.blur > 0 ||
    content.fill < 100 ||
    content.blur > 0 ||
    overlay.fill < 100 ||
    overlay.blur > 0 ||
    control.fill < 100 ||
    control.blur > 0
  );
}

export function formatThemeStatusBadge(state: PrismuxAppearanceState): string {
  if (state.themeMode === "light") {
    return "浅色 · 晴空";
  }
  if (state.themeMode === "dark") {
    return "深色 · 默认";
  }
  if (!state.glass.enabled || state.glass.preset === "off") {
    return "玻璃 · 关闭";
  }
  const presetLabelMap: Record<GlassPresetKind, string> = {
    off: "关闭",
    light: "轻透",
    balanced: "均衡",
    clear: "全透",
    custom: "自定义"
  };
  return `玻璃 · ${presetLabelMap[state.glass.preset]}`;
}

export function applyAppearanceToDocument(
  state: PrismuxAppearanceState,
  doc?: Document
): void {
  const targetDoc =
    doc ?? (typeof document !== "undefined" ? document : undefined);
  const root = targetDoc?.documentElement;
  if (!root) {
    return;
  }

  const baseTheme = state.themeMode === "light" ? "light" : "dark";
  const domMode = state.themeMode === "liquid-glass" ? "glass" : state.themeMode;
  const glassActive = isGlassVisuallyActive(state);
  const currentGpu = root.getAttribute("data-prismux-gpu");

  root.setAttribute("data-prismux-theme", baseTheme);
  root.setAttribute("data-prismux-mode", domMode);
  root.setAttribute("data-prismux-glass", glassActive ? "1" : "0");
  root.setAttribute("data-prismux-gpu", currentGpu === "0" ? "0" : "1");

  const isLight = baseTheme === "light";
  const bg = isLight ? "#f4f6fa" : "#0c111b";
  const card = isLight ? "#ffffff" : "#131b29";
  const controlBg = isLight ? "#eef2f7" : "#1a2436";
  const line = isLight ? "rgba(15, 23, 42, 0.16)" : "rgba(226, 232, 240, 0.16)";
  // >= 3:1 control border contrast on both light & dark surfaces
  const lineControl = isLight
    ? "rgba(15, 23, 42, 0.48)"
    : "rgba(226, 232, 240, 0.4)";
  const hi = isLight
    ? "rgba(255, 255, 255, 0.78)"
    : "rgba(255, 255, 255, 0.14)";
  const accent = isLight ? "#1d4ed8" : "#3b82f6";
  const accentSoft = isLight ? "#2563eb" : "#6cb6ff";
  const selBg = isLight
    ? "rgba(29, 78, 216, 0.12)"
    : "rgba(59, 130, 246, 0.18)";
  const selLine = isLight ? "#1d4ed8" : "#6cb6ff";

  const extTypo = state.typography as TypographyColorSettingsExtended;
  const fg = isLight
    ? sanitizeColorString(extTypo.lightTextColor, DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.lightTextColor)
    : sanitizeColorString(extTypo.darkTextColor, DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.darkTextColor);
  const fg2 = isLight
    ? sanitizeColorString(extTypo.lightMutedColor, DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.lightMutedColor)
    : sanitizeColorString(extTypo.darkMutedColor, DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.darkMutedColor);

  let ctlFg: string;
  if (isLight) {
    const candidate = extTypo.lightControlFgColor ?? extTypo.controlFgColor;
    const ratio = contrastRatioHex(candidate, controlBg);
    ctlFg =
      ratio !== null && ratio < 4.5
        ? fg
        : sanitizeColorString(candidate, fg);
  } else {
    const candidate = extTypo.darkControlFgColor ?? extTypo.controlFgColor;
    ctlFg = sanitizeColorString(candidate, DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.controlFgColor);
  }

  // Semantic state tokens guaranteed >= 6:1 against card/bg
  const cOk = isLight ? "#0f6b38" : "#4ade80";
  const cWarn = isLight ? "#8a4b00" : "#fbbf24";
  const cBad = isLight ? "#b42318" : "#ff858d";

  const sidebar = glassActive
    ? clampRegion(state.glass.sidebar, GLASS_PRESETS.balanced.sidebar)
    : GLASS_PRESETS.off.sidebar;
  const content = glassActive
    ? clampRegion(state.glass.content, GLASS_PRESETS.balanced.content)
    : GLASS_PRESETS.off.content;
  const overlay = glassActive
    ? clampRegion(state.glass.overlay, GLASS_PRESETS.balanced.overlay)
    : GLASS_PRESETS.off.overlay;
  const control = glassActive
    ? clampRegion(state.glass.control, GLASS_PRESETS.balanced.control)
    : GLASS_PRESETS.off.control;

  const fresnelStrength = glassActive
    ? clampNumber(state.glass.fresnelRimOpacity, 0, 1, 0.45)
    : 0;

  // Converge custom glass tint against --prismux-card (max 24% stain) to avoid oversaturation
  const rawTint = state.glass.glassTint?.trim();
  const glassTint =
    rawTint && !/[;{}<>]/.test(rawTint)
      ? `color-mix(in srgb, ${rawTint} 24%, ${card})`
      : card;

  const glassBorder = glassActive
    ? isLight
      ? `rgba(255, 255, 255, ${(0.45 + fresnelStrength * 0.35).toFixed(3)})`
      : `rgba(186, 220, 255, ${(0.18 + fresnelStrength * 0.28).toFixed(3)})`
    : line;

  const contentAlpha = content.fill / 100;
  const baseVeil = clampNumber(state.wallpaper.veilOpacity, 0, 1, 0.32);
  const effectiveVeil =
    state.wallpaper.sourceType === "none"
      ? 0
      : clampNumber(
          baseVeil + (glassActive ? (1 - contentAlpha) * 0.18 : 0),
          0,
          0.88,
          baseVeil
        );

  const wallVeilColor = isLight
    ? `rgba(244, 246, 250, ${effectiveVeil.toFixed(3)})`
    : `rgba(12, 17, 27, ${effectiveVeil.toFixed(3)})`;

  const fontFamily =
    extTypo.fontFamily?.trim() && !/[;{}<>]/.test(extTypo.fontFamily)
      ? extTypo.fontFamily.trim()
      : '"Inter", "PingFang SC", "Microsoft YaHei UI", system-ui, -apple-system, sans-serif';
  const fontWeight = String(
    Math.round(clampNumber(extTypo.fontWeight ?? 400, 300, 700, 400))
  );

  const style = root.style;
  style.setProperty("--prismux-bg", bg);
  style.setProperty("--prismux-card", card);
  style.setProperty("--prismux-control", controlBg);
  style.setProperty("--prismux-line", line);
  style.setProperty("--line-control", lineControl);
  style.setProperty("--hi", hi);
  style.setProperty("--prismux-accent", accent);
  style.setProperty("--prismux-accent-soft", accentSoft);
  style.setProperty("--sel-bg", selBg);
  style.setProperty("--sel-line", selLine);

  style.setProperty("--prismux-text", fg);
  style.setProperty("--fg", fg);
  style.setProperty("--prismux-muted", fg2);
  style.setProperty("--fg-2", fg2);
  style.setProperty("--ctl-fg", ctlFg);

  style.setProperty("--c-ok", cOk);
  style.setProperty("--c-warn", cWarn);
  style.setProperty("--c-bad", cBad);

  style.setProperty("--prismux-glass-tint", glassTint);
  style.setProperty("--prismux-glass-border", glassBorder);
  style.setProperty("--prismux-fresnel-strength", fresnelStrength.toFixed(3));

  style.setProperty("--prismux-glass-sidebar-fill", `${sidebar.fill}%`);
  style.setProperty("--prismux-glass-sidebar-blur", `${sidebar.blur}px`);
  style.setProperty("--prismux-glass-content-fill", `${content.fill}%`);
  style.setProperty("--prismux-glass-content-blur", `${content.blur}px`);
  style.setProperty("--prismux-glass-overlay-fill", `${overlay.fill}%`);
  style.setProperty("--prismux-glass-overlay-blur", `${overlay.blur}px`);
  style.setProperty("--prismux-glass-control-fill", `${control.fill}%`);
  style.setProperty("--prismux-glass-control-blur", `${control.blur}px`);

  style.setProperty("--wall-veil", wallVeilColor);
  style.setProperty("--prismux-wallpaper-dim", effectiveVeil.toFixed(3));
  style.setProperty(
    "--prismux-wallpaper-vignette",
    clampNumber(state.wallpaper.vignetteStrength, 0, 1, 0.2).toFixed(3)
  );
  style.setProperty(
    "--prismux-wallpaper-blur",
    `${Math.round(clampNumber(state.wallpaper.blurPx, 0, 40, 0))}px`
  );

  style.setProperty("--prismux-font-family", fontFamily);
  style.setProperty("--prismux-font-weight", fontWeight);
}

export function installPrismuxThemeBridge(
  getState: () => PrismuxAppearanceState,
  subscribe: (fn: (s: PrismuxAppearanceState) => void) => () => void
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const activeUnsubs = new Set<() => void>();

  const onChange = (cb: (state: PrismuxAppearanceState) => void): (() => void) => {
    const unsub = subscribe(cb);
    activeUnsubs.add(unsub);
    return () => {
      activeUnsubs.delete(unsub);
      unsub();
    };
  };

  const onGlass = (
    cb: (glass: PrismuxAppearanceState["glass"]) => void
  ): (() => void) => {
    const unsub = subscribe((next) => cb(next.glass));
    activeUnsubs.add(unsub);
    return () => {
      activeUnsubs.delete(unsub);
      unsub();
    };
  };

  const prevPrismux = isRecord(window.prismux) ? window.prismux : {};
  window.prismux = {
    ...prevPrismux,
    theme: {
      current: () => getState(),
      onChange
    },
    glass: () => getState().glass,
    onGlass
  };

  return () => {
    for (const unsub of activeUnsubs) {
      unsub();
    }
    activeUnsubs.clear();
  };
}

function mapFishDockPayloadToPartial(
  payload: unknown
): Partial<PrismuxAppearanceState> | null {
  if (!isRecord(payload)) {
    return null;
  }

  const partial: Partial<PrismuxAppearanceState> = {};

  const rawMode = payload.themeMode ?? payload.mode;
  if (rawMode === "light" || rawMode === "dark") {
    partial.themeMode = rawMode;
  } else if (rawMode === "glass" || rawMode === "liquid-glass") {
    partial.themeMode = "liquid-glass";
  }

  const rawGlass = isRecord(payload.glass)
    ? payload.glass
    : isRecord(payload.regions)
      ? payload.regions
      : null;

  if (rawGlass) {
    const sidebar = isRecord(rawGlass.sidebar)
      ? clampRegion(rawGlass.sidebar as Partial<GlassRegionConfig>, DEFAULT_FOUR_REGION_GLASS_SETTINGS.sidebar)
      : { ...DEFAULT_FOUR_REGION_GLASS_SETTINGS.sidebar };
    const content = isRecord(rawGlass.content)
      ? clampRegion(rawGlass.content as Partial<GlassRegionConfig>, DEFAULT_FOUR_REGION_GLASS_SETTINGS.content)
      : { ...DEFAULT_FOUR_REGION_GLASS_SETTINGS.content };
    const overlay = isRecord(rawGlass.overlay)
      ? clampRegion(rawGlass.overlay as Partial<GlassRegionConfig>, DEFAULT_FOUR_REGION_GLASS_SETTINGS.overlay)
      : { ...DEFAULT_FOUR_REGION_GLASS_SETTINGS.overlay };
    const control = isRecord(rawGlass.control)
      ? clampRegion(rawGlass.control as Partial<GlassRegionConfig>, DEFAULT_FOUR_REGION_GLASS_SETTINGS.control)
      : { ...DEFAULT_FOUR_REGION_GLASS_SETTINGS.control };

    const rawPreset = rawGlass.preset;
    const preset: GlassPresetKind =
      typeof rawPreset === "string" &&
      (GLASS_PRESET_KINDS as readonly string[]).includes(rawPreset)
        ? (rawPreset as GlassPresetKind)
        : "custom";

    const glassTint =
      typeof rawGlass.glassTint === "string"
        ? rawGlass.glassTint
        : typeof payload.glassTint === "string"
          ? payload.glassTint
          : undefined;

    partial.glass = {
      sidebar,
      content,
      overlay,
      control,
      preset,
      ...(glassTint ? { glassTint } : {}),
      fresnelRimOpacity: clampNumber(
        typeof rawGlass.fresnelRimOpacity === "number"
          ? rawGlass.fresnelRimOpacity
          : DEFAULT_FOUR_REGION_GLASS_SETTINGS.fresnelRimOpacity,
        0,
        1,
        DEFAULT_FOUR_REGION_GLASS_SETTINGS.fresnelRimOpacity
      ),
      followFishDockTheme: true,
      enabled: typeof rawGlass.enabled === "boolean" ? rawGlass.enabled : true
    };
  }

  const rawTypo = isRecord(payload.typography) ? payload.typography : payload;
  const lightTextColor =
    typeof rawTypo.lightTextColor === "string"
      ? rawTypo.lightTextColor
      : typeof rawTypo.lightFontColor === "string"
        ? rawTypo.lightFontColor
        : undefined;
  const darkTextColor =
    typeof rawTypo.darkTextColor === "string"
      ? rawTypo.darkTextColor
      : typeof rawTypo.darkFontColor === "string"
        ? rawTypo.darkFontColor
        : undefined;
  const lightMutedColor =
    typeof rawTypo.lightMutedColor === "string"
      ? rawTypo.lightMutedColor
      : undefined;
  const darkMutedColor =
    typeof rawTypo.darkMutedColor === "string"
      ? rawTypo.darkMutedColor
      : undefined;
  const controlFgColor =
    typeof rawTypo.controlFgColor === "string"
      ? rawTypo.controlFgColor
      : undefined;
  const fontFamily =
    typeof rawTypo.fontFamily === "string" ? rawTypo.fontFamily : undefined;
  const fontWeight =
    typeof rawTypo.fontWeight === "number" ? rawTypo.fontWeight : undefined;

  if (
    lightTextColor ||
    darkTextColor ||
    lightMutedColor ||
    darkMutedColor ||
    controlFgColor ||
    fontFamily ||
    fontWeight !== undefined
  ) {
    partial.typography = {
      lightTextColor:
        lightTextColor ?? DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.lightTextColor,
      darkTextColor:
        darkTextColor ?? DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.darkTextColor,
      lightMutedColor:
        lightMutedColor ?? DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.lightMutedColor,
      darkMutedColor:
        darkMutedColor ?? DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.darkMutedColor,
      controlFgColor:
        controlFgColor ?? DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.controlFgColor,
      ...(fontFamily ? { fontFamily } : {}),
      ...(fontWeight !== undefined ? { fontWeight } : {})
    };
  }

  return Object.keys(partial).length > 0 ? partial : null;
}

export function subscribeFishDockThemeBridge(
  onUpdate: (partial: Partial<PrismuxAppearanceState>) => void
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const cleanups: Array<() => void> = [];
  const bridge = window.FishDock?.theme;

  const emitPayload = (raw: unknown): void => {
    const mapped = mapFishDockPayloadToPartial(raw);
    if (mapped) {
      onUpdate(mapped);
    }
  };

  if (bridge) {
    const initial = bridge.current?.() ?? bridge.getState?.();
    if (initial) {
      emitPayload(initial);
    }
    if (typeof bridge.onChange === "function") {
      const maybeUnsub = bridge.onChange(emitPayload);
      if (typeof maybeUnsub === "function") {
        cleanups.push(maybeUnsub);
      }
    } else if (typeof bridge.subscribe === "function") {
      const maybeUnsub = bridge.subscribe(emitPayload);
      if (typeof maybeUnsub === "function") {
        cleanups.push(maybeUnsub);
      }
    }
  }

  const onWindowEvent = (event: Event): void => {
    const customEvent = event as CustomEvent<unknown>;
    emitPayload(customEvent.detail);
  };

  window.addEventListener("fishdock:theme-changed", onWindowEvent);
  window.addEventListener("FishDockThemeChanged", onWindowEvent);
  cleanups.push(() => {
    window.removeEventListener("fishdock:theme-changed", onWindowEvent);
    window.removeEventListener("FishDockThemeChanged", onWindowEvent);
  });

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}

function stripSensitiveDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripSensitiveDeep(item));
  }
  if (!isRecord(value)) {
    return value;
  }
  const clean: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_STRIP_KEYS.has(key.toLowerCase())) {
      continue;
    }
    clean[key] = stripSensitiveDeep(entry);
  }
  return clean;
}

function sanitizeSplitNode(node: unknown): SplitNode | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  if (node.kind === "leaf") {
    const paneId = node.paneId;
    if (
      typeof paneId !== "string" ||
      !(paneId in WORKBENCH_PANE_TITLES)
    ) {
      return undefined;
    }
    const typedPaneId = paneId as WorkbenchPaneId;
    return {
      kind: "leaf",
      paneId: typedPaneId,
      ...(typeof node.title === "string" && node.title.trim()
        ? { title: node.title.trim().slice(0, 64) }
        : {})
    };
  }
  if (node.kind === "split") {
    if (
      typeof node.id !== "string" ||
      !node.id.trim() ||
      (node.direction !== "horizontal" && node.direction !== "vertical")
    ) {
      return undefined;
    }
    const first = sanitizeSplitNode(node.first);
    const second = sanitizeSplitNode(node.second);
    if (!first || !second) {
      return undefined;
    }
    return {
      kind: "split",
      id: node.id.trim().slice(0, 64),
      direction: node.direction,
      ratio: clampSplitRatio(typeof node.ratio === "number" ? node.ratio : 0.5),
      first,
      second
    };
  }
  return undefined;
}

function sanitizeGlassSettings(
  raw: unknown
): PrismuxAppearanceState["glass"] {
  const input = isRecord(raw) ? raw : {};
  const presetCandidate = input.preset;
  const preset: GlassPresetKind =
    typeof presetCandidate === "string" &&
    (GLASS_PRESET_KINDS as readonly string[]).includes(presetCandidate)
      ? (presetCandidate as GlassPresetKind)
      : DEFAULT_APPEARANCE_STATE.glass.preset;

  const glassTint =
    typeof input.glassTint === "string" && input.glassTint.trim() && !/[;{}<>]/.test(input.glassTint)
      ? input.glassTint.trim().slice(0, 64)
      : undefined;

  return {
    sidebar: clampRegion(
      isRecord(input.sidebar) ? (input.sidebar as Partial<GlassRegionConfig>) : undefined,
      DEFAULT_APPEARANCE_STATE.glass.sidebar
    ),
    content: clampRegion(
      isRecord(input.content) ? (input.content as Partial<GlassRegionConfig>) : undefined,
      DEFAULT_APPEARANCE_STATE.glass.content
    ),
    overlay: clampRegion(
      isRecord(input.overlay) ? (input.overlay as Partial<GlassRegionConfig>) : undefined,
      DEFAULT_APPEARANCE_STATE.glass.overlay
    ),
    control: clampRegion(
      isRecord(input.control) ? (input.control as Partial<GlassRegionConfig>) : undefined,
      DEFAULT_APPEARANCE_STATE.glass.control
    ),
    preset,
    ...(glassTint ? { glassTint } : {}),
    fresnelRimOpacity: clampNumber(
      typeof input.fresnelRimOpacity === "number"
        ? input.fresnelRimOpacity
        : DEFAULT_APPEARANCE_STATE.glass.fresnelRimOpacity,
      0,
      1,
      DEFAULT_APPEARANCE_STATE.glass.fresnelRimOpacity
    ),
    followFishDockTheme: Boolean(input.followFishDockTheme),
    enabled: typeof input.enabled === "boolean" ? input.enabled : true
  };
}

function sanitizeWallpaperWithoutPaths(
  raw: unknown
): Omit<WallpaperSettings, "sourcePath"> {
  const input = isRecord(raw) ? raw : {};
  const allowedSources = new Set<WallpaperSettings["sourceType"]>([
    "none",
    "scene",
    "web",
    "video",
    "image"
  ]);
  const sourceType: WallpaperSettings["sourceType"] =
    typeof input.sourceType === "string" &&
    allowedSources.has(input.sourceType as WallpaperSettings["sourceType"])
      ? (input.sourceType as WallpaperSettings["sourceType"])
      : DEFAULT_APPEARANCE_STATE.wallpaper.sourceType;

  const steamWorkshopId =
    typeof input.steamWorkshopId === "string" &&
    /^\d{1,16}$/.test(input.steamWorkshopId.trim())
      ? input.steamWorkshopId.trim()
      : undefined;

  return {
    sourceType,
    ...(steamWorkshopId ? { steamWorkshopId } : {}),
    veilOpacity: clampNumber(
      typeof input.veilOpacity === "number"
        ? input.veilOpacity
        : DEFAULT_APPEARANCE_STATE.wallpaper.veilOpacity,
      0,
      1,
      DEFAULT_APPEARANCE_STATE.wallpaper.veilOpacity
    ),
    vignetteStrength: clampNumber(
      typeof input.vignetteStrength === "number"
        ? input.vignetteStrength
        : DEFAULT_APPEARANCE_STATE.wallpaper.vignetteStrength,
      0,
      1,
      DEFAULT_APPEARANCE_STATE.wallpaper.vignetteStrength
    ),
    blurPx: Math.round(
      clampNumber(
        typeof input.blurPx === "number"
          ? input.blurPx
          : DEFAULT_APPEARANCE_STATE.wallpaper.blurPx,
        0,
        40,
        DEFAULT_APPEARANCE_STATE.wallpaper.blurPx
      )
    ),
    fpsLimit: Math.round(
      clampNumber(
        typeof input.fpsLimit === "number"
          ? input.fpsLimit
          : DEFAULT_APPEARANCE_STATE.wallpaper.fpsLimit,
        15,
        240,
        DEFAULT_APPEARANCE_STATE.wallpaper.fpsLimit
      )
    ),
    pauseWhenOccluded:
      typeof input.pauseWhenOccluded === "boolean"
        ? input.pauseWhenOccluded
        : DEFAULT_APPEARANCE_STATE.wallpaper.pauseWhenOccluded,
    audioReactive:
      typeof input.audioReactive === "boolean"
        ? input.audioReactive
        : DEFAULT_APPEARANCE_STATE.wallpaper.audioReactive
  };
}

function sanitizeTypography(raw: unknown): TypographyColorSettings {
  const input = isRecord(raw) ? raw : {};
  const result: TypographyColorSettingsExtended = {
    lightTextColor: sanitizeColorString(
      input.lightTextColor,
      DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.lightTextColor
    ),
    darkTextColor: sanitizeColorString(
      input.darkTextColor,
      DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.darkTextColor
    ),
    lightMutedColor: sanitizeColorString(
      input.lightMutedColor,
      DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.lightMutedColor
    ),
    darkMutedColor: sanitizeColorString(
      input.darkMutedColor,
      DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.darkMutedColor
    ),
    controlFgColor: sanitizeColorString(
      input.controlFgColor,
      DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.controlFgColor
    )
  };

  if (typeof input.lightControlFgColor === "string") {
    result.lightControlFgColor = sanitizeColorString(
      input.lightControlFgColor,
      DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.lightTextColor
    );
  }
  if (typeof input.darkControlFgColor === "string") {
    result.darkControlFgColor = sanitizeColorString(
      input.darkControlFgColor,
      DEFAULT_TYPOGRAPHY_COLOR_SETTINGS.controlFgColor
    );
  }
  if (
    typeof input.fontFamily === "string" &&
    input.fontFamily.trim() &&
    !/[;{}<>]/.test(input.fontFamily)
  ) {
    result.fontFamily = input.fontFamily.trim().slice(0, 128);
  }
  if (typeof input.fontWeight === "number" && Number.isFinite(input.fontWeight)) {
    result.fontWeight = Math.round(clampNumber(input.fontWeight, 300, 700, 400));
  }

  return result;
}

export function sanitizeWbThemeForExport(
  bundle: WbThemeBundle & Record<string, unknown>
): WbThemeBundle {
  const stripped = stripSensitiveDeep(bundle);
  const root = isRecord(stripped) ? stripped : {};

  const themeMode: AppearanceThemeMode =
    typeof root.themeMode === "string" &&
    (APPEARANCE_THEME_MODES as readonly string[]).includes(root.themeMode)
      ? (root.themeMode as AppearanceThemeMode)
      : DEFAULT_APPEARANCE_STATE.themeMode;

  const layoutPreset: LayoutPresetId =
    typeof root.layoutPreset === "string" &&
    (LAYOUT_PRESET_IDS as readonly string[]).includes(root.layoutPreset)
      ? (root.layoutPreset as LayoutPresetId)
      : DEFAULT_APPEARANCE_STATE.layoutPreset;

  const splitTree = sanitizeSplitNode(root.splitTree);

  return {
    schemaVersion: 1,
    name:
      typeof root.name === "string" && root.name.trim()
        ? root.name.trim().slice(0, 80)
        : "Prismux Theme",
    exportedAt:
      typeof root.exportedAt === "string" && root.exportedAt.trim()
        ? root.exportedAt.trim()
        : new Date().toISOString(),
    themeMode,
    layoutPreset,
    glass: sanitizeGlassSettings(root.glass),
    wallpaper: sanitizeWallpaperWithoutPaths(root.wallpaper),
    typography: sanitizeTypography(root.typography),
    ...(splitTree ? { splitTree } : {})
  };
}

export function parseWbThemeImport(rawJson: string): WbThemeBundle {
  if (typeof rawJson !== "string" || !rawJson.trim()) {
    throw new Error("主题文件为空，请提供有效的 .wb-theme JSON 内容。");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "未知解析错误";
    throw new Error(`无法解析 .wb-theme JSON：${detail}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("主题包格式无效：根节点必须为 JSON 对象。");
  }

  if (parsed.schemaVersion !== 1) {
    throw new Error(
      `不支持的 .wb-theme schemaVersion：${String(parsed.schemaVersion)}（仅支持 schemaVersion: 1）。`
    );
  }

  if (
    parsed.themeMode !== undefined &&
    (typeof parsed.themeMode !== "string" ||
      !(APPEARANCE_THEME_MODES as readonly string[]).includes(parsed.themeMode))
  ) {
    throw new Error(`无效的主题模式 themeMode：${String(parsed.themeMode)}`);
  }

  if (
    parsed.layoutPreset !== undefined &&
    (typeof parsed.layoutPreset !== "string" ||
      !(LAYOUT_PRESET_IDS as readonly string[]).includes(parsed.layoutPreset))
  ) {
    throw new Error(`无效的布局预设 layoutPreset：${String(parsed.layoutPreset)}`);
  }

  return sanitizeWbThemeForExport(
    parsed as WbThemeBundle & Record<string, unknown>
  );
}
