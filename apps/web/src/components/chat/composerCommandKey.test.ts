import { DEFAULT_RESOLVED_KEYBINDINGS } from "@prismux/core-shared/keybindings";
import { EnvironmentId, ThreadId } from "@prismux/core-contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  composerCommandKeyHandler,
  createEscapeStopSequence,
  DOUBLE_ESCAPE_STOP_WINDOW_MS,
} from "./composerCommandKey";

function makeKeyEvent(key: string, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    code: key === "Enter" ? "Enter" : key === "Escape" ? "Escape" : key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    keyCode: 0,
    target: null,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

function createHandler(overrides: Partial<Parameters<typeof composerCommandKeyHandler>[0]> = {}) {
  const submitComposer = vi.fn();
  const onSteerQueuedMessages = vi.fn(() => false);
  const onEscapeWhenIdle = vi.fn(() => true);
  const onResetEscapeStop = vi.fn();
  const dismissComposerTrigger = vi.fn();
  const dismissPromptSuggestion = vi.fn();

  const promptRef = { current: "follow up message" };
  const handler = composerCommandKeyHandler({
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    getShortcutContext: () => ({
      terminalFocus: false,
      terminalOpen: false,
      previewFocus: false,
      previewOpen: false,
      isWeb: true,
      isDesktop: false,
      modelPickerOpen: false,
    }),
    sendShortcut: "enter",
    routeKind: "server",
    phase: "running",
    canSteer: true,
    followUpBehavior: "queue",
    isSoftwareKeyboardOpen: false,
    isLiteralPendingAnswer: false,
    pendingUserInputs: [],
    promptHistoryEntries: [],
    promptHistoryPositionRef: { current: null },
    composerDraftTarget: {
      environmentId: EnvironmentId.make("environment:test"),
      threadId: ThreadId.make("thread:test"),
    },
    promptRef,
    composerImagesRef: { current: [] },
    composerFilesRef: { current: [] },
    composerTerminalContextsRef: { current: [] },
    composerPreviewAnnotations: [],
    composerReviewComments: [],
    composerEditorRef: { current: null },
    composerMenuItemsRef: { current: [] },
    activeComposerMenuItemRef: { current: null },
    setComposerDraftPrompt: vi.fn(),
    setComposerDraftThreadContexts: vi.fn(),
    setComposerDraftEnvironmentContexts: vi.fn(),
    setComposerCursor: vi.fn(),
    setComposerTrigger: vi.fn(),
    setComposerHighlightedItemId: vi.fn(),
    dismissComposerTrigger,
    nudgeComposerMenuHighlight: vi.fn(),
    onSelectComposerItem: vi.fn(),
    resolveActiveComposerTrigger: () => ({ trigger: null }),
    readComposerSnapshot: () => ({ value: promptRef.current }),
    applyPromptReplacement: vi.fn(() => false),
    submitComposer,
    onSteerQueuedMessages,
    onEscapeWhenIdle,
    onResetEscapeStop,
    promptSuggestion: null,
    dismissPromptSuggestion,
    ...overrides,
  });

  return {
    handler,
    submitComposer,
    onSteerQueuedMessages,
    onEscapeWhenIdle,
    onResetEscapeStop,
    dismissComposerTrigger,
    dismissPromptSuggestion,
  };
}

describe("composerCommandKeyHandler (DSH queue-by-default & force-interrupt shortcuts)", () => {
  it("queues without interrupting on plain Enter when running with default queue behavior", () => {
    const { handler, submitComposer } = createHandler({
      phase: "running",
      followUpBehavior: "queue",
      canSteer: true,
    });

    const handled = handler("Enter", makeKeyEvent("Enter"));

    expect(handled).toBe(true);
    expect(submitComposer).toHaveBeenCalledExactlyOnceWith(undefined, "queue", "foreground");
  });

  it("steers / force-interrupts on Ctrl+Enter (non-Mac) when running with queue default", () => {
    const { handler, submitComposer } = createHandler({
      phase: "running",
      followUpBehavior: "queue",
      canSteer: true,
    });

    const handled = handler("Enter", makeKeyEvent("Enter", { ctrlKey: true }));

    expect(handled).toBe(true);
    expect(submitComposer).toHaveBeenCalledExactlyOnceWith(undefined, "steer", "alternate");
  });

  it("queues on Ctrl+Enter when user explicitly switches followUpBehavior to steer", () => {
    const { handler, submitComposer } = createHandler({
      phase: "running",
      followUpBehavior: "steer",
      canSteer: true,
    });

    expect(handler("Enter", makeKeyEvent("Enter"))).toBe(true);
    expect(submitComposer).toHaveBeenLastCalledWith(undefined, "steer", "foreground");

    expect(handler("Enter", makeKeyEvent("Enter", { ctrlKey: true }))).toBe(true);
    expect(submitComposer).toHaveBeenLastCalledWith(undefined, "queue", "alternate");
  });

  it("steers queued messages on empty-draft Ctrl+Enter while running (DSH empty-draft steerQueue parity)", () => {
    const onSteerQueuedMessages = vi.fn(() => true);
    const { handler, submitComposer } = createHandler({
      phase: "running",
      followUpBehavior: "queue",
      canSteer: true,
      promptRef: { current: "   " },
      onSteerQueuedMessages,
    });

    const handled = handler("Enter", makeKeyEvent("Enter", { ctrlKey: true }));

    expect(handled).toBe(true);
    expect(onSteerQueuedMessages).toHaveBeenCalledOnce();
    expect(submitComposer).not.toHaveBeenCalled();
  });

  it("submits non-empty draft as steer instead of triggering empty-draft queue steer", () => {
    const onSteerQueuedMessages = vi.fn(() => true);
    const { handler, submitComposer } = createHandler({
      phase: "running",
      followUpBehavior: "queue",
      canSteer: true,
      promptRef: { current: "interrupt with this instead" },
      onSteerQueuedMessages,
    });

    const handled = handler("Enter", makeKeyEvent("Enter", { ctrlKey: true }));

    expect(handled).toBe(true);
    expect(onSteerQueuedMessages).not.toHaveBeenCalled();
    expect(submitComposer).toHaveBeenCalledExactlyOnceWith(undefined, "steer", "alternate");
  });

  it("layers Escape cleanly: menu -> suggestion -> idle double-Escape handler", () => {
    // 1. Open menu wins over idle escape and resets stop sequence.
    const menuCase = createHandler({
      resolveActiveComposerTrigger: () => ({
        trigger: { kind: "slash-command", query: "mo", rangeStart: 0, rangeEnd: 3 },
      }),
    });
    expect(menuCase.handler("Escape", makeKeyEvent("Escape"))).toBe(true);
    expect(menuCase.dismissComposerTrigger).toHaveBeenCalledOnce();
    expect(menuCase.onResetEscapeStop).toHaveBeenCalledOnce();
    expect(menuCase.onEscapeWhenIdle).not.toHaveBeenCalled();

    // 2. Prompt suggestion on empty draft wins over idle escape.
    const suggestionCase = createHandler({
      promptRef: { current: "" },
      promptSuggestion: "Run the test suite",
    });
    expect(suggestionCase.handler("Escape", makeKeyEvent("Escape"))).toBe(true);
    expect(suggestionCase.dismissPromptSuggestion).toHaveBeenCalledOnce();
    expect(suggestionCase.onResetEscapeStop).toHaveBeenCalledOnce();
    expect(suggestionCase.onEscapeWhenIdle).not.toHaveBeenCalled();

    // 3. Idle plain Escape routes to double-Escape stop sequence.
    const idleCase = createHandler();
    expect(idleCase.handler("Escape", makeKeyEvent("Escape"))).toBe(true);
    expect(idleCase.onEscapeWhenIdle).toHaveBeenCalledOnce();

    // 4. Repeat or modified Escape resets without arming/stopping.
    const repeatCase = createHandler();
    expect(repeatCase.handler("Escape", makeKeyEvent("Escape", { repeat: true }))).toBe(false);
    expect(repeatCase.onEscapeWhenIdle).not.toHaveBeenCalled();
    expect(repeatCase.onResetEscapeStop).toHaveBeenCalledOnce();

    // 5. IME composition Escape resets and yields to browser IME.
    const imeCase = createHandler();
    expect(imeCase.handler("Escape", makeKeyEvent("Escape", { isComposing: true }))).toBe(false);
    expect(imeCase.onEscapeWhenIdle).not.toHaveBeenCalled();
    expect(imeCase.onResetEscapeStop).toHaveBeenCalledOnce();
  });
});

describe("createEscapeStopSequence (DSH Esc-Esc 500ms window parity)", () => {
  it("requires two independent Escape presses within 500ms on the same run to stop", () => {
    vi.useFakeTimers();
    try {
      const armedStates: boolean[] = [];
      const seq = createEscapeStopSequence({
        windowMs: DOUBLE_ESCAPE_STOP_WINDOW_MS,
        onArmedChange: (armed) => armedStates.push(armed),
      });

      expect(seq.press({ runKey: "env:thread:run-1", nowMs: 1_000 })).toBe("armed");
      expect(seq.isArmed()).toBe(true);
      expect(armedStates).toEqual([true]);

      // Second press within 500ms triggers stop and disarms.
      expect(seq.press({ runKey: "env:thread:run-1", nowMs: 1_450 })).toBe("stop");
      expect(seq.isArmed()).toBe(false);
      expect(armedStates).toEqual([true, false]);

      // A press after the 500ms window expires does not stop — it re-arms.
      expect(seq.press({ runKey: "env:thread:run-1", nowMs: 2_000 })).toBe("armed");
      expect(seq.press({ runKey: "env:thread:run-1", nowMs: 2_600 })).toBe("armed");
      expect(seq.isArmed()).toBe(true);

      // A different run invalidates the previous press and arms freshly.
      expect(seq.press({ runKey: "env:thread:run-2", nowMs: 2_700 })).toBe("armed");
      expect(seq.press({ runKey: "env:thread:run-2", nowMs: 2_900 })).toBe("stop");
      expect(seq.isArmed()).toBe(false);

      // Timer auto-disarms after windowMs + 1.
      expect(seq.press({ runKey: "env:thread:run-3", nowMs: 5_000 })).toBe("armed");
      vi.advanceTimersByTime(DOUBLE_ESCAPE_STOP_WINDOW_MS + 1);
      expect(seq.isArmed()).toBe(false);

      seq.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
