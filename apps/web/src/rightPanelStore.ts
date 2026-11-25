import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@prismux/client-runtime/environment";
import {
  EnvironmentId,
  RunId,
  ThreadId,
  type DesktopPreviewColorScheme,
  type PreviewViewportPresetId,
  type PreviewViewportSetting,
  type ProviderInstanceId,
  type ScopedThreadRef,
} from "@prismux/core-contracts";
import {
  DEFAULT_MOBILE_SIMULATOR_PRESET_ID,
  findPreviewViewportPreset,
  resolvePreviewViewport,
} from "@prismux/core-shared/previewViewport";
import { msg } from "gt-react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { useClosedViewStore } from "./closedViewStore";
import { m } from "./i18n/messages";
import { resolveStorage } from "./lib/storage";
import type { LinkedThreadTarget } from "@prismux/client-runtime/linked-thread";
import {
  decodeLinkedThreadSurface,
  linkedThreadSurface,
  type LinkedThreadSurface,
} from "./linkedThreadSurface";
import type { ThreadPanelPresentation } from "./rightPanelLayout";
import {
  resolveConfiguredProviderLabel,
  type ProviderInstanceEntry,
} from "./providerInstances";
import type { ChatFileAttachment } from "./types";

const RIGHT_PANEL_KINDS = [
  "diff",
  "files",
  "file",
  "preview",
  "device",
  "terminal",
  "pull-request",
  "pull-request-empty",
  "pull-requests",
  "issue",
  "thread",
  "side-chat-empty",
  "linked-thread",
  "wallpaper",
  "agent-session",
  "agent-aux",
] as const;
export type RightPanelKind = (typeof RIGHT_PANEL_KINDS)[number];

export type PullRequestDetailTab = "summary" | "guide" | "timeline" | "code";

export interface DeviceTabTarget {
  hostId: string;
  deviceId: string;
  platform: "ios" | "android";
  name: string;
}

export type RightPanelSurface =
  | { id: `browser:${string}`; kind: "preview"; resourceId: string }
  | { id: "browser:new"; kind: "preview"; resourceId: null }
  | { id: "device" | `device:${string}`; kind: "device"; target?: DeviceTabTarget; title?: string }
  | {
      id: `terminal:${string}`;
      kind: "terminal";
      resourceId: string;
      terminalIds: string[];
      activeTerminalId: string;
      splitDirection?: "horizontal" | "vertical";
    }
  | { id: "diff"; kind: "diff" }
  | {
      id: "files";
      kind: "files";
      /** Set when breadcrumbs moved a folder browser up to the workspace root. */
      folderTrail?: string;
    }
  | {
      id: `file:${string}` | `attachment:${string}`;
      kind: "file";
      relativePath: string;
      revealLine: number | null;
      revealRequestId: number;
      attachment?: ChatFileAttachment;
      /** Deepest workspace path retained for navigating back down after moving up. */
      folderTrail?: string;
    }
  | {
      id: `pull-request:${string}`;
      kind: "pull-request";
      /** Cross-environment lists can repeat project ids; thread panels inherit their ref's environment. */
      environmentId?: string;
      projectId: string;
      host?: string;
      repository: string;
      number: number;
      url?: string;
      /** A clicked link waiting for the panel to show where it points; cleared once shown. */
      revealUrl?: string;
      detailTab?: PullRequestDetailTab;
    }
  | { id: "pull-request:empty"; kind: "pull-request-empty" }
  | { id: "pull-requests"; kind: "pull-requests" }
  /**
   * An issue opened in the issues list's shared panel, or beside a thread. Like `pull-request`,
   * the reference lives in the id so several issues can stay open as peer tabs.
   */
  | {
      id: `issue:${string}`;
      kind: "issue";
      environmentId?: string;
      projectId: string;
      tracker: string;
      host?: string;
      scope: string;
      key: string;
      url?: string;
    }
  /**
   * A thread of the panel's environment shown beside it: a side chat or a subagent. Which one is
   * the thread's own lineage, so the surface only names it.
   */
  | ThreadSurface
  | { id: "side-chat:empty"; kind: "side-chat-empty" }
  /** A linked environment's thread, read through `viaEnvironmentId`; it has no thread here. */
  | LinkedThreadSurface
  /** Prismux liquid-glass & wallpaper engine right-sidebar quick panel. */
  | { id: "wallpaper"; kind: "wallpaper" }
  /** Quick-launched multi-agent conversation hosted seamlessly inside the right sidebar. */
  | AgentSessionSurface
  /** Read-only native multi-agent auxiliary sidebar (AGY Swarm / CC Teams / Codex Collab). */
  | AgentAuxSurface;

export interface AgentAuxSurface {
  readonly id: "agent-aux";
  readonly kind: "agent-aux";
  readonly title: string;
  readonly auxKind: string;
  readonly provider?: string | null | undefined;
  readonly activeCount?: number | undefined;
}

export interface OpenAgentAuxInput {
  readonly title: string;
  readonly auxKind: string;
  readonly provider?: string | null | undefined;
  readonly activeCount?: number | undefined;
}

export interface AgentSessionSurface {
  readonly id: `agent-session:${string}`;
  readonly kind: "agent-session";
  readonly title: string;
  readonly providerId: string;
  readonly instanceId?: ProviderInstanceId | null | undefined;
  readonly model?: string | null | undefined;
  readonly environmentId?: EnvironmentId | null | undefined;
  readonly threadId?: ThreadId | null | undefined;
}

export interface OpenAgentSessionInput {
  readonly id?: `agent-session:${string}`;
  readonly title: string;
  readonly providerId: string;
  readonly instanceId?: ProviderInstanceId | null | undefined;
  readonly model?: string | null | undefined;
  readonly environmentId?: EnvironmentId | null | undefined;
  readonly threadId?: ThreadId | null | undefined;
  readonly providerEntries?: ReadonlyArray<ProviderInstanceEntry> | undefined;
}

export type ThreadSurface = { id: `thread:${string}`; kind: "thread"; threadId: ThreadId };

const threadSurface = (threadId: ThreadId): ThreadSurface => ({
  id: `thread:${threadId}`,
  kind: "thread",
  threadId,
});

/**
 * A saved thread surface with its id rebuilt, or null when it names no thread. Builds before
 * subagents opened here saved it as `side-chat`.
 */
export function decodeThreadSurface(surface: object): ThreadSurface | null {
  const { kind, threadId } = surface as Record<string, unknown>;
  if ((kind !== "thread" && kind !== "side-chat") || typeof threadId !== "string") return null;
  return threadId === "" ? null : threadSurface(ThreadId.make(threadId));
}

export const DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER = [
  "pull-requests",
  "diff",
  "files",
  "terminal",
  "preview",
  "mobile-simulator",
  "side-chat",
] as const;

export type RightPanelActivityItemId = (typeof DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER)[number];

export const RIGHT_PANEL_ACTIVITY_ORDER_STORAGE_KEY = "prismux.rightPanel.activityOrder.v4";
const LEGACY_RIGHT_PANEL_ACTIVITY_ORDER_STORAGE_KEYS = [
  "prismux.rightPanel.activityOrder.v3",
  "prismux.rightPanel.activityOrder.v2",
  "prismux.rightPanel.activityOrder.v1",
] as const;

const LEGACY_DEFAULT_ACTIVITY_ORDERS: ReadonlyArray<readonly string[]> = [
  [
    "pull-request",
    "diff",
    "files",
    "terminal",
    "side-chat",
    "preview",
    "mobile-simulator",
    "pull-requests",
    "wallpaper",
  ],
  ["diff", "files", "terminal", "preview", "mobile-simulator", "wallpaper"],
  ["mobile-simulator", "preview", "wallpaper", "diff", "terminal", "device", "files"],
  ["mobile-simulator", "preview", "wallpaper", "diff", "terminal", "devices", "files"],
  ["mobile-simulator", "preview", "wallpaper", "diff", "terminal", "files"],
];

function isLegacyDefaultActivityOrder(items: readonly string[]): boolean {
  return LEGACY_DEFAULT_ACTIVITY_ORDERS.some(
    (legacy) =>
      legacy.length === items.length && legacy.every((value, index) => items[index] === value),
  );
}

export interface ActivityOrderStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getDefaultActivityStorage(): ActivityOrderStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeRightPanelActivityOrder(raw: unknown): RightPanelActivityItemId[] {
  const validSet = new Set<string>(DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER);
  if (Array.isArray(raw)) {
    const rawStrings = raw.filter((item): item is string => typeof item === "string");
    if (isLegacyDefaultActivityOrder(rawStrings)) {
      return [...DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER];
    }
  }
  const next: RightPanelActivityItemId[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (
        typeof item === "string" &&
        item !== "pull-request" &&
        item !== "wallpaper" &&
        item !== "device" &&
        item !== "devices" &&
        validSet.has(item) &&
        !next.includes(item as RightPanelActivityItemId)
      ) {
        next.push(item as RightPanelActivityItemId);
      }
    }
  }
  if (isLegacyDefaultActivityOrder(next)) {
    return [...DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER];
  }
  for (const fallback of DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER) {
    if (!next.includes(fallback)) {
      next.push(fallback);
    }
  }
  return next;
}

