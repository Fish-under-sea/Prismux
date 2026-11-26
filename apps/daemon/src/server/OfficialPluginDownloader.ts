import { createHash } from "node:crypto";
import * as http from "node:http";
import * as https from "node:https";
import { ChecksumMismatchError } from "@prismux/cordis-kernel";
import {
  UPDATE_ENDPOINTS,
  type NetworkRoutePreference,
  type OfficialPluginCatalogEntry
} from "@prismux/protocol";

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const GITEE_SUBDOMAIN_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.gitee\.com$/i;
const SENSITIVE_REDIRECT_HEADERS = new Set<string>([
  "authorization",
  "cookie",
  "proxy-authorization"
]);

const OFFICIAL_PLUGIN_ALLOWED_EXACT_HOSTS = new Set<string>([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
  "gitee.com"
]);

function isLoopbackHostname(hostname: string): boolean {
  const lower = hostname.trim().toLowerCase();
  return lower === "127.0.0.1" || lower === "localhost" || lower === "[::1]" || lower === "::1";
}

function stripSensitiveRedirectHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!SENSITIVE_REDIRECT_HEADERS.has(key.toLowerCase())) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export interface OfficialPluginSourceConfig {
  githubOwner?: string;
  githubRepo?: string;
  githubWebBase?: string;
  giteeOwner?: string;
  giteeRepo?: string;
  giteeWebBase?: string;
  npmRegistryUrl?: string;
  npmMirrorRegistryUrl?: string;
  customGhProxyPrefix?: string;
  timeoutMs?: number;
  maxArchiveBytes?: number;
  disableRemoteFallback?: boolean;
  /**
   * Test-only opt-in allowing `http://127.0.0.1` / `http://localhost` mirror URLs.
   * Must NEVER be enabled in production.
   */
  allowInsecureLoopbackForTesting?: boolean;
}

export interface OfficialDownloadAttempt {
  source: string;
  url: string;
  ok: boolean;
  statusCode?: number;
  reason?: string;
}

export type OfficialArchiveDownloadResult =
  | {
      ok: true;
      bytes: Buffer;
      sha256: string;
      sourceUsed: string;
      attempts: OfficialDownloadAttempt[];
    }
  | {
      ok: false;
      tamperError?: ChecksumMismatchError;
      attempts: OfficialDownloadAttempt[];
    };

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function applyGhProxy(
  url: string,
  proxyPrefix?: string,
  allowInsecureLoopbackForTesting = false
): string | null {
  const trimmed = proxyPrefix?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid customGhProxyPrefix URL: "${trimmed}".`);
  }
  const isLoopback = isLoopbackHostname(parsed.hostname);
  if (
    parsed.protocol !== "https:" &&
    !(allowInsecureLoopbackForTesting && parsed.protocol === "http:" && isLoopback)
  ) {
    throw new Error(
      `customGhProxyPrefix must use https://, got "${trimmed}".`
    );
  }
  const normalized = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  return `${normalized}${url}`;
}

export function getOfficialPluginCandidateAssetNames(
  pluginId: string,
  version: string
): string[] {
  const cleanId = pluginId.trim();
  const canonicalName = cleanId.startsWith("prismux-plugin-")
    ? `${cleanId}-${version}.wb-plugin`
    : `prismux-plugin-${cleanId}-${version}.wb-plugin`;
  const legacyName = `${cleanId}-${version}.wb-plugin`;
  return canonicalName === legacyName
    ? [canonicalName]
    : [canonicalName, legacyName];
}

