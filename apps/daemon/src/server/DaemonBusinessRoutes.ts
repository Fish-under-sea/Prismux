import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ChecksumMismatchError,
  CordisPluginHost,
  CordisStreamingInstaller,
  EncryptedPluginCredentialStore,
  EngineIncompatibleError,
  PermissionAuditRequiredError,
  RegistryHttpError,
  RegistryNetworkError,
  type CordisPluginModule,
  type InstalledPluginDetails
} from "@prismux/cordis-kernel";
import type { SqliteMemoryStore } from "@prismux/memory-core";
import {
  CHIEF_PROVIDER_KINDS,
  DIAL_MODES,
  MEMORY_KINDS,
  isValidMemoryNamespace,
  type CallerScope,
  type ChiefProviderKind,
  type DialMode,
  type InstalledPluginRecord,
  type MemoryKind,
  type MemoryNamespace,
  type MemoryQueryRequest,
  type MemoryQueryResponse,
  type NetworkRoutePreference,
  type OfficialPluginCatalogEntry,
  type PrismuxPluginModule
} from "@prismux/protocol";
import type {
  GitHubSyncConfig,
  S3SyncConfig,
  SyncChannelKind,
  SyncDomainMatrix,
  SyncVaultEngine,
  WebDavSyncConfig
} from "@prismux/sync-vault";
import type { ChiefThreadManager } from "../chief/ChiefThreadManager.js";
import type { HandoffEngine } from "../handoff/HandoffEngine.js";
import type { T3RpcClient } from "../t3/T3RpcClient.js";
import { isPathStrictlyInsideDir } from "../wallpapers/WallpaperMediaService.js";

const SYNC_CREDENTIAL_BUCKET = "sync-vault" as const;
const SYNC_INSTALL_META_FILENAME = ".prismux-install.json" as const;

export class BusinessRouteError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.name = "BusinessRouteError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface PersistedSanitizedSyncConfig {
  schemaVersion: 1;
  updatedAt: number;
  channels: {
    webdav?: {
      enabled: boolean;
      endpointUrl: string;
      username: string;
      remotePath?: string;
      allowSelfSignedTls?: boolean;
      stallTimeoutMs?: number;
      metadataTimeoutMs?: number;
      passwordRef?: string;
    };
    s3?: {
      enabled: boolean;
      endpointUrl: string;
      region: string;
      bucket: string;
      forcePathStyle: boolean;
      allowSelfSignedTls: boolean;
      accessKeyId: string;
      keyPrefix?: string;
      remoteKey?: string;
      stallTimeoutMs?: number;
      metadataTimeoutMs?: number;
      secretKeyRef?: string;
    };
    github?: {
      enabled: boolean;
      owner: string;
      repo: string;
      branch: string;
      apiBaseUrl?: string;
      filePath?: string;
      stallTimeoutMs?: number;
      metadataTimeoutMs?: number;
      tokenRef?: string;
    };
  };
  syncMatrix: SyncDomainMatrix;
}

