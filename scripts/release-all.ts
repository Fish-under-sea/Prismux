import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildNpmPluginPackages, type BuiltNpmPluginPackage } from "./build-npm-plugin-packages.ts";
import { buildPrismuxDesktop, type BuildPrismuxDesktopResult } from "./build-prismux-desktop.ts";
import {
  OFFICIAL_PLUGIN_IDS,
  RELEASE_CATALOG_FILENAME,
  formatPluginsSumsFilename,
  formatSoftwareSumsFilename,
  readRepoVersion,
  writeConsolidatedSha256File,
} from "./build-release-packages.ts";
import { packPlugin, type PackPluginResult } from "./pack-plugin.ts";

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
  pluginsSumsPath: string;
  catalogPath: string | null;
}

/**
 * Full release coordinator: builds the Prismux desktop
 * installer cleanly (with zero prebundled plugins), packs the active standalone
 * `.wb-plugin` archive (`qq`) + updates `plugins-official/catalog/official.json`,
 * generates standalone npm plugin wrapper packages, and emits `SHA256SUMS.txt`.
 */
export function runReleaseAll(options: ReleaseAllOptions = {}): ReleaseAllResult {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(options.repoRoot ?? resolve(here, ".."));
  const version = (options.version ?? readRepoVersion(repoRoot)).trim();
  const outDir = resolve(options.outDir ?? join(repoRoot, ".work", `release-v${version}`));
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

  const pluginsOutDir = join(outDir, "plugins");
  mkdirSync(pluginsOutDir, { recursive: true });

  const catalogPath = join(repoRoot, "plugins-official", "catalog", "official.json");
  const shouldUpdateCatalog = options.updateCatalog !== false && existsSync(catalogPath);

  const plugins: PackPluginResult[] = [];
  for (const id of OFFICIAL_PLUGIN_IDS) {
    const packed = packPlugin({
      pluginDir: join(repoRoot, "plugins-official", `plugin-${id}`),
      outDir: pluginsOutDir,
      ...(shouldUpdateCatalog ? { updateCatalogPath: catalogPath } : {}),
      emitChecksum: false,
    });
    plugins.push(packed);
  }

  let releaseCatalogPath: string | null = null;
  if (existsSync(catalogPath)) {
    releaseCatalogPath = join(outDir, RELEASE_CATALOG_FILENAME);
    cpSync(catalogPath, releaseCatalogPath);
  }

  const unscopedNpmPackages = buildNpmPluginPackages({
    repoRoot,
    releaseDir: pluginsOutDir,
    outDir: join(outDir, "npm-plugins", "unscoped"),
    version,
  });

  const scopedNpmPackages = buildNpmPluginPackages({
    repoRoot,
    releaseDir: pluginsOutDir,
    outDir: join(outDir, "npm-plugins", "scoped"),
    scope: options.npmScope ?? "@fish-under-sea",
    version,
  });

  const softwareFiles: string[] = [];
  if (desktop?.installerExePath && existsSync(desktop.installerExePath)) {
    softwareFiles.push(desktop.installerExePath);
  }
  const sumsPath = writeConsolidatedSha256File(
    join(outDir, formatSoftwareSumsFilename(version)),
    softwareFiles,
  );

  const splitDir = join(outDir, ".gitee-split");
  if (existsSync(splitDir)) {
    const splitParts = readdirSync(splitDir)
      .sort((a, b) => a.localeCompare(b))
      .filter((part) => /\.7z\.\d{3}$/i.test(part))
      .map((part) => join(splitDir, part));
    if (splitParts.length > 0) {
      writeConsolidatedSha256File(join(splitDir, formatSoftwareSumsFilename(version)), [
        ...softwareFiles,
        ...splitParts,
      ]);
    }
  }

  const pluginTargets = [
    ...plugins.map((item) => item.archivePath),
    ...(releaseCatalogPath ? [releaseCatalogPath] : []),
  ];
  const pluginsSumsPath = writeConsolidatedSha256File(
    join(outDir, formatPluginsSumsFilename(version)),
    pluginTargets,
  );

  return {
    version,
    outDir,
    desktop,
    plugins,
    unscopedNpmPackages,
    scopedNpmPackages,
    sumsPath,
    pluginsSumsPath,
    catalogPath: releaseCatalogPath,
  };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      version: { type: "string" },
      "skip-desktop": { type: "boolean", default: false },
      "skip-installer": { type: "boolean", default: false },
      "skip-rust": { type: "boolean", default: false },
      "skip-root-build": { type: "boolean", default: false },
      scope: { type: "string" },
      "no-catalog-update": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(
      "Usage: node scripts/release-all.ts [--out <dir>] [--version <ver>] [--skip-desktop] [--skip-installer] [--skip-rust] [--skip-root-build] [--scope @fish-under-sea] [--no-catalog-update]",
    );
    return;
  }

  const result = runReleaseAll({
    ...(values.out !== undefined ? { outDir: values.out } : {}),
    ...(values.version !== undefined ? { version: values.version } : {}),
    skipDesktop: values["skip-desktop"],
    skipInstaller: values["skip-installer"],
    skipRust: values["skip-rust"],
    skipRootBuild: values["skip-root-build"],
    ...(values.scope !== undefined ? { npmScope: values.scope } : {}),
    updateCatalog: !values["no-catalog-update"],
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
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main();
}
