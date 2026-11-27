import type { ChatComposerProps } from "./ChatComposer";
import { type ComposerCommandItem } from "./ComposerCommandMenu";
import {
  type ComposerDispatchMode,
  resolveComposerDispatchMode,
} from "@prismux/client-runtime/state/composer-dispatch";
import { type ComposerPromptEditorHandle } from "../ComposerPromptEditorTiptap";
import {
  type ComposerPromptHistoryMentions,
  type ComposerPromptHistoryPosition,
  buildComposerPromptHistoryEntries,
  stepComposerPromptHistory,
} from "./composerPromptHistory";
import {
  type ComposerSubmissionIntent,
  type ComposerTrigger,
  collapseExpandedComposerCursor,
  composerSubmissionIntentForKey,
} from "../../composer-logic";
import { type PendingUserInput } from "../../session-logic";
import { promptSuggestionToAccept } from "./usePromptSuggestion";
import {
  type EnvironmentContextRecord,
  type PreviewAnnotationPayload,
  type ThreadContextRecord,
} from "@prismux/core-contracts";
import { type ReviewCommentContext } from "../../reviewCommentContext";
import { composerTargetKey } from "../../composerDraftStore";
import {
  type ComposerListEdit,
  listContinuationForEnter,
  listIndentForTab,
  listOutdentForTab,
} from "../../composer-list-continuation";
import type { Dispatch, RefObject, SetStateAction } from "react";

/**
 * Maximum interval (ms) between two independent Escape presses that triggers
 * force-interrupting the active turn, matching DSH NEXT `stopSequenceMs`.
 */
export const DOUBLE_ESCAPE_STOP_WINDOW_MS = 500;

export type EscapeStopPressResult = "armed" | "stop";

export type WindowEscapeStopDisposition = "ignore" | "reset" | "handle";

const EDITABLE_ESCAPE_TARGET_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [data-testid="composer-editor"]';

const BLOCKED_ESCAPE_CONTAINER_SELECTOR = ".xterm, iframe, [inert]";

/**
 * Never emits `"auto"` under queue-first or live runs: server CommandPolicy upgrades
 * `deliveryIntent: "auto"` to `steer_active`, while `"queue"` starts immediately when idle.
 */
export function resolveSafeComposerDispatchMode(input: {
  readonly running: boolean;
  readonly hasActiveRun?: boolean | undefined;
  readonly alternateModifier: boolean;
  readonly activeTurnDefault: "queue" | "steer";
  readonly canSteer: boolean;
}): ComposerDispatchMode {
  const liveRun = input.running || input.hasActiveRun === true;
  const resolved = resolveComposerDispatchMode({
    running: liveRun,
    alternateModifier: input.alternateModifier,
    activeTurnDefault: input.activeTurnDefault,
    canSteer: input.canSteer,
  });
  if (resolved === "auto" && (liveRun || input.activeTurnDefault === "queue")) {
    return "queue";
  }
  return resolved;
}

/**
 * Bare Enter on an empty composer never silently unpauses a held queue; users must click Resume.
 */
export function shouldAutoResumeOnEmptyEnter(input: {
  readonly showResumeAction: boolean;
  readonly isQueueHeld: boolean;
  readonly hasActivePendingProgress: boolean;
  readonly hasMessageToSend: boolean;
  readonly trimmedPromptLength: number;
}): boolean {
  return (
    input.showResumeAction &&
    !input.isQueueHeld &&
    !input.hasActivePendingProgress &&
    !input.hasMessageToSend &&
    input.trimmedPromptLength === 0
  );
}

/** True only when at least one top attachment/asset strip renders above the composer editor. */
export function hasComposerTopAttachmentStrip(input: {
  readonly collapsedMobile: boolean;
  readonly hasPendingUserInputs: boolean;
  readonly editingQueuedAttachmentCount: number;
  readonly hasMediaRow: boolean;
  readonly hasFileList: boolean;
}): boolean {
  const hasEditingQueuedAttachments =
    !input.collapsedMobile && !input.hasPendingUserInputs && input.editingQueuedAttachmentCount > 0;
  return hasEditingQueuedAttachments || input.hasMediaRow || input.hasFileList;
}

/**
 * Filters queued runs down to entries eligible to be promoted to steer against
 * the current active run (fresh-context runs are excluded unless promotion skips compaction).
 */
export function filterSteerableQueuedRuns<
  T extends { readonly run: { readonly freshContext?: boolean | undefined } },
>(queuedRuns: ReadonlyArray<T>, promoteSkipsCompaction: boolean | undefined): ReadonlyArray<T> {
  return queuedRuns.filter(
    ({ run }) => run.freshContext !== true || promoteSkipsCompaction === true,
  );
}

