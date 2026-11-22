import { createHash, randomBytes } from "node:crypto";
import * as http from "node:http";
import * as net from "node:net";
import type { PluginCredentialsHandle } from "@prismux/protocol";

export const DEFAULT_ONEBOT_PORTS = [3001, 3002, 5700, 6700, 8080, 8081] as const;
export const ONEBOT_ACCESS_TOKEN_CREDENTIAL_KEY = "onebot_access_token" as const;

export type OneBotImplementation = "napcat" | "lagrange" | "generic";

export interface OneBotConnectionConfig {
  mode: "forward-ws" | "reverse-ws";
  wsUrl: string;
  ownerQqId: string;
  authorizedGroups: string[];
  implementation?: OneBotImplementation;
  botQqId?: string;
  accessToken?: string;
  reverseListenHost?: string;
  reverseListenPort?: number;
  reversePath?: string;
  reconnectIntervalMs?: number;
  heartbeatIntervalMs?: number;
}

export interface SanitizedOneBotConnectionConfig {
  mode: "forward-ws" | "reverse-ws";
  wsUrl: string;
  ownerQqId: string;
  authorizedGroups: string[];
  implementation?: OneBotImplementation;
  botQqId?: string;
  hasAccessToken: boolean;
  reverseListenHost?: string;
  reverseListenPort?: number;
  reversePath?: string;
  reconnectIntervalMs?: number;
  heartbeatIntervalMs?: number;
}

export interface OneBotConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalizedConfig?: OneBotConnectionConfig;
}

export interface OneBotPortProbeOptions {
  host?: string;
  ports?: readonly number[];
  timeoutMs?: number;
  concurrency?: number;
}

export interface OneBotPortProbeEntry {
  port: number;
  host: string;
  reachable: boolean;
  latencyMs: number;
  hintImplementation: OneBotImplementation | "unknown";
  suggestedWsUrl: string;
  error?: string;
}

export interface OneBotPortProbeResult {
  host: string;
  probedPorts: number[];
  openPorts: OneBotPortProbeEntry[];
  entries: OneBotPortProbeEntry[];
  elapsedMs: number;
}

export interface OneBotMessageSegment {
  type: string;
  data: Record<string, string>;
}

export interface OneBotInboundMessageEvent {
  post_type: "message" | "message_sent";
  message_type: "private" | "group";
  sub_type?: string;
  message_id?: number | string;
  self_id?: number | string;
  user_id: number | string;
  group_id?: number | string;
  message: string | OneBotMessageSegment[];
  raw_message?: string;
  time?: number;
  sender?: {
    user_id?: number | string;
    nickname?: string;
    card?: string;
    role?: string;
  };
}

export interface OneBotActionPayload<
  TAction extends string = string,
  TParams extends Record<string, unknown> = Record<string, unknown>
> {
  action: TAction;
  params: TParams;
  echo?: string;
}

export interface OneBotAdapterPreset {
  implementation: OneBotImplementation;
  mode: "forward-ws" | "reverse-ws";
  defaultPort: number;
  wsUrl: string;
  reversePath: string;
  authHeaderFormat: "bearer" | "query_or_bearer";
  notes: string;
}

function inferPortImplementation(port: number): OneBotImplementation | "unknown" {
  if (port === 3001 || port === 3002) {
    return "napcat";
  }
  if (port === 8080 || port === 8081) {
    return "lagrange";
  }
  if (port === 5700 || port === 6700) {
    return "generic";
  }
  return "unknown";
}

function isValidPort(port: unknown): port is number {
  return (
    typeof port === "number" &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535
  );
}

function isSafeIdToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !/[\s\0/\\]/.test(value)
  );
}

export function buildOneBotAuthHeaders(
  accessToken?: string,
  botQqId?: string
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof accessToken === "string" && accessToken.length > 0) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  if (typeof botQqId === "string" && botQqId.trim().length > 0) {
    headers["X-Self-ID"] = botQqId.trim();
  }
  return headers;
}

