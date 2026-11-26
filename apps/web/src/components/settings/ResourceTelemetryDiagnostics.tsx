import { thrownErrorMessage } from "@prismux/client-runtime/errors";
import { ProcessSignalActions } from "./ProcessSignalActions";
import { AuthEnvironmentMaintainScope } from "@prismux/core-contracts";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import {
  ActivityIcon,
  AlertTriangleIcon,
  BatteryChargingIcon,
  BatteryIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CpuIcon,
  DatabaseIcon,
  FolderOpenIcon,
  GaugeIcon,
  HardDriveIcon,
  MemoryStickIcon,
  MonitorIcon,
  PlugIcon,
} from "lucide-react";
import type {
  BackgroundBooleanState,
  EnvironmentId,
  ResourceTelemetryAggregate,
  ResourceTelemetryHistoryBucket,
  ResourceTelemetryIoSemantics,
  ResourceTelemetryProcess,
  ResourceTelemetryProcessCategory,
  ResourceTelemetryProcessSummary,
  ResourceTelemetrySourceHealth,
  ResourceTelemetrySourceStatus,
  ServerProcessSignal,
} from "@prismux/core-contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { RegistryContext } from "@effect/atom-react";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@prismux/client-runtime/state/runtime";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { m, type MessageResolver } from "../../i18n/messages";

import {
  useResourceTelemetry,
  useResourceTelemetryHistory,
} from "../../lib/resourceTelemetryState";
import { cn } from "../../lib/utils";
import { formatBytes } from "../../lib/formatBytes";
import { ensureLocalApi } from "../../localApi";
import {
  prismuxDaemonClient,
  type DaemonStorageInventoryResponse,
} from "../../prismux/daemonClient";
import { useOptionalPrismuxTelemetry } from "../../prismux/PrismuxTelemetryContext";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useRelativeTimeState } from "../../hooks/useRelativeTimeState";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import {
  extractHostHardwareInfo,
  extractHostPowerExtended,
  formatCoreTopology,
  formatCpuTime,
  formatHostPowerSourceLabel,
  formatHostUptime,
  formatSamplingStatus,
  formatThermalSensorDisplay,
  localizeNativeStatusBadge,
  localizeSourceStatus,
  processIdentityKey,
  resourceHistoryBarHeight,
  resourceHistoryCpuScaleMax,
  shouldShowResourceMonitorRetry,
  visibleResourceTelemetryProcesses,
} from "./ResourceTelemetryDiagnostics.logic";
import { StorageTreemapSection } from "./StorageTreemapSection";
import {
  DEFAULT_STORAGE_WARNING_THRESHOLD_BYTES,
  resolveStorageFootprintTone,
} from "./StorageTreemapSection.logic";
import { SettingsSection } from "./settingsLayout";

const HISTORY_WINDOWS = [
  { label: "5m", windowMs: 5 * 60_000, bucketMs: 15_000 },
  { label: "15m", windowMs: 15 * 60_000, bucketMs: 30_000 },
  { label: "30m", windowMs: 30 * 60_000, bucketMs: 60_000 },
  { label: "1h", windowMs: 60 * 60_000, bucketMs: 2 * 60_000 },
] as const;

type ProcessSectionTab = "processes" | "timeline";

function formatRate(value: number): string {
  return `${formatBytes(value)}/s`;
}

