import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets/readme');
const headerTemplate = path.join(assets, 'header.html');
const sectionTemplate = path.join(assets, 'section.html');

function parseVersionArg() {
  const idx = process.argv.indexOf('--version');
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!pkg.version || typeof pkg.version !== 'string') {
    throw new Error('无法从仓库根 package.json 读取版本号');
  }
  return pkg.version;
}

const releaseVersion = parseVersionArg();
const SECTIONS = [
  { id: 'intro', tab: 'INTRO', zh: '简介', en: 'Overview' },
  { id: 'preview', tab: 'PREVIEW', zh: '界面实景', en: 'Visual Preview' },
  { id: 'features', tab: 'FEATURES', zh: '核心能力', en: 'Core Capabilities' },
  { id: 'plugins', tab: 'PLUGINS', zh: '官方独立插件', en: 'Optional Plugins' },
  { id: 'install', tab: 'INSTALL', zh: '下载与双源更新', en: 'Download & Updates' },
  { id: 'packages', tab: 'PACKAGES', zh: 'npm 与国内镜像', en: 'npm & Mirrors' },
  { id: 'develop', tab: 'DEVELOP', zh: '开发与验收', en: 'Development & QA' },
  { id: 'thanks', tab: 'THANKS', zh: '致谢与边界', en: 'Credits & License' }
];

const edgeCandidates = [
  process.env.EDGE_BINARY,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean);
const edge = edgeCandidates.find(candidate => fs.existsSync(candidate));
if (!edge) {
  throw new Error('找不到 Microsoft Edge，请通过 EDGE_BINARY 指定 msedge.exe 路径');
}

const logoPath = path.join(assets, 'logo.png');
if (!fs.existsSync(logoPath)) {
  throw new Error(`找不到吉祥物图片：${logoPath}`);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'prismux-readme-'));
const browser = spawn(
  edge,
  [
    '--headless=new',
    '--disable-gpu',
    '--disable-gpu-sandbox',
    '--disable-features=CalculateNativeWinOcclusion',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank'
  ],
  { stdio: 'ignore' }
);

const pause = () => new Promise(resolve => setTimeout(resolve, 80));
async function until(check) {
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    if (browser.exitCode !== null) {
      throw new Error(`Edge exited ${browser.exitCode}`);
    }
    await pause();
  }
  throw new Error('Edge CDP 就绪超时');
}

let ws;
let serial = 0;
const pending = new Map();
const errors = [];
const results = [];

