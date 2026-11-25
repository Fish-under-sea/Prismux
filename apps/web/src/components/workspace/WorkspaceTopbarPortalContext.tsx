import type { ProviderInstanceId } from "@prismux/core-contracts";
import {
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";

import { cn } from "~/lib/utils";
import { ROOT_SPLIT_PANE_EDGES, type SplitPaneEdges } from "./splitAnything.logic";

export interface WorkspaceActiveChatProviderSnapshot {
  readonly routeKey: string;
  readonly instanceId: ProviderInstanceId | null;
  readonly providerId: string | null;
  readonly model: string | null;
  readonly displayName: string | null;
}

export interface WorkspaceSplitPaneContextValue {
  /** True whenever the workspace contains > 1 split pane; disables nested interior rounding. */
  readonly inSplit: boolean;
  /** Which outer workspace boundaries this pane touches (`top`, `right`, `bottom`, `left`). */
  readonly edges: SplitPaneEdges;
}

const DEFAULT_WORKSPACE_SPLIT_PANE_VALUE: WorkspaceSplitPaneContextValue = {
  inSplit: false,
  edges: ROOT_SPLIT_PANE_EDGES,
};

export const WorkspaceSplitPaneContext = createContext<WorkspaceSplitPaneContextValue>(
  DEFAULT_WORKSPACE_SPLIT_PANE_VALUE,
);

export function useWorkspaceSplitPane(): WorkspaceSplitPaneContextValue {
  return useContext(WorkspaceSplitPaneContext);
}

export interface WorkspaceTopbarPortalContextValue {
  /** True when mounted inside `WorkspaceSplitContainer`, which owns the single top tab bar. */
  readonly managed: boolean;
  /** DOM slot inside the top-right `WorkspaceTabBar` where the active `ChatView` portals its controls. */
  readonly slotElement: HTMLDivElement | null;
  /** Ref to the single top `WorkspaceTabBar` so `ThreadDetailsPanel` popovers anchor directly below it. */
  readonly tabBarRef: RefObject<HTMLDivElement | null>;
  /** Tracks whether an active `ChatView` has claimed the topbar controls slot. */
  readonly setHasActiveChatControls: (active: boolean) => void;
  /** Syncs the mounted `ChatView`'s live resolved provider/model into the workspace tab bar. */
  readonly setActiveChatProvider?:
    | ((snapshot: WorkspaceActiveChatProviderSnapshot | null) => void)
    | undefined;
  /** True when the fallback standalone right sidebar drawer is open (empty workspace). */
  readonly standaloneRightPanelOpen: boolean;
}

const FALLBACK_TAB_BAR_REF: RefObject<HTMLDivElement | null> = { current: null };

const DEFAULT_WORKSPACE_TOPBAR_PORTAL_VALUE: WorkspaceTopbarPortalContextValue = {
  managed: false,
  slotElement: null,
  tabBarRef: FALLBACK_TAB_BAR_REF,
  setHasActiveChatControls: () => {},
  setActiveChatProvider: undefined,
  standaloneRightPanelOpen: false,
};

export const WorkspaceTopbarPortalContext = createContext<WorkspaceTopbarPortalContextValue>(
  DEFAULT_WORKSPACE_TOPBAR_PORTAL_VALUE,
);

export function useWorkspaceTopbarPortal(): WorkspaceTopbarPortalContextValue {
  return useContext(WorkspaceTopbarPortalContext);
}

export interface PrismuxStageFrameProps {
  /** Whether the inline right sidebar is currently expanded alongside the main inner stage. */
  readonly rightPanelOpen?: boolean;
  /** Which liquid-glass zone owns the inner stage (`mainCanvas` for chat, `workPanels` for Tasks/Workspace Board/Scheduled Tasks). */
  readonly glassZone?: "mainCanvas" | "workPanels";
  /** Force flat zero-radius interior framing when mounted inside a multi-pane split. Defaults to `WorkspaceSplitPaneContext.inSplit`. */
  readonly splitFlat?: boolean;
  readonly innerRef?: Ref<HTMLDivElement>;
  readonly innerStyle?: CSSProperties | undefined;
  readonly innerClassName?: string;
  readonly frameClassName?: string;
  readonly innerDataAttributes?: Readonly<Record<string, string | undefined>>;
  readonly children: ReactNode;
}

/**
 * Monolithic stage frame matching `prismux-glass-bridge.css` (`data-pmx-stage-frame="1"`, 4 inverted corners,
 * 7px right edge when sidebar closed). Inside multi-pane splits (`inSplit`), renders flat `rounded-none border-0`.
 */
export function PrismuxStageFrame(props: PrismuxStageFrameProps) {
  const {
    rightPanelOpen = false,
    glassZone = "mainCanvas",
    splitFlat,
    innerRef,
    innerStyle,
    innerClassName,
    frameClassName,
    innerDataAttributes,
    children,
  } = props;

  const splitPane = useWorkspaceSplitPane();
  const isSplitFlat = splitFlat ?? splitPane.inSplit;

  if (isSplitFlat) {
    return (
      <div
        data-pmx-stage-shell="1"
        data-pmx-split-flat="1"
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-none border-0",
          frameClassName,
        )}
      >
        <div
          ref={innerRef}
          data-pmx-glass-zone={glassZone}
          data-pmx-work-panel={glassZone === "workPanels" ? "1" : undefined}
          data-pmx-split-inner-stage="1"
          style={innerStyle}
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-none border-0 bg-background",
            innerClassName,
          )}
          {...innerDataAttributes}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      data-pmx-stage-shell="1"
      data-pmx-right-open={rightPanelOpen ? "1" : "0"}
      className={cn("relative flex min-h-0 min-w-0 flex-1 overflow-hidden", frameClassName)}
    >
      <div
        data-pmx-stage-frame="1"
        data-pmx-right-open={rightPanelOpen ? "1" : "0"}
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        <span aria-hidden="true" data-pmx-stage-corner="tl" />
        <span aria-hidden="true" data-pmx-stage-corner="tr" />
        <span aria-hidden="true" data-pmx-stage-corner="bl" />
        <span aria-hidden="true" data-pmx-stage-corner="br" />
        <div
          ref={innerRef}
          data-pmx-glass-zone={glassZone}
          data-pmx-work-panel={glassZone === "workPanels" ? "1" : undefined}
          data-pmx-inner-stage="1"
          style={innerStyle}
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background",
            innerClassName,
          )}
          {...innerDataAttributes}
        >
          {children}
        </div>
      </div>
      {!rightPanelOpen ? (
        <div
          aria-hidden="true"
          data-pmx-right-frame-edge="1"
          data-pmx-glass-zone="shellFrame"
          className="w-[7px] shrink-0 self-stretch bg-sidebar [[data-pmx-glass='1']_&]:bg-transparent"
        />
      ) : null}
    </div>
  );
}
