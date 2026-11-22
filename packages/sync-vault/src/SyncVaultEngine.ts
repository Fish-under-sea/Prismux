import {
  GitHubSyncChannel,
  S3SyncChannel,
  SyncHttpError,
  WebDavSyncChannel
} from "./channels.js";
import type {
  Argon2KdfParams,
  ExportOfflineBackupOptions,
  OfflineBackupExportResult,
  OfflineBackupSnapshot,
  SealBackupOptions,
  UnsealedBackupResult
} from "./cryptoSeal.js";
import {
  exportOfflineBackup,
  sealBackupPayload,
  unsealBackupPayload
} from "./cryptoSeal.js";
import type { ResolvePortableDataDirInput, SyncVaultPaths } from "./portableMode.js";
import { resolvePortableDataDir, resolveVaultPaths } from "./portableMode.js";
import type {
  FullPayloadMergeResult,
  SyncConflict,
  SyncVaultPayload
} from "./threeWayMerge.js";
import {
  filterInboundPayload,
  filterOutboundPayload,
  mergeSyncPayloads
} from "./threeWayMerge.js";
import type {
  ConditionalWriteResult,
  GitHubSyncConfig,
  PortableModeResolution,
  S3SyncConfig,
  SecretResolver,
  StallWatchdogConfig,
  SyncChannelKind,
  SyncDomainMatrix,
  SyncVaultStatus,
  WebDavSyncConfig
} from "./types.js";
import {
  DEFAULT_METADATA_TIMEOUT_MS,
  DEFAULT_STALL_TIMEOUT_MS,
  DEFAULT_SYNC_DOMAIN_MATRIX
} from "./types.js";

export interface SyncVaultEngineOptions {
  machineId?: string;
  webdav?: WebDavSyncConfig;
  s3?: S3SyncConfig;
  github?: GitHubSyncConfig;
  watchdog?: Partial<StallWatchdogConfig>;
  portable?: ResolvePortableDataDirInput;
  matrix?: Partial<SyncDomainMatrix>;
  resolveSecret?: SecretResolver;
  kdfParams?: Partial<Argon2KdfParams>;
}

export interface SyncNowOptions {
  channel?: SyncChannelKind;
  passphrase?: string;
  localPayload?: SyncVaultPayload;
  baseConfig?: Record<string, unknown>;
  expectedEtag?: string | null;
  remotePath?: string;
  targetMachineId?: string;
  autoMergeOnConflict?: boolean;
  retryOnCleanMerge?: boolean;
}

export interface ChannelSyncOutcome extends ConditionalWriteResult {
  channel: SyncChannelKind;
  mergedPayload?: SyncVaultPayload;
  conflicts?: SyncConflict[];
}

export interface SyncNowResult extends ConditionalWriteResult {
  channelResults: ChannelSyncOutcome[];
  mergedPayload?: SyncVaultPayload;
  conflicts?: SyncConflict[];
}

/**
 * Orchestrates passphrase-sealed AEAD multi-device sync, independent remote
 * channel toggles (preserving configuration when disabled), optimistic locking
 * with conflict resolution, stall watchdog, and portable mode paths.
 */
export class SyncVaultEngine {
  private readonly machineId: string;
  private readonly channels: {
    webdav?: WebDavSyncConfig;
    s3?: S3SyncConfig;
    github?: GitHubSyncConfig;
  };
  private readonly watchdog: StallWatchdogConfig;
  private readonly portableResolution: PortableModeResolution;
  private matrix: SyncDomainMatrix;
  private readonly resolveSecret?: SecretResolver;
  private readonly kdfParams?: Partial<Argon2KdfParams>;

