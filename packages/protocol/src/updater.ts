export const NETWORK_ROUTE_PREFERENCES = [
  "auto",
  "domestic",
  "global"
] as const;

export type NetworkRoutePreference =
  (typeof NETWORK_ROUTE_PREFERENCES)[number];

export const UPDATE_SOURCE_IDS = ["github", "gitee"] as const;

export type UpdateSourceId = (typeof UPDATE_SOURCE_IDS)[number];

export const PLUGIN_REGISTRY_IDS = ["npmjs", "npmmirror"] as const;

export type PluginRegistryId = (typeof PLUGIN_REGISTRY_IDS)[number];

export const UPDATE_CHANNELS = ["stable", "prerelease"] as const;

export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

export type PluginRegistryOverride = "auto" | PluginRegistryId;

export type UpdatePackageKind = "setup-exe" | "portable-zip" | "split-7z-exe";

export interface UpdateSplitArchivePart {
  name: string;
  url: string;
  effectiveUrl?: string;
  size?: number;
  sha256?: string | null;
}

export type UpdateInstallState =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "extracting"
  | "verifying"
  | "ready"
  | "installing"
  | "error";

export type UpdateDownloadStage =
  | "idle"
  | "downloading"
  | "extracting"
  | "verifying"
  | "ready"
  | "error";

export interface UpdateDownloadProgress {
  stage: UpdateDownloadStage;
  phase: UpdateDownloadStage;
  bytesDownloaded: number;
  totalBytes: number | null;
  percent: number | null;
  source: UpdateSourceId;
  currentPart?: number;
  totalParts?: number;
  partName?: string;
  message?: string;
  updatedAt: number;
}

export interface UpdatePolicyConfig {
  routePreference: NetworkRoutePreference;
  includePrerelease: boolean;
  customGhProxyPrefix: string;
  pluginRegistryOverride: PluginRegistryOverride;
  timeoutMs: number;
  autoCheckEnabled?: boolean;
}

export type UpdatePolicyPatch = Partial<UpdatePolicyConfig>;

export const DEFAULT_UPDATE_POLICY: UpdatePolicyConfig = {
  routePreference: "auto",
  includePrerelease: true,
  customGhProxyPrefix: "",
  pluginRegistryOverride: "auto",
  timeoutMs: 15_000,
  autoCheckEnabled: false
} as const;

export const UPDATE_ENDPOINTS = {
  githubOwner: "Fish-under-sea",
  githubRepo: "Prismux",
  githubApiBase: "https://api.github.com",
  githubWebBase: "https://github.com",
  giteeOwner: "Fish-under-sea",
  giteeRepo: "Prismux",
  giteeApiBase: "https://gitee.com/api/v5",
  giteeWebBase: "https://gitee.com",
  npmRegistry: "https://registry.npmjs.org",
  npmMirrorRegistry: "https://registry.npmmirror.com"
} as const;

export interface SourceEndpointProbe {
  source: UpdateSourceId;
  url: string;
  reachable: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error?: string;
}

export interface SourceProbeReport {
  probedAt: number;
  recommendedSource: UpdateSourceId;
  recommendedRoute: Exclude<NetworkRoutePreference, "auto">;
  sources: SourceEndpointProbe[];
}

export interface UpdateAssetInfo {
  name: string;
  kind: UpdatePackageKind;
  downloadUrl: string;
  effectiveUrl: string;
  sizeBytes: number | null;
  sha256: string | null;
  sha256SourceUrl?: string;
  source: UpdateSourceId;
  parts?: UpdateSplitArchivePart[];
  totalBytes?: number | null;
  expectedExeName?: string;
  expectedSha256?: string | null;
  sha256Url?: string;
}

export interface UpdateCheckResult {
  checkedAt: number;
  currentVersion: string;
  hasUpdate: boolean;
  latestVersion: string | null;
  tagName: string | null;
  channel: UpdateChannel | null;
  prerelease: boolean;
  releaseName: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  htmlUrl: string | null;
  sourceUsed: UpdateSourceId;
  usedFallbackSource: boolean;
  recommendedAsset: UpdateAssetInfo | null;
  assets: UpdateAssetInfo[];
  probeReport?: SourceProbeReport;
  errors?: Array<{ source: UpdateSourceId; message: string }>;
}

