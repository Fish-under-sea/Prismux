import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';

export interface PluginPackageJson {
  name?: string;
  version?: string;
  engines?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PluginManifest {
  id: string;
  version: string;
  realms: string[];
  permissions: string[];
  modelVisible: boolean;
  behaviors?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TarFileInput {
  posixPath: string;
  content: Buffer;
}

export interface PackPluginOptions {
  pluginDir: string;
  outDir?: string;
  updateCatalogPath?: string;
}

export interface PackPluginResult {
  id: string;
  version: string;
  archivePath: string;
  checksumPath: string;
  sha256: string;
  bytes: number;
  tarBytes: number;
  fileCount: number;
  catalogUpdated: boolean;
}

export interface ParsedTarEntry {
  path: string;
  content: Buffer;
  mode: string;
  uid: number;
  gid: number;
  mtime: number;
  magic: string;
}

export interface CliOutput {
  log: (message: string) => void;
  error: (message: string) => void;
}

export const SKIPPED_DIR_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.work',
]);

export const SKIPPED_FILE_NAMES: ReadonlySet<string> = new Set(['.DS_Store']);

export const SKIPPED_FILE_SUFFIXES: readonly string[] = [
  '.wb-plugin',
  '.sha256',
];

const TAR_BLOCK_SIZE = 512;
const MAX_USTAR_NAME_BYTES = 100;
const MAX_USTAR_PREFIX_BYTES = 155;
const MAX_USTAR_SIZE = 0o77777777777;
const SAFE_PLUGIN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SAFE_SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonRecord(filePath: string, label: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    throw new Error(`Missing required file ${label}: ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in ${label} (${filePath}): ${message}`);
  }
  if (!isPlainRecord(parsed)) {
    throw new Error(`${label} must be a JSON object: ${filePath}`);
  }
  return parsed;
}

function validateSafeSegment(
  value: unknown,
  field: string,
  pattern: RegExp,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`plugin.manifest.json field "${field}" must be a non-empty string`);
  }
  if (
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    !pattern.test(value)
  ) {
    throw new Error(
      `plugin.manifest.json field "${field}" contains unsafe or invalid value: ${value}`,
    );
  }
  return value;
}

/**
 * Validates `<plugin>/package.json` top-level `engines.prismux` (never falling
 * back to `peerDependencies`) and `<plugin>/plugin.manifest.json`.
 */
export function validatePluginMetadata(pluginDir: string): {
  packageJson: PluginPackageJson;
  manifest: PluginManifest;
  prismuxEngineRange: string;
} {
  const pkgPath = join(pluginDir, 'package.json');
  const pkgRaw = readJsonRecord(pkgPath, 'package.json');

  const engines = pkgRaw['engines'];
  if (!isPlainRecord(engines)) {
    throw new Error(
      `Missing required top-level "engines.prismux" field in ${pkgPath} (peerDependencies fallback is forbidden)`,
    );
  }
  const prismuxRange = engines['prismux'];
  if (typeof prismuxRange !== 'string' || prismuxRange.trim().length === 0) {
    throw new Error(
      `Missing or empty top-level "engines.prismux" string in ${pkgPath} (peerDependencies fallback is forbidden)`,
    );
  }

  const manifestPath = join(pluginDir, 'plugin.manifest.json');
  const manifestRaw = readJsonRecord(manifestPath, 'plugin.manifest.json');

  const id = validateSafeSegment(manifestRaw['id'], 'id', SAFE_PLUGIN_ID_PATTERN);
  const version = validateSafeSegment(
    manifestRaw['version'],
    'version',
    SAFE_SEMVER_PATTERN,
  );

  const realms = manifestRaw['realms'];
  if (
    !Array.isArray(realms) ||
    realms.length === 0 ||
    !realms.every((item) => typeof item === 'string' && item.trim().length > 0)
  ) {
    throw new Error(
      `plugin.manifest.json field "realms" must be a non-empty string array in ${manifestPath}`,
    );
  }

  const permissions = manifestRaw['permissions'];
  if (
    !Array.isArray(permissions) ||
    !permissions.every((item) => typeof item === 'string')
  ) {
    throw new Error(
      `plugin.manifest.json field "permissions" must be a string array in ${manifestPath}`,
    );
  }

  const modelVisible = manifestRaw['modelVisible'];
  if (typeof modelVisible !== 'boolean') {
    throw new Error(
      `plugin.manifest.json field "modelVisible" must be a boolean in ${manifestPath}`,
    );
  }

  const manifest: PluginManifest = {
    ...manifestRaw,
    id,
    version,
    realms: [...realms],
    permissions: [...permissions],
    modelVisible,
  };

  return {
    packageJson: pkgRaw as PluginPackageJson,
    manifest,
    prismuxEngineRange: prismuxRange.trim(),
  };
}

