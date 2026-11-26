import type {
  ChiefProviderKind,
  ChiefThreadSlotState,
  T3BridgeStatus
} from "./chief.js";
import type { DialMode, HandoffRequest, HandoffResult } from "./handoff.js";
import type { ApprovalGuideCard, RiskLevel } from "./hooks.js";
import type {
  MemoryQueryRequest,
  MemoryQueryResponse,
  MemoryUpsertInput
} from "./memory.js";
import type { InstalledPluginRecord } from "./plugin.js";

export const APPEARANCE_THEME_MODES = [
  "light",
  "dark",
  "liquid-glass"
] as const;

export type AppearanceThemeMode = (typeof APPEARANCE_THEME_MODES)[number];

export const LAYOUT_PRESET_IDS = [
  "secretary-standby",
  "multi-agent-coding"
] as const;

export type LayoutPresetId = (typeof LAYOUT_PRESET_IDS)[number];

export interface GlassRegionConfig {
  fill: number;
  blur: number;
}

export const GLASS_PRESET_KINDS = [
  "off",
  "light",
  "balanced",
  "clear",
  "custom"
] as const;

export type GlassPresetKind = (typeof GLASS_PRESET_KINDS)[number];

export interface FourRegionGlassSettings {
  sidebar: GlassRegionConfig;
  content: GlassRegionConfig;
  overlay: GlassRegionConfig;
  control: GlassRegionConfig;
  preset: GlassPresetKind;
  glassTint?: string;
  fresnelRimOpacity: number;
}

export interface WallpaperSettings {
  sourceType: "none" | "scene" | "web" | "video" | "image";
  sourcePath?: string;
  steamWorkshopId?: string;
  veilOpacity: number;
  vignetteStrength: number;
  blurPx: number;
  fpsLimit: number;
  pauseWhenOccluded: boolean;
  audioReactive: boolean;
}

export interface TypographyColorSettings {
  lightTextColor: string;
  darkTextColor: string;
  lightMutedColor: string;
  darkMutedColor: string;
  controlFgColor: string;
  fontFamily?: string;
  fontWeight?: number;
}

export const DEFAULT_FOUR_REGION_GLASS_SETTINGS: FourRegionGlassSettings = {
  sidebar: { fill: 72, blur: 18 },
  content: { fill: 84, blur: 18 },
  overlay: { fill: 92, blur: 20 },
  control: { fill: 76, blur: 14 },
  preset: "balanced",
  fresnelRimOpacity: 0.45
};

export const DEFAULT_WALLPAPER_SETTINGS: WallpaperSettings = {
  sourceType: "none",
  veilOpacity: 0.32,
  vignetteStrength: 0.2,
  blurPx: 0,
  fpsLimit: 60,
  pauseWhenOccluded: true,
  audioReactive: false
};

export const DEFAULT_TYPOGRAPHY_COLOR_SETTINGS: TypographyColorSettings = {
  lightTextColor: "#141821",
  darkTextColor: "#eef2f8",
  lightMutedColor: "#5b6472",
  darkMutedColor: "#98a2b3",
  controlFgColor: "#ffffff"
};

export interface LiquidGlassSettings {
  enabled: boolean;
  refractionBlurPx: number;
  fresnelRimOpacity: number;
  vignetteStrength: number;
  lightFontColor?: string;
  darkFontColor?: string;
  fontFamily?: string;
  fontWeight?: number;
  regions?: FourRegionGlassSettings;
  wallpaper?: WallpaperSettings;
  typography?: TypographyColorSettings;
}

export const DEFAULT_LIQUID_GLASS_SETTINGS: LiquidGlassSettings = {
  enabled: true,
  refractionBlurPx: 18,
  fresnelRimOpacity: 0.45,
  vignetteStrength: 0.2,
  regions: DEFAULT_FOUR_REGION_GLASS_SETTINGS,
  wallpaper: DEFAULT_WALLPAPER_SETTINGS,
  typography: DEFAULT_TYPOGRAPHY_COLOR_SETTINGS
};

export interface WorkbenchPresetConfig {
  id: LayoutPresetId | (string & {});
  name: string;
  themeMode: AppearanceThemeMode;
  glass: LiquidGlassSettings;
  wallpaper?: WallpaperSettings;
  typography?: TypographyColorSettings;
}

export type IslandCardKind =
  | "approval"
  | "email"
  | "factory_complete"
  | "notification";

export type IslandCardAction =
  | "approve"
  | "reject"
  | "open_workbench"
  | "dismiss";

