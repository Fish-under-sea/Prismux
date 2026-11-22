import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import {
  BRAND,
  CHIEF_PROVIDER_KINDS,
  type ChiefProviderKind,
  type ChiefSwitchRecord,
  type ChiefThreadSlotState
} from "@prismux/protocol";
import type { T3RpcClient } from "../t3/T3RpcClient.js";

export const DEFAULT_CHIEF_MCP_SERVERS = [
  `${BRAND.appSlug}-memory`,
  `${BRAND.appSlug}-orchestrator`
] as const;

export const CHIEF_MARKER_FILENAME = `.${BRAND.appSlug}-chief.json`;
export const CHIEF_README_FILENAME = "README.md";
export const CHIEF_SLOT_FILENAME = "chief-slot.json";

export interface ChiefThreadManagerOptions {
  dataDir: string;
  defaultProvider?: ChiefProviderKind;
  defaultModel?: string;
  rpcClient?: T3RpcClient;
}

interface ChiefWorkspaceMarker {
  protected: true;
  role: "chief-supervisor-workspace";
  appName: string;
  appSlug: string;
  injectedMcpServers: string[];
  createdAt: number;
  note: string;
}

function isChiefProviderKind(value: unknown): value is ChiefProviderKind {
  return (
    typeof value === "string" &&
    (CHIEF_PROVIDER_KINDS as readonly string[]).includes(value)
  );
}

function assertValidProvider(provider: unknown): ChiefProviderKind {
  if (!isChiefProviderKind(provider)) {
    throw new Error(
      `Invalid Chief provider "${String(provider)}". Expected one of: ${CHIEF_PROVIDER_KINDS.join(", ")}.`
    );
  }
  return provider;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMcpServers(existing?: unknown): string[] {
  const result: string[] = [...DEFAULT_CHIEF_MCP_SERVERS];
  if (Array.isArray(existing)) {
    for (const item of existing) {
      if (typeof item === "string" && item.length > 0 && !result.includes(item)) {
        result.push(item);
      }
    }
  }
  return result;
}

function cloneSlotState(state: ChiefThreadSlotState): ChiefThreadSlotState {
  return {
    threadId: state.threadId,
    workspacePath: state.workspacePath,
    activeProvider: state.activeProvider,
    ...(state.model !== undefined ? { model: state.model } : {}),
    injectedMcpServers: [...state.injectedMcpServers],
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    switchHistory: state.switchHistory.map((record) => ({
      ...(record.fromProvider !== undefined
        ? { fromProvider: record.fromProvider }
        : {}),
      toProvider: record.toProvider,
      ...(record.model !== undefined ? { model: record.model } : {}),
      switchedAt: record.switchedAt
    }))
  };
}

function writeFileIfAbsent(filePath: string, content: string): void {
  if (existsSync(filePath)) {
    return;
  }
  try {
    writeFileSync(filePath, content, { encoding: "utf8", flag: "wx" });
  } catch (error: unknown) {
    if (
      isRecord(error) &&
      typeof error.code === "string" &&
      error.code === "EEXIST"
    ) {
      return;
    }
    throw error;
  }
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
  const parentDir = dirname(filePath);
  mkdirSync(parentDir, { recursive: true });
  const tempPath = join(
    parentDir,
    `.${CHIEF_SLOT_FILENAME}.${process.pid}.${randomUUID()}.tmp`
  );
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;

  try {
    writeFileSync(tempPath, serialized, "utf8");
    renameSync(tempPath, filePath);
  } catch (error: unknown) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failure for temp file.
    }
    throw error;
  }
}

function parseSwitchHistory(rawHistory: unknown): ChiefSwitchRecord[] {
  if (!Array.isArray(rawHistory)) {
    return [];
  }
  const records: ChiefSwitchRecord[] = [];
  for (const item of rawHistory) {
    if (!isRecord(item) || !isChiefProviderKind(item.toProvider)) {
      continue;
    }
    const switchedAt =
      typeof item.switchedAt === "number" && Number.isFinite(item.switchedAt)
        ? item.switchedAt
        : Date.now();
    records.push({
      ...(isChiefProviderKind(item.fromProvider)
        ? { fromProvider: item.fromProvider }
        : {}),
      toProvider: item.toProvider,
      ...(typeof item.model === "string" && item.model.length > 0
        ? { model: item.model }
        : {}),
      switchedAt
    });
  }
  return records;
}

export class ChiefThreadManager {
  readonly dataDir: string;
  readonly workspacePath: string;
  readonly slotFilePath: string;
  private readonly defaultProvider: ChiefProviderKind;
  private readonly defaultModel: string | undefined;
  private readonly rpcClient: T3RpcClient | undefined;
  private slot: ChiefThreadSlotState | undefined;

  constructor(options: ChiefThreadManagerOptions) {
    this.dataDir = resolve(options.dataDir);
    this.workspacePath = join(this.dataDir, BRAND.chiefWorkspaceDir);
    this.slotFilePath = join(this.dataDir, CHIEF_SLOT_FILENAME);
    this.defaultProvider = assertValidProvider(
      options.defaultProvider ?? "claude-code"
    );
    this.defaultModel = options.defaultModel;
    this.rpcClient = options.rpcClient;
  }

