import { type UsageProviderKind } from "@t3tools/contracts";
import { formatDateTimeShort, formatTokens } from "@t3tools/shared/usageFormat";
import { msg, useLocale, useMessages } from "gt-react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Button } from "../ui/button";
import {
  formatCacheHitRate,
  formatDurationMs,
  formatTps,
  formatTtft,
  type UsageCallLogRecord,
  type UsageCallStatus,
} from "./usageCallTelemetryStore";
import { PROVIDER_PRESENTATION } from "./usageProviders";

export type CallLogsSortField = "timestamp" | "ttftMs" | "tps" | "cacheHitRate";
export type CallLogsSortDirection = "asc" | "desc";

export const USAGE_CALL_LOG_MESSAGES = {
  avgTtft: msg("Avg TTFT"),
  avgSpeed: msg("Avg speed"),
  cacheHitRate: msg("Cache hit rate"),
  tabCallLogs: msg("Call Logs"),
  filterAllProviders: msg("All providers"),
  filterAllModels: msg("All models"),
  sortBy: msg("Sort by"),
  sortTime: msg("Time"),
  sortTtft: msg("TTFT"),
  sortTps: msg("Speed (TPS)"),
  sortCacheHit: msg("Cache hit"),
  colTime: msg("Time"),
  colModelProvider: msg("Model / Provider"),
  colTtft: msg("TTFT"),
  colTps: msg("Speed"),
  colTokens: msg("Input / Cache R / Cache W / Output"),
  colCacheHit: msg("Cache hit"),
  colDurationStatus: msg("Duration / Status"),
  statusCompleted: msg("Completed"),
  statusStreaming: msg("Streaming"),
  statusInterrupted: msg("Interrupted"),
  statusError: msg("Error"),
  sourceLive: msg("Live capture"),
  sourceBackend: msg("Local transcript"),
  detailCallId: msg("Call ID"),
  detailSource: msg("Source"),
  detailThreadId: msg("Thread ID"),
  detailInputTokens: msg("Uncached input"),
  detailCacheReadTokens: msg("Cache read"),
  detailCacheWriteTokens: msg("Cache write"),
  detailOutputTokens: msg("Output tokens"),
  detailTotalTokens: msg("Total tokens"),
  detailContextPercent: msg("Context usage"),
  emptyCallLogs: msg(
    "No model call logs in this window yet. Real TTFT, speed (TPS), and cache hit rate will be recorded locally during chat turns.",
  ),
  resetFilters: msg("Reset filters"),
} as const;

export interface FilterAndSortCallLogsOptions {
  readonly provider?: string | null | undefined;
  readonly model?: string | null | undefined;
  readonly sortField: CallLogsSortField;
  readonly sortDirection: CallLogsSortDirection;
}

/** Pure filter + sort helper for Usage Call Logs (null metrics always sort to the bottom). */
export function filterAndSortCallLogs(
  logs: readonly UsageCallLogRecord[],
  options: FilterAndSortCallLogsOptions,
): readonly UsageCallLogRecord[] {
  const providerFilter = options.provider && options.provider !== "all" ? options.provider : null;
  const modelFilter = options.model && options.model !== "all" ? options.model : null;

  const filtered = logs.filter((log) => {
    if (providerFilter && log.provider !== providerFilter) return false;
    if (modelFilter && log.model !== modelFilter) return false;
    return true;
  });

  const dir = options.sortDirection === "asc" ? 1 : -1;

  return filtered.toSorted((left, right) => {
    if (options.sortField === "timestamp") {
      return (left.timestamp - right.timestamp) * dir;
    }
    const leftVal = left[options.sortField];
    const rightVal = right[options.sortField];
    if (leftVal === null && rightVal === null) {
      return right.timestamp - left.timestamp;
    }
    if (leftVal === null) return 1;
    if (rightVal === null) return -1;
    if (leftVal === rightVal) {
      return right.timestamp - left.timestamp;
    }
    return (leftVal - rightVal) * dir;
  });
}

