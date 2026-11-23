import type { ServerProvider } from "@t3tools/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { PrismuxDaemonClient, PrismuxDaemonError } from "../daemonClient";
import { PortsStatusPopover } from "./PortsStatusPopover";
import { ResourcesStatusPopover } from "./ResourcesStatusPopover";
import {
  applyPortsScanFailure,
  applyPortsScanSuccess,
  createPortsPollingController,
  INITIAL_PORTS_SCAN_STATE,
  partitionPortsByWorkspace,
  PORTS_POLL_INTERVAL_MS,
  resolvePortOpenUrl,
} from "./portsPolling";
import {
  classifyContextGauge,
  derivePromptCacheSummary,
} from "./statusBarContext";
import {
  shouldOpenStatusBarContextMenu,
  STATUS_BAR_CONTEXT_MENU_EXEMPT_SELECTOR,
} from "./statusBarContextMenuPolicy";
import {
  formatBytesCompact,
  formatCpuPercent,
  normalizeResourcesSummary,
  sortResourceWorkspaceGroups,
} from "./statusBarResources";
import {
  ANTIGRAVITY_COMPLIANCE_NOTICE,
  classifyUsageUrgency,
  collectStatusBarUsageSummary,
  formatResetCountdown,
  formatUsageWindowValue,
} from "./statusBarUsage";
import { getResetCountdownNextTickDelay } from "./useResetCountdownClock";
import {
  DEFAULT_STATUS_BAR_VISIBILITY,
  loadStatusBarUsagePreferences,
  loadStatusBarVisibility,
  saveStatusBarUsagePreferences,
  saveStatusBarVisibility,
  toggleStatusBarSegment,
  type StorageLike,
} from "./statusBarVisibility";

function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("statusBarVisibility persistence", () => {
  it("persists and reloads toggled segment visibility from storage", () => {
    const storage = createMemoryStorage();
    expect(loadStatusBarVisibility(storage)).toEqual(DEFAULT_STATUS_BAR_VISIBILITY);

    const next = toggleStatusBarSegment(
      toggleStatusBarSegment(DEFAULT_STATUS_BAR_VISIBILITY, "cache"),
      "resources",
    );
    saveStatusBarVisibility(next, storage);

    expect(loadStatusBarVisibility(storage)).toEqual({
      usage: true,
      context: true,
      cache: false,
      ports: true,
      resources: false,
    });
  });

  it("falls back safely when persisted JSON is corrupt", () => {
    const storage = createMemoryStorage();
    storage.setItem("prismux.statusBar.visibility.v1", "{bad-json");
    expect(loadStatusBarVisibility(storage)).toEqual(DEFAULT_STATUS_BAR_VISIBILITY);
  });

  it("persists usage popover density and percent mode preferences", () => {
    const storage = createMemoryStorage();
    saveStatusBarUsagePreferences({ density: "compact", percentMode: "remaining" }, storage);
    expect(loadStatusBarUsagePreferences(storage)).toEqual({
      density: "compact",
      percentMode: "remaining",
    });
  });
});