export function buildOneBotAdapterPreset(
  implementation: OneBotImplementation,
  mode: "forward-ws" | "reverse-ws",
  options?: { host?: string; port?: number; reversePath?: string }
): OneBotAdapterPreset {
  const host = options?.host?.trim() || "127.0.0.1";
  const reversePath = options?.reversePath?.trim() || "/onebot/v11/ws";

  if (implementation === "napcat") {
    const defaultPort = mode === "forward-ws" ? 3001 : 8080;
    const port = options?.port ?? defaultPort;
    return {
      implementation,
      mode,
      defaultPort,
      wsUrl:
        mode === "forward-ws"
          ? `ws://${host}:${port}`
          : `ws://${host}:${port}${reversePath}`,
      reversePath,
      authHeaderFormat: "query_or_bearer",
      notes: "NapCatQQ OneBot v11 WebSocket adapter preset"
    };
  }

  if (implementation === "lagrange") {
    const defaultPort = mode === "forward-ws" ? 8080 : 8081;
    const port = options?.port ?? defaultPort;
    return {
      implementation,
      mode,
      defaultPort,
      wsUrl:
        mode === "forward-ws"
          ? `ws://${host}:${port}`
          : `ws://${host}:${port}${reversePath}`,
      reversePath,
      authHeaderFormat: "bearer",
      notes: "Lagrange.Core OneBot v11 WebSocket adapter preset"
    };
  }

  const defaultPort = mode === "forward-ws" ? 5700 : 8080;
  const port = options?.port ?? defaultPort;
  return {
    implementation: "generic",
    mode,
    defaultPort,
    wsUrl:
      mode === "forward-ws"
        ? `ws://${host}:${port}`
        : `ws://${host}:${port}${reversePath}`,
    reversePath,
    authHeaderFormat: "query_or_bearer",
    notes: "Generic OneBot v11 WebSocket adapter preset"
  };
}

