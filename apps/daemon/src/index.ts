import { join } from "node:path";
import { CordisPluginHost } from "@prismux/cordis-kernel";
import { SqliteMemoryStoreSkeleton } from "@prismux/memory-core";
import { BRAND, type ChiefProviderKind } from "@prismux/protocol";
import { SyncVaultEngine } from "@prismux/sync-vault";
import { ChiefThreadManager } from "./chief/ChiefThreadManager.js";
import { HandoffEngine } from "./handoff/HandoffEngine.js";
import { LifecycleHookBus } from "./hooks/LifecycleHookBus.js";
import { PersistentPtyPool } from "./pty/PersistentPtyPool.js";
import { WorktreeSandbox } from "./sandbox/WorktreeSandbox.js";
import { DaemonRpcServer } from "./server/DaemonRpcServer.js";
import { PairingManager } from "./server/PairingManager.js";
import { T3RpcClient } from "./t3/T3RpcClient.js";
import {
  sanitizeChildEnv,
  T3ServerSupervisor
} from "./t3/T3ServerSupervisor.js";
import { OvernightFactory } from "./workflows/OvernightFactory.js";

export * from "./pty/PersistentPtyPool.js";
export * from "./handoff/HandoffEngine.js";
export * from "./hooks/LifecycleHookBus.js";
export * from "./sandbox/WorktreeSandbox.js";
export * from "./workflows/OvernightFactory.js";
export * from "./t3/T3ServerSupervisor.js";
export * from "./t3/T3RpcClient.js";
export * from "./chief/ChiefThreadManager.js";
export * from "./server/PairingManager.js";
export * from "./server/DaemonRpcServer.js";

/**
 * Strips host-polluting Electron environment variables before spawning provider sessions or sub-shells.
 * Kept for backward compatibility; delegates to `sanitizeChildEnv`.
 */
export function sanitizeProviderEnv(
  env: Record<string, string | undefined>
): Record<string, string> {
  return sanitizeChildEnv(env);
}

export interface DaemonStartOptions {
  headless: boolean;
  dataDir: string;
  machineId?: string;
  host?: string;
  port?: number;
  authToken?: string;
  t3Url?: string;
  t3Token?: string;
  t3Command?: string;
  t3Args?: string[];
  t3HealthUrl?: string;
  defaultChiefProvider?: ChiefProviderKind;
  defaultChiefModel?: string;
  onShutdownRequested?: (reason?: string) => void | Promise<void>;
}

export interface DaemonReadyInfo {
  port: number;
  host: string;
  httpUrl: string;
  wsUrl: string;
  pairingCode: string;
  pairingExpiresAt: number;
  t3Connected: boolean;
  headless: boolean;
  dataDir: string;
  chiefThreadId: string;
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
  readonly t3Supervisor: T3ServerSupervisor | undefined;
  readonly t3RpcClient: T3RpcClient | undefined;
  readonly chiefManager: ChiefThreadManager;
  readonly pairingManager: PairingManager;
  readonly rpcServer: DaemonRpcServer;

  private running = false;
  private readyInfo: DaemonReadyInfo | undefined;
  private activeStartPromise: Promise<DaemonReadyInfo> | undefined;
  private activeStopPromise: Promise<void> | undefined;

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

    if (
      options.t3Command !== undefined ||
      options.t3Args !== undefined ||
      options.t3HealthUrl !== undefined
    ) {
      this.t3Supervisor = new T3ServerSupervisor({
        command: options.t3Command,
        args: options.t3Args,
        healthUrl: options.t3HealthUrl
      });
    }

    if (options.t3Url !== undefined && options.t3Url.trim().length > 0) {
      this.t3RpcClient = new T3RpcClient({
        url: options.t3Url,
        token: options.t3Token
      });
    }

    this.chiefManager = new ChiefThreadManager({
      dataDir: options.dataDir,
      defaultProvider: options.defaultChiefProvider,
      defaultModel: options.defaultChiefModel,
      rpcClient: this.t3RpcClient
    });

    this.pairingManager = new PairingManager({
      initialAuthToken: options.authToken
    });

    this.rpcServer = new DaemonRpcServer({
      host: options.host ?? "127.0.0.1",
      port: options.port ?? 0,
      headless: options.headless,
      ptyPool: this.ptyPool,
      chiefManager: this.chiefManager,
      pairingManager: this.pairingManager,
      t3Supervisor: this.t3Supervisor,
      t3RpcClient: this.t3RpcClient,
      onRequestShutdown: options.onShutdownRequested
    });
  }

  getChiefWorkspacePath(): string {
    return join(this.options.dataDir, BRAND.chiefWorkspaceDir);
  }

  isRunning(): boolean {
    return this.running;
  }

  getReadyInfo(): DaemonReadyInfo | undefined {
    return this.readyInfo;
  }

  async start(): Promise<DaemonReadyInfo> {
    if (this.activeStopPromise !== undefined) {
      await this.activeStopPromise;
    }
    if (this.running && this.readyInfo !== undefined) {
      return this.readyInfo;
    }
    if (this.activeStartPromise !== undefined) {
      return this.activeStartPromise;
    }

    const startRun = this.performStart().finally(() => {
      this.activeStartPromise = undefined;
    });
    this.activeStartPromise = startRun;
    return startRun;
  }

  async stop(): Promise<void> {
    if (this.activeStopPromise !== undefined) {
      return this.activeStopPromise;
    }

    const stopRun = this.performStop().finally(() => {
      this.activeStopPromise = undefined;
    });
    this.activeStopPromise = stopRun;
    return stopRun;
  }

  private async performStart(): Promise<DaemonReadyInfo> {
    try {
      const slot = await this.chiefManager.init();

      if (this.t3Supervisor !== undefined) {
        await this.t3Supervisor.start();
      }

      if (this.t3RpcClient !== undefined) {
        await this.t3RpcClient.connect();
        await this.t3RpcClient.ensureChiefThread(
          slot.workspacePath,
          slot.activeProvider,
          slot.model
        );
      }

      await this.rpcServer.start();
      const httpUrl = this.rpcServer.getHttpUrl();
      const wsUrl = this.rpcServer.getWsUrl();
      const pairing = this.pairingManager.createPairingCode(undefined, httpUrl);

      const info: DaemonReadyInfo = {
        port: this.rpcServer.getPort(),
        host: this.options.host ?? "127.0.0.1",
        httpUrl,
        wsUrl,
        pairingCode: pairing.pairingCode,
        pairingExpiresAt: pairing.expiresAt,
        t3Connected: this.t3RpcClient?.isConnected() ?? false,
        headless: this.options.headless,
        dataDir: this.options.dataDir,
        chiefThreadId: slot.threadId
      };

      this.readyInfo = info;
      this.running = true;
      return info;
    } catch (error) {
      await this.performStop();
      throw error;
    }
  }

  private async performStop(): Promise<void> {
    await this.rpcServer.stop();
    if (this.t3RpcClient !== undefined) {
      await this.t3RpcClient.close();
    }
    if (this.t3Supervisor !== undefined) {
      await this.t3Supervisor.stop();
    }
    await this.ptyPool.dispose();
    await this.memoryStore.close();
    this.running = false;
    this.readyInfo = undefined;
  }
}
