import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { CheckIcon, SearchIcon, XIcon } from "lucide-react";
import { memo, useMemo, type RefObject } from "react";

import { cn } from "~/lib/utils";
import { AgentBrandLogo, formatAgentBrandName } from "../../../prismux/agentBrand";
import { resolveAgentRuntimeLamp } from "../sidebarMicroIndicators";
import { Button } from "../../ui/button";
import { SidebarInput } from "../../ui/sidebar";
import {
  filterOrcaActivityItems,
  groupOrcaActivityItems,
  type OrcaActivityItem,
  type OrcaActivityStatusBucket,
  type OrcaProjectsPrefs,
} from "./orcaProjects.logic";
import { useOrcaProjectsCopy } from "./orcaProjectsCopy";

export interface OrcaActivityViewProps {
  readonly items: readonly OrcaActivityItem[];
  readonly prefs: OrcaProjectsPrefs;
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly searchInputRef?: RefObject<HTMLInputElement | null>;
  readonly activeThreadKey: string | null;
  readonly onSelectThread: (threadRef: ScopedThreadRef) => void;
  readonly onMarkItemRead: (item: OrcaActivityItem) => void;
  readonly onResetFilters: () => void;
}

const BUCKET_DOT_CLASS: Record<OrcaActivityStatusBucket, string> = {
  attention: "bg-amber-500",
  working: "bg-sky-500 animate-pulse motion-reduce:animate-none",
  unread: "bg-primary",
  failed: "bg-rose-500",
  completed: "bg-emerald-500/80",
};

function formatCompactAge(timestampMs: number, isZh: boolean): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "";
  const deltaSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (deltaSec < 60) return isZh ? "刚刚" : "now";
  const mins = Math.floor(deltaSec / 60);
  if (mins < 60) return isZh ? `${mins} 分钟前` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return isZh ? `${hours} 小时前` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return isZh ? `${days} 天前` : `${days}d`;
}

/**
 * 1:1 Orca inline Agent Activity view (Figure 5), modeled after
 * `stablyai/orca` `SidebarAgentsList.tsx` & `activity-thread-list-pane.tsx`.
 */
