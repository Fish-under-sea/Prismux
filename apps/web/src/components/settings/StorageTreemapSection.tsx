import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DatabaseIcon,
  FolderOpenIcon,
  HardDriveIcon,
  LayersIcon,
  LockIcon,
  ShieldCheckIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { msg, T, useGT, useMessages } from "gt-react";
import { useEffect, useRef, useState } from "react";

import { RefreshIcon } from "~/components/ui/refresh-icon";
import { formatBytes } from "../../lib/formatBytes";
import { observeResize } from "../../lib/observeResize";
import { cn } from "../../lib/utils";
import {
  prismuxDaemonClient,
  type DaemonStorageCleanResponse,
  type DaemonStorageInventoryResponse,
  type DaemonStorageNodeDto,
  type DaemonStorageSafetyTier,
} from "../../prismux/daemonClient";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsSection } from "./settingsLayout";
import {
  buildCompactDatabaseCleanRequest,
  buildDisposableCleanRequest,
  buildManagedCleanRequest,
  computeSquarifiedTreemap,
  DEFAULT_STORAGE_WARNING_THRESHOLD_BYTES,
  resolveStorageDrillLevel,
  resolveStorageFootprintTone,
  summarizeStorageTiers,
  type TreemapBounds,
} from "./StorageTreemapSection.logic";

const TIER_META: Record<
  DaemonStorageSafetyTier,
  {
    readonly tileClass: string;
    readonly dotClass: string;
    readonly badgeClass: string;
    readonly barClass: string;
    readonly label: string;
    readonly shortLabel: string;
  }
> = {
  disposable: {
    tileClass:
      "border-success/45 bg-success/15 text-foreground hover:border-success/75 hover:bg-success/25 dark:bg-success/20 dark:hover:bg-success/30",
    dotClass: "bg-success",
    badgeClass: "border-success/30 bg-success/12 text-success-foreground",
    barClass: "bg-success/80",
    label: msg("Regenerable cache & old logs"),
    shortLabel: msg("Disposable"),
  },
  managed: {
    tileClass:
      "border-warning/45 bg-warning/15 text-foreground hover:border-warning/75 hover:bg-warning/25 dark:bg-warning/20 dark:hover:bg-warning/30",
    dotClass: "bg-warning",
    badgeClass: "border-warning/35 bg-warning/12 text-warning-foreground",
    barClass: "bg-warning/80",
    label: msg("Managed heavy assets"),
    shortLabel: msg("Managed"),
  },
  protected: {
    tileClass:
      "border-info/45 bg-info/15 text-foreground hover:border-info/75 hover:bg-info/25 dark:bg-info/20 dark:hover:bg-info/30",
    dotClass: "bg-info",
    badgeClass: "border-info/35 bg-info/12 text-info-foreground",
    barClass: "bg-info/80",
    label: msg("Protected databases & credentials"),
    shortLabel: msg("Protected"),
  },
};

export interface StorageTreemapSectionProps {
  readonly id?: string | undefined;
  readonly inventory?: DaemonStorageInventoryResponse | null | undefined;
  readonly loading?: boolean | undefined;
  readonly error?: string | null | undefined;
  readonly onRefresh?: (() => Promise<void> | void) | undefined;
  readonly onInventoryChange?: ((next: DaemonStorageInventoryResponse) => void) | undefined;
}

