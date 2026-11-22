import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export interface UpstreamLockData {
  upstreamRepo: string;
  branch: string;
  commit: string;
  syncedAt: string;
  license: string;
  readOnly: boolean;
  requiredPaths: string[];
}

export interface UpstreamContractResult {
  ok: boolean;
  vendorDir: string;
  commit: string;
  checkedPaths: string[];
  errors: string[];
}

export interface GitRunner {
  run(args: readonly string[], cwd?: string): string;
}

export interface SyncUpstreamResult {
  lockData: UpstreamLockData;
  checkResult: UpstreamContractResult;
}

export interface CliOutput {
  log: (message: string) => void;
  error: (message: string) => void;
}

export const DEFAULT_REQUIRED_PATHS: readonly string[] = [
  'apps/server/package.json',
  'packages/client-runtime',
  'packages/contracts',
  'docs/internals/overview.md',
];

export const GIT_SYNC_FLAGS: readonly string[] = [
  '-c',
  'core.longpaths=true',
  '-c',
  'http.sslBackend=openssl',
  '-c',
  'http.version=HTTP/1.1',
];

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/i;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`UPSTREAM_LOCK.json field "${field}" must be a non-empty string`);
  }
  return value.trim();
}

function validateSafeRelativePath(relPath: string): string {
  if (relPath.trim().length === 0) {
    throw new Error('UPSTREAM_LOCK.json requiredPaths contains an empty path');
  }
  if (isAbsolute(relPath) || relPath.startsWith('/') || relPath.startsWith('\\')) {
    throw new Error(`UPSTREAM_LOCK.json requiredPaths entry must be relative: ${relPath}`);
  }
  const segments = relPath.split(/[\\/]/);
  if (segments.includes('..')) {
    throw new Error(`UPSTREAM_LOCK.json requiredPaths entry cannot contain "..": ${relPath}`);
  }
  return relPath;
}

/**
 * Validates parsed `UPSTREAM_LOCK.json` structure and enforces `readOnly === true`.
 */
export function validateLockData(raw: unknown): UpstreamLockData {
  if (!isPlainRecord(raw)) {
    throw new Error('UPSTREAM_LOCK.json must be a JSON object');
  }

  const upstreamRepo = assertNonEmptyString(raw, 'upstreamRepo');
  const branch = assertNonEmptyString(raw, 'branch');
  const commit = assertNonEmptyString(raw, 'commit');
  if (!COMMIT_SHA_PATTERN.test(commit)) {
    throw new Error(`UPSTREAM_LOCK.json field "commit" is not a valid git SHA: ${commit}`);
  }

  const syncedAt = assertNonEmptyString(raw, 'syncedAt');
  if (Number.isNaN(Date.parse(syncedAt))) {
    throw new Error(`UPSTREAM_LOCK.json field "syncedAt" is not a valid ISO timestamp: ${syncedAt}`);
  }

  const license = assertNonEmptyString(raw, 'license');
  if (raw['readOnly'] !== true) {
    throw new Error(
      'UPSTREAM_LOCK.json field "readOnly" must be strictly true (vendor/t3code is read-only)',
    );
  }

  const requiredRaw = raw['requiredPaths'];
  if (!Array.isArray(requiredRaw) || requiredRaw.length === 0) {
    throw new Error('UPSTREAM_LOCK.json field "requiredPaths" must be a non-empty array');
  }

  const requiredPaths: string[] = [];
  for (const item of requiredRaw) {
    if (typeof item !== 'string') {
      throw new Error('UPSTREAM_LOCK.json field "requiredPaths" must contain only strings');
    }
    requiredPaths.push(validateSafeRelativePath(item));
  }

  return {
    upstreamRepo,
    branch,
    commit,
    syncedAt,
    license,
    readOnly: true,
    requiredPaths,
  };
}

