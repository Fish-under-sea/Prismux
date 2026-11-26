import * as NodeAssert from "node:assert/strict";
import * as NodeBuffer from "node:buffer";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeVM from "node:vm";
import * as NodeZlib from "node:zlib";

const assert: typeof NodeAssert = NodeAssert;
const { Buffer } = NodeBuffer;
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} = NodeFS;
const { createServer, request: httpRequest } = NodeHttp;
const { createServer: createNetServer } = NodeNet;
type AddressInfo = NodeNet.AddressInfo;
const { tmpdir } = NodeOS;
const { join } = NodePath;
const { after, test } = NodeTest;
const { gzipSync } = NodeZlib;
import { CHIEF_PROVIDER_KINDS, OFFICIAL_PLUGIN_IDS } from "@prismux/protocol";
import { WebSocketServer } from "ws";
import {
  AppearanceConfigStore,
  BUILTIN_WEBWALLGL_WALLPAPERS,
  createDefaultAppearanceConfig,
  getMimeTypeForFile,
  PrismuxDaemon,
  parseWindowsRegistryFontOutput,
  readVideoDimensions,
  SystemFontService
} from "../index.js";
import { WallpaperMediaService } from "../wallpapers/WallpaperMediaService.js";

const tempDirs: string[] = [];
const cleanups: Array<() => Promise<void>> = [];

after(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) {
      await fn();
    }
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createMinimalPngBuffer(width: number, height: number): Buffer {
  // Minimal PNG header + IHDR chunk sufficient for binary dimension parsing
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from("IHDR", "ascii");
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type RGB
  const ihdrCrc = Buffer.alloc(4);
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
  ]);
  return Buffer.concat([sig, ihdrLen, ihdrType, ihdrData, ihdrCrc, iend]);
}

function buildDeterministicTgz(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [rawName, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    const header = Buffer.alloc(512, 0);
    header.write(rawName, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    header.write("00000000000\0", 136, 12, "ascii");
    header.fill(0x20, 148, 156);
    header.write("0", 156, 1, "ascii");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");

    let checksum = 0;
    for (let i = 0; i < 512; i += 1) {
      checksum += header[i]!;
    }
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    blocks.push(header);

    const paddedLen = Math.ceil(data.length / 512) * 512;
    const dataBlock = Buffer.alloc(paddedLen, 0);
    data.copy(dataBlock, 0);
    blocks.push(dataBlock);
  }
  blocks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(blocks));
}

