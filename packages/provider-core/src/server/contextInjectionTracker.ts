// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type {
  NodeId,
  OrchestrationV2ContextInjectionCatalogEntry,
  OrchestrationV2ContextInjectionFileChange,
  OrchestrationV2ContextInjectionForm,
  OrchestrationV2ContextInjectionSection,
  OrchestrationV2ContextInjectionSourceKind,
  OrchestrationV2ProviderRef,
  OrchestrationV2TurnItem,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@prismux/core-contracts";
import * as HostProcess from "@prismux/core-shared/HostProcess";
import type * as DateTime from "effect/DateTime";

const MAX_TRACKED_THREADS = 512;
const MAX_PROJECT_ROOT_DEPTH = 32;
const MAX_INSTRUCTION_HASH_BYTES = 256 * 1024;
const MAX_INSTRUCTION_PREVIEW_BYTES = 64 * 1024;
const MAX_COMBINED_CONTENT_BYTES = 128 * 1024;
const MAX_SKILL_CATALOG_ENTRIES = 200;
const MAX_SKILL_FRONTMATTER_BYTES = 32 * 1024;
const MAX_RULES_FILES = 32;

export type ContextInjectionAgentKind =
  | "codex"
  | "claude"
  | "antigravity"
  | "opencode"
  | "pi"
  | "acp";

export interface ContextInjectionSkillEntry {
  readonly name: string;
  readonly description?: string | undefined;
  readonly path?: string | undefined;
}

export interface ContextInjectionFs {
  readonly isDirectory: (dirPath: string) => boolean;
  readonly isFile: (filePath: string) => boolean;
  readonly listEntryNames: (dirPath: string) => ReadonlyArray<string>;
  readonly readFilePrefix: (filePath: string, maxBytes: number) => Buffer | undefined;
}