  constructor(options?: SyncVaultEngineOptions) {
    this.machineId = options?.machineId ?? "local";
    this.channels = {
      webdav: options?.webdav ? structuredClone(options.webdav) : undefined,
      s3: options?.s3 ? structuredClone(options.s3) : undefined,
      github: options?.github ? structuredClone(options.github) : undefined
    };
    this.watchdog = {
      stallTimeoutMs:
        options?.watchdog?.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS,
      metadataTimeoutMs:
        options?.watchdog?.metadataTimeoutMs ?? DEFAULT_METADATA_TIMEOUT_MS
    };
    this.portableResolution = options?.portable
      ? resolvePortableDataDir(options.portable)
      : { isPortable: false, dataDir: "" };
    this.matrix = {
      privateMemory:
        options?.matrix?.privateMemory ??
        structuredClone(DEFAULT_SYNC_DOMAIN_MATRIX.privateMemory),
      workspaceMemory:
        options?.matrix?.workspaceMemory ??
        structuredClone(DEFAULT_SYNC_DOMAIN_MATRIX.workspaceMemory),
      socialMemory:
        options?.matrix?.socialMemory ??
        structuredClone(DEFAULT_SYNC_DOMAIN_MATRIX.socialMemory),
      commandsAndMcp:
        options?.matrix?.commandsAndMcp ??
        structuredClone(DEFAULT_SYNC_DOMAIN_MATRIX.commandsAndMcp),
      plugins:
        options?.matrix?.plugins ??
        structuredClone(DEFAULT_SYNC_DOMAIN_MATRIX.plugins),
      appearancePresets:
        options?.matrix?.appearancePresets ??
        structuredClone(DEFAULT_SYNC_DOMAIN_MATRIX.appearancePresets),
      usageLedger:
        options?.matrix?.usageLedger ??
        structuredClone(DEFAULT_SYNC_DOMAIN_MATRIX.usageLedger)
    };
    this.resolveSecret = options?.resolveSecret;
    this.kdfParams = options?.kdfParams;
  }

  getEnabledChannels(): SyncChannelKind[] {
    const active: SyncChannelKind[] = [];
    if (this.channels.webdav?.enabled) active.push("webdav");
    if (this.channels.s3?.enabled) active.push("s3");
    if (this.channels.github?.enabled) active.push("github");
    return active;
  }

  getWatchdogConfig(): StallWatchdogConfig {
    return { ...this.watchdog };
  }

  getStatus(): SyncVaultStatus {
    return {
      portable: { ...this.portableResolution },
      enabledChannels: this.getEnabledChannels(),
      watchdog: this.getWatchdogConfig()
    };
  }

  getVaultPaths(): SyncVaultPaths {
    return resolveVaultPaths(this.portableResolution);
  }

  setChannelConfig(kind: "webdav", config: WebDavSyncConfig): void;
  setChannelConfig(kind: "s3", config: S3SyncConfig): void;
  setChannelConfig(kind: "github", config: GitHubSyncConfig): void;
  setChannelConfig(
    kind: SyncChannelKind,
    config: WebDavSyncConfig | S3SyncConfig | GitHubSyncConfig
  ): void {
    if (kind === "webdav") {
      this.channels.webdav = structuredClone(config as WebDavSyncConfig);
    } else if (kind === "s3") {
      this.channels.s3 = structuredClone(config as S3SyncConfig);
    } else {
      this.channels.github = structuredClone(config as GitHubSyncConfig);
    }
  }

  getChannelConfig(kind: "webdav"): WebDavSyncConfig | undefined;
  getChannelConfig(kind: "s3"): S3SyncConfig | undefined;
  getChannelConfig(kind: "github"): GitHubSyncConfig | undefined;
  getChannelConfig(
    kind: SyncChannelKind
  ): WebDavSyncConfig | S3SyncConfig | GitHubSyncConfig | undefined {
    const cfg = this.channels[kind];
    return cfg ? structuredClone(cfg) : undefined;
  }

  /**
   * Toggles a remote sync channel independently. Disabling a channel strictly
   * preserves all previously entered endpoint, credential, and path settings.
   */
  setChannelEnabled(kind: SyncChannelKind, enabled: boolean): void {
    const current = this.channels[kind];
    if (!current) {
      if (enabled) {
        throw new Error(
          `Cannot enable unconfigured sync channel "${kind}".`
        );
      }
      return;
    }
    current.enabled = enabled;
  }

  getSyncMatrix(): SyncDomainMatrix {
    return structuredClone(this.matrix);
  }

  setSyncMatrix(partial: Partial<SyncDomainMatrix>): void {
    this.matrix = {
      ...this.matrix,
      ...structuredClone(partial)
    };
  }