export interface DaemonBusinessContext {
  dataDir: string;
  hostVersion: string;
  officialCatalogPath?: string;
  chiefManager?: ChiefThreadManager;
  handoffEngine?: HandoffEngine;
  t3RpcClient?: T3RpcClient;
  memoryStore?: SqliteMemoryStore;
  memoryDbPath?: string;
  syncVault?: SyncVaultEngine;
  pluginHost?: CordisPluginHost;
  pluginInstaller?: CordisStreamingInstaller;
  pluginCredentialStore?: EncryptedPluginCredentialStore;
  onMountPlugin?: (
    record: InstalledPluginRecord,
    module: PrismuxPluginModule | CordisPluginModule
  ) => Promise<void>;
  onTogglePlugin?: (
    pluginId: string,
    enabled: boolean
  ) => Promise<{ pluginId: string; enabled: boolean }>;
  onUninstallPlugin?: (pluginId: string) => Promise<void>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(
    dir,
    `.tmp-${basename(filePath)}-${process.pid}-${randomUUID()}`
  );
  try {
    writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

export function resolveDefaultOfficialCatalogPath(explicitPath?: string): string | null {
  if (explicitPath && existsSync(explicitPath)) {
    return resolve(explicitPath);
  }
  const envPath = process.env["PRISMUX_CATALOG_PATH"]?.trim();
  if (envPath && existsSync(envPath)) {
    return resolve(envPath);
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const cliRelativeCandidates = [
    resolve(moduleDir, "catalog", "official.json"),
    resolve(moduleDir, "..", "catalog", "official.json"),
    resolve(moduleDir, "..", "..", "catalog", "official.json"),
    resolve(process.cwd(), "catalog", "official.json")
  ];
  for (const candidate of cliRelativeCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const searchRoots = [moduleDir, process.cwd()];
  for (const startDir of searchRoots) {
    let cur = resolve(startDir);
    for (let depth = 0; depth < 8; depth += 1) {
      const candidate = join(cur, "plugins-official", "catalog", "official.json");
      if (existsSync(candidate)) {
        return candidate;
      }
      const parent = dirname(cur);
      if (parent === cur) {
        break;
      }
      cur = parent;
    }
  }
  return null;
}

function assertOwnerChief(
  trustedCallerScope: CallerScope,
  resourceName: string
): void {
  if (trustedCallerScope !== "owner_chief") {
    throw new BusinessRouteError(
      403,
      "FORBIDDEN_SCOPE",
      `Scope "${trustedCallerScope}" is not permitted to access ${resourceName}.`
    );
  }
}

function parseProvider(value: unknown): ChiefProviderKind {
  if (
    typeof value === "string" &&
    (CHIEF_PROVIDER_KINDS as readonly string[]).includes(value)
  ) {
    return value as ChiefProviderKind;
  }
  throw new BusinessRouteError(
    400,
    "INVALID_PROVIDER",
    `provider must be one of: ${CHIEF_PROVIDER_KINDS.join(", ")}.`
  );
}

function parseDialMode(value: unknown): DialMode {
  if (
    typeof value === "string" &&
    (DIAL_MODES as readonly string[]).includes(value)
  ) {
    return value as DialMode;
  }
  throw new BusinessRouteError(
    400,
    "INVALID_DIAL_MODE",
    `dialMode must be one of: ${DIAL_MODES.join(", ")}.`
  );
}

function sanitizeWebDavConfig(
  cfg: WebDavSyncConfig | undefined
): PersistedSanitizedSyncConfig["channels"]["webdav"] | undefined {
  if (!cfg) {
    return undefined;
  }
  return {
    enabled: cfg.enabled,
    endpointUrl: cfg.endpointUrl,
    username: cfg.username,
    ...(cfg.remotePath !== undefined ? { remotePath: cfg.remotePath } : {}),
    ...(cfg.allowSelfSignedTls !== undefined
      ? { allowSelfSignedTls: cfg.allowSelfSignedTls }
      : {}),
    ...(cfg.stallTimeoutMs !== undefined
      ? { stallTimeoutMs: cfg.stallTimeoutMs }
      : {}),
    ...(cfg.metadataTimeoutMs !== undefined
      ? { metadataTimeoutMs: cfg.metadataTimeoutMs }
      : {}),
    ...(cfg.passwordRef !== undefined ? { passwordRef: cfg.passwordRef } : {})
  };
}

function sanitizeS3Config(
  cfg: S3SyncConfig | undefined
): PersistedSanitizedSyncConfig["channels"]["s3"] | undefined {
  if (!cfg) {
    return undefined;
  }
  return {
    enabled: cfg.enabled,
    endpointUrl: cfg.endpointUrl,
    region: cfg.region,
    bucket: cfg.bucket,
    forcePathStyle: cfg.forcePathStyle,
    allowSelfSignedTls: cfg.allowSelfSignedTls,
    accessKeyId: cfg.accessKeyId,
    ...(cfg.keyPrefix !== undefined ? { keyPrefix: cfg.keyPrefix } : {}),
    ...(cfg.remoteKey !== undefined ? { remoteKey: cfg.remoteKey } : {}),
    ...(cfg.stallTimeoutMs !== undefined
      ? { stallTimeoutMs: cfg.stallTimeoutMs }
      : {}),
    ...(cfg.metadataTimeoutMs !== undefined
      ? { metadataTimeoutMs: cfg.metadataTimeoutMs }
      : {}),
    ...(cfg.secretKeyRef !== undefined ? { secretKeyRef: cfg.secretKeyRef } : {})
  };
}

function sanitizeGitHubConfig(
  cfg: GitHubSyncConfig | undefined
): PersistedSanitizedSyncConfig["channels"]["github"] | undefined {
  if (!cfg) {
    return undefined;
  }
  return {
    enabled: cfg.enabled,
    owner: cfg.owner,
    repo: cfg.repo,
    branch: cfg.branch,
    ...(cfg.apiBaseUrl !== undefined ? { apiBaseUrl: cfg.apiBaseUrl } : {}),
    ...(cfg.filePath !== undefined ? { filePath: cfg.filePath } : {}),
    ...(cfg.stallTimeoutMs !== undefined
      ? { stallTimeoutMs: cfg.stallTimeoutMs }
      : {}),
    ...(cfg.metadataTimeoutMs !== undefined
      ? { metadataTimeoutMs: cfg.metadataTimeoutMs }
      : {}),
    ...(cfg.tokenRef !== undefined ? { tokenRef: cfg.tokenRef } : {})
  };
}

function isSyncDomainKey(
  value: string
): value is keyof SyncDomainMatrix {
  return (
    value === "privateMemory" ||
    value === "workspaceMemory" ||
    value === "socialMemory" ||
    value === "commandsAndMcp" ||
    value === "plugins" ||
    value === "appearancePresets" ||
    value === "usageLedger"
  );
}

function findOfficialArchiveInSearchDirs(
  entry: OfficialPluginCatalogEntry,
  searchRoots: readonly string[]
): Buffer | null {
  const filename = `${entry.id}-${entry.version}.wb-plugin`;
  for (const root of searchRoots) {
    const candidates = [
      join(root, "plugins-official", "dist", filename),
      join(root, ".work", "plugin-dist", filename)
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return readFileSync(candidate);
      }
    }
  }
  return null;
}

function updateInstallMetadataEnabledFlag(
  installDir: string,
  enabled: boolean
): InstalledPluginRecord | null {
  const metaPath = join(installDir, SYNC_INSTALL_META_FILENAME);
  if (!existsSync(metaPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(metaPath, "utf8")) as unknown;
    if (!isPlainRecord(parsed)) {
      return null;
    }
    parsed["enabled"] = enabled;
    writeJsonAtomic(metaPath, parsed);
    return parsed as unknown as InstalledPluginRecord;
  } catch {
    return null;
  }
}

async function tryLoadDaemonPluginModule(
  pluginsDir: string,
  record: InstalledPluginRecord
): Promise<PrismuxPluginModule | CordisPluginModule | null> {
  const pluginDir = join(pluginsDir, record.manifest.id);
  if (!existsSync(pluginDir)) {
    return null;
  }
  const pkgJsonPath = join(pluginDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    return null;
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as unknown;
    if (!isPlainRecord(pkg)) {
      return null;
    }
    let relEntry: string | null = null;
    if (isPlainRecord(pkg["exports"])) {
      const daemonExp = pkg["exports"]["./daemon"] ?? pkg["exports"]["."];
      if (typeof daemonExp === "string") {
        relEntry = daemonExp;
      } else if (isPlainRecord(daemonExp) && typeof daemonExp["import"] === "string") {
        relEntry = daemonExp["import"];
      }
    }
    if (!relEntry && typeof pkg["main"] === "string") {
      relEntry = pkg["main"];
    }
    if (!relEntry) {
      return null;
    }
    const candidate = resolve(pluginDir, relEntry);
    if (
      !isPathStrictlyInsideDir(candidate, pluginDir) ||
      !existsSync(candidate)
    ) {
      return null;
    }
    const loaded = (await import(pathToFileURL(candidate).href)) as Record<
      string,
      unknown
    >;
    const modCandidate =
      isPlainRecord(loaded["default"]) &&
      typeof loaded["default"]["apply"] === "function"
        ? loaded["default"]
        : typeof loaded["apply"] === "function"
          ? loaded
          : null;
    if (!modCandidate) {
      return null;
    }
    const modManifest = isPlainRecord(modCandidate["manifest"])
      ? modCandidate["manifest"]
      : record.manifest;
    return {
      manifest: modManifest as PrismuxPluginModule["manifest"],
      apply: modCandidate["apply"] as CordisPluginModule["apply"]
    };
  } catch {
    return null;
  }
}

/**
 * Coordinates real-data HTTP endpoints for Chief Supervisor, Memory Engine,
 * Sync Vault, and Cordis Plugin marketplace/runtime inside `apps/daemon`.
 */
export class DaemonBusinessService {
  readonly syncConfigPath: string;
  private readonly ctx: DaemonBusinessContext;

  constructor(ctx: DaemonBusinessContext) {
    this.ctx = ctx;
    this.syncConfigPath = join(resolve(ctx.dataDir), "sync-config.json");
  }

  /**
   * Restores non-sensitive sync configuration from `<dataDir>/sync-config.json`
   * into `SyncVaultEngine` on daemon startup without touching plaintext secrets.
   */
  restorePersistedSyncConfig(): void {
    const syncVault = this.ctx.syncVault;
    if (!syncVault || !existsSync(this.syncConfigPath)) {
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(this.syncConfigPath, "utf8")) as unknown;
      if (!isPlainRecord(raw)) {
        return;
      }
      if (isPlainRecord(raw["syncMatrix"])) {
        const partial: Partial<SyncDomainMatrix> = {};
        for (const [key, val] of Object.entries(raw["syncMatrix"])) {
          if (isSyncDomainKey(key) && isPlainRecord(val)) {
            partial[key] = {
              upload: Boolean(val["upload"]),
              download: Boolean(val["download"])
            };
          }
        }
        syncVault.setSyncMatrix(partial);
      }

      if (isPlainRecord(raw["channels"])) {
        const webdav = raw["channels"]["webdav"];
        if (isPlainRecord(webdav) && typeof webdav["endpointUrl"] === "string") {
          syncVault.setChannelConfig("webdav", {
            enabled: Boolean(webdav["enabled"]),
            endpointUrl: webdav["endpointUrl"],
            username:
              typeof webdav["username"] === "string" ? webdav["username"] : "",
            ...(typeof webdav["remotePath"] === "string"
              ? { remotePath: webdav["remotePath"] }
              : {}),
            ...(typeof webdav["allowSelfSignedTls"] === "boolean"
              ? { allowSelfSignedTls: webdav["allowSelfSignedTls"] }
              : {}),
            ...(typeof webdav["passwordRef"] === "string"
              ? { passwordRef: webdav["passwordRef"] }
              : {})
          });
        }

        const s3 = raw["channels"]["s3"];
        if (isPlainRecord(s3) && typeof s3["endpointUrl"] === "string") {
          syncVault.setChannelConfig("s3", {
            enabled: Boolean(s3["enabled"]),
            endpointUrl: s3["endpointUrl"],
            region: typeof s3["region"] === "string" ? s3["region"] : "us-east-1",
            bucket: typeof s3["bucket"] === "string" ? s3["bucket"] : "",
            forcePathStyle: s3["forcePathStyle"] !== false,
            allowSelfSignedTls: Boolean(s3["allowSelfSignedTls"]),
            accessKeyId:
              typeof s3["accessKeyId"] === "string" ? s3["accessKeyId"] : "",
            ...(typeof s3["keyPrefix"] === "string"
              ? { keyPrefix: s3["keyPrefix"] }
              : {}),
            ...(typeof s3["remoteKey"] === "string"
              ? { remoteKey: s3["remoteKey"] }
              : {}),
            ...(typeof s3["secretKeyRef"] === "string"
              ? { secretKeyRef: s3["secretKeyRef"] }
              : {})
          });
        }

        const github = raw["channels"]["github"];
        if (isPlainRecord(github) && typeof github["owner"] === "string") {
          syncVault.setChannelConfig("github", {
            enabled: Boolean(github["enabled"]),
            owner: github["owner"],
            repo: typeof github["repo"] === "string" ? github["repo"] : "",
            branch:
              typeof github["branch"] === "string" ? github["branch"] : "main",
            ...(typeof github["apiBaseUrl"] === "string"
              ? { apiBaseUrl: github["apiBaseUrl"] }
              : {}),
            ...(typeof github["filePath"] === "string"
              ? { filePath: github["filePath"] }
              : {}),
            ...(typeof github["tokenRef"] === "string"
              ? { tokenRef: github["tokenRef"] }
              : {})
          });
        }
      }
    } catch {
      // Ignore corrupt sync-config.json on startup rather than crashing daemon
    }
  }

  getChiefStatus(trustedCallerScope: CallerScope): Record<string, unknown> {
    assertOwnerChief(trustedCallerScope, "/v1/chief");
    if (!this.ctx.chiefManager) {
      throw new BusinessRouteError(
        503,
        "CHIEF_UNAVAILABLE",
        "ChiefThreadManager is not initialized."
      );
    }
    const slot = this.ctx.chiefManager.getSlot();
    const dialMode =
      this.ctx.handoffEngine?.getDialMode(slot.threadId) ?? "agent";
    return {
      ok: true,
      slot,
      dialMode,
      availableProviders: [...CHIEF_PROVIDER_KINDS],
      availableDialModes: [...DIAL_MODES],
      t3Connected: this.ctx.t3RpcClient?.isConnected() ?? false
    };
  }

  async switchChief(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): Promise<Record<string, unknown>> {
    assertOwnerChief(trustedCallerScope, "/v1/chief/switch");
    if (!this.ctx.chiefManager) {
      throw new BusinessRouteError(
        503,
        "CHIEF_UNAVAILABLE",
        "ChiefThreadManager is not initialized."
      );
    }
    if (!isPlainRecord(rawBody)) {
      throw new BusinessRouteError(
        400,
        "INVALID_PARAMS",
        "Request body must be a JSON object."
      );
    }

    const provider = parseProvider(rawBody["provider"]);
    const model =
      typeof rawBody["model"] === "string" && rawBody["model"].trim().length > 0
        ? rawBody["model"].trim()
        : undefined;
    const dialMode =
      rawBody["dialMode"] !== undefined
        ? parseDialMode(rawBody["dialMode"])
        : undefined;

    const slot = await this.ctx.chiefManager.switchProvider(provider, model);
    if (dialMode !== undefined && this.ctx.handoffEngine) {
      this.ctx.handoffEngine.setDialMode(slot.threadId, dialMode);
    }

    return {
      ok: true,
      slot,
      dialMode: this.ctx.handoffEngine?.getDialMode(slot.threadId) ?? "agent"
    };
  }

  async getMemoryStats(
    trustedCallerScope: CallerScope
  ): Promise<Record<string, unknown>> {
    if (!this.ctx.memoryStore) {
      throw new BusinessRouteError(
        503,
        "MEMORY_UNAVAILABLE",
        "SqliteMemoryStore is not configured."
      );
    }

    const byNamespace: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    let totalEntries = 0;
    let latestUpdatedAt: number | null = null;
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const batch = await this.ctx.memoryStore.listEntries(trustedCallerScope, {
        limit: pageSize,
        offset
      });
      for (const entry of batch) {
        totalEntries += 1;
        byNamespace[entry.namespace] = (byNamespace[entry.namespace] ?? 0) + 1;
        byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
        if (latestUpdatedAt === null || entry.updatedAt > latestUpdatedAt) {
          latestUpdatedAt = entry.updatedAt;
        }
      }
      if (batch.length < pageSize) {
        break;
      }
      offset += batch.length;
    }

    return {
      ok: true,
      callerScope: trustedCallerScope,
      totalEntries,
      vectorSearchEnabled: this.ctx.memoryStore.isVectorSearchEnabled(),
      byNamespace,
      byKind,
      latestUpdatedAt,
      ...(this.ctx.memoryDbPath !== undefined
        ? { dbPath: this.ctx.memoryDbPath }
        : {})
    };
  }

  async searchMemory(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): Promise<MemoryQueryResponse> {
    if (!this.ctx.memoryStore) {
      throw new BusinessRouteError(
        503,
        "MEMORY_UNAVAILABLE",
        "SqliteMemoryStore is not configured."
      );
    }
    if (!isPlainRecord(rawBody)) {
      throw new BusinessRouteError(
        400,
        "INVALID_PARAMS",
        "Request body must be a JSON object."
      );
    }

    const queryText =
      typeof rawBody["query"] === "string" ? rawBody["query"].trim() : "";

    let namespaces: MemoryNamespace[] | undefined;
    if (Array.isArray(rawBody["namespaces"])) {
      const valid = rawBody["namespaces"].filter(
        (ns): ns is MemoryNamespace =>
          typeof ns === "string" && isValidMemoryNamespace(ns)
      );
      if (valid.length === 0 && rawBody["namespaces"].length > 0) {
        return {
          hits: [],
          totalCandidates: 0,
          degradedToFtsOnly: !this.ctx.memoryStore.isVectorSearchEnabled()
        };
      }
      namespaces = valid;
    }

    let kinds: MemoryKind[] | undefined;
    if (Array.isArray(rawBody["kinds"])) {
      const validKinds = rawBody["kinds"].filter(
        (k): k is MemoryKind =>
          typeof k === "string" &&
          (MEMORY_KINDS as readonly string[]).includes(k)
      );
      kinds = validKinds;
    }

    const limit =
      typeof rawBody["limit"] === "number" && Number.isFinite(rawBody["limit"])
        ? Math.max(1, Math.min(200, Math.floor(rawBody["limit"])))
        : 20;

    if (queryText.length === 0) {
      const entries = await this.ctx.memoryStore.listEntries(
        trustedCallerScope,
        {
          ...(namespaces !== undefined ? { namespaces } : {}),
          ...(kinds !== undefined ? { kinds } : {}),
          limit
        }
      );
      return {
        hits: entries.map((entry) => ({
          entry,
          score: 1,
          matchSource: "fts" as const
        })),
        totalCandidates: entries.length,
        degradedToFtsOnly: !this.ctx.memoryStore.isVectorSearchEnabled()
      };
    }

    const mode: MemoryQueryRequest["mode"] =
      rawBody["mode"] === "hybrid" ||
      rawBody["mode"] === "fts" ||
      rawBody["mode"] === "vector"
        ? rawBody["mode"]
        : undefined;

    const queryEmbedding = Array.isArray(rawBody["queryEmbedding"])
      ? rawBody["queryEmbedding"].filter(
          (n): n is number => typeof n === "number" && Number.isFinite(n)
        )
      : undefined;

    return this.ctx.memoryStore.query(
      {
        callerScope: trustedCallerScope,
        query: queryText,
        ...(namespaces !== undefined ? { namespaces } : {}),
        ...(kinds !== undefined ? { kinds } : {}),
        limit,
        ...(mode !== undefined ? { mode } : {})
      },
      trustedCallerScope,
      queryEmbedding
    );
  }

  async getSyncStatus(
    trustedCallerScope: CallerScope
  ): Promise<Record<string, unknown>> {
    assertOwnerChief(trustedCallerScope, "/v1/sync/status");
    if (!this.ctx.syncVault) {
      throw new BusinessRouteError(
        503,
        "SYNC_UNAVAILABLE",
        "SyncVaultEngine is not initialized."
      );
    }

    const credHandle =
      this.ctx.pluginCredentialStore?.openForPlugin(SYNC_CREDENTIAL_BUCKET);
    const hasWebdavSecret = credHandle
      ? (await credHandle.get("webdav.password")) !== undefined
      : false;
    const hasS3Secret = credHandle
      ? (await credHandle.get("s3.secretAccessKey")) !== undefined
      : false;
    const hasGithubSecret = credHandle
      ? (await credHandle.get("github.token")) !== undefined
      : false;
    const hasPassphrase = credHandle
      ? (await credHandle.get("vault.passphrase")) !== undefined
      : false;

    const webdavCfg = sanitizeWebDavConfig(
      this.ctx.syncVault.getChannelConfig("webdav")
    );
    const s3Cfg = sanitizeS3Config(this.ctx.syncVault.getChannelConfig("s3"));
    const githubCfg = sanitizeGitHubConfig(
      this.ctx.syncVault.getChannelConfig("github")
    );

    return {
      ok: true,
      status: this.ctx.syncVault.getStatus(),
      syncMatrix: this.ctx.syncVault.getSyncMatrix(),
      vaultPaths: this.ctx.syncVault.getVaultPaths(),
      channels: {
        webdav: webdavCfg ? { ...webdavCfg, hasSecret: hasWebdavSecret } : null,
        s3: s3Cfg ? { ...s3Cfg, hasSecret: hasS3Secret } : null,
        github: githubCfg ? { ...githubCfg, hasSecret: hasGithubSecret } : null
      },
      hasPassphrase,
      configPath: this.syncConfigPath
    };
  }

  async updateSyncConfig(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): Promise<Record<string, unknown>> {
    assertOwnerChief(trustedCallerScope, "/v1/sync/config");
    if (!this.ctx.syncVault) {
      throw new BusinessRouteError(
        503,
        "SYNC_UNAVAILABLE",
        "SyncVaultEngine is not initialized."
      );
    }
    if (!isPlainRecord(rawBody)) {
      throw new BusinessRouteError(
        400,
        "INVALID_PARAMS",
        "Request body must be a JSON object."
      );
    }

    const credHandle =
      this.ctx.pluginCredentialStore?.openForPlugin(SYNC_CREDENTIAL_BUCKET);

    if (
      typeof rawBody["passphrase"] === "string" &&
      rawBody["passphrase"].length > 0 &&
      credHandle
    ) {
      await credHandle.set("vault.passphrase", rawBody["passphrase"]);
    }

    if (isPlainRecord(rawBody["syncMatrix"])) {
      const partial: Partial<SyncDomainMatrix> = {};
      for (const [key, entry] of Object.entries(rawBody["syncMatrix"])) {
        if (isSyncDomainKey(key) && isPlainRecord(entry)) {
          partial[key] = {
            upload:
              typeof entry["upload"] === "boolean"
                ? entry["upload"]
                : this.ctx.syncVault.getSyncMatrix()[key].upload,
            download:
              typeof entry["download"] === "boolean"
                ? entry["download"]
                : this.ctx.syncVault.getSyncMatrix()[key].download
          };
        }
      }
      this.ctx.syncVault.setSyncMatrix(partial);
    }

    if (isPlainRecord(rawBody["channels"])) {
      const webdavRaw = rawBody["channels"]["webdav"];
      if (isPlainRecord(webdavRaw)) {
        const existing = this.ctx.syncVault.getChannelConfig("webdav");
        if (
          typeof webdavRaw["password"] === "string" &&
          webdavRaw["password"].length > 0 &&
          credHandle
        ) {
          await credHandle.set("webdav.password", webdavRaw["password"]);
        }
        const endpointUrl =
          typeof webdavRaw["endpointUrl"] === "string"
            ? webdavRaw["endpointUrl"].trim()
            : (existing?.endpointUrl ?? "");
        if (endpointUrl.length > 0) {
          const passwordRef =
            typeof webdavRaw["passwordRef"] === "string"
              ? webdavRaw["passwordRef"]
              : (existing?.passwordRef ??
                (typeof webdavRaw["password"] === "string" &&
                webdavRaw["password"].length > 0
                  ? `${SYNC_CREDENTIAL_BUCKET}:webdav.password`
                  : undefined));
          this.ctx.syncVault.setChannelConfig("webdav", {
            enabled:
              typeof webdavRaw["enabled"] === "boolean"
                ? webdavRaw["enabled"]
                : (existing?.enabled ?? false),
            endpointUrl,
            username:
              typeof webdavRaw["username"] === "string"
                ? webdavRaw["username"]
                : (existing?.username ?? ""),
            ...(typeof webdavRaw["remotePath"] === "string"
              ? { remotePath: webdavRaw["remotePath"] }
              : existing?.remotePath !== undefined
                ? { remotePath: existing.remotePath }
                : {}),
            ...(typeof webdavRaw["allowSelfSignedTls"] === "boolean"
              ? { allowSelfSignedTls: webdavRaw["allowSelfSignedTls"] }
              : existing?.allowSelfSignedTls !== undefined
                ? { allowSelfSignedTls: existing.allowSelfSignedTls }
                : {}),
            ...(passwordRef !== undefined ? { passwordRef } : {})
          });
        } else if (typeof webdavRaw["enabled"] === "boolean" && existing) {
          this.ctx.syncVault.setChannelEnabled("webdav", webdavRaw["enabled"]);
        }
      }

      const s3Raw = rawBody["channels"]["s3"];
      if (isPlainRecord(s3Raw)) {
        const existing = this.ctx.syncVault.getChannelConfig("s3");
        if (
          typeof s3Raw["secretAccessKey"] === "string" &&
          s3Raw["secretAccessKey"].length > 0 &&
          credHandle
        ) {
          await credHandle.set("s3.secretAccessKey", s3Raw["secretAccessKey"]);
        }
        const endpointUrl =
          typeof s3Raw["endpointUrl"] === "string"
            ? s3Raw["endpointUrl"].trim()
            : (existing?.endpointUrl ?? "");
        const bucket =
          typeof s3Raw["bucket"] === "string"
            ? s3Raw["bucket"].trim()
            : (existing?.bucket ?? "");
        if (endpointUrl.length > 0 && bucket.length > 0) {
          const secretKeyRef =
            typeof s3Raw["secretKeyRef"] === "string"
              ? s3Raw["secretKeyRef"]
              : (existing?.secretKeyRef ??
                (typeof s3Raw["secretAccessKey"] === "string" &&
                s3Raw["secretAccessKey"].length > 0
                  ? `${SYNC_CREDENTIAL_BUCKET}:s3.secretAccessKey`
                  : undefined));
          this.ctx.syncVault.setChannelConfig("s3", {
            enabled:
              typeof s3Raw["enabled"] === "boolean"
                ? s3Raw["enabled"]
                : (existing?.enabled ?? false),
            endpointUrl,
            region:
              typeof s3Raw["region"] === "string"
                ? s3Raw["region"]
                : (existing?.region ?? "us-east-1"),
            bucket,
            forcePathStyle:
              typeof s3Raw["forcePathStyle"] === "boolean"
                ? s3Raw["forcePathStyle"]
                : (existing?.forcePathStyle ?? true),
            allowSelfSignedTls:
              typeof s3Raw["allowSelfSignedTls"] === "boolean"
                ? s3Raw["allowSelfSignedTls"]
                : (existing?.allowSelfSignedTls ?? false),
            accessKeyId:
              typeof s3Raw["accessKeyId"] === "string"
                ? s3Raw["accessKeyId"]
                : (existing?.accessKeyId ?? ""),
            ...(typeof s3Raw["keyPrefix"] === "string"
              ? { keyPrefix: s3Raw["keyPrefix"] }
              : existing?.keyPrefix !== undefined
                ? { keyPrefix: existing.keyPrefix }
                : {}),
            ...(typeof s3Raw["remoteKey"] === "string"
              ? { remoteKey: s3Raw["remoteKey"] }
              : existing?.remoteKey !== undefined
                ? { remoteKey: existing.remoteKey }
                : {}),
            ...(secretKeyRef !== undefined ? { secretKeyRef } : {})
          });
        } else if (typeof s3Raw["enabled"] === "boolean" && existing) {
          this.ctx.syncVault.setChannelEnabled("s3", s3Raw["enabled"]);
        }
      }

      const githubRaw = rawBody["channels"]["github"];
      if (isPlainRecord(githubRaw)) {
        const existing = this.ctx.syncVault.getChannelConfig("github");
        if (
          typeof githubRaw["token"] === "string" &&
          githubRaw["token"].length > 0 &&
          credHandle
        ) {
          await credHandle.set("github.token", githubRaw["token"]);
        }
        const owner =
          typeof githubRaw["owner"] === "string"
            ? githubRaw["owner"].trim()
            : (existing?.owner ?? "");
        const repo =
          typeof githubRaw["repo"] === "string"
            ? githubRaw["repo"].trim()
            : (existing?.repo ?? "");
        if (owner.length > 0 && repo.length > 0) {
          const tokenRef =
            typeof githubRaw["tokenRef"] === "string"
              ? githubRaw["tokenRef"]
              : (existing?.tokenRef ??
                (typeof githubRaw["token"] === "string" &&
                githubRaw["token"].length > 0
                  ? `${SYNC_CREDENTIAL_BUCKET}:github.token`
                  : undefined));
          this.ctx.syncVault.setChannelConfig("github", {
            enabled:
              typeof githubRaw["enabled"] === "boolean"
                ? githubRaw["enabled"]
                : (existing?.enabled ?? false),
            owner,
            repo,
            branch:
              typeof githubRaw["branch"] === "string"
                ? githubRaw["branch"]
                : (existing?.branch ?? "main"),
            ...(typeof githubRaw["apiBaseUrl"] === "string"
              ? { apiBaseUrl: githubRaw["apiBaseUrl"] }
              : existing?.apiBaseUrl !== undefined
                ? { apiBaseUrl: existing.apiBaseUrl }
                : {}),
            ...(typeof githubRaw["filePath"] === "string"
              ? { filePath: githubRaw["filePath"] }
              : existing?.filePath !== undefined
                ? { filePath: existing.filePath }
                : {}),
            ...(tokenRef !== undefined ? { tokenRef } : {})
          });
        } else if (typeof githubRaw["enabled"] === "boolean" && existing) {
          this.ctx.syncVault.setChannelEnabled("github", githubRaw["enabled"]);
        }
      }
    }

    const sanitizedPersist: PersistedSanitizedSyncConfig = {
      schemaVersion: 1,
      updatedAt: Date.now(),
      channels: {
        ...(this.ctx.syncVault.getChannelConfig("webdav")
          ? {
              webdav: sanitizeWebDavConfig(
                this.ctx.syncVault.getChannelConfig("webdav")
              )
            }
          : {}),
        ...(this.ctx.syncVault.getChannelConfig("s3")
          ? {
              s3: sanitizeS3Config(this.ctx.syncVault.getChannelConfig("s3"))
            }
          : {}),
        ...(this.ctx.syncVault.getChannelConfig("github")
          ? {
              github: sanitizeGitHubConfig(
                this.ctx.syncVault.getChannelConfig("github")
              )
            }
          : {})
      },
      syncMatrix: this.ctx.syncVault.getSyncMatrix()
    };

    writeJsonAtomic(this.syncConfigPath, sanitizedPersist);
    return this.getSyncStatus(trustedCallerScope);
  }

  async getPluginsCatalog(
    trustedCallerScope: CallerScope
  ): Promise<Record<string, unknown>> {
    assertOwnerChief(trustedCallerScope, "/v1/plugins/catalog");
    if (!this.ctx.pluginInstaller) {
      throw new BusinessRouteError(
        503,
        "PLUGIN_INSTALLER_UNAVAILABLE",
        "CordisStreamingInstaller is not initialized."
      );
    }

    const catalogPath = resolveDefaultOfficialCatalogPath(
      this.ctx.officialCatalogPath
    );
    if (!catalogPath) {
      throw new BusinessRouteError(
        404,
        "OFFICIAL_CATALOG_NOT_FOUND",
        "Official plugin catalog file plugins-official/catalog/official.json not found."
      );
    }

    const catalog = await this.ctx.pluginInstaller.loadOfficialCatalog(catalogPath);
    const installedList = await this.getMergedInstalledPlugins();
    const installedById = new Map(
      installedList.map((entry) => [entry.manifest.id, entry])
    );

    const entries = catalog.plugins.map((entry) => {
      const installedRecord = installedById.get(entry.id);
      return {
        ...entry,
        installed: installedRecord !== undefined,
        enabled: installedRecord?.enabled ?? false,
        mounted: installedRecord?.mounted ?? false,
        ...(installedRecord !== undefined
          ? {
              installedVersion: installedRecord.manifest.version,
              distribution: installedRecord.distribution
            }
          : {})
      };
    });

    return {
      ok: true,
      schemaVersion: catalog.schemaVersion,
      generatedAt: catalog.generatedAt,
      officialCatalogPath: catalogPath,
      plugins: entries,
      installedCount: installedList.length
    };
  }

  async getPluginsInstalled(
    trustedCallerScope: CallerScope
  ): Promise<Record<string, unknown>> {
    assertOwnerChief(trustedCallerScope, "/v1/plugins/installed");
    const plugins = await this.getMergedInstalledPlugins();
    return {
      ok: true,
      plugins,
      totalCount: plugins.length
    };
  }

  async installPlugin(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): Promise<Record<string, unknown>> {
    assertOwnerChief(trustedCallerScope, "/v1/plugins/install");
    if (!this.ctx.pluginInstaller || !this.ctx.pluginHost) {
      throw new BusinessRouteError(
        503,
        "PLUGIN_SUBSYSTEM_UNAVAILABLE",
        "Plugin installer or host is not initialized."
      );
    }
    if (!isPlainRecord(rawBody)) {
      throw new BusinessRouteError(
        400,
        "INVALID_PARAMS",
        "Request body must be a JSON object."
      );
    }

    const confirmedAudit = rawBody["confirmedAudit"] === true;
    const requestedSource =
      rawBody["source"] === "official" || rawBody["source"] === "npm"
        ? rawBody["source"]
        : typeof rawBody["pluginId"] === "string" &&
            typeof rawBody["packageNameOrTarball"] !== "string"
          ? "official"
          : "npm";

    let details: InstalledPluginDetails;
    try {
      if (requestedSource === "official") {
        const pluginId =
          typeof rawBody["pluginId"] === "string"
            ? rawBody["pluginId"].trim()
            : "";
        if (pluginId.length === 0) {
          throw new BusinessRouteError(
            400,
            "INVALID_PARAMS",
            "Official plugin install requires non-empty pluginId."
          );
        }
        const catalogPath = resolveDefaultOfficialCatalogPath(
          this.ctx.officialCatalogPath
        );
        if (!catalogPath) {
          throw new BusinessRouteError(
            404,
            "OFFICIAL_CATALOG_NOT_FOUND",
            "Official plugin catalog not found."
          );
        }
        const catalog =
          await this.ctx.pluginInstaller.loadOfficialCatalog(catalogPath);
        const entry = catalog.plugins.find((p) => p.id === pluginId);
        if (!entry) {
          throw new BusinessRouteError(
            404,
            "OFFICIAL_PLUGIN_NOT_FOUND",
            `Official plugin "${pluginId}" is not in catalog.`
          );
        }

        let archiveBytes: Buffer | null = null;
        if (
          typeof rawBody["archiveBase64"] === "string" &&
          rawBody["archiveBase64"].trim().length > 0
        ) {
          archiveBytes = Buffer.from(rawBody["archiveBase64"].trim(), "base64");
        } else if (
          typeof rawBody["archivePath"] === "string" &&
          rawBody["archivePath"].trim().length > 0
        ) {
          const resolvedArchive = resolve(rawBody["archivePath"].trim());
          if (!existsSync(resolvedArchive)) {
            throw new BusinessRouteError(
              404,
              "ARCHIVE_NOT_FOUND",
              `Archive not found at "${resolvedArchive}".`
            );
          }
          archiveBytes = readFileSync(resolvedArchive);
        } else {
          const catalogRepoRoot = resolve(dirname(catalogPath), "..", "..");
          archiveBytes = findOfficialArchiveInSearchDirs(entry, [
            catalogRepoRoot,
            process.cwd()
          ]);
        }

        if (!archiveBytes || archiveBytes.byteLength === 0) {
          throw new BusinessRouteError(
            400,
            "ARCHIVE_REQUIRED",
            `Official plugin "${pluginId}" requires archivePath or archiveBase64 (no local .wb-plugin archive built yet).`
          );
        }

        details = await this.ctx.pluginInstaller.installOfficialEntry(
          entry,
          archiveBytes,
          {
            confirmedAudit,
            hostVersion: this.ctx.hostVersion
          }
        );
      } else {
        const packageNameOrTarball =
          typeof rawBody["packageNameOrTarball"] === "string"
            ? rawBody["packageNameOrTarball"].trim()
            : "";
        if (packageNameOrTarball.length === 0) {
          throw new BusinessRouteError(
            400,
            "INVALID_PARAMS",
            "Community npm install requires non-empty packageNameOrTarball."
          );
        }

        const networkPref: NetworkRoutePreference | undefined =
          rawBody["networkPreference"] === "auto" ||
          rawBody["networkPreference"] === "domestic" ||
          rawBody["networkPreference"] === "global"
            ? rawBody["networkPreference"]
            : undefined;

        details = await this.ctx.pluginInstaller.installFromNpm({
          packageNameOrTarball,
          ...(typeof rawBody["registryUrl"] === "string"
            ? { registryUrl: rawBody["registryUrl"].trim() }
            : {}),
          ...(typeof rawBody["fallbackRegistryUrl"] === "string"
            ? { fallbackRegistryUrl: rawBody["fallbackRegistryUrl"].trim() }
            : {}),
          ...(networkPref !== undefined ? { networkPreference: networkPref } : {}),
          ...(typeof rawBody["expectedSha256"] === "string"
            ? { expectedSha256: rawBody["expectedSha256"].trim() }
            : {}),
          ignoreScripts: true,
          confirmedAudit,
          hostVersion: this.ctx.hostVersion
        });
      }
    } catch (err) {
      if (err instanceof BusinessRouteError) {
        throw err;
      }
      if (err instanceof PermissionAuditRequiredError) {
        throw new BusinessRouteError(
          409,
          "AUDIT_CONFIRMATION_REQUIRED",
          err.message,
          err.audit
        );
      }
      if (err instanceof EngineIncompatibleError) {
        throw new BusinessRouteError(
          422,
          "ENGINE_INCOMPATIBLE",
          err.message,
          err.result
        );
      }
      if (err instanceof ChecksumMismatchError) {
        throw new BusinessRouteError(422, "CHECKSUM_MISMATCH", err.message);
      }
      if (err instanceof RegistryHttpError || err instanceof RegistryNetworkError) {
        throw new BusinessRouteError(502, "REGISTRY_ERROR", err.message);
      }
      throw new BusinessRouteError(
        400,
        "PLUGIN_INSTALL_FAILED",
        err instanceof Error ? err.message : String(err)
      );
    }

    let mounted = false;
    const mod = await tryLoadDaemonPluginModule(
      this.ctx.pluginInstaller.getPluginsDir(),
      details
    );
    if (mod && this.ctx.onMountPlugin) {
      await this.ctx.onMountPlugin(details, mod);
      mounted = this.ctx.pluginHost.isMounted(details.manifest.id);
    }

    return {
      ok: true,
      plugin: details,
      mounted
    };
  }

  async togglePlugin(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): Promise<Record<string, unknown>> {
    assertOwnerChief(trustedCallerScope, "/v1/plugins/toggle");
    if (!this.ctx.pluginHost) {
      throw new BusinessRouteError(
        503,
        "PLUGIN_HOST_UNAVAILABLE",
        "CordisPluginHost is not initialized."
      );
    }
    if (!isPlainRecord(rawBody)) {
      throw new BusinessRouteError(
        400,
        "INVALID_PARAMS",
        "Request body must be a JSON object."
      );
    }
    const pluginId =
      typeof rawBody["pluginId"] === "string" ? rawBody["pluginId"].trim() : "";
    if (pluginId.length === 0 || typeof rawBody["enabled"] !== "boolean") {
      throw new BusinessRouteError(
        400,
        "INVALID_PARAMS",
        "Request must include non-empty pluginId and boolean enabled."
      );
    }

    const enabled = rawBody["enabled"];
    const diskRecord = this.ctx.pluginInstaller
      ? await this.ctx.pluginInstaller.getInstalledRecord(pluginId)
      : null;
    const hostRecord = this.ctx.pluginHost.getRecord(pluginId);

    if (!diskRecord && !hostRecord) {
      throw new BusinessRouteError(
        404,
        "PLUGIN_NOT_FOUND",
        `Plugin "${pluginId}" is not installed.`
      );
    }

    if (
      diskRecord &&
      !hostRecord &&
      enabled &&
      this.ctx.onMountPlugin &&
      this.ctx.pluginInstaller
    ) {
      const mod = await tryLoadDaemonPluginModule(
        this.ctx.pluginInstaller.getPluginsDir(),
        diskRecord
      );
      if (mod) {
        await this.ctx.onMountPlugin(diskRecord, mod);
      }
    }

    if (this.ctx.pluginHost.getRecord(pluginId) && this.ctx.onTogglePlugin) {
      await this.ctx.onTogglePlugin(pluginId, enabled);
    }
    const mounted = this.ctx.pluginHost.isMounted(pluginId);

    let updatedRecord = this.ctx.pluginHost.getRecord(pluginId) ?? diskRecord;
    if (diskRecord && this.ctx.pluginInstaller) {
      const pluginInstallDir = join(
        this.ctx.pluginInstaller.getPluginsDir(),
        diskRecord.manifest.id
      );
      updatedRecord =
        updateInstallMetadataEnabledFlag(pluginInstallDir, enabled) ??
        updatedRecord;
    }

    return {
      ok: true,
      pluginId,
      enabled,
      mounted,
      record: updatedRecord
    };
  }

  async uninstallPlugin(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): Promise<Record<string, unknown>> {
    assertOwnerChief(trustedCallerScope, "/v1/plugins/uninstall");
    if (!this.ctx.pluginHost) {
      throw new BusinessRouteError(
        503,
        "PLUGIN_HOST_UNAVAILABLE",
        "CordisPluginHost is not initialized."
      );
    }
    if (!isPlainRecord(rawBody)) {
      throw new BusinessRouteError(
        400,
        "INVALID_PARAMS",
        "Request body must be a JSON object."
      );
    }
    const pluginId =
      typeof rawBody["pluginId"] === "string" ? rawBody["pluginId"].trim() : "";
    if (pluginId.length === 0) {
      throw new BusinessRouteError(
        400,
        "INVALID_PARAMS",
        "Request must include non-empty pluginId."
      );
    }

    const diskRecord = this.ctx.pluginInstaller
      ? await this.ctx.pluginInstaller.getInstalledRecord(pluginId)
      : null;
    const hostRecord = this.ctx.pluginHost.getRecord(pluginId);
    if (!diskRecord && !hostRecord) {
      throw new BusinessRouteError(
        404,
        "PLUGIN_NOT_FOUND",
        `Plugin "${pluginId}" is not installed.`
      );
    }

    if (this.ctx.onUninstallPlugin) {
      await this.ctx.onUninstallPlugin(pluginId);
    } else {
      await this.ctx.pluginHost.uninstallPlugin(pluginId);
      if (this.ctx.pluginInstaller) {
        await this.ctx.pluginInstaller.uninstall(pluginId);
      }
    }

    return {
      ok: true,
      pluginId,
      uninstalled: true
    };
  }

  private async getMergedInstalledPlugins(): Promise<
    Array<InstalledPluginRecord & { mounted: boolean }>
  > {
    const merged = new Map<string, InstalledPluginRecord & { mounted: boolean }>();

    if (this.ctx.pluginInstaller) {
      const diskRecords = await this.ctx.pluginInstaller.listInstalled();
      for (const rec of diskRecords) {
        const mounted = this.ctx.pluginHost?.isMounted(rec.manifest.id) ?? false;
        const hostRec = this.ctx.pluginHost?.getRecord(rec.manifest.id);
        merged.set(rec.manifest.id, {
          ...rec,
          enabled: hostRec ? hostRec.enabled : rec.enabled,
          mounted
        });
      }
    }

    if (this.ctx.pluginHost) {
      for (const hostRec of this.ctx.pluginHost.listInstalled()) {
        if (!merged.has(hostRec.manifest.id)) {
          merged.set(hostRec.manifest.id, {
            ...hostRec,
            mounted: this.ctx.pluginHost.isMounted(hostRec.manifest.id)
          });
        }
      }
    }

    return [...merged.values()].sort((a, b) =>
      a.manifest.id.localeCompare(b.manifest.id)
    );
  }
}