export function loadRightPanelActivityOrder(
  storage: ActivityOrderStorageLike | null = getDefaultActivityStorage(),
): RightPanelActivityItemId[] {
  if (!storage) return [...DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER];
  try {
    const raw = storage.getItem(RIGHT_PANEL_ACTIVITY_ORDER_STORAGE_KEY);
    if (raw) {
      return normalizeRightPanelActivityOrder(JSON.parse(raw));
    }
    for (const legacyKey of LEGACY_RIGHT_PANEL_ACTIVITY_ORDER_STORAGE_KEYS) {
      const legacyRaw = storage.getItem(legacyKey);
      if (legacyRaw) {
        const migrated = normalizeRightPanelActivityOrder(JSON.parse(legacyRaw));
        saveRightPanelActivityOrder(migrated, storage);
        return migrated;
      }
    }
    return [...DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER];
  } catch {
    return [...DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER];
  }
}

export function saveRightPanelActivityOrder(
  order: readonly RightPanelActivityItemId[],
  storage: ActivityOrderStorageLike | null = getDefaultActivityStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      RIGHT_PANEL_ACTIVITY_ORDER_STORAGE_KEY,
      JSON.stringify(normalizeRightPanelActivityOrder(order)),
    );
  } catch {
    // Ignore storage quota or private browsing errors.
  }
}

export function reorderRightPanelActivityItems(
  order: readonly RightPanelActivityItemId[],
  fromId: RightPanelActivityItemId,
  toId: RightPanelActivityItemId,
): RightPanelActivityItemId[] {
  const normalized = normalizeRightPanelActivityOrder(order);
  const fromIndex = normalized.indexOf(fromId);
  const toIndex = normalized.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return normalized;
  }
  const next = [...normalized];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return normalized;
  next.splice(toIndex, 0, moved);
  return next;
}

export function partitionActivityBarOverflow<T>(
  items: readonly T[],
  availableWidth: number,
  itemSlotWidth = 30,
  overflowTriggerWidth = 28,
): { readonly visible: readonly T[]; readonly overflow: readonly T[] } {
  if (items.length === 0) return { visible: [], overflow: [] };
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return { visible: items, overflow: [] };
  }
  const fullWidth = items.length * itemSlotWidth;
  if (fullWidth <= availableWidth) {
    return { visible: items, overflow: [] };
  }
  const budgetForItems = Math.max(0, availableWidth - overflowTriggerWidth);
  const visibleCount = Math.max(0, Math.floor(budgetForItems / itemSlotWidth));
  return {
    visible: items.slice(0, visibleCount),
    overflow: items.slice(visibleCount),
  };
}

export interface ActivityBarLayoutItem {
  readonly id: RightPanelActivityItemId;
  readonly label: string;
  readonly active?: boolean;
}

export interface RightPanelActivityBarLayout<T extends ActivityBarLayoutItem> {
  readonly visible: readonly T[];
  readonly overflow: readonly T[];
  /** Non-active items shrunk to icon-only before any item spills into `More`. */
  readonly compactIds: ReadonlySet<RightPanelActivityItemId>;
}

const ACTIVITY_BAR_LABELED_CHROME_PX = 26;
const ACTIVITY_BAR_ASCII_CHAR_PX = 7;
const ACTIVITY_BAR_WIDE_CHAR_PX = 11.5;
const ACTIVITY_BAR_COMPACT_WIDTH_PX = 26;
const ACTIVITY_BAR_MORE_WIDTH_PX = 26;
const ACTIVITY_BAR_GAP_PX = 2;

function estimateActivityLabelWidth(label: string): number {
  let width = 0;
  for (const ch of label) {
    width += /[^\u0000-\u00ff]/.test(ch)
      ? ACTIVITY_BAR_WIDE_CHAR_PX
      : ACTIVITY_BAR_ASCII_CHAR_PX;
  }
  return Math.min(88, ACTIVITY_BAR_LABELED_CHROME_PX + Math.ceil(width));
}

/**
 * Two-stage compact-before-overflow Activity Bar layout modeled after Orca
 * `right-sidebar/activity-bar/activity-bar-overflow.ts`:
 * 1. If every item fits with its label, show all labeled (`compactIds` empty).
 * 2. Else collapse non-active items to icon-only (`compactIds`), keeping the active item's label;
 *    if all items fit now, show all with zero overflow.
 * 3. Else pin the active item + reserve the `More` trigger width and pack remaining items in order.
 */
export function resolveRightPanelActivityBarLayout<T extends ActivityBarLayoutItem>(
  items: readonly T[],
  availableWidth: number,
  stripPadding = 12,
): RightPanelActivityBarLayout<T> {
  const compactIds = new Set<RightPanelActivityItemId>();
  if (items.length === 0) {
    return { visible: [], overflow: [], compactIds };
  }
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return { visible: [...items], overflow: [], compactIds };
  }

  const labeledWidth = (item: T): number => estimateActivityLabelWidth(item.label);
  const itemWidth = (item: T, compact: boolean): number =>
    (compact ? ACTIVITY_BAR_COMPACT_WIDTH_PX : labeledWidth(item)) + ACTIVITY_BAR_GAP_PX;

  let totalWidth = items.reduce((sum, item) => sum + itemWidth(item, false), 0);
  if (stripPadding + totalWidth <= availableWidth) {
    return { visible: [...items], overflow: [], compactIds };
  }

  const activeItem = items.find((item) => item.active);
  for (const item of items) {
    if (item.id !== activeItem?.id) {
      compactIds.add(item.id);
      totalWidth += itemWidth(item, true) - itemWidth(item, false);
    }
  }
  if (compactIds.size > 0 && stripPadding + totalWidth <= availableWidth) {
    return { visible: [...items], overflow: [], compactIds };
  }

  // Stage 3: pin the active item + More trigger, then pack remaining items in order.
  const visibleIds = new Set<RightPanelActivityItemId>();
  let used = stripPadding + ACTIVITY_BAR_MORE_WIDTH_PX;
  if (activeItem) {
    visibleIds.add(activeItem.id);
    used += itemWidth(activeItem, false);
  }
  for (const item of items) {
    if (item.id === activeItem?.id) continue;
    const width = itemWidth(item, compactIds.has(item.id));
    if (used + width > availableWidth) {
      break;
    }
    used += width;
    visibleIds.add(item.id);
  }
  if (visibleIds.size === 0 && items[0]) {
    visibleIds.add(items[0].id);
  }

  return {
    visible: items.filter((item) => visibleIds.has(item.id)),
    overflow: items.filter((item) => !visibleIds.has(item.id)),
    compactIds,
  };
}

/**
 * Modeled after Orca `right-sidebar/activity-bar/activity-bar-arrangement.ts`:
 * Reorders visible strip items among strip slots first, leaving overflowed items in place
 * so dragging a strip item never unexpectedly ejects another strip item into `More`.
 */
export function moveStripActivityItems(
  fullOrder: readonly RightPanelActivityItemId[],
  stripIds: ReadonlySet<RightPanelActivityItemId>,
  fromId: RightPanelActivityItemId,
  toId: RightPanelActivityItemId,
): RightPanelActivityItemId[] | null {
  const normalized = normalizeRightPanelActivityOrder(fullOrder);
  const strip = normalized.filter((id) => stripIds.has(id));
  const fromIndex = strip.indexOf(fromId);
  const toIndex = strip.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return null;
  }
  const nextStrip = [...strip];
  const [moved] = nextStrip.splice(fromIndex, 1);
  if (!moved) return null;
  nextStrip.splice(toIndex, 0, moved);
  return [...nextStrip, ...normalized.filter((id) => !stripIds.has(id))];
}

const RIGHT_PANEL_STORAGE_KEY = "prismux:right-panel-state:v2";
const RIGHT_PANEL_STORAGE_VERSION = 16;

export const PULL_REQUESTS_PANEL_REF = scopeThreadRef(
  EnvironmentId.make("pull-requests-panel"),
  ThreadId.make("pull-requests-panel"),
);

/** The issues page's shared panel, with the same fixed sentinel ref as the pull-request list. */
export const ISSUES_PANEL_REF = scopeThreadRef(
  EnvironmentId.make("issues-panel"),
  ThreadId.make("issues-panel"),
);

/**
 * The pull-request and issues lists' shared panels are session
 * state: reopening the app should show the list, not last session's tabs and detail fetches.
 */
const isPullRequestsPanelKey = (threadKey: string) =>
  threadKey.endsWith(":pull-requests-panel") || threadKey.endsWith(":issues-panel");

export interface ThreadRightPanelState {
  isOpen: boolean;
  activeSurfaceId: string | null;
  surfaces: RightPanelSurface[];
  dismissedDeviceSurfaceIds?: string[];
  maximized?: true;
  proactiveDiffTurnId?: RunId;
}

export interface ThreadPanelVisibility {
  inlineOpen: boolean;
  popoverOpen: boolean;
}

