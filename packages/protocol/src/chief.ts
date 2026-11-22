export const CHIEF_PROVIDER_KINDS = [
  "claude-code",
  "codex",
  "antigravity",
  "opencode",
  "acp"
] as const;

export type ChiefProviderKind = (typeof CHIEF_PROVIDER_KINDS)[number];

export interface ChiefSwitchRecord {
  fromProvider?: ChiefProviderKind;
  toProvider: ChiefProviderKind;
  model?: string;
  switchedAt: number;
}

export interface ChiefThreadSlotState {
  threadId: string;
  workspacePath: string;
  activeProvider: ChiefProviderKind;
  model?: string;
  injectedMcpServers: string[];
  createdAt: number;
  updatedAt: number;
  switchHistory: ChiefSwitchRecord[];
}

export type T3SupervisorState =
  | "stopped"
  | "starting"
  | "running"
  | "restarting"
  | "failed";

export interface T3BridgeStatus {
  supervisorState: T3SupervisorState;
  rpcConnected: boolean;
  wsUrl: string;
  protocolVersion: string;
  pid?: number;
  restartCount: number;
  lastError?: string;
}

export interface DaemonPairingInfo {
  pairingCode: string;
  expiresAt: number;
  daemonUrl: string;
}

export interface DaemonHealthResponse {
  ok: boolean;
  headless: boolean;
  version: string;
  t3Connected: boolean;
  supervisorState: T3SupervisorState;
  activeProvider: ChiefProviderKind;
  ptyCount: number;
  uptimeMs: number;
}
