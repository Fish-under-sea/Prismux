import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { packPlugin, type PackPluginResult } from './pack-plugin.ts';

export const OFFICIAL_PLUGIN_IDS = [
  'qq',
  'fishdock-hook',
] as const;

export const RELEASE_CATALOG_FILENAME = 'prismux-plugins-official.json' as const;

export function formatSoftwareSumsFilename(version: string): string {
  return `Prismux-${version}-SHA256SUMS.txt`;
}

export function formatPluginsSumsFilename(version: string): string {
  return `prismux-plugins-${version}-SHA256SUMS.txt`;
}

const WORKSPACE_DAEMON_PACKAGES = [
  'protocol',
  'cordis-kernel',
  'memory-core',
  'sync-vault',
] as const;

const FORBIDDEN_STAGE_SEGMENTS = [
  'plugins-official',
  'plugin-qq',
  'plugin-pet',
  'plugin-fishdock-hook',
  'plugin-ssh',
];

export interface BuildReleaseOptions {
  repoRoot?: string;
  outDir?: string;
  stageDir?: string;
  version?: string;
  updateCatalogPath?: string;
  skipRust?: boolean;
  skipBuild?: boolean;
}

export interface BuildReleaseResult {
  version: string;
  outDir: string;
  setupExePath: string;
  setupSha256: string;
  portableZipPath: string;
  portableSha256: string;
  plugins: PackPluginResult[];
  sumsPath: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readRepoVersion(repoRoot: string): string {
  const pkgPath = join(repoRoot, 'package.json');
  const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as unknown;
  if (!isPlainRecord(raw) || typeof raw['version'] !== 'string' || !raw['version'].trim()) {
    throw new Error(`Missing valid "version" in ${pkgPath}`);
  }
  return raw['version'].trim();
}

/**
 * Converts SemVer (e.g. `0.0.1-alpha.1` or `0.1.0`) to Windows 4-part numeric
 * VIProductVersion (e.g. `0.0.1.1` or `0.1.0.0`).
 */
export function toWindowsProductVersion(semver: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(semver.trim());
  if (!match) {
    throw new Error(`Invalid SemVer for VIProductVersion conversion: "${semver}"`);
  }
  const major = Number.parseInt(match[1] ?? '0', 10);
  const minor = Number.parseInt(match[2] ?? '0', 10);
  const patch = Number.parseInt(match[3] ?? '0', 10);
  let build = 0;
  if (match[4]) {
    const numMatch = /(\d+)/.exec(match[4]);
    if (numMatch?.[1]) {
      build = Number.parseInt(numMatch[1], 10);
    } else {
      build = 1;
    }
  }
  return `${major}.${minor}.${patch}.${Math.min(65535, Math.max(0, build))}`;
}

export function resolveRustEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  delete env['ELECTRON_RUN_AS_NODE'];
  delete env['ELECTRON_NO_ATTACH_CONSOLE'];

  const fallbackRoot = 'D:\\Fish-code\\工具\\可复用工具集\\Rust\\1.99.1';
  const fallbackRustup = join(fallbackRoot, 'rustup');
  const fallbackCargo = join(fallbackRoot, 'cargo');

  if (!env['RUSTUP_HOME'] && existsSync(fallbackRustup)) {
    env['RUSTUP_HOME'] = fallbackRustup;
  }
  if (!env['CARGO_HOME'] && existsSync(fallbackCargo)) {
    env['CARGO_HOME'] = fallbackCargo;
  }
  if (env['CARGO_HOME']) {
    const cargoBin = join(env['CARGO_HOME'], 'bin');
    const currentPath = env['PATH'] ?? '';
    if (existsSync(cargoBin) && !currentPath.toLowerCase().includes(cargoBin.toLowerCase())) {
      env['PATH'] = `${cargoBin};${currentPath}`;
    }
  }
  return env;
}

