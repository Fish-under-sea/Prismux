import { msg } from "gt-react";
import type { DaemonSystemPortEntryDto } from "../../prismux/daemonClient";
import {
  isPortInWorkspace,
  resolvePortOpenUrl,
} from "../../prismux/statusBar/portsPolling";

export type AgentRuntimeLampState = "running" | "approval" | "idle";

export interface AgentRuntimeLampInfo {
  readonly state: AgentRuntimeLampState;
  readonly label: string;
  readonly labelMessage: string;
  readonly dotClassName: string;
}

const AGENT_LAMP_MESSAGES = {
  running: msg("Running", { $context: "agent runtime status lamp" }),
  approval: msg("Needs approval", { $context: "agent runtime status lamp" }),
  idle: msg("Idle", { $context: "agent runtime status lamp" }),
} as const;

export function resolveAgentRuntimeLamp(
  status: string | null | undefined,
): AgentRuntimeLampInfo {
  if (status === "preparing" || status === "working") {
    return {
      state: "running",
      label: "Running",
      labelMessage: AGENT_LAMP_MESSAGES.running,
      dotClassName: "bg-emerald-500 animate-pulse motion-reduce:animate-none",
    };
  }
  if (status === "approval" || status === "input" || status === "request") {
    return {
      state: "approval",
      label: "Needs approval",
      labelMessage: AGENT_LAMP_MESSAGES.approval,
      dotClassName: "bg-amber-500",
    };
  }
  return {
    state: "idle",
    label: "Idle",
    labelMessage: AGENT_LAMP_MESSAGES.idle,
    dotClassName: "bg-muted-foreground/45",
  };
}

export function findWorkspaceListeningPorts(
  ports: readonly DaemonSystemPortEntryDto[],
  workspaceRoot: string | null | undefined,
): readonly DaemonSystemPortEntryDto[] {
  if (!workspaceRoot || ports.length === 0) return [];
  const matched = ports.filter((entry) => isPortInWorkspace(entry, workspaceRoot));
  matched.sort((a, b) => a.port - b.port);
  return matched;
}

export function formatPortMicroBadgeLabel(
  ports: readonly DaemonSystemPortEntryDto[],
): string | null {
  if (ports.length === 0) return null;
  const first = ports[0]!;
  if (ports.length === 1) return `:${first.port}`;
  return `:${first.port} +${ports.length - 1}`;
}

export function resolvePrimaryPortUrl(
  ports: readonly DaemonSystemPortEntryDto[],
): string | null {
  const first = ports[0];
  return first ? resolvePortOpenUrl(first) : null;
}

export interface SidebarUtilityOverflowResult<T extends string> {
  readonly visibleIds: ReadonlySet<T>;
  readonly overflowIds: readonly T[];
  readonly collapsedByHeight: boolean;
}

export const SIDEBAR_LOW_HEIGHT_COMPACT_PX = 620;
export const SIDEBAR_VERY_LOW_HEIGHT_PX = 480;

/**
 * Determines which sidebar footer/nav utility items stay inline vs fold into the `More` menu.
 * Responds to both window height shrinkage and narrow horizontal sidebar widths.
 * Components stay mounted (hidden via CSS) so dialogs/form controllers never unmount on fold.
 */
