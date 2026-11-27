/* oxlint-disable prismux/no-untranslated-copy -- Selection toolbar resolves zh/en labels inline via useLocale() to avoid modifying zh.json across parallel tracks */
import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@prismux/core-contracts";
import { useLocale } from "gt-react";
import { type CSSProperties, use, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  captureAssistantTextSelection,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import {
  isSelectionRectVisible,
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import { isInSideChatPane } from "~/lib/sideChatPane";
import { cn, isMacPlatform } from "~/lib/utils";
import { BackgroundThreadContext } from "./backgroundThread";

export interface SelectionToolbarCopy {
  readonly toolbarLabel: string;
  readonly citeLabel: string;
  readonly sideAskLabel: string;
  readonly shortenSelectionLabel: string;
  readonly citeAriaLabel: string;
  readonly citeTooLongAriaLabel: string;
  readonly sideAskAriaLabel: string;
  readonly sideAskTooLongAriaLabel: string;
}

export function resolveSelectionToolbarCopy(
  locale: string | null | undefined,
): SelectionToolbarCopy {
  const isZh = typeof locale === "string" && locale.toLowerCase().startsWith("zh");
  if (isZh) {
    return {
      toolbarLabel: "选区操作",
      citeLabel: "引用",
      sideAskLabel: "旁路提问",
      shortenSelectionLabel: "选区过长，请缩短",
      citeAriaLabel: "引用选中文本到输入框",
      citeTooLongAriaLabel: "选区过长，无法引用",
      sideAskAriaLabel: "基于选中文本发起旁路提问",
      sideAskTooLongAriaLabel: "选区过长，无法发起旁路提问",
    };
  }
  return {
    toolbarLabel: "Selection actions",
    citeLabel: "Cite",
    sideAskLabel: "Side ask",
    shortenSelectionLabel: "Shorten selection",
    citeAriaLabel: "Cite selection in composer",
    citeTooLongAriaLabel: "Selection is too long to cite",
    sideAskAriaLabel: "Ask a side question about selection",
    sideAskTooLongAriaLabel: "Selection is too long for side ask",
  };
}

export const SELECTION_CITE_COMMAND = "chat.citeSelection" as const;
export const SELECTION_SIDE_ASK_COMMAND = "chat.sideAskSelection" as const;

export type SelectionToolbarShortcutAction = "cite" | "side-ask";

export interface SelectionToolbarShortcutConfig {
  /** Formatted shortcut label for Cite (e.g. from `shortcutLabelForCommand(keybindings, "chat.citeSelection")`); `null` hides the badge when unbound. */
  readonly citeLabel: string | null;
  /** Formatted shortcut label for Side Ask (e.g. from `shortcutLabelForCommand(keybindings, "chat.sideAskSelection")`); `null` hides the badge when unbound. */
  readonly sideAskLabel: string | null;
  /** Single-point matcher for foreground selection shortcuts; omit to fall back to default `Ctrl/Cmd+L` & `Ctrl/Cmd+E`. */
  readonly matchEvent?:
    | ((event: KeyboardEvent, canSideAsk: boolean) => SelectionToolbarShortcutAction | null)
    | undefined;
}

export function resolveSelectionToolbarShortcuts(platform: string): {
  readonly cite: string;
  readonly sideAsk: string;
} {
  return isMacPlatform(platform)
    ? { cite: "⌘L", sideAsk: "⌘E" }
    : { cite: "Ctrl+L", sideAsk: "Ctrl+E" };
}

export function matchSelectionToolbarShortcut(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "code"
    | "ctrlKey"
    | "metaKey"
    | "altKey"
    | "shiftKey"
    | "isComposing"
    | "defaultPrevented"
  >,
  platform: string,
  canSideAsk: boolean,
): SelectionToolbarShortcutAction | null {
  if (event.isComposing || event.defaultPrevented || event.altKey || event.shiftKey) {
    return null;
  }
  const mac = isMacPlatform(platform);
  const modPressed = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modPressed) return null;

  const lowerKey = event.key.toLowerCase();
  if (lowerKey === "l" || event.code === "KeyL") {
    return "cite";
  }
  if (canSideAsk && (lowerKey === "e" || event.code === "KeyE")) {
    return "side-ask";
  }
  return null;
}

export interface ResolvedSelectionToolbarShortcutConfig {
  readonly citeLabel: string | null;
  readonly sideAskLabel: string | null;
  readonly matchEvent: (
    event: KeyboardEvent,
    canSideAsk: boolean,
  ) => SelectionToolbarShortcutAction | null;
}

export function resolveSelectionToolbarShortcutConfig(
  platform: string,
  overrides?: SelectionToolbarShortcutConfig,
): ResolvedSelectionToolbarShortcutConfig {
  const defaults = resolveSelectionToolbarShortcuts(platform);
  return {
    citeLabel: overrides ? overrides.citeLabel : defaults.cite,
    sideAskLabel: overrides ? overrides.sideAskLabel : defaults.sideAsk,
    matchEvent:
      overrides?.matchEvent ??
      ((event, canSideAsk) => matchSelectionToolbarShortcut(event, platform, canSideAsk)),
  };
}

const CAPSULE_SURFACE_CLASSNAME = cn(
  "fixed z-50 inline-flex h-8 max-w-[calc(100vw-1rem)] items-center overflow-hidden rounded-full border select-none",
  "transition-[background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none",
  // Light & Dark semantic elevated pill surfaces
  "border-border/80 bg-popover/96 text-popover-foreground shadow-lg ring-1 ring-inset ring-black/4",
  "dark:border-white/16 dark:bg-card/96 dark:text-popover-foreground dark:shadow-xl dark:ring-white/8",
  // Liquid glass dual polarity (inherits theme --popover and blurs backdrop cleanly)
  "[[data-pmx-glass='1']_&]:border-foreground/15 [[data-pmx-glass='1']_&]:bg-popover/85",
  "[[data-pmx-glass='1']_&]:backdrop-blur-md [[data-pmx-glass='1']_&]:backdrop-saturate-150",
  "[[data-pmx-glass='1']_&]:ring-white/40",
  "[.dark[data-pmx-glass='1']_&]:border-white/18 [.dark[data-pmx-glass='1']_&]:ring-white/12",
);

const ACTION_BUTTON_BASE_CLASSNAME = cn(
  "group inline-flex h-full shrink-0 cursor-pointer items-center gap-1.5 text-xs leading-none font-medium outline-none",
  "transition-colors duration-150 motion-reduce:transition-none",
  "text-popover-foreground hover:bg-foreground/[0.06] active:bg-foreground/[0.1]",
  "dark:hover:bg-white/10 dark:active:bg-white/15",
  "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
);

const SHORTCUT_HINT_CLASSNAME = cn(
  "font-sans text-2xs leading-none font-normal tracking-tight tabular-nums text-popover-foreground/72",
  "transition-colors duration-150 motion-reduce:transition-none",
);

const DIVIDER_CLASSNAME = cn(
  "h-3.5 w-px shrink-0 bg-border/80 dark:bg-white/18",
  "[[data-pmx-glass='1']_&]:bg-foreground/16 [.dark[data-pmx-glass='1']_&]:bg-white/20",
);

const GLASS_HOVER_BUTTON_STYLE: CSSProperties = {
  backgroundColor:
    "var(--pmx-accent-soft, color-mix(in srgb, var(--pmx-accent, var(--primary)) 14%, transparent))",
  color: "var(--pmx-accent-text, var(--pmx-accent, var(--popover-foreground)))",
};

const GLASS_HOVER_SHORTCUT_STYLE: CSSProperties = {
  color: "var(--pmx-accent-text, var(--pmx-accent, var(--muted-foreground)))",
};

function isDocumentGlassActive(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-pmx-glass") === "1"
  );
}

