import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import {
  parseRenameBrandArgs,
  renameBrand,
  runRenameBrandCli,
} from '../rename-brand.ts';
import {
  extractTarEntries,
  formatPluginArchiveFilename,
  packPlugin,
  parsePackPluginArgs,
  runPackPluginCli,
  splitUstarPath,
} from '../pack-plugin.ts';
import {
  GIT_SYNC_FLAGS,
  checkUpstream,
  parseSyncUpstreamArgs,
  runSyncUpstreamCli,
  syncUpstream,
  validateLockData,
  validateUpstreamContract,
  type GitRunner,
  type UpstreamLockData,
} from '../sync-t3-upstream.ts';
import {
  OFFICIAL_PLUGIN_IDS,
  RELEASE_CATALOG_FILENAME,
  assertStageContainsNoOfficialPlugins,
  formatPluginsSumsFilename,
  formatSoftwareSumsFilename,
  toWindowsProductVersion,
} from '../build-release-packages.ts';
import {
  buildNpmPluginPackages,
  formatNpmPluginPackageName,
} from '../build-npm-plugin-packages.ts';
import {
  buildReleaseNotesTemplate,
  collectReleaseArtifactFiles,
  extractGiteeTokenFromCredentialsText,
  formatReleaseTitle,
  normalizeReleaseTag,
} from '../publish-gitee-release.ts';
import {
  buildPrismuxDesktop,
  parseBuildDesktopArgs,
  resolveSqliteVecLibraryFilename,
  resolveSqliteVecPackageName,
  sanitizeDesktopBuildEnv,
  stageSqliteVecBinaryForDesktop,
  type DesktopCommandInvocation,
} from '../build-prismux-desktop.ts';
import { runReleaseAll } from '../release-all.ts';

const createdTempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdTempDirs.push(dir);
  return dir;
}

function writeTextFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function writeBinaryFile(filePath: string, bytes: Buffer): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, bytes);
}

