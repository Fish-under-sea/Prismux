import type { ScopedThreadRef } from "@prismux/core-contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ActivityIcon, CalendarClockIcon, MoonStarIcon, SearchIcon } from "lucide-react";
import { memo } from "react";

import { useAtomValue } from "@effect/atom-react";
import { openCommandPalette } from "../../commandPaletteBus";
import { shortcutLabelForCommand } from "../../keybindings";
import { cn } from "~/lib/utils";
import { useOptionalPrismuxRuntime } from "../../prismux/PrismuxRuntimeProvider";
import { useLiveDiagnosticsBadgeTone } from "../../prismux/settings/useLiveDiagnosticsBadgeTone";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Kbd } from "../ui/kbd";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  getMainAppReturnHref,
  isSidebarPanelPathActive,
  resolveSidebarPanelToggleNavigation,
} from "./mainAppLocation";
import { usePrismuxSidebarQuickNavCopy } from "./prismuxSidebarQuickNav.copy";
import {
  PRISMUX_SIDEBAR_QUICK_NAV_ROUTES,
  PRISMUX_SIDEBAR_TOGGLE_PANEL_PATHS,
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
 * Orca-aligned top sidebar search bar & lean 3-item quick-navigation block
 * (`diagnostics` -> `automations` -> `overnight-factory`),
 * with persistent 54px icon-rail collapse, two-stage text fade choreography, and
 * bidirectional toggle-close. (`tasks` & `workspace-board` live in the bottom footer toolbar.)
 */
export const PrismuxSidebarQuickNav = memo(function PrismuxSidebarQuickNav({
  routeThreadRef,
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

  const diagnosticsTone = useLiveDiagnosticsBadgeTone(daemon, daemonReady, pathname);

  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };

  const fallbackReturnHref = routeThreadRef
    ? `/${encodeURIComponent(routeThreadRef.environmentId)}/${encodeURIComponent(routeThreadRef.threadId)}`
    : "/";

  const searchShortcutLabel = shortcutLabelForCommand(keybindings, "commandPalette.toggle");

  const diagnosticsActive = isSidebarPanelPathActive(
    pathname,
    PRISMUX_SIDEBAR_TOGGLE_PANEL_PATHS.diagnostics,
  );
  const automationsActive = isSidebarPanelPathActive(
    pathname,
    PRISMUX_SIDEBAR_TOGGLE_PANEL_PATHS.automations,
  );
  const overnightFactoryActive = isSidebarPanelPathActive(
    pathname,
    PRISMUX_SIDEBAR_TOGGLE_PANEL_PATHS.overnightFactory,
  );

  const handleOpenGlobalSearch = () => {
    closeMobileSidebar();
    openCommandPalette({ query: "" });
  };

  const handleToggleWorkPanel = (panelPathnames: readonly string[], targetHref: string) => {
    closeMobileSidebar();
    const decision = resolveSidebarPanelToggleNavigation({
      currentPathname: pathname,
      panelPathnames,
      targetHref,
      lastMainAppHref: getMainAppReturnHref(fallbackReturnHref),
    });
    void navigate({ href: decision.href });
  };

  const handleToggleDiagnostics = () => {
    handleToggleWorkPanel(
      PRISMUX_SIDEBAR_TOGGLE_PANEL_PATHS.diagnostics,
      PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.diagnostics,
    );
  };

  const handleToggleAutomations = () => {
    handleToggleWorkPanel(
      PRISMUX_SIDEBAR_TOGGLE_PANEL_PATHS.automations,
      PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.automations,
    );
  };

  const handleToggleOvernightFactory = () => {
    handleToggleWorkPanel(
      PRISMUX_SIDEBAR_TOGGLE_PANEL_PATHS.overnightFactory,
      PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.overnightFactory,
    );
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
  const automationsRailTooltip = quickNavCopy.scheduledTasks;
  const overnightFactoryRailTooltip = quickNavCopy.overnightFactory;

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
              <SearchIcon
                aria-hidden
                className="size-3.5 text-(--sidebar-icon-color) group-hover:text-sidebar-foreground"
              />
            </TooltipTrigger>
            <TooltipPopup side="right" sideOffset={8}>
              <span className="inline-flex items-center gap-1.5">
                <span>{searchRailTooltip}</span>
                {searchShortcutLabel ? <Kbd>{searchShortcutLabel}</Kbd> : null}
              </span>
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
                aria-pressed={diagnosticsActive}
                onClick={handleToggleDiagnostics}
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

        {/* 2. Scheduled Tasks */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-testid="prismux-nav-automations"
                aria-label={automationsRailTooltip}
                aria-current={automationsActive ? "page" : undefined}
                aria-pressed={automationsActive}
                onClick={handleToggleAutomations}
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

        {/* 3. Overnight Factory & Mail */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-testid="prismux-nav-overnight-factory"
                aria-label={overnightFactoryRailTooltip}
                aria-current={overnightFactoryActive ? "page" : undefined}
                aria-pressed={overnightFactoryActive}
                onClick={handleToggleOvernightFactory}
                className={railButtonClassName(overnightFactoryActive)}
              />
            }
          >
            <MoonStarIcon aria-hidden className={navIconClassName(overnightFactoryActive)} />
          </TooltipTrigger>
          <TooltipPopup side="right" sideOffset={8}>
            {overnightFactoryRailTooltip}
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

      {/* 1. Service diagnostics (standalone main work panel) */}
      <button
        type="button"
        data-testid="prismux-nav-diagnostics"
        aria-current={diagnosticsActive ? "page" : undefined}
        aria-pressed={diagnosticsActive}
        onClick={handleToggleDiagnostics}
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

      {/* 2. Scheduled Tasks (standalone main panel) */}
      <button
        type="button"
        data-testid="prismux-nav-automations"
        aria-current={automationsActive ? "page" : undefined}
        aria-pressed={automationsActive}
        onClick={handleToggleAutomations}
        className={navRowClassName(automationsActive)}
      >
        <CalendarClockIcon aria-hidden className={navIconClassName(automationsActive)} />
        <span className={cn("min-w-0 flex-1 truncate whitespace-nowrap", labelFadeClass)}>
          {quickNavCopy.scheduledTasks}
        </span>
      </button>

      {/* 3. Overnight Factory & Mail (standalone main work panel) */}
      <button
        type="button"
        data-testid="prismux-nav-overnight-factory"
        aria-current={overnightFactoryActive ? "page" : undefined}
        aria-pressed={overnightFactoryActive}
        onClick={handleToggleOvernightFactory}
        className={navRowClassName(overnightFactoryActive)}
      >
        <MoonStarIcon aria-hidden className={navIconClassName(overnightFactoryActive)} />
        <span className={cn("min-w-0 flex-1 truncate whitespace-nowrap", labelFadeClass)}>
          {quickNavCopy.overnightFactory}
        </span>
      </button>
    </nav>
  );
});
