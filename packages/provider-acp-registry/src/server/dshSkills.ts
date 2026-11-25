// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type {
  ServerProviderSkill,
  ServerProviderSlashCommand,
} from "@prismux/core-contracts";
import * as HostProcess from "@prismux/core-shared/HostProcess";

import { resolveDshDesktopHome } from "./dshLocal.ts";

const MAX_SKILL_NAME_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 1_024;
const MAX_FRONTMATTER_BYTES = 64 * 1024;
const MAX_DISCOVERED_SKILLS = 512;
const MAX_PROJECT_ROOT_DEPTH = 32;

export interface DshAvailableCommands {
  readonly slashCommands: ReadonlyArray<ServerProviderSlashCommand>;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}

/**
 * Canonical slash commands registered by DeepSeek Harness (`@deepseek-ai/dsh-base`).
 * `@deepseek-ai/dsh-acp` v0.0.1 does not emit `available_commands_update`, so Prismux
 * surfaces these defaults and lets live ACP `available_commands_update` entries take
 * precedence whenever DSH advertises them natively (including `/compact`).
 */
export const DSH_BUILTIN_SLASH_COMMANDS: ReadonlyArray<ServerProviderSlashCommand> = [
  {
    name: "plan",
    description: "Enter or leave plan mode",
    input: { hint: "[off|message]" },
  },
  {
    name: "goal",
    description: "Set or view the goal for a long-running task",
    input: { hint: "[<objective>|clear|edit <objective>|pause|resume]" },
  },
  {
    name: "permission",
    description: "Switch the permission preset (sandbox mode + approval policy)",
    input: { hint: "<read-only|workspace-write|danger-full-access>" },
  },
  {
    name: "feedback",
    description: "Record feedback about this session",
    input: { hint: "<text>" },
  },
];

export interface DshSkillsFs {
  readonly isDirectory: (dirPath: string) => boolean;
  readonly isFile: (filePath: string) => boolean;
  readonly listEntryNames: (dirPath: string) => ReadonlyArray<string>;
  readonly readTextFilePrefix: (filePath: string, maxBytes: number) => string | undefined;
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

function defaultReadTextFilePrefix(filePath: string, maxBytes: number): string | undefined {
  let fd: number | undefined;
  try {
    fd = NodeFS.openSync(filePath, "r");
    const buffer = Buffer.allocUnsafe(maxBytes);
    const bytesRead = NodeFS.readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        NodeFS.closeSync(fd);
      } catch {}
    }
  }
}

const DEFAULT_DSH_SKILLS_FS: DshSkillsFs = {
  isDirectory: defaultIsDirectory,
  isFile: defaultIsFile,
  listEntryNames: defaultListEntryNames,
  readTextFilePrefix: defaultReadTextFilePrefix,
};

function readEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") {
    const value = env[name]?.trim();
    return value && value.length > 0 ? value : undefined;
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

