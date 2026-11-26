import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

const assert: typeof NodeAssert = NodeAssert;
const { mkdtemp, mkdir, readFile, rm, writeFile } = NodeFSP;
const { createServer } = NodeHttp;
type AddressInfo = NodeNet.AddressInfo;
const { tmpdir } = NodeOS;
const { dirname, join } = NodePath;
const { describe, it } = NodeTest;
const { fileURLToPath } = NodeURL;
import {
  closeInlineAppearanceInStore,
  openInlineAppearanceInStore,
  QP_VIRTUALIZE_THRESHOLD,
  resolveQuickPanelTab,
} from "../WallpaperQuickPanel.js";
import {
  applyVideoAudio,
  buildWebWallpaperAudioPayload,
  buildWebWallpaperListenerPayload,
  computeWallpaperStageStyles,
  dispatchWebWallpaperRuntimeState,
  disposeVideoElement,
  resolveEffectiveLiveFps,
  silenceAndBlankIframe,
  WATCHDOG_BACKOFF_MS,
} from "../WallpaperStage.js";
import {
  SETTINGS_VIRTUALIZE_THRESHOLD,
  SETTINGS_VP_FIRST,
} from "../WallpaperSettingsView.js";
import {
  importLocalWallpaperFile,
  isPathInsideDir,
  parseByteRange,
  parseLibraryFoldersVdf,
  prepareMediaRangeResponse,
  readVideoDimensions,
  resolveSafeMediaPath,
  scanCustomWallpaperDir,
  scanSteamWorkshop431960,
  serveMediaFileWithRange,
} from "../node/index.js";
import {
  computeFilterCounts,
  computeVirtualWindow,
  createWallpaperStore,
  filterPlayableWallpapers,
  filterVisibleWallpapers,
  findWallpaperById,
  isAdvancedWallpaperType,
  isWallpaperGatedByEngine,
  normalizeWallpaperFadeOpacity,
  normalizeWallpaperScrim,
  pickNextWallpaperId,
  resolveRotationCandidates,
} from "../store.js";
import {
  BUILTIN_WEBWALLGL_SCENES,
  createBuiltinWallpapers,
  createDefaultSettings,
} from "../defaults.js";
import type { StorageLike } from "../store.js";
import type { WallpaperItem } from "../types.js";
import { weColorToHex, weEvalCondition, weHexToColor } from "../userProps.js";

/** Build a valid minimal PNG header buffer with exact width & height (pure bytes, zero deps). */
function makeMinimalPng(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  // PNG signature
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  // IHDR chunk length = 13
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8; // bit depth
  buf[25] = 2; // color type RGB
  return buf;
}

function createMemoryStorage(): StorageLike & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    dump: () => Object.fromEntries(map.entries()),
  };
}

