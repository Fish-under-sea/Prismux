import { scopedThreadKey } from "@prismux/client-runtime/environment";
import type {
  EnvironmentId,
  ProviderInstanceId,
  ScopedThreadRef,
  ThreadId,
} from "@prismux/core-contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  composerDraftHasUserContent,
  useComposerDraftStore,
  type ComposerThreadDraftState,
  type DraftId,
  type DraftSessionState,
} from "../../composerDraftStore";
import { resolveStorage } from "../../lib/storage";
import { containsUuidNoise, formatAgentBrandName } from "../../prismux/agentBrand";
import type { ThreadRouteTarget } from "../../threadRoutes";
import {
  buildOpenTabInputFromSplitPayload,
  resolveSplitPlacementFromZone,
  type SplitDragPayload,
  type SplitDropZone,
  type SplitInsertPosition,
} from "./splitAnything.logic";

export type { SplitDragPayload, SplitDropZone, SplitInsertPosition };

export const WORKSPACE_TABS_STORAGE_KEY = "prismux.workspaceTabs.v1";
export const WORKSPACE_MAX_SPLIT_PANES = 8;
export const WORKSPACE_MIN_SPLIT_RATIO = 0.18;
export const WORKSPACE_MAX_SPLIT_RATIO = 0.82;
export const DEFAULT_PRIMARY_PANE_ID = "pane-main";

export type SplitDirection = "horizontal" | "vertical";

export type WorkspaceSplitLayoutNode =
  | { readonly type: "leaf"; readonly paneId: string }
  | {
      readonly type: "split";
      readonly id: string;
      readonly direction: SplitDirection;
      readonly first: WorkspaceSplitLayoutNode;
      readonly second: WorkspaceSplitLayoutNode;
      /** Flex ratio of the first child in [0.18, 0.82]. */
      readonly ratio: number;
    };

export type WorkspaceTabKind =
  | "thread"
  | "draft"
  | "agent"
  | "terminal"
  | "diff"
  | "browser"
  | "simulator"
  | "files"
  | "related"
  | "device"
  | "side-chat";

export interface WorkspaceTab {
  readonly id: string;
  readonly kind: WorkspaceTabKind;
  readonly title: string;
  /** Canonical provider/agent identifier (e.g. "codex", "claudeAgent", "antigravity"). */
  readonly providerId?: string | null | undefined;
  /** Bound Prismux provider instance ID when applicable. */
  readonly instanceId?: ProviderInstanceId | null | undefined;
  /** Preferred default model slug for quick-launched agent tabs. */
  readonly model?: string | null | undefined;
  /** Server thread coordinates when kind === "thread" or host thread for tools. */
  readonly environmentId?: EnvironmentId | null | undefined;
  readonly threadId?: ThreadId | null | undefined;
  /** Draft ID when kind === "draft". */
  readonly draftId?: DraftId | null | undefined;
  /** URL when kind === "browser". */
  readonly url?: string | null | undefined;
  /** Shell label when kind === "terminal" (e.g. "PowerShell"). */
  readonly shell?: string | null | undefined;
  /** Associated thread ref for embedded tool panes (terminal/diff/browser/simulator). */
  readonly hostThreadRef?: ScopedThreadRef | null | undefined;
  /** Optional terminal resource ID to keep multiple terminals distinct. */
  readonly resourceId?: string | null | undefined;
  readonly pinned?: boolean | undefined;
  readonly createdAt: number;
  readonly lastActiveAt: number;
}

export interface WorkspacePane {
  readonly id: string;
  readonly tabIds: ReadonlyArray<string>;
  readonly activeTabId: string | null;
}

export interface OpenWorkspaceTabInput {
  readonly kind: WorkspaceTabKind;
  readonly title: string;
  readonly providerId?: string | null | undefined;
  readonly instanceId?: ProviderInstanceId | null | undefined;
  readonly model?: string | null | undefined;
  readonly environmentId?: EnvironmentId | null | undefined;
  readonly threadId?: ThreadId | null | undefined;
  readonly draftId?: DraftId | null | undefined;
  readonly url?: string | null | undefined;
  readonly shell?: string | null | undefined;
  readonly hostThreadRef?: ScopedThreadRef | null | undefined;
  readonly resourceId?: string | null | undefined;
  readonly pinned?: boolean | undefined;
  /** If true (default for thread/draft), focuses an existing matching tab instead of duplicating. */
  readonly reuseExisting?: boolean | undefined;
  /**
   * Optional unused draft/agent tab ID in the primary pane to reuse in-place when opening a draft
   * whose draftId does not yet match any existing tab.
   */
  readonly reuseUnusedDraftTabId?: string | null | undefined;
}

export interface SyncRouteTargetInput {
  readonly target: ThreadRouteTarget | null;
  readonly title?: string | undefined;
  readonly providerId?: string | null | undefined;
  readonly instanceId?: ProviderInstanceId | null | undefined;
  readonly model?: string | null | undefined;
  readonly environmentId?: EnvironmentId | null | undefined;
  readonly threadId?: ThreadId | null | undefined;
  /** When false, syncs metadata without stealing focus from a tool tab in the same pane. */
  readonly activate?: boolean | undefined;
  /**
   * Optional unused draft/agent tab ID in the primary pane to bind/reuse in-place when syncing
   * a draft route target whose draftId does not yet match any existing tab.
   */
  readonly reuseUnusedDraftTabId?: string | null | undefined;
  /** Optional draft lookup override (defaults to live `useComposerDraftStore`). */
  readonly draftLookup?: WorkspaceDraftStateLookup | null | undefined;
}

export interface WorkspaceDraftStateLookup {
  readonly getDraftSession: (
    draftId: DraftId,
  ) => Pick<DraftSessionState, "promotedTo"> | null;
  readonly getComposerDraft: (draftId: DraftId) => ComposerThreadDraftState | null;
  readonly getPromotedDraftRedirect?: (draftId: DraftId) => ScopedThreadRef | null;
}

export interface PromoteDraftTabMetadata {
  readonly title?: string | undefined;
  readonly providerId?: string | null | undefined;
  readonly instanceId?: ProviderInstanceId | null | undefined;
  readonly model?: string | null | undefined;
}

export interface ReconcileDraftTabsInput {
  readonly activeRouteTarget?: ThreadRouteTarget | null | undefined;
  readonly lookup?: WorkspaceDraftStateLookup | null | undefined;
  readonly resolveThreadMetadata?: (threadRef: ScopedThreadRef) => PromoteDraftTabMetadata | null;
}

export interface WorkspaceTabsStateData {
  readonly layout: WorkspaceSplitLayoutNode;
  readonly panes: Readonly<Record<string, WorkspacePane>>;
  readonly tabs: Readonly<Record<string, WorkspaceTab>>;
  readonly focusedPaneId: string;
  readonly primaryPaneId: string;
  readonly terminalCounter: number;
}

export interface WorkspaceTabsStore extends WorkspaceTabsStateData {
  /** Transient non-persisted active Split Anything drag payload (excluded from `partialize`). */
  readonly activeDrag: SplitDragPayload | null;
  /** Transient non-persisted split-divider resize flag (excluded from `partialize`). */
  readonly isResizingSplit: boolean;
  setActiveDrag: (payload: SplitDragPayload | null) => void;
  setIsResizingSplit: (resizing: boolean) => void;
  syncRouteTarget: (input: SyncRouteTargetInput) => string | null;
  promoteDraftTab: (
    draftId: DraftId,
    threadRef: ScopedThreadRef,
    metadata?: PromoteDraftTabMetadata,
  ) => void;
  reconcileDraftTabs: (input?: ReconcileDraftTabsInput) => void;
  openTab: (input: OpenWorkspaceTabInput, targetPaneId?: string) => string;
  closeTab: (tabId: string, paneId?: string) => void;
  activateTab: (paneId: string, tabId: string) => void;
  focusPane: (paneId: string) => void;
  splitPane: (
    paneId: string,
    direction: SplitDirection,
    initialTab?: OpenWorkspaceTabInput,
    position?: SplitInsertPosition,
  ) => string | null;
  moveTabToNewSplit: (
    tabId: string,
    fromPaneId: string,
    direction: SplitDirection,
    position?: SplitInsertPosition,
  ) => string | null;
  moveTabToPane: (
    tabId: string,
    fromPaneId: string,
    toPaneId: string,
    insertIndex?: number,
  ) => void;
  dropItemIntoPane: (
    payload: SplitDragPayload,
    targetPaneId: string,
    zone: SplitDropZone,
    options?: { readonly fallbackHostThreadRef?: ScopedThreadRef | null | undefined },
  ) => { readonly paneId: string; readonly tabId: string } | null;
  reorderTab: (paneId: string, tabId: string, targetIndex: number) => void;
  closePane: (paneId: string, options?: { readonly mergeTabs?: boolean }) => void;
  setSplitRatio: (splitId: string, ratio: number) => void;
  resetSplitRatio: (splitId: string) => void;
  updateTab: (
    tabId: string,
    patch: Partial<
      Pick<
        WorkspaceTab,
        | "title"
        | "kind"
        | "providerId"
        | "instanceId"
        | "model"
        | "environmentId"
        | "threadId"
        | "draftId"
        | "url"
        | "shell"
        | "hostThreadRef"
        | "resourceId"
        | "pinned"
      >
    >,
  ) => void;
  pruneDuplicateDraftTabs: (options?: {
    readonly lookup?: WorkspaceDraftStateLookup | null | undefined;
    readonly keepTabId?: string | null | undefined;
  }) => void;
  resetWorkspace: () => void;
}

