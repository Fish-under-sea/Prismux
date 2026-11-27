import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentThreadState } from "@prismux/client-runtime/state/threads";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  OrchestrationV2DispatchCommandError,
  ThreadId,
} from "@prismux/core-contracts";
import { serializeAssistantCitation } from "@prismux/core-shared/assistantCitations";
import {
  formatComposerContextReference,
  toComposerContextId,
} from "@prismux/core-shared/composerContextReferences";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { AsyncResult, type Atom, AtomRegistry } from "effect/reactivity";
import { GTProvider, initializeGT } from "gt-react";
import { Profiler, useState, type ComponentProps } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  threadState: null as unknown as Atom.Writable<AsyncResult.AsyncResult<EnvironmentThreadState>>,
  workflowAtom: null as unknown as Atom.Writable<unknown>,
  workflow: null as unknown,
  commandResult: undefined as unknown,
  commandCalls: [] as Array<{ readonly command: unknown; readonly payload: unknown }>,
}));

vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  // The linked environment is connected, but its thread is not in the loaded shell.
  useQuietThreadShell: ((target: { readonly environmentId: string } | null) =>
    target === null || target.environmentId === "environment:linked"
      ? null
      : { title: "Release lead" }) as never,
}));

vi.mock(import("../../state/environments"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironment: ((environmentId: string | null) =>
    environmentId === "environment:linked" ? { environmentId } : null) as never,
}));

vi.mock(import("../../state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuery: (() => ({
    data: { tasks: [{ id: "task:webhook", title: "PR dispatcher" }] },
  })) as never,
}));

// The thread detail atoms are real, fed by one state atom the test writes;
// fixture tests can also override the workflow via `setWorkflow(...)`.
vi.mock(import("../../state/threads"), async (importOriginal) => {
  const { createEnvironmentThreadDetailAtoms, EMPTY_ENVIRONMENT_THREAD_STATE } =
    await import("@prismux/client-runtime/state/threads");
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const Option = await import("effect/Option");
  const { makeThreadProjectionFixture } = await import("../../test-fixtures");
  state.threadState = Atom.make<AsyncResult.AsyncResult<EnvironmentThreadState>>(
    AsyncResult.success({
      ...EMPTY_ENVIRONMENT_THREAD_STATE,
      data: Option.some(makeThreadProjectionFixture()),
    }),
  ).pipe(Atom.keepAlive);
  state.workflowAtom = Atom.make<unknown>(null).pipe(Atom.keepAlive);
  const realDetails = createEnvironmentThreadDetailAtoms(() => state.threadState);
  const overriddenQueueWorkflowFamily = Atom.family((key: string) =>
    Atom.make((get) => {
      const [environmentId, threadId] = key.split("\u0000") as [EnvironmentId, ThreadId];
      const real = get(realDetails.queueWorkflowAtom({ environmentId, threadId }));
      const override = get(state.workflowAtom);
      return override === null ? real : override;
    }).pipe(Atom.setIdleTTL(0)),
  );
  return {
    ...(await importOriginal()),
    environmentThreadDetails: {
      ...realDetails,
      queueWorkflowAtom: ((ref: {
        readonly environmentId: EnvironmentId;
        readonly threadId: ThreadId;
      }) =>
        overriddenQueueWorkflowFamily(
          `${ref.environmentId}\u0000${ref.threadId}`,
        )) as typeof realDetails.queueWorkflowAtom,
    },
  };
});

vi.mock(import("../../state/use-atom-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomCommand: ((command: unknown) => async (payload: unknown) => {
    state.commandCalls.push({ command, payload });
    return state.commandResult;
  }) as never,
}));

vi.mock(import("../../assets/assetUrls"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAssetUrls: ((_environmentId: never, resources: ReadonlyArray<{ attachmentId: string }>) =>
    resources.map((resource) => `https://assets.test/${resource.attachmentId}`)) as never,
}));

import "~/index.css";
import { EMPTY_ENVIRONMENT_THREAD_STATE } from "@prismux/client-runtime/state/threads";

