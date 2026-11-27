import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { ChiefProviderKind } from "@prismux/protocol";
import WebSocket from "ws";

export const CORE_ORCHESTRATION_PROTOCOL_QUERY_PARAM = "orchestrationProtocol";
export const CORE_ORCHESTRATION_PROTOCOL_VERSION = "2";
export const DEFAULT_CORE_RPC_TIMEOUT_MS = 15_000;
export const DEFAULT_CORE_EFFECT_PING_TIMEOUT_MS = 2_000;
export const DEFAULT_CORE_BASE_RECONNECT_MS = 200;
export const DEFAULT_CORE_MAX_RECONNECT_MS = 5_000;

export type CoreRpcProtocolMode = "unknown" | "legacy_json_rpc" | "effect_rpc";

export type CoreRpcConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";

export interface CoreRpcClientOptions {
  url: string;
  token?: string;
  protocolVersion?: string;
  requestTimeoutMs?: number;
  baseReconnectMs?: number;
  maxReconnectMs?: number;
  autoReconnect?: boolean;
}

export interface CoreRpcClientStatus {
  state: CoreRpcConnectionState;
  connected: boolean;
  wsUrl: string;
  protocolVersion: string;
  protocolMode?: CoreRpcProtocolMode;
  reconnectAttempts: number;
  pendingRequestCount: number;
  lastError?: string;
}

export interface CoreRpcPushEvent {
  event?: string;
  method?: string;
  type?: string;
  data?: unknown;
  params?: unknown;
  payload?: unknown;
  [key: string]: unknown;
}

export interface CoreProviderSummary {
  id: string;
  name?: string;
  state?: string;
  models?: string[];
  [key: string]: unknown;
}

export interface CorePingResult {
  ok: boolean;
  latencyMs: number;
  payload?: unknown;
}

export interface CoreEnsureChiefThreadResult {
  ensured: boolean;
  threadId?: string;
  workspacePath?: string;
  provider?: ChiefProviderKind;
  model?: string;
  [key: string]: unknown;
}

export class CoreRpcHandshakeError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, detail?: string) {
    const suffix = detail !== undefined && detail.length > 0 ? `: ${detail}` : "";
    super(`Core WebSocket handshake rejected with HTTP ${statusCode}${suffix}`);
    this.name = "CoreRpcHandshakeError";
    this.statusCode = statusCode;
  }
}

export const NON_RETRYABLE_CORE_HANDSHAKE_STATUS_CODES: ReadonlySet<number> = new Set([
  401, 403, 426,
]);

export function isNonRetryableCoreHandshakeError(error: unknown): error is CoreRpcHandshakeError {
  return (
    error instanceof CoreRpcHandshakeError &&
    NON_RETRYABLE_CORE_HANDSHAKE_STATUS_CODES.has(error.statusCode)
  );
}

export class CoreRpcRemoteError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CoreRpcRemoteError";
    this.code = code;
  }
}

export class CoreRpcUnsupportedProtocolError extends Error {
  readonly code: string;
  readonly method: string;
  readonly detail?: string;

  constructor(method: string, detail?: string, code: string = "unsupported_legacy_json_rpc") {
    const suffix = detail !== undefined && detail.length > 0 ? `: ${detail}` : "";
    super(`Core RPC peer does not support legacy JSON-RPC method "${method}"${suffix}`);
    this.name = "CoreRpcUnsupportedProtocolError";
    this.code = code;
    this.method = method;
    if (detail !== undefined && detail.length > 0) {
      this.detail = detail;
    }
  }
}

export function isCoreRpcUnsupportedProtocolError(
  error: unknown,
): error is CoreRpcUnsupportedProtocolError {
  return error instanceof CoreRpcUnsupportedProtocolError;
}

/**
 * Ensures the target WebSocket URL carries `orchestrationProtocol=<version>`
 * and normalizes `http:`/`https:` schemes to `ws:`/`wss:`.
 */
export function buildCoreWebSocketUrl(
  rawUrl: string,
  protocolVersion: string = CORE_ORCHESTRATION_PROTOCOL_VERSION,
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
  parsed.searchParams.set(CORE_ORCHESTRATION_PROTOCOL_QUERY_PARAM, protocolVersion);
  return parsed.toString();
}

interface PendingRpcRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

interface EffectPingWaiter {
  resolve: () => void;
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

export class CoreRpcClient {
  readonly wsUrl: string;
  readonly protocolVersion: string;
  private readonly token: string | undefined;
  private readonly requestTimeoutMs: number;
  private readonly baseReconnectMs: number;
  private readonly maxReconnectMs: number;
  private readonly autoReconnect: boolean;

