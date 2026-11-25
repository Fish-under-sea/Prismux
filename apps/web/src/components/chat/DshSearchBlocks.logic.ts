import type { OrchestrationV2TurnItem } from "@prismux/core-contracts";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import type { WorkLogEntry } from "../../session-logic";

export const DEFAULT_SEARCH_MAX_LINES = 16;

export const DSH_SEARCH_COPY_ZH = {
  copy: "复制",
  copied: "已复制",
  collapse: "收起",
  expandMoreLines: (count: number) => `展开其余 ${count} 行`,
  matchCountPill: (count: number) => `${count} 条`,
  emptyMatches: "未找到匹配结果",
  emptyPaths: "未找到匹配文件",
  emptySources: "暂无搜索来源",
  partialSourcesTruncated: "部分来源已截断",
  contentTruncated: "内容已截断",
  webFetchFallback: "网页抓取",
} as const;

export interface GroupedMatchVisibleSection {
  readonly kind: "group";
  readonly group: DshSearchFileGroup;
  readonly headMatches: ReadonlyArray<{ readonly match: DshSearchMatchLine; readonly globalIndex: number }>;
  readonly tailMatches: ReadonlyArray<{ readonly match: DshSearchMatchLine; readonly globalIndex: number }>;
  readonly needsGapBeforeGroup: boolean;
  readonly needsGapInsideGroup: boolean;
}

export interface GroupedMatchGapSection {
  readonly kind: "gap";
  readonly key: string;
}

export type GroupedMatchRenderSection = GroupedMatchVisibleSection | GroupedMatchGapSection;

export function buildGroupedMatchRenderSections(
  groups: ReadonlyArray<DshSearchFileGroup>,
  maxLines: number,
  expandedAll: boolean,
): {
  readonly slice: HeadTailSlice;
  readonly sections: ReadonlyArray<GroupedMatchRenderSection>;
} {
  const totalMatches = groups.reduce((sum, group) => sum + group.matches.length, 0);
  const slice = computeHeadTailSlice(totalMatches, maxLines);
  const useCap = slice.collapsed && !expandedAll;
  const tailStart = totalMatches - slice.tailCount;

  const sections: GroupedMatchRenderSection[] = [];
  let cursor = 0;
  let gapInserted = false;

  for (const group of groups) {
    const groupStart = cursor;
    cursor += group.matches.length;

    if (!useCap) {
      sections.push({
        kind: "group",
        group,
        headMatches: group.matches.map((match, idx) => ({ match, globalIndex: groupStart + idx })),
        tailMatches: [],
        needsGapBeforeGroup: false,
        needsGapInsideGroup: false,
      });
      continue;
    }

    const headMatches: Array<{ readonly match: DshSearchMatchLine; readonly globalIndex: number }> =
      [];
    const tailMatches: Array<{ readonly match: DshSearchMatchLine; readonly globalIndex: number }> =
      [];

    for (let idx = 0; idx < group.matches.length; idx += 1) {
      const globalIndex = groupStart + idx;
      if (globalIndex < slice.headCount) {
        headMatches.push({ match: group.matches[idx]!, globalIndex });
      } else if (globalIndex >= tailStart) {
        tailMatches.push({ match: group.matches[idx]!, globalIndex });
      }
    }

    if (headMatches.length === 0 && tailMatches.length === 0) {
      if (!gapInserted && groupStart >= slice.headCount) {
        gapInserted = true;
        sections.push({ kind: "gap", key: `gap:${group.path}` });
      }
      continue;
    }

    const needsGapInsideGroup = headMatches.length > 0 && tailMatches.length > 0;
    const needsGapBeforeGroup =
      !gapInserted && headMatches.length === 0 && tailMatches.length > 0;
    if (needsGapInsideGroup || needsGapBeforeGroup) {
      gapInserted = true;
    }

    sections.push({
      kind: "group",
      group,
      headMatches: needsGapInsideGroup ? headMatches : [...headMatches, ...tailMatches],
      tailMatches: needsGapInsideGroup ? tailMatches : [],
      needsGapBeforeGroup,
      needsGapInsideGroup,
    });
  }

  return { slice, sections };
}

export interface DshSearchMatchLine {
  readonly lineNumber?: number | undefined;
  readonly column?: number | undefined;
  readonly text: string;
}

export interface DshSearchFileGroup {
  readonly path: string;
  readonly displayPath: string;
  readonly matches: ReadonlyArray<DshSearchMatchLine>;
}

export type NormalizedDshSearchData =
  | {
      readonly kind: "matches";
      readonly query?: string | undefined;
      readonly scope?: string | undefined;
      readonly groups: ReadonlyArray<DshSearchFileGroup>;
      readonly totalMatches: number;
      readonly totalFiles: number;
      readonly shownMatches: number;
      readonly shownFiles: number;
      readonly truncated: boolean;
      readonly copyText: string;
      readonly summaryZh: string;
    }
  | {
      readonly kind: "paths";
      readonly query?: string | undefined;
      readonly scope?: string | undefined;
      readonly paths: ReadonlyArray<{ readonly path: string; readonly displayPath: string }>;
      readonly totalPaths: number;
      readonly shownPaths: number;
      readonly truncated: boolean;
      readonly copyText: string;
      readonly summaryZh: string;
    };

export interface DshWebSource {
  readonly url: string;
  readonly safeHref: string | null;
  readonly title: string;
  readonly hostname: string | null;
  readonly snippet?: string | undefined;
  readonly publishedDate?: string | undefined;
}

export type NormalizedDshWebData =
  | {
      readonly kind: "search";
      readonly queries: ReadonlyArray<string>;
      readonly answerMarkdown?: string | undefined;
      readonly sources: ReadonlyArray<DshWebSource>;
      readonly truncated: boolean;
      readonly copyText: string;
      readonly summaryZh: string;
    }
  | {
      readonly kind: "fetch";
      readonly url: string;
      readonly safeHref: string | null;
      readonly hostname: string | null;
      readonly title?: string | undefined;
      readonly httpStatus?: number | undefined;
      readonly contentType?: string | undefined;
      readonly excerpt?: string | undefined;
      readonly truncated: boolean;
      readonly copyText: string;
      readonly summaryZh: string;
    };

export interface HeadTailSlice {
  readonly collapsed: boolean;
  readonly headCount: number;
  readonly tailCount: number;
  readonly hiddenCount: number;
}

