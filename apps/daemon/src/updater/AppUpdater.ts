import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import { basename, join, resolve } from "node:path";
import { compareSemver, parseSemver } from "@prismux/cordis-kernel";
import {
  DEFAULT_UPDATE_POLICY,
  NETWORK_ROUTE_PREFERENCES,
  PLUGIN_REGISTRY_IDS,
  UPDATE_ENDPOINTS,
  type NetworkRoutePreference,
  type SourceEndpointProbe,
  type SourceProbeReport,
  type UpdateAssetInfo,
  type UpdateChannel,
  type UpdateCheckResult,
  type UpdateDownloadResult,
  type UpdatePackageKind,
  type UpdatePolicyConfig,
  type UpdatePolicyPatch,
  type UpdaterStatusSnapshot,
  type UpdateSourceId
} from "@prismux/protocol";

const POLICY_FILENAME = "updater-policy.json";
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const DEFAULT_MAX_REDIRECTS = 6;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAYS_MS = [250, 750, 1500];

export interface AppUpdaterEndpoints {
  githubOwner: string;
  githubRepo: string;
  githubApiBase: string;
  githubWebBase: string;
  giteeOwner: string;
  giteeRepo: string;
  giteeApiBase: string;
  giteeWebBase: string;
}

export interface AppUpdaterOptions {
  currentVersion?: string;
  dataDir: string;
  portableMode?: boolean;
  downloadsDir?: string;
  initialPolicy?: UpdatePolicyPatch;
  endpoints?: Partial<AppUpdaterEndpoints>;
  githubApiBase?: string;
  giteeApiBase?: string;
  githubWebBase?: string;
  giteeWebBase?: string;
  maxRedirects?: number;
  maxRetries?: number;
  retryDelaysMs?: number[];
}

export interface CheckForUpdatesOptions {
  channel?: UpdateChannel;
  sourceOverride?: UpdateSourceId;
}

export interface UpdateDownloadProgress {
  bytesDownloaded: number;
  totalBytes: number | null;
  source: UpdateSourceId;
}

export interface DownloadUpdateOptions {
  checkResult?: UpdateCheckResult;
  asset?: UpdateAssetInfo;
  kind?: UpdatePackageKind;
  destDir?: string;
  onProgress?: (progress: UpdateDownloadProgress) => void;
  maxRetries?: number;
  retryDelaysMs?: number[];
}

export class UpdateHttpError extends Error {
  readonly statusCode: number;
  readonly url: string;

  constructor(statusCode: number, url: string, message?: string) {
    super(
      `Updater HTTP ${statusCode} for ${url}${message ? `: ${message}` : ""}`
    );
    this.name = "UpdateHttpError";
    this.statusCode = statusCode;
    this.url = url;
  }
}

export class UpdateIntegrityError extends Error {
  readonly assetName: string;
  readonly expectedSha256: string;
  readonly actualSha256: string;

  constructor(assetName: string, expectedSha256: string, actualSha256: string) {
    super(
      `SHA-256 checksum mismatch for "${assetName}": expected ${expectedSha256}, got ${actualSha256}.`
    );
    this.name = "UpdateIntegrityError";
    this.assetName = assetName;
    this.expectedSha256 = expectedSha256;
    this.actualSha256 = actualSha256;
  }
}

class RetryableTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableTransferError";
  }
}

interface RawReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
}

interface RawReleaseRecord {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  created_at?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

interface ParsedReleaseCandidate {
  version: string;
  tagName: string;
  prerelease: boolean;
  releaseName: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  htmlUrl: string | null;
  rawAssets: Array<{
    name: string;
    downloadUrl: string;
    sizeBytes: number | null;
  }>;
}

interface HttpOpenedResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  stream: http.IncomingMessage;
  finalUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function normalizeTagToVersion(tagName: string): string {
  return tagName.trim().replace(/^v/i, "");
}

function isValidSha256Hex(value: string | null | undefined): value is string {
  return typeof value === "string" && SHA256_HEX_RE.test(value.trim().toLowerCase());
}

function sanitizeAssetFileName(name: string): string {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("..") ||
    trimmed.includes("\0")
  ) {
    throw new Error(`Unsafe update asset file name: "${name}".`);
  }
  return trimmed;
}

export function applyGhProxyPrefix(rawUrl: string, prefix: string): string {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) {
    return rawUrl;
  }
  if (rawUrl.startsWith(trimmed)) {
    return rawUrl;
  }
  if (trimmed.endsWith("/") || trimmed.endsWith("=") || trimmed.endsWith("?")) {
    return `${trimmed}${rawUrl}`;
  }
  return `${trimmed}/${rawUrl}`;
}

function extractAssetName(asset: RawReleaseAsset, downloadUrl: string): string {
  if (typeof asset.name === "string" && asset.name.trim().length > 0) {
    return asset.name.trim();
  }
  try {
    const parsed = new URL(downloadUrl);
    const segment = parsed.pathname.split("/").filter(Boolean).pop();
    if (segment && segment.length > 0) {
      return decodeURIComponent(segment);
    }
  } catch {
    // Fall back to empty string
  }
  return "";
}

