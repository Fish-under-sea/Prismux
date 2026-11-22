import {
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export interface BrandIdentity {
  appName: string;
  appSlug: string;
  npmScope: string;
  pluginPrefix: string;
}

export interface RenameBrandOptions {
  root?: string;
  appName?: string;
  appSlug?: string;
  npmScope?: string;
  pluginPrefix?: string;
  fromAppName?: string;
  fromAppSlug?: string;
  fromNpmScope?: string;
  fromPluginPrefix?: string;
  dryRun?: boolean;
}

export interface BrandReplacementRule {
  kind: 'pluginPrefix' | 'npmScope' | 'appName' | 'appSlug';
  from: string;
  to: string;
}

export interface RenameFileChange {
  path: string;
  replacements: number;
}

export interface RenameBrandReport {
  root: string;
  dryRun: boolean;
  scannedFiles: number;
  skippedFiles: number;
  changedFiles: RenameFileChange[];
  totalReplacements: number;
}

export interface CliOutput {
  log: (message: string) => void;
  error: (message: string) => void;
}

export const DEFAULT_FROM_BRAND: BrandIdentity = {
  appName: 'Prismux',
  appSlug: 'prismux',
  npmScope: '@prismux',
  pluginPrefix: 'prismux-plugin-',
};

export const SKIPPED_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'vendor',
  'node_modules',
  'dist',
  '.work',
  'target',
]);

export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.icns',
  '.wb-plugin',
  '.tgz',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.7z',
  '.zip',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.wal',
  '.shm',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.node',
  '.wasm',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.wav',
  '.ogg',
  '.webm',
  '.mov',
  '.pdf',
  '.bin',
  '.lockb',
]);

function assertNonEmptyToken(value: string, label: string): string {
  if (value.trim().length === 0) {
    throw new Error(`Brand token "${label}" must be a non-empty string`);
  }
  return value;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds replacement rules ordered longest-prefix-first (and by specificity
 * on ties) so overlapping tokens never collide or double-replace.
 */
export function buildReplacementRules(
  options: RenameBrandOptions,
): BrandReplacementRule[] {
  const fromPluginPrefix = assertNonEmptyToken(
    options.fromPluginPrefix ?? DEFAULT_FROM_BRAND.pluginPrefix,
    'fromPluginPrefix',
  );
  const fromNpmScope = assertNonEmptyToken(
    options.fromNpmScope ?? DEFAULT_FROM_BRAND.npmScope,
    'fromNpmScope',
  );
  const fromAppName = assertNonEmptyToken(
    options.fromAppName ?? DEFAULT_FROM_BRAND.appName,
    'fromAppName',
  );
  const fromAppSlug = assertNonEmptyToken(
    options.fromAppSlug ?? DEFAULT_FROM_BRAND.appSlug,
    'fromAppSlug',
  );

  const toPluginPrefix = assertNonEmptyToken(
    options.pluginPrefix ?? fromPluginPrefix,
    'pluginPrefix',
  );
  const toNpmScope = assertNonEmptyToken(
    options.npmScope ?? fromNpmScope,
    'npmScope',
  );
  const toAppName = assertNonEmptyToken(
    options.appName ?? fromAppName,
    'appName',
  );
  const toAppSlug = assertNonEmptyToken(
    options.appSlug ?? fromAppSlug,
    'appSlug',
  );

  const candidates: BrandReplacementRule[] = [
    { kind: 'pluginPrefix', from: fromPluginPrefix, to: toPluginPrefix },
    { kind: 'npmScope', from: fromNpmScope, to: toNpmScope },
    { kind: 'appName', from: fromAppName, to: toAppName },
    { kind: 'appSlug', from: fromAppSlug, to: toAppSlug },
  ];

  // Deduplicate identical `from` tokens keeping highest priority.
  // Note: we intentionally keep no-op rules (from === to) in the single-pass
  // matcher as protective shields so shorter rules (e.g. appSlug) never
  // partially corrupt unchanged longer tokens (e.g. npmScope or pluginPrefix).
  const seenFrom = new Set<string>();
  const active: BrandReplacementRule[] = [];
  for (const rule of candidates) {
    if (seenFrom.has(rule.from)) {
      continue;
    }
    seenFrom.add(rule.from);
    active.push(rule);
  }

  return active.sort((a, b) => b.from.length - a.from.length);
}

/**
 * Applies all active replacement rules in a single left-to-right regex pass so
 * newly written target brand names and unchanged longer prefixes are never
 * re-matched or partially corrupted by shorter rules.
 */
export function replaceBrandContent(
  content: string,
  rules: readonly BrandReplacementRule[],
): { text: string; replacements: number } {
  if (rules.length === 0 || content.length === 0) {
    return { text: content, replacements: 0 };
  }
  if (rules.every((rule) => rule.from === rule.to)) {
    return { text: content, replacements: 0 };
  }

  const lookup = new Map<string, string>();
  const alternatives: string[] = [];
  for (const rule of rules) {
    lookup.set(rule.from, rule.to);
    alternatives.push(escapeRegExp(rule.from));
  }

  const pattern = new RegExp(alternatives.join('|'), 'g');
  let replacements = 0;
  const text = content.replace(pattern, (matched) => {
    const replacement = lookup.get(matched);
    if (replacement === undefined || replacement === matched) {
      return matched;
    }
    replacements += 1;
    return replacement;
  });

  return { text, replacements };
}

function collectTextFiles(rootDir: string): {
  textFiles: string[];
  skippedFiles: number;
} {
  const textFiles: string[] = [];
  let skippedFiles = 0;

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir, { withFileTypes: true }).sort(
      (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) {
          continue;
        }
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) {
        skippedFiles += 1;
        continue;
      }

      textFiles.push(fullPath);
    }
  }

  walk(rootDir);
  return { textFiles, skippedFiles };
}

