import { join } from "node:path";
import { CordisPluginHost } from "@prismux/cordis-kernel";
import { SqliteMemoryStoreSkeleton } from "@prismux/memory-core";
import { BRAND } from "@prismux/protocol";
import { SyncVaultEngine } from "@prismux/sync-vault";
import { HandoffEngine } from "./handoff/HandoffEngine.js";
import { LifecycleHookBus } from "./hooks/LifecycleHookBus.js";
import { PersistentPtyPool } from "./pty/PersistentPtyPool.js";
import { WorktreeSandbox } from "./sandbox/WorktreeSandbox.js";
import { OvernightFactory } from "./workflows/OvernightFactory.js";

export * from "./pty/PersistentPtyPool.js";
export * from "./handoff/HandoffEngine.js";
export * from "./hooks/LifecycleHookBus.js";
export * from "./sandbox/WorktreeSandbox.js";
export * from "./workflows/OvernightFactory.js";

const HOST_POLLUTING_ENV_KEYS = [
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ATTACH_CONSOLE"
] as const;

/**
 * Strips host-polluting Electron environment variables before spawning provider sessions or sub-shells.
 */
export function sanitizeProviderEnv(
  env: Record<string, string | undefined>
): Record<string, string> {
  const cleaned: Record<string, string> = {};
  const blocked = new Set<string>(HOST_POLLUTING_ENV_KEYS);
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !blocked.has(key)) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

export interface DaemonStartOptions {
  headless: boolean;
  dataDir: string;
  machineId?: string;
}

export class PrismuxDaemon {
  readonly options: DaemonStartOptions;
  readonly ptyPool: PersistentPtyPool;
  readonly handoffEngine: HandoffEngine;
  readonly hookBus: LifecycleHookBus;
  readonly sandbox: WorktreeSandbox;
  readonly overnightFactory: OvernightFactory;
  readonly pluginHost: CordisPluginHost;
  readonly memoryStore: SqliteMemoryStoreSkeleton;
  readonly syncVault: SyncVaultEngine;
  private running = false;

  constructor(options: DaemonStartOptions) {
    this.options = options;
    this.ptyPool = new PersistentPtyPool();
    this.handoffEngine = new HandoffEngine();
    this.hookBus = new LifecycleHookBus();
    this.sandbox = new WorktreeSandbox();
    this.overnightFactory = new OvernightFactory();
    this.pluginHost = new CordisPluginHost("daemon");
    this.memoryStore = new SqliteMemoryStoreSkeleton({
      dbPath: join(options.dataDir, "data", "memory.db"),
      machineId: options.machineId ?? "local",
      embeddingDimensions: 768,
      enableWal: true
    });
    this.syncVault = new SyncVaultEngine();
  }

  getChiefWorkspacePath(): string {
    return join(this.options.dataDir, BRAND.chiefWorkspaceDir);
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    await this.ptyPool.dispose();
    await this.memoryStore.close();
    this.running = false;
  }
}
