import * as NodeAssert from "node:assert/strict";
import * as NodeBuffer from "node:buffer";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeVM from "node:vm";
import {
  inspectSteamScenePackage,
  renderSteamScenePlayerHtml,
  unwrapSceneValue
} from "../wallpapers/SteamScenePackage.js";

const assert: typeof NodeAssert = NodeAssert;
const { Buffer } = NodeBuffer;
const {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync
} = NodeFS;
const { tmpdir } = NodeOS;
const { join } = NodePath;
const { after, test } = NodeTest;

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface SyntheticPkgEntry {
  name: string;
  data: Buffer;
}

function buildSyntheticScenePkg(
  magic: string,
  entries: readonly SyntheticPkgEntry[]
): Buffer {
  const magicBuf = Buffer.from(magic, "utf8");
  const magicLenBuf = Buffer.alloc(4);
  magicLenBuf.writeInt32LE(magicBuf.byteLength, 0);

  const countBuf = Buffer.alloc(4);
  countBuf.writeInt32LE(entries.length, 0);

  const headerParts: Buffer[] = [magicLenBuf, magicBuf, countBuf];
  const dataParts: Buffer[] = [];
  let dataOffset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const nameLenBuf = Buffer.alloc(4);
    nameLenBuf.writeInt32LE(nameBuf.byteLength, 0);

    const metaBuf = Buffer.alloc(8);
    metaBuf.writeUInt32LE(dataOffset, 0);
    metaBuf.writeUInt32LE(entry.data.byteLength, 4);

    headerParts.push(nameLenBuf, nameBuf, metaBuf);
    dataParts.push(entry.data);
    dataOffset += entry.data.byteLength;
  }

  return Buffer.concat([...headerParts, ...dataParts]);
}

interface SyntheticTexOptions {
  texbVersion: "TEXB0001" | "TEXB0002" | "TEXB0003" | "TEXB0004";
  format?: number;
  flags?: number;
  texWidth: number;
  texHeight: number;
  imgWidth: number;
  imgHeight: number;
  freeImageFormat?: number;
  isVideoMp4?: number;
  lz4Flag?: number;
  uncompressedSize?: number;
  payload: Buffer;
}

function buildSyntheticTex(options: SyntheticTexOptions): Buffer {
  const parts: Buffer[] = [
    Buffer.from("TEXV0005\0", "ascii"),
    Buffer.from("TEXI0001\0", "ascii")
  ];

  const texiMeta = Buffer.alloc(28);
  texiMeta.writeInt32LE(options.format ?? 0, 0);
  texiMeta.writeInt32LE(options.flags ?? 2, 4);
  texiMeta.writeInt32LE(options.texWidth, 8);
  texiMeta.writeInt32LE(options.texHeight, 12);
  texiMeta.writeInt32LE(options.imgWidth, 16);
  texiMeta.writeInt32LE(options.imgHeight, 20);
  texiMeta.writeInt32LE(0, 24);
  parts.push(texiMeta);

  parts.push(Buffer.from(`${options.texbVersion}\0`, "ascii"));

  const imgCount = Buffer.alloc(4);
  imgCount.writeInt32LE(1, 0);
  parts.push(imgCount);

  if (options.texbVersion === "TEXB0003") {
    const freeImg = Buffer.alloc(4);
    freeImg.writeInt32LE(options.freeImageFormat ?? -1, 0);
    parts.push(freeImg);
  } else if (options.texbVersion === "TEXB0004") {
    const extra = Buffer.alloc(8);
    extra.writeInt32LE(options.freeImageFormat ?? -1, 0);
    extra.writeUInt32LE(options.isVideoMp4 ?? 0, 4);
    parts.push(extra);
  }

  const mipCount = Buffer.alloc(4);
  mipCount.writeInt32LE(1, 0);
  parts.push(mipCount);

  if (options.texbVersion === "TEXB0001") {
    const mipHdr = Buffer.alloc(12);
    mipHdr.writeInt32LE(options.imgWidth, 0);
    mipHdr.writeInt32LE(options.imgHeight, 4);
    mipHdr.writeInt32LE(options.payload.byteLength, 8);
    parts.push(mipHdr);
  } else {
    const mipHdr = Buffer.alloc(20);
    mipHdr.writeInt32LE(options.imgWidth, 0);
    mipHdr.writeInt32LE(options.imgHeight, 4);
    mipHdr.writeInt32LE(options.lz4Flag ?? 0, 8);
    mipHdr.writeInt32LE(options.uncompressedSize ?? 0, 12);
    mipHdr.writeInt32LE(options.payload.byteLength, 16);
    parts.push(mipHdr);
  }

  parts.push(options.payload);
  return Buffer.concat(parts);
}

