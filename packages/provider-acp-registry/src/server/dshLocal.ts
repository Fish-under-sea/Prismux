// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as HostProcess from "@prismux/core-shared/HostProcess";
import {
  discoverWindowsUninstallInstallDirs,
  npmNodeShimCommand,
  npmShimExecutable,
  resolveKnownAgentCliDirs,
  type SpawnExecutableResolver,
  type WindowsRegistryQueryRunner,
} from "@prismux/core-shared/shell";

const BARE_DSH_COMMAND_PATTERN = /^dsh(?:\.cmd|\.bat|\.exe)?$/iu;
const DSH_DESKTOP_EXE_PATTERN = /^(?:dsh\s+next|dsh|deepseek\s+harness)(?:\.exe)?$/iu;
const DSH_UNINSTALL_ENTRY_PATTERN = /\b(?:dsh(?:\s+next)?|deepseek\s+harness)\b/iu;
const WINDOWS_UNINSTALLER_EXE_PATTERN = /(?:uninstall|uninst|setup|update|squirrel)/iu;
const WINDOWS_COMMON_DRIVES = ["C:", "D:", "E:", "F:"] as const;
const WINDOWS_DSH_DRIVE_SUBDIRS = [
  "DSH NEXT",
  "Program Files\\DSH NEXT",
  "Programs\\DSH NEXT",
  "DeepSeek Harness",
  "Program Files\\DeepSeek Harness",
  "Programs\\DeepSeek Harness",
  "DSH",
] as const;
const DSH_HOME_APP_FOLDERS = ["DSH NEXT", "DSH", "DeepSeek Harness"] as const;
const DSH_ENTRY_SCRIPT_PATTERN =
  /(?:^|[\\/])(?:resources[\\/]app\.asar[\\/]lib[\\/]desktop-cli\.js|@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js)$/iu;
const DSH_ASAR_BOOTSTRAP_ENTRIES = [
  "lib/desktop-cli.js",
  "node_modules/@deepseek-ai/dsh/lib/bin.js",
] as const;
const MAX_ASAR_HEADER_BYTES = 64 * 1024 * 1024;
const WINDOWS_DSH_DESKTOP_CANDIDATES = [
  { folder: "DSH NEXT", executable: "DSH NEXT.exe" },
  { folder: "DSH", executable: "DSH.exe" },
  { folder: "DeepSeek Harness", executable: "DeepSeek Harness.exe" },
] as const;
const MACOS_DSH_DESKTOP_CANDIDATES = [
  { bundle: "DSH NEXT.app", executable: "DSH NEXT" },
  { bundle: "DSH.app", executable: "DSH" },
  { bundle: "DeepSeek Harness.app", executable: "DeepSeek Harness" },
] as const;

