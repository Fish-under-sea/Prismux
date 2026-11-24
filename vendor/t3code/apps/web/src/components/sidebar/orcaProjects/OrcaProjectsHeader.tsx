import type { EnvironmentId } from "@t3tools/contracts";
import {
  BellIcon,
  ChevronDownIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  PlusIcon,
} from "lucide-react";
import { memo } from "react";

import { cn, isMacPlatform } from "~/lib/utils";
import { Kbd } from "../../ui/kbd";
import { SidebarMenuButton, useSidebar } from "../../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { OrcaAddProjectMenu, type OrcaEnvironmentOption } from "./OrcaAddProjectMenu";
import { OrcaFilterViewMenu } from "./OrcaFilterViewMenu";
import type {
  OrcaActivityBadgeSummary,
  OrcaProjectsPrefs,
} from "./orcaProjects.logic";
import { useOrcaProjectsCopy } from "./orcaProjectsCopy";

export interface OrcaProjectsHeaderProps {
  readonly projectsOpen: boolean;
  readonly onToggleProjectsOpen: () => void;
  readonly canToggleAllProjects: boolean;
  readonly allProjectsCollapsed: boolean;
  readonly onToggleCollapseAllProjects: () => void;
  readonly activityViewActive: boolean;
  readonly onToggleActivityView: () => void;
  readonly activityBadge: OrcaActivityBadgeSummary;
  readonly prefs: OrcaProjectsPrefs;
  readonly onUpdatePrefs: (patch: Partial<OrcaProjectsPrefs>) => void;
  readonly onMarkAllRead: () => void;
  readonly onClearCompleted: () => void;
  readonly environments: readonly OrcaEnvironmentOption[];
  readonly selectedAddProjectEnvId: EnvironmentId | null;
  readonly onSelectAddProjectEnvId: (environmentId: EnvironmentId) => void;
  readonly onBrowseFolder: (environmentId: EnvironmentId | null) => void;
  readonly onOpenCloneDialog: (environmentId: EnvironmentId | null) => void;
  readonly onOpenCreateProjectDialog: (environmentId: EnvironmentId | null) => void;
  readonly onOpenCreateWorkspace: () => void;
}

const BADGE_DOT_CLASS = {
  attention: "bg-amber-500",
  working: "bg-sky-500 animate-pulse motion-reduce:animate-none",
  unread: "bg-primary",
  idle: "bg-sidebar-muted-foreground/65",
} as const;

/**
 * 1:1 Orca Projects section header row (Figures 3, 4, 5, 6, 7, 8), modeled after
 * `stablyai/orca` `SidebarSectionHeader.tsx`, `SidebarHeader.tsx`, `sidebar-header-actions.tsx`,
 * `ProjectsCollapseAllButton.tsx`, and `sidebar-activity-badge.tsx`.
 */