  private ws: WebSocket | undefined;
  private state: CoreRpcConnectionState = "disconnected";
  private protocolMode: CoreRpcProtocolMode = "unknown";
  private closedManually = false;
  private hasEverConnected = false;
  private reconnectAttempts = 0;
  private lastError: string | undefined;

  private reconnectTimer: NodeJS.Timeout | undefined;
  private activeConnectPromise: Promise<void> | undefined;
  private activeClosePromise: Promise<void> | undefined;

  private readonly pendingRequests = new Map<string, PendingRpcRequest>();
  private readonly unsupportedLegacyMethods = new Set<string>();
  private readonly silentLegacyMethods = new Set<string>();
  private readonly effectPingWaiters = new Set<EffectPingWaiter>();
  private readonly eventListeners = new Set<(event: CoreRpcPushEvent) => void>();
  private readonly stateListeners = new Set<(connected: boolean) => void>();
  private readonly connectedWaiters = new Set<ConnectedWaiter>();

  constructor(options: CoreRpcClientOptions) {
    this.protocolVersion = options.protocolVersion ?? CORE_ORCHESTRATION_PROTOCOL_VERSION;
    this.wsUrl = buildCoreWebSocketUrl(options.url, this.protocolVersion);
    const urlToken = new URL(this.wsUrl).searchParams.get("token")?.trim();
    this.token =
      options.token !== undefined && options.token.length > 0
        ? options.token
        : urlToken !== undefined && urlToken.length > 0
          ? urlToken
          : undefined;
    this.requestTimeoutMs = Math.max(50, options.requestTimeoutMs ?? DEFAULT_CORE_RPC_TIMEOUT_MS);
    this.baseReconnectMs = Math.max(10, options.baseReconnectMs ?? DEFAULT_CORE_BASE_RECONNECT_MS);
    this.maxReconnectMs = Math.max(
      this.baseReconnectMs,
      options.maxReconnectMs ?? DEFAULT_CORE_MAX_RECONNECT_MS,
    );
    this.autoReconnect = options.autoReconnect ?? true;
  }

  isConnected(): boolean {
    return (
      this.state === "connected" && this.ws !== undefined && this.ws.readyState === WebSocket.OPEN
    );
  }

  getStatus(): CoreRpcClientStatus {
    return {
      state: this.state,
      connected: this.isConnected(),
      wsUrl: this.wsUrl,
      protocolVersion: this.protocolVersion,
      protocolMode: this.protocolMode,
      reconnectAttempts: this.reconnectAttempts,
      pendingRequestCount: this.pendingRequests.size,
      ...(this.lastError !== undefined ? { lastError: this.lastError } : {}),
    };
  }

  getProtocolMode(): CoreRpcProtocolMode {
    return this.protocolMode;
  }

  supportsLegacyJsonRpc(): boolean {
    return this.protocolMode !== "effect_rpc";
  }

  isLegacyMethodAvailable(method: string): boolean {
    if (!this.isConnected()) {
      return false;
    }
    if (this.protocolMode === "effect_rpc") {
      return false;
    }
    if (this.unsupportedLegacyMethods.has(method)) {
      return false;
    }
    if (this.protocolMode === "unknown" && this.silentLegacyMethods.has(method)) {
      return false;
    }
    return true;
  }

