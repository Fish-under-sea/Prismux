import type * as NodeHttp from "node:http";

type IncomingMessage = NodeHttp.IncomingMessage;

const ALLOWED_DESKTOP_ORIGIN_RE = /^prismux(?:-dev)?:\/\/[a-z0-9][a-z0-9._-]*$/i;
const ALLOWED_LOOPBACK_ORIGIN_RE =
  /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/i;

/**
 * Strict CORS and WebSocket `Origin` allowlist for Prismux Daemon:
 * - Allows ONLY `prismux://`, `prismux-dev://`, and exact loopback HTTP origins
 *   (`http://127.0.0.1:<port>`, `http://localhost:<port>`, `http://[::1]:<port>`).
 * - Explicitly rejects `"null"`, `"*"`, `file://`, `app://`, `tauri://`, and all remote origins.
 */
export function isAllowedCorsOrigin(origin: string): boolean {
  if (typeof origin !== "string") {
    return false;
  }
  const trimmed = origin.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === "null" || trimmed === "*") {
    return false;
  }
  if (ALLOWED_DESKTOP_ORIGIN_RE.test(trimmed)) {
    return true;
  }
  const loopbackMatch = ALLOWED_LOOPBACK_ORIGIN_RE.exec(trimmed);
  if (loopbackMatch !== null) {
    const port = Number.parseInt(loopbackMatch[1]!, 10);
    return Number.isInteger(port) && port >= 1 && port <= 65535;
  }
  return false;
}

/**
 * Returns validated CORS response headers for `req`, reflecting ONLY allowlisted
 * `Origin` values (never `"*"` or `"null"`). Omits CORS headers when `Origin` is
 * absent or untrusted.
 */
export function buildValidatedCorsHeaders(
  req: IncomingMessage
): Record<string, string> {
  const rawOrigin = req.headers.origin;
  if (typeof rawOrigin !== "string") {
    return {};
  }
  const trimmed = rawOrigin.trim();
  if (!isAllowedCorsOrigin(trimmed)) {
    return {};
  }
  return {
    "access-control-allow-origin": trimmed,
    vary: "Origin"
  };
}
