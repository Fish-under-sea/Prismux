import { Buffer } from "node:buffer";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import type { CordisPluginHost } from "@prismux/cordis-kernel";
import {
  ForwardIdentityGuard,
  type ObsidianVaultImporterImpl,
  type SqliteMemoryStore
} from "@prismux/memory-core";
import {
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
  type T3BridgeStatus,
  type UpdateChannel,
  type UpdatePackageKind,
  type UpdatePolicyPatch,
  type UpdateSourceId
} from "@prismux/protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { ChiefThreadManager } from "../chief/ChiefThreadManager.js";
import type {
  HandoffEngine,
  HandoffTranscriptMessage
} from "../handoff/HandoffEngine.js";
import type { LifecycleHookBus } from "../hooks/LifecycleHookBus.js";
import type { PersistentPtyPool } from "../pty/PersistentPtyPool.js";
import type { T3RpcClient } from "../t3/T3RpcClient.js";
import type { T3ServerSupervisor } from "../t3/T3ServerSupervisor.js";
import type { AppUpdater } from "../updater/AppUpdater.js";
import type { PairingManager } from "./PairingManager.js";

const MAX_JSON_BODY_BYTES = 1024 * 1024;

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
    enabled: boolean
  ) => Promise<{ pluginId: string; enabled: boolean }>;
  appUpdater?: AppUpdater;
  memoryStore?: SqliteMemoryStore;
  obsidianImporter?: ObsidianVaultImporterImpl;
  handoffEngine?: HandoffEngine;
  hookBus?: LifecycleHookBus;
  t3Supervisor?: T3ServerSupervisor;
  t3RpcClient?: T3RpcClient;
  startedAt?: number;
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

function extractRequestToken(
  req: IncomingMessage,
  requestUrl: URL,
  allowQueryToken: boolean
): string | null {
  const bearer = extractBearerToken(req);
  if (bearer !== null) {
    return bearer;
  }
  if (allowQueryToken) {
    const queryToken = requestUrl.searchParams.get("token")?.trim();
    if (queryToken !== undefined && queryToken.length > 0) {
      return queryToken;
    }
  }
  return null;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buf =
      typeof chunk === "string" ? Buffer.from(chunk, "utf8") : (chunk as Buffer);
    totalBytes += buf.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new RpcDispatchError(
        "payload_too_large",
        `Request body exceeded ${MAX_JSON_BODY_BYTES} bytes.`,
        413
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

function writeJsonResponse(
  res: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  const body = `${JSON.stringify(payload)}\n`;
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body, "utf8"))
  });
  res.end(body);
}

function requireStringParam(
  params: Record<string, unknown>,
  key: string
): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new RpcDispatchError(
      "invalid_params",
      `Parameter "${key}" must be a non-empty string.`
    );
  }
  return value;
}

function optionalStringParam(
  params: Record<string, unknown>,
  key: string
): string | undefined {
  const value = params[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new RpcDispatchError(
      "invalid_params",
      `Parameter "${key}" must be a string.`
    );
  }
  return value;
}

function requireBooleanParam(
  params: Record<string, unknown>,
  key: string
): boolean {
  const value = params[key];
  if (typeof value !== "boolean") {
    throw new RpcDispatchError(
      "invalid_params",
      `Parameter "${key}" must be a boolean.`
    );
  }
  return value;
}

function requirePositiveIntParam(
  params: Record<string, unknown>,
  key: string
): number {
  const value = params[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new RpcDispatchError(
      "invalid_params",
      `Parameter "${key}" must be a positive number.`
    );
  }
  return Math.floor(value);
}

function parseOptionalEmbedding(raw: unknown): number[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(raw) ||
    raw.some((v) => typeof v !== "number" || !Number.isFinite(v))
  ) {
    throw new RpcDispatchError(
      "invalid_params",
      'Parameter "embedding" must be an array of finite numbers.'
    );
  }
  return raw as number[];
}

