// @effect-diagnostics nodeBuiltinImport:off - Compliance gate reads workspace manifests and license configs directly.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

export interface ProprietaryCarveOutRecord {
  readonly name: string;
  readonly license: string;
  readonly copyright: string;
  readonly legalTermsUrl: string;
  readonly noticeFile: string;
  readonly scope: string;
}

export interface LicenseConfigAuditResult {
  readonly checkedPaths: ReadonlyArray<string>;
  readonly missingPaths: ReadonlyArray<string>;
  readonly mobilePathRefs: ReadonlyArray<string>;
  readonly proprietaryCarveOuts: ReadonlyArray<ProprietaryCarveOutRecord>;
}

export interface RuntimeLicenseViolation {
  readonly packageName: string;
  readonly version: string;
  readonly license: string;
  readonly declaredIn: string;
  readonly reason: string;
}

export interface RuntimeLicenseScanResult {
  readonly scannedManifests: ReadonlyArray<string>;
  readonly scannedPackages: number;
  readonly violations: ReadonlyArray<RuntimeLicenseViolation>;
}

const FORBIDDEN_RUNTIME_PACKAGES = new Set([
  "heic-to",
  "sharp",
]);

const FORBIDDEN_RUNTIME_PACKAGE_PREFIXES = [
  "@img/sharp-libvips-",
];

const COPYLEFT_TOKEN_PATTERN = /\b(?:A?L?GPL(?:-\d+(?:\.\d+)*)?(?:-only|-or-later|\+)?|SSPL(?:-\d+(?:\.\d+)*)?)\b/i;
const PROPRIETARY_LICENSE_PATTERN = /^(?:SEE\s+LICENSE\b.*|UNLICENSED|PROPRIETARY)$/i;

interface RawPackageJson {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly license?: unknown;
  readonly licenses?: unknown;
  readonly repository?: unknown;
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

function normalizeRepositoryUrl(value: unknown): string | null {
  const raw =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && !Array.isArray(value) && "url" in value && typeof value.url === "string"
        ? value.url
        : null;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("github:")) return `https://github.com/${trimmed.slice(7)}`.toLowerCase();
  const normalized = trimmed
    .replace(/^git\+ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/^git\+/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/(?:git@)?github\.com\//, "https://github.com/")
    .replace(/^git:\/\/github\.com\//, "https://github.com/")
    .replace(/#.*$/, "")
    .replace(/\.git$/, "");
  if (/^[\w.-]+\/[\w.-]+$/.test(normalized)) {
    return `https://github.com/${normalized}`.toLowerCase();
  }
  return normalized.toLowerCase();
}

function normalizeDeclaredLicense(pkg: RawPackageJson): string {
  if (typeof pkg.license === "string" && pkg.license.trim().length > 0) {
    return pkg.license.trim();
  }
  if (pkg.license && typeof pkg.license === "object" && !Array.isArray(pkg.license)) {
    const typed = pkg.license as { type?: unknown };
    if (typeof typed.type === "string" && typed.type.trim().length > 0) {
      return typed.type.trim();
    }
  }
  const list = Array.isArray(pkg.license) ? pkg.license : Array.isArray(pkg.licenses) ? pkg.licenses : null;
  if (list) {
    const items = list
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object" && "type" in item && typeof item.type === "string") {
          return item.type.trim();
        }
        return "";
      })
      .filter(Boolean);
    if (items.length > 0) {
      return items.join(" OR ");
    }
  }
  return "UNKNOWN";
}

function stripOuterParens(expr: string): string {
  let current = expr.trim();
  while (current.startsWith("(") && current.endsWith(")")) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < current.length; i += 1) {
      if (current[i] === "(") depth += 1;
      else if (current[i] === ")") depth -= 1;
      if (depth === 0 && i < current.length - 1) {
        wrapsAll = false;
        break;
      }
    }
    if (!wrapsAll) break;
    current = current.slice(1, -1).trim();
  }
  return current;
}

function splitTopLevelBoolean(expr: string, operator: "OR" | "AND"): string[] {
  const clean = stripOuterParens(expr);
  const parts: string[] = [];
  let depth = 0;
  let lastStart = 0;
  const token = ` ${operator} `;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (
      depth === 0 &&
      clean.slice(i, i + token.length).toUpperCase() === token
    ) {
      parts.push(clean.slice(lastStart, i).trim());
      lastStart = i + token.length;
      i += token.length - 1;
    }
  }
  parts.push(clean.slice(lastStart).trim());
  return parts.filter(Boolean);
}

