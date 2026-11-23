import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CpuIcon,
  FolderGit2Icon,
  LoaderCircleIcon,
  RefreshCwIcon,
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
  formatBytesCompact,
  formatCpuPercent,
  normalizeResourcesSummary,
  sortResourceWorkspaceGroups,
  type ResourceSortOption,
} from "./statusBarResources";

export interface ResourcesStatusPopoverProps {
  readonly raw: DaemonSystemResourcesResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly daemonReady: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly onKillPty: (sessionId: string) => Promise<DaemonKillStalePtyResponse>;
}

export function ResourcesStatusPopover({
  raw,
  loading,
  error,
  daemonReady,
  onRefresh,
  onKillPty,
}: ResourcesStatusPopoverProps) {
  const summary = normalizeResourcesSummary(raw);
  const [sortOption, setSortOption] = useState<ResourceSortOption>("memory");
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [confirmSessionId, setConfirmSessionId] = useState<string | null>(null);
  const [killingSessionId, setKillingSessionId] = useState<string | null>(null);
  const [alert, setAlert] = useState<{
    readonly tone: "error" | "ok";
    readonly message: string;
  } | null>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const sortedWorkspaces = useMemo(
    () => sortResourceWorkspaceGroups(summary.workspaces, sortOption),
    [sortOption, summary.workspaces],
  );

  const toggleWorkspace = (workspace: string) => {
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspace)) next.delete(workspace);
      else next.add(workspace);
      return next;
    });
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

  return (
    <div
      {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
      className="flex w-96 max-w-[calc(100vw-1rem)] flex-col gap-3 rounded-xl border border-border bg-popover p-3.5 text-popover-foreground shadow-xl"
      data-testid="prismux-resources-popover"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <CpuIcon aria-hidden className="size-3.5 shrink-0 text-foreground" />
          <span className="truncate text-xs font-semibold text-foreground">
            系统与 PTY 资源归因
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div
            role="group"
            aria-label="资源排序方式"
            className="inline-flex rounded-md border border-border bg-muted/60 p-0.5 text-[10px]"
          >
            {(
              [
                { id: "memory", label: "内存" },
                { id: "cpu", label: "CPU" },
                { id: "name", label: "名称" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={sortOption === opt.id}
                onClick={(event) => {
                  setSortOption(opt.id);
                  if (event.detail > 0) event.currentTarget.blur();
                }}
                className={cn(
                  "cursor-pointer rounded-sm px-1.5 py-0.5 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                  sortOption === opt.id
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!daemonReady || loading}
            aria-busy={loading || undefined}
            onClick={() => void onRefresh()}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            <RefreshCwIcon aria-hidden className={cn("size-3", loading && "animate-spin")} />
            <span>{loading ? "采样中…" : "刷新"}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 text-xs tabular-nums">
        <div className="rounded-lg border border-border/70 bg-muted/35 p-2">
          <div className="text-[11px] text-muted-foreground">总占用</div>
          <div className="mt-0.5 font-semibold text-foreground">
            {formatCpuPercent(summary.cpuPercent)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {formatBytesCompact(summary.memoryBytes)}
          </div>
        </div>
        <div className="rounded-lg border border-border/70 bg-muted/35 p-2">
          <div className="text-[11px] text-muted-foreground">Daemon</div>
          <div className="mt-0.5 font-semibold text-foreground">
            {formatCpuPercent(summary.daemonCpuPercent)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {formatBytesCompact(summary.daemonMemoryBytes)}
          </div>
        </div>
        <div className="rounded-lg border border-border/70 bg-muted/35 p-2">
          <div className="text-[11px] text-muted-foreground">T3 Server</div>
          <div className="mt-0.5 font-semibold text-foreground">
            {formatCpuPercent(summary.t3ServerCpuPercent)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {formatBytesCompact(summary.t3ServerMemoryBytes)}
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

      <div className="flex max-h-60 flex-col gap-2 overflow-y-auto pr-0.5">
        {sortedWorkspaces.length > 0 ? (
          sortedWorkspaces.map((group) => {
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
          })
        ) : (
          <div className="rounded-lg border border-dashed border-border/80 px-2.5 py-2 text-xs text-muted-foreground">
            {daemonReady
              ? "当前无活跃持久 PTY 会话（宿主与守护进程运行平稳）。"
              : "Daemon 未连接，暂未获取资源归因树。"}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border/70 pt-2 text-[11px] text-muted-foreground tabular-nums">
        <span>
          活跃 PTY：{summary.totalPtyCount}
          {summary.stalePtyCount > 0 ? `（含 ${summary.stalePtyCount} 僵死）` : ""}
        </span>
        {summary.hostMemoryTotalBytes ? (
          <span>主机总内存 {formatBytesCompact(summary.hostMemoryTotalBytes)}</span>
        ) : null}
      </div>
    </div>
  );
}
