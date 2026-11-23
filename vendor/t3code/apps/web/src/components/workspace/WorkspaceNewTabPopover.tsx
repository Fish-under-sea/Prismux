import {
  ChevronRightIcon,
  Columns2Icon,
  GitCompareArrowsIcon,
  GlobeIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SmartphoneIcon,
  TerminalIcon,
} from "lucide-react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "~/lib/utils";
import { AgentBrandLogo, formatAgentBrandName } from "../../prismux/agentBrand";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { useSubmenuAimCone } from "../ui/submenuAimCone";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  filterQuickLaunchResults,
  QUICK_LAUNCH_TOOLS,
  type QuickLaunchAgentOption,
  type QuickLaunchHistoryThread,
  type QuickLaunchOpenTabMatch,
  type QuickLaunchToolId,
} from "./workspaceQuickLaunch.logic";
import type { WorkspaceTab } from "./workspaceTabsStore";

export interface WorkspaceNewTabPopoverProps {
  readonly paneId: string;
  readonly openTabs: ReadonlyArray<QuickLaunchOpenTabMatch>;
  readonly historyThreads: ReadonlyArray<QuickLaunchHistoryThread>;
  readonly agents: ReadonlyArray<QuickLaunchAgentOption>;
  readonly canSplit?: boolean;
  readonly onActivateOpenTab: (paneId: string, tabId: string) => void;
  readonly onOpenHistoryThread: (thread: QuickLaunchHistoryThread, targetPaneId: string) => void;
  readonly onLaunchAgent: (agent: QuickLaunchAgentOption, targetPaneId: string) => void;
  readonly onLaunchAgentInSplit?: (agent: QuickLaunchAgentOption, fromPaneId: string) => void;
  readonly onRunQuickTool: (toolId: QuickLaunchToolId, targetPaneId: string) => void;
  readonly onOpenUrl: (url: string, targetPaneId: string) => void;
  readonly onOpenAgentSettings: () => void;
  readonly triggerClassName?: string;
}

function quickToolIcon(id: QuickLaunchToolId): ReactNode {
  switch (id) {
    case "terminal":
      return <TerminalIcon className="size-4" aria-hidden />;
    case "diff":
      return <GitCompareArrowsIcon className="size-4" aria-hidden />;
    case "browser":
      return <GlobeIcon className="size-4" aria-hidden />;
    case "simulator":
      return <SmartphoneIcon className="size-4" aria-hidden />;
    case "settings":
      return <SettingsIcon className="size-4" aria-hidden />;
  }
}

function tabKindIcon(tab: WorkspaceTab): ReactNode {
  switch (tab.kind) {
    case "terminal":
      return <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    case "diff":
      return <GitCompareArrowsIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    case "browser":
      return <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    case "simulator":
      return <SmartphoneIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    case "thread":
    case "draft":
    case "agent":
      return tab.providerId ? (
        <AgentBrandLogo provider={tab.providerId} size={14} className="shrink-0" />
      ) : (
        <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      );
  }
}

/**
 * Orca-aligned `+` quick launcher popover:
 * 1. Top omnibox search (open tabs, history threads, agents, tools, and direct URLs)
 * 2. Quick tool icon strip (PowerShell / Diff / Browser / Mobile Simulator | Settings)
 * 3. Dynamic Agent launch rows with Safe Triangle hover submenu (`useSubmenuAimCone`)
 * 4. Fixed bottom footer: `⚙ 代理设置...` -> `/settings/providers`
 */
