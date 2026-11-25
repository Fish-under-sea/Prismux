/**
 * Status bar right-click context menu exemption policy.
 * Modeled after Orca `status-bar/composition/status-bar-context-menu-policy.ts`:
 * Popovers and controls inside the 24px status bar can carry their own context
 * menus or text selection; right-clicking inside them must not open the status
 * bar's global segment visibility menu (including when a React-portalled popup
 * bubbles synthetic events back up to the footer subtree).
 */

export const STATUS_BAR_CONTEXT_MENU_EXEMPT_ATTRIBUTE =
  "data-status-bar-context-menu-exempt" as const;

export const STATUS_BAR_CONTEXT_MENU_EXEMPT_SELECTOR =
  `[${STATUS_BAR_CONTEXT_MENU_EXEMPT_ATTRIBUTE}]` as const;

export const STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS: Readonly<{
  readonly [STATUS_BAR_CONTEXT_MENU_EXEMPT_ATTRIBUTE]: "";
}> = Object.freeze({
  [STATUS_BAR_CONTEXT_MENU_EXEMPT_ATTRIBUTE]: "",
});

function resolveEventElement(target: EventTarget | null): Element | null {
  if (!target || typeof target !== "object") {
    return null;
  }
  if (typeof Element !== "undefined" && target instanceof Element) {
    return target;
  }
  // Text nodes (nodeType === 3) and other Nodes inherit parentElement.
  const maybeParent = (target as { parentElement?: unknown }).parentElement;
  if (typeof Element !== "undefined" && maybeParent instanceof Element) {
    return maybeParent;
  }
  // Support lightweight DOM mocks in unit tests without full browser globals.
  if (typeof (target as { closest?: unknown }).closest === "function") {
    return target as Element;
  }
  if (
    maybeParent &&
    typeof maybeParent === "object" &&
    typeof (maybeParent as { closest?: unknown }).closest === "function"
  ) {
    return maybeParent as Element;
  }
  return null;
}

/**
 * Returns `true` only when a right-click target is outside any element marked
 * with `data-status-bar-context-menu-exempt`.
 */
export function shouldOpenStatusBarContextMenu(target: EventTarget | null): boolean {
  const element = resolveEventElement(target);
  if (!element) {
    return true;
  }
  return element.closest(STATUS_BAR_CONTEXT_MENU_EXEMPT_SELECTOR) === null;
}
