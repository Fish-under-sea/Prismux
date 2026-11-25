export const DEFAULT_CHIEF_DISPLAY_NAME = "主秘书";
export const MAX_CHIEF_DISPLAY_NAME_LENGTH = 32;

export type ChiefMentionKind = "at-mention" | "direct-prefix" | "exact";

export interface ChiefMentionMatch {
  readonly matched: boolean;
  readonly kind: ChiefMentionKind | null;
  readonly matchedName: string | null;
  readonly strippedText: string;
}

/**
 * Normalizes a custom Chief Secretary display name (supports Chinese/English nicknames),
 * stripping control characters and falling back to `"主秘书"` when empty.
 */
export function normalizeChiefDisplayName(raw?: string | null): string {
  if (typeof raw !== "string") {
    return DEFAULT_CHIEF_DISPLAY_NAME;
  }
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) {
    return DEFAULT_CHIEF_DISPLAY_NAME;
  }
  return cleaned.slice(0, MAX_CHIEF_DISPLAY_NAME_LENGTH).trim() || DEFAULT_CHIEF_DISPLAY_NAME;
}

/**
 * Returns true when the user has customized the Chief Secretary name away from the default `"主秘书"`.
 */
export function isCustomChiefDisplayName(raw?: string | null): boolean {
  const normalized = normalizeChiefDisplayName(raw);
  return normalized.length > 0 && normalized !== DEFAULT_CHIEF_DISPLAY_NAME;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAsciiWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /^[A-Za-z0-9_]$/.test(ch);
}

function needsAsciiStartBoundary(name: string): boolean {
  return isAsciiWordChar(name[0]);
}

function needsAsciiEndBoundary(name: string): boolean {
  return isAsciiWordChar(name[name.length - 1]);
}

const DIRECT_PREFIX_PUNCTUATION = new Set([
  ",",
  "，",
  ":",
  "：",
  "!",
  "！",
  "?",
  "？",
  "、",
  "。",
  ";",
  "；",
  "-",
  "—",
]);

function isDirectPrefixSeparator(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return /\s/.test(ch) || DIRECT_PREFIX_PUNCTUATION.has(ch);
}

/**
 * Detects whether a chat message directly calls the Chief Secretary by their configured name
 * (e.g. `@猫猫 帮我总结`, `猫猫，今天有什么待办`, `Aria: review this PR`, or inline `麻烦 @小棱 记一下`).
 */
export function detectChiefMention(
  message: string,
  secretaryName?: string | null,
): ChiefMentionMatch {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return {
      matched: false,
      kind: null,
      matchedName: null,
      strippedText: "",
    };
  }

  const effectiveName = normalizeChiefDisplayName(secretaryName);
  const escaped = escapeRegExp(effectiveName);

  // 1. Exact call: "猫猫" or "@猫猫" (case-insensitive for ASCII nicknames)
  const exactRegex = new RegExp(`^[@＠]?${escaped}[\\s,，:：!！?？、。]*$`, "i");
  if (exactRegex.test(trimmed)) {
    return {
      matched: true,
      kind: trimmed.startsWith("@") || trimmed.startsWith("＠") ? "at-mention" : "exact",
      matchedName: effectiveName,
      strippedText: "",
    };
  }

  // 2. Leading @mention: "@猫猫 帮我..." or "@Aria, please..."
  const leadingAtRegex = new RegExp(`^[@＠](${escaped})`, "i");
  const leadingAtMatch = leadingAtRegex.exec(trimmed);
  if (leadingAtMatch) {
    const endIdx = leadingAtMatch[0].length;
    const nextChar = trimmed[endIdx];
    const boundaryOk =
      nextChar === undefined ||
      isDirectPrefixSeparator(nextChar) ||
      (!needsAsciiEndBoundary(effectiveName) && !isAsciiWordChar(nextChar));
    if (boundaryOk) {
      const remainder = trimmed
        .slice(endIdx)
        .replace(/^[\s,，:：!！?？、；;—-]+/, "")
        .trim();
      return {
        matched: true,
        kind: "at-mention",
        matchedName: effectiveName,
        strippedText: remainder,
      };
    }
  }

  // 3. Leading direct name call: "猫猫，帮我总结" / "小棱: 查记忆" / "Aria, check diff"
  const leadingDirectRegex = new RegExp(`^(${escaped})`, "i");
  const leadingDirectMatch = leadingDirectRegex.exec(trimmed);
  if (leadingDirectMatch) {
    const endIdx = leadingDirectMatch[0].length;
    const nextChar = trimmed[endIdx];
    if (isDirectPrefixSeparator(nextChar)) {
      const remainder = trimmed
        .slice(endIdx)
        .replace(/^[\s,，:：!！?？、；;—-]+/, "")
        .trim();
      return {
        matched: true,
        kind: "direct-prefix",
        matchedName: effectiveName,
        strippedText: remainder,
      };
    }
  }

  // 4. Inline @mention: "麻烦 @猫猫 帮我记录" / "please ask @Aria to summarize"
  const inlineAtRegex = new RegExp(`[@＠](${escaped})`, "gi");
  let match: RegExpExecArray | null = null;
  while ((match = inlineAtRegex.exec(trimmed)) !== null) {
    const beforeChar = match.index > 0 ? trimmed[match.index - 1] : undefined;
    const afterChar = trimmed[match.index + match[0].length];
    const beforeOk = beforeChar === undefined || !isAsciiWordChar(beforeChar);
    const afterOk =
      afterChar === undefined ||
      !needsAsciiEndBoundary(effectiveName) ||
      !isAsciiWordChar(afterChar);
    const startOk = !needsAsciiStartBoundary(effectiveName) || beforeOk;
    if (beforeOk && startOk && afterOk) {
      return {
        matched: true,
        kind: "at-mention",
        matchedName: effectiveName,
        strippedText: trimmed,
      };
    }
  }

  return {
    matched: false,
    kind: null,
    matchedName: null,
    strippedText: trimmed,
  };
}

/**
 * Strips a leading Chief call prefix (`@<name>` or `<name>，`) if present,
 * leaving the actionable user prompt cleanly formatted.
 */
export function stripChiefMentionPrefix(
  message: string,
  secretaryName?: string | null,
): string {
  const result = detectChiefMention(message, secretaryName);
  return result.matched ? result.strippedText : message.trim();
}
