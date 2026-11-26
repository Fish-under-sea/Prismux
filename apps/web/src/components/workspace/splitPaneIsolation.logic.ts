import { scopedThreadKey, scopeThreadRef } from "@prismux/client-runtime/environment";
import type { ScopedThreadRef } from "@prismux/core-contracts";
import { msg } from "gt-react";

import { m } from "../../i18n/messages";
import type { RightPanelKind, RightPanelSurface } from "../../rightPanelStore";
import type { ThreadRouteTarget } from "../../threadRoutes";
import {
  countLeafPanes,
  listLeafPaneIds,
  type WorkspaceDraftStateLookup,
  type WorkspacePane,
  type WorkspaceSplitLayoutNode,
  type WorkspaceTab,
} from "./workspaceTabsStore";

export type WorkspaceDraftSessionLookup = WorkspaceDraftStateLookup & {
  readonly getDraftSessionWithCoords?: (draftId: NonNullable<WorkspaceTab["draftId"]>) => {
    readonly environmentId: NonNullable<WorkspaceTab["environmentId"]>;
    readonly threadId: NonNullable<WorkspaceTab["threadId"]>;
    readonly promotedTo?: ScopedThreadRef | null | undefined;
  } | null;
};

/**
 * Checks whether a workspace tab strictly represents the same thread or draft as the
 * active TanStack Router `shownTarget`. Prevents any pane from rendering `primaryContent`
 * when its active tab points to a different thread or draft.
 */
export function doesWorkspaceTabMatchRouteTarget(
  tab: WorkspaceTab | null | undefined,
  shownTarget: ThreadRouteTarget | null,
  draftLookup?: WorkspaceDraftStateLookup | null,
): boolean {
  if (!tab || !shownTarget) return false;

  if (shownTarget.kind === "server") {
    if (tab.kind === "thread") {
      return (
        tab.environmentId === shownTarget.threadRef.environmentId &&
        tab.threadId === shownTarget.threadRef.threadId
      );
    }
    if (tab.kind === "draft") {
      if (
        tab.environmentId === shownTarget.threadRef.environmentId &&
        tab.threadId === shownTarget.threadRef.threadId
      ) {
        return true;
      }
      if (tab.draftId && draftLookup) {
        const promoted =
          draftLookup.getPromotedDraftRedirect?.(tab.draftId) ??
          draftLookup.getDraftSession(tab.draftId)?.promotedTo ??
          null;
        return (
          promoted !== null &&
          promoted.environmentId === shownTarget.threadRef.environmentId &&
          promoted.threadId === shownTarget.threadRef.threadId
        );
      }
    }
    return false;
  }

  // shownTarget.kind === "draft"
  return tab.kind === "draft" && tab.draftId === shownTarget.draftId;
}

/**
 * Resolves the authoritative thread ref owned by a workspace tab (or null when the tab
 * is not bound to a thread, such as an unbacked blank/agent tab or host-less tool tab).
 */
export function resolveWorkspaceTabThreadRef(
  tab: WorkspaceTab | null | undefined,
  draftLookup?: WorkspaceDraftSessionLookup | null,
): ScopedThreadRef | null {
  if (!tab) return null;

  if (tab.kind === "thread" || tab.kind === "side-chat") {
    if (tab.environmentId && tab.threadId) {
      return scopeThreadRef(tab.environmentId, tab.threadId);
    }
    return null;
  }

  if (tab.kind === "draft") {
    if (tab.draftId && draftLookup) {
      const redirected = draftLookup.getPromotedDraftRedirect?.(tab.draftId) ?? null;
      if (redirected) return redirected;
      const liveSession = draftLookup.getDraftSessionWithCoords?.(tab.draftId) ?? null;
      if (liveSession?.promotedTo) return liveSession.promotedTo;
      if (liveSession) {
        return scopeThreadRef(liveSession.environmentId, liveSession.threadId);
      }
    }
    if (tab.environmentId && tab.threadId) {
      return scopeThreadRef(tab.environmentId, tab.threadId);
    }
    return null;
  }

  if (tab.kind === "agent") {
    return null;
  }

  // Tool tabs (terminal / diff / browser / files / related / device / simulator)
  if (tab.hostThreadRef) {
    return tab.hostThreadRef;
  }
  if (tab.environmentId && tab.threadId) {
    return scopeThreadRef(tab.environmentId, tab.threadId);
  }
  return null;
}

