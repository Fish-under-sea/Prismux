// @effect-diagnostics-next-line nodeBuiltinImport:off
import fs from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import path from "node:path";
import type { ServerProvider } from "@t3tools/contracts";
import type { MergedUsage } from "@t3tools/shared/usageMerge";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    onClick,
    className,
  }: {
    children?: ReactNode;
    to?: string;
    onClick?: () => void;
    className?: string;
  }) => createElement("a", { href: typeof to === "string" ? to : "#", onClick, className }, children),
}));

import { PrismuxDaemonClient, PrismuxDaemonError } from "../daemonClient";
import { KeepAwakeStatusPopover } from "./KeepAwakeStatusPopover";
import { PortsStatusPopover } from "./PortsStatusPopover";
import { QuotaStatusPopover } from "./QuotaStatusPopover";
import {
  aggregateQuotaSummary,
  buildQuotaStatusBarDisplay,
  buildQuotaStatusBarPill,
  formatQuotaResetDuration,
  formatQuotaResetLabel,
  formatQuotaUpdatedAgo,
  loadQuotaPreferences,
  saveQuotaPreferences,
} from "./quotaStatus.logic";
import { ResourcesStatusPopover } from "./ResourcesStatusPopover";
import { UsageStatusPopover } from "./UsageStatusPopover";
import {
  countActiveRunningThreads,
  DEFAULT_KEEP_AWAKE_MODE,
  deriveKeepAwakeState,
  KEEP_AWAKE_MODE_STORAGE_KEY,
  loadKeepAwakeMode,
  resolveKeepAwakeLocale,
  saveKeepAwakeMode,
} from "./statusBarKeepAwake";
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
  sortProcessResources,
  sortResourceWorkspaceGroups,
} from "./statusBarResources";
import {
  ANTIGRAVITY_COMPLIANCE_NOTICE,
  classifyUsageUrgency,
  collectStatusBarUsageSummary,
  formatCompactUsageTokens,
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
  it("persists and reloads 5-segment visibility from storage and upgrades legacy keys", () => {
    const storage = createMemoryStorage();
    expect(loadStatusBarVisibility(storage)).toEqual(DEFAULT_STATUS_BAR_VISIBILITY);
    expect(DEFAULT_STATUS_BAR_VISIBILITY).toEqual({
      usage: true,
      quota: true,
      keepAwake: true,
      ports: true,
      resources: true,
    });

    const next = toggleStatusBarSegment(
      toggleStatusBarSegment(DEFAULT_STATUS_BAR_VISIBILITY, "ports"),
      "resources",
    );
    saveStatusBarVisibility(next, storage);

    expect(loadStatusBarVisibility(storage)).toEqual({
      usage: true,
      quota: true,
      keepAwake: true,
      ports: false,
      resources: false,
    });

    // Legacy payloads containing removed `context` / `cache` fields and missing `quota` / `keepAwake` upgrade cleanly.
    storage.setItem(
      "prismux.statusBar.visibility.v1",
      JSON.stringify({ usage: false, context: false, cache: false, ports: true, resources: true }),
    );
    expect(loadStatusBarVisibility(storage)).toEqual({
      usage: false,
      quota: true,
      keepAwake: true,
      ports: true,
      resources: true,
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
      "Claude Code:96",
      "Codex:86",
      "Codex:42",
    ]);
    expect(summary.primaryWindow?.urgency).toBe("critical");
    expect(classifyUsageUrgency(80)).toBe("warning");
    expect(formatUsageWindowValue(summary.windows[1]!, "used")).toBe("86% 已用");
    expect(formatUsageWindowValue(summary.windows[1]!, "remaining")).toBe("14% 剩余");
    expect(formatResetCountdown(summary.windows[0]!.resetsAtMs, now)).toBe("1h");
  });

  it("populates real today/7-day usage telemetry and custom-endpoint provider stats even without official quota windows", () => {
    const customProviders = [
      {
        instanceId: "claude-custom-1",
        driver: "claudeAgent",
        displayName: "Claude Custom Relay",
        enabled: true,
        installed: true,
        baseUrl: "https://relay.example.test/v1",
        auth: { status: "authenticated", type: "api-key" },
      },
      {
        instanceId: "codex-custom-1",
        driver: "codex",
        displayName: "codex",
        enabled: true,
        installed: true,
        auth: { status: "authenticated", type: "api-key" },
      },
    ] as unknown as ServerProvider[];

    const mergedUsage = {
      costUsd: 4.25,
      uncachedInputTokens: 20_000,
      cachedInputTokens: 180_000,
      cacheCreationTokens: 0,
      outputTokens: 12_000,
      reasoningTokens: 2_000,
      totalTokens: 212_000,
      records: 18,
      sessions: 4,
      providers: [
        {
          provider: "claude",
          costUsd: 4.25,
          totalTokens: 212_000,
          records: 18,
          sessions: 4,
          costShare: 1,
          tokenShare: 1,
        },
      ],
      models: [
        {
          model: "claude-sonnet-4-5",
          provider: "claude",
          costUsd: 4.25,
          totalTokens: 212_000,
          tokens: {
            uncachedInputTokens: 20_000,
            cachedInputTokens: 180_000,
            cacheCreationTokens: 0,
            outputTokens: 12_000,
            reasoningTokens: 2_000,
          },
          records: 18,
          unpricedRecords: 0,
          unpricedTokens: 0,
          costShare: 1,
          tokenShare: 1,
        },
      ],
      daily: [
        {
          day: "2026-11-23",
          costUsd: 1.5,
          totalTokens: 64_000,
          byProvider: new Map([["claude", { costUsd: 1.5, totalTokens: 64_000 }]]),
        },
      ],
      hourly: [],
      costQuality: {
        providerReportedShare: 0,
        modelPricedShare: 1,
        unpricedShare: 0,
        cacheSavingsUsd: 1.2,
      },
      categoryCost: { input: 0.5, cacheRead: 0.3, cacheWrite: 0, output: 3.45, unsplit: 0 },
      speedCost: { standard: 4.25, fast: 0, ultrafast: 0, premium: 0 },
      duplicateSources: [],
      contributingEnvironments: [],
      contractMismatches: [],
    } as unknown as MergedUsage;

    const summary = collectStatusBarUsageSummary(
      customProviders,
      Date.parse("2026-11-23T12:00:00Z"),
      mergedUsage,
      "2026-11-23",
    );

    expect(summary.windows).toHaveLength(0);
    expect(summary.enabledProviderCount).toBe(2);
    expect(summary.telemetry.todayTokens).toBe(64_000);
    expect(summary.telemetry.weekTokens).toBe(212_000);
    expect(summary.telemetry.weekRecords).toBe(18);
    expect(summary.telemetry.cacheHitPercent).toBe(90);
    expect(summary.telemetry.providers.map((p) => p.providerName)).toEqual([
      "Claude Custom Relay",
      "Codex",
    ]);
    expect(summary.telemetry.providers[0]?.isCustomEndpoint).toBe(true);
    expect(formatCompactUsageTokens(64_000)).toBe("64.0K tok");

    // Verify UsageStatusPopover renders pure "用量总览" (Fig 6) with Fig 2 compliance card completely removed
    const summaryWithAgyEntry = {
      ...summary,
      antigravityEntries: [
        {
          providerInstanceId: "antigravity-local",
          providerName: "Antigravity",
          authenticated: true,
          tierLabel: "Google AI Ultra",
          cliCommands: ["/usage", "/credits"] as const,
          complianceNotice: ANTIGRAVITY_COMPLIANCE_NOTICE,
        },
      ],
    };
    const standaloneHtml = renderToStaticMarkup(
      createElement(UsageStatusPopover, {
        summary: summaryWithAgyEntry,
        onRefresh: async () => {},
        onClose: () => {},
      }),
    );
    expect(standaloneHtml).toContain("用量总览");
    expect(standaloneHtml).not.toContain("额度与用量总览");
    expect(standaloneHtml).not.toContain("Antigravity（纯官方 ACP 合规）");
    expect(standaloneHtml).not.toContain("prismux-antigravity-acp-card");
    expect(standaloneHtml).not.toContain("agy → /usage");
    expect(standaloneHtml).not.toContain("agy → /credits");
    expect(standaloneHtml).toContain("64.0K tok");
    expect(standaloneHtml).toContain("212K tok");
    expect(standaloneHtml).toContain("90%");
    expect(standaloneHtml).toContain("Claude Custom Relay");
    expect(standaloneHtml).toContain("自定义端点");
    expect(standaloneHtml).toContain("刷新");
    expect(standaloneHtml).toContain("本地近 7 日实时统计");
    expect(standaloneHtml).toContain('data-pmx-glass-zone="overlays"');
    expect(standaloneHtml).toContain('data-pmx-status-popover="1"');

    // Embedded inside PopoverPopup: transparent body avoids double background / corner protrusion
    const embeddedHtml = renderToStaticMarkup(
      createElement(UsageStatusPopover, {
        summary: summaryWithAgyEntry,
        onRefresh: async () => {},
        onClose: () => {},
        embeddedInPopover: true,
      }),
    );
    expect(embeddedHtml).toContain("bg-transparent");
    expect(embeddedHtml).not.toContain("bg-popover");
    expect(embeddedHtml).not.toContain("Antigravity（纯官方 ACP 合规）");
  });
});

