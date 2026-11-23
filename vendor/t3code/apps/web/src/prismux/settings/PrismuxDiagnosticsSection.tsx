import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  DatabaseIcon,
  LayersIcon,
  RefreshCwIcon,
  XCircleIcon,
} from "lucide-react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
import { toastManager } from "../../components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { SettingsSection } from "../../components/settings/settingsLayout";
import { cn } from "../../lib/utils";
import { prismuxDaemonClient, type DaemonDiagnosticsStatus } from "../daemonClient";
import {
  formatDiagnosticsTimestamp,
  normalizeDiagnosticsResponse,
  type NormalizedDiagnosticGroup,
  type NormalizedDiagnosticItem,
  type NormalizedDiagnosticsReport,
} from "./prismuxDiagnostics.logic";

function statusToneClasses(status: DaemonDiagnosticsStatus): {
  readonly dot: string;
  readonly border: string;
  readonly badgeVariant: "success" | "warning" | "error";
} {
  switch (status) {
    case "ok":
      return {
        dot: "bg-emerald-500",
        border: "border-border/70",
        badgeVariant: "success",
      };
    case "degraded":
      return {
        dot: "bg-amber-500",
        border: "border-amber-500/35",
        badgeVariant: "warning",
      };
    case "error":
      return {
        dot: "bg-destructive",
        border: "border-destructive/45",
        badgeVariant: "error",
      };
  }
}

function useCopyFixCommand() {
  const gt = useGT();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyCommand = useCallback(
    async (id: string, command: string) => {
      try {
        if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
          throw new Error("Clipboard unavailable");
        }
        await navigator.clipboard.writeText(command);
        setCopiedId(id);
        toastManager.add({
          type: "success",
          title: gt("Command copied"),
          description: command,
        });
        window.setTimeout(() => {
          setCopiedId((current) => (current === id ? null : current));
        }, 1600);
      } catch {
        toastManager.add({
          type: "error",
          title: gt("Could not copy command"),
          description: command,
        });
      }
    },
    [gt],
  );

  return { copiedId, copyCommand };
}

function categoryHeadingLabel(
  group: NormalizedDiagnosticGroup,
  gt: ReturnType<typeof useGT>,
): string {
  switch (group.id) {
    case "host_core":
      return gt("Host Core");
    case "memory_sync":
      return gt("Memory & Sync");
    case "ai_providers":
      return gt("AI Provider CLIs");
    case "simulators_media":
      return gt("Simulators & Media Tools");
    case "network_mirrors":
      return gt("Network & Mirrors");
    case "dormant_engines":
      return gt("Dormant Engines Summary");
    default:
      return group.fallbackLabel;
  }
}

function statusLabel(status: DaemonDiagnosticsStatus, gt: ReturnType<typeof useGT>): string {
  switch (status) {
    case "ok":
      return gt("Healthy");
    case "degraded":
      return gt("Degraded");
    case "error":
      return gt("Error");
  }
}

