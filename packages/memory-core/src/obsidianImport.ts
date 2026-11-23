import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, posix } from "node:path";
import {
  OBSIDIAN_CURATED_KINDS,
  isValidMemoryNamespace,
  type MemoryKind,
  type MemoryNamespace,
  type ObsidianCuratedItem,
  type ObsidianCuratedKind,
  type ObsidianCurationSource,
  type ObsidianImportCommitRequest,
  type ObsidianImportCommitResponse,
  type ObsidianImportPlanRequest,
  type ObsidianImportPlanResponse,
  type ObsidianImportPlanStats
} from "@prismux/protocol";
import { parseObsidianMarkdown, type ParsedObsidianNote } from "./ObsidianImporter.js";
import type { MemoryStore } from "./types.js";

const IGNORED_DIRECTORY_NAMES = new Set([
  ".obsidian",
  ".trash",
  ".git",
  "node_modules",
  ".smart-env",
  ".stversions"
]);

const PRIVATE_TOP_DIRECTORIES = new Set([
  "daily",
  "journal",
  "inbox",
  "private"
]);

const MAX_PLAN_NOTES_FOR_AGENT = 48;
const MAX_NOTE_DIGEST_CHARS = 1800;
const MAX_SUMMARY_CHARS = 420;
const MAX_TITLE_CHARS = 88;
const DEFAULT_AGENT_CURATION_TIMEOUT_MS = 25_000;

export interface ScannedObsidianNoteDigest {
  readonly sourceFile: string;
  readonly title: string;
  readonly namespace: MemoryNamespace;
  readonly body: string;
  readonly tags: readonly string[];
  readonly frontmatterKind?: string;
  readonly importance?: number;
  readonly redactedSecretCount: number;
}

export interface ObsidianAgentCurationProposal {
  readonly title: string;
  readonly summary: string;
  readonly kind?: string;
  readonly namespace?: string;
  readonly tags?: readonly string[];
  readonly sourceFile?: string;
  readonly importance?: number;
}

export interface ObsidianAgentCurationResult {
  readonly items: readonly ObsidianAgentCurationProposal[];
  readonly curatorLabel?: string;
  readonly warnings?: readonly string[];
}

export type ObsidianAgentCurator = (input: {
  readonly vaultPath: string;
  readonly defaultNamespace: MemoryNamespace;
  readonly notes: readonly ScannedObsidianNoteDigest[];
  readonly provider?: string;
  readonly model?: string;
  readonly signal: AbortSignal;
}) => Promise<ObsidianAgentCurationResult | null>;

export interface ObsidianPlanOptions {
  readonly agentCurator?: ObsidianAgentCurator;
  readonly agentTimeoutMs?: number;
  readonly curatorLabel?: string;
}

interface SecretRedactionResult {
  readonly text: string;
  readonly count: number;
}

const SECRET_PATTERNS: ReadonlyArray<{
  readonly regex: RegExp;
  readonly replace: string | ((match: string, ...args: string[]) => string);
}> = [
  {
    regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replace: "[REDACTED_PRIVATE_KEY]"
  },
  {
    regex: /\b(?:sk-ant-[A-Za-z0-9_-]{16,}|sk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,})\b/g,
    replace: "[REDACTED_SECRET]"
  },
  {
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
    replace: "[REDACTED_SECRET]"
  },
  {
    regex: /\bgithub_pat_[A-Za-z0-9_]{24,}\b/g,
    replace: "[REDACTED_SECRET]"
  },
  {
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    replace: "[REDACTED_SECRET]"
  },
  {
    regex: /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g,
    replace: "[REDACTED_SECRET]"
  },
  {
    regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g,
    replace: "[REDACTED_SECRET]"
  },
  {
    regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi,
    replace: "Bearer [REDACTED_SECRET]"
  },
  {
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replace: "[REDACTED_JWT]"
  },
  {
    regex:
      /((?:api[_-]?key|access[_-]?token|secret[_-]?key|client[_-]?secret|auth[_-]?token|password|passwd|passphrase)\s*[:=]\s*["']?)([^\s"'`,;]{8,})(["']?)/gi,
    replace: (_match: string, prefix: string, value: string, suffix: string) => {
      if (/^\[REDACTED/i.test(value) || /^(?:your[_-]|example|placeholder|xxx|\*+|<.+>)/i.test(value)) {
        return `${prefix}${value}${suffix}`;
      }
      return `${prefix}[REDACTED_SECRET]${suffix}`;
    }
  }
];

