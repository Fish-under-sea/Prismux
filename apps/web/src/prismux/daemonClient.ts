export interface DaemonConnectionInfo {
  baseUrl: string;
  token: string;
  ready: boolean;
}

// @effect-diagnostics-next-line extendsNativeError:off -- Standard HTTP client error outside Effect runtime.
export class PrismuxDaemonError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, options: { status: number; code: string; details?: unknown }) {
    super(message);
    this.name = "PrismuxDaemonError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }
}

export interface WallpaperImportPayload {
  sourcePath?: string;
  fileName?: string;
  base64?: string;
  title?: string;
}

export interface DaemonWallpaperItemDto {
  id: string;
  title: string;
  type: "scene" | "web" | "video" | "image";
  source: "steam" | "custom" | "builtin";
  previewUrl: string | null;
  mediaUrl: string | null;
  webEntryUrl?: string | null;
  filePath: string | null;
  dirPath?: string | null;
  width: number | null;
  height: number | null;
  orientation: "landscape" | "portrait" | "square" | "unknown";
  contentRating: "everyone" | "pg13" | "mature" | "unrated";
  userProperties?: Array<{
    name: string;
    ptype: string;
    text: string;
    order: number;
    value: string | number | boolean | null;
    defaultValue: string | number | boolean | null;
    overridden: boolean;
    condition?: string;
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{
      label: string;
      value: string | number | boolean;
      condition?: string;
    }>;
    fileType?: string;
  }>;
  tags?: string[];
  schemeColor?: string | null;
  builtinSceneId?: "aurora-prism" | "midnight-abyss" | "liquid-silk" | "cyber-twilight";
  sceneLiveSupported?: boolean;
  webLiveSupported?: boolean;
  fileSize?: number;
  mtimeMs?: number;
}

export interface DaemonWallpaperInventoryResponse {
  ok?: boolean;
  schemaVersion: number;
  scannedAt: number;
  customWallpaperDir: string;
  customDirs: string[];
  steamRootOverride: string;
  steamRoots: string[];
  workshopDirs: string[];
  items: DaemonWallpaperItemDto[];
  totalCount: number;
}

export interface DaemonWallpaperImportResponse {
  ok: boolean;
  item: DaemonWallpaperItemDto;
  inventory?: DaemonWallpaperInventoryResponse;
}

export interface DaemonSystemFontsResponse {
  ok?: boolean;
  fonts: string[];
  approximate?: boolean;
  source?: string;
  cached?: boolean;
}

