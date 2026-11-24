import { renderToStaticMarkup } from "react-dom/server";
import { GTProvider, initializeGT } from "gt-react";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: { children?: unknown; to?: string; [key: string]: unknown }) => (
    <a href={to} {...props}>
      {children as never}
    </a>
  ),
}));

import {
  CANONICAL_DIAGNOSTIC_CATEGORIES,
  createDiagnosticsRefreshController,
  detectMemoryRetrievalState,
  DIAGNOSTICS_AUTO_REFRESH_COOLDOWN_MS,
  getLatestNormalizedDiagnosticsReport,
  isDiagnosticsAutoRefreshSettingsPath,
  normalizeDiagnosticsResponse,
  publishDiagnosticsReport,
  requestDiagnosticsRefresh,
  resetDiagnosticsLiveStoreForTests,
  resolveDiagnosticsSettingsRoute,
  sanitizeDiagnosticsSettingsRoute,
  subscribeDiagnosticsRefreshRequest,
  subscribeDiagnosticsReport,
} from "./prismuxDiagnostics.logic";
import { resolveDiagnosticsBadgeTone } from "../../components/sidebar/prismuxSidebarQuickNav.logic";
import {
  DiagnosticItemCard,
  PrismuxDiagnosticsSection,
} from "./PrismuxDiagnosticsSection";

