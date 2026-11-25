import {
  ArrowRightLeftIcon,
  Columns2Icon,
  FilesIcon,
  GitCompareArrowsIcon,
  GlobeIcon,
  Link2Icon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
  Rows2Icon,
  SmartphoneIcon,
  TabletSmartphoneIcon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import { memo, useState, type DragEvent as ReactDragEvent, type ReactNode, type Ref } from "react";

import { isElectron } from "../../env";
import { cn } from "~/lib/utils";
import { AgentBrandLogo } from "../../prismux/agentBrand";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  dispatchSplitDragEvent,
  hasSplitDragMime,
  readSplitDragDataTransfer,
  WORKSPACE_TAB_DRAG_MIME,
  writeSplitDragDataTransfer,
  type SplitDragPayload,
  type SplitDropZone,
} from "./splitAnything.logic";
import {
  WorkspaceNewTabPopover,
  type WorkspaceNewTabPopoverProps,
} from "./WorkspaceNewTabPopover";
import {
  useWorkspaceTabsStore,
  WORKSPACE_MAX_SPLIT_PANES,
  type SplitDirection,
  type WorkspacePane,
  type WorkspaceTab,
} from "./workspaceTabsStore";

export { WORKSPACE_TAB_DRAG_MIME };

export interface WorkspaceTabBarProps {
  readonly pane: WorkspacePane;
  readonly tabs: ReadonlyArray<WorkspaceTab>;
  readonly isFocused: boolean;
  readonly paneCount: number;
  readonly otherPaneIds: ReadonlyArray<string>;
  readonly touchesTopEdge: boolean;
  readonly touchesLeftEdge: boolean;
  readonly touchesRightEdge: boolean;
  readonly tabBarRef?: Ref<HTMLDivElement> | undefined;
  readonly topbarRightSlotRef?: Ref<HTMLDivElement> | undefined;
  readonly fallbackRightControls?: ReactNode | undefined;
  readonly showSplitControls?: boolean | undefined;
  readonly newTabPopover: Omit<WorkspaceNewTabPopoverProps, "paneId" | "canSplit">;
  readonly onActivateTab: (paneId: string, tabId: string) => void;
  readonly onCloseTab: (paneId: string, tabId: string) => void;
  readonly onSplitPane: (paneId: string, direction: SplitDirection) => void;
  readonly onResetSplitRatio?: (() => void) | undefined;
  readonly onClosePane: (paneId: string) => void;
  readonly onMoveTabToPane: (
    tabId: string,
    fromPaneId: string,
    toPaneId: string,
    insertIndex?: number,
  ) => void;
  readonly onReorderTab: (paneId: string, tabId: string, targetIndex: number) => void;
  readonly onDropItemIntoPane?:
    | ((payload: SplitDragPayload, targetPaneId: string, zone: SplitDropZone) => void)
    | undefined;
}

function renderTabLeadingIcon(tab: WorkspaceTab): ReactNode {
  switch (tab.kind) {
    case "terminal":
      return <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    case "diff":
      return <GitCompareArrowsIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    case "browser":
      return <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    case "simulator":
      return <SmartphoneIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    case "files":
      return <FilesIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    case "related":
      return <Link2Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    case "device":
      return <TabletSmartphoneIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    case "side-chat":
      return <MessageSquarePlusIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    case "thread":
    case "draft":
    case "agent":
      return tab.providerId ? (
        <AgentBrandLogo provider={tab.providerId} size={13} className="shrink-0" />
      ) : (
        <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      );
  }
}

