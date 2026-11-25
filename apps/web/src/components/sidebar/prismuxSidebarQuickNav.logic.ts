import type { DaemonDiagnosticsServicesResponse } from "../../prismux/daemonClient";
import type { SidebarThreadStatus } from "../Sidebar.logic";
import { validateSafeHttpsUrl } from "../settings/prismuxProviderMeta";

export interface SidebarStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Persisted dismissal key modeled after stablyai/orca
 * `components/sidebar/chrome/mobile-sidebar-onboarding-badge.ts`.
 */
export const PRISMUX_MOBILE_SIDEBAR_ONBOARDING_KEY =
  "prismux.mobile.sidebar-onboarding-dismissed" as const;

export const PRISMUX_SIDEBAR_PROJECTS_OPEN_KEY =
  "prismux.sidebar.projects-section-open" as const;

/**
 * Canonical Prismux top sidebar quick-nav entries.
 * Strict 3-item order across expanded sidebar and 54px collapsed icon rail:
 * `diagnostics` -> `automations` -> `overnight-factory`.
 * `tasks` and `workspace-board` live in the bottom sidebar footer utility toolbar (`SidebarChrome.tsx`).
 * Remote QR pairing and Plugin Center live inside Settings.
 */
export const PRISMUX_SIDEBAR_QUICK_NAV_IDS = [
  "diagnostics",
  "automations",
  "overnight-factory",
] as const;

export type PrismuxSidebarQuickNavId = (typeof PRISMUX_SIDEBAR_QUICK_NAV_IDS)[number];

export const PRISMUX_SIDEBAR_QUICK_NAV_ROUTES = {
  diagnostics: "/diagnostics",
  tasks: "/tasks",
  workspaceBoard: "/workspace-board",
  automations: "/scheduled-tasks",
  overnightFactory: "/overnight-factory",
  plugins: "/settings/plugins",
} as const;

export const PRISMUX_SIDEBAR_TOGGLE_PANEL_PATHS = {
  diagnostics: ["/diagnostics"],
  tasks: ["/tasks"],
  workspaceBoard: ["/workspace-board"],
  automations: ["/scheduled-tasks", "/automations"],
  overnightFactory: ["/overnight-factory"],
  issues: ["/issues"],
  pullRequests: ["/pull-requests"],
} as const;

/**
 * Official Prismux external Help links — zero third-party upstream links.
 * Every URL must pass strict `https:` validation before opening.
 */
export const PRISMUX_HELP_EXTERNAL_LINKS = {
  repository: "https://github.com/Fish-under-sea/Prismux",
  issues: "https://github.com/Fish-under-sea/Prismux/issues",
} as const;

export type PrismuxHelpExternalLinkId = keyof typeof PRISMUX_HELP_EXTERNAL_LINKS;

export function resolveSafePrismuxHelpUrl(linkId: PrismuxHelpExternalLinkId): string | null {
  return validateSafeHttpsUrl(PRISMUX_HELP_EXTERNAL_LINKS[linkId]);
}

function getDefaultStorage(): SidebarStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readMobileSidebarOnboardingDismissed(
  storage: SidebarStorageLike | null = getDefaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(PRISMUX_MOBILE_SIDEBAR_ONBOARDING_KEY) === "true";
  } catch {
    return false;
  }
}

export function dismissMobileSidebarOnboardingBadge(
  storage: SidebarStorageLike | null = getDefaultStorage(),
): boolean {
  if (!storage) return true;
  try {
    storage.setItem(PRISMUX_MOBILE_SIDEBAR_ONBOARDING_KEY, "true");
  } catch {
    // Ignore storage quota / private mode errors.
  }
  return true;
}

export function shouldShowMobileSidebarOnboardingBadge(dismissed: boolean): boolean {
  return !dismissed;
}

export function readSidebarProjectsSectionOpen(
  storage: SidebarStorageLike | null = getDefaultStorage(),
): boolean {
  if (!storage) return true;
  try {
    const raw = storage.getItem(PRISMUX_SIDEBAR_PROJECTS_OPEN_KEY);
    if (raw === "false") return false;
    return true;
  } catch {
    return true;
  }
}

