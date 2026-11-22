export const SYNC_VAULT_MILESTONE = "M3" as const;

export const DEFAULT_STALL_TIMEOUT_MS = 60_000 as const;
export const DEFAULT_METADATA_TIMEOUT_MS = 30_000 as const;

export type SyncChannelKind = "webdav" | "s3" | "github";

export type SecretResolver = (
  secretRef: string
) => string | undefined | Promise<string | undefined>;

export interface WebDavSyncConfig {
  enabled: boolean;
  endpointUrl: string;
  username: string;
  passwordRef?: string;
  password?: string;
  remotePath?: string;
  allowSelfSignedTls?: boolean;
  stallTimeoutMs?: number;
  metadataTimeoutMs?: number;
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
  secretAccessKey?: string;
  keyPrefix?: string;
  remoteKey?: string;
  stallTimeoutMs?: number;
  metadataTimeoutMs?: number;
}

export interface GitHubSyncConfig {
  enabled: boolean;
  owner: string;
  repo: string;
  branch: string;
  tokenRef?: string;
  token?: string;
  apiBaseUrl?: string;
  filePath?: string;
  stallTimeoutMs?: number;
  metadataTimeoutMs?: number;
}

export type SyncDomainKey =
  | "privateMemory"
  | "workspaceMemory"
  | "socialMemory"
  | "commandsAndMcp"
  | "plugins"
  | "appearancePresets"
  | "usageLedger";

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

export const DEFAULT_SYNC_DOMAIN_MATRIX: SyncDomainMatrix = {
  privateMemory: { upload: true, download: true },
  workspaceMemory: { upload: true, download: true },
  socialMemory: { upload: true, download: true },
  commandsAndMcp: { upload: true, download: true },
  plugins: { upload: true, download: true },
  appearancePresets: { upload: true, download: true },
  usageLedger: { upload: true, download: true }
};

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
  degradedToHead?: boolean;
  commitSha?: string;
}

export interface PortableModeResolution {
  isPortable: boolean;
  dataDir: string;
}

export interface SyncVaultStatus {
  portable: PortableModeResolution;
  enabledChannels: SyncChannelKind[];
  watchdog: StallWatchdogConfig;
}

export function assertDistinctBackupPassphrase(
  passphrase: string,
  remoteSecrets: readonly string[]
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
