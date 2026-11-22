import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  buildNpmPluginPackages,
  type BuiltNpmPluginPackage,
} from './build-npm-plugin-packages.ts';
import {
  buildPrismuxDesktop,
  type BuildPrismuxDesktopResult,
} from './build-prismux-desktop.ts';
import { OFFICIAL_PLUGIN_IDS, readRepoVersion } from './build-release-packages.ts';
import { packPlugin, type PackPluginResult } from './pack-plugin.ts';

export interface ReleaseAllOptions {
  repoRoot?: string;
  version?: string;
  outDir?: string;
  skipDesktop?: boolean;
  skipInstaller?: boolean;
  skipRust?: boolean;
  skipRootBuild?: boolean;
  npmScope?: string;
  updateCatalog?: boolean;
}

export interface ReleaseAllResult {
  version: string;
  outDir: string;
  desktop: BuildPrismuxDesktopResult | null;
  plugins: PackPluginResult[];
  unscopedNpmPackages: BuiltNpmPluginPackage[];
  scopedNpmPackages: BuiltNpmPluginPackage[];
  sumsPath: string;
}

/**
 * Full v0.1.0-alpha.1 release coordinator: builds the T3-based Prismux desktop
 * installer cleanly (with zero prebundled plugins), packs the 4 standalone
 * `.wb-plugin` archives + updates `plugins-official/catalog/official.json`,
 * generates standalone npm plugin wrapper packages, and emits `SHA256SUMS.txt`.
 */
export function runReleaseAll(options: ReleaseAllOptions = {}): ReleaseAllResult {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(options.repoRoot ?? resolve(here, '..'));
  const version = (options.version ?? readRepoVersion(repoRoot)).trim();
  const outDir = resolve(
    options.outDir ?? join(repoRoot, '.work', `release-v${version}`),
  );
  mkdirSync(outDir, { recursive: true });

  let desktop: BuildPrismuxDesktopResult | null = null;
  if (!options.skipDesktop) {
    desktop = buildPrismuxDesktop({
      repoRoot,
      version,
      outDir,
      installer: !options.skipInstaller,
      skipRust: Boolean(options.skipRust),
      skipRootBuild: Boolean(options.skipRootBuild),
    });
  }

  const pluginsOutDir = join(outDir, 'plugins');
  mkdirSync(pluginsOutDir, { recursive: true });

  const catalogPath = join(repoRoot, 'plugins-official', 'catalog', 'official.json');
  const shouldUpdateCatalog =
    options.updateCatalog !== false && existsSync(catalogPath);

  const plugins: PackPluginResult[] = [];
  for (const id of OFFICIAL_PLUGIN_IDS) {
    const packed = packPlugin({
      pluginDir: join(repoRoot, 'plugins-official', `plugin-${id}`),
      outDir: pluginsOutDir,
      ...(shouldUpdateCatalog ? { updateCatalogPath: catalogPath } : {}),
    });
    plugins.push(packed);
  }

  const unscopedNpmPackages = buildNpmPluginPackages({
    repoRoot,
    releaseDir: pluginsOutDir,
    outDir: join(outDir, 'npm-plugins', 'unscoped'),
    version,
  });

  const scopedNpmPackages = buildNpmPluginPackages({
    repoRoot,
    releaseDir: pluginsOutDir,
    outDir: join(outDir, 'npm-plugins', 'scoped'),
    scope: options.npmScope ?? '@fish-under-sea',
    version,
  });

  const sumLines: string[] = [];
  if (desktop?.installerExePath && desktop.installerSha256) {
    sumLines.push(
      `${desktop.installerSha256}  ${basename(desktop.installerExePath)}`,
    );
  }
  for (const plugin of plugins) {
    sumLines.push(`${plugin.sha256}  plugins/${basename(plugin.archivePath)}`);
  }

  const sumsPath = join(outDir, 'SHA256SUMS.txt');
  writeFileSync(sumsPath, `${sumLines.join('\n')}\n`, 'utf8');

  return {
    version,
    outDir,
    desktop,
    plugins,
    unscopedNpmPackages,
    scopedNpmPackages,
    sumsPath,
  };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      version: { type: 'string' },
      'skip-desktop': { type: 'boolean', default: false },
      'skip-installer': { type: 'boolean', default: false },
      'skip-rust': { type: 'boolean', default: false },
      'skip-root-build': { type: 'boolean', default: false },
      scope: { type: 'string' },
      'no-catalog-update': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(
      'Usage: node scripts/release-all.ts [--out <dir>] [--version <ver>] [--skip-desktop] [--skip-installer] [--skip-rust] [--skip-root-build] [--scope @fish-under-sea] [--no-catalog-update]',
    );
    return;
  }

  const result = runReleaseAll({
    ...(values.out !== undefined ? { outDir: values.out } : {}),
    ...(values.version !== undefined ? { version: values.version } : {}),
    skipDesktop: values['skip-desktop'],
    skipInstaller: values['skip-installer'],
    skipRust: values['skip-rust'],
    skipRootBuild: values['skip-root-build'],
    ...(values.scope !== undefined ? { npmScope: values.scope } : {}),
    updateCatalog: !values['no-catalog-update'],
  });

  console.log(`\n[release:all] Complete v${result.version} -> ${result.outDir}`);
  if (result.desktop?.installerExePath) {
    console.log(`  Installer: ${basename(result.desktop.installerExePath)}`);
  }
  for (const plugin of result.plugins) {
    console.log(`  Plugin:    ${basename(plugin.archivePath)} (${plugin.sha256})`);
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main();
}
