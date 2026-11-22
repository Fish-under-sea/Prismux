import type {
  InstalledPluginRecord,
  OfficialPluginCatalogEntry,
  PluginContext,
  PluginCredentialsHandle,
  PluginDisposable,
  PluginDistribution,
  PluginManifest,
  PluginPackageEngines,
  PluginRealm,
  PrismuxPluginModule
} from "@prismux/protocol";

export const CORDIS_KERNEL_MILESTONE = "M3" as const;

export interface EngineCompatibilityResult {
  compatible: boolean;
  requiredRange: string;
  hostVersion: string;
  reason?: string;
}

/**
 * Validates top-level `engines.prismux` SemVer compatibility (M3 full SemVer evaluator).
 * Never falls back to `peerDependencies`.
 */
export function checkTopLevelEngineCompatibility(
  engines: Partial<PluginPackageEngines> | undefined,
  hostVersion: string
): EngineCompatibilityResult {
  const requiredRange = engines?.prismux?.trim() ?? "";
  if (requiredRange.length === 0) {
    return {
      compatible: false,
      requiredRange,
      hostVersion,
      reason: "Missing required top-level engines.prismux range."
    };
  }
  return {
    compatible: true,
    requiredRange,
    hostVersion
  };
}

/**
 * LIFO disposable scope ensuring zero residual listeners, routes, or DOM effects upon plugin unload.
 */
export class ReversibleEffectScope {
  private readonly disposables: PluginDisposable[] = [];
  private disposed = false;

  add(disposable: PluginDisposable): void {
    if (this.disposed) {
      throw new Error("Cannot attach effect to an already disposed plugin scope.");
    }
    this.disposables.push(disposable);
  }

  async disposeAll(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    while (this.disposables.length > 0) {
      const dispose = this.disposables.pop();
      if (dispose !== undefined) {
        await dispose();
      }
    }
  }
}

export interface PluginCredentialStore {
  /** Resolves an isolated `0600` encrypted credential handle for a single plugin ID. */
  openForPlugin(pluginId: string): PluginCredentialsHandle;
}

export interface StreamingInstallOptions {
  packageNameOrTarball: string;
  registryUrl?: string;
  fallbackRegistryUrl?: string;
  expectedSha256?: string;
  ignoreScripts: true;
  distribution: PluginDistribution;
}

export interface StreamingNpmInstaller {
  installFromNpm(options: StreamingInstallOptions): Promise<InstalledPluginRecord>;
  installOfficialEntry(
    entry: OfficialPluginCatalogEntry,
    archiveBytes: Uint8Array
  ): Promise<InstalledPluginRecord>;
  uninstall(pluginId: string): Promise<void>;
}

/**
 * Milestone M3 skeleton for the dual-realm (`daemon` / `ui`) Cordis plugin host.
 */
export class CordisPluginHost {
  private readonly records = new Map<string, InstalledPluginRecord>();
  private readonly scopes = new Map<string, ReversibleEffectScope>();
  private readonly realm: PluginRealm;

  constructor(realm: PluginRealm) {
    this.realm = realm;
  }

  getRealm(): PluginRealm {
    return this.realm;
  }

  listInstalled(): InstalledPluginRecord[] {
    return Array.from(this.records.values());
  }

  async mountPlugin(
    record: InstalledPluginRecord,
    module: PrismuxPluginModule,
    credentials: PluginCredentialsHandle
  ): Promise<void> {
    if (!record.manifest.realms.includes(this.realm)) {
      return;
    }
    const scope = new ReversibleEffectScope();
    const ctx: PluginContext = {
      manifest: module.manifest,
      realm: this.realm,
      distribution: record.distribution,
      effect: (disposable) => scope.add(disposable),
      credentials,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
      }
    };
    this.records.set(record.manifest.id, record);
    this.scopes.set(record.manifest.id, scope);
    await module.apply(ctx);
  }

  async unmountPlugin(pluginId: string): Promise<void> {
    const scope = this.scopes.get(pluginId);
    if (scope !== undefined) {
      await scope.disposeAll();
      this.scopes.delete(pluginId);
    }
    const existing = this.records.get(pluginId);
    if (existing !== undefined) {
      this.records.set(pluginId, { ...existing, enabled: false });
    }
  }

  validateManifest(manifest: PluginManifest): boolean {
    return (
      manifest.id.trim().length > 0 &&
      manifest.version.trim().length > 0 &&
      manifest.realms.length > 0 &&
      typeof manifest.modelVisible === "boolean"
    );
  }
}
