import * as NodeBuffer from "node:buffer";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import type * as NodeStream from "node:stream";

const { Buffer } = NodeBuffer;
const { createServer } = NodeHttp;
type IncomingMessage = NodeHttp.IncomingMessage;
type Server = NodeHttp.Server;
type ServerResponse = NodeHttp.ServerResponse;
type AddressInfo = NodeNet.AddressInfo;
type Duplex = NodeStream.Duplex;
import type { CordisPluginHost } from "@prismux/cordis-kernel";
import {
  ForwardIdentityGuard,
  type ObsidianVaultImporterImpl,
  type SqliteMemoryStore,
} from "@prismux/memory-core";
import {
  DEFAULT_APP_VERSION,
  DIAL_MODES,
  MEMORY_KINDS,
  NETWORK_ROUTE_PREFERENCES,
  PLUGIN_REGISTRY_IDS,
  UPDATE_CHANNELS,
  UPDATE_SOURCE_IDS,
  isScopeAllowedForNamespace,
  isValidMemoryNamespace,
  type CallerScope,
  type ChiefProviderKind,
  type DaemonHealthResponse,
  type DialMode,
  type MemoryKind,
  type MemoryNamespace,
  type MemoryQueryRequest,
  type MemoryQueryResponse,
  type MemoryUpsertInput,
  type NetworkRoutePreference,
  type ObsidianImportRequest,
  type PluginRegistryOverride,
  type CoreBridgeStatus,
  type UpdateChannel,
  type UpdatePackageKind,
  type UpdatePolicyPatch,
  type UpdateSourceId,
} from "@prismux/protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { AppearanceConfigStore } from "../appearance/AppearanceConfigStore.js";
import type { ChiefThreadManager } from "../chief/ChiefThreadManager.js";
import type { HandoffEngine, HandoffTranscriptMessage } from "../handoff/HandoffEngine.js";
import type { LifecycleHookBus } from "../hooks/LifecycleHookBus.js";
import type { PersistentPtyPool } from "../pty/PersistentPtyPool.js";
import type { CliUpdateService } from "../system/CliUpdateService.js";
import type { OfficialQuotaService } from "../system/OfficialQuotaService.js";
import { PortKillError, type PortScannerService } from "../system/PortScannerService.js";
import {
  normalizeHostMetricsReport,
  type ResourceMonitorService,
} from "../system/ResourceMonitorService.js";
import type { ServiceDiagnosticsService } from "../system/ServiceDiagnosticsService.js";
import type { StorageQuotaService } from "../system/StorageQuotaService.js";
import { SystemFontService } from "../system/SystemFontService.js";
import type { CoreRpcClient } from "../core/CoreRpcClient.js";
import type { CoreServerSupervisor } from "../core/CoreServerSupervisor.js";
import type { PrismuxProviderProbeService } from "../system/PrismuxProviderProbeService.js";
import type { AppUpdater } from "../updater/AppUpdater.js";
import {
  WallpaperServiceError,
  type WallpaperImportRequest,
  type WallpaperMediaService,
  type WallpaperRescanRequest,
} from "../wallpapers/WallpaperMediaService.js";
import { CliUpdateRouteService } from "./CliUpdateRoutes.js";
import { BusinessRouteError, type DaemonBusinessService } from "./DaemonBusinessRoutes.js";
import { AgentAuxService, AgentAuxValidationError } from "../agentAux/AgentAuxService.js";
import type { OvernightRouteService } from "./OvernightRoutes.js";
import type { PairingManager } from "./PairingManager.js";
import { handleQuotaRoute } from "./QuotaRoutes.js";
import { isAllowedCorsOrigin } from "./CorsOrigin.js";
import type { DesktopIpcDispatchHub } from "../dispatch/DesktopIpcDispatchHub.js";
import type { SubscriptionWaiverStore } from "../security/AntigravityPolicyStore.js";
import { handleDispatchRoute, isDispatchOrSecurityRoute } from "./DispatchRoutes.js";

export { isAllowedCorsOrigin } from "./CorsOrigin.js";

const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_IMPORT_JSON_BODY_BYTES = 34 * 1024 * 1024;
export const DEFAULT_PAIRING_RATE_LIMIT_MAX_REQUESTS = 10;
export const DEFAULT_PAIRING_RATE_LIMIT_WINDOW_MS = 60_000;

export interface DaemonRpcServerOptions {
  host?: string;
  port?: number;
  headless: boolean;
  version?: string;
  machineId?: string;
  ptyPool: PersistentPtyPool;
  chiefManager: ChiefThreadManager;
  pairingManager: PairingManager;
  pluginHost?: CordisPluginHost;
  onTogglePlugin?: (
    pluginId: string,
    enabled: boolean,
  ) => Promise<{ pluginId: string; enabled: boolean }>;
  appUpdater?: AppUpdater;
  memoryStore?: SqliteMemoryStore;
  obsidianImporter?: ObsidianVaultImporterImpl;
  handoffEngine?: HandoffEngine;
  hookBus?: LifecycleHookBus;
  coreSupervisor?: CoreServerSupervisor;
  coreRpcClient?: CoreRpcClient;
  /** @deprecated Use coreSupervisor */
  t3Supervisor?: CoreServerSupervisor;
  /** @deprecated Use coreRpcClient */
  t3RpcClient?: CoreRpcClient;
  wallpaperService?: WallpaperMediaService;
  fontService?: SystemFontService;
  appearanceStore?: AppearanceConfigStore;
  businessService?: DaemonBusinessService;
  overnightService?: OvernightRouteService;
  diagnosticsService?: ServiceDiagnosticsService;
  providerProbeService?: PrismuxProviderProbeService;
  cliUpdateService?: CliUpdateService;
  quotaService?: OfficialQuotaService;
  portScannerService?: PortScannerService;
  resourceMonitorService?: ResourceMonitorService;
  storageQuotaService?: StorageQuotaService;
  agentAuxService?: AgentAuxService;
  subscriptionWaiverStore?: SubscriptionWaiverStore;
  /** @deprecated Use subscriptionWaiverStore */
  antigravityPolicyStore?: SubscriptionWaiverStore;
  dispatchHub?: DesktopIpcDispatchHub;
  startedAt?: number;
  pairingRateLimitMaxRequests?: number;
  pairingRateLimitWindowMs?: number;
  onRequestShutdown?: (reason?: string) => void | Promise<void>;
}

interface RpcPayloadEnvelope {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

class RpcDispatchError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "RpcDispatchError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rawDataToString(data: WebSocket.RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
}

function extractBearerToken(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== "string") {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const token = match?.[1]?.trim();
  return token !== undefined && token.length > 0 ? token : null;
}

const WEB_WALLPAPER_AUTH_COOKIE = "prismux_wp_token";
const SCENE_WALLPAPER_AUTH_COOKIE = "prismux_scene_token";
const WEB_TOKEN_ROUTE_PREFIX = "/v1/wallpapers/web-t/";
const SCENE_TOKEN_ROUTE_PREFIX = "/v1/wallpapers/scene-t/";

interface ParsedWebTokenRoute {
  token: string;
  rawId: string;
  relPath: string;
}

function parsePrefixedTokenRoutePath(pathname: string, prefix: string): ParsedWebTokenRoute | null {
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const rest = pathname.slice(prefix.length);
  const tokenSlash = rest.indexOf("/");
  if (tokenSlash <= 0) {
    return null;
  }
  const rawToken = rest.slice(0, tokenSlash);
  let token: string;
  try {
    token = decodeURIComponent(rawToken).trim();
  } catch {
    return null;
  }
  if (token.length === 0) {
    return null;
  }
  const afterToken = rest.slice(tokenSlash + 1);
  const idSlash = afterToken.indexOf("/");
  const rawId = idSlash >= 0 ? afterToken.slice(0, idSlash) : afterToken;
  const relPath = idSlash >= 0 ? afterToken.slice(idSlash + 1) : "";
  return { token, rawId, relPath };
}

function parseWebTokenRoutePath(pathname: string): ParsedWebTokenRoute | null {
  return parsePrefixedTokenRoutePath(pathname, WEB_TOKEN_ROUTE_PREFIX);
}

function parseSceneTokenRoutePath(pathname: string): ParsedWebTokenRoute | null {
  return parsePrefixedTokenRoutePath(pathname, SCENE_TOKEN_ROUTE_PREFIX);
}

function isLoopbackSameHostReferer(req: IncomingMessage, refererUrl: URL): boolean {
  if (refererUrl.protocol !== "http:" && refererUrl.protocol !== "https:") {
    return false;
  }
  const host = refererUrl.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]" && host !== "::1") {
    return false;
  }
  const reqHost = typeof req.headers.host === "string" ? req.headers.host.trim().toLowerCase() : "";
  return reqHost.length > 0 && refererUrl.host.toLowerCase() === reqHost;
}

function extractPrefixedRefererQueryToken(
  req: IncomingMessage,
  requestUrl: URL,
  routePrefix: string,
): string | null {
  if (!requestUrl.pathname.startsWith(routePrefix)) {
    return null;
  }
  const rawReferer = req.headers.referer;
  if (typeof rawReferer !== "string" || rawReferer.trim().length === 0) {
    return null;
  }
  let refUrl: URL;
  try {
    refUrl = new URL(rawReferer);
  } catch {
    return null;
  }
  if (!isLoopbackSameHostReferer(req, refUrl)) {
    return null;
  }
  const suffix = requestUrl.pathname.slice(routePrefix.length);
  const slashIdx = suffix.indexOf("/");
  const rawId = slashIdx >= 0 ? suffix.slice(0, slashIdx) : suffix;
  if (rawId.length === 0) {
    return null;
  }
  const expectedPrefix = `${routePrefix}${rawId}`;
  if (refUrl.pathname !== expectedPrefix && !refUrl.pathname.startsWith(`${expectedPrefix}/`)) {
    return null;
  }
  const refToken = refUrl.searchParams.get("token")?.trim();
  return refToken && refToken.length > 0 ? refToken : null;
}

function extractWebRefererQueryToken(req: IncomingMessage, requestUrl: URL): string | null {
  return extractPrefixedRefererQueryToken(req, requestUrl, "/v1/wallpapers/web/");
}

function extractSceneRefererQueryToken(req: IncomingMessage, requestUrl: URL): string | null {
  return extractPrefixedRefererQueryToken(req, requestUrl, "/v1/wallpapers/scene/");
}

function extractWebTokenRefererWallpaperId(
  req: IncomingMessage,
  expectedToken: string,
): string | null {
  const rawReferer = req.headers.referer;
  if (typeof rawReferer !== "string" || rawReferer.trim().length === 0) {
    return null;
  }
  let refUrl: URL;
  try {
    refUrl = new URL(rawReferer);
  } catch {
    return null;
  }
  if (!isLoopbackSameHostReferer(req, refUrl)) {
    return null;
  }
  const parsed = parseWebTokenRoutePath(refUrl.pathname);
  if (!parsed || parsed.token !== expectedToken || parsed.rawId.length === 0) {
    return null;
  }
  return parsed.rawId;
}

function extractCookieValue(req: IncomingMessage, cookieName: string): string | null {
  const rawCookie = req.headers.cookie;
  if (typeof rawCookie !== "string" || rawCookie.length === 0) {
    return null;
  }
  const pairs = rawCookie.split(";");
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = pair.slice(0, eqIdx).trim();
    if (key !== cookieName) continue;
    const rawVal = pair.slice(eqIdx + 1).trim();
    if (rawVal.length === 0) return null;
    try {
      const decoded = decodeURIComponent(rawVal).trim();
      return decoded.length > 0 ? decoded : null;
    } catch {
      return rawVal;
    }
  }
  return null;
}

function extractRequestToken(
  req: IncomingMessage,
  requestUrl: URL,
  allowQueryToken: boolean,
): string | null {
  const bearer = extractBearerToken(req);
  if (bearer !== null) {
    return bearer;
  }
  const customHeader = req.headers["x-prismux-token"];
  if (typeof customHeader === "string" && customHeader.trim().length > 0) {
    return customHeader.trim();
  }
  if (allowQueryToken) {
    const webPathParsed = parseWebTokenRoutePath(requestUrl.pathname);
    if (webPathParsed !== null) {
      return webPathParsed.token;
    }
    const scenePathParsed = parseSceneTokenRoutePath(requestUrl.pathname);
    if (scenePathParsed !== null) {
      return scenePathParsed.token;
    }
    const queryToken = requestUrl.searchParams.get("token")?.trim();
    if (queryToken !== undefined && queryToken.length > 0) {
      return queryToken;
    }
    if (requestUrl.pathname.startsWith("/v1/wallpapers/web/")) {
      const cookieToken = extractCookieValue(req, WEB_WALLPAPER_AUTH_COOKIE);
      if (cookieToken !== null) {
        return cookieToken;
      }
      const refererToken = extractWebRefererQueryToken(req, requestUrl);
      if (refererToken !== null) {
        return refererToken;
      }
    }
    if (requestUrl.pathname.startsWith("/v1/wallpapers/scene/")) {
      const cookieToken = extractCookieValue(req, SCENE_WALLPAPER_AUTH_COOKIE);
      if (cookieToken !== null) {
        return cookieToken;
      }
      const refererToken = extractSceneRefererQueryToken(req, requestUrl);
      if (refererToken !== null) {
        return refererToken;
      }
    }
  }
  return null;
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : (chunk as Buffer);
    totalBytes += buf.length;
    if (totalBytes > maxBytes) {
      throw new RpcDispatchError(
        "payload_too_large",
        `Request body exceeded ${maxBytes} bytes.`,
        413,
      );
    }
    chunks.push(buf);
  }

  const rawText = Buffer.concat(chunks).toString("utf8").trim();
  if (rawText.length === 0) {
    return {};
  }
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new RpcDispatchError("invalid_json", "Request body must be valid JSON.");
  }
}

function applyCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const rawOrigin = req.headers.origin;
  if (typeof rawOrigin === "string") {
    const trimmed = rawOrigin.trim();
    if (isAllowedCorsOrigin(trimmed)) {
      res.setHeader("access-control-allow-origin", trimmed);
      res.setHeader("vary", "Origin");
      res.setHeader("access-control-allow-methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS");
      res.setHeader(
        "access-control-allow-headers",
        "Content-Type, Authorization, Range, X-Prismux-Token, Cache-Control, Last-Event-ID, Pragma, Accept",
      );
      res.setHeader(
        "access-control-expose-headers",
        "Content-Range, Accept-Ranges, Content-Length, ETag, Content-Type",
      );
      res.setHeader("access-control-max-age", "600");
    }
  }
}

function writeJsonResponse(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = `${JSON.stringify(payload)}\n`;
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body, "utf8")),
  });
  res.end(body);
}

function requireStringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new RpcDispatchError("invalid_params", `Parameter "${key}" must be a non-empty string.`);
  }
  return value;
}

function optionalStringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new RpcDispatchError("invalid_params", `Parameter "${key}" must be a string.`);
  }
  return value;
}

function requireBooleanParam(params: Record<string, unknown>, key: string): boolean {
  const value = params[key];
  if (typeof value !== "boolean") {
    throw new RpcDispatchError("invalid_params", `Parameter "${key}" must be a boolean.`);
  }
  return value;
}

function requirePositiveIntParam(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new RpcDispatchError("invalid_params", `Parameter "${key}" must be a positive number.`);
  }
  return Math.floor(value);
}

function parseOptionalEmbedding(raw: unknown): number[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    throw new RpcDispatchError(
      "invalid_params",
      'Parameter "embedding" must be an array of finite numbers.',
    );
  }
  return raw as number[];
}

function parseOptionalStringArray(raw: unknown, key: string): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
    throw new RpcDispatchError("invalid_params", `Parameter "${key}" must be an array of strings.`);
  }
  return raw as string[];
}

export class DaemonRpcServer {
  private readonly host: string;
  private readonly requestedPort: number;
  private readonly headless: boolean;
  private readonly version: string;
  private readonly machineId: string;
  private readonly ptyPool: PersistentPtyPool;
  private readonly chiefManager: ChiefThreadManager;
  private readonly pairingManager: PairingManager;
  private readonly pluginHost: CordisPluginHost | undefined;
  private readonly onTogglePlugin:
    | ((pluginId: string, enabled: boolean) => Promise<{ pluginId: string; enabled: boolean }>)
    | undefined;
  private readonly appUpdater: AppUpdater | undefined;
  private readonly memoryStore: SqliteMemoryStore | undefined;
  private readonly obsidianImporter: ObsidianVaultImporterImpl | undefined;
  private readonly handoffEngine: HandoffEngine | undefined;
  private readonly hookBus: LifecycleHookBus | undefined;
  private readonly identityGuard = new ForwardIdentityGuard();
  private readonly coreSupervisor: CoreServerSupervisor | undefined;
  private readonly coreRpcClient: CoreRpcClient | undefined;
  private readonly wallpaperService: WallpaperMediaService | undefined;
  private readonly fontService: SystemFontService;
  private readonly appearanceStore: AppearanceConfigStore | undefined;
  private readonly businessService: DaemonBusinessService | undefined;
  private readonly overnightService: OvernightRouteService | undefined;
  private readonly diagnosticsService: ServiceDiagnosticsService | undefined;
  private readonly providerProbeService: PrismuxProviderProbeService | undefined;
  private readonly cliUpdateRouteService: CliUpdateRouteService | undefined;
  private readonly quotaService: OfficialQuotaService | undefined;
  private readonly portScannerService: PortScannerService | undefined;
  private readonly resourceMonitorService: ResourceMonitorService | undefined;
  private readonly storageQuotaService: StorageQuotaService | undefined;
  private readonly agentAuxService: AgentAuxService;
  private readonly subscriptionWaiverStore: SubscriptionWaiverStore | undefined;
  private readonly dispatchHub: DesktopIpcDispatchHub | undefined;
  private readonly startedAt: number;
  private readonly pairingRateLimitMaxRequests: number;
  private readonly pairingRateLimitWindowMs: number;
  private readonly onRequestShutdown: ((reason?: string) => void | Promise<void>) | undefined;

  private httpServer: Server | undefined;
  private wss: WebSocketServer | undefined;
  private boundPort: number | undefined;
  private activeStartPromise: Promise<void> | undefined;
  private activeStopPromise: Promise<void> | undefined;
  private readonly activeSockets = new Set<WebSocket>();
  private readonly socketCleanups = new Map<WebSocket, () => void>();
  private readonly activeSseCleanups = new Set<() => void>();
  private readonly lastWebWallpaperIdByToken = new Map<string, string>();
  private readonly pairingExchangeTimestampsByIp = new Map<string, number[]>();

  constructor(options: DaemonRpcServerOptions) {
    this.host = options.host ?? "127.0.0.1";
    this.requestedPort = options.port ?? 0;
    this.headless = options.headless;
    this.version = options.version ?? DEFAULT_APP_VERSION;
    this.machineId = options.machineId ?? "local";
    this.ptyPool = options.ptyPool;
    this.chiefManager = options.chiefManager;
    this.pairingManager = options.pairingManager;
    this.pluginHost = options.pluginHost;
    this.onTogglePlugin = options.onTogglePlugin;
    this.appUpdater = options.appUpdater;
    this.memoryStore = options.memoryStore;
    this.obsidianImporter = options.obsidianImporter;
    this.handoffEngine = options.handoffEngine;
    this.hookBus = options.hookBus;
    this.coreSupervisor = options.coreSupervisor ?? options.t3Supervisor;
    this.coreRpcClient = options.coreRpcClient ?? options.t3RpcClient;
    this.wallpaperService = options.wallpaperService;
    this.fontService = options.fontService ?? new SystemFontService();
    this.appearanceStore = options.appearanceStore;
    this.businessService = options.businessService;
    this.overnightService = options.overnightService;
    this.diagnosticsService = options.diagnosticsService;
    this.providerProbeService = options.providerProbeService;
    this.cliUpdateRouteService =
      options.cliUpdateService !== undefined
        ? new CliUpdateRouteService(options.cliUpdateService)
        : undefined;
    this.quotaService = options.quotaService;
    this.portScannerService = options.portScannerService;
    this.resourceMonitorService = options.resourceMonitorService;
    this.storageQuotaService = options.storageQuotaService;
    this.agentAuxService = options.agentAuxService ?? new AgentAuxService();
    this.subscriptionWaiverStore =
      options.subscriptionWaiverStore ?? options.antigravityPolicyStore;
    this.dispatchHub = options.dispatchHub;
    this.startedAt = options.startedAt ?? Date.now();
    this.pairingRateLimitMaxRequests = Math.max(
      1,
      Math.floor(options.pairingRateLimitMaxRequests ?? DEFAULT_PAIRING_RATE_LIMIT_MAX_REQUESTS),
    );
    this.pairingRateLimitWindowMs = Math.max(
      1_000,
      Math.floor(options.pairingRateLimitWindowMs ?? DEFAULT_PAIRING_RATE_LIMIT_WINDOW_MS),
    );
    this.onRequestShutdown = options.onRequestShutdown;
  }

  getPort(): number {
    if (this.boundPort === undefined) {
      throw new Error("DaemonRpcServer is not listening.");
    }
    return this.boundPort;
  }

  getHttpUrl(): string {
    const hostForUrl = this.host === "0.0.0.0" ? "127.0.0.1" : this.host;
    return `http://${hostForUrl}:${this.getPort()}`;
  }

  getWsUrl(): string {
    const hostForUrl = this.host === "0.0.0.0" ? "127.0.0.1" : this.host;
    return `ws://${hostForUrl}:${this.getPort()}/rpc`;
  }

  getHealthResponse(): DaemonHealthResponse {
    const supervisorStatus = this.coreSupervisor?.getStatus();
    const rpcStatus = this.coreRpcClient?.getStatus();
    const connected = rpcStatus?.connected ?? false;
    return {
      ok: true,
      headless: this.headless,
      version: this.version,
      t3Connected: connected,
      coreConnected: connected,
      supervisorState: supervisorStatus?.state ?? "stopped",
      activeProvider: this.chiefManager.getSlot().activeProvider,
      ptyCount: this.ptyPool.listSessions().length,
      uptimeMs: Math.max(0, Date.now() - this.startedAt),
    };
  }

  getCoreBridgeStatus(): CoreBridgeStatus {
    const supervisorStatus = this.coreSupervisor?.getStatus();
    const rpcStatus = this.coreRpcClient?.getStatus();
    return {
      supervisorState: supervisorStatus?.state ?? "stopped",
      rpcConnected: rpcStatus?.connected ?? false,
      wsUrl: rpcStatus?.wsUrl ?? "",
      protocolVersion: rpcStatus?.protocolVersion ?? "2",
      ...(supervisorStatus?.pid !== undefined ? { pid: supervisorStatus.pid } : {}),
      restartCount: supervisorStatus?.restartCount ?? 0,
      ...(rpcStatus?.lastError !== undefined
        ? { lastError: rpcStatus.lastError }
        : supervisorStatus?.lastError !== undefined
          ? { lastError: supervisorStatus.lastError }
          : {}),
    };
  }

  async start(): Promise<void> {
    if (this.activeStopPromise !== undefined) {
      await this.activeStopPromise;
    }
    if (this.httpServer !== undefined && this.boundPort !== undefined) {
      return;
    }
    if (this.activeStartPromise !== undefined) {
      return this.activeStartPromise;
    }

    const startRun = this.performStart().finally(() => {
      this.activeStartPromise = undefined;
    });
    this.activeStartPromise = startRun;
    return startRun;
  }

  async stop(): Promise<void> {
    if (this.activeStopPromise !== undefined) {
      return this.activeStopPromise;
    }

    const stopRun = this.performStop().finally(() => {
      this.activeStopPromise = undefined;
    });
    this.activeStopPromise = stopRun;
    return stopRun;
  }

