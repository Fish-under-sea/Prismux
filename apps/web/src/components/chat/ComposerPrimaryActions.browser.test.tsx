import "~/index.css";

import type { ComponentProps } from "react";
import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../../test/render";

vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => "none",
  useClientSettings: () => false,
}));
vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: () => null,
  useSidebarStageBackdropVariant: () => null,
}));

import { CollapsedComposerStopAction, ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { classifyWindowEscapeStopTarget } from "./composerCommandKey";

function setup() {
  return {
    compact: true,
    canOperateThread: true,
    pendingAction: null,
    isRunning: true,
    canInterrupt: true,
    canResume: false,
    isSendBusy: false,
    sendDisabledReason: null,
    isEnvironmentUnavailable: false,
    isPreparingWorktree: false,
    hasSendableContent: false,
    onPreviousPendingQuestion: vi.fn(),
    onInterrupt: vi.fn(),
    onResume: vi.fn(),
    onSubmitMessage: vi.fn(),
  } satisfies ComponentProps<typeof ComposerPrimaryActions>;
}

it.each(["resume", "draft", "question"] as const)(
  "keeps repeat Stop clicks from reaching the action that replaces it (%s)",
  async (mode) => {
    const props = setup();
    const submit = vi.fn();
    const pendingAction =
      mode === "question"
        ? {
            questionIndex: 0,
            isLastQuestion: true,
            canAdvance: true,
            isResponding: false,
            isComplete: true,
          }
        : null;
    const view = (overrides: Partial<ComponentProps<typeof ComposerPrimaryActions>> = {}) => (
      <form
        style={{ display: "flex", justifyContent: "flex-end", width: "400px" }}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <ComposerPrimaryActions {...props} pendingAction={pendingAction} {...overrides} />
      </form>
    );
    await using screen = await render(view());
    using _timers = fakeTimers();
    const stop = screen
      .getByRole("button", { name: "Stop generation" })
      .element() as HTMLButtonElement;
    const { x, y, width, height } = stop.getBoundingClientRect();
    const target = () =>
      document.elementFromPoint(x + width / 2, y + height / 2)?.closest("button");
    await act(() => stop.click());
    await act(() =>
      (
        screen.getByRole("button", { name: "Stopping", exact: true }).element() as HTMLButtonElement
      ).click(),
    );
    expect(screen.getByRole("button", { name: "Stopping", exact: true }).element()).toBeDisabled();
    expect(props.onInterrupt).toHaveBeenCalledTimes(1);
    await screen.rerender(
      view({
        isRunning: false,
        canInterrupt: false,
        canResume: true,
        hasSendableContent: mode === "draft",
      }),
    );
    const action = { resume: "Resume thread", draft: "Submit message", question: "Submit" }[mode];
    expect(screen.getByRole("button", { name: "Stop generation" }).query()).toBeNull();
    expect(target()).toBe(screen.getByRole("button", { name: action, exact: true }).element());
    await act(() => {
      for (let i = 0; i < 20; i++) target()?.click();
    });
    await act(() => vi.advanceTimersByTime(499));
    await act(() => target()?.click());
    expect(props.onResume).not.toHaveBeenCalled();
    expect(props.onSubmitMessage).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTime(1));
    await act(() => target()?.click());
    expect(
      { resume: props.onResume, draft: props.onSubmitMessage, question: submit }[mode],
    ).toHaveBeenCalledTimes(1);
    await screen.rerender(view());
    expect(screen.getByRole("button", { name: "Stop generation" }).element()).toBeEnabled();
  },
);

it("allows retry after ten seconds and protects a late stop", async () => {
  const props = setup();
  await using screen = await render(<ComposerPrimaryActions {...props} />);
  using _timers = fakeTimers();
  await act(() =>
    (
      screen.getByRole("button", { name: "Stop generation" }).element() as HTMLButtonElement
    ).click(),
  );
  await act(() => vi.advanceTimersByTime(9_999));
  expect(screen.getByRole("button", { name: "Stopping", exact: true }).element()).toBeDisabled();
  await act(() => vi.advanceTimersByTime(1));
  await act(() =>
    (
      screen.getByRole("button", { name: "Stop generation" }).element() as HTMLButtonElement
    ).click(),
  );
  await screen.rerender(
    <ComposerPrimaryActions {...props} isRunning={false} canInterrupt={false} canResume />,
  );
  await act(() =>
    (screen.getByRole("button", { name: "Resume thread" }).element() as HTMLButtonElement).click(),
  );
  expect(props.onInterrupt).toHaveBeenCalledTimes(2);
  expect(props.onResume).not.toHaveBeenCalled();
});