  getChannelClient(kind: "webdav"): WebDavSyncChannel;
  getChannelClient(kind: "s3"): S3SyncChannel;
  getChannelClient(kind: "github"): GitHubSyncChannel;
  getChannelClient(
    kind: SyncChannelKind
  ): WebDavSyncChannel | S3SyncChannel | GitHubSyncChannel {
    const runtimeOpts = {
      resolveSecret: this.resolveSecret,
      stallTimeoutMs: this.watchdog.stallTimeoutMs,
      metadataTimeoutMs: this.watchdog.metadataTimeoutMs
    };

    if (kind === "webdav") {
      if (!this.channels.webdav) {
        throw new Error('Sync channel "webdav" is not configured.');
      }
      return new WebDavSyncChannel(this.channels.webdav, runtimeOpts);
    }
    if (kind === "s3") {
      if (!this.channels.s3) {
        throw new Error('Sync channel "s3" is not configured.');
      }
      return new S3SyncChannel(this.channels.s3, runtimeOpts);
    }
    if (!this.channels.github) {
      throw new Error('Sync channel "github" is not configured.');
    }
    return new GitHubSyncChannel(this.channels.github, runtimeOpts);
  }

  async collectConfiguredRemoteSecrets(): Promise<string[]> {
    const secrets: string[] = [];
    const pushIfPresent = (value: string | undefined): void => {
      if (value && value.length > 0) {
        secrets.push(value);
      }
    };

    if (this.channels.webdav) {
      pushIfPresent(this.channels.webdav.password);
      if (this.channels.webdav.passwordRef && this.resolveSecret) {
        pushIfPresent(
          await this.resolveSecret(this.channels.webdav.passwordRef)
        );
      }
    }
    if (this.channels.s3) {
      pushIfPresent(this.channels.s3.secretAccessKey);
      if (this.channels.s3.secretKeyRef && this.resolveSecret) {
        pushIfPresent(await this.resolveSecret(this.channels.s3.secretKeyRef));
      }
    }
    if (this.channels.github) {
      pushIfPresent(this.channels.github.token);
      if (this.channels.github.tokenRef && this.resolveSecret) {
        pushIfPresent(await this.resolveSecret(this.channels.github.tokenRef));
      }
    }

    return secrets;
  }

  async sealPayload<T>(
    payload: T,
    passphrase: string,
    options?: SealBackupOptions
  ): Promise<Buffer> {
    const remoteSecrets = await this.collectConfiguredRemoteSecrets();
    return sealBackupPayload(payload, passphrase, remoteSecrets, {
      kdfParams: this.kdfParams,
      ...options
    });
  }

  unsealPayload<T = SyncVaultPayload>(
    sealedBytes: Uint8Array,
    passphrase: string
  ): UnsealedBackupResult<T> {
    return unsealBackupPayload<T>(sealedBytes, passphrase);
  }

  async exportOfflineBackup(
    snapshot: OfflineBackupSnapshot,
    options: ExportOfflineBackupOptions
  ): Promise<OfflineBackupExportResult> {
    const configuredSecrets = await this.collectConfiguredRemoteSecrets();
    const mergedSecrets = [
      ...configuredSecrets,
      ...(options.remoteSecrets ?? [])
    ];
    return exportOfflineBackup(snapshot, {
      kdfParams: this.kdfParams,
      ...options,
      remoteSecrets: mergedSecrets
    });
  }

  async pullAndUnseal(
    kind: SyncChannelKind,
    passphrase: string,
    remotePath?: string
  ): Promise<{
    etag: string | null;
    payload: SyncVaultPayload;
    rawPayload: SyncVaultPayload;
  }> {
    const client =
      kind === "webdav"
        ? this.getChannelClient("webdav")
        : kind === "s3"
          ? this.getChannelClient("s3")
          : this.getChannelClient("github");

    const downloaded = await client.download(remotePath);
    const unsealed = unsealBackupPayload<SyncVaultPayload>(
      downloaded.data,
      passphrase
    );
    const filtered = filterInboundPayload(
      unsealed.payload,
      this.matrix,
      this.machineId
    );
    return {
      etag: downloaded.etag,
      payload: filtered,
      rawPayload: unsealed.payload
    };
  }

