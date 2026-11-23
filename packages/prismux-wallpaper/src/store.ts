import { useSyncExternalStore } from "react";
import {
  createBuiltinWallpapers,
  createDefaultSettings,
  createDefaultUiViewState,
  GLASS_CHILDREN_REGISTRY,
  QP_VP_OVERSCAN,
  RATING_TIER_VALUES,
  TYPE_TIER_VALUES,
} from "./defaults.js";
import type {
  ContentRating,
  GlassChildId,
  GlassChildOverride,
  OrientationFilter,
  QuickPanelTabId,
  QuickPanelViewMode,
  RotationGroup,
  UserPropDef,
  UserPropWireValue,
  VirtualWindowInput,
  VirtualWindowResult,
  WallpaperFilterCounts,
  WallpaperHostAdapter,
  WallpaperItem,
  WallpaperModuleResetKey,
  WallpaperRuntimeSnapshot,
  WallpaperSettingsState,
  WallpaperSettingsTabId,
  WallpaperType,
  WallpaperUiViewState,
} from "./types.js";
import { applyUserPropOverrides } from "./userProps.js";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const UI_STORAGE_KEYS = {
  qpTab: "prismux-wallpaper:qp-tab",
  qpView: "prismux-wallpaper:qp-view",
  detailOpen: "prismux-wallpaper:qp-detail-open",
  glassUiOpen: "prismux-wallpaper:qp-glass-ui-open",
  cornersOpen: "prismux-wallpaper:qp-corners-open",
  uiColorOpen: "prismux-wallpaper:qp-ui-color-open",
  fontOpen: "prismux-wallpaper:qp-font-open",
  glassDetailOpen: "prismux-wallpaper:qp-glass-detail",
} as const;

function getBrowserStorage(injected?: StorageLike | null): StorageLike | null {
  if (injected !== undefined) return injected;
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // Restricted sandbox / SSR
  }
  return null;
}

function readUiFlag(
  storage: StorageLike | null,
  key: string,
  defaultOpen: boolean,
): boolean {
  if (!storage) return defaultOpen;
  try {
    const val = storage.getItem(key);
    if (val === null) return defaultOpen;
    return val === "1";
  } catch {
    return defaultOpen;
  }
}

function writeUiValue(storage: StorageLike | null, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage quota errors
  }
}

function loadInitialUiViewState(
  storage: StorageLike | null,
  overrides?: Partial<WallpaperUiViewState>,
): WallpaperUiViewState {
  const defaults = createDefaultUiViewState();
  let qpTab: QuickPanelTabId = defaults.qpTab;
  let qpView: QuickPanelViewMode = defaults.qpView;

  if (storage) {
    try {
      const savedTab = storage.getItem(UI_STORAGE_KEYS.qpTab);
      if (savedTab === "wallpaper" || savedTab === "appearance" || savedTab === "playback") {
        qpTab = savedTab;
      }
      const savedView = storage.getItem(UI_STORAGE_KEYS.qpView);
      if (savedView === "cards" || savedView === "list") {
        qpView = savedView;
      }
    } catch {
      // Ignore
    }
  }

  return {
    qpTab: overrides?.qpTab ?? qpTab,
    qpView: overrides?.qpView ?? qpView,
    detailOpen: overrides?.detailOpen ?? readUiFlag(storage, UI_STORAGE_KEYS.detailOpen, defaults.detailOpen),
    glassUiOpen: overrides?.glassUiOpen ?? readUiFlag(storage, UI_STORAGE_KEYS.glassUiOpen, defaults.glassUiOpen),
    cornersOpen: overrides?.cornersOpen ?? readUiFlag(storage, UI_STORAGE_KEYS.cornersOpen, defaults.cornersOpen),
    uiColorOpen: overrides?.uiColorOpen ?? readUiFlag(storage, UI_STORAGE_KEYS.uiColorOpen, defaults.uiColorOpen),
    fontOpen: overrides?.fontOpen ?? readUiFlag(storage, UI_STORAGE_KEYS.fontOpen, defaults.fontOpen),
    glassDetailOpen:
      overrides?.glassDetailOpen ??
      readUiFlag(storage, UI_STORAGE_KEYS.glassDetailOpen, defaults.glassDetailOpen),
  };
}

// ── Pure filtering, virtual window & rotation helpers ───────────────────────

export function matchesOrientationFilter(
  item: Pick<WallpaperItem, "orientation">,
  filter: OrientationFilter,
): boolean {
  if (filter === "all") return true;
  return item.orientation === filter;
}

/**
 * First-stage playable gate: excludes hidden wallpapers and wallpapers blocked by `contentRatingFilter`.
 * Matches `playableInventory()` in `dsh-wallpaper-engine`.
 */
export function filterPlayableWallpapers(
  wallpapers: readonly WallpaperItem[],
  settings: Pick<WallpaperSettingsState, "hiddenIds" | "contentRatingFilter">,
): WallpaperItem[] {
  const hiddenSet = new Set(settings.hiddenIds);
  const ratingAllow = new Set(
    settings.contentRatingFilter.length > 0 ? settings.contentRatingFilter : RATING_TIER_VALUES,
  );
  return wallpapers.filter((w) => !hiddenSet.has(w.id) && ratingAllow.has(w.contentRating));
}

/**
 * Second-stage visible list filter: layers typeFilter, orientationFilter, and search query on top of playable gate.
 */