export function validateOneBotConnectionConfig(
  config: OneBotConnectionConfig
): OneBotConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.mode !== "forward-ws" && config.mode !== "reverse-ws") {
    errors.push(`Unsupported OneBot mode "${String(config.mode)}". Expected "forward-ws" or "reverse-ws".`);
  }

  let parsedUrl: URL | null = null;
  if (typeof config.wsUrl !== "string" || config.wsUrl.trim().length === 0) {
    errors.push("wsUrl must be a non-empty WebSocket URL.");
  } else {
    try {
      parsedUrl = new URL(config.wsUrl.trim());
      if (parsedUrl.protocol !== "ws:" && parsedUrl.protocol !== "wss:") {
        errors.push(`wsUrl protocol must be ws: or wss:, got "${parsedUrl.protocol}".`);
      }
      if (!parsedUrl.hostname) {
        errors.push("wsUrl must include a valid hostname.");
      }
      if (parsedUrl.port.length > 0) {
        const parsedPort = Number(parsedUrl.port);
        if (!isValidPort(parsedPort)) {
          errors.push(`wsUrl port "${parsedUrl.port}" must be an integer between 1 and 65535.`);
        }
      }
    } catch {
      errors.push(`Invalid wsUrl "${config.wsUrl}".`);
    }
  }

  if (config.mode === "reverse-ws") {
    if (config.reverseListenPort !== undefined && !isValidPort(config.reverseListenPort)) {
      errors.push(
        `reverseListenPort must be an integer between 1 and 65535, got "${String(config.reverseListenPort)}".`
      );
    }
    if (
      config.reversePath !== undefined &&
      (!config.reversePath.startsWith("/") || /\s/.test(config.reversePath))
    ) {
      errors.push(`reversePath must start with "/" and contain no whitespace.`);
    }
  }

  if (!isSafeIdToken(config.ownerQqId)) {
    errors.push("ownerQqId must be a non-empty string without spaces or path separators.");
  }

  if (!Array.isArray(config.authorizedGroups)) {
    errors.push("authorizedGroups must be an array of group IDs.");
  } else {
    for (const groupId of config.authorizedGroups) {
      if (!isSafeIdToken(groupId)) {
        errors.push(`Invalid authorized groupId "${String(groupId)}".`);
      }
    }
  }

  if (config.botQqId !== undefined && !isSafeIdToken(config.botQqId)) {
    errors.push("botQqId, when provided, must be a non-empty ID without spaces.");
  }

  if (
    config.reconnectIntervalMs !== undefined &&
    (!Number.isFinite(config.reconnectIntervalMs) || config.reconnectIntervalMs < 100)
  ) {
    errors.push("reconnectIntervalMs must be >= 100ms.");
  }

  if (
    config.heartbeatIntervalMs !== undefined &&
    (!Number.isFinite(config.heartbeatIntervalMs) || config.heartbeatIntervalMs < 1000)
  ) {
    errors.push("heartbeatIntervalMs must be >= 1000ms.");
  }

  if (
    parsedUrl !== null &&
    (parsedUrl.protocol === "ws:" || parsedUrl.protocol === "wss:") &&
    parsedUrl.hostname !== "127.0.0.1" &&
    parsedUrl.hostname !== "localhost" &&
    parsedUrl.hostname !== "::1" &&
    !config.accessToken
  ) {
    warnings.push(
      "Remote OneBot endpoint configured without accessToken; consider enabling Bearer access_token."
    );
  }

  if (config.implementation === "lagrange" && parsedUrl !== null) {
    if (config.mode === "reverse-ws" && parsedUrl.pathname === "/") {
      warnings.push(
        "Lagrange.Core reverse-ws usually connects to a dedicated path such as /onebot/v11/ws."
      );
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  const dedupedGroups = Array.from(
    new Set(config.authorizedGroups.map((groupId) => groupId.trim()))
  );

  const normalizedConfig: OneBotConnectionConfig = {
    mode: config.mode,
    wsUrl: config.wsUrl.trim(),
    ownerQqId: config.ownerQqId.trim(),
    authorizedGroups: dedupedGroups,
    implementation: config.implementation,
    botQqId: config.botQqId?.trim(),
    accessToken: config.accessToken,
    reverseListenHost: config.reverseListenHost?.trim(),
    reverseListenPort: config.reverseListenPort,
    reversePath: config.reversePath?.trim(),
    reconnectIntervalMs: config.reconnectIntervalMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs
  };

  return {
    valid: true,
    errors,
    warnings,
    normalizedConfig
  };
}

export function sanitizeOneBotConfig(
  config: OneBotConnectionConfig
): SanitizedOneBotConnectionConfig {
  return {
    mode: config.mode,
    wsUrl: config.wsUrl,
    ownerQqId: config.ownerQqId,
    authorizedGroups: [...config.authorizedGroups],
    implementation: config.implementation,
    botQqId: config.botQqId,
    hasAccessToken: typeof config.accessToken === "string" && config.accessToken.length > 0,
    reverseListenHost: config.reverseListenHost,
    reverseListenPort: config.reverseListenPort,
    reversePath: config.reversePath,
    reconnectIntervalMs: config.reconnectIntervalMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs
  };
}

export async function saveOneBotAccessToken(
  credentials: PluginCredentialsHandle,
  accessToken: string
): Promise<void> {
  await credentials.set(ONEBOT_ACCESS_TOKEN_CREDENTIAL_KEY, accessToken);
}

export async function loadOneBotAccessToken(
  credentials: PluginCredentialsHandle
): Promise<string | null> {
  return credentials.get(ONEBOT_ACCESS_TOKEN_CREDENTIAL_KEY);
}

export async function deleteOneBotAccessToken(
  credentials: PluginCredentialsHandle
): Promise<void> {
  await credentials.delete(ONEBOT_ACCESS_TOKEN_CREDENTIAL_KEY);
}

function probeSingleTcpPort(
  host: string,
  port: number,
  timeoutMs: number
): Promise<OneBotPortProbeEntry> {
  const startedAt = Date.now();
  const hintImplementation = inferPortImplementation(port);
  const suggestedWsUrl = `ws://${host}:${port}`;

  return new Promise((resolve) => {
    let settled = false;
    const socket = new net.Socket();
    let guardTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (guardTimer !== null) {
        clearTimeout(guardTimer);
        guardTimer = null;
      }
      socket.removeAllListeners();
      if (!socket.destroyed) {
        socket.destroy();
      }
    };

    const finish = (reachable: boolean, error?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      const latencyMs = Math.max(0, Date.now() - startedAt);
      cleanup();
      resolve({
        port,
        host,
        reachable,
        latencyMs,
        hintImplementation,
        suggestedWsUrl,
        error
      });
    };

    socket.setTimeout(timeoutMs);

    guardTimer = setTimeout(() => {
      finish(false, "timeout");
    }, timeoutMs + 25);
    guardTimer.unref();

    socket.once("connect", () => {
      finish(true);
    });

    socket.once("timeout", () => {
      finish(false, "timeout");
    });

    socket.once("error", (err: NodeJS.ErrnoException) => {
      finish(false, err.code ?? err.message);
    });

    try {
      socket.connect({ host, port });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      finish(false, message);
    }
  });
}