function classifyPackageAssetKind(
  assetName: string,
  version: string
): UpdatePackageKind | null {
  const lower = assetName.toLowerCase();
  if (lower.endsWith(".sha256") || lower.endsWith(".sig") || lower.endsWith(".asc")) {
    return null;
  }
  const portableExact = `prismux-portable-${version.toLowerCase()}-win-x64.zip`;
  const setupExact = `prismux-setup-${version.toLowerCase()}.exe`;

  if (
    lower === portableExact ||
    (lower.startsWith("prismux-portable-") && lower.endsWith("-win-x64.zip")) ||
    (lower.includes("portable") && lower.endsWith(".zip"))
  ) {
    return "portable-zip";
  }

  if (
    lower === setupExact ||
    (lower.startsWith("prismux-setup-") && lower.endsWith(".exe")) ||
    (lower.includes("setup") && lower.endsWith(".exe"))
  ) {
    return "setup-exe";
  }

  return null;
}

function parseSha256SumsText(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
    if (match !== null) {
      const digest = match[1]!.toLowerCase();
      const fileToken = basename(match[2]!.trim()).toLowerCase();
      if (fileToken.length > 0) {
        map.set(fileToken, digest);
      }
    }
  }
  return map;
}

function parseSingleAssetSha256Text(
  text: string,
  expectedAssetName: string
): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const expectedLower = basename(expectedAssetName).toLowerCase();

  for (const line of lines) {
    const bareMatch = /^([0-9a-fA-F]{64})$/.exec(line);
    if (bareMatch !== null) {
      return bareMatch[1]!.toLowerCase();
    }
    const pairMatch = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
    if (pairMatch !== null) {
      const digest = pairMatch[1]!.toLowerCase();
      const fileToken = basename(pairMatch[2]!.trim()).toLowerCase();
      if (fileToken === expectedLower) {
        return digest;
      }
    }
  }
  return null;
}

function openHttpWithRedirects(
  rawUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
  maxRedirects: number
): Promise<HttpOpenedResponse> {
  const attemptOpen = (
    targetUrl: string,
    redirectsLeft: number
  ): Promise<HttpOpenedResponse> =>
    new Promise((resolvePromise, rejectPromise) => {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(targetUrl);
      } catch {
        rejectPromise(new Error(`Invalid updater URL: "${targetUrl}".`));
        return;
      }

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        rejectPromise(
          new Error(`Unsupported updater URL protocol: "${parsedUrl.protocol}".`)
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
            "user-agent": "Prismux-Updater/0.0.1-alpha.1",
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
            if (typeof location !== "string" || location.trim().length === 0) {
              res.resume();
              rejectPromise(
                new UpdateHttpError(
                  statusCode,
                  parsedUrl.toString(),
                  "Redirect response missing Location header."
                )
              );
              return;
            }
            if (redirectsLeft <= 0) {
              res.resume();
              rejectPromise(
                new Error(
                  `Too many redirects (exceeded ${maxRedirects} hops) while requesting ${rawUrl}.`
                )
              );
              return;
            }
            res.resume();
            const nextUrl = new URL(location, parsedUrl).toString();
            attemptOpen(nextUrl, redirectsLeft - 1).then(
              resolvePromise,
              rejectPromise
            );
            return;
          }

          resolvePromise({
            statusCode,
            headers: res.headers,
            stream: res,
            finalUrl: parsedUrl.toString()
          });
        }
      );

      req.setTimeout(timeoutMs, () => {
        req.destroy(
          new RetryableTransferError(
            `Updater request timed out after ${timeoutMs}ms (${targetUrl}).`
          )
        );
      });

      req.on("error", (err) => {
        rejectPromise(err);
      });

      req.end();
    });

  return attemptOpen(rawUrl, maxRedirects);
}

async function fetchText(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  maxRedirects: number,
  maxBytes = 8 * 1024 * 1024
): Promise<string> {
  const response = await openHttpWithRedirects(
    url,
    headers,
    timeoutMs,
    maxRedirects
  );
  if (response.statusCode < 200 || response.statusCode >= 300) {
    response.stream.resume();
    throw new UpdateHttpError(response.statusCode, url);
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response.stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buf.length;
    if (bytes > maxBytes) {
      response.stream.destroy();
      throw new Error(`Updater payload exceeded ${maxBytes} bytes (${url}).`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function computeFileSha256(filePath: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buf.length;
    hash.update(buf);
  }
  return {
    sha256: hash.digest("hex"),
    bytes
  };
}

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function closeWriteStream(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  return new Promise((resolvePromise) => {
    if (stream.closed) {
      resolvePromise();
      return;
    }
    stream.once("close", () => resolvePromise());
    stream.close();
  });
}

function endWriteStream(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    if (stream.closed) {
      resolvePromise();
      return;
    }
    const onError = (err: Error) => {
      stream.off("close", onClose);
      rejectPromise(err);
    };
    const onClose = () => {
      stream.off("error", onError);
      resolvePromise();
    };
    stream.once("error", onError);
    stream.once("close", onClose);
    stream.end();
  });
}

function writeChunkToStream(
  stream: ReturnType<typeof createWriteStream>,
  chunk: Buffer
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const cleanup = () => {
      stream.off("error", onError);
      stream.off("drain", onDrain);
    };
    const finishOk = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolvePromise();
      }
    };
    const finishErr = (err: Error) => {
      if (!settled) {
        settled = true;
        cleanup();
        rejectPromise(err);
      }
    };
    const onError = (err: Error) => finishErr(err);
    const onDrain = () => finishOk();

    stream.once("error", onError);
    const ok = stream.write(chunk, (err) => {
      if (err) {
        finishErr(err);
      } else if (ok) {
        finishOk();
      }
    });

    if (!ok) {
      stream.once("drain", onDrain);
    }
  });
}