export function computeHeadTailSlice(
  totalLines: number,
  maxLines = DEFAULT_SEARCH_MAX_LINES,
): HeadTailSlice {
  const safeMax = Math.max(2, Math.floor(maxLines));
  if (totalLines <= safeMax) {
    return { collapsed: false, headCount: totalLines, tailCount: 0, hiddenCount: 0 };
  }
  const headCount = Math.ceil(safeMax / 2);
  const tailCount = Math.floor(safeMax / 2);
  return {
    collapsed: true,
    headCount,
    tailCount,
    hiddenCount: totalLines - headCount - tailCount,
  };
}

const CODE_SEARCH_TOOL_NAMES = new Set([
  "grep",
  "grep_search",
  "grepsearch",
  "ripgrep",
  "rg",
  "glob",
  "glob_search",
  "globsearch",
  "find_by_name",
  "findbyname",
  "find_files",
  "findfiles",
  "search_files",
  "searchfiles",
  "file_search",
  "filesearch",
  "code_search",
  "codesearch",
  "search_code",
  "list_files",
  "fd",
]);

const PATH_ONLY_SEARCH_TOOL_NAMES = new Set([
  "glob",
  "glob_search",
  "globsearch",
  "find_by_name",
  "findbyname",
  "find_files",
  "findfiles",
  "list_files",
  "fd",
]);

const WEB_SEARCH_TOOL_NAMES = new Set([
  "web_search",
  "websearch",
  "search_web",
  "searchweb",
  "google_search",
  "brave_search",
  "exa_search",
  "tavily_search",
  "perplexity_search",
  "xsearch",
]);

const WEB_FETCH_TOOL_NAMES = new Set([
  "web_fetch",
  "webfetch",
  "fetch_url",
  "fetchurl",
  "fetch",
  "read_url_content",
  "open_url",
  "get_webpage",
  "browse_url",
  "curl_url",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asFiniteInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return undefined;
}

function normalizeToolNameToken(raw: string | null | undefined): string {
  if (!raw) return "";
  const stripped = raw
    .trim()
    .replace(/^run(?:ning)?\s+/iu, "")
    .replace(/\?+$/u, "")
    .trim();
  const tail = stripped.split(/(?:__|[./:])/u).at(-1) ?? stripped;
  return tail
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, "_");
}

/**
 * Strictly validates an external web URL, accepting ONLY `http:` and `https:`.
 * Rejects `javascript:`, `data:`, `file:`, `vbscript:`, etc.
 */
export function sanitizeExternalHttpUrl(raw: string | null | undefined): {
  readonly safeHref: string | null;
  readonly hostname: string | null;
} {
  if (!raw) return { safeHref: null, hostname: null };
  const trimmed = raw.trim();
  if (!trimmed) return { safeHref: null, hostname: null };
  try {
    const parsed = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { safeHref: null, hostname: null };
    }
    const hostname = parsed.hostname.replace(/^www\./iu, "") || null;
    return { safeHref: parsed.href, hostname };
  } catch {
    return { safeHref: null, hostname: null };
  }
}

function extractOutputText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim().length > 0 ? value : undefined;
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const entry of value) {
      if (typeof entry === "string") {
        parts.push(entry);
      } else if (isRecord(entry)) {
        if (entry.type === "text" && typeof entry.text === "string") {
          parts.push(entry.text);
        } else if (
          entry.type === "content" &&
          isRecord(entry.content) &&
          typeof entry.content.text === "string"
        ) {
          parts.push(entry.content.text);
        } else if (typeof entry.text === "string") {
          parts.push(entry.text);
        }
      }
    }
    const joined = parts.join("\n").trim();
    return joined.length > 0 ? joined : undefined;
  }
  if (isRecord(value)) {
    for (const key of ["output", "stdout", "text", "content", "body", "markdown", "result"] as const) {
      const candidate = extractOutputText(value[key]);
      if (candidate) return candidate;
    }
  }
  return undefined;
}

function tryParseJson(text: string | undefined): unknown {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function formatDisplayPath(rawPath: string, workspaceRoot?: string): string {
  const cleaned = rawPath.trim();
  if (!cleaned) return "";
  return formatWorkspaceRelativePath(cleaned, workspaceRoot);
}

// Matches `path:line:text`, `path:line:col:text`, or `D:\path\file.ts:42:text`
const GREP_LINE_RE = /^((?:[A-Za-z]:[\\/])?[^:\r\n]+?):(\d+)(?::(\d+))?:(.*)$/u;
// Matches ripgrep heading line `42:text` or `42-context`
const RG_HEADING_MATCH_RE = /^(\d+)([:-])(.*)$/u;
const TRUNCATION_FOOTER_RE =
  /(?:truncated|capped|omitted|more\s+(?:matches|files|results|lines)|已截断|仅显示)/iu;
const TOTAL_COUNT_HINT_RE =
  /(?:of|out\s+of|total(?:\s+of)?|共)\s*(\d+)\s*(?:matches|files|results|paths|条|个)/iu;

function looksLikeFilePathLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 512) return false;
  if (TRUNCATION_FOOTER_RE.test(trimmed)) return false;
  if (/^(?:found|showing|matches|files|error:|warning:|no\s+matches)/iu.test(trimmed)) return false;
  if (trimmed.includes("://")) return false;
  return (
    /[\\/]/u.test(trimmed) ||
    /\.[A-Za-z0-9]{1,10}$/u.test(trimmed) ||
    /^(?:Makefile|Dockerfile|LICENSE|README|package\.json)$/u.test(trimmed)
  );
}