function parseOptionalStringArray(
  raw: unknown,
  key: string
): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
    throw new RpcDispatchError(
      "invalid_params",
      `Parameter "${key}" must be an array of strings.`
    );
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
    | ((
        pluginId: string,
        enabled: boolean
      ) => Promise<{ pluginId: string; enabled: boolean }>)
    | undefined;
  private readonly appUpdater: AppUpdater | undefined;
  private readonly memoryStore: SqliteMemoryStore | undefined;
  private readonly obsidianImporter: ObsidianVaultImporterImpl | undefined;
  private readonly handoffEngine: HandoffEngine | undefined;
  private readonly hookBus: LifecycleHookBus | undefined;
  private readonly identityGuard = new ForwardIdentityGuard();
  private readonly t3Supervisor: T3ServerSupervisor | undefined;
  private readonly t3RpcClient: T3RpcClient | undefined;
  private readonly startedAt: number;
  private readonly onRequestShutdown:
    | ((reason?: string) => void | Promise<void>)
    | undefined;

  private httpServer: Server | undefined;
  private wss: WebSocketServer | undefined;
  private boundPort: number | undefined;
  private activeStartPromise: Promise<void> | undefined;
  private activeStopPromise: Promise<void> | undefined;
  private readonly activeSockets = new Set<WebSocket>();
  private readonly socketCleanups = new Map<WebSocket, () => void>();

  constructor(options: DaemonRpcServerOptions) {
    this.host = options.host ?? "127.0.0.1";
    this.requestedPort = options.port ?? 0;
    this.headless = options.headless;
    this.version = options.version ?? "0.0.1-alpha.1";
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
    this.t3Supervisor = options.t3Supervisor;
    this.t3RpcClient = options.t3RpcClient;
    this.startedAt = options.startedAt ?? Date.now();
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
    const supervisorStatus = this.t3Supervisor?.getStatus();
    const rpcStatus = this.t3RpcClient?.getStatus();
    return {
      ok: true,
      headless: this.headless,
      version: this.version,
      t3Connected: rpcStatus?.connected ?? false,
      supervisorState: supervisorStatus?.state ?? "stopped",
      activeProvider: this.chiefManager.getSlot().activeProvider,
      ptyCount: this.ptyPool.listSessions().length,
      uptimeMs: Math.max(0, Date.now() - this.startedAt)
    };
  }

  getT3BridgeStatus(): T3BridgeStatus {
    const supervisorStatus = this.t3Supervisor?.getStatus();
    const rpcStatus = this.t3RpcClient?.getStatus();
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
          : {})
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
        (req as IncomingMessage & { __prismuxCallerScope?: CallerScope })
          .__prismuxCallerScope ?? "owner_chief";
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
    res: ServerResponse
  ): CallerScope | null {
    const token = extractBearerToken(req);
    const trustedScope =
      token !== null ? this.pairingManager.resolveTokenScope(token) : null;
    if (trustedScope === null) {
      writeJsonResponse(res, 401, {
        ok: false,
        error: {
          code: "unauthorized",
          message: "Missing or invalid Bearer token."
        }
      });
      return null;
    }
    return trustedScope;
  }

  private async handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    let requestUrl: URL;
    try {
      requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      writeJsonResponse(res, 400, {
        ok: false,
        error: { code: "invalid_url", message: "Malformed request URL." }
      });
      return;
    }
    const method = req.method?.toUpperCase() ?? "GET";

    try {
      if (method === "GET" && requestUrl.pathname === "/health") {
        writeJsonResponse(res, 200, this.getHealthResponse());
        return;
      }

      if (method === "POST" && requestUrl.pathname === "/v1/pair/exchange") {
        const body = await readJsonBody(req);
        if (!isRecord(body) || typeof body.pairingCode !== "string") {
          writeJsonResponse(res, 400, {
            ok: false,
            error: {
              code: "invalid_params",
              message: "pairingCode must be a string."
            }
          });
          return;
        }
        const deviceLabel =
          typeof body.deviceLabel === "string" ? body.deviceLabel : undefined;
        const exchanged = this.pairingManager.exchangePairingCode(
          body.pairingCode,
          deviceLabel
        );
        if (exchanged === null) {
          writeJsonResponse(res, 401, {
            ok: false,
            error: {
              code: "unauthorized",
              message: "Invalid, used, or expired pairing code."
            }
          });
          return;
        }
        writeJsonResponse(res, 200, {
          token: exchanged.token,
          daemonUrl: this.getHttpUrl(),
          wsUrl: this.getWsUrl(),
          deviceLabel: exchanged.deviceLabel,
          issuedAt: exchanged.issuedAt
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
          entry
        });
        return;
      }

      if (
        method === "POST" &&
        requestUrl.pathname === "/v1/memory/import-obsidian"
      ) {
        const trustedCallerScope = this.authenticateHttpRequest(req, res);
        if (trustedCallerScope === null) {
          return;
        }
        if (trustedCallerScope !== "owner_chief") {
          writeJsonResponse(res, 403, {
            ok: false,
            error: {
              code: "forbidden",
              message: "Only owner_chief callerScope may import an Obsidian vault."
            }
          });
          return;
        }
        if (this.obsidianImporter === undefined) {
          throw new RpcDispatchError(
            "not_configured",
            "Obsidian importer is not configured.",
            503
          );
        }
        const rawBody = await readJsonBody(req);
        if (!isRecord(rawBody)) {
          throw new RpcDispatchError(
            "invalid_params",
            "Request body must be a JSON object."
          );
        }
        const vaultPath = requireStringParam(rawBody, "vaultPath");
        const targetNsRaw = optionalStringParam(rawBody, "targetNamespace");
        let targetNamespace: MemoryNamespace | undefined;
        if (targetNsRaw !== undefined) {
          if (!isValidMemoryNamespace(targetNsRaw)) {
            throw new RpcDispatchError(
              "invalid_params",
              `Invalid targetNamespace: "${targetNsRaw}".`
            );
          }
          targetNamespace = targetNsRaw;
        }
        const dryRun =
          rawBody.dryRun !== undefined
            ? requireBooleanParam(rawBody, "dryRun")
            : undefined;
        const importReq: ObsidianImportRequest = {
          vaultPath,
          ...(targetNamespace !== undefined ? { targetNamespace } : {}),
          ...(dryRun !== undefined ? { dryRun } : {})
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

      writeJsonResponse(res, 404, {
        ok: false,
        error: {
          code: "not_found",
          message: `Route not found: ${method} ${requestUrl.pathname}`
        }
      });
    } catch (error) {
      if (error instanceof RpcDispatchError) {
        writeJsonResponse(res, error.httpStatus, {
          id: "unknown",
          ok: false,
          error: { code: error.code, message: error.message }
        });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      writeJsonResponse(res, 500, {
        ok: false,
        error: { code: "internal_error", message }
      });
    }
  }

  private handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    wss: WebSocketServer
  ): void {
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
    const trustedScope =
      token !== null ? this.pairingManager.resolveTokenScope(token) : null;
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

  private handleWsConnection(
    ws: WebSocket,
    trustedCallerScope: CallerScope
  ): void {
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
              typeof rawFromSeq === "number" && Number.isFinite(rawFromSeq)
                ? rawFromSeq
                : 0;

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
              { replayFromSeq: fromSeq }
            );
            ptySubscriptions.set(ptyId, unsub);

            sendJson({
              id: envelope.id,
              ok: true,
              result: { ptyId, subscribed: true }
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
              result: { ptyId, unsubscribed: existingUnsub !== undefined }
            });
            return;
          }

          const outcome = await this.executeRpc(envelope, trustedCallerScope);
          sendJson(outcome.response);
          outcome.afterSend?.();
        } catch (error) {
          const code =
            error instanceof RpcDispatchError ? error.code : "rpc_error";
          const message = error instanceof Error ? error.message : String(error);
          sendJson({
            id: requestId,
            ok: false,
            error: { code, message }
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
    trustedCallerScope: CallerScope
  ): Promise<MemoryQueryResponse> {
    if (this.memoryStore === undefined) {
      throw new RpcDispatchError(
        "not_configured",
        "Memory store is not configured.",
        503
      );
    }
    if (!isRecord(rawParams)) {
      throw new RpcDispatchError(
        "invalid_params",
        "Memory query payload must be a JSON object."
      );
    }

    const query = rawParams.query;
    if (typeof query !== "string") {
      throw new RpcDispatchError(
        "invalid_params",
        'Parameter "query" must be a string.'
      );
    }

    const namespaces = parseOptionalStringArray(
      rawParams.namespaces,
      "namespaces"
    ) as MemoryNamespace[] | undefined;

    const kindsRaw = parseOptionalStringArray(rawParams.kinds, "kinds");
    let kinds: MemoryKind[] | undefined;
    if (kindsRaw !== undefined) {
      for (const kind of kindsRaw) {
        if (!MEMORY_KINDS.includes(kind as MemoryKind)) {
          throw new RpcDispatchError(
            "invalid_params",
            `Invalid memory kind: "${kind}".`
          );
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
        throw new RpcDispatchError(
          "invalid_params",
          `Invalid query mode: "${modeRaw}".`
        );
      }
      mode = modeRaw;
    }

    const queryEmbedding = parseOptionalEmbedding(
      rawParams.queryEmbedding ?? rawParams.embedding
    );

    // Transport-layer override: unconditionally enforce server-authenticated callerScope
    // and ignore any client-supplied callerScope / _callerScope fields.
    const boundRequest = this.identityGuard.bindCallerScope(trustedCallerScope, {
      query,
      ...(namespaces !== undefined ? { namespaces } : {}),
      ...(kinds !== undefined ? { kinds } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(mode !== undefined ? { mode } : {})
    });

    return this.memoryStore.query(
      boundRequest,
      trustedCallerScope,
      queryEmbedding
    );
  }

  private async executeMemoryUpsert(
    rawParams: unknown,
    trustedCallerScope: CallerScope
  ) {
    if (this.memoryStore === undefined) {
      throw new RpcDispatchError(
        "not_configured",
        "Memory store is not configured.",
        503
      );
    }
    if (!isRecord(rawParams)) {
      throw new RpcDispatchError(
        "invalid_params",
        "Memory upsert payload must be a JSON object."
      );
    }

    const id = optionalStringParam(rawParams, "id");
    const namespaceRaw = requireStringParam(rawParams, "namespace");
    if (!isValidMemoryNamespace(namespaceRaw)) {
      throw new RpcDispatchError(
        "invalid_params",
        `Invalid memory namespace: "${namespaceRaw}".`
      );
    }

    if (!isScopeAllowedForNamespace(trustedCallerScope, namespaceRaw)) {
      throw new RpcDispatchError(
        "forbidden",
        `Caller scope "${trustedCallerScope}" is not authorized to write namespace "${namespaceRaw}".`,
        403
      );
    }

    const kindRaw = requireStringParam(rawParams, "kind");
    if (!MEMORY_KINDS.includes(kindRaw as MemoryKind)) {
      throw new RpcDispatchError(
        "invalid_params",
        `Invalid memory kind: "${kindRaw}".`
      );
    }

    const title = requireStringParam(rawParams, "title");
    const contentValue = rawParams.content;
    if (typeof contentValue !== "string") {
      throw new RpcDispatchError(
        "invalid_params",
        'Parameter "content" must be a string.'
      );
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
        'Parameter "sourceRef" must be a string or null.'
      );
    }

    let importance: number | undefined;
    if (rawParams.importance !== undefined) {
      if (
        typeof rawParams.importance !== "number" ||
        !Number.isFinite(rawParams.importance)
      ) {
        throw new RpcDispatchError(
          "invalid_params",
          'Parameter "importance" must be a finite number.'
        );
      }
      importance = rawParams.importance;
    }

    const machineId =
      optionalStringParam(rawParams, "machineId") ?? this.machineId;
    const embedding = parseOptionalEmbedding(rawParams.embedding);

    const input: MemoryUpsertInput = {
      ...(id !== undefined ? { id } : {}),
      namespace: namespaceRaw,
      kind: kindRaw as MemoryKind,
      title,
      content: contentValue,
      ...(sourceRef !== undefined ? { sourceRef } : {}),
      ...(importance !== undefined ? { importance } : {}),
      machineId
    };

    return this.memoryStore.upsert(input, embedding);
  }

  private parseRpcEnvelope(raw: unknown): RpcPayloadEnvelope {
    if (!isRecord(raw)) {
      throw new RpcDispatchError(
        "invalid_request",
        "RPC payload must be a JSON object."
      );
    }
    const id = raw.id;
    const method = raw.method;
    if (typeof id !== "string" || id.length === 0) {
      throw new RpcDispatchError(
        "invalid_request",
        'RPC payload requires non-empty string field "id".'
      );
    }
    if (typeof method !== "string" || method.length === 0) {
      throw new RpcDispatchError(
        "invalid_request",
        'RPC payload requires non-empty string field "method".'
      );
    }
    const rawParams = raw.params;
    const params = isRecord(rawParams) ? rawParams : {};
    return { id, method, params };
  }

  private async executeRpc(
    envelope: RpcPayloadEnvelope,
    trustedCallerScope: CallerScope
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
              result: { sessions: this.ptyPool.listSessions() }
            }
          };
        }

        case "pty.spawn": {
          const args = parseOptionalStringArray(params.args, "args");
          const rawGroup = params.group;
          const group =
            rawGroup === "agent-scratch" || rawGroup === "default"
              ? rawGroup
              : undefined;

          const session = this.ptyPool.spawnSession({
            ptyId: optionalStringParam(params, "ptyId"),
            cwd: optionalStringParam(params, "cwd"),
            command: optionalStringParam(params, "command"),
            args,
            group,
            worktreeBranch: optionalStringParam(params, "worktreeBranch")
          });
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { session }
            }
          };
        }

        case "pty.write": {
          const ptyId = requireStringParam(params, "ptyId");
          const data = params.data;
          if (typeof data !== "string") {
            throw new RpcDispatchError(
              "invalid_params",
              'Parameter "data" must be a string.'
            );
          }
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { accepted: this.ptyPool.write(ptyId, data) }
            }
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
              result: { resized: this.ptyPool.resize(ptyId, cols, rows) }
            }
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
              result: { killed }
            }
          };
        }

        case "pty.replay": {
          const ptyId = requireStringParam(params, "ptyId");
          const rawFromSeq = params.fromSeq;
          const fromSeq =
            typeof rawFromSeq === "number" && Number.isFinite(rawFromSeq)
              ? rawFromSeq
              : 0;
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: this.ptyPool.replay(ptyId, fromSeq)
            }
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
                sessions: scanResult.sessions
              }
            }
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
              result: adopted
            }
          };
        }

        case "chief.status": {
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { slot: this.chiefManager.getSlot() }
            }
          };
        }

        case "chief.switchProvider": {
          const provider = requireStringParam(
            params,
            "provider"
          ) as ChiefProviderKind;
          const model = optionalStringParam(params, "model");
          const slot = await this.chiefManager.switchProvider(provider, model);
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { slot }
            }
          };
        }

        case "t3.status": {
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { status: this.getT3BridgeStatus() }
            }
          };
        }

        case "plugins.list": {
          if (this.pluginHost === undefined) {
            throw new RpcDispatchError(
              "not_configured",
              "Plugin host is not configured."
            );
          }
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { plugins: this.pluginHost.listInstalled() }
            }
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
                result: toggled
              }
            };
          }
          if (this.pluginHost === undefined) {
            throw new RpcDispatchError(
              "not_configured",
              "Plugin host is not configured."
            );
          }
          const existing = this.pluginHost.getRecord(pluginId);
          if (existing === undefined) {
            throw new RpcDispatchError(
              "not_found",
              `Plugin "${pluginId}" is not installed.`
            );
          }
          if (enabled) {
            throw new RpcDispatchError(
              "not_configured",
              `Cannot enable plugin "${pluginId}" without daemon plugin toggle handler.`
            );
          }
          await this.pluginHost.unmountPlugin(pluginId);
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { pluginId, enabled: false }
            }
          };
        }

        case "memory.query": {
          const result = await this.executeMemoryQuery(
            params,
            trustedCallerScope
          );
          return {
            response: {
              id: envelope.id,
              ok: true,
              result
            }
          };
        }

        case "memory.upsert": {
          const entry = await this.executeMemoryUpsert(
            params,
            trustedCallerScope
          );
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { id: entry.id, updatedAt: entry.updatedAt }
            }
          };
        }

        case "handoff.execute": {
          if (this.handoffEngine === undefined) {
            throw new RpcDispatchError(
              "not_configured",
              "HandoffEngine is not configured."
            );
          }
          const sourceThreadId = requireStringParam(params, "sourceThreadId");
          const rawDial = optionalStringParam(params, "targetDialMode");
          let targetDialMode: DialMode | undefined;
          if (rawDial !== undefined) {
            if (!(DIAL_MODES as readonly string[]).includes(rawDial)) {
              throw new RpcDispatchError(
                "invalid_params",
                `Invalid targetDialMode: "${rawDial}".`
              );
            }
            targetDialMode = rawDial as DialMode;
          }
          const targetWorkspace = optionalStringParam(params, "targetWorkspace");
          const targetBranch = optionalStringParam(params, "targetBranch");
          const additionalContext = optionalStringParam(
            params,
            "additionalContext"
          );
          const rawTranscript = params.transcript;
          let transcript: HandoffTranscriptMessage[] | undefined;
          if (rawTranscript !== undefined) {
            if (!Array.isArray(rawTranscript)) {
              throw new RpcDispatchError(
                "invalid_params",
                'Parameter "transcript" must be an array.'
              );
            }
            transcript = rawTranscript.filter(
              (item): item is HandoffTranscriptMessage =>
                isRecord(item) &&
                typeof item.role === "string" &&
                typeof item.content === "string"
            );
          }

          const result = await this.handoffEngine.executeHandoff({
            sourceThreadId,
            ...(targetDialMode !== undefined ? { targetDialMode } : {}),
            ...(targetWorkspace !== undefined ? { targetWorkspace } : {}),
            ...(targetBranch !== undefined ? { targetBranch } : {}),
            ...(additionalContext !== undefined ? { additionalContext } : {}),
            ...(transcript !== undefined ? { transcript } : {})
          });
          return {
            response: {
              id: envelope.id,
              ok: true,
              result
            }
          };
        }

        case "dial.setMode": {
          if (this.handoffEngine === undefined) {
            throw new RpcDispatchError(
              "not_configured",
              "HandoffEngine is not configured."
            );
          }
          const threadId = requireStringParam(params, "threadId");
          const modeRaw = requireStringParam(params, "mode");
          if (!(DIAL_MODES as readonly string[]).includes(modeRaw)) {
            throw new RpcDispatchError(
              "invalid_params",
              `Invalid dial mode: "${modeRaw}".`
            );
          }
          const mode = this.handoffEngine.setDialMode(
            threadId,
            modeRaw as DialMode
          );
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { threadId, mode }
            }
          };
        }

        case "hooks.decideApproval": {
          if (this.hookBus === undefined) {
            throw new RpcDispatchError(
              "not_configured",
              "LifecycleHookBus is not configured."
            );
          }
          const requestId = requireStringParam(params, "requestId");
          const allow = requireBooleanParam(params, "allow");
          const reason = optionalStringParam(params, "reason");
          const record = this.hookBus.recordApprovalDecision(
            requestId,
            allow,
            reason
          );
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: {
                requestId: record.requestId,
                accepted: true,
                status: record.status
              }
            }
          };
        }

        case "updater.status": {
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: this.requireAppUpdater().getStatus()
            }
          };
        }

        case "updater.probe": {
          const report = await this.requireAppUpdater().probeSources();
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: report
            }
          };
        }

        case "updater.check": {
          const result = await this.executeUpdaterCheck(params);
          return {
            response: {
              id: envelope.id,
              ok: true,
              result
            }
          };
        }

        case "updater.setPolicy": {
          const policy = this.executeUpdaterSetPolicy(params);
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { policy }
            }
          };
        }

        case "updater.download": {
          const result = await this.executeUpdaterDownload(params);
          return {
            response: {
              id: envelope.id,
              ok: true,
              result
            }
          };
        }

        case "daemon.shutdown": {
          const reason = optionalStringParam(params, "reason");
          return {
            response: {
              id: envelope.id,
              ok: true,
              result: { shuttingDown: true }
            },
            afterSend: () => {
              setImmediate(() => {
                void this.onRequestShutdown?.(reason);
              });
            }
          };
        }

        default: {
          throw new RpcDispatchError(
            "method_not_found",
            `Unknown or unimplemented RPC method: ${method}`
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
          error: { code, message }
        }
      };
    }
  }

  private requireAppUpdater(): AppUpdater {
    if (this.appUpdater === undefined) {
      throw new RpcDispatchError(
        "not_configured",
        "AppUpdater is not configured.",
        503
      );
    }
    return this.appUpdater;
  }

  private async executeUpdaterCheck(rawParams: unknown) {
    const updater = this.requireAppUpdater();
    if (!isRecord(rawParams)) {
      throw new RpcDispatchError(
        "invalid_params",
        "Updater check payload must be a JSON object."
      );
    }
    const channelRaw = optionalStringParam(rawParams, "channel");
    let channel: UpdateChannel | undefined;
    if (channelRaw !== undefined) {
      if (!(UPDATE_CHANNELS as readonly string[]).includes(channelRaw)) {
        throw new RpcDispatchError(
          "invalid_params",
          `Invalid update channel: "${channelRaw}".`
        );
      }
      channel = channelRaw as UpdateChannel;
    }

    const sourceRaw = optionalStringParam(rawParams, "sourceOverride");
    let sourceOverride: UpdateSourceId | undefined;
    if (sourceRaw !== undefined) {
      if (!(UPDATE_SOURCE_IDS as readonly string[]).includes(sourceRaw)) {
        throw new RpcDispatchError(
          "invalid_params",
          `Invalid update sourceOverride: "${sourceRaw}".`
        );
      }
      sourceOverride = sourceRaw as UpdateSourceId;
    }

    return updater.checkForUpdates({
      ...(channel !== undefined ? { channel } : {}),
      ...(sourceOverride !== undefined ? { sourceOverride } : {})
    });
  }

  private executeUpdaterSetPolicy(rawParams: unknown) {
    const updater = this.requireAppUpdater();
    if (!isRecord(rawParams)) {
      throw new RpcDispatchError(
        "invalid_params",
        "Updater policy payload must be a JSON object."
      );
    }

    const patch: UpdatePolicyPatch = {};
    if (rawParams.routePreference !== undefined) {
      const routeRaw = requireStringParam(rawParams, "routePreference");
      if (!(NETWORK_ROUTE_PREFERENCES as readonly string[]).includes(routeRaw)) {
        throw new RpcDispatchError(
          "invalid_params",
          `Invalid routePreference: "${routeRaw}".`
        );
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
          'Parameter "customGhProxyPrefix" must be a string.'
        );
      }
      patch.customGhProxyPrefix = rawParams.customGhProxyPrefix;
    }
    if (rawParams.pluginRegistryOverride !== undefined) {
      const regRaw = requireStringParam(rawParams, "pluginRegistryOverride");
      if (
        regRaw !== "auto" &&
        !(PLUGIN_REGISTRY_IDS as readonly string[]).includes(regRaw)
      ) {
        throw new RpcDispatchError(
          "invalid_params",
          `Invalid pluginRegistryOverride: "${regRaw}".`
        );
      }
      patch.pluginRegistryOverride = regRaw as PluginRegistryOverride;
    }
    if (rawParams.timeoutMs !== undefined) {
      patch.timeoutMs = requirePositiveIntParam(rawParams, "timeoutMs");
    }

    try {
      return updater.setPolicy(patch);
    } catch (error) {
      throw new RpcDispatchError(
        "invalid_params",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async executeUpdaterDownload(rawParams: unknown) {
    const updater = this.requireAppUpdater();
    if (!isRecord(rawParams)) {
      throw new RpcDispatchError(
        "invalid_params",
        "Updater download payload must be a JSON object."
      );
    }

    const destDir = optionalStringParam(rawParams, "destDir");
    const kindRaw = optionalStringParam(rawParams, "kind");
    let kind: UpdatePackageKind | undefined;
    if (kindRaw !== undefined) {
      if (kindRaw !== "setup-exe" && kindRaw !== "portable-zip") {
        throw new RpcDispatchError(
          "invalid_params",
          `Invalid update package kind: "${kindRaw}".`
        );
      }
      kind = kindRaw;
    }

    return updater.downloadUpdate({
      ...(destDir !== undefined ? { destDir } : {}),
      ...(kind !== undefined ? { kind } : {})
    });
  }
}
