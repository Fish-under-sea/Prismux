import { createHash, createHmac } from "node:crypto";
import { Readable } from "node:stream";
import {
  readStreamWithStallWatchdog,
  requestWithStallWatchdog,
  type WatchdogHttpResponse
} from "./stallWatchdog.js";
import type {
  ConditionalWriteResult,
  GitHubSyncConfig,
  S3SyncConfig,
  SecretResolver,
  WebDavSyncConfig
} from "./types.js";
import {
  DEFAULT_METADATA_TIMEOUT_MS,
  DEFAULT_STALL_TIMEOUT_MS
} from "./types.js";

export interface ChannelRuntimeOptions {
  resolveSecret?: SecretResolver;
  stallTimeoutMs?: number;
  metadataTimeoutMs?: number;
}

export interface RemoteHeadResult {
  exists: boolean;
  etag: string | null;
  contentLength?: number;
}

export interface GitHubAccessProbeResult extends RemoteHeadResult {
  repoFullName?: string;
  isPrivate?: boolean;
  defaultBranch?: string;
  emptyRepo?: boolean;
  hasToken: boolean;
  canPush?: boolean;
}

export interface RemoteDownloadResult {
  data: Buffer;
  etag: string | null;
}

export interface WebDavEntry {
  href: string;
  etag: string | null;
  contentLength?: number;
  lastModified?: string;
}

export interface GitHubCommitSummary {
  sha: string;
  message: string;
  author?: string;
  date?: string;
}

export interface GitHubDiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface GitHubDiffPreview {
  branch: string;
  filePath: string;
  commits: GitHubCommitSummary[];
  compare?: {
    baseRef: string;
    headRef: string;
    status: string;
    aheadBy: number;
    behindBy: number;
    files: GitHubDiffFile[];
  };
  localComparison?: {
    hasRemote: boolean;
    remoteSha: string | null;
    remoteBytes: number;
    localBytes: number;
    remoteSha256: string | null;
    localSha256: string;
    changed: boolean;
  };
}

export interface GitHubRollbackResult {
  rolledBackToCommit: string;
  newCommitSha: string | null;
  etag: string | null;
  conflictDetected: boolean;
  restoredBytes: number;
}

export class SyncHttpError extends Error {
  readonly statusCode: number;
  readonly body: string;

  constructor(statusCode: number, message: string, body = "") {
    super(message);
    this.name = "SyncHttpError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

export function normalizeEtag(
  raw: string | string[] | undefined | null
): string | null {
  if (raw === undefined || raw === null) return null;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first) return null;
  let value = first.trim();
  if (value.startsWith("W/")) {
    value = value.slice(2).trim();
  }
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    value = value.slice(1, -1);
  }
  return value.length > 0 ? value : null;
}

export function formatIfMatchHeader(etag: string): string {
  const trimmed = etag.trim();
  if (trimmed === "*") return "*";
  const clean = normalizeEtag(trimmed) ?? trimmed;
  return `"${clean}"`;
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function awsUriEncode(value: string, encodeSlash = true): string {
  const encoded = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return encodeSlash ? encoded : encoded.replace(/%2F/g, "/");
}

function joinUrlPath(baseUrl: string, relativePath: string): URL {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const cleanRel = relativePath.replace(/^\/+/, "");
  const segments = cleanRel
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(decodeSafe(s)));
  url.pathname = `${basePath}/${segments.join("/")}`.replace(/\/+/g, "/");
  return url;
}

function decodeSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

async function resolveConfiguredSecret(
  inlineSecret: string | undefined,
  secretRef: string | undefined,
  resolver: SecretResolver | undefined
): Promise<string> {
  if (inlineSecret !== undefined && inlineSecret.length > 0) {
    return inlineSecret;
  }
  if (secretRef && resolver) {
    const resolved = await resolver(secretRef);
    if (resolved !== undefined) {
      return resolved;
    }
  }
  return "";
}

function extractXmlTag(xml: string, localTag: string): string | undefined {
  const regex = new RegExp(
    `<(?:[a-zA-Z0-9_-]+:)?${localTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${localTag}>`,
    "i"
  );
  const match = regex.exec(xml);
  return match?.[1]?.trim();
}

