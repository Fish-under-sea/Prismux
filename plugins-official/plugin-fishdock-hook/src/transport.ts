import { Buffer } from "node:buffer";
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";
import type { IslandCardKind, IslandHookEvent } from "@prismux/protocol";

const DEFAULT_PUSH_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface FishDockBridgeConfig {
  endpointUrl: string;
  authToken?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  autoPushHooks?: boolean;
}

export interface FishDockPushResult {
  ok: true;
  statusCode: number;
  cardId: string;
  kind: IslandCardKind;
  responseBody: string;
}

export class FishDockPushError extends Error {
  readonly statusCode: number | undefined;
  readonly responseBody: string | undefined;

  constructor(
    message: string,
    options?: { statusCode?: number; responseBody?: string; cause?: unknown }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "FishDockPushError";
    this.statusCode = options?.statusCode;
    this.responseBody = options?.responseBody;
  }
}

export function validateEndpointUrl(rawUrl: string): URL {
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    throw new FishDockPushError("FISH-Dock endpointUrl must be a non-empty URL.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (error) {
    throw new FishDockPushError(
      `Invalid FISH-Dock endpointUrl "${rawUrl}".`,
      { cause: error }
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FishDockPushError(
      `Unsupported FISH-Dock endpoint protocol "${parsed.protocol}"; only http: and https: are allowed.`
    );
  }

  return parsed;
}

/**
 * Pushes a Dynamic Island card payload over HTTP/HTTPS POST using Node built-in `node:http` / `node:https`.
 */
export async function postIslandCardHttp(
  config: FishDockBridgeConfig,
  card: IslandHookEvent,
  signal?: AbortSignal
): Promise<FishDockPushResult> {
  if (signal?.aborted) {
    throw new FishDockPushError("FISH-Dock card push aborted before dispatch.");
  }

  const parsedUrl = validateEndpointUrl(config.endpointUrl);
  const body = JSON.stringify(card);
  const bodyBytes = Buffer.byteLength(body, "utf8");
  const timeoutMs =
    typeof config.timeoutMs === "number" &&
    Number.isFinite(config.timeoutMs) &&
    config.timeoutMs > 0
      ? config.timeoutMs
      : DEFAULT_PUSH_TIMEOUT_MS;

  const headers: Record<string, string> = {
    ...(config.headers ?? {}),
    "content-type": "application/json; charset=utf-8",
    "content-length": String(bodyBytes),
    accept: "application/json"
  };

  if (
    config.authToken !== undefined &&
    config.authToken.trim().length > 0 &&
    headers.authorization === undefined &&
    headers.Authorization === undefined
  ) {
    headers.authorization = `Bearer ${config.authToken.trim()}`;
  }

  const requestFn =
    parsedUrl.protocol === "https:" ? https.request : http.request;

  return new Promise<FishDockPushResult>((resolvePromise, rejectPromise) => {
    let settled = false;

    const finishError = (err: FishDockPushError) => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      rejectPromise(err);
    };

    const finishSuccess = (result: FishDockPushResult) => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolvePromise(result);
    };

    const req = requestFn(
      parsedUrl,
      {
        method: "POST",
        headers
      },
      (res) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        res.on("data", (chunk: Buffer | string) => {
          const buf =
            typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
          if (totalBytes + buf.byteLength <= MAX_RESPONSE_BYTES) {
            chunks.push(buf);
            totalBytes += buf.byteLength;
          }
        });

        res.on("end", () => {
          const statusCode = res.statusCode ?? 0;
          const responseBody = Buffer.concat(chunks).toString("utf8");
          if (statusCode >= 200 && statusCode < 300) {
            finishSuccess({
              ok: true,
              statusCode,
              cardId: card.cardId,
              kind: card.kind,
              responseBody
            });
            return;
          }

          finishError(
            new FishDockPushError(
              `FISH-Dock endpoint responded with HTTP ${statusCode} for card "${card.cardId}".`,
              { statusCode, responseBody }
            )
          );
        });

        res.on("error", (err) => {
          finishError(
            new FishDockPushError(
              `FISH-Dock response stream failed for card "${card.cardId}": ${err.message}`,
              { cause: err }
            )
          );
        });
      }
    );

    const onAbort = () => {
      const error = new FishDockPushError(
        `FISH-Dock card push aborted for card "${card.cardId}".`
      );
      req.destroy(error);
      finishError(error);
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    req.setTimeout(timeoutMs, () => {
      const error = new FishDockPushError(
        `FISH-Dock card push timed out after ${timeoutMs}ms for card "${card.cardId}".`
      );
      req.destroy(error);
      finishError(error);
    });

    req.on("error", (err) => {
      if (err instanceof FishDockPushError) {
        finishError(err);
        return;
      }
      finishError(
        new FishDockPushError(
          `Failed to push card "${card.cardId}" to FISH-Dock (${parsedUrl.origin}): ${err.message}`,
          { cause: err }
        )
      );
    });

    req.end(body);
  });
}