it("keeps Stop pending across a permission failure", async () => {
  const props = setup();
  await using screen = await render(<ComposerPrimaryActions {...props} />);
  await act(() =>
    (
      screen.getByRole("button", { name: "Stop generation" }).element() as HTMLButtonElement
    ).click(),
  );
  await screen.rerender(
    <ComposerPrimaryActions {...props} canOperateThread={false} canInterrupt={false} />,
  );
  await screen.rerender(<ComposerPrimaryActions {...props} />);
  await expect
    .element(screen.getByRole("button", { name: "Stopping", exact: true }))
    .toBeDisabled();
  expect(props.onInterrupt).toHaveBeenCalledTimes(1);
});

it("keeps a pending stop when the run id clears and resets it for a different run", async () => {
  const props = setup();
  await using screen = await render(<ComposerPrimaryActions {...props} runId="first" />);
  await act(() =>
    (
      screen.getByRole("button", { name: "Stop generation" }).element() as HTMLButtonElement
    ).click(),
  );
  await screen.rerender(<ComposerPrimaryActions {...props} runId={null} />);
  expect(screen.getByRole("button", { name: "Stopping", exact: true }).element()).toBeDisabled();
  await screen.rerender(<ComposerPrimaryActions {...props} runId="second" />);
  expect(screen.getByRole("button", { name: "Stop generation" }).element()).toBeEnabled();
});

it("swaps the collapsed composer's send button for Stop while a turn can be stopped", async () => {
  const onInterrupt = vi.fn();
  const collapsed = (overrides: { canInterrupt?: boolean; hasSendableContent?: boolean } = {}) => (
    <CollapsedComposerStopAction
      canOperateThread
      canInterrupt={overrides.canInterrupt ?? true}
      runId="run"
      hasSendableContent={overrides.hasSendableContent ?? false}
      isEditingQueuedMessage={false}
      onInterrupt={onInterrupt}
    >
      <button type="button">Send message</button>
    </CollapsedComposerStopAction>
  );
  await using screen = await render(collapsed({ hasSendableContent: true }));
  await expect.element(screen.getByRole("button", { name: "Send message" })).toBeVisible();
  await screen.rerender(collapsed());
  await act(() =>
    (
      screen.getByRole("button", { name: "Stop generation" }).element() as HTMLButtonElement
    ).click(),
  );
  expect(onInterrupt).toHaveBeenCalledTimes(1);
  await expect
    .element(screen.getByRole("button", { name: "Stopping", exact: true }))
    .toBeDisabled();
  await screen.rerender(collapsed({ canInterrupt: false }));
  await expect.element(screen.getByRole("button", { name: "Send message" })).toBeVisible();
});

it("defaults to queueing without interrupting while running and exposes force-steer shortcut pill", async () => {
  const props = setup();
  const onAlternateSubmitMessage = vi.fn();
  await using screen = await render(
    <ComposerPrimaryActions
      {...props}
      compact={false}
      isRunning
      canSteer
      hasSendableContent
      alternateShortcutLabel="Ctrl+Enter"
      onAlternateSubmitMessage={onAlternateSubmitMessage}
    />,
  );

  // Primary button queues by default (non-interrupting).
  await expect.element(screen.getByRole("button", { name: "Queue message" })).toBeVisible();
  // Adjacent shortcut pill clearly surfaces the force-interrupt/steer action and triggers it on click.
  const steerPill = screen.getByRole("button", { name: /Steer now \(Ctrl\+Enter\)/ });
  await expect.element(steerPill).toBeVisible();
  expect(steerPill.element().getAttribute("data-composer-alternate-action")).toBe("steer");
  await act(() => (steerPill.element() as HTMLButtonElement).click());
  expect(onAlternateSubmitMessage).toHaveBeenCalledTimes(1);
});

it("surfaces double-Esc confirmation chip and empty-draft steer-queue pill when running", async () => {
  const props = setup();
  const onSteerQueuedMessages = vi.fn();
  await using screen = await render(
    <ComposerPrimaryActions
      {...props}
      compact={false}
      isRunning
      canInterrupt
      canSteer
      hasSendableContent={false}
      queuedCount={2}
      alternateShortcutLabel="Ctrl+Enter"
      onSteerQueuedMessages={onSteerQueuedMessages}
    />,
  );

  const steerQueueButton = screen.getByRole("button", {
    name: /Steer queued messages \(Ctrl\+Enter\)/,
  });
  await expect.element(steerQueueButton).toBeVisible();
  await act(() => (steerQueueButton.element() as HTMLButtonElement).click());
  expect(onSteerQueuedMessages).toHaveBeenCalledTimes(1);

  await screen.rerender(
    <ComposerPrimaryActions
      {...props}
      compact={false}
      isRunning
      canInterrupt
      canSteer
      hasSendableContent={false}
      queuedCount={2}
      escStopArmed
      alternateShortcutLabel="Ctrl+Enter"
      onSteerQueuedMessages={onSteerQueuedMessages}
    />,
  );
  await expect.element(screen.getByText(/again to stop/)).toBeVisible();

  // When empty-queue steering is gated off (e.g. connecting/no activeRun/freshContext-only/approval),
  // no dead steer-queue pill should be rendered.
  await screen.rerender(
    <ComposerPrimaryActions
      {...props}
      compact={false}
      isRunning
      canInterrupt
      canSteer
      hasSendableContent={false}
      queuedCount={0}
      alternateShortcutLabel="Ctrl+Enter"
      onSteerQueuedMessages={undefined}
    />,
  );
  expect(document.querySelector('[data-composer-steer-queue-action="true"]')).toBeNull();
});

