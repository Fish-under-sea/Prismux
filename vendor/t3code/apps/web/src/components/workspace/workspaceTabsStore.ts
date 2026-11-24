import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ProviderInstanceId,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { DraftId } from "../../composerDraftStore";
import { resolveStorage } from "../../lib/storage";
import { containsUuidNoise, formatAgentBrandName } from "../../prismux/agentBrand";
import type { ThreadRouteTarget } from "../../threadRoutes";

export const WORKSPACE_TABS_STORAGE_KEY = "prismux.workspaceTabs.v1";
export const WORKSPACE_MAX_SPLIT_PANES = 3;
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
  | "simulator";

export interface WorkspaceTab {
  readonly id: string;
  readonly kind: WorkspaceTabKind;
  readonly title: string;
  /** Canonical provider/agent identifier (e.g. "codex", "claudeAgent", "antigravity", "omp"). */
  readonly providerId?: string | null | undefined;
  /** Bound T3 Code provider instance ID when applicable. */
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
  syncRouteTarget: (input: SyncRouteTargetInput) => string | null;
  promoteDraftTab: (
    draftId: DraftId,
    threadRef: ScopedThreadRef,
    metadata?: { readonly title?: string; readonly providerId?: string | null },
  ) => void;
  openTab: (input: OpenWorkspaceTabInput, targetPaneId?: string) => string;
  closeTab: (tabId: string, paneId?: string) => void;
  activateTab: (paneId: string, tabId: string) => void;
  focusPane: (paneId: string) => void;
  splitPane: (
    paneId: string,
    direction: SplitDirection,
    initialTab?: OpenWorkspaceTabInput,
  ) => string | null;
  moveTabToNewSplit: (
    tabId: string,
    fromPaneId: string,
    direction: SplitDirection,
  ) => string | null;
  moveTabToPane: (
    tabId: string,
    fromPaneId: string,
    toPaneId: string,
    insertIndex?: number,
  ) => void;
  reorderTab: (paneId: string, tabId: string, targetIndex: number) => void;
  closePane: (paneId: string, options?: { readonly mergeTabs?: boolean }) => void;
  setSplitRatio: (splitId: string, ratio: number) => void;
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
        | "pinned"
      >
    >,
  ) => void;
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
): { readonly node: WorkspaceSplitLayoutNode; readonly replaced: boolean } {
  if (node.type === "leaf") {
    if (node.paneId !== targetPaneId) {
      return { node, replaced: false };
    }
    return {
      node: {
        type: "split",
        id: splitId,
        direction,
        first: node,
        second: { type: "leaf", paneId: newPaneId },
        ratio: clampSplitRatio(ratio),
      },
      replaced: true,
    };
  }
  const firstResult = splitLeafNode(node.first, targetPaneId, newPaneId, direction, splitId, ratio);
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

export function sanitizeRehydratedState(
  raw: Partial<WorkspaceTabsStateData> | undefined,
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
  for (const paneId of leafIds) {
    const pane = raw.panes[paneId];
    const validTabIds = (pane?.tabIds ?? []).filter((tabId) => Object.hasOwn(cleanTabs, tabId));
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

  const focusedPaneId =
    raw.focusedPaneId && Object.hasOwn(cleanPanes, raw.focusedPaneId)
      ? raw.focusedPaneId
      : firstPaneId;
  const primaryPaneId = Object.hasOwn(cleanPanes, resolvedPrimaryPaneId)
    ? resolvedPrimaryPaneId
    : firstPaneId;

  return {
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
}

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

  return {
    ...state,
    layout: nextLayout,
    panes: nextPanes,
    tabs: nextTabs,
    focusedPaneId:
      state.focusedPaneId === paneIdToRemove ? fallbackPaneId : state.focusedPaneId,
    primaryPaneId:
      state.primaryPaneId === paneIdToRemove ? fallbackPaneId : state.primaryPaneId,
  };
}

export const useWorkspaceTabsStore = create<WorkspaceTabsStore>()(
  persist(
    (set, get) => ({
      ...createInitialWorkspaceTabsState(),

      syncRouteTarget(input) {
        const { target } = input;
        if (!target) return null;
        const now = Date.now();
        const state = get();
        const primaryPane =
          state.panes[state.primaryPaneId] ??
          state.panes[findFirstLeafPaneId(state.layout)]!;
        const primaryPaneId = primaryPane.id;

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

        const existing = findMatchingTabInState(state, lookupInput, primaryPaneId);
        if (existing) {
          const prevTab = existing.tab;
          const nextTitle = input.title?.trim() || prevTab.title;
          const nextProviderId =
            input.providerId !== undefined ? input.providerId : prevTab.providerId;
          const nextInstanceId =
            input.instanceId !== undefined ? input.instanceId : prevTab.instanceId;
          const nextModel = input.model !== undefined ? input.model : prevTab.model;
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
          const targetPane = state.panes[existing.paneId]!;
          const needsActivation = shouldActivate && targetPane.activeTabId !== prevTab.id;

          if (!metadataChanged && !needsActivation) {
            return prevTab.id;
          }

          set((current) => {
            const paneNow = current.panes[existing.paneId];
            if (!paneNow) return current;
            const currentTab = current.tabs[prevTab.id];
            if (!currentTab) return current;
            return {
              ...current,
              tabs: {
                ...current.tabs,
                [prevTab.id]: {
                  ...currentTab,
                  title: nextTitle,
                  providerId: nextProviderId,
                  instanceId: nextInstanceId,
                  model: nextModel,
                  environmentId: nextEnvId,
                  threadId: nextThreadId,
                  lastActiveAt: shouldActivate ? now : currentTab.lastActiveAt,
                },
              },
              panes: shouldActivate
                ? {
                    ...current.panes,
                    [existing.paneId]: {
                      ...paneNow,
                      activeTabId: prevTab.id,
                    },
                  }
                : current.panes,
            };
          });
          return prevTab.id;
        }

        const newTabId = nextUid("tab");
        const newTab: WorkspaceTab = {
          id: newTabId,
          kind: target.kind === "server" ? "thread" : "draft",
          title: input.title?.trim() || (target.kind === "draft" ? "新会话" : "会话"),
          providerId: input.providerId ?? null,
          instanceId: input.instanceId ?? null,
          model: input.model ?? null,
          environmentId:
            target.kind === "server" ? target.threadRef.environmentId : (input.environmentId ?? null),
          threadId:
            target.kind === "server" ? target.threadRef.threadId : (input.threadId ?? null),
          draftId: target.kind === "draft" ? target.draftId : null,
          createdAt: now,
          lastActiveAt: now,
        };

        set((current) => {
          const paneNow =
            current.panes[primaryPaneId] ?? current.panes[findFirstLeafPaneId(current.layout)]!;
          const shouldActivate = input.activate !== false || paneNow.activeTabId === null;
          return {
            ...current,
            tabs: {
              ...current.tabs,
              [newTabId]: newTab,
            },
            panes: {
              ...current.panes,
              [paneNow.id]: {
                ...paneNow,
                tabIds: [...paneNow.tabIds, newTabId],
                activeTabId: shouldActivate ? newTabId : paneNow.activeTabId,
              },
            },
          };
        });
        return newTabId;
      },

      promoteDraftTab(draftId, threadRef, metadata) {
        set((current) => {
          const draftTab = Object.values(current.tabs).find(
            (tab) => tab.kind === "draft" && tab.draftId === draftId,
          );
          if (!draftTab) return current;
          const promotedKey = workspaceTabDedupeKey({
            kind: "thread",
            environmentId: threadRef.environmentId,
            threadId: threadRef.threadId,
          });
          const duplicateServerTab = Object.values(current.tabs).find(
            (tab) => tab.id !== draftTab.id && workspaceTabDedupeKey(tab) === promotedKey,
          );
          if (duplicateServerTab) {
            // Merge into existing server tab and remove the stale draft tab.
            const paneId = findTabPaneId(current.panes, draftTab.id);
            const nextTabs = { ...current.tabs };
            delete nextTabs[draftTab.id];
            if (!paneId) return { ...current, tabs: nextTabs };
            const pane = current.panes[paneId]!;
            const nextTabIds = pane.tabIds.filter((id) => id !== draftTab.id);
            return {
              ...current,
              tabs: nextTabs,
              panes: {
                ...current.panes,
                [paneId]: {
                  ...pane,
                  tabIds: nextTabIds,
                  activeTabId:
                    pane.activeTabId === draftTab.id
                      ? (duplicateServerTab.id in nextTabs &&
                        nextTabIds.includes(duplicateServerTab.id)
                          ? duplicateServerTab.id
                          : (nextTabIds[0] ?? null))
                      : pane.activeTabId,
                },
              },
            };
          }
          return {
            ...current,
            tabs: {
              ...current.tabs,
              [draftTab.id]: {
                ...draftTab,
                kind: "thread",
                draftId: null,
                environmentId: threadRef.environmentId,
                threadId: threadRef.threadId,
                title: metadata?.title?.trim() || draftTab.title,
                providerId:
                  metadata?.providerId !== undefined ? metadata.providerId : draftTab.providerId,
              },
            },
          };
        });
      },

      openTab(input, requestedPaneId) {
        const now = Date.now();
        const state = get();
        const resolvedPaneId =
          requestedPaneId && state.panes[requestedPaneId]
            ? requestedPaneId
            : state.panes[state.focusedPaneId]
              ? state.focusedPaneId
              : findFirstLeafPaneId(state.layout);

        const reuseExisting =
          input.reuseExisting ??
          (input.kind === "thread" || input.kind === "draft" || input.kind === "diff" || input.kind === "simulator");

        if (reuseExisting) {
          const existing = findMatchingTabInState(state, input, resolvedPaneId);
          if (existing) {
            set((current) => {
              const targetPane = current.panes[existing.paneId];
              const existingTab = current.tabs[existing.tab.id];
              if (!targetPane || !existingTab) return current;
              return {
                ...current,
                focusedPaneId: existing.paneId,
                tabs: {
                  ...current.tabs,
                  [existing.tab.id]: {
                    ...existingTab,
                    title: input.title.trim() || existingTab.title,
                    ...(input.providerId !== undefined ? { providerId: input.providerId } : {}),
                    ...(input.instanceId !== undefined ? { instanceId: input.instanceId } : {}),
                    ...(input.model !== undefined ? { model: input.model } : {}),
                    ...(input.url !== undefined ? { url: input.url } : {}),
                    ...(input.hostThreadRef !== undefined ? { hostThreadRef: input.hostThreadRef } : {}),
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
            });
            return existing.tab.id;
          }
        }

        let nextTerminalCounter = state.terminalCounter;
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

        set((current) => {
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
        return tabId;
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

      splitPane(paneId, direction, initialTab) {
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
                environmentId: initialTab.environmentId ?? initialTab.hostThreadRef?.environmentId ?? null,
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
          : {
              id: newTabId,
              kind: "agent",
              title: "Codex",
              providerId: "codex",
              instanceId: null,
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

      moveTabToNewSplit(tabId, fromPaneId, direction) {
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

          if (nextFromIds.length === 0 && countLeafPanes(movedState.layout) > 1) {
            return collapsePaneInState(movedState, fromPaneId, false);
          }
          return movedState;
        });
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

      resetWorkspace() {
        set(createInitialWorkspaceTabsState());
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
        const sanitized = sanitizeRehydratedState(persisted as Partial<WorkspaceTabsStateData>);
        return {
          ...current,
          ...sanitized,
        };
      },
    },
  ),
);
