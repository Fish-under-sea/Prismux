import { CheckCheckIcon, SlidersHorizontalIcon, Trash2Icon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../../ui/menu";
import { SidebarMenuButton } from "../../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import {
  countActiveOrcaFilters,
  ORCA_ACTIVITY_GROUP_BY_VALUES,
  type OrcaActivityGroupBy,
  type OrcaProjectsPrefs,
} from "./orcaProjects.logic";
import { useOrcaProjectsCopy } from "./orcaProjectsCopy";

export interface OrcaFilterViewMenuProps {
  readonly prefs: OrcaProjectsPrefs;
  readonly onUpdatePrefs: (patch: Partial<OrcaProjectsPrefs>) => void;
  readonly unreadCount: number;
  readonly completedCount: number;
  readonly onMarkAllRead: () => void;
  readonly onClearCompleted: () => void;
}

/**
 * 1:1 Orca Filter & View dropdown menu (`🎛`, Figure 6), modeled after
 * `stablyai/orca` `activity-thread-options-menu.tsx` & `activity-scope-filter-controls.tsx`,
 * rendered on liquid glass (`data-pmx-glass-zone="overlays"`) with Base UI predictive aim-cone submenus.
 */
export const OrcaFilterViewMenu = memo(function OrcaFilterViewMenu({
  prefs,
  onUpdatePrefs,
  unreadCount,
  completedCount,
  onMarkAllRead,
  onClearCompleted,
}: OrcaFilterViewMenuProps) {
  const copy = useOrcaProjectsCopy();
  const activeFilterCount = countActiveOrcaFilters(prefs);
  const triggerLabel =
    activeFilterCount > 0 ? copy.optionsTooltipCount(activeFilterCount) : copy.optionsTooltip;

  return (
    <Menu modal={false}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <SidebarMenuButton
                  size="icon"
                  type="button"
                  data-testid="orca-projects-filter-menu-trigger"
                  aria-label={triggerLabel}
                  className={cn(
                    "relative size-6.5 shrink-0 rounded-md p-0 text-sidebar-muted-foreground hover:text-sidebar-foreground",
                    activeFilterCount > 0 && "text-sidebar-foreground",
                  )}
                />
              }
            />
          }
        >
          <SlidersHorizontalIcon aria-hidden className="size-3.5" strokeWidth={2} />
          {activeFilterCount > 0 ? (
            <span
              aria-hidden
              data-testid="orca-projects-filter-count-badge"
              className="pointer-events-none absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] leading-none font-semibold text-primary-foreground tabular-nums"
            >
              {activeFilterCount > 9 ? "9+" : activeFilterCount}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="bottom" sideOffset={6}>
          {triggerLabel}
        </TooltipPopup>
      </Tooltip>

      <MenuPopup
        align="end"
        side="bottom"
        sideOffset={6}
        data-testid="orca-projects-filter-menu-popup"
        data-pmx-glass-zone="overlays"
        className="w-64"
      >
        <MenuGroup>
          <MenuGroupLabel className="text-[11px] font-semibold tracking-tight text-muted-foreground">
            {copy.filtersSection}
          </MenuGroupLabel>
          <MenuCheckboxItem
            data-testid="orca-filter-unread-only"
            checked={prefs.unreadOnly}
            closeOnClick={false}
            onCheckedChange={(checked) => onUpdatePrefs({ unreadOnly: checked })}
          >
            <span className="truncate">{copy.showUnreadOnly}</span>
          </MenuCheckboxItem>
          <MenuCheckboxItem
            data-testid="orca-filter-show-child-agents"
            checked={prefs.showChildAgents}
            closeOnClick={false}
            onCheckedChange={(checked) => onUpdatePrefs({ showChildAgents: checked })}
          >
            <span className="truncate">{copy.showChildAgents}</span>
          </MenuCheckboxItem>
          <MenuCheckboxItem
            data-testid="orca-filter-hide-automation"
            checked={prefs.hideAutomationCreated}
            closeOnClick={false}
            onCheckedChange={(checked) => onUpdatePrefs({ hideAutomationCreated: checked })}
          >
            <span className="truncate">{copy.hideAutomationCreated}</span>
          </MenuCheckboxItem>
          <MenuCheckboxItem
            data-testid="orca-filter-hide-cli"
            checked={prefs.hideCliCreated}
            closeOnClick={false}
            onCheckedChange={(checked) => onUpdatePrefs({ hideCliCreated: checked })}
          >
            <span className="truncate">{copy.hideCliCreated}</span>
          </MenuCheckboxItem>
        </MenuGroup>

        <MenuSeparator />

        <MenuGroup>
          <MenuGroupLabel className="text-[11px] font-semibold tracking-tight text-muted-foreground">
            {copy.viewSection}
          </MenuGroupLabel>

          <MenuSub>
            <MenuSubTrigger data-testid="orca-view-groupby-trigger">
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="truncate">{copy.groupAgentActivityBy}</span>
                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                  {copy.groupByLabels[prefs.groupBy]}
                </span>
              </span>
            </MenuSubTrigger>
            <MenuSubPopup
              data-testid="orca-view-groupby-submenu"
              data-pmx-glass-zone="overlays"
              className="w-40"
            >
              <MenuRadioGroup
                value={prefs.groupBy}
                onValueChange={(value) => {
                  if (
                    value === "status" ||
                    value === "project" ||
                    value === "recent"
                  ) {
                    onUpdatePrefs({ groupBy: value satisfies OrcaActivityGroupBy });
                  }
                }}
              >
                {ORCA_ACTIVITY_GROUP_BY_VALUES.map((option) => (
                  <MenuRadioItem
                    key={option}
                    value={option}
                    closeOnClick={false}
                    data-testid={`orca-view-groupby-${option}`}
                    className="gap-2"
                  >
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate">{copy.groupByLabels[option]}</span>
                      <MenuRadioItemIndicator />
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuSubPopup>
          </MenuSub>

          <MenuCheckboxItem
            data-testid="orca-view-compact-mode"
            checked={prefs.compactMode}
            closeOnClick={false}
            onCheckedChange={(checked) => onUpdatePrefs({ compactMode: checked })}
          >
            <span className="truncate">{copy.compactMode}</span>
          </MenuCheckboxItem>
          <MenuCheckboxItem
            data-testid="orca-view-show-search"
            checked={prefs.showSearch}
            closeOnClick={false}
            onCheckedChange={(checked) => onUpdatePrefs({ showSearch: checked })}
          >
            <span className="truncate">{copy.showSearch}</span>
          </MenuCheckboxItem>
        </MenuGroup>

        <MenuSeparator />

        <MenuItem
          data-testid="orca-action-mark-all-read"
          disabled={unreadCount === 0}
          onClick={onMarkAllRead}
        >
          <CheckCheckIcon aria-hidden className="size-3.5 text-muted-foreground" />
          <span className="truncate">{copy.markAllRead}</span>
        </MenuItem>
        <MenuItem
          data-testid="orca-action-clear-completed"
          disabled={completedCount === 0}
          onClick={onClearCompleted}
        >
          <Trash2Icon aria-hidden className="size-3.5 text-muted-foreground" />
          <span className="truncate">{copy.clearCompleted}</span>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
});