function resolveUserHome(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  if (platform === "win32") {
    const userProfile = readEnv(env, "USERPROFILE", platform);
    if (userProfile) return userProfile;
    const homeDrive = readEnv(env, "HOMEDRIVE", platform);
    const homePath = readEnv(env, "HOMEPATH", platform);
    if (homeDrive && homePath) return `${homeDrive}${homePath}`;
  }
  const home = readEnv(env, "HOME", platform);
  if (home) return home;
  try {
    const osHome = NodeOS.homedir().trim();
    return osHome.length > 0 ? osHome : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves DeepSeek Harness's `DSH_HOME` directory matching `@deepseek-ai/dsh-home-paths`
 * and packaged DSH Desktop (`desktop-next-last-home.json`).
 */
export function resolveDshHomeDirectory(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = HostProcess.Platform.defaultValue(),
  fs: DshSkillsFs = DEFAULT_DSH_SKILLS_FS,
): string | undefined {
  const explicit = readEnv(env, "DSH_HOME", platform);
  if (explicit) return explicit;
  const desktopHome = resolveDshDesktopHome(env, platform, {
    isDirectory: fs.isDirectory,
    readTextFile: (filePath) => fs.readTextFilePrefix(filePath, MAX_FRONTMATTER_BYTES),
  });
  if (desktopHome) return desktopHome;
  const userHome = resolveUserHome(env, platform);
  if (!userHome) return undefined;
  const path = platform === "win32" ? NodePath.win32 : NodePath.posix;
  return path.join(userHome, ".dsh");
}

/**
 * Resolves `AGENTS_HOME` (default `~/.agents`) matching `@deepseek-ai/dsh-skill-filesystem`.
 */
export function resolveAgentsHomeDirectory(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = HostProcess.Platform.defaultValue(),
): string | undefined {
  const explicit = readEnv(env, "AGENTS_HOME", platform);
  if (explicit) return explicit;
  const userHome = resolveUserHome(env, platform);
  if (!userHome) return undefined;
  const path = platform === "win32" ? NodePath.win32 : NodePath.posix;
  return path.join(userHome, ".agents");
}

/**
 * Walks up from `cwd` to locate the enclosing `.git` repository root, stopping before `userHome`
 * so directories under temp/home folders never misclassify `~/.dsh/skills` as project-scoped.
 */
export function findDshProjectRoot(
  cwd: string,
  platform: NodeJS.Platform = HostProcess.Platform.defaultValue(),
  fs: DshSkillsFs = DEFAULT_DSH_SKILLS_FS,
  userHome?: string,
): string {
  const path = platform === "win32" ? NodePath.win32 : NodePath.posix;
  const resolvedCwd = path.resolve(cwd);
  const normalizedHome = userHome
    ? (platform === "win32" ? path.resolve(userHome).toLowerCase() : path.resolve(userHome))
    : undefined;
  let cursor = resolvedCwd;
  for (let depth = 0; depth < MAX_PROJECT_ROOT_DEPTH; depth += 1) {
    const cursorKey = platform === "win32" ? cursor.toLowerCase() : cursor;
    if (normalizedHome !== undefined && cursorKey === normalizedHome && cursor !== resolvedCwd) {
      break;
    }
    const gitPath = path.join(cursor, ".git");
    if (fs.isDirectory(gitPath) || fs.isFile(gitPath)) {
      return cursor;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return resolvedCwd;
}

function unquoteYamlScalar(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\(["\\ntr])/gu, (_match, escaped: string) => {
        switch (escaped) {
          case "n":
            return "\n";
          case "t":
            return "\t";
          case "r":
            return "\r";
          default:
            return escaped;
        }
      });
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

function parseYamlBoolean(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "no") return false;
  return undefined;
}

export interface ParsedSkillFrontmatter {
  readonly name: string;
  readonly description?: string;
  readonly userInvocable?: boolean;
  readonly userInvocationOnly?: boolean;
}

/**
 * Zero-dependency YAML frontmatter parser for `SKILL.md` / flat skill Markdown files.
 * Supports LF/CRLF, quoted strings, and YAML folded/literal block scalars (`>`, `|`, `>-`, `|-`).
 */
export function parseSkillMarkdownFrontmatter(
  contents: string,
  fallbackName?: string,
): ParsedSkillFrontmatter | undefined {
  const normalized = contents.replace(/^\uFEFF/u, "");
  const lines = normalized.split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") return undefined;

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex === -1) return undefined;

  const fields = new Map<string, string>();
  for (let index = 1; index < closingIndex; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) continue;
    // Skip nested block keys; only read top-level frontmatter scalar fields.
    if (/^\s/u.test(line)) continue;
    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) continue;
    const key = line.slice(0, colonIndex).trim().toLowerCase();
    const rawValue = line.slice(colonIndex + 1).trim();

    if (/^[>|][+-]?$/u.test(rawValue)) {
      const folded = rawValue.startsWith(">");
      const blockLines: Array<string> = [];
      let blockIndent: number | undefined;
      while (index + 1 < closingIndex) {
        const nextLine = lines[index + 1] ?? "";
        if (nextLine.trim().length === 0) {
          blockLines.push("");
          index += 1;
          continue;
        }
        const indentMatch = /^(\s+)/u.exec(nextLine);
        if (!indentMatch) break;
        const indent = indentMatch[1]!.length;
        blockIndent ??= indent;
        if (indent < blockIndent) break;
        blockLines.push(nextLine.slice(blockIndent));
        index += 1;
      }
      const joined = folded
        ? blockLines
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
            .join(" ")
        : blockLines.join("\n").trim();
      fields.set(key, joined);
    } else {
      fields.set(key, unquoteYamlScalar(rawValue));
    }
  }

  const rawName = (fields.get("name") ?? fallbackName ?? "").trim();
  if (rawName.length === 0 || rawName.length > MAX_SKILL_NAME_LENGTH || /\s/u.test(rawName)) {
    return undefined;
  }

  const rawDescription = (fields.get("description") ?? fields.get("when-to-use") ?? fields.get("whentouse") ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_DESCRIPTION_LENGTH);

  const userInvocable = parseYamlBoolean(
    fields.get("user-invocable") ?? fields.get("userinvocable"),
  );
  const disableModelInvocation = parseYamlBoolean(
    fields.get("disable-model-invocation") ?? fields.get("disablemodelinvocation"),
  );

  return {
    name: rawName,
    ...(rawDescription.length > 0 ? { description: rawDescription } : {}),
    ...(userInvocable === false ? { userInvocable: false } : {}),
    ...(disableModelInvocation === true ? { userInvocationOnly: true } : {}),
  };
}

interface DshSkillRoot {
  readonly directory: string;
  readonly scope: "project" | "user" | "system";
}

function buildDshSkillRoots(input: {
  readonly cwd?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly fs: DshSkillsFs;
}): ReadonlyArray<DshSkillRoot> {
  const path = input.platform === "win32" ? NodePath.win32 : NodePath.posix;
  const normalizeKey = (directory: string) =>
    input.platform === "win32" ? path.resolve(directory).toLowerCase() : path.resolve(directory);
  const dshHome = resolveDshHomeDirectory(input.env, input.platform, input.fs);
  const agentsHome = resolveAgentsHomeDirectory(input.env, input.platform);
  const userHome = resolveUserHome(input.env, input.platform);
  const userSkillKeys = new Set<string>(
    [
      ...(dshHome ? [normalizeKey(path.join(dshHome, "skills"))] : []),
      ...(agentsHome ? [normalizeKey(path.join(agentsHome, "skills"))] : []),
      ...(userHome ? [normalizeKey(path.join(userHome, ".dsh", "skills"))] : []),
      ...(userHome ? [normalizeKey(path.join(userHome, ".agents", "skills"))] : []),
    ],
  );

  const roots: Array<DshSkillRoot> = [];
  const seen = new Set<string>();
  const pushRoot = (directory: string | undefined, scope: DshSkillRoot["scope"]) => {
    if (!directory) return;
    const normalized = path.resolve(directory);
    const key = normalizeKey(normalized);
    if (scope === "project" && userSkillKeys.has(key)) return;
    if (seen.has(key)) return;
    seen.add(key);
    roots.push({ directory: normalized, scope });
  };

  if (input.cwd && input.cwd.trim().length > 0) {
    const resolvedCwd = path.resolve(input.cwd);
    const projectRoot = findDshProjectRoot(resolvedCwd, input.platform, input.fs, userHome);
    // Exact priority match with @deepseek-ai/dsh-skill-filesystem:
    // project .dsh/skills -> project .agents/skills -> user DSH_HOME/skills -> user AGENTS_HOME/skills -> bundled
    pushRoot(path.join(resolvedCwd, ".dsh", "skills"), "project");
    pushRoot(path.join(projectRoot, ".dsh", "skills"), "project");
    pushRoot(path.join(resolvedCwd, ".agents", "skills"), "project");
    pushRoot(path.join(projectRoot, ".agents", "skills"), "project");
  }

  if (dshHome) {
    pushRoot(path.join(dshHome, "skills"), "user");
  }

  if (agentsHome) {
    pushRoot(path.join(agentsHome, "skills"), "user");
  }

  const bundledSkillDir = readEnv(input.env, "DSH_BUNDLED_SKILL_DIR", input.platform);
  if (bundledSkillDir) {
    pushRoot(bundledSkillDir, "system");
  }

  return roots;
}

/**
 * Discovers DeepSeek Harness local skills across workspace `.dsh/skills`, `.agents/skills`,
 * `DSH_HOME/skills` (`~/.dsh/skills`), `AGENTS_HOME/skills` (`~/.agents/skills`), and
 * optional `DSH_BUNDLED_SKILL_DIR`, following directory symlinks (such as Magpie Library links).
 */
export function discoverDshLocalSkills(input: {
  readonly cwd?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly fs?: DshSkillsFs;
}): ReadonlyArray<ServerProviderSkill> {
  const platform = input.platform ?? HostProcess.Platform.defaultValue();
  const fs = input.fs ?? DEFAULT_DSH_SKILLS_FS;
  const path = platform === "win32" ? NodePath.win32 : NodePath.posix;
  const roots = buildDshSkillRoots({
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    env: input.env,
    platform,
    fs,
  });

  const seenNames = new Set<string>();
  const skills: Array<ServerProviderSkill> = [];

  for (const root of roots) {
    if (!fs.isDirectory(root.directory)) continue;
    for (const entryName of fs.listEntryNames(root.directory)) {
      if (skills.length >= MAX_DISCOVERED_SKILLS) return skills;
      if (entryName.startsWith(".")) continue;
      // Match @deepseek-ai/dsh-skill-filesystem `skipSystem` on user DSH skills root.
      if (root.scope === "user" && entryName.toLowerCase() === ".system") continue;

      const entryPath = path.join(root.directory, entryName);
      let skillFilePath: string | undefined;
      let fallbackName: string | undefined;

      if (fs.isDirectory(entryPath)) {
        const candidate = path.join(entryPath, "SKILL.md");
        if (fs.isFile(candidate)) {
          skillFilePath = candidate;
          fallbackName = entryName;
        }
      } else if (/\.md$/iu.test(entryName) && fs.isFile(entryPath)) {
        skillFilePath = entryPath;
        fallbackName = entryName.replace(/\.md$/iu, "");
      }

      if (!skillFilePath) continue;
      const prefix = fs.readTextFilePrefix(skillFilePath, MAX_FRONTMATTER_BYTES);
      if (!prefix) continue;
      const parsed = parseSkillMarkdownFrontmatter(prefix, fallbackName);
      if (!parsed) continue;

      const key = parsed.name.toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);

      skills.push({
        name: parsed.name,
        ...(parsed.description ? { description: parsed.description } : {}),
        path: skillFilePath,
        scope: root.scope,
        enabled: true,
        ...(parsed.userInvocable === false ? { userInvocable: false } : {}),
        ...(parsed.userInvocationOnly === true ? { userInvocationOnly: true } : {}),
      });
    }
  }

  return skills;
}

