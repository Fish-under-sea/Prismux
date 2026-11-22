import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import {
  DEFAULT_METADATA_TIMEOUT_MS,
  DEFAULT_STALL_TIMEOUT_MS
} from "./types.js";

export { DEFAULT_METADATA_TIMEOUT_MS, DEFAULT_STALL_TIMEOUT_MS };

const UPLOAD_CHUNK_SIZE = 64 * 1024;

interface DestroyableEmitter {
  destroyed?: boolean;
  destroy?: (err?: Error) => void;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
}

function safeDestroyEmitter(
  emitter: DestroyableEmitter | undefined,
  err?: Error
): void {
  if (!emitter || typeof emitter.destroy !== "function" || emitter.destroyed) {
    return;
  }
  const absorb = (): void => {
    emitter.removeListener("error", absorb);
    emitter.removeListener("close", absorb);
  };
  emitter.once("error", absorb);
  emitter.once("close", absorb);
  emitter.destroy(err);
}

export class StallTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(
    message = "连续 60 秒无数据收发",
    timeoutMs: number = DEFAULT_STALL_TIMEOUT_MS
  ) {
    super(message);
    this.name = "StallTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

function formatStallMessage(timeoutMs: number, isMetadata = false): string {
  if (isMetadata) {
    return `元数据请求超时（${timeoutMs}ms 无响应）`;
  }
  if (timeoutMs === DEFAULT_STALL_TIMEOUT_MS) {
    return "连续 60 秒无数据收发";
  }
  if (timeoutMs >= 1000 && timeoutMs % 1000 === 0) {
    return `连续 ${timeoutMs / 1000} 秒无数据收发`;
  }
  return `连续 ${timeoutMs}ms 无数据收发`;
}

function validateTimeoutMs(timeoutMs: number, label: string): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }
}

/**
 * Reads an entire stream using a sliding byte-progress stall watchdog.
 * Never enforces a rigid total duration cap: any chunk with `length > 0` resets
 * the countdown timer. Only rejects with `StallTimeoutError` when zero bytes flow
 * for a continuous `stallTimeoutMs` interval.
 */
export async function readStreamWithStallWatchdog(
  stream: NodeJS.ReadableStream,
  stallTimeoutMs: number = DEFAULT_STALL_TIMEOUT_MS
): Promise<Buffer> {
  validateTimeoutMs(stallTimeoutMs, "stallTimeoutMs");

  let timer: ReturnType<typeof setTimeout> | undefined;
  let cleanupListeners: (() => void) | undefined;

  const clearWatchdog = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let settled = false;

      const finishResolve = (): void => {
        if (settled) return;
        settled = true;
        clearWatchdog();
        cleanupListeners?.();
        resolve(Buffer.concat(chunks));
      };

      const finishReject = (err: Error): void => {
        if (settled) return;
        settled = true;
        clearWatchdog();
        cleanupListeners?.();
        reject(err);
      };

      const onData = (chunk: Buffer | string): void => {
        const buf =
          typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
        if (buf.length > 0) {
          chunks.push(buf);
          resetWatchdog();
        }
      };

      const onEnd = (): void => {
        finishResolve();
      };

      const onError = (err: Error): void => {
        finishReject(err);
      };

      const onClose = (): void => {
        if (!settled) {
          finishReject(
            new Error("Stream closed unexpectedly before reaching end.")
          );
        }
      };

      cleanupListeners = (): void => {
        stream.removeListener("data", onData);
        stream.removeListener("end", onEnd);
        stream.removeListener("error", onError);
        stream.removeListener("close", onClose);
      };

      const resetWatchdog = (): void => {
        clearWatchdog();
        if (settled) return;
        timer = setTimeout(() => {
          if (settled) return;
          const stallError = new StallTimeoutError(
            formatStallMessage(stallTimeoutMs, false),
            stallTimeoutMs
          );
          const destroyable = stream as unknown as DestroyableEmitter;
          settled = true;
          clearWatchdog();
          cleanupListeners?.();
          safeDestroyEmitter(destroyable, stallError);
          reject(stallError);
        }, stallTimeoutMs);
      };

      stream.on("data", onData);
      stream.on("end", onEnd);
      stream.on("error", onError);
      stream.on("close", onClose);
      resetWatchdog();
    });
  } finally {
    clearWatchdog();
    cleanupListeners?.();
  }
}