export function AssistantSelectionToolbar({
  viewport,
  threadRef,
  onCite,
  onSideAsk,
  canSideAsk = true,
  shortcuts: shortcutOverrides,
}: {
  viewport: HTMLElement | null;
  threadRef: ScopedThreadRef;
  onCite: (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean;
  onSideAsk?:
    | ((citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean)
    | undefined;
  canSideAsk?: boolean | undefined;
  shortcuts?: SelectionToolbarShortcutConfig | undefined;
}) {
  const [selection, setSelection] = useState<{
    citation: AssistantCitation;
    position: SelectionActionPoint;
    sourceAnchor: AssistantCitationSourceAnchor;
  } | null>(null);
  const [hoveredAction, setHoveredAction] = useState<SelectionToolbarShortcutAction | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const citeButtonRef = useRef<HTMLButtonElement>(null);
  const sideAskButtonRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);
  const backgroundThread = use(BackgroundThreadContext);
  const locale = useLocale();
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  const copy = resolveSelectionToolbarCopy(locale);
  const resolvedShortcuts = resolveSelectionToolbarShortcutConfig(platform, shortcutOverrides);
  const canShowSideAsk = Boolean(onSideAsk) && canSideAsk && !isInSideChatPane(viewport);
  const tooLong =
    selection !== null && selection.citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;

  const dismiss = () => {
    actionsRef.current?.cancel();
    setHoveredAction(null);
    setSelection(null);
  };

  const cite = () => {
    if (!selection || tooLong || !onCite(selection.citation, selection.sourceAnchor)) return false;
    window.getSelection()?.removeAllRanges();
    dismiss();
    return true;
  };

  const sideAsk = () => {
    if (
      !selection ||
      tooLong ||
      !canShowSideAsk ||
      !onSideAsk ||
      !onSideAsk(selection.citation, selection.sourceAnchor)
    ) {
      return false;
    }
    window.getSelection()?.removeAllRanges();
    dismiss();
    return true;
  };

  const latestRef = useRef({
    hasSelection: false,
    tooLong: false,
    canShowSideAsk: false,
    matchShortcut: resolvedShortcuts.matchEvent,
    cite,
    sideAsk,
  });
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- keeps capture-phase keyboard listener reading current selection and action callbacks without re-subscribing
  useLayoutEffect(() => {
    latestRef.current = {
      hasSelection: selection !== null,
      tooLong,
      canShowSideAsk,
      matchShortcut: resolvedShortcuts.matchEvent,
      cite,
      sideAsk,
    };
  });

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- measures the toolbar DOM node and clamps its position inside the window before paint
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    const rect = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(selection.position.x, window.innerWidth - rect.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(selection.position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to document selectionchange and keydown to track text selections in the viewport
  useEffect(() => {
    if (!viewport) return;
    const clear = () => {
      setHoveredAction(null);
      setSelection(null);
    };
    const update = (pointer: SelectionActionPoint | null) => {
      const nativeSelection = window.getSelection();
      const captured = captureAssistantTextSelection(viewport, nativeSelection);
      const messageId = captured?.source.dataset.assistantCitationSource;
      if (!captured || !messageId) {
        clear();
        return;
      }
      const rect = captured.range.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (!isSelectionRectVisible(rect, [viewportRect])) {
        clear();
        return;
      }
      // A selection can cross blocks with different clipping ancestors.
      const common = captured.range.commonAncestorContainer;
      const walker = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
      let node = common.nodeType === Node.TEXT_NODE ? common : walker.nextNode();
      let visible = false;
      for (; node && !visible; node = walker.nextNode()) {
        if (!captured.range.intersectsNode(node)) continue;
        if (node.parentElement && getComputedStyle(node.parentElement).userSelect === "none")
          continue;
        const fragment = document.createRange();
        fragment.selectNodeContents(node);
        if (node === captured.range.startContainer) {
          fragment.setStart(node, captured.range.startOffset);
        }
        if (node === captured.range.endContainer) {
          fragment.setEnd(node, captured.range.endOffset);
        }
        if (!fragment.toString().trim()) continue;
        const lines = Array.from(fragment.getClientRects());
        if (!lines.some((line) => isSelectionRectVisible(line, [viewportRect]))) continue;
        const clips: Pick<DOMRect, "left" | "right" | "top" | "bottom">[] = [viewportRect];
        for (
          let element = node.parentElement;
          element && element !== viewport;
          element = element.parentElement
        ) {
          const style = getComputedStyle(element);
          const clipX = style.overflowX !== "visible";
          const clipY = style.overflowY !== "visible";
          if (!clipX && !clipY) continue;
          const bounds = element.getBoundingClientRect();
          const left = bounds.left + element.clientLeft;
          const top = bounds.top + element.clientTop;
          clips.push({
            left: clipX ? left : -Infinity,
            right: clipX ? left + element.clientWidth : Infinity,
            top: clipY ? top : -Infinity,
            bottom: clipY ? top + element.clientHeight : Infinity,
          });
        }
        visible = lines.some((line) => isSelectionRectVisible(line, clips));
      }
      if (!visible) {
        clear();
        return;
      }
      const rects = captured.range.getClientRects();
      const pointerOnText =
        pointer !== null &&
        Array.from(rects).some(
          (line) =>
            pointer.x >= line.left - 8 &&
            pointer.x <= line.right + 8 &&
            pointer.y >= line.top - 8 &&
            pointer.y <= line.bottom + 8,
        );
      setSelection({
        sourceAnchor: { source: captured.source, range: captured.range, viewport },
        citation: {
          version: 1,
          ...threadRef,
          messageId: MessageId.make(messageId),
          ...captured.selector,
        },
        position: resolveSelectionActionPosition({
          bounds: viewportRect,
          selectionRect: rects.item(rects.length - 1) ?? rect,
          pointer: pointerOnText ? pointer : null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
    };
    const actions = observeSelectionActions({
      element: viewport,
      getActionElement: () => toolbarRef.current,
      restoreAfterScroll: true,
      immediateMultiClick: true,
      onSelection: update,
      onDismiss: clear,
    });
    actionsRef.current = actions;
    const handleForegroundKeyDown = (event: KeyboardEvent) => {
      const toolbar = toolbarRef.current;
      const current = latestRef.current;
      if (!current.hasSelection || !toolbar) return;

      const matchedShortcut = current.matchShortcut(event, current.canShowSideAsk);
      if (matchedShortcut === "cite") {
        event.preventDefault();
        event.stopPropagation();
        current.cite();
        return;
      }
      if (matchedShortcut === "side-ask") {
        event.preventDefault();
        event.stopPropagation();
        current.sideAsk();
        return;
      }

      if (
        event.key !== "Tab" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.defaultPrevented ||
        toolbar.contains(event.target as Node)
      ) {
        return;
      }
      const firstAction = citeButtonRef.current;
      if (!firstAction || firstAction.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      firstAction.focus({ preventScroll: true });
    };
    // Shortcuts and Tab focus belong to the foreground chat; a background timeline stands down.
    if (!backgroundThread) document.addEventListener("keydown", handleForegroundKeyDown, true);
    document.addEventListener("selectionchange", actions.selectionChanged);
    return () => {
      document.removeEventListener("keydown", handleForegroundKeyDown, true);
      document.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [backgroundThread, threadRef, viewport]);

  if (!selection) return null;

  const glassActive = isDocumentGlassActive();
  const citeGlassHover = glassActive && hoveredAction === "cite";
  const sideAskGlassHover = glassActive && hoveredAction === "side-ask";

  const moveToolbarFocus = (direction: 1 | -1) => {
    const buttons = [citeButtonRef.current, sideAskButtonRef.current].filter(
      (button): button is HTMLButtonElement => button !== null && !button.disabled,
    );
    if (buttons.length < 2) return;
    const currentIndex = buttons.findIndex((button) => button === document.activeElement);
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + direction + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus({ preventScroll: true });
  };

  return createPortal(
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={copy.toolbarLabel}
      data-testid="assistant-selection-toolbar"
      data-selection-toolbar="true"
      className={CAPSULE_SURFACE_CLASSNAME}
      style={{
        left: selection.position.x,
        top: selection.position.y,
        ...(glassActive
          ? { backgroundColor: "var(--pmx-glass-zone-overlays-bg, var(--popover))" }
          : undefined),
      }}
      onPointerDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          dismiss();
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          moveToolbarFocus(1);
          return;
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          moveToolbarFocus(-1);
        }
      }}
    >
      {tooLong ? (
        <button
          ref={citeButtonRef}
          type="button"
          disabled
          data-selection-too-long="true"
          data-testid="selection-action-cite"
          aria-label={copy.citeTooLongAriaLabel}
          className="inline-flex h-full cursor-not-allowed items-center rounded-full px-3 text-xs leading-none font-medium text-muted-foreground"
        >
          {copy.shortenSelectionLabel}
        </button>
      ) : (
        <>
          <button
            ref={citeButtonRef}
            type="button"
            data-testid="selection-action-cite"
            data-selection-action="cite"
            aria-label={copy.citeAriaLabel}
            className={cn(
              ACTION_BUTTON_BASE_CLASSNAME,
              canShowSideAsk ? "rounded-l-full pr-2.5 pl-3" : "rounded-full px-3",
            )}
            style={citeGlassHover ? GLASS_HOVER_BUTTON_STYLE : undefined}
            onPointerEnter={() => setHoveredAction("cite")}
            onPointerLeave={() =>
              setHoveredAction((current) => (current === "cite" ? null : current))
            }
            onClick={cite}
          >
            <span>{copy.citeLabel}</span>
            {resolvedShortcuts.citeLabel ? (
              <kbd
                aria-hidden="true"
                data-selection-shortcut="true"
                className={SHORTCUT_HINT_CLASSNAME}
                style={citeGlassHover ? GLASS_HOVER_SHORTCUT_STYLE : undefined}
              >
                {resolvedShortcuts.citeLabel}
              </kbd>
            ) : null}
          </button>
          {canShowSideAsk ? (
            <>
              <span
                aria-hidden="true"
                data-selection-toolbar-divider="true"
                className={DIVIDER_CLASSNAME}
              />
              <button
                ref={sideAskButtonRef}
                type="button"
                data-testid="selection-action-side-ask"
                data-selection-action="side-ask"
                aria-label={copy.sideAskAriaLabel}
                className={cn(ACTION_BUTTON_BASE_CLASSNAME, "rounded-r-full pr-3 pl-2.5")}
                style={sideAskGlassHover ? GLASS_HOVER_BUTTON_STYLE : undefined}
                onPointerEnter={() => setHoveredAction("side-ask")}
                onPointerLeave={() =>
                  setHoveredAction((current) => (current === "side-ask" ? null : current))
                }
                onClick={sideAsk}
              >
                <span>{copy.sideAskLabel}</span>
                {resolvedShortcuts.sideAskLabel ? (
                  <kbd
                    aria-hidden="true"
                    data-selection-shortcut="true"
                    className={SHORTCUT_HINT_CLASSNAME}
                    style={sideAskGlassHover ? GLASS_HOVER_SHORTCUT_STYLE : undefined}
                  >
                    {resolvedShortcuts.sideAskLabel}
                  </kbd>
                ) : null}
              </button>
            </>
          ) : null}
        </>
      )}
    </div>,
    document.body,
  );
}