describe("prismuxDiagnostics.logic & PrismuxDiagnosticsSection", () => {
  beforeAll(async () => {
    await initializeGT({
      defaultLocale: "en",
      locales: ["en", "zh"],
      loadTranslations: async () => ({}),
      cacheExpiryTime: null,
    });
  });
  it("normalizes all 6 canonical groups, counts, memory retrieval mode, and dormant engines", () => {
    const report = normalizeDiagnosticsResponse({
      ok: true,
      checkedAt: 1_763_000_000_000,
      durationMs: 412,
      cached: false,
      summary: { total: 8, ok: 5, degraded: 2, error: 1 },
      items: [
        {
          id: "host.daemon",
          category: "host_core",
          name: "Prismux Daemon",
          status: "ok",
          summary: "Running",
          latencyMs: 3,
        },
        {
          id: "memory.sqlite_vec",
          category: "memory_sync",
          name: "sqlite-vec",
          status: "degraded",
          summary: "FTS5 降级态（缺 vec0.dll，无兼容风险）",
          settingsRoute: "/settings/memory-sync",
        },
        {
          id: "provider.omp",
          category: "ai_providers",
          name: "omp CLI",
          status: "error",
          summary: "PATH 中未找到 omp",
          fixCommand: "npm i -g @oh-my-pi/pi-coding-agent",
          settingsRoute: "/settings/providers",
        },
        {
          id: "tool.7zip",
          category: "simulators_media",
          name: "7-Zip (7za)",
          status: "ok",
          summary: "Available",
        },
        {
          id: "mirror.gitee_releases",
          category: "network_mirrors",
          name: "Gitee Releases",
          status: "ok",
          summary: "Reachable",
          latencyMs: 85,
        },
        {
          id: "engine.overnight_factory",
          category: "dormant_engines",
          name: "OvernightFactory",
          status: "ok",
          summary: "Standby (0 active jobs)",
        },
        {
          id: "engine.lifecycle_hook_bus",
          category: "dormant_engines",
          name: "LifecycleHookBus",
          status: "ok",
          summary: "6 event hooks ready",
        },
        {
          id: "engine.worktree_sandbox",
          category: "dormant_engines",
          name: "WorktreeSandbox",
          status: "degraded",
          summary: "Fallback workspace isolation",
        },
      ],
    });

    expect(report.groups.map((g) => g.id)).toEqual([...CANONICAL_DIAGNOSTIC_CATEGORIES]);
    expect(report.summary).toEqual({ total: 8, ok: 5, degraded: 2, error: 1 });
    expect(report.memoryRetrievalState).toBe("fts5-only");
    expect(report.memoryRetrievalDetail).toContain("FTS5");
    expect(report.dormantEngines.map((e) => e.id)).toEqual([
      "engine.overnight_factory",
      "engine.lifecycle_hook_bus",
      "engine.worktree_sandbox",
    ]);
  });

  it("detects FTS5 + sqlite-vec hybrid state when memory.sqlite_vec is ok", () => {
    const hybrid = detectMemoryRetrievalState([
      {
        id: "memory.sqlite_vec",
        category: "memory_sync",
        name: "sqlite-vec",
        status: "ok",
        summary: "FTS5 + sqlite-vec 混合态",
        detail: null,
        fixAction: null,
        fixCommand: null,
        settingsRoute: "/settings/memory-sync",
        version: "0.1.6",
        latencyMs: 4,
      },
    ]);
    expect(hybrid.state).toBe("fts5+sqlite-vec");
  });

  it("sanitizes settings routes to internal /settings/* paths only and maps legacy /settings/memory-sync precisely", () => {
    expect(sanitizeDiagnosticsSettingsRoute("/settings/updates")).toBe("/settings/updates");
    expect(sanitizeDiagnosticsSettingsRoute("/settings/memory")).toBe("/settings/memory");
    expect(sanitizeDiagnosticsSettingsRoute("/settings/sync")).toBe("/settings/sync");
    expect(sanitizeDiagnosticsSettingsRoute("/settings/memory-sync")).toBe("/settings/memory-sync");
    expect(sanitizeDiagnosticsSettingsRoute("https://evil.example/settings/updates")).toBeNull();
    expect(sanitizeDiagnosticsSettingsRoute("javascript:alert(1)")).toBeNull();
    expect(sanitizeDiagnosticsSettingsRoute("/settings/../etc/passwd")).toBeNull();

    // Legacy /settings/memory-sync routes automatically target the exact split page by item id
    expect(resolveDiagnosticsSettingsRoute("/settings/memory-sync", "memory.sqlite_wal")).toBe(
      "/settings/memory",
    );
    expect(resolveDiagnosticsSettingsRoute("/settings/memory-sync", "memory.sqlite_vec")).toBe(
      "/settings/memory",
    );
    expect(resolveDiagnosticsSettingsRoute("/settings/memory-sync", "sync.vault")).toBe(
      "/settings/sync",
    );
    expect(resolveDiagnosticsSettingsRoute("/settings/sync", "sync.vault")).toBe("/settings/sync");
    expect(resolveDiagnosticsSettingsRoute("/settings/memory", "memory.sqlite_vec")).toBe(
      "/settings/memory",
    );
  });

  it("renders PrismuxDiagnosticsSection cleanly without requiring PrismuxRuntimeProvider", () => {
    const html = renderToStaticMarkup(
      <GTProvider locale="en" translations={{}}>
        <PrismuxDiagnosticsSection variant="full" />
      </GTProvider>,
    );
    expect(html).toContain("prismux-diagnostics");
    expect(html).toContain("Prismux Service Diagnostics");
    expect(html).toContain("Total checks");
  });

  it("renders equal-height diagnostic cards with items-stretch grid and removes redundant bottom command code blocks", () => {
    const report = normalizeDiagnosticsResponse({
      ok: true,
      checkedAt: 1_763_000_000_000,
      durationMs: 120,
      cached: false,
      summary: { total: 2, ok: 1, degraded: 0, error: 1 },
      items: [
        {
          id: "provider.codex",
          category: "ai_providers",
          name: "Codex CLI",
          status: "ok",
          summary: "Detected on PATH",
          version: "0.92.0",
          latencyMs: 14,
        },
        {
          id: "provider.omp",
          category: "ai_providers",
          name: "omp CLI",
          status: "error",
          summary: "PATH 中未找到 omp",
          detail: "Run npm global install or configure custom binary path in Settings",
          fixCommand: "npm install -g @oh-my-pi/pi-coding-agent",
          settingsRoute: "/settings/providers",
        },
      ],
    });

    const fullHtml = renderToStaticMarkup(
      <GTProvider locale="en" translations={{}}>
        <PrismuxDiagnosticsSection variant="full" initialReportOverride={report} />
      </GTProvider>,
    );

    // Equal-height stretch grid + uniform flex-col card layout + bottom-pinned footer
    expect(fullHtml).toContain("grid items-stretch gap-2.5 md:grid-cols-2 xl:grid-cols-3");
    expect(fullHtml).toContain("flex h-full min-h-[156px] flex-col");
    expect(fullHtml).toContain("line-clamp-2");
    expect(fullHtml).toContain('data-diagnostic-card-footer="true"');

    // No redundant <code> command block rendered under the copy button
    expect(fullHtml).not.toContain("<code");
    expect(fullHtml).toContain('data-diagnostic-copy-command="true"');
    expect(fullHtml).toContain('title="npm install -g @oh-my-pi/pi-coding-agent"');

    // Copied feedback renders checkmark state on DiagnosticItemCard
    const copiedCardHtml = renderToStaticMarkup(
      <GTProvider locale="en" translations={{}}>
        <DiagnosticItemCard
          item={report.items[1]!}
          copied
          onCopyCommand={() => undefined}
        />
      </GTProvider>,
    );
    expect(copiedCardHtml).toContain("Copied ✓");
    expect(copiedCardHtml).not.toContain("<code");

    // Memory retrieval banner links directly to the split /settings/memory page
    expect(fullHtml).toContain('href="/settings/memory"');
    expect(fullHtml).not.toContain('href="/settings/memory-sync"');
  });

  it("debounces window focus/visibility auto hot-reload with a 3s cooldown while allowing explicit bypass", () => {
    let fakeNow = 10_000;
    const triggered: string[] = [];
    const controller = createDiagnosticsRefreshController(
      (reason) => {
        triggered.push(reason);
      },
      {
        cooldownMs: DIAGNOSTICS_AUTO_REFRESH_COOLDOWN_MS,
        now: () => fakeNow,
      },
    );

    // First focus trigger fires immediately
    expect(controller.trigger("focus")).toBe(true);
    expect(triggered).toEqual(["focus"]);

    // Repeated focus / visibility events within 3s are suppressed to prevent probe storms
    fakeNow += 1_200;
    expect(controller.trigger("visibility")).toBe(false);
    fakeNow += 1_799;
    expect(controller.trigger("focus")).toBe(false);
    expect(triggered).toEqual(["focus"]);

    // Explicit plugin mutation bypasses cooldown immediately
    expect(controller.trigger("plugin-mutated", { bypassCooldown: true })).toBe(true);
    expect(triggered).toEqual(["focus", "plugin-mutated"]);

    // Focus right after explicit refresh respects new cooldown window
    fakeNow += 2_000;
    expect(controller.trigger("focus")).toBe(false);

    // After >= 3000ms elapses, focus hot-reload fires again
    fakeNow += 1_000;
    expect(controller.trigger("focus")).toBe(true);
    expect(triggered).toEqual(["focus", "plugin-mutated", "focus"]);

    // markRefreshed resets the cooldown window
    controller.markRefreshed(fakeNow);
    fakeNow += 500;
    expect(controller.trigger("visibility")).toBe(false);
  });

  it("broadcasts published diagnostics reports and refresh requests to keep Diagnostics page and sidebar dot in sync", () => {
    resetDiagnosticsLiveStoreForTests();
    const tones: Array<ReturnType<typeof resolveDiagnosticsBadgeTone>> = [];
    const unsubReport = subscribeDiagnosticsReport(({ response }) => {
      tones.push(resolveDiagnosticsBadgeTone(response));
    });

    const reasons: string[] = [];
    const unsubRequest = subscribeDiagnosticsRefreshRequest((reason) => {
      reasons.push(reason);
    });

    try {
      publishDiagnosticsReport({
        ok: true,
        checkedAt: 1_763_000_001_000,
        durationMs: 180,
        cached: false,
        summary: { total: 2, ok: 1, degraded: 1, error: 0 },
        items: [
          { id: "provider.codex", category: "ai_providers", name: "Codex CLI", status: "degraded", summary: "missing" },
          { id: "tool.android_sdk", category: "simulators_media", name: "Android SDK", status: "ok", summary: "ok" },
        ],
      });

      publishDiagnosticsReport({
        ok: true,
        checkedAt: 1_763_000_005_000,
        durationMs: 140,
        cached: false,
        summary: { total: 2, ok: 2, degraded: 0, error: 0 },
        items: [
          { id: "provider.codex", category: "ai_providers", name: "Codex CLI", status: "ok", summary: "codex-cli 0.171.0" },
          { id: "tool.android_sdk", category: "simulators_media", name: "Android SDK", status: "ok", summary: "adb ok" },
        ],
      });

      expect(tones).toEqual(["degraded", "ok"]);
      expect(getLatestNormalizedDiagnosticsReport()?.summary).toEqual({
        total: 2,
        ok: 2,
        degraded: 0,
        error: 0,
      });

      requestDiagnosticsRefresh("plugin-mutated");
      expect(reasons).toEqual(["plugin-mutated"]);

      expect(isDiagnosticsAutoRefreshSettingsPath("/settings/providers")).toBe(true);
      expect(isDiagnosticsAutoRefreshSettingsPath("/settings/plugins")).toBe(true);
      expect(isDiagnosticsAutoRefreshSettingsPath("/settings/memory")).toBe(true);
      expect(isDiagnosticsAutoRefreshSettingsPath("/settings/sync")).toBe(true);
      expect(isDiagnosticsAutoRefreshSettingsPath("/settings/diagnostics")).toBe(false);
      expect(isDiagnosticsAutoRefreshSettingsPath("/tasks")).toBe(false);
    } finally {
      unsubReport();
      unsubRequest();
      resetDiagnosticsLiveStoreForTests();
    }
  });
});
