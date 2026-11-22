import {
  isScopeAllowedForNamespace,
  isValidMemoryNamespace,
  type CallerScope,
  type MemoryNamespace,
  type MemoryQueryRequest
} from "@prismux/protocol";

export const MCP_TOOL_TIMEOUT_MS = 60_000 as const;

export type CollectorDocumentKind = "email" | "html" | "markdown" | "text";

export interface CollectorInput {
  kind: CollectorDocumentKind;
  raw: string;
  sourceRef: string;
  maxChunkChars?: number;
  overlapChars?: number;
}

export interface CollectorChunk {
  chunkIndex: number;
  text: string;
  sourceRef: string;
  headingPath?: string[];
  breadcrumb?: string;
  metadata?: Record<string, string>;
}

export interface ContentCollector {
  collect(input: CollectorInput): CollectorChunk[];
}

export interface BoundMemoryQueryRequest extends MemoryQueryRequest {
  _callerScope: CallerScope;
}

export interface ScopedQueryConstraints {
  callerScope: CallerScope;
  _callerScope: CallerScope;
  allowedNamespaces: MemoryNamespace[];
  unrestricted: boolean;
  timeoutMs: number;
}

export interface McpTimeoutBreakerStats {
  activeCount: number;
  completedCount: number;
  timeoutCount: number;
  errorCount: number;
}

/**
 * Lightweight fixed-width collector preserved for M1 compatibility.
 */
