import type {
  DaemonUpdateAssetDto,
  DaemonUpdateChannel,
  DaemonUpdateDownloadProgressDto,
  DaemonUpdaterEvent,
  DaemonUpdaterStatusResponse,
} from "../daemonClient";
import { validateSafeHttpsUrl } from "../../components/settings/prismuxProviderMeta";

export type RoutePreference = "auto" | "domestic" | "global";
export type PluginRegistryOverride = "auto" | "npmmirror" | "npmjs";
export type UpdateSourceId = "github" | "gitee";

export interface SourceProbeView {
  readonly source: UpdateSourceId;
  readonly url: string;
  readonly reachable: boolean;
  readonly statusCode: number | null;
  readonly latencyMs: number | null;
  readonly error?: string;
}

export interface ProbeReportView {
  readonly probedAt: number;
  readonly recommendedSource: UpdateSourceId;
  readonly recommendedRoute: "domestic" | "global";
  readonly sources: readonly SourceProbeView[];
}

export interface UpdateSplitPartView {
  readonly name: string;
  readonly url: string;
  readonly size: number | null;
}

export interface UpdateAssetView {
  readonly name: string;
  readonly kind: string;
  readonly effectiveUrl: string | null;
  readonly sizeBytes: number | null;
  readonly sha256: string | null;
  readonly expectedExeName: string | null;
  readonly parts: readonly UpdateSplitPartView[];
  readonly source: UpdateSourceId;
}

export interface UpdateCheckView {
  readonly checkedAt: number;
  readonly currentVersion: string;
  readonly hasUpdate: boolean;
  readonly latestVersion: string | null;
  readonly tagName: string | null;
  readonly channel: DaemonUpdateChannel | null;
  readonly releaseName: string | null;
  readonly releaseNotes: string | null;
  readonly publishedAt: string | null;
  readonly htmlUrl: string | null;
  readonly sourceUsed: UpdateSourceId;
  readonly usedFallbackSource: boolean;
  readonly recommendedAsset: UpdateAssetView | null;
  readonly assets: readonly UpdateAssetView[];
}

export interface UpdaterPolicyView {
  readonly routePreference: RoutePreference;
  readonly channel: DaemonUpdateChannel;
  readonly includePrerelease: boolean;
  readonly customGhProxyPrefix: string;
  readonly pluginRegistryOverride: PluginRegistryOverride;
  readonly timeoutMs: number;
  readonly autoCheckEnabled: boolean;
}

export interface UpdateProgressView {
  readonly stage: "idle" | "downloading" | "extracting" | "verifying" | "ready" | "error";
  readonly percent: number | null;
  readonly bytesDownloaded: number;
  readonly totalBytes: number | null;
  readonly currentPart: number | null;
  readonly totalParts: number | null;
  readonly partName: string | null;
  readonly message: string | null;
  readonly updatedAt: number;
}

export interface UpdaterStatusView {
  readonly currentVersion: string;
  readonly portableMode: boolean;
  readonly policy: UpdaterPolicyView;
  readonly checking: boolean;
  readonly downloading: boolean;
  readonly installState: string;
  readonly progress: UpdateProgressView | null;
  readonly downloadedFilePath: string | null;
  readonly downloadedSha256: string | null;
  readonly lastCheck: UpdateCheckView | null;
  readonly lastProbe: ProbeReportView | null;
  readonly lastError: string | null;
}