export interface DaemonChiefSlotDto {
  threadId: string;
  provider: string;
  activeProvider?: string;
  secretaryName?: string;
  agentsMdPath?: string;
  model?: string;
  reasoningEffort?: string;
  defaultEffort?: string;
  status?: string;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface DaemonChiefStatusResponse {
  ok: boolean;
  slot: DaemonChiefSlotDto;
  secretaryName?: string;
  agentsMdPath?: string;
  dialMode: "agent" | "oracle" | "review";
  availableProviders?: string[];
  availableDialModes?: Array<"agent" | "oracle" | "review">;
  t3Connected?: boolean;
}

export interface DaemonChiefProfileUpdateResponse {
  ok: boolean;
  slot: DaemonChiefSlotDto;
  secretaryName: string;
  agentsMdPath: string;
}

export interface DaemonChiefAgentsMdResponse {
  ok: boolean;
  path: string;
  content: string;
  secretaryName: string;
  updatedAt: number;
  exists: boolean;
  isDefaultTemplate?: boolean;
}

export interface DaemonMemoryStatsResponse {
  ok: boolean;
  callerScope: string;
  totalEntries: number;
  vectorSearchEnabled: boolean;
  retrievalMode?: "fts5+sqlite-vec" | "fts5-only";
  sqliteVecLoaded?: boolean;
  byNamespace: Record<string, number>;
  byKind: Record<string, number>;
  latestUpdatedAt: number | null;
  dbPath?: string;
}

export interface DaemonMemorySearchItemDto {
  id: string;
  namespace: string;
  kind: string;
  title?: string;
  content: string;
  tags?: string[];
  score?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface DaemonMemorySearchResponse {
  ok: boolean;
  callerScope?: string;
  query?: string;
  results: DaemonMemorySearchItemDto[];
  items?: DaemonMemorySearchItemDto[];
  total?: number;
}

export interface DaemonObsidianImportResponse {
  ok: boolean;
  imported?: number;
  skipped?: number;
  namespace?: string;
  summary?: Record<string, unknown>;
  [key: string]: unknown;
}

export type DaemonObsidianCuratedKind =
  | "preference"
  | "decision"
  | "project"
  | "knowledge"
  | "experience";

export type DaemonObsidianCurationSource = "agent" | "structured-fallback";

export interface DaemonObsidianCuratedItemDto {
  id: string;
  title: string;
  summary: string;
  kind: DaemonObsidianCuratedKind;
  namespace: string;
  tags: string[];
  sourceFile: string;
  selected: boolean;
  curationSource: DaemonObsidianCurationSource;
  redactedSecrets?: number;
}

export interface DaemonObsidianImportPlanStatsDto {
  scannedFiles: number;
  curatedCount: number;
  dedupedCount: number;
  filteredNoiseCount: number;
  redactedSecretCount: number;
}

export interface DaemonObsidianImportPlanResponse {
  ok: boolean;
  vaultPath: string;
  namespace: string;
  curationSource: DaemonObsidianCurationSource;
  curatorLabel?: string;
  fallbackReason?: string;
  items: DaemonObsidianCuratedItemDto[];
  stats: DaemonObsidianImportPlanStatsDto;
}

export interface DaemonObsidianImportCommitResponse {
  ok: boolean;
  committedCount: number;
  skippedCount: number;
  entryIds: string[];
  namespace: string;
}

export interface DaemonSyncStatusResponse {
  ok: boolean;
  status: Record<string, unknown>;
  syncMatrix: Record<string, { upload: boolean; download: boolean }>;
  vaultPaths?: Record<string, unknown>;
  channels: {
    webdav: (Record<string, unknown> & { enabled?: boolean; hasSecret?: boolean }) | null;
    s3: (Record<string, unknown> & { enabled?: boolean; hasSecret?: boolean }) | null;
    github: (Record<string, unknown> & { enabled?: boolean; hasSecret?: boolean }) | null;
  };
  hasPassphrase?: boolean;
  configPath?: string;
}

export interface DaemonPluginCatalogEntryDto {
  id: string;
  name?: string;
  title?: string;
  packageName?: string;
  description?: string;
  version: string;
  engines?: Record<string, string>;
  realms?: string[];
  permissions?: string[];
  modelVisible?: boolean;
  sha256?: string;
  bytes?: number;
  status?: string;
  installed?: boolean;
  enabled?: boolean;
  mounted?: boolean;
  installedVersion?: string;
  distribution?: string;
  [key: string]: unknown;
}

export interface DaemonRetiredPluginEntryDto {
  id: string;
  packageName: string;
  titleZh?: string;
  titleEn?: string;
  status: "deprecated";
  replacedByBuiltin: true;
  noticeZh: string;
  noticeEn: string;
  detailZh?: string;
  detailEn?: string;
}

export interface DaemonPluginCatalogResponse {
  ok: boolean;
  schemaVersion?: number;
  generatedAt?: string;
  officialCatalogPath?: string;
  plugins: DaemonPluginCatalogEntryDto[];
  retiredPlugins?: DaemonRetiredPluginEntryDto[];
  installedCount?: number;
}

export interface DaemonInstalledPluginDto {
  manifest: {
    id: string;
    name?: string;
    version: string;
    description?: string;
    realms?: string[];
    permissions?: string[];
    modelVisible?: boolean;
    [key: string]: unknown;
  };
  enabled: boolean;
  mounted?: boolean;
  distribution?: string;
  installedAt?: string | number;
  source?: string;
  [key: string]: unknown;
}

export interface DaemonInstalledPluginsResponse {
  ok: boolean;
  plugins: DaemonInstalledPluginDto[];
  totalCount: number;
}

export type DaemonDiagnosticsStatus = "ok" | "degraded" | "error";

export interface DaemonDiagnosticsItemDto {
  id: string;
  category: string;
  name: string;
  status: DaemonDiagnosticsStatus;
  summary: string;
  detail?: string;
  fixAction?: string;
  fixCommand?: string;
  settingsRoute?: string;
  version?: string | null;
  latencyMs?: number | null;
  [key: string]: unknown;
}

export interface DaemonDiagnosticsGroupDto {
  id: string;
  label?: string;
  title?: string;
  status?: DaemonDiagnosticsStatus;
  items: DaemonDiagnosticsItemDto[];
  [key: string]: unknown;
}

export interface DaemonDiagnosticsServicesResponse {
  ok?: boolean;
  checkedAt: number;
  durationMs?: number;
  cached?: boolean;
  groups?: DaemonDiagnosticsGroupDto[];
  items: DaemonDiagnosticsItemDto[];
  summary?: {
    total?: number;
    ok?: number;
    degraded?: number;
    error?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface DaemonSyncTriggerRequest {
  channels?: Array<"webdav" | "s3" | "github">;
  direction?: "both" | "upload" | "download";
  force?: boolean;
  [key: string]: unknown;
}

export interface DaemonSyncChannelResultDto {
  channel: string;
  ok: boolean;
  latencyMs?: number | null;
  message?: string;
  error?: string;
  uploaded?: number;
  downloaded?: number;
  [key: string]: unknown;
}

export interface DaemonSyncNowResponse {
  ok: boolean;
  syncedAt?: number;
  timestamp?: number;
  uploaded?: number;
  downloaded?: number;
  channels?: DaemonSyncChannelResultDto[] | Record<string, unknown>;
  results?: DaemonSyncChannelResultDto[] | Record<string, unknown>;
  error?: string;
  message?: string;
  [key: string]: unknown;
}

export interface DaemonSyncTestRequest {
  channels?: Array<"webdav" | "s3" | "github">;
  [key: string]: unknown;
}

export interface DaemonSyncTestResponse {
  ok: boolean;
  testedAt?: number;
  timestamp?: number;
  channels?: DaemonSyncChannelResultDto[] | Record<string, unknown>;
  results?: DaemonSyncChannelResultDto[] | Record<string, unknown>;
  error?: string;
  message?: string;
  [key: string]: unknown;
}

export type DaemonUpdateChannel = "stable" | "prerelease";

export type DaemonUpdatePackageKind = "setup-exe" | "portable-zip" | "split-7z-exe";

export interface DaemonUpdateSplitPartDto {
  name: string;
  url: string;
  size?: number;
}

export interface DaemonUpdateAssetDto {
  name: string;
  kind: DaemonUpdatePackageKind | string;
  downloadUrl?: string;
  effectiveUrl: string;
  sizeBytes?: number | null;
  totalBytes?: number | null;
  sha256?: string | null;
  expectedSha256?: string | null;
  sha256Url?: string;
  sha256SourceUrl?: string;
  expectedExeName?: string;
  parts?: DaemonUpdateSplitPartDto[];
  source: "github" | "gitee" | string;
  [key: string]: unknown;
}

export interface DaemonUpdateDownloadProgressDto {
  stage?: "idle" | "downloading" | "extracting" | "verifying" | "ready" | "error" | string;
  phase?: string;
  percent?: number | null;
  bytesDownloaded?: number;
  totalBytes?: number | null;
  currentPart?: number;
  totalParts?: number;
  partName?: string;
  message?: string;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface DaemonUpdateDownloadResultDto {
  downloadedAt?: number;
  version?: string;
  assetName?: string;
  filePath: string;
  bytesDownloaded?: number;
  totalBytes?: number | null;
  resumedFromBytes?: number;
  sha256: string;
  verified?: boolean;
  sourceUsed?: "github" | "gitee" | string;
  usedFallbackSource?: boolean;
  downloadUrl?: string;
  [key: string]: unknown;
}

export interface DaemonUpdaterStatusResponse {
  ok?: boolean;
  currentVersion?: string;
  portableMode?: boolean;
  policy?: Record<string, unknown>;
  route?: Record<string, unknown>;
  checking?: boolean;
  downloading?: boolean;
  installState?: string;
  progress?: DaemonUpdateDownloadProgressDto | null;
  downloadedFilePath?: string | null;
  downloadedSha256?: string | null;
  lastCheck?: Record<string, unknown> | null;
  lastDownload?: DaemonUpdateDownloadResultDto | null;
  lastProbe?: Record<string, unknown> | null;
  lastError?: string | null;
  autoCheckEnabled?: boolean;
  nextAutoCheckAt?: number | null;
  [key: string]: unknown;
}

export interface DaemonUpdaterDownloadRequest {
  kind?: DaemonUpdatePackageKind;
  destDir?: string;
  sourceOverride?: "github" | "gitee";
  assetName?: string;
  [key: string]: unknown;
}

export interface DaemonUpdaterEvent {
  event: string;
  id?: string;
  data: unknown;
  rawData: string;
  receivedAt: number;
}

export interface DaemonUpdaterEventsOptions {
  onError?: (error: unknown) => void;
  onOpen?: () => void;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  maxReconnectAttempts?: number;
  signal?: AbortSignal;
}

export interface DaemonSystemPortEntryDto {
  id?: string;
  port: number;
  pid: number;
  processName: string;
  host?: string;
  bindHost?: string;
  connectHost?: string;
  address?: string;
  protocol?: string;
  serviceProtocol?: "http" | "https" | "unknown";
  url?: string;
  cwd?: string | null;
  scope: "workspace" | "external";
  workspace?: string | null;
  attributionConfidence?: "cwd" | "command" | "none";
  isContainer?: boolean;
  protected: boolean;
  protectedReason?: string;
  [key: string]: unknown;
}

export interface DaemonSystemPortsResponse {
  ok?: boolean;
  scannedAt?: number;
  workspace?: string | null;
  unavailableReason?: string | null;
  ports: DaemonSystemPortEntryDto[];
  [key: string]: unknown;
}

export interface DaemonKillSystemPortResponse {
  ok: boolean;
  pid: number;
  killed?: boolean;
  message?: string;
  error?: string;
  [key: string]: unknown;
}

export type DaemonOvernightInboundMode = "gmail-oauth2" | "imap";
export type DaemonOvernightMailPreset = "qq" | "163" | "outlook" | "custom";
export type DaemonOvernightWindowMode = "scheduled" | "always";
export type DaemonOvernightRunStatus =
  | "completed"
  | "failed"
  | "blocked_whitelist"
  | "skipped";

export interface DaemonOvernightGmailConfigDto {
  clientId: string;
  redirectUri: string;
  boundEmail: string;
  connected: boolean;
  connectedAt: number | null;
  lastHistoryId?: string;
}

export interface DaemonOvernightImapSmtpConfigDto {
  preset: DaemonOvernightMailPreset;
  email: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string;
  mailbox: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  fromName: string;
}

export interface DaemonOvernightStrategyConfigDto {
  triggerTag: string;
  allowedSenders: string[];
  windowMode: DaemonOvernightWindowMode;
  windowStart: string;
  windowEnd: string;
  pollIntervalMinutes: number;
  targetWorkspaceDir: string;
  agentProvider: string;
  agentModel: string;
  oracleReviewEnabled: boolean;
  localWorktreeOnlyNoPush: boolean;
}

export interface DaemonOvernightConfigDto {
  schemaVersion: 1;
  updatedAt: number;
  enabled: boolean;
  mode: DaemonOvernightInboundMode;
  gmail: DaemonOvernightGmailConfigDto;
  imapSmtp: DaemonOvernightImapSmtpConfigDto;
  strategy: DaemonOvernightStrategyConfigDto;
}

export interface DaemonOvernightSecretPresenceDto {
  hasGmailClientSecret: boolean;
  hasGmailRefreshToken: boolean;
  hasImapPassword: boolean;
  hasSmtpPassword: boolean;
}

export interface DaemonOvernightMailProbeChannelDto {
  ok: boolean;
  latencyMs: number;
  message: string;
  detail?: string;
}

export interface DaemonOvernightMailTestResponse {
  ok: boolean;
  mode: DaemonOvernightInboundMode;
  checkedAt: number;
  durationMs: number;
  inbound: DaemonOvernightMailProbeChannelDto;
  outbound: DaemonOvernightMailProbeChannelDto;
  message: string;
}

export interface DaemonOvernightConfigSnapshot {
  ok: true;
  config: DaemonOvernightConfigDto;
  secrets: DaemonOvernightSecretPresenceDto;
  credentialsFile: string;
  runtime: {
    pollerActive: boolean;
    inAllowedWindow: boolean;
    oauthPending: boolean;
    lastPollAt: number | null;
    lastPollError: string | null;
    lastTestResult: DaemonOvernightMailTestResponse | null;
    runsCount: number;
  };
}

export interface DaemonOvernightConfigPatch {
  enabled?: boolean;
  mode?: DaemonOvernightInboundMode;
  gmail?: Partial<Pick<DaemonOvernightGmailConfigDto, "clientId" | "redirectUri" | "boundEmail">>;
  imapSmtp?: Partial<DaemonOvernightImapSmtpConfigDto>;
  strategy?: Partial<DaemonOvernightStrategyConfigDto>;
  secrets?: {
    gmailClientSecret?: string;
    gmailRefreshToken?: string;
    imapPassword?: string;
    smtpPassword?: string;
  };
  clearSecrets?: {
    gmailClientSecret?: boolean;
    gmailRefreshToken?: boolean;
    imapPassword?: boolean;
    smtpPassword?: boolean;
  };
}

export interface DaemonOvernightTestReportResponse {
  ok: true;
  messageId: string;
  recipient: string;
  provider: string;
  sentAt: number;
  subject: string;
  htmlPreviewLength: number;
  message: string;
}

export interface DaemonOvernightRunRecordDto {
  id: string;
  jobId: string;
  messageId: string;
  threadId: string;
  subject: string;
  sender: string;
  status: DaemonOvernightRunStatus;
  branchName: string | null;
  changedFilesCount: number;
  testPassed: boolean | null;
  oracleSummary: string;
  reviewComments: string[];
  deepLink: string | null;
  reportSent: boolean;
  createdAt: number;
  completedAt: number;
  errorMessage: string | null;
}

export interface DaemonOvernightRunsResponse {
  ok: true;
  runs: DaemonOvernightRunRecordDto[];
  total: number;
  lastPollAt: number | null;
  lastPollError: string | null;
}

export interface DaemonOvernightPollNowResponse {
  ok: true;
  polledAt: number;
  fetchedCount: number;
  matchedCount: number;
  executedCount: number;
  blockedByWhitelistCount: number;
  skippedDuplicateCount: number;
  runs: DaemonOvernightRunRecordDto[];
  message: string;
}

export interface DaemonOvernightGmailOAuthStartResponse {
  ok: true;
  authUrl: string;
  state: string;
  redirectUri: string;
  expiresAt: number;
}

export interface DaemonPtyResourceDto {
  sessionId: string;
  pid?: number | null;
  workspace?: string | null;
  cwd?: string | null;
  command?: string | null;
  title?: string | null;
  cpuPercent?: number | null;
  memoryBytes?: number | null;
  stale?: boolean;
  alive?: boolean;
  idleMs?: number | null;
  [key: string]: unknown;
}

export interface DaemonWorkspaceResourceDto {
  workspace: string;
  label?: string;
  cpuPercent?: number | null;
  memoryBytes?: number | null;
  ptyCount?: number;
  ptys?: DaemonPtyResourceDto[];
  [key: string]: unknown;
}

export interface DaemonProcessResourceDto {
  pid: number;
  parentPid?: number | null;
  name: string;
  processName?: string;
  commandLine?: string | null;
  role:
    | "electron-main"
    | "electron-renderer"
    | "electron-gpu"
    | "electron-utility"
    | "t3-server"
    | "daemon"
    | "agent"
    | "terminal"
    | "pty"
    | "child"
    | string;
  category: "desktop" | "core" | "terminal" | "agent" | string;
  cpuPercent?: number | null;
  memoryBytes?: number | null;
  privateMemoryBytes?: number | null;
  alive?: boolean;
  source?: string;
  sessionId?: string | null;
  workspace?: string | null;
  stale?: boolean;
  [key: string]: unknown;
}

export interface DaemonDesktopResourceSummaryDto {
  pid?: number | null;
  cpuPercent?: number | null;
  memoryBytes?: number | null;
  privateMemoryBytes?: number | null;
  processCount?: number;
  source?: string;
  [key: string]: unknown;
}

export interface DaemonSystemResourcesResponse {
  ok?: boolean;
  collectedAt?: number;
  sampledAt?: number;
  totalCpuPercent?: number | null;
  totalMemoryBytes?: number | null;
  totalPrivateMemoryBytes?: number | null;
  hostMemoryTotalBytes?: number | null;
  processMemoryMetric?: "working-set" | "footprint" | "rss" | string;
  orphanCount?: number;
  hasLocalSamples?: boolean;
  history?: number[];
  host?: {
    cpuCores?: number;
    cpuPercent?: number | null;
    memoryBytes?: number | null;
    totalMemoryBytes?: number | null;
    [key: string]: unknown;
  };
  daemon?: {
    pid?: number;
    cpuPercent?: number | null;
    memoryBytes?: number | null;
    privateMemoryBytes?: number | null;
    [key: string]: unknown;
  };
  t3Server?: {
    pid?: number | null;
    cpuPercent?: number | null;
    memoryBytes?: number | null;
    privateMemoryBytes?: number | null;
    state?: string;
    hostedBy?: "electron" | "electron-in-process" | "daemon-supervisor" | "external" | string;
    label?: string;
    childCount?: number;
    [key: string]: unknown;
  } | null;
  desktop?: DaemonDesktopResourceSummaryDto | null;
  processes?: DaemonProcessResourceDto[];
  processCount?: number;
  activeAgentCount?: number;
  activeTerminalCount?: number;
  hostMetricsSource?: string;
  hostMetricsUpdatedAt?: number | null;
  workspaces?: DaemonWorkspaceResourceDto[];
  ptys?: DaemonPtyResourceDto[];
  [key: string]: unknown;
}

export interface DaemonKillStalePtyResponse {
  ok: boolean;
  sessionId: string;
  killed?: boolean;
  message?: string;
  error?: string;
  [key: string]: unknown;
}

export type DaemonCliInstallMethod = "npm-global" | "native-self-update" | "unsupported";

export interface DaemonCliUpdateItemDto {
  provider: string;
  canonicalProvider: string | null;
  command: string | null;
  packageName: string | null;
  installed: boolean;
  installedPath: string | null;
  currentVersion: string | null;
  rawVersion: string | null;
  latestVersion: string | null;
  hasUpdate: boolean;
  updateSupported: boolean;
  installMethod: DaemonCliInstallMethod;
  registryUsed: string | null;
  checkedAt: number;
  cached: boolean;
  error?: string;
}

export interface DaemonCliUpdatesCheckResponse {
  ok: true;
  checkedAt: number;
  cached: boolean;
  items: DaemonCliUpdateItemDto[];
  item?: DaemonCliUpdateItemDto;
}

export interface DaemonCliUpdateInstallResponse {
  ok: true;
  provider: string;
  packageName: string | null;
  method: Exclude<DaemonCliInstallMethod, "unsupported">;
  previousVersion: string | null;
  newVersion: string | null;
  latestVersion: string | null;
  registryUsed: string | null;
  durationMs: number;
  item: DaemonCliUpdateItemDto;
  message: string;
}

export type DaemonOfficialQuotaWindowKind = "weekly" | "5h" | "other";

export interface DaemonOfficialQuotaWindowDto {
  id: string;
  group: string;
  groupId: string;
  window: DaemonOfficialQuotaWindowKind;
  shortLabel: string;
  detailLabel: string;
  remainingPercent: number;
  usedPercent: number;
  resetAtIso: string | null;
  resetAtMs: number | null;
  rawGroup?: string;
  rawWindow?: string;
}

export type DaemonOfficialQuotaProviderStatus =
  | "ok"
  | "not_installed"
  | "unauthenticated"
  | "timeout"
  | "error";

export interface DaemonOfficialQuotaProviderDto {
  id: "antigravity" | string;
  providerId: string;
  displayName: string;
  source: "official-cli" | string;
  command: string;
  status: DaemonOfficialQuotaProviderStatus;
  available: boolean;
  executablePath: string | null;
  windows: DaemonOfficialQuotaWindowDto[];
  remainingCredits: number | null;
  fetchedAt: number;
  fetchedAtIso: string;
  error: string | null;
}

export interface DaemonOfficialQuotaSummaryResponse {
  ok: true;
  cached: boolean;
  cacheTtlMs: number;
  fetchedAt: number;
  fetchedAtIso: string;
  providers: DaemonOfficialQuotaProviderDto[];
  antigravity: DaemonOfficialQuotaProviderDto;
}

const EMPTY_CONNECTION_INFO: DaemonConnectionInfo = {
  baseUrl: "",
  token: "",
  ready: false,
};

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function encodeSubPath(subPath: string): string {
  return subPath
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export class PrismuxDaemonClient {
  private cachedInfo: DaemonConnectionInfo = { ...EMPTY_CONNECTION_INFO };
  private inflightInfo: Promise<DaemonConnectionInfo> | null = null;

  getCachedConnectionInfo(): DaemonConnectionInfo {
    return { ...this.cachedInfo };
  }

  async getConnectionInfo(forceRefresh = false): Promise<DaemonConnectionInfo> {
    if (!forceRefresh && this.cachedInfo.ready && this.cachedInfo.baseUrl.length > 0) {
      return { ...this.cachedInfo };
    }
    if (!forceRefresh && this.inflightInfo) {
      return this.inflightInfo;
    }

    const probe = async (): Promise<DaemonConnectionInfo> => {
      try {
        const bridge = typeof window !== "undefined" ? window.desktopBridge?.prismux : undefined;
        if (bridge && typeof bridge.getDaemonInfo === "function") {
          const info = await bridge.getDaemonInfo();
          const normalized: DaemonConnectionInfo = {
            baseUrl: typeof info?.baseUrl === "string" ? normalizeBaseUrl(info.baseUrl) : "",
            token: typeof info?.token === "string" ? info.token : "",
            ready: Boolean(info?.ready && info?.baseUrl),
          };
          this.cachedInfo = normalized;
          return { ...normalized };
        }
      } catch {
        // Non-Electron or transient bridge unavailability degrades smoothly.
      }

      const fallbackGlobal = globalThis as {
        __PRISMUX_DAEMON_URL__?: unknown;
        __PRISMUX_DAEMON_TOKEN__?: unknown;
      };
      if (typeof fallbackGlobal.__PRISMUX_DAEMON_URL__ === "string" && fallbackGlobal.__PRISMUX_DAEMON_URL__.trim().length > 0) {
        const normalized: DaemonConnectionInfo = {
          baseUrl: normalizeBaseUrl(fallbackGlobal.__PRISMUX_DAEMON_URL__),
          token: typeof fallbackGlobal.__PRISMUX_DAEMON_TOKEN__ === "string" ? fallbackGlobal.__PRISMUX_DAEMON_TOKEN__ : "",
          ready: true,
        };
        this.cachedInfo = normalized;
        return { ...normalized };
      }

      this.cachedInfo = { ...EMPTY_CONNECTION_INFO };
      return { ...EMPTY_CONNECTION_INFO };
    };

    const promise = probe().finally(() => {
      if (this.inflightInfo === promise) {
        this.inflightInfo = null;
      }
    });
    this.inflightInfo = promise;
    return promise;
  }

  async requestJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    let info = await this.getConnectionInfo(false);
    if (!info.ready || !info.baseUrl) {
      info = await this.getConnectionInfo(true);
    }
    if (!info.ready || !info.baseUrl) {
      throw new PrismuxDaemonError("Prismux Daemon is unavailable in the current environment.", {
        status: 503,
        code: "DAEMON_UNAVAILABLE",
      });
    }

    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = `${info.baseUrl}${normalizedPath}`;
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }
    if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (info.token) {
      headers.set("Authorization", `Bearer ${info.token}`);
      headers.set("X-Prismux-Token", info.token);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers,
      });
    } catch (error) {
      throw new PrismuxDaemonError(
        error instanceof Error ? error.message : "Failed to reach Prismux Daemon.",
        {
          status: 0,
          code: "DAEMON_NETWORK_ERROR",
          details: error,
        },
      );
    }

    const rawText = await response.text();
    let parsed: unknown = null;
    if (rawText.length > 0) {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = { raw: rawText };
      }
    }