/**
 * Redacts raw API keys, tokens, private keys, JWTs, and inline secret assignments
 * before notes reach an Agent prompt or SQLite memory storage.
 */
export function redactSensitiveCredentials(rawText: string): SecretRedactionResult {
  let text = rawText;
  let count = 0;

  for (const rule of SECRET_PATTERNS) {
    rule.regex.lastIndex = 0;
    if (typeof rule.replace === "string") {
      text = text.replace(rule.regex, () => {
        count += 1;
        return rule.replace as string;
      });
    } else {
      const replacer = rule.replace;
      text = text.replace(rule.regex, (match, ...args) => {
        const replaced = replacer(match, ...(args as string[]));
        if (replaced !== match) {
          count += 1;
        }
        return replaced;
      });
    }
  }

  return { text, count };
}

function normalizeWorkspaceFolder(folderName: string): string {
  const slug = folderName
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "default";
}

function resolveNamespaceForNote(
  posixRelPath: string,
  explicitNamespace: MemoryNamespace | undefined,
  frontmatterNamespace: string | undefined,
  warnings: string[]
): MemoryNamespace {
  if (explicitNamespace !== undefined) {
    return explicitNamespace;
  }
  if (frontmatterNamespace !== undefined) {
    if (isValidMemoryNamespace(frontmatterNamespace)) {
      return frontmatterNamespace;
    }
    warnings.push(
      `Ignored invalid frontmatter namespace "${frontmatterNamespace}" in ${posixRelPath}.`
    );
  }
  const segments = posixRelPath.split("/").filter((s) => s.length > 0);
  if (segments.length <= 1) {
    return "private/chief";
  }
  const topDir = segments[0]!;
  if (PRIVATE_TOP_DIRECTORIES.has(topDir.toLowerCase())) {
    return "private/chief";
  }
  return `workspace/${normalizeWorkspaceFolder(topDir)}`;
}

async function collectMarkdownFiles(
  rootDir: string,
  relDir: string,
  results: Array<{ absPath: string; posixRelPath: string }>
): Promise<void> {
  const currentDir = relDir.length > 0 ? join(rootDir, ...relDir.split("/")) : rootDir;
  const dirEntries = await readdir(currentDir, { withFileTypes: true });
  dirEntries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of dirEntries) {
    const childRel = relDir.length > 0 ? posix.join(relDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) {
        continue;
      }
      await collectMarkdownFiles(rootDir, childRel, results);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      results.push({
        absPath: join(currentDir, entry.name),
        posixRelPath: childRel
      });
    }
  }
}

function cleanMarkdownFormatting(raw: string): string {
  return raw
    .replace(/!\[\[([^\]]+)\]\]/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`{3}[\s\S]*?`{3}/g, (block) =>
      block.length > 260 ? `${block.slice(0, 220).trim()}...` : block
    )
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const TEMPLATE_TOKEN_PATTERN = /\{\{[^}]+\}\}|<%[\s\S]*?%>/g;
const PURE_BOILERPLATE_LINE_PATTERN =
  /^(?:todo|tbd|待办|待补充|暂无|无|notes?|summary|tags?|date|created|updated|daily note|日记|会议纪要)\s*[:：\-—]*$/i;

/**
 * Detects empty templates, blank daily-note skeletons, and non-informative noise stubs.
 */
export function isNoiseOrEmptyTemplateNote(body: string, title: string): boolean {
  const withoutTemplates = body.replace(TEMPLATE_TOKEN_PATTERN, " ");
  const cleanedLines = withoutTemplates
    .split("\n")
    .map((line) => cleanMarkdownFormatting(line).trim())
    .filter((line) => line.length > 0 && !PURE_BOILERPLATE_LINE_PATTERN.test(line));

  if (cleanedLines.length === 0) {
    return true;
  }

  const joined = cleanedLines.join(" ").trim();
  const meaningfulChars = joined.replace(/[\s\p{P}\p{S}]+/gu, "");
  if (meaningfulChars.length < 10) {
    return true;
  }

  const normalizedTitle = title.trim().toLowerCase().replace(/[\s\p{P}]+/gu, "");
  const normalizedJoined = meaningfulChars.toLowerCase();
  if (normalizedJoined === normalizedTitle && meaningfulChars.length < 18) {
    return true;
  }

  return false;
}