/**
 * Splits a POSIX relative path into POSIX ustar `prefix` (<= 155 UTF-8 bytes)
 * and `name` (<= 100 UTF-8 bytes) fields.
 */
export function splitUstarPath(posixPath: string): {
  name: string;
  prefix: string;
} {
  if (
    posixPath.length === 0 ||
    posixPath.startsWith('/') ||
    posixPath.includes('\\')
  ) {
    throw new Error(`Tar entry path must be non-empty relative POSIX path: "${posixPath}"`);
  }

  const totalBytes = Buffer.byteLength(posixPath, 'utf8');
  if (totalBytes <= MAX_USTAR_NAME_BYTES) {
    return { name: posixPath, prefix: '' };
  }

  let searchFrom = posixPath.length - 1;
  while (searchFrom > 0) {
    const slashIdx = posixPath.lastIndexOf('/', searchFrom);
    if (slashIdx <= 0) {
      break;
    }

    const prefix = posixPath.slice(0, slashIdx);
    const name = posixPath.slice(slashIdx + 1);
    const prefixBytes = Buffer.byteLength(prefix, 'utf8');
    const nameBytes = Buffer.byteLength(name, 'utf8');

    if (
      prefixBytes > 0 &&
      prefixBytes <= MAX_USTAR_PREFIX_BYTES &&
      nameBytes > 0 &&
      nameBytes <= MAX_USTAR_NAME_BYTES
    ) {
      return { name, prefix };
    }
    searchFrom = slashIdx - 1;
  }

  throw new Error(
    `Path exceeds POSIX ustar limits (prefix <= ${MAX_USTAR_PREFIX_BYTES}, name <= ${MAX_USTAR_NAME_BYTES} bytes): ${posixPath}`,
  );
}

function writeAsciiField(
  target: Buffer,
  offset: number,
  maxBytes: number,
  value: string,
): void {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length > maxBytes) {
    throw new Error(`Field exceeds ${maxBytes} bytes: ${value}`);
  }
  encoded.copy(target, offset);
}

/**
 * Creates a deterministic 512-byte POSIX.1-1988 ustar header for a regular file
 * with fixed mtime=0, uid=0, gid=0, mode=0644.
 */
export function createUstarHeader(posixPath: string, size: number): Buffer {
  if (!Number.isInteger(size) || size < 0 || size > MAX_USTAR_SIZE) {
    throw new Error(`Invalid tar file size (${size}) for ${posixPath}`);
  }

  const { name, prefix } = splitUstarPath(posixPath);
  const header = Buffer.alloc(TAR_BLOCK_SIZE, 0);

  writeAsciiField(header, 0, MAX_USTAR_NAME_BYTES, name);
  writeAsciiField(header, 100, 8, '0000644\0');
  writeAsciiField(header, 108, 8, '0000000\0');
  writeAsciiField(header, 116, 8, '0000000\0');
  writeAsciiField(header, 124, 12, `${size.toString(8).padStart(11, '0')}\0`);
  writeAsciiField(header, 136, 12, '00000000000\0');

  // Checksum field is treated as 8 ASCII spaces during checksum calculation.
  header.fill(0x20, 148, 156);
  header[156] = 0x30; // '0' regular file
  writeAsciiField(header, 257, 6, 'ustar\0');
  writeAsciiField(header, 263, 2, '00');
  writeAsciiField(header, 329, 8, '0000000\0');
  writeAsciiField(header, 337, 8, '0000000\0');
  if (prefix.length > 0) {
    writeAsciiField(header, 345, MAX_USTAR_PREFIX_BYTES, prefix);
  }

  let checksum = 0;
  for (let i = 0; i < TAR_BLOCK_SIZE; i += 1) {
    checksum += header[i] ?? 0;
  }
  writeAsciiField(
    header,
    148,
    8,
    `${checksum.toString(8).padStart(6, '0')}\0 `,
  );

  return header;
}

