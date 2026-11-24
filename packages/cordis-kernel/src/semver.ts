import type { PluginPackageEngines } from "@prismux/protocol";

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly (number | string)[];
  build: readonly string[];
  raw: string;
}

export interface EngineCompatibilityResult {
  compatible: boolean;
  requiredRange: string;
  hostVersion: string;
  reason?: string;
}

type ComparatorOperator = "=" | ">" | ">=" | "<" | "<=";

interface PrimitiveComparator {
  op: ComparatorOperator;
  version: ParsedSemver;
  allowPrereleaseOnTuple: boolean;
}

type ComparatorSet = readonly PrimitiveComparator[];

const STRICT_SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const PARTIAL_SEMVER_RE =
  /^([0-9A-Za-z*]+)(?:\.([0-9A-Za-z*]+)(?:\.([0-9A-Za-z*]+))?)?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const NON_NEGATIVE_INT_RE = /^(0|[1-9]\d*)$/;

function isWildcardSegment(segment: string | undefined): boolean {
  return (
    segment === undefined ||
    segment === "*" ||
    segment === "x" ||
    segment === "X"
  );
}

function parseNumericSegment(segment: string): number | null {
  if (!NON_NEGATIVE_INT_RE.test(segment)) {
    return null;
  }
  const value = Number.parseInt(segment, 10);
  return Number.isSafeInteger(value) ? value : null;
}

function parsePrereleaseIdentifiers(
  rawPre: string | undefined
): readonly (number | string)[] | null {
  if (rawPre === undefined) {
    return [];
  }
  const parts = rawPre.split(".");
  const parsed: (number | string)[] = [];
  for (const part of parts) {
    if (part.length === 0) {
      return null;
    }
    if (/^\d+$/.test(part)) {
      if (part.length > 1 && part.startsWith("0")) {
        // SemVer 2.0 forbids leading zeroes in numeric prerelease identifiers.
        return null;
      }
      const num = Number.parseInt(part, 10);
      parsed.push(Number.isSafeInteger(num) ? num : part);
    } else {
      parsed.push(part);
    }
  }
  return parsed;
}

/**
 * Parses a strict SemVer 2.0 version string (`MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]`).
 */
export function parseSemver(input: string): ParsedSemver | null {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim();
  const match = STRICT_SEMVER_RE.exec(trimmed);
  if (match === null) {
    return null;
  }

  const majorStr = match[1];
  const minorStr = match[2];
  const patchStr = match[3];
  if (
    majorStr === undefined ||
    minorStr === undefined ||
    patchStr === undefined
  ) {
    return null;
  }

  const major = parseNumericSegment(majorStr);
  const minor = parseNumericSegment(minorStr);
  const patch = parseNumericSegment(patchStr);
  if (major === null || minor === null || patch === null) {
    return null;
  }

  const prerelease = parsePrereleaseIdentifiers(match[4]);
  if (prerelease === null) {
    return null;
  }

  const build = match[5] !== undefined ? match[5].split(".") : [];
  if (build.some((segment) => segment.length === 0)) {
    return null;
  }

  return {
    major,
    minor,
    patch,
    prerelease,
    build,
    raw: trimmed
  };
}

export function isValidSemver(version: string): boolean {
  return parseSemver(version) !== null;
}

function compareParsedSemver(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) {
    return a.major < b.major ? -1 : 1;
  }
  if (a.minor !== b.minor) {
    return a.minor < b.minor ? -1 : 1;
  }
  if (a.patch !== b.patch) {
    return a.patch < b.patch ? -1 : 1;
  }

  const preA = a.prerelease;
  const preB = b.prerelease;
  if (preA.length === 0 && preB.length === 0) {
    return 0;
  }
  if (preA.length === 0) {
    return 1;
  }
  if (preB.length === 0) {
    return -1;
  }

  const len = Math.min(preA.length, preB.length);
  for (let i = 0; i < len; i += 1) {
    const idA = preA[i]!;
    const idB = preB[i]!;
    if (idA === idB) {
      continue;
    }
    const isNumA = typeof idA === "number";
    const isNumB = typeof idB === "number";
    if (isNumA && isNumB) {
      return idA < idB ? -1 : 1;
    }
    if (isNumA) {
      return -1;
    }
    if (isNumB) {
      return 1;
    }
    return idA < idB ? -1 : 1;
  }

  if (preA.length === preB.length) {
    return 0;
  }
  return preA.length < preB.length ? -1 : 1;
}

/**
 * Compares two SemVer 2.0 strings (`-1`, `0`, `1`). Build metadata is ignored per spec.
 */
