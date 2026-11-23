import { useState, type ComponentProps } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { Menu, MenuPopup } from "../ui/menu";
import {
  SessionOverviewPanel,
  type SessionOverviewPanelProps,
} from "../overview/SessionOverviewPanel";
import type {
  OverviewDiffFileStat,
  OverviewDiffStats,
} from "../overview/sessionOverview.logic";
import { ThreadDetailsCard } from "./ThreadDetailsCard";
import { ThreadDetailsItemsMenuItems } from "./ThreadDetailsItemsMenu";
import { resolveThreadDetailsVisibility, THREAD_DETAILS_ITEMS } from "./threadDetailsItems";

export type { OverviewDiffFileStat, OverviewDiffStats };

export interface ThreadDetailsPanelProps
  extends Pick<ComponentProps<typeof ThreadDetailsCard>, "anchor" | "handle">,
    Omit<SessionOverviewPanelProps, "density"> {}

export function ThreadDetailsPanel({ anchor, handle, ...overviewProps }: ThreadDetailsPanelProps) {
  const visible = useClientSettings(resolveThreadDetailsVisibility);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

  return (
    <ThreadDetailsCard
      threadRef={{
        environmentId: overviewProps.environmentId,
        threadId: overviewProps.threadId,
      }}
      anchor={anchor}
      handle={handle}
      contentKey={THREAD_DETAILS_ITEMS.filter((item) => visible[item.id])
        .map((item) => item.id)
        .join(",")}
      onContextMenu={(event) => {
        // Popups the card opens bubble here through React; they, fields, links, and selected text
        // keep their own menus.
        const target = event.target;
        const selection = window.getSelection();
        if (
          !(target instanceof Element) ||
          !event.currentTarget.contains(target) ||
          target.closest("input, textarea, [contenteditable], a[href]") ||
          (selection &&
            !selection.isCollapsed &&
            (event.currentTarget.contains(selection.anchorNode) ||
              event.currentTarget.contains(selection.focusNode)))
        )
          return;
        event.preventDefault();
        setMenuPosition({ x: event.clientX, y: event.clientY });
      }}
    >
      {(density) => (
        <>
          <SessionOverviewPanel {...overviewProps} density={density} />

          <Menu
            open={menuPosition !== null}
            onOpenChange={(open) => !open && setMenuPosition(null)}
          >
            <MenuPopup
              anchor={
                menuPosition
                  ? {
                      getBoundingClientRect: () =>
                        new DOMRect(menuPosition.x, menuPosition.y, 0, 0),
                    }
                  : undefined
              }
              align="start"
              side="bottom"
            >
              <ThreadDetailsItemsMenuItems />
            </MenuPopup>
          </Menu>
        </>
      )}
    </ThreadDetailsCard>
  );
}
