import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, posix } from "node:path";
import {
  MEMORY_KINDS,
  isValidMemoryNamespace,
  type MemoryKind,
  type MemoryNamespace,
  type ObsidianImportRequest,
  type ObsidianImportResult
} from "@prismux/protocol";
import type { MemoryStore, ObsidianVaultImporter } from "./types.js";

const IGNORED_DIRECTORY_NAMES = new Set([
  ".obsidian",
  ".trash",
  ".git",
  "node_modules"
]);

const PRIVATE_TOP_DIRECTORIES = new Set([
  "daily",
  "journal",
  "inbox",
  "private"
]);

export interface ObsidianImporterOptions {
  defaultKind?: MemoryKind;
  defaultImportance?: number;
}

export interface ParsedWikiLink {
  raw: string;
  target: string;
  alias?: string;
}

export interface ParsedObsidianFrontmatter {
  title?: string;
  kind?: string;
  importance?: number;
  rawImportance?: string;
  namespace?: string;
  tags: string[];
}

export interface ParsedObsidianNote {
  frontmatter: ParsedObsidianFrontmatter;
  body: string;
  title: string;
  wikiLinks: ParsedWikiLink[];
  hasFrontmatter: boolean;
}

function stripOptionalQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function stripInlineComment(value: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle && value[i - 1] !== "\\") {
      inDouble = !inDouble;
    } else if (ch === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(value[i - 1]!))) {
      return value.slice(0, i).trim();
    }
  }
  return value.trim();
}

function parseInlineYamlArray(rawValue: string): string[] {
  const inner = rawValue.slice(1, -1).trim();
  if (inner.length === 0) {
    return [];
  }
  const items: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!;
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
    } else if (ch === '"' && !inSingle && inner[i - 1] !== "\\") {
      inDouble = !inDouble;
      current += ch;
    } else if (ch === "," && !inSingle && !inDouble) {
      const cleaned = stripOptionalQuotes(current).replace(/^#/, "").trim();
      if (cleaned.length > 0) {
        items.push(cleaned);
      }
      current = "";
    } else {
      current += ch;
    }
  }

  const tail = stripOptionalQuotes(current).replace(/^#/, "").trim();
  if (tail.length > 0) {
    items.push(tail);
  }
  return items;
}