interface RightPanelStoreState {
  byThreadKey: Record<string, ThreadRightPanelState>;
  pendingMaximizeThreadKey: string | null;
  requestMaximize: (ref: ScopedThreadRef) => void;
  consumeMaximizeRequest: (ref: ScopedThreadRef) => boolean;
  threadPanelVisibilityByThreadKey: Record<string, ThreadPanelVisibility>;
  userActionRevisionByThreadKey: Record<string, number>;
  closeRevisionByThreadKey: Record<string, number>;
  getUserActionRevision: (ref: ScopedThreadRef) => number;
  markUserAction: (ref: ScopedThreadRef) => number;
  /** Refused if the user chose a panel after expectedUserActionRevision was read. */
  openProactive: (
    ref: ScopedThreadRef,
    request:
      | Extract<RightPanelSurface, { kind: "pull-request" | "pull-requests" }>
      | { kind: "diff"; turnId: RunId },
    expectedUserActionRevision: number,
    activateExisting?: boolean,
  ) => boolean;
  open: (
    ref: ScopedThreadRef,
    kind: Exclude<
      RightPanelKind,
      "file" | "terminal" | "pull-request" | "issue" | "thread" | "linked-thread"
    >,
  ) => void;
  /** Opens a quick-launched multi-agent conversation smoothly inside the right sidebar. */
  openAgentSession: (ref: ScopedThreadRef, input: OpenAgentSessionInput) => string;
  /** Updates metadata or binds a created server thread to an open right-sidebar agent session tab. */
  updateAgentSession: (
    ref: ScopedThreadRef,
    surfaceId: string,
    patch: Partial<Omit<AgentSessionSurface, "id" | "kind">>,
  ) => void;
  /** Opens or focuses the read-only native multi-agent auxiliary sidebar (only when activated). */
  openAgentAux: (ref: ScopedThreadRef, input: OpenAgentAuxInput, automatic?: boolean) => void;
  /** Silently refreshes metadata on an already-open agent-aux surface without stealing focus. */
  updateAgentAux: (
    ref: ScopedThreadRef,
    patch: Partial<Omit<AgentAuxSurface, "id" | "kind">>,
  ) => void;
  /** Opens a side chat or subagent of `ref`'s environment as a tab; `ref` itself has no tab. */
  openThread: (ref: ScopedThreadRef, threadId: ThreadId) => void;
  openLinkedThread: (ref: ScopedThreadRef, target: LinkedThreadTarget) => void;
  /** Records the title the linked environment gave, so the tab and a reopened one show it. */
  setLinkedThreadTitle: (ref: ScopedThreadRef, surfaceId: string, title: string) => void;
  openDevice: (ref: ScopedThreadRef, target: DeviceTabTarget, automatic?: boolean) => void;
  renameDevice: (ref: ScopedThreadRef, surfaceId: string, title: string) => void;
  openBrowser: (ref: ScopedThreadRef, tabId: string | null) => void;
  openFile: (ref: ScopedThreadRef, relativePath: string, line?: number) => void;
  /** Moves in place; "" opens the root explorer. folderTrail keeps the return path; keepSource opens beside the source. */
  navigateFolder: (
    ref: ScopedThreadRef,
    surfaceId: string,
    relativePath: string,
    folderTrail: string,
    keepSource?: boolean,
  ) => void;
  openAttachment: (ref: ScopedThreadRef, attachment: ChatFileAttachment) => void;
  openPullRequest: (
    ref: ScopedThreadRef,
    target: {
      environmentId?: string;
      projectId: string;
      host?: string;
      repository: string;
      number: number;
      url?: string;
      /** A clicked link to reveal; reopening a surface passes only its `url`. */
      revealUrl?: string;
      detailTab?: PullRequestDetailTab;
    },
  ) => void;
  openIssue: (ref: ScopedThreadRef, target: IssueSurfaceTarget) => void;
  setPullRequestDetailTab: (
    ref: ScopedThreadRef,
    surfaceId: string,
    detailTab: PullRequestDetailTab,
  ) => void;
  /** Clears the surface's pending link only while it is still `revealUrl`. */
  settlePullRequestReveal: (ref: ScopedThreadRef, surfaceId: string, revealUrl: string) => void;
  openTerminal: (ref: ScopedThreadRef, terminalId: string) => void;
  splitTerminal: (
    ref: ScopedThreadRef,
    surfaceId: string,
    terminalId: string,
    direction?: "horizontal" | "vertical",
  ) => void;
  activateTerminal: (ref: ScopedThreadRef, surfaceId: string, terminalId: string) => void;
  closeTerminal: (ref: ScopedThreadRef, surfaceId: string, terminalId: string) => void;
  activateSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  /** Agent-driven activation. Not a user action, so it does not move keyboard focus. */
  revealSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeOtherSurfaces: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeSurfacesToRight: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeAllSurfaces: (ref: ScopedThreadRef) => void;
  moveSurface: (ref: ScopedThreadRef, surfaceId: string, toIndex: number) => void;
  reconcileBrowserSurfaces: (
    ref: ScopedThreadRef,
    tabIds: readonly string[],
    hiddenTabIds?: ReadonlySet<string>,
  ) => void;
  reconcileFileSurfaces: (ref: ScopedThreadRef, workspaceAvailable: boolean) => void;
  show: (ref: ScopedThreadRef) => void;
  close: (ref: ScopedThreadRef) => void;
  setMaximized: (ref: ScopedThreadRef, maximized: boolean) => void;
  toggleVisibility: (ref: ScopedThreadRef) => void;
  toggle: (
    ref: ScopedThreadRef,
    kind: Exclude<
      RightPanelKind,
      | "file"
      | "terminal"
      | "pull-request"
      | "issue"
      | "thread"
      | "linked-thread"
      | "agent-session"
      | "agent-aux"
    >,
  ) => void;
  setThreadPanelOpen: (
    ref: ScopedThreadRef,
    presentation: ThreadPanelPresentation,
    open: boolean,
  ) => void;
  toggleThreadPanel: (ref: ScopedThreadRef, presentation: ThreadPanelPresentation) => void;
  removeThread: (ref: ScopedThreadRef) => void;
  /** Persisted drag-and-drop ordering of right sidebar Activity Bar surface shortcuts. */
  activityBarOrder: RightPanelActivityItemId[];
  reorderActivityBar: (
    fromId: RightPanelActivityItemId,
    toId: RightPanelActivityItemId,
  ) => void;
  resetActivityBarOrder: () => void;
  /** Transient launch intent & blank-stage state for one-click Phone Simulator mode (iPhone 16 Pro + bezel). */
  pendingMobileSimulatorPresetId: PreviewViewportPresetId | null;
  pendingMobileSimulatorSetting: Exclude<PreviewViewportSetting, { readonly _tag: "fill" }> | null;
  mobileSimulatorLaunchSeq: number;
  mobileSimulatorIdleActive: boolean;
  mobileSimulatorBezelEnabled: boolean;
  mobileSimulatorColorScheme: DesktopPreviewColorScheme;
  requestMobileSimulatorLaunch: (presetId?: PreviewViewportPresetId) => void;
  consumeMobileSimulatorLaunch: () => PreviewViewportPresetId | null;
  consumeMobileSimulatorSetting: () => Exclude<PreviewViewportSetting, { readonly _tag: "fill" }> | null;
  setMobileSimulatorIdleActive: (active: boolean) => void;
  setPendingMobileSimulatorSetting: (
    setting: Exclude<PreviewViewportSetting, { readonly _tag: "fill" }> | null,
  ) => void;
  setMobileSimulatorBezelEnabled: (enabled: boolean) => void;
  setMobileSimulatorColorScheme: (scheme: DesktopPreviewColorScheme) => void;
}

const EMPTY_THREAD_STATE: ThreadRightPanelState = {
  isOpen: false,
  activeSurfaceId: null,
  surfaces: [],
};

const DEFAULT_THREAD_PANEL_VISIBILITY: ThreadPanelVisibility = {
  inlineOpen: true,
  popoverOpen: false,
};

const singletonSurface = (
  kind: Exclude<
    RightPanelKind,
    "file" | "preview" | "terminal" | "pull-request" | "issue" | "thread" | "linked-thread"
  >,
): RightPanelSurface => {
  switch (kind) {
    case "diff":
      return { id: "diff", kind };
    case "files":
      return { id: "files", kind };
    case "pull-request-empty":
      return { id: "pull-request:empty", kind };
    case "pull-requests":
      return { id: "pull-requests", kind };
    case "side-chat-empty":
      return { id: "side-chat:empty", kind };
    case "device":
      return { id: "device", kind };
    case "wallpaper":
      return { id: "wallpaper", kind };
    case "agent-session":
      return {
        id: `agent-session:${Date.now().toString(36)}`,
        kind: "agent-session",
        title: "Codex",
        providerId: "codex",
      };
    case "agent-aux":
      return {
        id: "agent-aux",
        kind: "agent-aux",
        title: "智能体协同",
        auxKind: "provider-subagents",
      };
  }
};

const browserSurface = (tabId: string | null): RightPanelSurface =>
  tabId
    ? { id: `browser:${tabId}`, kind: "preview", resourceId: tabId }
    : { id: "browser:new", kind: "preview", resourceId: null };

const fileSurface = (
  relativePath: string,
  revealLine: number | null,
  revealRequestId: number,
): RightPanelSurface => ({
  id: `file:${relativePath}`,
  kind: "file",
  relativePath,
  revealLine,
  revealRequestId,
});

const attachmentSurface = (attachment: ChatFileAttachment): RightPanelSurface => ({
  id: `attachment:${attachment.id}`,
  kind: "file",
  relativePath: attachment.name,
  revealLine: null,
  revealRequestId: 0,
  attachment,
});

const terminalSurface = (terminalId: string): RightPanelSurface => ({
  id: `terminal:${terminalId}`,
  kind: "terminal",
  resourceId: terminalId,
  terminalIds: [terminalId],
  activeTerminalId: terminalId,
});

export type PullRequestSurface = Extract<RightPanelSurface, { kind: "pull-request" }>;

export function pullRequestSurfaceId(target: {
  environmentId?: string;
  projectId: string;
  host?: string;
  repository: string;
  number: number;
}): PullRequestSurface["id"] {
  const scope =
    target.environmentId === undefined ? "" : `${encodeURIComponent(target.environmentId)}:`;
  const host = target.host === undefined ? "" : `${encodeURIComponent(target.host.toLowerCase())}:`;
  return `pull-request:${scope}${encodeURIComponent(target.projectId)}:${host}${encodeURIComponent(target.repository)}:${target.number}`;
}

export type IssueSurface = Extract<RightPanelSurface, { kind: "issue" }>;

export interface IssueSurfaceTarget {
  environmentId?: string;
  projectId: string;
  tracker: string;
  host?: string;
  scope: string;
  key: string;
  url?: string;
}

