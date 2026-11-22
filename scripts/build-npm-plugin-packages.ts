import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { OFFICIAL_PLUGIN_IDS, readRepoVersion } from './build-release-packages.ts';

export interface BuildNpmPackagesOptions {
  repoRoot?: string;
  releaseDir: string;
  outDir: string;
  scope?: string;
  version?: string;
}

export interface BuiltNpmPluginPackage {
  id: string;
  packageName: string;
  version: string;
  packageDir: string;
  archiveFilename: string;
  sha256: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeNpmScope(rawScope?: string): string | undefined {
  if (rawScope === undefined) {
    return undefined;
  }
  const trimmed = rawScope.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

export function formatNpmPluginPackageName(pluginId: string, scope?: string): string {
  const normalizedScope = normalizeNpmScope(scope);
  return normalizedScope
    ? `${normalizedScope}/prismux-plugin-${pluginId}`
    : `prismux-plugin-${pluginId}`;
}

function generateInstallerBinScript(options: {
  pluginId: string;
  packageName: string;
  version: string;
  archiveFilename: string;
  expectedSha256: string;
}): string {
  const metaJson = JSON.stringify(
    {
      pluginId: options.pluginId,
      packageName: options.packageName,
      version: options.version,
      archiveFilename: options.archiveFilename,
      expectedSha256: options.expectedSha256,
    },
    null,
    2,
  );

  return `#!/usr/bin/env node
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
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const META = ${metaJson};

function parseFlags(argv) {
  const flags = { force: false, portable: false, dir: undefined, out: undefined, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force' || arg === '-f') {
      flags.force = true;
    } else if (arg === '--portable') {
      flags.portable = true;
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--dir' || arg === '-d') {
      const next = argv[i + 1];
      if (!next) throw new Error(\`Missing value for \${arg}\`);
      flags.dir = next;
      i += 1;
    } else if (arg === '--out' || arg === '-o') {
      const next = argv[i + 1];
      if (!next) throw new Error(\`Missing value for \${arg}\`);
      flags.out = next;
      i += 1;
    }
  }
  return flags;
}

function extractTarBuffer(tarBuf, targetDir) {
  const BLOCK = 512;
  let offset = 0;
  let paxPath;
  while (offset + BLOCK <= tarBuf.length) {
    const header = tarBuf.subarray(offset, offset + BLOCK);
    offset += BLOCK;
    if (header.every((b) => b === 0)) {
      break;
    }
    const nameRaw = header.subarray(0, 100).toString('utf8').replace(/\\0.*$/, '');
    const sizeOctal = header.subarray(124, 136).toString('utf8').replace(/\\0.*$/, '').trim();
    const size = sizeOctal ? Number.parseInt(sizeOctal, 8) : 0;
    const typeFlag = String.fromCharCode(header[156] || 48);
    const prefixRaw = header.subarray(345, 500).toString('utf8').replace(/\\0.*$/, '');
    const dataEnd = offset + size;
    const content = tarBuf.subarray(offset, dataEnd);
    offset += Math.ceil(size / BLOCK) * BLOCK;

    let entryPath = paxPath ?? (prefixRaw ? \`\${prefixRaw}/\${nameRaw}\` : nameRaw);
    paxPath = undefined;

    if (typeFlag === 'x') {
      const text = content.toString('utf8');
      const m = /\\d+ path=([^\\n]+)/.exec(text);
      if (m && m[1]) paxPath = m[1];
      continue;
    }
    if (typeFlag === '5' || entryPath.endsWith('/')) {
      continue;
    }
    if (typeFlag !== '0' && typeFlag !== '\\0') {
      throw new Error(\`Refusing unsupported tar entry type "\${typeFlag}" at \${entryPath}\`);
    }

    const cleanRel = entryPath.replace(/^\\.\\//, '');
    if (
      !cleanRel ||
      cleanRel.startsWith('/') ||
      cleanRel.includes('..') ||
      cleanRel.includes('\\\\')
    ) {
      throw new Error(\`Unsafe tar path rejected: \${entryPath}\`);
    }

    const destPath = resolve(targetDir, cleanRel);
    const rel = relative(targetDir, destPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(\`Path escape rejected: \${entryPath}\`);
    }

    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, content);
  }
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    console.log(
      \`Usage: prismux-plugin-\${META.pluginId} [--out <exportDir>] [--dir <pluginsDir>] [--portable] [--force]\`,
    );
    return;
  }

  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const archivePath = join(pkgRoot, META.archiveFilename);
  const archiveBytes = readFileSync(archivePath);
  const actualSha = createHash('sha256').update(archiveBytes).digest('hex');

  if (actualSha !== META.expectedSha256) {
    throw new Error(
      \`SHA-256 verification failed for \${META.archiveFilename}: expected \${META.expectedSha256}, got \${actualSha}\`,
    );
  }

  if (flags.out) {
    const outDir = resolve(flags.out);
    const destArchive = join(outDir, META.archiveFilename);
    const destSha = join(outDir, \`\${META.archiveFilename}.sha256\`);
    if ((existsSync(destArchive) || existsSync(destSha)) && !flags.force) {
      throw new Error(
        \`Export target already exists: \${existsSync(destArchive) ? destArchive : destSha}. Pass --force to overwrite.\`,
      );
    }
    mkdirSync(outDir, { recursive: true });
    writeFileSync(destArchive, archiveBytes);
    writeFileSync(destSha, \`\${actualSha}  \${META.archiveFilename}\\n\`, 'utf8');
    console.log(\`Exported \${META.archiveFilename} (sha256: \${actualSha}) -> \${outDir}\`);
    return;
  }

  const basePluginsDir = flags.dir
    ? resolve(flags.dir)
    : flags.portable
      ? resolve(process.cwd(), 'data', 'plugins')
      : join(homedir(), '.prismux', 'plugins');
  const targetDir = resolve(basePluginsDir, META.pluginId);

  if (existsSync(targetDir) && readdirSync(targetDir).length > 0 && !flags.force) {
    throw new Error(
      \`Target plugin directory already exists and is non-empty: \${targetDir}. Pass --force to overwrite.\`,
    );
  }

  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  const tarBytes = gunzipSync(archiveBytes);
  extractTarBuffer(tarBytes, targetDir);

  writeFileSync(
    join(targetDir, '.prismux-install.json'),
    JSON.stringify(
      {
        packageName: META.packageName,
        version: META.version,
        distribution: 'managed',
        sha256: actualSha,
        installedAt: Date.now(),
      },
      null,
      2,
    ) + '\\n',
    'utf8',
  );

  console.log(\`Installed \${META.packageName}@\${META.version} (sha256: \${actualSha}) -> \${targetDir}\`);
}

main();
`;
}

export function buildNpmPluginPackages(
  options: BuildNpmPackagesOptions,
): BuiltNpmPluginPackage[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(options.repoRoot ?? resolve(here, '..'));
  const releaseDir = resolve(options.releaseDir);
  const outDir = resolve(options.outDir);
  const version = options.version ?? readRepoVersion(repoRoot);
  const normalizedScope = normalizeNpmScope(options.scope);
  const rootLicensePath = join(repoRoot, 'LICENSE');

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const results: BuiltNpmPluginPackage[] = [];

  for (const id of OFFICIAL_PLUGIN_IDS) {
    const srcPluginDir = join(repoRoot, 'plugins-official', `plugin-${id}`);
    const srcPkg = JSON.parse(
      readFileSync(join(srcPluginDir, 'package.json'), 'utf8'),
    ) as unknown;
    if (!isPlainRecord(srcPkg)) {
      throw new Error(`Invalid package.json in ${srcPluginDir}`);
    }

    const manifestPath = join(srcPluginDir, 'plugin.manifest.json');
    const archiveFilename = `${id}-${version}.wb-plugin`;
    const archivePath = join(releaseDir, archiveFilename);
    if (!existsSync(archivePath)) {
      throw new Error(`Missing packed plugin archive for "${id}": ${archivePath}`);
    }

    const archiveBytes = readFileSync(archivePath);
    const sha256 = createHash('sha256').update(archiveBytes).digest('hex');

    const packageName = formatNpmPluginPackageName(id, normalizedScope);
    const pkgOutDir = join(outDir, id);
    const binDir = join(pkgOutDir, 'bin');
    mkdirSync(binDir, { recursive: true });

    cpSync(archivePath, join(pkgOutDir, archiveFilename));
    cpSync(manifestPath, join(pkgOutDir, 'plugin.manifest.json'));
    if (existsSync(rootLicensePath)) {
      cpSync(rootLicensePath, join(pkgOutDir, 'LICENSE'));
    } else {
      writeFileSync(
        join(pkgOutDir, 'LICENSE'),
        'MIT License\n\nCopyright (c) 2026 Fish-under-sea / Prismux Contributors\n',
        'utf8',
      );
    }

    const enginesRaw = isPlainRecord(srcPkg['engines']) ? srcPkg['engines'] : {};
    const prismuxEngine =
      typeof enginesRaw['prismux'] === 'string' && enginesRaw['prismux'].trim().length > 0
        ? enginesRaw['prismux'].trim()
        : '>=0.0.1-0 <2.0.0';

    const generatedPackageJson = {
      name: packageName,
      version,
      type: 'module',
      description:
        typeof srcPkg['description'] === 'string'
          ? srcPkg['description']
          : `Official optional ${id} plugin package for Prismux.`,
      license: 'MIT',
      keywords: ['prismux', 'prismux-plugin', id],
      repository: {
        type: 'git',
        url: 'git+https://github.com/Fish-under-sea/Prismux.git',
      },
      homepage: 'https://github.com/Fish-under-sea/Prismux#readme',
      bugs: {
        url: 'https://github.com/Fish-under-sea/Prismux/issues',
      },
      engines: {
        prismux: prismuxEngine,
        node: '>=20.0.0',
      },
      bin: {
        [`prismux-plugin-${id}`]: 'bin/install.mjs',
        [`prismux-install-${id}`]: 'bin/install.mjs',
      },
      files: [
        'bin/',
        'plugin.manifest.json',
        archiveFilename,
        'LICENSE',
        'README.md',
      ],
    };

    writeFileSync(
      join(pkgOutDir, 'package.json'),
      `${JSON.stringify(generatedPackageJson, null, 2)}\n`,
      'utf8',
    );

    const binScript = generateInstallerBinScript({
      pluginId: id,
      packageName,
      version,
      archiveFilename,
      expectedSha256: sha256,
    });
    writeFileSync(join(binDir, 'install.mjs'), binScript, {
      encoding: 'utf8',
      mode: 0o755,
    });

    const readmeLines = [
      `# ${packageName}`,
      '',
      `${generatedPackageJson.description}`,
      '',
      `- Version: \`${version}\``,
      `- Engine: \`prismux: ${prismuxEngine}\``,
      `- Archive: \`${archiveFilename}\``,
      `- SHA-256: \`${sha256}\``,
      '- Zero install scripts (`preinstall` / `install` / `postinstall` are omitted).',
      '',
      '## Install',
      '',
      '```bash',
      `npx ${packageName}@${version}`,
      '# or in portable mode (writes into ./data/plugins)',
      `npx ${packageName}@${version} --portable`,
      '```',
      '',
    ];
    writeFileSync(join(pkgOutDir, 'README.md'), readmeLines.join('\n'), 'utf8');

    results.push({
      id,
      packageName,
      version,
      packageDir: pkgOutDir,
      archiveFilename: basename(archivePath),
      sha256,
    });
  }

  return results;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      out: { type: 'string' },
      scope: { type: 'string' },
      version: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (values.help || !values.dir || !values.out) {
    console.log(
      'Usage: node scripts/build-npm-plugin-packages.ts --dir <release-dir> --out <out-dir> [--scope @fish-under-sea] [--version <ver>]',
    );
    if (!values.help) {
      process.exitCode = 1;
    }
    return;
  }

  const built = buildNpmPluginPackages({
    releaseDir: values.dir,
    outDir: values.out,
    scope: values.scope,
    version: values.version,
  });

  for (const item of built) {
    console.log(
      `Built npm package ${item.packageName}@${item.version} (${item.sha256}) -> ${item.packageDir}`,
    );
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main();
}
