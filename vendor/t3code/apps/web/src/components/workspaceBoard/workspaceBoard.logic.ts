import { useLocale } from "gt-react";

import { getActiveLocale } from "../../i18n/messages";
import type { SidebarStorageLike } from "../sidebar/prismuxSidebarQuickNav.logic";

export const WORKSPACE_BOARD_LANE_ORDER = [
  "todo",
  "in-progress",
  "in-review",
  "done",
] as const;

export type WorkspaceBoardLaneId = (typeof WORKSPACE_BOARD_LANE_ORDER)[number];

export const WORKSPACE_BOARD_STORAGE_KEY = "prismux.workspaceBoard.state.v1" as const;

export interface WorkspaceBoardLaneMeta {
  readonly id: WorkspaceBoardLaneId;
  readonly label: string;
  readonly borderTopClass: string;
  readonly laneTintClass: string;
  readonly iconToneClass: string;
  readonly swatchClass: string;
}

/**
 * 1:1 Orca Workspace Board lane definitions & color accents
 * (aligned with `stablyai/orca` `workspace-status.ts`:
 * neutral -> `#d4a300` conductor-progress -> `#16a34a` conductor-review -> `#c7a594` conductor-done).
 */
export const WORKSPACE_BOARD_LANES: readonly WorkspaceBoardLaneMeta[] = [
  {
    id: "todo",
    label: "Todo",
    borderTopClass: "border-t-muted-foreground/45",
    laneTintClass: "bg-background/50",
    iconToneClass: "text-muted-foreground",
    swatchClass: "bg-muted-foreground",
  },
  {
    id: "in-progress",
    label: "In progress",
    borderTopClass: "border-t-[#d4a300]/75",
    laneTintClass: "bg-[#d4a300]/[0.05]",
    iconToneClass: "text-[#d4a300]",
    swatchClass: "bg-[#d4a300]",
  },
  {
    id: "in-review",
    label: "In review",
    borderTopClass: "border-t-[#16a34a]/75",
    laneTintClass: "bg-[#16a34a]/[0.05]",
    iconToneClass: "text-[#16a34a]",
    swatchClass: "bg-[#16a34a]",
  },
  {
    id: "done",
    label: "Done",
    borderTopClass: "border-t-[#c7a594]/75",
    laneTintClass: "bg-[#c7a594]/[0.05]",
    iconToneClass: "text-[#c7a594]",
    swatchClass: "bg-[#c7a594]",
  },
] as const;

export interface WorkspaceBoardPersistedState {
  readonly laneOverrides: Readonly<Record<string, WorkspaceBoardLaneId>>;
  readonly pinnedKeys: readonly string[];
  readonly unpinnedKeys: readonly string[];
  readonly compactMode: boolean;
  readonly showBranchBadge: boolean;
}

export const DEFAULT_WORKSPACE_BOARD_STATE: WorkspaceBoardPersistedState = {
  laneOverrides: {},
  pinnedKeys: [],
  unpinnedKeys: [],
  compactMode: false,
  showBranchBadge: true,
};

export interface WorkspaceBoardCardInput {
  readonly key: string;
  readonly environmentId: string;
  readonly threadId: string;
  readonly projectKey: string;
  readonly projectTitle: string;
  readonly environmentLabel: string | null;
  readonly title: string;
  readonly branch: string | null;
  readonly modelName: string | null;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly settledOverride: "settled" | "active" | null;
  readonly settledAt: string | null;
  readonly pinnedAt: string | null;
  readonly isRunning: boolean;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly hasActionableProposedPlan: boolean;
  readonly hasPendingBackgroundTasks: boolean;
  readonly pullRequestsCount: number;
}

export interface WorkspaceBoardCard extends WorkspaceBoardCardInput {
  readonly lane: WorkspaceBoardLaneId;
  readonly isPinned: boolean;
}

export interface WorkspaceBoardFilters {
  readonly query: string;
  readonly projectKey: string | null;
  readonly pinnedOnly: boolean;
  readonly activeOnly: boolean;
}

export const EMPTY_WORKSPACE_BOARD_FILTERS: WorkspaceBoardFilters = {
  query: "",
  projectKey: null,
  pinnedOnly: false,
  activeOnly: false,
};