export function StorageTreemapSection({
  id = "storage-treemap",
  inventory: controlledInventory,
  loading: controlledLoading,
  error: controlledError,
  onRefresh: controlledRefresh,
  onInventoryChange,
}: StorageTreemapSectionProps) {
  const gt = useGT();
  const messages = useMessages();
  const isControlled = controlledInventory !== undefined || controlledRefresh !== undefined;

  const [internalInventory, setInternalInventory] = useState<DaemonStorageInventoryResponse | null>(
    null,
  );
  const [internalLoading, setInternalLoading] = useState<boolean>(!isControlled);
  const [internalError, setInternalError] = useState<string | null>(null);

  const inventory = isControlled ? (controlledInventory ?? null) : internalInventory;
  const loading = isControlled ? Boolean(controlledLoading) : internalLoading;
  const error = isControlled ? (controlledError ?? null) : internalError;

  const [drillPathIds, setDrillPathIds] = useState<readonly string[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [cleaningMode, setCleaningMode] = useState<"disposable" | "managed" | "compact" | null>(
    null,
  );
  const [managedConfirmOpen, setManagedConfirmOpen] = useState(false);
  const [selectedManagedIds, setSelectedManagedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [lastCleanSummary, setLastCleanSummary] = useState<{
    readonly freedBytes: number;
    readonly removedCount: number;
    readonly errors: readonly string[];
  } | null>(null);

  const treemapHostRef = useRef<HTMLDivElement | null>(null);
  const [treemapBounds, setTreemapBounds] = useState<TreemapBounds>({ width: 1000, height: 320 });

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- loads initial local storage inventory from daemon when component runs standalone
  useEffect(() => {
    if (isControlled) return;
    let cancelled = false;
    void prismuxDaemonClient
      .getStorageInventory(false)
      .then((data) => {
        if (cancelled) return;
        setInternalInventory(data);
        setInternalError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setInternalError(
          cause instanceof Error ? cause.message : gt("Unable to scan local storage."),
        );
      })
      .finally(() => {
        if (!cancelled) setInternalLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gt, isControlled]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- observes treemap container dimensions via observeResize so Squarified Treemap aspect ratios match actual viewport width
  useEffect(() => {
    const element = treemapHostRef.current;
    if (!element) return;
    return observeResize(element, (entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 120 || rect.height < 80) return;
      const nextWidth = Math.round(rect.width);
      const nextHeight = Math.round(rect.height);
      setTreemapBounds((prev) =>
        Math.abs(prev.width - nextWidth) < 8 && Math.abs(prev.height - nextHeight) < 8
          ? prev
          : { width: nextWidth, height: nextHeight },
      );
    });
  }, []);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- handles Escape key dismissal for 2-step destructive managed-asset confirmation panel
  useEffect(() => {
    if (!managedConfirmOpen || typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setManagedConfirmOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [managedConfirmOpen]);

  const handleRefresh = async () => {
    if (controlledRefresh) {
      await controlledRefresh();
      return;
    }
    setInternalLoading(true);
    try {
      const data = await prismuxDaemonClient.getStorageInventory(true);
      setInternalInventory(data);
      setInternalError(null);
    } catch (cause: unknown) {
      setInternalError(
        cause instanceof Error ? cause.message : gt("Unable to scan local storage."),
      );
    } finally {
      setInternalLoading(false);
    }
  };

  const applyInventoryUpdate = (next: DaemonStorageInventoryResponse) => {
    if (isControlled) {
      onInventoryChange?.(next);
    } else {
      setInternalInventory(next);
      setInternalError(null);
    }
  };

  const runCleanAction = async (
    mode: "disposable" | "managed" | "compact",
    execute: () => Promise<DaemonStorageCleanResponse>,
  ) => {
    if (cleaningMode !== null) return;
    setCleaningMode(mode);
    setLastCleanSummary(null);
    try {
      const result = await execute();
      if (result.inventory) {
        applyInventoryUpdate(result.inventory);
      } else {
        await handleRefresh();
      }
      setLastCleanSummary({
        freedBytes: result.freedBytes,
        removedCount: result.removedCount,
        errors: result.errors,
      });
      if (mode === "managed") {
        setManagedConfirmOpen(false);
        setSelectedManagedIds(new Set());
      }
      toastManager.add({
        type: result.errors.length > 0 ? "warning" : "success",
        title:
          mode === "compact"
            ? gt("Database compaction complete")
            : gt("Storage cleanup complete"),
        description: gt("Freed {bytes} across {count} items.", {
          bytes: formatBytes(result.freedBytes),
          count: result.removedCount,
        }),
      });
    } catch (cause: unknown) {
      toastManager.add({
        type: "error",
        title: gt("Storage cleanup failed"),
        description:
          cause instanceof Error ? cause.message : gt("Could not clean local storage items."),
      });
    } finally {
      setCleaningMode(null);
    }
  };

  const categories = inventory?.categories ?? [];
  const drillLevel = resolveStorageDrillLevel(categories, drillPathIds);
  const treemapRects = computeSquarifiedTreemap(drillLevel.nodes, treemapBounds);
  const tierStats = summarizeStorageTiers(categories);

  const inspectedNode: DaemonStorageNodeDto | null =
    drillLevel.nodes.find((node) => node.id === hoveredNodeId) ??
    drillLevel.nodes.find((node) => node.id === selectedNodeId) ??
    drillLevel.nodes[0] ??
    null;

  const warningThreshold =
    inventory?.warningThresholdBytes && inventory.warningThresholdBytes > 0
      ? inventory.warningThresholdBytes
      : DEFAULT_STORAGE_WARNING_THRESHOLD_BYTES;
  const totalBytes = inventory?.totalBytes ?? 0;
  const quotaRatioPercent = Math.min(100, Math.round((totalBytes / warningThreshold) * 100));
  const footprintTone = resolveStorageFootprintTone(totalBytes, warningThreshold);

  const disposableRequest = buildDisposableCleanRequest(categories);
  const cleanableManagedCategories = categories.filter(
    (category) => category.tier === "managed" && category.cleanable && category.bytes > 0,
  );
  const managedRequest = buildManagedCleanRequest(categories, selectedManagedIds);

  const openManagedConfirm = () => {
    if (cleanableManagedCategories.length === 0) return;
    setSelectedManagedIds(new Set(cleanableManagedCategories.map((entry) => entry.id)));
    setManagedConfirmOpen(true);
  };

  const toggleManagedSelection = (categoryId: string) => {
    setSelectedManagedIds((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  return (
    <SettingsSection
      id={id}
      title={gt("Local storage & directory footprint")}
      description={gt(
        "Proportional disk map across Prismux data, cache, worktrees, and assets. Click any container block to drill down.",
      )}
      icon={<HardDriveIcon className="size-4 text-muted-foreground" />}
      headerAction={
        <div className="flex items-center gap-2">
          {inventory ? (
            <span className="font-mono text-2xs tabular-nums text-muted-foreground">
              {gt("{bytes} total · {ms} ms", {
                bytes: formatBytes(inventory.totalBytes),
                ms: Math.round(inventory.durationMs),
              })}
            </span>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-micro"
                  variant="ghost"
                  disabled={loading || cleaningMode !== null}
                  onClick={() => void handleRefresh()}
                  aria-label={gt("Rescan local storage")}
                >
                  <RefreshIcon size="xs" refreshing={loading} />
                </Button>
              }
            />
            <TooltipPopup side="top">
              <T>Rescan local storage</T>
            </TooltipPopup>
          </Tooltip>
        </div>
      }
    >
      <div className="overflow-hidden rounded-[inherit]">
        {/* Top legend + breadcrumb bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/15 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => {
                setDrillPathIds([]);
                setHoveredNodeId(null);
                setSelectedNodeId(null);
              }}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
                drillLevel.breadcrumbs.length === 0
                  ? "bg-muted/80 text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <LayersIcon className="size-3.5 shrink-0" />
              <span>
                <T>All local storage</T>
              </span>
            </button>
            {drillLevel.breadcrumbs.map((crumb, index) => (
              <span key={crumb.id} className="inline-flex items-center gap-1">
                <ChevronRightIcon className="size-3 text-muted-foreground/60" aria-hidden />
                <button
                  type="button"
                  onClick={() => {
                    setDrillPathIds(drillLevel.breadcrumbs.slice(0, index + 1).map((c) => c.id));
                    setHoveredNodeId(null);
                    setSelectedNodeId(null);
                  }}
                  className={cn(
                    "cursor-pointer rounded-md px-2 py-1 font-medium transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
                    index === drillLevel.breadcrumbs.length - 1
                      ? "bg-muted/80 text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
            {drillLevel.breadcrumbs.length > 0 ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  setDrillPathIds((prev) => prev.slice(0, -1));
                  setHoveredNodeId(null);
                  setSelectedNodeId(null);
                }}
              >
                <ChevronLeftIcon className="size-3.5" />
                <T>Up one level</T>
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-3xs text-muted-foreground">
            {(["disposable", "managed", "protected"] as const).map((tier) => (
              <span key={tier} className="inline-flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", TIER_META[tier].dotClass)} />
                <span>{messages(TIER_META[tier].label)}</span>
                <span className="font-mono tabular-nums text-foreground/85">
                  {formatBytes(tierStats[tier].bytes)}
                </span>
              </span>
            ))}
          </div>
        </div>

        {error ? (
          <div className="flex items-start gap-2 border-b border-destructive/25 bg-destructive/5 px-4 py-3 text-xs text-destructive sm:px-5">
            <AlertTriangleIcon className="size-3.5 h-lh shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {lastCleanSummary ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-success/25 bg-success/10 px-4 py-2.5 text-xs text-success-foreground sm:px-5">
            <span className="inline-flex items-center gap-2">
              <CheckCircle2Icon className="size-3.5 shrink-0" />
              {gt("Reclaimed {bytes} ({count} items removed).", {
                bytes: formatBytes(lastCleanSummary.freedBytes),
                count: lastCleanSummary.removedCount,
              })}
            </span>
            <Button
              type="button"
              size="icon-micro"
              variant="ghost"
              aria-label={gt("Dismiss cleanup notice")}
              onClick={() => setLastCleanSummary(null)}
            >
              <XIcon className="size-3" />
            </Button>
          </div>
        ) : null}

        {/* WizTree Squarified Treemap Canvas */}
        <div className="px-4 py-4 sm:px-5">
          <div
            ref={treemapHostRef}
            data-testid="storage-treemap-canvas"
            className="relative h-72 w-full overflow-hidden rounded-xl border border-border/65 bg-muted/20"
          >
            {loading && !inventory ? (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                <T>Scanning local Prismux storage directories…</T>
              </div>
            ) : treemapRects.length === 0 ? (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                <T>No occupied local storage blocks detected.</T>
              </div>
            ) : (
              treemapRects.map((rect) => {
                const node = rect.item;
                const tierStyle = TIER_META[node.tier];
                const hasChildren = Boolean(node.children && node.children.length > 0);
                const showTitle = rect.widthPercent >= 7 && rect.heightPercent >= 12;
                const showMetrics = rect.widthPercent >= 10 && rect.heightPercent >= 18;
                const isSelected = selectedNodeId === node.id;

                return (
                  <Tooltip key={node.id}>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          data-testid={`treemap-block-${node.id}`}
                          data-tier={node.tier}
                          aria-label={gt("{name}: {bytes} ({percent}%)", {
                            name: node.name,
                            bytes: formatBytes(node.bytes),
                            percent: rect.sharePercent.toFixed(1),
                          })}
                          onMouseEnter={() => setHoveredNodeId(node.id)}
                          onMouseLeave={() =>
                            setHoveredNodeId((prev) => (prev === node.id ? null : prev))
                          }
                          onFocus={() => setHoveredNodeId(node.id)}
                          onClick={() => {
                            if (hasChildren) {
                              setDrillPathIds((prev) => [...prev, node.id]);
                              setHoveredNodeId(null);
                              setSelectedNodeId(null);
                            } else {
                              setSelectedNodeId(node.id);
                            }
                          }}
                          style={{
                            left: `${rect.xPercent}%`,
                            top: `${rect.yPercent}%`,
                            width: `${rect.widthPercent}%`,
                            height: `${rect.heightPercent}%`,
                          }}
                          className={cn(
                            "absolute flex cursor-pointer flex-col justify-between overflow-hidden border p-2 text-left transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
                            tierStyle.tileClass,
                            isSelected && "ring-2 ring-inset ring-ring",
                          )}
                        >
                          {showTitle ? (
                            <div className="flex min-w-0 items-center gap-1">
                              {node.tier === "protected" ? (
                                <LockIcon
                                  className="size-3 shrink-0 text-info-foreground"
                                  aria-hidden
                                />
                              ) : null}
                              <span className="min-w-0 truncate text-xs font-semibold leading-tight">
                                {node.name}
                              </span>
                            </div>
                          ) : null}
                          {showMetrics ? (
                            <div className="flex items-baseline justify-between gap-2 font-mono text-2xs tabular-nums text-foreground/85">
                              <span className="truncate font-medium">
                                {formatBytes(node.bytes)}
                              </span>
                              <span className="shrink-0 text-3xs text-muted-foreground">
                                {rect.sharePercent.toFixed(1)}%
                              </span>
                            </div>
                          ) : null}
                        </button>
                      }
                    />
                    <TooltipPopup side="top" className="max-w-sm text-left">
                      <div className="space-y-1 text-2xs">
                        <div className="flex items-center justify-between gap-3 font-semibold text-foreground">
                          <span className="truncate">{node.name}</span>
                          <span className="font-mono tabular-nums">
                            {formatBytes(node.bytes)} ({rect.sharePercent.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <span>{messages(tierStyle.shortLabel)}</span>
                          <span>·</span>
                          <span className="font-mono tabular-nums">
                            {gt("{count} files", { count: node.fileCount })}
                          </span>
                          {hasChildren ? (
                            <>
                              <span>·</span>
                              <span>
                                <T>Click to drill down</T>
                              </span>
                            </>
                          ) : null}
                        </div>
                        <div className="break-all font-mono text-3xs text-muted-foreground/85">
                          {node.path}
                        </div>
                      </div>
                    </TooltipPopup>
                  </Tooltip>
                );
              })
            )}
          </div>

          {/* Live inspector bar for hovered/focused/selected treemap block */}
          {inspectedNode ? (
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/55 bg-muted/15 px-3 py-2 text-2xs">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    TIER_META[inspectedNode.tier].dotClass,
                  )}
                />
                <span className="truncate font-medium text-foreground">{inspectedNode.name}</span>
                <span className="hidden truncate font-mono text-3xs text-muted-foreground md:inline">
                  {inspectedNode.path}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3 font-mono tabular-nums text-foreground/90">
                <span>{formatBytes(inspectedNode.bytes)}</span>
                <span className="text-muted-foreground">
                  {drillLevel.totalBytes > 0
                    ? `${((inspectedNode.bytes / drillLevel.totalBytes) * 100).toFixed(1)}%`
                    : "0.0%"}
                </span>
                <span className="text-muted-foreground">
                  {gt("{count} files", { count: inspectedNode.fileCount })}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* C-Drive Auto Quota Guard Bar + Safe Cleanup Actions */}
        <div className="border-t border-border/60 bg-muted/10 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <ShieldCheckIcon className="size-3.5 text-muted-foreground" />
                  <T>Auto storage quota guard</T>
                </span>
                <span
                  className={cn(
                    "font-mono text-2xs tabular-nums",
                    footprintTone === "danger"
                      ? "text-destructive"
                      : footprintTone === "warning"
                        ? "text-warning-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {gt("{used} / {limit} alert threshold ({percent}%)", {
                    used: formatBytes(totalBytes),
                    limit: formatBytes(warningThreshold),
                    percent: quotaRatioPercent,
                  })}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted/70">
                <div
                  className={cn(
                    "h-full rounded-full transition-all motion-reduce:transition-none",
                    footprintTone === "danger"
                      ? "bg-destructive"
                      : footprintTone === "warning"
                        ? "bg-warning"
                        : "bg-success/80",
                  )}
                  style={{ width: `${quotaRatioPercent}%` }}
                />
              </div>
              {inventory && inventory.policies.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {inventory.policies.map((policy) => (
                    <span
                      key={policy.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card/70 px-2 py-0.5 text-3xs text-muted-foreground"
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          policy.active ? "bg-success" : "bg-muted-foreground/45",
                        )}
                      />
                      <span className="text-foreground/90">{policy.label}</span>
                      <span className="font-mono tabular-nums">{policy.limitLabel}</span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!disposableRequest || cleaningMode !== null}
                        onClick={() => {
                          if (!disposableRequest) return;
                          void runCleanAction("disposable", () =>
                            prismuxDaemonClient.cleanStorage(disposableRequest),
                          );
                        }}
                      >
                        <Trash2Icon className="size-3.5" />
                        {cleaningMode === "disposable"
                          ? gt("Cleaning cache…")
                          : gt("Clean regenerable cache")}
                        {inventory && inventory.reclaimableDisposableBytes > 0 ? (
                          <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                            ({formatBytes(inventory.reclaimableDisposableBytes)})
                          </span>
                        ) : null}
                      </Button>
                    </span>
                  }
                />
                <TooltipPopup side="top">
                  {!disposableRequest
                    ? gt("No reclaimable cache or expired logs to clean right now.")
                    : gt(
                        "Safely removes regenerable browser caches, old logs, and stale installer archives.",
                      )}
                </TooltipPopup>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={cleanableManagedCategories.length === 0 || cleaningMode !== null}
                        onClick={() => {
                          if (managedConfirmOpen) {
                            setManagedConfirmOpen(false);
                          } else {
                            openManagedConfirm();
                          }
                        }}
                      >
                        <FolderOpenIcon className="size-3.5" />
                        <T>Clean managed assets…</T>
                      </Button>
                    </span>
                  }
                />
                <TooltipPopup side="top">
                  {cleanableManagedCategories.length === 0
                    ? gt("No cleanable managed asset directories detected.")
                    : gt("Select worktrees, recordings, wallpapers, or artifacts to reclaim.")}
                </TooltipPopup>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={cleaningMode !== null}
                        onClick={() =>
                          void runCleanAction("compact", () =>
                            prismuxDaemonClient.cleanStorage(buildCompactDatabaseCleanRequest()),
                          )
                        }
                      >
                        <DatabaseIcon className="size-3.5" />
                        {cleaningMode === "compact"
                          ? gt("Compacting…")
                          : gt("Compact database")}
                      </Button>
                    </span>
                  }
                />
                <TooltipPopup side="top">
                  <T>Runs SQLite WAL checkpoint and VACUUM without deleting any saved data.</T>
                </TooltipPopup>
              </Tooltip>
            </div>
          </div>

          {/* 2-step confirmation panel for managed heavy assets (Esc to cancel) */}
          {managedConfirmOpen ? (
            <div
              role="region"
              aria-label={gt("Confirm managed storage cleanup")}
              className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <AlertTriangleIcon className="size-4 text-warning-foreground" />
                  <T>Select managed directories to clean (press Esc to cancel)</T>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => setManagedConfirmOpen(false)}
                  >
                    <T>Cancel</T>
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="destructive"
                    disabled={!managedRequest || cleaningMode !== null}
                    onClick={() => {
                      if (!managedRequest) return;
                      void runCleanAction("managed", () =>
                        prismuxDaemonClient.cleanStorage(managedRequest),
                      );
                    }}
                  >
                    {cleaningMode === "managed" ? gt("Cleaning…") : gt("Confirm cleanup")}
                  </Button>
                </div>
              </div>
              <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {cleanableManagedCategories.map((category) => {
                  const checked = selectedManagedIds.has(category.id);
                  return (
                    <label
                      key={category.id}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/80 px-3 py-2 text-xs"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleManagedSelection(category.id)}
                          className="size-3.5 rounded accent-primary"
                        />
                        <span className="truncate font-medium text-foreground">
                          {category.name}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
                        {formatBytes(category.bytes)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {/* Sorted category breakdown list */}
        <div className="border-t border-border/60">
          <div className="divide-y divide-border/50">
            {drillLevel.nodes.length === 0 ? (
              <div className="px-4 py-4 text-xs text-muted-foreground sm:px-5">
                {loading ? gt("Scanning storage categories…") : gt("No storage categories found.")}
              </div>
            ) : (
              drillLevel.nodes.map((node) => {
                const tierStyle = TIER_META[node.tier];
                const share =
                  drillLevel.totalBytes > 0 ? (node.bytes / drillLevel.totalBytes) * 100 : 0;
                const hasChildren = Boolean(node.children && node.children.length > 0);
                return (
                  <div
                    key={node.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs transition-colors hover:bg-muted/20 motion-reduce:transition-none sm:px-5"
                  >
                    <div className="flex min-w-44 flex-1 items-center gap-2">
                      <span className={cn("size-2 shrink-0 rounded-full", tierStyle.dotClass)} />
                      {node.tier === "protected" ? (
                        <LockIcon className="size-3 shrink-0 text-info-foreground" aria-hidden />
                      ) : null}
                      <span className="truncate font-medium text-foreground">{node.name}</span>
                      <span
                        className={cn(
                          "hidden shrink-0 rounded-full border px-2 py-0.5 text-3xs font-medium sm:inline-flex",
                          tierStyle.badgeClass,
                        )}
                      >
                        {messages(tierStyle.shortLabel)}
                      </span>
                    </div>

                    <div className="hidden w-36 items-center gap-2 md:flex">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/70">
                        <div
                          className={cn("h-full rounded-full", tierStyle.barClass)}
                          style={{ width: `${Math.max(2, Math.min(100, share))}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-4 font-mono text-2xs tabular-nums">
                      <span className="min-w-20 whitespace-nowrap text-right text-muted-foreground">
                        {gt("{count} files", { count: node.fileCount })}
                      </span>
                      <span className="min-w-18 whitespace-nowrap text-right font-medium text-foreground">
                        {formatBytes(node.bytes)}
                      </span>
                      <span className="w-12 whitespace-nowrap text-right text-muted-foreground">
                        {share.toFixed(1)}%
                      </span>
                      {hasChildren ? (
                        <Button
                          type="button"
                          size="icon-micro"
                          variant="ghost-muted"
                          aria-label={gt("Open {name}", { name: node.name })}
                          onClick={() => {
                            setDrillPathIds((prev) => [...prev, node.id]);
                            setHoveredNodeId(null);
                            setSelectedNodeId(null);
                          }}
                        >
                          <ChevronRightIcon className="size-3.5" />
                        </Button>
                      ) : (
                        <span className="inline-block w-6 shrink-0" aria-hidden />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