export class BasicContentCollector implements ContentCollector {
  collect(input: CollectorInput): CollectorChunk[] {
    const trimmed = input.raw.trim();
    if (trimmed.length === 0) {
      return [];
    }
    const maxChars = Math.max(128, input.maxChunkChars ?? 1600);
    const chunks: CollectorChunk[] = [];
    let offset = 0;
    let index = 0;
    while (offset < trimmed.length) {
      chunks.push({
        chunkIndex: index,
        text: trimmed.slice(offset, offset + maxChars),
        sourceRef: input.sourceRef
      });
      offset += maxChars;
      index += 1;
    }
    return chunks;
  }
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function splitLongParagraph(
  paragraph: string,
  maxChars: number,
  overlapChars: number
): string[] {
  const trimmed = paragraph.trim();
  if (trimmed.length === 0) {
    return [];
  }
  if (trimmed.length <= maxChars) {
    return [trimmed];
  }

  const effectiveOverlap = Math.max(
    0,
    Math.min(overlapChars, Math.floor(maxChars / 2))
  );
  const slices: string[] = [];
  let start = 0;

  while (start < trimmed.length) {
    const hardEnd = Math.min(trimmed.length, start + maxChars);
    let end = hardEnd;
    if (hardEnd < trimmed.length) {
      const minBreak = start + Math.max(1, Math.floor(maxChars * 0.5));
      const lastSpace = trimmed.lastIndexOf(" ", hardEnd);
      const lastNewline = trimmed.lastIndexOf("\n", hardEnd);
      const bestBreak = Math.max(lastSpace, lastNewline);
      if (bestBreak >= minBreak) {
        end = bestBreak;
      }
    }

    const piece = trimmed.slice(start, end).trim();
    if (piece.length > 0) {
      slices.push(piece);
    }

    if (end >= trimmed.length) {
      break;
    }
    const nextStart = Math.max(start + 1, end - effectiveOverlap);
    start = nextStart;
  }

  return slices;
}

function chunkTextByParagraphs(
  text: string,
  maxChars: number,
  overlapChars: number
): string[] {
  const normalized = normalizeNewlines(text).trim();
  if (normalized.length === 0) {
    return [];
  }

  const rawParagraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (rawParagraphs.length === 0) {
    return [];
  }

  const effectiveOverlap = Math.max(
    0,
    Math.min(overlapChars, Math.floor(maxChars / 2))
  );
  const segments: Array<{ text: string; alreadyOverlapped: boolean }> = [];
  for (const para of rawParagraphs) {
    const pieces = splitLongParagraph(para, maxChars, effectiveOverlap);
    for (let i = 0; i < pieces.length; i += 1) {
      segments.push({
        text: pieces[i]!,
        alreadyOverlapped: i > 0
      });
    }
  }

  const chunks: string[] = [];
  let current = "";

  const pushCurrent = (): void => {
    if (current.trim().length > 0) {
      chunks.push(current.trim());
    }
  };

  for (const seg of segments) {
    if (current.length === 0) {
      current = seg.text;
      continue;
    }
    const candidate = `${current}\n\n${seg.text}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    pushCurrent();
    if (effectiveOverlap > 0 && !seg.alreadyOverlapped) {
      const tail = current.slice(-effectiveOverlap).trimStart();
      if (tail.length > 0) {
        const combined = `${tail}\n\n${seg.text}`;
        if (combined.length <= maxChars) {
          current = combined;
        } else {
          const splitWithTail = splitLongParagraph(
            combined,
            maxChars,
            effectiveOverlap
          );
          for (let i = 0; i < splitWithTail.length - 1; i += 1) {
            chunks.push(splitWithTail[i]!);
          }
          current = splitWithTail[splitWithTail.length - 1] ?? seg.text;
        }
      } else {
        current = seg.text;
      }
    } else {
      current = seg.text;
    }
  }

  pushCurrent();
  return chunks;
}

interface ParsedEmailResult {
  headers: Record<string, string>;
  cleanedBody: string;
}

function parseEmailDocument(raw: string): ParsedEmailResult {
  const normalized = normalizeNewlines(raw);
  const blankLineMatch = /\n\n/.exec(normalized);
  const candidateHeaderBlock = blankLineMatch
    ? normalized.slice(0, blankLineMatch.index)
    : normalized;

  const hasRfcHeaders =
    /^(?:Subject|From|Date|To|Cc|Reply-To|Message-ID|Content-Type)\s*:/im.test(
      candidateHeaderBlock
    );

  const headers: Record<string, string> = {};
  let body = normalized;

  if (hasRfcHeaders) {
    body = blankLineMatch
      ? normalized.slice(blankLineMatch.index + 2)
      : "";
    const unfoldedLines: string[] = [];
    for (const line of candidateHeaderBlock.split("\n")) {
      if ((line.startsWith(" ") || line.startsWith("\t")) && unfoldedLines.length > 0) {
        const lastIndex = unfoldedLines.length - 1;
        unfoldedLines[lastIndex] = `${unfoldedLines[lastIndex]} ${line.trim()}`;
      } else {
        unfoldedLines.push(line);
      }
    }
    for (const line of unfoldedLines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx <= 0) {
        continue;
      }
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();
      if ((key === "subject" || key === "from" || key === "date") && value.length > 0) {
        headers[key] = value;
      }
    }
  }

  const bodyLines = body.split("\n");
  const filteredLines: string[] = [];
  for (const line of bodyLines) {
    // Stop at standard RFC 3676 signature delimiter (`-- ` or `--`), never matching `---`.
    if (/^--\s*$/.test(line)) {
      break;
    }
    // Strip quoted reply lines starting with `>`.
    if (/^\s*>/.test(line)) {
      continue;
    }
    filteredLines.push(line);
  }

  const cleanedBody = filteredLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { headers, cleanedBody };
}

function decodeHtmlEntities(text: string): string {
  const namedMap: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    "#39": "'",
    nbsp: " "
  };

  return text.replace(
    /&(amp|lt|gt|quot|apos|nbsp|#39|#\d+|#x[0-9a-f]+);/gi,
    (full, token: string) => {
      const lower = token.toLowerCase();
      if (lower in namedMap) {
        return namedMap[lower]!;
      }
      if (lower.startsWith("#x")) {
        const code = Number.parseInt(lower.slice(2), 16);
        if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
          return String.fromCodePoint(code);
        }
        return full;
      }
      if (lower.startsWith("#")) {
        const code = Number.parseInt(lower.slice(1), 10);
        if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
          return String.fromCodePoint(code);
        }
        return full;
      }
      return full;
    }
  );
}

function extractTextFromHtml(raw: string): string {
  let cleaned = normalizeNewlines(raw);
  // Strip executable/style/noscript elements and HTML comments completely.
  cleaned = cleaned
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|noscript)\b[^>]*\/>/gi, "");

  // Convert block-level elements into paragraph/line boundaries before stripping tags.
  cleaned = cleaned
    .replace(
      /<\/?(?:p|div|section|article|header|footer|aside|main|nav|blockquote|pre|h[1-6]|ul|ol|table|thead|tbody|tfoot|dl|dt|dd|hr)\b[^>]*>/gi,
      "\n\n"
    )
    .replace(/<\/?(?:br|li|tr)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:td|th)\b[^>]*>/gi, " ");

  cleaned = cleaned.replace(/<[^>]+>/g, "");
  cleaned = decodeHtmlEntities(cleaned);

  return cleaned
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface MarkdownSection {
  headingPath: string[];
  body: string;
}

function parseMarkdownSections(raw: string): MarkdownSection[] {
  const lines = normalizeNewlines(raw).split("\n");
  const stack: Array<{ level: number; title: string }> = [];
  const sections: MarkdownSection[] = [];
  let buffer: string[] = [];
  let currentPath: string[] = [];
  let activeFenceChar: string | null = null;
  let activeFenceLen = 0;

  const flushSection = (): void => {
    const body = buffer.join("\n").trim();
    if (body.length > 0) {
      sections.push({
        headingPath: [...currentPath],
        body
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      const char = marker[0]!;
      if (activeFenceChar === null) {
        activeFenceChar = char;
        activeFenceLen = marker.length;
      } else if (char === activeFenceChar && marker.length >= activeFenceLen) {
        activeFenceChar = null;
        activeFenceLen = 0;
      }
      buffer.push(line);
      continue;
    }

    if (activeFenceChar === null) {
      const headingMatch = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
      if (headingMatch) {
        flushSection();
        const level = headingMatch[1]!.length;
        const title = headingMatch[2]!.trim();
        while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
          stack.pop();
        }
        stack.push({ level, title });
        currentPath = stack.map((item) => item.title);
        continue;
      }
    }

    buffer.push(line);
  }

  flushSection();

  if (sections.length === 0 && stack.length > 0) {
    sections.push({
      headingPath: stack.map((item) => item.title),
      body: stack.map((item) => item.title).join(" > ")
    });
  }

  return sections;
}

/**
 * Multi-format document collector supporting email, HTML, Markdown, and plain text.
 */
export class DocumentCollector implements ContentCollector {
  collect(input: CollectorInput): CollectorChunk[] {
    const raw = input.raw;
    if (raw.trim().length === 0) {
      return [];
    }

    const maxChars = Math.max(32, Math.floor(input.maxChunkChars ?? 1600));
    const overlapChars = Math.max(0, Math.floor(input.overlapChars ?? 0));

    switch (input.kind) {
      case "email":
        return this.collectEmail(input.sourceRef, raw, maxChars, overlapChars);
      case "html":
        return this.collectHtml(input.sourceRef, raw, maxChars, overlapChars);
      case "markdown":
        return this.collectMarkdown(input.sourceRef, raw, maxChars, overlapChars);
      case "text":
        return this.collectPlainText(input.sourceRef, raw, maxChars, overlapChars);
    }
  }

  private collectEmail(
    sourceRef: string,
    raw: string,
    maxChars: number,
    overlapChars: number
  ): CollectorChunk[] {
    const { headers, cleanedBody } = parseEmailDocument(raw);
    const headerLines: string[] = [];
    if (headers.subject) headerLines.push(`Subject: ${headers.subject}`);
    if (headers.from) headerLines.push(`From: ${headers.from}`);
    if (headers.date) headerLines.push(`Date: ${headers.date}`);

    const combined =
      headerLines.length > 0 && cleanedBody.length > 0
        ? `${headerLines.join("\n")}\n\n${cleanedBody}`
        : headerLines.length > 0
          ? headerLines.join("\n")
          : cleanedBody;

    const pieces = chunkTextByParagraphs(combined, maxChars, overlapChars);
    const hasMetadata = Object.keys(headers).length > 0;
    return pieces.map((text, index) => ({
      chunkIndex: index,
      text,
      sourceRef,
      ...(hasMetadata ? { metadata: { ...headers } } : {})
    }));
  }

  private collectHtml(
    sourceRef: string,
    raw: string,
    maxChars: number,
    overlapChars: number
  ): CollectorChunk[] {
    const extracted = extractTextFromHtml(raw);
    const pieces = chunkTextByParagraphs(extracted, maxChars, overlapChars);
    return pieces.map((text, index) => ({
      chunkIndex: index,
      text,
      sourceRef
    }));
  }

  private collectMarkdown(
    sourceRef: string,
    raw: string,
    maxChars: number,
    overlapChars: number
  ): CollectorChunk[] {
    const sections = parseMarkdownSections(raw);
    if (sections.length === 0) {
      return [];
    }

    const chunks: CollectorChunk[] = [];
    let chunkIndex = 0;

    for (const section of sections) {
      const breadcrumb = section.headingPath.join(" > ");
      const prefix = breadcrumb.length > 0 ? `[${breadcrumb}]\n` : "";
      const bodyBudget = Math.max(16, maxChars - prefix.length);
      const bodyChunks = chunkTextByParagraphs(
        section.body,
        bodyBudget,
        overlapChars
      );

      for (const bodyPart of bodyChunks) {
        chunks.push({
          chunkIndex,
          text: prefix.length > 0 ? `${prefix}${bodyPart}` : bodyPart,
          sourceRef,
          ...(section.headingPath.length > 0
            ? { headingPath: [...section.headingPath], breadcrumb }
            : {})
        });
        chunkIndex += 1;
      }
    }

    return chunks;
  }

  private collectPlainText(
    sourceRef: string,
    raw: string,
    maxChars: number,
    overlapChars: number
  ): CollectorChunk[] {
    const pieces = chunkTextByParagraphs(raw, maxChars, overlapChars);
    return pieces.map((text, index) => ({
      chunkIndex: index,
      text,
      sourceRef
    }));
  }
}

const defaultDocumentCollector = new DocumentCollector();

/**
 * Convenience helper to collect and chunk email, HTML, Markdown, or plain text documents.
 */
export function collectDocument(input: CollectorInput): CollectorChunk[] {
  return defaultDocumentCollector.collect(input);
}

/**
 * Validates that a caller scope injected at transport layer is well-formed.
 */
export function validateTrustedCallerScope(scope: string): CallerScope {
  if (scope === "owner_chief") {
    return "owner_chief";
  }
  if (scope.startsWith("qq_group:")) {
    const groupId = scope.slice("qq_group:".length);
    if (groupId.length > 0) {
      return scope as CallerScope;
    }
  }
  throw new Error(`Invalid trusted caller scope: "${scope}"`);
}

/**
 * Transport-level identity forwarder and physical isolation guard (M2).
 * Daemon unconditionally overwrites `_callerScope` and `callerScope` at the
 * transport layer; any model-supplied or payload-supplied scope hints are ignored.
 */
export class ForwardIdentityGuard {
  resolveQueryConstraints(
    trustedCallerScope: CallerScope,
    requestedNamespaces?: MemoryNamespace[]
  ): ScopedQueryConstraints {
    const verifiedScope = validateTrustedCallerScope(trustedCallerScope);

    if (verifiedScope.startsWith("qq_group:")) {
      const groupId = verifiedScope.slice("qq_group:".length);
      const lockedNamespace: MemoryNamespace = `social/qq-group-${groupId}`;
      return {
        callerScope: verifiedScope,
        _callerScope: verifiedScope,
        allowedNamespaces: [lockedNamespace],
        unrestricted: false,
        timeoutMs: MCP_TOOL_TIMEOUT_MS
      };
    }

    if (requestedNamespaces === undefined || requestedNamespaces.length === 0) {
      return {
        callerScope: verifiedScope,
        _callerScope: verifiedScope,
        allowedNamespaces: [],
        unrestricted: true,
        timeoutMs: MCP_TOOL_TIMEOUT_MS
      };
    }

    const allowedNamespaces = requestedNamespaces.filter(
      (ns) =>
        isValidMemoryNamespace(ns) &&
        isScopeAllowedForNamespace(verifiedScope, ns)
    );

    return {
      callerScope: verifiedScope,
      _callerScope: verifiedScope,
      allowedNamespaces,
      unrestricted: false,
      timeoutMs: MCP_TOOL_TIMEOUT_MS
    };
  }

  bindCallerScope(
    trustedCallerScope: CallerScope,
    request: Omit<MemoryQueryRequest, "callerScope"> & {
      callerScope?: unknown;
      _callerScope?: unknown;
    }
  ): BoundMemoryQueryRequest {
    const constraints = this.resolveQueryConstraints(
      trustedCallerScope,
      request.namespaces
    );
    const bound: BoundMemoryQueryRequest = {
      ...request,
      callerScope: constraints.callerScope,
      _callerScope: constraints._callerScope,
      namespaces: constraints.unrestricted
        ? undefined
        : constraints.allowedNamespaces
    };
    return bound;
  }
}

export class McpToolTimeoutError extends Error {
  readonly toolName: string;
  readonly timeoutMs: number;

  constructor(toolName: string, timeoutMs: number) {
    super(`MCP tool "${toolName}" timed out after ${timeoutMs}ms.`);
    this.name = "McpToolTimeoutError";
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Executes an MCP tool invocation bounded by an AbortController timeout circuit breaker.
 * Cleans up the timer handle in `finally` to prevent open-handle leaks.
 */
export async function withMcpTimeout<T>(
  toolName: string,
  fn: (signal: AbortSignal) => Promise<T> | T,
  timeoutMs: number = MCP_TOOL_TIMEOUT_MS
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(
      `Invalid MCP tool timeout (${timeoutMs}ms); expected positive finite number.`
    );
  }

  const controller = new AbortController();
  let timerId: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  const execution = Promise.resolve().then(() => fn(controller.signal));
  // Suppress late rejections after the timeout promise has already settled.
  execution.catch(() => undefined);

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timerId = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      const err = new McpToolTimeoutError(toolName, timeoutMs);
      controller.abort(err);
      reject(err);
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([execution, timeoutPromise]);
    settled = true;
    return result;
  } finally {
    settled = true;
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  }
}

/**
 * Stateful 60-second timeout circuit breaker wrapper for MCP tool executions.
 */
export class McpTimeoutBreaker {
  readonly defaultTimeoutMs: number;
  private activeCount = 0;
  private completedCount = 0;
  private timeoutCount = 0;
  private errorCount = 0;

  constructor(defaultTimeoutMs: number = MCP_TOOL_TIMEOUT_MS) {
    if (!Number.isFinite(defaultTimeoutMs) || defaultTimeoutMs <= 0) {
      throw new RangeError(
        `Invalid defaultTimeoutMs (${defaultTimeoutMs}); expected positive finite number.`
      );
    }
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  async run<T>(
    toolName: string,
    fn: (signal: AbortSignal) => Promise<T> | T,
    timeoutMs: number = this.defaultTimeoutMs
  ): Promise<T> {
    this.activeCount += 1;
    try {
      const result = await withMcpTimeout(toolName, fn, timeoutMs);
      this.completedCount += 1;
      return result;
    } catch (error) {
      if (error instanceof McpToolTimeoutError) {
        this.timeoutCount += 1;
      } else {
        this.errorCount += 1;
      }
      throw error;
    } finally {
      this.activeCount -= 1;
    }
  }

  getStats(): McpTimeoutBreakerStats {
    return {
      activeCount: this.activeCount,
      completedCount: this.completedCount,
      timeoutCount: this.timeoutCount,
      errorCount: this.errorCount
    };
  }
}
