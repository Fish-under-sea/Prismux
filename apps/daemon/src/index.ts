import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CordisPluginHost,
  CordisStreamingInstaller,
  EncryptedPluginCredentialStore,
  type CordisPluginModule
} from "@prismux/cordis-kernel";
import {
  ObsidianVaultImporterImpl,
  SqliteMemoryStore
} from "@prismux/memory-core";
import {
  BRAND,
  type ChiefProviderKind,
  type InstalledPluginRecord,
  type PrismuxPluginModule
} from "@prismux/protocol";
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

const PLUGIN_MASTER_KEY_FILENAME = "credentials-master.key";

/**
 * Strips host-polluting Electron environment variables before spawning provider sessions or sub-shells.
 * Kept for backward compatibility; delegates to `sanitizeChildEnv`.
 */
export function sanitizeProviderEnv(
  env: Record<string, string | undefined>
): Record<string, string> {
  return sanitizeChildEnv(env);
}

function loadOrGeneratePluginMasterKey(
  dataDir: string,
  explicitKey?: string | Uint8Array
): Buffer {
  if (explicitKey !== undefined) {
    const keyBuf =
      typeof explicitKey === "string"
        ? Buffer.from(explicitKey, "utf8")
        : Buffer.from(explicitKey);
    if (keyBuf.byteLength === 0) {
      throw new Error("pluginMasterKey must not be empty.");
    }
    return keyBuf;
  }

  const keyFilePath = join(dataDir, PLUGIN_MASTER_KEY_FILENAME);
  if (existsSync(keyFilePath)) {
    const existing = readFileSync(keyFilePath);
    if (existing.byteLength > 0) {
      return existing;
    }
  }

  return randomBytes(32);
}

export interface DaemonStartOptions {
  headless: boolean;
  dataDir: string;
  machineId?: string;
  hostVersion?: string;
  portableRoot?: string;
  pluginMasterKey?: string | Uint8Array;
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
  readonly machineId: string;
  readonly ptyPool: PersistentPtyPool;
  readonly handoffEngine: HandoffEngine;
  readonly hookBus: LifecycleHookBus;
  readonly sandbox: WorktreeSandbox;
  readonly overnightFactory: OvernightFactory;
  readonly pluginHost: CordisPluginHost;
  readonly pluginCredentialStore: EncryptedPluginCredentialStore;
  readonly pluginInstaller: CordisStreamingInstaller;
  readonly memoryStore: SqliteMemoryStore;
  readonly obsidianImporter: ObsidianVaultImporterImpl;
  readonly syncVault: SyncVaultEngine;
  readonly t3Supervisor: T3ServerSupervisor | undefined;
  readonly t3RpcClient: T3RpcClient | undefined;
  readonly chiefManager: ChiefThreadManager;
  readonly pairingManager: PairingManager;
  readonly rpcServer: DaemonRpcServer;

  private readonly pluginMasterKey: Buffer;
  private readonly pluginModules = new Map<
    string,
    PrismuxPluginModule | CordisPluginModule
  >();
  private running = false;
  private readyInfo: DaemonReadyInfo | undefined;
  private activeStartPromise: Promise<DaemonReadyInfo> | undefined;
  private activeStopPromise: Promise<void> | undefined;