/**
 * Probes local OneBot TCP ports with short timeouts and destroys every socket immediately
 * after probing so zero open handles or leaked sockets remain.
 */
export async function probeLocalOneBotPorts(
  options?: OneBotPortProbeOptions
): Promise<OneBotPortProbeResult> {
  const startedAt = Date.now();
  const host = options?.host?.trim() || "127.0.0.1";
  const timeoutMs = Math.max(15, Math.floor(options?.timeoutMs ?? 250));
  const rawPorts = options?.ports ?? DEFAULT_ONEBOT_PORTS;

  const probedPorts: number[] = [];
  const seen = new Set<number>();
  for (const port of rawPorts) {
    if (!isValidPort(port)) {
      throw new RangeError(`Invalid OneBot probe port "${String(port)}". Expected integer 1..65535.`);
    }
    if (!seen.has(port)) {
      seen.add(port);
      probedPorts.push(port);
    }
  }

  const concurrency = Math.max(
    1,
    Math.min(probedPorts.length || 1, Math.floor(options?.concurrency ?? 6))
  );

  const entries: OneBotPortProbeEntry[] = new Array<OneBotPortProbeEntry>(probedPorts.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      const port = probedPorts[index];
      if (port === undefined) {
        return;
      }
      entries[index] = await probeSingleTcpPort(host, port, timeoutMs);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return {
    host,
    probedPorts,
    openPorts: entries.filter((entry) => entry.reachable),
    entries,
    elapsedMs: Math.max(0, Date.now() - startedAt)
  };
}

function unescapeCqValue(raw: string): string {
  return raw
    .replaceAll("&#44;", ",")
    .replaceAll("&#91;", "[")
    .replaceAll("&#93;", "]")
    .replaceAll("&amp;", "&");
}

function unescapeCqText(raw: string): string {
  return raw
    .replaceAll("&#91;", "[")
    .replaceAll("&#93;", "]")
    .replaceAll("&amp;", "&");
}

export function parseOneBotMessageSegments(
  message: string | readonly OneBotMessageSegment[]
): OneBotMessageSegment[] {
  if (Array.isArray(message)) {
    return message.map((segment) => ({
      type: String(segment.type),
      data: Object.fromEntries(
        Object.entries(segment.data ?? {}).map(([k, v]) => [k, String(v)])
      )
    }));
  }

  const raw = String(message);
  if (raw.length === 0) {
    return [];
  }

  const segments: OneBotMessageSegment[] = [];
  const cqPattern = /\[CQ:([a-zA-Z0-9_-]+)((?:,[^,\]]+=[^\]]*)*)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = cqPattern.exec(raw);

  while (match !== null) {
    if (match.index > lastIndex) {
      const textPart = unescapeCqText(raw.slice(lastIndex, match.index));
      if (textPart.length > 0) {
        segments.push({ type: "text", data: { text: textPart } });
      }
    }

    const cqType = match[1] ?? "unknown";
    const paramsRaw = match[2] ?? "";
    const data: Record<string, string> = {};
    if (paramsRaw.length > 0) {
      const parts = paramsRaw.slice(1).split(",");
      for (const part of parts) {
        const eqIdx = part.indexOf("=");
        if (eqIdx > 0) {
          const key = part.slice(0, eqIdx).trim();
          const val = unescapeCqValue(part.slice(eqIdx + 1));
          data[key] = val;
        }
      }
    }
    segments.push({ type: cqType, data });
    lastIndex = match.index + match[0].length;
    match = cqPattern.exec(raw);
  }

  if (lastIndex < raw.length) {
    const trailing = unescapeCqText(raw.slice(lastIndex));
    if (trailing.length > 0) {
      segments.push({ type: "text", data: { text: trailing } });
    }
  }

  return segments;
}