export const ALLOWED_UPDATE_CHANNELS: readonly DaemonUpdateChannel[] = [
  "stable",
  "prerelease",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRoutePreference(value: unknown): RoutePreference {
  return value === "domestic" || value === "global" || value === "auto" ? value : "auto";
}

function asRegistryOverride(value: unknown): PluginRegistryOverride {
  return value === "npmmirror" || value === "npmjs" || value === "auto" ? value : "auto";
}

function asSourceId(value: unknown): UpdateSourceId {
  return value === "gitee" ? "gitee" : "github";
}

/**
 * Converges update channel strictly to `"stable" | "prerelease"`.
 * Legacy `"nightly"` or invalid inputs are never surfaced; `"nightly"` maps to `"prerelease"`.
 */
export function normalizeUpdateChannel(
  rawChannel: unknown,
  includePrereleaseFallback?: unknown,
): DaemonUpdateChannel {
  if (rawChannel === "stable") return "stable";
  if (rawChannel === "prerelease" || rawChannel === "nightly") return "prerelease";
  if (typeof includePrereleaseFallback === "boolean") {
    return includePrereleaseFallback ? "prerelease" : "stable";
  }
  return "prerelease";
}

/**
 * Resolves the real runtime version without any hardcoded legacy fallback like `"0.1.0-alpha.1"`.
 */
export function resolveRuntimeVersion(
  daemonVersion: string | null | undefined,
  appVersion: string | null | undefined,
): string {
  const fromDaemon = typeof daemonVersion === "string" ? daemonVersion.trim() : "";
  if (fromDaemon.length > 0 && fromDaemon !== "0.0.0") {
    return fromDaemon;
  }
  const fromApp = typeof appVersion === "string" ? appVersion.trim() : "";
  if (fromApp.length > 0 && fromApp !== "0.0.0") {
    return fromApp;
  }
  return "";
}

export function parseProbeReport(raw: unknown): ProbeReportView | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const rawSources = Array.isArray(rec.sources) ? rec.sources : [];
  const sources: SourceProbeView[] = [];
  for (const item of rawSources) {
    const s = asRecord(item);
    if (!s) continue;
    sources.push({
      source: asSourceId(s.source),
      url: asString(s.url),
      reachable: asBoolean(s.reachable, false),
      statusCode: asNullableNumber(s.statusCode),
      latencyMs: asNullableNumber(s.latencyMs),
      ...(typeof s.error === "string" ? { error: s.error } : {}),
    });
  }
  return {
    probedAt: typeof rec.probedAt === "number" ? rec.probedAt : Date.now(),
    recommendedSource: asSourceId(rec.recommendedSource),
    recommendedRoute: rec.recommendedRoute === "domestic" ? "domestic" : "global",
    sources,
  };
}

function parseAsset(raw: unknown): UpdateAssetView | null {
  const a = asRecord(raw) as (DaemonUpdateAssetDto & Record<string, unknown>) | null;
  if (!a) return null;
  const rawParts = Array.isArray(a.parts) ? a.parts : [];
  const parts: UpdateSplitPartView[] = [];
  for (const item of rawParts) {
    const p = asRecord(item);
    if (!p) continue;
    const url = validateSafeHttpsUrl(asString(p.effectiveUrl || p.url));
    if (!url) continue;
    parts.push({
      name: asString(p.name),
      url,
      size: asNullableNumber(p.size),
    });
  }
  const effectiveUrl = validateSafeHttpsUrl(asString(a.effectiveUrl || a.downloadUrl));
  return {
    name: asString(a.name),
    kind: asString(a.kind),
    effectiveUrl,
    sizeBytes: asNullableNumber(a.totalBytes ?? a.sizeBytes),
    sha256:
      typeof a.expectedSha256 === "string" && a.expectedSha256.length > 0
        ? a.expectedSha256
        : typeof a.sha256 === "string" && a.sha256.length > 0
          ? a.sha256
          : null,
    expectedExeName: typeof a.expectedExeName === "string" ? a.expectedExeName : null,
    parts,
    source: asSourceId(a.source),
  };
}