function isRetryableDownloadError(error: unknown): boolean {
  if (error instanceof UpdateIntegrityError) {
    return false;
  }
  if (error instanceof RetryableTransferError) {
    return true;
  }
  if (error instanceof UpdateHttpError) {
    return (
      error.statusCode >= 500 ||
      error.statusCode === 408 ||
      error.statusCode === 429
    );
  }
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (
      code === "ECONNRESET" ||
      code === "ECONNREFUSED" ||
      code === "ETIMEDOUT" ||
      code === "EPIPE" ||
      code === "EAI_AGAIN" ||
      code === "ENOTFOUND" ||
      /aborted|premature|socket hang up|timed out/i.test(error.message)
    ) {
      return true;
    }
  }
  return false;
}

function parseContentRangeHeader(
  rawHeader: string | string[] | undefined
): { start: number; end: number | null; total: number | null } | null {
  const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof value !== "string") {
    return null;
  }
  const match = /^bytes\s+(\d+)-(\d+|\*)\/(\d+|\*)$/i.exec(value.trim());
  if (match === null) {
    return null;
  }
  const start = Number.parseInt(match[1]!, 10);
  const end = match[2] === "*" ? null : Number.parseInt(match[2]!, 10);
  const total = match[3] === "*" ? null : Number.parseInt(match[3]!, 10);
  if (!Number.isSafeInteger(start) || start < 0) {
    return null;
  }
  return { start, end, total };
}

export class AppUpdater {
  private readonly currentVersion: string;
  private readonly dataDir: string;
  private readonly portableMode: boolean;
  private readonly downloadsDir: string;
  private readonly endpoints: AppUpdaterEndpoints;
  private readonly maxRedirects: number;
  private readonly maxRetries: number;
  private readonly retryDelaysMs: number[];

  private policy: UpdatePolicyConfig;
  private checking = false;
  private downloading = false;
  private lastCheck: UpdateCheckResult | null = null;
  private lastDownload: UpdateDownloadResult | null = null;
  private lastProbe: SourceProbeReport | null = null;
  private lastError: string | null = null;

  constructor(options: AppUpdaterOptions) {
    const currentVersion = (options.currentVersion ?? "0.0.1-alpha.1").trim();
    if (parseSemver(currentVersion) === null) {
      throw new Error(`Invalid AppUpdater currentVersion SemVer: "${currentVersion}".`);
    }

    this.currentVersion = currentVersion;
    this.dataDir = resolve(options.dataDir);
    this.portableMode = Boolean(options.portableMode);
    this.downloadsDir = resolve(
      options.downloadsDir ?? join(this.dataDir, "updates")
    );
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

    this.endpoints = {
      githubOwner: options.endpoints?.githubOwner ?? UPDATE_ENDPOINTS.githubOwner,
      githubRepo: options.endpoints?.githubRepo ?? UPDATE_ENDPOINTS.githubRepo,
      githubApiBase: normalizeBaseUrl(
        options.githubApiBase ??
          options.endpoints?.githubApiBase ??
          UPDATE_ENDPOINTS.githubApiBase
      ),
      githubWebBase: normalizeBaseUrl(
        options.githubWebBase ??
          options.endpoints?.githubWebBase ??
          UPDATE_ENDPOINTS.githubWebBase
      ),
      giteeOwner: options.endpoints?.giteeOwner ?? UPDATE_ENDPOINTS.giteeOwner,
      giteeRepo: options.endpoints?.giteeRepo ?? UPDATE_ENDPOINTS.giteeRepo,
      giteeApiBase: normalizeBaseUrl(
        options.giteeApiBase ??
          options.endpoints?.giteeApiBase ??
          UPDATE_ENDPOINTS.giteeApiBase
      ),
      giteeWebBase: normalizeBaseUrl(
        options.giteeWebBase ??
          options.endpoints?.giteeWebBase ??
          UPDATE_ENDPOINTS.giteeWebBase
      )
    };

    const persisted = this.loadPersistedPolicy();
    this.policy = this.validatePolicy({
      ...DEFAULT_UPDATE_POLICY,
      ...(persisted ?? {}),
      ...(options.initialPolicy ?? {})
    });
  }

  getStatus(): UpdaterStatusSnapshot {
    return {
      currentVersion: this.currentVersion,
      portableMode: this.portableMode,
      policy: { ...this.policy },
      checking: this.checking,
      downloading: this.downloading,
      lastCheck: this.lastCheck,
      lastDownload: this.lastDownload,
      lastProbe: this.lastProbe,
      lastError: this.lastError
    };
  }

  getPolicy(): UpdatePolicyConfig {
    return { ...this.policy };
  }

  setPolicy(patch: UpdatePolicyPatch): UpdatePolicyConfig {
    const merged: UpdatePolicyConfig = {
      ...this.policy,
      ...(patch.routePreference !== undefined
        ? { routePreference: patch.routePreference }
        : {}),
      ...(patch.includePrerelease !== undefined
        ? { includePrerelease: patch.includePrerelease }
        : {}),
      ...(patch.customGhProxyPrefix !== undefined
        ? { customGhProxyPrefix: patch.customGhProxyPrefix }
        : {}),
      ...(patch.pluginRegistryOverride !== undefined
        ? { pluginRegistryOverride: patch.pluginRegistryOverride }
        : {}),
      ...(patch.timeoutMs !== undefined ? { timeoutMs: patch.timeoutMs } : {})
    };
    const validated = this.validatePolicy(merged);
    this.policy = validated;
    this.savePersistedPolicy(validated);
    return { ...this.policy };
  }