export interface UpdateDownloadResult {
  downloadedAt: number;
  version: string;
  assetName: string;
  filePath: string;
  bytesDownloaded: number;
  totalBytes: number | null;
  resumedFromBytes: number;
  sha256: string;
  verified: true;
  sourceUsed: UpdateSourceId;
  usedFallbackSource: boolean;
  downloadUrl: string;
  packageKind?: UpdatePackageKind;
}

export interface UpdaterStatusSnapshot {
  ok?: boolean;
  currentVersion: string;
  portableMode: boolean;
  policy: UpdatePolicyConfig;
  checking: boolean;
  downloading: boolean;
  installState: UpdateInstallState;
  progress: UpdateDownloadProgress | null;
  downloadedFilePath: string | null;
  downloadedSha256: string | null;
  lastCheck: UpdateCheckResult | null;
  lastDownload: UpdateDownloadResult | null;
  lastProbe: SourceProbeReport | null;
  lastError: string | null;
  autoCheckEnabled?: boolean;
  nextAutoCheckAt?: number | null;
}

export type UpdaterSseEventType =
  | "status"
  | "checking"
  | "available"
  | "up-to-date"
  | "progress"
  | "extracting"
  | "verifying"
  | "ready"
  | "error";

export interface UpdaterSseEventPayload {
  type: UpdaterSseEventType;
  timestamp: number;
  installState: UpdateInstallState;
  progress: UpdateDownloadProgress | null;
  downloadedFilePath: string | null;
  downloadedSha256: string | null;
  portableMode: boolean;
  error?: string | null;
  status: UpdaterStatusSnapshot;
}

// ---------------------------------------------------------------------------
// Service Diagnostics Protocol (GET /v1/diagnostics/services)
// ---------------------------------------------------------------------------

export const DIAGNOSTIC_CATEGORIES = [
  "host_core",
  "memory_sync",
  "ai_providers",
  "simulators_media",
  "network_mirrors",
  "dormant_engines"
] as const;

export type DiagnosticCategoryId = (typeof DIAGNOSTIC_CATEGORIES)[number];

export type DiagnosticCheckStatus = "ok" | "degraded" | "error";

export interface DiagnosticCheckItem {
  id: string;
  category: DiagnosticCategoryId;
  name: string;
  status: DiagnosticCheckStatus;
  summary: string;
  detail?: string;
  fixAction?: string;
  fixCommand?: string;
  settingsRoute?: string;
  version?: string | null;
  latencyMs?: number | null;
}

export interface DiagnosticGroupSummary {
  id: DiagnosticCategoryId;
  label: string;
  title: string;
  status: DiagnosticCheckStatus;
  okCount: number;
  degradedCount: number;
  errorCount: number;
  items: DiagnosticCheckItem[];
}

export interface ServiceDiagnosticsResponse {
  ok: boolean;
  checkedAt: number;
  durationMs: number;
  cached: boolean;
  summary: {
    total: number;
    ok: number;
    degraded: number;
    error: number;
  };
  groups: DiagnosticGroupSummary[];
  items: DiagnosticCheckItem[];
}

// ---------------------------------------------------------------------------
// System Port Scanner Protocol (GET /v1/system/ports, POST /v1/system/ports/kill)
// ---------------------------------------------------------------------------

export type ListeningPortScope = "workspace" | "external";

export type PortAttributionConfidence = "cwd" | "command" | "none";

export type PortServiceProtocol = "http" | "https" | "unknown";

export interface ListeningPortEntry {
  id: string;
  port: number;
  pid: number;
  processName: string;
  host: string;
  bindHost: string;
  connectHost: string;
  address: string;
  protocol: "tcp";
  serviceProtocol: PortServiceProtocol;
  url: string;
  cwd: string | null;
  scope: ListeningPortScope;
  attributionConfidence: PortAttributionConfidence;
  isContainer: boolean;
  workspace: string | null;
  protected: boolean;
  protectedReason?: string;
}

export interface SystemPortsResponse {
  ok: boolean;
  platform: string;
  scannedAt: number;
  workspace: string | null;
  ports: ListeningPortEntry[];
  totalCount: number;
  workspaceCount: number;
  externalCount: number;
  metadataAvailable?: boolean;
  unavailableReason?: string;
}

