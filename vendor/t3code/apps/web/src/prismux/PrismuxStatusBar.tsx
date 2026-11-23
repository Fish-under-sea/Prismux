import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  deriveLatestContextWindowSnapshot,
  latestProviderTurnTokenUsage,
} from "@t3tools/client-runtime/state/context-window";
import type { ServerProvider } from "@t3tools/contracts";
import { useRouterState } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  CheckIcon,
  CpuIcon,
  DatabaseZapIcon,
  GaugeIcon,
  LayersIcon,
  NetworkIcon,
  ShieldCheckIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import {
  useProject,
  useQuietThreadProjection,
  useQuietThreadVisibleTurnItems,
} from "~/state/entities";
import { environmentPresentations } from "~/state/presentation";
import { resolveThreadRouteRef } from "~/threadRoutes";
import { useOptionalPrismuxRuntime } from "./PrismuxRuntimeProvider";
import { PortsStatusPopover } from "./statusBar/PortsStatusPopover";
import { ResourcesStatusPopover } from "./statusBar/ResourcesStatusPopover";
import {
  deriveContextGaugeFromSnapshot,
  derivePromptCacheSummary,
  type ContextGaugeLevel,
} from "./statusBar/statusBarContext";
import {
  shouldOpenStatusBarContextMenu,
  STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS,
} from "./statusBar/statusBarContextMenuPolicy";
import {
  formatBytesCompact,
  formatCpuPercent,
  normalizeResourcesSummary,
} from "./statusBar/statusBarResources";
import {
  collectStatusBarUsageSummary,
  formatCompactUsageWindowValue,
} from "./statusBar/statusBarUsage";
import {
  DEFAULT_STATUS_BAR_VISIBILITY,
  loadStatusBarUsagePreferences,
  loadStatusBarVisibility,
  saveStatusBarUsagePreferences,
  saveStatusBarVisibility,
  STATUS_BAR_SEGMENT_IDS,
  toggleStatusBarSegment,
  type StatusBarSegmentId,
  type StatusBarUsagePreferences,
  type StatusBarVisibility,
} from "./statusBar/statusBarVisibility";
import { UsageStatusPopover } from "./statusBar/UsageStatusPopover";
import { useResetCountdownClock } from "./statusBar/useResetCountdownClock";

const SEGMENT_LABELS: Readonly<Record<StatusBarSegmentId, string>> = {
  usage: "合规额度与订阅",
  context: "上下文水位线",
  cache: "Prompt Cache 命中",
  ports: "监听端口胶囊",
  resources: "CPU / RAM 归因",
};

function contextGaugeBarColor(level: ContextGaugeLevel): string {
  switch (level) {
    case "overflow":
      return "bg-red-600 dark:bg-red-500";
    case "compact":
      return "bg-orange-600 dark:bg-orange-400";
    case "warning":
      return "bg-amber-600 dark:bg-amber-400";
    case "normal":
      return "bg-emerald-600 dark:bg-emerald-400";
    default:
      return "bg-muted-foreground/40";
  }
}

function contextGaugeTextColor(level: ContextGaugeLevel): string {
  switch (level) {
    case "overflow":
      return "text-red-700 dark:text-red-300";
    case "compact":
      return "text-orange-700 dark:text-orange-300";
    case "warning":
      return "text-amber-700 dark:text-amber-300";
    default:
      return "text-foreground";
  }
}