export function parseCheckResult(
  raw: unknown,
  runtimeVersionFallback = "",
): UpdateCheckView | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const rawAssets = Array.isArray(rec.assets) ? rec.assets : [];
  const assets: UpdateAssetView[] = [];
  for (const item of rawAssets) {
    const parsed = parseAsset(item);
    if (parsed) assets.push(parsed);
  }
  const recommendedAsset = parseAsset(rec.recommendedAsset) ?? selectRecommendedUpdateAsset(assets);
  const channel =
    rec.channel === "stable" || rec.channel === "prerelease"
      ? rec.channel
      : typeof rec.prerelease === "boolean"
        ? rec.prerelease
          ? "prerelease"
          : "stable"
        : null;
  return {
    checkedAt: typeof rec.checkedAt === "number" ? rec.checkedAt : Date.now(),
    currentVersion: resolveRuntimeVersion(
      typeof rec.currentVersion === "string" ? rec.currentVersion : null,
      runtimeVersionFallback,
    ),
    hasUpdate: asBoolean(rec.hasUpdate, false),
    latestVersion: typeof rec.latestVersion === "string" ? rec.latestVersion : null,
    tagName: typeof rec.tagName === "string" ? rec.tagName : null,
    channel,
    releaseName: typeof rec.releaseName === "string" ? rec.releaseName : null,
    releaseNotes: typeof rec.releaseNotes === "string" ? rec.releaseNotes : null,
    publishedAt: typeof rec.publishedAt === "string" ? rec.publishedAt : null,
    htmlUrl: validateSafeHttpsUrl(typeof rec.htmlUrl === "string" ? rec.htmlUrl : null),
    sourceUsed: asSourceId(rec.sourceUsed),
    usedFallbackSource: asBoolean(rec.usedFallbackSource, false),
    recommendedAsset,
    assets,
  };
}

export function parseProgress(raw: unknown): UpdateProgressView | null {
  const rec = asRecord(raw) as (DaemonUpdateDownloadProgressDto & Record<string, unknown>) | null;
  if (!rec) return null;
  const rawStage = asString(rec.stage || rec.phase, "idle");
  const stage: UpdateProgressView["stage"] =
    rawStage === "downloading" ||
    rawStage === "extracting" ||
    rawStage === "verifying" ||
    rawStage === "ready" ||
    rawStage === "error"
      ? rawStage
      : "idle";
  return {
    stage,
    percent: asNullableNumber(rec.percent),
    bytesDownloaded: asNullableNumber(rec.bytesDownloaded) ?? 0,
    totalBytes: asNullableNumber(rec.totalBytes),
    currentPart: asNullableNumber(rec.currentPart),
    totalParts: asNullableNumber(rec.totalParts),
    partName: typeof rec.partName === "string" ? rec.partName : null,
    message: typeof rec.message === "string" ? rec.message : null,
    updatedAt: typeof rec.updatedAt === "number" ? rec.updatedAt : Date.now(),
  };
}

export function parseUpdaterStatusPayload(
  raw: unknown,
  appVersionFallback = "",
): UpdaterStatusView | null {
  const root = asRecord(raw) as (DaemonUpdaterStatusResponse & Record<string, unknown>) | null;
  if (!root) return null;
  const policyRec = asRecord(root.policy);
  const channel = normalizeUpdateChannel(policyRec?.channel, policyRec?.includePrerelease);
  const lastDownload = asRecord(root.lastDownload);
  const currentVersion = resolveRuntimeVersion(
    typeof root.currentVersion === "string" ? root.currentVersion : null,
    appVersionFallback,
  );
  const downloadedFilePath =
    typeof root.downloadedFilePath === "string" && root.downloadedFilePath.trim().length > 0
      ? root.downloadedFilePath
      : typeof lastDownload?.filePath === "string" && lastDownload.filePath.trim().length > 0
        ? lastDownload.filePath
        : null;
  const downloadedSha256 =
    typeof root.downloadedSha256 === "string" && root.downloadedSha256.trim().length > 0
      ? root.downloadedSha256
      : typeof lastDownload?.sha256 === "string" && lastDownload.sha256.trim().length > 0
        ? lastDownload.sha256
        : null;

  const autoCheckEnabled =
    typeof policyRec?.autoCheckEnabled === "boolean"
      ? policyRec.autoCheckEnabled
      : typeof policyRec?.autoCheckUpdates === "boolean"
        ? policyRec.autoCheckUpdates
        : typeof root.autoCheckEnabled === "boolean"
          ? root.autoCheckEnabled
          : true;

  return {
    currentVersion,
    portableMode: asBoolean(root.portableMode, false),
    policy: {
      routePreference: asRoutePreference(policyRec?.routePreference),
      channel,
      includePrerelease: channel === "prerelease",
      customGhProxyPrefix: asString(policyRec?.customGhProxyPrefix),
      pluginRegistryOverride: asRegistryOverride(policyRec?.pluginRegistryOverride),
      timeoutMs: typeof policyRec?.timeoutMs === "number" ? policyRec.timeoutMs : 15000,
      autoCheckEnabled,
    },
    checking: asBoolean(root.checking, false),
    downloading: asBoolean(root.downloading, false),
    installState: asString(root.installState, "idle"),
    progress: parseProgress(root.progress),
    downloadedFilePath,
    downloadedSha256,
    lastCheck: parseCheckResult(root.lastCheck, currentVersion),
    lastProbe: parseProbeReport(root.lastProbe),
    lastError: typeof root.lastError === "string" ? root.lastError : null,
  };
}

