import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import * as https from 'node:https';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readRepoVersion } from './build-release-packages.ts';

const OWNER = 'Fish-under-sea';
const REPO = 'Prismux';
const USER_AGENT = 'prismux-gitee-release';

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export function normalizeReleaseTag(rawVersionOrTag: string): {
  version: string;
  tag: string;
  isPrerelease: boolean;
} {
  const version = rawVersionOrTag.trim().replace(/^v/i, '');
  if (!version) {
    throw new Error('Version/tag cannot be empty.');
  }
  return {
    version,
    tag: `v${version}`,
    isPrerelease: version.includes('-'),
  };
}

export function extractGiteeTokenFromCredentialsText(content: string): string | undefined {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    try {
      const parsed = new URL(line);
      if (
        (parsed.hostname === 'gitee.com' || parsed.hostname.endsWith('.gitee.com')) &&
        parsed.password
      ) {
        return decodeURIComponent(parsed.password);
      }
    } catch {
      // Ignore malformed lines
    }
  }
  return undefined;
}

export function resolveGiteeToken(
  env: NodeJS.ProcessEnv = process.env,
  credentialsPath = join(homedir(), '.git-credentials'),
): string {
  const fromEnv = env['GITEE_TOKEN']?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (existsSync(credentialsPath)) {
    const extracted = extractGiteeTokenFromCredentialsText(
      readFileSync(credentialsPath, 'utf8'),
    );
    if (extracted) {
      return extracted;
    }
  }
  throw new Error(
    'Missing Gitee token: set GITEE_TOKEN or configure a gitee.com entry in ~/.git-credentials.',
  );
}

function requestHttps(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string | number>;
    body?: Buffer;
    timeoutMs?: number;
  } = {},
): Promise<HttpResponse> {
  return new Promise((resolvePromise, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
        timeout: options.timeoutMs ?? 900_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolvePromise({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error(`HTTPS request timed out: ${url}`)));
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function downloadFollowingRedirects(
  url: string,
  headers: Record<string, string>,
  maxHops = 6,
): Promise<HttpResponse> {
  let current = url;
  for (let hop = 0; hop < maxHops; hop += 1) {
    const res = await requestHttps(current, { headers });
    const locationHeader = res.headers['location'];
    const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new Error(`Exceeded redirect limit (${maxHops}) downloading ${url}`);
}

function parseJsonSafe(buffer: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(buffer.toString('utf8')) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function parseJsonArraySafe(buffer: Buffer): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(buffer.toString('utf8')) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
      );
    }
    return [];
  } catch {
    return [];
  }
}

function buildMultipartFormData(
  fieldName: string,
  filePath: string,
): { boundary: string; body: Buffer } {
  const boundary = `----prismux${randomBytes(12).toString('hex')}`;
  const filename = basename(filePath);
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    boundary,
    body: Buffer.concat([head, readFileSync(filePath), tail]),
  };
}

function encodeFormBody(fields: Record<string, string>): Buffer {
  const encoded = Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return Buffer.from(encoded, 'utf8');
}

function pushMainAndTagToGitee(repoRoot: string, tag: string, token: string): void {
  const tempAskPassDir = mkdtempSync(join(tmpdir(), 'prismux-gitee-auth-'));
  try {
    const isWin = process.platform === 'win32';
    const askpassScript = join(tempAskPassDir, isWin ? 'askpass.cmd' : 'askpass.sh');
    if (isWin) {
      writeFileSync(
        askpassScript,
        [
          '@echo off',
          'set "PROMPT=%~1"',
          'echo %PROMPT% | findstr /i "Username" >nul && (echo oauth2 & exit /b 0)',
          'echo %PRISMUX_GITEE_TOKEN%',
        ].join('\r\n'),
        'utf8',
      );
    } else {
      writeFileSync(
        askpassScript,
        [
          '#!/bin/sh',
          'case "$1" in',
          '  *Username*) printf "%s\\n" "oauth2" ;;',
          '  *) printf "%s\\n" "$PRISMUX_GITEE_TOKEN" ;;',
          'esac',
        ].join('\n'),
        { encoding: 'utf8', mode: 0o700 },
      );
    }

    const gitEnv: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: askpassScript,
      PRISMUX_GITEE_TOKEN: token,
    };
    const remoteUrl = `https://gitee.com/${OWNER}/${REPO}.git`;
    const gitFlags = [
      '-c',
      'core.longpaths=true',
      '-c',
      'http.sslBackend=openssl',
      '-c',
      'http.version=HTTP/1.1',
    ];

    execFileSync('git', [...gitFlags, 'push', remoteUrl, 'HEAD:refs/heads/main'], {
      cwd: repoRoot,
      env: gitEnv,
      stdio: 'inherit',
    });

    execFileSync('git', [...gitFlags, 'push', remoteUrl, `refs/tags/${tag}:refs/tags/${tag}`], {
      cwd: repoRoot,
      env: gitEnv,
      stdio: 'inherit',
    });
  } finally {
    rmSync(tempAskPassDir, { recursive: true, force: true });
  }
}

