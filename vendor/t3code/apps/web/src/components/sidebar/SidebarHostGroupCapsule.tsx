import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { useOrcaProjectsCopy } from "./orcaProjects/orcaProjectsCopy";

export interface SidebarHostGroupCapsuleProps {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly hostname?: string | null | undefined;
  readonly machine: EnvironmentMachineKind;
  readonly workspaceCount: number;
  readonly collapsed?: boolean;
  readonly onToggle?: (() => void) | undefined;
}

/**
 * Orca-aligned host / execution environment grouping capsule:
 * `[Host Icon] [Bold Host Name] [optional dimmed hostname] [workspace count pill]`.
 */
export const SidebarHostGroupCapsule = memo(function SidebarHostGroupCapsule({
  environmentId,
  label,
  hostname,
  machine,
  workspaceCount,
  collapsed = false,
  onToggle,
}: SidebarHostGroupCapsuleProps) {
  const copy = useOrcaProjectsCopy();
  const content = (
    <>
      <EnvironmentMachineIcon
        aria-hidden
        kind={machine}
        className="size-3.5 shrink-0 text-sidebar-muted-foreground/85"
      />
      <span
        data-testid="sidebar-host-label"
        className="truncate font-semibold tracking-tight text-sidebar-foreground/95"
      >
        {label}
      </span>
      {hostname ? (
        <span
          data-testid="sidebar-host-hostname"
          className="min-w-0 truncate text-2xs font-normal text-sidebar-muted-foreground/70"
        >
          {hostname}
        </span>
      ) : null}
      <span
        data-testid="sidebar-host-count"
        className="inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full border border-sidebar-border/70 px-1 text-3xs leading-none font-medium text-sidebar-muted-foreground tabular-nums"
      >
        {workspaceCount}
      </span>
    </>
  );

  const capsuleClassName = cn(
    "flex h-7 w-full items-center gap-2 rounded-lg border border-sidebar-border/60 bg-sidebar-control-surface/35 px-2.5 text-left text-xs transition-colors outline-none",
    onToggle &&
      "cursor-pointer hover:border-sidebar-border/85 hover:bg-sidebar-control-surface/55 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
  );

  return (
    <li
      data-testid={`sidebar-host-group-${environmentId}`}
      data-sidebar-host-group={environmentId}
      className="mt-2 list-none first:mt-0.5"
    >
      {onToggle ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${label} (${workspaceCount}): ${copy.toggleHostGroupTooltip}`}
          onClick={onToggle}
          className={capsuleClassName}
        >
          {content}
        </button>
      ) : (
        <div className={capsuleClassName}>{content}</div>
      )}
    </li>
  );
});