    if (!response.ok) {
      const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
      const errObj =
        record && record.error && typeof record.error === "object"
          ? (record.error as Record<string, unknown>)
          : record;
      const message =
        typeof errObj?.message === "string"
          ? errObj.message
          : typeof record?.message === "string"
            ? record.message
            : `Daemon request failed (${response.status} ${response.statusText})`;
      const code =
        typeof errObj?.code === "string"
          ? errObj.code
          : typeof record?.code === "string"
            ? record.code
            : `HTTP_${response.status}`;
      if (
        code === "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED" &&
        typeof window !== "undefined" &&
        typeof window.dispatchEvent === "function"
      ) {
        const detail = {
          code: "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED" as const,
          ...(typeof record?.reasonCode === "string" ? { reasonCode: record.reasonCode } : {}),
          providerId:
            typeof record?.providerId === "string" && record.providerId.trim().length > 0
              ? record.providerId.trim()
              : "agent",
          authMode: "subscription_oauth" as const,
          authLabel:
            typeof record?.authLabel === "string" && record.authLabel.trim().length > 0
              ? record.authLabel.trim()
              : // oxlint-disable-next-line prismux/no-untranslated-copy -- Prismux v3 spec fallback Chinese auth label for personal subscription OAuth
                "官方个人订阅 OAuth",
          settingsRoute:
            typeof record?.settingsRoute === "string" && record.settingsRoute.trim().length > 0
              ? record.settingsRoute.trim()
              : "/settings/providers#subscription-risk-waiver",
          message,
        };
        if (typeof CustomEvent === "function") {
          window.dispatchEvent(
            new CustomEvent("prismux:subscription-orchestration-blocked", { detail }),
          );
        }
      }
      throw new PrismuxDaemonError(message, {
        status: response.status,
        code,
        details: parsed,
      });
    }