function extractInlineTags(rawBody: string): string[] {
  const tags: string[] = [];
  const regex = /(?:^|[\s(（【])#([\p{L}\p{N}_/-]{2,32})/gu;
  for (const match of rawBody.matchAll(regex)) {
    const tag = match[1]?.trim();
    if (tag && !/^\d+$/.test(tag)) {
      tags.push(tag.toLowerCase());
    }
  }
  return tags;
}

export function normalizeObsidianCuratedKind(
  rawKind: string | undefined,
  textHint?: string
): ObsidianCuratedKind {
  const key = rawKind?.trim().toLowerCase() ?? "";
  if ((OBSIDIAN_CURATED_KINDS as readonly string[]).includes(key)) {
    return key as ObsidianCuratedKind;
  }
  if (key === "pref" || key === "style" || key === "habit" || key === "rule") {
    return "preference";
  }
  if (key === "adr" || key === "architecture" || key === "choice") {
    return "decision";
  }
  if (key === "episodic" || key === "lesson" || key === "postmortem" || key === "troubleshooting") {
    return "experience";
  }
  if (key === "workspace" || key === "repo" || key === "roadmap") {
    return "project";
  }
  if (key === "fact" || key === "note" || key === "reference") {
    return "knowledge";
  }

  const sample = (textHint ?? "").toLowerCase();
  if (
    /(?:偏好|习惯|喜欢|风格|回复风格|不要|禁止|务必|优先使用|称呼|prefer(?:s|red)?|convention|coding\s+style|always\s+use|never\s+use)/i.test(
      sample
    )
  ) {
    return "preference";
  }
  if (
    /(?:决定|决策|最终采用|选型|架构|方案确定|权衡|adr\b|decided\s+to|architecture\s+decision|trade-?off|chosen\s+to)/i.test(
      sample
    )
  ) {
    return "decision";
  }
  if (
    /(?:踩坑|教训|复盘|排查|根因|故障|解决步骤|坑点|workaround|postmortem|root\s+cause|bug\s*fix|troubleshoot|lesson\s+learned)/i.test(
      sample
    )
  ) {
    return "experience";
  }
  if (
    /(?:项目|仓库|里程碑|路线图|模块|部署|架构图|接口文档|project|repository|milestone|roadmap|monorepo|deployment)/i.test(
      sample
    )
  ) {
    return "project";
  }
  return "knowledge";
}

export function mapCuratedKindToMemoryKind(kind: ObsidianCuratedKind): MemoryKind {
  switch (kind) {
    case "preference":
      return "preference";
    case "experience":
      return "episodic";
    case "decision":
    case "project":
    case "knowledge":
      return "fact";
  }
}

function clampText(text: string, maxLen: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

function buildStableCandidateId(sourceFile: string, title: string, summary: string): string {
  const hash = createHash("sha256")
    .update(`${sourceFile}\n${title.toLowerCase()}\n${summary.toLowerCase()}`)
    .digest("hex")
    .slice(0, 12);
  return `obs-${hash}`;
}

function normalizeFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .trim();
}

function tokenizeForSimilarity(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();
  for (const word of lower.match(/[a-z0-9_]{2,}/g) ?? []) {
    tokens.add(word);
  }
  const cjk = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const seg of cjk) {
    if (seg.length <= 2) {
      tokens.add(seg);
    } else {
      for (let i = 0; i < seg.length - 1; i += 1) {
        tokens.add(seg.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function deduplicateCuratedItems(items: ObsidianCuratedItem[]): {
  readonly items: ObsidianCuratedItem[];
  readonly deduplicatedCount: number;
} {
  const kept: ObsidianCuratedItem[] = [];
  const fingerprints: string[] = [];
  const tokenSets: Set<string>[] = [];
  let deduplicatedCount = 0;

  for (const item of items) {
    const fp = normalizeFingerprint(`${item.title} ${item.summary}`);
    const summaryFp = normalizeFingerprint(item.summary);
    const tokens = tokenizeForSimilarity(`${item.title} ${item.summary}`);

    let duplicateIndex = -1;
    for (let i = 0; i < kept.length; i += 1) {
      const existing = kept[i]!;
      const existingSummaryFp = normalizeFingerprint(existing.summary);
      if (
        fp === fingerprints[i] ||
        (summaryFp.length >= 16 && summaryFp === existingSummaryFp) ||
        jaccardSimilarity(tokens, tokenSets[i]!) >= 0.78
      ) {
        duplicateIndex = i;
        break;
      }
    }

    if (duplicateIndex >= 0) {
      deduplicatedCount += 1;
      const existing = kept[duplicateIndex]!;
      const mergedTags = [...new Set([...existing.tags, ...item.tags])].slice(0, 8);
      // Prefer the richer summary when merging two near-duplicate memories.
      const keepNewSummary = item.summary.length > existing.summary.length;
      kept[duplicateIndex] = {
        ...existing,
        summary: keepNewSummary ? item.summary : existing.summary,
        tags: mergedTags,
        redactedSecretCount:
          (existing.redactedSecretCount ?? 0) + (item.redactedSecretCount ?? 0)
      };
      continue;
    }

    kept.push(item);
    fingerprints.push(fp);
    tokenSets.push(tokens);
  }

  return { items: kept, deduplicatedCount };
}

interface AtomicSectionSlice {
  readonly heading: string | null;
  readonly body: string;
}

function splitNoteIntoAtomicSections(rawBody: string): AtomicSectionSlice[] {
  const lines = rawBody.split("\n");
  const slices: AtomicSectionSlice[] = [];
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  let inFence = false;

  const flush = (): void => {
    const joined = buffer.join("\n").trim();
    if (joined.length > 0) {
      slices.push({ heading: currentHeading, body: joined });
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(`{3,}|~{3,})/.test(trimmed)) {
      inFence = !inFence;
      buffer.push(line);
      continue;
    }
    if (!inFence) {
      const headingMatch = /^#{1,4}\s+(.+?)\s*#*$/.exec(line);
      if (headingMatch) {
        flush();
        currentHeading = headingMatch[1]!.trim();
        continue;
      }
    }
    buffer.push(line);
  }
  flush();

  if (slices.length <= 1) {
    // If single section has distinct informative bullet facts, split each bullet into one-fact-per-item.
    const single = slices[0];
    if (single) {
      const bulletFacts = single.body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[-*+]\s+/.test(line) && !/^[-*+]\s+\[\s\]\s*$/.test(line))
        .map((line) => cleanMarkdownFormatting(line))
        .filter((line) => line.replace(/[\s\p{P}\p{S}]+/gu, "").length >= 14);
      const nonEmptyLines = single.body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (bulletFacts.length >= 2 && bulletFacts.length <= 8 && bulletFacts.length >= nonEmptyLines.length * 0.6) {
        return bulletFacts.map((fact) => ({
          heading: single.heading,
          body: fact
        }));
      }
    }
  }

  return slices;
}

function deriveAtomicTitle(
  noteTitle: string,
  sectionHeading: string | null,
  summary: string
): string {
  if (
    sectionHeading &&
    sectionHeading.trim().length > 0 &&
    sectionHeading.trim().toLowerCase() !== noteTitle.trim().toLowerCase()
  ) {
    return clampText(`${noteTitle} · ${sectionHeading.trim()}`, MAX_TITLE_CHARS);
  }
  const colonSplit = /^([^：:。\n]{4,36})[：:]\s+/.exec(summary);
  if (colonSplit?.[1]) {
    const lead = colonSplit[1].trim();
    if (lead.toLowerCase() !== noteTitle.trim().toLowerCase()) {
      return clampText(`${noteTitle} · ${lead}`, MAX_TITLE_CHARS);
    }
  }
  return clampText(noteTitle, MAX_TITLE_CHARS);
}

/**
 * Deterministic high-signal local semantic curator used when Agent curation is disabled
 * or as an offline/timeout fallback. Splits notes into atomic one-fact items, classifies
 * kinds, strips Markdown noise, and deduplicates overlapping statements.
 */
export function curateNotesWithStructuredFallback(
  notes: readonly ScannedObsidianNoteDigest[]
): {
  readonly items: ObsidianCuratedItem[];
  readonly filteredNoiseCount: number;
  readonly deduplicatedCount: number;
} {
  const candidates: ObsidianCuratedItem[] = [];
  let filteredNoiseCount = 0;

  for (const note of notes) {
    const sections = splitNoteIntoAtomicSections(note.body);
    let producedForNote = 0;

    for (const section of sections) {
      const cleaned = cleanMarkdownFormatting(section.body);
      if (isNoiseOrEmptyTemplateNote(cleaned, section.heading ?? note.title)) {
        continue;
      }

      const summary = clampText(cleaned, MAX_SUMMARY_CHARS);
      const title = deriveAtomicTitle(note.title, section.heading, summary);
      const sectionScopedKind = normalizeObsidianCuratedKind(
        note.frontmatterKind,
        `${section.heading ?? ""} ${summary}`
      );
      const kind =
        sectionScopedKind !== "knowledge"
          ? sectionScopedKind
          : normalizeObsidianCuratedKind(
              undefined,
              `${note.sourceFile} ${note.title} ${note.tags.join(" ")}`
            );

      const folderTag = note.sourceFile.includes("/")
        ? normalizeWorkspaceFolder(note.sourceFile.split("/")[0]!)
        : null;
      const tags = [
        ...new Set([
          ...note.tags.map((t) => t.toLowerCase()),
          ...(folderTag && folderTag !== "default" ? [folderTag] : [])
        ])
      ].slice(0, 6);

      candidates.push({
        id: buildStableCandidateId(note.sourceFile, title, summary),
        title,
        summary,
        kind,
        namespace: note.namespace,
        tags,
        sourceFile: note.sourceFile,
        selected: true,
        curationSource: "structured-fallback",
        importance: note.importance ?? (kind === "preference" || kind === "decision" ? 0.8 : 0.65),
        ...(note.redactedSecretCount > 0 ? { redactedSecretCount: note.redactedSecretCount } : {})
      });
      producedForNote += 1;
    }

    if (producedForNote === 0) {
      filteredNoiseCount += 1;
    }
  }

  const deduped = deduplicateCuratedItems(candidates);
  return {
    items: deduped.items,
    filteredNoiseCount,
    deduplicatedCount: deduped.deduplicatedCount
  };
}

/**
 * Extracts a JSON array or `{ items: [...] }` object from an Agent's text response,
 * tolerating markdown code fences and brief preamble text.
 */
export function parseAgentCurationJson(rawOutput: string): ObsidianAgentCurationProposal[] | null {
  const trimmed = rawOutput.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const candidates: string[] = [trimmed];
  const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fencedMatch?.[1]) {
    candidates.unshift(fencedMatch[1].trim());
  }
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const snippet of candidates) {
    try {
      const parsed: unknown = JSON.parse(snippet);
      const list = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" &&
            parsed !== null &&
            Array.isArray((parsed as Record<string, unknown>)["items"])
          ? ((parsed as Record<string, unknown>)["items"] as unknown[])
          : null;
      if (!list) {
        continue;
      }
      const proposals: ObsidianAgentCurationProposal[] = [];
      for (const entry of list) {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          continue;
        }
        const rec = entry as Record<string, unknown>;
        const title = typeof rec["title"] === "string" ? rec["title"].trim() : "";
        const summary =
          typeof rec["summary"] === "string"
            ? rec["summary"].trim()
            : typeof rec["content"] === "string"
              ? rec["content"].trim()
              : "";
        if (!title || !summary) {
          continue;
        }
        const tags = Array.isArray(rec["tags"])
          ? rec["tags"].filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          : undefined;
        proposals.push({
          title,
          summary,
          ...(typeof rec["kind"] === "string" ? { kind: rec["kind"] } : {}),
          ...(typeof rec["namespace"] === "string" ? { namespace: rec["namespace"] } : {}),
          ...(tags ? { tags } : {}),
          ...(typeof rec["sourceFile"] === "string" ? { sourceFile: rec["sourceFile"] } : {}),
          ...(typeof rec["importance"] === "number" && Number.isFinite(rec["importance"])
            ? { importance: Math.max(0, Math.min(1, rec["importance"])) }
            : {})
        });
      }
      if (proposals.length > 0) {
        return proposals;
      }
    } catch {
      // Try next candidate slice.
    }
  }

  return null;
}

/**
 * Builds the structured curation prompt sent to the active Chief Agent CLI.
 */
export function buildObsidianCurationPrompt(input: {
  readonly secretaryName?: string;
  readonly defaultNamespace: MemoryNamespace;
  readonly notes: readonly ScannedObsidianNoteDigest[];
}): string {
  const roleName = input.secretaryName?.trim() || "主秘书";
  const digestPayload = input.notes.slice(0, MAX_PLAN_NOTES_FOR_AGENT).map((note) => ({
    sourceFile: note.sourceFile,
    title: note.title,
    namespace: note.namespace,
    tags: note.tags,
    excerpt: note.body.slice(0, MAX_NOTE_DIGEST_CHARS)
  }));

  return [
    `你是 Prismux 的「${roleName}」，请帮用户整理即将导入单文件 SQLite 记忆库的 Obsidian 笔记。`,
    "请严格遵守以下规则：",
    "1. 坚持「一条一事实」原则，将长笔记拆分提炼为精炼、独立、可检索的高价值长期记忆条目；",
    "2. 合并重复或高度重叠的条目，彻底剔除空模板、无意义杂记、临时流水账；",
    "3. 严禁输出任何敏感密钥/Token/密码明文（如见疑似凭据替换为 [REDACTED_SECRET]）；",
    '4. 每条必须归类到以下 5 种 kind 之一："preference" | "decision" | "project" | "knowledge" | "experience"；',
    `5. 默认命名空间为 "${input.defaultNamespace}"，仅保留合法命名空间（private/chief 或 workspace/<slug>）；`,
    "6. 仅输出合法 JSON（不要附加解释文字），格式为：",
    '{"items":[{"title":"简明标题","summary":"一条清晰完整的事实摘要","kind":"preference","namespace":"private/chief","tags":["tag1"],"sourceFile":"notes/a.md"}]}',
    "",
    "待整理笔记摘要：",
    JSON.stringify(digestPayload, null, 2)
  ].join("\n");
}

/**
 * Scans an Obsidian Vault, filters empty templates & noise, redacts raw secrets,
 * and produces a structured reviewable candidate plan (via Chief Agent curation when
 * enabled & available, or via deterministic structured semantic fallback).
 */
export async function planObsidianImport(
  request: ObsidianImportPlanRequest,
  options: ObsidianPlanOptions = {}
): Promise<ObsidianImportPlanResponse> {
  const vaultPath = request.vaultPath?.trim();
  if (!vaultPath) {
    throw new Error("vaultPath is required.");
  }

  const explicitNamespaceRaw = request.namespace ?? request.targetNamespace;
  let explicitNamespace: MemoryNamespace | undefined;
  if (explicitNamespaceRaw !== undefined) {
    if (!isValidMemoryNamespace(explicitNamespaceRaw)) {
      throw new Error(`Invalid namespace: "${explicitNamespaceRaw}"`);
    }
    explicitNamespace = explicitNamespaceRaw;
  }
  const defaultNamespace: MemoryNamespace = explicitNamespace ?? "private/chief";
  const useAgentCuration = request.useAgentCuration !== false;

  const vaultStats = await stat(vaultPath);
  if (!vaultStats.isDirectory()) {
    throw new Error(`Obsidian vaultPath is not a directory: "${vaultPath}"`);
  }

  const files: Array<{ absPath: string; posixRelPath: string }> = [];
  await collectMarkdownFiles(vaultPath, "", files);
  files.sort((a, b) => a.posixRelPath.localeCompare(b.posixRelPath));

  const warnings: string[] = [];
  const digests: ScannedObsidianNoteDigest[] = [];
  let scannedFiles = 0;
  let skippedFiles = 0;
  let filteredNoiseCount = 0;
  let totalRedactedSecrets = 0;

  for (const file of files) {
    scannedFiles += 1;
    let rawContent: string;
    try {
      rawContent = await readFile(file.absPath, "utf8");
    } catch (error) {
      skippedFiles += 1;
      warnings.push(
        `Failed to read ${file.posixRelPath}: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }

    const fileStem = basename(file.posixRelPath, ".md");
    const parsed: ParsedObsidianNote = parseObsidianMarkdown(rawContent, fileStem);

    if (
      parsed.body.length === 0 &&
      !parsed.hasFrontmatter &&
      parsed.frontmatter.tags.length === 0
    ) {
      skippedFiles += 1;
      filteredNoiseCount += 1;
      continue;
    }

    const redactedBody = redactSensitiveCredentials(parsed.body);
    const redactedTitle = redactSensitiveCredentials(parsed.title);
    const noteSecretCount = redactedBody.count + redactedTitle.count;
    totalRedactedSecrets += noteSecretCount;

    if (isNoiseOrEmptyTemplateNote(redactedBody.text, redactedTitle.text)) {
      skippedFiles += 1;
      filteredNoiseCount += 1;
      continue;
    }

    const namespace = resolveNamespaceForNote(
      file.posixRelPath,
      explicitNamespace,
      parsed.frontmatter.namespace,
      warnings
    );

    const tags = [
      ...new Set([
        ...parsed.frontmatter.tags.map((t) => t.toLowerCase()),
        ...extractInlineTags(redactedBody.text)
      ])
    ].slice(0, 8);

    digests.push({
      sourceFile: file.posixRelPath,
      title: redactedTitle.text,
      namespace,
      body: redactedBody.text,
      tags,
      ...(parsed.frontmatter.kind !== undefined ? { frontmatterKind: parsed.frontmatter.kind } : {}),
      ...(parsed.frontmatter.importance !== undefined
        ? { importance: Math.max(0, Math.min(1, parsed.frontmatter.importance)) }
        : {}),
      redactedSecretCount: noteSecretCount
    });
  }

  let curationSource: ObsidianCurationSource = "structured-fallback";
  let curatorLabel = options.curatorLabel;
  let finalItems: ObsidianCuratedItem[] = [];
  let deduplicatedCount = 0;

  if (digests.length > 0 && useAgentCuration && options.agentCurator) {
    const timeoutMs = Math.max(1000, options.agentTimeoutMs ?? DEFAULT_AGENT_CURATION_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Agent curation timed out")), timeoutMs);
    try {
      const agentResult = await options.agentCurator({
        vaultPath,
        defaultNamespace,
        notes: digests.slice(0, MAX_PLAN_NOTES_FOR_AGENT),
        ...(request.provider ? { provider: request.provider } : {}),
        ...(request.model ? { model: request.model } : {}),
        signal: controller.signal
      });

      if (agentResult && agentResult.items.length > 0) {
        if (agentResult.curatorLabel) {
          curatorLabel = agentResult.curatorLabel;
        }
        if (agentResult.warnings) {
          warnings.push(...agentResult.warnings);
        }

        const noteByPath = new Map(digests.map((note) => [note.sourceFile, note] as const));
        const normalizedFromAgent: ObsidianCuratedItem[] = [];

        for (const proposal of agentResult.items) {
          const titleRedacted = redactSensitiveCredentials(proposal.title);
          const summaryRedacted = redactSensitiveCredentials(proposal.summary);
          const extraSecrets = titleRedacted.count + summaryRedacted.count;
          totalRedactedSecrets += extraSecrets;

          const cleanTitle = clampText(titleRedacted.text, MAX_TITLE_CHARS);
          const cleanSummary = clampText(summaryRedacted.text, MAX_SUMMARY_CHARS);
          if (isNoiseOrEmptyTemplateNote(cleanSummary, cleanTitle)) {
            filteredNoiseCount += 1;
            continue;
          }

          const matchedSource =
            proposal.sourceFile && noteByPath.has(proposal.sourceFile)
              ? proposal.sourceFile
              : (proposal.sourceFile?.trim() || digests[0]!.sourceFile);
          const sourceDigest = noteByPath.get(matchedSource);
          const nsCandidate = proposal.namespace?.trim();
          const namespace: MemoryNamespace =
            explicitNamespace !== undefined
              ? explicitNamespace
              : nsCandidate && isValidMemoryNamespace(nsCandidate)
                ? nsCandidate
                : (sourceDigest?.namespace ?? defaultNamespace);

          const kind = normalizeObsidianCuratedKind(
            proposal.kind,
            `${cleanTitle} ${cleanSummary}`
          );
          const tags = [
            ...new Set([
              ...(proposal.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
              ...(sourceDigest?.tags ?? [])
            ])
          ].slice(0, 6);

          normalizedFromAgent.push({
            id: buildStableCandidateId(matchedSource, cleanTitle, cleanSummary),
            title: cleanTitle,
            summary: cleanSummary,
            kind,
            namespace,
            tags,
            sourceFile: matchedSource,
            selected: true,
            curationSource: "agent",
            importance:
              proposal.importance ??
              sourceDigest?.importance ??
              (kind === "preference" || kind === "decision" ? 0.82 : 0.68),
            ...((sourceDigest?.redactedSecretCount ?? 0) + extraSecrets > 0
              ? { redactedSecretCount: (sourceDigest?.redactedSecretCount ?? 0) + extraSecrets }
              : {})
          });
        }

        if (normalizedFromAgent.length > 0) {
          // If vault had more notes than agent batch cap, curate remaining via fallback and merge cleanly.
          let combined = normalizedFromAgent;
          if (digests.length > MAX_PLAN_NOTES_FOR_AGENT) {
            const overflow = curateNotesWithStructuredFallback(
              digests.slice(MAX_PLAN_NOTES_FOR_AGENT)
            );
            filteredNoiseCount += overflow.filteredNoiseCount;
            deduplicatedCount += overflow.deduplicatedCount;
            combined = [...normalizedFromAgent, ...overflow.items];
          }
          const deduped = deduplicateCuratedItems(combined);
          finalItems = deduped.items;
          deduplicatedCount += deduped.deduplicatedCount;
          curationSource = "agent";
        }
      }
    } catch (error) {
      warnings.push(
        `Agent 智能整理不可用，已平滑回退至本地结构化语义整理：${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  if (finalItems.length === 0 && digests.length > 0) {
    const fallback = curateNotesWithStructuredFallback(digests);
    finalItems = fallback.items;
    filteredNoiseCount += fallback.filteredNoiseCount;
    deduplicatedCount += fallback.deduplicatedCount;
    curationSource = "structured-fallback";
    if (useAgentCuration && !options.agentCurator) {
      warnings.push("当前未配置可调用的主秘书 CLI，已采用本地结构化语义整理器生成候选记忆。");
    }
  }

  const stats: ObsidianImportPlanStats = {
    scannedFiles,
    curatedCount: finalItems.length,
    deduplicatedCount,
    filteredNoiseCount,
    redactedSecretCount: totalRedactedSecrets,
    skippedFiles
  };

  return {
    ok: true,
    vaultPath,
    defaultNamespace,
    useAgentCuration,
    curationSource,
    ...(curatorLabel ? { curatorLabel } : {}),
    items: finalItems,
    stats,
    warnings
  };
}

/**
 * Commits user-reviewed curated Obsidian items (`selected !== false`) into the single-file
 * SQLite memory store with defense-in-depth secret redaction and namespace validation.
 */
export async function commitObsidianImportPlan(
  store: MemoryStore,
  machineId: string,
  request: ObsidianImportCommitRequest
): Promise<ObsidianImportCommitResponse> {
  if (!Array.isArray(request.items)) {
    throw new Error("items must be an array.");
  }

  let committedCount = 0;
  let skippedCount = 0;
  let redactedSecretCount = 0;
  const entryIds: string[] = [];
  const warnings: string[] = [];

  for (const item of request.items) {
    if (!item || item.selected === false) {
      skippedCount += 1;
      continue;
    }

    const rawTitle = typeof item.title === "string" ? item.title.trim() : "";
    const rawSummary = typeof item.summary === "string" ? item.summary.trim() : "";
    if (!rawTitle || !rawSummary) {
      skippedCount += 1;
      warnings.push(`Skipped incomplete candidate "${item.id ?? "unknown"}".`);
      continue;
    }

    const namespace: MemoryNamespace = isValidMemoryNamespace(item.namespace)
      ? item.namespace
      : "private/chief";

    const titleRedacted = redactSensitiveCredentials(rawTitle);
    const summaryRedacted = redactSensitiveCredentials(rawSummary);
    redactedSecretCount += titleRedacted.count + summaryRedacted.count;

    const curatedKind = normalizeObsidianCuratedKind(item.kind, `${titleRedacted.text} ${summaryRedacted.text}`);
    const memoryKind = mapCuratedKindToMemoryKind(curatedKind);
    const tags = Array.isArray(item.tags)
      ? [...new Set(item.tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 8)
      : [];
    const sourceFile = typeof item.sourceFile === "string" && item.sourceFile.trim().length > 0
      ? item.sourceFile.trim()
      : "unknown.md";

    const contentParts = [summaryRedacted.text];
    contentParts.push(`[Category: ${curatedKind}]`);
    if (tags.length > 0) {
      contentParts.push(`[Tags: ${tags.join(", ")}]`);
    }
    contentParts.push(`[Source: obsidian:${sourceFile}]`);

    const importance =
      typeof item.importance === "number" && Number.isFinite(item.importance)
        ? Math.max(0, Math.min(1, item.importance))
        : curatedKind === "preference" || curatedKind === "decision"
          ? 0.8
          : 0.65;

    const entry = await store.upsert({
      namespace,
      kind: memoryKind,
      title: clampText(titleRedacted.text, MAX_TITLE_CHARS),
      content: contentParts.join("\n\n"),
      sourceRef: `obsidian-curated:${sourceFile}#${item.id || buildStableCandidateId(sourceFile, titleRedacted.text, summaryRedacted.text)}`,
      importance,
      machineId
    });
    entryIds.push(entry.id);
    committedCount += 1;
  }

  return {
    ok: true,
    committedCount,
    skippedCount,
    redactedSecretCount,
    entryIds,
    warnings
  };
}