import {
  compileResolvedKeybindingsConfig,
  mergeWithDefaultKeybindings,
} from "@prismux/core-shared/keybindings";
import { formatShortcutLabelsForCommand } from "../../keybindings";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { act, render as renderUi } from "../../../test/render";
import { makeStreamingTimelineFixture, makeThreadProjectionFixture } from "../../test-fixtures";
import { ToastProvider } from "../ui/toast";
import { QueuedRunsControl } from "./QueuedRunsControl";
import { ExpandedImageDialog } from "./ExpandedImageDialog";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";

function setWorkflow(workflow: unknown) {
  state.workflow = workflow;
  appAtomRegistry.set(state.workflowAtom, workflow);
}

function setup() {
  setWorkflow(null);
  state.commandResult = undefined;
  state.commandCalls = [];
}

const baseProps = {
  environmentId: "environment:test" as never,
  optimisticMessages: [],
  threadId: "thread:test" as never,
  editingRunId: null,
  editBlockedReason: null,
  onEditQueuedRun: () => undefined,
  onCancelEdit: () => undefined,
  timestampFormat: "locale",
  onOpenThread: () => undefined,
  onImageExpand: () => undefined,
} satisfies ComponentProps<typeof QueuedRunsControl>;

function renderWithRegistry(ui: Parameters<typeof renderUi>[0]) {
  return renderUi(
    <RegistryContext.Provider value={appAtomRegistry}>{ui}</RegistryContext.Provider>,
  );
}

async function renderQueue(props: Partial<ComponentProps<typeof QueuedRunsControl>> = {}) {
  return renderWithRegistry(<QueuedRunsControl {...baseProps} {...props} />);
}

