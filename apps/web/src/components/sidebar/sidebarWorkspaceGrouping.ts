import { scopeThreadRef, scopedThreadKey } from "@prismux/client-runtime/environment";
import type { EnvironmentThreadShell } from "@prismux/client-runtime/state/models";
import type {
  EnvironmentId,
  EnvironmentMachineKind,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@prismux/core-contracts";
import { formatModelSlugName } from "@prismux/core-shared/model";
import { msg } from "gt-react";

import { m } from "../../i18n/messages";
import { getTriggerDisplayModelName, type ModelEsque } from "../chat/providerIconUtils";
import { resolveSidebarRowStatus, resolveThreadLastVisitedAt } from "../Sidebar.logic";

/**
 * Shared HTML5 DnD MIME & CustomEvent bridge between the Orca Compact Sidebar
 * (`SidebarThreadRow`) and the recursive Split Anything workspace (`WorkspaceSplitContainer`).
 * Keep strictly aligned with `#646` Section 4.B.
 */
export const PRISMUX_SPLIT_ITEM_MIME = "application/x-prismux-split-item" as const;
export const PRISMUX_SPLIT_DRAG_EVENT = "prismux:split-drag" as const;

export interface SidebarThreadSplitDragPayload {
  readonly kind: "sidebar-thread";
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly providerId?: string | null;
  readonly instanceId?: ProviderInstanceId | null;
}

export interface PrismuxSplitDragEventDetail {
  readonly active: boolean;
  readonly payload: SidebarThreadSplitDragPayload | null;
}

export function dispatchSidebarSplitDragEvent(
  active: boolean,
  payload: SidebarThreadSplitDragPayload | null,
): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PrismuxSplitDragEventDetail>(PRISMUX_SPLIT_DRAG_EVENT, {
      detail: { active, payload },
    }),
  );
}

/**
 * Normalizes any model slug or catalog entry into a clean Title-Case short name
 * (`6.2 Astra`, `6 Astra`, `Fable 5.2`, `Opus 5.5`, `4 Neon`, `Grok 4.7`) —
 * never leaking raw lowercase hyphenated slugs or routing gateway prefixes.
 */
export function resolveSidebarModelShortName(input: {
  readonly modelSlug: string;
  readonly selectedModel?: ModelEsque | null | undefined;
  readonly driverKind?: ProviderDriverKind | null | undefined;
}): string {
  const rawSlug = input.modelSlug.trim();
  const candidate = input.selectedModel
    ? getTriggerDisplayModelName(input.selectedModel, input.driverKind).trim()
    : formatModelSlugName(rawSlug).trim();

  if (!candidate) {
    return formatModelSlugName(rawSlug) || rawSlug;
  }

  // Guard against catalog entries whose display name is still a raw lowercase slug or prefixed wire id.
  if (
    /^(?:[a-z0-9._-]+\/)+[a-z0-9._-]+$/i.test(candidate) ||
    /^(?:gpt|claude|gemini|grok|opus|sonnet|haiku|fable|deepseek|qwen|glm)[-_]/i.test(candidate) ||
    /^[a-z0-9]+(?:[-_][a-z0-9.]+)+$/.test(candidate)
  ) {
    const normalized = formatModelSlugName(candidate).trim();
    if (normalized) return normalized;
  }

  return candidate;
}

export const PRIMARY_WORKTREE_SENTINEL = "__primary__" as const;

export type SidebarWorkspaceStatus = "working" | "attention" | "failed" | "ready" | "idle";

export interface SidebarWorkspaceGroup<
  TThread extends EnvironmentThreadShell = EnvironmentThreadShell,
> {
  readonly workspaceKey: string;
  readonly worktreePath: string | null;
  readonly branch: string | null;
  readonly title: string;
  readonly isPrimary: boolean;
  readonly isSelected: boolean;
  readonly status: SidebarWorkspaceStatus;
  readonly threads: readonly TThread[];
  readonly latestActivityMs: number;
}