  private async syncSingleChannel(
    kind: SyncChannelKind,
    options: Required<Pick<SyncNowOptions, "passphrase" | "localPayload">> &
      SyncNowOptions
  ): Promise<ChannelSyncOutcome> {
    const client =
      kind === "webdav"
        ? this.getChannelClient("webdav")
        : kind === "s3"
          ? this.getChannelClient("s3")
          : this.getChannelClient("github");

    const outboundPayload = filterOutboundPayload(
      options.localPayload,
      this.matrix,
      options.targetMachineId
    );
    const sealedBytes = await this.sealPayload(
      outboundPayload,
      options.passphrase
    );

    const writeResult = await client.uploadConditional(
      sealedBytes,
      options.expectedEtag ?? null,
      options.remotePath
    );

    if (!writeResult.conflictDetected) {
      return {
        channel: kind,
        ...writeResult
      };
    }

    if (options.autoMergeOnConflict === false) {
      return {
        channel: kind,
        ...writeResult
      };
    }

    let mergedOutcome: FullPayloadMergeResult | undefined;
    let latestEtag = writeResult.etag;

    try {
      const downloaded = await client.download(options.remotePath);
      latestEtag = downloaded.etag ?? latestEtag;
      const unsealed = unsealBackupPayload<SyncVaultPayload>(
        downloaded.data,
        options.passphrase
      );
      const inboundRemote = filterInboundPayload(
        unsealed.payload,
        this.matrix,
        this.machineId
      );
      mergedOutcome = mergeSyncPayloads(
        options.localPayload,
        inboundRemote,
        options.baseConfig ?? {}
      );
    } catch (err) {
      if (!(err instanceof SyncHttpError && err.statusCode === 404)) {
        throw err;
      }
    }

    if (
      options.retryOnCleanMerge === true &&
      mergedOutcome &&
      mergedOutcome.conflicts.length === 0
    ) {
      const reFiltered = filterOutboundPayload(
        mergedOutcome.merged,
        this.matrix,
        options.targetMachineId
      );
      const reSealed = await this.sealPayload(reFiltered, options.passphrase);
      const retryWrite = await client.uploadConditional(
        reSealed,
        latestEtag,
        options.remotePath
      );
      return {
        channel: kind,
        ...retryWrite,
        mergedPayload: mergedOutcome.merged,
        conflicts: mergedOutcome.conflicts
      };
    }

    return {
      channel: kind,
      etag: latestEtag,
      conflictDetected: true,
      degradedToHead: writeResult.degradedToHead,
      commitSha: writeResult.commitSha,
      mergedPayload: mergedOutcome?.merged,
      conflicts: mergedOutcome?.conflicts
    };
  }

  async syncNow(options?: SyncNowOptions): Promise<SyncNowResult> {
    const enabled = this.getEnabledChannels();
    const targetChannels: SyncChannelKind[] = options?.channel
      ? [options.channel]
      : enabled;

    if (targetChannels.length === 0) {
      return {
        etag: null,
        conflictDetected: false,
        channelResults: []
      };
    }

    for (const kind of targetChannels) {
      if (!this.channels[kind]?.enabled) {
        throw new Error(`Sync channel "${kind}" is disabled or unconfigured.`);
      }
    }

    if (!options?.passphrase || !options.localPayload) {
      throw new Error(
        "Sync execution requires both `passphrase` and `localPayload`."
      );
    }

    const channelResults: ChannelSyncOutcome[] = [];
    for (const kind of targetChannels) {
      const outcome = await this.syncSingleChannel(kind, {
        ...options,
        passphrase: options.passphrase,
        localPayload: options.localPayload
      });
      channelResults.push(outcome);
    }

    const primary = channelResults[0];
    return {
      etag: primary?.etag ?? null,
      conflictDetected: channelResults.some((r) => r.conflictDetected),
      degradedToHead: channelResults.some((r) => r.degradedToHead),
      commitSha: primary?.commitSha,
      mergedPayload: primary?.mergedPayload,
      conflicts: primary?.conflicts,
      channelResults
    };
  }
}