/** Rejects GPL/AGPL/LGPL/SSPL, forbidden runtime packages, and undeclared proprietary licenses. */
export function evaluateRuntimePackageLicense(input: {
  readonly packageName: string;
  readonly license: string;
  readonly proprietaryAllowlist: ReadonlySet<string>;
  readonly overrideLicense?: string;
}): string | null {
  const { packageName, proprietaryAllowlist } = input;
  if (
    FORBIDDEN_RUNTIME_PACKAGES.has(packageName) ||
    FORBIDDEN_RUNTIME_PACKAGE_PREFIXES.some((prefix) => packageName.startsWith(prefix))
  ) {
    return `Forbidden copyleft/build-only runtime package "${packageName}" must not appear in production dependencies.`;
  }

  const effectiveLicense = (input.overrideLicense ?? input.license).trim();
  if (proprietaryAllowlist.has(packageName)) {
    return null;
  }

  const checkExpression = (expr: string): string | null => {
    const clean = stripOuterParens(expr);
    if (!clean || clean === "UNKNOWN") {
      return `Undeclared or unknown runtime license "${expr}"`;
    }

    const orBranches = splitTopLevelBoolean(clean, "OR");
    if (orBranches.length > 1) {
      const branchErrors = orBranches.map((branch) => checkExpression(branch));
      // Compliant if at least one OR alternative is permissive/clean
      if (branchErrors.some((err) => err === null)) {
        return null;
      }
      return `All dual-license OR branches violate runtime policy (${clean}): ${branchErrors.filter(Boolean).join("; ")}`;
    }

    const andBranches = splitTopLevelBoolean(clean, "AND");
    if (andBranches.length > 1) {
      for (const branch of andBranches) {
        const err = checkExpression(branch);
        if (err !== null) {
          return `Conjunctive license "${clean}" contains disallowed term: ${err}`;
        }
      }
      return null;
    }

    if (PROPRIETARY_LICENSE_PATTERN.test(clean) || /^LicenseRef-.*Proprietary/i.test(clean)) {
      return `Undeclared proprietary/unlicensed runtime dependency (${clean}) outside documented proprietaryCarveOuts allowlist`;
    }

    if (COPYLEFT_TOKEN_PATTERN.test(clean)) {
      return `Disallowed copyleft license "${clean}" (GPL/AGPL/LGPL/SSPL prohibited in runtime dependencies)`;
    }

    return null;
  };

  return checkExpression(effectiveLicense);
}

export function auditLicenseConfigFile(repoRoot: string): LicenseConfigAuditResult {
  const configPath = NodePath.join(repoRoot, "third-party-licenses.config.json");
  const raw = JSON.parse(NodeFS.readFileSync(configPath, "utf8")) as {
    proprietaryCarveOuts?: ProprietaryCarveOutRecord[];
    customNotices?: Array<{ noticeFile?: string; noticeFiles?: string[] }>;
    packageOverrides?: Array<{ noticeFile?: string }>;
  };

  const paths = new Set<string>();
  const mobilePathRefs: string[] = [];

  const recordPath = (relPath: string | undefined): void => {
    if (!relPath) return;
    paths.add(relPath);
    if (/(?:^|\/)apps\/mobile\//i.test(relPath.replaceAll("\\", "/"))) {
      mobilePathRefs.push(relPath);
    }
  };

  for (const carveOut of raw.proprietaryCarveOuts ?? []) {
    recordPath(carveOut.noticeFile);
  }
  for (const notice of raw.customNotices ?? []) {
    recordPath(notice.noticeFile);
    for (const file of notice.noticeFiles ?? []) {
      recordPath(file);
    }
  }
  for (const override of raw.packageOverrides ?? []) {
    recordPath(override.noticeFile);
  }

  const checkedPaths = [...paths].sort((a, b) => a.localeCompare(b));
  const missingPaths = checkedPaths.filter(
    (relPath) => !NodeFS.existsSync(NodePath.resolve(repoRoot, relPath)),
  );

  return {
    checkedPaths,
    missingPaths,
    mobilePathRefs,
    proprietaryCarveOuts: raw.proprietaryCarveOuts ?? [],
  };
}