export function compareSemver(
  a: string | ParsedSemver,
  b: string | ParsedSemver
): number {
  const parsedA = typeof a === "string" ? parseSemver(a) : a;
  const parsedB = typeof b === "string" ? parseSemver(b) : b;
  if (parsedA === null) {
    throw new Error(`Invalid SemVer 2.0 version: "${String(a)}"`);
  }
  if (parsedB === null) {
    throw new Error(`Invalid SemVer 2.0 version: "${String(b)}"`);
  }
  return compareParsedSemver(parsedA, parsedB);
}

interface PartialVersion {
  major: number | null; // null means wildcard (* / x)
  minor: number | null;
  patch: number | null;
  prerelease: readonly (number | string)[];
  hasPrerelease: boolean;
}

function makeVersion(
  major: number,
  minor: number,
  patch: number,
  prerelease: readonly (number | string)[] = []
): ParsedSemver {
  const preStr = prerelease.length > 0 ? `-${prerelease.join(".")}` : "";
  return {
    major,
    minor,
    patch,
    prerelease,
    build: [],
    raw: `${major}.${minor}.${patch}${preStr}`
  };
}

function parsePartialVersion(raw: string): PartialVersion | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const match = PARTIAL_SEMVER_RE.exec(trimmed);
  if (match === null) {
    return null;
  }

  const rawMajor = match[1];
  const rawMinor = match[2];
  const rawPatch = match[3];
  const rawPre = match[4];
  const rawBuild = match[5];

  if (rawBuild !== undefined && rawBuild.split(".").some((s) => s.length === 0)) {
    return null;
  }

  let major: number | null = null;
  if (!isWildcardSegment(rawMajor)) {
    major = parseNumericSegment(rawMajor!);
    if (major === null) {
      return null;
    }
  }

  let minor: number | null = null;
  if (!isWildcardSegment(rawMinor)) {
    if (major === null) {
      return null;
    }
    minor = parseNumericSegment(rawMinor!);
    if (minor === null) {
      return null;
    }
  }

  let patch: number | null = null;
  if (!isWildcardSegment(rawPatch)) {
    if (major === null || minor === null) {
      return null;
    }
    patch = parseNumericSegment(rawPatch!);
    if (patch === null) {
      return null;
    }
  }

  if (rawPre !== undefined && (major === null || minor === null || patch === null)) {
    return null;
  }

  const prerelease = parsePrereleaseIdentifiers(rawPre);
  if (prerelease === null) {
    return null;
  }

  return {
    major,
    minor,
    patch,
    prerelease,
    hasPrerelease: rawPre !== undefined
  };
}

function expandCaret(pv: PartialVersion): PrimitiveComparator[] {
  if (pv.major === null) {
    return [
      {
        op: ">=",
        version: makeVersion(0, 0, 0),
        allowPrereleaseOnTuple: false
      }
    ];
  }
  if (pv.minor === null) {
    const upperMajor = pv.major + 1;
    return [
      {
        op: ">=",
        version: makeVersion(pv.major, 0, 0),
        allowPrereleaseOnTuple: false
      },
      {
        op: "<",
        version: makeVersion(upperMajor, 0, 0, [0]),
        allowPrereleaseOnTuple: false
      }
    ];
  }
  if (pv.patch === null) {
    const upper =
      pv.major === 0
        ? makeVersion(0, pv.minor + 1, 0, [0])
        : makeVersion(pv.major + 1, 0, 0, [0]);
    return [
      {
        op: ">=",
        version: makeVersion(pv.major, pv.minor, 0),
        allowPrereleaseOnTuple: false
      },
      {
        op: "<",
        version: upper,
        allowPrereleaseOnTuple: false
      }
    ];
  }

  let upper: ParsedSemver;
  if (pv.major > 0) {
    upper = makeVersion(pv.major + 1, 0, 0, [0]);
  } else if (pv.minor > 0) {
    upper = makeVersion(0, pv.minor + 1, 0, [0]);
  } else {
    upper = makeVersion(0, 0, pv.patch + 1, [0]);
  }

  return [
    {
      op: ">=",
      version: makeVersion(pv.major, pv.minor, pv.patch, pv.prerelease),
      allowPrereleaseOnTuple: pv.hasPrerelease
    },
    {
      op: "<",
      version: upper,
      allowPrereleaseOnTuple: false
    }
  ];
}