describe("@prismux/wallpaper — Node Steam Workshop 431960 & Security Scanner", () => {
  it("parses Steam libraryfolders.vdf across multiple drives and prioritizes app 431960", () => {
    const vdf = `
"libraryfolders"
{
  "0"
  {
    "path"    "C:\\\\Program Files (x86)\\\\Steam"
    "apps"
    {
      "730"   "12345"
    }
  }
  "1"
  {
    "path"    "D:\\\\SteamLibrary"
    "apps"
    {
      "431960" "987654"
    }
  }
  "2"
  {
    "path"    "E:\\\\Games\\\\SteamLib"
    "apps"
    {
      "570"   "55555"
    }
  }
}
`;
    const libs = parseLibraryFoldersVdf(vdf);
    assert.equal(libs[0], "D:\\SteamLibrary");
    assert.ok(libs.includes("C:\\Program Files (x86)\\Steam"));
    assert.ok(libs.includes("E:\\Games\\SteamLib"));

    const only431960 = parseLibraryFoldersVdf(vdf, { includeAllLibraries: false });
    assert.deepEqual(only431960, ["D:\\SteamLibrary"]);
  });

  it("scans simulated Steam Workshop 431960 directories, parses project.json & blocks traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "pmx-wp-steam-"));
    try {
      const steamA = join(root, "SteamMain");
      const steamB = join(root, "SteamDriveD");
      const wsRoot = join(steamB, "steamapps", "workshop", "content", "431960");
      await mkdir(join(steamA, "steamapps"), { recursive: true });
      await mkdir(wsRoot, { recursive: true });

      // libraryfolders.vdf in steamA points to steamB
      const escapedB = steamB.replace(/\\/g, "\\\\");
      await writeFile(
        join(steamA, "steamapps", "libraryfolders.vdf"),
        `"libraryfolders"\n{\n  "0"\n  {\n    "path" "${escapedB}"\n    "apps"\n    {\n      "431960" "1"\n    }\n  }\n}\n`,
        "utf8",
      );

      // Secret file outside workshop directory for path-traversal tests
      const secretFile = join(root, "secret.txt");
      await writeFile(secretFile, "TOP_SECRET", "utf8");

      // 1) Valid image wallpaper with real PNG dimensions (1920x1080 landscape) + localization props
      const imgDir = join(wsRoot, "1001");
      await mkdir(imgDir, { recursive: true });
      await writeFile(join(imgDir, "bg.png"), makeMinimalPng(1920, 1080));
      await writeFile(
        join(imgDir, "project.json"),
        JSON.stringify({
          title: "Starlight Lake",
          type: "image",
          file: "bg.png",
          preview: "bg.png",
          contentrating: "Everyone",
          tags: ["anime", "lake"],
          general: {
            localization: {
              "zh-chs": {
                ui_speed: "动画速度",
              },
              "en-us": {
                ui_speed: "Anim Speed",
              },
            },
            properties: {
              schemecolor: { type: "color", value: "0.2 0.6 1.0", order: 1.5 },
              speed: { type: "slider", text: "ui_speed", value: 1.2, min: 0.5, max: 2, order: 1.25 },
            },
          },
        }),
        "utf8",
      );

      // 2) Valid video wallpaper with PG13 rating
      const vidDir = join(wsRoot, "1002");
      await mkdir(vidDir, { recursive: true });
      await writeFile(join(vidDir, "loop.mp4"), Buffer.from("00000018ftypmp42"));
      await writeFile(join(vidDir, "preview.png"), makeMinimalPng(1080, 1920));
      await writeFile(
        join(vidDir, "project.json"),
        JSON.stringify({
          title: "Neon Rain",
          type: "video",
          file: "loop.mp4",
          preview: "preview.png",
          contentrating: "Questionable",
        }),
        "utf8",
      );

      // 3) Valid scene wallpaper declaring scene.json while only shipping scene.pkg
      const sceneDir = join(wsRoot, "1003");
      await mkdir(sceneDir, { recursive: true });
      await writeFile(join(sceneDir, "scene.pkg"), Buffer.from("PKGV0001"));
      await writeFile(
        join(sceneDir, "project.json"),
        JSON.stringify({
          title: "Cyber Sakura",
          type: "scene",
          file: "scene.json",
          contentrating: "Mature",
        }),
        "utf8",
      );

      // 4) Malicious project.json with path traversal in `file` -> MUST BE DROPPED
      const evilFileDir = join(wsRoot, "6661");
      await mkdir(evilFileDir, { recursive: true });
      await writeFile(
        join(evilFileDir, "project.json"),
        JSON.stringify({
          title: "Evil Traversal File",
          type: "image",
          file: "../../../../../secret.txt",
        }),
        "utf8",
      );

      // 5) Project with safe `file` but traversal in `preview` -> KEEP wallpaper, NULL previewUrl
      const evilPreviewDir = join(wsRoot, "6662");
      await mkdir(evilPreviewDir, { recursive: true });
      await writeFile(join(evilPreviewDir, "ok.mp4"), Buffer.from("mp4data"));
      await writeFile(
        join(evilPreviewDir, "project.json"),
        JSON.stringify({
          title: "Safe File Bad Preview",
          type: "video",
          file: "ok.mp4",
          preview: "..\\..\\..\\..\\..\\secret.txt",
        }),
        "utf8",
      );

      // 6) Hidden via visibility.json -> MUST BE SKIPPED
      const hiddenDir = join(wsRoot, "9999");
      await mkdir(hiddenDir, { recursive: true });
      await writeFile(join(hiddenDir, "bg.png"), makeMinimalPng(800, 600));
      await writeFile(
        join(hiddenDir, "project.json"),
        JSON.stringify({ title: "Hidden By WE", type: "image", file: "bg.png" }),
        "utf8",
      );
      await writeFile(
        join(wsRoot, "visibility.json"),
        JSON.stringify({ "9999": false }),
        "utf8",
      );

      const res = await scanSteamWorkshop431960({
        steamRootOverride: steamA,
        probeDirs: [],
        queryRegistry: false,
      });

      const ids = res.wallpapers.map((w) => w.id);
      assert.ok(ids.includes("steam:1001"));
      assert.ok(ids.includes("steam:1002"));
      assert.ok(ids.includes("steam:1003"));
      assert.ok(ids.includes("steam:6662"));
      assert.ok(!ids.includes("steam:6661"), "traversal file entry must be dropped");
      assert.ok(!ids.includes("steam:9999"), "visibility.json false entry must be skipped");

      const lake = res.wallpapers.find((w) => w.id === "steam:1001")!;
      assert.equal(lake.width, 1920);
      assert.equal(lake.height, 1080);
      assert.equal(lake.orientation, "landscape");
      assert.equal(lake.contentRating, "everyone");
      assert.equal(lake.schemeColor, "#3399ff");
      assert.equal(lake.userProperties?.[0]?.name, "speed");
      assert.equal(lake.userProperties?.[0]?.text, "动画速度");
      assert.equal(lake.userProperties?.[1]?.name, "schemecolor");

      const neon = res.wallpapers.find((w) => w.id === "steam:1002")!;
      assert.equal(neon.orientation, "portrait");
      assert.equal(neon.contentRating, "pg13");

      const sakura = res.wallpapers.find((w) => w.id === "steam:1003")!;
      assert.equal(sakura.type, "scene");
      assert.equal(sakura.contentRating, "mature");

      const badPrev = res.wallpapers.find((w) => w.id === "steam:6662")!;
      assert.equal(badPrev.previewUrl, null);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("scans custom wallpaper dir, imports files safely, and enforces path traversal & HTTP 206 range streaming", async () => {
    const root = await mkdtemp(join(tmpdir(), "pmx-wp-custom-"));
    try {
      const srcDir = join(root, "downloads");
      const customDir = join(root, "wallpapers");
      await mkdir(srcDir, { recursive: true });
      await mkdir(customDir, { recursive: true });

      const srcPng = join(srcDir, "mountain.png");
      await writeFile(srcPng, makeMinimalPng(2560, 1440));
      const srcExe = join(srcDir, "malware.exe");
      await writeFile(srcExe, "MZ");

      // Safe import with traversal filename attempt -> sanitized inside customDir
      const imported = await importLocalWallpaperFile(srcPng, customDir, {
        targetName: "../../../../evil-escape.png",
      });
      assert.equal(imported.source, "custom");
      assert.equal(imported.type, "image");
      assert.equal(imported.width, 2560);
      assert.equal(imported.height, 1440);
      assert.equal(imported.orientation, "landscape");
      assert.ok(imported.filePath && isPathInsideDir(customDir, imported.filePath));

      // Reject disallowed extension
      await assert.rejects(
        () => importLocalWallpaperFile(srcExe, customDir),
        /Unsupported wallpaper file type/,
      );

      // Write a sample media payload for Range 206 tests
      const mediaFile = join(customDir, "sample.mp4");
      const payload = Buffer.from("0123456789ABCDEF");
      await writeFile(mediaFile, payload);
      await writeFile(join(customDir, "ignore.txt"), "not a wallpaper");

      const customList = await scanCustomWallpaperDir(customDir);
      assert.equal(customList.length, 2);
      assert.ok(customList.some((w) => w.type === "video" && w.title === "sample"));

      // Path fence checks
      assert.equal(resolveSafeMediaPath([customDir], "../downloads/mountain.png").ok, false);
      assert.equal(resolveSafeMediaPath([customDir], "..\\downloads\\mountain.png").ok, false);
      assert.equal(resolveSafeMediaPath([customDir], "sample.mp4\0.jpg").ok, false);
      assert.equal(resolveSafeMediaPath([customDir], srcPng).ok, false);
      assert.equal(resolveSafeMediaPath([customDir], mediaFile).ok, true);

      // Byte range parser checks
      const r1 = parseByteRange("bytes=0-3", 16);
      assert.equal(r1.ok, true);
      if (r1.ok) {
        assert.equal(r1.start, 0);
        assert.equal(r1.end, 3);
        assert.equal(r1.contentRange, "bytes 0-3/16");
      }
      const rSuffix = parseByteRange("bytes=-4", 16);
      assert.equal(rSuffix.ok, true);
      if (rSuffix.ok) {
        assert.equal(rSuffix.start, 12);
        assert.equal(rSuffix.end, 15);
      }
      const rInvalid = parseByteRange("bytes=20-30", 16);
      assert.equal(rInvalid.ok, false);

      // Live HTTP server Range 206 + 403 traversal verification
      const server = createServer((req, res) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const target = url.searchParams.get("file") || "";
        serveMediaFileWithRange(req, res, target, [customDir]);
      });
      await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
      const { port } = server.address() as AddressInfo;

      try {
        const partial = await fetch(
          `http://127.0.0.1:${port}/media?file=${encodeURIComponent(mediaFile)}`,
          { headers: { Range: "bytes=4-9" } },
        );
        assert.equal(partial.status, 206);
        assert.equal(partial.headers.get("content-range"), "bytes 4-9/16");
        assert.equal(partial.headers.get("accept-ranges"), "bytes");
        assert.equal(await partial.text(), "456789");

        const forbidden = await fetch(
          `http://127.0.0.1:${port}/media?file=${encodeURIComponent("../../secret.txt")}`,
        );
        assert.equal(forbidden.status, 403);

        const rangeErr = prepareMediaRangeResponse(mediaFile, [customDir], "bytes=99-120");
        assert.equal(rangeErr.status, 416);
      } finally {
        await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("@prismux/wallpaper — Store, Filtering, Module Reset, Virtual Window & Rotation", () => {
  const sampleWallpapers: WallpaperItem[] = [
    {
      id: "w1",
      title: "Alpine Sunrise",
      type: "image",
      source: "custom",
      previewUrl: null,
      mediaUrl: "/w1.jpg",
      filePath: null,
      width: 1920,
      height: 1080,
      orientation: "landscape",
      contentRating: "everyone",
      tags: ["nature"],
    },
    {
      id: "w2",
      title: "Vertical Cyberpunk",
      type: "video",
      source: "steam",
      previewUrl: null,
      mediaUrl: "/w2.mp4",
      filePath: null,
      width: 1080,
      height: 1920,
      orientation: "portrait",
      contentRating: "pg13",
      tags: ["neon"],
    },
    {
      id: "w3",
      title: "Square Abstract Web",
      type: "web",
      source: "steam",
      previewUrl: null,
      mediaUrl: "/w3/index.html",
      filePath: null,
      width: 1024,
      height: 1024,
      orientation: "square",
      contentRating: "mature",
    },
    {
      id: "w4",
      title: "Deep Forest Scene",
      type: "scene",
      source: "steam",
      previewUrl: null,
      mediaUrl: "/w4/scene.pkg",
      filePath: null,
      width: null,
      height: null,
      orientation: "unknown",
      contentRating: "unrated",
    },
  ];

  it("filters accurately by rating, type, orientation, search query, and hidden state", () => {
    const store = createWallpaperStore({
      wallpapers: sampleWallpapers,
      includeBuiltins: false,
      storage: createMemoryStorage(),
    });

    // All 4 visible initially
    assert.equal(filterVisibleWallpapers(store.getSnapshot().wallpapers, store.getSnapshot().settings).length, 4);

    // Filter out mature & unrated
    store.toggleRatingFilter("mature");
    store.toggleRatingFilter("unrated");
    const playable = filterPlayableWallpapers(
      store.getSnapshot().wallpapers,
      store.getSnapshot().settings,
    );
    assert.deepEqual(
      playable.map((w) => w.id),
      ["w1", "w2"],
    );

    // Filter orientation = portrait -> only w2
    store.setSetting("orientationFilter", "portrait");
    assert.deepEqual(
      filterVisibleWallpapers(store.getSnapshot().wallpapers, store.getSnapshot().settings).map(
        (w) => w.id,
      ),
      ["w2"],
    );

    // Reset orientation to all, test type filter & search
    store.setSetting("orientationFilter", "all");
    store.setSetting("typeFilter", ["image"]);
    assert.deepEqual(
      filterVisibleWallpapers(
        store.getSnapshot().wallpapers,
        store.getSnapshot().settings,
        "alpine",
      ).map((w) => w.id),
      ["w1"],
    );

    // Counts & hide/restore
    const counts = computeFilterCounts(store.getSnapshot().wallpapers, store.getSnapshot().settings);
    assert.equal(counts.ratings.everyone, 1);
    assert.equal(counts.ratings.mature, 1);
    store.hideWallpapers(["w1"]);
    assert.equal(
      filterPlayableWallpapers(store.getSnapshot().wallpapers, store.getSnapshot().settings).some(
        (w) => w.id === "w1",
      ),
      false,
    );
    store.restoreWallpapers(["w1"]);
    assert.equal(
      filterPlayableWallpapers(store.getSnapshot().wallpapers, store.getSnapshot().settings).some(
        (w) => w.id === "w1",
      ),
      true,
    );
    store.dispose();
  });

  it("separates UI view state (localStorage defaults) from persisted settings and resets modules in isolation", () => {
    const storage = createMemoryStorage();
    let settingsChanges = 0;
    const store = createWallpaperStore({
      includeBuiltins: true,
      storage,
      onSettingsChange: () => {
        settingsChanges++;
      },
    });

    // Verify exact default collapse flags from spec
    assert.deepEqual(store.getSnapshot().ui, {
      qpTab: "wallpaper",
      qpView: "cards",
      detailOpen: true,
      glassUiOpen: true,
      cornersOpen: false,
      uiColorOpen: false,
      fontOpen: false,
      glassDetailOpen: false,
    });

    // Toggling UI view state writes to storage ONLY and never triggers business settings persistence
    store.toggleUiSection("glassDetailOpen");
    store.setUiState("qpTab", "appearance");
    assert.equal(store.getSnapshot().ui.glassDetailOpen, true);
    assert.equal(store.getSnapshot().ui.qpTab, "appearance");
    assert.equal(settingsChanges, 0);
    assert.equal(storage.dump()["prismux-wallpaper:qp-glass-detail"], "1");
    assert.equal(storage.dump()["prismux-wallpaper:qp-tab"], "appearance");

    // Mutate multiple modules, then reset one module at a time and verify zero cross-module bleed
    store.updateSettings({
      border: 0.75,
      blur: 42,
      glassAlpha: 65,
      leftSidebarCornerRadius: 20,
      accent: "#ec4899",
      fontCustom: true,
      globalFamily: "KaiTi",
      wallpaperBlur: 18,
      playbackRate: 1.5,
    });

    store.resetModule("details");
    assert.equal(store.getSnapshot().settings.border, 0.25);
    assert.equal(store.getSnapshot().settings.blur, 42);

    store.resetModule("glass");
    assert.equal(store.getSnapshot().settings.blur, 18);
    assert.equal(store.getSnapshot().settings.glassAlpha, 28);
    assert.equal(store.getSnapshot().settings.leftSidebarCornerRadius, 20);

    store.resetModule("corners");
    assert.equal(store.getSnapshot().settings.leftSidebarCornerRadius, "native");
    assert.equal(store.getSnapshot().settings.accent, "#ec4899");

    store.resetModule("uiColor");
    assert.equal(store.getSnapshot().settings.accent, "#4f8cff");
    assert.equal(store.getSnapshot().settings.fontCustom, true);

    store.resetModule("font");
    assert.equal(store.getSnapshot().settings.fontCustom, false);
    assert.equal(store.getSnapshot().settings.globalFamily, "");
    assert.equal(store.getSnapshot().settings.wallpaperBlur, 18);

    store.resetModule("playback");
    assert.equal(store.getSnapshot().settings.wallpaperBlur, 0);
    assert.equal(store.getSnapshot().settings.playbackRate, 1);

    store.dispose();
  });

  it("computes grid-row virtual scroll windows accurately for both list and multi-column card views", () => {
    // List view: 100 items, 34px row + 2px gap = 36px pitch, scrolled 720px (row 20), 360px viewport (10 rows), overscan 2
    const listWin = computeVirtualWindow({
      count: 100,
      itemHeight: 34,
      gap: 2,
      cols: 1,
      scrollTop: 720,
      viewportHeight: 360,
      overscan: 2,
    });
    assert.equal(listWin.start, 18);
    assert.equal(listWin.end, 32);
    assert.equal(listWin.topSpacerHeight, 18 * 36 - 2);
    assert.equal(listWin.bottomSpacerHeight, 68 * 36 - 2);

    // Card view: 95 items, 3 cols (32 total rows), 92px card + 8px gap = 100px pitch, scrollTop 500 (row 5), viewport 300 (3 rows), overscan 1
    const cardWin = computeVirtualWindow({
      count: 95,
      itemHeight: 92,
      gap: 8,
      cols: 3,
      scrollTop: 500,
      viewportHeight: 300,
      overscan: 1,
    });
    assert.equal(cardWin.totalRows, 32);
    assert.equal(cardWin.start, 12); // row 4 * 3
    assert.equal(cardWin.end, 27); // row 9 * 3
    assert.equal(cardWin.topSpacerHeight, 4 * 100 - 8);
    assert.equal(cardWin.bottomSpacerHeight, Math.ceil((95 - 27) / 3) * 100 - 8);
  });

  it("handles rotation group sequence/random switching and WE user property condition evaluation", () => {
    const store = createWallpaperStore({
      wallpapers: sampleWallpapers,
      includeBuiltins: false,
      storage: createMemoryStorage(),
    });

    const group = store.createRotationGroup({
      name: "Favorites",
      wallpaperIds: ["w1", "w2", "w3"],
      intervalMinutes: 10,
      order: "sequence",
      trigger: "videoEnd",
    });
    store.updateSettings({
      rotationEnabled: true,
      rotationGroupId: group.id,
      selectedId: "w1",
    });

    // With default advancedEngineEnabled: false, Web item w3 is excluded from rotation (cycles w1 -> w2 -> w1)
    assert.equal(store.getSnapshot().settings.advancedEngineEnabled, false);
    assert.equal(store.nextWallpaper(), "w2");
    assert.equal(store.nextWallpaper(), "w1");

    // Once advancedEngineEnabled is opted in, Web item w3 participates cleanly (w1 -> w2 -> w3 -> w1)
    store.setSetting("advancedEngineEnabled", true);
    assert.equal(store.nextWallpaper(), "w2");
    assert.equal(store.nextWallpaper(), "w3");
    // Wrap around
    store.handleVideoEnded();
    assert.equal(store.getSnapshot().settings.selectedId, "w1");

    // Random non-repeating selection
    const nextRand = pickNextWallpaperId(sampleWallpapers.slice(0, 3), "w1", "random", () => 0.99);
    assert.notEqual(nextRand, "w1");
    assert.equal(nextRand, "w3");

    // WE user property conditions & color conversions
    assert.equal(
      weEvalCondition("enableBloom.value == true && bloomLevel.value >= 2", {
        enableBloom: true,
        bloomLevel: 3,
      }),
      true,
    );
    assert.equal(
      weEvalCondition("!hideClock && mode == 'night'", {
        hideClock: false,
        mode: "night",
      }),
      true,
    );
    assert.equal(
      weEvalCondition("enableBloom == true", { enableBloom: false }),
      false,
    );

    const weColor = weHexToColor("#4f8cff");
    assert.equal(weColorToHex(weColor), "#4f8cff");

    store.dispose();
  });

  it("removes all synthetic builtin WebWallGL scenes and migrates legacy builtin selectedId to null", () => {
    assert.equal(BUILTIN_WEBWALLGL_SCENES.length, 0);
    assert.deepEqual(createBuiltinWallpapers(), []);
    assert.equal(createDefaultSettings().selectedId, null);

    // Even when legacy includeBuiltins: true or legacy builtin-* selectedId is supplied, builtins stay excluded
    const store = createWallpaperStore({
      includeBuiltins: true,
      storage: createMemoryStorage(),
      settings: {
        selectedId: "builtin:aurora-prism",
      },
    });
    assert.equal(store.getSnapshot().wallpapers.length, 0);
    assert.equal(
      store.getSnapshot().settings.selectedId,
      null,
      "legacy builtin:aurora-prism selectedId must auto-migrate to null",
    );

    // Supplying a mix of legacy daemon builtin-* entries and a real custom wallpaper retains ONLY real wallpapers
    store.setWallpapers([
      {
        id: "builtin-aurora-prism",
        title: "极光棱镜",
        type: "scene",
        source: "builtin",
        previewUrl: null,
        mediaUrl: null,
        filePath: null,
        width: 1920,
        height: 1080,
        orientation: "landscape",
        contentRating: "everyone",
      },
      {
        id: "builtin-midnight-tide",
        title: "午夜深海",
        type: "scene",
        source: "builtin",
        previewUrl: null,
        mediaUrl: null,
        filePath: null,
        width: 1920,
        height: 1080,
        orientation: "landscape",
        contentRating: "everyone",
      },
      sampleWallpapers[0]!,
    ]);

    const list = store.getSnapshot().wallpapers;
    assert.deepEqual(
      list.map((w) => w.id),
      ["w1"],
      "mergeWallpapers must strip all source: 'builtin' synthetic scenes",
    );
    assert.equal(findWallpaperById(list, "builtin-aurora-prism"), null);
    assert.equal(findWallpaperById(list, "builtin:midnight-abyss"), null);
    assert.equal(findWallpaperById(list, "w1")?.id, "w1");

    // Updating settings or selecting a legacy builtin-* ID clears selectedId to null, while real IDs remain intact
    store.selectWallpaper("w1");
    assert.equal(store.getSnapshot().settings.selectedId, "w1");
    store.updateSettings({ selectedId: "builtin-aurora-prism" });
    assert.equal(store.getSnapshot().settings.selectedId, null);
    store.selectWallpaper("builtin:liquid-silk");
    assert.equal(store.getSnapshot().settings.selectedId, null);
    store.dispose();
  });

  it("normalizes legacy daemon wallpaperOpacity (100 -> 0) and scrim (35 -> 0.35) to prevent 99% blackout", () => {
    assert.equal(normalizeWallpaperFadeOpacity(100), 0);
    assert.equal(normalizeWallpaperFadeOpacity(45), 45);
    assert.equal(normalizeWallpaperScrim(35), 0.35);
    assert.equal(normalizeWallpaperScrim(0.2), 0.2);
    assert.equal(normalizeWallpaperScrim(95), 0.9);

    const store = createWallpaperStore({
      includeBuiltins: true,
      storage: createMemoryStorage(),
      settings: {
        wallpaperOpacity: 100,
        scrim: 35,
      },
    });
    assert.equal(store.getSnapshot().settings.wallpaperOpacity, 0);
    assert.equal(store.getSnapshot().settings.scrim, 0.35);

    store.updateSettings({ wallpaperOpacity: 100, scrim: 40 });
    assert.equal(store.getSnapshot().settings.wallpaperOpacity, 0);
    assert.equal(store.getSnapshot().settings.scrim, 0.4);

    store.updateSettings({ wallpaperOpacity: 25, scrim: 0.2 });
    assert.equal(store.getSnapshot().settings.wallpaperOpacity, 25);
    assert.equal(store.getSnapshot().settings.scrim, 0.2);

    store.dispose();
  });

  it("switches into in-place appearance studio without route navigation and preserves wallpaper filters on return", async () => {
    const storage = createMemoryStorage();
    const routedSections: string[] = [];
    const store = createWallpaperStore({
      wallpapers: sampleWallpapers,
      includeBuiltins: false,
      storage,
    });

    // Apply search + orientation filter in wallpaper view
    store.setQpSearch("Alpine");
    store.setSetting("orientationFilter", "landscape");
    assert.equal(resolveQuickPanelTab(store.getSnapshot().ui.qpTab), "wallpaper");

    // Clicking "外观与玻璃" switches in-panel tab to "appearance" and NEVER triggers route navigation
    openInlineAppearanceInStore(store);
    assert.equal(resolveQuickPanelTab(store.getSnapshot().ui.qpTab), "appearance");
    assert.deepEqual(routedSections, [], "opening inline appearance must not navigate to /settings/appearance");

    // Returning via "← 返回壁纸" restores wallpaper tab while keeping search & filters intact
    closeInlineAppearanceInStore(store, "wallpaper");
    assert.equal(resolveQuickPanelTab(store.getSnapshot().ui.qpTab), "wallpaper");
    assert.equal(store.getSnapshot().qpSearch, "Alpine");
    assert.equal(store.getSnapshot().settings.orientationFilter, "landscape");

    // Also supports returning to playback tab when entered from playback
    store.setUiState("qpTab", "playback");
    openInlineAppearanceInStore(store);
    assert.equal(resolveQuickPanelTab(store.getSnapshot().ui.qpTab), "appearance");
    closeInlineAppearanceInStore(store, "playback");
    assert.equal(resolveQuickPanelTab(store.getSnapshot().ui.qpTab), "playback");

    // Verify WallpaperQuickPanel routes top 3-tab "外观与玻璃" to handleOpenInlineAppearance
    // and removes duplicate bottom trigger, 壁纸属性 button, and duplicate audio section on wallpaper tab
    const testDir = dirname(fileURLToPath(import.meta.url));
    const pkgRoot = join(testDir, "..", "..");
    const panelSrc = await readFile(join(pkgRoot, "src", "WallpaperQuickPanel.tsx"), "utf8");
    assert.match(panelSrc, /id:\s*"appearance",\s*label:\s*"外观与玻璃"/);
    assert.match(panelSrc, /if \(t\.id === "appearance"\)\s*\{\s*handleOpenInlineAppearance\(\);/);
    assert.doesNotMatch(
      panelSrc,
      /data-pmx-inline-appearance-trigger="1"/,
      "duplicate bottom 外观与玻璃 button must be removed",
    );
    assert.doesNotMatch(
      panelSrc,
      /壁纸属性/,
      "壁纸属性 drill-down button must be removed from WallpaperQuickPanel",
    );
    assert.equal(
      (panelSrc.match(/<PlaybackAudioSection\b/g) ?? []).length,
      1,
      "PlaybackAudioSection must render ONLY on the 播放 tab (never duplicated on 壁纸 tab)",
    );
    assert.match(panelSrc, /data-pmx-inline-appearance="1"/);
    assert.match(panelSrc, /data-pmx-open-wallpaper-settings="1"/);
    assert.match(panelSrc, /← 返回壁纸/);

    // Verify stylesheet keeps QuickPanel transparent over rightSidebar glass & provides light/dark contrast tokens
    const panelCss = await readFile(join(pkgRoot, "src", "styles", "wallpaper-panel.css"), "utf8");
    assert.match(panelCss, /html\[data-pmx-glass='1'\] \.pmx-wp-qp\s*\{[\s\S]*?background:\s*transparent/);
    assert.match(panelCss, /html:not\(\.dark\) \.pmx-wp-qp/);
    assert.match(panelCss, /html\.dark \.pmx-wp-qp/);
    assert.match(panelCss, /html\.dark\[data-pmx-glass='1'\] \.pmx-wp-qp/);
    assert.match(panelCss, /\.pmx-wp-text::placeholder/);
    assert.match(panelCss, /--pmx-wp-glass-text-shadow/);
    assert.match(panelCss, /--pmx-glass-zone-overlays-bg/);
    assert.match(panelCss, /prefers-reduced-motion:\s*reduce/);
    assert.match(panelCss, /prefers-reduced-transparency:\s*reduce/);

    store.dispose();
  });

  it("preserves 1:1 native wallpaper color fidelity by default (filter: none, achromatic scrim, no oversaturated fallback)", async () => {
    const defaults = createDefaultSettings();
    assert.equal(defaults.scrim, 0.4);
    assert.equal(defaults.fpsCap, 60);
    assert.equal(defaults.videoVolume, 0.35);
    assert.equal(defaults.pauseOnBattery, true);
    assert.equal(defaults.rotationGroupId, "default");
    assert.equal(defaults.backgroundBrightness, 100);
    assert.equal(defaults.backgroundContrast, 100);
    assert.equal(defaults.backgroundSaturate, 100);
    assert.equal(defaults.wallpaperBlur, 0);
    assert.equal(defaults.wallpaperOpacity, 0);

    const testDir = dirname(fileURLToPath(import.meta.url));
    const pkgRoot = join(testDir, "..", "..");
    const stageSrc = await readFile(join(pkgRoot, "src", "WallpaperStage.tsx"), "utf8");
    const panelCss = await readFile(join(pkgRoot, "src", "styles", "wallpaper-panel.css"), "utf8");

    // WallpaperStage must emit explicit filter: "none" when sliders are at native 100%/0px defaults
    assert.match(
      stageSrc,
      /filter:\s*filterParts\.length > 0 \? filterParts\.join\(" "\) : "none"/,
    );
    // Native fade color must stay strictly achromatic (#ffffff / #000000) and adapt to Light / Dark / Glass polarity
    assert.match(
      stageSrc,
      /const isLightSurface =\s*settings\.themeMode === "light" \|\| \(settings\.themeMode === "glass" && docIsLight\);/,
    );
    assert.match(
      stageSrc,
      /const nativeFadeColor = isLightSurface \? "#ffffff" : "#000000";/,
    );
    // Stage media & scrim enforce normal blend mode, filter: none default, pure black scrim, and natural 1.1 menu saturation
    assert.match(panelCss, /\.pmx-wp-stage__media\s*\{[^}]*filter:\s*none;[^}]*mix-blend-mode:\s*normal;/s);
    assert.match(panelCss, /\.pmx-wp-stage__scrim\s*\{[^}]*background:\s*#000000;/s);
    assert.doesNotMatch(panelCss, /backdrop-filter:[^;]*saturate\(1\.[4-9]/);
  });

  it("enforces high-contrast 3-state (Light / Dark / Glass) active pills on wallpaper tabs & toggle buttons (#505)", async () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const pkgRoot = join(testDir, "..", "..");
    const panelCss = await readFile(join(pkgRoot, "src", "styles", "wallpaper-panel.css"), "utf8");
    const noComments = panelCss.replace(/\/\*[\s\S]*?\*\//g, "");

    assert.equal(noComments.includes("prefers-color-scheme"), false, "wallpaper-panel.css must never use prefers-color-scheme");
    assert.equal(
      (noComments.match(/\{/g) ?? []).length,
      (noComments.match(/\}/g) ?? []).length,
      "wallpaper-panel.css must keep balanced braces",
    );

    // Recessed track + accented sliding pill across Dark, Light, Dark Glass, Light Glass
    assert.match(panelCss, /\.pmx-wp-tabs__pill\s*\{[\s\S]*?border:\s*1px solid color-mix\(/);
    assert.match(panelCss, /html:not\(\.dark\):not\(\[data-pmx-theme='dark'\]\) \.pmx-wp-tabs__pill[\s\S]*?color-mix\(/);
    assert.match(panelCss, /html\.dark\[data-pmx-glass='1'\] \.pmx-wp-tabs__pill[\s\S]*?color-mix\(/);
    assert.match(panelCss, /html:not\(\.dark\)\[data-pmx-glass='1'\] \.pmx-wp-tabs__pill[\s\S]*?color-mix\(/);
    assert.match(panelCss, /\.pmx-wp-tabs__tab--active\s*\{[\s\S]*?color:\s*#ffffff;[\s\S]*?font-weight:\s*600;/);
    assert.match(panelCss, /html:not\(\.dark\):not\(\[data-pmx-theme='dark'\]\) \.pmx-wp-tabs__tab--active[\s\S]*?color:\s*#0f172a;/);

    // Active toggle buttons (.pmx-wp-btn.is-on) keep high-contrast fill & are excluded from generic glass button override
    assert.match(panelCss, /\.pmx-wp-btn\.is-on\s*\{[\s\S]*?color:\s*#ffffff;[\s\S]*?font-weight:\s*600;/);
    assert.match(panelCss, /html:not\(\.dark\):not\(\[data-pmx-theme='dark'\]\) \.pmx-wp-btn\.is-on[\s\S]*?color:\s*#0f172a;/);
    assert.match(panelCss, /\.pmx-wp-btn:not\(\.pmx-wp-btn--primary\):not\(\.pmx-wp-rate--active\):not\(\.is-on\)/);
  });

  it("consolidates WallpaperSettingsView refresh action into Tab bar trailingAction slot and denoises jargon (RC.2)", async () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const pkgRoot = join(testDir, "..", "..");
    const viewSrc = await readFile(join(pkgRoot, "src", "WallpaperSettingsView.tsx"), "utf8");
    const panelCss = await readFile(join(pkgRoot, "src", "styles", "wallpaper-panel.css"), "utf8");

    assert.match(viewSrc, /trailingAction\?:\s*ReactNode/);
    assert.match(viewSrc, /headerStatusBadge\?:\s*ReactNode/);
    assert.match(viewSrc, /data-pmx-wp-tabs-trailing="1"/);
    assert.doesNotMatch(viewSrc, /刷新库/, "duplicate 刷新库 button in vinyl hero card must be removed");
    assert.doesNotMatch(viewSrc, /应用并刷新/, "redundant 应用并刷新 label must be simplified to 保存");
    assert.doesNotMatch(viewSrc, /0 Token/, "raw 0 Token jargon must not appear in user-facing copy");
    assert.match(panelCss, /\.pmx-wp-tabs-row\s*\{/);
    assert.match(panelCss, /\.pmx-wp-tabs-trailing\s*\{/);
  });

  it("extracts true MP4 (head & EOF moov) and WebM video dimensions instead of 512x512 square preview fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "pmx-wp-vid-dims-"));
    try {
      const box = (type: string, payload: Buffer): Buffer => {
        const hdr = Buffer.alloc(8);
        hdr.writeUInt32BE(8 + payload.length, 0);
        hdr.write(type, 4, 4, "ascii");
        return Buffer.concat([hdr, payload]);
      };
      const makeMp4 = (w: number, h: number, eofMoov: boolean): Buffer => {
        const tkhdPayload = Buffer.alloc(84, 0);
        tkhdPayload.writeInt32BE(0x00010000, 40);
        tkhdPayload.writeInt32BE(0x00010000, 56);
        tkhdPayload.writeInt32BE(0x40000000, 72);
        tkhdPayload.writeUInt32BE((w << 16) >>> 0, 76);
        tkhdPayload.writeUInt32BE((h << 16) >>> 0, 80);
        const moov = box("moov", box("trak", box("tkhd", tkhdPayload)));
        const ftyp = box("ftyp", Buffer.from("isom\x00\x00\x02\x00isommp41", "latin1"));
        const mdat = box("mdat", Buffer.alloc(eofMoov ? 180_000 : 128, 0x55));
        return eofMoov ? Buffer.concat([ftyp, mdat, moov]) : Buffer.concat([ftyp, moov, mdat]);
      };

      const mp4Eof = join(root, "eof-4k.mp4");
      await writeFile(mp4Eof, makeMp4(3840, 2160, true));
      assert.deepEqual(await readVideoDimensions(mp4Eof), { width: 3840, height: 2160 });

      const mp4Head = join(root, "head-portrait.mp4");
      await writeFile(mp4Head, makeMp4(1080, 1920, false));
      assert.deepEqual(await readVideoDimensions(mp4Head), { width: 1080, height: 1920 });

      // WebM EBML PixelWidth / PixelHeight
      const ebml = Buffer.concat([
        Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01]),
        Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
        Buffer.from([0x16, 0x54, 0xae, 0x6b, 0x8c]),
        Buffer.from([0xae, 0x8a]),
        Buffer.from([0xe0, 0x88]),
        Buffer.from([0xb0, 0x82, 0x0a, 0x00]), // 2560
        Buffer.from([0xba, 0x82, 0x05, 0xa0]), // 1440
      ]);
      const webmFile = join(root, "clip.webm");
      await writeFile(webmFile, ebml);
      assert.deepEqual(await readVideoDimensions(webmFile), { width: 2560, height: 1440 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("eliminates multi-wallpaper tab flicker, fixes 16:9 card & numeric pill layout, and groups playback controls into glass cards (RC.2)", async () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const pkgRoot = join(testDir, "..", "..");
    const [viewSrc, panelSrc, playbackSrc, stageSrc, panelCss] = await Promise.all([
      readFile(join(pkgRoot, "src", "WallpaperSettingsView.tsx"), "utf8"),
      readFile(join(pkgRoot, "src", "WallpaperQuickPanel.tsx"), "utf8"),
      readFile(join(pkgRoot, "src", "renderers", "PlaybackSections.tsx"), "utf8"),
      readFile(join(pkgRoot, "src", "WallpaperStage.tsx"), "utf8"),
      readFile(join(pkgRoot, "src", "styles", "wallpaper-panel.css"), "utf8"),
    ]);

    // Flicker root-cause A: NO opacity: 0 on wallpaper card/quickpanel thumbnails
    assert.doesNotMatch(panelCss, /\.pmx-wp-card img\s*\{[^}]*opacity:\s*0;/s);
    assert.doesNotMatch(panelCss, /\.pmx-wp-qp__card img\s*\{[^}]*opacity:\s*0;/s);
    assert.doesNotMatch(
      panelCss,
      /\.pmx-wp-qp__thumb img,\s*\.pmx-wp-qp__item-thumb img\s*\{[^}]*opacity:\s*0;/s,
    );

    // Flicker root-cause B: NO hover video prewarm churn on card grids
    assert.doesNotMatch(viewSrc, /onPointerOver=\{\(\)\s*=>\s*\{[\s\S]*?schedulePrewarmVideo/);
    assert.doesNotMatch(panelSrc, /onPointerOver=\{\(\)\s*=>\s*handleCardPointer/);

    // Flicker root-cause C: Library tabpanel stays mounted with hidden toggle
    assert.match(viewSrc, /hidden=\{tab !== "library"\}/);
    assert.match(panelCss, /\.pmx-wp-tabpanel\[hidden\]\s*\{\s*display:\s*none;\s*\}/);

    // Aspect ratio & framing fixes: 16:9 cards with center 22% portrait-safe framing, ambient backdrop on stage
    assert.match(panelCss, /\.pmx-wp-card\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9;/s);
    assert.match(panelCss, /\.pmx-wp-qp__card\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9;/s);
    assert.match(panelCss, /object-position:\s*center 22%;/);
    assert.match(panelCss, /\.pmx-wp-stage__ambient\s*\{/);
    assert.match(stageSrc, /function AmbientBackdrop\(/);
    assert.match(stageSrc, /videoReady && !videoFailed/);

    // UI/UX hierarchy: elevated glass cards + translucent accent active pills + non-clipping numeric pills
    assert.match(panelCss, /\.pmx-wp-glass-card\s*\{/);
    assert.match(panelCss, /\.pmx-wp-value\s*\{[^}]*min-width:\s*58px;/s);
    assert.match(panelCss, /\.pmx-wp-value-input::-webkit-inner-spin-button/);
    assert.match(
      panelCss,
      /\.pmx-wp-rate--active\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--pmx-wp-accent\) 26%/s,
    );
    for (const card of ["filters", "framing", "scrim", "power", "audio"]) {
      assert.match(playbackSrc, new RegExp(`data-pmx-playback-card="${card}"`));
    }
    assert.doesNotMatch(playbackSrc, /0 Token/);
  });

  it("isolates stage viewport stacking for scrim/fade, unifies viewport filters & pan framing, fixes 16:9 card overlap/jitter, and refactors sidebar layout (RC.3)", async () => {
    // 1. Unified viewport filter + anti-bleed blur scale + pan/scale framing math
    const defaults = computeWallpaperStageStyles({
      objectFit: "cover",
      layerScale: 100,
      flipX: false,
      flipY: false,
      layerPositionX: 50,
      layerPositionY: 50,
      wallpaperBlur: 0,
      backgroundBrightness: 100,
      backgroundContrast: 100,
      backgroundSaturate: 100,
    });
    assert.equal(defaults.viewportStyle.filter, "none");
    assert.equal(defaults.viewportStyle.transform, undefined);
    assert.equal(defaults.mediaStyle.filter, undefined);
    assert.equal(defaults.frameMediaStyle.filter, undefined);
    assert.equal(defaults.mediaStyle.transform, "none");
    assert.equal(defaults.showAmbientBackdrop, false);

    // Non-default filters apply once on viewportStyle (never duplicated on mediaStyle) + blur anti-bleed scale
    const filtered = computeWallpaperStageStyles({
      objectFit: "cover",
      layerScale: 100,
      flipX: false,
      flipY: false,
      layerPositionX: 50,
      layerPositionY: 50,
      wallpaperBlur: 20,
      backgroundBrightness: 80,
      backgroundContrast: 120,
      backgroundSaturate: 140,
    });
    assert.equal(
      filtered.viewportStyle.filter,
      "blur(20px) brightness(80%) contrast(120%) saturate(140%)",
    );
    assert.equal(filtered.viewportStyle.transform, "scale(1.080)");
    assert.equal(filtered.mediaStyle.filter, undefined);
    assert.equal(filtered.frameMediaStyle.filter, undefined);

    // Pan at layerScale <= 100% produces clear translate3d + enables soft ambient backdrop
    const pannedAt100 = computeWallpaperStageStyles({
      objectFit: "cover",
      layerScale: 100,
      flipX: false,
      flipY: false,
      layerPositionX: 100,
      layerPositionY: 0,
      wallpaperBlur: 0,
      backgroundBrightness: 100,
      backgroundContrast: 100,
      backgroundSaturate: 100,
    });
    assert.equal(pannedAt100.mediaStyle.transform, "translate3d(22.50%, -22.50%, 0)");
    assert.equal(pannedAt100.frameMediaStyle.transform, "translate3d(22.50%, -22.50%, 0)");
    assert.equal(pannedAt100.showAmbientBackdrop, true);

    // Pan at zoomed layerScale = 150% stays smoothly within zoomShiftBound (16.67%) + flips cleanly
    const zoomedPanned = computeWallpaperStageStyles({
      objectFit: "cover",
      layerScale: 150,
      flipX: true,
      flipY: false,
      layerPositionX: 100,
      layerPositionY: 50,
      wallpaperBlur: 0,
      backgroundBrightness: 100,
      backgroundContrast: 100,
      backgroundSaturate: 100,
    });
    assert.equal(zoomedPanned.mediaStyle.transform, "translate3d(16.67%, 0.00%, 0) scale(-1.5, 1.5)");
    assert.equal(zoomedPanned.showAmbientBackdrop, true);

    // Scaled down (< 100%) activates ambient backdrop even at center
    const scaledDown = computeWallpaperStageStyles({
      objectFit: "cover",
      layerScale: 75,
      flipX: false,
      flipY: true,
      layerPositionX: 50,
      layerPositionY: 50,
      wallpaperBlur: 0,
      backgroundBrightness: 100,
      backgroundContrast: 100,
      backgroundSaturate: 100,
    });
    assert.equal(scaledDown.mediaStyle.transform, "scale(0.75, -0.75)");
    assert.equal(scaledDown.showAmbientBackdrop, true);

    // 2. CSS z-index isolation, 16:9 flow-height cards & sidebar layout assertions
    const testDir = dirname(fileURLToPath(import.meta.url));
    const pkgRoot = join(testDir, "..", "..");
    const [stageSrc, panelSrc, panelCss] = await Promise.all([
      readFile(join(pkgRoot, "src", "WallpaperStage.tsx"), "utf8"),
      readFile(join(pkgRoot, "src", "WallpaperQuickPanel.tsx"), "utf8"),
      readFile(join(pkgRoot, "src", "styles", "wallpaper-panel.css"), "utf8"),
    ]);

    assert.match(panelCss, /\.pmx-wp-stage__viewport\s*\{[^}]*z-index:\s*0;[^}]*isolation:\s*isolate;/s);
    assert.match(panelCss, /\.pmx-wp-stage__fade\s*\{[^}]*z-index:\s*10;/s);
    assert.match(panelCss, /\.pmx-wp-stage__scrim\s*\{[^}]*z-index:\s*11;[^}]*background:\s*#000000;/s);
    assert.match(stageSrc, /className="pmx-wp-stage__viewport"\s+style=\{viewportStyle\}/);

    // Card grid row height & zero hover jitter
    assert.match(
      panelCss,
      /\.pmx-wp-qp__list--cards\s*\{[^}]*grid-auto-rows:\s*max-content;[^}]*align-items:\s*start;[^}]*align-content:\s*start;/s,
    );
    assert.match(
      panelCss,
      /\.pmx-wp-grid\s*\{[^}]*grid-auto-rows:\s*max-content;[^}]*align-items:\s*start;[^}]*align-content:\s*start;/s,
    );
    assert.match(
      panelCss,
      /\.pmx-wp-qp__card::before,\s*\.pmx-wp-card::before\s*\{[^}]*padding-top:\s*56\.25%;/s,
    );
    assert.doesNotMatch(panelCss, /\.pmx-wp-qp__card:hover\s*\{[^}]*translateY\(/s);
    assert.match(panelCss, /\.pmx-wp-qp__card\s*\{[^}]*content-visibility:\s*auto;/s);

    // Virtualization bypass <= 160 items & no firstCard.offsetHeight ResizeObserver feedback loop
    assert.equal(QP_VIRTUALIZE_THRESHOLD, 160);
    assert.doesNotMatch(panelSrc, /firstCard\.offsetHeight/);
    assert.match(panelSrc, /Math\.abs\(nextWidth - lastObservedWidth\) < 2/);

    // Sidebar layout: permanent top current card (no !isAppearanceView gate) & rotation card moved inside playback tab
    assert.doesNotMatch(panelSrc, /\{!isAppearanceView \?/);
    assert.match(
      panelCss,
      /\.pmx-wp-qp--official\.pmx-wp-qp--appearance > \.pmx-wp-qp__current,\s*\.pmx-wp-qp--official\.pmx-wp-qp--appearance > \.pmx-wp-qp__tabs\s*\{[^}]*margin-inline:\s*12px;/s,
    );
    const idxCurrent = panelSrc.indexOf("pmx-wp-glass-card pmx-wp-qp__current");
    const idxTabs = panelSrc.indexOf("pmx-wp-tabs pmx-wp-qp__tabs");
    const idxPlayback = panelSrc.indexOf('effectiveTab === "playback" ?');
    const idxRotation = panelSrc.indexOf("pmx-wp-glass-card pmx-wp-qp__rotation");
    assert.ok(idxCurrent > -1 && idxTabs > idxCurrent, "current wallpaper card must stay above tab bar");
    assert.ok(
      idxPlayback > idxTabs && idxRotation > idxPlayback,
      "auto-rotation card must live inside the playback tab instead of above tabs",
    );
    assert.match(panelSrc, /<SectionHead label="自动轮播" \/>/);
  });

  it("enforces iron-law video audio muting/zeroing, setVideoVolume(0) switch sync, and WebWallpaperStage master audio + cleanup (RC.3)", async () => {
    // 1. Store volume <-> videoAudioEnabled linkage
    const store = createWallpaperStore({
      wallpapers: sampleWallpapers,
      includeBuiltins: false,
      storage: createMemoryStorage(),
    });
    assert.equal(store.getSnapshot().settings.videoAudioEnabled, false);
    assert.equal(store.getSnapshot().settings.videoVolume, 0.35);

    store.setVideoVolume(0.75);
    assert.equal(store.getSnapshot().settings.videoVolume, 0.75);
    assert.equal(store.getSnapshot().settings.videoAudioEnabled, true);

    // Dragging volume to 0% must turn off videoAudioEnabled and silence audio completely
    store.setVideoVolume(0);
    assert.equal(store.getSnapshot().settings.videoVolume, 0);
    assert.equal(store.getSnapshot().settings.videoAudioEnabled, false);

    // Negative / NaN values clamp cleanly to 0 and keep switch off
    store.setVideoVolume(-0.4);
    assert.equal(store.getSnapshot().settings.videoVolume, 0);
    assert.equal(store.getSnapshot().settings.videoAudioEnabled, false);
    store.setVideoVolume(Number.NaN);
    assert.equal(store.getSnapshot().settings.videoVolume, 0);
    assert.equal(store.getSnapshot().settings.videoAudioEnabled, false);

    // toggleAudio() restores 0.5 when enabling from 0, and preserves volume when muting
    store.toggleAudio();
    assert.equal(store.getSnapshot().settings.videoAudioEnabled, true);
    assert.equal(store.getSnapshot().settings.videoVolume, 0.5);
    store.toggleAudio();
    assert.equal(store.getSnapshot().settings.videoAudioEnabled, false);
    assert.equal(store.getSnapshot().settings.videoVolume, 0.5);
    store.dispose();

    // 2. VideoStage applyVideoAudio & unconditional disposeVideoElement
    const attrs = new Map<string, string>();
    let pauseCalls = 0;
    let loadCalls = 0;
    let replaceChildrenCalls = 0;
    const mockVideo = {
      defaultMuted: false,
      muted: false,
      volume: 0.9,
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
      removeAttribute(name: string) {
        attrs.delete(name);
      },
      pause() {
        pauseCalls += 1;
      },
      load() {
        loadCalls += 1;
      },
    };
    const mockContainer = {
      replaceChildren() {
        replaceChildrenCalls += 1;
      },
    };

    // videoAudioEnabled: false (muted = true) forces muted === true AND volume === 0
    applyVideoAudio(mockVideo, true, 0.8);
    assert.equal(mockVideo.defaultMuted, true);
    assert.equal(mockVideo.muted, true);
    assert.equal(mockVideo.volume, 0);
    assert.equal(attrs.has("muted"), true);

    // Unmuted with positive volume restores exact clamped volume and removes muted attribute
    applyVideoAudio(mockVideo, false, 0.65);
    assert.equal(mockVideo.defaultMuted, false);
    assert.equal(mockVideo.muted, false);
    assert.equal(mockVideo.volume, 0.65);
    assert.equal(attrs.has("muted"), false);

    // Unmuted with volume === 0 still forces muted === true and volume === 0
    applyVideoAudio(mockVideo, false, 0);
    assert.equal(mockVideo.defaultMuted, true);
    assert.equal(mockVideo.muted, true);
    assert.equal(mockVideo.volume, 0);
    assert.equal(attrs.has("muted"), true);

    // Cleanup unconditionally silences, pauses, strips src, reloads, and empties host container
    attrs.set("src", "http://127.0.0.1:47910/v1/wallpapers/media/demo");
    mockVideo.muted = false;
    mockVideo.volume = 0.7;
    disposeVideoElement(mockVideo, mockContainer);
    assert.equal(mockVideo.defaultMuted, true);
    assert.equal(mockVideo.muted, true);
    assert.equal(mockVideo.volume, 0);
    assert.equal(attrs.has("muted"), true);
    assert.equal(attrs.has("src"), false);
    assert.equal(pauseCalls, 1);
    assert.equal(loadCalls, 1);
    assert.equal(replaceChildrenCalls, 1);

    // 3. WebWallpaperStage audio + listener postMessage dispatch & unmount silence
    assert.deepEqual(buildWebWallpaperAudioPayload(true, 0.7), {
      type: "prismuxWallpaperAudio",
      muted: true,
      volume: 0,
    });
    assert.deepEqual(buildWebWallpaperAudioPayload(false, 0), {
      type: "prismuxWallpaperAudio",
      muted: true,
      volume: 0,
    });
    assert.deepEqual(buildWebWallpaperAudioPayload(false, 0.45), {
      type: "prismuxWallpaperAudio",
      muted: false,
      volume: 0.45,
    });

    const posted: Array<{ msg: unknown; origin: string }> = [];
    const mockIframeWin = {
      postMessage(msg: unknown, targetOrigin: string) {
        posted.push({ msg, origin: targetOrigin });
      },
    };
    const sampleProps = [
      {
        name: "speed",
        ptype: "slider" as const,
        text: "速度",
        order: 1,
        value: 1.5,
        defaultValue: 1,
        overridden: true,
      },
    ];
    dispatchWebWallpaperRuntimeState(mockIframeWin, {
      userProps: sampleProps,
      fpsLimit: 30,
      paused: false,
      muted: true,
      volume: 0.8,
      objectFit: "contain",
    });
    assert.equal(posted.length, 2);
    assert.deepEqual(posted[0], {
      msg: { type: "prismuxWallpaperAudio", muted: true, volume: 0 },
      origin: "*",
    });
    assert.deepEqual(posted[1], {
      msg: buildWebWallpaperListenerPayload({
        userProps: sampleProps,
        fpsLimit: 30,
        paused: false,
        muted: true,
        volume: 0.8,
        objectFit: "contain",
      }),
      origin: "*",
    });
    assert.deepEqual(posted[1]?.msg, {
      type: "wallpaperPropertyListener",
      applyUserProperties: { speed: { value: 1.5 } },
      applyGeneralProperties: { fps: 30, paused: false },
      audio: { muted: true, volume: 0 },
      objectFit: "contain",
    });

    // Unmount / src switch immediately sends muted audio message and navigates iframe to about:blank
    const cleanupPosted: unknown[] = [];
    const mockIframe = {
      src: "http://127.0.0.1:47910/v1/wallpapers/web-t/tok/3650874083/index.html",
      contentWindow: {
        postMessage(msg: unknown) {
          cleanupPosted.push(msg);
        },
      },
    };
    silenceAndBlankIframe(mockIframe);
    assert.deepEqual(cleanupPosted, [
      { type: "prismuxWallpaperAudio", muted: true, volume: 0 },
    ]);
    assert.equal(mockIframe.src, "about:blank");

    // 4. Verify all 5 VideoStage timings, WebWallpaperStage bridge readiness, and WallpaperStage prop wiring
    const testDir = dirname(fileURLToPath(import.meta.url));
    const pkgRoot = join(testDir, "..", "..");
    const stageSrc = await readFile(join(pkgRoot, "src", "WallpaperStage.tsx"), "utf8");
    assert.match(stageSrc, /addEventListener\("loadedmetadata",\s*handleLoadedMetadata\)/);
    assert.match(stageSrc, /addEventListener\("volumechange",\s*handleVolumeChange\)/);
    assert.match(stageSrc, /isDisposed\?:\s*\(\)\s*=>\s*boolean/);
    assert.match(stageSrc, /data\.type === "prismuxWeBridgeReady"/);
    assert.match(stageSrc, /data\.type === "prismuxWebReady"/);
    assert.match(stageSrc, /setRenderReadySrc\(src\);[\s\S]*?2500/);
    assert.match(stageSrc, /paused=\{liveRuntimePaused \|\| !settings\.sceneLive\}/);
    assert.equal(
      (stageSrc.match(/muted=\{!settings\.videoAudioEnabled\}/g) ?? []).length,
      3,
      "VideoStage + web WebWallpaperStage + scene WebWallpaperStage must all receive muted={!settings.videoAudioEnabled}",
    );
    assert.equal(
      (stageSrc.match(/objectFit=\{settings\.objectFit\}/g) ?? []).length,
      3,
      "both WebWallpaperStage sites and SteamSceneFallback must receive objectFit={settings.objectFit}",
    );
  });

  it("enforces opt-in advancedEngineEnabled gate, smooth upgrade migration, rotation exclusion, red gated UI, settings grid virtualization, and stage perf fixes (Wave 2)", async () => {
    // 1. Default advancedEngineEnabled === false + helpers
    assert.equal(createDefaultSettings().advancedEngineEnabled, false);
    assert.equal(isAdvancedWallpaperType("web"), true);
    assert.equal(isAdvancedWallpaperType("scene"), true);
    assert.equal(isAdvancedWallpaperType("video"), false);
    assert.equal(isAdvancedWallpaperType("image"), false);
    assert.equal(isWallpaperGatedByEngine(sampleWallpapers[2], createDefaultSettings()), true);
    assert.equal(isWallpaperGatedByEngine(sampleWallpapers[0], createDefaultSettings()), false);

    // 2. Smooth upgrade migration: legacy active web/scene migrates to true; image/video/none stays false; explicit false respected
    const migratedWebStore = createWallpaperStore({
      wallpapers: sampleWallpapers,
      includeBuiltins: false,
      storage: createMemoryStorage(),
      settings: { selectedId: "w3" }, // w3 is type: "web", no advancedEngineEnabled provided
    });
    assert.equal(migratedWebStore.getSnapshot().settings.advancedEngineEnabled, true);
    migratedWebStore.dispose();

    const deferredSceneStore = createWallpaperStore({
      wallpapers: [],
      includeBuiltins: false,
      storage: createMemoryStorage(),
      settings: { selectedId: "w4" }, // catalog not yet loaded
    });
    assert.equal(deferredSceneStore.getSnapshot().settings.advancedEngineEnabled, false);
    deferredSceneStore.setWallpapers(sampleWallpapers); // w4 is type: "scene"
    assert.equal(deferredSceneStore.getSnapshot().settings.advancedEngineEnabled, true);
    deferredSceneStore.dispose();

    const imageUserStore = createWallpaperStore({
      wallpapers: sampleWallpapers,
      includeBuiltins: false,
      storage: createMemoryStorage(),
      settings: { selectedId: "w1" }, // image
    });
    assert.equal(imageUserStore.getSnapshot().settings.advancedEngineEnabled, false);
    imageUserStore.dispose();

    const explicitOffStore = createWallpaperStore({
      wallpapers: sampleWallpapers,
      includeBuiltins: false,
      storage: createMemoryStorage(),
      settings: { selectedId: "w3", advancedEngineEnabled: false },
    });
    assert.equal(explicitOffStore.getSnapshot().settings.advancedEngineEnabled, false);
    explicitOffStore.dispose();

    // 3. Library visibility vs selection block vs rotation exclusion vs disable cleanup
    const blockedItems: string[] = [];
    const store = createWallpaperStore({
      wallpapers: sampleWallpapers,
      includeBuiltins: false,
      storage: createMemoryStorage(),
      onGatedSelectionBlocked: (w) => blockedItems.push(w.id),
    });

    // filterVisibleWallpapers KEEPS web & scene visible when disabled
    const visible = filterVisibleWallpapers(sampleWallpapers, store.getSnapshot().settings);
    assert.equal(visible.some((w) => w.type === "web"), true);
    assert.equal(visible.some((w) => w.type === "scene"), true);

    // resolveRotationCandidates EXCLUDES web & scene when disabled
    const rotDisabled = resolveRotationCandidates(sampleWallpapers, store.getSnapshot().settings);
    assert.equal(rotDisabled.some((w) => w.type === "web" || w.type === "scene"), false);
    assert.deepEqual(
      rotDisabled.map((w) => w.id),
      ["w1", "w2"],
    );

    // Clicking a gated web/scene item blocks selection & records gatedAttempt without changing selectedId
    store.selectWallpaper("w1");
    assert.equal(store.getSnapshot().settings.selectedId, "w1");
    store.selectWallpaper("w3");
    assert.equal(store.getSnapshot().settings.selectedId, "w1", "gated selection must not overwrite selectedId");
    assert.equal(store.getSnapshot().gatedAttempt?.wallpaper.id, "w3");
    assert.deepEqual(blockedItems, ["w3"]);

    // 1-click enableAdvancedEngineAndSelect unlocks and selects the blocked wallpaper cleanly
    store.enableAdvancedEngineAndSelect();
    assert.equal(store.getSnapshot().settings.advancedEngineEnabled, true);
    assert.equal(store.getSnapshot().settings.selectedId, "w3");
    assert.equal(store.getSnapshot().gatedAttempt, null);

    // Turning advancedEngineEnabled true -> false while a web/scene wallpaper is active clears it immediately
    store.setSetting("advancedEngineEnabled", false);
    assert.equal(store.getSnapshot().settings.advancedEngineEnabled, false);
    assert.equal(store.getSnapshot().settings.selectedId, null);
    assert.equal(store.getSnapshot().settings.playing, false);

    // Turning advancedEngineEnabled true -> false while an image/video wallpaper is active keeps it intact
    store.setSetting("advancedEngineEnabled", true);
    store.selectWallpaper("w2");
    store.setSetting("advancedEngineEnabled", false);
    assert.equal(store.getSnapshot().settings.selectedId, "w2");
    store.dispose();

    // 4. Performance helpers & virtualization constants
    assert.equal(resolveEffectiveLiveFps(60, 30), 30);
    assert.equal(resolveEffectiveLiveFps(30, 60), 30);
    assert.equal(resolveEffectiveLiveFps(60, 0), 60);
    assert.deepEqual([...WATCHDOG_BACKOFF_MS], [1800, 3500, 7000]);
    assert.equal(SETTINGS_VIRTUALIZE_THRESHOLD, 24);
    assert.equal(SETTINGS_VP_FIRST, 24);

    // 5. Static source verification of Wave 2 fixes & red disabled UI/CSS invariants
    const testDir = dirname(fileURLToPath(import.meta.url));
    const pkgRoot = join(testDir, "..", "..");
    const [stageSrc, quickSrc, settingsSrc, playbackSrc, panelCss] = await Promise.all([
      readFile(join(pkgRoot, "src", "WallpaperStage.tsx"), "utf8"),
      readFile(join(pkgRoot, "src", "WallpaperQuickPanel.tsx"), "utf8"),
      readFile(join(pkgRoot, "src", "WallpaperSettingsView.tsx"), "utf8"),
      readFile(join(pkgRoot, "src", "renderers", "PlaybackSections.tsx"), "utf8"),
      readFile(join(pkgRoot, "src", "styles", "wallpaper-panel.css"), "utf8"),
    ]);

    // WallpaperStage: no per-frame syncSize() inside paintOnce(), no React setParallax state, hard engine gate, wired perf knobs
    const paintOnceBlock = stageSrc.slice(
      stageSrc.indexOf("const paintOnce ="),
      stageSrc.indexOf("const tick ="),
    );
    assert.doesNotMatch(paintOnceBlock, /syncSize\(/, "paintOnce must not call syncSize() per frame");
    assert.doesNotMatch(stageSrc, /setParallax/, "SteamSceneFallback must update DOM ref directly without React setParallax");
    assert.match(stageSrc, /parallaxPosRef = useRef\(\{ x: 0, y: 0 \}\)/);
    assert.match(stageSrc, /\}, \[parallaxEnabled\]\);/);
    assert.match(stageSrc, /\.\.\.\(parallaxEnabled \? \{\} : \{ transform: staticTransform \}\)/);
    assert.match(stageSrc, /if \(!currentWallpaper \|\| engineGated\)/);
    assert.match(stageSrc, /useBatteryDischarging/);
    assert.match(stageSrc, /useDeferredLiveBoot/);
    assert.match(stageSrc, /sceneSoftRenderPause/);

    // QuickPanel & SettingsView: red disabled badges, aria-disabled, inline enable banner, settings grid virtualization
    assert.match(quickSrc, /pmx-wp-qp__card--gated/);
    assert.match(quickSrc, /渲染引擎未开启/);
    assert.match(quickSrc, /data-pmx-engine-gate-banner="1"/);
    assert.match(quickSrc, /开启高级渲染引擎/);
    assert.match(settingsSrc, /pmx-wp-card--gated/);
    assert.match(settingsSrc, /渲染引擎未开启/);
    assert.match(settingsSrc, /data-pmx-engine-gate-banner="1"/);
    assert.match(settingsSrc, /useSettingsGridVirtualWindow/);
    assert.match(settingsSrc, /data-pmx-grid-virtualized=/);
    assert.match(playbackSrc, /高级壁纸渲染引擎（网页 \/ Steam 场景）/);
    assert.match(playbackSrc, /data-pmx-playback-card="advanced-engine"/);

    // CSS: balanced braces, zero prefers-color-scheme, gated red card & banner styles present
    const cssNoComments = panelCss.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.equal(cssNoComments.includes("prefers-color-scheme"), false);
    assert.equal(
      (cssNoComments.match(/\{/g) ?? []).length,
      (cssNoComments.match(/\}/g) ?? []).length,
    );
    assert.match(panelCss, /\.pmx-wp-qp__card--gated/);
    assert.match(panelCss, /\.pmx-wp-card--gated/);
    assert.match(panelCss, /\.pmx-wp-gate-banner\s*\{/);
  });
});