function parseWebDavPropfindXml(xml: string): WebDavEntry[] {
  const entries: WebDavEntry[] = [];
  const responseRegex =
    /<(?:[a-zA-Z0-9_-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?response>/gi;
  let match: RegExpExecArray | null;
  while ((match = responseRegex.exec(xml)) !== null) {
    const block = match[1] ?? "";
    const href = extractXmlTag(block, "href");
    if (!href) continue;
    const rawEtag = extractXmlTag(block, "getetag");
    const rawLen = extractXmlTag(block, "getcontentlength");
    const lastModified = extractXmlTag(block, "getlastmodified");
    const contentLength =
      rawLen !== undefined && /^\d+$/.test(rawLen)
        ? Number(rawLen)
        : undefined;
    entries.push({
      href,
      etag: normalizeEtag(rawEtag),
      contentLength,
      lastModified
    });
  }
  return entries;
}

async function executeConditionalPutWithHeadFallback(params: {
  channelLabel: string;
  expectedEtag: string | null;
  sendConditionalPut: () => Promise<WatchdogHttpResponse>;
  sendUnconditionalPut: () => Promise<WatchdogHttpResponse>;
  headCheck: () => Promise<RemoteHeadResult>;
}): Promise<ConditionalWriteResult> {
  const res = await params.sendConditionalPut();

  if (res.statusCode >= 200 && res.statusCode < 300) {
    return {
      etag: normalizeEtag(res.headers.etag),
      conflictDetected: false
    };
  }

  if (res.statusCode === 412 || res.statusCode === 409) {
    const currentEtag =
      normalizeEtag(res.headers.etag) ?? (await params.headCheck()).etag;
    return {
      etag: currentEtag,
      conflictDetected: true
    };
  }

  // Legacy NAS / S3 gateways rejecting conditional headers (501/400) -> degrade to HEAD ETag check.
  if (res.statusCode === 501 || res.statusCode === 400) {
    const headInfo = await params.headCheck();
    const matched =
      params.expectedEtag === null
        ? !headInfo.exists
        : headInfo.exists &&
          normalizeEtag(headInfo.etag) === normalizeEtag(params.expectedEtag);

    if (!matched) {
      return {
        etag: headInfo.etag,
        conflictDetected: true,
        degradedToHead: true
      };
    }

    const fallbackRes = await params.sendUnconditionalPut();
    if (fallbackRes.statusCode >= 200 && fallbackRes.statusCode < 300) {
      return {
        etag: normalizeEtag(fallbackRes.headers.etag),
        conflictDetected: false,
        degradedToHead: true
      };
    }

    if (fallbackRes.statusCode === 412 || fallbackRes.statusCode === 409) {
      const currentEtag =
        normalizeEtag(fallbackRes.headers.etag) ??
        (await params.headCheck()).etag;
      return {
        etag: currentEtag,
        conflictDetected: true,
        degradedToHead: true
      };
    }

    throw new SyncHttpError(
      fallbackRes.statusCode,
      `${params.channelLabel} degraded PUT failed with HTTP ${fallbackRes.statusCode}`,
      fallbackRes.body.toString("utf8")
    );
  }

  throw new SyncHttpError(
    res.statusCode,
    `${params.channelLabel} PUT failed with HTTP ${res.statusCode}`,
    res.body.toString("utf8")
  );
}

/**
 * WebDAV sync channel (Nutstore / Nextcloud / OpenMediaVault NAS).
 * Supports Basic Auth, 30s metadata timeout (`PROPFIND`/`HEAD`), 60s stall watchdog
 * (`GET`/`PUT`), `If-Match` optimistic locking, and automatic fallback to `HEAD ETag`
 * verification when legacy NAS devices return `501` or `400`.
 */
export class WebDavSyncChannel {
  readonly kind = "webdav" as const;
  private readonly config: WebDavSyncConfig;
  private readonly options: ChannelRuntimeOptions;

  constructor(config: WebDavSyncConfig, options: ChannelRuntimeOptions = {}) {
    this.config = config;
    this.options = options;
  }

  private getStallTimeoutMs(): number {
    return (
      this.config.stallTimeoutMs ??
      this.options.stallTimeoutMs ??
      DEFAULT_STALL_TIMEOUT_MS
    );
  }

  private getMetadataTimeoutMs(): number {
    return (
      this.config.metadataTimeoutMs ??
      this.options.metadataTimeoutMs ??
      DEFAULT_METADATA_TIMEOUT_MS
    );
  }

  private async getAuthHeader(): Promise<string> {
    const password = await resolveConfiguredSecret(
      this.config.password,
      this.config.passwordRef,
      this.options.resolveSecret
    );
    const token = Buffer.from(`${this.config.username}:${password}`, "utf8").toString(
      "base64"
    );
    return `Basic ${token}`;
  }

  private targetUrl(remotePath?: string): URL {
    return joinUrlPath(
      this.config.endpointUrl,
      remotePath ?? this.config.remotePath ?? "prismux-sync.prismux-backup"
    );
  }

  async propfind(
    remotePath?: string,
    depth: "0" | "1" = "1"
  ): Promise<WebDavEntry[]> {
    const url = remotePath
      ? this.targetUrl(remotePath)
      : new URL(this.config.endpointUrl);
    const auth = await this.getAuthHeader();
    const res = await requestWithStallWatchdog({
      url,
      method: "PROPFIND",
      isMetadataRequest: true,
      metadataTimeoutMs: this.getMetadataTimeoutMs(),
      rejectUnauthorized: !this.config.allowSelfSignedTls,
      headers: {
        Authorization: auth,
        Depth: depth,
        "Content-Type": "application/xml; charset=utf-8"
      },
      body: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>`
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new SyncHttpError(
        res.statusCode,
        `WebDAV PROPFIND failed with HTTP ${res.statusCode}`,
        res.body.toString("utf8")
      );
    }

    return parseWebDavPropfindXml(res.body.toString("utf8"));
  }

  async head(remotePath?: string): Promise<RemoteHeadResult> {
    const url = this.targetUrl(remotePath);
    const auth = await this.getAuthHeader();
    const res = await requestWithStallWatchdog({
      url,
      method: "HEAD",
      isMetadataRequest: true,
      metadataTimeoutMs: this.getMetadataTimeoutMs(),
      rejectUnauthorized: !this.config.allowSelfSignedTls,
      headers: {
        Authorization: auth
      }
    });

    if (res.statusCode === 404) {
      return { exists: false, etag: null };
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new SyncHttpError(
        res.statusCode,
        `WebDAV HEAD failed with HTTP ${res.statusCode}`
      );
    }

    const lenHeader = res.headers["content-length"];
    const contentLength =
      typeof lenHeader === "string" && /^\d+$/.test(lenHeader)
        ? Number(lenHeader)
        : undefined;

    return {
      exists: true,
      etag: normalizeEtag(res.headers.etag),
      contentLength
    };
  }

  async download(remotePath?: string): Promise<RemoteDownloadResult> {
    const url = this.targetUrl(remotePath);
    const auth = await this.getAuthHeader();
    const res = await requestWithStallWatchdog({
      url,
      method: "GET",
      stallTimeoutMs: this.getStallTimeoutMs(),
      rejectUnauthorized: !this.config.allowSelfSignedTls,
      headers: {
        Authorization: auth
      }
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new SyncHttpError(
        res.statusCode,
        `WebDAV GET failed with HTTP ${res.statusCode}`,
        res.body.toString("utf8")
      );
    }

    return {
      data: res.body,
      etag: normalizeEtag(res.headers.etag)
    };
  }

  async uploadConditional(
    data: Buffer | Uint8Array | Readable,
    expectedEtag: string | null,
    remotePath?: string
  ): Promise<ConditionalWriteResult> {
    const url = this.targetUrl(remotePath);
    const auth = await this.getAuthHeader();

    const payload: Buffer | Uint8Array =
      data instanceof Readable
        ? await readStreamWithStallWatchdog(data, this.getStallTimeoutMs())
        : data;

    const conditionalHeaders: Record<string, string> = {
      Authorization: auth,
      "Content-Type": "application/octet-stream"
    };
    if (expectedEtag !== null) {
      conditionalHeaders["If-Match"] = formatIfMatchHeader(expectedEtag);
    } else {
      conditionalHeaders["If-None-Match"] = "*";
    }

    return executeConditionalPutWithHeadFallback({
      channelLabel: "WebDAV",
      expectedEtag,
      headCheck: () => this.head(remotePath),
      sendConditionalPut: () =>
        requestWithStallWatchdog({
          url,
          method: "PUT",
          stallTimeoutMs: this.getStallTimeoutMs(),
          rejectUnauthorized: !this.config.allowSelfSignedTls,
          headers: conditionalHeaders,
          body: payload
        }),
      sendUnconditionalPut: () =>
        requestWithStallWatchdog({
          url,
          method: "PUT",
          stallTimeoutMs: this.getStallTimeoutMs(),
          rejectUnauthorized: !this.config.allowSelfSignedTls,
          headers: {
            Authorization: auth,
            "Content-Type": "application/octet-stream"
          },
          body: payload
        })
    });
  }
}

export interface S3SignedHeadersResult {
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

/**
 * Pure zero-dependency AWS Signature Version 4 request signer for S3-compatible stores.
 * Supports `region: "auto"` (Cloudflare R2) and path-style / virtual-hosted URLs.
 */
export function signS3Request(params: {
  method: string;
  url: URL;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  payloadHashHex: string;
  extraHeaders?: Record<string, string>;
  date?: Date;
}): S3SignedHeadersResult {
  const now = params.date ?? new Date();
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const amzDate = iso;
  const dateStamp = iso.slice(0, 8);

  const canonicalHeadersMap = new Map<string, string>();
  canonicalHeadersMap.set("host", params.url.host);
  canonicalHeadersMap.set("x-amz-content-sha256", params.payloadHashHex);
  canonicalHeadersMap.set("x-amz-date", amzDate);

  if (params.extraHeaders) {
    for (const [key, val] of Object.entries(params.extraHeaders)) {
      canonicalHeadersMap.set(key.toLowerCase(), val.trim().replace(/\s+/g, " "));
    }
  }

  const sortedHeaderKeys = Array.from(canonicalHeadersMap.keys()).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((k) => `${k}:${canonicalHeadersMap.get(k) ?? ""}\n`)
    .join("");
  const signedHeaders = sortedHeaderKeys.join(";");

  const encodedPathSegments = params.url.pathname
    .split("/")
    .map((seg) => awsUriEncode(decodeSafe(seg), true));
  const canonicalUri = encodedPathSegments.join("/") || "/";

  const queryPairs: Array<[string, string]> = [];
  params.url.searchParams.forEach((value, key) => {
    queryPairs.push([awsUriEncode(key, true), awsUriEncode(value, true)]);
  });
  queryPairs.sort((a, b) =>
    a[0] === b[0]
      ? a[1] < b[1]
        ? -1
        : a[1] > b[1]
          ? 1
          : 0
      : a[0] < b[0]
        ? -1
        : 1
  );
  const canonicalQueryString = queryPairs
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    params.method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    params.payloadHashHex
  ].join("\n");

  const credentialScope = `${dateStamp}/${params.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");

  const kDate = hmacSha256(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, params.region);
  const kService = hmacSha256(kRegion, "s3");
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = hmacSha256(kSigning, stringToSign).toString("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const outHeaders: Record<string, string> = {};
  for (const key of sortedHeaderKeys) {
    outHeaders[key] = canonicalHeadersMap.get(key) ?? "";
  }
  outHeaders["Authorization"] = authorization;

  return {
    headers: outHeaders,
    canonicalRequest,
    stringToSign,
    signature
  };
}

/**
 * S3-compatible sync channel (AWS S3, Cloudflare R2 `region: "auto"`, Backblaze B2, MinIO / NAS).
 * Uses zero-dependency SigV4 signing, supports `forcePathStyle`, self-signed LAN TLS certificates,
 * `If-Match` + fallback `HEAD ETag` optimistic locking, and 60s stall watchdog.
 */
export class S3SyncChannel {
  readonly kind = "s3" as const;
  private readonly config: S3SyncConfig;
  private readonly options: ChannelRuntimeOptions;

  constructor(config: S3SyncConfig, options: ChannelRuntimeOptions = {}) {
    this.config = config;
    this.options = options;
  }

  private getStallTimeoutMs(): number {
    return (
      this.config.stallTimeoutMs ??
      this.options.stallTimeoutMs ??
      DEFAULT_STALL_TIMEOUT_MS
    );
  }

  private getMetadataTimeoutMs(): number {
    return (
      this.config.metadataTimeoutMs ??
      this.options.metadataTimeoutMs ??
      DEFAULT_METADATA_TIMEOUT_MS
    );
  }

  buildObjectUrl(objectKey?: string): URL {
    const endpoint = new URL(this.config.endpointUrl);
    const prefix = (this.config.keyPrefix ?? "").replace(/^\/+|\/+$/g, "");
    const rawKey = (
      objectKey ??
      this.config.remoteKey ??
      "prismux-sync.prismux-backup"
    ).replace(/^\/+/, "");
    const fullKey = prefix ? `${prefix}/${rawKey}` : rawKey;
    const basePath = endpoint.pathname.replace(/\/+$/, "");

    if (this.config.forcePathStyle) {
      const target = new URL(endpoint.toString());
      target.pathname = `${basePath}/${encodeURIComponent(this.config.bucket)}/${fullKey
        .split("/")
        .map((s) => encodeURIComponent(decodeSafe(s)))
        .join("/")}`.replace(/\/+/g, "/");
      return target;
    }

    const target = new URL(endpoint.toString());
    target.hostname = `${this.config.bucket}.${endpoint.hostname}`;
    target.pathname = `${basePath}/${fullKey
      .split("/")
      .map((s) => encodeURIComponent(decodeSafe(s)))
      .join("/")}`.replace(/\/+/g, "/");
    return target;
  }

  private async getSecretAccessKey(): Promise<string> {
    return resolveConfiguredSecret(
      this.config.secretAccessKey,
      this.config.secretKeyRef,
      this.options.resolveSecret
    );
  }

  async head(objectKey?: string): Promise<RemoteHeadResult> {
    const url = this.buildObjectUrl(objectKey);
    const secretAccessKey = await this.getSecretAccessKey();
    const signed = signS3Request({
      method: "HEAD",
      url,
      region: this.config.region || "auto",
      accessKeyId: this.config.accessKeyId,
      secretAccessKey,
      payloadHashHex: sha256Hex("")
    });

    const res = await requestWithStallWatchdog({
      url,
      method: "HEAD",
      isMetadataRequest: true,
      metadataTimeoutMs: this.getMetadataTimeoutMs(),
      rejectUnauthorized: !this.config.allowSelfSignedTls,
      headers: signed.headers
    });

    if (res.statusCode === 404) {
      return { exists: false, etag: null };
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new SyncHttpError(
        res.statusCode,
        `S3 HEAD failed with HTTP ${res.statusCode}`
      );
    }

    const lenHeader = res.headers["content-length"];
    const contentLength =
      typeof lenHeader === "string" && /^\d+$/.test(lenHeader)
        ? Number(lenHeader)
        : undefined;

    return {
      exists: true,
      etag: normalizeEtag(res.headers.etag),
      contentLength
    };
  }

  async download(objectKey?: string): Promise<RemoteDownloadResult> {
    const url = this.buildObjectUrl(objectKey);
    const secretAccessKey = await this.getSecretAccessKey();
    const signed = signS3Request({
      method: "GET",
      url,
      region: this.config.region || "auto",
      accessKeyId: this.config.accessKeyId,
      secretAccessKey,
      payloadHashHex: sha256Hex("")
    });

    const res = await requestWithStallWatchdog({
      url,
      method: "GET",
      stallTimeoutMs: this.getStallTimeoutMs(),
      rejectUnauthorized: !this.config.allowSelfSignedTls,
      headers: signed.headers
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new SyncHttpError(
        res.statusCode,
        `S3 GET failed with HTTP ${res.statusCode}`,
        res.body.toString("utf8")
      );
    }

    return {
      data: res.body,
      etag: normalizeEtag(res.headers.etag)
    };
  }

  async uploadConditional(
    data: Buffer | Uint8Array | Readable,
    expectedEtag: string | null,
    objectKey?: string
  ): Promise<ConditionalWriteResult> {
    const url = this.buildObjectUrl(objectKey);
    const secretAccessKey = await this.getSecretAccessKey();

    const bodyBuffer: Buffer =
      data instanceof Readable
        ? await readStreamWithStallWatchdog(data, this.getStallTimeoutMs())
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength);

    const payloadHashHex = sha256Hex(bodyBuffer);
    const conditionalExtra: Record<string, string> = {
      "content-type": "application/octet-stream"
    };
    if (expectedEtag !== null) {
      conditionalExtra["if-match"] = formatIfMatchHeader(expectedEtag);
    } else {
      conditionalExtra["if-none-match"] = "*";
    }

    return executeConditionalPutWithHeadFallback({
      channelLabel: "S3",
      expectedEtag,
      headCheck: () => this.head(objectKey),
      sendConditionalPut: () => {
        const signed = signS3Request({
          method: "PUT",
          url,
          region: this.config.region || "auto",
          accessKeyId: this.config.accessKeyId,
          secretAccessKey,
          payloadHashHex,
          extraHeaders: conditionalExtra
        });
        return requestWithStallWatchdog({
          url,
          method: "PUT",
          stallTimeoutMs: this.getStallTimeoutMs(),
          rejectUnauthorized: !this.config.allowSelfSignedTls,
          headers: signed.headers,
          body: bodyBuffer
        });
      },
      sendUnconditionalPut: () => {
        const fallbackSigned = signS3Request({
          method: "PUT",
          url,
          region: this.config.region || "auto",
          accessKeyId: this.config.accessKeyId,
          secretAccessKey,
          payloadHashHex,
          extraHeaders: {
            "content-type": "application/octet-stream"
          }
        });
        return requestWithStallWatchdog({
          url,
          method: "PUT",
          stallTimeoutMs: this.getStallTimeoutMs(),
          rejectUnauthorized: !this.config.allowSelfSignedTls,
          headers: fallbackSigned.headers,
          body: bodyBuffer
        });
      }
    });
  }
}

/**
 * GitHub private repository sync channel backed by the GitHub Contents API (`sha`
 * optimistic locking), commit history diff preview, and point-in-time commit rollback.
 */
export class GitHubSyncChannel {
  readonly kind = "github" as const;
  private readonly config: GitHubSyncConfig;
  private readonly options: ChannelRuntimeOptions;

  constructor(config: GitHubSyncConfig, options: ChannelRuntimeOptions = {}) {
    this.config = config;
    this.options = options;
  }

  private getApiBaseUrl(): string {
    return (this.config.apiBaseUrl ?? "https://api.github.com").replace(
      /\/+$/,
      ""
    );
  }

  private getDefaultFilePath(filePath?: string): string {
    return (
      filePath ??
      this.config.filePath ??
      "vault/prismux-sync.prismux-backup"
    ).replace(/^\/+/, "");
  }

  private getStallTimeoutMs(): number {
    return (
      this.config.stallTimeoutMs ??
      this.options.stallTimeoutMs ??
      DEFAULT_STALL_TIMEOUT_MS
    );
  }

  private getMetadataTimeoutMs(): number {
    return (
      this.config.metadataTimeoutMs ??
      this.options.metadataTimeoutMs ??
      DEFAULT_METADATA_TIMEOUT_MS
    );
  }

  private encodeRepoPath(filePath: string): string {
    return filePath
      .split("/")
      .filter((s) => s.length > 0)
      .map((s) => encodeURIComponent(s))
      .join("/");
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    const token = await resolveConfiguredSecret(
      this.config.token,
      this.config.tokenRef,
      this.options.resolveSecret
    );
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "Prismux-SyncVault/1.0",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (token.length > 0) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  private repoUrl(): string {
    const base = this.getApiBaseUrl();
    const encodedOwner = encodeURIComponent(this.config.owner);
    const encodedRepo = encodeURIComponent(this.config.repo);
    return `${base}/repos/${encodedOwner}/${encodedRepo}`;
  }

  private contentsUrl(filePath: string, ref?: string): string {
    const base = this.getApiBaseUrl();
    const encodedOwner = encodeURIComponent(this.config.owner);
    const encodedRepo = encodeURIComponent(this.config.repo);
    const encodedPath = this.encodeRepoPath(filePath);
    const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    return `${base}/repos/${encodedOwner}/${encodedRepo}/contents/${encodedPath}${refQuery}`;
  }

  /**
   * Accurately verifies GitHub repository access & token authorization before probing
   * the encrypted snapshot file, distinguishing 401/403/404 repo/auth failures and
   * non-existent branches from a valid empty repo or not-yet-uploaded snapshot file.
   */
  async verifyAccess(
    filePath?: string,
    ref?: string
  ): Promise<GitHubAccessProbeResult> {
    const headers = await this.buildHeaders();
    const hasToken =
      typeof headers["Authorization"] === "string" &&
      headers["Authorization"].length > 0;
    const repoLabel = `${this.config.owner}/${this.config.repo}`;

    const repoRes = await requestWithStallWatchdog({
      url: this.repoUrl(),
      method: "GET",
      isMetadataRequest: true,
      metadataTimeoutMs: this.getMetadataTimeoutMs(),
      headers
    });

    const repoBodyText = repoRes.body.toString("utf8");
    if (repoRes.statusCode === 401) {
      throw new SyncHttpError(
        401,
        "GitHub 认证失败（HTTP 401）：Personal Access Token 无效或已过期，请检查并重新保存 Token。",
        repoBodyText
      );
    }
    if (repoRes.statusCode === 403) {
      let ghMsg = "";
      try {
        ghMsg = String(
          (JSON.parse(repoBodyText) as { message?: unknown }).message ?? ""
        );
      } catch {
        // ignore non-JSON body
      }
      const isRateLimit = /rate limit/i.test(ghMsg);
      throw new SyncHttpError(
        403,
        isRateLimit
          ? "GitHub API 请求频率受限（HTTP 403）：请稍后重试或配置已认证的 Personal Access Token。"
          : `GitHub 权限不足（HTTP 403）：Token 无权访问仓库「${repoLabel}」，请授予目标仓库 Contents 读写权限。`,
        repoBodyText
      );
    }
    if (repoRes.statusCode === 404) {
      throw new SyncHttpError(
        404,
        hasToken
          ? `未找到 GitHub 仓库「${repoLabel}」或当前 Token 无访问权限（HTTP 404）：请核对 Owner / 私有仓库名，并确认 PAT 已勾选目标仓库的 Contents 读写权限。`
          : `未找到 GitHub 仓库「${repoLabel}」或私有仓库未提供访问凭据（HTTP 404）：请填写具备目标仓库 Contents 读写权限的 Personal Access Token。`,
        repoBodyText
      );
    }
    if (repoRes.statusCode < 200 || repoRes.statusCode >= 300) {
      throw new SyncHttpError(
        repoRes.statusCode,
        `GitHub 仓库探测失败（HTTP ${repoRes.statusCode}）。`,
        repoBodyText
      );
    }

    let repoMeta: {
      full_name?: string;
      private?: boolean;
      default_branch?: string;
      size?: number;
      permissions?: { push?: boolean; pull?: boolean };
    } = {};
    try {
      repoMeta = JSON.parse(repoBodyText) as typeof repoMeta;
    } catch {
      // keep defaults if response wasn't JSON
    }

    const targetPath = this.getDefaultFilePath(filePath);
    const targetBranch = ref ?? this.config.branch;
    const contentsRes = await requestWithStallWatchdog({
      url: this.contentsUrl(targetPath, targetBranch),
      method: "GET",
      isMetadataRequest: true,
      metadataTimeoutMs: this.getMetadataTimeoutMs(),
      headers
    });
    const contentsBodyText = contentsRes.body.toString("utf8");

    if (contentsRes.statusCode === 401) {
      throw new SyncHttpError(
        401,
        "GitHub 内容读取认证失败（HTTP 401）：Personal Access Token 无效或已过期。",
        contentsBodyText
      );
    }
    if (contentsRes.statusCode === 403) {
      throw new SyncHttpError(
        403,
        `GitHub 仓库内容访问被拒绝（HTTP 403）：请确认 Token 具备「${repoLabel}」的 Contents 读写权限。`,
        contentsBodyText
      );
    }
    if (contentsRes.statusCode === 404) {
      let ghMsg = "";
      try {
        ghMsg = String(
          (JSON.parse(contentsBodyText) as { message?: unknown }).message ?? ""
        );
      } catch {
        // ignore non-JSON body
      }
      const isEmptyRepo =
        /repository is empty/i.test(ghMsg) || repoMeta.size === 0;
      if (!isEmptyRepo && /no commit found for the ref/i.test(ghMsg)) {
        const defaultHint = repoMeta.default_branch
          ? `（仓库默认分支为「${repoMeta.default_branch}」）`
          : "";
        throw new SyncHttpError(
          404,
          `GitHub 分支「${targetBranch}」在仓库「${repoLabel}」中不存在${defaultHint}，请修正分支名称。`,
          contentsBodyText
        );
      }
      return {
        exists: false,
        etag: null,
        repoFullName: repoMeta.full_name ?? repoLabel,
        isPrivate: repoMeta.private,
        defaultBranch: repoMeta.default_branch,
        emptyRepo: isEmptyRepo,
        hasToken,
        ...(typeof repoMeta.permissions?.push === "boolean"
          ? { canPush: repoMeta.permissions.push }
          : {})
      };
    }
    if (contentsRes.statusCode < 200 || contentsRes.statusCode >= 300) {
      throw new SyncHttpError(
        contentsRes.statusCode,
        `GitHub Contents 探测失败（HTTP ${contentsRes.statusCode}）。`,
        contentsBodyText
      );
    }

    const parsed = JSON.parse(contentsBodyText) as {
      sha?: string;
      size?: number;
    };
    return {
      exists: true,
      etag: parsed.sha ?? null,
      contentLength: parsed.size,
      repoFullName: repoMeta.full_name ?? repoLabel,
      isPrivate: repoMeta.private,
      defaultBranch: repoMeta.default_branch,
      emptyRepo: false,
      hasToken,
      ...(typeof repoMeta.permissions?.push === "boolean"
        ? { canPush: repoMeta.permissions.push }
        : {})
    };
  }

  async head(filePath?: string, ref?: string): Promise<RemoteHeadResult> {
    const targetPath = this.getDefaultFilePath(filePath);
    const url = this.contentsUrl(targetPath, ref ?? this.config.branch);
    const headers = await this.buildHeaders();
    const res = await requestWithStallWatchdog({
      url,
      method: "GET",
      isMetadataRequest: true,
      metadataTimeoutMs: this.getMetadataTimeoutMs(),
      headers
    });

    if (res.statusCode === 404) {
      return { exists: false, etag: null };
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new SyncHttpError(
        res.statusCode,
        `GitHub Contents HEAD/GET failed with HTTP ${res.statusCode}`,
        res.body.toString("utf8")
      );
    }

    const parsed = JSON.parse(res.body.toString("utf8")) as {
      sha?: string;
      size?: number;
    };
    return {
      exists: true,
      etag: parsed.sha ?? null,
      contentLength: parsed.size
    };
  }

  async download(filePath?: string, ref?: string): Promise<RemoteDownloadResult> {
    const targetPath = this.getDefaultFilePath(filePath);
    const url = this.contentsUrl(targetPath, ref ?? this.config.branch);
    const headers = await this.buildHeaders();
    const res = await requestWithStallWatchdog({
      url,
      method: "GET",
      stallTimeoutMs: this.getStallTimeoutMs(),
      headers
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new SyncHttpError(
        res.statusCode,
        `GitHub Contents GET failed with HTTP ${res.statusCode}`,
        res.body.toString("utf8")
      );
    }

    const parsed = JSON.parse(res.body.toString("utf8")) as {
      content?: string;
      encoding?: string;
      sha?: string;
    };

    let b64 = parsed.content ?? "";
    if (b64.length === 0 && parsed.sha) {
      const blobUrl = `${this.getApiBaseUrl()}/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/git/blobs/${encodeURIComponent(parsed.sha)}`;
      const blobRes = await requestWithStallWatchdog({
        url: blobUrl,
        method: "GET",
        stallTimeoutMs: this.getStallTimeoutMs(),
        headers
      });
      if (blobRes.statusCode < 200 || blobRes.statusCode >= 300) {
        throw new SyncHttpError(
          blobRes.statusCode,
          `GitHub Git Blob GET failed with HTTP ${blobRes.statusCode}`,
          blobRes.body.toString("utf8")
        );
      }
      const blobJson = JSON.parse(blobRes.body.toString("utf8")) as {
        content?: string;
      };
      b64 = blobJson.content ?? "";
    }

    const data = Buffer.from(b64.replace(/\s+/g, ""), "base64");
    return {
      data,
      etag: parsed.sha ?? null
    };
  }

  async uploadConditional(
    data: Buffer | Uint8Array | Readable,
    expectedSha: string | null,
    filePath?: string,
    commitMessage = "chore(sync-vault): update encrypted backup snapshot"
  ): Promise<ConditionalWriteResult> {
    const targetPath = this.getDefaultFilePath(filePath);
    const bodyBuffer: Buffer =
      data instanceof Readable
        ? await readStreamWithStallWatchdog(data, this.getStallTimeoutMs())
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength);

    const payload: Record<string, string> = {
      message: commitMessage,
      content: bodyBuffer.toString("base64"),
      branch: this.config.branch
    };
    if (expectedSha !== null) {
      payload["sha"] = expectedSha;
    }

    const headers = await this.buildHeaders();
    headers["Content-Type"] = "application/json; charset=utf-8";

    const res = await requestWithStallWatchdog({
      url: this.contentsUrl(targetPath),
      method: "PUT",
      stallTimeoutMs: this.getStallTimeoutMs(),
      headers,
      body: JSON.stringify(payload)
    });

    if (res.statusCode >= 200 && res.statusCode < 300) {
      const parsed = JSON.parse(res.body.toString("utf8")) as {
        content?: { sha?: string };
        commit?: { sha?: string };
      };
      return {
        etag: parsed.content?.sha ?? null,
        commitSha: parsed.commit?.sha,
        conflictDetected: false
      };
    }

    if (
      res.statusCode === 409 ||
      res.statusCode === 422 ||
      res.statusCode === 412
    ) {
      const currentHead = await this.head(targetPath).catch(() => ({
        exists: false,
        etag: null
      }));
      return {
        etag: currentHead.etag,
        conflictDetected: true
      };
    }

    throw new SyncHttpError(
      res.statusCode,
      `GitHub Contents PUT failed with HTTP ${res.statusCode}`,
      res.body.toString("utf8")
    );
  }

  async previewDiff(options?: {
    baseRef?: string;
    headRef?: string;
    filePath?: string;
    localBytes?: Uint8Array;
  }): Promise<GitHubDiffPreview> {
    const targetPath = this.getDefaultFilePath(options?.filePath);
    const headers = await this.buildHeaders();
    const base = this.getApiBaseUrl();
    const owner = encodeURIComponent(this.config.owner);
    const repo = encodeURIComponent(this.config.repo);

    const commitsUrl = `${base}/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(this.config.branch)}&path=${encodeURIComponent(targetPath)}&per_page=10`;
    const commitsRes = await requestWithStallWatchdog({
      url: commitsUrl,
      method: "GET",
      isMetadataRequest: true,
      metadataTimeoutMs: this.getMetadataTimeoutMs(),
      headers
    });

    let commits: GitHubCommitSummary[] = [];
    if (commitsRes.statusCode >= 200 && commitsRes.statusCode < 300) {
      const rawCommits = JSON.parse(commitsRes.body.toString("utf8")) as Array<{
        sha: string;
        commit?: {
          message?: string;
          author?: { name?: string; date?: string };
        };
      }>;
      commits = rawCommits.map((item) => ({
        sha: item.sha,
        message: item.commit?.message ?? "",
        author: item.commit?.author?.name,
        date: item.commit?.author?.date
      }));
    } else if (commitsRes.statusCode !== 404) {
      throw new SyncHttpError(
        commitsRes.statusCode,
        `GitHub commits lookup failed with HTTP ${commitsRes.statusCode}`,
        commitsRes.body.toString("utf8")
      );
    }

    const baseRef = options?.baseRef ?? commits[1]?.sha;
    const headRef = options?.headRef ?? commits[0]?.sha;
    let compare: GitHubDiffPreview["compare"];

    if (baseRef && headRef) {
      const compareUrl = `${base}/repos/${owner}/${repo}/compare/${encodeURIComponent(baseRef)}...${encodeURIComponent(headRef)}`;
      const compareRes = await requestWithStallWatchdog({
        url: compareUrl,
        method: "GET",
        isMetadataRequest: true,
        metadataTimeoutMs: this.getMetadataTimeoutMs(),
        headers
      });
      if (compareRes.statusCode >= 200 && compareRes.statusCode < 300) {
        const rawCompare = JSON.parse(compareRes.body.toString("utf8")) as {
          status?: string;
          ahead_by?: number;
          behind_by?: number;
          files?: GitHubDiffFile[];
        };
        compare = {
          baseRef,
          headRef,
          status: rawCompare.status ?? "diverged",
          aheadBy: rawCompare.ahead_by ?? 0,
          behindBy: rawCompare.behind_by ?? 0,
          files: rawCompare.files ?? []
        };
      }
    }

    let localComparison: GitHubDiffPreview["localComparison"];
    if (options?.localBytes !== undefined) {
      const localBuf = Buffer.isBuffer(options.localBytes)
        ? options.localBytes
        : Buffer.from(
            options.localBytes.buffer,
            options.localBytes.byteOffset,
            options.localBytes.byteLength
          );
      const localSha256 = sha256Hex(localBuf);
      try {
        const remote = await this.download(targetPath);
        const remoteSha256 = sha256Hex(remote.data);
        localComparison = {
          hasRemote: true,
          remoteSha: remote.etag,
          remoteBytes: remote.data.length,
          localBytes: localBuf.length,
          remoteSha256,
          localSha256,
          changed: remoteSha256 !== localSha256
        };
      } catch (err) {
        if (err instanceof SyncHttpError && err.statusCode === 404) {
          localComparison = {
            hasRemote: false,
            remoteSha: null,
            remoteBytes: 0,
            localBytes: localBuf.length,
            remoteSha256: null,
            localSha256,
            changed: true
          };
        } else {
          throw err;
        }
      }
    }

    return {
      branch: this.config.branch,
      filePath: targetPath,
      commits,
      compare,
      localComparison
    };
  }

  async rollbackToCommit(
    commitSha: string,
    filePath?: string
  ): Promise<GitHubRollbackResult> {
    const targetPath = this.getDefaultFilePath(filePath);
    const historical = await this.download(targetPath, commitSha);
    const currentHead = await this.head(targetPath, this.config.branch);

    const writeRes = await this.uploadConditional(
      historical.data,
      currentHead.etag,
      targetPath,
      `revert(sync-vault): rollback ${targetPath} to ${commitSha}`
    );

    return {
      rolledBackToCommit: commitSha,
      newCommitSha: writeRes.commitSha ?? null,
      etag: writeRes.etag,
      conflictDetected: writeRes.conflictDetected,
      restoredBytes: historical.data.length
    };
  }
}