test("Steam 431960 scan, zero built-in scenes, custom import dedup, HTTP 206 streaming, and path-traversal blocking", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "prismux-wp-data-"));
  const steamPrimary = mkdtempSync(join(tmpdir(), "prismux-steam-primary-"));
  const steamSecondary = mkdtempSync(join(tmpdir(), "prismux-steam-secondary-"));
  const extraCustomDir = mkdtempSync(join(tmpdir(), "prismux-wp-extra-"));
  const importSrcDir = mkdtempSync(join(tmpdir(), "prismux-wp-import-"));
  tempDirs.push(dataDir, steamPrimary, steamSecondary, extraCustomDir, importSrcDir);

  // Outside secret file used to verify traversal cannot read outside roots
  const secretOutsidePath = join(steamSecondary, "top-secret.txt");
  writeFileSync(secretOutsidePath, "TOP_SECRET_MUST_NEVER_LEAK", "utf8");

  // Steam primary libraryfolders.vdf pointing to both primary and secondary roots
  mkdirSync(join(steamPrimary, "steamapps"), { recursive: true });
  writeFileSync(
    join(steamPrimary, "steamapps", "libraryfolders.vdf"),
    `"libraryfolders"
{
  "0"
  {
    "path"    "${steamPrimary.replace(/\\/g, "\\\\")}"
  }
  "1"
  {
    "path"    "${steamSecondary.replace(/\\/g, "\\\\")}"
  }
}
`,
    "utf8"
  );

  // Steam 431960 video wallpaper in secondary library
  const videoItemDir = join(
    steamSecondary,
    "steamapps",
    "workshop",
    "content",
    "431960",
    "9001001"
  );
  mkdirSync(videoItemDir, { recursive: true });
  const fakeMp4Bytes = Buffer.from(
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-MP4PAYLOAD",
    "utf8"
  );
  writeFileSync(join(videoItemDir, "loop.mp4"), fakeMp4Bytes);
  writeFileSync(join(videoItemDir, "preview.png"), createMinimalPngBuffer(1920, 1080));
  writeFileSync(
    join(videoItemDir, "project.json"),
    JSON.stringify({
      id: "9001001",
      title: "Neon Rain Stream",
      type: "video",
      file: "loop.mp4",
      preview: "preview.png",
      contentrating: "everyone",
      tags: ["Cyberpunk", "Rain"],
      general: {
        properties: {
          schemecolor: {
            type: "color",
            value: "0.2 0.6 1.0",
            text: "Scheme Color",
            order: 0
          },
          speed: {
            type: "slider",
            value: 1.2,
            min: 0.5,
            max: 2.0,
            step: 0.1,
            text: "Playback Speed",
            order: 1
          }
        }
      }
    }),
    "utf8"
  );

  // Steam 431960 web wallpaper in primary library
  const webItemDir = join(
    steamPrimary,
    "steamapps",
    "workshop",
    "content",
    "431960",
    "9002002"
  );
  mkdirSync(join(webItemDir, "styles"), { recursive: true });
  writeFileSync(
    join(webItemDir, "index.html"),
    "<!doctype html><html><body>WebWall</body></html>",
    "utf8"
  );
  writeFileSync(
    join(webItemDir, "styles", "app.css"),
    "body { background: #101828; }",
    "utf8"
  );
  writeFileSync(join(webItemDir, "thumb.png"), createMinimalPngBuffer(1080, 1920));
  writeFileSync(
    join(webItemDir, "project.json"),
    JSON.stringify({
      title: "Vertical Web Matrix",
      type: "web",
      file: "index.html",
      preview: "thumb.png",
      contentrating: "questionable"
    }),
    "utf8"
  );

  // Hidden item via visibility.json should be excluded
  const hiddenItemDir = join(
    steamPrimary,
    "steamapps",
    "workshop",
    "content",
    "431960",
    "9003003"
  );
  mkdirSync(hiddenItemDir, { recursive: true });
  writeFileSync(
    join(hiddenItemDir, "project.json"),
    JSON.stringify({ id: "9003003", title: "Hidden Item", type: "scene" }),
    "utf8"
  );
  writeFileSync(
    join(hiddenItemDir, "visibility.json"),
    JSON.stringify({ hidden: true }),
    "utf8"
  );

  const authToken = "wp-test-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken,
    steamRootsDiscoverer: async () => [steamPrimary]
  });
  const ready = await daemon.start();
  cleanups.push(async () => {
    await daemon.stop();
  });

  // 1. GET /v1/wallpapers/inventory
  const invRes = await fetch(`${ready.httpUrl}/v1/wallpapers/inventory`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assert.equal(invRes.status, 200);
  const inv = (await invRes.json()) as {
    items: Array<{
      id: string;
      title: string;
      type: string;
      source: string;
      width: number | null;
      height: number | null;
      orientation: string;
      contentRating: string;
      schemeColor?: string;
      userProperties?: Array<{ name: string; ptype: string }>;
      previewUrl: string | null;
      mediaUrl: string | null;
    }>;
  };

  assert.equal(BUILTIN_WEBWALLGL_WALLPAPERS.length, 0);
  assert.equal(
    inv.items.some((x) => x.source === "builtin"),
    false,
    "inventory must contain 0 synthetic built-in scene wallpapers"
  );

  const steamVideo = inv.items.find((x) => x.id === "9001001");
  assert.ok(steamVideo);
  assert.equal(steamVideo.type, "video");
  assert.equal(steamVideo.source, "steam");
  assert.equal(steamVideo.width, 1920);
  assert.equal(steamVideo.height, 1080);
  assert.equal(steamVideo.orientation, "landscape");
  assert.equal(steamVideo.contentRating, "everyone");
  assert.equal(steamVideo.schemeColor, "#3399ff");
  assert.equal(steamVideo.userProperties?.length, 2);

  const steamWeb = inv.items.find((x) => x.id === "9002002");
  assert.ok(steamWeb);
  assert.equal(steamWeb.type, "web");
  assert.equal(steamWeb.orientation, "portrait");
  assert.equal(steamWeb.contentRating, "pg13");
  assert.equal(inv.items.some((x) => x.id === "9003003"), false);

  // 2. HTTP 206 Partial Content streaming + ?token= support + 416 handling
  const mediaFullRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/media/9001001`,
    { headers: { Authorization: `Bearer ${authToken}` } }
  );
  assert.equal(mediaFullRes.status, 200);
  assert.equal(mediaFullRes.headers.get("accept-ranges"), "bytes");
  assert.equal(mediaFullRes.headers.get("content-type"), "video/mp4");
  assert.equal(mediaFullRes.headers.get("cross-origin-resource-policy"), "cross-origin");
  const fullBuf = Buffer.from(await mediaFullRes.arrayBuffer());
  assert.deepEqual(fullBuf, fakeMp4Bytes);

  const mediaRangeRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/media/9001001?token=${encodeURIComponent(authToken)}`,
    { headers: { Range: "bytes=4-19" } }
  );
  assert.equal(mediaRangeRes.status, 206);
  assert.equal(
    mediaRangeRes.headers.get("content-range"),
    `bytes 4-19/${fakeMp4Bytes.byteLength}`
  );
  assert.equal(mediaRangeRes.headers.get("content-length"), "16");
  const sliceBuf = Buffer.from(await mediaRangeRes.arrayBuffer());
  assert.equal(sliceBuf.toString("utf8"), fakeMp4Bytes.subarray(4, 20).toString("utf8"));

  const unsatisfiableRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/media/9001001`,
    { headers: { Authorization: `Bearer ${authToken}`, Range: "bytes=999999-1000010" } }
  );
  assert.equal(unsatisfiableRes.status, 416);

  // Preview image endpoint
  const previewRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/preview/9002002?token=${encodeURIComponent(authToken)}`
  );
  assert.equal(previewRes.status, 200);
  assert.equal(previewRes.headers.get("content-type"), "image/png");

  // Web wallpaper static asset: hard-blocked with 403 ENGINE_DISABLED by default until advancedEngineEnabled is opted in
  const webGatedRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/web/9002002/index.html?token=${encodeURIComponent(authToken)}`
  );
  assert.equal(webGatedRes.status, 403);
  const webGatedBody = (await webGatedRes.json()) as { error?: { code?: string } };
  assert.equal(webGatedBody.error?.code, "ENGINE_DISABLED");

  const enableEngineRes = await fetch(`${ready.httpUrl}/v1/appearance`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ wallpaper: { advancedEngineEnabled: true } })
  });
  assert.equal(enableEngineRes.status, 200);

  // Web wallpaper static asset + scoped subresource cookie auth + path traversal defense
  const webEntryRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/web/9002002/index.html?token=${encodeURIComponent(authToken)}`
  );
  assert.equal(webEntryRes.status, 200);
  const setCookieHeader = webEntryRes.headers.get("set-cookie") ?? "";
  assert.match(setCookieHeader, /prismux_wp_token=/);
  assert.match(setCookieHeader, /Path=\/v1\/wallpapers\/web\//);
  const webCookiePair = setCookieHeader.split(";")[0] ?? "";

  const webCssViaCookie = await fetch(
    `${ready.httpUrl}/v1/wallpapers/web/9002002/styles/app.css`,
    { headers: { Cookie: webCookiePair } }
  );
  assert.equal(webCssViaCookie.status, 200);
  assert.equal(webCssViaCookie.headers.get("content-type"), "text/css; charset=utf-8");
  assert.match(await webCssViaCookie.text(), /#101828/);

  const webCssUnauth = await fetch(
    `${ready.httpUrl}/v1/wallpapers/web/9002002/styles/app.css`
  );
  assert.equal(webCssUnauth.status, 401);

  const webCssRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/web/9002002/styles/app.css`,
    { headers: { Authorization: `Bearer ${authToken}` } }
  );
  assert.equal(webCssRes.status, 200);
  assert.equal(webCssRes.headers.get("content-type"), "text/css; charset=utf-8");
  assert.match(await webCssRes.text(), /#101828/);

  // Raw wire traversal (unnormalized .. and encoded %2e%2e via http.request; fetch() collapses dot segments client-side)
  for (const maliciousPath of [
    `/v1/wallpapers/web/9002002/../../../../../../top-secret.txt`,
    `/v1/wallpapers/web/9002002/%2e%2e/%2e%2e/top-secret.txt`,
    `/v1/wallpapers/media/%2e%2e/secret`
  ]) {
    const blockedStatus = await new Promise<number>((resolveStatus, rejectStatus) => {
      const req = httpRequest(
        {
          host: ready.host,
          port: ready.port,
          method: "GET",
          path: maliciousPath,
          headers: { Authorization: `Bearer ${authToken}` }
        },
        (res) => {
          res.resume();
          resolveStatus(res.statusCode ?? 0);
        }
      );
      req.once("error", rejectStatus);
      req.end();
    });
    assert.equal(blockedStatus, 403, `Expected 403 for ${maliciousPath}`);
  }

  // 3. Custom dir rescan + import (sourcePath & base64 + bad extension rejection)
  const extraImg = createMinimalPngBuffer(2560, 1440);
  writeFileSync(join(extraCustomDir, "aurora-desk.png"), extraImg);
  const rescanRes = await fetch(`${ready.httpUrl}/v1/wallpapers/rescan`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ customDirs: [extraCustomDir] })
  });
  assert.equal(rescanRes.status, 200);
  const rescanned = (await rescanRes.json()) as {
    items: Array<{ title: string; source: string; width: number | null }>;
  };
  const foundCustom = rescanned.items.find(
    (x) => x.source === "custom" && x.title === "aurora-desk"
  );
  assert.ok(foundCustom);
  assert.equal(foundCustom.width, 2560);

  // Import via sourcePath & base64 + SHA-256 duplicate reuse (no -1/-2 copies created)
  const importFile = join(importSrcDir, "imported-photo.png");
  writeFileSync(importFile, createMinimalPngBuffer(1440, 1440));
  const importPathRes = await fetch(`${ready.httpUrl}/v1/wallpapers/import`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ sourcePath: importFile })
  });
  assert.equal(importPathRes.status, 200);
  assert.equal(existsSync(importFile), true); // Source untouched
  const firstImportedPath = (await importPathRes.json()) as {
    item: { id: string; filePath: string };
  };

  // Re-importing the exact same sourcePath reuses the existing file without creating imported-photo-1.png
  const importPathDupRes = await fetch(`${ready.httpUrl}/v1/wallpapers/import`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ sourcePath: importFile })
  });
  assert.equal(importPathDupRes.status, 200);
  const dupImportedPath = (await importPathDupRes.json()) as {
    item: { id: string; filePath: string };
  };
  assert.equal(dupImportedPath.item.id, firstImportedPath.item.id);
  assert.equal(dupImportedPath.item.filePath, firstImportedPath.item.filePath);

  const b64Png = createMinimalPngBuffer(800, 600).toString("base64");
  const importB64Res = await fetch(`${ready.httpUrl}/v1/wallpapers/import`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({
      fileName: "uploaded-canvas.png",
      base64: `data:image/png;base64,${b64Png}`
    })
  });
  assert.equal(importB64Res.status, 200);
  const firstImportedB64 = (await importB64Res.json()) as {
    item: { id: string; filePath: string };
  };
  assert.notEqual(firstImportedB64.item.id, firstImportedPath.item.id);

  // Re-importing the exact same base64 payload (even under another filename) reuses the existing file
  const importB64DupRes = await fetch(`${ready.httpUrl}/v1/wallpapers/import`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({
      fileName: "uploaded-canvas-duplicate.png",
      base64: `data:image/png;base64,${b64Png}`
    })
  });
  assert.equal(importB64DupRes.status, 200);
  const dupImportedB64 = (await importB64DupRes.json()) as {
    item: { id: string; filePath: string };
  };
  assert.equal(dupImportedB64.item.id, firstImportedB64.item.id);
  assert.equal(dupImportedB64.item.filePath, firstImportedB64.item.filePath);

  // Verify no -1 duplicate files were written in ~/.prismux/wallpapers
  const managedFiles = readdirSync(join(dataDir, "wallpapers")).sort();
  assert.deepEqual(managedFiles, ["imported-photo.png", "uploaded-canvas.png"]);

  // Scanning custom directory with pre-existing byte-identical duplicates (-1/-2) keeps ONLY canonical shortest name,
  // while keeping a different image of the exact same byte length
  const dupBytes = createMinimalPngBuffer(1920, 1200);
  const distinctSameSizeBytes = createMinimalPngBuffer(1600, 900);
  assert.equal(dupBytes.byteLength, distinctSameSizeBytes.byteLength);
  writeFileSync(join(extraCustomDir, "media_dup.png"), dupBytes);
  writeFileSync(join(extraCustomDir, "media_dup-1.png"), dupBytes);
  writeFileSync(join(extraCustomDir, "media_dup-2.png"), dupBytes);
  writeFileSync(join(extraCustomDir, "media_distinct.png"), distinctSameSizeBytes);

  const dedupRescanRes = await fetch(`${ready.httpUrl}/v1/wallpapers/rescan`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ customDirs: [extraCustomDir] })
  });
  assert.equal(dedupRescanRes.status, 200);
  const dedupRescanned = (await dedupRescanRes.json()) as {
    items: Array<{ title: string; source: string }>;
  };
  const dupMatches = dedupRescanned.items.filter(
    (x) => x.source === "custom" && x.title.startsWith("media_dup")
  );
  assert.deepEqual(
    dupMatches.map((x) => x.title),
    ["media_dup"],
    "scanCustomDirectory must deduplicate identical files and prefer the canonical non-suffixed filename"
  );
  assert.equal(
    dedupRescanned.items.some((x) => x.source === "custom" && x.title === "media_distinct"),
    true,
    "different files with identical byte length must NOT be falsely deduplicated"
  );
  assert.equal(
    dedupRescanned.items.some((x) => x.source === "builtin"),
    false,
    "rescan must return 0 builtin scene wallpapers"
  );

  // Disallow unsafe extensions on import
  const badExtRes = await fetch(`${ready.httpUrl}/v1/wallpapers/import`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({
      fileName: "payload.exe",
      base64: Buffer.from("MZ").toString("base64")
    })
  });
  assert.equal(badExtRes.status, 400);
});

test("System font discovery parser + TTL cache + HTTP GET /v1/system/fonts", async () => {
  const parsed = parseWindowsRegistryFontOutput(`
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts
    Segoe UI (TrueType)    REG_SZ    segoeui.ttf
    Segoe UI Bold (TrueType)    REG_SZ    segoeuib.ttf
    Microsoft YaHei & Microsoft YaHei UI (TrueType)    REG_SZ    msyh.ttc
    @MS Gothic (TrueType)    REG_SZ    msgothic.ttc
`);
  assert.ok(parsed.includes("Segoe UI"));
  assert.ok(parsed.includes("Microsoft YaHei"));
  assert.ok(parsed.includes("Microsoft YaHei UI"));
  assert.equal(parsed.some((f) => f.startsWith("@")), false);

  let loadCount = 0;
  const mockFontSvc = new SystemFontService({
    cacheTtlMs: 60_000,
    loader: async () => {
      loadCount += 1;
      return {
        fonts: ["JetBrains Mono", "Segoe UI", "jetbrains mono"],
        source: "mock"
      };
    }
  });
  const r1 = await mockFontSvc.listFonts();
  assert.equal(r1.cached, false);
  assert.deepEqual(r1.fonts, ["JetBrains Mono", "Segoe UI"]);
  const r2 = await mockFontSvc.listFonts();
  assert.equal(r2.cached, true);
  assert.equal(loadCount, 1);

  const dataDir = mkdtempSync(join(tmpdir(), "prismux-fonts-data-"));
  tempDirs.push(dataDir);
  const authToken = "font-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken
  });
  const ready = await daemon.start();
  cleanups.push(async () => {
    await daemon.stop();
  });

  const res1 = await fetch(`${ready.httpUrl}/v1/system/fonts`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assert.equal(res1.status, 200);
  const payload1 = (await res1.json()) as {
    ok: boolean;
    fonts: string[];
    count: number;
    cached: boolean;
    durationMs: number;
  };
  assert.equal(payload1.ok, true);
  assert.equal(payload1.cached, false);
  assert.equal(payload1.fonts.length, payload1.count);

  const res2 = await fetch(`${ready.httpUrl}/v1/system/fonts`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assert.equal(res2.status, 200);
  const payload2 = (await res2.json()) as { cached: boolean; fonts: string[] };
  assert.equal(payload2.cached, true);
  assert.deepEqual(payload2.fonts, payload1.fonts);
});

test("Appearance atomic persistence, restart recovery, corrupt JSON fallback, and localhost/Electron CORS", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "prismux-appearance-data-"));
  tempDirs.push(dataDir);
  const authToken = "appearance-token";

  const daemon1 = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken
  });
  const ready1 = await daemon1.start();

  // CORS preflight & origin checks
  const preflightOk = await fetch(`${ready1.httpUrl}/v1/appearance`, {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:3777" }
  });
  assert.equal(preflightOk.status, 204);
  assert.equal(
    preflightOk.headers.get("access-control-allow-origin"),
    "http://localhost:3777"
  );

  const fileOriginRes = await fetch(`${ready1.httpUrl}/health`, {
    headers: { Origin: "file://" }
  });
  assert.equal(fileOriginRes.status, 200);
  assert.equal(fileOriginRes.headers.get("access-control-allow-origin"), "file://");

  const untrustedOriginRes = await fetch(`${ready1.httpUrl}/health`, {
    headers: { Origin: "https://evil.example.com" }
  });
  assert.equal(untrustedOriginRes.headers.get("access-control-allow-origin"), null);

  // PUT /v1/appearance persists celestial mode, glass settings, selection, hidden & rotation lists
  const putRes = await fetch(`${ready1.httpUrl}/v1/appearance`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({
      themeMode: "glass",
      glassBasePolarity: "dark",
      glassPreset: "clear",
      fresnelStrength: 88,
      glassZones: {
        userBubble: { mode: "custom", opacity: 24, blurPx: 18, saturation: 125, tint: "#1a2438" },
        overviewPanel: { mode: "custom", opacity: 38, blurPx: 22, saturation: 118, tint: "#101826" }
      },
      wallpaper: {
        selectedId: "builtin-midnight-tide",
        hiddenIds: ["builtin-cyber-dusk"],
        rotationEnabled: true,
        rotationGroups: [
          {
            id: "night",
            name: "Night Shift",
            wallpaperIds: ["builtin-aurora-prism", "builtin-midnight-tide"],
            intervalMinutes: 10,
            order: "random",
            trigger: "timer"
          }
        ]
      }
    })
  });
  assert.equal(putRes.status, 200);
  await daemon1.stop();

  // Restart daemon and confirm state survives on disk
  const daemon2 = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken
  });
  const ready2 = await daemon2.start();
  const getAfterRestart = await fetch(`${ready2.httpUrl}/v1/appearance`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assert.equal(getAfterRestart.status, 200);
  const loaded = (await getAfterRestart.json()) as {
    themeMode: string;
    glassPreset: string;
    fresnelStrength: number;
    glassZones: {
      userBubble: { mode: string; opacity?: number; blurPx?: number; saturation?: number; tint?: string };
      overviewPanel: { mode: string; opacity?: number; blurPx?: number; saturation?: number; tint?: string };
    };
    wallpaper: {
      selectedId: string;
      hiddenIds: string[];
      rotationEnabled: boolean;
      rotationGroups: Array<{ id: string }>;
    };
  };
  assert.equal(loaded.themeMode, "glass");
  assert.equal(loaded.glassPreset, "clear");
  assert.equal(loaded.fresnelStrength, 88);
  assert.deepEqual(loaded.glassZones.userBubble, {
    mode: "custom",
    opacity: 24,
    blurPx: 18,
    saturation: 125,
    tint: "#1a2438"
  });
  assert.deepEqual(loaded.glassZones.overviewPanel, {
    mode: "custom",
    opacity: 38,
    blurPx: 22,
    saturation: 118,
    tint: "#101826"
  });
  assert.equal(loaded.wallpaper.selectedId, "builtin-midnight-tide");
  assert.deepEqual(loaded.wallpaper.hiddenIds, ["builtin-cyber-dusk"]);
  assert.equal(loaded.wallpaper.rotationEnabled, true);
  assert.equal(loaded.wallpaper.rotationGroups[0]?.id, "night");
  await daemon2.stop();

  // Corrupt appearance.json triggers clean fallback recovery
  writeFileSync(join(dataDir, "appearance.json"), "{not-valid-json", "utf8");
  const daemon3 = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken
  });
  const ready3 = await daemon3.start();
  cleanups.push(async () => {
    await daemon3.stop();
  });

  const recoveredRes = await fetch(`${ready3.httpUrl}/v1/appearance`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assert.equal(recoveredRes.status, 200);
  const recovered = (await recoveredRes.json()) as {
    recoveredFromCorruption: boolean;
    themeMode: string;
    glassPreset: string;
    glassDarkSeparate: boolean;
    glassDarkColor: string;
    accentMode: string;
  };
  assert.equal(recovered.recoveredFromCorruption, true);
  assert.equal(recovered.themeMode, "glass");
  assert.equal(recovered.glassPreset, "clear");
  assert.equal(recovered.glassDarkSeparate, true);
  assert.equal(recovered.glassDarkColor, "#000000");
  assert.equal(recovered.accentMode, "system");
});

test("AppearanceConfigStore aligns v0.2.0-rc.2 defaults, persists all 8 glass zones (including userBubble & overviewPanel), and auto-normalizes legacy opacity/scrim", async () => {
  const freshDefaults = createDefaultAppearanceConfig();
  assert.equal(freshDefaults.themeMode, "glass");
  assert.equal(freshDefaults.glassBasePolarity, "dark");
  assert.equal(freshDefaults.accentMode, "system");
  assert.equal(freshDefaults.glassPreset, "clear");
  assert.deepEqual(freshDefaults.glassRegions, {
    surface: { op: 18, blur: 24 },
    card: { op: 12, blur: 16 },
    overlay: { op: 25, blur: 20 },
    control: { op: 16, blur: 10 }
  });
  assert.equal(freshDefaults.glassColor, "#ffffff");
  assert.equal(freshDefaults.glassDarkSeparate, true);
  assert.equal(freshDefaults.glassDarkColor, "#000000");
  assert.deepEqual(Object.keys(freshDefaults.glassZones).sort(), [
    "composer",
    "mainCanvas",
    "overlays",
    "overviewPanel",
    "rightSidebar",
    "shellFrame",
    "userBubble",
    "workPanels"
  ]);
  assert.equal(freshDefaults.wallpaper.wallpaperOpacity, 0);
  assert.equal(freshDefaults.wallpaper.scrim, 0.4);
  assert.equal(freshDefaults.wallpaper.fpsCap, 60);
  assert.equal(freshDefaults.wallpaper.videoVolume, 0.35);
  assert.equal(freshDefaults.wallpaper.pauseOnBattery, true);
  assert.equal(freshDefaults.wallpaper.rotationGroupId, "default");

  const dataDir = mkdtempSync(join(tmpdir(), "prismux-appearance-norm-"));
  tempDirs.push(dataDir);

  // 1. Fresh store with no existing file emits locked RC.2 defaults
  const freshStore = new AppearanceConfigStore({ dataDir });
  const freshLoaded = freshStore.get();
  assert.equal(freshLoaded.recoveredFromCorruption, false);
  assert.equal(freshLoaded.config.wallpaper.wallpaperOpacity, 0);
  assert.equal(freshLoaded.config.wallpaper.scrim, 0.4);
  assert.deepEqual(freshLoaded.config.glassZones.userBubble, { mode: "inherit" });
  assert.deepEqual(freshLoaded.config.glassZones.overviewPanel, { mode: "inherit" });

  // 1b. All 8 glass zones (including userBubble & overviewPanel) survive save -> disk reload losslessly
  freshStore.update({
    glassZones: {
      shellFrame: { mode: "custom", opacity: 22, blurPx: 20, saturation: 112 },
      rightSidebar: { mode: "solid" },
      mainCanvas: { mode: "custom", opacity: 10, blurPx: 4 },
      workPanels: { mode: "custom", opacity: 64, blurPx: 18 },
      composer: { mode: "custom", opacity: 42, blurPx: 14 },
      overlays: { mode: "custom", opacity: 50, blurPx: 26 },
      userBubble: { mode: "custom", opacity: 19, blurPx: 16, saturation: 130, tint: "#1e293b" },
      overviewPanel: { mode: "solid", tint: "#0f172a" }
    }
  });
  const reloadedZones = new AppearanceConfigStore({ dataDir }).get().config.glassZones;
  assert.deepEqual(reloadedZones.shellFrame, { mode: "custom", opacity: 22, blurPx: 20, saturation: 112 });
  assert.deepEqual(reloadedZones.rightSidebar, { mode: "solid" });
  assert.deepEqual(reloadedZones.mainCanvas, { mode: "custom", opacity: 10, blurPx: 4 });
  assert.deepEqual(reloadedZones.workPanels, { mode: "custom", opacity: 64, blurPx: 18 });
  assert.deepEqual(reloadedZones.composer, { mode: "custom", opacity: 42, blurPx: 14 });
  // overlays enforces 68% readability floor
  assert.deepEqual(reloadedZones.overlays, { mode: "custom", opacity: 68, blurPx: 26 });
  assert.deepEqual(reloadedZones.userBubble, {
    mode: "custom",
    opacity: 19,
    blurPx: 16,
    saturation: 130,
    tint: "#1e293b"
  });
  assert.deepEqual(reloadedZones.overviewPanel, {
    mode: "solid",
    tint: "#0f172a"
  });

  // 2. Legacy 6-zone appearance.json on disk (wallpaperOpacity: 100, scrim: 35) auto-normalizes & fills userBubble/overviewPanel
  const legacyDir = mkdtempSync(join(tmpdir(), "prismux-appearance-legacy-"));
  tempDirs.push(legacyDir);
  writeFileSync(
    join(legacyDir, "appearance.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        glassZones: {
          shellFrame: { mode: "custom", opacity: 30, blurPx: 16 },
          rightSidebar: { mode: "inherit" },
          mainCanvas: { mode: "inherit" },
          workPanels: { mode: "inherit" },
          composer: { mode: "inherit" },
          overlays: { mode: "inherit" }
        },
        wallpaper: {
          selectedId: "builtin-aurora-prism",
          wallpaperOpacity: 100,
          scrim: 35
        }
      },
      null,
      2
    ),
    "utf8"
  );
  const legacyStore = new AppearanceConfigStore({ dataDir: legacyDir });
  const legacyLoaded = legacyStore.get();
  assert.equal(legacyLoaded.recoveredFromCorruption, false);
  assert.equal(legacyLoaded.config.wallpaper.wallpaperOpacity, 0);
  assert.equal(legacyLoaded.config.wallpaper.scrim, 0.35);
  assert.deepEqual(legacyLoaded.config.glassZones.shellFrame, { mode: "custom", opacity: 30, blurPx: 16 });
  assert.deepEqual(legacyLoaded.config.glassZones.userBubble, { mode: "inherit" });
  assert.deepEqual(legacyLoaded.config.glassZones.overviewPanel, { mode: "inherit" });

  // 3. Out-of-range patch (>90 opacity, >1 scrim) is clamped & persisted cleanly without 99% blackout
  const clamped = legacyStore.update({
    wallpaper: {
      wallpaperOpacity: 95,
      scrim: 150
    }
  });
  assert.equal(clamped.wallpaper.wallpaperOpacity, 0);
  assert.equal(clamped.wallpaper.scrim, 0.9);

  const reloaded = new AppearanceConfigStore({ dataDir: legacyDir }).get();
  assert.equal(reloaded.config.wallpaper.wallpaperOpacity, 0);
  assert.equal(reloaded.config.wallpaper.scrim, 0.9);

  // 4. Valid modern values within [0..90] and [0..0.9] are preserved intact
  const modern = legacyStore.update({
    wallpaper: {
      wallpaperOpacity: 25,
      scrim: 0.25
    }
  });
  assert.equal(modern.wallpaper.wallpaperOpacity, 25);
  assert.equal(modern.wallpaper.scrim, 0.25);
});

test("AppearanceConfigStore persists full wallpaper filter, framing, transition, power, layout, and filter-state fields across reload (RC.3)", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "prismux-appearance-wp-full-"));
  tempDirs.push(dataDir);

  const store = new AppearanceConfigStore({ dataDir });
  const initial = store.get().config.wallpaper;
  assert.equal(initial.backgroundBrightness, 100);
  assert.equal(initial.backgroundContrast, 100);
  assert.equal(initial.backgroundSaturate, 100);
  assert.equal(initial.layerPositionX, 50);
  assert.equal(initial.layerPositionY, 50);
  assert.equal(initial.layerScale, 100);
  assert.equal(initial.switchTransition, "fade");
  assert.equal(initial.liveBootDelay, 3);
  assert.equal(initial.sceneAutoQuality, true);
  assert.equal(initial.sceneSoftRenderPause, true);
  assert.equal(initial.startPaused, false);
  assert.equal(initial.audioReactive, true);
  assert.equal(initial.pickerLayout, "fixed");
  assert.deepEqual(initial.contentRatingFilter, ["everyone", "pg13", "mature", "unrated"]);
  assert.deepEqual(initial.typeFilter, ["scene", "web", "video", "image"]);
  assert.equal(initial.orientationFilter, "all");
  assert.equal(initial.customWallpaperDir, "");

  // Save rich wallpaper filter, framing, power, layout & library filter settings
  store.update({
    wallpaper: {
      selectedId: "steam:424242",
      objectFit: "contain",
      flipX: true,
      flipY: true,
      wallpaperBlur: 18,
      wallpaperOpacity: 30,
      scrim: 0.55,
      backgroundBrightness: 85,
      backgroundContrast: 135,
      backgroundSaturate: 165,
      layerPositionX: 72,
      layerPositionY: 28,
      layerScale: 128,
      switchTransition: "cut",
      liveBootDelay: 10,
      sceneAutoQuality: false,
      sceneSoftRenderPause: false,
      startPaused: true,
      audioReactive: false,
      pickerLayout: "classic",
      contentRatingFilter: ["everyone", "pg13"],
      typeFilter: ["video", "image"],
      orientationFilter: "landscape",
      steamRootOverride: "D:\\SteamLibrary",
      customWallpaperDir: "D:\\Wallpapers\\Custom"
    }
  });

  // Reload from disk in a brand-new AppearanceConfigStore instance
  const reloaded = new AppearanceConfigStore({ dataDir }).get().config.wallpaper;
  assert.equal(reloaded.selectedId, "steam:424242");
  assert.equal(reloaded.objectFit, "contain");
  assert.equal(reloaded.flipX, true);
  assert.equal(reloaded.flipY, true);
  assert.equal(reloaded.wallpaperBlur, 18);
  assert.equal(reloaded.wallpaperOpacity, 30);
  assert.equal(reloaded.scrim, 0.55);
  assert.equal(reloaded.backgroundBrightness, 85);
  assert.equal(reloaded.backgroundContrast, 135);
  assert.equal(reloaded.backgroundSaturate, 165);
  assert.equal(reloaded.layerPositionX, 72);
  assert.equal(reloaded.layerPositionY, 28);
  assert.equal(reloaded.layerScale, 128);
  assert.equal(reloaded.switchTransition, "cut");
  assert.equal(reloaded.liveBootDelay, 10);
  assert.equal(reloaded.sceneAutoQuality, false);
  assert.equal(reloaded.sceneSoftRenderPause, false);
  assert.equal(reloaded.startPaused, true);
  assert.equal(reloaded.audioReactive, false);
  assert.equal(reloaded.pickerLayout, "classic");
  assert.deepEqual(reloaded.contentRatingFilter, ["everyone", "pg13"]);
  assert.deepEqual(reloaded.typeFilter, ["video", "image"]);
  assert.equal(reloaded.orientationFilter, "landscape");
  assert.equal(reloaded.steamRootOverride, "D:\\SteamLibrary");
  assert.equal(reloaded.customWallpaperDir, "D:\\Wallpapers\\Custom");

  // Out-of-range filter/framing values are strictly clamped and invalid enums preserve prior valid values
  const clamped = store.update({
    wallpaper: {
      backgroundBrightness: 999,
      backgroundContrast: 5,
      backgroundSaturate: -20,
      layerPositionX: -15,
      layerPositionY: 250,
      layerScale: 500,
      switchTransition: "invalid-mode",
      liveBootDelay: 99,
      pickerLayout: "unknown",
      orientationFilter: "diagonal",
      contentRatingFilter: ["bogus"],
      typeFilter: ["audio-only"]
    }
  }).wallpaper;
  assert.equal(clamped.backgroundBrightness, 160);
  assert.equal(clamped.backgroundContrast, 40);
  assert.equal(clamped.backgroundSaturate, 0);
  assert.equal(clamped.layerPositionX, 0);
  assert.equal(clamped.layerPositionY, 100);
  assert.equal(clamped.layerScale, 150);
  assert.equal(clamped.switchTransition, "cut");
  assert.equal(clamped.liveBootDelay, 10);
  assert.equal(clamped.pickerLayout, "classic");
  assert.equal(clamped.orientationFilter, "landscape");
  assert.deepEqual(clamped.contentRatingFilter, ["everyone", "pg13"]);
  assert.deepEqual(clamped.typeFilter, ["video", "image"]);
});

test("Real business HTTP APIs: chief, memory stats/search with qq_group isolation, secret-free sync config, scriptless plugins, and PUT /v1/updater/policy", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "prismux-business-data-"));
  tempDirs.push(dataDir);

  const ownerToken = "biz-owner-token";
  const qqToken = "biz-qq-group-77777-token";

  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken: ownerToken,
    defaultChiefProvider: "codex"
  });
  daemon.pairingManager.registerScopedToken(
    qqToken,
    "qq_group:77777",
    "qq-plugin-77777"
  );
  const ready = await daemon.start();
  cleanups.push(async () => {
    await daemon.stop();
  });

  // 1. Chief Supervisor GET + POST switch
  const chiefRes = await fetch(`${ready.httpUrl}/v1/chief`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(chiefRes.status, 200);
  const chiefData = (await chiefRes.json()) as {
    slot: { threadId: string; activeProvider: string };
    dialMode: string;
  };
  assert.equal(chiefData.slot.activeProvider, "codex");
  assert.equal(chiefData.dialMode, "agent");

  const targetProvider =
    CHIEF_PROVIDER_KINDS.find((p) => p !== "codex") ?? CHIEF_PROVIDER_KINDS[0]!;
  const switchRes = await fetch(`${ready.httpUrl}/v1/chief/switch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${ownerToken}`
    },
    body: JSON.stringify({
      provider: targetProvider,
      model: "claude-sonnet-4-5",
      dialMode: "oracle",
      reasoningEffort: "xhigh"
    })
  });
  assert.equal(switchRes.status, 200);
  const switched = (await switchRes.json()) as {
    slot: {
      threadId: string;
      activeProvider: string;
      provider?: string;
      model?: string;
      reasoningEffort?: string;
      defaultEffort?: string;
    };
    dialMode: string;
  };
  assert.equal(switched.slot.threadId, chiefData.slot.threadId);
  assert.equal(switched.slot.activeProvider, targetProvider);
  assert.equal(switched.slot.provider, targetProvider);
  assert.equal(switched.slot.model, "claude-sonnet-4-5");
  assert.equal(switched.slot.reasoningEffort, "xhigh");
  assert.equal(switched.slot.defaultEffort, "xhigh");
  assert.equal(switched.dialMode, "oracle");

  const reloadedChiefRes = await fetch(`${ready.httpUrl}/v1/chief`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(reloadedChiefRes.status, 200);
  const reloadedChief = (await reloadedChiefRes.json()) as {
    slot: {
      activeProvider: string;
      provider?: string;
      reasoningEffort?: string;
      defaultEffort?: string;
    };
  };
  assert.equal(reloadedChief.slot.activeProvider, targetProvider);
  assert.equal(reloadedChief.slot.provider, targetProvider);
  assert.equal(reloadedChief.slot.reasoningEffort, "xhigh");
  assert.equal(reloadedChief.slot.defaultEffort, "xhigh");

  const aliasSwitchRes = await fetch(`${ready.httpUrl}/v1/chief/switch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${ownerToken}`
    },
    body: JSON.stringify({
      provider: "gemini-cli",
      defaultEffort: "high"
    })
  });
  assert.equal(aliasSwitchRes.status, 200);
  const aliasSwitched = (await aliasSwitchRes.json()) as {
    slot: { activeProvider: string; reasoningEffort?: string };
  };
  assert.equal(aliasSwitched.slot.activeProvider, "gemini");
  assert.equal(aliasSwitched.slot.reasoningEffort, "high");

  const retiredOmpSwitchRes = await fetch(`${ready.httpUrl}/v1/chief/switch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${ownerToken}`
    },
    body: JSON.stringify({ provider: "oh-my-pi" })
  });
  assert.equal(retiredOmpSwitchRes.status, 400);

  const invalidSwitchRes = await fetch(`${ready.httpUrl}/v1/chief/switch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${ownerToken}`
    },
    body: JSON.stringify({ provider: "invalid-provider-name" })
  });
  assert.equal(invalidSwitchRes.status, 400);

  const invalidEffortRes = await fetch(`${ready.httpUrl}/v1/chief/switch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${ownerToken}`
    },
    body: JSON.stringify({ provider: "codex", reasoningEffort: "bad effort!!" })
  });
  assert.equal(invalidEffortRes.status, 400);

  // 2. Memory stats & search + strict qq_group physical SQL isolation
  for (const item of [
    {
      namespace: "private/chief",
      kind: "fact",
      title: "Chief Private",
      content: "CHIEF_TOKEN_SECRET_ZZ9"
    },
    {
      namespace: "workspace/prismux",
      kind: "fact",
      title: "Workspace Note",
      content: "WORKSPACE_NOTE_YY8"
    },
    {
      namespace: "social/qq-group-77777",
      kind: "member_profile",
      title: "QQ77777 Member",
      content: "Group 77777 talked about QQ_SEVEN_PUBLIC_CHAT"
    },
    {
      namespace: "social/qq-group-88888",
      kind: "episodic",
      title: "QQ88888 Secret",
      content: "OTHER_GROUP_XX7"
    }
  ]) {
    const upRes = await fetch(`${ready.httpUrl}/v1/memory/upsert`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${ownerToken}`
      },
      body: JSON.stringify(item)
    });
    assert.equal(upRes.status, 200);
  }

  const ownerStatsRes = await fetch(`${ready.httpUrl}/v1/memory/stats`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(ownerStatsRes.status, 200);
  const ownerStats = (await ownerStatsRes.json()) as {
    totalEntries: number;
    byNamespace: Record<string, number>;
  };
  assert.equal(ownerStats.totalEntries, 4);
  assert.equal(ownerStats.byNamespace["private/chief"], 1);

  const qqStatsRes = await fetch(`${ready.httpUrl}/v1/memory/stats`, {
    headers: { Authorization: `Bearer ${qqToken}` }
  });
  assert.equal(qqStatsRes.status, 200);
  const qqStats = (await qqStatsRes.json()) as {
    callerScope: string;
    totalEntries: number;
    byNamespace: Record<string, number>;
  };
  assert.equal(qqStats.callerScope, "qq_group:77777");
  assert.equal(qqStats.totalEntries, 1);
  assert.deepEqual(Object.keys(qqStats.byNamespace), ["social/qq-group-77777"]);

  // Forged owner_chief search must STILL return 0 hits for qq_group:77777
  const qqForgedSearchRes = await fetch(`${ready.httpUrl}/v1/memory/search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${qqToken}`
    },
    body: JSON.stringify({
      callerScope: "owner_chief",
      _callerScope: "owner_chief",
      namespaces: ["private/chief", "workspace/prismux"],
      query: "CHIEF_TOKEN_SECRET_ZZ9"
    })
  });
  assert.equal(qqForgedSearchRes.status, 200);
  const qqForgedSearch = (await qqForgedSearchRes.json()) as { hits: unknown[] };
  assert.equal(qqForgedSearch.hits.length, 0);

  const qqAllowedSearchRes = await fetch(`${ready.httpUrl}/v1/memory/search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${qqToken}`
    },
    body: JSON.stringify({ query: "QQ_SEVEN_PUBLIC_CHAT" })
  });
  assert.equal(qqAllowedSearchRes.status, 200);
  const qqAllowedSearch = (await qqAllowedSearchRes.json()) as { hits: unknown[] };
  assert.equal(qqAllowedSearch.hits.length, 1);

  // 3. Sync status + secret-stripping config persistence
  const syncPutRes = await fetch(`${ready.httpUrl}/v1/sync/config`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${ownerToken}`
    },
    body: JSON.stringify({
      passphrase: "super-secret-passphrase-never-saved-plaintext",
      channels: {
        webdav: {
          enabled: true,
          endpointUrl: "https://dav.example.com/prismux",
          username: "fish",
          password: "webdav-secret-password-999"
        }
      },
      syncMatrix: {
        privateMemory: { upload: true, download: false }
      }
    })
  });
  assert.equal(syncPutRes.status, 200);
  const syncStatus = (await syncPutRes.json()) as {
    status: { enabledChannels: string[] };
    channels: { webdav: { endpointUrl: string; hasSecret: boolean; password?: string } };
    hasPassphrase: boolean;
    syncMatrix: { privateMemory: { upload: boolean; download: boolean } };
  };
  assert.deepEqual(syncStatus.status.enabledChannels, ["webdav"]);
  assert.equal(syncStatus.channels.webdav.hasSecret, true);
  assert.equal(syncStatus.channels.webdav.password, undefined);
  assert.equal(syncStatus.hasPassphrase, true);
  assert.equal(syncStatus.syncMatrix.privateMemory.download, false);

  const syncConfigOnDisk = readFileSync(join(dataDir, "sync-config.json"), "utf8");
  assert.equal(syncConfigOnDisk.includes("webdav-secret-password-999"), false);
  assert.equal(
    syncConfigOnDisk.includes("super-secret-passphrase-never-saved-plaintext"),
    false
  );

  // 4. Plugins: 0 preinstalled official plugins + real HTTP .tgz install + toggle + uninstall
  const catRes = await fetch(`${ready.httpUrl}/v1/plugins/catalog`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(catRes.status, 200);
  const cat = (await catRes.json()) as {
    plugins: Array<{ id: string; installed: boolean }>;
  };
  for (const officialId of OFFICIAL_PLUGIN_IDS) {
    const entry = cat.plugins.find((p) => p.id === officialId);
    assert.ok(entry, `Catalog missing official plugin ${officialId}`);
    assert.equal(entry.installed, false, `Official plugin ${officialId} must not be preinstalled`);
  }

  const instListRes = await fetch(`${ready.httpUrl}/v1/plugins/installed`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(instListRes.status, 200);
  assert.equal(((await instListRes.json()) as { plugins: unknown[] }).plugins.length, 0);

  // Spin up local HTTP tarball server delivering a scriptless-enforced community plugin
  const tgzBuffer = buildDeterministicTgz({
    "package/package.json": JSON.stringify({
      name: "prismux-plugin-demo",
      version: "1.0.0",
      type: "module",
      main: "./index.mjs",
      engines: { prismux: ">=0.1.2-0 <2.0.0 || >=0.1.1-0 <2.0.0 || >=0.1.0-0 <2.0.0 || >=0.0.1-0 <0.1.0" },
      scripts: { postinstall: "echo SHOULD_NOT_EXECUTE && exit 1" }
    }),
    "package/plugin.manifest.json": JSON.stringify({
      id: "demo-plugin",
      version: "1.0.0",
      realms: ["daemon"],
      permissions: ["ui:panel"],
      modelVisible: false
    }),
    "package/index.mjs": `export const manifest = {
  id: "demo-plugin",
  version: "1.0.0",
  realms: ["daemon"],
  permissions: ["ui:panel"],
  modelVisible: false
};
export function apply(ctx) {
  ctx.registerStyle("demo-style", "body { --demo: 1; }");
}
`
  });

  const tgzServer = createServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "application/gzip",
      "content-length": String(tgzBuffer.byteLength)
    });
    res.end(tgzBuffer);
  });
  await new Promise<void>((resolveListen) => {
    tgzServer.listen(0, "127.0.0.1", () => resolveListen());
  });
  cleanups.push(
    () =>
      new Promise<void>((resolveClose) => {
        tgzServer.close(() => resolveClose());
      })
  );
  const tgzPort = (tgzServer.address() as AddressInfo).port;

  const installRes = await fetch(`${ready.httpUrl}/v1/plugins/install`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${ownerToken}`
    },
    body: JSON.stringify({
      source: "npm",
      packageNameOrTarball: `http://127.0.0.1:${tgzPort}/prismux-plugin-demo-1.0.0.tgz`
    })
  });
  assert.equal(installRes.status, 200);
  const installedData = (await installRes.json()) as {
    mounted: boolean;
    plugin: { manifest: { id: string }; distribution: string; ignoredInstallScripts: string[] };
  };
  assert.equal(installedData.mounted, true);
  assert.equal(installedData.plugin.manifest.id, "demo-plugin");
  assert.equal(installedData.plugin.distribution, "managed");
  assert.ok(installedData.plugin.ignoredInstallScripts.includes("postinstall"));
  assert.equal(daemon.pluginHost.getStyles().length, 1);

  // Toggle OFF tears down reversible Cordis effects
  const toggleOffRes = await fetch(`${ready.httpUrl}/v1/plugins/toggle`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${ownerToken}`
    },
    body: JSON.stringify({ pluginId: "demo-plugin", enabled: false })
  });
  assert.equal(toggleOffRes.status, 200);
  assert.equal(((await toggleOffRes.json()) as { mounted: boolean }).mounted, false);
  assert.equal(daemon.pluginHost.getStyles().length, 0);

  // Uninstall removes plugin files and host records
  const uninstallRes = await fetch(`${ready.httpUrl}/v1/plugins/uninstall`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${ownerToken}`
    },
    body: JSON.stringify({ pluginId: "demo-plugin" })
  });
  assert.equal(uninstallRes.status, 200);
  assert.equal(existsSync(join(dataDir, "plugins", "demo-plugin")), false);

  // 5. PUT /v1/updater/policy
  const policyRes = await fetch(`${ready.httpUrl}/v1/updater/policy`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${ownerToken}`
    },
    body: JSON.stringify({
      routePreference: "domestic",
      includePrerelease: false
    })
  });
  assert.equal(policyRes.status, 200);
  const policyBody = (await policyRes.json()) as {
    routePreference: string;
    includePrerelease: boolean;
  };
  assert.equal(policyBody.routePreference, "domestic");
  assert.equal(policyBody.includePrerelease, false);

  const updaterStatusRes = await fetch(`${ready.httpUrl}/v1/updater/status`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(updaterStatusRes.status, 200);
  const updaterStatus = (await updaterStatusRes.json()) as {
    currentVersion: string;
    policy: { routePreference: string; includePrerelease: boolean };
  };
  assert.equal(updaterStatus.currentVersion, "0.2.3-rc.1");
  assert.equal(updaterStatus.policy.routePreference, "domestic");
  assert.equal(updaterStatus.policy.includePrerelease, false);

  const healthCheckRes = await fetch(`${ready.httpUrl}/health`);
  assert.equal(healthCheckRes.status, 200);
  assert.equal(((await healthCheckRes.json()) as { version: string }).version, "0.2.3-rc.1");
});

test("Resilient cold-start: non-blocking T3 connect + /ws normalization + Electron protocol CORS + PRISMUX_CATALOG_PATH resolution", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "prismux-resilient-data-"));
  const catalogRoot = mkdtempSync(join(tmpdir(), "prismux-resilient-cat-"));
  tempDirs.push(dataDir, catalogRoot);

  // Reserve an ephemeral loopback port that initially refuses connections
  const probeServer = createNetServer();
  await new Promise<void>((resolveBind) => {
    probeServer.listen(0, "127.0.0.1", () => resolveBind());
  });
  const delayedT3Port = (probeServer.address() as AddressInfo).port;
  await new Promise<void>((resolveClose) => {
    probeServer.close(() => resolveClose());
  });

  // Create isolated catalog JSON referenced via PRISMUX_CATALOG_PATH
  const customCatalogPath = join(catalogRoot, "official.json");
  writeFileSync(
    customCatalogPath,
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-11-23T00:00:00Z",
      plugins: OFFICIAL_PLUGIN_IDS.map((id) => ({
        id,
        packageName: `@prismux/plugin-${id}`,
        version: "0.1.2-preview.4",
        description: `Catalog entry ${id}`,
        engines: { prismux: ">=0.1.2-0 <2.0.0 || >=0.1.1-0 <2.0.0 || >=0.1.0-0 <2.0.0 || >=0.0.1-0 <0.1.0" },
        realms: ["daemon"],
        permissions: ["hooks:subscribe"],
        modelVisible: false,
        sha256: "0".repeat(64),
        bytes: 123,
        status: "verified"
      }))
    }),
    "utf8"
  );

  const prevCatalogEnv = process.env["PRISMUX_CATALOG_PATH"];
  process.env["PRISMUX_CATALOG_PATH"] = customCatalogPath;
  cleanups.push(async () => {
    if (prevCatalogEnv === undefined) {
      delete process.env["PRISMUX_CATALOG_PATH"];
    } else {
      process.env["PRISMUX_CATALOG_PATH"] = prevCatalogEnv;
    }
  });

  const authToken = "resilient-owner-token";
  // Notice HTTP URL with root path "/" + ?token=... and NO listener running yet
  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken,
    t3Url: `http://127.0.0.1:${delayedT3Port}/?token=t3-late-boot-token`
  });

  // oxlint-disable-next-line prismux/no-wall-clock-in-tests -- verifies daemon.start() returns promptly without blocking on absent T3 server
  const startedAt = Date.now();
  const ready = await daemon.start();
  // oxlint-disable-next-line prismux/no-wall-clock-in-tests -- verifies daemon.start() returns promptly without blocking on absent T3 server
  const startupElapsedMs = Date.now() - startedAt;
  cleanups.push(async () => {
    await daemon.stop();
  });

  assert.equal(ready.t3Connected, false);
  assert.ok(
    startupElapsedMs < 2_500,
    `Daemon startup must not block on absent T3 server (took ${startupElapsedMs}ms)`
  );

  // 1. Verify /health, /v1/wallpapers/inventory, and /v1/plugins/catalog immediately return 200
  const healthBeforeRes = await fetch(`${ready.httpUrl}/health`);
  assert.equal(healthBeforeRes.status, 200);
  const healthBefore = (await healthBeforeRes.json()) as {
    ok: boolean;
    t3Connected: boolean;
  };
  assert.equal(healthBefore.ok, true);
  assert.equal(healthBefore.t3Connected, false);

  const wpRes = await fetch(`${ready.httpUrl}/v1/wallpapers/inventory`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assert.equal(wpRes.status, 200);

  // 2. Verify PRISMUX_CATALOG_PATH loads active official plugins (qq, fishdock-hook) while 0 are preinstalled
  const catRes = await fetch(`${ready.httpUrl}/v1/plugins/catalog`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      Origin: "prismux://app"
    }
  });
  assert.equal(catRes.status, 200);
  assert.equal(catRes.headers.get("access-control-allow-origin"), "prismux://app");
  const catPayload = (await catRes.json()) as {
    officialCatalogPath: string;
    installedCount: number;
    plugins: Array<{ id: string; installed: boolean }>;
  };
  assert.equal(catPayload.officialCatalogPath, customCatalogPath);
  assert.equal(catPayload.installedCount, 0);
  assert.equal(catPayload.plugins.length, OFFICIAL_PLUGIN_IDS.length);

  const instRes = await fetch(`${ready.httpUrl}/v1/plugins/installed`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assert.equal(instRes.status, 200);
  assert.equal(((await instRes.json()) as { totalCount: number }).totalCount, 0);

  // 3. Verify Electron desktop custom protocol CORS allowlist & untrusted rejection
  for (const allowedOrigin of [
    "prismux://app",
    "prismux-dev://app"
  ]) {
    const preflight = await fetch(`${ready.httpUrl}/v1/wallpapers/inventory`, {
      method: "OPTIONS",
      headers: { Origin: allowedOrigin }
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      allowedOrigin
    );
  }

  const badOriginRes = await fetch(`${ready.httpUrl}/health`, {
    headers: { Origin: "https://untrusted.example" }
  });
  assert.equal(badOriginRes.headers.get("access-control-allow-origin"), null);

  // 4. Spin up late T3 Server on delayedT3Port and confirm automatic background reconnect + /ws path normalization
  let sawNormalizedWsPath = false;
  let sawChiefEnsure = false;
  const lateT3Wss = new WebSocketServer({
    host: "127.0.0.1",
    port: delayedT3Port,
    verifyClient: (info, cb) => {
      const url = new URL(info.req.url ?? "/", "http://127.0.0.1");
      if (
        url.pathname === "/ws" &&
        url.searchParams.get("orchestrationProtocol") === "2" &&
        info.req.headers.authorization === "Bearer t3-late-boot-token"
      ) {
        sawNormalizedWsPath = true;
        cb(true);
        return;
      }
      cb(false, 404, "Bad path or auth");
    }
  });
  cleanups.push(
    () =>
      new Promise<void>((resolveClose) => {
        for (const ws of lateT3Wss.clients) {
          ws.terminate();
        }
        lateT3Wss.close(() => resolveClose());
      })
  );

  lateT3Wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as { id?: string; method?: string };
      if (msg.method === "chief.ensureThread" && typeof msg.id === "string") {
        sawChiefEnsure = true;
        ws.send(
          JSON.stringify({ id: msg.id, ok: true, result: { ensured: true } })
        );
      }
    });
  });

  // oxlint-disable-next-line prismux/no-wall-clock-in-tests -- real network reconnect deadline for delayed mock T3 WebSocket server
  const deadline = Date.now() + 6_000;
  let reconnected = false;
  // oxlint-disable-next-line prismux/no-polling-loop-in-tests, prismux/no-wall-clock-in-tests -- polls real HTTP /health until background WS reconnect completes
  while (Date.now() < deadline) {
    const hRes = await fetch(`${ready.httpUrl}/health`);
    const hJson = (await hRes.json()) as { t3Connected: boolean };
    if (hJson.t3Connected && sawChiefEnsure) {
      reconnected = true;
      break;
    }
    // oxlint-disable-next-line prismux/no-real-time-wait-in-tests -- backoff interval between real HTTP /health reconnect probes
    await new Promise((r) => setTimeout(r, 80));
  }

  assert.equal(sawNormalizedWsPath, true);
  assert.equal(reconnected, true, "Daemon should auto-connect once T3 Server starts");
});

