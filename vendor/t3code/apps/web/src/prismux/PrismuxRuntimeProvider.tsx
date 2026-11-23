import {
  DEFAULT_APPEARANCE_CONFIG,
  applyPrismuxAppearanceToDocument,
  normalizeAppearanceConfig,
  resolveBasePolarity,
  setThemeModeWithGlassAutoWake,
  type AppearanceConfig,
  type DeepPartialAppearanceConfig,
  type ThemeMode,
} from "@prismux/appearance";
import {
  createBuiltinWallpapers,
  createDefaultSettings,
  createWallpaperStore,
  normalizeWallpaperSettingsPatch,
  type SystemFontsResult,
  type UserPropDef,
  type UserPropType,
  type WallpaperHostAdapter,
  type WallpaperInventoryResult,
  type WallpaperItem,
  type WallpaperSettingsState,
  type WallpaperSettingsTabId,
  type WallpaperStore,
} from "@prismux/wallpaper";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { setAppearanceMode, syncBrowserChromeTheme } from "../hooks/useTheme";
import type { AppRouter } from "../router";
import {
  prismuxDaemonClient,
  type DaemonConnectionInfo,
  type DaemonWallpaperItemDto,
  type PrismuxDaemonClient,
} from "./daemonClient";

export type PrismuxDialMode = "agent" | "oracle" | "review";

export interface PrismuxRuntimeContextValue {
  daemon: PrismuxDaemonClient;
  daemonInfo: DaemonConnectionInfo;
  appearance: AppearanceConfig;
  setAppearance: (
    next: AppearanceConfig | ((prev: AppearanceConfig) => AppearanceConfig),
  ) => void;
  setThemeMode: (mode: ThemeMode) => void;
  wallpaperStore: WallpaperStore;
  wallpaperHost: WallpaperHostAdapter;
  occluded: boolean;
  systemFonts: string[];
  refreshSystemFonts: (forceRefresh?: boolean) => Promise<string[]>;
  chiefProvider: string;
  dialMode: PrismuxDialMode;
  switchChief: (next: { provider?: string; dialMode?: PrismuxDialMode }) => Promise<void>;
}

const APPEARANCE_STORAGE_KEY = "prismux.appearance.v1";
const WALLPAPER_STORAGE_KEY = "prismux.wallpaper.settings.v1";
const DAEMON_SAVE_DEBOUNCE_MS = 320;

const VALID_USER_PROP_TYPES = new Set<UserPropType>([
  "color",
  "bool",
  "slider",
  "combo",
  "text",
  "textinput",
  "file",
  "directory",
  "group",
  "other",
]);

function readLocalJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeLocalJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota or private browsing errors.
  }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeUserProps(
  rawProps: DaemonWallpaperItemDto["userProperties"],
): UserPropDef[] | undefined {
  if (!Array.isArray(rawProps) || rawProps.length === 0) return undefined;
  return rawProps.map((prop) => {
    const ptype = VALID_USER_PROP_TYPES.has(prop.ptype as UserPropType)
      ? (prop.ptype as UserPropType)
      : "other";
    return {
      name: prop.name,
      ptype,
      text: prop.text,
      order: prop.order,
      value: prop.value,
      defaultValue: prop.defaultValue,
      overridden: prop.overridden,
      ...(prop.condition !== undefined ? { condition: prop.condition } : {}),
      ...(prop.min !== undefined ? { min: prop.min } : {}),
      ...(prop.max !== undefined ? { max: prop.max } : {}),
      ...(prop.step !== undefined ? { step: prop.step } : {}),
      ...(prop.options !== undefined ? { options: prop.options } : {}),
      ...(prop.fileType !== undefined ? { fileType: prop.fileType } : {}),
    };
  });
}

function mapDaemonWallpaperItem(
  dto: DaemonWallpaperItemDto,
  daemon: PrismuxDaemonClient,
): WallpaperItem {
  const previewUrl = daemon.resolveMediaUrl(dto.previewUrl);
  const mediaUrl = daemon.resolveMediaUrl(dto.mediaUrl ?? dto.webEntryUrl ?? null);
  const userProperties = normalizeUserProps(dto.userProperties);
  return {
    id: dto.id,
    title: dto.title,
    type: dto.type,
    source: dto.source,
    previewUrl,
    mediaUrl,
    filePath: dto.filePath,
    ...(dto.dirPath !== undefined ? { dirPath: dto.dirPath } : {}),
    width: dto.width,
    height: dto.height,
    orientation: dto.orientation,
    contentRating: dto.contentRating,
    ...(userProperties !== undefined ? { userProperties } : {}),
    ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
    ...(dto.schemeColor !== undefined ? { schemeColor: dto.schemeColor } : {}),
    ...(dto.builtinSceneId !== undefined ? { builtinSceneId: dto.builtinSceneId } : {}),
    ...(dto.sceneLiveSupported !== undefined
      ? { sceneLiveSupported: dto.sceneLiveSupported }
      : {}),
    ...(dto.webLiveSupported !== undefined ? { webLiveSupported: dto.webLiveSupported } : {}),
    ...(dto.fileSize !== undefined ? { fileSize: dto.fileSize } : {}),
    ...(dto.mtimeMs !== undefined ? { mtimeMs: dto.mtimeMs } : {}),
  };
}

