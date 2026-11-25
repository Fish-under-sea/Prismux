import type { EnvironmentId, EnvironmentMachineKind, ProjectId } from "@prismux/core-contracts";

import { resolveEnvironmentOptionLabel, type EnvMode } from "../BranchToolbar.logic";
import type { MessageResolver } from "../../i18n/messages";

export interface ComposerLocationEnvironmentInput {
  readonly environmentId: EnvironmentId;
  readonly savedLabel: string;
  readonly runtimeLabel?: string | null | undefined;
  readonly isPrimary: boolean;
  readonly connected: boolean;
  readonly machine: EnvironmentMachineKind;
  readonly displayUrl?: string | null | undefined;
  readonly scratchWorkspaceRoot?: string | null | undefined;
}

export interface ComposerLocationProjectInput {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly archivedAt?: string | null | undefined;
}

export interface ResolvedComposerHostDisplay {
  readonly environmentId: EnvironmentId | null;
  readonly displayLabel: string;
  readonly tooltip: string;
  readonly isPrimary: boolean;
  readonly connected: boolean;
  readonly machine: EnvironmentMachineKind;
  readonly options: readonly {
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly isPrimary: boolean;
    readonly connected: boolean;
    readonly machine: EnvironmentMachineKind;
    readonly displayUrl: string | null;
  }[];
}

export type ComposerWorkspaceDisplayKind = "scratch" | "project" | "worktree" | "new-worktree";

export interface ResolvedComposerWorkspaceDisplay {
  readonly kind: ComposerWorkspaceDisplayKind;
  readonly displayLabel: string;
  readonly fullPath: string;
  readonly abbreviatedPath: string;
  readonly projectId: ProjectId | null;
  readonly environmentId: EnvironmentId | null;
  readonly isHomeOrScratch: boolean;
  readonly canToggleWorktreeMode: boolean;
  readonly envMode: EnvMode;
}

export interface ComposerBranchOption {
  readonly name: string;
  readonly current: boolean;
  readonly isRemote: boolean;
}

export interface ResolvedComposerBranchChipDisplay {
  readonly visible: boolean;
  readonly branchName: string | null;
  readonly checkoutLabel: string;
  readonly displayLabel: string;
  readonly tooltip: string;
  readonly isWorktree: boolean;
  readonly envMode: EnvMode;
}

/**
 * Normalizes a Windows or POSIX filesystem path for equality comparison.
 */
export function normalizePathForComparison(rawPath: string | null | undefined): string {
  if (!rawPath) return "";
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) return "";
  const unified = trimmed.replaceAll("\\", "/");
  // Keep root paths ("/" or "C:/") intact, strip trailing slashes elsewhere.
  if (unified === "/" || /^[a-zA-Z]:\/$/.test(unified)) {
    return /^[a-zA-Z]:\//.test(unified) ? unified.toLowerCase() : unified;
  }
  const stripped = unified.replace(/\/+$/, "");
  return /^[a-zA-Z]:/.test(stripped) ? stripped.toLowerCase() : stripped;
}

/**
 * Extracts a concise folder name from a Windows or POSIX filesystem path.
 */
export function extractPathBasename(rawPath: string | null | undefined): string {
  if (!rawPath) return "";
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) return "";
  if (trimmed === "~") return "~";
  const withoutTrailing = trimmed.replace(/[\\/]+$/, "");
  if (withoutTrailing.length === 0) return "/";
  // Drive root like "D:" -> "D:\"
  if (/^[a-zA-Z]:$/.test(withoutTrailing)) {
    return `${withoutTrailing}\\`;
  }
  const segments = withoutTrailing.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? withoutTrailing;
}

/**
 * Abbreviates a workspace path by replacing a matching home/scratch root prefix with `~`.
 */