function expandTilde(pv: PartialVersion): PrimitiveComparator[] {
  if (pv.major === null) {
    return [
      {
        op: ">=",
        version: makeVersion(0, 0, 0),
        allowPrereleaseOnTuple: false
      }
    ];
  }
  if (pv.minor === null) {
    return [
      {
        op: ">=",
        version: makeVersion(pv.major, 0, 0),
        allowPrereleaseOnTuple: false
      },
      {
        op: "<",
        version: makeVersion(pv.major + 1, 0, 0, [0]),
        allowPrereleaseOnTuple: false
      }
    ];
  }
  if (pv.patch === null) {
    return [
      {
        op: ">=",
        version: makeVersion(pv.major, pv.minor, 0),
        allowPrereleaseOnTuple: false
      },
      {
        op: "<",
        version: makeVersion(pv.major, pv.minor + 1, 0, [0]),
        allowPrereleaseOnTuple: false
      }
    ];
  }

  return [
    {
      op: ">=",
      version: makeVersion(pv.major, pv.minor, pv.patch, pv.prerelease),
      allowPrereleaseOnTuple: pv.hasPrerelease
    },
    {
      op: "<",
      version: makeVersion(pv.major, pv.minor + 1, 0, [0]),
      allowPrereleaseOnTuple: false
    }
  ];
}

function expandPrimitiveOrWildcard(
  op: ComparatorOperator | "",
  pv: PartialVersion
): PrimitiveComparator[] | null {
  if (pv.major === null) {
    if (op === "" || op === "=" || op === ">=") {
      return [
        {
          op: ">=",
          version: makeVersion(0, 0, 0),
          allowPrereleaseOnTuple: false
        }
      ];
    }
    if (op === "<=") {
      return [
        {
          op: ">=",
          version: makeVersion(0, 0, 0),
          allowPrereleaseOnTuple: false
        }
      ];
    }
    if (op === ">" || op === "<") {
      // Nothing satisfies `<0.0.0` or `>*`; treat `<*` as unsatisfiable.
      return [
        {
          op: "<",
          version: makeVersion(0, 0, 0, [0]),
          allowPrereleaseOnTuple: false
        }
      ];
    }
    return null;
  }

  const isPartial = pv.minor === null || pv.patch === null;
  if (!isPartial) {
    const resolvedOp: ComparatorOperator = op === "" ? "=" : op;
    return [
      {
        op: resolvedOp,
        version: makeVersion(pv.major, pv.minor!, pv.patch!, pv.prerelease),
        allowPrereleaseOnTuple: pv.hasPrerelease
      }
    ];
  }

  // Partial or x-range expansion
  if (op === "" || op === "=") {
    if (pv.minor === null) {
      return [
        {
          op: ">=",
          version: makeVersion(pv.major, 0, 0),
          allowPrereleaseOnTuple: false
        },
        {
          op: "<",
          version: makeVersion(pv.major + 1, 0, 0, [0]),
          allowPrereleaseOnTuple: false
        }
      ];
    }
    return [
      {
        op: ">=",
        version: makeVersion(pv.major, pv.minor, 0),
        allowPrereleaseOnTuple: false
      },
      {
        op: "<",
        version: makeVersion(pv.major, pv.minor + 1, 0, [0]),
        allowPrereleaseOnTuple: false
      }
    ];
  }

  if (op === ">=") {
    return [
      {
        op: ">=",
        version: makeVersion(pv.major, pv.minor ?? 0, 0),
        allowPrereleaseOnTuple: false
      }
    ];
  }

  if (op === ">") {
    const target =
      pv.minor === null
        ? makeVersion(pv.major + 1, 0, 0, [0])
        : makeVersion(pv.major, pv.minor + 1, 0, [0]);
    return [
      {
        op: ">=",
        version: target,
        allowPrereleaseOnTuple: false
      }
    ];
  }

  if (op === "<") {
    return [
      {
        op: "<",
        version: makeVersion(pv.major, pv.minor ?? 0, 0, [0]),
        allowPrereleaseOnTuple: false
      }
    ];
  }

  // op === "<="
  const upper =
    pv.minor === null
      ? makeVersion(pv.major + 1, 0, 0, [0])
      : makeVersion(pv.major, pv.minor + 1, 0, [0]);
  return [
    {
      op: "<",
      version: upper,
      allowPrereleaseOnTuple: false
    }
  ];
}