function appearanceToWallpaperPatch(
  cfg: AppearanceConfig,
  current: WallpaperSettingsState,
): Partial<WallpaperSettingsState> {
  const rightRadius = cfg.rightSidebarCornerRadius ?? cfg.sidebarCornerRadius;
  const rightSq = cfg.rightSidebarSquareCorners ?? cfg.sidebarSquareCorners;

  const patch: Partial<WallpaperSettingsState> = {};
  const setIfChanged = <K extends keyof WallpaperSettingsState>(
    key: K,
    nextVal: WallpaperSettingsState[K],
  ) => {
    if (current[key] !== nextVal) {
      patch[key] = nextVal;
    }
  };

  setIfChanged("themeMode", cfg.themeMode);
  if (
    current.glassColor.light !== cfg.glassColor ||
    current.glassColor.dark !== cfg.glassDarkColor
  ) {
    patch.glassColor = {
      light: cfg.glassColor,
      dark: cfg.glassDarkColor,
    };
  }
  setIfChanged("glassDarkSeparate", cfg.glassDarkSeparate);
  setIfChanged("glassAlpha", clampInt(100 - cfg.glassRegions.surface.op, 0, 100));
  setIfChanged("blur", clampInt(cfg.glassRegions.surface.blur, 0, 48));
  setIfChanged("glassFidelity", clampInt(cfg.glassFidelity, 0, 100));
  setIfChanged("thinkingMode", cfg.thinkingMode);
  setIfChanged("leftSidebarGlass", cfg.leftSidebarGlass);
  setIfChanged("titlebarGlass", cfg.titlebarGlass);
  setIfChanged("sidebarGlass", cfg.rightSidebarGlass);
  setIfChanged("sidebarFullClear", cfg.rightSidebarFullClear);
  setIfChanged("leftSidebarCornerRadius", cfg.sidebarCornerRadius);
  setIfChanged("leftSidebarSquareTL", cfg.sidebarSquareCorners.tl);
  setIfChanged("leftSidebarSquareTR", cfg.sidebarSquareCorners.tr);
  setIfChanged("leftSidebarSquareBR", cfg.sidebarSquareCorners.br);
  setIfChanged("leftSidebarSquareBL", cfg.sidebarSquareCorners.bl);
  setIfChanged("rightSidebarCornerRadius", rightRadius);
  setIfChanged("rightSidebarSquareTL", rightSq.tl);
  setIfChanged("rightSidebarSquareTR", rightSq.tr);
  setIfChanged("rightSidebarSquareBR", rightSq.br);
  setIfChanged("rightSidebarSquareBL", rightSq.bl);

  const nextAccent = cfg.accentMode === "custom" ? cfg.accent : "";
  setIfChanged("accent", nextAccent);
  setIfChanged("uiColorCustom", cfg.uiColorCustom.enabled);
  setIfChanged("uiColorSend", cfg.uiColorCustom.send);
  setIfChanged("uiColorLink", cfg.uiColorCustom.link);
  setIfChanged("uiColorFileIcon", cfg.uiColorCustom.fileIcon);
  setIfChanged("uiColorTab", cfg.uiColorCustom.tab);
  setIfChanged("uiColorDeepDiving", cfg.uiColorCustom.deepDiving);
  setIfChanged("caretColor", cfg.caretColor);
  setIfChanged("globalFamily", cfg.typography.fontFamily);
  setIfChanged("terminalFamily", cfg.typography.codeFontFamily);

  const curColors = current.themeColors;
  if (
    curColors.primary.light !== cfg.typography.light.headingColor ||
    curColors.primary.dark !== cfg.typography.dark.headingColor ||
    curColors.secondary.light !== cfg.typography.light.textColor ||
    curColors.secondary.dark !== cfg.typography.dark.textColor ||
    curColors.muted.light !== cfg.typography.light.mutedColor ||
    curColors.muted.dark !== cfg.typography.dark.mutedColor
  ) {
    patch.themeColors = {
      primary: {
        light: cfg.typography.light.headingColor,
        dark: cfg.typography.dark.headingColor,
      },
      secondary: {
        light: cfg.typography.light.textColor,
        dark: cfg.typography.dark.textColor,
      },
      tertiary: { ...curColors.tertiary },
      muted: {
        light: cfg.typography.light.mutedColor,
        dark: cfg.typography.dark.mutedColor,
      },
    };
  }

  return patch;
}

