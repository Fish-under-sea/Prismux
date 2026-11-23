import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import {
  ActivityIcon,
  CalendarClockIcon,
  ChevronRightIcon,
  PuzzleIcon,
  QrCodeIcon,
  SearchIcon,
  SmartphoneIcon,
  TabletSmartphoneIcon,
} from "lucide-react";
import { memo, useEffect, useState } from "react";

import { useAtomValue } from "@effect/atom-react";
import { openCommandPalette } from "../../commandPaletteBus";
import { shortcutLabelForCommand } from "../../keybindings";
import { cn, isMacPlatform } from "~/lib/utils";
import { useOptionalPrismuxRuntime } from "../../prismux/PrismuxRuntimeProvider";
import { rightPanelHostRef, useRightPanelStore } from "../../rightPanelStore";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Kbd } from "../ui/kbd";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { useSidebar } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  dismissMobileSidebarOnboardingBadge,
  PRISMUX_SIDEBAR_QUICK_NAV_ROUTES,
  readMobileSidebarOnboardingDismissed,
  resolveDiagnosticsBadgeTone,
  resolveInstalledPluginCount,
  shouldShowMobileSidebarOnboardingBadge,
  type DiagnosticsBadgeTone,
} from "./prismuxSidebarQuickNav.logic";
import { resolvePluginsRailDotTone } from "./sidebarIconRailMotion";

export interface PrismuxSidebarQuickNavProps {
  readonly routeThreadRef: ScopedThreadRef | null;
}

const DIAGNOSTICS_DOT_CLASS: Record<Exclude<DiagnosticsBadgeTone, null>, string> = {
  ok: "bg-emerald-500",
  degraded: "bg-amber-500",
  error: "bg-rose-500",
};

/**
 * Orca-aligned top sidebar search bar & primary quick-navigation block
 * (modeled after `stablyai/orca` `components/sidebar/chrome/SidebarNav.tsx`),
 * with Spec 2 persistent 54px icon-rail collapse & two-stage text fade choreography.
 */