export interface WatchdogHttpRequestOptions {
  url: string | URL;
  method: string;
  headers?: Record<string, string | number | string[] | undefined>;
  body?: Buffer | Uint8Array | string | Readable;
  stallTimeoutMs?: number;
  metadataTimeoutMs?: number;
  isMetadataRequest?: boolean;
  agent?: http.Agent | https.Agent | false;
  rejectUnauthorized?: boolean;
}

export interface WatchdogHttpResponse {
  statusCode: number;
  statusMessage: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function normalizeHeaders(
  headers?: Record<string, string | number | string[] | undefined>
): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  if (!headers) return out;
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Performs an HTTP/HTTPS request supervised by a sliding byte-progress stall watchdog.
 * Metadata verbs (`HEAD`, `PROPFIND`, or `isMetadataRequest: true`) use `metadataTimeoutMs`
 * (default 30s). Data transfers (`GET`, `PUT`, `POST`, etc.) never impose a total duration
 * timeout and reset `stallTimeoutMs` (default 60s) whenever bytes flow in either direction.
 */
export async function requestWithStallWatchdog(
  options: WatchdogHttpRequestOptions
): Promise<WatchdogHttpResponse> {
  const targetUrl =
    options.url instanceof URL ? options.url : new URL(options.url);
  const method = options.method.toUpperCase();
  const isMetadata =
    options.isMetadataRequest ?? (method === "HEAD" || method === "PROPFIND");
  const stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
  const metadataTimeoutMs =
    options.metadataTimeoutMs ?? DEFAULT_METADATA_TIMEOUT_MS;
  const activeTimeoutMs = isMetadata ? metadataTimeoutMs : stallTimeoutMs;

  validateTimeoutMs(
    activeTimeoutMs,
    isMetadata ? "metadataTimeoutMs" : "stallTimeoutMs"
  );

  const isHttps = targetUrl.protocol === "https:";
  if (targetUrl.protocol !== "http:" && !isHttps) {
    throw new Error(`Unsupported URL protocol: ${targetUrl.protocol}`);
  }

  let ephemeralAgent: https.Agent | undefined;
  let agent: http.Agent | https.Agent | false;
  if (options.agent !== undefined) {
    agent = options.agent;
  } else if (isHttps && options.rejectUnauthorized === false) {
    ephemeralAgent = new https.Agent({
      rejectUnauthorized: false,
      keepAlive: false
    });
    agent = ephemeralAgent;
  } else {
    // Disable keep-alive socket pooling so short-lived runs and tests exit immediately.
    agent = false;
  }

  const outgoingHeaders = normalizeHeaders(options.headers);
  let bodyBuffer: Buffer | undefined;
  let bodyStream: Readable | undefined;

  if (options.body !== undefined) {
    if (options.body instanceof Readable) {
      bodyStream = options.body;
    } else if (typeof options.body === "string") {
      bodyBuffer = Buffer.from(options.body, "utf8");
    } else if (Buffer.isBuffer(options.body)) {
      bodyBuffer = options.body;
    } else {
      bodyBuffer = Buffer.from(
        options.body.buffer,
        options.body.byteOffset,
        options.body.byteLength
      );
    }

    if (
      bodyBuffer !== undefined &&
      outgoingHeaders["content-length"] === undefined &&
      outgoingHeaders["Content-Length"] === undefined
    ) {
      outgoingHeaders["Content-Length"] = String(bodyBuffer.length);
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let reqRef: http.ClientRequest | undefined;
  let resRef: http.IncomingMessage | undefined;

  const clearWatchdog = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  try {
    return await new Promise<WatchdogHttpResponse>((resolve, reject) => {
      let settled = false;
      let responseReceived = false;
      const responseChunks: Buffer[] = [];

      const requestOptions: http.RequestOptions = {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port
          ? Number(targetUrl.port)
          : isHttps
            ? 443
            : 80,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method,
        headers: outgoingHeaders,
        agent
      };

      const req = isHttps
        ? https.request(requestOptions)
        : http.request(requestOptions);
      reqRef = req;

      const cleanupBodyStream = (): void => {
        if (!bodyStream) return;
        bodyStream.removeListener("data", onBodyData);
        bodyStream.removeListener("end", onBodyEnd);
        bodyStream.removeListener("error", onBodyError);
      };

      const onResData = (chunk: Buffer | string): void => {
        const buf =
          typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
        if (buf.length > 0) {
          responseChunks.push(buf);
          resetWatchdog();
        }
      };

      const onResEnd = (): void => {
        if (settled) return;
        settled = true;
        clearWatchdog();
        cleanupAllListeners();
        resolve({
          statusCode: resRef?.statusCode ?? 0,
          statusMessage: resRef?.statusMessage ?? "",
          headers: resRef?.headers ?? {},
          body: Buffer.concat(responseChunks)
        });
      };

      const onResError = (err: Error): void => {
        failWithError(err);
      };

      const onResClose = (): void => {
        if (!settled) {
          failWithError(
            new Error("HTTP response closed unexpectedly before completion.")
          );
        }
      };

      const cleanupAllListeners = (): void => {
        cleanupBodyStream();
        req.removeListener("error", onReqError);
        req.removeListener("response", onResponse);
        req.removeListener("drain", onReqDrain);
        if (resRef) {
          resRef.removeListener("data", onResData);
          resRef.removeListener("end", onResEnd);
          resRef.removeListener("error", onResError);
          resRef.removeListener("close", onResClose);
        }
      };

      const failWithError = (err: Error): void => {
        if (settled) return;
        settled = true;
        clearWatchdog();
        cleanupAllListeners();
        safeDestroyEmitter(req as unknown as DestroyableEmitter);
        safeDestroyEmitter(resRef as unknown as DestroyableEmitter | undefined);
        safeDestroyEmitter(
          bodyStream as unknown as DestroyableEmitter | undefined
        );
        reject(err);
      };

      const resetWatchdog = (): void => {
        clearWatchdog();
        if (settled) return;
        timer = setTimeout(() => {
          const stallError = new StallTimeoutError(
            formatStallMessage(activeTimeoutMs, isMetadata),
            activeTimeoutMs
          );
          failWithError(stallError);
        }, activeTimeoutMs);
      };

      const onReqError = (err: Error): void => {
        failWithError(err);
      };

      let bufferOffset = 0;
      let drainingBuffer = false;

      const pumpBuffer = (): void => {
        if (!bodyBuffer || settled || responseReceived) return;
        while (bufferOffset < bodyBuffer.length) {
          const end = Math.min(
            bufferOffset + UPLOAD_CHUNK_SIZE,
            bodyBuffer.length
          );
          const slice = bodyBuffer.subarray(bufferOffset, end);
          bufferOffset = end;
          if (slice.length > 0) {
            resetWatchdog();
          }
          const canContinue = req.write(slice);
          if (!canContinue) {
            drainingBuffer = true;
            return;
          }
        }
        drainingBuffer = false;
        req.end();
      };

      const onReqDrain = (): void => {
        if (settled || responseReceived) return;
        resetWatchdog();
        if (drainingBuffer) {
          drainingBuffer = false;
          pumpBuffer();
        } else if (bodyStream && bodyStream.isPaused()) {
          bodyStream.resume();
        }
      };

      const onBodyData = (chunk: Buffer | string): void => {
        if (settled || responseReceived) return;
        const buf =
          typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
        if (buf.length > 0) {
          resetWatchdog();
        }
        if (!req.write(buf)) {
          bodyStream?.pause();
        }
      };

      const onBodyEnd = (): void => {
        if (settled || responseReceived) return;
        req.end();
      };

      const onBodyError = (err: Error): void => {
        failWithError(err);
      };

      const onResponse = (res: http.IncomingMessage): void => {
        responseReceived = true;
        resRef = res;
        // Headers received -> connection made progress; stop pumping if server rejected early (e.g. 412).
        cleanupBodyStream();
        resetWatchdog();
        res.on("data", onResData);
        res.on("end", onResEnd);
        res.on("error", onResError);
        res.on("close", onResClose);
      };

      req.on("error", onReqError);
      req.on("response", onResponse);
      req.on("drain", onReqDrain);

      resetWatchdog();

      if (bodyStream) {
        bodyStream.on("data", onBodyData);
        bodyStream.on("end", onBodyEnd);
        bodyStream.on("error", onBodyError);
      } else if (bodyBuffer !== undefined) {
        if (bodyBuffer.length <= UPLOAD_CHUNK_SIZE) {
          if (bodyBuffer.length > 0) {
            resetWatchdog();
          }
          req.end(bodyBuffer);
        } else {
          pumpBuffer();
        }
      } else {
        req.end();
      }
    });
  } finally {
    clearWatchdog();
    if (reqRef && !reqRef.destroyed && resRef && !resRef.complete) {
      safeDestroyEmitter(reqRef as unknown as DestroyableEmitter);
    }
    ephemeralAgent?.destroy();
  }
}