export function applyUpdaterSseEvent(
  prev: UpdaterStatusView | null,
  event: DaemonUpdaterEvent,
  appVersionFallback = "",
): UpdaterStatusView | null {
  const payload = asRecord(event.data);
  if (!payload) return prev;
  if (payload.status) {
    const parsedStatus = parseUpdaterStatusPayload(payload.status, appVersionFallback);
    if (parsedStatus) return parsedStatus;
  }
  if (typeof payload.currentVersion === "string" || payload.policy) {
    const parsed = parseUpdaterStatusPayload(payload, appVersionFallback);
    if (parsed) return parsed;
  }
  if (!prev) return prev;
  const nextProgress = payload.progress
    ? parseProgress(payload.progress)
    : typeof payload.stage === "string" || typeof payload.phase === "string"
      ? parseProgress(payload)
      : prev.progress;
  const nextInstallState =
    typeof payload.installState === "string" ? payload.installState : prev.installState;
  const nextFilePath =
    typeof payload.downloadedFilePath === "string"
      ? payload.downloadedFilePath
      : prev.downloadedFilePath;
  const nextSha =
    typeof payload.downloadedSha256 === "string"
      ? payload.downloadedSha256
      : prev.downloadedSha256;
  const nextError =
    typeof payload.error === "string"
      ? payload.error
      : event.event === "error" && typeof payload.message === "string"
        ? payload.message
        : prev.lastError;
  const downloading =
    nextInstallState === "downloading" ||
    nextInstallState === "extracting" ||
    nextInstallState === "verifying" ||
    nextProgress?.stage === "downloading" ||
    nextProgress?.stage === "extracting" ||
    nextProgress?.stage === "verifying";

  return {
    ...prev,
    downloading,
    installState: nextInstallState,
    progress: nextProgress,
    downloadedFilePath: nextFilePath,
    downloadedSha256: nextSha,
    lastError: nextError,
  };
}

export function selectRecommendedUpdateAsset(
  assets: readonly UpdateAssetView[],
  portableMode = false,
): UpdateAssetView | null {
  if (assets.length === 0) return null;
  if (portableMode) {
    return (
      assets.find((a) => a.kind === "portable-zip") ??
      assets.find((a) => a.kind === "split-7z-exe") ??
      assets.find((a) => a.kind === "setup-exe") ??
      assets[0] ??
      null
    );
  }
  return (
    assets.find((a) => a.kind === "setup-exe") ??
    assets.find((a) => a.kind === "split-7z-exe") ??
    assets.find((a) => a.kind === "portable-zip") ??
    assets[0] ??
    null
  );
}

export interface UpdaterStageStepDescriptor {
  readonly id: "downloading" | "extracting" | "verifying" | "ready";
  readonly label: string;
  readonly weightLabel: string;
  readonly state: "completed" | "active" | "pending";
}