    return parsed as T;
  }

  buildMediaUrl(kind: "media" | "preview" | "web", id: string, subPath?: string): string {
    const encodedId = encodeURIComponent(id);
    const tail = subPath && subPath.trim().length > 0 ? `/${encodeSubPath(subPath)}` : "";
    const route = `/v1/wallpapers/${kind}/${encodedId}${tail}`;
    const base = this.cachedInfo.baseUrl ? normalizeBaseUrl(this.cachedInfo.baseUrl) : "";
    const tokenQuery = this.cachedInfo.token
      ? `?token=${encodeURIComponent(this.cachedInfo.token)}`
      : "";
    return `${base}${route}${tokenQuery}`;
  }

  resolveMediaUrl(rawUrl: string | null | undefined): string | null {
    if (!rawUrl || typeof rawUrl !== "string") {
      return null;
    }
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
      return trimmed;
    }
    const base = this.cachedInfo.baseUrl ? normalizeBaseUrl(this.cachedInfo.baseUrl) : "";
    const token = this.cachedInfo.token;

    if (trimmed.startsWith("/v1/wallpapers/")) {
      const prefix = base ? `${base}${trimmed}` : trimmed;
      if (!token || /[?&]token=/.test(prefix)) {
        return prefix;
      }
      const sep = prefix.includes("?") ? "&" : "?";
      return `${prefix}${sep}token=${encodeURIComponent(token)}`;
    }

