import { ChevronDownIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { AgentBrandLogo } from "../agentBrand";
import {
  formatAuxBlockedChip,
  formatAuxBoardMemberHandle,
  formatAuxFilteredBy,
  formatAuxInReviewChip,
  formatAuxMemberDisplayName,
  formatAuxModelDisplayLabel,
  formatAuxNeedsYouChip,
  formatAuxPlainSnippet,
  formatAuxTasksDone,
  formatAuxTeamCount,
  formatAuxThreadsOpenChip,
  formatAuxThreadsSummary,
  formatAuxWaitingCount,
  formatAuxWaitingOn,
  getAuxStrings,
} from "./agentAux.i18n";
import {
  computeBeeColor,
  formatAuxStatusLabel,
  type AgentAuxAttentionItem,
  type AgentAuxMember,
  type AgentAuxThreadGroup,
  type AgentAuxViewModel,
  type AgentAuxWorkstream,
} from "./agentAux.logic";
import { AgentMemberAvatar, SwarmBeeSprite, SwarmMiniCluster } from "./SwarmBeeSprite";

export interface AgentAuxOverviewTabProps {
  readonly model: AgentAuxViewModel;
  readonly selectedTeamMember: string | null;
  readonly onSelectTeamMember: (name: string | null) => void;
  readonly onJumpSeq: (seq: number) => void;
  readonly onOpenMemberPosts: (name: string) => void;
  readonly onSwitchToMembers: () => void;
}

type ThreadOperationalState = "needs" | "waiting" | "stuck" | "running" | "queued" | "done";

interface ComputedThreadRow {
  readonly id: string;
  readonly title: string;
  readonly goal: string;
  readonly now: string;
  readonly isAcpDelegated: boolean;
  readonly workstreams: readonly AgentAuxWorkstream[];
  readonly asks: readonly AgentAuxAttentionItem[];
  readonly issues: readonly AgentAuxAttentionItem[];
  readonly counts: {
    readonly done: number;
    readonly running: number;
    readonly blocked: number;
    readonly queued: number;
  };
  readonly state: ThreadOperationalState;
  readonly waiters: readonly string[];
}

const THREAD_STATE_ORDER: Readonly<Record<ThreadOperationalState, number>> = {
  needs: 0,
  waiting: 1,
  stuck: 2,
  running: 3,
  queued: 4,
  done: 5,
};

const WS_ORDER: Readonly<Record<"blocked" | "running" | "queued" | "done", number>> = {
  blocked: 0,
  running: 1,
  queued: 2,
  done: 3,
};

function workstreamBucket(
  ws: AgentAuxWorkstream,
  memberByName: ReadonlyMap<string, AgentAuxMember>,
): "done" | "running" | "blocked" | "queued" {
  if (ws.state === "done") return "done";
  if (ws.state === "blocked" || ws.waitingOn) return "blocked";
  const owner = ws.owners[0] ? memberByName.get(ws.owners[0]) : undefined;
  if (owner && (owner.status === "waiting_on" || owner.status === "error")) {
    return "blocked";
  }
  if (ws.state === "running" || ws.state === "review") return "running";
  return "queued";
}

function waiterOfWorkstream(
  ws: AgentAuxWorkstream,
  memberByName: ReadonlyMap<string, AgentAuxMember>,
): string | null {
  if (ws.state === "done") return null;
  if (ws.waitingOn) return ws.waitingOn;
  if (ws.state === "blocked" && ws.blockedOn) return ws.blockedOn;
  const owner = ws.owners[0] ? memberByName.get(ws.owners[0]) : undefined;
  return owner?.waitingOn ?? null;
}

export const AgentAuxOverviewTab = memo(function AgentAuxOverviewTab({
  model,
  selectedTeamMember,
  onSelectTeamMember,
  onJumpSeq,
  onOpenMemberPosts,
  onSwitchToMembers,
}: AgentAuxOverviewTabProps) {
  const s = getAuxStrings(model.locale);
  const [progressExpanded, setProgressExpanded] = useState(false);
  const [expandedThreadIds, setExpandedThreadIds] = useState<ReadonlySet<string>>(() => new Set());
  const [showAllRunning, setShowAllRunning] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);

  const teamMembers = useMemo(() => model.members.filter((m) => !m.isSystem), [model.members]);
  const memberByName = useMemo(() => new Map(teamMembers.map((m) => [m.name, m])), [teamMembers]);
  const coordinator = useMemo(
    () => teamMembers.find((m) => m.isCoordinator) ?? null,
    [teamMembers],
  );
  const liveWorkers = useMemo(() => {
    const order: Readonly<Record<AgentAuxMember["status"], number>> = {
      working: 0,
      needs_you: 1,
      waiting_on: 2,
      error: 3,
      parked: 4,
      done: 5,
      killed: 6,
    };
    return teamMembers
      .filter((m) => !m.isCoordinator && !m.killed)
      .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.lastSeq - a.lastSeq);
  }, [teamMembers]);

  const effectiveFilter =
    selectedTeamMember && memberByName.has(selectedTeamMember) ? selectedTeamMember : null;

  // Build Workgroups (`Threads`) + totals respecting in-place `effectiveFilter` (1:1 hive.js:310–406)
  const overviewData = useMemo(() => {
    const wsById = new Map(model.workstreams.map((w) => [w.id, w]));
    const attById = new Map(model.attention.map((a) => [a.id, a]));
    const openYou = (a: AgentAuxAttentionItem) => !model.finished && a.wait === "you";
    const openAsk = (a: AgentAuxAttentionItem) => !model.finished && a.wait === "coordinator";
    const openIssue = (a: AgentAuxAttentionItem) => !model.finished && a.wait === "issue";

    const matchesFilter = (owners: readonly string[]) =>
      !effectiveFilter || owners.includes(effectiveFilter);

    const usedWs = new Set<string>();
    const seenWs = new Set<string>();
    const runningList: Array<{ ws: AgentAuxWorkstream; bucket: "running" | "blocked" }> = [];
    const doneList: AgentAuxWorkstream[] = [];
    const queuedList: AgentAuxWorkstream[] = [];
    const totals = { done: 0, running: 0, blocked: 0, queued: 0 };

    const collectWs = (w: AgentAuxWorkstream) => {
      if (seenWs.has(w.id)) return;
      seenWs.add(w.id);
      const b = workstreamBucket(w, memberByName);
      totals[b] += 1;
      if (b === "running" || b === "blocked") runningList.push({ ws: w, bucket: b });
      else if (b === "done") doneList.push(w);
      else queuedList.push(w);
    };

    const rows: ComputedThreadRow[] = [];

    const buildRowFromGroup = (tg: AgentAuxThreadGroup): ComputedThreadRow | null => {
      const ws = tg.workstreams
        .map((id) => wsById.get(id))
        .filter((w): w is AgentAuxWorkstream => w !== undefined && matchesFilter(w.owners));
      for (const w of ws) {
        usedWs.add(w.id);
        collectWs(w);
      }
      const att = (tg.attention ?? [])
        .map((id) => attById.get(id))
        .filter(
          (a): a is AgentAuxAttentionItem =>
            a !== undefined && (!effectiveFilter || a.from === effectiveFilter),
        );
      const you = att.filter(openYou);
      const asks = [...you, ...att.filter(openAsk)];
      const issues = att.filter(openIssue);
      if (ws.length === 0 && asks.length === 0 && issues.length === 0) return null;

      const counts = { done: 0, running: 0, blocked: 0, queued: 0 };
      const waiterSet = new Set<string>();
      for (const w of ws) {
        counts[workstreamBucket(w, memberByName)] += 1;
        const waiter = waiterOfWorkstream(w, memberByName);
        if (waiter) waiterSet.add(waiter);
      }
      if (asks.some(openAsk)) waiterSet.add("coordinator");

      const state: ThreadOperationalState =
        you.length > 0
          ? "needs"
          : waiterSet.size > 0 || counts.blocked > 0
            ? "waiting"
            : issues.length > 0
              ? "stuck"
              : counts.running > 0
                ? "running"
                : counts.queued > 0 && counts.done === 0
                  ? "queued"
                  : counts.queued > 0
                    ? "running"
                    : "done";

      return {
        id: tg.id,
        title: tg.title,
        goal: tg.goal,
        now: tg.now,
        isAcpDelegated: tg.sourceKind === "acp-delegated",
        workstreams: ws,
        asks,
        issues,
        counts,
        state,
        waiters: [...waiterSet],
      };
    };

    for (const tg of model.threadGroups) {
      const row = buildRowFromGroup(tg);
      if (row) rows.push(row);
    }

    // Remaining workstreams not listed in any threadGroup -> `其他` (Other)
    const rest = model.workstreams.filter((w) => !usedWs.has(w.id) && matchesFilter(w.owners));
    if (rest.length > 0) {
      const counts = { done: 0, running: 0, blocked: 0, queued: 0 };
      const waiterSet = new Set<string>();
      for (const w of rest) {
        collectWs(w);
        counts[workstreamBucket(w, memberByName)] += 1;
        const waiter = waiterOfWorkstream(w, memberByName);
        if (waiter) waiterSet.add(waiter);
      }
      const state: ThreadOperationalState =
        waiterSet.size > 0 || counts.blocked > 0
          ? "waiting"
          : counts.running > 0
            ? "running"
            : counts.queued > 0
              ? "queued"
              : "done";
      rows.push({
        id: "t-other",
        title: model.threadGroups.length > 0 ? s.overviewOtherThread : s.overviewDelegatedThread,
        goal: "",
        now: "",
        isAcpDelegated: false,
        workstreams: rest,
        asks: [],
        issues: [],
        counts,
        state,
        waiters: [...waiterSet],
      });
    }

    // Loose attention items not attached to any threadGroup
    const listedAttIds = new Set(model.threadGroups.flatMap((t) => t.attention ?? []));
    const looseAtt = model.attention.filter(
      (a) => !listedAttIds.has(a.id) && (!effectiveFilter || a.from === effectiveFilter),
    );
    const looseYou = looseAtt.filter(openYou);
    const looseAsks = looseAtt.filter(openAsk);
    const looseIssues = looseAtt.filter(openIssue);

    rows.sort((a, b) => THREAD_STATE_ORDER[a.state] - THREAD_STATE_ORDER[b.state]);
    runningList.sort((a, b) => (a.bucket === "blocked" ? 0 : 1) - (b.bucket === "blocked" ? 0 : 1));
    doneList.sort((a, b) => (b.seq || 0) - (a.seq || 0));

    const reviewCount = runningList.filter(
      ({ ws, bucket }) => ws.rawState === "review" && bucket !== "blocked",
    ).length;
    const openThreadsCount = rows.filter((r) => r.state !== "done").length;

    return {
      rows,
      runningList,
      doneList,
      queuedList,
      totals,
      reviewCount,
      openThreadsCount,
      looseYou,
      looseAsks,
      looseIssues,
    };
  }, [model, memberByName, effectiveFilter, s]);

  const {
    rows: threadRows,
    runningList,
    doneList,
    queuedList,
    totals,
    reviewCount,
    openThreadsCount,
    looseYou,
    looseIssues,
  } = overviewData;

  const totalTasks = totals.done + totals.running + totals.blocked + totals.queued;
  const ringCircumference = 2 * Math.PI * 7;
  const doneRatio = totalTasks > 0 ? totals.done / totalTasks : 0;
  const runRatio = totalTasks > 0 ? totals.running / totalTasks : 0;
  const blkRatio = totalTasks > 0 ? totals.blocked / totalTasks : 0;
  const isAllDone = totalTasks > 0 && totals.done === totalTasks;

  const toggleThread = (id: string) => {
    setExpandedThreadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatThreadStateLabel = (row: ComputedThreadRow): string => {
    switch (row.state) {
      case "needs":
        return s.stateNeedsYou;
      case "stuck":
        return s.stateBlocked;
      case "running":
        return s.stateMoving;
      case "queued":
        return s.stateQueued;
      case "done":
        return s.stateDone;
      case "waiting":
        if (row.waiters.length === 1 && row.waiters[0]) {
          return formatAuxWaitingOn(row.waiters[0], model.locale);
        }
        if (row.waiters.length > 1) {
          return formatAuxWaitingCount(row.waiters.length, model.locale);
        }
        return s.stateWaitingGeneric;
    }
  };

  const renderWorkerChip = (ownerName: string) => {
    const ownerObj = memberByName.get(ownerName);
    const isSwarmBee = model.useBees && ownerObj?.sourceKind !== "acp-delegated";
    const ownerLabel = formatAuxMemberDisplayName(ownerName, model.locale, ownerObj);
    const ownerHandle = formatAuxBoardMemberHandle(ownerName, model.locale, ownerObj);
    return (
      <button
        key={ownerName}
        type="button"
        className="pmx-aux-wchip"
        title={ownerHandle}
        onClick={(e) => {
          e.stopPropagation();
          onSelectTeamMember(effectiveFilter === ownerName ? null : ownerName);
        }}
      >
        <span className="pmx-aux-wchip-icon" aria-hidden="true">
          {isSwarmBee ? (
            <SwarmBeeSprite
              name={ownerName}
              state={
                !model.finished && ownerObj && !ownerObj.killed && ownerObj.status === "working"
                  ? "working"
                  : "landed"
              }
              scale={1}
            />
          ) : (
            <AgentBrandLogo
              provider={ownerObj?.providerBrand ?? model.providerBrand}
              size={13}
              online={!ownerObj?.killed && ownerObj?.status !== "error"}
              breathing={ownerObj?.status === "working"}
            />
          )}
        </span>
        <span>{ownerLabel}</span>
      </button>
    );
  };

  const visibleRunning = showAllRunning ? runningList : runningList.slice(0, 8);
  const hiddenRunningCount = runningList.length - visibleRunning.length;
  const visibleDone = showAllDone ? doneList : doneList.slice(0, 8);
  const hiddenDoneCount = doneList.length - visibleDone.length;

  const teamCounts = formatAuxTeamCount(
    teamMembers.filter((m) => !m.killed).length,
    model.retiredCount,
    model.locale,
  );

  const onboardWorkers = [
    ...liveWorkers.slice(0, 3).map((w) => w.name),
    "worker-a",
    "worker-b",
    "worker-c",
  ].slice(0, 3);

  return (
    <div className="pmx-aux-stack" data-aux-section="overview">
      {/* Block 0a: Stall Banner */}
      {model.stall ? (
        <section className="pmx-aux-stall" data-testid="aux-stall-banner">
          <div className="pmx-aux-stall-top">
            <span className="pmx-aux-stall-dot" aria-hidden="true" />
            <strong>{s.overviewStallTitle}</strong>
            <button
              type="button"
              className="pmx-aux-stall-tag"
              onClick={() => onJumpSeq(model.stall!.seq)}
            >
              {formatAuxBoardMemberHandle(
                model.stall.agent,
                model.locale,
                memberByName.get(model.stall.agent),
              )}{" "}
              #{model.stall.seq}
            </button>
          </div>
          {model.stall.text ? (
            <p className="pmx-aux-stall-text">
              {formatAuxPlainSnippet(model.stall.text, model.locale)}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Block 0b: First-Run Onboarding (when swarm just started) */}
      {model.starting ? (
        <section className="pmx-aux-onboard" data-testid="aux-onboarding">
          <div className="pmx-aux-onboard-stage" aria-hidden="true">
            <svg className="pmx-aux-onboard-svg" viewBox="0 0 300 132" width="300" height="132">
              <g className="pmx-aux-onboard-lines">
                {[26, 66, 106].map((y, idx) => (
                  <path key={y} id={`pmx-onb-p${idx}`} d={`M76 66 C134 66 150 ${y} 214 ${y}`} />
                ))}
              </g>
              {onboardWorkers.map((wName, idx) => (
                <g key={wName} className="pmx-aux-onboard-dots">
                  <circle r="3" fill={computeBeeColor("coordinator")} opacity="0.9">
                    <animateMotion
                      dur="2.4s"
                      begin={`${idx * 0.75}s`}
                      repeatCount="indefinite"
                      path={`M76 66 C134 66 150 ${[26, 66, 106][idx]} 214 ${[26, 66, 106][idx]}`}
                    />
                  </circle>
                </g>
              ))}
            </svg>
            <div className="pmx-aux-onboard-coord">
              <AgentMemberAvatar
                useBees={model.useBees}
                providerBrand={coordinator?.providerBrand ?? model.providerBrand}
                name="coordinator"
                displayName={s.roleCoordinator}
                status="working"
                size="md"
                isCoordinator
              />
            </div>
            {onboardWorkers.map((wName, idx) => (
              <div key={wName} className={`pmx-aux-onboard-worker pmx-aux-onboard-worker--${idx}`}>
                <AgentMemberAvatar
                  useBees={model.useBees}
                  providerBrand={liveWorkers[idx]?.providerBrand ?? model.providerBrand}
                  name={wName}
                  displayName={wName}
                  status="working"
                  size="xs"
                  showStatusDot={false}
                />
              </div>
            ))}
          </div>
          <h3 className="pmx-aux-onboard-title">{s.overviewOnboardingTitle}</h3>
          <ol className="pmx-aux-onboard-steps">
            <li>
              <strong>{s.overviewOnboardingLeadTitle}</strong>
              <span>{s.overviewOnboardingLeadDesc}</span>
            </li>
            <li>
              <strong>{s.overviewOnboardingWorkersTitle}</strong>
              <span>{s.overviewOnboardingWorkersDesc}</span>
            </li>
            <li>
              <strong>{s.overviewOnboardingBoardTitle}</strong>
              <span>{s.overviewOnboardingBoardDesc}</span>
            </li>
          </ol>
          <p className="pmx-aux-onboard-wait pmx-aux-shimmer">{s.overviewOnboardingWait}</p>
        </section>
      ) : null}

      {/* Active in-place member filter banner */}
      {effectiveFilter ? (
        <div className="pmx-aux-filter-pill" data-testid="aux-overview-filter-bar">
          <span>{formatAuxFilteredBy(effectiveFilter, model.locale)}</span>
          {model.messages.length > 0 ? (
            <button
              type="button"
              className="pmx-aux-link-btn"
              onClick={() => onOpenMemberPosts(effectiveFilter)}
            >
              {s.overviewViewPosts} →
            </button>
          ) : null}
          <button
            type="button"
            className="pmx-aux-icon-btn ml-auto"
            aria-label={s.overviewClearFilter}
            title={s.overviewClearFilter}
            onClick={() => onSelectTeamMember(null)}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ) : null}

      {/* Block 1: GOAL (`目标`) Card */}
      {model.goal ? (
        <section className="pmx-aux-card pmx-aux-goal" data-testid="aux-goal-card">
          <div className="pmx-aux-kicker">{s.overviewGoal}</div>
          <p className="pmx-aux-goal-title">{model.goal.title}</p>
          {model.goal.line ? <p className="pmx-aux-goal-line">{model.goal.line}</p> : null}
        </section>
      ) : null}

      {/* Loose High-Priority Attention Alerts */}
      {looseYou.length > 0 || looseIssues.length > 0 ? (
        <section className="pmx-aux-branch pmx-aux-branch--needs">
          <h3 className="pmx-aux-branch-head">
            <i className="pmx-aux-branch-dot" aria-hidden="true" />
            <span>{s.overviewNeedsYouHeading}</span>
            <span className="font-normal text-muted-foreground tabular-nums">
              {looseYou.length + looseIssues.length}
            </span>
          </h3>
          <div className="flex flex-col gap-2">
            {[...looseYou, ...looseIssues].map((att) => (
              <div key={att.id} className="pmx-aux-branch-card">
                <div className="flex items-start justify-between gap-2">
                  <strong className="text-[12.5px] font-semibold text-foreground">
                    {att.title}
                  </strong>
                  {att.seq !== null ? (
                    <button
                      type="button"
                      className="pmx-aux-seq-pill"
                      onClick={() => onJumpSeq(att.seq!)}
                    >
                      #{att.seq}
                    </button>
                  ) : null}
                </div>
                {att.why ? (
                  <p className="mt-1 text-[12px] text-muted-foreground">{att.why}</p>
                ) : null}
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {s.overviewFromPrefix}{" "}
                  {formatAuxBoardMemberHandle(att.from, model.locale, memberByName.get(att.from))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Block 2: Running (`进行中 N`) Card (1:1 Fig 6) */}
      {runningList.length > 0 && !model.finished ? (
        <section className="pmx-aux-card pmx-aux-run" data-testid="aux-running-card">
          <div className="pmx-aux-run-head">
            <i className="pmx-aux-run-dot" aria-hidden="true" />
            <strong className="font-semibold">{s.overviewRunning}</strong>
            <span className="text-[12px] text-muted-foreground tabular-nums">
              {runningList.length}
            </span>
            {model.phase && model.phase.total > 1 ? (
              <span className="pmx-aux-phase-pill">
                {model.phase.label} · {model.phase.index}/{model.phase.total}
              </span>
            ) : null}
          </div>
          {model.headline && model.headline !== model.goal?.title ? (
            <p className="pmx-aux-run-sum">{model.headline}</p>
          ) : null}
          <ul className="pmx-aux-run-list">
            {visibleRunning.map(({ ws, bucket }) => {
              const primaryOwner = ws.owners[0] ? memberByName.get(ws.owners[0]) : undefined;
              const liveActivity =
                bucket === "running" &&
                primaryOwner &&
                !primaryOwner.killed &&
                primaryOwner.status === "working"
                  ? primaryOwner.activity
                  : "";
              const waiter = waiterOfWorkstream(ws, memberByName);
              return (
                <li key={ws.id} className="pmx-aux-run-row">
                  <span className={`pmx-aux-ti pmx-aux-ti--${bucket}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="pmx-aux-run-top">
                      <span className="pmx-aux-run-title" title={ws.title}>
                        {ws.title}
                      </span>
                      {ws.progress && ws.progress.total > 0 ? (
                        <span className="pmx-aux-tprog">
                          <span className="pmx-aux-tpbar">
                            <i
                              style={{
                                width: `${Math.min(100, Math.round((ws.progress.done / ws.progress.total) * 100))}%`,
                              }}
                            />
                          </span>
                          <span>{ws.progress.label}</span>
                        </span>
                      ) : ws.rawState === "review" ? (
                        <span className="pmx-aux-tprog pmx-aux-tprog--rev">{s.stateReview}</span>
                      ) : waiter ? (
                        <span className="pmx-aux-tprog pmx-aux-tprog--warn">
                          {formatAuxWaitingOn(waiter, model.locale)}
                        </span>
                      ) : null}
                      <span className="pmx-aux-wchips">
                        {ws.owners.slice(0, 2).map((owner) => renderWorkerChip(owner))}
                      </span>
                    </div>
                    {liveActivity ? (
                      <p
                        className="pmx-aux-run-note pmx-aux-shimmer"
                        title={formatAuxPlainSnippet(liveActivity, model.locale)}
                      >
                        {formatAuxPlainSnippet(liveActivity, model.locale)}
                      </p>
                    ) : ws.note ? (
                      <p
                        className="pmx-aux-run-note"
                        title={formatAuxPlainSnippet(ws.note, model.locale)}
                      >
                        {formatAuxPlainSnippet(ws.note, model.locale)}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {hiddenRunningCount > 0 ? (
            <button
              type="button"
              className="pmx-aux-more-btn"
              onClick={() => setShowAllRunning(true)}
            >
              +{hiddenRunningCount}
            </button>
          ) : null}
        </section>
      ) : null}

      {/* Block 3: Collapsible Tasks Done (`已完成 X / 共 Y 项`) Card (1:1 Fig 6) */}
      {totalTasks > 0 ? (
        <section className={`pmx-aux-prog${progressExpanded ? " pmx-aux-prog--open" : ""}`}>
          <button
            type="button"
            className="pmx-aux-prog-head"
            aria-expanded={progressExpanded}
            onClick={() => setProgressExpanded((v) => !v)}
          >
            {isAllDone ? (
              <span className="pmx-aux-ring-full" aria-hidden="true">
                ✓
              </span>
            ) : (
              <svg
                className="pmx-aux-ring"
                width="18"
                height="18"
                viewBox="0 0 18 18"
                aria-hidden="true"
              >
                <circle
                  className="pmx-aux-ring-trk"
                  cx="9"
                  cy="9"
                  r="7"
                  fill="none"
                  strokeWidth="2.3"
                />
                {doneRatio > 0 ? (
                  <circle
                    className="pmx-aux-ring-done"
                    cx="9"
                    cy="9"
                    r="7"
                    fill="none"
                    strokeWidth="2.3"
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
                    strokeWidth="2.3"
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
                    strokeWidth="2.3"
                    strokeDasharray={`${blkRatio * ringCircumference} ${ringCircumference}`}
                    strokeDashoffset={-(doneRatio + runRatio) * ringCircumference}
                  />
                ) : null}
              </svg>
            )}
            <span className="pmx-aux-prog-label">
              {formatAuxTasksDone(totals.done, totalTasks, model.locale)}
            </span>
            <span className="pmx-aux-prog-right">
              {looseYou.length > 0 ? (
                <span className="pmx-aux-pchip pmx-aux-pchip--warn">
                  <i />
                  {formatAuxNeedsYouChip(looseYou.length, model.locale)}
                </span>
              ) : null}
              {totals.blocked > 0 ? (
                <span className="pmx-aux-pchip pmx-aux-pchip--warn">
                  <i />
                  {formatAuxBlockedChip(totals.blocked, model.locale)}
                </span>
              ) : null}
              {reviewCount > 0 ? (
                <span className="pmx-aux-pchip pmx-aux-pchip--accent">
                  <i />
                  {formatAuxInReviewChip(reviewCount, model.locale)}
                </span>
              ) : null}
              {openThreadsCount > 0 ? (
                <span className="pmx-aux-pchip">
                  {formatAuxThreadsOpenChip(openThreadsCount, model.locale)}
                </span>
              ) : null}
              <ChevronDownIcon
                className={
                  progressExpanded
                    ? "size-3.5 shrink-0 rotate-180 transition-transform"
                    : "size-3.5 shrink-0 transition-transform"
                }
              />
            </span>
          </button>

          {progressExpanded ? (
            <div className="pmx-aux-prog-body">
              {visibleDone.length === 0 && queuedList.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">{s.overviewNoDoneYet}</p>
              ) : (
                <>
                  {visibleDone.length > 0 ? (
                    <ul className="pmx-aux-donelist">
                      {visibleDone.map((ws) => (
                        <li key={ws.id}>
                          <span className="pmx-aux-ti pmx-aux-ti--done" aria-hidden="true">
                            ✓
                          </span>
                          <div className="pmx-aux-donem">
                            <strong>{ws.title}</strong>
                            {ws.note ? (
                              <span>{formatAuxPlainSnippet(ws.note, model.locale)}</span>
                            ) : null}
                          </div>
                          <span className="pmx-aux-wchips">
                            {ws.owners.slice(0, 1).map((o) => renderWorkerChip(o))}
                          </span>
                          {ws.seq > 0 && model.messages.length > 0 ? (
                            <button
                              type="button"
                              className="pmx-aux-seq-pill"
                              onClick={() => onJumpSeq(ws.seq)}
                            >
                              #{ws.seq}
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {hiddenDoneCount > 0 ? (
                    <button
                      type="button"
                      className="pmx-aux-more-btn"
                      onClick={() => setShowAllDone(true)}
                    >
                      +{hiddenDoneCount}
                    </button>
                  ) : null}
                  {queuedList.length > 0 ? (
                    <div className="pmx-aux-queued-sub">
                      <div className="pmx-aux-kicker mb-1">
                        {s.overviewQueuedHeading} · {queuedList.length}
                      </div>
                      <ul className="pmx-aux-donelist">
                        {queuedList.slice(0, 6).map((ws) => (
                          <li key={ws.id}>
                            <span className="pmx-aux-ti pmx-aux-ti--queued" aria-hidden="true" />
                            <div className="pmx-aux-donem">
                              <strong>{ws.title}</strong>
                            </div>
                            <span className="pmx-aux-wchips">
                              {ws.owners.slice(0, 1).map((o) => renderWorkerChip(o))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Block 4: Workgroups (`工作组` / Threads) Accordion Cards (1:1 Fig 6) */}
      {threadRows.length > 0 ? (
        <section className="pmx-aux-threads" data-testid="aux-workgroups-section">
          <div className="pmx-aux-section-head">
            <h3>{s.overviewThreadsHeading}</h3>
            <span>
              {formatAuxThreadsSummary(openThreadsCount, threadRows.length, model.locale)}
            </span>
          </div>

          {threadRows.map((row) => {
            const sum =
              row.counts.done + row.counts.running + row.counts.blocked + row.counts.queued;
            const defaultExpanded =
              row.state === "needs" || row.state === "waiting" || row.state === "stuck";
            const isOpen =
              row.workstreams.length > 0 &&
              (expandedThreadIds.has(row.id) ? !defaultExpanded : defaultExpanded);
            const stateLabel = formatThreadStateLabel(row);
            const sortedWs = [...row.workstreams].sort(
              (a, b) =>
                WS_ORDER[workstreamBucket(a, memberByName)] -
                WS_ORDER[workstreamBucket(b, memberByName)],
            );

            return (
              <div
                key={row.id}
                className={`pmx-aux-th pmx-aux-th--${row.state}${isOpen ? " pmx-aux-th--open" : ""}${row.isAcpDelegated ? " pmx-aux-th--acp" : ""}`}
                data-aux-thread-id={row.id}
              >
                <button
                  type="button"
                  className="pmx-aux-th-head"
                  aria-expanded={isOpen}
                  disabled={row.workstreams.length === 0}
                  onClick={() => toggleThread(row.id)}
                >
                  <span
                    className={`pmx-aux-th-dot pmx-aux-th-dot--${row.state}`}
                    aria-hidden="true"
                  />
                  <span className="pmx-aux-th-title-wrap">
                    <strong title={row.title}>{row.title}</strong>
                    {row.isAcpDelegated ? (
                      <span className="pmx-aux-acp-badge">{s.acpDelegatedBadge}</span>
                    ) : null}
                    {stateLabel !== row.title ? (
                      <em className={`pmx-aux-th-state pmx-aux-th-state--${row.state}`}>
                        {stateLabel}
                      </em>
                    ) : null}
                  </span>
                  <span className="pmx-aux-th-count">
                    {sum > 0 ? (
                      <>
                        <span className="pmx-aux-mbar" aria-hidden="true">
                          {row.counts.done > 0 ? (
                            <i className="done" style={{ flex: row.counts.done }} />
                          ) : null}
                          {row.counts.running > 0 ? (
                            <i className="running" style={{ flex: row.counts.running }} />
                          ) : null}
                          {row.counts.blocked > 0 ? (
                            <i className="blocked" style={{ flex: row.counts.blocked }} />
                          ) : null}
                          {row.counts.queued > 0 ? (
                            <i className="queued" style={{ flex: row.counts.queued }} />
                          ) : null}
                        </span>
                        <span>
                          {row.counts.done}/{sum}
                        </span>
                      </>
                    ) : (
                      <span>{row.asks.length + row.issues.length}</span>
                    )}
                    {row.workstreams.length > 0 ? (
                      <ChevronRightIcon
                        className={
                          isOpen
                            ? "size-3.5 shrink-0 rotate-90 transition-transform"
                            : "size-3.5 shrink-0 transition-transform"
                        }
                      />
                    ) : null}
                  </span>
                </button>

                {row.goal ? <p className="pmx-aux-th-goal">{row.goal}</p> : null}
                {row.now ? (
                  <p className="pmx-aux-th-now">
                    {row.state !== "done" ? <span>{s.overviewNowPrefix}</span> : null}
                    {formatAuxPlainSnippet(row.now, model.locale)}
                  </p>
                ) : null}

                {[...row.asks, ...row.issues].map((att) => (
                  <button
                    key={att.id}
                    type="button"
                    className={`pmx-aux-ask${att.wait === "issue" ? " pmx-aux-ask--issue" : ""}`}
                    onClick={() => {
                      if (att.seq !== null) onJumpSeq(att.seq);
                      else onOpenMemberPosts(att.from);
                    }}
                  >
                    <span className="pmx-aux-ask-dot" aria-hidden="true" />
                    <span className="pmx-aux-ask-body">
                      <strong>{att.title}</strong>
                      {att.why ? <span>{att.why}</span> : null}
                    </span>
                  </button>
                ))}

                {isOpen && sortedWs.length > 0 ? (
                  <ul className="pmx-aux-th-tasks">
                    {sortedWs.map((ws) => {
                      const b = workstreamBucket(ws, memberByName);
                      const waiter = waiterOfWorkstream(ws, memberByName);
                      return (
                        <li key={ws.id} className={`pmx-aux-th-task pmx-aux-th-task--${b}`}>
                          <span className={`pmx-aux-ti pmx-aux-ti--${b}`} aria-hidden="true">
                            {b === "done" ? "✓" : ""}
                          </span>
                          <span className="pmx-aux-th-task-title" title={ws.title}>
                            {ws.title}
                            {waiter ? (
                              <span className="pmx-aux-th-waiter">
                                {formatAuxWaitingOn(waiter, model.locale)}
                              </span>
                            ) : null}
                          </span>
                          {ws.rawState === "review" ? (
                            <span className="pmx-aux-tprog pmx-aux-tprog--rev">
                              {s.stateReview}
                            </span>
                          ) : null}
                          <span className="pmx-aux-wchips">
                            {ws.owners.slice(0, 1).map((o) => renderWorkerChip(o))}
                          </span>
                          {ws.seq > 0 && model.messages.length > 0 ? (
                            <button
                              type="button"
                              className="pmx-aux-seq-pill"
                              onClick={() => onJumpSeq(ws.seq)}
                            >
                              #{ws.seq}
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {/* Block 5: The Team (`协同团队`) — Coordinator Hero + Filterable Roster Strip (1:1 Fig 6) */}
      {teamMembers.length > 0 ? (
        <section className="pmx-aux-team" data-testid="aux-team-section">
          <div className="pmx-aux-section-head">
            <h3>{s.overviewTeamHeading}</h3>
            <span className="flex items-center gap-2">
              <span>{teamCounts.live}</span>
              {teamCounts.retired ? (
                <button type="button" className="pmx-aux-link-btn" onClick={onSwitchToMembers}>
                  {teamCounts.retired}
                </button>
              ) : null}
            </span>
          </div>

          {coordinator ? (
            <div className="pmx-aux-lead">
              <AgentMemberAvatar
                useBees={model.useBees}
                providerBrand={coordinator.providerBrand}
                name={coordinator.name}
                displayName={coordinator.displayName}
                status={coordinator.status}
                color={coordinator.color}
                size="lg"
                isCoordinator
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <strong className="truncate text-[13.5px] font-semibold text-foreground">
                    {coordinator.isCoordinator && model.useBees
                      ? s.roleCoordinator
                      : coordinator.displayName}
                  </strong>
                  <span className="pmx-aux-role-pill">
                    {coordinator.isCoordinator && model.useBees
                      ? formatAuxStatusLabel(
                          coordinator.status,
                          coordinator.waitingOn,
                          model.locale,
                        )
                      : coordinator.status === "working"
                        ? s.roleCoordinatorWorking
                        : s.roleCoordinator}
                  </span>
                </div>
                {coordinator.status === "working" && coordinator.activity ? (
                  <p className="pmx-aux-shimmer mt-1 truncate text-[12px]">
                    {formatAuxPlainSnippet(coordinator.activity, model.locale)}
                  </p>
                ) : (
                  <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">
                    {formatAuxPlainSnippet(coordinator.nowLine, model.locale)}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                  {coordinator.model ? (
                    <span className="font-mono">
                      {formatAuxModelDisplayLabel(coordinator.model)}
                    </span>
                  ) : null}
                  {coordinator.lastSeq > 0 && model.messages.length > 0 ? (
                    <button
                      type="button"
                      className="pmx-aux-seq-pill"
                      onClick={() => onJumpSeq(coordinator.lastSeq)}
                    >
                      #{coordinator.lastSeq}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {liveWorkers.length > 0 ? (
            <div
              className={
                model.useBees
                  ? "pmx-aux-crew pmx-aux-crew--bees"
                  : "pmx-aux-crew pmx-aux-crew--bare"
              }
              role="group"
              aria-label={s.overviewTeamHeading}
            >
              <button
                type="button"
                className={[
                  "pmx-aux-crew-btn",
                  !model.useBees ? "pmx-aux-crew-btn--bare" : "",
                  effectiveFilter === null ? "pmx-aux-crew-btn--on" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-pressed={effectiveFilter === null}
                onClick={() => onSelectTeamMember(null)}
              >
                <span className="pmx-aux-crew-icon" aria-hidden="true">
                  {model.useBees ? (
                    <SwarmMiniCluster names={teamMembers.map((m) => m.name)} />
                  ) : (
                    <span className="pmx-aux-all-bare" data-aux-all-bare="1">
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 18 18"
                        fill="none"
                        preserveAspectRatio="xMidYMid meet"
                        style={{ display: "block" }}
                      >
                        <rect
                          x="1.5"
                          y="1.5"
                          width="6"
                          height="6"
                          rx="2"
                          fill="currentColor"
                          fillOpacity="0.88"
                        />
                        <rect
                          x="10.5"
                          y="1.5"
                          width="6"
                          height="6"
                          rx="2"
                          fill="currentColor"
                          fillOpacity="0.58"
                        />
                        <rect
                          x="1.5"
                          y="10.5"
                          width="6"
                          height="6"
                          rx="2"
                          fill="currentColor"
                          fillOpacity="0.58"
                        />
                        <rect
                          x="10.5"
                          y="10.5"
                          width="6"
                          height="6"
                          rx="2"
                          fill="currentColor"
                          fillOpacity="0.38"
                        />
                      </svg>
                    </span>
                  )}
                </span>
                <span className="pmx-aux-crew-name">{s.overviewAllTeam}</span>
              </button>

              {liveWorkers.slice(0, 12).map((member) => {
                const isSel = effectiveFilter === member.name;
                const memberUsesBees = model.useBees && member.sourceKind !== "acp-delegated";
                const memberHandle = formatAuxBoardMemberHandle(member.name, model.locale, member);
                return (
                  <button
                    key={member.id}
                    type="button"
                    className={[
                      "pmx-aux-crew-btn",
                      !memberUsesBees ? "pmx-aux-crew-btn--bare" : "",
                      isSel ? "pmx-aux-crew-btn--on" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-pressed={isSel}
                    title={`${memberHandle} · ${formatAuxStatusLabel(member.status, member.waitingOn, model.locale)}`}
                    onClick={() => onSelectTeamMember(isSel ? null : member.name)}
                  >
                    <span className="pmx-aux-crew-icon" aria-hidden="true">
                      <AgentMemberAvatar
                        useBees={memberUsesBees}
                        providerBrand={member.providerBrand}
                        name={member.name}
                        displayName={member.displayName}
                        status={member.status}
                        color={member.color}
                        size="sm"
                      />
                    </span>
                    <span className="pmx-aux-crew-name">{memberHandle}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
});