  async probeSources(): Promise<SourceProbeReport> {
    const timeoutMs = Math.min(this.policy.timeoutMs, 8_000);
    const githubUrl = `${this.endpoints.githubApiBase}/repos/${this.endpoints.githubOwner}/${this.endpoints.githubRepo}/releases?per_page=1`;
    const giteeUrl = `${this.endpoints.giteeApiBase}/repos/${this.endpoints.giteeOwner}/${this.endpoints.giteeRepo}/releases?page=1&per_page=1`;

    const [githubProbe, giteeProbe] = await Promise.all([
      this.probeSingleSource("github", githubUrl, {
        accept: "application/vnd.github+json"
      }, timeoutMs),
      this.probeSingleSource("gitee", giteeUrl, {
        accept: "application/json"
      }, timeoutMs)
    ]);

    let recommendedSource: UpdateSourceId = "github";
    if (githubProbe.reachable && giteeProbe.reachable) {
      const ghLatency = githubProbe.latencyMs ?? Number.POSITIVE_INFINITY;
      const giteeLatency = giteeProbe.latencyMs ?? Number.POSITIVE_INFINITY;
      recommendedSource = giteeLatency < ghLatency ? "gitee" : "github";
    } else if (giteeProbe.reachable && !githubProbe.reachable) {
      recommendedSource = "gitee";
    } else if (githubProbe.reachable && !giteeProbe.reachable) {
      recommendedSource = "github";
    }

    const report: SourceProbeReport = {
      probedAt: Date.now(),
      recommendedSource,
      recommendedRoute: recommendedSource === "gitee" ? "domestic" : "global",
      sources: [githubProbe, giteeProbe]
    };
    this.lastProbe = report;
    return report;
  }

