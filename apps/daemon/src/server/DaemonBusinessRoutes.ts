import { createHash, randomUUID } from "node:crypto";
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
  PluginDeprecatedError,
  RegistryHttpError,
  RegistryNetworkError,
  type CordisPluginModule,
  type InstalledPluginDetails
} from "@prismux/cordis-kernel";
import {
  commitObsidianImportPlan,
  planObsidianImport,
  type ObsidianAgentCurator,
  type SqliteMemoryStore
} from "@prismux/memory-core";
import {
  CHIEF_PROVIDER_KINDS,
  DEFAULT_CHIEF_SECRETARY_NAME,
  DIAL_MODES,
  MEMORY_KINDS,
  RETIRED_OFFICIAL_PLUGIN_IDS,
  isValidMemoryNamespace,
  normalizeChiefProviderKind,
  normalizeChiefReasoningEffort,
  normalizeChiefSecretaryName,
  type CallerScope,
  type ChiefAgentsMdResponse,
  type ChiefProviderKind,
  type DialMode,
  type InstalledPluginRecord,
  type MemoryKind,
  type MemoryNamespace,
  type MemoryQueryRequest,
  type MemoryQueryResponse,
  type NetworkRoutePreference,
  type ObsidianCuratedItem,
  type ObsidianImportCommitResponse,
  type ObsidianImportPlanResponse,
  type OfficialPluginCatalogEntry,
  type PrismuxPluginModule,
  type RetiredOfficialPluginEntry,
  type SyncChannelOperationResult,
  type SyncNowResponse,
  type SyncOperationChannel,
  type SyncTestResponse
} from "@prismux/protocol";
import type {
  GitHubSyncConfig,
  MergeableMemoryRecord,
  S3SyncConfig,
  SyncChannelKind,
  SyncDomainMatrix,
  SyncVaultEngine,
  SyncVaultPayload,
  WebDavSyncConfig
} from "@prismux/sync-vault";
import { createChiefObsidianAgentCurator } from "../chief/ChiefObsidianCurator.js";
import type { ChiefThreadManager } from "../chief/ChiefThreadManager.js";
import type { HandoffEngine } from "../handoff/HandoffEngine.js";
import {
  normalizeHostMetricsReport,
  type HostMetricsIngestResult,
  type ResourceMonitorService
} from "../system/ResourceMonitorService.js";
import type { CoreRpcClient } from "../core/CoreRpcClient.js";
import type { AppUpdater } from "../updater/AppUpdater.js";
import { isPathStrictlyInsideDir } from "../wallpapers/WallpaperMediaService.js";
import {
  downloadOfficialPluginReleaseArchive,
  getOfficialNpmFallbackSpecs,
  type OfficialPluginSourceConfig
} from "./OfficialPluginDownloader.js";

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
  machineId?: string;
  officialCatalogPath?: string;
  chiefManager?: ChiefThreadManager;
  handoffEngine?: HandoffEngine;
  coreRpcClient?: CoreRpcClient;
  /** @deprecated Use coreRpcClient */
  t3RpcClient?: CoreRpcClient;
  memoryStore?: SqliteMemoryStore;
  memoryDbPath?: string;
  obsidianAgentCurator?: ObsidianAgentCurator;
  syncVault?: SyncVaultEngine;
  pluginHost?: CordisPluginHost;
  pluginInstaller?: CordisStreamingInstaller;
  pluginCredentialStore?: EncryptedPluginCredentialStore;
  appUpdater?: AppUpdater;
  officialPluginSources?: OfficialPluginSourceConfig;
  resourceMonitorService?: ResourceMonitorService;
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
  const normalized = normalizeChiefProviderKind(value);
  if (normalized !== null) {
    return normalized;
  }
  throw new BusinessRouteError(
    400,
    "INVALID_PROVIDER",
    `provider must be one of: ${CHIEF_PROVIDER_KINDS.join(", ")}.`
  );
}

function parseReasoningEffort(value: unknown): string | undefined {
  const normalized = normalizeChiefReasoningEffort(value);
  if (normalized === null) {
    throw new BusinessRouteError(
      400,
      "INVALID_REASONING_EFFORT",
      "reasoningEffort must be a valid effort token or empty."
    );
  }
  return normalized;
}