export const WorkspaceNewTabPopover = memo(function WorkspaceNewTabPopover(
  props: WorkspaceNewTabPopoverProps,
) {
  const {
    paneId,
    openTabs,
    historyThreads,
    agents,
    canSplit = true,
    onActivateOpenTab,
    onOpenHistoryThread,
    onLaunchAgent,
    onLaunchAgentInSplit,
    onRunQuickTool,
    onOpenUrl,
    onOpenAgentSettings,
    triggerClassName,
  } = props;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeSubmenuAgentId, setActiveSubmenuAgentId] = useState<string | null>(null);
  const [submenuCoords, setSubmenuCoords] = useState<{
    readonly top: number;
    readonly left: number;
    readonly side: "left" | "right";
  }>({ top: 0, left: 0, side: "right" });
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const popupBodyRef = useRef<HTMLDivElement | null>(null);
  const submenuPopupRef = useRef<HTMLDivElement | null>(null);
  const triggerRefsByAgentId = useRef(new Map<string, HTMLElement>());
  const aimCone = useSubmenuAimCone();

  const searchResult = useMemo(
    () => filterQuickLaunchResults(query, { openTabs, historyThreads, agents }),
    [agents, historyThreads, openTabs, query],
  );

  const activeSubmenuAgent = useMemo(
    () => agents.find((agent) => agent.id === activeSubmenuAgentId) ?? null,
    [activeSubmenuAgentId, agents],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveSubmenuAgentId(null);
      aimCone.controller.reset();
    }
  }, [aimCone.controller, open]);

  useEffect(() => {
    if (!activeSubmenuAgentId) return;
    const id = activeSubmenuAgentId;
    aimCone.registerActiveSubmenu({
      id,
      getTriggerElement: () => triggerRefsByAgentId.current.get(id) ?? null,
      getPopupElement: () => submenuPopupRef.current,
      close: () => {
        setActiveSubmenuAgentId((current) => (current === id ? null : current));
      },
    });
    return () => {
      aimCone.unregisterActiveSubmenu(id);
    };
  }, [activeSubmenuAgentId, aimCone]);

  const closePopover = () => {
    setOpen(false);
    setActiveSubmenuAgentId(null);
    aimCone.controller.reset();
  };

  const openAgentSubmenu = (agentId: string, rowEl: HTMLElement | null) => {
    if (rowEl && popupBodyRef.current) {
      const containerRect = popupBodyRef.current.getBoundingClientRect();
      const rowRect = rowEl.getBoundingClientRect();
      const submenuWidth = 240;
      const gap = 6;
      const placeLeft = containerRect.right + gap + submenuWidth > window.innerWidth - 12;
      const left = placeLeft
        ? Math.max(8, containerRect.left - gap - submenuWidth)
        : Math.min(window.innerWidth - submenuWidth - 8, containerRect.right + gap);
      const top = Math.max(8, Math.min(window.innerHeight - 240, rowRect.top - 4));
      setSubmenuCoords({ top, left, side: placeLeft ? "left" : "right" });
    }
    setActiveSubmenuAgentId(agentId);
  };

  const handleHoverAgentRow = (
    agentId: string,
    rowEl: HTMLElement,
    pointer: { readonly pointerType: string; readonly clientX: number; readonly clientY: number },
  ) => {
    if (activeSubmenuAgentId === agentId) {
      aimCone.controller.cancelPendingSwitch();
      return;
    }
    if (activeSubmenuAgentId !== null) {
      const deferred = aimCone.shouldDeferSubmenuClose(
        activeSubmenuAgentId,
        pointer,
        () => openAgentSubmenu(agentId, rowEl),
      );
      if (deferred) return;
    }
    openAgentSubmenu(agentId, rowEl);
  };

  const handleSubmitFirstResult = () => {
    if (!searchResult.isSearching) {
      const firstAgent = agents[0];
      if (firstAgent) {
        onLaunchAgent(firstAgent, paneId);
        closePopover();
      }
      return;
    }
    if (searchResult.urlTarget) {
      onOpenUrl(searchResult.urlTarget.normalizedUrl, paneId);
      closePopover();
      return;
    }
    if (searchResult.openTabs[0]) {
      onActivateOpenTab(searchResult.openTabs[0].paneId, searchResult.openTabs[0].tab.id);
      closePopover();
      return;
    }
    if (searchResult.agents[0]) {
      onLaunchAgent(searchResult.agents[0], paneId);
      closePopover();
      return;
    }
    if (searchResult.tools[0]) {
      onRunQuickTool(searchResult.tools[0].id, paneId);
      closePopover();
      return;
    }
    if (searchResult.historyThreads[0]) {
      onOpenHistoryThread(searchResult.historyThreads[0], paneId);
      closePopover();
    }
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePopover();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      handleSubmitFirstResult();
    }
  };

  const primaryQuickTools = QUICK_LAUNCH_TOOLS.filter((tool) => tool.id !== "settings");
  const settingsQuickTool = QUICK_LAUNCH_TOOLS.find((tool) => tool.id === "settings")!;

  const hasSearchHits =
    Boolean(searchResult.urlTarget) ||
    searchResult.openTabs.length > 0 ||
    searchResult.agents.length > 0 ||
    searchResult.tools.length > 0 ||
    searchResult.historyThreads.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  data-workspace-new-tab-trigger={paneId}
                  aria-label="新建标签页"
                  className={cn(
                    "inline-flex size-6.5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent data-popup-open:text-foreground [-webkit-app-region:no-drag]",
                    triggerClassName,
                  )}
                />
              }
            >
              <PlusIcon className="size-3.5" aria-hidden />
            </PopoverTrigger>
          }
        />
        <TooltipPopup side="bottom">新建标签页 / 快速启动</TooltipPopup>
      </Tooltip>

      <PopoverPopup
        align="start"
        side="bottom"
        sideOffset={6}
        padding="none"
        initialFocus={searchInputRef}
        data-workspace-new-tab-popover="true"
        data-pmx-glass-zone="overlays"
        className="w-[min(20.5rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-border/80 bg-clip-padding p-0 shadow-[0_18px_42px_-16px_rgba(0,0,0,0.42)] before:hidden"
      >
        <div
          ref={popupBodyRef}
          className="relative flex flex-col rounded-xl"
          onPointerMoveCapture={(event) => {
            aimCone.handleParentPointerMoveCapture(event);
          }}
        >
          {/* Row 1: Orca Omnibox Search */}
          <div className="flex items-center gap-2 border-b border-border/65 px-2.5 py-2">
            <SearchIcon className="size-3.5 shrink-0 text-muted-foreground/80" aria-hidden />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveSubmenuAgentId(null);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="搜索打开的标签页、历史记录、文件、URL 和代理..."
              aria-label="搜索打开的标签页、历史记录、文件、URL 和代理"
              data-workspace-quick-search="true"
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/75"
            />
          </div>

          {!searchResult.isSearching ? (
            <>
              {/* Row 2: Quick Tool Icon Strip (PowerShell / Diff / Browser / Simulator | Settings) */}
              <div
                data-workspace-quick-tools="true"
                className="flex items-center gap-1 border-b border-border/65 px-2 py-1.5"
                onPointerEnter={() => setActiveSubmenuAgentId(null)}
              >
                <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scrollbar-none">
                  {primaryQuickTools.map((tool) => (
                    <Tooltip key={tool.id}>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            data-workspace-quick-tool={tool.id}
                            aria-label={tool.tooltip}
                            onClick={() => {
                              onRunQuickTool(tool.id, paneId);
                              closePopover();
                            }}
                            className="flex h-7.5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.1]"
                          >
                            {quickToolIcon(tool.id)}
                          </button>
                        }
                      />
                      <TooltipPopup side="bottom" sideOffset={6}>
                        {tool.tooltip}
                      </TooltipPopup>
                    </Tooltip>
                  ))}
                </div>
                <div className="mx-0.5 h-4 w-px shrink-0 bg-border/75" aria-hidden />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        data-workspace-quick-tool="settings"
                        aria-label={settingsQuickTool.tooltip}
                        onClick={() => {
                          onRunQuickTool("settings", paneId);
                          closePopover();
                        }}
                        className="flex h-7.5 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.1]"
                      >
                        {quickToolIcon("settings")}
                      </button>
                    }
                  />
                  <TooltipPopup side="bottom" sideOffset={6}>
                    {settingsQuickTool.tooltip}
                  </TooltipPopup>
                </Tooltip>
              </div>

              {/* Row 3: Agent Launch Menu with Safe Triangle hover submenu */}
              <div
                data-workspace-agent-list="true"
                className="flex max-h-68 flex-col gap-0.5 overflow-y-auto p-1.5"
              >
                {agents.map((agent) => {
                  const submenuOpen = activeSubmenuAgentId === agent.id;
                  return (
                    <div
                      key={agent.id}
                      ref={(node) => {
                        if (node) {
                          triggerRefsByAgentId.current.set(agent.id, node);
                        } else {
                          triggerRefsByAgentId.current.delete(agent.id);
                        }
                      }}
                      data-slot="menu-sub-trigger"
                      data-workspace-agent-row={agent.brandId}
                      onPointerMove={(event) => {
                        handleHoverAgentRow(agent.id, event.currentTarget, {
                          pointerType: event.pointerType,
                          clientX: event.clientX,
                          clientY: event.clientY,
                        });
                      }}
                      className={cn(
                        "group flex w-full items-center gap-1 rounded-lg transition-colors",
                        submenuOpen
                          ? "bg-foreground/[0.08] text-foreground dark:bg-white/[0.1]"
                          : "hover:bg-foreground/[0.07] dark:hover:bg-white/[0.08]",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onLaunchAgent(agent, paneId);
                          closePopover();
                        }}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-l-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <AgentBrandLogo
                          provider={agent.brandId === "custom" ? agent.driverKind : agent.brandId}
                          online={agent.available}
                          size={15}
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                          {agent.displayName}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`展开 ${agent.displayName} 快捷选项`}
                        aria-expanded={submenuOpen}
                        data-workspace-agent-submenu-trigger={agent.brandId}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (submenuOpen) {
                            setActiveSubmenuAgentId(null);
                          } else {
                            openAgentSubmenu(agent.id, event.currentTarget.parentElement);
                          }
                        }}
                        className="mr-0.5 flex size-6.5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/75 outline-none transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronRightIcon className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Row 4: Fixed Agent Settings Footer */}
              <div
                className="border-t border-border/65 p-1.5"
                onPointerEnter={() => setActiveSubmenuAgentId(null)}
              >
                <button
                  type="button"
                  data-workspace-agent-settings="true"
                  onClick={() => {
                    onOpenAgentSettings();
                    closePopover();
                  }}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.08]"
                >
                  <SettingsIcon className="size-3.5 shrink-0" aria-hidden />
                  <span>代理设置...</span>
                </button>
              </div>
            </>
          ) : (
            /* Search Mode Results */
            <div
              data-workspace-quick-search-results="true"
              className="flex max-h-80 flex-col gap-1 overflow-y-auto p-1.5"
            >
              {searchResult.urlTarget ? (
                <button
                  type="button"
                  data-workspace-search-url="true"
                  onClick={() => {
                    onOpenUrl(searchResult.urlTarget!.normalizedUrl, paneId);
                    closePopover();
                  }}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg bg-primary/10 px-2.5 py-2 text-left text-xs font-medium text-foreground outline-none transition-colors hover:bg-primary/16 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <GlobeIcon className="size-4 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    在内置浏览器打开 {searchResult.urlTarget.displayHost}
                  </span>
                </button>
              ) : null}

              {searchResult.openTabs.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">
                    已打开的标签页
                  </div>
                  {searchResult.openTabs.map(({ tab, paneId: tabPaneId }) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        onActivateOpenTab(tabPaneId, tab.id);
                        closePopover();
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground outline-none transition-colors hover:bg-foreground/[0.07] focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.08]"
                    >
                      {tabKindIcon(tab)}
                      <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">切换</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {searchResult.agents.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">
                    启动代理会话
                  </div>
                  {searchResult.agents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => {
                        onLaunchAgent(agent, paneId);
                        closePopover();
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground outline-none transition-colors hover:bg-foreground/[0.07] focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.08]"
                    >
                      <AgentBrandLogo
                        provider={agent.brandId === "custom" ? agent.driverKind : agent.brandId}
                        size={14}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {agent.displayName}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">新建</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {searchResult.tools.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">
                    快捷工具
                  </div>
                  {searchResult.tools.map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => {
                        onRunQuickTool(tool.id, paneId);
                        closePopover();
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground outline-none transition-colors hover:bg-foreground/[0.07] focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.08]"
                    >
                      <span className="text-muted-foreground">{quickToolIcon(tool.id)}</span>
                      <span className="min-w-0 flex-1 truncate">{tool.tooltip}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {searchResult.historyThreads.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">
                    历史会话
                  </div>
                  {searchResult.historyThreads.map((thread) => (
                    <button
                      key={`${thread.environmentId}:${thread.threadId}`}
                      type="button"
                      onClick={() => {
                        onOpenHistoryThread(thread, paneId);
                        closePopover();
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground outline-none transition-colors hover:bg-foreground/[0.07] focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.08]"
                    >
                      {thread.providerId ? (
                        <AgentBrandLogo provider={thread.providerId} size={13} />
                      ) : (
                        <MessageSquareIcon
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                      {thread.projectName ? (
                        <span className="max-w-20 shrink-0 truncate text-[10px] text-muted-foreground">
                          {thread.projectName}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}

              {!hasSearchHits ? (
                <div className="px-3 py-5 text-center text-xs text-muted-foreground">
                  未找到匹配的标签页、历史记录或代理
                </div>
              ) : null}
            </div>
          )}

          {/* Safe-Triangle Protected Hover Submenu portaled to body so glass overflow-hidden never clips it */}
          {open && !searchResult.isSearching && activeSubmenuAgent && typeof document !== "undefined"
            ? createPortal(
                <div
                  ref={submenuPopupRef}
                  data-workspace-agent-submenu={activeSubmenuAgent.brandId}
                  data-side={submenuCoords.side}
                  data-pmx-glass-zone="overlays"
                  style={{ top: submenuCoords.top, left: submenuCoords.left }}
                  onPointerEnter={() => aimCone.controller.cancelPendingSwitch()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  className="dropdown-glass fixed z-[150] flex w-60 flex-col overflow-hidden rounded-xl border border-border/80 bg-popover bg-clip-padding p-1.5 shadow-[0_18px_42px_-16px_rgba(0,0,0,0.45)] [-webkit-app-region:no-drag]"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onLaunchAgent(activeSubmenuAgent, paneId);
                      closePopover();
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-foreground outline-none transition-colors hover:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.1]"
                  >
                    <PlusIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">新建 {activeSubmenuAgent.displayName} 对话</span>
                  </button>

                  {canSplit && onLaunchAgentInSplit ? (
                    <button
                      type="button"
                      onClick={() => {
                        onLaunchAgentInSplit(activeSubmenuAgent, paneId);
                        closePopover();
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground outline-none transition-colors hover:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.1]"
                    >
                      <Columns2Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate">
                        在右侧边栏打开 {activeSubmenuAgent.displayName}
                      </span>
                    </button>
                  ) : null}

                  <div className="my-1 border-t border-border/65" />

                  <div className="px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {activeSubmenuAgent.recentThreads.length > 0
                      ? `${formatAgentBrandName(activeSubmenuAgent.brandId, activeSubmenuAgent.displayName)} 最近会话`
                      : "暂无历史会话"}
                  </div>
                  {activeSubmenuAgent.recentThreads.map((thread) => (
                    <button
                      key={`${thread.environmentId}:${thread.threadId}`}
                      type="button"
                      onClick={() => {
                        onOpenHistoryThread(thread, paneId);
                        closePopover();
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground outline-none transition-colors hover:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.1]"
                    >
                      <MessageSquareIcon
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                    </button>
                  ))}
                </div>,
                document.body,
              )
            : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
});
