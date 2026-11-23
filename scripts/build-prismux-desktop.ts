import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  formatSoftwareSumsFilename,
  readRepoVersion,
  resolveRustEnv,
  resolveSevenZipPath,
  sha256File,
  verifyArchiveWithSevenZip,
  writeConsolidatedSha256File,
} from './build-release-packages.ts';

export const ROOT_DESKTOP_BUILD_FILTERS = [
  '@prismux/protocol',
  '@prismux/memory-core',
  '@prismux/cordis-kernel',
  '@prismux/sync-vault',
  '@prismux/appearance',
  '@prismux/wallpaper',
  '@prismux/daemon',
] as const;

export const RESOURCE_MONITOR_TARGET = 'x86_64-pc-windows-msvc' as const;

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

export type DesktopCommandRunner = (
  invocation: DesktopCommandInvocation,
) => DesktopCommandResult;

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
  installerExePath: string | null;
  installerSha256: string | null;
  checksumPath: string | null;
  executedSteps: string[];
}

export interface ParsedBuildDesktopCliArgs {
  help: boolean;
  options: BuildPrismuxDesktopOptions;
}

const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
] as const;

const FORBIDDEN_PLUGIN_ARCHIVE_PREFIXES = [
  'plugin-qq',
  'plugin-pet',
  'plugin-fishdock-hook',
  'plugin-ssh',
  'prismux-plugin-',
] as const;

export function sanitizeDesktopBuildEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  extraEnv: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env = resolveRustEnv(baseEnv);
  for (const key of PROXY_ENV_KEYS) {
    delete env[key];
  }
  env['NO_PROXY'] = '*';
  delete env['ELECTRON_RUN_AS_NODE'];
  delete env['ELECTRON_NO_ATTACH_CONSOLE'];

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
  return [quoteArg(command), ...args.map(quoteArg)].join(' ');
}

