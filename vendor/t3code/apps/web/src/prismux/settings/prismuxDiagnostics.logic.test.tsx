import { renderToStaticMarkup } from "react-dom/server";
import { GTProvider, initializeGT } from "gt-react";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import {
  CANONICAL_DIAGNOSTIC_CATEGORIES,
  detectMemoryRetrievalState,
  normalizeDiagnosticsResponse,
  sanitizeDiagnosticsSettingsRoute,
} from "./prismuxDiagnostics.logic";
import { PrismuxDiagnosticsSection } from "./PrismuxDiagnosticsSection";

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

  it("sanitizes settings routes to internal /settings/* paths only", () => {
    expect(sanitizeDiagnosticsSettingsRoute("/settings/updates")).toBe("/settings/updates");
    expect(sanitizeDiagnosticsSettingsRoute("/settings/memory-sync")).toBe("/settings/memory-sync");
    expect(sanitizeDiagnosticsSettingsRoute("https://evil.example/settings/updates")).toBeNull();
    expect(sanitizeDiagnosticsSettingsRoute("javascript:alert(1)")).toBeNull();
    expect(sanitizeDiagnosticsSettingsRoute("/settings/../etc/passwd")).toBeNull();
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
});