function parseSecretaryName(value: unknown): string | undefined {
  const normalized = normalizeChiefSecretaryName(value);
  if (normalized === null) {
    throw new BusinessRouteError(
      400,
      "INVALID_SECRETARY_NAME",
      "secretaryName must be a string up to 32 characters."
    );
  }
  return normalized;
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

export function getOfficialPluginArchiveCandidateFilenames(
  pluginId: string,
  version: string
): string[] {
  const canonicalName = pluginId.startsWith("prismux-plugin-")
    ? `${pluginId}-${version}.wb-plugin`
    : `prismux-plugin-${pluginId}-${version}.wb-plugin`;
  const legacyName = `${pluginId}-${version}.wb-plugin`;
  return canonicalName === legacyName
    ? [canonicalName]
    : [canonicalName, legacyName];
}

function findOfficialArchiveInSearchDirs(
  entry: OfficialPluginCatalogEntry,
  searchRoots: readonly string[],
  extraDirs: readonly string[] = []
): { bytes: Buffer; filePath: string } | null {
  const filenames = getOfficialPluginArchiveCandidateFilenames(
    entry.id,
    entry.version
  );
  const expectedSha = entry.sha256?.trim().toLowerCase() ?? "";
  const hasExpectedSha = /^[0-9a-f]{64}$/.test(expectedSha);

  const candidateDirs: string[] = [];
  for (const dir of extraDirs) {
    if (dir.trim().length > 0) {
      candidateDirs.push(dir);
    }
  }
  for (const root of searchRoots) {
    candidateDirs.push(
      join(root, "plugins-official", "dist"),
      join(root, ".work", "plugin-dist")
    );
  }

  for (const dir of candidateDirs) {
    for (const filename of filenames) {
      const candidate = join(dir, filename);
      if (!existsSync(candidate)) {
        continue;
      }
      try {
        const bytes = readFileSync(candidate);
        if (bytes.byteLength === 0) {
          continue;
        }
        if (hasExpectedSha) {
          const actualSha = createHash("sha256").update(bytes).digest("hex");
          if (actualSha !== expectedSha) {
            continue;
          }
        }
        return { bytes, filePath: candidate };
      } catch {
        continue;
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
  record: InstalledPluginRecord,
  onError?: (reason: string) => void
): Promise<PrismuxPluginModule | CordisPluginModule | null> {
  const pluginDir = join(pluginsDir, record.manifest.id);
  if (!existsSync(pluginDir)) {
    onError?.(`插件目录不存在：${pluginDir}`);
    return null;
  }
  const pkgJsonPath = join(pluginDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    onError?.(`缺少 package.json：${pkgJsonPath}`);
    return null;
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as unknown;
    if (!isPlainRecord(pkg)) {
      onError?.("package.json 不是合法 JSON 对象。");
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
      onError?.(`插件入口文件不存在或越界：${relEntry}`);
      return null;
    }
    const cacheTag = `${record.manifest.version}-${record.installedAt || Date.now()}`;
    const entryHref = `${pathToFileURL(candidate).href}?v=${encodeURIComponent(cacheTag)}`;
    const loaded = (await import(entryHref)) as Record<string, unknown>;
    const modCandidate =
      isPlainRecord(loaded["default"]) &&
      typeof loaded["default"]["apply"] === "function"
        ? loaded["default"]
        : typeof loaded["apply"] === "function"
          ? loaded
          : null;
    if (!modCandidate) {
      onError?.(`插件入口 ${relEntry} 未导出 apply(ctx) 函数。`);
      return null;
    }
    const modManifest = isPlainRecord(modCandidate["manifest"])
      ? modCandidate["manifest"]
      : record.manifest;
    return {
      manifest: modManifest as PrismuxPluginModule["manifest"],
      apply: modCandidate["apply"] as CordisPluginModule["apply"]
    };
  } catch (err) {
    onError?.(
      `加载插件模块失败：${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

export interface PluginRuntimeLogRecord {
  id: string;
  pluginId: string;
  timestamp: number;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
}

const MAX_PLUGIN_LOGS_PER_PLUGIN = 200;
const DEFAULT_PLUGIN_LOGS_LIMIT = 50;

/**
 * Coordinates real-data HTTP endpoints for Chief Supervisor, Memory Engine,
 * Sync Vault, and Cordis Plugin marketplace/runtime inside `apps/daemon`.
 */
export class DaemonBusinessService {
  readonly syncConfigPath: string;
  private readonly ctx: DaemonBusinessContext;
  private readonly pluginLogsById = new Map<string, PluginRuntimeLogRecord[]>();
  private pluginLogSeq = 0;

  constructor(ctx: DaemonBusinessContext) {
    this.ctx = ctx;
    this.syncConfigPath = join(resolve(ctx.dataDir), "sync-config.json");
  }

  /**
   * Appends a bounded runtime log entry for a plugin (newest-first on read).
   */
  recordPluginLog(
    pluginId: string,
    level: PluginRuntimeLogRecord["level"],
    source: string,
    message: string
  ): PluginRuntimeLogRecord {
    const normalizedId = pluginId.trim();
    this.pluginLogSeq += 1;
    const entry: PluginRuntimeLogRecord = {
      id: `daemon-plugin-log-${this.pluginLogSeq}`,
      pluginId: normalizedId,
      timestamp: Date.now(),
      level,
      source,
      message
    };
    const bucket = this.pluginLogsById.get(normalizedId) ?? [];
    bucket.push(entry);
    if (bucket.length > MAX_PLUGIN_LOGS_PER_PLUGIN) {
      bucket.splice(0, bucket.length - MAX_PLUGIN_LOGS_PER_PLUGIN);
    }
    this.pluginLogsById.set(normalizedId, bucket);
    return entry;
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
      slot: {
        ...slot,
        provider: slot.activeProvider,
        secretaryName: slot.secretaryName ?? DEFAULT_CHIEF_SECRETARY_NAME,
        agentsMdPath: slot.agentsMdPath,
        ...(slot.reasoningEffort !== undefined
          ? { defaultEffort: slot.reasoningEffort }
          : {})
      },
      secretaryName: slot.secretaryName ?? DEFAULT_CHIEF_SECRETARY_NAME,
      agentsMdPath: slot.agentsMdPath,
      dialMode,
      availableProviders: [...CHIEF_PROVIDER_KINDS],
      availableDialModes: [...DIAL_MODES],
      t3Connected: (this.ctx.coreRpcClient ?? this.ctx.t3RpcClient)?.isConnected() ?? false
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
    const reasoningEffort = parseReasoningEffort(
      rawBody["reasoningEffort"] !== undefined
        ? rawBody["reasoningEffort"]
        : rawBody["defaultEffort"]
    );
    const secretaryName = parseSecretaryName(rawBody["secretaryName"]);

    const slot = await this.ctx.chiefManager.switchProvider(
      provider,
      model,
      reasoningEffort,
      secretaryName !== undefined ? { secretaryName } : undefined
    );
    if (dialMode !== undefined && this.ctx.handoffEngine) {
      this.ctx.handoffEngine.setDialMode(slot.threadId, dialMode);
    }

    return {
      ok: true,
      slot: {
        ...slot,
        provider: slot.activeProvider,
        secretaryName: slot.secretaryName ?? DEFAULT_CHIEF_SECRETARY_NAME,
        agentsMdPath: slot.agentsMdPath,
        ...(slot.reasoningEffort !== undefined
          ? { defaultEffort: slot.reasoningEffort }
          : {})
      },
      secretaryName: slot.secretaryName ?? DEFAULT_CHIEF_SECRETARY_NAME,
      agentsMdPath: slot.agentsMdPath,
      dialMode: this.ctx.handoffEngine?.getDialMode(slot.threadId) ?? "agent"
    };
  }

  updateChiefProfile(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): Record<string, unknown> {
    assertOwnerChief(trustedCallerScope, "/v1/chief/profile");
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
    const secretaryName = parseSecretaryName(rawBody["secretaryName"]);
    const slot = this.ctx.chiefManager.updateProfile(
      secretaryName !== undefined ? { secretaryName } : {}
    );
    return {
      ok: true,
      slot: {
        ...slot,
        provider: slot.activeProvider,
        secretaryName: slot.secretaryName ?? DEFAULT_CHIEF_SECRETARY_NAME,
        agentsMdPath: slot.agentsMdPath,
        ...(slot.reasoningEffort !== undefined
          ? { defaultEffort: slot.reasoningEffort }
          : {})
      },
      secretaryName: slot.secretaryName ?? DEFAULT_CHIEF_SECRETARY_NAME,
      agentsMdPath: slot.agentsMdPath,
      dialMode: this.ctx.handoffEngine?.getDialMode(slot.threadId) ?? "agent"
    };
  }

  getChiefAgentsMd(trustedCallerScope: CallerScope): ChiefAgentsMdResponse {
    assertOwnerChief(trustedCallerScope, "/v1/chief/agents-md");
    if (!this.ctx.chiefManager) {
      throw new BusinessRouteError(
        503,
        "CHIEF_UNAVAILABLE",
        "ChiefThreadManager is not initialized."
      );
    }
    return this.ctx.chiefManager.getAgentsMd();
  }

  saveChiefAgentsMd(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): ChiefAgentsMdResponse {
    assertOwnerChief(trustedCallerScope, "/v1/chief/agents-md");
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
    const reset = rawBody["reset"] === true;
    const content = typeof rawBody["content"] === "string" ? rawBody["content"] : undefined;
    if (!reset && content === undefined) {
      throw new BusinessRouteError(
        400,
        "INVALID_PARAMS",
        "Request body must include string 'content' or 'reset: true'."
      );
    }
    return this.ctx.chiefManager.saveAgentsMd({
      ...(content !== undefined ? { content } : {}),
      ...(reset ? { reset: true } : {})
    });
  }

  async planObsidianVaultImport(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): Promise<ObsidianImportPlanResponse> {
    assertOwnerChief(trustedCallerScope, "/v1/memory/import-obsidian/plan");
    if (!isPlainRecord(rawBody)) {
      throw new BusinessRouteError(
        400,
        "INVALID_PARAMS",
        "Request body must be a JSON object."
      );
    }

    const vaultPath =
      typeof rawBody["vaultPath"] === "string" ? rawBody["vaultPath"].trim() : "";
    if (!vaultPath) {
      throw new BusinessRouteError(
        400,
        "INVALID_PARAMS",
        "vaultPath is required."
      );
    }

    const rawNamespace =
      typeof rawBody["namespace"] === "string" && rawBody["namespace"].trim().length > 0
        ? rawBody["namespace"].trim()
        : typeof rawBody["targetNamespace"] === "string" &&
            rawBody["targetNamespace"].trim().length > 0
          ? rawBody["targetNamespace"].trim()
          : undefined;
    let namespace: MemoryNamespace | undefined;
    if (rawNamespace !== undefined) {
      if (!isValidMemoryNamespace(rawNamespace)) {
        throw new BusinessRouteError(
          400,
          "INVALID_NAMESPACE",
          `Invalid namespace: "${rawNamespace}".`
        );
      }
      namespace = rawNamespace;
    }

    const useAgentCuration = rawBody["useAgentCuration"] !== false;
    const provider =
      typeof rawBody["provider"] === "string" && rawBody["provider"].trim().length > 0
        ? rawBody["provider"].trim()
        : undefined;
    const model =
      typeof rawBody["model"] === "string" && rawBody["model"].trim().length > 0
        ? rawBody["model"].trim()
        : undefined;

    const slot = this.ctx.chiefManager ? (() => {
      try {
        return this.ctx.chiefManager.getSlot();
      } catch {
        return null;
      }
    })() : null;
    const defaultCuratorLabel = slot
      ? `${slot.secretaryName ?? DEFAULT_CHIEF_SECRETARY_NAME} · ${slot.activeProvider}`
      : undefined;

    const agentCurator =
      this.ctx.obsidianAgentCurator ??
      createChiefObsidianAgentCurator({
        ...(this.ctx.chiefManager ? { chiefManager: this.ctx.chiefManager } : {})
      });

    try {
      return await planObsidianImport(
        {
          vaultPath,
          ...(namespace !== undefined ? { namespace } : {}),
          useAgentCuration,
          ...(provider !== undefined ? { provider } : {}),
          ...(model !== undefined ? { model } : {})
        },
        {
          agentCurator,
          ...(defaultCuratorLabel ? { curatorLabel: defaultCuratorLabel } : {})
        }
      );
    } catch (error: unknown) {
      const errCode =
        isPlainRecord(error) && typeof error["code"] === "string"
          ? error["code"]
          : undefined;
      if (errCode === "ENOENT" || errCode === "ENOTDIR") {
        throw new BusinessRouteError(
          400,
          "VAULT_NOT_FOUND",
          `Obsidian Vault 目录不存在或无法访问：${vaultPath}`
        );
      }
      throw new BusinessRouteError(
        400,
        "OBSIDIAN_PLAN_FAILED",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  async commitObsidianVaultImport(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): Promise<ObsidianImportCommitResponse> {
    assertOwnerChief(trustedCallerScope, "/v1/memory/import-obsidian/commit");
    if (!this.ctx.memoryStore) {
      throw new BusinessRouteError(
        503,
        "MEMORY_UNAVAILABLE",
        "SqliteMemoryStore is not configured."
      );
    }
    if (!isPlainRecord(rawBody) || !Array.isArray(rawBody["items"])) {
      throw new BusinessRouteError(
        400,
        "INVALID_PARAMS",
        "Request body must contain an 'items' array."
      );
    }
    const items = rawBody["items"] as ObsidianCuratedItem[];
    return commitObsidianImportPlan(
      this.ctx.memoryStore,
      this.ctx.machineId ?? "prismux-local",
      { items }
    );
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

    const sqliteVecLoaded = this.ctx.memoryStore.isVectorSearchEnabled();
    const retrievalMode = this.ctx.memoryStore.getRetrievalMode();
    return {
      ok: true,
      callerScope: trustedCallerScope,
      totalEntries,
      vectorSearchEnabled: sqliteVecLoaded,
      sqliteVecLoaded,
      retrievalMode,
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

    const channelsRaw = isPlainRecord(rawBody["channels"])
      ? rawBody["channels"]
      : null;

    // Validate all enabled channel payloads upfront so invalid configs return 400
    // cleanly without partially mutating stored credentials or channel configs.
    const webdavRaw =
      channelsRaw && isPlainRecord(channelsRaw["webdav"])
        ? channelsRaw["webdav"]
        : null;
    const s3Raw =
      channelsRaw && isPlainRecord(channelsRaw["s3"]) ? channelsRaw["s3"] : null;
    const githubRaw =
      channelsRaw && isPlainRecord(channelsRaw["github"])
        ? channelsRaw["github"]
        : null;

    const assertValidHttpUrl = (rawUrl: string, label: string): void => {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("invalid protocol");
        }
      } catch {
        throw new BusinessRouteError(
          400,
          "INVALID_SYNC_CHANNEL",
          `${label} 的 Endpoint URL 格式无效，请以 http:// 或 https:// 开头。`
        );
      }
    };

    const existingWebdav = webdavRaw
      ? this.ctx.syncVault.getChannelConfig("webdav")
      : undefined;
    const webdavEnabled = webdavRaw
      ? typeof webdavRaw["enabled"] === "boolean"
        ? webdavRaw["enabled"]
        : (existingWebdav?.enabled ?? false)
      : false;
    const webdavEndpointUrl = webdavRaw
      ? typeof webdavRaw["endpointUrl"] === "string"
        ? webdavRaw["endpointUrl"].trim()
        : (existingWebdav?.endpointUrl ?? "")
      : "";
    if (webdavRaw && webdavEnabled) {
      if (webdavEndpointUrl.length === 0) {
        throw new BusinessRouteError(
          400,
          "INVALID_SYNC_CHANNEL",
          "启用 WebDAV 通道时必须填写 Endpoint URL。"
        );
      }
      assertValidHttpUrl(webdavEndpointUrl, "WebDAV 通道");
    }

    const existingS3 = s3Raw
      ? this.ctx.syncVault.getChannelConfig("s3")
      : undefined;
    const s3Enabled = s3Raw
      ? typeof s3Raw["enabled"] === "boolean"
        ? s3Raw["enabled"]
        : (existingS3?.enabled ?? false)
      : false;
    const s3EndpointUrl = s3Raw
      ? typeof s3Raw["endpointUrl"] === "string"
        ? s3Raw["endpointUrl"].trim()
        : (existingS3?.endpointUrl ?? "")
      : "";
    const s3Bucket = s3Raw
      ? typeof s3Raw["bucket"] === "string"
        ? s3Raw["bucket"].trim()
        : (existingS3?.bucket ?? "")
      : "";
    if (s3Raw && s3Enabled) {
      const missing: string[] = [];
      if (s3EndpointUrl.length === 0) missing.push("Endpoint URL");
      if (s3Bucket.length === 0) missing.push("Bucket 名称");
      if (missing.length > 0) {
        throw new BusinessRouteError(
          400,
          "INVALID_SYNC_CHANNEL",
          `启用 S3 对象存储通道时必须填写：${missing.join("、")}。`
        );
      }
      assertValidHttpUrl(s3EndpointUrl, "S3 对象存储通道");
    }

    const existingGithub = githubRaw
      ? this.ctx.syncVault.getChannelConfig("github")
      : undefined;
    const githubEnabled = githubRaw
      ? typeof githubRaw["enabled"] === "boolean"
        ? githubRaw["enabled"]
        : (existingGithub?.enabled ?? false)
      : false;
    const githubOwner = githubRaw
      ? typeof githubRaw["owner"] === "string"
        ? githubRaw["owner"].trim()
        : (existingGithub?.owner ?? "")
      : "";
    const githubRepo = githubRaw
      ? typeof githubRaw["repo"] === "string"
        ? githubRaw["repo"].trim()
        : (existingGithub?.repo ?? "")
      : "";
    if (githubRaw && githubEnabled) {
      const missing: string[] = [];
      if (githubOwner.length === 0) missing.push("Owner（GitHub 用户名或组织）");
      if (githubRepo.length === 0) missing.push("私有仓库名（Repo）");
      if (missing.length > 0) {
        throw new BusinessRouteError(
          400,
          "INVALID_SYNC_CHANNEL",
          `启用 GitHub 私有仓库通道时必须填写：${missing.join("、")}。`
        );
      }
    }

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

    if (channelsRaw) {
      if (webdavRaw) {
        if (
          typeof webdavRaw["password"] === "string" &&
          webdavRaw["password"].length > 0 &&
          credHandle
        ) {
          await credHandle.set("webdav.password", webdavRaw["password"]);
        }
        if (webdavEndpointUrl.length > 0) {
          const hasStoredWebdavSecret =
            (typeof webdavRaw["password"] === "string" &&
              webdavRaw["password"].length > 0) ||
            (credHandle
              ? (await credHandle.get("webdav.password")) !== undefined
              : false);
          const passwordRef =
            typeof webdavRaw["passwordRef"] === "string"
              ? webdavRaw["passwordRef"]
              : (existingWebdav?.passwordRef ??
                (hasStoredWebdavSecret
                  ? `${SYNC_CREDENTIAL_BUCKET}:webdav.password`
                  : undefined));
          const remotePath =
            typeof webdavRaw["remotePath"] === "string"
              ? webdavRaw["remotePath"].trim()
              : undefined;
          this.ctx.syncVault.setChannelConfig("webdav", {
            enabled: webdavEnabled,
            endpointUrl: webdavEndpointUrl,
            username:
              typeof webdavRaw["username"] === "string"
                ? webdavRaw["username"].trim()
                : (existingWebdav?.username ?? ""),
            ...(remotePath && remotePath.length > 0
              ? { remotePath }
              : existingWebdav?.remotePath !== undefined
                ? { remotePath: existingWebdav.remotePath }
                : {}),
            ...(typeof webdavRaw["allowSelfSignedTls"] === "boolean"
              ? { allowSelfSignedTls: webdavRaw["allowSelfSignedTls"] }
              : existingWebdav?.allowSelfSignedTls !== undefined
                ? { allowSelfSignedTls: existingWebdav.allowSelfSignedTls }
                : {}),
            ...(passwordRef !== undefined ? { passwordRef } : {})
          });
        } else if (typeof webdavRaw["enabled"] === "boolean" && existingWebdav) {
          this.ctx.syncVault.setChannelEnabled("webdav", webdavRaw["enabled"]);
        }
      }

      if (s3Raw) {
        if (
          typeof s3Raw["secretAccessKey"] === "string" &&
          s3Raw["secretAccessKey"].length > 0 &&
          credHandle
        ) {
          await credHandle.set("s3.secretAccessKey", s3Raw["secretAccessKey"]);
        }
        if (s3EndpointUrl.length > 0 && s3Bucket.length > 0) {
          const hasStoredS3Secret =
            (typeof s3Raw["secretAccessKey"] === "string" &&
              s3Raw["secretAccessKey"].length > 0) ||
            (credHandle
              ? (await credHandle.get("s3.secretAccessKey")) !== undefined
              : false);
          const secretKeyRef =
            typeof s3Raw["secretKeyRef"] === "string"
              ? s3Raw["secretKeyRef"]
              : (existingS3?.secretKeyRef ??
                (hasStoredS3Secret
                  ? `${SYNC_CREDENTIAL_BUCKET}:s3.secretAccessKey`
                  : undefined));
          const regionRaw =
            typeof s3Raw["region"] === "string" ? s3Raw["region"].trim() : "";
          this.ctx.syncVault.setChannelConfig("s3", {
            enabled: s3Enabled,
            endpointUrl: s3EndpointUrl,
            region:
              regionRaw.length > 0 ? regionRaw : (existingS3?.region ?? "us-east-1"),
            bucket: s3Bucket,
            forcePathStyle:
              typeof s3Raw["forcePathStyle"] === "boolean"
                ? s3Raw["forcePathStyle"]
                : (existingS3?.forcePathStyle ?? true),
            allowSelfSignedTls:
              typeof s3Raw["allowSelfSignedTls"] === "boolean"
                ? s3Raw["allowSelfSignedTls"]
                : (existingS3?.allowSelfSignedTls ?? false),
            accessKeyId:
              typeof s3Raw["accessKeyId"] === "string"
                ? s3Raw["accessKeyId"].trim()
                : (existingS3?.accessKeyId ?? ""),
            ...(typeof s3Raw["keyPrefix"] === "string"
              ? { keyPrefix: s3Raw["keyPrefix"] }
              : existingS3?.keyPrefix !== undefined
                ? { keyPrefix: existingS3.keyPrefix }
                : {}),
            ...(typeof s3Raw["remoteKey"] === "string"
              ? { remoteKey: s3Raw["remoteKey"] }
              : existingS3?.remoteKey !== undefined
                ? { remoteKey: existingS3.remoteKey }
                : {}),
            ...(secretKeyRef !== undefined ? { secretKeyRef } : {})
          });
        } else if (typeof s3Raw["enabled"] === "boolean" && existingS3) {
          this.ctx.syncVault.setChannelEnabled("s3", s3Raw["enabled"]);
        }
      }

      if (githubRaw) {
        if (
          typeof githubRaw["token"] === "string" &&
          githubRaw["token"].length > 0 &&
          credHandle
        ) {
          await credHandle.set("github.token", githubRaw["token"]);
        }
        if (githubOwner.length > 0 && githubRepo.length > 0) {
          const hasStoredGithubSecret =
            (typeof githubRaw["token"] === "string" &&
              githubRaw["token"].length > 0) ||
            (credHandle
              ? (await credHandle.get("github.token")) !== undefined
              : false);
          const tokenRef =
            typeof githubRaw["tokenRef"] === "string"
              ? githubRaw["tokenRef"]
              : (existingGithub?.tokenRef ??
                (hasStoredGithubSecret
                  ? `${SYNC_CREDENTIAL_BUCKET}:github.token`
                  : undefined));
          const branchRaw =
            typeof githubRaw["branch"] === "string"
              ? githubRaw["branch"].trim()
              : "";
          const filePathRaw =
            typeof githubRaw["filePath"] === "string"
              ? githubRaw["filePath"].trim()
              : "";
          this.ctx.syncVault.setChannelConfig("github", {
            enabled: githubEnabled,
            owner: githubOwner,
            repo: githubRepo,
            branch:
              branchRaw.length > 0
                ? branchRaw
                : (existingGithub?.branch ?? "main"),
            ...(typeof githubRaw["apiBaseUrl"] === "string"
              ? { apiBaseUrl: githubRaw["apiBaseUrl"] }
              : existingGithub?.apiBaseUrl !== undefined
                ? { apiBaseUrl: existingGithub.apiBaseUrl }
                : {}),
            ...(filePathRaw.length > 0
              ? { filePath: filePathRaw }
              : existingGithub?.filePath !== undefined
                ? { filePath: existingGithub.filePath }
                : {}),
            ...(tokenRef !== undefined ? { tokenRef } : {})
          });
        } else if (typeof githubRaw["enabled"] === "boolean" && existingGithub) {
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

  private async scrubSyncErrorMessage(rawMessage: string): Promise<string> {
    let message = rawMessage;
    const secretsToScrub: string[] = [];
    if (this.ctx.syncVault) {
      try {
        secretsToScrub.push(
          ...(await this.ctx.syncVault.collectConfiguredRemoteSecrets())
        );
      } catch {
        // ignore
      }
    }
    const credHandle =
      this.ctx.pluginCredentialStore?.openForPlugin(SYNC_CREDENTIAL_BUCKET);
    if (credHandle) {
      for (const key of [
        "vault.passphrase",
        "webdav.password",
        "s3.secretAccessKey",
        "github.token"
      ]) {
        try {
          const val = await credHandle.get(key);
          if (val && val.length > 0) {
            secretsToScrub.push(val);
          }
        } catch {
          // ignore
        }
      }
    }
    for (const secret of secretsToScrub) {
      if (secret.length >= 3) {
        message = message.replaceAll(secret, "[REDACTED]");
      }
    }
    // Redact common Authorization / token patterns in error text
    message = message.replace(
      /(authorization\s*[:=]\s*(?:basic|bearer|token)\s+)[^\s,;"']+/gi,
      "$1[REDACTED]"
    );
    message = message.replace(
      /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+\b/g,
      "[REDACTED]"
    );
    message = message.replace(
      /\bgithub_pat_[A-Za-z0-9_]+\b/g,
      "[REDACTED]"
    );
    return message;
  }

  private parseRequestedSyncChannels(
    rawBody: unknown,
    fallback: SyncOperationChannel[]
  ): SyncOperationChannel[] {
    if (isPlainRecord(rawBody) && Array.isArray(rawBody["channels"])) {
      const parsed = rawBody["channels"].filter(
        (c): c is SyncOperationChannel =>
          c === "webdav" || c === "s3" || c === "github"
      );
      if (parsed.length > 0) {
        return [...new Set(parsed)];
      }
    }
    return fallback;
  }

  private async buildLocalSyncPayload(): Promise<{
    payload: SyncVaultPayload;
    entryCount: number;
  }> {
    const privateMemory: MergeableMemoryRecord[] = [];
    const workspaceMemory: MergeableMemoryRecord[] = [];
    const socialMemory: MergeableMemoryRecord[] = [];

    if (this.ctx.memoryStore) {
      let offset = 0;
      const pageSize = 1000;
      while (true) {
        const batch = await this.ctx.memoryStore.listEntries("owner_chief", {
          limit: pageSize,
          offset,
          includeDeleted: true
        });
        for (const entry of batch) {
          const record: MergeableMemoryRecord = {
            id: entry.id,
            namespace: entry.namespace,
            kind: entry.kind,
            title: entry.title,
            content: entry.content,
            sourceRef: entry.sourceRef ?? null,
            importance: entry.importance,
            machineId: entry.machineId,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            deletedAt: entry.deletedAt ?? null
          };
          if (entry.namespace === "private/chief") {
            privateMemory.push(record);
          } else if (entry.namespace.startsWith("workspace/")) {
            workspaceMemory.push(record);
          } else if (entry.namespace.startsWith("social/qq-group-")) {
            socialMemory.push(record);
          }
        }
        if (batch.length < pageSize) {
          break;
        }
        offset += batch.length;
      }
    }

    const total =
      privateMemory.length + workspaceMemory.length + socialMemory.length;
    return {
      payload: {
        schemaVersion: 1,
        sourceMachineId: this.ctx.machineId ?? "local",
        exportedAt: Date.now(),
        privateMemory,
        workspaceMemory,
        socialMemory
      },
      entryCount: total
    };
  }

  /**
   * Tests connectivity of configured SyncVault channels (`POST /v1/sync/test`)
   * without ever exposing plaintext credentials or passphrases.
   */
  async testSyncConnection(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): Promise<SyncTestResponse> {
    assertOwnerChief(trustedCallerScope, "/v1/sync/test");
    if (!this.ctx.syncVault) {
      throw new BusinessRouteError(
        503,
        "SYNC_UNAVAILABLE",
        "SyncVaultEngine is not initialized."
      );
    }

    const getSyncChannelCfg = (kind: SyncOperationChannel) =>
      kind === "webdav"
        ? this.ctx.syncVault!.getChannelConfig("webdav")
        : kind === "s3"
          ? this.ctx.syncVault!.getChannelConfig("s3")
          : this.ctx.syncVault!.getChannelConfig("github");

    const allKinds: SyncOperationChannel[] = ["webdav", "s3", "github"];
    const configuredKinds = allKinds.filter(
      (kind) => getSyncChannelCfg(kind) !== undefined
    );
    const enabledKinds = configuredKinds.filter(
      (kind) => getSyncChannelCfg(kind)?.enabled === true
    );
    const defaultTargetKinds =
      enabledKinds.length > 0
        ? enabledKinds
        : configuredKinds.length > 0
          ? configuredKinds
          : allKinds;
    const targetChannels = this.parseRequestedSyncChannels(
      rawBody,
      defaultTargetKinds
    );

    const results: SyncChannelOperationResult[] = [];
    for (const kind of targetChannels) {
      const cfg = getSyncChannelCfg(kind);
      if (!cfg) {
        results.push({
          channel: kind,
          ok: false,
          enabled: false,
          configured: false,
          reachable: false,
          latencyMs: 0,
          error: `同步通道「${kind}」尚未配置。`
        });
        continue;
      }

      const started = performance.now();
      try {
        if (kind === "github") {
          const ghCfg = this.ctx.syncVault.getChannelConfig("github");
          const client = this.ctx.syncVault.getChannelClient("github");
          const probe = await client.verifyAccess();
          const latencyMs = Math.max(0, Math.round(performance.now() - started));
          const repoLabel =
            probe.repoFullName ??
            (ghCfg ? `${ghCfg.owner}/${ghCfg.repo}` : "github");
          const readOnlyHint =
            probe.canPush === false
              ? "（注意：当前 Token 仅有只读权限，无法上传）"
              : !probe.hasToken
                ? "（注意：未配置 PAT，仅可读取公开仓库）"
                : "";
          results.push({
            channel: kind,
            ok: true,
            enabled: cfg.enabled,
            configured: true,
            reachable: true,
            exists: probe.exists,
            etag: probe.etag,
            latencyMs,
            message: probe.exists
              ? `连接成功（仓库 ${repoLabel} 已存在加密快照）${readOnlyHint}`
              : probe.emptyRepo
                ? `连接成功（仓库 ${repoLabel} 当前为空仓库，首次同步将自动创建快照）${readOnlyHint}`
                : `连接成功（仓库 ${repoLabel} 可访问，远端尚未上传首次快照）${readOnlyHint}`
          });
        } else {
          const client =
            kind === "webdav"
              ? this.ctx.syncVault.getChannelClient("webdav")
              : this.ctx.syncVault.getChannelClient("s3");
          const headResult = await client.head();
          const latencyMs = Math.max(0, Math.round(performance.now() - started));
          results.push({
            channel: kind,
            ok: true,
            enabled: cfg.enabled,
            configured: true,
            reachable: true,
            exists: headResult.exists,
            etag: headResult.etag,
            latencyMs,
            message: headResult.exists
              ? "连接成功（远端已存在加密快照）"
              : "连接成功（远端尚未上传首次快照）"
          });
        }
      } catch (err) {
        const latencyMs = Math.max(0, Math.round(performance.now() - started));
        const safeErr = await this.scrubSyncErrorMessage(
          err instanceof Error ? err.message : String(err)
        );
        results.push({
          channel: kind,
          ok: false,
          enabled: cfg.enabled,
          configured: true,
          reachable: false,
          latencyMs,
          error: safeErr
        });
      }
    }

    const now = Date.now();
    const configuredResults = results.filter((r) => r.configured);
    const overallOk =
      configuredResults.length > 0 && configuredResults.every((r) => r.ok);
    const firstError = configuredResults.find((r) => !r.ok)?.error;

    return {
      ok: overallOk,
      testedAt: now,
      timestamp: now,
      channels: results,
      results,
      ...(configuredResults.length === 0
        ? {
            error: "尚未配置任何同步通道（WebDAV / S3 / GitHub）。",
            message: "尚未配置任何同步通道。"
          }
        : overallOk
          ? {
              message:
                enabledKinds.length > 0
                  ? `全部 ${configuredResults.length} 个已启用同步通道连通性测试通过。`
                  : `已检测 ${configuredResults.length} 个已配置同步通道（当前未启用），连通性测试通过。`
            }
          : {
              ...(firstError !== undefined ? { error: firstError } : {}),
              message:
                configuredResults.length === 1 && firstError
                  ? firstError
                  : "部分同步通道连通性测试失败，请检查端点地址与认证凭据。"
            })
    };
  }

  /**
   * Triggers an immediate end-to-end encrypted sync (`POST /v1/sync/now`).
   */
  async triggerSyncNow(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): Promise<SyncNowResponse> {
    assertOwnerChief(trustedCallerScope, "/v1/sync/now");
    if (!this.ctx.syncVault) {
      throw new BusinessRouteError(
        503,
        "SYNC_UNAVAILABLE",
        "SyncVaultEngine is not initialized."
      );
    }

    const enabledChannels = this.ctx.syncVault.getEnabledChannels();
    const targetChannels = this.parseRequestedSyncChannels(
      rawBody,
      enabledChannels
    );
    const now = Date.now();

    if (targetChannels.length === 0) {
      return {
        ok: false,
        syncedAt: now,
        timestamp: now,
        uploaded: 0,
        downloaded: 0,
        etag: null,
        conflictDetected: false,
        channels: [],
        results: [],
        error: "当前未启用任何同步通道，请先启用 WebDAV / S3 / GitHub 通道。",
        message: "当前未启用任何同步通道。"
      };
    }

    const credHandle =
      this.ctx.pluginCredentialStore?.openForPlugin(SYNC_CREDENTIAL_BUCKET);
    let passphrase =
      isPlainRecord(rawBody) &&
      typeof rawBody["passphrase"] === "string" &&
      rawBody["passphrase"].length > 0
        ? rawBody["passphrase"]
        : undefined;
    if (!passphrase && credHandle) {
      const storedPass = await credHandle.get("vault.passphrase");
      passphrase = storedPass ?? undefined;
    }

    if (!passphrase) {
      throw new BusinessRouteError(
        400,
        "SYNC_PASSPHRASE_REQUIRED",
        "未配置端到端加密口令（Passphrase），请先在「记忆与同步」设置加密口令后再执行同步。"
      );
    }

    const { payload: localPayload, entryCount } =
      await this.buildLocalSyncPayload();

    const channelResults: SyncChannelOperationResult[] = [];
    let primaryEtag: string | null = null;
    let anyConflict = false;
    let totalUploaded = 0;
    let totalDownloaded = 0;

    for (const kind of targetChannels) {
      const cfg =
        kind === "webdav"
          ? this.ctx.syncVault.getChannelConfig("webdav")
          : kind === "s3"
            ? this.ctx.syncVault.getChannelConfig("s3")
            : this.ctx.syncVault.getChannelConfig("github");
      const started = performance.now();
      if (!cfg || !cfg.enabled) {
        channelResults.push({
          channel: kind,
          ok: false,
          enabled: Boolean(cfg?.enabled),
          configured: Boolean(cfg),
          latencyMs: 0,
          error: `同步通道「${kind}」未配置或未启用。`
        });
        continue;
      }

      try {
        // Fetch current remote ETag (if present) for safe optimistic locking.
        let expectedEtag: string | null = null;
        try {
          const client =
            kind === "webdav"
              ? this.ctx.syncVault.getChannelClient("webdav")
              : kind === "s3"
                ? this.ctx.syncVault.getChannelClient("s3")
                : this.ctx.syncVault.getChannelClient("github");
          const head = await client.head();
          expectedEtag = head.exists ? head.etag : null;
        } catch {
          expectedEtag = null;
        }

        const outcome = await this.ctx.syncVault.syncNow({
          channel: kind,
          passphrase,
          localPayload,
          expectedEtag,
          autoMergeOnConflict: true,
          retryOnCleanMerge: true
        });
        const latencyMs = Math.max(0, Math.round(performance.now() - started));
        const single = outcome.channelResults[0];
        if (primaryEtag === null && outcome.etag !== null) {
          primaryEtag = outcome.etag;
        }
        if (outcome.conflictDetected) {
          anyConflict = true;
        }
        totalUploaded += entryCount;

        // Apply any merged inbound records back into SQLite store cleanly.
        let mergedInboundCount = 0;
        if (outcome.mergedPayload && this.ctx.memoryStore) {
          const mergedAll = [
            ...(outcome.mergedPayload.privateMemory ?? []),
            ...(outcome.mergedPayload.workspaceMemory ?? []),
            ...(outcome.mergedPayload.socialMemory ?? [])
          ];
          for (const rec of mergedAll) {
            if (
              typeof rec.id === "string" &&
              typeof rec.namespace === "string" &&
              isValidMemoryNamespace(rec.namespace) &&
              typeof rec["title"] === "string" &&
              typeof rec["content"] === "string" &&
              typeof rec["kind"] === "string" &&
              (MEMORY_KINDS as readonly string[]).includes(rec["kind"])
            ) {
              if (rec.deletedAt != null) {
                await this.ctx.memoryStore.softDelete(rec.id, rec.deletedAt);
              } else {
                await this.ctx.memoryStore.upsert({
                  id: rec.id,
                  namespace: rec.namespace,
                  kind: rec["kind"] as MemoryKind,
                  title: rec["title"],
                  content: rec["content"],
                  sourceRef:
                    typeof rec["sourceRef"] === "string" ? rec["sourceRef"] : null,
                  importance:
                    typeof rec["importance"] === "number" ? rec["importance"] : 0.5,
                  machineId:
                    typeof rec["machineId"] === "string"
                      ? rec["machineId"]
                      : (this.ctx.machineId ?? "local")
                });
              }
              mergedInboundCount += 1;
            }
          }
          totalDownloaded += mergedInboundCount;
        }

        channelResults.push({
          channel: kind,
          ok: !outcome.conflictDetected,
          enabled: true,
          configured: true,
          reachable: true,
          etag: single?.etag ?? outcome.etag,
          conflictDetected: outcome.conflictDetected,
          degradedToHead: single?.degradedToHead,
          commitSha: single?.commitSha,
          latencyMs,
          uploaded: entryCount,
          downloaded: mergedInboundCount,
          message: outcome.conflictDetected
            ? "检测到远端并发写入冲突，请复核合并状态"
            : "加密快照同步成功"
        });
      } catch (err) {
        const latencyMs = Math.max(0, Math.round(performance.now() - started));
        const safeErr = await this.scrubSyncErrorMessage(
          err instanceof Error ? err.message : String(err)
        );
        channelResults.push({
          channel: kind,
          ok: false,
          enabled: true,
          configured: true,
          reachable: false,
          latencyMs,
          error: safeErr
        });
      }
    }

    const finishedAt = Date.now();
    const overallOk =
      channelResults.length > 0 && channelResults.every((r) => r.ok);
    const firstError = channelResults.find((r) => !r.ok)?.error;

    return {
      ok: overallOk,
      syncedAt: finishedAt,
      timestamp: finishedAt,
      uploaded: totalUploaded,
      downloaded: totalDownloaded,
      etag: primaryEtag,
      conflictDetected: anyConflict,
      channels: channelResults,
      results: channelResults,
      ...(firstError !== undefined ? { error: firstError } : {}),
      message: overallOk
        ? `同步完成（共 ${channelResults.length} 个通道，上传 ${totalUploaded} 条记录）。`
        : (firstError ?? "部分同步通道执行失败。")
    };
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

    const activeCatalogEntries = catalog.plugins.filter(
      (entry) => entry.status !== "deprecated"
    );
    const entries = activeCatalogEntries.map((entry) => {
      const installedRecord = installedById.get(entry.id);
      const prevVersionRaw =
        installedRecord !== undefined
          ? (installedRecord as { previousVersion?: unknown }).previousVersion
          : undefined;
      return {
        ...entry,
        installed: installedRecord !== undefined,
        enabled: installedRecord?.enabled ?? false,
        mounted: installedRecord?.mounted ?? false,
        ...(installedRecord !== undefined
          ? {
              installedVersion: installedRecord.manifest.version,
              distribution: installedRecord.distribution,
              ...(typeof prevVersionRaw === "string" && prevVersionRaw.length > 0
                ? { previousVersion: prevVersionRaw }
                : {})
            }
          : {})
      };
    });

    const retiredPlugins: RetiredOfficialPluginEntry[] = Array.isArray(
      catalog.retiredPlugins
    )
      ? catalog.retiredPlugins
      : [];

    return {
      ok: true,
      schemaVersion: catalog.schemaVersion,
      generatedAt: catalog.generatedAt,
      officialCatalogPath: catalogPath,
      plugins: entries,
      retiredPlugins,
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

  /**
   * Hydrates already-installed plugins with `enabled: true` from `dataDir/plugins`
   * during daemon startup. No-op on a fresh dataDir (strictly zero preinstalled plugins).
   */
  async hydrateInstalledPlugins(): Promise<number> {
    if (
      !this.ctx.pluginInstaller ||
      !this.ctx.pluginHost ||
      !this.ctx.onMountPlugin
    ) {
      return 0;
    }

    let hydrated = 0;
    const diskRecords = await this.ctx.pluginInstaller.listInstalled();
    for (const rec of diskRecords) {
      if (!rec.enabled || this.ctx.pluginHost.isMounted(rec.manifest.id)) {
        continue;
      }
      try {
        const mod = await tryLoadDaemonPluginModule(
          this.ctx.pluginInstaller.getPluginsDir(),
          rec,
          (reason) => {
            this.recordPluginLog(rec.manifest.id, "warn", "daemon", reason);
          }
        );
        if (mod) {
          await this.ctx.onMountPlugin(rec, mod);
          hydrated += 1;
        }
      } catch (err) {
        this.recordPluginLog(
          rec.manifest.id,
          "error",
          "daemon",
          `启动加载已安装插件失败：${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    return hydrated;
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
    const rawSource = rawBody["source"];
    const hasArchiveInput =
      (typeof rawBody["archiveBase64"] === "string" &&
        rawBody["archiveBase64"].trim().length > 0) ||
      (typeof rawBody["archivePath"] === "string" &&
        rawBody["archivePath"].trim().length > 0);
    const requestedSource: "official" | "npm" | "local-archive" =
      rawSource === "official" ||
      rawSource === "npm" ||
      rawSource === "local-archive"
        ? rawSource
        : rawSource === "local"
          ? "local-archive"
          : typeof rawBody["pluginId"] === "string" &&
              typeof rawBody["packageNameOrTarball"] !== "string"
            ? "official"
            : hasArchiveInput && typeof rawBody["packageNameOrTarball"] !== "string"
              ? "local-archive"
              : "npm";

    const rawNetworkPref: NetworkRoutePreference | undefined =
      rawBody["networkPreference"] === "auto" ||
      rawBody["networkPreference"] === "domestic" ||
      rawBody["networkPreference"] === "global"
        ? rawBody["networkPreference"]
        : undefined;
    const updaterSnapshot = this.ctx.appUpdater?.getStatus();
    const effectiveNetworkPref: NetworkRoutePreference =
      rawNetworkPref ?? updaterSnapshot?.policy.routePreference ?? "auto";

    let details: InstalledPluginDetails;
    try {
      if (requestedSource === "local-archive") {
        let archiveBytes: Buffer | null = null;
        let fileName =
          typeof rawBody["fileName"] === "string" &&
          rawBody["fileName"].trim().length > 0
            ? rawBody["fileName"].trim()
            : "local-plugin.wb-plugin";

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
              `本地插件归档不存在：${resolvedArchive}`
            );
          }
          archiveBytes = readFileSync(resolvedArchive);
          fileName = basename(resolvedArchive);
        }

        if (!archiveBytes || archiveBytes.byteLength === 0) {
          throw new BusinessRouteError(
            400,
            "ARCHIVE_REQUIRED",
            "导入本地插件需要提供非空的 .wb-plugin 或 .tgz 归档内容。"
          );
        }

        details = await this.ctx.pluginInstaller.installLocalArchive(archiveBytes, {
          fileName,
          ...(typeof rawBody["expectedSha256"] === "string" &&
          rawBody["expectedSha256"].trim().length > 0
            ? { expectedSha256: rawBody["expectedSha256"].trim() }
            : {}),
          confirmedAudit,
          hostVersion: this.ctx.hostVersion
        });
      } else if (requestedSource === "official") {
        const pluginId =
          typeof rawBody["pluginId"] === "string"
            ? rawBody["pluginId"].trim()
            : "";
        if (pluginId.length === 0) {
          throw new BusinessRouteError(
            400,
            "INVALID_PARAMS",
            "官方插件安装需要提供非空 pluginId。"
          );
        }
        const catalogPath = resolveDefaultOfficialCatalogPath(
          this.ctx.officialCatalogPath
        );
        if (!catalogPath) {
          throw new BusinessRouteError(
            404,
            "OFFICIAL_CATALOG_NOT_FOUND",
            "未找到官方插件目录文件 plugins-official/catalog/official.json。"
          );
        }
        const catalog =
          await this.ctx.pluginInstaller.loadOfficialCatalog(catalogPath);

        const retiredEntry = catalog.retiredPlugins?.find(
          (item) => item.id === pluginId
        );
        const rawEntry = catalog.plugins.find((p) => p.id === pluginId);
        if (
          retiredEntry !== undefined ||
          rawEntry?.status === "deprecated" ||
          (RETIRED_OFFICIAL_PLUGIN_IDS as readonly string[]).includes(pluginId)
        ) {
          throw new BusinessRouteError(
            410,
            "PLUGIN_RETIRED",
            retiredEntry?.noticeZh ??
              `官方插件 "${pluginId}" 已停用：已被 Prismux 内置功能取代，不再支持安装。`,
            retiredEntry
          );
        }

        if (!rawEntry) {
          throw new BusinessRouteError(
            404,
            "OFFICIAL_PLUGIN_NOT_FOUND",
            `官方插件目录中不存在 "${pluginId}"。`
          );
        }
        const entry = rawEntry;

        if (
          typeof rawBody["archiveBase64"] === "string" &&
          rawBody["archiveBase64"].trim().length > 0
        ) {
          const archiveBytes = Buffer.from(
            rawBody["archiveBase64"].trim(),
            "base64"
          );
          details = await this.ctx.pluginInstaller.installOfficialEntry(
            entry,
            archiveBytes,
            {
              confirmedAudit,
              hostVersion: this.ctx.hostVersion,
              sourceUsed: "inline-base64"
            }
          );
        } else if (
          typeof rawBody["archivePath"] === "string" &&
          rawBody["archivePath"].trim().length > 0
        ) {
          const resolvedArchive = resolve(rawBody["archivePath"].trim());
          if (!existsSync(resolvedArchive)) {
            throw new BusinessRouteError(
              404,
              "ARCHIVE_NOT_FOUND",
              `指定的插件归档不存在：${resolvedArchive}`
            );
          }
          const archiveBytes = readFileSync(resolvedArchive);
          details = await this.ctx.pluginInstaller.installOfficialEntry(
            entry,
            archiveBytes,
            {
              confirmedAudit,
              hostVersion: this.ctx.hostVersion,
              sourceUsed: `local-file:${resolvedArchive}`
            }
          );
        } else {
          // Multi-source resolution:
          // 1) Verified local cache (plugins-official/dist, .work/plugin-dist, <dataDir>/plugins-cache)
          // 2) GitHub / Gitee Release `.wb-plugin` mirrors with strict SHA-256 verification
          // 3) Automatic npm Registry fallback (`prismux-plugin-<id>`) with nested `.wb-plugin` unwrap
          const catalogRepoRoot = resolve(dirname(catalogPath), "..", "..");
          const localCached = findOfficialArchiveInSearchDirs(
            entry,
            [catalogRepoRoot, process.cwd()],
            [
              join(this.ctx.dataDir, "plugins-cache"),
              join(dirname(catalogPath), "..", "dist")
            ]
          );

          if (localCached !== null) {
            details = await this.ctx.pluginInstaller.installOfficialEntry(
              entry,
              localCached.bytes,
              {
                confirmedAudit,
                hostVersion: this.ctx.hostVersion,
                sourceUsed: `local-cache:${localCached.filePath}`
              }
            );
          } else {
            const mergedSourceConfig: OfficialPluginSourceConfig = {
              ...(updaterSnapshot?.policy.customGhProxyPrefix
                ? { customGhProxyPrefix: updaterSnapshot.policy.customGhProxyPrefix }
                : {}),
              ...this.ctx.officialPluginSources
            };

            const releaseDl = await downloadOfficialPluginReleaseArchive(entry, {
              preference: effectiveNetworkPref,
              config: mergedSourceConfig,
              recommendedSource: updaterSnapshot?.lastProbe?.recommendedSource
            });

            if (releaseDl.ok) {
              details = await this.ctx.pluginInstaller.installOfficialEntry(
                entry,
                releaseDl.bytes,
                {
                  confirmedAudit,
                  hostVersion: this.ctx.hostVersion,
                  sourceUsed: releaseDl.sourceUsed
                }
              );
            } else if (releaseDl.tamperError !== undefined) {
              throw releaseDl.tamperError;
            } else if (mergedSourceConfig.disableRemoteFallback === true) {
              const summary = releaseDl.attempts
                .map((a) => `${a.source}(${a.reason ?? "failed"})`)
                .join("; ");
              throw new BusinessRouteError(
                502,
                "PLUGIN_DOWNLOAD_FAILED",
                `无法下载官方插件 "${entry.id}"：${summary || "所有发布源均不可用"}。`
              );
            } else {
              // Release tag may not yet be published (e.g. preview build) or blocked;
              // gracefully fall back to npm Registry (`prismux-plugin-<id>`) across npmmirror <-> npmjs.
              const npmFallbackErrors: string[] = [];
              let npmDetails: InstalledPluginDetails | null = null;
              for (const spec of getOfficialNpmFallbackSpecs(entry)) {
                try {
                  const installed = await this.ctx.pluginInstaller.installFromNpm({
                    packageNameOrTarball: spec,
                    expectedPluginId: entry.id,
                    networkPreference: effectiveNetworkPref,
                    ...(mergedSourceConfig.npmRegistryUrl
                      ? { registryUrl: mergedSourceConfig.npmRegistryUrl }
                      : {}),
                    ...(mergedSourceConfig.npmMirrorRegistryUrl
                      ? {
                          fallbackRegistryUrl:
                            mergedSourceConfig.npmMirrorRegistryUrl
                        }
                      : {}),
                    ignoreScripts: true,
                    confirmedAudit,
                    hostVersion: this.ctx.hostVersion
                  });
                  npmDetails = {
                    ...installed,
                    sourceUsed: `npm-fallback:${spec}`
                  };
                  break;
                } catch (npmErr) {
                  if (
                    npmErr instanceof PermissionAuditRequiredError ||
                    npmErr instanceof EngineIncompatibleError ||
                    npmErr instanceof ChecksumMismatchError
                  ) {
                    throw npmErr;
                  }
                  npmFallbackErrors.push(
                    `${spec}: ${npmErr instanceof Error ? npmErr.message : String(npmErr)}`
                  );
                }
              }

              if (npmDetails === null) {
                const releaseSummary = releaseDl.attempts
                  .slice(0, 4)
                  .map((a) => `${a.source}(${a.reason ?? "failed"})`)
                  .join("；");
                throw new BusinessRouteError(
                  502,
                  "PLUGIN_DOWNLOAD_FAILED",
                  `无法从 GitHub / Gitee Release 或 npm 镜像下载官方插件 "${entry.id}"（已尝试：${releaseSummary || "Release 不可达"}；npm 回退：${npmFallbackErrors[0] ?? "不可达"}）。请检查网络/镜像设置，或点击「导入本地 .wb-plugin」离线安装。`,
                  {
                    releaseAttempts: releaseDl.attempts,
                    npmFallbackErrors
                  }
                );
              }
              details = npmDetails;
            }
          }
        }
      } else {
        const packageNameOrTarball =
          typeof rawBody["packageNameOrTarball"] === "string"
            ? rawBody["packageNameOrTarball"].trim()
            : "";
        if (packageNameOrTarball.length === 0) {
          throw new BusinessRouteError(
            400,
            "INVALID_PARAMS",
            "社区 npm 安装需要提供非空包名或归档 URL（packageNameOrTarball）。"
          );
        }

        details = await this.ctx.pluginInstaller.installFromNpm({
          packageNameOrTarball,
          ...(typeof rawBody["registryUrl"] === "string"
            ? { registryUrl: rawBody["registryUrl"].trim() }
            : this.ctx.officialPluginSources?.npmRegistryUrl
              ? { registryUrl: this.ctx.officialPluginSources.npmRegistryUrl }
              : {}),
          ...(typeof rawBody["fallbackRegistryUrl"] === "string"
            ? { fallbackRegistryUrl: rawBody["fallbackRegistryUrl"].trim() }
            : this.ctx.officialPluginSources?.npmMirrorRegistryUrl
              ? {
                  fallbackRegistryUrl:
                    this.ctx.officialPluginSources.npmMirrorRegistryUrl
                }
              : {}),
          networkPreference: effectiveNetworkPref,
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
      if (err instanceof PluginDeprecatedError) {
        throw new BusinessRouteError(410, "PLUGIN_RETIRED", err.message);
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

    if (this.ctx.pluginHost.isMounted(details.manifest.id)) {
      await this.ctx.pluginHost.unmountPlugin(details.manifest.id);
    }

    let mounted = false;
    const mod = await tryLoadDaemonPluginModule(
      this.ctx.pluginInstaller.getPluginsDir(),
      details,
      (reason) => {
        this.recordPluginLog(details.manifest.id, "warn", "daemon", reason);
      }
    );
    if (mod && this.ctx.onMountPlugin) {
      await this.ctx.onMountPlugin(details, mod);
      mounted = this.ctx.pluginHost.isMounted(details.manifest.id);
    }

    this.recordPluginLog(
      details.manifest.id,
      "info",
      "daemon",
      `已安装插件 ${details.manifest.id}@${details.manifest.version}（source=${details.sourceUsed ?? details.registryUsed ?? requestedSource}，mounted=${String(mounted)}）。`
    );

    return {
      ok: true,
      plugin: details,
      mounted,
      ...(details.sourceUsed !== undefined
        ? { sourceUsed: details.sourceUsed }
        : details.registryUsed !== undefined
          ? { sourceUsed: details.registryUsed }
          : {})
    };
  }

  async rollbackPlugin(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): Promise<Record<string, unknown>> {
    assertOwnerChief(trustedCallerScope, "/v1/plugins/rollback");
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
    const pluginId =
      typeof rawBody["pluginId"] === "string" ? rawBody["pluginId"].trim() : "";
    if (pluginId.length === 0) {
      throw new BusinessRouteError(
        400,
        "INVALID_PARAMS",
        "回滚插件需要提供非空 pluginId。"
      );
    }
    const targetVersion =
      typeof rawBody["targetVersion"] === "string" &&
      rawBody["targetVersion"].trim().length > 0
        ? rawBody["targetVersion"].trim()
        : undefined;

    if (this.ctx.pluginHost.isMounted(pluginId)) {
      await this.ctx.pluginHost.unmountPlugin(pluginId);
    }

    let restored: InstalledPluginDetails;
    try {
      restored = await this.ctx.pluginInstaller.rollback(pluginId, targetVersion);
    } catch (err) {
      throw new BusinessRouteError(
        404,
        "PLUGIN_ROLLBACK_FAILED",
        err instanceof Error ? err.message : String(err)
      );
    }

    let mounted = false;
    if (restored.enabled) {
      const mod = await tryLoadDaemonPluginModule(
        this.ctx.pluginInstaller.getPluginsDir(),
        restored,
        (reason) => {
          this.recordPluginLog(pluginId, "warn", "daemon", reason);
        }
      );
      if (mod && this.ctx.onMountPlugin) {
        await this.ctx.onMountPlugin(restored, mod);
        mounted = this.ctx.pluginHost.isMounted(pluginId);
      }
    }

    this.recordPluginLog(
      pluginId,
      "info",
      "daemon",
      `已回滚插件 ${pluginId} 至 v${restored.manifest.version}（mounted=${String(mounted)}）。`
    );

    return {
      ok: true,
      pluginId,
      version: restored.manifest.version,
      plugin: restored,
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

    let mountedFreshFromDisk = false;
    if (
      diskRecord &&
      !hostRecord &&
      enabled &&
      this.ctx.onMountPlugin &&
      this.ctx.pluginInstaller
    ) {
      const mod = await tryLoadDaemonPluginModule(
        this.ctx.pluginInstaller.getPluginsDir(),
        diskRecord,
        (reason) => {
          this.recordPluginLog(pluginId, "warn", "daemon", reason);
        }
      );
      if (mod) {
        await this.ctx.onMountPlugin({ ...diskRecord, enabled: true }, mod);
        mountedFreshFromDisk = true;
      }
    }

    if (
      !mountedFreshFromDisk &&
      this.ctx.pluginHost.getRecord(pluginId) &&
      this.ctx.onTogglePlugin
    ) {
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

    this.recordPluginLog(
      pluginId,
      "info",
      "daemon",
      enabled
        ? `已启用插件 ${pluginId}（mounted=${String(mounted)}）。`
        : `已停用插件 ${pluginId}（mounted=${String(mounted)}）。`
    );

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

    this.recordPluginLog(
      pluginId,
      "info",
      "daemon",
      `已卸载插件 ${pluginId}。`
    );

    return {
      ok: true,
      pluginId,
      uninstalled: true
    };
  }

  /**
   * Returns recent plugin runtime logs (always HTTP 200; returns empty `logs: []`
   * when the plugin is uninstalled or has no recorded runtime entries yet).
   */
  async getPluginLogs(
    rawPluginId: string | null,
    rawLimit: number | null,
    trustedCallerScope: CallerScope
  ): Promise<{
    ok: true;
    pluginId: string | null;
    logs: PluginRuntimeLogRecord[];
  }> {
    assertOwnerChief(trustedCallerScope, "/v1/plugins/logs");
    const limit =
      typeof rawLimit === "number" && Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_PLUGIN_LOGS_PER_PLUGIN)
        : DEFAULT_PLUGIN_LOGS_LIMIT;

    const normalizedId =
      typeof rawPluginId === "string" && rawPluginId.trim().length > 0
        ? rawPluginId.trim()
        : null;

    if (normalizedId !== null) {
      const bucket = this.pluginLogsById.get(normalizedId);
      if (!bucket || bucket.length === 0) {
        return {
          ok: true,
          pluginId: normalizedId,
          logs: []
        };
      }
      const recent = bucket.slice(-limit).reverse();
      return {
        ok: true,
        pluginId: normalizedId,
        logs: recent
      };
    }

    const allLogs: PluginRuntimeLogRecord[] = [];
    for (const bucket of this.pluginLogsById.values()) {
      allLogs.push(...bucket);
    }
    allLogs.sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
    return {
      ok: true,
      pluginId: null,
      logs: allLogs.slice(0, limit)
    };
  }

  ingestHostResourceMetrics(
    rawBody: unknown,
    trustedCallerScope: CallerScope
  ): HostMetricsIngestResult {
    assertOwnerChief(trustedCallerScope, "/v1/resources/host-metrics");
    if (!this.ctx.resourceMonitorService) {
      throw new BusinessRouteError(
        503,
        "RESOURCE_MONITOR_UNAVAILABLE",
        "ResourceMonitorService is not configured."
      );
    }
    const normalized = normalizeHostMetricsReport(rawBody);
    if (!normalized) {
      throw new BusinessRouteError(
        400,
        "INVALID_HOST_METRICS",
        "Request body must contain valid mainPid, electronProcesses, or coreServer metrics."
      );
    }
    return this.ctx.resourceMonitorService.ingestHostMetrics(normalized);
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
