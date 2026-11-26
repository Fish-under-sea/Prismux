import { scopeThreadRef, scopedThreadKey } from "@prismux/client-runtime/environment";
import type {
  EnvironmentId,
  OrchestrationV2CreationSource,
  ScopedThreadRef,
  ThreadId,
} from "@prismux/core-contracts";
import {
  DEFAULT_WORK_STEPS_COLLAPSE_TIMING,
  type WorkStepsCollapseTiming,
  type WorkStepsDisplay,
} from "@prismux/core-contracts/settings";

import type { SidebarThreadSummary } from "../../types";
import { resolveSidebarRowStatus, resolveThreadLastVisitedAt } from "../Sidebar.logic";

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
  readonly latestUserMessageAt?: string | null | undefined;
  readonly creationSource?: OrchestrationV2CreationSource | null | undefined;
  readonly source?:
    | {
        readonly creationSource?: OrchestrationV2CreationSource | null | undefined;
      }
    | null
    | undefined;
};

export type DelegatedTreeCollapseTiming = WorkStepsCollapseTiming | "never";

export interface DelegatedTreeExpansionEntry {
  /** Last reconciled auto-expand signal (`true` = should auto-expand, `false` = should auto-collapse). */
  readonly wasRunning: boolean;
  /** User manual override (`null` = follow automatic expand/collapse timing). */
  readonly manualExpanded: boolean | null;
}

/**
 * Maps chat work-steps settings to the sidebar delegated-tree collapse policy so
 * level-2 subagent trees auto-collapse in lockstep with work steps.
 */
export function resolveDelegatedTreeCollapseTiming(input: {
  readonly workStepsDisplay?: WorkStepsDisplay | undefined;
  readonly workStepsCollapseTiming?: WorkStepsCollapseTiming | undefined;
}): DelegatedTreeCollapseTiming {
  if (input.workStepsDisplay === "expanded") return "never";
  return input.workStepsCollapseTiming ?? DEFAULT_WORK_STEPS_COLLAPSE_TIMING;
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
 * Returns whether a thread (parent or delegated child) is genuinely actively running right now
 * (preparing, working, waiting on child while runtime is running, or paused mid-turn on
 * approval/user input). NEVER returns `true` for completed (including unseen green-check ✓),
 * failed, limited, or idle threads.
 */
export function isThreadActivelyRunning(
  thread: DelegatedChildThreadLike,
  localLastVisitedAt?: string | undefined,
): boolean {
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt);
  const status = resolveSidebarRowStatus({ ...thread, lastVisitedAt });
  if (
    status === "preparing" ||
    status === "working" ||
    status === "approval" ||
    status === "input"
  ) {
    return true;
  }
  if (status === "waiting" && thread.runtime?.status === "running") {
    return true;
  }
  return false;
}

/**
 * Returns whether a delegated child thread is currently running/active (driving both the
 * SVG branch RGB energy conduction and active-child indicators).
 */
export function isDelegatedChildThreadActive(
  thread: DelegatedChildThreadLike,
  localLastVisitedAt?: string | undefined,
): boolean {
  return isThreadActivelyRunning(thread, localLastVisitedAt);
}

function parseOptionalTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function latestTimestampMs(candidates: ReadonlyArray<string | null | undefined>): number | null {
  let latest: number | null = null;
  for (const candidate of candidates) {
    const ms = parseOptionalTimestampMs(candidate);
    if (ms !== null && (latest === null || ms > latest)) {
      latest = ms;
    }
  }
  return latest;
}

/**
 * Returns whether any delegated child belongs to the parent's latest/current turn
 * (i.e. no newer user message or run started in the parent after all delegated children ended).
 */
export function hasDelegatedChildInLatestParentTurn(
  parent: DelegatedChildThreadLike | undefined,
  children: readonly DelegatedChildThreadLike[],
): boolean {
  if (children.length === 0) return false;
  if (parent === undefined) return true;
  const parentTurnBoundaryMs = latestTimestampMs([
    parent.latestUserMessageAt,
    parent.latestRun?.requestedAt,
    parent.latestRun?.startedAt,
  ]);
  if (parentTurnBoundaryMs === null) return true;
  const latestChildMs = latestTimestampMs(
    children.flatMap((child) => [
      child.createdAt,
      child.latestRun?.requestedAt,
      child.latestRun?.startedAt,
      child.latestRun?.completedAt,
    ]),
  );
  if (latestChildMs === null) return true;
  return latestChildMs >= parentTurnBoundaryMs;
}

/**
 * Auto-expands while any delegated child or the parent's delegated turn is actively running,
 * then collapses in lockstep with `workStepsCollapseTiming` (`after-turn` / `next-message` / `never`).
 */
export function shouldDelegatedTreeAutoExpand(input: {
  readonly parent: DelegatedChildThreadLike | undefined;
  readonly children: readonly DelegatedChildThreadLike[];
  readonly collapseTiming?: DelegatedTreeCollapseTiming | undefined;
  readonly localLastVisitedAtById?: Readonly<Record<string, string | undefined>> | undefined;
}): boolean {
  const {
    parent,
    children,
    collapseTiming = DEFAULT_WORK_STEPS_COLLAPSE_TIMING,
    localLastVisitedAtById,
  } = input;
  if (children.length === 0) return false;
  if (collapseTiming === "never") return true;

  const anyChildActive = children.some((child) => {
    const childKey = scopedThreadKey(scopeThreadRef(child.environmentId, child.id));
    return isDelegatedChildThreadActive(child, localLastVisitedAtById?.[childKey]);
  });
  if (anyChildActive) return true;

  const inLatestTurn = hasDelegatedChildInLatestParentTurn(parent, children);
  const parentActive =
    parent !== undefined &&
    isThreadActivelyRunning(
      parent,
      localLastVisitedAtById?.[scopedThreadKey(scopeThreadRef(parent.environmentId, parent.id))],
    );
  if (parentActive && inLatestTurn) return true;

  if (collapseTiming === "next-message") {
    return inLatestTurn;
  }
  return false;
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