export function collectReleaseArtifactFiles(releaseDir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(releaseDir)) {
    const full = join(releaseDir, name);
    if (!statSync(full).isFile()) {
      continue;
    }
    if (
      name.endsWith('.exe') ||
      name.endsWith('.zip') ||
      name.endsWith('.wb-plugin') ||
      name.endsWith('.sha256') ||
      name === 'SHA256SUMS.txt'
    ) {
      files.push(full);
    }
  }
  const priority = (filePath: string): number => {
    const name = basename(filePath);
    if (name.endsWith('.exe')) return 0;
    if (name.endsWith('.zip')) return 1;
    if (name.endsWith('.wb-plugin')) return 2;
    if (name.endsWith('.sha256')) return 3;
    return 4;
  };
  return files.sort((a, b) => priority(a) - priority(b) || basename(a).localeCompare(basename(b)));
}

export async function publishGiteeRelease(options: {
  repoRoot?: string;
  releaseDir: string;
  versionOrTag?: string;
  notesPath?: string;
  forceUpload?: boolean;
}): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(options.repoRoot ?? resolve(here, '..'));
  const releaseDir = resolve(options.releaseDir);
  const { version, tag, isPrerelease } = normalizeReleaseTag(
    options.versionOrTag ?? readRepoVersion(repoRoot),
  );
  const token = resolveGiteeToken();

  const authHeaders = {
    Authorization: `token ${token}`,
    'User-Agent': USER_AGENT,
  };
  const apiBase = `https://gitee.com/api/v5/repos/${OWNER}/${REPO}`;

  // 1. Check / auto-create public Gitee repo
  const repoCheck = await requestHttps(apiBase, { headers: authHeaders });
  if (repoCheck.status === 404) {
    console.log(`Creating public Gitee repo ${OWNER}/${REPO}...`);
    const createPayload = encodeFormBody({
      name: REPO,
      description: 'Prismux — 极简液态玻璃 AI 超级工作台与 24h 秘书系统',
      private: 'false',
    });
    const created = await requestHttps('https://gitee.com/api/v5/user/repos', {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'Content-Length': createPayload.length,
      },
      body: createPayload,
    });
    if (created.status < 200 || created.status >= 300) {
      throw new Error(`Failed to create Gitee repository: HTTP ${created.status}`);
    }
  } else if (repoCheck.status < 200 || repoCheck.status >= 300) {
    throw new Error(`Failed to check Gitee repository: HTTP ${repoCheck.status}`);
  }

  // 2. Ensure tag exists locally & push main + tag to Gitee
  const headCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();

  const existingTagCheck = execFileSync('git', ['tag', '-l', tag], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  if (!existingTagCheck) {
    execFileSync('git', ['tag', tag, headCommit], { cwd: repoRoot, stdio: 'inherit' });
  }
  pushMainAndTagToGitee(repoRoot, tag, token);

  // 3. Create or reuse Gitee release
  const defaultNotesPath = join(repoRoot, 'docs', 'releases', `${tag}.md`);
  const notesFile = options.notesPath ? resolve(options.notesPath) : defaultNotesPath;
  const releaseBody = existsSync(notesFile)
    ? readFileSync(notesFile, 'utf8')
    : `Prismux ${tag} release`;

  const relRes = await requestHttps(`${apiBase}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: authHeaders,
  });
  let release = relRes.status === 200 ? parseJsonSafe(relRes.body) : null;
  if (!release || !release['id']) {
    const formPayload = encodeFormBody({
      tag_name: tag,
      name: `Prismux ${tag}`,
      body: releaseBody,
      prerelease: isPrerelease ? 'true' : 'false',
      target_commitish: headCommit,
    });
    const createRel = await requestHttps(`${apiBase}/releases`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'Content-Length': formPayload.length,
      },
      body: formPayload,
    });
    release = parseJsonSafe(createRel.body);
    if (createRel.status < 200 || createRel.status >= 300 || !release?.['id']) {
      throw new Error(`Failed to create Gitee release ${tag}: HTTP ${createRel.status}`);
    }
    console.log(`Created Gitee release ${tag} (id=${String(release['id'])})`);
  } else {
    console.log(`Using existing Gitee release ${tag} (id=${String(release['id'])})`);
  }

  const releaseId = String(release['id']);

  // 4. Upload assets
  const attachListRes = await requestHttps(`${apiBase}/releases/${releaseId}/attach_files`, {
    headers: authHeaders,
  });
  const existingFiles = new Map<string, string>();
  for (const item of parseJsonArraySafe(attachListRes.body)) {
    if (typeof item['name'] === 'string' && item['id'] !== undefined) {
      existingFiles.set(item['name'], String(item['id']));
    }
  }

  const artifacts = collectReleaseArtifactFiles(releaseDir);
  if (artifacts.length === 0) {
    throw new Error(`No release artifacts found in ${releaseDir}`);
  }

  for (const filePath of artifacts) {
    const leaf = basename(filePath);
    const existingId = existingFiles.get(leaf);
    if (existingId !== undefined) {
      if (!options.forceUpload) {
        console.log(`Already attached on Gitee: ${leaf}`);
        continue;
      }
      await requestHttps(`${apiBase}/releases/${releaseId}/attach_files/${existingId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
    }

    const { boundary, body } = buildMultipartFormData('file', filePath);
    const sizeMb = (statSync(filePath).size / 1_048_576).toFixed(2);
    console.log(`Uploading ${leaf} (${sizeMb} MB) to Gitee...`);
    const up = await requestHttps(`${apiBase}/releases/${releaseId}/attach_files`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      body,
    });
    if (up.status < 200 || up.status >= 300) {
      throw new Error(`Upload failed for ${leaf}: HTTP ${up.status}`);
    }
    console.log(`Uploaded ${leaf}`);
  }

  // 5. Anonymous download-back verification for primary installer + .sha256
  const verifyTargets = artifacts.filter((p) => {
    const n = basename(p);
    return n.startsWith(`Prismux-Setup-${version}`) && n.endsWith('.exe');
  });
  for (const primaryFile of verifyTargets) {
    const leaf = basename(primaryFile);
    const expectedSha = createHash('sha256').update(readFileSync(primaryFile)).digest('hex');
    const dlUrl = `https://gitee.com/${OWNER}/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(leaf)}`;
    const anonHeaders = { 'User-Agent': USER_AGENT };

    let back: HttpResponse | undefined;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      back = await downloadFollowingRedirects(dlUrl, anonHeaders);
      if (back.status === 200) break;
      if (back.status !== 404) {
        throw new Error(`Anonymous download failed for ${leaf}: HTTP ${back.status}`);
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
    if (!back || back.status !== 200) {
      throw new Error(`Gitee did not serve ${leaf} for anonymous verification`);
    }
    const downloadedSha = createHash('sha256').update(back.body).digest('hex');
    if (downloadedSha !== expectedSha) {
      throw new Error(
        `Gitee downloaded ${leaf} SHA-256 mismatch: expected ${expectedSha}, got ${downloadedSha}`,
      );
    }

    const sumRes = await downloadFollowingRedirects(`${dlUrl}.sha256`, anonHeaders);
    if (sumRes.status !== 200) {
      throw new Error(`Missing ${leaf}.sha256 on Gitee: HTTP ${sumRes.status}`);
    }
    const remoteSum = sumRes.body.toString('utf8').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (remoteSum !== expectedSha) {
      throw new Error(
        `Gitee ${leaf}.sha256 content mismatch: expected ${expectedSha}, got ${remoteSum}`,
      );
    }
    console.log(`Verified Gitee anonymous download + .sha256 for ${leaf}: ${downloadedSha}`);
  }

  console.log(`Gitee release ready: https://gitee.com/${OWNER}/${REPO}/releases/tag/${tag}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      tag: { type: 'string' },
      notes: { type: 'string' },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (values.help || !values.dir) {
    console.log(
      'Usage: node scripts/publish-gitee-release.ts --dir <release-dir> [--tag v0.0.1-alpha.1] [--notes <md-path>] [--force]',
    );
    if (!values.help) {
      process.exitCode = 1;
    }
    return;
  }

  await publishGiteeRelease({
    releaseDir: values.dir,
    versionOrTag: values.tag,
    notesPath: values.notes,
    forceUpload: values.force,
  });
}

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Gitee publish failed: ${msg}`);
    process.exit(1);
  });
}
