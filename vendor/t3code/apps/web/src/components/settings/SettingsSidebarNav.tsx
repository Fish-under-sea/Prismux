import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import {
  ActivityIcon,
  ArchiveIcon,
  FlaskConicalIcon,
  BotIcon,
  createLucideIcon,
  CalendarClockIcon,
  DatabaseIcon,
  DownloadCloudIcon,
  FileDiffIcon,
  FolderTreeIcon,
  GitBranchIcon,
  GlobeIcon,
  ImageIcon,
  InfoIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
  PanelsTopLeftIcon,
  KeyboardIcon,
  KeyRoundIcon,
  MicIcon,
  PaletteIcon,
  PuzzleIcon,
  SearchIcon,
  ServerIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SmartphoneIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { resolveEventKeys } from "@t3tools/shared/keybindings";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { T, useGT, useMessages } from "gt-react";

import { hasCloudPublicConfig } from "../../cloud/publicConfig";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { observeResize } from "../../lib/observeResize";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarInput,
} from "../ui/sidebar";
import { scrollToSettingsTarget } from "./settingsLayout";
import {
  searchSettings,
  revealSettingsSearchTarget,
  settingsNavGroups,
  SETTINGS_NAV_LABELS,
  SETTINGS_SECTION_LABELS,
  type SettingsPath,
  type SettingsSearchItem,
} from "./settingsSearch";
import {
  areGeometryMapsEqual,
  buildIndicatorPillStyle,
  createInitialIndicatorState,
  findSettingsNavTarget,
  resolveSettingsNavActivePath,
  transitionIndicatorState,
  type SettingsNavIndicatorMachineState,
  type SettingsNavIndicatorTarget,
  type SettingsNavItemGeometry,
} from "./settingsSidebarMotion";
import {
  useAvailableSettingsSearchItems,
  useHasSecretProvidersEnvironment,
} from "./useAvailableSettingsSearchItems";
import { handleSettingsSectionKeyDown } from "./settingsSectionNavigation";
import { workspaceAreaProps } from "../../lib/workspaceFocus";

const SnapShotIcon = createLucideIcon("snap-shot", [
  [
    "path",
    {
      d: "M8 3H6a3 3 0 0 0-3 3v2M16 3h2a3 3 0 0 1 3 3v2M21 16v2a3 3 0 0 1-3 3h-2M8 21H6a3 3 0 0 1-3-3v-2",
      key: "capture-frame",
    },
  ],
  ["rect", { width: "10", height: "8", x: "7", y: "8", rx: "2", key: "window" }],
  ["circle", { cx: "12", cy: "12", r: "1.5", key: "lens" }],
]);

const T3ConnectSidebarSignIn = lazy(() =>
  import("../clerk/T3ConnectSidebarSignIn").then((module) => ({
    default: module.T3ConnectSidebarSignIn,
  })),
);
const T3ConnectSidebarAvatar = lazy(() =>
  import("../clerk/T3ConnectSidebarSignIn").then((module) => ({
    default: module.T3ConnectSidebarAvatar,
  })),
);

const SETTINGS_SECTION_ICONS: Readonly<
  Record<SettingsPath, ComponentType<{ className?: string }>>
> = {
  "/settings/general": Settings2Icon,
  "/settings/diagnostics": ActivityIcon,
  "/settings/voice": MicIcon,
  "/settings/appearance": PaletteIcon,
  "/settings/chat": MessageSquareTextIcon,
  "/settings/diffs": FileDiffIcon,
  "/settings/projects": PanelsTopLeftIcon,
  "/settings/keybindings": KeyboardIcon,
  "/settings/snap-shot": SnapShotIcon,
  "/settings/providers": BotIcon,
  "/settings/threads": MessagesSquareIcon,
  "/settings/browser": GlobeIcon,
  "/settings/devices": SmartphoneIcon,
  "/settings/scheduled-tasks": CalendarClockIcon,
  "/settings/source-control": GitBranchIcon,
  "/settings/worktrees": FolderTreeIcon,
  "/settings/connections": ServerIcon,
  "/settings/access": ShieldCheckIcon,
  "/settings/secrets": KeyRoundIcon,
  "/settings/maintenance": WrenchIcon,
  "/settings/labs": FlaskConicalIcon,
  "/settings/about": InfoIcon,
  "/settings/archived": ArchiveIcon,
  "/settings/wallpaper": ImageIcon,
  "/settings/plugins": PuzzleIcon,
  "/settings/memory-sync": DatabaseIcon,
  "/settings/updates": DownloadCloudIcon,
};