export function resolveProgressBarPercent(
  progress: UpdateProgressView | null,
  hasVerifiedPackage = false,
): number | null {
  if (
    progress?.percent !== null &&
    progress?.percent !== undefined &&
    Number.isFinite(progress.percent)
  ) {
    return Math.max(0, Math.min(100, Math.round(progress.percent * 10) / 10));
  }
  if (progress?.stage === "ready" || hasVerifiedPackage) {
    return 100;
  }
  return null;
}

export function formatProgressPercentDisplay(percent: number | null): string | null {
  if (percent === null || !Number.isFinite(percent)) {
    return null;
  }
  if (percent >= 100) {
    return "100%";
  }
  const rounded = Math.max(0, Math.min(99, Math.round(percent)));
  return `${rounded}%`;
}

export function formatUpdaterStageWeightHint(
  progress: UpdateProgressView | null,
  isSplitArchive = false,
): string {
  const split =
    isSplitArchive ||
    (progress?.totalParts !== null &&
      progress?.totalParts !== undefined &&
      progress.totalParts > 1) ||
    progress?.stage === "extracting";
  if (split) {
    const partsCount =
      progress?.totalParts !== null &&
      progress?.totalParts !== undefined &&
      progress.totalParts > 1
        ? progress.totalParts
        : 3;
    const perPart = Math.round((90 / partsCount) * 10) / 10;
    return `分卷下载 0–90%（每卷 ${perPart}%） · 合并解压 90–95% · SHA-256 校验 95–100%`;
  }
  return "安装包下载 0–90% · SHA-256 校验 90–100%";
}

export function buildUpdaterStageSteps(
  progress: UpdateProgressView | null,
  hasVerifiedPackage = false,
  isSplitArchive = false,
): readonly UpdaterStageStepDescriptor[] {
  const split =
    isSplitArchive ||
    (progress?.totalParts !== null &&
      progress?.totalParts !== undefined &&
      progress.totalParts > 1) ||
    progress?.stage === "extracting";
  const stage = progress?.stage ?? "idle";
  const isReady = hasVerifiedPackage || stage === "ready";
  const isVerifying = !isReady && stage === "verifying";
  const isExtracting = !isReady && stage === "extracting";

  return [
    {
      id: "downloading",
      label: "下载中",
      weightLabel: "0–90%",
      state: isReady || isVerifying || isExtracting ? "completed" : "active",
    },
    {
      id: "extracting",
      label: "合并分卷",
      weightLabel: split ? "90–95%" : "直装免合并",
      state: isReady || isVerifying ? "completed" : isExtracting ? "active" : "pending",
    },
    {
      id: "verifying",
      label: "SHA-256 校验",
      weightLabel: split ? "95–100%" : "90–100%",
      state: isReady ? "completed" : isVerifying ? "active" : "pending",
    },
    {
      id: "ready",
      label: "校验就绪",
      weightLabel: "100%",
      state: isReady ? "completed" : "pending",
    },
  ];
}

export function describeUpdaterProgressStage(progress: UpdateProgressView | null): string {
  if (!progress) return "正在连接下载源…";
  if (progress.stage === "downloading") {
    if (progress.currentPart !== null && progress.totalParts !== null && progress.totalParts > 1) {
      const partLabel = progress.partName ? ` (${progress.partName})` : "";
      return `正在下载分卷 ${progress.currentPart}/${progress.totalParts}${partLabel}`;
    }
    if (progress.percent === null && progress.bytesDownloaded <= 0) {
      return "正在连接下载源…";
    }
    return "正在下载安装包";
  }
  if (progress.stage === "extracting") {
    return "正在无损解压合并 Gitee 分卷";
  }
  if (progress.stage === "verifying") {
    return "正在执行整包 SHA-256 强校验";
  }
  if (progress.stage === "ready") {
    return "SHA-256 校验通过，安装包已就绪";
  }
  if (progress.stage === "error") {
    return progress.message ?? "更新下载或校验失败";
  }
  return progress.message ?? "";
}