export function resolveSidebarUtilityOverflow<T extends string>(
  itemIds: readonly T[],
  options: {
    readonly viewportHeight: number;
    readonly containerWidth?: number;
    readonly itemSlotWidth?: number;
    readonly reservedTrailingWidth?: number;
  },
): SidebarUtilityOverflowResult<T> {
  if (itemIds.length === 0) {
    return { visibleIds: new Set<T>(), overflowIds: [], collapsedByHeight: false };
  }

  const height = Number.isFinite(options.viewportHeight) ? options.viewportHeight : 900;
  let heightCapacity = itemIds.length;
  let collapsedByHeight = false;

  if (height < SIDEBAR_VERY_LOW_HEIGHT_PX) {
    heightCapacity = Math.min(itemIds.length, 1);
    collapsedByHeight = heightCapacity < itemIds.length;
  } else if (height < SIDEBAR_LOW_HEIGHT_COMPACT_PX) {
    heightCapacity = Math.min(itemIds.length, 2);
    collapsedByHeight = heightCapacity < itemIds.length;
  }

  let widthCapacity = itemIds.length;
  const containerWidth = options.containerWidth;
  if (typeof containerWidth === "number" && Number.isFinite(containerWidth) && containerWidth > 0) {
    const slotWidth = options.itemSlotWidth ?? 34;
    const reserved = options.reservedTrailingWidth ?? 52;
    const usable = Math.max(0, containerWidth - reserved);
    const maxInline = Math.floor(usable / slotWidth);
    if (maxInline < itemIds.length) {
      // Reserve one slot for the More button itself.
      widthCapacity = Math.max(1, Math.floor(Math.max(0, usable - slotWidth) / slotWidth));
    }
  }

  const capacity = Math.max(1, Math.min(heightCapacity, widthCapacity));
  if (capacity >= itemIds.length) {
    return {
      visibleIds: new Set(itemIds),
      overflowIds: [],
      collapsedByHeight: false,
    };
  }

  return {
    visibleIds: new Set(itemIds.slice(0, capacity)),
    overflowIds: itemIds.slice(capacity),
    collapsedByHeight,
  };
}

/**
 * WAI-ARIA APG roving focus index calculator modeled after Orca `app-rail/app-rail-roving-focus.ts`.
 * Supports horizontal (`ArrowLeft`/`ArrowRight`) or vertical (`ArrowUp`/`ArrowDown`) toolbars
 * plus `Home`/`End`, wrapping modulo `count`. Returns `null` for non-navigation keys.
 */
export function nextToolbarFocusIndex(
  key: string,
  currentIndex: number,
  count: number,
  orientation: "horizontal" | "vertical" = "horizontal",
): number | null {
  if (count <= 0) return null;
  const prevKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  const nextKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  if (key === nextKey) return (currentIndex + 1) % count;
  if (key === prevKey) return (currentIndex - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export const SIDEBAR_UTILITY_ITEM_ATTR = "data-sidebar-utility-item" as const;

/**
 * Resolves which sidebar utility item currently owns focus, even when focus has moved
 * into a portalled menu/popover labelled by that item's trigger (`aria-labelledby` hops).
 * Modeled after Orca `app-rail/app-rail-focus-ownership.ts`.
 */
export function resolveToolbarItemOwningFocus(
  toolbar: ParentNode | null,
  activeElement: Element | null = typeof document !== "undefined" ? document.activeElement : null,
  doc: { getElementById(id: string): Element | null } | null =
    typeof document !== "undefined" ? document : null,
): string | null {
  if (!toolbar || !activeElement) return null;

  const direct = activeElement.closest(`[${SIDEBAR_UTILITY_ITEM_ATTR}]`);
  if (direct && toolbar.contains(direct)) {
    return direct.getAttribute(SIDEBAR_UTILITY_ITEM_ATTR);
  }

  // Follow aria-labelledby hops (up to 4 levels) for portalled menus/dialogs owned by a toolbar trigger.
  let current: Element | null = activeElement;
  for (let hop = 0; hop < 4 && current; hop += 1) {
    const labelledContainer = current.closest("[aria-labelledby]");
    const labelIds = labelledContainer?.getAttribute("aria-labelledby")?.trim();
    if (!labelIds || !doc) break;
    let nextElement: Element | null = null;
    for (const id of labelIds.split(/\s+/)) {
      const owner = doc.getElementById(id);
      if (!owner) continue;
      const ownedItem = owner.closest(`[${SIDEBAR_UTILITY_ITEM_ATTR}]`);
      if (ownedItem && toolbar.contains(ownedItem)) {
        return ownedItem.getAttribute(SIDEBAR_UTILITY_ITEM_ATTR);
      }
      nextElement = owner;
    }
    if (!nextElement || nextElement === current) break;
    current = nextElement;
  }

  return null;
}

/**
 * Prevents Enter/Space keyboard activation on nested interactive micro-badges from
 * bubbling up to the parent thread/folder row (`role="button"`).
 * Modeled after Orca `workspace-card/details/WorktreeCardPorts.tsx`.
 */
export function stopActivationKeyPropagation(event: {
  readonly key: string;
  stopPropagation: () => void;
}): void {
  if (event.key === "Enter" || event.key === " ") {
    event.stopPropagation();
  }
}