function toPosixRelative(rootDir: string, targetPath: string): string {
  return relative(rootDir, targetPath).split(sep).join('/');
}

/**
 * Recursively rebrands text files under `options.root` while skipping VCS,
 * vendor, build artifacts, and binary/media files.
 */
export function renameBrand(options: RenameBrandOptions = {}): RenameBrandReport {
  const root = resolve(options.root ?? process.cwd());
  let rootStats;
  try {
    rootStats = statSync(root);
  } catch {
    throw new Error(`Target root directory does not exist: ${root}`);
  }
  if (!rootStats.isDirectory()) {
    throw new Error(`Target root path is not a directory: ${root}`);
  }

  const dryRun = options.dryRun === true;
  const rules = buildReplacementRules(options);
  const { textFiles, skippedFiles: extSkipped } = collectTextFiles(root);

  let scannedFiles = 0;
  let binaryContentSkipped = 0;
  let totalReplacements = 0;
  const changedFiles: RenameFileChange[] = [];

  for (const filePath of textFiles) {
    const rawBuffer = readFileSync(filePath);
    if (rawBuffer.includes(0)) {
      binaryContentSkipped += 1;
      continue;
    }

    scannedFiles += 1;
    const original = rawBuffer.toString('utf8');
    const { text, replacements } = replaceBrandContent(original, rules);

    if (replacements > 0 && text !== original) {
      if (!dryRun) {
        writeFileSync(filePath, text, 'utf8');
      }
      totalReplacements += replacements;
      changedFiles.push({
        path: toPosixRelative(root, filePath),
        replacements,
      });
    }
  }

  changedFiles.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );

  return {
    root,
    dryRun,
    scannedFiles,
    skippedFiles: extSkipped + binaryContentSkipped,
    changedFiles,
    totalReplacements,
  };
}