try {
  const port = await until(() => {
    try {
      return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
    } catch {
      return null;
    }
  });
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const pageTarget = targets.find(t => t.type === 'page');
  if (!pageTarget) {
    throw new Error('未找到可用的 Edge Page target');
  }
  ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const p = pending.get(data.id);
      pending.delete(data.id);
      data.error ? p.reject(new Error(JSON.stringify(data.error))) : p.resolve(data.result);
    }
    if (data.method === 'Runtime.exceptionThrown') {
      errors.push(data.params.exceptionDetails.text);
    }
  });

  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(JSON.stringify(r.exceptionDetails));
    }
    return r.result.value;
  };

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', {
    width: 2200,
    height: 1300,
    deviceScaleFactor: 1,
    mobile: false
  });
  await call('Emulation.setDefaultBackgroundColorOverride', {
    color: { r: 0, g: 0, b: 0, a: 0 }
  });

  const headerIds = [
    'hero',
    'stat-version',
    'stat-visual',
    'stat-memory',
    'stat-plugins',
    'key-zh',
    'key-en',
    'key-start',
    'key-download',
    'key-release',
    'key-issues'
  ];

  for (const lang of ['zh', 'en']) {
    for (const theme of ['light', 'dark']) {
      const headerUrl =
        pathToFileURL(headerTemplate).href +
        `?lang=${lang}&theme=${theme}&version=${encodeURIComponent(releaseVersion)}`;
      await call('Page.navigate', { url: headerUrl });
      await until(() =>
        evaluate(
          `document.readyState==='complete' && document.documentElement.lang==='${
            lang === 'en' ? 'en' : 'zh-CN'
          }' && document.documentElement.dataset.theme==='${theme}'`
        )
      );
      await evaluate('document.fonts.ready.then(() => true)');

      assert.ok(
        await evaluate('[...document.images].every(i => i.complete && i.naturalWidth > 0)'),
        `header 图片缺失 (${lang}/${theme})`
      );
      assert.ok(
        await evaluate("document.fonts.check('24px Jersey')"),
        `header Jersey 像素字体缺失 (${lang}/${theme})`
      );
      assert.ok(
        await evaluate("document.querySelector('h1').scrollWidth <= document.querySelector('h1').clientWidth"),
        `header 主标题溢出 (${lang}/${theme})`
      );
      assert.ok(
        await evaluate("document.querySelector('#tagline').scrollWidth <= document.querySelector('#tagline').clientWidth"),
        `header 副标语溢出 (${lang}/${theme})`
      );
      assert.ok(
        await evaluate(
          "[...document.querySelectorAll('.pane')].every(p => p.getBoundingClientRect().bottom <= document.querySelector('.window').getBoundingClientRect().bottom - 15)"
        ),
        `header 内容面板越过外框留白 (${lang}/${theme})`
      );
      assert.ok(
        await evaluate(
          "[...document.querySelectorAll('.metric-value')].every(p => { const r = p.getBoundingClientRect(), n = p.querySelector('.number').getBoundingClientRect(), l = p.querySelector('.metric-label').getBoundingClientRect(); return n.right < r.right && l.right < r.right && l.bottom < r.bottom && n.bottom <= l.top + 1; })"
        ),
        `header 仪表盘内容溢出或重叠 (${lang}/${theme})`
      );

      for (const id of headerIds) {
        const clip = await evaluate(
          `(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: Math.max(0, r.x - 4), y: Math.max(0, r.y - 4), width: r.width + 8, height: r.height + 15, scale: 1 }; })()`
        );
        const image = await call('Page.captureScreenshot', {
          format: 'png',
          clip,
          captureBeyondViewport: true
        });
        const file = `${id}-${lang}-${theme}.png`;
        const bytes = Buffer.from(image.data, 'base64');
        fs.writeFileSync(path.join(assets, file), bytes);
        results.push({
          path: `assets/readme/${file}`,
          kind: 'image',
          channel: 'browser-layout-screenshot',
          size: bytes.length,
          width: Math.round(clip.width),
          height: Math.round(clip.height),
          license: '排版 MIT；字体 SIL OFL 1.1；吉祥物素材许可单独保留',
          createdAt: new Date().toISOString(),
          contentHash: crypto.createHash('sha256').update(bytes).digest('hex')
        });
      }
    }
  }

  for (const sec of SECTIONS) {
    for (const lang of ['zh', 'en']) {
      for (const theme of ['light', 'dark']) {
        const titleText = lang === 'en' ? sec.en : sec.zh;
        const secUrl =
          pathToFileURL(sectionTemplate).href +
          `?theme=${theme}&tab=${encodeURIComponent(sec.tab)}&title=${encodeURIComponent(titleText)}`;
        await call('Page.navigate', { url: secUrl });
        await until(() =>
          evaluate(
            `document.readyState==='complete' && document.documentElement.dataset.theme==='${theme}'`
          )
        );
        await evaluate('document.fonts.ready.then(() => true)');
        assert.ok(
          await evaluate("document.fonts.check('24px Jersey')"),
          `section Jersey 像素字体缺失 (${sec.id}/${lang}/${theme})`
        );
        const clip = await evaluate(
          `(() => { const r = document.getElementById('sec').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), scale: 1 }; })()`
        );
        assert.equal(clip.width, 1432, `section 宽度异常 (${sec.id})`);
        assert.equal(clip.height, 83, `section 高度异常 (${sec.id})`);
        assert.ok(
          await evaluate(
            "(() => { const s = document.getElementById('sec').getBoundingClientRect(), t = document.getElementById('title').getBoundingClientRect(), v = document.querySelector('#sec .vent').getBoundingClientRect(); return t.right <= v.left + 1 && v.width >= 80 && t.bottom <= s.bottom; })()"
          ),
          `section 标题或栅格溢出 (${sec.id}/${lang}/${theme})`
        );

        const image = await call('Page.captureScreenshot', {
          format: 'png',
          clip: { ...clip, scale: 1 },
          captureBeyondViewport: true
        });
        const file = `section-${sec.id}-${lang}-${theme}.png`;
        const bytes = Buffer.from(image.data, 'base64');
        fs.writeFileSync(path.join(assets, file), bytes);
        results.push({
          path: `assets/readme/${file}`,
          kind: 'image',
          channel: 'browser-section-banner',
          size: bytes.length,
          width: clip.width,
          height: clip.height,
          license: '排版 MIT；字体 SIL OFL 1.1',
          createdAt: new Date().toISOString(),
          contentHash: crypto.createHash('sha256').update(bytes).digest('hex')
        });
      }
    }
  }

  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(assets, 'header-metadata.json'),
    JSON.stringify(
      {
        format: 'prismux/readme-assets',
        version: releaseVersion,
        renderedWith: 'Microsoft Edge CDP',
        assets: results
      },
      null,
      2
    ) + '\n'
  );
  console.log(
    JSON.stringify({
      version: releaseVersion,
      images: results.length,
      imageLoad: true,
      pixelFont: true,
      titleOverflow: false,
      consoleErrors: 0
    })
  );
  await call('Browser.close');
  await new Promise(resolve => {
    if (browser.exitCode !== null) return resolve();
    const timer = setTimeout(resolve, 2500);
    browser.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
} finally {
  ws?.close();
  if (browser.exitCode === null) {
    browser.kill();
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 1500);
      browser.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 120 });
  } catch {
    // Ignore transient Windows file lock on temporary Edge profile dir
  }
}