export function filterVisibleWallpapers(
  wallpapers: readonly WallpaperItem[],
  settings: Pick<
    WallpaperSettingsState,
    "hiddenIds" | "contentRatingFilter" | "typeFilter" | "orientationFilter"
  >,
  searchQuery = "",
): WallpaperItem[] {
  const playable = filterPlayableWallpapers(wallpapers, settings);
  const typeAllow = new Set(
    settings.typeFilter.length > 0 ? settings.typeFilter : TYPE_TIER_VALUES,
  );
  const orientation = settings.orientationFilter || "all";
  const q = searchQuery.trim().toLowerCase();

  return playable.filter((w) => {
    if (!typeAllow.has(w.type)) return false;
    if (!matchesOrientationFilter(w, orientation)) return false;
    if (q) {
      const titleHit = w.title.toLowerCase().includes(q);
      const tagHit = Array.isArray(w.tags) && w.tags.some((t) => t.toLowerCase().includes(q));
      if (!titleHit && !tagHit) return false;
    }
    return true;
  });
}

export function computeFilterCounts(
  wallpapers: readonly WallpaperItem[],
  settings: Pick<WallpaperSettingsState, "hiddenIds" | "contentRatingFilter" | "typeFilter">,
): WallpaperFilterCounts {
  const hiddenSet = new Set(settings.hiddenIds);
  const visiblePool = wallpapers.filter((w) => !hiddenSet.has(w.id));
  const ratings: Record<ContentRating, number> = {
    everyone: 0,
    pg13: 0,
    mature: 0,
    unrated: 0,
  };
  for (const w of visiblePool) {
    ratings[w.contentRating] = (ratings[w.contentRating] ?? 0) + 1;
  }

  const playable = filterPlayableWallpapers(wallpapers, settings);
  const types: Record<WallpaperType, number> = {
    scene: 0,
    web: 0,
    video: 0,
    image: 0,
  };
  for (const w of playable) {
    types[w.type] = (types[w.type] ?? 0) + 1;
  }

  const typeAllow = new Set(
    settings.typeFilter.length > 0 ? settings.typeFilter : TYPE_TIER_VALUES,
  );
  const typeFiltered = playable.filter((w) => typeAllow.has(w.type));
  const orientations = {
    all: typeFiltered.length,
    landscape: 0,
    portrait: 0,
    unknown: 0,
  };
  for (const w of typeFiltered) {
    if (w.orientation === "landscape") orientations.landscape++;
    else if (w.orientation === "portrait") orientations.portrait++;
    else orientations.unknown++;
  }

  return { ratings, types, orientations };
}

/**
 * Pure grid-row virtual scroll window calculation matching `qpVirtWindow` in `dsh-wallpaper-engine/src/quick-panel.js`.
 */
export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindowResult {
  const count = Math.max(0, Math.floor(input.count));
  const cols = Math.max(1, Math.floor(input.cols));
  const itemHeight = Math.max(1, input.itemHeight);
  const gap = Math.max(0, input.gap);
  const overscan = Math.max(0, input.overscan ?? QP_VP_OVERSCAN);
  const pitch = itemHeight + gap;

  if (count === 0) {
    return {
      start: 0,
      end: 0,
      cols,
      totalRows: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    };
  }

  const totalRows = Math.ceil(count / cols);
  const hidden = Math.max(0, input.scrollTop);
  const viewportHeight =
    Number.isFinite(input.viewportHeight) && input.viewportHeight > 0
      ? input.viewportHeight
      : Number.POSITIVE_INFINITY;

  const r0 = Math.max(0, Math.floor(hidden / pitch) - overscan);
  const r1 =
    viewportHeight === Number.POSITIVE_INFINITY
      ? totalRows
      : Math.min(totalRows, Math.ceil((hidden + viewportHeight) / pitch) + overscan);

  const start = Math.min(count, r0 * cols);
  const end = Math.min(count, Math.max(start, r1 * cols));
  const after = Math.max(0, count - end);

  const topSpacerHeight = start > 0 ? Math.max(0, Math.floor(start / cols) * pitch - gap) : 0;
  const bottomSpacerHeight = after > 0 ? Math.max(0, Math.ceil(after / cols) * pitch - gap) : 0;

  return {
    start,
    end,
    cols,
    totalRows,
    topSpacerHeight,
    bottomSpacerHeight,
  };
}

/**
 * Deterministic / random next-wallpaper selection for rotation groups and manual "下一张".
 */
export function pickNextWallpaperId(
  candidates: readonly WallpaperItem[],
  currentId: string | null,
  order: "sequence" | "random",
  rng: () => number = Math.random,
): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!.id;

  if (order === "random") {
    const others = candidates.filter((w) => w.id !== currentId);
    const pool = others.length > 0 ? others : candidates;
    const idx = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)));
    return pool[idx]!.id;
  }

  const currentIdx = candidates.findIndex((w) => w.id === currentId);
  if (currentIdx < 0) return candidates[0]!.id;
  return candidates[(currentIdx + 1) % candidates.length]!.id;
}

export function resolveRotationCandidates(
  wallpapers: readonly WallpaperItem[],
  settings: WallpaperSettingsState,
): WallpaperItem[] {
  const playable = filterPlayableWallpapers(wallpapers, settings);
  if (settings.rotationEnabled && settings.rotationGroupId) {
    const group = settings.rotationGroups.find((g) => g.id === settings.rotationGroupId);
    if (group && group.wallpaperIds.length > 0) {
      const byId = new Map(playable.map((w) => [w.id, w]));
      const members = group.wallpaperIds
        .map((id) => byId.get(id))
        .filter((w): w is WallpaperItem => Boolean(w));
      if (members.length > 0) return members;
    }
  }
  const typeAllow = new Set(
    settings.typeFilter.length > 0 ? settings.typeFilter : TYPE_TIER_VALUES,
  );
  return playable.filter((w) => typeAllow.has(w.type));
}

// ── Module reset maps (exact per-section isolation) ─────────────────────────