export function writeSidebarProjectsSectionOpen(
  open: boolean,
  storage: SidebarStorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(PRISMUX_SIDEBAR_PROJECTS_OPEN_KEY, open ? "true" : "false");
  } catch {
    // Ignore storage quota / private mode errors.
  }
}

export type DiagnosticsBadgeTone = "ok" | "degraded" | "error" | null;

export function resolveDiagnosticsBadgeTone(
  report: DaemonDiagnosticsServicesResponse | null | undefined,
): DiagnosticsBadgeTone {
  if (!report) return null;
  const summaryErrors = report.summary?.error ?? 0;
  const summaryDegraded = report.summary?.degraded ?? 0;
  if (summaryErrors > 0 || report.items.some((item) => item.status === "error")) {
    return "error";
  }
  if (summaryDegraded > 0 || report.items.some((item) => item.status === "degraded")) {
    return "degraded";
  }
  if (report.items.length > 0 || (report.summary?.ok ?? 0) > 0) {
    return "ok";
  }
  return null;
}

export function resolveInstalledPluginCount(
  payload:
    | {
        readonly plugins?: ReadonlyArray<unknown>;
        readonly items?: ReadonlyArray<unknown>;
      }
    | null
    | undefined,
): number | null {
  if (!payload) return null;
  if (Array.isArray(payload.plugins)) return payload.plugins.length;
  if (Array.isArray(payload.items)) return payload.items.length;
  return null;
}

export interface SidebarAttentionThreadInput {
  readonly key: string;
  readonly status: SidebarThreadStatus;
  readonly isUnread: boolean;
}

export interface SidebarInboxAttentionSummary {
  readonly approvalCount: number;
  readonly unreadCount: number;
  readonly totalCount: number;
  readonly attentionKeys: ReadonlySet<string>;
}

const APPROVAL_STATUSES = new Set<SidebarThreadStatus>(["approval", "input", "request"]);

/**
 * Computes real-time pending approval / input / unread attention counts for the
 * Orca-aligned Projects header inbox bell (`🔔`).
 */
export function summarizeSidebarInboxAttention(
  threads: ReadonlyArray<SidebarAttentionThreadInput>,
): SidebarInboxAttentionSummary {
  let approvalCount = 0;
  let unreadCount = 0;
  const attentionKeys = new Set<string>();

  for (const thread of threads) {
    if (APPROVAL_STATUSES.has(thread.status)) {
      approvalCount += 1;
      attentionKeys.add(thread.key);
      continue;
    }
    if (thread.status === "ready" && thread.isUnread) {
      unreadCount += 1;
      attentionKeys.add(thread.key);
    }
  }

  return {
    approvalCount,
    unreadCount,
    totalCount: approvalCount + unreadCount,
    attentionKeys,
  };
}

/**
 * Lightweight event bus connecting the bottom toolbar `🎯 Locate current thread` button
 * (`SidebarChrome.tsx`) to the active thread list in `Sidebar.tsx`.
 */
const locateActiveThreadListeners = new Set<() => void>();

export function requestLocateActiveSidebarThread(): void {
  for (const listener of locateActiveThreadListeners) {
    listener();
  }
}

export function subscribeLocateActiveSidebarThread(listener: () => void): () => void {
  locateActiveThreadListeners.add(listener);
  return () => {
    locateActiveThreadListeners.delete(listener);
  };
}

/**
 * Lightweight event bus connecting the Orca Workspace Board lane `+` buttons to
 * `OrcaCreateWorkspaceDialog` mounted inside `Sidebar.tsx`.
 */
const openCreateWorkspaceListeners = new Set<() => void>();

export function requestOpenCreateWorkspace(): void {
  for (const listener of openCreateWorkspaceListeners) {
    listener();
  }
}

export function subscribeOpenCreateWorkspace(listener: () => void): () => void {
  openCreateWorkspaceListeners.add(listener);
  return () => {
    openCreateWorkspaceListeners.delete(listener);
  };
}