function issueSurfaceId(target: Omit<IssueSurfaceTarget, "url">): IssueSurface["id"] {
  const environment =
    target.environmentId === undefined ? "" : `${encodeURIComponent(target.environmentId)}:`;
  const host = target.host === undefined ? "" : `${encodeURIComponent(target.host.toLowerCase())}:`;
  return `issue:${environment}${encodeURIComponent(target.projectId)}:${target.tracker}:${host}${encodeURIComponent(target.scope.toLowerCase())}:${encodeURIComponent(target.key)}`;
}

function issueSurface(target: IssueSurfaceTarget): IssueSurface {
  return {
    id: issueSurfaceId(target),
    kind: "issue",
    ...(target.environmentId === undefined ? {} : { environmentId: target.environmentId }),
    projectId: target.projectId,
    tracker: target.tracker,
    ...(typeof target.host === "string" ? { host: target.host.toLowerCase() } : {}),
    scope: target.scope,
    key: target.key,
    ...(typeof target.url === "string" ? { url: target.url } : {}),
  };
}

export function pullRequestSurface(target: {
  environmentId?: string;
  projectId: string;
  host?: string;
  repository: string;
  number: number;
  url?: string;
  detailTab?: PullRequestDetailTab;
}): PullRequestSurface {
  return {
    id: pullRequestSurfaceId(target),
    kind: "pull-request",
    ...(target.environmentId === undefined ? {} : { environmentId: target.environmentId }),
    projectId: target.projectId,
    ...(typeof target.host === "string" ? { host: target.host.toLowerCase() } : {}),
    repository: target.repository,
    number: target.number,
    ...(typeof target.url === "string" ? { url: target.url } : {}),
    ...(target.detailTab === undefined ? {} : { detailTab: target.detailTab }),
  };
}

/** A pending link belongs to the click that made it, not to a reload or a reopen. */
const withoutReveal = (surface: RightPanelSurface): RightPanelSurface => {
  if (surface.kind !== "pull-request" || surface.revealUrl === undefined) return surface;
  const { revealUrl: _pending, ...rest } = surface;
  return rest;
};

const upsertSurface = (
  current: ThreadRightPanelState,
  surface: RightPanelSurface,
  activate = true,
): ThreadRightPanelState => ({
  ...current,
  isOpen: true,
  surfaces: current.surfaces.some((entry) => entry.id === surface.id)
    ? current.surfaces
    : [...current.surfaces, surface],
  activeSurfaceId: activate ? surface.id : current.activeSurfaceId,
});

const updateThreadStateMap = (
  byThreadKey: Record<string, ThreadRightPanelState>,
  threadKey: string,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
): Record<string, ThreadRightPanelState> => {
  const current = byThreadKey[threadKey] ?? EMPTY_THREAD_STATE;
  const next = updater(current);
  if (
    !next.isOpen &&
    next.activeSurfaceId === null &&
    next.surfaces.length === 0 &&
    !next.dismissedDeviceSurfaceIds?.length &&
    next.proactiveDiffTurnId === undefined
  ) {
    if (!(threadKey in byThreadKey)) return byThreadKey;
    const { [threadKey]: _removed, ...rest } = byThreadKey;
    return rest;
  }
  if (next === current) return byThreadKey;
  return { ...byThreadKey, [threadKey]: next };
};

const updateThreadPanelVisibilityMap = (
  byThreadKey: Record<string, ThreadPanelVisibility>,
  threadKey: string,
  updater: (current: ThreadPanelVisibility) => ThreadPanelVisibility,
): Record<string, ThreadPanelVisibility> => {
  const current = byThreadKey[threadKey] ?? DEFAULT_THREAD_PANEL_VISIBILITY;
  const next = updater(current);
  if (next.inlineOpen && !next.popoverOpen) {
    if (!(threadKey in byThreadKey)) return byThreadKey;
    const { [threadKey]: _removed, ...rest } = byThreadKey;
    return rest;
  }
  if (next === current) return byThreadKey;
  return { ...byThreadKey, [threadKey]: next };
};

type RightPanelStoreData = Pick<
  RightPanelStoreState,
  "byThreadKey" | "threadPanelVisibilityByThreadKey"
>;

const updateThread = (
  state: RightPanelStoreData,
  threadKey: string,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
): RightPanelStoreData => {
  const current = state.byThreadKey[threadKey] ?? EMPTY_THREAD_STATE;
  const byThreadKey = updateThreadStateMap(state.byThreadKey, threadKey, updater);
  const next = byThreadKey[threadKey] ?? EMPTY_THREAD_STATE;
  let threadPanelVisibilityByThreadKey = state.threadPanelVisibilityByThreadKey;

  if (!current.isOpen && next.isOpen) {
    threadPanelVisibilityByThreadKey = updateThreadPanelVisibilityMap(
      threadPanelVisibilityByThreadKey,
      threadKey,
      (visibility) => (visibility.popoverOpen ? { ...visibility, popoverOpen: false } : visibility),
    );
  } else if (current.isOpen && !next.isOpen) {
    threadPanelVisibilityByThreadKey = updateThreadPanelVisibilityMap(
      threadPanelVisibilityByThreadKey,
      threadKey,
      (visibility) =>
        visibility.popoverOpen && !visibility.inlineOpen
          ? { ...visibility, inlineOpen: true }
          : visibility,
    );
  }

  return { byThreadKey, threadPanelVisibilityByThreadKey };
};

const automaticUpdate = (
  state: RightPanelStoreState,
  threadKey: string,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
): Partial<RightPanelStoreState> => ({
  ...updateThread(state, threadKey, updater),
});

// A side chat pane has no panel of its own, so its panel actions open in its parent's panel.
const panelHosts = new Map<string, ScopedThreadRef>();

/** Routes `guest`'s panel actions to `host`'s panel until the returned cleanup runs. */
export function hostRightPanel(guest: ScopedThreadRef, host: ScopedThreadRef): () => void {
  const guestKey = scopedThreadKey(guest);
  panelHosts.set(guestKey, host);
  return () => {
    if (panelHosts.get(guestKey) === host) panelHosts.delete(guestKey);
  };
}

/** The thread whose panel shows `ref`'s panel actions, so it also owns their browser tabs. */
export function rightPanelHostRef(ref: ScopedThreadRef): ScopedThreadRef {
  return panelHosts.get(scopedThreadKey(ref)) ?? ref;
}

const userAction = (
  state: RightPanelStoreState,
  guestKey: string,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
  closesView = false,
): Partial<RightPanelStoreState> => {
  const host = panelHosts.get(guestKey);
  const threadKey = host === undefined ? guestKey : scopedThreadKey(host);
  return userActionOnThread(state, threadKey, updater, closesView);
};

const userActionOnThread = (
  state: RightPanelStoreState,
  threadKey: string,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
  closesView: boolean,
): Partial<RightPanelStoreState> => ({
  ...updateThread(state, threadKey, (current) => {
    const next = updater(current);
    if (next === current) return current;
    const removedDevices = current.surfaces.filter(
      (surface) =>
        surface.kind === "device" && !next.surfaces.some((entry) => entry.id === surface.id),
    );
    if (removedDevices.length === 0) return next;
    return {
      ...next,
      dismissedDeviceSurfaceIds: [
        ...new Set([
          ...(next.dismissedDeviceSurfaceIds ?? []),
          ...removedDevices.map((surface) => surface.id),
        ]),
      ],
    };
  }),
  userActionRevisionByThreadKey: {
    ...state.userActionRevisionByThreadKey,
    [threadKey]: (state.userActionRevisionByThreadKey[threadKey] ?? 0) + 1,
  },
  ...(closesView
    ? {
        closeRevisionByThreadKey: {
          ...state.closeRevisionByThreadKey,
          [threadKey]: (state.closeRevisionByThreadKey[threadKey] ?? 0) + 1,
        },
      }
    : {}),
});

const activated = (current: ThreadRightPanelState, surfaceId: string): ThreadRightPanelState =>
  current.surfaces.some((surface) => surface.id === surfaceId)
    ? { ...current, isOpen: true, activeSurfaceId: surfaceId }
    : current;

const closeAction = (
  state: RightPanelStoreState,
  threadKey: string,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
): Partial<RightPanelStoreState> => userAction(state, threadKey, updater, true);

function normalizeRevealLine(line: number | undefined): number | null {
  if (line === undefined || !Number.isFinite(line)) return null;
  return Math.max(1, Math.trunc(line));
}