function makeFakeMp4Payload(brand = "mp42"): Buffer {
  const ftyp = Buffer.alloc(24, 0);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write("ftyp", 4, 4, "ascii");
  ftyp.write(brand, 8, 4, "ascii");
  const body = Buffer.from("SYNTHETIC-MP4-STREAM-BYTES-0123456789ABCDEF", "ascii");
  return Buffer.concat([ftyp, body]);
}

function makeFakeJpegPayload(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00", "latin1"),
    Buffer.from([0xff, 0xd9])
  ]);
}

function makeFakePngPayload(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x0f, 0x00, 0x00, 0x00, 0x08, 0x70
  ]);
}

function makeFakeWebpPayload(): Buffer {
  return Buffer.from("RIFF\x18\x00\x00\x00WEBPVP8 \x0c\x00\x00\x000123456789ab", "latin1");
}

test("PKGV0017 + TEXB0003 embedded MP4 video texture, mask/LZ4 skip, audio slice, and zero-copy byte range", () => {
  const dir = mkdtempSync(join(tmpdir(), "prismux-scene-mp4-"));
  tempDirs.push(dir);
  const pkgPath = join(dir, "scene.pkg");

  const mp4Bytes = makeFakeMp4Payload("mp42");
  const mp3Bytes = Buffer.from("ID3\x03\x00\x00\x00\x00\x00\x00SYNTHETIC-MP3-DATA", "latin1");

  const pkgBuf = buildSyntheticScenePkg("PKGV0017", [
    {
      name: "scene.json",
      data: Buffer.from(
        JSON.stringify({
          general: { orthogonalprojection: { width: 2560, height: 1798 } },
          objects: [
            {
              name: "hero_video",
              image: "models/hero.json",
              visible: true,
              origin: "1280.00000 899.00000 0.00000",
              scale: "1.00000 1.00000 1.00000",
              size: "2560.00000 1798.00000",
              alpha: 1
            },
            {
              name: "hidden_layer",
              image: "models/hero.json",
              visible: { user: "toggle_hidden", value: false },
              origin: "1280 899 0",
              size: "2560 1798"
            },
            {
              name: "particle_fog",
              visible: true,
              origin: "1280 899 0"
            },
            {
              name: "bgm_track",
              sound: ["sounds/theme.mp3"]
            }
          ]
        }),
        "utf8"
      )
    },
    {
      name: "models/hero.json",
      data: Buffer.from(JSON.stringify({ material: "materials/hero.json" }), "utf8")
    },
    {
      name: "materials/hero.json",
      data: Buffer.from(
        JSON.stringify({ passes: [{ textures: ["hero"] }] }),
        "utf8"
      )
    },
    {
      name: "materials/hero.tex",
      data: buildSyntheticTex({
        texbVersion: "TEXB0003",
        flags: 34,
        texWidth: 2560,
        texHeight: 1798,
        imgWidth: 2560,
        imgHeight: 1798,
        freeImageFormat: -1,
        payload: mp4Bytes
      })
    },
    {
      name: "materials/masks/waterwaves_mask_1.tex",
      data: buildSyntheticTex({
        texbVersion: "TEXB0003",
        format: 9,
        flags: 2,
        texWidth: 1920,
        texHeight: 1080,
        imgWidth: 1920,
        imgHeight: 1080,
        lz4Flag: 1,
        uncompressedSize: 2073600,
        payload: Buffer.alloc(64, 0x1f)
      })
    },
    {
      name: "sounds/theme.mp3",
      data: mp3Bytes
    }
  ]);

  writeFileSync(pkgPath, pkgBuf);

  const manifest = inspectSteamScenePackage(pkgPath);
  assert.ok(manifest);
  assert.equal(manifest.pkgMagic, "PKGV0017");
  assert.equal(manifest.orthoWidth, 2560);
  assert.equal(manifest.orthoHeight, 1798);
  assert.equal(manifest.width, 2560);
  assert.equal(manifest.height, 1798);
  assert.equal(manifest.hasVideo, true);
  assert.equal(manifest.layers.length, 1);
  assert.equal(manifest.sounds.length, 1);

  const videoLayer = manifest.layers[0]!;
  assert.equal(videoLayer.kind, "video");
  const videoSlice = manifest.assets[videoLayer.assetIndex]!;
  assert.equal(videoSlice.kind, "video");
  assert.equal(videoSlice.mimeType, "video/mp4");
  assert.equal(videoSlice.byteLength, mp4Bytes.byteLength);

  // Verify exact zero-copy slice inside scene.pkg matches the original MP4 bytes
  const extractedMp4 = pkgBuf.subarray(
    videoSlice.byteStart,
    videoSlice.byteStart + videoSlice.byteLength
  );
  assert.deepEqual(extractedMp4, mp4Bytes);

  const soundSlice = manifest.assets[manifest.sounds[0]!.assetIndex]!;
  assert.equal(soundSlice.kind, "audio");
  assert.equal(soundSlice.mimeType, "audio/mpeg");
  assert.deepEqual(
    pkgBuf.subarray(soundSlice.byteStart, soundSlice.byteStart + soundSlice.byteLength),
    mp3Bytes
  );

  const html = renderSteamScenePlayerHtml(manifest, "Shiroko 2K");
  assert.match(html, /style="background:#000"/);
  assert.match(html, /data-pmx-scene-player="1"/);
  assert.match(html, /prismuxWallpaperAudio/);
  assert.match(html, /prismuxWebReady/);
  assert.match(html, /prismuxWeBridgeReady/);
});