function parseFrontmatterLines(lines: string[]): ParsedObsidianFrontmatter {
  const fm: ParsedObsidianFrontmatter = { tags: [] };
  let activeListKey: string | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    if (activeListKey !== null) {
      const listMatch = /^-\s+(.+)$/.exec(trimmed);
      if (listMatch) {
        const item = stripOptionalQuotes(stripInlineComment(listMatch[1]!))
          .replace(/^#/, "")
          .trim();
        if (activeListKey === "tags" && item.length > 0) {
          fm.tags.push(item);
        }
        continue;
      }
      if (!/^\s/.test(rawLine)) {
        activeListKey = null;
      }
    }

    const kvMatch = /^([A-Za-z0-9_-]+)\s*:(.*)$/.exec(trimmed);
    if (!kvMatch) {
      continue;
    }

    const key = kvMatch[1]!.toLowerCase();
    const rawRest = stripInlineComment(kvMatch[2]!);

    if (rawRest.length === 0) {
      activeListKey = key;
      continue;
    }
    activeListKey = null;

    if (key === "tags" || key === "tag") {
      if (rawRest.startsWith("[") && rawRest.endsWith("]")) {
        fm.tags.push(...parseInlineYamlArray(rawRest));
      } else {
        const singleTags = rawRest
          .split(/[,\s]+/)
          .map((t) => stripOptionalQuotes(t).replace(/^#/, "").trim())
          .filter((t) => t.length > 0);
        fm.tags.push(...singleTags);
      }
      continue;
    }

    const scalar = stripOptionalQuotes(rawRest);
    switch (key) {
      case "title":
        if (scalar.length > 0) {
          fm.title = scalar;
        }
        break;
      case "kind":
        if (scalar.length > 0) {
          fm.kind = scalar;
        }
        break;
      case "namespace":
        if (scalar.length > 0) {
          fm.namespace = scalar;
        }
        break;
      case "importance": {
        fm.rawImportance = scalar;
        const parsed = Number(scalar);
        if (Number.isFinite(parsed)) {
          fm.importance = parsed;
        }
        break;
      }
      default:
        break;
    }
  }

  fm.tags = [...new Set(fm.tags)];
  return fm;
}

export function extractWikiLinks(markdownBody: string): ParsedWikiLink[] {
  const links: ParsedWikiLink[] = [];
  const regex = /!?\[\[([^\[\]\r\n]+?)\]\]/g;
  for (const match of markdownBody.matchAll(regex)) {
    const inner = match[1]!.trim();
    if (inner.length === 0) {
      continue;
    }
    const pipeIdx = inner.indexOf("|");
    if (pipeIdx >= 0) {
      const target = inner.slice(0, pipeIdx).trim();
      const alias = inner.slice(pipeIdx + 1).trim();
      if (target.length > 0) {
        links.push({
          raw: match[0],
          target,
          ...(alias.length > 0 ? { alias } : {})
        });
      }
    } else {
      links.push({
        raw: match[0],
        target: inner
      });
    }
  }
  return links;
}

/**
 * Zero-dependency Obsidian Markdown parser extracting YAML frontmatter and `[[wikilink]]` references.
 */
export function parseObsidianMarkdown(
  rawMarkdown: string,
  fallbackTitle: string
): ParsedObsidianNote {
  const normalized = rawMarkdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  let frontmatter: ParsedObsidianFrontmatter = { tags: [] };
  let body = normalized;
  let hasFrontmatter = false;

  if (lines[0]?.trim() === "---") {
    let closeIndex = -1;
    for (let i = 1; i < lines.length; i += 1) {
      const marker = lines[i]!.trim();
      if (marker === "---" || marker === "...") {
        closeIndex = i;
        break;
      }
    }
    if (closeIndex > 0) {
      hasFrontmatter = true;
      frontmatter = parseFrontmatterLines(lines.slice(1, closeIndex));
      body = lines.slice(closeIndex + 1).join("\n");
    }
  }

  const trimmedBody = body.trim();
  const h1Match = /^#\s+(.+?)\s*#*$/m.exec(trimmedBody);
  const title = frontmatter.title ?? h1Match?.[1]?.trim() ?? fallbackTitle;
  const wikiLinks = extractWikiLinks(trimmedBody);

  return {
    frontmatter,
    body: trimmedBody,
    title,
    wikiLinks,
    hasFrontmatter
  };
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

function resolveNamespaceForRelPath(
  posixRelPath: string,
  targetNamespace: MemoryNamespace | undefined,
  frontmatterNamespace: string | undefined,
  warnings: string[]
): MemoryNamespace {
  if (targetNamespace !== undefined) {
    return targetNamespace;
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

/**
 * Zero-client Obsidian Vault importer that scans `.md` notes, parses YAML
 * frontmatter and `[[wikilink]]` syntax, maps folder paths to Prismux namespaces,
 * and performs idempotent upserts keyed by `obsidian:<posixRelPath>`.
 */
export class ObsidianVaultImporterImpl implements ObsidianVaultImporter {
  private readonly store: MemoryStore;
  private readonly machineId: string;
  private readonly defaultKind: MemoryKind;
  private readonly defaultImportance: number;

  constructor(
    store: MemoryStore,
    machineId: string,
    options?: ObsidianImporterOptions
  ) {
    this.store = store;
    this.machineId = machineId;
    this.defaultKind = options?.defaultKind ?? "fact";
    this.defaultImportance = options?.defaultImportance ?? 0.5;
  }

  async importVault(request: ObsidianImportRequest): Promise<ObsidianImportResult> {
    if (
      request.targetNamespace !== undefined &&
      !isValidMemoryNamespace(request.targetNamespace)
    ) {
      throw new Error(`Invalid targetNamespace: "${request.targetNamespace}"`);
    }

    const vaultStats = await stat(request.vaultPath);
    if (!vaultStats.isDirectory()) {
      throw new Error(`Obsidian vaultPath is not a directory: "${request.vaultPath}"`);
    }

    const files: Array<{ absPath: string; posixRelPath: string }> = [];
    await collectMarkdownFiles(request.vaultPath, "", files);
    files.sort((a, b) => a.posixRelPath.localeCompare(b.posixRelPath));

    let scannedFiles = 0;
    let importedEntries = 0;
    let skippedFiles = 0;
    const warnings: string[] = [];

    for (const file of files) {
      scannedFiles += 1;

      let rawContent: string;
      try {
        rawContent = await readFile(file.absPath, "utf8");
      } catch (error) {
        skippedFiles += 1;
        warnings.push(
          `Failed to read ${file.posixRelPath}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        continue;
      }

      const fileStem = basename(file.posixRelPath, ".md");
      const parsed = parseObsidianMarkdown(rawContent, fileStem);

      if (
        parsed.body.length === 0 &&
        !parsed.hasFrontmatter &&
        parsed.frontmatter.tags.length === 0
      ) {
        skippedFiles += 1;
        warnings.push(`Skipped empty note: ${file.posixRelPath}`);
        continue;
      }

      let kind: MemoryKind = this.defaultKind;
      if (parsed.frontmatter.kind !== undefined) {
        if (MEMORY_KINDS.includes(parsed.frontmatter.kind as MemoryKind)) {
          kind = parsed.frontmatter.kind as MemoryKind;
        } else {
          warnings.push(
            `Unknown frontmatter kind "${parsed.frontmatter.kind}" in ${file.posixRelPath}; defaulted to "${this.defaultKind}".`
          );
        }
      }

      let importance = this.defaultImportance;
      if (parsed.frontmatter.rawImportance !== undefined) {
        if (parsed.frontmatter.importance !== undefined) {
          importance = Math.max(0, Math.min(1, parsed.frontmatter.importance));
        } else {
          warnings.push(
            `Invalid frontmatter importance "${parsed.frontmatter.rawImportance}" in ${file.posixRelPath}; defaulted to ${this.defaultImportance}.`
          );
        }
      }

      const namespace = resolveNamespaceForRelPath(
        file.posixRelPath,
        request.targetNamespace,
        parsed.frontmatter.namespace,
        warnings
      );

      const contentParts: string[] = [];
      if (parsed.body.length > 0) {
        contentParts.push(parsed.body);
      } else {
        contentParts.push(parsed.title);
      }

      if (parsed.frontmatter.tags.length > 0) {
        contentParts.push(`[Tags: ${parsed.frontmatter.tags.join(", ")}]`);
      }

      if (parsed.wikiLinks.length > 0) {
        const formattedLinks = parsed.wikiLinks.map((link) =>
          link.alias ? `${link.target} (${link.alias})` : link.target
        );
        contentParts.push(`[WikiLinks: ${formattedLinks.join(", ")}]`);
      }

      const content = contentParts.join("\n\n");
      const sourceRef = `obsidian:${file.posixRelPath}`;

      if (request.dryRun) {
        continue;
      }

      await this.store.upsert({
        namespace,
        kind,
        title: parsed.title,
        content,
        sourceRef,
        importance,
        machineId: this.machineId
      });
      importedEntries += 1;
    }

    return {
      scannedFiles,
      importedEntries,
      skippedFiles,
      warnings
    };
  }
}
