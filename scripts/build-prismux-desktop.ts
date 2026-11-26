import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  formatSoftwareSumsFilename,
  readRepoVersion,
  resolveRustEnv,
  resolveSevenZipPath,
  sha256File,
  verifyArchiveWithSevenZip,
  writeConsolidatedSha256File,
} from "./build-release-packages.ts";

export const ROOT_DESKTOP_BUILD_FILTERS = [
  "@prismux/protocol",
  "@prismux/memory-core",
  "@prismux/cordis-kernel",
  "@prismux/sync-vault",
  "@prismux/appearance",
  "@prismux/wallpaper",
  "@prismux/daemon",
] as const;

export const RESOURCE_MONITOR_TARGET = "x86_64-pc-windows-msvc" as const;

export interface DesktopCommandInvocation {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  label: string;
}

export interface DesktopCommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type DesktopCommandRunner = (invocation: DesktopCommandInvocation) => DesktopCommandResult;

export interface BuildPrismuxDesktopOptions {
  repoRoot?: string;
  version?: string;
  outDir?: string;
  installer?: boolean;
  skipRust?: boolean;
  skipRootBuild?: boolean;
  dryRun?: boolean;
  runner?: DesktopCommandRunner;
  verifySevenZip?: (sevenZipPath: string, archivePath: string) => void;
}

export interface BuildPrismuxDesktopResult {
  version: string;
  outDir: string;
  resourceMonitorPath: string;
  sqliteVecPath: string | null;
  sqliteVecBytes: number | null;
  installerExePath: string | null;
  installerSha256: string | null;
  checksumPath: string | null;
  executedSteps: string[];
}

export interface StagedSqliteVecBinary {
  sourcePath: string;
  stagedPath: string;
  bytes: number;
}

export interface ParsedBuildDesktopCliArgs {
  help: boolean;
  options: BuildPrismuxDesktopOptions;
}

const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
] as const;

// Guard against bundling active (`plugin-qq`) or legacy official plugin directories/archives.
const FORBIDDEN_PLUGIN_ARCHIVE_PREFIXES = [
  "plugins-official",
  "plugin-",
  "prismux-plugin-",
] as const;

export function sanitizeDesktopBuildEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  extraEnv: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env = resolveRustEnv(baseEnv);
  for (const key of PROXY_ENV_KEYS) {
    delete env[key];
  }
  env["NO_PROXY"] = "*";
  delete env["ELECTRON_RUN_AS_NODE"];
  delete env["ELECTRON_NO_ATTACH_CONSOLE"];

  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}

function formatShellCommandForWindows(command: string, args: readonly string[]): string {
  const quoteArg = (arg: string): string => {
    if (arg.length === 0 || /[\s"&|<>^()]/.test(arg)) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }
    return arg;
  };
  return [quoteArg(command), ...args.map(quoteArg)].join(" ");
}

function defaultDesktopCommandRunner(invocation: DesktopCommandInvocation): DesktopCommandResult {
  const { command, args, cwd, env } = invocation;
  const needsWindowsCmdWrapper =
    process.platform === "win32" && (command === "pnpm" || command.toLowerCase().endsWith(".cmd"));

  const result = needsWindowsCmdWrapper
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", formatShellCommandForWindows(command, args)], {
        cwd,
        env,
        stdio: "inherit",
        encoding: "utf8",
        windowsHide: true,
      })
    : spawnSync(command, args, {
        cwd,
        env,
        stdio: "inherit",
        encoding: "utf8",
        windowsHide: true,
      });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status ?? 1,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

function runStepCommand(runner: DesktopCommandRunner, invocation: DesktopCommandInvocation): void {
  const res = runner(invocation);
  if (res.status !== 0) {
    throw new Error(`[desktop:build] Step "${invocation.label}" exited with code ${res.status}`);
  }
}

function runCargoMonitorWithRetry(
  runner: DesktopCommandRunner,
  vendorDir: string,
  env: NodeJS.ProcessEnv,
): void {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = runner({
      label: `cargo build resource-monitor (attempt ${attempt})`,
      command: "cargo",
      args: [
        "build",
        "--locked",
        "--release",
        "--target",
        RESOURCE_MONITOR_TARGET,
        "--manifest-path",
        "native/resource-monitor/Cargo.toml",
        "-j",
        "1",
      ],
      cwd: vendorDir,
      env,
    });

    if (res.status === 0) {
      return;
    }

    const combined = `${res.stdout}\n${res.stderr}`;
    const isAccessViolation =
      res.status === -1073741819 ||
      res.status === 3221225477 ||
      /0xC0000005|STATUS_ACCESS_VIOLATION/i.test(combined);
    if (isAccessViolation && attempt < maxAttempts) {
      console.warn(
        `[desktop:build] MSVC link.exe hit 0xC0000005 on attempt ${attempt}/${maxAttempts}; retrying...`,
      );
      continue;
    }
    throw new Error(
      `[desktop:build] cargo build resource-monitor failed with status ${res.status}`,
    );
  }
}