  onEvent(listener: (event: CoreRpcPushEvent) => void): () => void {
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
      throw new Error("CoreRpcClient is closed.");
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
          reject(new Error(`Timed out after ${timeoutMs}ms waiting for CoreRpcClient to connect.`));
        }, timeoutMs),
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
    timeoutMs: number = this.requestTimeoutMs,
  ): Promise<TResult> {
    const ws = this.ws;
    if (!this.isConnected() || ws === undefined) {
      throw new Error(`Cannot send RPC "${method}": CoreRpcClient is not connected.`);
    }
    if (this.protocolMode === "effect_rpc") {
      throw new CoreRpcUnsupportedProtocolError(
        method,
        "Peer speaks Effect RPC protocol instead of legacy JSON-RPC.",
      );
    }
    if (this.unsupportedLegacyMethods.has(method)) {
      throw new CoreRpcUnsupportedProtocolError(
        method,
        "Method was rejected as unsupported by peer on this connection.",
        "method_not_found",
      );
    }
    if (this.protocolMode === "unknown" && this.silentLegacyMethods.has(method)) {
      throw new CoreRpcUnsupportedProtocolError(
        method,
        "Method previously timed out without reply from unverified peer on this connection.",
        "method_unresponsive",
      );
    }

    const id = randomUUID();
    const effectiveTimeoutMs = Math.max(10, timeoutMs);

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.delete(id)) {
          if (this.protocolMode === "unknown") {
            this.silentLegacyMethods.add(method);
          }
          reject(
            new Error(`Core RPC request "${method}" timed out after ${effectiveTimeoutMs}ms.`),
          );
        }
      }, effectiveTimeoutMs);

      this.pendingRequests.set(id, {
        method,
        resolve: (value) => resolve(value as TResult),
        reject,
        timer,
      });

      const frame = JSON.stringify({ id, method, params });
      ws.send(frame, (sendErr) => {
        if (sendErr !== undefined && sendErr !== null) {
          const pending = this.pendingRequests.get(id);
          if (pending !== undefined) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(id);
            pending.reject(sendErr instanceof Error ? sendErr : new Error(String(sendErr)));
          }
        }
      });
    });
  }

  async ping(timeoutMs?: number): Promise<CorePingResult> {
    const startedAt = Date.now();
    if (this.protocolMode === "effect_rpc") {
      await this.sendEffectRpcPing(
        timeoutMs ?? Math.min(this.requestTimeoutMs, DEFAULT_CORE_EFFECT_PING_TIMEOUT_MS),
      );
      return {
        ok: true,
        latencyMs: Math.max(0, Date.now() - startedAt),
        payload: { protocol: "effect_rpc", pong: true },
      };
    }

    try {
      const payload = await this.request<unknown>("server.probe", {}, timeoutMs);
      return {
        ok: true,
        latencyMs: Math.max(0, Date.now() - startedAt),
        payload,
      };
    } catch (error: unknown) {
      if (
        isCoreRpcUnsupportedProtocolError(error) &&
        this.getProtocolMode() === "effect_rpc" &&
        this.isConnected()
      ) {
        await this.sendEffectRpcPing(
          timeoutMs ?? Math.min(this.requestTimeoutMs, DEFAULT_CORE_EFFECT_PING_TIMEOUT_MS),
        );
        return {
          ok: true,
          latencyMs: Math.max(0, Date.now() - startedAt),
          payload: { protocol: "effect_rpc", pong: true },
        };
      }
      throw error;
    }
  }

  async listProviders(timeoutMs?: number): Promise<CoreProviderSummary[]> {
    const result = await this.request<
      CoreProviderSummary[] | { providers?: CoreProviderSummary[] }
    >("provider.list", {}, timeoutMs);
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
    model?: string,
    timeoutMs?: number,
  ): Promise<CoreEnsureChiefThreadResult> {
    return this.request<CoreEnsureChiefThreadResult>(
      "chief.ensureThread",
      {
        workspacePath,
        provider,
        ...(model !== undefined ? { model } : {}),
      },
      timeoutMs,
    );
  }

  async dispatchThreadCommand(
    threadId: string,
    payload: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown> {
    return this.request(
      "orchestration.dispatchCommand",
      {
        threadId,
        payload,
      },
      timeoutMs,
    );
  }

  private async performClose(): Promise<void> {
    const wasConnected = this.isConnected();
    this.closedManually = true;
    this.state = "closed";
    this.clearReconnectTimer();
    this.resetConnectionProtocolState();

    const closeError = new Error("CoreRpcClient closed.");
    this.rejectAllPendingRequests(closeError);
    this.rejectAllEffectPingWaiters(closeError);
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
        rejectOpen(new Error("CoreRpcClient is closed."));
        return;
      }

      const headers: Record<string, string> = {};
      if (this.token !== undefined && this.token.length > 0) {
        headers.Authorization = `Bearer ${this.token}`;
      }

      const ws = new WebSocket(this.wsUrl, {
        headers,
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
          rejectOnce(new Error("CoreRpcClient closed during handshake."));
          return;
        }

        this.hasEverConnected = true;
        this.reconnectAttempts = 0;
        this.lastError = undefined;
        this.resetConnectionProtocolState();
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
        const err = new CoreRpcHandshakeError(statusCode, res.statusMessage);
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
          `Core WebSocket closed (code=${code}${reason.length > 0 ? `, reason=${reason}` : ""}).`,
        );
        this.rejectAllPendingRequests(closeError);
        this.rejectAllEffectPingWaiters(closeError);
        if (wasCurrentSocket) {
          this.resetConnectionProtocolState();
        }

        if (this.closedManually) {
          if (!settled) {
            rejectOnce(new Error("CoreRpcClient closed."));
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
      this.baseReconnectMs * 2 ** this.reconnectAttempts,
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

        if (isNonRetryableCoreHandshakeError(err)) {
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
        this.protocolMode = "legacy_json_rpc";
        this.silentLegacyMethods.clear();
        this.pendingRequests.delete(id);
        clearTimeout(pending.timer);

        if (parsed.ok === false || (parsed.ok !== true && parsed.error !== undefined)) {
          const rawErr = parsed.error;
          let code = "rpc_error";
          let message = "Core RPC request failed.";
          if (isRecord(rawErr)) {
            if (typeof rawErr.code === "string") {
              code = rawErr.code;
            }
            if (typeof rawErr.message === "string") {
              message = rawErr.message;
            }
          } else if (typeof rawErr === "string") {
            message = rawErr;
          }
          if (code === "method_not_found" || code === "unknown_method") {
            this.unsupportedLegacyMethods.add(pending.method);
          }
          pending.reject(new CoreRpcRemoteError(code, message));
          return;
        }

        pending.resolve(parsed.result);
        return;
      }
    } else if (typeof parsed._tag === "string") {
      if (parsed._tag === "Pong") {
        this.protocolMode = "effect_rpc";
        this.resolveAllEffectPingWaiters();
        return;
      }
      if (parsed._tag === "Defect") {
        this.protocolMode = "effect_rpc";
        const detail = this.extractEffectDefectDetail(parsed.defect);
        this.rejectAllPendingLegacyAsUnsupported(detail);
        return;
      }
      if (
        (parsed._tag === "Exit" || parsed._tag === "Chunk") &&
        (typeof parsed.requestId === "string" || typeof parsed.requestId === "number")
      ) {
        this.protocolMode = "effect_rpc";
        return;
      }
    }

    for (const listener of this.eventListeners) {
      try {
        listener(parsed as CoreRpcPushEvent);
      } catch {
        // Isolate listener failures.
      }
    }
  }

  private sendEffectRpcPing(timeoutMs: number): Promise<void> {
    const ws = this.ws;
    if (!this.isConnected() || ws === undefined) {
      return Promise.reject(
        new Error('Cannot send Effect RPC "Ping": CoreRpcClient is not connected.'),
      );
    }

    const effectiveTimeoutMs = Math.max(10, timeoutMs);
    return new Promise<void>((resolve, reject) => {
      const waiter: EffectPingWaiter = {
        resolve: () => {
          clearTimeout(waiter.timer);
          this.effectPingWaiters.delete(waiter);
          resolve();
        },
        reject: (err: Error) => {
          clearTimeout(waiter.timer);
          this.effectPingWaiters.delete(waiter);
          reject(err);
        },
        timer: setTimeout(() => {
          this.effectPingWaiters.delete(waiter);
          reject(new Error(`Core Effect RPC "Ping" timed out after ${effectiveTimeoutMs}ms.`));
        }, effectiveTimeoutMs),
      };
      this.effectPingWaiters.add(waiter);

      ws.send(JSON.stringify({ _tag: "Ping" }), (sendErr) => {
        if (sendErr !== undefined && sendErr !== null) {
          waiter.reject(sendErr instanceof Error ? sendErr : new Error(String(sendErr)));
        }
      });
    });
  }

  private extractEffectDefectDetail(defect: unknown): string | undefined {
    if (typeof defect === "string" && defect.trim().length > 0) {
      return defect.trim();
    }
    if (isRecord(defect)) {
      if (typeof defect.message === "string" && defect.message.trim().length > 0) {
        return defect.message.trim();
      }
      if (typeof defect.defect === "string" && defect.defect.trim().length > 0) {
        return defect.defect.trim();
      }
    }
    return undefined;
  }

  private resetConnectionProtocolState(): void {
    this.protocolMode = "unknown";
    this.unsupportedLegacyMethods.clear();
    this.silentLegacyMethods.clear();
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

  private rejectAllPendingLegacyAsUnsupported(detail?: string): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);
      pending.reject(new CoreRpcUnsupportedProtocolError(pending.method, detail));
    }
  }

  private resolveAllEffectPingWaiters(): void {
    for (const waiter of Array.from(this.effectPingWaiters)) {
      waiter.resolve();
    }
  }

  private rejectAllEffectPingWaiters(error: Error): void {
    for (const waiter of Array.from(this.effectPingWaiters)) {
      waiter.reject(error);
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
