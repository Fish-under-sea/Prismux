import { scopeThreadRef, scopedThreadKey } from "@prismux/client-runtime/environment";
import { threadRuntimeIsActive } from "@prismux/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@prismux/core-contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleCheckBigIcon,
  CircleIcon,
  Columns3Icon,
  FolderGit2Icon,
  GitBranchIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState, type DragEvent } from "react";

import { cn } from "~/lib/utils";
import { useProjects, useVisibleThreadShells } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { buildThreadRouteParams } from "~/threadRoutes";
import { pullRequestProjectKey } from "../pullRequest/PullRequestListFilters";
import { useNavigateToMainApp } from "../sidebar/mainAppLocation";
import { requestOpenCreateWorkspace } from "../sidebar/prismuxSidebarQuickNav.logic";
import { formatRelativeTaskTime } from "../tasks/tasksView.logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarInset } from "../ui/sidebar";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  PrismuxStageFrame,
  useWorkspaceTopbarPortal,
} from "../workspace/WorkspaceTopbarPortalContext";
import {
  buildWorkspaceBoardProjection,
  EMPTY_WORKSPACE_BOARD_FILTERS,
  moveWorkspaceCardToLane,
  pinWorkspaceCard,
  readWorkspaceBoardState,
  resetWorkspaceLaneOverrides,
  resolveWorkspaceBoardLaneDisplay,
  togglePinWorkspaceCard,
  unpinWorkspaceCard,
  useWorkspaceBoardCopy,
  WORKSPACE_BOARD_LANES,
  writeWorkspaceBoardState,
  type WorkspaceBoardCard,
  type WorkspaceBoardCardInput,
  type WorkspaceBoardFilters,
  type WorkspaceBoardLaneId,
  type WorkspaceBoardPersistedState,
} from "./workspaceBoard.logic";

const DRAG_MIME_TYPE = "application/x-prismux-workspace-card";

function LaneStatusIcon({
  laneId,
  className,
}: {
  readonly laneId: WorkspaceBoardLaneId;
  readonly className?: string;
}) {
  switch (laneId) {
    case "todo":
      return <CircleIcon aria-hidden="true" className={className} />;
    case "in-progress":
      return <CircleAlertIcon aria-hidden="true" className={className} />;
    case "in-review":
      return <CheckCircle2Icon aria-hidden="true" className={className} />;
    case "done":
      return <CircleCheckBigIcon aria-hidden="true" className={className} />;
  }
}

/**
 * 1:1 Orca-aligned "Workspace board" (`工作区板`) 4-column board
 * (`Todo` / `In progress` / `In review` / `Done`) with top Pinned drag-drop zone,
 * live search, filter/settings menus, and seamless concave-corner liquid glass framing.
 */