const GENERIC_DEFAULT_BRANCHES = new Set(["main", "master", "develop", "dev", "head"]);
const OPAQUE_WORKTREE_BASENAME_PATTERN = /^(?:prismux|t3)[-_][0-9a-f]{6,}$/i;

function extractPathBasename(rawPath: string): string {
  const cleaned = rawPath.trim().replace(/[\\/]+$/, "");
  if (!cleaned) return "";
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  return parts.at(-1)?.trim() ?? "";
}

function extractBranchLeaf(branch: string): string {
  const cleaned = branch.trim().replace(/^refs\/heads\//i, "");
  if (!cleaned) return "";
  const parts = cleaned.split("/").filter(Boolean);
  return parts.at(-1)?.trim() ?? cleaned;
}

export function resolveWorkspaceGroupKey(
  thread: Pick<EnvironmentThreadShell, "worktreePath" | "branch">,
): string {
  const worktreeKey = thread.worktreePath?.trim() || PRIMARY_WORKTREE_SENTINEL;
  const branchKey = thread.branch?.trim() || "";
  return `${worktreeKey}\0${branchKey}`;
}

export function deriveWorkspaceCardTitle(input: {
  readonly worktreePath: string | null;
  readonly branch: string | null;
  readonly projectDisplayName: string;
  readonly threads: ReadonlyArray<Pick<EnvironmentThreadShell, "title">>;
}): string {
  const trimmedWorktree = input.worktreePath?.trim() || null;
  const trimmedBranch = input.branch?.trim() || null;
  const branchLeaf = trimmedBranch ? extractBranchLeaf(trimmedBranch) : "";
  const hasFeatureBranch =
    branchLeaf.length > 0 && !GENERIC_DEFAULT_BRANCHES.has(branchLeaf.toLowerCase());

  if (trimmedWorktree !== null) {
    const basename = extractPathBasename(trimmedWorktree);
    if (basename.length > 0 && !OPAQUE_WORKTREE_BASENAME_PATTERN.test(basename)) {
      return basename;
    }
    if (input.threads.length === 1) {
      const onlyTitle = input.threads[0]?.title.trim();
      if (onlyTitle) return onlyTitle;
    }
    if (hasFeatureBranch) {
      return branchLeaf;
    }
  } else if (hasFeatureBranch) {
    return branchLeaf;
  }

  const projectName = input.projectDisplayName.trim();
  if (projectName) return projectName;

  const firstTitle = input.threads[0]?.title.trim();
  return firstTitle || m(msg("Workspace"));
}

function resolveThreadActivityMs(
  thread: Pick<EnvironmentThreadShell, "latestRun" | "updatedAt" | "createdAt">,
): number {
  const iso = thread.latestRun?.completedAt ?? thread.updatedAt ?? thread.createdAt;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveWorkspaceStatus(
  threads: readonly EnvironmentThreadShell[],
  localLastVisitedAtById: Readonly<Record<string, string | undefined>> = {},
): SidebarWorkspaceStatus {
  let sawAttention = false;
  let sawFailed = false;
  let sawReady = false;

  for (const thread of threads) {
    const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const lastVisitedAt = resolveThreadLastVisitedAt(
      thread.lastVisitedAt,
      localLastVisitedAtById[threadKey],
    );
    const rowStatus = resolveSidebarRowStatus({ ...thread, lastVisitedAt });
    if (rowStatus === "working" || rowStatus === "preparing") {
      return "working";
    }
    if (rowStatus === "approval" || rowStatus === "input" || rowStatus === "request") {
      sawAttention = true;
    } else if (rowStatus === "failed" || rowStatus === "limited") {
      sawFailed = true;
    } else if (rowStatus === "ready" && thread.latestRun !== null) {
      sawReady = true;
    }
  }

  if (sawAttention) return "attention";
  if (sawFailed) return "failed";
  if (sawReady) return "ready";
  return "idle";
}

/**
 * Partitions a project's threads into Orca Workspace Cards keyed by
 * `(worktreePath ?? "__primary__", branch ?? "")`. Primary checkouts sort first.
 */
export function groupProjectThreadsByWorkspace<
  TThread extends EnvironmentThreadShell = EnvironmentThreadShell,
>(
  threads: readonly TThread[],
  options: {
    readonly projectDisplayName: string;
    readonly activeThreadKey: string | null;
    readonly localLastVisitedAtById?: Readonly<Record<string, string | undefined>> | undefined;
  },
): SidebarWorkspaceGroup<TThread>[] {
  if (threads.length === 0) return [];

  const buckets = new Map<
    string,
    {
      worktreePath: string | null;
      branch: string | null;
      threads: TThread[];
      latestActivityMs: number;
      firstOrder: number;
    }
  >();

  for (const [index, thread] of threads.entries()) {
    const key = resolveWorkspaceGroupKey(thread);
    const worktreePath = thread.worktreePath?.trim() || null;
    const branch = thread.branch?.trim() || null;
    const activityMs = resolveThreadActivityMs(thread);
    const existing = buckets.get(key);
    if (existing) {
      existing.threads.push(thread);
      if (activityMs > existing.latestActivityMs) {
        existing.latestActivityMs = activityMs;
      }
    } else {
      buckets.set(key, {
        worktreePath,
        branch,
        threads: [thread],
        latestActivityMs: activityMs,
        firstOrder: index,
      });
    }
  }

  const localVisited = options.localLastVisitedAtById ?? {};
  const entries = [...buckets.entries()].map(([workspaceKey, bucket]) => {
    const isPrimary = bucket.worktreePath === null;
    const isSelected =
      options.activeThreadKey !== null &&
      bucket.threads.some(
        (thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) ===
          options.activeThreadKey,
      );
    return {
      workspaceKey,
      worktreePath: bucket.worktreePath,
      branch: bucket.branch,
      title: deriveWorkspaceCardTitle({
        worktreePath: bucket.worktreePath,
        branch: bucket.branch,
        projectDisplayName: options.projectDisplayName,
        threads: bucket.threads,
      }),
      isPrimary,
      isSelected,
      status: resolveWorkspaceStatus(bucket.threads, localVisited),
      threads: bucket.threads,
      latestActivityMs: bucket.latestActivityMs,
      firstOrder: bucket.firstOrder,
    };
  });

  entries.sort((left, right) => {
    if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
    if (left.latestActivityMs !== right.latestActivityMs) {
      return right.latestActivityMs - left.latestActivityMs;
    }
    return left.firstOrder - right.firstOrder;
  });

  return entries.map(({ firstOrder: _ignored, ...group }) => group);
}

export interface SidebarHostDescriptor {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly hostname?: string | null | undefined;
  readonly machine: EnvironmentMachineKind;
  readonly isPrimary: boolean;
  readonly isConnected: boolean;
}

export interface SidebarHostFolderEntry<
  TFolder extends {
    readonly group: {
      readonly environmentId: EnvironmentId;
      readonly projectKey: string;
      readonly displayName: string;
    };
    readonly threads: readonly EnvironmentThreadShell[];
  },
> {
  readonly folder: TFolder;
  readonly workspaces: readonly SidebarWorkspaceGroup[];
}

export interface SidebarHostGroup<
  TFolder extends {
    readonly group: {
      readonly environmentId: EnvironmentId;
      readonly projectKey: string;
      readonly displayName: string;
    };
    readonly threads: readonly EnvironmentThreadShell[];
  },
> {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly hostname: string | null;
  readonly machine: EnvironmentMachineKind;
  readonly isPrimary: boolean;
  readonly isConnected: boolean;
  readonly workspaceCount: number;
  readonly folders: readonly SidebarHostFolderEntry<TFolder>[];
}

function normalizeDimmedHostname(
  label: string,
  hostname: string | null | undefined,
): string | null {
  const trimmed = hostname?.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === label.trim().toLowerCase()) return null;
  return trimmed;
}

/**
 * Groups sidebar project folders by host (`environmentId`), computing each project's
 * Orca Workspace Cards and summing the host's total workspace count for the capsule pill.
 */
export function groupProjectFoldersByHost<
  TFolder extends {
    readonly group: {
      readonly environmentId: EnvironmentId;
      readonly projectKey: string;
      readonly displayName: string;
    };
    readonly threads: readonly EnvironmentThreadShell[];
    readonly hiddenThreads?: readonly EnvironmentThreadShell[];
  },
>(input: {
  readonly folders: readonly TFolder[];
  readonly hosts: readonly SidebarHostDescriptor[];
  readonly activeThreadKey: string | null;
  readonly localLastVisitedAtById?: Readonly<Record<string, string | undefined>> | undefined;
}): SidebarHostGroup<TFolder>[] {
  if (input.folders.length === 0) return [];

  const hostById = new Map<EnvironmentId, SidebarHostDescriptor>(
    input.hosts.map((host) => [host.environmentId, host] as const),
  );
  const hostOrder = new Map<EnvironmentId, number>(
    input.hosts.map((host, index) => [host.environmentId, index] as const),
  );

  const byEnv = new Map<
    EnvironmentId,
    {
      folders: SidebarHostFolderEntry<TFolder>[];
      workspaceCount: number;
    }
  >();

  for (const folder of input.folders) {
    const envId = folder.group.environmentId;
    const workspaces = groupProjectThreadsByWorkspace(folder.threads, {
      projectDisplayName: folder.group.displayName,
      activeThreadKey: input.activeThreadKey,
      localLastVisitedAtById: input.localLastVisitedAtById,
    });
    // When a folder is collapsed, count workspaces across its hidden threads too so the host pill stays accurate.
    const countSourceThreads =
      folder.hiddenThreads && folder.hiddenThreads.length > 0
        ? [...folder.threads, ...folder.hiddenThreads]
        : folder.threads;
    const folderWorkspaceCount =
      countSourceThreads.length === folder.threads.length
        ? workspaces.length
        : groupProjectThreadsByWorkspace(countSourceThreads, {
            projectDisplayName: folder.group.displayName,
            activeThreadKey: input.activeThreadKey,
            localLastVisitedAtById: input.localLastVisitedAtById,
          }).length;

    const existing = byEnv.get(envId);
    if (existing) {
      existing.folders.push({ folder, workspaces });
      existing.workspaceCount += folderWorkspaceCount;
    } else {
      byEnv.set(envId, {
        folders: [{ folder, workspaces }],
        workspaceCount: folderWorkspaceCount,
      });
    }
  }

  const groups: SidebarHostGroup<TFolder>[] = [...byEnv.entries()].map(
    ([environmentId, entry]) => {
      const descriptor = hostById.get(environmentId);
      const label = descriptor?.label ?? String(environmentId);
      return {
        environmentId,
        label,
        hostname: normalizeDimmedHostname(label, descriptor?.hostname),
        machine: descriptor?.machine ?? "server",
        isPrimary: descriptor?.isPrimary ?? false,
        isConnected: descriptor?.isConnected ?? true,
        workspaceCount: entry.workspaceCount,
        folders: entry.folders,
      };
    },
  );

  groups.sort((left, right) => {
    if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
    const leftIdx = hostOrder.get(left.environmentId) ?? Number.MAX_SAFE_INTEGER;
    const rightIdx = hostOrder.get(right.environmentId) ?? Number.MAX_SAFE_INTEGER;
    if (leftIdx !== rightIdx) return leftIdx - rightIdx;
    return left.label.localeCompare(right.label);
  });

  return groups;
}