after(() => {
  for (const dir of createdTempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('rename-brand', () => {
  it('replaces brand identifiers in longest-prefix-first single pass without corrupting overlaps', () => {
    const root = createTempDir('prismux-rename-');

    writeTextFile(
      join(root, 'package.json'),
      JSON.stringify(
        {
          name: 'prismux-monorepo',
          workspaces: ['@prismux/protocol', 'prismux-plugin-qq'],
          title: 'Prismux Workbench',
        },
        null,
        2,
      ),
    );
    writeTextFile(
      join(root, 'apps/daemon/src/index.ts'),
      [
        "import { BRAND } from '@prismux/protocol';",
        "export const APP = 'Prismux';",
        "export const HOME = '~/.prismux';",
        "export const PLUGIN = 'prismux-plugin-pet';",
      ].join('\n'),
    );

    // Rename into tokens that contain the original slug/name to verify single-pass safety
    const report = renameBrand({
      root,
      appName: 'MyPrismux',
      appSlug: 'myprismux',
      npmScope: '@myprismux',
      pluginPrefix: 'myprismux-ext-',
    });

    assert.equal(report.dryRun, false);
    assert.equal(report.scannedFiles, 2);
    assert.equal(report.changedFiles.length, 2);
    assert.ok(report.totalReplacements >= 7);

    const pkg = readFileSync(join(root, 'package.json'), 'utf8');
    assert.match(pkg, /"name": "myprismux-monorepo"/);
    assert.match(pkg, /"@myprismux\/protocol"/);
    assert.match(pkg, /"myprismux-ext-qq"/);
    assert.match(pkg, /"MyPrismux Workbench"/);
    assert.doesNotMatch(pkg, /mymyprismux/);

    const daemonCode = readFileSync(join(root, 'apps/daemon/src/index.ts'), 'utf8');
    assert.match(daemonCode, /'@myprismux\/protocol'/);
    assert.match(daemonCode, /'MyPrismux'/);
    assert.match(daemonCode, /'~\/\.myprismux'/);
    assert.match(daemonCode, /'myprismux-ext-pet'/);
    assert.doesNotMatch(daemonCode, /mymyprismux/);
  });

  it('strictly skips .git, vendor, node_modules, dist, .work, target and binary files', () => {
    const root = createTempDir('prismux-rename-skip-');

    writeTextFile(join(root, 'README.md'), '# Prismux\n');
    writeTextFile(join(root, '.git/config'), 'url = https://example.com/Prismux.git\n');
    writeTextFile(join(root, 'vendor/t3code/README.md'), 'Prismux should never touch vendor\n');
    writeTextFile(join(root, 'node_modules/pkg/index.js'), 'const a = "prismux";\n');
    writeTextFile(join(root, 'dist/index.js'), 'const b = "prismux";\n');
    writeTextFile(join(root, '.work/scratch.txt'), 'Prismux scratch\n');
    writeTextFile(join(root, 'apps/desktop-tauri/target/debug/out.txt'), 'Prismux target\n');

    // Binary/media extensions (even with ASCII payload) and NUL-byte binary file
    writeTextFile(join(root, 'assets/logo.png'), 'Prismux png payload');
    writeTextFile(join(root, 'assets/icon.ico'), 'Prismux ico payload');
    writeTextFile(join(root, 'assets/pkg.wb-plugin'), 'Prismux archive');
    writeTextFile(join(root, 'assets/data.sqlite'), 'Prismux db');
    writeTextFile(join(root, 'assets/font.woff2'), 'Prismux font');
    writeBinaryFile(
      join(root, 'assets/unknown.dat'),
      Buffer.concat([Buffer.from('Prismux'), Buffer.from([0x00, 0x01, 0x02])]),
    );

    const report = renameBrand({
      root,
      appName: 'Aurora',
      appSlug: 'aurora',
      npmScope: '@aurora',
      pluginPrefix: 'aurora-plugin-',
    });

    assert.equal(report.changedFiles.length, 1);
    assert.equal(report.changedFiles[0]?.path, 'README.md');
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '# Aurora\n');

    assert.match(readFileSync(join(root, '.git/config'), 'utf8'), /Prismux/);
    assert.match(readFileSync(join(root, 'vendor/t3code/README.md'), 'utf8'), /Prismux/);
    assert.match(readFileSync(join(root, 'node_modules/pkg/index.js'), 'utf8'), /prismux/);
    assert.match(readFileSync(join(root, 'dist/index.js'), 'utf8'), /prismux/);
    assert.match(readFileSync(join(root, '.work/scratch.txt'), 'utf8'), /Prismux/);
    assert.match(
      readFileSync(join(root, 'apps/desktop-tauri/target/debug/out.txt'), 'utf8'),
      /Prismux/,
    );
    assert.equal(readFileSync(join(root, 'assets/logo.png'), 'utf8'), 'Prismux png payload');
    assert.equal(readFileSync(join(root, 'assets/pkg.wb-plugin'), 'utf8'), 'Prismux archive');
    assert.ok(readFileSync(join(root, 'assets/unknown.dat')).includes(0));
  });

  it('does not modify any files on disk in --dry-run mode', () => {
    const root = createTempDir('prismux-rename-dry-');
    const original = 'App: Prismux, Scope: @prismux/core, Prefix: prismux-plugin-ssh\n';
    writeTextFile(join(root, 'config.txt'), original);

    const parsed = parseRenameBrandArgs([
      '--root',
      root,
      '--app-name',
      'Vega',
      '--app-slug',
      'vega',
      '--npm-scope',
      '@vega',
      '--plugin-prefix',
      'vega-plugin-',
      '--dry-run',
    ]);

    assert.equal(parsed.help, false);
    assert.equal(parsed.options.dryRun, true);

    const report = renameBrand(parsed.options);
    assert.equal(report.dryRun, true);
    assert.equal(report.scannedFiles, 1);
    assert.equal(report.changedFiles.length, 1);
    assert.equal(report.totalReplacements, 3);
    assert.equal(readFileSync(join(root, 'config.txt'), 'utf8'), original);

    const exitCode = runRenameBrandCli(['--help'], {
      log: () => {},
      error: () => {},
    });
    assert.equal(exitCode, 0);
  });

  it('protects unchanged longer prefixes when renaming only appSlug', () => {
    const root = createTempDir('prismux-rename-partial-');
    writeTextFile(
      join(root, 'plugin-ref.ts'),
      "export const p = '@prismux/protocol'; export const q = 'prismux-plugin-qq'; export const d = '~/.prismux';\n",
    );

    const report = renameBrand({
      root,
      appSlug: 'nova',
    });

    assert.equal(report.totalReplacements, 1);
    const updated = readFileSync(join(root, 'plugin-ref.ts'), 'utf8');
    assert.equal(
      updated,
      "export const p = '@prismux/protocol'; export const q = 'prismux-plugin-qq'; export const d = '~/.nova';\n",
    );
  });
});

describe('pack-plugin', () => {
  function createMockPlugin(
    baseDir: string,
    overrides?: {
      packageJson?: Record<string, unknown>;
      manifest?: Record<string, unknown>;
      extraFiles?: Record<string, string>;
    },
  ): string {
    const pluginDir = join(baseDir, 'plugin-demo');
    const pkg = overrides?.packageJson ?? {
      name: '@prismux/plugin-demo',
      version: '0.2.0',
      type: 'module',
      engines: {
        prismux: '>=0.1.0 <2.0.0',
      },
    };
    const manifest = overrides?.manifest ?? {
      id: 'demo',
      version: '0.2.0',
      realms: ['daemon', 'ui'],
      permissions: ['network:outbound'],
      modelVisible: false,
      behaviors: { autostart: false },
    };

    writeTextFile(join(pluginDir, 'package.json'), JSON.stringify(pkg, null, 2));
    writeTextFile(join(pluginDir, 'plugin.manifest.json'), JSON.stringify(manifest, null, 2));
    writeTextFile(join(pluginDir, 'dist/index.js'), 'export function apply() {}\n');

    if (overrides?.extraFiles) {
      for (const [rel, content] of Object.entries(overrides.extraFiles)) {
        writeTextFile(join(pluginDir, rel), content);
      }
    }

    return pluginDir;
  }

  it('packs valid plugin into deterministic .wb-plugin + .sha256, verifies gunzip roundtrip and ustar long paths, and updates catalog', () => {
    const workspace = createTempDir('prismux-pack-');
    const longRelPath =
      'assets/very-deep-directory-segment/another-quite-long-nested-folder-name/and-more-subdirectories-to-exceed-hundred-bytes/payload.txt';
    const longContent = 'deterministic-ustar-prefix-split-payload\n';

    const pluginDir = createMockPlugin(workspace, {
      extraFiles: {
        [longRelPath]: longContent,
        'node_modules/ignored/index.js': 'should be skipped',
        '.git/HEAD': 'ref: refs/heads/main\n',
        '.work/temp.log': 'should be skipped',
        'old.wb-plugin': 'should be skipped',
        'old.sha256': 'should be skipped',
        '.DS_Store': 'should be skipped',
      },
    });

    const outDir = join(workspace, 'out');
    const catalogPath = join(workspace, 'official.json');
    writeTextFile(
      catalogPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          plugins: [
            {
              id: 'demo',
              version: '0.1.0',
              packageName: '@prismux/plugin-demo',
              engines: { prismux: '>=0.1.0 <2.0.0' },
              realms: ['daemon', 'ui'],
              permissions: ['network:outbound'],
              modelVisible: false,
              sha256: null,
              status: 'source-only',
            },
            {
              id: 'qq',
              version: '0.1.0',
              sha256: null,
              status: 'source-only',
            },
          ],
        },
        null,
        2,
      ),
    );

    const parsed = parsePackPluginArgs([
      '--plugin',
      pluginDir,
      '--out',
      outDir,
      '--update-catalog',
      catalogPath,
    ]);
    assert.equal(parsed.help, false);

    const result = packPlugin(parsed.options);
    assert.equal(result.id, 'demo');
    assert.equal(result.version, '0.2.0');
    assert.equal(result.fileCount, 4);
    assert.equal(result.catalogUpdated, true);
    assert.ok(existsSync(result.archivePath));
    assert.ok(result.checksumPath !== null);
    assert.ok(existsSync(result.checksumPath));

    const archiveBytes = readFileSync(result.archivePath);
    assert.equal(archiveBytes.length, result.bytes);

    const expectedSha256 = createHash('sha256').update(archiveBytes).digest('hex');
    assert.equal(result.sha256, expectedSha256);
    assert.equal(result.archivePath, join(outDir, 'prismux-plugin-demo-0.2.0.wb-plugin'));
    assert.equal(result.checksumPath, join(outDir, 'prismux-plugin-demo-0.2.0.sha256'));

    const checksumContent = readFileSync(result.checksumPath!, 'utf8');
    assert.equal(checksumContent, `${expectedSha256}  prismux-plugin-demo-0.2.0.wb-plugin\n`);

    assert.equal(
      formatPluginArchiveFilename('qq', '0.1.1-preview.1'),
      'prismux-plugin-qq-0.1.1-preview.1.wb-plugin',
    );
    assert.equal(
      formatPluginArchiveFilename('prismux-plugin-qq', '0.1.1-preview.1'),
      'prismux-plugin-qq-0.1.1-preview.1.wb-plugin',
    );

    // Gunzip roundtrip and parse tar entries
    const extractedTar = gunzipSync(archiveBytes);
    assert.equal(extractedTar.length, result.tarBytes);

    const entries = extractTarEntries(extractedTar);
    assert.deepEqual(
      entries.map((entry) => entry.path),
      ['dist/index.js', longRelPath, 'package.json', 'plugin.manifest.json'].sort(),
    );

    for (const entry of entries) {
      assert.equal(entry.mtime, 0);
      assert.equal(entry.uid, 0);
      assert.equal(entry.gid, 0);
      assert.equal(entry.magic, 'ustar\0');
    }

    const longEntry = entries.find((entry) => entry.path === longRelPath);
    assert.equal(longEntry?.content.toString('utf8'), longContent);

    // Determinism check: second pack yields identical sha256
    const secondOutDir = join(workspace, 'out-2');
    const secondResult = packPlugin({ pluginDir, outDir: secondOutDir });
    assert.equal(secondResult.sha256, result.sha256);
    assert.equal(secondResult.tarBytes, result.tarBytes);

    // Verify catalog update
    const updatedCatalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      plugins: Array<Record<string, unknown>>;
    };
    const demoCatalog = updatedCatalog.plugins.find((item) => item['id'] === 'demo');
    assert.equal(demoCatalog?.['version'], '0.2.0');
    assert.equal(demoCatalog?.['sha256'], expectedSha256);
    assert.equal(demoCatalog?.['bytes'], result.bytes);
    assert.equal(demoCatalog?.['status'], 'verified');

    const qqCatalog = updatedCatalog.plugins.find((item) => item['id'] === 'qq');
    assert.equal(qqCatalog?.['status'], 'source-only');
    assert.equal(qqCatalog?.['sha256'], null);

    const helpCode = runPackPluginCli(['--help'], {
      log: () => {},
      error: () => {},
    });
    assert.equal(helpCode, 0);
  });

  it('rejects missing top-level engines.prismux even when peerDependencies.prismux exists', () => {
    const workspace = createTempDir('prismux-pack-no-engine-');
    const pluginDir = createMockPlugin(workspace, {
      packageJson: {
        name: '@prismux/plugin-demo',
        version: '0.2.0',
        peerDependencies: {
          prismux: '>=0.1.0',
        },
      },
    });
    const outDir = join(workspace, 'out');

    assert.throws(
      () => packPlugin({ pluginDir, outDir }),
      /engines\.prismux/i,
    );
    assert.equal(existsSync(join(outDir, 'demo-0.2.0.wb-plugin')), false);
  });

  it('rejects invalid plugin.manifest.json fields and path traversal risks', () => {
    const workspace = createTempDir('prismux-pack-bad-manifest-');
    const outDir = join(workspace, 'out');

    const missingRealmsDir = createMockPlugin(join(workspace, 'empty-realms'), {
      manifest: {
        id: 'demo',
        version: '0.2.0',
        realms: [],
        permissions: [],
        modelVisible: false,
      },
    });
    assert.throws(() => packPlugin({ pluginDir: missingRealmsDir, outDir }), /realms/i);

    const badModelVisibleDir = createMockPlugin(join(workspace, 'bad-visible'), {
      manifest: {
        id: 'demo',
        version: '0.2.0',
        realms: ['daemon'],
        permissions: [],
        modelVisible: 'false',
      },
    });
    assert.throws(
      () => packPlugin({ pluginDir: badModelVisibleDir, outDir }),
      /modelVisible/i,
    );

    const traversalIdDir = createMockPlugin(join(workspace, 'bad-id'), {
      manifest: {
        id: '../escape',
        version: '0.2.0',
        realms: ['ui'],
        permissions: ['ui:panel'],
        modelVisible: true,
      },
    });
    assert.throws(() => packPlugin({ pluginDir: traversalIdDir, outDir }), /id/i);
  });

  it('validates ustar path splitting boundaries and tar EOF zero-block padding', () => {
    const exact100 = 'a'.repeat(100);
    assert.deepEqual(splitUstarPath(exact100), { name: exact100, prefix: '' });

    const long180 = `${'segment/'.repeat(18)}file-name.ts`;
    const split = splitUstarPath(long180);
    assert.ok(Buffer.byteLength(split.prefix, 'utf8') <= 155);
    assert.ok(Buffer.byteLength(split.name, 'utf8') <= 100);
    assert.equal(`${split.prefix}/${split.name}`, long180);

    assert.throws(() => splitUstarPath('x'.repeat(101)), /ustar/i);
    assert.throws(() => splitUstarPath('bad\\windows\\path.txt'), /POSIX/i);

    const workspace = createTempDir('prismux-pack-trailer-');
    const largePayload = Buffer.alloc(64 * 1024, 0x61);
    const pluginDir = createMockPlugin(workspace, {
      extraFiles: {
        'assets/large.txt': largePayload.toString('utf8'),
      },
    });
    const outDir = join(workspace, 'out');
    const result = packPlugin({ pluginDir, outDir });
    const rawTar = gunzipSync(readFileSync(result.archivePath));
    assert.equal(rawTar.length % 512, 0);
    assert.ok(rawTar.subarray(rawTar.length - 1024).every((byte) => byte === 0));
  });
});

