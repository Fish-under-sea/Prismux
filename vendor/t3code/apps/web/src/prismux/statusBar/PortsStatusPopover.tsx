import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  FolderGit2Icon,
  GlobeIcon,
  NetworkIcon,
  RefreshCwIcon,
  ShieldIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { PrismuxDaemonError, type DaemonSystemPortEntryDto } from "../daemonClient";
import {
  partitionPortsByWorkspace,
  resolvePortOpenUrl,
  type PortsScanState,
} from "./portsPolling";
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from "./statusBarContextMenuPolicy";

export interface PortsStatusPopoverProps {
  readonly state: PortsScanState;
  readonly activeWorkspaceRoot: string | null;
  readonly daemonReady: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly onKillPort: (pid: number) => Promise<{ ok: boolean; message?: string; error?: string }>;
  readonly onOpenUrl: (url: string) => void;
}

export function PortsStatusPopover({
  state,
  activeWorkspaceRoot,
  daemonReady,
  onRefresh,
  onKillPort,
  onOpenUrl,
}: PortsStatusPopoverProps) {
  const { workspacePorts, externalPorts } = partitionPortsByWorkspace(
    state.ports,
    activeWorkspaceRoot,
  );
  const [externalExpanded, setExternalExpanded] = useState(
    () => workspacePorts.length === 0 && externalPorts.length > 0,
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [confirmKillPid, setConfirmKillPid] = useState<number | null>(null);
  const [killingPid, setKillingPid] = useState<number | null>(null);
  const [actionAlert, setActionAlert] = useState<{
    readonly tone: "error" | "ok";
    readonly message: string;
  } | null>(null);
  const triggerRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  useEffect(() => {
    if (confirmKillPid === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      // Modeled after Orca resource-usage-kill-dialog: never dismiss mid-flight kill.
      if (killingPid !== null) {
        event.preventDefault();
        return;
      }
      const pid = confirmKillPid;
      setConfirmKillPid(null);
      queueMicrotask(() => {
        triggerRefs.current.get(pid)?.focus();
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [confirmKillPid, killingPid]);

  const copyAddress = async (entry: DaemonSystemPortEntryDto) => {
    const url = resolvePortOpenUrl(entry);
    const key = `${entry.pid}:${entry.port}`;
    try {
      await navigator.clipboard?.writeText(url);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((cur) => (cur === key ? null : cur));
      }, 1500);
    } catch {
      // Ignore clipboard error.
    }
  };

  const executeKill = async (entry: DaemonSystemPortEntryDto) => {
    setKillingPid(entry.pid);
    setActionAlert(null);
    try {
      const res = await onKillPort(entry.pid);
      setConfirmKillPid(null);
      if (res?.ok === false) {
        setActionAlert({
          tone: "error",
          message: res.error || res.message || `无法终止进程 PID ${entry.pid}`,
        });
      } else {
        setActionAlert({
          tone: "ok",
          message: `已请求终止 ${entry.processName}（PID ${entry.pid} / :${entry.port}）。`,
        });
      }
    } catch (error) {
      setConfirmKillPid(null);
      if (error instanceof PrismuxDaemonError && error.status === 403) {
        setActionAlert({
          tone: "error",
          message: `防误杀拦截（403）：${error.message}`,
        });
      } else {
        setActionAlert({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      setKillingPid(null);
    }
  };

  const renderPortRow = (entry: DaemonSystemPortEntryDto) => {
    const url = resolvePortOpenUrl(entry);
    const rowKey = `${entry.pid}:${entry.port}`;
    const isCopied = copiedKey === rowKey;
    const isConfirming = confirmKillPid === entry.pid;
    const isKilling = killingPid === entry.pid;

    return (
      <div
        key={rowKey}
        className="flex flex-col gap-1 rounded-lg border border-border/70 bg-muted/35 px-2.5 py-2 text-xs"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="rounded-sm bg-emerald-600/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 tabular-nums dark:bg-emerald-400/15 dark:text-emerald-300">
              :{entry.port}
            </span>
            <span className="truncate font-medium text-foreground">{entry.processName}</span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
              PID {entry.pid}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              title={`在浏览器中打开 ${url}`}
              aria-label={`在浏览器中打开 ${url}`}
              onClick={(event) => {
                onOpenUrl(url);
                if (event.detail > 0) event.currentTarget.blur();
              }}
              className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md border border-border/80 bg-background text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              <ExternalLinkIcon aria-hidden className="size-3" />
            </button>
            <button
              type="button"
              title={`复制地址 ${url}`}
              aria-label={`复制地址 ${url}`}
              onClick={(event) => {
                void copyAddress(entry);
                if (event.detail > 0) event.currentTarget.blur();
              }}
              className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md border border-border/80 bg-background text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              {isCopied ? (
                <CheckIcon aria-hidden className="size-3 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <CopyIcon aria-hidden className="size-3" />
              )}
            </button>
            {entry.protected ? (
              <span
                title={entry.protectedReason || "受 Prismux 防误杀保护的核心/系统进程，禁止终止"}
                aria-label="受保护进程，不可终止"
                className="inline-flex size-6 items-center justify-center rounded-md border border-border/60 bg-muted text-muted-foreground opacity-60"
              >
                <ShieldIcon aria-hidden className="size-3" />
              </span>
            ) : (
              <button
                ref={(node) => {
                  if (node) triggerRefs.current.set(entry.pid, node);
                  else triggerRefs.current.delete(entry.pid);
                }}
                type="button"
                disabled={isKilling}
                title={`终止进程 ${entry.processName} (PID ${entry.pid})`}
                aria-label={`终止进程 ${entry.processName} (PID ${entry.pid})`}
                onClick={() => setConfirmKillPid(isConfirming ? null : entry.pid)}
                className={cn(
                  "inline-flex size-6 cursor-pointer items-center justify-center rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                  isConfirming
                    ? "border-red-500 bg-red-600 text-white"
                    : "border-border/80 bg-background text-red-700 hover:bg-red-500/15 dark:text-red-300",
                )}
              >
                <Trash2Icon aria-hidden className="size-3" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate font-mono" title={entry.cwd ?? url}>
            {entry.cwd ? entry.cwd : url}
          </span>
          {entry.isContainer || (entry.attributionConfidence && entry.attributionConfidence !== "none") ? (
            <span className="shrink-0 rounded-xs bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
              {entry.isContainer ? "container" : entry.attributionConfidence}
            </span>
          ) : null}
        </div>

        {isConfirming ? (
          <div
            role="alert"
            className="mt-1 flex items-center justify-between gap-2 rounded-md border border-red-500/50 bg-red-500/10 px-2 py-1.5 text-[11px]"
          >
            <span className="font-medium text-red-700 dark:text-red-300">
              确认终止 PID {entry.pid}（:{entry.port}）？
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={isKilling}
                onClick={() => {
                  setConfirmKillPid(null);
                  queueMicrotask(() => triggerRefs.current.get(entry.pid)?.focus());
                }}
                className="cursor-pointer rounded-sm border border-border bg-background px-2 py-0.5 font-medium text-foreground hover:bg-accent"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isKilling}
                onClick={() => void executeKill(entry)}
                className="cursor-pointer rounded-sm bg-red-600 px-2 py-0.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isKilling ? "终止中…" : "确认终止"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div
      {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
      className="flex w-96 max-w-[calc(100vw-1rem)] flex-col gap-3 rounded-xl border border-border bg-popover p-3.5 text-popover-foreground shadow-xl"
      data-testid="prismux-ports-popover"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <NetworkIcon aria-hidden className="size-3.5 shrink-0 text-foreground" />
          <span className="truncate text-xs font-semibold text-foreground">
            本机监听端口（{state.ports.length}）
          </span>
        </div>
        <button
          type="button"
          disabled={!daemonReady || state.loading}
          onClick={() => void onRefresh()}
          aria-busy={state.loading || undefined}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        >
          <RefreshCwIcon aria-hidden className={cn("size-3", state.loading && "animate-spin")} />
          <span>{state.loading ? "扫描中…" : "立即扫描"}</span>
        </button>
      </div>

      {!daemonReady ? (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-200"
        >
          Prismux Daemon 未就绪，暂无法扫描本机监听端口。请等待后台服务启动或前往「服务体检」排查。
        </div>
      ) : null}

      {state.error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-xs text-red-700 dark:text-red-300"
        >
          <AlertTriangleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            端口扫描失败（连续 {state.failureStreak} 次）：{state.error}
          </span>
        </div>
      ) : null}

      {actionAlert ? (
        <div
          role="alert"
          className={cn(
            "rounded-lg border px-2.5 py-2 text-xs",
            actionAlert.tone === "error"
              ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          )}
        >
          {actionAlert.message}
        </div>
      ) : null}

      <div className="flex max-h-72 flex-col gap-2.5 overflow-y-auto pr-0.5">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <FolderGit2Icon aria-hidden className="size-3 shrink-0" />
              当前工作区端口（{workspacePorts.length}）
            </span>
            {activeWorkspaceRoot ? (
              <span className="max-w-44 truncate font-mono" title={activeWorkspaceRoot}>
                {activeWorkspaceRoot.split(/[\\/]/).filter(Boolean).at(-1)}
              </span>
            ) : null}
          </div>
          {workspacePorts.length > 0 ? (
            workspacePorts.map(renderPortRow)
          ) : (
            <div className="rounded-md border border-dashed border-border/80 px-2.5 py-2 text-[11px] text-muted-foreground">
              当前工作区暂无活跃 TCP LISTEN 端口。
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            aria-expanded={externalExpanded}
            onClick={() => setExternalExpanded((v) => !v)}
            className="flex cursor-pointer items-center justify-between rounded-md px-1 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            <span className="inline-flex items-center gap-1">
              {externalExpanded ? (
                <ChevronDownIcon aria-hidden className="size-3 shrink-0" />
              ) : (
                <ChevronRightIcon aria-hidden className="size-3 shrink-0" />
              )}
              <GlobeIcon aria-hidden className="size-3 shrink-0" />
              外部进程端口（{externalPorts.length}）
            </span>
            <span>{externalExpanded ? "折叠" : "展开"}</span>
          </button>
          {externalExpanded ? (
            externalPorts.length > 0 ? (
              externalPorts.map(renderPortRow)
            ) : (
              <div className="rounded-md border border-dashed border-border/80 px-2.5 py-2 text-[11px] text-muted-foreground">
                未发现其他外部监听端口。
              </div>
            )
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/70 pt-2 text-[11px] text-muted-foreground">
        <span>30s 静默轮询 · 窗口遮挡自动停扫</span>
        <span className="tabular-nums">
          {state.lastScannedAt
            ? `更新于 ${new Date(state.lastScannedAt).toLocaleTimeString()}`
            : "尚未扫描"}
        </span>
      </div>
    </div>
  );
}