export function resolveMakensisPath(env: NodeJS.ProcessEnv = process.env): string {
  const localAppData = env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
  const candidates = [
    join(localAppData, 'FishDockShip', 'nsis-3.13', 'makensis.exe'),
    'D:\\Fish-code\\工具\\可复用工具集\\nsis-ascii-probe\\makensis.exe',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return 'makensis';
}

export function resolveSevenZipPath(): string {
  const defaultPath = 'C:\\Program Files\\7-Zip\\7z.exe';
  if (existsSync(defaultPath)) {
    return defaultPath;
  }
  return '7z';
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function writeSha256File(artifactPath: string): string {
  const digest = sha256File(artifactPath);
  const name = basename(artifactPath);
  writeFileSync(`${artifactPath}.sha256`, `${digest}  ${name}\n`, 'utf8');
  return digest;
}

export function writeConsolidatedSha256File(
  outPath: string,
  filePaths: readonly string[],
): string {
  const lines: string[] = [];
  for (const filePath of filePaths) {
    if (!existsSync(filePath)) {
      throw new Error(`Missing artifact for consolidated SHA256SUMS: ${filePath}`);
    }
    lines.push(`${sha256File(filePath)}  ${basename(filePath)}`);
  }
  writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
  return outPath;
}

export function cleanPreviousReleaseArtifacts(outDir: string): void {
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
    return;
  }
  for (const name of readdirSync(outDir)) {
    if (
      name.endsWith('.exe') ||
      name.endsWith('.zip') ||
      name.endsWith('.wb-plugin') ||
      name.endsWith('.sha256') ||
      name === 'SHA256SUMS.txt' ||
      name.endsWith('-SHA256SUMS.txt') ||
      name === RELEASE_CATALOG_FILENAME ||
      name === 'official.json'
    ) {
      rmSync(join(outDir, name), { force: true });
    }
  }
}

export function assertStageContainsNoOfficialPlugins(stageDir: string): void {
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const lower = entry.name.toLowerCase();
      if (
        FORBIDDEN_STAGE_SEGMENTS.some((seg) => lower.includes(seg)) ||
        lower.endsWith('.wb-plugin')
      ) {
        throw new Error(
          `Release minimal core stage must NOT include official plugins: found "${fullPath}"`,
        );
      }
      if (entry.isDirectory()) {
        visit(fullPath);
      }
    }
  };
  visit(stageDir);
}

function copyDirDereferenced(src: string, dest: string, skipTests = false): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (skipTests && entry.name === '__tests__') {
      continue;
    }
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    const resolved = realpathSync(srcPath);
    const stat = statSync(resolved);
    if (stat.isDirectory()) {
      copyDirDereferenced(resolved, destPath, skipTests);
    } else {
      cpSync(resolved, destPath, { dereference: true });
    }
  }
}

export function assembleMinimalCoreStage(options: {
  repoRoot: string;
  stageDir: string;
  exeSourcePath?: string;
}): void {
  const { repoRoot, stageDir } = options;
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });

  const exePath =
    options.exeSourcePath ??
    join(repoRoot, 'apps', 'desktop-tauri', 'target', 'release', 'prismux-desktop.exe');
  if (!existsSync(exePath)) {
    throw new Error(`Missing release desktop executable: ${exePath}`);
  }
  cpSync(exePath, join(stageDir, 'Prismux.exe'));

  const uiDistDir = join(repoRoot, 'apps', 'workbench-ui', 'dist');
  if (!existsSync(join(uiDistDir, 'index.html'))) {
    throw new Error(`Missing built workbench-ui dist: ${uiDistDir}`);
  }
  copyDirDereferenced(uiDistDir, join(stageDir, 'workbench-ui'));

  for (const rootDoc of ['LICENSE', 'README.md']) {
    const srcDoc = join(repoRoot, rootDoc);
    if (existsSync(srcDoc)) {
      cpSync(srcDoc, join(stageDir, rootDoc));
    }
  }

  const daemonSrcRoot = join(repoRoot, 'apps', 'daemon');
  const daemonDist = join(daemonSrcRoot, 'dist');
  if (!existsSync(join(daemonDist, 'cli.js'))) {
    throw new Error(`Missing built daemon dist: ${daemonDist}`);
  }
  const daemonDest = join(stageDir, 'daemon');
  mkdirSync(daemonDest, { recursive: true });
  cpSync(join(daemonSrcRoot, 'package.json'), join(daemonDest, 'package.json'));
  copyDirDereferenced(daemonDist, join(daemonDest, 'dist'), true);

  const daemonNodeModules = join(daemonDest, 'node_modules');
  const prismuxScopeDest = join(daemonNodeModules, '@prismux');
  mkdirSync(prismuxScopeDest, { recursive: true });

  for (const pkgName of WORKSPACE_DAEMON_PACKAGES) {
    const pkgSrc = join(repoRoot, 'packages', pkgName);
    const pkgDest = join(prismuxScopeDest, pkgName);
    mkdirSync(pkgDest, { recursive: true });
    cpSync(join(pkgSrc, 'package.json'), join(pkgDest, 'package.json'));
    const pkgDist = join(pkgSrc, 'dist');
    if (!existsSync(pkgDist)) {
      throw new Error(`Missing built dist for @prismux/${pkgName}: ${pkgDist}`);
    }
    copyDirDereferenced(pkgDist, join(pkgDest, 'dist'), true);
  }

  const wsLink = join(daemonSrcRoot, 'node_modules', 'ws');
  if (!existsSync(wsLink)) {
    throw new Error(`Missing ws dependency at ${wsLink}; run pnpm install first.`);
  }
  copyDirDereferenced(realpathSync(wsLink), join(daemonNodeModules, 'ws'));

  const sqliteVecLink = join(
    repoRoot,
    'packages',
    'memory-core',
    'node_modules',
    'sqlite-vec',
  );
  if (!existsSync(sqliteVecLink)) {
    throw new Error(`Missing sqlite-vec dependency at ${sqliteVecLink}; run pnpm install first.`);
  }
  const realSqliteVec = realpathSync(sqliteVecLink);
  copyDirDereferenced(realSqliteVec, join(daemonNodeModules, 'sqlite-vec'));

  // Copy platform optional native sqlite-vec-* sibling packages from pnpm store directory
  const pnpmSiblingsDir = dirname(realSqliteVec);
  for (const entry of readdirSync(pnpmSiblingsDir, { withFileTypes: true })) {
    if (entry.name.startsWith('sqlite-vec-')) {
      const siblingPath = realpathSync(join(pnpmSiblingsDir, entry.name));
      copyDirDereferenced(siblingPath, join(daemonNodeModules, entry.name));
    }
  }

  assertStageContainsNoOfficialPlugins(stageDir);
}