export function migratePersistedRightPanelState(persistedState: unknown): {
  byThreadKey: Record<string, ThreadRightPanelState>;
  threadPanelVisibilityByThreadKey: Record<string, ThreadPanelVisibility>;
} {
  if (!persistedState || typeof persistedState !== "object") {
    return { byThreadKey: {}, threadPanelVisibilityByThreadKey: {} };
  }
  const byThreadKey =
    "byThreadKey" in persistedState &&
    persistedState.byThreadKey &&
    typeof persistedState.byThreadKey === "object"
      ? Object.fromEntries(
          Object.entries(persistedState.byThreadKey as Record<string, ThreadRightPanelState>)
            .filter(([threadKey]) => !isPullRequestsPanelKey(threadKey))
            .map(([threadKey, threadState]) => {
              const validThreadState =
                threadState && typeof threadState === "object" ? threadState : null;
              const surfaces = Array.isArray(validThreadState?.surfaces)
                ? validThreadState.surfaces.flatMap<RightPanelSurface>((surface) => {
                    if (!surface || typeof surface !== "object") return [];
                    const kind = (surface as { kind?: string }).kind;
                    if (kind === "thread" || kind === "side-chat") {
                      const decoded = decodeThreadSurface(surface);
                      return decoded === null ? [] : [decoded];
                    }
                    // Also drops kinds this build does not know, such as one a newer build saved.
                    if (!(RIGHT_PANEL_KINDS as ReadonlyArray<unknown>).includes(kind)) return [];
                    if (surface.kind === "linked-thread") {
                      const decoded = decodeLinkedThreadSurface(surface);
                      return decoded === null ? [] : [decoded];
                    }
                    if (
                      (surface.kind === "file" || surface.kind === "files") &&
                      "folderTrail" in surface &&
                      typeof surface.folderTrail !== "string"
                    ) {
                      const { folderTrail: _invalid, ...rest } = surface;
                      surface = rest;
                    }
                    if (surface.kind === "file") {
                      const revealLine =
                        typeof surface.revealLine === "number" &&
                        Number.isFinite(surface.revealLine)
                          ? Math.max(1, Math.trunc(surface.revealLine))
                          : null;
                      const revealRequestId =
                        typeof surface.revealRequestId === "number" &&
                        Number.isSafeInteger(surface.revealRequestId) &&
                        surface.revealRequestId >= 0
                          ? surface.revealRequestId
                          : 0;
                      return [{ ...surface, revealLine, revealRequestId }];
                    }
                    if (surface.kind === "pull-request") {
                      if (
                        typeof surface.projectId !== "string" ||
                        typeof surface.repository !== "string" ||
                        typeof surface.number !== "number" ||
                        !Number.isSafeInteger(surface.number) ||
                        surface.number < 1
                      ) {
                        return [];
                      }
                      const { environmentId, ...rest } = surface;
                      return [
                        pullRequestSurface({
                          ...rest,
                          ...(typeof environmentId === "string" ? { environmentId } : {}),
                        }),
                      ];
                    }
                    if (surface.kind === "issue") {
                      if (
                        typeof surface.projectId !== "string" ||
                        typeof surface.tracker !== "string" ||
                        typeof surface.scope !== "string" ||
                        typeof surface.key !== "string"
                      ) {
                        return [];
                      }
                      const { environmentId, ...rest } = surface;
                      return [
                        issueSurface({
                          ...rest,
                          ...(typeof environmentId === "string" ? { environmentId } : {}),
                        }),
                      ];
                    }
                    if (surface.kind === "agent-session") {
                      if (
                        typeof surface.id !== "string" ||
                        !surface.id.startsWith("agent-session:") ||
                        typeof surface.title !== "string" ||
                        typeof surface.providerId !== "string"
                      ) {
                        return [];
                      }
                      return [surface];
                    }
                    if (surface.kind === "agent-aux") {
                      if (
                        surface.id !== "agent-aux" ||
                        typeof surface.title !== "string" ||
                        typeof surface.auxKind !== "string"
                      ) {
                        return [];
                      }
                      return [surface];
                    }
                    if (surface.kind !== "terminal") return [surface];
                    if (
                      !("resourceId" in surface) ||
                      typeof surface.resourceId !== "string" ||
                      surface.id !== `terminal:${surface.resourceId}`
                    ) {
                      return [];
                    }
                    const terminalIds =
                      "terminalIds" in surface && Array.isArray(surface.terminalIds)
                        ? [
                            ...new Set(
                              surface.terminalIds.filter(
                                (terminalId): terminalId is string =>
                                  typeof terminalId === "string",
                              ),
                            ),
                          ]
                        : [surface.resourceId];
                    const activeTerminalId =
                      "activeTerminalId" in surface &&
                      typeof surface.activeTerminalId === "string" &&
                      terminalIds.includes(surface.activeTerminalId)
                        ? surface.activeTerminalId
                        : (terminalIds[0] ?? surface.resourceId);
                    return [
                      {
                        ...surface,
                        terminalIds: terminalIds.length > 0 ? terminalIds : [surface.resourceId],
                        activeTerminalId,
                      },
                    ];
                  })
                : [];
              const savedActiveSurfaceId = validThreadState?.activeSurfaceId;
              const rawActiveSurfaceId =
                typeof savedActiveSurfaceId === "string" &&
                savedActiveSurfaceId.startsWith("side-chat:")
                  ? `thread:${savedActiveSurfaceId.slice("side-chat:".length)}`
                  : savedActiveSurfaceId;
              const persistedActiveSurfaceId = surfaces.some(
                (surface) => surface.id === rawActiveSurfaceId,
              )
                ? (rawActiveSurfaceId ?? null)
                : rawActiveSurfaceId === "pull-request"
                  ? (surfaces.find((surface) => surface.kind === "pull-request")?.id ?? null)
                  : null;
              const isOpen =
                surfaces.length > 0 &&
                (typeof validThreadState?.isOpen === "boolean"
                  ? validThreadState.isOpen
                  : persistedActiveSurfaceId !== null);
              const activeSurfaceId =
                persistedActiveSurfaceId ??
                (isOpen || rawActiveSurfaceId === "agents" ? (surfaces[0]?.id ?? null) : null);
              return [
                threadKey,
                {
                  isOpen,
                  surfaces,
                  activeSurfaceId,
                  ...(typeof validThreadState?.proactiveDiffTurnId === "string"
                    ? { proactiveDiffTurnId: RunId.make(validThreadState.proactiveDiffTurnId) }
                    : {}),
                  ...(Array.isArray(validThreadState?.dismissedDeviceSurfaceIds)
                    ? {
                        dismissedDeviceSurfaceIds:
                          validThreadState.dismissedDeviceSurfaceIds.filter(
                            (id): id is string => typeof id === "string",
                          ),
                      }
                    : {}),
                  ...(validThreadState?.maximized === true ? { maximized: true as const } : {}),
                },
              ];
            }),
        )
      : {};
  const threadPanelVisibilityByThreadKey =
    "threadPanelVisibilityByThreadKey" in persistedState &&
    persistedState.threadPanelVisibilityByThreadKey &&
    typeof persistedState.threadPanelVisibilityByThreadKey === "object"
      ? Object.fromEntries(
          Object.entries(
            persistedState.threadPanelVisibilityByThreadKey as Record<string, unknown>,
          ).flatMap(([threadKey, value]) => {
            if (!value || typeof value !== "object" || !("inlineOpen" in value)) return [];
            return value.inlineOpen === false
              ? [[threadKey, { inlineOpen: false, popoverOpen: false }]]
              : [];
          }),
        )
      : {};
  return { byThreadKey, threadPanelVisibilityByThreadKey };
}