  private async performStart(): Promise<void> {
    const wss = new WebSocketServer({ noServer: true });
    const server = createServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });

    server.on("upgrade", (req, socket, head) => {
      this.handleUpgrade(req, socket, head, wss);
    });

    wss.on("connection", (ws, req) => {
      const trustedScope =
        (req as IncomingMessage & { __prismuxCallerScope?: CallerScope }).__prismuxCallerScope ??
        "owner_chief";
      this.handleWsConnection(ws, trustedScope);
    });

    this.wss = wss;
    this.httpServer = server;

    await new Promise<void>((resolveListen, rejectListen) => {
      const onError = (err: Error) => {
        server.off("listening", onListening);
        rejectListen(err);
      };
      const onListening = () => {
        server.off("error", onError);
        const addr = server.address() as AddressInfo | null;
        if (addr === null) {
          rejectListen(new Error("DaemonRpcServer failed to resolve bound address."));
          return;
        }
        this.boundPort = addr.port;
        resolveListen();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.requestedPort, this.host);
    });
  }

  private async performStop(): Promise<void> {
    const server = this.httpServer;
    const wss = this.wss;
    this.httpServer = undefined;
    this.wss = undefined;
    this.boundPort = undefined;

    for (const cleanupSse of Array.from(this.activeSseCleanups)) {
      try {
        cleanupSse();
      } catch {
        // Ignore cleanup errors during shutdown.
      }
    }
    this.activeSseCleanups.clear();
    this.lastWebWallpaperIdByToken.clear();
    this.pairingExchangeTimestampsByIp.clear();

    for (const ws of Array.from(this.activeSockets)) {
      const cleanup = this.socketCleanups.get(ws);
      cleanup?.();
      this.socketCleanups.delete(ws);
      this.activeSockets.delete(ws);
      try {
        ws.close(1001, "daemon shutting down");
      } catch {
        try {
          ws.terminate();
        } catch {
          // Socket already closed.
        }
      }
    }

    if (wss !== undefined) {
      await new Promise<void>((resolveWss) => {
        wss.close(() => resolveWss());
      });
    }

    if (server !== undefined) {
      await new Promise<void>((resolveServer) => {
        server.close(() => resolveServer());
        server.closeAllConnections?.();
      });
    }
  }

  private authenticateHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    requestUrl?: URL,
    allowQueryToken = false,
  ): CallerScope | null {
    const token =
      requestUrl !== undefined
        ? extractRequestToken(req, requestUrl, allowQueryToken)
        : extractBearerToken(req);
    const trustedScope = token !== null ? this.pairingManager.resolveTokenScope(token) : null;
    if (trustedScope === null) {
      writeJsonResponse(res, 401, {
        ok: false,
        error: {
          code: "unauthorized",
          message: "Missing or invalid Bearer token.",
        },
      });
      return null;
    }
    return trustedScope;
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    applyCorsHeaders(req, res);

    let requestUrl: URL;
    try {
      requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      writeJsonResponse(res, 400, {
        ok: false,
        error: { code: "invalid_url", message: "Malformed request URL." },
      });
      return;
    }
    const method = req.method?.toUpperCase() ?? "GET";

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (method === "GET" && requestUrl.pathname === "/health") {
        writeJsonResponse(res, 200, this.getHealthResponse());
        return;
      }

      if (method === "POST" && requestUrl.pathname === "/v1/pair/exchange") {
        const rateLimit = this.consumePairingExchangeQuota(req);
        if (!rateLimit.allowed) {
          res.setHeader("retry-after", String(rateLimit.retryAfterSeconds));
          writeJsonResponse(res, 429, {
            ok: false,
            error: {
              code: "rate_limited",
              message: "Too many pairing exchange attempts. Please try again later.",
            },
          });
          return;
        }
        const body = await readJsonBody(req);
        if (!isRecord(body) || typeof body.pairingCode !== "string") {
          this.pairingManager.recordFailedPairingAttempt();
          writeJsonResponse(res, 400, {
            ok: false,
            error: {
              code: "invalid_params",
              message: "pairingCode must be a string.",
            },
          });
          return;
        }
        const deviceLabel = typeof body.deviceLabel === "string" ? body.deviceLabel : undefined;
        const exchanged = this.pairingManager.exchangePairingCode(body.pairingCode, deviceLabel);
        if (exchanged === null) {
          writeJsonResponse(res, 401, {
            ok: false,
            error: {
              code: "unauthorized",
              message: "Invalid, used, or expired pairing code.",
            },
          });
          return;
        }
        writeJsonResponse(res, 200, {
          token: exchanged.token,
          daemonUrl: this.getHttpUrl(),
          wsUrl: this.getWsUrl(),
          deviceLabel: exchanged.deviceLabel,
          issuedAt: exchanged.issuedAt,
        });
        return;
      }

      if (method === "POST" && requestUrl.pathname === "/v1/memory/query") {
        const trustedCallerScope = this.authenticateHttpRequest(req, res);
        if (trustedCallerScope === null) {
          return;
        }
        const rawBody = await readJsonBody(req);
        const result = await this.executeMemoryQuery(rawBody, trustedCallerScope);
        writeJsonResponse(res, 200, result);
        return;
      }

      if (method === "POST" && requestUrl.pathname === "/v1/memory/upsert") {
        const trustedCallerScope = this.authenticateHttpRequest(req, res);
        if (trustedCallerScope === null) {
          return;
        }
        const rawBody = await readJsonBody(req);
        const entry = await this.executeMemoryUpsert(rawBody, trustedCallerScope);
        writeJsonResponse(res, 200, {
          id: entry.id,
          updatedAt: entry.updatedAt,
          entry,
        });
        return;
      }

      if (method === "POST" && requestUrl.pathname === "/v1/memory/import-obsidian") {
        const trustedCallerScope = this.authenticateHttpRequest(req, res);
        if (trustedCallerScope === null) {
          return;
        }
        if (trustedCallerScope !== "owner_chief") {
          writeJsonResponse(res, 403, {
            ok: false,
            error: {
              code: "forbidden",
              message: "Only owner_chief callerScope may import an Obsidian vault.",
            },
          });
          return;
        }
        if (this.obsidianImporter === undefined) {
          throw new RpcDispatchError("not_configured", "Obsidian importer is not configured.", 503);
        }
        const rawBody = await readJsonBody(req);
        if (!isRecord(rawBody)) {
          throw new RpcDispatchError("invalid_params", "Request body must be a JSON object.");
        }
        const vaultPath = requireStringParam(rawBody, "vaultPath");
        const targetNsRaw = optionalStringParam(rawBody, "targetNamespace");
        let targetNamespace: MemoryNamespace | undefined;
        if (targetNsRaw !== undefined) {
          if (!isValidMemoryNamespace(targetNsRaw)) {
            throw new RpcDispatchError(
              "invalid_params",
              `Invalid targetNamespace: "${targetNsRaw}".`,
            );
          }
          targetNamespace = targetNsRaw;
        }
        const dryRun =
          rawBody.dryRun !== undefined ? requireBooleanParam(rawBody, "dryRun") : undefined;
        const importReq: ObsidianImportRequest = {
          vaultPath,
          ...(targetNamespace !== undefined ? { targetNamespace } : {}),
          ...(dryRun !== undefined ? { dryRun } : {}),
        };
        const result = await this.obsidianImporter.importVault(importReq);
        writeJsonResponse(res, 200, result);
        return;
      }

      if (method === "GET" && requestUrl.pathname === "/v1/updater/status") {
        const trustedCallerScope = this.authenticateHttpRequest(req, res);
        if (trustedCallerScope === null) {
          return;
        }
        writeJsonResponse(res, 200, this.requireAppUpdater().getStatus());
        return;
      }

      if (method === "GET" && requestUrl.pathname === "/v1/updater/events") {
        const trustedCallerScope = this.authenticateHttpRequest(req, res, requestUrl, true);
        if (trustedCallerScope === null) {
          return;
        }
        this.handleUpdaterSseStream(req, res);
        return;
      }

      if (method === "POST" && requestUrl.pathname === "/v1/updater/probe") {
        const trustedCallerScope = this.authenticateHttpRequest(req, res);
        if (trustedCallerScope === null) {
          return;
        }
        const report = await this.requireAppUpdater().probeSources();
        writeJsonResponse(res, 200, report);
        return;
      }

      if (method === "POST" && requestUrl.pathname === "/v1/updater/check") {
        const trustedCallerScope = this.authenticateHttpRequest(req, res);
        if (trustedCallerScope === null) {
          return;
        }
        const rawBody = await readJsonBody(req);
        const result = await this.executeUpdaterCheck(rawBody);
        writeJsonResponse(res, 200, result);
        return;
      }

      if (method === "POST" && requestUrl.pathname === "/v1/updater/policy") {
        const trustedCallerScope = this.authenticateHttpRequest(req, res);
        if (trustedCallerScope === null) {
          return;
        }
        const rawBody = await readJsonBody(req);
        const policy = this.executeUpdaterSetPolicy(rawBody);
        writeJsonResponse(res, 200, { policy });
        return;
      }

      if (method === "POST" && requestUrl.pathname === "/v1/updater/download") {
        const trustedCallerScope = this.authenticateHttpRequest(req, res);
        if (trustedCallerScope === null) {
          return;
        }
        req.socket?.setTimeout?.(0);
        res.setTimeout?.(0);
        const rawBody = await readJsonBody(req);
        const result = await this.executeUpdaterDownload(rawBody);
        writeJsonResponse(res, 200, result);
        return;
      }

      if (method === "POST" && requestUrl.pathname === "/v1/rpc") {
        const trustedCallerScope = this.authenticateHttpRequest(req, res);
        if (trustedCallerScope === null) {
          return;
        }

        const rawBody = await readJsonBody(req);
        const envelope = this.parseRpcEnvelope(rawBody);
        const outcome = await this.executeRpc(envelope, trustedCallerScope);
        writeJsonResponse(res, 200, outcome.response);
        outcome.afterSend?.();
        return;
      }

      if (await this.handleExtendedHttpRoutes(req, res, method, requestUrl)) {
        return;
      }

      writeJsonResponse(res, 404, {
        ok: false,
        error: {
          code: "not_found",
          message: `Route not found: ${method} ${requestUrl.pathname}`,
        },
      });
    } catch (error) {
      if (error instanceof WallpaperServiceError) {
        writeJsonResponse(res, error.statusCode, {
          ok: false,
          error: { code: error.code, message: error.message },
        });
        return;
      }
      if (error instanceof PortKillError) {
        writeJsonResponse(res, error.statusCode, {
          ok: false,
          killed: false,
          message: error.message,
          error: { code: error.code, message: error.message },
        });
        return;
      }
      if (error instanceof BusinessRouteError) {
        writeJsonResponse(res, error.statusCode, {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.details !== undefined ? { details: error.details } : {}),
          },
        });
        return;
      }
      if (error instanceof RpcDispatchError) {
        writeJsonResponse(res, error.httpStatus, {
          id: "unknown",
          ok: false,
          error: { code: error.code, message: error.message },
        });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      writeJsonResponse(res, 500, {
        ok: false,
        error: { code: "internal_error", message },
      });
    }
  }

  private async handleExtendedHttpRoutes(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    requestUrl: URL,
  ): Promise<boolean> {
    const rawPathPart = (req.url ?? "/").split("?")[0] ?? "/";
    if (
      rawPathPart.startsWith("/v1/wallpapers/") &&
      /(?:^|[\\/])\.\.(?:[\\/]|$)|%2e%2e|\0/i.test(rawPathPart)
    ) {
      const parsedRawPathToken = rawPathPart.startsWith(WEB_TOKEN_ROUTE_PREFIX)
        ? parseWebTokenRoutePath(rawPathPart)
        : rawPathPart.startsWith(SCENE_TOKEN_ROUTE_PREFIX)
          ? parseSceneTokenRoutePath(rawPathPart)
          : null;
      const pathTokenScope =
        parsedRawPathToken !== null
          ? this.pairingManager.resolveTokenScope(parsedRawPathToken.token)
          : null;
      if (
        pathTokenScope === null &&
        this.authenticateHttpRequest(req, res, requestUrl, true) === null
      ) {
        return true;
      }
      writeJsonResponse(res, 403, {
        ok: false,
        error: {
          code: "PATH_TRAVERSAL_BLOCKED",
          message: "Path traversal is forbidden.",
        },
      });
      return true;
    }

    const pathname = requestUrl.pathname;

    if (method === "GET" && pathname === "/v1/wallpapers/inventory") {
      if (this.authenticateHttpRequest(req, res) === null) return true;
      if (!this.wallpaperService) {
        throw new BusinessRouteError(
          503,
          "WALLPAPER_UNAVAILABLE",
          "WallpaperMediaService is not configured.",
        );
      }
      const advancedEngineEnabled = this.appearanceStore
        ? this.appearanceStore.get().config.wallpaper.advancedEngineEnabled
        : this.wallpaperService.isAdvancedEngineEnabled();
      let inventory = await this.wallpaperService.getInventory({
        advancedEngineEnabled,
      });
      if (this.appearanceStore?.isLegacyAdvancedEngineMigrationPending()) {
        const pendingWallpaper = this.appearanceStore.get().config.wallpaper;
        const selectedId = pendingWallpaper.selectedId;
        const matched = selectedId
          ? inventory.items.find(
              (item) => item.id === selectedId || `steam:${item.id}` === selectedId,
            )
          : undefined;
        const migratedToTrue = this.appearanceStore.resolveLegacyAdvancedEngineMigration(
          matched?.type ?? null,
        );
        if (migratedToTrue) {
          inventory = await this.wallpaperService.rescan({
            customDirs: pendingWallpaper.customDirs,
            steamRootOverride: pendingWallpaper.steamRootOverride,
            advancedEngineEnabled: true,
          });
        }
      }
      writeJsonResponse(res, 200, inventory);
      return true;
    }

    if (method === "POST" && pathname === "/v1/wallpapers/rescan") {
      if (this.authenticateHttpRequest(req, res) === null) return true;
      if (!this.wallpaperService) {
        throw new BusinessRouteError(
          503,
          "WALLPAPER_UNAVAILABLE",
          "WallpaperMediaService is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      const rescanReq: WallpaperRescanRequest = {};
      if (isRecord(rawBody)) {
        if (Array.isArray(rawBody["customDirs"])) {
          rescanReq.customDirs = rawBody["customDirs"].filter(
            (d): d is string => typeof d === "string",
          );
        }
        if (typeof rawBody["steamRootOverride"] === "string") {
          rescanReq.steamRootOverride = rawBody["steamRootOverride"];
        }
        if (typeof rawBody["advancedEngineEnabled"] === "boolean") {
          rescanReq.advancedEngineEnabled = rawBody["advancedEngineEnabled"];
        }
      }
      if (rescanReq.advancedEngineEnabled === undefined && this.appearanceStore) {
        rescanReq.advancedEngineEnabled =
          this.appearanceStore.get().config.wallpaper.advancedEngineEnabled;
      }
      const inventory = await this.wallpaperService.rescan(rescanReq);
      this.diagnosticsService?.clearCache();
      writeJsonResponse(res, 200, inventory);
      return true;
    }

    if (method === "POST" && pathname === "/v1/wallpapers/import") {
      if (this.authenticateHttpRequest(req, res) === null) return true;
      if (!this.wallpaperService) {
        throw new BusinessRouteError(
          503,
          "WALLPAPER_UNAVAILABLE",
          "WallpaperMediaService is not configured.",
        );
      }
      const rawBody = await readJsonBody(req, MAX_IMPORT_JSON_BODY_BYTES);
      if (!isRecord(rawBody)) {
        throw new RpcDispatchError("invalid_params", "Import request body must be a JSON object.");
      }
      const importReq: WallpaperImportRequest = {
        ...(typeof rawBody["sourcePath"] === "string" ? { sourcePath: rawBody["sourcePath"] } : {}),
        ...(typeof rawBody["fileName"] === "string"
          ? { fileName: rawBody["fileName"] }
          : typeof rawBody["filename"] === "string"
            ? { fileName: rawBody["filename"] }
            : typeof rawBody["name"] === "string"
              ? { fileName: rawBody["name"] }
              : {}),
        ...(typeof rawBody["base64"] === "string"
          ? { base64: rawBody["base64"] }
          : typeof rawBody["dataBase64"] === "string"
            ? { base64: rawBody["dataBase64"] }
            : typeof rawBody["contentBase64"] === "string"
              ? { base64: rawBody["contentBase64"] }
              : {}),
        ...(typeof rawBody["title"] === "string" ? { title: rawBody["title"] } : {}),
      };
      const result = await this.wallpaperService.importWallpaper(importReq);
      this.diagnosticsService?.clearCache();
      writeJsonResponse(res, 200, { ok: true, ...result });
      return true;
    }

    if ((method === "GET" || method === "HEAD") && pathname.startsWith("/v1/wallpapers/preview/")) {
      if (this.authenticateHttpRequest(req, res, requestUrl, true) === null) {
        return true;
      }
      if (!this.wallpaperService) {
        throw new BusinessRouteError(
          503,
          "WALLPAPER_UNAVAILABLE",
          "WallpaperMediaService is not configured.",
        );
      }
      req.socket?.setTimeout?.(0);
      res.setTimeout?.(0);
      const rawId = pathname.slice("/v1/wallpapers/preview/".length);
      await this.wallpaperService.servePreview(rawId, req, res);
      return true;
    }

    if ((method === "GET" || method === "HEAD") && pathname.startsWith("/v1/wallpapers/media/")) {
      if (this.authenticateHttpRequest(req, res, requestUrl, true) === null) {
        return true;
      }
      if (!this.wallpaperService) {
        throw new BusinessRouteError(
          503,
          "WALLPAPER_UNAVAILABLE",
          "WallpaperMediaService is not configured.",
        );
      }
      req.socket?.setTimeout?.(0);
      res.setTimeout?.(0);
      const rawId = pathname.slice("/v1/wallpapers/media/".length);
      await this.wallpaperService.serveMedia(rawId, req, res);
      return true;
    }

    if (
      (method === "GET" || method === "HEAD") &&
      (pathname === "/v1/wallpapers/web-t" || pathname.startsWith(WEB_TOKEN_ROUTE_PREFIX))
    ) {
      const parsed = parseWebTokenRoutePath(pathname);
      const trustedScope =
        parsed !== null ? this.pairingManager.resolveTokenScope(parsed.token) : null;
      if (parsed === null || trustedScope === null) {
        writeJsonResponse(res, 401, {
          ok: false,
          error: {
            code: "unauthorized",
            message: "Missing or invalid Bearer token.",
          },
        });
        return true;
      }
      if (!this.wallpaperService) {
        throw new BusinessRouteError(
          503,
          "WALLPAPER_UNAVAILABLE",
          "WallpaperMediaService is not configured.",
        );
      }
      req.socket?.setTimeout?.(0);
      res.setTimeout?.(0);
      if (parsed.rawId.length === 0) {
        writeJsonResponse(res, 404, {
          ok: false,
          error: { code: "WALLPAPER_NOT_FOUND", message: "Missing wallpaper id." },
        });
        return true;
      }
      const advancedEngineEnabled = this.appearanceStore
        ? this.appearanceStore.get().config.wallpaper.advancedEngineEnabled
        : this.wallpaperService.isAdvancedEngineEnabled();
      if (advancedEngineEnabled && (await this.wallpaperService.isWebWallpaperId(parsed.rawId))) {
        this.lastWebWallpaperIdByToken.set(parsed.token, parsed.rawId);
      }
      const refererWallpaperId =
        extractWebTokenRefererWallpaperId(req, parsed.token) ??
        this.lastWebWallpaperIdByToken.get(parsed.token) ??
        null;
      await this.wallpaperService.serveWebAsset(parsed.rawId, parsed.relPath, req, res, {
        refererWallpaperId,
        advancedEngineEnabled,
      });
      return true;
    }

    if (
      (method === "GET" || method === "HEAD") &&
      (pathname === "/v1/wallpapers/scene-t" || pathname.startsWith(SCENE_TOKEN_ROUTE_PREFIX))
    ) {
      const parsed = parseSceneTokenRoutePath(pathname);
      const trustedScope =
        parsed !== null ? this.pairingManager.resolveTokenScope(parsed.token) : null;
      if (parsed === null || trustedScope === null) {
        writeJsonResponse(res, 401, {
          ok: false,
          error: {
            code: "unauthorized",
            message: "Missing or invalid Bearer token.",
          },
        });
        return true;
      }
      if (!this.wallpaperService) {
        throw new BusinessRouteError(
          503,
          "WALLPAPER_UNAVAILABLE",
          "WallpaperMediaService is not configured.",
        );
      }
      req.socket?.setTimeout?.(0);
      res.setTimeout?.(0);
      if (parsed.rawId.length === 0) {
        writeJsonResponse(res, 404, {
          ok: false,
          error: { code: "WALLPAPER_NOT_FOUND", message: "Missing wallpaper id." },
        });
        return true;
      }
      const advancedEngineEnabled = this.appearanceStore
        ? this.appearanceStore.get().config.wallpaper.advancedEngineEnabled
        : this.wallpaperService.isAdvancedEngineEnabled();
      await this.wallpaperService.serveSceneAsset(parsed.rawId, parsed.relPath, req, res, {
        advancedEngineEnabled,
      });
      return true;
    }

    if (
      (method === "GET" || method === "HEAD") &&
      (pathname === "/v1/wallpapers/scene" || pathname.startsWith("/v1/wallpapers/scene/"))
    ) {
      if (this.authenticateHttpRequest(req, res, requestUrl, true) === null) {
        return true;
      }
      const sceneQueryToken = requestUrl.searchParams.get("token")?.trim();
      if (sceneQueryToken && sceneQueryToken.length > 0) {
        res.setHeader(
          "set-cookie",
          `${SCENE_WALLPAPER_AUTH_COOKIE}=${encodeURIComponent(sceneQueryToken)}; HttpOnly; SameSite=Lax; Path=/v1/wallpapers/scene/`,
        );
      }
      if (!this.wallpaperService) {
        throw new BusinessRouteError(
          503,
          "WALLPAPER_UNAVAILABLE",
          "WallpaperMediaService is not configured.",
        );
      }
      req.socket?.setTimeout?.(0);
      res.setTimeout?.(0);
      const suffix = pathname.slice("/v1/wallpapers/scene/".length);
      const slashIdx = suffix.indexOf("/");
      const rawId = slashIdx >= 0 ? suffix.slice(0, slashIdx) : suffix;
      const relPath = slashIdx >= 0 ? suffix.slice(slashIdx + 1) : "";
      if (rawId.length === 0) {
        writeJsonResponse(res, 404, {
          ok: false,
          error: { code: "WALLPAPER_NOT_FOUND", message: "Missing wallpaper id." },
        });
        return true;
      }
      const advancedEngineEnabled = this.appearanceStore
        ? this.appearanceStore.get().config.wallpaper.advancedEngineEnabled
        : this.wallpaperService.isAdvancedEngineEnabled();
      await this.wallpaperService.serveSceneAsset(rawId, relPath, req, res, {
        advancedEngineEnabled,
      });
      return true;
    }

    if (
      (method === "GET" || method === "HEAD") &&
      (pathname === "/v1/wallpapers/web" || pathname.startsWith("/v1/wallpapers/web/"))
    ) {
      if (this.authenticateHttpRequest(req, res, requestUrl, true) === null) {
        return true;
      }
      const webQueryToken = requestUrl.searchParams.get("token")?.trim();
      if (webQueryToken && webQueryToken.length > 0) {
        // Scope cookie strictly to /v1/wallpapers/web/ so relative subresources (JS/CSS/assets) inside
        // Steam Web wallpaper iframes authenticate seamlessly without exposing token to other routes.
        res.setHeader(
          "set-cookie",
          `${WEB_WALLPAPER_AUTH_COOKIE}=${encodeURIComponent(webQueryToken)}; HttpOnly; SameSite=Lax; Path=/v1/wallpapers/web/`,
        );
      }
      if (!this.wallpaperService) {
        throw new BusinessRouteError(
          503,
          "WALLPAPER_UNAVAILABLE",
          "WallpaperMediaService is not configured.",
        );
      }
      req.socket?.setTimeout?.(0);
      res.setTimeout?.(0);
      const suffix = pathname.slice("/v1/wallpapers/web/".length);
      const slashIdx = suffix.indexOf("/");
      const rawId = slashIdx >= 0 ? suffix.slice(0, slashIdx) : suffix;
      const relPath = slashIdx >= 0 ? suffix.slice(slashIdx + 1) : "";
      if (rawId.length === 0) {
        writeJsonResponse(res, 404, {
          ok: false,
          error: { code: "WALLPAPER_NOT_FOUND", message: "Missing wallpaper id." },
        });
        return true;
      }
      const advancedEngineEnabled = this.appearanceStore
        ? this.appearanceStore.get().config.wallpaper.advancedEngineEnabled
        : this.wallpaperService.isAdvancedEngineEnabled();
      await this.wallpaperService.serveWebAsset(rawId, relPath, req, res, {
        advancedEngineEnabled,
      });
      return true;
    }

    if (method === "GET" && pathname === "/v1/system/fonts") {
      if (this.authenticateHttpRequest(req, res) === null) return true;
      const forceRefresh =
        requestUrl.searchParams.get("refresh") === "true" ||
        requestUrl.searchParams.get("force") === "true";
      const result = await this.fontService.listFonts(forceRefresh);
      writeJsonResponse(res, 200, { ok: true, ...result });
      return true;
    }

    if (method === "GET" && pathname === "/v1/appearance") {
      if (this.authenticateHttpRequest(req, res) === null) return true;
      if (!this.appearanceStore) {
        throw new BusinessRouteError(
          503,
          "APPEARANCE_UNAVAILABLE",
          "AppearanceConfigStore is not configured.",
        );
      }
      if (this.wallpaperService && this.appearanceStore.isLegacyAdvancedEngineMigrationPending()) {
        const pendingWallpaper = this.appearanceStore.get().config.wallpaper;
        const selectedId = pendingWallpaper.selectedId;
        let matchedType: "image" | "video" | "web" | "scene" | null = null;
        if (selectedId) {
          const probeInventory = await this.wallpaperService.getInventory({
            advancedEngineEnabled: false,
          });
          const matched = probeInventory.items.find(
            (item) => item.id === selectedId || `steam:${item.id}` === selectedId,
          );
          matchedType = matched?.type ?? null;
        }
        const migratedToTrue =
          this.appearanceStore.resolveLegacyAdvancedEngineMigration(matchedType);
        if (migratedToTrue) {
          await this.wallpaperService.rescan({
            customDirs: pendingWallpaper.customDirs,
            steamRootOverride: pendingWallpaper.steamRootOverride,
            advancedEngineEnabled: true,
          });
        }
      }
      const loaded = this.appearanceStore.get();
      writeJsonResponse(res, 200, {
        ok: true,
        ...loaded.config,
        recoveredFromCorruption: loaded.recoveredFromCorruption,
      });
      return true;
    }

    if (method === "PUT" && pathname === "/v1/appearance") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (trustedCallerScope !== "owner_chief") {
        throw new BusinessRouteError(
          403,
          "FORBIDDEN_SCOPE",
          `Scope "${trustedCallerScope}" cannot modify appearance settings.`,
        );
      }
      if (!this.appearanceStore) {
        throw new BusinessRouteError(
          503,
          "APPEARANCE_UNAVAILABLE",
          "AppearanceConfigStore is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      if (!isRecord(rawBody)) {
        throw new RpcDispatchError("invalid_params", "Appearance payload must be a JSON object.");
      }
      const prevWallpaper = this.appearanceStore.get().config.wallpaper;
      const updated = this.appearanceStore.update(rawBody);
      const nextWallpaper = updated.wallpaper;
      const customDirsChanged =
        prevWallpaper.customDirs.length !== nextWallpaper.customDirs.length ||
        prevWallpaper.customDirs.some((dir, idx) => dir !== nextWallpaper.customDirs[idx]);
      const steamRootChanged = prevWallpaper.steamRootOverride !== nextWallpaper.steamRootOverride;
      const advancedEngineChanged =
        prevWallpaper.advancedEngineEnabled !== nextWallpaper.advancedEngineEnabled;
      if (
        this.wallpaperService &&
        (customDirsChanged || steamRootChanged || advancedEngineChanged)
      ) {
        await this.wallpaperService.rescan({
          customDirs: nextWallpaper.customDirs,
          steamRootOverride: nextWallpaper.steamRootOverride,
          advancedEngineEnabled: nextWallpaper.advancedEngineEnabled,
        });
      }
      writeJsonResponse(res, 200, { ok: true, ...updated });
      return true;
    }

    if (method === "GET" && pathname === "/v1/chief") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      writeJsonResponse(res, 200, this.businessService.getChiefStatus(trustedCallerScope));
      return true;
    }

    if (method === "POST" && pathname === "/v1/chief/switch") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      const result = await this.businessService.switchChief(rawBody, trustedCallerScope);
      this.diagnosticsService?.clearCache();
      writeJsonResponse(res, 200, result);
      return true;
    }

    if ((method === "PUT" || method === "POST") && pathname === "/v1/chief/profile") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      const result = this.businessService.updateChiefProfile(rawBody, trustedCallerScope);
      this.diagnosticsService?.clearCache();
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (method === "GET" && pathname === "/v1/chief/agents-md") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const result = this.businessService.getChiefAgentsMd(trustedCallerScope);
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (method === "PUT" && pathname === "/v1/chief/agents-md") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      const result = this.businessService.saveChiefAgentsMd(rawBody, trustedCallerScope);
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (method === "POST" && pathname === "/v1/memory/import-obsidian/plan") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      const result = await this.businessService.planObsidianVaultImport(
        rawBody,
        trustedCallerScope,
      );
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (method === "POST" && pathname === "/v1/memory/import-obsidian/commit") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      const result = await this.businessService.commitObsidianVaultImport(
        rawBody,
        trustedCallerScope,
      );
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (method === "GET" && pathname === "/v1/memory/stats") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const stats = await this.businessService.getMemoryStats(trustedCallerScope);
      writeJsonResponse(res, 200, stats);
      return true;
    }

    if (method === "POST" && pathname === "/v1/memory/search") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      const result = await this.businessService.searchMemory(rawBody, trustedCallerScope);
      writeJsonResponse(res, 200, result);
      return true;
    }

    const memoryEntryMatch = /^\/v1\/memory\/entries\/([^/]+)$/.exec(pathname);
    if (method === "DELETE" && memoryEntryMatch?.[1]) {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      let entryId: string;
      try {
        entryId = decodeURIComponent(memoryEntryMatch[1]);
      } catch {
        throw new BusinessRouteError(400, "INVALID_PARAMS", "Malformed memory entry id.");
      }
      const result = await this.businessService.deleteMemoryEntry(entryId, trustedCallerScope);
      this.diagnosticsService?.clearCache();
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (method === "POST" && pathname === "/v1/memory/delete") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      const entryId = isRecord(rawBody) ? rawBody["id"] : undefined;
      const result = await this.businessService.deleteMemoryEntry(entryId, trustedCallerScope);
      this.diagnosticsService?.clearCache();
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (method === "GET" && pathname === "/v1/sync/status") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const result = await this.businessService.getSyncStatus(trustedCallerScope);
      writeJsonResponse(res, 200, result);
      return true;
    }

    if ((method === "PUT" || method === "POST") && pathname === "/v1/sync/config") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      const result = await this.businessService.updateSyncConfig(rawBody, trustedCallerScope);
      this.diagnosticsService?.clearCache();
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (method === "POST" && pathname === "/v1/sync/now") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      const result = await this.businessService.triggerSyncNow(rawBody, trustedCallerScope);
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (method === "POST" && pathname === "/v1/sync/test") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      const result = await this.businessService.testSyncConnection(rawBody, trustedCallerScope);
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (
      (method === "GET" &&
        (pathname === "/v1/diagnostics/services" || pathname === "/v1/diagnostics")) ||
      (method === "POST" &&
        (pathname === "/v1/diagnostics/refresh" || pathname === "/v1/diagnostics/services/refresh"))
    ) {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (trustedCallerScope !== "owner_chief") {
        throw new BusinessRouteError(
          403,
          "FORBIDDEN_SCOPE",
          `Scope "${trustedCallerScope}" is not permitted to access ${pathname}.`,
        );
      }
      if (!this.diagnosticsService) {
        throw new BusinessRouteError(
          503,
          "DIAGNOSTICS_UNAVAILABLE",
          "ServiceDiagnosticsService is not configured.",
        );
      }
      const isRefreshPost = method === "POST";
      const forceParam = requestUrl.searchParams.get("force")?.trim().toLowerCase();
      const refreshParam = requestUrl.searchParams.get("refresh")?.trim().toLowerCase();
      const includeAllParam = requestUrl.searchParams.get("includeAll")?.trim().toLowerCase();
      const deepScanParam = requestUrl.searchParams.get("deepScan")?.trim().toLowerCase();
      const hasProvidersParam = requestUrl.searchParams.has("providers");
      const providersParam = hasProvidersParam
        ? (requestUrl.searchParams.get("providers") ?? "")
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p.length > 0)
        : undefined;
      const force =
        isRefreshPost ||
        forceParam === "1" ||
        forceParam === "true" ||
        refreshParam === "1" ||
        refreshParam === "true";
      const includeAll = includeAllParam === "1" || includeAllParam === "true";
      const deepScan = deepScanParam === "1" || deepScanParam === "true";
      const report = await this.diagnosticsService.runDiagnostics({
        force,
        ...(providersParam !== undefined ? { providers: providersParam } : {}),
        ...(includeAll ? { includeAll: true } : {}),
        ...(deepScan ? { deepScan: true } : {}),
      });
      writeJsonResponse(res, 200, report);
      return true;
    }

    if (method === "GET" && pathname === "/v1/system/ports") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (trustedCallerScope !== "owner_chief") {
        throw new BusinessRouteError(
          403,
          "FORBIDDEN_SCOPE",
          `Scope "${trustedCallerScope}" is not permitted to access /v1/system/ports.`,
        );
      }
      if (!this.portScannerService) {
        throw new BusinessRouteError(
          503,
          "PORT_SCANNER_UNAVAILABLE",
          "PortScannerService is not configured.",
        );
      }
      const workspace = requestUrl.searchParams.get("workspace") ?? undefined;
      const scanned = await this.portScannerService.scanPorts(workspace);
      writeJsonResponse(res, 200, scanned);
      return true;
    }

    if (method === "POST" && pathname === "/v1/system/ports/kill") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (trustedCallerScope !== "owner_chief") {
        throw new BusinessRouteError(
          403,
          "FORBIDDEN_SCOPE",
          `Scope "${trustedCallerScope}" is not permitted to terminate system ports.`,
        );
      }
      if (!this.portScannerService) {
        throw new BusinessRouteError(
          503,
          "PORT_SCANNER_UNAVAILABLE",
          "PortScannerService is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      if (!isRecord(rawBody)) {
        throw new PortKillError(400, "INVALID_PARAMS", "请求体必须是 JSON 对象。");
      }
      const signal = typeof rawBody["signal"] === "string" ? rawBody["signal"] : undefined;
      try {
        const result = await this.portScannerService.killPid(rawBody["pid"], signal);
        writeJsonResponse(res, 200, result);
      } catch (err) {
        if (err instanceof PortKillError) {
          writeJsonResponse(res, err.statusCode, {
            ok: false,
            pid: typeof rawBody["pid"] === "number" ? rawBody["pid"] : -1,
            killed: false,
            message: err.message,
            error: { code: err.code, message: err.message },
          });
          return true;
        }
        throw err;
      }
      return true;
    }

    if (method === "GET" && pathname === "/v1/system/resources") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (trustedCallerScope !== "owner_chief") {
        throw new BusinessRouteError(
          403,
          "FORBIDDEN_SCOPE",
          `Scope "${trustedCallerScope}" is not permitted to access /v1/system/resources.`,
        );
      }
      if (!this.resourceMonitorService) {
        throw new BusinessRouteError(
          503,
          "RESOURCE_MONITOR_UNAVAILABLE",
          "ResourceMonitorService is not configured.",
        );
      }
      const refreshParam =
        requestUrl.searchParams.get("refresh") ?? requestUrl.searchParams.get("force");
      const forceRefresh =
        refreshParam === "1" || refreshParam === "true" || refreshParam === "yes";
      const resources = await this.resourceMonitorService.getResources({ forceRefresh });
      writeJsonResponse(res, 200, resources);
      return true;
    }

    if (method === "GET" && pathname === "/v1/system/storage") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (trustedCallerScope !== "owner_chief") {
        throw new BusinessRouteError(
          403,
          "FORBIDDEN_SCOPE",
          `Scope "${trustedCallerScope}" is not permitted to access /v1/system/storage.`,
        );
      }
      if (!this.storageQuotaService) {
        throw new BusinessRouteError(
          503,
          "STORAGE_QUOTA_UNAVAILABLE",
          "StorageQuotaService is not configured.",
        );
      }
      const refreshParam =
        requestUrl.searchParams.get("refresh") ?? requestUrl.searchParams.get("force");
      const refresh = refreshParam === "1" || refreshParam === "true" || refreshParam === "yes";
      const inventory = await this.storageQuotaService.getInventory({ refresh });
      writeJsonResponse(res, 200, inventory);
      return true;
    }

    if (method === "POST" && pathname === "/v1/system/storage/clean") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (trustedCallerScope !== "owner_chief") {
        throw new BusinessRouteError(
          403,
          "FORBIDDEN_SCOPE",
          `Scope "${trustedCallerScope}" is not permitted to clean local storage.`,
        );
      }
      if (!this.storageQuotaService) {
        throw new BusinessRouteError(
          503,
          "STORAGE_QUOTA_UNAVAILABLE",
          "StorageQuotaService is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      if (!isRecord(rawBody)) {
        throw new BusinessRouteError(400, "INVALID_PARAMS", "Request body must be a JSON object.");
      }
      const targetIds = Array.isArray(rawBody["targetIds"])
        ? rawBody["targetIds"].filter((v): v is string => typeof v === "string")
        : undefined;
      const actions = Array.isArray(rawBody["actions"])
        ? rawBody["actions"].filter((v): v is string => typeof v === "string")
        : undefined;
      const result = await this.storageQuotaService.clean({
        ...(targetIds !== undefined ? { targetIds } : {}),
        ...(actions !== undefined ? { actions } : {}),
      });
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (
      method === "POST" &&
      (pathname === "/v1/resources/host-metrics" ||
        pathname === "/v1/system/resources/host-metrics")
    ) {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (trustedCallerScope !== "owner_chief") {
        throw new BusinessRouteError(
          403,
          "FORBIDDEN_SCOPE",
          `Scope "${trustedCallerScope}" is not permitted to access ${pathname}.`,
        );
      }
      const rawBody = await readJsonBody(req);
      if (this.businessService) {
        const result = this.businessService.ingestHostResourceMetrics(rawBody, trustedCallerScope);
        writeJsonResponse(res, 200, result);
        return true;
      }
      if (!this.resourceMonitorService) {
        throw new BusinessRouteError(
          503,
          "RESOURCE_MONITOR_UNAVAILABLE",
          "ResourceMonitorService is not configured.",
        );
      }
      const normalized = normalizeHostMetricsReport(rawBody);
      if (!normalized) {
        throw new BusinessRouteError(
          400,
          "INVALID_HOST_METRICS",
          "Request body must contain valid mainPid, electronProcesses, or coreServer metrics.",
        );
      }
      const result = this.resourceMonitorService.ingestHostMetrics(normalized);
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (method === "POST" && pathname === "/v1/system/pty/kill") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (trustedCallerScope !== "owner_chief") {
        throw new BusinessRouteError(
          403,
          "FORBIDDEN_SCOPE",
          `Scope "${trustedCallerScope}" is not permitted to terminate PTY sessions.`,
        );
      }
      if (!this.resourceMonitorService) {
        throw new BusinessRouteError(
          503,
          "RESOURCE_MONITOR_UNAVAILABLE",
          "ResourceMonitorService is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      if (!isRecord(rawBody)) {
        writeJsonResponse(res, 400, {
          ok: false,
          sessionId: "",
          killed: false,
          removed: false,
          message: "请求体必须是 JSON 对象。",
          error: { code: "INVALID_PARAMS", message: "请求体必须是 JSON 对象。" },
        });
        return true;
      }
      const signal = typeof rawBody["signal"] === "string" ? rawBody["signal"] : undefined;
      const outcome = await this.resourceMonitorService.killPtySession(
        rawBody["sessionId"],
        signal,
      );
      writeJsonResponse(res, outcome.statusCode, {
        ...outcome.payload,
        ...(outcome.payload.ok
          ? {}
          : {
              error: {
                code: outcome.statusCode === 404 ? "PTY_NOT_FOUND" : "INVALID_PARAMS",
                message: outcome.payload.message,
              },
            }),
      });
      return true;
    }

    if (method === "GET" && pathname === "/v1/plugins/catalog") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const result = await this.businessService.getPluginsCatalog(trustedCallerScope);
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (method === "GET" && pathname === "/v1/plugins/installed") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const result = await this.businessService.getPluginsInstalled(trustedCallerScope);
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (method === "GET" && pathname === "/v1/plugins/logs") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const pluginIdParam = requestUrl.searchParams.get("pluginId");
      const limitParam = requestUrl.searchParams.get("limit");
      const parsedLimit =
        limitParam !== null && limitParam.trim().length > 0
          ? Number.parseInt(limitParam, 10)
          : null;
      const result = await this.businessService.getPluginLogs(
        pluginIdParam,
        parsedLimit !== null && Number.isFinite(parsedLimit) ? parsedLimit : null,
        trustedCallerScope,
      );
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (
      method === "POST" &&
      (pathname === "/v1/plugins/install" ||
        pathname === "/v1/plugins/install-official" ||
        pathname === "/v1/plugins/install-npm")
    ) {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const rawBody = await readJsonBody(req, MAX_IMPORT_JSON_BODY_BYTES);
      const normalizedBody =
        pathname === "/v1/plugins/install-official" && isRecord(rawBody)
          ? { ...rawBody, source: "official" }
          : pathname === "/v1/plugins/install-npm" && isRecord(rawBody)
            ? { ...rawBody, source: "npm" }
            : rawBody;
      const result = await this.businessService.installPlugin(normalizedBody, trustedCallerScope);
      this.diagnosticsService?.clearCache();
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (
      method === "POST" &&
      (pathname === "/v1/plugins/toggle" ||
        pathname === "/v1/plugins/enable" ||
        pathname === "/v1/plugins/disable")
    ) {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      const normalizedBody =
        pathname === "/v1/plugins/enable" && isRecord(rawBody)
          ? { ...rawBody, enabled: true }
          : pathname === "/v1/plugins/disable" && isRecord(rawBody)
            ? { ...rawBody, enabled: false }
            : rawBody;
      const result = await this.businessService.togglePlugin(normalizedBody, trustedCallerScope);
      this.diagnosticsService?.clearCache();
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (method === "POST" && pathname === "/v1/plugins/rollback") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      const result = await this.businessService.rollbackPlugin(rawBody, trustedCallerScope);
      this.diagnosticsService?.clearCache();
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (method === "POST" && pathname === "/v1/plugins/uninstall") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (!this.businessService) {
        throw new BusinessRouteError(
          503,
          "SERVICE_UNAVAILABLE",
          "Business routes service is not configured.",
        );
      }
      const rawBody = await readJsonBody(req);
      const result = await this.businessService.uninstallPlugin(rawBody, trustedCallerScope);
      this.diagnosticsService?.clearCache();
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (method === "PUT" && pathname === "/v1/updater/policy") {
      if (this.authenticateHttpRequest(req, res) === null) return true;
      const rawBody = await readJsonBody(req);
      const result = await this.executeUpdaterSetPolicy(rawBody);
      this.diagnosticsService?.clearCache();
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (pathname.startsWith("/v1/cli-updates/")) {
      if (!this.cliUpdateRouteService) {
        throw new BusinessRouteError(
          503,
          "CLI_UPDATES_UNAVAILABLE",
          "CliUpdateService is not configured.",
        );
      }
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;

      if (method === "GET" && pathname === "/v1/cli-updates/check") {
        const result = await this.cliUpdateRouteService.handleCheck(requestUrl.searchParams);
        writeJsonResponse(res, result.statusCode, result.payload);
        return true;
      }
      if (method === "POST" && pathname === "/v1/cli-updates/install") {
        const rawBody = await readJsonBody(req);
        const result = await this.cliUpdateRouteService.handleInstall(rawBody, trustedCallerScope);
        writeJsonResponse(res, result.statusCode, result.payload);
        return true;
      }
    }

    if (pathname.startsWith("/v1/overnight/")) {
      if (!this.overnightService) {
        throw new BusinessRouteError(
          503,
          "OVERNIGHT_UNAVAILABLE",
          "OvernightRouteService is not configured.",
        );
      }
      if (method === "GET" && pathname === "/v1/overnight/oauth/gmail/callback") {
        const callbackRes = await this.overnightService.handleGmailOAuthCallback(
          requestUrl.searchParams,
        );
        res.writeHead(callbackRes.statusCode, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(callbackRes.html);
        return true;
      }

      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;

      if (method === "GET" && pathname === "/v1/overnight/config") {
        const refreshFlag = requestUrl.searchParams.get("refresh");
        const forceProbe = refreshFlag === "1" || refreshFlag === "true";
        const snapshot = await this.overnightService.getConfigSnapshot(trustedCallerScope, {
          forceProbe,
        });
        writeJsonResponse(res, 200, snapshot);
        return true;
      }
      if (method === "GET" && pathname === "/v1/overnight/status") {
        const refreshFlag = requestUrl.searchParams.get("refresh");
        const forceProbe = refreshFlag === "1" || refreshFlag === "true";
        const status = await this.overnightService.getStatusSnapshot(trustedCallerScope, {
          forceProbe,
        });
        writeJsonResponse(res, 200, status);
        return true;
      }
      if (method === "PUT" && pathname === "/v1/overnight/config") {
        const rawBody = await readJsonBody(req);
        const snapshot = await this.overnightService.updateConfig(rawBody, trustedCallerScope);
        writeJsonResponse(res, 200, snapshot);
        return true;
      }
      if (
        method === "POST" &&
        (pathname === "/v1/overnight/test-mail" || pathname === "/v1/overnight/test-connection")
      ) {
        const rawBody = await readJsonBody(req);
        const result = await this.overnightService.testMailConnection(rawBody, trustedCallerScope);
        writeJsonResponse(res, 200, result);
        return true;
      }
      if (method === "POST" && pathname === "/v1/overnight/send-test-report") {
        const rawBody = await readJsonBody(req);
        const result = await this.overnightService.sendTestMorningReport(
          rawBody,
          trustedCallerScope,
        );
        writeJsonResponse(res, 200, result);
        return true;
      }
      if (method === "POST" && pathname === "/v1/overnight/poll-now") {
        const rawBody = await readJsonBody(req);
        const result = await this.overnightService.pollNow(rawBody, trustedCallerScope);
        writeJsonResponse(res, 200, result);
        return true;
      }
      if (method === "POST" && pathname === "/v1/overnight/run-now") {
        const rawBody = await readJsonBody(req);
        const result = await this.overnightService.runManualTask(rawBody, trustedCallerScope);
        writeJsonResponse(res, 200, result);
        return true;
      }
      if (method === "GET" && pathname === "/v1/overnight/tasks") {
        const result = this.overnightService.listTasks(trustedCallerScope);
        writeJsonResponse(res, 200, result);
        return true;
      }
      if (method === "POST" && pathname === "/v1/overnight/tasks") {
        const rawBody = await readJsonBody(req);
        const result = this.overnightService.createTask(rawBody, trustedCallerScope);
        writeJsonResponse(res, 201, result);
        return true;
      }
      const taskRunMatch = /^\/v1\/overnight\/tasks\/([^/]+)\/run$/.exec(pathname);
      if (method === "POST" && taskRunMatch?.[1]) {
        const rawBody = await readJsonBody(req);
        const result = await this.overnightService.runTaskById(
          decodeURIComponent(taskRunMatch[1]),
          rawBody,
          trustedCallerScope,
        );
        writeJsonResponse(res, 200, result);
        return true;
      }
      const taskItemMatch = /^\/v1\/overnight\/tasks\/([^/]+)$/.exec(pathname);
      if (taskItemMatch?.[1]) {
        const taskId = decodeURIComponent(taskItemMatch[1]);
        if (method === "PUT") {
          const rawBody = await readJsonBody(req);
          const result = this.overnightService.updateTask(taskId, rawBody, trustedCallerScope);
          writeJsonResponse(res, 200, result);
          return true;
        }
        if (method === "DELETE") {
          const result = this.overnightService.deleteTask(taskId, trustedCallerScope);
          writeJsonResponse(res, 200, result);
          return true;
        }
      }
      if (method === "GET" && pathname === "/v1/overnight/runs") {
        const limitParam = requestUrl.searchParams.get("limit");
        const parsedLimit =
          limitParam !== null && limitParam.trim().length > 0
            ? Number.parseInt(limitParam, 10)
            : null;
        const result = this.overnightService.getRuns(
          parsedLimit !== null && Number.isFinite(parsedLimit) ? parsedLimit : null,
          trustedCallerScope,
        );
        writeJsonResponse(res, 200, result);
        return true;
      }
      const runActionMatch = /^\/v1\/overnight\/runs\/([^/]+)\/(cancel|retry)$/.exec(pathname);
      if (method === "POST" && runActionMatch?.[1] && runActionMatch[2]) {
        const runId = decodeURIComponent(runActionMatch[1]);
        if (runActionMatch[2] === "cancel") {
          const result = this.overnightService.cancelRun(runId, trustedCallerScope);
          writeJsonResponse(res, 200, result);
          return true;
        }
        const rawBody = await readJsonBody(req);
        const result = await this.overnightService.retryRun(runId, rawBody, trustedCallerScope);
        writeJsonResponse(res, 200, result);
        return true;
      }
      const runItemMatch = /^\/v1\/overnight\/runs\/([^/]+)$/.exec(pathname);
      if (runItemMatch?.[1]) {
        const runId = decodeURIComponent(runItemMatch[1]);
        if (method === "GET") {
          const result = this.overnightService.getRunById(runId, trustedCallerScope);
          writeJsonResponse(res, 200, result);
          return true;
        }
        if (method === "DELETE") {
          const result = this.overnightService.deleteRun(runId, trustedCallerScope);
          writeJsonResponse(res, 200, result);
          return true;
        }
      }
      if (method === "POST" && pathname === "/v1/overnight/oauth/gmail/start") {
        const rawBody = await readJsonBody(req);
        const origin = this.boundPort !== undefined ? this.getHttpUrl() : requestUrl.origin;
        const result = await this.overnightService.startGmailOAuth(
          rawBody,
          trustedCallerScope,
          origin,
        );
        writeJsonResponse(res, 200, result);
        return true;
      }
      if (method === "POST" && pathname === "/v1/overnight/oauth/gmail/disconnect") {
        const result = await this.overnightService.disconnectGmail(trustedCallerScope);
        writeJsonResponse(res, 200, result);
        return true;
      }
    }

    if (method === "GET" && pathname === "/v1/providers/probe") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (trustedCallerScope !== "owner_chief") {
        throw new BusinessRouteError(
          403,
          "FORBIDDEN_SCOPE",
          `Scope "${trustedCallerScope}" is not permitted to access /v1/providers/probe.`,
        );
      }
      if (!this.providerProbeService) {
        throw new BusinessRouteError(
          503,
          "PROVIDER_PROBE_UNAVAILABLE",
          "PrismuxProviderProbeService is not configured.",
        );
      }
      const providerParam = requestUrl.searchParams.get("provider");
      const hasProvidersParam = requestUrl.searchParams.has("providers");
      const providersParam = hasProvidersParam
        ? (requestUrl.searchParams.get("providers") ?? "")
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p.length > 0)
        : undefined;
      const refreshParam = requestUrl.searchParams.get("refresh")?.trim().toLowerCase();
      const forceParam = requestUrl.searchParams.get("force")?.trim().toLowerCase();
      const includeAllParam = requestUrl.searchParams.get("includeAll")?.trim().toLowerCase();
      const deepScanParam = requestUrl.searchParams.get("deepScan")?.trim().toLowerCase();
      const refresh =
        refreshParam === "1" ||
        refreshParam === "true" ||
        forceParam === "1" ||
        forceParam === "true";
      const includeAll = includeAllParam === "1" || includeAllParam === "true";
      const deepScan = deepScanParam === "1" || deepScanParam === "true";
      const result = await this.providerProbeService.probeAll({
        provider: providerParam,
        ...(providersParam !== undefined ? { providers: providersParam } : {}),
        ...(includeAll ? { includeAll: true } : {}),
        ...(deepScan ? { deepScan: true } : {}),
        refresh,
      });
      writeJsonResponse(res, 200, result);
      return true;
    }

    if (pathname.startsWith("/v1/quota/")) {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      const quotaResponse = await handleQuotaRoute(
        {
          method,
          pathname,
          searchParams: requestUrl.searchParams,
          callerScope: trustedCallerScope,
        },
        this.quotaService,
      );
      if (quotaResponse !== null) {
        writeJsonResponse(res, quotaResponse.statusCode, quotaResponse.payload);
        return true;
      }
    }

    if (method === "GET" && pathname === "/v1/agent-aux/inspect") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res);
      if (trustedCallerScope === null) return true;
      if (trustedCallerScope !== "owner_chief") {
        writeJsonResponse(res, 403, {
          ok: false,
          error: {
            code: "FORBIDDEN_SCOPE",
            message: `Scope "${trustedCallerScope}" is not permitted to inspect agent aux state.`,
          },
        });
        return true;
      }
      try {
        const result = await this.agentAuxService.inspect({
          provider: requestUrl.searchParams.get("provider") ?? undefined,
          sessionId: requestUrl.searchParams.get("sessionId") ?? undefined,
          cwd: requestUrl.searchParams.get("cwd") ?? undefined,
          etag:
            requestUrl.searchParams.get("etag") ??
            (typeof req.headers["if-none-match"] === "string"
              ? req.headers["if-none-match"].replace(/^W\/|^"|"$/g, "")
              : undefined),
        });
        if (result.etag) {
          res.setHeader("ETag", result.etag);
        }
        writeJsonResponse(res, 200, result);
      } catch (err) {
        if (err instanceof AgentAuxValidationError) {
          writeJsonResponse(res, err.statusCode, {
            ok: false,
            error: { code: err.code, message: err.message },
          });
          return true;
        }
        throw err;
      }
      return true;
    }

    if (method === "GET" && pathname === "/v1/agent-aux/events") {
      const trustedCallerScope = this.authenticateHttpRequest(req, res, requestUrl, true);
      if (trustedCallerScope === null) return true;
      if (trustedCallerScope !== "owner_chief") {
        writeJsonResponse(res, 403, {
          ok: false,
          error: {
            code: "FORBIDDEN_SCOPE",
            message: `Scope "${trustedCallerScope}" is not permitted to stream agent aux events.`,
          },
        });
        return true;
      }
      const query = {
        provider: requestUrl.searchParams.get("provider") ?? undefined,
        sessionId: requestUrl.searchParams.get("sessionId") ?? undefined,
        cwd: requestUrl.searchParams.get("cwd") ?? undefined,
      };
      let initialSnapshot;
      try {
        initialSnapshot = await this.agentAuxService.inspect(query);
      } catch (err) {
        if (err instanceof AgentAuxValidationError) {
          writeJsonResponse(res, err.statusCode, {
            ok: false,
            error: { code: err.code, message: err.message },
          });
          return true;
        }
        throw err;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      let closed = false;
      let eventSeq = 0;
      const sendSnapshot = (payload: unknown): void => {
        if (closed || res.writableEnded || res.destroyed) return;
        eventSeq += 1;
        try {
          res.write(`id: ${eventSeq}\nevent: snapshot\ndata: ${JSON.stringify(payload)}\n\n`);
        } catch {
          cleanup(false);
        }
      };

      const watcher = this.agentAuxService.getWatcher();
      const unsubscribe = watcher.subscribe(
        query,
        (snapshot) => {
          sendSnapshot(snapshot);
        },
        initialSnapshot.etag ?? "",
      );

      const keepaliveTimer = setInterval(() => {
        if (closed || res.writableEnded || res.destroyed) {
          cleanup(false);
          return;
        }
        try {
          res.write(": ping\n\n");
        } catch {
          cleanup(false);
        }
      }, 25_000);
      keepaliveTimer.unref?.();

      const cleanup = (immediate: boolean): void => {
        if (closed) return;
        closed = true;
        clearInterval(keepaliveTimer);
        unsubscribe(immediate);
        this.activeSseCleanups.delete(onServerShutdown);
        try {
          if (!res.writableEnded) {
            res.end();
          }
        } catch {
          // Ignore stream shutdown errors.
        }
      };
      const onServerShutdown = (): void => {
        cleanup(true);
      };

      this.activeSseCleanups.add(onServerShutdown);
      req.once("close", () => cleanup(false));
      req.once("aborted", () => cleanup(false));
      res.once("close", () => cleanup(false));
      res.once("error", () => cleanup(false));

      sendSnapshot(initialSnapshot);
      return true;
    }

    if (isDispatchOrSecurityRoute(pathname)) {
      const allowQueryToken = method === "GET" && pathname === "/v1/dispatch/events";
      const trustedCallerScope = this.authenticateHttpRequest(
        req,
        res,
        requestUrl,
        allowQueryToken,
      );
      if (trustedCallerScope === null) return true;
      const handled = await handleDispatchRoute(
        {
          req,
          res,
          method,
          pathname,
          searchParams: requestUrl.searchParams,
          callerScope: trustedCallerScope,
          readJsonBody: () => readJsonBody(req),
          registerSseCleanup: (cleanup) => {
            this.activeSseCleanups.add(cleanup);
          },
          unregisterSseCleanup: (cleanup) => {
            this.activeSseCleanups.delete(cleanup);
          },
        },
        {
          waiverStore: this.subscriptionWaiverStore,
          policyStore: this.subscriptionWaiverStore,
          dispatchHub: this.dispatchHub,
        },
      );
      if (handled) {
        return true;
      }
    }

    return false;
  }

  private consumePairingExchangeQuota(
    req: IncomingMessage,
  ): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const clientIp = req.socket?.remoteAddress?.trim() || "unknown";
    const now = Date.now();
    const cutoff = now - this.pairingRateLimitWindowMs;

    if (this.pairingExchangeTimestampsByIp.size > 256) {
      for (const [ip, timestamps] of this.pairingExchangeTimestampsByIp.entries()) {
        const kept = timestamps.filter((ts) => ts > cutoff);
        if (kept.length === 0) {
          this.pairingExchangeTimestampsByIp.delete(ip);
        } else {
          this.pairingExchangeTimestampsByIp.set(ip, kept);
        }
      }
    }

    const existing = this.pairingExchangeTimestampsByIp.get(clientIp) ?? [];
    const recent = existing.filter((ts) => ts > cutoff);
    if (recent.length >= this.pairingRateLimitMaxRequests) {
      this.pairingExchangeTimestampsByIp.set(clientIp, recent);
      const oldest = recent[0] ?? now;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest + this.pairingRateLimitWindowMs - now) / 1000),
      );
      return { allowed: false, retryAfterSeconds };
    }

    recent.push(now);
    this.pairingExchangeTimestampsByIp.set(clientIp, recent);
    return { allowed: true };
  }

  private handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    wss: WebSocketServer,
  ): void {
    const rawOrigin = req.headers.origin;
    if (Array.isArray(rawOrigin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (typeof rawOrigin === "string" && !isAllowedCorsOrigin(rawOrigin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    let requestUrl: URL;
    try {
      requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    if (requestUrl.pathname !== "/rpc") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const token = extractRequestToken(req, requestUrl, true);
    const trustedScope = token !== null ? this.pairingManager.resolveTokenScope(token) : null;
    if (trustedScope === null) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    (req as IncomingMessage & { __prismuxCallerScope?: CallerScope }).__prismuxCallerScope =
      trustedScope;

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }

  private handleWsConnection(ws: WebSocket, trustedCallerScope: CallerScope): void {
    const ptySubscriptions = new Map<string, () => void>();

    const cleanupSubscriptions = () => {
      // Unsubscribing on WS disconnect must NEVER terminate running PTY child processes.
      for (const unsubscribe of ptySubscriptions.values()) {
        unsubscribe();
      }
      ptySubscriptions.clear();
    };

    this.activeSockets.add(ws);
    this.socketCleanups.set(ws, cleanupSubscriptions);

    const sendJson = (payload: unknown): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    ws.on("message", (rawData: WebSocket.RawData) => {
      void (async () => {
        let requestId = "unknown";
        try {
          const parsed = JSON.parse(rawDataToString(rawData)) as unknown;
          const envelope = this.parseRpcEnvelope(parsed);
          requestId = envelope.id;

          if (envelope.method === "pty.subscribe") {
            const ptyId = requireStringParam(envelope.params, "ptyId");
            const rawFromSeq = envelope.params.fromSeq;
            const fromSeq =
              typeof rawFromSeq === "number" && Number.isFinite(rawFromSeq) ? rawFromSeq : 0;

            const existingUnsub = ptySubscriptions.get(ptyId);
            if (existingUnsub !== undefined) {
              existingUnsub();
              ptySubscriptions.delete(ptyId);
            }

            const unsub = this.ptyPool.subscribe(
              ptyId,
              (frame) => {
                sendJson({ type: "pty.frame", frame });
              },
              { replayFromSeq: fromSeq },
            );
            ptySubscriptions.set(ptyId, unsub);

            sendJson({
              id: envelope.id,
              ok: true,
              result: { ptyId, subscribed: true },
            });
            return;
          }

          if (envelope.method === "pty.unsubscribe") {
            const ptyId = requireStringParam(envelope.params, "ptyId");
            const existingUnsub = ptySubscriptions.get(ptyId);
            if (existingUnsub !== undefined) {
              existingUnsub();
              ptySubscriptions.delete(ptyId);
            }
            sendJson({
              id: envelope.id,
              ok: true,
              result: { ptyId, unsubscribed: existingUnsub !== undefined },
            });
            return;
          }

          const outcome = await this.executeRpc(envelope, trustedCallerScope);
          sendJson(outcome.response);
          outcome.afterSend?.();
        } catch (error) {
          const code = error instanceof RpcDispatchError ? error.code : "rpc_error";
          const message = error instanceof Error ? error.message : String(error);
          sendJson({
            id: requestId,
            ok: false,
            error: { code, message },
          });
        }
      })();
    });

    ws.on("close", () => {
      cleanupSubscriptions();
      this.socketCleanups.delete(ws);
      this.activeSockets.delete(ws);
    });

    ws.on("error", () => {
      cleanupSubscriptions();
      this.socketCleanups.delete(ws);
      this.activeSockets.delete(ws);
    });
  }

  private async executeMemoryQuery(
    rawParams: unknown,
    trustedCallerScope: CallerScope,
  ): Promise<MemoryQueryResponse> {
    if (this.memoryStore === undefined) {
      throw new RpcDispatchError("not_configured", "Memory store is not configured.", 503);
    }
    if (!isRecord(rawParams)) {
      throw new RpcDispatchError("invalid_params", "Memory query payload must be a JSON object.");
    }

    const query = rawParams.query;
    if (typeof query !== "string") {
      throw new RpcDispatchError("invalid_params", 'Parameter "query" must be a string.');
    }

    const namespaces = parseOptionalStringArray(rawParams.namespaces, "namespaces") as
      | MemoryNamespace[]
      | undefined;

    const kindsRaw = parseOptionalStringArray(rawParams.kinds, "kinds");
    let kinds: MemoryKind[] | undefined;
    if (kindsRaw !== undefined) {
      for (const kind of kindsRaw) {
        if (!MEMORY_KINDS.includes(kind as MemoryKind)) {
          throw new RpcDispatchError("invalid_params", `Invalid memory kind: "${kind}".`);
        }
      }
      kinds = kindsRaw as MemoryKind[];
    }

    let limit: number | undefined;
    if (rawParams.limit !== undefined) {
      limit = requirePositiveIntParam(rawParams, "limit");
    }

    const modeRaw = optionalStringParam(rawParams, "mode");
    let mode: MemoryQueryRequest["mode"];
    if (modeRaw !== undefined) {
      if (modeRaw !== "hybrid" && modeRaw !== "fts" && modeRaw !== "vector") {
        throw new RpcDispatchError("invalid_params", `Invalid query mode: "${modeRaw}".`);
      }
      mode = modeRaw;
    }

    const queryEmbedding = parseOptionalEmbedding(rawParams.queryEmbedding ?? rawParams.embedding);

    // Transport-layer override: unconditionally enforce server-authenticated callerScope
    // and ignore any client-supplied callerScope / _callerScope fields.
    const boundRequest = this.identityGuard.bindCallerScope(trustedCallerScope, {
      query,
      ...(namespaces !== undefined ? { namespaces } : {}),
      ...(kinds !== undefined ? { kinds } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(mode !== undefined ? { mode } : {}),
    });

    return this.memoryStore.query(boundRequest, trustedCallerScope, queryEmbedding);
  }

  private async executeMemoryUpsert(rawParams: unknown, trustedCallerScope: CallerScope) {
    if (this.memoryStore === undefined) {
      throw new RpcDispatchError("not_configured", "Memory store is not configured.", 503);
    }
    if (!isRecord(rawParams)) {
      throw new RpcDispatchError("invalid_params", "Memory upsert payload must be a JSON object.");
    }

    const id = optionalStringParam(rawParams, "id");
    const namespaceRaw = requireStringParam(rawParams, "namespace");
    if (!isValidMemoryNamespace(namespaceRaw)) {
      throw new RpcDispatchError("invalid_params", `Invalid memory namespace: "${namespaceRaw}".`);
    }

    if (!isScopeAllowedForNamespace(trustedCallerScope, namespaceRaw)) {
      throw new RpcDispatchError(
        "forbidden",
        `Caller scope "${trustedCallerScope}" is not authorized to write namespace "${namespaceRaw}".`,
        403,
      );
    }

    const kindRaw = requireStringParam(rawParams, "kind");
    if (!MEMORY_KINDS.includes(kindRaw as MemoryKind)) {
      throw new RpcDispatchError("invalid_params", `Invalid memory kind: "${kindRaw}".`);
    }

    const title = requireStringParam(rawParams, "title");
    const contentValue = rawParams.content;
    if (typeof contentValue !== "string") {
      throw new RpcDispatchError("invalid_params", 'Parameter "content" must be a string.');
    }

    const sourceRefRaw = rawParams.sourceRef;
    let sourceRef: string | null | undefined;
    if (sourceRefRaw === null || sourceRefRaw === undefined) {
      sourceRef = sourceRefRaw;
    } else if (typeof sourceRefRaw === "string") {
      sourceRef = sourceRefRaw;
    } else {
      throw new RpcDispatchError(
        "invalid_params",
        'Parameter "sourceRef" must be a string or null.',
      );
    }

    let importance: number | undefined;
    if (rawParams.importance !== undefined) {
      if (typeof rawParams.importance !== "number" || !Number.isFinite(rawParams.importance)) {
        throw new RpcDispatchError(
          "invalid_params",
          'Parameter "importance" must be a finite number.',
        );
      }
      importance = rawParams.importance;
    }

    const machineId = optionalStringParam(rawParams, "machineId") ?? this.machineId;
    const embedding = parseOptionalEmbedding(rawParams.embedding);

    const input: MemoryUpsertInput = {
      ...(id !== undefined ? { id } : {}),
      namespace: namespaceRaw,
      kind: kindRaw as MemoryKind,
      title,
      content: contentValue,
      ...(sourceRef !== undefined ? { sourceRef } : {}),
      ...(importance !== undefined ? { importance } : {}),
      machineId,
    };

    return this.memoryStore.upsert(input, embedding);
  }

  private parseRpcEnvelope(raw: unknown): RpcPayloadEnvelope {
    if (!isRecord(raw)) {
      throw new RpcDispatchError("invalid_request", "RPC payload must be a JSON object.");
    }
    const id = raw.id;
    const method = raw.method;
    if (typeof id !== "string" || id.length === 0) {
      throw new RpcDispatchError(
        "invalid_request",
        'RPC payload requires non-empty string field "id".',
      );
    }
    if (typeof method !== "string" || method.length === 0) {
      throw new RpcDispatchError(
        "invalid_request",
        'RPC payload requires non-empty string field "method".',
      );
    }
    const rawParams = raw.params;
    const params = isRecord(rawParams) ? rawParams : {};
    return { id, method, params };
  }

  private async executeRpc(
    envelope: RpcPayloadEnvelope,
    trustedCallerScope: CallerScope,
  ): Promise<{
    response:
      | { id: string; ok: true; result: unknown }
      | { id: string; ok: false; error: { code: string; message: string } };
    afterSend?: () => void;
  }> {
    try {
      const { method, params } = envelope;

      switch (method) {
        case "pty.list": {
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { sessions: this.ptyPool.listSessions() },
            },
          };
        }

        case "pty.spawn": {
          const args = parseOptionalStringArray(params.args, "args");
          const rawGroup = params.group;
          const group =
            rawGroup === "agent-scratch" || rawGroup === "default" ? rawGroup : undefined;

          const session = this.ptyPool.spawnSession({
            ptyId: optionalStringParam(params, "ptyId"),
            cwd: optionalStringParam(params, "cwd"),
            command: optionalStringParam(params, "command"),
            args,
            group,
            worktreeBranch: optionalStringParam(params, "worktreeBranch"),
          });
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { session },
            },
          };
        }

        case "pty.write": {
          const ptyId = requireStringParam(params, "ptyId");
          const data = params.data;
          if (typeof data !== "string") {
            throw new RpcDispatchError("invalid_params", 'Parameter "data" must be a string.');
          }
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { accepted: this.ptyPool.write(ptyId, data) },
            },
          };
        }

        case "pty.resize": {
          const ptyId = requireStringParam(params, "ptyId");
          const cols = requirePositiveIntParam(params, "cols");
          const rows = requirePositiveIntParam(params, "rows");
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { resized: this.ptyPool.resize(ptyId, cols, rows) },
            },
          };
        }

        case "pty.kill": {
          const ptyId = requireStringParam(params, "ptyId");
          const signal = optionalStringParam(params, "signal");
          const killed = await this.ptyPool.kill(ptyId, signal);
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { killed },
            },
          };
        }

        case "pty.replay": {
          const ptyId = requireStringParam(params, "ptyId");
          const rawFromSeq = params.fromSeq;
          const fromSeq =
            typeof rawFromSeq === "number" && Number.isFinite(rawFromSeq) ? rawFromSeq : 0;
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: this.ptyPool.replay(ptyId, fromSeq),
            },
          };
        }

        case "pty.scanScratch": {
          const repoRoot = requireStringParam(params, "repoRoot");
          const scanResult = await this.ptyPool.scanAgentScratchWorktrees(repoRoot);
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: {
                repoRoot: scanResult.repoRoot,
                discoveredWorktrees: scanResult.discoveredWorktrees,
                sessions: scanResult.sessions,
              },
            },
          };
        }

        case "pty.adoptScratch": {
          const ptyId = requireStringParam(params, "ptyId");
          const projectName = optionalStringParam(params, "projectName");
          const adopted = this.ptyPool.adoptScratchWorktree(ptyId, projectName);
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: adopted,
            },
          };
        }

        case "chief.status": {
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { slot: this.chiefManager.getSlot() },
            },
          };
        }

        case "chief.switchProvider": {
          const provider = requireStringParam(params, "provider") as ChiefProviderKind;
          const model = optionalStringParam(params, "model");
          const reasoningEffort =
            optionalStringParam(params, "reasoningEffort") ??
            optionalStringParam(params, "defaultEffort");
          const secretaryName = optionalStringParam(params, "secretaryName");
          const slot = await this.chiefManager.switchProvider(
            provider,
            model,
            reasoningEffort,
            secretaryName !== undefined ? { secretaryName } : undefined,
          );
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { slot },
            },
          };
        }

        case "t3.status": {
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { status: this.getCoreBridgeStatus() },
            },
          };
        }

        case "plugins.list": {
          if (this.pluginHost === undefined) {
            throw new RpcDispatchError("not_configured", "Plugin host is not configured.");
          }
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { plugins: this.pluginHost.listInstalled() },
            },
          };
        }

        case "plugins.toggle": {
          const pluginId = requireStringParam(params, "pluginId");
          const enabled = requireBooleanParam(params, "enabled");
          if (this.onTogglePlugin !== undefined) {
            const toggled = await this.onTogglePlugin(pluginId, enabled);
            return {
              response: {
                id: envelope.id,
                ok: true,
                result: toggled,
              },
            };
          }
          if (this.pluginHost === undefined) {
            throw new RpcDispatchError("not_configured", "Plugin host is not configured.");
          }
          const existing = this.pluginHost.getRecord(pluginId);
          if (existing === undefined) {
            throw new RpcDispatchError("not_found", `Plugin "${pluginId}" is not installed.`);
          }
          if (enabled) {
            throw new RpcDispatchError(
              "not_configured",
              `Cannot enable plugin "${pluginId}" without daemon plugin toggle handler.`,
            );
          }
          await this.pluginHost.unmountPlugin(pluginId);
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { pluginId, enabled: false },
            },
          };
        }

        case "memory.query": {
          const result = await this.executeMemoryQuery(params, trustedCallerScope);
          return {
            response: {
              id: envelope.id,
              ok: true,
              result,
            },
          };
        }

        case "memory.upsert": {
          const entry = await this.executeMemoryUpsert(params, trustedCallerScope);
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { id: entry.id, updatedAt: entry.updatedAt },
            },
          };
        }

        case "handoff.execute": {
          if (this.handoffEngine === undefined) {
            throw new RpcDispatchError("not_configured", "HandoffEngine is not configured.");
          }
          const sourceThreadId = requireStringParam(params, "sourceThreadId");
          const rawDial = optionalStringParam(params, "targetDialMode");
          let targetDialMode: DialMode | undefined;
          if (rawDial !== undefined) {
            if (!(DIAL_MODES as readonly string[]).includes(rawDial)) {
              throw new RpcDispatchError("invalid_params", `Invalid targetDialMode: "${rawDial}".`);
            }
            targetDialMode = rawDial as DialMode;
          }
          const targetWorkspace = optionalStringParam(params, "targetWorkspace");
          const targetBranch = optionalStringParam(params, "targetBranch");
          const additionalContext = optionalStringParam(params, "additionalContext");
          const rawTranscript = params.transcript;
          let transcript: HandoffTranscriptMessage[] | undefined;
          if (rawTranscript !== undefined) {
            if (!Array.isArray(rawTranscript)) {
              throw new RpcDispatchError(
                "invalid_params",
                'Parameter "transcript" must be an array.',
              );
            }
            transcript = rawTranscript.filter(
              (item): item is HandoffTranscriptMessage =>
                isRecord(item) && typeof item.role === "string" && typeof item.content === "string",
            );
          }

          let effectiveAdditionalContext = additionalContext;
          try {
            const chiefSlot = this.chiefManager.getSlot();
            if (sourceThreadId === chiefSlot.threadId) {
              const chiefCtx = this.chiefManager.buildChiefSystemContext();
              effectiveAdditionalContext = effectiveAdditionalContext
                ? `${effectiveAdditionalContext}\n\n${chiefCtx.systemPrompt}`
                : chiefCtx.systemPrompt;
            }
          } catch {
            // Chief slot not initialized; continue with caller-supplied additionalContext.
          }

          const result = await this.handoffEngine.executeHandoff({
            sourceThreadId,
            ...(targetDialMode !== undefined ? { targetDialMode } : {}),
            ...(targetWorkspace !== undefined ? { targetWorkspace } : {}),
            ...(targetBranch !== undefined ? { targetBranch } : {}),
            ...(effectiveAdditionalContext !== undefined
              ? { additionalContext: effectiveAdditionalContext }
              : {}),
            ...(transcript !== undefined ? { transcript } : {}),
          });
          return {
            response: {
              id: envelope.id,
              ok: true,
              result,
            },
          };
        }

        case "dial.setMode": {
          if (this.handoffEngine === undefined) {
            throw new RpcDispatchError("not_configured", "HandoffEngine is not configured.");
          }
          const threadId = requireStringParam(params, "threadId");
          const modeRaw = requireStringParam(params, "mode");
          if (!(DIAL_MODES as readonly string[]).includes(modeRaw)) {
            throw new RpcDispatchError("invalid_params", `Invalid dial mode: "${modeRaw}".`);
          }
          const mode = this.handoffEngine.setDialMode(threadId, modeRaw as DialMode);
          try {
            if (this.chiefManager.getSlot().threadId === threadId) {
              this.chiefManager.setDialMode(mode);
            }
          } catch {
            // Chief slot not initialized; skip disk persistence.
          }
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { threadId, mode },
            },
          };
        }

        case "hooks.decideApproval": {
          if (this.hookBus === undefined) {
            throw new RpcDispatchError("not_configured", "LifecycleHookBus is not configured.");
          }
          const requestId = requireStringParam(params, "requestId");
          const allow = requireBooleanParam(params, "allow");
          const reason = optionalStringParam(params, "reason");
          const record = this.hookBus.recordApprovalDecision(requestId, allow, reason);
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: {
                requestId: record.requestId,
                accepted: true,
                status: record.status,
              },
            },
          };
        }

        case "updater.status": {
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: this.requireAppUpdater().getStatus(),
            },
          };
        }

        case "updater.probe": {
          const report = await this.requireAppUpdater().probeSources();
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: report,
            },
          };
        }

        case "updater.check": {
          const result = await this.executeUpdaterCheck(params);
          return {
            response: {
              id: envelope.id,
              ok: true,
              result,
            },
          };
        }

        case "updater.setPolicy": {
          const policy = this.executeUpdaterSetPolicy(params);
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { policy },
            },
          };
        }

        case "updater.download": {
          const result = await this.executeUpdaterDownload(params);
          return {
            response: {
              id: envelope.id,
              ok: true,
              result,
            },
          };
        }

        case "daemon.shutdown": {
          const reason = optionalStringParam(params, "reason");
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { shuttingDown: true },
            },
            afterSend: () => {
              setImmediate(() => {
                void this.onRequestShutdown?.(reason);
              });
            },
          };
        }

        default: {
          throw new RpcDispatchError(
            "method_not_found",
            `Unknown or unimplemented RPC method: ${method}`,
          );
        }
      }
    } catch (error) {
      const code = error instanceof RpcDispatchError ? error.code : "rpc_error";
      const message = error instanceof Error ? error.message : String(error);
      return {
        response: {
          id: envelope.id,
          ok: false,
          error: { code, message },
        },
      };
    }
  }

  private handleUpdaterSseStream(req: IncomingMessage, res: ServerResponse): void {
    const updater = this.requireAppUpdater();

    req.socket?.setTimeout?.(0);
    req.socket?.setNoDelay?.(true);
    req.socket?.setKeepAlive?.(true, 15_000);
    res.setTimeout?.(0);

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.flushHeaders?.();

    let seq = 0;
    let closed = false;

    const sendEvent = (eventName: string, payload: unknown): void => {
      if (closed || res.writableEnded || res.destroyed) {
        return;
      }
      seq += 1;
      try {
        res.write(`id: ${seq}\nevent: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {
        cleanup();
      }
    };

    const unsubscribe = updater.subscribeEvents((evt) => {
      sendEvent(evt.type, evt);
    });

    const keepaliveTimer = setInterval(() => {
      if (closed || res.writableEnded || res.destroyed) {
        cleanup();
        return;
      }
      try {
        res.write(": keepalive\n\n");
      } catch {
        cleanup();
      }
    }, 20_000);
    keepaliveTimer.unref?.();

    const cleanup = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(keepaliveTimer);
      unsubscribe();
      this.activeSseCleanups.delete(cleanup);
      try {
        if (!res.writableEnded) {
          res.end();
        }
      } catch {
        // Ignore stream shutdown errors.
      }
    };

    this.activeSseCleanups.add(cleanup);
    req.once("close", cleanup);
    req.once("aborted", cleanup);
    res.once("close", cleanup);
    res.once("error", cleanup);

    const initialStatus = updater.getStatus();
    sendEvent("status", {
      type: "status",
      timestamp: Date.now(),
      installState: initialStatus.installState,
      progress: initialStatus.progress,
      downloadedFilePath: initialStatus.downloadedFilePath,
      downloadedSha256: initialStatus.downloadedSha256,
      portableMode: initialStatus.portableMode,
      status: initialStatus,
    });
  }

  private requireAppUpdater(): AppUpdater {
    if (this.appUpdater === undefined) {
      throw new RpcDispatchError("not_configured", "AppUpdater is not configured.", 503);
    }
    return this.appUpdater;
  }

  private async executeUpdaterCheck(rawParams: unknown) {
    const updater = this.requireAppUpdater();
    if (!isRecord(rawParams)) {
      throw new RpcDispatchError("invalid_params", "Updater check payload must be a JSON object.");
    }
    const channelRaw = optionalStringParam(rawParams, "channel");
    let channel: UpdateChannel | undefined;
    if (channelRaw !== undefined) {
      if (!(UPDATE_CHANNELS as readonly string[]).includes(channelRaw)) {
        throw new RpcDispatchError("invalid_params", `Invalid update channel: "${channelRaw}".`);
      }
      channel = channelRaw as UpdateChannel;
    }

    const sourceRaw = optionalStringParam(rawParams, "sourceOverride");
    let sourceOverride: UpdateSourceId | undefined;
    if (sourceRaw !== undefined) {
      if (!(UPDATE_SOURCE_IDS as readonly string[]).includes(sourceRaw)) {
        throw new RpcDispatchError(
          "invalid_params",
          `Invalid update sourceOverride: "${sourceRaw}".`,
        );
      }
      sourceOverride = sourceRaw as UpdateSourceId;
    }

    return updater.checkForUpdates({
      ...(channel !== undefined ? { channel } : {}),
      ...(sourceOverride !== undefined ? { sourceOverride } : {}),
    });
  }

  private executeUpdaterSetPolicy(rawParams: unknown) {
    const updater = this.requireAppUpdater();
    if (!isRecord(rawParams)) {
      throw new RpcDispatchError("invalid_params", "Updater policy payload must be a JSON object.");
    }

    const patch: UpdatePolicyPatch = {};
    if (rawParams.routePreference !== undefined) {
      const routeRaw = requireStringParam(rawParams, "routePreference");
      if (!(NETWORK_ROUTE_PREFERENCES as readonly string[]).includes(routeRaw)) {
        throw new RpcDispatchError("invalid_params", `Invalid routePreference: "${routeRaw}".`);
      }
      patch.routePreference = routeRaw as NetworkRoutePreference;
    }
    if (rawParams.includePrerelease !== undefined) {
      patch.includePrerelease = requireBooleanParam(rawParams, "includePrerelease");
    }
    if (rawParams.customGhProxyPrefix !== undefined) {
      if (typeof rawParams.customGhProxyPrefix !== "string") {
        throw new RpcDispatchError(
          "invalid_params",
          'Parameter "customGhProxyPrefix" must be a string.',
        );
      }
      patch.customGhProxyPrefix = rawParams.customGhProxyPrefix;
    }
    if (rawParams.pluginRegistryOverride !== undefined) {
      const regRaw = requireStringParam(rawParams, "pluginRegistryOverride");
      if (regRaw !== "auto" && !(PLUGIN_REGISTRY_IDS as readonly string[]).includes(regRaw)) {
        throw new RpcDispatchError(
          "invalid_params",
          `Invalid pluginRegistryOverride: "${regRaw}".`,
        );
      }
      patch.pluginRegistryOverride = regRaw as PluginRegistryOverride;
    }
    if (rawParams.timeoutMs !== undefined) {
      patch.timeoutMs = requirePositiveIntParam(rawParams, "timeoutMs");
    }
    if (rawParams.autoCheckEnabled !== undefined) {
      patch.autoCheckEnabled = requireBooleanParam(rawParams, "autoCheckEnabled");
    }

    try {
      return updater.setPolicy(patch);
    } catch (error) {
      throw new RpcDispatchError(
        "invalid_params",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async executeUpdaterDownload(rawParams: unknown) {
    const updater = this.requireAppUpdater();
    if (!isRecord(rawParams)) {
      throw new RpcDispatchError(
        "invalid_params",
        "Updater download payload must be a JSON object.",
      );
    }

    const destDir = optionalStringParam(rawParams, "destDir");
    const assetName = optionalStringParam(rawParams, "assetName");
    const kindRaw = optionalStringParam(rawParams, "kind");
    let kind: UpdatePackageKind | undefined;
    if (kindRaw !== undefined) {
      if (kindRaw !== "setup-exe" && kindRaw !== "portable-zip" && kindRaw !== "split-7z-exe") {
        throw new RpcDispatchError("invalid_params", `Invalid update package kind: "${kindRaw}".`);
      }
      kind = kindRaw;
    }

    const sourceRaw = optionalStringParam(rawParams, "sourceOverride");
    let sourceOverride: UpdateSourceId | undefined;
    if (sourceRaw !== undefined) {
      if (!(UPDATE_SOURCE_IDS as readonly string[]).includes(sourceRaw)) {
        throw new RpcDispatchError(
          "invalid_params",
          `Invalid update sourceOverride: "${sourceRaw}".`,
        );
      }
      sourceOverride = sourceRaw as UpdateSourceId;
    }

    return updater.downloadUpdate({
      ...(destDir !== undefined ? { destDir } : {}),
      ...(assetName !== undefined ? { assetName } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(sourceOverride !== undefined ? { sourceOverride } : {}),
    });
  }
}