  async checkForUpdates(
    options?: CheckForUpdatesOptions
  ): Promise<UpdateCheckResult> {
    this.checking = true;
    try {
      const includePrerelease =
        options?.channel === "stable"
          ? false
          : options?.channel === "prerelease"
            ? true
            : this.policy.includePrerelease;

      let probeReport: SourceProbeReport | undefined;
      let candidateOrder: UpdateSourceId[];
      if (options?.sourceOverride !== undefined) {
        candidateOrder = [options.sourceOverride];
      } else if (this.policy.routePreference === "domestic") {
        candidateOrder = ["gitee", "github"];
      } else if (this.policy.routePreference === "global") {
        candidateOrder = ["github", "gitee"];
      } else {
        probeReport = await this.probeSources();
        candidateOrder =
          probeReport.recommendedSource === "gitee"
            ? ["gitee", "github"]
            : ["github", "gitee"];
      }

      const errors: Array<{ source: UpdateSourceId; message: string }> = [];
      for (let i = 0; i < candidateOrder.length; i += 1) {
        const source = candidateOrder[i]!;
        try {
          const result = await this.checkSingleSource(
            source,
            includePrerelease,
            i > 0,
            probeReport,
            errors
          );
          this.lastCheck = result;
          this.lastError = null;
          return result;
        } catch (error) {
          errors.push({
            source,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const summary = errors
        .map((item) => `${item.source}: ${item.message}`)
        .join("; ");
      const errMessage = `Failed to check for updates from all sources (${summary}).`;
      this.lastError = errMessage;
      throw new Error(errMessage);
    } finally {
      this.checking = false;
    }
  }

  async downloadUpdate(
    options?: DownloadUpdateOptions
  ): Promise<UpdateDownloadResult> {
    this.downloading = true;
    try {
      const checkResult =
        options?.checkResult ?? this.lastCheck ?? (await this.checkForUpdates());
      const primaryAsset = this.selectDownloadAsset(checkResult, options);
      if (primaryAsset === null) {
        throw new Error(
          `No matching Windows installer or portable asset available for update check (current ${this.currentVersion}).`
        );
      }

      const expectedSha = this.requireValidSha256(
        primaryAsset.sha256,
        primaryAsset.name
      );
      const safeName = sanitizeAssetFileName(primaryAsset.name);
      const destDir = resolve(options?.destDir ?? this.downloadsDir);
      mkdirSync(destDir, { recursive: true });
      const targetPath = join(destDir, safeName);
      const partPath = `${targetPath}.part`;

      const maxRetries = options?.maxRetries ?? this.maxRetries;
      const retryDelaysMs = options?.retryDelaysMs ?? this.retryDelaysMs;

      let activeSource: UpdateSourceId = primaryAsset.source;
      let usedFallbackSource = false;
      let activeAsset = primaryAsset;
      let activeSha = expectedSha;

      try {
        const result = await this.downloadAndVerifyAsset({
          asset: activeAsset,
          expectedSha256: activeSha,
          version: checkResult.latestVersion ?? this.currentVersion,
          targetPath,
          partPath,
          usedFallbackSource,
          maxRetries,
          retryDelaysMs,
          onProgress: options?.onProgress
        });
        this.lastDownload = result;
        this.lastError = null;
        return result;
      } catch (primaryError) {
        if (primaryError instanceof UpdateIntegrityError) {
          this.lastError = primaryError.message;
          throw primaryError;
        }

        // Remove potentially partial bytes from primary source before switching mirrors.
        rmSync(partPath, { force: true });

        const fallbackSource: UpdateSourceId =
          activeSource === "github" ? "gitee" : "github";
        const fallbackIncludePrerelease =
          checkResult.channel === "stable"
            ? false
            : checkResult.channel === "prerelease"
              ? true
              : this.policy.includePrerelease;
        let fallbackCheck: UpdateCheckResult;
        try {
          fallbackCheck = await this.checkSingleSource(
            fallbackSource,
            fallbackIncludePrerelease,
            true,
            undefined,
            [
              {
                source: activeSource,
                message:
                  primaryError instanceof Error
                    ? primaryError.message
                    : String(primaryError)
              }
            ]
          );
        } catch (fallbackCheckError) {
          const combined = `Primary source ${activeSource} failed (${primaryError instanceof Error ? primaryError.message : String(primaryError)}); fallback source ${fallbackSource} check failed (${fallbackCheckError instanceof Error ? fallbackCheckError.message : String(fallbackCheckError)}).`;
          this.lastError = combined;
          throw new Error(combined);
        }

        const fallbackAsset =
          fallbackCheck.assets.find((item) => item.name === primaryAsset.name) ??
          fallbackCheck.assets.find((item) => item.kind === primaryAsset.kind) ??
          fallbackCheck.recommendedAsset;

        if (fallbackAsset === null || fallbackAsset === undefined) {
          const msg = `Primary source ${activeSource} failed (${primaryError instanceof Error ? primaryError.message : String(primaryError)}); fallback source ${fallbackSource} had no matching asset for "${primaryAsset.name}".`;
          this.lastError = msg;
          throw new Error(msg);
        }

        const fallbackSha = this.requireValidSha256(
          fallbackAsset.sha256,
          fallbackAsset.name
        );
        if (
          fallbackCheck.latestVersion === checkResult.latestVersion &&
          fallbackAsset.name === primaryAsset.name &&
          fallbackSha !== expectedSha
        ) {
          const msg = `Fallback source ${fallbackSource} SHA-256 for "${fallbackAsset.name}" disagrees with primary ${activeSource}.`;
          this.lastError = msg;
          throw new Error(msg);
        }

        activeSource = fallbackSource;
        usedFallbackSource = true;
        activeAsset = fallbackAsset;
        activeSha = fallbackSha;

        const fallbackResult = await this.downloadAndVerifyAsset({
          asset: activeAsset,
          expectedSha256: activeSha,
          version: fallbackCheck.latestVersion ?? checkResult.latestVersion ?? this.currentVersion,
          targetPath,
          partPath,
          usedFallbackSource,
          maxRetries,
          retryDelaysMs,
          onProgress: options?.onProgress
        });
        this.lastDownload = fallbackResult;
        this.lastError = null;
        return fallbackResult;
      }
    } finally {
      this.downloading = false;
    }
  }

  private validatePolicy(raw: UpdatePolicyConfig): UpdatePolicyConfig {
    if (
      !(NETWORK_ROUTE_PREFERENCES as readonly string[]).includes(
        raw.routePreference
      )
    ) {
      throw new Error(
        `Invalid routePreference "${String(raw.routePreference)}": expected one of ${NETWORK_ROUTE_PREFERENCES.join(", ")}.`
      );
    }
    if (typeof raw.includePrerelease !== "boolean") {
      throw new Error("includePrerelease must be a boolean.");
    }
    if (typeof raw.customGhProxyPrefix !== "string") {
      throw new Error("customGhProxyPrefix must be a string.");
    }
    const cleanPrefix = raw.customGhProxyPrefix.trim();
    if (cleanPrefix.length > 0 && !/^https?:\/\//i.test(cleanPrefix)) {
      throw new Error(
        `customGhProxyPrefix must start with http:// or https://, got "${cleanPrefix}".`
      );
    }
    if (
      raw.pluginRegistryOverride !== "auto" &&
      !(PLUGIN_REGISTRY_IDS as readonly string[]).includes(
        raw.pluginRegistryOverride
      )
    ) {
      throw new Error(
        `Invalid pluginRegistryOverride "${String(raw.pluginRegistryOverride)}".`
      );
    }
    if (
      typeof raw.timeoutMs !== "number" ||
      !Number.isFinite(raw.timeoutMs) ||
      raw.timeoutMs < 100 ||
      raw.timeoutMs > 300_000
    ) {
      throw new Error("timeoutMs must be a finite number between 100 and 300000.");
    }

    return {
      routePreference: raw.routePreference as NetworkRoutePreference,
      includePrerelease: raw.includePrerelease,
      customGhProxyPrefix: cleanPrefix,
      pluginRegistryOverride: raw.pluginRegistryOverride,
      timeoutMs: Math.round(raw.timeoutMs)
    };
  }

  private loadPersistedPolicy(): UpdatePolicyPatch | null {
    const filePath = join(this.dataDir, POLICY_FILENAME);
    if (!existsSync(filePath)) {
      return null;
    }
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      return isRecord(parsed) ? (parsed as UpdatePolicyPatch) : null;
    } catch {
      return null;
    }
  }

  private savePersistedPolicy(policy: UpdatePolicyConfig): void {
    try {
      mkdirSync(this.dataDir, { recursive: true });
      writeFileSync(
        join(this.dataDir, POLICY_FILENAME),
        `${JSON.stringify(policy, null, 2)}\n`,
        "utf8"
      );
    } catch {
      // Best-effort policy persistence
    }
  }

  private async probeSingleSource(
    source: UpdateSourceId,
    url: string,
    headers: Record<string, string>,
    timeoutMs: number
  ): Promise<SourceEndpointProbe> {
    const startedAt = performance.now();
    try {
      const response = await openHttpWithRedirects(
        url,
        headers,
        timeoutMs,
        this.maxRedirects
      );
      response.stream.resume();
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const reachable = response.statusCode >= 200 && response.statusCode < 400;
      return {
        source,
        url,
        reachable,
        statusCode: response.statusCode,
        latencyMs,
        ...(reachable ? {} : { error: `HTTP ${response.statusCode}` })
      };
    } catch (error) {
      return {
        source,
        url,
        reachable: false,
        statusCode: null,
        latencyMs: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async checkSingleSource(
    source: UpdateSourceId,
    includePrerelease: boolean,
    usedFallbackSource: boolean,
    probeReport: SourceProbeReport | undefined,
    priorErrors: Array<{ source: UpdateSourceId; message: string }>
  ): Promise<UpdateCheckResult> {
    const releasesUrl =
      source === "github"
        ? `${this.endpoints.githubApiBase}/repos/${this.endpoints.githubOwner}/${this.endpoints.githubRepo}/releases?per_page=20`
        : `${this.endpoints.giteeApiBase}/repos/${this.endpoints.giteeOwner}/${this.endpoints.giteeRepo}/releases?page=1&per_page=20&direction=desc`;

    const headers: Record<string, string> =
      source === "github"
        ? { accept: "application/vnd.github+json" }
        : { accept: "application/json" };

    const rawText = await fetchText(
      releasesUrl,
      headers,
      this.policy.timeoutMs,
      this.maxRedirects
    );
    const parsedJson = JSON.parse(rawText) as unknown;
    if (!Array.isArray(parsedJson)) {
      throw new Error(`Expected JSON array of releases from ${source}.`);
    }

    const candidates: ParsedReleaseCandidate[] = [];
    for (const item of parsedJson) {
      if (!isRecord(item)) {
        continue;
      }
      const raw = item as RawReleaseRecord;
      if (raw.draft === true) {
        continue;
      }
      if (typeof raw.tag_name !== "string" || raw.tag_name.trim().length === 0) {
        continue;
      }
      const tagName = raw.tag_name.trim();
      const version = normalizeTagToVersion(tagName);
      const parsedSemver = parseSemver(version);
      if (parsedSemver === null) {
        continue;
      }
      const prerelease =
        raw.prerelease === true || parsedSemver.prerelease.length > 0;
      if (!includePrerelease && prerelease) {
        continue;
      }

      const rawAssetsList = Array.isArray(raw.assets) ? raw.assets : [];
      const rawAssets: ParsedReleaseCandidate["rawAssets"] = [];
      for (const rawAsset of rawAssetsList) {
        if (!isRecord(rawAsset)) {
          continue;
        }
        const typedAsset = rawAsset as RawReleaseAsset;
        if (
          typeof typedAsset.browser_download_url !== "string" ||
          typedAsset.browser_download_url.trim().length === 0
        ) {
          continue;
        }
        const downloadUrl = typedAsset.browser_download_url.trim();
        const name = extractAssetName(typedAsset, downloadUrl);
        if (name.length === 0) {
          continue;
        }
        const sizeBytes =
          typeof typedAsset.size === "number" && Number.isFinite(typedAsset.size)
            ? typedAsset.size
            : null;
        rawAssets.push({ name, downloadUrl, sizeBytes });
      }

      const fallbackHtmlUrl =
        source === "github"
          ? `${this.endpoints.githubWebBase}/${this.endpoints.githubOwner}/${this.endpoints.githubRepo}/releases/tag/${encodeURIComponent(tagName)}`
          : `${this.endpoints.giteeWebBase}/${this.endpoints.giteeOwner}/${this.endpoints.giteeRepo}/releases/tag/${encodeURIComponent(tagName)}`;

      candidates.push({
        version,
        tagName,
        prerelease,
        releaseName: typeof raw.name === "string" ? raw.name : tagName,
        releaseNotes: typeof raw.body === "string" ? raw.body : null,
        publishedAt:
          typeof raw.published_at === "string"
            ? raw.published_at
            : typeof raw.created_at === "string"
              ? raw.created_at
              : null,
        htmlUrl:
          typeof raw.html_url === "string" && raw.html_url.trim().length > 0
            ? raw.html_url.trim()
            : fallbackHtmlUrl,
        rawAssets
      });
    }

    candidates.sort((a, b) => compareSemver(b.version, a.version));
    const best = candidates[0];
    if (best === undefined) {
      return {
        checkedAt: Date.now(),
        currentVersion: this.currentVersion,
        hasUpdate: false,
        latestVersion: null,
        tagName: null,
        channel: null,
        prerelease: false,
        releaseName: null,
        releaseNotes: null,
        publishedAt: null,
        htmlUrl: null,
        sourceUsed: source,
        usedFallbackSource,
        recommendedAsset: null,
        assets: [],
        ...(probeReport !== undefined ? { probeReport } : {}),
        ...(priorErrors.length > 0 ? { errors: [...priorErrors] } : {})
      };
    }

    const hasUpdate = compareSemver(best.version, this.currentVersion) > 0;
    const assets = hasUpdate
      ? await this.resolveReleaseAssetsWithSha256(best, source)
      : [];
    const recommendedAsset = this.pickRecommendedAsset(assets);

    return {
      checkedAt: Date.now(),
      currentVersion: this.currentVersion,
      hasUpdate,
      latestVersion: best.version,
      tagName: best.tagName,
      channel: best.prerelease ? "prerelease" : "stable",
      prerelease: best.prerelease,
      releaseName: best.releaseName,
      releaseNotes: best.releaseNotes,
      publishedAt: best.publishedAt,
      htmlUrl: best.htmlUrl,
      sourceUsed: source,
      usedFallbackSource,
      recommendedAsset,
      assets,
      ...(probeReport !== undefined ? { probeReport } : {}),
      ...(priorErrors.length > 0 ? { errors: [...priorErrors] } : {})
    };
  }

  private async resolveReleaseAssetsWithSha256(
    release: ParsedReleaseCandidate,
    source: UpdateSourceId
  ): Promise<UpdateAssetInfo[]> {
    const checksumAsset = release.rawAssets.find((item) => {
      const lower = item.name.toLowerCase();
      return lower === "sha256sums.txt" || lower === "sha256sums";
    });

    let sumsMap = new Map<string, string>();
    let sumsSourceUrl: string | undefined;
    if (checksumAsset !== undefined) {
      sumsSourceUrl = this.resolveSourceUrl(checksumAsset.downloadUrl, source);
      try {
        const sumsText = await fetchText(
          sumsSourceUrl,
          {},
          this.policy.timeoutMs,
          this.maxRedirects
        );
        sumsMap = parseSha256SumsText(sumsText);
      } catch {
        // Leave sumsMap empty; per-asset .sha256 files can still verify
      }
    }

    const resolvedAssets: UpdateAssetInfo[] = [];
    for (const rawAsset of release.rawAssets) {
      const kind = classifyPackageAssetKind(rawAsset.name, release.version);
      if (kind === null) {
        continue;
      }

      let sha256: string | null = null;
      let sha256SourceUrl: string | undefined;

      const companionName = `${rawAsset.name.toLowerCase()}.sha256`;
      const companion = release.rawAssets.find(
        (item) => item.name.toLowerCase() === companionName
      );
      if (companion !== undefined) {
        const companionUrl = this.resolveSourceUrl(companion.downloadUrl, source);
        try {
          const companionText = await fetchText(
            companionUrl,
            {},
            this.policy.timeoutMs,
            this.maxRedirects,
            256 * 1024
          );
          const parsedDigest = parseSingleAssetSha256Text(
            companionText,
            rawAsset.name
          );
          if (isValidSha256Hex(parsedDigest)) {
            sha256 = parsedDigest;
            sha256SourceUrl = companionUrl;
          }
        } catch {
          // Fall through to SHA256SUMS.txt
        }
      }

      if (sha256 === null) {
        const fromSums = sumsMap.get(rawAsset.name.toLowerCase());
        if (isValidSha256Hex(fromSums)) {
          sha256 = fromSums;
          sha256SourceUrl = sumsSourceUrl;
        }
      }

      const effectiveUrl = this.resolveSourceUrl(rawAsset.downloadUrl, source);
      resolvedAssets.push({
        name: rawAsset.name,
        kind,
        downloadUrl: rawAsset.downloadUrl,
        effectiveUrl,
        sizeBytes: rawAsset.sizeBytes,
        sha256,
        ...(sha256SourceUrl !== undefined ? { sha256SourceUrl } : {}),
        source
      });
    }

    return resolvedAssets;
  }

  private resolveSourceUrl(rawUrl: string, source: UpdateSourceId): string {
    if (source === "github") {
      return applyGhProxyPrefix(rawUrl, this.policy.customGhProxyPrefix);
    }
    return rawUrl;
  }

  private pickRecommendedAsset(
    assets: readonly UpdateAssetInfo[]
  ): UpdateAssetInfo | null {
    if (assets.length === 0) {
      return null;
    }
    const preferredKind: UpdatePackageKind = this.portableMode
      ? "portable-zip"
      : "setup-exe";
    const fallbackKind: UpdatePackageKind = this.portableMode
      ? "setup-exe"
      : "portable-zip";

    return (
      assets.find((item) => item.kind === preferredKind) ??
      assets.find((item) => item.kind === fallbackKind) ??
      assets[0] ??
      null
    );
  }

  private selectDownloadAsset(
    checkResult: UpdateCheckResult,
    options?: DownloadUpdateOptions
  ): UpdateAssetInfo | null {
    if (options?.asset !== undefined) {
      return options.asset;
    }
    if (options?.kind !== undefined) {
      const matched = checkResult.assets.find(
        (item) => item.kind === options.kind
      );
      if (matched !== undefined) {
        return matched;
      }
    }
    if (!checkResult.hasUpdate) {
      return null;
    }
    return (
      checkResult.recommendedAsset ??
      this.pickRecommendedAsset(checkResult.assets)
    );
  }

  private requireValidSha256(
    sha256: string | null | undefined,
    assetName: string
  ): string {
    const normalized = typeof sha256 === "string" ? sha256.trim().toLowerCase() : "";
    if (!SHA256_HEX_RE.test(normalized)) {
      throw new Error(
        `Refusing to download or install update "${assetName}": missing valid 64-char SHA-256 checksum.`
      );
    }
    return normalized;
  }

  private async downloadAndVerifyAsset(params: {
    asset: UpdateAssetInfo;
    expectedSha256: string;
    version: string;
    targetPath: string;
    partPath: string;
    usedFallbackSource: boolean;
    maxRetries: number;
    retryDelaysMs: number[];
    onProgress?: (progress: UpdateDownloadProgress) => void;
  }): Promise<UpdateDownloadResult> {
    const effectiveDownloadUrl = this.resolveSourceUrl(
      params.asset.downloadUrl,
      params.asset.source
    );
    const totalExpectedHint = params.asset.sizeBytes ?? null;
    let resumedFromBytes = 0;

    for (let attempt = 0; attempt <= params.maxRetries; attempt += 1) {
      try {
        const existingSize = existsSync(params.partPath)
          ? statSync(params.partPath).size
          : 0;
        const headers: Record<string, string> = {};
        if (existingSize > 0) {
          headers["range"] = `bytes=${existingSize}-`;
        }

        const response = await openHttpWithRedirects(
          effectiveDownloadUrl,
          headers,
          this.policy.timeoutMs,
          this.maxRedirects
        );

        if (response.statusCode === 416) {
          response.stream.resume();
          if (existsSync(params.partPath)) {
            const checkExisting = await computeFileSha256(params.partPath);
            if (checkExisting.sha256 === params.expectedSha256) {
              break;
            }
            rmSync(params.partPath, { force: true });
          }
          throw new RetryableTransferError("Server returned 416; restarting from byte 0.");
        }

        if (response.statusCode !== 200 && response.statusCode !== 206) {
          response.stream.resume();
          throw new UpdateHttpError(response.statusCode, effectiveDownloadUrl);
        }

        let appendMode = false;
        let currentOffset = 0;
        if (response.statusCode === 206 && existingSize > 0) {
          const contentRange = parseContentRangeHeader(
            response.headers["content-range"]
          );
          if (contentRange !== null && contentRange.start !== existingSize) {
            response.stream.resume();
            rmSync(params.partPath, { force: true });
            throw new RetryableTransferError(
              `Content-Range start ${contentRange.start} mismatched offset ${existingSize}.`
            );
          }
          appendMode = true;
          currentOffset = existingSize;
          if (resumedFromBytes === 0) {
            resumedFromBytes = existingSize;
          }
        }

        const headerContentLength = response.headers["content-length"];
        const parsedContentLength =
          typeof headerContentLength === "string" && /^\d+$/.test(headerContentLength)
            ? Number.parseInt(headerContentLength, 10)
            : null;
        const totalBytesForProgress =
          parsedContentLength !== null
            ? currentOffset + parsedContentLength
            : totalExpectedHint;

        const writeStream = createWriteStream(params.partPath, {
          flags: appendMode ? "a" : "w"
        });

        let bytesWrittenThisAttempt = 0;
        let streamError: unknown = null;

        try {
          for await (const chunk of response.stream) {
            const buf = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk as Uint8Array);
            if (buf.length === 0) {
              continue;
            }
            await writeChunkToStream(writeStream, buf);
            bytesWrittenThisAttempt += buf.length;
            params.onProgress?.({
              bytesDownloaded: currentOffset + bytesWrittenThisAttempt,
              totalBytes: totalBytesForProgress,
              source: params.asset.source
            });
          }
        } catch (err) {
          streamError = err;
        }

        if (streamError !== null) {
          await closeWriteStream(writeStream);
          throw streamError;
        }

        await endWriteStream(writeStream);

        if (!response.stream.complete) {
          throw new RetryableTransferError(
            `Download stream aborted prematurely (${bytesWrittenThisAttempt} bytes received).`
          );
        }

        if (
          parsedContentLength !== null &&
          bytesWrittenThisAttempt !== parsedContentLength
        ) {
          throw new RetryableTransferError(
            `Truncated response body: expected ${parsedContentLength} bytes, got ${bytesWrittenThisAttempt}.`
          );
        }

        break;
      } catch (error) {
        if (attempt < params.maxRetries && isRetryableDownloadError(error)) {
          const delayMs =
            params.retryDelaysMs[
              Math.min(attempt, params.retryDelaysMs.length - 1)
            ] ?? 200;
          await sleepMs(delayMs);
          continue;
        }
        throw error;
      }
    }

    if (!existsSync(params.partPath)) {
      throw new Error(`Partial update file missing after download: ${params.partPath}`);
    }

    const computed = await computeFileSha256(params.partPath);
    if (computed.sha256 !== params.expectedSha256) {
      rmSync(params.partPath, { force: true });
      throw new UpdateIntegrityError(
        params.asset.name,
        params.expectedSha256,
        computed.sha256
      );
    }

    rmSync(params.targetPath, { force: true });
    renameSync(params.partPath, params.targetPath);

    return {
      downloadedAt: Date.now(),
      version: params.version,
      assetName: params.asset.name,
      filePath: params.targetPath,
      bytesDownloaded: computed.bytes,
      totalBytes: params.asset.sizeBytes ?? computed.bytes,
      resumedFromBytes,
      sha256: computed.sha256,
      verified: true,
      sourceUsed: params.asset.source,
      usedFallbackSource: params.usedFallbackSource,
      downloadUrl: effectiveDownloadUrl
    };
  }
}