describe("portsPolling occlusion pause and 2-failure debounce", () => {
  it("keeps previous ports on 1st failure and clears only on 2nd consecutive failure", () => {
    const sample = [
      {
        port: 3000,
        pid: 4242,
        processName: "node.exe",
        scope: "workspace" as const,
        cwd: "D:\\Fish-code\\AGY\\Prismux",
        protected: false,
      },
    ];
    const okState = applyPortsScanSuccess(INITIAL_PORTS_SCAN_STATE, sample, 1000);
    expect(okState.ports).toHaveLength(1);
    expect(okState.failureStreak).toBe(0);

    // 1st failure: preserves previous ports to prevent flicker.
    const firstFail = applyPortsScanFailure(okState, "transient timeout");
    expect(firstFail.failureStreak).toBe(1);
    expect(firstFail.ports).toHaveLength(1);
    expect(firstFail.error).toBe("transient timeout");

    // 2nd consecutive failure: clears stale ports.
    const secondFail = applyPortsScanFailure(firstFail, "daemon unreachable");
    expect(secondFail.failureStreak).toBe(2);
    expect(secondFail.ports).toHaveLength(0);

    // Next success resets streak cleanly.
    const recovered = applyPortsScanSuccess(secondFail, sample, 2000);
    expect(recovered.failureStreak).toBe(0);
    expect(recovered.ports).toHaveLength(1);
    expect(recovered.error).toBeNull();
  });

  it("pauses 30s polling when window is occluded/hidden and resumes on visibility restore", async () => {
    vi.useFakeTimers();
    let hidden = false;
    const fetcher = vi.fn(async () => [
      {
        port: 5173,
        pid: 9001,
        processName: "vite",
        scope: "workspace" as const,
        protected: false,
      },
    ]);
    const states: number[] = [];

    const controller = createPortsPollingController({
      fetcher,
      isPaused: () => hidden,
      onStateChange: (s) => states.push(s.ports.length),
      intervalMs: PORTS_POLL_INTERVAL_MS,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance 30s while visible -> polls again.
    await vi.advanceTimersByTimeAsync(PORTS_POLL_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Occlude/hide window -> zero polls even across multiple 30s intervals.
    hidden = true;
    controller.setPaused(true);
    await vi.advanceTimersByTimeAsync(PORTS_POLL_INTERVAL_MS * 3);
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Restore visibility -> immediate silent rescan.
    hidden = false;
    controller.setPaused(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(3);

    controller.stop();
    expect(states.at(-1)).toBe(1);
  });

  it("partitions workspace vs external ports across Windows paths and resolves loopback URL", () => {
    const entries = [
      {
        port: 5173,
        pid: 100,
        processName: "vite",
        host: "0.0.0.0",
        cwd: "d:\\fish-code\\agy\\prismux\\apps\\web",
        scope: "external" as const,
        protected: false,
      },
      {
        port: 8080,
        pid: 200,
        processName: "python",
        host: "127.0.0.1",
        cwd: "C:\\OtherProject",
        scope: "external" as const,
        protected: false,
      },
    ];

    const { workspacePorts, externalPorts } = partitionPortsByWorkspace(
      entries,
      "D:/Fish-code/AGY/Prismux",
    );
    expect(workspacePorts.map((p) => p.port)).toEqual([5173]);
    expect(externalPorts.map((p) => p.port)).toEqual([8080]);
    expect(resolvePortOpenUrl(workspacePorts[0]!)).toBe("http://127.0.0.1:5173");
  });
});

describe("statusBarContext 4-tier boundaries and Prompt Cache", () => {
  it("classifies <60% normal, 60%-94.9% warning, 95%-100% compact, and >100% overflow accurately", () => {
    expect(classifyContextGauge(null, 100_000).level).toBe("unknown");
    expect(classifyContextGauge(59_900, 100_000).level).toBe("normal");
    expect(classifyContextGauge(60_000, 100_000).level).toBe("warning");
    expect(classifyContextGauge(94_900, 100_000).level).toBe("warning");
    expect(classifyContextGauge(95_000, 100_000).level).toBe("compact");
    expect(classifyContextGauge(100_000, 100_000).level).toBe("compact");

    const overflow = classifyContextGauge(105_000, 100_000);
    expect(overflow.level).toBe("overflow");
    expect(overflow.displayPercent).toBe(105);
    expect(overflow.barFillPercent).toBe(100);
    expect(overflow.advice).toContain("/compact");
  });

  it("derives local Prompt Cache hit, miss, and unknown states", () => {
    expect(derivePromptCacheSummary(null).state).toBe("unknown");

    const hit = derivePromptCacheSummary({
      usedTokens: 20_000,
      inputTokens: 10_000,
      cachedInputTokens: 8_000,
      lastInputTokens: 10_000,
      lastCachedInputTokens: 8_000,
    });
    expect(hit.state).toBe("hit");
    expect(hit.hitRatePercent).toBe(80);

    const miss = derivePromptCacheSummary({
      usedTokens: 5_000,
      inputTokens: 5_000,
      cachedInputTokens: 0,
      lastInputTokens: 5_000,
      lastCachedInputTokens: 0,
    });
    expect(miss.state).toBe("miss");
    expect(miss.hitRatePercent).toBe(0);
  });
});

describe("statusBarUsage compliance and urgency sorting", () => {
  it("enforces zero unofficial requests for Antigravity and surfaces only official ACP tier + CLI hints", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const now = Date.parse("2026-11-23T08:00:00Z");

    const providers = [
      {
        instanceId: "antigravity-local",
        driver: "antigravity",
        displayName: "Google Antigravity",
        enabled: true,
        installed: true,
        auth: {
          status: "authenticated",
          label: "Local agy CLI · Google AI Ultra",
        },
        // Even if stale/injected quota windows existed, collector MUST never display them for Antigravity.
        usageLimits: {
          windows: [
            { id: "v1internal-forbidden", label: "Forbidden", usedPercent: 99 },
          ],
        },
      },
      {
        instanceId: "codex-main",
        driver: "codex",
        displayName: "Codex",
        enabled: true,
        installed: true,
        auth: { status: "authenticated" },
        usageLimits: {
          windows: [
            { id: "weekly", label: "7d", usedPercent: 42, resetsAt: "2026-11-26T08:00:00Z" },
            { id: "session", label: "5h", usedPercent: 86, resetsAt: "2026-11-23T10:30:00Z" },
          ],
        },
      },
      {
        instanceId: "claude-main",
        driver: "claudeAgent",
        displayName: "Claude",
        enabled: true,
        installed: true,
        auth: { status: "authenticated" },
        usageLimits: {
          windows: [
            { id: "burst", label: "5h", usedPercent: 96, resetsAt: "2026-11-23T09:00:00Z" },
          ],
        },
      },
    ] as unknown as ServerProvider[];

    const summary = collectStatusBarUsageSummary(providers, now);

    // Zero network requests made.
    expect(fetchSpy).not.toHaveBeenCalled();

    // Antigravity excluded from quota windows, surfaced strictly via ACP entry.
    expect(summary.windows.some((w) => w.driver === "antigravity")).toBe(false);
    expect(summary.antigravityEntries).toHaveLength(1);
    expect(summary.antigravityEntries[0]!.tierLabel).toBe("Google AI Ultra");
    expect(summary.antigravityEntries[0]!.cliCommands).toEqual(["/usage", "/credits"]);
    expect(summary.antigravityEntries[0]!.complianceNotice).toBe(ANTIGRAVITY_COMPLIANCE_NOTICE);

    // Compliant windows sorted most urgent first: 96% -> 86% -> 42%.
    expect(summary.windows.map((w) => `${w.providerName}:${w.usedPercent}`)).toEqual([
      "Claude:96",
      "Codex:86",
      "Codex:42",
    ]);
    expect(summary.primaryWindow?.urgency).toBe("critical");
    expect(classifyUsageUrgency(80)).toBe("warning");
    expect(formatUsageWindowValue(summary.windows[1]!, "used")).toBe("86% 已用");
    expect(formatUsageWindowValue(summary.windows[1]!, "remaining")).toBe("14% 剩余");
    expect(formatResetCountdown(summary.windows[0]!.resetsAtMs, now)).toBe("1h");
  });
});

describe("statusBarResources and PrismuxDaemonClient unified APIs", () => {
  it("normalizes resource attribution tree and formats compact readouts", () => {
    const normalized = normalizeResourcesSummary({
      totalCpuPercent: 18.4,
      totalMemoryBytes: 1.5 * 1024 * 1024 * 1024,
      daemon: { cpuPercent: 1.2, memoryBytes: 96 * 1024 * 1024 },
      ptys: [
        {
          sessionId: "pty-1",
          workspace: "D:\\Fish-code\\AGY\\Prismux",
          command: "pnpm dev",
          cpuPercent: 5.5,
          memoryBytes: 256 * 1024 * 1024,
          stale: true,
        },
      ],
    });
    expect(formatCpuPercent(normalized.cpuPercent)).toBe("18%");
    expect(formatBytesCompact(normalized.memoryBytes)).toBe("1.50 GB");
    expect(normalized.totalPtyCount).toBe(1);
    expect(normalized.stalePtyCount).toBe(1);
    expect(normalized.workspaces[0]?.label).toBe("Prismux");
  });

  it("exposes unified daemon endpoints and parses SSE updater events cleanly", async () => {
    const g = globalThis as { __PRISMUX_DAEMON_URL__?: string; __PRISMUX_DAEMON_TOKEN__?: string };
    g.__PRISMUX_DAEMON_URL__ = "http://127.0.0.1:19876";
    g.__PRISMUX_DAEMON_TOKEN__ = "test-token";

    const client = new PrismuxDaemonClient();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/v1/diagnostics/services?force=1")) {
        return new Response(JSON.stringify({ ok: true, checkedAt: 1, items: [] }), { status: 200 });
      }
      if (url.includes("/v1/system/ports/kill")) {
        return new Response(
          JSON.stringify({ ok: false, error: { code: "PROTECTED_PID", message: "禁止终止核心进程" } }),
          { status: 403 },
        );
      }
      if (url.includes("/v1/updater/events")) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode('event: progress\ndata: {"stage":"downloading","percent":42}\n\n'),
            );
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const diag = await client.fetchDiagnosticsServices(true);
    expect(diag.items).toEqual([]);

    await expect(client.killSystemPort(4)).rejects.toMatchObject({
      status: 403,
      code: "PROTECTED_PID",
    } satisfies Partial<PrismuxDaemonError>);

    const received: unknown[] = [];
    let sseFetchInit: RequestInit | undefined;
    const origImpl = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).includes("/v1/updater/events")) {
        sseFetchInit = init;
      }
      return origImpl!(input, init);
    });
    const unsubscribe = client.subscribeUpdaterEvents(
      (evt) => received.push(evt),
      { maxReconnectAttempts: 0 },
    );
    await new Promise((r) => setTimeout(r, 20));
    unsubscribe();

    expect(received).toHaveLength(1);
    expect((received[0] as { event: string; data: { percent: number } }).event).toBe("progress");
    expect((received[0] as { data: { percent: number } }).data.percent).toBe(42);
    // Bug 1 zero-preflight guard: must use Fetch `cache: "no-store"` without `Cache-Control` / custom headers.
    expect(sseFetchInit?.cache).toBe("no-store");
    const sseHeaders = new Headers(sseFetchInit?.headers);
    expect(sseHeaders.has("cache-control")).toBe(false);
    expect(sseHeaders.has("authorization")).toBe(false);
    expect(sseHeaders.has("x-prismux-token")).toBe(false);
    expect(fetchMock).toHaveBeenCalled();

    delete g.__PRISMUX_DAEMON_URL__;
    delete g.__PRISMUX_DAEMON_TOKEN__;
  });

  it("renders PortsStatusPopover and ResourcesStatusPopover cleanly with workspace grouping and protected guard", () => {
    const portsHtml = renderToStaticMarkup(
      createElement(PortsStatusPopover, {
        state: {
          ports: [
            {
              port: 5173,
              pid: 4321,
              processName: "vite",
              cwd: "D:\\Fish-code\\AGY\\Prismux",
              scope: "workspace",
              protected: false,
            },
            {
              port: 19000,
              pid: 4,
              processName: "Prismux",
              scope: "external",
              protected: true,
              protectedReason: "核心进程不可终止",
            },
          ],
          loading: false,
          error: null,
          failureStreak: 0,
          lastScannedAt: Date.now(),
        },
        activeWorkspaceRoot: "D:\\Fish-code\\AGY\\Prismux",
        daemonReady: true,
        onRefresh: async () => {},
        onKillPort: async () => ({ ok: true }),
        onOpenUrl: () => {},
      }),
    );
    expect(portsHtml).toContain(":5173");
    expect(portsHtml).toContain("PID 4321");
    expect(portsHtml).toContain("当前工作区端口（1）");
    expect(portsHtml).toContain("外部进程端口（1）");

    const resourcesHtml = renderToStaticMarkup(
      createElement(ResourcesStatusPopover, {
        raw: {
          totalCpuPercent: 12.5,
          totalMemoryBytes: 512 * 1024 * 1024,
          daemon: { cpuPercent: 1.5, memoryBytes: 64 * 1024 * 1024 },
          t3Server: { cpuPercent: 3.0, memoryBytes: 128 * 1024 * 1024 },
          workspaces: [
            {
              workspace: "D:\\Fish-code\\AGY\\Prismux",
              label: "Prismux",
              cpuPercent: 8.0,
              memoryBytes: 320 * 1024 * 1024,
              ptys: [
                {
                  sessionId: "pty-stale-1",
                  command: "pnpm dev",
                  cpuPercent: 0.2,
                  memoryBytes: 42 * 1024 * 1024,
                  stale: true,
                },
              ],
            },
          ],
        },
        loading: false,
        error: null,
        daemonReady: true,
        onRefresh: async () => {},
        onKillPty: async (sessionId) => ({ ok: true, sessionId }),
      }),
    );
    expect(resourcesHtml).toContain("系统与 PTY 资源归因");
    expect(resourcesHtml).toContain("512 MB");
    expect(resourcesHtml).toContain("pnpm dev");
    expect(resourcesHtml).toContain("僵死");
  });
});