function formatDurationMicros(value: number): string {
  if (value < 1_000) return `${Math.round(value)} µs`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(2).replace(/\.0+$/, "")} ms`;
  return `${(value / 1_000_000).toFixed(2).replace(/\.0+$/, "")} s`;
}

function formatProcessName(process: Pick<ResourceTelemetryProcess, "command" | "name">): string {
  if (process.name.trim()) return process.name;
  const firstToken = process.command.trim().split(/\s+/)[0] ?? process.command;
  const normalized = firstToken.replace(/^['"]|['"]$/g, "");
  return normalized.split(/[\\/]/).findLast((segment) => segment.length > 0) ?? normalized;
}

function categoryLabel(
  category: ResourceTelemetryProcessCategory,
  resolve: MessageResolver = m,
): string {
  switch (category) {
    case "server":
      return resolve(msg("Server"));
    case "server-child":
      return resolve(msg("Backend child"));
    case "provider-root":
      return resolve(msg("Provider"));
    case "terminal-root":
      return resolve(msg("Terminal"));
    case "electron-main":
      return resolve(msg("Electron main"));
    case "electron-renderer":
      return resolve(msg("Renderer"));
    case "electron-gpu":
      return "GPU";
    case "electron-utility":
      return resolve(msg("Electron utility"));
    case "resource-monitor":
      return resolve(msg("Monitor"));
    case "unknown-t3":
      return resolve(msg("Prismux process"));
  }
}

function categoryDotClass(category: ResourceTelemetryProcessCategory): string {
  if (category === "resource-monitor") return "bg-warning";
  if (category.startsWith("electron-")) return "bg-info";
  if (category === "server") return "bg-primary";
  return "bg-success";
}

function ioSemanticsLabel(
  semantics: ResourceTelemetryIoSemantics,
  resolve: MessageResolver = m,
): string {
  switch (semantics) {
    case "storage":
      return resolve(msg("Storage bytes"));
    case "logical":
      return resolve(msg("Logical bytes"));
    case "all-io":
      return resolve(msg("All I/O bytes"));
    case "unavailable":
      return resolve(msg("Unavailable"));
  }
}

function booleanStateLabel(
  value: BackgroundBooleanState,
  labels: { readonly true: string; readonly false: string },
  resolve: MessageResolver = m,
): string {
  if (value === "true") return labels.true;
  if (value === "false") return labels.false;
  return resolve(msg("Unknown"));
}

function sourceStatusTone(status: ResourceTelemetrySourceStatus): "default" | "warning" | "danger" {
  if (status === "healthy") return "default";
  if (status === "starting" || status === "degraded") return "warning";
  return "danger";
}

function SourceStatusBadge({
  label,
  status,
  presentation,
}: {
  label: string;
  status: ResourceTelemetrySourceStatus;
  presentation?:
    | {
        readonly label: string;
        readonly tone?: "neutral" | "default" | "warning" | "danger";
      }
    | undefined;
}) {
  const messages = useMessages();
  const tone = presentation?.tone ?? sourceStatusTone(status);
  const statusText = presentation?.label ?? localizeSourceStatus(status, messages);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-3xs font-semibold tracking-wider",
        tone === "neutral" && "border-border/70 bg-muted/45 text-muted-foreground",
        tone === "default" && "border-success/25 bg-success/10 text-success-foreground",
        tone === "warning" && "border-warning/30 bg-warning/10 text-warning-foreground",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          tone === "neutral" && "bg-muted-foreground/55",
          tone === "default" && "bg-success",
          tone === "warning" && "bg-warning",
          tone === "danger" && "bg-destructive",
        )}
      />
      {label ? `${label} ${statusText}` : statusText}
    </span>
  );
}

function LastSampleLabel({ sampledAt }: { sampledAt: DateTime.Utc | null }) {
  const relative = useRelativeTimeState(sampledAt ? DateTime.formatIso(sampledAt) : null);
  if (relative.status !== "relative") {
    return (
      <span className="text-2xs text-muted-foreground/55">
        <T>Waiting for sample</T>
      </span>
    );
  }
  return (
    <span className="text-2xs text-muted-foreground/60">
      {relative.suffix ? (
        <T context="the time is an elapsed time such as 5m">
          Updated{" "}
          <span className="font-mono tabular-nums">
            <Var>{relative.value}</Var>
          </span>{" "}
          ago
        </T>
      ) : (
        <T>
          Updated{" "}
          <span className="font-mono tabular-nums">
            <Var>{relative.value}</Var>
          </span>
        </T>
      )}
    </span>
  );
}

function IconStat({
  icon,
  label,
  value,
  detail,
  tone = "default",
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string | undefined;
  tone?: "default" | "warning" | "danger";
  onClick?: (() => void) | undefined;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-3xs font-semibold uppercase tracking-widest text-muted-foreground/70">
        <span className="text-muted-foreground/55 transition-colors group-hover:text-foreground/65">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          "mt-2.5 truncate font-mono text-2xl font-semibold tracking-tighter tabular-nums text-foreground",
          tone === "warning" && "text-warning-foreground",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
      {detail ? (
        <div className="mt-1.5 truncate text-3xs text-muted-foreground/70">{detail}</div>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group min-w-0 cursor-pointer px-4 py-4 text-left transition-colors hover:bg-muted/20 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none sm:px-5"
      >
        {body}
      </button>
    );
  }

  return <div className="group min-w-0 px-4 py-4 sm:px-5">{body}</div>;
}

function AggregateCard({
  label,
  accentClass,
  aggregate,
}: {
  label: string;
  accentClass: string;
  aggregate: ResourceTelemetryAggregate;
}) {
  const gt = useGT();
  return (
    <div className="relative overflow-hidden border-t border-border/60 px-4 py-4 first:border-t-0 md:border-t-0 md:border-l md:first:border-l-0 sm:px-5">
      <span className={cn("absolute inset-x-5 top-0 h-0.5 rounded-full opacity-75", accentClass)} />
      <div className="flex items-center justify-between gap-3">
        <div className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground/75">
          {label}
        </div>
        <div className="rounded-md bg-muted/55 px-1.5 py-0.5 font-mono text-3xs tabular-nums text-muted-foreground/70">
          {gt("{count, plural, one {{count} process} other {{count} processes}}", {
            count: aggregate.processCount,
          })}
        </div>
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
        <MetricPair label={gt("CPU")} value={`${aggregate.currentCpuPercent.toFixed(1)}%`} />
        <MetricPair label={gt("Memory")} value={formatBytes(aggregate.currentRssBytes)} />
        <MetricPair label={gt("Read")} value={formatRate(aggregate.ioReadBytesPerSecond)} />
        <MetricPair label={gt("Write")} value={formatRate(aggregate.ioWriteBytesPerSecond)} />
      </div>
    </div>
  );
}

function MetricPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground/45">
        {label}
      </div>
      <div className="truncate font-mono text-xs font-medium tabular-nums text-foreground/90">
        {value}
      </div>
    </div>
  );
}

function HealthSource({ label, health }: { label: string; health: ResourceTelemetrySourceHealth }) {
  const gt = useGT();
  const expectedInBrowser =
    health.status === "unavailable" &&
    Option.exists(health.lastError, (error) => error.includes("'web' mode"));
  return (
    <div className="flex min-h-18 items-start justify-between gap-4 border-t border-border/50 py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="mt-1 text-2xs leading-relaxed text-muted-foreground/75">
          {expectedInBrowser
            ? gt("Available when this page runs inside the desktop app.")
            : Option.match(health.lastError, {
                onNone: () => gt("No reported errors"),
                onSome: (error) => error,
              })}
        </div>
      </div>
      <SourceStatusBadge
        label=""
        status={health.status}
        presentation={
          expectedInBrowser
            ? {
                label: gt("Desktop only"),
                tone: "neutral",
              }
            : undefined
        }
      />
    </div>
  );
}

function DetailRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border/50 py-2.5 first:border-t-0">
      <span className="text-2xs text-muted-foreground/80">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right font-mono text-2xs tabular-nums text-foreground/90",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}

function HistoryWindowSelector({
  selectedWindowMs,
  onSelect,
}: {
  selectedWindowMs: number;
  onSelect: (windowMs: number) => void;
}) {
  const gt = useGT();
  return (
    <ToggleGroup
      aria-label={gt("Resource history period")}
      variant="segmented"
      value={[String(selectedWindowMs)]}
      onValueChange={(next) => {
        const selected = HISTORY_WINDOWS.find((option) => String(option.windowMs) === next[0]);
        if (selected) onSelect(selected.windowMs);
      }}
    >
      {HISTORY_WINDOWS.map((option) => (
        <Toggle key={option.windowMs} value={String(option.windowMs)}>
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

function ResourceHistoryChart({
  buckets,
}: {
  buckets: ReadonlyArray<ResourceTelemetryHistoryBucket>;
}) {
  const gt = useGT();
  const maxCpu = resourceHistoryCpuScaleMax(buckets);
  const maxIo = Math.max(1, ...buckets.map((bucket) => bucket.ioReadBytes + bucket.ioWriteBytes));

  return (
    <div className="border-t border-border/60 px-4 py-4 sm:px-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-3xs text-muted-foreground/75">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-full bg-foreground/70" /> <T>CPU average</T>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-full bg-info/70" /> <T>I/O reads</T>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-full bg-warning/80" /> <T>I/O writes</T>
        </span>
      </div>
      <div className="flex h-32 items-end gap-1 overflow-hidden rounded-lg border border-border/40 bg-muted/10 px-2 pt-3 pb-2">
        {buckets.map((bucket) => {
          const cpuHeight = resourceHistoryBarHeight({
            value: bucket.avgCpuPercent,
            max: maxCpu,
            minimumVisiblePercent: 2,
          });
          const readHeight = resourceHistoryBarHeight({
            value: bucket.ioReadBytes,
            max: maxIo,
            minimumVisiblePercent: 1,
          });
          const writeHeight = resourceHistoryBarHeight({
            value: bucket.ioWriteBytes,
            max: maxIo,
            minimumVisiblePercent: 1,
          });
          return (
            <Tooltip key={DateTime.formatIso(bucket.startedAt)}>
              <TooltipTrigger
                render={
                  <div className="grid h-full min-w-1 flex-1 grid-cols-3 items-end gap-px">
                    <span
                      className="block rounded-t-sm bg-foreground/65"
                      style={{ height: `${cpuHeight}%` }}
                    />
                    <span
                      className="block rounded-t-sm bg-info/70"
                      style={{ height: `${readHeight}%` }}
                    />
                    <span
                      className="block rounded-t-sm bg-warning/80"
                      style={{ height: `${writeHeight}%` }}
                    />
                  </div>
                }
              />
              <TooltipPopup side="top" className="text-left">
                <div className="space-y-0.5">
                  <div>
                    {gt("CPU avg {percent}%", { percent: bucket.avgCpuPercent.toFixed(1) })}
                  </div>
                  <div>
                    {gt("CPU peak {percent}%", { percent: bucket.maxCpuPercent.toFixed(1) })}
                  </div>
                  <div>{gt("Read {bytes}", { bytes: formatBytes(bucket.ioReadBytes) })}</div>
                  <div>{gt("Write {bytes}", { bytes: formatBytes(bucket.ioWriteBytes) })}</div>
                </div>
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

function ProcessTreeName({
  process,
  collapsed,
  onToggle,
}: {
  process: ResourceTelemetryProcess;
  collapsed: boolean;
  onToggle: (process: ResourceTelemetryProcess) => void;
}) {
  const gt = useGT();
  const name = formatProcessName(process);
  const hasChildren = process.childPids.length > 0;
  return (
    <div
      className="grid min-w-0 grid-cols-[1.25rem_0.375rem_minmax(0,1fr)] items-center gap-2"
      style={{ paddingLeft: `${Math.min(process.depth, 7) * 10}px` }}
    >
      {hasChildren ? (
        <Button
          size="icon-micro"
          variant="ghost-muted"
          onClick={() => onToggle(process)}
          aria-label={collapsed ? gt("Expand {name}", { name }) : gt("Collapse {name}", { name })}
        >
          {collapsed ? (
            <ChevronRightIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          )}
        </Button>
      ) : (
        <span className="size-5" aria-hidden />
      )}
      <span className={cn("size-1.5 rounded-full", categoryDotClass(process.category))} />
      <Tooltip>
        <TooltipTrigger
          render={<span className="min-w-0 truncate font-medium text-foreground">{name}</span>}
        />
        <TooltipPopup side="top" variant="code">
          {process.command || process.name}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function canSignalProcess(process: ResourceTelemetryProcess): boolean {
  return (
    process.category === "server-child" ||
    process.category === "provider-root" ||
    process.category === "terminal-root"
  );
}

function ProcessActions({
  process,
  canMaintainEnvironment,
  signalingKeys,
  onSignal,
}: {
  process: ResourceTelemetryProcess;
  canMaintainEnvironment: boolean;
  signalingKeys: ReadonlySet<string>;
  onSignal: (process: ResourceTelemetryProcess, signal: ServerProcessSignal) => void;
}) {
  if (!canSignalProcess(process)) {
    return <span className="text-3xs text-muted-foreground/35">-</span>;
  }
  const isSignaling = signalingKeys.has(processIdentityKey(process));
  return (
    <ProcessSignalActions
      disabled={!canMaintainEnvironment || isSignaling}
      onSignal={(signal) => onSignal(process, signal)}
    />
  );
}

function ProcessTable({
  processes,
  canMaintainEnvironment,
  signalingKeys,
  onSignal,
}: {
  processes: ReadonlyArray<ResourceTelemetryProcess>;
  canMaintainEnvironment: boolean;
  signalingKeys: ReadonlySet<string>;
  onSignal: (process: ResourceTelemetryProcess, signal: ServerProcessSignal) => void;
}) {
  const messages = useMessages();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const visible = visibleResourceTelemetryProcesses(processes, collapsed);
  const toggle = (process: ResourceTelemetryProcess) => {
    const identityKey = processIdentityKey(process);
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(identityKey)) {
        next.delete(identityKey);
      } else {
        next.add(identityKey);
      }
      return next;
    });
  };

  return (
    <div className="border-t border-border/60">
      <ScrollArea
        chainVerticalScroll
        scrollFade
        hideScrollbars
        className="max-h-[min(68vh,48rem)] w-full max-w-full"
      >
        <table className="w-full min-w-[1320px] table-fixed text-left text-xs">
          <colgroup>
            <col className="w-[20%]" />
            <col className="w-[10%]" />
            <col className="w-[7%]" />
            <col className="w-[8%]" />
            <col className="w-[9%]" />
            <col className="w-[9%]" />
            <col className="w-[9%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
            <col className="w-[6%]" />
            <col className="w-[4%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 border-b border-border/60 bg-card text-3xs uppercase tracking-widest text-muted-foreground/70">
            <tr>
              <th className="px-4 py-2 font-semibold sm:pl-5">
                <T>Process</T>
              </th>
              <th className="px-3 py-2 font-semibold">
                <T>Category</T>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <T>CPU</T>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <T>CPU Time</T>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <T>Memory</T>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <T>Read/s</T>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <T>Write/s</T>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <T>Read Total</T>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <T>Write Total</T>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <T>PID</T>
              </th>
              <th className="px-2 py-2 text-right font-semibold sm:pr-4">
                <T>Kill</T>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-5 text-xs text-muted-foreground sm:px-5">
                  <T>Waiting for the native process monitor.</T>
                </td>
              </tr>
            ) : null}
            {visible.map((process) => (
              <tr key={processIdentityKey(process)} className="hover:bg-muted/20">
                <td className="px-4 py-2 sm:pl-5">
                  <ProcessTreeName
                    process={process}
                    collapsed={collapsed.has(processIdentityKey(process))}
                    onToggle={toggle}
                  />
                </td>
                <td className="truncate px-3 py-2 text-2xs text-muted-foreground">
                  {categoryLabel(process.category, messages)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {process.cpuPercent.toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {formatCpuTime(process.cpuTimeMs / 1_000, messages)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {formatBytes(process.residentBytes)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-info-foreground">
                  {formatRate(process.ioReadBytesPerSecond)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-warning-foreground">
                  {formatRate(process.ioWriteBytesPerSecond)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {formatBytes(process.ioReadBytes)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  <Tooltip>
                    <TooltipTrigger render={<span>{formatBytes(process.ioWriteBytes)}</span>} />
                    <TooltipPopup side="top">
                      {ioSemanticsLabel(process.ioSemantics, messages)}
                    </TooltipPopup>
                  </Tooltip>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {process.identity.pid}
                </td>
                <td className="px-2 py-2 text-right sm:pr-4">
                  <ProcessActions
                    process={process}
                    canMaintainEnvironment={canMaintainEnvironment}
                    signalingKeys={signalingKeys}
                    onSignal={onSignal}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

function HistoryProcessTable({
  processes,
}: {
  processes: ReadonlyArray<ResourceTelemetryProcessSummary>;
}) {
  const messages = useMessages();
  return (
    <div className="border-t border-border/60">
      <ScrollArea
        chainVerticalScroll
        scrollFade
        hideScrollbars
        className="max-h-[28rem] w-full max-w-full"
      >
        <table className="w-full min-w-[1020px] table-fixed text-left text-xs">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[11%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[11%]" />
            <col className="w-[11%]" />
            <col className="w-[11%]" />
            <col className="w-[7%]" />
            <col className="w-[5%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 border-b border-border/60 bg-card text-3xs uppercase tracking-widest text-muted-foreground/70">
            <tr>
              <th className="px-4 py-2 font-semibold sm:pl-5">
                <T>Process</T>
              </th>
              <th className="px-3 py-2 font-semibold">
                <T>Category</T>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <T>CPU Time</T>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <T>Peak CPU</T>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <T>Peak Mem</T>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <T>Read</T>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <T>Write</T>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <T>Samples</T>
              </th>
              <th className="px-3 py-2 text-right font-semibold sm:pr-5">
                <T>PID</T>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {processes.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-5 text-xs text-muted-foreground sm:px-5">
                  <T>No retained process samples in this window.</T>
                </td>
              </tr>
            ) : null}
            {processes.map((process) => (
              <tr key={processIdentityKey(process)} className="hover:bg-muted/20">
                <td className="px-4 py-2 sm:pl-5">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span className="block truncate font-medium text-foreground">
                          {process.name || process.command}
                        </span>
                      }
                    />
                    <TooltipPopup side="top" variant="code">
                      {process.command || process.name}
                    </TooltipPopup>
                  </Tooltip>
                </td>
                <td className="truncate px-3 py-2 text-2xs text-muted-foreground">
                  {categoryLabel(process.category, messages)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {formatCpuTime(process.cpuTimeMs / 1_000, messages)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {process.maxCpuPercent.toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {formatBytes(process.peakRssBytes)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-info-foreground">
                  {formatBytes(process.ioReadBytes)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-warning-foreground">
                  {formatBytes(process.ioWriteBytes)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {process.sampleCount}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground sm:pr-5">
                  {process.identity.pid}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

export interface LogsDirectoryActionProps {
  readonly disabled: boolean;
  readonly isOpening: boolean;
  readonly error: string | null;
  readonly onOpen: () => void;
}

export function ResourceTelemetryDiagnostics({
  environmentId,
  logsDirectoryAction,
}: {
  environmentId: EnvironmentId | null;
  logsDirectoryAction?: LogsDirectoryActionProps | undefined;
}) {
  return (
    <ResourceTelemetryDiagnosticsBody
      key={environmentId ?? ""}
      environmentId={environmentId}
      logsDirectoryAction={logsDirectoryAction}
    />
  );
}

function ResourceTelemetryDiagnosticsBody({
  environmentId,
  logsDirectoryAction,
}: {
  environmentId: EnvironmentId | null;
  logsDirectoryAction?: LogsDirectoryActionProps | undefined;
}) {
  const messages = useMessages();
  const gt = useGT();
  const registry = useContext(RegistryContext);
  const daemonTelemetry = useOptionalPrismuxTelemetry();
  const [windowMs, setWindowMs] = useState(15 * 60_000);
  const [processViewTab, setProcessViewTab] = useState<ProcessSectionTab>("processes");
  const selectedWindow =
    HISTORY_WINDOWS.find((option) => option.windowMs === windowMs) ?? HISTORY_WINDOWS[1];
  const canMaintainEnvironment = useEnvironmentScope(environmentId, AuthEnvironmentMaintainScope);
  const telemetry = useResourceTelemetry(environmentId);
  const retryTelemetry = telemetry.retry;
  const history = useResourceTelemetryHistory(
    {
      windowMs: selectedWindow.windowMs,
      bucketMs: selectedWindow.bucketMs,
    },
    environmentId,
  );
  const signalServerProcess = useAtomCommand(serverEnvironment.signalProcess, {
    reportFailure: false,
  });
  const [signalingKeys, setSignalingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const signalingKeysRef = useRef<ReadonlySet<string>>(new Set());
  const [isRetrying, setIsRetrying] = useState(false);

  const [storageInventory, setStorageInventory] = useState<DaemonStorageInventoryResponse | null>(
    null,
  );
  const [storageLoading, setStorageLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- loads cached daemon storage inventory once on mount for overview stat and treemap
  useEffect(() => {
    let cancelled = false;
    void prismuxDaemonClient
      .getStorageInventory(false)
      .then((data) => {
        if (cancelled) return;
        setStorageInventory(data);
        setStorageError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setStorageError(
          cause instanceof Error ? cause.message : gt("Unable to scan local storage."),
        );
      })
      .finally(() => {
        if (!cancelled) setStorageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gt]);

  const refreshStorage = async (forceRefresh = true) => {
    setStorageLoading(true);
    try {
      const data = await prismuxDaemonClient.getStorageInventory(forceRefresh);
      setStorageInventory(data);
      setStorageError(null);
    } catch (cause: unknown) {
      setStorageError(
        cause instanceof Error ? cause.message : gt("Unable to scan local storage."),
      );
    } finally {
      setStorageLoading(false);
    }
  };

  const handleRefreshAll = () => {
    telemetry.refresh();
    void refreshStorage(true);
  };

  const snapshot = telemetry.data;
  const allPrismux = snapshot?.groups.allT3;

  const signalProcess = async (process: ResourceTelemetryProcess, signal: ServerProcessSignal) => {
    const targetEnvironmentId = environmentId;
    if (
      targetEnvironmentId === null ||
      !readEnvironmentScope(targetEnvironmentId, AuthEnvironmentMaintainScope)
    )
      return;
    const identityKey = processIdentityKey(process);
    if (signalingKeysRef.current.has(identityKey)) return;
    const nextSignalingKeys = new Set(signalingKeysRef.current).add(identityKey);
    signalingKeysRef.current = nextSignalingKeys;
    setSignalingKeys(nextSignalingKeys);
    const clearSignaling = () => {
      const next = new Set(signalingKeysRef.current);
      next.delete(identityKey);
      signalingKeysRef.current = next;
      setSignalingKeys(next);
    };

    if (signal === "SIGKILL") {
      let confirmed = false;
      try {
        confirmed = await ensureLocalApi().dialogs.confirm(
          gt("Send SIGKILL to process {pid}? This cannot be handled by the process.", {
            pid: process.identity.pid,
          }),
          { variant: "destructive" },
        );
      } catch (error) {
        clearSignaling();
        toastManager.add({
          type: "error",
          title: gt("Could not confirm signal"),
          description:
            error instanceof Error
              ? (thrownErrorMessage(error, m) ?? error.message)
              : gt("Failed to send {signal}.", { signal }),
        });
        return;
      }
      if (!confirmed) {
        clearSignaling();
        return;
      }
    }
    if (!readEnvironmentScope(targetEnvironmentId, AuthEnvironmentMaintainScope)) {
      clearSignaling();
      return;
    }
    void signalServerProcess({
      environmentId: targetEnvironmentId,
      input: {
        pid: process.identity.pid,
        startTimeMs: process.identity.startTimeMs,
        signal,
      },
    })
      .then((result) => {
        if (result._tag === "Failure") {
          if (isAtomCommandInterrupted(result)) return;
          throw squashAtomCommandFailure(result);
        }
        if (result.value.signaled) return;
        toastManager.add({
          type: "error",
          title: gt("Could not send {signal}", { signal }),
          description: Option.getOrElse(result.value.message, () =>
            gt("Failed to send {signal} to process {pid}.", {
              signal,
              pid: process.identity.pid,
            }),
          ),
        });
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: gt("Could not send {signal}", { signal }),
          description:
            error instanceof Error
              ? (thrownErrorMessage(error, m) ?? error.message)
              : gt("Failed to send {signal}.", { signal }),
        });
      })
      .finally(() => {
        clearSignaling();
      });
  };

  const retryCollector = () => {
    if (
      environmentId === null ||
      !readEnvironmentScope(environmentId, AuthEnvironmentMaintainScope)
    )
      return;
    setIsRetrying(true);
    void retryTelemetry()
      .then(() => {
        for (const option of HISTORY_WINDOWS) {
          registry.refresh(
            serverEnvironment.resourceTelemetryHistory({
              environmentId,
              input: { windowMs: option.windowMs, bucketMs: option.bucketMs },
            }),
          );
        }
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: gt("Could not restart resource monitor"),
          description:
            error instanceof Error
              ? (thrownErrorMessage(error, m) ?? error.message)
              : gt("The resource monitor retry failed."),
        });
      })
      .finally(() => {
        setIsRetrying(false);
      });
  };

  const collectorNeedsRetry = shouldShowResourceMonitorRetry({
    nativeStatus: snapshot?.health.native.status ?? null,
    error: telemetry.error,
  });

  const hostHardware = extractHostHardwareInfo(snapshot, daemonTelemetry?.systemResources ?? null);
  const powerExtended = extractHostPowerExtended(snapshot?.power ?? null);
  const thermalDisplay = formatThermalSensorDisplay(
    snapshot?.power.thermalState ?? "unknown",
    hostHardware.temperatureCelsius,
    messages,
  );
  const coreTopology = formatCoreTopology(
    hostHardware.physicalCores,
    hostHardware.logicalCores,
    messages,
  );
  const uptimeLabel = formatHostUptime(hostHardware.uptimeSeconds, messages);
  const osSummary = [
    hostHardware.osName && hostHardware.osVersion
      ? `${hostHardware.osName} ${hostHardware.osVersion}`
      : hostHardware.osName,
    hostHardware.arch,
  ]
    .filter(Boolean)
    .join(" · ");
  const cpuHardwareDetail = [hostHardware.cpuBrand, coreTopology, uptimeLabel ? gt("Up {time}", { time: uptimeLabel }) : null]
    .filter(Boolean)
    .join(" · ");

  const ramTotal = hostHardware.totalMemoryBytes;
  const ramUsed = hostHardware.usedMemoryBytes;
  const ramUsedPercent =
    ramTotal && ramTotal > 0 && ramUsed !== null
      ? Math.max(0, Math.min(100, Math.round((ramUsed / ramTotal) * 100)))
      : null;

  const powerSourceDisplay = formatHostPowerSourceLabel(
    snapshot?.power ?? null,
    powerExtended,
    messages,
  );

  const storageReclaimableBytes = storageInventory
    ? storageInventory.reclaimableDisposableBytes + storageInventory.reclaimableManagedBytes
    : 0;
  const storageWarningThreshold =
    storageInventory?.warningThresholdBytes ?? DEFAULT_STORAGE_WARNING_THRESHOLD_BYTES;
  const storageStatTone = storageInventory
    ? resolveStorageFootprintTone(storageInventory.totalBytes, storageWarningThreshold)
    : "default";

  const scrollToStorageTreemap = () => {
    if (typeof document === "undefined") return;
    const element = document.getElementById("storage-treemap");
    if (!element) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    element.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  return (
    <>
      {/* Section 1: Live footprint overview */}
      <SettingsSection
        title={gt("Live footprint overview")}
        icon={<ActivityIcon className="size-4 text-muted-foreground" />}
        headerAction={
          <div className="flex items-center gap-2">
            {snapshot ? (
              <SourceStatusBadge
                label=""
                status={snapshot.health.native.status}
                presentation={{
                  label: localizeNativeStatusBadge(snapshot.health.native.status, messages),
                }}
              />
            ) : null}
            <LastSampleLabel sampledAt={snapshot?.readAt ?? null} />
            {logsDirectoryAction ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-micro"
                      variant="ghost"
                      disabled={logsDirectoryAction.disabled || logsDirectoryAction.isOpening}
                      onClick={logsDirectoryAction.onOpen}
                      aria-label={gt("Open logs folder")}
                    >
                      <FolderOpenIcon className="size-3.5" />
                    </Button>
                  }
                />
                <TooltipPopup side="top">
                  <T>Open logs folder</T>
                </TooltipPopup>
              </Tooltip>
            ) : null}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-micro"
                    variant="ghost"
                    disabled={telemetry.isPending || storageLoading}
                    onClick={handleRefreshAll}
                    aria-label={gt("Refresh resource telemetry")}
                  >
                    <RefreshIcon size="xs" refreshing={telemetry.isPending || storageLoading} />
                  </Button>
                }
              />
              <TooltipPopup side="top">
                <T>Refresh telemetry snapshot</T>
              </TooltipPopup>
            </Tooltip>
          </div>
        }
      >
        <div className="overflow-hidden rounded-[inherit]">
          <div className="flex flex-col gap-3 border-b border-border/60 bg-linear-to-r from-muted/45 via-muted/20 to-transparent px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <div className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground/75">
                <T>Prismux system footprint</T>
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                <T>
                  Live native counters for the server, providers, terminals, desktop shell, monitor
                  overhead, and local disk usage.
                </T>
              </p>
            </div>
            <div className="flex items-center gap-2 text-3xs text-muted-foreground/75">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  snapshot && snapshot.sampleIntervalMs > 0
                    ? "bg-success"
                    : "bg-muted-foreground/55",
                )}
              />
              {snapshot
                ? formatSamplingStatus(snapshot.sampleIntervalMs, messages)
                : gt("Sampling every ...")}
            </div>
          </div>

          <div className="grid grid-cols-2 divide-x divide-y divide-border/55 md:grid-cols-3">
            <IconStat
              icon={<CpuIcon className="size-3.5" />}
              label={gt("Current CPU")}
              value={allPrismux ? `${allPrismux.currentCpuPercent.toFixed(1)}%` : "..."}
              detail={
                allPrismux
                  ? gt("{time} observed CPU time", {
                      time: formatCpuTime(allPrismux.cpuTimeMs / 1_000, messages),
                    })
                  : undefined
              }
            />
            <IconStat
              icon={<MemoryStickIcon className="size-3.5" />}
              label={gt("Resident memory")}
              value={allPrismux ? formatBytes(allPrismux.currentRssBytes) : "..."}
              detail={
                allPrismux
                  ? gt("{bytes} combined process peaks", {
                      bytes: formatBytes(allPrismux.peakRssBytes),
                    })
                  : undefined
              }
            />
            <IconStat
              icon={<ActivityIcon className="size-3.5" />}
              label={gt("Process count")}
              value={allPrismux ? String(allPrismux.processCount) : "..."}
              detail={
                allPrismux
                  ? gt("{processStarts} starts · {processExits} exits", {
                      processStarts: allPrismux.processStarts,
                      processExits: allPrismux.processExits,
                    })
                  : undefined
              }
            />
            <IconStat
              icon={<HardDriveIcon className="size-3.5" />}
              label={gt("Read throughput")}
              value={allPrismux ? formatRate(allPrismux.ioReadBytesPerSecond) : "..."}
              detail={
                allPrismux
                  ? gt("{bytes} observed", { bytes: formatBytes(allPrismux.ioReadBytes) })
                  : undefined
              }
            />
            <IconStat
              icon={<DatabaseIcon className="size-3.5" />}
              label={gt("Write throughput")}
              value={allPrismux ? formatRate(allPrismux.ioWriteBytesPerSecond) : "..."}
              detail={
                allPrismux
                  ? gt("{bytes} observed", { bytes: formatBytes(allPrismux.ioWriteBytes) })
                  : undefined
              }
              tone={
                allPrismux && allPrismux.ioWriteBytesPerSecond >= 10 * 1_024 * 1_024
                  ? "danger"
                  : allPrismux && allPrismux.ioWriteBytesPerSecond >= 1_024 * 1_024
                    ? "warning"
                    : "default"
              }
            />
            <IconStat
              icon={<FolderOpenIcon className="size-3.5" />}
              label={gt("Local storage footprint")}
              value={
                storageInventory
                  ? formatBytes(storageInventory.totalBytes)
                  : storageLoading
                    ? "..."
                    : "-"
              }
              detail={
                storageInventory
                  ? storageReclaimableBytes > 0
                    ? gt("{bytes} reclaimable", { bytes: formatBytes(storageReclaimableBytes) })
                    : gt("Within storage quota")
                  : storageError
                    ? gt("Scan unavailable")
                    : undefined
              }
              tone={storageStatTone}
              onClick={scrollToStorageTreemap}
            />
          </div>

          {telemetry.error || logsDirectoryAction?.error ? (
            <div className="space-y-1.5 border-t border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive sm:px-5">
              {telemetry.error ? (
                <div className="flex items-start gap-2">
                  <AlertTriangleIcon className="size-3.5 h-lh shrink-0" />
                  <span>{telemetry.error}</span>
                </div>
              ) : null}
              {logsDirectoryAction?.error ? (
                <div className="flex items-start gap-2">
                  <AlertTriangleIcon className="size-3.5 h-lh shrink-0" />
                  <span>{logsDirectoryAction.error}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {snapshot ? (
            <div className="grid border-t border-border/60 bg-muted/10 md:grid-cols-3">
              <AggregateCard
                label={gt("Backend + agents")}
                accentClass="bg-success/80"
                aggregate={snapshot.groups.backend}
              />
              <AggregateCard
                label={gt("Desktop")}
                accentClass="bg-info/80"
                aggregate={snapshot.groups.electron}
              />
              <AggregateCard
                label={gt("Monitor overhead")}
                accentClass="bg-warning/80"
                aggregate={snapshot.groups.monitor}
              />
            </div>
          ) : null}
        </div>
      </SettingsSection>

      {/* Section 2: Symmetric 2-column Host & collection */}
      <SettingsSection
        title={gt("Host & collection")}
        icon={<GaugeIcon className="size-4 text-muted-foreground" />}
        headerAction={
          collectorNeedsRetry ? (
            <Button size="xs" variant="outline" disabled={isRetrying} onClick={retryCollector}>
              <RefreshIcon size="xs" refreshing={isRetrying} />
              <T>Retry monitor</T>
            </Button>
          ) : null
        }
      >
        <div className="grid overflow-hidden rounded-[inherit] md:grid-cols-2 md:divide-x md:divide-border/60">
          {/* Left column: Host state (2 summary cards + 5 aligned DetailRows) */}
          <div className="px-4 py-4 sm:px-5">
            <div className="mb-3 flex items-center gap-2 text-3xs font-semibold uppercase tracking-widest text-muted-foreground/75">
              <span className="flex size-6 items-center justify-center rounded-md bg-muted/60">
                <MonitorIcon className="size-3.5" />
              </span>
              <T>Host state</T>
            </div>

            {/* Summary card 1: Host hardware */}
            <div className="flex min-h-18 flex-col justify-center gap-1.5 border-t border-border/50 py-3 first:border-t-0">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground">
                  <T>Host hardware</T>
                </span>
                <span className="inline-flex shrink-0 items-center rounded-full border border-border/70 bg-muted/45 px-2.5 py-0.5 font-mono text-3xs font-semibold tabular-nums text-foreground/85">
                  {osSummary || gt("Local host")}
                </span>
              </div>
              <div className="truncate text-2xs leading-relaxed text-muted-foreground/80">
                {cpuHardwareDetail || gt("Hardware telemetry waiting for first native sample.")}
              </div>
            </div>

            {/* Summary card 2: Physical memory & power */}
            <div className="flex min-h-18 flex-col justify-center gap-2 border-t border-border/50 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground">
                  <T>Physical memory & power</T>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/45 px-2.5 py-0.5 font-mono text-3xs font-semibold tabular-nums text-foreground/85">
                  {powerExtended.isCharging === "true" ? (
                    <BatteryChargingIcon className="size-3 text-success-foreground" aria-hidden />
                  ) : snapshot?.power.onBattery === "true" ? (
                    <BatteryIcon className="size-3 text-warning-foreground" aria-hidden />
                  ) : (
                    <PlugIcon className="size-3 text-muted-foreground" aria-hidden />
                  )}
                  <span>{powerSourceDisplay}</span>
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 font-mono text-3xs tabular-nums text-muted-foreground">
                  <span>
                    {ramTotal !== null && ramUsed !== null
                      ? `${formatBytes(ramUsed)} / ${formatBytes(ramTotal)}`
                      : gt("System RAM awaiting host telemetry")}
                  </span>
                  <span>{ramUsedPercent !== null ? `${ramUsedPercent}%` : "-"}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/70">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all motion-reduce:transition-none",
                      ramUsedPercent !== null && ramUsedPercent >= 90
                        ? "bg-destructive"
                        : ramUsedPercent !== null && ramUsedPercent >= 78
                          ? "bg-warning"
                          : "bg-info/80",
                    )}
                    style={{ width: `${ramUsedPercent ?? 0}%` }}
                  />
                </div>
              </div>
            </div>

            {/* 5 aligned DetailRows matching right column 1:1 */}
            <DetailRow label={gt("Power source")} value={powerSourceDisplay} />
            <DetailRow
              label={gt("Low power mode")}
              value={booleanStateLabel(
                snapshot?.power.lowPowerMode ?? "unknown",
                { true: gt("Enabled"), false: gt("Disabled") },
                messages,
              )}
            />
            <DetailRow
              label={gt("Idle")}
              value={
                snapshot
                  ? `${booleanStateLabel(
                      snapshot.power.idle,
                      {
                        true: gt("Idle", { $context: "host power state" }),
                        false: gt("Active", { $context: "host power state" }),
                      },
                      messages,
                    )}${
                      snapshot.power.idleSeconds === null
                        ? ""
                        : ` · ${Math.round(snapshot.power.idleSeconds)}s`
                    }`
                  : gt("Unknown")
              }
            />
            <DetailRow
              label={gt("Session")}
              value={
                snapshot
                  ? snapshot.power.suspended
                    ? gt("Suspended")
                    : booleanStateLabel(
                        snapshot.power.locked,
                        { true: gt("Locked"), false: gt("Unlocked") },
                        messages,
                      )
                  : gt("Unknown")
              }
            />
            <DetailRow
              label={gt("Thermal & sensors")}
              value={thermalDisplay.label}
              valueClassName={
                thermalDisplay.tone === "danger"
                  ? "text-destructive"
                  : thermalDisplay.tone === "warning"
                    ? "text-warning-foreground"
                    : undefined
              }
            />
          </div>

          {/* Right column: Collection health (2 HealthSources + 5 aligned DetailRows) */}
          <div className="border-t border-border/60 px-4 py-4 md:border-t-0 sm:px-5">
            <div className="mb-3 flex items-center gap-2 text-3xs font-semibold uppercase tracking-widest text-muted-foreground/75">
              <span className="flex size-6 items-center justify-center rounded-md bg-muted/60">
                <GaugeIcon className="size-3.5" />
              </span>
              <T>Collection health</T>
            </div>
            {snapshot ? (
              <>
                <HealthSource
                  label={gt("Native process monitor")}
                  health={snapshot.health.native}
                />
                <HealthSource
                  label={gt("Electron main process")}
                  health={snapshot.health.desktop}
                />
                <DetailRow
                  label={gt("Collection time")}
                  value={formatDurationMicros(snapshot.health.collectionDurationMicros)}
                />
                <DetailRow
                  label={gt("Process scan")}
                  value={gt("{retained}/{scanned} retained", {
                    retained: snapshot.health.retainedProcessCount,
                    scanned: snapshot.health.scannedProcessCount,
                  })}
                />
                <DetailRow
                  label={gt("Inaccessible")}
                  value={String(snapshot.health.inaccessibleProcessCount)}
                  valueClassName={
                    snapshot.health.inaccessibleProcessCount > 0
                      ? "text-warning-foreground"
                      : undefined
                  }
                />
                <DetailRow
                  label={gt("Sidecar")}
                  value={Option.match(snapshot.health.sidecarVersion, {
                    onNone: () => gt("Unavailable"),
                    onSome: (version) =>
                      `${version}${Option.match(snapshot.health.sidecarPid, {
                        onNone: () => "",
                        onSome: (pid) => ` · PID ${pid}`,
                      })}`,
                  })}
                />
                <DetailRow label={gt("Restarts")} value={String(snapshot.health.restartCount)} />
              </>
            ) : (
              <div className="py-4 text-xs text-muted-foreground">
                <T>Waiting for collector health.</T>
              </div>
            )}
          </div>
        </div>
      </SettingsSection>

      {/* Section 3: Local storage & WizTree Squarified Treemap */}
      <StorageTreemapSection
        id="storage-treemap"
        inventory={storageInventory}
        loading={storageLoading}
        error={storageError}
        onRefresh={() => refreshStorage(true)}
        onInventoryChange={(next) => {
          setStorageInventory(next);
          setStorageError(null);
        }}
      />

      {/* Section 4: Live processes & resource trends (segmented toggle) */}
      <SettingsSection
        title={gt("Live processes & resource trends")}
        icon={<CpuIcon className="size-4 text-muted-foreground" />}
        headerAction={
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              aria-label={gt("Process and resource view")}
              variant="segmented"
              value={[processViewTab]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "processes" || value === "timeline") {
                  setProcessViewTab(value);
                }
              }}
            >
              <Toggle value="processes">
                <T>Live process tree</T>
              </Toggle>
              <Toggle value="timeline">
                <T>Resource timeline</T>
              </Toggle>
            </ToggleGroup>
            {processViewTab === "timeline" ? (
              <>
                <HistoryWindowSelector selectedWindowMs={windowMs} onSelect={setWindowMs} />
                <Button
                  size="icon-micro"
                  variant="ghost"
                  disabled={history.isPending}
                  onClick={history.refresh}
                  aria-label={gt("Refresh resource history")}
                >
                  <RefreshIcon size="xs" refreshing={history.isPending} />
                </Button>
              </>
            ) : snapshot ? (
              <span className="hidden text-3xs text-muted-foreground/65 sm:inline">
                <T>
                  Identity: <span className="font-mono">PID + start time</span>
                </T>
              </span>
            ) : null}
          </div>
        }
      >
        <div className="overflow-hidden rounded-[inherit]">
          {processViewTab === "processes" ? (
            <ProcessTable
              processes={snapshot?.processes ?? []}
              canMaintainEnvironment={canMaintainEnvironment}
              signalingKeys={signalingKeys}
              onSignal={signalProcess}
            />
          ) : (
            <>
              {history.error ? (
                <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive sm:px-5">
                  <AlertTriangleIcon className="size-3.5 h-lh shrink-0" />
                  <span>{history.error}</span>
                </div>
              ) : null}
              <ResourceHistoryChart buckets={history.data?.buckets ?? []} />
              <HistoryProcessTable processes={history.data?.topProcesses ?? []} />
            </>
          )}
        </div>
      </SettingsSection>
    </>
  );
}
