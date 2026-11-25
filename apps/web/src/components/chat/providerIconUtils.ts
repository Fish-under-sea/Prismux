import type { ProviderDriverKind } from "@prismux/core-contracts";
import { resolveModelShortName } from "@prismux/client-runtime/provider-clients";
import { formatModelSlugName } from "@prismux/core-shared/model";

export type ModelEsque = {
  slug: string;
  name: string;
  shortName?: string | undefined;
  subProvider?: string | undefined;
  aliases?: ReadonlyArray<string> | undefined;
  isDefault?: boolean | undefined;
  badge?: "new" | undefined;
  isLegacy?: boolean | undefined;
  isUnavailable?: boolean | undefined;
};

const RAW_LOWERCASE_SLUG_RE = /^[a-z0-9]+(?:[-_./][a-z0-9.]+)+$/;
const PRESERVED_LOWERCASE_TOKENS = new Set(["o1", "o3", "o4"]);
const UPPERCASE_MODEL_TOKENS = new Set(["gpt", "oss", "glm", "ai", "api", "cli", "swe"]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLeadingQualifier(value: string, qualifier: string | null | undefined): string {
  const trimmedQualifier = qualifier?.trim();
  if (!trimmedQualifier) {
    return value;
  }

  const pattern = new RegExp(`^${escapeRegExp(trimmedQualifier)}(?:\\s*[.:/-]\\s*|\\s+)`, "iu");
  return value.replace(pattern, "").trim() || value;
}

function normalizeTriggerShortToken(token: string): string {
  if (!token) return token;
  const lower = token.toLowerCase();
  if (PRESERVED_LOWERCASE_TOKENS.has(lower)) {
    return lower;
  }
  if (UPPERCASE_MODEL_TOKENS.has(lower)) {
    return lower.toUpperCase();
  }
  if (/^\d/.test(token)) {
    return token;
  }
  if (/^[a-z]/.test(token)) {
    return token.charAt(0).toUpperCase() + token.slice(1);
  }
  return token;
}

function normalizeTriggerDisplayCandidate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const slugFormatted = formatModelSlugName(trimmed) || trimmed;
  // Handle residual hyphenated version-plus-codename strings (e.g. "6.2-Astra", "6.2-astra")
  // or stripped lowercase words (e.g. "4 neon") so no raw lowercase slug ever reaches the trigger.
  const separated = slugFormatted.replace(/^(\d+(?:\.\d+)?)[-_]+([a-zA-Z])/, "$1 $2");
  if (/^[a-z0-9.]+(?:[-_][a-z0-9.]+)+$/i.test(separated) && !/^GPT-\d/i.test(separated) && !/^GPT-OSS/i.test(separated)) {
    return separated
      .split(/[-_]+/)
      .filter(Boolean)
      .map(normalizeTriggerShortToken)
      .join(" ");
  }

  return separated
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeTriggerShortToken)
    .join(" ");
}

export function getDisplayModelName(
  model: ModelEsque,
  options?: { preferShortName?: boolean },
): string {
  const rawName = options?.preferShortName && model.shortName ? model.shortName : model.name;
  const stripped = stripLeadingQualifier(rawName, model.subProvider).trim();
  if (!stripped) {
    return formatModelSlugName(model.slug) || model.slug;
  }
  if (options?.preferShortName) {
    return normalizeTriggerDisplayCandidate(stripped);
  }
  if (RAW_LOWERCASE_SLUG_RE.test(stripped)) {
    return formatModelSlugName(stripped) || stripped;
  }
  return stripped;
}

export function getTriggerDisplayModelName(
  model: ModelEsque,
  driverKind: ProviderDriverKind | null | undefined,
): string {
  const strippedName = stripLeadingQualifier(model.name, model.subProvider).trim();
  const strippedShort = model.shortName
    ? stripLeadingQualifier(model.shortName, model.subProvider).trim()
    : undefined;
  const normalizedInputName = strippedName
    ? formatModelSlugName(strippedName) || strippedName
    : formatModelSlugName(model.slug) || model.slug;
  const shortName = resolveModelShortName(
    {
      name: normalizedInputName,
      slug: model.slug,
      ...(strippedShort ? { shortName: formatModelSlugName(strippedShort) || strippedShort } : {}),
    },
    driverKind,
  );
  const candidate = shortName
    ? stripLeadingQualifier(shortName, model.subProvider)
    : normalizedInputName;
  return normalizeTriggerDisplayCandidate(candidate);
}
