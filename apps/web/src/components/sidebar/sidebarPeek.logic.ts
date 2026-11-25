import type { EnvironmentId, ProjectId, ThreadId } from "@prismux/core-contracts";

/** Anti-accidental-trigger hover dwell delay before the collapsed sidebar peek drawer opens. */
export const SIDEBAR_PEEK_OPEN_DELAY_MS = 140;

/** Leave grace delay so moving the pointer from the 54px icon rail into the floating drawer never flickers. */
export const SIDEBAR_PEEK_CLOSE_DELAY_MS = 220;

/** Floating peek drawer width matching Claude Code Desktop's compact rounded overlay sidebar. */
export const SIDEBAR_PEEK_WIDTH_PX = 268;

export interface SidebarPeekStateInput {
  readonly railCompact: boolean;
  readonly pointerInRail: boolean;
  readonly pointerInDrawer: boolean;
  readonly openMenuCount: number;
  readonly dismissedByEscape: boolean;
  /** Pointer over the collapsed expand trigger must never open a floating hover preview. */
  readonly pointerInExpandTrigger?: boolean;
}

export type SidebarPeekDecision =
  | "open"
  | "schedule-open"
  | "keep-open"
  | "schedule-close"
  | "close-now";

/**
 * Pure state machine deciding whether the collapsed sidebar floating peek drawer should
 * open immediately, schedule a delayed open/close, stay open, or close immediately.
 * Hovering the collapsed expand button always resolves to `close-now` so floating previews
 * can never cover the expand trigger or steal clicks.
 */
export function resolveSidebarPeekDecision(
  currentlyOpen: boolean,
  input: SidebarPeekStateInput,
): SidebarPeekDecision {
  if (!input.railCompact || input.dismissedByEscape || input.pointerInExpandTrigger) {
    return "close-now";
  }
  if (input.openMenuCount > 0) {
    return currentlyOpen ? "keep-open" : "close-now";
  }
  if (input.pointerInDrawer) {
    return currentlyOpen ? "keep-open" : "open";
  }
  if (input.pointerInRail) {
    return currentlyOpen ? "keep-open" : "schedule-open";
  }
  return currentlyOpen ? "schedule-close" : "close-now";
}

export interface SidebarPeekProjectInput {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly title: string;
  readonly archivedAt?: string | null | undefined;
  readonly isScratch?: boolean | undefined;
}

export interface SidebarPeekThreadInput {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly branch?: string | null | undefined;
  readonly updatedAt: string;
  readonly archivedAt?: string | null | undefined;
  readonly pinnedAt?: string | null | undefined;
  readonly isSubagent?: boolean | undefined;
  readonly isRunning?: boolean | undefined;
  readonly needsAttention?: boolean | undefined;
}

export interface SidebarPeekProjectGroup {
  readonly project: SidebarPeekProjectInput;
  readonly threads: readonly SidebarPeekThreadInput[];
}

export function buildSidebarPeekGroups(input: {
  readonly projects: readonly SidebarPeekProjectInput[];
  readonly threads: readonly SidebarPeekThreadInput[];
  readonly maxProjects?: number;
  readonly maxThreadsPerProject?: number;
}): {
  readonly groups: readonly SidebarPeekProjectGroup[];
  readonly recentThreads: readonly SidebarPeekThreadInput[];
} {
  const maxProjects = input.maxProjects ?? 8;
  const maxThreadsPerProject = input.maxThreadsPerProject ?? 4;

  const liveThreads = input.threads
    .filter((thread) => thread.archivedAt == null && !thread.isSubagent)
    .toSorted((a, b) => {
      const aPinned = a.pinnedAt ? 1 : 0;
      const bPinned = b.pinnedAt ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  const threadsByProjectKey = new Map<string, SidebarPeekThreadInput[]>();
  for (const thread of liveThreads) {
    const key = `${thread.environmentId}:${thread.projectId}`;
    const bucket = threadsByProjectKey.get(key);
    if (bucket) {
      if (bucket.length < maxThreadsPerProject) {
        bucket.push(thread);
      }
    } else {
      threadsByProjectKey.set(key, [thread]);
    }
  }

  const liveProjects = input.projects
    .filter((project) => project.archivedAt == null && !project.isScratch)
    .toSorted((a, b) => {
      const aLatest = threadsByProjectKey.get(`${a.environmentId}:${a.id}`)?.[0]?.updatedAt ?? "";
      const bLatest = threadsByProjectKey.get(`${b.environmentId}:${b.id}`)?.[0]?.updatedAt ?? "";
      if (aLatest !== bLatest) return bLatest.localeCompare(aLatest);
      return a.title.localeCompare(b.title);
    });

  const groups: SidebarPeekProjectGroup[] = liveProjects.slice(0, maxProjects).map((project) => ({
    project,
    threads: threadsByProjectKey.get(`${project.environmentId}:${project.id}`) ?? [],
  }));

  return {
    groups,
    recentThreads: liveThreads.slice(0, 8),
  };
}
