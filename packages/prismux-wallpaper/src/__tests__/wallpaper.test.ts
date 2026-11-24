import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  closeInlineAppearanceInStore,
  openInlineAppearanceInStore,
  resolveQuickPanelTab,
} from "../WallpaperQuickPanel.js";
import {
  importLocalWallpaperFile,
  isPathInsideDir,
  parseByteRange,
  parseLibraryFoldersVdf,
  prepareMediaRangeResponse,
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
  normalizeWallpaperFadeOpacity,
  normalizeWallpaperScrim,
  pickNextWallpaperId,
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
    // Native fade color must stay strictly achromatic (#ffffff / #000000) with zero warm/blue cast
    assert.match(
      stageSrc,
      /const nativeFadeColor = settings\.themeMode === "light" \? "#ffffff" : "#000000";/,
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
});