describe("Issue #10 Orca & OMP parity mechanisms", () => {
  it("exempts popovers and Text nodes inside exempt containers from global status bar context menu", () => {
    const exemptEl = {
      closest: (selector: string) =>
        selector === STATUS_BAR_CONTEXT_MENU_EXEMPT_SELECTOR ? {} : null,
    };
    const blankFooterEl = {
      closest: () => null,
    };
    const textNodeInsideExempt = { parentElement: exemptEl };
    const textNodeInsideFooter = { parentElement: blankFooterEl };

    expect(shouldOpenStatusBarContextMenu(exemptEl as unknown as EventTarget)).toBe(false);
    expect(shouldOpenStatusBarContextMenu(textNodeInsideExempt as unknown as EventTarget)).toBe(false);
    expect(shouldOpenStatusBarContextMenu(blankFooterEl as unknown as EventTarget)).toBe(true);
    expect(shouldOpenStatusBarContextMenu(textNodeInsideFooter as unknown as EventTarget)).toBe(true);
    expect(shouldOpenStatusBarContextMenu(null)).toBe(true);
  });

  it("schedules boundary-aligned reset countdown ticks (Orca useResetCountdownClock)", () => {
    const now = 1_700_000_000_000;
    // No future timestamps -> null (zero idle timer).
    expect(getResetCountdownNextTickDelay(now, [null, undefined, now - 5_000])).toBeNull();
    // Sub-24h window: 2m 15s remaining -> ticks 1ms after the 15s minute boundary (15_001ms).
    expect(getResetCountdownNextTickDelay(now, [now + 135_000])).toBe(15_001);
    // >=24h window: 25h 10m remaining -> ticks 1ms after the 10m hour boundary (600_001ms).
    expect(getResetCountdownNextTickDelay(now, [now + 25 * 3_600_000 + 600_000])).toBe(600_001);
    // Chooses soonest boundary across multiple windows.
    expect(
      getResetCountdownNextTickDelay(now, [now + 25 * 3_600_000 + 600_000, now + 90_000]),
    ).toBe(30_001);
  });

  it("discards stale in-flight port scans across pause generation and resolves HTTPS connectHost URLs", async () => {
    type StubPort = {
      port: number;
      pid: number;
      processName: string;
      scope: "workspace";
      protected: boolean;
    };
    const deferred: { resolve?: (ports: readonly StubPort[]) => void } = {};
    const fetcher = vi.fn(
      () =>
        new Promise<readonly StubPort[]>((resolve) => {
          deferred.resolve = resolve;
        }),
    );
    const controller = createPortsPollingController({
      fetcher,
      isPaused: () => false,
      onStateChange: () => {},
    });

    controller.start();
    // Pause mid-flight -> bumps generation so the earlier request cannot overwrite state.
    controller.setPaused(true);
    deferred.resolve?.([
      { port: 9999, pid: 1, processName: "stale", scope: "workspace", protected: false },
    ]);
    await Promise.resolve();
    expect(controller.getState().ports).toEqual([]);
    controller.stop();

    expect(
      resolvePortOpenUrl({
        port: 8443,
        pid: 10,
        processName: "nginx",
        bindHost: "0.0.0.0",
        connectHost: "127.0.0.1",
        serviceProtocol: "https",
        scope: "workspace",
        protected: false,
      }),
    ).toBe("https://127.0.0.1:8443");
  });

  it("matches OMP unknown-window label, compaction boundary marker, and Prompt Cache detail rows", () => {
    const unknownWindow = classifyContextGauge(24_500, null);
    expect(unknownWindow.level).toBe("unknown");
    expect(unknownWindow.label).toBe("Ctx 24.5k/?");

    const customCompaction = classifyContextGauge(80_000, 100_000, 85_000);
    expect(customCompaction.compactionBoundaryPercent).toBe(85);

    const warmCache = derivePromptCacheSummary({
      usedTokens: 20_000,
      inputTokens: 10_000,
      cachedInputTokens: 7_500,
      lastInputTokens: 10_000,
      lastCachedInputTokens: 7_500,
    });
    expect(warmCache.brief[0]).toContain("75%");
    expect(warmCache.details.some((row) => row.label === "缓存读取")).toBe(true);
    expect(warmCache.uncachedInputTokens).toBe(2_500);
  });

  it("sorts resource workspaces by memory/cpu/name keeping unsampled nulls last (Orca ResourceTree)", () => {
    const groups = [
      { workspace: "b", label: "beta", cpuPercent: null, memoryBytes: null, ptys: [] },
      { workspace: "a", label: "alpha", cpuPercent: 12, memoryBytes: 100, ptys: [] },
      { workspace: "c", label: "gamma", cpuPercent: 4, memoryBytes: 500, ptys: [] },
    ];
    expect(sortResourceWorkspaceGroups(groups, "memory").map((g) => g.label)).toEqual([
      "gamma",
      "alpha",
      "beta",
    ]);
    expect(sortResourceWorkspaceGroups(groups, "cpu").map((g) => g.label)).toEqual([
      "alpha",
      "gamma",
      "beta",
    ]);
    expect(sortResourceWorkspaceGroups(groups, "name").map((g) => g.label)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });
});