export const WorkspaceBoardPage = memo(function WorkspaceBoardPage() {
  const copy = useWorkspaceBoardCopy();
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const topbarPortal = useWorkspaceTopbarPortal();
  const projects = useProjects();
  const visibleThreads = useVisibleThreadShells();
  const { environments } = useEnvironments();

  const [boardState, setBoardState] = useState<WorkspaceBoardPersistedState>(() =>
    readWorkspaceBoardState(),
  );
  const [filters, setFilters] = useState<WorkspaceBoardFilters>(EMPTY_WORKSPACE_BOARD_FILTERS);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [draggingCardKey, setDraggingCardKey] = useState<string | null>(null);
  const [dragOverLane, setDragOverLane] = useState<WorkspaceBoardLaneId | null>(null);
  const [isDragOverPinTarget, setIsDragOverPinTarget] = useState(false);

  const updateBoardState = useCallback(
    (updater: (current: WorkspaceBoardPersistedState) => WorkspaceBoardPersistedState) => {
      setBoardState((current) => {
        const next = updater(current);
        if (next !== current) {
          writeWorkspaceBoardState(next);
        }
        return next;
      });
    },
    [],
  );

  // Close with Escape when no input or popover holds focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (filterMenuOpen || settingsMenuOpen) return;
      event.preventDefault();
      void navigateToMainApp();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filterMenuOpen, navigateToMainApp, settingsMenuOpen]);

  const environmentLabels = useMemo(
    () => new Map(environments.map((env) => [env.environmentId, env.label] as const)),
    [environments],
  );

  const projectByKey = useMemo(() => {
    const map = new Map<string, (typeof projects)[number]>();
    for (const project of projects) {
      map.set(pullRequestProjectKey(project), project);
    }
    return map;
  }, [projects]);

  const cardInputs = useMemo<readonly WorkspaceBoardCardInput[]>(() => {
    const rows: WorkspaceBoardCardInput[] = [];
    for (const thread of visibleThreads) {
      // Keep top-level workspace threads on the board (subagents stay nested under parents).
      if (thread.lineage.parentThreadId !== null) continue;
      if (thread.deletedAt !== null) continue;
      const projectKey = pullRequestProjectKey({
        environmentId: thread.environmentId,
        id: thread.projectId,
      });
      const project = projectByKey.get(projectKey);
      const ref = scopeThreadRef(thread.environmentId, thread.id);
      rows.push({
        key: scopedThreadKey(ref),
        environmentId: thread.environmentId,
        threadId: thread.id,
        projectKey,
        projectTitle: project?.title ?? thread.projectId,
        environmentLabel: environmentLabels.get(thread.environmentId) ?? null,
        title: thread.title.trim() || (copy.isZh ? "未命名会话" : "Untitled workspace"),
        branch: thread.branch,
        modelName: thread.modelSelection.model ?? null,
        updatedAt: thread.updatedAt,
        archivedAt: thread.archivedAt,
        settledOverride: thread.settledOverride,
        settledAt: thread.settledAt,
        pinnedAt: thread.pinnedAt,
        isRunning: threadRuntimeIsActive(thread.runtime),
        hasPendingApprovals: thread.hasPendingApprovals,
        hasPendingUserInput: thread.hasPendingUserInput,
        hasActionableProposedPlan: thread.hasActionableProposedPlan,
        hasPendingBackgroundTasks: thread.pendingBackgroundTasks.length > 0,
        pullRequestsCount: thread.pullRequests.length,
      });
    }
    return rows;
  }, [copy.isZh, environmentLabels, projectByKey, visibleThreads]);

  const projection = useMemo(
    () => buildWorkspaceBoardProjection(cardInputs, boardState, filters),
    [boardState, cardInputs, filters],
  );

  const filterProjectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of cardInputs) {
      if (!seen.has(item.projectKey)) {
        seen.set(item.projectKey, item.projectTitle);
      }
    }
    return [...seen.entries()].map(([key, title]) => ({ key, title }));
  }, [cardInputs]);

  const activeFilterCount =
    (filters.projectKey ? 1 : 0) + (filters.pinnedOnly ? 1 : 0) + (filters.activeOnly ? 1 : 0);

  const handleOpenCard = (card: WorkspaceBoardCard) => {
    const ref = scopeThreadRef(card.environmentId as EnvironmentId, card.threadId as ThreadId);
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(ref),
    });
  };

  const extractDraggedKey = (event: DragEvent): string | null => {
    const fromMime = event.dataTransfer.getData(DRAG_MIME_TYPE);
    if (fromMime) return fromMime;
    const fromPlain = event.dataTransfer.getData("text/plain");
    if (fromPlain) return fromPlain;
    return draggingCardKey;
  };

  const handleCardDragStart = (event: DragEvent<HTMLDivElement>, cardKey: string) => {
    setDraggingCardKey(cardKey);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_MIME_TYPE, cardKey);
    event.dataTransfer.setData("text/plain", cardKey);
  };

  const handleCardDragEnd = () => {
    setDraggingCardKey(null);
    setDragOverLane(null);
    setIsDragOverPinTarget(false);
  };

  const handlePinZoneDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!isDragOverPinTarget) setIsDragOverPinTarget(true);
    if (dragOverLane !== null) setDragOverLane(null);
  };

  const handlePinZoneDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const key = extractDraggedKey(event);
    setIsDragOverPinTarget(false);
    setDraggingCardKey(null);
    if (!key) return;
    updateBoardState((current) => pinWorkspaceCard(current, key));
  };

  const handleLaneDragOver = (event: DragEvent<HTMLElement>, laneId: WorkspaceBoardLaneId) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverLane !== laneId) setDragOverLane(laneId);
    if (isDragOverPinTarget) setIsDragOverPinTarget(false);
  };

  const handleLaneDrop = (event: DragEvent<HTMLElement>, laneId: WorkspaceBoardLaneId) => {
    event.preventDefault();
    const key = extractDraggedKey(event);
    setDragOverLane(null);
    setDraggingCardKey(null);
    if (!key) return;
    updateBoardState((current) => moveWorkspaceCardToLane(current, key, laneId));
  };

  return (
    <SidebarInset className="h-dvh min-w-0 flex-1 overflow-hidden">
      <PrismuxStageFrame
        glassZone="workPanels"
        rightPanelOpen={topbarPortal.standaloneRightPanelOpen}
      >
        <div
          data-testid="prismux-workspace-board-page"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {/* Top Header Bar: Icon + Title + Search input ... Filter + View Settings + Close × */}
          <header className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-border/65 px-4 py-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex shrink-0 items-center gap-2">
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/14 text-primary">
                  <Columns3Icon className="size-4" aria-hidden="true" />
                </span>
                <h1 className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
                  <span>{copy.title}</span>
                  {projection.totalCount > 0 ? (
                    <span className="rounded-full border border-border/65 bg-muted/75 px-2 py-0.5 text-[11px] font-medium text-foreground/85 tabular-nums">
                      {projection.isFiltering
                        ? `${projection.matchCount} / ${projection.totalCount}`
                        : projection.totalCount}
                    </span>
                  ) : null}
                </h1>
              </div>

              <div className="relative min-w-0 flex-1 max-w-xs">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  data-testid="workspace-board-search-input"
                  data-pmx-work-panel-control="1"
                  value={filters.query}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, query: event.target.value }))
                  }
                  placeholder={copy.searchPlaceholder}
                  className="h-8 rounded-lg border-border/75 bg-card pr-7 pl-8 text-xs text-foreground shadow-xs"
                />
                {filters.query.length > 0 ? (
                  <button
                    type="button"
                    aria-label={copy.clearSearchLabel}
                    onClick={() => setFilters((current) => ({ ...current, query: "" }))}
                    className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {/* Filter Popover */}
              <Popover open={filterMenuOpen} onOpenChange={setFilterMenuOpen}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <PopoverTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            data-testid="workspace-board-filter-trigger"
                            aria-label={copy.filterTooltip}
                            className={cn(
                              "relative size-7 rounded-md text-muted-foreground hover:bg-muted/65 hover:text-foreground",
                              activeFilterCount > 0 && "bg-accent/70 text-foreground",
                            )}
                          />
                        }
                      />
                    }
                  >
                    <SlidersHorizontalIcon className="size-3.5" />
                    {activeFilterCount > 0 ? (
                      <span className="pointer-events-none absolute -top-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
                        {activeFilterCount}
                      </span>
                    ) : null}
                  </TooltipTrigger>
                  <TooltipPopup side="bottom" sideOffset={6}>
                    {copy.filterTooltip}
                  </TooltipPopup>
                </Tooltip>
                <PopoverPopup side="bottom" align="end" sideOffset={6} className="w-64 p-2.5">
                  <div className="space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">{copy.filterTitle}</span>
                      {activeFilterCount > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setFilters((current) => ({
                              ...EMPTY_WORKSPACE_BOARD_FILTERS,
                              query: current.query,
                            }))
                          }
                          className="cursor-pointer text-[11px] text-primary hover:underline"
                        >
                          {copy.filterReset}
                        </button>
                      ) : null}
                    </div>

                    <label className="flex cursor-pointer items-center justify-between gap-2">
                      <span className="text-muted-foreground">{copy.filterPinnedOnly}</span>
                      <Switch
                        checked={filters.pinnedOnly}
                        onCheckedChange={(checked) =>
                          setFilters((current) => ({ ...current, pinnedOnly: checked }))
                        }
                      />
                    </label>

                    <label className="flex cursor-pointer items-center justify-between gap-2">
                      <span className="text-muted-foreground">{copy.filterActiveOnly}</span>
                      <Switch
                        checked={filters.activeOnly}
                        onCheckedChange={(checked) =>
                          setFilters((current) => ({ ...current, activeOnly: checked }))
                        }
                      />
                    </label>

                    {filterProjectOptions.length > 0 ? (
                      <div className="space-y-1 border-t border-border/50 pt-2">
                        <button
                          type="button"
                          onClick={() =>
                            setFilters((current) => ({ ...current, projectKey: null }))
                          }
                          className={cn(
                            "flex w-full cursor-pointer items-center justify-between rounded px-2 py-1 text-left transition-colors",
                            filters.projectKey === null
                              ? "bg-primary text-primary-foreground font-medium"
                              : "text-foreground/85 hover:bg-accent hover:text-foreground",
                          )}
                        >
                          <span className="truncate">{copy.filterAllProjects}</span>
                        </button>
                        {filterProjectOptions.map((project) => (
                          <button
                            key={project.key}
                            type="button"
                            onClick={() =>
                              setFilters((current) => ({ ...current, projectKey: project.key }))
                            }
                            className={cn(
                              "flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left transition-colors",
                              filters.projectKey === project.key
                                ? "bg-primary text-primary-foreground font-medium"
                                : "text-foreground/85 hover:bg-accent hover:text-foreground",
                            )}
                          >
                            <FolderGit2Icon className="size-3 shrink-0 opacity-75" />
                            <span className="truncate">{project.title}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </PopoverPopup>
              </Popover>

              {/* View Settings Popover */}
              <Popover open={settingsMenuOpen} onOpenChange={setSettingsMenuOpen}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <PopoverTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            data-testid="workspace-board-settings-trigger"
                            aria-label={copy.settingsTooltip}
                            className="size-7 rounded-md text-muted-foreground hover:bg-muted/65 hover:text-foreground"
                          />
                        }
                      />
                    }
                  >
                    <Settings2Icon className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipPopup side="bottom" sideOffset={6}>
                    {copy.settingsTooltip}
                  </TooltipPopup>
                </Tooltip>
                <PopoverPopup side="bottom" align="end" sideOffset={6} className="w-60 p-2.5">
                  <div className="space-y-3 text-xs">
                    <div className="font-semibold text-foreground">{copy.settingsTitle}</div>
                    <label className="flex cursor-pointer items-center justify-between gap-2">
                      <span className="text-muted-foreground">{copy.settingCompactCards}</span>
                      <Switch
                        checked={boardState.compactMode}
                        onCheckedChange={(checked) =>
                          updateBoardState((current) => ({ ...current, compactMode: checked }))
                        }
                      />
                    </label>
                    <label className="flex cursor-pointer items-center justify-between gap-2">
                      <span className="text-muted-foreground">{copy.settingShowBranch}</span>
                      <Switch
                        checked={boardState.showBranchBadge}
                        onCheckedChange={(checked) =>
                          updateBoardState((current) => ({
                            ...current,
                            showBranchBadge: checked,
                          }))
                        }
                      />
                    </label>
                    <div className="border-t border-border/50 pt-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={Object.keys(boardState.laneOverrides).length === 0}
                        onClick={() =>
                          updateBoardState((current) => resetWorkspaceLaneOverrides(current))
                        }
                        className="w-full justify-start gap-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <RotateCcwIcon className="size-3.5" />
                        {copy.settingResetOverrides}
                      </Button>
                    </div>
                  </div>
                </PopoverPopup>
              </Popover>

              {/* Close × button */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      data-testid="workspace-board-close-button"
                      onClick={() => void navigateToMainApp()}
                      aria-label={copy.closeLabel}
                      className="size-7 rounded-md text-muted-foreground hover:bg-muted/65 hover:text-foreground"
                    />
                  }
                >
                  <XIcon className="size-4" />
                </TooltipTrigger>
                <TooltipPopup side="bottom" sideOffset={6}>
                  {copy.closeTooltip}
                </TooltipPopup>
              </Tooltip>
            </div>
          </header>

          {/* Board Body: Pinned Drag-Drop Slot + 4 Colored Frosted Glass Lanes */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            {/* Pinned Drop Target (1:1 Orca WorkspaceKanbanPinDropTarget) */}
            <div
              data-testid="workspace-board-pin-drop-target"
              data-workspace-pin-drop-target=""
              data-pmx-work-panel-card="1"
              data-drag-over={isDragOverPinTarget ? "true" : "false"}
              onDragOver={handlePinZoneDragOver}
              onDragLeave={() => setIsDragOverPinTarget(false)}
              onDrop={handlePinZoneDrop}
              className={cn(
                "mb-3 flex min-h-10 shrink-0 flex-wrap items-center gap-2 rounded-xl border border-dashed border-border/80 bg-card px-3.5 py-2 text-xs text-muted-foreground shadow-xs transition-colors",
                isDragOverPinTarget &&
                  "border-primary bg-primary/15 text-foreground ring-1 ring-primary/35",
              )}
            >
              <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-foreground">
                <PinIcon className="size-3.5" />
                <span>{copy.pinnedTitle}</span>
              </span>

              {projection.pinnedCards.length === 0 ? (
                <span className="truncate">
                  {isDragOverPinTarget ? copy.pinnedDropActiveHint : copy.pinnedDropHint}
                </span>
              ) : (
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  {projection.pinnedCards.map((card) => (
                    <div
                      key={card.key}
                      data-pmx-work-panel-control="1"
                      className="group/pinchip inline-flex max-w-[220px] items-center gap-1 rounded-md border border-border/75 bg-muted/70 px-2 py-0.5 text-[11px] text-foreground shadow-xs"
                    >
                      <button
                        type="button"
                        onClick={() => handleOpenCard(card)}
                        className="min-w-0 flex-1 cursor-pointer truncate text-left font-medium hover:text-primary"
                      >
                        {card.title}
                      </button>
                      <button
                        type="button"
                        aria-label={copy.unpinAction}
                        title={copy.unpinAction}
                        onClick={() =>
                          updateBoardState((current) => unpinWorkspaceCard(current, card.key))
                        }
                        className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100"
                      >
                        <XIcon className="size-3" />
                      </button>
                    </div>
                  ))}
                  {isDragOverPinTarget ? (
                    <span className="text-[11px] font-medium text-primary">
                      {copy.pinnedDropActiveHint}
                    </span>
                  ) : null}
                </div>
              )}
            </div>

            {/* 4 Frosted-Glass Status Columns (Todo / In progress / In review / Done) */}
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-x-auto sm:grid-cols-2 xl:grid-cols-4">
              {WORKSPACE_BOARD_LANES.map((lane) => {
                const cards = projection.lanes[lane.id];
                const totalInLane = projection.laneTotals[lane.id];
                const isDragTarget = dragOverLane === lane.id;
                const laneDisplay = resolveWorkspaceBoardLaneDisplay(lane, copy.isZh);
                const createTooltip = copy.createWorkspaceTooltip(laneDisplay.primary);

                return (
                  <section
                    key={lane.id}
                    aria-label={laneDisplay.accessibleLabel}
                    data-testid={`workspace-board-lane-${lane.id}`}
                    data-lane-id={lane.id}
                    data-pmx-work-panel-card="1"
                    data-drag-target={isDragTarget ? "true" : "false"}
                    onDragOver={(event) => handleLaneDragOver(event, lane.id)}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setDragOverLane((current) => (current === lane.id ? null : current));
                      }
                    }}
                    onDrop={(event) => handleLaneDrop(event, lane.id)}
                    className={cn(
                      "group/lane relative flex min-h-0 min-w-[230px] flex-col overflow-hidden rounded-xl border border-t-2 border-border/75 bg-card shadow-xs transition-colors",
                      lane.borderTopClass,
                      lane.laneTintClass,
                      isDragTarget && "border-primary/75 ring-1 ring-primary/40",
                    )}
                  >
                    {/* Lane Header: Chinese primary + smaller muted English secondary + count pill */}
                    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/65 py-0 pr-2 pl-3.5">
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <LaneStatusIcon
                          laneId={lane.id}
                          className={cn("size-3.5 shrink-0", lane.iconToneClass)}
                        />
                        <div className="flex min-w-0 items-baseline gap-1.5 overflow-hidden">
                          <span className="shrink-0 text-[13px] font-semibold text-foreground">
                            {laneDisplay.primary}
                          </span>
                          {laneDisplay.secondary ? (
                            <span className="min-w-0 truncate text-[11px] font-normal text-muted-foreground/55">
                              {laneDisplay.secondary}
                            </span>
                          ) : null}
                        </div>
                        <span className="shrink-0 rounded-full border border-border/65 bg-muted/85 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-foreground/85 tabular-nums">
                          {projection.isFiltering
                            ? `${cards.length} / ${totalInLane}`
                            : cards.length}
                        </span>
                      </div>

                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              data-testid={`workspace-board-add-${lane.id}`}
                              aria-label={createTooltip}
                              onClick={() => requestOpenCreateWorkspace()}
                              className="size-6 rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                            />
                          }
                        >
                          <PlusIcon className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipPopup side="bottom" sideOffset={6}>
                          {createTooltip}
                        </TooltipPopup>
                      </Tooltip>
                    </header>

                    {/* Lane Card List */}
                    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-2">
                      {cards.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                          {cards.map((card) => {
                            const isDragging = draggingCardKey === card.key;
                            const needsAttention =
                              card.hasPendingApprovals || card.hasPendingUserInput;
                            return (
                              <div
                                key={card.key}
                                draggable
                                data-testid={`workspace-board-card-${card.threadId}`}
                                data-pmx-work-panel-control="1"
                                onDragStart={(event) => handleCardDragStart(event, card.key)}
                                onDragEnd={handleCardDragEnd}
                                onClick={() => handleOpenCard(card)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    handleOpenCard(card);
                                  }
                                }}
                                className={cn(
                                  "group/card relative flex cursor-pointer flex-col gap-1.5 rounded-lg border border-border/75 bg-card text-left shadow-xs transition-all hover:border-primary/50 hover:bg-accent/55 active:translate-y-px focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                                  boardState.compactMode ? "px-2.5 py-2" : "px-3 py-2.5",
                                  isDragging && "opacity-45",
                                )}
                              >
                                <div className="flex items-start justify-between gap-1.5">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      {card.isRunning ? (
                                        <span
                                          title={copy.statusRunning}
                                          className="size-1.5 shrink-0 animate-pulse rounded-full bg-amber-500"
                                        />
                                      ) : needsAttention ? (
                                        <span
                                          title={copy.statusNeedsAttention}
                                          className="size-1.5 shrink-0 rounded-full bg-rose-500"
                                        />
                                      ) : null}
                                      <span className="truncate text-xs font-medium text-foreground">
                                        {card.title}
                                      </span>
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                      <span className="truncate">{card.projectTitle}</span>
                                      {boardState.showBranchBadge && card.branch ? (
                                        <span className="inline-flex max-w-[110px] items-center gap-0.5 truncate rounded bg-muted/70 px-1 py-px font-mono text-[10px]">
                                          <GitBranchIcon className="size-2.5 shrink-0" />
                                          <span className="truncate">{card.branch}</span>
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    aria-label={card.isPinned ? copy.unpinAction : copy.pinAction}
                                    title={card.isPinned ? copy.unpinAction : copy.pinAction}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      updateBoardState((current) =>
                                        togglePinWorkspaceCard(current, card.key, card.isPinned),
                                      );
                                    }}
                                    className={cn(
                                      "shrink-0 cursor-pointer rounded p-1 transition-opacity hover:bg-muted",
                                      card.isPinned
                                        ? "text-primary opacity-100"
                                        : "text-muted-foreground opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100",
                                    )}
                                  >
                                    {card.isPinned ? (
                                      <PinOffIcon className="size-3" />
                                    ) : (
                                      <PinIcon className="size-3" />
                                    )}
                                  </button>
                                </div>

                                {!boardState.compactMode ? (
                                  <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground/85">
                                    <span className="truncate">
                                      {card.isRunning
                                        ? copy.statusRunning
                                        : needsAttention
                                          ? copy.statusNeedsAttention
                                          : card.pullRequestsCount > 0
                                            ? copy.statusReviewReady
                                            : (card.modelName ?? card.environmentLabel ?? "")}
                                    </span>
                                    <span className="shrink-0 tabular-nums">
                                      {formatRelativeTaskTime(card.updatedAt, copy.isZh)}
                                    </span>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/65 px-3 text-center text-[11px] text-muted-foreground">
                          <LaneStatusIcon
                            laneId={lane.id}
                            className={cn("size-4 opacity-55", lane.iconToneClass)}
                          />
                          <span>
                            {projection.isFiltering ? copy.laneNoMatches : copy.laneEmpty}
                          </span>
                        </div>
                      )}

                      {/* Hover-revealed bottom '+' create button (exact Orca WorkspaceKanbanStatusLane UX) */}
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              variant="secondary"
                              size="xs"
                              aria-label={createTooltip}
                              onClick={() => requestOpenCreateWorkspace()}
                              className="mt-2 h-7 w-full opacity-0 transition-opacity group-hover/lane:opacity-100 group-focus-within/lane:opacity-100"
                            />
                          }
                        >
                          <PlusIcon className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipPopup side="top" sideOffset={6}>
                          {createTooltip}
                        </TooltipPopup>
                      </Tooltip>
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      </PrismuxStageFrame>
    </SidebarInset>
  );
});
