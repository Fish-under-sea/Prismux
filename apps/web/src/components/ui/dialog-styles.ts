const DIALOG_BACKDROP_BASE_CLASS =
  "fixed inset-0 z-50 transition-all duration-200 [-webkit-app-region:no-drag] data-ending-style:opacity-0 data-starting-style:opacity-0";

const DIALOG_BACKDROP_CLASS = `dialog-backdrop ${DIALOG_BACKDROP_BASE_CLASS}`;
const DIALOG_MEDIA_BACKDROP_CLASS = `${DIALOG_BACKDROP_BASE_CLASS} bg-black/75 backdrop-blur-none`;

const DIALOG_POPUP_BASE_CLASS =
  "-translate-y-[calc(1.25rem*var(--nested-dialogs,0))] relative flex min-h-0 w-full min-w-0 scale-[calc(1-0.1*var(--nested-dialogs,0))] flex-col opacity-[calc(1-0.1*var(--nested-dialogs,0))] outline-none transition-[scale,opacity,translate] duration-200 ease-in-out will-change-transform data-nested:data-ending-style:translate-y-8 data-nested:data-starting-style:translate-y-8 data-nested-dialog-open:origin-top data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 [-webkit-app-region:no-drag]";

const DIALOG_POPUP_CLASS = `dialog-glass ${DIALOG_POPUP_BASE_CLASS} rounded-2xl border`;
const DIALOG_MEDIA_POPUP_CLASS = `${DIALOG_POPUP_BASE_CLASS} max-h-[92vh] w-auto max-w-[92vw] overflow-visible rounded-none border border-transparent bg-transparent p-0 shadow-none`;

const DIALOG_MOBILE_SHEET_CLASS =
  "max-sm:max-w-none max-sm:rounded-none max-sm:border-x-0 max-sm:border-t max-sm:border-b-0 max-sm:opacity-[calc(1-min(var(--nested-dialogs,0),1))] max-sm:data-ending-style:translate-y-4 max-sm:data-starting-style:translate-y-4";

const TRANSIENT_NESTED_POPUP_SELECTOR = [
  '[data-slot="select-popup"][data-open]',
  '[data-slot="menu-popup"][data-open]',
  '[data-slot="popover-popup"][data-open]',
  '[data-slot="combobox-popup"][data-open]',
  '[data-slot="autocomplete-popup"][data-open]',
  ".pmx-cp-popover",
].join(",");

const NESTED_MODAL_SELECTOR = [
  '[data-slot="dialog-popup"][data-open]',
  '[data-slot="alert-dialog-popup"][data-open]',
  '[data-testid="plugin-trust-audit-modal"]',
  '[data-testid="plugin-rollback-dialog"]',
  '[data-testid="prismux-update-release-modal"]',
].join(",");

function resolveEffectiveZIndex(el: Element): number {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return 0;
  }
  let cur: Element | null = el;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    const style = window.getComputedStyle(cur);
    const z = Number.parseInt(style.zIndex, 10);
    if (Number.isFinite(z) && style.position !== "static") {
      return z;
    }
    cur = cur.parentElement;
  }
  return 0;
}

const DOCUMENT_POSITION_FOLLOWING_BIT = 4;

/**
 * Determines whether `candidate` is stacked visually above `reference` (higher stacking
 * z-index, or same z-index and rendered later in DOM / portal order). Underlying modals
 * such as `AppRouteModal` underneath a top-level `ProviderDeleteDialog` return `false`.
 */
function isElementStackedAbove(
  candidate: Element,
  reference: Element | null | undefined,
): boolean {
  if (!reference) return true;
  if (candidate === reference || candidate.contains(reference)) {
    return false;
  }
  const candZ = resolveEffectiveZIndex(candidate);
  const refZ = resolveEffectiveZIndex(reference);
  if (candZ !== refZ) {
    return candZ > refZ;
  }
  if (typeof reference.compareDocumentPosition === "function") {
    return (reference.compareDocumentPosition(candidate) & DOCUMENT_POSITION_FOLLOWING_BIT) !== 0;
  }
  return true;
}

/**
 * Returns true when another portaled dropdown/popover or nested dialog sits ABOVE the
 * current modal, so an outside click dismisses that inner layer first instead of closing
 * the underlying modal (e.g. closing a Select or nested AlertDialog inside Settings should
 * never close Settings, while clicking the backdrop of that top AlertDialog closes it cleanly).
 */
function hasOpenNestedOverlay(
  currentPopup: Element | null | undefined,
  doc: Document | null | undefined = typeof document !== "undefined" ? document : null,
): boolean {
  if (!doc) return false;
  const transientPopups =
    typeof doc.querySelectorAll === "function"
      ? doc.querySelectorAll(TRANSIENT_NESTED_POPUP_SELECTOR)
      : (() => {
          const single = doc.querySelector(TRANSIENT_NESTED_POPUP_SELECTOR);
          return single ? [single] : [];
        })();
  for (const popup of transientPopups) {
    if (isElementStackedAbove(popup, currentPopup)) {
      return true;
    }
  }
  const modals = doc.querySelectorAll(NESTED_MODAL_SELECTOR);
  for (const modal of modals) {
    if (isElementStackedAbove(modal, currentPopup)) {
      return true;
    }
  }
  return false;
}

export interface BackdropDismissGuardState {
  pointerDownInside: boolean;
  nestedOverlayAtPointerDown: boolean;
  nonPrimaryButton: boolean;
}

function createBackdropDismissGuardState(): BackdropDismissGuardState {
  return {
    pointerDownInside: false,
    nestedOverlayAtPointerDown: false,
    nonPrimaryButton: false,
  };
}

function recordBackdropPointerDown(
  state: BackdropDismissGuardState,
  event: { target: EventTarget | null; currentTarget: EventTarget | null; button?: number },
  currentPopup: Element | null | undefined,
  doc?: Document | null,
): void {
  const isBackdropSurface = event.target === event.currentTarget;
  state.nonPrimaryButton = typeof event.button === "number" && event.button !== 0;
  state.pointerDownInside = !isBackdropSurface;
  state.nestedOverlayAtPointerDown = isBackdropSurface
    ? hasOpenNestedOverlay(currentPopup, doc)
    : false;
}

function shouldDismissOnBackdropClick(
  state: BackdropDismissGuardState,
  event: { target: EventTarget | null; currentTarget: EventTarget | null },
  currentPopup: Element | null | undefined,
  options?: { readonly disabled?: boolean; readonly doc?: Document | null },
): boolean {
  const canDismiss =
    !options?.disabled &&
    event.target === event.currentTarget &&
    !state.nonPrimaryButton &&
    !state.pointerDownInside &&
    !state.nestedOverlayAtPointerDown &&
    !hasOpenNestedOverlay(currentPopup, options?.doc);

  state.pointerDownInside = false;
  state.nestedOverlayAtPointerDown = false;
  state.nonPrimaryButton = false;
  return canDismiss;
}

export {
  DIALOG_BACKDROP_CLASS,
  DIALOG_MEDIA_BACKDROP_CLASS,
  DIALOG_MOBILE_SHEET_CLASS,
  DIALOG_POPUP_CLASS,
  DIALOG_MEDIA_POPUP_CLASS,
  hasOpenNestedOverlay,
  createBackdropDismissGuardState,
  recordBackdropPointerDown,
  shouldDismissOnBackdropClick,
};