export interface WorkspaceBoardProjection {
  readonly totalCount: number;
  readonly matchCount: number;
  readonly isFiltering: boolean;
  readonly pinnedCards: readonly WorkspaceBoardCard[];
  readonly lanes: Readonly<Record<WorkspaceBoardLaneId, readonly WorkspaceBoardCard[]>>;
  readonly laneTotals: Readonly<Record<WorkspaceBoardLaneId, number>>;
}

export interface WorkspaceBoardCopy {
  readonly isZh: boolean;
  readonly title: string;
  readonly searchPlaceholder: string;
  readonly clearSearchLabel: string;
  readonly filterTooltip: string;
  readonly filterTitle: string;
  readonly filterAllProjects: string;
  readonly filterPinnedOnly: string;
  readonly filterActiveOnly: string;
  readonly filterReset: string;
  readonly settingsTooltip: string;
  readonly settingsTitle: string;
  readonly settingCompactCards: string;
  readonly settingShowBranch: string;
  readonly settingResetOverrides: string;
  readonly closeLabel: string;
  readonly closeTooltip: string;
  readonly pinnedTitle: string;
  readonly pinnedDropHint: string;
  readonly pinnedDropActiveHint: string;
  readonly unpinAction: string;
  readonly pinAction: string;
  readonly createWorkspaceTooltip: (laneLabel: string) => string;
  readonly laneEmpty: string;
  readonly laneNoMatches: string;
  readonly statusRunning: string;
  readonly statusNeedsAttention: string;
  readonly statusReviewReady: string;
  readonly moveCardMenuLabel: string;
}

const ZH_COPY: WorkspaceBoardCopy = {
  isZh: true,
  title: "工作区板",
  searchPlaceholder: "搜索工作区",
  clearSearchLabel: "清空搜索",
  filterTooltip: "筛选工作区",
  filterTitle: "筛选条件",
  filterAllProjects: "全部项目",
  filterPinnedOnly: "仅显示已固定",
  filterActiveOnly: "仅显示运行中 / 待介入",
  filterReset: "重置筛选",
  settingsTooltip: "视图设置",
  settingsTitle: "看板视图设置",
  settingCompactCards: "紧凑卡片模式",
  settingShowBranch: "显示分支标签",
  settingResetOverrides: "重置手动分组排序",
  closeLabel: "关闭工作区板",
  closeTooltip: "关闭 · Esc",
  pinnedTitle: "已固定",
  pinnedDropHint: "拖放到此处即可固定，无需更改状态。",
  pinnedDropActiveHint: "松开即可固定该工作区（保持原状态不变）",
  unpinAction: "取消固定",
  pinAction: "固定工作区",
  createWorkspaceTooltip: (laneLabel) => `在 ${laneLabel} 新建工作区`,
  laneEmpty: "空",
  laneNoMatches: "无匹配项",
  statusRunning: "运行中",
  statusNeedsAttention: "待介入",
  statusReviewReady: "待审查",
  moveCardMenuLabel: "移动到列",
};

const EN_COPY: WorkspaceBoardCopy = {
  isZh: false,
  title: "Workspace board",
  searchPlaceholder: "Search workspaces",
  clearSearchLabel: "Clear search",
  filterTooltip: "Filter workspaces",
  filterTitle: "Filters",
  filterAllProjects: "All projects",
  filterPinnedOnly: "Pinned only",
  filterActiveOnly: "Running / needs attention",
  filterReset: "Reset filters",
  settingsTooltip: "Board settings",
  settingsTitle: "Board view settings",
  settingCompactCards: "Compact cards",
  settingShowBranch: "Show branch badge",
  settingResetOverrides: "Reset manual lane overrides",
  closeLabel: "Close workspace board",
  closeTooltip: "Close · Esc",
  pinnedTitle: "Pinned",
  pinnedDropHint: "Drop here to pin without changing status.",
  pinnedDropActiveHint: "Release to pin workspace without changing its status",
  unpinAction: "Unpin",
  pinAction: "Pin workspace",
  createWorkspaceTooltip: (laneLabel) => `Create workspace in ${laneLabel}`,
  laneEmpty: "Empty",
  laneNoMatches: "No matches",
  statusRunning: "Running",
  statusNeedsAttention: "Needs you",
  statusReviewReady: "In review",
  moveCardMenuLabel: "Move to lane",
};