/**
 * Gates empty-draft queue steering UI, placeholder, and callback so the action
 * is only surfaced when promoting at least one queued run can actually succeed.
 */
export function canSteerEmptyQueuedRuns(input: {
  readonly routeKind: ChatComposerProps["routeKind"];
  readonly isTurnRunning: boolean;
  readonly canSteer: boolean;
  readonly canPromoteToSteer: boolean;
  readonly hasActiveRun: boolean;
  readonly steerableQueuedCount: number;
  readonly isEditingQueuedMessage: boolean;
  readonly isSendBusy: boolean;
  readonly isSendHeld: boolean;
  readonly hasPendingProgress: boolean;
  readonly isComposerApprovalState: boolean;
  readonly hasMessageToSend: boolean;
}): boolean {
  return (
    input.routeKind === "server" &&
    input.isTurnRunning &&
    input.canSteer &&
    input.canPromoteToSteer &&
    input.hasActiveRun &&
    input.steerableQueuedCount > 0 &&
    !input.isEditingQueuedMessage &&
    !input.isSendBusy &&
    !input.isSendHeld &&
    !input.hasPendingProgress &&
    !input.isComposerApprovalState &&
    !input.hasMessageToSend
  );
}

/**
 * Classifies a window Escape event for one composer: `"ignore"` for own editor,
 * `"reset"` for other inputs/panes/overlays, or `"handle"` to advance double-Esc stop.
 */
export function classifyWindowEscapeStopTarget(input: {
  readonly target: Element | null;
  readonly composerForm: Element | null;
  readonly hasOpenOverlay: boolean;
  readonly isBlockedByComposerState: boolean;
}): WindowEscapeStopDisposition {
  const { target, composerForm, hasOpenOverlay, isBlockedByComposerState } = input;
  if (composerForm === null) {
    return "reset";
  }
  // 1. Own composer's editor is handled directly by onComposerCommandKey.
  if (
    target !== null &&
    composerForm.contains(target) &&
    target.closest('[data-testid="composer-editor"]') !== null
  ) {
    return "ignore";
  }
  // 2. Any other editable field (sidebar search, thread rename, find box, another composer editor)
  //    owns Escape and must never interrupt a background run.
  if (
    target !== null &&
    (target.closest(EDITABLE_ESCAPE_TARGET_SELECTOR) !== null ||
      ("isContentEditable" in target && (target as HTMLElement).isContentEditable === true))
  ) {
    return "reset";
  }
  // 3. Overlays, terminals, iframes, inert regions, or composer busy/menu states yield Escape.
  if (
    isBlockedByComposerState ||
    hasOpenOverlay ||
    (target !== null && target.closest(BLOCKED_ESCAPE_CONTAINER_SELECTOR) !== null)
  ) {
    return "reset";
  }
  // 4. Split-pane & multi-ChatView isolation: never preempt Escape targeted at another pane or
  //    another thread view, and never steal body-level Escape from a focused sibling split pane.
  const ownChatView = composerForm.closest("[data-chat-view-thread-id]");
  const targetChatView = target?.closest("[data-chat-view-thread-id]") ?? null;
  if (targetChatView !== null && targetChatView !== ownChatView) {
    return "reset";
  }
  const ownWorkspacePane = composerForm.closest("[data-workspace-pane]");
  const targetWorkspacePane = target?.closest("[data-workspace-pane]") ?? null;
  if (targetWorkspacePane !== null && targetWorkspacePane !== ownWorkspacePane) {
    return "reset";
  }
  if (
    targetChatView === null &&
    targetWorkspacePane === null &&
    ownWorkspacePane !== null &&
    ownWorkspacePane.getAttribute("data-focused-pane") === "false"
  ) {
    return "reset";
  }
  return "handle";
}

export interface EscapeStopSequence {
  press: (input: { readonly runKey: string; readonly nowMs?: number }) => EscapeStopPressResult;
  reset: () => void;
  isArmed: () => boolean;
  dispose: () => void;
}

/**
 * Two independent Escape presses against the same active run within `windowMs`
 * trigger force-interrupt, mirroring DSH NEXT `StopSequence`.
 */
