export const SYNC_VAULT_MILESTONE = "M3" as const;

export const DEFAULT_STALL_TIMEOUT_MS = 60_000 as const;
export const DEFAULT_METADATA_TIMEOUT_MS = 30_000 as const;

export type SyncChannelKind = "webdav" | "s3" | "github";

export interface WebDavSyncConfig {
  enabled: boolean;
  endpointUrl: string;
  username: string;
  passwordRef?: string;
}

export interface S3SyncConfig {
  enabled: boolean;
  endpointUrl: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  allowSelfSignedTls: boolean;
  accessKeyId: string;
  secretKeyRef?: string;
}

export interface GitHubSyncConfig {
  enabled: boolean;
  owner: string;
  repo: string;
  branch: string;
  tokenRef?: string;
}

export interface SyncDomainMatrixEntry {
  upload: boolean;
  download: boolean;
}

export interface SyncDomainMatrix {
  privateMemory: SyncDomainMatrixEntry;
  workspaceMemory: SyncDomainMatrixEntry;
  socialMemory: SyncDomainMatrixEntry;
  commandsAndMcp: SyncDomainMatrixEntry;
  plugins: SyncDomainMatrixEntry;
  appearancePresets: SyncDomainMatrixEntry;
  usageLedger: SyncDomainMatrixEntry;
}

export interface MachineScopedEntry {
  local?: boolean;
  allowedMachines?: string[];
}

export interface StallWatchdogConfig {
  stallTimeoutMs: number;
  metadataTimeoutMs: number;
}

export interface ConditionalWriteResult {
  etag: string | null;
  conflictDetected: boolean;
}

export interface PortableModeResolution {
  isPortable: boolean;
  dataDir: string;
}

export function assertDistinctBackupPassphrase(
  passphrase: string,
  remoteSecrets: string[]
): void {
  if (passphrase.length === 0) {
    throw new Error("Backup encryption passphrase must not be empty.");
  }
  for (const secret of remoteSecrets) {
    if (secret.length > 0 && passphrase === secret) {
      throw new Error(
        "Backup encryption passphrase must not match any S3 Secret Access Key or WebDAV password."
      );
    }
  }
}

export interface SyncVaultStatus {
  portable: PortableModeResolution;
  enabledChannels: SyncChannelKind[];
  watchdog: StallWatchdogConfig;
}

/**
 * Milestone M3 skeleton for passphrase-sealed AEAD multi-device sync & offline backup.
 */
export class SyncVaultEngine {
  private readonly channels: {
    webdav?: WebDavSyncConfig;
    s3?: S3SyncConfig;
    github?: GitHubSyncConfig;
  };
  private readonly watchdog: StallWatchdogConfig;

  constructor(options?: {
    webdav?: WebDavSyncConfig;
    s3?: S3SyncConfig;
    github?: GitHubSyncConfig;
    watchdog?: Partial<StallWatchdogConfig>;
  }) {
    this.channels = {
      webdav: options?.webdav,
      s3: options?.s3,
      github: options?.github
    };
    this.watchdog = {
      stallTimeoutMs:
        options?.watchdog?.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS,
      metadataTimeoutMs:
        options?.watchdog?.metadataTimeoutMs ?? DEFAULT_METADATA_TIMEOUT_MS
    };
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

  async syncNow(): Promise<ConditionalWriteResult> {
    throw new Error(
      `SyncVaultEngine (${SYNC_VAULT_MILESTONE}) sync execution lands in M3.`
    );
  }
}