const RELEASE_BANNER_H1_RE = /^#\s+(?:Prismux\b|Release\b|v?\d+\.\d+\.\d+)/i;
const RELEASE_BOILERPLATE_QUOTE_RE =
  /(?:标准\s*SemVer|Standard\s*SemVer|SemVer\s*\/\s*Tag|中国大陆用户亦可前往.*Gitee\s*Releases|统一插件校验清单)/i;
const BOILERPLATE_H2_RE =
  /(?:下载指南|安装包(?:与|和)校验|发布资产|资产(?:与|和).*校验|校验摘要|完整性校验|sha-?256|checksums?|download\s*guide|\bdownloads?\b|assets?\s*[&＆/]\s*checksums?|gitee.*分卷|无损分卷|分卷(?:下载|还原|合并)|(?:官方(?:独立|认证|按需)?|两大|四大).*插件.*(?:安装|不预装|零预装)|optional\s+official\s+plugins?)/i;
const BOILERPLATE_H3_RE =
  /(?:gitee.*分卷|无损分卷|分卷(?:下载|还原|合并)|完整性校验|校验命令|sha-?256|checksums?|桌面主程序\s*[（(]?Desktop\s*App|官方认证按需插件|插件安装方式)/i;
const BOILERPLATE_VERIFY_CODE_RE =
  /(?:Get-FileHash|sha256sum|certutil\s+-hashfile|7z\s+x\s+.*\.7z\.001|SHA256SUMS\.txt)/i;
const FENCE_OPEN_RE = /^\s*(`{3,}|~{3,})/;

function trimBlankAndRuleEdges(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end) {
    const t = lines[start]!.trim();
    if (t.length === 0 || /^[-*_]{3,}$/.test(t)) {
      start += 1;
    } else {
      break;
    }
  }
  while (end > start) {
    const t = lines[end - 1]!.trim();
    if (t.length === 0 || /^[-*_]{3,}$/.test(t)) {
      end -= 1;
    } else {
      break;
    }
  }
  return lines.slice(start, end);
}

function cleanReleaseNotesLinesBlock(
  lines: readonly string[],
  options: { readonly stripLeadingBannerH1: boolean },
): string[] {
  const out: string[] = [];
  let skippingBoilerplateH3 = false;
  let seenContent = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Fenced code blocks: keep atomic so `# comments` inside shell/powershell never mimic headings.
    const fenceOpen = FENCE_OPEN_RE.exec(line);
    if (fenceOpen) {
      const fenceMarker = fenceOpen[1]!;
      const fenceChar = fenceMarker[0]!;
      const fenceLen = fenceMarker.length;
      const closeRe = new RegExp(`^\\s*${fenceChar === "`" ? "`" : "~"}{${fenceLen},}\\s*$`);
      const blockLines: string[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        blockLines.push(lines[j]!);
        if (closeRe.test(lines[j]!)) {
          j += 1;
          break;
        }
        j += 1;
      }
      if (!skippingBoilerplateH3) {
        const joined = blockLines.join("\n");
        if (!BOILERPLATE_VERIFY_CODE_RE.test(joined)) {
          seenContent = true;
          out.push(...blockLines);
        }
      }
      i = j - 1;
      continue;
    }

    const h3Match = /^###\s+(.+)$/.exec(trimmed);
    if (h3Match) {
      if (BOILERPLATE_H3_RE.test(h3Match[1]!)) {
        skippingBoilerplateH3 = true;
        continue;
      }
      skippingBoilerplateH3 = false;
      seenContent = true;
      out.push(line);
      continue;
    }

    if (skippingBoilerplateH3) {
      continue;
    }

    if (options.stripLeadingBannerH1 && !seenContent && RELEASE_BANNER_H1_RE.test(trimmed)) {
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [line];
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim().startsWith(">")) {
        quoteLines.push(lines[j]!);
        j += 1;
      }
      if (!RELEASE_BOILERPLATE_QUOTE_RE.test(quoteLines.join("\n"))) {
        seenContent = true;
        out.push(...quoteLines);
      }
      i = j - 1;
      continue;
    }

    if (trimmed.length === 0) {
      out.push("");
      continue;
    }

    if (!/^[-*_]{3,}$/.test(trimmed)) {
      seenContent = true;
    }
    out.push(line);
  }

  return trimBlankAndRuleEdges(out);
}