test("Sync config accepts PUT and POST, rejects incomplete enabled channels with 400, and probes GitHub repo access accurately", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "prismux-sync-github-probe-"));
  tempDirs.push(dataDir);

  let ghMode: "ok-missing-file" | "repo-404" | "token-401" = "repo-404";
  const expectedPat = "ghp_SyncProbeSecretToken987654321";

  const mockGhServer = createServer((req, res) => {
    const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && reqUrl.pathname === "/repos/Fish-under-sea/prismux-vault") {
      if (ghMode === "token-401" || req.headers.authorization !== `Bearer ${expectedPat}`) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "Bad credentials" }));
        return;
      }
      if (ghMode === "repo-404") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "Not Found" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          full_name: "Fish-under-sea/prismux-vault",
          private: true,
          default_branch: "main",
          size: 16,
          permissions: { push: true, pull: true }
        })
      );
      return;
    }

    if (
      req.method === "GET" &&
      reqUrl.pathname === "/repos/Fish-under-sea/prismux-vault/contents/prismux-vault.prismux-backup"
    ) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Not Found" }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolveListen) => {
    mockGhServer.listen(0, "127.0.0.1", () => resolveListen());
  });
  cleanups.push(
    () =>
      new Promise<void>((resolveClose) => {
        mockGhServer.close(() => resolveClose());
      })
  );
  const ghPort = (mockGhServer.address() as AddressInfo).port;
  const ghApiBaseUrl = `http://127.0.0.1:${ghPort}`;

  const ownerToken = "sync-fix-owner-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken: ownerToken
  });
  const ready = await daemon.start();
  cleanups.push(async () => {
    await daemon.stop();
  });

  const authHeaders = {
    "content-type": "application/json",
    Authorization: `Bearer ${ownerToken}`
  };

  // 1. Enabled channel missing required fields returns 400 INVALID_SYNC_CHANNEL instead of silently dropping
  const badGithubRes = await fetch(`${ready.httpUrl}/v1/sync/config`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({
      channels: {
        github: { enabled: true, owner: "Fish-under-sea", repo: "" }
      }
    })
  });
  assert.equal(badGithubRes.status, 400);
  const badGithubErr = (await badGithubRes.json()) as {
    error?: { code?: string; message?: string };
  };
  assert.equal(badGithubErr.error?.code, "INVALID_SYNC_CHANNEL");
  assert.match(badGithubErr.error?.message ?? "", /私有仓库名/);

  const badWebdavRes = await fetch(`${ready.httpUrl}/v1/sync/config`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({
      channels: {
        webdav: { enabled: true, endpointUrl: "" }
      }
    })
  });
  assert.equal(badWebdavRes.status, 400);

  const badS3Res = await fetch(`${ready.httpUrl}/v1/sync/config`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({
      channels: {
        s3: { enabled: true, endpointUrl: "https://s3.example.com", bucket: "" }
      }
    })
  });
  assert.equal(badS3Res.status, 400);

  // 2. Backwards-compatible POST /v1/sync/config succeeds (saving a disabled unreachable WebDAV + enabled GitHub)
  const postSaveRes = await fetch(`${ready.httpUrl}/v1/sync/config`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      channels: {
        webdav: {
          enabled: false,
          endpointUrl: "http://127.0.0.1:1/unreachable-disabled-webdav",
          username: "unused"
        },
        github: {
          enabled: true,
          owner: "Fish-under-sea",
          repo: "prismux-vault",
          branch: "main",
          filePath: "prismux-vault.prismux-backup",
          apiBaseUrl: ghApiBaseUrl,
          token: expectedPat
        }
      }
    })
  });
  assert.equal(postSaveRes.status, 200);
  const postSaved = (await postSaveRes.json()) as {
    channels: { github: { enabled: boolean; owner: string; repo: string; hasSecret: boolean } };
  };
  assert.equal(postSaved.channels.github.enabled, true);
  assert.equal(postSaved.channels.github.owner, "Fish-under-sea");
  assert.equal(postSaved.channels.github.repo, "prismux-vault");
  assert.equal(postSaved.channels.github.hasSecret, true);

  // 3. GitHub repo 404 MUST fail connectivity probe (never falsely report success when snapshot 404s)
  ghMode = "repo-404";
  const repo404ProbeRes = await fetch(`${ready.httpUrl}/v1/sync/test`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({})
  });
  assert.equal(repo404ProbeRes.status, 200);
  const repo404Text = await repo404ProbeRes.text();
  assert.ok(!repo404Text.includes(expectedPat), "PAT must never leak in probe response");
  const repo404Json = JSON.parse(repo404Text) as {
    ok: boolean;
    results: Array<{ channel: string; ok: boolean; reachable?: boolean; error?: string }>;
  };
  assert.equal(repo404Json.ok, false);
  assert.equal(repo404Json.results.length, 1);
  assert.equal(repo404Json.results[0]?.channel, "github");
  assert.equal(repo404Json.results[0]?.ok, false);
  assert.match(repo404Json.results[0]?.error ?? "", /404/);

  // 4. GitHub token 401 fails with clear auth error and scrubs PAT
  ghMode = "token-401";
  const auth401ProbeRes = await fetch(`${ready.httpUrl}/v1/sync/test`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ channels: ["github"] })
  });
  assert.equal(auth401ProbeRes.status, 200);
  const auth401Json = (await auth401ProbeRes.json()) as {
    ok: boolean;
    results: Array<{ channel: string; ok: boolean; error?: string }>;
  };
  assert.equal(auth401Json.ok, false);
  assert.match(auth401Json.results[0]?.error ?? "", /401/);

  // 5. Valid GitHub repo with missing snapshot file succeeds AND disabled unreachable WebDAV does NOT break overallOk
  ghMode = "ok-missing-file";
  const okProbeRes = await fetch(`${ready.httpUrl}/v1/sync/test`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({})
  });
  assert.equal(okProbeRes.status, 200);
  const okProbeJson = (await okProbeRes.json()) as {
    ok: boolean;
    results: Array<{ channel: string; ok: boolean; reachable?: boolean; exists?: boolean; message?: string }>;
  };
  assert.equal(okProbeJson.ok, true);
  assert.equal(okProbeJson.results.length, 1);
  assert.equal(okProbeJson.results[0]?.channel, "github");
  assert.equal(okProbeJson.results[0]?.ok, true);
  assert.equal(okProbeJson.results[0]?.reachable, true);
  assert.equal(okProbeJson.results[0]?.exists, false);
  assert.match(okProbeJson.results[0]?.message ?? "", /Fish-under-sea\/prismux-vault/);

  // 6. PUT /v1/sync/config also works cleanly for passphrase-only updates without touching channels
  const putPassRes = await fetch(`${ready.httpUrl}/v1/sync/config`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({ passphrase: "DistinctSyncVaultPassphrase#2026" })
  });
  assert.equal(putPassRes.status, 200);
  const putPassJson = (await putPassRes.json()) as {
    hasPassphrase: boolean;
    channels: { github: { enabled: boolean; owner: string; hasSecret: boolean } };
  };
  assert.equal(putPassJson.hasPassphrase, true);
  assert.equal(putPassJson.channels.github.enabled, true);
  assert.equal(putPassJson.channels.github.owner, "Fish-under-sea");
  assert.equal(putPassJson.channels.github.hasSecret, true);
});