export const OrcaActivityView = memo(function OrcaActivityView({
  items,
  prefs,
  query,
  onQueryChange,
  searchInputRef,
  activeThreadKey,
  onSelectThread,
  onMarkItemRead,
  onResetFilters,
}: OrcaActivityViewProps) {
  const copy = useOrcaProjectsCopy();

  const filteredItems = useMemo(
    () => filterOrcaActivityItems(items, prefs, query),
    [items, prefs, query],
  );

  const groups = useMemo(
    () =>
      groupOrcaActivityItems(filteredItems, prefs.groupBy, {
        statusLabels: copy.statusBucketLabels,
        noProjectLabel: copy.noProjectOption,
        recentLabel: copy.recentActivityHeading,
      }),
    [copy.noProjectOption, copy.recentActivityHeading, copy.statusBucketLabels, filteredItems, prefs.groupBy],
  );

  const hasActiveFilterOrQuery =
    prefs.unreadOnly ||
    prefs.hideAutomationCreated ||
    prefs.hideCliCreated ||
    query.trim().length > 0;

  return (
    <div
      data-testid="orca-activity-view"
      data-compact={prefs.compactMode ? "true" : "false"}
      className="flex min-h-0 flex-1 flex-col gap-2"
    >
      {prefs.showSearch ? (
        <div
          data-testid="orca-activity-search-bar"
          className="flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-sidebar-border/65 bg-sidebar-foreground/[0.045] px-2 text-xs text-sidebar-muted-foreground transition-colors focus-within:border-ring/65 focus-within:bg-sidebar-row-hover focus-within:text-sidebar-foreground"
        >
          <SearchIcon aria-hidden className="size-3.5 shrink-0 opacity-75" />
          <SidebarInput
            ref={searchInputRef}
            nativeInput
            type="search"
            data-testid="orca-activity-search-input"
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                onQueryChange("");
              }
            }}
            placeholder={copy.activityFilterPlaceholder}
            aria-label={copy.activitySearchAriaLabel}
            className="min-w-0 flex-1 text-xs [&_[data-slot=input]]:text-xs"
          />
          {query.length > 0 ? (
            <Button
              type="button"
              size="icon-micro"
              variant="ghost-muted"
              className="shrink-0"
              aria-label={copy.clearSearch}
              onClick={() => onQueryChange("")}
            >
              <XIcon className="size-3" />
            </Button>
          ) : null}
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div
          data-testid="orca-activity-empty"
          role="status"
          className="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-10 text-center"
        >
          <p className="text-xs leading-relaxed text-sidebar-muted-foreground">
            {copy.noActivityMatches}
          </p>
          {hasActiveFilterOrQuery ? (
            <button
              type="button"
              data-testid="orca-activity-reset-filters"
              onClick={onResetFilters}
              className="inline-flex cursor-pointer items-center rounded-md border border-sidebar-border/70 px-2.5 py-1 text-[11px] font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {copy.resetFilters}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5" data-testid="orca-activity-groups">
          {groups.map((group) => (
            <section
              key={group.key}
              data-testid={`orca-activity-group-${group.key}`}
              className="flex flex-col gap-0.5"
            >
              <div className="flex items-center gap-1.5 px-1.5 py-0.5 text-[11px] font-semibold text-sidebar-muted-foreground/85 select-none">
                {group.bucket ? (
                  <span
                    aria-hidden
                    className={cn("size-1.5 shrink-0 rounded-full", BUCKET_DOT_CLASS[group.bucket])}
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                <span className="shrink-0 text-[10px] font-medium opacity-75 tabular-nums">
                  {group.items.length}
                </span>
              </div>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive = activeThreadKey === item.key;
                  const lamp = resolveAgentRuntimeLamp(item.rowStatus);
                  const brandName = formatAgentBrandName(item.providerId, item.providerLabel);
                  const ageLabel = formatCompactAge(item.activityTimestampMs, copy.isZh);
                  return (
                    <li key={item.key} className="group/activity-row relative list-none">
                      <button
                        type="button"
                        data-testid={`orca-activity-row-${item.thread.id}`}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => {
                          onSelectThread(scopeThreadRef(item.thread.environmentId, item.thread.id));
                        }}
                        className={cn(
                          "flex w-full cursor-pointer items-start gap-2 rounded-md px-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          prefs.compactMode ? "py-1" : "py-1.5",
                          isActive
                            ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
                            : "text-sidebar-foreground/90 hover:bg-sidebar-row-hover",
                        )}
                      >
                        <span className="mt-1 flex shrink-0 items-center justify-center">
                          <span
                            aria-hidden
                            className={cn(
                              "size-1.5 rounded-full",
                              lamp.state !== "idle"
                                ? lamp.dotClassName
                                : BUCKET_DOT_CLASS[item.bucket],
                            )}
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "min-w-0 flex-1 truncate text-xs leading-tight",
                                item.isUnread ? "font-semibold text-sidebar-foreground" : "font-medium",
                              )}
                            >
                              {item.thread.title}
                            </span>
                            {ageLabel ? (
                              <span className="shrink-0 text-[10px] text-sidebar-muted-foreground/80 tabular-nums group-hover/activity-row:opacity-0">
                                {ageLabel}
                              </span>
                            ) : null}
                          </span>
                          {!prefs.compactMode ? (
                            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-sidebar-muted-foreground">
                              <AgentBrandLogo
                                provider={item.providerId}
                                online={item.bucket === "working" || item.bucket === "attention"}
                                size={12}
                              />
                              <span className="truncate">{item.projectName || copy.noProjectOption}</span>
                              <span aria-hidden className="opacity-50">
                                ·
                              </span>
                              <span className="truncate opacity-85">{brandName}</span>
                            </span>
                          ) : null}
                        </span>
                      </button>
                      {item.isUnread ? (
                        <button
                          type="button"
                          title={copy.markReadAction}
                          aria-label={copy.markReadAction}
                          onClick={(event) => {
                            event.stopPropagation();
                            onMarkItemRead(item);
                          }}
                          className="absolute top-1.5 right-1.5 flex size-5 cursor-pointer items-center justify-center rounded-sm bg-sidebar/90 text-sidebar-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-row-active hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/activity-row:opacity-100"
                        >
                          <CheckIcon aria-hidden className="size-3" />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
});
