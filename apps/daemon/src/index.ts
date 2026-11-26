import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CordisPluginHost,
  CordisStreamingInstaller,
  EncryptedPluginCredentialStore,
  type CordisPluginModule,
} from "@prismux/cordis-kernel";
import { ObsidianVaultImporterImpl, SqliteMemoryStore } from "@prismux/memory-core";
import {
  BRAND,
  DEFAULT_APP_VERSION,
  type ChiefProviderKind,
  type InstalledPluginRecord,
  type PrismuxPluginModule,
} from "@prismux/protocol";
import { SyncVaultEngine } from "@prismux/sync-vault";
import { AppearanceConfigStore } from "./appearance/AppearanceConfigStore.js";
import { ChiefThreadManager } from "./chief/ChiefThreadManager.js";
import {
  CoreRpcClient,
  type CoreRpcHandshakeError,
  isNonRetryableCoreHandshakeError,
} from "./core/CoreRpcClient.js";
import { CoreServerSupervisor, sanitizeChildEnv } from "./core/CoreServerSupervisor.js";
import { ArtifactResultBackdoor } from "./dispatch/ArtifactResultBackdoor.js";
import { DesktopIpcDispatchHub } from "./dispatch/DesktopIpcDispatchHub.js";
import { TaskDispatchRouter } from "./dispatch/TaskDispatchRouter.js";
import { HandoffEngine } from "./handoff/HandoffEngine.js";
import { LifecycleHookBus } from "./hooks/LifecycleHookBus.js";
import { PersistentPtyPool } from "./pty/PersistentPtyPool.js";
import { WorktreeSandbox } from "./sandbox/WorktreeSandbox.js";
import { SubscriptionOrchestrationGuard } from "./security/AntigravityPolicyGuard.js";
import { SubscriptionWaiverStore } from "./security/AntigravityPolicyStore.js";
import { DaemonBusinessService } from "./server/DaemonBusinessRoutes.js";
import { DaemonRpcServer } from "./server/DaemonRpcServer.js";
import type { OfficialPluginSourceConfig } from "./server/OfficialPluginDownloader.js";
import { OvernightRouteService } from "./server/OvernightRoutes.js";
import { PairingManager } from "./server/PairingManager.js";
import { CliUpdateService } from "./system/CliUpdateService.js";
import { OfficialQuotaService } from "./system/OfficialQuotaService.js";
import { PortScannerService } from "./system/PortScannerService.js";
import { PrismuxProviderProbeService } from "./system/PrismuxProviderProbeService.js";
import { ResourceMonitorService } from "./system/ResourceMonitorService.js";
import { ServiceDiagnosticsService } from "./system/ServiceDiagnosticsService.js";
import {
  StorageQuotaService,
  type StorageQuotaServiceOptions,
} from "./system/StorageQuotaService.js";
import { SystemFontService } from "./system/SystemFontService.js";
import { AppUpdater } from "./updater/AppUpdater.js";
import { WallpaperMediaService } from "./wallpapers/WallpaperMediaService.js";
import {
  OvernightFactory,
  createDefaultOvernightCodingExecutor,
} from "./workflows/OvernightFactory.js";