function buildMinimalMp4Box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, payload]);
}

function buildMinimalMp4Buffer(
  width: number,
  height: number,
  moovAtEnd: boolean
): Buffer {
  // tkhd v0 payload: 84 bytes (width at offset 76, height at offset 80 as 16.16 fixed-point)
  const tkhdPayload = Buffer.alloc(84, 0);
  tkhdPayload[0] = 0; // version 0
  tkhdPayload[3] = 3; // flags: enabled + in_movie
  // identity matrix at offset 40..76
  tkhdPayload.writeInt32BE(0x00010000, 40);
  tkhdPayload.writeInt32BE(0x00010000, 56);
  tkhdPayload.writeInt32BE(0x40000000, 72);
  tkhdPayload.writeUInt32BE((width << 16) >>> 0, 76);
  tkhdPayload.writeUInt32BE((height << 16) >>> 0, 80);

  const tkhd = buildMinimalMp4Box("tkhd", tkhdPayload);
  const trak = buildMinimalMp4Box("trak", tkhd);
  const moov = buildMinimalMp4Box("moov", trak);
  const ftyp = buildMinimalMp4Box("ftyp", Buffer.from("isom\x00\x00\x02\x00isommp41", "latin1"));
  // Large mdat (> 128 KB) when testing EOF moov jumping
  const mdat = buildMinimalMp4Box("mdat", Buffer.alloc(moovAtEnd ? 180_000 : 128, 0xaa));
  return moovAtEnd ? Buffer.concat([ftyp, mdat, moov]) : Buffer.concat([ftyp, moov, mdat]);
}