function comparePosixPaths(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Serializes file entries into a deterministic POSIX ustar `.tar` archive
 * sorted in POSIX byte order and terminated by two 512-byte zero blocks.
 */
export function createDeterministicTar(files: readonly TarFileInput[]): Buffer {
  const sorted = [...files].sort((a, b) =>
    comparePosixPaths(a.posixPath, b.posixPath),
  );

  const seenPaths = new Set<string>();
  const chunks: Buffer[] = [];

  for (const file of sorted) {
    if (seenPaths.has(file.posixPath)) {
      throw new Error(`Duplicate tar entry path: ${file.posixPath}`);
    }
    seenPaths.add(file.posixPath);

    chunks.push(createUstarHeader(file.posixPath, file.content.length));
    chunks.push(file.content);

    const remainder = file.content.length % TAR_BLOCK_SIZE;
    if (remainder !== 0) {
      chunks.push(Buffer.alloc(TAR_BLOCK_SIZE - remainder, 0));
    }
  }

  // Two 512-byte all-zero blocks mark end-of-archive.
  chunks.push(Buffer.alloc(TAR_BLOCK_SIZE * 2, 0));
  return Buffer.concat(chunks);
}

function readNullTerminatedAscii(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  const nulIdx = slice.indexOf(0);
  const end = nulIdx === -1 ? slice.length : nulIdx;
  return slice.subarray(0, end).toString('utf8');
}

function verifyTarHeaderChecksum(header: Buffer): void {
  const expectedOctal = readNullTerminatedAscii(header, 148, 8).trim();
  const expected = Number.parseInt(expectedOctal, 8);
  if (Number.isNaN(expected)) {
    throw new Error(`Invalid tar header checksum string: "${expectedOctal}"`);
  }

  let actual = 0;
  for (let i = 0; i < TAR_BLOCK_SIZE; i += 1) {
    actual += i >= 148 && i < 156 ? 0x20 : (header[i] ?? 0);
  }
  if (actual !== expected) {
    throw new Error(
      `Tar header checksum mismatch: expected ${expected}, computed ${actual}`,
    );
  }
}

/**
 * Parses a POSIX ustar `.tar` buffer back into entries while validating header
 * checksums and zero-block padding. Useful for verification and unit testing.
 */
export function extractTarEntries(tarBuffer: Buffer): ParsedTarEntry[] {
  if (tarBuffer.length % TAR_BLOCK_SIZE !== 0) {
    throw new Error(
      `Invalid tar buffer length (${tarBuffer.length}): must be a multiple of ${TAR_BLOCK_SIZE}`,
    );
  }

  const entries: ParsedTarEntry[] = [];
  let offset = 0;

  while (offset + TAR_BLOCK_SIZE <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + TAR_BLOCK_SIZE);
    offset += TAR_BLOCK_SIZE;

    const isZeroBlock = header.every((byte) => byte === 0);
    if (isZeroBlock) {
      break;
    }

    verifyTarHeaderChecksum(header);

    const name = readNullTerminatedAscii(header, 0, MAX_USTAR_NAME_BYTES);
    const mode = readNullTerminatedAscii(header, 100, 8).trim();
    const uid = Number.parseInt(readNullTerminatedAscii(header, 108, 8).trim(), 8);
    const gid = Number.parseInt(readNullTerminatedAscii(header, 116, 8).trim(), 8);
    const size = Number.parseInt(readNullTerminatedAscii(header, 124, 12).trim(), 8);
    const mtime = Number.parseInt(readNullTerminatedAscii(header, 136, 12).trim(), 8);
    const magic = header.subarray(257, 263).toString('utf8');
    const prefix = readNullTerminatedAscii(header, 345, MAX_USTAR_PREFIX_BYTES);

    if (Number.isNaN(size) || size < 0 || offset + size > tarBuffer.length) {
      throw new Error(`Invalid tar entry size (${size}) for ${name}`);
    }

    const fullPath = prefix.length > 0 ? `${prefix}/${name}` : name;
    const content = Buffer.from(tarBuffer.subarray(offset, offset + size));
    const paddedSize = Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    offset += paddedSize;

    entries.push({
      path: fullPath,
      content,
      mode,
      uid,
      gid,
      mtime,
      magic,
    });
  }

  return entries;
}