export * from "./appearance/AppearanceConfigStore.js";
export * from "./core/CoreServerSupervisor.js";
export * from "./core/CoreRpcClient.js";
export * from "./dispatch/ArtifactResultBackdoor.js";
export * from "./dispatch/DesktopIpcDispatchHub.js";
export * from "./dispatch/TaskDispatchRouter.js";
export * from "./pty/PersistentPtyPool.js";
export * from "./handoff/HandoffEngine.js";
export * from "./hooks/LifecycleHookBus.js";
export * from "./sandbox/WorktreeSandbox.js";
export * from "./security/AntigravityPolicyGuard.js";
export * from "./security/AntigravityPolicyStore.js";
export * from "./workflows/OvernightFactory.js";
export * from "./chief/ChiefObsidianCurator.js";
export * from "./chief/ChiefThreadManager.js";
export * from "./server/PairingManager.js";
export * from "./server/CliUpdateRoutes.js";
export * from "./server/DaemonBusinessRoutes.js";
export * from "./server/DispatchRoutes.js";
export * from "./server/OvernightRoutes.js";
export * from "./server/QuotaRoutes.js";
export * from "./server/OfficialPluginDownloader.js";
export * from "./server/DaemonRpcServer.js";
export * from "./system/CliUpdateService.js";
export * from "./system/OfficialQuotaService.js";
export * from "./system/PortScannerService.js";
export * from "./system/PrismuxProviderProbeService.js";
export * from "./system/ResourceMonitorService.js";
export * from "./system/ServiceDiagnosticsService.js";
export * from "./system/StorageQuotaService.js";
export * from "./system/SystemFontService.js";
export * from "./system/WindowsEnvRefresh.js";
export * from "./updater/AppUpdater.js";
export * from "./wallpapers/WallpaperMediaService.js";

const PLUGIN_MASTER_KEY_FILENAME = "credentials-master.key";

/**
 * Resolves the `@prismux/daemon` runtime version from its `package.json`
 * (covering both dev/dist and staged `resources/prismux-daemon/` layouts),
 * falling back cleanly to `DEFAULT_APP_VERSION`.
 */
export function resolveDaemonPackageVersion(): string {
  let cursor = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 4; depth += 1) {
    const pkgPath = join(cursor, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          name?: unknown;
          version?: unknown;
        };
        if (
          (parsed.name === "@prismux/daemon" || parsed.name === "prismux-daemon") &&
          typeof parsed.version === "string" &&
          parsed.version.trim().length > 0
        ) {
          return parsed.version.trim();
        }
      } catch {
        // continue walking up
      }
    }
    const parent = resolve(cursor, "..");
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return DEFAULT_APP_VERSION;
}

/**
 * Strips host-polluting Electron environment variables before spawning provider sessions or sub-shells.
 * Kept for backward compatibility; delegates to `sanitizeChildEnv`.
 */
export function sanitizeProviderEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  return sanitizeChildEnv(env);
}