function defaultIsDirectory(dirPath: string): boolean {
  try {
    return NodeFS.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function defaultIsFile(filePath: string): boolean {
  try {
    return NodeFS.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function defaultListEntryNames(dirPath: string): ReadonlyArray<string> {
  try {
    return NodeFS.readdirSync(dirPath).toSorted((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function defaultReadFilePrefix(filePath: string, maxBytes: number): Buffer | undefined {
  let fd: number | undefined;
  try {
    fd = NodeFS.openSync(filePath, "r");
    const buffer = Buffer.allocUnsafe(maxBytes);
    const bytesRead = NodeFS.readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        NodeFS.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

const DEFAULT_CONTEXT_INJECTION_FS: ContextInjectionFs = {
  isDirectory: defaultIsDirectory,
  isFile: defaultIsFile,
  listEntryNames: defaultListEntryNames,
  readFilePrefix: defaultReadFilePrefix,
};

export interface TrackedContextInjectionInput {
  readonly providerThreadId: string;
  readonly agent: ContextInjectionAgentKind;
  readonly cwd: string | null | undefined;
  readonly homeDir?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly branch?: string | null | undefined;
  readonly runtimeMode?: string | null | undefined;
  readonly interactionMode?: string | null | undefined;
  readonly model?: string | null | undefined;
  readonly discoveredSkills?: ReadonlyArray<ContextInjectionSkillEntry> | undefined;
  readonly extraInstructionPaths?: ReadonlyArray<string> | undefined;
  readonly prismuxInstructions?: string | null | undefined;
  readonly includeTimeContext?: boolean | undefined;
  readonly now?: Date | undefined;
  readonly timeZone?: string | undefined;
}

export interface TrackedContextInjectionPayload {
  readonly sourceKey: string;
  readonly sourceKind: OrchestrationV2ContextInjectionSourceKind;
  readonly form: OrchestrationV2ContextInjectionForm;
  readonly label: string;
  readonly sourcePath: string | null;
  readonly statusLabel: string;
  readonly digest: string;
  readonly baseline?: boolean | undefined;
  readonly supersedesPrevious?: boolean | undefined;
  readonly files?: ReadonlyArray<OrchestrationV2ContextInjectionFileChange> | undefined;
  readonly sections?: ReadonlyArray<OrchestrationV2ContextInjectionSection> | undefined;
  readonly entries?: ReadonlyArray<OrchestrationV2ContextInjectionCatalogEntry> | undefined;
  readonly content: string | null;
}

export type ContextInjectionTurnItem = Extract<
  OrchestrationV2TurnItem,
  { readonly type: "context_injection" }
>;

export interface TurnContextInjectionTracker {
  readonly observeTurn: (
    input: TrackedContextInjectionInput,
  ) => ReadonlyArray<TrackedContextInjectionPayload>;
  readonly clearThread: (providerThreadId: string) => void;
  readonly reset: () => void;
}

interface TrackedInstructionFileSnapshot {
  readonly displayPath: string;
  readonly scope: string;
  readonly digest: string;
}

interface ThreadTrackingState {
  instructions: Map<string, TrackedInstructionFileSnapshot>;
  hasEmittedInstructions: boolean;
  readonly digestsBySourceKey: Map<string, string>;
}

function sha256Hex(value: string | Buffer): string {
  return NodeCrypto.createHash("sha256").update(value).digest("hex");
}

function readEnvValue(
  env: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") {
    const raw = env[name]?.trim();
    return raw && raw.length > 0 ? raw : undefined;
  }
  const target = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === target) {
      const trimmed = value?.trim();
      if (trimmed && trimmed.length > 0) return trimmed;
    }
  }
  return undefined;
}

function resolveUserHome(
  env: NodeJS.ProcessEnv,
  explicitHome: string | undefined,
  platform: NodeJS.Platform,
): string | undefined {
  const trimmedExplicit = explicitHome?.trim();
  if (trimmedExplicit) return trimmedExplicit;
  if (platform === "win32") {
    const userProfile = readEnvValue(env, "USERPROFILE", platform);
    if (userProfile) return userProfile;
    const homeDrive = readEnvValue(env, "HOMEDRIVE", platform);
    const homePath = readEnvValue(env, "HOMEPATH", platform);
    if (homeDrive && homePath) return `${homeDrive}${homePath}`;
  }
  const envHome = readEnvValue(env, "HOME", platform);
  if (envHome) return envHome;
  try {
    const osHome = NodeOS.homedir().trim();
    return osHome.length > 0 ? osHome : undefined;
  } catch {
    return undefined;
  }
}

function expandTildePath(
  rawPath: string,
  homeDir: string | undefined,
  pathApi: typeof NodePath.win32 | typeof NodePath.posix,
): string {
  if (!homeDir) return rawPath;
  if (rawPath === "~") return homeDir;
  if (rawPath.startsWith("~/") || rawPath.startsWith("~\\")) {
    return pathApi.join(homeDir, rawPath.slice(2));
  }
  return rawPath;
}

function normalizePathKey(
  filePath: string,
  platform: NodeJS.Platform,
  pathApi: typeof NodePath.win32 | typeof NodePath.posix,
): string {
  const resolved = pathApi.resolve(filePath);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function toPosixSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function formatDisplayPath(
  filePath: string,
  cwd: string | undefined,
  homeDir: string | undefined,
  platform: NodeJS.Platform,
  pathApi: typeof NodePath.win32 | typeof NodePath.posix,
): string {
  const resolved = pathApi.resolve(filePath);
  if (cwd) {
    const resolvedCwd = pathApi.resolve(cwd);
    const relative = pathApi.relative(resolvedCwd, resolved);
    if (relative.length > 0 && !relative.startsWith("..") && !pathApi.isAbsolute(relative)) {
      return toPosixSlashes(relative);
    }
  }
  if (homeDir) {
    const resolvedHome = pathApi.resolve(homeDir);
    const relative = pathApi.relative(resolvedHome, resolved);
    if (relative.length > 0 && !relative.startsWith("..") && !pathApi.isAbsolute(relative)) {
      return `~/${toPosixSlashes(relative)}`;
    }
  }
  return toPosixSlashes(resolved);
}

function findGitRoot(
  cwd: string,
  homeDir: string | undefined,
  platform: NodeJS.Platform,
  pathApi: typeof NodePath.win32 | typeof NodePath.posix,
  fs: ContextInjectionFs,
): string {
  const resolvedCwd = pathApi.resolve(cwd);
  const normalizedHome = homeDir ? normalizePathKey(homeDir, platform, pathApi) : undefined;
  let cursor = resolvedCwd;
  for (let depth = 0; depth < MAX_PROJECT_ROOT_DEPTH; depth += 1) {
    const cursorKey = normalizePathKey(cursor, platform, pathApi);
    if (normalizedHome !== undefined && cursorKey === normalizedHome && cursor !== resolvedCwd) {
      break;
    }
    const gitEntry = pathApi.join(cursor, ".git");
    if (fs.isDirectory(gitEntry) || fs.isFile(gitEntry)) {
      return cursor;
    }
    const parent = pathApi.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return resolvedCwd;
}

function collectAncestorDirs(
  rootDir: string,
  cwd: string,
  platform: NodeJS.Platform,
  pathApi: typeof NodePath.win32 | typeof NodePath.posix,
): ReadonlyArray<string> {
  const resolvedRoot = pathApi.resolve(rootDir);
  const resolvedCwd = pathApi.resolve(cwd);
  const rootKey = normalizePathKey(resolvedRoot, platform, pathApi);
  const chain: Array<string> = [];
  let cursor = resolvedCwd;
  for (let depth = 0; depth < MAX_PROJECT_ROOT_DEPTH; depth += 1) {
    chain.push(cursor);
    if (normalizePathKey(cursor, platform, pathApi) === rootKey) break;
    const parent = pathApi.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  chain.reverse();
  return chain;
}

function readGitBranchFromDisk(
  workspaceRoot: string,
  pathApi: typeof NodePath.win32 | typeof NodePath.posix,
  fs: ContextInjectionFs,
): string | undefined {
  const gitEntry = pathApi.join(workspaceRoot, ".git");
  let headPath: string | undefined;
  if (fs.isDirectory(gitEntry)) {
    headPath = pathApi.join(gitEntry, "HEAD");
  } else if (fs.isFile(gitEntry)) {
    const pointerBuf = fs.readFilePrefix(gitEntry, 4096);
    const pointer = pointerBuf?.toString("utf8").trim();
    const match = pointer ? /^gitdir:\s*(.+)$/im.exec(pointer) : null;
    if (match?.[1]) {
      const target = match[1].trim();
      const resolvedGitDir = pathApi.isAbsolute(target)
        ? target
        : pathApi.resolve(workspaceRoot, target);
      headPath = pathApi.join(resolvedGitDir, "HEAD");
    }
  }
  if (!headPath || !fs.isFile(headPath)) return undefined;
  const headText = fs.readFilePrefix(headPath, 1024)?.toString("utf8").trim();
  if (!headText) return undefined;
  const refMatch = /^ref:\s*refs\/heads\/(.+)$/u.exec(headText);
  if (refMatch?.[1]) return refMatch[1].trim();
  return headText.length >= 7 ? headText.slice(0, 12) : headText;
}

interface CandidateInstructionFile {
  readonly filePath: string;
  readonly scope: string;
}

function readOpenCodeConfigInstructionPaths(
  workspaceRoot: string,
  homeDir: string | undefined,
  pathApi: typeof NodePath.win32 | typeof NodePath.posix,
  fs: ContextInjectionFs,
): ReadonlyArray<string> {
  const configPath = pathApi.join(workspaceRoot, "opencode.json");
  if (!fs.isFile(configPath)) return [];
  const raw = fs.readFilePrefix(configPath, 64 * 1024)?.toString("utf8");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
    const instructions = (parsed as Record<string, unknown>).instructions;
    if (!Array.isArray(instructions)) return [];
    const out: Array<string> = [];
    for (const entry of instructions) {
      if (typeof entry !== "string") continue;
      const trimmed = entry.trim();
      if (trimmed.length === 0 || /^https?:\/\//iu.test(trimmed) || /[*?[\]{}]/u.test(trimmed)) {
        continue;
      }
      const expanded = expandTildePath(trimmed, homeDir, pathApi);
      const resolved = pathApi.isAbsolute(expanded)
        ? expanded
        : pathApi.resolve(workspaceRoot, expanded);
      out.push(resolved);
    }
    return out;
  } catch {
    return [];
  }
}

function discoverInstructionCandidates(input: {
  readonly agent: ContextInjectionAgentKind;
  readonly cwd: string | undefined;
  readonly workspaceRoot: string | undefined;
  readonly homeDir: string | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly pathApi: typeof NodePath.win32 | typeof NodePath.posix;
  readonly fs: ContextInjectionFs;
  readonly extraInstructionPaths: ReadonlyArray<string> | undefined;
}): ReadonlyArray<CandidateInstructionFile> {
  const { agent, cwd, workspaceRoot, homeDir, env, platform, pathApi, fs } = input;
  const candidates: Array<CandidateInstructionFile> = [];
  const seen = new Set<string>();
  const pushCandidate = (filePath: string | undefined, scope: string) => {
    if (!filePath) return;
    const expanded = expandTildePath(filePath, homeDir, pathApi);
    const resolved = pathApi.resolve(expanded);
    const key = normalizePathKey(resolved, platform, pathApi);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ filePath: resolved, scope });
  };

  // 1. Global agent instruction files (strictly standard local markdown files, zero credentials/db).
  switch (agent) {
    case "codex": {
      const codexHome =
        readEnvValue(env, "CODEX_HOME", platform) ??
        (homeDir ? pathApi.join(homeDir, ".codex") : undefined);
      if (codexHome) {
        pushCandidate(pathApi.join(codexHome, "AGENTS.md"), "user-global");
        pushCandidate(pathApi.join(codexHome, "AGENTS.override.md"), "user-global");
      }
      break;
    }
    case "claude": {
      const claudeHome =
        readEnvValue(env, "CLAUDE_CONFIG_DIR", platform) ??
        (homeDir ? pathApi.join(homeDir, ".claude") : undefined);
      if (claudeHome) {
        pushCandidate(pathApi.join(claudeHome, "CLAUDE.md"), "user-global");
      }
      break;
    }
    case "antigravity": {
      // Strictly official local markdown files only (never reads state.vscdb / Keyring / Cookie).
      if (homeDir) {
        pushCandidate(pathApi.join(homeDir, ".gemini", "GEMINI.md"), "user-global");
        pushCandidate(pathApi.join(homeDir, ".gemini", "config", "GEMINI.md"), "user-global");
      }
      break;
    }
    case "opencode": {
      const xdgConfig =
        readEnvValue(env, "XDG_CONFIG_HOME", platform) ??
        (homeDir ? pathApi.join(homeDir, ".config") : undefined);
      if (xdgConfig) {
        pushCandidate(pathApi.join(xdgConfig, "opencode", "AGENTS.md"), "user-global");
      }
      break;
    }
    case "pi": {
      const piAgentDir =
        readEnvValue(env, "PI_CODING_AGENT_DIR", platform) ??
        (homeDir ? pathApi.join(homeDir, ".pi", "agent") : undefined);
      if (piAgentDir) {
        pushCandidate(pathApi.join(piAgentDir, "AGENTS.md"), "user-global");
        pushCandidate(pathApi.join(piAgentDir, "CLAUDE.md"), "user-global");
      }
      break;
    }
    case "acp":
      break;
  }

  // 2. Workspace instruction files from git root down to cwd.
  if (cwd && workspaceRoot && fs.isDirectory(cwd)) {
    const dirs = collectAncestorDirs(workspaceRoot, cwd, platform, pathApi);
    for (const dir of dirs) {
      const scope =
        normalizePathKey(dir, platform, pathApi) ===
        normalizePathKey(workspaceRoot, platform, pathApi)
          ? "workspace-root"
          : "workspace";
      switch (agent) {
        case "codex":
          pushCandidate(pathApi.join(dir, "AGENTS.md"), scope);
          pushCandidate(pathApi.join(dir, "AGENTS.override.md"), scope);
          break;
        case "claude":
          pushCandidate(pathApi.join(dir, "CLAUDE.md"), scope);
          pushCandidate(pathApi.join(dir, ".claude", "CLAUDE.md"), scope);
          pushCandidate(pathApi.join(dir, "CLAUDE.local.md"), scope);
          pushCandidate(pathApi.join(dir, "AGENTS.md"), scope);
          break;
        case "antigravity": {
          pushCandidate(pathApi.join(dir, "AGENTS.md"), scope);
          pushCandidate(pathApi.join(dir, "GEMINI.md"), scope);
          const rulesDir = pathApi.join(dir, ".agent", "rules");
          if (fs.isDirectory(rulesDir)) {
            let count = 0;
            for (const entry of fs.listEntryNames(rulesDir)) {
              if (!entry.toLowerCase().endsWith(".md")) continue;
              pushCandidate(pathApi.join(rulesDir, entry), "workspace-rule");
              count += 1;
              if (count >= MAX_RULES_FILES) break;
            }
          }
          break;
        }
        case "opencode":
          pushCandidate(pathApi.join(dir, "AGENTS.md"), scope);
          pushCandidate(pathApi.join(dir, "CLAUDE.md"), scope);
          break;
        case "pi":
          pushCandidate(pathApi.join(dir, "AGENTS.md"), scope);
          pushCandidate(pathApi.join(dir, "CLAUDE.md"), scope);
          break;
        case "acp":
          pushCandidate(pathApi.join(dir, "AGENTS.md"), scope);
          pushCandidate(pathApi.join(dir, "CLAUDE.md"), scope);
          pushCandidate(pathApi.join(dir, "GEMINI.md"), scope);
          break;
      }
    }
    if (agent === "opencode") {
      for (const configuredPath of readOpenCodeConfigInstructionPaths(
        workspaceRoot,
        homeDir,
        pathApi,
        fs,
      )) {
        pushCandidate(configuredPath, "opencode-config");
      }
    }
  }

  // 3. Explicit extra paths supplied by the caller.
  for (const extra of input.extraInstructionPaths ?? []) {
    const trimmed = extra.trim();
    if (trimmed.length > 0) {
      pushCandidate(trimmed, "extra");
    }
  }

  return candidates;
}

function parseSkillFrontmatterBasic(
  text: string,
  fallbackName: string,
): { readonly name: string; readonly description: string } | undefined {
  const normalized = text.replace(/^\uFEFF/u, "");
  const lines = normalized.split(/\r?\n/u);
  let name = fallbackName;
  let description = "";
  if (lines[0]?.trim() === "---") {
    let end = -1;
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index]?.trim() === "---") {
        end = index;
        break;
      }
    }
    if (end > 1) {
      for (let index = 1; index < end; index += 1) {
        const line = lines[index] ?? "";
        if (/^\s/u.test(line) || line.trim().startsWith("#")) continue;
        const colon = line.indexOf(":");
        if (colon <= 0) continue;
        const key = line.slice(0, colon).trim().toLowerCase();
        const raw = line
          .slice(colon + 1)
          .trim()
          .replace(/^["']|["']$/gu, "");
        if (key === "name" && raw.length > 0 && !/\s/u.test(raw)) {
          name = raw;
        } else if (key === "description" && raw.length > 0 && !/^[>|][+-]?$/u.test(raw)) {
          description = raw;
        }
      }
    }
  }
  const trimmedName = name.trim();
  return trimmedName.length > 0
    ? { name: trimmedName, description: description.trim() }
    : undefined;
}

function scanSkillDirectory(
  dirPath: string,
  pathApi: typeof NodePath.win32 | typeof NodePath.posix,
  fs: ContextInjectionFs,
): ReadonlyArray<OrchestrationV2ContextInjectionCatalogEntry> {
  if (!fs.isDirectory(dirPath)) return [];
  const entries: Array<OrchestrationV2ContextInjectionCatalogEntry> = [];
  for (const child of fs.listEntryNames(dirPath)) {
    if (child.startsWith(".")) continue;
    const childPath = pathApi.join(dirPath, child);
    const skillFile = fs.isDirectory(childPath)
      ? pathApi.join(childPath, "SKILL.md")
      : child.toLowerCase().endsWith(".md")
        ? childPath
        : undefined;
    if (!skillFile || !fs.isFile(skillFile)) continue;
    const buf = fs.readFilePrefix(skillFile, MAX_SKILL_FRONTMATTER_BYTES);
    if (!buf) continue;
    const fallbackName = child.toLowerCase().endsWith(".md") ? child.slice(0, -3) : child;
    const parsed = parseSkillFrontmatterBasic(buf.toString("utf8"), fallbackName);
    if (parsed) {
      entries.push(parsed);
    }
    if (entries.length >= MAX_SKILL_CATALOG_ENTRIES) break;
  }
  return entries;
}

function discoverLocalSkillEntries(input: {
  readonly agent: ContextInjectionAgentKind;
  readonly cwd: string | undefined;
  readonly workspaceRoot: string | undefined;
  readonly homeDir: string | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly pathApi: typeof NodePath.win32 | typeof NodePath.posix;
  readonly fs: ContextInjectionFs;
  readonly discoveredSkills: ReadonlyArray<ContextInjectionSkillEntry> | undefined;
}): ReadonlyArray<OrchestrationV2ContextInjectionCatalogEntry> {
  const { agent, cwd, workspaceRoot, homeDir, env, platform, pathApi, fs } = input;
  const byName = new Map<string, OrchestrationV2ContextInjectionCatalogEntry>();
  const addEntry = (name: string, description: string | undefined) => {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) return;
    const key = trimmedName.toLowerCase();
    const existing = byName.get(key);
    const nextDescription = (description ?? "").trim();
    if (
      existing === undefined ||
      (existing.description.length === 0 && nextDescription.length > 0)
    ) {
      byName.set(key, { name: trimmedName, description: nextDescription });
    }
  };

  for (const skill of input.discoveredSkills ?? []) {
    addEntry(skill.name, skill.description);
  }

  const skillDirs: Array<string> = [];
  const pushDir = (dirPath: string | undefined) => {
    if (!dirPath) return;
    const resolved = pathApi.resolve(expandTildePath(dirPath, homeDir, pathApi));
    if (!skillDirs.includes(resolved)) skillDirs.push(resolved);
  };

  if (cwd && workspaceRoot && fs.isDirectory(cwd)) {
    switch (agent) {
      case "codex":
        pushDir(pathApi.join(workspaceRoot, ".codex", "skills"));
        pushDir(pathApi.join(workspaceRoot, ".agents", "skills"));
        break;
      case "claude":
        pushDir(pathApi.join(workspaceRoot, ".claude", "skills"));
        break;
      case "antigravity":
        pushDir(pathApi.join(workspaceRoot, ".agent", "skills"));
        break;
      case "opencode":
        pushDir(pathApi.join(workspaceRoot, ".opencode", "skills"));
        pushDir(pathApi.join(workspaceRoot, ".agents", "skills"));
        break;
      case "pi":
        pushDir(pathApi.join(workspaceRoot, ".pi", "skills"));
        pushDir(pathApi.join(workspaceRoot, ".agents", "skills"));
        break;
      case "acp":
        pushDir(pathApi.join(workspaceRoot, ".agents", "skills"));
        break;
    }
  }

  switch (agent) {
    case "codex": {
      const codexHome =
        readEnvValue(env, "CODEX_HOME", platform) ??
        (homeDir ? pathApi.join(homeDir, ".codex") : undefined);
      if (codexHome) pushDir(pathApi.join(codexHome, "skills"));
      if (homeDir) pushDir(pathApi.join(homeDir, ".agents", "skills"));
      break;
    }
    case "claude": {
      const claudeHome =
        readEnvValue(env, "CLAUDE_CONFIG_DIR", platform) ??
        (homeDir ? pathApi.join(homeDir, ".claude") : undefined);
      if (claudeHome) pushDir(pathApi.join(claudeHome, "skills"));
      break;
    }
    case "antigravity": {
      if (homeDir) pushDir(pathApi.join(homeDir, ".gemini", "config", "skills"));
      break;
    }
    case "opencode": {
      const xdgConfig =
        readEnvValue(env, "XDG_CONFIG_HOME", platform) ??
        (homeDir ? pathApi.join(homeDir, ".config") : undefined);
      if (xdgConfig) pushDir(pathApi.join(xdgConfig, "opencode", "skills"));
      break;
    }
    case "pi": {
      const piAgentDir =
        readEnvValue(env, "PI_CODING_AGENT_DIR", platform) ??
        (homeDir ? pathApi.join(homeDir, ".pi", "agent") : undefined);
      if (piAgentDir) pushDir(pathApi.join(piAgentDir, "skills"));
      break;
    }
    case "acp":
      break;
  }

  for (const dir of skillDirs) {
    for (const entry of scanSkillDirectory(dir, pathApi, fs)) {
      addEntry(entry.name, entry.description);
    }
  }

  return [...byName.values()]
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_SKILL_CATALOG_ENTRIES);
}

function formatInstructionLabel(
  files: ReadonlyArray<OrchestrationV2ContextInjectionFileChange>,
): string {
  if (files.length === 0) return "agent-instructions";
  if (files.length === 1) return files[0]!.path;
  if (files.length === 2) return `${files[0]!.path}, ${files[1]!.path}`;
  return `${files[0]!.path} +${files.length - 1}`;
}

function formatInstructionStatusLabel(
  files: ReadonlyArray<OrchestrationV2ContextInjectionFileChange>,
  isBaseline: boolean,
): string {
  if (files.length > 0 && files.every((file) => file.action === "remove")) return "已移除";
  if (!isBaseline || files.some((file) => file.action === "replace")) return "已更新";
  return "已载入";
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  return Buffer.from(text, "utf8")
    .subarray(0, maxBytes)
    .toString("utf8")
    .replace(/\uFFFD$/u, "");
}

function formatDateYmdInTimeZone(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value ?? "0000";
    const month = parts.find((part) => part.type === "month")?.value ?? "01";
    const day = parts.find((part) => part.type === "day")?.value ?? "01";
    return `${year}-${month}-${day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Shared strictly read-only per-thread context injection observer.
 * Tracks real local instruction files, runtime-context, skill-catalog, and optional time-context
 * by SHA-256 digest per `providerThreadId` with zero LLM prompt token overhead.
 */
export function createTurnContextInjectionTracker(
  fs: ContextInjectionFs = DEFAULT_CONTEXT_INJECTION_FS,
): TurnContextInjectionTracker {
  const threads = new Map<string, ThreadTrackingState>();

  const getOrCreateState = (providerThreadId: string): ThreadTrackingState => {
    const existing = threads.get(providerThreadId);
    if (existing !== undefined) {
      threads.delete(providerThreadId);
      threads.set(providerThreadId, existing);
      return existing;
    }
    if (threads.size >= MAX_TRACKED_THREADS) {
      const oldest = threads.keys().next().value;
      if (oldest !== undefined) threads.delete(oldest);
    }
    const created: ThreadTrackingState = {
      instructions: new Map(),
      hasEmittedInstructions: false,
      digestsBySourceKey: new Map(),
    };
    threads.set(providerThreadId, created);
    return created;
  };

  const observeTurn = (
    input: TrackedContextInjectionInput,
  ): ReadonlyArray<TrackedContextInjectionPayload> => {
    const platform = input.platform ?? HostProcess.Platform.defaultValue();
    const pathApi = platform === "win32" ? NodePath.win32 : NodePath.posix;
    const env = input.env ?? HostProcess.Environment.defaultValue();
    const homeDir = resolveUserHome(env, input.homeDir, platform);
    const trimmedCwd = input.cwd?.trim();
    const cwdExists =
      trimmedCwd !== undefined && trimmedCwd.length > 0 && fs.isDirectory(trimmedCwd);
    const resolvedCwd = cwdExists ? pathApi.resolve(trimmedCwd) : undefined;
    const workspaceRoot =
      resolvedCwd !== undefined
        ? findGitRoot(resolvedCwd, homeDir, platform, pathApi, fs)
        : undefined;

    const state = getOrCreateState(input.providerThreadId);
    const emitted: Array<TrackedContextInjectionPayload> = [];

    // 1. Real instruction files (AGENTS.md / CLAUDE.md / GEMINI.md / .agent/rules/*.md).
    const candidates = discoverInstructionCandidates({
      agent: input.agent,
      cwd: resolvedCwd,
      workspaceRoot,
      homeDir,
      env,
      platform,
      pathApi,
      fs,
      extraInstructionPaths: input.extraInstructionPaths,
    });
    const currentFiles = new Map<
      string,
      TrackedInstructionFileSnapshot & { readonly preview: string }
    >();
    for (const candidate of candidates) {
      if (!fs.isFile(candidate.filePath)) continue;
      const bytes = fs.readFilePrefix(candidate.filePath, MAX_INSTRUCTION_HASH_BYTES);
      if (bytes === undefined) continue;
      const digest = sha256Hex(bytes);
      const displayPath = formatDisplayPath(
        candidate.filePath,
        resolvedCwd,
        homeDir,
        platform,
        pathApi,
      );
      const preview = truncateUtf8(bytes.toString("utf8"), MAX_INSTRUCTION_PREVIEW_BYTES);
      const key = normalizePathKey(candidate.filePath, platform, pathApi);
      currentFiles.set(key, {
        displayPath,
        scope: candidate.scope,
        digest,
        preview,
      });
    }

    const fileChanges: Array<OrchestrationV2ContextInjectionFileChange> = [];
    const contentChunks: Array<string> = [];
    for (const [key, current] of currentFiles) {
      const previous = state.instructions.get(key);
      if (previous === undefined) {
        fileChanges.push({
          action: "set",
          scope: current.scope,
          path: current.displayPath,
          digest: current.digest,
        });
        contentChunks.push(
          currentFiles.size === 1
            ? current.preview
            : `# ${current.displayPath}\n${current.preview}`,
        );
      } else if (previous.digest !== current.digest) {
        fileChanges.push({
          action: "replace",
          scope: current.scope,
          path: current.displayPath,
          digest: current.digest,
        });
        contentChunks.push(`# ${current.displayPath}\n${current.preview}`);
      }
    }
    for (const [key, previous] of state.instructions) {
      if (!currentFiles.has(key)) {
        fileChanges.push({
          action: "remove",
          scope: previous.scope,
          path: previous.displayPath,
          digest: previous.digest,
        });
      }
    }

    state.instructions = new Map(
      [...currentFiles.entries()].map(([key, value]) => [
        key,
        { displayPath: value.displayPath, scope: value.scope, digest: value.digest },
      ]),
    );

    if (fileChanges.length > 0) {
      const isBaseline = !state.hasEmittedInstructions;
      state.hasEmittedInstructions = true;
      const digest = sha256Hex(
        JSON.stringify(fileChanges.map((change) => [change.action, change.path, change.digest])),
      );
      const rawContent = contentChunks.join("\n\n").trim();
      const content =
        rawContent.length > 0 ? truncateUtf8(rawContent, MAX_COMBINED_CONTENT_BYTES) : null;
      emitted.push({
        sourceKey: "agent-instructions",
        sourceKind: "agent-instructions",
        form: "instructions",
        label: formatInstructionLabel(fileChanges),
        sourcePath: fileChanges[0]?.path ?? null,
        statusLabel: formatInstructionStatusLabel(fileChanges, isBaseline),
        digest,
        ...(isBaseline ? { baseline: true } : { supersedesPrevious: true }),
        files: fileChanges,
        content,
      });
    }

    // 2. Runtime context snapshot (only when cwd actually exists on disk or Prismux instructions are present).
    const runtimeSections: Array<OrchestrationV2ContextInjectionSection> = [];
    if (resolvedCwd !== undefined) {
      runtimeSections.push({
        name: "working-directory",
        text: resolvedCwd,
      });
      const branch =
        input.branch?.trim() ||
        (workspaceRoot !== undefined
          ? readGitBranchFromDisk(workspaceRoot, pathApi, fs)
          : undefined);
      if (branch) {
        runtimeSections.push({
          name: "git-branch",
          text: branch,
        });
      }
      const policyParts = [
        input.runtimeMode?.trim() ? `runtime: ${input.runtimeMode.trim()}` : undefined,
        input.interactionMode?.trim() ? `mode: ${input.interactionMode.trim()}` : undefined,
      ].filter((part): part is string => part !== undefined);
      if (policyParts.length > 0) {
        runtimeSections.push({
          name: "runtime-policy",
          text: policyParts.join(" · "),
        });
      }
      const model = input.model?.trim();
      if (model && model !== "default") {
        runtimeSections.push({
          name: "model",
          text: model,
        });
      }
    }
    const prismuxInstructions = input.prismuxInstructions?.trim();
    if (prismuxInstructions && prismuxInstructions.length > 0) {
      runtimeSections.push({
        name: "prismux-instructions",
        text: truncateUtf8(prismuxInstructions, MAX_INSTRUCTION_PREVIEW_BYTES),
      });
    }

    if (runtimeSections.length > 0) {
      const runtimeDigest = sha256Hex(JSON.stringify(runtimeSections));
      const previousRuntimeDigest = state.digestsBySourceKey.get("runtime-context");
      if (previousRuntimeDigest !== runtimeDigest) {
        const isFirst = previousRuntimeDigest === undefined;
        state.digestsBySourceKey.set("runtime-context", runtimeDigest);
        const content = runtimeSections
          .map((section) => `${section.name}: ${section.text}`)
          .join("\n");
        emitted.push({
          sourceKey: "runtime-context",
          sourceKind: "runtime-context",
          form: "snapshot",
          label: "runtime-context",
          sourcePath: resolvedCwd ?? null,
          statusLabel: isFirst ? "已载入" : "已更新",
          digest: runtimeDigest,
          ...(isFirst ? { baseline: true } : { supersedesPrevious: true }),
          sections: runtimeSections,
          content: truncateUtf8(content, MAX_COMBINED_CONTENT_BYTES),
        });
      }
    }

    // 3. Skill catalog (emitted only when at least 1 real skill is discovered).
    const skillEntries = discoverLocalSkillEntries({
      agent: input.agent,
      cwd: resolvedCwd,
      workspaceRoot,
      homeDir,
      env,
      platform,
      pathApi,
      fs,
      discoveredSkills: input.discoveredSkills,
    });
    if (skillEntries.length > 0) {
      const catalogDigest = sha256Hex(JSON.stringify(skillEntries));
      const previousCatalogDigest = state.digestsBySourceKey.get("skill-catalog");
      if (previousCatalogDigest !== catalogDigest) {
        const isFirst = previousCatalogDigest === undefined;
        state.digestsBySourceKey.set("skill-catalog", catalogDigest);
        const content = skillEntries
          .map((entry) => (entry.description ? `${entry.name}: ${entry.description}` : entry.name))
          .join("\n");
        emitted.push({
          sourceKey: "skill-catalog",
          sourceKind: "skill-catalog",
          form: "catalog",
          label: "skill-catalog",
          sourcePath: null,
          statusLabel: isFirst ? "已载入" : "已更新",
          digest: catalogDigest,
          ...(isFirst ? { baseline: true } : { supersedesPrevious: true }),
          entries: skillEntries,
          content: truncateUtf8(content, MAX_COMBINED_CONTENT_BYTES),
        });
      }
    }

    // 4. Optional time-context snapshot (stable per date + timezone so it doesn't churn on every turn).
    if (input.includeTimeContext === true) {
      const now = input.now ?? new Date();
      const timeZone =
        input.timeZone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const ymd = formatDateYmdInTimeZone(now, timeZone);
      const timeSections: ReadonlyArray<OrchestrationV2ContextInjectionSection> = [
        {
          name: "time-context",
          text: `Date: ${ymd}\nTime zone: ${timeZone}`,
        },
      ];
      const timeDigest = sha256Hex(`${ymd}|${timeZone}`);
      const previousTimeDigest = state.digestsBySourceKey.get("time-context");
      if (previousTimeDigest !== timeDigest) {
        const isFirst = previousTimeDigest === undefined;
        state.digestsBySourceKey.set("time-context", timeDigest);
        emitted.push({
          sourceKey: "time-context",
          sourceKind: "time-context",
          form: "snapshot",
          label: "time-context",
          sourcePath: null,
          statusLabel: isFirst ? "已载入" : "已更新",
          digest: timeDigest,
          ...(isFirst ? { baseline: true } : { supersedesPrevious: true }),
          sections: timeSections,
          content: timeSections[0]!.text,
        });
      }
    }

    return emitted;
  };

  return {
    observeTurn,
    clearThread: (providerThreadId) => {
      threads.delete(providerThreadId);
    },
    reset: () => {
      threads.clear();
    },
  };
}