function buildMinimalWebmBuffer(width: number, height: number): Buffer {
  const ebmlHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01]);
  // PixelWidth (0xB0) + size 2 (0x82) + uint16BE, PixelHeight (0xBA) + size 2 (0x82) + uint16BE
  const pw = Buffer.alloc(4);
  pw[0] = 0xb0;
  pw[1] = 0x82;
  pw.writeUInt16BE(width, 2);
  const ph = Buffer.alloc(4);
  ph[0] = 0xba;
  ph[1] = 0x82;
  ph.writeUInt16BE(height, 2);
  const videoPayload = Buffer.concat([pw, ph]);
  const videoEl = Buffer.concat([Buffer.from([0xe0, 0x80 | videoPayload.length]), videoPayload]);
  const trackEntry = Buffer.concat([Buffer.from([0xae, 0x80 | videoEl.length]), videoEl]);
  const tracks = Buffer.concat([
    Buffer.from([0x16, 0x54, 0xae, 0x6b, 0x80 | trackEntry.length]),
    trackEntry
  ]);
  const segment = Buffer.concat([
    Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    tracks
  ]);
  return Buffer.concat([ebmlHeader, segment]);
}

test("RC.2 Web wallpaper URL-path token (/web-t/), Referer fallback, Spine/video MIME types, percent filenames, and true video dimensions", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "prismux-wp-rc2-data-"));
  const steamRoot = mkdtempSync(join(tmpdir(), "prismux-wp-rc2-steam-"));
  tempDirs.push(dataDir, steamRoot);

  const wsRoot = join(steamRoot, "steamapps", "workshop", "content", "431960");
  const webDir = join(wsRoot, "3650874083");
  mkdirSync(join(webDir, "assets", "8k"), { recursive: true });
  mkdirSync(join(webDir, "css"), { recursive: true });
  mkdirSync(join(webDir, "js"), { recursive: true });

  writeFileSync(
    join(webDir, "index.html"),
    "<!doctype html><html><head><title>BA</title></head><body><canvas id='canvas'></canvas></body></html>",
    "utf8"
  );
  writeFileSync(join(webDir, "css", "style.css"), "body{margin:0}", "utf8");
  writeFileSync(join(webDir, "assets", "8k", "CH0334_home.skel"), Buffer.from([1, 2, 3, 4]));
  writeFileSync(join(webDir, "assets", "8k", "CH0334_home.atlas"), "CH0334_home.png\nsize: 8192,8192\n", "utf8");
  writeFileSync(join(webDir, "preview.gif"), Buffer.from("GIF89a\x00\x02\x00\x02\x00\x00\x00", "latin1"));
  writeFileSync(
    join(webDir, "project.json"),
    JSON.stringify({
      title: "Blue Archive Spine Web",
      type: "Web",
      file: "index.html",
      preview: "preview.gif",
      contentrating: "Everyone",
      general: {
        properties: {
          introanimation: { type: "bool", value: true, order: 1, text: "Intro" }
        }
      }
    }),
    "utf8"
  );

  // Video wallpaper with EOF moov (3840x2160) + square 512x512 preview + literal '%' in filename
  const vidDir = join(wsRoot, "3839308585");
  mkdirSync(vidDir, { recursive: true });
  const eofMp4Path = join(vidDir, "100%_4K60_eof.mp4");
  writeFileSync(eofMp4Path, buildMinimalMp4Buffer(3840, 2160, true));
  writeFileSync(join(vidDir, "preview.png"), createMinimalPngBuffer(512, 512));
  writeFileSync(
    join(vidDir, "project.json"),
    JSON.stringify({
      title: "4K EOF Moov Video",
      type: "Video",
      file: "100%_4K60_eof.mp4",
      preview: "preview.png",
      contentrating: "Everyone"
    }),
    "utf8"
  );

  // Direct unit tests for readVideoDimensions on head-moov MP4, EOF-moov MP4, and WebM EBML
  const headMp4Path = join(dataDir, "head.mp4");
  const webmPath = join(dataDir, "sample.webm");
  writeFileSync(headMp4Path, buildMinimalMp4Buffer(2560, 1440, false));
  writeFileSync(webmPath, buildMinimalWebmBuffer(1920, 1080));
  assert.deepEqual(readVideoDimensions(headMp4Path), { width: 2560, height: 1440 });
  assert.deepEqual(readVideoDimensions(eofMp4Path), { width: 3840, height: 2160 });
  assert.deepEqual(readVideoDimensions(webmPath), { width: 1920, height: 1080 });

  // MIME coverage for Spine / Live2D / audio / video / XML assets
  assert.equal(getMimeTypeForFile("model.skel"), "application/octet-stream");
  assert.equal(getMimeTypeForFile("model.atlas"), "text/plain; charset=utf-8");
  assert.equal(getMimeTypeForFile("char.moc3"), "application/octet-stream");
  assert.equal(getMimeTypeForFile("mesh.bin"), "application/octet-stream");
  assert.equal(getMimeTypeForFile("clip.mkv"), "video/x-matroska");
  assert.equal(getMimeTypeForFile("clip.avi"), "video/x-msvideo");
  assert.equal(getMimeTypeForFile("bgm.m4a"), "audio/mp4");
  assert.equal(getMimeTypeForFile("bgm.flac"), "audio/flac");
  assert.equal(getMimeTypeForFile("bgm.aac"), "audio/aac");
  assert.equal(getMimeTypeForFile("meta.xml"), "application/xml; charset=utf-8");

  const authToken = "rc2-web-path-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken,
    steamRootsDiscoverer: async () => [steamRoot]
  });
  const ready = await daemon.start();
  cleanups.push(async () => {
    await daemon.stop();
  });

  // Inventory reports true 3840x2160 landscape for the 4K EOF-moov video (NOT 512x512 square preview!)
  // and preserves literal '%' filename cleanly without breaking resolution
  const invRes = await fetch(`${ready.httpUrl}/v1/wallpapers/inventory`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assert.equal(invRes.status, 200);
  const inv = (await invRes.json()) as {
    items: Array<{
      id: string;
      width: number | null;
      height: number | null;
      orientation: string;
      mediaUrl: string | null;
    }>;
  };
  const vidItem = inv.items.find((x) => x.id === "3839308585");
  assert.ok(vidItem);
  assert.equal(vidItem.width, 3840);
  assert.equal(vidItem.height, 2160);
  assert.equal(vidItem.orientation, "landscape");
  assert.equal(vidItem.mediaUrl, "/v1/wallpapers/media/3839308585");

  // 0. /v1/wallpapers/web-t/ is gated with 403 ENGINE_DISABLED until advancedEngineEnabled is enabled
  const webTGated = await fetch(
    `${ready.httpUrl}/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/3650874083/index.html`
  );
  assert.equal(webTGated.status, 403);
  const webTGatedBody = (await webTGated.json()) as { error?: { code?: string } };
  assert.equal(webTGatedBody.error?.code, "ENGINE_DISABLED");

  const enableWebEngineRes = await fetch(`${ready.httpUrl}/v1/appearance`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ wallpaper: { advancedEngineEnabled: true } })
  });
  assert.equal(enableWebEngineRes.status, 200);

  // 1. /v1/wallpapers/web-t/<token>/<id>/index.html authenticates with ZERO cookies and injects WE bridge
  const webTEntry = await fetch(
    `${ready.httpUrl}/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/3650874083/index.html`
  );
  assert.equal(webTEntry.status, 200);
  const entryHtml = await webTEntry.text();
  assert.match(entryHtml, /data-pmx-we-bridge="1"/);
  assert.match(entryHtml, /introanimation/);

  // 2. Relative subresources resolve cleanly with zero cookies or Authorization header
  const webTCss = await fetch(
    `${ready.httpUrl}/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/3650874083/css/style.css`
  );
  assert.equal(webTCss.status, 200);
  assert.equal(webTCss.headers.get("content-type"), "text/css; charset=utf-8");

  const webTSkel = await fetch(
    `${ready.httpUrl}/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/3650874083/assets/8k/CH0334_home.skel`
  );
  assert.equal(webTSkel.status, 200);
  assert.equal(webTSkel.headers.get("content-type"), "application/octet-stream");

  // 3. Browser-normalized `../assets/...` subresource via same-token loopback Referer resolves inside wallpaper root
  const webTRelParent = await fetch(
    `${ready.httpUrl}/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/assets/8k/CH0334_home.atlas`,
    {
      headers: {
        Referer: `${ready.httpUrl}/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/3650874083/index.html`
      }
    }
  );
  assert.equal(webTRelParent.status, 200);
  assert.equal(webTRelParent.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.match(await webTRelParent.text(), /CH0334_home\.png/);

  // 4. Wrong token on /web-t/ returns 401
  const webTBadToken = await fetch(
    `${ready.httpUrl}/v1/wallpapers/web-t/invalid-token/3650874083/css/style.css`
  );
  assert.equal(webTBadToken.status, 401);

  // 5. Traversal on /web-t/ returns 403
  const webTTraversalStatus = await new Promise<number>((resolveStatus, rejectStatus) => {
    const req = httpRequest(
      {
        host: ready.host,
        port: ready.port,
        method: "GET",
        path: `/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/3650874083/../../project.json`
      },
      (res) => {
        res.resume();
        resolveStatus(res.statusCode ?? 0);
      }
    );
    req.once("error", rejectStatus);
    req.end();
  });
  assert.equal(webTTraversalStatus, 403);

  // 6. Legacy /v1/wallpapers/web/<id>/<relPath> supports same-host same-id Referer query-token fallback
  const refererOk = await fetch(`${ready.httpUrl}/v1/wallpapers/web/3650874083/css/style.css`, {
    headers: {
      Referer: `${ready.httpUrl}/v1/wallpapers/web/3650874083/index.html?token=${encodeURIComponent(authToken)}`
    }
  });
  assert.equal(refererOk.status, 200);

  // Cross-id Referer must be rejected (401)
  const refererCrossId = await fetch(`${ready.httpUrl}/v1/wallpapers/web/3650874083/css/style.css`, {
    headers: {
      Referer: `${ready.httpUrl}/v1/wallpapers/web/other-id/index.html?token=${encodeURIComponent(authToken)}`
    }
  });
  assert.equal(refererCrossId.status, 401);
});

function buildScenePkgFixture(
  magic: string,
  entries: ReadonlyArray<{ name: string; data: Buffer }>
): Buffer {
  const magicBuf = Buffer.from(magic, "utf8");
  const magicLen = Buffer.alloc(4);
  magicLen.writeInt32LE(magicBuf.byteLength, 0);
  const countBuf = Buffer.alloc(4);
  countBuf.writeInt32LE(entries.length, 0);

  const headerParts: Buffer[] = [magicLen, magicBuf, countBuf];
  const dataParts: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const nameLen = Buffer.alloc(4);
    nameLen.writeInt32LE(nameBuf.byteLength, 0);
    const meta = Buffer.alloc(8);
    meta.writeUInt32LE(offset, 0);
    meta.writeUInt32LE(e.data.byteLength, 4);
    headerParts.push(nameLen, nameBuf, meta);
    dataParts.push(e.data);
    offset += e.data.byteLength;
  }
  return Buffer.concat([...headerParts, ...dataParts]);
}

function buildTexB3Fixture(
  width: number,
  height: number,
  flags: number,
  payload: Buffer
): Buffer {
  const texi = Buffer.alloc(28);
  texi.writeInt32LE(0, 0);
  texi.writeInt32LE(flags, 4);
  texi.writeInt32LE(width, 8);
  texi.writeInt32LE(height, 12);
  texi.writeInt32LE(width, 16);
  texi.writeInt32LE(height, 20);
  texi.writeInt32LE(0, 24);
  const counts = Buffer.alloc(12);
  counts.writeInt32LE(1, 0);
  counts.writeInt32LE(-1, 4);
  counts.writeInt32LE(1, 8);
  const mip = Buffer.alloc(20);
  mip.writeInt32LE(width, 0);
  mip.writeInt32LE(height, 4);
  mip.writeInt32LE(0, 8);
  mip.writeInt32LE(0, 12);
  mip.writeInt32LE(payload.byteLength, 16);
  return Buffer.concat([
    Buffer.from("TEXV0005\0", "ascii"),
    Buffer.from("TEXI0001\0", "ascii"),
    texi,
    Buffer.from("TEXB0003\0", "ascii"),
    counts,
    mip,
    payload
  ]);
}

