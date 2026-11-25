import { groupIssues, holdIssuePages, type EnvironmentIssueEntry } from "@prismux/client-runtime/issue-list";
import { isScratchProject } from "@prismux/client-runtime/state/projects";
import type {
  EnvironmentId,
  IssueInvolvement,
  IssueListInput,
  IssueListState,
  ProjectId,
  PullRequestInvolvement,
  PullRequestListInput,
  PullRequestListState,
} from "@prismux/core-contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FolderGit2Icon,
  FolderPlusIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { useScratchProject } from "~/hooks/useScratchProject";
import { cn } from "~/lib/utils";
import { useProjects, useVisibleThreadShells } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { useIssueList } from "~/state/issues";
import { usePullRequestHostList } from "~/state/pullRequests";
import { useDebouncedValue } from "~/state/queries";
import { IssueStateGlyph } from "../issue/issuePresentation";
import { issueFilterProjects, issueListTargets } from "../issue/issuesSearch.logic";
import { pullRequestProjectKey } from "../pullRequest/PullRequestListFilters";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import {
  PullRequestActorAvatar,
  PullRequestLabelChip,
} from "../pullRequest/pullRequestPresentation";
import type { EnvironmentPullRequestEntry } from "../pullRequest/pullRequestList.logic";
import { useNavigateToMainApp } from "../sidebar/mainAppLocation";
import { requestOpenCreateWorkspace } from "../sidebar/prismuxSidebarQuickNav.logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarInset } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  PrismuxStageFrame,
  useWorkspaceTopbarPortal,
} from "../workspace/WorkspaceTopbarPortalContext";
import {
  applyTasksQueryPatch,
  DEFAULT_ISSUES_QUERY,
  DEFAULT_PRS_QUERY,
  formatRelativeTaskTime,
  normalizeSelectedTaskProjectKeys,
  parseTasksQuery,
  readSelectedTaskProjectKeys,
  resolveTasksEmptyState,
  useTasksViewCopy,
  writeSelectedTaskProjectKeys,
  type TasksInvolvementFilter,
  type TasksItemStateFilter,
  type TasksSortOrder,
  type TasksTabMode,
} from "./tasksView.logic";

const PAGE_LIMIT = 50;

