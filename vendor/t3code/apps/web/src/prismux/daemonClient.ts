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
  model?: string;
  status?: string;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface DaemonChiefStatusResponse {
  ok: boolean;
  slot: DaemonChiefSlotDto;
  dialMode: "agent" | "oracle" | "review";
  availableProviders?: string[];
  availableDialModes?: Array<"agent" | "oracle" | "review">;
  t3Connected?: boolean;
}

export interface DaemonMemoryStatsResponse {
  ok: boolean;
  callerScope: string;
  totalEntries: number;
  vectorSearchEnabled: boolean;
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

export interface DaemonPluginCatalogResponse {
  ok: boolean;
  schemaVersion?: number;
  generatedAt?: string;
  officialCatalogPath?: string;
  plugins: DaemonPluginCatalogEntryDto[];
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

export interface DaemonUpdaterStatusResponse {
  ok: boolean;
  currentVersion?: string;
  policy?: Record<string, unknown>;
  route?: Record<string, unknown>;
  lastCheck?: Record<string, unknown> | null;
  [key: string]: unknown;
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
  }): Promise<DaemonChiefStatusResponse> {
    return this.requestJson<DaemonChiefStatusResponse>("/v1/chief/switch", {
      method: "POST",
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

  getSyncStatus(): Promise<DaemonSyncStatusResponse> {
    return this.requestJson<DaemonSyncStatusResponse>("/v1/sync/status");
  }

  updateSyncConfig(payload: Record<string, unknown>): Promise<DaemonSyncStatusResponse> {
    return this.requestJson<DaemonSyncStatusResponse>("/v1/sync/config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
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

  getUpdaterStatus(): Promise<DaemonUpdaterStatusResponse> {
    return this.requestJson<DaemonUpdaterStatusResponse>("/v1/updater/status");
  }

  checkForUpdates<T = Record<string, unknown>>(payload?: Record<string, unknown>): Promise<T> {
    return this.requestJson<T>("/v1/updater/check", {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    });
  }

  updateUpdaterPolicy<T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<T> {
    return this.requestJson<T>("/v1/updater/policy", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }
}

export const prismuxDaemonClient = new PrismuxDaemonClient();