function diffWallpaperToAppearance(
  prevAppearance: AppearanceConfig,
  prevWs: WallpaperSettingsState,
  nextWs: WallpaperSettingsState,
): { changed: boolean; next: AppearanceConfig } {
  let changed = false;
  let next: AppearanceConfig = prevAppearance;

  if (nextWs.themeMode !== prevWs.themeMode && nextWs.themeMode !== next.themeMode) {
    next = setThemeModeWithGlassAutoWake(next, nextWs.themeMode);
    changed = true;
  }

  const surfaceOpChanged = nextWs.glassAlpha !== prevWs.glassAlpha;
  const surfaceBlurChanged = nextWs.blur !== prevWs.blur;
  if (surfaceOpChanged || surfaceBlurChanged) {
    const nextOp = clampInt(100 - nextWs.glassAlpha, 0, 100);
    const nextBlur = clampInt(nextWs.blur, 0, 40);
    if (next.glassRegions.surface.op !== nextOp || next.glassRegions.surface.blur !== nextBlur) {
      next = {
        ...next,
        glassPreset: next.glassPreset === "off" && next.themeMode !== "glass" ? "off" : "custom",
        glassRegions: {
          ...next.glassRegions,
          surface: { op: nextOp, blur: nextBlur },
        },
      };
      changed = true;
    }
  }

  if (
    nextWs.glassColor.light !== prevWs.glassColor.light ||
    nextWs.glassColor.dark !== prevWs.glassColor.dark ||
    nextWs.glassDarkSeparate !== prevWs.glassDarkSeparate
  ) {
    next = {
      ...next,
      glassColor: nextWs.glassColor.light || next.glassColor,
      glassDarkColor: nextWs.glassColor.dark || next.glassDarkColor,
      glassDarkSeparate: nextWs.glassDarkSeparate,
    };
    changed = true;
  }

  if (nextWs.glassFidelity !== prevWs.glassFidelity) {
    next = { ...next, glassFidelity: clampInt(nextWs.glassFidelity, 0, 100) };
    changed = true;
  }

  if (nextWs.thinkingMode !== prevWs.thinkingMode) {
    next = { ...next, thinkingMode: nextWs.thinkingMode };
    changed = true;
  }

  if (
    nextWs.leftSidebarGlass !== prevWs.leftSidebarGlass ||
    nextWs.titlebarGlass !== prevWs.titlebarGlass ||
    nextWs.sidebarGlass !== prevWs.sidebarGlass ||
    nextWs.sidebarFullClear !== prevWs.sidebarFullClear
  ) {
    next = {
      ...next,
      leftSidebarGlass: nextWs.leftSidebarGlass,
      titlebarGlass: nextWs.titlebarGlass,
      rightSidebarGlass: nextWs.sidebarGlass,
      rightSidebarFullClear: nextWs.sidebarFullClear,
    };
    changed = true;
  }

  if (
    nextWs.leftSidebarCornerRadius !== prevWs.leftSidebarCornerRadius ||
    nextWs.leftSidebarSquareTL !== prevWs.leftSidebarSquareTL ||
    nextWs.leftSidebarSquareTR !== prevWs.leftSidebarSquareTR ||
    nextWs.leftSidebarSquareBR !== prevWs.leftSidebarSquareBR ||
    nextWs.leftSidebarSquareBL !== prevWs.leftSidebarSquareBL ||
    nextWs.rightSidebarCornerRadius !== prevWs.rightSidebarCornerRadius ||
    nextWs.rightSidebarSquareTL !== prevWs.rightSidebarSquareTL ||
    nextWs.rightSidebarSquareTR !== prevWs.rightSidebarSquareTR ||
    nextWs.rightSidebarSquareBR !== prevWs.rightSidebarSquareBR ||
    nextWs.rightSidebarSquareBL !== prevWs.rightSidebarSquareBL
  ) {
    next = {
      ...next,
      sidebarCornerRadius: nextWs.leftSidebarCornerRadius,
      sidebarSquareCorners: {
        tl: nextWs.leftSidebarSquareTL,
        tr: nextWs.leftSidebarSquareTR,
        br: nextWs.leftSidebarSquareBR,
        bl: nextWs.leftSidebarSquareBL,
      },
      rightSidebarCornerRadius: nextWs.rightSidebarCornerRadius,
      rightSidebarSquareCorners: {
        tl: nextWs.rightSidebarSquareTL,
        tr: nextWs.rightSidebarSquareTR,
        br: nextWs.rightSidebarSquareBR,
        bl: nextWs.rightSidebarSquareBL,
      },
    };
    changed = true;
  }

  if (nextWs.accent !== prevWs.accent) {
    next = {
      ...next,
      accentMode: nextWs.accent ? "custom" : "system",
      accent: nextWs.accent || next.accent,
    };
    changed = true;
  }

  if (
    nextWs.uiColorCustom !== prevWs.uiColorCustom ||
    nextWs.uiColorSend !== prevWs.uiColorSend ||
    nextWs.uiColorLink !== prevWs.uiColorLink ||
    nextWs.uiColorFileIcon !== prevWs.uiColorFileIcon ||
    nextWs.uiColorTab !== prevWs.uiColorTab ||
    nextWs.uiColorDeepDiving !== prevWs.uiColorDeepDiving
  ) {
    next = {
      ...next,
      uiColorCustom: {
        enabled: nextWs.uiColorCustom,
        send: nextWs.uiColorSend,
        link: nextWs.uiColorLink,
        fileIcon: nextWs.uiColorFileIcon,
        tab: nextWs.uiColorTab,
        deepDiving: nextWs.uiColorDeepDiving,
      },
    };
    changed = true;
  }

  if (nextWs.caretColor !== prevWs.caretColor) {
    next = { ...next, caretColor: nextWs.caretColor };
    changed = true;
  }

  if (
    nextWs.globalFamily !== prevWs.globalFamily ||
    nextWs.terminalFamily !== prevWs.terminalFamily ||
    nextWs.themeColors.primary.light !== prevWs.themeColors.primary.light ||
    nextWs.themeColors.primary.dark !== prevWs.themeColors.primary.dark ||
    nextWs.themeColors.secondary.light !== prevWs.themeColors.secondary.light ||
    nextWs.themeColors.secondary.dark !== prevWs.themeColors.secondary.dark ||
    nextWs.themeColors.muted.light !== prevWs.themeColors.muted.light ||
    nextWs.themeColors.muted.dark !== prevWs.themeColors.muted.dark
  ) {
    next = {
      ...next,
      typography: {
        ...next.typography,
        fontFamily: nextWs.globalFamily,
        codeFontFamily: nextWs.terminalFamily,
        light: {
          headingColor: nextWs.themeColors.primary.light,
          textColor: nextWs.themeColors.secondary.light,
          mutedColor: nextWs.themeColors.muted.light,
        },
        dark: {
          headingColor: nextWs.themeColors.primary.dark,
          textColor: nextWs.themeColors.secondary.dark,
          mutedColor: nextWs.themeColors.muted.dark,
        },
      },
    };
    changed = true;
  }

  return {
    changed,
    next: changed ? normalizeAppearanceConfig(next) : prevAppearance,
  };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Unexpected FileReader result"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function normalizeDialMode(raw: unknown): PrismuxDialMode {
  if (raw === "oracle" || raw === "review" || raw === "agent") {
    return raw;
  }
  return "agent";
}