export function buildOfficialPluginReleaseUrls(
  entry: OfficialPluginCatalogEntry,
  preference: NetworkRoutePreference = "auto",
  config?: OfficialPluginSourceConfig,
  recommendedSource?: "github" | "gitee"
): Array<{ source: string; url: string }> {
  const candidates: Array<{ source: string; url: string }> = [];
  const seen = new Set<string>();
  const add = (source: string, rawUrl: string): void => {
    const trimmed = rawUrl.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    candidates.push({ source, url: trimmed });
  };

  // 1. Explicit URLs declared on catalog entry take top priority.
  if (typeof entry.downloadUrl === "string" && entry.downloadUrl.trim().length > 0) {
    add("catalog-url", entry.downloadUrl);
  }
  if (Array.isArray(entry.downloadUrls)) {
    for (const url of entry.downloadUrls) {
      if (typeof url === "string" && url.trim().length > 0) {
        add("catalog-url", url);
      }
    }
  }

  const tag = entry.version.startsWith("v") ? entry.version : `v${entry.version}`;
  const assetNames = getOfficialPluginCandidateAssetNames(entry.id, entry.version);

  const githubWebBase = normalizeBaseUrl(
    config?.githubWebBase ?? UPDATE_ENDPOINTS.githubWebBase
  );
  const githubOwner = config?.githubOwner ?? UPDATE_ENDPOINTS.githubOwner;
  const githubRepo = config?.githubRepo ?? UPDATE_ENDPOINTS.githubRepo;

  const giteeWebBase = normalizeBaseUrl(
    config?.giteeWebBase ?? UPDATE_ENDPOINTS.giteeWebBase
  );
  const giteeOwner = config?.giteeOwner ?? UPDATE_ENDPOINTS.giteeOwner;
  const giteeRepo = config?.giteeRepo ?? UPDATE_ENDPOINTS.giteeRepo;

  const allowLoopback = config?.allowInsecureLoopbackForTesting === true;
  const githubEntries: Array<{ source: string; url: string }> = [];
  for (const filename of assetNames) {
    const directUrl = `${githubWebBase}/${githubOwner}/${githubRepo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
    const proxied = applyGhProxy(directUrl, config?.customGhProxyPrefix, allowLoopback);
    if (proxied !== null) {
      githubEntries.push({ source: "github-proxy", url: proxied });
    }
    githubEntries.push({ source: "github-release", url: directUrl });
  }

  const giteeEntries: Array<{ source: string; url: string }> = [];
  for (const filename of assetNames) {
    const giteeUrl = `${giteeWebBase}/${giteeOwner}/${giteeRepo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
    giteeEntries.push({ source: "gitee-release", url: giteeUrl });
  }

  const preferDomestic =
    preference === "domestic" ||
    (preference === "auto" && recommendedSource === "gitee");

  const ordered = preferDomestic
    ? [...giteeEntries, ...githubEntries]
    : [...githubEntries, ...giteeEntries];

  for (const item of ordered) {
    add(item.source, item.url);
  }

  return candidates;
}

export function getOfficialNpmFallbackSpecs(
  entry: OfficialPluginCatalogEntry
): string[] {
  const cleanId = entry.id.trim();
  const unscoped = cleanId.startsWith("prismux-plugin-")
    ? cleanId
    : `prismux-plugin-${cleanId}`;
  const scoped = `@fish-under-sea/${unscoped}`;
  return [
    `${unscoped}@${entry.version}`,
    `${unscoped}@latest`,
    `${scoped}@${entry.version}`,
    `${scoped}@latest`
  ];
}

interface OfficialDownloadSecurityPolicy {
  extraAllowedHosts: ReadonlySet<string>;
  allowInsecureLoopbackForTesting: boolean;
}

function buildOfficialDownloadSecurityPolicy(
  config?: OfficialPluginSourceConfig
): OfficialDownloadSecurityPolicy {
  const allowLoopback = config?.allowInsecureLoopbackForTesting === true;
  const extraAllowedHosts = new Set<string>();
  const registerConfiguredHost = (rawUrl: string | undefined): void => {
    if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
      return;
    }
    try {
      const parsed = new URL(rawUrl.trim());
      const host = parsed.hostname.toLowerCase();
      if (
        parsed.protocol === "https:" ||
        (allowLoopback && parsed.protocol === "http:" && isLoopbackHostname(host))
      ) {
        extraAllowedHosts.add(host);
      }
    } catch {
      // Invalid URLs will be rejected during request validation
    }
  };
  registerConfiguredHost(config?.customGhProxyPrefix);
  registerConfiguredHost(config?.githubWebBase);
  registerConfiguredHost(config?.giteeWebBase);
  return {
    extraAllowedHosts,
    allowInsecureLoopbackForTesting: allowLoopback
  };
}