function resolveProviderDisplay(provider: string): {
  readonly label: string;
  readonly driverKind: (typeof PROVIDER_PRESENTATION)[UsageProviderKind]["driverKind"] | null;
} {
  if (provider in PROVIDER_PRESENTATION) {
    const info = PROVIDER_PRESENTATION[provider as UsageProviderKind];
    return { label: info.label, driverKind: info.driverKind };
  }
  return { label: provider, driverKind: null };
}

function formatCallTime(
  timestamp: number,
  timeZone: string,
  hour12: boolean,
  locale: string,
): string {
  try {
    return formatDateTimeShort(new Date(timestamp).toISOString(), timeZone, hour12, locale);
  } catch {
    return new Date(timestamp).toLocaleString(locale);
  }
}

export interface UsageCallLogsSectionProps {
  readonly logs: readonly UsageCallLogRecord[];
  readonly timeZone: string;
  readonly hour12: boolean;
}

export function UsageCallLogsSection({
  logs,
  timeZone,
  hour12,
}: UsageCallLogsSectionProps) {
  const m = useMessages();
  const locale = useLocale();
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<CallLogsSortField>("timestamp");
  const [sortDirection, setSortDirection] = useState<CallLogsSortDirection>("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const availableProviders = useMemo(() => {
    const set = new Set<string>();
    for (const log of logs) set.add(log.provider);
    return Array.from(set).toSorted();
  }, [logs]);

  const availableModels = useMemo(() => {
    const set = new Set<string>();
    for (const log of logs) {
      if (providerFilter !== "all" && log.provider !== providerFilter) continue;
      set.add(log.model);
    }
    return Array.from(set).toSorted();
  }, [logs, providerFilter]);

  const visibleLogs = useMemo(
    () =>
      filterAndSortCallLogs(logs, {
        provider: providerFilter,
        model: modelFilter,
        sortField,
        sortDirection,
      }),
    [logs, modelFilter, providerFilter, sortDirection, sortField],
  );

  const hasActiveFilter = providerFilter !== "all" || modelFilter !== "all";

  const statusLabel = (status: UsageCallStatus): string => {
    switch (status) {
      case "streaming":
        return m(USAGE_CALL_LOG_MESSAGES.statusStreaming);
      case "interrupted":
        return m(USAGE_CALL_LOG_MESSAGES.statusInterrupted);
      case "error":
        return m(USAGE_CALL_LOG_MESSAGES.statusError);
      default:
        return m(USAGE_CALL_LOG_MESSAGES.statusCompleted);
    }
  };

  const statusBadgeClass = (status: UsageCallStatus): string => {
    switch (status) {
      case "error":
        return "bg-destructive/15 text-destructive border-destructive/30";
      case "interrupted":
        return "bg-warning/15 text-warning-foreground border-warning/30";
      case "streaming":
        return "bg-primary/15 text-primary border-primary/30";
      default:
        return "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/25";
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="usage-call-logs-section">
      {/* Filter & Sort toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={m(USAGE_CALL_LOG_MESSAGES.filterAllProviders)}
            value={providerFilter}
            onChange={(event) => {
              setProviderFilter(event.target.value);
              setModelFilter("all");
            }}
            className="h-7 rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">{m(USAGE_CALL_LOG_MESSAGES.filterAllProviders)}</option>
            {availableProviders.map((provider) => (
              <option key={provider} value={provider}>
                {resolveProviderDisplay(provider).label}
              </option>
            ))}
          </select>

          <select
            aria-label={m(USAGE_CALL_LOG_MESSAGES.filterAllModels)}
            value={modelFilter}
            onChange={(event) => setModelFilter(event.target.value)}
            className="h-7 max-w-52 rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">{m(USAGE_CALL_LOG_MESSAGES.filterAllModels)}</option>
            {availableModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>

          {hasActiveFilter ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setProviderFilter("all");
                setModelFilter("all");
              }}
            >
              {m(USAGE_CALL_LOG_MESSAGES.resetFilters)}
            </Button>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{m(USAGE_CALL_LOG_MESSAGES.sortBy)}:</span>
          <select
            aria-label={m(USAGE_CALL_LOG_MESSAGES.sortBy)}
            value={sortField}
            onChange={(event) => setSortField(event.target.value as CallLogsSortField)}
            className="h-7 rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="timestamp">{m(USAGE_CALL_LOG_MESSAGES.sortTime)}</option>
            <option value="ttftMs">{m(USAGE_CALL_LOG_MESSAGES.sortTtft)}</option>
            <option value="tps">{m(USAGE_CALL_LOG_MESSAGES.sortTps)}</option>
            <option value="cacheHitRate">{m(USAGE_CALL_LOG_MESSAGES.sortCacheHit)}</option>
          </select>
          <Button
            size="icon-xs"
            variant="outline"
            aria-label={sortDirection === "desc" ? "Descending" : "Ascending"}
            onClick={() => setSortDirection((prev) => (prev === "desc" ? "asc" : "desc"))}
          >
            {sortDirection === "desc" ? (
              <ArrowDownIcon className="size-3.5" aria-hidden />
            ) : (
              <ArrowUpIcon className="size-3.5" aria-hidden />
            )}
          </Button>
        </div>
      </div>

      {/* Responsive Call Logs table */}
      <div
        className="overflow-x-auto rounded-lg border border-border/70 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        role="region"
        aria-label={m(USAGE_CALL_LOG_MESSAGES.tabCallLogs)}
        tabIndex={0}
      >
        <table className="w-full text-xs whitespace-nowrap">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-right text-muted-foreground">
              <th className="py-2 pr-2 pl-2.5 text-left font-medium">
                {m(USAGE_CALL_LOG_MESSAGES.colTime)}
              </th>
              <th className="py-2 px-3 text-left font-medium">
                {m(USAGE_CALL_LOG_MESSAGES.colModelProvider)}
              </th>
              <th className="py-2 px-3 font-medium">{m(USAGE_CALL_LOG_MESSAGES.colTtft)}</th>
              <th className="py-2 px-3 font-medium">{m(USAGE_CALL_LOG_MESSAGES.colTps)}</th>
              <th className="hidden py-2 px-3 font-medium md:table-cell">
                {m(USAGE_CALL_LOG_MESSAGES.colTokens)}
              </th>
              <th className="py-2 px-3 font-medium">{m(USAGE_CALL_LOG_MESSAGES.colCacheHit)}</th>
              <th className="py-2 pr-3 pl-3 font-medium">
                {m(USAGE_CALL_LOG_MESSAGES.colDurationStatus)}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50 tabular-nums">
            {visibleLogs.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center whitespace-normal text-muted-foreground"
                >
                  {m(USAGE_CALL_LOG_MESSAGES.emptyCallLogs)}
                </td>
              </tr>
            ) : (
              visibleLogs.map((log) => {
                const isExpanded = expandedId === log.id;
                const providerInfo = resolveProviderDisplay(log.provider);
                return (
                  <Fragment key={log.id}>
                    <tr
                      className={cn(
                        "cursor-pointer text-right transition-colors hover:bg-muted/40",
                        isExpanded && "bg-muted/35",
                      )}
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    >
                      <td className="py-2 pr-2 pl-2.5 text-left text-muted-foreground">
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpandedId(isExpanded ? null : log.id);
                          }}
                          className="inline-flex items-center gap-1.5 text-left text-muted-foreground outline-none focus-visible:underline"
                        >
                          {isExpanded ? (
                            <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden />
                          ) : (
                            <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />
                          )}
                          <span>{formatCallTime(log.timestamp, timeZone, hour12, locale)}</span>
                        </button>
                      </td>
                      <td className="py-2 px-3 text-left">
                        <div className="flex items-center gap-2">
                          {providerInfo.driverKind ? (
                            <ProviderInstanceIcon
                              driverKind={providerInfo.driverKind}
                              displayName={providerInfo.label}
                              iconClassName="size-3.5 shrink-0"
                            />
                          ) : null}
                          <span className="max-w-44 truncate font-medium text-foreground" title={log.model}>
                            {log.model}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {providerInfo.label}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-foreground">{formatTtft(log.ttftMs)}</td>
                      <td className="py-2 px-3 text-foreground">{formatTps(log.tps)}</td>
                      <td className="hidden py-2 px-3 text-muted-foreground md:table-cell">
                        <span>{formatTokens(log.inputTokens)}</span>
                        <span className="mx-1 opacity-45">/</span>
                        <span className="text-foreground">{formatTokens(log.cachedInputTokens)}</span>
                        <span className="mx-1 opacity-45">/</span>
                        <span>{formatTokens(log.cacheCreationTokens)}</span>
                        <span className="mx-1 opacity-45">/</span>
                        <span className="text-foreground">{formatTokens(log.outputTokens)}</span>
                      </td>
                      <td className="py-2 px-3 text-foreground">
                        {formatCacheHitRate(log.cacheHitRate)}
                      </td>
                      <td className="py-2 pr-3 pl-3">
                        <div className="inline-flex items-center justify-end gap-2">
                          <span className="text-muted-foreground">
                            {formatDurationMs(log.durationMs)}
                          </span>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none",
                              statusBadgeClass(log.status),
                            )}
                          >
                            {statusLabel(log.status)}
                          </span>
                        </div>
                      </td>
                    </tr>

                    {isExpanded ? (
                      <tr className="bg-muted/20 text-left">
                        <td colSpan={7} className="px-4 py-3 whitespace-normal">
                          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] sm:grid-cols-4">
                            <div>
                              <dt className="text-muted-foreground">
                                {m(USAGE_CALL_LOG_MESSAGES.detailCallId)}
                              </dt>
                              <dd className="truncate font-mono text-foreground" title={log.id}>
                                {log.id}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">
                                {m(USAGE_CALL_LOG_MESSAGES.detailSource)}
                              </dt>
                              <dd className="text-foreground">
                                {log.source === "live"
                                  ? m(USAGE_CALL_LOG_MESSAGES.sourceLive)
                                  : m(USAGE_CALL_LOG_MESSAGES.sourceBackend)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">
                                {m(USAGE_CALL_LOG_MESSAGES.detailThreadId)}
                              </dt>
                              <dd className="truncate font-mono text-foreground">
                                {log.threadId ?? "—"}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">
                                {m(USAGE_CALL_LOG_MESSAGES.detailContextPercent)}
                              </dt>
                              <dd className="text-foreground">
                                {typeof log.contextPercent === "number"
                                  ? `${log.contextPercent.toFixed(1)}%`
                                  : "—"}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">
                                {m(USAGE_CALL_LOG_MESSAGES.detailInputTokens)}
                              </dt>
                              <dd className="text-foreground">
                                {log.inputTokens.toLocaleString(locale)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">
                                {m(USAGE_CALL_LOG_MESSAGES.detailCacheReadTokens)}
                              </dt>
                              <dd className="text-foreground">
                                {log.cachedInputTokens.toLocaleString(locale)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">
                                {m(USAGE_CALL_LOG_MESSAGES.detailCacheWriteTokens)}
                              </dt>
                              <dd className="text-foreground">
                                {log.cacheCreationTokens.toLocaleString(locale)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">
                                {m(USAGE_CALL_LOG_MESSAGES.detailOutputTokens)} /{" "}
                                {m(USAGE_CALL_LOG_MESSAGES.detailTotalTokens)}
                              </dt>
                              <dd className="text-foreground">
                                {log.outputTokens.toLocaleString(locale)} /{" "}
                                {log.totalTokens.toLocaleString(locale)}
                              </dd>
                            </div>
                          </dl>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