export function buildContextInjectionTurnItem(input: {
  readonly id: TurnItemId;
  readonly threadId: ThreadId;
  readonly runId: RunId | null;
  readonly nodeId: NodeId | null;
  readonly providerThreadId: ProviderThreadId | null;
  readonly providerTurnId: ProviderTurnId | null;
  readonly nativeItemRef: OrchestrationV2ProviderRef | null;
  readonly ordinal: number;
  readonly occurredAt: DateTime.Utc;
  readonly payload: TrackedContextInjectionPayload;
}): ContextInjectionTurnItem {
  const { payload } = input;
  return {
    id: input.id,
    threadId: input.threadId,
    runId: input.runId,
    nodeId: input.nodeId,
    providerThreadId: input.providerThreadId,
    providerTurnId: input.providerTurnId,
    nativeItemRef: input.nativeItemRef,
    parentItemId: null,
    ordinal: input.ordinal,
    status: "completed",
    title: payload.label,
    startedAt: input.occurredAt,
    completedAt: input.occurredAt,
    updatedAt: input.occurredAt,
    type: "context_injection",
    sourceKind: payload.sourceKind,
    form: payload.form,
    label: payload.label,
    sourcePath: payload.sourcePath,
    statusLabel: payload.statusLabel,
    digest: payload.digest,
    ...(payload.baseline === undefined ? {} : { baseline: payload.baseline }),
    ...(payload.supersedesPrevious === undefined
      ? {}
      : { supersedesPrevious: payload.supersedesPrevious }),
    ...(payload.files === undefined ? {} : { files: payload.files }),
    ...(payload.sections === undefined ? {} : { sections: payload.sections }),
    ...(payload.entries === undefined ? {} : { entries: payload.entries }),
    content: payload.content,
  };
}