function parsePlainSearchText(
  rawText: string,
  options: {
    readonly workspaceRoot?: string | undefined;
    readonly preferPaths?: boolean | undefined;
  },
): {
  readonly kind: "matches" | "paths";
  readonly groups: DshSearchFileGroup[];
  readonly paths: Array<{ readonly path: string; readonly displayPath: string }>;
  readonly truncated: boolean;
  readonly totalHint?: number | undefined;
} | null {
  const rawLines = rawText.replace(/\r\n/gu, "\n").split("\n");
  let truncated = false;
  let totalHint: number | undefined;

  const contentLines: string[] = [];
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (TRUNCATION_FOOTER_RE.test(trimmed) && !GREP_LINE_RE.test(trimmed)) {
      truncated = true;
      const countMatch = TOTAL_COUNT_HINT_RE.exec(trimmed);
      if (countMatch?.[1]) {
        totalHint = Number.parseInt(countMatch[1], 10);
      }
      continue;
    }
    if (/^\.{3,}$/u.test(trimmed)) {
      truncated = true;
      continue;
    }
    contentLines.push(line);
  }

  if (contentLines.length === 0) return null;

  // Try `path:line:text` or ripgrep heading format first (unless strictly path-only and no `path:line:`)
  const groupsByPath = new Map<string, DshSearchMatchLine[]>();
  let matchedLineCount = 0;
  let activeHeadingPath: string | null = null;

  for (const line of contentLines) {
    const grepMatch = GREP_LINE_RE.exec(line);
    if (grepMatch) {
      const filePath = grepMatch[1]!.trim();
      const lineNumber = Number.parseInt(grepMatch[2]!, 10);
      const column = grepMatch[3] ? Number.parseInt(grepMatch[3], 10) : undefined;
      const text = grepMatch[4] ?? "";
      const bucket = groupsByPath.get(filePath) ?? [];
      bucket.push({ lineNumber, ...(column === undefined ? {} : { column }), text });
      groupsByPath.set(filePath, bucket);
      matchedLineCount += 1;
      activeHeadingPath = filePath;
      continue;
    }
    if (!options.preferPaths) {
      const rgHeading = RG_HEADING_MATCH_RE.exec(line);
      if (rgHeading && activeHeadingPath !== null) {
        const lineNumber = Number.parseInt(rgHeading[1]!, 10);
        const text = rgHeading[3] ?? "";
        const bucket = groupsByPath.get(activeHeadingPath) ?? [];
        bucket.push({ lineNumber, text });
        groupsByPath.set(activeHeadingPath, bucket);
        matchedLineCount += 1;
        continue;
      }
      if (looksLikeFilePathLine(line)) {
        activeHeadingPath = line.trim();
      }
    }
  }

  if (matchedLineCount > 0 && (!options.preferPaths || matchedLineCount >= Math.ceil(contentLines.length / 2))) {
    const groups: DshSearchFileGroup[] = [];
    for (const [path, matches] of groupsByPath.entries()) {
      groups.push({
        path,
        displayPath: formatDisplayPath(path, options.workspaceRoot),
        matches,
      });
    }
    return { kind: "matches", groups, paths: [], truncated, totalHint };
  }

  // Otherwise parse as flat path list
  const seen = new Set<string>();
  const paths: Array<{ readonly path: string; readonly displayPath: string }> = [];
  for (const line of contentLines) {
    const trimmed = line.trim().replace(/^[-*•]\s+/u, "");
    if (!looksLikeFilePathLine(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    paths.push({
      path: trimmed,
      displayPath: formatDisplayPath(trimmed, options.workspaceRoot),
    });
  }
  if (paths.length > 0) {
    return { kind: "paths", groups: [], paths, truncated, totalHint };
  }

  // Last resort: preserve plain lines as single pseudo-group only if raw output is non-empty text
  return null;
}

function buildSearchSummaryZh(input: {
  readonly kind: "matches" | "paths";
  readonly shownMatches?: number;
  readonly totalMatches?: number;
  readonly shownFiles?: number;
  readonly shownPaths?: number;
  readonly totalPaths?: number;
  readonly truncated: boolean;
}): string {
  if (input.kind === "matches") {
    const shown = input.shownMatches ?? 0;
    const total = input.totalMatches ?? shown;
    const files = input.shownFiles ?? 0;
    if (input.truncated) {
      return total > shown
        ? `显示 ${shown} / 共 ${total} 条匹配 · ${files} 个文件（已截断）`
        : `显示 ${shown} 条匹配 · 共 ${files} 个文件（已截断）`;
    }
    return `显示 ${shown} 条匹配 · 共 ${files} 个文件`;
  }
  const shown = input.shownPaths ?? 0;
  const total = input.totalPaths ?? shown;
  if (input.truncated) {
    return total > shown
      ? `显示 ${shown} / 共 ${total} 个文件（已截断）`
      : `显示 ${shown} 个文件（已截断）`;
  }
  return `显示 ${shown} 个文件`;
}

function finalizeMatchesSearch(input: {
  readonly query?: string | undefined;
  readonly scope?: string | undefined;
  readonly groups: ReadonlyArray<DshSearchFileGroup>;
  readonly totalMatches?: number | undefined;
  readonly totalFiles?: number | undefined;
  readonly truncated?: boolean | undefined;
}): NormalizedDshSearchData {
  const shownFiles = input.groups.length;
  const shownMatches = input.groups.reduce((sum, group) => sum + group.matches.length, 0);
  const totalMatches = Math.max(shownMatches, input.totalMatches ?? shownMatches);
  const totalFiles = Math.max(shownFiles, input.totalFiles ?? shownFiles);
  const truncated = input.truncated === true || totalMatches > shownMatches || totalFiles > shownFiles;
  const copyLines: string[] = [];
  for (const group of input.groups) {
    for (const match of group.matches) {
      copyLines.push(
        match.lineNumber !== undefined
          ? `${group.displayPath}:${match.lineNumber}:${match.text}`
          : `${group.displayPath}:${match.text}`,
      );
    }
  }
  return {
    kind: "matches",
    ...(input.query ? { query: input.query } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
    groups: input.groups,
    totalMatches,
    totalFiles,
    shownMatches,
    shownFiles,
    truncated,
    copyText: copyLines.join("\n"),
    summaryZh: buildSearchSummaryZh({
      kind: "matches",
      shownMatches,
      totalMatches,
      shownFiles,
      truncated,
    }),
  };
}

function finalizePathsSearch(input: {
  readonly query?: string | undefined;
  readonly scope?: string | undefined;
  readonly paths: ReadonlyArray<{ readonly path: string; readonly displayPath: string }>;
  readonly totalPaths?: number | undefined;
  readonly truncated?: boolean | undefined;
}): NormalizedDshSearchData {
  const shownPaths = input.paths.length;
  const totalPaths = Math.max(shownPaths, input.totalPaths ?? shownPaths);
  const truncated = input.truncated === true || totalPaths > shownPaths;
  return {
    kind: "paths",
    ...(input.query ? { query: input.query } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
    paths: input.paths,
    totalPaths,
    shownPaths,
    truncated,
    copyText: input.paths.map((entry) => entry.displayPath).join("\n"),
    summaryZh: buildSearchSummaryZh({
      kind: "paths",
      shownPaths,
      totalPaths,
      truncated,
    }),
  };
}

function parseStructuredSearchObject(
  value: unknown,
  options: {
    readonly query?: string | undefined;
    readonly scope?: string | undefined;
    readonly workspaceRoot?: string | undefined;
    readonly preferPaths?: boolean | undefined;
  },
): NormalizedDshSearchData | null {
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === "string")) {
      const paths = value
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((path) => ({ path, displayPath: formatDisplayPath(path, options.workspaceRoot) }));
      return paths.length > 0
        ? finalizePathsSearch({ query: options.query, scope: options.scope, paths })
        : null;
    }
    const groupsByPath = new Map<string, DshSearchMatchLine[]>();
    const paths: Array<{ readonly path: string; readonly displayPath: string }> = [];
    for (const entry of value) {
      if (!isRecord(entry)) continue;
      const path =
        asNonEmptyString(entry.fileName) ??
        asNonEmptyString(entry.file) ??
        asNonEmptyString(entry.path) ??
        asNonEmptyString(entry.filePath) ??
        asNonEmptyString(entry.file_path);
      if (!path) continue;
      const text =
        asNonEmptyString(entry.text) ??
        asNonEmptyString(entry.preview) ??
        asNonEmptyString(entry.lineText) ??
        asNonEmptyString(entry.content) ??
        asNonEmptyString(entry.match);
      const lineNumber = asFiniteInt(entry.line ?? entry.lineNumber ?? entry.line_number);
      const column = asFiniteInt(entry.column ?? entry.col);
      if (text !== undefined || lineNumber !== undefined) {
        const bucket = groupsByPath.get(path) ?? [];
        bucket.push({
          ...(lineNumber === undefined ? {} : { lineNumber }),
          ...(column === undefined ? {} : { column }),
          text: text ?? "",
        });
        groupsByPath.set(path, bucket);
      } else {
        paths.push({ path, displayPath: formatDisplayPath(path, options.workspaceRoot) });
      }
    }
    if (groupsByPath.size > 0) {
      const groups: DshSearchFileGroup[] = [];
      for (const [path, matches] of groupsByPath.entries()) {
        groups.push({
          path,
          displayPath: formatDisplayPath(path, options.workspaceRoot),
          matches,
        });
      }
      return finalizeMatchesSearch({ query: options.query, scope: options.scope, groups });
    }
    if (paths.length > 0) {
      return finalizePathsSearch({ query: options.query, scope: options.scope, paths });
    }
    return null;
  }

  if (!isRecord(value)) return null;
  const truncated = value.truncated === true || value.isTruncated === true || value.capped === true;
  const totalMatches = asFiniteInt(value.totalMatches ?? value.total_matches ?? value.total);
  const totalFiles = asFiniteInt(value.totalFiles ?? value.total_files ?? value.fileCount);
  const totalPaths = asFiniteInt(value.totalPaths ?? value.total_paths ?? value.totalFiles ?? value.total);

  // Grouped matches: `{ groups: [{ path, matches: [...] }] }` or `{ files: [{ path, matches: [...] }] }`
  const groupedField = Array.isArray(value.groups)
    ? value.groups
    : Array.isArray(value.files) && value.files.some((f) => isRecord(f) && Array.isArray(f.matches))
      ? value.files
      : null;
  if (groupedField) {
    const groups: DshSearchFileGroup[] = [];
    for (const rawGroup of groupedField) {
      if (!isRecord(rawGroup)) continue;
      const path =
        asNonEmptyString(rawGroup.path) ??
        asNonEmptyString(rawGroup.file) ??
        asNonEmptyString(rawGroup.fileName) ??
        asNonEmptyString(rawGroup.filePath);
      if (!path || !Array.isArray(rawGroup.matches)) continue;
      const matches: DshSearchMatchLine[] = [];
      for (const rawMatch of rawGroup.matches) {
        if (typeof rawMatch === "string") {
          matches.push({ text: rawMatch });
        } else if (isRecord(rawMatch)) {
          const lineNumber = asFiniteInt(rawMatch.lineNumber ?? rawMatch.line ?? rawMatch.line_number);
          const column = asFiniteInt(rawMatch.column ?? rawMatch.col);
          const text =
            typeof rawMatch.text === "string"
              ? rawMatch.text
              : typeof rawMatch.lineText === "string"
                ? rawMatch.lineText
                : typeof rawMatch.content === "string"
                  ? rawMatch.content
                  : typeof rawMatch.preview === "string"
                    ? rawMatch.preview
                    : "";
          matches.push({
            ...(lineNumber === undefined ? {} : { lineNumber }),
            ...(column === undefined ? {} : { column }),
            text,
          });
        }
      }
      if (matches.length > 0) {
        groups.push({
          path,
          displayPath: formatDisplayPath(path, options.workspaceRoot),
          matches,
        });
      }
    }
    if (groups.length > 0) {
      return finalizeMatchesSearch({
        query: options.query,
        scope: options.scope,
        groups,
        totalMatches,
        totalFiles,
        truncated,
      });
    }
  }

  // Flat matches array: `{ matches: [...] }` or `{ results: [...] }`
  for (const listKey of ["matches", "results", "entries"] as const) {
    const list = value[listKey];
    if (Array.isArray(list) && list.length > 0) {
      const parsed = parseStructuredSearchObject(list, options);
      if (parsed) {
        return parsed.kind === "matches"
          ? finalizeMatchesSearch({
              query: parsed.query,
              scope: parsed.scope,
              groups: parsed.groups,
              totalMatches: totalMatches ?? parsed.totalMatches,
              totalFiles: totalFiles ?? parsed.totalFiles,
              truncated: truncated || parsed.truncated,
            })
          : finalizePathsSearch({
              query: parsed.query,
              scope: parsed.scope,
              paths: parsed.paths,
              totalPaths: totalPaths ?? parsed.totalPaths,
              truncated: truncated || parsed.truncated,
            });
      }
    }
  }

  // Flat paths array: `{ paths: [...] }` or `{ files: string[] }` or `{ filenames: string[] }`
  for (const pathKey of ["paths", "files", "filenames", "filePaths"] as const) {
    const list = value[pathKey];
    if (Array.isArray(list) && list.length > 0) {
      const paths = list
        .map((entry) =>
          typeof entry === "string"
            ? entry.trim()
            : isRecord(entry)
              ? (asNonEmptyString(entry.path) ?? asNonEmptyString(entry.fileName) ?? "")
              : "",
        )
        .filter((entry) => entry.length > 0)
        .map((path) => ({ path, displayPath: formatDisplayPath(path, options.workspaceRoot) }));
      if (paths.length > 0) {
        return finalizePathsSearch({
          query: options.query,
          scope: options.scope,
          paths,
          totalPaths,
          truncated,
        });
      }
    }
  }

  if (isRecord(value.structuredContent)) {
    return parseStructuredSearchObject(value.structuredContent, options);
  }
  return null;
}

