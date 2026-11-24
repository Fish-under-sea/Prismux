import {
  defaultInstanceIdForDriver,
  PROVIDER_DISPLAY_NAMES,
  type ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";

const FULL_UUID_FRAGMENT_RE =
  /(?:^|(?<=[\s_:/-]))[0-9a-f]{8}[\s_-][0-9a-f]{4}[\s_-][0-9a-f]{4}[\s_-][0-9a-f]{4}[\s_-][0-9a-f]{12}(?=$|[\s_:/.,)…-])/gi;
const PARTIAL_UUID_FRAGMENT_RE =
  /(?:^|(?<=[\s_:/-]))[0-9a-f]{8}(?:[\s_-][0-9a-f]{4}){2,}(?:[\s_-][0-9a-f]{1,12})?(?:\.{3}|…)?(?=$|[\s_:/.,)…-])/gi;
const COMPACT_UUID_FRAGMENT_RE =
  /(?:^|(?<=[\s_:/-]))[0-9a-f]{32}(?=$|[\s_:/.,)…-])/gi;

function humanizeSlug(slug: string): string {
  return slug
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Returns true when a provider instance ID or display string contains a raw,
 * humanized, or truncated UUID sequence (e.g. `codex_048c43c3-0798-480e-bc42-...`
 * or `Codex 048c43c3 0798 480e Bc42 1...`).
 */
export function containsUuidNoise(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  FULL_UUID_FRAGMENT_RE.lastIndex = 0;
  if (FULL_UUID_FRAGMENT_RE.test(value)) return true;
  PARTIAL_UUID_FRAGMENT_RE.lastIndex = 0;
  if (PARTIAL_UUID_FRAGMENT_RE.test(value)) return true;
  COMPACT_UUID_FRAGMENT_RE.lastIndex = 0;
  return COMPACT_UUID_FRAGMENT_RE.test(value);
}

/**
 * Strips raw, humanized, or truncated UUID noise from a provider string while
 * preserving any meaningful human prefix/suffix.
 */
export function stripUuidNoise(value: string): string {
  return value
    .replace(FULL_UUID_FRAGMENT_RE, " ")
    .replace(PARTIAL_UUID_FRAGMENT_RE, " ")
    .replace(COMPACT_UUID_FRAGMENT_RE, " ")
    .replace(/[\s_:/-]+(?:\.{3}|…)\s*$/g, "")
    .replace(/^[\s_:/-]+|[\s_:/-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveProviderInstanceDisplayName(
  snapshot: Pick<ServerProvider, "instanceId" | "driver" | "displayName">,
): string {
  const trimmedSnapshotName = snapshot.displayName?.trim();
  const kindLabel = PROVIDER_DISPLAY_NAMES[snapshot.driver] ?? humanizeSlug(snapshot.driver);
  if (trimmedSnapshotName) {
    if (!containsUuidNoise(trimmedSnapshotName)) {
      return trimmedSnapshotName;
    }
    const cleanedName = stripUuidNoise(trimmedSnapshotName);
    if (cleanedName.length > 0) {
      return cleanedName;
    }
    return kindLabel;
  }
  if (snapshot.instanceId !== defaultInstanceIdForDriver(snapshot.driver)) {
    if (containsUuidNoise(snapshot.instanceId)) {
      return kindLabel;
    }
    const humanized = humanizeSlug(snapshot.instanceId);
    if (humanized.length > 0) return humanized;
  }
  return kindLabel;
}

export interface DisambiguatableProviderDisplayEntry {
  readonly instanceId: string;
  readonly driverKind: ProviderDriverKind | string;
  readonly displayName: string;
  readonly isDefault?: boolean | undefined;
  readonly enabled?: boolean | undefined;
  readonly hasCustomDisplayName?: boolean | undefined;
}

/**
 * Ensures multiple unnamed instances sharing the same driver/display name are
 * distinguished with minimal numbering (`Codex`, `Codex (2)`, `Codex (3)`)
 * without ever leaking UUID instance IDs.
 */
export function disambiguateProviderInstanceDisplayNames<
  T extends DisambiguatableProviderDisplayEntry,
>(entries: ReadonlyArray<T>): ReadonlyArray<T> {
  if (entries.length <= 1) return entries;

  const usedLabelsByDriver = new Map<string, Set<string>>();
  const unnamedGroups = new Map<string, number[]>();

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const driverKey = String(entry.driverKind);
    const labelKey = entry.displayName.trim().toLowerCase();
    let used = usedLabelsByDriver.get(driverKey);
    if (!used) {
      used = new Set<string>();
      usedLabelsByDriver.set(driverKey, used);
    }
    if (entry.hasCustomDisplayName) {
      used.add(labelKey);
      continue;
    }
    // Scope duplicate numbering by enabled state so a disabled sibling never forces "(2)" on the sole enabled instance.
    const scopeKey = `${driverKey}\u0000${entry.enabled === false ? "off" : "on"}\u0000${labelKey}`;
    const indices = unnamedGroups.get(scopeKey);
    if (indices) {
      indices.push(index);
    } else {
      unnamedGroups.set(scopeKey, [index]);
    }
  }

  let updated: T[] | null = null;
  for (const indices of unnamedGroups.values()) {
    const first = entries[indices[0]!]!;
    const driverKey = String(first.driverKind);
    const baseLabel = first.displayName.trim();
    const baseKey = baseLabel.toLowerCase();
    const used = usedLabelsByDriver.get(driverKey) ?? new Set<string>();

    // Prefer keeping the bare brand label on the default instance if present.
    const ordered = [...indices].sort((a, b) => {
      const aDefault = entries[a]!.isDefault ? 0 : 1;
      const bDefault = entries[b]!.isDefault ? 0 : 1;
      return aDefault - bDefault || a - b;
    });

    for (let pos = 0; pos < ordered.length; pos += 1) {
      const idx = ordered[pos]!;
      if (pos === 0 && !used.has(baseKey)) {
        used.add(baseKey);
        continue;
      }
      let seq = 2;
      while (used.has(`${baseLabel} (${seq})`.toLowerCase())) {
        seq += 1;
      }
      const nextLabel = `${baseLabel} (${seq})`;
      used.add(nextLabel.toLowerCase());
      if (!updated) {
        updated = [...entries];
      }
      updated[idx] = { ...entries[idx]!, displayName: nextLabel };
    }
  }

  return updated ?? entries;
}

export function providerInstanceInitials(label: string): string {
  // Punctuation separates words so "Codex (hub)" reads CH, not C(. An apostrophe
  // inside a word stays ("Theo's Codex" is TC); a quoting one does not
  // ("Codex 'hub'" is CH). A single camel-case word splits at its humps, so
  // "ClaudeProx" is CP, but "ClaudeProx Work" keeps its own words and is CW.
  const toWords = (text: string) =>
    text
      .split(/\s+/u)
      .map((word) => word.replace(/^['’]+|['’]+$/gu, ""))
      .filter(Boolean);
  let words = toWords(label.replace(/[^\P{P}'’]+/gu, " "));
  if (words.length === 1) words = toWords(words[0]!.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2"));
  if (words.length === 0) return "";
  if (words.length === 1) return Array.from(words[0]!).slice(0, 2).join("").toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? "")
    .join("");
}

export function normalizeProviderAccentColor(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^#[0-9a-fA-F]{6}$/u.test(trimmed) ? trimmed : undefined;
}

export function providerAccentForegroundColor(accentColor: string) {
  const linearChannel = (offset: number) => {
    const value = Number.parseInt(accentColor.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * linearChannel(1) + 0.7152 * linearChannel(3) + 0.0722 * linearChannel(5);
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}

export function shouldShowInstanceBadge(
  entry: {
    readonly driverKind: ProviderDriverKind;
    readonly accentColor?: string | undefined;
    readonly acpRegistryAgentId?: string | undefined;
    readonly enabled: boolean;
  },
  entries: Iterable<{
    readonly driverKind: ProviderDriverKind;
    readonly acpRegistryAgentId?: string | undefined;
    readonly enabled: boolean;
  }>,
): boolean {
  if (normalizeProviderAccentColor(entry.accentColor)) return true;
  let sharedProviderCount = 0;
  for (const candidate of entries) {
    if (candidate.driverKind !== entry.driverKind) continue;
    // Historical threads still need to distinguish accounts that are all disabled.
    if (entry.enabled && !candidate.enabled) continue;
    if (
      entry.driverKind === "acpRegistry" &&
      candidate.acpRegistryAgentId !== entry.acpRegistryAgentId
    ) {
      continue;
    }
    if (++sharedProviderCount > 1) return true;
  }
  return false;
}