test("RC.3 Steam scene.pkg /scene-t/ streaming (206), Web 404 vs 403, token fallback, and bridgeScript audio/path/reloadModel controls", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "prismux-wp-rc3-data-"));
  const steamRoot = mkdtempSync(join(tmpdir(), "prismux-wp-rc3-steam-"));
  tempDirs.push(dataDir, steamRoot);

  const wsRoot = join(steamRoot, "steamapps", "workshop", "content", "431960");

  // 1. Steam Scene wallpaper with embedded MP4 video inside scene.pkg + 512x512 square preview
  const sceneDir = join(wsRoot, "2966081148");
  mkdirSync(sceneDir, { recursive: true });
  const embeddedMp4 = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypmp42\x00\x00\x00\x00mp42isom", "latin1"),
    Buffer.from("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-SCENE-VIDEO-STREAM", "ascii")
  ]);
  const scenePkg = buildScenePkgFixture("PKGV0018", [
    {
      name: "scene.json",
      data: Buffer.from(
        JSON.stringify({
          general: { orthogonalprojection: { width: 2560, height: 1798 } },
          objects: [
            {
              name: "shiroko",
              image: "models/shiroko.json",
              visible: true,
              origin: "1280 899 0",
              size: "2560 1798"
            }
          ]
        }),
        "utf8"
      )
    },
    {
      name: "models/shiroko.json",
      data: Buffer.from(JSON.stringify({ material: "materials/shiroko.json" }), "utf8")
    },
    {
      name: "materials/shiroko.json",
      data: Buffer.from(JSON.stringify({ passes: [{ textures: ["shiroko"] }] }), "utf8")
    },
    {
      name: "materials/shiroko.tex",
      data: buildTexB3Fixture(2560, 1798, 34, embeddedMp4)
    }
  ]);
  writeFileSync(join(sceneDir, "scene.pkg"), scenePkg);
  writeFileSync(join(sceneDir, "preview.png"), createMinimalPngBuffer(512, 512));
  writeFileSync(
    join(sceneDir, "project.json"),
    JSON.stringify({
      title: "Shiroko 2K Scene",
      type: "Scene",
      file: "scene.json",
      preview: "preview.png",
      contentrating: "Everyone"
    }),
    "utf8"
  );

  // 2. Steam Web wallpaper (Spine 8k default + missing audio file check)
  const webDir = join(wsRoot, "3650874083");
  mkdirSync(join(webDir, "assets", "8k"), { recursive: true });
  mkdirSync(join(webDir, "assets", "audio"), { recursive: true });
  writeFileSync(
    join(webDir, "index.html"),
    "<!doctype html><html><head><title>Aris</title></head><body><canvas id='canvas'></canvas></body></html>",
    "utf8"
  );
  writeFileSync(join(webDir, "assets", "8k", "CH0334_home.skel"), Buffer.from([9, 8, 7, 6]));
  writeFileSync(join(webDir, "assets", "8k", "CH0334_home.atlas"), "CH0334_home.png\n", "utf8");
  writeFileSync(
    join(webDir, "project.json"),
    JSON.stringify({
      title: "Tendou Aris Spine",
      type: "Web",
      file: "index.html",
      contentrating: "Everyone",
      general: {
        properties: {
          modelresolution: { type: "combo", value: "8k", order: 1, text: "Resolution" },
          bgmvolume: { type: "slider", value: 20, order: 2, text: "BGM" }
        }
      }
    }),
    "utf8"
  );

  const authToken = "rc3-scene-web-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken,
    steamRootsDiscoverer: async () => [steamRoot]
  });
  const ready = await daemon.start();
  cleanups.push(async () => {
    await daemon.stop();
  });

  // By default (advancedEngineEnabled: false), inventory keeps Scene/Web visible at ~0 I/O cost
  // (skips inspectSteamScenePackage so sceneLiveSupported is false) and /scene-t/ returns 403 ENGINE_DISABLED.
  const gatedInvRes = await fetch(`${ready.httpUrl}/v1/wallpapers/inventory`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assert.equal(gatedInvRes.status, 200);
  const gatedInv = (await gatedInvRes.json()) as {
    items: Array<{ id: string; sceneLiveSupported: boolean }>;
  };
  const gatedSceneItem = gatedInv.items.find((x) => x.id === "2966081148");
  assert.ok(gatedSceneItem, "Scene item must remain visible in catalog when engine is disabled");
  assert.equal(
    gatedSceneItem.sceneLiveSupported,
    false,
    "inspectSteamScenePackage must be skipped while advancedEngineEnabled is false"
  );

  const gatedSceneHtmlRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/scene-t/${encodeURIComponent(authToken)}/2966081148/index.html`
  );
  assert.equal(gatedSceneHtmlRes.status, 403);
  const gatedSceneBody = (await gatedSceneHtmlRes.json()) as { error?: { code?: string } };
  assert.equal(gatedSceneBody.error?.code, "ENGINE_DISABLED");

  // Opt in to advancedEngineEnabled -> triggers rescan that inspects scene.pkg and unlocks /scene-t/ & /web-t/
  const enableRc3EngineRes = await fetch(`${ready.httpUrl}/v1/appearance`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ wallpaper: { advancedEngineEnabled: true } })
  });
  assert.equal(enableRc3EngineRes.status, 200);

  // Inventory reports sceneLiveSupported: true, /v1/wallpapers/scene/<id>/index.html, and true 2560x1798 landscape
  const invRes = await fetch(`${ready.httpUrl}/v1/wallpapers/inventory`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assert.equal(invRes.status, 200);
  const inv = (await invRes.json()) as {
    items: Array<{
      id: string;
      sceneLiveSupported: boolean;
      mediaUrl: string | null;
      webEntryUrl?: string | null;
      width: number | null;
      height: number | null;
      orientation: string;
    }>;
  };
  const sceneItem = inv.items.find((x) => x.id === "2966081148");
  assert.ok(sceneItem);
  assert.equal(sceneItem.sceneLiveSupported, true);
  assert.equal(sceneItem.mediaUrl, "/v1/wallpapers/scene/2966081148/index.html");
  assert.equal(sceneItem.webEntryUrl, "/v1/wallpapers/scene/2966081148/index.html");
  assert.equal(sceneItem.width, 2560);
  assert.equal(sceneItem.height, 1798);
  assert.equal(sceneItem.orientation, "landscape");

  // /v1/wallpapers/scene-t/<token>/<id>/index.html serves live player HTML
  const sceneHtmlRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/scene-t/${encodeURIComponent(authToken)}/2966081148/index.html`
  );
  assert.equal(sceneHtmlRes.status, 200);
  assert.equal(sceneHtmlRes.headers.get("access-control-allow-origin"), "*");
  const sceneHtml = await sceneHtmlRes.text();
  assert.match(sceneHtml, /data-pmx-scene-player="1"/);
  assert.match(sceneHtml, /\.\/asset\/0/);

  // Zero-copy HTTP 206 Partial Content streaming directly from scene.pkg slice
  const sceneRangeRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/scene-t/${encodeURIComponent(authToken)}/2966081148/asset/0`,
    { headers: { Range: "bytes=4-19" } }
  );
  assert.equal(sceneRangeRes.status, 206);
  assert.equal(sceneRangeRes.headers.get("content-type"), "video/mp4");
  assert.equal(sceneRangeRes.headers.get("accept-ranges"), "bytes");
  assert.equal(sceneRangeRes.headers.get("access-control-allow-origin"), "*");
  assert.equal(sceneRangeRes.headers.get("cross-origin-resource-policy"), "cross-origin");
  assert.equal(
    sceneRangeRes.headers.get("content-range"),
    `bytes 4-19/${embeddedMp4.byteLength}`
  );
  const rangeBytes = Buffer.from(await sceneRangeRes.arrayBuffer());
  assert.deepEqual(rangeBytes, embeddedMp4.subarray(4, 20));

  // HEAD request on scene asset succeeds with exact total content-length
  const sceneHeadRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/scene-t/${encodeURIComponent(authToken)}/2966081148/asset/0`,
    { method: "HEAD" }
  );
  assert.equal(sceneHeadRes.status, 200);
  assert.equal(sceneHeadRes.headers.get("content-length"), String(embeddedMp4.byteLength));

  // Unsatisfiable range returns 416; wrong token returns 401; traversal returns 403
  const scene416Res = await fetch(
    `${ready.httpUrl}/v1/wallpapers/scene-t/${encodeURIComponent(authToken)}/2966081148/asset/0`,
    { headers: { Range: "bytes=999999-1000010" } }
  );
  assert.equal(scene416Res.status, 416);

  const sceneBadTokRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/scene-t/bad-token/2966081148/index.html`
  );
  assert.equal(sceneBadTokRes.status, 401);

  const sceneTraversalStatus = await new Promise<number>((resolveStatus, rejectStatus) => {
    const req = httpRequest(
      {
        host: ready.host,
        port: ready.port,
        method: "GET",
        path: `/v1/wallpapers/scene-t/${encodeURIComponent(authToken)}/2966081148/../../project.json`
      },
      (res) => {
        res.resume();
        resolveStatus(res.statusCode ?? 0);
      }
    );
    req.once("error", rejectStatus);
    req.end();
  });
  assert.equal(sceneTraversalStatus, 403);

  // Web wallpaper entry + missing audio returns 404 (NOT 403) + CORS header + lastWebWallpaperIdByToken fallback
  const webHtmlRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/3650874083/index.html`
  );
  assert.equal(webHtmlRes.status, 200);
  const webHtml = await webHtmlRes.text();
  assert.match(webHtml, /data-pmx-we-style="1"/);
  assert.match(
    webHtml,
    /:where\(body > canvas#canvas\)\{display:block;width:100%;height:100%;\}/
  );
  assert.match(webHtml, /data-pmx-we-bridge="1"/);

  const missingAudioRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/3650874083/assets/audio/CH0334_memoriallobby_0.ogg`
  );
  assert.equal(missingAudioRes.status, 404);
  const missingBody = (await missingAudioRes.json()) as { error?: { code?: string } };
  assert.equal(missingBody.error?.code, "ASSET_NOT_FOUND");

  // Same-token request without Referer still resolves escaped `assets/...` via lastWebWallpaperIdByToken
  const noRefererFallbackRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/assets/8k/CH0334_home.atlas`
  );
  assert.equal(noRefererFallbackRes.status, 200);
  assert.equal(noRefererFallbackRes.headers.get("access-control-allow-origin"), "*");
  assert.match(await noRefererFallbackRes.text(), /CH0334_home\.png/);

  // Execute the injected bridgeScript in a minimal VM harness to verify audio master mute,
  // "../" URL clamping, AudioContext gain routing, and initial modelresolution reload guard.
  const scriptMatch = /<script data-pmx-we-bridge="1">([\s\S]*?)<\/script>/.exec(webHtml);
  assert.ok(scriptMatch && scriptMatch[1], "bridgeScript must be present in Web wallpaper HTML");
  const bridgeScriptSource = scriptMatch[1];

  const openedXhrUrls: string[] = [];
  const fetchedUrls: string[] = [];
  const postedToParent: unknown[] = [];
  const windowListeners = new Map<string, Array<(ev: unknown) => void>>();

  class FakeMediaElement {
    _vol = 1;
    _muted = false;
    _src = "";
    paused = true;
    loop = false;
    isConnected = false;
    playCount = 0;
    pauseCount = 0;
    get volume(): number {
      return this._vol;
    }
    set volume(v: number) {
      this._vol = v;
    }
    get muted(): boolean {
      return this._muted;
    }
    set muted(v: boolean) {
      this._muted = v;
    }
    get src(): string {
      return this._src;
    }
    set src(v: string) {
      this._src = v;
    }
    setAttribute(name: string, val: string): void {
      if (name.toLowerCase() === "src") {
        this._src = val;
      }
    }
    play(): Promise<void> {
      this.paused = false;
      this.playCount += 1;
      return Promise.resolve();
    }
    pause(): void {
      this.paused = true;
      this.pauseCount += 1;
    }
    addEventListener(): void {
      // noop
    }
  }
  class FakeAudio extends FakeMediaElement {
    constructor(src?: string) {
      super();
      if (typeof src === "string") {
        this._src = src;
      }
    }
  }
  class FakeImage {
    _src = "";
    get src(): string {
      return this._src;
    }
    set src(v: string) {
      this._src = v;
    }
    setAttribute(name: string, val: string): void {
      if (name.toLowerCase() === "src") {
        this._src = val;
      }
    }
  }
  class FakeXHR {
    open(_method: string, url: string): void {
      openedXhrUrls.push(url);
    }
  }
  class FakeAudioNode {
    context: FakeAudioContext;
    connectedTo: unknown = null;
    constructor(ctx: FakeAudioContext) {
      this.context = ctx;
    }
    connect(dest: unknown): unknown {
      this.connectedTo = dest;
      return dest;
    }
  }
  class FakeGainNode extends FakeAudioNode {
    gain = { value: 1 };
  }
  class FakeAudioContext {
    destination = { isDestination: true };
    state: "running" | "suspended" = "running";
    createdGains: FakeGainNode[] = [];
    createGain(): FakeGainNode {
      const g = new FakeGainNode(this);
      this.createdGains.push(g);
      return g;
    }
    suspend(): Promise<void> {
      this.state = "suspended";
      return Promise.resolve();
    }
    resume(): Promise<void> {
      this.state = "running";
      return Promise.resolve();
    }
  }
  class FakeWebGL {
    drawElements(_mode: number, _count: number): void {
      // noop
    }
    drawArrays(_mode: number, _count: number): void {
      // noop
    }
  }
  class FakeDocument {
    readyState = "complete";
    documentElement = { clientWidth: 1920, clientHeight: 1080 };
    createElement(tag: string): unknown {
      if (tag.toLowerCase() === "audio" || tag.toLowerCase() === "video") {
        return new FakeMediaElement();
      }
      return {};
    }
    createElementNS(_ns: string, tag: string): unknown {
      return this.createElement(tag);
    }
    querySelector(): unknown {
      return { tagName: "CANVAS" };
    }
    querySelectorAll(): unknown[] {
      return [];
    }
    addEventListener(): void {
      // noop
    }
  }

  const fakeWindow: Record<string, unknown> = {
    location: {
      href: `http://127.0.0.1:41999/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/3650874083/index.html`
    },
    parent: {
      postMessage: (msg: unknown) => {
        postedToParent.push(msg);
      }
    },
    fetch: (input: string) => {
      fetchedUrls.push(input);
      return Promise.resolve({ ok: true });
    },
    addEventListener: (type: string, cb: (ev: unknown) => void) => {
      const list = windowListeners.get(type) ?? [];
      list.push(cb);
      windowListeners.set(type, list);
    },
    dispatchEvent: () => true,
    Audio: FakeAudio,
    AudioContext: FakeAudioContext,
    WebGLRenderingContext: FakeWebGL
  };
  fakeWindow["window"] = fakeWindow;

  const sandbox = {
    window: fakeWindow,
    document: new FakeDocument(),
    Document: FakeDocument,
    XMLHttpRequest: FakeXHR,
    HTMLImageElement: FakeImage,
    HTMLMediaElement: FakeMediaElement,
    AudioNode: FakeAudioNode,
    URL,
    Event: class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
    queueMicrotask,
    setTimeout: () => 1,
    clearTimeout: () => undefined
  };

  NodeVM.runInNewContext(scriptMatch[1], sandbox);

  // 1) Relative "../" URL rewriting for XHR, fetch, and Image
  const xhr = new FakeXHR();
  xhr.open("GET", "../assets/8k/CH0334_home.skel");
  assert.equal(
    openedXhrUrls[0],
    `http://127.0.0.1:41999/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/3650874083/assets/8k/CH0334_home.skel`
  );

  await (fakeWindow["fetch"] as (u: string) => Promise<unknown>)("../assets/8k/CH0334_home.atlas");
  assert.equal(
    fetchedUrls[0],
    `http://127.0.0.1:41999/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/3650874083/assets/8k/CH0334_home.atlas`
  );

  const img = new FakeImage();
  img.src = "../assets/8k/CH0334_home.png";
  assert.equal(
    img._src,
    `http://127.0.0.1:41999/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/3650874083/assets/8k/CH0334_home.png`
  );

  // 2) Master Audio Controller: starts muted/0, scales volume on unmute, mutes again cleanly, routes AudioContext
  const PatchedAudio = fakeWindow["Audio"] as typeof FakeAudio;
  const bgm = new PatchedAudio("../assets/audio/Theme_298.ogg");
  assert.equal(
    bgm._src,
    `http://127.0.0.1:41999/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/3650874083/assets/audio/Theme_298.ogg`
  );
  bgm.volume = 0.4;
  await bgm.play();
  assert.equal(bgm._muted, true, "Audio must remain strictly muted before host unmutes");
  assert.equal(bgm._vol, 0, "Underlying volume must be 0 while master muted");
  assert.equal(bgm.volume, 0.4, "Getter should preserve wallpaper base volume");

  const PatchedAudioCtx = fakeWindow["AudioContext"] as typeof FakeAudioContext;
  const ctx = new PatchedAudioCtx();
  const osc = new FakeAudioNode(ctx);
  osc.connect(ctx.destination);
  assert.equal(ctx.state, "suspended");
  assert.equal(ctx.createdGains.length, 1);
  assert.equal(osc.connectedTo, ctx.createdGains[0]);
  assert.equal(ctx.createdGains[0]!.gain.value, 0);

  const emitMessage = (data: unknown) => {
    for (const cb of windowListeners.get("message") ?? []) {
      cb({ data });
    }
  };

  emitMessage({ type: "prismuxWallpaperAudio", muted: false, volume: 0.5 });
  assert.equal(bgm._muted, false);
  assert.ok(Math.abs(bgm._vol - 0.2) < 1e-6);
  assert.equal(ctx.state, "running");
  assert.equal(ctx.createdGains[0]!.gain.value, 0.5);

  emitMessage({ type: "prismuxWallpaperAudio", muted: true, volume: 0 });
  assert.equal(bgm._muted, true);
  assert.equal(bgm._vol, 0);
  assert.equal(ctx.state, "suspended");

  // 3) Duplicate initial modelresolution guard: skips initial "8k" because 8k was already requested,
  //    but delivers manual user switches to "4k" and back to "8k"
  const receivedPropCalls: Array<Record<string, { value: unknown }>> = [];
  fakeWindow["wallpaperPropertyListener"] = {
    applyUserProperties: (props: Record<string, { value: unknown }>) => {
      receivedPropCalls.push(props);
    }
  };

  emitMessage({
    type: "wallpaperPropertyListener",
    applyUserProperties: { modelresolution: { value: "8k" }, bgmvolume: { value: 20 } },
    applyGeneralProperties: { paused: true },
    audio: { muted: true, volume: 0 }
  });
  assert.equal(receivedPropCalls.length, 1);
  assert.equal("modelresolution" in receivedPropCalls[0]!, false);
  assert.equal(receivedPropCalls[0]!["bgmvolume"]?.value, 20);
  assert.equal(bgm.paused, true, "paused: true must pause active playback");

  // Unpause resumes media and user switching resolution to 4k -> 8k delivers normally
  emitMessage({
    type: "wallpaperPropertyListener",
    applyUserProperties: { modelresolution: { value: "4k" } },
    applyGeneralProperties: { paused: false }
  });
  assert.equal(receivedPropCalls.length, 2);
  assert.equal(receivedPropCalls[1]!["modelresolution"]?.value, "4k");
  assert.equal(bgm.paused, false, "paused: false must resume host-paused playback");

  emitMessage({
    type: "wallpaperPropertyListener",
    applyUserProperties: { modelresolution: { value: "8k" } }
  });
  assert.equal(receivedPropCalls.length, 3);
  assert.equal(receivedPropCalls[2]!["modelresolution"]?.value, "8k");

  // 4) Readiness signals: bridge ready already posted, WebGL drawElements triggers prismuxWebReady
  assert.equal(
    postedToParent.some((m) => (m as { type?: string }).type === "prismuxWeBridgeReady"),
    true
  );
  const gl = new FakeWebGL();
  gl.drawElements(4, 12);
  await Promise.resolve();
  assert.equal(
    postedToParent.some((m) => (m as { type?: string }).type === "prismuxWebReady"),
    true
  );

  // 5) 0x0 viewport layout guard: defers initial applyUserProperties until non-zero layout (rAF / ResizeObserver)
  //    while applying master audio mute & paused IMMEDIATELY, with bounded 300ms fallback for headless 0x0 viewports.
  const runLayoutGuardHarness = (mode: "raf" | "resizeObserver" | "fallback300ms") => {
    const listeners = new Map<string, Array<(ev: unknown) => void>>();
    const docEl = { clientWidth: 0, clientHeight: 0 };
    const timers: Array<{ id: number; delay: number; fn: () => void; cleared: boolean }> = [];
    const rafCbs: Array<() => void> = [];
    const roCbs: Array<() => void> = [];
    const propDeliveries: Array<Record<string, { value: unknown }>> = [];
    let nextTimerId = 1;

    class GuardMediaElement {
      _vol = 1;
      _muted = false;
      _src = "";
      paused = true;
      loop = false;
      isConnected = false;
      get volume(): number {
        return this._vol;
      }
      set volume(v: number) {
        this._vol = v;
      }
      get muted(): boolean {
        return this._muted;
      }
      set muted(v: boolean) {
        this._muted = v;
      }
      get src(): string {
        return this._src;
      }
      set src(v: string) {
        this._src = v;
      }
      setAttribute(name: string, val: string): void {
        if (name.toLowerCase() === "src") {
          this._src = val;
        }
      }
      play(): Promise<void> {
        this.paused = false;
        return Promise.resolve();
      }
      pause(): void {
        this.paused = true;
      }
      addEventListener(): void {
        // noop
      }
    }
    class GuardAudioCtor extends GuardMediaElement {
      constructor(src?: string) {
        super();
        if (typeof src === "string") {
          this._src = src;
        }
      }
    }
    class GuardResizeObserver {
      private cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
      }
      observe(): void {
        roCbs.push(this.cb);
      }
    }

    const guardWin: Record<string, unknown> = {
      location: {
        href: `http://127.0.0.1:41999/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/3650874083/index.html`
      },
      parent: { postMessage: () => undefined },
      fetch: () => Promise.resolve({ ok: true }),
      addEventListener: (type: string, cb: (ev: unknown) => void) => {
        const list = listeners.get(type) ?? [];
        list.push(cb);
        listeners.set(type, list);
      },
      dispatchEvent: () => true,
      Audio: GuardAudioCtor
    };
    guardWin["window"] = guardWin;

    NodeVM.runInNewContext(bridgeScriptSource, {
      window: guardWin,
      document: {
        readyState: "complete",
        documentElement: docEl,
        createElement: (tag: string) =>
          tag.toLowerCase() === "audio" || tag.toLowerCase() === "video"
            ? new GuardMediaElement()
            : {},
        createElementNS: (_ns: string, tag: string) =>
          tag.toLowerCase() === "audio" || tag.toLowerCase() === "video"
            ? new GuardMediaElement()
            : {},
        querySelector: () => ({ tagName: "CANVAS" }),
        querySelectorAll: () => [],
        addEventListener: () => undefined
      },
      HTMLMediaElement: GuardMediaElement,
      ResizeObserver: GuardResizeObserver,
      URL,
      Event: class {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      },
      queueMicrotask,
      requestAnimationFrame: (cb: () => void) => {
        rafCbs.push(cb);
        return rafCbs.length;
      },
      cancelAnimationFrame: () => undefined,
      setTimeout: (fn: () => void, delay: number) => {
        const id = nextTimerId++;
        timers.push({ id, delay, fn, cleared: false });
        return id;
      },
      clearTimeout: (id: number) => {
        const t = timers.find((x) => x.id === id);
        if (t) {
          t.cleared = true;
        }
      }
    });

    const GuardAudio = guardWin["Audio"] as typeof GuardAudioCtor;
    const track = new GuardAudio("../assets/audio/Theme_298.ogg");
    track.volume = 0.8;
    void track.play();
    assert.equal(track.paused, false);
    assert.equal(track._muted, true);

    guardWin["wallpaperPropertyListener"] = {
      applyUserProperties: (props: Record<string, { value: unknown }>) => {
        propDeliveries.push(props);
      }
    };

    for (const cb of listeners.get("message") ?? []) {
      cb({
        data: {
          type: "wallpaperPropertyListener",
          applyUserProperties: { scale: { value: 1.25 } },
          applyGeneralProperties: { paused: true },
          audio: { muted: true, volume: 0 }
        }
      });
    }

    // Audio & paused take effect IMMEDIATELY even at 0x0, while applyUserProperties is deferred
    assert.equal(track._muted, true);
    assert.equal(track.paused, true, "paused: true must apply immediately at 0x0 viewport");
    assert.equal(
      propDeliveries.length,
      0,
      `initial applyUserProperties must be deferred while clientWidth/Height === 0 (${mode})`
    );

    if (mode === "raf") {
      // First rAF tick while still 0x0 keeps deferring
      assert.ok(rafCbs.length >= 1);
      rafCbs.shift()!();
      assert.equal(propDeliveries.length, 0);

      // Once layout becomes non-zero, next rAF tick delivers immediately
      docEl.clientWidth = 1280;
      docEl.clientHeight = 720;
      assert.ok(rafCbs.length >= 1);
      rafCbs.shift()!();
    } else if (mode === "resizeObserver") {
      docEl.clientWidth = 1440;
      docEl.clientHeight = 900;
      assert.ok(roCbs.length >= 1);
      roCbs[0]!();
    } else {
      // Bounded 300ms fallback delivers even if headless/jsdom viewport stays 0x0
      const fallbackTimer = timers.find((t) => !t.cleared && t.delay === 300);
      assert.ok(fallbackTimer, "Expected a bounded 300ms fallback timer for 0x0 layout guard");
      fallbackTimer.fn();
    }

    assert.equal(propDeliveries.length, 1);
    assert.equal(propDeliveries[0]!["scale"]?.value, 1.25);
    assert.equal(propDeliveries[0]!["modelresolution"]?.value, "8k");
  };

  runLayoutGuardHarness("raf");
  runLayoutGuardHarness("resizeObserver");
  runLayoutGuardHarness("fallback300ms");
});