function buildModuleResetPatch(moduleKey: WallpaperModuleResetKey): Partial<WallpaperSettingsState> {
  const d = createDefaultSettings();
  switch (moduleKey) {
    case "theme":
      return {
        themeMode: d.themeMode,
        themeFollow: d.themeFollow,
        themeFollowLine: d.themeFollowLine,
      };
    case "details":
    case "detail":
      return {
        border: d.border,
      };
    case "glass":
      return {
        glassColor: { ...d.glassColor },
        glassDarkSeparate: d.glassDarkSeparate,
        glassAlpha: d.glassAlpha,
        blur: d.blur,
        settingsMaskStrength: d.settingsMaskStrength,
        extraGlassSelectors: d.extraGlassSelectors,
        glassFidelity: d.glassFidelity,
        thinkingMode: d.thinkingMode,
        capsuleBlur: d.capsuleBlur,
        capsuleColor: d.capsuleColor,
        leftSidebarGlass: d.leftSidebarGlass,
        titlebarGlass: d.titlebarGlass,
        sidebarGlass: d.sidebarGlass,
        sidebarFullClear: d.sidebarFullClear,
        sidebarFollowGlobal: d.sidebarFollowGlobal,
        floaterSolidBase: d.floaterSolidBase,
        marketStickyClip: d.marketStickyClip,
        marketStickyFade: d.marketStickyFade,
        glassMode: {},
        glassChildren: {
          sidebar: { ...d.glassChildren.sidebar },
          sidebarContent: { ...d.glassChildren.sidebarContent },
          leftSidebar: { ...d.glassChildren.leftSidebar },
          titlebar: { ...d.glassChildren.titlebar },
        },
        glassSurfacePolicy: { ...d.glassSurfacePolicy },
      };
    case "corners":
      return {
        leftSidebarCornerRadius: d.leftSidebarCornerRadius,
        leftSidebarSquareTL: d.leftSidebarSquareTL,
        leftSidebarSquareTR: d.leftSidebarSquareTR,
        leftSidebarSquareBR: d.leftSidebarSquareBR,
        leftSidebarSquareBL: d.leftSidebarSquareBL,
        rightSidebarCornerRadius: d.rightSidebarCornerRadius,
        rightSidebarSquareTL: d.rightSidebarSquareTL,
        rightSidebarSquareTR: d.rightSidebarSquareTR,
        rightSidebarSquareBR: d.rightSidebarSquareBR,
        rightSidebarSquareBL: d.rightSidebarSquareBL,
      };
    case "uiColor":
      return {
        accent: d.accent,
        uiColorCustom: d.uiColorCustom,
        uiColorSend: d.uiColorSend,
        uiColorLink: d.uiColorLink,
        uiColorFileIcon: d.uiColorFileIcon,
        uiColorTab: d.uiColorTab,
        uiColorDeepDiving: d.uiColorDeepDiving,
        caretColor: d.caretColor,
      };
    case "font":
      return {
        fontCustom: d.fontCustom,
        globalFamily: d.globalFamily,
        terminalFamily: d.terminalFamily,
        themeDarkSeparate: d.themeDarkSeparate,
        themeColors: {
          primary: { ...d.themeColors.primary },
          secondary: { ...d.themeColors.secondary },
          tertiary: { ...d.themeColors.tertiary },
          muted: { ...d.themeColors.muted },
        },
        themeTypeOnly: d.themeTypeOnly,
        themeTypography: {},
        fontAdvanced: d.fontAdvanced,
        componentFonts: {},
      };
    case "playback":
      return {
        videoAudioEnabled: d.videoAudioEnabled,
        videoVolume: d.videoVolume,
        playbackRate: d.playbackRate,
        fpsCap: d.fpsCap,
        objectFit: d.objectFit,
        flipX: d.flipX,
        flipY: d.flipY,
        layerPositionX: d.layerPositionX,
        layerPositionY: d.layerPositionY,
        layerScale: d.layerScale,
        wallpaperBlur: d.wallpaperBlur,
        wallpaperOpacity: d.wallpaperOpacity,
        scrim: d.scrim,
        backgroundBrightness: d.backgroundBrightness,
        backgroundContrast: d.backgroundContrast,
        backgroundSaturate: d.backgroundSaturate,
        switchTransition: d.switchTransition,
        sceneLive: d.sceneLive,
        liveBootDelay: d.liveBootDelay,
        sceneLiveFps: d.sceneLiveFps,
        sceneAutoQuality: d.sceneAutoQuality,
        sceneSoftRenderPause: d.sceneSoftRenderPause,
        pauseOnHidden: d.pauseOnHidden,
        pauseOnBlur: d.pauseOnBlur,
        pauseOnBattery: d.pauseOnBattery,
        startPaused: d.startPaused,
        audioReactive: d.audioReactive,
      };
  }
}

export interface CreateWallpaperStoreOptions {
  settings?: Partial<WallpaperSettingsState>;
  ui?: Partial<WallpaperUiViewState>;
  wallpapers?: WallpaperItem[];
  includeBuiltins?: boolean;
  storage?: StorageLike | null;
  onSettingsChange?: (settings: WallpaperSettingsState) => void;
}

