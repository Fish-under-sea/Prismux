import {
  APPEARANCE_THEME_MODES,
  BRAND,
  DEFAULT_LIQUID_GLASS_SETTINGS,
  LAYOUT_PRESET_IDS,
  type AppearanceThemeMode,
  type LayoutPresetId,
  type LiquidGlassSettings,
  type WorkbenchPresetConfig
} from "@prismux/protocol";

export const WORKBENCH_UI_MILESTONE = "M4" as const;

export type { AppearanceThemeMode, LayoutPresetId, LiquidGlassSettings, WorkbenchPresetConfig };
export { APPEARANCE_THEME_MODES, DEFAULT_LIQUID_GLASS_SETTINGS, LAYOUT_PRESET_IDS };

export interface WallpaperLayerState {
  engine: "webwallgl" | "video" | "web" | "static-fallback";
  occluded: boolean;
  targetFps: number;
}

export interface WorkbenchShellState {
  appName: string;
  themeMode: AppearanceThemeMode;
  layoutPreset: LayoutPresetId;
  glass: LiquidGlassSettings;
  wallpaper: WallpaperLayerState;
  /** Visual layer is strictly host-side and incurs 0 LLM token overhead. */
  llmTokenOverhead: 0;
}

export const DEFAULT_WORKBENCH_SHELL_STATE: WorkbenchShellState = {
  appName: BRAND.appName,
  themeMode: "liquid-glass",
  layoutPreset: "secretary-standby",
  glass: DEFAULT_LIQUID_GLASS_SETTINGS,
  wallpaper: {
    engine: "webwallgl",
    occluded: false,
    targetFps: 60
  },
  llmTokenOverhead: 0
};

/**
 * M1 placeholder state factory. Milestone M4 mounts the React 19 + Vite workbench,
 * binary split tree, floating glass capsules, WebWallGL viewport, and built-in panels.
 */
export function createWorkbenchShellPlaceholder(
  overrides?: Partial<Pick<WorkbenchShellState, "themeMode" | "layoutPreset">>
): WorkbenchShellState {
  return {
    ...DEFAULT_WORKBENCH_SHELL_STATE,
    themeMode: overrides?.themeMode ?? DEFAULT_WORKBENCH_SHELL_STATE.themeMode,
    layoutPreset:
      overrides?.layoutPreset ?? DEFAULT_WORKBENCH_SHELL_STATE.layoutPreset
  };
}