let uidSequence = 0;

function nextUid(prefix: string): string {
  uidSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidSequence.toString(36)}`;
}

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(WORKSPACE_MAX_SPLIT_RATIO, Math.max(WORKSPACE_MIN_SPLIT_RATIO, ratio));
}

export function countLeafPanes(node: WorkspaceSplitLayoutNode): number {
  if (node.type === "leaf") return 1;
  return countLeafPanes(node.first) + countLeafPanes(node.second);
}

export function listLeafPaneIds(node: WorkspaceSplitLayoutNode): string[] {
  if (node.type === "leaf") return [node.paneId];
  return [...listLeafPaneIds(node.first), ...listLeafPaneIds(node.second)];
}

export function findFirstLeafPaneId(node: WorkspaceSplitLayoutNode): string {
  if (node.type === "leaf") return node.paneId;
  return findFirstLeafPaneId(node.first);
}

export function splitLeafNode(
  node: WorkspaceSplitLayoutNode,
  targetPaneId: string,
  newPaneId: string,
  direction: SplitDirection,
  splitId: string,
  ratio = 0.5,
  position: SplitInsertPosition = "after",
): { readonly node: WorkspaceSplitLayoutNode; readonly replaced: boolean } {
  if (node.type === "leaf") {
    if (node.paneId !== targetPaneId) {
      return { node, replaced: false };
    }
    const newLeaf: WorkspaceSplitLayoutNode = { type: "leaf", paneId: newPaneId };
    return {
      node: {
        type: "split",
        id: splitId,
        direction,
        first: position === "before" ? newLeaf : node,
        second: position === "before" ? node : newLeaf,
        ratio: clampSplitRatio(ratio),
      },
      replaced: true,
    };
  }
  const firstResult = splitLeafNode(
    node.first,
    targetPaneId,
    newPaneId,
    direction,
    splitId,
    ratio,
    position,
  );
  if (firstResult.replaced) {
    return {
      node: { ...node, first: firstResult.node },
      replaced: true,
    };
  }
  const secondResult = splitLeafNode(
    node.second,
    targetPaneId,
    newPaneId,
    direction,
    splitId,
    ratio,
    position,
  );
  if (secondResult.replaced) {
    return {
      node: { ...node, second: secondResult.node },
      replaced: true,
    };
  }
  return { node, replaced: false };
}

/**
 * Removes a leaf pane from the split tree, promoting its sibling node in place.
 * Returns null if the root itself is that leaf (caller must keep at least 1 leaf).
 */
export function removeLeafNode(
  node: WorkspaceSplitLayoutNode,
  targetPaneId: string,
): WorkspaceSplitLayoutNode | null {
  if (node.type === "leaf") {
    return node.paneId === targetPaneId ? null : node;
  }
  if (node.first.type === "leaf" && node.first.paneId === targetPaneId) {
    return node.second;
  }
  if (node.second.type === "leaf" && node.second.paneId === targetPaneId) {
    return node.first;
  }
  const nextFirst = removeLeafNode(node.first, targetPaneId);
  if (nextFirst === null) {
    return node.second;
  }
  if (nextFirst !== node.first) {
    return { ...node, first: nextFirst };
  }
  const nextSecond = removeLeafNode(node.second, targetPaneId);
  if (nextSecond === null) {
    return node.first;
  }
  if (nextSecond !== node.second) {
    return { ...node, second: nextSecond };
  }
  return node;
}

export function updateSplitRatioInTree(
  node: WorkspaceSplitLayoutNode,
  splitId: string,
  ratio: number,
): WorkspaceSplitLayoutNode {
  if (node.type === "leaf") return node;
  if (node.id === splitId) {
    const nextRatio = clampSplitRatio(ratio);
    return nextRatio === node.ratio ? node : { ...node, ratio: nextRatio };
  }
  const nextFirst = updateSplitRatioInTree(node.first, splitId, ratio);
  const nextSecond = updateSplitRatioInTree(node.second, splitId, ratio);
  if (nextFirst === node.first && nextSecond === node.second) {
    return node;
  }
  return { ...node, first: nextFirst, second: nextSecond };
}

export function findTabPaneId(
  panes: Readonly<Record<string, WorkspacePane>>,
  tabId: string,
): string | null {
  for (const pane of Object.values(panes)) {
    if (pane.tabIds.includes(tabId)) {
      return pane.id;
    }
  }
  return null;
}

export function workspaceTabDedupeKey(
  tab: Pick<WorkspaceTab, "kind" | "environmentId" | "threadId" | "draftId" | "resourceId">,
): string | null {
  if (tab.kind === "thread" && tab.environmentId && tab.threadId) {
    return `thread:${scopedThreadKey({ environmentId: tab.environmentId, threadId: tab.threadId })}`;
  }
  if (tab.kind === "draft" && tab.draftId) {
    return `draft:${tab.draftId}`;
  }
  if (tab.kind === "diff") {
    return tab.environmentId && tab.threadId
      ? `diff:${scopedThreadKey({ environmentId: tab.environmentId, threadId: tab.threadId })}`
      : "diff:workspace";
  }
  if (tab.kind === "simulator") {
    return "simulator:workspace";
  }
  if (tab.kind === "terminal" && tab.resourceId) {
    return `terminal:${tab.resourceId}`;
  }
  if (tab.kind === "files") {
    return tab.resourceId ? `files:${tab.resourceId}` : "files:workspace";
  }
  if (tab.kind === "related") {
    return tab.resourceId ? `related:${tab.resourceId}` : "related:workspace";
  }
  if (tab.kind === "device") {
    return tab.resourceId ? `device:${tab.resourceId}` : "device:workspace";
  }
  if (tab.kind === "side-chat") {
    if (tab.environmentId && tab.threadId) {
      return `side-chat:${scopedThreadKey({ environmentId: tab.environmentId, threadId: tab.threadId })}`;
    }
    return tab.resourceId ? `side-chat:${tab.resourceId}` : "side-chat:workspace";
  }
  return null;
}

export function createInitialWorkspaceTabsState(): WorkspaceTabsStateData {
  return {
    layout: { type: "leaf", paneId: DEFAULT_PRIMARY_PANE_ID },
    panes: {
      [DEFAULT_PRIMARY_PANE_ID]: {
        id: DEFAULT_PRIMARY_PANE_ID,
        tabIds: [],
        activeTabId: null,
      },
    },
    tabs: {},
    focusedPaneId: DEFAULT_PRIMARY_PANE_ID,
    primaryPaneId: DEFAULT_PRIMARY_PANE_ID,
    terminalCounter: 0,
  };
}

export function getLiveComposerDraftStateLookup(): WorkspaceDraftStateLookup {
  const draftStore = useComposerDraftStore.getState();
  return {
    getDraftSession: draftStore.getDraftSession,
    getComposerDraft: draftStore.getComposerDraft,
    getPromotedDraftRedirect: draftStore.getPromotedDraftRedirect,
  };
}

function getSafeLiveComposerDraftStateLookup(): WorkspaceDraftStateLookup | null {
  try {
    return getLiveComposerDraftStateLookup();
  } catch {
    return null;
  }
}

/**
 * Pure predicate deciding whether a workspace tab is an unused blank new-conversation slot:
 * - Any `kind === "agent"` tab, OR
 * - Any `kind === "draft"` tab that has not been promoted to a server thread and whose
 *   composer draft contains no user-authored content (prompt/images/files/attachments/contexts).
 */
export function isUnusedDraftTab(
  tab: WorkspaceTab | null | undefined,
  lookup?: WorkspaceDraftStateLookup | null,
): boolean {
  if (!tab) return false;
  if (tab.kind === "agent") return true;
  if (tab.kind !== "draft") return false;
  if (!tab.draftId) return true;
  if (!lookup) return true;
  if (lookup.getPromotedDraftRedirect?.(tab.draftId)) {
    return false;
  }
  const draftSession = lookup.getDraftSession(tab.draftId);
  if (draftSession?.promotedTo) {
    return false;
  }
  const composerDraft = lookup.getComposerDraft(tab.draftId);
  return !composerDraftHasUserContent(composerDraft);
}

function pickPreferredUnusedDraftTab(
  unusedTabs: ReadonlyArray<WorkspaceTab>,
  activeTabId: string | null,
  lookup?: WorkspaceDraftStateLookup | null,
  preferredTabId?: string | null,
): WorkspaceTab | null {
  if (unusedTabs.length === 0) return null;

  if (preferredTabId) {
    const preferred = unusedTabs.find((tab) => tab.id === preferredTabId);
    if (preferred) return preferred;
  }

  if (activeTabId) {
    const activeUnused = unusedTabs.find((tab) => tab.id === activeTabId);
    if (activeUnused) return activeUnused;
  }

  if (lookup) {
    const liveUnused = unusedTabs.filter(
      (tab) =>
        tab.kind === "draft" &&
        tab.draftId != null &&
        lookup.getDraftSession(tab.draftId) !== null &&
        !lookup.getDraftSession(tab.draftId)?.promotedTo &&
        !lookup.getPromotedDraftRedirect?.(tab.draftId),
    );
    if (liveUnused.length > 0) {
      return liveUnused.reduce((best, candidate) =>
        candidate.lastActiveAt > best.lastActiveAt ? candidate : best,
      );
    }
  }

  return unusedTabs.reduce((best, candidate) => {
    if (candidate.lastActiveAt !== best.lastActiveAt) {
      return candidate.lastActiveAt > best.lastActiveAt ? candidate : best;
    }
    if (best.kind === "agent" && candidate.kind === "draft") {
      return candidate;
    }
    return best;
  });
}

export function findPrimaryUnusedDraftTab(
  state: Pick<WorkspaceTabsStateData, "layout" | "panes" | "tabs" | "primaryPaneId">,
  lookup?: WorkspaceDraftStateLookup | null,
  preferredTabId?: string | null,
): WorkspaceTab | null {
  const primaryPane =
    state.panes[state.primaryPaneId] ?? state.panes[findFirstLeafPaneId(state.layout)];
  if (!primaryPane) return null;

  const unusedTabs: WorkspaceTab[] = [];
  for (const tabId of primaryPane.tabIds) {
    const tab = state.tabs[tabId];
    if (tab && isUnusedDraftTab(tab, lookup)) {
      unusedTabs.push(tab);
    }
  }
  return pickPreferredUnusedDraftTab(unusedTabs, primaryPane.activeTabId, lookup, preferredTabId);
}

/**
 * Enforces the primary-pane singleton invariant: at most 1 unused blank draft/agent tab
 * may exist in `primaryPaneId`. Drafts with user-authored content and real server threads
 * are never touched.
 */
export function pruneDuplicateDraftTabsInState(
  state: WorkspaceTabsStateData,
  options?: {
    readonly lookup?: WorkspaceDraftStateLookup | null | undefined;
    readonly keepTabId?: string | null | undefined;
  },
): WorkspaceTabsStateData {
  const primaryPane =
    state.panes[state.primaryPaneId] ?? state.panes[findFirstLeafPaneId(state.layout)];
  if (!primaryPane) return state;

  const lookup = options?.lookup ?? null;
  const unusedTabs: WorkspaceTab[] = [];
  for (const tabId of primaryPane.tabIds) {
    const tab = state.tabs[tabId];
    if (tab && isUnusedDraftTab(tab, lookup)) {
      unusedTabs.push(tab);
    }
  }
  if (unusedTabs.length <= 1) {
    return state;
  }

  const keeper = pickPreferredUnusedDraftTab(
    unusedTabs,
    primaryPane.activeTabId,
    lookup,
    options?.keepTabId,
  );
  if (!keeper) return state;

  const removedIds = new Set(
    unusedTabs.filter((tab) => tab.id !== keeper.id).map((tab) => tab.id),
  );
  if (removedIds.size === 0) return state;

  const nextTabIds = primaryPane.tabIds.filter((id) => !removedIds.has(id));
  const nextTabs: Record<string, WorkspaceTab> = { ...state.tabs };
  for (const id of removedIds) {
    delete nextTabs[id];
  }
  const nextActiveTabId =
    primaryPane.activeTabId && removedIds.has(primaryPane.activeTabId)
      ? keeper.id
      : primaryPane.activeTabId;

  return {
    ...state,
    tabs: nextTabs,
    panes: {
      ...state.panes,
      [primaryPane.id]: {
        ...primaryPane,
        tabIds: nextTabIds,
        activeTabId: nextActiveTabId,
      },
    },
  };
}

export function sanitizePersistedWorkspaceTabsState(
  raw: Partial<WorkspaceTabsStateData> | undefined,
  lookup?: WorkspaceDraftStateLookup | null,
): WorkspaceTabsStateData {
  const initial = createInitialWorkspaceTabsState();
  if (!raw || !raw.layout || !raw.panes || !raw.tabs) {
    return initial;
  }

  const leafIds = listLeafPaneIds(raw.layout);
  if (leafIds.length === 0 || leafIds.length > WORKSPACE_MAX_SPLIT_PANES) {
    return initial;
  }

  const firstPaneId = leafIds[0]!;
  const resolvedPrimaryPaneId =
    raw.primaryPaneId && leafIds.includes(raw.primaryPaneId) ? raw.primaryPaneId : firstPaneId;
  const primaryPaneRawTabIds = new Set(raw.panes[resolvedPrimaryPaneId]?.tabIds ?? []);

  const cleanTabs: Record<string, WorkspaceTab> = {};
  for (const [id, tab] of Object.entries(raw.tabs)) {
    if (!tab || typeof tab !== "object" || typeof tab.id !== "string" || typeof tab.kind !== "string") {
      continue;
    }
    // Purge legacy unbacked "agent" tabs in the primary pane left over from retired blank-stage builds
    // so main workspace tabs always converge cleanly onto full ChatView drafts/threads.
    if (
      tab.kind === "agent" &&
      !tab.threadId &&
      !tab.draftId &&
      primaryPaneRawTabIds.has(id)
    ) {
      continue;
    }
    const needsUuidHeal =
      (tab.kind === "agent" || tab.kind === "draft") &&
      typeof tab.title === "string" &&
      containsUuidNoise(tab.title);
    cleanTabs[id] = needsUuidHeal
      ? {
          ...tab,
          title: formatAgentBrandName(tab.providerId ?? tab.instanceId ?? tab.title, tab.title),
        }
      : tab;
  }

  const cleanPanes: Record<string, WorkspacePane> = {};
  const referencedTabIds = new Set<string>();
  for (const paneId of leafIds) {
    const pane = raw.panes[paneId];
    const seenIds = new Set<string>();
    const keyToKeeperId = new Map<string, string>();
    const rawValidIds = (pane?.tabIds ?? []).filter((tabId) => {
      if (!Object.hasOwn(cleanTabs, tabId) || seenIds.has(tabId)) {
        return false;
      }
      seenIds.add(tabId);
      return true;
    });

    // Prefer the pane's active tab when deduplicating identical dedupe keys (e.g. duplicate draftId/threadId).
    const activeCandidateId = pane?.activeTabId ?? null;
    if (activeCandidateId && rawValidIds.includes(activeCandidateId)) {
      const activeTab = cleanTabs[activeCandidateId];
      const activeKey = activeTab ? workspaceTabDedupeKey(activeTab) : null;
      if (activeKey) {
        keyToKeeperId.set(activeKey, activeCandidateId);
      }
    }

    const validTabIds: string[] = [];
    for (const tabId of rawValidIds) {
      const tab = cleanTabs[tabId]!;
      const key = workspaceTabDedupeKey(tab);
      if (key) {
        const existingKeeper = keyToKeeperId.get(key);
        if (existingKeeper && existingKeeper !== tabId) {
          continue;
        }
        keyToKeeperId.set(key, tabId);
      }
      validTabIds.push(tabId);
      referencedTabIds.add(tabId);
    }

    const activeTabId =
      pane?.activeTabId && validTabIds.includes(pane.activeTabId)
        ? pane.activeTabId
        : (validTabIds[0] ?? null);
    cleanPanes[paneId] = {
      id: paneId,
      tabIds: validTabIds,
      activeTabId,
    };
  }

  for (const id of Object.keys(cleanTabs)) {
    if (!referencedTabIds.has(id)) {
      delete cleanTabs[id];
    }
  }

  const focusedPaneId =
    raw.focusedPaneId && Object.hasOwn(cleanPanes, raw.focusedPaneId)
      ? raw.focusedPaneId
      : firstPaneId;
  const primaryPaneId = Object.hasOwn(cleanPanes, resolvedPrimaryPaneId)
    ? resolvedPrimaryPaneId
    : firstPaneId;

  const baseState: WorkspaceTabsStateData = {
    layout: raw.layout,
    panes: cleanPanes,
    tabs: cleanTabs,
    focusedPaneId,
    primaryPaneId,
    terminalCounter:
      typeof raw.terminalCounter === "number" && Number.isFinite(raw.terminalCounter)
        ? Math.max(0, Math.floor(raw.terminalCounter))
        : 0,
  };

  return pruneDuplicateDraftTabsInState(baseState, { lookup });
}

export const sanitizeRehydratedState = sanitizePersistedWorkspaceTabsState;

function findMatchingTabInState(
  state: WorkspaceTabsStateData,
  input: Pick<OpenWorkspaceTabInput, "kind" | "environmentId" | "threadId" | "draftId" | "resourceId">,
  preferredPaneId?: string,
): { readonly tab: WorkspaceTab; readonly paneId: string } | null {
  const dedupeKey = workspaceTabDedupeKey(input);
  if (!dedupeKey) return null;

  if (preferredPaneId && state.panes[preferredPaneId]) {
    for (const tabId of state.panes[preferredPaneId]!.tabIds) {
      const candidate = state.tabs[tabId];
      if (candidate && workspaceTabDedupeKey(candidate) === dedupeKey) {
        return { tab: candidate, paneId: preferredPaneId };
      }
    }
  }

  for (const pane of Object.values(state.panes)) {
    for (const tabId of pane.tabIds) {
      const candidate = state.tabs[tabId];
      if (candidate && workspaceTabDedupeKey(candidate) === dedupeKey) {
        return { tab: candidate, paneId: pane.id };
      }
    }
  }
  return null;
}

function collapsePaneInState(
  state: WorkspaceTabsStateData,
  paneIdToRemove: string,
  mergeTabs: boolean,
): WorkspaceTabsStateData {
  if (countLeafPanes(state.layout) <= 1) {
    return state;
  }
  const removedPane = state.panes[paneIdToRemove];
  if (!removedPane) return state;

  const nextLayout = removeLeafNode(state.layout, paneIdToRemove);
  if (!nextLayout) return state;

  const remainingPaneIds = listLeafPaneIds(nextLayout);
  const fallbackPaneId =
    remainingPaneIds.find((id) => id === state.primaryPaneId) ??
    remainingPaneIds.find((id) => id === state.focusedPaneId) ??
    remainingPaneIds[0]!;

  const nextPanes: Record<string, WorkspacePane> = {};
  for (const id of remainingPaneIds) {
    const existing = state.panes[id];
    if (existing) {
      nextPanes[id] = existing;
    }
  }

  const nextTabs: Record<string, WorkspaceTab> = { ...state.tabs };
  const targetPane = nextPanes[fallbackPaneId]!;
  const existingKeys = new Set(
    targetPane.tabIds
      .map((id) => nextTabs[id])
      .filter((t): t is WorkspaceTab => Boolean(t))
      .map((t) => workspaceTabDedupeKey(t))
      .filter((k): k is string => k !== null),
  );

  const mergedTabIds = [...targetPane.tabIds];
  for (const tabId of removedPane.tabIds) {
    const tab = nextTabs[tabId];
    if (!tab) continue;
    const key = workspaceTabDedupeKey(tab);
    const shouldMerge =
      mergeTabs &&
      !(tab.kind === "agent" && !tab.threadId && !tab.draftId) &&
      (key === null || !existingKeys.has(key));
    if (shouldMerge) {
      mergedTabIds.push(tabId);
      if (key) existingKeys.add(key);
    } else {
      delete nextTabs[tabId];
    }
  }

  nextPanes[fallbackPaneId] = {
    ...targetPane,
    tabIds: mergedTabIds,
    activeTabId: targetPane.activeTabId ?? mergedTabIds[0] ?? null,
  };

  const collapsed: WorkspaceTabsStateData = {
    ...state,
    layout: nextLayout,
    panes: nextPanes,
    tabs: nextTabs,
    focusedPaneId:
      state.focusedPaneId === paneIdToRemove ? fallbackPaneId : state.focusedPaneId,
    primaryPaneId:
      state.primaryPaneId === paneIdToRemove ? fallbackPaneId : state.primaryPaneId,
  };

  return fallbackPaneId === collapsed.primaryPaneId
    ? pruneDuplicateDraftTabsInState(collapsed, {
        lookup: getSafeLiveComposerDraftStateLookup(),
      })
    : collapsed;
}

function matchesScopedThreadRef(
  candidate: ScopedThreadRef | null | undefined,
  target: ScopedThreadRef,
): boolean {
  return (
    candidate != null &&
    candidate.environmentId === target.environmentId &&
    candidate.threadId === target.threadId
  );
}

function resolveDraftTabPromotedTarget(
  tab: WorkspaceTab,
  lookup?: WorkspaceDraftStateLookup | null,
): ScopedThreadRef | null {
  if (tab.kind !== "draft" || !tab.draftId || !lookup) {
    return null;
  }
  return (
    lookup.getPromotedDraftRedirect?.(tab.draftId) ??
    lookup.getDraftSession(tab.draftId)?.promotedTo ??
    null
  );
}

function draftTabMatchesServerThreadRef(
  tab: WorkspaceTab,
  threadRef: ScopedThreadRef,
  lookup?: WorkspaceDraftStateLookup | null,
): boolean {
  if (tab.kind !== "draft") return false;
  if (tab.environmentId === threadRef.environmentId && tab.threadId === threadRef.threadId) {
    return true;
  }
  return matchesScopedThreadRef(resolveDraftTabPromotedTarget(tab, lookup), threadRef);
}

function findMatchingDraftTabForServerRef(
  state: WorkspaceTabsStateData,
  threadRef: ScopedThreadRef,
  preferredPaneId?: string,
  lookup?: WorkspaceDraftStateLookup | null,
): { readonly tab: WorkspaceTab; readonly paneId: string } | null {
  if (preferredPaneId && state.panes[preferredPaneId]) {
    for (const tabId of state.panes[preferredPaneId]!.tabIds) {
      const candidate = state.tabs[tabId];
      if (candidate && draftTabMatchesServerThreadRef(candidate, threadRef, lookup)) {
        return { tab: candidate, paneId: preferredPaneId };
      }
    }
  }
  for (const pane of Object.values(state.panes)) {
    if (pane.id === preferredPaneId) continue;
    for (const tabId of pane.tabIds) {
      const candidate = state.tabs[tabId];
      if (candidate && draftTabMatchesServerThreadRef(candidate, threadRef, lookup)) {
        return { tab: candidate, paneId: pane.id };
      }
    }
  }
  return null;
}

function removeDuplicateDraftTabsForServerRefInState(
  state: WorkspaceTabsStateData,
  keepTabId: string,
  threadRef: ScopedThreadRef,
  lookup?: WorkspaceDraftStateLookup | null,
): WorkspaceTabsStateData {
  const duplicateIds = new Set<string>();
  for (const tab of Object.values(state.tabs)) {
    if (tab.id === keepTabId) continue;
    if (draftTabMatchesServerThreadRef(tab, threadRef, lookup)) {
      duplicateIds.add(tab.id);
    }
  }
  if (duplicateIds.size === 0) return state;

  const nextTabs: Record<string, WorkspaceTab> = { ...state.tabs };
  for (const id of duplicateIds) {
    delete nextTabs[id];
  }
  const nextPanes: Record<string, WorkspacePane> = { ...state.panes };
  for (const [paneId, pane] of Object.entries(state.panes)) {
    if (!pane.tabIds.some((id) => duplicateIds.has(id))) continue;
    const nextTabIds = pane.tabIds.filter((id) => !duplicateIds.has(id));
    const nextActiveTabId =
      pane.activeTabId && duplicateIds.has(pane.activeTabId)
        ? nextTabIds.includes(keepTabId)
          ? keepTabId
          : (nextTabIds[0] ?? null)
        : pane.activeTabId;
    nextPanes[paneId] = {
      ...pane,
      tabIds: nextTabIds,
      activeTabId: nextActiveTabId,
    };
  }
  return {
    ...state,
    tabs: nextTabs,
    panes: nextPanes,
  };
}

export function promoteDraftTabInState(
  state: WorkspaceTabsStateData,
  draftId: DraftId,
  threadRef: ScopedThreadRef,
  metadata?: PromoteDraftTabMetadata,
): WorkspaceTabsStateData {
  const draftTab = Object.values(state.tabs).find(
    (tab) => tab.kind === "draft" && tab.draftId === draftId,
  );
  if (!draftTab) return state;

  const promotedKey = workspaceTabDedupeKey({
    kind: "thread",
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
  });
  const duplicateServerTab = Object.values(state.tabs).find(
    (tab) => tab.id !== draftTab.id && workspaceTabDedupeKey(tab) === promotedKey,
  );

  const nextProviderId =
    metadata?.providerId !== undefined ? metadata.providerId : draftTab.providerId;
  const nextInstanceId =
    metadata?.instanceId !== undefined ? metadata.instanceId : draftTab.instanceId;
  const providerChanged =
    nextProviderId !== draftTab.providerId || nextInstanceId !== draftTab.instanceId;
  const nextModel =
    metadata?.model !== undefined
      ? metadata.model
      : providerChanged
        ? null
        : draftTab.model;

  if (duplicateServerTab) {
    // Merge into existing server tab (preserving harness metadata) and remove the stale draft tab.
    const paneId = findTabPaneId(state.panes, draftTab.id);
    const nextTabs = { ...state.tabs };
    delete nextTabs[draftTab.id];

    const mergedTitle = metadata?.title?.trim() || duplicateServerTab.title;
    const mergedProviderId =
      metadata?.providerId !== undefined
        ? metadata.providerId
        : (duplicateServerTab.providerId ?? draftTab.providerId);
    const mergedInstanceId =
      metadata?.instanceId !== undefined
        ? metadata.instanceId
        : (duplicateServerTab.instanceId ?? draftTab.instanceId);
    const mergedProviderChanged =
      mergedProviderId !== duplicateServerTab.providerId ||
      mergedInstanceId !== duplicateServerTab.instanceId;
    const mergedModel =
      metadata?.model !== undefined
        ? metadata.model
        : mergedProviderChanged
          ? (draftTab.model ?? null)
          : (duplicateServerTab.model ?? draftTab.model);

    nextTabs[duplicateServerTab.id] = {
      ...duplicateServerTab,
      title: mergedTitle,
      providerId: mergedProviderId,
      instanceId: mergedInstanceId,
      model: mergedModel,
    };

    if (!paneId) return { ...state, tabs: nextTabs };
    const pane = state.panes[paneId]!;
    const nextTabIds = pane.tabIds.filter((id) => id !== draftTab.id);
    return {
      ...state,
      tabs: nextTabs,
      panes: {
        ...state.panes,
        [paneId]: {
          ...pane,
          tabIds: nextTabIds,
          activeTabId:
            pane.activeTabId === draftTab.id
              ? duplicateServerTab.id in nextTabs && nextTabIds.includes(duplicateServerTab.id)
                ? duplicateServerTab.id
                : (nextTabIds[0] ?? null)
              : pane.activeTabId,
        },
      },
    };
  }

  return {
    ...state,
    tabs: {
      ...state.tabs,
      [draftTab.id]: {
        ...draftTab,
        kind: "thread",
        draftId: null,
        environmentId: threadRef.environmentId,
        threadId: threadRef.threadId,
        title: metadata?.title?.trim() || draftTab.title,
        providerId: nextProviderId,
        instanceId: nextInstanceId,
        model: nextModel,
      },
    },
  };
}

/**
 * Reconciles all open draft tabs against live composerDraftStore state:
 * 1. Immediately promotes/merges any `draft` tab whose draftId already promoted (`promotedTo` or
 *    `promotedDraftRedirect`), preventing zombie `"新会话"` tabs from lingering until clicked.
 * 2. Prunes non-active orphan `draft` tabs whose draft session no longer exists and contains no
 *    user-authored composer content (e.g. after a send failure or cleared draft).
 * 3. Enforces the primary-pane single unused draft tab invariant.
 */
export function reconcileDraftTabsInState(
  state: WorkspaceTabsStateData,
  input?: ReconcileDraftTabsInput,
): WorkspaceTabsStateData {
  const lookup = input?.lookup ?? null;
  const activeRouteTarget = input?.activeRouteTarget ?? null;
  let nextState = state;

  // Pass 1: Auto-promote / merge any draft tab that already promoted to a server thread.
  if (lookup) {
    const promotedCandidates: Array<{
      readonly draftId: DraftId;
      readonly promotedTo: ScopedThreadRef;
    }> = [];
    for (const tab of Object.values(nextState.tabs)) {
      if (tab.kind !== "draft" || !tab.draftId) continue;
      const promotedTo = resolveDraftTabPromotedTarget(tab, lookup);
      if (promotedTo) {
        promotedCandidates.push({ draftId: tab.draftId, promotedTo });
      }
    }
    for (const candidate of promotedCandidates) {
      const metadata = input?.resolveThreadMetadata?.(candidate.promotedTo) ?? undefined;
      nextState = promoteDraftTabInState(
        nextState,
        candidate.draftId,
        candidate.promotedTo,
        metadata,
      );
    }
  }

  // Pass 2: Prune non-active orphan draft tabs whose draft session disappeared and have no content.
  if (lookup) {
    const orphanIds = new Set<string>();
    for (const pane of Object.values(nextState.panes)) {
      for (const tabId of pane.tabIds) {
        const tab = nextState.tabs[tabId];
        if (!tab || tab.kind !== "draft") continue;
        const isActiveInPane = pane.activeTabId === tab.id;
        const isActiveRouteDraft =
          activeRouteTarget?.kind === "draft" &&
          tab.draftId != null &&
          activeRouteTarget.draftId === tab.draftId;
        if (isActiveInPane || isActiveRouteDraft) continue;

        if (!tab.draftId) {
          orphanIds.add(tab.id);
          continue;
        }
        const session = lookup.getDraftSession(tab.draftId);
        if (session !== null) continue;
        const composerDraft = lookup.getComposerDraft(tab.draftId);
        if (!composerDraftHasUserContent(composerDraft)) {
          orphanIds.add(tab.id);
        }
      }
    }

    if (orphanIds.size > 0) {
      const nextTabs: Record<string, WorkspaceTab> = { ...nextState.tabs };
      for (const id of orphanIds) {
        delete nextTabs[id];
      }
      const nextPanes: Record<string, WorkspacePane> = { ...nextState.panes };
      for (const [paneId, pane] of Object.entries(nextState.panes)) {
        if (!pane.tabIds.some((id) => orphanIds.has(id))) continue;
        const nextTabIds = pane.tabIds.filter((id) => !orphanIds.has(id));
        const nextActiveTabId =
          pane.activeTabId && orphanIds.has(pane.activeTabId)
            ? (nextTabIds[0] ?? null)
            : pane.activeTabId;
        nextPanes[paneId] = {
          ...pane,
          tabIds: nextTabIds,
          activeTabId: nextActiveTabId,
        };
      }
      nextState = {
        ...nextState,
        tabs: nextTabs,
        panes: nextPanes,
      };
    }
  }

  // Pass 3: Collapse any duplicate blank draft tabs in primary pane.
  return pruneDuplicateDraftTabsInState(nextState, { lookup });
}

export const useWorkspaceTabsStore = create<WorkspaceTabsStore>()(
  persist(
    (set, get) => ({
      ...createInitialWorkspaceTabsState(),
      activeDrag: null,
      isResizingSplit: false,

      setActiveDrag(payload) {
        set((current) => (current.activeDrag === payload ? current : { activeDrag: payload }));
      },

      setIsResizingSplit(resizing) {
        set((current) =>
          current.isResizingSplit === resizing ? current : { isResizingSplit: resizing },
        );
      },

      syncRouteTarget(input) {
        const { target } = input;
        if (!target) return null;
        const now = Date.now();
        const draftLookup =
          input.draftLookup !== undefined
            ? input.draftLookup
            : getSafeLiveComposerDraftStateLookup();

        const lookupInput =
          target.kind === "server"
            ? {
                kind: "thread" as const,
                environmentId: target.threadRef.environmentId,
                threadId: target.threadRef.threadId,
              }
            : {
                kind: "draft" as const,
                draftId: target.draftId,
              };

        let resultTabId: string | null = null;
        set((current) => {
          const primaryPane =
            current.panes[current.primaryPaneId] ??
            current.panes[findFirstLeafPaneId(current.layout)]!;
          const primaryPaneId = primaryPane.id;

          const existing = findMatchingTabInState(current, lookupInput, primaryPaneId);
          if (existing) {
            resultTabId = existing.tab.id;
            const prevTab = existing.tab;
            const nextTitle = input.title?.trim() || prevTab.title;
            const nextProviderId =
              input.providerId !== undefined ? input.providerId : prevTab.providerId;
            const nextInstanceId =
              input.instanceId !== undefined ? input.instanceId : prevTab.instanceId;
            const providerChanged =
              nextProviderId !== prevTab.providerId || nextInstanceId !== prevTab.instanceId;
            const nextModel =
              input.model !== undefined
                ? input.model
                : providerChanged
                  ? null
                  : prevTab.model;
            const nextEnvId =
              input.environmentId !== undefined ? input.environmentId : prevTab.environmentId;
            const nextThreadId =
              input.threadId !== undefined ? input.threadId : prevTab.threadId;

            const metadataChanged =
              nextTitle !== prevTab.title ||
              nextProviderId !== prevTab.providerId ||
              nextInstanceId !== prevTab.instanceId ||
              nextModel !== prevTab.model ||
              nextEnvId !== prevTab.environmentId ||
              nextThreadId !== prevTab.threadId;

            const shouldActivate = input.activate !== false;
            const targetPane = current.panes[existing.paneId]!;
            const needsActivation =
              shouldActivate &&
              (targetPane.activeTabId !== prevTab.id || current.focusedPaneId !== existing.paneId);

            const baseUpdated: WorkspaceTabsStateData =
              !metadataChanged && !needsActivation
                ? current
                : {
                    ...current,
                    ...(shouldActivate ? { focusedPaneId: existing.paneId } : {}),
                    tabs: {
                      ...current.tabs,
                      [prevTab.id]: {
                        ...prevTab,
                        title: nextTitle,
                        providerId: nextProviderId,
                        instanceId: nextInstanceId,
                        model: nextModel,
                        environmentId: nextEnvId,
                        threadId: nextThreadId,
                        lastActiveAt: shouldActivate ? now : prevTab.lastActiveAt,
                      },
                    },
                    panes: shouldActivate
                      ? {
                          ...current.panes,
                          [existing.paneId]: {
                            ...targetPane,
                            activeTabId: prevTab.id,
                          },
                        }
                      : current.panes,
                  };

            if (target.kind === "server") {
              return removeDuplicateDraftTabsForServerRefInState(
                baseUpdated,
                prevTab.id,
                target.threadRef,
                draftLookup,
              );
            }

            return existing.paneId === primaryPaneId && target.kind === "draft"
              ? pruneDuplicateDraftTabsInState(baseUpdated, {
                  lookup: draftLookup,
                  keepTabId: prevTab.id,
                })
              : baseUpdated;
          }

          // Before creating a brand-new server thread tab, promote any existing draft tab whose
          // thread coordinates or promoted redirect already point to this server thread in-place!
          if (target.kind === "server") {
            const matchingDraft = findMatchingDraftTabForServerRef(
              current,
              target.threadRef,
              primaryPaneId,
              draftLookup,
            );
            if (matchingDraft) {
              const draftTab = matchingDraft.tab;
              resultTabId = draftTab.id;
              const targetPane = current.panes[matchingDraft.paneId]!;
              const shouldActivate = input.activate !== false || targetPane.activeTabId === null;
              const nextTitle = input.title?.trim() || draftTab.title;
              const nextProviderId =
                input.providerId !== undefined ? input.providerId : draftTab.providerId;
              const nextInstanceId =
                input.instanceId !== undefined ? input.instanceId : draftTab.instanceId;
              const providerChanged =
                nextProviderId !== draftTab.providerId || nextInstanceId !== draftTab.instanceId;
              const nextModel =
                input.model !== undefined
                  ? input.model
                  : providerChanged
                    ? null
                    : draftTab.model;

              const promotedState: WorkspaceTabsStateData = {
                ...current,
                tabs: {
                  ...current.tabs,
                  [draftTab.id]: {
                    ...draftTab,
                    kind: "thread",
                    draftId: null,
                    environmentId: target.threadRef.environmentId,
                    threadId: target.threadRef.threadId,
                    title: nextTitle,
                    providerId: nextProviderId,
                    instanceId: nextInstanceId,
                    model: nextModel,
                    lastActiveAt: shouldActivate ? now : draftTab.lastActiveAt,
                  },
                },
                panes: shouldActivate
                  ? {
                      ...current.panes,
                      [matchingDraft.paneId]: {
                        ...targetPane,
                        activeTabId: draftTab.id,
                      },
                    }
                  : current.panes,
              };

              return removeDuplicateDraftTabsForServerRefInState(
                promotedState,
                draftTab.id,
                target.threadRef,
                draftLookup,
              );
            }
          }

          if (target.kind === "draft") {
            const reusableTab = findPrimaryUnusedDraftTab(
              current,
              draftLookup,
              input.reuseUnusedDraftTabId,
            );
            if (reusableTab) {
              resultTabId = reusableTab.id;
              const shouldActivate = input.activate !== false || primaryPane.activeTabId === null;
              const nextProviderId =
                input.providerId !== undefined ? input.providerId : reusableTab.providerId;
              const nextInstanceId =
                input.instanceId !== undefined ? input.instanceId : reusableTab.instanceId;
              const providerChanged =
                nextProviderId !== reusableTab.providerId ||
                nextInstanceId !== reusableTab.instanceId;
              const nextModel =
                input.model !== undefined
                  ? input.model
                  : providerChanged
                    ? null
                    : reusableTab.model;

              const updatedState: WorkspaceTabsStateData = {
                ...current,
                tabs: {
                  ...current.tabs,
                  [reusableTab.id]: {
                    ...reusableTab,
                    kind: "draft",
                    draftId: target.draftId,
                    environmentId: input.environmentId !== undefined ? input.environmentId : null,
                    threadId: input.threadId !== undefined ? input.threadId : null,
                    providerId: nextProviderId,
                    instanceId: nextInstanceId,
                    model: nextModel,
                    title: input.title?.trim() || reusableTab.title || "新会话",
                    lastActiveAt: shouldActivate ? now : reusableTab.lastActiveAt,
                  },
                },
                panes: shouldActivate
                  ? {
                      ...current.panes,
                      [primaryPaneId]: {
                        ...primaryPane,
                        activeTabId: reusableTab.id,
                      },
                    }
                  : current.panes,
              };

              return pruneDuplicateDraftTabsInState(updatedState, {
                lookup: draftLookup,
                keepTabId: reusableTab.id,
              });
            }
          }

          const newTabId = nextUid("tab");
          resultTabId = newTabId;
          const shouldActivate = input.activate !== false || primaryPane.activeTabId === null;
          const newTab: WorkspaceTab = {
            id: newTabId,
            kind: target.kind === "server" ? "thread" : "draft",
            title: input.title?.trim() || (target.kind === "draft" ? "新会话" : "会话"),
            providerId: input.providerId ?? null,
            instanceId: input.instanceId ?? null,
            model: input.model ?? null,
            environmentId:
              target.kind === "server"
                ? target.threadRef.environmentId
                : (input.environmentId ?? null),
            threadId:
              target.kind === "server" ? target.threadRef.threadId : (input.threadId ?? null),
            draftId: target.kind === "draft" ? target.draftId : null,
            createdAt: now,
            lastActiveAt: now,
          };

          return {
            ...current,
            tabs: {
              ...current.tabs,
              [newTabId]: newTab,
            },
            panes: {
              ...current.panes,
              [primaryPaneId]: {
                ...primaryPane,
                tabIds: [...primaryPane.tabIds, newTabId],
                activeTabId: shouldActivate ? newTabId : primaryPane.activeTabId,
              },
            },
          };
        });
        return resultTabId;
      },

      promoteDraftTab(draftId, threadRef, metadata) {
        set((current) => promoteDraftTabInState(current, draftId, threadRef, metadata));
      },

      reconcileDraftTabs(input) {
        const lookup =
          input?.lookup !== undefined ? input.lookup : getSafeLiveComposerDraftStateLookup();
        set((current) =>
          reconcileDraftTabsInState(current, {
            ...input,
            lookup,
          }),
        );
      },

      openTab(input, requestedPaneId) {
        const now = Date.now();
        const draftLookup = getSafeLiveComposerDraftStateLookup();
        let resultTabId = "";

        set((current) => {
          const resolvedPaneId =
            requestedPaneId && current.panes[requestedPaneId]
              ? requestedPaneId
              : current.panes[current.focusedPaneId]
                ? current.focusedPaneId
                : findFirstLeafPaneId(current.layout);

          const isPrimaryPane = resolvedPaneId === current.primaryPaneId;
          const reuseExisting =
            input.reuseExisting ??
            (input.kind === "thread" ||
              input.kind === "draft" ||
              input.kind === "diff" ||
              input.kind === "simulator" ||
              (input.kind === "agent" && isPrimaryPane));

          if (reuseExisting) {
            const existing = findMatchingTabInState(current, input, resolvedPaneId);
            if (existing) {
              resultTabId = existing.tab.id;
              const targetPane = current.panes[existing.paneId];
              const existingTab = current.tabs[existing.tab.id];
              if (!targetPane || !existingTab) return current;
              const nextProviderId =
                input.providerId !== undefined ? input.providerId : existingTab.providerId;
              const nextInstanceId =
                input.instanceId !== undefined ? input.instanceId : existingTab.instanceId;
              const providerChanged =
                nextProviderId !== existingTab.providerId ||
                nextInstanceId !== existingTab.instanceId;
              const nextModel =
                input.model !== undefined
                  ? input.model
                  : providerChanged
                    ? null
                    : existingTab.model;
              const updatedState: WorkspaceTabsStateData = {
                ...current,
                focusedPaneId: existing.paneId,
                tabs: {
                  ...current.tabs,
                  [existing.tab.id]: {
                    ...existingTab,
                    title: input.title.trim() || existingTab.title,
                    providerId: nextProviderId,
                    instanceId: nextInstanceId,
                    model: nextModel,
                    ...(input.environmentId !== undefined
                      ? { environmentId: input.environmentId }
                      : {}),
                    ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
                    ...(input.draftId !== undefined ? { draftId: input.draftId } : {}),
                    ...(input.url !== undefined ? { url: input.url } : {}),
                    ...(input.hostThreadRef !== undefined
                      ? { hostThreadRef: input.hostThreadRef }
                      : {}),
                    lastActiveAt: now,
                  },
                },
                panes: {
                  ...current.panes,
                  [existing.paneId]: {
                    ...targetPane,
                    activeTabId: existing.tab.id,
                  },
                },
              };
              return existing.paneId === current.primaryPaneId && existingTab.kind === "draft"
                ? pruneDuplicateDraftTabsInState(updatedState, {
                    lookup: draftLookup,
                    keepTabId: existing.tab.id,
                  })
                : updatedState;
            }

            if (isPrimaryPane && (input.kind === "draft" || input.kind === "agent")) {
              const reusableTab = findPrimaryUnusedDraftTab(
                current,
                draftLookup,
                input.reuseUnusedDraftTabId,
              );
              if (reusableTab) {
                resultTabId = reusableTab.id;
                const targetPane =
                  current.panes[resolvedPaneId] ??
                  current.panes[findFirstLeafPaneId(current.layout)]!;
                const nextProviderId =
                  input.providerId !== undefined ? input.providerId : reusableTab.providerId;
                const nextInstanceId =
                  input.instanceId !== undefined ? input.instanceId : reusableTab.instanceId;
                const providerChanged =
                  nextProviderId !== reusableTab.providerId ||
                  nextInstanceId !== reusableTab.instanceId;
                const nextModel =
                  input.model !== undefined
                    ? input.model
                    : providerChanged
                      ? null
                      : reusableTab.model;

                const updatedState: WorkspaceTabsStateData = {
                  ...current,
                  focusedPaneId: targetPane.id,
                  tabs: {
                    ...current.tabs,
                    [reusableTab.id]: {
                      ...reusableTab,
                      kind: input.kind,
                      title: input.title.trim() || reusableTab.title || "新会话",
                      providerId: nextProviderId,
                      instanceId: nextInstanceId,
                      model: nextModel,
                      environmentId:
                        input.environmentId !== undefined
                          ? input.environmentId
                          : (input.hostThreadRef?.environmentId ?? null),
                      threadId:
                        input.threadId !== undefined
                          ? input.threadId
                          : (input.hostThreadRef?.threadId ?? null),
                      draftId: input.draftId !== undefined ? input.draftId : null,
                      ...(input.url !== undefined ? { url: input.url } : {}),
                      ...(input.hostThreadRef !== undefined
                        ? { hostThreadRef: input.hostThreadRef }
                        : {}),
                      lastActiveAt: now,
                    },
                  },
                  panes: {
                    ...current.panes,
                    [targetPane.id]: {
                      ...targetPane,
                      activeTabId: reusableTab.id,
                    },
                  },
                };
                return pruneDuplicateDraftTabsInState(updatedState, {
                  lookup: draftLookup,
                  keepTabId: reusableTab.id,
                });
              }
            }
          }

          let nextTerminalCounter = current.terminalCounter;
          let title = input.title.trim();
          let resourceId = input.resourceId ?? null;
          if (input.kind === "terminal") {
            nextTerminalCounter += 1;
            if (!title) {
              title = `Terminal ${nextTerminalCounter}`;
            }
            if (!resourceId) {
              resourceId = `ws-term-${nextTerminalCounter}`;
            }
          }

          const tabId = nextUid("tab");
          resultTabId = tabId;
          const tab: WorkspaceTab = {
            id: tabId,
            kind: input.kind,
            title: title || "新标签页",
            providerId: input.providerId ?? null,
            instanceId: input.instanceId ?? null,
            model: input.model ?? null,
            environmentId: input.environmentId ?? input.hostThreadRef?.environmentId ?? null,
            threadId: input.threadId ?? input.hostThreadRef?.threadId ?? null,
            draftId: input.draftId ?? null,
            url: input.url ?? null,
            shell: input.shell ?? null,
            hostThreadRef: input.hostThreadRef ?? null,
            resourceId,
            pinned: input.pinned ?? false,
            createdAt: now,
            lastActiveAt: now,
          };

          const pane =
            current.panes[resolvedPaneId] ??
            current.panes[findFirstLeafPaneId(current.layout)]!;
          return {
            ...current,
            terminalCounter: nextTerminalCounter,
            focusedPaneId: pane.id,
            tabs: {
              ...current.tabs,
              [tabId]: tab,
            },
            panes: {
              ...current.panes,
              [pane.id]: {
                ...pane,
                tabIds: [...pane.tabIds, tabId],
                activeTabId: tabId,
              },
            },
          };
        });
        return resultTabId;
      },

      closeTab(tabId, explicitPaneId) {
        set((current) => {
          const paneId = explicitPaneId ?? findTabPaneId(current.panes, tabId);
          if (!paneId) return current;
          const pane = current.panes[paneId];
          if (!pane) return current;
          const idx = pane.tabIds.indexOf(tabId);
          if (idx === -1) return current;

          const nextTabIds = pane.tabIds.filter((id) => id !== tabId);
          const nextTabs = { ...current.tabs };
          delete nextTabs[tabId];

          let nextActiveTabId = pane.activeTabId;
          if (pane.activeTabId === tabId) {
            nextActiveTabId = nextTabIds[Math.min(idx, nextTabIds.length - 1)] ?? null;
          }

          const updatedState: WorkspaceTabsStateData = {
            ...current,
            tabs: nextTabs,
            panes: {
              ...current.panes,
              [paneId]: {
                ...pane,
                tabIds: nextTabIds,
                activeTabId: nextActiveTabId,
              },
            },
          };

          // Auto-collapse empty split pane when > 1 pane exists (Orca/VS Code behavior).
          if (nextTabIds.length === 0 && countLeafPanes(updatedState.layout) > 1) {
            return collapsePaneInState(updatedState, paneId, false);
          }
          return updatedState;
        });
      },

      activateTab(paneId, tabId) {
        const now = Date.now();
        set((current) => {
          const pane = current.panes[paneId];
          const tab = current.tabs[tabId];
          if (!pane || !tab || !pane.tabIds.includes(tabId)) return current;
          return {
            ...current,
            focusedPaneId: paneId,
            tabs: {
              ...current.tabs,
              [tabId]: {
                ...tab,
                lastActiveAt: now,
              },
            },
            panes: {
              ...current.panes,
              [paneId]: {
                ...pane,
                activeTabId: tabId,
              },
            },
          };
        });
      },

      focusPane(paneId) {
        set((current) => {
          if (!current.panes[paneId] || current.focusedPaneId === paneId) return current;
          return { ...current, focusedPaneId: paneId };
        });
      },

      splitPane(paneId, direction, initialTab, position = "after") {
        const state = get();
        if (!state.panes[paneId]) return null;
        if (countLeafPanes(state.layout) >= WORKSPACE_MAX_SPLIT_PANES) {
          return null;
        }

        const newPaneId = nextUid("pane");
        const splitId = nextUid("split");
        const { node: nextLayout, replaced } = splitLeafNode(
          state.layout,
          paneId,
          newPaneId,
          direction,
          splitId,
          0.5,
          position,
        );
        if (!replaced) return null;

        const now = Date.now();
        let nextTerminalCounter = state.terminalCounter;
        const newTabId = nextUid("tab");

        const seedTab: WorkspaceTab = initialTab
          ? (() => {
              let title = initialTab.title.trim();
              let resourceId = initialTab.resourceId ?? null;
              if (initialTab.kind === "terminal") {
                nextTerminalCounter += 1;
                if (!title) title = `Terminal ${nextTerminalCounter}`;
                if (!resourceId) resourceId = `ws-term-${nextTerminalCounter}`;
              }
              return {
                id: newTabId,
                kind: initialTab.kind,
                title: title || "新标签页",
                providerId: initialTab.providerId ?? null,
                instanceId: initialTab.instanceId ?? null,
                model: initialTab.model ?? null,
                environmentId:
                  initialTab.environmentId ?? initialTab.hostThreadRef?.environmentId ?? null,
                threadId: initialTab.threadId ?? initialTab.hostThreadRef?.threadId ?? null,
                draftId: initialTab.draftId ?? null,
                url: initialTab.url ?? null,
                shell: initialTab.shell ?? null,
                hostThreadRef: initialTab.hostThreadRef ?? null,
                resourceId,
                pinned: initialTab.pinned ?? false,
                createdAt: now,
                lastActiveAt: now,
              };
            })()
          : (() => {
              const sourcePane = state.panes[paneId];
              const sourceTab = sourcePane?.activeTabId ? state.tabs[sourcePane.activeTabId] : null;
              const inheritedProviderId =
                sourceTab &&
                (sourceTab.kind === "thread" ||
                  sourceTab.kind === "draft" ||
                  sourceTab.kind === "agent")
                  ? (sourceTab.providerId ?? null)
                  : null;
              const inheritedInstanceId =
                sourceTab &&
                (sourceTab.kind === "thread" ||
                  sourceTab.kind === "draft" ||
                  sourceTab.kind === "agent")
                  ? (sourceTab.instanceId ?? null)
                  : null;
              return {
                id: newTabId,
                kind: "agent" as const,
                title: inheritedProviderId ? formatAgentBrandName(inheritedProviderId) : "新会话",
                providerId: inheritedProviderId,
                instanceId: inheritedInstanceId,
                model: null,
                environmentId: null,
                threadId: null,
                draftId: null,
                url: null,
                shell: null,
                hostThreadRef: null,
                resourceId: null,
                pinned: false,
                createdAt: now,
                lastActiveAt: now,
              };
            })();

        set((current) => ({
          ...current,
          terminalCounter: nextTerminalCounter,
          layout: nextLayout,
          focusedPaneId: newPaneId,
          tabs: {
            ...current.tabs,
            [newTabId]: seedTab,
          },
          panes: {
            ...current.panes,
            [newPaneId]: {
              id: newPaneId,
              tabIds: [newTabId],
              activeTabId: newTabId,
            },
          },
        }));

        return newPaneId;
      },

      moveTabToNewSplit(tabId, fromPaneId, direction, position = "after") {
        const state = get();
        const fromPane = state.panes[fromPaneId];
        if (!fromPane || !fromPane.tabIds.includes(tabId) || fromPane.tabIds.length < 2) {
          return null;
        }
        if (countLeafPanes(state.layout) >= WORKSPACE_MAX_SPLIT_PANES) {
          return null;
        }
        const newPaneId = nextUid("pane");
        const splitId = nextUid("split");
        const { node: nextLayout, replaced } = splitLeafNode(
          state.layout,
          fromPaneId,
          newPaneId,
          direction,
          splitId,
          0.5,
          position,
        );
        if (!replaced) return null;

        const removedIdx = fromPane.tabIds.indexOf(tabId);
        const remainingTabIds = fromPane.tabIds.filter((id) => id !== tabId);
        const nextFromActiveId =
          fromPane.activeTabId === tabId
            ? (remainingTabIds[Math.min(removedIdx, remainingTabIds.length - 1)] ?? null)
            : fromPane.activeTabId;

        set((current) => ({
          ...current,
          layout: nextLayout,
          focusedPaneId: newPaneId,
          panes: {
            ...current.panes,
            [fromPaneId]: {
              ...fromPane,
              tabIds: remainingTabIds,
              activeTabId: nextFromActiveId,
            },
            [newPaneId]: {
              id: newPaneId,
              tabIds: [tabId],
              activeTabId: tabId,
            },
          },
        }));
        return newPaneId;
      },

      moveTabToPane(tabId, fromPaneId, toPaneId, insertIndex) {
        if (fromPaneId === toPaneId) return;
        set((current) => {
          const fromPane = current.panes[fromPaneId];
          const toPane = current.panes[toPaneId];
          if (!fromPane || !toPane || !fromPane.tabIds.includes(tabId)) return current;

          const removedIdx = fromPane.tabIds.indexOf(tabId);
          const nextFromIds = fromPane.tabIds.filter((id) => id !== tabId);
          const nextFromActiveId =
            fromPane.activeTabId === tabId
              ? (nextFromIds[Math.min(removedIdx, nextFromIds.length - 1)] ?? null)
              : fromPane.activeTabId;

          const nextToIds = toPane.tabIds.filter((id) => id !== tabId);
          const clampedIndex =
            insertIndex === undefined
              ? nextToIds.length
              : Math.max(0, Math.min(nextToIds.length, insertIndex));
          nextToIds.splice(clampedIndex, 0, tabId);

          const movedState: WorkspaceTabsStateData = {
            ...current,
            focusedPaneId: toPaneId,
            panes: {
              ...current.panes,
              [fromPaneId]: {
                ...fromPane,
                tabIds: nextFromIds,
                activeTabId: nextFromActiveId,
              },
              [toPaneId]: {
                ...toPane,
                tabIds: nextToIds,
                activeTabId: tabId,
              },
            },
          };

          const nextState =
            nextFromIds.length === 0 && countLeafPanes(movedState.layout) > 1
              ? collapsePaneInState(movedState, fromPaneId, false)
              : movedState;

          return toPaneId === nextState.primaryPaneId
            ? pruneDuplicateDraftTabsInState(nextState, {
                lookup: getSafeLiveComposerDraftStateLookup(),
                keepTabId: tabId,
              })
            : nextState;
        });
      },

      dropItemIntoPane(payload, targetPaneId, zone, options) {
        const initial = get();
        if (!initial.panes[targetPaneId]) {
          if (initial.activeDrag !== null) {
            set({ activeDrag: null });
          }
          return null;
        }

        if (payload.kind === "pane-tab") {
          const fromPane = initial.panes[payload.fromPaneId];
          if (!fromPane || !fromPane.tabIds.includes(payload.tabId)) {
            if (initial.activeDrag !== null) {
              set({ activeDrag: null });
            }
            return null;
          }

          if (zone === "center") {
            if (payload.fromPaneId === targetPaneId) {
              initial.activateTab(targetPaneId, payload.tabId);
            } else {
              initial.moveTabToPane(payload.tabId, payload.fromPaneId, targetPaneId);
            }
            set({ activeDrag: null });
            return { paneId: targetPaneId, tabId: payload.tabId };
          }

          // Cannot split a pane with its own sole tab.
          if (payload.fromPaneId === targetPaneId && fromPane.tabIds.length < 2) {
            initial.activateTab(targetPaneId, payload.tabId);
            set({ activeDrag: null });
            return { paneId: targetPaneId, tabId: payload.tabId };
          }

          const willCollapseSource =
            payload.fromPaneId !== targetPaneId && fromPane.tabIds.length === 1;
          if (countLeafPanes(initial.layout) >= WORKSPACE_MAX_SPLIT_PANES && !willCollapseSource) {
            if (payload.fromPaneId !== targetPaneId) {
              initial.moveTabToPane(payload.tabId, payload.fromPaneId, targetPaneId);
            } else {
              initial.activateTab(targetPaneId, payload.tabId);
            }
            set({ activeDrag: null });
            return { paneId: targetPaneId, tabId: payload.tabId };
          }

          const { direction, position } = resolveSplitPlacementFromZone(zone);
          const newPaneId = nextUid("pane");
          const splitId = nextUid("split");
          let succeeded = false;

          set((current) => {
            const currentFromPane = current.panes[payload.fromPaneId];
            if (
              !currentFromPane ||
              !currentFromPane.tabIds.includes(payload.tabId) ||
              !current.panes[targetPaneId]
            ) {
              return { ...current, activeDrag: null };
            }

            const { node: splitLayout, replaced } = splitLeafNode(
              current.layout,
              targetPaneId,
              newPaneId,
              direction,
              splitId,
              0.5,
              position,
            );
            if (!replaced) {
              return { ...current, activeDrag: null };
            }

            const removedIdx = currentFromPane.tabIds.indexOf(payload.tabId);
            const remainingFromIds = currentFromPane.tabIds.filter((id) => id !== payload.tabId);
            const nextFromActiveId =
              currentFromPane.activeTabId === payload.tabId
                ? (remainingFromIds[Math.min(removedIdx, remainingFromIds.length - 1)] ?? null)
                : currentFromPane.activeTabId;

            const nextState: WorkspaceTabsStateData = {
              layout: splitLayout,
              tabs: current.tabs,
              focusedPaneId: newPaneId,
              primaryPaneId: current.primaryPaneId,
              terminalCounter: current.terminalCounter,
              panes: {
                ...current.panes,
                [payload.fromPaneId]: {
                  ...currentFromPane,
                  tabIds: remainingFromIds,
                  activeTabId: nextFromActiveId,
                },
                [newPaneId]: {
                  id: newPaneId,
                  tabIds: [payload.tabId],
                  activeTabId: payload.tabId,
                },
              },
            };

            succeeded = true;
            const finalData =
              remainingFromIds.length === 0 && countLeafPanes(nextState.layout) > 1
                ? collapsePaneInState(nextState, payload.fromPaneId, false)
                : nextState;
            return {
              ...current,
              ...finalData,
              activeDrag: null,
            };
          });

          return succeeded ? { paneId: newPaneId, tabId: payload.tabId } : null;
        }

        const openInput = buildOpenTabInputFromSplitPayload(
          payload,
          options?.fallbackHostThreadRef,
        );

        // Center merge or at max split panes -> open/focus inside targetPaneId without stealing another pane.
        if (zone === "center" || countLeafPanes(initial.layout) >= WORKSPACE_MAX_SPLIT_PANES) {
          const targetPane = initial.panes[targetPaneId]!;
          const dedupeKey = workspaceTabDedupeKey(openInput);
          if (dedupeKey) {
            for (const existingTabId of targetPane.tabIds) {
              const candidate = initial.tabs[existingTabId];
              if (candidate && workspaceTabDedupeKey(candidate) === dedupeKey) {
                initial.activateTab(targetPaneId, existingTabId);
                set({ activeDrag: null });
                return { paneId: targetPaneId, tabId: existingTabId };
              }
            }
          }
          const createdTabId = initial.openTab({ ...openInput, reuseExisting: false }, targetPaneId);
          set({ activeDrag: null });
          return { paneId: targetPaneId, tabId: createdTabId };
        }

        const { direction, position } = resolveSplitPlacementFromZone(zone);
        const newPaneId = initial.splitPane(targetPaneId, direction, openInput, position);
        set({ activeDrag: null });
        if (!newPaneId) return null;
        const createdTabId = get().panes[newPaneId]?.activeTabId;
        return createdTabId ? { paneId: newPaneId, tabId: createdTabId } : null;
      },

      reorderTab(paneId, tabId, targetIndex) {
        set((current) => {
          const pane = current.panes[paneId];
          if (!pane) return current;
          const fromIndex = pane.tabIds.indexOf(tabId);
          if (fromIndex === -1) return current;
          const clampedTarget = Math.max(0, Math.min(pane.tabIds.length - 1, targetIndex));
          if (fromIndex === clampedTarget) return current;
          const nextIds = [...pane.tabIds];
          const [moved] = nextIds.splice(fromIndex, 1);
          nextIds.splice(clampedTarget, 0, moved!);
          return {
            ...current,
            panes: {
              ...current.panes,
              [paneId]: {
                ...pane,
                tabIds: nextIds,
              },
            },
          };
        });
      },

      closePane(paneId, options) {
        const mergeTabs = options?.mergeTabs ?? true;
        set((current) => collapsePaneInState(current, paneId, mergeTabs));
      },

      setSplitRatio(splitId, ratio) {
        set((current) => {
          const nextLayout = updateSplitRatioInTree(current.layout, splitId, ratio);
          return nextLayout === current.layout ? current : { ...current, layout: nextLayout };
        });
      },

      resetSplitRatio(splitId) {
        set((current) => {
          const nextLayout = updateSplitRatioInTree(current.layout, splitId, 0.5);
          return nextLayout === current.layout ? current : { ...current, layout: nextLayout };
        });
      },

      updateTab(tabId, patch) {
        set((current) => {
          const existing = current.tabs[tabId];
          if (!existing) return current;
          return {
            ...current,
            tabs: {
              ...current.tabs,
              [tabId]: {
                ...existing,
                ...patch,
              },
            },
          };
        });
      },

      pruneDuplicateDraftTabs(options) {
        const lookup =
          options?.lookup !== undefined
            ? options.lookup
            : getSafeLiveComposerDraftStateLookup();
        set((current) =>
          pruneDuplicateDraftTabsInState(current, {
            lookup,
            keepTabId: options?.keepTabId,
          }),
        );
      },

      resetWorkspace() {
        set({
          ...createInitialWorkspaceTabsState(),
          activeDrag: null,
          isResizingSplit: false,
        });
      },
    }),
    {
      name: WORKSPACE_TABS_STORAGE_KEY,
      storage: createJSONStorage(() =>
        resolveStorage(typeof globalThis !== "undefined" ? globalThis.localStorage : null),
      ),
      partialize: (state): WorkspaceTabsStateData => ({
        layout: state.layout,
        panes: state.panes,
        tabs: state.tabs,
        focusedPaneId: state.focusedPaneId,
        primaryPaneId: state.primaryPaneId,
        terminalCounter: state.terminalCounter,
      }),
      merge: (persisted, current) => {
        const sanitized = sanitizePersistedWorkspaceTabsState(
          persisted as Partial<WorkspaceTabsStateData>,
          getSafeLiveComposerDraftStateLookup(),
        );
        return {
          ...current,
          ...sanitized,
          activeDrag: null,
          isResizingSplit: false,
        };
      },
    },
  ),
);