/**
 * True when a workspace tab represents a conversation surface that mounts a `ChatView`
 * and owns a dedicated floating `SessionOverviewPanel`.
 */
export function isWorkspaceConversationTab(tab: WorkspaceTab | null | undefined): boolean {
  if (!tab) return false;
  return tab.kind === "thread" || tab.kind === "draft" || tab.kind === "side-chat";
}

export interface SplitRouteOwnershipResult {
  /** Which pane (if any) currently hosts `primaryContent` (`ThreadRouteView` / `<Outlet />`). */
  readonly routeOwnerPaneId: string | null;
  /** Whether `routeOwnerPaneId` should display `primaryContent` visibly. */
  readonly ownerShowsRoute: boolean;
}

/**
 * Picks the single pane (at most one) allowed to mount `primaryContent`.
 * In split view, binds `primaryContent` only to a pane whose active tab matches `shownTarget`.
 */
export function resolveSplitRouteOwnership(input: {
  readonly layout: WorkspaceSplitLayoutNode;
  readonly panes: Readonly<Record<string, WorkspacePane>>;
  readonly tabs: Readonly<Record<string, WorkspaceTab>>;
  readonly primaryPaneId: string;
  readonly focusedPaneId: string;
  readonly shownTarget: ThreadRouteTarget | null;
  readonly modalOpen: boolean;
  readonly draftLookup?: WorkspaceDraftStateLookup | null;
}): SplitRouteOwnershipResult {
  const { layout, panes, tabs, primaryPaneId, focusedPaneId, shownTarget, modalOpen, draftLookup } =
    input;

  const isSplit = countLeafPanes(layout) > 1;
  const getActiveTab = (paneId: string): WorkspaceTab | null => {
    const pane = panes[paneId];
    return pane?.activeTabId ? (tabs[pane.activeTabId] ?? null) : null;
  };

  if (!isSplit) {
    const primaryActiveTab = getActiveTab(primaryPaneId);
    const primaryShowsRoute =
      primaryActiveTab === null ||
      primaryActiveTab.kind === "thread" ||
      primaryActiveTab.kind === "draft" ||
      primaryActiveTab.kind === "agent";
    return {
      routeOwnerPaneId: primaryPaneId,
      ownerShowsRoute: primaryShowsRoute,
    };
  }

  // Multi-pane split view with non-thread route (e.g. /workspace-board, /tasks, /)
  if (shownTarget === null) {
    const primaryActiveTab = getActiveTab(primaryPaneId);
    const showOutletInPrimary =
      !modalOpen && (primaryActiveTab === null || primaryActiveTab.kind === "agent");
    return {
      routeOwnerPaneId: showOutletInPrimary ? primaryPaneId : null,
      ownerShowsRoute: showOutletInPrimary,
    };
  }

  // Multi-pane split view with a thread/draft route target:
  // Strictly bind `primaryContent` ONLY to a pane whose active tab matches `shownTarget`.
  const primaryActiveTab = getActiveTab(primaryPaneId);
  if (doesWorkspaceTabMatchRouteTarget(primaryActiveTab, shownTarget, draftLookup)) {
    return { routeOwnerPaneId: primaryPaneId, ownerShowsRoute: true };
  }

  if (focusedPaneId !== primaryPaneId) {
    const focusedActiveTab = getActiveTab(focusedPaneId);
    if (doesWorkspaceTabMatchRouteTarget(focusedActiveTab, shownTarget, draftLookup)) {
      return { routeOwnerPaneId: focusedPaneId, ownerShowsRoute: true };
    }
  }

  for (const leafId of listLeafPaneIds(layout)) {
    if (leafId === primaryPaneId || leafId === focusedPaneId) continue;
    if (doesWorkspaceTabMatchRouteTarget(getActiveTab(leafId), shownTarget, draftLookup)) {
      return { routeOwnerPaneId: leafId, ownerShowsRoute: true };
    }
  }

  // No pane's active tab matches `shownTarget` (e.g. route navigation in-flight or both panes
  // switched to other tabs) -> never mirror stale `primaryContent` onto the wrong pane!
  return { routeOwnerPaneId: null, ownerShowsRoute: false };
}