export function getRenameBrandUsage(): string {
  return [
    'Usage: node scripts/rename-brand.ts [options]',
    '',
    'Options:',
    '  --app-name <Name>            Target display application name',
    '  --app-slug <slug>            Target CLI / data-dir slug',
    '  --npm-scope <@scope>         Target npm workspace scope',
    '  --plugin-prefix <prefix>     Target third-party plugin package prefix',
    '  --from-app-name <Name>       Source display name (default: Prismux)',
    '  --from-app-slug <slug>       Source slug (default: prismux)',
    '  --from-npm-scope <@scope>    Source npm scope (default: @prismux)',
    '  --from-plugin-prefix <pfx>   Source plugin prefix (default: prismux-plugin-)',
    '  --root <dir>                 Repository root directory (default: cwd)',
    '  --dry-run                    Preview changes without modifying disk files',
    '  --json                       Emit report as JSON',
    '  -h, --help                   Show this help message',
  ].join('\n');
}

export function parseRenameBrandArgs(argv: readonly string[]): {
  help: boolean;
  json: boolean;
  hasTargetBrandArg: boolean;
  options: RenameBrandOptions;
} {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      'app-name': { type: 'string' },
      'app-slug': { type: 'string' },
      'npm-scope': { type: 'string' },
      'plugin-prefix': { type: 'string' },
      'from-app-name': { type: 'string' },
      'from-app-slug': { type: 'string' },
      'from-npm-scope': { type: 'string' },
      'from-plugin-prefix': { type: 'string' },
      root: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  const hasTargetBrandArg =
    values['app-name'] !== undefined ||
    values['app-slug'] !== undefined ||
    values['npm-scope'] !== undefined ||
    values['plugin-prefix'] !== undefined;

  return {
    help: values.help,
    json: values.json,
    hasTargetBrandArg,
    options: {
      root: values.root,
      appName: values['app-name'],
      appSlug: values['app-slug'],
      npmScope: values['npm-scope'],
      pluginPrefix: values['plugin-prefix'],
      fromAppName: values['from-app-name'],
      fromAppSlug: values['from-app-slug'],
      fromNpmScope: values['from-npm-scope'],
      fromPluginPrefix: values['from-plugin-prefix'],
      dryRun: values['dry-run'],
    },
  };
}

export function runRenameBrandCli(
  argv: readonly string[] = process.argv.slice(2),
  io: CliOutput = { log: console.log, error: console.error },
): number {
  try {
    const parsed = parseRenameBrandArgs(argv);
    if (parsed.help) {
      io.log(getRenameBrandUsage());
      return 0;
    }

    if (!parsed.hasTargetBrandArg) {
      io.error(
        'Error: specify at least one of --app-name, --app-slug, --npm-scope, or --plugin-prefix.',
      );
      io.error('');
      io.error(getRenameBrandUsage());
      return 1;
    }

    const report = renameBrand(parsed.options);
    if (parsed.json) {
      io.log(JSON.stringify(report, null, 2));
    } else {
      const modeLabel = report.dryRun ? '[dry-run] ' : '';
      io.log(
        `${modeLabel}Scanned ${report.scannedFiles} text files (skipped ${report.skippedFiles}), ` +
          `changed ${report.changedFiles.length} files (${report.totalReplacements} replacements).`,
      );
      for (const item of report.changedFiles) {
        io.log(`  - ${item.path} (${item.replacements})`);
      }
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.error(`rename-brand failed: ${message}`);
    return 1;
  }
}

function isDirectExecution(metaUrl: string): boolean {
  const entryArg = process.argv[1];
  if (!entryArg) {
    return false;
  }
  try {
    const scriptPath = realpathSync(fileURLToPath(metaUrl));
    const entryPath = realpathSync(resolve(entryArg));
    return process.platform === 'win32'
      ? scriptPath.toLowerCase() === entryPath.toLowerCase()
      : scriptPath === entryPath;
  } catch {
    return false;
  }
}

if (isDirectExecution(import.meta.url)) {
  process.exitCode = runRenameBrandCli(process.argv.slice(2));
}
