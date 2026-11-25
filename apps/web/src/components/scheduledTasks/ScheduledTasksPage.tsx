import { useAtomValue } from "@effect/atom-react";
import { connectionStatusTitle } from "@prismux/client-runtime/connection";
import {
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type ScheduledTask,
  type ScheduledTaskId,
} from "@prismux/core-contracts";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { useMessages } from "gt-react";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CalendarClockIcon,
  Clock3Icon,
  LayoutTemplateIcon,
  PlusIcon,
  SearchIcon,
  WebhookIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import { useProjects } from "../../state/entities";
import { environmentIdsKey } from "../../state/environmentAtomList";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
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
  resolveScheduledTasksEffectiveEnvironments,
  resolveScheduledTasksScopeSearch,
  summarizeScheduledTasks,
  useScheduledTasksPageCopy,
  type ScheduledTaskQuickPreset,
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
  const {
    scope,
    environments: scopedEnvironments,
    connectedEnvironments: scopedConnectedEnvironments,
    selectScope,
  } = useSettingsScope();
  const { environments: availableEnvironments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const allProjects = useProjects();

  const { environments, connectedEnvironments, defaultEnvironment } =
    resolveScheduledTasksEffectiveEnvironments({
      scopedEnvironments,
      scopedConnectedEnvironments,
      availableEnvironments,
      primaryEnvironmentId,
    });

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ScheduledTasksStatusFilter>("all");
  const [editor, setEditor] = useState<{
    environmentId: EnvironmentId;
    task: ScheduledTask | null;
    preset?: ScheduledTaskQuickPreset | null;
  } | null>(null);

  const projectTitleByKey = new Map<string, string>();
  for (const project of allProjects) {
    projectTitleByKey.set(`${project.environmentId}:${project.id}`, project.title);
  }

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
      (scope.kind === "unavailable" ||
        matchesScheduledTaskScope(scope, linkedEnvironmentId, task.projectId)),
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

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- window Escape key listener closes standalone panel when no modal/input owns focus
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
      scope.kind === "unavailable"
        ? true
        : matchesScheduledTaskScope(scope, envEntry.environmentId, task.projectId),
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

  const createDisabledTooltip =
    connectedEnvironments.length === 0
      ? copy.noEnvironmentsTitle
      : copy.noCreatePermissionTooltip;

  const openNewTaskEditor = (preset?: ScheduledTaskQuickPreset | null) => {
    if (!creationEnvironment) return;
    setEditor({
      environmentId: creationEnvironment.environmentId,
      task: null,
      preset: preset ?? null,
    });
  };

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
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {/* Unified Full-Bleed Header Bar — aligned 1:1 with TasksPage & WorkspaceBoardPage */}
          <header className="flex flex-none flex-wrap items-center justify-between gap-2.5 border-b border-border/65 px-4 py-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/14 text-primary">
                <CalendarClockIcon className="size-4" aria-hidden="true" />
              </span>

              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-[14px] font-semibold tracking-tight text-foreground">
                  {copy.pageTitle}
                </h1>
                <span
                  data-testid="scheduled-tasks-summary-badge"
                  className="inline-flex shrink-0 items-center rounded-full border border-border/65 bg-muted/75 px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums"
                >
                  {copy.summaryBadge(summary.enabled, summary.total)}
                </span>
                {summary.failed > 0 ? (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-destructive/35 bg-destructive/12 px-2 py-0.5 text-2xs font-medium text-destructive tabular-nums">
                    {copy.failedCountBadge(summary.failed)}
                  </span>
                ) : null}
              </div>

              {defaultEnvironment ? (
                <div
                  data-testid="scheduled-tasks-active-env-pill"
                  data-pmx-work-panel-control="1"
                  className="hidden h-7 max-w-64 items-center gap-1.5 rounded-lg border border-border/75 bg-card px-2.5 text-xs text-muted-foreground shadow-xs sm:inline-flex"
                >
                  <ConnectionStatusDot
                    dotClassName={connectionPhaseDotClassName(defaultEnvironment.connection.phase)}
                    tooltipText={connectionStatusTitle(defaultEnvironment.connection, messages)}
                  />
                  <EnvironmentMachineIcon
                    kind={resolveEnvironmentMachineKind(defaultEnvironment.serverConfig)}
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="truncate font-medium text-foreground">
                    {availableEnvironments.length > 1 && selectedMachineValue === "all"
                      ? copy.allEnvironmentsLabel
                      : defaultEnvironment.label}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {availableEnvironments.length > 1 ? (
                <Select
                  value={selectedMachineValue}
                  onValueChange={(value) => {
                    selectScope(resolveScheduledTasksScopeSearch(value));
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
                        : (availableEnvironments.find(
                            (e) => e.environmentId === selectedMachineValue,
                          )?.label ?? copy.allEnvironmentsLabel)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="all">{copy.allEnvironmentsLabel}</SelectItem>
                    {availableEnvironments.map((entry) => (
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
                        onClick={() => openNewTaskEditor()}
                      >
                        <PlusIcon className="size-3.5" />
                        <span>{copy.newTaskAction}</span>
                      </Button>
                    </span>
                  }
                />
                {!creationEnvironment ? (
                  <TooltipPopup side="bottom" sideOffset={6}>
                    {createDisabledTooltip}
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

          {/* Full-Width Work-Panel Content Area (zero wasted centered side margins, matches TasksPage) */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4">
            {/* Joined Filter & Search Chrome */}
            <div
              data-testid="scheduled-tasks-filter-chrome"
              data-pmx-work-panel-card="1"
              className="flex flex-none flex-wrap items-center justify-between gap-2.5 rounded-t-xl border border-border/75 bg-card px-3.5 py-2.5"
            >
              <div
                role="group"
                aria-label={copy.pageTitle}
                className="flex min-w-0 flex-wrap items-center gap-1.5"
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
                          : "border-border/75 bg-card text-muted-foreground shadow-xs hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {chip.id === "webhook" ? (
                        <WebhookIcon className="size-3.5 shrink-0 opacity-85" aria-hidden="true" />
                      ) : null}
                      <span>{chip.label}</span>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-px text-3xs leading-none font-semibold tabular-nums",
                          active
                            ? "bg-primary-foreground/20 text-primary-foreground"
                            : "bg-muted/85 text-muted-foreground",
                        )}
                      >
                        {chip.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="relative flex min-w-0 flex-1 basis-52 items-center sm:max-w-xs md:max-w-sm">
                <SearchIcon className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={copy.searchPlaceholder}
                  aria-label={copy.searchPlaceholder}
                  data-testid="scheduled-tasks-search-input"
                  data-pmx-work-panel-control="1"
                  className="h-8 w-full rounded-lg border border-input bg-card pr-7 pl-8 text-xs text-foreground shadow-xs outline-none placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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

            {/* Joined Full-Width Functional Body Shell */}
            <div
              data-pmx-work-panel-card="1"
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-b-xl border border-t-0 border-border/75 bg-card shadow-xs"
            >
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="flex w-full flex-col gap-4">
                  {linkedTaskMissing ? (
                    <div
                      role="status"
                      data-pmx-work-panel-control="1"
                      className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-card px-4 py-3 text-xs"
                    >
                      <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                      <div className="space-y-0.5">
                        <p className="text-[13px] font-semibold text-foreground">
                          {copy.taskUnavailableTitle}
                        </p>
                        <p className="text-[11.5px] font-normal leading-[1.5] text-muted-foreground">
                          {copy.taskUnavailableDescription}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {environments.length === 0 ? (
                    <div
                      data-testid="scheduled-tasks-empty-no-env"
                      className="flex min-h-70 flex-col items-center justify-center gap-3 px-6 py-12 text-center"
                    >
                      <span className="grid size-11 place-items-center rounded-full bg-muted/70 text-muted-foreground">
                        <Clock3Icon className="size-5" />
                      </span>
                      <div className="max-w-md space-y-1">
                        <h2 className="text-sm font-semibold text-foreground">
                          {copy.noEnvironmentsTitle}
                        </h2>
                        <p className="text-[11.5px] font-normal leading-[1.5] text-muted-foreground">
                          {copy.noEnvironmentsDescription}
                        </p>
                      </div>
                    </div>
                  ) : anyLoading && allScopedTasks.length === 0 ? (
                    <div
                      role="status"
                      className="flex min-h-56 items-center justify-center gap-2 px-6 py-12 text-xs text-muted-foreground"
                    >
                      <Clock3Icon className="size-4 animate-pulse" />
                      <span>{copy.loadingLabel}</span>
                    </div>
                  ) : allScopedTasks.length === 0 ? (
                    <div
                      data-testid="scheduled-tasks-empty-list"
                      className="flex w-full flex-col gap-6 py-4"
                    >
                      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/75 px-6 py-8 text-center">
                        <span className="grid size-11 place-items-center rounded-full bg-primary/14 text-primary">
                          <CalendarClockIcon className="size-5" />
                        </span>
                        <div className="max-w-xl space-y-1.5">
                          <h2 className="text-sm font-semibold text-foreground">
                            {copy.emptyTitle}
                          </h2>
                          <p className="text-[11.5px] font-normal leading-[1.5] text-muted-foreground">
                            {copy.emptyDescription}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          data-testid="scheduled-tasks-empty-create-cta"
                          disabled={!creationEnvironment}
                          onClick={() => openNewTaskEditor()}
                          className="mt-1"
                        >
                          <PlusIcon className="size-3.5" />
                          <span>{copy.createFirstTaskCta}</span>
                        </Button>
                      </div>

                      {/* Full-width Quick Templates Grid */}
                      <div className="space-y-2.5">
                        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
                          <LayoutTemplateIcon className="size-3.5 text-primary" aria-hidden="true" />
                          <span>{copy.quickTemplatesHeading}</span>
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          {copy.quickTemplates.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              disabled={!creationEnvironment}
                              data-testid={`scheduled-tasks-template-${preset.id}`}
                              data-pmx-work-panel-control="1"
                              onClick={() => openNewTaskEditor(preset)}
                              className="group flex cursor-pointer flex-col justify-between gap-3 rounded-xl border border-border/75 bg-card p-4 text-left shadow-xs transition-all hover:border-primary/50 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/80 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                                    {preset.scheduleMode === "webhook" ? (
                                      <WebhookIcon className="size-3 text-primary" />
                                    ) : (
                                      <Clock3Icon className="size-3 text-primary" />
                                    )}
                                    <span>{preset.scheduleBadge}</span>
                                  </span>
                                  <ArrowRightIcon className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                                </div>
                                <h3 className="text-[13px] font-semibold leading-snug text-foreground">
                                  {preset.title}
                                </h3>
                                <p className="text-[11.5px] font-normal leading-[1.5] text-muted-foreground">
                                  {preset.description}
                                </p>
                              </div>
                              <span className="text-2xs font-medium text-primary">
                                {copy.useTemplateAction}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : allFilteredTasks.length === 0 && isFiltering ? (
                    <div
                      data-testid="scheduled-tasks-empty-filtered"
                      className="flex min-h-60 flex-col items-center justify-center gap-3 px-6 py-12 text-center"
                    >
                      <div className="max-w-md space-y-1">
                        <h2 className="text-sm font-semibold text-foreground">
                          {copy.noMatchesTitle}
                        </h2>
                        <p className="text-[11.5px] font-normal leading-[1.5] text-muted-foreground">
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
                    <div className="flex w-full flex-col gap-5">
                      {envStates.map(
                        ({ environment: envEntry, connected, timeZone, filteredTasks, error }) => {
                          const showEnvHeader =
                            environments.length > 1 || !connected || error !== null;
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
                              className="flex w-full flex-col gap-2.5"
                              aria-label={primary}
                            >
                              {showEnvHeader ? (
                                <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <EnvironmentMachineIcon
                                      kind={resolveEnvironmentMachineKind(envEntry.serverConfig)}
                                      className="size-4 shrink-0 text-muted-foreground"
                                    />
                                    <span className="truncate text-[13px] font-semibold tracking-tight text-foreground">
                                      {primary}
                                    </span>
                                    <span className="hidden truncate text-[11px] font-normal text-muted-foreground sm:inline">
                                      <ScheduledTaskEnvironmentSubtitle
                                        environment={envEntry}
                                        secondary={secondary}
                                      />
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
                                    <ConnectionStatusDot
                                      dotClassName={connectionPhaseDotClassName(
                                        envEntry.connection.phase,
                                      )}
                                      tooltipText={connectionStatusTitle(
                                        envEntry.connection,
                                        messages,
                                      )}
                                    />
                                    <span>
                                      {connectionStatusTitle(envEntry.connection, messages)}
                                    </span>
                                  </div>
                                </div>
                              ) : null}

                              {!connected ? (
                                <div
                                  data-pmx-work-panel-control="1"
                                  className="rounded-lg border border-border/70 bg-card px-4 py-3 text-[11.5px] font-normal leading-[1.5] text-muted-foreground"
                                >
                                  {copy.disconnectedPrefix} · {primary}
                                </div>
                              ) : error !== null ? (
                                <div
                                  role="alert"
                                  data-pmx-work-panel-control="1"
                                  className="rounded-xl border border-destructive/45 bg-card px-4 py-3 text-xs text-destructive"
                                >
                                  {copy.errorPrefix}: {error}
                                </div>
                              ) : (
                                <div className="flex w-full flex-col gap-2.5">
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
                        },
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {editor ? (
            <ScheduledTaskEditorDialog
              key={`${editor.environmentId}:${editor.task?.id ?? editor.preset?.id ?? "new"}`}
              initialEnvironmentId={editor.environmentId}
              task={editor.task}
              initialPreset={editor.preset}
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
    resolveScheduledTasksScopeSearch(props.environmentId),
  );

  return (
    <SettingsScopeProvider search={scopeSearch} onChange={setScopeSearch}>
      <ScheduledTasksPanelContent {...props} />
    </SettingsScopeProvider>
  );
}
