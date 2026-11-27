const FENCED_CODE_SPLIT_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

/**
 * Single-pass combined pattern for technical tokens inside prose.
 * Order matters: inline code spans and URLs must match before path/filename heuristics.
 */
const TECHNICAL_TOKEN_RE = new RegExp(
  [
    // Inline code spans: `...`
    "`[^`\\n]+`",
    // HTTP(S) URLs
    "https?:\\/\\/[^\\s<>\\)\\]`'\"]+",
    // Windows absolute paths (e.g. C:\foo\bar.ts or D:/foo/bar)
    "\\b[A-Za-z]:[\\\\/][^\\s'\"`\\)\\],;]+",
    // POSIX / home / relative paths (~/..., ./..., ../..., /usr/bin, a/b/c.ts, dir/file.ts)
    "(?:~\\/|\\.\\.?\\/|\\/)[A-Za-z0-9._\\/@-]+",
    "\\b[A-Za-z0-9._-]+(?:\\/[A-Za-z0-9._-]+){2,}",
    "\\b[A-Za-z0-9._-]+\\/[A-Za-z0-9._-]+\\.[A-Za-z0-9]{1,8}\\b",
    // Source / config filenames (e.g. settings.ts, package.json)
    "\\b[A-Za-z0-9_-]+\\.(?:tsx?|jsx?|mjs|cjs|json|css|scss|html|md|yml|yaml|toml|rs|py|go|sh|ps1|sql|env|lock|txt|wasm|bin|spm)\\b",
  ].join("|"),
  "gi",
);

const PLACEHOLDER_RESTORE_RE = /PMX\s*0*(\d+)\s*Z/gi;
const MARKDOWN_LINE_PREFIX_RE = /^(\s*(?:(?:>\s*)*)(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+)?)(.*)$/;
const LATIN_WORD_RE = /[A-Za-z]{2,}/;

export interface MaskedProse {
  readonly maskedText: string;
  readonly tokens: ReadonlyArray<string>;
}

export interface TextSegment {
  readonly kind: "code" | "prose";
  readonly text: string;
}

export function splitFencedCodeSegments(text: string): ReadonlyArray<TextSegment> {
  if (text.length === 0) return [];
  const parts = text.split(FENCED_CODE_SPLIT_RE);
  const segments: TextSegment[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;
    // Odd indices from capturing split are fenced code blocks.
    segments.push({
      kind: index % 2 === 1 ? "code" : "prose",
      text: part,
    });
  }
  return segments;
}

export function maskTechnicalTokens(text: string): MaskedProse {
  const tokens: string[] = [];
  const maskedText = text.replace(TECHNICAL_TOKEN_RE, (match) => {
    const index = tokens.length;
    tokens.push(match);
    return `PMX${String(index).padStart(3, "0")}Z`;
  });
  return { maskedText, tokens };
}

export function restoreTechnicalTokens(text: string, tokens: ReadonlyArray<string>): string {
  if (tokens.length === 0) return text;
  return text.replace(PLACEHOLDER_RESTORE_RE, (fullMatch, rawIndex: string) => {
    const index = Number.parseInt(rawIndex, 10);
    if (!Number.isInteger(index) || index < 0 || index >= tokens.length) {
      return fullMatch;
    }
    return tokens[index]!;
  });
}

export interface TranslatableLinePart {
  readonly prefix: string;
  readonly maskedBody: string;
  readonly tokens: ReadonlyArray<string>;
  readonly needsTranslation: boolean;
  readonly originalLine: string;
}

export function prepareProseLines(prose: string): ReadonlyArray<TranslatableLinePart> {
  return prose.split("\n").map((line) => {
    if (line.trim().length === 0) {
      return {
        prefix: "",
        maskedBody: line,
        tokens: [],
        needsTranslation: false,
        originalLine: line,
      };
    }
    const match = MARKDOWN_LINE_PREFIX_RE.exec(line);
    const prefix = match?.[1] ?? "";
    const body = match?.[2] ?? line;
    if (body.trim().length === 0) {
      return {
        prefix,
        maskedBody: body,
        tokens: [],
        needsTranslation: false,
        originalLine: line,
      };
    }
    const { maskedText, tokens } = maskTechnicalTokens(body);
    // Strip our own placeholders to decide if any translatable Latin prose remains.
    const withoutPlaceholders = maskedText.replace(PLACEHOLDER_RESTORE_RE, " ");
    const needsTranslation = LATIN_WORD_RE.test(withoutPlaceholders);
    return {
      prefix,
      maskedBody: maskedText,
      tokens,
      needsTranslation,
      originalLine: line,
    };
  });
}

export async function translateWithTechnicalTokenProtection(
  text: string,
  translateBatch: (inputs: ReadonlyArray<string>) => Promise<ReadonlyArray<string>>,
): Promise<string> {
  const segments = splitFencedCodeSegments(text);
  const preparedBySegment = segments.map((segment) =>
    segment.kind === "code" ? null : prepareProseLines(segment.text),
  );

  const batchInputs: string[] = [];
  const batchTargets: Array<{ readonly segmentIndex: number; readonly lineIndex: number }> = [];

  for (let segmentIndex = 0; segmentIndex < preparedBySegment.length; segmentIndex += 1) {
    const lines = preparedBySegment[segmentIndex];
    if (!lines) continue;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex]!;
      if (!line.needsTranslation) continue;
      batchInputs.push(line.maskedBody);
      batchTargets.push({ segmentIndex, lineIndex });
    }
  }

  if (batchInputs.length === 0) {
    return text;
  }

  const translatedBatch = await translateBatch(batchInputs);
  if (translatedBatch.length !== batchInputs.length) {
    throw new Error(
      `Translation engine returned ${translatedBatch.length} segments for ${batchInputs.length} inputs.`,
    );
  }

  const translatedMap = new Map<string, string>();
  for (let index = 0; index < batchTargets.length; index += 1) {
    const target = batchTargets[index]!;
    translatedMap.set(`${target.segmentIndex}:${target.lineIndex}`, translatedBatch[index]!);
  }

  return segments
    .map((segment, segmentIndex) => {
      if (segment.kind === "code") return segment.text;
      const lines = preparedBySegment[segmentIndex]!;
      return lines
        .map((line, lineIndex) => {
          if (!line.needsTranslation) return line.originalLine;
          const translatedMasked =
            translatedMap.get(`${segmentIndex}:${lineIndex}`) ?? line.maskedBody;
          const restored = restoreTechnicalTokens(translatedMasked, line.tokens);
          return `${line.prefix}${restored}`;
        })
        .join("\n");
    })
    .join("");
}
