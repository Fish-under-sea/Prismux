import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DISPATCH_TASK_STATUSES,
  isDispatchCallerKind,
  type CallerScope,
  type DispatchCallerKind,
  type DispatchCompleteRequest,
  type DispatchTaskStatus
} from "@prismux/protocol";
import {
  DesktopIpcDispatchHub,
  DispatchHubError
} from "../dispatch/DesktopIpcDispatchHub.js";
import { AntigravityGuardDeniedError } from "../security/AntigravityPolicyGuard.js";
import {
  AntigravityPolicyError,
  SubscriptionWaiverStore
} from "../security/AntigravityPolicyStore.js";

export interface DispatchRouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  callerScope: CallerScope;
  readJsonBody: () => Promise<unknown>;
  registerSseCleanup: (cleanup: () => void) => void;
  unregisterSseCleanup: (cleanup: () => void) => void;
}

export interface DispatchRouteDeps {
  policyStore?: SubscriptionWaiverStore;
  waiverStore?: SubscriptionWaiverStore;
  dispatchHub?: DesktopIpcDispatchHub;
}

function writeJson(
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOwnerScope(
  callerScope: CallerScope,
  res: ServerResponse,
  pathname: string
): boolean {
  if (callerScope !== "owner_chief") {
    writeJson(res, 403, {
      ok: false,
      error: {
        code: "FORBIDDEN_SCOPE",
        message: `Scope "${callerScope}" is not permitted to access ${pathname}.`
      }
    });
    return false;
  }
  return true;
}

function writeHandledError(res: ServerResponse, err: unknown): void {
  if (err instanceof AntigravityPolicyError) {
    writeJson(res, err.statusCode, {
      ok: false,
      code: err.code,
      message: err.message,
      error: { code: err.code, message: err.message }
    });
    return;
  }
  if (err instanceof AntigravityGuardDeniedError) {
    const blocked = err.toBlockedPayload();
    if (blocked !== null) {
      writeJson(res, err.statusCode, {
        ...blocked,
        error: {
          code: blocked.code,
          reasonCode: blocked.reasonCode,
          message: blocked.message
        },
        ...(err.decision !== undefined ? { decision: err.decision } : {})
      });
      return;
    }
    writeJson(res, err.statusCode, {
      ok: false,
      code: err.code,
      ...(err.reasonCode !== undefined ? { reasonCode: err.reasonCode } : {}),
      message: err.message,
      error: {
        code: err.code,
        ...(err.reasonCode !== undefined ? { reasonCode: err.reasonCode } : {}),
        message: err.message
      },
      ...(err.decision !== undefined ? { decision: err.decision } : {})
    });
    return;
  }
  if (err instanceof DispatchHubError) {
    writeJson(res, err.statusCode, {
      ok: false,
      code: err.code,
      message: err.message,
      error: { code: err.code, message: err.message }
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  writeJson(res, 500, {
    ok: false,
    code: "DISPATCH_INTERNAL_ERROR",
    message,
    error: { code: "DISPATCH_INTERNAL_ERROR", message }
  });
}

function startDispatchSseStream(
  ctx: DispatchRouteContext,
  hub: DesktopIpcDispatchHub
): void {
  const { req, res } = ctx;
  req.socket?.setTimeout?.(0);
  req.socket?.setNoDelay?.(true);
  req.socket?.setKeepAlive?.(true, 15_000);
  res.setTimeout?.(0);

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
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
      res.write(
        `id: ${seq}\nevent: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`
      );
    } catch {
      cleanup();
    }
  };

  sendEvent("connected", {
    ok: true,
    connectedAt: new Date().toISOString(),
    pendingCount: hub.getPendingQueueSize()
  });

  const unsubscribe = hub.subscribeEvents((evt) => {
    sendEvent(evt.event, evt.data);
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
    ctx.unregisterSseCleanup(cleanup);
    try {
      if (!res.writableEnded) {
        res.end();
      }
    } catch {
      // Ignore stream close errors.
    }
  };

  ctx.registerSseCleanup(cleanup);
  req.once("close", cleanup);
  req.once("aborted", cleanup);
  res.once("close", cleanup);
  res.once("error", cleanup);
}

/**
 * Checks whether a pathname belongs to DispatchRoutes or Subscription/AGY security policy routes.
 */
export function isDispatchOrSecurityRoute(pathname: string): boolean {
  return (
    pathname === "/v1/security/subscription-waiver" ||
    pathname === "/v1/security/antigravity-policy" ||
    pathname === "/v1/dispatch/events" ||
    pathname === "/v1/dispatch/thread" ||
    pathname === "/v1/dispatch/tasks" ||
    pathname.startsWith("/v1/dispatch/")
  );
}

/**
 * Handles:
 * - `GET /v1/security/subscription-waiver`
 * - `PUT /v1/security/subscription-waiver`
 * - `DELETE /v1/security/subscription-waiver`
 * - `GET /v1/security/antigravity-policy` (backward-compatible)
 * - `PUT /v1/security/antigravity-policy` (backward-compatible)
 * - `GET /v1/dispatch/events` (SSE)
 * - `POST /v1/dispatch/thread`
 * - `GET /v1/dispatch/tasks`
 * - `POST /v1/dispatch/:taskId/confirm`
 * - `POST /v1/dispatch/:taskId/cancel`
 * - `POST /v1/dispatch/:taskId/complete`
 */
export async function handleDispatchRoute(
  ctx: DispatchRouteContext,
  deps: DispatchRouteDeps
): Promise<boolean> {
  const { method, pathname, res, callerScope } = ctx;

  if (!isDispatchOrSecurityRoute(pathname)) {
    return false;
  }

  if (!assertOwnerScope(callerScope, res, pathname)) {
    return true;
  }

  const resolvedStore = deps.waiverStore ?? deps.policyStore;

  // 1a. Unified Personal Subscription Risk Waiver Endpoints
  if (pathname === "/v1/security/subscription-waiver") {
    if (!resolvedStore) {
      writeJson(res, 503, {
        ok: false,
        code: "WAIVER_STORE_UNAVAILABLE",
        message: "SubscriptionWaiverStore is not configured.",
        error: {
          code: "WAIVER_STORE_UNAVAILABLE",
          message: "SubscriptionWaiverStore is not configured."
        }
      });
      return true;
    }

    try {
      if (method === "GET") {
        writeJson(res, 200, resolvedStore.getWaiver());
        return true;
      }
      if (method === "PUT") {
        const body = await ctx.readJsonBody();
        const updated = resolvedStore.updateWaiver(body);
        writeJson(res, 200, updated);
        return true;
      }
      if (method === "DELETE") {
        const revoked = resolvedStore.revokeWaiver();
        writeJson(res, 200, revoked);
        return true;
      }
      writeJson(res, 405, {
        ok: false,
        code: "METHOD_NOT_ALLOWED",
        message: `Method ${method} is not allowed on ${pathname}.`,
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: `Method ${method} is not allowed on ${pathname}.`
        }
      });
      return true;
    } catch (err) {
      writeHandledError(res, err);
      return true;
    }
  }

  // 1b. Backward-compatible AGY Role Hard-Lock Policy Endpoints
  if (pathname === "/v1/security/antigravity-policy") {
    if (!resolvedStore) {
      writeJson(res, 503, {
        ok: false,
        error: {
          code: "POLICY_STORE_UNAVAILABLE",
          message: "AntigravityPolicyStore is not configured."
        }
      });
      return true;
    }

    try {
      if (method === "GET") {
        writeJson(res, 200, resolvedStore.getPolicy());
        return true;
      }
      if (method === "PUT") {
        const body = await ctx.readJsonBody();
        const updated = resolvedStore.updatePolicy(body);
        writeJson(res, 200, updated);
        return true;
      }
      writeJson(res, 405, {
        ok: false,
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: `Method ${method} is not allowed on ${pathname}.`
        }
      });
      return true;
    } catch (err) {
      writeHandledError(res, err);
      return true;
    }
  }

  // 2. Electron IPC Dispatch Hub Endpoints
  if (!deps.dispatchHub) {
    writeJson(res, 503, {
      ok: false,
      error: {
        code: "DISPATCH_HUB_UNAVAILABLE",
        message: "DesktopIpcDispatchHub is not configured."
      }
    });
    return true;
  }

  try {
    if (method === "GET" && pathname === "/v1/dispatch/events") {
      startDispatchSseStream(ctx, deps.dispatchHub);
      return true;
    }

    if (method === "POST" && pathname === "/v1/dispatch/thread") {
      const body = await ctx.readJsonBody();
      const result = await deps.dispatchHub.dispatchThread(
        isPlainObject(body) ? body : {}
      );
      const { httpStatus, ...payload } = result;
      writeJson(res, httpStatus, payload);
      return true;
    }

    if (method === "GET" && pathname === "/v1/dispatch/tasks") {
      const statusParam = ctx.searchParams.get("status")?.trim();
      const callerKindParam = ctx.searchParams.get("callerKind")?.trim();
      let status: DispatchTaskStatus | undefined;
      if (statusParam) {
        if ((DISPATCH_TASK_STATUSES as readonly string[]).includes(statusParam)) {
          status = statusParam as DispatchTaskStatus;
        } else {
          writeJson(res, 400, {
            ok: false,
            error: {
              code: "INVALID_QUERY_PARAM",
              message: `Invalid status filter: "${statusParam}".`
            }
          });
          return true;
        }
      }
      let callerKind: DispatchCallerKind | undefined;
      if (callerKindParam) {
        if (isDispatchCallerKind(callerKindParam)) {
          callerKind = callerKindParam;
        } else {
          writeJson(res, 400, {
            ok: false,
            error: {
              code: "INVALID_QUERY_PARAM",
              message: `Invalid callerKind filter: "${callerKindParam}".`
            }
          });
          return true;
        }
      }
      const list = deps.dispatchHub.listTasks({
        ...(status !== undefined ? { status } : {}),
        ...(callerKind !== undefined ? { callerKind } : {})
      });
      writeJson(res, 200, list);
      return true;
    }

    const actionMatch = /^\/v1\/dispatch\/([^/]+)\/(confirm|cancel|complete)$/.exec(
      pathname
    );
    if (method === "POST" && actionMatch !== null) {
      const rawTaskId = actionMatch[1]!;
      const action = actionMatch[2]!;
      let taskId: string;
      try {
        taskId = decodeURIComponent(rawTaskId);
      } catch {
        taskId = rawTaskId;
      }

      const rawBody = await ctx.readJsonBody();
      const body = isPlainObject(rawBody) ? rawBody : {};

      if (action === "confirm") {
        const confirmed = await deps.dispatchHub.confirmTask(
          taskId,
          body["confirmedBy"]
        );
        writeJson(res, 200, confirmed);
        return true;
      }

      if (action === "cancel") {
        const reason =
          typeof body["reason"] === "string" ? body["reason"] : undefined;
        const cancelled = await deps.dispatchHub.cancelTask(taskId, reason);
        writeJson(res, 200, cancelled);
        return true;
      }

      if (action === "complete") {
        const completeReq: DispatchCompleteRequest = {
          ...(typeof body["threadId"] === "string"
            ? { threadId: body["threadId"] }
            : {}),
          ...(typeof body["workspacePath"] === "string"
            ? { workspacePath: body["workspacePath"] }
            : {}),
          ...(typeof body["finalAssistantText"] === "string"
            ? { finalAssistantText: body["finalAssistantText"] }
            : {}),
          ...(Array.isArray(body["modifiedFiles"])
            ? {
                modifiedFiles: body["modifiedFiles"].filter(
                  (f): f is string => typeof f === "string"
                )
              }
            : {}),
          ...(isPlainObject(body["diffStats"]) &&
          typeof body["diffStats"]["filesChanged"] === "number" &&
          typeof body["diffStats"]["insertions"] === "number" &&
          typeof body["diffStats"]["deletions"] === "number"
            ? {
                diffStats: {
                  filesChanged: body["diffStats"]["filesChanged"],
                  insertions: body["diffStats"]["insertions"],
                  deletions: body["diffStats"]["deletions"]
                }
              }
            : {}),
          ...(typeof body["branchName"] === "string"
            ? { branchName: body["branchName"] }
            : {}),
          ...(typeof body["commitSha"] === "string"
            ? { commitSha: body["commitSha"] }
            : {}),
          ...(typeof body["testPassed"] === "boolean"
            ? { testPassed: body["testPassed"] }
            : {}),
          ...(typeof body["baseRef"] === "string"
            ? { baseRef: body["baseRef"] }
            : {}),
          ...(typeof body["skipGitInspection"] === "boolean"
            ? { skipGitInspection: body["skipGitInspection"] }
            : {}),
          ...(typeof body["callbackTargetProvider"] === "string"
            ? { callbackTargetProvider: body["callbackTargetProvider"] }
            : {}),
          ...(typeof body["humanConfirmed"] === "boolean"
            ? { humanConfirmed: body["humanConfirmed"] }
            : {})
        };
        const completed = await deps.dispatchHub.completeTask(
          taskId,
          completeReq
        );
        writeJson(res, 200, completed);
        return true;
      }
    }

    return false;
  } catch (err) {
    writeHandledError(res, err);
    return true;
  }
}
