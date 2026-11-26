import { scopeThreadRef, scopedThreadKey } from "@prismux/client-runtime/environment";
import type {
  EnvironmentId,
  OrchestrationV2CreationSource,
  ScopedThreadRef,
  ThreadId,
} from "@prismux/core-contracts";

import type { SidebarThreadSummary } from "../../types";
import { resolveSidebarRowStatus, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { resolveAgentRuntimeLamp } from "./sidebarMicroIndicators";

export type DelegatedChildThreadLike = Pick<
  SidebarThreadSummary,
  | "environmentId"
  | "id"
  | "createdAt"
  | "archivedAt"
  | "deletedAt"
  | "lineage"
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "pendingGuestMessageCount"
  | "interactionMode"
  | "latestRun"
  | "runtime"
  | "blockedOnThreadWait"
  | "lastVisitedAt"
  | "pendingBackgroundTasks"
> & {
  readonly creationSource?: OrchestrationV2CreationSource | null | undefined;
  readonly source?:
    | {
        readonly creationSource?: OrchestrationV2CreationSource | null | undefined;
      }
    | null
    | undefined;
};

export interface DelegatedTreeExpansionEntry {
  /** Whether the parent had at least one running/active delegated child on last sync. */
  readonly wasRunning: boolean;
  /** User manual override (`null` = automatic expand-on-running / collapse-on-complete). */
  readonly manualExpanded: boolean | null;
}

/**
 * Resolves a thread's creation source from either top-level `creationSource` or `thread.source.creationSource`.
 */
export function resolveThreadCreationSource(
  thread: Pick<DelegatedChildThreadLike, "creationSource" | "source">,
): OrchestrationV2CreationSource | null {
  return thread.creationSource ?? thread.source?.creationSource ?? null;
}

/**
 * Strictly matches Prismux MCP-delegated child threads (`relationshipToParent === "subagent"`
 * and `creationSource !== "provider"`), excluding native provider-internal subagents,
 * side chats (`sideChat === true`), archived threads, deleted threads, and orphan threads.
 */
export function isPrismuxDelegatedChildThread(
  thread: Pick<
    DelegatedChildThreadLike,
    "archivedAt" | "deletedAt" | "lineage" | "creationSource" | "source"
  >,
): boolean {
  if (thread.archivedAt !== null) return false;
  if (thread.deletedAt != null) return false;
  if (thread.lineage.sideChat === true) return false;
  if (thread.lineage.relationshipToParent !== "subagent") return false;
  if (thread.lineage.parentThreadId === null) return false;
  if (resolveThreadCreationSource(thread) === "provider") return false;
  return true;
}

/**
 * Returns whether a delegated child thread is currently running/active (driving both the
 * SVG branch RGB energy conduction and auto-expand policy).
 */
export function isDelegatedChildThreadActive(
  thread: DelegatedChildThreadLike,
  localLastVisitedAt?: string | undefined,
): boolean {
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt);
  const status = resolveSidebarRowStatus({ ...thread, lastVisitedAt });
  return resolveAgentRuntimeLamp(status).state !== "idle";
}

function compareChildThreadsChronologically(
  left: Pick<DelegatedChildThreadLike, "createdAt" | "id">,
  right: Pick<DelegatedChildThreadLike, "createdAt" | "id">,
): number {
  const leftMs = Date.parse(left.createdAt);
  const rightMs = Date.parse(right.createdAt);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
    return leftMs - rightMs;
  }
  return left.id.localeCompare(right.id);
}

/**
 * Groups Prismux MCP-delegated level-2 child threads by their parent's scoped thread key
 * (`scopedThreadKey(scopeThreadRef(child.environmentId, child.lineage.parentThreadId))`).
 * Children under each parent are ordered chronologically (oldest first) for a stable tree.
 */