test("Wave 2: PUT /v1/appearance skips rescan on card clicks & sliders and only rescans on customDirs/steamRootOverride/advancedEngineEnabled changes", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "prismux-wp-norescan-data-"));
  const steamRoot = mkdtempSync(join(tmpdir(), "prismux-wp-norescan-steam-"));
  const extraCustom = mkdtempSync(join(tmpdir(), "prismux-wp-norescan-custom-"));
  tempDirs.push(dataDir, steamRoot, extraCustom);

  const wsDir = join(steamRoot, "steamapps", "workshop", "content", "431960", "555111");
  mkdirSync(wsDir, { recursive: true });
  writeFileSync(join(wsDir, "bg.png"), createMinimalPngBuffer(1920, 1080));
  writeFileSync(
    join(wsDir, "project.json"),
    JSON.stringify({
      title: "Calm Landscape",
      type: "Image",
      file: "bg.png",
      preview: "bg.png",
      contentrating: "Everyone"
    }),
    "utf8"
  );

  let steamDiscoverCalls = 0;
  const authToken = "wave2-norescan-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken,
    steamRootsDiscoverer: async () => {
      steamDiscoverCalls += 1;
      return [steamRoot];
    }
  });
  const ready = await daemon.start();
  cleanups.push(async () => {
    await daemon.stop();
  });

  // Prime inventory once
  const invRes = await fetch(`${ready.httpUrl}/v1/wallpapers/inventory`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assert.equal(invRes.status, 200);
  const baselineCalls = steamDiscoverCalls;
  assert.ok(baselineCalls >= 1);

  // Clicking wallpaper cards and dragging appearance sliders MUST NEVER trigger a Steam 431960 rescan
  const nonRescanPayloads = [
    { wallpaper: { selectedId: "555111", playing: true } },
    { wallpaper: { wallpaperBlur: 12, scrim: 0.25, backgroundBrightness: 110 } },
    { themeMode: "dark", glassPreset: "frosted" },
    { wallpaper: { selectedId: null, playing: false } }
  ];
  for (const payload of nonRescanPayloads) {
    const res = await fetch(`${ready.httpUrl}/v1/appearance`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });
    assert.equal(res.status, 200);
  }
  assert.equal(
    steamDiscoverCalls,
    baselineCalls,
    "card clicks and appearance slider saves must trigger 0 wallpaper rescans"
  );

  // Changing customDirs -> triggers exactly 1 rescan
  const resCustom = await fetch(`${ready.httpUrl}/v1/appearance`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ wallpaper: { customDirs: [extraCustom] } })
  });
  assert.equal(resCustom.status, 200);
  assert.equal(steamDiscoverCalls, baselineCalls + 1);

  // Re-sending identical customDirs -> triggers 0 rescans
  const resSameCustom = await fetch(`${ready.httpUrl}/v1/appearance`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ wallpaper: { customDirs: [extraCustom] } })
  });
  assert.equal(resSameCustom.status, 200);
  assert.equal(steamDiscoverCalls, baselineCalls + 1);

  // Toggling advancedEngineEnabled -> triggers exactly 1 rescan
  const resToggleEngine = await fetch(`${ready.httpUrl}/v1/appearance`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ wallpaper: { advancedEngineEnabled: true } })
  });
  assert.equal(resToggleEngine.status, 200);
  assert.equal(steamDiscoverCalls, baselineCalls + 2);

  // Changing steamRootOverride -> triggers exactly 1 rescan (custom override skips discoverer, so verify inventory succeeds)
  const resSteamOverride = await fetch(`${ready.httpUrl}/v1/appearance`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ wallpaper: { steamRootOverride: steamRoot } })
  });
  assert.equal(resSteamOverride.status, 200);
});

test("Wave 2: WallpaperMediaService async rescan single-flight coalescing", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "prismux-wp-sf-data-"));
  const steamRoot = mkdtempSync(join(tmpdir(), "prismux-wp-sf-steam-"));
  tempDirs.push(dataDir, steamRoot);

  const wsDir = join(steamRoot, "steamapps", "workshop", "content", "431960", "777888");
  mkdirSync(wsDir, { recursive: true });
  writeFileSync(join(wsDir, "cover.png"), createMinimalPngBuffer(1280, 720));
  writeFileSync(
    join(wsDir, "project.json"),
    JSON.stringify({
      title: "Coalesce Test",
      type: "Image",
      file: "cover.png",
      preview: "cover.png",
      contentrating: "Everyone"
    }),
    "utf8"
  );

  const gate = {
    fn: null as (() => void) | null,
    enteredFn: null as (() => void) | null,
    release() {
      this.fn?.();
    }
  };
  let enteredPromise = new Promise<void>((resolve) => {
    gate.enteredFn = resolve;
  });
  let discoverCalls = 0;
  const service = new WallpaperMediaService({
    dataDir,
    advancedEngineEnabled: false,
    steamRootsDiscoverer: async () => {
      discoverCalls += 1;
      if (discoverCalls === 1) {
        gate.enteredFn?.();
        await new Promise<void>((resolve) => {
          gate.fn = resolve;
        });
      }
      return [steamRoot];
    }
  });

  // Fire 5 concurrent rescans with identical arguments while the first scan is suspended
  const p1 = service.rescan({ advancedEngineEnabled: false });
  const p2 = service.rescan({ advancedEngineEnabled: false });
  const p3 = service.rescan({ advancedEngineEnabled: false });
  const p4 = service.rescan({ advancedEngineEnabled: false });
  const p5 = service.rescan({ advancedEngineEnabled: false });

  await enteredPromise;
  assert.equal(discoverCalls, 1, "identical concurrent rescans must share a single in-flight promise");
  gate.release();

  const results = await Promise.all([p1, p2, p3, p4, p5]);
  assert.equal(service.getRescanCount(), 1, "5 identical concurrent rescans must perform exactly 1 scan");
  for (const inv of results) {
    assert.equal(inv.items.some((x) => x.id === "777888"), true);
  }

  // Now test coalescing when options change mid-flight (queues exactly 1 follow-up rescan with latest options)
  discoverCalls = 0;
  gate.fn = null;
  enteredPromise = new Promise<void>((resolve) => {
    gate.enteredFn = resolve;
  });
  const slow1 = service.rescan({ advancedEngineEnabled: false });
  await enteredPromise;
  const followUpA = service.rescan({ advancedEngineEnabled: true });
  const followUpB = service.rescan({ advancedEngineEnabled: true });
  gate.release();
  await Promise.all([slow1, followUpA, followUpB]);
  assert.equal(
    service.getRescanCount(),
    3,
    "initial scan + 1 coalesced follow-up scan (total 1 + 2 = 3)"
  );
  assert.equal(service.isAdvancedEngineEnabled(), true);
});

test("Wave 2: AppearanceConfigStore advancedEngineEnabled defaults false and smoothly migrates existing web/scene users", async () => {
  // 1. Fresh config defaults to advancedEngineEnabled: false
  const def = createDefaultAppearanceConfig();
  assert.equal(def.wallpaper.advancedEngineEnabled, false);

  const dirFresh = mkdtempSync(join(tmpdir(), "prismux-app-fresh-"));
  const dirLegacyImage = mkdtempSync(join(tmpdir(), "prismux-app-legacy-img-"));
  const dirLegacyWeb = mkdtempSync(join(tmpdir(), "prismux-app-legacy-web-"));
  const dirLegacySteamScene = mkdtempSync(join(tmpdir(), "prismux-app-legacy-scene-"));
  const steamRoot = mkdtempSync(join(tmpdir(), "prismux-app-legacy-steam-"));
  tempDirs.push(dirFresh, dirLegacyImage, dirLegacyWeb, dirLegacySteamScene, steamRoot);

  const freshStore = new AppearanceConfigStore({ dataDir: dirFresh });
  assert.equal(freshStore.get().config.wallpaper.advancedEngineEnabled, false);

  // 2. Legacy config on image wallpaper -> stays false
  writeFileSync(
    join(dirLegacyImage, "appearance.json"),
    JSON.stringify({
      version: 1,
      wallpaper: {
        selectedId: "custom-img-1",
        selectedWallpaperType: "image"
      }
    }),
    "utf8"
  );
  const legacyImgStore = new AppearanceConfigStore({ dataDir: dirLegacyImage });
  assert.equal(legacyImgStore.get().config.wallpaper.advancedEngineEnabled, false);

  // 3. Legacy config on web/scene wallpaper (no advancedEngineEnabled field) -> auto-migrates to true
  writeFileSync(
    join(dirLegacyWeb, "appearance.json"),
    JSON.stringify({
      version: 1,
      wallpaper: {
        selectedId: "web:legacy-live",
        selectedWallpaperType: "web"
      }
    }),
    "utf8"
  );
  const legacyWebStore = new AppearanceConfigStore({ dataDir: dirLegacyWeb });
  assert.equal(legacyWebStore.get().config.wallpaper.advancedEngineEnabled, true);

  // 4. Deferred Steam catalog upgrade migration: legacy appearance.json has numeric Steam Scene selectedId with NO selectedWallpaperType
  const wsDir = join(steamRoot, "steamapps", "workshop", "content", "431960", "2966081148");
  mkdirSync(wsDir, { recursive: true });
  const embeddedMp4 = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypmp42\x00\x00\x00\x00mp42isom", "latin1"),
    Buffer.from("MIGRATION-SCENE-DATA", "ascii")
  ]);
  writeFileSync(
    join(wsDir, "scene.pkg"),
    buildScenePkgFixture("PKGV0018", [
      {
        name: "scene.json",
        data: Buffer.from(
          JSON.stringify({
            general: { orthogonalprojection: { width: 1920, height: 1080 } },
            objects: [
              {
                name: "bg",
                image: "models/bg.json",
                visible: true,
                origin: "960 540 0",
                size: "1920 1080"
              }
            ]
          }),
          "utf8"
        )
      },
      {
        name: "models/bg.json",
        data: Buffer.from(JSON.stringify({ material: "materials/bg.json" }), "utf8")
      },
      {
        name: "materials/bg.json",
        data: Buffer.from(JSON.stringify({ passes: [{ textures: ["bg"] }] }), "utf8")
      },
      {
        name: "materials/bg.tex",
        data: buildTexB3Fixture(1920, 1080, 34, embeddedMp4)
      }
    ])
  );
  writeFileSync(join(wsDir, "preview.png"), createMinimalPngBuffer(512, 512));
  writeFileSync(
    join(wsDir, "project.json"),
    JSON.stringify({
      title: "Legacy Active Scene",
      type: "Scene",
      file: "scene.json",
      preview: "preview.png",
      contentrating: "Everyone"
    }),
    "utf8"
  );
  writeFileSync(
    join(dirLegacySteamScene, "appearance.json"),
    JSON.stringify({
      version: 1,
      wallpaper: {
        selectedId: "2966081148"
      }
    }),
    "utf8"
  );

  const authToken = "wave2-migration-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir: dirLegacySteamScene,
    authToken,
    steamRootsDiscoverer: async () => [steamRoot]
  });
  const ready = await daemon.start();
  cleanups.push(async () => {
    await daemon.stop();
  });

  // Real boot sequence: Web hydrates GET /v1/appearance FIRST (before /v1/wallpapers/inventory).
  // GET /v1/appearance must resolve the pending legacy Steam Scene ID -> advancedEngineEnabled: true immediately!
  const appResFirst = await fetch(`${ready.httpUrl}/v1/appearance`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assert.equal(appResFirst.status, 200);
  const appJsonFirst = (await appResFirst.json()) as {
    wallpaper?: { advancedEngineEnabled?: boolean; selectedWallpaperType?: string | null };
  };
  assert.equal(
    appJsonFirst.wallpaper?.advancedEngineEnabled,
    true,
    "GET /v1/appearance on first boot must auto-migrate legacy bare Steam Scene selectedId to advancedEngineEnabled: true"
  );
  assert.equal(appJsonFirst.wallpaper?.selectedWallpaperType, "scene");

  // Subsequent /v1/wallpapers/inventory returns sceneLiveSupported: true immediately
  const invRes = await fetch(`${ready.httpUrl}/v1/wallpapers/inventory`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assert.equal(invRes.status, 200);
  const inv = (await invRes.json()) as {
    items: Array<{ id: string; sceneLiveSupported: boolean }>;
  };
  assert.equal(inv.items.find((x) => x.id === "2966081148")?.sceneLiveSupported, true);
});

