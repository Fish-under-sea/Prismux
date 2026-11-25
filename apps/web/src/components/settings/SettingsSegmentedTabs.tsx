import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "../../lib/utils";
import {
  SETTINGS_REVEAL_TARGET_EVENT,
  type SettingsRevealTargetEventDetail,
  dispatchSettingsRevealTarget,
  scrollToSettingsTarget,
  useSettingsSearchTargetId,
} from "./settingsLayout";

export { SETTINGS_REVEAL_TARGET_EVENT, dispatchSettingsRevealTarget };
export type { SettingsRevealTargetEventDetail };

export interface SettingsSegmentedTabItem {
  readonly id: string;
  readonly label: string;
  readonly badge?: string | number;
  readonly hashAnchors?: ReadonlyArray<string>;
  readonly content: ReactNode;
}

export interface SettingsSegmentedTabsProps {
  readonly tabs: ReadonlyArray<SettingsSegmentedTabItem>;
  readonly defaultTabId: string;
  readonly activeTabId?: string;
  readonly onTabChange?: (tabId: string) => void;
  readonly trailingAction?: ReactNode;
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly panelClassName?: string;
  /** Sync tab selection with URL `#hash` deep links (defaults to true). */
  readonly syncHash?: boolean;
}

export function normalizeSettingsHashAnchor(rawHash: string | null | undefined): string | null {
  if (typeof rawHash !== "string") return null;
  const stripped = rawHash.trim().replace(/^#/, "").trim();
  if (!stripped) return null;
  try {
    return decodeURIComponent(stripped).trim() || null;
  } catch {
    return stripped;
  }
}

export function resolveSettingsTabIdForAnchor(
  tabs: ReadonlyArray<Pick<SettingsSegmentedTabItem, "id" | "hashAnchors">>,
  rawAnchor: string | null | undefined,
): string | null {
  const anchor = normalizeSettingsHashAnchor(rawAnchor);
  if (anchor === null) return null;

  const direct = tabs.find((tab) => tab.id === anchor);
  if (direct) return direct.id;

  const anchored = tabs.find((tab) => tab.hashAnchors?.includes(anchor));
  return anchored?.id ?? null;
}

export function resolveInitialSettingsTabId(
  tabs: ReadonlyArray<Pick<SettingsSegmentedTabItem, "id" | "hashAnchors">>,
  defaultTabId: string,
  initialAnchor?: string | null,
): string {
  const fromAnchor = resolveSettingsTabIdForAnchor(tabs, initialAnchor);
  if (fromAnchor !== null) return fromAnchor;
  if (tabs.some((tab) => tab.id === defaultTabId)) return defaultTabId;
  return tabs[0]?.id ?? defaultTabId;
}

export function resolveNextSettingsTabIdByKey(
  tabs: ReadonlyArray<Pick<SettingsSegmentedTabItem, "id">>,
  currentTabId: string,
  key: string,
): string | null {
  if (tabs.length === 0) return null;
  const currentIndex = tabs.findIndex((tab) => tab.id === currentTabId);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;

  if (key === "ArrowRight") {
    return tabs[(safeIndex + 1) % tabs.length]?.id ?? null;
  }
  if (key === "ArrowLeft") {
    return tabs[(safeIndex - 1 + tabs.length) % tabs.length]?.id ?? null;
  }
  if (key === "Home") {
    return tabs[0]?.id ?? null;
  }
  if (key === "End") {
    return tabs[tabs.length - 1]?.id ?? null;
  }
  return null;
}

function scrollAnchorIntoViewSmoothly(targetId: string, highlight: boolean): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const target = document.getElementById(targetId);
  if (!target) return;
  if (scrollToSettingsTarget(targetId, { highlight })) {
    return;
  }
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "center",
  });
}

/**
 * Reusable pill/segmented tab strip for high-density Settings pages.
 * Automatically switches tabs and scrolls cleanly to targets when navigated via
 * `settingsSearch.ts` router hashes, `window.location.hash` changes, or
 * `SETTINGS_REVEAL_TARGET_EVENT`.
 */