test("PKGV0023 + TEXB0004 multi-layer scene.json Y-up coordinate conversion, wrapped property values, and FLAC audio", () => {
  const dir = mkdtempSync(join(tmpdir(), "prismux-scene-layers-"));
  tempDirs.push(dir);
  const pkgPath = join(dir, "scene.pkg");

  const bgJpeg = makeFakeJpegPayload();
  const fgPng = makeFakePngPayload();
  const flacBytes = Buffer.from("fLaC\x00\x00\x00\x22SYNTHETIC-FLAC-STREAM", "latin1");

  const pkgBuf = buildSyntheticScenePkg("PKGV0023", [
    {
      name: "scene.json",
      data: Buffer.from(
        JSON.stringify({
          general: { orthogonalprojection: { width: 3840, height: 2160 } },
          objects: [
            {
              name: "bg_layer",
              image: "models/bg.json",
              origin: { user: "pos_bg", value: "1920.0 1080.0 0.0" },
              scale: { value: "1.0 1.0 1.0" },
              size: "3840.0 2160.0",
              alpha: { value: 1 },
              parallaxDepth: "0.2 0.2",
              effects: [{ file: "effects/foliagesway/effect.json" }]
            },
            {
              name: "halo_top",
              image: "models/halo.json",
              visible: { user: "show_halo", value: true },
              origin: "2050.0 1900.0 0.0",
              size: "1100.0 520.0",
              parallaxDepth: "0.6 0.4",
              effects: [{ file: "effects/lightshafts/effect.json" }]
            },
            {
              name: "zero_scale_visualizer",
              image: "models/halo.json",
              scale: "0 0 0",
              size: "8 8"
            },
            {
              name: "zero_alpha_hidden",
              image: "models/halo.json",
              alpha: { value: 0 },
              size: "100 100"
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
      data: buildSyntheticTex({
        texbVersion: "TEXB0004",
        texWidth: 4096,
        texHeight: 4096,
        imgWidth: 3840,
        imgHeight: 2160,
        freeImageFormat: 2,
        isVideoMp4: 0,
        payload: bgJpeg
      })
    },
    {
      name: "models/halo.json",
      data: Buffer.from(JSON.stringify({ material: "materials/halo.json" }), "utf8")
    },
    {
      name: "materials/halo.json",
      data: Buffer.from(JSON.stringify({ passes: [{ textures: ["halo"] }] }), "utf8")
    },
    {
      name: "materials/halo.tex",
      data: buildSyntheticTex({
        texbVersion: "TEXB0004",
        texWidth: 2048,
        texHeight: 1024,
        imgWidth: 1100,
        imgHeight: 520,
        freeImageFormat: 13,
        isVideoMp4: 0,
        payload: fgPng
      })
    },
    {
      name: "sounds/ambient.flac",
      data: flacBytes
    }
  ]);

  writeFileSync(pkgPath, pkgBuf);

  assert.equal(unwrapSceneValue({ user: "a", value: { value: "nested" } }), "nested");

  const manifest = inspectSteamScenePackage(pkgPath);
  assert.ok(manifest);
  assert.equal(manifest.pkgMagic, "PKGV0023");
  assert.equal(manifest.hasVideo, false);
  assert.equal(manifest.layers.length, 2);
  assert.equal(manifest.sounds.length, 1);
  assert.equal(manifest.sounds[0]!.mimeType, "audio/flac");

  const bgLayer = manifest.layers[0]!;
  const haloLayer = manifest.layers[1]!;
  assert.equal(bgLayer.name, "bg_layer");
  assert.equal(manifest.assets[bgLayer.assetIndex]!.mimeType, "image/jpeg");
  assert.deepEqual(bgLayer.effects, ["foliagesway"]);

  assert.equal(haloLayer.name, "halo_top");
  assert.equal(manifest.assets[haloLayer.assetIndex]!.mimeType, "image/png");
  assert.equal(haloLayer.originX, 2050);
  assert.equal(haloLayer.originY, 1900);
  assert.deepEqual(haloLayer.effects, ["lightshafts"]);

  // Verify HTML embeds converted topY = orthoHeight - originY = 2160 - 1900 = 260
  const html = renderSteamScenePlayerHtml(manifest, "Multi Layer");
  assert.match(html, /"topY":260/);
  assert.match(html, /"topY":1080/);
});

test("Fallback to largest non-mask .tex when scene.json is corrupt or empty, and safe null on corrupt packages", () => {
  const dir = mkdtempSync(join(tmpdir(), "prismux-scene-fallback-"));
  tempDirs.push(dir);

  const fallbackPkg = join(dir, "fallback.pkg");
  const smallPng = makeFakePngPayload();
  const largeWebp = makeFakeWebpPayload();
  writeFileSync(
    fallbackPkg,
    buildSyntheticScenePkg("PKGV0021", [
      { name: "scene.json", data: Buffer.from("{not-valid-json", "utf8") },
      {
        name: "materials/small.tex",
        data: buildSyntheticTex({
          texbVersion: "TEXB0001",
          texWidth: 512,
          texHeight: 512,
          imgWidth: 512,
          imgHeight: 512,
          payload: smallPng
        })
      },
      {
        name: "materials/hero_large.tex",
        data: buildSyntheticTex({
          texbVersion: "TEXB0002",
          texWidth: 4096,
          texHeight: 2160,
          imgWidth: 3840,
          imgHeight: 2160,
          payload: largeWebp
        })
      }
    ])
  );

  const manifest = inspectSteamScenePackage(fallbackPkg);
  assert.ok(manifest);
  assert.equal(manifest.width, 3840);
  assert.equal(manifest.height, 2160);
  assert.equal(manifest.layers.length, 1);
  assert.equal(manifest.assets[manifest.layers[0]!.assetIndex]!.mimeType, "image/webp");

  // Corrupt, truncated, and non-PKGV files must never throw
  const badMagicPath = join(dir, "bad.pkg");
  writeFileSync(badMagicPath, Buffer.from("NOT_A_PKG_FILE_1234567890", "utf8"));
  assert.equal(inspectSteamScenePackage(badMagicPath), null);

  const truncatedPath = join(dir, "truncated.pkg");
  writeFileSync(truncatedPath, Buffer.from([0x08, 0x00, 0x00, 0x00, 0x50, 0x4b, 0x47, 0x56]));
  assert.equal(inspectSteamScenePackage(truncatedPath), null);

  assert.equal(inspectSteamScenePackage(join(dir, "does-not-exist.pkg")), null);
});

test("Puppet/bone-mesh scenes return null unless backed by a non-puppet video layer", () => {
  const dir = mkdtempSync(join(tmpdir(), "prismux-scene-puppet-"));
  tempDirs.push(dir);

  const puppetOnlyPkg = join(dir, "puppet-only.pkg");
  writeFileSync(
    puppetOnlyPkg,
    buildSyntheticScenePkg("PKGV0021", [
      {
        name: "scene.json",
        data: Buffer.from(
          JSON.stringify({
            general: { orthogonalprojection: { width: 3840, height: 2160 } },
            objects: [
              {
                name: "character_puppet",
                image: "models/character.json",
                origin: "1920 1080 0",
                size: "3840 2160"
              },
              {
                name: "branch_overlay",
                image: "models/branch.json",
                origin: "1920 400 0",
                size: "3840 818"
              }
            ]
          }),
          "utf8"
        )
      },
      {
        name: "models/character.json",
        data: Buffer.from(
          JSON.stringify({
            material: "materials/character.json",
            puppet: "models/character_puppet.mdl"
          }),
          "utf8"
        )
      },
      {
        name: "materials/character.json",
        data: Buffer.from(JSON.stringify({ passes: [{ textures: ["character"] }] }), "utf8")
      },
      {
        name: "materials/character.tex",
        data: buildSyntheticTex({
          texbVersion: "TEXB0004",
          texWidth: 4096,
          texHeight: 4096,
          imgWidth: 3840,
          imgHeight: 2160,
          payload: makeFakePngPayload()
        })
      },
      {
        name: "models/branch.json",
        data: Buffer.from(JSON.stringify({ material: "materials/branch.json" }), "utf8")
      },
      {
        name: "materials/branch.json",
        data: Buffer.from(JSON.stringify({ passes: [{ textures: ["branch"] }] }), "utf8")
      },
      {
        name: "materials/branch.tex",
        data: buildSyntheticTex({
          texbVersion: "TEXB0004",
          texWidth: 4096,
          texHeight: 1024,
          imgWidth: 3840,
          imgHeight: 818,
          payload: makeFakePngPayload()
        })
      }
    ])
  );
  assert.equal(inspectSteamScenePackage(puppetOnlyPkg), null);

  // Even when ALL objects are puppet models (layers.length === 0), never fallback-scan raw .tex files
  const purePuppetPkg = join(dir, "pure-puppet.pkg");
  writeFileSync(
    purePuppetPkg,
    buildSyntheticScenePkg("PKGV0021", [
      {
        name: "scene.json",
        data: Buffer.from(
          JSON.stringify({
            general: { orthogonalprojection: { width: 1920, height: 1080 } },
            objects: [
              {
                name: "solo_puppet",
                image: "models/solo_puppet.json",
                origin: "960 540 0",
                size: "1920 1080"
              }
            ]
          }),
          "utf8"
        )
      },
      {
        name: "models/solo_puppet.json",
        data: Buffer.from(
          JSON.stringify({
            material: "materials/solo_puppet.json",
            puppet: "models/solo_puppet.mdl"
          }),
          "utf8"
        )
      },
      {
        name: "materials/solo_puppet.json",
        data: Buffer.from(JSON.stringify({ passes: [{ textures: ["solo_puppet"] }] }), "utf8")
      },
      {
        name: "materials/solo_puppet.tex",
        data: buildSyntheticTex({
          texbVersion: "TEXB0004",
          texWidth: 2048,
          texHeight: 2048,
          imgWidth: 1920,
          imgHeight: 1080,
          payload: makeFakePngPayload()
        })
      }
    ])
  );
  assert.equal(inspectSteamScenePackage(purePuppetPkg), null);

  // When a non-puppet video layer exists alongside a puppet model, keep ONLY the video layer
  const puppetWithVideoPkg = join(dir, "puppet-with-video.pkg");
  writeFileSync(
    puppetWithVideoPkg,
    buildSyntheticScenePkg("PKGV0021", [
      {
        name: "scene.json",
        data: Buffer.from(
          JSON.stringify({
            general: { orthogonalprojection: { width: 1920, height: 1080 } },
            objects: [
              {
                name: "bg_video",
                image: "models/bg_video.json",
                origin: "960 540 0",
                size: "1920 1080"
              },
              {
                name: "overlay_puppet",
                image: "models/solo_puppet.json",
                origin: "960 540 0",
                size: "800 800"
              }
            ]
          }),
          "utf8"
        )
      },
      {
        name: "models/bg_video.json",
        data: Buffer.from(JSON.stringify({ material: "materials/bg_video.json" }), "utf8")
      },
      {
        name: "materials/bg_video.json",
        data: Buffer.from(JSON.stringify({ passes: [{ textures: ["bg_video"] }] }), "utf8")
      },
      {
        name: "materials/bg_video.tex",
        data: buildSyntheticTex({
          texbVersion: "TEXB0004",
          flags: 34,
          isVideoMp4: 1,
          texWidth: 1920,
          texHeight: 1080,
          imgWidth: 1920,
          imgHeight: 1080,
          payload: makeFakeMp4Payload()
        })
      },
      {
        name: "models/solo_puppet.json",
        data: Buffer.from(
          JSON.stringify({
            material: "materials/solo_puppet.json",
            puppet: "models/solo_puppet.mdl"
          }),
          "utf8"
        )
      },
      {
        name: "materials/solo_puppet.json",
        data: Buffer.from(JSON.stringify({ passes: [{ textures: ["solo_puppet"] }] }), "utf8")
      },
      {
        name: "materials/solo_puppet.tex",
        data: buildSyntheticTex({
          texbVersion: "TEXB0004",
          texWidth: 1024,
          texHeight: 1024,
          imgWidth: 800,
          imgHeight: 800,
          payload: makeFakePngPayload()
        })
      }
    ])
  );
  const videoManifest = inspectSteamScenePackage(puppetWithVideoPkg);
  assert.ok(videoManifest);
  assert.equal(videoManifest.hasVideo, true);
  assert.equal(videoManifest.layers.length, 1);
  assert.equal(videoManifest.layers[0]!.name, "bg_video");
});

test("DXT/compressed primary backdrop without full-frame replacement returns null", () => {
  const dir = mkdtempSync(join(tmpdir(), "prismux-scene-dxt-backdrop-"));
  tempDirs.push(dir);

  const dxtPayload = Buffer.alloc(64, 0xab); // Raw GPU-compressed DXT5 bytes (not PNG/JPEG/MP4)

  const partialScenePkg = join(dir, "dxt-partial.pkg");
  writeFileSync(
    partialScenePkg,
    buildSyntheticScenePkg("PKGV0021", [
      {
        name: "scene.json",
        data: Buffer.from(
          JSON.stringify({
            general: { orthogonalprojection: { width: 3840, height: 2160 } },
            objects: [
              {
                name: "dxt_backdrop",
                image: "models/bg.json",
                origin: "1920 1080 0",
                size: "3840 2160"
              },
              {
                name: "partial_branch",
                image: "models/branch.json",
                origin: "1920 400 0",
                size: "3840 818"
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
        data: buildSyntheticTex({
          texbVersion: "TEXB0004",
          format: 4, // DXT5
          texWidth: 4096,
          texHeight: 2160,
          imgWidth: 3840,
          imgHeight: 2160,
          payload: dxtPayload
        })
      },
      {
        name: "models/branch.json",
        data: Buffer.from(JSON.stringify({ material: "materials/branch.json" }), "utf8")
      },
      {
        name: "materials/branch.json",
        data: Buffer.from(JSON.stringify({ passes: [{ textures: ["branch"] }] }), "utf8")
      },
      {
        name: "materials/branch.tex",
        data: buildSyntheticTex({
          texbVersion: "TEXB0004",
          texWidth: 4096,
          texHeight: 1024,
          imgWidth: 3840,
          imgHeight: 818,
          payload: makeFakePngPayload()
        })
      }
    ])
  );
  assert.equal(inspectSteamScenePackage(partialScenePkg), null);

  // If a decoded full-frame opaque image layer (>= 85% ortho area) exists, allow rendering
  const coveredScenePkg = join(dir, "dxt-with-opaque-bg.pkg");
  writeFileSync(
    coveredScenePkg,
    buildSyntheticScenePkg("PKGV0021", [
      {
        name: "scene.json",
        data: Buffer.from(
          JSON.stringify({
            general: { orthogonalprojection: { width: 3840, height: 2160 } },
            objects: [
              {
                name: "dxt_backdrop",
                image: "models/bg.json",
                origin: "1920 1080 0",
                size: "3840 2160"
              },
              {
                name: "opaque_full_frame",
                image: "models/full.json",
                origin: "1920 1080 0",
                size: "3840 2160",
                alpha: 1
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
        data: buildSyntheticTex({
          texbVersion: "TEXB0004",
          format: 4,
          texWidth: 4096,
          texHeight: 2160,
          imgWidth: 3840,
          imgHeight: 2160,
          payload: dxtPayload
        })
      },
      {
        name: "models/full.json",
        data: Buffer.from(JSON.stringify({ material: "materials/full.json" }), "utf8")
      },
      {
        name: "materials/full.json",
        data: Buffer.from(JSON.stringify({ passes: [{ textures: ["full"] }] }), "utf8")
      },
      {
        name: "materials/full.tex",
        data: buildSyntheticTex({
          texbVersion: "TEXB0004",
          texWidth: 4096,
          texHeight: 2160,
          imgWidth: 3840,
          imgHeight: 2160,
          payload: makeFakeJpegPayload()
        })
      }
    ])
  );
  const coveredManifest = inspectSteamScenePackage(coveredScenePkg);
  assert.ok(coveredManifest);
  assert.equal(coveredManifest.layers.length, 1);
  assert.equal(coveredManifest.layers[0]!.name, "opaque_full_frame");
});

test("8K scene player uses viewport-scaled CSS stage, percentage layers, no will-change, sync img decoding, and img.decode() gate", async () => {
  const manifest = {
    pkgPath: "synthetic-8k.pkg",
    pkgMagic: "PKGV0023",
    pkgFileSize: 1024,
    pkgMtimeMs: 1,
    orthoWidth: 7680,
    orthoHeight: 4320,
    width: 7680,
    height: 4320,
    hasVideo: false,
    layers: [
      {
        name: "bg_8k",
        assetIndex: 0,
        kind: "image" as const,
        originX: 3840,
        originY: 2160,
        width: 7680,
        height: 4320,
        scaleX: 1,
        scaleY: 1,
        angleZ: 0,
        alpha: 1,
        parallaxX: 0.5,
        parallaxY: 0.5,
        effects: ["foliagesway"]
      },
      {
        name: "accent_top",
        assetIndex: 1,
        kind: "image" as const,
        originX: 1920,
        originY: 3240,
        width: 3840,
        height: 1080,
        scaleX: 1,
        scaleY: 1,
        angleZ: 0,
        alpha: 0.9,
        parallaxX: 0.8,
        parallaxY: 0.6,
        effects: []
      }
    ],
    sounds: [],
    assets: []
  };

  const html = renderSteamScenePlayerHtml(manifest, "8K Test Scene");
  assert.doesNotMatch(html, /will-change\s*:\s*transform/i);
  assert.doesNotMatch(html, /decoding\s*=\s*["']async["']/i);
  assert.match(html, /img\.decoding\s*=\s*["']sync["']/);
  assert.match(html, /img\.decode/);
  assert.doesNotMatch(html, /stageEl\.style\.width\s*=\s*scene\.orthoWidth/);

  const scriptMatch = /<script data-pmx-scene-player="1">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(scriptMatch && scriptMatch[1]);

  interface FakeNode {
    tagName: string;
    id: string;
    className: string;
    style: Record<string, string>;
    children: FakeNode[];
    listeners: Map<string, Array<() => void>>;
    decoding?: string;
    alt?: string;
    src?: string;
    complete?: boolean;
    naturalWidth?: number;
    decode?: () => Promise<void>;
    appendChild: (child: FakeNode) => FakeNode;
    addEventListener: (type: string, cb: () => void) => void;
  }

  let resolveDecode!: () => void;
  let decodeCalls = 0;
  const createdImgs: FakeNode[] = [];
  const makeEl = (tag: string): FakeNode => {
    const node: FakeNode = {
      tagName: tag.toUpperCase(),
      id: "",
      className: "",
      style: {},
      children: [],
      listeners: new Map(),
      appendChild(child: FakeNode) {
        this.children.push(child);
        return child;
      },
      addEventListener(type: string, cb: () => void) {
        const arr = this.listeners.get(type) ?? [];
        arr.push(cb);
        this.listeners.set(type, arr);
      }
    };
    if (tag === "img") {
      node.complete = false;
      node.naturalWidth = 0;
      node.decode = () => {
        decodeCalls += 1;
        return new Promise<void>((res) => {
          resolveDecode = res;
        });
      };
      createdImgs.push(node);
    }
    return node;
  };

  const viewportEl = makeEl("div");
  viewportEl.id = "pmx-viewport";
  const posted: Array<{ type?: string }> = [];
  const rafQueue: Array<(ts: number) => void> = [];

  const fakeWin: Record<string, unknown> = {
    innerWidth: 1280,
    innerHeight: 720,
    matchMedia: () => ({ matches: false }),
    parent: {
      postMessage: (msg: { type?: string }) => {
        posted.push(msg);
      }
    },
    addEventListener: () => undefined
  };
  fakeWin["window"] = fakeWin;

  NodeVM.runInNewContext(scriptMatch[1], {
    window: fakeWin,
    document: {
      readyState: "complete",
      documentElement: { clientWidth: 1280, clientHeight: 720 },
      getElementById: (id: string) => (id === "pmx-viewport" ? viewportEl : null),
      createElement: makeEl,
      addEventListener: () => undefined
    },
    requestAnimationFrame: (cb: (ts: number) => void) => {
      rafQueue.push(cb);
      return rafQueue.length;
    },
    cancelAnimationFrame: () => undefined,
    queueMicrotask,
    setTimeout: () => 1,
    clearTimeout: () => undefined
  });

  // Verify stage is viewport-scaled (~1305.60px x 734.40px with 1.02 cover overscan), NEVER 7680px x 4320px
  const stageEl = viewportEl.children[0]!;
  assert.equal(stageEl.id, "pmx-stage");
  assert.equal(stageEl.style["width"], "1305.60px");
  assert.equal(stageEl.style["height"], "734.40px");
  assert.equal(stageEl.style["transform"], "translate(-50%,-50%)");

  // Verify percentage positioning inside #pmx-stage
  const bgLayer = stageEl.children[0]!;
  assert.equal(bgLayer.style["left"], "50%");
  assert.equal(bgLayer.style["top"], "50%");
  assert.equal(bgLayer.style["width"], "100%");
  assert.equal(bgLayer.style["height"], "100%");

  const accentLayer = stageEl.children[1]!;
  assert.equal(accentLayer.style["left"], "25%");
  assert.equal(accentLayer.style["top"], "25%");
  assert.equal(accentLayer.style["width"], "50%");
  assert.equal(accentLayer.style["height"], "25%");

  // Verify img.decoding === "sync" and prismuxWebReady waits until BOTH load AND decode() finish
  assert.equal(createdImgs[0]!.decoding, "sync");
  assert.equal(
    posted.some((m) => m.type === "prismuxWebReady"),
    false
  );
  for (const cb of createdImgs[0]!.listeners.get("load") ?? []) {
    cb();
  }
  assert.equal(decodeCalls, 1);
  await Promise.resolve();
  assert.equal(
    posted.some((m) => m.type === "prismuxWebReady"),
    false,
    "prismuxWebReady must wait until img.decode() resolves"
  );
  resolveDecode();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    posted.some((m) => m.type === "prismuxWebReady"),
    true,
    "prismuxWebReady must fire once img.decode() resolves"
  );

  // Verify rAF tick parallax/breathe deltas use screen CSS stageW/stageH (NOT raw 7680/4320)
  assert.ok(rafQueue.length >= 1);
  rafQueue[0]!(1500);
  const tf = bgLayer.style["transform"] ?? "";
  const match = /translate3d\(([-\d.]+)px,([-\d.]+)px,0\)/.exec(tf);
  assert.ok(match, `Expected translate3d in transform, got: ${tf}`);
  assert.ok(
    Math.abs(Number(match[1])) < 5 && Math.abs(Number(match[2])) < 5,
    `Expected screen-scaled breathe delta (< 5px), got dx=${match[1]}, dy=${match[2]}`
  );
});

test("Conditional real-world verification on local Steam 431960 scene.pkg archives", () => {
  const workshopRoot = "D:\\Steam\\steamapps\\workshop\\content\\431960";
  if (!existsSync(workshopRoot)) {
    return;
  }

  const realSceneIds = [
    "2838708921",
    "2966081148",
    "3133869533",
    "3203893474",
    "3258789456",
    "3284978684",
    "3294160041",
    "3294725369",
    "3342381863",
    "3404976219",
    "3669681034"
  ];
  const expectedVideoIds = new Set(["2966081148", "3133869533", "3342381863"]);

  let checkedCount = 0;
  for (const id of realSceneIds) {
    const pkgPath = join(workshopRoot, id, "scene.pkg");
    if (!existsSync(pkgPath)) {
      continue;
    }
    checkedCount += 1;
    const manifest = inspectSteamScenePackage(pkgPath);

    if (id === "3404976219") {
      assert.equal(
        manifest,
        null,
        "Expected null for puppet-mesh + DXT5-backdrop scene 3404976219 so preview fallback is used"
      );
      continue;
    }

    assert.ok(manifest, `Expected manifest for real Steam scene ${id}`);
    assert.ok(manifest.layers.length >= 1, `Expected >=1 layer for ${id}`);
    assert.ok(manifest.width > 512 && manifest.height > 512, `Expected true dimensions for ${id}`);

    if (expectedVideoIds.has(id)) {
      assert.equal(manifest.hasVideo, true, `Expected MP4 video layer for ${id}`);
      const vidSlice = manifest.assets.find((a) => a.kind === "video");
      assert.ok(vidSlice);
      assert.equal(vidSlice.mimeType, "video/mp4");
      const fd = openSync(pkgPath, "r");
      try {
        const probe = Buffer.alloc(12);
        readSync(fd, probe, 0, 12, vidSlice.byteStart);
        assert.equal(probe.subarray(4, 8).toString("ascii"), "ftyp");
      } finally {
        closeSync(fd);
      }
    }

    if (id === "3669681034") {
      assert.equal(manifest.pkgMagic, "PKGV0023");
      assert.equal(manifest.width, 7680);
      assert.equal(manifest.height, 4320);
      assert.equal(manifest.sounds.length, 3);
      const html = renderSteamScenePlayerHtml(manifest, "8K Real Scene");
      assert.doesNotMatch(html, /will-change\s*:\s*transform/i);
      assert.match(html, /img\.decoding\s*=\s*["']sync["']/);
    }
  }

  assert.ok(checkedCount > 0);
});
