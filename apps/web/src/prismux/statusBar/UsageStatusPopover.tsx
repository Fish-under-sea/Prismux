import { Link } from "@tanstack/react-router";
import {
  ActivityIcon,
  CheckIcon,
  DatabaseZapIcon,
  ExternalLinkIcon,
  GaugeIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import type { ContextGaugeSummary } from "./statusBarContext";
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from "./statusBarContextMenuPolicy";
import { STATUS_BAR_ACTION_BUTTON_CLASS } from "./statusBarControlStyles";
import {
  formatCompactUsageTokens,
  formatCompactUsd,
  type StatusBarUsageSummary,
} from "./statusBarUsage";
import type { StatusBarUsagePreferences } from "./statusBarVisibility";

export interface UsageStatusPopoverProps {
  readonly summary: StatusBarUsageSummary;
  readonly activeThreadIsAntigravity?: boolean;
  readonly contextGauge?: ContextGaugeSummary;
  readonly prefs?: StatusBarUsagePreferences;
  readonly onPrefsChange?: (next: StatusBarUsagePreferences) => void;
  readonly now?: number;
  readonly loading?: boolean;
  readonly onRefresh?: () => Promise<void>;
  readonly onClose: () => void;
  readonly embeddedInPopover?: boolean;
}

export function UsageStatusPopover({
  summary,
  loading = false,
  onRefresh,
  onClose,
  embeddedInPopover = false,
}: UsageStatusPopoverProps) {
  const [refreshingLocal, setRefreshingLocal] = useState(false);
  const [justRefreshed, setJustRefreshed] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) {
        clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  const handleRefresh = async () => {
    if (!onRefresh || refreshingLocal) return;
    setRefreshingLocal(true);
    try {
      await onRefresh();
      setJustRefreshed(true);
      if (flashTimerRef.current !== null) {
        clearTimeout(flashTimerRef.current);
      }
      flashTimerRef.current = setTimeout(() => {
        setJustRefreshed(false);
        flashTimerRef.current = null;
      }, 1_400);
    } finally {
      setRefreshingLocal(false);
    }
  };

  const isBusy = loading || refreshingLocal;
  const { telemetry } = summary;
  const hasTelemetryData =
    telemetry.todayTokens > 0 ||
    telemetry.weekTokens > 0 ||
    telemetry.weekRecords > 0 ||
    telemetry.providers.length > 0;

  return (
    <div
      {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
      {...(!embeddedInPopover
        ? {
            "data-pmx-glass-zone": "overlays",
            "data-pmx-status-popover": "1",
          }
        : {})}
      className={cn(
        "flex w-[24.5rem] max-w-[calc(100vw-1rem)] flex-col gap-3 p-3.5 text-popover-foreground",
        embeddedInPopover
          ? "bg-transparent"
          : "overflow-hidden rounded-xl border border-border bg-popover bg-clip-padding shadow-xl",
      )}
      data-testid="prismux-usage-popover"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <GaugeIcon aria-hidden className="size-3.5 shrink-0 text-foreground" />
          <span className="truncate text-xs font-semibold text-foreground">用量总览</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onRefresh ? (
            <button
              type="button"
              disabled={isBusy}
              aria-busy={isBusy || undefined}
              data-testid="usage-refresh-button"
              onClick={() => void handleRefresh()}
              className={STATUS_BAR_ACTION_BUTTON_CLASS}
            >
              {justRefreshed && !isBusy ? (
                <CheckIcon aria-hidden className="size-3 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <RefreshCwIcon aria-hidden className={cn("size-3", isBusy && "animate-spin")} />
              )}
              <span>{isBusy ? "刷新中…" : justRefreshed ? "已刷新" : "刷新"}</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Real Local Usage Telemetry (Today & 7-Day Tokens / Calls / Cache / Cost) */}
      {hasTelemetryData ? (
        <div
          data-testid="prismux-usage-telemetry-section"
          className="flex flex-col gap-2"
        >
          <div className="grid grid-cols-3 gap-1.5 text-xs tabular-nums">
            <div className="rounded-lg border border-border/70 bg-muted/35 p-2">
              <div className="text-[11px] text-muted-foreground">今日用量</div>
              <div className="mt-0.5 font-semibold text-foreground">
                {formatCompactUsageTokens(telemetry.todayTokens)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {telemetry.todayCostUsd > 0 ? `约 ${formatCompactUsd(telemetry.todayCostUsd)}` : "按本地记录"}
              </div>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/35 p-2">
              <div className="text-[11px] text-muted-foreground">近 7 日</div>
              <div className="mt-0.5 font-semibold text-foreground">
                {formatCompactUsageTokens(telemetry.weekTokens)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {telemetry.weekRecords} 次调用
                {telemetry.weekCostUsd > 0 ? ` · ${formatCompactUsd(telemetry.weekCostUsd)}` : ""}
              </div>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/35 p-2">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <DatabaseZapIcon aria-hidden className="size-3 shrink-0" />
                <span>缓存命中</span>
              </div>
              <div className="mt-0.5 font-semibold text-foreground">
                {telemetry.cacheHitPercent !== null ? `${telemetry.cacheHitPercent}%` : "—"}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {telemetry.cacheSavingsUsd > 0
                  ? `节省 ${formatCompactUsd(telemetry.cacheSavingsUsd)}`
                  : `${telemetry.weekSessions} 会话`}
              </div>
            </div>
          </div>

          {telemetry.providers.length > 0 ? (
            <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-0.5">
              {telemetry.providers.map((prov) => (
                <div
                  key={prov.key}
                  className="flex flex-col gap-1 rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2 text-xs tabular-nums"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <ActivityIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate font-semibold text-foreground">
                        {prov.providerName}
                      </span>
                      <span className="shrink-0 rounded-sm bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {prov.hasQuotaWindow
                          ? "官方配额"
                          : prov.isCustomEndpoint
                            ? "自定义端点"
                            : "本地统计"}
                      </span>
                    </div>
                    <span className="shrink-0 font-semibold text-foreground">
                      {prov.weekCostUsd > 0
                        ? formatCompactUsd(prov.weekCostUsd)
                        : formatCompactUsageTokens(prov.weekTokens)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>
                      今日 {formatCompactUsageTokens(prov.todayTokens)} · 7日{" "}
                      {formatCompactUsageTokens(prov.weekTokens)}
                    </span>
                    <span>
                      {prov.weekRecords} 次
                      {prov.cacheHitPercent !== null ? ` · 缓存 ${prov.cacheHitPercent}%` : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
          {isBusy
            ? "正在读取本地近 7 日 Token 与费用统计…"
            : "暂无近 7 日调用记录。在任意会话发送消息后，此处将实时汇总今日/本周 Token、缓存命中与估算费用。"}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border/70 pt-2 text-[11px]">
        <span className="text-muted-foreground">本地近 7 日实时统计</span>
        <Link
          to="/usage"
          onClick={onClose}
          className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span>完整用量统计</span>
          <ExternalLinkIcon aria-hidden className="size-3 shrink-0" />
        </Link>
      </div>
    </div>
  );
}