export function SettingsSegmentedTabs({
  tabs,
  defaultTabId,
  activeTabId,
  onTabChange,
  trailingAction,
  ariaLabel = "Settings sections",
  className,
  panelClassName,
  syncHash = true,
}: SettingsSegmentedTabsProps) {
  const searchTargetId = useSettingsSearchTargetId();
  const isControlled = activeTabId !== undefined;

  const [uncontrolledTabId, setUncontrolledTabId] = useState<string>(() => {
    const initialHash =
      searchTargetId ?? (syncHash && typeof window !== "undefined" ? window.location.hash : null);
    return resolveInitialSettingsTabId(tabs, defaultTabId, initialHash);
  });

  // Synchronously reveal the matching tab during render when a settings search target changes,
  // so target rows mount on the first commit and SettingsSearchTarget can immediately focus/scroll.
  const [seenSearchTargetId, setSeenSearchTargetId] = useState<string | null>(searchTargetId);
  if (seenSearchTargetId !== searchTargetId) {
    setSeenSearchTargetId(searchTargetId);
    if (syncHash && searchTargetId !== null) {
      const matched = resolveSettingsTabIdForAnchor(tabs, searchTargetId);
      if (matched !== null && !isControlled && matched !== uncontrolledTabId) {
        setUncontrolledTabId(matched);
      }
    }
  }

  const pendingScrollRef = useRef<{ readonly targetId: string; readonly highlight: boolean } | null>(
    null,
  );
  const lastSyncedSearchTargetRef = useRef<string | null>(searchTargetId);
  const tabButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const resolvedTabId = (() => {
    const candidate = isControlled ? activeTabId : uncontrolledTabId;
    if (tabs.some((tab) => tab.id === candidate)) return candidate;
    if (tabs.some((tab) => tab.id === defaultTabId)) return defaultTabId;
    return tabs[0]?.id ?? "";
  })();

  const selectTab = useCallback(
    (nextTabId: string) => {
      if (!tabs.some((tab) => tab.id === nextTabId)) return;
      if (!isControlled) {
        setUncontrolledTabId(nextTabId);
      }
      if (nextTabId !== resolvedTabId) {
        onTabChange?.(nextTabId);
      }
    },
    [isControlled, onTabChange, resolvedTabId, tabs],
  );

  // Sync controlled parent state when a new searchTargetId arrives (never snaps back on manual clicks).
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- propagates router hash deep-link selection to controlled tab owners
  useEffect(() => {
    if (!syncHash || searchTargetId === null) {
      lastSyncedSearchTargetRef.current = searchTargetId;
      return;
    }
    if (lastSyncedSearchTargetRef.current === searchTargetId) return;
    lastSyncedSearchTargetRef.current = searchTargetId;

    const matched = resolveSettingsTabIdForAnchor(tabs, searchTargetId);
    if (matched === null) return;
    pendingScrollRef.current = { targetId: searchTargetId, highlight: true };
    if (matched !== resolvedTabId) {
      selectTab(matched);
    } else if (typeof window !== "undefined") {
      const rafId = window.requestAnimationFrame(() => {
        scrollAnchorIntoViewSmoothly(searchTargetId, true);
      });
      return () => {
        window.cancelAnimationFrame(rafId);
      };
    }
    return undefined;
  }, [resolvedTabId, searchTargetId, selectTab, syncHash, tabs]);

  // Listen to browser hashchange and explicit settings-reveal events so deep links
  // inside inactive tabs automatically switch tabs and scroll smoothly into view.
  useEffect(() => {
    if (!syncHash || typeof window === "undefined") return;

    const handleAnchorReveal = (rawAnchor: string | null | undefined, highlight: boolean) => {
      const anchor = normalizeSettingsHashAnchor(rawAnchor);
      if (anchor === null) return;
      const matched = resolveSettingsTabIdForAnchor(tabs, anchor);
      if (matched === null) return;
      pendingScrollRef.current = { targetId: anchor, highlight };
      if (matched !== resolvedTabId) {
        selectTab(matched);
      } else {
        scrollAnchorIntoViewSmoothly(anchor, highlight);
        pendingScrollRef.current = null;
      }
    };

    const onHashChange = () => {
      handleAnchorReveal(window.location.hash, true);
    };

    const onRevealEvent = (event: Event) => {
      const detail = (event as CustomEvent<SettingsRevealTargetEventDetail | undefined>).detail;
      if (!detail?.targetId) return;
      handleAnchorReveal(detail.targetId, detail.highlight ?? true);
    };

    window.addEventListener("hashchange", onHashChange);
    window.addEventListener(SETTINGS_REVEAL_TARGET_EVENT, onRevealEvent);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener(SETTINGS_REVEAL_TARGET_EVENT, onRevealEvent);
    };
  }, [resolvedTabId, selectTab, syncHash, tabs]);

  // After switching into the target tab, scroll the newly mounted anchor into view.
  useEffect(() => {
    const pending = pendingScrollRef.current;
    if (!pending || typeof window === "undefined") return;
    const matched = resolveSettingsTabIdForAnchor(tabs, pending.targetId);
    if (matched !== resolvedTabId) return;

    pendingScrollRef.current = null;
    const rafId = window.requestAnimationFrame(() => {
      scrollAnchorIntoViewSmoothly(pending.targetId, pending.highlight);
    });
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [resolvedTabId, tabs]);

  const activeTab = tabs.find((tab) => tab.id === resolvedTabId) ?? tabs[0];

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentId: string) => {
    const nextId = resolveNextSettingsTabIdByKey(tabs, currentId, event.key);
    if (nextId === null) return;
    event.preventDefault();
    selectTab(nextId);
    tabButtonRefs.current.get(nextId)?.focus();
  };

  return (
    <div
      data-slot="settings-segmented-tabs"
      className={cn("flex flex-col gap-6", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label={ariaLabel}
          data-slot="tabs-list"
          className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border border-border/60 bg-muted/40 p-1"
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;
            return (
              <button
                key={tab.id}
                ref={(node) => {
                  if (node) {
                    tabButtonRefs.current.set(tab.id, node);
                  } else {
                    tabButtonRefs.current.delete(tab.id);
                  }
                }}
                type="button"
                role="tab"
                id={`settings-tab-${tab.id}`}
                aria-controls={`settings-tabpanel-${tab.id}`}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                data-slot="tabs-trigger"
                data-tab-id={tab.id}
                data-active={isActive ? "" : undefined}
                onClick={() => selectTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                className={cn(
                  "inline-flex min-h-7 cursor-pointer items-center gap-1.5 rounded-full border border-transparent px-3.5 py-1 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                  isActive
                    ? "bg-background font-semibold text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{tab.label}</span>
                {tab.badge !== undefined && tab.badge !== "" ? (
                  <span
                    data-slot="settings-tab-badge"
                    className={cn(
                      "inline-flex min-w-4 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] leading-none font-medium tabular-nums",
                      isActive
                        ? "bg-foreground/12 text-current"
                        : "bg-foreground/8 text-muted-foreground",
                    )}
                  >
                    {tab.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {trailingAction ? (
          <div className="flex shrink-0 items-center gap-2" data-slot="settings-tabs-trailing">
            {trailingAction}
          </div>
        ) : null}
      </div>

      {activeTab ? (
        <div
          role="tabpanel"
          id={`settings-tabpanel-${activeTab.id}`}
          aria-labelledby={`settings-tab-${activeTab.id}`}
          data-slot="settings-tab-panel"
          data-active-tab={activeTab.id}
          className={cn("flex flex-col gap-7", panelClassName)}
        >
          {activeTab.content}
        </div>
      ) : null}
    </div>
  );
}
