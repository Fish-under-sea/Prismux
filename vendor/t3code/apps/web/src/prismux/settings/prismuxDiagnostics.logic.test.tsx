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
  detectMemoryRetrievalState,
  normalizeDiagnosticsResponse,
  sanitizeDiagnosticsSettingsRoute,
} from "./prismuxDiagnostics.logic";
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
  });
});