export function createEscapeStopSequence(options?: {
  readonly windowMs?: number;
  readonly onArmedChange?: (armed: boolean) => void;
}): EscapeStopSequence {
  const windowMs = options?.windowMs ?? DOUBLE_ESCAPE_STOP_WINDOW_MS;
  let first: { readonly runKey: string; readonly deadlineMs: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const reset = () => {
    const wasArmed = first !== null;
    first = null;
    clearTimer();
    if (wasArmed) {
      options?.onArmedChange?.(false);
    }
  };

  return {
    press({ runKey, nowMs = performance.now() }) {
      const previous = first;
      clearTimer();
      first = null;
      if (previous !== null && nowMs <= previous.deadlineMs && previous.runKey === runKey) {
        options?.onArmedChange?.(false);
        return "stop";
      }
      first = { runKey, deadlineMs: nowMs + windowMs };
      timer = setTimeout(() => {
        reset();
      }, windowMs + 1);
      if (previous === null) {
        options?.onArmedChange?.(true);
      }
      return "armed";
    },
    reset,
    isArmed: () => first !== null,
    dispose() {
      first = null;
      clearTimer();
    },
  };
}

/**
 * The composer's key handling inside the editor: send shortcuts, the slash/mention menu,
 * prompt history on ArrowUp/ArrowDown, plan-mode toggle, prompt suggestions on Tab,
 * empty-draft accelerated queue steering, double-Escape stop sequencing, and list continuation.
 * Returns the editor's key handler; it reads the inputs captured by the render that built it.
 */
export function composerCommandKeyHandler(input: {
  readonly keybindings: ChatComposerProps["keybindings"];
  readonly getShortcutContext: ChatComposerProps["getShortcutContext"];
  readonly sendShortcut: ChatComposerProps["settings"]["sendShortcut"];
  readonly routeKind: ChatComposerProps["routeKind"];
  readonly phase: ChatComposerProps["phase"];
  /** True when server projection/workflow reports a live run even if `phase` briefly reports ready. */
  readonly hasActiveRun?: boolean;
  readonly canSteer: boolean;
  readonly followUpBehavior: ChatComposerProps["settings"]["followUpBehavior"];
  readonly isSoftwareKeyboardOpen: boolean;
  readonly isLiteralPendingAnswer: boolean;
  readonly pendingUserInputs: ReadonlyArray<PendingUserInput>;
  readonly promptHistoryEntries: ChatComposerProps["promptHistoryEntries"];
  readonly promptHistoryPositionRef: RefObject<{
    targetKey: string;
    position: ComposerPromptHistoryPosition;
  } | null>;
  readonly composerDraftTarget: ChatComposerProps["composerDraftTarget"];
  readonly promptRef: ChatComposerProps["promptRef"];
  readonly composerImagesRef: ChatComposerProps["composerImagesRef"];
  readonly composerFilesRef: ChatComposerProps["composerFilesRef"];
  readonly composerTerminalContextsRef: ChatComposerProps["composerTerminalContextsRef"];
  readonly composerPreviewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
  readonly composerReviewComments: ReadonlyArray<ReviewCommentContext>;
  readonly hasReplyTo?: boolean;
  readonly hasThreadContexts?: boolean;
  readonly hasEnvironmentContexts?: boolean;
  readonly hasPreparingImages?: boolean;
  readonly composerEditorRef: RefObject<ComposerPromptEditorHandle | null>;
  readonly composerMenuItemsRef: RefObject<ComposerCommandItem[]>;
  readonly activeComposerMenuItemRef: RefObject<ComposerCommandItem | null>;
  readonly setComposerDraftPrompt: (
    target: ChatComposerProps["composerDraftTarget"],
    prompt: string,
  ) => void;
  readonly setComposerDraftThreadContexts: (
    target: ChatComposerProps["composerDraftTarget"],
    records: ReadonlyArray<ThreadContextRecord>,
  ) => void;
  readonly setComposerDraftEnvironmentContexts: (
    target: ChatComposerProps["composerDraftTarget"],
    records: ReadonlyArray<EnvironmentContextRecord>,
  ) => void;
  readonly setComposerCursor: Dispatch<SetStateAction<number>>;
  readonly setComposerTrigger: (trigger: ComposerTrigger | null) => void;
  readonly setComposerHighlightedItemId: Dispatch<SetStateAction<string | null>>;
  readonly dismissComposerTrigger: (trigger: ComposerTrigger | null) => void;
  readonly nudgeComposerMenuHighlight: (key: "ArrowDown" | "ArrowUp") => void;
  readonly onSelectComposerItem: (item: ComposerCommandItem) => void;
  readonly resolveActiveComposerTrigger: () => { trigger: ComposerTrigger | null };
  readonly readComposerSnapshot: () => { value: string };
  readonly applyPromptReplacement: (
    rangeStart: number,
    rangeEnd: number,
    replacement: string,
    options?: { expandedCursorAfterReplace?: number },
  ) => boolean;
  readonly submitComposer: (
    event: undefined,
    dispatchMode: ComposerDispatchMode,
    submissionIntent: ComposerSubmissionIntent,
  ) => void;
  /** Steers queued messages when the user presses Mod+Enter on an empty draft while running. */
  readonly onSteerQueuedMessages?: () => boolean;
  /** Handles plain Escape when no overlay/menu/suggestion consumed it (e.g. double-Esc interrupt). */
  readonly onEscapeWhenIdle?: (event: KeyboardEvent) => boolean;
  /** Clears any armed double-Escape stop sequence when another Escape layer handles the press. */
  readonly onResetEscapeStop?: () => void;
  /** Predicted next prompt that Tab fills into an empty composer; Escape dismisses it. */
  readonly promptSuggestion: string | null;
  readonly dismissPromptSuggestion: () => void;
}) {
  const {
    keybindings,
    getShortcutContext,
    sendShortcut,
    routeKind,
    phase,
    hasActiveRun = false,
    canSteer,
    followUpBehavior,
    isSoftwareKeyboardOpen,
    isLiteralPendingAnswer,
    pendingUserInputs,
    promptHistoryEntries,
    promptHistoryPositionRef,
    composerDraftTarget,
    promptRef,
    composerImagesRef,
    composerFilesRef,
    composerTerminalContextsRef,
    composerPreviewAnnotations,
    composerReviewComments,
    hasReplyTo = false,
    hasThreadContexts = false,
    hasEnvironmentContexts = false,
    hasPreparingImages = false,
    composerEditorRef,
    composerMenuItemsRef,
    activeComposerMenuItemRef,
    setComposerDraftPrompt,
    setComposerDraftThreadContexts,
    setComposerDraftEnvironmentContexts,
    setComposerCursor,
    setComposerTrigger,
    setComposerHighlightedItemId,
    dismissComposerTrigger,
    nudgeComposerMenuHighlight,
    onSelectComposerItem,
    resolveActiveComposerTrigger,
    readComposerSnapshot,
    applyPromptReplacement,
    submitComposer,
    onSteerQueuedMessages,
    onEscapeWhenIdle,
    onResetEscapeStop,
    promptSuggestion,
    dismissPromptSuggestion,
  } = input;

  // The composer persists across threads. A recall from thread A must not
  // be treated as active in thread B, where the text-match fallback could
  // otherwise turn B's own draft into a browsing position.
  const promptHistoryTargetKey = composerTargetKey(composerDraftTarget);

  const replacePromptFromHistory = (
    nextPrompt: string,
    mentions: ComposerPromptHistoryMentions,
  ) => {
    promptRef.current = nextPrompt;
    setComposerDraftPrompt(composerDraftTarget, nextPrompt);
    setComposerDraftThreadContexts(composerDraftTarget, mentions.threadContexts);
    setComposerDraftEnvironmentContexts(composerDraftTarget, mentions.environmentContexts);
    setComposerCursor(collapseExpandedComposerCursor(nextPrompt, nextPrompt.length));
    setComposerTrigger(null);
    setComposerHighlightedItemId(null);
  };

  const navigatePromptHistory = (
    direction: "backward" | "forward",
    event: KeyboardEvent,
  ): boolean => {
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || event.isComposing) {
      return false;
    }
    if (pendingUserInputs.length > 0) return false;
    if (
      composerImagesRef.current.length > 0 ||
      composerFilesRef.current.length > 0 ||
      composerTerminalContextsRef.current.length > 0 ||
      composerPreviewAnnotations.length > 0 ||
      composerReviewComments.length > 0
    ) {
      return false;
    }
    const recalled = promptHistoryPositionRef.current;
    const position = recalled?.targetKey === promptHistoryTargetKey ? recalled.position : null;
    if (position === null && promptRef.current.length > 0) {
      return false;
    }
    const editor = composerEditorRef.current;
    if (!editor?.isCaretOnVisualEdge(direction === "backward" ? "start" : "end")) {
      return false;
    }
    const step = stepComposerPromptHistory({
      direction,
      // Built on the keypress, not per render: the timeline changes on every streamed delta.
      entries: buildComposerPromptHistoryEntries(
        promptHistoryEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
      ),
      position,
      currentPrompt: promptRef.current,
    });
    if (!step) return false;
    promptHistoryPositionRef.current = step.position
      ? { targetKey: promptHistoryTargetKey, position: step.position }
      : null;
    replacePromptFromHistory(step.prompt, step.mentions);
    return true;
  };

  const applyListEdit = (
    event: KeyboardEvent,
    listEdit: (value: string, start: number, end: number) => ComposerListEdit | null,
  ): boolean => {
    if (isLiteralPendingAnswer || event.isComposing) return false;
    const selection = composerEditorRef.current?.readSelectionRange();
    const snapshot = readComposerSnapshot();
    if (!selection || selection.start !== selection.end || snapshot.value !== promptRef.current) {
      return false;
    }
    const edit = listEdit(snapshot.value, selection.start, selection.end);
    return (
      edit !== null &&
      applyPromptReplacement(edit.start, edit.end, edit.replacement, {
        expandedCursorAfterReplace: edit.cursorAfter,
      })
    );
  };

  const onComposerCommandKey = (key: string, event: KeyboardEvent, isTaskItem = false) => {
    const isTurnLive = phase === "running" || phase === "connecting" || hasActiveRun;
    const isImeComposition = event.isComposing || event.keyCode === 229;
    const submissionIntent = isImeComposition
      ? null
      : composerSubmissionIntentForKey({
          event,
          keybindings,
          context: getShortcutContext(event.target),
          isSoftwareKeyboardOpen,
          isDraftThread: routeKind === "draft",
          isRunning: isTurnLive,
          sendShortcut,
          prompt: promptRef.current,
        });
    if (key === "Tab" && event.shiftKey && submissionIntent === null) {
      return applyListEdit(event, listOutdentForTab);
    }
    const { trigger } = resolveActiveComposerTrigger();
    const menuIsActive = !isLiteralPendingAnswer && trigger !== null;
    if (key === "Escape") {
      if (event.isComposing || event.keyCode === 229) {
        onResetEscapeStop?.();
        return false;
      }
      if (!menuIsActive && promptSuggestion !== null && promptRef.current.length === 0) {
        onResetEscapeStop?.();
        dismissPromptSuggestion();
        return true;
      }
      if (menuIsActive) {
        onResetEscapeStop?.();
        dismissComposerTrigger(trigger);
        return true;
      }
      if (
        onEscapeWhenIdle &&
        !event.repeat &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        return onEscapeWhenIdle(event);
      }
      onResetEscapeStop?.();
      return false;
    }
    if (
      menuIsActive &&
      !event.shiftKey &&
      (submissionIntent === null || submissionIntent === "foreground")
    ) {
      const currentItems = composerMenuItemsRef.current;
      const selectedItem = activeComposerMenuItemRef.current ?? currentItems[0];
      if (key === "ArrowDown" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowDown");
        return true;
      }
      if (key === "ArrowUp" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowUp");
        return true;
      }
      if ((key === "Enter" || key === "Tab") && selectedItem) {
        onSelectComposerItem(selectedItem);
        return true;
      }
    }
    const acceptedSuggestion = promptSuggestionToAccept(promptSuggestion, promptRef.current);
    if (
      key === "Tab" &&
      acceptedSuggestion !== null &&
      !menuIsActive &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.isComposing &&
      event.keyCode !== 229
    ) {
      // The typing guard must see this draft, so an approval that lands next is not answered with it.
      return applyPromptReplacement(0, 0, acceptedSuggestion);
    }
    if ((key === "ArrowUp" || key === "ArrowDown") && submissionIntent === null) {
      return navigatePromptHistory(key === "ArrowUp" ? "backward" : "forward", event);
    }
    if (submissionIntent) {
      if (event.repeat || isImeComposition) return false;
      const isComposerEmpty =
        promptRef.current.trim().length === 0 &&
        composerImagesRef.current.length === 0 &&
        composerFilesRef.current.length === 0 &&
        composerTerminalContextsRef.current.length === 0 &&
        composerPreviewAnnotations.length === 0 &&
        composerReviewComments.length === 0 &&
        pendingUserInputs.length === 0 &&
        !hasReplyTo &&
        !hasThreadContexts &&
        !hasEnvironmentContexts &&
        !hasPreparingImages;
      if (
        isTurnLive &&
        followUpBehavior === "queue" &&
        submissionIntent === "alternate" &&
        isComposerEmpty &&
        onSteerQueuedMessages?.() === true
      ) {
        return true;
      }
      submitComposer(
        undefined,
        resolveSafeComposerDispatchMode({
          running: isTurnLive,
          alternateModifier: submissionIntent === "alternate",
          activeTurnDefault: followUpBehavior,
          canSteer,
        }),
        submissionIntent,
      );
      return true;
    }
    if (key === "Enter" && isTaskItem) return false;
    if (key === "Enter" || (key === "Tab" && !event.shiftKey)) {
      return applyListEdit(event, key === "Enter" ? listContinuationForEnter : listIndentForTab);
    }
    return false;
  };

  return onComposerCommandKey;
}