export function isSearchTurnItem(item: OrchestrationV2TurnItem): boolean {
  if (item.type === "file_search") return true;
  if (item.type === "dynamic_tool") {
    const tool = normalizeToolNameToken(item.toolName ?? item.title);
    return CODE_SEARCH_TOOL_NAMES.has(tool);
  }
  return false;
}

export function isSearchWorkEntry(entry: WorkLogEntry): boolean {
  if (entry.itemType === "file_search") return true;
  if (entry.structuredPayload && isSearchTurnItem(entry.structuredPayload)) return true;
  if (entry.projectedItem?.item && isSearchTurnItem(entry.projectedItem.item)) return true;
  const tool = normalizeToolNameToken(entry.toolTitle ?? entry.label);
  return CODE_SEARCH_TOOL_NAMES.has(tool);
}

export function normalizeSearchTurnItem(
  item: OrchestrationV2TurnItem,
  workspaceRoot?: string,
  resolvedOutputText?: string,
): NormalizedDshSearchData | null {
  if (!isSearchTurnItem(item)) return null;

  if (item.type === "file_search") {
    const query = asNonEmptyString(item.pattern);
    const results = item.results ?? [];

    // ACP often embeds raw multi-line grep/glob stdout inside a single synthetic result `{ fileName: pattern, preview: rawText }`.
    if (
      results.length === 1 &&
      results[0]?.line === undefined &&
      results[0]?.preview &&
      results[0].preview.includes("\n")
    ) {
      const parsedJson = tryParseJson(results[0].preview);
      if (parsedJson !== undefined) {
        const structured = parseStructuredSearchObject(parsedJson, { query, workspaceRoot });
        if (structured) return structured;
      }
      const parsedPlain = parsePlainSearchText(results[0].preview, { workspaceRoot });
      if (parsedPlain) {
        return parsedPlain.kind === "matches"
          ? finalizeMatchesSearch({
              query,
              groups: parsedPlain.groups,
              totalMatches: parsedPlain.totalHint,
              truncated: parsedPlain.truncated,
            })
          : finalizePathsSearch({
              query,
              paths: parsedPlain.paths,
              totalPaths: parsedPlain.totalHint,
              truncated: parsedPlain.truncated,
            });
      }
    }

    const groupsByPath = new Map<string, DshSearchMatchLine[]>();
    const paths: Array<{ readonly path: string; readonly displayPath: string }> = [];
    for (const result of results) {
      const fileName = result.fileName.trim();
      if (!fileName) continue;
      if (result.line !== undefined || result.preview?.trim()) {
        const bucket = groupsByPath.get(fileName) ?? [];
        bucket.push({
          ...(result.line === undefined ? {} : { lineNumber: result.line }),
          ...(result.column === undefined ? {} : { column: result.column }),
          text: result.preview ?? "",
        });
        groupsByPath.set(fileName, bucket);
      } else {
        paths.push({
          path: fileName,
          displayPath: formatDisplayPath(fileName, workspaceRoot),
        });
      }
    }
    if (groupsByPath.size > 0) {
      const groups: DshSearchFileGroup[] = [];
      for (const [path, matches] of groupsByPath.entries()) {
        groups.push({
          path,
          displayPath: formatDisplayPath(path, workspaceRoot),
          matches,
        });
      }
      return finalizeMatchesSearch({ query, groups });
    }
    if (paths.length > 0) {
      return finalizePathsSearch({ query, paths });
    }
    if (resolvedOutputText) {
      const parsedPlain = parsePlainSearchText(resolvedOutputText, { workspaceRoot });
      if (parsedPlain) {
        return parsedPlain.kind === "matches"
          ? finalizeMatchesSearch({
              query,
              groups: parsedPlain.groups,
              totalMatches: parsedPlain.totalHint,
              truncated: parsedPlain.truncated,
            })
          : finalizePathsSearch({
              query,
              paths: parsedPlain.paths,
              totalPaths: parsedPlain.totalHint,
              truncated: parsedPlain.truncated,
            });
      }
    }
    return finalizePathsSearch({ query, paths: [] });
  }

  if (item.type === "dynamic_tool") {
    const tool = normalizeToolNameToken(item.toolName ?? item.title);
    const preferPaths = PATH_ONLY_SEARCH_TOOL_NAMES.has(tool);
    const inputRec = isRecord(item.input) ? item.input : undefined;
    const query =
      asNonEmptyString(inputRec?.pattern) ??
      asNonEmptyString(inputRec?.query) ??
      asNonEmptyString(inputRec?.Pattern) ??
      asNonEmptyString(inputRec?.Query) ??
      asNonEmptyString(inputRec?.glob) ??
      asNonEmptyString(inputRec?.regex);
    const rawScope =
      asNonEmptyString(inputRec?.path) ??
      asNonEmptyString(inputRec?.SearchPath) ??
      asNonEmptyString(inputRec?.SearchDirectory) ??
      asNonEmptyString(inputRec?.directory) ??
      asNonEmptyString(inputRec?.cwd);
    const scope = rawScope ? formatDisplayPath(rawScope, workspaceRoot) : undefined;

    const structuredDirect = parseStructuredSearchObject(item.output, {
      query,
      scope,
      workspaceRoot,
      preferPaths,
    });
    if (structuredDirect) return structuredDirect;

    const outputText = resolvedOutputText ?? extractOutputText(item.output);
    const parsedJson = tryParseJson(outputText);
    if (parsedJson !== undefined) {
      const structuredFromText = parseStructuredSearchObject(parsedJson, {
        query,
        scope,
        workspaceRoot,
        preferPaths,
      });
      if (structuredFromText) return structuredFromText;
    }

    if (outputText) {
      const parsedPlain = parsePlainSearchText(outputText, { workspaceRoot, preferPaths });
      if (parsedPlain) {
        return parsedPlain.kind === "matches"
          ? finalizeMatchesSearch({
              query,
              scope,
              groups: parsedPlain.groups,
              totalMatches: parsedPlain.totalHint,
              truncated: parsedPlain.truncated,
            })
          : finalizePathsSearch({
              query,
              scope,
              paths: parsedPlain.paths,
              totalPaths: parsedPlain.totalHint,
              truncated: parsedPlain.truncated,
            });
      }
    }

    return preferPaths
      ? finalizePathsSearch({ query, scope, paths: [] })
      : finalizeMatchesSearch({ query, scope, groups: [] });
  }

  return null;
}