function isSyntheticAcpSkill(skill: ServerProviderSkill): boolean {
  return skill.path.startsWith("acp://skill/");
}

/**
 * Merges ACP-advertised slash commands & skills with local/default overlays without duplicates.
 * - `slashCommands`: `primary` (ACP-advertised) wins over `overlay` (defaults) by lowercased name.
 * - `skills`: real filesystem skills (non-`acp://skill/` paths with real scopes) win over
 *   synthetic `acp://skill/...` placeholders; otherwise `primary` wins over `overlay`.
 */
export function mergeAcpCommandsAndSkills(
  primary: DshAvailableCommands,
  overlay: DshAvailableCommands,
): DshAvailableCommands {
  const seenCommands = new Set<string>();
  const slashCommands: Array<ServerProviderSlashCommand> = [];
  for (const command of [...primary.slashCommands, ...overlay.slashCommands]) {
    const key = command.name.trim().toLowerCase();
    if (!key || seenCommands.has(key)) continue;
    seenCommands.add(key);
    slashCommands.push(command);
  }

  const skillByKey = new Map<string, ServerProviderSkill>();
  const orderedKeys: Array<string> = [];
  const upsertSkill = (skill: ServerProviderSkill, isPrimary: boolean) => {
    const key = skill.name.trim().toLowerCase();
    if (!key) return;
    const existing = skillByKey.get(key);
    if (!existing) {
      orderedKeys.push(key);
      skillByKey.set(key, skill);
      return;
    }
    // Prefer real disk skills (with real path & user/project scope) over synthetic `acp://skill/`.
    if (isSyntheticAcpSkill(existing) && !isSyntheticAcpSkill(skill)) {
      skillByKey.set(key, {
        ...skill,
        ...(skill.description ? {} : existing.description ? { description: existing.description } : {}),
      });
      return;
    }
    if (isPrimary && isSyntheticAcpSkill(existing) === isSyntheticAcpSkill(skill)) {
      skillByKey.set(key, skill);
    }
  };

  for (const skill of primary.skills) upsertSkill(skill, true);
  for (const skill of overlay.skills) upsertSkill(skill, false);

  return {
    slashCommands,
    skills: orderedKeys.map((key) => skillByKey.get(key)!),
  };
}

/**
 * Augments ACP-advertised commands & skills for DeepSeek Harness (`dsh acp`) with DSH's
 * built-in slash commands and locally discovered `SKILL.md` skills.
 */
export function augmentDshAvailableCommands(
  advertised: DshAvailableCommands,
  input: {
    readonly cwd?: string;
    readonly env: NodeJS.ProcessEnv;
    readonly platform?: NodeJS.Platform;
    readonly fs?: DshSkillsFs;
  },
): DshAvailableCommands {
  const localSkills = discoverDshLocalSkills(input);
  return mergeAcpCommandsAndSkills(advertised, {
    slashCommands: DSH_BUILTIN_SLASH_COMMANDS,
    skills: localSkills,
  });
}
