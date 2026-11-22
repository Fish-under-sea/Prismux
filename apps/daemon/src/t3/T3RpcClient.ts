import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { ChiefProviderKind } from "@prismux/protocol";
import WebSocket from "ws";

export const T3_ORCHESTRATION_PROTOCOL_QUERY_PARAM = "orchestrationProtocol";
export const T3_ORCHESTRATION_PROTOCOL_VERSION = "2";
export const DEFAULT_T3_RPC_TIMEOUT_MS = 15_000;
export const DEFAULT_T3_BASE_RECONNECT_MS = 200;
export const DEFAULT_T3_MAX_RECONNECT_MS = 5_000;

export type T3RpcConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";

export interface T3RpcClientOptions {
  url: string;
  token?: string;
  protocolVersion?: string;
  requestTimeoutMs?: number;
  baseReconnectMs?: number;
  maxReconnectMs?: number;
  autoReconnect?: boolean;
}

export interface T3RpcClientStatus {
  state: T3RpcConnectionState;
  connected: boolean;
  wsUrl: string;
  protocolVersion: string;
  reconnectAttempts: number;
  pendingRequestCount: number;
  lastError?: string;
}

export interface T3RpcPushEvent {
  event?: string;
  method?: string;
  type?: string;
  data?: unknown;
  params?: unknown;
  payload?: unknown;
  [key: string]: unknown;
}

export interface T3ProviderSummary {
  id: string;
  name?: string;
  state?: string;
  models?: string[];
  [key: string]: unknown;
}

export interface T3PingResult {
  ok: boolean;
  latencyMs: number;
  payload?: unknown;
}

export interface T3EnsureChiefThreadResult {
  ensured: boolean;
  threadId?: string;
  workspacePath?: string;
  provider?: ChiefProviderKind;
  model?: string;
  [key: string]: unknown;
}

export class T3RpcHandshakeError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, detail?: string) {
    const suffix = detail !== undefined && detail.length > 0 ? `: ${detail}` : "";
    super(`T3 WebSocket handshake rejected with HTTP ${statusCode}${suffix}`);
    this.name = "T3RpcHandshakeError";
    this.statusCode = statusCode;
  }
}

export class T3RpcRemoteError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "T3RpcRemoteError";
    this.code = code;
  }
}

/**
 * Ensures the target WebSocket URL carries `orchestrationProtocol=<version>`
 * and normalizes `http:`/`https:` schemes to `ws:`/`wss:`.
 */
export function buildT3WebSocketUrl(
  rawUrl: string,
  protocolVersion: string = T3_ORCHESTRATION_PROTOCOL_VERSION
): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol === "http:") {
    parsed.protocol = "ws:";
  } else if (parsed.protocol === "https:") {
    parsed.protocol = "wss:";
  }
  if (parsed.pathname === "" || parsed.pathname === "/") {
    parsed.pathname = "/ws";
  }
  parsed.searchParams.set(T3_ORCHESTRATION_PROTOCOL_QUERY_PARAM, protocolVersion);
  return parsed.toString();
}

interface PendingRpcRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