export function abbreviateWorkspacePath(
  rawPath: string | null | undefined,
  homeRoot?: string | null | undefined,
): string {
  if (!rawPath) return "~";
  const trimmed = rawPath.trim();
  if (trimmed.length === 0 || trimmed === "~") return "~";

  if (homeRoot) {
    const normalizedPath = normalizePathForComparison(trimmed);
    const normalizedHome = normalizePathForComparison(homeRoot);
    if (normalizedHome.length > 1) {
      if (normalizedPath === normalizedHome) {
        return "~";
      }
      if (normalizedPath.startsWith(`${normalizedHome}/`)) {
        const suffix = trimmed
          .replaceAll("\\", "/")
          .replace(/\/+$/, "")
          .slice(homeRoot.trim().replaceAll("\\", "/").replace(/\/+$/, "").length);
        return `~${suffix}`;
      }
    }
  }

  // Recognize common user home directories when no explicit homeRoot was supplied.
  const unixHomeMatch = /^(\/(?:Users|home)\/[^/]+)(\/.*)?$/.exec(trimmed);
  if (unixHomeMatch) {
    return unixHomeMatch[2] ? `~${unixHomeMatch[2]}` : "~";
  }
  const windowsHomeMatch = /^([a-zA-Z]:[\\/]Users[\\/][^\\/]+)([\\/].*)?$/i.exec(trimmed);
  if (windowsHomeMatch) {
    const suffix = windowsHomeMatch[2]?.replaceAll("\\", "/");
    return suffix ? `~${suffix}` : "~";
  }

  return trimmed;
}

/**
 * Resolves the work-location host label (e.g. `ROG-FISH`) and full selectable environment list.
 * Prefers the server's real runtime hostname (`serverConfig.environment.label`) over generic
 * saved placeholders like "Local environment".
 */
export function resolveComposerHostDisplay(input: {
  readonly activeEnvironmentId: EnvironmentId | null;
  readonly environments: readonly ComposerLocationEnvironmentInput[];
  readonly fallbackLocalLabel?: string;
  readonly resolveMessage?: MessageResolver;
}): ResolvedComposerHostDisplay {
  const options = input.environments
    .map((env) => ({
      environmentId: env.environmentId,
      label: resolveEnvironmentOptionLabel(
        {
          isPrimary: env.isPrimary,
          environmentId: env.environmentId,
          runtimeLabel: env.runtimeLabel ?? null,
          savedLabel: env.savedLabel,
        },
        input.resolveMessage,
      ),
      isPrimary: env.isPrimary,
      connected: env.connected,
      machine: env.machine,
      displayUrl: env.displayUrl ?? null,
    }))
    .toSorted((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.label.localeCompare(b.label);
    });

  const active =
    (input.activeEnvironmentId
      ? options.find((option) => option.environmentId === input.activeEnvironmentId)
      : null) ??
    options.find((option) => option.isPrimary) ??
    options[0] ??
    null;

  if (!active) {
    const fallbackLabel = input.fallbackLocalLabel ?? "This device";
    return {
      environmentId: input.activeEnvironmentId,
      displayLabel: fallbackLabel,
      tooltip: fallbackLabel,
      isPrimary: true,
      connected: true,
      machine: "desktop",
      options,
    };
  }

  const tooltip =
    !active.isPrimary && active.displayUrl
      ? `${active.label} (${active.displayUrl})`
      : active.label;

  return {
    environmentId: active.environmentId,
    displayLabel: active.label,
    tooltip,
    isPrimary: active.isPrimary,
    connected: active.connected,
    machine: active.machine,
    options,
  };
}

/**
 * Resolves the current workspace / directory display for the Orca-style below-composer bar.
 * Falls back cleanly to `~` when there is no active project or when running in the scratch root.
 */