function isAllowedOfficialDownloadHost(
  hostname: string,
  security: OfficialDownloadSecurityPolicy
): boolean {
  const host = hostname.trim().toLowerCase();
  if (
    OFFICIAL_PLUGIN_ALLOWED_EXACT_HOSTS.has(host) ||
    GITEE_SUBDOMAIN_RE.test(host) ||
    security.extraAllowedHosts.has(host)
  ) {
    return true;
  }
  return security.allowInsecureLoopbackForTesting && isLoopbackHostname(host);
}

function validateOfficialDownloadUrl(
  rawUrl: string,
  security: OfficialDownloadSecurityPolicy,
  previousProtocol?: string
): URL {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid download URL: ${rawUrl}`);
  }

  if (previousProtocol === "https:" && parsedUrl.protocol !== "https:") {
    throw new Error(
      `HTTPS-to-${parsedUrl.protocol} redirect downgrade is forbidden (${rawUrl}).`
    );
  }

  const host = parsedUrl.hostname.toLowerCase();
  const isLoopback = isLoopbackHostname(host);
  if (parsedUrl.protocol !== "https:") {
    if (
      !(
        parsedUrl.protocol === "http:" &&
        security.allowInsecureLoopbackForTesting &&
        isLoopback
      )
    ) {
      throw new Error(
        `Insecure or unsupported protocol "${parsedUrl.protocol}" for ${rawUrl} (HTTPS required).`
      );
    }
  }

  if (!isAllowedOfficialDownloadHost(host, security)) {
    throw new Error(
      `Blocked disallowed download/redirect host "${host}" for ${rawUrl}.`
    );
  }

  return parsedUrl;
}

function fetchBinaryWithRedirects(
  rawUrl: string,
  timeoutMs: number,
  maxBytes: number,
  security: OfficialDownloadSecurityPolicy,
  headers: Record<string, string> = {},
  redirectsRemaining = MAX_REDIRECTS,
  previousProtocol?: string
): Promise<{ statusCode: number; contentType: string; bytes: Buffer; finalUrl: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    let parsedUrl: URL;
    try {
      parsedUrl = validateOfficialDownloadUrl(rawUrl, security, previousProtocol);
    } catch (err) {
      rejectPromise(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const transport = parsedUrl.protocol === "https:" ? https : http;
    const req = transport.request(
      parsedUrl,
      {
        method: "GET",
        agent: false,
        headers: {
          "user-agent": "Prismux-Plugin-Installer/0.1",
          accept: "application/octet-stream, application/gzip, */*",
          connection: "close",
          ...headers
        }
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        const location = res.headers.location;
        if (
          statusCode === 301 ||
          statusCode === 302 ||
          statusCode === 303 ||
          statusCode === 307 ||
          statusCode === 308
        ) {
          res.resume();
          if (typeof location !== "string" || location.trim().length === 0) {
            rejectPromise(
              new Error(`Redirect HTTP ${statusCode} missing Location header (${rawUrl}).`)
            );
            return;
          }
          if (redirectsRemaining <= 0) {
            rejectPromise(new Error(`Too many redirects while downloading ${rawUrl}.`));
            return;
          }
          let nextParsed: URL;
          try {
            nextParsed = new URL(location, parsedUrl);
          } catch {
            rejectPromise(new Error(`Invalid redirect Location "${location}".`));
            return;
          }
          const nextHeaders =
            nextParsed.origin === parsedUrl.origin
              ? headers
              : stripSensitiveRedirectHeaders(headers);
          fetchBinaryWithRedirects(
            nextParsed.toString(),
            timeoutMs,
            maxBytes,
            security,
            nextHeaders,
            redirectsRemaining - 1,
            parsedUrl.protocol
          ).then(resolvePromise, rejectPromise);
          return;
        }

        const contentType = String(res.headers["content-type"] ?? "");
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        res.on("data", (chunk: Buffer | Uint8Array) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buf.byteLength;
          if (totalBytes > maxBytes) {
            req.destroy(
              new Error(`Downloaded archive exceeds limit (${maxBytes} bytes).`)
            );
            return;
          }
          chunks.push(buf);
        });

        res.on("end", () => {
          resolvePromise({
            statusCode,
            contentType,
            bytes: Buffer.concat(chunks),
            finalUrl: parsedUrl.toString()
          });
        });

        res.on("error", (err) => {
          rejectPromise(err);
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });

    req.on("error", (err) => {
      rejectPromise(err);
    });

    req.end();
  });
}

/**
 * Attempts to download an official `.wb-plugin` archive from GitHub/Gitee release
 * mirrors while strictly checking HTTPS-only, redirect allowlists, gzip header, and
 * fail-closed catalog SHA-256 checksum.
 */
export async function downloadOfficialPluginReleaseArchive(
  entry: OfficialPluginCatalogEntry,
  options?: {
    preference?: NetworkRoutePreference;
    config?: OfficialPluginSourceConfig;
    recommendedSource?: "github" | "gitee";
    headers?: Record<string, string>;
  }
): Promise<OfficialArchiveDownloadResult> {
  const expectedSha =
    typeof entry.sha256 === "string" ? entry.sha256.trim().toLowerCase() : "";
  if (!SHA256_HEX_RE.test(expectedSha)) {
    throw new Error(
      `Refusing to download official plugin "${entry.id}": missing valid 64-char SHA-256 checksum.`
    );
  }

  const timeoutMs = options?.config?.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const maxBytes = options?.config?.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
  const security = buildOfficialDownloadSecurityPolicy(options?.config);

  const candidates = buildOfficialPluginReleaseUrls(
    entry,
    options?.preference ?? "auto",
    options?.config,
    options?.recommendedSource
  );

  const attempts: OfficialDownloadAttempt[] = [];
  let tamperError: ChecksumMismatchError | undefined;

  for (const candidate of candidates) {
    try {
      const response = await fetchBinaryWithRedirects(
        candidate.url,
        timeoutMs,
        maxBytes,
        security,
        options?.headers ?? {}
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        attempts.push({
          source: candidate.source,
          url: candidate.url,
          ok: false,
          statusCode: response.statusCode,
          reason: `HTTP ${response.statusCode}`
        });
        continue;
      }

      const bytes = response.bytes;
      const isGzip =
        bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
      if (!isGzip) {
        attempts.push({
          source: candidate.source,
          url: candidate.url,
          ok: false,
          statusCode: response.statusCode,
          reason: `响应内容不是有效的 .wb-plugin (gzip) 归档（content-type: ${response.contentType || "unknown"}）`
        });
        continue;
      }

      const actualSha = createHash("sha256").update(bytes).digest("hex");
      if (actualSha !== expectedSha) {
        tamperError = new ChecksumMismatchError(expectedSha, actualSha, "sha256");
        attempts.push({
          source: candidate.source,
          url: candidate.url,
          ok: false,
          statusCode: response.statusCode,
          reason: `SHA-256 校验不匹配（期望 ${expectedSha.slice(0, 12)}…，实际 ${actualSha.slice(0, 12)}…）`
        });
        continue;
      }

      attempts.push({
        source: candidate.source,
        url: candidate.url,
        ok: true,
        statusCode: response.statusCode
      });
      return {
        ok: true,
        bytes,
        sha256: actualSha,
        sourceUsed: `${candidate.source}:${candidate.url}`,
        attempts
      };
    } catch (err) {
      attempts.push({
        source: candidate.source,
        url: candidate.url,
        ok: false,
        reason: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return {
    ok: false,
    ...(tamperError !== undefined ? { tamperError } : {}),
    attempts
  };
}