export const useRightPanelStore = create<RightPanelStoreState>()(
  persist(
    (set, get) => ({
      byThreadKey: {},
      pendingMaximizeThreadKey: null,
      requestMaximize: (ref) => set({ pendingMaximizeThreadKey: scopedThreadKey(ref) }),
      consumeMaximizeRequest: (ref) => {
        if (get().pendingMaximizeThreadKey !== scopedThreadKey(ref)) return false;
        set({ pendingMaximizeThreadKey: null });
        return true;
      },
      threadPanelVisibilityByThreadKey: {},
      userActionRevisionByThreadKey: {},
      closeRevisionByThreadKey: {},
      getUserActionRevision: (ref) =>
        get().userActionRevisionByThreadKey[scopedThreadKey(ref)] ?? 0,
      markUserAction: (ref) => {
        const revision = get().getUserActionRevision(ref) + 1;
        set((state) => ({
          userActionRevisionByThreadKey: {
            ...state.userActionRevisionByThreadKey,
            [scopedThreadKey(ref)]: revision,
          },
        }));
        return revision;
      },
      openProactive: (ref, request, expectedUserActionRevision, activateExisting = false) => {
        let opened = false;
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (request.kind === "diff") {
            const current = selectThreadRightPanelState(state.byThreadKey, ref);
            if (current.proactiveDiffTurnId === request.turnId) return state;
            const activePanel = selectActiveRightPanel(state.byThreadKey, ref);
            const pullRequestActive =
              activePanel === "pull-request" || activePanel === "pull-requests";
            opened =
              (state.userActionRevisionByThreadKey[threadKey] ?? 0) ===
                expectedUserActionRevision &&
              activePanel !== "diff" &&
              !pullRequestActive;
            // Record the offer even when refused, so a revisit does not retry this turn.
            return automaticUpdate(state, threadKey, (thread) => ({
              ...(opened ? upsertSurface(thread, singletonSurface("diff")) : thread),
              proactiveDiffTurnId: request.turnId,
            }));
          }
          if (
            (state.userActionRevisionByThreadKey[threadKey] ?? 0) !== expectedUserActionRevision
          ) {
            return state;
          }
          // Keep an existing PR tab where the user left it when revisiting a thread.
          if (
            !activateExisting &&
            selectThreadRightPanelState(state.byThreadKey, ref).surfaces.some(
              (entry) => entry.id === request.id,
            )
          ) {
            return state;
          }
          opened = true;
          return automaticUpdate(state, threadKey, (current) => upsertSurface(current, request));
        });
        return opened;
      },
      open: (ref, kind) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            if (kind === "preview") {
              const existing = current.surfaces.find((surface) => surface.kind === "preview");
              return upsertSurface(current, existing ?? browserSurface(null));
            }
            return upsertSurface(current, singletonSurface(kind));
          }),
        ),
      openAgentSession: (ref, input) => {
        const surfaceId: `agent-session:${string}` =
          input.id ??
          (`agent-session:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` as const);
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            // Deduplicate if targeting an already-open real server thread inside this panel.
            if (input.environmentId && input.threadId) {
              const existingByThread = current.surfaces.find(
                (entry): entry is AgentSessionSurface =>
                  entry.kind === "agent-session" &&
                  entry.environmentId === input.environmentId &&
                  entry.threadId === input.threadId,
              );
              if (existingByThread) {
                return {
                  ...current,
                  isOpen: true,
                  activeSurfaceId: existingByThread.id,
                };
              }
            }
            const nextSurface: AgentSessionSurface = {
              id: surfaceId,
              kind: "agent-session",
              title:
                input.title.trim() ||
                resolveConfiguredProviderLabel(
                  input.instanceId ?? input.providerId,
                  input.providerEntries ?? [],
                ),
              providerId: input.providerId,
              ...(input.instanceId !== undefined ? { instanceId: input.instanceId } : {}),
              ...(input.model !== undefined ? { model: input.model } : {}),
              ...(input.environmentId !== undefined ? { environmentId: input.environmentId } : {}),
              ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
            };
            const exists = current.surfaces.some((entry) => entry.id === surfaceId);
            return {
              ...current,
              isOpen: true,
              activeSurfaceId: surfaceId,
              surfaces: exists
                ? current.surfaces.map((entry) => (entry.id === surfaceId ? nextSurface : entry))
                : [...current.surfaces, nextSurface],
            };
          }),
        );
        return surfaceId;
      },
      updateAgentSession: (ref, surfaceId, patch) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            let changed = false;
            const surfaces = current.surfaces.map((surface) => {
              if (surface.id !== surfaceId || surface.kind !== "agent-session") {
                return surface;
              }
              changed = true;
              return {
                ...surface,
                ...(patch.title !== undefined ? { title: patch.title } : {}),
                ...(patch.providerId !== undefined ? { providerId: patch.providerId } : {}),
                ...(patch.instanceId !== undefined ? { instanceId: patch.instanceId } : {}),
                ...(patch.model !== undefined ? { model: patch.model } : {}),
                ...(patch.environmentId !== undefined
                  ? { environmentId: patch.environmentId }
                  : {}),
                ...(patch.threadId !== undefined ? { threadId: patch.threadId } : {}),
              };
            });
            return changed ? { ...current, surfaces } : current;
          }),
        ),
      openAgentAux: (ref, input, automatic = false) =>
        set((state) =>
          (automatic ? automaticUpdate : userAction)(state, scopedThreadKey(ref), (current) => {
            const nextSurface: AgentAuxSurface = {
              id: "agent-aux",
              kind: "agent-aux",
              title: input.title.trim() || "智能体协同",
              auxKind: input.auxKind,
              ...(input.provider !== undefined ? { provider: input.provider } : {}),
              ...(input.activeCount !== undefined ? { activeCount: input.activeCount } : {}),
            };
            const exists = current.surfaces.some((entry) => entry.id === "agent-aux");
            return {
              ...current,
              isOpen: true,
              activeSurfaceId: "agent-aux",
              surfaces: exists
                ? current.surfaces.map((entry) => (entry.id === "agent-aux" ? nextSurface : entry))
                : [...current.surfaces, nextSurface],
            };
          }),
        ),
      updateAgentAux: (ref, patch) =>
        set((state) => {
          const threadKey = scopedThreadKey(rightPanelHostRef(ref));
          const existing = state.byThreadKey[threadKey]?.surfaces.find(
            (surface): surface is AgentAuxSurface =>
              surface.id === "agent-aux" && surface.kind === "agent-aux",
          );
          if (!existing) return state;
          const nextTitle = patch.title !== undefined ? patch.title.trim() || existing.title : existing.title;
          const nextAuxKind = patch.auxKind !== undefined ? patch.auxKind : existing.auxKind;
          const nextProvider = patch.provider !== undefined ? patch.provider : existing.provider;
          const nextActiveCount =
            patch.activeCount !== undefined ? patch.activeCount : existing.activeCount;
          if (
            nextTitle === existing.title &&
            nextAuxKind === existing.auxKind &&
            nextProvider === existing.provider &&
            nextActiveCount === existing.activeCount
          ) {
            return state;
          }
          return automaticUpdate(state, threadKey, (current) => ({
            ...current,
            surfaces: current.surfaces.map((surface) =>
              surface.id === "agent-aux" && surface.kind === "agent-aux"
                ? {
                    ...surface,
                    title: nextTitle,
                    auxKind: nextAuxKind,
                    ...(nextProvider !== undefined ? { provider: nextProvider } : {}),
                    ...(nextActiveCount !== undefined ? { activeCount: nextActiveCount } : {}),
                  }
                : surface,
            ),
          }));
        }),
      openDevice: (ref, target, automatic = false) =>
        set((state) =>
          (automatic ? automaticUpdate : userAction)(state, scopedThreadKey(ref), (current) => {
            const id =
              `device:${encodeURIComponent(target.hostId)}:${encodeURIComponent(target.deviceId)}` as const;
            if (automatic && current.dismissedDeviceSurfaceIds?.includes(id)) return current;
            const surface: RightPanelSurface = { id, kind: "device", target };
            const existing = current.surfaces.find((entry) => entry.id === id);
            const surfaces = existing
              ? current.surfaces.filter((entry) => entry.id !== "device")
              : current.surfaces.map((entry) => (entry.id === "device" ? surface : entry));
            return upsertSurface(
              {
                ...current,
                surfaces,
                dismissedDeviceSurfaceIds: (current.dismissedDeviceSurfaceIds ?? []).filter(
                  (entry) => entry !== id,
                ),
              },
              existing ?? surface,
            );
          }),
        ),
      openThread: (ref, threadId) =>
        set((state) =>
          rightPanelHostRef(ref).threadId === threadId
            ? state
            : userAction(state, scopedThreadKey(ref), (current) => {
                const withoutEmptySideChat = current.surfaces.filter(
                  (surface) => surface.kind !== "side-chat-empty",
                );
                return upsertSurface(
                  { ...current, surfaces: withoutEmptySideChat },
                  threadSurface(threadId),
                );
              }),
        ),
      openLinkedThread: (ref, target) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const surface = linkedThreadSurface(target);
            const next = upsertSurface(current, surface);
            return {
              ...next,
              // A later click may know the title or label an earlier one did not.
              surfaces: next.surfaces.map((entry) =>
                entry.id === surface.id && entry.kind === "linked-thread"
                  ? { ...surface, title: surface.title ?? entry.title }
                  : entry,
              ),
            };
          }),
        ),
      setLinkedThreadTitle: (ref, surfaceId, title) =>
        set((state) => {
          const threadKey = scopedThreadKey(rightPanelHostRef(ref));
          const existing = state.byThreadKey[threadKey]?.surfaces.find(
            (surface) => surface.id === surfaceId,
          );
          if (existing?.kind !== "linked-thread" || existing.title === title) return state;
          return automaticUpdate(state, threadKey, (current) => ({
            ...current,
            surfaces: current.surfaces.map((surface) =>
              surface.id === surfaceId && surface.kind === "linked-thread"
                ? { ...surface, title }
                : surface,
            ),
          }));
        }),
      renameDevice: (ref, surfaceId, title) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => ({
            ...current,
            surfaces: current.surfaces.map((surface) =>
              surface.id === surfaceId && surface.kind === "device"
                ? {
                    ...surface,
                    title:
                      title.trim() ||
                      surface.target?.name ||
                      m(msg("Device", { $context: "a simulator or emulator" })),
                  }
                : surface,
            ),
          })),
        ),
      openBrowser: (ref, tabId) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const surface = browserSurface(tabId);
            const withoutPlaceholder = tabId
              ? current.surfaces.filter((entry) => entry.id !== "browser:new")
              : current.surfaces;
            return upsertSurface({ ...current, surfaces: withoutPlaceholder }, surface);
          }),
        ),
      openPullRequest: (ref, target) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const surface = pullRequestSurface(target);
            const withoutEmptyPullRequest = current.surfaces.filter(
              (entry) => entry.kind !== "pull-request-empty",
            );
            const next = upsertSurface(
              { ...current, surfaces: withoutEmptyPullRequest },
              surface,
            );
            const { url, revealUrl } = target;
            if (!url && !revealUrl) return next;
            return {
              ...next,
              surfaces: next.surfaces.map((entry) => {
                if (entry.id !== surface.id || entry.kind !== "pull-request") return entry;
                // A later link replaces one not yet shown.
                const { revealUrl: _previous, ...rest } = entry;
                return { ...rest, ...surface, ...(revealUrl ? { revealUrl } : {}) };
              }),
            };
          }),
        ),
      openIssue: (ref, target) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const surface = issueSurface(target);
            const next = upsertSurface(current, surface);
            return target.url
              ? {
                  ...next,
                  surfaces: next.surfaces.map((entry) =>
                    entry.id === surface.id ? surface : entry,
                  ),
                }
              : next;
          }),
        ),
      setPullRequestDetailTab: (ref, surfaceId, detailTab) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const existing = state.byThreadKey[threadKey]?.surfaces.find(
            (surface) => surface.id === surfaceId,
          );
          if (existing?.kind !== "pull-request" || (existing.detailTab ?? "summary") === detailTab)
            return state;
          return automaticUpdate(state, threadKey, (current) => ({
            ...current,
            surfaces: current.surfaces.map((surface) =>
              surface.id === surfaceId && surface.kind === "pull-request"
                ? { ...surface, detailTab }
                : surface,
            ),
          }));
        }),
      settlePullRequestReveal: (ref, surfaceId, revealUrl) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const existing = state.byThreadKey[threadKey]?.surfaces.find(
            (surface) => surface.id === surfaceId,
          );
          if (existing?.kind !== "pull-request" || existing.revealUrl !== revealUrl) return state;
          return automaticUpdate(state, threadKey, (current) => ({
            ...current,
            surfaces: current.surfaces.map((surface) =>
              surface.id === surfaceId ? withoutReveal(surface) : surface,
            ),
          }));
        }),
      openFile: (ref, requestedPath, line) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            if (requestedPath === ".") {
              return upsertSurface(current, singletonSurface("files"));
            }
            // Workspace entry paths use '/', including on Windows.
            const relativePath = /^[A-Za-z]:\/+$/.test(requestedPath)
              ? requestedPath
              : requestedPath.replace(/\/+$/, "") || requestedPath;
            const withoutStandaloneExplorer = current.surfaces.filter(
              (surface) => surface.kind !== "files",
            );
            const surfaceId = `file:${relativePath}` as const;
            const existing = withoutStandaloneExplorer.find(
              (surface): surface is Extract<RightPanelSurface, { kind: "file" }> =>
                surface.id === surfaceId && surface.kind === "file",
            );
            const surface = fileSurface(
              relativePath,
              normalizeRevealLine(line),
              (existing?.revealRequestId ?? 0) + 1,
            );
            return {
              ...current,
              isOpen: true,
              activeSurfaceId: surface.id,
              surfaces: existing
                ? withoutStandaloneExplorer.map((entry) =>
                    entry.id === surface.id ? surface : entry,
                  )
                : [...withoutStandaloneExplorer, surface],
            };
          }),
        ),
      navigateFolder: (ref, surfaceId, relativePath, folderTrail, keepSource = false) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (index < 0) return current;
            const trail = folderTrail === relativePath ? {} : { folderTrail };
            const target: RightPanelSurface =
              relativePath === ""
                ? { ...singletonSurface("files"), ...trail }
                : { ...fileSurface(relativePath, null, 1), ...trail };
            const source = current.surfaces[index]!;
            const existing = current.surfaces.some(
              (surface, i) => i !== index && surface.id === target.id,
            );
            const surfaces = current.surfaces.flatMap((surface, i) => {
              if (i === index) {
                const kept = keepSource ? [source] : [];
                return existing ? kept : [...kept, target];
              }
              return !existing && target.kind === "file" && surface.kind === "files"
                ? []
                : [surface];
            });
            return { ...current, isOpen: true, activeSurfaceId: target.id, surfaces };
          }),
        ),
      openAttachment: (ref, attachment) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const withoutStandaloneExplorer = current.surfaces.filter(
              (surface) => surface.kind !== "files",
            );
            return upsertSurface(
              { ...current, surfaces: withoutStandaloneExplorer },
              attachmentSurface(attachment),
            );
          }),
        ),
      openTerminal: (ref, terminalId) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) =>
            upsertSurface(current, terminalSurface(terminalId)),
          ),
        ),
      splitTerminal: (ref, surfaceId, terminalId, direction = "horizontal") =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => ({
            ...current,
            isOpen: true,
            activeSurfaceId: surfaceId,
            surfaces: current.surfaces.map((surface) => {
              if (surface.id !== surfaceId || surface.kind !== "terminal") return surface;
              const { splitDirection: _splitDirection, ...baseSurface } = surface;
              return {
                ...baseSurface,
                terminalIds: surface.terminalIds.includes(terminalId)
                  ? surface.terminalIds
                  : [...surface.terminalIds, terminalId],
                activeTerminalId: terminalId,
                ...(direction === "vertical" ? { splitDirection: "vertical" as const } : {}),
              };
            }),
          })),
        ),
      activateTerminal: (ref, surfaceId, terminalId) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => ({
            ...current,
            activeSurfaceId: surfaceId,
            surfaces: current.surfaces.map((surface) =>
              surface.id === surfaceId &&
              surface.kind === "terminal" &&
              surface.terminalIds.includes(terminalId)
                ? { ...surface, activeTerminalId: terminalId }
                : surface,
            ),
          })),
        ),
      closeTerminal: (ref, surfaceId, terminalId) =>
        set((state) =>
          closeAction(state, scopedThreadKey(ref), (current) => {
            const surface = current.surfaces.find(
              (entry) => entry.id === surfaceId && entry.kind === "terminal",
            );
            if (!surface || surface.kind !== "terminal") return current;
            const terminalIds = surface.terminalIds.filter((id) => id !== terminalId);
            if (terminalIds.length === 0) {
              const index = current.surfaces.findIndex((entry) => entry.id === surfaceId);
              const surfaces = current.surfaces.filter((entry) => entry.id !== surfaceId);
              const fallback = surfaces[Math.min(index, surfaces.length - 1)] ?? null;
              return {
                ...current,
                isOpen: surfaces.length > 0 && current.isOpen,
                surfaces,
                activeSurfaceId:
                  current.activeSurfaceId === surfaceId
                    ? (fallback?.id ?? null)
                    : current.activeSurfaceId,
              };
            }
            return {
              ...current,
              surfaces: current.surfaces.map((entry) =>
                entry.id === surfaceId && entry.kind === "terminal"
                  ? {
                      ...entry,
                      terminalIds,
                      activeTerminalId:
                        entry.activeTerminalId === terminalId
                          ? (terminalIds.at(-1) ?? terminalIds[0]!)
                          : entry.activeTerminalId,
                    }
                  : entry,
              ),
            };
          }),
        ),
      activateSurface: (ref, surfaceId) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => activated(current, surfaceId)),
        ),
      revealSurface: (ref, surfaceId) =>
        set((state) =>
          automaticUpdate(state, scopedThreadKey(ref), (current) => activated(current, surfaceId)),
        ),
      closeSurface: (ref, surfaceId) =>
        set((state) =>
          closeAction(state, scopedThreadKey(ref), (current) => {
            const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (index < 0) return current;
            const surfaces = current.surfaces.filter((surface) => surface.id !== surfaceId);
            const next = {
              ...current,
              isOpen: surfaces.length > 0 && current.isOpen,
              surfaces,
            };
            if (current.activeSurfaceId !== surfaceId) {
              return next;
            }
            const fallback = surfaces[Math.min(index, surfaces.length - 1)] ?? null;
            return {
              ...next,
              activeSurfaceId: fallback?.id ?? null,
            };
          }),
        ),
      closeOtherSurfaces: (ref, surfaceId) =>
        set((state) =>
          closeAction(state, scopedThreadKey(ref), (current) => {
            const surface = current.surfaces.find((entry) => entry.id === surfaceId);
            if (!surface || current.surfaces.length === 1) return current;
            return {
              ...current,
              isOpen: true,
              surfaces: [surface],
              activeSurfaceId: surface.id,
            };
          }),
        ),
      closeSurfacesToRight: (ref, surfaceId) =>
        set((state) =>
          closeAction(state, scopedThreadKey(ref), (current) => {
            const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (index < 0 || index === current.surfaces.length - 1) return current;
            const surfaces = current.surfaces.slice(0, index + 1);
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            return {
              ...current,
              surfaces,
              activeSurfaceId: activeStillExists ? current.activeSurfaceId : surfaceId,
            };
          }),
        ),
      closeAllSurfaces: (ref) =>
        set((state) =>
          closeAction(state, scopedThreadKey(ref), (current) =>
            current.surfaces.length === 0
              ? current
              : { ...current, isOpen: false, surfaces: [], activeSurfaceId: null },
          ),
        ),
      moveSurface: (ref, surfaceId, toIndex) =>
        set((state) =>
          updateThread(state, scopedThreadKey(ref), (current) => {
            const fromIndex = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (fromIndex < 0 || fromIndex === toIndex) return current;
            const surfaces = [...current.surfaces];
            surfaces.splice(toIndex, 0, ...surfaces.splice(fromIndex, 1));
            return { ...current, surfaces };
          }),
        ),
      reconcileBrowserSurfaces: (ref, tabIds, hiddenTabIds) =>
        set((state) =>
          automaticUpdate(state, scopedThreadKey(ref), (current) => {
            const validIds = new Set(tabIds.map((tabId) => `browser:${tabId}`));
            const kept = current.surfaces.filter(
              (surface) =>
                surface.kind !== "preview" ||
                (surface.id !== "browser:new" && validIds.has(surface.id)),
            );
            const knownIds = new Set(kept.map((surface) => surface.id));
            const added = tabIds
              .filter((tabId) => !knownIds.has(`browser:${tabId}`) && !hiddenTabIds?.has(tabId))
              .map((tabId) => browserSurface(tabId));
            const surfaces = [...kept, ...added];
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            const fallbackBrowser = surfaces.find((surface) => surface.kind === "preview");
            // A closed session tab was the last surface: hide the panel rather than leave it on
            // the empty picker, as a user close would. A dropped `browser:new` placeholder does not count.
            const closedLastSessionTab =
              surfaces.length === 0 &&
              current.surfaces.some((surface) => surface.kind === "preview" && surface.resourceId);
            return {
              ...current,
              isOpen: closedLastSessionTab ? false : current.isOpen,
              surfaces,
              activeSurfaceId: activeStillExists
                ? current.activeSurfaceId
                : (fallbackBrowser?.id ?? surfaces[0]?.id ?? null),
            };
          }),
        ),
      reconcileFileSurfaces: (ref, workspaceAvailable) =>
        set((state) =>
          automaticUpdate(state, scopedThreadKey(ref), (current) => {
            if (workspaceAvailable) return current;
            const surfaces = current.surfaces.filter(
              (surface) =>
                surface.kind !== "files" &&
                (surface.kind !== "file" || surface.attachment !== undefined),
            );
            if (surfaces.length === current.surfaces.length) return current;
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            return {
              ...current,
              isOpen: surfaces.length > 0 ? current.isOpen : false,
              surfaces,
              activeSurfaceId: activeStillExists
                ? current.activeSurfaceId
                : (surfaces.at(-1)?.id ?? null),
            };
          }),
        ),
      show: (ref) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) =>
            current.isOpen ? current : { ...current, isOpen: true },
          ),
        ),
      close: (ref) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) =>
            current.isOpen ? { ...current, isOpen: false } : current,
          ),
        ),
      setMaximized: (ref, maximized) =>
        set((state) =>
          automaticUpdate(state, scopedThreadKey(ref), (current) => {
            if ((current.maximized ?? false) === maximized) return current;
            const { maximized: _maximized, ...rest } = current;
            return maximized ? { ...rest, maximized: true } : rest;
          }),
        ),
      toggleVisibility: (ref) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => ({
            ...current,
            isOpen: !current.isOpen,
          })),
        ),
      toggle: (ref, kind) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const active = current.surfaces.find(
              (surface) => surface.id === current.activeSurfaceId,
            );
            if (current.isOpen && active?.kind === kind) {
              return { ...current, isOpen: false };
            }
            if (kind === "preview") {
              const existing = current.surfaces.find((surface) => surface.kind === "preview");
              return upsertSurface(current, existing ?? browserSurface(null));
            }
            return upsertSurface(current, singletonSurface(kind));
          }),
        ),
      setThreadPanelOpen: (ref, presentation, open) =>
        set((state) => ({
          threadPanelVisibilityByThreadKey: updateThreadPanelVisibilityMap(
            state.threadPanelVisibilityByThreadKey,
            scopedThreadKey(ref),
            (visibility) => {
              const key = presentation === "inline" ? "inlineOpen" : "popoverOpen";
              return visibility[key] === open ? visibility : { ...visibility, [key]: open };
            },
          ),
        })),
      toggleThreadPanel: (ref, presentation) =>
        set((state) => ({
          threadPanelVisibilityByThreadKey: updateThreadPanelVisibilityMap(
            state.threadPanelVisibilityByThreadKey,
            scopedThreadKey(ref),
            (visibility) =>
              presentation === "inline"
                ? { ...visibility, inlineOpen: !visibility.inlineOpen }
                : { ...visibility, popoverOpen: !visibility.popoverOpen },
          ),
        })),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (
            !(threadKey in state.byThreadKey) &&
            !(threadKey in state.threadPanelVisibilityByThreadKey) &&
            !(threadKey in state.userActionRevisionByThreadKey) &&
            !(threadKey in state.closeRevisionByThreadKey)
          ) {
            return state;
          }
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
          const { [threadKey]: _visibility, ...threadPanelVisibilityByThreadKey } =
            state.threadPanelVisibilityByThreadKey;
          const { [threadKey]: _revision, ...userActionRevisionByThreadKey } =
            state.userActionRevisionByThreadKey;
          const { [threadKey]: _closeRevision, ...closeRevisionByThreadKey } =
            state.closeRevisionByThreadKey;
          return {
            byThreadKey,
            threadPanelVisibilityByThreadKey,
            userActionRevisionByThreadKey,
            closeRevisionByThreadKey,
          };
        }),
      activityBarOrder: loadRightPanelActivityOrder(),
      reorderActivityBar: (fromId, toId) =>
        set((state) => {
          const next = reorderRightPanelActivityItems(state.activityBarOrder, fromId, toId);
          saveRightPanelActivityOrder(next);
          return { activityBarOrder: next };
        }),
      resetActivityBarOrder: () =>
        set(() => {
          const next = [...DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER];
          saveRightPanelActivityOrder(next);
          return { activityBarOrder: next };
        }),
      pendingMobileSimulatorPresetId: null,
      pendingMobileSimulatorSetting: null,
      mobileSimulatorLaunchSeq: 0,
      mobileSimulatorIdleActive: false,
      mobileSimulatorBezelEnabled: true,
      mobileSimulatorColorScheme: "system",
      requestMobileSimulatorLaunch: (presetId = DEFAULT_MOBILE_SIMULATOR_PRESET_ID) =>
        set((state) => {
          let resolvedSetting: Exclude<PreviewViewportSetting, { readonly _tag: "fill" }> | null =
            null;
          try {
            const candidate = resolvePreviewViewport({ mode: "preset", preset: presetId });
            if (candidate._tag !== "fill") {
              resolvedSetting = candidate;
            }
          } catch {
            resolvedSetting = null;
          }
          return {
            pendingMobileSimulatorPresetId: presetId,
            pendingMobileSimulatorSetting: resolvedSetting,
            mobileSimulatorIdleActive: true,
            mobileSimulatorBezelEnabled: true,
            mobileSimulatorLaunchSeq: state.mobileSimulatorLaunchSeq + 1,
          };
        }),
      consumeMobileSimulatorLaunch: () => {
        const preset = get().pendingMobileSimulatorPresetId;
        if (preset === null) return null;
        set({ pendingMobileSimulatorPresetId: null });
        return preset;
      },
      consumeMobileSimulatorSetting: () => {
        const state = get();
        const setting = state.pendingMobileSimulatorSetting;
        if (setting !== null) {
          set({
            pendingMobileSimulatorSetting: null,
            pendingMobileSimulatorPresetId: null,
          });
          return setting;
        }
        const preset = state.pendingMobileSimulatorPresetId;
        if (preset === null) return null;
        set({ pendingMobileSimulatorPresetId: null });
        try {
          const candidate = resolvePreviewViewport({ mode: "preset", preset });
          return candidate._tag !== "fill" ? candidate : null;
        } catch {
          return null;
        }
      },
      setMobileSimulatorIdleActive: (active) => set({ mobileSimulatorIdleActive: active }),
      setPendingMobileSimulatorSetting: (setting) =>
        set({
          pendingMobileSimulatorSetting: setting,
          pendingMobileSimulatorPresetId:
            setting?._tag === "preset"
              ? (findPreviewViewportPreset(setting.presetId)?.id ?? null)
              : null,
        }),
      setMobileSimulatorBezelEnabled: (enabled) => set({ mobileSimulatorBezelEnabled: enabled }),
      setMobileSimulatorColorScheme: (scheme) => set({ mobileSimulatorColorScheme: scheme }),
    }),
    {
      name: RIGHT_PANEL_STORAGE_KEY,
      version: RIGHT_PANEL_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        byThreadKey: Object.fromEntries(
          Object.entries(state.byThreadKey).flatMap(([threadKey, threadState]) =>
            isPullRequestsPanelKey(threadKey)
              ? []
              : [
                  [
                    threadKey,
                    { ...threadState, surfaces: threadState.surfaces.map(withoutReveal) },
                  ],
                ],
          ),
        ),
        threadPanelVisibilityByThreadKey: Object.fromEntries(
          Object.entries(state.threadPanelVisibilityByThreadKey).flatMap(
            ([threadKey, visibility]) =>
              visibility.inlineOpen ? [] : [[threadKey, { inlineOpen: false, popoverOpen: false }]],
          ),
        ),
      }),
      migrate: migratePersistedRightPanelState,
    },
  ),
);