export function normalizeSearchWorkEntry(
  entry: WorkLogEntry,
  workspaceRoot?: string,
  resolvedOutputText?: string,
): NormalizedDshSearchData | null {
  if (entry.structuredPayload) {
    const normalized = normalizeSearchTurnItem(
      entry.structuredPayload,
      workspaceRoot,
      resolvedOutputText,
    );
    if (normalized) return normalized;
  }
  if (entry.projectedItem?.item) {
    const normalized = normalizeSearchTurnItem(
      entry.projectedItem.item,
      workspaceRoot,
      resolvedOutputText,
    );
    if (normalized) return normalized;
  }
  if (!isSearchWorkEntry(entry)) return null;
  const tool = normalizeToolNameToken(entry.toolTitle ?? entry.label);
  const preferPaths = PATH_ONLY_SEARCH_TOOL_NAMES.has(tool);
  const dataRec = isRecord(entry.toolData) ? entry.toolData : undefined;
  const inputRec = isRecord(dataRec?.input) ? dataRec.input : undefined;
  const query =
    asNonEmptyString(entry.detail) ??
    asNonEmptyString(inputRec?.pattern) ??
    asNonEmptyString(inputRec?.query);
  const output = dataRec?.output ?? entry.toolData;
  const structured = parseStructuredSearchObject(output, {
    query,
    workspaceRoot,
    preferPaths,
  });
  if (structured) return structured;
  const outputText = resolvedOutputText ?? extractOutputText(output);
  if (outputText) {
    const parsed = parsePlainSearchText(outputText, { workspaceRoot, preferPaths });
    if (parsed) {
      return parsed.kind === "matches"
        ? finalizeMatchesSearch({
            query,
            groups: parsed.groups,
            totalMatches: parsed.totalHint,
            truncated: parsed.truncated,
          })
        : finalizePathsSearch({
            query,
            paths: parsed.paths,
            totalPaths: parsed.totalHint,
            truncated: parsed.truncated,
          });
    }
  }
  return preferPaths
    ? finalizePathsSearch({ query, paths: [] })
    : finalizeMatchesSearch({ query, groups: [] });
}

