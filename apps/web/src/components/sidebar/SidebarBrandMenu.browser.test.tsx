import { GTProvider, initializeGT } from "gt-react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
import zhCatalog from "../../i18n/translations/zh.json";
import { prismuxDaemonClient } from "../../prismux/daemonClient";
import { PrismuxAutoUpdateHost } from "../../prismux/updates/PrismuxAutoUpdateHost";
import { prismuxUpdateNotifierStore } from "../../prismux/updates/updateNotifierStore";
import { SidebarProvider } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";
import { SidebarBrandMenu } from "./SidebarChrome";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function BrandMenuHarness() {
  initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });
  const zhTranslations = { zh: zhCatalog } as unknown as NonNullable<
    Parameters<typeof GTProvider>[0]["translations"]
  >;
  return (
    <GTProvider locale="zh" translations={zhTranslations}>
      <TooltipProvider>
        <SidebarProvider defaultOpen>
          <div className="p-4">
            <SidebarBrandMenu onBackdrop={false} isElectron defaultOpen />
            <PrismuxAutoUpdateHost />
          </div>
        </SidebarProvider>
      </TooltipProvider>
    </GTProvider>
  );
}

function useCleanUpdateNotifierStore(): Disposable {
  prismuxUpdateNotifierStore.dismissAllForReset();
  return {
    [Symbol.dispose]: () => {
      prismuxUpdateNotifierStore.dismissAllForReset();
    },
  };
}