  constructor(options: DaemonStartOptions) {
    this.options = options;
    this.machineId = options.machineId ?? "local";
    this.ptyPool = new PersistentPtyPool();
    this.hookBus = new LifecycleHookBus();
    this.sandbox = new WorktreeSandbox();
    this.overnightFactory = new OvernightFactory();

    // Official plugins (qq, pet, fishdock-hook, ssh) are NEVER preinstalled by default.
    this.pluginHost = new CordisPluginHost("daemon");
    this.pluginMasterKey = loadOrGeneratePluginMasterKey(
      options.dataDir,
      options.pluginMasterKey
    );
    this.pluginCredentialStore = new EncryptedPluginCredentialStore({
      dataDir: options.dataDir,
      masterKey: this.pluginMasterKey
    });
    this.pluginInstaller = new CordisStreamingInstaller({
      pluginsDir: join(options.dataDir, "plugins"),
      hostVersion: options.hostVersion ?? "0.1.0"
    });

    this.memoryStore = new SqliteMemoryStore({
      dbPath: join(options.dataDir, "data", "memory.db"),
      machineId: this.machineId,
      embeddingDimensions: 768,
      enableWal: true
    });
    this.obsidianImporter = new ObsidianVaultImporterImpl(
      this.memoryStore,
      this.machineId
    );
    this.handoffEngine = new HandoffEngine({
      onPersistHandoffNote: async (note) => {
        if (this.running) {
          await this.memoryStore.upsert({
            namespace: "private/chief",
            kind: "handoff_note",
            title: `Handoff: ${note.summary.goal}`,
            content: note.continuationPrompt,
            sourceRef: `thread:${note.newThreadId}`,
            machineId: this.machineId
          });
        }
      }
    });
    this.syncVault = new SyncVaultEngine({
      machineId: this.machineId,
      ...(options.portableRoot !== undefined
        ? {
            portable: {
              executableDir: options.portableRoot,
              defaultDataDir: options.dataDir
            }
          }
        : {})
    });

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
      machineId: this.machineId,
      ptyPool: this.ptyPool,
      chiefManager: this.chiefManager,
      pairingManager: this.pairingManager,
      pluginHost: this.pluginHost,
      onTogglePlugin: (pluginId, enabled) => this.togglePlugin(pluginId, enabled),
      memoryStore: this.memoryStore,
      obsidianImporter: this.obsidianImporter,
      handoffEngine: this.handoffEngine,
      hookBus: this.hookBus,
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

  async mountPluginModule(
    record: InstalledPluginRecord,
    module: PrismuxPluginModule | CordisPluginModule
  ): Promise<void> {
    const pluginId = record.manifest.id;
    this.pluginModules.set(pluginId, module);
    const credentials = this.pluginCredentialStore.openForPlugin(pluginId);
    await this.pluginHost.mountPlugin(record, module, credentials);
  }

  async togglePlugin(
    pluginId: string,
    enabled: boolean
  ): Promise<{ pluginId: string; enabled: boolean }> {
    const record = this.pluginHost.getRecord(pluginId);
    if (record === undefined) {
      throw new Error(`Plugin "${pluginId}" is not installed.`);
    }

    if (!enabled) {
      await this.pluginHost.unmountPlugin(pluginId);
      return { pluginId, enabled: false };
    }

    const module = this.pluginModules.get(pluginId);
    if (module === undefined) {
      throw new Error(
        `Cannot enable plugin "${pluginId}": module definition is not loaded in memory.`
      );
    }

    const credentials = this.pluginCredentialStore.openForPlugin(pluginId);
    await this.pluginHost.mountPlugin(
      { ...record, enabled: true },
      module,
      credentials
    );
    return { pluginId, enabled: true };
  }

  async uninstallPlugin(pluginId: string): Promise<void> {
    await this.pluginHost.uninstallPlugin(pluginId);
    await this.pluginInstaller.uninstall(pluginId);
    this.pluginModules.delete(pluginId);
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

  private ensureMasterKeyPersisted(): void {
    if (this.options.pluginMasterKey !== undefined) {
      return;
    }
    const keyFilePath = join(this.options.dataDir, PLUGIN_MASTER_KEY_FILENAME);
    if (!existsSync(keyFilePath)) {
      mkdirSync(this.options.dataDir, { recursive: true });
      writeFileSync(keyFilePath, this.pluginMasterKey);
      chmodSync(keyFilePath, 0o600);
    }
  }

  private async unmountAllActivePlugins(): Promise<void> {
    for (const record of this.pluginHost.listInstalled()) {
      if (this.pluginHost.isMounted(record.manifest.id)) {
        try {
          await this.pluginHost.unmountPlugin(record.manifest.id);
        } catch {
          // Continue tearing down remaining plugins during shutdown.
        }
      }
    }
  }

  private async performStart(): Promise<DaemonReadyInfo> {
    try {
      this.ensureMasterKeyPersisted();
      await this.memoryStore.initialize();
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
    try {
      await this.rpcServer.stop();
    } finally {
      try {
        await this.unmountAllActivePlugins();
      } finally {
        try {
          if (this.t3RpcClient !== undefined) {
            await this.t3RpcClient.close();
          }
        } finally {
          try {
            if (this.t3Supervisor !== undefined) {
              await this.t3Supervisor.stop();
            }
          } finally {
            try {
              await this.ptyPool.dispose();
            } finally {
              await this.memoryStore.close();
              this.running = false;
              this.readyInfo = undefined;
            }
          }
        }
      }
    }
  }
}