interface ConnectedWaiter {
  resolve: () => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class T3RpcClient {
  readonly wsUrl: string;
  readonly protocolVersion: string;
  private readonly token: string | undefined;
  private readonly requestTimeoutMs: number;
  private readonly baseReconnectMs: number;
  private readonly maxReconnectMs: number;
  private readonly autoReconnect: boolean;

  private ws: WebSocket | undefined;
  private state: T3RpcConnectionState = "disconnected";
  private closedManually = false;
  private hasEverConnected = false;
  private reconnectAttempts = 0;
  private lastError: string | undefined;

  private reconnectTimer: NodeJS.Timeout | undefined;
  private activeConnectPromise: Promise<void> | undefined;
  private activeClosePromise: Promise<void> | undefined;

  private readonly pendingRequests = new Map<string, PendingRpcRequest>();
  private readonly eventListeners = new Set<(event: T3RpcPushEvent) => void>();
  private readonly stateListeners = new Set<(connected: boolean) => void>();
  private readonly connectedWaiters = new Set<ConnectedWaiter>();

  constructor(options: T3RpcClientOptions) {
    this.protocolVersion =
      options.protocolVersion ?? T3_ORCHESTRATION_PROTOCOL_VERSION;
    this.wsUrl = buildT3WebSocketUrl(options.url, this.protocolVersion);
    const urlToken = new URL(this.wsUrl).searchParams.get("token")?.trim();
    this.token =
      options.token !== undefined && options.token.length > 0
        ? options.token
        : urlToken !== undefined && urlToken.length > 0
          ? urlToken
          : undefined;
    this.requestTimeoutMs = Math.max(
      50,
      options.requestTimeoutMs ?? DEFAULT_T3_RPC_TIMEOUT_MS
    );
    this.baseReconnectMs = Math.max(
      10,
      options.baseReconnectMs ?? DEFAULT_T3_BASE_RECONNECT_MS
    );
    this.maxReconnectMs = Math.max(
      this.baseReconnectMs,
      options.maxReconnectMs ?? DEFAULT_T3_MAX_RECONNECT_MS
    );
    this.autoReconnect = options.autoReconnect ?? true;
  }

  isConnected(): boolean {
    return (
      this.state === "connected" &&
      this.ws !== undefined &&
      this.ws.readyState === WebSocket.OPEN
    );
  }

  getStatus(): T3RpcClientStatus {
    return {
      state: this.state,
      connected: this.isConnected(),
      wsUrl: this.wsUrl,
      protocolVersion: this.protocolVersion,
      reconnectAttempts: this.reconnectAttempts,
      pendingRequestCount: this.pendingRequests.size,
      ...(this.lastError !== undefined ? { lastError: this.lastError } : {})
    };
  }

  onEvent(listener: (event: T3RpcPushEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  onStateChange(listener: (connected: boolean) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  async waitForConnected(timeoutMs = 10_000): Promise<void> {
    if (this.isConnected()) {
      return;
    }
    if (this.state === "closed") {
      throw new Error("T3RpcClient is closed.");
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: ConnectedWaiter = {
        resolve: () => {
          clearTimeout(waiter.timer);
          this.connectedWaiters.delete(waiter);
          resolve();
        },
        reject: (err: Error) => {
          clearTimeout(waiter.timer);
          this.connectedWaiters.delete(waiter);
          reject(err);
        },
        timer: setTimeout(() => {
          this.connectedWaiters.delete(waiter);
          reject(
            new Error(
              `Timed out after ${timeoutMs}ms waiting for T3RpcClient to connect.`
            )
          );
        }, timeoutMs)
      };
      this.connectedWaiters.add(waiter);
    });
  }

  async connect(): Promise<void> {
    if (this.activeClosePromise !== undefined) {
      await this.activeClosePromise;
    }
    if (this.isConnected()) {
      return;
    }
    if (this.activeConnectPromise !== undefined) {
      return this.activeConnectPromise;
    }

    this.closedManually = false;
    this.clearReconnectTimer();
    this.state = "connecting";

    const run = this.openSocket(false).finally(() => {
      this.activeConnectPromise = undefined;
    });
    this.activeConnectPromise = run;
    return run;
  }

  async close(): Promise<void> {
    if (this.activeClosePromise !== undefined) {
      return this.activeClosePromise;
    }

    const run = this.performClose().finally(() => {
      this.activeClosePromise = undefined;
    });
    this.activeClosePromise = run;
    return run;
  }

  async request<TResult = unknown>(
    method: string,
    params: unknown = {},
    timeoutMs: number = this.requestTimeoutMs
  ): Promise<TResult> {
    const ws = this.ws;
    if (!this.isConnected() || ws === undefined) {
      throw new Error(`Cannot send RPC "${method}": T3RpcClient is not connected.`);
    }

    const id = randomUUID();
    const effectiveTimeoutMs = Math.max(10, timeoutMs);

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.delete(id)) {
          reject(
            new Error(
              `T3 RPC request "${method}" timed out after ${effectiveTimeoutMs}ms.`
            )
          );
        }
      }, effectiveTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timer
      });

