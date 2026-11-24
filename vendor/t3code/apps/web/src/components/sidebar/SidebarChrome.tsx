import {
  ActivityIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarClockIcon,
  ChartNoAxesColumnIcon,
  Columns3Icon,
  CrosshairIcon,
  FolderIcon,
  FolderPlusIcon,
  KeyboardIcon,
  ListTodoIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCwIcon,
  SearchIcon,
  SettingsIcon,
  SmartphoneIcon,
  SquarePenIcon,
} from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { T, useGT } from "gt-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { openCommandPalette } from "../../commandPaletteBus";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { shortcutLabelForCommand } from "../../keybindings";
import {
  navigateHistory,
  useCanNavigateHistory,
  type HistoryDirection,
} from "../../navigationHistory";
import { useProjects, useVisibleThreadShells } from "../../state/entities";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { cn, isMacPlatform } from "../../lib/utils";
import { useOptionalPrismuxRuntime } from "../../prismux/PrismuxRuntimeProvider";
import { PrismuxAutoUpdateHost } from "../../prismux/updates/PrismuxAutoUpdateHost";
import { PrismuxSidebarUpdateCapsule } from "../../prismux/updates/PrismuxSidebarUpdateCapsule";
import { useUpdateNotifierState } from "../../prismux/updates/updateNotifierStore";
import { useIssuesSupported, usePullRequestsSupported } from "../../state/environments";
import { buildThreadRouteParams } from "../../threadRoutes";
import { resolveDesktopUpdateButtonAction } from "../desktopUpdate.logic";
import { openPrismuxRemoteConnectDialog } from "../cloud/prismuxRemoteConnect.logic";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import { Kbd } from "../ui/kbd";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { readIssueListPreferences } from "../issue/issueListPreferences";
import { IssueGlyph } from "../issue/issuePresentation";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { usePrismuxSidebarQuickNavCopy } from "./prismuxSidebarQuickNav.copy";
import {
  PRISMUX_SIDEBAR_QUICK_NAV_ROUTES,
  requestLocateActiveSidebarThread,
} from "./prismuxSidebarQuickNav.logic";
import {
  nextToolbarFocusIndex,
  resolveSidebarUtilityOverflow,
  resolveToolbarItemOwningFocus,
  SIDEBAR_UTILITY_ITEM_ATTR,
} from "./sidebarMicroIndicators";
import {
  buildSidebarPeekGroups,
  resolveSidebarPeekDecision,
  SIDEBAR_PEEK_CLOSE_DELAY_MS,
  SIDEBAR_PEEK_OPEN_DELAY_MS,
} from "./sidebarPeek.logic";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { useUpdateEverythingRun } from "./updateEverythingRun";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { observeResize } from "~/lib/observeResize";

export const SIDEBAR_HEADER_CONTROL_ORDER = ["brand-menu", "sidebar-toggle", "history-nav"] as const;

export const SIDEBAR_APP_MENU_ITEM_IDS = [
  "new-thread",
  "open-workspace",
  "command-palette",
  "settings",
  "keybindings",
  "check-updates",
  "reload-window",
] as const;

