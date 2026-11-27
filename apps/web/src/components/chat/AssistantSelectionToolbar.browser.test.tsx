import { scopeThreadRef } from "@prismux/client-runtime/environment";
import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  EnvironmentId,
  MessageId,
  ThreadId,
  type AssistantCitation,
} from "@prismux/core-contracts";
import { serializeAssistantCitation } from "@prismux/core-shared/assistantCitations";
import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
  mergeWithDefaultKeybindings,
} from "@prismux/core-shared/keybindings";
import { GTProvider } from "gt-react";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "@prismux/appearance/styles.css";
import "~/index.css";
import { useComposerDraftStore } from "../../composerDraftStore";
import {
  clearPendingSideAskCitations,
  deliverCitationToSideThread,
  enqueueSideAskCitation,
  registerSideThreadComposerBridge,
} from "../../lib/sideChatPane";
import { isMacPlatform } from "../../lib/utils";
import { act, render } from "../../../test/render";
import {
  loadPersistedSideQuestions,
  savePersistedSideQuestions,
} from "../overview/sessionOverview.logic";
import {
  AssistantSelectionToolbar,
  createSelectionToolbarShortcutConfig,
  type SelectionToolbarShortcutConfig,
} from "./AssistantSelectionToolbar";
import { BackgroundThreadContext } from "./backgroundThread";
import { SideChatEmptySurface } from "./RightPanelEmptySurfaces";

const envId = EnvironmentId.make("env-browser");
const mainThreadId = ThreadId.make("thread-main");
const sideThreadId = ThreadId.make("thread-side");
const mainThreadRef = scopeThreadRef(envId, mainThreadId);
const sideThreadRef = scopeThreadRef(envId, sideThreadId);

type Rgba = { r: number; g: number; b: number; a: number };

function parseColor(raw: string): Rgba {
  const match = raw.match(
    /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)/,
  );
  if (match) {
    return {
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3]),
      a: match[4] !== undefined ? Number(match[4]) : 1,
    };
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = raw;
  ctx.fillRect(0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;
  return { r: data[0]!, g: data[1]!, b: data[2]!, a: data[3]! / 255 };
}

function compositeOver(fg: Rgba, bg: Rgba): Rgba {
  const alpha = fg.a + bg.a * (1 - fg.a);
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / alpha,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / alpha,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / alpha,
    a: alpha,
  };
}

function relativeLuminance(c: Rgba) {
  const toLinear = (channel: number) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

function contrastRatio(fg: Rgba, bg: Rgba) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function acquireSelectionTestScope(): Disposable {
  return {
    [Symbol.dispose]() {
      window.getSelection()?.removeAllRanges();
      clearPendingSideAskCitations(mainThreadRef);
      savePersistedSideQuestions(envId, mainThreadId, []);
      useComposerDraftStore.setState(useComposerDraftStore.getInitialState());
    },
  };
}

function SelectionToolbarHarness({
  text = "这是一个用于验证引用和旁路提问悬浮胶囊的示例回复文本。",
  locale = "zh",
  onCite,
  onSideAsk,
  canSideAsk = true,
  insideSideChatPane = false,
  backgroundThread = false,
  shortcuts,
}: {
  text?: string;
  locale?: string;
  onCite: (citation: AssistantCitation) => boolean;
  onSideAsk?: ((citation: AssistantCitation) => boolean) | undefined;
  canSideAsk?: boolean;
  insideSideChatPane?: boolean;
  backgroundThread?: boolean;
  shortcuts?: SelectionToolbarShortcutConfig | undefined;
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);

  const content = (
    <div
      ref={setViewport}
      data-assistant-citation-viewport="true"
      style={{ width: 640, height: 220, padding: 32, overflow: "auto" }}
    >
      <p
        data-assistant-citation-source={MessageId.make("msg-assistant-1")}
        data-assistant-citation-environment={envId}
        data-assistant-citation-thread={mainThreadId}
        data-testid="assistant-message-body"
      >
        {text}
      </p>
      <AssistantSelectionToolbar
        viewport={viewport}
        threadRef={mainThreadRef}
        onCite={(citation) => onCite(citation)}
        onSideAsk={onSideAsk ? (citation) => onSideAsk(citation) : undefined}
        canSideAsk={canSideAsk}
        shortcuts={shortcuts}
      />
    </div>
  );

  const wrapped = insideSideChatPane ? (
    <div data-side-chat-pane={sideThreadId}>{content}</div>
  ) : (
    content
  );

  return (
    <GTProvider locale={locale} translations={{}}>
      <BackgroundThreadContext value={backgroundThread}>{wrapped}</BackgroundThreadContext>
    </GTProvider>
  );
}

async function selectMessageSubstring(startOffset: number, endOffset: number) {
  const paragraph = document.querySelector<HTMLElement>('[data-testid="assistant-message-body"]')!;
  const textNode = paragraph.firstChild as Text;
  const bounds = paragraph.getBoundingClientRect();
  await act(() => {
    paragraph.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        isPrimary: true,
        clientX: bounds.left + 8,
        clientY: bounds.top + 8,
        bubbles: true,
        cancelable: true,
      }),
    );
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    const range = document.createRange();
    range.setStart(textNode, startOffset);
    range.setEnd(textNode, endOffset);
    selection.addRange(range);
    const rangeRect = range.getBoundingClientRect();
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        button: 0,
        isPrimary: true,
        clientX: rangeRect.right,
        clientY: rangeRect.bottom,
        bubbles: true,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        button: 0,
        detail: 1,
        clientX: rangeRect.right,
        clientY: rangeRect.bottom,
        bubbles: true,
      }),
    );
  });
}