function makeWebSource(raw: {
  readonly url: string;
  readonly title?: string | undefined;
  readonly snippet?: string | undefined;
  readonly publishedDate?: string | undefined;
}): DshWebSource | null {
  const url = raw.url.trim();
  if (!url) return null;
  const { safeHref, hostname } = sanitizeExternalHttpUrl(url);
  const title = raw.title?.trim() || hostname || url;
  return {
    url,
    safeHref,
    title,
    hostname,
    ...(raw.snippet?.trim() ? { snippet: raw.snippet.trim() } : {}),
    ...(raw.publishedDate?.trim() ? { publishedDate: raw.publishedDate.trim() } : {}),
  };
}

function extractSourcesFromUnknown(value: unknown): {
  readonly sources: DshWebSource[];
  readonly answerMarkdown?: string | undefined;
  readonly truncated: boolean;
} {
  const sources: DshWebSource[] = [];
  const seen = new Set<string>();
  let answerMarkdown: string | undefined;
  let truncated = false;

  const pushSource = (raw: {
    readonly url: string;
    readonly title?: string | undefined;
    readonly snippet?: string | undefined;
    readonly publishedDate?: string | undefined;
  }) => {
    const built = makeWebSource(raw);
    if (!built || seen.has(built.url)) return;
    seen.add(built.url);
    sources.push(built);
  };

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        pushSource({ url: entry });
      } else if (isRecord(entry)) {
        const url =
          asNonEmptyString(entry.url) ??
          asNonEmptyString(entry.link) ??
          asNonEmptyString(entry.href) ??
          asNonEmptyString(entry.uri);
        if (!url) continue;
        pushSource({
          url,
          title: asNonEmptyString(entry.title) ?? asNonEmptyString(entry.name),
          snippet:
            asNonEmptyString(entry.snippet) ??
            asNonEmptyString(entry.excerpt) ??
            asNonEmptyString(entry.description) ??
            asNonEmptyString(entry.summary) ??
            asNonEmptyString(entry.content),
          publishedDate:
            asNonEmptyString(entry.publishedDate) ??
            asNonEmptyString(entry.published_date) ??
            asNonEmptyString(entry.publishedAt) ??
            asNonEmptyString(entry.published_at) ??
            asNonEmptyString(entry.date),
        });
      }
    }
    return { sources, answerMarkdown, truncated };
  }

  if (isRecord(value)) {
    truncated = value.truncated === true || value.isTruncated === true || value.capped === true;
    answerMarkdown =
      asNonEmptyString(value.answer) ??
      asNonEmptyString(value.answerMarkdown) ??
      asNonEmptyString(value.summary) ??
      asNonEmptyString(value.response);
    for (const key of ["sources", "results", "citations", "links", "items"] as const) {
      const list = value[key];
      if (Array.isArray(list)) {
        const nested = extractSourcesFromUnknown(list);
        for (const source of nested.sources) pushSource(source);
        if (nested.truncated) truncated = true;
      }
    }
    if (isRecord(value.structuredContent)) {
      const nested = extractSourcesFromUnknown(value.structuredContent);
      for (const source of nested.sources) pushSource(source);
      answerMarkdown ??= nested.answerMarkdown;
      if (nested.truncated) truncated = true;
    }
    return { sources, answerMarkdown, truncated };
  }

  if (typeof value === "string") {
    const parsedJson = tryParseJson(value);
    if (parsedJson !== undefined) {
      return extractSourcesFromUnknown(parsedJson);
    }
    if (TRUNCATION_FOOTER_RE.test(value)) {
      truncated = true;
    }
    // Extract markdown links `[Title](url)` first
    const mdLinkRe = /\[([^\]\r\n]{1,200})\]\(([^)\s]+)\)/gu;
    let mdMatch: RegExpExecArray | null;
    while ((mdMatch = mdLinkRe.exec(value)) !== null) {
      pushSource({ title: mdMatch[1], url: mdMatch[2]! });
    }
    // Then bare http(s) URLs not already captured
    const urlRe = /https?:\/\/[^\s<>")\]]+/gu;
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = urlRe.exec(value)) !== null) {
      const cleaned = urlMatch[0].replace(/[.,;:]+$/u, "");
      pushSource({ url: cleaned });
    }
    if (value.trim().length > 0 && sources.length === 0) {
      answerMarkdown = value.trim();
    } else if (value.trim().length > 0 && value.includes("\n")) {
      // Preserve prose answer if the output isn't purely bare URLs
      const nonUrlLines = value
        .split(/\r?\n/u)
        .filter((line) => {
          const t = line.trim();
          return t.length > 0 && !/^https?:\/\/\S+$/u.test(t);
        });
      if (nonUrlLines.length > 0 && nonUrlLines.join("\n").length > 24) {
        answerMarkdown = value.trim();
      }
    }
  }

  return { sources, answerMarkdown, truncated };
}