export function resolveComposerWorkspaceDisplay(input: {
  readonly activeProject: ComposerLocationProjectInput | null;
  readonly activeWorktreePath: string | null;
  readonly draftEnvMode: EnvMode | null;
  readonly isDraft: boolean;
  readonly scratchWorkspaceRoot: string | null;
  readonly isScratch: boolean;
}): ResolvedComposerWorkspaceDisplay {
  const { activeProject, activeWorktreePath, draftEnvMode, isDraft, scratchWorkspaceRoot } = input;
  const effectiveEnvMode: EnvMode =
    activeWorktreePath !== null ? "worktree" : (draftEnvMode ?? "local");

  const projectMatchesScratch =
    activeProject !== null &&
    scratchWorkspaceRoot !== null &&
    normalizePathForComparison(activeProject.workspaceRoot) ===
      normalizePathForComparison(scratchWorkspaceRoot);

  const isHomeOrScratch = activeProject === null || input.isScratch || projectMatchesScratch;

  if (isHomeOrScratch) {
    const rawPath = activeProject?.workspaceRoot ?? scratchWorkspaceRoot ?? "~";
    return {
      kind: "scratch",
      displayLabel: "~",
      fullPath: rawPath,
      abbreviatedPath: abbreviateWorkspacePath(rawPath, scratchWorkspaceRoot),
      projectId: activeProject?.id ?? null,
      environmentId: activeProject?.environmentId ?? null,
      isHomeOrScratch: true,
      canToggleWorktreeMode: false,
      envMode: "local",
    };
  }

  if (activeWorktreePath && activeWorktreePath.trim().length > 0) {
    const worktreeName =
      extractPathBasename(activeWorktreePath) ||
      activeProject.title.trim() ||
      extractPathBasename(activeProject.workspaceRoot) ||
      "~";
    return {
      kind: "worktree",
      displayLabel: worktreeName,
      fullPath: activeWorktreePath,
      abbreviatedPath: abbreviateWorkspacePath(activeWorktreePath, scratchWorkspaceRoot),
      projectId: activeProject.id,
      environmentId: activeProject.environmentId,
      isHomeOrScratch: false,
      canToggleWorktreeMode: isDraft,
      envMode: "worktree",
    };
  }

  const projectRoot = activeProject.workspaceRoot;
  const abbreviated = abbreviateWorkspacePath(projectRoot, scratchWorkspaceRoot);
  const label =
    abbreviated === "~"
      ? "~"
      : activeProject.title.trim() || extractPathBasename(projectRoot) || "~";

  return {
    kind: effectiveEnvMode === "worktree" ? "new-worktree" : "project",
    displayLabel: label,
    fullPath: projectRoot,
    abbreviatedPath: abbreviated,
    projectId: activeProject.id,
    environmentId: activeProject.environmentId,
    isHomeOrScratch: abbreviated === "~",
    canToggleWorktreeMode: isDraft,
    envMode: effectiveEnvMode,
  };
}

/**
 * Resolves the AGY 2.0 top-tray branch/checkout pill (e.g. `main / 本地工作副本` or
 * `feat/agy / 当前工作树`). Hidden when running in scratch/no-project mode without a Git branch.
 */
export function resolveComposerBranchChipDisplay(input: {
  readonly activeBranch: string | null | undefined;
  readonly envMode: EnvMode;
  readonly hasWorktreePath: boolean;
  readonly isHomeOrScratch: boolean;
  readonly isGitRepo: boolean;
  readonly labels?: {
    readonly localCheckout: string;
    readonly currentWorktree: string;
    readonly newWorktree: string;
  };
}): ResolvedComposerBranchChipDisplay {
  const localCheckout = input.labels?.localCheckout ?? "Local checkout";
  const currentWorktree = input.labels?.currentWorktree ?? "Current worktree";
  const newWorktree = input.labels?.newWorktree ?? "New worktree";

  const trimmedBranch = input.activeBranch?.trim() ?? "";
  const branchName = trimmedBranch.length > 0 ? trimmedBranch : null;
  const isWorktree = input.hasWorktreePath || input.envMode === "worktree";
  const checkoutLabel = input.hasWorktreePath
    ? currentWorktree
    : input.envMode === "worktree"
      ? newWorktree
      : localCheckout;

  const visible =
    !input.isHomeOrScratch &&
    (branchName !== null || input.isGitRepo || input.hasWorktreePath || input.envMode === "worktree");

  const displayLabel = branchName ? `${branchName} / ${checkoutLabel}` : checkoutLabel;

  return {
    visible,
    branchName,
    checkoutLabel,
    displayLabel,
    tooltip: displayLabel,
    isWorktree,
    envMode: isWorktree ? "worktree" : "local",
  };
}