export interface WallpaperStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => WallpaperRuntimeSnapshot;
  getServerSnapshot: () => WallpaperRuntimeSnapshot;
  updateSettings: (patch: Partial<WallpaperSettingsState>) => void;
  setSetting: <K extends keyof WallpaperSettingsState>(
    key: K,
    value: WallpaperSettingsState[K],
  ) => void;
  setUiState: <K extends keyof WallpaperUiViewState>(
    key: K,
    value: WallpaperUiViewState[K],
  ) => void;
  toggleUiSection: (
    key: "detailOpen" | "glassUiOpen" | "cornersOpen" | "uiColorOpen" | "fontOpen" | "glassDetailOpen",
  ) => void;
  selectWallpaper: (id: string | null) => void;
  clearWallpaper: () => void;
  togglePlay: () => void;
  setPlaying: (playing: boolean) => void;
  toggleAudio: () => void;
  setVideoVolume: (volume: number) => void;
  toggleRatingFilter: (rating: ContentRating) => void;
  toggleTypeFilter: (type: WallpaperType) => void;
  hideWallpapers: (ids: readonly string[]) => void;
  restoreWallpapers: (ids: readonly string[]) => void;
  restoreAllWallpapers: () => void;
  isChildGlassIndependent: (childId: GlassChildId) => boolean;
  setChildGlassIndependent: (childId: GlassChildId, independent: boolean) => void;
  setChildGlassParam: <K extends keyof GlassChildOverride>(
    childId: GlassChildId,
    param: K,
    value: GlassChildOverride[K],
  ) => void;
  setUserPropOverride: (wallpaperId: string, propName: string, value: UserPropWireValue) => void;
  resetUserProps: (wallpaperId: string) => void;
  getResolvedUserProps: (wallpaperId: string) => UserPropDef[];
  createRotationGroup: (input: Omit<RotationGroup, "id"> & { id?: string }) => RotationGroup;
  updateRotationGroup: (id: string, patch: Partial<Omit<RotationGroup, "id">>) => void;
  deleteRotationGroup: (id: string) => void;
  nextWallpaper: (rng?: () => number) => string | null;
  startRotationTimer: () => void;
  stopRotationTimer: () => void;
  handleVideoEnded: (rng?: () => number) => void;
  resetModule: (moduleKey: WallpaperModuleResetKey) => void;
  resetTab: (tab: WallpaperSettingsTabId) => void;
  resetAllSettings: () => void;
  setWallpapers: (
    wallpapers: WallpaperItem[],
    meta?: { steamRoots?: string[]; customDir?: string; error?: string | null },
  ) => void;
  refreshLibrary: (adapter?: WallpaperHostAdapter, forceRefresh?: boolean) => Promise<void>;
  importLocalFiles: (adapter: WallpaperHostAdapter | undefined, files: FileList | File[]) => Promise<void>;
  refreshSystemFonts: (adapter?: WallpaperHostAdapter, forceRefresh?: boolean) => Promise<void>;
  ensureUserProperties: (adapter: WallpaperHostAdapter | undefined, wallpaper: WallpaperItem) => Promise<void>;
  setQpSearch: (query: string) => void;
  setSettingsSearch: (query: string) => void;
  setPropsPanelOpen: (open: boolean) => void;
  setVideoError: (error: string | null) => void;
  setOccluded: (occluded: boolean) => void;
  setAudioEnergy: (energy: number | number[]) => void;
  dispose: () => void;
}

function builtinSceneCanonicalKey(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (!key.startsWith("builtin:") && !key.startsWith("builtin-")) return null;
  if (key.includes("aurora")) return "aurora-prism";
  if (key.includes("midnight") || key.includes("abyss") || key.includes("tide")) {
    return "midnight-abyss";
  }
  if (key.includes("silk") || key.includes("liquid")) return "liquid-silk";
  if (key.includes("twilight") || key.includes("dusk") || key.includes("cyber")) {
    return "cyber-twilight";
  }
  return null;
}

/**
 * Resolves a wallpaper by exact id, with seamless alias fallback between
 * `@prismux/wallpaper` (`builtin:aurora-prism`) and `@prismux/daemon` (`builtin-aurora-prism`) builtin IDs.
 */
export function findWallpaperById(
  wallpapers: readonly WallpaperItem[],
  selectedId: string | null | undefined,
): WallpaperItem | null {
  if (!selectedId) return null;
  const exact = wallpapers.find((w) => w.id === selectedId);
  if (exact) return exact;
  const canonical = builtinSceneCanonicalKey(selectedId);
  if (!canonical) return null;
  return (
    wallpapers.find(
      (w) =>
        w.source === "builtin" &&
        (w.builtinSceneId === canonical || builtinSceneCanonicalKey(w.id) === canonical),
    ) ?? null
  );
}

/**
 * Normalizes `wallpaperOpacity` (0..90 native-fade %) and `scrim` (0..0.9 dark veil fraction)
 * so legacy Daemon defaults (`wallpaperOpacity: 100`, `scrim: 35`) never produce a 99% blackout wall.
 */
export function normalizeWallpaperFadeOpacity(raw: unknown, fallback = 0): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  if (raw > 90) return 0;
  return Math.max(0, Math.min(90, raw));
}

export function normalizeWallpaperScrim(raw: unknown, fallback = 0.15): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const fraction = raw > 1 ? raw / 100 : raw;
  return Math.max(0, Math.min(0.9, fraction));
}

export function normalizeWallpaperSettingsPatch(
  patch: Partial<WallpaperSettingsState>,
): Partial<WallpaperSettingsState> {
  let next: Partial<WallpaperSettingsState> = patch;
  if ("wallpaperOpacity" in patch && patch.wallpaperOpacity !== undefined) {
    const normalized = normalizeWallpaperFadeOpacity(patch.wallpaperOpacity, 0);
    if (normalized !== patch.wallpaperOpacity) {
      next = { ...next, wallpaperOpacity: normalized };
    }
  }
  if ("scrim" in patch && patch.scrim !== undefined) {
    const normalized = normalizeWallpaperScrim(patch.scrim, 0.15);
    if (normalized !== patch.scrim) {
      next = { ...next, scrim: normalized };
    }
  }
  return next;
}