describe('sync-t3-upstream', () => {
  const SAMPLE_COMMIT = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

  function createValidUpstreamFixture(repoRoot: string): UpstreamLockData {
    const vendorDir = join(repoRoot, 'vendor/t3code');
    writeTextFile(
      join(vendorDir, 'apps/server/package.json'),
      JSON.stringify({ name: '@t3code/server', version: '0.1.0' }),
    );
    mkdirSync(join(vendorDir, 'packages/client-runtime'), { recursive: true });
    mkdirSync(join(vendorDir, 'packages/contracts'), { recursive: true });
    writeTextFile(join(vendorDir, 'docs/internals/overview.md'), '# T3 Code Internals\n');

    const lockData: UpstreamLockData = {
      upstreamRepo: 'https://github.com/pingdotgg/t3code.git',
      branch: 'main',
      commit: SAMPLE_COMMIT,
      syncedAt: '2026-11-22T00:00:00.000Z',
      license: 'MIT',
      readOnly: true,
      requiredPaths: [
        'apps/server/package.json',
        'packages/client-runtime',
        'packages/contracts',
        'docs/internals/overview.md',
      ],
    };
    writeTextFile(join(repoRoot, 'UPSTREAM_LOCK.json'), JSON.stringify(lockData, null, 2));
    return lockData;
  }

  it('passes contract validation in clean locked state', () => {
    const repoRoot = createTempDir('prismux-upstream-ok-');
    const lockData = createValidUpstreamFixture(repoRoot);

    const result = validateUpstreamContract(repoRoot, lockData, '', SAMPLE_COMMIT);
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.commit, SAMPLE_COMMIT);
    assert.equal(result.checkedPaths.length, 4);
  });

  it('fails sternly when vendor/t3code has dirty local modifications (git status --porcelain non-empty)', () => {
    const repoRoot = createTempDir('prismux-upstream-dirty-');
    const lockData = createValidUpstreamFixture(repoRoot);

    assert.throws(
      () =>
        validateUpstreamContract(
          repoRoot,
          lockData,
          ' M apps/server/src/main.ts\n?? local-hack.ts\n',
          SAMPLE_COMMIT,
        ),
      /vendor\/t3code.*只读|read-only|红线/i,
    );
  });

  it('fails on commit mismatch, missing requiredPaths, invalid server package.json, or readOnly !== true', () => {
    const repoRoot = createTempDir('prismux-upstream-fail-');
    const lockData = createValidUpstreamFixture(repoRoot);

    assert.throws(
      () =>
        validateUpstreamContract(
          repoRoot,
          lockData,
          '',
          'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        ),
      /commit/i,
    );

    assert.throws(
      () =>
        validateLockData({
          ...lockData,
          readOnly: false,
        }),
      /readOnly/i,
    );

    rmSync(join(repoRoot, 'vendor/t3code/docs/internals/overview.md'));
    assert.throws(
      () => validateUpstreamContract(repoRoot, lockData, '', SAMPLE_COMMIT),
      /docs\/internals\/overview\.md/,
    );

    writeTextFile(join(repoRoot, 'vendor/t3code/docs/internals/overview.md'), '# Restored\n');
    writeTextFile(join(repoRoot, 'vendor/t3code/apps/server/package.json'), '{ invalid json');
    assert.throws(
      () => validateUpstreamContract(repoRoot, lockData, '', SAMPLE_COMMIT),
      /JSON/i,
    );
  });

  it('supports mocked checkUpstream and syncUpstream with required git flags', () => {
    const repoRoot = createTempDir('prismux-upstream-sync-');
    createValidUpstreamFixture(repoRoot);
    // Simulate initialized submodule marker so checkUpstream invokes gitRunner
    writeTextFile(join(repoRoot, 'vendor/t3code/.git'), 'gitdir: ../../.git/modules/vendor/t3code\n');

    const newCommit = '11223344556677889900aabbccddeeff00112233';
    const recordedCalls: string[][] = [];
    let currentHead = SAMPLE_COMMIT;

    const fakeGit: GitRunner = {
      run(args: readonly string[]): string {
        recordedCalls.push([...args]);
        if (args.includes('status') && args.includes('--porcelain')) {
          return '';
        }
        if (args.includes('fetch')) {
          return '';
        }
        if (args.includes('checkout')) {
          currentHead = newCommit;
          return '';
        }
        if (args.includes('rev-parse') && args.includes('HEAD')) {
          return `${currentHead}\n`;
        }
        throw new Error(`Unexpected git args: ${args.join(' ')}`);
      },
    };

    const initialCheck = checkUpstream({ root: repoRoot }, fakeGit);
    assert.equal(initialCheck.ok, true);

    const synced = syncUpstream({ root: repoRoot }, fakeGit);
    assert.equal(synced.lockData.commit, newCommit);
    assert.equal(synced.checkResult.commit, newCommit);

    const fetchCall = recordedCalls.find((call) => call.includes('fetch'));
    assert.ok(fetchCall);
    for (const flag of GIT_SYNC_FLAGS) {
      assert.ok(fetchCall.includes(flag), `Missing expected git sync flag: ${flag}`);
    }
    assert.ok(fetchCall.includes('--depth'));
    assert.ok(fetchCall.includes('1'));

    const persistedLock = JSON.parse(
      readFileSync(join(repoRoot, 'UPSTREAM_LOCK.json'), 'utf8'),
    ) as UpstreamLockData;
    assert.equal(persistedLock.commit, newCommit);

    const parsedArgs = parseSyncUpstreamArgs(['--sync', '--root', repoRoot]);
    assert.equal(parsedArgs.mode, 'sync');
    assert.equal(parsedArgs.root, repoRoot);

    assert.throws(
      () => parseSyncUpstreamArgs(['--check', '--sync']),
      /--check.*--sync/i,
    );

    const dirtyGit: GitRunner = {
      run(args: readonly string[]): string {
        if (args.includes('status') && args.includes('--porcelain')) {
          return ' M apps/server/package.json\n';
        }
        throw new Error(`Should not execute ${args.join(' ')} when dirty`);
      },
    };
    assert.throws(
      () => syncUpstream({ root: repoRoot }, dirtyGit),
      /vendor\/t3code.*红线|dirty/i,
    );

    const helpCode = runSyncUpstreamCli(['--help'], {
      log: () => {},
      error: () => {},
    });
    assert.equal(helpCode, 0);
  });

  it('supports managed-fork mode without vendor/t3code/.git, requires patchManifest, and blocks destructive sync', () => {
    const repoRoot = createTempDir('prismux-upstream-managed-fork-');
    const vendorDir = join(repoRoot, 'vendor/t3code');
    writeTextFile(
      join(vendorDir, 'apps/server/package.json'),
      JSON.stringify({ name: 't3', version: '0.1.11' }),
    );
    writeTextFile(
      join(vendorDir, 'apps/web/package.json'),
      JSON.stringify({ name: '@t3tools/web', version: '0.1.11' }),
    );
    writeTextFile(
      join(vendorDir, 'apps/desktop/package.json'),
      JSON.stringify({ name: '@t3tools/desktop', version: '0.1.11' }),
    );
    mkdirSync(join(vendorDir, 'packages/client-runtime'), { recursive: true });
    mkdirSync(join(vendorDir, 'packages/contracts'), { recursive: true });
    writeTextFile(join(vendorDir, 'docs/internals/overview.md'), '# T3 Code Internals\n');
    writeTextFile(join(repoRoot, 'docs/t3code-patch-manifest.md'), '# Patch Manifest\n');

    const lockData: UpstreamLockData = {
      upstreamRepo: 'https://github.com/pingdotgg/t3code.git',
      repository: 'https://github.com/pingdotgg/t3code.git',
      branch: 'main',
      commit: SAMPLE_COMMIT,
      syncedAt: '2026-11-22T00:00:00.000Z',
      license: 'MIT',
      mode: 'managed-fork',
      readOnly: false,
      patchManifest: 'docs/t3code-patch-manifest.md',
      requiredPaths: [
        'apps/server/package.json',
        'apps/web/package.json',
        'apps/desktop/package.json',
        'packages/client-runtime',
        'packages/contracts',
        'docs/internals/overview.md',
      ],
    };
    writeTextFile(join(repoRoot, 'UPSTREAM_LOCK.json'), JSON.stringify(lockData, null, 2));

    const neverCalledGit: GitRunner = {
      run(): string {
        throw new Error('git must not be called in managed-fork mode');
      },
    };

    const result = checkUpstream({ root: repoRoot }, neverCalledGit);
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'managed-fork');
    assert.equal(result.commit, SAMPLE_COMMIT);
    assert.equal(result.checkedPaths.length, 6);
    assert.equal(result.patchManifest, 'docs/t3code-patch-manifest.md');

    assert.throws(
      () => syncUpstream({ root: repoRoot }, neverCalledGit),
      /managed-fork/i,
    );

    assert.throws(
      () => validateLockData({ ...lockData, readOnly: true }),
      /readOnly/i,
    );

    rmSync(join(repoRoot, 'docs/t3code-patch-manifest.md'));
    assert.throws(
      () => checkUpstream({ root: repoRoot }, neverCalledGit),
      /patchManifest/i,
    );
  });
});

