import "~/index.css";

import { useState } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { getRouter } from "../../router";
import type { DaemonOfficialQuotaSummaryResponse } from "../daemonClient";
import { PrismuxStatusBar, STATUS_BAR_USAGE_AUTO_REFRESH_INTERVAL_MS } from "../PrismuxStatusBar";
import {
  aggregateQuotaSummary,
  QUOTA_PREFS_STORAGE_KEY,
  type QuotaPreferences,
} from "./quotaStatus.logic";
import { QuotaStatusPopover } from "./QuotaStatusPopover";
import { ResourcesStatusPopover } from "./ResourcesStatusPopover";
import type { StatusBarUsageSummary } from "./statusBarUsage";
import { STATUS_BAR_VISIBILITY_STORAGE_KEY } from "./statusBarVisibility";
import { UsageStatusPopover } from "./UsageStatusPopover";

function renderStatusBarInRouter(initialDaemonQuota?: DaemonOfficialQuotaSummaryResponse | null) {
  const rootRoute = createRootRoute({
    component: () => <PrismuxStatusBar initialDaemonQuota={initialDaemonQuota} />,
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

    // Streamlined capsules: Usage + Keep Awake + Ports + CPU/RAM; Quota hides completely when 0 authenticated providers have live quota.
    expect(screen.getByTestId("status-bar-usage-trigger").element()).toBeTruthy();
    expect(screen.getByTestId("status-bar-quota-capsule").query()).toBeNull();
    expect(screen.getByTestId("status-bar-quota-trigger").query()).toBeNull();
    expect(screen.getByTestId("status-bar-quota-refresh").query()).toBeNull();
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
    const fetchedUrls = fetchSpy.mock.calls.map(([input]) => String(input));
    expect(fetchedUrls.filter((url) => !url.includes("/.well-known/t3/environment"))).toEqual([]);
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
    expect(
      screen.getByTestId("prismux-quota-popover").element().getAttribute("data-quota-view"),
    ).toBe("detail");
    expect(screen.getByTestId("quota-detail-updated-at").element().textContent).toContain(
      "更新于 刚刚",
    );

    // Toggle Used -> Remaining
    await userEvent.click(screen.getByTestId("quota-percent-mode-toggle"));
    expect(screen.getByTestId("quota-percent-mode-toggle").element().textContent).toContain("剩余");
    expect(screen.getByTestId("quota-detail-row-gemini:weekly").element().textContent).toContain(
      "93%",
    );

    // Navigate back to list view
    await userEvent.click(screen.getByTestId("quota-detail-back"));
    expect(
      screen.getByTestId("prismux-quota-popover").element().getAttribute("data-quota-view"),
    ).toBe("compact");
  });

  it("syncs bottom status bar quota windows and mini progress bar live with Detailed/Compact and Used/Remaining toggles", async () => {
    window.localStorage.removeItem(STATUS_BAR_VISIBILITY_STORAGE_KEY);
    window.localStorage.setItem(
      QUOTA_PREFS_STORAGE_KEY,
      JSON.stringify({ viewMode: "detailed", percentMode: "remaining" }),
    );
    const now = Date.parse("2026-11-24T06:00:00Z");
    const quotaSnapshot: DaemonOfficialQuotaSummaryResponse = {
      ok: true,
      cached: false,
      cacheTtlMs: 180_000,
      fetchedAt: now - 5_000,
      fetchedAtIso: new Date(now - 5_000).toISOString(),
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
        fetchedAt: now - 5_000,
        fetchedAtIso: new Date(now - 5_000).toISOString(),
        error: null,
        windows: [
          {
            id: "gemini:weekly",
            group: "Gemini",
            groupId: "gemini",
            window: "weekly",
            shortLabel: "Gemini 周",
            detailLabel: "Gemini · 每周",
            remainingPercent: 90,
            usedPercent: 10,
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
            remainingPercent: 84,
            usedPercent: 16,
            resetAtIso: "2026-11-24T07:33:00.000Z",
            resetAtMs: Date.parse("2026-11-24T07:33:00.000Z"),
          },
          {
            id: "claude-gpt:weekly",
            group: "Claude/GPT",
            groupId: "claude-gpt",
            window: "weekly",
            shortLabel: "Claude/GPT 周",
            detailLabel: "Claude/GPT · 每周",
            remainingPercent: 100,
            usedPercent: 0,
            resetAtIso: "2026-12-01T05:30:00.000Z",
            resetAtMs: Date.parse("2026-12-01T05:30:00.000Z"),
          },
          {
            id: "claude-gpt:5h",
            group: "Claude/GPT",
            groupId: "claude-gpt",
            window: "5h",
            shortLabel: "Claude/GPT 5h",
            detailLabel: "Claude/GPT · 5h",
            remainingPercent: 100,
            usedPercent: 0,
            resetAtIso: "2026-11-24T10:59:30.000Z",
            resetAtMs: Date.parse("2026-11-24T10:59:30.000Z"),
          },
        ],
      },
    };

    await using screen = await renderStatusBarInRouter(quotaSnapshot);
    const barEl = screen
      .getByRole("contentinfo", { name: "Prismux 状态栏" })
      .element() as HTMLElement;
    expect(Math.round(barEl.getBoundingClientRect().height)).toBe(20);

    const trigger = screen.getByTestId("status-bar-quota-trigger").element() as HTMLButtonElement;
    expect(trigger.getAttribute("data-quota-bar-mode")).toBe("detailed");
    expect(trigger.getAttribute("data-quota-percent-mode")).toBe("remaining");
    expect(trigger.textContent).toContain("剩余");
    expect(trigger.textContent).toContain("Gemini 周 90%");
    expect(trigger.textContent).toContain("Gemini 5h 84%");
    expect(trigger.textContent).toContain("Claude/GPT 周 100%");
    expect(trigger.textContent).toContain("Claude/GPT 5h 100%");

    // Mini progress bar is present in detailed mode with 90% remaining fill width
    const miniBarFill = screen
      .getByTestId("status-bar-quota-minibar-fill-antigravity")
      .element() as HTMLElement;
    expect(miniBarFill.style.width).toBe("90%");

    // Open popover and switch Remaining -> Used: both bottom bar, mini bar, and popover sync live
    await userEvent.click(trigger);
    await expect.element(page.getByTestId("prismux-quota-popover")).toBeVisible();
    await userEvent.click(page.getByTestId("quota-percent-mode-toggle"));

    expect(trigger.getAttribute("data-quota-percent-mode")).toBe("used");
    expect(trigger.textContent).toContain("已用");
    expect(trigger.textContent).toContain("Gemini 周 10%");
    expect(trigger.textContent).toContain("Gemini 5h 16%");
    expect(trigger.textContent).toContain("Claude/GPT 周 0%");
    expect(trigger.textContent).toContain("Claude/GPT 5h 0%");
    expect(
      (screen.getByTestId("status-bar-quota-minibar-fill-antigravity").element() as HTMLElement)
        .style.width,
    ).toBe("10%");

    // Switch Detailed -> Compact: bottom bar immediately collapses to single primary window without mini bar
    await userEvent.click(page.getByTestId("quota-view-compact"));
    expect(trigger.getAttribute("data-quota-bar-mode")).toBe("compact");
    expect(trigger.textContent).toContain("Gemini 周 10%");
    expect(trigger.textContent).not.toContain("Gemini 5h");
    expect(trigger.textContent).not.toContain("Claude/GPT 周");
    expect(screen.getByTestId("status-bar-quota-minibar-antigravity").query()).toBeNull();

    // Switch back Compact -> Detailed: all 4 windows & mini progress bar return immediately
    await userEvent.click(page.getByTestId("quota-view-detailed"));
    expect(trigger.getAttribute("data-quota-bar-mode")).toBe("detailed");
    expect(trigger.textContent).toContain("Gemini 周 10%");
    expect(trigger.textContent).toContain("Gemini 5h 16%");
    expect(trigger.textContent).toContain("Claude/GPT 周 0%");
    expect(trigger.textContent).toContain("Claude/GPT 5h 0%");
    expect(screen.getByTestId("status-bar-quota-minibar-antigravity").element()).toBeTruthy();

    window.localStorage.removeItem(QUOTA_PREFS_STORAGE_KEY);
  });

  it("hides bottom-bar quota completely when daemon snapshot reports unauthenticated (zero static placeholder)", async () => {
    window.localStorage.removeItem(STATUS_BAR_VISIBILITY_STORAGE_KEY);
    const now = Date.parse("2026-11-25T08:00:00Z");
    const unauthSnapshot: DaemonOfficialQuotaSummaryResponse = {
      ok: true,
      cached: false,
      cacheTtlMs: 180_000,
      fetchedAt: now,
      fetchedAtIso: new Date(now).toISOString(),
      providers: [],
      antigravity: {
        id: "antigravity",
        providerId: "antigravity",
        displayName: "Antigravity",
        source: "official-cli",
        command: 'agy -p "/usage"',
        status: "unauthenticated",
        available: false,
        executablePath: null,
        remainingCredits: null,
        fetchedAt: now,
        fetchedAtIso: new Date(now).toISOString(),
        error: "未检测到官方 agy CLI 登录态",
        windows: [],
      },
    };

    await using screen = await renderStatusBarInRouter(unauthSnapshot);
    const barEl = screen
      .getByRole("contentinfo", { name: "Prismux 状态栏" })
      .element() as HTMLElement;
    expect(Math.round(barEl.getBoundingClientRect().height)).toBe(20);
    expect(screen.getByTestId("status-bar-quota-capsule").query()).toBeNull();
    expect(screen.getByTestId("status-bar-quota-trigger").query()).toBeNull();
    expect(barEl.textContent).not.toContain("未登录");
    expect(barEl.textContent).not.toContain("额度 —");
  });

  it("enables defaultStructuralSharing on app router and avoids spurious PrismuxStatusBar/usePrismuxTraySync rerenders or microtasks across settings navigation", async () => {
    window.localStorage.removeItem(STATUS_BAR_VISIBILITY_STORAGE_KEY);
    const appRouter = getRouter(createMemoryHistory({ initialEntries: ["/"] }));
    expect(appRouter.options.defaultStructuralSharing).toBe(true);

    const hostRenders: number[] = [];
    const rootRoute = createRootRoute({
      component: () => (
        <>
          <Outlet />
          <PrismuxStatusBar />
        </>
      ),
    });
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => <div data-testid="route-home">Home</div>,
    });
    const settingsGeneralRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/settings/general",
      component: () => <div data-testid="route-settings-general">General</div>,
    });
    const settingsAppearanceRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/settings/appearance",
      component: () => <div data-testid="route-settings-appearance">Appearance</div>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([homeRoute, settingsGeneralRoute, settingsAppearanceRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
      defaultStructuralSharing: true,
    });

    function TrackedStatusBarHost() {
      const [bump, setBump] = useState(0);
      hostRenders.push(bump);
      return (
        <div>
          <button type="button" onClick={() => setBump((v) => v + 1)}>
            Rerender host {bump}
          </button>
          <RouterProvider router={router} />
        </div>
      );
    }

    await using screen = await render(<TrackedStatusBarHost />);
    await expect.element(screen.getByTestId("route-home")).toBeVisible();

    const queueMicrotaskSpy = vi.spyOn(globalThis, "queueMicrotask");
    try {
      await act(async () => {
        await router.navigate({ to: "/settings/general" });
      });
      await expect.element(screen.getByTestId("route-settings-general")).toBeVisible();

      await act(async () => {
        await router.navigate({ to: "/settings/appearance" });
      });
      await expect.element(screen.getByTestId("route-settings-appearance")).toBeVisible();

      // Trigger an unrelated host rerender; stabilized quota fetchers must not re-fire effects or clear-cache microtasks
      const rendersBefore = hostRenders.length;
      await act(() => {
        (screen.getByRole("button", { name: /Rerender host/ }).element() as HTMLElement).click();
      });
      expect(hostRenders.length).toBe(rendersBefore + 1);

      // Verify zero quota-clear microtasks were scheduled for already-null state
      const clearMicrotasks = queueMicrotaskSpy.mock.calls.filter(([cb]) =>
        String(cb).includes("setDaemonQuota"),
      );
      expect(clearMicrotasks).toHaveLength(0);
    } finally {
      queueMicrotaskSpy.mockRestore();
    }
  });

  it("schedules a single 30-minute (1_800_000 ms) Today-token auto-refresh interval and clears it cleanly on unmount", async () => {
    window.localStorage.removeItem(STATUS_BAR_VISIBILITY_STORAGE_KEY);
    expect(STATUS_BAR_USAGE_AUTO_REFRESH_INTERVAL_MS).toBe(30 * 60 * 1_000);

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    try {
      const screen = await renderStatusBarInRouter();
      const bar = screen.getByRole("contentinfo", { name: "Prismux 状态栏" });
      await expect.element(bar).toBeVisible();

      const thirtyMinCalls = setIntervalSpy.mock.calls.filter(
        ([, delay]) => delay === STATUS_BAR_USAGE_AUTO_REFRESH_INTERVAL_MS,
      );
      expect(thirtyMinCalls).toHaveLength(1);

      const timerIndex = setIntervalSpy.mock.calls.findIndex(
        ([, delay]) => delay === STATUS_BAR_USAGE_AUTO_REFRESH_INTERVAL_MS,
      );
      const timerId = setIntervalSpy.mock.results[timerIndex]?.value;
      expect(timerId).toBeDefined();

      // Unmount must clear the 30-minute timer cleanly (zero leaks / duplicate timers).
      await screen.unmount();
      const clearedIds = clearIntervalSpy.mock.calls.map(([id]) => id);
      expect(clearedIds).toContain(timerId);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it("hot-reloads UsageStatusPopover and QuotaStatusPopover data in-place on the very first click of Refresh", async () => {
    const makeUsageSummary = (todayTokens: number, weekTokens: number): StatusBarUsageSummary => ({
      windows: [],
      antigravityEntries: [],
      primaryWindow: null,
      enabledProviderCount: 1,
      telemetry: {
        todayTokens,
        todayCostUsd: todayTokens > 20_000 ? 0.88 : 0.21,
        weekTokens,
        weekCostUsd: 1.45,
        weekRecords: 12,
        weekSessions: 3,
        cacheHitPercent: 64,
        cacheSavingsUsd: 0.32,
        providers: [
          {
            key: "codex",
            providerKind: "codex",
            providerName: "Codex",
            todayTokens,
            todayCostUsd: todayTokens > 20_000 ? 0.88 : 0.21,
            weekTokens,
            weekCostUsd: 1.45,
            weekRecords: 12,
            weekSessions: 3,
            cacheHitPercent: 64,
            hasQuotaWindow: true,
            isCustomEndpoint: false,
          },
        ],
      },
    });

    const usageRefreshCalls: number[] = [];
    function UsageHarness() {
      const [summary, setSummary] = useState(() => makeUsageSummary(12_000, 90_000));
      return (
        <UsageStatusPopover
          summary={summary}
          onClose={() => {}}
          onRefresh={async () => {
            usageRefreshCalls.push(usageRefreshCalls.length + 1);
            setSummary(makeUsageSummary(48_500, 126_500));
          }}
        />
      );
    }

    await using usageScreen = await render(<UsageHarness />);
    const usagePopover = usageScreen.getByTestId("prismux-usage-popover").element() as HTMLElement;
    expect(usagePopover.textContent).toContain("12.0K tok");

    // Click Refresh ONCE -> hot-updates in-place immediately without second click or reopening!
    await userEvent.click(usageScreen.getByTestId("usage-refresh-button"));
    expect(usageRefreshCalls).toHaveLength(1);
    expect(usagePopover.textContent).toContain("48.5K tok");
    expect(usageScreen.getByTestId("usage-refresh-button").element().textContent).toContain(
      "已刷新",
    );

    // Same first-click hot-reload guarantee for QuotaStatusPopover (both list & detail views)
    const now = Date.parse("2026-11-26T12:00:00Z");
    const makeQuota = (usedPercent: number) =>
      aggregateQuotaSummary(
        {
          ok: true,
          cached: false,
          cacheTtlMs: 900_000,
          fetchedAt: now,
          fetchedAtIso: new Date(now).toISOString(),
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
            remainingCredits: 100,
            fetchedAt: now,
            fetchedAtIso: new Date(now).toISOString(),
            error: null,
            windows: [
              {
                id: "gemini:weekly",
                group: "Gemini",
                groupId: "gemini",
                window: "weekly",
                shortLabel: "Gemini 周",
                detailLabel: "Gemini · 每周",
                remainingPercent: 100 - usedPercent,
                usedPercent,
                resetAtIso: "2026-12-01T00:00:00.000Z",
                resetAtMs: Date.parse("2026-12-01T00:00:00.000Z"),
              },
            ],
          },
        },
        [],
        now,
      );

    const quotaRefreshCalls: boolean[] = [];
    function QuotaHarness() {
      const [summary, setSummary] = useState(() => makeQuota(10));
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
          onRefresh={async (force) => {
            quotaRefreshCalls.push(force);
            setSummary(makeQuota(37));
          }}
        />
      );
    }

    await using quotaScreen = await render(<QuotaHarness />);
    const quotaPopover = quotaScreen.getByTestId("prismux-quota-popover").element() as HTMLElement;
    expect(quotaPopover.textContent).toContain("10%");

    // Click Refresh ONCE -> forces fresh fetch (force=true) and hot-updates in-place immediately!
    await userEvent.click(quotaScreen.getByTestId("quota-refresh-button"));
    expect(quotaRefreshCalls).toEqual([true]);
    expect(quotaPopover.textContent).toContain("37%");
  });
});