export interface IslandHookEvent {
  cardId: string;
  kind: IslandCardKind;
  title: string;
  subtitle?: string;
  riskLevel?: RiskLevel;
  approvalGuide?: ApprovalGuideCard;
  deepLink?: string;
  actions: IslandCardAction[];
  createdAt: number;
}

export interface IslandHookResponse {
  cardId: string;
  action: IslandCardAction;
  respondedAt: number;
}

export interface PtyReplayFrame {
  ptyId: string;
  seq: number;
  timestamp: number;
  data: string;
}

export interface PtyReplayResult {
  frames: PtyReplayFrame[];
  oldestSeq: number;
  latestSeq: number;
  droppedBytes: number;
  bufferBytes: number;
}

export interface PtySessionDescriptor {
  ptyId: string;
  cwd: string;
  group: "default" | "agent-scratch";
  worktreeBranch?: string;
  alive: boolean;
  bufferBytes: number;
}

export interface UsageLedgerSummary {
  machineId: string;
  providerId: string;
  todayTokens: number;
  weekTokens: number;
  quotaUsedRatio?: number;
  estimatedCostUsd?: number;
}

export interface RpcMethodMap {
  "pty.list": {
    params: Record<string, never>;
    result: { sessions: PtySessionDescriptor[] };
  };
  "pty.spawn": {
    params: {
      ptyId?: string;
      cwd?: string;
      command?: string;
      args?: string[];
      group?: "default" | "agent-scratch";
      worktreeBranch?: string;
    };
    result: { session: PtySessionDescriptor };
  };
  "pty.write": {
    params: { ptyId: string; data: string };
    result: { accepted: boolean };
  };
  "pty.resize": {
    params: { ptyId: string; cols: number; rows: number };
    result: { resized: boolean };
  };
  "pty.kill": {
    params: { ptyId: string; signal?: string };
    result: { killed: boolean };
  };
  "pty.replay": {
    params: { ptyId: string; fromSeq?: number };
    result: PtyReplayResult;
  };
  "pty.scanScratch": {
    params: { repoRoot: string };
    result: {
      repoRoot: string;
      discoveredWorktrees: string[];
      sessions: PtySessionDescriptor[];
    };
  };
  "pty.adoptScratch": {
    params: { ptyId: string; projectName?: string };
    result: { adoptedThreadId: string; session: PtySessionDescriptor };
  };
  "chief.status": {
    params: Record<string, never>;
    result: { slot: ChiefThreadSlotState };
  };
  "chief.switchProvider": {
    params: {
      provider: ChiefProviderKind;
      model?: string;
      reasoningEffort?: string;
      defaultEffort?: string;
      secretaryName?: string;
    };
    result: { slot: ChiefThreadSlotState };
  };
  "t3.status": {
    params: Record<string, never>;
    result: { status: T3BridgeStatus };
  };
  "daemon.shutdown": {
    params: { reason?: string };
    result: { shuttingDown: boolean };
  };
  "handoff.execute": {
    params: HandoffRequest;
    result: HandoffResult;
  };
  "dial.setMode": {
    params: { threadId: string; mode: DialMode };
    result: { threadId: string; mode: DialMode };
  };
  "memory.query": {
    params: MemoryQueryRequest;
    result: MemoryQueryResponse;
  };
  "memory.upsert": {
    params: MemoryUpsertInput;
    result: { id: string; updatedAt: number };
  };
  "hooks.decideApproval": {
    params: { requestId: string; allow: boolean; reason?: string };
    result: { requestId: string; accepted: boolean };
  };
  "plugins.list": {
    params: Record<string, never>;
    result: { plugins: InstalledPluginRecord[] };
  };
  "plugins.toggle": {
    params: { pluginId: string; enabled: boolean };
    result: { pluginId: string; enabled: boolean };
  };
  "usage.summary": {
    params: Record<string, never>;
    result: { entries: UsageLedgerSummary[] };
  };
  "ui.visibilityChanged": {
    params: { occluded: boolean };
    result: { acknowledged: boolean };
  };
}

export interface RpcRequestEnvelope<M extends keyof RpcMethodMap = keyof RpcMethodMap> {
  id: string;
  method: M;
  params: RpcMethodMap[M]["params"];
}

export type RpcResponseEnvelope<M extends keyof RpcMethodMap = keyof RpcMethodMap> =
  | {
      id: string;
      ok: true;
      result: RpcMethodMap[M]["result"];
    }
  | {
      id: string;
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };
