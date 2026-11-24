import { Link } from "@tanstack/react-router";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckIcon,
  CopyIcon,
  DatabaseZapIcon,
  ExternalLinkIcon,
  GaugeIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TerminalIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import type { ContextGaugeSummary } from "./statusBarContext";
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from "./statusBarContextMenuPolicy";
import {
  STATUS_BAR_ACTION_BUTTON_CLASS,
  STATUS_BAR_SEGMENTED_GROUP_CLASS,
  statusBarSegmentedOptionClass,
} from "./statusBarControlStyles";
import {
  formatCompactUsageTokens,
  formatCompactUsageWindowValue,
  formatCompactUsd,
  formatResetCountdown,
  formatUsageWindowValue,
  type StatusBarUsageSummary,
  type StatusBarUsageWindowEntry,
} from "./statusBarUsage";
import type {
  StatusBarUsagePreferences,
  UsagePercentMode,
  UsagePopoverDensity,
} from "./statusBarVisibility";

export interface UsageStatusPopoverProps {
  readonly summary: StatusBarUsageSummary;
  readonly activeThreadIsAntigravity: boolean;
  readonly contextGauge?: ContextGaugeSummary;
  readonly prefs: StatusBarUsagePreferences;
  readonly onPrefsChange: (next: StatusBarUsagePreferences) => void;
  readonly now: number;
  readonly loading?: boolean;
  readonly onRefresh?: () => Promise<void>;
  readonly onClose: () => void;
  readonly embeddedInPopover?: boolean;
}

function urgencyBarClass(urgency: StatusBarUsageWindowEntry["urgency"]): string {
  switch (urgency) {
    case "critical":
      return "bg-red-600 dark:bg-red-500";
    case "warning":
      return "bg-amber-600 dark:bg-amber-400";
    default:
      return "bg-emerald-600 dark:bg-emerald-400";
  }
}

function urgencyTextClass(urgency: StatusBarUsageWindowEntry["urgency"]): string {
  switch (urgency) {
    case "critical":
      return "text-red-700 dark:text-red-300";
    case "warning":
      return "text-amber-700 dark:text-amber-300";
    default:
      return "text-foreground";
  }
}

export function UsageStatusPopover({
  summary,
  activeThreadIsAntigravity,
  contextGauge,
  prefs,
  onPrefsChange,
  now,
  loading = false,
  onRefresh,
  onClose,
  embeddedInPopover = false,
}: UsageStatusPopoverProps) {
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
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

  const setDensity = (density: UsagePopoverDensity) => {
    onPrefsChange({ ...prefs, density });
  };

  const setPercentMode = (percentMode: UsagePercentMode) => {
    onPrefsChange({ ...prefs, percentMode });
  };

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

  const copyCommand = async (cmd: string) => {
    try {
      await navigator.clipboard?.writeText(cmd);
      setCopiedCmd(cmd);
      setTimeout(() => {
        setCopiedCmd((cur) => (cur === cmd ? null : cur));
      }, 1600);
    } catch {
      // Ignore clipboard failures in restricted environments.
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
          <span className="truncate text-xs font-semibold text-foreground">
            额度与用量总览
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {summary.windows.length > 0 ? (
            <>
              <div
                role="group"
                aria-label="显示密度"
                className={STATUS_BAR_SEGMENTED_GROUP_CLASS}
              >
                <button
                  type="button"
                  aria-pressed={prefs.density === "detailed"}
                  data-active={prefs.density === "detailed" ? "true" : "false"}
                  onClick={() => setDensity("detailed")}
                  className={statusBarSegmentedOptionClass(prefs.density === "detailed")}
                >
                  详细
                </button>
                <button
                  type="button"
                  aria-pressed={prefs.density === "compact"}
                  data-active={prefs.density === "compact" ? "true" : "false"}
                  onClick={() => setDensity("compact")}
                  className={statusBarSegmentedOptionClass(prefs.density === "compact")}
                >
                  紧凑
                </button>
              </div>
              <div
                role="group"
                aria-label="百分比模式"
                className={STATUS_BAR_SEGMENTED_GROUP_CLASS}
              >
                <button
                  type="button"
                  aria-pressed={prefs.percentMode === "used"}
                  data-active={prefs.percentMode === "used" ? "true" : "false"}
                  aria-description="按已用额度百分比显示，点击切换"
                  onClick={(event) => {
                    setPercentMode("used");
                    if (event.detail > 0) event.currentTarget.blur();
                  }}
                  className={statusBarSegmentedOptionClass(prefs.percentMode === "used")}
                >
                  % 已用
                </button>
                <button
                  type="button"
                  aria-pressed={prefs.percentMode === "remaining"}
                  data-active={prefs.percentMode === "remaining" ? "true" : "false"}
                  aria-description="按剩余额度百分比显示，点击切换"
                  onClick={(event) => {
                    setPercentMode("remaining");
                    if (event.detail > 0) event.currentTarget.blur();
                  }}
                  className={statusBarSegmentedOptionClass(prefs.percentMode === "remaining")}
                >
                  % 剩余
                </button>
              </div>
            </>
          ) : null}

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

      {/* Section A: Official Provider Quota Windows */}
      {summary.windows.length > 0 ? (
        <div
          data-testid="prismux-usage-quota-windows"
          className="flex max-h-48 flex-col gap-2 overflow-y-auto pr-0.5"
        >
          {summary.windows.map((win) => {
            const countdown = formatResetCountdown(win.resetsAtMs, now);
            const barWidth =
              prefs.percentMode === "remaining" ? win.remainingPercent : win.usedPercent;
            if (prefs.density === "compact") {
              return (
                <div
                  key={win.key}
                  className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] items-center gap-2 rounded-md border border-border/60 bg-muted/35 px-2 py-1 text-xs"
                >
                  <span className="truncate font-medium text-foreground">
                    {win.providerName} · {win.label}
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn("block h-full rounded-full", urgencyBarClass(win.urgency))}
                      style={{ width: `${Math.max(4, barWidth)}%` }}
                    />
                  </span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      urgencyTextClass(win.urgency),
                    )}
                  >
                    {formatCompactUsageWindowValue(win, prefs.percentMode)}
                  </span>
                </div>
              );
            }

            return (
              <div
                key={win.key}
                className={cn(
                  "flex flex-col gap-1.5 rounded-lg border px-2.5 py-2 text-xs",
                  win.urgency === "critical"
                    ? "border-red-500/50 bg-red-500/8"
                    : win.urgency === "warning"
                      ? "border-amber-500/50 bg-amber-500/8"
                      : "border-border/70 bg-muted/30",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {win.urgency !== "normal" ? (
                      <AlertTriangleIcon
                        aria-hidden
                        className={cn("size-3.5 shrink-0", urgencyTextClass(win.urgency))}
                      />
                    ) : null}
                    <span className="truncate font-semibold text-foreground">
                      {win.providerName}
                    </span>
                    <span className="truncate text-muted-foreground">· {win.label}</span>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 font-semibold tabular-nums",
                      urgencyTextClass(win.urgency),
                    )}
                  >
                    {formatUsageWindowValue(win, prefs.percentMode)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none",
                      urgencyBarClass(win.urgency),
                    )}
                    style={{ width: `${Math.max(barWidth > 0 ? 3 : 0, barWidth)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
                  <span>
                    已用 {win.usedPercent}% / 剩余 {win.remainingPercent}%
                  </span>
                  <span>{countdown ?? "重置时间未告知"}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Section B: Real Local Usage Telemetry (Today & 7-Day Tokens / Calls / Cache / Cost) */}
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
            <div className="flex max-h-44 flex-col gap-1.5 overflow-y-auto pr-0.5">
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
      ) : summary.windows.length === 0 ? (
        <div className="rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
          {isBusy
            ? "正在读取各提供方配额与本地用量记录…"
            : "暂无近 7 日调用记录。在任意会话发送消息后，此处将实时汇总今日/本周 Token、缓存命中与估算费用。"}
        </div>
      ) : null}

      {/* Section C: Antigravity Official ACP Compliance Card */}
      {summary.antigravityEntries.length > 0 ? (
        <div
          className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2.5 text-xs"
          data-testid="prismux-antigravity-acp-card"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
              <ShieldCheckIcon aria-hidden className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              Antigravity（纯官方 ACP 合规）
            </span>
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground">
              {summary.antigravityEntries[0]?.tierLabel ??
                (summary.antigravityEntries[0]?.authenticated ? "已通过 agy ACP 登录" : "未登录")}
            </span>
          </div>
          {activeThreadIsAntigravity && contextGauge && contextGauge.level !== "unknown" ? (
            <div className="flex items-center justify-between text-[11px] text-foreground tabular-nums">
              <span>当前会话 ACP 上下文水位</span>
              <span className="font-semibold">
                {formatContextWindowTokens(contextGauge.usedTokens)} /{" "}
                {formatContextWindowTokens(contextGauge.maxTokens)}（{contextGauge.displayPercent}%）
              </span>
            </div>
          ) : null}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {summary.antigravityEntries[0]?.complianceNotice}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["/usage", "/credits"] as const).map((cmd) => {
              const isCopied = copiedCmd === cmd;
              return (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => void copyCommand(cmd)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  <TerminalIcon aria-hidden className="size-3 shrink-0" />
                  <span>agy → {cmd}</span>
                  {isCopied ? (
                    <CheckIcon aria-hidden className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <CopyIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t border-border/70 pt-2 text-[11px]">
        <span className="text-muted-foreground">
          {summary.windows.length > 0 ? "官方配额 + 本地统计" : "本地近 7 日实时统计"}
        </span>
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