export function getWorkspaceBoardCopy(locale: string | null | undefined): WorkspaceBoardCopy {
  const normalized = (locale ?? getActiveLocale() ?? "en").toLowerCase();
  return normalized.startsWith("zh") ? ZH_COPY : EN_COPY;
}

export function useWorkspaceBoardCopy(): WorkspaceBoardCopy {
  const locale = useLocale();
  return getWorkspaceBoardCopy(locale);
}

export function isWorkspaceBoardLaneId(value: unknown): value is WorkspaceBoardLaneId {
  return (
    value === "todo" ||
    value === "in-progress" ||
    value === "in-review" ||
    value === "done"
  );
}

export function inferWorkspaceBoardLane(
  input: Pick<
    WorkspaceBoardCardInput,
    | "archivedAt"
    | "settledOverride"
    | "settledAt"
    | "isRunning"
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "hasActionableProposedPlan"
    | "hasPendingBackgroundTasks"
    | "pullRequestsCount"
  >,
): WorkspaceBoardLaneId {
  if (
    input.archivedAt !== null ||
    input.settledOverride === "settled" ||
    input.settledAt !== null
  ) {
    return "done";
  }
  if (
    input.hasPendingApprovals ||
    input.hasPendingUserInput ||
    input.hasActionableProposedPlan ||
    (input.pullRequestsCount > 0 && !input.isRunning)
  ) {
    return "in-review";
  }
  if (input.isRunning || input.hasPendingBackgroundTasks) {
    return "in-progress";
  }
  return "todo";
}

export function resolveCardLane(
  input: WorkspaceBoardCardInput,
  state: WorkspaceBoardPersistedState,
): WorkspaceBoardLaneId {
  const override = state.laneOverrides[input.key];
  if (override && isWorkspaceBoardLaneId(override)) {
    return override;
  }
  return inferWorkspaceBoardLane(input);
}

export function resolveCardPinned(
  input: Pick<WorkspaceBoardCardInput, "key" | "pinnedAt">,
  state: WorkspaceBoardPersistedState,
): boolean {
  if (state.pinnedKeys.includes(input.key)) return true;
  if (state.unpinnedKeys.includes(input.key)) return false;
  return input.pinnedAt !== null;
}

export function moveWorkspaceCardToLane(
  state: WorkspaceBoardPersistedState,
  cardKey: string,
  laneId: WorkspaceBoardLaneId,
): WorkspaceBoardPersistedState {
  if (state.laneOverrides[cardKey] === laneId) return state;
  return {
    ...state,
    laneOverrides: {
      ...state.laneOverrides,
      [cardKey]: laneId,
    },
  };
}

export function pinWorkspaceCard(
  state: WorkspaceBoardPersistedState,
  cardKey: string,
): WorkspaceBoardPersistedState {
  const nextUnpinned = state.unpinnedKeys.filter((key) => key !== cardKey);
  if (state.pinnedKeys.includes(cardKey) && nextUnpinned.length === state.unpinnedKeys.length) {
    return state;
  }
  return {
    ...state,
    pinnedKeys: [cardKey, ...state.pinnedKeys.filter((key) => key !== cardKey)],
    unpinnedKeys: nextUnpinned,
  };
}

export function unpinWorkspaceCard(
  state: WorkspaceBoardPersistedState,
  cardKey: string,
): WorkspaceBoardPersistedState {
  const nextPinned = state.pinnedKeys.filter((key) => key !== cardKey);
  const nextUnpinned = state.unpinnedKeys.includes(cardKey)
    ? state.unpinnedKeys
    : [...state.unpinnedKeys, cardKey];
  return {
    ...state,
    pinnedKeys: nextPinned,
    unpinnedKeys: nextUnpinned,
  };
}

export function togglePinWorkspaceCard(
  state: WorkspaceBoardPersistedState,
  cardKey: string,
  currentlyPinned: boolean,
): WorkspaceBoardPersistedState {
  return currentlyPinned
    ? unpinWorkspaceCard(state, cardKey)
    : pinWorkspaceCard(state, cardKey);
}

export function resetWorkspaceLaneOverrides(
  state: WorkspaceBoardPersistedState,
): WorkspaceBoardPersistedState {
  if (Object.keys(state.laneOverrides).length === 0) return state;
  return {
    ...state,
    laneOverrides: {},
  };
}

