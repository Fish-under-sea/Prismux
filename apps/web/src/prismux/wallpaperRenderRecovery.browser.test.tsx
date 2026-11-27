import {
  createWallpaperStore,
  ImageCrossfadeStage,
  WallpaperStage,
  WebWallpaperStage,
  type WallpaperItem,
} from "@prismux/wallpaper";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../test/render";
import { prismuxDaemonClient } from "./daemonClient";
import { PrismuxRuntimeProvider, usePrismuxRuntime } from "./PrismuxRuntimeProvider";
import { PrismuxWallpaperBackdrop } from "./PrismuxWallpaperBridge";

function makeVideoWallpaper(
  id: string,
  mediaUrl: string,
  poster: string | null = null,
): WallpaperItem {
  return {
    id,
    title: `Video ${id}`,
    type: "video",
    source: "steam",
    previewUrl: poster,
    mediaUrl,
    filePath: null,
    width: 1920,
    height: 1080,
    orientation: "landscape",
    contentRating: "everyone",
  };
}

describe("Wallpaper render loss & recovery regression guards (browser)", () => {
  it("recovers video playback from readyState=0, already-buffered readyState>=2, and ended-loop without sticking at opacity 0", async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      Object.defineProperty(this, "paused", { value: false, configurable: true });
      return Promise.resolve();
    });
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      Object.defineProperty(this, "paused", { value: true, configurable: true });
    });
    const loadSpy = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});

    const store = createWallpaperStore({
      includeBuiltins: false,
      wallpapers: [
        makeVideoWallpaper("vid-1", "http://127.0.0.1:47910/v1/wallpapers/media/vid-1?token=t1"),
      ],
      settings: {
        selectedId: "vid-1",
        playing: true,
        videoAudioEnabled: false,
      },
    });

    try {
      await using screen = await render(<WallpaperStage store={store} occluded={true} />, {
        router: false,
      });

      const video = screen.container.querySelector("video")!;
      const layer = screen.container.querySelector<HTMLElement>(".pmx-wp-stage__video-layer")!;
      expect(video).not.toBeNull();
      expect(video.muted).toBe(true);
      expect(video.volume).toBe(0);

      // 1. Start occluded with readyState=0, then un-occlude -> triggers load() + play()
      Object.defineProperty(video, "readyState", { value: 0, configurable: true });
      Object.defineProperty(video, "networkState", { value: 0, configurable: true });
      Object.defineProperty(video, "paused", { value: true, configurable: true });
      loadSpy.mockClear();
      playSpy.mockClear();

      await screen.rerender(<WallpaperStage store={store} occluded={false} />);
      expect(loadSpy).toHaveBeenCalledTimes(1);
      expect(playSpy).toHaveBeenCalledTimes(1);
      expect(video.muted).toBe(true);
      expect(video.volume).toBe(0);

      // 2. Simulate Chromium delivering cached frame (readyState=4) without firing loadeddata again,
      // then waking on window focus -> layer immediately becomes visible (opacity: 1) and plays.
      Object.defineProperty(video, "readyState", { value: 4, configurable: true });
      Object.defineProperty(video, "networkState", { value: 1, configurable: true });
      Object.defineProperty(video, "paused", { value: true, configurable: true });
      playSpy.mockClear();

      await act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await vi.waitFor(() => {
        expect(layer.style.opacity).toBe("1");
        expect(playSpy).toHaveBeenCalled();
      });

      // 3. Simulate ended state while loop=true -> restarts playback on wake
      Object.defineProperty(video, "ended", { value: true, configurable: true });
      Object.defineProperty(video, "paused", { value: true, configurable: true });
      playSpy.mockClear();
      await act(() => {
        video.dispatchEvent(new Event("ended"));
      });
      expect(playSpy).toHaveBeenCalledTimes(1);
    } finally {
      store.dispose();
      playSpy.mockRestore();
      pauseSpy.mockRestore();
      loadSpy.mockRestore();
    }
  });

  it("retries video media errors with bounded backoff and fresh resolved URL (token rotation) instead of permanent black screen", async () => {
    using _timers = fakeTimers();
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const loadSpy = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});

    const oldUrl = "http://127.0.0.1:47910/v1/wallpapers/media/vid-err?token=old-tok";
    const freshUrl = "http://127.0.0.1:47910/v1/wallpapers/media/vid-err?token=fresh-tok";
    const refreshMock = vi.fn(async () => freshUrl);

    const store = createWallpaperStore({
      includeBuiltins: false,
      wallpapers: [makeVideoWallpaper("vid-err", oldUrl)],
      settings: { selectedId: "vid-err", playing: true, videoAudioEnabled: false },
    });

    try {
      await using screen = await render(
        <WallpaperStage store={store} onRequestMediaRefresh={refreshMock} />,
        { router: false },
      );
      const video = screen.container.querySelector("video")!;
      const layer = screen.container.querySelector<HTMLElement>(".pmx-wp-stage__video-layer")!;
      expect(video.getAttribute("src")).toBe(oldUrl);

      // Trigger media error (simulating daemon restart / 401 token rotation)
      Object.defineProperty(video, "readyState", { value: 0, configurable: true });
      Object.defineProperty(video, "error", {
        value: { code: 2, message: "HTTP 401" },
        configurable: true,
      });
      await act(() => {
        video.dispatchEvent(new Event("error"));
      });
      expect(store.getSnapshot().videoError).toContain("网络或鉴权异常");
      expect(layer.style.opacity).toBe("0");

      // Advance past first backoff delay (1800ms): refresh hook fetches fresh URL, reloads, plays
      loadSpy.mockClear();
      playSpy.mockClear();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1900);
      });
      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(video.getAttribute("src")).toBe(freshUrl);
      expect(loadSpy).toHaveBeenCalled();
      expect(playSpy).toHaveBeenCalled();
      expect(video.muted).toBe(true);
      expect(video.volume).toBe(0);

      // Fresh stream succeeds -> error clears and video fades back to opacity 1
      Object.defineProperty(video, "error", { value: null, configurable: true });
      Object.defineProperty(video, "readyState", { value: 4, configurable: true });
      await act(() => {
        video.dispatchEvent(new Event("canplay"));
      });
      expect(store.getSnapshot().videoError).toBeNull();
      expect(layer.style.opacity).toBe("1");
    } finally {
      store.dispose();
      playSpy.mockRestore();
      pauseSpy.mockRestore();
      loadSpy.mockRestore();
    }
  });

  it("self-heals stale occluded=true on live focus/input wake while strictly honoring initial occlusion and user manual pause", async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    const store = createWallpaperStore({
      includeBuiltins: false,
      wallpapers: [
        makeVideoWallpaper("vid-occ", "http://127.0.0.1:47910/v1/wallpapers/media/vid-occ"),
      ],
      settings: { selectedId: "vid-occ", playing: true },
    });

    try {
      const syncOcclusion = vi.fn(async () => false);
      await using screen = await render(
        <WallpaperStage store={store} occluded={true} onRequestOcclusionSync={syncOcclusion} />,
        { router: false },
      );

      const stage = screen.container.querySelector<HTMLElement>('[data-pmx-wallpaper-stage="1"]')!;
      // Initial explicit occluded=true is honored immediately (0 FPS redline)
      expect(stage.dataset.pmxWallpaperOccluded).toBe("1");
      expect(stage.dataset.pmxWallpaperPaused).toBe("1");

      // Subsequent live focus while document is visible verifies with host and self-heals
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await Promise.resolve();
      });
      await vi.waitFor(() => {
        expect(syncOcclusion).toHaveBeenCalled();
        expect(stage.dataset.pmxWallpaperOccluded).toBe("0");
        expect(stage.dataset.pmxWallpaperPaused).toBe("0");
      });

      // User manual pause must NEVER be overridden by wake events
      await act(() => {
        store.setPlaying(false);
      });
      expect(stage.dataset.pmxWallpaperPaused).toBe("1");
      await act(() => {
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("pointerdown"));
      });
      expect(stage.dataset.pmxWallpaperPaused).toBe("1");
    } finally {
      store.dispose();
      playSpy.mockRestore();
      pauseSpy.mockRestore();
    }
  });

  it("keeps live VideoStage mounted across transient inventory refresh errors and auto-hydrates missing selectedId in PrismuxWallpaperBackdrop", async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const loadSpy = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});

    const item = makeVideoWallpaper(
      "vid-keep",
      "http://127.0.0.1:47910/v1/wallpapers/media/vid-keep",
    );
    const store = createWallpaperStore({
      includeBuiltins: false,
      wallpapers: [item],
      settings: { selectedId: "vid-keep", playing: true },
    });

    try {
      await using screen = await render(<WallpaperStage store={store} />, { router: false });
      const initialVideo = screen.container.querySelector("video")!;
      expect(initialVideo).not.toBeNull();

      // Failing refresh returns empty list + error -> must NOT unmount or replace the active <video> node
      await act(async () => {
        await store.refreshLibrary(
          {
            listWallpapers: async () => ({
              wallpapers: [],
              steamRoots: [],
              customDir: "",
              error: "daemon temporarily offline",
            }),
          },
          true,
        );
      });
      expect(screen.container.querySelector('[data-pmx-wallpaper-id="vid-keep"]')).not.toBeNull();
      expect(screen.container.querySelector("video")).toBe(initialVideo);
    } finally {
      store.dispose();
    }

    // PrismuxWallpaperBackdrop auto-hydrates when selectedId exists before catalog loads
    let listCalls = 0;
    const connSpy = vi.spyOn(prismuxDaemonClient, "getConnectionInfo").mockResolvedValue({
      ready: true,
      baseUrl: "http://127.0.0.1:47910",
      token: "tok-auto",
    });
    const appearanceSpy = vi.spyOn(prismuxDaemonClient, "getAppearance").mockResolvedValue({
      wallpaper: { selectedId: "vid-auto", playing: true },
    });
    const invSpy = vi
      .spyOn(prismuxDaemonClient, "getWallpaperInventory")
      .mockImplementation(async () => {
        listCalls += 1;
        // First call fails transiently (simulating daemon warming up); subsequent wake retry succeeds
        if (listCalls === 1) {
          throw new Error("warming up");
        }
        return {
          schemaVersion: 1,
          scannedAt: Date.now(),
          customWallpaperDir: "/custom",
          customDirs: [],
          steamRootOverride: "",
          steamRoots: [],
          workshopDirs: [],
          totalCount: 1,
          items: [
            {
              id: "vid-auto",
              title: "Auto Hydrated Video",
              type: "video",
              source: "custom",
              previewUrl: null,
              mediaUrl: "/v1/wallpapers/media/vid-auto",
              filePath: null,
              width: 1920,
              height: 1080,
              orientation: "landscape",
              contentRating: "everyone",
            },
          ],
        };
      });
    const fontsSpy = vi
      .spyOn(prismuxDaemonClient, "getSystemFonts")
      .mockResolvedValue({ fonts: [] });
    const chiefSpy = vi.spyOn(prismuxDaemonClient, "getChief").mockRejectedValue(new Error("skip"));
    const updaterSpy = vi
      .spyOn(prismuxDaemonClient, "fetchUpdaterStatus")
      .mockRejectedValue(new Error("skip"));
    const sseSpy = vi
      .spyOn(prismuxDaemonClient, "subscribeUpdaterEvents")
      .mockReturnValue(() => {});

    const capturedStores: Array<ReturnType<typeof usePrismuxRuntime>["wallpaperStore"]> = [];
    function Capture() {
      capturedStores.push(usePrismuxRuntime().wallpaperStore);
      return null;
    }

    try {
      await using screen = await render(
        <PrismuxRuntimeProvider>
          <Capture />
          <PrismuxWallpaperBackdrop />
        </PrismuxRuntimeProvider>,
        { router: false },
      );

      await vi.waitFor(() => {
        expect(capturedStores.at(-1)?.getSnapshot().settings.selectedId).toBe("vid-auto");
      });

      // Trigger wake retry so backdrop auto-hydrates the missing selectedId
      await act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      await vi.waitFor(
        () => {
          expect(
            screen.container.querySelector('[data-pmx-wallpaper-id="vid-auto"]'),
          ).not.toBeNull();
        },
        { timeout: 3000 },
      );
    } finally {
      connSpy.mockRestore();
      appearanceSpy.mockRestore();
      invSpy.mockRestore();
      fontsSpy.mockRestore();
      chiefSpy.mockRestore();
      updaterSpy.mockRestore();
      sseSpy.mockRestore();
      playSpy.mockRestore();
      pauseSpy.mockRestore();
      loadSpy.mockRestore();
    }
  });

  it("recovers ImageCrossfadeStage from transient image errors and re-syncs WebWallpaperStage on focus wake", async () => {
    using _timers = fakeTimers();
    const brokenUrl = "http://127.0.0.1:1/broken-wallpaper.png";
    const recoveredSvg =
      "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'/>";
    const refreshImg = vi.fn(async () => recoveredSvg);

    await using imgScreen = await render(
      <ImageCrossfadeStage
        src={brokenUrl}
        paused={false}
        showAmbient={false}
        mediaStyle={{ objectFit: "cover" }}
        transitionMs={0}
        onRequestMediaRefresh={refreshImg}
      />,
      { router: false },
    );

    const firstImg = imgScreen.container.querySelector<HTMLImageElement>(
      '[data-pmx-wp-slot="current"]',
    )!;
    await act(() => {
      firstImg.dispatchEvent(new Event("error"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1900);
    });

    expect(refreshImg).toHaveBeenCalledTimes(1);
    const recoveredImg = imgScreen.container.querySelector<HTMLImageElement>(
      '[data-pmx-wp-slot="current"]',
    )!;
    expect(recoveredImg.getAttribute("src")).toBe(recoveredSvg);

    // WebWallpaperStage re-dispatches muted runtime state on window focus wake
    await using webScreen = await render(
      <WebWallpaperStage
        src="about:blank"
        userProps={[]}
        paused={false}
        fpsLimit={30}
        muted={true}
        volume={0.5}
        objectFit="cover"
        mediaStyle={{ width: "100%", height: "100%" }}
      />,
      { router: false },
    );
    const iframe = webScreen.container.querySelector("iframe")!;
    const posted: unknown[] = [];
    Object.defineProperty(iframe, "contentWindow", {
      value: {
        postMessage: (msg: unknown) => posted.push(msg),
      },
      configurable: true,
    });
    posted.length = 0;

    await act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(posted).toContainEqual({
      type: "prismuxWallpaperAudio",
      muted: true,
      volume: 0,
    });
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "wallpaperPropertyListener",
        applyGeneralProperties: { fps: 30, paused: false },
      }),
    );
  });
});
