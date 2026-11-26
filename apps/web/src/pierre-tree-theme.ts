import type { CSSProperties, PointerEvent } from "react";

const TREE_ACCENT_OVERRIDE = "var(--pmx-accent, var(--primary, #5e9bff))";
const TREE_FOCUS_RING_COLOR_OVERRIDE =
  "color-mix(in srgb, var(--pmx-accent, var(--ring, var(--primary, #5e9bff))) 82%, transparent)";
const TREE_SELECTED_FOCUSED_BORDER_COLOR_OVERRIDE =
  "color-mix(in srgb, var(--pmx-accent, var(--ring, var(--primary, #5e9bff))) 90%, transparent)";
const TREE_SELECTED_BG_OVERRIDE =
  "var(--pmx-glass-base-active-row-bg-color, color-mix(in srgb, var(--pmx-accent, var(--primary, currentColor)) 18%, transparent))";
const TREE_SELECTED_FG_OVERRIDE = "var(--contrast-foreground)";
const TREE_HOVER_BG_OVERRIDE =
  "color-mix(in srgb, var(--pmx-accent, currentColor) 10%, transparent)";
const TREE_BORDER_RADIUS_OVERRIDE = "9px";
const TREE_SCROLLBAR_THUMB_OVERRIDE =
  "color-mix(in srgb, var(--contrast-foreground, currentColor) 26%, transparent)";

export const PIERRE_TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-accent-override: ${TREE_ACCENT_OVERRIDE};
    --trees-focus-ring-color-override: ${TREE_FOCUS_RING_COLOR_OVERRIDE};
    --trees-selected-focused-border-color-override: ${TREE_SELECTED_FOCUSED_BORDER_COLOR_OVERRIDE};
    --trees-selected-bg-override: ${TREE_SELECTED_BG_OVERRIDE};
    --trees-selected-fg-override: ${TREE_SELECTED_FG_OVERRIDE};
    --trees-hover-bg-override: ${TREE_HOVER_BG_OVERRIDE};
    --trees-bg-muted-override: ${TREE_HOVER_BG_OVERRIDE};
    --trees-border-radius-override: ${TREE_BORDER_RADIUS_OVERRIDE};
    --trees-scrollbar-thumb-override: ${TREE_SCROLLBAR_THUMB_OVERRIDE};
    --trees-border-color-override: color-mix(in srgb, var(--contrast-foreground, currentColor) 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 0.75rem;
  }
  [data-file-tree-virtualized-scroll='true'] {
    padding-inline: 8px;
  }
  [data-truncate-content='visible'] { overflow: hidden; text-overflow: ellipsis; }
  [data-truncate-marker] { display: none; }
  button[data-type='item'], button[data-type='item']::before {
    border-radius: var(--trees-border-radius);
  }
  button[data-type='item'] {
    transition: background-color 140ms ease, box-shadow 140ms ease, color 140ms ease;
  }
  button[data-type='item']:hover:not([data-item-selected='true']) {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--contrast-foreground, currentColor) 10%, transparent);
  }
  button[data-type='item'][data-item-selected='true'] {
    background-image: var(--pmx-glass-base-active-row-bg-image, none);
    box-shadow: var(
      --pmx-glass-base-active-row-shadow,
      inset 0 0 0 1px color-mix(in srgb, var(--pmx-accent, var(--primary, #5e9bff)) 44%, transparent)
    );
  }
  @media (prefers-reduced-motion: reduce) {
    button[data-type='item'] {
      transition-duration: 0.01ms;
    }
  }
  svg[data-icon-name='prismux-tree-icon-loading'] { opacity: 0.6; }
  @media (prefers-reduced-motion: no-preference) {
    svg[data-icon-name='prismux-tree-icon-loading'] { animation: prismux-tree-spin 1s linear infinite; }
  }
  @keyframes prismux-tree-spin { to { transform: rotate(360deg); } }
`;

export function pierreTreeStyle(colorScheme: "light" | "dark"): CSSProperties {
  return {
    colorScheme,
    ["--trees-fg-override" as string]: "var(--contrast-foreground)",
    ["--trees-fg-muted-override" as string]: "var(--contrast-muted-foreground)",
    ["--trees-status-ignored-override" as string]: "var(--contrast-muted-foreground)",
    ["--trees-accent-override" as string]: TREE_ACCENT_OVERRIDE,
    ["--trees-focus-ring-color-override" as string]: TREE_FOCUS_RING_COLOR_OVERRIDE,
    ["--trees-selected-focused-border-color-override" as string]:
      TREE_SELECTED_FOCUSED_BORDER_COLOR_OVERRIDE,
    ["--trees-selected-bg-override" as string]: TREE_SELECTED_BG_OVERRIDE,
    ["--trees-selected-fg-override" as string]: TREE_SELECTED_FG_OVERRIDE,
    ["--trees-hover-bg-override" as string]: TREE_HOVER_BG_OVERRIDE,
    ["--trees-bg-muted-override" as string]: TREE_HOVER_BG_OVERRIDE,
    ["--trees-border-radius-override" as string]: TREE_BORDER_RADIUS_OVERRIDE,
    ["--trees-scrollbar-thumb-override" as string]: TREE_SCROLLBAR_THUMB_OVERRIDE,
  };
}

// Clipped labels are unreadable and the tree cannot scroll sideways, so a clipped row gets its full name as a native tooltip.
export function titleClippedPierreTreeRow(event: PointerEvent<HTMLElement>) {
  const row = event.nativeEvent
    .composedPath()
    .find(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && node.matches("button[data-type='item']"),
    );
  if (!row) return;
  const label = row.getAttribute("aria-label");
  const clipped = Array.from(
    row.querySelectorAll<HTMLElement>("[data-truncate-content='visible']"),
  ).some((element) => element.scrollWidth > element.clientWidth);
  if (label && clipped) row.title = label;
  else row.removeAttribute("title");
}