function primaryModKeyEventInit(key: "l" | "e") {
  const mac = isMacPlatform(navigator.platform);
  return {
    key,
    code: key === "l" ? "KeyL" : "KeyE",
    ctrlKey: !mac,
    metaKey: mac,
    bubbles: true,
    cancelable: true,
  };
}

describe("AssistantSelectionToolbar (browser)", () => {
  it("renders dual-button rounded capsule with divider and localized shortcut hints", async () => {
    using _scope = acquireSelectionTestScope();
    const onCite = vi.fn(() => true);
    const onSideAsk = vi.fn(() => true);
    const mac = isMacPlatform(navigator.platform);

    await using _screen = await render(
      <SelectionToolbarHarness locale="zh" onCite={onCite} onSideAsk={onSideAsk} />,
    );

    await selectMessageSubstring(0, 12);

    const toolbar = page.getByTestId("assistant-selection-toolbar");
    await expect.element(toolbar).toBeVisible();
    await expect.element(toolbar).toHaveAttribute("role", "toolbar");

    const citeButton = page.getByTestId("selection-action-cite");
    const sideAskButton = page.getByTestId("selection-action-side-ask");
    await expect.element(citeButton).toBeVisible();
    await expect.element(sideAskButton).toBeVisible();
    await expect.element(citeButton).toHaveTextContent(mac ? "引用⌘L" : "引用Ctrl+L");
    await expect.element(sideAskButton).toHaveTextContent(mac ? "旁路提问⌘E" : "旁路提问Ctrl+E");

    const divider = document.querySelector('[data-selection-toolbar-divider="true"]');
    expect(divider).not.toBeNull();

    await _screen.rerender(
      <SelectionToolbarHarness locale="en" onCite={onCite} onSideAsk={onSideAsk} />,
    );
    await expect.element(citeButton).toHaveTextContent(mac ? "Cite⌘L" : "CiteCtrl+L");
    await expect.element(sideAskButton).toHaveTextContent(mac ? "Side ask⌘E" : "Side askCtrl+E");
  });

  it("syncs injected custom keybinding labels, hides unbound badges, and dispatches via injected matcher", async () => {
    using _scope = acquireSelectionTestScope();
    const onCite = vi.fn(() => true);
    const onSideAsk = vi.fn(() => true);

    const customShortcuts: SelectionToolbarShortcutConfig = {
      citeLabel: "Alt+Q",
      sideAskLabel: null,
      matchEvent: (event, canSideAsk) => {
        if (event.altKey && event.key.toLowerCase() === "q") return "cite";
        if (canSideAsk && event.altKey && event.key.toLowerCase() === "b") return "side-ask";
        return null;
      },
    };

    await using _screen = await render(
      <SelectionToolbarHarness
        locale="zh"
        onCite={onCite}
        onSideAsk={onSideAsk}
        shortcuts={customShortcuts}
      />,
    );

    await selectMessageSubstring(0, 8);
    const citeButton = page.getByTestId("selection-action-cite");
    const sideAskButton = page.getByTestId("selection-action-side-ask");
    await expect.element(citeButton).toHaveTextContent("引用Alt+Q");
    await expect.element(sideAskButton).toHaveTextContent("旁路提问");
    expect(
      document
        .querySelector('[data-testid="selection-action-side-ask"]')
        ?.querySelector('[data-selection-shortcut="true"]'),
    ).toBeNull();

    // Old default Ctrl+L should NOT trigger when custom matcher overrides it
    const oldDefaultL = new KeyboardEvent("keydown", primaryModKeyEventInit("l"));
    await act(() => {
      document.dispatchEvent(oldDefaultL);
    });
    expect(oldDefaultL.defaultPrevented).toBe(false);
    expect(onCite).not.toHaveBeenCalled();

    // Custom Alt+B triggers side-ask cleanly
    const customSideAsk = new KeyboardEvent("keydown", {
      key: "b",
      code: "KeyB",
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(() => {
      document.dispatchEvent(customSideAsk);
    });
    expect(customSideAsk.defaultPrevented).toBe(true);
    expect(onSideAsk).toHaveBeenCalledTimes(1);
    await expect.element(page.getByTestId("assistant-selection-toolbar")).not.toBeInTheDocument();
  });

  it("wires live resolved keybindings end-to-end across default, rebind, and unbind transitions", async () => {
    using _scope = acquireSelectionTestScope();
    const onCite = vi.fn(() => true);
    const onSideAsk = vi.fn(() => true);
    const mac = isMacPlatform(navigator.platform);

    // 1. Default resolved keybindings render Ctrl/⌘+L & Ctrl/⌘+E and dispatch normally.
    await using screen = await render(
      <SelectionToolbarHarness
        locale="zh"
        onCite={onCite}
        onSideAsk={onSideAsk}
        shortcuts={createSelectionToolbarShortcutConfig(DEFAULT_RESOLVED_KEYBINDINGS)}
      />,
    );

    await selectMessageSubstring(0, 8);
    await expect
      .element(page.getByTestId("selection-action-cite"))
      .toHaveTextContent(mac ? "引用⌘L" : "引用Ctrl+L");
    await expect
      .element(page.getByTestId("selection-action-side-ask"))
      .toHaveTextContent(mac ? "旁路提问⌘E" : "旁路提问Ctrl+E");

    // 2. Rebind both commands -> badges and keyboard matching update immediately.
    const reboundKeybindings = mergeWithDefaultKeybindings(
      compileResolvedKeybindingsConfig([
        { key: "alt+q", command: "chat.citeSelection", when: "!terminalFocus && !previewFocus" },
        {
          key: "alt+w",
          command: "chat.sideAskSelection",
          when: "!terminalFocus && !previewFocus",
        },
      ]),
    );
    await screen.rerender(
      <SelectionToolbarHarness
        locale="zh"
        onCite={onCite}
        onSideAsk={onSideAsk}
        shortcuts={createSelectionToolbarShortcutConfig(reboundKeybindings)}
      />,
    );

    await expect
      .element(page.getByTestId("selection-action-cite"))
      .toHaveTextContent(mac ? "引用⌥Q" : "引用Alt+Q");
    await expect
      .element(page.getByTestId("selection-action-side-ask"))
      .toHaveTextContent(mac ? "旁路提问⌥W" : "旁路提问Alt+W");

    const staleDefault = new KeyboardEvent("keydown", primaryModKeyEventInit("l"));
    await act(() => {
      document.dispatchEvent(staleDefault);
    });
    expect(staleDefault.defaultPrevented).toBe(false);
    expect(onCite).not.toHaveBeenCalled();

    const reboundCite = new KeyboardEvent("keydown", {
      key: "q",
      code: "KeyQ",
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(() => {
      document.dispatchEvent(reboundCite);
    });
    expect(reboundCite.defaultPrevented).toBe(true);
    expect(onCite).toHaveBeenCalledTimes(1);

    // 3. Unbind both commands -> badges hide cleanly with zero hardcoded fallback and keys do not trigger.
    const unboundKeybindings = mergeWithDefaultKeybindings(
      compileResolvedKeybindingsConfig([
        { key: "mod+l", command: "chat.citeSelection", when: "false" },
        { key: "mod+e", command: "chat.sideAskSelection", when: "false" },
      ]),
    );
    await screen.rerender(
      <SelectionToolbarHarness
        locale="zh"
        onCite={onCite}
        onSideAsk={onSideAsk}
        shortcuts={createSelectionToolbarShortcutConfig(unboundKeybindings)}
      />,
    );

    await selectMessageSubstring(0, 8);
    await expect.element(page.getByTestId("selection-action-cite")).toHaveTextContent("引用");
    await expect
      .element(page.getByTestId("selection-action-side-ask"))
      .toHaveTextContent("旁路提问");
    expect(document.querySelectorAll('[data-selection-shortcut="true"]')).toHaveLength(0);

    const unboundE = new KeyboardEvent("keydown", primaryModKeyEventInit("e"));
    await act(() => {
      document.dispatchEvent(unboundE);
    });
    expect(unboundE.defaultPrevented).toBe(false);
    expect(onSideAsk).not.toHaveBeenCalled();
  });

  it("cites on button click and Ctrl/Cmd+L, clearing selection and dismissing toolbar without hijacking idle shortcuts", async () => {
    using _scope = acquireSelectionTestScope();
    const cited: AssistantCitation[] = [];
    const onCite = vi.fn((citation: AssistantCitation) => {
      cited.push(citation);
      return true;
    });
    const onSideAsk = vi.fn(() => true);

    await using _screen = await render(
      <SelectionToolbarHarness locale="zh" onCite={onCite} onSideAsk={onSideAsk} />,
    );

    // Idle state (no selection): Ctrl+L / Ctrl+E MUST NOT be prevented
    const idleL = new KeyboardEvent("keydown", primaryModKeyEventInit("l"));
    document.dispatchEvent(idleL);
    expect(idleL.defaultPrevented).toBe(false);
    const idleE = new KeyboardEvent("keydown", primaryModKeyEventInit("e"));
    document.dispatchEvent(idleE);
    expect(idleE.defaultPrevented).toBe(false);

    // Click Cite
    await selectMessageSubstring(4, 10);
    await expect.element(page.getByTestId("assistant-selection-toolbar")).toBeVisible();
    await userEvent.click(
      document.querySelector<HTMLButtonElement>('[data-testid="selection-action-cite"]')!,
    );
    expect(onCite).toHaveBeenCalledTimes(1);
    expect(cited[0]?.text).toBe("用于验证引用");
    expect(window.getSelection()?.toString() ?? "").toBe("");
    await expect.element(page.getByTestId("assistant-selection-toolbar")).not.toBeInTheDocument();

    // Shortcut Ctrl/Cmd+L
    await selectMessageSubstring(11, 15);
    await expect.element(page.getByTestId("assistant-selection-toolbar")).toBeVisible();
    const shortcutL = new KeyboardEvent("keydown", primaryModKeyEventInit("l"));
    await act(() => {
      document.dispatchEvent(shortcutL);
    });
    expect(shortcutL.defaultPrevented).toBe(true);
    expect(onCite).toHaveBeenCalledTimes(2);
    expect(cited[1]?.text).toBe("旁路提问");
    expect(window.getSelection()?.toString() ?? "").toBe("");
    await expect.element(page.getByTestId("assistant-selection-toolbar")).not.toBeInTheDocument();
  });

  it("triggers side ask on click & Ctrl/Cmd+E, attaches citation to SideChatEmptySurface, and submits with serialized citation", async () => {
    using _scope = acquireSelectionTestScope();
    const quickAskCalls: Array<{ question: string; titleSeed?: string | undefined }> = [];

    function IntegratedSideAskHarness() {
      const [sideOpen, setSideOpen] = useState(false);
      return (
        <div className="flex gap-4">
          <SelectionToolbarHarness
            locale="zh"
            onCite={() => true}
            onSideAsk={(citation) => {
              enqueueSideAskCitation(mainThreadRef, citation);
              setSideOpen(true);
              return true;
            }}
          />
          {sideOpen ? (
            <div style={{ width: 380, height: 420 }}>
              <SideChatEmptySurface
                canStart
                isServerThread
                disabledReason={null}
                threadRef={mainThreadRef}
                onQuickAsk={(question, options) => {
                  quickAskCalls.push({ question, titleSeed: options?.titleSeed });
                  return true;
                }}
              />
            </div>
          ) : null}
        </div>
      );
    }

    await using _screen = await render(<IntegratedSideAskHarness />);

    // Trigger via Ctrl/Cmd+E shortcut
    await selectMessageSubstring(11, 19);
    await expect.element(page.getByTestId("assistant-selection-toolbar")).toBeVisible();
    const shortcutE = new KeyboardEvent("keydown", primaryModKeyEventInit("e"));
    await act(() => {
      document.dispatchEvent(shortcutE);
    });
    expect(shortcutE.defaultPrevented).toBe(true);
    await expect.element(page.getByTestId("assistant-selection-toolbar")).not.toBeInTheDocument();

    // SideChatEmptySurface opens with the selected citation attached and textarea focused
    await expect.element(page.getByTestId("right-panel-side-chat-empty-state")).toBeVisible();
    const attachedChip = document.querySelector('[data-btw-attached-citation="1"]');
    expect(attachedChip).not.toBeNull();
    expect(attachedChip?.textContent).toContain("旁路提问悬浮胶囊");

    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-btw-empty-composer="1"] textarea',
    )!;
    await expect.element(textarea).toHaveFocus();
    await userEvent.type(textarea, "这个胶囊在液态玻璃下怎么适配？{Enter}");

    expect(quickAskCalls).toHaveLength(1);
    expect(quickAskCalls[0]?.question).toContain("prismux-citation://v1/");
    expect(quickAskCalls[0]?.question).toContain("这个胶囊在液态玻璃下怎么适配？");
    expect(quickAskCalls[0]?.titleSeed).toBe("这个胶囊在液态玻璃下怎么适配？");
    expect(document.querySelector('[data-btw-attached-citation="1"]')).toBeNull();
  });

  it("supports draft-mode staging and direct delivery to an active side-thread composer", async () => {
    using _scope = acquireSelectionTestScope();
    const delivered: AssistantCitation[] = [];
    const focused = vi.fn();
    const unregister = registerSideThreadComposerBridge(sideThreadRef, {
      insertCitation: (citation) => {
        delivered.push(citation);
        return true;
      },
      focusAtEnd: focused,
    });

    try {
      await using screen = await render(
        <SelectionToolbarHarness
          locale="zh"
          onCite={() => true}
          onSideAsk={(citation) => deliverCitationToSideThread(sideThreadRef, citation)}
        />,
      );

      await selectMessageSubstring(0, 8);
      await expect.element(page.getByTestId("selection-action-side-ask")).toBeVisible();
      await userEvent.click(
        document.querySelector<HTMLButtonElement>('[data-testid="selection-action-side-ask"]')!,
      );
      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.text).toBe("这是一个用于验证");
      expect(focused).toHaveBeenCalledTimes(1);
      await screen.unmount();
    } finally {
      unregister();
    }

    // Draft-thread staging flow in SideChatEmptySurface
    const draftCitation: AssistantCitation = {
      version: 1,
      environmentId: envId,
      threadId: mainThreadId,
      messageId: MessageId.make("msg-draft-1"),
      text: "草稿主线程中的选中片段",
      start: 0,
      end: 11,
      prefix: "",
      suffix: "",
    };
    enqueueSideAskCitation(mainThreadRef, draftCitation);

    await using _draftScreen = await render(
      <SideChatEmptySurface
        canStart={false}
        isServerThread={false}
        disabledReason="发送第一条消息后即可开启完整旁路提问。"
        threadRef={mainThreadRef}
      />,
    );

    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-btw-empty-composer="1"] textarea',
    )!;
    await userEvent.type(textarea, "后续再深入追问这里{Enter}");

    const persisted = loadPersistedSideQuestions(envId, mainThreadId);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.title).toBe("后续再深入追问这里");
    expect(persisted[0]?.question).toContain(serializeAssistantCitation(draftCitation));
    expect(persisted[0]?.question).toContain("后续再深入追问这里");
  });

  it("hides side-ask button inside side-chat pane and when canSideAsk is false", async () => {
    using _scope = acquireSelectionTestScope();
    const onCite = vi.fn(() => true);
    const onSideAsk = vi.fn(() => true);

    await using screen = await render(
      <SelectionToolbarHarness
        locale="zh"
        onCite={onCite}
        onSideAsk={onSideAsk}
        insideSideChatPane
      />,
    );

    await selectMessageSubstring(0, 8);
    await expect.element(page.getByTestId("selection-action-cite")).toBeVisible();
    await expect.element(page.getByTestId("selection-action-side-ask")).not.toBeInTheDocument();
    expect(document.querySelector('[data-selection-toolbar-divider="true"]')).toBeNull();

    // Ctrl+E must not fire side-ask when hidden inside side chat pane
    const shortcutE = new KeyboardEvent("keydown", primaryModKeyEventInit("e"));
    await act(() => {
      document.dispatchEvent(shortcutE);
    });
    expect(onSideAsk).not.toHaveBeenCalled();

    await screen.rerender(
      <SelectionToolbarHarness
        locale="zh"
        onCite={onCite}
        onSideAsk={onSideAsk}
        canSideAsk={false}
      />,
    );
    await selectMessageSubstring(0, 8);
    await expect.element(page.getByTestId("selection-action-cite")).toBeVisible();
    await expect.element(page.getByTestId("selection-action-side-ask")).not.toBeInTheDocument();
  });

  it("disables actions and shows clear warning when selection exceeds max citation length", async () => {
    using _scope = acquireSelectionTestScope();
    const longText = "a".repeat(ASSISTANT_CITATION_MAX_TEXT_LENGTH + 25);
    const onCite = vi.fn(() => true);
    const onSideAsk = vi.fn(() => true);

    await using _screen = await render(
      <SelectionToolbarHarness text={longText} locale="zh" onCite={onCite} onSideAsk={onSideAsk} />,
    );

    await selectMessageSubstring(0, ASSISTANT_CITATION_MAX_TEXT_LENGTH + 10);
    const toolbar = page.getByTestId("assistant-selection-toolbar");
    await expect.element(toolbar).toBeVisible();
    await expect.element(toolbar).toHaveTextContent("选区过长，请缩短");

    const disabledBtn = document.querySelector<HTMLButtonElement>(
      '[data-selection-too-long="true"]',
    )!;
    expect(disabledBtn).not.toBeNull();
    expect(disabledBtn.disabled).toBe(true);

    const shortcutE = new KeyboardEvent("keydown", primaryModKeyEventInit("e"));
    await act(() => {
      document.dispatchEvent(shortcutE);
    });
    expect(onSideAsk).not.toHaveBeenCalled();
    expect(onCite).not.toHaveBeenCalled();
  });

  it("supports keyboard navigation (Tab, ArrowRight, ArrowLeft, Escape) and stands down in background threads", async () => {
    using _scope = acquireSelectionTestScope();
    const onCite = vi.fn(() => true);
    const onSideAsk = vi.fn(() => true);

    await using screen = await render(
      <SelectionToolbarHarness locale="zh" onCite={onCite} onSideAsk={onSideAsk} />,
    );

    await selectMessageSubstring(0, 10);
    await expect.element(page.getByTestId("assistant-selection-toolbar")).toBeVisible();

    await act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
    });
    const citeBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="selection-action-cite"]',
    )!;
    const sideAskBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="selection-action-side-ask"]',
    )!;
    expect(document.activeElement).toBe(citeBtn);

    await act(() => {
      citeBtn.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement).toBe(sideAskBtn);

    await act(() => {
      sideAskBtn.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement).toBe(citeBtn);

    await act(() => {
      citeBtn.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    await expect.element(page.getByTestId("assistant-selection-toolbar")).not.toBeInTheDocument();

    // Background thread must not capture global Ctrl+L / Ctrl+E
    await screen.rerender(
      <SelectionToolbarHarness
        locale="zh"
        onCite={onCite}
        onSideAsk={onSideAsk}
        backgroundThread
      />,
    );
    await selectMessageSubstring(0, 10);
    await expect.element(page.getByTestId("assistant-selection-toolbar")).toBeVisible();
    const bgE = new KeyboardEvent("keydown", primaryModKeyEventInit("e"));
    await act(() => {
      document.dispatchEvent(bgE);
    });
    expect(bgE.defaultPrevented).toBe(false);
    expect(onSideAsk).not.toHaveBeenCalled();
  });

  it("maintains WCAG >= 4.5:1 contrast for both labels and shortcuts across Light, Dark, Light-Glass, and Dark-Glass modes", async () => {
    using _scope = acquireSelectionTestScope();
    const scenarios: ReadonlyArray<{
      readonly name: string;
      readonly dark: boolean;
      readonly glass: boolean;
      readonly backdrop: Rgba;
      readonly rootOverrides?: Readonly<Record<string, string>>;
    }> = [
      {
        name: "light",
        dark: false,
        glass: false,
        backdrop: { r: 244, g: 245, b: 247, a: 1 },
      },
      {
        name: "dark",
        dark: true,
        glass: false,
        backdrop: { r: 18, g: 19, b: 22, a: 1 },
      },
      {
        name: "dark-glass",
        dark: true,
        glass: true,
        backdrop: { r: 15, g: 41, b: 66, a: 1 },
        rootOverrides: {
          "--popover": "rgba(18, 24, 38, 0.86)",
          "--popover-foreground": "rgba(255, 255, 255, 0.96)",
          "--contrast-popover-foreground": "rgba(255, 255, 255, 0.96)",
          "--pmx-glass-zone-overlays-bg": "rgba(18, 24, 38, 0.86)",
          "--pmx-accent": "#38bdf8",
          "--pmx-accent-text": "#7dd3fc",
          "--pmx-accent-soft": "rgba(56, 189, 248, 0.18)",
        },
      },
      {
        name: "light-glass",
        dark: false,
        glass: true,
        backdrop: { r: 224, g: 236, b: 250, a: 1 },
        rootOverrides: {
          "--popover": "rgba(248, 250, 255, 0.88)",
          "--popover-foreground": "rgba(15, 23, 42, 0.95)",
          "--contrast-popover-foreground": "rgba(15, 23, 42, 0.95)",
          "--pmx-glass-zone-overlays-bg": "rgba(248, 250, 255, 0.88)",
          "--pmx-accent": "#2563eb",
          "--pmx-accent-text": "#1d4ed8",
          "--pmx-accent-soft": "rgba(37, 99, 235, 0.12)",
        },
      },
    ];

    const root = document.documentElement;
    const prevDark = root.classList.contains("dark");
    const prevGlass = root.getAttribute("data-pmx-glass");

    try {
      for (const scenario of scenarios) {
        root.classList.toggle("dark", scenario.dark);
        root.setAttribute("data-pmx-glass", scenario.glass ? "1" : "0");
        const prevProps = new Map<string, string>();
        for (const [key, value] of Object.entries(scenario.rootOverrides ?? {})) {
          prevProps.set(key, root.style.getPropertyValue(key));
          root.style.setProperty(key, value);
        }

        try {
          await using screen = await render(
            <SelectionToolbarHarness locale="zh" onCite={() => true} onSideAsk={() => true} />,
          );
          await selectMessageSubstring(0, 12);
          await expect.element(page.getByTestId("assistant-selection-toolbar")).toBeVisible();

          const toolbarEl = document.querySelector<HTMLElement>(
            '[data-testid="assistant-selection-toolbar"]',
          )!;
          const toolbarStyle = getComputedStyle(toolbarEl);
          expect(Number.parseFloat(toolbarStyle.borderRadius)).toBeGreaterThanOrEqual(999);
          if (scenario.glass) {
            expect(toolbarStyle.backdropFilter).toContain("blur(");
          }

          const surfaceBg = compositeOver(
            parseColor(toolbarStyle.backgroundColor),
            scenario.backdrop,
          );

          for (const testId of ["selection-action-cite", "selection-action-side-ask"]) {
            const btn = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
            const btnFg = compositeOver(parseColor(getComputedStyle(btn).color), surfaceBg);
            const labelContrast = contrastRatio(btnFg, surfaceBg);
            expect(
              labelContrast,
              `${scenario.name} ${testId} label contrast (${labelContrast.toFixed(2)}:1)`,
            ).toBeGreaterThanOrEqual(4.5);

            const kbd = btn.querySelector<HTMLElement>('[data-selection-shortcut="true"]')!;
            const kbdFg = compositeOver(parseColor(getComputedStyle(kbd).color), surfaceBg);
            const kbdContrast = contrastRatio(kbdFg, surfaceBg);
            expect(
              kbdContrast,
              `${scenario.name} ${testId} shortcut contrast (${kbdContrast.toFixed(2)}:1)`,
            ).toBeGreaterThanOrEqual(4.5);
          }

          await screen.unmount();
        } finally {
          for (const [key, prev] of prevProps) {
            if (prev) root.style.setProperty(key, prev);
            else root.style.removeProperty(key);
          }
        }
      }
    } finally {
      root.classList.toggle("dark", prevDark);
      if (prevGlass === null) root.removeAttribute("data-pmx-glass");
      else root.setAttribute("data-pmx-glass", prevGlass);
    }
  });
});