function classifyWebItemKind(
  item: OrchestrationV2TurnItem,
  entryLabel?: string,
): "search" | "fetch" | null {
  if (item.type === "web_search") {
    const titleLower = (item.title ?? entryLabel ?? "").trim().toLowerCase();
    if (titleLower.startsWith("fetch ") || titleLower === "web fetch" || titleLower === "fetch") {
      return "fetch";
    }
    const singlePattern = item.patterns?.length === 1 ? item.patterns[0] : undefined;
    if (
      singlePattern &&
      /^https?:\/\//iu.test(singlePattern.trim()) &&
      (item.results?.length ?? 0) <= 1
    ) {
      return "fetch";
    }
    return "search";
  }
  if (item.type === "dynamic_tool") {
    const token = normalizeToolNameToken(item.toolName ?? item.title);
    if (WEB_FETCH_TOOL_NAMES.has(token)) return "fetch";
    if (WEB_SEARCH_TOOL_NAMES.has(token)) return "search";
  }
  return null;
}

export function isWebTurnItem(item: OrchestrationV2TurnItem): boolean {
  return classifyWebItemKind(item) !== null;
}

export function isWebWorkEntry(entry: WorkLogEntry): boolean {
  if (entry.itemType === "web_search") return true;
  if (entry.structuredPayload && isWebTurnItem(entry.structuredPayload)) return true;
  if (entry.projectedItem?.item && isWebTurnItem(entry.projectedItem.item)) return true;
  const token = normalizeToolNameToken(entry.toolTitle ?? entry.label);
  return WEB_SEARCH_TOOL_NAMES.has(token) || WEB_FETCH_TOOL_NAMES.has(token);
}

function finalizeWebSearch(input: {
  readonly queries: ReadonlyArray<string>;
  readonly answerMarkdown?: string | undefined;
  readonly sources: ReadonlyArray<DshWebSource>;
  readonly truncated: boolean;
}): NormalizedDshWebData {
  const copyParts: string[] = [];
  if (input.answerMarkdown) copyParts.push(input.answerMarkdown);
  for (const source of input.sources) {
    copyParts.push(`${source.title} - ${source.url}`);
  }
  const count = input.sources.length;
  const summaryZh = input.truncated
    ? `共 ${count} 个来源（部分来源已截断）`
    : count > 0
      ? `共 ${count} 个来源`
      : "网页搜索";
  return {
    kind: "search",
    queries: input.queries,
    ...(input.answerMarkdown ? { answerMarkdown: input.answerMarkdown } : {}),
    sources: input.sources,
    truncated: input.truncated,
    copyText: copyParts.join("\n"),
    summaryZh,
  };
}

function finalizeWebFetch(input: {
  readonly url: string;
  readonly title?: string | undefined;
  readonly httpStatus?: number | undefined;
  readonly contentType?: string | undefined;
  readonly excerpt?: string | undefined;
  readonly truncated: boolean;
}): NormalizedDshWebData {
  const { safeHref, hostname } = sanitizeExternalHttpUrl(input.url);
  const statusPart = input.httpStatus !== undefined ? `HTTP ${input.httpStatus}` : "网页抓取";
  const summaryZh = input.truncated ? `${statusPart} · 内容已截断` : statusPart;
  return {
    kind: "fetch",
    url: input.url,
    safeHref,
    hostname,
    ...(input.title ? { title: input.title } : {}),
    ...(input.httpStatus !== undefined ? { httpStatus: input.httpStatus } : {}),
    ...(input.contentType ? { contentType: input.contentType } : {}),
    ...(input.excerpt ? { excerpt: input.excerpt } : {}),
    truncated: input.truncated,
    copyText: input.excerpt ? `${input.url}\n\n${input.excerpt}` : input.url,
    summaryZh,
  };
}

function extractHttpStatusFromText(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const match = /\bHTTP(?:\/\d(?:\.\d)?)?\s+([1-5]\d{2})\b|\bstatus(?:\s*code)?\s*[:=]\s*([1-5]\d{2})\b/iu.exec(
    text,
  );
  const raw = match?.[1] ?? match?.[2];
  return raw ? Number.parseInt(raw, 10) : undefined;
}

