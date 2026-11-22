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

export interface LiquidGlassSettings {
  enabled: boolean;
  refractionBlurPx: number;
  fresnelRimOpacity: number;
  vignetteStrength: number;
  followFishDockTheme: boolean;
  lightFontColor?: string;
  darkFontColor?: string;
  fontFamily?: string;
  fontWeight?: number;
}

export const DEFAULT_LIQUID_GLASS_SETTINGS: LiquidGlassSettings = {
  enabled: true,
  refractionBlurPx: 18,
  fresnelRimOpacity: 0.45,
  vignetteStrength: 0.2,
  followFishDockTheme: false
};

export interface WorkbenchPresetConfig {
  id: LayoutPresetId | (string & {});
  name: string;
  themeMode: AppearanceThemeMode;
  glass: LiquidGlassSettings;
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
  "pty.replay": {
    params: { ptyId: string; fromSeq?: number };
    result: { frames: PtyReplayFrame[] };
  };
  "pty.adoptScratch": {
    params: { ptyId: string; projectName?: string };
    result: { adoptedThreadId: string; session: PtySessionDescriptor };
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