useRightPanelStore.subscribe((next, previous) => {
  if (next.closeRevisionByThreadKey === previous.closeRevisionByThreadKey) return;
  for (const [threadKey, revision] of Object.entries(next.closeRevisionByThreadKey)) {
    if (revision === previous.closeRevisionByThreadKey[threadKey]) continue;
    const threadRef = parseScopedThreadKey(threadKey);
    if (!threadRef) continue;
    const before = previous.byThreadKey[threadKey] ?? EMPTY_THREAD_STATE;
    const after = next.byThreadKey[threadKey] ?? EMPTY_THREAD_STATE;
    const removed = before.surfaces.filter(
      (surface) => !after.surfaces.some((entry) => entry.id === surface.id),
    );
    const closedInOrder = [
      ...removed.filter((surface) => surface.id !== before.activeSurfaceId),
      ...removed.filter((surface) => surface.id === before.activeSurfaceId),
    ];
    for (const surface of closedInOrder.map(withoutReveal)) {
      if (
        surface.kind === "terminal" ||
        surface.kind === "agent-session" ||
        surface.kind === "agent-aux" ||
        surface.kind === "pull-request-empty" ||
        surface.kind === "side-chat-empty" ||
        (surface.kind === "preview" && surface.resourceId !== null)
      )
        continue;
      useClosedViewStore.getState().remember({ kind: "panel-tab", threadRef, surface });
    }
  }
});

