import { useState } from "react";
import {
  createWallpaperStore,
  ImageCrossfadeStage,
  WallpaperSettingsView,
  WallpaperStage,
} from "@prismux/wallpaper";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import {
  SettingsScopeProvider,
  useSettingsScope,
} from "../components/settings/SettingsScopeContext";
import { CommandPaletteContent } from "../components/CommandPaletteContent";
import {
  CommandDialog,
  CommandDialogPopup,
  CommandItem,
  CommandList,
} from "../components/ui/command";
import { PrismuxDaemonClient, prismuxDaemonClient } from "./daemonClient";
import { PrismuxRuntimeProvider, usePrismuxRuntime } from "./PrismuxRuntimeProvider";

describe("Wallpaper, RuntimeProvider, SettingsScope & DaemonClient regression guards (browser)", () => {
  it("clears ImageCrossfadeStage previous slot on transitionend and via fallback timer so old 4K/8K bitmaps are released", async () => {
    const svgA =
      "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/>";
    const svgB =
      "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'/>";
    const svgC =
      "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'/>";

    function Harness() {
      const [src, setSrc] = useState(svgA);
      const [transitionMs, setTransitionMs] = useState(120);
      return (
        <div>
          <button type="button" onClick={() => setSrc(svgB)}>
            Switch B
          </button>
          <button
            type="button"
            onClick={() => {
              setTransitionMs(60);
              setSrc(svgC);
            }}
          >
            Switch C
          </button>
          <ImageCrossfadeStage
            src={src}
            paused={false}
            showAmbient={false}
            mediaStyle={{ objectFit: "cover" }}
            transitionMs={transitionMs}
          />
        </div>
      );
    }

    await using screen = await render(<Harness />, { router: false });
    expect(document.querySelector('[data-pmx-wp-slot="previous"]')).toBeNull();

    // 1. Switch A -> B: previous slot appears, then transitionend removes it immediately once loaded
    await act(() => {
      (screen.getByRole("button", { name: "Switch B" }).element() as HTMLElement).click();
    });
    await vi.waitFor(() => {
      expect(document.querySelector('[data-pmx-wp-slot="previous"]')).not.toBeNull();
    });
    const currB = document.querySelector<HTMLImageElement>('[data-pmx-wp-slot="current"]')!;
    await act(() => {
      currB.dispatchEvent(new Event("load"));
    });
    const prevA = document.querySelector<HTMLImageElement>('[data-pmx-wp-slot="previous"]');
    if (prevA) {
      await act(() => {
        prevA.dispatchEvent(new TransitionEvent("transitionend", { propertyName: "opacity" }));
      });
    }
    await vi.waitFor(() => {
      expect(document.querySelector('[data-pmx-wp-slot="previous"]')).toBeNull();
    });

    // 2. Switch B -> C without firing transitionend: fallback timer (transitionMs + 50ms) clears previous
    await act(() => {
      (screen.getByRole("button", { name: "Switch C" }).element() as HTMLElement).click();
    });
    await vi.waitFor(() => {
      expect(document.querySelector('[data-pmx-wp-slot="previous"]')).not.toBeNull();
    });
    const currC = document.querySelector<HTMLImageElement>('[data-pmx-wp-slot="current"]')!;
    await act(() => {
      currC.dispatchEvent(new Event("load"));
    });
    await vi.waitFor(
      () => {
        expect(document.querySelector('[data-pmx-wp-slot="previous"]')).toBeNull();
      },
      { timeout: 600 },
    );
  });

  it("tracks standalone offline-imported blob URLs in WallpaperSettingsView and revokes them on replace and unmount", async () => {
    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];
    let counter = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      counter += 1;
      const url = `blob:http://localhost/offline-wp-${counter}`;
      createdUrls.push(url);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
      revokedUrls.push(String(url));
    });

    const store = createWallpaperStore({
      includeBuiltins: false,
      wallpapers: [],
    });

    try {
      await using screen = await render(<WallpaperSettingsView store={store} />, { router: false });
      const fileInput = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!;
      expect(fileInput).not.toBeNull();

      const dt1 = new DataTransfer();
      dt1.items.add(new File(["png-bytes-1"], "first.png", { type: "image/png" }));
      Object.defineProperty(fileInput, "files", { value: dt1.files, configurable: true });
      await act(() => {
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await vi.waitFor(() => {
        expect(createdUrls).toHaveLength(1);
        expect(store.getSnapshot().wallpapers).toHaveLength(1);
      });

      // Replacing the library inventory drops the offline item and revokes its blob URL
      await act(() => {
        store.setWallpapers([]);
      });
      await vi.waitFor(() => {
        expect(revokedUrls).toContain(createdUrls[0]);
      });

      // Import a second offline wallpaper, then unmount WallpaperSettingsView -> revokes remaining blob URL
      const dt2 = new DataTransfer();
      dt2.items.add(new File(["png-bytes-2"], "second.png", { type: "image/png" }));
      Object.defineProperty(fileInput, "files", { value: dt2.files, configurable: true });
      await act(() => {
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await vi.waitFor(() => {
        expect(createdUrls).toHaveLength(2);
      });

      await screen.unmount();
      expect(revokedUrls).toContain(createdUrls[1]);
    } finally {
      store.dispose();
      vi.restoreAllMocks();
    }
  });

  it("tracks offline-imported blob URLs in PrismuxRuntimeProvider and revokes them on inventory replacement and unmount", async () => {
    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];
    let counter = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      counter += 1;
      const url = `blob:http://localhost/runtime-wp-${counter}`;
      createdUrls.push(url);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
      revokedUrls.push(String(url));
    });
    vi.spyOn(prismuxDaemonClient, "getConnectionInfo").mockResolvedValue({
      ready: false,
      baseUrl: "",
      token: "",
    });

    const capturedRuntime: Array<ReturnType<typeof usePrismuxRuntime>> = [];
    function RuntimeCapture() {
      capturedRuntime.push(usePrismuxRuntime());
      return null;
    }

    try {
      await using screen = await render(
        <PrismuxRuntimeProvider>
          <RuntimeCapture />
        </PrismuxRuntimeProvider>,
        { router: false },
      );

      const runtimeApi = capturedRuntime.at(-1);
      expect(runtimeApi).toBeDefined();
      const { wallpaperStore, wallpaperHost } = runtimeApi!;

      await act(async () => {
        await wallpaperStore.importLocalFiles(wallpaperHost, [
          new File(["img-1"], "offline-a.png", { type: "image/png" }),
        ]);
      });
      expect(createdUrls).toHaveLength(1);
      expect(revokedUrls).toHaveLength(0);

      // Replacing inventory revokes removed offline blob URL immediately
      await act(() => {
        wallpaperStore.setWallpapers([]);
      });
      expect(revokedUrls).toContain(createdUrls[0]);

      // Importing a second offline blob and unmounting provider revokes it cleanly
      await act(async () => {
        await wallpaperStore.importLocalFiles(wallpaperHost, [
          new File(["img-2"], "offline-b.png", { type: "image/png" }),
        ]);
      });
      expect(createdUrls).toHaveLength(2);

      await screen.unmount();
      expect(revokedUrls).toContain(createdUrls[1]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("removes the abort event listener in subscribeUpdaterEvents when manually unsubscribed", () => {
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

    try {
      const client = new PrismuxDaemonClient();
      vi.spyOn(client, "getConnectionInfo").mockImplementation(() => new Promise(() => {}));

      const unsubscribe = client.subscribeUpdaterEvents(() => {}, {
        signal: controller.signal,
      });

      expect(addSpy).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
      const registeredListener = addSpy.mock.calls.find(([type]) => type === "abort")?.[1];
      expect(registeredListener).toBeTypeOf("function");

      unsubscribe();
      expect(removeSpy).toHaveBeenCalledWith("abort", registeredListener);
      // Calling unsubscribe a second time is idempotent
      unsubscribe();
      expect(removeSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("does not steal focus in CommandPaletteContent when an active [data-app-modal] is present", async () => {
    function Harness({ items }: { readonly items: readonly string[] }) {
      return (
        <>
          <div data-app-modal="" role="dialog" aria-label="Settings">
            <input data-testid="app-modal-field" aria-label="Modal field" />
          </div>
          <CommandDialog open modal={false}>
            <CommandDialogPopup aria-label="Command palette" initialFocus={false}>
              <CommandPaletteContent items={items} inputProps={{ placeholder: "Palette search" }}>
                <CommandList>
                  {(item: string) => (
                    <CommandItem key={item} value={item}>
                      {item}
                    </CommandItem>
                  )}
                </CommandList>
              </CommandPaletteContent>
            </CommandDialogPopup>
          </CommandDialog>
        </>
      );
    }

    await using screen = await render(<Harness items={["Alpha"]} />, { router: false });
    const modalField = document.querySelector<HTMLInputElement>('[data-testid="app-modal-field"]')!;
    expect(modalField).not.toBeNull();
    modalField.focus();
    expect(document.activeElement).toBe(modalField);

    // Rerendering CommandPaletteContent while [data-app-modal] is active must not steal focus
    await screen.rerender(<Harness items={["Alpha", "Beta"]} />);
    expect(document.activeElement).toBe(modalField);
  });

  it("memoizes SettingsScopeProvider context value across parent rerenders with inline onChange", async () => {
    const seenValues: Array<ReturnType<typeof useSettingsScope>> = [];
    const stableSearch = {};

    function ScopeProbe() {
      const scope = useSettingsScope();
      seenValues.push(scope);
      return <output data-testid="scope-kind">{scope.scope.kind}</output>;
    }

    function Harness() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setTick((v) => v + 1)}>
            Rerender {tick}
          </button>
          <SettingsScopeProvider search={stableSearch} onChange={() => {}}>
            <ScopeProbe />
          </SettingsScopeProvider>
        </>
      );
    }

    await using screen = await render(<Harness />, { router: "/settings/general" });
    const first = seenValues.at(-1);
    expect(first).toBeDefined();

    await act(() => {
      (screen.getByRole("button", { name: /Rerender/ }).element() as HTMLElement).click();
    });
    expect(seenValues.at(-1)).toBe(first);
  });

  it("renders WallpaperStage cleanly for image wallpapers", async () => {
    const store = createWallpaperStore({
      includeBuiltins: false,
      wallpapers: [
        {
          id: "img-1",
          title: "Test Image",
          type: "image",
          source: "custom",
          previewUrl: null,
          mediaUrl:
            "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/>",
          filePath: null,
          width: 4,
          height: 4,
          orientation: "square",
          contentRating: "everyone",
        },
      ],
      settings: { selectedId: "img-1" },
    });
    try {
      await using _screen = await render(<WallpaperStage store={store} />, { router: false });
      expect(document.querySelector('[data-pmx-wp-slot="current"]')).not.toBeNull();
    } finally {
      store.dispose();
    }
  });
});