export interface FocusedSplitRightPanelContext {
  readonly paneId: string;
  readonly paneIndex: number;
  readonly tab: WorkspaceTab | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly threadKey: string | null;
  readonly isConversationTab: boolean;
  readonly isDraftTab: boolean;
  readonly draftId: WorkspaceTab["draftId"];
  readonly title: string;
  readonly providerId: string | null;
}

/**
 * Resolves the active/focused pane context that the unified split-view right sidebar dock tracks.
 * Returns `threadRef: null` cleanly when the focused pane is on a non-thread tab so the dock
 * falls back cleanly instead of displaying stale content from another pane.
 */
export function resolveFocusedSplitRightPanelContext(input: {
  readonly layout: WorkspaceSplitLayoutNode;
  readonly panes: Readonly<Record<string, WorkspacePane>>;
  readonly tabs: Readonly<Record<string, WorkspaceTab>>;
  readonly focusedPaneId: string;
  readonly primaryPaneId: string;
  readonly draftLookup?: WorkspaceDraftSessionLookup | null;
}): FocusedSplitRightPanelContext {
  const { layout, panes, tabs, focusedPaneId, primaryPaneId, draftLookup } = input;
  const leafIds = listLeafPaneIds(layout);
  const resolvedPaneId = panes[focusedPaneId]
    ? focusedPaneId
    : panes[primaryPaneId]
      ? primaryPaneId
      : (leafIds[0] ?? primaryPaneId);
  const paneIndex = Math.max(0, leafIds.indexOf(resolvedPaneId));
  const pane = panes[resolvedPaneId];
  const tab = pane?.activeTabId ? (tabs[pane.activeTabId] ?? null) : null;
  const threadRef = resolveWorkspaceTabThreadRef(tab, draftLookup);
  const isConversationTab = isWorkspaceConversationTab(tab);

  return {
    paneId: resolvedPaneId,
    paneIndex,
    tab,
    threadRef,
    threadKey: threadRef ? scopedThreadKey(threadRef) : null,
    isConversationTab,
    isDraftTab: tab?.kind === "draft",
    draftId: tab?.kind === "draft" ? (tab.draftId ?? null) : null,
    title: tab?.title?.trim() || m(msg("Pane {index}"), { index: paneIndex + 1 }),
    providerId: tab?.providerId ?? null,
  };
}

/**
 * Thread-portable singleton surface kinds that can seamlessly carry over when the user
 * focuses another split pane while the unified right sidebar is already open.
 */
const PORTABLE_SPLIT_RIGHT_PANEL_KINDS: ReadonlySet<RightPanelKind> = new Set([
  "diff",
  "files",
  "pull-requests",
]);

export function resolveFollowSurfaceKindForPaneSwitch(input: {
  readonly previousSurface: RightPanelSurface | null;
  readonly nextThreadHasSurfaces: boolean;
  readonly nextIsServerThread: boolean;
  readonly nextHasProject: boolean;
  readonly nextDiffAvailable: boolean;
}): "diff" | "files" | "pull-requests" | "show-existing" | "show-empty" | null {
  const {
    previousSurface,
    nextThreadHasSurfaces,
    nextIsServerThread,
    nextHasProject,
    nextDiffAvailable,
  } = input;
  if (!previousSurface || previousSurface.kind === "wallpaper") {
    return null;
  }
  if (nextThreadHasSurfaces) {
    return "show-existing";
  }
  if (PORTABLE_SPLIT_RIGHT_PANEL_KINDS.has(previousSurface.kind)) {
    if (previousSurface.kind === "diff") {
      return nextIsServerThread && nextDiffAvailable
        ? "diff"
        : nextHasProject
          ? "files"
          : "show-empty";
    }
    if (previousSurface.kind === "files") {
      return nextHasProject ? "files" : "show-empty";
    }
    if (previousSurface.kind === "pull-requests") {
      return "pull-requests";
    }
  }
  if (previousSurface.kind === "file") {
    return nextHasProject ? "files" : "show-empty";
  }
  return "show-empty";
}
