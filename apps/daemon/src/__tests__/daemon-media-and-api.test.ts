import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { gzipSync } from "node:zlib";
import { CHIEF_PROVIDER_KINDS, OFFICIAL_PLUGIN_IDS } from "@prismux/protocol";
import { WebSocketServer } from "ws";
import {
  AppearanceConfigStore,
  BUILTIN_WEBWALLGL_WALLPAPERS,
  createDefaultAppearanceConfig,
  PrismuxDaemon,
  parseWindowsRegistryFontOutput,
  SystemFontService
} from "../index.js";

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
  assert.equal(updaterStatus.currentVersion, "0.2.0-rc.1");
  assert.equal(updaterStatus.policy.routePreference, "domestic");
  assert.equal(updaterStatus.policy.includePrerelease, false);

  const healthCheckRes = await fetch(`${ready.httpUrl}/health`);
  assert.equal(healthCheckRes.status, 200);
  assert.equal(((await healthCheckRes.json()) as { version: string }).version, "0.2.0-rc.1");
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

  const startedAt = Date.now();
  const ready = await daemon.start();
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

  const deadline = Date.now() + 6_000;
  let reconnected = false;
  while (Date.now() < deadline) {
    const hRes = await fetch(`${ready.httpUrl}/health`);
    const hJson = (await hRes.json()) as { t3Connected: boolean };
    if (hJson.t3Connected && sawChiefEnsure) {
      reconnected = true;
      break;
    }
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