function runPnpmBuild(repoRoot: string): void {
  const env = resolveRustEnv();
  if (process.platform === 'win32') {
    execFileSync('cmd.exe', ['/d', '/s', '/c', 'pnpm -r build'], {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
    });
  } else {
    execFileSync('pnpm', ['-r', 'build'], {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
    });
  }
}

function runCargoReleaseWithRetry(repoRoot: string): void {
  const env = resolveRustEnv();
  const manifestPath = join(repoRoot, 'apps', 'desktop-tauri', 'Cargo.toml');
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = spawnSync(
      'cargo',
      ['build', '--release', '-j', '1', '--offline', '--manifest-path', manifestPath],
      {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
      },
    );

    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);

    if (res.status === 0) {
      return;
    }

    const combined = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
    const isAccessViolation =
      res.status === -1073741819 ||
      res.status === 3221225477 ||
      /0xC0000005|STATUS_ACCESS_VIOLATION/i.test(combined);

    if (isAccessViolation && attempt < maxAttempts) {
      console.warn(
        `[release:build] MSVC link.exe hit 0xC0000005 on attempt ${attempt}/${maxAttempts}; retrying...`,
      );
      continue;
    }
    throw new Error(`cargo build --release failed with status ${String(res.status)}`);
  }
}

export function verifyArchiveWithSevenZip(sevenZipPath: string, archivePath: string): void {
  const output = execFileSync(sevenZipPath, ['t', archivePath], {
    encoding: 'utf8',
  });
  if (!output.includes('Everything is Ok')) {
    throw new Error(`7z verification failed (missing "Everything is Ok") for ${archivePath}`);
  }
  const filesMatch = /Files:\s*(\d+)/.exec(output);
  if (!filesMatch?.[1] || Number.parseInt(filesMatch[1], 10) <= 0) {
    throw new Error(`7z verification failed (Files <= 0) for ${archivePath}`);
  }
}

