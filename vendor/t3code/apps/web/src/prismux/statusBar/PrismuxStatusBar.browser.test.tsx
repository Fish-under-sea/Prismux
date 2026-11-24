import { useState } from "react";
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
import { aggregateQuotaSummary, type QuotaPreferences } from "./quotaStatus.logic";
import { QuotaStatusPopover } from "./QuotaStatusPopover";
import { ResourcesStatusPopover } from "./ResourcesStatusPopover";
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
  it("renders a single-line 20px shellFrame bar without redundant Ctx/Cache, persists right-click visibility toggles, and maps wheel deltaY to scrollLeft", async () => {
    window.localStorage.removeItem(STATUS_BAR_VISIBILITY_STORAGE_KEY);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await using screen = await renderStatusBarInRouter();
    const bar = screen.getByRole("contentinfo", { name: "Prismux 状态栏" });
    await expect.element(bar).toBeVisible();

    const barEl = bar.element() as HTMLElement;
    expect(Math.round(barEl.getBoundingClientRect().height)).toBe(20);
    expect(barEl.getAttribute("data-pmx-glass-zone")).toBe("shellFrame");

    // Streamlined 5 capsules: Usage + Standalone Quota + Keep Awake + Ports + CPU/RAM.
    expect(screen.getByTestId("status-bar-usage-trigger").element()).toBeTruthy();
    expect(screen.getByTestId("status-bar-quota-trigger").element()).toBeTruthy();
    expect(screen.getByTestId("status-bar-quota-refresh").element()).toBeTruthy();
    expect(screen.getByTestId("status-bar-keep-awake-trigger").element()).toBeTruthy();
    expect(screen.getByTestId("status-bar-ports-trigger").element()).toBeTruthy();
    expect(screen.getByTestId("status-bar-resources-trigger").element()).toBeTruthy();
    expect(screen.getByTestId("status-bar-context-trigger").query()).toBeNull();
    expect(screen.getByTestId("status-bar-cache-badge").query()).toBeNull();

    // Right-click opens glass-aware segment visibility menu and hides Ports segment with localStorage persistence.
    barEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 80, clientY: 20 }));
    const menu = screen.getByTestId("prismux-status-bar-context-menu");
    await expect.element(menu).toBeVisible();
    const menuEl = menu.element() as HTMLElement;
    expect(menuEl.getAttribute("data-pmx-glass-zone")).toBe("overlays");
    expect(menuEl.getAttribute("data-pmx-status-popover")).toBe("1");

    const portsToggle = screen.getByRole("menuitemcheckbox", { name: "监听端口胶囊" });
    await userEvent.click(portsToggle);

    expect(screen.getByTestId("status-bar-ports-trigger").query()).toBeNull();
    const persisted = JSON.parse(
      window.localStorage.getItem(STATUS_BAR_VISIBILITY_STORAGE_KEY) ?? "{}",
    ) as Record<string, unknown>;
    expect(persisted.ports).toBe(false);

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

  it("highlights the active option in ResourcesStatusPopover [内存 | CPU | 名称] segmented switcher across clicks", async () => {
    await using screen = await render(
      <ResourcesStatusPopover
        raw={{
          collectedAt: Date.now(),
          totalCpuPercent: 8.7,
          totalMemoryBytes: 620 * 1024 * 1024,
          desktop: { pid: 1000, cpuPercent: 7.4, memoryBytes: 420 * 1024 * 1024, processCount: 2 },
          daemon: { pid: 1050, cpuPercent: 0.3, memoryBytes: 60 * 1024 * 1024 },
          t3Server: {
            pid: 2000,
            cpuPercent: 1.0,
            memoryBytes: 140 * 1024 * 1024,
            hostedBy: "electron",
            state: "running",
          },
          processes: [
            {
              pid: 1001,
              name: "工作台渲染进程",
              processName: "Prismux.exe",
              role: "electron-renderer",
              category: "desktop",
              cpuPercent: 5.2,
              memoryBytes: 260 * 1024 * 1024,
            },
            {
              pid: 1002,
              name: "GPU 合成 / 壁纸渲染",
              processName: "Prismux.exe",
              role: "electron-gpu",
              category: "desktop",
              cpuPercent: 2.2,
              memoryBytes: 160 * 1024 * 1024,
            },
          ],
        }}
        loading={false}
        error={null}
        daemonReady
        onRefresh={async () => {}}
        onKillPty={async (sessionId) => ({ ok: true, sessionId })}
      />,
    );

    const memBtn = screen.getByTestId("resources-sort-memory").element() as HTMLButtonElement;
    const cpuBtn = screen.getByTestId("resources-sort-cpu").element() as HTMLButtonElement;
    const nameBtn = screen.getByTestId("resources-sort-name").element() as HTMLButtonElement;

    // Default active: 内存
    expect(memBtn.getAttribute("aria-pressed")).toBe("true");
    expect(memBtn.getAttribute("data-active")).toBe("true");
    expect(memBtn.className).toContain("bg-primary");
    expect(memBtn.className).toContain("text-primary-foreground");
    expect(cpuBtn.getAttribute("aria-pressed")).toBe("false");
    expect(cpuBtn.getAttribute("data-active")).toBe("false");
    expect(cpuBtn.className).toContain("bg-transparent");

    // Switch to CPU
    await userEvent.click(cpuBtn);
    expect(cpuBtn.getAttribute("aria-pressed")).toBe("true");
    expect(cpuBtn.getAttribute("data-active")).toBe("true");
    expect(cpuBtn.className).toContain("bg-primary");
    expect(cpuBtn.className).toContain("text-primary-foreground");
    expect(memBtn.getAttribute("aria-pressed")).toBe("false");
    expect(memBtn.getAttribute("data-active")).toBe("false");
    expect(memBtn.className).toContain("bg-transparent");

    // Switch to 名称
    await userEvent.click(nameBtn);
    expect(nameBtn.getAttribute("aria-pressed")).toBe("true");
    expect(nameBtn.getAttribute("data-active")).toBe("true");
    expect(nameBtn.className).toContain("bg-primary");
    expect(cpuBtn.getAttribute("aria-pressed")).toBe("false");
    expect(cpuBtn.className).toContain("bg-transparent");
  });

  it("switches QuotaStatusPopover interactively across Detailed (Fig 3), Compact (Fig 4), Single-Agent Detail (Fig 5), and Used/Remaining toggle", async () => {
    const now = Date.parse("2026-11-24T06:00:00Z");
    const summary = aggregateQuotaSummary(
      {
        ok: true,
        cached: false,
        cacheTtlMs: 180_000,
        fetchedAt: now - 3_000,
        fetchedAtIso: new Date(now - 3_000).toISOString(),
        providers: [],
        antigravity: {
          id: "antigravity",
          providerId: "antigravity",
          displayName: "Antigravity",
          source: "official-cli",
          command: 'agy -p "/usage"',
          status: "ok",
          available: true,
          executablePath: "C:\\Users\\Fish\\AppData\\Local\\agy\\bin\\agy.exe",
          remainingCredits: 0,
          fetchedAt: now - 3_000,
          fetchedAtIso: new Date(now - 3_000).toISOString(),
          error: null,
          windows: [
            {
              id: "gemini:weekly",
              group: "Gemini",
              groupId: "gemini",
              window: "weekly",
              shortLabel: "Gemini 周",
              detailLabel: "Gemini · 每周",
              remainingPercent: 93,
              usedPercent: 7,
              resetAtIso: "2026-11-30T20:03:11.000Z",
              resetAtMs: Date.parse("2026-11-30T20:03:11.000Z"),
            },
            {
              id: "gemini:5h",
              group: "Gemini",
              groupId: "gemini",
              window: "5h",
              shortLabel: "Gemini 5h",
              detailLabel: "Gemini · 5h",
              remainingPercent: 95,
              usedPercent: 5,
              resetAtIso: "2026-11-24T09:34:15.000Z",
              resetAtMs: Date.parse("2026-11-24T09:34:15.000Z"),
            },
          ],
        },
      },
      [],
      now,
    );

    function Harness() {
      const [prefs, setPrefs] = useState<QuotaPreferences>({
        viewMode: "detailed",
        percentMode: "used",
      });
      return (
        <QuotaStatusPopover
          summary={summary}
          prefs={prefs}
          onPrefsChange={setPrefs}
          now={now}
          onRefresh={async () => {}}
        />
      );
    }

    await using screen = await render(<Harness />);
    const popover = screen.getByTestId("prismux-quota-popover").element() as HTMLElement;
    expect(popover.getAttribute("data-quota-view")).toBe("detailed");

    // Switch to Compact view (Fig 4)
    await userEvent.click(screen.getByTestId("quota-view-compact"));
    expect(popover.getAttribute("data-quota-view")).toBe("compact");

    // Drill down into Antigravity detail view (Fig 5)
    await userEvent.click(screen.getByTestId("quota-agent-row-antigravity"));
    expect(screen.getByTestId("prismux-quota-popover").element().getAttribute("data-quota-view")).toBe("detail");
    expect(screen.getByTestId("quota-detail-updated-at").element().textContent).toContain("更新于 刚刚");

    // Toggle Used -> Remaining
    await userEvent.click(screen.getByTestId("quota-percent-mode-toggle"));
    expect(screen.getByTestId("quota-percent-mode-toggle").element().textContent).toContain("剩余");
    expect(screen.getByTestId("quota-detail-row-gemini:weekly").element().textContent).toContain("93%");

    // Navigate back to list view
    await userEvent.click(screen.getByTestId("quota-detail-back"));
    expect(screen.getByTestId("prismux-quota-popover").element().getAttribute("data-quota-view")).toBe("compact");
  });
});