describe("quotaStatus.logic & QuotaStatusPopover 3-view parity (Fig 1/3/4/5)", () => {
  it("formats Chinese reset countdowns, updatedAgo timestamps, and localStorage quota preferences", () => {
    const now = Date.parse("2026-11-24T06:00:00Z");

    // 6d 14h (matches Fig 4 & Fig 5)
    const sixDaysFourteenHours = now + (6 * 24 + 14) * 3_600_000 + 180_000;
    expect(formatQuotaResetDuration(sixDaysFourteenHours, now)).toBe("6天 14小时");
    expect(formatQuotaResetLabel(sixDaysFourteenHours, now)).toBe("6天 14小时后重置");

    // 3h 34m (matches Fig 3)
    const threeHoursThirtyFourMins = now + (3 * 60 + 34) * 60_000 + 20_000;
    expect(formatQuotaResetDuration(threeHoursThirtyFourMins, now)).toBe("3小时 34分钟");
    expect(formatQuotaResetLabel(threeHoursThirtyFourMins, now)).toBe("3小时 34分钟后重置");

    // 4h 59m & 6d 23h (matches Fig 5)
    const fourHoursFiftyNineMins = now + (4 * 60 + 59) * 60_000 + 15_000;
    expect(formatQuotaResetLabel(fourHoursFiftyNineMins, now)).toBe("4小时 59分钟后重置");
    const sixDaysTwentyThreeHours = now + (6 * 24 + 23) * 3_600_000 + 30 * 60_000;
    expect(formatQuotaResetLabel(sixDaysTwentyThreeHours, now)).toBe("6天 23小时后重置");

    // Edge cases
    expect(formatQuotaResetLabel(now - 5_000, now)).toBe("即将重置");
    expect(formatQuotaResetDuration(now - 5_000, now)).toBeNull();
    expect(formatQuotaResetLabel(now + 20_000, now)).toBe("1分钟后重置");

    // Relative updated time (Fig 5)
    expect(formatQuotaUpdatedAgo(now - 10_000, now)).toBe("更新于 刚刚");
    expect(formatQuotaUpdatedAgo(now - 2 * 60_000 - 5_000, now)).toBe("更新于 2 分钟前");
    expect(formatQuotaUpdatedAgo(now - 3 * 3_600_000, now)).toBe("更新于 3 小时前");

    // Persistence
    const storage = createMemoryStorage();
    expect(loadQuotaPreferences(storage)).toEqual({ viewMode: "detailed", percentMode: "used" });
    saveQuotaPreferences({ viewMode: "compact", percentMode: "remaining" }, storage);
    expect(loadQuotaPreferences(storage)).toEqual({
      viewMode: "compact",
      percentMode: "remaining",
    });
  });

  it("aggregates official Daemon Antigravity quota with upstream compliant providers and renders Detailed / Compact / Detail / Fallback views", () => {
    const now = Date.parse("2026-11-24T06:00:00Z");
    const daemonQuota = {
      ok: true as const,
      cached: false,
      cacheTtlMs: 180_000,
      fetchedAt: now - 5_000,
      fetchedAtIso: new Date(now - 5_000).toISOString(),
      providers: [],
      antigravity: {
        id: "antigravity" as const,
        providerId: "antigravity",
        displayName: "Antigravity",
        source: "official-cli" as const,
        command: 'agy -p "/usage"',
        status: "ok" as const,
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
            window: "weekly" as const,
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
            window: "5h" as const,
            shortLabel: "Gemini 5h",
            detailLabel: "Gemini · 5h",
            remainingPercent: 95,
            usedPercent: 5,
            resetAtIso: "2026-11-24T09:34:15.000Z",
            resetAtMs: Date.parse("2026-11-24T09:34:15.000Z"),
          },
          {
            id: "claude-gpt:weekly",
            group: "Claude/GPT",
            groupId: "claude-gpt",
            window: "weekly" as const,
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
            window: "5h" as const,
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

    const upstreamProviders = [
      {
        instanceId: "codex-main",
        driver: "codex",
        displayName: "Codex",
        enabled: true,
        installed: true,
        usageLimits: {
          checkedAt: new Date(now - 60_000).toISOString(),
          windows: [
            { id: "weekly", kind: "weekly", label: "7d", usedPercent: 18, resetsAt: "2026-11-29T06:00:00Z" },
          ],
        },
      },
    ] as unknown as ServerProvider[];

    const summary = aggregateQuotaSummary(daemonQuota, upstreamProviders, now);
    expect(summary.availableAgents.map((a) => a.displayName)).toEqual(["Antigravity", "Codex"]);

    // Bottom status bar pill text (Fig 1): used vs remaining (backward compatibility)
    const usedPill = buildQuotaStatusBarPill(summary, "used");
    expect(usedPill?.text).toBe("已用 Gemini 周 7%");
    const remainingPill = buildQuotaStatusBarPill(summary, "remaining");
    expect(remainingPill?.text).toBe("剩余 Gemini 周 93%");

    // Bottom status bar display synced with Detailed / Compact & Used / Remaining (Orca parity)
    const detailedRemaining = buildQuotaStatusBarDisplay(summary, {
      viewMode: "detailed",
      percentMode: "remaining",
    });
    expect(detailedRemaining).not.toBeNull();
    expect(detailedRemaining?.modePrefix).toBe("剩余");
    expect(detailedRemaining?.segments).toHaveLength(2);
    expect(detailedRemaining?.segments[0]?.barWidthPercent).toBe(93);
    expect(detailedRemaining?.segments[0]?.windows.map((w) => w.text)).toEqual([
      "Gemini 周 93%",
      "Gemini 5h 95%",
      "Claude/GPT 周 100%",
      "Claude/GPT 5h 100%",
    ]);
    expect(detailedRemaining?.segments[0]?.summaryText).toBe(
      "Gemini 周 93% · Gemini 5h 95% · Claude/GPT 周 100% · Claude/GPT 5h 100%",
    );
    expect(detailedRemaining?.segments[1]?.windows.map((w) => w.text)).toEqual(["周 82%"]);

    const detailedUsed = buildQuotaStatusBarDisplay(summary, {
      viewMode: "detailed",
      percentMode: "used",
    });
    expect(detailedUsed?.modePrefix).toBe("已用");
    expect(detailedUsed?.segments[0]?.barWidthPercent).toBe(7);
    expect(detailedUsed?.segments[0]?.windows.map((w) => w.text)).toEqual([
      "Gemini 周 7%",
      "Gemini 5h 5%",
      "Claude/GPT 周 0%",
      "Claude/GPT 5h 0%",
    ]);

    const compactRemaining = buildQuotaStatusBarDisplay(summary, {
      viewMode: "compact",
      percentMode: "remaining",
    });
    expect(compactRemaining?.segments[0]?.windows.map((w) => w.text)).toEqual(["Gemini 周 93%"]);
    expect(compactRemaining?.segments[1]?.windows.map((w) => w.text)).toEqual(["周 82%"]);

    const compactUsed = buildQuotaStatusBarDisplay(summary, {
      viewMode: "compact",
      percentMode: "used",
    });
    expect(compactUsed?.segments[0]?.windows.map((w) => w.text)).toEqual(["Gemini 周 7%"]);

    const emptySummary = aggregateQuotaSummary(null, [], now);
    expect(buildQuotaStatusBarDisplay(emptySummary, { viewMode: "detailed", percentMode: "used" })).toBeNull();

    // Detailed View (Fig 3)
    const detailedHtml = renderToStaticMarkup(
      createElement(QuotaStatusPopover, {
        summary,
        prefs: { viewMode: "detailed", percentMode: "used" },
        onPrefsChange: () => {},
        now,
        onRefresh: async () => {},
      }),
    );
    expect(detailedHtml).toContain("使用量");
    expect(detailedHtml).toContain("· 所有代理");
    expect(detailedHtml).toContain("已用");
    expect(detailedHtml).toContain("Antigravity");
    expect(detailedHtml).toContain("Codex");
    expect(detailedHtml).toContain("3小时 34分钟后重置");
    expect(detailedHtml).toContain("Gemini 周");
    expect(detailedHtml).toContain("Gemini 5h");
    expect(detailedHtml).toContain("Claude/GPT 周");
    expect(detailedHtml).toContain("Claude/GPT 5h");
    expect(detailedHtml).toContain("7%");
    expect(detailedHtml).toContain("5%");
    expect(detailedHtml).toMatch(
      /data-testid="quota-view-detailed"[^>]*aria-pressed="true"[^>]*data-active="true"[^>]*bg-primary/,
    );

    // Compact View (Fig 4)
    const compactHtml = renderToStaticMarkup(
      createElement(QuotaStatusPopover, {
        summary,
        prefs: { viewMode: "compact", percentMode: "used" },
        onPrefsChange: () => {},
        now,
        onRefresh: async () => {},
      }),
    );
    expect(compactHtml).toContain('data-quota-view="compact"');
    expect(compactHtml).toContain("6天 14小时");
    expect(compactHtml).toContain("7%");
    expect(compactHtml).toMatch(
      /data-testid="quota-view-compact"[^>]*aria-pressed="true"[^>]*data-active="true"[^>]*bg-primary/,
    );

    // Single-Agent Detail View (Fig 5)
    const detailHtml = renderToStaticMarkup(
      createElement(QuotaStatusPopover, {
        summary,
        prefs: { viewMode: "detailed", percentMode: "used" },
        onPrefsChange: () => {},
        now,
        onRefresh: async () => {},
        initialSelectedAgentId: "antigravity",
      }),
    );
    expect(detailHtml).toContain('data-quota-view="detail"');
    expect(detailHtml).toContain("更新于 刚刚");
    expect(detailHtml).toContain("Gemini · 每周");
    expect(detailHtml).toContain("6天 14小时后重置");
    expect(detailHtml).toContain("Gemini · 5h");
    expect(detailHtml).toContain("3小时 34分钟后重置");
    expect(detailHtml).toContain("Claude/GPT · 每周");
    expect(detailHtml).toContain("6天 23小时后重置");
    expect(detailHtml).toContain("Claude/GPT · 5h");
    expect(detailHtml).toContain("4小时 59分钟后重置");
    expect(detailHtml).toContain("bg-[#22c55e]");

    // Remaining mode on Detail View
    const detailRemainingHtml = renderToStaticMarkup(
      createElement(QuotaStatusPopover, {
        summary,
        prefs: { viewMode: "detailed", percentMode: "remaining" },
        onPrefsChange: () => {},
        now,
        initialSelectedAgentId: "antigravity",
      }),
    );
    expect(detailRemainingHtml).toContain("剩余");
    expect(detailRemainingHtml).toContain("93%");
    expect(detailRemainingHtml).toContain("95%");
    expect(detailRemainingHtml).toContain("100%");

    // Graceful Fallback when agy CLI is unavailable/unauthenticated
    const unauthSummary = aggregateQuotaSummary(
      {
        ...daemonQuota,
        antigravity: {
          ...daemonQuota.antigravity,
          status: "unauthenticated",
          available: false,
          windows: [],
          error: "未检测到官方 agy CLI 登录态",
        },
      },
      [],
      now,
    );
    const fallbackHtml = renderToStaticMarkup(
      createElement(QuotaStatusPopover, {
        summary: unauthSummary,
        prefs: { viewMode: "detailed", percentMode: "used" },
        onPrefsChange: () => {},
        now,
        onRefresh: async () => {},
      }),
    );
    expect(fallbackHtml).toContain("未检测到官方 agy CLI 登录态");
    expect(fallbackHtml).toContain("重试");
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
    expect(portsHtml).toContain('data-pmx-glass-zone="overlays"');
    expect(portsHtml).toContain('data-pmx-status-popover="1"');

    const resourcesHtml = renderToStaticMarkup(
      createElement(ResourcesStatusPopover, {
        raw: {
          collectedAt: Date.parse("2026-11-23T14:30:05Z"),
          totalCpuPercent: 12.5,
          totalMemoryBytes: 512 * 1024 * 1024,
          desktop: {
            pid: 1000,
            cpuPercent: 6.2,
            memoryBytes: 280 * 1024 * 1024,
            processCount: 3,
          },
          daemon: { pid: 1050, cpuPercent: 1.5, memoryBytes: 64 * 1024 * 1024 },
          t3Server: {
            pid: 2000,
            cpuPercent: 3.0,
            memoryBytes: 128 * 1024 * 1024,
            hostedBy: "electron",
            state: "running",
          },
          processes: [
            {
              pid: 1000,
              name: "Prismux 主进程",
              processName: "Prismux.exe",
              role: "electron-main",
              category: "desktop",
              cpuPercent: 1.2,
              memoryBytes: 120 * 1024 * 1024,
            },
            {
              pid: 1001,
              name: "GPU 合成 / 壁纸渲染",
              processName: "Prismux.exe",
              role: "electron-gpu",
              category: "desktop",
              cpuPercent: 5.0,
              memoryBytes: 160 * 1024 * 1024,
            },
            {
              pid: 2000,
              name: "T3 Server",
              processName: "node.exe",
              role: "t3-server",
              category: "core",
              cpuPercent: 3.0,
              memoryBytes: 128 * 1024 * 1024,
            },
            {
              pid: 2101,
              name: "Claude Code",
              processName: "node.exe",
              role: "agent",
              category: "agent",
              cpuPercent: 1.8,
              memoryBytes: 40 * 1024 * 1024,
            },
          ],
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
    expect(resourcesHtml).toContain("桌面与渲染");
    expect(resourcesHtml).toContain("PID 2000");
    expect(resourcesHtml).toContain("512 MB");
    expect(resourcesHtml).toContain("GPU 合成 / 壁纸渲染");
    expect(resourcesHtml).toContain("Claude Code");
    expect(resourcesHtml).toContain("pnpm dev");
    expect(resourcesHtml).toContain("僵死");
    expect(resourcesHtml).toContain('data-pmx-glass-zone="overlays"');
    expect(resourcesHtml).toContain('data-pmx-status-popover="1"');
    // Sort segmented control must render unmistakably highlighted active option & transparent muted unselected options across Light/Dark/Glass.
    expect(resourcesHtml).toContain('data-testid="resources-sort-group"');
    expect(resourcesHtml).toMatch(
      /data-testid="resources-sort-memory"[^>]*aria-pressed="true"[^>]*data-active="true"[^>]*bg-primary[^>]*text-primary-foreground/,
    );
    expect(resourcesHtml).toMatch(
      /data-testid="resources-sort-cpu"[^>]*aria-pressed="false"[^>]*data-active="false"[^>]*bg-transparent/,
    );
    expect(resourcesHtml).toMatch(
      /data-testid="resources-sort-name"[^>]*aria-pressed="false"[^>]*data-active="false"[^>]*bg-transparent/,
    );
    expect(resourcesHtml).not.toMatch(/data-testid="resources-sort-memory"[^>]*bg-background\b/);

    // Verify sortProcessResources orders descending by memory / cpu / name keeping nulls last
    const normalizedRes = normalizeResourcesSummary({
      processes: [
        { pid: 1, name: "beta", role: "child", category: "terminal", cpuPercent: null, memoryBytes: null },
        { pid: 2, name: "alpha", role: "agent", category: "agent", cpuPercent: 9.2, memoryBytes: 100 },
        { pid: 3, name: "gamma", role: "t3-server", category: "core", cpuPercent: 2.1, memoryBytes: 500 },
      ],
    });
    expect(sortProcessResources(normalizedRes.processes, "memory").map((p) => p.name)).toEqual([
      "gamma",
      "alpha",
      "beta",
    ]);
    expect(sortProcessResources(normalizedRes.processes, "cpu").map((p) => p.name)).toEqual([
      "alpha",
      "gamma",
      "beta",
    ]);
    expect(sortProcessResources(normalizedRes.processes, "name").map((p) => p.name)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
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

describe("statusBarKeepAwake 3-state machine, persistence & Popover UI", () => {
  it("persists and restores Keep Awake mode safely across restarts", () => {
    const storage = createMemoryStorage();
    expect(loadKeepAwakeMode(storage)).toBe(DEFAULT_KEEP_AWAKE_MODE);
    expect(DEFAULT_KEEP_AWAKE_MODE).toBe("off");

    saveKeepAwakeMode("agent", storage);
    expect(loadKeepAwakeMode(storage)).toBe("agent");

    saveKeepAwakeMode("on", storage);
    expect(loadKeepAwakeMode(storage)).toBe("on");

    // Corrupt / unknown values fall back safely to off.
    storage.setItem(KEEP_AWAKE_MODE_STORAGE_KEY, "{broken");
    expect(loadKeepAwakeMode(storage)).toBe("off");

    storage.setItem(KEEP_AWAKE_MODE_STORAGE_KEY, JSON.stringify({ mode: "agent" }));
    expect(loadKeepAwakeMode(storage)).toBe("agent");

    expect(resolveKeepAwakeLocale("zh")).toBe("zh");
    expect(resolveKeepAwakeLocale("auto")).toBe("zh");
    expect(resolveKeepAwakeLocale("en")).toBe("en");
    expect(resolveKeepAwakeLocale("en-US")).toBe("en");
  });

  it("transitions accurately across off, on, and agent (idle -> working -> idle) states", () => {
    const runningMap = new Map<string, ReadonlySet<string>>([
      ["env-local", new Set(["thread-1", "thread-2"])],
      ["env-ssh", new Set(["thread-3"])],
    ]);
    expect(countActiveRunningThreads(runningMap)).toBe(3);
    expect(countActiveRunningThreads(null)).toBe(0);

    // 1. Off mode -> never prevents sleep even if agents are running.
    const offState = deriveKeepAwakeState({
      mode: "off",
      activeThreadCount: 2,
      activeAgentProcessCount: 1,
      desktopBridgeAvailable: true,
      nativeActive: false,
    });
    expect(offState.shouldPreventSleep).toBe(false);
    expect(offState.effectiveActive).toBe(false);
    expect(offState.visualTone).toBe("off");
    expect(offState.pillLabel).toBe("关闭");
    expect(offState.statusBadgeText).toBe("关闭 · 未生效");

    // 2. On mode -> always prevents sleep even with zero running tasks.
    const onState = deriveKeepAwakeState({
      mode: "on",
      activeThreadCount: 0,
      activeAgentProcessCount: 0,
      desktopBridgeAvailable: true,
      nativeActive: true,
    });
    expect(onState.shouldPreventSleep).toBe(true);
    expect(onState.effectiveActive).toBe(true);
    expect(onState.visualTone).toBe("active");
    expect(onState.pillLabel).toBe("开启");
    expect(onState.statusBadgeText).toBe("开启 · 防休眠中");

    // 3. Agent mode idle -> standby, does not hold powerSaveBlocker.
    const agentIdle = deriveKeepAwakeState({
      mode: "agent",
      activeThreadCount: 0,
      activeAgentProcessCount: 0,
      daemonTaskBusy: false,
      desktopBridgeAvailable: true,
      nativeActive: false,
    });
    expect(agentIdle.isAgentWorking).toBe(false);
    expect(agentIdle.shouldPreventSleep).toBe(false);
    expect(agentIdle.effectiveActive).toBe(false);
    expect(agentIdle.visualTone).toBe("standby");
    expect(agentIdle.pillLabel).toBe("代理");
    expect(agentIdle.statusBadgeText).toBe("代理 · 待命中");

    // 4. Agent mode working (thread running) -> activates powerSaveBlocker.
    const agentWorkingThread = deriveKeepAwakeState({
      mode: "agent",
      activeThreadCount: 1,
      activeAgentProcessCount: 0,
      desktopBridgeAvailable: true,
      nativeActive: true,
    });
    expect(agentWorkingThread.isAgentWorking).toBe(true);
    expect(agentWorkingThread.shouldPreventSleep).toBe(true);
    expect(agentWorkingThread.effectiveActive).toBe(true);
    expect(agentWorkingThread.visualTone).toBe("active");
    expect(agentWorkingThread.statusBadgeText).toBe("代理 · 工作中生效");

    // 5. Agent mode working via active Coding Agent process or daemon background task -> also activates.
    const agentWorkingProcess = deriveKeepAwakeState({
      mode: "agent",
      activeThreadCount: 0,
      activeAgentProcessCount: 1,
      desktopBridgeAvailable: true,
      nativeActive: true,
    });
    expect(agentWorkingProcess.shouldPreventSleep).toBe(true);
    expect(agentWorkingProcess.effectiveActive).toBe(true);

    const agentWorkingDaemon = deriveKeepAwakeState({
      mode: "agent",
      activeThreadCount: 0,
      activeAgentProcessCount: 0,
      daemonTaskBusy: true,
      desktopBridgeAvailable: true,
      nativeActive: true,
    });
    expect(agentWorkingDaemon.shouldPreventSleep).toBe(true);

    // 6. Non-Electron browser fallback degrades gracefully with clear desktop notice.
    const webOnly = deriveKeepAwakeState({
      mode: "on",
      activeThreadCount: 0,
      activeAgentProcessCount: 0,
      desktopBridgeAvailable: false,
      webWakeLockActive: false,
    });
    expect(webOnly.shouldPreventSleep).toBe(true);
    expect(webOnly.effectiveActive).toBe(false);
    expect(webOnly.statusBadgeText).toBe("开启 · 仅桌面端生效");
    expect(webOnly.footerHint).toContain("桌面端");

    // 7. English locale support.
    const enAgentActive = deriveKeepAwakeState({
      mode: "agent",
      activeThreadCount: 2,
      activeAgentProcessCount: 0,
      desktopBridgeAvailable: true,
      nativeActive: true,
      locale: "en",
    });
    expect(enAgentActive.title).toBe("Keep Awake");
    expect(enAgentActive.pillLabel).toBe("Agent");
    expect(enAgentActive.statusBadgeText).toBe("Agent · Active");
  });

  it("renders KeepAwakeStatusPopover with all 3 options, liquid glass attributes, and embedded zero-border mode", () => {
    const activeState = deriveKeepAwakeState({
      mode: "agent",
      activeThreadCount: 1,
      activeAgentProcessCount: 0,
      desktopBridgeAvailable: true,
      nativeActive: true,
    });

    const standaloneHtml = renderToStaticMarkup(
      createElement(KeepAwakeStatusPopover, {
        state: activeState,
        onSelectMode: () => {},
        blockerId: 42,
      }),
    );

    expect(standaloneHtml).toContain('data-pmx-glass-zone="overlays"');
    expect(standaloneHtml).toContain('data-pmx-status-popover="1"');
    expect(standaloneHtml).toContain('data-keep-awake-mode="agent"');
    expect(standaloneHtml).toContain('data-keep-awake-active="true"');
    expect(standaloneHtml).toContain("防止电脑休眠");
    expect(standaloneHtml).toContain("代理 · 工作中生效");
    expect(standaloneHtml).toContain("始终防止此电脑进入睡眠状态");
    expect(standaloneHtml).toContain("代理工作时防止电脑进入睡眠状态");
    expect(standaloneHtml).toContain("允许系统正常进入睡眠状态");
    expect(standaloneHtml).toContain("#42");
    expect(standaloneHtml).toContain('data-testid="keep-awake-option-agent"');
    expect(standaloneHtml).toMatch(
      /data-selected="true"[^>]*data-testid="keep-awake-option-agent"[^>]*border-amber-500\/45/,
    );
    expect(standaloneHtml).toMatch(
      /data-selected="false"[^>]*data-testid="keep-awake-option-off"[^>]*border-transparent bg-transparent/,
    );

    const standbyState = deriveKeepAwakeState({
      mode: "agent",
      activeThreadCount: 0,
      activeAgentProcessCount: 0,
      desktopBridgeAvailable: true,
      nativeActive: false,
    });
    const standbyHtml = renderToStaticMarkup(
      createElement(KeepAwakeStatusPopover, {
        state: standbyState,
        onSelectMode: () => {},
      }),
    );
    expect(standbyHtml).toMatch(
      /data-selected="true"[^>]*data-testid="keep-awake-option-agent"[^>]*border-primary\/45/,
    );

    const embeddedHtml = renderToStaticMarkup(
      createElement(KeepAwakeStatusPopover, {
        state: activeState,
        onSelectMode: () => {},
        embeddedInPopover: true,
      }),
    );
    expect(embeddedHtml).toContain("bg-transparent");
    expect(embeddedHtml).not.toContain('data-pmx-glass-zone="overlays"');
    expect(embeddedHtml).not.toContain("shadow-xl");
  });

  it("enforces compact 20px status bar geometry, 10.5px text, 11px icons, and synced --pmx-status-bar-height offsets everywhere", () => {
    const webSrc = path.resolve(
      path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
      "../..",
    );

    const indexCss = fs.readFileSync(path.join(webSrc, "index.css"), "utf8");
    expect(indexCss).toContain("--pmx-status-bar-height: 20px;");

    const statusBarSource = fs.readFileSync(path.join(webSrc, "prismux/PrismuxStatusBar.tsx"), "utf8");
    expect(statusBarSource).toContain("export const PRISMUX_STATUS_BAR_HEIGHT_PX = 20 as const;");
    expect(statusBarSource).toContain("h-[var(--pmx-status-bar-height,20px)]");
    expect(statusBarSource).toContain("text-[10.5px] leading-none");
    expect(statusBarSource).toContain("size-[11px]");
    expect(statusBarSource).toContain("inline-flex h-4");
    expect(statusBarSource).not.toContain("flex h-6 w-full");
    expect(statusBarSource).not.toContain("text-[11px] leading-none");

    const rootSource = fs.readFileSync(path.join(webSrc, "routes/__root.tsx"), "utf8");
    expect(rootSource).toContain("[&_[data-slot=sidebar-container]]:!bottom-[var(--pmx-status-bar-height,20px)]");
    expect(rootSource).toContain(
      "[&_[data-slot=sidebar-container]]:!h-[calc(100dvh-var(--pmx-status-bar-height,20px))]",
    );
    expect(rootSource).not.toContain("!bottom-6");
    expect(rootSource).not.toContain("calc(100dvh-1.5rem)");

    const updateHostSource = fs.readFileSync(
      path.join(webSrc, "prismux/updates/PrismuxAutoUpdateHost.tsx"),
      "utf8",
    );
    expect(updateHostSource).toContain("bottom-[calc(var(--pmx-status-bar-height,20px)+12px)]");
    expect(updateHostSource).not.toContain("right-4 bottom-9");

    const drawerSource = fs.readFileSync(
      path.join(webSrc, "prismux/settings/plugins/PluginDetailDrawer.tsx"),
      "utf8",
    );
    expect(drawerSource).toContain("top-0 right-0 bottom-[var(--pmx-status-bar-height,20px)] left-0");

    const auditModalSource = fs.readFileSync(
      path.join(webSrc, "prismux/settings/plugins/PluginTrustAuditModal.tsx"),
      "utf8",
    );
    expect(auditModalSource).toContain(
      "top-0 right-0 bottom-[var(--pmx-status-bar-height,20px)] left-0",
    );

    const sidebarChromeSource = fs.readFileSync(
      path.join(webSrc, "components/sidebar/SidebarChrome.tsx"),
      "utf8",
    );
    // SidebarCollapsedPeekDrawer was removed in v0.1.3+; SidebarChrome no longer pins legacy peek overlays.
    expect(sidebarChromeSource).not.toContain("SidebarCollapsedPeekDrawer");
  });
});