function readPackageJsonSafe(filePath: string): RawPackageJson | null {
  try {
    const parsed = JSON.parse(NodeFS.readFileSync(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as RawPackageJson)
      : null;
  } catch {
    return null;
  }
}

function resolveDependencyRoot(depName: string, fromPkgJsonPath: string): string | null {
  try {
    const req = NodeModule.createRequire(fromPkgJsonPath);
    const resolvedPkg = req.resolve(`${depName}/package.json`);
    return NodeFS.realpathSync(NodePath.dirname(resolvedPkg));
  } catch {
    // Fall back to manual node_modules walk when exports hide package.json
  }

  let current = NodePath.dirname(fromPkgJsonPath);
  const root = NodePath.parse(current).root;
  while (true) {
    const candidate = NodePath.join(current, "node_modules", depName);
    if (NodeFS.existsSync(NodePath.join(candidate, "package.json"))) {
      return NodeFS.realpathSync(candidate);
    }
    if (current === root) break;
    current = NodePath.dirname(current);
  }
  return null;
}

export function scanWorkspaceRuntimeLicenses(repoRoot: string): RuntimeLicenseScanResult {
  const configPath = NodePath.join(repoRoot, "third-party-licenses.config.json");
  const config = NodeFS.existsSync(configPath)
    ? (JSON.parse(NodeFS.readFileSync(configPath, "utf8")) as {
        proprietaryCarveOuts?: Array<{ name: string }>;
        packageOverrides?: Array<{ name?: string; repositoryUrl?: string; license?: string }>;
      })
    : {};

  const proprietaryAllowlist = new Set(
    (config.proprietaryCarveOuts ?? []).map((entry) => entry.name),
  );
  const licenseOverridesByName = new Map<string, string>();
  const licenseOverridesByRepo = new Map<string, string>();
  for (const override of config.packageOverrides ?? []) {
    if (!override.license) continue;
    if (override.name) {
      licenseOverridesByName.set(override.name, override.license);
    }
    if (override.repositoryUrl) {
      const normalizedRepo = normalizeRepositoryUrl(override.repositoryUrl);
      if (normalizedRepo) {
        licenseOverridesByRepo.set(normalizedRepo, override.license);
      }
    }
  }

  const workspaceManifests: string[] = [];
  for (const parent of ["apps", "packages"]) {
    const parentDir = NodePath.join(repoRoot, parent);
    if (!NodeFS.existsSync(parentDir)) continue;
    for (const entry of NodeFS.readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = NodePath.join(parentDir, entry.name, "package.json");
      if (NodeFS.existsSync(pkgPath)) {
        workspaceManifests.push(pkgPath);
      }
    }
  }
  workspaceManifests.sort((a, b) => a.localeCompare(b));

  const violations: RuntimeLicenseViolation[] = [];
  const seenViolations = new Set<string>();
  const visitedRealPaths = new Set<string>();
  let scannedPackages = 0;

  const recordViolation = (v: RuntimeLicenseViolation): void => {
    const key = `${v.packageName}@${v.version}:${v.reason}`;
    if (seenViolations.has(key)) return;
    seenViolations.add(key);
    violations.push(v);
  };

  const visitDeps = (manifestPath: string, originLabel: string): void => {
    const pkg = readPackageJsonSafe(manifestPath);
    if (!pkg) return;

    const depNames = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ].sort((a, b) => a.localeCompare(b));

    for (const depName of depNames) {
      if (depName.startsWith("@prismux/") || depName.startsWith("@types/")) {
        continue;
      }

      // Check direct package name blacklist even before node_modules resolution
      if (
        FORBIDDEN_RUNTIME_PACKAGES.has(depName) ||
        FORBIDDEN_RUNTIME_PACKAGE_PREFIXES.some((prefix) => depName.startsWith(prefix))
      ) {
        const depRoot = resolveDependencyRoot(depName, manifestPath);
        const depPkg = depRoot ? readPackageJsonSafe(NodePath.join(depRoot, "package.json")) : null;
        recordViolation({
          packageName: depName,
          version: typeof depPkg?.version === "string" ? depPkg.version : "declared",
          license: depPkg ? normalizeDeclaredLicense(depPkg) : "FORBIDDEN_PACKAGE",
          declaredIn: originLabel,
          reason: `Forbidden copyleft/build-only runtime package "${depName}" declared in ${originLabel}.`,
        });
        continue;
      }

      const depRoot = resolveDependencyRoot(depName, manifestPath);
      if (!depRoot) {
        continue;
      }
      if (visitedRealPaths.has(depRoot)) {
        continue;
      }
      visitedRealPaths.add(depRoot);

      const depPkgPath = NodePath.join(depRoot, "package.json");
      const depPkg = readPackageJsonSafe(depPkgPath);
      if (!depPkg) continue;

      const resolvedName = typeof depPkg.name === "string" ? depPkg.name : depName;
      const resolvedVersion = typeof depPkg.version === "string" ? depPkg.version : "unknown";
      const declaredLicense = normalizeDeclaredLicense(depPkg);
      scannedPackages += 1;

      const normalizedRepo = normalizeRepositoryUrl(depPkg.repository);
      const overrideLicense =
        licenseOverridesByName.get(resolvedName) ??
        (normalizedRepo ? licenseOverridesByRepo.get(normalizedRepo) : undefined);

      const errorReason = evaluateRuntimePackageLicense({
        packageName: resolvedName,
        license: declaredLicense,
        proprietaryAllowlist,
        ...(overrideLicense !== undefined ? { overrideLicense } : {}),
      });
      if (errorReason !== null) {
        recordViolation({
          packageName: resolvedName,
          version: resolvedVersion,
          license: declaredLicense,
          declaredIn: originLabel,
          reason: errorReason,
        });
      }

      visitDeps(depPkgPath, originLabel);
    }
  };

  for (const manifestPath of workspaceManifests) {
    const relManifest = NodePath.relative(repoRoot, manifestPath).replaceAll("\\", "/");
    visitDeps(manifestPath, relManifest);
  }

  return {
    scannedManifests: workspaceManifests.map((p) =>
      NodePath.relative(repoRoot, p).replaceAll("\\", "/"),
    ),
    scannedPackages,
    violations,
  };
}