export const WorkspaceTabBar = memo(function WorkspaceTabBar(props: WorkspaceTabBarProps) {
  const {
    pane,
    tabs,
    isFocused,
    paneCount,
    otherPaneIds,
    touchesTopEdge,
    touchesLeftEdge,
    touchesRightEdge,
    tabBarRef,
    topbarRightSlotRef,
    fallbackRightControls,
    showSplitControls = true,
    newTabPopover,
    onActivateTab,
    onCloseTab,
    onSplitPane,
    onResetSplitRatio,
    onClosePane,
    onMoveTabToPane,
    onReorderTab,
    onDropItemIntoPane,
  } = props;

  const [dropActive, setDropActive] = useState(false);
  const canSplit = paneCount < WORKSPACE_MAX_SPLIT_PANES;
  const isSplit = paneCount > 1;
  const firstOtherPaneId = otherPaneIds[0] ?? null;

  const resolveDroppedPayload = (event: ReactDragEvent): SplitDragPayload | null => {
    return (
      readSplitDragDataTransfer(event.dataTransfer) ??
      useWorkspaceTabsStore.getState().activeDrag
    );
  };

  const canAcceptDrag = (event: ReactDragEvent): boolean =>
    hasSplitDragMime(event.dataTransfer.types) ||
    useWorkspaceTabsStore.getState().activeDrag !== null;

  const handleStripDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!canAcceptDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!dropActive) setDropActive(true);
  };

  const handleStripDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    setDropActive(false);
    const payload = resolveDroppedPayload(event);
    if (!payload) return;
    event.preventDefault();
    event.stopPropagation();
    useWorkspaceTabsStore.getState().setActiveDrag(null);
    dispatchSplitDragEvent(false, null);
    if (payload.kind === "pane-tab") {
      if (payload.fromPaneId !== pane.id) {
        onMoveTabToPane(payload.tabId, payload.fromPaneId, pane.id);
      }
      return;
    }
    if (onDropItemIntoPane) {
      onDropItemIntoPane(payload, pane.id, "center");
    } else {
      useWorkspaceTabsStore.getState().dropItemIntoPane(payload, pane.id, "center");
    }
  };

  return (
    <div
      ref={tabBarRef}
      data-workspace-tabbar={pane.id}
      data-focused-pane={isFocused ? "true" : "false"}
      data-pmx-glass-zone="shellFrame"
      onDragOver={handleStripDragOver}
      onDragLeave={() => setDropActive(false)}
      onDrop={handleStripDrop}
      className={cn(
        "relative flex shrink-0 select-none items-center gap-1 bg-sidebar px-2 text-xs transition-colors",
        "[[data-pmx-glass='1']_&]:bg-transparent",
        isSplit && "rounded-none",
        touchesTopEdge
          ? cn(
              "h-[max(38px,env(titlebar-area-height,38px))] min-h-[38px]",
              isElectron && "drag-region",
              touchesLeftEdge && "max-md:pl-[var(--workspace-titlebar-content-left)]",
              isElectron && touchesRightEdge && "wco:pr-(--workspace-native-controls-inset)",
            )
          : cn(
              "h-8 min-h-8 border-b border-border/55",
              isSplit && touchesLeftEdge && "border-l border-l-border/60",
              isSplit && touchesRightEdge && "border-r border-r-border/60",
            ),
        dropActive && "ring-1 ring-inset ring-primary/55 bg-primary/8",
      )}
    >
      {/* Left + Center: Scrollable Tab Strip + Orca `+` Quick Launcher */}
      <div
        role="tablist"
        aria-label="工作区标签页"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden py-0 scrollbar-none"
      >
        {tabs.map((tab, index) => {
          const isActive = pane.activeTabId === tab.id;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              data-workspace-tab={tab.id}
              data-workspace-tab-kind={tab.kind}
              data-active={isActive ? "true" : "false"}
              draggable
              onDragStart={(event) => {
                const payload: SplitDragPayload = {
                  kind: "pane-tab",
                  tabId: tab.id,
                  fromPaneId: pane.id,
                };
                writeSplitDragDataTransfer(event.dataTransfer, payload);
                useWorkspaceTabsStore.getState().setActiveDrag(payload);
                dispatchSplitDragEvent(true, payload);
              }}
              onDragEnd={() => {
                setDropActive(false);
                useWorkspaceTabsStore.getState().setActiveDrag(null);
                dispatchSplitDragEvent(false, null);
              }}
              onDragOver={(event) => {
                if (!canAcceptDrag(event)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                const payload = resolveDroppedPayload(event);
                if (!payload) return;
                event.preventDefault();
                event.stopPropagation();
                setDropActive(false);
                useWorkspaceTabsStore.getState().setActiveDrag(null);
                dispatchSplitDragEvent(false, null);
                if (payload.kind === "pane-tab") {
                  if (payload.fromPaneId === pane.id) {
                    onReorderTab(pane.id, payload.tabId, index);
                  } else {
                    onMoveTabToPane(payload.tabId, payload.fromPaneId, pane.id, index);
                  }
                  return;
                }
                if (onDropItemIntoPane) {
                  onDropItemIntoPane(payload, pane.id, "center");
                } else {
                  useWorkspaceTabsStore.getState().dropItemIntoPane(payload, pane.id, "center");
                }
              }}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  event.stopPropagation();
                  onCloseTab(pane.id, tab.id);
                }
              }}
              onMouseDown={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                }
              }}
              className={cn(
                "group relative flex h-7 max-w-[196px] min-w-[76px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 transition-colors [-webkit-app-region:no-drag]",
                isActive
                  ? isFocused
                    ? "border-border/85 bg-background/90 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-background/75"
                    : "border-border/60 bg-background/60 text-foreground/90"
                  : "border-transparent bg-transparent text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground dark:hover:bg-white/[0.07]",
              )}
              onClick={() => onActivateTab(pane.id, tab.id)}
              title={tab.title}
            >
              {/* Orca focused pane active-tab accent line */}
              {isActive && isFocused ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-primary/85"
                />
              ) : null}

              {renderTabLeadingIcon(tab)}
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-none">
                {tab.title}
              </span>

              {isSplit && firstOtherPaneId ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`将「${tab.title}」移至另一分屏`}
                        data-workspace-tab-move={tab.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          onMoveTabToPane(tab.id, pane.id, firstOtherPaneId);
                        }}
                        className="hidden size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/75 outline-none transition-colors hover:bg-foreground/10 hover:text-foreground group-hover:inline-flex focus-visible:inline-flex focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <ArrowRightLeftIcon className="size-2.5" aria-hidden />
                      </button>
                    }
                  />
                  <TooltipPopup side="bottom">移至另一分屏</TooltipPopup>
                </Tooltip>
              ) : null}

              <button
                type="button"
                aria-label={`关闭标签页 ${tab.title}`}
                data-workspace-tab-close={tab.id}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(pane.id, tab.id);
                }}
                className={cn(
                  "flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/75 outline-none transition-opacity hover:bg-foreground/12 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring",
                  isActive ? "opacity-75 hover:opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
              >
                <XIcon className="size-3" aria-hidden />
              </button>
            </div>
          );
        })}

        {/* `+` Omnibox Quick Launcher */}
        <WorkspaceNewTabPopover
          {...newTabPopover}
          paneId={pane.id}
          canSplit={canSplit}
        />
      </div>

      {/* Right: Unified Topbar Controls (Chief Pill + Overview + Right Panel) + Pane Menu */}
      <div
        data-workspace-split-controls={pane.id}
        className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
      >
        {touchesTopEdge && touchesRightEdge ? (
          <>
            <div
              ref={topbarRightSlotRef}
              data-workspace-topbar-right-slot="1"
              className="flex shrink-0 items-center gap-1 empty:hidden"
            />
            {fallbackRightControls}
          </>
        ) : null}

        {showSplitControls ? (
          <Menu>
            <MenuTrigger
              render={
                <button
                  type="button"
                  data-workspace-pane-menu={pane.id}
                  aria-label="更多窗格操作"
                  className="flex size-6.5 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <MoreHorizontalIcon className="size-3.5" aria-hidden />
                </button>
              }
            />
            <MenuPopup align="end" side="bottom" sideOffset={4}>
              <MenuItem
                data-workspace-menu-split-horizontal={pane.id}
                disabled={!canSplit}
                onClick={() => onSplitPane(pane.id, "horizontal")}
              >
                <Columns2Icon className="size-3.5" aria-hidden />
                <span>左右分屏</span>
              </MenuItem>
              <MenuItem
                data-workspace-menu-split-vertical={pane.id}
                disabled={!canSplit}
                onClick={() => onSplitPane(pane.id, "vertical")}
              >
                <Rows2Icon className="size-3.5" aria-hidden />
                <span>上下分屏</span>
              </MenuItem>
              {isSplit ? (
                <>
                  <MenuSeparator />
                  {onResetSplitRatio ? (
                    <MenuItem
                      data-workspace-menu-reset-split-ratio={pane.id}
                      onClick={onResetSplitRatio}
                    >
                      <RotateCcwIcon className="size-3.5" aria-hidden />
                      <span>重置分屏比例</span>
                    </MenuItem>
                  ) : null}
                  <MenuItem
                    data-workspace-menu-close-pane={pane.id}
                    onClick={() => onClosePane(pane.id)}
                  >
                    <XIcon className="size-3.5" aria-hidden />
                    <span>关闭当前分屏</span>
                  </MenuItem>
                </>
              ) : null}
            </MenuPopup>
          </Menu>
        ) : null}

        {isSplit ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  data-workspace-close-pane={pane.id}
                  aria-label="关闭当前分屏"
                  onClick={() => onClosePane(pane.id)}
                  className="flex size-6.5 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <XIcon className="size-3.5" aria-hidden />
                </button>
              }
            />
            <TooltipPopup side="bottom">关闭当前分屏</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
});
