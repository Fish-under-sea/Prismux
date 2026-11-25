// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodePath from "node:path";
import type { ServerProvider } from "@prismux/core-contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { DaemonOfficialQuotaSummaryResponse } from "../daemonClient";
import { QuotaStatusPopover } from "./QuotaStatusPopover";
import {
  aggregateQuotaSummary,
  buildProviderDriverMap,
  detectCompletedAntigravityTurns,
  isAntigravityEnabledAndAuthenticated,
  resolveThreadProviderDriver,
  shouldFetchAntigravityCreditsOnPopoverOpen,
  shouldRefreshAntigravityOnManualClick,
  shouldShowStatusBarQuota,
  shouldTriggerAntigravityColdStartFetch,
  type AgyTurnTrackerThreadInput,
  type DaemonOfficialQuotaCreditsResponse,
} from "./quotaStatus.logic";

function makeProvider(overrides: {
  instanceId: string;
  driver: string;
  displayName?: string;
  enabled?: boolean;
  installed?: boolean;
  status?: string;
  authStatus?: string;
  windows?: Array<{ id: string; kind?: string; label: string; usedPercent: number; resetsAt?: string }>;
}): ServerProvider {
  return {
    instanceId: overrides.instanceId,
    driver: overrides.driver,
    displayName: overrides.displayName ?? overrides.driver,
    enabled: overrides.enabled ?? true,
    installed: overrides.installed ?? true,
    status: overrides.status ?? "ready",
    auth: overrides.authStatus ? { status: overrides.authStatus } : undefined,
    usageLimits: overrides.windows
      ? {
          checkedAt: "2026-11-25T09:00:00.000Z",
          windows: overrides.windows,
        }
      : undefined,
  } as unknown as ServerProvider;
}

function makeAgyDaemonSummary(now: number): DaemonOfficialQuotaSummaryResponse {
  return {
    ok: true,
    cached: false,
    cacheTtlMs: 900_000,
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
      remainingCredits: null,
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
          remainingPercent: 92,
          usedPercent: 8,
          resetAtIso: "2026-11-25T14:00:00.000Z",
          resetAtMs: Date.parse("2026-11-25T14:00:00.000Z"),
        },
      ],
    },
  };
}

