import { T, useGT } from "gt-react";
import {
  BellIcon,
  ChevronDownIcon,
  FolderMinusIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FolderTreeIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  XIcon,
} from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { SidebarInput, SidebarMenuButton, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { resolveInboxRailDotTone } from "./sidebarIconRailMotion";

export interface SidebarThreadHeaderProps {
  hasProjects: boolean;
  projectsOpen: boolean;
  onToggleProjectsOpen: () => void;
  attentionCount: number;
  approvalCount: number;
  attentionFilterActive: boolean;
  onToggleAttentionFilter: () => void;
  projectScope: ReactNode;
  folderGroupingEnabled: boolean;
  hasExpandedFolders: boolean;
  hasFolders: boolean;
  onToggleFolderGrouping: () => void;
  onCollapseOrExpandAllFolders: () => void;
  onManageProjects: () => void;
  onNewProject: () => void;
  onNewThread: (event: ReactMouseEvent) => void;
  newThreadDisabled: boolean;
  newThreadShortcutLabel: string | null | undefined;
  newThreadInProjectShortcutLabel: string | null | undefined;
  showNewThreadInProjectHint: boolean;
  inlineSearchVisible: boolean;
  onToggleInlineSearch: () => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  isSearching: boolean;
  searchResultCount: number;
  activeSearchResultIndex: number;
  onClearSearch: () => void;
}

/**
 * Orca-aligned `⌄ Projects` collapsible section header & compact action bar
 * (modeled after `stablyai/orca` `SidebarSectionHeader.tsx` + `sidebar-header-actions.tsx`),
 * preserving exact `h-8` group placeholder height and 6px dot badges in Spec 2 icon-rail mode.
 */
export function SidebarThreadHeader({
  hasProjects,
  projectsOpen,
  onToggleProjectsOpen,
  attentionCount,
  approvalCount,
  attentionFilterActive,
  onToggleAttentionFilter,
  projectScope,
  folderGroupingEnabled,
  hasExpandedFolders,
  hasFolders,
  onToggleFolderGrouping,
  onCollapseOrExpandAllFolders,
  onManageProjects,
  onNewProject,
  onNewThread,
  newThreadDisabled,
  newThreadShortcutLabel,
  newThreadInProjectShortcutLabel,
  showNewThreadInProjectHint,
  inlineSearchVisible,
  onToggleInlineSearch,
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchKeyDown,
  isSearching,
  searchResultCount,
  activeSearchResultIndex,
  onClearSearch,
}: SidebarThreadHeaderProps) {
  const gt = useGT();
  const { isMobile, isIconRail, isTextHidden } = useSidebar();
  const resultsVisible = isSearching && searchResultCount > 0;
  // Shrinking results can remove the active option; never leave aria-activedescendant pointing at it.
  const activeResultExists = resultsVisible && activeSearchResultIndex < searchResultCount;
  const newThreadLabel = newThreadShortcutLabel
    ? gt("New thread ({shortcut})", { shortcut: newThreadShortcutLabel })
    : gt("New thread");

  const bellLabel =
    approvalCount > 0
      ? gt(
          "{count, plural, one {{count} thread awaiting approval} other {{count} threads awaiting approval}}",
          { count: approvalCount },
        )
      : attentionCount > 0
        ? gt(
            "{count, plural, one {{count} unread thread} other {{count} unread threads}}",
            { count: attentionCount },
          )
        : gt("Notifications & pending approvals");

  const inboxDotTone = resolveInboxRailDotTone({ approvalCount, attentionCount });
  const labelFadeClass = cn(
    "transition-opacity duration-[90ms] ease-out motion-reduce:transition-none",
    isTextHidden ? "pointer-events-none opacity-0" : "opacity-100",
  );

  // Spec 2 Icon Rail: hide Projects group title text while strictly retaining the h-8
  // divider slot height so layout never jumps, and render centered icon controls with 6px dots.
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
                aria-label={bellLabel}
                aria-pressed={attentionFilterActive}
                onClick={onToggleAttentionFilter}
                className={cn(
                  "relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  attentionFilterActive &&
                    "bg-sidebar-row-active text-sidebar-foreground ring-1 ring-inset ring-sidebar-border/70",
                )}
              />
            }
          >
            <BellIcon aria-hidden className="size-4 text-(--sidebar-icon-color)" />
            {inboxDotTone ? (
              <span
                aria-hidden
                data-testid="prismux-sidebar-inbox-dot"
                data-rail-dot="true"
                className={cn(
                  "pointer-events-none absolute top-1.5 right-1.5 size-1.5 rounded-full ring-2 ring-sidebar",
                  inboxDotTone === "amber" ? "bg-amber-500" : "bg-primary",
                )}
              />
            ) : null}
          </TooltipTrigger>
          <TooltipPopup side="right" sideOffset={8}>
            {bellLabel}
          </TooltipPopup>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-testid="prismux-sidebar-new-thread"
                aria-label={gt("New thread")}
                disabled={newThreadDisabled}
                onClick={onNewThread}
                className="relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              />
            }
          >
            <PlusIcon aria-hidden className="size-4 text-(--sidebar-icon-color)" strokeWidth={2.25} />
          </TooltipTrigger>
          <TooltipPopup side="right" sideOffset={8}>
            {newThreadLabel}
          </TooltipPopup>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        data-testid="prismux-sidebar-projects-header"
        className="mt-0.5 flex h-8 min-w-0 shrink-0 items-center justify-between gap-1 border-t border-sidebar-border/45 pt-1"
      >
        <button
          type="button"
          data-testid="prismux-sidebar-projects-toggle"
          aria-expanded={projectsOpen}
          onClick={(event) => {
            onToggleProjectsOpen();
            // Blur pointer clicks so keyboard focus ring does not linger (Orca SidebarSectionHeader).
            if (event.detail > 0) event.currentTarget.blur();
          }}
          className={cn(
            "inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 text-left text-xs font-medium tracking-tight text-sidebar-muted-foreground outline-none transition-colors hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            labelFadeClass,
          )}
        >
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3 shrink-0 text-sidebar-muted-foreground/80 transition-transform duration-150 motion-reduce:transition-none",
              !projectsOpen && "-rotate-90",
            )}
          />
          <span className="truncate whitespace-nowrap">
            <T context="sidebar projects section header">Projects</T>
          </span>
        </button>

        <div
          className={cn("flex shrink-0 items-center gap-0.5", labelFadeClass)}
          data-sidebar-header-actions=""
        >
          {/* 1. Notification / Pending Approval Inbox Bell */}
          <SidebarHeaderIconButton
            data-testid="prismux-sidebar-inbox-bell"
            label={bellLabel}
            aria-pressed={attentionFilterActive}
            className={cn(
              attentionFilterActive &&
                "bg-sidebar-row-active text-sidebar-foreground ring-1 ring-inset ring-sidebar-border/70",
            )}
            onClick={onToggleAttentionFilter}
          >
            <BellIcon className="size-3.5" />
            {attentionCount > 0 ? (
              <span
                data-testid="prismux-sidebar-inbox-badge"
                className={cn(
                  "pointer-events-none absolute -top-0.5 -right-0.5 inline-flex min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] leading-tight font-semibold tabular-nums",
                  approvalCount > 0
                    ? "bg-amber-500 text-white"
                    : "bg-primary text-primary-foreground",
                )}
              >
                {attentionCount > 99 ? "99+" : attentionCount}
              </span>
            ) : null}
          </SidebarHeaderIconButton>

          {/* 2. Project Scope & Filter/Sort Control */}
          {hasProjects ? projectScope : null}

          {/* 3. Workspace Folders Collapse / Group / Manage Menu */}
          <Menu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <MenuTrigger
                    render={
                      <SidebarMenuButton
                        size="icon"
                        type="button"
                        data-testid="prismux-sidebar-folders-menu-trigger"
                        aria-label={gt("Workspace folders & view")}
                        className="relative size-7 shrink-0"
                      />
                    }
                  >
                    <FolderTreeIcon className="size-3.5" />
                  </MenuTrigger>
                }
              />
              <TooltipPopup side="top">
                <T>Workspace folders & view</T>
              </TooltipPopup>
            </Tooltip>
            <MenuPopup align="end" side="bottom" sideOffset={4}>
              {hasFolders ? (
                <MenuItem onClick={onCollapseOrExpandAllFolders}>
                  {hasExpandedFolders ? (
                    <FolderMinusIcon className="size-3.5" />
                  ) : (
                    <FolderOpenIcon className="size-3.5" />
                  )}
                  <span>
                    {hasExpandedFolders ? (
                      <T>Collapse all folders</T>
                    ) : (
                      <T>Expand all folders</T>
                    )}
                  </span>
                </MenuItem>
              ) : null}
              <MenuItem onClick={onToggleFolderGrouping}>
                <FolderTreeIcon className="size-3.5" />
                <span>
                  {folderGroupingEnabled ? (
                    <T>Switch to flat thread list</T>
                  ) : (
                    <T>Group by project folders</T>
                  )}
                </span>
              </MenuItem>
              <MenuItem onClick={onToggleInlineSearch}>
                <SearchIcon className="size-3.5" />
                <span>
                  {inlineSearchVisible ? (
                    <T>Hide quick thread filter</T>
                  ) : (
                    <T>Filter threads by keyword</T>
                  )}
                </span>
              </MenuItem>
              <MenuSeparator />
              <MenuItem onClick={onNewProject}>
                <FolderPlusIcon className="size-3.5" />
                <span>
                  <T>Add project</T>
                </span>
              </MenuItem>
              <MenuItem onClick={onManageProjects}>
                <SettingsIcon className="size-3.5" />
                <span>
                  <T>Manage projects</T>
                </span>
              </MenuItem>
            </MenuPopup>
          </Menu>

          {/* 4. Add Project / New Thread (`+`) — preserves aria-label="New thread" for tests */}
          <SidebarHeaderIconButton
            data-testid="prismux-sidebar-new-thread"
            label={gt("New thread")}
            tooltip={
              showNewThreadInProjectHint ? (
                <span className="flex flex-col gap-0.5">
                  <span>{newThreadLabel}</span>
                  <span className="text-muted-foreground">
                    {newThreadInProjectShortcutLabel
                      ? gt("New thread in current project: Shift+click ({shortcut})", {
                          shortcut: newThreadInProjectShortcutLabel,
                        })
                      : gt("New thread in current project: Shift+click")}
                  </span>
                </span>
              ) : (
                newThreadLabel
              )
            }
            disabled={newThreadDisabled}
            onClick={onNewThread}
          >
            <PlusIcon className="size-3.5" strokeWidth={2.25} />
          </SidebarHeaderIconButton>
        </div>
      </div>

      {/* Optional inline thread filter input when toggled or actively searching */}
      {inlineSearchVisible || isSearching ? (
        <div
          className={cn(
            "flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-sidebar-border/60 bg-sidebar-foreground/[0.04] px-2 text-xs text-sidebar-muted-foreground focus-within:border-ring/60 focus-within:bg-sidebar-row-hover focus-within:text-sidebar-foreground",
            labelFadeClass,
          )}
        >
          <SearchIcon className="size-3.5 shrink-0 text-(--sidebar-icon-color)" />
          <SidebarInput
            ref={searchInputRef}
            nativeInput
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={gt("Filter threads…")}
            aria-label={gt("Search threads")}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={resultsVisible}
            aria-controls={resultsVisible ? "sidebar-thread-search-results" : undefined}
            aria-activedescendant={
              activeResultExists
                ? `sidebar-thread-search-result-${activeSearchResultIndex}`
                : undefined
            }
            className="min-w-0 flex-1 text-xs"
          />
          <Button
            type="button"
            size="icon-micro"
            variant="ghost-muted"
            className="shrink-0"
            aria-label={gt("Clear thread search")}
            onClick={() => {
              onClearSearch();
              if (!isSearching) onToggleInlineSearch();
            }}
          >
            <XIcon className="size-3" />
          </Button>
        </div>
      ) : null}

      {/* Active attention filter indicator pill */}
      {attentionFilterActive ? (
        <div
          data-testid="prismux-sidebar-attention-banner"
          className={cn(
            "flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-200",
            labelFadeClass,
          )}
        >
          <span className="min-w-0 truncate font-medium">
            {attentionCount > 0 ? (
              gt(
                "{count, plural, one {{count} thread needing attention} other {{count} threads needing attention}}",
                { count: attentionCount },
              )
            ) : (
              <T>No threads need attention</T>
            )}
          </span>
          <button
            type="button"
            onClick={onToggleAttentionFilter}
            className="shrink-0 cursor-pointer rounded-sm px-1 text-[11px] font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <T>Show all</T>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function SidebarHeaderIconButton({
  label,
  tooltip = label,
  className,
  children,
  ...rest
}: {
  label: string;
  tooltip?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
} & Omit<
  ComponentProps<typeof SidebarMenuButton>,
  "children" | "className" | "tooltip" | "isActive" | "aria-label"
>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="icon"
            type="button"
            aria-label={label}
            {...rest}
            className={cn("relative size-7 shrink-0", className)}
          />
        }
      >
        {children}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
