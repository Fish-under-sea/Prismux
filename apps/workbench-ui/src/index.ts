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
 * Legacy shell state factory retained for backward compatibility across M1-M4 packages.
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

// M4 Pure Logic & Theme/Layout Engines
export * from "./logic/emptyInputContinue.js";
export * from "./logic/reasoningThemeTokens.js";
export * from "./logic/navAndCommandStore.js";
export * from "./logic/usageFormatting.js";
export * from "./logic/approvalTranslator.js";
export * from "./logic/pluginMarketCatalog.js";
export * from "./logic/visibilityBridge.js";
export * from "./theme/themeEngine.js";
export * from "./layout/splitTree.js";

// M4 React 19 UI Components & Root Workbench App
export * from "./components/ApprovalGuidePanel.js";
export * from "./components/ReasoningEffortCard.js";
export * from "./components/UsageLedgerBar.js";
export * from "./components/NavAndCommandOrder.js";
export * from "./components/PluginMarketModal.js";
export * from "./components/FirstRunWizard.js";
export * from "./components/CelestialThemeCapsule.js";
export * from "./components/ThemeBackgroundPanel.js";
export * from "./components/WallpaperViewport.js";
export * from "./components/SplitWorkspace.js";
export * from "./components/FloatingCapsules.js";
export { App, type WorkbenchAppProps } from "./App.js";
