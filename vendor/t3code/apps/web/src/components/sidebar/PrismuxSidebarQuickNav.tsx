import type { ScopedThreadRef } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import {
  ActivityIcon,
  CalendarClockIcon,
  Columns3Icon,
  ListTodoIcon,
  SearchIcon,
  SmartphoneIcon,
} from "lucide-react";
import { memo, useState } from "react";

import { useAtomValue } from "@effect/atom-react";
import { openCommandPalette } from "../../commandPaletteBus";
import { shortcutLabelForCommand } from "../../keybindings";
import { cn, isMacPlatform } from "~/lib/utils";
import { useOptionalPrismuxRuntime } from "../../prismux/PrismuxRuntimeProvider";
import { useLiveDiagnosticsBadgeTone } from "../../prismux/settings/useLiveDiagnosticsBadgeTone";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { openPrismuxRemoteConnectDialog } from "../cloud/prismuxRemoteConnect.logic";
import { Kbd } from "../ui/kbd";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { usePrismuxSidebarQuickNavCopy } from "./prismuxSidebarQuickNav.copy";
import {
  dismissMobileSidebarOnboardingBadge,
  PRISMUX_SIDEBAR_QUICK_NAV_ROUTES,
  readMobileSidebarOnboardingDismissed,
  shouldShowMobileSidebarOnboardingBadge,
  type DiagnosticsBadgeTone,
} from "./prismuxSidebarQuickNav.logic";

export interface PrismuxSidebarQuickNavProps {
  readonly routeThreadRef: ScopedThreadRef | null;
  readonly showSearch?: boolean;
}

const DIAGNOSTICS_DOT_CLASS: Record<Exclude<DiagnosticsBadgeTone, null>, string> = {
  ok: "bg-emerald-500",
  degraded: "bg-amber-500",
  error: "bg-rose-500",
};

/**
 * Orca-aligned top sidebar search bar & primary 5-item quick-navigation block
 * (`diagnostics` -> `tasks` -> `workspace-board` -> `automations` -> `mobile`),
 * with Spec 2 persistent 54px icon-rail collapse & two-stage text fade choreography.
 */