const HEADER_ICON_BUTTON_BASE_CLASS =
  "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent transition-colors [-webkit-app-region:no-drag] outline-none focus-visible:ring-1 focus-visible:ring-foreground/25 disabled:pointer-events-none disabled:opacity-35";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const { isMobile, isIconRail, isTextHidden } = useSidebar();
  const gt = useGT();
  const headerRef = useRef<HTMLDivElement | null>(null);
  const backdropVariant = resolveSidebarStageBackdropVariant(
    stageLabel,
    environmentIdentificationMode,
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;
  const railCompact = !isMobile && isIconRail;
  const onBackdrop = backdropVariant !== null;

  return (
    <div
      ref={headerRef}
      data-sidebar-chrome-header="true"
      data-sidebar-rail-compact={railCompact ? "true" : "false"}
      className={cn(
        "relative flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center",
        railCompact
          ? "justify-center px-0"
          : "gap-1.5 pl-[var(--workspace-controls-left)] pr-2.5",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <div className="relative top-[calc(var(--workspace-controls-top)-env(safe-area-inset-top))] z-10 flex shrink-0 items-center md:hidden">
        <SidebarTrigger
          variant={backdropVariant ? "media-navigation" : "ghost"}
          className="relative top-auto translate-y-0"
          aria-label={gt("Toggle main sidebar")}
        />
      </div>
      {railCompact ? (
        <div className="relative z-10 hidden items-center justify-center md:flex">
          <SidebarHeaderToggleButton railCompact onBackdrop={onBackdrop} />
          <SidebarCollapsedPeekDrawer anchorRef={headerRef} isElectron={isElectron} />
        </div>
      ) : (
        <div
          className={cn(
            "relative z-10 flex h-7 min-w-0 flex-1 items-center gap-1 overflow-hidden transition-opacity duration-[90ms] ease-out motion-reduce:transition-none",
            isTextHidden && "pointer-events-none opacity-0",
          )}
        >
          <div className="flex min-w-0 shrink-0 items-center gap-1">
            <SidebarBrandMenu onBackdrop={onBackdrop} />
            <SidebarHeaderToggleButton railCompact={false} onBackdrop={onBackdrop} />
          </div>
          {pillLabel ? (
            <div className="ml-0.5 flex h-6 shrink-0 items-center">
              <Badge data-environment-identification="pill" size="sm" variant="secondary">
                {pillLabel}
              </Badge>
            </div>
          ) : null}
          {isElectron ? (
            <div
              data-sidebar-header-history="true"
              className="ml-auto hidden shrink-0 items-center gap-0.5 md:flex"
            >
              <HistoryNavigationButton direction="back" onBackdrop={onBackdrop} />
              <HistoryNavigationButton direction="forward" onBackdrop={onBackdrop} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});

export function SidebarBrandWidthProbe({
  isElectron,
  onWidthChange,
}: {
  isElectron: boolean;
  onWidthChange: (width: number) => void;
}) {
  const observeWidth = (probe: HTMLDivElement) => {
    return observeResize(probe, ([entry]) => {
      if (entry) onWidthChange(entry.borderBoxSize[0]?.inlineSize ?? probe.offsetWidth);
    });
  };

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none invisible fixed top-0 left-0 flex w-max border-r border-transparent pr-2.5"
      ref={observeWidth}
    >
      <div className="ml-[var(--workspace-controls-left)] flex items-center gap-1">
        <SidebarBrandMark onBackdrop={false} />
        <div className="w-6 shrink-0" />
        {isElectron ? <div className="ml-1 w-[50px] shrink-0" /> : null}
      </div>
    </div>
  );
}

function SidebarHeaderToggleButton({
  railCompact,
  onBackdrop,
}: {
  railCompact: boolean;
  onBackdrop: boolean;
}) {
  const gt = useGT();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { toggleSidebar } = useSidebar();
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle");
  const label = railCompact ? gt("Expand sidebar") : gt("Collapse sidebar");
  const tooltip = shortcutLabel ? `${label} (${shortcutLabel})` : label;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-sidebar="trigger"
            data-slot="sidebar-trigger"
            data-sidebar-header-toggle="true"
            aria-label={label}
            aria-pressed={!railCompact}
            onClick={toggleSidebar}
            className={cn(
              HEADER_ICON_BUTTON_BASE_CLASS,
              railCompact ? "size-7" : "hidden size-6 md:inline-flex",
              onBackdrop
                ? "text-white/85 hover:bg-white/15 hover:text-white"
                : "text-muted-foreground/85 hover:bg-foreground/8 hover:text-foreground dark:hover:bg-white/10",
            )}
          />
        }
      >
        {railCompact ? (
          <PanelLeftIcon className="size-4" aria-hidden="true" />
        ) : (
          <PanelLeftCloseIcon className="size-3.5" aria-hidden="true" />
        )}
      </TooltipTrigger>
      <TooltipPopup side={railCompact ? "right" : "bottom"} sideOffset={railCompact ? 8 : 4}>
        {tooltip}
      </TooltipPopup>
    </Tooltip>
  );
}

function HistoryNavigationButton({
  direction,
  onBackdrop,
}: {
  direction: HistoryDirection;
  onBackdrop: boolean;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const enabled = useCanNavigateHistory(direction);
  const gt = useGT();
  const label = direction === "back" ? gt("Go back") : gt("Go forward");
  const shortcutLabel = shortcutLabelForCommand(
    keybindings,
    direction === "back" ? "navigation.back" : "navigation.forward",
  );
  const Icon = direction === "back" ? ArrowLeftIcon : ArrowRightIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-sidebar-history-nav={direction}
            aria-label={label}
            disabled={!enabled}
            onClick={() => navigateHistory(direction)}
            className={cn(
              HEADER_ICON_BUTTON_BASE_CLASS,
              "size-6",
              onBackdrop
                ? "text-white/85 hover:bg-white/15 hover:text-white"
                : "text-muted-foreground/80 hover:bg-foreground/8 hover:text-foreground dark:hover:bg-white/10",
            )}
          />
        }
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipPopup side="bottom" sideOffset={4}>
        {label}
        {shortcutLabel ? ` (${shortcutLabel})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

function SidebarBrandMenu({
  onBackdrop,
  onOpenChange,
  onAction,
}: {
  onBackdrop: boolean;
  onOpenChange?: ((open: boolean) => void) | undefined;
  onAction?: (() => void) | undefined;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { isMobile, setOpenMobile } = useSidebar();
  const commandPaletteShortcut = shortcutLabelForCommand(keybindings, "commandPalette.toggle");

  const closeAfterAction = () => {
    if (isMobile) setOpenMobile(false);
    onAction?.();
  };

  return (
    <Menu onOpenChange={onOpenChange}>
      <MenuTrigger
        render={
          <button
            type="button"
            data-sidebar-brand-menu-trigger="true"
            aria-label={gt("Prismux home")}
            className={cn(
              "relative z-10 hidden h-6 w-fit min-w-0 shrink-0 cursor-pointer items-center gap-1 overflow-hidden rounded-md px-1.5 transition-colors [-webkit-app-region:no-drag] outline-none focus-visible:ring-1 focus-visible:ring-foreground/25 md:inline-flex",
              onBackdrop
                ? "text-white hover:bg-white/15 data-popup-open:bg-white/18"
                : "text-foreground hover:bg-foreground/8 data-popup-open:bg-foreground/10 dark:hover:bg-white/10 dark:data-popup-open:bg-white/12",
            )}
          />
        }
      >
        <SidebarBrandMark onBackdrop={onBackdrop} />
      </MenuTrigger>
      <MenuPopup
        data-pmx-glass-zone="overlays"
        data-sidebar-brand-menu-popup="true"
        side="bottom"
        align="start"
        sideOffset={6}
        className="min-w-52"
      >
        <MenuItem
          data-sidebar-app-menu-item="new-thread"
          onClick={() => {
            closeAfterAction();
            openCommandPalette({ open: "new-thread-in" });
          }}
        >
          <SquarePenIcon className="size-3.5" aria-hidden="true" />
          <span>{gt("New thread")}</span>
        </MenuItem>
        <MenuItem
          data-sidebar-app-menu-item="open-workspace"
          onClick={() => {
            closeAfterAction();
            openCommandPalette({ open: "add-project" });
          }}
        >
          <FolderPlusIcon className="size-3.5" aria-hidden="true" />
          <span>{gt("Add project")}</span>
        </MenuItem>
        <MenuItem
          data-sidebar-app-menu-item="command-palette"
          onClick={() => {
            closeAfterAction();
            openCommandPalette();
          }}
        >
          <SearchIcon className="size-3.5" aria-hidden="true" />
          <span className="flex-1">{gt("Command palette")}</span>
          {commandPaletteShortcut ? (
            <span className="ml-3 text-[11px] text-muted-foreground tabular-nums">
              {commandPaletteShortcut}
            </span>
          ) : null}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          data-sidebar-app-menu-item="settings"
          onClick={() => {
            closeAfterAction();
            void navigate({ to: "/settings" });
          }}
        >
          <SettingsIcon className="size-3.5" aria-hidden="true" />
          <span>{gt("Settings")}</span>
        </MenuItem>
        <MenuItem
          data-sidebar-app-menu-item="keybindings"
          onClick={() => {
            closeAfterAction();
            void navigate({ to: "/settings/keybindings" });
          }}
        >
          <KeyboardIcon className="size-3.5" aria-hidden="true" />
          <span>
            <T>Keyboard shortcuts</T>
          </span>
        </MenuItem>
        <MenuItem
          data-sidebar-app-menu-item="check-updates"
          onClick={() => {
            closeAfterAction();
            void navigate({ to: "/settings/about" });
          }}
        >
          <RefreshCwIcon className="size-3.5" aria-hidden="true" />
          <span>{gt("Check for updates")}</span>
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          data-sidebar-app-menu-item="reload-window"
          onClick={() => {
            closeAfterAction();
            if (typeof window !== "undefined") {
              window.location.reload();
            }
          }}
        >
          <RotateCwIcon className="size-3.5" aria-hidden="true" />
          <span>{gt("Reload")}</span>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function SidebarBrandMark({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold tracking-tight">
      <img
        alt="Prismux"
        className="size-4 shrink-0 rounded-[4px] object-cover"
        src="/prismux-logo.png"
      />
      <span
        className={cn(
          "truncate [text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both_cap_alphabetic]:py-1",
          onBackdrop ? "text-white" : "text-foreground",
        )}
      >
        {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product wordmark */}
        {"Prismux"}
      </span>
    </span>
  );
}

function SidebarCollapsedPeekBody({
  isElectron,
  onClose,
  onPinExpand,
  onMenuOpenChange,
}: {
  isElectron: boolean;
  onClose: () => void;
  onPinExpand: () => void;
  onMenuOpenChange: (open: boolean) => void;
}) {
  const gt = useGT();
  const quickNavCopy = usePrismuxSidebarQuickNavCopy();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const pullRequestsSupported = usePullRequestsSupported();
  const issuesSupported = useIssuesSupported();
  const projects = useProjects();
  const visibleThreads = useVisibleThreadShells();
  const handleNewThread = useNewThreadHandler();
  const { scratchWorkspaceRootFor } = useScratchProject();
  const routeTarget = useThreadRouteTarget();

  const activeServerRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const searchShortcutLabel =
    shortcutLabelForCommand(keybindings, "commandPalette.toggle") ??
    (typeof navigator !== "undefined" && isMacPlatform(navigator.platform) ? "⌘K" : "Ctrl+K");
  const toggleShortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle");

  const { groups, recentThreads } = buildSidebarPeekGroups({
    projects: projects.map((project) => ({
      environmentId: project.environmentId,
      id: project.id,
      title: project.title,
      archivedAt: project.archivedAt,
      isScratch: isScratchProject(project, scratchWorkspaceRootFor(project.environmentId)),
    })),
    threads: visibleThreads.map((thread) => ({
      environmentId: thread.environmentId,
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      branch: thread.branch,
      updatedAt: thread.updatedAt,
      archivedAt: thread.archivedAt,
      pinnedAt: thread.pinnedAt,
      isSubagent: thread.lineage.parentThreadId !== null,
      isRunning: threadRuntimeIsActive(thread.runtime),
      needsAttention: thread.hasPendingApprovals || thread.hasPendingUserInput,
    })),
  });

  const navRowClass = (active: boolean) =>
    cn(
      "group flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium tracking-tight transition-colors outline-none focus-visible:ring-1 focus-visible:ring-foreground/25",
      active
        ? "bg-sidebar-row-active text-sidebar-foreground"
        : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
    );

  const peekUtilityIds = resolveSidebarUtilityNavIds({
    pullRequestsSupported,
    issuesSupported,
    railCompact: false,
  });

  const navigateAndClose = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <>
      {/* Peek Header: [Logo+Prismux App Menu] [Pin/Expand] ... [Back][Forward] */}
      <div
        data-sidebar-peek-header="true"
        className="flex h-[var(--workspace-topbar-height,36px)] shrink-0 items-center gap-1 border-b border-sidebar-border/45 px-2.5"
      >
        <SidebarBrandMenu
          onBackdrop={false}
          onOpenChange={onMenuOpenChange}
          onAction={onClose}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-sidebar-peek-pin="true"
                aria-label={gt("Expand sidebar")}
                onClick={onPinExpand}
                className={cn(
                  HEADER_ICON_BUTTON_BASE_CLASS,
                  "size-6 text-muted-foreground/85 hover:bg-foreground/8 hover:text-foreground dark:hover:bg-white/10",
                )}
              />
            }
          >
            <PanelLeftIcon className="size-3.5" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup data-pmx-glass-zone="overlays" side="bottom" sideOffset={4}>
            {toggleShortcutLabel
              ? `${gt("Expand sidebar")} (${toggleShortcutLabel})`
              : gt("Expand sidebar")}
          </TooltipPopup>
        </Tooltip>
        {isElectron ? (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <HistoryNavigationButton direction="back" onBackdrop={false} />
            <HistoryNavigationButton direction="forward" onBackdrop={false} />
          </div>
        ) : null}
      </div>

      {/* Quick Navigation + Search */}
      <nav
        aria-label={gt("Workspace quick navigation")}
        data-sidebar-peek-quick-nav="true"
        className="flex shrink-0 flex-col gap-0.5 px-2 pt-2 pb-1.5"
      >
        <button
          type="button"
          data-sidebar-peek-search="true"
          onClick={() => navigateAndClose(() => openCommandPalette({ query: "" }))}
          className="group mb-1 flex h-7 w-full cursor-pointer items-center gap-2 rounded-lg border border-sidebar-border/60 bg-sidebar-foreground/[0.045] px-2 text-left text-[12px] font-medium text-sidebar-muted-foreground transition-colors outline-none hover:bg-sidebar-foreground/[0.09] hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-foreground/25"
        >
          <SearchIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-75" />
          <span className="min-w-0 flex-1 truncate">
            {gt("Search", { $context: "sidebar global search trigger" })}
          </span>
          {searchShortcutLabel ? <Kbd className="text-[10px]">{searchShortcutLabel}</Kbd> : null}
        </button>

        <button
          type="button"
          onClick={() =>
            navigateAndClose(() => void navigate({ to: "/settings/diagnostics" }))
          }
          className={navRowClass(pathname === PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.diagnostics)}
        >
          <ActivityIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-80" />
          <span className="truncate">
            {gt("Service diagnostics", { $context: "sidebar quick navigation" })}
          </span>
        </button>

        <button
          type="button"
          onClick={() => navigateAndClose(() => void navigate({ to: "/tasks" }))}
          className={navRowClass(pathname === PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.tasks)}
        >
          <ListTodoIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-80" />
          <span className="truncate">{quickNavCopy.tasks}</span>
        </button>

        <button
          type="button"
          onClick={() => navigateAndClose(() => void navigate({ to: "/workspace-board" }))}
          className={navRowClass(pathname === PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.workspaceBoard)}
        >
          <Columns3Icon aria-hidden="true" className="size-3.5 shrink-0 opacity-80" />
          <span className="truncate">{quickNavCopy.workspaceBoard}</span>
        </button>

        <button
          type="button"
          onClick={() => navigateAndClose(() => void navigate({ to: "/scheduled-tasks" }))}
          className={navRowClass(pathname === PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.automations)}
        >
          <CalendarClockIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-80" />
          <span className="truncate">{quickNavCopy.scheduledTasks}</span>
        </button>

        <button
          type="button"
          onClick={() => navigateAndClose(() => openPrismuxRemoteConnectDialog())}
          className={navRowClass(pathname === PRISMUX_SIDEBAR_QUICK_NAV_ROUTES.mobileAccess)}
        >
          <SmartphoneIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-80" />
          <span className="truncate">
            {gt("Prismux Mobile", { $context: "sidebar quick navigation" })}
          </span>
        </button>
      </nav>

      {/* Projects & Recent Threads */}
      <div
        data-sidebar-peek-threads="true"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto border-t border-sidebar-border/45 px-2 py-2"
      >
        <div className="flex items-center justify-between px-1.5 pb-0.5">
          <span
            data-sidebar-peek-section-heading="true"
            className="text-[11px] font-medium tracking-wide text-sidebar-muted-foreground/85"
          >
            {groups.length > 0 ? gt("Projects") : gt("Recent Threads")}
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={gt("Add project")}
                  onClick={() => navigateAndClose(() => openCommandPalette({ open: "add-project" }))}
                  className={cn(
                    HEADER_ICON_BUTTON_BASE_CLASS,
                    "size-5 text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                  )}
                />
              }
            >
              <PlusIcon className="size-3.5" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipPopup data-pmx-glass-zone="overlays" side="right" sideOffset={6}>
              {gt("Add project")}
            </TooltipPopup>
          </Tooltip>
        </div>

        {groups.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {groups.map(({ project, threads }) => (
              <div
                key={`${project.environmentId}:${project.id}`}
                data-sidebar-peek-project={project.id}
                className="flex flex-col gap-0.5"
              >
                <div className="group flex h-6 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-sidebar-foreground/90 hover:bg-sidebar-row-hover">
                  <FolderIcon className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{project.title}</span>
                  <button
                    type="button"
                    aria-label={gt("New thread")}
                    onClick={() =>
                      navigateAndClose(() => {
                        void handleNewThread(scopeProjectRef(project.environmentId, project.id));
                      })
                    }
                    className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-sidebar-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-foreground/10 hover:text-sidebar-foreground focus-visible:opacity-100"
                  >
                    <SquarePenIcon className="size-3" aria-hidden="true" />
                  </button>
                </div>
                {threads.map((thread) => {
                  const isActive =
                    activeServerRef?.environmentId === thread.environmentId &&
                    activeServerRef?.threadId === thread.id;
                  return (
                    <button
                      key={`${thread.environmentId}:${thread.id}`}
                      type="button"
                      data-sidebar-peek-thread={thread.id}
                      onClick={() =>
                        navigateAndClose(() => {
                          void navigate({
                            to: "/$environmentId/$threadId",
                            params: buildThreadRouteParams(
                              scopeThreadRef(thread.environmentId, thread.id),
                            ),
                          });
                        })
                      }
                      className={cn(
                        "flex h-7 w-full cursor-pointer items-center gap-2 rounded-md pl-5 pr-2 text-left text-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-foreground/25",
                        isActive
                          ? "bg-sidebar-row-active font-medium text-sidebar-foreground"
                          : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          thread.needsAttention
                            ? "bg-amber-500"
                            : thread.isRunning
                              ? "bg-emerald-500"
                              : "bg-sidebar-muted-foreground/35",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : recentThreads.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {recentThreads.map((thread) => {
              const isActive =
                activeServerRef?.environmentId === thread.environmentId &&
                activeServerRef?.threadId === thread.id;
              return (
                <button
                  key={`${thread.environmentId}:${thread.id}`}
                  type="button"
                  data-sidebar-peek-thread={thread.id}
                  onClick={() =>
                    navigateAndClose(() => {
                      void navigate({
                        to: "/$environmentId/$threadId",
                        params: buildThreadRouteParams(
                          scopeThreadRef(thread.environmentId, thread.id),
                        ),
                      });
                    })
                  }
                  className={cn(
                    "flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-foreground/25",
                    isActive
                      ? "bg-sidebar-row-active font-medium text-sidebar-foreground"
                      : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                  )}
                >
                  <MessageSquareIcon className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => navigateAndClose(() => openCommandPalette({ open: "new-thread-in" }))}
            className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          >
            <SquarePenIcon className="size-3.5 shrink-0 opacity-75" aria-hidden="true" />
            <span className="truncate">{gt("New thread")}</span>
          </button>
        )}
      </div>

      {/* Bottom Utility Row — mirrors canonical Orca left/right footer (zero Help / Wallpaper / Collapse) */}
      <div
        data-sidebar-peek-footer="true"
        className="flex shrink-0 items-center gap-1 border-t border-sidebar-border/45 px-2 py-1.5"
      >
        {peekUtilityIds.map((itemId) => {
          const isFirstRight = itemId === "locate";
          let icon: ReactNode;
          let label: string;
          let onClick: () => void;
          switch (itemId) {
            case "settings":
              icon = <SettingsIcon aria-hidden="true" />;
              label = gt("Settings");
              onClick = () => navigateAndClose(() => void navigate({ to: "/settings" }));
              break;
            case "locate":
              icon = <CrosshairIcon aria-hidden="true" />;
              label = gt("Locate current thread");
              onClick = () => navigateAndClose(() => requestLocateActiveSidebarThread());
              break;
            case "pull-requests":
              icon = <PullRequestGlyph.pullRequest />;
              label = gt("Pull requests");
              onClick = () =>
                navigateAndClose(
                  () =>
                    void navigate({
                      to: "/pull-requests",
                      search: readPullRequestListPreferences(),
                    }),
                );
              break;
            case "issues":
              icon = <IssueGlyph.issue />;
              label = gt("Issues", { $context: "sidebar link to the list of issues" });
              onClick = () =>
                navigateAndClose(
                  () => void navigate({ to: "/issues", search: readIssueListPreferences() }),
                );
              break;
            case "usage":
              icon = <ChartNoAxesColumnIcon aria-hidden="true" />;
              label = gt("Usage");
              onClick = () => navigateAndClose(() => void navigate({ to: "/usage" }));
              break;
          }
          return (
            <Tooltip key={itemId}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    data-sidebar-peek-utility={itemId}
                    aria-label={label}
                    onClick={onClick}
                    className={cn(
                      HEADER_ICON_BUTTON_BASE_CLASS,
                      "size-[26px] text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground [&>svg]:size-[15px] [&_svg]:size-[15px]",
                      isFirstRight && "ml-auto",
                    )}
                  />
                }
              >
                {icon}
              </TooltipTrigger>
              <TooltipPopup data-pmx-glass-zone="overlays" side="top" sideOffset={4}>
                {label}
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
    </>
  );
}

function SidebarCollapsedPeekDrawer({
  anchorRef,
  isElectron,
}: {
  anchorRef: RefObject<HTMLDivElement | null>;
  isElectron: boolean;
}) {
  const gt = useGT();
  const { isMobile, isIconRail, toggleSidebar } = useSidebar();
  const railCompact = !isMobile && isIconRail;
  const [peekOpen, setPeekOpen] = useState(false);
  const [peekEntered, setPeekEntered] = useState(false);

  const peekOpenRef = useRef(false);
  const pointerInRailRef = useRef(false);
  const pointerInDrawerRef = useRef(false);
  const openMenuCountRef = useRef(0);
  const dismissedByEscapeRef = useRef(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const setOpenImmediate = useCallback((nextOpen: boolean) => {
    peekOpenRef.current = nextOpen;
    setPeekOpen(nextOpen);
    if (!nextOpen) {
      setPeekEntered(false);
    }
  }, []);

  const reconcilePeek = useCallback(() => {
    const decision = resolveSidebarPeekDecision(peekOpenRef.current, {
      railCompact,
      pointerInRail: pointerInRailRef.current,
      pointerInDrawer: pointerInDrawerRef.current,
      openMenuCount: openMenuCountRef.current,
      dismissedByEscape: dismissedByEscapeRef.current,
    });
    if (decision === "close-now") {
      clearTimers();
      setOpenImmediate(false);
      return;
    }
    if (decision === "open") {
      clearTimers();
      setOpenImmediate(true);
      return;
    }
    if (decision === "keep-open") {
      clearTimers();
      return;
    }
    if (decision === "schedule-open") {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (openTimerRef.current === null) {
        openTimerRef.current = window.setTimeout(() => {
          openTimerRef.current = null;
          if (pointerInRailRef.current && !dismissedByEscapeRef.current) {
            setOpenImmediate(true);
          }
        }, SIDEBAR_PEEK_OPEN_DELAY_MS);
      }
      return;
    }
    // schedule-close
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current === null) {
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        if (
          !pointerInRailRef.current &&
          !pointerInDrawerRef.current &&
          openMenuCountRef.current === 0
        ) {
          setOpenImmediate(false);
        }
      }, SIDEBAR_PEEK_CLOSE_DELAY_MS);
    }
  }, [clearTimers, railCompact, setOpenImmediate]);

  const closePeekNow = useCallback(() => {
    pointerInRailRef.current = false;
    pointerInDrawerRef.current = false;
    openMenuCountRef.current = 0;
    clearTimers();
    setOpenImmediate(false);
  }, [clearTimers, setOpenImmediate]);

  const handlePinExpand = useCallback(() => {
    closePeekNow();
    toggleSidebar();
  }, [closePeekNow, toggleSidebar]);

  const handleMenuOpenChange = useCallback(
    (open: boolean) => {
      openMenuCountRef.current = Math.max(0, openMenuCountRef.current + (open ? 1 : -1));
      reconcilePeek();
    },
    [reconcilePeek],
  );

  // Trigger smooth CSS entrance on the next animation frame after mounting the floating portal.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives entrance transition frame for portal drawer
  useEffect(() => {
    if (!peekOpen) return;
    const frame = window.requestAnimationFrame(() => setPeekEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [peekOpen]);

  // Attach hover listeners to the enclosing 54px collapsed sidebar rail container.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes DOM pointer hover events on the 54px icon rail container
  useEffect(() => {
    if (!railCompact) {
      closePeekNow();
      return;
    }
    const anchor = anchorRef.current;
    const railContainer =
      anchor?.closest<HTMLElement>('[data-slot="sidebar-container"]') ?? anchor?.parentElement;
    if (!railContainer) return;

    const handleRailEnter = () => {
      dismissedByEscapeRef.current = false;
      pointerInRailRef.current = true;
      reconcilePeek();
    };
    const handleRailLeave = () => {
      pointerInRailRef.current = false;
      reconcilePeek();
    };
    railContainer.addEventListener("pointerenter", handleRailEnter, { passive: true });
    railContainer.addEventListener("pointerleave", handleRailLeave, { passive: true });
    return () => {
      railContainer.removeEventListener("pointerenter", handleRailEnter);
      railContainer.removeEventListener("pointerleave", handleRailLeave);
      clearTimers();
    };
  }, [anchorRef, clearTimers, closePeekNow, railCompact, reconcilePeek]);

  // Allow instant Escape dismiss while floating peek drawer is open.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for Escape key while floating peek drawer is visible
  useEffect(() => {
    if (!peekOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dismissedByEscapeRef.current = true;
      closePeekNow();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closePeekNow, peekOpen]);

  if (!railCompact || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      {!peekOpen ? (
        <div
          aria-hidden="true"
          data-sidebar-peek-hotzone="true"
          className="fixed bottom-[calc(var(--pmx-status-bar-height,20px)+4px)] left-0 top-[var(--workspace-topbar-height,36px)] z-30 w-1.5"
          onPointerEnter={() => {
            dismissedByEscapeRef.current = false;
            pointerInRailRef.current = true;
            reconcilePeek();
          }}
          onPointerLeave={() => {
            pointerInRailRef.current = false;
            reconcilePeek();
          }}
        />
      ) : null}
      {peekOpen ? (
        <aside
          data-pmx-sidebar-peek="1"
          data-state={peekEntered ? "open" : "closed"}
          aria-label={gt("Workspace quick navigation")}
          onPointerEnter={() => {
            pointerInDrawerRef.current = true;
            reconcilePeek();
          }}
          onPointerLeave={() => {
            pointerInDrawerRef.current = false;
            reconcilePeek();
          }}
          className={cn(
            "fixed bottom-[calc(var(--pmx-status-bar-height,20px)+8px)] left-2 top-2 z-40 flex w-[268px] flex-col text-sidebar-foreground will-change-transform",
            peekEntered ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0",
          )}
        >
          <SidebarCollapsedPeekBody
            isElectron={isElectron}
            onClose={closePeekNow}
            onPinExpand={handlePinExpand}
            onMenuOpenChange={handleMenuOpenChange}
          />
        </aside>
      ) : null}
    </>,
    document.body,
  );
}

const SIDEBAR_UTILITY_BUTTON_CLASS =
  "size-[26px] rounded-md p-0 [&>svg]:size-[15px] [&_svg]:size-[15px]";

function SidebarUtilityItem({
  itemId,
  icon,
  label,
  tooltip = label,
  tooltipSide = "top",
  hidden = false,
  isTabStop = false,
  className,
  onFocusItem,
  onClick,
}: {
  itemId: SidebarUtilityNavId;
  icon: ReactNode;
  label: string;
  tooltip?: string | undefined;
  tooltipSide?: "top" | "right";
  hidden?: boolean;
  isTabStop?: boolean;
  className?: string | undefined;
  onFocusItem: (itemId: SidebarUtilityNavId) => void;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem
      className={cn("shrink-0", hidden && "hidden", className)}
      aria-hidden={hidden || undefined}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              {...{ [SIDEBAR_UTILITY_ITEM_ATTR]: itemId }}
              aria-label={label}
              tabIndex={hidden ? -1 : isTabStop ? 0 : -1}
              onFocus={() => onFocusItem(itemId)}
              onClick={onClick}
              size="icon"
              className={SIDEBAR_UTILITY_BUTTON_CLASS}
            >
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side={tooltipSide} sideOffset={tooltipSide === "right" ? 8 : 4}>
          {tooltip}
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

export type SidebarUtilityNavId =
  | "settings"
  | "usage"
  | "locate"
  | "issues"
  | "pull-requests";
type SidebarUtilityFocusId = SidebarUtilityNavId | "more";

/**
 * Resolves the canonical Orca-style bottom sidebar utility item ids for both the expanded footer bar
 * and the 54px collapsed vertical icon rail:
 * - Expanded left group (left -> right): `settings`, `usage`
 * - Expanded right group (left -> right, rightmost is PR): `locate`, `issues`, `pull-requests`
 * Redundant entries that already live elsewhere (Help, Wallpaper, Collapse/Expand sidebar)
 * are intentionally excluded from both modes.
 */
export function resolveSidebarUtilityNavIds(options: {
  readonly pullRequestsSupported: boolean;
  readonly issuesSupported: boolean;
  readonly railCompact: boolean;
}): readonly SidebarUtilityNavId[] {
  const left: readonly SidebarUtilityNavId[] = ["settings", "usage"];
  const right: SidebarUtilityNavId[] = ["locate"];
  if (options.issuesSupported) right.push("issues");
  if (options.pullRequestsSupported) right.push("pull-requests");
  return options.railCompact ? [...right, ...left] : [...left, ...right];
}

const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const gt = useGT();
  const { isMobile, setOpenMobile, isIconRail } = useSidebar();
  const railCompact = !isMobile && isIconRail;
  const isOnUtilityPage = useLocation({
    select: (location) => isSidebarUtilityPage(location.pathname),
  });
  const pullRequestsSupported = usePullRequestsSupported();
  const issuesSupported = useIssuesSupported();
  const [viewportHeight, setViewportHeight] = useState<number>(() =>
    typeof window !== "undefined" ? window.innerHeight : 900,
  );
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [activeTabStopId, setActiveTabStopId] = useState<SidebarUtilityFocusId>("settings");
  const menuRef = useRef<HTMLUListElement | null>(null);
  const lastFocusedItemRef = useRef<SidebarUtilityFocusId | null>(null);

  // Track window height changes so utility items fold smoothly into the More menu without unmounting controllers.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes window resize to adapt sidebar utility capacity when window height shrinks
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes ResizeObserver on stable menuRef to avoid React 19 inline-ref churn
  useEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const measure = () => {
      const nextWidth = Math.round(node.clientWidth);
      setContainerWidth((prev) => (prev === nextWidth ? prev : nextWidth));
    };
    measure();
    return observeResize(node, measure);
  }, []);

  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  const handlePullRequestsClick = () => {
    closeMobileSidebar();
    void navigate({
      to: "/pull-requests",
      search: readPullRequestListPreferences(),
    });
  };
  const handleIssuesClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/issues", search: readIssueListPreferences() });
  };
  const handleSettingsClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  };
  const handleLocateCurrentThreadClick = () => {
    requestLocateActiveSidebarThread();
  };
  const handleUsageClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/usage" });
  };
  const handleBackClick = () => {
    closeMobileSidebar();
    void navigateToMainApp();
  };

  const utilityItems: ReadonlyArray<{
    readonly id: SidebarUtilityNavId;
    readonly group: "left" | "right";
    readonly icon: ReactNode;
    readonly label: string;
    readonly tooltip?: string;
    readonly onClick: () => void;
  }> = [
    {
      id: "settings",
      group: "left",
      icon: <SettingsIcon />,
      label: gt("Settings"),
      onClick: handleSettingsClick,
    },
    {
      id: "usage",
      group: "left",
      icon: <ChartNoAxesColumnIcon />,
      label: gt("Usage"),
      onClick: handleUsageClick,
    },
    {
      id: "locate",
      group: "right",
      icon: <CrosshairIcon />,
      label: gt("Locate current thread"),
      onClick: handleLocateCurrentThreadClick,
    },
    ...(issuesSupported
      ? [
          {
            id: "issues" as const,
            group: "right" as const,
            icon: <IssueGlyph.issue />,
            label: gt("Issues", { $context: "sidebar link to the list of issues" }),
            onClick: handleIssuesClick,
          },
        ]
      : []),
    ...(pullRequestsSupported
      ? [
          {
            id: "pull-requests" as const,
            group: "right" as const,
            icon: <PullRequestGlyph.pullRequest />,
            label: gt("Pull requests"),
            onClick: handlePullRequestsClick,
          },
        ]
      : []),
  ];

  // In collapsed vertical icon rail, width is fixed 54px so capacity depends on viewport height only.
  // With 26x26 compact buttons + 4px gap, all 5 icons fit in ~146px and never fold at standard sidebar widths.
  const overflowState = resolveSidebarUtilityOverflow(
    utilityItems.map((item) => item.id),
    {
      viewportHeight,
      containerWidth: railCompact ? 0 : containerWidth,
      itemSlotWidth: 28,
      reservedTrailingWidth: 8,
    },
  );
  const overflowItems = utilityItems.filter((item) => overflowState.overflowIds.includes(item.id));
  const leftUtilityItems = utilityItems.filter((item) => item.group === "left");
  const rightUtilityItems = utilityItems.filter((item) => item.group === "right");
  const firstVisibleRightId =
    rightUtilityItems.find((item) => overflowState.visibleIds.has(item.id))?.id ?? null;

  // Vertical rail order places utility actions stacked above Settings for ergonomic reach.
  const orderedRailItems = [...rightUtilityItems, ...leftUtilityItems];

  const visibleFocusOrder: readonly SidebarUtilityFocusId[] = railCompact
    ? [
        ...orderedRailItems
          .filter((item) => overflowState.visibleIds.has(item.id))
          .map((item) => item.id),
        ...(overflowItems.length > 0 ? (["more"] as const) : []),
      ]
    : [
        ...leftUtilityItems
          .filter((item) => overflowState.visibleIds.has(item.id))
          .map((item) => item.id),
        ...rightUtilityItems
          .filter((item) => overflowState.visibleIds.has(item.id))
          .map((item) => item.id),
        ...(overflowItems.length > 0 ? (["more"] as const) : []),
      ];

  const effectiveTabStopId: SidebarUtilityFocusId = visibleFocusOrder.includes(activeTabStopId)
    ? activeTabStopId
    : (visibleFocusOrder[0] ?? "settings");

  // Orca AppRail.tsx focus recovery: when height/width folding hides the item that currently owns focus,
  // move focus cleanly to `More` (or the surviving tab stop) instead of dropping focus to document.body.
  const visibleKey = visibleFocusOrder.join(",");
  useLayoutEffect(() => {
    if (isOnUtilityPage) return;
    const toolbar = menuRef.current;
    if (!toolbar) return;
    const owner =
      (resolveToolbarItemOwningFocus(toolbar) as SidebarUtilityFocusId | null) ??
      lastFocusedItemRef.current;
    if (!owner) return;
    if (visibleFocusOrder.includes(owner)) return;
    const activeEl = typeof document !== "undefined" ? document.activeElement : null;
    const focusWasLostOrInsideToolbar =
      activeEl === null || activeEl === document.body || toolbar.contains(activeEl);
    if (!focusWasLostOrInsideToolbar) return;

    const fallbackId: SidebarUtilityFocusId =
      overflowItems.length > 0 ? "more" : (visibleFocusOrder[0] ?? "settings");
    lastFocusedItemRef.current = fallbackId;
    const frame = requestAnimationFrame(() => {
      const target = toolbar.querySelector<HTMLElement>(
        `[${SIDEBAR_UTILITY_ITEM_ATTR}="${fallbackId}"]`,
      );
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOnUtilityPage, overflowItems.length, visibleKey]);

  // WAI-ARIA APG toolbar roving focus in capture phase (horizontal when expanded, vertical in 54px icon rail).
  const handleToolbarKeyDownCapture = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (isOnUtilityPage || visibleFocusOrder.length <= 1) return;
    const toolbar = menuRef.current;
    if (!toolbar) return;
    const target = event.target instanceof Element ? event.target : null;
    const currentItemEl = target?.closest(`[${SIDEBAR_UTILITY_ITEM_ATTR}]`);
    if (!currentItemEl || !toolbar.contains(currentItemEl)) return;
    const currentId = currentItemEl.getAttribute(
      SIDEBAR_UTILITY_ITEM_ATTR,
    ) as SidebarUtilityFocusId | null;
    if (!currentId) return;
    const currentIndex = visibleFocusOrder.indexOf(currentId);
    if (currentIndex < 0) return;

    const nextIndex = nextToolbarFocusIndex(
      event.key,
      currentIndex,
      visibleFocusOrder.length,
      railCompact ? "vertical" : "horizontal",
    );
    if (nextIndex === null) return;

    const nextId = visibleFocusOrder[nextIndex];
    if (!nextId) return;
    const nextEl = toolbar.querySelector<HTMLElement>(
      `[${SIDEBAR_UTILITY_ITEM_ATTR}="${nextId}"]`,
    );
    if (!nextEl) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveTabStopId(nextId);
    lastFocusedItemRef.current = nextId;
    nextEl.focus();
  };

  const tooltipSide: "top" | "right" = railCompact ? "right" : "top";

  return (
    <SidebarMenu
      ref={menuRef}
      role={isOnUtilityPage ? undefined : "toolbar"}
      aria-orientation={isOnUtilityPage ? undefined : railCompact ? "vertical" : "horizontal"}
      aria-label={isOnUtilityPage ? undefined : gt("Sidebar utility toolbar")}
      onKeyDownCapture={handleToolbarKeyDownCapture}
      onFocusCapture={() => {
        const owner = resolveToolbarItemOwningFocus(
          menuRef.current,
        ) as SidebarUtilityFocusId | null;
        if (owner) {
          lastFocusedItemRef.current = owner;
        }
      }}
      data-sidebar-height-collapsed={overflowState.collapsedByHeight ? "true" : "false"}
      data-sidebar-rail-vertical={railCompact ? "true" : "false"}
      data-sidebar-footer-partition="orca"
      className={cn(
        "border-t border-sidebar-border/45",
        railCompact
          ? "flex-col items-center gap-1 pt-1.5"
          : "flex-row items-center gap-1 pt-1",
      )}
    >
      {isOnUtilityPage ? (
        <SidebarMenuItem className={cn(railCompact ? "shrink-0" : "min-w-0 flex-1")}>
          {railCompact ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <SidebarMenuButton
                    size="icon"
                    aria-label={gt("Back")}
                    onClick={handleBackClick}
                  >
                    <ArrowLeftIcon />
                  </SidebarMenuButton>
                }
              />
              <TooltipPopup side="right" sideOffset={8}>
                <T>Back</T>
              </TooltipPopup>
            </Tooltip>
          ) : (
            <SidebarMenuButton onClick={handleBackClick}>
              <ArrowLeftIcon />
              <span>
                <T>Back</T>
              </span>
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      ) : (
        <>
          {/* Keep every utility node mounted via CSS hiding so folding never tears down mounted controllers/popups. */}
          {railCompact
            ? orderedRailItems.map((item) => (
                <SidebarUtilityItem
                  key={item.id}
                  itemId={item.id}
                  icon={item.icon}
                  label={item.label}
                  tooltip={item.tooltip}
                  tooltipSide="right"
                  hidden={!overflowState.visibleIds.has(item.id)}
                  isTabStop={effectiveTabStopId === item.id}
                  onFocusItem={(id) => {
                    setActiveTabStopId(id);
                    lastFocusedItemRef.current = id;
                  }}
                  onClick={item.onClick}
                />
              ))
            : (
              <>
                {leftUtilityItems.map((item) => (
                  <SidebarUtilityItem
                    key={item.id}
                    itemId={item.id}
                    icon={item.icon}
                    label={item.label}
                    tooltip={item.tooltip}
                    tooltipSide="top"
                    hidden={!overflowState.visibleIds.has(item.id)}
                    isTabStop={effectiveTabStopId === item.id}
                    onFocusItem={(id) => {
                      setActiveTabStopId(id);
                      lastFocusedItemRef.current = id;
                    }}
                    onClick={item.onClick}
                  />
                ))}
                <SidebarThreadUndoNotice />
                {rightUtilityItems.map((item) => (
                  <SidebarUtilityItem
                    key={item.id}
                    itemId={item.id}
                    icon={item.icon}
                    label={item.label}
                    tooltip={item.tooltip}
                    tooltipSide="top"
                    className={item.id === firstVisibleRightId ? "ml-auto" : undefined}
                    hidden={!overflowState.visibleIds.has(item.id)}
                    isTabStop={effectiveTabStopId === item.id}
                    onFocusItem={(id) => {
                      setActiveTabStopId(id);
                      lastFocusedItemRef.current = id;
                    }}
                    onClick={item.onClick}
                  />
                ))}
              </>
            )}

          <SidebarMenuItem
            className={cn(
              "shrink-0",
              overflowItems.length === 0 && "hidden",
              !railCompact && firstVisibleRightId === null && "ml-auto",
            )}
            aria-hidden={overflowItems.length === 0 || undefined}
          >
            <Menu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <MenuTrigger
                      render={
                        <SidebarMenuButton
                          {...{ [SIDEBAR_UTILITY_ITEM_ATTR]: "more" }}
                          aria-label={gt("More navigation items")}
                          data-testid="sidebar-utility-more-trigger"
                          tabIndex={
                            overflowItems.length === 0
                              ? -1
                              : effectiveTabStopId === "more"
                                ? 0
                                : -1
                          }
                          onFocus={() => {
                            setActiveTabStopId("more");
                            lastFocusedItemRef.current = "more";
                          }}
                          size="icon"
                          className={SIDEBAR_UTILITY_BUTTON_CLASS}
                        >
                          <MoreHorizontalIcon />
                        </SidebarMenuButton>
                      }
                    />
                  }
                />
                <TooltipPopup side={tooltipSide} sideOffset={railCompact ? 8 : 4}>
                  {gt("More navigation items")}
                </TooltipPopup>
              </Tooltip>
              <MenuPopup
                data-pmx-glass-zone="overlays"
                keepMounted
                align="end"
                side={railCompact ? "right" : "top"}
                sideOffset={railCompact ? 8 : 6}
              >
                {overflowItems.map((item) => (
                  <MenuItem key={item.id} onClick={item.onClick}>
                    {item.icon}
                    <span>{item.label}</span>
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          </SidebarMenuItem>
        </>
      )}
    </SidebarMenu>
  );
});

const SidebarActiveUpdateBanner = memo(function SidebarActiveUpdateBanner() {
  const runtime = useOptionalPrismuxRuntime();
  const desktopUpdateState = useDesktopUpdateState();
  const updateRun = useUpdateEverythingRun();
  const notifierState = useUpdateNotifierState();
  const badge = runtime?.updaterBadge;

  // When the unified Prismux auto-update notifier owns the update (toast / modal / sidebar capsule),
  // suppress the legacy duplicate badge here so only one clean capsule appears above Settings.
  const notifierOwnsPrismuxUpdate =
    notifierState.presentation !== "hidden" &&
    Boolean(notifierState.availableUpdate?.hasUpdate || notifierState.updaterStatus?.downloadedFilePath);

  const hasPrismuxBadge =
    !notifierOwnsPrismuxUpdate &&
    Boolean(
      badge &&
        (badge.hasUpdate ||
          badge.installState === "downloading" ||
          badge.installState === "extracting" ||
          badge.installState === "verifying" ||
          badge.installState === "ready"),
    );
  const hasActionableDesktopUpdate = Boolean(
    updateRun !== null ||
      (desktopUpdateState &&
        (desktopUpdateState.status === "downloading" ||
          resolveDesktopUpdateButtonAction(desktopUpdateState) !== "none")),
  );

  // Never render an idle / unavailable placeholder that clutters the footer or steals space.
  if (!hasPrismuxBadge && !hasActionableDesktopUpdate) {
    return null;
  }

  return (
    <SidebarMenu data-sidebar-active-update-banner="true" className="flex-row items-center pb-1">
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const { isMobile, isIconRail } = useSidebar();
  const railCompact = !isMobile && isIconRail;
  return (
    <SidebarFooter className={cn(railCompact && "px-1.5 pb-1.5")}>
      <div className={cn(railCompact && "hidden")} aria-hidden={railCompact || undefined}>
        <SidebarProviderUpdatePill />
        <SidebarActiveUpdateBanner />
        <SidebarUpdateArchitectureWarning />
      </div>
      <PrismuxSidebarUpdateCapsule railCompact={railCompact} />
      <SidebarUtilityMenu />
      <PrismuxAutoUpdateHost />
    </SidebarFooter>
  );
});