export const OrcaProjectsHeader = memo(function OrcaProjectsHeader({
  projectsOpen,
  onToggleProjectsOpen,
  canToggleAllProjects,
  allProjectsCollapsed,
  onToggleCollapseAllProjects,
  activityViewActive,
  onToggleActivityView,
  activityBadge,
  prefs,
  onUpdatePrefs,
  onMarkAllRead,
  onClearCompleted,
  environments,
  selectedAddProjectEnvId,
  onSelectAddProjectEnvId,
  onBrowseFolder,
  onOpenCloneDialog,
  onOpenCreateProjectDialog,
  onOpenCreateWorkspace,
}: OrcaProjectsHeaderProps) {
  const copy = useOrcaProjectsCopy();
  const { isMobile, isIconRail, isTextHidden } = useSidebar();
  const isMac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);

  const collapseAllLabel = allProjectsCollapsed
    ? copy.expandAllProjects
    : copy.collapseAllProjects;
  const CollapseAllIcon = allProjectsCollapsed ? ChevronsUpDownIcon : ChevronsDownUpIcon;

  const bellTooltip = activityViewActive ? copy.closeActivityView : copy.openActivityView;
  const railBellTooltip = activityViewActive
    ? copy.railCloseNotificationsTooltip
    : copy.railNotificationsTooltip;
  const newWorkspaceShortcutText = isMac ? "⌘N" : "Ctrl+N";

  const labelFadeClass = cn(
    "transition-opacity duration-[90ms] ease-out motion-reduce:transition-none",
    isTextHidden ? "pointer-events-none opacity-0" : "opacity-100",
  );

  // Spec 2 54px Icon-Rail collapsed rendering: preserve exact h-8 divider slot height.
  if (!isMobile && isIconRail) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div
          data-testid="prismux-sidebar-projects-header"
          data-rail-slot="true"
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-full shrink-0 items-center justify-center border-t border-sidebar-border/45 pt-1"
        >
          <span className="h-0.5 w-4 rounded-full bg-sidebar-border/75" />
        </div>

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-testid="prismux-sidebar-inbox-bell"
                data-orca-activity-bell="true"
                aria-label={railBellTooltip}
                aria-pressed={activityViewActive}
                onClick={onToggleActivityView}
                className={cn(
                  "relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  activityViewActive &&
                    "bg-sidebar-row-active text-sidebar-foreground ring-1 ring-inset ring-sidebar-border/80",
                )}
              />
            }
          >
            <BellIcon aria-hidden className="size-4 text-(--sidebar-icon-color)" />
            <span
              aria-hidden
              data-testid="prismux-sidebar-inbox-dot"
              data-rail-dot="true"
              className={cn(
                "pointer-events-none absolute top-1.5 right-1.5 size-1.5 rounded-full ring-2 ring-sidebar",
                BADGE_DOT_CLASS[activityBadge.tone],
              )}
            />
          </TooltipTrigger>
          <TooltipPopup side="right" sideOffset={8}>
            {railBellTooltip}
          </TooltipPopup>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-testid="prismux-sidebar-new-thread"
                data-orca-new-workspace-trigger="true"
                aria-label={copy.newWorkspaceTooltip}
                onClick={onOpenCreateWorkspace}
                className="relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              />
            }
          >
            <PlusIcon aria-hidden className="size-4 text-(--sidebar-icon-color)" strokeWidth={2.25} />
          </TooltipTrigger>
          <TooltipPopup side="right" sideOffset={8}>
            {copy.newWorkspaceTooltip}
          </TooltipPopup>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      data-testid="prismux-sidebar-projects-header"
      data-sidebar-section-header="projects"
      className="group/sidebar-header mt-1 flex h-8 min-w-0 shrink-0 items-center justify-between gap-1 border-t border-sidebar-border/45 pt-1"
    >
      {/* Left side: `∨ 项目` collapsible button + hover/focus-revealed `↕` collapse/expand-all button */}
      <div className={cn("flex min-w-0 flex-1 items-center gap-0.5", labelFadeClass)}>
        <button
          type="button"
          data-testid="prismux-sidebar-projects-toggle"
          aria-expanded={projectsOpen}
          aria-label={projectsOpen ? copy.collapseProjectsSection : copy.expandProjectsSection}
          onClick={(event) => {
            onToggleProjectsOpen();
            if (event.detail > 0) event.currentTarget.blur();
          }}
          className="inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 text-left text-xs font-semibold tracking-tight text-sidebar-muted-foreground outline-none transition-colors hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3 shrink-0 text-sidebar-muted-foreground/80 transition-transform duration-150 motion-reduce:transition-none",
              !projectsOpen && "-rotate-90",
            )}
          />
          <span className="truncate whitespace-nowrap" data-sidebar-section-title="projects">
            {copy.projectsTitle}
          </span>
        </button>

        {/* Figure 3 & Figure 4: hidden at rest, revealed on header hover or keyboard focus */}
        <Tooltip>
          <span
            data-projects-collapse-toggle=""
            data-testid="orca-projects-collapse-all-wrap"
            className={cn(
              "flex shrink-0 overflow-hidden transition-[width,opacity] duration-150 ease-out motion-reduce:transition-none",
              "w-0 opacity-0 pointer-events-none",
              "group-hover/sidebar-header:w-6 group-hover/sidebar-header:opacity-100 group-hover/sidebar-header:pointer-events-auto",
              "focus-within:w-6 focus-within:opacity-100 focus-within:pointer-events-auto",
            )}
          >
            <TooltipTrigger
              render={
                <SidebarMenuButton
                  size="icon"
                  type="button"
                  data-testid="orca-projects-collapse-all"
                  data-can-toggle-projects={canToggleAllProjects ? "true" : "false"}
                  aria-label={collapseAllLabel}
                  onClick={(event) => {
                    onToggleCollapseAllProjects();
                    if (event.detail > 0) event.currentTarget.blur();
                  }}
                  className="size-6 shrink-0 rounded-md p-0 text-sidebar-muted-foreground hover:text-sidebar-foreground"
                />
              }
            >
              <CollapseAllIcon aria-hidden className="size-3.5" strokeWidth={2} />
            </TooltipTrigger>
          </span>
          <TooltipPopup side="top" sideOffset={6}>
            <span className="inline-flex items-center gap-1.5">
              <span>{collapseAllLabel}</span>
              <span className="inline-flex items-center gap-0.5">
                <Kbd className="px-1 py-0 text-[10px]">{isMac ? "⌘" : "Ctrl"}</Kbd>
                <span aria-hidden className="text-[10px] opacity-60">
                  +
                </span>
                <Kbd className="px-1 py-0 text-[10px]">⇧</Kbd>
                <span aria-hidden className="text-[10px] opacity-60">
                  +
                </span>
                <Kbd className="px-1 py-0 text-[10px]">H</Kbd>
              </span>
            </span>
          </TooltipPopup>
        </Tooltip>
      </div>

      {/* Right side: 4 Orca action controls (`🔔•N`, `🎛`, `📁+`, `+`) */}
      <div
        className={cn("flex shrink-0 items-center gap-0.5", labelFadeClass)}
        data-sidebar-header-actions=""
      >
        {/* 1. Agent Activity Bell (`🔔•N`, Figure 5) */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-testid="prismux-sidebar-inbox-bell"
                data-orca-activity-bell="true"
                aria-label={bellTooltip}
                aria-pressed={activityViewActive}
                onClick={onToggleActivityView}
                className={cn(
                  "relative inline-flex h-6.5 min-w-8 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md px-1.5 text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  activityViewActive &&
                    "bg-sidebar-row-active text-sidebar-foreground ring-1 ring-inset ring-sidebar-border/80 shadow-[0_1px_2px_rgb(0_0_0/10%)]",
                )}
              />
            }
          >
            <BellIcon aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
            <span
              aria-hidden
              data-testid="orca-activity-bell-badge"
              data-tone={activityBadge.tone}
              className="pointer-events-none flex flex-col items-center justify-center gap-0.5 leading-none"
            >
              <span
                className={cn("size-1.5 rounded-full", BADGE_DOT_CLASS[activityBadge.tone])}
              />
              <span
                data-testid="prismux-sidebar-inbox-badge"
                className="text-[9px] leading-none font-semibold tracking-tight tabular-nums"
              >
                {activityBadge.displayCount > 99 ? "99+" : activityBadge.displayCount}
              </span>
            </span>
          </TooltipTrigger>
          <TooltipPopup side="bottom" sideOffset={6}>
            {bellTooltip}
          </TooltipPopup>
        </Tooltip>

        {/* 2. Filter & View Options Dropdown (`🎛`, Figure 6) */}
        <OrcaFilterViewMenu
          prefs={prefs}
          onUpdatePrefs={onUpdatePrefs}
          unreadCount={activityBadge.unreadCount}
          completedCount={activityBadge.completedCount}
          onMarkAllRead={onMarkAllRead}
          onClearCompleted={onClearCompleted}
        />

        {/* 3. Add Project Dropdown (`📁+`, Figure 7) */}
        <OrcaAddProjectMenu
          environments={environments}
          selectedEnvironmentId={selectedAddProjectEnvId}
          onSelectEnvironmentId={onSelectAddProjectEnvId}
          onBrowseFolder={onBrowseFolder}
          onOpenCloneDialog={onOpenCloneDialog}
          onOpenCreateProjectDialog={onOpenCreateProjectDialog}
          align="end"
          side="bottom"
          tooltipSide="bottom"
        />

        {/* 4. New Workspace (`+`, Figure 8 & Figure 9) */}
        <Tooltip>
          <TooltipTrigger
            render={
              <SidebarMenuButton
                size="icon"
                type="button"
                data-testid="prismux-sidebar-new-thread"
                data-orca-new-workspace-trigger="true"
                aria-label={copy.newWorkspaceTooltip}
                onClick={onOpenCreateWorkspace}
                className="relative size-6.5 shrink-0 rounded-md p-0 text-sidebar-muted-foreground hover:text-sidebar-foreground"
              />
            }
          >
            <PlusIcon aria-hidden className="size-3.5" strokeWidth={2.25} />
          </TooltipTrigger>
          <TooltipPopup side="bottom" sideOffset={6}>
            <span className="inline-flex items-center gap-1.5">
              <span>{copy.newWorkspaceTooltip}</span>
              <Kbd className="px-1 py-0 text-[10px]">{newWorkspaceShortcutText}</Kbd>
            </span>
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});