function GitHubMark({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-3.5", className)}
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.16-.02-2.11-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18.92-.26 1.9-.38 2.88-.39.98.01 1.96.13 2.88.39 2.2-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.26 5.67.42.36.79 1.06.79 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.66.79.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function PresetChip({
  label,
  active,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-pmx-work-panel-control={active ? undefined : "1"}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 cursor-pointer items-center rounded-lg border px-2.5 text-xs font-medium transition-all outline-none active:translate-y-px focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary bg-primary font-semibold text-primary-foreground shadow-xs"
          : "border-border/75 bg-card text-foreground/90 shadow-xs hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

/**
 * 1:1 Orca-aligned "Tasks" (`任务面板`) aggregated GitHub Issues / PRs / Projects view,
 * rendered natively inside Prismux's concave-corner liquid glass stage frame.
 */
export const TasksPage = memo(function TasksPage() {
  const copy = useTasksViewCopy();
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const topbarPortal = useWorkspaceTopbarPortal();
  const { environments } = useEnvironments();
  const projects = useProjects();
  const visibleThreads = useVisibleThreadShells();
  const { scratchWorkspaceRootFor } = useScratchProject();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [tabMode, setTabMode] = useState<TasksTabMode>("issues");
  const [sortOrder, setSortOrder] = useState<TasksSortOrder>("updated");
  const [issueQuery, setIssueQuery] = useState<string>(DEFAULT_ISSUES_QUERY);
  const [prQuery, setPrQuery] = useState<string>(DEFAULT_PRS_QUERY);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const [persistedProjectKeys, setPersistedProjectKeys] = useState<readonly string[] | null>(() =>
    readSelectedTaskProjectKeys(),
  );

  // Close with Escape when no input/dialog holds focus.
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
      if (projectPickerOpen || filterPopoverOpen) return;
      event.preventDefault();
      void navigateToMainApp();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filterPopoverOpen, navigateToMainApp, projectPickerOpen]);

  const activeProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          project.archivedAt === null &&
          !isScratchProject(project, scratchWorkspaceRootFor(project.environmentId)),
      ),
    [projects, scratchWorkspaceRootFor],
  );

  const environmentLabels = useMemo(
    () => new Map(environments.map((env) => [env.environmentId, env.label] as const)),
    [environments],
  );

  const availableProjectKeys = useMemo(
    () => activeProjects.map((project) => pullRequestProjectKey(project)),
    [activeProjects],
  );

  const selectedProjectKeys = useMemo(
    () => normalizeSelectedTaskProjectKeys(availableProjectKeys, persistedProjectKeys),
    [availableProjectKeys, persistedProjectKeys],
  );

  const selectedProjectKeySet = useMemo(
    () => new Set(selectedProjectKeys),
    [selectedProjectKeys],
  );

  const selectedProjects = useMemo(
    () =>
      activeProjects.filter((project) =>
        selectedProjectKeySet.has(pullRequestProjectKey(project)),
      ),
    [activeProjects, selectedProjectKeySet],
  );

  const updateProjectSelection = (nextKeys: readonly string[]) => {
    setPersistedProjectKeys(nextKeys);
    writeSelectedTaskProjectKeys(nextKeys);
  };

  const toggleProjectKey = (key: string) => {
    const next = selectedProjectKeySet.has(key)
      ? selectedProjectKeys.filter((item) => item !== key)
      : [...selectedProjectKeys, key];
    updateProjectSelection(next);
  };

  const activeRawQuery = tabMode === "prs" ? prQuery : issueQuery;
  const setActiveRawQuery = (next: string) => {
    if (tabMode === "prs") {
      setPrQuery(next);
    } else {
      setIssueQuery(next);
    }
  };

  const parsedQuery = useMemo(
    () => parseTasksQuery(activeRawQuery, tabMode === "prs" ? "prs" : "issues"),
    [activeRawQuery, tabMode],
  );
  const debouncedText = useDebouncedValue(parsedQuery.text, 260);

  // Real Prismux Issue list query targets (only when tab is Issues and >=1 project selected).
  const issueCapableEnvs = useMemo(
    () =>
      environments.filter(
        (env) => env.serverConfig?.environment.capabilities.issues === true,
      ),
    [environments],
  );

  const hiddenProjectPairs = useMemo(() => {
    const pairs: Array<readonly [EnvironmentId, ProjectId]> = [];
    for (const project of activeProjects) {
      if (!selectedProjectKeySet.has(pullRequestProjectKey(project))) {
        pairs.push([project.environmentId, project.id] as const);
      }
    }
    return pairs;
  }, [activeProjects, selectedProjectKeySet]);

  const issueTargets = useMemo(() => {
    if (tabMode !== "issues" || selectedProjects.length === 0 || issueCapableEnvs.length === 0) {
      return [];
    }
    const issueState: IssueListState =
      parsedQuery.state === "closed"
        ? "closed"
        : parsedQuery.state === "all"
          ? "all"
          : "open";
    const issueInvolvement: IssueInvolvement =
      parsedQuery.involvement === "assigned" ||
      parsedQuery.involvement === "authored" ||
      parsedQuery.involvement === "mentioned"
        ? parsedQuery.involvement
        : "all";
    const listInput: IssueListInput = {
      state: issueState,
      involvement: issueInvolvement,
      limit: PAGE_LIMIT,
      sort: sortOrder,
      ...(debouncedText ? { query: debouncedText } : {}),
      ...(parsedQuery.labels.length > 0 ? { labels: [...parsedQuery.labels] } : {}),
      ...(parsedQuery.assignee ? { assignee: parsedQuery.assignee } : {}),
    };
    const filteredProjects = issueFilterProjects(
      activeProjects.filter((project) =>
        issueCapableEnvs.some((env) => env.environmentId === project.environmentId),
      ),
      environmentLabels,
    );
    if (filteredProjects.length === 0) return [];
    return issueListTargets(
      issueCapableEnvs.map((env) => env.environmentId),
      filteredProjects,
      hiddenProjectPairs.length > 0 ? hiddenProjectPairs : undefined,
      listInput,
    );
  }, [
    activeProjects,
    debouncedText,
    environmentLabels,
    hiddenProjectPairs,
    issueCapableEnvs,
    parsedQuery.assignee,
    parsedQuery.involvement,
    parsedQuery.labels,
    parsedQuery.state,
    selectedProjects.length,
    sortOrder,
    tabMode,
  ]);

  const issueList = useIssueList(issueTargets);
  const heldIssues = useMemo(
    () => holdIssuePages(issueList.answers, new Map()),
    [issueList.answers],
  );
  const issueRows = useMemo<readonly EnvironmentIssueEntry[]>(() => {
    if (selectedProjects.length === 0) return [];
    const groups = groupIssues(heldIssues, debouncedText, activeProjects, sortOrder);
    return groups
      .flatMap((group) => group.rows)
      .filter((row) =>
        selectedProjectKeySet.has(
          pullRequestProjectKey({ environmentId: row.environmentId, id: row.projectId }),
        ),
      );
  }, [activeProjects, debouncedText, heldIssues, selectedProjectKeySet, selectedProjects.length, sortOrder]);

  // Real Prismux Pull Request host query targets (only when tab is PRs and >=1 project selected).
  const prCapableEnvs = useMemo(
    () =>
      environments.filter(
        (env) => env.serverConfig?.environment.capabilities.pullRequests === true,
      ),
    [environments],
  );

  const prTargets = useMemo(() => {
    if (tabMode !== "prs" || selectedProjects.length === 0 || prCapableEnvs.length === 0) {
      return [];
    }
    const prState: PullRequestListState =
      parsedQuery.state === "merged" ||
      parsedQuery.state === "closed" ||
      parsedQuery.state === "all"
        ? parsedQuery.state
        : "open";
    const prInvolvement: PullRequestInvolvement =
      parsedQuery.involvement === "authored"
        ? "authored"
        : parsedQuery.involvement === "review-requested"
          ? "reviewing"
          : "all";
    const projectsByEnv = new Map<EnvironmentId, ProjectId[]>();
    for (const project of selectedProjects) {
      if (!prCapableEnvs.some((env) => env.environmentId === project.environmentId)) continue;
      const list = projectsByEnv.get(project.environmentId) ?? [];
      list.push(project.id);
      projectsByEnv.set(project.environmentId, list);
    }
    const targets: Array<{
      readonly environmentId: EnvironmentId;
      readonly input: PullRequestListInput;
    }> = [];
    for (const [environmentId, projectIds] of projectsByEnv.entries()) {
      targets.push({
        environmentId,
        input: {
          state: prState,
          involvement: prInvolvement,
          limit: PAGE_LIMIT,
          projectIds,
          ...(debouncedText ? { query: debouncedText } : {}),
        },
      });
    }
    return targets;
  }, [
    debouncedText,
    parsedQuery.involvement,
    parsedQuery.state,
    prCapableEnvs,
    selectedProjects,
    tabMode,
  ]);

  const prList = usePullRequestHostList(prTargets);
  const prRows = useMemo<readonly EnvironmentPullRequestEntry[]>(() => {
    if (selectedProjects.length === 0 || !prList.data) return [];
    const entries = prList.data.entries.filter((entry) =>
      selectedProjectKeySet.has(
        pullRequestProjectKey({ environmentId: entry.environmentId, id: entry.projectId }),
      ),
    );
    const authorFilter = parsedQuery.author?.toLowerCase();
    const filtered = authorFilter
      ? entries.filter((entry) => entry.author?.login.toLowerCase().includes(authorFilter))
      : entries;
    return [...filtered].toSorted((left, right) => {
      const a = Date.parse(right.updatedAt);
      const b = Date.parse(left.updatedAt);
      return (Number.isFinite(a) ? a : 0) - (Number.isFinite(b) ? b : 0);
    });
  }, [parsedQuery.author, prList.data, selectedProjectKeySet, selectedProjects.length]);

  const isBusy =
    (tabMode === "issues" && issueList.isPending) || (tabMode === "prs" && prList.isPending);

  const handleRefresh = () => {
    if (tabMode === "issues") {
      issueList.refresh();
    } else if (tabMode === "prs") {
      prList.refresh();
    }
  };

  const handleResetQuery = () => {
    setActiveRawQuery(tabMode === "prs" ? DEFAULT_PRS_QUERY : DEFAULT_ISSUES_QUERY);
  };

  const externalGitHubUrl = useMemo(() => {
    if (selectedProjects.length !== 1) return null;
    const only = selectedProjects[0]!;
    const slug = only.repositoryIdentity?.canonicalKey;
    if (!slug) return null;
    if (slug.startsWith("https://")) return slug;
    if (slug.includes("/")) return `https://github.com/${slug.replace(/^github\.com[:/]/, "")}`;
    return null;
  }, [selectedProjects]);

  const threadCountByProjectKey = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of visibleThreads) {
      if (thread.archivedAt !== null || thread.lineage.parentThreadId !== null) continue;
      const key = pullRequestProjectKey({
        environmentId: thread.environmentId,
        id: thread.projectId,
      });
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [visibleThreads]);

  const sourceContextLabel =
    selectedProjects.length === 0
      ? copy.sourceSelectedProjects
      : selectedProjects.length === 1
        ? selectedProjects[0]!.title
        : copy.sourceProjectCount(selectedProjects.length);

  const projectPickerLabel =
    selectedProjects.length === 0
      ? copy.projectPickerEmpty
      : selectedProjects.length === activeProjects.length
        ? copy.projectPickerCount(selectedProjects.length, activeProjects.length)
        : selectedProjects.length === 1
          ? selectedProjects[0]!.title
          : copy.projectPickerCount(selectedProjects.length, activeProjects.length);

  const emptyState = resolveTasksEmptyState({
    selectedProjectCount: selectedProjects.length,
    totalProjectCount: activeProjects.length,
    copy,
  });

  const handleOpenIssueRow = (entry: EnvironmentIssueEntry) => {
    void navigate({
      to: "/issues",
      search: {
        who: "all",
        status: entry.state.category === "closed" ? "closed" : "open",
        selectedEnvironmentId: entry.environmentId,
        selectedProjectId: entry.projectId,
        selectedHost: entry.host,
        tracker: entry.tracker,
        scope: entry.scope,
        key: entry.key,
      },
    });
  };

  const handleOpenPrRow = (entry: EnvironmentPullRequestEntry) => {
    void navigate({
      to: "/pull-requests",
      search: {
        involvement: "all",
        state: entry.state === "open" ? "open" : entry.state === "merged" ? "merged" : "closed",
        repository: entry.repository,
        number: entry.number,
        selectedEnvironmentId: entry.environmentId,
        selectedProjectId: entry.projectId,
        selectedHost: entry.host,
      },
    });
  };

  const tableGridClass =
    "grid-cols-[84px_minmax(220px,1fr)_128px_92px_104px_80px]";

  const applyFilterPatch = (
    patch: Partial<{
      readonly state: TasksItemStateFilter;
      readonly involvement: TasksInvolvementFilter;
    }>,
  ) => {
    const mode = tabMode === "prs" ? "prs" : "issues";
    setActiveRawQuery(applyTasksQueryPatch(activeRawQuery, mode, patch));
  };

  const activeResultCount =
    tabMode === "projects"
      ? activeProjects.length
      : tabMode === "prs"
        ? prRows.length
        : issueRows.length;

  return (
    <SidebarInset className="h-dvh min-w-0 flex-1 overflow-hidden">
      <PrismuxStageFrame
        glassZone="workPanels"
        rightPanelOpen={topbarPortal.standaloneRightPanelOpen}
      >
        <div
          data-testid="prismux-tasks-page"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {/* Unified Work-Panel Header Bar */}
          <header className="flex flex-none flex-wrap items-center justify-between gap-2.5 border-b border-border/65 px-4 py-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      data-task-source="github"
                      aria-label={copy.githubSourceLabel}
                      aria-pressed="true"
                      onClick={() => setProjectPickerOpen(true)}
                      className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-primary/14 text-primary transition-colors hover:bg-primary/20 active:translate-y-px focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  }
                >
                  <GitHubMark className="size-4" />
                </TooltipTrigger>
                <TooltipPopup side="bottom" sideOffset={6}>
                  {copy.githubSourceLabel}
                </TooltipPopup>
              </Tooltip>

              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
                  {copy.pageTitle}
                </h1>
                {activeResultCount > 0 ? (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-border/65 bg-muted/75 px-2 py-0.5 text-[11px] font-medium text-foreground/85 tabular-nums">
                    {activeResultCount}
                  </span>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => setProjectPickerOpen(true)}
                data-testid="tasks-source-summary"
                data-pmx-work-panel-control="1"
                className="inline-flex h-7 max-w-[min(360px,40vw)] cursor-pointer items-center gap-1.5 rounded-lg border border-border/75 bg-card px-2.5 text-xs text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-foreground active:translate-y-px focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="font-medium text-foreground">{copy.sourcePrefixGitHub}</span>
                <span aria-hidden="true" className="opacity-50">
                  ·
                </span>
                <span className="truncate">{sourceContextLabel}</span>
              </button>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <div
                role="tablist"
                aria-label={copy.pageTitle}
                data-pmx-work-panel-control="1"
                className="inline-flex items-center gap-0.5 rounded-lg border border-border/70 bg-muted/60 p-0.5 text-xs"
              >
                {(
                  [
                    { id: "issues", label: copy.tabIssues },
                    { id: "prs", label: copy.tabPrs },
                    { id: "projects", label: copy.tabProjects },
                  ] as const
                ).map((tab) => {
                  const active = tabMode === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      data-testid={`tasks-tab-${tab.id}`}
                      onClick={() => setTabMode(tab.id)}
                      className={cn(
                        "h-6 cursor-pointer rounded-md px-2.5 text-xs font-medium transition-all outline-none active:translate-y-px focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-primary font-semibold text-primary-foreground shadow-xs"
                          : "text-foreground/80 hover:bg-accent/70 hover:text-foreground",
                      )}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Project source multi-select popover */}
              <Popover open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      data-testid="tasks-project-picker-trigger"
                      data-pmx-work-panel-control="1"
                      className="inline-flex h-7 max-w-[220px] cursor-pointer items-center gap-1.5 rounded-lg border border-border/75 bg-card px-2.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-accent active:translate-y-px focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  }
                >
                  <FolderGit2Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{projectPickerLabel}</span>
                  <ChevronDownIcon className="ml-0.5 size-3.5 shrink-0 text-muted-foreground" />
                </PopoverTrigger>
                <PopoverPopup
                  side="bottom"
                  align="end"
                  sideOffset={6}
                  className="w-72 p-1.5"
                >
                  <div className="flex items-center justify-between border-b border-border/50 px-2 py-1.5">
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      {copy.sourceSelectedProjects}
                    </span>
                    <div className="flex items-center gap-2 text-[11px]">
                      {activeProjects.length > 0 ? (
                        <>
                          <button
                            type="button"
                            onClick={() => updateProjectSelection(availableProjectKeys)}
                            className="cursor-pointer text-primary hover:underline"
                          >
                            {copy.selectAllProjects}
                          </button>
                          <button
                            type="button"
                            onClick={() => updateProjectSelection([])}
                            className="cursor-pointer text-muted-foreground hover:text-foreground"
                          >
                            {copy.clearSelection}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="max-h-60 overflow-y-auto py-1">
                    {activeProjects.length === 0 ? (
                      <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                        {copy.noProjectsConfiguredTitle}
                      </div>
                    ) : (
                      activeProjects.map((project) => {
                        const key = pullRequestProjectKey(project);
                        const checked = selectedProjectKeySet.has(key);
                        const envName = environmentLabels.get(project.environmentId);
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => toggleProjectKey(key)}
                            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                          >
                            <span
                              className={cn(
                                "grid size-4 shrink-0 place-items-center rounded border transition-colors",
                                checked
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border/80 bg-background",
                              )}
                            >
                              {checked ? <CheckIcon className="size-3" /> : null}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                              {project.title}
                            </span>
                            {envName ? (
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {envName}
                              </span>
                            ) : null}
                          </button>
                        );
                      })
                    )}
                  </div>
                  <div className="border-t border-border/50 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setProjectPickerOpen(false);
                        openCommandPalette({ open: "add-project" });
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <FolderPlusIcon className="size-3.5" />
                      <span>{copy.addProjectAction}</span>
                    </button>
                  </div>
                </PopoverPopup>
              </Popover>

              {/* External GitHub open button */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        data-pmx-work-panel-control="1"
                        disabled={!externalGitHubUrl}
                        onClick={() => {
                          if (externalGitHubUrl) {
                            window.open(externalGitHubUrl, "_blank", "noopener,noreferrer");
                          }
                        }}
                        aria-label={
                          externalGitHubUrl
                            ? copy.openInGitHubTooltip
                            : copy.openInGitHubDisabledTooltip
                        }
                        className="size-7 rounded-lg border-border/75 bg-card text-foreground shadow-xs hover:bg-accent disabled:opacity-50"
                      >
                        <ExternalLinkIcon className="size-3.5" />
                      </Button>
                    </span>
                  }
                />
                <TooltipPopup side="bottom" sideOffset={6}>
                  {externalGitHubUrl ? copy.openInGitHubTooltip : copy.openInGitHubDisabledTooltip}
                </TooltipPopup>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      data-testid="tasks-close-button"
                      onClick={() => void navigateToMainApp()}
                      aria-label={copy.closeLabel}
                      className="size-7 rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground"
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

          {/* Main Content Area (4px grid padding) */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
          {/* Main Content: Projects Grid OR Joined Filter Chrome + Table Shell */}
          {tabMode === "projects" ? (
            <div
              data-pmx-work-panel-card="1"
              className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/75 bg-card shadow-xs"
            >
              {activeProjects.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
                  <span className="mb-3 grid size-11 place-items-center rounded-full bg-primary/14 text-primary">
                    <FolderGit2Icon className="size-5" aria-hidden="true" />
                  </span>
                  <p className="text-sm font-semibold text-foreground">
                    {copy.noProjectsConfiguredTitle}
                  </p>
                  <p className="mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
                    {copy.noProjectsConfiguredDescription}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-pmx-work-panel-control="1"
                    onClick={() => openCommandPalette({ open: "add-project" })}
                    className="mt-4 gap-1.5"
                  >
                    <FolderPlusIcon className="size-3.5" />
                    {copy.addProjectAction}
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 overflow-y-auto p-4 md:grid-cols-2 xl:grid-cols-3">
                  {activeProjects.map((project) => {
                    const key = pullRequestProjectKey(project);
                    const count = threadCountByProjectKey.get(key) ?? 0;
                    const envName = environmentLabels.get(project.environmentId);
                    return (
                      <div
                        key={key}
                        data-pmx-work-panel-control="1"
                        className="flex flex-col justify-between gap-3 rounded-xl border border-border/75 bg-card p-4 shadow-xs transition-colors hover:border-primary/45"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                              <FolderGit2Icon className="size-4 shrink-0 text-primary/85" />
                              <span className="truncate">{project.title}</span>
                            </span>
                            {envName ? (
                              <span className="shrink-0 rounded-full border border-border/60 bg-muted/80 px-2 py-0.5 text-[10px] font-medium text-foreground/80">
                                {envName}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                            {project.repositoryIdentity?.canonicalKey ?? project.workspaceRoot}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/45 pt-2.5 text-xs">
                          <span className="text-muted-foreground tabular-nums">
                            {copy.projectsLinkedThreads(count)}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => {
                                updateProjectSelection([key]);
                                setTabMode("issues");
                              }}
                            >
                              {copy.projectsOpenIssues}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => {
                                updateProjectSelection([key]);
                                setTabMode("prs");
                              }}
                            >
                              {copy.projectsOpenPrs}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => requestOpenCreateWorkspace()}
                            >
                              <PlusIcon className="size-3" />
                              {copy.projectsCreateWorkspace}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Filter Chrome (joined smoothly to table shell below, unified workPanels surface) */}
              <div
                data-testid="tasks-filter-chrome"
                data-pmx-work-panel-card="1"
                className="flex flex-none flex-col gap-2.5 rounded-t-xl border border-border/75 bg-card px-3.5 py-3"
              >
                {/* Preset Chips Row */}
                {tabMode === "prs" ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          { id: "open", label: copy.chipOpen },
                          { id: "merged", label: copy.chipMerged },
                          { id: "closed", label: copy.chipClosed },
                        ] as const
                      ).map((chip) => (
                        <PresetChip
                          key={chip.id}
                          label={chip.label}
                          active={parsedQuery.state === chip.id}
                          onClick={() => applyFilterPatch({ state: chip.id })}
                        />
                      ))}
                    </div>
                    <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border/60" />
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          { id: "assigned", label: copy.chipAssignedToMe },
                          { id: "review-requested", label: copy.chipReviewRequested },
                          { id: "authored", label: copy.chipAuthoredByMe },
                        ] as const
                      ).map((chip) => (
                        <PresetChip
                          key={chip.id}
                          label={chip.label}
                          active={parsedQuery.involvement === chip.id}
                          onClick={() =>
                            applyFilterPatch({
                              involvement:
                                parsedQuery.involvement === chip.id ? "all" : chip.id,
                            })
                          }
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PresetChip
                      label={copy.chipOpen}
                      active={
                        parsedQuery.state === "open" && parsedQuery.involvement === "all"
                      }
                      onClick={() =>
                        applyFilterPatch({ state: "open", involvement: "all" })
                      }
                    />
                    <PresetChip
                      label={copy.chipAssignedToMe}
                      active={parsedQuery.involvement === "assigned"}
                      onClick={() =>
                        applyFilterPatch({
                          state: parsedQuery.state === "all" ? "open" : parsedQuery.state,
                          involvement:
                            parsedQuery.involvement === "assigned" ? "all" : "assigned",
                        })
                      }
                    />
                  </div>
                )}

                {/* Filter Dropdown + Live Query Input + Create (+) + Refresh (↻) */}
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Popover open={filterPopoverOpen} onOpenChange={setFilterPopoverOpen}>
                    <PopoverTrigger
                      render={
                        <button
                          type="button"
                          data-testid="tasks-filters-dropdown"
                          data-pmx-work-panel-control="1"
                          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border/75 bg-card px-2.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      }
                    >
                      <SlidersHorizontalIcon className="size-3.5 text-muted-foreground" />
                      <span>{copy.filterDropdownLabel}</span>
                      <ChevronDownIcon className="size-3 text-muted-foreground" />
                    </PopoverTrigger>
                    <PopoverPopup side="bottom" align="start" sideOffset={6} className="w-60 p-2">
                      <div className="space-y-2.5 text-xs">
                        <div>
                          <div className="px-1.5 pb-1 text-[11px] font-semibold text-muted-foreground">
                            {copy.filterSectionState}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {(
                              [
                                { id: "open", label: copy.chipOpen },
                                ...(tabMode === "prs"
                                  ? ([{ id: "merged", label: copy.chipMerged }] as const)
                                  : []),
                                { id: "closed", label: copy.chipClosed },
                                { id: "all", label: copy.chipAll },
                              ] as const
                            ).map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => applyFilterPatch({ state: opt.id })}
                                className={cn(
                                  "cursor-pointer rounded px-2 py-1 text-[11px] font-medium transition-colors",
                                  parsedQuery.state === opt.id
                                    ? "bg-primary text-primary-foreground shadow-xs"
                                    : "bg-muted/70 text-foreground hover:bg-accent",
                                )}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="px-1.5 pb-1 text-[11px] font-semibold text-muted-foreground">
                            {copy.filterSectionInvolvement}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {(
                              [
                                { id: "all", label: copy.chipAll },
                                { id: "assigned", label: copy.chipAssignedToMe },
                                { id: "authored", label: copy.chipAuthoredByMe },
                                ...(tabMode === "prs"
                                  ? ([
                                      {
                                        id: "review-requested",
                                        label: copy.chipReviewRequested,
                                      },
                                    ] as const)
                                  : ([{ id: "mentioned", label: copy.chipMentioned }] as const)),
                              ] as const
                            ).map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => applyFilterPatch({ involvement: opt.id })}
                                className={cn(
                                  "cursor-pointer rounded px-2 py-1 text-[11px] font-medium transition-colors",
                                  parsedQuery.involvement === opt.id
                                    ? "bg-primary text-primary-foreground shadow-xs"
                                    : "bg-muted/70 text-foreground hover:bg-accent",
                                )}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="px-1.5 pb-1 text-[11px] font-semibold text-muted-foreground">
                            {copy.filterSectionSort}
                          </div>
                          <div className="flex gap-1">
                            {(
                              [
                                { id: "updated", label: copy.sortRecentlyUpdated },
                                { id: "created", label: copy.sortNewest },
                              ] as const
                            ).map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => setSortOrder(opt.id)}
                                className={cn(
                                  "cursor-pointer rounded px-2 py-1 text-[11px] font-medium transition-colors",
                                  sortOrder === opt.id
                                    ? "bg-primary text-primary-foreground shadow-xs"
                                    : "bg-muted/70 text-foreground hover:bg-accent",
                                )}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </PopoverPopup>
                  </Popover>

                  <div className="relative min-w-0 flex-1 basis-56">
                    <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={searchInputRef}
                      data-testid="tasks-query-input"
                      data-pmx-work-panel-control="1"
                      value={activeRawQuery}
                      onChange={(event) => setActiveRawQuery(event.target.value)}
                      placeholder={
                        tabMode === "prs"
                          ? copy.searchPrsPlaceholder
                          : copy.searchIssuesPlaceholder
                      }
                      className="h-8 rounded-md border-border/75 bg-card pr-8 pl-8 font-mono text-xs text-foreground shadow-xs"
                    />
                    {activeRawQuery.length > 0 ? (
                      <button
                        type="button"
                        aria-label={copy.clearSearchLabel}
                        onClick={handleResetQuery}
                        className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            data-testid="tasks-create-button"
                            data-pmx-work-panel-control="1"
                            onClick={() => requestOpenCreateWorkspace()}
                            aria-label={copy.createTaskTooltip}
                            className="size-8 border-border/75 bg-card text-foreground shadow-xs hover:bg-accent"
                          />
                        }
                      >
                        <PlusIcon className="size-4" />
                      </TooltipTrigger>
                      <TooltipPopup side="bottom" sideOffset={6}>
                        {copy.createTaskTooltip}
                      </TooltipPopup>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            data-testid="tasks-refresh-button"
                            data-pmx-work-panel-control="1"
                            onClick={handleRefresh}
                            disabled={isBusy}
                            aria-busy={isBusy}
                            aria-label={
                              isBusy ? copy.refreshingTasksTooltip : copy.refreshTasksTooltip
                            }
                            className="size-8 border-border/75 bg-card text-foreground shadow-xs hover:bg-accent"
                          />
                        }
                      >
                        {isBusy ? (
                          <LoaderCircleIcon className="size-4 animate-spin" />
                        ) : (
                          <RefreshCwIcon className="size-4" />
                        )}
                      </TooltipTrigger>
                      <TooltipPopup side="bottom" sideOffset={6}>
                        {isBusy ? copy.refreshingTasksTooltip : copy.refreshTasksTooltip}
                      </TooltipPopup>
                    </Tooltip>
                  </div>
                </div>
              </div>

              {/* Joined Table Shell (rounded-t-none border-t-0, zero doubled seam) */}
              <div
                data-pmx-work-panel-card="1"
                className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-xl border border-t-0 border-border/75 bg-card shadow-xs"
              >
                <div className="min-h-0 flex-1 overflow-auto">
                  {/* Sticky Table Header */}
                  <div
                    data-testid="tasks-table-header"
                    data-pmx-work-panel-control="1"
                    className={cn(
                      "sticky top-0 z-10 grid h-8 min-w-[660px] items-center gap-3 border-b border-border/70 bg-muted/85 px-3.5 text-[11px] font-semibold tracking-wider text-foreground/85",
                      tableGridClass,
                    )}
                  >
                    <span>{copy.columnId}</span>
                    <span>{copy.columnTitleContext}</span>
                    <span>
                      {tabMode === "prs" ? copy.columnReviewers : copy.columnAssignees}
                    </span>
                    <span>{copy.columnStatus}</span>
                    <span>{copy.columnUpdated}</span>
                    <span />
                  </div>

                  {/* Loading skeletons */}
                  {isBusy && (tabMode === "issues" ? issueRows.length : prRows.length) === 0 ? (
                    <div className="divide-y divide-border/40">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <div
                          key={index}
                          className={cn("grid min-h-12 min-w-[660px] items-center gap-3 px-3 py-2.5", tableGridClass)}
                        >
                          <div className="h-5 w-14 animate-pulse rounded bg-muted/70" />
                          <div className="space-y-1.5">
                            <div className="h-3.5 w-3/5 animate-pulse rounded bg-muted/70" />
                            <div className="h-3 w-2/5 animate-pulse rounded bg-muted/55" />
                          </div>
                          <div className="h-4 w-20 animate-pulse rounded bg-muted/55" />
                          <div className="h-5 w-14 animate-pulse rounded-full bg-muted/65" />
                          <div className="h-3 w-16 animate-pulse rounded bg-muted/55" />
                          <div className="h-6 w-12 animate-pulse rounded bg-muted/65" />
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {/* Empty State */}
                  {!isBusy &&
                  (tabMode === "issues" ? issueRows.length : prRows.length) === 0 ? (
                    <div
                      data-testid="tasks-empty-state"
                      className="flex min-h-[260px] flex-col items-center justify-center px-6 py-12 text-center"
                    >
                      <span className="mb-3 grid size-11 place-items-center rounded-full bg-primary/14 text-primary">
                        {tabMode === "prs" ? (
                          <PullRequestGlyph.pullRequest className="size-5" aria-hidden="true" />
                        ) : (
                          <GitHubMark className="size-5" />
                        )}
                      </span>
                      <p className="text-sm font-semibold text-foreground">
                        {emptyState.title}
                      </p>
                      <p className="mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
                        {emptyState.description}
                      </p>
                      {emptyState.kind === "no-sources" ? (
                        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                          {activeProjects.length > 0 ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              data-pmx-work-panel-control="1"
                              onClick={() => updateProjectSelection(availableProjectKeys)}
                            >
                              {copy.selectAllProjects}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              data-pmx-work-panel-control="1"
                              onClick={() => openCommandPalette({ open: "add-project" })}
                              className="gap-1.5"
                            >
                              <FolderPlusIcon className="size-3.5" />
                              {copy.addProjectAction}
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Real GitHub Issues Rows */}
                  {tabMode === "issues" && issueRows.length > 0 ? (
                    <div className="divide-y divide-border/40">
                      {issueRows.map((entry) => {
                        const rowKey = `${entry.environmentId}:${entry.projectId}:${entry.scope}:${entry.key}`;
                        const isOpen = entry.state.category === "open";
                        return (
                          <div
                            key={rowKey}
                            onClick={() => handleOpenIssueRow(entry)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                handleOpenIssueRow(entry);
                              }
                            }}
                            className={cn(
                              "grid min-h-12 min-w-[660px] cursor-pointer items-center gap-3 px-3 py-2 text-xs transition-colors hover:bg-accent/55 focus-visible:bg-accent/65 focus-visible:outline-none",
                              tableGridClass,
                            )}
                          >
                            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-muted-foreground">
                              <IssueStateGlyph state={entry.state} />
                              <span className="truncate">{entry.displayKey}</span>
                            </span>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground">
                                {entry.title}
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span className="truncate font-mono">{entry.scope}</span>
                                {entry.labels.slice(0, 3).map((label) => (
                                  <PullRequestLabelChip key={label.name} label={label} />
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 overflow-hidden">
                              {entry.assignees.length > 0 ? (
                                <span className="flex items-center -space-x-1">
                                  {entry.assignees.slice(0, 3).map((assignee) => (
                                    <PullRequestActorAvatar
                                      key={assignee.login}
                                      actor={assignee}
                                      className="ring-1 ring-background"
                                    />
                                  ))}
                                </span>
                              ) : (
                                <span className="text-[11px] text-muted-foreground/70">
                                  {copy.unassignedLabel}
                                </span>
                              )}
                            </div>
                            <div>
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                                  isOpen
                                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                    : "bg-violet-500/15 text-violet-700 dark:text-violet-300",
                                )}
                              >
                                {isOpen ? copy.statusOpen : copy.statusClosed}
                              </span>
                            </div>
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              {formatRelativeTaskTime(entry.updatedAt, copy.isZh)}
                            </span>
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleOpenIssueRow(entry);
                                }}
                              >
                                {copy.openDetailAction}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {/* Real GitHub Pull Request Rows */}
                  {tabMode === "prs" && prRows.length > 0 ? (
                    <div className="divide-y divide-border/40">
                      {prRows.map((entry) => {
                        const rowKey = `${entry.environmentId}:${entry.projectId}:${entry.repository}:${entry.number}`;
                        const isMerged = entry.state === "merged";
                        const isOpen = entry.state === "open";
                        return (
                          <div
                            key={rowKey}
                            onClick={() => handleOpenPrRow(entry)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                handleOpenPrRow(entry);
                              }
                            }}
                            className={cn(
                              "grid min-h-12 min-w-[660px] cursor-pointer items-center gap-3 px-3 py-2 text-xs transition-colors hover:bg-accent/55 focus-visible:bg-accent/65 focus-visible:outline-none",
                              tableGridClass,
                            )}
                          >
                            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-muted-foreground">
                              {isMerged ? (
                                <PullRequestGlyph.merged className="size-3.5 shrink-0 text-violet-500" />
                              ) : (
                                <PullRequestGlyph.pullRequest
                                  className={cn(
                                    "size-3.5 shrink-0",
                                    isOpen ? "text-emerald-500" : "text-rose-500",
                                  )}
                                />
                              )}
                              <span>#{entry.number}</span>
                            </span>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground">
                                {entry.title}
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span className="truncate font-mono">{entry.repository}</span>
                                <span className="inline-flex items-center gap-0.5 truncate font-mono opacity-80">
                                  <GitBranchIcon className="size-3 shrink-0" />
                                  {entry.headBranch}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 overflow-hidden">
                              {entry.author ? (
                                <>
                                  <PullRequestActorAvatar actor={entry.author} />
                                  <span className="truncate text-[11px] text-muted-foreground">
                                    {entry.author.login}
                                  </span>
                                </>
                              ) : (
                                <span className="text-[11px] text-muted-foreground/70">—</span>
                              )}
                            </div>
                            <div>
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                                  isMerged
                                    ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                                    : entry.isDraft
                                      ? "bg-muted text-muted-foreground"
                                      : isOpen
                                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                        : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
                                )}
                              >
                                {isMerged
                                  ? copy.statusMerged
                                  : entry.isDraft
                                    ? copy.statusDraft
                                    : isOpen
                                      ? copy.statusOpen
                                      : copy.statusClosed}
                              </span>
                            </div>
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              {formatRelativeTaskTime(entry.updatedAt, copy.isZh)}
                            </span>
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleOpenPrRow(entry);
                                }}
                              >
                                {copy.openDetailAction}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
          </div>
        </div>
      </PrismuxStageFrame>
    </SidebarInset>
  );
});