function findProducedInstallerExe(stageDir: string): string {
  if (!existsSync(stageDir)) {
    throw new Error(`Missing installer output staging directory: ${stageDir}`);
  }
  const entries = readdirSync(stageDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const preferred =
    entries.find((name) => /^prismux-setup-.*\.exe$/i.test(name)) ??
    entries.find((name) => /setup.*\.exe$/i.test(name)) ??
    entries[0];

  if (!preferred) {
    throw new Error(`No Prismux-Setup-*.exe artifact found in ${stageDir}`);
  }
  return join(stageDir, preferred);
}

export function resolveSqliteVecLibraryFilename(
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") return "vec0.dll";
  if (platform === "darwin") return "vec0.dylib";
  return "vec0.so";
}

export function resolveSqliteVecPackageName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const osToken = platform === "win32" ? "windows" : platform;
  return `sqlite-vec-${osToken}-${arch}`;
}

/**
 * Resolves the prebuilt native `sqlite-vec` shared library (`vec0.dll` on Windows x64)
 * across explicit `PRISMUX_SQLITE_VEC_PATH` overrides, workspace `node_modules`, and
 * pnpm sibling package directories.
 */
export function resolveSqliteVecBinaryPath(options: {
  repoRoot: string;
  platform?: NodeJS.Platform;
  arch?: string;
  env?: Readonly<Record<string, string | undefined>>;
}): string {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const env = options.env ?? process.env;
  const libName = resolveSqliteVecLibraryFilename(platform);
  const pkgName = resolveSqliteVecPackageName(platform, arch);

  const candidates: string[] = [];
  const envOverride = env["PRISMUX_SQLITE_VEC_PATH"]?.trim();
  if (envOverride) {
    candidates.push(resolve(envOverride));
    if (!envOverride.toLowerCase().endsWith(libName.toLowerCase())) {
      candidates.push(resolve(envOverride, libName));
    }
  }

  candidates.push(
    join(options.repoRoot, "packages", "memory-core", "node_modules", pkgName, libName),
    join(options.repoRoot, "apps", "daemon", "node_modules", pkgName, libName),
    join(options.repoRoot, "node_modules", pkgName, libName),
    join(options.repoRoot, "node_modules", ".pnpm", "node_modules", pkgName, libName),
  );

  const sqliteVecLink = join(
    options.repoRoot,
    "packages",
    "memory-core",
    "node_modules",
    "sqlite-vec",
  );
  if (existsSync(sqliteVecLink)) {
    try {
      const realSqliteVec = realpathSync(sqliteVecLink);
      candidates.push(join(dirname(realSqliteVec), pkgName, libName));
    } catch {
      // Ignore broken symlink; fall through to .pnpm scan.
    }
  }

  const pnpmDir = join(options.repoRoot, "node_modules", ".pnpm");
  if (existsSync(pnpmDir)) {
    const prefix = `${pkgName}@`;
    const entries = readdirSync(pnpmDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    for (const entry of entries) {
      candidates.push(join(pnpmDir, entry, "node_modules", pkgName, libName));
    }
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    try {
      const stat = statSync(candidate);
      if (stat.isFile()) {
        if (stat.size <= 0) {
          throw new Error(
            `[desktop:build] Found ${libName} at ${candidate}, but the file is empty (0 bytes).`,
          );
        }
        return candidate;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("file is empty")) {
        throw error;
      }
    }
  }

  throw new Error(
    `[desktop:build] Missing native sqlite-vec library (${libName} from ${pkgName}). Run \`pnpm install\` or set PRISMUX_SQLITE_VEC_PATH. Searched: ${candidates.join(", ")}`,
  );
}

/**
 * Copies `vec0.dll` (or platform native library) into a real non-ASAR disk directory
 * under `apps/desktop/prod-resources/native/sqlite-vec/` and asserts
 * the staged file exists and is non-empty so release builds never silently omit it.
 */
export function stageSqliteVecBinaryForDesktop(options: {
  repoRoot: string;
  targetPath?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  env?: Readonly<Record<string, string | undefined>>;
}): StagedSqliteVecBinary {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const libName = resolveSqliteVecLibraryFilename(platform);
  const sourcePath = resolveSqliteVecBinaryPath({
    repoRoot: options.repoRoot,
    platform,
    arch,
    env: options.env,
  });

  const stagedPath = resolve(
    options.targetPath ??
      join(options.repoRoot, "apps", "desktop", "prod-resources", "native", "sqlite-vec", libName),
  );

  if (/\.asar([\\/]|$)/i.test(stagedPath) && !/\.asar\.unpacked([\\/]|$)/i.test(stagedPath)) {
    throw new Error(
      `[desktop:build] sqlite-vec native library must be staged outside .asar on real disk: ${stagedPath}`,
    );
  }

  mkdirSync(dirname(stagedPath), { recursive: true });
  copyFileSync(sourcePath, stagedPath);

  if (!existsSync(stagedPath)) {
    throw new Error(
      `[desktop:build] Expected staged sqlite-vec binary at ${stagedPath}, but it does not exist after copy.`,
    );
  }
  const stagedStat = statSync(stagedPath);
  if (!stagedStat.isFile() || stagedStat.size <= 0) {
    throw new Error(
      `[desktop:build] Staged sqlite-vec binary at ${stagedPath} is empty or not a regular file (${stagedStat.size} bytes).`,
    );
  }

  return {
    sourcePath,
    stagedPath,
    bytes: stagedStat.size,
  };
}

function assertCleanDesktopReleaseDir(dir: string): void {
  if (!existsSync(dir)) {
    return;
  }
  for (const name of readdirSync(dir)) {
    const lower = name.toLowerCase();
    if (
      FORBIDDEN_PLUGIN_ARCHIVE_PREFIXES.some((prefix) => lower.includes(prefix)) ||
      lower.endsWith(".wb-plugin")
    ) {
      throw new Error(
        `Desktop installer directory must not contain prebundled official plugins: ${join(dir, name)}`,
      );
    }
  }
}

/**
 * Orchestrates building Prismux core packages, native Rust resource-monitor,
 * Electron desktop/web/server bundles, and optional NSIS Windows installer
 * archiving with 7-Zip integrity checks + SHA-256 checksums.
 */
export function buildPrismuxDesktop(
  options: BuildPrismuxDesktopOptions = {},
): BuildPrismuxDesktopResult {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(options.repoRoot ?? resolve(here, ".."));
  const version = (options.version ?? readRepoVersion(repoRoot)).trim();
  const outDir = resolve(options.outDir ?? join(repoRoot, ".work", `release-v${version}`));
  const runner = options.runner ?? defaultDesktopCommandRunner;
  const verifySevenZip = options.verifySevenZip ?? verifyArchiveWithSevenZip;

  const resourceMonitorPath = join(
    repoRoot,
    "native",
    "resource-monitor",
    "target",
    RESOURCE_MONITOR_TARGET,
    "release",
    process.platform === "win32" ? "prismux-resource-monitor.exe" : "prismux-resource-monitor",
  );

  const executedSteps: string[] = [];

  if (options.dryRun) {
    console.log(`[desktop:build] Dry run for Prismux v${version}`);
    console.log(`  repoRoot: ${repoRoot}`);
    console.log(`  outDir: ${outDir}`);
    console.log(`  skipRootBuild: ${Boolean(options.skipRootBuild)}`);
    console.log(`  skipRust: ${Boolean(options.skipRust)}`);
    console.log(`  installer: ${Boolean(options.installer)}`);
    return {
      version,
      outDir,
      resourceMonitorPath,
      sqliteVecPath: null,
      sqliteVecBytes: null,
      installerExePath: null,
      installerSha256: null,
      checksumPath: null,
      executedSteps: ["dry-run"],
    };
  }

  const baseEnv = sanitizeDesktopBuildEnv(process.env);

  // Step 1: Build root workspace core packages + daemon
  if (!options.skipRootBuild) {
    const filterArgs = ROOT_DESKTOP_BUILD_FILTERS.flatMap((pkg) => ["--filter", pkg]);
    runStepCommand(runner, {
      label: "root workspace packages build",
      command: "pnpm",
      args: [...filterArgs, "build"],
      cwd: repoRoot,
      env: baseEnv,
    });
    executedSteps.push("root-build");
  }

  // Step 1.5: Stage and assert sqlite-vec native library (`vec0.dll`) outside .asar on disk
  const sqliteVecStaged = stageSqliteVecBinaryForDesktop({
    repoRoot,
    env: baseEnv,
  });
  executedSteps.push("sqlite-vec-stage");

  // Step 2: Build or reuse native/resource-monitor
  if (options.skipRust) {
    if (!existsSync(resourceMonitorPath)) {
      throw new Error(
        `--skip-rust was passed, but cached resource-monitor binary is missing at ${resourceMonitorPath}`,
      );
    }
    executedSteps.push("rust-skipped");
  } else {
    runCargoMonitorWithRetry(runner, repoRoot, baseEnv);
    if (!existsSync(resourceMonitorPath)) {
      throw new Error(`cargo build completed without producing ${resourceMonitorPath}`);
    }
    executedSteps.push("rust-build");
  }

  // Step 3: Build real Prismux web + server + desktop bundles
  runStepCommand(runner, {
    label: "vp run build:desktop",
    command: "pnpm",
    args: ["exec", "vp", "run", "build:desktop"],
    cwd: repoRoot,
    env: baseEnv,
  });
  executedSteps.push("prismux-build-desktop");

  let installerExePath: string | null = null;
  let installerSha256: string | null = null;
  let checksumPath: string | null = null;

  // Step 4: Optional NSIS Windows installer build + archive + 7z verification + sha256
  if (options.installer) {
    mkdirSync(outDir, { recursive: true });
    const stageOutputDir = join(outDir, ".installer-stage");
    rmSync(stageOutputDir, { recursive: true, force: true });
    mkdirSync(stageOutputDir, { recursive: true });

    if (!existsSync(sqliteVecStaged.stagedPath) || statSync(sqliteVecStaged.stagedPath).size <= 0) {
      throw new Error(
        `[desktop:build] Staged sqlite-vec native binary disappeared before NSIS build: ${sqliteVecStaged.stagedPath}`,
      );
    }

    const installerEnv = sanitizeDesktopBuildEnv(baseEnv, {
      PRISMUX_DESKTOP_REUSE_RESOURCE_MONITOR: "1",
      PRISMUX_DESKTOP_VERSION: version,
      PRISMUX_SQLITE_VEC_PATH: sqliteVecStaged.stagedPath,
    });

    runStepCommand(runner, {
      label: "NSIS installer build",
      command: process.execPath,
      args: [
        "scripts/build-desktop-artifact.ts",
        "--platform",
        "win",
        "--target",
        "nsis",
        "--arch",
        "x64",
        "--build-version",
        version,
        "--output-dir",
        stageOutputDir,
        "--skip-build",
      ],
      cwd: repoRoot,
      env: installerEnv,
    });

    const producedExe = findProducedInstallerExe(stageOutputDir);
    const archivedFilename = basename(producedExe);
    installerExePath = join(outDir, archivedFilename);
    copyFileSync(producedExe, installerExePath);
    rmSync(stageOutputDir, { recursive: true, force: true });

    assertCleanDesktopReleaseDir(outDir);

    const sevenZipPath = resolveSevenZipPath();
    verifySevenZip(sevenZipPath, installerExePath);

    installerSha256 = sha256File(installerExePath);
    checksumPath = writeConsolidatedSha256File(join(outDir, formatSoftwareSumsFilename(version)), [
      installerExePath,
    ]);
    executedSteps.push("nsis-installer");
  }

  return {
    version,
    outDir,
    resourceMonitorPath,
    sqliteVecPath: sqliteVecStaged.stagedPath,
    sqliteVecBytes: sqliteVecStaged.bytes,
    installerExePath,
    installerSha256,
    checksumPath,
    executedSteps,
  };
}

export function parseBuildDesktopArgs(argv: readonly string[]): ParsedBuildDesktopCliArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      installer: { type: "boolean", default: false },
      "skip-rust": { type: "boolean", default: false },
      "skip-root-build": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      out: { type: "string" },
      version: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  return {
    help: values.help,
    options: {
      installer: values.installer,
      skipRust: values["skip-rust"],
      skipRootBuild: values["skip-root-build"],
      dryRun: values["dry-run"],
      ...(values.out !== undefined ? { outDir: values.out } : {}),
      ...(values.version !== undefined ? { version: values.version } : {}),
    },
  };
}

function main(): void {
  const parsed = parseBuildDesktopArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(
      "Usage: node scripts/build-prismux-desktop.ts [--installer] [--skip-rust] [--skip-root-build] [--out <dir>] [--version <semver>] [--dry-run]",
    );
    return;
  }

  const result = buildPrismuxDesktop(parsed.options);
  console.log(`\n[desktop:build] Completed v${result.version}`);
  console.log(`  Steps:            ${result.executedSteps.join(" -> ")}`);
  console.log(`  ResourceMonitor:  ${result.resourceMonitorPath}`);
  if (result.sqliteVecPath && result.sqliteVecBytes !== null) {
    console.log(`  SqliteVec:        ${result.sqliteVecPath} (${result.sqliteVecBytes} bytes)`);
  }
  if (result.installerExePath && result.installerSha256) {
    console.log(`  Installer:        ${result.installerExePath}`);
    console.log(`  SHA-256:          ${result.installerSha256}`);
  }
}

const isMainModule =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main();
}