it.each([false, true])(
  "opens queued images in the existing gallery, pending=%s",
  async (pending) => {
    setup();
    const attachments = ["first.png", "second.png"].map((name) => ({
      type: "image" as const,
      id: name,
      name,
      mimeType: "image/png",
      sizeBytes: 128,
    }));
    setWorkflow({
      activeRun: null,
      queuedRuns: pending
        ? []
        : [
            {
              run: { id: "run:queued", userMessageId: "message:queued" },
              text: "Later",
              attachments,
            },
          ],
    });
    function QueueWithGallery() {
      const [preview, setPreview] = useState<ExpandedImagePreview | null>(null);
      return (
        <>
          <QueuedRunsControl
            {...baseProps}
            optimisticMessages={
              pending
                ? [
                    {
                      id: MessageId.make("message:pending"),
                      inputIntent: "queued_turn",
                      text: "Later",
                      attachments: attachments.map((attachment) => ({
                        ...attachment,
                        previewUrl: `https://assets.test/${attachment.id}`,
                      })),
                    },
                  ]
                : []
            }
            onImageExpand={setPreview}
          />
          {preview ? (
            <ExpandedImageDialog preview={preview} onClose={() => setPreview(null)} />
          ) : null}
        </>
      );
    }
    await using _screen = await renderWithRegistry(<QueueWithGallery />);

    await page.getByRole("button", { name: "Preview second.png", exact: true }).click();
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await expect.element(page.getByText("second.png (2/2)", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Previous media", exact: true }).click();
    await expect.element(page.getByText("first.png (1/2)", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back, close image preview", exact: true }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(page.getByText("Later", { exact: true })).toBeVisible();
  },
);

it("previews assistant quotes as readable text and preserves the citation when editing", async () => {
  setup();
  const quotedText = "Cache the parsed config per worktree.";
  const quote = serializeAssistantCitation({
    version: 1,
    environmentId: EnvironmentId.make("environment:test"),
    threadId: ThreadId.make("thread:test"),
    messageId: MessageId.make("message:assistant"),
    text: quotedText,
    start: 0,
    end: quotedText.length,
    prefix: "",
    suffix: "",
  });
  const quoteAndText = `${quote}\n\nWhy per worktree?`;
  const inlineImage = formatComposerContextReference({
    kind: "image",
    contextId: toComposerContextId("header"),
    label: "header.png",
  });
  setWorkflow({
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    queuedRuns: [
      {
        run: { id: "run:quote-only", userMessageId: "message:quote-only" },
        text: quote,
        attachments: [],
      },
      {
        run: { id: "run:quote-and-text", userMessageId: "message:quote-and-text" },
        text: quoteAndText,
        attachments: [],
      },
      {
        run: { id: "run:inline-image", userMessageId: "message:inline-image" },
        text: `Make the header look like ${inlineImage} and keep the logo.`,
        attachments: [{ type: "image", id: "attachment:header", name: "header.png" }],
      },
    ],
  });
  const onEditQueuedRun = vi.fn();
  await using _screen = await renderQueue({ onEditQueuedRun });

  await expect.element(page.getByText(quotedText, { exact: true })).toBeVisible();
  await expect
    .element(page.getByText(`${quotedText} Why per worktree?`, { exact: true }))
    .toBeVisible();
  await expect
    .element(
      page.getByText("Make the header look like header.png and keep the logo.", { exact: true }),
    )
    .toBeVisible();

  await page.getByRole("button", { name: "Edit queued message", exact: true }).nth(1).click();
  expect(onEditQueuedRun).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ text: quoteAndText }),
  );
});

it("shows who sent a queued message and folds automation and agent prompts", async () => {
  setup();
  const message = (id: string, fields: Record<string, unknown>) => ({
    id,
    role: "user",
    createdAt: DateTime.makeUnsafe("2026-10-27T12:00:00.000Z"),
    ...fields,
  });
  setWorkflow({
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    queuedRuns: [
      [
        "run:automation",
        "GitHub labeled a pull request.\nFollow the runbook.",
        {
          createdBy: "agent",
          scheduledTaskId: "task:webhook",
        },
      ],
      [
        "run:agent",
        "Review finished.",
        {
          createdBy: "agent",
          creationSource: "provider",
          senderThreadId: "thread:lead",
        },
      ],
      [
        "run:linked",
        "Linked review finished.",
        {
          createdBy: "agent",
          creationSource: "mcp",
          linkedSender: {
            environmentId: "environment:linked",
            threadId: "thread:linked-lead",
            title: "Title when sent",
          },
        },
      ],
      [
        "run:server",
        "Continue where you left off.",
        {
          createdBy: "agent",
          creationSource: "server",
        },
      ],
    ].map(([runId, text, fields]) => ({
      run: { id: runId, userMessageId: `${runId}:message` },
      text,
      attachments: [],
      message: message(`${runId}:message`, { text, ...(fields as object) }),
    })),
  });
  const onOpenThread = vi.fn();
  await using _screen = await renderQueue({ onOpenThread });
  // Four rows collapse the queue.
  await page.getByRole("button", { name: "Show all 4 queued" }).click();

  const automation = page.getByRole("button", { name: /PR dispatcher/ });
  await expect.element(automation).toHaveAttribute("aria-expanded", "false");
  await expect.element(page.getByText(/Follow the runbook/)).not.toBeInTheDocument();
  await automation.click();
  await expect.element(page.getByText(/Follow the runbook/)).toBeVisible();
  await expect.element(page.getByRole("link", { name: "Open automation" })).toBeInTheDocument();

  await expect.element(page.getByRole("button", { name: /Release lead/ })).toBeVisible();
  await page.getByRole("button", { name: "Open thread" }).nth(0).click({ force: true });
  expect(onOpenThread).toHaveBeenCalledExactlyOnceWith("thread:lead", "environment:test");
  // A sender in a connected linked environment keeps the title it sent and opens there.
  await expect.element(page.getByRole("button", { name: /Title when sent/ })).toBeVisible();
  await page.getByRole("button", { name: "Open thread" }).nth(1).click({ force: true });
  expect(onOpenThread).toHaveBeenLastCalledWith("thread:linked-lead", "environment:linked");

  await expect.element(page.getByText("Sent by Prismux")).toBeVisible();
  await expect.element(page.getByText("Continue where you left off.")).toBeVisible();
});

it("stays inside the timeline scroller instead of growing the chat column", async () => {
  setup();
  setWorkflow({
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    queuedRuns: [
      {
        run: { id: "run:queued", userMessageId: "message:queued" },
        text: "Later",
        attachments: [],
      },
    ],
  });
  // Mirrors ChatView: a scrollable column, a positioned wrapper, then a non-positioned scroller.
  await using screen = await renderWithRegistry(
    <div data-testid="column" style={{ height: 200, overflowY: "auto" }}>
      <div style={{ position: "relative", height: "100%" }}>
        <div style={{ height: "100%", overflowY: "auto" }}>
          <div style={{ height: 1000 }} />
          <QueuedRunsControl {...baseProps} />
        </div>
      </div>
    </div>,
  );
  await expect.element(page.getByText("Later", { exact: true })).toBeInTheDocument();
  const column = screen.getByTestId("column").element();
  expect(column.scrollHeight).toBe(column.clientHeight);
});

it("does not re-render while assistant text streams or turn items complete in the thread", async () => {
  setup();
  const initialWorkflow = {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    canReorder: true,
    queuedRuns: [
      {
        run: { id: "run:queued", userMessageId: "message:queued" },
        text: "Run the tests next",
        attachments: [],
      },
    ],
  };
  const base = makeThreadProjectionFixture();
  // Each delta replaces only the streaming reply; every other item keeps its identity.
  const timeline = makeStreamingTimelineFixture().visibleTurnItems;
  const thread = (text: string, done = false) => {
    const items = timeline.map((entry) =>
      entry.item.type === "assistant_message" && entry.item.streaming
        ? {
            ...entry,
            item: done
              ? { ...entry.item, text, streaming: false, status: "completed" as const }
              : { ...entry.item, text },
          }
        : entry,
    );
    return AsyncResult.success<EnvironmentThreadState>({
      ...EMPTY_ENVIRONMENT_THREAD_STATE,
      data: Option.some({
        ...base,
        turnItems: items.map(({ item }) => item),
        visibleTurnItems: items,
      }),
    });
  };
  const registry = AtomRegistry.make();
  await using stack = new AsyncDisposableStack();
  stack.defer(() => registry.dispose());
  registry.set(state.workflowAtom, initialWorkflow);
  registry.set(state.threadState, thread("Hel"));
  let renders = 0;
  await using _screen = await renderUi(
    <RegistryContext.Provider value={registry}>
      <Profiler id="queue" onRender={() => (renders += 1)}>
        <QueuedRunsControl {...baseProps} />
      </Profiler>
    </RegistryContext.Provider>,
  );
  await expect.element(page.getByText("Run the tests next", { exact: true })).toBeVisible();
  const settled = renders;

  // Streaming deltas and completed turn items must cause ZERO queue dock re-renders.
  await act(() => registry.set(state.threadState, thread("Hello")));
  await act(() => registry.set(state.threadState, thread("Hello there")));
  await act(() => registry.set(state.threadState, thread("Hello there", true)));
  expect(renders).toBe(settled);

  // Only an actual queue workflow change re-renders the dock.
  await act(() =>
    registry.set(state.workflowAtom, {
      ...initialWorkflow,
      queuedRuns: [
        ...initialWorkflow.queuedRuns,
        {
          run: { id: "run:queued-2", userMessageId: "message:queued-2" },
          text: "And run lint",
          attachments: [],
        },
      ],
    }),
  );
  expect(renders).toBeGreaterThan(settled);
  await expect.element(page.getByText("And run lint", { exact: true })).toBeVisible();
});

it("tells the user why Send now was rejected", async () => {
  setup();
  const reason = "Target run run:active is stopping and cannot be steered.";
  setWorkflow({
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    queuedRuns: [
      {
        run: { id: "run:queued", userMessageId: "message:queued" },
        text: "Follow up",
        attachments: [],
      },
    ],
  });
  state.commandResult = AsyncResult.failure(
    Cause.fail(
      new OrchestrationV2DispatchCommandError({
        commandId: CommandId.make("command:promote"),
        commandType: "queued-message.promote-to-steer",
        message: reason,
        detail: reason,
      }),
    ),
  );
  await using _screen = await renderWithRegistry(
    <ToastProvider timeout={0}>
      <QueuedRunsControl {...baseProps} />
    </ToastProvider>,
  );

  await page.getByRole("button", { name: "Send now" }).click();
  await vi.waitFor(() => expect(page.getByText(reason).element()).toBeVisible());
});

it("supports DSH dock collapse/expand, single-row removal, clear-all, and paused queue resume", async () => {
  setup();
  setWorkflow({
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    isHeld: false,
    queuedRuns: [
      {
        run: { id: "run:first", userMessageId: "message:first" },
        text: "First queued task",
        attachments: [],
      },
      {
        run: { id: "run:second", userMessageId: "message:second" },
        text: "Second queued task",
        attachments: [],
      },
    ],
  });

  await using screen = await renderQueue({ steerShortcutLabel: "Ctrl+Shift+Enter" });

  // Multi-item dock header renders count, collapse toggle, and Clear action.
  const toggle = screen.container.querySelector<HTMLButtonElement>(
    "[data-queue-dock-toggle='true']",
  );
  expect(toggle).not.toBeNull();
  expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  await expect.element(page.getByText("First queued task", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Second queued task", { exact: true })).toBeVisible();

  // Clicking the dock header collapses the list cleanly; clicking again expands it.
  await act(() => toggle?.click());
  expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  await expect
    .element(page.getByText("First queued task", { exact: true }))
    .not.toBeInTheDocument();

  await act(() => toggle?.click());
  expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  await expect.element(page.getByText("First queued task", { exact: true })).toBeVisible();

  // Removing a single queued message cancels that specific run.
  await page.getByRole("button", { name: "Remove queued message", exact: true }).nth(0).click();
  expect(state.commandCalls).toHaveLength(1);
  expect(state.commandCalls[0]?.payload).toMatchObject({
    input: { runId: "run:first" },
  });

  // Clearing all queued messages cancels every queued run in order.
  state.commandCalls = [];
  await page.getByRole("button", { name: "Clear queued messages", exact: true }).click();
  await vi.waitFor(() => expect(state.commandCalls).toHaveLength(2));
  expect(
    state.commandCalls.map((call) => (call.payload as { input: { runId: string } }).input.runId),
  ).toEqual(["run:first", "run:second"]);

  // Held queue (after user interrupted active turn) shows Paused badge and Resume button.
  state.commandCalls = [];
  await act(() => {
    setWorkflow({
      activeRun: null,
      canSendNow: true,
      canPromoteToSteer: false,
      isHeld: true,
      queuedRuns: [
        {
          run: { id: "run:held", userMessageId: "message:held", queueHeld: true },
          text: "Kept after interrupt",
          attachments: [],
        },
      ],
    });
  });
  await expect.element(page.getByText("Paused", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  expect(state.commandCalls).toHaveLength(1);
  expect(state.commandCalls[0]?.payload).toMatchObject({
    input: { runId: "run:held" },
  });
});

it("renders 1:1 bilingual single-item header, 3 icon buttons with type=button (never triggering form submit), and zero nested backdrop-blur", async () => {
  setup();
  initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });
  setWorkflow({
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    isHeld: false,
    queuedRuns: [
      {
        run: { id: "run:single", userMessageId: "message:single" },
        text: "请帮我把队列卡顿也修一下",
        attachments: [],
      },
    ],
  });
  const onFormSubmit = vi.fn();
  const onEditQueuedRun = vi.fn();
  await using screen = await renderWithRegistry(
    <GTProvider locale="zh" translations={{}}>
      <div data-pmx-glass="1">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onFormSubmit();
          }}
        >
          <QueuedRunsControl {...baseProps} onEditQueuedRun={onEditQueuedRun} />
        </form>
      </div>
    </GTProvider>,
  );

  // Header shows even for 1 queued message with ZH title, count badge, and subtitle.
  await expect.element(page.getByText("排队消息", { exact: true })).toBeVisible();
  await expect.element(page.getByText("智能体结束工作后发送", { exact: true })).toBeVisible();
  expect(screen.container.querySelector('[data-queue-dock-count="1"]')?.textContent?.trim()).toBe(
    "1",
  );

  // All 3 minimal icon action buttons exist (`→`, `✎`, `🗑`) and every button inside has type="button".
  expect(screen.container.querySelector('[data-queue-row-action="send-now"]')).not.toBeNull();
  expect(screen.container.querySelector('[data-queue-row-action="edit"]')).not.toBeNull();
  expect(screen.container.querySelector('[data-queue-row-action="remove"]')).not.toBeNull();
  const allButtons = Array.from(screen.container.querySelectorAll("button"));
  expect(allButtons.length).toBeGreaterThanOrEqual(4);
  for (const button of allButtons) {
    expect(button.type).toBe("button");
  }

  // Zero nested backdrop-blur under data-pmx-glass="1".
  for (const el of Array.from(screen.container.querySelectorAll("*"))) {
    expect(el.getAttribute("class") ?? "").not.toMatch(/backdrop-blur/);
  }

  // Clicking edit & collapse toggle inside a <form> must NEVER trigger form submission.
  await act(() => {
    screen.container.querySelector<HTMLButtonElement>('[data-queue-row-action="edit"]')?.click();
  });
  expect(onEditQueuedRun).toHaveBeenCalledOnce();
  expect(onFormSubmit).not.toHaveBeenCalled();

  await act(() => {
    screen.container.querySelector<HTMLButtonElement>('[data-queue-dock-toggle="true"]')?.click();
  });
  expect(onFormSubmit).not.toHaveBeenCalled();
});

it("displays multi-binding steer and edit shortcuts from live keybindings and hides them when unbound", async () => {
  setup();
  setWorkflow({
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    isHeld: false,
    queuedRuns: [
      {
        run: { id: "run:only", userMessageId: "message:only" },
        text: "Sync queue shortcuts",
        attachments: [],
      },
    ],
  });

  const multiBindings = mergeWithDefaultKeybindings(
    compileResolvedKeybindingsConfig([
      { key: "mod+shift+enter", command: "thread.steerQueuedMessage", when: "!terminalFocus" },
      { key: "alt+enter", command: "thread.steerQueuedMessage", when: "!terminalFocus" },
      { key: "alt+arrowup", command: "thread.editQueuedMessage", when: "composerFocus" },
      { key: "ctrl+alt+e", command: "thread.editQueuedMessage", when: "composerFocus" },
    ]),
  );
  const steerLabel = formatShortcutLabelsForCommand(multiBindings, "thread.steerQueuedMessage", {
    platform: "Win32",
    context: { terminalFocus: false },
  });
  const editLabel = formatShortcutLabelsForCommand(multiBindings, "thread.editQueuedMessage", {
    platform: "Win32",
    context: { composerFocus: true },
  });
  expect(steerLabel).toBe("Alt+Enter / Ctrl+Shift+Enter");
  expect(editLabel).toBe("Ctrl+Alt+E / Alt+Up");

  await using screen = await renderWithRegistry(
    <GTProvider locale="en" translations={{}}>
      <QueuedRunsControl
        {...baseProps}
        steerShortcutLabel={steerLabel}
        editShortcutLabel={editLabel}
      />
    </GTProvider>,
  );

  await page.getByRole("button", { name: "Send now", exact: true }).hover();
  await expect
    .element(page.getByText("Send into the current turn (Alt+Enter / Ctrl+Shift+Enter)"))
    .toBeVisible();

  await page.getByRole("button", { name: "Edit queued message", exact: true }).hover();
  await expect.element(page.getByText("Edit in the composer (Ctrl+Alt+E / Alt+Up)")).toBeVisible();

  await screen.rerender(
    <RegistryContext.Provider value={appAtomRegistry}>
      <GTProvider locale="en" translations={{}}>
        <QueuedRunsControl {...baseProps} steerShortcutLabel={null} editShortcutLabel={null} />
      </GTProvider>
    </RegistryContext.Provider>,
  );

  await page.getByRole("button", { name: "Send now", exact: true }).hover();
  await expect.element(page.getByText("Send into the current turn", { exact: true })).toBeVisible();
});