function shouldSkipFile(filename: string): boolean {
  if (SKIPPED_FILE_NAMES.has(filename)) {
    return true;
  }
  return SKIPPED_FILE_SUFFIXES.some((suffix) => filename.endsWith(suffix));
}

/**
 * Recursively collects plugin files sorted in POSIX byte order while omitting
 * dependencies, VCS metadata, scratch dirs, and pre-built archive outputs.
 */
export function collectPluginFiles(pluginDir: string): TarFileInput[] {
  const root = resolve(pluginDir);
  const collected: TarFileInput[] = [];

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir, { withFileTypes: true }).sort(
      (a, b) => comparePosixPaths(a.name, b.name),
    );

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIR_NAMES.has(entry.name)) {
          continue;
        }
        walk(fullPath);
        continue;
      }

      if (!entry.isFile() || shouldSkipFile(entry.name)) {
        continue;
      }

      const posixPath = relative(root, fullPath).split(sep).join('/');
      collected.push({
        posixPath,
        content: readFileSync(fullPath),
      });
    }
  }

  walk(root);
  collected.sort((a, b) => comparePosixPaths(a.posixPath, b.posixPath));
  return collected;
}

function writeBufferAtomic(targetPath: string, payload: Buffer | string): void {
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    if (typeof payload === 'string') {
      writeFileSync(tempPath, payload, 'utf8');
    } else {
      writeFileSync(tempPath, payload);
    }
    renameSync(tempPath, targetPath);
  } catch (err) {
    rmSync(tempPath, { force: true });
    throw err;
  }
}

/**
 * Atomically updates a plugin entry in an official/community catalog JSON file.
 */