function extractAppearanceConfigFromDaemonPayload(
  raw: Record<string, unknown>,
  fallback: AppearanceConfig,
): {
  appearance: AppearanceConfig;
  wallpaperPatch: Partial<WallpaperSettingsState> | null;
  wallpaperMigrated: boolean;
} {
  const { ok: _ok, recoveredFromCorruption: _recovered, wallpaper, ...rest } = raw;
  const appearance = normalizeAppearanceConfig(
    rest as DeepPartialAppearanceConfig,
    fallback,
  );
  if (!isPlainRecord(wallpaper)) {
    return { appearance, wallpaperPatch: null, wallpaperMigrated: false };
  }
  const rawPatch = wallpaper as Partial<WallpaperSettingsState>;
  const wallpaperPatch = normalizeWallpaperSettingsPatch(rawPatch);
  const wallpaperMigrated =
    wallpaperPatch.wallpaperOpacity !== rawPatch.wallpaperOpacity ||
    wallpaperPatch.scrim !== rawPatch.scrim ||
    wallpaperPatch.selectedId !== rawPatch.selectedId;
  return { appearance, wallpaperPatch, wallpaperMigrated };
}

const PrismuxRuntimeContext = createContext<PrismuxRuntimeContextValue | null>(null);

export interface PrismuxRuntimeProviderProps {
  readonly router?: AppRouter;
  readonly children: ReactNode;
}