export function extractPlainTextFromSegments(
  segments: readonly OneBotMessageSegment[]
): string {
  return segments
    .filter((segment) => segment.type === "text")
    .map((segment) => segment.data["text"] ?? "")
    .join("")
    .trim();
}

export function detectBotMention(
  message: string | readonly OneBotMessageSegment[],
  botQqId?: string,
  botAliases: readonly string[] = []
): boolean {
  const segments = parseOneBotMessageSegments(message);
  if (botQqId) {
    const matchedAt = segments.some(
      (segment) => segment.type === "at" && segment.data["qq"] === botQqId
    );
    if (matchedAt) {
      return true;
    }
  }

  if (botAliases.length > 0) {
    const plain = extractPlainTextFromSegments(segments).toLowerCase();
    for (const alias of botAliases) {
      const trimmed = alias.trim().toLowerCase();
      if (trimmed.length > 0 && plain.includes(trimmed)) {
        return true;
      }
    }
  }

  return false;
}

export function parseOneBotEvent(raw: unknown): OneBotInboundMessageEvent | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (obj["post_type"] !== "message" && obj["post_type"] !== "message_sent") {
    return null;
  }
  if (obj["message_type"] !== "private" && obj["message_type"] !== "group") {
    return null;
  }
  if (obj["user_id"] === undefined || obj["user_id"] === null) {
    return null;
  }
  if (obj["message"] === undefined && obj["raw_message"] === undefined) {
    return null;
  }

  const messageValue =
    obj["message"] !== undefined ? obj["message"] : String(obj["raw_message"]);
  const normalizedMessage: string | OneBotMessageSegment[] = Array.isArray(messageValue)
    ? parseOneBotMessageSegments(messageValue as OneBotMessageSegment[])
    : String(messageValue);

  return {
    post_type: obj["post_type"],
    message_type: obj["message_type"],
    sub_type: typeof obj["sub_type"] === "string" ? obj["sub_type"] : undefined,
    message_id:
      typeof obj["message_id"] === "string" || typeof obj["message_id"] === "number"
        ? obj["message_id"]
        : undefined,
    self_id:
      typeof obj["self_id"] === "string" || typeof obj["self_id"] === "number"
        ? obj["self_id"]
        : undefined,
    user_id: String(obj["user_id"]),
    group_id:
      obj["group_id"] !== undefined && obj["group_id"] !== null
        ? String(obj["group_id"])
        : undefined,
    message: normalizedMessage,
    raw_message:
      typeof obj["raw_message"] === "string" ? obj["raw_message"] : undefined,
    time: typeof obj["time"] === "number" ? obj["time"] : undefined,
    sender:
      typeof obj["sender"] === "object" && obj["sender"] !== null
        ? (obj["sender"] as OneBotInboundMessageEvent["sender"])
        : undefined
  };
}

export function buildOneBotSendPrivateMsgAction(
  userId: string,
  message: string | OneBotMessageSegment[],
  echo?: string
): OneBotActionPayload<"send_private_msg", { user_id: string; message: string | OneBotMessageSegment[] }> {
  return {
    action: "send_private_msg",
    params: {
      user_id: userId,
      message
    },
    echo
  };
}