function defaultDesktopCommandRunner(
  invocation: DesktopCommandInvocation,
): DesktopCommandResult {
  const { command, args, cwd, env } = invocation;
  const needsWindowsCmdWrapper =
    process.platform === 'win32' &&
    (command === 'pnpm' || command.toLowerCase().endsWith('.cmd'));

  const result = needsWindowsCmdWrapper
    ? spawnSync(
        'cmd.exe',
        ['/d', '/s', '/c', formatShellCommandForWindows(command, args)],
        {
          cwd,
          env,
          stdio: 'inherit',
          encoding: 'utf8',
          windowsHide: true,
        },
      )
    : spawnSync(command, args, {
        cwd,
        env,
        stdio: 'inherit',
        encoding: 'utf8',
        windowsHide: true,
      });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status ?? 1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

function runStepCommand(
  runner: DesktopCommandRunner,
  invocation: DesktopCommandInvocation,
): void {
  const res = runner(invocation);
  if (res.status !== 0) {
    throw new Error(
      `[desktop:build] Step "${invocation.label}" exited with code ${res.status}`,
    );
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
      command: 'cargo',
      args: [
        'build',
        '--locked',
        '--release',
        '--target',
        RESOURCE_MONITOR_TARGET,
        '--manifest-path',
        'native/resource-monitor/Cargo.toml',
        '-j',
        '1',
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
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const preferred =
    entries.find((name) => /^prismux-setup-.*\.exe$/i.test(name)) ??
    entries.find((name) => /setup.*\.exe$/i.test(name)) ??
    entries[0];

  if (!preferred) {
    throw new Error(
      `No Prismux-Setup-*.exe artifact found in ${stageDir}`,
    );
  }
  return join(stageDir, preferred);
}

function assertCleanDesktopReleaseDir(dir: string): void {
  if (!existsSync(dir)) {
    return;
  }
  for (const name of readdirSync(dir)) {
    const lower = name.toLowerCase();
    if (
      FORBIDDEN_PLUGIN_ARCHIVE_PREFIXES.some((prefix) => lower.includes(prefix)) ||
      lower.endsWith('.wb-plugin')
    ) {
      throw new Error(
        `Desktop installer directory must not contain prebundled official plugins: ${join(dir, name)}`,
      );
    }
  }
}

/**
 * Orchestrates building Prismux v0.1.0-alpha.1 core packages, T3 Code native
 * Rust resource-monitor, T3 desktop/web/server bundles, and optional NSIS Windows
 * installer archiving with 7-Zip integrity checks + SHA-256 checksums.
 */
export function buildPrismuxDesktop(
  options: BuildPrismuxDesktopOptions = {},
): BuildPrismuxDesktopResult {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(options.repoRoot ?? resolve(here, '..'));
  const vendorDir = join(repoRoot, 'vendor', 't3code');
  const version = (options.version ?? readRepoVersion(repoRoot)).trim();
  const outDir = resolve(
    options.outDir ?? join(repoRoot, '.work', `release-v${version}`),
  );
  const runner = options.runner ?? defaultDesktopCommandRunner;
  const verifySevenZip = options.verifySevenZip ?? verifyArchiveWithSevenZip;

  if (!existsSync(vendorDir)) {
    throw new Error(`T3 Code base repository directory missing: ${vendorDir}`);
  }

  const resourceMonitorPath = join(
    vendorDir,
    'native',
    'resource-monitor',
    'target',
    RESOURCE_MONITOR_TARGET,
    'release',
    process.platform === 'win32' ? 't3-resource-monitor.exe' : 't3-resource-monitor',
  );

  const executedSteps: string[] = [];

  if (options.dryRun) {
    console.log(`[desktop:build] Dry run for Prismux v${version}`);
    console.log(`  repoRoot: ${repoRoot}`);
    console.log(`  vendorDir: ${vendorDir}`);
    console.log(`  outDir: ${outDir}`);
    console.log(`  skipRootBuild: ${Boolean(options.skipRootBuild)}`);
    console.log(`  skipRust: ${Boolean(options.skipRust)}`);
    console.log(`  installer: ${Boolean(options.installer)}`);
    return {
      version,
      outDir,
      resourceMonitorPath,
      installerExePath: null,
      installerSha256: null,
      checksumPath: null,
      executedSteps: ['dry-run'],
    };
  }

  const baseEnv = sanitizeDesktopBuildEnv(process.env);

  // Step 1: Build root workspace core packages + daemon
  if (!options.skipRootBuild) {
    const filterArgs = ROOT_DESKTOP_BUILD_FILTERS.flatMap((pkg) => [
      '--filter',
      pkg,
    ]);
    runStepCommand(runner, {
      label: 'root workspace packages build',
      command: 'pnpm',
      args: [...filterArgs, 'build'],
      cwd: repoRoot,
      env: baseEnv,
    });
    executedSteps.push('root-build');
  }

  // Step 2: Build or reuse native/resource-monitor
  if (options.skipRust) {
    if (!existsSync(resourceMonitorPath)) {
      throw new Error(
        `--skip-rust was passed, but cached resource-monitor binary is missing at ${resourceMonitorPath}`,
      );
    }
    executedSteps.push('rust-skipped');
  } else {
    runCargoMonitorWithRetry(runner, vendorDir, baseEnv);
    if (!existsSync(resourceMonitorPath)) {
      throw new Error(
        `cargo build completed without producing ${resourceMonitorPath}`,
      );
    }
    executedSteps.push('rust-build');
  }

  // Step 3: Build real T3 Code web + server + desktop bundles
  runStepCommand(runner, {
    label: 'vendor/t3code vp run build:desktop',
    command: 'pnpm',
    args: ['exec', 'vp', 'run', 'build:desktop'],
    cwd: vendorDir,
    env: baseEnv,
  });
  executedSteps.push('t3-build-desktop');

  let installerExePath: string | null = null;
  let installerSha256: string | null = null;
  let checksumPath: string | null = null;

  // Step 4: Optional NSIS Windows installer build + archive + 7z verification + sha256
  if (options.installer) {
    mkdirSync(outDir, { recursive: true });
    const stageOutputDir = join(outDir, '.installer-stage');
    rmSync(stageOutputDir, { recursive: true, force: true });
    mkdirSync(stageOutputDir, { recursive: true });

    const installerEnv = sanitizeDesktopBuildEnv(baseEnv, {
      T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR: '1',
      T3CODE_DESKTOP_VERSION: version,
    });

    runStepCommand(runner, {
      label: 'vendor/t3code NSIS installer build',
      command: process.execPath,
      args: [
        'scripts/build-desktop-artifact.ts',
        '--platform',
        'win',
        '--target',
        'nsis',
        '--arch',
        'x64',
        '--build-version',
        version,
        '--output-dir',
        stageOutputDir,
        '--skip-build',
      ],
      cwd: vendorDir,
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
    checksumPath = writeConsolidatedSha256File(
      join(outDir, formatSoftwareSumsFilename(version)),
      [installerExePath],
    );
    executedSteps.push('nsis-installer');
  }

  return {
    version,
    outDir,
    resourceMonitorPath,
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
      installer: { type: 'boolean', default: false },
      'skip-rust': { type: 'boolean', default: false },
      'skip-root-build': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      out: { type: 'string' },
      version: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  return {
    help: values.help,
    options: {
      installer: values.installer,
      skipRust: values['skip-rust'],
      skipRootBuild: values['skip-root-build'],
      dryRun: values['dry-run'],
      ...(values.out !== undefined ? { outDir: values.out } : {}),
      ...(values.version !== undefined ? { version: values.version } : {}),
    },
  };
}

function main(): void {
  const parsed = parseBuildDesktopArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(
      'Usage: node scripts/build-prismux-desktop.ts [--installer] [--skip-rust] [--skip-root-build] [--out <dir>] [--version <semver>] [--dry-run]',
    );
    return;
  }

  const result = buildPrismuxDesktop(parsed.options);
  console.log(`\n[desktop:build] Completed v${result.version}`);
  console.log(`  Steps:            ${result.executedSteps.join(' -> ')}`);
  console.log(`  ResourceMonitor:  ${result.resourceMonitorPath}`);
  if (result.installerExePath && result.installerSha256) {
    console.log(`  Installer:        ${result.installerExePath}`);
    console.log(`  SHA-256:          ${result.installerSha256}`);
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main();
}
