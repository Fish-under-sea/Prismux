import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OFFICIAL_PLUGIN_IDS = [
  'qq',
] as const;

export const RELEASE_CATALOG_FILENAME = 'prismux-plugins-official.json' as const;

export function formatSoftwareSumsFilename(version: string): string {
  return `Prismux-${version}-SHA256SUMS.txt`;
}

export function formatPluginsSumsFilename(version: string): string {
  return `prismux-plugins-${version}-SHA256SUMS.txt`;
}

const FORBIDDEN_STAGE_SEGMENTS = [
  'plugins-official',
  'plugin-qq',
  'plugin-pet',
  'plugin-ssh',
];

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
 * Converts SemVer (e.g. `0.2.0-rc.1` or `0.1.0`) to Windows 4-part numeric
 * VIProductVersion (e.g. `0.2.0.1` or `0.1.0.0`).
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

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  console.log(
    'scripts/build-release-packages.ts provides shared release utilities for the Electron 44 pipeline. Run `node scripts/release-all.ts` (or `pnpm release:build`) to build release packages.',
  );
}