export const PrismuxSidebarQuickNav = memo(function PrismuxSidebarQuickNav({
  routeThreadRef,
}: PrismuxSidebarQuickNavProps) {
  const gt = useGT();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile, isIconRail, isTextHidden } = useSidebar();
  const pathname = useLocation({ select: (location) => location.pathname });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const prismuxRuntime = useOptionalPrismuxRuntime();
  const daemon = prismuxRuntime?.daemon ?? null;
  const daemonReady = prismuxRuntime?.daemonInfo.ready ?? false;

  const [mobilePopoverOpen, setMobilePopoverOpen] = useState(false);
  const [mobileBadgeDismissed, setMobileBadgeDismissed] = useState<boolean>(() =>
    readMobileSidebarOnboardingDismissed(),
  );
  const [diagnosticsTone, setDiagnosticsTone] = useState<DiagnosticsBadgeTone>(null);
  const [installedPluginCount, setInstalledPluginCount] = useState<number | null>(null);

  // Non-blocking lightweight poll on Daemon availability for live diagnostics dot & plugin count.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads read-only daemon badge summaries when daemon becomes ready
  useEffect(() => {
    if (!daemon || !daemonReady) return;
    let cancelled = false;
    void daemon
      .fetchDiagnosticsServices(false)
      .then((report) => {
        if (!cancelled) setDiagnosticsTone(resolveDiagnosticsBadgeTone(report));
      })
      .catch(() => {
        // Leave badge unset if Daemon diagnostics is unavailable.
      });
    void daemon
      .getInstalledPlugins()
      .then((payload) => {
        if (!cancelled) setInstalledPluginCount(resolveInstalledPluginCount(payload));
      })
      .catch(() => {
        // Leave badge unset if Daemon plugin inventory is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [daemon, daemonReady]);

  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };

  const searchShortcutLabel =
    shortcutLabelForCommand(keybindings, "commandPalette.toggle") ??
    (typeof navigator !== "undefined" && isMacPlatform(navigator.platform) ? "⌘K" : "Ctrl+K");

  const showMobileNewBadge = shouldShowMobileSidebarOnboardingBadge(mobileBadgeDismissed);
  const diagnosticsActive = pathname === PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.diagnostics;
  const automationsActive = pathname === PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.automations;
  const mobileAccessActive = pathname === PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.mobileAccess;
  const pluginsActive = pathname === PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.plugins;
  const pluginsDotTone = resolvePluginsRailDotTone(installedPluginCount);

  const handleOpenGlobalSearch = () => {
    closeMobileSidebar();
    openCommandPalette({ query: "" });
  };

  const handleOpenDiagnostics = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings/diagnostics" });
  };

  const handleOpenAutomations = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings/scheduled-tasks" });
  };

  const handleOpenPlugins = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings/plugins" });
  };

  const handleOpenMobileWebAccess = () => {
    setMobilePopoverOpen(false);
    closeMobileSidebar();
    void navigate({ to: "/settings/access" });
  };

  const handleOpenPhoneSimulator = () => {
    setMobilePopoverOpen(false);
    closeMobileSidebar();
    const rightPanel = useRightPanelStore.getState();
    rightPanel.requestMobileSimulatorLaunch();
    if (!routeThreadRef) {
      toastManager.add({
        type: "info",
        title: gt("Open a thread to launch Phone Simulator"),
        description: gt(
          "Select or start any workspace thread, and the right panel will open directly in Phone Simulator mode.",
        ),
      });
      return;
    }
    const hostRef = rightPanelHostRef(routeThreadRef);
    const existingPreview = rightPanel.byThreadKey[scopedThreadKey(hostRef)]?.surfaces.find(
      (surface) => surface.kind === "preview",
    );
    if (existingPreview) {
      rightPanel.activateSurface(hostRef, existingPreview.id);
      rightPanel.show(hostRef);
      return;
    }
    rightPanel.openBrowser(hostRef, null);
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

  const searchRailTooltip = searchShortcutLabel
    ? `${gt("Search", { $context: "sidebar global search trigger" })} (${searchShortcutLabel})`
    : gt("Search", { $context: "sidebar global search trigger" });
  const diagnosticsRailTooltip =
    diagnosticsDotLabel ?? gt("Service diagnostics", { $context: "sidebar quick navigation" });
  const automationsRailTooltip = gt("Automations", { $context: "sidebar quick navigation" });
  const mobileRailTooltip = showMobileNewBadge
    ? `${gt("Prismux Mobile", { $context: "sidebar quick navigation" })} · ${gt("New", { $context: "new feature badge" })}`
    : gt("Prismux Mobile", { $context: "sidebar quick navigation" });
  const pluginsRailTooltip =
    installedPluginCount !== null
      ? `${gt("Plugins", { $context: "sidebar quick navigation" })} (${installedPluginCount})`
      : gt("Plugins", { $context: "sidebar quick navigation" });

  const mobilePopoverBody = (
    <PopoverPopup side="right" align="start" sideOffset={8} width="sm" padding="compact">
      <div className="flex flex-col gap-2 py-1">
        <div className="px-1">
          <PopoverTitle className="text-[13px] font-semibold">
            <T>Prismux Mobile</T>
          </PopoverTitle>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            <T>Preview responsive apps locally or connect your phone over LAN / Tailscale.</T>
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            data-testid="prismux-mobile-open-simulator"
            onClick={handleOpenPhoneSimulator}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border border-border/60 bg-background/50 px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/12 text-primary">
              <TabletSmartphoneIcon aria-hidden className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">
                <T>Built-in Phone Simulator</T>
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                <T>Open mobile frame in right panel</T>
              </span>
            </span>
            <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
          <button
            type="button"
            data-testid="prismux-mobile-open-lan-qr"
            onClick={handleOpenMobileWebAccess}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border border-border/60 bg-background/50 px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
              <QrCodeIcon aria-hidden className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">
                <T>Mobile Web QR access</T>
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                <T>Configure LAN / Tailscale pairing</T>
              </span>
            </span>
            <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </div>
      </div>
    </PopoverPopup>
  );

  if (!isMobile && isIconRail) {
    return (
      <nav
        aria-label={gt("Workspace quick navigation")}
        data-testid="prismux-sidebar-quick-nav"
        data-rail-mode="true"
        className="flex flex-col items-center gap-0.5 pb-1"
      >
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

        <Popover
          open={mobilePopoverOpen}
          onOpenChange={(open) => {
            setMobilePopoverOpen(open);
            if (open && !mobileBadgeDismissed) {
              dismissMobileSidebarOnboardingBadge();
              setMobileBadgeDismissed(true);
            }
          }}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      data-testid="prismux-nav-mobile"
                      aria-label={mobileRailTooltip}
                      aria-current={mobileAccessActive ? "page" : undefined}
                      className={railButtonClassName(mobilePopoverOpen || mobileAccessActive)}
                    />
                  }
                />
              }
            >
              <SmartphoneIcon
                aria-hidden
                className={navIconClassName(mobilePopoverOpen || mobileAccessActive)}
              />
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
          {mobilePopoverBody}
        </Popover>

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-testid="prismux-nav-plugins"
                aria-label={pluginsRailTooltip}
                aria-current={pluginsActive ? "page" : undefined}
                onClick={handleOpenPlugins}
                className={railButtonClassName(pluginsActive)}
              />
            }
          >
            <PuzzleIcon aria-hidden className={navIconClassName(pluginsActive)} />
            {pluginsDotTone ? (
              <span
                aria-hidden
                data-testid="prismux-nav-plugins-dot"
                data-rail-dot="true"
                className="pointer-events-none absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary ring-2 ring-sidebar"
              />
            ) : null}
          </TooltipTrigger>
          <TooltipPopup side="right" sideOffset={8}>
            {pluginsRailTooltip}
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

      {/* 1. Service diagnostics (replaces Orca Tasks — honors AGENTS.md no-Task-Board red line) */}
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

      {/* 2. Automations (T3 Code scheduled tasks) */}
      <button
        type="button"
        data-testid="prismux-nav-automations"
        aria-current={automationsActive ? "page" : undefined}
        onClick={handleOpenAutomations}
        className={navRowClassName(automationsActive)}
      >
        <CalendarClockIcon aria-hidden className={navIconClassName(automationsActive)} />
        <span className={cn("min-w-0 flex-1 truncate whitespace-nowrap", labelFadeClass)}>
          <T context="sidebar quick navigation">Automations</T>
        </span>
      </button>

      {/* 3. Prismux Mobile + persistent dismissible [New] badge (Orca Mobile onboarding pattern) */}
      <Popover
        open={mobilePopoverOpen}
        onOpenChange={(open) => {
          setMobilePopoverOpen(open);
          if (open && !mobileBadgeDismissed) {
            dismissMobileSidebarOnboardingBadge();
            setMobileBadgeDismissed(true);
          }
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              data-testid="prismux-nav-mobile"
              aria-current={mobileAccessActive ? "page" : undefined}
              className={navRowClassName(mobilePopoverOpen || mobileAccessActive)}
            />
          }
        >
          <SmartphoneIcon
            aria-hidden
            className={navIconClassName(mobilePopoverOpen || mobileAccessActive)}
          />
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
        </PopoverTrigger>
        {mobilePopoverBody}
      </Popover>

      {/* 4. Plugins (Cordis dual-realm plugin hub — 0 pre-installed official plugins by default) */}
      <button
        type="button"
        data-testid="prismux-nav-plugins"
        aria-current={pluginsActive ? "page" : undefined}
        onClick={handleOpenPlugins}
        className={navRowClassName(pluginsActive)}
      >
        <PuzzleIcon aria-hidden className={navIconClassName(pluginsActive)} />
        <span className={cn("min-w-0 flex-1 truncate whitespace-nowrap", labelFadeClass)}>
          <T context="sidebar quick navigation">Plugins</T>
        </span>
        {installedPluginCount !== null ? (
          <span
            data-testid="prismux-nav-plugins-count"
            className={cn(
              "shrink-0 rounded-full bg-sidebar-foreground/[0.07] px-1.5 py-px text-[10px] leading-tight font-medium text-sidebar-muted-foreground tabular-nums",
              labelFadeClass,
            )}
          >
            {installedPluginCount}
          </span>
        ) : null}
      </button>
    </nav>
  );
});
