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

export type UpdatePackageKind = "setup-exe" | "portable-zip";

export interface UpdatePolicyConfig {
  routePreference: NetworkRoutePreference;
  includePrerelease: boolean;
  customGhProxyPrefix: string;
  pluginRegistryOverride: PluginRegistryOverride;
  timeoutMs: number;
}

export type UpdatePolicyPatch = Partial<UpdatePolicyConfig>;

export const DEFAULT_UPDATE_POLICY: UpdatePolicyConfig = {
  routePreference: "auto",
  includePrerelease: true,
  customGhProxyPrefix: "",
  pluginRegistryOverride: "auto",
  timeoutMs: 15_000
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
}

export interface UpdaterStatusSnapshot {
  currentVersion: string;
  portableMode: boolean;
  policy: UpdatePolicyConfig;
  checking: boolean;
  downloading: boolean;
  lastCheck: UpdateCheckResult | null;
  lastDownload: UpdateDownloadResult | null;
  lastProbe: SourceProbeReport | null;
  lastError: string | null;
}
