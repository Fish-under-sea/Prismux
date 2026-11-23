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
import {
  OFFICIAL_PLUGIN_IDS,
  RELEASE_CATALOG_FILENAME,
  formatPluginsSumsFilename,
  formatSoftwareSumsFilename,
  readRepoVersion,
  sha256File,
} from './build-release-packages.ts';
import { formatPluginArchiveFilename } from './pack-plugin.ts';

const OWNER = 'Fish-under-sea';
const REPO = 'Prismux';
const USER_AGENT = 'prismux-gitee-release';
const GITEE_MAX_ASSET_BYTES = 100 * 1024 * 1024;

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

export interface CollectReleaseArtifactOptions {
  splitDir?: string;
  pluginsDir?: string;
  maxAssetBytes?: number;
  preferSplitVolumes?: boolean;
}

export interface ReleaseNotesPluginInfo {
  id: string;
  archiveFilename: string;
  bytes: number;
  sha256: string;
  description?: string;
}

export interface ReleaseNotesSplitPart {
  name: string;
  bytes: number;
  sha256: string;
}

export interface ReleaseNotesTemplateInput {
  platform: 'github' | 'gitee';
  version: string;
  installerFilename: string;
  installerBytes: number;
  installerSha256: string;
  plugins: readonly ReleaseNotesPluginInfo[];
  splitParts?: readonly ReleaseNotesSplitPart[];
  highlightsMarkdown?: string;
  owner?: string;
  repo?: string;
}

const OFFICIAL_PLUGIN_SUMMARY_ZH: Record<string, string> = {
  qq: 'OneBot v11 私聊主秘书调度 + 群聊物理隔离陪聊',
  pet: '带租约锁与分阶段交还的桌面宠物桥接联动',
  'fishdock-hook': 'FISH-Dock 灵动岛审批卡片、重要邮件与夜间工场回执',
  ssh: '按需远程运维（隔离主机池、Web PTY 终端与 SFTP 文件浏览）',
};

export function collectReleaseArtifactFiles(
  releaseDir: string,
  options: CollectReleaseArtifactOptions = {},
): string[] {
  const filesByName = new Map<string, string>();
  const addFile = (full: string): void => {
    if (!existsSync(full) || !statSync(full).isFile()) {
      return;
    }
    filesByName.set(basename(full), full);
  };

  for (const name of readdirSync(releaseDir)) {
    addFile(join(releaseDir, name));
  }

  const pluginsDir = options.pluginsDir ?? join(releaseDir, 'plugins');
  if (existsSync(pluginsDir) && statSync(pluginsDir).isDirectory()) {
    for (const name of readdirSync(pluginsDir)) {
      if (name.endsWith('.wb-plugin')) {
        addFile(join(pluginsDir, name));
      }
    }
  }

  const splitDir = options.splitDir ?? join(releaseDir, '.gitee-split');
  const splitFiles: string[] = [];
  const splitSumsFiles: string[] = [];
  if (existsSync(splitDir) && statSync(splitDir).isDirectory()) {
    for (const name of readdirSync(splitDir).sort((a, b) => a.localeCompare(b))) {
      const full = join(splitDir, name);
      if (!statSync(full).isFile()) {
        continue;
      }
      if (/\.7z\.\d{3}$/i.test(name)) {
        splitFiles.push(full);
      } else if (/^Prismux-.*-SHA256SUMS\.txt$/i.test(name)) {
        splitSumsFiles.push(full);
      }
    }
  }

  const maxBytes = options.maxAssetBytes ?? Number.POSITIVE_INFINITY;
  const useSplitVolumes =
    splitFiles.length > 0 &&
    (options.preferSplitVolumes === true ||
      [...filesByName.values()].some(
        (f) => f.toLowerCase().endsWith('.exe') && statSync(f).size > maxBytes,
      ));

  if (useSplitVolumes) {
    for (const sumsFile of splitSumsFiles) {
      filesByName.set(basename(sumsFile), sumsFile);
    }
  }

  const hasConsolidatedSums = [...filesByName.keys()].some((name) =>
    /-SHA256SUMS\.txt$/i.test(name),
  );

  const collected: string[] = [];
  for (const [name, full] of filesByName.entries()) {
    if (name.endsWith('.sha256')) {
      // Never upload fragmented per-file *.sha256 checksums.
      continue;
    }
    if (name === 'SHA256SUMS.txt' && hasConsolidatedSums) {
      continue;
    }
    if (/\.7z\.\d{3}$/i.test(name)) {
      if (useSplitVolumes) {
        collected.push(full);
      }
      continue;
    }
    if (name.endsWith('.exe')) {
      if (!useSplitVolumes && statSync(full).size <= maxBytes) {
        collected.push(full);
      }
      continue;
    }
    if (
      name.endsWith('.zip') ||
      name.endsWith('.wb-plugin') ||
      name === RELEASE_CATALOG_FILENAME ||
      /-SHA256SUMS\.txt$/i.test(name) ||
      name === 'SHA256SUMS.txt'
    ) {
      collected.push(full);
    }
  }

  if (useSplitVolumes) {
    for (const part of splitFiles) {
      if (!filesByName.has(basename(part))) {
        collected.push(part);
      }
    }
  }

  const priority = (filePath: string): number => {
    const name = basename(filePath);
    if (name.endsWith('.exe')) return 0;
    if (/\.7z\.\d{3}$/i.test(name)) return 1;
    if (name.endsWith('.zip')) return 2;
    if (/^prismux-plugins?-.*-SHA256SUMS\.txt$/i.test(name)) return 6;
    if (/^Prismux-.*-SHA256SUMS\.txt$/i.test(name)) return 3;
    if (name.endsWith('.wb-plugin')) return 4;
    if (name === RELEASE_CATALOG_FILENAME) return 5;
    return 7;
  };

  return collected.sort(
    (a, b) => priority(a) - priority(b) || basename(a).localeCompare(basename(b)),
  );
}