    if (base && trimmed.startsWith(`${base}/v1/wallpapers/`)) {
      if (!token || /[?&]token=/.test(trimmed)) {
        return trimmed;
      }
      const sep = trimmed.includes("?") ? "&" : "?";
      return `${trimmed}${sep}token=${encodeURIComponent(token)}`;
    }

    return trimmed;
  }

  getWallpaperInventory(): Promise<DaemonWallpaperInventoryResponse> {
    return this.requestJson<DaemonWallpaperInventoryResponse>("/v1/wallpapers/inventory");
  }

  rescanWallpapers(
    customDirs?: string[],
    steamRootOverride?: string,
  ): Promise<DaemonWallpaperInventoryResponse> {
    const body: Record<string, unknown> = {};
    if (customDirs !== undefined) {
      body.customDirs = customDirs;
    }
    if (steamRootOverride !== undefined) {
      body.steamRootOverride = steamRootOverride;
    }
    return this.requestJson<DaemonWallpaperInventoryResponse>("/v1/wallpapers/rescan", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  importWallpaperFile(
    sourcePathOrPayload: string | WallpaperImportPayload,
  ): Promise<DaemonWallpaperImportResponse> {
    const body: WallpaperImportPayload =
      typeof sourcePathOrPayload === "string"
        ? { sourcePath: sourcePathOrPayload }
        : sourcePathOrPayload;
    return this.requestJson<DaemonWallpaperImportResponse>("/v1/wallpapers/import", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  getSystemFonts(refresh = false): Promise<DaemonSystemFontsResponse> {
    const suffix = refresh ? "?refresh=true" : "";
    return this.requestJson<DaemonSystemFontsResponse>(`/v1/system/fonts${suffix}`);
  }

  getAppearance<T = Record<string, unknown>>(): Promise<T> {
    return this.requestJson<T>("/v1/appearance");
  }

  saveAppearance<T = Record<string, unknown>>(payload: unknown): Promise<T> {
    return this.requestJson<T>("/v1/appearance", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  getChief(): Promise<DaemonChiefStatusResponse> {
    return this.requestJson<DaemonChiefStatusResponse>("/v1/chief");
  }

  switchChief(payload: {
    provider?: string;
    model?: string;
    dialMode?: string;
    reasoningEffort?: string;
    defaultEffort?: string;
    secretaryName?: string;
  }): Promise<DaemonChiefStatusResponse> {
    return this.requestJson<DaemonChiefStatusResponse>("/v1/chief/switch", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  updateChiefProfile(payload: {
    secretaryName: string;
  }): Promise<DaemonChiefProfileUpdateResponse> {
    return this.requestJson<DaemonChiefProfileUpdateResponse>("/v1/chief/profile", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  getChiefAgentsMd(): Promise<DaemonChiefAgentsMdResponse> {
    return this.requestJson<DaemonChiefAgentsMdResponse>("/v1/chief/agents-md");
  }

  saveChiefAgentsMd(payload: {
    content?: string;
    reset?: boolean;
  }): Promise<DaemonChiefAgentsMdResponse> {
    return this.requestJson<DaemonChiefAgentsMdResponse>("/v1/chief/agents-md", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  getMemoryStats(): Promise<DaemonMemoryStatsResponse> {
    return this.requestJson<DaemonMemoryStatsResponse>("/v1/memory/stats");
  }

  searchMemory(payload: {
    query: string;
    limit?: number;
    namespace?: string;
  }): Promise<DaemonMemorySearchResponse> {
    return this.requestJson<DaemonMemorySearchResponse>("/v1/memory/search", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  importObsidian(payload: {
    vaultPath: string;
    namespace?: string;
    dryRun?: boolean;
  }): Promise<DaemonObsidianImportResponse> {
    return this.requestJson<DaemonObsidianImportResponse>("/v1/memory/import-obsidian", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  planObsidianImport(payload: {
    vaultPath: string;
    namespace?: string;
    useAgentCuration?: boolean;
    provider?: string;
    model?: string;
    maxFiles?: number;
  }): Promise<DaemonObsidianImportPlanResponse> {
    return this.requestJson<DaemonObsidianImportPlanResponse>(
      "/v1/memory/import-obsidian/plan",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  }

  commitObsidianImport(payload: {
    items: DaemonObsidianCuratedItemDto[];
    namespace?: string;
  }): Promise<DaemonObsidianImportCommitResponse> {
    return this.requestJson<DaemonObsidianImportCommitResponse>(
      "/v1/memory/import-obsidian/commit",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  }

  getSyncStatus(): Promise<DaemonSyncStatusResponse> {
    return this.requestJson<DaemonSyncStatusResponse>("/v1/sync/status");
  }

  updateSyncConfig(payload: Record<string, unknown>): Promise<DaemonSyncStatusResponse> {
    return this.requestJson<DaemonSyncStatusResponse>("/v1/sync/config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  triggerSyncNow(payload?: DaemonSyncTriggerRequest): Promise<DaemonSyncNowResponse> {
    return this.requestJson<DaemonSyncNowResponse>("/v1/sync/now", {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    });
  }

  testSyncConnection(payload?: DaemonSyncTestRequest): Promise<DaemonSyncTestResponse> {
    return this.requestJson<DaemonSyncTestResponse>("/v1/sync/test", {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    });
  }

  fetchDiagnosticsServices(force = false): Promise<DaemonDiagnosticsServicesResponse> {
    const suffix = force ? "?force=1" : "";
    return this.requestJson<DaemonDiagnosticsServicesResponse>(
      `/v1/diagnostics/services${suffix}`,
    );
  }

  async refreshDiagnosticsServices(): Promise<DaemonDiagnosticsServicesResponse> {
    try {
      return await this.requestJson<DaemonDiagnosticsServicesResponse>(
        "/v1/diagnostics/refresh",
        { method: "POST" },
      );
    } catch (error) {
      if (error instanceof PrismuxDaemonError && (error.status === 404 || error.status === 405)) {
        return this.fetchDiagnosticsServices(true);
      }
      throw error;
    }
  }

  fetchSystemPorts(workspace?: string): Promise<DaemonSystemPortsResponse> {
    const trimmed = workspace?.trim();
    const suffix = trimmed ? `?workspace=${encodeURIComponent(trimmed)}` : "";
    return this.requestJson<DaemonSystemPortsResponse>(`/v1/system/ports${suffix}`);
  }

  killSystemPort(pid: number): Promise<DaemonKillSystemPortResponse> {
    return this.requestJson<DaemonKillSystemPortResponse>("/v1/system/ports/kill", {
      method: "POST",
      body: JSON.stringify({ pid }),
    });
  }

  fetchSystemResources(forceRefresh = false): Promise<DaemonSystemResourcesResponse> {
    const suffix = forceRefresh ? "?refresh=1" : "";
    return this.requestJson<DaemonSystemResourcesResponse>(`/v1/system/resources${suffix}`);
  }

  killStalePty(sessionId: string): Promise<DaemonKillStalePtyResponse> {
    return this.requestJson<DaemonKillStalePtyResponse>("/v1/system/pty/kill", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
  }

  fetchOvernightConfig(): Promise<DaemonOvernightConfigSnapshot> {
    return this.requestJson<DaemonOvernightConfigSnapshot>("/v1/overnight/config");
  }

  updateOvernightConfig(
    payload: DaemonOvernightConfigPatch,
  ): Promise<DaemonOvernightConfigSnapshot> {
    return this.requestJson<DaemonOvernightConfigSnapshot>("/v1/overnight/config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  testOvernightMail(
    payload?: DaemonOvernightConfigPatch,
  ): Promise<DaemonOvernightMailTestResponse> {
    return this.requestJson<DaemonOvernightMailTestResponse>("/v1/overnight/test-mail", {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    });
  }

  sendOvernightTestReport(
    payload?: DaemonOvernightConfigPatch & { recipient?: string },
  ): Promise<DaemonOvernightTestReportResponse> {
    return this.requestJson<DaemonOvernightTestReportResponse>(
      "/v1/overnight/send-test-report",
      {
        method: "POST",
        body: JSON.stringify(payload ?? {}),
      },
    );
  }

  pollOvernightNow(
    payload?: DaemonOvernightConfigPatch,
  ): Promise<DaemonOvernightPollNowResponse> {
    return this.requestJson<DaemonOvernightPollNowResponse>("/v1/overnight/poll-now", {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    });
  }

  fetchOvernightRuns(limit = 30): Promise<DaemonOvernightRunsResponse> {
    return this.requestJson<DaemonOvernightRunsResponse>(
      `/v1/overnight/runs?limit=${encodeURIComponent(String(limit))}`,
    );
  }

  startOvernightGmailOAuth(payload?: {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
  }): Promise<DaemonOvernightGmailOAuthStartResponse> {
    return this.requestJson<DaemonOvernightGmailOAuthStartResponse>(
      "/v1/overnight/oauth/gmail/start",
      {
        method: "POST",
        body: JSON.stringify(payload ?? {}),
      },
    );
  }

  disconnectOvernightGmail(): Promise<DaemonOvernightConfigSnapshot> {
    return this.requestJson<DaemonOvernightConfigSnapshot>(
      "/v1/overnight/oauth/gmail/disconnect",
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
  }

  getPluginCatalog(): Promise<DaemonPluginCatalogResponse> {
    return this.requestJson<DaemonPluginCatalogResponse>("/v1/plugins/catalog");
  }

  getInstalledPlugins(): Promise<DaemonInstalledPluginsResponse> {
    return this.requestJson<DaemonInstalledPluginsResponse>("/v1/plugins/installed");
  }

  installPlugin<T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<T> {
    return this.requestJson<T>("/v1/plugins/install", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  togglePlugin<T = Record<string, unknown>>(payload: {
    pluginId: string;
    enabled: boolean;
  }): Promise<T> {
    return this.requestJson<T>("/v1/plugins/toggle", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  uninstallPlugin<T = Record<string, unknown>>(payload: { pluginId: string }): Promise<T> {
    return this.requestJson<T>("/v1/plugins/uninstall", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  fetchUpdaterStatus(): Promise<DaemonUpdaterStatusResponse> {
    return this.requestJson<DaemonUpdaterStatusResponse>("/v1/updater/status");
  }

  getUpdaterStatus(): Promise<DaemonUpdaterStatusResponse> {
    return this.fetchUpdaterStatus();
  }

  probeUpdaterSources<T = Record<string, unknown>>(): Promise<T> {
    return this.requestJson<T>("/v1/updater/probe", {
      method: "POST",
    });
  }

  checkForUpdates<T = Record<string, unknown>>(payload?: Record<string, unknown>): Promise<T> {
    return this.requestJson<T>("/v1/updater/check", {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    });
  }

  downloadUpdate(
    payload?: DaemonUpdaterDownloadRequest,
  ): Promise<DaemonUpdateDownloadResultDto> {
    return this.requestJson<DaemonUpdateDownloadResultDto>("/v1/updater/download", {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    });
  }

  updateUpdaterPolicy<T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<T> {
    return this.requestJson<T>("/v1/updater/policy", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  checkCliUpdates(options: { force?: boolean; provider?: string } = {}): Promise<DaemonCliUpdatesCheckResponse> {
    const params = new URLSearchParams();
    if (options.force) {
      params.set("force", "1");
    }
    const provider = options.provider?.trim();
    if (provider) {
      params.set("provider", provider);
    }
    const query = params.toString();
    return this.requestJson<DaemonCliUpdatesCheckResponse>(
      query.length > 0 ? `/v1/cli-updates/check?${query}` : "/v1/cli-updates/check",
    );
  }

  installCliUpdate(provider: string): Promise<DaemonCliUpdateInstallResponse> {
    return this.requestJson<DaemonCliUpdateInstallResponse>("/v1/cli-updates/install", {
      method: "POST",
      body: JSON.stringify({ provider }),
    });
  }

  fetchQuotaSummary(force = false): Promise<DaemonOfficialQuotaSummaryResponse> {
    const suffix = force ? "?force=1" : "";
    return this.requestJson<DaemonOfficialQuotaSummaryResponse>(`/v1/quota/summary${suffix}`);
  }

  subscribeUpdaterEvents(
    onEvent: (event: DaemonUpdaterEvent) => void,
    options: DaemonUpdaterEventsOptions = {},
  ): () => void {
    const initialDelay = Math.max(250, options.reconnectDelayMs ?? 1500);
    const maxDelay = Math.max(initialDelay, options.maxReconnectDelayMs ?? 15_000);
    const maxAttempts = options.maxReconnectAttempts ?? Number.POSITIVE_INFINITY;

    let disposed = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let activeAbort: AbortController | null = null;

    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      activeAbort?.abort();
      activeAbort = null;
    };

    if (options.signal) {
      if (options.signal.aborted) {
        disposed = true;
        return cleanup;
      }
      options.signal.addEventListener("abort", cleanup, { once: true });
    }

    const emitSseBlock = (block: string) => {
      const lines = block.split(/\r?\n/);
      let eventName = "message";
      let eventId: string | undefined;
      const dataLines: string[] = [];

      for (const line of lines) {
        if (!line || line.startsWith(":")) {
          continue;
        }
        const colonIdx = line.indexOf(":");
        const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
        let value = colonIdx === -1 ? "" : line.slice(colonIdx + 1);
        if (value.startsWith(" ")) {
          value = value.slice(1);
        }
        if (field === "event" && value.length > 0) {
          eventName = value;
        } else if (field === "id") {
          eventId = value;
        } else if (field === "data") {
          dataLines.push(value);
        }
      }

      if (dataLines.length === 0) {
        return;
      }
      const rawData = dataLines.join("\n");
      let parsed: unknown = rawData;
      try {
        parsed = JSON.parse(rawData);
      } catch {
        // Plain-text SSE payload is delivered as raw string.
      }
      onEvent({
        event: eventName,
        ...(eventId !== undefined ? { id: eventId } : {}),
        data: parsed,
        rawData,
        receivedAt: Date.now(),
      });
    };

    const scheduleReconnect = () => {
      if (disposed || attempt >= maxAttempts) {
        return;
      }
      const delay = Math.min(maxDelay, Math.round(initialDelay * 2 ** Math.min(attempt, 5)));
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (disposed) return;

      let info = await this.getConnectionInfo(false);
      if (!info.ready || !info.baseUrl) {
        info = await this.getConnectionInfo(true);
      }
      if (disposed) return;

      if (!info.ready || !info.baseUrl) {
        options.onError?.(
          new PrismuxDaemonError("Prismux Daemon is unavailable for updater SSE stream.", {
            status: 503,
            code: "DAEMON_UNAVAILABLE",
          }),
        );
        scheduleReconnect();
        return;
      }

      const controller = new AbortController();
      activeAbort = controller;

      const tokenQuery = info.token ? `?token=${encodeURIComponent(info.token)}` : "";
      const url = `${info.baseUrl}/v1/updater/events${tokenQuery}`;
      // Use only CORS-safelisted Accept header + Fetch `cache: "no-store"` (token travels in query,
      // authenticated by DaemonRpcServer `allowQueryToken=true`) so Electron's `prismux://app` origin
      // opens the SSE stream as a zero-preflight simple GET request without `Cache-Control` CORS errors.
      const headers = new Headers({
        Accept: "text/event-stream",
      });

      try {
        const response = await fetch(url, {
          method: "GET",
          headers,
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new PrismuxDaemonError(
            `Updater SSE stream failed (${response.status} ${response.statusText})`,
            {
              status: response.status,
              code: `HTTP_${response.status}`,
            },
          );
        }

        attempt = 0;
        options.onOpen?.();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!disposed) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            if (block.trim().length > 0) {
              emitSseBlock(block);
            }
          }
        }

        buffer += decoder.decode();
        if (buffer.trim().length > 0) {
          emitSseBlock(buffer);
        }
      } catch (error) {
        if (!disposed) {
          options.onError?.(error);
        }
      } finally {
        if (activeAbort === controller) {
          activeAbort = null;
        }
        if (!disposed) {
          scheduleReconnect();
        }
      }
    };

    void connect();

    return () => {
      if (options.signal) {
        options.signal.removeEventListener("abort", cleanup);
      }
      cleanup();
    };
  }
}

export const prismuxDaemonClient = new PrismuxDaemonClient();

export const fetchDiagnosticsServices = (
  force?: boolean,
): Promise<DaemonDiagnosticsServicesResponse> =>
  prismuxDaemonClient.fetchDiagnosticsServices(force);

export const triggerSyncNow = (
  payload?: DaemonSyncTriggerRequest,
): Promise<DaemonSyncNowResponse> => prismuxDaemonClient.triggerSyncNow(payload);

export const testSyncConnection = (
  payload?: DaemonSyncTestRequest,
): Promise<DaemonSyncTestResponse> => prismuxDaemonClient.testSyncConnection(payload);

export const fetchUpdaterStatus = (): Promise<DaemonUpdaterStatusResponse> =>
  prismuxDaemonClient.fetchUpdaterStatus();

export const subscribeUpdaterEvents = (
  onEvent: (event: DaemonUpdaterEvent) => void,
  options?: DaemonUpdaterEventsOptions,
): (() => void) => prismuxDaemonClient.subscribeUpdaterEvents(onEvent, options);

export const downloadUpdate = (
  payload?: DaemonUpdaterDownloadRequest,
): Promise<DaemonUpdateDownloadResultDto> => prismuxDaemonClient.downloadUpdate(payload);

export const fetchSystemPorts = (workspace?: string): Promise<DaemonSystemPortsResponse> =>
  prismuxDaemonClient.fetchSystemPorts(workspace);

export const killSystemPort = (pid: number): Promise<DaemonKillSystemPortResponse> =>
  prismuxDaemonClient.killSystemPort(pid);

export const fetchSystemResources = (
  forceRefresh = false,
): Promise<DaemonSystemResourcesResponse> =>
  prismuxDaemonClient.fetchSystemResources(forceRefresh);

export const killStalePty = (sessionId: string): Promise<DaemonKillStalePtyResponse> =>
  prismuxDaemonClient.killStalePty(sessionId);

export const checkCliUpdates = (options?: {
  force?: boolean;
  provider?: string;
}): Promise<DaemonCliUpdatesCheckResponse> => prismuxDaemonClient.checkCliUpdates(options);

export const installCliUpdate = (provider: string): Promise<DaemonCliUpdateInstallResponse> =>
  prismuxDaemonClient.installCliUpdate(provider);

export const fetchQuotaSummary = (
  force = false,
): Promise<DaemonOfficialQuotaSummaryResponse> => prismuxDaemonClient.fetchQuotaSummary(force);

// ---------------------------------------------------------------------------
// Read-only Multi-Agent Native Auxiliary Runtime Inspector (AGY / CC / Codex)
// ---------------------------------------------------------------------------

export type DaemonAgentAuxKind =
  | "agy-swarm"
  | "agy-subagents"
  | "claude-team"
  | "codex-collab"
  | "provider-subagents";

export interface DaemonAgentAuxSwarmFailureDto {
  readonly kind: "quota" | "error";
  readonly text: string;
}

export interface DaemonAgentAuxSwarmMemberDto {
  readonly name: string;
  readonly conversationId: string;
  readonly model: string;
  readonly role: string;
  readonly wakeMode: string;
  readonly status: "working" | "waiting" | "killed";
  readonly waitSince: number;
  readonly lastReadSeq: number;
  readonly unread: number;
  readonly killed: boolean;
  readonly steps: number;
  readonly activity: string;
  readonly activityKind: "tool" | "thinking" | "";
  readonly replied: boolean;
  readonly replyAsk: string;
  readonly narrator: boolean;
  readonly roleWorker: boolean;
  readonly failure: DaemonAgentAuxSwarmFailureDto | null;
  readonly transcriptMtime: number;
  readonly posts: number;
  readonly lastPostSeq: number;
  readonly lastPostTime: string;
  readonly lastPostTs: number | null;
  readonly workspace?: string;
  readonly workspaceMode?: string;
  readonly channels?: readonly string[];
}

export interface DaemonAgentAuxSwarmMessageDto {
  readonly seq: number;
  readonly agent: string;
  readonly text: string;
  readonly time: string;
  readonly ts: number | null;
  readonly mentions: readonly string[];
  readonly all: boolean;
  readonly channel?: string;
  readonly control?: Record<string, unknown>;
}

export interface DaemonAgentAuxEdgeDto {
  readonly from: string;
  readonly to: string;
  readonly count: number;
  readonly direct: number;
  readonly viaAll: number;
}

export interface DaemonAgentAuxSystemAttentionDto {
  readonly id: string;
  readonly kind: "quota" | "error" | "stuck";
  readonly member: string;
  readonly conversationId: string;
  readonly text: string;
  readonly detail: string;
  readonly since?: number;
}

export interface DaemonAgentAuxSwarmPlanDto {
  readonly goal?: { readonly title?: string; readonly line?: string } | null;
  readonly tasks?: Readonly<Record<string, string>>;
  readonly threads?: ReadonlyArray<{
    readonly id?: string;
    readonly title: string;
    readonly goal?: string;
    readonly tasks: readonly string[];
  }>;
}

export interface DaemonAgentAuxSwarmViewDto {
  readonly as_of_seq?: number;
  readonly updated_at?: string;
  readonly headline?: string;
  readonly running_summary?: string;
  readonly phase?: { readonly label?: string; readonly index?: number; readonly total?: number };
  readonly goal?: { readonly title?: string; readonly line?: string };
  readonly now?: Readonly<Record<string, string>>;
  readonly attention?: ReadonlyArray<{
    readonly id?: string;
    readonly kind?: string;
    readonly severity?: string;
    readonly title?: string;
    readonly why?: string;
    readonly refs?: ReadonlyArray<{ readonly seq?: number; readonly member?: string }>;
    readonly actions?: ReadonlyArray<{
      readonly type?: string;
      readonly target?: string | number;
      readonly label?: string;
    }>;
  }>;
  readonly workstreams?: ReadonlyArray<{
    readonly id?: string;
    readonly title?: string;
    readonly owners?: readonly string[];
    readonly state?: string;
    readonly note?: string;
    readonly progress?: { readonly done?: number; readonly total?: number; readonly label?: string } | number;
    readonly blocked_on?: string;
    readonly refs?: ReadonlyArray<{ readonly seq?: number; readonly member?: string }>;
  }>;
  readonly threads?: ReadonlyArray<{
    readonly id?: string;
    readonly title?: string;
    readonly goal?: string;
    readonly now?: string;
    readonly state?: string;
    readonly workstreams?: readonly string[];
    readonly attention?: readonly string[];
  }>;
  readonly milestones?: ReadonlyArray<{ readonly id?: string; readonly text?: string }>;
  readonly risks?: ReadonlyArray<{ readonly id?: string; readonly text?: string }>;
}

export interface DaemonAgentAuxSwarmSnapshotDto {
  readonly id: string;
  readonly title: string;
  readonly selfMember: string | null;
  readonly head: number;
  readonly members: readonly DaemonAgentAuxSwarmMemberDto[];
  readonly messages: readonly DaemonAgentAuxSwarmMessageDto[];
  readonly edges: readonly DaemonAgentAuxEdgeDto[];
  readonly plan: DaemonAgentAuxSwarmPlanDto | null;
  readonly view: DaemonAgentAuxSwarmViewDto | null;
  readonly systemAttention: readonly DaemonAgentAuxSystemAttentionDto[];
}

export interface DaemonAgentAuxNativeStepDto {
  readonly index: number;
  readonly type: string;
  readonly status: string | null;
  readonly text: string | null;
  readonly toolCalls: ReadonlyArray<{ readonly name: string; readonly summary: string }>;
}

export interface DaemonAgentAuxNativeSubagentDto {
  readonly conversationId: string;
  readonly role: string;
  readonly state: string;
  readonly status: "working" | "waiting" | "done" | "killed";
  readonly stepsCount: number;
  readonly activity: string;
  readonly activityKind: "tool" | "thinking" | "";
  readonly steps: readonly DaemonAgentAuxNativeStepDto[];
  readonly transcriptMtime: number;
}

export interface DaemonAgentAuxClaudeTeamMemberDto {
  readonly agentId: string;
  readonly name: string;
  readonly agentType: string;
  readonly model: string;
  readonly color: string;
  readonly cwd: string;
  readonly backendType: string;
  readonly status: "working" | "waiting" | "done";
  readonly isLead: boolean;
  readonly joinedAt?: number;
}

export interface DaemonAgentAuxClaudeTeamMessageDto {
  readonly seq: number;
  readonly agent: string;
  readonly recipient: string;
  readonly text: string;
  readonly summary: string;
  readonly time: string;
  readonly ts: number | null;
  readonly mentions: readonly string[];
  readonly all: boolean;
  readonly read: boolean;
  readonly color?: string;
}

export interface DaemonAgentAuxClaudeTeamSnapshotDto {
  readonly teamName: string;
  readonly description: string;
  readonly leadSessionId: string;
  readonly members: readonly DaemonAgentAuxClaudeTeamMemberDto[];
  readonly messages: readonly DaemonAgentAuxClaudeTeamMessageDto[];
  readonly edges: readonly DaemonAgentAuxEdgeDto[];
}

export interface DaemonAgentAuxCodexGoalDto {
  readonly threadId: string;
  readonly goalId: string;
  readonly objective: string;
  readonly status: "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete";
  readonly tokenBudget: number | null;
  readonly tokensUsed: number;
  readonly timeUsedSeconds: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface DaemonAgentAuxCodexSpawnedThreadDto {
  readonly threadId: string;
  readonly parentThreadId: string;
  readonly status: string;
  readonly title: string;
  readonly nickname: string;
  readonly role: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly cwd: string;
  readonly updatedAtMs: number;
}

export interface DaemonAgentAuxCodexSnapshotDto {
  readonly goals: readonly DaemonAgentAuxCodexGoalDto[];
  readonly spawnedThreads: readonly DaemonAgentAuxCodexSpawnedThreadDto[];
}

export interface DaemonAgentAuxTaskItemDto {
  readonly id: string;
  readonly subject: string;
  readonly description: string;
  readonly activeForm?: string;
  readonly status: "pending" | "in_progress" | "completed" | "blocked";
  readonly owner: string;
  readonly blockedBy: readonly string[];
  readonly blocks: readonly string[];
  readonly source: "claude-tasks" | "codex-goals";
  readonly progressLabel?: string;
}

export interface DaemonAgentAuxInspectResponse {
  readonly ok: boolean;
  readonly active: boolean;
  readonly hasLiveWork: boolean;
  readonly kind: DaemonAgentAuxKind | null;
  readonly title: string;
  readonly activationKey: string | null;
  readonly swarm?: DaemonAgentAuxSwarmSnapshotDto;
  readonly agySubagents?: readonly DaemonAgentAuxNativeSubagentDto[];
  readonly claudeTeam?: DaemonAgentAuxClaudeTeamSnapshotDto;
  readonly codex?: DaemonAgentAuxCodexSnapshotDto;
  readonly tasks?: readonly DaemonAgentAuxTaskItemDto[];
  readonly updatedAt: number;
}

export interface InspectAgentAuxParams {
  readonly provider?: string | null;
  readonly sessionId?: string | null;
  readonly cwd?: string | null;
  readonly signal?: AbortSignal;
}

export const inspectAgentAux = (
  params: InspectAgentAuxParams,
): Promise<DaemonAgentAuxInspectResponse> => {
  const query = new URLSearchParams();
  if (params.provider && params.provider.trim().length > 0) {
    query.set("provider", params.provider.trim());
  }
  if (params.sessionId && params.sessionId.trim().length > 0) {
    query.set("sessionId", params.sessionId.trim());
  }
  if (params.cwd && params.cwd.trim().length > 0) {
    query.set("cwd", params.cwd.trim());
  }
  const qs = query.toString();
  return prismuxDaemonClient.requestJson<DaemonAgentAuxInspectResponse>(
    `/v1/agent-aux/inspect${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
      ...(params.signal ? { signal: params.signal } : {}),
    },
  );
};
