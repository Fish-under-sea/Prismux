// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  npmNodeShimCommand,
  npmShimExecutable,
  type SpawnExecutableResolver,
} from "@prismux/core-shared/shell";

const BARE_DSH_COMMAND_PATTERN = /^dsh(?:\.cmd|\.exe)?$/iu;
const DSH_DESKTOP_EXE_PATTERN = /^(?:dsh\s+next|dsh|deepseek\s+harness)(?:\.exe)?$/iu;
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
    let cursor: unknown = parsed;
    for (const segment of relativeEntry.split("/")) {
      if (cursor === null || typeof cursor !== "object" || !("files" in cursor)) {
        return false;
      }
      const files = (cursor as { readonly files?: Record<string, unknown> }).files;
      if (!files || !Object.hasOwn(files, segment)) {
        return false;
      }
      cursor = files[segment];
    }
    return cursor !== null && typeof cursor === "object" && !("files" in cursor);
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

const DEFAULT_FS: LocalAcpResolutionFs = {
  isFile: defaultIsFile,
  isDirectory: defaultIsDirectory,
  readTextFile: defaultReadTextFile,
  hasAsarEntry: hasAsarEntrySync,
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

function resolveDshDesktopHome(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  fs: LocalAcpResolutionFs,
): string | undefined {
  if (readEnvValue(env, "DSH_HOME", platform) !== undefined) {
    return undefined;
  }
  const path = platform === "win32" ? NodePath.win32 : NodePath.posix;
  let lastHomeConfigPath: string | undefined;
  if (platform === "win32") {
    const userProfile = readEnvValue(env, "USERPROFILE", platform);
    const appData =
      readEnvValue(env, "APPDATA", platform) ??
      (userProfile ? path.join(userProfile, "AppData", "Roaming") : undefined);
    if (appData) {
      lastHomeConfigPath = path.join(appData, "DSH NEXT", "home", "desktop-next-last-home.json");
    }
  } else if (platform === "darwin") {
    const home = readEnvValue(env, "HOME", platform);
    if (home) {
      lastHomeConfigPath = path.join(
        home,
        "Library",
        "Application Support",
        "DSH NEXT",
        "home",
        "desktop-next-last-home.json",
      );
    }
  }
  if (!lastHomeConfigPath) return undefined;
  const raw = fs.readTextFile(lastHomeConfigPath);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { readonly home?: unknown };
    if (typeof parsed.home === "string" && parsed.home.trim().length > 0) {
      const candidate = parsed.home.trim();
      return fs.isDirectory(candidate) ? candidate : undefined;
    }
  } catch {}
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

/**
 * Discovers a packaged DSH Desktop (`DSH NEXT` / `DSH`) installation from environment-derived
 * standard install directories so `dsh acp` works seamlessly even when `dsh` is not on `PATH`.
 */
export function resolvePackagedDshDesktopSpawn(input: {
  readonly commandArgs: ReadonlyArray<string>;
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly fs?: LocalAcpResolutionFs;
}): LocalAcpSpawnResolution | undefined {
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

  // 2. Probe standard OS install directories derived strictly from `env` (keeps tests hermetic).
  const candidateExecutables: Array<string> = [];
  if (platform === "win32") {
    const userProfile = readEnvValue(env, "USERPROFILE", platform);
    const localAppData =
      readEnvValue(env, "LOCALAPPDATA", platform) ??
      (userProfile ? path.join(userProfile, "AppData", "Local") : undefined);
    const programFiles = readEnvValue(env, "ProgramFiles", platform);
    const roots = [
      ...(localAppData ? [path.join(localAppData, "Programs")] : []),
      ...(programFiles ? [programFiles] : []),
    ];
    for (const root of roots) {
      for (const candidate of WINDOWS_DSH_DESKTOP_CANDIDATES) {
        candidateExecutables.push(path.join(root, candidate.folder, candidate.executable));
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

  for (const executablePath of candidateExecutables) {
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

/**
 * Unwraps verified Windows `.cmd` shims (npm native `.exe` shim, npm Node `.cmd` shim,
 * pnpm Node `.cmd` shim, or DSH Desktop's internal `dsh.cmd` shim) into a direct
 * `shell: false` executable launch. Unknown/arbitrary batch scripts return `undefined`
 * so `validateLocalExecutable` continues rejecting them cleanly.
 */
export function unwrapWindowsLocalCmdShim(input: {
  readonly shimPath: string;
  readonly commandArgs: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
  readonly resolveExecutable: SpawnExecutableResolver;
  readonly fs?: LocalAcpResolutionFs;
}): LocalAcpSpawnResolution | undefined {
  if (!/\.cmd$/iu.test(input.shimPath)) {
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
      fs,
    });
  }
  return unwrapPnpmNodeCmdShim({
    shimPath: input.shimPath,
    contents,
    commandArgs: input.commandArgs,
    env: input.env,
    resolveExecutable: input.resolveExecutable,
    fs,
  });
}

/**
 * Resolves a local ACP spawn (`PATH`, Windows `.cmd` unwrap, and packaged DSH Desktop auto-discovery).
 */
export function resolveLocalAcpSpawn(input: {
  readonly commandPath: string;
  readonly commandArgs: ReadonlyArray<string>;
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly resolveExecutable: SpawnExecutableResolver;
  readonly fs?: LocalAcpResolutionFs;
}): LocalAcpSpawnResolution | undefined {
  const fs = input.fs ?? DEFAULT_FS;
  const executable = input.commandPath.trim();
  if (executable.length === 0) return undefined;

  const resolved = input.resolveExecutable(executable, input.platform, input.env);
  if (resolved !== undefined) {
    if (input.platform === "win32" && /\.cmd$/iu.test(resolved)) {
      const unwrapped = unwrapWindowsLocalCmdShim({
        shimPath: resolved,
        commandArgs: input.commandArgs,
        env: input.env,
        resolveExecutable: input.resolveExecutable,
        fs,
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
    if (input.platform === "win32") {
      const path = NodePath.win32;
      const userProfile = readEnvValue(input.env, "USERPROFILE", "win32");
      const appData =
        readEnvValue(input.env, "APPDATA", "win32") ??
        (userProfile ? path.join(userProfile, "AppData", "Roaming") : undefined);
      const localAppData =
        readEnvValue(input.env, "LOCALAPPDATA", "win32") ??
        (userProfile ? path.join(userProfile, "AppData", "Local") : undefined);
      const pnpmHome = readEnvValue(input.env, "PNPM_HOME", "win32");
      const fallbackBinDirs = [
        ...(pnpmHome ? [pnpmHome] : []),
        ...(appData ? [path.join(appData, "npm")] : []),
        ...(localAppData ? [path.join(localAppData, "pnpm")] : []),
        ...(userProfile ? [path.join(userProfile, ".local", "bin")] : []),
      ];
      for (const dir of fallbackBinDirs) {
        const exeCandidate = path.join(dir, "dsh.exe");
        if (fs.isFile(exeCandidate)) {
          return {
            command: exeCandidate,
            args: input.commandArgs,
            env: input.env,
          };
        }
        const cmdCandidate = path.join(dir, "dsh.cmd");
        if (fs.isFile(cmdCandidate)) {
          const unwrapped = unwrapWindowsLocalCmdShim({
            shimPath: cmdCandidate,
            commandArgs: input.commandArgs,
            env: input.env,
            resolveExecutable: input.resolveExecutable,
            fs,
          });
          if (unwrapped !== undefined) {
            return unwrapped;
          }
        }
      }
    }
    return resolvePackagedDshDesktopSpawn({
      commandArgs: input.commandArgs,
      platform: input.platform,
      env: input.env,
      fs,
    });
  }

  return undefined;
}
