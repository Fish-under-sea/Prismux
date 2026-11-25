import type { ThreadId } from "@prismux/core-contracts";
import {
  ArrowDownIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  ListChecksIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SlidersHorizontalIcon,
  StepBackIcon,
  StepForwardIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { AgentBrandLogo } from "../agentBrand";
import {
  computeHiveLayout,
  computeMentionGraphLayout,
  formatAuxClockTime,
  formatAuxStatusLabel,
  formatAuxTaskStatusLabel,
  tokenizeBoardText,
  type AgentAuxBoardMessage,
  type AgentAuxMember,
  type AgentAuxTabId,
  type AgentAuxViewModel,
} from "./agentAux.logic";
import {
  AgentMemberAvatar,
  SwarmBeeSprite,
  SwarmMiniCluster,
  toPixelBeeState,
} from "./SwarmBeeSprite";
import "./agentAux.css";

export interface AgentAuxOverviewEntryData {
  readonly active: boolean;
  readonly hasLiveActivity: boolean;
  readonly kind: AgentAuxViewModel["kind"];
  readonly providerBrand: AgentAuxViewModel["providerBrand"];
  readonly title: string;
  readonly badgeLabel: string;
  readonly entryLabel: string;
  readonly activeCount: number;
  readonly memberCount: number;
  readonly statusLine: string;
}

export function toAgentAuxOverviewEntry(
  model: AgentAuxViewModel | null | undefined,
): AgentAuxOverviewEntryData | null {
  if (!model || !model.active) return null;
  const nonSystemCount = model.members.filter((m) => !m.isSystem).length;
  return {
    active: true,
    hasLiveActivity: model.hasLiveActivity,
    kind: model.kind,
    providerBrand: model.providerBrand,
    title: model.title,
    badgeLabel: model.badgeLabel,
    entryLabel: model.entryLabel,
    activeCount: model.activeCount,
    memberCount: nonSystemCount,
    statusLine: model.statusLine,
  };
}

/**
 * Clickable entry row rendered right below "在终端继续" inside SessionOverviewPanel.
 * Renders nothing (`null`) when the thread has no active or inspectable multi-agent session.
 */
export function AgentAuxOverviewEntryButton(props: {
  readonly entry: AgentAuxOverviewEntryData | null | undefined;
  readonly onOpen: (() => void) | undefined;
}) {
  const { entry, onOpen } = props;
  if (!entry?.active || !onOpen) return null;

  const badgeText =
    entry.activeCount > 0
      ? `${entry.activeCount} 活跃`
      : entry.memberCount > 0
        ? `${entry.memberCount} 成员`
        : "查看";

  return (
    <button
      type="button"
      data-overview-action="agent-aux"
      data-agent-aux-kind={entry.kind ?? undefined}
      aria-label={entry.entryLabel}
      title={entry.statusLine || entry.badgeLabel}
      onClick={onOpen}
      className="group flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-left text-[13px] font-medium text-foreground/90 transition-colors hover:bg-black/[0.045] dark:hover:bg-white/[0.08]"
    >
      <span className="inline-flex size-4 shrink-0 items-center justify-center">
        {entry.kind === "agy-swarm" ? (
          <span aria-hidden="true" className="text-[14px] leading-none">
            🐝
          </span>
        ) : (
          <AgentBrandLogo
            provider={entry.providerBrand}
            size={15}
            online={entry.hasLiveActivity}
            breathing={entry.hasLiveActivity}
          />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{entry.entryLabel}</span>
      <span
        className={
          entry.hasLiveActivity
            ? "inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300"
            : "inline-flex shrink-0 items-center rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground dark:bg-white/[0.08]"
        }
      >
        {entry.hasLiveActivity ? (
          <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        ) : null}
        {badgeText}
      </span>
      <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

export interface AgentAuxPanelProps {
  readonly model: AgentAuxViewModel | null;
  readonly isLoading?: boolean | undefined;
  readonly onRefresh?: (() => void) | undefined;
  readonly onOpenChildThread?: ((threadId: ThreadId) => void) | undefined;
  readonly initialTab?: AgentAuxTabId | undefined;
}

const SPEED_OPTIONS = [0.5, 1, 2, 4] as const;

export function AgentAuxPanel(props: AgentAuxPanelProps) {
  const { model, isLoading = false, onRefresh, onOpenChildThread, initialTab } = props;

  const [selectedTab, setSelectedTab] = useState<AgentAuxTabId>(
    initialTab ?? model?.defaultTab ?? "overview",
  );
  const [boardSearch, setBoardSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [senderFilter, setSenderFilter] = useState("");
  const [recipientFilter, setRecipientFilter] = useState("");
  const [hiddenMembers, setHiddenMembers] = useState<ReadonlySet<string>>(() => new Set());
  const [autoFollow, setAutoFollow] = useState(true);
  const [showJumpBottom, setShowJumpBottom] = useState(false);
  const [flashSeq, setFlashSeq] = useState<number | null>(null);

  const [memberSearch, setMemberSearch] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [expandedStepMemberIds, setExpandedStepMemberIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [progressExpanded, setProgressExpanded] = useState(false);
  const [selectedTeamMember, setSelectedTeamMember] = useState<string | null>(null);

  const [graphMode, setGraphMode] = useState<"hive" | "mentions">("hive");
  const [replaySeq, setReplaySeq] = useState<number | null>(null);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState<(typeof SPEED_OPTIONS)[number]>(1);
  const [hideInactive, setHideInactive] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const [selectedHiveCellId, setSelectedHiveCellId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const graphContainerRef = useRef<HTMLDivElement | null>(null);
  const [graphWidth, setGraphWidth] = useState(360);

  // Sync valid active tab when model tabs change
  const activeTab: AgentAuxTabId = useMemo(() => {
    if (!model || !model.active || model.tabs.length === 0) return "overview";
    if (model.tabs.some((t) => t.id === selectedTab)) return selectedTab;
    return model.defaultTab;
  }, [model, selectedTab]);

  // Measure graph container width responsively
  useEffect(() => {
    const el = graphContainerRef.current;
    if (!el) return;
    const update = () => {
      if (el.clientWidth > 0) setGraphWidth(el.clientWidth);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeTab]);

  // Replay timer loop
  const replayableMessages = useMemo(
    () => (model?.messages ?? []).filter((m) => !m.isControl),
    [model?.messages],
  );

  useEffect(() => {
    if (!isReplaying || replayableMessages.length === 0) return;
    const delayMs = Math.max(220, Math.round(900 / replaySpeed));
    const timer = window.setInterval(() => {
      setReplaySeq((prev) => {
        const currentIdx =
          prev === null
            ? -1
            : replayableMessages.findIndex((m) => m.seq >= prev);
        const nextIdx = currentIdx + 1;
        if (nextIdx >= replayableMessages.length) {
          setIsReplaying(false);
          return null;
        }
        return replayableMessages[nextIdx]?.seq ?? null;
      });
    }, delayMs);
    return () => window.clearInterval(timer);
  }, [isReplaying, replaySpeed, replayableMessages]);

  // Clear flash highlight after animation
  useEffect(() => {
    if (flashSeq === null) return;
    const timer = window.setTimeout(() => setFlashSeq(null), 1700);
    return () => window.clearTimeout(timer);
  }, [flashSeq]);

  const jumpToSeq = useCallback((seq: number) => {
    setSelectedTab("board");
    setBoardSearch("");
    setSenderFilter("");
    setRecipientFilter("");
    setHiddenMembers(new Set());
    setFlashSeq(seq);
    window.requestAnimationFrame(() => {
      const target = scrollRef.current?.querySelector<HTMLElement>(
        `[data-board-seq="${seq}"]`,
      );
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || activeTab !== "board") {
      setShowJumpBottom(false);
      return;
    }
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJumpBottom(distance > 90);
  }, [activeTab]);

  // Auto-follow newest board posts when enabled
  useEffect(() => {
    if (activeTab !== "board" || !autoFollow) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activeTab, autoFollow, model?.messageCount]);

  const handleTabKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
      if (!model || model.tabs.length === 0) return;
      let nextIdx = idx;
      if (e.key === "ArrowRight") nextIdx = (idx + 1) % model.tabs.length;
      else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + model.tabs.length) % model.tabs.length;
      else if (e.key === "Home") nextIdx = 0;
      else if (e.key === "End") nextIdx = model.tabs.length - 1;
      else return;
      e.preventDefault();
      const targetTab = model.tabs[nextIdx];
      if (targetTab) setSelectedTab(targetTab.id);
    },
    [model],
  );

  if (!model || !model.active) {
    return (
      <div className="pmx-aux-pane" data-pmx-glass-zone="rightSidebar" data-agent-aux-empty="1">
        <div className="pmx-aux-header">
          <div className="pmx-aux-header-row">
            <span className="pmx-aux-brand-mark" aria-hidden="true">
              🐝
            </span>
            <h2 className="pmx-aux-title">智能体协同侧边栏</h2>
            {onRefresh ? (
              <button
                type="button"
                className="pmx-aux-icon-btn"
                onClick={onRefresh}
                disabled={isLoading}
                title="刷新"
                aria-label="刷新"
              >
                <RefreshCwIcon className={isLoading ? "size-3.5 animate-spin" : "size-3.5"} />
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
          <p className="text-[13px] font-medium text-foreground">当前会话未检测到活跃协同</p>
          <p className="max-w-[240px] text-[12px] leading-relaxed">
            当 Antigravity 蜂群、Claude 智能体团队或 Codex 子代理启动时，此只读侧边栏将自动呈现实时协作视图。
          </p>
        </div>
      </div>
    );
  }

  const useBees = model.kind === "agy-swarm";
  const teamMembers = model.members.filter((m) => !m.isSystem);
  const knownNames = new Set(teamMembers.map((m) => m.name));
  const coordinator = teamMembers.find((m) => m.isCoordinator) ?? null;
  const workerMembers = teamMembers.filter((m) => !m.isCoordinator);

  // Filtered messages for Board tab
  const activeFilterCount =
    (boardSearch.trim() ? 1 : 0) +
    (senderFilter ? 1 : 0) +
    (recipientFilter ? 1 : 0) +
    (hiddenMembers.size > 0 ? 1 : 0);

  const filteredMessages = model.messages.filter((msg) => {
    if (hiddenMembers.has(msg.agent)) return false;
    if (senderFilter && msg.agent !== senderFilter) return false;
    if (recipientFilter) {
      if (recipientFilter === "__all__") {
        if (!msg.all) return false;
      } else if (
        msg.recipient !== recipientFilter &&
        !msg.mentions.includes(recipientFilter) &&
        !msg.all
      ) {
        return false;
      }
    }
    if (boardSearch.trim()) {
      const q = boardSearch.trim().toLowerCase();
      const hay = `${msg.agent} ${msg.recipient ?? ""} #${msg.seq} ${msg.text} ${msg.summary ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const firstUnreadSeq = filteredMessages.find((m) => m.isUnread)?.seq ?? null;

  // Grouped members for Members tab
  const memberQuery = memberSearch.trim().toLowerCase();
  const matchingMembers = teamMembers.filter((m) => {
    if (!memberQuery) return true;
    return `${m.name} ${m.displayName} ${m.roleLabel} ${m.title} ${m.model} ${m.activity}`
      .toLowerCase()
      .includes(memberQuery);
  });
  const activeMembers = matchingMembers.filter(
    (m) => !m.killed && (m.status === "working" || m.status === "needs_you"),
  );
  const waitingMembers = matchingMembers.filter(
    (m) => !m.killed && (m.status === "parked" || m.status === "waiting_on" || m.status === "error"),
  );
  const doneMembers = matchingMembers.filter((m) => !m.killed && m.status === "done");
  const retiredMembers = matchingMembers.filter((m) => m.killed);

  // Overview progress calculations
  const totalWs = model.workstreams.length;
  const doneWs = model.workstreams.filter((w) => w.state === "done");
  const runningWs = model.workstreams.filter((w) => w.state === "running" || w.state === "review");
  const blockedWs = model.workstreams.filter((w) => w.state === "blocked");
  const queuedWs = model.workstreams.filter((w) => w.state === "queued");

  const ringCircumference = 2 * Math.PI * 7;
  const doneRatio = totalWs > 0 ? doneWs.length / totalWs : 0;
  const runRatio = totalWs > 0 ? runningWs.length / totalWs : 0;
  const blkRatio = totalWs > 0 ? blockedWs.length / totalWs : 0;

  // Graph layouts (computed only when graph tab active)
  const hiveLayout =
    activeTab === "graph" && graphMode === "hive"
      ? computeHiveLayout({
          model,
          containerWidth: graphWidth,
          replaySeq,
          hideInactive,
        })
      : null;

  const mentionGraph =
    activeTab === "graph" && graphMode === "mentions"
      ? computeMentionGraphLayout({
          model,
          width: graphWidth,
          replaySeq,
          hideInactive,
          expandAll,
        })
      : null;

  const selectedHiveCell =
    hiveLayout?.cells.find((c) => c.id === selectedHiveCellId) ?? null;

  const currentReplayIndex =
    replaySeq === null
      ? replayableMessages.length - 1
      : Math.max(
          0,
          replayableMessages.findIndex((m) => m.seq >= replaySeq),
        );
  const currentReplayMsg = replayableMessages[currentReplayIndex] ?? null;

  const toggleMemberSteps = (id: string) => {
    setExpandedStepMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      className="pmx-aux-pane"
      data-pmx-glass-zone="rightSidebar"
      data-agent-aux-kind={model.kind ?? undefined}
    >
      {/* Sticky Header + Tabs */}
      <header className="pmx-aux-header">
        <div className="pmx-aux-header-row">
          <span className="pmx-aux-brand-mark" aria-hidden="true">
            {useBees ? (
              "🐝"
            ) : (
              <AgentBrandLogo
                provider={model.providerBrand}
                size={16}
                online={model.hasLiveActivity}
                breathing={model.hasLiveActivity}
              />
            )}
          </span>
          <h2 className="pmx-aux-title" title={model.title}>
            {model.title || model.badgeLabel}
          </h2>
          <span
            className={
              model.hasLiveActivity ? "pmx-aux-live" : "pmx-aux-live pmx-aux-live--idle"
            }
          >
            <i className="pmx-aux-live-dot" aria-hidden="true" />
            {model.hasLiveActivity ? "实时" : "已完成"}
          </span>
          {onRefresh ? (
            <button
              type="button"
              className="pmx-aux-icon-btn"
              onClick={onRefresh}
              disabled={isLoading}
              title="刷新状态"
              aria-label="刷新状态"
            >
              <RefreshCwIcon className={isLoading ? "size-3.5 animate-spin" : "size-3.5"} />
            </button>
          ) : null}
        </div>

        <div className="pmx-aux-subline">
          <span className="pmx-aux-subline-text">{model.statusLine}</span>
          <span className="shrink-0 rounded bg-black/[0.05] px-1.5 py-0.2 text-[10px] text-muted-foreground dark:bg-white/[0.08]">
            只读
          </span>
        </div>

        <nav className="pmx-aux-tabs" role="tablist" aria-label="智能体协同视图">
          {model.tabs.map((tab, idx) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`pmx-aux-tab-${tab.id}`}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                className={isActive ? "pmx-aux-tab pmx-aux-tab--active" : "pmx-aux-tab"}
                onClick={() => setSelectedTab(tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
              >
                <span>{tab.label}</span>
                {typeof tab.count === "number" && tab.count > 0 ? (
                  <span className="pmx-aux-tab-count">{tab.count}</span>
                ) : null}
                {typeof tab.badge === "number" && tab.badge > 0 ? (
                  <span className="pmx-aux-tab-badge">{tab.badge}</span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Scrollable Body */}
      <div
        ref={scrollRef}
        className="pmx-aux-scroll"
        onScroll={handleScroll}
        role="tabpanel"
        aria-labelledby={`pmx-aux-tab-${activeTab}`}
      >
        {/* ===================== OVERVIEW TAB ===================== */}
        {activeTab === "overview" ? (
          <div className="pmx-aux-stack" data-aux-section="overview">
            {model.goal ? (
              <section className="pmx-aux-card">
                <div className="pmx-aux-kicker">目标</div>
                <p className="pmx-aux-goal-title">{model.goal.title}</p>
                {model.goal.line ? (
                  <p className="pmx-aux-goal-line">{model.goal.line}</p>
                ) : null}
              </section>
            ) : null}

            {/* Expandable Donut Progress Card */}
            {totalWs > 0 ? (
              <section className="pmx-aux-prog">
                <button
                  type="button"
                  className="pmx-aux-prog-head"
                  aria-expanded={progressExpanded}
                  onClick={() => setProgressExpanded((v) => !v)}
                >
                  <svg className="pmx-aux-ring" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <circle
                      className="pmx-aux-ring-trk"
                      cx="9"
                      cy="9"
                      r="7"
                      fill="none"
                      strokeWidth="2.5"
                    />
                    {doneRatio > 0 ? (
                      <circle
                        className="pmx-aux-ring-done"
                        cx="9"
                        cy="9"
                        r="7"
                        fill="none"
                        strokeWidth="2.5"
                        strokeDasharray={`${doneRatio * ringCircumference} ${ringCircumference}`}
                      />
                    ) : null}
                    {runRatio > 0 ? (
                      <circle
                        className="pmx-aux-ring-run"
                        cx="9"
                        cy="9"
                        r="7"
                        fill="none"
                        strokeWidth="2.5"
                        strokeDasharray={`${runRatio * ringCircumference} ${ringCircumference}`}
                        strokeDashoffset={-doneRatio * ringCircumference}
                      />
                    ) : null}
                    {blkRatio > 0 ? (
                      <circle
                        className="pmx-aux-ring-blk"
                        cx="9"
                        cy="9"
                        r="7"
                        fill="none"
                        strokeWidth="2.5"
                        strokeDasharray={`${blkRatio * ringCircumference} ${ringCircumference}`}
                        strokeDashoffset={-(doneRatio + runRatio) * ringCircumference}
                      />
                    ) : null}
                  </svg>
                  <span className="tabular-nums">
                    已完成 <strong className="font-semibold text-foreground">{doneWs.length}</strong> / 共{" "}
                    {totalWs} 项
                  </span>
                  <span className="ml-auto inline-flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    {runningWs.length > 0 ? <span>{runningWs.length} 进行中</span> : null}
                    {blockedWs.length > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        {blockedWs.length} 阻塞
                      </span>
                    ) : null}
                    <ChevronDownIcon
                      className={
                        progressExpanded
                          ? "size-3.5 rotate-180 transition-transform"
                          : "size-3.5 transition-transform"
                      }
                    />
                  </span>
                </button>
                {progressExpanded ? (
                  <div className="pmx-aux-prog-body">
                    {doneWs.length === 0 && queuedWs.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground">暂无已完成或排队任务</p>
                    ) : (
                      <>
                        {doneWs.map((ws) => (
                          <div key={ws.id} className="flex items-center gap-2 text-[12px]">
                            <span className="pmx-aux-ti pmx-aux-ti--done" aria-hidden="true">
                              ✓
                            </span>
                            <span className="min-w-0 flex-1 truncate text-foreground">
                              {ws.title}
                            </span>
                            {ws.owners[0] ? (
                              <span className="text-[11px] text-muted-foreground">
                                @{ws.owners[0]}
                              </span>
                            ) : null}
                          </div>
                        ))}
                        {queuedWs.map((ws) => (
                          <div key={ws.id} className="flex items-center gap-2 text-[12px]">
                            <span className="pmx-aux-ti pmx-aux-ti--queued" aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">
                              {ws.title}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                ) : null}
              </section>
            ) : null}

            {/* Attention / Needs You Branch */}
            {model.attention.length > 0 ? (
              <section className="pmx-aux-branch pmx-aux-branch--needs">
                <h3 className="pmx-aux-branch-head">
                  <i className="pmx-aux-branch-dot" aria-hidden="true" />
                  <span>需你介入</span>
                  <span className="font-normal text-muted-foreground">
                    {model.attention.length}
                  </span>
                </h3>
                <div className="flex flex-col gap-2">
                  {model.attention.map((att) => (
                    <div key={att.id} className="pmx-aux-branch-card">
                      <div className="flex items-start justify-between gap-2">
                        <strong className="text-[12.5px] font-semibold text-foreground">
                          {att.title}
                        </strong>
                        {att.seq !== null ? (
                          <button
                            type="button"
                            className="pmx-aux-seq-pill"
                            onClick={() => jumpToSeq(att.seq!)}
                          >
                            #{att.seq}
                          </button>
                        ) : null}
                      </div>
                      {att.why ? (
                        <p className="mt-1 text-[12px] text-muted-foreground">{att.why}</p>
                      ) : null}
                      <div className="mt-1.5 text-[11px] text-muted-foreground">
                        来自 @{att.from}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {/* Active Workstreams */}
            {runningWs.length > 0 || blockedWs.length > 0 ? (
              <section className="pmx-aux-card">
                <div className="pmx-aux-run-head">
                  <i className="pmx-aux-run-dot" aria-hidden="true" />
                  <strong className="font-semibold">进行中任务</strong>
                  <span className="text-[11.5px] text-muted-foreground tabular-nums">
                    {runningWs.length + blockedWs.length}
                  </span>
                  {model.phase ? (
                    <span className="pmx-aux-phase-pill">
                      {model.phase.label} · {model.phase.index}/{model.phase.total}
                    </span>
                  ) : null}
                </div>
                {model.headline ? (
                  <p className="mt-1.5 text-[12px] text-muted-foreground">{model.headline}</p>
                ) : null}
                <ul className="pmx-aux-run-list">
                  {[...blockedWs, ...runningWs].map((ws) => (
                    <li key={ws.id} className="pmx-aux-run-row">
                      <span
                        className={`pmx-aux-ti pmx-aux-ti--${ws.state === "blocked" ? "blocked" : "running"}`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-foreground">
                            {ws.title}
                          </span>
                          {ws.progress ? (
                            <span className="rounded-full bg-primary/12 px-1.5 py-0.5 text-[10.5px] text-primary tabular-nums">
                              {ws.progress.label}
                            </span>
                          ) : null}
                          {ws.seq > 0 && model.messages.length > 0 ? (
                            <button
                              type="button"
                              className="pmx-aux-seq-pill"
                              onClick={() => jumpToSeq(ws.seq)}
                            >
                              #{ws.seq}
                            </button>
                          ) : null}
                        </div>
                        {ws.note ? (
                          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                            {ws.note}
                          </p>
                        ) : null}
                        {ws.owners.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {ws.owners.slice(0, 3).map((ownerName) => {
                              const ownerObj = teamMembers.find((m) => m.name === ownerName);
                              return (
                                <span key={ownerName} className="pmx-aux-wchip">
                                  {useBees ? (
                                    <SwarmBeeSprite
                                      name={ownerName}
                                      state={toPixelBeeState(ownerObj?.status ?? "working")}
                                      scale={1}
                                    />
                                  ) : null}
                                  <span>@{ownerName}</span>
                                </span>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Team Tile Strip (Coordinator + Workers) */}
            {teamMembers.length > 0 ? (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[12.5px] font-semibold text-foreground">
                    协同团队{" "}
                    <span className="font-normal text-muted-foreground">
                      {teamMembers.length}
                    </span>
                  </h3>
                  <button
                    type="button"
                    className="pmx-aux-btn"
                    onClick={() => setSelectedTab("members")}
                  >
                    查看全部成员
                  </button>
                </div>

                {coordinator ? (
                  <div className="pmx-aux-lead">
                    <AgentMemberAvatar
                      useBees={useBees}
                      providerBrand={model.providerBrand}
                      name={coordinator.name}
                      displayName={coordinator.displayName}
                      status={coordinator.status}
                      color={coordinator.color}
                      size="lg"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <strong className="truncate text-[13.5px] font-semibold">
                          {coordinator.displayName}
                        </strong>
                        <span className="rounded-full bg-primary/12 px-1.5 py-0.5 text-[10.5px] text-primary">
                          {coordinator.roleLabel}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                        {coordinator.nowLine}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                        <span>{formatAuxStatusLabel(coordinator.status)}</span>
                        {coordinator.model ? <span>· {coordinator.model}</span> : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {workerMembers.length > 0 ? (
                  <div className="pmx-aux-crew">
                    {useBees && workerMembers.length > 1 ? (
                      <button
                        type="button"
                        className={
                          selectedTeamMember === null
                            ? "pmx-aux-crew-btn pmx-aux-crew-btn--on"
                            : "pmx-aux-crew-btn"
                        }
                        onClick={() => {
                          setSelectedTeamMember(null);
                          setSenderFilter("");
                        }}
                      >
                        <SwarmMiniCluster names={teamMembers.map((m) => m.name)} />
                        <span className="pmx-aux-crew-name">全部</span>
                      </button>
                    ) : null}
                    {workerMembers.slice(0, 8).map((member) => {
                      const isSel = selectedTeamMember === member.name;
                      return (
                        <button
                          key={member.id}
                          type="button"
                          className={
                            isSel
                              ? "pmx-aux-crew-btn pmx-aux-crew-btn--on"
                              : "pmx-aux-crew-btn"
                          }
                          title={`${member.displayName} · ${member.statusLabel}`}
                          onClick={() => {
                            setSelectedTeamMember(isSel ? null : member.name);
                            if (model.messages.length > 0) {
                              setSenderFilter(isSel ? "" : member.name);
                              setSelectedTab("board");
                            } else {
                              setSelectedTab("members");
                            }
                          }}
                        >
                          <AgentMemberAvatar
                            useBees={useBees}
                            providerBrand={model.providerBrand}
                            name={member.name}
                            displayName={member.displayName}
                            status={member.status}
                            color={member.color}
                            size="sm"
                          />
                          <span className="pmx-aux-crew-name">{member.displayName}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : null}

        {/* ===================== BOARD TAB ===================== */}
        {activeTab === "board" ? (
          <div data-aux-section="board">
            <div className="pmx-aux-toolbar">
              <div className="pmx-aux-search-row">
                <label className="pmx-aux-search">
                  <SearchIcon className="size-3.5 shrink-0" />
                  <input
                    type="search"
                    value={boardSearch}
                    onChange={(e) => setBoardSearch(e.target.value)}
                    placeholder="搜索消息、@成员或 #序号…"
                    aria-label="搜索消息板"
                  />
                </label>
                <button
                  type="button"
                  className="pmx-aux-icon-btn relative"
                  aria-expanded={filtersOpen}
                  aria-label="展开或收起筛选器"
                  title="筛选消息"
                  onClick={() => setFiltersOpen((v) => !v)}
                >
                  <SlidersHorizontalIcon className="size-3.5" />
                  {activeFilterCount > 0 ? (
                    <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
                  ) : null}
                </button>
              </div>

              {filtersOpen ? (
                <div className="pmx-aux-filters">
                  <div className="pmx-aux-filter-row">
                    <select
                      className="pmx-aux-select"
                      aria-label="按发送者筛选"
                      value={senderFilter}
                      onChange={(e) => setSenderFilter(e.target.value)}
                    >
                      <option value="">发送者：全部</option>
                      {teamMembers.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.displayName}
                        </option>
                      ))}
                    </select>
                    <select
                      className="pmx-aux-select"
                      aria-label="按接收者筛选"
                      value={recipientFilter}
                      onChange={(e) => setRecipientFilter(e.target.value)}
                    >
                      <option value="">接收者：全部</option>
                      <option value="__all__">@all 全体广播</option>
                      {teamMembers.map((m) => (
                        <option key={m.name} value={m.name}>
                          @{m.displayName}
                        </option>
                      ))}
                    </select>
                    <label className="pmx-aux-switch ml-auto">
                      <input
                        type="checkbox"
                        checked={autoFollow}
                        onChange={(e) => setAutoFollow(e.target.checked)}
                      />
                      <span>自动跟随</span>
                    </label>
                  </div>

                  <div className="pmx-aux-chips">
                    {teamMembers.map((m) => {
                      const hidden = hiddenMembers.has(m.name);
                      return (
                        <button
                          key={m.name}
                          type="button"
                          className={hidden ? "pmx-aux-chip pmx-aux-chip--dim" : "pmx-aux-chip"}
                          onClick={() => {
                            setHiddenMembers((prev) => {
                              const next = new Set(prev);
                              if (next.has(m.name)) next.delete(m.name);
                              else next.add(m.name);
                              return next;
                            });
                          }}
                        >
                          <span>{m.displayName}</span>
                          <span className="text-[10.5px] text-muted-foreground tabular-nums">
                            {m.posts}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            {filteredMessages.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                <p className="text-[13px] font-medium text-foreground">暂无匹配消息</p>
                {activeFilterCount > 0 ? (
                  <button
                    type="button"
                    className="pmx-aux-btn"
                    onClick={() => {
                      setBoardSearch("");
                      setSenderFilter("");
                      setRecipientFilter("");
                      setHiddenMembers(new Set());
                    }}
                  >
                    清除筛选
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="pmx-aux-feed">
                {filteredMessages.map((msg) => (
                  <div key={msg.seq}>
                    {firstUnreadSeq !== null && msg.seq === firstUnreadSeq ? (
                      <div className="pmx-aux-unread-divider" role="separator">
                        未读新消息
                      </div>
                    ) : null}
                    <BoardMessageRow
                      msg={msg}
                      knownNames={knownNames}
                      maxSeq={model.headSeq}
                      isFlashing={flashSeq === msg.seq}
                      onJumpSeq={jumpToSeq}
                    />
                  </div>
                ))}
              </div>
            )}

            {showJumpBottom ? (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  className="pmx-aux-jump-btn"
                  onClick={() => {
                    if (scrollRef.current) {
                      scrollRef.current.scrollTo({
                        top: scrollRef.current.scrollHeight,
                        behavior: "smooth",
                      });
                    }
                  }}
                >
                  <ArrowDownIcon className="size-3.5" />
                  回到底部
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ===================== MEMBERS TAB ===================== */}
        {activeTab === "members" ? (
          <div className="pmx-aux-stack" data-aux-section="members">
            <label className="pmx-aux-search">
              <SearchIcon className="size-3.5 shrink-0" />
              <input
                type="search"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="搜索成员、角色或模型…"
                aria-label="搜索成员"
              />
            </label>

            {activeMembers.length > 0 ? (
              <MemberGroupSection
                title="活跃中"
                members={activeMembers}
                useBees={useBees}
                providerBrand={model.providerBrand}
                expandedStepIds={expandedStepMemberIds}
                onToggleSteps={toggleMemberSteps}
                onOpenChildThread={onOpenChildThread}
                onJumpSeq={jumpToSeq}
                hasMessages={model.messages.length > 0}
              />
            ) : null}

            {waitingMembers.length > 0 ? (
              <MemberGroupSection
                title="等待中"
                members={waitingMembers}
                useBees={useBees}
                providerBrand={model.providerBrand}
                expandedStepIds={expandedStepMemberIds}
                onToggleSteps={toggleMemberSteps}
                onOpenChildThread={onOpenChildThread}
                onJumpSeq={jumpToSeq}
                hasMessages={model.messages.length > 0}
              />
            ) : null}

            {doneMembers.length > 0 ? (
              <MemberGroupSection
                title="已完成"
                members={doneMembers}
                useBees={useBees}
                providerBrand={model.providerBrand}
                expandedStepIds={expandedStepMemberIds}
                onToggleSteps={toggleMemberSteps}
                onOpenChildThread={onOpenChildThread}
                onJumpSeq={jumpToSeq}
                hasMessages={model.messages.length > 0}
              />
            ) : null}

            {retiredMembers.length > 0 ? (
              <section className="border-t border-border/60 pt-2">
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-1.5 py-1 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
                  aria-expanded={showRetired}
                  onClick={() => setShowRetired((v) => !v)}
                >
                  <span>显示已结束 ({retiredMembers.length})</span>
                  <ChevronDownIcon
                    className={
                      showRetired
                        ? "ml-auto size-3.5 rotate-180 transition-transform"
                        : "ml-auto size-3.5 transition-transform"
                    }
                  />
                </button>
                {showRetired ? (
                  <div className="mt-1 flex flex-col gap-1">
                    {retiredMembers.map((m) => (
                      <MemberCardRow
                        key={m.id}
                        member={m}
                        useBees={useBees}
                        providerBrand={model.providerBrand}
                        stepsExpanded={expandedStepMemberIds.has(m.id)}
                        onToggleSteps={toggleMemberSteps}
                        onOpenChildThread={onOpenChildThread}
                        onJumpSeq={jumpToSeq}
                        hasMessages={model.messages.length > 0}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : null}

        {/* ===================== GRAPH TAB (HIVE + MENTIONS + REPLAY) ===================== */}
        {activeTab === "graph" ? (
          <div ref={graphContainerRef} className="pmx-aux-stack" data-aux-section="graph">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="pmx-aux-segmented" role="group" aria-label="图谱模式切换">
                <button
                  type="button"
                  className={graphMode === "hive" ? "pmx-aux-seg-on" : ""}
                  onClick={() => setGraphMode("hive")}
                >
                  蜂巢视图
                </button>
                <button
                  type="button"
                  className={graphMode === "mentions" ? "pmx-aux-seg-on" : ""}
                  onClick={() => setGraphMode("mentions")}
                >
                  @提及关系图
                </button>
              </div>
              <label className="pmx-aux-switch">
                <input
                  type="checkbox"
                  checked={hideInactive}
                  onChange={(e) => setHideInactive(e.target.checked)}
                />
                <span>隐藏非活跃</span>
              </label>
            </div>

            {replayableMessages.length > 0 ? (
              <div className="pmx-aux-player">
                <div className="pmx-aux-player-row">
                  <button
                    type="button"
                    className="pmx-aux-icon-btn"
                    title="回到起点"
                    aria-label="回到起点"
                    onClick={() => {
                      setIsReplaying(false);
                      setReplaySeq(replayableMessages[0]?.seq ?? null);
                    }}
                  >
                    <SkipBackIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="pmx-aux-icon-btn"
                    title="上一条"
                    aria-label="上一条"
                    disabled={currentReplayIndex <= 0}
                    onClick={() => {
                      setIsReplaying(false);
                      const prev = replayableMessages[Math.max(0, currentReplayIndex - 1)];
                      setReplaySeq(prev?.seq ?? null);
                    }}
                  >
                    <StepBackIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="pmx-aux-icon-btn"
                    title={isReplaying ? "暂停回放" : "播放回放"}
                    aria-label={isReplaying ? "暂停回放" : "播放回放"}
                    onClick={() => {
                      if (isReplaying) {
                        setIsReplaying(false);
                      } else {
                        if (replaySeq === null) {
                          setReplaySeq(replayableMessages[0]?.seq ?? null);
                        }
                        setIsReplaying(true);
                      }
                    }}
                  >
                    {isReplaying ? (
                      <PauseIcon className="size-3.5" />
                    ) : (
                      <PlayIcon className="size-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="pmx-aux-icon-btn"
                    title="下一条"
                    aria-label="下一条"
                    disabled={replaySeq === null}
                    onClick={() => {
                      setIsReplaying(false);
                      const next = replayableMessages[currentReplayIndex + 1];
                      setReplaySeq(next ? next.seq : null);
                    }}
                  >
                    <StepForwardIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="pmx-aux-icon-btn"
                    title="跳至最新"
                    aria-label="跳至最新"
                    onClick={() => {
                      setIsReplaying(false);
                      setReplaySeq(null);
                    }}
                  >
                    <SkipForwardIcon className="size-3.5" />
                  </button>

                  <input
                    type="range"
                    className="pmx-aux-slider"
                    aria-label="消息回放进度"
                    min={0}
                    max={Math.max(0, replayableMessages.length - 1)}
                    value={currentReplayIndex}
                    onChange={(e) => {
                      setIsReplaying(false);
                      const idx = Number.parseInt(e.target.value, 10);
                      if (idx >= replayableMessages.length - 1) setReplaySeq(null);
                      else setReplaySeq(replayableMessages[idx]?.seq ?? null);
                    }}
                  />

                  <button
                    type="button"
                    className={
                      replaySeq === null
                        ? "pmx-aux-btn border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                        : "pmx-aux-btn"
                    }
                    onClick={() => {
                      setIsReplaying(false);
                      setReplaySeq(null);
                    }}
                  >
                    实时
                  </button>
                </div>

                <div className="pmx-aux-player-row text-[11px] text-muted-foreground">
                  <span className="tabular-nums">
                    {replaySeq === null
                      ? `实时 · 共 ${replayableMessages.length} 条`
                      : `回放 #${currentReplayMsg?.seq ?? replaySeq} (${currentReplayIndex + 1}/${replayableMessages.length})`}
                  </span>
                  {graphMode === "mentions" ? (
                    <label className="pmx-aux-switch ml-auto">
                      <input
                        type="checkbox"
                        checked={expandAll}
                        onChange={(e) => setExpandAll(e.target.checked)}
                      />
                      <span>展开 @all</span>
                    </label>
                  ) : null}
                  <select
                    className="pmx-aux-select ml-auto"
                    aria-label="回放倍速"
                    value={String(replaySpeed)}
                    onChange={(e) => {
                      const val = Number(e.target.value) as (typeof SPEED_OPTIONS)[number];
                      setReplaySpeed(val);
                    }}
                  >
                    {SPEED_OPTIONS.map((sp) => (
                      <option key={sp} value={String(sp)}>
                        {sp}×
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}

            {/* Hive Honeycomb View */}
            {graphMode === "hive" && hiveLayout ? (
              <>
                <div
                  className="pmx-aux-hv-stage"
                  style={{ height: `${hiveLayout.height}px` }}
                  data-hive-stage="1"
                >
                  <svg
                    width={hiveLayout.width}
                    height={hiveLayout.height}
                    viewBox={`0 0 ${hiveLayout.width} ${hiveLayout.height}`}
                    className="block h-full w-full"
                    aria-label="蜂群蜂巢状态图"
                  >
                    {hiveLayout.cells.map((cell) => {
                      const isSel = selectedHiveCellId === cell.id;
                      const perim = 6 * (cell.radius - 2.5);
                      return (
                        <g key={cell.id}>
                          <path
                            d={cell.pathD}
                            className={`pmx-aux-hv-cell${cell.isHub ? " pmx-aux-hv-cell--hub" : ""}${isSel ? " pmx-aux-hv-cell--sel" : ""}`}
                            onClick={() =>
                              setSelectedHiveCellId((cur) => (cur === cell.id ? null : cell.id))
                            }
                          />
                          {cell.progressFraction > 0 ? (
                            <path
                              d={cell.progPathD}
                              className="pmx-aux-hv-prog"
                              strokeDasharray={`${(cell.progressFraction * perim).toFixed(1)} ${perim.toFixed(1)}`}
                            />
                          ) : null}
                          <text
                            x={cell.cx}
                            y={cell.cy - cell.radius * 0.42}
                            textAnchor="middle"
                            fill="currentColor"
                            fontSize={hiveLayout.mode === "tiny" ? 10 : 11.5}
                            fontWeight={600}
                            className="pointer-events-none"
                          >
                            {cell.title.length > 10 ? `${cell.title.slice(0, 9)}…` : cell.title}
                          </text>
                          {cell.total > 0 ? (
                            <text
                              x={cell.cx}
                              y={cell.cy + cell.radius * 0.68}
                              textAnchor="middle"
                              fill="var(--pmx-aux-muted)"
                              fontSize={10}
                              className="pointer-events-none"
                            >
                              {cell.done}/{cell.total}
                            </text>
                          ) : null}
                        </g>
                      );
                    })}

                    {hiveLayout.beams.map((beam) => (
                      <g key={beam.id}>
                        <path
                          d={beam.pathD}
                          fill="none"
                          stroke="var(--pmx-aux-primary)"
                          strokeOpacity={0.65}
                          strokeWidth={1.6}
                          strokeLinecap="round"
                        />
                        <circle cx={beam.x2} cy={beam.y2} r={3} fill="var(--pmx-aux-primary)" />
                      </g>
                    ))}
                  </svg>

                  {hiveLayout.bees.map((bee) => {
                    const scale: 1 | 2 | 3 = bee.size === "lg" ? 2 : 1;
                    const halfW = (22 * scale) / 2;
                    const halfH = (18 * scale) / 2;
                    return (
                      <button
                        key={bee.name}
                        type="button"
                        className={`pmx-aux-hv-bee${bee.state === "working" ? " pmx-aux-hv-bee--working" : ""}${bee.killed ? " pmx-aux-hv-bee--retired" : ""}`}
                        style={{
                          transform: `translate(${Math.round(bee.x - halfW)}px, ${Math.round(bee.y - halfH)}px)`,
                        }}
                        title={`@${bee.name} · ${formatAuxStatusLabel(bee.state)}`}
                        onClick={() => {
                          setSenderFilter(bee.name);
                          setSelectedTab("board");
                        }}
                      >
                        <SwarmBeeSprite
                          name={bee.name}
                          state={toPixelBeeState(bee.state)}
                          scale={scale}
                        />
                        <span className="pmx-aux-hv-bee-name">{bee.name}</span>
                      </button>
                    );
                  })}
                </div>

                {selectedHiveCell ? (
                  <div className="pmx-aux-card">
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-[13px] font-semibold">
                        {selectedHiveCell.title}
                      </strong>
                      <span className="text-[11.5px] text-muted-foreground tabular-nums">
                        {selectedHiveCell.members.length} 位成员
                      </span>
                    </div>
                    {selectedHiveCell.goal ? (
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {selectedHiveCell.goal}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selectedHiveCell.members.map((name) => (
                        <button
                          key={name}
                          type="button"
                          className="pmx-aux-chip"
                          onClick={() => {
                            setSenderFilter(name);
                            setSelectedTab("board");
                          }}
                        >
                          @{name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {/* Directed Mention Graph View */}
            {graphMode === "mentions" && mentionGraph ? (
              <>
                <svg
                  className="pmx-aux-graph-svg"
                  viewBox={`0 0 ${mentionGraph.width} ${mentionGraph.height}`}
                  width={mentionGraph.width}
                  height={mentionGraph.height}
                  aria-label="成员 @提及 通信关系图"
                >
                  <defs>
                    <marker
                      id="pmx-aux-arrow"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="5"
                      markerHeight="5"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1 L 10 5 L 0 9 z" fill="currentColor" opacity="0.65" />
                    </marker>
                  </defs>

                  {mentionGraph.edges.map((edge) => (
                    <g key={edge.id}>
                      <path
                        d={edge.pathD}
                        markerEnd="url(#pmx-aux-arrow)"
                        className={`pmx-aux-graph-edge${edge.viaAllOnly ? " pmx-aux-graph-edge--all" : ""}${edge.isCurrent ? " pmx-aux-graph-edge--cur" : ""}`}
                      />
                      <text
                        x={edge.labelX}
                        y={edge.labelY}
                        textAnchor="middle"
                        fontSize={10}
                        fill="var(--pmx-aux-muted)"
                      >
                        {edge.count}
                      </text>
                    </g>
                  ))}

                  {mentionGraph.nodes.map((node) => (
                    <g
                      key={node.name}
                      className={`${node.isHot ? "pmx-aux-graph-node--hot" : ""}${node.killed ? " pmx-aux-graph-node--killed" : ""}`}
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        setSenderFilter(node.name);
                        setSelectedTab("board");
                      }}
                    >
                      <rect
                        x={node.x - node.width / 2}
                        y={node.y - node.height / 2}
                        width={node.width}
                        height={node.height}
                        rx={8}
                        className="pmx-aux-graph-node-box"
                      />
                      <circle
                        cx={node.x - node.width / 2 + 12}
                        cy={node.y}
                        r={3.5}
                        fill={
                          node.status === "working"
                            ? "var(--pmx-aux-success)"
                            : node.killed
                              ? "var(--pmx-aux-faint)"
                              : "var(--pmx-aux-muted)"
                        }
                      />
                      <text
                        x={node.x + 4}
                        y={node.y + 4}
                        textAnchor="middle"
                        fontSize={11.5}
                        fontWeight={node.isCoordinator ? 600 : 500}
                        fill="currentColor"
                      >
                        {node.displayName.length > 13
                          ? `${node.displayName.slice(0, 12)}…`
                          : node.displayName}
                      </text>
                      {node.broadcastCount > 0 ? (
                        <g transform={`translate(${node.x + node.width / 2 - 4}, ${node.y - node.height / 2 - 4})`}>
                          <rect
                            x={-10}
                            y={-7}
                            width={24}
                            height={14}
                            rx={7}
                            fill="var(--pmx-aux-primary)"
                          />
                          <text x={2} y={3} textAnchor="middle" fontSize={9} fill="#fff">
                            ×{node.broadcastCount}
                          </text>
                        </g>
                      ) : null}
                    </g>
                  ))}
                </svg>

                {mentionGraph.currentMessage ? (
                  <div className="pmx-aux-card">
                    <div className="mb-1 flex items-center justify-between text-[11.5px] text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        @{mentionGraph.currentMessage.agent}
                      </span>
                      <button
                        type="button"
                        className="pmx-aux-seq-pill"
                        onClick={() => jumpToSeq(mentionGraph.currentMessage!.seq)}
                      >
                        #{mentionGraph.currentMessage.seq}
                      </button>
                    </div>
                    <p className="line-clamp-4 text-[12px] whitespace-pre-wrap text-foreground/90">
                      {mentionGraph.currentMessage.text}
                    </p>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {/* ===================== TASKS TAB ===================== */}
        {activeTab === "tasks" ? (
          <div className="pmx-aux-stack" data-aux-section="tasks">
            {model.tasks.length === 0 ? (
              <p className="py-8 text-center text-[12.5px] text-muted-foreground">
                暂无共享任务清单
              </p>
            ) : (
              model.tasks.map((task) => (
                <article key={task.id} className="pmx-aux-task-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <ListChecksIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <strong className="truncate text-[13px] font-semibold text-foreground">
                        {task.subject}
                      </strong>
                    </div>
                    <span className={`pmx-aux-badge pmx-aux-badge--${task.status}`}>
                      {formatAuxTaskStatusLabel(task.status)}
                    </span>
                  </div>
                  {task.description ? (
                    <p className="text-[12px] leading-relaxed text-muted-foreground">
                      {task.description}
                    </p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="font-mono">#{task.id}</span>
                    {task.owner ? (
                      <span className="rounded-full bg-black/[0.05] px-2 py-0.5 dark:bg-white/[0.08]">
                        负责人：@{task.owner}
                      </span>
                    ) : null}
                    {task.progressLabel ? (
                      <span className="rounded-full bg-primary/12 px-2 py-0.5 text-primary tabular-nums">
                        {task.progressLabel}
                      </span>
                    ) : null}
                    {task.blockedBy.map((dep) => (
                      <span
                        key={dep}
                        className="rounded-full bg-amber-500/14 px-2 py-0.5 text-amber-700 dark:text-amber-300"
                      >
                        依赖 #{dep}
                      </span>
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BoardMessageRow(props: {
  readonly msg: AgentAuxBoardMessage;
  readonly knownNames: ReadonlySet<string>;
  readonly maxSeq: number;
  readonly isFlashing: boolean;
  readonly onJumpSeq: (seq: number) => void;
}) {
  const { msg, knownNames, maxSeq, isFlashing, onJumpSeq } = props;
  const tokens = useMemo(
    () => tokenizeBoardText(msg.text, knownNames, Math.max(maxSeq, msg.seq)),
    [msg.text, knownNames, maxSeq, msg.seq],
  );
  const targetLabel = msg.all
    ? "@all"
    : msg.recipient
      ? `@${msg.recipient}`
      : msg.mentions.length > 0
        ? msg.mentions.map((m) => `@${m}`).join(" ")
        : "";

  return (
    <article
      data-board-seq={msg.seq}
      className={`pmx-aux-msg${msg.isDirectToYou ? " pmx-aux-msg--direct" : ""}${isFlashing ? " pmx-aux-msg--flash" : ""}`}
    >
      <div className="pmx-aux-msg-head">
        <div className="pmx-aux-msg-who">
          <span className="pmx-aux-msg-author">{msg.agent}</span>
          {targetLabel ? <span className="pmx-aux-msg-to">→ {targetLabel}</span> : null}
          {msg.channel && msg.channel !== "main" ? (
            <span className="rounded bg-primary/12 px-1.5 text-[10.5px] font-mono text-primary">
              #{msg.channel}
            </span>
          ) : null}
        </div>
        <div className="pmx-aux-msg-meta">
          <span>#{msg.seq}</span>
          <span>{formatAuxClockTime(msg.ts, msg.time)}</span>
        </div>
      </div>

      <div className="pmx-aux-msg-body">
        {tokens.map((tok, idx) => {
          if (tok.kind === "mention") {
            return (
              <span
                key={idx}
                className={
                  tok.isAll ? "pmx-aux-mention pmx-aux-mention--all" : "pmx-aux-mention"
                }
              >
                {tok.value}
              </span>
            );
          }
          if (tok.kind === "seq") {
            return (
              <button
                key={idx}
                type="button"
                className="pmx-aux-seq-pill"
                onClick={() => onJumpSeq(tok.seq)}
              >
                {tok.value}
              </button>
            );
          }
          if (tok.kind === "code") {
            return (
              <code key={idx} className="pmx-aux-inline-code">
                {tok.value}
              </code>
            );
          }
          return <span key={idx}>{tok.value}</span>;
        })}
      </div>
    </article>
  );
}

function MemberGroupSection(props: {
  readonly title: string;
  readonly members: readonly AgentAuxMember[];
  readonly useBees: boolean;
  readonly providerBrand: AgentAuxViewModel["providerBrand"];
  readonly expandedStepIds: ReadonlySet<string>;
  readonly onToggleSteps: (id: string) => void;
  readonly onOpenChildThread?: ((threadId: ThreadId) => void) | undefined;
  readonly onJumpSeq: (seq: number) => void;
  readonly hasMessages: boolean;
}) {
  return (
    <section>
      <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
        <span>{props.title}</span>
        <span className="tabular-nums opacity-75">{props.members.length}</span>
      </h3>
      <div className="flex flex-col gap-1">
        {props.members.map((member) => (
          <MemberCardRow
            key={member.id}
            member={member}
            useBees={props.useBees}
            providerBrand={props.providerBrand}
            stepsExpanded={props.expandedStepIds.has(member.id)}
            onToggleSteps={props.onToggleSteps}
            onOpenChildThread={props.onOpenChildThread}
            onJumpSeq={props.onJumpSeq}
            hasMessages={props.hasMessages}
          />
        ))}
      </div>
    </section>
  );
}

function MemberCardRow(props: {
  readonly member: AgentAuxMember;
  readonly useBees: boolean;
  readonly providerBrand: AgentAuxViewModel["providerBrand"];
  readonly stepsExpanded: boolean;
  readonly onToggleSteps: (id: string) => void;
  readonly onOpenChildThread?: ((threadId: ThreadId) => void) | undefined;
  readonly onJumpSeq: (seq: number) => void;
  readonly hasMessages: boolean;
}) {
  const { member, useBees, providerBrand, stepsExpanded, onToggleSteps, onOpenChildThread, onJumpSeq, hasMessages } = props;
  const nativeSteps = member.nativeSteps ?? [];

  return (
    <div
      className={
        member.killed ? "pmx-aux-member-row pmx-aux-member-row--retired" : "pmx-aux-member-row"
      }
      data-aux-member={member.name}
    >
      <AgentMemberAvatar
        useBees={useBees}
        providerBrand={providerBrand}
        name={member.name}
        displayName={member.displayName}
        status={member.status}
        color={member.color}
        size="md"
      />
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <strong className="truncate text-[13px] font-semibold text-foreground">
              {member.displayName}
            </strong>
            <span className="shrink-0 rounded bg-black/[0.05] px-1.5 py-0.2 text-[10.5px] text-muted-foreground dark:bg-white/[0.08]">
              {member.roleLabel}
            </span>
          </div>
          <span
            className={
              member.status === "working"
                ? "shrink-0 text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400"
                : member.status === "error"
                  ? "shrink-0 text-[11.5px] font-medium text-red-600 dark:text-red-400"
                  : member.status === "needs_you" || member.status === "waiting_on"
                    ? "shrink-0 text-[11.5px] font-medium text-amber-600 dark:text-amber-400"
                    : "shrink-0 text-[11.5px] text-muted-foreground"
            }
          >
            {member.statusLabel}
          </span>
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
          {member.model ? <span className="truncate">{member.model}</span> : null}
          {member.steps > 0 ? <span>{member.steps} 步</span> : null}
          {member.posts > 0 ? <span>{member.posts} 发言</span> : null}
          {member.unread > 0 ? (
            <span className="font-medium text-primary">{member.unread} 未读</span>
          ) : null}
          {member.backendType ? <span>{member.backendType}</span> : null}
        </div>

        {member.status === "working" && member.activity ? (
          <p className="pmx-aux-shimmer mt-1 truncate text-[12px]">{member.activity}</p>
        ) : member.nowLine ? (
          <p className="mt-1 truncate text-[12px] text-muted-foreground">{member.nowLine}</p>
        ) : null}

        {member.failureText ? (
          <p className="mt-1 rounded bg-red-500/10 px-2 py-1 text-[11.5px] text-red-600 dark:text-red-400">
            {member.failureText}
          </p>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {member.childThreadId && onOpenChildThread ? (
            <button
              type="button"
              className="pmx-aux-btn"
              onClick={() => onOpenChildThread(member.childThreadId!)}
            >
              <ExternalLinkIcon className="size-3" />
              打开对话
            </button>
          ) : null}
          {member.lastSeq > 0 && hasMessages ? (
            <button
              type="button"
              className="pmx-aux-seq-pill"
              onClick={() => onJumpSeq(member.lastSeq)}
            >
              最近 #{member.lastSeq}
            </button>
          ) : null}
          {nativeSteps.length > 0 ? (
            <button
              type="button"
              className="pmx-aux-btn"
              aria-expanded={stepsExpanded}
              onClick={() => onToggleSteps(member.id)}
            >
              {stepsExpanded ? "收起步骤" : `查看步骤 (${nativeSteps.length})`}
            </button>
          ) : null}
        </div>

        {stepsExpanded && nativeSteps.length > 0 ? (
          <ol className="pmx-aux-steps-box list-none">
            {nativeSteps.map((st) => (
              <li key={st.index} className="border-l-2 border-border pl-2">
                <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-foreground">
                  <span>
                    #{st.index} · {st.type}
                  </span>
                  {st.status ? (
                    <span className="text-muted-foreground">{st.status}</span>
                  ) : null}
                </div>
                {st.toolCalls.map((tc, i) => (
                  <div key={i} className="mt-0.5 truncate font-mono text-[11px] text-primary">
                    {tc.name}
                    {tc.summary ? `: ${tc.summary}` : ""}
                  </div>
                ))}
                {st.text ? (
                  <p className="mt-0.5 line-clamp-3 text-[11.5px] text-muted-foreground">
                    {st.text}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
