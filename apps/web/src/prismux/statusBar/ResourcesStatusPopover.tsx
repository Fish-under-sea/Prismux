import {
  AlertTriangleIcon,
  AppWindowIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CpuIcon,
  FolderGit2Icon,
  LayersIcon,
  LoaderCircleIcon,
  MonitorIcon,
  RefreshCwIcon,
  ServerIcon,
  TerminalSquareIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import type {
  DaemonKillStalePtyResponse,
  DaemonPtyResourceDto,
  DaemonSystemResourcesResponse,
} from "../daemonClient";
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from "./statusBarContextMenuPolicy";
import {
  STATUS_BAR_ACTION_BUTTON_CLASS,
  STATUS_BAR_SEGMENTED_GROUP_CLASS,
  statusBarSegmentedOptionClass,
} from "./statusBarControlStyles";
import {
  formatBytesCompact,
  formatCpuPercent,
  formatSampleTimestamp,
  normalizeResourcesSummary,
  sortProcessResources,
  sortResourceWorkspaceGroups,
  type NormalizedProcessResource,
  type ResourceSortOption,
} from "./statusBarResources";

export interface ResourcesStatusPopoverProps {
  readonly raw: DaemonSystemResourcesResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly daemonReady: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly onKillPty: (sessionId: string) => Promise<DaemonKillStalePtyResponse>;
  readonly embeddedInPopover?: boolean;
}

function roleBadgeMeta(proc: NormalizedProcessResource): {
  readonly label: string;
  readonly tone: string;
} {
  switch (proc.role) {
    case "electron-main":
      return {
        label: "主进程",
        tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
      };
    case "electron-renderer":
      return {
        label: "渲染",
        tone: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
      };
    case "electron-gpu":
      return {
        label: "GPU",
        tone: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
      };
    case "electron-utility":
      return {
        label: "服务",
        tone: "bg-muted text-muted-foreground",
      };
    case "t3-server":
      return {
        label: "核心",
        tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      };
    case "daemon":
      return {
        label: "Daemon",
        tone: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
      };
    case "agent":
      return {
        label: "Agent",
        tone: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300",
      };
    case "terminal":
    case "pty":
      return {
        label: "终端",
        tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
      };
    default:
      return {
        label: "子进程",
        tone: "bg-muted text-muted-foreground",
      };
  }
}

function ProcessRoleIcon({ proc }: { readonly proc: NormalizedProcessResource }) {
  switch (proc.role) {
    case "electron-main":
      return <AppWindowIcon aria-hidden className="size-3 shrink-0 text-sky-600 dark:text-sky-400" />;
    case "electron-renderer":
      return <MonitorIcon aria-hidden className="size-3 shrink-0 text-indigo-600 dark:text-indigo-400" />;
    case "electron-gpu":
      return <LayersIcon aria-hidden className="size-3 shrink-0 text-purple-600 dark:text-purple-400" />;
    case "t3-server":
      return <ServerIcon aria-hidden className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />;
    case "daemon":
      return <CpuIcon aria-hidden className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />;
    case "agent":
      return <BotIcon aria-hidden className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />;
    default:
      return <TerminalSquareIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />;
  }
}

function aggregateProcesses(processes: readonly NormalizedProcessResource[]): {
  readonly cpuPercent: number | null;
  readonly memoryBytes: number | null;
} {
  let cpuSum = 0;
  let hasCpu = false;
  let memSum = 0;
  let hasMem = false;
  for (const proc of processes) {
    if (proc.cpuPercent !== null) {
      cpuSum += proc.cpuPercent;
      hasCpu = true;
    }
    if (proc.memoryBytes !== null) {
      memSum += proc.memoryBytes;
      hasMem = true;
    }
  }
  return {
    cpuPercent: hasCpu ? Math.round(cpuSum * 10) / 10 : null,
    memoryBytes: hasMem ? memSum : null,
  };
}

export function ResourcesStatusPopover({
  raw,
  loading,
  error,
  daemonReady,
  onRefresh,
  onKillPty,
  embeddedInPopover = false,
}: ResourcesStatusPopoverProps) {
  const summary = normalizeResourcesSummary(raw);
  const [sortOption, setSortOption] = useState<ResourceSortOption>("memory");
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [activeChildrenCollapsed, setActiveChildrenCollapsed] = useState(false);
  const [coreProcessesCollapsed, setCoreProcessesCollapsed] = useState(false);
  const [confirmSessionId, setConfirmSessionId] = useState<string | null>(null);
  const [killingSessionId, setKillingSessionId] = useState<string | null>(null);
  const [justRefreshed, setJustRefreshed] = useState(false);
  const [alert, setAlert] = useState<{
    readonly tone: "error" | "ok";
    readonly message: string;
  } | null>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const refreshFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sortedWorkspaces = useMemo(
    () => sortResourceWorkspaceGroups(summary.workspaces, sortOption),
    [sortOption, summary.workspaces],
  );
  const sortedActiveChildren = useMemo(
    () => sortProcessResources(summary.activeChildProcesses, sortOption),
    [sortOption, summary.activeChildProcesses],
  );
  const sortedCoreProcesses = useMemo(
    () => sortProcessResources(summary.coreProcesses, sortOption),
    [sortOption, summary.coreProcesses],
  );

  const activeChildrenAgg = useMemo(
    () => aggregateProcesses(sortedActiveChildren),
    [sortedActiveChildren],
  );
  const coreProcessesAgg = useMemo(
    () => aggregateProcesses(sortedCoreProcesses),
    [sortedCoreProcesses],
  );

  useEffect(() => {
    return () => {
      if (refreshFlashTimerRef.current !== null) {
        clearTimeout(refreshFlashTimerRef.current);
      }
    };
  }, []);

  const toggleWorkspace = (workspace: string) => {
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspace)) next.delete(workspace);
      else next.add(workspace);
      return next;
    });
  };

  const handleManualRefresh = async () => {
    setAlert(null);
    await onRefresh();
    setJustRefreshed(true);
    if (refreshFlashTimerRef.current !== null) {
      clearTimeout(refreshFlashTimerRef.current);
    }
    refreshFlashTimerRef.current = setTimeout(() => {
      setJustRefreshed(false);
      refreshFlashTimerRef.current = null;
    }, 1_400);
  };

  useEffect(() => {
    if (!confirmSessionId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      // Modeled after Orca resource-usage-kill-dialog: block Escape while kill is in flight.
      if (killingSessionId !== null) {
        event.preventDefault();
        return;
      }
      const targetId = confirmSessionId;
      setConfirmSessionId(null);
      queueMicrotask(() => {
        buttonRefs.current.get(targetId)?.focus();
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [confirmSessionId, killingSessionId]);

  const executeKillPty = async (pty: DaemonPtyResourceDto) => {
    setKillingSessionId(pty.sessionId);
    setAlert(null);
    try {
      const res = await onKillPty(pty.sessionId);
      setConfirmSessionId(null);
      if (res?.ok === false) {
        setAlert({
          tone: "error",
          message: res.error || res.message || `清理 PTY ${pty.sessionId} 失败`,
        });
      } else {
        setAlert({
          tone: "ok",
          message: `已清理 PTY 会话 ${pty.title || pty.sessionId}。`,
        });
      }
    } catch (err) {
      setConfirmSessionId(null);
      setAlert({
        tone: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setKillingSessionId(null);
    }
  };

  const hasDesktopCard =
    summary.desktopMemoryBytes !== null ||
    summary.desktopCpuPercent !== null ||
    summary.desktopProcessCount > 0;
  const hasAnyAttributionRows =
    sortedWorkspaces.length > 0 ||
    sortedActiveChildren.length > 0 ||
    sortedCoreProcesses.length > 0;
  const sampledTimeLabel = formatSampleTimestamp(summary.collectedAt);

  const t3SubLabel =
    summary.t3ServerHostedBy === "electron-in-process"
      ? "宿主同进程"
      : summary.t3ServerPid !== null
        ? `PID ${summary.t3ServerPid}`
        : summary.t3ServerState === "running"
          ? "运行中"
          : null;

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
        "flex w-[26.5rem] max-w-[calc(100vw-1rem)] flex-col gap-3 p-3.5 text-popover-foreground",
        embeddedInPopover
          ? "bg-transparent"
          : "overflow-hidden rounded-xl border border-border bg-popover bg-clip-padding shadow-xl",
      )}
      data-testid="prismux-resources-popover"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <CpuIcon aria-hidden className="size-3.5 shrink-0 text-foreground" />
          <span className="truncate text-xs font-semibold text-foreground">
            系统与 PTY 资源归因
          </span>
          {summary.totalProcessCount > 0 ? (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
              {summary.totalProcessCount} 进程
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div
            role="group"
            aria-label="资源排序方式"
            data-testid="resources-sort-group"
            className={STATUS_BAR_SEGMENTED_GROUP_CLASS}
          >
            {(
              [
                { id: "memory", label: "内存" },
                { id: "cpu", label: "CPU" },
                { id: "name", label: "名称" },
              ] as const
            ).map((opt) => {
              const selected = sortOption === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`resources-sort-${opt.id}`}
                  aria-pressed={selected}
                  data-active={selected ? "true" : "false"}
                  onClick={(event) => {
                    setSortOption(opt.id);
                    if (event.detail > 0) event.currentTarget.blur();
                  }}
                  className={statusBarSegmentedOptionClass(selected)}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={!daemonReady || loading}
            aria-busy={loading || undefined}
            data-testid="resources-refresh-button"
            onClick={() => void handleManualRefresh()}
            className={STATUS_BAR_ACTION_BUTTON_CLASS}
          >
            {justRefreshed && !loading ? (
              <CheckIcon aria-hidden className="size-3 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <RefreshCwIcon aria-hidden className={cn("size-3", loading && "animate-spin")} />
            )}
            <span>{loading ? "采样中…" : justRefreshed ? "已刷新" : "刷新"}</span>
          </button>
        </div>
      </div>

      {/* Overview summary cards */}
      <div
        className={cn(
          "grid gap-1.5 text-xs tabular-nums",
          hasDesktopCard ? "grid-cols-2" : "grid-cols-3",
        )}
      >
        <div
          data-testid="resources-card-total"
          className="rounded-lg border border-border/70 bg-muted/35 p-2"
        >
          <div className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
            <span>总占用</span>
            {summary.hostMemorySharePercent !== null ? (
              <span className="text-[10px]">占主机 {summary.hostMemorySharePercent}%</span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="font-semibold text-foreground">
              {formatCpuPercent(summary.cpuPercent)}
            </span>
            <span className="text-[11px] font-medium text-foreground/85">
              {formatBytesCompact(summary.memoryBytes)}
            </span>
          </div>
        </div>

        {hasDesktopCard ? (
          <div
            data-testid="resources-card-desktop"
            className="rounded-lg border border-border/70 bg-muted/35 p-2"
          >
            <div className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
              <span>桌面与渲染</span>
              {summary.desktopProcessCount > 0 ? (
                <span className="text-[10px]">{summary.desktopProcessCount} 进程</span>
              ) : null}
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-2">
              <span className="font-semibold text-foreground">
                {formatCpuPercent(summary.desktopCpuPercent)}
              </span>
              <span className="text-[11px] font-medium text-foreground/85">
                {formatBytesCompact(summary.desktopMemoryBytes)}
              </span>
            </div>
          </div>
        ) : null}

        <div
          data-testid="resources-card-t3"
          className="rounded-lg border border-border/70 bg-muted/35 p-2"
        >
          <div className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
            <span className="truncate">Prismux Server</span>
            {t3SubLabel ? (
              <span className="shrink-0 font-mono text-[10px]">{t3SubLabel}</span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="font-semibold text-foreground">
              {formatCpuPercent(summary.t3ServerCpuPercent)}
            </span>
            <span className="text-[11px] font-medium text-foreground/85">
              {formatBytesCompact(summary.t3ServerMemoryBytes)}
            </span>
          </div>
        </div>

        <div
          data-testid="resources-card-daemon"
          className="rounded-lg border border-border/70 bg-muted/35 p-2"
        >
          <div className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
            <span>Daemon</span>
            {summary.daemonPid !== null ? (
              <span className="font-mono text-[10px]">PID {summary.daemonPid}</span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="font-semibold text-foreground">
              {formatCpuPercent(summary.daemonCpuPercent)}
            </span>
            <span className="text-[11px] font-medium text-foreground/85">
              {formatBytesCompact(summary.daemonMemoryBytes)}
            </span>
          </div>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-xs text-red-700 dark:text-red-300"
        >
          <AlertTriangleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {alert ? (
        <div
          role="alert"
          className={cn(
            "rounded-lg border px-2.5 py-2 text-xs",
            alert.tone === "error"
              ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          )}
        >
          {alert.message}
        </div>
      ) : null}

      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-0.5">
        {/* 1. Persistent PTY pool workspaces (killable) */}
        {sortedWorkspaces.map((group) => {
          const isCollapsed = collapsedWorkspaces.has(group.workspace);
          return (
            <div
              key={group.workspace}
              className="flex flex-col gap-1.5 rounded-lg border border-border/70 bg-muted/30 p-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleWorkspace(group.workspace)}
                  className="inline-flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left font-semibold text-foreground transition-colors hover:text-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  {isCollapsed ? (
                    <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <FolderGit2Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate" title={group.workspace}>
                    {group.label}
                  </span>
                </button>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {formatCpuPercent(group.cpuPercent)} · {formatBytesCompact(group.memoryBytes)}
                </span>
              </div>

              {!isCollapsed && group.ptys.length > 0 ? (
                <div className="flex flex-col gap-1 pl-2">
                  {group.ptys.map((pty) => {
                    const isConfirming = confirmSessionId === pty.sessionId;
                    const isKilling = killingSessionId === pty.sessionId;
                    const isStale = pty.stale === true || pty.alive === false;
                    return (
                      <div
                        key={pty.sessionId}
                        className="flex flex-col gap-1 rounded-md border border-border/60 bg-background/80 px-2 py-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <TerminalSquareIcon
                              aria-hidden
                              className="size-3 shrink-0 text-muted-foreground"
                            />
                            <span className="truncate font-mono text-[11px] text-foreground">
                              {pty.title || pty.command || pty.sessionId}
                            </span>
                            {typeof pty.pid === "number" && pty.pid > 0 ? (
                              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                #{pty.pid}
                              </span>
                            ) : null}
                            {isStale ? (
                              <span className="shrink-0 rounded-sm bg-amber-500/20 px-1 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-300">
                                僵死
                              </span>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              {formatCpuPercent(pty.cpuPercent)} ·{" "}
                              {formatBytesCompact(pty.memoryBytes)}
                            </span>
                            <button
                              ref={(node) => {
                                if (node) buttonRefs.current.set(pty.sessionId, node);
                                else buttonRefs.current.delete(pty.sessionId);
                              }}
                              type="button"
                              disabled={isKilling}
                              title={`清理 PTY 会话 ${pty.sessionId}`}
                              aria-label={`清理 PTY 会话 ${pty.sessionId}`}
                              onClick={(event) => {
                                setConfirmSessionId(isConfirming ? null : pty.sessionId);
                                if (event.detail > 0) event.currentTarget.blur();
                              }}
                              className={cn(
                                "inline-flex size-5 cursor-pointer items-center justify-center rounded-sm border transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                                isConfirming
                                  ? "border-red-500 bg-red-600 text-white"
                                  : "border-border/80 bg-background text-red-700 hover:bg-red-500/15 dark:text-red-300",
                              )}
                            >
                              <Trash2Icon aria-hidden className="size-2.5" />
                            </button>
                          </div>
                        </div>

                        {isConfirming ? (
                          <div
                            role="alert"
                            className="flex items-center justify-between gap-2 rounded-sm border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px]"
                          >
                            <span className="text-red-700 dark:text-red-300">
                              确认清理此 PTY 会话？
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={isKilling}
                                onClick={() => {
                                  if (isKilling) return;
                                  setConfirmSessionId(null);
                                  queueMicrotask(() =>
                                    buttonRefs.current.get(pty.sessionId)?.focus(),
                                  );
                                }}
                                className="cursor-pointer rounded-sm border border-border bg-background px-1.5 py-0.5 text-foreground hover:bg-accent disabled:opacity-50"
                              >
                                取消
                              </button>
                              <button
                                type="button"
                                disabled={isKilling}
                                onClick={() => void executeKillPty(pty)}
                                className="inline-flex cursor-pointer items-center gap-1 rounded-sm bg-red-600 px-1.5 py-0.5 text-white hover:bg-red-700 disabled:opacity-50"
                              >
                                {isKilling ? (
                                  <LoaderCircleIcon aria-hidden className="size-3 animate-spin" />
                                ) : null}
                                {isKilling ? "清理中…" : "确认清理"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}

        {/* 2. Live Agent & terminal child processes spawned under T3 Server / Electron / Daemon */}
        {sortedActiveChildren.length > 0 ? (
          <div
            data-testid="resources-active-children-section"
            className="flex flex-col gap-1.5 rounded-lg border border-border/70 bg-muted/30 p-2 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                aria-expanded={!activeChildrenCollapsed}
                onClick={() => setActiveChildrenCollapsed((v) => !v)}
                className="inline-flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left font-semibold text-foreground transition-colors hover:text-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              >
                {activeChildrenCollapsed ? (
                  <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                )}
                <TerminalSquareIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  活跃 Agent 与终端进程（{sortedActiveChildren.length}）
                </span>
              </button>
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                {formatCpuPercent(activeChildrenAgg.cpuPercent)} ·{" "}
                {formatBytesCompact(activeChildrenAgg.memoryBytes)}
              </span>
            </div>

            {!activeChildrenCollapsed ? (
              <div className="flex flex-col gap-1 pl-2">
                {sortedActiveChildren.map((proc) => {
                  const badge = roleBadgeMeta(proc);
                  return (
                    <div
                      key={proc.pid}
                      title={proc.commandLine ?? `${proc.processName} (PID ${proc.pid})`}
                      className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/80 px-2 py-1.5"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <ProcessRoleIcon proc={proc} />
                        <span
                          className={cn(
                            "shrink-0 rounded-sm px-1 py-0.5 text-[10px] font-medium",
                            badge.tone,
                          )}
                        >
                          {badge.label}
                        </span>
                        <span className="truncate text-[11px] font-medium text-foreground">
                          {proc.name}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          PID {proc.pid}
                        </span>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                        {formatCpuPercent(proc.cpuPercent)} · {formatBytesCompact(proc.memoryBytes)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 3. Workbench core process breakdown (Electron Main / Renderer / GPU / T3 Server / Daemon) */}
        {sortedCoreProcesses.length > 0 ? (
          <div
            data-testid="resources-core-processes-section"
            className="flex flex-col gap-1.5 rounded-lg border border-border/70 bg-muted/30 p-2 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                aria-expanded={!coreProcessesCollapsed}
                onClick={() => setCoreProcessesCollapsed((v) => !v)}
                className="inline-flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left font-semibold text-foreground transition-colors hover:text-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              >
                {coreProcessesCollapsed ? (
                  <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                )}
                <MonitorIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  工作台核心进程明细（{sortedCoreProcesses.length}）
                </span>
              </button>
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                {formatCpuPercent(coreProcessesAgg.cpuPercent)} ·{" "}
                {formatBytesCompact(coreProcessesAgg.memoryBytes)}
              </span>
            </div>

            {!coreProcessesCollapsed ? (
              <div className="flex flex-col gap-1 pl-2">
                {sortedCoreProcesses.map((proc) => {
                  const badge = roleBadgeMeta(proc);
                  return (
                    <div
                      key={proc.pid}
                      title={proc.commandLine ?? `${proc.processName} (PID ${proc.pid})`}
                      className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/80 px-2 py-1.5"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <ProcessRoleIcon proc={proc} />
                        <span
                          className={cn(
                            "shrink-0 rounded-sm px-1 py-0.5 text-[10px] font-medium",
                            badge.tone,
                          )}
                        >
                          {badge.label}
                        </span>
                        <span className="truncate text-[11px] font-medium text-foreground">
                          {proc.name}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          PID {proc.pid}
                        </span>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                        {formatCpuPercent(proc.cpuPercent)} · {formatBytesCompact(proc.memoryBytes)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {!hasAnyAttributionRows ? (
          <div className="rounded-lg border border-dashed border-border/80 px-2.5 py-2 text-xs text-muted-foreground">
            {daemonReady
              ? "当前无活跃持久 PTY 会话（等待进程树首次采样或点击刷新）。"
              : "Daemon 未连接，暂未获取资源归因树。"}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-2 text-[11px] text-muted-foreground tabular-nums">
        <span className="truncate">
          活跃 PTY：{summary.totalPtyCount}
          {summary.stalePtyCount > 0 ? `（含 ${summary.stalePtyCount} 僵死）` : ""}
          {summary.activeAgentCount > 0 ? ` · Agent ${summary.activeAgentCount}` : ""}
          {summary.activeTerminalCount > summary.totalPtyCount
            ? ` · 终端 ${summary.activeTerminalCount}`
            : ""}
        </span>
        <span className="shrink-0">
          {summary.hostMemoryTotalBytes
            ? `主机总内存 ${formatBytesCompact(summary.hostMemoryTotalBytes)}`
            : ""}
          {sampledTimeLabel ? (summary.hostMemoryTotalBytes ? ` · ${sampledTimeLabel}` : sampledTimeLabel) : ""}
        </span>
      </div>
    </div>
  );
}