export function normalizeWebTurnItem(
  item: OrchestrationV2TurnItem,
  resolvedOutputText?: string,
  entryLabel?: string,
): NormalizedDshWebData | null {
  const kind = classifyWebItemKind(item, entryLabel);
  if (!kind) return null;

  if (item.type === "web_search") {
    const queries = (item.patterns ?? []).map((q) => q.trim()).filter(Boolean);
    const results = item.results ?? [];
    if (kind === "fetch") {
      const url = results[0]?.url?.trim() || queries[0] || "";
      const snippet = resolvedOutputText ?? results[0]?.snippet;
      const parsedJson = tryParseJson(snippet);
      const rec = isRecord(parsedJson) ? parsedJson : undefined;
      const httpStatus =
        asFiniteInt(rec?.httpStatus ?? rec?.statusCode ?? rec?.status_code ?? rec?.status) ??
        extractHttpStatusFromText(snippet);
      const truncated = rec?.truncated === true || (snippet ? TRUNCATION_FOOTER_RE.test(snippet) : false);
      const excerpt =
        asNonEmptyString(rec?.excerpt) ??
        asNonEmptyString(rec?.content) ??
        asNonEmptyString(rec?.markdown) ??
        asNonEmptyString(rec?.text) ??
        snippet;
      return finalizeWebFetch({
        url,
        title: results[0]?.title ?? asNonEmptyString(rec?.title),
        httpStatus,
        contentType: asNonEmptyString(rec?.contentType ?? rec?.content_type),
        excerpt,
        truncated,
      });
    }

    const sources: DshWebSource[] = [];
    const seen = new Set<string>();
    let answerMarkdown: string | undefined;
    let truncated = false;
    for (const result of results) {
      if (result.url) {
        const built = makeWebSource({
          url: result.url,
          title: result.title,
          snippet: result.snippet,
        });
        if (built && !seen.has(built.url)) {
          seen.add(built.url);
          sources.push(built);
        }
      } else if (result.snippet && !answerMarkdown) {
        answerMarkdown = result.snippet;
      }
    }
    if (resolvedOutputText) {
      const extra = extractSourcesFromUnknown(resolvedOutputText);
      for (const source of extra.sources) {
        if (!seen.has(source.url)) {
          seen.add(source.url);
          sources.push(source);
        }
      }
      answerMarkdown ??= extra.answerMarkdown;
      truncated = truncated || extra.truncated;
    }
    return finalizeWebSearch({ queries, answerMarkdown, sources, truncated });
  }

  if (item.type === "dynamic_tool") {
    const inputRec = isRecord(item.input) ? item.input : undefined;
    const outputRec = isRecord(item.output) ? item.output : undefined;
    const outputText = resolvedOutputText ?? extractOutputText(item.output);
    const parsedJson = tryParseJson(outputText);
    const parsedRec = isRecord(parsedJson) ? parsedJson : outputRec;

    if (kind === "fetch") {
      const url =
        asNonEmptyString(parsedRec?.url) ??
        asNonEmptyString(parsedRec?.finalUrl) ??
        asNonEmptyString(inputRec?.url) ??
        asNonEmptyString(inputRec?.Url) ??
        asNonEmptyString(inputRec?.uri) ??
        "";
      const httpStatus =
        asFiniteInt(
          parsedRec?.httpStatus ??
            parsedRec?.statusCode ??
            parsedRec?.status_code ??
            parsedRec?.status,
        ) ?? extractHttpStatusFromText(outputText);
      const truncated =
        parsedRec?.truncated === true ||
        parsedRec?.isTruncated === true ||
        (outputText ? TRUNCATION_FOOTER_RE.test(outputText) : false);
      const excerpt =
        asNonEmptyString(parsedRec?.excerpt) ??
        asNonEmptyString(parsedRec?.markdown) ??
        asNonEmptyString(parsedRec?.content) ??
        asNonEmptyString(parsedRec?.body) ??
        asNonEmptyString(parsedRec?.text) ??
        (parsedJson === undefined ? outputText : undefined);
      return finalizeWebFetch({
        url,
        title: asNonEmptyString(parsedRec?.title),
        httpStatus,
        contentType: asNonEmptyString(parsedRec?.contentType ?? parsedRec?.content_type),
        excerpt,
        truncated,
      });
    }

    const queries: string[] = [];
    const singleQuery =
      asNonEmptyString(inputRec?.query) ??
      asNonEmptyString(inputRec?.q) ??
      asNonEmptyString(inputRec?.search_query);
    if (singleQuery) queries.push(singleQuery);
    if (Array.isArray(inputRec?.queries)) {
      for (const q of inputRec.queries) {
        const s = asNonEmptyString(q);
        if (s && !queries.includes(s)) queries.push(s);
      }
    }
    const extracted =
      parsedRec !== undefined
        ? extractSourcesFromUnknown(parsedRec)
        : extractSourcesFromUnknown(outputText ?? item.output);
    return finalizeWebSearch({
      queries,
      answerMarkdown: extracted.answerMarkdown,
      sources: extracted.sources,
      truncated: extracted.truncated,
    });
  }

  return null;
}

export function normalizeWebWorkEntry(
  entry: WorkLogEntry,
  resolvedOutputText?: string,
): NormalizedDshWebData | null {
  if (entry.structuredPayload) {
    const normalized = normalizeWebTurnItem(
      entry.structuredPayload,
      resolvedOutputText,
      entry.label,
    );
    if (normalized) return normalized;
  }
  if (entry.projectedItem?.item) {
    const normalized = normalizeWebTurnItem(
      entry.projectedItem.item,
      resolvedOutputText,
      entry.label,
    );
    if (normalized) return normalized;
  }
  if (!isWebWorkEntry(entry)) return null;
  const token = normalizeToolNameToken(entry.toolTitle ?? entry.label);
  const dataRec = isRecord(entry.toolData) ? entry.toolData : undefined;
  const inputRec = isRecord(dataRec?.input) ? dataRec.input : undefined;
  const output = dataRec?.output ?? entry.toolData;
  const outputText = resolvedOutputText ?? extractOutputText(output);

  if (WEB_FETCH_TOOL_NAMES.has(token)) {
    const parsedJson = tryParseJson(outputText);
    const rec = isRecord(parsedJson) ? parsedJson : isRecord(output) ? output : undefined;
    const url =
      asNonEmptyString(rec?.url) ??
      asNonEmptyString(inputRec?.url) ??
      asNonEmptyString(entry.detail) ??
      "";
    const httpStatus =
      asFiniteInt(rec?.httpStatus ?? rec?.statusCode ?? rec?.status_code ?? rec?.status) ??
      extractHttpStatusFromText(outputText);
    const truncated =
      rec?.truncated === true || (outputText ? TRUNCATION_FOOTER_RE.test(outputText) : false);
    const excerpt =
      asNonEmptyString(rec?.excerpt) ??
      asNonEmptyString(rec?.content) ??
      asNonEmptyString(rec?.text) ??
      (parsedJson === undefined ? outputText : undefined);
    return finalizeWebFetch({
      url,
      title: asNonEmptyString(rec?.title),
      httpStatus,
      contentType: asNonEmptyString(rec?.contentType ?? rec?.content_type),
      excerpt,
      truncated,
    });
  }

  const queries = [asNonEmptyString(inputRec?.query) ?? asNonEmptyString(entry.detail)].filter(
    (q): q is string => Boolean(q),
  );
  const extracted = extractSourcesFromUnknown(outputText ?? output);
  return finalizeWebSearch({
    queries,
    answerMarkdown: extracted.answerMarkdown,
    sources: extracted.sources,
    truncated: extracted.truncated,
  });
}
