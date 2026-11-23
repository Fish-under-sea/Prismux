import { Link } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  GaugeIcon,
  ShieldCheckIcon,
  TerminalIcon,
} from "lucide-react";
import { useState } from "react";

import { formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import type { ContextGaugeSummary } from "./statusBarContext";
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from "./statusBarContextMenuPolicy";
import {
  formatCompactUsageWindowValue,
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
  readonly contextGauge: ContextGaugeSummary;
  readonly prefs: StatusBarUsagePreferences;
  readonly onPrefsChange: (next: StatusBarUsagePreferences) => void;
  readonly now: number;
  readonly onClose: () => void;
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
  onClose,
}: UsageStatusPopoverProps) {
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const setDensity = (density: UsagePopoverDensity) => {
    onPrefsChange({ ...prefs, density });
  };

  const setPercentMode = (percentMode: UsagePercentMode) => {
    onPrefsChange({ ...prefs, percentMode });
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

  return (
    <div
      {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
      className="flex w-88 max-w-[calc(100vw-1rem)] flex-col gap-3 rounded-xl border border-border bg-popover p-3.5 text-popover-foreground shadow-xl"
      data-testid="prismux-usage-popover"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <GaugeIcon aria-hidden className="size-3.5 shrink-0 text-foreground" />
          <span className="truncate text-xs font-semibold text-foreground">
            合规额度与订阅总览
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div
            role="group"
            aria-label="显示密度"
            className="inline-flex rounded-md border border-border bg-muted/60 p-0.5 text-[11px]"
          >
            <button
              type="button"
              aria-pressed={prefs.density === "detailed"}
              onClick={() => setDensity("detailed")}
              className={cn(
                "cursor-pointer rounded-sm px-1.5 py-0.5 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                prefs.density === "detailed"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              详细
            </button>
            <button
              type="button"
              aria-pressed={prefs.density === "compact"}
              onClick={() => setDensity("compact")}
              className={cn(
                "cursor-pointer rounded-sm px-1.5 py-0.5 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                prefs.density === "compact"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              紧凑
            </button>
          </div>
          <div
            role="group"
            aria-label="百分比模式"
            className="inline-flex rounded-md border border-border bg-muted/60 p-0.5 text-[11px]"
          >
            <button
              type="button"
              aria-pressed={prefs.percentMode === "used"}
              aria-description="按已用额度百分比显示，点击切换"
              onClick={(event) => {
                setPercentMode("used");
                if (event.detail > 0) event.currentTarget.blur();
              }}
              className={cn(
                "cursor-pointer rounded-sm px-1.5 py-0.5 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                prefs.percentMode === "used"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              % 已用
            </button>
            <button
              type="button"
              aria-pressed={prefs.percentMode === "remaining"}
              aria-description="按剩余额度百分比显示，点击切换"
              onClick={(event) => {
                setPercentMode("remaining");
                if (event.detail > 0) event.currentTarget.blur();
              }}
              className={cn(
                "cursor-pointer rounded-sm px-1.5 py-0.5 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                prefs.percentMode === "remaining"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              % 剩余
            </button>
          </div>
        </div>
      </div>

      {summary.windows.length > 0 ? (
        <div className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-0.5">
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
      ) : (
        <div className="rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
          暂未检测到提供官方配额窗口的 Provider（如 Codex / Claude / OMP）。
        </div>
      )}

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
          {activeThreadIsAntigravity && contextGauge.level !== "unknown" ? (
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
        <span className="text-muted-foreground">按最紧迫窗口优先排序</span>
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