describe("AGY-ONLY event-driven lazy quota refresh (Ban-Proof v3 Section 三-1)", () => {
  const authedAgy = makeProvider({
    instanceId: "antigravity-local",
    driver: "antigravity",
    displayName: "Antigravity",
    authStatus: "authenticated",
  });
  const unauthAgy = makeProvider({
    instanceId: "antigravity-local",
    driver: "antigravity",
    displayName: "Antigravity",
    authStatus: "unauthenticated",
  });
  const disabledAgy = makeProvider({
    instanceId: "antigravity-local",
    driver: "antigravity",
    displayName: "Antigravity",
    enabled: false,
    status: "disabled",
    authStatus: "authenticated",
  });
  const authedCodex = makeProvider({
    instanceId: "codex-main",
    driver: "codex",
    displayName: "Codex",
    authStatus: "authenticated",
    windows: [
      { id: "weekly", kind: "weekly", label: "7d", usedPercent: 22, resetsAt: "2026-12-01T08:00:00Z" },
    ],
  });
  const authedClaude = makeProvider({
    instanceId: "claude-main",
    driver: "claudeAgent",
    displayName: "Claude Code",
    authStatus: "authenticated",
    windows: [
      { id: "session", kind: "session", label: "5h", usedPercent: 35, resetsAt: "2026-11-25T13:00:00Z" },
    ],
  });
  const authedOpenCode = makeProvider({
    instanceId: "opencode-local",
    driver: "opencode",
    displayName: "OpenCode",
    authStatus: "authenticated",
  });
  const authedDsh = makeProvider({
    instanceId: "dsh-local",
    driver: "dsh",
    displayName: "DSH",
    authStatus: "authenticated",
  });

  it("Trigger 1 (Cold Start Once): fires ONLY when AGY is enabled AND authenticated, and never repeats", () => {
    // Empty/loading provider list or unauthenticated/disabled AGY -> NEVER triggers cold start.
    expect(isAntigravityEnabledAndAuthenticated([])).toBe(false);
    expect(isAntigravityEnabledAndAuthenticated([unauthAgy])).toBe(false);
    expect(isAntigravityEnabledAndAuthenticated([disabledAgy])).toBe(false);
    expect(isAntigravityEnabledAndAuthenticated([authedCodex, authedClaude])).toBe(false);
    expect(isAntigravityEnabledAndAuthenticated([authedAgy])).toBe(true);

    expect(
      shouldTriggerAntigravityColdStartFetch({
        daemonReady: true,
        hasTriggeredColdStart: false,
        upstreamProviders: [],
      }),
    ).toBe(false);

    expect(
      shouldTriggerAntigravityColdStartFetch({
        daemonReady: true,
        hasTriggeredColdStart: false,
        upstreamProviders: [unauthAgy, authedCodex, authedClaude],
      }),
    ).toBe(false);

    expect(
      shouldTriggerAntigravityColdStartFetch({
        daemonReady: false,
        hasTriggeredColdStart: false,
        upstreamProviders: [authedAgy],
      }),
    ).toBe(false);

    // Enabled + authenticated + daemon ready + first time -> fires ONCE.
    expect(
      shouldTriggerAntigravityColdStartFetch({
        daemonReady: true,
        hasTriggeredColdStart: false,
        upstreamProviders: [authedAgy, authedCodex, authedClaude],
      }),
    ).toBe(true);

    // Once triggered -> NEVER fires again on subsequent renders.
    expect(
      shouldTriggerAntigravityColdStartFetch({
        daemonReady: true,
        hasTriggeredColdStart: true,
        upstreamProviders: [authedAgy, authedCodex, authedClaude],
      }),
    ).toBe(false);
  });

  it("Trigger 2 (After Human AGY Turn Ends): triggers ONLY on interactive AGY thread completions, NEVER on Codex / Claude / OpenCode / DSH", () => {
    const customAgy = makeProvider({
      instanceId: "my-custom-agy-slot",
      driver: "antigravity",
      displayName: "My AGY",
      authStatus: "authenticated",
    });
    const providers = [customAgy, authedCodex, authedClaude, authedOpenCode, authedDsh];
    const driverMap = buildProviderDriverMap(providers);

    expect(
      resolveThreadProviderDriver({ providerInstanceId: "my-custom-agy-slot" }, driverMap),
    ).toBe("antigravity");
    expect(resolveThreadProviderDriver({ providerInstanceId: "codex-main" }, driverMap)).toBe(
      "codex",
    );
    expect(resolveThreadProviderDriver({ providerInstanceId: "claude-main" }, driverMap)).toBe(
      "claudeAgent",
    );

    // Step 0 (Baseline): pre-existing completed AGY thread on startup MUST NOT trigger.
    const step0Threads: AgyTurnTrackerThreadInput[] = [
      {
        key: "local:agy-1",
        providerInstanceId: "my-custom-agy-slot",
        status: "completed",
        isInteractive: true,
      },
      {
        key: "local:codex-1",
        providerInstanceId: "codex-main",
        status: "idle",
        isInteractive: true,
      },
      {
        key: "local:claude-1",
        providerInstanceId: "claude-main",
        status: "idle",
        isInteractive: true,
      },
    ];
    const s0 = detectCompletedAntigravityTurns(null, step0Threads, providers);
    expect(s0.shouldRefreshAntigravityQuota).toBe(false);
    expect(s0.completedAntigravityThreadKeys).toEqual([]);

    // Step 1: Codex, Claude Code, OpenCode, DSH, AND an AGY subagent all start running.
    const step1Threads: AgyTurnTrackerThreadInput[] = [
      {
        key: "local:agy-1",
        providerInstanceId: "my-custom-agy-slot",
        status: "idle",
        isInteractive: true,
      },
      {
        key: "local:agy-subagent",
        providerInstanceId: "my-custom-agy-slot",
        status: "running",
        isInteractive: false,
      },
      {
        key: "local:codex-1",
        providerInstanceId: "codex-main",
        status: "running",
        isInteractive: true,
      },
      {
        key: "local:claude-1",
        providerInstanceId: "claude-main",
        status: "running",
        isInteractive: true,
      },
      {
        key: "local:opencode-1",
        providerInstanceId: "opencode-local",
        status: "running",
        isInteractive: true,
      },
      {
        key: "local:dsh-1",
        providerInstanceId: "dsh-local",
        status: "running",
        isInteractive: true,
      },
    ];
    const s1 = detectCompletedAntigravityTurns(s0.memory, step1Threads, providers);
    expect(s1.shouldRefreshAntigravityQuota).toBe(false);

    // Step 2: Codex, Claude Code, OpenCode, DSH, and AGY subagent all complete -> ZERO AGY refresh!
    const step2Threads: AgyTurnTrackerThreadInput[] = [
      {
        key: "local:agy-1",
        providerInstanceId: "my-custom-agy-slot",
        status: "idle",
        isInteractive: true,
      },
      {
        key: "local:agy-subagent",
        providerInstanceId: "my-custom-agy-slot",
        status: "completed",
        isInteractive: false,
      },
      {
        key: "local:codex-1",
        providerInstanceId: "codex-main",
        status: "completed",
        isInteractive: true,
      },
      {
        key: "local:claude-1",
        providerInstanceId: "claude-main",
        status: "idle",
        isInteractive: true,
      },
      {
        key: "local:opencode-1",
        providerInstanceId: "opencode-local",
        status: "completed",
        isInteractive: true,
      },
      {
        key: "local:dsh-1",
        providerInstanceId: "dsh-local",
        status: "completed",
        isInteractive: true,
      },
    ];
    const s2 = detectCompletedAntigravityTurns(s1.memory, step2Threads, providers);
    expect(s2.shouldRefreshAntigravityQuota).toBe(false);
    expect(s2.completedAntigravityThreadKeys).toEqual([]);

    // Step 3: Interactive AGY thread starts running -> still false until it finishes.
    const step3Threads: AgyTurnTrackerThreadInput[] = [
      {
        key: "local:agy-1",
        providerInstanceId: "my-custom-agy-slot",
        status: "running",
        isInteractive: true,
      },
    ];
    const s3 = detectCompletedAntigravityTurns(s2.memory, step3Threads, providers);
    expect(s3.shouldRefreshAntigravityQuota).toBe(false);

    // Step 4: Interactive AGY thread transitions running -> completed -> TRIGGERS ONCE!
    const step4Threads: AgyTurnTrackerThreadInput[] = [
      {
        key: "local:agy-1",
        providerInstanceId: "my-custom-agy-slot",
        status: "completed",
        isInteractive: true,
      },
    ];
    const s4 = detectCompletedAntigravityTurns(s3.memory, step4Threads, providers);
    expect(s4.shouldRefreshAntigravityQuota).toBe(true);
    expect(s4.completedAntigravityThreadKeys).toEqual(["local:agy-1"]);

    // Step 5: Subsequent re-render while completed/idle -> does NOT re-trigger.
    const step5Threads: AgyTurnTrackerThreadInput[] = [
      {
        key: "local:agy-1",
        providerInstanceId: "my-custom-agy-slot",
        status: "idle",
        isInteractive: true,
      },
    ];
    const s5 = detectCompletedAntigravityTurns(s4.memory, step5Threads, providers);
    expect(s5.shouldRefreshAntigravityQuota).toBe(false);

    // Step 6: Brand-new AGY thread starts streaming then goes idle -> TRIGGERS ONCE!
    const s6Start = detectCompletedAntigravityTurns(
      s5.memory,
      [
        {
          key: "local:agy-new",
          providerInstanceId: "antigravity",
          status: "starting",
          isInteractive: true,
        },
      ],
      providers,
    );
    expect(s6Start.shouldRefreshAntigravityQuota).toBe(false);

    const s6Done = detectCompletedAntigravityTurns(
      s6Start.memory,
      [
        {
          key: "local:agy-new",
          providerInstanceId: "antigravity",
          status: "idle",
          isInteractive: true,
        },
      ],
      providers,
    );
    expect(s6Done.shouldRefreshAntigravityQuota).toBe(true);
    expect(s6Done.completedAntigravityThreadKeys).toEqual(["local:agy-new"]);
  });

  it("Trigger 3 (Manual Refresh) & On-Demand Popover /credits gating leave Claude Code & Codex 100% untouched", () => {
    const now = Date.parse("2026-11-25T09:10:00Z");
    const agySummary = makeAgyDaemonSummary(now);

    // Manual refresh gates AGY strictly on enabled+authenticated when upstream providers are known.
    expect(shouldRefreshAntigravityOnManualClick([authedCodex, authedClaude])).toBe(false);
    expect(shouldRefreshAntigravityOnManualClick([unauthAgy, authedCodex])).toBe(false);
    expect(shouldRefreshAntigravityOnManualClick([disabledAgy, authedClaude])).toBe(false);
    expect(shouldRefreshAntigravityOnManualClick([authedAgy, authedCodex])).toBe(true);

    // On-demand `/credits` on popover open gates strictly on AGY authentication.
    expect(shouldFetchAntigravityCreditsOnPopoverOpen([unauthAgy, authedCodex], agySummary)).toBe(
      false,
    );
    expect(shouldFetchAntigravityCreditsOnPopoverOpen([disabledAgy], agySummary)).toBe(false);
    expect(shouldFetchAntigravityCreditsOnPopoverOpen([authedCodex, authedClaude], null)).toBe(
      false,
    );
    expect(shouldFetchAntigravityCreditsOnPopoverOpen([authedAgy, authedCodex], agySummary)).toBe(
      true,
    );

    // Before popover opens: AGY summary has remainingCredits=null while Codex & Claude live quota work normally.
    const beforeCredits = aggregateQuotaSummary(agySummary, [authedAgy, authedCodex, authedClaude], now, null);
    expect(beforeCredits.availableAgents.map((a) => a.id)).toEqual([
      "antigravity",
      "codex-main",
      "claude-main",
    ]);
    expect(beforeCredits.availableAgents[0]?.remainingCredits).toBeNull();
    expect(beforeCredits.availableAgents[1]?.windows[0]?.usedPercent).toBe(22);
    expect(beforeCredits.availableAgents[2]?.windows[0]?.usedPercent).toBe(35);

    // Popover open hydrates credits on demand without changing Codex/Claude.
    const creditsPayload: DaemonOfficialQuotaCreditsResponse = {
      ok: true,
      cached: false,
      cacheTtlMs: 900_000,
      fetchedAt: now,
      fetchedAtIso: new Date(now).toISOString(),
      remainingCredits: 128,
      status: "ok",
      available: true,
      error: null,
    };
    const afterCredits = aggregateQuotaSummary(
      agySummary,
      [authedAgy, authedCodex, authedClaude],
      now,
      creditsPayload,
    );
    expect(afterCredits.availableAgents[0]?.remainingCredits).toBe(128);

    // Popover detail view renders loading indicator while credits are fetching, then renders hydrated credits.
    const loadingHtml = renderToStaticMarkup(
      createElement(QuotaStatusPopover, {
        summary: beforeCredits,
        prefs: { viewMode: "detailed", percentMode: "used" },
        onPrefsChange: () => {},
        now,
        creditsLoading: true,
        initialSelectedAgentId: "antigravity",
      }),
    );
    expect(loadingHtml).toContain('data-testid="quota-detail-credits-loading"');
    expect(loadingHtml).toContain("查询中…");

    const hydratedHtml = renderToStaticMarkup(
      createElement(QuotaStatusPopover, {
        summary: afterCredits,
        prefs: { viewMode: "detailed", percentMode: "used" },
        onPrefsChange: () => {},
        now,
        creditsLoading: false,
        initialSelectedAgentId: "antigravity",
      }),
    );
    expect(hydratedHtml).toContain('data-testid="quota-detail-credits"');
    expect(hydratedHtml).toContain("128");

    // If on-demand `/credits` reports unauthenticated -> AGY hides immediately while Codex & Claude stay visible!
    const unauthCredits: DaemonOfficialQuotaCreditsResponse = {
      ok: true,
      cached: false,
      cacheTtlMs: 900_000,
      fetchedAt: now,
      fetchedAtIso: new Date(now).toISOString(),
      remainingCredits: null,
      status: "unauthenticated",
      available: false,
      error: "未检测到官方 agy CLI 登录态",
    };
    const afterUnauthCredits = aggregateQuotaSummary(
      agySummary,
      [authedAgy, authedCodex, authedClaude],
      now,
      unauthCredits,
    );
    expect(afterUnauthCredits.availableAgents.map((a) => a.id)).toEqual([
      "codex-main",
      "claude-main",
    ]);
    expect(shouldShowStatusBarQuota(afterUnauthCredits, true)).toBe(true);
  });

  it("static guard: PrismuxStatusBar has ZERO setInterval polling and ZERO window.focus/visibilitychange forced refresh for /v1/quota/summary", () => {
    const statusBarPath = NodePath.resolve(
      NodePath.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
      "../PrismuxStatusBar.tsx",
    );
    const source = NodeFS.readFileSync(statusBarPath, "utf8");

    // No 3-minute polling interval or 5-second foreground forced-refresh constants.
    expect(source).not.toContain("QUOTA_POLL_INTERVAL_MS");
    expect(source).not.toContain("QUOTA_FOREGROUND_REFRESH_MIN_GAP_MS");
    expect(source).not.toContain("triggerForegroundRefresh");
    expect(source).not.toContain("handleWindowFocus");
    expect(source).not.toMatch(/window\.addEventListener\(\s*["']focus["']/);

    // No setInterval calling fetchQuotaSummary / fetchAntigravityQuotaSummary / handleRefreshQuota.
    expect(source).not.toMatch(
      /setInterval\([^)]*(?:fetchQuotaSummary|fetchAntigravityQuotaSummary|handleRefreshQuota|poll\()/s,
    );

    // Event-driven triggers & on-demand `/v1/quota/credits` are wired properly.
    expect(source).toContain("shouldTriggerAntigravityColdStartFetch");
    expect(source).toContain("detectCompletedAntigravityTurns");
    expect(source).toContain("shouldFetchAntigravityCreditsOnPopoverOpen");
    expect(source).toContain("/v1/quota/credits");
    expect(source).toContain("/v1/quota/invalidate");

    // Claude Code / Codex upstream refresh remains intact.
    expect(source).toContain("refreshUsageLimits");
    expect(source).toContain("refreshProviders");
  });
});