export function PrismuxStatusBar() {
  const runtime = useOptionalPrismuxRuntime();
  const scrollStripRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const [visibility, setVisibility] = useState<StatusBarVisibility>(() =>
    loadStatusBarVisibility(),
  );
  const [usagePrefs, setUsagePrefs] = useState<StatusBarUsagePreferences>(() =>
    loadStatusBarUsagePreferences(),
  );
  const [usageOpen, setUsageOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [cacheOpen, setCacheOpen] = useState(false);
  const [portsOpen, setPortsOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ readonly x: number; readonly y: number } | null>(
    null,
  );
  const [overridePortsWorkspace, setOverridePortsWorkspace] = useState<string | null>(null);

  // Resolve current route thread & workspace root without touching ChatView.
  const routeParams = useRouterState({
    select: (state) => {
      const params = state.matches.at(-1)?.params as
        | Partial<Record<"environmentId" | "threadId", string | undefined>>
        | undefined;
      return {
        environmentId: params?.environmentId,
        threadId: params?.threadId,
      };
    },
  });
  const activeThreadRef = useMemo(
    () => resolveThreadRouteRef(routeParams),
    [routeParams.environmentId, routeParams.threadId],
  );
  const serverThreadProjection = useQuietThreadProjection(activeThreadRef);
  const serverProjection = serverThreadProjection?.projection ?? null;
  const serverVisibleTurnItems = useQuietThreadVisibleTurnItems(activeThreadRef);
  const activeProjectRef =
    serverProjection && activeThreadRef
      ? scopeProjectRef(activeThreadRef.environmentId, serverProjection.thread.projectId)
      : null;
  const activeProject = useProject(activeProjectRef);
  const activeWorkspaceRoot =
    overridePortsWorkspace ??
    serverProjection?.thread.worktreePath ??
    activeProject?.workspaceRoot ??
    null;

  const activeProviderThread = serverProjection?.providerThreads.find(
    (thread) => thread.id === serverProjection.thread.activeProviderThreadId,
  );
  const activeThreadLiveTokenUsage = useMemo(
    () =>
      latestProviderTurnTokenUsage(
        serverProjection?.providerTurns ?? [],
        serverProjection,
        activeProviderThread,
      ),
    [serverProjection, activeProviderThread],
  );
  const activeContextWindow = useMemo(
    () =>
      deriveLatestContextWindowSnapshot(
        serverVisibleTurnItems ?? [],
        activeThreadLiveTokenUsage,
        activeProviderThread,
      ),
    [serverVisibleTurnItems, activeThreadLiveTokenUsage, activeProviderThread],
  );

  // Collect providers across connected environments (read-only from existing client atoms).
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const allProviders = useMemo<readonly ServerProvider[]>(() => {
    const list: ServerProvider[] = [];
    for (const presentation of presentations.values()) {
      const providers = presentation.serverConfig?.providers;
      if (Array.isArray(providers)) {
        list.push(...providers);
      }
    }
    return list;
  }, [presentations]);

  const activeThreadProvider = useMemo(() => {
    const instanceId =
      activeProviderThread?.providerInstanceId ??
      serverProjection?.thread.modelSelection?.instanceId ??
      null;
    if (!instanceId) return null;
    return allProviders.find((p) => p.instanceId === instanceId) ?? null;
  }, [activeProviderThread, allProviders, serverProjection]);

  const usageResetTimes = useMemo(() => {
    const times: number[] = [];
    for (const provider of allProviders) {
      if (!provider.enabled || provider.driver === "antigravity") continue;
      const rawWindows = provider.usageLimits?.windows;
      if (!Array.isArray(rawWindows)) continue;
      for (const win of rawWindows) {
        if (typeof win.resetsAt === "string" && win.resetsAt.trim()) {
          const parsed = Date.parse(win.resetsAt);
          if (Number.isFinite(parsed)) {
            times.push(parsed);
          }
        }
      }
    }
    return times;
  }, [allProviders]);

  // Boundary-scheduled countdown clock (Orca `useResetCountdownClock`): ticks only at exact reset boundaries while popover is open.
  const now = useResetCountdownClock(usageOpen, usageResetTimes);

  const usageSummary = useMemo(
    () => collectStatusBarUsageSummary(allProviders, now),
    [allProviders, now],
  );
  const contextGauge = useMemo(
    () => deriveContextGaugeFromSnapshot(activeContextWindow),
    [activeContextWindow],
  );
  const promptCache = useMemo(
    () => derivePromptCacheSummary(activeContextWindow),
    [activeContextWindow],
  );
  const resourcesSummary = useMemo(
    () => normalizeResourcesSummary(runtime?.systemResources),
    [runtime?.systemResources],
  );

  // Respond to external requests from left sidebar port badges to open the Ports Popover.
  const lastPortsRequestIdRef = useRef<number>(0);
  const portsPopoverRequest = runtime?.portsPopoverRequest ?? null;
  useEffect(() => {
    if (!portsPopoverRequest || portsPopoverRequest.id === lastPortsRequestIdRef.current) {
      return;
    }
    lastPortsRequestIdRef.current = portsPopoverRequest.id;
    setOverridePortsWorkspace(portsPopoverRequest.workspace ?? null);
    setPortsOpen(true);
    void runtime?.refreshSystemPorts(portsPopoverRequest.workspace ?? undefined);
  }, [portsPopoverRequest, runtime]);

  // Dismiss custom right-click menu on outside pointerdown or Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [contextMenu]);

  const handleToggleSegment = useCallback((segment: StatusBarSegmentId) => {
    setVisibility((prev) => {
      const next = toggleStatusBarSegment(prev, segment);
      saveStatusBarVisibility(next);
      return next;
    });
  }, []);

  const handleResetVisibility = useCallback(() => {
    setVisibility({ ...DEFAULT_STATUS_BAR_VISIBILITY });
    saveStatusBarVisibility(DEFAULT_STATUS_BAR_VISIBILITY);
    setContextMenu(null);
  }, []);

  const handleUsagePrefsChange = useCallback((next: StatusBarUsagePreferences) => {
    setUsagePrefs(next);
    saveStatusBarUsagePreferences(next);
  }, []);

  // Native non-passive wheel listener (modeled after Orca StatusBarSurface.tsx):
  // Chromium treats React `onWheel` as passive, so `preventDefault()` requires `{ passive: false }`.
  useEffect(() => {
    const el = scrollStripRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      if (el.scrollWidth <= el.clientWidth + 1) return;
      let delta = event.deltaY;
      if (event.deltaMode === 1) delta *= 16;
      if (event.deltaMode === 2) delta *= el.clientWidth;
      const prevLeft = el.scrollLeft;
      el.scrollLeft += delta;
      if (el.scrollLeft !== prevLeft) {
        event.preventDefault();
      }
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
    };
  }, []);

  const handleContextMenuCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!shouldOpenStatusBarContextMenu(event.target)) {
      return;
    }
    event.preventDefault();
    const menuWidth = 192;
    const menuHeight = 230;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    const x = Math.max(8, Math.min(event.clientX, vw - menuWidth - 8));
    const y = Math.max(8, Math.min(event.clientY - menuHeight, vh - menuHeight - 8));
    setContextMenu({ x, y });
  }, []);

  const handlePortsOpenChange = useCallback(
    (open: boolean) => {
      setPortsOpen(open);
      if (open) {
        void runtime?.refreshSystemPorts(activeWorkspaceRoot ?? undefined);
      } else {
        setOverridePortsWorkspace(null);
      }
    },
    [activeWorkspaceRoot, runtime],
  );

  const handleResourcesOpenChange = useCallback(
    (open: boolean) => {
      setResourcesOpen(open);
      if (open) {
        void runtime?.refreshSystemResources();
      }
    },
    [runtime],
  );

  const handleOpenPortUrl = useCallback((url: string) => {
    try {
      const api = ensureLocalApi();
      void api.shell.openExternal(url).catch(() => {
        window.open(url, "_blank", "noopener,noreferrer");
      });
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, []);

  const portsCount = runtime?.portsState.ports.length ?? 0;
  const primaryUsage = usageSummary.primaryWindow;
  const antigravityPrimary = usageSummary.antigravityEntries[0] ?? null;

  return (
    <footer
      role="contentinfo"
      aria-label="Prismux 状态栏"
      data-prismux-status-bar="true"
      onContextMenuCapture={handleContextMenuCapture}
      className={cn(
        "relative z-[45] flex h-6 w-full shrink-0 select-none items-center overflow-clip [overflow-clip-margin:3px] border-t border-border/75 text-[11px] leading-none text-foreground",
        // Glass-aware translucency with guaranteed readable contrast & solid fallback on reduced-transparency / no-GPU / forced-colors.
        "bg-background/88 backdrop-blur-md",
        "[@media(prefers-reduced-transparency:reduce)]:bg-background [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none",
        "[html[data-prismux-gpu='0']_&]:bg-background [html[data-prismux-gpu='0']_&]:backdrop-blur-none",
        "[html[data-pmx-glass='1']_&]:bg-[color-mix(in_srgb,var(--prismux-glass-tint,var(--background))_max(var(--prismux-glass-sidebar-fill,78%),62%),transparent)]",
        "[@media(forced-colors:active)]:bg-[Canvas] [@media(forced-colors:active)]:text-[CanvasText]",
      )}
    >
      <div
        ref={scrollStripRef}
        data-testid="prismux-status-bar-strip"
        className="flex h-full min-w-0 flex-1 items-center justify-between gap-2 overflow-x-auto overflow-y-hidden px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {/* Left Zone: Compliant Usage + Context Gauge + Prompt Cache */}
        <div className="flex h-full shrink-0 items-center gap-1.5">
          {visibility.usage ? (
            <Popover open={usageOpen} onOpenChange={setUsageOpen}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    data-testid="status-bar-usage-trigger"
                    aria-label="打开合规额度与订阅详情"
                    className={cn(
                      "inline-flex h-5 cursor-pointer items-center gap-1 rounded-sm px-1.5 font-medium tabular-nums transition-colors hover:bg-accent/70 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                      primaryUsage?.urgency === "critical"
                        ? "text-red-700 dark:text-red-300"
                        : primaryUsage?.urgency === "warning"
                          ? "text-amber-700 dark:text-amber-300"
                          : "text-foreground",
                    )}
                  />
                }
              >
                {primaryUsage ? (
                  <>
                    <GaugeIcon aria-hidden className="size-3 shrink-0" />
                    <span className="max-w-28 truncate">{primaryUsage.providerName}</span>
                    <span>{formatCompactUsageWindowValue(primaryUsage, usagePrefs.percentMode)}</span>
                  </>
                ) : antigravityPrimary ? (
                  <>
                    <ShieldCheckIcon
                      aria-hidden
                      className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400"
                    />
                    <span className="max-w-36 truncate">
                      {antigravityPrimary.tierLabel
                        ? `AGY · ${antigravityPrimary.tierLabel}`
                        : "AGY · ACP"}
                    </span>
                  </>
                ) : (
                  <>
                    <GaugeIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">额度 —</span>
                  </>
                )}
              </PopoverTrigger>
              <PopoverPopup
                {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
                side="top"
                align="start"
                sideOffset={8}
                padding="none"
                className="border-0 bg-transparent shadow-none"
              >
                <UsageStatusPopover
                  summary={usageSummary}
                  activeThreadIsAntigravity={activeThreadProvider?.driver === "antigravity"}
                  contextGauge={contextGauge}
                  prefs={usagePrefs}
                  onPrefsChange={handleUsagePrefsChange}
                  now={now}
                  onClose={() => setUsageOpen(false)}
                />
              </PopoverPopup>
            </Popover>
          ) : null}

          {visibility.context ? (
            <Popover open={contextOpen} onOpenChange={setContextOpen}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    data-testid="status-bar-context-trigger"
                    data-context-level={contextGauge.level}
                    aria-label={`上下文水位 ${contextGauge.label}`}
                    className={cn(
                      "inline-flex h-5 cursor-pointer items-center gap-1.5 rounded-sm px-1.5 font-medium tabular-nums transition-colors hover:bg-accent/70 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                      contextGaugeTextColor(contextGauge.level),
                    )}
                  />
                }
              >
                {contextGauge.level === "overflow" ? (
                  <AlertTriangleIcon aria-hidden className="size-3 shrink-0" />
                ) : (
                  <LayersIcon aria-hidden className="size-3 shrink-0" />
                )}
                <span>{contextGauge.label}</span>
                <span
                  aria-hidden
                  className="relative inline-block h-[3px] w-10 overflow-hidden rounded-full bg-muted-foreground/30"
                >
                  <span
                    className={cn(
                      "block h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none",
                      contextGaugeBarColor(contextGauge.level),
                    )}
                    style={{ width: `${contextGauge.barFillPercent}%` }}
                  />
                  {contextGauge.compactionBoundaryPercent !== null ? (
                    <span
                      className="pointer-events-none absolute top-0 bottom-0 w-px bg-foreground/65"
                      style={{ left: `${contextGauge.compactionBoundaryPercent}%` }}
                    />
                  ) : null}
                </span>
              </PopoverTrigger>
              <PopoverPopup
                {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
                side="top"
                align="start"
                sideOffset={8}
                padding="none"
                className="border-0 bg-transparent shadow-none"
              >
                <div
                  {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
                  className="flex w-72 flex-col gap-2 rounded-xl border border-border bg-popover p-3 text-xs text-popover-foreground shadow-xl"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">当前会话上下文水位</span>
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        contextGaugeTextColor(contextGauge.level),
                      )}
                    >
                      {contextGauge.displayPercent !== null
                        ? `${contextGauge.displayPercent}%`
                        : "未告知"}
                    </span>
                  </div>
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        contextGaugeBarColor(contextGauge.level),
                      )}
                      style={{ width: `${contextGauge.barFillPercent}%` }}
                    />
                    {contextGauge.compactionBoundaryPercent !== null ? (
                      <div
                        aria-hidden
                        title={`自动压缩阈值 ${Math.round(contextGauge.compactionBoundaryPercent)}%`}
                        className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-foreground/70"
                        style={{ left: `${contextGauge.compactionBoundaryPercent}%` }}
                      />
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                    <span>
                      已用：
                      {contextGauge.usedTokens !== null
                        ? formatContextWindowTokens(contextGauge.usedTokens)
                        : "未告知"}
                    </span>
                    <span>
                      上限：
                      {contextGauge.maxTokens !== null
                        ? formatContextWindowTokens(contextGauge.maxTokens)
                        : "未告知"}
                    </span>
                  </div>
                  {contextGauge.advice ? (
                    <div
                      role={contextGauge.level === "overflow" ? "alert" : undefined}
                      className={cn(
                        "rounded-md border px-2 py-1.5 text-[11px]",
                        contextGauge.level === "overflow"
                          ? "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300"
                          : contextGauge.level === "compact"
                            ? "border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-300"
                            : "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300",
                      )}
                    >
                      {contextGauge.advice}
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground">
                      阈值：&lt;60% 正常 · 60% 预警 · 95% 建议压缩 · &gt;100% 溢出标红
                    </div>
                  )}
                </div>
              </PopoverPopup>
            </Popover>
          ) : null}

          {visibility.cache ? (
            <Popover open={cacheOpen} onOpenChange={setCacheOpen}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    data-testid="status-bar-cache-badge"
                    data-cache-state={promptCache.state}
                    title={`${promptCache.brief[0]} — ${promptCache.brief[1]}`}
                    aria-label={`Prompt Cache：${promptCache.brief[0]}`}
                    className={cn(
                      "inline-flex h-5 cursor-pointer items-center gap-1 rounded-sm px-1.5 font-medium tabular-nums transition-colors hover:bg-accent/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                      promptCache.state === "hit"
                        ? "bg-emerald-600/15 text-emerald-800 dark:bg-emerald-400/18 dark:text-emerald-200"
                        : promptCache.state === "miss"
                          ? "text-muted-foreground line-through decoration-current"
                          : "text-muted-foreground",
                    )}
                  />
                }
              >
                <DatabaseZapIcon aria-hidden className="size-3 shrink-0" />
                <span>
                  {promptCache.state === "hit"
                    ? `Cache ${promptCache.hitRatePercent ?? 0}%`
                    : promptCache.state === "miss"
                      ? "Cache Miss"
                      : "Cache —"}
                </span>
              </PopoverTrigger>
              <PopoverPopup
                {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
                side="top"
                align="start"
                sideOffset={8}
                padding="none"
                className="border-0 bg-transparent shadow-none"
              >
                <div
                  {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
                  data-testid="prismux-cache-popover"
                  className="flex w-72 flex-col gap-2 rounded-xl border border-border bg-popover p-3 text-xs text-popover-foreground shadow-xl"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">Prompt Cache 本地统计</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        promptCache.state === "hit"
                          ? "bg-emerald-600/15 text-emerald-800 dark:bg-emerald-400/18 dark:text-emerald-200"
                          : promptCache.state === "miss"
                            ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {promptCache.state === "hit"
                        ? "Warm"
                        : promptCache.state === "miss"
                          ? "Cold"
                          : "Idle"}
                    </span>
                  </div>
                  <div className="text-[11px] leading-relaxed text-muted-foreground">
                    <div>{promptCache.brief[0]}</div>
                    <div>{promptCache.brief[1]}</div>
                  </div>
                  <div className="flex flex-col gap-1 border-t border-border/60 pt-2 text-[11px] tabular-nums">
                    {promptCache.details.map((row) => (
                      <div key={row.label} className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">{row.label}</span>
                        <span
                          className={cn(
                            "font-medium",
                            row.tone === "warning"
                              ? "text-amber-700 dark:text-amber-300"
                              : "text-foreground",
                          )}
                        >
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </PopoverPopup>
            </Popover>
          ) : null}
        </div>

        {/* Right Zone: Ports Capsule + CPU/RAM Capsule */}
        <div className="flex h-full shrink-0 items-center gap-1.5">
          {visibility.ports ? (
            <Popover open={portsOpen} onOpenChange={handlePortsOpenChange}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    data-testid="status-bar-ports-trigger"
                    aria-label={`本机监听端口，共 ${portsCount} 个`}
                    className={cn(
                      "inline-flex h-5 cursor-pointer items-center gap-1 rounded-sm px-1.5 font-medium tabular-nums transition-colors hover:bg-accent/70 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                      portsCount > 0 ? "text-foreground" : "text-muted-foreground",
                    )}
                  />
                }
              >
                <NetworkIcon
                  aria-hidden
                  className={cn(
                    "size-3 shrink-0",
                    portsCount > 0 && "text-emerald-600 dark:text-emerald-400",
                  )}
                />
                <span>Ports ({portsCount})</span>
              </PopoverTrigger>
              <PopoverPopup
                {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
                side="top"
                align="end"
                sideOffset={8}
                padding="none"
                className="border-0 bg-transparent shadow-none"
              >
                <PortsStatusPopover
                  state={runtime?.portsState ?? { ports: [], loading: false, error: null, failureStreak: 0, lastScannedAt: null }}
                  activeWorkspaceRoot={activeWorkspaceRoot}
                  daemonReady={Boolean(runtime?.daemonInfo.ready)}
                  onRefresh={() =>
                    runtime?.refreshSystemPorts(activeWorkspaceRoot ?? undefined) ??
                    Promise.resolve()
                  }
                  onKillPort={(pid) =>
                    runtime
                      ? runtime.killSystemPort(pid)
                      : Promise.resolve({ ok: false, error: "Daemon 未连接" })
                  }
                  onOpenUrl={handleOpenPortUrl}
                />
              </PopoverPopup>
            </Popover>
          ) : null}

          {visibility.resources ? (
            <Popover open={resourcesOpen} onOpenChange={handleResourcesOpenChange}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    data-testid="status-bar-resources-trigger"
                    aria-label="打开 CPU 与内存资源归因详情"
                    className="inline-flex h-5 cursor-pointer items-center gap-1 rounded-sm px-1.5 font-medium text-foreground tabular-nums transition-colors hover:bg-accent/70 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  />
                }
              >
                <CpuIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                <span>
                  CPU {formatCpuPercent(resourcesSummary.cpuPercent)} ·{" "}
                  {formatBytesCompact(resourcesSummary.memoryBytes)}
                </span>
              </PopoverTrigger>
              <PopoverPopup
                {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
                side="top"
                align="end"
                sideOffset={8}
                padding="none"
                className="border-0 bg-transparent shadow-none"
              >
                <ResourcesStatusPopover
                  raw={runtime?.systemResources ?? null}
                  loading={Boolean(runtime?.resourcesLoading)}
                  error={runtime?.resourcesError ?? null}
                  daemonReady={Boolean(runtime?.daemonInfo.ready)}
                  onRefresh={() => runtime?.refreshSystemResources() ?? Promise.resolve()}
                  onKillPty={(sessionId) =>
                    runtime
                      ? runtime.killStalePty(sessionId)
                      : Promise.resolve({ ok: false, sessionId, error: "Daemon 未连接" })
                  }
                />
              </PopoverPopup>
            </Popover>
          ) : null}
        </div>
      </div>

      {/* Right-click segment visibility menu */}
      {contextMenu ? (
        <div
          ref={contextMenuRef}
          {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
          role="menu"
          aria-label="状态栏分段显隐设置"
          data-testid="prismux-status-bar-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          className="fixed z-50 w-48 rounded-lg border border-border bg-popover p-1 text-xs text-popover-foreground shadow-xl"
        >
          <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">
            状态栏分段显隐
          </div>
          {STATUS_BAR_SEGMENT_IDS.map((segmentId) => {
            const checked = visibility[segmentId];
            return (
              <button
                key={segmentId}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                onClick={() => handleToggleSegment(segmentId)}
                className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              >
                <span>{SEGMENT_LABELS[segmentId]}</span>
                <span
                  aria-hidden
                  className={cn(
                    "inline-flex size-3.5 items-center justify-center rounded-xs border",
                    checked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background",
                  )}
                >
                  {checked ? <CheckIcon className="size-2.5" /> : null}
                </span>
              </button>
            );
          })}
          <div className="my-1 h-px bg-border/70" />
          <button
            type="button"
            role="menuitem"
            onClick={handleResetVisibility}
            className="flex w-full cursor-pointer items-center rounded-md px-2 py-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            全部恢复显示
          </button>
        </div>
      ) : null}
    </footer>
  );
}
