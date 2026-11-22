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
  assertStageContainsNoOfficialPlugins,
  toWindowsProductVersion,
} from '../build-release-packages.ts';
import {
  buildNpmPluginPackages,
  formatNpmPluginPackageName,
} from '../build-npm-plugin-packages.ts';
import {
  extractGiteeTokenFromCredentialsText,
  normalizeReleaseTag,
} from '../publish-gitee-release.ts';

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
    assert.ok(existsSync(result.checksumPath));

    const archiveBytes = readFileSync(result.archivePath);
    assert.equal(archiveBytes.length, result.bytes);

    const expectedSha256 = createHash('sha256').update(archiveBytes).digest('hex');
    assert.equal(result.sha256, expectedSha256);

    const checksumContent = readFileSync(result.checksumPath, 'utf8');
    assert.equal(checksumContent, `${expectedSha256}  demo-0.2.0.wb-plugin\n`);

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
    assert.equal(unscopedBuilt.length, 4);
    assert.deepEqual(
      unscopedBuilt.map((b) => b.packageName),
      [
        'prismux-plugin-qq',
        'prismux-plugin-pet',
        'prismux-plugin-fishdock-hook',
        'prismux-plugin-ssh',
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
      'prismux-plugin-qq': './bin/install.mjs',
      'prismux-install-qq': './bin/install.mjs',
    });

    // Execute generated bin/install.mjs --out export mode & verify anti-overwrite protection
    const exportDir = join(workspace, 'plugins-stage');
    const installerBin = join(scopedOut, 'qq', 'bin', 'install.mjs');
    execFileSync(process.execPath, [installerBin, '--out', exportDir], {
      encoding: 'utf8',
    });
    const exportedArchive = join(exportDir, `qq-${version}.wb-plugin`);
    const exportedShaFile = join(exportDir, `qq-${version}.wb-plugin.sha256`);
    assert.ok(existsSync(exportedArchive));
    assert.ok(existsSync(exportedShaFile));
    assert.equal(
      createHash('sha256').update(readFileSync(exportedArchive)).digest('hex'),
      scopedBuilt[0]?.sha256,
    );
    assert.equal(
      readFileSync(exportedShaFile, 'utf8'),
      `${scopedBuilt[0]?.sha256}  qq-${version}.wb-plugin\n`,
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
    const archiveFile = join(scopedOut, 'qq', `qq-${version}.wb-plugin`);
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
});