export function formatReleaseTitle(rawVersion: string): string {
  const version = rawVersion.trim().replace(/^v/i, '');
  const match = /^(\d+\.\d+\.\d+)(?:-([a-zA-Z]+)\.(\d+))?(?:\+.*)?$/.exec(version);
  if (!match) {
    return `Prismux v${version}`;
  }
  const base = match[1];
  const channel = match[2]?.toLowerCase();
  const num = match[3];
  if ((channel === 'preview' || channel === 'alpha') && num) {
    return `Prismux v${base} Preview ${num}`;
  }
  if (channel === 'beta' && num) {
    return `Prismux v${base} Beta ${num}`;
  }
  if (channel === 'rc' && num) {
    return `Prismux v${base} RC ${num}`;
  }
  return `Prismux v${version}`;
}

/**
 * Generates unified GitHub / Gitee Release notes featuring a categorized
 * "Which file should I download?" guide with direct download hyperlinks,
 * macOS/Linux planned rows, split-volume restore instructions for Gitee,
 * and consolidated SHA-256 verification commands.
 */
export function buildReleaseNotesTemplate(input: ReleaseNotesTemplateInput): string {
  const owner = input.owner ?? OWNER;
  const repo = input.repo ?? REPO;
  const tag = `v${input.version}`;
  const releaseTitle = formatReleaseTitle(input.version);
  const host = input.platform === 'github' ? 'github.com' : 'gitee.com';
  const dlBase = `https://${host}/${owner}/${repo}/releases/download/${tag}`;
  const softwareSums = formatSoftwareSumsFilename(input.version);
  const pluginsSums = formatPluginsSumsFilename(input.version);
  const installerSizeMb = (input.installerBytes / (1024 * 1024)).toFixed(2);

  const windowsRowLink =
    input.platform === 'gitee' && input.splitParts && input.splitParts.length > 0
      ? input.splitParts
          .map((part, idx) => `[分卷 ${idx + 1} (\`${part.name}\`)](${dlBase}/${part.name})`)
          .join(' · ') + ` · [软件校验 (\`${softwareSums}\`)](${dlBase}/${softwareSums})`
      : `[${input.installerFilename}](${dlBase}/${input.installerFilename}) · [软件校验 (\`${softwareSums}\`)](${dlBase}/${softwareSums})`;

  const windowsNotes =
    input.platform === 'gitee' && input.splitParts && input.splitParts.length > 0
      ? `因 Gitee 单文件 100 MB 上限拆分为 ${input.splitParts.length} 卷（共 ${installerSizeMb} MB），下载后在同一目录执行 \`7z x ${input.splitParts[0]!.name}\` 无损还原；原包 SHA-256：\`${input.installerSha256}\``
      : `${installerSizeMb} MB（${input.installerBytes} bytes）· SHA-256：\`${input.installerSha256}\`（支持 \`/D=<路径>\` 与便携 \`data/\` 模式）`;

  const pluginRows = OFFICIAL_PLUGIN_IDS.map((id) => {
    const info = input.plugins.find((p) => p.id === id);
    const archiveName =
      info?.archiveFilename ?? formatPluginArchiveFilename(id, input.version);
    const sha = info?.sha256 ?? '见插件校验文件';
    const bytesText = info ? `${info.bytes} bytes` : '按需下载';
    const desc =
      info?.description ?? OFFICIAL_PLUGIN_SUMMARY_ZH[id] ?? '官方可选扩展插件';
    return `| \`${id}\` | [${archiveName}](${dlBase}/${archiveName}) (${bytesText}) | \`npx prismux-plugin-${id}@${input.version}\` | ${desc}<br>SHA-256：\`${sha}\` |`;
  });

  const lines: string[] = [
    `# ${releaseTitle}`,
    '',
    `> 标准 SemVer / Tag：\`${tag}\`（\`${input.version}\`）。**官方四大插件（\`qq\` / \`pet\` / \`fishdock-hook\` / \`ssh\`）严格保持默认零预装**：桌面安装包内不包含任何官方插件，需要时可从下方单独下载 \`.wb-plugin\` 或通过内置插件中心 / npm 单包按需安装。`,
    '',
    '## 📦 下载指南：我应该下载哪个文件？',
    '',
    '### 1. 桌面主程序（Desktop App）',
    '',
    '| 平台 / 架构 | 获取方式（直接下载） | 说明 & SHA-256 |',
    '| :--- | :--- | :--- |',
    `| **Windows (x64)** | ${windowsRowLink} | ${windowsNotes} |`,
    '| **macOS (Apple Silicon / Intel)** | 规划中（`.dmg`） | 暂未发布，后续版本提供签名版 `.dmg` 安装包 |',
    '| **Linux (x64 / ARM64)** | 规划中（`.AppImage` / `.deb`） | 暂未发布，后续版本提供桌面打包与系统依赖说明 |',
    '',
    '### 2. 官方认证按需插件（Optional Official Plugins · 默认零预装）',
    '',
    `> 统一插件校验清单：[${pluginsSums}](${dlBase}/${pluginsSums}) · 官方索引目录：[${RELEASE_CATALOG_FILENAME}](${dlBase}/${RELEASE_CATALOG_FILENAME})`,
    '',
    '| 插件 ID | 独立归档包（直接下载） | npm / npmmirror 安装命令 | 说明 & SHA-256 |',
    '| :--- | :--- | :--- | :--- |',
    ...pluginRows,
    '',
    '### 3. 完整性校验与还原命令',
    '',
    '```powershell',
  ];

  if (input.platform === 'gitee' && input.splitParts && input.splitParts.length > 0) {
    lines.push(
      '# 1. 将全部分卷下载到同一目录后无损合并还原安装包（只需指定 .001）：',
      `7z x ${input.splitParts[0]!.name}`,
      '',
      `# 2. 校验完整安装包（或对照软件校验文件 ${softwareSums}）：`,
    );
  } else {
    lines.push(
      `# 下载后校验安装包 SHA-256（对照 ${softwareSums}）：`,
    );
  }

  lines.push(
    `(Get-FileHash .\\${input.installerFilename} -Algorithm SHA256).Hash.ToLower()`,
    `# 期望值: ${input.installerSha256}`,
    '```',
  );

  if (input.highlightsMarkdown && input.highlightsMarkdown.trim().length > 0) {
    lines.push('', input.highlightsMarkdown.trim());
  }

  return `${lines.join('\n')}\n`;
}