export function PrismuxRuntimeProvider({ router, children }: PrismuxRuntimeProviderProps) {
  const [daemonInfo, setDaemonInfo] = useState<DaemonConnectionInfo>(() =>
    prismuxDaemonClient.getCachedConnectionInfo(),
  );

  const [appearance, setAppearanceState] = useState<AppearanceConfig>(() => {
    const cached = readLocalJson<DeepPartialAppearanceConfig>(APPEARANCE_STORAGE_KEY);
    return normalizeAppearanceConfig(cached, DEFAULT_APPEARANCE_CONFIG);
  });

  const [occluded, setOccluded] = useState<boolean>(() =>
    typeof document !== "undefined" ? document.visibilityState === "hidden" : false,
  );
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [chiefProvider, setChiefProvider] = useState<string>("codex");
  const [dialMode, setDialMode] = useState<PrismuxDialMode>("agent");
  const [reducedTransparency, setReducedTransparency] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
  });

  const appearanceRef = useRef<AppearanceConfig>(appearance);
  appearanceRef.current = appearance;

  const daemonReadyRef = useRef<boolean>(daemonInfo.ready);
  daemonReadyRef.current = daemonInfo.ready;

  const hydratedFromDaemonRef = useRef<boolean>(false);
  const syncingRef = useRef<boolean>(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleDaemonSave = useCallback(
    (nextAppearance: AppearanceConfig, nextWallpaper: WallpaperSettingsState) => {
      writeLocalJson(APPEARANCE_STORAGE_KEY, nextAppearance);
      writeLocalJson(WALLPAPER_STORAGE_KEY, nextWallpaper);
      if (!daemonReadyRef.current || !hydratedFromDaemonRef.current) {
        return;
      }
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void prismuxDaemonClient
          .saveAppearance({
            ...nextAppearance,
            wallpaper: nextWallpaper,
          })
          .catch(() => {
            // Preserve local persistence even if daemon is restarting.
          });
      }, DAEMON_SAVE_DEBOUNCE_MS);
    },
    [],
  );

  const wallpaperStoreRef = useRef<WallpaperStore | null>(null);
  const lastSyncedWallpaperRef = useRef<WallpaperSettingsState | null>(null);

  if (wallpaperStoreRef.current === null) {
    const rawCachedWs = readLocalJson<Partial<WallpaperSettingsState>>(WALLPAPER_STORAGE_KEY);
    const cachedWs = rawCachedWs ? normalizeWallpaperSettingsPatch(rawCachedWs) : null;
    const baseDefaults = createDefaultSettings();
    const mergedInitial: WallpaperSettingsState = {
      ...baseDefaults,
      ...(cachedWs ?? {}),
      glassColor: {
        ...baseDefaults.glassColor,
        ...(cachedWs?.glassColor ?? {}),
      },
      glassSurfacePolicy: {
        ...baseDefaults.glassSurfacePolicy,
        ...(cachedWs?.glassSurfacePolicy ?? {}),
      },
      themeColors: {
        primary: {
          ...baseDefaults.themeColors.primary,
          ...(cachedWs?.themeColors?.primary ?? {}),
        },
        secondary: {
          ...baseDefaults.themeColors.secondary,
          ...(cachedWs?.themeColors?.secondary ?? {}),
        },
        tertiary: {
          ...baseDefaults.themeColors.tertiary,
          ...(cachedWs?.themeColors?.tertiary ?? {}),
        },
        muted: {
          ...baseDefaults.themeColors.muted,
          ...(cachedWs?.themeColors?.muted ?? {}),
        },
      },
    };
    const syncedPatch = appearanceToWallpaperPatch(appearance, mergedInitial);
    const initialSettings: WallpaperSettingsState = {
      ...mergedInitial,
      ...syncedPatch,
    };
    const store = createWallpaperStore({
      settings: initialSettings,
      includeBuiltins: true,
    });
    wallpaperStoreRef.current = store;
    lastSyncedWallpaperRef.current = store.getSnapshot().settings;
  }

  const wallpaperStore = wallpaperStoreRef.current;

  const [wallpaperSelectedId, setWallpaperSelectedId] = useState<string | null>(
    () => wallpaperStore.getSnapshot().settings.selectedId,
  );

  // Sync T3 Code theme polarity whenever AppearanceConfig themeMode or glassBasePolarity changes.
  const syncHostPolarity = useCallback((cfg: AppearanceConfig) => {
    const polarity = resolveBasePolarity(cfg);
    setAppearanceMode(polarity);
  }, []);

  const commitAppearance = useCallback(
    (
      nextOrUpdater: AppearanceConfig | ((prev: AppearanceConfig) => AppearanceConfig),
      options?: { syncT3Polarity?: boolean },
    ) => {
      const prev = appearanceRef.current;
      const rawNext =
        typeof nextOrUpdater === "function" ? nextOrUpdater(prev) : nextOrUpdater;
      const normalized = normalizeAppearanceConfig(rawNext);
      appearanceRef.current = normalized;
      setAppearanceState(normalized);

      if (
        options?.syncT3Polarity ||
        normalized.themeMode !== prev.themeMode ||
        normalized.glassBasePolarity !== prev.glassBasePolarity
      ) {
        syncHostPolarity(normalized);
      }

      if (!syncingRef.current) {
        syncingRef.current = true;
        try {
          const currentWs = wallpaperStore.getSnapshot().settings;
          const patch = appearanceToWallpaperPatch(normalized, currentWs);
          if (Object.keys(patch).length > 0) {
            wallpaperStore.updateSettings(patch);
          }
          lastSyncedWallpaperRef.current = wallpaperStore.getSnapshot().settings;
        } finally {
          syncingRef.current = false;
        }
      }

      scheduleDaemonSave(normalized, wallpaperStore.getSnapshot().settings);
    },
    [scheduleDaemonSave, syncHostPolarity, wallpaperStore],
  );

  const setAppearance = useCallback(
    (next: AppearanceConfig | ((prev: AppearanceConfig) => AppearanceConfig)) => {
      commitAppearance(next);
    },
    [commitAppearance],
  );

  const setThemeMode = useCallback(
    (mode: ThemeMode) => {
      commitAppearance((prev) => setThemeModeWithGlassAutoWake(prev, mode), {
        syncT3Polarity: true,
      });
    },
    [commitAppearance],
  );

  // Subscribe to wallpaperStore changes → mirror shared appearance fields back into AppearanceConfig + persist.
  useEffect(() => {
    const unsubscribe = wallpaperStore.subscribe(() => {
      const snap = wallpaperStore.getSnapshot();
      const nextWs = snap.settings;
      setWallpaperSelectedId((prevId) => (prevId === nextWs.selectedId ? prevId : nextWs.selectedId));

      if (syncingRef.current) {
        lastSyncedWallpaperRef.current = nextWs;
        return;
      }

      const prevWs = lastSyncedWallpaperRef.current ?? nextWs;
      if (nextWs === prevWs) {
        return;
      }
      lastSyncedWallpaperRef.current = nextWs;

      const { changed, next: nextAppearance } = diffWallpaperToAppearance(
        appearanceRef.current,
        prevWs,
        nextWs,
      );
      if (changed) {
        const themeChanged =
          nextAppearance.themeMode !== appearanceRef.current.themeMode ||
          nextAppearance.glassBasePolarity !== appearanceRef.current.glassBasePolarity;
        appearanceRef.current = nextAppearance;
        setAppearanceState(nextAppearance);
        if (themeChanged) {
          syncHostPolarity(nextAppearance);
        }
      }

      scheduleDaemonSave(appearanceRef.current, nextWs);
    });
    return unsubscribe;
  }, [scheduleDaemonSave, syncHostPolarity, wallpaperStore]);

  // Dispose wallpaper store timer cleanly on provider unmount.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      wallpaperStore.dispose();
    };
  }, [wallpaperStore]);

  // Track prefers-reduced-transparency media query for live accessibility fallback.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-transparency: reduce)");
    const update = () => setReducedTransparency(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Ensure T3 Code's `.dark` class matches Prismux appearance polarity before the very first paint
  // (eliminates cold-start white FOUC on Light-OS hosts before Daemon hydration completes).
  useLayoutEffect(() => {
    syncHostPolarity(appearanceRef.current);
  }, [syncHostPolarity]);

  // Apply CSS custom properties & data-pmx-* attributes to document whenever appearance or wallpaper state changes.
  useLayoutEffect(() => {
    const wallpaperActive = Boolean(wallpaperSelectedId);
    applyPrismuxAppearanceToDocument(appearance, {
      wallpaperActive,
      reducedTransparency,
      syncT3DarkClass: false,
    });
    syncBrowserChromeTheme();
    // Defense-in-depth for Issue #4: in non-glass Light/Dark modes, T3 Code's
    // syncBrowserChromeTheme() stamps an inline background-color on html/body
    // that would hide the Z-0 wallpaper stage. Clear it whenever wallpaper is active.
    if (wallpaperActive && !reducedTransparency && typeof document !== "undefined") {
      document.documentElement.style.removeProperty("background-color");
      document.body?.style.removeProperty("background-color");
    }
  }, [appearance, reducedTransparency, wallpaperSelectedId]);

  // Guard against subsequent T3 Code theme mutations re-stamping inline background-color on html/body
  // while a wallpaper is active in Light/Dark/Glass mode.
  useEffect(() => {
    const wallpaperActive = Boolean(wallpaperSelectedId);
    if (!wallpaperActive || reducedTransparency || typeof document === "undefined") {
      return;
    }
    const stripInlineBackground = () => {
      if (document.documentElement.style.getPropertyValue("background-color")) {
        document.documentElement.style.removeProperty("background-color");
      }
      if (document.body?.style.getPropertyValue("background-color")) {
        document.body.style.removeProperty("background-color");
      }
    };
    stripInlineBackground();
    if (typeof MutationObserver === "undefined") {
      return;
    }
    const observer = new MutationObserver(() => {
      stripInlineBackground();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["style"],
      });
    }
    return () => {
      observer.disconnect();
    };
  }, [reducedTransparency, wallpaperSelectedId]);

  // Subscribe to Electron window occlusion + browser document.visibilitychange to enforce 0 FPS pause.
  useEffect(() => {
    let bridgeOccluded = false;
    let docHidden =
      typeof document !== "undefined" ? document.visibilityState === "hidden" : false;

    const recompute = () => {
      const nextOccluded = bridgeOccluded || docHidden;
      setOccluded(nextOccluded);
      wallpaperStore.setOccluded(nextOccluded);
    };

    const handleVisibility = () => {
      docHidden = document.visibilityState === "hidden";
      if (!docHidden) {
        bridgeOccluded = false;
      }
      recompute();
    };

    const handleWindowFocus = () => {
      docHidden =
        typeof document !== "undefined" ? document.visibilityState === "hidden" : false;
      if (!docHidden) {
        bridgeOccluded = false;
      }
      recompute();
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleWindowFocus);
    }

    const prismuxBridge =
      typeof window !== "undefined" ? window.desktopBridge?.prismux : undefined;

    let cancelled = false;
    if (prismuxBridge && typeof prismuxBridge.getWindowOcclusion === "function") {
      void prismuxBridge
        .getWindowOcclusion()
        .then((res) => {
          if (cancelled) return;
          bridgeOccluded = Boolean(res?.occluded);
          recompute();
        })
        .catch(() => {});
    }

    let unsubscribeOcclusion: (() => void) | undefined;
    if (prismuxBridge && typeof prismuxBridge.onWindowOcclusionChange === "function") {
      unsubscribeOcclusion = prismuxBridge.onWindowOcclusionChange((payload) => {
        bridgeOccluded = Boolean(payload?.occluded);
        recompute();
      });
    }

    recompute();
    return () => {
      cancelled = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleWindowFocus);
      }
      unsubscribeOcclusion?.();
    };
  }, [wallpaperStore]);

  const refreshSystemFonts = useCallback(async (forceRefresh = false): Promise<string[]> => {
    try {
      const response = await prismuxDaemonClient.getSystemFonts(forceRefresh);
      const fonts = Array.isArray(response?.fonts) ? response.fonts : [];
      setSystemFonts(fonts);
      return fonts;
    } catch {
      return [];
    }
  }, []);

  const switchChief = useCallback(
    async (next: { provider?: string; dialMode?: PrismuxDialMode }): Promise<void> => {
      const targetProvider = next.provider ?? chiefProvider;
      const targetDialMode = next.dialMode ?? dialMode;
      if (next.provider) {
        setChiefProvider(next.provider);
      }
      if (next.dialMode) {
        setDialMode(next.dialMode);
      }
      try {
        const res = await prismuxDaemonClient.switchChief({
          provider: targetProvider,
          dialMode: targetDialMode,
        });
        if (typeof res?.slot?.provider === "string" && res.slot.provider.trim().length > 0) {
          setChiefProvider(res.slot.provider);
        }
        if (res?.dialMode) {
          setDialMode(normalizeDialMode(res.dialMode));
        }
      } catch {
        // Keep optimistic UI state when daemon is offline or restarting.
      }
    },
    [chiefProvider, dialMode],
  );

  const navigateToSettings = useCallback(
    (section: WallpaperSettingsTabId | "") => {
      const targetPath =
        section === "appearance" ? "/settings/appearance" : "/settings/wallpaper";
      const search =
        section && section !== "appearance" ? ({ tab: section } as never) : undefined;
      if (router) {
        void router.navigate({
          to: targetPath as never,
          ...(search ? { search } : {}),
        });
        return;
      }
      if (typeof window !== "undefined") {
        const query = section && section !== "appearance" ? `?tab=${encodeURIComponent(section)}` : "";
        window.location.hash = `#${targetPath}${query}`;
      }
    },
    [router],
  );

  const wallpaperHost = useMemo<WallpaperHostAdapter>(() => {
    const fetchInventory = async (opts?: {
      forceRefresh?: boolean;
      steamRootOverride?: string;
      customDir?: string;
    }): Promise<WallpaperInventoryResult> => {
      const info = await prismuxDaemonClient.getConnectionInfo(
        Boolean(opts?.forceRefresh) || !daemonReadyRef.current,
      );
      if (info.ready !== daemonReadyRef.current) {
        daemonReadyRef.current = info.ready;
        setDaemonInfo(info);
      }
      if (!info.ready) {
        return {
          wallpapers: createBuiltinWallpapers(),
          steamRoots: [],
          customDir: opts?.customDir ?? "",
          error: null,
        };
      }
      try {
        const shouldRescan =
          Boolean(opts?.forceRefresh) ||
          opts?.steamRootOverride !== undefined ||
          opts?.customDir !== undefined;
        const customDirs =
          opts?.customDir && opts.customDir.trim().length > 0
            ? [opts.customDir.trim()]
            : undefined;
        const res = shouldRescan
          ? await prismuxDaemonClient.rescanWallpapers(customDirs, opts?.steamRootOverride)
          : await prismuxDaemonClient.getWallpaperInventory();
        const items = Array.isArray(res?.items)
          ? res.items.map((item) => mapDaemonWallpaperItem(item, prismuxDaemonClient))
          : [];
        return {
          wallpapers: items,
          steamRoots: Array.isArray(res?.steamRoots) ? res.steamRoots : [],
          customDir: typeof res?.customWallpaperDir === "string" ? res.customWallpaperDir : "",
          error: null,
        };
      } catch (err) {
        return {
          wallpapers: createBuiltinWallpapers(),
          steamRoots: [],
          customDir: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };

    const pickLocalFiles = async (): Promise<WallpaperItem[]> => {
      const bridge = typeof window !== "undefined" ? window.desktopBridge?.prismux : undefined;
      if (!bridge || typeof bridge.pickWallpaperFiles !== "function") {
        return [];
      }
      const paths = await bridge.pickWallpaperFiles();
      if (!Array.isArray(paths) || paths.length === 0) {
        return [];
      }
      const imported: WallpaperItem[] = [];
      for (const filePath of paths) {
        try {
          const res = await prismuxDaemonClient.importWallpaperFile(filePath);
          if (res?.item) {
            imported.push(mapDaemonWallpaperItem(res.item, prismuxDaemonClient));
          }
        } catch {
          // Continue importing remaining selected files.
        }
      }
      if (imported.length > 0) {
        await wallpaperStore.refreshLibrary(adapter, false);
      }
      return imported;
    };

    const importLocalFiles = async (files: FileList | File[]): Promise<WallpaperItem[]> => {
      const list = Array.from(files);
      if (list.length === 0) return [];
      const info = await prismuxDaemonClient.getConnectionInfo();
      const imported: WallpaperItem[] = [];

      for (const file of list) {
        if (info.ready) {
          try {
            const base64 = await readFileAsBase64(file);
            const res = await prismuxDaemonClient.importWallpaperFile({
              fileName: file.name,
              base64,
            });
            if (res?.item) {
              imported.push(mapDaemonWallpaperItem(res.item, prismuxDaemonClient));
            }
          } catch {
            // Skip failed item while preserving others.
          }
        } else {
          const isVideo = file.type.startsWith("video/");
          const blobUrl = URL.createObjectURL(file);
          imported.push({
            id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title: file.name.replace(/\.[^.]+$/, ""),
            type: isVideo ? "video" : "image",
            source: "custom",
            previewUrl: isVideo ? null : blobUrl,
            mediaUrl: blobUrl,
            filePath: null,
            width: null,
            height: null,
            orientation: "unknown",
            contentRating: "everyone",
          });
        }
      }
      return imported;
    };

    const selectDirectory = async (): Promise<string | null> => {
      const bridge = typeof window !== "undefined" ? window.desktopBridge?.prismux : undefined;
      if (!bridge || typeof bridge.pickWallpaperDirectory !== "function") {
        return null;
      }
      return bridge.pickWallpaperDirectory();
    };

    const querySystemFonts = async (forceRefresh?: boolean): Promise<SystemFontsResult> => {
      try {
        const res = await prismuxDaemonClient.getSystemFonts(Boolean(forceRefresh));
        const fonts = Array.isArray(res?.fonts) ? res.fonts : [];
        setSystemFonts(fonts);
        return {
          fonts,
          approximate: Boolean(res?.approximate),
          error: null,
        };
      } catch (err) {
        return {
          fonts: [],
          approximate: true,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };

    const adapter: WallpaperHostAdapter = {
      listWallpapers: fetchInventory,
      refreshSteamLibrary: (steamRootOverride) =>
        fetchInventory({
          forceRefresh: true,
          ...(steamRootOverride !== undefined ? { steamRootOverride } : {}),
        }),
      pickLocalFiles,
      importLocalFiles,
      selectDirectory,
      openSettingsSection: navigateToSettings,
      querySystemFonts,
      saveSettings: (settings) => {
        scheduleDaemonSave(appearanceRef.current, settings);
      },
      appearanceBridge: {
        onThemeModeChange: (mode) => {
          setThemeMode(mode);
        },
      },
    };

    return adapter;
  }, [navigateToSettings, scheduleDaemonSave, setThemeMode, wallpaperStore]);

  // Initial asynchronous hydration from Prismux Daemon (/v1/appearance, /v1/wallpapers/inventory, /v1/chief, /v1/system/fonts).
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const hasDesktopBridge =
        typeof window !== "undefined" &&
        typeof window.desktopBridge?.prismux?.getDaemonInfo === "function";

      let info = await prismuxDaemonClient.getConnectionInfo(true);
      // On Windows cold boot, PrismuxDaemonService takes ~1.0–1.6s (longer under AV scan)
      // to spawn and pass /health. Wait in a bounded loop instead of permanently staying offline.
      if (!info.ready && hasDesktopBridge) {
        const maxRetries = 40;
        for (let attempt = 0; attempt < maxRetries && !cancelled && !info.ready; attempt += 1) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 300);
          });
          if (cancelled) return;
          info = await prismuxDaemonClient.getConnectionInfo(true);
        }
      }

      if (cancelled) return;
      setDaemonInfo(info);
      daemonReadyRef.current = info.ready;

      if (!info.ready) {
        hydratedFromDaemonRef.current = true;
        return;
      }

      // 1. Hydrate appearance + wallpaper settings from Daemon.
      let migratedWallpaperConfig = false;
      try {
        const raw = await prismuxDaemonClient.getAppearance();
        if (!cancelled && isPlainRecord(raw)) {
          const {
            appearance: remoteAppearance,
            wallpaperPatch,
            wallpaperMigrated,
          } = extractAppearanceConfigFromDaemonPayload(raw, appearanceRef.current);
          migratedWallpaperConfig = wallpaperMigrated;
          syncingRef.current = true;
          try {
            appearanceRef.current = remoteAppearance;
            setAppearanceState(remoteAppearance);
            syncHostPolarity(remoteAppearance);

            const currentWs = wallpaperStore.getSnapshot().settings;
            const mergedPatch: Partial<WallpaperSettingsState> = {
              ...(wallpaperPatch ?? {}),
              ...appearanceToWallpaperPatch(remoteAppearance, {
                ...currentWs,
                ...(wallpaperPatch ?? {}),
              }),
            };
            if (Object.keys(mergedPatch).length > 0) {
              wallpaperStore.updateSettings(mergedPatch);
            }
            lastSyncedWallpaperRef.current = wallpaperStore.getSnapshot().settings;
            writeLocalJson(APPEARANCE_STORAGE_KEY, remoteAppearance);
            writeLocalJson(WALLPAPER_STORAGE_KEY, wallpaperStore.getSnapshot().settings);
          } finally {
            syncingRef.current = false;
          }
        }
      } catch {
        // Keep local cache if daemon appearance endpoint isn't ready yet.
      } finally {
        hydratedFromDaemonRef.current = true;
      }

      if (cancelled) return;

      // Persist self-healed legacy wallpaper values (e.g. wallpaperOpacity: 100 → 0, scrim: 35 → 0.35)
      // back to Daemon so future boots start cleanly.
      if (migratedWallpaperConfig) {
        scheduleDaemonSave(appearanceRef.current, wallpaperStore.getSnapshot().settings);
      }

      // 2. Hydrate wallpaper inventory, chief thread status, and system fonts in parallel.
      void wallpaperStore.refreshLibrary(wallpaperHost, false);
      void wallpaperStore.refreshSystemFonts(wallpaperHost, false);

      void prismuxDaemonClient
        .getChief()
        .then((chief) => {
          if (cancelled) return;
          if (typeof chief?.slot?.provider === "string" && chief.slot.provider.trim().length > 0) {
            setChiefProvider(chief.slot.provider);
          }
          if (chief?.dialMode) {
            setDialMode(normalizeDialMode(chief.dialMode));
          }
        })
        .catch(() => {});
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [scheduleDaemonSave, syncHostPolarity, wallpaperHost, wallpaperStore]);

  const contextValue = useMemo<PrismuxRuntimeContextValue>(
    () => ({
      daemon: prismuxDaemonClient,
      daemonInfo,
      appearance,
      setAppearance,
      setThemeMode,
      wallpaperStore,
      wallpaperHost,
      occluded,
      systemFonts,
      refreshSystemFonts,
      chiefProvider,
      dialMode,
      switchChief,
    }),
    [
      daemonInfo,
      appearance,
      setAppearance,
      setThemeMode,
      wallpaperStore,
      wallpaperHost,
      occluded,
      systemFonts,
      refreshSystemFonts,
      chiefProvider,
      dialMode,
      switchChief,
    ],
  );

  return (
    <PrismuxRuntimeContext.Provider value={contextValue}>
      {children}
    </PrismuxRuntimeContext.Provider>
  );
}

export function usePrismuxRuntime(): PrismuxRuntimeContextValue {
  const ctx = useContext(PrismuxRuntimeContext);
  if (!ctx) {
    throw new Error("usePrismuxRuntime must be used inside <PrismuxRuntimeProvider />");
  }
  return ctx;
}