/**
 * Extracts the human-readable highlights/changelog sections from GitHub or Gitee
 * release notes Markdown, regardless of whether highlights appear before or after
 * `## 📦 下载指南`.
 *
 * Strips ONLY boilerplate release framing:
 * - Top `# Prismux v...` title banner
 * - `> 标准 SemVer / Tag...` metadata quote
 * - `## 📦 下载指南...` download tables & plugin-install boilerplate
 * - `### Gitee 80 MB 无损分卷...` split tables & SHA-256 verification commands
 *
 * Gracefully falls back to the normalized non-empty Markdown body if no distinct
 * highlights section remains, so the UI never displays blank or truncated notes.
 */
export function extractReleaseNotesHighlights(rawMarkdown: string | null | undefined): string {
  if (typeof rawMarkdown !== "string") {
    return "";
  }
  const normalized = rawMarkdown
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (normalized.length === 0) {
    return "";
  }

  const lines = normalized.split("\n");
  const preambleLines: string[] = [];
  const h2Sections: Array<{
    readonly headingLine: string;
    readonly headingText: string;
    readonly bodyLines: string[];
  }> = [];

  let currentSection: {
    readonly headingLine: string;
    readonly headingText: string;
    readonly bodyLines: string[];
  } | null = null;
  let activeFence: { readonly char: string; readonly len: number } | null = null;

  for (const line of lines) {
    if (activeFence !== null) {
      if (currentSection) {
        currentSection.bodyLines.push(line);
      } else {
        preambleLines.push(line);
      }
      const closeRe = new RegExp(
        `^\\s*${activeFence.char === "`" ? "`" : "~"}{${activeFence.len},}\\s*$`,
      );
      if (closeRe.test(line)) {
        activeFence = null;
      }
      continue;
    }

    const fenceOpen = FENCE_OPEN_RE.exec(line);
    if (fenceOpen) {
      const marker = fenceOpen[1]!;
      activeFence = { char: marker[0]!, len: marker.length };
      if (currentSection) {
        currentSection.bodyLines.push(line);
      } else {
        preambleLines.push(line);
      }
      continue;
    }

    const h2Match = /^##\s+(.+)$/.exec(line.trim());
    if (h2Match) {
      currentSection = {
        headingLine: line.trimEnd(),
        headingText: h2Match[1]!.trim(),
        bodyLines: [],
      };
      h2Sections.push(currentSection);
      continue;
    }

    if (currentSection) {
      currentSection.bodyLines.push(line);
    } else {
      preambleLines.push(line);
    }
  }

  const parts: string[] = [];
  const cleanedPreamble = cleanReleaseNotesLinesBlock(preambleLines, {
    stripLeadingBannerH1: true,
  });
  if (cleanedPreamble.length > 0) {
    parts.push(cleanedPreamble.join("\n"));
  }

  for (const section of h2Sections) {
    if (BOILERPLATE_H2_RE.test(section.headingText)) {
      continue;
    }
    const hadRawBody = section.bodyLines.some((l) => l.trim().length > 0);
    const cleanedBody = cleanReleaseNotesLinesBlock(section.bodyLines, {
      stripLeadingBannerH1: false,
    });
    if (hadRawBody && cleanedBody.length === 0) {
      continue;
    }
    const sectionMarkdown =
      cleanedBody.length > 0
        ? `${section.headingLine}\n\n${cleanedBody.join("\n")}`
        : section.headingLine;
    parts.push(sectionMarkdown);
  }

  const extracted = parts
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return extracted.length > 0 ? extracted : normalized;
}