// pnpm/npm global `.cmd` shims commonly invoke `"%_prog%" ... "%~dp0\..." %*`, `"%_prog%" "%dp0%\..." %*`, or `node "%~dp0\..." %*`.
const PNPM_NODE_SHIM_RUN =
  /"(?:%_prog%|node(?:\.exe)?)"\s+((?:--[^"% ]+\s+)*)"%(?:~dp0|dp0%)[\\/]+([^"%]+?\.(?:c|m)?js)"\s+%\*/iu;

export interface LocalAcpSpawnResolution {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
}

export interface LocalAcpResolutionFs {
  readonly isFile: (filePath: string) => boolean;
  readonly isDirectory: (filePath: string) => boolean;
  readonly readTextFile: (filePath: string) => string | undefined;
  readonly hasAsarEntry: (asarPath: string, relativeEntry: string) => boolean;
  readonly listDirectory?: (dirPath: string) => ReadonlyArray<string>;
}

function defaultListDirectory(dirPath: string): ReadonlyArray<string> {
  try {
    return NodeFS.readdirSync(dirPath);
  } catch {
    return [];
  }
}

function defaultIsFile(filePath: string): boolean {
  try {
    return NodeFS.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function defaultIsDirectory(filePath: string): boolean {
  try {
    return NodeFS.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function defaultReadTextFile(filePath: string): string | undefined {
  try {
    return NodeFS.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

const DSH_ASAR_PACKAGE_JSON_CANDIDATES = [
  "node_modules/@deepseek-ai/dsh/package.json",
  "node_modules/@deepseek-ai/dsh-acp/package.json",
  "package.json",
] as const;
const MAX_ASAR_TEXT_ENTRY_BYTES = 4 * 1024 * 1024;
const DSH_SEMVER_PATTERN = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/u;
const DSH_PACKAGE_NAME_PATTERN =
  /^(?:@deepseek-ai\/dsh(?:-[a-z0-9-]+)?|dsh|deepseek-harness)$/iu;

interface AsarFileLeaf {
  readonly size: number;
  readonly offset?: string | number;
  readonly unpacked?: boolean;
}

function lookupAsarLeafInHeader(
  parsed: { readonly files?: Record<string, unknown> },
  relativeEntry: string,
): AsarFileLeaf | undefined {
  let cursor: unknown = parsed;
  for (const segment of relativeEntry.split("/")) {
    if (cursor === null || typeof cursor !== "object" || !("files" in cursor)) {
      return undefined;
    }
    const files = (cursor as { readonly files?: Record<string, unknown> }).files;
    if (!files || !Object.hasOwn(files, segment)) {
      return undefined;
    }
    cursor = files[segment];
  }
  if (cursor === null || typeof cursor !== "object" || "files" in cursor) {
    return undefined;
  }
  const leaf = cursor as { size?: unknown; offset?: unknown; unpacked?: unknown };
  if (typeof leaf.size !== "number" || !Number.isFinite(leaf.size) || leaf.size < 0) {
    return undefined;
  }
  return {
    size: leaf.size,
    ...(typeof leaf.offset === "string" || typeof leaf.offset === "number"
      ? { offset: leaf.offset }
      : {}),
    ...(leaf.unpacked === true ? { unpacked: true } : {}),
  };
}

/**
 * Reads a UTF-8 text entry (such as `package.json`) directly from an Electron `app.asar`
 * archive — or from an unpacked/mock directory at `asarPath` — with zero subprocesses.
 */
export function readAsarTextEntrySync(asarPath: string, relativeEntry: string): string | undefined {
  const directPath = NodePath.join(asarPath, ...relativeEntry.split("/"));
  if (defaultIsFile(directPath)) {
    return defaultReadTextFile(directPath);
  }
  if (!defaultIsFile(asarPath)) {
    return undefined;
  }
  let fd: number | undefined;
  try {
    fd = NodeFS.openSync(asarPath, "r");
    const prefix = Buffer.alloc(16);
    if (NodeFS.readSync(fd, prefix, 0, 16, 0) < 16) return undefined;
    const headerSize = prefix.readUInt32LE(4);
    const jsonSize = prefix.readUInt32LE(12);
    if (
      headerSize === 0 ||
      jsonSize === 0 ||
      jsonSize > MAX_ASAR_HEADER_BYTES ||
      headerSize < jsonSize
    ) {
      return undefined;
    }
    const jsonBuffer = Buffer.alloc(jsonSize);
    if (NodeFS.readSync(fd, jsonBuffer, 0, jsonSize, 16) < jsonSize) return undefined;
    const parsed = JSON.parse(jsonBuffer.toString("utf8")) as {
      readonly files?: Record<string, unknown>;
    };
    const leaf = lookupAsarLeafInHeader(parsed, relativeEntry);
    if (leaf === undefined) return undefined;
    if (leaf.unpacked === true) {
      const unpackedPath = NodePath.join(`${asarPath}.unpacked`, ...relativeEntry.split("/"));
      return defaultIsFile(unpackedPath) ? defaultReadTextFile(unpackedPath) : undefined;
    }
    if (leaf.size > MAX_ASAR_TEXT_ENTRY_BYTES || leaf.offset === undefined) {
      return undefined;
    }
    const relOffset = Number(leaf.offset);
    if (!Number.isSafeInteger(relOffset) || relOffset < 0) return undefined;
    const dataOffset = 8 + headerSize + relOffset;
    const payload = Buffer.alloc(leaf.size);
    if (NodeFS.readSync(fd, payload, 0, leaf.size, dataOffset) < leaf.size) return undefined;
    return payload.toString("utf8");
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

/**
 * Checks whether `relativeEntry` (POSIX slash path) exists inside an Electron `app.asar`
 * archive — or inside an unpacked/mock directory at `asarPath` — in both Electron and plain
 * Node.js (where `fs.statSync(".../app.asar/lib/desktop-cli.js")` fails with `ENOTDIR`).
 */
export function hasAsarEntrySync(asarPath: string, relativeEntry: string): boolean {
  const directPath = NodePath.join(asarPath, ...relativeEntry.split("/"));
  if (defaultIsFile(directPath)) {
    return true;
  }
  if (!defaultIsFile(asarPath)) {
    return false;
  }
  let fd: number | undefined;
  try {
    fd = NodeFS.openSync(asarPath, "r");
    const prefix = Buffer.alloc(16);
    if (NodeFS.readSync(fd, prefix, 0, 16, 0) < 16) return false;
    const jsonSize = prefix.readUInt32LE(12);
    if (jsonSize === 0 || jsonSize > MAX_ASAR_HEADER_BYTES) return false;
    const jsonBuffer = Buffer.alloc(jsonSize);
    if (NodeFS.readSync(fd, jsonBuffer, 0, jsonSize, 16) < jsonSize) return false;
    const parsed = JSON.parse(jsonBuffer.toString("utf8")) as {
      readonly files?: Record<string, unknown>;
    };
    return lookupAsarLeafInHeader(parsed, relativeEntry) !== undefined;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        NodeFS.closeSync(fd);
      } catch {}
    }
  }
}

/**
 * Returns true when a reported DSH version is missing or `@deepseek-ai/dsh-acp`'s hardcoded
 * `"0.0.1"` placeholder.
 */
export function isPlaceholderDshVersion(version: string | null | undefined): boolean {
  if (typeof version !== "string") return true;
  const normalized = version.trim().replace(/^v/iu, "");
  return normalized.length === 0 || normalized === "0.0.0" || normalized === "0.0.1";
}

export function parseDshVersion(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const match = DSH_SEMVER_PATTERN.exec(raw.trim());
  const version = match?.[1]?.trim();
  if (!version || isPlaceholderDshVersion(version)) {
    return undefined;
  }
  return version;
}

/**
 * Prefers the real installed DSH version over `@deepseek-ai/dsh-acp`'s hardcoded `"0.0.1"`
 * `agentInfo.version`, falling back to `agentInfo.version` only if no real version was found.
 */
export function selectPreferredDshVersion(
  installedVersion: string | null | undefined,
  agentInfoVersion: string | null | undefined,
): string | undefined {
  const realInstalled = parseDshVersion(installedVersion);
  if (realInstalled !== undefined) {
    return realInstalled;
  }
  const fallback = agentInfoVersion?.trim();
  return fallback && fallback.length > 0 ? fallback : undefined;
}

export interface DshVersionResolutionFs {
  readonly isFile: (filePath: string) => boolean;
  readonly readTextFile: (filePath: string) => string | undefined;
  readonly readAsarTextEntry: (asarPath: string, relativeEntry: string) => string | undefined;
}

export interface ResolveDshInstalledVersionInput {
  readonly command: string;
  readonly args?: ReadonlyArray<string> | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly fs?: Partial<DshVersionResolutionFs> | undefined;
  readonly runVersionCommand?:
    | ((
        command: string,
        args: ReadonlyArray<string>,
        env: NodeJS.ProcessEnv,
      ) => string | undefined)
    | undefined;
}

function readPackageVersionJson(
  rawJson: string | undefined,
  options: { readonly requireDshName?: boolean } = {},
): string | undefined {
  if (!rawJson) return undefined;
  try {
    const parsed = JSON.parse(rawJson) as { readonly name?: unknown; readonly version?: unknown };
    if (
      options.requireDshName &&
      (typeof parsed.name !== "string" || !DSH_PACKAGE_NAME_PATTERN.test(parsed.name.trim()))
    ) {
      return undefined;
    }
    return parseDshVersion(typeof parsed.version === "string" ? parsed.version : undefined);
  } catch {
    return undefined;
  }
}

function extractAsarPathFromArg(arg: string): string | undefined {
  const match = /^(.*?[\\/]app\.asar)(?:[\\/]|$)/iu.exec(arg.trim());
  return match?.[1];
}

function resolveDshVersionFromAsarOrAppDir(
  asarPath: string,
  pathApi: typeof NodePath.win32 | typeof NodePath.posix,
  fs: DshVersionResolutionFs,
): string | undefined {
  for (const relativeEntry of DSH_ASAR_PACKAGE_JSON_CANDIDATES) {
    const version = readPackageVersionJson(fs.readAsarTextEntry(asarPath, relativeEntry));
    if (version !== undefined) return version;
  }
  const siblingAppDir = pathApi.join(pathApi.dirname(asarPath), "app");
  for (const relativeEntry of DSH_ASAR_PACKAGE_JSON_CANDIDATES) {
    const filePath = pathApi.join(siblingAppDir, ...relativeEntry.split("/"));
    if (fs.isFile(filePath)) {
      const version = readPackageVersionJson(fs.readTextFile(filePath));
      if (version !== undefined) return version;
    }
  }
  return undefined;
}

function resolveDshVersionWalkingParents(
  startDir: string,
  pathApi: typeof NodePath.win32 | typeof NodePath.posix,
  fs: DshVersionResolutionFs,
): string | undefined {
  let cursor = startDir;
  for (let depth = 0; depth <= 3; depth += 1) {
    const candidates: ReadonlyArray<{ readonly filePath: string; readonly requireDshName: boolean }> = [
      { filePath: pathApi.join(cursor, "package.json"), requireDshName: true },
      {
        filePath: pathApi.join(cursor, "node_modules", "@deepseek-ai", "dsh", "package.json"),
        requireDshName: false,
      },
      {
        filePath: pathApi.join(cursor, "node_modules", "@deepseek-ai", "dsh-acp", "package.json"),
        requireDshName: false,
      },
    ];
    for (const candidate of candidates) {
      if (fs.isFile(candidate.filePath)) {
        const version = readPackageVersionJson(fs.readTextFile(candidate.filePath), {
          requireDshName: candidate.requireDshName,
        });
        if (version !== undefined) return version;
      }
    }
    const parent = pathApi.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return undefined;
}

function defaultRunDshVersionCommand(
  command: string,
  args: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv,
): string | undefined {
  try {
    const output = NodeChildProcess.execFileSync(command, args, {
      env,
      encoding: "utf8",
      timeout: 1_500,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return typeof output === "string" ? output : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the real installed DeepSeek Harness (`dsh` / `DSH NEXT`) version directly from
 * packaged Electron `app.asar` metadata, sibling unpacked `resources/app/package.json`,
 * npm package `package.json`, or (for standalone `dsh` binaries) `dsh --version`.
 */
export function resolveDshInstalledVersion(
  launch: ResolveDshInstalledVersionInput,
): string | undefined {
  const platform = launch.platform ?? HostProcess.Platform.defaultValue();
  const pathApi = platform === "win32" ? NodePath.win32 : NodePath.posix;
  const fs: DshVersionResolutionFs = {
    isFile: launch.fs?.isFile ?? defaultIsFile,
    readTextFile: launch.fs?.readTextFile ?? defaultReadTextFile,
    readAsarTextEntry: launch.fs?.readAsarTextEntry ?? readAsarTextEntrySync,
  };
  const command = launch.command.trim();
  const args = launch.args ?? [];
  const env = launch.env ?? HostProcess.Environment.defaultValue();

  // 1. Packaged Electron `.asar` path inside args (e.g. `.../resources/app.asar/lib/desktop-cli.js`)
  for (const arg of args) {
    const asarPath = extractAsarPathFromArg(arg);
    if (asarPath !== undefined) {
      const version = resolveDshVersionFromAsarOrAppDir(asarPath, pathApi, fs);
      if (version !== undefined) return version;
    }
  }

  // 2. Electron desktop executable next to `resources/app.asar` / `../Resources/app.asar`
  const commandBasename = command.split(/[\\/]/u).at(-1) ?? "";
  if (command.length > 0 && DSH_DESKTOP_EXE_PATTERN.test(commandBasename)) {
    const appDir = pathApi.dirname(command);
    const asarCandidates =
      platform === "darwin"
        ? [
            pathApi.resolve(appDir, "..", "Resources", "app.asar"),
            pathApi.join(appDir, "resources", "app.asar"),
          ]
        : [pathApi.join(appDir, "resources", "app.asar")];
    for (const asarPath of asarCandidates) {
      const version = resolveDshVersionFromAsarOrAppDir(asarPath, pathApi, fs);
      if (version !== undefined) return version;
    }
  }

  // 3. Standalone JS script path in args (e.g. `node .../node_modules/@deepseek-ai/dsh/lib/bin.js acp`)
  for (const arg of args) {
    const trimmed = arg.trim();
    if (
      /\.(?:c|m)?js$/iu.test(trimmed) &&
      extractAsarPathFromArg(trimmed) === undefined &&
      (trimmed.includes("/") || trimmed.includes("\\"))
    ) {
      const version = resolveDshVersionWalkingParents(pathApi.dirname(trimmed), pathApi, fs);
      if (version !== undefined) return version;
    }
  }

  // 4. Standalone binary path on disk (walking up 1-3 parent directories for package.json)
  if (command.includes("/") || command.includes("\\")) {
    const version = resolveDshVersionWalkingParents(pathApi.dirname(command), pathApi, fs);
    if (version !== undefined) return version;
  }

  // 5. Fallback `dsh --version` ONLY for standalone `dsh` binaries (never arbitrary node scripts)
  if (command.length > 0 && BARE_DSH_COMMAND_PATTERN.test(commandBasename)) {
    const runner = launch.runVersionCommand ?? defaultRunDshVersionCommand;
    const output = runner(command, ["--version"], env);
    const parsed = parseDshVersion(output);
    if (parsed !== undefined) return parsed;
  }

  return undefined;
}

const DEFAULT_FS: LocalAcpResolutionFs = {
  isFile: defaultIsFile,
  isDirectory: defaultIsDirectory,
  readTextFile: defaultReadTextFile,
  hasAsarEntry: hasAsarEntrySync,
  listDirectory: defaultListDirectory,
};

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

function withEnvOverrides(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  overrides: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  const overrideUpperKeys = new Set(Object.keys(overrides).map((key) => key.toUpperCase()));
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    const compareKey = platform === "win32" ? key.toUpperCase() : key;
    if (
      (platform === "win32" && overrideUpperKeys.has(compareKey)) ||
      (platform !== "win32" && Object.hasOwn(overrides, key))
    ) {
      continue;
    }
    next[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

function isBareDshCommand(commandPath: string): boolean {
  const trimmed = commandPath.trim();
  return (
    !trimmed.includes("/") && !trimmed.includes("\\") && BARE_DSH_COMMAND_PATTERN.test(trimmed)
  );
}

export function isDshEntryScriptArg(arg: string): boolean {
  return DSH_ENTRY_SCRIPT_PATTERN.test(arg.trim());
}

/**
 * Returns true when a local ACP spawn launches DeepSeek Harness (`dsh`), either directly,
 * through an unwrapped npm/pnpm Node script (`@deepseek-ai/dsh/lib/bin.js`), or through
 * packaged DSH Desktop (`DSH NEXT.exe --expose-internals .../resources/app.asar/lib/desktop-cli.js`).
 */
export function isDeepSeekHarnessSpawn(commandPath: string, args: ReadonlyArray<string>): boolean {
  const basename = commandPath.trim().split(/[\\/]/u).at(-1) ?? "";
  return BARE_DSH_COMMAND_PATTERN.test(basename) || args.some(isDshEntryScriptArg);
}

/**
 * Returns the index in `args` where `dsh`'s own CLI arguments begin (e.g. `"acp"` or
 * `"--profile"`), skipping leading runtime flags (`--expose-internals`) and JS entry paths.
 */
export function findDeepSeekCliArgStart(args: ReadonlyArray<string>): number {
  const entryIndex = args.findIndex(isDshEntryScriptArg);
  if (entryIndex !== -1) {
    return entryIndex + 1;
  }
  let index = 0;
  while (index < args.length && args[index] === "--expose-internals") {
    index += 1;
  }
  const candidateScript = args[index];
  if (candidateScript !== undefined && /\.(?:c|m)?js$/iu.test(candidateScript)) {
    return index + 1;
  }
  return 0;
}

export function resolveDshDesktopHome(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  fs: Pick<LocalAcpResolutionFs, "isDirectory" | "readTextFile"> = DEFAULT_FS,
): string | undefined {
  if (readEnvValue(env, "DSH_HOME", platform) !== undefined) {
    return undefined;
  }
  const path = platform === "win32" ? NodePath.win32 : NodePath.posix;
  const lastHomeConfigCandidates: Array<string> = [];
  let fallbackDotDshDir: string | undefined;
  if (platform === "win32") {
    const userProfile = readEnvValue(env, "USERPROFILE", platform);
    const appData =
      readEnvValue(env, "APPDATA", platform) ??
      (userProfile ? path.join(userProfile, "AppData", "Roaming") : undefined);
    if (appData) {
      for (const appFolder of DSH_HOME_APP_FOLDERS) {
        lastHomeConfigCandidates.push(
          path.join(appData, appFolder, "home", "desktop-next-last-home.json"),
        );
      }
    }
    if (userProfile) {
      fallbackDotDshDir = path.join(userProfile, ".dsh");
    }
  } else if (platform === "darwin") {
    const home = readEnvValue(env, "HOME", platform);
    if (home) {
      for (const appFolder of DSH_HOME_APP_FOLDERS) {
        lastHomeConfigCandidates.push(
          path.join(
            home,
            "Library",
            "Application Support",
            appFolder,
            "home",
            "desktop-next-last-home.json",
          ),
        );
      }
      fallbackDotDshDir = path.join(home, ".dsh");
    }
  } else {
    const home = readEnvValue(env, "HOME", platform);
    const xdgConfigHome =
      readEnvValue(env, "XDG_CONFIG_HOME", platform) ??
      (home ? path.join(home, ".config") : undefined);
    if (xdgConfigHome) {
      for (const appFolder of DSH_HOME_APP_FOLDERS) {
        lastHomeConfigCandidates.push(
          path.join(xdgConfigHome, appFolder, "home", "desktop-next-last-home.json"),
        );
      }
    }
    if (home) {
      fallbackDotDshDir = path.join(home, ".dsh");
    }
  }
  for (const configPath of lastHomeConfigCandidates) {
    const raw = fs.readTextFile(configPath);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { readonly home?: unknown };
      if (typeof parsed.home === "string" && parsed.home.trim().length > 0) {
        const candidate = parsed.home.trim();
        if (fs.isDirectory(candidate)) return candidate;
      }
    } catch {}
  }
  if (fallbackDotDshDir && fs.isDirectory(fallbackDotDshDir)) {
    return fallbackDotDshDir;
  }
  return undefined;
}

function resolveDshBootstrapForExecutable(
  executablePath: string,
  platform: NodeJS.Platform,
  fs: LocalAcpResolutionFs,
): string | undefined {
  if (!fs.isFile(executablePath)) return undefined;
  const path = platform === "win32" ? NodePath.win32 : NodePath.posix;
  const appDir = path.dirname(executablePath);
  const asarPath =
    platform === "darwin"
      ? path.resolve(appDir, "..", "Resources", "app.asar")
      : path.join(appDir, "resources", "app.asar");
  for (const relativeEntry of DSH_ASAR_BOOTSTRAP_ENTRIES) {
    if (fs.hasAsarEntry(asarPath, relativeEntry)) {
      return path.join(asarPath, ...relativeEntry.split("/"));
    }
  }
  return undefined;
}

function buildDshDesktopSpawn(input: {
  readonly executablePath: string;
  readonly bootstrapPath: string;
  readonly commandArgs: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly fs: LocalAcpResolutionFs;
}): LocalAcpSpawnResolution {
  const alreadyBootstrapped = input.commandArgs.some(isDshEntryScriptArg);
  const args = alreadyBootstrapped
    ? [...input.commandArgs]
    : ["--expose-internals", input.bootstrapPath, ...input.commandArgs];
  const dshHome = resolveDshDesktopHome(input.env, input.platform, input.fs);
  // Clear DSH_DESKTOP_DEFAULT_PROFILE so packaged desktop-cli.js never rewrites `acp` into `--profile desktop acp`.
  const env = withEnvOverrides(input.env, input.platform, {
    ELECTRON_RUN_AS_NODE: "1",
    DSH_DESKTOP_DEFAULT_PROFILE: undefined,
    ...(dshHome ? { DSH_HOME: dshHome } : {}),
  });
  return {
    command: input.executablePath,
    args,
    env,
  };
}

function collectWindowsDshDirExecutableCandidates(
  installDir: string,
  fs: LocalAcpResolutionFs,
): ReadonlyArray<string> {
  const path = NodePath.win32;
  const candidates: Array<string> = [];
  for (const known of WINDOWS_DSH_DESKTOP_CANDIDATES) {
    candidates.push(path.join(installDir, known.executable));
  }
  if (fs.listDirectory) {
    for (const entryName of fs.listDirectory(installDir)) {
      if (!/\.exe$/iu.test(entryName) || WINDOWS_UNINSTALLER_EXE_PATTERN.test(entryName)) {
        continue;
      }
      candidates.push(path.join(installDir, entryName));
    }
  }
  return candidates;
}

/**
 * Discovers a packaged DSH Desktop (`DSH NEXT` / `DSH` / `DeepSeek Harness`) installation from
 * environment-derived standard install directories, Windows Uninstall Registry entries, and
 * common cross-drive roots so `dsh acp` works seamlessly even when `dsh` is not on `PATH`.
 */
export function resolvePackagedDshDesktopSpawn(input: {
  readonly commandArgs: ReadonlyArray<string>;
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly fs?: LocalAcpResolutionFs;
  readonly queryRegistry?: WindowsRegistryQueryRunner;
  readonly probeDriveRoots?: boolean;
}): LocalAcpSpawnResolution | undefined {
  const usingDefaultHostFs = input.fs === undefined;
  const fs = input.fs ?? DEFAULT_FS;
  const { platform, env } = input;
  const path = platform === "win32" ? NodePath.win32 : NodePath.posix;

  // 1. Honor explicit DSH Desktop launcher env vars if present and valid.
  const explicitApp = readEnvValue(env, "DSH_DESKTOP_APP_EXECUTABLE", platform);
  const explicitBootstrap = readEnvValue(env, "DSH_DESKTOP_DSH_BOOTSTRAP", platform);
  if (explicitApp && explicitBootstrap && fs.isFile(explicitApp)) {
    return buildDshDesktopSpawn({
      executablePath: explicitApp,
      bootstrapPath: explicitBootstrap,
      commandArgs: input.commandArgs,
      env,
      platform,
      fs,
    });
  }

  // 2. Probe standard OS install directories, Windows Uninstall Registry, and common drive roots.
  const candidateExecutables: Array<string> = [];
  if (platform === "win32") {
    const userProfile = readEnvValue(env, "USERPROFILE", platform);
    const localAppData =
      readEnvValue(env, "LOCALAPPDATA", platform) ??
      (userProfile ? path.join(userProfile, "AppData", "Local") : undefined);
    const programFiles = readEnvValue(env, "ProgramFiles", platform);
    const programFilesX86 = readEnvValue(env, "ProgramFiles(x86)", platform);
    const envRoots = [
      ...(localAppData ? [path.join(localAppData, "Programs"), localAppData] : []),
      ...(programFiles ? [programFiles] : []),
      ...(programFilesX86 ? [programFilesX86] : []),
    ];
    for (const root of envRoots) {
      for (const candidate of WINDOWS_DSH_DESKTOP_CANDIDATES) {
        candidateExecutables.push(path.join(root, candidate.folder, candidate.executable));
      }
    }

    // Never spawn live `reg.exe` when a custom mock `fs` is injected unless `queryRegistry` is provided.
    if (usingDefaultHostFs || input.queryRegistry !== undefined) {
      const registryInstallDirs = discoverWindowsUninstallInstallDirs({
        cacheKey: "dsh",
        searchTerms: ["DSH", "DeepSeek"],
        matchEntry: (entry) =>
          DSH_UNINSTALL_ENTRY_PATTERN.test(entry.displayName ?? "") ||
          DSH_UNINSTALL_ENTRY_PATTERN.test(entry.comments ?? "") ||
          DSH_UNINSTALL_ENTRY_PATTERN.test(entry.uninstallString ?? "") ||
          DSH_UNINSTALL_ENTRY_PATTERN.test(entry.displayIcon ?? ""),
        ...(input.queryRegistry ? { queryRegistry: input.queryRegistry } : {}),
      });
      for (const installDir of registryInstallDirs) {
        candidateExecutables.push(...collectWindowsDshDirExecutableCandidates(installDir, fs));
      }
    }

    // Probe common drive roots only on default host FS (or when explicitly opted-in for tests).
    if (input.probeDriveRoots ?? usingDefaultHostFs) {
      for (const drive of WINDOWS_COMMON_DRIVES) {
        for (const subdir of WINDOWS_DSH_DRIVE_SUBDIRS) {
          const installDir = `${drive}\\${subdir}`;
          if (!fs.isDirectory(installDir)) continue;
          candidateExecutables.push(...collectWindowsDshDirExecutableCandidates(installDir, fs));
        }
      }
    }
  } else if (platform === "darwin") {
    const home = readEnvValue(env, "HOME", platform);
    if (home) {
      for (const root of ["/Applications", path.join(home, "Applications")]) {
        for (const candidate of MACOS_DSH_DESKTOP_CANDIDATES) {
          candidateExecutables.push(
            path.join(root, candidate.bundle, "Contents", "MacOS", candidate.executable),
          );
        }
      }
    }
  }

  const seenExecutables = new Set<string>();
  for (const executablePath of candidateExecutables) {
    const dedupeKey = platform === "win32" ? executablePath.toLowerCase() : executablePath;
    if (seenExecutables.has(dedupeKey)) continue;
    seenExecutables.add(dedupeKey);
    const bootstrapPath = resolveDshBootstrapForExecutable(executablePath, platform, fs);
    if (bootstrapPath !== undefined) {
      return buildDshDesktopSpawn({
        executablePath,
        bootstrapPath,
        commandArgs: input.commandArgs,
        env,
        platform,
        fs,
      });
    }
  }

  return undefined;
}

function isDshDesktopInternalCmdShim(contents: string): boolean {
  return (
    contents.includes("%DSH_DESKTOP_APP_EXECUTABLE%") &&
    contents.includes("%DSH_DESKTOP_DSH_BOOTSTRAP%")
  );
}

function unwrapPnpmNodeCmdShim(input: {
  readonly shimPath: string;
  readonly contents: string;
  readonly commandArgs: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
  readonly resolveExecutable: SpawnExecutableResolver;
  readonly fs: LocalAcpResolutionFs;
}): LocalAcpSpawnResolution | undefined {
  const path = NodePath.win32;
  const match = PNPM_NODE_SHIM_RUN.exec(input.contents);
  if (!match) return undefined;
  const rawFlags = match[1]?.trim() ?? "";
  const relativeTarget = match[2];
  if (!relativeTarget) return undefined;
  const shimDir = path.dirname(input.shimPath);
  const scriptPath = path.join(shimDir, relativeTarget);
  if (!input.fs.isFile(scriptPath)) return undefined;
  const bundledNode = path.join(shimDir, "node.exe");
  const nodeExecutable = input.fs.isFile(bundledNode)
    ? bundledNode
    : input.resolveExecutable("node", "win32", input.env);
  if (!nodeExecutable || path.extname(nodeExecutable).toLowerCase() !== ".exe") {
    return undefined;
  }
  const nodeFlags = rawFlags.length > 0 ? rawFlags.split(/\s+/u) : [];
  return {
    command: nodeExecutable,
    args: [...nodeFlags, scriptPath, ...input.commandArgs],
    env: input.env,
  };
}

const GENERIC_BAT_EXE_SHIM =
  /^\s*@?(?:call\s+)?"%(?:~dp0|dp0%)\\?([^"\r\n]+\.exe)"(?:\s+%\*)?\s*$/imu;
const GENERIC_BAT_NODE_SHIM =
  /^\s*@?"?(?:node(?:\.exe)?)"?\s+"%(?:~dp0|dp0%)\\?([^"\r\n]+\.(?:js|mjs|cjs))"(?:\s+%\*)?\s*$/imu;

function unwrapSimpleBatShim(input: {
  readonly shimPath: string;
  readonly contents: string;
  readonly commandArgs: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
  readonly resolveExecutable: SpawnExecutableResolver;
  readonly fs: LocalAcpResolutionFs;
}): LocalAcpSpawnResolution | undefined {
  const path = NodePath.win32;
  const shimDir = path.dirname(input.shimPath);
  const exeMatch = GENERIC_BAT_EXE_SHIM.exec(input.contents);
  if (exeMatch?.[1]) {
    const targetExe = path.join(shimDir, exeMatch[1]);
    if (input.fs.isFile(targetExe)) {
      return {
        command: targetExe,
        args: [...input.commandArgs],
        env: input.env,
      };
    }
  }
  const nodeMatch = GENERIC_BAT_NODE_SHIM.exec(input.contents);
  if (nodeMatch?.[1]) {
    const scriptPath = path.join(shimDir, nodeMatch[1]);
    if (!input.fs.isFile(scriptPath)) return undefined;
    const bundledNode = path.join(shimDir, "node.exe");
    const nodeExecutable = input.fs.isFile(bundledNode)
      ? bundledNode
      : input.resolveExecutable("node", "win32", input.env);
    if (!nodeExecutable || path.extname(nodeExecutable).toLowerCase() !== ".exe") {
      return undefined;
    }
    return {
      command: nodeExecutable,
      args: [scriptPath, ...input.commandArgs],
      env: input.env,
    };
  }
  return undefined;
}

/**
 * Unwraps verified Windows `.cmd` / `.bat` shims (npm native `.exe` shim, npm Node `.cmd` shim,
 * pnpm Node `.cmd` shim, Scoop/simple `.bat` shim, or DSH Desktop's internal `dsh.cmd` shim)
 * into a direct `shell: false` executable launch. Unknown/arbitrary batch scripts return
 * `undefined` so `validateLocalExecutable` continues rejecting them cleanly.
 */
export function unwrapWindowsLocalCmdShim(input: {
  readonly shimPath: string;
  readonly commandArgs: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
  readonly resolveExecutable: SpawnExecutableResolver;
  readonly fs?: LocalAcpResolutionFs;
  readonly queryRegistry?: WindowsRegistryQueryRunner;
  readonly probeDriveRoots?: boolean;
}): LocalAcpSpawnResolution | undefined {
  if (!/\.(?:cmd|bat)$/iu.test(input.shimPath)) {
    return undefined;
  }
  const fs = input.fs ?? DEFAULT_FS;
  const nativeExe = npmShimExecutable(input.shimPath, fs.readTextFile, fs.isFile);
  if (nativeExe !== undefined) {
    return {
      command: nativeExe,
      args: [...input.commandArgs],
      env: input.env,
    };
  }
  const npmNode = npmNodeShimCommand(
    input.shimPath,
    input.commandArgs,
    input.env,
    input.resolveExecutable,
    fs.readTextFile,
    fs.isFile,
  );
  if (npmNode !== undefined) {
    return {
      command: npmNode.command,
      args: npmNode.args,
      env: input.env,
    };
  }
  const contents = fs.readTextFile(input.shimPath);
  if (!contents) return undefined;
  if (isDshDesktopInternalCmdShim(contents)) {
    return resolvePackagedDshDesktopSpawn({
      commandArgs: input.commandArgs,
      platform: "win32",
      env: input.env,
      ...(input.fs ? { fs: input.fs } : {}),
      ...(input.queryRegistry ? { queryRegistry: input.queryRegistry } : {}),
      ...(input.probeDriveRoots !== undefined ? { probeDriveRoots: input.probeDriveRoots } : {}),
    });
  }
  return (
    unwrapPnpmNodeCmdShim({
      shimPath: input.shimPath,
      contents,
      commandArgs: input.commandArgs,
      env: input.env,
      resolveExecutable: input.resolveExecutable,
      fs,
    }) ??
    unwrapSimpleBatShim({
      shimPath: input.shimPath,
      contents,
      commandArgs: input.commandArgs,
      env: input.env,
      resolveExecutable: input.resolveExecutable,
      fs,
    })
  );
}

function resolveBareCommandInFallbackDirs(input: {
  readonly baseName: string;
  readonly commandArgs: ReadonlyArray<string>;
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly resolveExecutable: SpawnExecutableResolver;
  readonly fs?: LocalAcpResolutionFs;
  readonly queryRegistry?: WindowsRegistryQueryRunner;
  readonly probeDriveRoots?: boolean;
}): LocalAcpSpawnResolution | undefined {
  const fs = input.fs ?? DEFAULT_FS;
  const fallbackBinDirs = resolveKnownAgentCliDirs(input.env, input.platform);
  if (fallbackBinDirs.length === 0) return undefined;
  const path = input.platform === "win32" ? NodePath.win32 : NodePath.posix;
  const strippedName =
    input.platform === "win32"
      ? input.baseName.replace(/\.(?:exe|cmd|bat)$/iu, "")
      : input.baseName;

  for (const dir of fallbackBinDirs) {
    if (input.platform === "win32") {
      const exeCandidate = path.join(dir, `${strippedName}.exe`);
      if (fs.isFile(exeCandidate)) {
        return {
          command: exeCandidate,
          args: input.commandArgs,
          env: input.env,
        };
      }
      for (const ext of [".cmd", ".bat"] as const) {
        const shimCandidate = path.join(dir, `${strippedName}${ext}`);
        if (!fs.isFile(shimCandidate)) continue;
        const unwrapped = unwrapWindowsLocalCmdShim({
          shimPath: shimCandidate,
          commandArgs: input.commandArgs,
          env: input.env,
          resolveExecutable: input.resolveExecutable,
          ...(input.fs ? { fs: input.fs } : {}),
          ...(input.queryRegistry ? { queryRegistry: input.queryRegistry } : {}),
          ...(input.probeDriveRoots !== undefined
            ? { probeDriveRoots: input.probeDriveRoots }
            : {}),
        });
        if (unwrapped !== undefined) {
          return unwrapped;
        }
      }
    } else {
      const candidate = path.join(dir, strippedName);
      if (fs.isFile(candidate)) {
        return {
          command: candidate,
          args: input.commandArgs,
          env: input.env,
        };
      }
    }
  }
  return undefined;
}

/**
 * Resolves a local ACP spawn (`PATH`, Windows `.cmd`/`.bat` unwrap, standard CLI bin dir
 * fallback, and packaged DSH Desktop auto-discovery across Uninstall Registry & drive roots).
 */
export function resolveLocalAcpSpawn(input: {
  readonly commandPath: string;
  readonly commandArgs: ReadonlyArray<string>;
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly resolveExecutable: SpawnExecutableResolver;
  readonly fs?: LocalAcpResolutionFs;
  readonly queryRegistry?: WindowsRegistryQueryRunner;
  readonly probeDriveRoots?: boolean;
}): LocalAcpSpawnResolution | undefined {
  const fs = input.fs ?? DEFAULT_FS;
  const executable = input.commandPath.trim();
  if (executable.length === 0) return undefined;

  const resolved = input.resolveExecutable(executable, input.platform, input.env);
  if (resolved !== undefined) {
    if (input.platform === "win32" && /\.(?:cmd|bat)$/iu.test(resolved)) {
      const unwrapped = unwrapWindowsLocalCmdShim({
        shimPath: resolved,
        commandArgs: input.commandArgs,
        env: input.env,
        resolveExecutable: input.resolveExecutable,
        ...(input.fs ? { fs: input.fs } : {}),
        ...(input.queryRegistry ? { queryRegistry: input.queryRegistry } : {}),
        ...(input.probeDriveRoots !== undefined ? { probeDriveRoots: input.probeDriveRoots } : {}),
      });
      if (unwrapped !== undefined) {
        return unwrapped;
      }
    }
    const basename = resolved.split(/[\\/]/u).at(-1) ?? "";
    if (DSH_DESKTOP_EXE_PATTERN.test(basename)) {
      const bootstrapPath = resolveDshBootstrapForExecutable(resolved, input.platform, fs);
      if (bootstrapPath !== undefined) {
        return buildDshDesktopSpawn({
          executablePath: resolved,
          bootstrapPath,
          commandArgs: input.commandArgs,
          env: input.env,
          platform: input.platform,
          fs,
        });
      }
    }
    return {
      command: resolved,
      args: input.commandArgs,
      env: input.env,
    };
  }

  if (isBareDshCommand(executable)) {
    const cliFallback = resolveBareCommandInFallbackDirs({
      baseName: "dsh",
      commandArgs: input.commandArgs,
      platform: input.platform,
      env: input.env,
      resolveExecutable: input.resolveExecutable,
      ...(input.fs ? { fs: input.fs } : {}),
      ...(input.queryRegistry ? { queryRegistry: input.queryRegistry } : {}),
      ...(input.probeDriveRoots !== undefined ? { probeDriveRoots: input.probeDriveRoots } : {}),
    });
    if (cliFallback !== undefined) {
      return cliFallback;
    }
    return resolvePackagedDshDesktopSpawn({
      commandArgs: input.commandArgs,
      platform: input.platform,
      env: input.env,
      ...(input.fs ? { fs: input.fs } : {}),
      ...(input.queryRegistry ? { queryRegistry: input.queryRegistry } : {}),
      ...(input.probeDriveRoots !== undefined ? { probeDriveRoots: input.probeDriveRoots } : {}),
    });
  }

  if (!executable.includes("/") && !executable.includes("\\")) {
    return resolveBareCommandInFallbackDirs({
      baseName: executable,
      commandArgs: input.commandArgs,
      platform: input.platform,
      env: input.env,
      resolveExecutable: input.resolveExecutable,
      ...(input.fs ? { fs: input.fs } : {}),
      ...(input.queryRegistry ? { queryRegistry: input.queryRegistry } : {}),
      ...(input.probeDriveRoots !== undefined ? { probeDriveRoots: input.probeDriveRoots } : {}),
    });
  }

  return undefined;
}