export function readUpstreamLock(lockPath: string): UpstreamLockData {
  if (!existsSync(lockPath)) {
    throw new Error(`UPSTREAM_LOCK.json not found at ${lockPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse UPSTREAM_LOCK.json (${lockPath}): ${message}`);
  }
  return validateLockData(parsed);
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    renameSync(tempPath, filePath);
  } catch (err) {
    rmSync(tempPath, { force: true });
    throw err;
  }
}

function isInsideDirectory(baseDir: string, targetPath: string): boolean {
  const rel = relative(resolve(baseDir), resolve(targetPath));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function verifyJsonFile(filePath: string, label: string, errors: string[]): void {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!isPlainRecord(parsed)) {
      errors.push(`${label} must parse to a JSON object`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`${label} is not valid JSON: ${message}`);
  }
}

/**
 * Pure contract inspection returning structured errors without throwing.
 */
export function inspectUpstreamContract(
  repoRoot: string,
  lockData: UpstreamLockData,
  gitStatusOutput: string,
  actualHead: string,
  vendorDirOverride?: string,
): UpstreamContractResult {
  const errors: string[] = [];
  const checkedPaths: string[] = [];
  const resolvedRoot = resolve(repoRoot);
  const vendorDir = vendorDirOverride
    ? resolve(vendorDirOverride)
    : join(resolvedRoot, 'vendor', 't3code');

  let validatedLock: UpstreamLockData | null = null;
  try {
    validatedLock = validateLockData(lockData);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  let vendorExists = false;
  try {
    vendorExists = statSync(vendorDir).isDirectory();
  } catch {
    vendorExists = false;
  }
  if (!vendorExists) {
    errors.push(`Upstream directory missing: ${vendorDir}`);
  }

  if (gitStatusOutput.trim().length > 0) {
    errors.push(
      `违反禁止修改 vendor/t3code 红线 (vendor/t3code is strictly read-only): ` +
        `git status --porcelain is non-empty:\n${gitStatusOutput.trimEnd()}`,
    );
  }

  const normalizedHead = actualHead.trim();
  if (validatedLock) {
    if (normalizedHead.length === 0) {
      errors.push('Actual HEAD commit in vendor/t3code is empty');
    } else if (normalizedHead.toLowerCase() !== validatedLock.commit.toLowerCase()) {
      errors.push(
        `Commit mismatch in vendor/t3code: UPSTREAM_LOCK.json expects ${validatedLock.commit}, actual HEAD is ${normalizedHead}`,
      );
    }

    if (vendorExists) {
      for (const relPath of validatedLock.requiredPaths) {
        const candidate = resolve(vendorDir, relPath);
        if (!isInsideDirectory(vendorDir, candidate)) {
          errors.push(`Required path escapes vendor/t3code: ${relPath}`);
          continue;
        }
        if (!existsSync(candidate)) {
          errors.push(`Missing required upstream path in vendor/t3code: ${relPath}`);
          continue;
        }
        checkedPaths.push(relPath);
        if (relPath.endsWith('.json')) {
          verifyJsonFile(candidate, `vendor/t3code/${relPath}`, errors);
        }
      }

      // Always verify apps/server/package.json as a core contract requirement
      const serverPkgRel = 'apps/server/package.json';
      if (!validatedLock.requiredPaths.includes(serverPkgRel)) {
        const serverPkgPath = join(vendorDir, 'apps', 'server', 'package.json');
        if (!existsSync(serverPkgPath)) {
          errors.push(`Missing required upstream contract file: ${serverPkgRel}`);
        } else {
          checkedPaths.push(serverPkgRel);
          verifyJsonFile(serverPkgPath, `vendor/t3code/${serverPkgRel}`, errors);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    vendorDir,
    commit: normalizedHead,
    checkedPaths,
    errors,
  };
}

/**
 * Pure validation entrypoint used by both CLI checks and unit tests.
 * Throws an error if any upstream lock, read-only, commit, or contract check fails.
 */
export function validateUpstreamContract(
  repoRoot: string,
  lockData: UpstreamLockData,
  gitStatusOutput: string,
  actualHead: string,
  vendorDirOverride?: string,
): UpstreamContractResult {
  const result = inspectUpstreamContract(
    repoRoot,
    lockData,
    gitStatusOutput,
    actualHead,
    vendorDirOverride,
  );

  if (!result.ok) {
    throw new Error(
      `Upstream contract check failed:\n- ${result.errors.join('\n- ')}`,
    );
  }
  return result;
}

export function createDefaultGitRunner(): GitRunner {
  return {
    run(args: readonly string[], cwd?: string): string {
      return execFileSync('git', [...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    },
  };
}

function resolveUpstreamPaths(options?: {
  root?: string;
  lockPath?: string;
  vendorDir?: string;
}): { repoRoot: string; lockPath: string; vendorDir: string } {
  const repoRoot = resolve(options?.root ?? process.cwd());
  const lockPath = options?.lockPath
    ? resolve(options.lockPath)
    : join(repoRoot, 'UPSTREAM_LOCK.json');
  const vendorDir = options?.vendorDir
    ? resolve(options.vendorDir)
    : join(repoRoot, 'vendor', 't3code');
  return { repoRoot, lockPath, vendorDir };
}

/**
 * Verifies `UPSTREAM_LOCK.json`, submodule cleanliness, commit pin, and required paths.
 */
export function checkUpstream(
  options?: { root?: string; lockPath?: string; vendorDir?: string },
  gitRunner: GitRunner = createDefaultGitRunner(),
): UpstreamContractResult {
  const { repoRoot, lockPath, vendorDir } = resolveUpstreamPaths(options);
  const lockData = readUpstreamLock(lockPath);

  if (!existsSync(vendorDir)) {
    throw new Error(`vendor/t3code directory does not exist: ${vendorDir}`);
  }
  if (!existsSync(join(vendorDir, '.git'))) {
    throw new Error(
      `vendor/t3code is not an initialized git checkout/submodule (missing ${join(vendorDir, '.git')})`,
    );
  }

  const actualHead = gitRunner.run(['-C', vendorDir, 'rev-parse', 'HEAD']).trim();
  const gitStatusOutput = gitRunner.run(['-C', vendorDir, 'status', '--porcelain']);

  return validateUpstreamContract(
    repoRoot,
    lockData,
    gitStatusOutput,
    actualHead,
    vendorDir,
  );
}

/**
 * Fetches shallow upstream tip for the locked branch, updates `UPSTREAM_LOCK.json`,
 * and runs the full read-only & contract validation suite.
 */
export function syncUpstream(
  options?: { root?: string; lockPath?: string; vendorDir?: string },
  gitRunner: GitRunner = createDefaultGitRunner(),
): SyncUpstreamResult {
  const { repoRoot, lockPath, vendorDir } = resolveUpstreamPaths(options);
  const lockData = readUpstreamLock(lockPath);

  const hasGitCheckout = existsSync(join(vendorDir, '.git'));
  if (hasGitCheckout) {
    const preStatus = gitRunner.run(['-C', vendorDir, 'status', '--porcelain']);
    if (preStatus.trim().length > 0) {
      throw new Error(
        `Refusing to sync: 违反禁止修改 vendor/t3code 红线 (vendor/t3code has dirty changes):\n${preStatus.trimEnd()}`,
      );
    }
  } else if (existsSync(join(repoRoot, '.gitmodules'))) {
    gitRunner.run([
      ...GIT_SYNC_FLAGS,
      '-C',
      repoRoot,
      'submodule',
      'update',
      '--init',
      '--depth',
      '1',
      '--',
      'vendor/t3code',
    ]);
  } else {
    mkdirSync(dirname(vendorDir), { recursive: true });
    gitRunner.run([
      ...GIT_SYNC_FLAGS,
      'clone',
      '--depth',
      '1',
      '--branch',
      lockData.branch,
      lockData.upstreamRepo,
      vendorDir,
    ]);
  }

  gitRunner.run([
    ...GIT_SYNC_FLAGS,
    '-C',
    vendorDir,
    'fetch',
    '--depth',
    '1',
    lockData.upstreamRepo,
    lockData.branch,
  ]);
  gitRunner.run([
    ...GIT_SYNC_FLAGS,
    '-C',
    vendorDir,
    'checkout',
    '--detach',
    'FETCH_HEAD',
  ]);

  const syncedCommit = gitRunner.run(['-C', vendorDir, 'rev-parse', 'HEAD']).trim();
  if (!COMMIT_SHA_PATTERN.test(syncedCommit)) {
    throw new Error(`Synced vendor/t3code HEAD is not a valid commit SHA: ${syncedCommit}`);
  }

  const updatedLock: UpstreamLockData = {
    ...lockData,
    commit: syncedCommit,
    syncedAt: new Date().toISOString(),
  };
  writeJsonAtomic(lockPath, updatedLock);

  const checkResult = checkUpstream(
    { root: repoRoot, lockPath, vendorDir },
    gitRunner,
  );
  return { lockData: updatedLock, checkResult };
}

export function getSyncUpstreamUsage(): string {
  return [
    'Usage: node scripts/sync-t3-upstream.ts [--check | --sync] [options]',
    '',
    'Modes:',
    '  --check            Verify UPSTREAM_LOCK.json, read-only status, commit pin & contracts (default)',
    '  --sync             Fetch shallow upstream branch, update UPSTREAM_LOCK.json & verify contracts',
    '',
    'Options:',
    '  --root <dir>       Repository root directory (default: cwd)',
    '  --lock <path>      Path to UPSTREAM_LOCK.json (default: <root>/UPSTREAM_LOCK.json)',
    '  --vendor <dir>     Path to vendor/t3code checkout (default: <root>/vendor/t3code)',
    '  --json             Emit result as JSON',
    '  -h, --help         Show this help message',
  ].join('\n');
}

export function parseSyncUpstreamArgs(argv: readonly string[]): {
  help: boolean;
  json: boolean;
  mode: 'check' | 'sync';
  root: string;
  lockPath?: string;
  vendorDir?: string;
} {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      check: { type: 'boolean', default: false },
      sync: { type: 'boolean', default: false },
      root: { type: 'string' },
      lock: { type: 'string' },
      vendor: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.check && values.sync) {
    throw new Error('Cannot pass both --check and --sync at the same time');
  }

  return {
    help: values.help,
    json: values.json,
    mode: values.sync ? 'sync' : 'check',
    root: resolve(values.root ?? process.cwd()),
    lockPath: values.lock,
    vendorDir: values.vendor,
  };
}

export function runSyncUpstreamCli(
  argv: readonly string[] = process.argv.slice(2),
  io: CliOutput = { log: console.log, error: console.error },
): number {
  try {
    const parsed = parseSyncUpstreamArgs(argv);
    if (parsed.help) {
      io.log(getSyncUpstreamUsage());
      return 0;
    }

    const opts = {
      root: parsed.root,
      lockPath: parsed.lockPath,
      vendorDir: parsed.vendorDir,
    };

    if (parsed.mode === 'sync') {
      const result = syncUpstream(opts);
      if (parsed.json) {
        io.log(JSON.stringify(result, null, 2));
      } else {
        io.log(
          `Synced vendor/t3code to ${result.lockData.commit} (${result.checkResult.checkedPaths.length} contract paths verified).`,
        );
      }
      return 0;
    }

    const checkResult = checkUpstream(opts);
    if (parsed.json) {
      io.log(JSON.stringify(checkResult, null, 2));
    } else {
      io.log(
        `Upstream contract OK at ${checkResult.commit} (${checkResult.checkedPaths.length} paths verified, read-only intact).`,
      );
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.error(`sync-t3-upstream failed: ${message}`);
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
  process.exitCode = runSyncUpstreamCli(process.argv.slice(2));
}