function parseHyphenBounds(
  leftRaw: string,
  rightRaw: string
): PrimitiveComparator[] | null {
  const left = parsePartialVersion(leftRaw);
  const right = parsePartialVersion(rightRaw);
  if (left === null || right === null) {
    return null;
  }

  const comparators: PrimitiveComparator[] = [];
  if (left.major === null) {
    comparators.push({
      op: ">=",
      version: makeVersion(0, 0, 0),
      allowPrereleaseOnTuple: false
    });
  } else {
    comparators.push({
      op: ">=",
      version: makeVersion(
        left.major,
        left.minor ?? 0,
        left.patch ?? 0,
        left.prerelease
      ),
      allowPrereleaseOnTuple: left.hasPrerelease
    });
  }

  if (right.major !== null) {
    if (right.minor === null) {
      comparators.push({
        op: "<",
        version: makeVersion(right.major + 1, 0, 0, [0]),
        allowPrereleaseOnTuple: false
      });
    } else if (right.patch === null) {
      comparators.push({
        op: "<",
        version: makeVersion(right.major, right.minor + 1, 0, [0]),
        allowPrereleaseOnTuple: false
      });
    } else {
      comparators.push({
        op: "<=",
        version: makeVersion(
          right.major,
          right.minor,
          right.patch,
          right.prerelease
        ),
        allowPrereleaseOnTuple: right.hasPrerelease
      });
    }
  }

  return comparators;
}

function parseComparatorToken(token: string): PrimitiveComparator[] | null {
  const match = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(token);
  if (match === null) {
    return null;
  }
  const op = match[1] ?? "";
  const versionRaw = match[2];
  if (versionRaw === undefined || versionRaw.length === 0) {
    return null;
  }

  const pv = parsePartialVersion(versionRaw);
  if (pv === null) {
    return null;
  }

  if (op === "^") {
    return expandCaret(pv);
  }
  if (op === "~") {
    return expandTilde(pv);
  }
  return expandPrimitiveOrWildcard(op as ComparatorOperator | "", pv);
}

function parseComparatorSet(branchRaw: string): ComparatorSet | null {
  const trimmed = branchRaw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Handle hyphen range syntax: `A - B`
  const hyphenParts = trimmed.split(/\s+-\s+/);
  if (hyphenParts.length === 2) {
    return parseHyphenBounds(hyphenParts[0]!, hyphenParts[1]!);
  }
  if (hyphenParts.length > 2) {
    return null;
  }

  // Normalize spaces between operators and versions, e.g. `>= 1.0.0 < 2.0.0` -> `>=1.0.0 <2.0.0`
  const normalized = trimmed.replace(/(>=|<=|>|<|=|\^|~)\s+(?=\S)/g, "$1");
  const tokens = normalized.split(/\s+/);
  const comparators: PrimitiveComparator[] = [];

  for (const token of tokens) {
    if (token.length === 0) {
      continue;
    }
    const expanded = parseComparatorToken(token);
    if (expanded === null) {
      return null;
    }
    comparators.push(...expanded);
  }

  return comparators.length > 0 ? comparators : null;
}

export function validateSemverRange(
  range: string
):
  | { valid: true; sets: readonly ComparatorSet[] }
  | { valid: false; reason: string } {
  if (typeof range !== "string" || range.trim().length === 0) {
    return { valid: false, reason: "SemVer range must be a non-empty string." };
  }

  const rawBranches = range.split("||");
  const sets: ComparatorSet[] = [];
  for (const branch of rawBranches) {
    const parsedSet = parseComparatorSet(branch);
    if (parsedSet === null) {
      return {
        valid: false,
        reason: `Invalid SemVer range syntax: "${range}".`
      };
    }
    sets.push(parsedSet);
  }

  return { valid: true, sets };
}

export function isValidSemverRange(range: string): boolean {
  return validateSemverRange(range).valid;
}

function matchesPrimitiveComparator(
  version: ParsedSemver,
  comp: PrimitiveComparator
): boolean {
  const cmp = compareParsedSemver(version, comp.version);
  switch (comp.op) {
    case "=":
      return cmp === 0;
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
  }
}

