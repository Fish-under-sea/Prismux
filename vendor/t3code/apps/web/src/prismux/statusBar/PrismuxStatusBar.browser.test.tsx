import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { PrismuxStatusBar } from "../PrismuxStatusBar";
import { STATUS_BAR_VISIBILITY_STORAGE_KEY } from "./statusBarVisibility";

function renderStatusBarInRouter() {
  const rootRoute = createRootRoute({
    component: () => <PrismuxStatusBar />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router} />);
}

describe("PrismuxStatusBar (browser)", () => {
  it("renders a single-line 24px bar, persists right-click visibility toggles, and maps wheel deltaY to scrollLeft", async () => {
    window.localStorage.removeItem(STATUS_BAR_VISIBILITY_STORAGE_KEY);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await using screen = await renderStatusBarInRouter();
    const bar = screen.getByRole("contentinfo", { name: "Prismux 状态栏" });
    await expect.element(bar).toBeVisible();

    const barEl = bar.element() as HTMLElement;
    expect(Math.round(barEl.getBoundingClientRect().height)).toBe(24);
    expect(screen.getByTestId("status-bar-usage-trigger").element()).toBeTruthy();
    expect(screen.getByTestId("status-bar-context-trigger").element()).toBeTruthy();
    expect(screen.getByTestId("status-bar-cache-badge").element()).toBeTruthy();
    expect(screen.getByTestId("status-bar-ports-trigger").element()).toBeTruthy();
    expect(screen.getByTestId("status-bar-resources-trigger").element()).toBeTruthy();

    // Right-click opens segment visibility menu and hides Cache segment with localStorage persistence.
    barEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 80, clientY: 20 }));
    const menu = screen.getByTestId("prismux-status-bar-context-menu");
    await expect.element(menu).toBeVisible();

    const cacheToggle = screen.getByRole("menuitemcheckbox", { name: "Prompt Cache 命中" });
    await userEvent.click(cacheToggle);

    expect(screen.getByTestId("status-bar-cache-badge").query()).toBeNull();
    const persisted = JSON.parse(
      window.localStorage.getItem(STATUS_BAR_VISIBILITY_STORAGE_KEY) ?? "{}",
    ) as Record<string, unknown>;
    expect(persisted.cache).toBe(false);

    // Wheel vertical deltaY maps to horizontal scrollLeft when scrollable.
    const strip = screen.getByTestId("prismux-status-bar-strip").element() as HTMLDivElement;
    Object.defineProperty(strip, "scrollWidth", { value: 600, configurable: true });
    Object.defineProperty(strip, "clientWidth", { value: 200, configurable: true });
    let scrollLeftValue = 0;
    Object.defineProperty(strip, "scrollLeft", {
      get: () => scrollLeftValue,
      set: (val: number) => {
        scrollLeftValue = Math.max(0, Math.min(400, val));
      },
      configurable: true,
    });
    strip.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 64 }));
    expect(scrollLeftValue).toBe(64);

    // Never performs any unsolicited Antigravity / remote quota fetch.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
