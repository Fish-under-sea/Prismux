import { FileTextIcon } from "lucide-react";
import { memo, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useOrcaProjectsCopy } from "./orcaProjects/orcaProjectsCopy";
import type { SidebarWorkspaceGroup, SidebarWorkspaceStatus } from "./sidebarWorkspaceGrouping";

export interface SidebarWorkspaceCardProps {
  readonly workspace: Pick<
    SidebarWorkspaceGroup,
    "workspaceKey" | "title" | "branch" | "isPrimary" | "isSelected" | "status"
  >;
  readonly onActivateWorkspace?: (() => void) | undefined;
  readonly onOpenWorkspaceFiles?: (() => void) | undefined;
  readonly children: ReactNode;
}

function WorkspaceStatusIndicator({ status }: { readonly status: SidebarWorkspaceStatus }) {
  if (status === "working") {
    return (
      <svg
        aria-hidden
        data-workspace-status="working"
        viewBox="0 0 12 12"
        fill="none"
        className="size-3 shrink-0 animate-spin text-warning motion-reduce:animate-none"
      >
        <circle
          cx="6"
          cy="6"
          r="4.25"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeOpacity="0.22"
        />
        <path
          d="M6 1.75A4.25 4.25 0 1 1 1.75 6"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const dotClassName =
    status === "ready"
      ? "bg-success"
      : status === "attention"
        ? "bg-warning"
        : status === "failed"
          ? "bg-error"
          : "bg-sidebar-muted-foreground/45";

  return (
    <span
      aria-hidden
      data-workspace-status={status}
      className={cn("inline-block size-2 shrink-0 rounded-full", dotClassName)}
    />
  );
}

/**
 * Orca-aligned compact Workspace Card grouping threads by `(worktreePath, branch)`:
 * - Selected workspace wraps header + branch + child rows in a subtle rounded outline
 *   (`rounded-xl border border-sidebar-border/80 bg-sidebar-row-active/45`)
 * - Unselected workspaces render with zero clutter borders for maximum vertical density
 */
export const SidebarWorkspaceCard = memo(function SidebarWorkspaceCard({
  workspace,
  onActivateWorkspace,
  onOpenWorkspaceFiles,
  children,
}: SidebarWorkspaceCardProps) {
  const copy = useOrcaProjectsCopy();

  return (
    <li
      data-testid="sidebar-workspace-card"
      data-workspace-key={workspace.workspaceKey}
      data-workspace-selected={workspace.isSelected ? "true" : "false"}
      data-workspace-primary={workspace.isPrimary ? "true" : "false"}
      className="list-none py-0.5"
    >
      <div
        data-testid="sidebar-workspace-card-surface"
        className={cn(
          "rounded-xl px-2 py-1.5 transition-colors",
          workspace.isSelected
            ? "border border-sidebar-border/80 bg-sidebar-row-active/45"
            : "border border-transparent",
        )}
      >
        {/* Workspace header row (24px) */}
        <div className="flex h-6 min-w-0 items-center gap-2">
          <button
            type="button"
            data-testid="sidebar-workspace-header"
            onClick={onActivateWorkspace}
            className={cn(
              "flex h-6 min-w-0 flex-1 items-center gap-2 rounded-md px-0.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              onActivateWorkspace
                ? "cursor-pointer hover:text-sidebar-foreground"
                : "cursor-default",
            )}
          >
            <span className="flex w-3 shrink-0 items-center justify-center">
              <WorkspaceStatusIndicator status={workspace.status} />
            </span>
            <span
              data-testid="sidebar-workspace-title"
              className="min-w-0 truncate text-sm leading-tight font-medium text-sidebar-foreground/95"
            >
              {workspace.title}
            </span>
            {workspace.isPrimary ? (
              <span
                data-testid="sidebar-workspace-primary-pill"
                className="inline-flex h-4 shrink-0 items-center rounded bg-sidebar-control-surface px-1.5 text-3xs leading-none font-medium text-sidebar-muted-foreground"
              >
                {copy.primaryWorkspaceBadge}
              </span>
            ) : null}
          </button>
        </div>

        {/* Branch sub-row (20px, pl-5) + trailing doc icon */}
        {workspace.branch ? (
          <div
            data-testid="sidebar-workspace-branch-row"
            className="flex h-5 min-w-0 items-center justify-between gap-1.5 pr-0.5 pl-5"
          >
            <span
              data-testid="sidebar-workspace-branch"
              className="min-w-0 truncate text-2xs leading-none text-sidebar-muted-foreground/85"
            >
              {workspace.branch}
            </span>
            {onOpenWorkspaceFiles ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      data-testid="sidebar-workspace-doc-button"
                      aria-label={copy.openWorkspaceFilesTooltip}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenWorkspaceFiles();
                      }}
                      className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-sidebar-muted-foreground opacity-60 outline-none transition-opacity hover:text-sidebar-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                    />
                  }
                >
                  <FileTextIcon aria-hidden className="size-3.5" />
                </TooltipTrigger>
                <TooltipPopup side="right" sideOffset={6}>
                  {copy.openWorkspaceFilesTooltip}
                </TooltipPopup>
              </Tooltip>
            ) : (
              <FileTextIcon
                aria-hidden
                data-testid="sidebar-workspace-doc-icon"
                className="size-3.5 shrink-0 text-sidebar-muted-foreground opacity-55"
              />
            )}
          </div>
        ) : null}

        {/* Child compact thread rows */}
        <ul role="presentation" className="mt-0.5 flex flex-col gap-px">
          {children}
        </ul>
      </div>
    </li>
  );
});