export const PrismuxSidebarQuickNav = memo(function PrismuxSidebarQuickNav({
  showSearch = true,
}: PrismuxSidebarQuickNavProps) {
  const gt = useGT();
  const quickNavCopy = usePrismuxSidebarQuickNavCopy();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile, isIconRail, isTextHidden } = useSidebar();
  const pathname = useLocation({ select: (location) => location.pathname });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const prismuxRuntime = useOptionalPrismuxRuntime();
  const daemon = prismuxRuntime?.daemon ?? null;
  const daemonReady = prismuxRuntime?.daemonInfo.ready ?? false;

  const [mobileBadgeDismissed, setMobileBadgeDismissed] = useState<boolean>(() =>
    readMobileSidebarOnboardingDismissed(),
  );
  const diagnosticsTone = useLiveDiagnosticsBadgeTone(daemon, daemonReady, pathname);

  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };

  const searchShortcutLabel =
    shortcutLabelForCommand(keybindings, "commandPalette.toggle") ??
    (typeof navigator !== "undefined" && isMacPlatform(navigator.platform) ? "⌘K" : "Ctrl+K");

  const showMobileNewBadge = shouldShowMobileSidebarOnboardingBadge(mobileBadgeDismissed);
  const diagnosticsActive = pathname === PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.diagnostics;
  const tasksActive = pathname === PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.tasks;
  const workspaceBoardActive = pathname === PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.workspaceBoard;
  const automationsActive = pathname === PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.automations;
  const mobileAccessActive = pathname === PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.mobileAccess;

  const handleOpenGlobalSearch = () => {
    closeMobileSidebar();
    openCommandPalette({ query: "" });
  };

  const handleOpenDiagnostics = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings/diagnostics" });
  };

  const handleOpenTasks = () => {
    closeMobileSidebar();
    void navigate({ to: "/tasks" });
  };

  const handleOpenWorkspaceBoard = () => {
    closeMobileSidebar();
    void navigate({ to: "/workspace-board" });
  };

  const handleOpenAutomations = () => {
    closeMobileSidebar();
    void navigate({ to: "/scheduled-tasks" });
  };

  const handleOpenRemoteConnect = () => {
    if (!mobileBadgeDismissed) {
      dismissMobileSidebarOnboardingBadge();
      setMobileBadgeDismissed(true);
    }
    closeMobileSidebar();
    openPrismuxRemoteConnectDialog();
  };

  const labelFadeClass = cn(
    "transition-opacity duration-[90ms] ease-out motion-reduce:transition-none",
    isTextHidden ? "pointer-events-none opacity-0" : "opacity-100",
  );

  const navRowClassName = (active: boolean) =>
    cn(
      "group relative flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium tracking-tight outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      active
        ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
        : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
    );

  const railButtonClassName = (active: boolean) =>
    cn(
      "group relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      active
        ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
        : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
    );

  const navIconClassName = (active: boolean) =>
    cn(
      "size-4 shrink-0 transition-colors",
      active
        ? "text-sidebar-foreground"
        : "text-(--sidebar-icon-color) group-hover:text-sidebar-foreground/85",
    );

  const diagnosticsDotLabel =
    diagnosticsTone === "error"
      ? gt("Service diagnostics: issues detected")
      : diagnosticsTone === "degraded"
        ? gt("Service diagnostics: degraded services")
        : diagnosticsTone === "ok"
          ? gt("Service diagnostics: all healthy")
          : null;

  const searchRailTooltip = gt("Search", { $context: "sidebar global search trigger" });
  const diagnosticsRailTooltip =
    diagnosticsTone === "error" || diagnosticsTone === "degraded"
      ? (diagnosticsDotLabel ?? gt("Service diagnostics", { $context: "sidebar quick navigation" }))
      : gt("Service diagnostics", { $context: "sidebar quick navigation" });
  const tasksRailTooltip = quickNavCopy.tasks;
  const workspaceBoardRailTooltip = quickNavCopy.workspaceBoard;
  const automationsRailTooltip = quickNavCopy.scheduledTasks;
  const mobileRailTooltip = gt("Prismux Mobile", { $context: "sidebar quick navigation" });

  if (!isMobile && isIconRail) {
    return (
      <nav
        aria-label={gt("Workspace quick navigation")}
        data-testid="prismux-sidebar-quick-nav"
        data-rail-mode="true"
        className="flex flex-col items-center gap-0.5 pb-1"
      >
        {showSearch ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  data-testid="prismux-sidebar-search-button"
                  onClick={handleOpenGlobalSearch}
                  aria-label={searchRailTooltip}
                  className="group mb-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-sidebar-border/60 bg-sidebar-foreground/[0.045] text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-foreground/[0.09] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                />
              }
            >
              <SearchIcon aria-hidden className="size-3.5 text-(--sidebar-icon-color) group-hover:text-sidebar-foreground" />
            </TooltipTrigger>
            <TooltipPopup side="right" sideOffset={8}>
              {searchRailTooltip}
            </TooltipPopup>
          </Tooltip>
        ) : null}

        {/* 1. Service diagnostics */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-testid="prismux-nav-diagnostics"
                aria-label={diagnosticsRailTooltip}
                aria-current={diagnosticsActive ? "page" : undefined}
                onClick={handleOpenDiagnostics}
                className={railButtonClassName(diagnosticsActive)}
              />
            }
          >
            <ActivityIcon aria-hidden className={navIconClassName(diagnosticsActive)} />
            {diagnosticsTone ? (
              <span
                aria-hidden
                data-testid="prismux-nav-diagnostics-dot"
                data-rail-dot="true"
                data-tone={diagnosticsTone}
                className={cn(
                  "pointer-events-none absolute top-1.5 right-1.5 size-1.5 rounded-full ring-2 ring-sidebar",
                  DIAGNOSTICS_DOT_CLASS[diagnosticsTone],
                )}
              />
            ) : null}
          </TooltipTrigger>
          <TooltipPopup side="right" sideOffset={8}>
            {diagnosticsRailTooltip}
          </TooltipPopup>
        </Tooltip>

        {/* 2. Tasks */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-testid="prismux-nav-tasks"
                aria-label={tasksRailTooltip}
                aria-current={tasksActive ? "page" : undefined}
                onClick={handleOpenTasks}
                className={railButtonClassName(tasksActive)}
              />
            }
          >
            <ListTodoIcon aria-hidden className={navIconClassName(tasksActive)} />
          </TooltipTrigger>
          <TooltipPopup side="right" sideOffset={8}>
            {tasksRailTooltip}
          </TooltipPopup>
        </Tooltip>

        {/* 3. Workspace board */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-testid="prismux-nav-workspace-board"
                aria-label={workspaceBoardRailTooltip}
                aria-current={workspaceBoardActive ? "page" : undefined}
                onClick={handleOpenWorkspaceBoard}
                className={railButtonClassName(workspaceBoardActive)}
              />
            }
          >
            <Columns3Icon aria-hidden className={navIconClassName(workspaceBoardActive)} />
          </TooltipTrigger>
          <TooltipPopup side="right" sideOffset={8}>
            {workspaceBoardRailTooltip}
          </TooltipPopup>
        </Tooltip>

        {/* 4. Automations */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-testid="prismux-nav-automations"
                aria-label={automationsRailTooltip}
                aria-current={automationsActive ? "page" : undefined}
                onClick={handleOpenAutomations}
                className={railButtonClassName(automationsActive)}
              />
            }
          >
            <CalendarClockIcon aria-hidden className={navIconClassName(automationsActive)} />
          </TooltipTrigger>
          <TooltipPopup side="right" sideOffset={8}>
            {automationsRailTooltip}
          </TooltipPopup>
        </Tooltip>

        {/* 5. Prismux Mobile (opens centered Remote Access & T3 Connect modal) */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-testid="prismux-nav-mobile"
                aria-label={mobileRailTooltip}
                aria-current={mobileAccessActive ? "page" : undefined}
                onClick={handleOpenRemoteConnect}
                className={railButtonClassName(mobileAccessActive)}
              />
            }
          >
            <SmartphoneIcon aria-hidden className={navIconClassName(mobileAccessActive)} />
            {showMobileNewBadge ? (
              <span
                aria-hidden
                data-testid="prismux-nav-mobile-new-dot"
                data-rail-dot="true"
                className="pointer-events-none absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary ring-2 ring-sidebar"
              />
            ) : null}
          </TooltipTrigger>
          <TooltipPopup side="right" sideOffset={8}>
            {mobileRailTooltip}
          </TooltipPopup>
        </Tooltip>
      </nav>
    );
  }

  return (
    <nav
      aria-label={gt("Workspace quick navigation")}
      data-testid="prismux-sidebar-quick-nav"
      data-rail-mode="false"
      className="flex flex-col gap-0.5 pb-1"
    >
      {/* Top full-width rounded Search trigger (Orca SidebarNav search bar) */}
      {showSearch ? (
        <button
          type="button"
          data-testid="prismux-sidebar-search-button"
          onClick={handleOpenGlobalSearch}
          aria-label={gt("Search threads and commands")}
          className="group mb-1 flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg border border-sidebar-border/60 bg-sidebar-foreground/[0.045] px-2.5 text-left text-[13px] font-medium tracking-tight text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-foreground/[0.085] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <SearchIcon
            aria-hidden
            className="size-3.5 shrink-0 text-(--sidebar-icon-color) transition-colors group-hover:text-sidebar-foreground/80"
          />
          <span className={cn("min-w-0 flex-1 truncate whitespace-nowrap", labelFadeClass)}>
            <T context="sidebar global search trigger">Search</T>
          </span>
          {searchShortcutLabel ? (
            <Kbd
              aria-hidden
              className={cn(
                "pointer-events-none shrink-0 border-sidebar-border/70 bg-sidebar-foreground/[0.06] px-1.5 py-px text-[10px] text-sidebar-muted-foreground opacity-70 shadow-none transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
                isTextHidden && "opacity-0!",
              )}
            >
              {searchShortcutLabel}
            </Kbd>
          ) : null}
        </button>
      ) : null}

      {/* 1. Service diagnostics */}
      <button
        type="button"
        data-testid="prismux-nav-diagnostics"
        aria-current={diagnosticsActive ? "page" : undefined}
        onClick={handleOpenDiagnostics}
        className={navRowClassName(diagnosticsActive)}
      >
        <ActivityIcon aria-hidden className={navIconClassName(diagnosticsActive)} />
        <span className={cn("min-w-0 flex-1 truncate whitespace-nowrap", labelFadeClass)}>
          <T context="sidebar quick navigation">Service diagnostics</T>
        </span>
        {diagnosticsTone ? (
          <span
            role="img"
            aria-label={diagnosticsDotLabel ?? undefined}
            title={diagnosticsDotLabel ?? undefined}
            data-testid="prismux-nav-diagnostics-dot"
            data-tone={diagnosticsTone}
            className={cn(
              "size-2 shrink-0 rounded-full",
              DIAGNOSTICS_DOT_CLASS[diagnosticsTone],
              labelFadeClass,
            )}
          />
        ) : null}
      </button>

      {/* 2. Tasks (Orca-aligned GitHub Issues / PR / Projects aggregator) */}
      <button
        type="button"
        data-testid="prismux-nav-tasks"
        aria-current={tasksActive ? "page" : undefined}
        onClick={handleOpenTasks}
        className={navRowClassName(tasksActive)}
      >
        <ListTodoIcon aria-hidden className={navIconClassName(tasksActive)} />
        <span className={cn("min-w-0 flex-1 truncate whitespace-nowrap", labelFadeClass)}>
          {quickNavCopy.tasks}
        </span>
      </button>

      {/* 3. Workspace board (Orca-aligned 4-column Todo / In progress / In review / Done board) */}
      <button
        type="button"
        data-testid="prismux-nav-workspace-board"
        aria-current={workspaceBoardActive ? "page" : undefined}
        onClick={handleOpenWorkspaceBoard}
        className={navRowClassName(workspaceBoardActive)}
      >
        <Columns3Icon aria-hidden className={navIconClassName(workspaceBoardActive)} />
        <span className={cn("min-w-0 flex-1 truncate whitespace-nowrap", labelFadeClass)}>
          {quickNavCopy.workspaceBoard}
        </span>
      </button>

      {/* 4. Scheduled Tasks (standalone main panel) */}
      <button
        type="button"
        data-testid="prismux-nav-automations"
        aria-current={automationsActive ? "page" : undefined}
        onClick={handleOpenAutomations}
        className={navRowClassName(automationsActive)}
      >
        <CalendarClockIcon aria-hidden className={navIconClassName(automationsActive)} />
        <span className={cn("min-w-0 flex-1 truncate whitespace-nowrap", labelFadeClass)}>
          {quickNavCopy.scheduledTasks}
        </span>
      </button>

      {/* 5. Prismux Mobile + persistent dismissible [New] badge (opens centered Remote Access & T3 Connect modal) */}
      <button
        type="button"
        data-testid="prismux-nav-mobile"
        aria-current={mobileAccessActive ? "page" : undefined}
        onClick={handleOpenRemoteConnect}
        className={navRowClassName(mobileAccessActive)}
      >
        <SmartphoneIcon aria-hidden className={navIconClassName(mobileAccessActive)} />
        <span className={cn("min-w-0 flex-1 truncate whitespace-nowrap", labelFadeClass)}>
          <T context="sidebar quick navigation">Prismux Mobile</T>
        </span>
        {showMobileNewBadge ? (
          <span
            data-testid="prismux-nav-mobile-new-badge"
            className={cn(
              "shrink-0 rounded-full bg-primary px-1.5 py-px text-[10px] leading-tight font-semibold text-primary-foreground",
              labelFadeClass,
            )}
          >
            <T context="new feature badge">New</T>
          </span>
        ) : null}
      </button>
    </nav>
  );
});