function cardMatchesFilters(card: WorkspaceBoardCard, filters: WorkspaceBoardFilters): boolean {
  if (filters.projectKey && card.projectKey !== filters.projectKey) return false;
  if (filters.pinnedOnly && !card.isPinned) return false;
  if (
    filters.activeOnly &&
    !card.isRunning &&
    !card.hasPendingApprovals &&
    !card.hasPendingUserInput
  ) {
    return false;
  }
  const needle = filters.query.trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [
    card.title,
    card.projectTitle,
    card.branch ?? "",
    card.modelName ?? "",
    card.environmentLabel ?? "",
  ];
  return haystacks.some((part) => part.toLowerCase().includes(needle));
}

export function buildWorkspaceBoardProjection(
  inputs: readonly WorkspaceBoardCardInput[],
  state: WorkspaceBoardPersistedState,
  filters: WorkspaceBoardFilters,
): WorkspaceBoardProjection {
  const isFiltering =
    filters.query.trim().length > 0 ||
    filters.projectKey !== null ||
    filters.pinnedOnly ||
    filters.activeOnly;

  const laneBuckets: Record<WorkspaceBoardLaneId, WorkspaceBoardCard[]> = {
    todo: [],
    "in-progress": [],
    "in-review": [],
    done: [],
  };
  const laneTotals: Record<WorkspaceBoardLaneId, number> = {
    todo: 0,
    "in-progress": 0,
    "in-review": 0,
    done: 0,
  };
  const pinnedCards: WorkspaceBoardCard[] = [];
  let matchCount = 0;

  for (const input of inputs) {
    const lane = resolveCardLane(input, state);
    const isPinned = resolveCardPinned(input, state);
    const card: WorkspaceBoardCard = { ...input, lane, isPinned };
    laneTotals[lane] += 1;

    if (!cardMatchesFilters(card, filters)) continue;
    matchCount += 1;
    laneBuckets[lane].push(card);
    if (card.isPinned) {
      pinnedCards.push(card);
    }
  }

  const sortCards = (cards: WorkspaceBoardCard[]) => {
    cards.sort((left, right) => {
      if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
      const rightMs = Date.parse(right.updatedAt);
      const leftMs = Date.parse(left.updatedAt);
      return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
    });
  };

  for (const laneId of WORKSPACE_BOARD_LANE_ORDER) {
    sortCards(laneBuckets[laneId]);
  }
  sortCards(pinnedCards);

  return {
    totalCount: inputs.length,
    matchCount,
    isFiltering,
    pinnedCards,
    lanes: laneBuckets,
    laneTotals,
  };
}

function getDefaultStorage(): SidebarStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readWorkspaceBoardState(
  storage: SidebarStorageLike | null = getDefaultStorage(),
): WorkspaceBoardPersistedState {
  if (!storage) return DEFAULT_WORKSPACE_BOARD_STATE;
  try {
    const raw = storage.getItem(WORKSPACE_BOARD_STORAGE_KEY);
    if (!raw) return DEFAULT_WORKSPACE_BOARD_STATE;
    const parsed = JSON.parse(raw) as Partial<WorkspaceBoardPersistedState> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_WORKSPACE_BOARD_STATE;
    const overrides: Record<string, WorkspaceBoardLaneId> = {};
    if (parsed.laneOverrides && typeof parsed.laneOverrides === "object") {
      for (const [key, value] of Object.entries(parsed.laneOverrides)) {
        if (isWorkspaceBoardLaneId(value)) {
          overrides[key] = value;
        }
      }
    }
    const pinnedKeys = Array.isArray(parsed.pinnedKeys)
      ? parsed.pinnedKeys.filter((item): item is string => typeof item === "string")
      : [];
    const unpinnedKeys = Array.isArray(parsed.unpinnedKeys)
      ? parsed.unpinnedKeys.filter((item): item is string => typeof item === "string")
      : [];
    return {
      laneOverrides: overrides,
      pinnedKeys,
      unpinnedKeys,
      compactMode: parsed.compactMode === true,
      showBranchBadge: parsed.showBranchBadge !== false,
    };
  } catch {
    return DEFAULT_WORKSPACE_BOARD_STATE;
  }
}

export function writeWorkspaceBoardState(
  state: WorkspaceBoardPersistedState,
  storage: SidebarStorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(WORKSPACE_BOARD_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota / private mode errors.
  }
}