function matchesComparatorSet(
  version: ParsedSemver,
  set: ComparatorSet,
  options?: { includePrerelease?: boolean }
): boolean {
  for (const comp of set) {
    if (!matchesPrimitiveComparator(version, comp)) {
      return false;
    }
  }

  if (version.prerelease.length > 0) {
    const hasMatchingTuplePrerelease = set.some(
      (comp) =>
        comp.allowPrereleaseOnTuple &&
        comp.version.major === version.major &&
        comp.version.minor === version.minor &&
        comp.version.patch === version.patch
    );
    if (hasMatchingTuplePrerelease) {
      return true;
    }

    // Never allow a prerelease of an excluded upper-bound tuple (e.g. `2.0.0-alpha.1`
    // against `<2.0.0`) unless a comparator explicitly opted into that exact tuple.
    const isBlockedByExclusiveUpperBound = set.some(
      (comp) =>
        comp.op === "<" &&
        !comp.allowPrereleaseOnTuple &&
        comp.version.major === version.major &&
        comp.version.minor === version.minor &&
        comp.version.patch === version.patch
    );
    if (isBlockedByExclusiveUpperBound) {
      return false;
    }

    if (options?.includePrerelease === true) {
      return true;
    }

    // Allow prerelease versions across subsequent patch/minor tuples when a lower bound
    // explicitly opted into prereleases (e.g. `>=0.1.0-0 <2.0.0` matching `0.1.2-preview.2`).
    const hasLowerBoundPrereleaseOptIn = set.some(
      (comp) =>
        comp.allowPrereleaseOnTuple &&
        (comp.op === ">=" || comp.op === ">")
    );
    if (!hasLowerBoundPrereleaseOptIn) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluates whether a SemVer 2.0 `version` satisfies a SemVer range (`>=`, `>`, `<=`, `=`, `<`, `^`, `~`, `*`,
 * whitespace AND intersection, `||` OR union, hyphen ranges, and prerelease comparisons).
 */
export function satisfiesSemverRange(
  version: string,
  range: string,
  options?: { includePrerelease?: boolean }
): boolean {
  const parsedVersion = parseSemver(version);
  if (parsedVersion === null) {
    return false;
  }
  const parsedRange = validateSemverRange(range);
  if (!parsedRange.valid) {
    return false;
  }
  return parsedRange.sets.some((set) =>
    matchesComparatorSet(parsedVersion, set, options)
  );
}

/**
 * Validates top-level `engines.prismux` SemVer compatibility.
 * Never falls back to `peerDependencies`.
 */
export function checkTopLevelEngineCompatibility(
  engines: Partial<PluginPackageEngines> | undefined,
  hostVersion: string
): EngineCompatibilityResult {
  const rawPrismux =
    typeof engines === "object" && engines !== null ? engines.prismux : undefined;
  const requiredRange = typeof rawPrismux === "string" ? rawPrismux.trim() : "";

  if (requiredRange.length === 0) {
    return {
      compatible: false,
      requiredRange,
      hostVersion,
      reason:
        "Missing required top-level engines.prismux range (peerDependencies fallback is forbidden)."
    };
  }

  const parsedHost = parseSemver(hostVersion);
  if (parsedHost === null) {
    return {
      compatible: false,
      requiredRange,
      hostVersion,
      reason: `Invalid host SemVer 2.0 version: "${hostVersion}".`
    };
  }

  const validatedRange = validateSemverRange(requiredRange);
  if (!validatedRange.valid) {
    return {
      compatible: false,
      requiredRange,
      hostVersion,
      reason: validatedRange.reason
    };
  }

  const matched =
    validatedRange.sets.some((set) => matchesComparatorSet(parsedHost, set)) ||
    (parsedHost.prerelease.length > 0 &&
      validatedRange.sets.some((set) =>
        matchesComparatorSet(parsedHost, set, { includePrerelease: true })
      ));
  if (!matched) {
    return {
      compatible: false,
      requiredRange,
      hostVersion,
      reason: `Host version ${hostVersion} does not satisfy top-level engines.prismux "${requiredRange}".`
    };
  }

  return {
    compatible: true,
    requiredRange,
    hostVersion
  };
}

export interface PackageMetadataForEngineCheck {
  engines?: Partial<PluginPackageEngines> | Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Validates a full `package.json` metadata object by strictly inspecting ONLY
 * top-level `engines.prismux` and explicitly rejecting `peerDependencies` fallback.
 */
export function checkPackageEngineCompatibility(
  packageJson: PackageMetadataForEngineCheck | undefined,
  hostVersion: string
): EngineCompatibilityResult {
  if (typeof packageJson !== "object" || packageJson === null) {
    return checkTopLevelEngineCompatibility(undefined, hostVersion);
  }

  const rawEngines = packageJson.engines;
  const normalizedEngines: Partial<PluginPackageEngines> | undefined =
    typeof rawEngines === "object" &&
    rawEngines !== null &&
    !Array.isArray(rawEngines) &&
    typeof rawEngines.prismux === "string"
      ? { prismux: rawEngines.prismux }
      : undefined;

  const result = checkTopLevelEngineCompatibility(normalizedEngines, hostVersion);
  if (
    !result.compatible &&
    normalizedEngines === undefined &&
    packageJson.peerDependencies !== undefined
  ) {
    return {
      ...result,
      reason:
        "Missing required top-level engines.prismux range; peerDependencies cannot be used as fallback."
    };
  }

  return result;
}