export async function publishGiteeRelease(options: {
  repoRoot?: string;
  releaseDir: string;
  versionOrTag?: string;
  notesPath?: string;
  forceUpload?: boolean;
  latest?: boolean;
}): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(options.repoRoot ?? resolve(here, '..'));
  const releaseDir = resolve(options.releaseDir);
  const { version, tag, isPrerelease } = normalizeReleaseTag(
    options.versionOrTag ?? readRepoVersion(repoRoot),
  );
  const markPrerelease = options.latest === true ? false : isPrerelease;
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
      name: formatReleaseTitle(version),
      body: releaseBody,
      prerelease: markPrerelease ? 'true' : 'false',
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

  // 4. Upload assets (automatically using split volumes if .exe exceeds 100 MB limit)
  const attachListRes = await requestHttps(`${apiBase}/releases/${releaseId}/attach_files`, {
    headers: authHeaders,
  });
  const existingFiles = new Map<string, string>();
  for (const item of parseJsonArraySafe(attachListRes.body)) {
    if (typeof item['name'] === 'string' && item['id'] !== undefined) {
      existingFiles.set(item['name'], String(item['id']));
    }
  }

  const artifacts = collectReleaseArtifactFiles(releaseDir, {
    maxAssetBytes: GITEE_MAX_ASSET_BYTES,
    preferSplitVolumes: true,
  });
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

  // 5. Anonymous download-back verification for consolidated checksums, catalog & small plugins
  const verifyFiles = artifacts.filter((p) => {
    const n = basename(p);
    return (
      /-SHA256SUMS\.txt$/i.test(n) ||
      n === RELEASE_CATALOG_FILENAME ||
      n.endsWith('.wb-plugin')
    );
  });
  for (const filePath of verifyFiles) {
    const leaf = basename(filePath);
    const expectedSha = sha256File(filePath);
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
    console.log(`Verified Gitee anonymous download for ${leaf}: ${downloadedSha}`);
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
      latest: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (values.help || !values.dir) {
    console.log(
      'Usage: node scripts/publish-gitee-release.ts --dir <release-dir> [--tag v0.1.1-preview.1] [--notes <md-path>] [--force] [--latest]',
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
    latest: values.latest,
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