export interface KillSystemPortRequest {
  pid: number;
  signal?: string;
}

export interface KillSystemPortResponse {
  ok: boolean;
  pid: number;
  killed: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// System Resource Monitor Protocol (GET /v1/system/resources, POST /v1/system/pty/kill)
// ---------------------------------------------------------------------------

export type ProcessMemoryMetric = "rss" | "working-set" | "footprint";

export type ProcessCommitMetric = "private-bytes";

export interface PtyResourceEntry {
  sessionId: string;
  pid: number | null;
  workspace: string | null;
  cwd: string;
  command: string | null;
  title: string;
  group: "default" | "agent-scratch";
  cpuPercent: number | null;
  memoryBytes: number | null;
  privateMemoryBytes?: number | null;
  hasLocalSamples: boolean;
  bufferBytes: number;
  alive: boolean;
  stale: boolean;
  idleMs: number | null;
}

export interface WorkspaceResourceEntry {
  workspace: string;
  label: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  privateMemoryBytes?: number | null;
  hasLocalSamples: boolean;
  history: number[];
  ptyCount: number;
  alivePtyCount: number;
  stalePtyCount: number;
  ptys: PtyResourceEntry[];
}

export interface SystemResourcesResponse {
  ok: boolean;
  collectedAt: number;
  sampledAt: number;
  processMemoryMetric: ProcessMemoryMetric;
  processCommitMetric?: ProcessCommitMetric;
  totalCpuPercent: number | null;
  totalMemoryBytes: number;
  totalPrivateMemoryBytes?: number | null;
  hostMemoryTotalBytes: number;
  orphanCount: number;
  history: number[];
  host: {
    platform: string;
    cpuCores: number;
    cpuPercent: number | null;
    memoryBytes: number;
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    availableMemoryBytes: number;
    memoryUsedPercent: number;
    loadAvg: number[];
    uptimeSec: number;
  };
  daemon: {
    pid: number;
    cpuPercent: number | null;
    memoryBytes: number;
    privateMemoryBytes?: number | null;
  };
  coreServer: {
    pid: number | null;
    cpuPercent: number | null;
    memoryBytes: number | null;
    privateMemoryBytes?: number | null;
    state: string;
  } | null;
  workspaces: WorkspaceResourceEntry[];
  ptys: PtyResourceEntry[];
}

export interface KillSystemPtyRequest {
  sessionId: string;
  signal?: string;
}

export interface KillSystemPtyResponse {
  ok: boolean;
  sessionId: string;
  killed: boolean;
  removed: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Sync Operations & Memory Retrieval Mode Protocol
// ---------------------------------------------------------------------------

export type MemoryRetrievalMode = "fts5+sqlite-vec" | "fts5-only";

export type SyncOperationChannel = "webdav" | "s3" | "github";

export interface SyncChannelOperationResult {
  channel: SyncOperationChannel;
  ok: boolean;
  enabled: boolean;
  configured: boolean;
  reachable?: boolean;
  exists?: boolean;
  etag?: string | null;
  conflictDetected?: boolean;
  degradedToHead?: boolean;
  commitSha?: string;
  latencyMs: number | null;
  uploaded?: number;
  downloaded?: number;
  message?: string;
  error?: string;
}

export interface SyncNowRequest {
  channels?: SyncOperationChannel[];
  direction?: "both" | "upload" | "download";
  force?: boolean;
  passphrase?: string;
}

export interface SyncNowResponse {
  ok: boolean;
  syncedAt: number;
  timestamp: number;
  uploaded: number;
  downloaded: number;
  etag: string | null;
  conflictDetected: boolean;
  channels: SyncChannelOperationResult[];
  results: SyncChannelOperationResult[];
  error?: string;
  message?: string;
}

export interface SyncTestRequest {
  channels?: SyncOperationChannel[];
}

export interface SyncTestResponse {
  ok: boolean;
  testedAt: number;
  timestamp: number;
  channels: SyncChannelOperationResult[];
  results: SyncChannelOperationResult[];
  error?: string;
  message?: string;
}
