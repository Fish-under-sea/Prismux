import { Buffer } from "node:buffer";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import type {
  ChiefProviderKind,
  DaemonHealthResponse,
  T3BridgeStatus
} from "@prismux/protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { ChiefThreadManager } from "../chief/ChiefThreadManager.js";
import type { PersistentPtyPool } from "../pty/PersistentPtyPool.js";
import type { T3RpcClient } from "../t3/T3RpcClient.js";
import type { T3ServerSupervisor } from "../t3/T3ServerSupervisor.js";
import type { PairingManager } from "./PairingManager.js";

const MAX_JSON_BODY_BYTES = 256 * 1024;

export interface DaemonRpcServerOptions {
  host?: string;
  port?: number;
  headless: boolean;
  version?: string;
  ptyPool: PersistentPtyPool;
  chiefManager: ChiefThreadManager;
  pairingManager: PairingManager;
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

  constructor(code: string, message: string) {
    super(message);
    this.name = "RpcDispatchError";
    this.code = code;
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
        `Request body exceeded ${MAX_JSON_BODY_BYTES} bytes.`
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

export class DaemonRpcServer {
  private readonly host: string;
  private readonly requestedPort: number;
  private readonly headless: boolean;
  private readonly version: string;
  private readonly ptyPool: PersistentPtyPool;
  private readonly chiefManager: ChiefThreadManager;
  private readonly pairingManager: PairingManager;
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
    this.version = options.version ?? "0.1.0";
    this.ptyPool = options.ptyPool;
    this.chiefManager = options.chiefManager;
    this.pairingManager = options.pairingManager;
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

    wss.on("connection", (ws) => {
      this.handleWsConnection(ws);
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

  private async handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
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

      if (method === "POST" && requestUrl.pathname === "/v1/rpc") {
        const token = extractBearerToken(req);
        if (token === null || !this.pairingManager.verifyToken(token)) {
          writeJsonResponse(res, 401, {
            ok: false,
            error: {
              code: "unauthorized",
              message: "Missing or invalid Bearer token."
            }
          });
          return;
        }

        const rawBody = await readJsonBody(req);
        const envelope = this.parseRpcEnvelope(rawBody);
        const outcome = await this.executeRpc(envelope);
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
        writeJsonResponse(res, 400, {
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
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname !== "/rpc") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const token = extractRequestToken(req, requestUrl, true);
    if (token === null || !this.pairingManager.verifyToken(token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }

  private handleWsConnection(ws: WebSocket): void {
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

          const outcome = await this.executeRpc(envelope);
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

  private async executeRpc(envelope: RpcPayloadEnvelope): Promise<{
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
          const rawArgs = params.args;
          const args = Array.isArray(rawArgs)
            ? rawArgs.filter((v): v is string => typeof v === "string")
            : undefined;
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
}
