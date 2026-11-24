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

function applyGhProxy(url: string, proxyPrefix?: string): string | null {
  const trimmed = proxyPrefix?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
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

  const githubEntries: Array<{ source: string; url: string }> = [];
  for (const filename of assetNames) {
    const directUrl = `${githubWebBase}/${githubOwner}/${githubRepo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
    const proxied = applyGhProxy(directUrl, config?.customGhProxyPrefix);
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

function fetchBinaryWithRedirects(
  rawUrl: string,
  timeoutMs: number,
  maxBytes: number,
  redirectsRemaining = MAX_REDIRECTS
): Promise<{ statusCode: number; contentType: string; bytes: Buffer; finalUrl: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      rejectPromise(new Error(`Invalid download URL: ${rawUrl}`));
      return;
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      rejectPromise(
        new Error(`Unsupported protocol "${parsedUrl.protocol}" for ${rawUrl}`)
      );
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
          connection: "close"
        }
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        const location = res.headers.location;
        if (
          (statusCode === 301 ||
            statusCode === 302 ||
            statusCode === 303 ||
            statusCode === 307 ||
            statusCode === 308) &&
          typeof location === "string" &&
          location.length > 0 &&
          redirectsRemaining > 0
        ) {
          res.resume();
          const nextUrl = new URL(location, parsedUrl).toString();
          fetchBinaryWithRedirects(
            nextUrl,
            timeoutMs,
            maxBytes,
            redirectsRemaining - 1
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
 * mirrors while strictly checking gzip header and catalog SHA-256 checksum.
 */
export async function downloadOfficialPluginReleaseArchive(
  entry: OfficialPluginCatalogEntry,
  options?: {
    preference?: NetworkRoutePreference;
    config?: OfficialPluginSourceConfig;
    recommendedSource?: "github" | "gitee";
  }
): Promise<OfficialArchiveDownloadResult> {
  const timeoutMs = options?.config?.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const maxBytes = options?.config?.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
  const expectedSha = entry.sha256?.trim().toLowerCase() ?? "";
  const hasExpectedSha = /^[0-9a-f]{64}$/.test(expectedSha);

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
        maxBytes
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
      if (hasExpectedSha && actualSha !== expectedSha) {
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
