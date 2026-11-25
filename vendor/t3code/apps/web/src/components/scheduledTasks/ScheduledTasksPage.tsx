import { useAtomValue } from "@effect/atom-react";
import { connectionStatusTitle } from "@t3tools/client-runtime/connection";
import {
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type ScheduledTask,
  type ScheduledTaskId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { useMessages } from "gt-react";
import {
  AlertCircleIcon,
  CalendarClockIcon,
  Clock3Icon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import { useProjects } from "../../state/entities";
import { environmentIdsKey } from "../../state/environmentAtomList";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { ConnectionStatusDot, connectionPhaseDotClassName } from "../ConnectionStatusDot";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import {
  ScheduledTaskEditorDialog,
  ScheduledTaskEnvironmentSubtitle,
  ScheduledTaskRow,
  scheduledTaskCreatePermissionsAtom,
  scheduledTasksListAtom,
} from "../settings/ScheduledTasksSettings";
import { matchesScheduledTaskScope } from "../settings/scheduledTasksSettings.logic";
import { SettingsScopeProvider, useSettingsScope } from "../settings/SettingsScopeContext";
import type { SettingsScopeSearch } from "../settings/settingsScope";
import { settingsScopeEnvironmentLabels } from "../settings/settingsScopeAxis";
import { useNavigateToMainApp } from "../sidebar/mainAppLocation";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PrismuxStageFrame, useWorkspaceTopbarPortal } from "../workspace/WorkspaceTopbarPortalContext";
import {
  filterScheduledTasks,
  isScheduledTasksEscapeTarget,
  summarizeScheduledTasks,
  useScheduledTasksPageCopy,
  type ScheduledTasksStatusFilter,
} from "./scheduledTasksPage.logic";

export interface ScheduledTasksPageProps {
  readonly environmentId?: EnvironmentId;
  readonly taskId?: ScheduledTaskId | undefined;
}

function ScheduledTasksPanelContent(target: ScheduledTasksPageProps) {
  const copy = useScheduledTasksPageCopy();
  const messages = useMessages();
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const topbarPortal = useWorkspaceTopbarPortal();
  const { scope, environments, connectedEnvironments, environment, selectScope } =
    useSettingsScope();
  const allProjects = useProjects();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ScheduledTasksStatusFilter>("all");
  const [editor, setEditor] = useState<{
    environmentId: EnvironmentId;
    task: ScheduledTask | null;
  } | null>(null);

  const projectTitleByKey = new Map<string, string>();
  for (const project of allProjects) {
    projectTitleByKey.set(`${project.environmentId}:${project.id}`, project.title);
  }

  const defaultEnvironment = environment ?? connectedEnvironments[0];
  const linkedEnvironmentId = target.environmentId ?? defaultEnvironment?.environmentId;
  const linkedEnvironmentConnected = environments.some(
    (entry) =>
      entry.environmentId === linkedEnvironmentId &&
      entry.connection.phase === "connected" &&
      entry.serverConfig !== null,
  );
  const linkedTasksQuery = useEnvironmentQuery(
    target.taskId !== undefined && linkedEnvironmentId !== undefined && linkedEnvironmentConnected
      ? serverEnvironment.scheduledTasksLive({ environmentId: linkedEnvironmentId, input: {} })
      : null,
  );
  const linkedTask = linkedTasksQuery.data?.tasks.find(
    (task) =>
      task.id === target.taskId &&
      linkedEnvironmentId !== undefined &&
      matchesScheduledTaskScope(scope, linkedEnvironmentId, task.projectId),
  );

  const [openedLinkTaskId, setOpenedLinkTaskId] = useState<ScheduledTaskId | undefined>();
  if (target.taskId === undefined && openedLinkTaskId !== undefined) {
    setOpenedLinkTaskId(undefined);
  }
  if (linkedTask && linkedEnvironmentId !== undefined && openedLinkTaskId !== target.taskId) {
    setOpenedLinkTaskId(target.taskId);
    if (editor === null) setEditor({ environmentId: linkedEnvironmentId, task: linkedTask });
  }

  const closeEditor = () => {
    setEditor(null);
    if (target.taskId === undefined) return;
    void navigate({
      to: "/scheduled-tasks",
      search: (prev) => {
        const next = { ...(prev as Record<string, unknown>) };
        delete next.taskId;
        return next;
      },
      replace: true,
    });
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window Escape key listener closes standalone panel when no modal/input owns focus
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || editor !== null) return;
      if (isScheduledTasksEscapeTarget(event.target)) return;
      event.preventDefault();
      void navigateToMainApp();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor, navigateToMainApp]);

  const createPermissions = useAtomValue(
    scheduledTaskCreatePermissionsAtom(
      environmentIdsKey(connectedEnvironments.map((entry) => entry.environmentId)),
    ),
  );
  const permittedEnvironments = connectedEnvironments.filter(
    (_entry, index) => createPermissions[index],
  );
  const creationEnvironment =
    permittedEnvironments.find(
      (entry) => entry.environmentId === defaultEnvironment?.environmentId,
    ) ?? permittedEnvironments[0];

  const connectedIds = environments.flatMap((entry) =>
    entry.connection.phase === "connected" && entry.serverConfig !== null
      ? [entry.environmentId]
      : [],
  );
  const queries = useAtomValue(scheduledTasksListAtom(environmentIdsKey(connectedIds)));

  const envStates = environments.map((envEntry) => {
    const idx = connectedIds.indexOf(envEntry.environmentId);
    const queryResult = idx < 0 ? null : queries[idx]!;
    const data = queryResult === null ? null : AsyncResult.getOrElse(queryResult, () => null);
    const scopedTasks = data?.tasks.filter((task) =>
      matchesScheduledTaskScope(scope, envEntry.environmentId, task.projectId),
    );
    const filteredTasks = scopedTasks
      ? filterScheduledTasks(scopedTasks, { query, statusFilter })
      : undefined;
    return {
      environment: envEntry,
      connected: idx >= 0,
      timeZone: data?.timeZone,
      scopedTasks,
      filteredTasks,
      error:
        queryResult?._tag === "Failure"
          ? formatEnvironmentQueryError(queryResult.cause, messages)
          : null,
    };
  });

  const allScopedTasks = envStates.flatMap((state) => state.scopedTasks ?? []);
  const allFilteredTasks = envStates.flatMap((state) => state.filteredTasks ?? []);
  const summary = summarizeScheduledTasks(allScopedTasks);
  const isFiltering = query.trim().length > 0 || statusFilter !== "all";
  const anyLoading = envStates.some(
    (state) => state.connected && state.error === null && state.scopedTasks === undefined,
  );
  const linkedState = envStates.find(
    (state) => state.environment.environmentId === linkedEnvironmentId,
  );
  const linkedTaskMissing =
    target.taskId !== undefined &&
    linkedState?.scopedTasks !== undefined &&
    linkedState.error === null &&
    !linkedState.scopedTasks.some((task) => task.id === target.taskId);

  const selectedMachineValue =
    scope.kind === "environment" ? scope.environmentId : "all";

  const statusChips: ReadonlyArray<{
    readonly id: ScheduledTasksStatusFilter;
    readonly label: string;
    readonly count: number;
  }> = [
    { id: "all", label: copy.filterAll, count: summary.total },
    { id: "enabled", label: copy.filterEnabled, count: summary.enabled },
    { id: "paused", label: copy.filterPaused, count: summary.paused },
    { id: "webhook", label: copy.filterWebhook, count: summary.webhook },
  ];

  return (
    <SidebarInset className="h-dvh min-w-0 flex-1 overflow-hidden">
      <PrismuxStageFrame
        glassZone="workPanels"
        rightPanelOpen={topbarPortal.standaloneRightPanelOpen}
      >
        <div
          data-testid="prismux-scheduled-tasks-page"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {/* Header Bar — aligned 1:1 with Workspace Board & Tasks standalone work panels */}
          <header className="flex flex-none flex-wrap items-center justify-between gap-2.5 border-b border-border/65 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/14 text-primary">
                <CalendarClockIcon className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
                    {copy.pageTitle}
                  </h1>
                  <span
                    data-testid="scheduled-tasks-summary-badge"
                    className="inline-flex shrink-0 items-center rounded-full border border-border/65 bg-muted/75 px-2 py-0.5 text-2xs font-medium text-foreground/85 tabular-nums"
                  >
                    {copy.summaryBadge(summary.enabled, summary.total)}
                  </span>
                </div>
                <p className="hidden truncate text-2xs text-muted-foreground md:block">
                  {copy.pageSubtitle}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {environments.length > 1 ? (
                <Select
                  value={selectedMachineValue}
                  onValueChange={(value) => {
                    selectScope({
                      machine: value === "all" || !value ? "all" : (value as EnvironmentId),
                    });
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    data-testid="scheduled-tasks-env-filter"
                    data-pmx-work-panel-control="1"
                    className="w-40"
                  >
                    <SelectValue>
                      {selectedMachineValue === "all"
                        ? copy.allEnvironmentsLabel
                        : (environments.find((e) => e.environmentId === selectedMachineValue)
                            ?.label ?? copy.allEnvironmentsLabel)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="all">{copy.allEnvironmentsLabel}</SelectItem>
                    {environments.map((entry) => (
                      <SelectItem key={entry.environmentId} value={entry.environmentId}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : null}

              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex">
                      <Button
                        type="button"
                        size="xs"
                        data-testid="scheduled-tasks-new-button"
                        disabled={!creationEnvironment}
                        onClick={() =>
                          creationEnvironment &&
                          setEditor({ environmentId: creationEnvironment.environmentId, task: null })
                        }
                      >
                        <PlusIcon className="size-3.5" />
                        <span>{copy.newTaskAction}</span>
                      </Button>
                    </span>
                  }
                />
                {!creationEnvironment ? (
                  <TooltipPopup side="bottom" sideOffset={6}>
                    {copy.noEnvironmentsTitle}
                  </TooltipPopup>
                ) : null}
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost-muted"
                      size="icon-sm"
                      data-testid="scheduled-tasks-close-button"
                      onClick={() => void navigateToMainApp()}
                      aria-label={copy.closeLabel}
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

          {/* Filter & Search Toolbar */}
          <div className="flex flex-none flex-wrap items-center justify-between gap-2 border-b border-border/55 px-4 py-2.5">
            <div
              role="group"
              aria-label={copy.pageTitle}
              className="flex flex-wrap items-center gap-1.5"
            >
              {statusChips.map((chip) => {
                const active = statusFilter === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    aria-pressed={active}
                    data-testid={`scheduled-tasks-filter-${chip.id}`}
                    data-pmx-work-panel-control={active ? undefined : "1"}
                    onClick={() => setStatusFilter(chip.id)}
                    className={cn(
                      "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-all outline-none active:translate-y-px focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      active
                        ? "border-primary bg-primary font-semibold text-primary-foreground shadow-xs"
                        : "border-border/75 text-foreground/90 shadow-xs hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <span>{chip.label}</span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-px text-3xs leading-none font-semibold tabular-nums",
                        active
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : "bg-muted/85 text-foreground/75",
                      )}
                    >
                      {chip.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative flex w-full max-w-xs items-center sm:w-64">
              <SearchIcon className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.searchPlaceholder}
                aria-label={copy.searchPlaceholder}
                data-testid="scheduled-tasks-search-input"
                data-pmx-work-panel-control="1"
                className="h-8 w-full rounded-lg border border-input bg-background pr-7 pl-8 text-xs text-foreground shadow-xs outline-none placeholder:text-muted-foreground/75 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              />
              {query.trim().length > 0 ? (
                <button
                  type="button"
                  aria-label={copy.clearSearchLabel}
                  onClick={() => setQuery("")}
                  className="absolute right-1.5 inline-flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <XIcon className="size-3" />
                </button>
              ) : null}
            </div>
          </div>

          {/* Main Scrollable Content */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-gutter-both">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
              {linkedTaskMissing ? (
                <div
                  role="status"
                  data-pmx-work-panel-card="1"
                  className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-card px-4 py-3 text-xs"
                >
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div className="space-y-0.5">
                    <p className="font-semibold text-foreground">{copy.taskUnavailableTitle}</p>
                    <p className="text-muted-foreground">{copy.taskUnavailableDescription}</p>
                  </div>
                </div>
              ) : null}

              {environments.length === 0 ? (
                <div
                  data-testid="scheduled-tasks-empty-no-env"
                  data-pmx-work-panel-card="1"
                  className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border/75 bg-card px-6 py-14 text-center"
                >
                  <span className="grid size-11 place-items-center rounded-full bg-muted/70 text-muted-foreground">
                    <Clock3Icon className="size-5" />
                  </span>
                  <div className="max-w-md space-y-1">
                    <h2 className="text-sm font-semibold text-foreground">
                      {copy.noEnvironmentsTitle}
                    </h2>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {copy.noEnvironmentsDescription}
                    </p>
                  </div>
                </div>
              ) : anyLoading && allScopedTasks.length === 0 ? (
                <div
                  role="status"
                  data-pmx-work-panel-card="1"
                  className="flex items-center justify-center gap-2 rounded-xl border border-border/75 bg-card px-6 py-12 text-xs text-muted-foreground"
                >
                  <Clock3Icon className="size-4 animate-pulse" />
                  <span>{copy.loadingLabel}</span>
                </div>
              ) : allScopedTasks.length === 0 ? (
                <div
                  data-testid="scheduled-tasks-empty-list"
                  data-pmx-work-panel-card="1"
                  className="flex flex-col items-center justify-center gap-3.5 rounded-xl border border-border/75 bg-card px-6 py-14 text-center"
                >
                  <span className="grid size-11 place-items-center rounded-full bg-primary/14 text-primary">
                    <CalendarClockIcon className="size-5" />
                  </span>
                  <div className="max-w-md space-y-1">
                    <h2 className="text-sm font-semibold text-foreground">{copy.emptyTitle}</h2>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {copy.emptyDescription}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!creationEnvironment}
                    onClick={() =>
                      creationEnvironment &&
                      setEditor({ environmentId: creationEnvironment.environmentId, task: null })
                    }
                  >
                    <PlusIcon className="size-3.5" />
                    <span>{copy.newTaskAction}</span>
                  </Button>
                </div>
              ) : allFilteredTasks.length === 0 && isFiltering ? (
                <div
                  data-testid="scheduled-tasks-empty-filtered"
                  data-pmx-work-panel-card="1"
                  className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border/75 bg-card px-6 py-12 text-center"
                >
                  <div className="max-w-md space-y-1">
                    <h2 className="text-sm font-semibold text-foreground">{copy.noMatchesTitle}</h2>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {copy.noMatchesDescription}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    data-pmx-work-panel-control="1"
                    onClick={() => {
                      setQuery("");
                      setStatusFilter("all");
                    }}
                  >
                    {copy.clearFiltersAction}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  {envStates.map(({ environment: envEntry, connected, timeZone, filteredTasks, error }) => {
                    const showEnvHeader = environments.length > 1 || !connected || error !== null;
                    const { primary, secondary } = settingsScopeEnvironmentLabels(
                      envEntry,
                      environments,
                    );
                    const tasksToShow = filteredTasks ?? [];
                    if (connected && error === null && tasksToShow.length === 0) {
                      return null;
                    }
                    return (
                      <section
                        key={envEntry.environmentId}
                        className="flex flex-col gap-2.5"
                        aria-label={primary}
                      >
                        {showEnvHeader ? (
                          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <EnvironmentMachineIcon
                                kind={resolveEnvironmentMachineKind(envEntry.serverConfig)}
                                className="size-4 shrink-0 text-muted-foreground"
                              />
                              <span className="truncate text-xs font-semibold text-foreground">
                                {primary}
                              </span>
                              <span className="hidden truncate text-2xs text-muted-foreground sm:inline">
                                <ScheduledTaskEnvironmentSubtitle
                                  environment={envEntry}
                                  secondary={secondary}
                                />
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <ConnectionStatusDot
                                dotClassName={connectionPhaseDotClassName(envEntry.connection.phase)}
                                tooltipText={connectionStatusTitle(envEntry.connection, messages)}
                              />
                              <span>{connectionStatusTitle(envEntry.connection, messages)}</span>
                            </div>
                          </div>
                        ) : null}

                        {!connected ? (
                          <div
                            data-pmx-work-panel-card="1"
                            className="rounded-lg border border-border/70 bg-card px-4 py-3 text-xs text-muted-foreground"
                          >
                            {copy.disconnectedPrefix} · {primary}
                          </div>
                        ) : error !== null ? (
                          <div
                            role="alert"
                            data-pmx-work-panel-card="1"
                            className="rounded-xl border border-destructive/45 bg-card px-4 py-3 text-xs text-destructive"
                          >
                            {copy.errorPrefix}: {error}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2.5">
                            {tasksToShow.map((task) => (
                              <ScheduledTaskRow
                                key={task.id}
                                variant="panel"
                                environmentId={envEntry.environmentId}
                                task={task}
                                timeZone={timeZone}
                                projectTitle={projectTitleByKey.get(
                                  `${envEntry.environmentId}:${task.projectId}`,
                                )}
                                onEdit={() =>
                                  setEditor({ environmentId: envEntry.environmentId, task })
                                }
                              />
                            ))}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {editor ? (
            <ScheduledTaskEditorDialog
              key={`${editor.environmentId}:${editor.task?.id ?? "new"}`}
              initialEnvironmentId={editor.environmentId}
              task={editor.task}
              onClose={closeEditor}
            />
          ) : null}
        </div>
      </PrismuxStageFrame>
    </SidebarInset>
  );
}

export function ScheduledTasksPage(props: ScheduledTasksPageProps) {
  const [scopeSearch, setScopeSearch] = useState<SettingsScopeSearch>(() =>
    props.environmentId ? { machine: props.environmentId } : { machine: "all" },
  );

  return (
    <SettingsScopeProvider search={scopeSearch} onChange={setScopeSearch}>
      <ScheduledTasksPanelContent {...props} />
    </SettingsScopeProvider>
  );
}
