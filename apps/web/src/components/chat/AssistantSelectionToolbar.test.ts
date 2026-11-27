import { scopeThreadRef } from "@prismux/client-runtime/environment";
import {
  EnvironmentId,
  MessageId,
  ThreadId,
  type AssistantCitation,
} from "@prismux/core-contracts";
import { serializeAssistantCitation } from "@prismux/core-shared/assistantCitations";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("gt-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("gt-react")>();
  return {
    ...actual,
    useGT: () => (text: string) => text,
    useLocale: () => "zh-CN",
  };
});

import { clearPendingSideAskCitations, enqueueSideAskCitation } from "../../lib/sideChatPane";
import {
  matchSelectionToolbarShortcut,
  resolveSelectionToolbarCopy,
  resolveSelectionToolbarShortcutConfig,
  resolveSelectionToolbarShortcuts,
  SELECTION_CITE_COMMAND,
  SELECTION_SIDE_ASK_COMMAND,
} from "./AssistantSelectionToolbar";
import { SideChatEmptySurface } from "./RightPanelEmptySurfaces";

const envId = EnvironmentId.make("env-1");
const threadRef = scopeThreadRef(envId, ThreadId.make("thread-main"));

function makeCitation(text: string): AssistantCitation {
  return {
    version: 1,
    environmentId: envId,
    threadId: threadRef.threadId,
    messageId: MessageId.make("msg-1"),
    text,
    start: 0,
    end: text.length,
    prefix: "",
    suffix: "",
  };
}

describe("AssistantSelectionToolbar helpers", () => {
  afterEach(() => {
    clearPendingSideAskCitations(threadRef);
  });

  it("resolves zh and en copy without requiring zh.json edits", () => {
    expect(resolveSelectionToolbarCopy("zh-CN")).toEqual({
      toolbarLabel: "选区操作",
      citeLabel: "引用",
      sideAskLabel: "旁路提问",
      shortenSelectionLabel: "选区过长，请缩短",
      citeAriaLabel: "引用选中文本到输入框",
      citeTooLongAriaLabel: "选区过长，无法引用",
      sideAskAriaLabel: "基于选中文本发起旁路提问",
      sideAskTooLongAriaLabel: "选区过长，无法发起旁路提问",
    });
    expect(resolveSelectionToolbarCopy("zh")).toMatchObject({
      citeLabel: "引用",
      sideAskLabel: "旁路提问",
      shortenSelectionLabel: "选区过长，请缩短",
    });
    expect(resolveSelectionToolbarCopy("en-US")).toMatchObject({
      citeLabel: "Cite",
      sideAskLabel: "Side ask",
      shortenSelectionLabel: "Shorten selection",
    });
    expect(resolveSelectionToolbarCopy(undefined)).toMatchObject({
      citeLabel: "Cite",
      sideAskLabel: "Side ask",
      shortenSelectionLabel: "Shorten selection",
    });
  });

  it("formats Windows/Linux and macOS shortcut hints accurately", () => {
    expect(resolveSelectionToolbarShortcuts("Win32")).toEqual({
      cite: "Ctrl+L",
      sideAsk: "Ctrl+E",
    });
    expect(resolveSelectionToolbarShortcuts("Linux x86_64")).toEqual({
      cite: "Ctrl+L",
      sideAsk: "Ctrl+E",
    });
    expect(resolveSelectionToolbarShortcuts("MacIntel")).toEqual({
      cite: "⌘L",
      sideAsk: "⌘E",
    });
    expect(resolveSelectionToolbarShortcuts("MacARM64")).toEqual({
      cite: "⌘L",
      sideAsk: "⌘E",
    });

    expect(SELECTION_CITE_COMMAND).toBe("chat.citeSelection");
    expect(SELECTION_SIDE_ASK_COMMAND).toBe("chat.sideAskSelection");

    const customMatcher = vi.fn(() => "side-ask" as const);
    const custom = resolveSelectionToolbarShortcutConfig("Win32", {
      citeLabel: "Alt+Q",
      sideAskLabel: null,
      matchEvent: customMatcher,
    });
    expect(custom.citeLabel).toBe("Alt+Q");
    expect(custom.sideAskLabel).toBeNull();
    expect(custom.matchEvent).toBe(customMatcher);
  });

  it("matches Ctrl/Cmd+L and Ctrl/Cmd+E cleanly and respects canSideAsk & modifier guards", () => {
    const baseEvent = {
      key: "l",
      code: "KeyL",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      isComposing: false,
      defaultPrevented: false,
    };

    expect(matchSelectionToolbarShortcut({ ...baseEvent, ctrlKey: true }, "Win32", true)).toBe(
      "cite",
    );
    expect(
      matchSelectionToolbarShortcut({ ...baseEvent, metaKey: true }, "Win32", true),
    ).toBeNull();
    expect(matchSelectionToolbarShortcut({ ...baseEvent, metaKey: true }, "MacIntel", true)).toBe(
      "cite",
    );
    expect(
      matchSelectionToolbarShortcut({ ...baseEvent, ctrlKey: true }, "MacIntel", true),
    ).toBeNull();

    const sideAskEvent = { ...baseEvent, key: "E", code: "KeyE" };
    expect(matchSelectionToolbarShortcut({ ...sideAskEvent, ctrlKey: true }, "Win32", true)).toBe(
      "side-ask",
    );
    expect(
      matchSelectionToolbarShortcut({ ...sideAskEvent, metaKey: true }, "MacIntel", true),
    ).toBe("side-ask");
    expect(
      matchSelectionToolbarShortcut({ ...sideAskEvent, ctrlKey: true }, "Win32", false),
    ).toBeNull();
    expect(
      matchSelectionToolbarShortcut(
        { ...sideAskEvent, ctrlKey: true, shiftKey: true },
        "Win32",
        true,
      ),
    ).toBeNull();
    expect(
      matchSelectionToolbarShortcut(
        { ...sideAskEvent, ctrlKey: true, altKey: true },
        "Win32",
        true,
      ),
    ).toBeNull();
    expect(
      matchSelectionToolbarShortcut(
        { ...sideAskEvent, ctrlKey: true, isComposing: true },
        "Win32",
        true,
      ),
    ).toBeNull();
    expect(
      matchSelectionToolbarShortcut(
        { ...sideAskEvent, ctrlKey: true, defaultPrevented: true },
        "Win32",
        true,
      ),
    ).toBeNull();
  });

  it("renders pre-attached selected citation inside SideChatEmptySurface", () => {
    const citation = makeCitation("采用单文件 SQLite WAL 模式并强制命名空间硬隔离");
    enqueueSideAskCitation(threadRef, citation);

    const html = renderToStaticMarkup(
      createElement(SideChatEmptySurface, {
        canStart: true,
        isServerThread: true,
        disabledReason: null,
        threadRef,
        onQuickAsk: () => true,
      }),
    );

    expect(html).toContain('data-btw-attached-citation="1"');
    expect(html).toContain("采用单文件 SQLite WAL 模式并强制命名空间硬隔离");
    expect(html).toContain('data-btw-remove-citation="1"');
    // Submit button should be enabled even before extra text is typed when a citation is attached
    expect(html).not.toContain('data-btw-empty-submit="1" disabled=""');
    expect(serializeAssistantCitation(citation)).toContain("prismux-citation://v1/");
  });
});