export function DiagnosticItemCard({
  item,
  copied,
  onCopyCommand,
}: {
  readonly item: NormalizedDiagnosticItem;
  readonly copied: boolean;
  readonly onCopyCommand: (id: string, command: string) => void;
}) {
  const gt = useGT();
  const tone = statusToneClasses(item.status);
  const hasFooterActions = Boolean(item.fixCommand || item.settingsRoute);

  return (
    <div
      data-diagnostic-card="true"
      data-diagnostic-id={item.id}
      data-diagnostic-status={item.status}
      className={cn(
        "flex h-full min-h-[156px] flex-col rounded-lg border bg-background/55 px-3.5 py-3 transition-colors",
        tone.border,
      )}
    >
      {/* 1. Fixed single-line header: dot + truncated title + status badge */}
      <div className="flex h-5 shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", tone.dot)} aria-hidden="true" />
          <span className="truncate text-xs font-semibold text-foreground" title={item.name}>
            {item.name}
          </span>
        </div>
        <Badge variant={tone.badgeVariant} className="shrink-0 text-[10px]">
          {statusLabel(item.status, gt)}
        </Badge>
      </div>

      {/* 2. Flex-1 body: summary + max 2-line detail/hint + compact version/latency meta */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1.5">
        <p
          className="line-clamp-2 text-xs leading-relaxed text-foreground/90"
          title={item.summary}
        >
          {item.summary}
        </p>
        {item.detail ? (
          <p
            className="line-clamp-2 break-all text-[11px] leading-relaxed text-muted-foreground"
            title={item.detail}
          >
            {item.detail}
          </p>
        ) : item.fixAction && !item.fixCommand ? (
          <p
            className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground"
            title={item.fixAction}
          >
            {item.fixAction}
          </p>
        ) : null}

        {(item.version || item.latencyMs !== null) ? (
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1 text-[11px] text-muted-foreground">
            {item.version ? (
              <span
                className="max-w-full truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]"
                title={item.version}
              >
                {item.version}
              </span>
            ) : null}
            {item.latencyMs !== null ? (
              <span className="font-mono text-[10px] tabular-nums">{item.latencyMs} ms</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 3. Fixed bottom-aligned action bar (no redundant command code block below) */}
      {hasFooterActions ? (
        <div
          data-diagnostic-card-footer="true"
          className="mt-auto flex min-h-[34px] shrink-0 flex-wrap items-center gap-1.5 border-t border-border/50 pt-2.5"
        >
          {item.fixCommand ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    data-diagnostic-copy-command="true"
                    title={item.fixCommand}
                    className="h-6 max-w-full gap-1 px-2 text-[11px]"
                    onClick={() => onCopyCommand(item.id, item.fixCommand!)}
                  />
                }
              >
                {copied ? (
                  <CheckIcon className="size-3 shrink-0 text-emerald-500" />
                ) : (
                  <CopyIcon className="size-3 shrink-0" />
                )}
                <span className="truncate">
                  {copied ? `${gt("Copied")} ✓` : gt("Copy fix command")}
                </span>
              </TooltipTrigger>
              <TooltipPopup data-pmx-glass-zone="overlays" side="top" sideOffset={6}>
                <span className="block max-w-xs break-all font-mono text-[11px]">
                  {item.fixCommand}
                </span>
              </TooltipPopup>
            </Tooltip>
          ) : null}
          {item.settingsRoute ? (
            <Button
              size="xs"
              variant="ghost"
              className="h-6 gap-1 px-2 text-[11px]"
              render={<Link to={item.settingsRoute as never} />}
            >
              <span>{gt("Open settings")}</span>
              <ArrowRightIcon className="size-3 shrink-0" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Prismux Service Diagnostics Center (GET /v1/diagnostics/services).
 *
 * - `variant="full"`: mounted on `/settings/diagnostics` with all 6 groups / 18 health checks,
 *   memory retrieval mode badge (`FTS5 + sqlite-vec` vs `FTS5 degraded`), dormant engine read-only
 *   summary, copyable fix commands, and settings deep-links.
 * - `variant="compact"`: mounted optionally on `/welcome` as a lightweight collapsible preview that
 *   silently hides when the local Prismux Daemon is unreachable.
 */
export function PrismuxDiagnosticsSection({
  variant = "full",
  initialReportOverride,
}: {
  readonly variant?: "full" | "compact";
  readonly initialReportOverride?: NormalizedDiagnosticsReport | null;
}) {
  const gt = useGT();
  const { copiedId, copyCommand } = useCopyFixCommand();
  const [report, setReport] = useState<NormalizedDiagnosticsReport | null>(
    () => initialReportOverride ?? null,
  );
  const [loading, setLoading] = useState(() => initialReportOverride === undefined);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [compactOpen, setCompactOpen] = useState(false);

  const loadDiagnostics = useCallback(async (force: boolean) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const response = await prismuxDaemonClient.fetchDiagnosticsServices(force);
      setReport(normalizeDiagnosticsResponse(response));
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialReportOverride !== undefined) return;
    void loadDiagnostics(false);
  }, [initialReportOverride, loadDiagnostics]);

  if (variant === "compact") {
    if (!report) {
      return null;
    }
    const attentionItems = report.items.filter((item) => item.status !== "ok");
    return (
      <section
        id="prismux-welcome-diagnostics"
        className="grid gap-x-10 border-b border-border/60 py-4 sm:grid-cols-[6rem_minmax(0,1fr)]"
      >
        <h2 className="text-sm leading-10 text-muted-foreground">
          <T>Health</T>
        </h2>
        <div className="min-w-0">
          <Collapsible open={compactOpen} onOpenChange={setCompactOpen}>
            <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ActivityIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium text-foreground">
                  <T>Prismux Service Diagnostics</T>
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="success" className="font-mono text-[10px] tabular-nums">
                    {report.summary.ok} {gt("Healthy")}
                  </Badge>
                  {report.summary.degraded > 0 ? (
                    <Badge variant="warning" className="font-mono text-[10px] tabular-nums">
                      {report.summary.degraded} {gt("Degraded")}
                    </Badge>
                  ) : null}
                  {report.summary.error > 0 ? (
                    <Badge variant="error" className="font-mono text-[10px] tabular-nums">
                      {report.summary.error} {gt("Error")}
                    </Badge>
                  ) : null}
                  <Badge
                    variant={report.memoryRetrievalState === "fts5+sqlite-vec" ? "info" : "secondary"}
                    className="text-[10px]"
                  >
                    {report.memoryRetrievalState === "fts5+sqlite-vec"
                      ? gt("FTS5 + sqlite-vec hybrid")
                      : gt("FTS5 degraded mode")}
                  </Badge>
                </div>
                <ChevronDownIcon className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180" />
              </CollapsibleTrigger>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={loading}
                onClick={() => void loadDiagnostics(true)}
              >
                <RefreshCwIcon className={cn("size-3", loading && "animate-spin")} />
                {gt("Re-run check")}
              </Button>
            </div>
            <CollapsiblePanel>
              <div className="mt-2 space-y-2 pb-1">
                {attentionItems.length === 0 ? (
                  <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-muted-foreground">
                    <T>All detected host services, tools, and mirrors are healthy.</T>
                  </p>
                ) : (
                  <div className="grid items-stretch gap-2 sm:grid-cols-2">
                    {attentionItems.slice(0, 6).map((item) => (
                      <DiagnosticItemCard
                        key={item.id}
                        item={item}
                        copied={copiedId === item.id}
                        onCopyCommand={(id, cmd) => void copyCommand(id, cmd)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      </section>
    );
  }

  return (
    <div id="prismux-diagnostics" className="space-y-6">
      <SettingsSection
        title={gt("Prismux Service Diagnostics")}
        headerAction={
          <div className="flex flex-wrap items-center gap-2">
            {report ? (
              <span className="text-2xs text-muted-foreground tabular-nums">
                {formatDiagnosticsTimestamp(report.checkedAt)}
                {report.durationMs !== null ? ` · ${report.durationMs} ms` : ""}
              </span>
            ) : null}
            {report?.cached ? (
              <Badge variant="outline" className="text-[10px]">
                {gt("Cached")}
              </Badge>
            ) : null}
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={loading}
              onClick={() => void loadDiagnostics(true)}
            >
              <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
              {loading ? gt("Running diagnostics…") : gt("Re-run diagnostics")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 px-4 py-3.5 sm:px-5">
          {/* Summary counts bar */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2.5">
              <div className="text-[11px] text-muted-foreground">
                <T>Total checks</T>
              </div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                {report ? report.summary.total : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <CheckCircle2Icon className="size-3.5 text-emerald-500" />
                <span>
                  <T>Healthy</T>
                </span>
              </div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {report ? report.summary.ok : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <AlertTriangleIcon className="size-3.5 text-amber-500" />
                <span>
                  <T>Degraded</T>
                </span>
              </div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                {report ? report.summary.degraded : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2.5">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <XCircleIcon className="size-3.5 text-destructive" />
                <span>
                  <T>Errors</T>
                </span>
              </div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-destructive">
                {report ? report.summary.error : "—"}
              </div>
            </div>
          </div>

          {errorMsg ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive"
            >
              <div className="flex min-w-0 items-center gap-2">
                <AlertTriangleIcon className="size-4 shrink-0" />
                <span className="break-all">
                  {gt("Could not load Prismux Daemon diagnostics: {error}", { error: errorMsg })}
                </span>
              </div>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => void loadDiagnostics(true)}
              >
                {gt("Retry")}
              </Button>
            </div>
          ) : null}

          {/* Memory Retrieval Mode Banner */}
          {report ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3.5 py-2.5">
              <div className="flex min-w-0 items-start gap-2.5">
                <DatabaseIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      <T>Memory retrieval engine</T>
                    </span>
                    <Badge
                      variant={
                        report.memoryRetrievalState === "fts5+sqlite-vec"
                          ? "success"
                          : report.memoryRetrievalState === "fts5-only"
                            ? "warning"
                            : "secondary"
                      }
                      className="text-[10px]"
                    >
                      {report.memoryRetrievalState === "fts5+sqlite-vec"
                        ? gt("FTS5 + sqlite-vec hybrid")
                        : report.memoryRetrievalState === "fts5-only"
                          ? gt("FTS5 degraded mode")
                          : gt("Unknown")}
                    </Badge>
                  </div>
                  {report.memoryRetrievalDetail ? (
                    <p className="text-[11px] text-muted-foreground">
                      {report.memoryRetrievalDetail}
                    </p>
                  ) : null}
                </div>
              </div>
              <Button
                size="xs"
                variant="outline"
                render={<Link to="/settings/memory-sync" />}
              >
                <span>{gt("Memory & Sync")}</span>
                <ArrowRightIcon className="size-3" />
              </Button>
            </div>
          ) : null}

          {/* Dormant Engines Read-Only Summary */}
          {report && report.dormantEngines.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-border/70 bg-muted/15 px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <LayersIcon className="size-3.5 text-muted-foreground" />
                  <span>
                    <T>Dormant Engines Read-Only Summary</T>
                  </span>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {gt("Read-only")}
                </Badge>
              </div>
              <div className="grid items-stretch gap-2 sm:grid-cols-3">
                {report.dormantEngines.map((engine) => {
                  const tone = statusToneClasses(engine.status);
                  return (
                    <div
                      key={engine.id}
                      className="flex h-full flex-col rounded-md border border-border/60 bg-background/60 px-2.5 py-2"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="truncate text-[11px] font-medium text-foreground">
                          {engine.name}
                        </span>
                        <span className={cn("size-2 shrink-0 rounded-full", tone.dot)} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground" title={engine.summary}>
                        {engine.summary}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* 6 Groups Grid */}
          {loading && !report ? (
            <p className="py-4 text-xs text-muted-foreground">
              <T>Probing Prismux services, tools, and mirrors…</T>
            </p>
          ) : null}

          {report ? (
            <div className="space-y-5">
              {report.groups.map((group) => {
                const groupTone = statusToneClasses(group.status);
                return (
                  <div key={group.id} data-diagnostic-group={group.id} className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={cn("size-2 rounded-full", groupTone.dot)} />
                        <h4 className="text-xs font-semibold tracking-wide text-foreground">
                          {categoryHeadingLabel(group, gt)}
                        </h4>
                        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                          ({group.items.length})
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {group.okCount} {gt("Healthy")}
                        </span>
                        {group.degradedCount > 0 ? (
                          <span className="text-amber-600 dark:text-amber-400">
                            · {group.degradedCount} {gt("Degraded")}
                          </span>
                        ) : null}
                        {group.errorCount > 0 ? (
                          <span className="text-destructive">
                            · {group.errorCount} {gt("Error")}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div
                      data-diagnostic-group-grid={group.id}
                      className="grid items-stretch gap-2.5 md:grid-cols-2 xl:grid-cols-3"
                    >
                      {group.items.map((item) => (
                        <DiagnosticItemCard
                          key={item.id}
                          item={item}
                          copied={copiedId === item.id}
                          onCopyCommand={(id, cmd) => void copyCommand(id, cmd)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </SettingsSection>
    </div>
  );
}