  /**
   * Initializes and protects `<dataDir>/chief-workspace` without overwriting
   * existing user-authored files.
   */
  ensureWorkspace(): string {
    mkdirSync(this.workspacePath, { recursive: true });

    const markerPath = join(this.workspacePath, CHIEF_MARKER_FILENAME);
    const marker: ChiefWorkspaceMarker = {
      protected: true,
      role: "chief-supervisor-workspace",
      appName: BRAND.appName,
      appSlug: BRAND.appSlug,
      injectedMcpServers: [...DEFAULT_CHIEF_MCP_SERVERS],
      createdAt: Date.now(),
      note: "Protected Chief Supervisor coordination workspace. Do not delete or purge."
    };
    writeFileIfAbsent(markerPath, `${JSON.stringify(marker, null, 2)}\n`);

    const readmePath = join(this.workspacePath, CHIEF_README_FILENAME);
    const readmeContent = [
      `# ${BRAND.appName} Chief Supervisor Workspace`,
      "",
      "This directory is the protected coordination workspace for the privileged Chief Thread Slot.",
      `Default injected loopback MCP servers: ${DEFAULT_CHIEF_MCP_SERVERS.map((s) => `\`${s}\``).join(", ")}.`,
      "Existing files in this directory are preserved across daemon restarts and provider hot-switches.",
      ""
    ].join("\n");
    writeFileIfAbsent(readmePath, readmeContent);

    return this.workspacePath;
  }

  async init(): Promise<ChiefThreadSlotState> {
    this.ensureWorkspace();

    if (existsSync(this.slotFilePath)) {
      const loaded = this.readSlotFromDisk();
      this.slot = loaded;
      return cloneSlotState(loaded);
    }

    const now = Date.now();
    const initialSlot: ChiefThreadSlotState = {
      threadId: `chief-${randomUUID()}`,
      workspacePath: this.workspacePath,
      activeProvider: this.defaultProvider,
      ...(this.defaultModel !== undefined ? { model: this.defaultModel } : {}),
      injectedMcpServers: [...DEFAULT_CHIEF_MCP_SERVERS],
      createdAt: now,
      updatedAt: now,
      switchHistory: []
    };

    writeJsonAtomic(this.slotFilePath, initialSlot);
    this.slot = initialSlot;
    return cloneSlotState(initialSlot);
  }

  getSlot(): ChiefThreadSlotState {
    if (this.slot === undefined) {
      throw new Error(
        "ChiefThreadManager is not initialized. Call init() before accessing the slot."
      );
    }
    return cloneSlotState(this.slot);
  }

  async switchProvider(
    provider: ChiefProviderKind,
    model?: string
  ): Promise<ChiefThreadSlotState> {
    if (this.slot === undefined) {
      throw new Error(
        "ChiefThreadManager is not initialized. Call init() before switching providers."
      );
    }

    const nextProvider = assertValidProvider(provider);
    const normalizedModel =
      model !== undefined && model.length > 0 ? model : undefined;
    const now = Date.now();

    const switchRecord: ChiefSwitchRecord = {
      fromProvider: this.slot.activeProvider,
      toProvider: nextProvider,
      ...(normalizedModel !== undefined ? { model: normalizedModel } : {}),
      switchedAt: now
    };

    const nextSlot: ChiefThreadSlotState = {
      threadId: this.slot.threadId,
      workspacePath: this.slot.workspacePath,
      activeProvider: nextProvider,
      ...(normalizedModel !== undefined ? { model: normalizedModel } : {}),
      injectedMcpServers: normalizeMcpServers(this.slot.injectedMcpServers),
      createdAt: this.slot.createdAt,
      updatedAt: now,
      switchHistory: [...this.slot.switchHistory, switchRecord]
    };

    writeJsonAtomic(this.slotFilePath, nextSlot);
    this.slot = nextSlot;

    if (this.rpcClient?.isConnected() === true) {
      await this.rpcClient.ensureChiefThread(
        nextSlot.workspacePath,
        nextSlot.activeProvider,
        nextSlot.model
      );
    }

    return cloneSlotState(nextSlot);
  }

  private readSlotFromDisk(): ChiefThreadSlotState {
    const rawText = readFileSync(this.slotFilePath, "utf8");
    const parsed: unknown = JSON.parse(rawText);
    if (!isRecord(parsed)) {
      throw new Error(
        `Corrupted Chief slot state at ${this.slotFilePath}: expected JSON object.`
      );
    }

    const threadId =
      typeof parsed.threadId === "string" && parsed.threadId.length > 0
        ? parsed.threadId
        : `chief-${randomUUID()}`;
    const workspacePath =
      typeof parsed.workspacePath === "string" && parsed.workspacePath.length > 0
        ? parsed.workspacePath
        : this.workspacePath;
    const activeProvider = isChiefProviderKind(parsed.activeProvider)
      ? parsed.activeProvider
      : this.defaultProvider;
    const model =
      typeof parsed.model === "string" && parsed.model.length > 0
        ? parsed.model
        : undefined;
    const now = Date.now();
    const createdAt =
      typeof parsed.createdAt === "number" && Number.isFinite(parsed.createdAt)
        ? parsed.createdAt
        : now;
    const updatedAt =
      typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
        ? parsed.updatedAt
        : createdAt;

    return {
      threadId,
      workspacePath,
      activeProvider,
      ...(model !== undefined ? { model } : {}),
      injectedMcpServers: normalizeMcpServers(parsed.injectedMcpServers),
      createdAt,
      updatedAt,
      switchHistory: parseSwitchHistory(parsed.switchHistory)
    };
  }
}