function matchBuiltinTemplate(
  item: WallpaperItem,
  builtins: readonly WallpaperItem[],
): WallpaperItem | undefined {
  const key = (item.builtinSceneId ?? item.id).toLowerCase();
  if (key.includes("aurora")) return builtins[0];
  if (key.includes("midnight") || key.includes("abyss") || key.includes("tide")) return builtins[1];
  if (key.includes("silk") || key.includes("liquid")) return builtins[2];
  if (key.includes("twilight") || key.includes("dusk") || key.includes("cyber")) return builtins[3];
  return undefined;
}

function mergeWallpapers(
  external: readonly WallpaperItem[],
  includeBuiltins: boolean,
): WallpaperItem[] {
  const builtins = includeBuiltins ? createBuiltinWallpapers() : [];
  const hasExternalBuiltins = external.some((w) => w.source === "builtin");
  const map = new Map<string, WallpaperItem>();

  if (includeBuiltins && !hasExternalBuiltins) {
    for (const item of builtins) {
      map.set(item.id, item);
    }
  }

  for (const item of external) {
    if (item.source === "builtin" && builtins.length > 0) {
      const tpl = matchBuiltinTemplate(item, builtins);
      map.set(item.id, {
        ...item,
        previewUrl: item.previewUrl ?? tpl?.previewUrl ?? null,
        schemeColor: item.schemeColor ?? tpl?.schemeColor ?? null,
        builtinSceneId: item.builtinSceneId ?? tpl?.builtinSceneId,
        userProperties: item.userProperties?.length ? item.userProperties : tpl?.userProperties,
      });
    } else {
      map.set(item.id, item);
    }
  }
  return [...map.values()];
}

