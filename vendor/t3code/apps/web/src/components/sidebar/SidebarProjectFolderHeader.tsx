import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ContextMenuSource } from "@t3tools/contracts";
import { ChevronDownIcon, NetworkIcon, SquarePenIcon } from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { memo, type MouseEvent as ReactMouseEvent } from "react";

import { cn } from "~/lib/utils";
import { contextMenuSourceOf } from "../../contextMenuSource";
import { ensureLocalApi } from "../../localApi";
import { useOptionalPrismuxRuntime } from "../../prismux/PrismuxRuntimeProvider";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useUiStateStore } from "../../uiStateStore";
import { resolveSidebarFolderDot, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  findWorkspaceListeningPorts,
  formatPortMicroBadgeLabel,
  resolvePrimaryPortUrl,
  stopActivationKeyPropagation,
} from "./sidebarMicroIndicators";

const FOLDER_DOT_CLASS_NAME = {
  attention: "bg-warning",
  failed: "bg-error",
  unread: "bg-success",
  working: "bg-info",
} as const;

const FOLDER_DOT_LABEL = {
  attention: msg(", needs you", { $context: "project folder status, read after its name" }),
  failed: msg(", failed", { $context: "project folder status, read after its name" }),
  unread: msg(", done", { $context: "project folder status, read after its name" }),
  working: msg(", working", { $context: "project folder status, read after its name" }),
} as const;

/** The folder's sidebar tree row; its thread rows name it as their parent. */
export function sidebarFolderRowId(projectKey: string) {
  return `folder:${projectKey}`;
}

/**
 * A project folder in the boring sidebar. It reads like a shelf header: a trailing
 * count and chevron, with the count and a status dot only while it is closed, so a
 * closed folder still says when a hidden thread needs you.
 */
export const SidebarProjectFolderHeader = memo(function SidebarProjectFolderHeader(props: {
  group: SidebarProjectSnapshot;
  collapsed: boolean;
  hiddenThreads: readonly EnvironmentThreadShell[];
  onToggle: (group: SidebarProjectSnapshot) => void;
  onNewThread: (group: SidebarProjectSnapshot) => void;
  onContextMenu: (
    group: SidebarProjectSnapshot,
    position: { x: number; y: number },
    source: ContextMenuSource,
  ) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { group, collapsed, hiddenThreads } = props;
  const rowId = sidebarFolderRowId(group.projectKey);
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const prismuxRuntime = useOptionalPrismuxRuntime();
  const folderPorts = findWorkspaceListeningPorts(
    prismuxRuntime?.portsState.ports ?? [],
    group.workspaceRoot,
  );
  const folderPortLabel = formatPortMicroBadgeLabel(folderPorts);
  const folderPrimaryUrl = resolvePrimaryPortUrl(folderPorts);
  const handleFolderPortClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (folderPorts.length === 1 && folderPrimaryUrl && !event.shiftKey) {
      try {
        void ensureLocalApi().shell.openExternal(folderPrimaryUrl).catch(() => {
          window.open(folderPrimaryUrl, "_blank", "noopener,noreferrer");
        });
      } catch {
        window.open(folderPrimaryUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }
    prismuxRuntime?.requestOpenPortsPopover(group.workspaceRoot);
  };
  const dot = collapsed
    ? resolveSidebarFolderDot(
        hiddenThreads.map((thread) => ({
          ...thread,
          lastVisitedAt: resolveThreadLastVisitedAt(
            thread.lastVisitedAt,
            localLastVisitedAtById[
              scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
            ],
          ),
        })),
      )
    : null;
  return (
    <li
      data-testid="sidebar-project-folder"
      className="group/project-folder relative mt-2 list-none first:mt-0"
    >
      <button
        type="button"
        data-sidebar-row={rowId}
        aria-expanded={!collapsed}
        onClick={() => props.onToggle(group)}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onContextMenu(
            group,
            { x: event.clientX, y: event.clientY },
            contextMenuSourceOf(event),
          );
        }}
        className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ProjectFavicon project={group} className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground/90">
          {group.displayName}
        </span>
        {folderPortLabel ? (
          <span
            role="button"
            tabIndex={0}
            data-testid={`sidebar-folder-port-badge-${group.projectKey}`}
            title={
              folderPorts.length === 1 && folderPrimaryUrl
                ? gt("Click to open {url} · Shift+click to inspect ports", {
                    url: folderPrimaryUrl,
                  })
                : gt(
                    "{count, plural, one {Click to inspect {count} listening workspace port} other {Click to inspect {count} listening workspace ports}}",
                    { count: folderPorts.length },
                  )
            }
            onClick={(event) => {
              handleFolderPortClick(event);
              if (event.detail > 0) event.currentTarget.blur();
            }}
            onKeyDown={(event) => {
              stopActivationKeyPropagation(event);
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                prismuxRuntime?.requestOpenPortsPopover(group.workspaceRoot);
              }
            }}
            className="inline-flex h-4 shrink-0 cursor-pointer items-center gap-0.5 rounded-sm bg-emerald-600/15 px-1 font-mono text-[10px] leading-none font-semibold text-emerald-800 tabular-nums transition-colors hover:bg-emerald-600/25 group-hover/project-folder:invisible dark:bg-emerald-400/18 dark:text-emerald-200"
          >
            <NetworkIcon aria-hidden className="size-2.5 shrink-0" />
            <span>{folderPortLabel}</span>
          </span>
        ) : null}
        {dot ? (
          <span className={cn("size-1.5 shrink-0 rounded-full", FOLDER_DOT_CLASS_NAME[dot])}>
            <span className="sr-only">{m(FOLDER_DOT_LABEL[dot])}</span>
          </span>
        ) : null}
        {collapsed && hiddenThreads.length > 0 ? (
          <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground group-hover/project-folder:invisible group-has-[[data-sidebar-action-for]:focus]/project-folder:invisible pointer-coarse:invisible">
            {hiddenThreads.length}
          </span>
        ) : null}
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-sidebar-muted-foreground transition-transform",
            collapsed && "-rotate-90",
          )}
        />
      </button>
      {/* Sits over the count, which hides on hover or focus, and left of the chevron. */}
      <span className="absolute inset-y-0 right-6 flex items-center opacity-0 focus-within:opacity-100 group-hover/project-folder:opacity-100 pointer-coarse:opacity-100">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                data-sidebar-action-for={rowId}
                size="icon-xs"
                variant="ghost-muted"
                aria-label={gt("New thread in {project}", { project: group.displayName })}
                onClick={() => props.onNewThread(group)}
              />
            }
          >
            <SquarePenIcon aria-hidden />
          </TooltipTrigger>
          <TooltipPopup>
            <T>
              New thread in <Var>{group.displayName}</Var>
            </T>
          </TooltipPopup>
        </Tooltip>
      </span>
    </li>
  );
});
