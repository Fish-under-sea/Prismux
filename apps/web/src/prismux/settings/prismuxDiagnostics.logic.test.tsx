import { renderToStaticMarkup } from "react-dom/server";
import { GTProvider, initializeGT } from "gt-react";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

let mockedPathname = "/settings/maintenance";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: { children?: unknown; to?: string; [key: string]: unknown }) => (
    <a href={to} {...props}>
      {children as never}
    </a>
  ),
  useLocation: (opts?: { select?: (loc: { pathname: string }) => unknown }) =>
    opts?.select ? opts.select({ pathname: mockedPathname }) : { pathname: mockedPathname },
  useNavigate: () => vi.fn(),
}));

import {
  CANONICAL_DIAGNOSTIC_CATEGORIES,
  createDiagnosticsRefreshController,
  detectMemoryRetrievalState,
  DIAGNOSTICS_AUTO_REFRESH_COOLDOWN_MS,
  DORMANT_ENGINES_GROUP_ID,
  filterDiagnosticsReport,
  formatCompactDiagnosticSummary,
  formatCompactDiagnosticVersion,
  getDiagnosticsStandaloneCopy,
  getLatestNormalizedDiagnosticsReport,
  isDiagnosticsAutoRefreshSettingsPath,
  isDiagnosticsStandalonePathname,
  isDiagnosticsViewPathname,
  isOmittedAiProviderDiagnosticItem,
  normalizeDiagnosticsResponse,
  publishDiagnosticsReport,
  requestDiagnosticsRefresh,
  resetDiagnosticsLiveStoreForTests,
  resolveDiagnosticsSettingsRoute,
  resolveNormalizedDiagnosticsBadgeTone,
  sanitizeDiagnosticsSettingsRoute,
  subscribeDiagnosticsRefreshRequest,
  subscribeDiagnosticsReport,
  toggleDiagnosticStatusFilter,
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
          summary: "全文检索可用，向量扩展暂未加载",
          settingsRoute: "/settings/memory-sync",
        },
        {
          id: "provider.dsh",
          category: "ai_providers",
          name: "DeepSeek Harness CLI",
          status: "error",
          summary: "本机 CLI 启动或探测异常（需修复）",
          detail: "已发现可执行文件，但版本探测未返回",
          fixCommand: "dsh --version",
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
    expect(report.memoryRetrievalDetail).toContain("全文检索");
    expect(report.dormantEngines.map((e) => e.id)).toEqual([
      "engine.overnight_factory",
      "engine.lifecycle_hook_bus",
      "engine.worktree_sandbox",
    ]);
  });

  it("omits uninstalled optional AI Provider CLIs and retired omp from cards, summary counts, and sidebar badge tone while keeping broken installed CLIs", () => {
    expect(
      isOmittedAiProviderDiagnosticItem({
        id: "provider.codex",
        category: "ai_providers",
        name: "Codex CLI",
        status: "degraded",
        summary: "未检测到本机 CLI（可选）",
      }),
    ).toBe(true);
    expect(
      isOmittedAiProviderDiagnosticItem({
        id: "provider.claude",
        category: "ai_providers",
        name: "Claude Code CLI",
        status: "degraded",
        summary: "Not installed",
        state: "not_installed",
      }),
    ).toBe(true);
    expect(
      isOmittedAiProviderDiagnosticItem({
        id: "provider.omp",
        category: "ai_providers",
        name: "omp CLI",
        status: "ok",
        summary: "Detected",
      }),
    ).toBe(true);
    expect(
      isOmittedAiProviderDiagnosticItem({
        id: "provider.dsh",
        category: "ai_providers",
        name: "DeepSeek Harness CLI",
        status: "degraded",
        summary: "本机 CLI 启动或探测异常（需修复）",
        detail: "已发现可执行文件，但版本探测未返回",
      }),
    ).toBe(false);

    // Case 1: Only uninstalled optional CLIs + retired omp were degraded in raw Daemon payload
    // -> omitted completely, ai_providers group hidden, summary.degraded === 0, sidebar badge tone === "ok"
    const allUninstalledReport = normalizeDiagnosticsResponse({
      ok: true,
      checkedAt: 1_763_000_000_000,
      durationMs: 95,
      cached: false,
      summary: { total: 4, ok: 1, degraded: 2, error: 1 },
      groups: [
        {
          id: "host_core",
          status: "ok",
          items: [
            {
              id: "host.daemon",
              category: "host_core",
              name: "Prismux Daemon",
              status: "ok",
              summary: "Running",
            },
          ],
        },
        {
          id: "ai_providers",
          status: "error",
          items: [
            {
              id: "provider.codex",
              category: "ai_providers",
              name: "Codex CLI",
              status: "degraded",
              summary: "未检测到本机 CLI",
            },
            {
              id: "provider.dsh",
              category: "ai_providers",
              name: "DeepSeek Harness",
              status: "degraded",
              installed: false,
              summary: "PATH 中未找到 dsh",
            },
            {
              id: "provider.omp",
              category: "ai_providers",
              name: "omp CLI",
              status: "error",
              summary: "PATH 中未找到 omp",
            },
          ],
        },
      ],
      items: [
        {
          id: "host.daemon",
          category: "host_core",
          name: "Prismux Daemon",
          status: "ok",
          summary: "Running",
        },
        {
          id: "provider.codex",
          category: "ai_providers",
          name: "Codex CLI",
          status: "degraded",
          summary: "未检测到本机 CLI",
        },
        {
          id: "provider.dsh",
          category: "ai_providers",
          name: "DeepSeek Harness",
          status: "degraded",
          installed: false,
          summary: "PATH 中未找到 dsh",
        },
        {
          id: "provider.omp",
          category: "ai_providers",
          name: "omp CLI",
          status: "error",
          summary: "PATH 中未找到 omp",
        },
      ],
    });

    expect(allUninstalledReport.items.map((item) => item.id)).toEqual(["host.daemon"]);
    expect(allUninstalledReport.groups.map((g) => g.id)).toEqual(["host_core"]);
    expect(allUninstalledReport.summary).toEqual({ total: 1, ok: 1, degraded: 0, error: 0 });
    expect(resolveNormalizedDiagnosticsBadgeTone(allUninstalledReport)).toBe("ok");

    // Case 2: Installed-but-broken CLI stays visible as degraded and triggers degraded tone
    const brokenInstalledReport = normalizeDiagnosticsResponse({
      ok: true,
      checkedAt: 1_763_000_000_000,
      durationMs: 110,
      cached: false,
      summary: { total: 3, ok: 1, degraded: 2, error: 0 },
      items: [
        {
          id: "host.daemon",
          category: "host_core",
          name: "Prismux Daemon",
          status: "ok",
          summary: "Running",
        },
        {
          id: "provider.codex",
          category: "ai_providers",
          name: "Codex CLI",
          status: "degraded",
          summary: "未检测到本机 CLI",
        },
        {
          id: "provider.claude",
          category: "ai_providers",
          name: "Claude Code CLI",
          status: "degraded",
          summary: "本机 CLI 启动或探测异常（需修复）",
          detail: "已发现可执行文件，但版本探测未返回",
        },
      ],
    });

    expect(brokenInstalledReport.items.map((item) => item.id)).toEqual([
      "host.daemon",
      "provider.claude",
    ]);
    expect(brokenInstalledReport.summary).toEqual({ total: 2, ok: 1, degraded: 1, error: 0 });
    expect(resolveNormalizedDiagnosticsBadgeTone(brokenInstalledReport)).toBe("degraded");
  });

  it("detects FTS5 + sqlite-vec hybrid state when memory.sqlite_vec is ok", () => {
    const hybrid = detectMemoryRetrievalState([
      {
        id: "memory.sqlite_vec",
        category: "memory_sync",
        name: "sqlite-vec",
        status: "ok",
        summary: "混合检索已启用",
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

  it("sanitizes settings routes to internal /settings/* or standalone paths only and maps legacy routes precisely", () => {
    expect(sanitizeDiagnosticsSettingsRoute("/settings/updates")).toBe("/settings/updates");
    expect(sanitizeDiagnosticsSettingsRoute("/settings/memory")).toBe("/settings/memory");
    expect(sanitizeDiagnosticsSettingsRoute("/settings/sync")).toBe("/settings/sync");
    expect(sanitizeDiagnosticsSettingsRoute("/settings/memory-sync")).toBe("/settings/memory-sync");
    expect(sanitizeDiagnosticsSettingsRoute("/diagnostics")).toBe("/diagnostics");
    expect(sanitizeDiagnosticsSettingsRoute("/overnight-factory")).toBe("/overnight-factory");
    expect(sanitizeDiagnosticsSettingsRoute("https://evil.example/settings/updates")).toBeNull();
    expect(sanitizeDiagnosticsSettingsRoute("javascript:alert(1)")).toBeNull();
    expect(sanitizeDiagnosticsSettingsRoute("/settings/../etc/passwd")).toBeNull();

    // Legacy routes automatically target canonical destinations
    expect(resolveDiagnosticsSettingsRoute("/settings/memory-sync", "memory.sqlite_wal")).toBe(
      "/settings/memory",
    );
    expect(resolveDiagnosticsSettingsRoute("/settings/memory-sync", "memory.sqlite_vec")).toBe(
      "/settings/memory",
    );
    expect(resolveDiagnosticsSettingsRoute("/settings/memory-sync", "sync.vault")).toBe(
      "/settings/sync",
    );
    expect(resolveDiagnosticsSettingsRoute("/settings/diagnostics", "host.daemon")).toBe(
      "/diagnostics",
    );
    expect(resolveDiagnosticsSettingsRoute("/diagnostics", "host.daemon")).toBe("/diagnostics");
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

  it("renders unified compact Liquid Glass diagnostic cards with single-line truncation, inline bottom strip, and zero <code> blocks", () => {
    const raw7ZipVersion =
      "7-Zip (a) 24.09 (x64) : Copyright (c) 1999-2024 Igor Pavlov : 2024-11-29";
    const raw7ZipSummary = `可用（${raw7ZipVersion}）`;

    expect(formatCompactDiagnosticSummary(raw7ZipSummary)).toBe("可用 · 7-Zip 24.09 (x64)");
    expect(formatCompactDiagnosticSummary(`Available (${raw7ZipVersion})`)).toBe(
      "Available · 7-Zip 24.09 (x64)",
    );
    expect(formatCompactDiagnosticSummary("已安装（git version 2.52.0.windows.1）")).toBe(
      "已安装（git version 2.52.0.windows.1）",
    );
    expect(formatCompactDiagnosticVersion(raw7ZipVersion)).toBe("7-Zip 24.09 (x64)");
    expect(formatCompactDiagnosticVersion("git version 2.52.0.windows.1")).toBe(
      "git version 2.52.0.windows.1",
    );

    const report = normalizeDiagnosticsResponse({
      ok: true,
      checkedAt: 1_763_000_000_000,
      durationMs: 120,
      cached: false,
      summary: { total: 4, ok: 2, degraded: 1, error: 1 },
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
          id: "tool.7zip",
          category: "simulators_media",
          name: "7za / 7z 解压工具",
          status: "ok",
          summary: raw7ZipSummary,
          detail: "C:\\Program Files\\7-Zip\\7za.exe",
          version: raw7ZipVersion,
          latencyMs: 18,
          settingsRoute: "/settings/updates",
        },
        {
          id: "memory.sqlite_vec",
          category: "memory_sync",
          name: "sqlite-vec",
          status: "degraded",
          summary: "FTS5 degraded mode",
          detail: "Vector extension not loaded under Prismux extensions directory",
          settingsRoute: "/settings/memory-sync",
        },
        {
          id: "provider.dsh",
          category: "ai_providers",
          name: "DeepSeek Harness CLI",
          status: "error",
          summary: "本机 CLI 启动或探测异常（需修复）",
          detail: "已发现可执行文件，但版本探测未返回",
          fixCommand: "dsh --version",
          settingsRoute: "/settings/providers",
        },
      ],
    });

    const fullHtml = renderToStaticMarkup(
      <GTProvider locale="en" translations={{}}>
        <PrismuxDiagnosticsSection variant="full" initialReportOverride={report} />
      </GTProvider>,
    );

    // Compact 4-column equal-height grid + Liquid Glass Fresnel rim + Light/Dark Glass contrast hooks
    expect(fullHtml).toContain(
      "grid grid-cols-1 items-stretch gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
    );
    expect(fullHtml).toContain("shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]");
    expect(fullHtml).toContain("dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]");
    expect(fullHtml).toContain("[[data-pmx-glass=&#x27;1&#x27;]_&amp;]");
    expect(fullHtml).toContain("motion-reduce:transition-none");
    expect(fullHtml).not.toContain("bg-card/85");
    expect(fullHtml).not.toContain("break-all");

    // Compact single-line 3-band card typography (no multi-line bloat or bulky separated footer row)
    expect(fullHtml).toContain("flex h-full min-w-0 flex-col gap-1.5 p-3");
    expect(fullHtml).toContain("text-[13px] font-semibold tracking-tight text-foreground");
    expect(fullHtml).toContain("truncate text-xs font-medium leading-4.25 text-foreground/88");
    expect(fullHtml).toContain("truncate font-mono text-2xs leading-3.75 text-muted-foreground");
    expect(fullHtml).not.toContain("line-clamp-2");
    expect(fullHtml).not.toContain("border-t border-border/50 pt-2.5");
    expect(fullHtml).toContain("border-l-[3px] border-l-amber-500");
    expect(fullHtml).toContain("border-l-[3px] border-l-destructive");

    // Unified single-row bottom strip with preserved action attributes
    expect(fullHtml).toContain('data-diagnostic-card-bottom="true"');
    expect(fullHtml).toContain('data-diagnostic-card-footer="true"');
    expect(fullHtml).toContain('data-diagnostic-copy-command="true"');
    expect(fullHtml).toContain('data-diagnostic-settings-link="true"');
    expect(fullHtml).toContain('title="dsh --version"');
    expect(fullHtml).not.toContain("<code");

    // 7-Zip card strips noisy Copyright boilerplate from display while keeping full raw title tooltip
    expect(fullHtml).toContain(">可用 · 7-Zip 24.09 (x64)</p>");
    expect(fullHtml).toContain(`title="${raw7ZipSummary}"`);
    expect(fullHtml).toContain(">7-Zip 24.09 (x64)</span>");
    expect(fullHtml).toContain(`title="${raw7ZipVersion}"`);

    // Healthy card without actions renders bottom meta strip but no footer action block
    const healthyCardHtml = renderToStaticMarkup(
      <GTProvider locale="en" translations={{}}>
        <DiagnosticItemCard
          item={report.items[0]!}
          copied={false}
          onCopyCommand={() => undefined}
        />
      </GTProvider>,
    );
    expect(healthyCardHtml).toContain('data-diagnostic-card="true"');
    expect(healthyCardHtml).toContain('data-diagnostic-status="ok"');
    expect(healthyCardHtml).toContain('data-diagnostic-card-bottom="true"');
    expect(healthyCardHtml).not.toContain('data-diagnostic-card-footer="true"');
    expect(healthyCardHtml).not.toContain('data-diagnostic-settings-link="true"');
    expect(healthyCardHtml).not.toContain("border-l-[3px]");
    expect(healthyCardHtml).not.toContain("<code");

    // Copied feedback renders checkmark state on DiagnosticItemCard, and zh locale uses compact "复制修复"
    const copiedCardHtml = renderToStaticMarkup(
      <GTProvider locale="en" translations={{}}>
        <DiagnosticItemCard
          item={report.items[3]!}
          copied
          onCopyCommand={() => undefined}
        />
      </GTProvider>,
    );
    expect(copiedCardHtml).toContain("Copied ✓");
    expect(copiedCardHtml).toContain('data-diagnostic-settings-link="true"');
    expect(copiedCardHtml).not.toContain("<code");

    const zhActionCardHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <DiagnosticItemCard
          item={report.items[3]!}
          copied={false}
          onCopyCommand={() => undefined}
        />
      </GTProvider>,
    );
    expect(zhActionCardHtml).toContain("复制修复");
    expect(zhActionCardHtml).toContain('data-diagnostic-copy-command="true"');
    expect(zhActionCardHtml).toContain('data-diagnostic-settings-link="true"');

    // Streamlined single-line memory retrieval status strip links directly to /settings/memory
    expect(fullHtml).toContain('data-diagnostic-memory-banner="true"');
    expect(fullHtml).toContain('href="/settings/memory"');
    expect(fullHtml).not.toContain('href="/settings/memory-sync"');
  });

  it("renders dormant_engines exactly once as a flattened read-only summary section", () => {
    const report = normalizeDiagnosticsResponse({
      ok: true,
      checkedAt: 1_763_000_000_000,
      durationMs: 205,
      cached: false,
      summary: { total: 5, ok: 4, degraded: 1, error: 0 },
      items: [
        {
          id: "host.daemon",
          category: "host_core",
          name: "Prismux Daemon",
          status: "ok",
          summary: "Running",
          latencyMs: 2,
        },
        {
          id: "memory.sqlite_vec",
          category: "memory_sync",
          name: "sqlite-vec",
          status: "ok",
          summary: "FTS5 + sqlite-vec hybrid active",
          version: "0.1.6",
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

    const filteredAll = filterDiagnosticsReport(report, "all");
    expect(filteredAll.activeGroups.map((g) => g.id)).toEqual(["host_core", "memory_sync"]);
    expect(filteredAll.activeGroups.some((g) => g.id === DORMANT_ENGINES_GROUP_ID)).toBe(false);
    expect(filteredAll.dormantGroup?.id).toBe(DORMANT_ENGINES_GROUP_ID);
    expect(filteredAll.dormantGroup?.items.map((e) => e.id)).toEqual([
      "engine.overnight_factory",
      "engine.lifecycle_hook_bus",
      "engine.worktree_sandbox",
    ]);

    const fullHtml = renderToStaticMarkup(
      <GTProvider locale="en" translations={{}}>
        <PrismuxDiagnosticsSection variant="full" initialReportOverride={report} />
      </GTProvider>,
    );

    // Dormant engines group and each of its 3 cards appear exactly once (no top+bottom duplication)
    expect(fullHtml.match(/data-diagnostic-group="dormant_engines"/g)).toHaveLength(1);
    expect(fullHtml.match(/data-diagnostic-id="engine\.overnight_factory"/g)).toHaveLength(1);
    expect(fullHtml.match(/data-diagnostic-id="engine\.lifecycle_hook_bus"/g)).toHaveLength(1);
    expect(fullHtml.match(/data-diagnostic-id="engine\.worktree_sandbox"/g)).toHaveLength(1);
    expect(fullHtml).toContain("Dormant Engines Read-Only Summary");
    expect(fullHtml).toContain("Read-only");
    expect(fullHtml).toContain('data-diagnostic-readonly="true"');
    expect(fullHtml).toContain(
      "grid grid-cols-1 items-stretch gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
    );
    expect(fullHtml).not.toContain("line-clamp-2");
  });

  it("renders standalone full-width workbench panel at /diagnostics inside workPanels PrismuxStageFrame without max-w container", () => {
    const report = normalizeDiagnosticsResponse({
      ok: true,
      checkedAt: 1_763_000_000_000,
      durationMs: 148,
      cached: false,
      summary: { total: 26, ok: 25, degraded: 1, error: 0 },
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
          summary: "FTS5 degraded mode",
          settingsRoute: "/settings/memory",
        },
        {
          id: "engine.overnight_factory",
          category: "dormant_engines",
          name: "OvernightFactory",
          status: "ok",
          summary: "Standby",
        },
      ],
    });

    const prevPath = mockedPathname;
    mockedPathname = "/diagnostics";
    try {
      // Auto-enables standalone workbench mode when pathname === "/diagnostics"
      const autoHtml = renderToStaticMarkup(
        <GTProvider locale="en" translations={{}}>
          <PrismuxDiagnosticsSection variant="full" initialReportOverride={report} />
        </GTProvider>,
      );

      expect(autoHtml).toContain('data-pmx-glass-zone="workPanels"');
      expect(autoHtml).toContain('data-pmx-work-panel="1"');
      expect(autoHtml).toContain('data-testid="prismux-diagnostics-page"');
      expect(autoHtml).toContain('data-testid="diagnostics-page-header"');
      expect(autoHtml).toContain('data-testid="diagnostics-summary-pill"');
      expect(autoHtml).toContain('data-testid="diagnostics-degraded-pill"');
      expect(autoHtml).toContain('data-testid="diagnostics-last-checked"');
      expect(autoHtml).toContain("148 ms");
      expect(autoHtml).toContain('data-testid="diagnostics-rerun-button"');
      expect(autoHtml).toContain('data-pmx-work-panel-control="1"');
      expect(autoHtml).toContain('data-testid="diagnostics-close-button"');
      expect(autoHtml).toContain("grid-cols-2 gap-3 lg:grid-cols-4");
      expect(autoHtml).toContain(
        "grid grid-cols-1 items-stretch gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
      );
      expect(autoHtml).not.toContain("line-clamp-2");
      // Full-bleed edge-to-edge body must NEVER wrap in narrow centered max-w-* containers
      expect(autoHtml).not.toMatch(/\bmax-w-(?:3xl|4xl|5xl|6xl|7xl)\b/);
    } finally {
      mockedPathname = prevPath;
    }

    const zhCopy = getDiagnosticsStandaloneCopy("zh-CN");
    expect(zhCopy.closeTooltip).toBe("返回主会话 (Esc)");
    expect(zhCopy.copyFixLabel).toBe("复制修复");
    expect(zhCopy.summaryHealthyPill(25, 26)).toBe("25/26 正常");
    expect(zhCopy.summaryDegradedPill(1)).toBe("1 降级");
    expect(zhCopy.summaryErrorPill(2)).toBe("2 异常");

    const enCopy = getDiagnosticsStandaloneCopy("en-US");
    expect(enCopy.closeTooltip).toBe("Return to main session (Esc)");
    expect(enCopy.copyFixLabel).toBe("Copy fix");
    expect(enCopy.summaryHealthyPill(25, 26)).toBe("25/26 healthy");

    expect(isDiagnosticsStandalonePathname("/diagnostics")).toBe(true);
    expect(isDiagnosticsStandalonePathname("/diagnostics/")).toBe(true);
    expect(isDiagnosticsStandalonePathname("/settings/maintenance")).toBe(false);
  });

  it("supports interactive KPI status filtering, hides empty groups, and renders friendly empty state with reset", () => {
    // Pure filter toggle behavior (active status clicks reset to "all")
    expect(toggleDiagnosticStatusFilter("all", "degraded")).toBe("degraded");
    expect(toggleDiagnosticStatusFilter("degraded", "degraded")).toBe("all");
    expect(toggleDiagnosticStatusFilter("degraded", "error")).toBe("error");
    expect(toggleDiagnosticStatusFilter("error", "all")).toBe("all");

    const mixedReport = normalizeDiagnosticsResponse({
      ok: true,
      checkedAt: 1_763_000_000_000,
      durationMs: 180,
      cached: false,
      summary: { total: 4, ok: 2, degraded: 1, error: 1 },
      items: [
        {
          id: "host.daemon",
          category: "host_core",
          name: "Prismux Daemon",
          status: "ok",
          summary: "Running",
        },
        {
          id: "provider.dsh",
          category: "ai_providers",
          name: "DeepSeek Harness CLI",
          status: "error",
          summary: "本机 CLI 启动或探测异常（需修复）",
          fixCommand: "dsh --version",
        },
        {
          id: "engine.overnight_factory",
          category: "dormant_engines",
          name: "OvernightFactory",
          status: "ok",
          summary: "Standby",
        },
        {
          id: "engine.worktree_sandbox",
          category: "dormant_engines",
          name: "WorktreeSandbox",
          status: "degraded",
          summary: "Fallback isolation",
        },
      ],
    });

    const onlyErrors = filterDiagnosticsReport(mixedReport, "error");
    expect(onlyErrors.activeGroups.map((g) => g.id)).toEqual(["ai_providers"]);
    expect(onlyErrors.dormantGroup).toBeNull();
    expect(onlyErrors.totalVisibleCount).toBe(1);
    expect(onlyErrors.isFiltered).toBe(true);

    const onlyDegraded = filterDiagnosticsReport(mixedReport, "degraded");
    expect(onlyDegraded.activeGroups).toHaveLength(0);
    expect(onlyDegraded.dormantGroup?.items.map((e) => e.id)).toEqual(["engine.worktree_sandbox"]);
    expect(onlyDegraded.totalVisibleCount).toBe(1);

    // Rendered filtered view highlights active KPI tile and hides unmatched groups
    const errorFilteredHtml = renderToStaticMarkup(
      <GTProvider locale="en" translations={{}}>
        <PrismuxDiagnosticsSection
          variant="full"
          initialReportOverride={mixedReport}
          initialStatusFilter="error"
        />
      </GTProvider>,
    );
    expect(errorFilteredHtml).toContain('aria-pressed="true" data-diagnostic-filter="error"');
    expect(errorFilteredHtml).toContain('aria-pressed="false" data-diagnostic-filter="all"');
    expect(errorFilteredHtml).toContain('data-diagnostic-active-filter="error"');
    expect(errorFilteredHtml).toContain('data-diagnostic-filter-reset="true"');
    expect(errorFilteredHtml).toContain('data-diagnostic-group="ai_providers"');
    expect(errorFilteredHtml).not.toContain('data-diagnostic-group="host_core"');
    expect(errorFilteredHtml).not.toContain('data-diagnostic-group="dormant_engines"');

    // Rendered zero-match filter displays friendly empty state with one-click reset
    const healthyOnlyReport = normalizeDiagnosticsResponse({
      ok: true,
      checkedAt: 1_763_000_000_000,
      durationMs: 90,
      cached: false,
      summary: { total: 1, ok: 1, degraded: 0, error: 0 },
      items: [
        {
          id: "host.daemon",
          category: "host_core",
          name: "Prismux Daemon",
          status: "ok",
          summary: "Running",
        },
      ],
    });

    const emptyFilteredHtml = renderToStaticMarkup(
      <GTProvider locale="en" translations={{}}>
        <PrismuxDiagnosticsSection
          variant="full"
          initialReportOverride={healthyOnlyReport}
          initialStatusFilter="error"
        />
      </GTProvider>,
    );
    expect(emptyFilteredHtml).toContain('data-diagnostic-empty-state="true"');
    expect(emptyFilteredHtml).toContain("Nothing matches that.");
    expect(emptyFilteredHtml).toContain('data-diagnostic-filter-reset="true"');
    expect(emptyFilteredHtml).not.toContain('data-diagnostic-group="host_core"');
  });

  it("renders polished Liquid Glass compact variant for /welcome and hides cleanly when report is null", () => {
    const emptyCompact = renderToStaticMarkup(
      <GTProvider locale="en" translations={{}}>
        <PrismuxDiagnosticsSection variant="compact" initialReportOverride={null} />
      </GTProvider>,
    );
    expect(emptyCompact).toBe("");

    const report = normalizeDiagnosticsResponse({
      ok: true,
      checkedAt: 1_763_000_000_000,
      durationMs: 75,
      cached: false,
      summary: { total: 2, ok: 1, degraded: 1, error: 0 },
      items: [
        {
          id: "host.daemon",
          category: "host_core",
          name: "Prismux Daemon",
          status: "ok",
          summary: "Running",
        },
        {
          id: "memory.sqlite_vec",
          category: "memory_sync",
          name: "sqlite-vec",
          status: "degraded",
          summary: "FTS5 degraded mode",
        },
      ],
    });

    const compactHtml = renderToStaticMarkup(
      <GTProvider locale="en" translations={{}}>
        <PrismuxDiagnosticsSection variant="compact" initialReportOverride={report} />
      </GTProvider>,
    );
    expect(compactHtml).toContain("prismux-welcome-diagnostics");
    expect(compactHtml).toContain("shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]");
    expect(compactHtml).toContain("motion-reduce:transition-none");
    expect(compactHtml).not.toContain("bg-card/85");
    expect(compactHtml).not.toContain("<code");
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

  it("broadcasts published normalized reports and keeps sidebar dot free of uninstalled CLI false positives", () => {
    resetDiagnosticsLiveStoreForTests();
    const tones: Array<ReturnType<typeof resolveNormalizedDiagnosticsBadgeTone>> = [];
    const unsubReport = subscribeDiagnosticsReport(({ report }) => {
      tones.push(resolveNormalizedDiagnosticsBadgeTone(report));
    });

    const reasons: string[] = [];
    const unsubRequest = subscribeDiagnosticsRefreshRequest((reason) => {
      reasons.push(reason);
    });

    try {
      // Uninstalled optional CLI should be filtered -> tone stays "ok"
      publishDiagnosticsReport({
        ok: true,
        checkedAt: 1_763_000_001_000,
        durationMs: 180,
        cached: false,
        summary: { total: 2, ok: 1, degraded: 1, error: 0 },
        items: [
          {
            id: "provider.codex",
            category: "ai_providers",
            name: "Codex CLI",
            status: "degraded",
            summary: "未检测到本机 CLI",
          },
          {
            id: "tool.android_sdk",
            category: "simulators_media",
            name: "Android SDK",
            status: "ok",
            summary: "ok",
          },
        ],
      });

      // Installed-but-broken CLI -> tone becomes "degraded"
      publishDiagnosticsReport({
        ok: true,
        checkedAt: 1_763_000_003_000,
        durationMs: 160,
        cached: false,
        summary: { total: 2, ok: 1, degraded: 1, error: 0 },
        items: [
          {
            id: "provider.codex",
            category: "ai_providers",
            name: "Codex CLI",
            status: "degraded",
            summary: "本机 CLI 启动或探测异常（需修复）",
          },
          {
            id: "tool.android_sdk",
            category: "simulators_media",
            name: "Android SDK",
            status: "ok",
            summary: "ok",
          },
        ],
      });

      // Fixed CLI -> tone recovers to "ok"
      publishDiagnosticsReport({
        ok: true,
        checkedAt: 1_763_000_005_000,
        durationMs: 140,
        cached: false,
        summary: { total: 2, ok: 2, degraded: 0, error: 0 },
        items: [
          {
            id: "provider.codex",
            category: "ai_providers",
            name: "Codex CLI",
            status: "ok",
            summary: "codex-cli 0.171.0",
          },
          {
            id: "tool.android_sdk",
            category: "simulators_media",
            name: "Android SDK",
            status: "ok",
            summary: "adb ok",
          },
        ],
      });

      expect(tones).toEqual(["ok", "degraded", "ok"]);
      expect(getLatestNormalizedDiagnosticsReport()?.summary).toEqual({
        total: 2,
        ok: 2,
        degraded: 0,
        error: 0,
      });

      requestDiagnosticsRefresh("plugin-mutated");
      expect(reasons).toEqual(["plugin-mutated"]);

      expect(isDiagnosticsViewPathname("/diagnostics")).toBe(true);
      expect(isDiagnosticsViewPathname("/diagnostics/")).toBe(true);
      expect(isDiagnosticsViewPathname("/settings/diagnostics")).toBe(true);
      expect(isDiagnosticsViewPathname("/settings/maintenance")).toBe(false);
      expect(isDiagnosticsViewPathname("/settings/memory")).toBe(false);

      expect(isDiagnosticsAutoRefreshSettingsPath("/settings/providers")).toBe(true);
      expect(isDiagnosticsAutoRefreshSettingsPath("/settings/plugins")).toBe(true);
      expect(isDiagnosticsAutoRefreshSettingsPath("/settings/memory")).toBe(true);
      expect(isDiagnosticsAutoRefreshSettingsPath("/settings/sync")).toBe(true);
      expect(isDiagnosticsAutoRefreshSettingsPath("/settings/about")).toBe(true);
      expect(isDiagnosticsAutoRefreshSettingsPath("/settings/diagnostics")).toBe(false);
      expect(isDiagnosticsAutoRefreshSettingsPath("/tasks")).toBe(false);
    } finally {
      unsubReport();
      unsubRequest();
      resetDiagnosticsLiveStoreForTests();
    }
  });
});