describe('release-and-npm-packages', () => {
  it('converts SemVer prerelease versions to 4-part Windows VIProductVersion and blocks plugins in release stage', () => {
    assert.equal(toWindowsProductVersion('0.0.1-alpha.1'), '0.0.1.1');
    assert.equal(toWindowsProductVersion('0.1.0'), '0.1.0.0');
    assert.equal(toWindowsProductVersion('1.2.3-beta.12'), '1.2.3.12');

    const cleanStage = createTempDir('prismux-clean-stage-');
    writeTextFile(join(cleanStage, 'Prismux.exe'), 'stub');
    writeTextFile(join(cleanStage, 'workbench-ui', 'index.html'), '<html></html>');
    assert.doesNotThrow(() => assertStageContainsNoOfficialPlugins(cleanStage));

    const pollutedStage = createTempDir('prismux-polluted-stage-');
    writeTextFile(join(pollutedStage, 'plugins-official', 'plugin-qq', 'index.js'), '');
    assert.throws(
      () => assertStageContainsNoOfficialPlugins(pollutedStage),
      /must NOT include official plugins/i,
    );
  });

  it('builds scriptless unscoped and @fish-under-sea scoped npm plugin packages with working SHA-256 verified installer bin', () => {
    assert.equal(formatNpmPluginPackageName('qq'), 'prismux-plugin-qq');
    assert.equal(
      formatNpmPluginPackageName('qq', '@fish-under-sea'),
      '@fish-under-sea/prismux-plugin-qq',
    );

    const workspace = createTempDir('prismux-npm-pkgs-');
    const mockRepo = join(workspace, 'repo');
    const releaseDir = join(workspace, 'release');
    const unscopedOut = join(workspace, 'out-unscoped');
    const scopedOut = join(workspace, 'out-scoped');
    const version = '0.0.1-alpha.1';

    writeTextFile(join(mockRepo, 'LICENSE'), 'MIT License\n');
    writeTextFile(join(mockRepo, 'package.json'), JSON.stringify({ version }));

    for (const id of OFFICIAL_PLUGIN_IDS) {
      const pDir = join(mockRepo, 'plugins-official', `plugin-${id}`);
      writeTextFile(
        join(pDir, 'package.json'),
        JSON.stringify({
          name: `@prismux/plugin-${id}`,
          version,
          description: `Mock ${id} plugin`,
          engines: { prismux: '>=0.0.1-0 <2.0.0' },
        }),
      );
      writeTextFile(
        join(pDir, 'plugin.manifest.json'),
        JSON.stringify({
          id,
          version,
          realms: ['daemon'],
          permissions: [],
          modelVisible: false,
        }),
      );
      writeTextFile(join(pDir, 'dist', 'index.js'), `export const id = '${id}';\n`);
      packPlugin({ pluginDir: pDir, outDir: releaseDir });
    }

    const unscopedBuilt = buildNpmPluginPackages({
      repoRoot: mockRepo,
      releaseDir,
      outDir: unscopedOut,
      version,
    });
    assert.equal(unscopedBuilt.length, 2);
    assert.deepEqual(
      unscopedBuilt.map((b) => b.packageName),
      [
        'prismux-plugin-qq',
        'prismux-plugin-fishdock-hook',
      ],
    );

    const scopedBuilt = buildNpmPluginPackages({
      repoRoot: mockRepo,
      releaseDir,
      outDir: scopedOut,
      scope: '@fish-under-sea',
      version,
    });
    assert.equal(scopedBuilt[0]?.packageName, '@fish-under-sea/prismux-plugin-qq');

    const qqPkgJson = JSON.parse(
      readFileSync(join(scopedOut, 'qq', 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(qqPkgJson['scripts'], undefined);
    assert.equal(qqPkgJson['license'], 'MIT');
    assert.deepEqual(qqPkgJson['engines'], {
      prismux: '>=0.0.1-0 <2.0.0',
      node: '>=20.0.0',
    });
    assert.deepEqual(qqPkgJson['bin'], {
      'prismux-plugin-qq': 'bin/install.mjs',
      'prismux-install-qq': 'bin/install.mjs',
    });

    // Execute generated bin/install.mjs --out export mode & verify anti-overwrite protection
    const exportDir = join(workspace, 'plugins-stage');
    const installerBin = join(scopedOut, 'qq', 'bin', 'install.mjs');
    execFileSync(process.execPath, [installerBin, '--out', exportDir], {
      encoding: 'utf8',
    });
    const exportedArchive = join(exportDir, `prismux-plugin-qq-${version}.wb-plugin`);
    const exportedShaFile = join(exportDir, `prismux-plugin-qq-${version}.wb-plugin.sha256`);
    assert.ok(existsSync(exportedArchive));
    assert.ok(existsSync(exportedShaFile));
    assert.equal(
      createHash('sha256').update(readFileSync(exportedArchive)).digest('hex'),
      scopedBuilt[0]?.sha256,
    );
    assert.equal(
      readFileSync(exportedShaFile, 'utf8'),
      `${scopedBuilt[0]?.sha256}  prismux-plugin-qq-${version}.wb-plugin\n`,
    );
    assert.throws(() => {
      execFileSync(process.execPath, [installerBin, '--out', exportDir], {
        encoding: 'utf8',
      });
    }, /already exists/i);
    execFileSync(process.execPath, [installerBin, '--out', exportDir, '--force'], {
      encoding: 'utf8',
    });

    // Execute generated bin/install.mjs into clean temp plugin directory
    const pluginsTarget = join(workspace, 'installed-plugins');
    execFileSync(process.execPath, [installerBin, '--dir', pluginsTarget], {
      encoding: 'utf8',
    });
    assert.ok(existsSync(join(pluginsTarget, 'qq', 'dist', 'index.js')));
    const meta = JSON.parse(
      readFileSync(join(pluginsTarget, 'qq', '.prismux-install.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(meta['distribution'], 'managed');
    assert.equal(meta['sha256'], scopedBuilt[0]?.sha256);

    // Reject overwrite unless --force is supplied
    assert.throws(() => {
      execFileSync(process.execPath, [installerBin, '--dir', pluginsTarget], {
        encoding: 'utf8',
      });
    }, /already exists/i);

    execFileSync(process.execPath, [installerBin, '--dir', pluginsTarget, '--force'], {
      encoding: 'utf8',
    });

    // Tamper archive and verify bin/install.mjs refuses installation
    const archiveFile = join(scopedOut, 'qq', `prismux-plugin-qq-${version}.wb-plugin`);
    const bytes = readFileSync(archiveFile);
    const tamperIdx = Math.floor(bytes.length / 2);
    const prevByte = bytes[tamperIdx];
    assert.ok(prevByte !== undefined);
    bytes[tamperIdx] = prevByte ^ 0xff;
    writeBinaryFile(archiveFile, bytes);
    assert.throws(() => {
      execFileSync(
        process.execPath,
        [installerBin, '--dir', join(workspace, 'tampered-target')],
        { encoding: 'utf8' },
      );
    }, /SHA-256/i);
  });

  it('normalizes release tags and parses gitee credentials cleanly', () => {
    assert.deepEqual(normalizeReleaseTag('0.0.1-alpha.1'), {
      version: '0.0.1-alpha.1',
      tag: 'v0.0.1-alpha.1',
      isPrerelease: true,
    });
    assert.deepEqual(normalizeReleaseTag('v1.2.0'), {
      version: '1.2.0',
      tag: 'v1.2.0',
      isPrerelease: false,
    });

    const credSample = [
      'https://oauth2:gh-placeholder@github.com',
      'https://oauth2:synthetic-gitee-cred-sample@gitee.com',
    ].join('\n');
    assert.equal(
      extractGiteeTokenFromCredentialsText(credSample),
      'synthetic-gitee-cred-sample',
    );
  });

  it('collects consolidated release artifacts without *.sha256 fragments and renders download guide templates', () => {
    const dir = createTempDir('prismux-release-collect-');
    const pluginsDir = join(dir, 'plugins');
    const splitDir = join(dir, '.gitee-split');
    const version = '0.1.1-preview.1';

    writeBinaryFile(join(dir, `Prismux-Setup-${version}-win-x64.exe`), Buffer.alloc(1024, 1));
    writeTextFile(join(dir, `Prismux-Setup-${version}-win-x64.exe.sha256`), 'legacy-fragment');
    writeTextFile(join(dir, `Prismux-${version}-SHA256SUMS.txt`), 'abc  Prismux-Setup.exe\n');
    writeTextFile(join(dir, 'SHA256SUMS.txt'), 'legacy-sums\n');
    writeBinaryFile(join(pluginsDir, `prismux-plugin-qq-${version}.wb-plugin`), Buffer.from('qq'));
    writeTextFile(join(pluginsDir, `prismux-plugin-qq-${version}.sha256`), 'legacy-plugin-sha');
    writeTextFile(join(dir, RELEASE_CATALOG_FILENAME), '{"schemaVersion":1,"plugins":[]}\n');
    writeTextFile(join(dir, formatPluginsSumsFilename(version)), 'def  plugin.wb-plugin\n');
    writeBinaryFile(join(splitDir, `Prismux-Setup-${version}-win-x64.exe.7z.001`), Buffer.from('p1'));
    writeBinaryFile(join(splitDir, `Prismux-Setup-${version}-win-x64.exe.7z.002`), Buffer.from('p2'));
    writeTextFile(join(splitDir, `Prismux-${version}-SHA256SUMS.txt`), 'split-sums\n');

    const ghFiles = collectReleaseArtifactFiles(dir);
    assert.deepEqual(
      ghFiles.map((f) => f.slice(f.lastIndexOf('\\') + 1).slice(f.lastIndexOf('/') + 1)),
      [
        `Prismux-Setup-${version}-win-x64.exe`,
        `Prismux-${version}-SHA256SUMS.txt`,
        `prismux-plugin-qq-${version}.wb-plugin`,
        RELEASE_CATALOG_FILENAME,
        `prismux-plugins-${version}-SHA256SUMS.txt`,
      ],
    );
    const ghSumsFile = ghFiles.find((f) => f.endsWith(`Prismux-${version}-SHA256SUMS.txt`));
    assert.equal(readFileSync(ghSumsFile!, 'utf8'), 'abc  Prismux-Setup.exe\n');

    const giteeFiles = collectReleaseArtifactFiles(dir, {
      maxAssetBytes: 512,
      preferSplitVolumes: true,
    });
    assert.deepEqual(
      giteeFiles.map((f) => f.slice(f.lastIndexOf('\\') + 1).slice(f.lastIndexOf('/') + 1)),
      [
        `Prismux-Setup-${version}-win-x64.exe.7z.001`,
        `Prismux-Setup-${version}-win-x64.exe.7z.002`,
        `Prismux-${version}-SHA256SUMS.txt`,
        `prismux-plugin-qq-${version}.wb-plugin`,
        RELEASE_CATALOG_FILENAME,
        `prismux-plugins-${version}-SHA256SUMS.txt`,
      ],
    );
    const giteeSumsFile = giteeFiles.find((f) => f.endsWith(`Prismux-${version}-SHA256SUMS.txt`));
    assert.equal(readFileSync(giteeSumsFile!, 'utf8'), 'split-sums\n');

    const ghNotes = buildReleaseNotesTemplate({
      platform: 'github',
      version,
      installerFilename: `Prismux-Setup-${version}-win-x64.exe`,
      installerBytes: 218804484,
      installerSha256: 'b9ee'.repeat(16),
      plugins: [
        {
          id: 'qq',
          archiveFilename: `prismux-plugin-qq-${version}.wb-plugin`,
          bytes: 72310,
          sha256: '61cf'.repeat(16),
        },
      ],
    });
    assert.equal(formatReleaseTitle('0.1.1-preview.1'), 'Prismux v0.1.1-Preview.1');
    assert.equal(formatReleaseTitle('0.1.1-alpha.1'), 'Prismux v0.1.1-Preview.1');
    assert.equal(formatReleaseTitle('0.1.1-beta.2'), 'Prismux v0.1.1-Beta.2');
    assert.equal(formatReleaseTitle('0.1.1-rc.3'), 'Prismux v0.1.1-RC.3');
    assert.equal(formatReleaseTitle('0.1.1'), 'Prismux v0.1.1');
    assert.ok(ghNotes.includes('# Prismux v0.1.1-Preview.1'));
    assert.equal(ghNotes.includes('公测版'), false);
    assert.equal(ghNotes.includes('内测版'), false);
    assert.ok(ghNotes.includes('下载指南：我应该下载哪个文件？'));
    assert.ok(ghNotes.includes('macOS'));
    assert.ok(ghNotes.includes('Linux'));
    assert.ok(ghNotes.includes(`https://github.com/Fish-under-sea/Prismux/releases/download/v${version}/Prismux-Setup-${version}-win-x64.exe`));
    assert.ok(ghNotes.includes(`https://github.com/Fish-under-sea/Prismux/releases/download/v${version}/prismux-plugin-qq-${version}.wb-plugin`));
    assert.ok(ghNotes.includes(RELEASE_CATALOG_FILENAME));
    assert.ok(ghNotes.includes(formatPluginsSumsFilename(version)));

    const giteeNotes = buildReleaseNotesTemplate({
      platform: 'gitee',
      version,
      installerFilename: `Prismux-Setup-${version}-win-x64.exe`,
      installerBytes: 218804484,
      installerSha256: 'b9ee'.repeat(16),
      plugins: [],
      splitParts: [
        { name: `Prismux-Setup-${version}-win-x64.exe.7z.001`, bytes: 83886080, sha256: 'a'.repeat(64) },
        { name: `Prismux-Setup-${version}-win-x64.exe.7z.002`, bytes: 83886080, sha256: 'b'.repeat(64) },
      ],
    });
    assert.ok(giteeNotes.includes(`7z x Prismux-Setup-${version}-win-x64.exe.7z.001`));
    assert.ok(giteeNotes.includes(formatSoftwareSumsFilename(version)));
    assert.ok(giteeNotes.includes(`https://gitee.com/Fish-under-sea/Prismux/releases/download/v${version}/Prismux-Setup-${version}-win-x64.exe.7z.001`));
  });
});

describe('build-prismux-desktop and release-all (v0.1.0-alpha.1)', () => {
  it('sanitizes proxy and Electron env vars and parses CLI arguments accurately', () => {
    const cleanEnv = sanitizeDesktopBuildEnv(
      {
        PATH: 'C:\\Windows\\System32',
        HTTP_PROXY: 'http://127.0.0.1:7895',
        HTTPS_PROXY: 'http://127.0.0.1:7895',
        ALL_PROXY: 'socks5://127.0.0.1:7895',
        http_proxy: 'http://127.0.0.1:7895',
        https_proxy: 'http://127.0.0.1:7895',
        all_proxy: 'http://127.0.0.1:7895',
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_NO_ATTACH_CONSOLE: '1',
      },
      { T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR: '1' },
    );

    assert.equal(cleanEnv['HTTP_PROXY'], undefined);
    assert.equal(cleanEnv['HTTPS_PROXY'], undefined);
    assert.equal(cleanEnv['ALL_PROXY'], undefined);
    assert.equal(cleanEnv['http_proxy'], undefined);
    assert.equal(cleanEnv['https_proxy'], undefined);
    assert.equal(cleanEnv['all_proxy'], undefined);
    assert.equal(cleanEnv['ELECTRON_RUN_AS_NODE'], undefined);
    assert.equal(cleanEnv['ELECTRON_NO_ATTACH_CONSOLE'], undefined);
    assert.equal(cleanEnv['NO_PROXY'], '*');
    assert.equal(cleanEnv['T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR'], '1');

    const parsed = parseBuildDesktopArgs([
      '--installer',
      '--skip-rust',
      '--skip-root-build',
      '--version',
      '0.1.0-alpha.1',
      '--out',
      '.work/custom-out',
    ]);
    assert.equal(parsed.help, false);
    assert.equal(parsed.options.installer, true);
    assert.equal(parsed.options.skipRust, true);
    assert.equal(parsed.options.skipRootBuild, true);
    assert.equal(parsed.options.version, '0.1.0-alpha.1');
    assert.equal(parsed.options.outDir, '.work/custom-out');
  });

  it('orchestrates desktop build with mandatory sqlite-vec staging, NSIS archiving, 7z verification, sha256 and --skip-rust', () => {
    const mockRepo = createTempDir('prismux-desktop-build-');
    writeTextFile(
      join(mockRepo, 'package.json'),
      JSON.stringify({ name: 'prismux-monorepo', version: '0.1.0-alpha.1' }),
    );
    mkdirSync(join(mockRepo, 'vendor', 't3code', 'scripts'), { recursive: true });

    const vecLibName = resolveSqliteVecLibraryFilename();
    const vecPkgName = resolveSqliteVecPackageName();
    const mockVecBinary = join(mockRepo, 'node_modules', vecPkgName, vecLibName);
    writeBinaryFile(mockVecBinary, Buffer.alloc(1024, 0x5a));

    const monitorExe = join(
      mockRepo,
      'vendor',
      't3code',
      'native',
      'resource-monitor',
      'target',
      'x86_64-pc-windows-msvc',
      'release',
      process.platform === 'win32' ? 't3-resource-monitor.exe' : 't3-resource-monitor',
    );
    const outDir = join(mockRepo, '.work', 'release-v0.1.0-alpha.1');
    const invocations: DesktopCommandInvocation[] = [];
    const verifiedPaths: string[] = [];

    const result = buildPrismuxDesktop({
      repoRoot: mockRepo,
      installer: true,
      outDir,
      runner: (inv) => {
        invocations.push(inv);
        if (inv.command === 'cargo') {
          writeBinaryFile(monitorExe, Buffer.from('MZ-MONITOR-STUB'));
        }
        if (inv.args.includes('scripts/build-desktop-artifact.ts')) {
          const outIdx = inv.args.indexOf('--output-dir');
          const stageDir = outIdx >= 0 ? inv.args[outIdx + 1]! : '';
          writeBinaryFile(
            join(stageDir, 'Prismux-Setup-0.1.0-alpha.1.exe'),
            Buffer.from('NSIS-INSTALLER-PAYLOAD-V0.1.0-ALPHA.1'),
          );
        }
        return { status: 0, stdout: '', stderr: '' };
      },
      verifySevenZip: (_sevenZipPath, archivePath) => {
        verifiedPaths.push(archivePath);
      },
    });

    assert.deepEqual(result.executedSteps, [
      'root-build',
      'sqlite-vec-stage',
      'rust-build',
      't3-build-desktop',
      'nsis-installer',
    ]);
    assert.ok(result.sqliteVecPath !== null && existsSync(result.sqliteVecPath));
    assert.equal(result.sqliteVecPath.includes('.asar'), false);
    assert.equal(result.sqliteVecBytes, 1024);
    assert.equal(invocations.length, 4);
    assert.ok(invocations[1]!.args.includes('-j'));
    assert.ok(invocations[1]!.args.includes('1'));
    assert.equal(invocations[2]!.command, 'pnpm');
    assert.deepEqual(invocations[2]!.args, ['exec', 'vp', 'run', 'build:desktop']);
    assert.equal(invocations[3]!.env['T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR'], '1');
    assert.equal(invocations[3]!.env['PRISMUX_SQLITE_VEC_PATH'], result.sqliteVecPath);
    assert.ok(invocations[3]!.args.includes('--platform'));
    assert.ok(invocations[3]!.args.includes('win'));
    assert.ok(invocations[3]!.args.includes('nsis'));

    const expectedExe = join(outDir, 'Prismux-Setup-0.1.0-alpha.1.exe');
    const expectedSoftwareSums = join(outDir, formatSoftwareSumsFilename('0.1.0-alpha.1'));
    assert.equal(result.installerExePath, expectedExe);
    assert.equal(result.checksumPath, expectedSoftwareSums);
    assert.ok(existsSync(expectedExe));
    assert.deepEqual(verifiedPaths, [expectedExe]);
    assert.equal(existsSync(`${expectedExe}.sha256`), false);
    assert.ok(existsSync(expectedSoftwareSums));
    assert.ok(
      readFileSync(expectedSoftwareSums, 'utf8').includes(
        `${result.installerSha256}  Prismux-Setup-0.1.0-alpha.1.exe`,
      ),
    );

    // Verify --skip-rust reuses existing monitor binary cleanly without calling cargo
    const skipInvocations: DesktopCommandInvocation[] = [];
    const skipResult = buildPrismuxDesktop({
      repoRoot: mockRepo,
      skipRust: true,
      skipRootBuild: true,
      installer: false,
      runner: (inv) => {
        skipInvocations.push(inv);
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.deepEqual(skipResult.executedSteps, [
      'sqlite-vec-stage',
      'rust-skipped',
      't3-build-desktop',
    ]);
    assert.equal(skipInvocations.some((i) => i.command === 'cargo'), false);

    rmSync(monitorExe, { force: true });
    assert.throws(
      () =>
        buildPrismuxDesktop({
          repoRoot: mockRepo,
          skipRust: true,
          skipRootBuild: true,
          runner: () => ({ status: 0, stdout: '', stderr: '' }),
        }),
      /missing/i,
    );
  });

  it('rejects missing, empty, or .asar-targeted sqlite-vec native binary during desktop staging', () => {
    const emptyRepo = createTempDir('prismux-vec-missing-');
    writeTextFile(
      join(emptyRepo, 'package.json'),
      JSON.stringify({ name: 'prismux-monorepo', version: '0.1.2-preview.2' }),
    );
    mkdirSync(join(emptyRepo, 'vendor', 't3code', 'scripts'), { recursive: true });

    assert.throws(
      () =>
        stageSqliteVecBinaryForDesktop({
          repoRoot: emptyRepo,
          env: {},
        }),
      /Missing native sqlite-vec library/i,
    );

    const vecLibName = resolveSqliteVecLibraryFilename();
    const vecPkgName = resolveSqliteVecPackageName();
    const zeroByteDll = join(emptyRepo, 'node_modules', vecPkgName, vecLibName);
    writeBinaryFile(zeroByteDll, Buffer.alloc(0));
    assert.throws(
      () =>
        stageSqliteVecBinaryForDesktop({
          repoRoot: emptyRepo,
          env: {},
        }),
      /empty \(0 bytes\)/i,
    );

    writeBinaryFile(zeroByteDll, Buffer.alloc(512, 0x42));
    assert.throws(
      () =>
        stageSqliteVecBinaryForDesktop({
          repoRoot: emptyRepo,
          targetPath: join(emptyRepo, 'resources', 'app.asar', 'native', vecLibName),
          env: {},
        }),
      /outside \.asar/i,
    );
  });

  it('runs release-all for v0.1.0-alpha.1 packing official plugins, updating catalog engines, and generating npm packages', () => {
    const workspace = createTempDir('prismux-release-all-');
    const mockRepo = join(workspace, 'repo');
    const outDir = join(workspace, 'release-v0.1.0-alpha.1');
    const version = '0.1.0-alpha.1';
    const engineRange = '>=0.1.0-0 <2.0.0 || >=0.0.1-0 <0.1.0';

    writeTextFile(join(mockRepo, 'LICENSE'), 'MIT License\n');
    writeTextFile(join(mockRepo, 'package.json'), JSON.stringify({ version }));

    const catalogEntries = [];
    for (const id of OFFICIAL_PLUGIN_IDS) {
      const pDir = join(mockRepo, 'plugins-official', `plugin-${id}`);
      writeTextFile(
        join(pDir, 'package.json'),
        JSON.stringify({
          name: `@prismux/plugin-${id}`,
          version,
          description: `Mock ${id} v0.1`,
          engines: { prismux: engineRange },
        }),
      );
      writeTextFile(
        join(pDir, 'plugin.manifest.json'),
        JSON.stringify({
          id,
          version,
          realms: ['daemon'],
          permissions: [],
          modelVisible: false,
        }),
      );
      writeTextFile(join(pDir, 'dist', 'index.js'), `export const id = '${id}';\n`);
      catalogEntries.push({
        id,
        packageName: `@prismux/plugin-${id}`,
        version: '0.0.1-alpha.1',
        engines: { prismux: '>=0.0.1-0 <2.0.0' },
        realms: ['daemon'],
        permissions: [],
        modelVisible: false,
        sha256: null,
        status: 'source-only',
      });
    }

    const catalogPath = join(mockRepo, 'plugins-official', 'catalog', 'official.json');
    writeTextFile(
      catalogPath,
      JSON.stringify({ schemaVersion: 1, plugins: catalogEntries }, null, 2),
    );

    const releaseRes = runReleaseAll({
      repoRoot: mockRepo,
      outDir,
      version,
      skipDesktop: true,
    });

    assert.equal(releaseRes.version, version);
    assert.equal(releaseRes.plugins.length, 2);
    assert.equal(releaseRes.unscopedNpmPackages.length, 2);
    assert.equal(releaseRes.scopedNpmPackages.length, 2);
    assert.ok(existsSync(join(outDir, 'plugins', `prismux-plugin-qq-${version}.wb-plugin`)));
    assert.equal(existsSync(join(outDir, 'plugins', `prismux-plugin-qq-${version}.sha256`)), false);
    assert.ok(existsSync(join(outDir, RELEASE_CATALOG_FILENAME)));
    assert.ok(existsSync(releaseRes.sumsPath));
    assert.ok(existsSync(releaseRes.pluginsSumsPath));
    assert.equal(
      readFileSync(releaseRes.pluginsSumsPath, 'utf8').includes(RELEASE_CATALOG_FILENAME),
      true,
    );

    const updatedCatalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      plugins: Array<{ id: string; version: string; engines: { prismux: string }; status: string }>;
    };
    for (const item of updatedCatalog.plugins) {
      assert.equal(item.version, version);
      assert.equal(item.engines.prismux, engineRange);
      assert.equal(item.status, 'verified');
    }
  });
});


