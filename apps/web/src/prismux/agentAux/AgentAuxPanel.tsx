import type { ThreadId } from "@prismux/core-contracts";
import { ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { AgentBrandLogo } from "../agentBrand";
import {
  formatAuxEntryBadge,
  getAuxStrings,
  useAgentAuxLocale,
  type AgentAuxLocale,
} from "./agentAux.i18n";
import {
  formatAuxTaskStatusLabel,
  type AgentAuxTabId,
  type AgentAuxViewModel,
} from "./agentAux.logic";
import { AgentAuxBoardTab } from "./AgentAuxBoardTab";
import { AgentAuxGraphTab } from "./AgentAuxGraphTab";
import { AgentAuxMembersTab } from "./AgentAuxMembersTab";
import { AgentAuxOverviewTab } from "./AgentAuxOverviewTab";
import { SwarmMiniBeeGlyph } from "./SwarmBeeSprite";
import "./agentAux.css";

export interface AgentAuxOverviewEntryData {
  readonly active: boolean;
  readonly hasLiveActivity: boolean;
  readonly kind: AgentAuxViewModel["kind"];
  readonly locale?: AgentAuxLocale;
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
    locale: model.locale,
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
 * Clickable entry row rendered inside SessionOverviewPanel.
 * Renders nothing (`null`) when the thread has no active or inspectable multi-agent session.
 */
export function AgentAuxOverviewEntryButton(props: {
  readonly entry: AgentAuxOverviewEntryData | null | undefined;
  readonly onOpen: (() => void) | undefined;
  readonly locale?: AgentAuxLocale;
}) {
  const { entry, onOpen, locale: localeProp } = props;
  const resolvedLocale = useAgentAuxLocale(localeProp ?? entry?.locale);
  if (!entry?.active || !onOpen) return null;

  const badgeText = formatAuxEntryBadge(entry.activeCount, entry.memberCount, resolvedLocale);

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
          <SwarmMiniBeeGlyph size={15} />
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
  readonly locale?: AgentAuxLocale | undefined;
}

export function AgentAuxPanel(props: AgentAuxPanelProps) {
  const {
    model,
    isLoading = false,
    onRefresh,
    onOpenChildThread,
    initialTab,
    locale: localeProp,
  } = props;

  const resolvedLocale = useAgentAuxLocale(localeProp ?? model?.locale);
  const s = getAuxStrings(resolvedLocale);

  const [selectedTab, setSelectedTab] = useState<AgentAuxTabId>(
    initialTab ?? model?.defaultTab ?? "overview",
  );
  const [selectedTeamMember, setSelectedTeamMember] = useState<string | null>(null);
  const [boardSenderFilter, setBoardSenderFilter] = useState("");
  const [flashSeq, setFlashSeq] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const effectiveModel = useMemo<AgentAuxViewModel | null>(() => {
    if (!model) return null;
    if (model.locale === resolvedLocale) return model;
    return { ...model, locale: resolvedLocale };
  }, [model, resolvedLocale]);

  const activeTab: AgentAuxTabId = useMemo(() => {
    if (!effectiveModel || !effectiveModel.active || effectiveModel.tabs.length === 0) {
      return "overview";
    }
    if (effectiveModel.tabs.some((t) => t.id === selectedTab)) return selectedTab;
    return effectiveModel.defaultTab;
  }, [effectiveModel, selectedTab]);

  const handleJumpSeq = useCallback((seq: number) => {
    setSelectedTab("board");
    setBoardSenderFilter("");
    setFlashSeq(seq);
  }, []);

  const handleOpenMemberPosts = useCallback((name: string) => {
    setSelectedTab("board");
    setBoardSenderFilter(name);
    setFlashSeq(null);
  }, []);

  const handleClearFlash = useCallback(() => {
    setFlashSeq(null);
  }, []);

  if (!effectiveModel || !effectiveModel.active) {
    return (
      <div className="pmx-aux-pane" data-agent-aux-empty="1">
        <div className="pmx-aux-header">
          <div className="pmx-aux-header-row">
            <h2 className="pmx-aux-title">{s.panelEmptyHeader}</h2>
          </div>
        </div>
        <div className="pmx-aux-scroll flex flex-col items-center justify-center text-center">
          <p className="text-[13.5px] font-medium text-foreground">{s.panelEmptyTitle}</p>
          <p className="mt-1.5 max-w-[260px] text-[12px] text-muted-foreground">
            {s.panelEmptyBody}
          </p>
        </div>
      </div>
    );
  }

  const liveBadgeText = effectiveModel.hasLiveActivity
    ? s.headerLive
    : effectiveModel.finished
      ? s.headerCompleted
      : s.headerIdle;

  return (
    <div
      className="pmx-aux-pane"
      data-agent-aux-panel="1"
      data-agent-aux-kind={effectiveModel.kind ?? undefined}
      data-agent-aux-locale={effectiveModel.locale}
    >
      {/* Sticky Header & 4-Tab Underline Navigation (ZERO nested backdrop-filter) */}
      <header className="pmx-aux-header">
        <div className="pmx-aux-header-row">
          <span className="pmx-aux-brand-mark" aria-hidden="true">
            {effectiveModel.useBees ? (
              <SwarmMiniBeeGlyph size={16} />
            ) : (
              <AgentBrandLogo
                provider={effectiveModel.providerBrand}
                size={16}
                online={effectiveModel.hasLiveActivity}
                breathing={effectiveModel.hasLiveActivity}
              />
            )}
          </span>
          <h2 className="pmx-aux-title" title={effectiveModel.title}>
            {effectiveModel.title}
          </h2>
          <span
            className={
              effectiveModel.hasLiveActivity ? "pmx-aux-live" : "pmx-aux-live pmx-aux-live--idle"
            }
            data-testid="aux-live-pill"
          >
            <i className="pmx-aux-live-dot" aria-hidden="true" />
            <span>{liveBadgeText}</span>
          </span>
          {onRefresh ? (
            <button
              type="button"
              className="pmx-aux-icon-btn"
              disabled={isLoading}
              aria-label={s.headerRefresh}
              title={s.headerRefresh}
              onClick={onRefresh}
            >
              <RefreshCwIcon className={isLoading ? "size-3.5 animate-spin" : "size-3.5"} />
            </button>
          ) : null}
        </div>

        {/* Underline Tabs (`概览`, `看板 N`, `成员 N`, `关系图`, optional `任务 N`) */}
        <nav className="pmx-aux-tabs" role="tablist" aria-label={s.panelTablistAria}>
          {effectiveModel.tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                data-aux-tab={tab.id}
                aria-selected={isActive}
                className={isActive ? "pmx-aux-tab pmx-aux-tab--active" : "pmx-aux-tab"}
                onClick={() => setSelectedTab(tab.id)}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 ? (
                  <span className="pmx-aux-tab-count">{tab.count}</span>
                ) : null}
                {tab.badge !== undefined && tab.badge > 0 ? (
                  <span className="pmx-aux-tab-badge">{tab.badge}</span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Scrollable Active Tab Body */}
      <div ref={scrollRef} className="pmx-aux-scroll">
        {activeTab === "overview" ? (
          <AgentAuxOverviewTab
            model={effectiveModel}
            selectedTeamMember={selectedTeamMember}
            onSelectTeamMember={setSelectedTeamMember}
            onJumpSeq={handleJumpSeq}
            onOpenMemberPosts={handleOpenMemberPosts}
            onSwitchToMembers={() => setSelectedTab("members")}
          />
        ) : null}

        {activeTab === "board" ? (
          <AgentAuxBoardTab
            model={effectiveModel}
            senderFilter={boardSenderFilter}
            onChangeSenderFilter={setBoardSenderFilter}
            flashSeq={flashSeq}
            onJumpSeq={handleJumpSeq}
            onClearFlash={handleClearFlash}
            scrollContainerRef={scrollRef}
          />
        ) : null}

        {activeTab === "members" ? (
          <AgentAuxMembersTab
            model={effectiveModel}
            onOpenMemberPosts={handleOpenMemberPosts}
            onJumpSeq={handleJumpSeq}
            onOpenChildThread={onOpenChildThread}
          />
        ) : null}

        {activeTab === "graph" ? (
          <AgentAuxGraphTab
            model={effectiveModel}
            onJumpSeq={handleJumpSeq}
            onOpenMemberPosts={handleOpenMemberPosts}
          />
        ) : null}

        {activeTab === "tasks" ? (
          <div className="pmx-aux-stack" data-aux-section="tasks">
            {effectiveModel.tasks.length === 0 ? (
              <div className="pmx-aux-empty-inline">
                <p>{s.tasksEmpty}</p>
              </div>
            ) : (
              effectiveModel.tasks.map((task) => (
                <div key={task.id} className="pmx-aux-task-card">
                  <div className="flex items-start justify-between gap-2">
                    <strong className="text-[13px] font-semibold text-foreground">
                      {task.subject}
                    </strong>
                    <span className={`pmx-aux-badge pmx-aux-badge--${task.status}`}>
                      {formatAuxTaskStatusLabel(task.status, effectiveModel.locale)}
                    </span>
                  </div>
                  {task.description ? (
                    <p className="text-[12px] text-muted-foreground">{task.description}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {task.owner ? (
                      <span>
                        {s.tasksOwnerPrefix}@{task.owner}
                      </span>
                    ) : null}
                    {task.progressLabel ? (
                      <span className="font-mono">{task.progressLabel}</span>
                    ) : null}
                    {task.blockedBy.map((dep) => (
                      <span key={dep} className="pmx-aux-badge pmx-aux-badge--blocked">
                        {s.tasksBlockedByPrefix}
                        {dep}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