export function buildOneBotSendGroupMsgAction(
  groupId: string,
  message: string | OneBotMessageSegment[],
  echo?: string
): OneBotActionPayload<"send_group_msg", { group_id: string; message: string | OneBotMessageSegment[] }> {
  return {
    action: "send_group_msg",
    params: {
      group_id: groupId,
      message
    },
    echo
  };
}

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encodeWsFrame(
  opcode: number,
  payload: Buffer,
  maskFrame: boolean
): Buffer {
  const len = payload.length;
  let headerLength = 2;
  if (len >= 126 && len <= 65535) {
    headerLength += 2;
  } else if (len > 65535) {
    headerLength += 8;
  }
  if (maskFrame) {
    headerLength += 4;
  }

  const frame = Buffer.alloc(headerLength + len);
  frame[0] = 0x80 | (opcode & 0x0f);

  let offset = 2;
  const maskBit = maskFrame ? 0x80 : 0;
  if (len < 126) {
    frame[1] = maskBit | len;
  } else if (len <= 65535) {
    frame[1] = maskBit | 126;
    frame.writeUInt16BE(len, 2);
    offset = 4;
  } else {
    frame[1] = maskBit | 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
    offset = 10;
  }

  if (maskFrame) {
    const maskKey = randomBytes(4);
    maskKey.copy(frame, offset);
    offset += 4;
    for (let i = 0; i < len; i += 1) {
      const byte = payload[i] ?? 0;
      const maskByte = maskKey[i % 4] ?? 0;
      frame[offset + i] = byte ^ maskByte;
    }
  } else {
    payload.copy(frame, offset);
  }

  return frame;
}

interface ParsedWsFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
  bytesConsumed: number;
}

function tryDecodeWsFrame(buffer: Buffer): ParsedWsFrame | null {
  if (buffer.length < 2) {
    return null;
  }
  const firstByte = buffer[0] ?? 0;
  const secondByte = buffer[1] ?? 0;
  const fin = (firstByte & 0x80) !== 0;
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLen = secondByte & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }
    payloadLen = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLen === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }
    const bigLen = buffer.readBigUInt64BE(offset);
    if (bigLen > BigInt(16 * 1024 * 1024)) {
      throw new Error("WebSocket frame exceeds 16 MiB safety limit.");
    }
    payloadLen = Number(bigLen);
    offset += 8;
  }

  const maskLen = masked ? 4 : 0;
  if (buffer.length < offset + maskLen + payloadLen) {
    return null;
  }

  let payload: Buffer;
  if (masked) {
    const maskKey = buffer.subarray(offset, offset + 4);
    offset += 4;
    payload = Buffer.alloc(payloadLen);
    for (let i = 0; i < payloadLen; i += 1) {
      payload[i] = (buffer[offset + i] ?? 0) ^ (maskKey[i % 4] ?? 0);
    }
  } else {
    payload = Buffer.from(buffer.subarray(offset, offset + payloadLen));
  }

  return {
    fin,
    opcode,
    payload,
    bytesConsumed: offset + payloadLen
  };
}

function computeWsAcceptKey(secKey: string): string {
  return createHash("sha1").update(`${secKey}${WS_GUID}`).digest("base64");
}

function attachWsFrameReader(
  socket: net.Socket,
  maskOutgoing: boolean,
  onText: (text: string) => void,
  onClose: () => void,
  onError: (err: Error) => void
): { sendText: (text: string) => void; close: () => void } {
  let pending = Buffer.alloc(0);
  let fragmentedChunks: Buffer[] = [];
  let closed = false;

  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    if (!socket.destroyed) {
      try {
        socket.write(encodeWsFrame(0x08, Buffer.alloc(0), maskOutgoing));
      } catch {
        // Ignore write error on teardown.
      }
      socket.end();
      socket.destroy();
    }
    onClose();
  };

  socket.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 2) {
      let frame: ParsedWsFrame | null = null;
      try {
        frame = tryDecodeWsFrame(pending);
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
        close();
        return;
      }
      if (frame === null) {
        break;
      }
      pending = pending.subarray(frame.bytesConsumed);

      if (frame.opcode === 0x08) {
        close();
        return;
      }
      if (frame.opcode === 0x09) {
        if (!socket.destroyed) {
          socket.write(encodeWsFrame(0x0a, frame.payload, maskOutgoing));
        }
        continue;
      }
      if (frame.opcode === 0x0a) {
        continue;
      }
      if (frame.opcode === 0x01 || frame.opcode === 0x00) {
        fragmentedChunks.push(frame.payload);
        if (frame.fin) {
          const full = Buffer.concat(fragmentedChunks).toString("utf8");
          fragmentedChunks = [];
          onText(full);
        }
      }
    }
  });

  socket.on("close", () => {
    closed = true;
    onClose();
  });

  socket.on("error", (err) => {
    onError(err);
  });

  return {
    sendText: (text: string): void => {
      if (closed || socket.destroyed) {
        throw new Error("OneBot WebSocket is not open.");
      }
      socket.write(encodeWsFrame(0x01, Buffer.from(text, "utf8"), maskOutgoing));
    },
    close
  };
}

