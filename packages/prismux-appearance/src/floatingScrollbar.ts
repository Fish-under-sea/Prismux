export const PMX_SCROLL_ACTIVE_ATTR = 'data-pmx-scroll-active';
export const PMX_SCROLL_SCROLLING_ATTR = 'data-pmx-scroll-scrolling';
export const PMX_FLOATING_SCROLLBARS_ROOT_ATTR = 'data-pmx-floating-scrollbars';
export const PMX_NO_FLOATING_SCROLLBAR_ATTR = 'data-pmx-no-floating-scrollbar';

export const DEFAULT_SCROLL_HOVER_HIDE_DELAY_MS = 450;
export const DEFAULT_SCROLL_ACTIVE_HIDE_DELAY_MS = 800;

const SCROLLABLE_OVERFLOW_VALUES = new Set(['auto', 'scroll', 'overlay']);
const SKIPPED_TAG_NAMES = new Set(['HTML', 'BODY', 'IFRAME', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO']);
const SUBPIXEL_OVERFLOW_TOLERANCE_PX = 1;
const NON_SCROLLABLE_RECHECK_WINDOW_MS = 80;

export interface ComputedOverflowStyleLike {
  overflowX?: string;
  overflowY?: string;
  scrollbarWidth?: string;
}

export interface ScrollableElementLike {
  readonly nodeType?: number;
  readonly tagName?: string;
  readonly isConnected?: boolean;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly clientWidth: number;
  readonly scrollWidth: number;
  readonly parentElement: ScrollableElementLike | null;
  readonly classList?: { contains(token: string): boolean };
  getAttribute?(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  querySelector?(selector: string): unknown;
}

export interface FloatingScrollbarEventLike {
  readonly target: unknown;
}

export interface FloatingScrollbarEventTargetLike {
  addEventListener(
    type: string,
    listener: (event: FloatingScrollbarEventLike) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: FloatingScrollbarEventLike) => void,
    options?: boolean | EventListenerOptions,
  ): void;
}

export interface FloatingScrollbarDocumentLike extends FloatingScrollbarEventTargetLike {
  readonly documentElement: {
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    addEventListener?: FloatingScrollbarEventTargetLike['addEventListener'];
    removeEventListener?: FloatingScrollbarEventTargetLike['removeEventListener'];
  } | null;
  readonly defaultView?: {
    getComputedStyle?: (el: never) => ComputedOverflowStyleLike | null;
    addEventListener?: FloatingScrollbarEventTargetLike['addEventListener'];
    removeEventListener?: FloatingScrollbarEventTargetLike['removeEventListener'];
  } | null;
}

export type ComputedStyleResolver = (el: ScrollableElementLike) => ComputedOverflowStyleLike | null;

export interface FloatingScrollbarOptions {
  /** Delay after pointer leaves a scrollable container before fading out its thumb (default: 450ms). */
  hoverHideDelayMs?: number;
  /** Delay after scroll events stop before hiding the thumb (default: 800ms). */
  scrollHideDelayMs?: number;
  /** Optional style resolver (defaults to `doc.defaultView.getComputedStyle`). */
  getComputedStyle?: ComputedStyleResolver;
  /** Optional monotonic clock for testing (defaults to `Date.now`). */
  now?: () => number;
}

export interface FloatingScrollbarHandle {
  /** Removes all listeners, clears all timers, and cleans up every managed attribute. */
  dispose(): void;
  /** Returns the currently pointer-hovered nearest scrollable container, if any. */
  getActiveElement(): ScrollableElementLike | null;
}

function isScrollableElementCandidate(value: unknown): value is ScrollableElementLike {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ScrollableElementLike>;
  if (typeof candidate.nodeType === 'number' && candidate.nodeType !== 1) return false;
  return (
    typeof candidate.clientHeight === 'number' &&
    typeof candidate.scrollHeight === 'number' &&
    typeof candidate.clientWidth === 'number' &&
    typeof candidate.scrollWidth === 'number' &&
    typeof candidate.setAttribute === 'function' &&
    typeof candidate.removeAttribute === 'function'
  );
}

function resolveStartElement(target: unknown): ScrollableElementLike | null {
  if (!target || typeof target !== 'object') return null;
  if (isScrollableElementCandidate(target)) return target;
  const maybeNode = target as { parentElement?: unknown };
  if (isScrollableElementCandidate(maybeNode.parentElement)) {
    return maybeNode.parentElement;
  }
  return null;
}

function defaultGetComputedStyle(el: ScrollableElementLike): ComputedOverflowStyleLike | null {
  if (typeof globalThis.getComputedStyle === 'function') {
    try {
      return globalThis.getComputedStyle(el as unknown as Element);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Returns `true` when `el` is a genuinely scrollable container (has > 1px overflow on an axis
 * whose computed overflow is `auto`, `scroll`, or `overlay`, and is not explicitly scrollbar-hidden).
 */
export function isElementScrollable(
  el: ScrollableElementLike | null | undefined,
  getStyle?: ComputedStyleResolver,
): boolean {
  if (!el || !isScrollableElementCandidate(el)) return false;

  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag && SKIPPED_TAG_NAMES.has(tag)) return false;

  if (el.getAttribute?.(PMX_NO_FLOATING_SCROLLBAR_ATTR) === '1') return false;
  if (el.getAttribute?.('data-testid') === 'prismux-status-bar-strip') return false;
  if (el.classList?.contains('scrollbar-none')) return false;

  // Fast path: skip getComputedStyle entirely when element has no scrollable overflow.
  const canScrollY =
    el.clientHeight > 0 && el.scrollHeight > el.clientHeight + SUBPIXEL_OVERFLOW_TOLERANCE_PX;
  const canScrollX =
    el.clientWidth > 0 && el.scrollWidth > el.clientWidth + SUBPIXEL_OVERFLOW_TOLERANCE_PX;
  if (!canScrollY && !canScrollX) return false;

  const style = getStyle ? getStyle(el) : defaultGetComputedStyle(el);
  if (!style) {
    return tag === 'TEXTAREA';
  }

  const isBaseUiViewport = el.getAttribute?.('data-slot') === 'scroll-area-viewport';
  if (isBaseUiViewport) {
    // Base UI ScrollArea hides the native scrollbar on its viewport and renders a sibling
    // `[data-slot="scroll-area-scrollbar"]`. Only activate if that overlay scrollbar exists.
    const parent = el.parentElement;
    const hasOverlayBar =
      typeof parent?.querySelector === 'function'
        ? Boolean(parent.querySelector('[data-slot="scroll-area-scrollbar"]'))
        : style.scrollbarWidth !== 'none';
    if (!hasOverlayBar) return false;
  } else if (style.scrollbarWidth === 'none') {
    return false;
  }

  const overflowY = (style.overflowY ?? '').toLowerCase();
  const overflowX = (style.overflowX ?? '').toLowerCase();

  if (canScrollY && SCROLLABLE_OVERFLOW_VALUES.has(overflowY)) return true;
  if (canScrollX && SCROLLABLE_OVERFLOW_VALUES.has(overflowX)) return true;
  return false;
}

/**
 * Walks upward from `start` and returns the closest genuinely scrollable container,
 * guaranteeing that hovering an inner or neighboring pane never illuminates adjacent panels.
 */
export function findNearestScrollableContainer(
  start: unknown,
  rootStop?: unknown,
  getStyle?: ComputedStyleResolver,
): ScrollableElementLike | null {
  let cur = resolveStartElement(start);
  while (cur && cur !== rootStop) {
    if (isElementScrollable(cur, getStyle)) {
      return cur;
    }
    cur = cur.parentElement ?? null;
  }
  return null;
}

/**
 * Installs Prismux's zero-layout-shift, pointer-aware auto-hiding floating scrollbar controller
 * on `doc`. Idle scrollbars remain completely invisible; moving the pointer over any scrollable
 * region illuminates ONLY the nearest scrollable ancestor (`[data-pmx-scroll-active="1"]`) and
 * gently fades it out after leaving (`450ms`), while active scrolling illuminates the scrolled
 * container (`[data-pmx-scroll-scrolling="1"]`) until `800ms` after scroll settles.
 */
export function installPrismuxFloatingScrollbars(
  doc?: Document | FloatingScrollbarDocumentLike | null,
  options: FloatingScrollbarOptions = {},
): FloatingScrollbarHandle {
  const targetDoc =
    doc !== undefined
      ? (doc as FloatingScrollbarDocumentLike | null)
      : (globalThis.document as unknown as FloatingScrollbarDocumentLike | undefined);

  if (!targetDoc || !targetDoc.documentElement) {
    return {
      dispose() {},
      getActiveElement: () => null,
    };
  }

  const hoverHideDelayMs = Math.max(
    0,
    options.hoverHideDelayMs ?? DEFAULT_SCROLL_HOVER_HIDE_DELAY_MS,
  );
  const scrollHideDelayMs = Math.max(
    0,
    options.scrollHideDelayMs ?? DEFAULT_SCROLL_ACTIVE_HIDE_DELAY_MS,
  );
  const now = options.now ?? (() => Date.now());
  const win = targetDoc.defaultView ?? null;
  const resolveStyle: ComputedStyleResolver =
    options.getComputedStyle ??
    ((el) => {
      if (win && typeof win.getComputedStyle === 'function') {
        try {
          return (win.getComputedStyle as (node: unknown) => ComputedOverflowStyleLike | null)(el);
        } catch {
          return null;
        }
      }
      return defaultGetComputedStyle(el);
    });

  const html = targetDoc.documentElement;
  html.setAttribute(PMX_FLOATING_SCROLLBARS_ROOT_ATTR, '1');

  let disposed = false;
  let activeEl: ScrollableElementLike | null = null;
  let pointerDragging = false;
  let lastPointerTarget: unknown = null;
  let lastNullCheckAt = 0;

  const hoverHideTimers = new Map<ScrollableElementLike, ReturnType<typeof setTimeout>>();
  const scrollHideTimers = new Map<ScrollableElementLike, ReturnType<typeof setTimeout>>();

  const cancelHoverHide = (el: ScrollableElementLike) => {
    const existing = hoverHideTimers.get(el);
    if (existing !== undefined) {
      clearTimeout(existing);
      hoverHideTimers.delete(el);
    }
  };

  const clearHoverImmediately = (el: ScrollableElementLike) => {
    cancelHoverHide(el);
    el.removeAttribute(PMX_SCROLL_ACTIVE_ATTR);
  };

  const scheduleHoverHide = (el: ScrollableElementLike) => {
    cancelHoverHide(el);
    const timer = setTimeout(() => {
      hoverHideTimers.delete(el);
      if (disposed || activeEl === el) return;
      el.removeAttribute(PMX_SCROLL_ACTIVE_ATTR);
    }, hoverHideDelayMs);
    hoverHideTimers.set(el, timer);
  };

  const activateHoverTarget = (nextEl: ScrollableElementLike | null) => {
    if (disposed) return;

    if (nextEl === activeEl) {
      if (nextEl !== null) {
        cancelHoverHide(nextEl);
        nextEl.setAttribute(PMX_SCROLL_ACTIVE_ATTR, '1');
      }
      return;
    }

    if (nextEl !== null) {
      // Strictly isolate pointer illumination to the single nearest scrollable container:
      // immediately clear the previous active container and any lingering delayed timers.
      if (activeEl !== null) {
        clearHoverImmediately(activeEl);
      }
      for (const pending of Array.from(hoverHideTimers.keys())) {
        if (pending !== nextEl) {
          clearHoverImmediately(pending);
        }
      }
      cancelHoverHide(nextEl);
      activeEl = nextEl;
      nextEl.setAttribute(PMX_SCROLL_ACTIVE_ATTR, '1');
      return;
    }

    // Pointer left into a non-scrollable region or exited the viewport.
    if (pointerDragging) return;
    if (activeEl !== null) {
      const leaving = activeEl;
      activeEl = null;
      scheduleHoverHide(leaving);
    }
  };

  const handlePointerMove = (event: FloatingScrollbarEventLike) => {
    if (disposed) return;
    if (event.target === lastPointerTarget) {
      if (activeEl !== null && activeEl.isConnected !== false) {
        return;
      }
      if (activeEl === null && now() - lastNullCheckAt < NON_SCROLLABLE_RECHECK_WINDOW_MS) {
        return;
      }
    }
    lastPointerTarget = event.target;
    const nearest = findNearestScrollableContainer(event.target, html, resolveStyle);
    if (nearest === null) {
      lastNullCheckAt = now();
    }
    activateHoverTarget(nearest);
  };

  const handlePointerDown = (event: FloatingScrollbarEventLike) => {
    if (disposed) return;
    lastPointerTarget = event.target;
    const nearest = findNearestScrollableContainer(event.target, html, resolveStyle);
    if (nearest !== null) {
      pointerDragging = true;
      activateHoverTarget(nearest);
    }
  };

  const handlePointerUpOrCancel = (event: FloatingScrollbarEventLike) => {
    if (disposed || !pointerDragging) return;
    pointerDragging = false;
    lastPointerTarget = null;
    const nearest = findNearestScrollableContainer(event?.target, html, resolveStyle);
    activateHoverTarget(nearest);
  };

  const handleViewportLeave = () => {
    if (disposed) return;
    pointerDragging = false;
    lastPointerTarget = null;
    activateHoverTarget(null);
  };

  const handleScroll = (event: FloatingScrollbarEventLike) => {
    if (disposed) return;
    const target = resolveStartElement(event.target);
    if (!target || !isElementScrollable(target, resolveStyle)) return;

    target.setAttribute(PMX_SCROLL_SCROLLING_ATTR, '1');
    const existing = scrollHideTimers.get(target);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      scrollHideTimers.delete(target);
      if (disposed) return;
      target.removeAttribute(PMX_SCROLL_SCROLLING_ATTR);
    }, scrollHideDelayMs);
    scrollHideTimers.set(target, timer);
  };

  targetDoc.addEventListener('pointermove', handlePointerMove, { passive: true });
  targetDoc.addEventListener('pointerdown', handlePointerDown, { passive: true });
  targetDoc.addEventListener('pointerup', handlePointerUpOrCancel, { passive: true });
  targetDoc.addEventListener('pointercancel', handlePointerUpOrCancel, { passive: true });
  targetDoc.addEventListener('scroll', handleScroll, { capture: true, passive: true });
  html.addEventListener?.('pointerleave', handleViewportLeave, { passive: true });
  win?.addEventListener?.('blur', handleViewportLeave);

  return {
    getActiveElement: () => activeEl,
    dispose() {
      if (disposed) return;
      disposed = true;

      targetDoc.removeEventListener('pointermove', handlePointerMove);
      targetDoc.removeEventListener('pointerdown', handlePointerDown);
      targetDoc.removeEventListener('pointerup', handlePointerUpOrCancel);
      targetDoc.removeEventListener('pointercancel', handlePointerUpOrCancel);
      targetDoc.removeEventListener('scroll', handleScroll, true);
      html.removeEventListener?.('pointerleave', handleViewportLeave);
      win?.removeEventListener?.('blur', handleViewportLeave);

      if (activeEl !== null) {
        activeEl.removeAttribute(PMX_SCROLL_ACTIVE_ATTR);
        activeEl = null;
      }
      for (const [el, timer] of hoverHideTimers) {
        clearTimeout(timer);
        el.removeAttribute(PMX_SCROLL_ACTIVE_ATTR);
      }
      hoverHideTimers.clear();

      for (const [el, timer] of scrollHideTimers) {
        clearTimeout(timer);
        el.removeAttribute(PMX_SCROLL_SCROLLING_ATTR);
      }
      scrollHideTimers.clear();

      html.removeAttribute(PMX_FLOATING_SCROLLBARS_ROOT_ATTR);
    },
  };
}