export function createWallpaperStore(
  options: CreateWallpaperStoreOptions = {},
): WallpaperStore {
  const storage = getBrowserStorage(options.storage);
  const includeBuiltins = options.includeBuiltins !== false;
  const defaults = createDefaultSettings();
  const normalizedInputSettings = options.settings
    ? normalizeWallpaperSettingsPatch(options.settings)
    : undefined;
  const initialSettings: WallpaperSettingsState = {
    ...defaults,
    ...normalizedInputSettings,
    glassColor: {
      ...defaults.glassColor,
      ...(options.settings?.glassColor ?? {}),
    },
    glassSurfacePolicy: {
      ...defaults.glassSurfacePolicy,
      ...(options.settings?.glassSurfacePolicy ?? {}),
    },
    themeColors: {
      primary: { ...defaults.themeColors.primary, ...(options.settings?.themeColors?.primary ?? {}) },
      secondary: { ...defaults.themeColors.secondary, ...(options.settings?.themeColors?.secondary ?? {}) },
      tertiary: { ...defaults.themeColors.tertiary, ...(options.settings?.themeColors?.tertiary ?? {}) },
      muted: { ...defaults.themeColors.muted, ...(options.settings?.themeColors?.muted ?? {}) },
    },
  };
  if (initialSettings.startPaused) {
    initialSettings.playing = false;
  }

  const initialWallpapers = mergeWallpapers(options.wallpapers ?? [], includeBuiltins);
  if (initialSettings.selectedId) {
    const resolvedInitial = findWallpaperById(initialWallpapers, initialSettings.selectedId);
    if (resolvedInitial && resolvedInitial.id !== initialSettings.selectedId) {
      initialSettings.selectedId = resolvedInitial.id;
    }
  }
  const initialPropsMap: Record<string, UserPropDef[]> = {};
  for (const w of initialWallpapers) {
    if (w.userProperties?.length) {
      initialPropsMap[w.id] = w.userProperties;
    }
  }

  let snapshot: WallpaperRuntimeSnapshot = {
    settings: initialSettings,
    ui: loadInitialUiViewState(storage, options.ui),
    wallpapers: initialWallpapers,
    steamRoots: [],
    customDir: initialSettings.customWallpaperDir,
    loaded: true,
    loading: false,
    inventoryError: null,
    videoError: null,
    qpSearch: "",
    settingsSearch: "",
    propsPanelOpen: false,
    propsLoading: false,
    propsError: null,
    propsMap: initialPropsMap,
    systemFonts: [],
    systemFontsLoading: false,
    systemFontsApproximate: false,
    systemFontsError: null,
    occluded: false,
    audioEnergy: 0,
  };

  const listeners = new Set<() => void>();
  let rotationTimer: ReturnType<typeof setInterval> | null = null;

  const emit = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const commit = (next: WallpaperRuntimeSnapshot, settingsChanged = false): void => {
    snapshot = next;
    if (settingsChanged) {
      options.onSettingsChange?.(snapshot.settings);
    }
    emit();
  };

  const stopRotationTimer = (): void => {
    if (rotationTimer !== null) {
      clearInterval(rotationTimer);
      rotationTimer = null;
    }
  };

  const syncRotationTimer = (): void => {
    stopRotationTimer();
    const { rotationEnabled, rotationGroupId, rotationGroups } = snapshot.settings;
    if (!rotationEnabled) return;
    const group = rotationGroups.find((g) => g.id === rotationGroupId);
    if (!group || group.trigger !== "timer") return;
    const intervalMs = Math.max(1, group.intervalMinutes) * 60_000;
    rotationTimer = setInterval(() => {
      if (!snapshot.occluded && snapshot.settings.playing) {
        store.nextWallpaper();
      }
    }, intervalMs);
  };

  const store: WallpaperStore = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return snapshot;
    },

    getServerSnapshot() {
      return snapshot;
    },

    updateSettings(patch) {
      const normalizedPatch = normalizeWallpaperSettingsPatch(patch);
      const nextSettings: WallpaperSettingsState = {
        ...snapshot.settings,
        ...normalizedPatch,
      };
      commit({ ...snapshot, settings: nextSettings }, true);
      if (
        "rotationEnabled" in normalizedPatch ||
        "rotationGroupId" in normalizedPatch ||
        "rotationGroups" in normalizedPatch
      ) {
        syncRotationTimer();
      }
    },

    setSetting(key, value) {
      store.updateSettings({ [key]: value } as Partial<WallpaperSettingsState>);
    },

    setUiState(key, value) {
      if (snapshot.ui[key] === value) return;
      const nextUi: WallpaperUiViewState = {
        ...snapshot.ui,
        [key]: value,
      };
      const storageKey = UI_STORAGE_KEYS[key];
      if (typeof value === "boolean") {
        writeUiValue(storage, storageKey, value ? "1" : "0");
      } else {
        writeUiValue(storage, storageKey, String(value));
      }
      // Strictly UI-only: does NOT mark business settings changed
      commit({ ...snapshot, ui: nextUi }, false);
    },

    toggleUiSection(key) {
      store.setUiState(key, !snapshot.ui[key]);
    },

    selectWallpaper(id) {
      const nextHidden =
        id && snapshot.settings.hiddenIds.includes(id)
          ? snapshot.settings.hiddenIds.filter((x) => x !== id)
          : snapshot.settings.hiddenIds;
      const nextSettings: WallpaperSettingsState = {
        ...snapshot.settings,
        selectedId: id,
        playing: id !== null,
        hiddenIds: nextHidden,
      };
      commit({ ...snapshot, settings: nextSettings, videoError: null }, true);
    },

    clearWallpaper() {
      const nextSettings: WallpaperSettingsState = {
        ...snapshot.settings,
        selectedId: null,
        playing: false,
      };
      commit(
        {
          ...snapshot,
          settings: nextSettings,
          propsPanelOpen: false,
          videoError: null,
        },
        true,
      );
    },

    togglePlay() {
      if (!snapshot.settings.selectedId) return;
      store.setSetting("playing", !snapshot.settings.playing);
    },

    setPlaying(playing) {
      store.setSetting("playing", playing);
    },

    toggleAudio() {
      const nextEnabled = !snapshot.settings.videoAudioEnabled;
      const nextVolume =
        nextEnabled && snapshot.settings.videoVolume <= 0
          ? 0.5
          : snapshot.settings.videoVolume;
      store.updateSettings({
        videoAudioEnabled: nextEnabled,
        videoVolume: nextVolume,
      });
    },

    setVideoVolume(volume) {
      const clamped = Math.max(0, Math.min(1, Number(volume) || 0));
      store.updateSettings({
        videoVolume: clamped,
        videoAudioEnabled: clamped > 0 ? true : snapshot.settings.videoAudioEnabled,
      });
    },

    toggleRatingFilter(rating) {
      const current = new Set(snapshot.settings.contentRatingFilter);
      if (current.has(rating)) {
        current.delete(rating);
      } else {
        current.add(rating);
      }
      const next = RATING_TIER_VALUES.filter((r) => current.has(r));
      store.setSetting("contentRatingFilter", next);
    },

    toggleTypeFilter(type) {
      const current = new Set(snapshot.settings.typeFilter);
      if (current.has(type)) {
        current.delete(type);
      } else {
        current.add(type);
      }
      const next = TYPE_TIER_VALUES.filter((t) => current.has(t));
      // Keep at least one type checked (matches quick-panel.js invariant)
      if (next.length === 0) return;
      store.setSetting("typeFilter", next);
    },

    hideWallpapers(ids) {
      if (ids.length === 0) return;
      const hidden = new Set(snapshot.settings.hiddenIds);
      for (const id of ids) hidden.add(id);
      const patch: Partial<WallpaperSettingsState> = {
        hiddenIds: [...hidden],
      };
      if (snapshot.settings.selectedId && hidden.has(snapshot.settings.selectedId)) {
        patch.selectedId = null;
        patch.playing = false;
      }
      store.updateSettings(patch);
    },

    restoreWallpapers(ids) {
      if (ids.length === 0) return;
      const remove = new Set(ids);
      const next = snapshot.settings.hiddenIds.filter((id) => !remove.has(id));
      store.setSetting("hiddenIds", next);
    },

    restoreAllWallpapers() {
      store.setSetting("hiddenIds", []);
    },

    isChildGlassIndependent(childId) {
      return snapshot.settings.glassMode[childId] === "custom";
    },

    setChildGlassIndependent(childId, independent) {
      const nextMode = {
        ...snapshot.settings.glassMode,
        [childId]: independent ? ("custom" as const) : ("inherit" as const),
      };
      const existing = snapshot.settings.glassChildren[childId];
      let nextChildren = snapshot.settings.glassChildren;
      if (independent && !existing) {
        const spec = GLASS_CHILDREN_REGISTRY.find((c) => c.id === childId);
        nextChildren = {
          ...snapshot.settings.glassChildren,
          [childId]: {
            blur: spec?.defaults?.blur ?? snapshot.settings.blur,
            transparency: spec?.defaults?.transparency ?? snapshot.settings.glassAlpha,
            fidelity: spec?.defaults?.fidelity ?? snapshot.settings.glassFidelity,
            color: spec?.defaults?.color ?? snapshot.settings.glassColor.light,
          },
        };
      }
      store.updateSettings({
        glassMode: nextMode,
        glassChildren: nextChildren,
      });
    },

    setChildGlassParam(childId, param, value) {
      const prev = snapshot.settings.glassChildren[childId] ?? {};
      store.updateSettings({
        glassChildren: {
          ...snapshot.settings.glassChildren,
          [childId]: {
            ...prev,
            [param]: value,
          },
        },
      });
    },

    setUserPropOverride(wallpaperId, propName, value) {
      const currentMap = snapshot.settings.userPropOverrides[wallpaperId] ?? {};
      store.updateSettings({
        userPropOverrides: {
          ...snapshot.settings.userPropOverrides,
          [wallpaperId]: {
            ...currentMap,
            [propName]: value,
          },
        },
      });
    },

    resetUserProps(wallpaperId) {
      if (!snapshot.settings.userPropOverrides[wallpaperId]) return;
      const next = { ...snapshot.settings.userPropOverrides };
      delete next[wallpaperId];
      store.updateSettings({ userPropOverrides: next });
    },

    getResolvedUserProps(wallpaperId) {
      const item = snapshot.wallpapers.find((w) => w.id === wallpaperId);
      const base = snapshot.propsMap[wallpaperId] ?? item?.userProperties ?? [];
      const overrides = snapshot.settings.userPropOverrides[wallpaperId];
      return applyUserPropOverrides(base, overrides);
    },

    createRotationGroup(input) {
      const id =
        input.id?.trim() ||
        `rot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const group: RotationGroup = {
        id,
        name: input.name.trim() || "新建轮播列表",
        wallpaperIds: [...new Set(input.wallpaperIds)],
        intervalMinutes: Math.max(1, Math.round(input.intervalMinutes || 15)),
        order: input.order === "random" ? "random" : "sequence",
        trigger: input.trigger === "videoEnd" ? "videoEnd" : "timer",
      };
      const nextGroups = [...snapshot.settings.rotationGroups, group];
      const nextGroupId = snapshot.settings.rotationGroupId || group.id;
      store.updateSettings({
        rotationGroups: nextGroups,
        rotationGroupId: nextGroupId,
      });
      return group;
    },

    updateRotationGroup(id, patch) {
      const nextGroups = snapshot.settings.rotationGroups.map((g) => {
        if (g.id !== id) return g;
        return {
          ...g,
          ...patch,
          wallpaperIds: patch.wallpaperIds ? [...new Set(patch.wallpaperIds)] : g.wallpaperIds,
          intervalMinutes:
            patch.intervalMinutes !== undefined
              ? Math.max(1, Math.round(patch.intervalMinutes))
              : g.intervalMinutes,
        };
      });
      store.updateSettings({ rotationGroups: nextGroups });
    },

    deleteRotationGroup(id) {
      const nextGroups = snapshot.settings.rotationGroups.filter((g) => g.id !== id);
      const wasActive = snapshot.settings.rotationGroupId === id;
      store.updateSettings({
        rotationGroups: nextGroups,
        rotationGroupId: wasActive ? (nextGroups[0]?.id ?? "") : snapshot.settings.rotationGroupId,
        rotationEnabled: wasActive && nextGroups.length === 0 ? false : snapshot.settings.rotationEnabled,
      });
    },

    nextWallpaper(rng = Math.random) {
      const candidates = resolveRotationCandidates(snapshot.wallpapers, snapshot.settings);
      const activeGroup = snapshot.settings.rotationGroups.find(
        (g) => g.id === snapshot.settings.rotationGroupId,
      );
      const order =
        snapshot.settings.rotationEnabled && activeGroup ? activeGroup.order : "sequence";
      const nextId = pickNextWallpaperId(candidates, snapshot.settings.selectedId, order, rng);
      if (nextId) {
        store.selectWallpaper(nextId);
      }
      return nextId;
    },

    startRotationTimer() {
      syncRotationTimer();
    },

    stopRotationTimer,

    handleVideoEnded(rng = Math.random) {
      const { rotationEnabled, rotationGroupId, rotationGroups } = snapshot.settings;
      if (!rotationEnabled) return;
      const activeGroup = rotationGroups.find((g) => g.id === rotationGroupId);
      if (activeGroup && activeGroup.trigger === "videoEnd") {
        store.nextWallpaper(rng);
      }
    },

    resetModule(moduleKey) {
      store.updateSettings(buildModuleResetPatch(moduleKey));
    },

    resetTab(tab) {
      const d = createDefaultSettings();
      switch (tab) {
        case "library":
          store.updateSettings({
            contentRatingFilter: [...d.contentRatingFilter],
            typeFilter: [...d.typeFilter],
            orientationFilter: d.orientationFilter,
            pickerLayout: d.pickerLayout,
          });
          break;
        case "appearance":
          store.updateSettings({
            ...buildModuleResetPatch("theme"),
            ...buildModuleResetPatch("details"),
            ...buildModuleResetPatch("glass"),
            ...buildModuleResetPatch("corners"),
            ...buildModuleResetPatch("uiColor"),
            ...buildModuleResetPatch("font"),
          });
          break;
        case "playback":
          store.updateSettings(buildModuleResetPatch("playback"));
          break;
        case "rotation":
          store.updateSettings({
            rotationEnabled: false,
            rotationGroupId: "",
            rotationGroups: [],
            hiddenIds: [],
          });
          break;
        case "system":
          store.updateSettings({
            steamRootOverride: "",
            customWallpaperDir: "",
            pickerLayout: d.pickerLayout,
            pauseOnHidden: d.pauseOnHidden,
            pauseOnBlur: d.pauseOnBlur,
            pauseOnBattery: d.pauseOnBattery,
            startPaused: d.startPaused,
          });
          break;
      }
    },

    resetAllSettings() {
      const d = createDefaultSettings();
      commit({ ...snapshot, settings: d, videoError: null }, true);
      stopRotationTimer();
    },

    setWallpapers(wallpapers, meta) {
      const merged = mergeWallpapers(wallpapers, includeBuiltins);
      const nextPropsMap = { ...snapshot.propsMap };
      for (const w of merged) {
        if (w.userProperties?.length) {
          nextPropsMap[w.id] = w.userProperties;
        }
      }
      let nextSettings = snapshot.settings;
      if (nextSettings.selectedId && !merged.some((w) => w.id === nextSettings.selectedId)) {
        const aliasMatch = findWallpaperById(merged, nextSettings.selectedId);
        if (aliasMatch) {
          nextSettings = { ...nextSettings, selectedId: aliasMatch.id };
        }
      }
      commit(
        {
          ...snapshot,
          settings: nextSettings,
          wallpapers: merged,
          propsMap: nextPropsMap,
          steamRoots: meta?.steamRoots ?? snapshot.steamRoots,
          customDir: meta?.customDir ?? snapshot.customDir,
          inventoryError: meta?.error ?? null,
          loaded: true,
          loading: false,
        },
        false,
      );
    },

    async refreshLibrary(adapter, forceRefresh = true) {
      if (!adapter?.listWallpapers && !adapter?.refreshSteamLibrary) return;
      commit({ ...snapshot, loading: true, inventoryError: null }, false);
      try {
        const res = adapter.listWallpapers
          ? await adapter.listWallpapers({
              forceRefresh,
              steamRootOverride: snapshot.settings.steamRootOverride || undefined,
              customDir: snapshot.settings.customWallpaperDir || undefined,
            })
          : await adapter.refreshSteamLibrary!(snapshot.settings.steamRootOverride || undefined);
        store.setWallpapers(res.wallpapers, {
          steamRoots: res.steamRoots,
          customDir: res.customDir,
          error: res.error ?? null,
        });
      } catch (err) {
        commit(
          {
            ...snapshot,
            loading: false,
            loaded: true,
            inventoryError: err instanceof Error ? err.message : String(err),
          },
          false,
        );
      }
    },

    async importLocalFiles(adapter, files) {
      if (!adapter?.importLocalFiles) return;
      const imported = await adapter.importLocalFiles(files);
      if (imported.length === 0) return;
      const merged = mergeWallpapers([...snapshot.wallpapers, ...imported], includeBuiltins);
      const nextPropsMap = { ...snapshot.propsMap };
      for (const w of imported) {
        if (w.userProperties?.length) nextPropsMap[w.id] = w.userProperties;
      }
      commit(
        {
          ...snapshot,
          wallpapers: merged,
          propsMap: nextPropsMap,
        },
        false,
      );
      // Automatically apply the first newly imported wallpaper for immediate feedback
      store.selectWallpaper(imported[0]!.id);
    },

    async refreshSystemFonts(adapter, forceRefresh = false) {
      if (!adapter?.querySystemFonts) return;
      if (snapshot.systemFontsLoading) return;
      if (!forceRefresh && snapshot.systemFonts.length > 0) return;
      commit({ ...snapshot, systemFontsLoading: true, systemFontsError: null }, false);
      try {
        const res = await adapter.querySystemFonts(forceRefresh);
        commit(
          {
            ...snapshot,
            systemFonts: res.fonts,
            systemFontsLoading: false,
            systemFontsApproximate: res.approximate === true,
            systemFontsError: res.error ?? null,
          },
          false,
        );
      } catch (err) {
        commit(
          {
            ...snapshot,
            systemFontsLoading: false,
            systemFontsError: err instanceof Error ? err.message : String(err),
          },
          false,
        );
      }
    },

    async ensureUserProperties(adapter, wallpaper) {
      if (snapshot.propsMap[wallpaper.id] || wallpaper.userProperties?.length) {
        if (!snapshot.propsMap[wallpaper.id] && wallpaper.userProperties) {
          commit(
            {
              ...snapshot,
              propsMap: { ...snapshot.propsMap, [wallpaper.id]: wallpaper.userProperties },
            },
            false,
          );
        }
        return;
      }
      if (!adapter?.loadUserProperties) return;
      commit({ ...snapshot, propsLoading: true, propsError: null }, false);
      try {
        const defs = await adapter.loadUserProperties(wallpaper);
        commit(
          {
            ...snapshot,
            propsLoading: false,
            propsError: null,
            propsMap: { ...snapshot.propsMap, [wallpaper.id]: defs },
          },
          false,
        );
      } catch (err) {
        commit(
          {
            ...snapshot,
            propsLoading: false,
            propsError: err instanceof Error ? err.message : String(err),
          },
          false,
        );
      }
    },

    setQpSearch(query) {
      if (snapshot.qpSearch === query) return;
      commit({ ...snapshot, qpSearch: query }, false);
    },

    setSettingsSearch(query) {
      if (snapshot.settingsSearch === query) return;
      commit({ ...snapshot, settingsSearch: query }, false);
    },

    setPropsPanelOpen(open) {
      if (snapshot.propsPanelOpen === open) return;
      commit({ ...snapshot, propsPanelOpen: open }, false);
    },

    setVideoError(error) {
      if (snapshot.videoError === error) return;
      commit({ ...snapshot, videoError: error }, false);
    },

    setOccluded(occluded) {
      if (snapshot.occluded === occluded) return;
      commit({ ...snapshot, occluded }, false);
    },

    setAudioEnergy(energy) {
      commit({ ...snapshot, audioEnergy: energy }, false);
    },

    dispose() {
      stopRotationTimer();
      listeners.clear();
    },
  };

  syncRotationTimer();
  return store;
}

export function useWallpaperStore(store: WallpaperStore): WallpaperRuntimeSnapshot {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
}