it("isolates window double-Escape from other editable controls and sibling split panes", async () => {
  await render(
    <div>
      <aside>
        <input data-testid="sidebar-search" />
        <textarea data-testid="rename-textarea" />
        <select data-testid="filter-select" />
        <div data-testid="rich-editable" contentEditable suppressContentEditableWarning>
          <span data-testid="rich-editable-child">editing</span>
        </div>
        <div data-testid="bare-editable" />
      </aside>
      <section data-workspace-pane="pane-left" data-focused-pane="false">
        <div data-testid="left-tabbar">Left tab</div>
        <div data-chat-view-thread-id="thread-left">
          <div data-testid="left-timeline">Left timeline</div>
          <form data-testid="left-form">
            <div data-testid="composer-editor">
              <span data-testid="left-editor-text">left draft</span>
            </div>
            <button type="button" data-testid="left-toolbar-btn">
              Stop
            </button>
          </form>
        </div>
      </section>
      <section data-workspace-pane="pane-right" data-focused-pane="true">
        <div data-testid="right-tabbar">Right tab</div>
        <div data-chat-view-thread-id="thread-right">
          <div data-testid="right-timeline">Right timeline</div>
          <form data-testid="right-form">
            <div data-testid="composer-editor">
              <span data-testid="right-editor-text">right draft</span>
            </div>
          </form>
        </div>
      </section>
    </div>,
  );

  const leftForm = document.querySelector('[data-testid="left-form"]')!;
  const rightForm = document.querySelector('[data-testid="right-form"]')!;
  document.querySelector('[data-testid="bare-editable"]')!.setAttribute("contenteditable", "");
  const classify = (composerForm: Element | null, target: Element | null) =>
    classifyWindowEscapeStopTarget({
      target,
      composerForm,
      hasOpenOverlay: false,
      isBlockedByComposerState: false,
    });

  // 1. Editable controls outside the composer always reset without claiming Escape.
  for (const testId of [
    "sidebar-search",
    "rename-textarea",
    "filter-select",
    "rich-editable",
    "rich-editable-child",
    "bare-editable",
  ]) {
    const el = document.querySelector(`[data-testid="${testId}"]`)!;
    expect(classify(leftForm, el)).toBe("reset");
    expect(classify(rightForm, el)).toBe("reset");
  }

  // 2. Own composer editor returns "ignore" (handled by onComposerCommandKey); sibling editor resets.
  const leftEditorText = document.querySelector('[data-testid="left-editor-text"]')!;
  const rightEditorText = document.querySelector('[data-testid="right-editor-text"]')!;
  expect(classify(leftForm, leftEditorText)).toBe("ignore");
  expect(classify(rightForm, leftEditorText)).toBe("reset");
  expect(classify(rightForm, rightEditorText)).toBe("ignore");
  expect(classify(leftForm, rightEditorText)).toBe("reset");

  // 3. Double-Escape on right pane timeline/tabbar only triggers right pane, never left pane.
  const rightTimeline = document.querySelector('[data-testid="right-timeline"]')!;
  const rightTabbar = document.querySelector('[data-testid="right-tabbar"]')!;
  expect(classify(leftForm, rightTimeline)).toBe("reset");
  expect(classify(rightForm, rightTimeline)).toBe("handle");
  expect(classify(leftForm, rightTabbar)).toBe("reset");
  expect(classify(rightForm, rightTabbar)).toBe("handle");

  // 4. Double-Escape on left pane timeline/button only triggers left pane, never right pane.
  const leftTimeline = document.querySelector('[data-testid="left-timeline"]')!;
  const leftToolbarBtn = document.querySelector('[data-testid="left-toolbar-btn"]')!;
  expect(classify(leftForm, leftTimeline)).toBe("handle");
  expect(classify(rightForm, leftTimeline)).toBe("reset");
  expect(classify(leftForm, leftToolbarBtn)).toBe("handle");
  expect(classify(rightForm, leftToolbarBtn)).toBe("reset");

  // 5. Body-level Escape in split view only handles the focused pane.
  expect(classify(leftForm, document.body)).toBe("reset");
  expect(classify(rightForm, document.body)).toBe("handle");

  // 6. Detached composer never claims Escape.
  expect(classify(null, rightTimeline)).toBe("reset");
});