export function groupDelegatedChildThreadsByParent<T extends DelegatedChildThreadLike>(
  threads: readonly T[],
): Map<string, readonly T[]> {
  const mutable = new Map<string, T[]>();
  for (const thread of threads) {
    if (!isPrismuxDelegatedChildThread(thread)) continue;
    const parentThreadId = thread.lineage.parentThreadId;
    if (parentThreadId === null) continue;
    const parentKey = scopedThreadKey(scopeThreadRef(thread.environmentId, parentThreadId));
    const bucket = mutable.get(parentKey);
    if (bucket) {
      bucket.push(thread);
    } else {
      mutable.set(parentKey, [thread]);
    }
  }
  const grouped = new Map<string, readonly T[]>();
  for (const [parentKey, bucket] of mutable) {
    if (bucket.length > 1) {
      bucket.sort(compareChildThreadsChronologically);
    }
    grouped.set(parentKey, bucket);
  }
  return grouped;
}

/** Auto-expands while any child runs, auto-collapses when all finish, honoring manual overrides until state transitions. */
export function resolveDelegatedTreeExpanded(input: {
  readonly hasRunningChild: boolean;
  readonly entry: DelegatedTreeExpansionEntry | undefined;
}): boolean {
  const { hasRunningChild, entry } = input;
  if (entry && entry.wasRunning === hasRunningChild && entry.manualExpanded !== null) {
    return entry.manualExpanded;
  }
  return hasRunningChild;
}

/**
 * Reconciles persisted per-parent expansion entries against the latest running status per parent.
 * Clears manual overrides whenever a parent transitions between running and all-completed so
 * running transitions auto-expand and completion transitions auto-collapse without resurrecting
 * stale overrides from earlier cycles. Returns `previous` unchanged when nothing changed.
 */
export function reconcileDelegatedTreeExpansionMap(
  previous: ReadonlyMap<string, DelegatedTreeExpansionEntry>,
  runningByParent: ReadonlyMap<string, boolean>,
): ReadonlyMap<string, DelegatedTreeExpansionEntry> {
  let changed = false;

  for (const parentKey of previous.keys()) {
    if (!runningByParent.has(parentKey)) {
      changed = true;
      break;
    }
  }
  if (!changed) {
    for (const [parentKey, hasRunning] of runningByParent) {
      const current = previous.get(parentKey);
      if (current === undefined || current.wasRunning !== hasRunning) {
        changed = true;
        break;
      }
    }
  }
  if (!changed) return previous;

  const next = new Map<string, DelegatedTreeExpansionEntry>();
  for (const [parentKey, hasRunning] of runningByParent) {
    const current = previous.get(parentKey);
    if (current && current.wasRunning === hasRunning) {
      next.set(parentKey, current);
    } else {
      next.set(parentKey, {
        wasRunning: hasRunning,
        manualExpanded: null,
      });
    }
  }
  return next;
}

/**
 * Toggles manual expand/collapse for a parent thread while recording the current running state
 * so a subsequent running <-> idle state transition can still trigger automatic behavior.
 */
export function toggleDelegatedTreeExpansion(
  previous: ReadonlyMap<string, DelegatedTreeExpansionEntry>,
  parentKey: string,
  hasRunningChild: boolean,
): Map<string, DelegatedTreeExpansionEntry> {
  const currentExpanded = resolveDelegatedTreeExpanded({
    hasRunningChild,
    entry: previous.get(parentKey),
  });
  const next = new Map(previous);
  next.set(parentKey, {
    wasRunning: hasRunningChild,
    manualExpanded: !currentExpanded,
  });
  return next;
}

/**
 * Collects all attached delegated child thread refs under `parentKey` for cascade archive / delete /
 * settle / unsettle operations. Guards against cycles and returns an empty array for leaf threads.
 */
export function collectDelegatedChildThreadRefs(
  parentKey: string,
  childThreadsByParent: ReadonlyMap<
    string,
    ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly id: ThreadId }>
  >,
): readonly ScopedThreadRef[] {
  const visited = new Set<string>([parentKey]);
  const queue: string[] = [parentKey];
  const collected: ScopedThreadRef[] = [];

  for (let index = 0; index < queue.length; index += 1) {
    const currentParentKey = queue[index]!;
    const children = childThreadsByParent.get(currentParentKey);
    if (!children || children.length === 0) continue;
    for (const child of children) {
      const ref = scopeThreadRef(child.environmentId, child.id);
      const childKey = scopedThreadKey(ref);
      if (visited.has(childKey)) continue;
      visited.add(childKey);
      collected.push(ref);
      queue.push(childKey);
    }
  }

  return collected;
}
