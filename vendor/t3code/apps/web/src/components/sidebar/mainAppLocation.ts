import { useNavigate, useRouter, type AnyRouter } from "@tanstack/react-router";

import { GUEST_PAGE_PATH } from "../../guestPage";
import { withoutAssistantCitationHash } from "../../lib/assistantCitationNavigation";
import { resolveThreadRouteTarget, type ThreadRouteTarget } from "../../threadRoutes";

/** Settings and Usage open as modals over the last main-app view. */
export function isAppModalPage(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/") || pathname === "/usage";
}

export function isSidebarUtilityPage(pathname: string) {
  return (
    pathname.startsWith("/projects/") ||
    pathname === "/pull-requests" ||
    pathname === "/issues" ||
    pathname === "/tasks" ||
    pathname === "/workspace-board" ||
    pathname === "/scheduled-tasks" ||
    pathname === "/automations" ||
    pathname === "/overnight-factory"
  );
}

/**
 * Sidebar pages that expose a dedicated toggleable sidebar button (4 top QuickNav work panels
 * plus the bottom-left Issues / Pull Requests icons). Clicking the active button again closes
 * the panel and returns to the prior thread/chat session.
 */
export function isSidebarToggleablePanelPage(pathname: string): boolean {
  const normalized = normalizeSidebarPathname(pathname);
  return (
    normalized === "/tasks" ||
    normalized === "/workspace-board" ||
    normalized === "/scheduled-tasks" ||
    normalized === "/automations" ||
    normalized === "/overnight-factory" ||
    normalized === "/issues" ||
    normalized === "/pull-requests"
  );
}

function normalizeSidebarPathname(pathname: string): string {
  const trimmed = pathname.trim();
  if (trimmed.length > 1 && trimmed.endsWith("/")) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

export function isSidebarPanelPathActive(
  currentPathname: string,
  panelPathnames: readonly string[],
): boolean {
  const normalizedCurrent = normalizeSidebarPathname(currentPathname);
  return panelPathnames.some(
    (candidate) => normalizeSidebarPathname(candidate) === normalizedCurrent,
  );
}

export interface SidebarPanelToggleNavigationDecision {
  readonly action: "open" | "close";
  readonly href: string;
}

/**
 * Pure toggle-close decision for sidebar work panels and Issue/PR icons:
 * if already viewing the panel, return to the remembered prior thread/chat route;
 * otherwise open the target panel route.
 */
export function resolveSidebarPanelToggleNavigation(input: {
  readonly currentPathname: string;
  readonly panelPathnames: readonly string[];
  readonly targetHref: string;
  readonly lastMainAppHref?: string | null | undefined;
}): SidebarPanelToggleNavigationDecision {
  if (isSidebarPanelPathActive(input.currentPathname, input.panelPathnames)) {
    const returnHref = input.lastMainAppHref?.trim();
    return {
      action: "close",
      href: returnHref && returnHref.length > 0 ? returnHref : "/",
    };
  }
  return {
    action: "open",
    href: input.targetHref,
  };
}

// Pages the root route always renders without the app shell, so they are never
// a page to return to. Other paths seen before auth or on a prompt-link landing
// are still recorded; they are real app URLs, so returning to one is harmless.
const SHELL_LESS_PATHS = new Set(["/pair", "/connect", "/connect-agent", GUEST_PAGE_PATH]);

let mainAppHref: string | null = null;
let appModalReturnHref: string | null = null;
let appModalReturnHistoryIndex: number | null = null;
let appModalReturnThreadTarget: ThreadRouteTarget | null = null;
let initialHistoryIndex = 0;

/** Remembers where Settings, Usage, and the utility pages lead back to. */
export function startMainAppLocationTracking(router: AnyRouter): () => void {
  initialHistoryIndex = router.state.location.state.__TSR_index;
  const record = () => {
    const { pathname } = router.state.location;
    if (isAppModalPage(pathname) || SHELL_LESS_PATHS.has(pathname)) return;
    const href = withoutAssistantCitationHash(router.state.location.href);
    appModalReturnHref = href;
    // Only an entry that is exactly the return location can be stepped back to.
    appModalReturnHistoryIndex =
      href === router.state.location.href ? router.state.location.state.__TSR_index : null;
    appModalReturnThreadTarget = resolveThreadRouteTarget(
      router.state.matches.at(-1)?.params ?? {},
    );
    if (!isSidebarUtilityPage(pathname)) mainAppHref = href;
  };
  record();
  return router.subscribe("onResolved", record);
}

/** The thread Settings or Usage opened over, for views mounted while the modal is open. */
export function getAppModalReturnThreadTarget() {
  return appModalReturnThreadTarget;
}

/** Last recorded non-utility, non-modal main-app href (e.g. active thread or home). */
export function getMainAppReturnHref(fallbackHref = "/"): string {
  return mainAppHref ?? fallbackHref;
}

export function useNavigateToMainApp(fallbackHref = "/") {
  const navigate = useNavigate();
  return () => navigate({ href: mainAppHref ?? fallbackHref });
}

/** Leaves Settings or Usage for the page that opened it. */
export function useCloseAppModal() {
  const navigate = useNavigate();
  const router = useRouter();
  return () => {
    const href = appModalReturnHref ?? mainAppHref ?? "/";
    const returnIndex = appModalReturnHistoryIndex ?? 0;
    const steps = router.state.location.state.__TSR_index - returnIndex;
    // Stepping back past this document's first entry reloads the page. Written as a negated
    // comparison so a missing (NaN) history index also falls back to client navigation.
    if (!(returnIndex > initialHistoryIndex && steps > 0)) return navigate({ href, replace: true });
    // Go back to the entry before the return page and push it again: only a push drops the
    // modal's entries from forward history, and reusing the old entry avoids a duplicate stop.
    const unsubscribe = router.history.subscribe(() => {
      unsubscribe();
      void navigate({ href });
    });
    router.history.go(-(steps + 1));
  };
}