// Attached only to the highlighted result, so it runs whenever the highlight lands on a row.
function scrollResultIntoView(row: HTMLElement | null) {
  row?.scrollIntoView({ block: "nearest" });
}

function SettingsSectionIcon({ to }: { to: SettingsPath }) {
  const Icon = SETTINGS_SECTION_ICONS[to];
  return <Icon className="size-4 h-5 shrink-0 text-(--sidebar-icon-color)" />;
}

function measureItemGeometry(
  menuElement: HTMLElement,
  itemElement: HTMLElement,
): SettingsNavItemGeometry {
  if (itemElement.offsetParent === menuElement && itemElement.offsetHeight > 0) {
    return {
      y: itemElement.offsetTop,
      height: itemElement.offsetHeight,
    };
  }
  const menuRect = menuElement.getBoundingClientRect();
  const itemRect = itemElement.getBoundingClientRect();
  return {
    y: Math.round(itemRect.top - menuRect.top),
    height: Math.round(itemRect.height),
  };
}

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const gt = useGT();
  const m = useMessages();
  const navArea = workspaceAreaProps("settings-nav", 0, gt("Settings sections"));
  const navigate = useNavigate();
  const currentHash = useLocation({ select: (location) => location.hash });
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const isCompactRail = useMediaQuery("max-md");
  const cloudEnabled = hasCloudPublicConfig();
  const activePath = resolveSettingsNavActivePath(pathname);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const groupsContainerRef = useRef<HTMLDivElement>(null);
  const menuRefs = useRef<Map<string, HTMLUListElement>>(new Map());
  const itemRefs = useRef<Map<SettingsPath, HTMLLIElement>>(new Map());
  const itemGeometriesRef = useRef<Readonly<Record<string, SettingsNavItemGeometry>>>({});
  const [query, setQuery] = useState("");
  // Below md the nav is an icon rail; searching expands it over the page.
  const [compactSearchOpen, setCompactSearchOpen] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const searchableItems = useAvailableSettingsSearchItems();
  const hasSecretProviders = useHasSecretProvidersEnvironment();
  const navGroups = settingsNavGroups(hasSecretProviders);
  const activeTarget = findSettingsNavTarget(navGroups, pathname);
  const results = searchSettings(query, searchableItems, m);
  const isSearching = query.trim().length > 0;
  const hasResults = results.length > 0;
  const maxResultIndex = Math.max(results.length - 1, 0);
  // Persist the clamp so a shrink-then-recover of results keeps the clamped highlight.
  if (activeResultIndex > maxResultIndex) {
    setActiveResultIndex(maxResultIndex);
  }

  const [itemGeometries, setItemGeometries] = useState<
    Readonly<Record<string, SettingsNavItemGeometry>>
  >({});
  const [suppressMotionForLayout, setSuppressMotionForLayout] = useState(false);

  const activeTargetKey = activeTarget ? `${activeTarget.groupId}:${activeTarget.path}` : "";
  const [trackedActiveKey, setTrackedActiveKey] = useState(activeTargetKey);
  const [activeIndicator, setActiveIndicator] = useState<SettingsNavIndicatorMachineState>(() =>
    createInitialIndicatorState(navGroups, activeTarget, "instant"),
  );
  if (trackedActiveKey !== activeTargetKey) {
    setTrackedActiveKey(activeTargetKey);
    setSuppressMotionForLayout(false);
    setActiveIndicator((prev) =>
      transitionIndicatorState(prev, activeTarget, {
        groups: navGroups,
        reducedMotion: prefersReducedMotion,
        initialMode: "instant",
      }),
    );
  }

  const [hoverIndicator, setHoverIndicator] = useState<SettingsNavIndicatorMachineState>(() =>
    createInitialIndicatorState(navGroups, null, "enter"),
  );

  const updateHoverTarget = (nextTarget: SettingsNavIndicatorTarget | null) => {
    setSuppressMotionForLayout(false);
    setHoverIndicator((prev) => {
      if (
        prev.current?.groupId === nextTarget?.groupId &&
        prev.current?.path === nextTarget?.path
      ) {
        return prev;
      }
      return transitionIndicatorState(prev, nextTarget, {
        groups: navGroups,
        reducedMotion: prefersReducedMotion,
        initialMode: "enter",
      });
    });
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observeResize commits measured slot geometry before paint with value-equality guard
  useEffect(() => {
    if (isSearching) return;
    const container = groupsContainerRef.current;
    if (!container) return;
    const measure = () => {
      const next: Record<string, SettingsNavItemGeometry> = {};
      for (const group of navGroups) {
        const menuElement = menuRefs.current.get(group.id);
        if (!menuElement) continue;
        for (const path of group.paths) {
          const itemElement = itemRefs.current.get(path);
          if (!itemElement) continue;
          next[path] = measureItemGeometry(menuElement, itemElement);
        }
      }
      if (areGeometryMapsEqual(itemGeometriesRef.current, next)) {
        return;
      }
      itemGeometriesRef.current = next;
      setSuppressMotionForLayout(true);
      setItemGeometries(next);
    };
    return observeResize(container, measure);
  }, [isSearching, navGroups]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window keydown listener for the find and slash search shortcuts
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const eventKeys = resolveEventKeys(event);
      const isFindShortcut =
        eventKeys.has("f") && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
      // Shift is allowed only when the layout types "/" with it (German Shift+7); Shift on
      // the physical Slash key types "?" or "," instead.
      const isSlashShortcut =
        eventKeys.has("/") &&
        (event.key === "/" || !event.shiftKey) &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey;
      if (!isFindShortcut && !isSlashShortcut) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        ((isSlashShortcut &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)) ||
          target.closest(
            '[role="dialog"]:not([data-app-modal]), [aria-modal="true"]:not([data-app-modal]), [data-slot$="popup"]:not([data-app-modal]), [data-keybinding-capture]',
          ) !== null)
      ) {
        return;
      }

      event.preventDefault();
      setCompactSearchOpen(true);
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the search input DOM node after the compact search opens
  useEffect(() => {
    if (compactSearchOpen) searchInputRef.current?.focus();
  }, [compactSearchOpen]);

  const handleSectionClick = (to: SettingsPath) => {
    void navigate({
      to,
      hash: "",
      replace: true,
      hashScrollIntoView: false,
    });
  };

  const clearSearch = () => {
    setQuery("");
    setActiveResultIndex(0);
    updateHoverTarget(null);
  };
  const handleSearchResultClick = (item: SettingsSearchItem) => {
    clearSearch();
    setCompactSearchOpen(false);
    const targetId = item.targetId ?? item.id;
    revealSettingsSearchTarget(targetId);
    if (pathname === item.to && currentHash.replace(/^#/, "") === targetId) {
      scrollToSettingsTarget(targetId);
      return;
    }
    void navigate({
      to: item.to,
      hash: targetId,
      replace: true,
      hashScrollIntoView: false,
      state: { settingsTargetHighlight: true },
    });
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && isSearching) {
      event.preventDefault();
      event.stopPropagation();
      clearSearch();
      return;
    }
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveResultIndex((activeResultIndex + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveResultIndex((activeResultIndex - 1 + results.length) % results.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = results[activeResultIndex];
      if (result) handleSearchResultClick(result);
    }
  };

  const hasMeasuredGeometry = Object.values(itemGeometries).some((entry) => entry.height > 0);

  return (
    <nav
      {...navArea}
      role="navigation"
      className={cn(
        "flex w-60 shrink-0 flex-col border-e bg-sidebar text-sidebar-foreground max-md:w-14",
        compactSearchOpen &&
          "max-md:absolute max-md:inset-y-0 max-md:start-0 max-md:z-10 max-md:w-full",
      )}
    >
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup>
          <div className="flex flex-col gap-2">
            <div
              className={cn(
                "flex h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                !compactSearchOpen && "max-md:hidden",
              )}
            >
              <SearchIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />
              {/* Native search inputs clear on Escape even during IME composition. */}
              <SidebarInput
                ref={searchInputRef}
                nativeInput
                type="text"
                value={query}
                onChange={(event) => {
                  const nextQuery = event.currentTarget.value;
                  setQuery(nextQuery);
                  setActiveResultIndex(0);
                  if (nextQuery.trim().length > 0) {
                    updateHoverTarget(null);
                  }
                }}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => setCompactSearchOpen(true)}
                onBlur={() => {
                  if (!isSearching) setCompactSearchOpen(false);
                }}
                placeholder={gt("Search")}
                aria-label={gt("Search settings")}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={isSearching && hasResults}
                aria-controls={isSearching && hasResults ? "settings-search-results" : undefined}
                aria-activedescendant={
                  isSearching && results[activeResultIndex]
                    ? `settings-search-result-${results[activeResultIndex].id}`
                    : undefined
                }
                className="min-w-0 flex-1"
              />
              {isSearching ? (
                <Button
                  type="button"
                  size="icon-micro"
                  variant="ghost-muted"
                  className="shrink-0"
                  aria-label={gt("Clear settings search")}
                  onClick={() => {
                    clearSearch();
                    searchInputRef.current?.focus();
                  }}
                >
                  <XIcon className="size-3" />
                </Button>
              ) : (
                <Kbd>/</Kbd>
              )}
            </div>
            {isSearching && results.length === 0 ? (
              <p
                role="status"
                className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground"
              >
                <T>No settings found</T>
              </p>
            ) : null}
            {isSearching ? (
              <SidebarMenu
                id={hasResults ? "settings-search-results" : undefined}
                role={hasResults ? "listbox" : undefined}
                aria-label={hasResults ? gt("Settings search results") : undefined}
              >
                {results.map((item, index) => (
                  <SidebarMenuItem
                    key={item.id}
                    role="presentation"
                    ref={index === activeResultIndex ? scrollResultIntoView : undefined}
                  >
                    <SidebarMenuButton
                      id={`settings-search-result-${item.id}`}
                      role="option"
                      aria-selected={index === activeResultIndex}
                      tabIndex={-1}
                      size="sm"
                      isActive={index === activeResultIndex}
                      className="h-auto min-h-10 items-start"
                      onMouseMove={() => setActiveResultIndex(index)}
                      onClick={() => handleSearchResultClick(item)}
                    >
                      <SettingsSectionIcon to={item.to} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-sidebar-foreground">
                          {m(item.title)}
                        </span>
                        <span className="block truncate text-2xs text-sidebar-muted-foreground">
                          {m(SETTINGS_SECTION_LABELS[item.to])}
                        </span>
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            ) : (
              <div className="flex flex-col gap-3">
                {compactSearchOpen ? null : (
                  <SidebarMenu className="md:hidden">
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        aria-label={gt("Search settings")}
                        onClick={() => setCompactSearchOpen(true)}
                      >
                        <SearchIcon />
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                )}
                <div
                  ref={groupsContainerRef}
                  onKeyDown={handleSettingsSectionKeyDown}
                  onPointerLeave={() => updateHoverTarget(null)}
                  onBlur={(event) => {
                    const nextFocus = event.relatedTarget;
                    if (
                      !(nextFocus instanceof Node) ||
                      !event.currentTarget.contains(nextFocus)
                    ) {
                      updateHoverTarget(null);
                    }
                  }}
                  className={cn(
                    "flex flex-col pt-1",
                    compactSearchOpen ? "gap-6" : "gap-6 max-md:gap-4",
                  )}
                >
                  {navGroups.map((group, index) => {
                    const groupActiveState = activeIndicator.groupStates[group.id];
                    const groupHoverState = hoverIndicator.groupStates[group.id];
                    const activeGeom = groupActiveState?.path
                      ? itemGeometries[groupActiveState.path]
                      : undefined;
                    const hoverGeom = groupHoverState?.path
                      ? itemGeometries[groupHoverState.path]
                      : undefined;
                    const activePillStyle = buildIndicatorPillStyle({
                      state: groupActiveState,
                      geometry: activeGeom,
                      kind: "active",
                      reducedMotion: prefersReducedMotion,
                      disableMotion: suppressMotionForLayout,
                    });
                    const hoverPillStyle = buildIndicatorPillStyle({
                      state: groupHoverState,
                      geometry: hoverGeom,
                      kind: "hover",
                      reducedMotion: prefersReducedMotion,
                      disableMotion: suppressMotionForLayout,
                    });

                    return (
                      <div
                        key={group.id}
                        data-settings-nav-group={group.id}
                        className="flex flex-col"
                      >
                        <h3
                          id={`settings-nav-group-${index}`}
                          data-settings-nav-heading={group.id}
                          className={cn(
                            "mb-1.5 px-2.5 text-sm font-semibold leading-5 tracking-normal text-sidebar-foreground/95",
                            !compactSearchOpen && "max-md:sr-only",
                          )}
                        >
                          {m(group.heading)}
                        </h3>
                        {/* The heading stays outside the group it names so NVDA does not read the name twice. */}
                        <div role="group" aria-labelledby={`settings-nav-group-${index}`}>
                          <SidebarMenu
                            ref={(node) => {
                              if (node) {
                                menuRefs.current.set(group.id, node);
                              } else {
                                menuRefs.current.delete(group.id);
                              }
                            }}
                            className="relative isolate gap-0.5"
                          >
                            {/* Layer 0: Intra-group sliding / cross-group crossfading Hover Pill */}
                            <span
                              aria-hidden="true"
                              data-settings-nav-pill="hover"
                              data-pill-group={group.id}
                              data-pill-mode={groupHoverState?.mode ?? "idle"}
                              data-pill-visible={
                                groupHoverState?.visible && hoverGeom && hoverGeom.height > 0
                                  ? "true"
                                  : "false"
                              }
                              style={hoverPillStyle}
                              className="pointer-events-none absolute inset-x-0 top-0 z-0 rounded-lg bg-sidebar-row-hover ring-1 ring-inset ring-sidebar-foreground/6 motion-reduce:transition-none"
                            />
                            {/* Layer 1: Intra-group sliding / cross-group crossfading Active Pill */}
                            <span
                              aria-hidden="true"
                              data-settings-nav-pill="active"
                              data-pill-group={group.id}
                              data-pill-mode={groupActiveState?.mode ?? "idle"}
                              data-pill-visible={
                                groupActiveState?.visible && activeGeom && activeGeom.height > 0
                                  ? "true"
                                  : "false"
                              }
                              style={activePillStyle}
                              className="pointer-events-none absolute inset-x-0 top-0 z-[1] rounded-lg bg-sidebar-row-selected shadow-xs ring-1 ring-inset ring-sidebar-border/80 motion-reduce:transition-none"
                            >
                              <span
                                aria-hidden="true"
                                className="absolute inset-y-1.5 start-0.5 w-0.5 rounded-full bg-primary"
                              />
                            </span>
                            {group.paths.map((to) => {
                              const Icon = SETTINGS_SECTION_ICONS[to];
                              const isActive = activePath === to || activePath.startsWith(`${to}/`);
                              const label = m(SETTINGS_NAV_LABELS[to]);
                              const navButton = (
                                <button
                                  type="button"
                                  data-sidebar="menu-button"
                                  data-slot="sidebar-menu-button"
                                  data-active={isActive}
                                  data-settings-section={to}
                                  data-settings-group={group.id}
                                  aria-current={isActive ? "page" : undefined}
                                  className={cn(
                                    "peer/menu-button flex h-7 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2.5 py-1 text-left text-[12.5px] leading-4 font-normal text-sidebar-muted-foreground outline-hidden ring-ring transition-colors duration-150 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset active:translate-y-px active:text-sidebar-foreground data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground motion-reduce:transition-none motion-reduce:active:translate-y-0 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-(--sidebar-icon-color) hover:[&>svg]:text-sidebar-foreground active:[&>svg]:text-sidebar-foreground data-[active=true]:[&>svg]:text-sidebar-foreground",
                                    !hasMeasuredGeometry &&
                                      "hover:bg-sidebar-row-hover active:bg-sidebar-row-active data-[active=true]:bg-sidebar-row-selected",
                                  )}
                                  onPointerEnter={(event) => {
                                    if (event.pointerType === "touch") return;
                                    updateHoverTarget({ groupId: group.id, path: to });
                                  }}
                                  onFocus={(event) => {
                                    if (event.currentTarget.matches(":focus-visible")) {
                                      updateHoverTarget({ groupId: group.id, path: to });
                                    }
                                  }}
                                  onClick={() => handleSectionClick(to)}
                                >
                                  <Icon />
                                  <span
                                    className={cn(
                                      "truncate",
                                      !compactSearchOpen && "max-md:sr-only",
                                    )}
                                  >
                                    {label}
                                  </span>
                                </button>
                              );
                              return (
                                <SidebarMenuItem
                                  key={to}
                                  ref={(node) => {
                                    if (node) {
                                      itemRefs.current.set(to, node);
                                    } else {
                                      itemRefs.current.delete(to);
                                    }
                                  }}
                                  className="z-[2]"
                                >
                                  {isCompactRail && !compactSearchOpen ? (
                                    <Tooltip>
                                      <TooltipTrigger render={navButton} />
                                      <TooltipPopup side="right">{label}</TooltipPopup>
                                    </Tooltip>
                                  ) : (
                                    navButton
                                  )}
                                </SidebarMenuItem>
                              );
                            })}
                          </SidebarMenu>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </SidebarGroup>
      </SidebarContent>
      {cloudEnabled ? (
        <SidebarFooter className="max-md:hidden">
          <Suspense fallback={null}>
            <T3ConnectSidebarSignIn />
          </Suspense>
          <Suspense fallback={null}>
            <T3ConnectSidebarAvatar />
          </Suspense>
        </SidebarFooter>
      ) : null}
    </nav>
  );
}