export function buildReleasePackages(options: BuildReleaseOptions = {}): BuildReleaseResult {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(options.repoRoot ?? resolve(here, '..'));
  const version = options.version ?? readRepoVersion(repoRoot);
  const productVersion = toWindowsProductVersion(version);
  const outDir = resolve(options.outDir ?? join(repoRoot, '.work', 'release-out'));
  const stageDir = resolve(options.stageDir ?? join(repoRoot, '.work', 'release-stage'));
  const updateCatalogPath = resolve(
    options.updateCatalogPath ?? join(repoRoot, 'plugins-official', 'catalog', 'official.json'),
  );

  cleanPreviousReleaseArtifacts(outDir);

  if (!options.skipBuild) {
    runPnpmBuild(repoRoot);
  }
  if (!options.skipRust) {
    runCargoReleaseWithRetry(repoRoot);
  }

  assembleMinimalCoreStage({ repoRoot, stageDir });

  const sevenZipPath = resolveSevenZipPath();
  const makensisPath = resolveMakensisPath();
  const nsiScript = join(repoRoot, 'apps', 'desktop-tauri', 'installer', 'prismux-setup.nsi');

  const setupFilename = `Prismux-Setup-${version}.exe`;
  const setupExePath = join(outDir, setupFilename);

  execFileSync(
    makensisPath,
    [
      '/INPUTCHARSET',
      'UTF8',
      `-DVERSION=${version}`,
      `-DPRODUCT_VERSION=${productVersion}`,
      `-DSTAGE_DIR=${stageDir}`,
      `-DOUT_FILE=${setupExePath}`,
      nsiScript,
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  verifyArchiveWithSevenZip(sevenZipPath, setupExePath);
  const setupSha256 = sha256File(setupExePath);

  const portableStageDir = join(dirname(stageDir), `${basename(stageDir)}-portable`);
  rmSync(portableStageDir, { recursive: true, force: true });
  cpSync(stageDir, portableStageDir, { recursive: true });
  mkdirSync(join(portableStageDir, 'data'), { recursive: true });
  writeFileSync(
    join(portableStageDir, 'PORTABLE_MODE.txt'),
    [
      `Prismux Portable Mode (${version})`,
      '',
      '检测到同级 data/ 目录时，SQLite 记忆库、同步缓存与加密插件凭据全部收敛至 data/ 内，不在系统用户目录写入残留。',
      '官方两大独立插件（qq / fishdock-hook）默认不预装，启动后可在内置插件市场按需单装（原 pet / ssh 已停用：已被 Prismux 内置功能取代）。',
      '',
    ].join('\n'),
    'utf8',
  );
  assertStageContainsNoOfficialPlugins(portableStageDir);

  const portableFilename = `Prismux-Portable-${version}-win-x64.zip`;
  const portableZipPath = join(outDir, portableFilename);
  execFileSync(sevenZipPath, ['a', '-tzip', portableZipPath, '.'], {
    cwd: portableStageDir,
    stdio: 'inherit',
  });
  rmSync(portableStageDir, { recursive: true, force: true });
  verifyArchiveWithSevenZip(sevenZipPath, portableZipPath);
  const portableSha256 = sha256File(portableZipPath);

  const plugins: PackPluginResult[] = [];
  for (const id of OFFICIAL_PLUGIN_IDS) {
    const packed = packPlugin({
      pluginDir: join(repoRoot, 'plugins-official', `plugin-${id}`),
      outDir,
      updateCatalogPath,
      emitChecksum: false,
    });
    plugins.push(packed);
  }

  const releaseCatalogCopyPath = join(outDir, RELEASE_CATALOG_FILENAME);
  if (existsSync(updateCatalogPath)) {
    cpSync(updateCatalogPath, releaseCatalogCopyPath);
  }

  const sumsPath = writeConsolidatedSha256File(
    join(outDir, formatSoftwareSumsFilename(version)),
    [setupExePath, portableZipPath],
  );
  const pluginManifestTargets = [
    ...plugins.map((item) => item.archivePath),
    ...(existsSync(releaseCatalogCopyPath) ? [releaseCatalogCopyPath] : []),
  ];
  writeConsolidatedSha256File(
    join(outDir, formatPluginsSumsFilename(version)),
    pluginManifestTargets,
  );

  return {
    version,
    outDir,
    setupExePath,
    setupSha256,
    portableZipPath,
    portableSha256,
    plugins,
    sumsPath,
  };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      stage: { type: 'string' },
      version: { type: 'string' },
      'update-catalog': { type: 'string' },
      'skip-rust': { type: 'boolean', default: false },
      'skip-build': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(
      'Usage: node scripts/build-release-packages.ts [--out <dir>] [--stage <dir>] [--version <ver>] [--update-catalog <path>] [--skip-rust] [--skip-build]',
    );
    return;
  }

  const result = buildReleasePackages({
    outDir: values.out,
    stageDir: values.stage,
    version: values.version,
    updateCatalogPath: values['update-catalog'],
    skipRust: values['skip-rust'],
    skipBuild: values['skip-build'],
  });

  console.log(`\nRelease build complete (${result.version}) -> ${result.outDir}`);
  console.log(`  Setup:    ${basename(result.setupExePath)} (${result.setupSha256})`);
  console.log(`  Portable: ${basename(result.portableZipPath)} (${result.portableSha256})`);
  for (const plugin of result.plugins) {
    console.log(`  Plugin:   ${basename(plugin.archivePath)} (${plugin.sha256})`);
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main();
}
