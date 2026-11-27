import type { ThreadId } from "@prismux/core-contracts";
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  FolderGit2Icon,
  ListChecksIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { memo, useMemo, useState } from "react";

import {
  formatAuxDuration,
  formatAuxStepsCount,
  formatAuxWorkspaceBadge,
  getAuxStrings,
} from "./agentAux.i18n";
import {
  formatAuxStatusLabel,
  shortenWorkspacePath,
  type AgentAuxMember,
  type AgentAuxViewModel,
} from "./agentAux.logic";
import { AgentMemberAvatar } from "./SwarmBeeSprite";

export interface AgentAuxMembersTabProps {
  readonly model: AgentAuxViewModel;
  readonly onOpenMemberPosts: (name: string) => void;
  readonly onJumpSeq: (seq: number) => void;
  readonly onOpenChildThread?: ((threadId: ThreadId) => void) | undefined;
}

function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

export const AgentAuxMembersTab = memo(function AgentAuxMembersTab({
  model,
  onOpenMemberPosts,
  onJumpSeq,
  onOpenChildThread,
}: AgentAuxMembersTabProps) {
  const s = getAuxStrings(model.locale);
  const [search, setSearch] = useState("");
  const [retiredExpanded, setRetiredExpanded] = useState(false);
  const [expandedStepIds, setExpandedStepIds] = useState<ReadonlySet<string>>(() => new Set());

  const teamMembers = useMemo(() => model.members.filter((m) => !m.isSystem), [model.members]);

  const normalizedQuery = search.trim().toLowerCase();

  const matchesSearch = (m: AgentAuxMember): boolean => {
    if (!normalizedQuery) return true;
    const hay =
      `${m.name} ${m.displayName} ${m.role} ${m.roleLabel} ${m.model} ${m.brief} ${m.activity} ${m.nowLine} ${m.workspace ?? ""}`.toLowerCase();
    return hay.includes(normalizedQuery);
  };

  const coordinator = useMemo(
    () => teamMembers.find((m) => m.isCoordinator) ?? null,
    [teamMembers],
  );

  const { activeMembers, standbyMembers, retiredMembers } = (() => {
    const nonCoord = teamMembers.filter((m) => !m.isCoordinator && matchesSearch(m));
    const active: AgentAuxMember[] = [];
    const standby: AgentAuxMember[] = [];
    const retired: AgentAuxMember[] = [];

    for (const m of nonCoord) {
      if (m.killed) {
        retired.push(m);
      } else if (
        m.status === "working" ||
        m.status === "waiting_on" ||
        m.status === "needs_you" ||
        m.status === "error"
      ) {
        active.push(m);
      } else {
        standby.push(m);
      }
    }

    const activeOrder: Readonly<Record<AgentAuxMember["status"], number>> = {
      needs_you: 0,
      error: 1,
      waiting_on: 2,
      working: 3,
      parked: 4,
      done: 5,
      killed: 6,
    };
    active.sort(
      (a, b) =>
        (activeOrder[a.status] ?? 9) - (activeOrder[b.status] ?? 9) || b.lastSeq - a.lastSeq,
    );
    standby.sort((a, b) => b.lastSeq - a.lastSeq || a.name.localeCompare(b.name));
    retired.sort((a, b) => b.lastSeq - a.lastSeq || a.name.localeCompare(b.name));

    return { activeMembers: active, standbyMembers: standby, retiredMembers: retired };
  })();

  const coordVisible = coordinator ? matchesSearch(coordinator) : false;
  const effectiveRetiredOpen =
    retiredExpanded || (normalizedQuery.length > 0 && retiredMembers.length > 0);
  const hasAnyMatch =
    coordVisible ||
    activeMembers.length > 0 ||
    standbyMembers.length > 0 ||
    retiredMembers.length > 0;

  const toggleSteps = (memberId: string) => {
    setExpandedStepIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  };

  const renderMemberRow = (member: AgentAuxMember, isRetiredRow = false) => {
    const memberUsesBees = model.useBees && member.sourceKind !== "acp-delegated";
    const isAbsorbedAcp = model.useBees && member.sourceKind === "acp-delegated";
    const shortWs = shortenWorkspacePath(member.workspace);
    const wsBadge = shortWs
      ? formatAuxWorkspaceBadge(member.workspaceMode, shortWs, model.locale)
      : "";
    const statusText = member.isCoordinator
      ? member.status === "working"
        ? s.roleCoordinatorWorking
        : s.roleCoordinator
      : formatAuxStatusLabel(member.status, member.waitingOn, model.locale);

    const hasSteps = Boolean(member.nativeSteps && member.nativeSteps.length > 0);
    const stepsOpen = expandedStepIds.has(member.id);
    const showDisplaySubtitle =
      member.displayName &&
      member.displayName.toLowerCase() !== member.name.toLowerCase() &&
      !member.isCoordinator;

    return (
      <div
        key={member.id}
        className={`pmx-aux-member-row${!model.useBees ? " pmx-aux-member-row--bare" : ""}${isRetiredRow ? " pmx-aux-member-row--retired" : ""}${member.isCoordinator ? " pmx-aux-member-row--coord" : ""}`}
        data-aux-member={member.name}
        role="button"
        tabIndex={0}
        onClick={() => onOpenMemberPosts(member.name)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenMemberPosts(member.name);
          }
        }}
      >
        <div className="pmx-aux-member-avatar">
          <AgentMemberAvatar
            useBees={memberUsesBees}
            providerBrand={member.providerBrand}
            name={member.name}
            displayName={member.displayName}
            status={member.status}
            color={member.color}
            size="md"
            isCoordinator={member.isCoordinator}
          />
        </div>

        <div className="pmx-aux-member-main min-w-0 flex-1">
          {/* Top Line: @name + status pill + ACP badge + #lastSeq */}
          <div className="pmx-aux-member-top">
            <strong className="pmx-aux-member-handle" title={`@${member.name}`}>
              @{member.name}
            </strong>
            {isAbsorbedAcp ? (
              <span className="pmx-aux-acp-badge">{s.acpDelegatedBadge}</span>
            ) : null}
            <span className={`pmx-aux-status-pill pmx-aux-status-pill--${member.status}`}>
              {statusText}
            </span>
            {member.lastSeq > 0 ? (
              <button
                type="button"
                className="pmx-aux-seq-pill ml-auto"
                onClick={(e) => {
                  e.stopPropagation();
                  onJumpSeq(member.lastSeq);
                }}
              >
                #{member.lastSeq}
              </button>
            ) : null}
          </div>

          {/* Brief / Role title */}
          {showDisplaySubtitle || (member.brief && member.brief !== member.nowLine) ? (
            <p className="pmx-aux-member-brief" title={member.brief || member.displayName}>
              {showDisplaySubtitle ? member.displayName : member.brief}
            </p>
          ) : null}

          {/* Meta line: model + workspace pill + channels + metrics */}
          <div className="pmx-aux-member-meta">
            {member.model ? <span className="pmx-aux-member-model">{member.model}</span> : null}
            {wsBadge ? (
              <span className="pmx-aux-ws-pill" title={member.workspace ?? wsBadge}>
                <FolderGit2Icon className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{wsBadge}</span>
              </span>
            ) : null}
            {member.channels && member.channels.length > 0
              ? member.channels.slice(0, 2).map((ch) => (
                  <span key={ch} className="pmx-aux-channel-tag">
                    #{ch}
                  </span>
                ))
              : null}
            {member.metrics?.toolCalls ? (
              <span className="pmx-aux-metric-chip">
                {member.metrics.toolCalls} {model.locale === "zh" ? "次工具" : "tools"}
              </span>
            ) : null}
            {member.metrics?.totalTokens ? (
              <span className="pmx-aux-metric-chip">
                {formatCompactTokens(member.metrics.totalTokens)} tok
              </span>
            ) : null}
            {member.metrics?.durationMs ? (
              <span className="pmx-aux-metric-chip">
                {formatAuxDuration(member.metrics.durationMs, model.locale)}
              </span>
            ) : null}
          </div>

          {/* Live activity shimmer OR latest post snippet */}
          {member.status === "working" && member.activity ? (
            <p className="pmx-aux-member-snippet pmx-aux-shimmer" title={member.activity}>
              {member.activity}
            </p>
          ) : member.failureText ? (
            <p className="pmx-aux-member-snippet pmx-aux-member-snippet--err">
              {member.failureText}
            </p>
          ) : member.lastPostSnippet || member.nowLine ? (
            <p className="pmx-aux-member-snippet" title={member.lastPostSnippet || member.nowLine}>
              {member.lastPostSnippet || member.nowLine}
            </p>
          ) : (
            <p className="pmx-aux-member-snippet pmx-aux-member-snippet--empty">
              {s.membersNoPostsYet}
            </p>
          )}

          {/* Action Row: Open Thread (ACP/Subagent) + Steps drawer */}
          {(member.childThreadId && onOpenChildThread) || hasSteps ? (
            <div className="pmx-aux-member-actions">
              {member.childThreadId && onOpenChildThread ? (
                <button
                  type="button"
                  className="pmx-aux-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenChildThread(member.childThreadId!);
                  }}
                >
                  <ExternalLinkIcon className="size-3" aria-hidden="true" />
                  <span>{s.membersOpenThread}</span>
                </button>
              ) : null}
              {hasSteps ? (
                <button
                  type="button"
                  className="pmx-aux-btn"
                  aria-expanded={stepsOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSteps(member.id);
                  }}
                >
                  <ListChecksIcon className="size-3" aria-hidden="true" />
                  <span>
                    {stepsOpen
                      ? s.membersHideSteps
                      : formatAuxStepsCount(member.nativeSteps!.length, model.locale)}
                  </span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Expandable native steps drawer (row 2 col 2 so row 1 avatar stays dead-center) */}
        {hasSteps && stepsOpen ? (
          <div className="pmx-aux-steps-box" onClick={(e) => e.stopPropagation()}>
            {member.nativeSteps!.map((step) => (
              <div key={step.index} className="pmx-aux-step-item">
                <div className="flex items-center gap-1.5 font-medium">
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    #{step.index}
                  </span>
                  <span className="truncate">{step.text || step.type}</span>
                </div>
                {step.toolCalls.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {step.toolCalls.map((tc) => (
                      <span
                        key={`${step.index}-${tc.name}-${tc.summary}`}
                        className="pmx-aux-inline-code"
                      >
                        {tc.name}
                        {tc.summary ? `: ${tc.summary}` : ""}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="pmx-aux-members-root" data-aux-section="members">
      {/* Sticky Member Search */}
      <div className="pmx-aux-toolbar">
        <label className="pmx-aux-search">
          <SearchIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={s.membersSearchPlaceholder}
            aria-label={s.membersSearchAria}
          />
          {search ? (
            <button
              type="button"
              className="pmx-aux-search-clear"
              aria-label={s.boardClearFilters}
              onClick={() => setSearch("")}
            >
              <XIcon className="size-3" />
            </button>
          ) : null}
        </label>
      </div>

      {!hasAnyMatch ? (
        <div className="pmx-aux-empty-inline">
          <p>{s.membersEmptySearch}</p>
        </div>
      ) : (
        <div className="pmx-aux-members-stack">
          {/* Section 1: Pinned Coordinator separated by hairline */}
          {coordinator && coordVisible ? (
            <section className="pmx-aux-coord-section" data-testid="aux-members-coordinator">
              {renderMemberRow(coordinator)}
            </section>
          ) : null}

          {/* Section 2: Working / Active Members */}
          {activeMembers.length > 0 ? (
            <section className="pmx-aux-member-group" data-testid="aux-members-active">
              <div className="pmx-aux-section-head">
                <h3>{s.membersActiveHeading}</h3>
                <span>{activeMembers.length}</span>
              </div>
              <div className="flex flex-col gap-1">
                {activeMembers.map((m) => renderMemberRow(m))}
              </div>
            </section>
          ) : null}

          {/* Section 3: Standby / Team Members */}
          {standbyMembers.length > 0 ? (
            <section className="pmx-aux-member-group" data-testid="aux-members-standby">
              <div className="pmx-aux-section-head">
                <h3>{model.finished ? s.membersTeamHeading : s.membersStandbyHeading}</h3>
                <span>{standbyMembers.length}</span>
              </div>
              <div className="flex flex-col gap-1">
                {standbyMembers.map((m) => renderMemberRow(m))}
              </div>
            </section>
          ) : null}

          {/* Section 4: Collapsible Retired Members */}
          {retiredMembers.length > 0 ? (
            <section className="pmx-aux-retired-section" data-testid="aux-members-retired">
              <button
                type="button"
                className="pmx-aux-retired-toggle"
                aria-expanded={effectiveRetiredOpen}
                onClick={() => setRetiredExpanded((v) => !v)}
              >
                <ChevronDownIcon
                  className={
                    effectiveRetiredOpen
                      ? "size-3.5 shrink-0 transition-transform"
                      : "size-3.5 shrink-0 -rotate-90 transition-transform"
                  }
                />
                <span>{s.membersRetiredHeading}</span>
                <span className="pmx-aux-retired-count">{retiredMembers.length}</span>
              </button>
              {effectiveRetiredOpen ? (
                <div className="mt-1 flex flex-col gap-1">
                  {retiredMembers.map((m) => renderMemberRow(m, true))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
});