describe("SidebarBrandMenu inline check for updates", () => {
  it("keeps menu open while checking, guards duplicate clicks, shows emerald up-to-date pill, and resets when closed", async () => {
    await page.viewport(1280, 800);
    using _notifier = useCleanUpdateNotifierStore();
    const firstCheck = createDeferred<Record<string, unknown>>();
    using checkSpy = vi
      .spyOn(prismuxDaemonClient, "checkForUpdates")
      .mockReturnValueOnce(firstCheck.promise);

    await using screen = await render(<BrandMenuHarness />, { router: "/" });

    const menuItem = page.getByRole("menuitem", { name: "检查更新" });
    await vi.waitFor(() =>
      expect(document.querySelector('[data-sidebar-brand-menu-popup="true"]')).not.toBeNull(),
    );

    // Click once -> menu stays open, transitions to checking with spinning icon.
    await userEvent.click(menuItem);
    await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-sidebar-app-menu-item="check-updates"]',
      );
      expect(el?.getAttribute("data-check-updates-state")).toBe("checking");
      expect(el?.getAttribute("aria-busy")).toBe("true");
      expect(el?.textContent).toContain("正在检查更新…");
    });

    // Rapid duplicate click while checking is ignored.
    const checkingItem = page.getByRole("menuitem", { name: "正在检查更新…" });
    await userEvent.click(checkingItem);
    expect(checkSpy).toHaveBeenCalledTimes(1);

    // Resolve with up-to-date -> emerald check icon + version pill, menu stays open, no modal/navigation.
    await act(async () => {
      firstCheck.resolve({
        checkedAt: 1_764_000_000_000,
        currentVersion: "0.2.2-rc.2",
        hasUpdate: false,
        latestVersion: "0.2.2-rc.2",
        sourceUsed: "github",
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-sidebar-app-menu-item="check-updates"]',
      );
      expect(el?.getAttribute("data-check-updates-state")).toBe("up-to-date");
      expect(el?.textContent).toContain("已是最新版本");
      expect(el?.textContent).toContain("v0.2.2-rc.2");
    });
    expect(document.querySelector('[data-testid="prismux-update-release-modal"]')).toBeNull();
    expect(document.querySelector('[data-testid="prismux-update-toast"]')).toBeNull();
    expect(screen.router?.state.location.pathname).toBe("/");

    // Closing and reopening the menu resets cleanly back to idle.
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() =>
      expect(document.querySelector('[data-sidebar-brand-menu-popup="true"]')).toBeNull(),
    );

    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-sidebar-brand-menu-trigger="true"]',
    );
    expect(trigger).not.toBeNull();
    await userEvent.click(page.elementLocator(trigger!));
    await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-sidebar-app-menu-item="check-updates"]',
      );
      expect(el?.getAttribute("data-check-updates-state")).toBe("idle");
      expect(el?.textContent).toContain("检查更新");
    });
  });

  it("re-opens the bottom-right update toast (never modal) even if collapsed to capsule, closes the menu, and keeps toast->modal action intact", async () => {
    using _notifier = useCleanUpdateNotifierStore();
    const updatePayload = {
      checkedAt: 1_764_000_000_000,
      currentVersion: "0.2.2-rc.2",
      hasUpdate: true,
      latestVersion: "0.2.3-rc.1",
      tagName: "v0.2.3-rc.1",
      channel: "prerelease" as const,
      releaseName: "Prismux v0.2.3-rc.1",
      releaseNotes: "## 本次更新亮点\n- 检查更新改为菜单内联动画，发现新版本直出右下角提醒卡片",
      publishedAt: "2026-11-26T10:00:00Z",
      htmlUrl: "https://github.com/Fish-under-sea/Prismux/releases/tag/v0.2.3-rc.1",
      sourceUsed: "github" as const,
      usedFallbackSource: false,
      recommendedAsset: null,
      assets: [],
    };

    // Pre-collapse v0.2.3-rc.1 into sidebar capsule to verify manual check re-opens toast.
    prismuxUpdateNotifierStore.reportUpdateAvailable(updatePayload);
    prismuxUpdateNotifierStore.collapseToCapsule(null, true);
    expect(prismuxUpdateNotifierStore.getState().presentation).toBe("capsule");

    const deferred = createDeferred<Record<string, unknown>>();
    using checkSpy = vi
      .spyOn(prismuxDaemonClient, "checkForUpdates")
      .mockReturnValueOnce(deferred.promise);

    await using screen = await render(<BrandMenuHarness />, { router: "/" });

    await vi.waitFor(() =>
      expect(document.querySelector('[data-sidebar-brand-menu-popup="true"]')).not.toBeNull(),
    );

    const item = page.getByRole("menuitem", { name: "检查更新" });
    await userEvent.click(item);
    expect(checkSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve(updatePayload);
      await Promise.resolve();
    });

    // Bottom-right update toast opens immediately; release modal must NOT open; route stays unchanged.
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="prismux-update-toast"]')).not.toBeNull();
    });
    expect(prismuxUpdateNotifierStore.getState().presentation).toBe("toast");
    expect(document.querySelector('[data-testid="prismux-update-release-modal"]')).toBeNull();
    expect(screen.router?.state.location.pathname).toBe("/");

    // Brand menu closes cleanly after brief inline confirmation.
    await vi.waitFor(() =>
      expect(document.querySelector('[data-sidebar-brand-menu-popup="true"]')).toBeNull(),
    );

    // Clicking "查看更新" inside the bottom-right toast still opens the centered release modal as expected.
    const openModalBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="prismux-update-toast-open"]',
    );
    expect(openModalBtn).not.toBeNull();
    await userEvent.click(page.elementLocator(openModalBtn!));
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="prismux-update-release-modal"]')).not.toBeNull(),
    );
    expect(prismuxUpdateNotifierStore.getState().presentation).toBe("modal");
  });

  it("shows concise inline error feedback without opening a modal and supports one-click retry", async () => {
    using _notifier = useCleanUpdateNotifierStore();
    using checkSpy = vi
      .spyOn(prismuxDaemonClient, "checkForUpdates")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        checkedAt: 1_764_000_000_000,
        currentVersion: "0.2.2-rc.2",
        hasUpdate: false,
        latestVersion: "0.2.2-rc.2",
        sourceUsed: "gitee",
      });

    await using _screen = await render(<BrandMenuHarness />, { router: "/" });

    await vi.waitFor(() =>
      expect(document.querySelector('[data-sidebar-brand-menu-popup="true"]')).not.toBeNull(),
    );

    // First click fails -> inline error shown, menu stays open, no modal.
    await userEvent.click(page.getByRole("menuitem", { name: "检查更新" }));
    await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-sidebar-app-menu-item="check-updates"]',
      );
      expect(el?.getAttribute("data-check-updates-state")).toBe("error");
      expect(el?.textContent).toContain("检查失败，点击重试");
    });
    expect(document.querySelector('[data-testid="prismux-update-release-modal"]')).toBeNull();
    expect(document.querySelector('[data-sidebar-brand-menu-popup="true"]')).not.toBeNull();

    // Second click retries and succeeds with up-to-date.
    await userEvent.click(page.getByRole("menuitem", { name: "检查失败，点击重试" }));
    await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-sidebar-app-menu-item="check-updates"]',
      );
      expect(el?.getAttribute("data-check-updates-state")).toBe("up-to-date");
      expect(el?.textContent).toContain("已是最新版本");
    });
    expect(checkSpy).toHaveBeenCalledTimes(2);
  });
});