export function selectThreadRightPanelState(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): ThreadRightPanelState {
  if (!ref) return EMPTY_THREAD_STATE;
  return byThreadKey[scopedThreadKey(ref)] ?? EMPTY_THREAD_STATE;
}

export function selectThreadPanelVisibility(
  byThreadKey: Record<string, ThreadPanelVisibility>,
  ref: ScopedThreadRef | null | undefined,
): ThreadPanelVisibility {
  if (!ref) return DEFAULT_THREAD_PANEL_VISIBILITY;
  return byThreadKey[scopedThreadKey(ref)] ?? DEFAULT_THREAD_PANEL_VISIBILITY;
}

export function selectThreadPanelOpen(
  byThreadKey: Record<string, ThreadPanelVisibility>,
  ref: ScopedThreadRef | null | undefined,
  presentation: ThreadPanelPresentation,
): boolean {
  const visibility = selectThreadPanelVisibility(byThreadKey, ref);
  return presentation === "inline" ? visibility.inlineOpen : visibility.popoverOpen;
}

export function selectActiveRightPanel(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelKind | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  if (!state.isOpen) return null;
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId)?.kind ?? null;
}

export function selectActiveRightPanelSurface(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelSurface | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  if (!state.isOpen) return null;
  return selectSelectedRightPanelSurface(byThreadKey, ref);
}

export function selectSelectedRightPanelSurface(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelSurface | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? null;
}