export interface OneBotWsBridgeHandlers {
  onMessage?: (event: OneBotInboundMessageEvent) => void | Promise<void>;
  onRawFrame?: (json: unknown) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

/**
 * Zero-dependency RFC 6455 WebSocket transport supporting both OneBot `forward-ws`
 * (client connecting to NapCatQQ/Lagrange.Core) and `reverse-ws` (local HTTP upgrade server).
 */
export class OneBotWsBridge {
  private readonly config: OneBotConnectionConfig;
  private readonly handlers: OneBotWsBridgeHandlers;
  private server: http.Server | null = null;
  private activeSockets = new Set<net.Socket>();
  private activeClosers = new Set<() => void>();
  private sendFn: ((text: string) => void) | null = null;
  private connected = false;

  constructor(
    config: OneBotConnectionConfig,
    handlers?: OneBotWsBridgeHandlers
  ) {
    const validation = validateOneBotConnectionConfig(config);
    if (!validation.valid || validation.normalizedConfig === undefined) {
      throw new Error(
        `Invalid OneBot configuration: ${validation.errors.join("; ")}`
      );
    }
    this.config = validation.normalizedConfig;
    this.handlers = handlers ?? {};
  }

  isConnected(): boolean {
    return this.connected;
  }

  getListeningPort(): number | null {
    if (this.server === null) {
      return null;
    }
    const addr = this.server.address();
    if (addr && typeof addr === "object") {
      return addr.port;
    }
    return null;
  }

  async connect(): Promise<void> {
    if (this.config.mode === "forward-ws") {
      await this.connectForwardWs();
      return;
    }
    await this.startReverseWsServer();
  }

  sendAction(action: OneBotActionPayload): void {
    if (!this.connected || this.sendFn === null) {
      throw new Error("OneBotWsBridge is not connected.");
    }
    this.sendFn(JSON.stringify(action));
  }

  private handleIncomingText(rawText: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return;
    }
    this.handlers.onRawFrame?.(parsed);
    const event = parseOneBotEvent(parsed);
    if (event !== null) {
      void this.handlers.onMessage?.(event);
    }
  }