function loadOrGeneratePluginMasterKey(dataDir: string, explicitKey?: string | Uint8Array): Buffer {
  if (explicitKey !== undefined) {
    const keyBuf =
      typeof explicitKey === "string" ? Buffer.from(explicitKey, "utf8") : Buffer.from(explicitKey);
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
  coreUrl?: string;
  coreToken?: string;
  coreCommand?: string;
  coreArgs?: string[];
  coreHealthUrl?: string;
  /** @deprecated Use coreUrl */
  t3Url?: string;
  /** @deprecated Use coreToken */
  t3Token?: string;
  /** @deprecated Use coreCommand */
  t3Command?: string;
  /** @deprecated Use coreArgs */
  t3Args?: string[];
  /** @deprecated Use coreHealthUrl */
  t3HealthUrl?: string;
  defaultChiefProvider?: ChiefProviderKind;
  defaultChiefModel?: string;
  officialCatalogPath?: string;
  officialPluginSources?: OfficialPluginSourceConfig;
  steamRootsDiscoverer?: () => Promise<string[]>;
  storageQuotaOptions?: Omit<StorageQuotaServiceOptions, "dataDir" | "memoryStore" | "appUpdater">;
  disableAutoUpdateCheck?: boolean;
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
  coreConnected?: boolean;
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
  readonly coreSupervisor: CoreServerSupervisor | undefined;
  readonly coreRpcClient: CoreRpcClient | undefined;
  /** @deprecated Use coreSupervisor */
  readonly t3Supervisor: CoreServerSupervisor | undefined;
  /** @deprecated Use coreRpcClient */
  readonly t3RpcClient: CoreRpcClient | undefined;
  readonly providerProbeService: PrismuxProviderProbeService;
  readonly subscriptionWaiverStore: SubscriptionWaiverStore;
  readonly subscriptionOrchestrationGuard: SubscriptionOrchestrationGuard;
  /** @deprecated Use subscriptionWaiverStore */
  readonly antigravityPolicyStore: SubscriptionWaiverStore;
  /** @deprecated Use subscriptionOrchestrationGuard */
  readonly antigravityPolicyGuard: SubscriptionOrchestrationGuard;
  readonly taskDispatchRouter: TaskDispatchRouter;
  readonly artifactBackdoor: ArtifactResultBackdoor;
  readonly dispatchHub: DesktopIpcDispatchHub;
  readonly overnightFactory: OvernightFactory;
  readonly pluginHost: CordisPluginHost;
  readonly pluginCredentialStore: EncryptedPluginCredentialStore;
  readonly pluginInstaller: CordisStreamingInstaller;
  readonly appUpdater: AppUpdater;
  readonly memoryStore: SqliteMemoryStore;
  readonly obsidianImporter: ObsidianVaultImporterImpl;
  readonly syncVault: SyncVaultEngine;
  readonly wallpaperService: WallpaperMediaService;
  readonly fontService: SystemFontService;
  readonly appearanceStore: AppearanceConfigStore;
  readonly businessService: DaemonBusinessService;
  readonly overnightRouteService: OvernightRouteService;
  readonly portScannerService: PortScannerService;
  readonly resourceMonitorService: ResourceMonitorService;
  readonly storageQuotaService: StorageQuotaService;
  readonly diagnosticsService: ServiceDiagnosticsService;
  readonly cliUpdateService: CliUpdateService;
  readonly quotaService: OfficialQuotaService;
  readonly chiefManager: ChiefThreadManager;
  readonly pairingManager: PairingManager;
  readonly rpcServer: DaemonRpcServer;

  private readonly pluginMasterKey: Buffer;
  private readonly pluginModules = new Map<string, PrismuxPluginModule | CordisPluginModule>();
  private running = false;
  private readyInfo: DaemonReadyInfo | undefined;
  private activeStartPromise: Promise<DaemonReadyInfo> | undefined;
  private activeStopPromise: Promise<void> | undefined;
  private coreConnectRetryTimer: NodeJS.Timeout | undefined;
  private coreConnectStopped = false;
  private coreHandshakeWarningLogged = false;
  private coreStateUnsubscribe: (() => void) | undefined;

  constructor(options: DaemonStartOptions) {
    this.options = options;
    this.machineId = options.machineId ?? "local";
    this.ptyPool = new PersistentPtyPool();
    this.hookBus = new LifecycleHookBus();
    this.sandbox = new WorktreeSandbox();

    const resolvedCoreCommand = options.coreCommand ?? options.t3Command;
    const resolvedCoreArgs = options.coreArgs ?? options.t3Args;
    const resolvedCoreHealthUrl = options.coreHealthUrl ?? options.t3HealthUrl;
    const resolvedCoreUrl = options.coreUrl ?? options.t3Url;
    const resolvedCoreToken = options.coreToken ?? options.t3Token;

    if (
      resolvedCoreCommand !== undefined ||
      resolvedCoreArgs !== undefined ||
      resolvedCoreHealthUrl !== undefined
    ) {
      this.coreSupervisor = new CoreServerSupervisor({
        command: resolvedCoreCommand,
        args: resolvedCoreArgs,
        healthUrl: resolvedCoreHealthUrl,
      });
    }
    this.t3Supervisor = this.coreSupervisor;

    if (resolvedCoreUrl !== undefined && resolvedCoreUrl.trim().length > 0) {
      this.coreRpcClient = new CoreRpcClient({
        url: resolvedCoreUrl,
        token: resolvedCoreToken,
      });
    }
    this.t3RpcClient = this.coreRpcClient;

    this.providerProbeService = new PrismuxProviderProbeService({
      coreRpcClient: this.coreRpcClient,
    });

    this.subscriptionWaiverStore = new SubscriptionWaiverStore({
      dataDir: options.dataDir,
    });
    this.antigravityPolicyStore = this.subscriptionWaiverStore;
    this.subscriptionOrchestrationGuard = new SubscriptionOrchestrationGuard(
      this.subscriptionWaiverStore,
      { probeService: this.providerProbeService },
    );
    this.antigravityPolicyGuard = this.subscriptionOrchestrationGuard;
    this.taskDispatchRouter = new TaskDispatchRouter();
    this.artifactBackdoor = new ArtifactResultBackdoor({
      policyGuard: this.subscriptionOrchestrationGuard,
    });
    this.dispatchHub = new DesktopIpcDispatchHub({
      dataDir: options.dataDir,
      router: this.taskDispatchRouter,
      policyGuard: this.subscriptionOrchestrationGuard,
      artifactBackdoor: this.artifactBackdoor,
    });

    // Official plugins (qq) are NEVER preinstalled by default.
    this.pluginHost = new CordisPluginHost("daemon");
    this.pluginMasterKey = loadOrGeneratePluginMasterKey(options.dataDir, options.pluginMasterKey);
    this.pluginCredentialStore = new EncryptedPluginCredentialStore({
      dataDir: options.dataDir,
      masterKey: this.pluginMasterKey,
    });
    const resolvedHostVersion = options.hostVersion ?? resolveDaemonPackageVersion();
    this.pluginInstaller = new CordisStreamingInstaller({
      pluginsDir: join(options.dataDir, "plugins"),
      hostVersion: resolvedHostVersion,
    });
    this.appUpdater = new AppUpdater({
      currentVersion: resolvedHostVersion,
      dataDir: options.dataDir,
      portableMode: Boolean(options.portableRoot),
    });

    this.memoryStore = new SqliteMemoryStore({
      dbPath: join(options.dataDir, "data", "memory.db"),
      machineId: this.machineId,
      embeddingDimensions: 768,
      enableWal: true,
    });
    this.obsidianImporter = new ObsidianVaultImporterImpl(this.memoryStore, this.machineId);
    this.handoffEngine = new HandoffEngine({
      onPersistHandoffNote: async (note) => {
        if (this.running) {
          await this.memoryStore.upsert({
            namespace: "private/chief",
            kind: "handoff_note",
            title: `Handoff: ${note.summary.goal}`,
            content: note.continuationPrompt,
            sourceRef: `thread:${note.newThreadId}`,
            machineId: this.machineId,
          });
        }
      },
    });
    this.overnightFactory = new OvernightFactory({
      memoryStore: this.memoryStore,
      handoffEngine: this.handoffEngine,
      hookBus: this.hookBus,
      sandbox: this.sandbox,
      policyGuard: this.subscriptionOrchestrationGuard,
      dispatchRouter: this.taskDispatchRouter,
      artifactBackdoor: this.artifactBackdoor,
      dispatchHub: this.dispatchHub,
      codingExecutor: createDefaultOvernightCodingExecutor(),
    });
    const syncCredHandle = this.pluginCredentialStore.openForPlugin("sync-vault");
    this.syncVault = new SyncVaultEngine({
      machineId: this.machineId,
      resolveSecret: async (secretRef: string) => {
        const prefix = "sync-vault:";
        const val = secretRef.startsWith(prefix)
          ? await syncCredHandle.get(secretRef.slice(prefix.length))
          : await syncCredHandle.get(secretRef);
        return val ?? undefined;
      },
      ...(options.portableRoot !== undefined
        ? {
            portable: {
              executableDir: options.portableRoot,
              defaultDataDir: options.dataDir,
            },
          }
        : {}),
    });

    this.chiefManager = new ChiefThreadManager({
      dataDir: options.dataDir,
      defaultProvider: options.defaultChiefProvider,
      defaultModel: options.defaultChiefModel,
      rpcClient: this.coreRpcClient,
    });

    this.pairingManager = new PairingManager({
      initialAuthToken: options.authToken,
    });

    this.appearanceStore = new AppearanceConfigStore({
      dataDir: options.dataDir,
    });
    const initialAppearance = this.appearanceStore.get().config;
    this.wallpaperService = new WallpaperMediaService({
      dataDir: options.dataDir,
      customDirs: initialAppearance.wallpaper.customDirs,
      steamRootOverride: initialAppearance.wallpaper.steamRootOverride,
      advancedEngineEnabled: initialAppearance.wallpaper.advancedEngineEnabled,
      ...(options.steamRootsDiscoverer !== undefined
        ? { steamRootsDiscoverer: options.steamRootsDiscoverer }
        : {}),
    });
    this.fontService = new SystemFontService();
    const daemonStartedAt = Date.now();
    this.portScannerService = new PortScannerService({
      ptyPool: this.ptyPool,
      t3Supervisor: this.coreSupervisor,
    });
    this.resourceMonitorService = new ResourceMonitorService({
      ptyPool: this.ptyPool,
      t3Supervisor: this.coreSupervisor,
      t3RpcClient: this.coreRpcClient,
      ...(resolvedCoreHealthUrl !== undefined || resolvedCoreUrl !== undefined
        ? { t3ServerUrl: resolvedCoreHealthUrl ?? resolvedCoreUrl }
        : {}),
    });
    this.storageQuotaService = new StorageQuotaService({
      ...options.storageQuotaOptions,
      dataDir: options.dataDir,
      memoryStore: this.memoryStore,
      appUpdater: this.appUpdater,
    });
    this.diagnosticsService = new ServiceDiagnosticsService({
      dataDir: options.dataDir,
      version: resolvedHostVersion,
      headless: options.headless,
      startedAt: daemonStartedAt,
      memoryStore: this.memoryStore,
      memoryDbPath: join(options.dataDir, "data", "memory.db"),
      syncVault: this.syncVault,
      coreSupervisor: this.coreSupervisor,
      coreRpcClient: this.coreRpcClient,
      coreServerUrl: resolvedCoreHealthUrl ?? resolvedCoreUrl,
      coreToken: resolvedCoreToken,
      providerProbeService: this.providerProbeService,
      ptyPool: this.ptyPool,
      resourceMonitor: this.resourceMonitorService,
      appUpdater: this.appUpdater,
      wallpaperService: this.wallpaperService,
      overnightFactory: this.overnightFactory,
      hookBus: this.hookBus,
      sandbox: this.sandbox,
    });
    this.cliUpdateService = new CliUpdateService({
      appUpdater: this.appUpdater,
      onAfterUpdate: () => this.diagnosticsService.clearCache(),
    });
    this.quotaService = new OfficialQuotaService({
      providerProbeService: this.providerProbeService,
    });
    this.businessService = new DaemonBusinessService({
      dataDir: options.dataDir,
      hostVersion: resolvedHostVersion,
      machineId: this.machineId,
      officialCatalogPath: options.officialCatalogPath,
      chiefManager: this.chiefManager,
      handoffEngine: this.handoffEngine,
      t3RpcClient: this.coreRpcClient,
      memoryStore: this.memoryStore,
      memoryDbPath: join(options.dataDir, "data", "memory.db"),
      syncVault: this.syncVault,
      pluginHost: this.pluginHost,
      pluginInstaller: this.pluginInstaller,
      pluginCredentialStore: this.pluginCredentialStore,
      appUpdater: this.appUpdater,
      ...(options.officialPluginSources !== undefined
        ? { officialPluginSources: options.officialPluginSources }
        : {}),
      resourceMonitorService: this.resourceMonitorService,
      onMountPlugin: (record, mod) => this.mountPluginModule(record, mod),
      onTogglePlugin: (pluginId, enabled) => this.togglePlugin(pluginId, enabled),
      onUninstallPlugin: (pluginId) => this.uninstallPlugin(pluginId),
    });
    this.businessService.restorePersistedSyncConfig();
    this.overnightRouteService = new OvernightRouteService({
      dataDir: options.dataDir,
      overnightFactory: this.overnightFactory,
      credentialStore: this.pluginCredentialStore,
      memoryStore: this.memoryStore,
      policyGuard: this.subscriptionOrchestrationGuard,
      dispatchHub: this.dispatchHub,
      chiefManager: this.chiefManager,
      onConfigChanged: () => this.diagnosticsService.clearCache(),
    });

    this.rpcServer = new DaemonRpcServer({
      host: options.host ?? "127.0.0.1",
      port: options.port ?? 0,
      headless: options.headless,
      version: resolvedHostVersion,
      machineId: this.machineId,
      ptyPool: this.ptyPool,
      chiefManager: this.chiefManager,
      pairingManager: this.pairingManager,
      pluginHost: this.pluginHost,
      onTogglePlugin: (pluginId, enabled) => this.togglePlugin(pluginId, enabled),
      appUpdater: this.appUpdater,
      memoryStore: this.memoryStore,
      obsidianImporter: this.obsidianImporter,
      handoffEngine: this.handoffEngine,
      hookBus: this.hookBus,
      coreSupervisor: this.coreSupervisor,
      coreRpcClient: this.coreRpcClient,
      wallpaperService: this.wallpaperService,
      fontService: this.fontService,
      appearanceStore: this.appearanceStore,
      businessService: this.businessService,
      overnightService: this.overnightRouteService,
      diagnosticsService: this.diagnosticsService,
      providerProbeService: this.providerProbeService,
      cliUpdateService: this.cliUpdateService,
      quotaService: this.quotaService,
      portScannerService: this.portScannerService,
      resourceMonitorService: this.resourceMonitorService,
      storageQuotaService: this.storageQuotaService,
      subscriptionWaiverStore: this.subscriptionWaiverStore,
      dispatchHub: this.dispatchHub,
      startedAt: daemonStartedAt,
      onRequestShutdown: options.onShutdownRequested,
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
    module: PrismuxPluginModule | CordisPluginModule,
  ): Promise<void> {
    const pluginId = record.manifest.id;
    this.pluginModules.set(pluginId, module);
    const credentials = this.pluginCredentialStore.openForPlugin(pluginId);
    await this.pluginHost.mountPlugin(record, module, credentials);
    this.diagnosticsService.clearCache();
  }

  async togglePlugin(
    pluginId: string,
    enabled: boolean,
  ): Promise<{ pluginId: string; enabled: boolean }> {
    const record = this.pluginHost.getRecord(pluginId);
    if (record === undefined) {
      throw new Error(`Plugin "${pluginId}" is not installed.`);
    }

    if (!enabled) {
      await this.pluginHost.unmountPlugin(pluginId);
      this.diagnosticsService.clearCache();
      return { pluginId, enabled: false };
    }

    const module = this.pluginModules.get(pluginId);
    if (module === undefined) {
      throw new Error(
        `Cannot enable plugin "${pluginId}": module definition is not loaded in memory.`,
      );
    }

    const credentials = this.pluginCredentialStore.openForPlugin(pluginId);
    await this.pluginHost.mountPlugin({ ...record, enabled: true }, module, credentials);
    this.diagnosticsService.clearCache();
    return { pluginId, enabled: true };
  }

  async uninstallPlugin(pluginId: string): Promise<void> {
    await this.pluginHost.uninstallPlugin(pluginId);
    await this.pluginInstaller.uninstall(pluginId);
    this.pluginModules.delete(pluginId);
    this.diagnosticsService.clearCache();
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

  private clearCoreConnectLoop(): void {
    this.coreConnectStopped = true;
    if (this.coreConnectRetryTimer !== undefined) {
      clearTimeout(this.coreConnectRetryTimer);
      this.coreConnectRetryTimer = undefined;
    }
    this.coreStateUnsubscribe?.();
    this.coreStateUnsubscribe = undefined;
  }

  private async tryEnsureChiefThread(slot: {
    workspacePath: string;
    activeProvider: ChiefProviderKind;
    model?: string;
  }): Promise<void> {
    if (!this.coreRpcClient || !this.coreRpcClient.isConnected()) {
      return;
    }
    try {
      await this.coreRpcClient.ensureChiefThread(
        slot.workspacePath,
        slot.activeProvider,
        slot.model,
      );
    } catch {
      // Transient chief sync failure will retry on next reconnect
    }
  }

  private handleNonRetryableCoreHandshakeError(error: CoreRpcHandshakeError): void {
    this.coreConnectStopped = true;
    if (this.coreConnectRetryTimer !== undefined) {
      clearTimeout(this.coreConnectRetryTimer);
      this.coreConnectRetryTimer = undefined;
    }
    if (this.readyInfo !== undefined) {
      this.readyInfo = {
        ...this.readyInfo,
        t3Connected: false,
        coreConnected: false,
      };
    }
    if (!this.coreHandshakeWarningLogged) {
      this.coreHandshakeWarningLogged = true;
      console.warn(
        `[prismux-daemon] Stopping Core RPC reconnect loop after HTTP ${error.statusCode} handshake rejection: ${error.message}`,
      );
    }
  }

  private startCoreConnectLoop(slot: {
    workspacePath: string;
    activeProvider: ChiefProviderKind;
    model?: string;
  }): void {
    const client = this.coreRpcClient;
    if (!client) {
      return;
    }

    this.coreConnectStopped = false;
    this.coreStateUnsubscribe?.();
    this.coreStateUnsubscribe = client.onStateChange((connected) => {
      if (this.readyInfo !== undefined) {
        this.readyInfo = {
          ...this.readyInfo,
          t3Connected: connected,
          coreConnected: connected,
        };
      }
      if (connected && !this.coreConnectStopped) {
        void this.tryEnsureChiefThread(slot);
      }
    });

    const backoffDelays = [250, 500, 1_000, 2_000, 5_000] as const;
    let attempt = 0;

    const scheduleNext = () => {
      if (this.coreConnectStopped || client.isConnected()) {
        return;
      }
      const delayMs = backoffDelays[Math.min(attempt, backoffDelays.length - 1)] ?? 5_000;
      attempt += 1;
      this.coreConnectRetryTimer = setTimeout(() => {
        this.coreConnectRetryTimer = undefined;
        void attemptConnect();
      }, delayMs);
    };

    const attemptConnect = async () => {
      if (this.coreConnectStopped || client.isConnected()) {
        return;
      }
      try {
        await client.connect();
        if (this.coreConnectStopped) {
          return;
        }
        attempt = 0;
        this.coreHandshakeWarningLogged = false;
        if (this.readyInfo !== undefined) {
          this.readyInfo = {
            ...this.readyInfo,
            t3Connected: true,
            coreConnected: true,
          };
        }
        await this.tryEnsureChiefThread(slot);
      } catch (error: unknown) {
        if (isNonRetryableCoreHandshakeError(error)) {
          this.handleNonRetryableCoreHandshakeError(error);
          return;
        }
        scheduleNext();
      }
    };

    scheduleNext();
  }

  private async performStart(): Promise<DaemonReadyInfo> {
    try {
      this.ensureMasterKeyPersisted();
      await this.memoryStore.initialize();
      await this.businessService.hydrateInstalledPlugins();
      const slot = await this.chiefManager.init();

      if (this.coreSupervisor !== undefined) {
        await this.coreSupervisor.start();
      }

      // Bind HTTP & WebSocket RPC server first so /health and API routes are ready in <150ms.
      await this.rpcServer.start();
      const httpUrl = this.rpcServer.getHttpUrl();
      const wsUrl = this.rpcServer.getWsUrl();
      const pairing = this.pairingManager.createPairingCode(undefined, httpUrl);

      this.coreConnectStopped = false;
      this.coreHandshakeWarningLogged = false;
      if (this.coreRpcClient !== undefined) {
        // Fast bounded probe: succeeds immediately if Core Server is already listening
        // (preserving deterministic readiness), or falls back to non-blocking background backoff.
        let initialTimer: NodeJS.Timeout | undefined;
        let initialHandshakeError: CoreRpcHandshakeError | undefined;
        let initialRaceSettled = false;
        const initialAttempt = this.coreRpcClient
          .connect()
          .then(async () => {
            if (!this.coreConnectStopped) {
              await this.tryEnsureChiefThread(slot);
            }
          })
          .catch((error: unknown) => {
            if (isNonRetryableCoreHandshakeError(error)) {
              initialHandshakeError = error;
              if (initialRaceSettled) {
                this.handleNonRetryableCoreHandshakeError(error);
              }
            }
            // Other errors are handled below via background reconnect loop.
          });
        try {
          await Promise.race([
            initialAttempt,
            new Promise<void>((resolveWait) => {
              initialTimer = setTimeout(resolveWait, 350);
            }),
          ]);
        } finally {
          initialRaceSettled = true;
          if (initialTimer !== undefined) {
            clearTimeout(initialTimer);
          }
        }

        if (initialHandshakeError !== undefined) {
          this.handleNonRetryableCoreHandshakeError(initialHandshakeError);
        } else if (!this.coreRpcClient.isConnected()) {
          this.startCoreConnectLoop(slot);
        } else {
          this.coreStateUnsubscribe?.();
          this.coreStateUnsubscribe = this.coreRpcClient.onStateChange((connected) => {
            if (this.readyInfo !== undefined) {
              this.readyInfo = {
                ...this.readyInfo,
                t3Connected: connected,
                coreConnected: connected,
              };
            }
            if (connected && !this.coreConnectStopped) {
              void this.tryEnsureChiefThread(slot);
            }
          });
        }
      }

      const connected = this.coreRpcClient?.isConnected() ?? false;
      const info: DaemonReadyInfo = {
        port: this.rpcServer.getPort(),
        host: this.options.host ?? "127.0.0.1",
        httpUrl,
        wsUrl,
        pairingCode: pairing.pairingCode,
        pairingExpiresAt: pairing.expiresAt,
        t3Connected: connected,
        coreConnected: connected,
        headless: this.options.headless,
        dataDir: this.options.dataDir,
        chiefThreadId: slot.threadId,
      };

      this.readyInfo = info;
      this.running = true;
      this.resourceMonitorService.start();
      this.overnightRouteService.startSchedulerIfEnabled();
      // Non-blocking startup C-drive guardrails: prune old downloaded installers and crashed >24h factory worktrees.
      void this.appUpdater.cleanupUpdateCache().catch(() => {
        // Non-fatal startup cache pruning
      });
      void this.overnightFactory.sweepStaleWorktrees().catch(() => {
        // Non-fatal startup worktree sweep
      });
      if (
        !this.options.disableAutoUpdateCheck &&
        process.env["PRISMUX_DISABLE_AUTO_UPDATE_CHECK"] !== "1"
      ) {
        this.appUpdater.startAutoCheck();
      }
      return info;
    } catch (error) {
      await this.performStop();
      throw error;
    }
  }

  private async performStop(): Promise<void> {
    this.overnightRouteService.stop();
    this.resourceMonitorService.stop();
    this.appUpdater.stopAutoCheck();
    this.clearCoreConnectLoop();
    try {
      await this.rpcServer.stop();
    } finally {
      try {
        await this.unmountAllActivePlugins();
      } finally {
        try {
          if (this.coreRpcClient !== undefined) {
            await this.coreRpcClient.close();
          }
        } finally {
          try {
            if (this.coreSupervisor !== undefined) {
              await this.coreSupervisor.stop();
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