      const frame = JSON.stringify({ id, method, params });
      ws.send(frame, (sendErr) => {
        if (sendErr !== undefined && sendErr !== null) {
          const pending = this.pendingRequests.get(id);
          if (pending !== undefined) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(id);
            pending.reject(
              sendErr instanceof Error ? sendErr : new Error(String(sendErr))
            );
          }
        }
      });
    });
  }

  async ping(): Promise<T3PingResult> {
    const startedAt = Date.now();
    const payload = await this.request<unknown>("server.probe", {});
    return {
      ok: true,
      latencyMs: Math.max(0, Date.now() - startedAt),
      payload
    };
  }

  async listProviders(): Promise<T3ProviderSummary[]> {
    const result = await this.request<
      T3ProviderSummary[] | { providers?: T3ProviderSummary[] }
    >("provider.list", {});
    if (Array.isArray(result)) {
      return result;
    }
    if (isRecord(result) && Array.isArray(result.providers)) {
      return result.providers;
    }
    return [];
  }

  async ensureChiefThread(
    workspacePath: string,
    provider: ChiefProviderKind,
    model?: string
  ): Promise<T3EnsureChiefThreadResult> {
    return this.request<T3EnsureChiefThreadResult>("chief.ensureThread", {
      workspacePath,
      provider,
      ...(model !== undefined ? { model } : {})
    });
  }

  async dispatchThreadCommand(
    threadId: string,
    payload: Record<string, unknown>
  ): Promise<unknown> {
    return this.request("orchestration.dispatchCommand", {
      threadId,
      payload
    });
  }

  private async performClose(): Promise<void> {
    const wasConnected = this.isConnected();
    this.closedManually = true;
    this.state = "closed";
    this.clearReconnectTimer();

    const closeError = new Error("T3RpcClient closed.");
    this.rejectAllPendingRequests(closeError);
    this.rejectAllConnectedWaiters(closeError);

    const ws = this.ws;
    this.ws = undefined;

    if (ws !== undefined) {
      await new Promise<void>((resolveSocketClose) => {
        let done = false;
        let forceTimer: NodeJS.Timeout | undefined;
        const finish = () => {
          if (done) {
            return;
          }
          done = true;
          if (forceTimer !== undefined) {
            clearTimeout(forceTimer);
            forceTimer = undefined;
          }
          resolveSocketClose();
        };

        if (ws.readyState === WebSocket.CLOSED) {
          finish();
          return;
        }

        ws.once("close", finish);

        if (ws.readyState === WebSocket.CONNECTING) {
          try {
            ws.terminate();
          } catch {
            finish();
          }
          forceTimer = setTimeout(finish, 150);
          return;
        }

        try {
          ws.close(1000, "client closed");
        } catch {
          try {
            ws.terminate();
          } catch {
            finish();
          }
        }

        forceTimer = setTimeout(() => {
          try {
            ws.terminate();
          } catch {
            // Socket already destroyed.
          }
          finish();
        }, 300);
      });
    }

    if (wasConnected) {
      this.notifyStateListeners(false);
    }
  }

  private openSocket(isReconnect: boolean): Promise<void> {
    return new Promise<void>((resolveOpen, rejectOpen) => {
      if (this.closedManually) {
        rejectOpen(new Error("T3RpcClient is closed."));
        return;
      }

      const headers: Record<string, string> = {};
      if (this.token !== undefined && this.token.length > 0) {
        headers.Authorization = `Bearer ${this.token}`;
      }

      const ws = new WebSocket(this.wsUrl, {
        headers
      });
      this.ws = ws;

      let settled = false;
      let handshakeRejected = false;

      const resolveOnce = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolveOpen();
      };

      const rejectOnce = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        rejectOpen(error);
      };

      ws.once("open", () => {
        if (this.closedManually || this.ws !== ws) {
          try {
            ws.terminate();
          } catch {
            // Ignore cleanup failure.
          }
          rejectOnce(new Error("T3RpcClient closed during handshake."));
          return;
        }

        this.hasEverConnected = true;
        this.reconnectAttempts = 0;
        this.lastError = undefined;
        this.state = "connected";
        this.resolveAllConnectedWaiters();
        this.notifyStateListeners(true);
        resolveOnce();
      });

      ws.on("message", (rawData: WebSocket.RawData) => {
        this.handleIncomingMessage(rawData);
      });

      ws.once("unexpected-response", (req, res) => {
        handshakeRejected = true;
        const statusCode = res.statusCode ?? 0;
        const err = new T3RpcHandshakeError(statusCode, res.statusMessage);
        this.lastError = err.message;
        res.resume();
        try {
          req.destroy();
        } catch {
          // Ignore request destroy errors.
        }
        try {
          ws.terminate();
        } catch {
          // Ignore socket terminate errors.
        }
        if (this.ws === ws) {
          this.ws = undefined;
        }
        if (!isReconnect) {
          this.state = "disconnected";
        }
        rejectOnce(err);
      });

      ws.on("error", (err: Error) => {
        this.lastError = err.message;
        if (!settled) {
          if (this.ws === ws) {
            this.ws = undefined;
          }
          if (!isReconnect) {
            this.state = "disconnected";
          }
          rejectOnce(err);
        }
      });

      ws.on("close", (code: number, reasonBuffer: Buffer) => {
        const wasCurrentSocket = this.ws === ws;
        if (wasCurrentSocket) {
          this.ws = undefined;
        }

        const reason = reasonBuffer.toString("utf8");
        const closeError = new Error(
          `T3 WebSocket closed (code=${code}${reason.length > 0 ? `, reason=${reason}` : ""}).`
        );
        this.rejectAllPendingRequests(closeError);

        if (this.closedManually) {
          if (!settled) {
            rejectOnce(new Error("T3RpcClient closed."));
          }
          return;
        }

        if (handshakeRejected) {
          if (this.state !== "closed") {
            this.state = "disconnected";
          }
          return;
        }

        if (!settled) {
          if (!isReconnect) {
            this.state = "disconnected";
          }
          rejectOnce(closeError);
          if (isReconnect && this.autoReconnect && this.hasEverConnected) {
            this.scheduleReconnect();
          }
          return;
        }

        this.notifyStateListeners(false);

        if (this.autoReconnect && this.hasEverConnected) {
          this.scheduleReconnect();
        } else {
          this.state = "disconnected";
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.closedManually || !this.autoReconnect) {
      return;
    }
    if (this.reconnectTimer !== undefined) {
      return;
    }

    this.state = "reconnecting";
    const delayMs = Math.min(
      this.maxReconnectMs,
      this.baseReconnectMs * 2 ** this.reconnectAttempts
    );
    this.reconnectAttempts += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.closedManually || !this.autoReconnect) {
        return;
      }

      void this.openSocket(true).catch((err: unknown) => {
        if (this.closedManually) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        this.lastError = message;

        if (
          err instanceof T3RpcHandshakeError &&
          (err.statusCode === 401 || err.statusCode === 426)
        ) {
          this.state = "disconnected";
          this.rejectAllConnectedWaiters(err);
          return;
        }

        this.scheduleReconnect();
      });
    }, delayMs);
  }

  private handleIncomingMessage(rawData: WebSocket.RawData): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawDataToString(rawData));
    } catch {
      return;
    }

    if (!isRecord(parsed)) {
      return;
    }

    const id = parsed.id;
    if (typeof id === "string") {
      const pending = this.pendingRequests.get(id);
      if (pending !== undefined) {
        this.pendingRequests.delete(id);
        clearTimeout(pending.timer);

        if (parsed.ok === false || (parsed.ok !== true && parsed.error !== undefined)) {
          const rawErr = parsed.error;
          if (isRecord(rawErr)) {
            const code =
              typeof rawErr.code === "string" ? rawErr.code : "rpc_error";
            const message =
              typeof rawErr.message === "string"
                ? rawErr.message
                : "T3 RPC request failed.";
            pending.reject(new T3RpcRemoteError(code, message));
          } else {
            pending.reject(
              new T3RpcRemoteError(
                "rpc_error",
                typeof rawErr === "string" ? rawErr : "T3 RPC request failed."
              )
            );
          }
          return;
        }

        pending.resolve(parsed.result);
        return;
      }
    }

    for (const listener of this.eventListeners) {
      try {
        listener(parsed as T3RpcPushEvent);
      } catch {
        // Isolate listener failures.
      }
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private rejectAllPendingRequests(error: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);
      pending.reject(error);
    }
  }

  private resolveAllConnectedWaiters(): void {
    for (const waiter of this.connectedWaiters) {
      waiter.resolve();
    }
  }

  private rejectAllConnectedWaiters(error: Error): void {
    for (const waiter of this.connectedWaiters) {
      waiter.reject(error);
    }
  }

  private notifyStateListeners(connected: boolean): void {
    for (const listener of this.stateListeners) {
      try {
        listener(connected);
      } catch {
        // Isolate listener failures.
      }
    }
  }
}
