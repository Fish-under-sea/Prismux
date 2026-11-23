import {
  ActivityIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  BugIcon,
  ChartNoAxesColumnIcon,
  CircleHelpIcon,
  CrosshairIcon,
  ExternalLinkIcon,
  ImageIcon,
  KeyboardIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  SettingsIcon,
} from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { T, useGT } from "gt-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { useAtomValue } from "@effect/atom-react";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { shortcutLabelForCommand } from "../../keybindings";
import {
  navigateHistory,
  useCanNavigateHistory,
  type HistoryDirection,
} from "../../navigationHistory";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { cn } from "../../lib/utils";
import { useIssuesSupported, usePullRequestsSupported } from "../../state/environments";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { openSafeExternalHttpsUrl } from "../settings/prismuxProviderMeta";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
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
import {
  requestLocateActiveSidebarThread,
  resolveSafePrismuxHelpUrl,
} from "./prismuxSidebarQuickNav.logic";
import {
  nextToolbarFocusIndex,
  resolveSidebarUtilityOverflow,
  resolveToolbarItemOwningFocus,
  SIDEBAR_UTILITY_ITEM_ATTR,
} from "./sidebarMicroIndicators";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { observeResize } from "~/lib/observeResize";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const { isMobile, isIconRail, isTextHidden } = useSidebar();
  const gt = useGT();
  const backdropVariant = resolveSidebarStageBackdropVariant(
    stageLabel,
    environmentIdentificationMode,
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;
  const railCompact = !isMobile && isIconRail;

  return (
    <div
      className={cn(
        "relative flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center gap-2 pr-3",
        railCompact && "justify-center px-0",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <div className="relative top-[calc(var(--workspace-controls-top)-env(safe-area-inset-top))] z-10 ml-[calc(var(--workspace-controls-left)+1px-env(safe-area-inset-left))] flex shrink-0 items-center md:hidden">
        <SidebarTrigger
          variant={backdropVariant ? "media-navigation" : "ghost"}
          className="relative top-auto translate-y-0"
          aria-label={gt("Toggle main sidebar")}
        />
      </div>
      {railCompact ? null : (
        <div
          className={cn(
            "relative z-10 flex h-8 min-w-0 flex-1 flex-wrap content-start items-center gap-x-2 overflow-hidden py-0.5 transition-opacity duration-[90ms] ease-out motion-reduce:transition-none",
            isTextHidden && "pointer-events-none opacity-0",
          )}
        >
          <div className="flex shrink-0 items-center gap-1">
            <SidebarBrand onBackdrop={backdropVariant !== null} />
            {isElectron ? (
              <div className="hidden items-center md:flex">
                <HistoryNavigationButton direction="back" onBackdrop={backdropVariant !== null} />
                <HistoryNavigationButton
                  direction="forward"
                  onBackdrop={backdropVariant !== null}
                />
              </div>
            ) : null}
          </div>
          {pillLabel ? (
            <div className="ml-1 flex h-7 items-center">
              <Badge data-environment-identification="pill" size="sm" variant="secondary">
                {pillLabel}
              </Badge>
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
      className="pointer-events-none invisible fixed top-0 left-0 flex w-max border-r border-transparent pr-3"
      ref={observeWidth}
    >
      <div className="ml-[var(--workspace-titlebar-content-left)] flex gap-1">
        <SidebarBrandMark onBackdrop={false} />
        {isElectron ? (
          <div className="w-[calc(2*var(--workspace-titlebar-control-size))]" />
        ) : null}
      </div>
    </div>
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
          <Button
            aria-label={label}
            className={cn(
              "[-webkit-app-region:no-drag]",
              onBackdrop && "relative top-auto translate-y-0",
            )}
            disabled={!enabled}
            onClick={() => navigateHistory(direction)}
            size="icon-sm"
            variant={onBackdrop ? "media-navigation" : "ghost"}
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {label}
        {shortcutLabel ? ` (${shortcutLabel})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

function SidebarBrand({ onBackdrop }: { onBackdrop: boolean }) {
  const gt = useGT();
  return (
    <Link
      aria-label={gt("Prismux home")}
      className={cn(
        "relative z-10 ml-[var(--workspace-titlebar-content-left)] hidden h-7 w-fit min-w-0 shrink-0 items-center overflow-hidden rounded-md outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset md:flex",
        onBackdrop ? "text-white" : "text-foreground",
      )}
      to="/"
    >
      <SidebarBrandMark onBackdrop={onBackdrop} />
    </Link>
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

type SidebarUtilityNavId =
  | "settings"
  | "help"
  | "locate"
  | "wallpaper"
  | "toggle-sidebar"
  | "pull-requests"
  | "issues"
  | "usage";
type SidebarUtilityFocusId = SidebarUtilityNavId | "more";

const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const gt = useGT();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { isMobile, setOpenMobile, toggleSidebar, isIconRail } = useSidebar();
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
  const handleWallpaperClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings/wallpaper" });
  };
  const handleLocateCurrentThreadClick = () => {
    requestLocateActiveSidebarThread();
  };
  const handleToggleSidebarClick = () => {
    if (isMobile) {
      setOpenMobile(false);
      return;
    }
    toggleSidebar();
  };
  const handleUsageClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/usage" });
  };
  const handleBackClick = () => {
    closeMobileSidebar();
    void navigateToMainApp();
  };
  const handleOpenOnboarding = () => {
    closeMobileSidebar();
    void navigate({ to: "/welcome" });
  };
  const handleOpenKeybindings = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings/keybindings" });
  };
  const handleOpenDiagnostics = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings/diagnostics" });
  };
  const handleOpenExternalHelpLink = (linkId: "repository" | "issues") => {
    const safeUrl = resolveSafePrismuxHelpUrl(linkId);
    if (safeUrl) {
      openSafeExternalHttpsUrl(safeUrl);
    }
  };

  const sidebarToggleShortcut = shortcutLabelForCommand(keybindings, "sidebar.toggle");
  const toggleSidebarLabel = railCompact ? gt("Expand sidebar") : gt("Collapse sidebar");
  const toggleSidebarTooltip = sidebarToggleShortcut
    ? `${toggleSidebarLabel} (${sidebarToggleShortcut})`
    : toggleSidebarLabel;

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
      id: "help",
      group: "left",
      icon: <CircleHelpIcon />,
      label: gt("Help"),
      onClick: handleOpenOnboarding,
    },
    {
      id: "locate",
      group: "right",
      icon: <CrosshairIcon />,
      label: gt("Locate current thread"),
      onClick: handleLocateCurrentThreadClick,
    },
    {
      id: "wallpaper",
      group: "right",
      icon: <ImageIcon />,
      label: gt("Wallpaper & appearance"),
      onClick: handleWallpaperClick,
    },
    {
      id: "toggle-sidebar",
      group: "right",
      icon: railCompact ? <PanelLeftIcon /> : <PanelLeftCloseIcon />,
      label: toggleSidebarLabel,
      tooltip: toggleSidebarTooltip,
      onClick: handleToggleSidebarClick,
    },
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
    {
      id: "usage",
      group: "right",
      icon: <ChartNoAxesColumnIcon />,
      label: gt("Usage"),
      onClick: handleUsageClick,
    },
  ];

  // In collapsed vertical icon rail, width is fixed 54px so capacity depends on viewport height only.
  const overflowState = resolveSidebarUtilityOverflow(
    utilityItems.map((item) => item.id),
    {
      viewportHeight,
      containerWidth: railCompact ? 0 : containerWidth,
      itemSlotWidth: 30,
      reservedTrailingWidth: 24,
    },
  );
  const overflowItems = utilityItems.filter((item) => overflowState.overflowIds.includes(item.id));
  const helpOverflowed = overflowState.overflowIds.includes("help");
  const leftUtilityItems = utilityItems.filter((item) => item.group === "left");
  const rightUtilityItems = utilityItems.filter((item) => item.group === "right");
  const firstVisibleRightId =
    rightUtilityItems.find((item) => overflowState.visibleIds.has(item.id))?.id ?? null;

  // Vertical rail order places utility actions stacked above Settings / Help / Expand for ergonomic reach.
  const orderedRailItems = [
    ...rightUtilityItems.filter((item) => item.id !== "toggle-sidebar"),
    ...leftUtilityItems,
    ...rightUtilityItems.filter((item) => item.id === "toggle-sidebar"),
  ];

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

  const renderHelpMenuItems = () => (
    <>
      <MenuItem onClick={handleOpenOnboarding}>
        <BookOpenIcon className="size-3.5" />
        <span>
          <T>Onboarding guide</T>
        </span>
      </MenuItem>
      <MenuItem onClick={handleOpenKeybindings}>
        <KeyboardIcon className="size-3.5" />
        <span>
          <T>Keyboard shortcuts</T>
        </span>
      </MenuItem>
      <MenuItem onClick={handleOpenDiagnostics}>
        <ActivityIcon className="size-3.5" />
        <span>
          <T>Service diagnostics</T>
        </span>
      </MenuItem>
      <MenuSeparator />
      <MenuItem onClick={() => handleOpenExternalHelpLink("repository")}>
        <ExternalLinkIcon className="size-3.5" />
        <span>
          <T>Prismux on GitHub</T>
        </span>
      </MenuItem>
      <MenuItem onClick={() => handleOpenExternalHelpLink("issues")}>
        <BugIcon className="size-3.5" />
        <span>
          <T>Report an issue</T>
        </span>
      </MenuItem>
    </>
  );

  const tooltipSide: "top" | "right" = railCompact ? "right" : "top";
  const helpHidden = !overflowState.visibleIds.has("help");

  const renderHelpTriggerItem = (item: (typeof utilityItems)[number]) => (
    <SidebarMenuItem
      key="help"
      className={cn("shrink-0", helpHidden && "hidden")}
      aria-hidden={helpHidden || undefined}
    >
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <SidebarMenuButton
                    {...{ [SIDEBAR_UTILITY_ITEM_ATTR]: "help" }}
                    aria-label={item.label}
                    data-testid="sidebar-utility-help-trigger"
                    tabIndex={helpHidden ? -1 : effectiveTabStopId === "help" ? 0 : -1}
                    onFocus={() => {
                      setActiveTabStopId("help");
                      lastFocusedItemRef.current = "help";
                    }}
                    size="icon"
                  >
                    {item.icon}
                  </SidebarMenuButton>
                }
              />
            }
          />
          <TooltipPopup side={tooltipSide} sideOffset={railCompact ? 8 : 4}>
            {item.label}
          </TooltipPopup>
        </Tooltip>
        <MenuPopup
          keepMounted
          align={railCompact ? "end" : "start"}
          side={railCompact ? "right" : "top"}
          sideOffset={railCompact ? 8 : 6}
        >
          {renderHelpMenuItems()}
        </MenuPopup>
      </Menu>
    </SidebarMenuItem>
  );

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
      className={cn(
        "border-t border-sidebar-border/45",
        railCompact
          ? "flex-col items-center gap-1 pt-1.5"
          : "flex-row items-center gap-0.5 pt-1",
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
            ? orderedRailItems.map((item) =>
                item.id === "help" ? (
                  renderHelpTriggerItem(item)
                ) : (
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
                ),
              )
            : (
              <>
                {leftUtilityItems.map((item) =>
                  item.id === "help" ? (
                    renderHelpTriggerItem(item)
                  ) : (
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
                  ),
                )}
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
                keepMounted
                align="end"
                side={railCompact ? "right" : "top"}
                sideOffset={railCompact ? 8 : 6}
              >
                {overflowItems
                  .filter((item) => item.id !== "help")
                  .map((item) => (
                    <MenuItem key={item.id} onClick={item.onClick}>
                      {item.icon}
                      <span>{item.label}</span>
                    </MenuItem>
                  ))}
                {helpOverflowed ? (
                  <>
                    {overflowItems.some((item) => item.id !== "help") ? <MenuSeparator /> : null}
                    {renderHelpMenuItems()}
                  </>
                ) : null}
              </MenuPopup>
            </Menu>
          </SidebarMenuItem>
        </>
      )}
      {railCompact ? null : (
        <>
          <SidebarThreadUndoNotice />
          <SidebarUpdatePill />
        </>
      )}
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
        <SidebarUpdateArchitectureWarning />
      </div>
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