export function updateCatalogFile(
  catalogPath: string,
  pluginId: string,
  metadata: {
    version: string;
    sha256: string;
    bytes: number;
    engines?: Record<string, unknown>;
  },
): void {
  const resolvedPath = resolve(catalogPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Catalog JSON file not found: ${resolvedPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolvedPath, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in catalog ${resolvedPath}: ${message}`);
  }

  let list: unknown[];
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (isPlainRecord(parsed) && Array.isArray(parsed['plugins'])) {
    list = parsed['plugins'];
  } else {
    throw new Error(
      `Catalog JSON must be an array or an object with a "plugins" array: ${resolvedPath}`,
    );
  }

  const target = list.find(
    (item): item is Record<string, unknown> =>
      isPlainRecord(item) && item['id'] === pluginId,
  );
  if (!target) {
    throw new Error(
      `Plugin "${pluginId}" not found in catalog file: ${resolvedPath}`,
    );
  }

  target['version'] = metadata.version;
  target['sha256'] = metadata.sha256;
  target['bytes'] = metadata.bytes;
  target['status'] = 'verified';
  if (metadata.engines && typeof metadata.engines['prismux'] === 'string') {
    target['engines'] = { prismux: metadata.engines['prismux'] };
  }

  writeBufferAtomic(resolvedPath, `${JSON.stringify(parsed, null, 2)}\n`);
}

/**
 * Validates plugin contracts, builds a deterministic POSIX ustar `.tar` -> `.wb-plugin`
 * gzip archive with mandatory byte-for-byte gunzip roundtrip verification, and emits
 * `<id>-<version>.wb-plugin` + `<id>-<version>.sha256`.
 */
export function packPlugin(options: PackPluginOptions): PackPluginResult {
  const pluginDir = resolve(options.pluginDir);
  let pluginStats;
  try {
    pluginStats = statSync(pluginDir);
  } catch {
    throw new Error(`Plugin directory does not exist: ${pluginDir}`);
  }
  if (!pluginStats.isDirectory()) {
    throw new Error(`Plugin path is not a directory: ${pluginDir}`);
  }

  const { packageJson, manifest } = validatePluginMetadata(pluginDir);
  const outDir = resolve(options.outDir ?? join(process.cwd(), '.work', 'plugin-dist'));

  const files = collectPluginFiles(pluginDir);
  if (files.length === 0) {
    throw new Error(`Plugin directory contains no packable files: ${pluginDir}`);
  }

  const tarBuffer = createDeterministicTar(files);
  const gzippedBuffer = gzipSync(tarBuffer, { level: 9 });

  // Mandatory roundtrip check to guard against corrupted zlib streams before emitting artifacts.
  const roundtripTar = gunzipSync(gzippedBuffer);
  if (Buffer.compare(roundtripTar, tarBuffer) !== 0) {
    throw new Error(
      'Gzip roundtrip verification failed: gunzip output does not match original tar bytes',
    );
  }

  const archiveFilename = `${manifest.id}-${manifest.version}.wb-plugin`;
  const checksumFilename = `${manifest.id}-${manifest.version}.sha256`;
  const archivePath = resolve(outDir, archiveFilename);
  const checksumPath = resolve(outDir, checksumFilename);

  const relArchive = relative(outDir, archivePath);
  if (relArchive.startsWith('..') || isAbsolute(relArchive)) {
    throw new Error(`Output archive path escapes output directory: ${archivePath}`);
  }

  const sha256 = createHash('sha256').update(gzippedBuffer).digest('hex');

  writeBufferAtomic(archivePath, gzippedBuffer);
  writeBufferAtomic(checksumPath, `${sha256}  ${archiveFilename}\n`);

  let catalogUpdated = false;
  if (options.updateCatalogPath) {
    updateCatalogFile(options.updateCatalogPath, manifest.id, {
      version: manifest.version,
      sha256,
      bytes: gzippedBuffer.length,
      ...(packageJson.engines ? { engines: packageJson.engines } : {}),
    });
    catalogUpdated = true;
  }

  return {
    id: manifest.id,
    version: manifest.version,
    archivePath,
    checksumPath,
    sha256,
    bytes: gzippedBuffer.length,
    tarBytes: tarBuffer.length,
    fileCount: files.length,
    catalogUpdated,
  };
}

export function getPackPluginUsage(): string {
  return [
    'Usage: node scripts/pack-plugin.ts --plugin <dir> [options]',
    '',
    'Options:',
    '  --plugin <dir>           Plugin source directory containing package.json & plugin.manifest.json',
    '  --out <dir>              Output directory (default: .work/plugin-dist)',
    '  --update-catalog <path>  Atomically update matching entry in catalog JSON',
    '  --json                   Emit result as JSON',
    '  -h, --help               Show this help message',
  ].join('\n');
}

export function parsePackPluginArgs(argv: readonly string[]): {
  help: boolean;
  json: boolean;
  options: PackPluginOptions;
} {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      plugin: { type: 'string' },
      out: { type: 'string' },
      'update-catalog': { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    return {
      help: true,
      json: values.json,
      options: { pluginDir: values.plugin ?? '' },
    };
  }

  if (!values.plugin || values.plugin.trim().length === 0) {
    throw new Error('Missing required "--plugin <dir>" option');
  }

  return {
    help: false,
    json: values.json,
    options: {
      pluginDir: values.plugin,
      outDir: values.out,
      updateCatalogPath: values['update-catalog'],
    },
  };
}

export function runPackPluginCli(
  argv: readonly string[] = process.argv.slice(2),
  io: CliOutput = { log: console.log, error: console.error },
): number {
  try {
    const parsed = parsePackPluginArgs(argv);
    if (parsed.help) {
      io.log(getPackPluginUsage());
      return 0;
    }

    const result = packPlugin(parsed.options);
    if (parsed.json) {
      io.log(JSON.stringify(result, null, 2));
    } else {
      io.log(
        `Packed ${result.id}@${result.version} (${result.fileCount} files, ${result.bytes} bytes) -> ${result.archivePath}`,
      );
      io.log(`SHA-256: ${result.sha256} (${result.checksumPath})`);
      if (result.catalogUpdated) {
        io.log(`Catalog updated: ${parsed.options.updateCatalogPath}`);
      }
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.error(`pack-plugin failed: ${message}`);
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
  process.exitCode = runPackPluginCli(process.argv.slice(2));
}