test("Wave 2: Web bridge intercepts requestAnimationFrame while paused and flushes on resume while preserving master mute", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "prismux-wp-rafpause-data-"));
  const steamRoot = mkdtempSync(join(tmpdir(), "prismux-wp-rafpause-steam-"));
  tempDirs.push(dataDir, steamRoot);

  const webDir = join(steamRoot, "steamapps", "workshop", "content", "431960", "991122");
  mkdirSync(webDir, { recursive: true });
  writeFileSync(
    join(webDir, "index.html"),
    "<!doctype html><html><head></head><body><canvas id='canvas'></canvas></body></html>",
    "utf8"
  );
  writeFileSync(
    join(webDir, "project.json"),
    JSON.stringify({ title: "rAF Pause Test", type: "Web", file: "index.html", contentrating: "Everyone" }),
    "utf8"
  );

  const authToken = "wave2-raf-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken,
    steamRootsDiscoverer: async () => [steamRoot]
  });
  const ready = await daemon.start();
  cleanups.push(async () => {
    await daemon.stop();
  });

  await fetch(`${ready.httpUrl}/v1/appearance`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ wallpaper: { advancedEngineEnabled: true } })
  });

  const htmlRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/991122/index.html`
  );
  assert.equal(htmlRes.status, 200);
  const html = await htmlRes.text();
  const scriptMatch = /<script data-pmx-we-bridge="1">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(scriptMatch && scriptMatch[1]);

  const realRafQueue = new Map<number, (ts: number) => void>();
  let nextRealRafId = 1;
  const listeners = new Map<string, Array<(ev: unknown) => void>>();
  const winObj: Record<string, unknown> = {
    location: { href: `${ready.httpUrl}/v1/wallpapers/web-t/${authToken}/991122/index.html` },
    parent: { postMessage: () => undefined },
    addEventListener: (type: string, cb: (ev: unknown) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(cb);
      listeners.set(type, list);
    },
    requestAnimationFrame: (cb: (ts: number) => void) => {
      const id = nextRealRafId++;
      realRafQueue.set(id, cb);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      realRafQueue.delete(id);
    },
    Audio: class {
      volume = 1;
      muted = false;
      paused = true;
      play() {
        this.paused = false;
        return Promise.resolve();
      }
      pause() {
        this.paused = true;
      }
      addEventListener() {}
    }
  };
  winObj["window"] = winObj;

  NodeVM.runInNewContext(scriptMatch[1], {
    window: winObj,
    document: {
      readyState: "complete",
      documentElement: { clientWidth: 1280, clientHeight: 720 },
      querySelectorAll: () => [],
      addEventListener: () => undefined
    },
    URL,
    queueMicrotask,
    setTimeout: () => 1,
    clearTimeout: () => undefined
  });

  // Drain any boot rAFs
  realRafQueue.clear();

  // Pause the web wallpaper via host postMessage
  for (const cb of listeners.get("message") ?? []) {
    cb({
      data: {
        type: "wallpaperPropertyListener",
        applyGeneralProperties: { paused: true },
        audio: { muted: true, volume: 0 }
      }
    });
  }

  const wrappedRaf = winObj["requestAnimationFrame"] as (cb: (ts: number) => void) => number;
  const wrappedCancel = winObj["cancelAnimationFrame"] as (id: number) => void;

  let keptRan = 0;
  let cancelledRan = 0;
  const keptId = wrappedRaf(() => {
    keptRan += 1;
  });
  const cancelledId = wrappedRaf(() => {
    cancelledRan += 1;
  });
  wrappedCancel(cancelledId);

  assert.equal(realRafQueue.size, 0, "while paused, wrapped rAF must NOT schedule real browser rAF ticks");
  assert.equal(keptRan, 0);
  assert.ok(keptId > 0);

  // Resume -> queued non-cancelled rAF flushes to real browser rAF
  for (const cb of listeners.get("message") ?? []) {
    cb({
      data: {
        type: "wallpaperPropertyListener",
        applyGeneralProperties: { paused: false },
        audio: { muted: true, volume: 0 }
      }
    });
  }
  assert.equal(realRafQueue.size, 1, "resuming must flush queued rAF callbacks");
  for (const [, cb] of Array.from(realRafQueue.entries())) {
    cb(2000);
  }
  assert.equal(keptRan, 1);
  assert.equal(cancelledRan, 0, "cancelled queued rAF callback must never execute on resume");
});

test("Web wallpaper bridge deduplicates and caps pausedRafQueue and prunes closed AudioContexts and detached media elements", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "prismux-wp-bridge-leaks-"));
  const steamRoot = mkdtempSync(join(tmpdir(), "prismux-wp-bridge-leaks-steam-"));
  tempDirs.push(dataDir, steamRoot);

  const webDir = join(steamRoot, "steamapps", "workshop", "content", "431960", "991133");
  mkdirSync(webDir, { recursive: true });
  writeFileSync(
    join(webDir, "index.html"),
    "<!doctype html><html><head><title>LeakGuard</title></head><body><canvas id='canvas'></canvas></body></html>",
    "utf8"
  );
  writeFileSync(
    join(webDir, "project.json"),
    JSON.stringify({ id: "991133", title: "Leak Guard Web", type: "web", file: "index.html" }),
    "utf8"
  );

  const authToken = "bridge-leak-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    authToken,
    steamRootsDiscoverer: async () => [steamRoot]
  });
  const ready = await daemon.start();
  cleanups.push(async () => {
    await daemon.stop();
  });

  await fetch(`${ready.httpUrl}/v1/appearance`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ wallpaper: { advancedEngineEnabled: true } })
  });

  const htmlRes = await fetch(
    `${ready.httpUrl}/v1/wallpapers/web-t/${encodeURIComponent(authToken)}/991133/index.html`
  );
  assert.equal(htmlRes.status, 200);
  const html = await htmlRes.text();
  const scriptMatch = /<script data-pmx-we-bridge="1">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(scriptMatch && scriptMatch[1]);

  const realRafQueue = new Map<number, (ts: number) => void>();
  let nextRealRafId = 1;
  const listeners = new Map<string, Array<(ev: unknown) => void>>();

  class TrackedFakeMedia {
    _vol = 1;
    _muted = false;
    paused = true;
    ended = false;
    loop = false;
    isConnected = false;
    volWriteCount = 0;
    mutedWriteCount = 0;
    private readonly mediaListeners = new Map<string, Array<() => void>>();
    get volume(): number {
      return this._vol;
    }
    set volume(v: number) {
      this._vol = v;
      this.volWriteCount += 1;
    }
    get muted(): boolean {
      return this._muted;
    }
    set muted(v: boolean) {
      this._muted = v;
      this.mutedWriteCount += 1;
    }
    play(): Promise<void> {
      this.paused = false;
      return Promise.resolve();
    }
    pause(): void {
      this.paused = true;
    }
    addEventListener(type: string, cb: () => void): void {
      const list = this.mediaListeners.get(type) ?? [];
      list.push(cb);
      this.mediaListeners.set(type, list);
    }
  }
  class TrackedFakeAudio extends TrackedFakeMedia {}
  class TrackedFakeAudioNode {
    context: TrackedFakeAudioContext;
    constructor(ctx: TrackedFakeAudioContext) {
      this.context = ctx;
    }
    connect(dest: unknown): unknown {
      return dest;
    }
  }
  class TrackedFakeGainNode extends TrackedFakeAudioNode {
    gain = { value: 1 };
  }
  class TrackedFakeAudioContext {
    destination = { isDestination: true };
    state: "running" | "suspended" | "closed" = "running";
    suspendCount = 0;
    resumeCount = 0;
    closeCount = 0;
    createGain(): TrackedFakeGainNode {
      return new TrackedFakeGainNode(this);
    }
    suspend(): Promise<void> {
      this.suspendCount += 1;
      this.state = "suspended";
      return Promise.resolve();
    }
    resume(): Promise<void> {
      this.resumeCount += 1;
      this.state = "running";
      return Promise.resolve();
    }
    close(): Promise<void> {
      this.closeCount += 1;
      this.state = "closed";
      return Promise.resolve();
    }
  }

  const winObj: Record<string, unknown> = {
    location: { href: `${ready.httpUrl}/v1/wallpapers/web-t/${authToken}/991133/index.html` },
    parent: { postMessage: () => undefined },
    addEventListener: (type: string, cb: (ev: unknown) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(cb);
      listeners.set(type, list);
    },
    requestAnimationFrame: (cb: (ts: number) => void) => {
      const id = nextRealRafId++;
      realRafQueue.set(id, cb);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      realRafQueue.delete(id);
    },
    Audio: TrackedFakeAudio,
    AudioContext: TrackedFakeAudioContext
  };
  winObj["window"] = winObj;

  NodeVM.runInNewContext(scriptMatch[1], {
    window: winObj,
    document: {
      readyState: "complete",
      documentElement: { clientWidth: 1280, clientHeight: 720 },
      querySelectorAll: () => [],
      addEventListener: () => undefined
    },
    HTMLMediaElement: TrackedFakeMedia,
    AudioNode: TrackedFakeAudioNode,
    URL,
    queueMicrotask,
    setTimeout: () => 1,
    clearTimeout: () => undefined
  });

  const emitMessage = (data: unknown) => {
    for (const cb of listeners.get("message") ?? []) {
      cb({ data });
    }
  };
  const wrappedRaf = winObj["requestAnimationFrame"] as (cb: (ts: number) => void) => number;
  const wrappedCancel = winObj["cancelAnimationFrame"] as (id: number) => void;

  // 1) Deduplicate repeated scheduling of the same callback while paused
  realRafQueue.clear();
  emitMessage({
    type: "wallpaperPropertyListener",
    applyGeneralProperties: { paused: true },
    audio: { muted: true, volume: 0 }
  });

  let sharedLoopRuns = 0;
  const sharedLoop = () => {
    sharedLoopRuns += 1;
  };
  for (let i = 0; i < 200; i += 1) {
    wrappedRaf(sharedLoop);
  }
  assert.equal(realRafQueue.size, 0);

  emitMessage({
    type: "wallpaperPropertyListener",
    applyGeneralProperties: { paused: false }
  });
  assert.equal(realRafQueue.size, 1, "identical paused rAF callbacks must deduplicate to 1");
  for (const [, cb] of Array.from(realRafQueue.entries())) {
    cb(100);
  }
  assert.equal(sharedLoopRuns, 1);

  // 2) Cap distinct anonymous rAF callbacks queued during pause at 64 (keeping newest)
  realRafQueue.clear();
  emitMessage({
    type: "wallpaperPropertyListener",
    applyGeneralProperties: { paused: true }
  });

  const executedIndices: number[] = [];
  let lastId = 0;
  for (let i = 0; i < 150; i += 1) {
    lastId = wrappedRaf(() => {
      executedIndices.push(i);
    });
  }
  // Cancel the last queued entry so 63 remain
  wrappedCancel(lastId);

  emitMessage({
    type: "wallpaperPropertyListener",
    applyGeneralProperties: { paused: false }
  });
  assert.equal(realRafQueue.size, 63, "distinct paused rAF queue must be capped at 64 (minus 1 cancelled)");
  for (const [, cb] of Array.from(realRafQueue.entries())) {
    cb(200);
  }
  assert.equal(executedIndices.length, 63);
  assert.equal(executedIndices[0], 86, "oldest callbacks beyond cap 64 must be evicted FIFO");
  assert.equal(executedIndices.at(-1), 148);

  // 3) Evict closed AudioContexts immediately via close() hook and on state === 'closed'
  const PatchedAudioCtx = winObj["AudioContext"] as typeof TrackedFakeAudioContext;
  const closedViaMethod = new PatchedAudioCtx();
  const closedExternally = new PatchedAudioCtx();
  const activeCtx = new PatchedAudioCtx();

  await closedViaMethod.close();
  assert.equal(closedViaMethod.closeCount, 1);
  const closedMethodSuspendBefore = closedViaMethod.suspendCount;
  const closedMethodResumeBefore = closedViaMethod.resumeCount;

  closedExternally.state = "closed";
  const closedExtSuspendBefore = closedExternally.suspendCount;
  const closedExtResumeBefore = closedExternally.resumeCount;

  emitMessage({ type: "prismuxWallpaperAudio", muted: false, volume: 0.7 });
  emitMessage({ type: "prismuxWallpaperAudio", muted: true, volume: 0 });
  emitMessage({ type: "prismuxWallpaperAudio", muted: false, volume: 0.5 });

  assert.equal(closedViaMethod.suspendCount, closedMethodSuspendBefore);
  assert.equal(closedViaMethod.resumeCount, closedMethodResumeBefore);
  assert.equal(closedExternally.suspendCount, closedExtSuspendBefore);
  assert.equal(closedExternally.resumeCount, closedExtResumeBefore);
  assert.ok(activeCtx.resumeCount >= 2, "active AudioContext must continue receiving master audio updates");

  // 4) Prune disconnected/ended media elements while retaining actively playing detached audio
  const PatchedAudio = winObj["Audio"] as typeof TrackedFakeAudio;
  const deadSfx = new PatchedAudio();
  deadSfx.ended = true;
  deadSfx.paused = true;
  deadSfx.isConnected = false;

  const activeBgm = new PatchedAudio();
  activeBgm.isConnected = false;
  await activeBgm.play();

  // First master audio sweep syncs and prunes deadSfx
  emitMessage({ type: "prismuxWallpaperAudio", muted: false, volume: 0.6 });
  const deadVolWritesAfterPrune = deadSfx.volWriteCount;
  const bgmVolWritesBefore = activeBgm.volWriteCount;

  // Subsequent sweeps must no longer touch pruned deadSfx, while still updating activeBgm
  emitMessage({ type: "prismuxWallpaperAudio", muted: false, volume: 0.3 });
  emitMessage({ type: "prismuxWallpaperAudio", muted: true, volume: 0 });

  assert.equal(
    deadSfx.volWriteCount,
    deadVolWritesAfterPrune,
    "pruned detached/ended media element must no longer be retained in trackedMedia"
  );
  assert.equal(
    activeBgm.volWriteCount,
    bgmVolWritesBefore + 2,
    "actively playing detached Audio must stay tracked"
  );
});