  private connectForwardWs(): Promise<void> {
    const targetUrl = new URL(this.config.wsUrl);
    if (targetUrl.protocol !== "ws:") {
      return Promise.reject(
        new Error(
          `Native lightweight forward-ws bridge supports ws:// endpoints; got "${targetUrl.protocol}".`
        )
      );
    }

    const host = targetUrl.hostname;
    const port = targetUrl.port ? Number(targetUrl.port) : 80;
    const path = `${targetUrl.pathname || "/"}${targetUrl.search || ""}`;
    const secKey = randomBytes(16).toString("base64");
    const expectedAccept = computeWsAcceptKey(secKey);

    return new Promise((resolve, reject) => {
      let handshakeDone = false;
      const headers = buildOneBotAuthHeaders(
        this.config.accessToken,
        this.config.botQqId
      );

      const req = http.request({
        hostname: host,
        port,
        path,
        method: "GET",
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": secKey,
          ...headers
        }
      });

      req.once("upgrade", (res, socket, head) => {
        const accept = res.headers["sec-websocket-accept"];
        if (accept !== expectedAccept) {
          socket.destroy();
          if (!handshakeDone) {
            handshakeDone = true;
            reject(new Error("Invalid Sec-WebSocket-Accept header from OneBot server."));
          }
          return;
        }

        handshakeDone = true;
        this.activeSockets.add(socket);
        this.connected = true;

        const wire = attachWsFrameReader(
          socket,
          true,
          (text) => this.handleIncomingText(text),
          () => {
            this.activeSockets.delete(socket);
            this.activeClosers.delete(wire.close);
            this.connected = false;
            this.sendFn = null;
            this.handlers.onClose?.();
          },
          (err) => {
            this.handlers.onError?.(err);
          }
        );

        this.sendFn = wire.sendText;
        this.activeClosers.add(wire.close);

        if (head.length > 0) {
          socket.unshift(head);
        }
        resolve();
      });

      req.once("response", (res) => {
        if (!handshakeDone) {
          handshakeDone = true;
          reject(
            new Error(`OneBot forward-ws rejected upgrade with HTTP ${res.statusCode ?? 0}.`)
          );
        }
        res.resume();
      });

      req.once("error", (err) => {
        if (!handshakeDone) {
          handshakeDone = true;
          reject(err);
        } else {
          this.handlers.onError?.(err);
        }
      });

      req.end();
    });
  }

  private startReverseWsServer(): Promise<void> {
    const parsed = new URL(this.config.wsUrl);
    const host = this.config.reverseListenHost ?? parsed.hostname ?? "127.0.0.1";
    const port =
      this.config.reverseListenPort ??
      (parsed.port ? Number(parsed.port) : 8080);
    const expectedPath = this.config.reversePath ?? (parsed.pathname || "/");

    return new Promise((resolve, reject) => {
      const server = http.createServer((_req, res) => {
        res.statusCode = 426;
        res.end("Upgrade Required");
      });

      server.on("upgrade", (req, socket, head) => {
        const reqUrl = new URL(req.url ?? "/", `http://${host}:${port}`);
        if (expectedPath !== "/" && reqUrl.pathname !== expectedPath) {
          socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
          socket.destroy();
          return;
        }

        if (this.config.accessToken) {
          const authHeader = req.headers["authorization"];
          const queryToken = reqUrl.searchParams.get("access_token");
          const expectedBearer = `Bearer ${this.config.accessToken}`;
          if (authHeader !== expectedBearer && queryToken !== this.config.accessToken) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }
        }

        const keyHeader = req.headers["sec-websocket-key"];
        const secKey = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
        if (!secKey) {
          socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
          socket.destroy();
          return;
        }

        const acceptKey = computeWsAcceptKey(secKey);
        socket.write(
          [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Accept: ${acceptKey}`,
            "",
            ""
          ].join("\r\n")
        );

        const rawSocket = socket as net.Socket;
        this.activeSockets.add(rawSocket);
        this.connected = true;

        const wire = attachWsFrameReader(
          rawSocket,
          false,
          (text) => this.handleIncomingText(text),
          () => {
            this.activeSockets.delete(rawSocket);
            this.activeClosers.delete(wire.close);
            if (this.activeSockets.size === 0) {
              this.connected = false;
              this.sendFn = null;
            }
            this.handlers.onClose?.();
          },
          (err) => {
            this.handlers.onError?.(err);
          }
        );

        this.sendFn = wire.sendText;
        this.activeClosers.add(wire.close);

        if (head.length > 0) {
          rawSocket.unshift(head);
        }
      });

      server.once("error", (err) => {
        if (this.server === null) {
          reject(err);
        } else {
          this.handlers.onError?.(err);
        }
      });

      server.listen(port, host, () => {
        this.server = server;
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    this.connected = false;
    this.sendFn = null;

    for (const closer of Array.from(this.activeClosers)) {
      try {
        closer();
      } catch {
        // Ignore teardown errors.
      }
    }
    this.activeClosers.clear();

    for (const socket of Array.from(this.activeSockets)) {
      if (!socket.destroyed) {
        socket.destroy();
      }
    }
    this.activeSockets.clear();

    if (this.server !== null) {
      const serverToClose = this.server;
      this.server = null;
      await new Promise<void>((resolve) => {
        serverToClose.close(() => resolve());
      });
    }
  }
}
