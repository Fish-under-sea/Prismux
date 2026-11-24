import {
  ArrowLeftIcon,
  ArrowUpDownIcon,
  ChevronRightIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import { AgentBrandLogo } from "../agentBrand";
import {
  formatQuotaResetDuration,
  formatQuotaResetLabel,
  formatQuotaUpdatedAgo,
  getQuotaBarWidthPercent,
  getQuotaDisplayPercent,
  type QuotaAgentEntry,
  type QuotaPercentMode,
  type QuotaPreferences,
  type QuotaStatusSummary,
  type QuotaTone,
  type QuotaViewMode,
} from "./quotaStatus.logic";
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from "./statusBarContextMenuPolicy";
import {
  STATUS_BAR_ACTION_BUTTON_CLASS,
  STATUS_BAR_SEGMENTED_GROUP_CLASS,
  statusBarSegmentedOptionClass,
} from "./statusBarControlStyles";

export interface QuotaStatusPopoverProps {
  readonly summary: QuotaStatusSummary;
  readonly prefs: QuotaPreferences;
  readonly onPrefsChange: (next: QuotaPreferences) => void;
  readonly now: number;
  readonly loading?: boolean;
  readonly onRefresh?: (force: boolean) => Promise<void>;
  /** Optional controlled/initial agent drill-down ID (useful for deterministic SSR/UI testing). */
  readonly initialSelectedAgentId?: string | null;
  readonly embeddedInPopover?: boolean;
}

function detailBarColorClass(tone: QuotaTone): string {
  switch (tone) {
    case "critical":
      return "bg-[#ef4444]";
    case "warning":
      return "bg-[#f59e0b]";
    default:
      return "bg-[#22c55e]";
  }
}

function miniBarColorClass(tone: QuotaTone): string {
  switch (tone) {
    case "critical":
      return "bg-[#ef4444]";
    case "warning":
      return "bg-[#f59e0b]";
    default:
      return "bg-[#22c55e]";
  }
}

function percentTextToneClass(tone: QuotaTone): string {
  switch (tone) {
    case "critical":
      return "text-red-600 dark:text-red-400";
    case "warning":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-foreground";
  }
}

const TRACK_SURFACE_CLASS =
  "overflow-hidden rounded-full bg-black/[0.11] dark:bg-white/[0.13] [[data-pmx-glass='1']_&]:bg-white/16 [html:not(.dark)[data-pmx-glass='1']_&]:bg-black/14";

const MODE_TOGGLE_CLASS =
  "inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

const ICON_BUTTON_CLASS =
  "inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.06] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

export function QuotaStatusPopover({
  summary,
  prefs,
  onPrefsChange,
  now,
  loading = false,
  onRefresh,
  initialSelectedAgentId = null,
  embeddedInPopover = false,
}: QuotaStatusPopoverProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(initialSelectedAgentId);
  const [refreshingLocal, setRefreshingLocal] = useState(false);

  // Sync if selected agent disappears after a refresh.
  const selectedAgent: QuotaAgentEntry | null =
    selectedAgentId !== null
      ? summary.availableAgents.find((agent) => agent.id === selectedAgentId) ?? null
      : null;

  useEffect(() => {
    if (selectedAgentId !== null && selectedAgent === null) {
      setSelectedAgentId(null);
    }
  }, [selectedAgent, selectedAgentId]);

  const isBusy = loading || refreshingLocal;

  const setViewMode = (viewMode: QuotaViewMode) => {
    onPrefsChange({ ...prefs, viewMode });
  };

  const togglePercentMode = () => {
    const nextMode: QuotaPercentMode = prefs.percentMode === "used" ? "remaining" : "used";
    onPrefsChange({ ...prefs, percentMode: nextMode });
  };

  const handleRefresh = async () => {
    if (!onRefresh || refreshingLocal) return;
    setRefreshingLocal(true);
    try {
      await onRefresh(true);
    } finally {
      setRefreshingLocal(false);
    }
  };

  const modeLabel = prefs.percentMode === "remaining" ? "剩余" : "已用";

  const containerProps = {
    ...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS,
    ...(!embeddedInPopover
      ? {
          "data-pmx-glass-zone": "overlays",
          "data-pmx-status-popover": "1",
        }
      : {}),
  };

  // View 3: Single-Agent Detail View (Fig 5)
  if (selectedAgent !== null) {
    return (
      <div
        {...containerProps}
        data-testid="prismux-quota-popover"
        data-quota-view="detail"
        className={cn(
          "flex w-[27.5rem] max-w-[calc(100vw-1rem)] flex-col gap-3 p-4 text-popover-foreground",
          embeddedInPopover
            ? "bg-transparent"
            : "overflow-hidden rounded-xl border border-border bg-popover bg-clip-padding shadow-xl",
        )}
      >
        {/* Detail Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="quota-detail-back"
                aria-label="返回所有代理"
                title="返回所有代理"
                onClick={() => setSelectedAgentId(null)}
                className={cn(ICON_BUTTON_CLASS, "-ml-1 size-5")}
              >
                <ArrowLeftIcon aria-hidden className="size-3.5" />
              </button>
              <AgentBrandLogo provider={selectedAgent.brandProvider} size={18} />
              <span className="truncate text-[14px] font-semibold text-foreground">
                {selectedAgent.displayName}
              </span>
            </div>
            <span
              data-testid="quota-detail-updated-at"
              className="mt-1 pl-5 text-xs text-muted-foreground"
            >
              {formatQuotaUpdatedAgo(selectedAgent.fetchedAt, now)}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {onRefresh ? (
              <button
                type="button"
                disabled={isBusy}
                aria-busy={isBusy || undefined}
                aria-label="刷新额度"
                title="立即刷新实时额度"
                data-testid="quota-refresh-button"
                onClick={() => void handleRefresh()}
                className={ICON_BUTTON_CLASS}
              >
                <RefreshCwIcon aria-hidden className={cn("size-3.5", isBusy && "animate-spin")} />
              </button>
            ) : null}
            <button
              type="button"
              data-testid="quota-percent-mode-toggle"
              aria-label={`当前按${modeLabel}百分比显示，点击切换`}
              onClick={togglePercentMode}
              className={MODE_TOGGLE_CLASS}
            >
              <span>{modeLabel}</span>
              <ArrowUpDownIcon aria-hidden className="size-3" />
            </button>
          </div>
        </div>

        <div className="border-t border-border/60" />

        {/* 4 Detailed Full-Width Progress Rows */}
        <div data-testid="quota-detail-windows" className="flex flex-col gap-3.5">
          {selectedAgent.windows.map((win) => {
            const resetLabel = formatQuotaResetLabel(win.resetAtMs, now);
            const displayPercent = getQuotaDisplayPercent(win, prefs.percentMode);
            const barWidth = getQuotaBarWidthPercent(win, prefs.percentMode);
            return (
              <div
                key={win.id}
                data-testid={`quota-detail-row-${win.id}`}
                className="flex flex-col gap-1.5"
              >
                <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                  <div className="min-w-0 truncate">
                    <span className="font-semibold text-foreground">{win.detailLabel}</span>
                    {resetLabel ? (
                      <span className="text-muted-foreground tabular-nums"> · {resetLabel}</span>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 font-semibold tabular-nums",
                      percentTextToneClass(win.tone),
                    )}
                  >
                    {displayPercent}%
                  </span>
                </div>
                <div className={cn("h-[6px] w-full", TRACK_SURFACE_CLASS)}>
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none",
                      detailBarColorClass(win.tone),
                    )}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {selectedAgent.remainingCredits !== null && selectedAgent.remainingCredits > 0 ? (
          <div className="flex items-center justify-between border-t border-border/60 pt-2 text-[11px] text-muted-foreground tabular-nums">
            <span>剩余 Credits</span>
            <span className="font-semibold text-foreground">{selectedAgent.remainingCredits}</span>
          </div>
        ) : null}
      </div>
    );
  }

  // View 1 & View 2: All Agents List (Fig 3 Detailed / Fig 4 Compact)
  return (
    <div
      {...containerProps}
      data-testid="prismux-quota-popover"
      data-quota-view={prefs.viewMode}
      className={cn(
        "flex w-[27.5rem] max-w-[calc(100vw-1rem)] flex-col gap-3 p-3.5 text-popover-foreground",
        embeddedInPopover
          ? "bg-transparent"
          : "overflow-hidden rounded-xl border border-border bg-popover bg-clip-padding shadow-xl",
      )}
    >
      {/* Top Header Bar (Fig 3 & Fig 4) */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-[13.5px] font-semibold text-foreground">使用量</span>
          <span className="text-xs text-muted-foreground">· 所有代理</span>
          {onRefresh ? (
            <button
              type="button"
              disabled={isBusy}
              aria-busy={isBusy || undefined}
              aria-label="刷新额度"
              title="立即刷新实时额度"
              data-testid="quota-refresh-button"
              onClick={() => void handleRefresh()}
              className={ICON_BUTTON_CLASS}
            >
              <RefreshCwIcon aria-hidden className={cn("size-3.5", isBusy && "animate-spin")} />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          data-testid="quota-percent-mode-toggle"
          aria-label={`当前按${modeLabel}百分比显示，点击切换`}
          onClick={togglePercentMode}
          className={MODE_TOGGLE_CLASS}
        >
          <span>{modeLabel}</span>
          <ArrowUpDownIcon aria-hidden className="size-3" />
        </button>
      </div>

      {/* High-Contrast Full-Width Segmented Switcher: 详细 | 精简 */}
      <div
        role="group"
        aria-label="额度视图模式"
        data-testid="quota-view-segmented"
        className={cn(STATUS_BAR_SEGMENTED_GROUP_CLASS, "w-full p-0.5")}
      >
        <button
          type="button"
          data-testid="quota-view-detailed"
          aria-pressed={prefs.viewMode === "detailed"}
          data-active={prefs.viewMode === "detailed" ? "true" : "false"}
          onClick={() => setViewMode("detailed")}
          className={cn(
            statusBarSegmentedOptionClass(prefs.viewMode === "detailed"),
            "flex-1 py-1 text-center text-xs",
          )}
        >
          详细
        </button>
        <button
          type="button"
          data-testid="quota-view-compact"
          aria-pressed={prefs.viewMode === "compact"}
          data-active={prefs.viewMode === "compact" ? "true" : "false"}
          onClick={() => setViewMode("compact")}
          className={cn(
            statusBarSegmentedOptionClass(prefs.viewMode === "compact"),
            "flex-1 py-1 text-center text-xs",
          )}
        >
          精简
        </button>
      </div>

      <div className="border-t border-border/60" />

      {/* Agent List or Graceful Fallback */}
      {summary.availableAgents.length > 0 ? (
        <div data-testid="quota-agent-list" className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {summary.availableAgents.map((agent) => {
            if (prefs.viewMode === "compact") {
              const primary = agent.primaryWindow;
              const compactReset = primary
                ? formatQuotaResetDuration(primary.resetAtMs, now)
                : null;
              const primaryPercent = primary
                ? getQuotaDisplayPercent(primary, prefs.percentMode)
                : 0;
              const primaryBarWidth = primary
                ? getQuotaBarWidthPercent(primary, prefs.percentMode)
                : 0;
              const primaryTone: QuotaTone = primary?.tone ?? "normal";

              return (
                <button
                  key={agent.id}
                  type="button"
                  data-testid={`quota-agent-row-${agent.id}`}
                  onClick={() => setSelectedAgentId(agent.id)}
                  className="group flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-black/[0.04] dark:bg-white/[0.06]">
                      <AgentBrandLogo provider={agent.brandProvider} size={16} />
                    </span>
                    <span className="truncate text-[13px] font-semibold text-foreground">
                      {agent.displayName}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-2.5 tabular-nums">
                    {compactReset ? (
                      <span className="text-xs text-muted-foreground">{compactReset}</span>
                    ) : null}
                    <span className={cn("h-1.5 w-11 shrink-0", TRACK_SURFACE_CLASS)}>
                      <span
                        className={cn("block h-full rounded-full", miniBarColorClass(primaryTone))}
                        style={{ width: `${primaryBarWidth}%` }}
                      />
                    </span>
                    <span
                      className={cn(
                        "min-w-[2.1rem] text-right text-[13px] font-semibold",
                        percentTextToneClass(primaryTone),
                      )}
                    >
                      {primaryPercent}%
                    </span>
                    <ChevronRightIcon
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                    />
                  </div>
                </button>
              );
            }

            // Detailed view row (Fig 3)
            const soonestResetLabel = formatQuotaResetLabel(agent.soonestResetAtMs, now);
            return (
              <button
                key={agent.id}
                type="button"
                data-testid={`quota-agent-row-${agent.id}`}
                onClick={() => setSelectedAgentId(agent.id)}
                className="group flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              >
                <span className="inline-flex size-8 shrink-0 items-center justify-center self-start rounded-full border border-border/70 bg-black/[0.04] dark:bg-white/[0.06]">
                  <AgentBrandLogo provider={agent.brandProvider} size={18} />
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[13px] font-semibold text-foreground">
                      {agent.displayName}
                    </span>
                    {soonestResetLabel ? (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {soonestResetLabel}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11.5px] tabular-nums">
                    {agent.windows.map((win) => {
                      const displayPercent = getQuotaDisplayPercent(win, prefs.percentMode);
                      const barWidth = getQuotaBarWidthPercent(win, prefs.percentMode);
                      return (
                        <span
                          key={win.id}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <span className="text-muted-foreground">{win.shortLabel}</span>
                          <span className={cn("h-1.5 w-8 shrink-0", TRACK_SURFACE_CLASS)}>
                            <span
                              className={cn(
                                "block h-full rounded-full",
                                miniBarColorClass(win.tone),
                              )}
                              style={{ width: `${barWidth}%` }}
                            />
                          </span>
                          <span
                            className={cn("font-semibold", percentTextToneClass(win.tone))}
                          >
                            {displayPercent}%
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>

                <ChevronRightIcon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                />
              </button>
            );
          })}
        </div>
      ) : isBusy ? (
        <div
          data-testid="quota-loading-state"
          className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-3 text-xs text-muted-foreground"
        >
          <RefreshCwIcon aria-hidden className="size-3.5 shrink-0 animate-spin" />
          <span>正在通过官方 agy CLI 获取实时额度…</span>
        </div>
      ) : (
        <div
          data-testid="quota-fallback-state"
          className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-black/[0.04] dark:bg-white/[0.06]">
              <AgentBrandLogo provider="antigravity" size={16} online={false} />
            </span>
            <div className="min-w-0">
              <div className="font-medium text-foreground">
                {summary.antigravityError ?? "未检测到官方 agy CLI 登录态"}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                请确认本机已安装并登录官方 agy CLI 后点击重试
              </div>
            </div>
          </div>
          {onRefresh ? (
            <button
              type="button"
              data-testid="quota-retry-button"
              onClick={() => void handleRefresh()}
              className={cn(STATUS_BAR_ACTION_BUTTON_CLASS, "shrink-0")}
            >
              <RefreshCwIcon aria-hidden className="size-3" />
              <span>重试</span>
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
