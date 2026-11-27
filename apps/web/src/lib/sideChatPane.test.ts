import { scopeThreadRef } from "@prismux/client-runtime/environment";
import {
  EnvironmentId,
  MessageId,
  ThreadId,
  type AssistantCitation,
} from "@prismux/core-contracts";
import {
  formatAssistantCitationHref,
  serializeAssistantCitation,
} from "@prismux/core-shared/assistantCitations";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { useComposerDraftStore } from "../composerDraftStore";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import { selectThreadRightPanelState } from "../rightPanelStore";
import {
  appendAssistantCitationToPrompt,
  clearPendingSideAskCitations,
  composeSideAskPromptWithCitations,
  consumePendingSideAskCitations,
  deliverCitationToSideThread,
  deriveSideAskTitleSeed,
  enqueueSideAskCitation,
  extractSideAskTitleFromPrompt,
  getPendingSideAskCitations,
  getPendingSideAskSnapshot,
  openSideThread,
  registerSideThreadComposerBridge,
  removePendingSideAskCitation,
  resolveThreadOpenRoute,
  subscribePendingSideAskCitations,
} from "./sideChatPane";

const environmentId = EnvironmentId.make("environment:test");
const mainRef = scopeThreadRef(environmentId, ThreadId.make("main"));
const sideChatRef = scopeThreadRef(environmentId, ThreadId.make("side-chat"));

it("routes a side chat to its parent with the side chat tab active", () => {
  useRightPanelStore.setState(useRightPanelStore.getInitialState());
  const route = resolveThreadOpenRoute(sideChatRef, {
    lineage: { sideChat: true, parentThreadId: mainRef.threadId } as never,
  });

  expect(route).toEqual(mainRef);
  expect(
    selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, mainRef)?.id,
  ).toBe("thread:side-chat");
  expect(
    resolveThreadOpenRoute(mainRef, {
      lineage: { sideChat: false, parentThreadId: null } as never,
    }),
  ).toBe(mainRef);
});

it("opens a side thread beside the thread the click was in, or in its place", () => {
  useRightPanelStore.setState(useRightPanelStore.getInitialState());
  const navigated: unknown[] = [];
  const open = (
    input: Pick<Parameters<typeof openSideThread>[0], "threadRef" | "panelRef" | "intent">,
  ) => openSideThread({ ...input, navigate: (ref) => void navigated.push(ref) });
  const surfaces = () =>
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, mainRef).surfaces;

  expect(open({ threadRef: sideChatRef, panelRef: mainRef, intent: "primary" })).toBe("panel");
  expect(surfaces().map((surface) => surface.id)).toEqual(["thread:side-chat"]);
  expect(navigated).toEqual([]);

  expect(open({ threadRef: sideChatRef, panelRef: mainRef, intent: "alternate" })).toBe("main");
  expect(navigated).toEqual([sideChatRef]);

  // No panel shows a thread beside itself, of another environment, or where there is none.
  const elsewhere = scopeThreadRef(EnvironmentId.make("environment:other"), sideChatRef.threadId);
  expect(open({ threadRef: mainRef, panelRef: mainRef, intent: "panel" })).toBe("main");
  expect(open({ threadRef: elsewhere, panelRef: mainRef, intent: "panel" })).toBe("main");
  expect(open({ threadRef: sideChatRef, panelRef: null, intent: "panel" })).toBe("main");
  expect(navigated).toEqual([sideChatRef, mainRef, elsewhere, sideChatRef]);
  expect(surfaces()).toHaveLength(1);
});

it("supports multiple parallel BTW side-question tabs beside the same main thread", () => {
  useRightPanelStore.setState(useRightPanelStore.getInitialState());
  const btwOne = scopeThreadRef(environmentId, ThreadId.make("btw-1"));
  const btwTwo = scopeThreadRef(environmentId, ThreadId.make("btw-2"));

  expect(
    resolveThreadOpenRoute(btwOne, {
      lineage: { sideChat: true, parentThreadId: mainRef.threadId } as never,
    }),
  ).toEqual(mainRef);
  expect(
    resolveThreadOpenRoute(btwTwo, {
      lineage: { sideChat: true, parentThreadId: mainRef.threadId } as never,
    }),
  ).toEqual(mainRef);

  const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, mainRef);
  expect(state.surfaces.map((surface) => surface.id)).toEqual(["thread:btw-1", "thread:btw-2"]);
  expect(
    selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, mainRef)?.id,
  ).toBe("thread:btw-2");
});

function makeTestCitation(text: string, suffix = "1"): AssistantCitation {
  return {
    version: 1,
    environmentId,
    threadId: mainRef.threadId,
    messageId: MessageId.make(`msg-${suffix}`),
    text,
    start: 0,
    end: text.length,
    prefix: "",
    suffix: "",
  };
}

afterEach(() => {
  clearPendingSideAskCitations(mainRef);
  useComposerDraftStore.setState(useComposerDraftStore.getInitialState());
});

it("appends AssistantCitation cleanly with leading boundary and derives readable BTW titles", () => {
  const citation = makeTestCitation("这里为什么要用 WAL 日志模式");
  const serialized = serializeAssistantCitation(citation);

  expect(appendAssistantCitationToPrompt("", citation)).toBe(`${serialized} `);
  expect(appendAssistantCitationToPrompt("请解释", citation)).toBe(`请解释 ${serialized} `);
  expect(appendAssistantCitationToPrompt("请解释 ", citation)).toBe(`请解释 ${serialized} `);

  const composed = composeSideAskPromptWithCitations([citation], "并发读会阻塞吗？");
  expect(composed).toBe(`${serialized} 并发读会阻塞吗？`);
  expect(deriveSideAskTitleSeed([citation], "并发读会阻塞吗？")).toBe("并发读会阻塞吗？");
  expect(deriveSideAskTitleSeed([citation], "")).toBe("这里为什么要用 WAL 日志模式");

  // Extracting title from a composed prompt never leaks raw [Assistant quote](prismux-citation://...)
  expect(extractSideAskTitleFromPrompt(composed)).toBe("并发读会阻塞吗？");
  expect(extractSideAskTitleFromPrompt(serialized)).toBe("这里为什么要用 WAL 日志模式");
});

it("manages pending side-ask citations with dedup, subscribe, remove, and consume", () => {
  const first = makeTestCitation("第一段关键结论", "a");
  const second = makeTestCitation("第二段补充细节", "b");
  const listener = vi.fn();
  const unsubscribe = subscribePendingSideAskCitations(mainRef, listener);

  try {
    enqueueSideAskCitation(mainRef, first);
    expect(getPendingSideAskCitations(mainRef)).toEqual([first]);
    const rev1 = getPendingSideAskSnapshot(mainRef).revision;
    expect(rev1).toBeGreaterThan(0);

    // Re-enqueuing the same citation bumps revision (for refocus) without duplicating the chip
    enqueueSideAskCitation(mainRef, first);
    expect(getPendingSideAskCitations(mainRef)).toHaveLength(1);
    expect(getPendingSideAskSnapshot(mainRef).revision).toBe(rev1 + 1);

    enqueueSideAskCitation(mainRef, second);
    expect(getPendingSideAskCitations(mainRef)).toEqual([first, second]);
    expect(listener).toHaveBeenCalledTimes(3);

    removePendingSideAskCitation(mainRef, formatAssistantCitationHref(first));
    expect(getPendingSideAskCitations(mainRef)).toEqual([second]);

    const consumed = consumePendingSideAskCitations(mainRef);
    expect(consumed).toEqual([second]);
    expect(getPendingSideAskCitations(mainRef)).toEqual([]);
  } finally {
    unsubscribe();
  }
});

it("delivers citations directly to a mounted side-thread composer or falls back to draft + deferred focus", () => {
  const citation = makeTestCitation("选中的旁路追问片段");
  const serialized = serializeAssistantCitation(citation);

  // Case 1: side thread composer is not mounted yet -> writes into draft & defers focus until mount
  const deliveredDirectly = deliverCitationToSideThread(sideChatRef, citation);
  expect(deliveredDirectly).toBe(true);
  expect(useComposerDraftStore.getState().getComposerDraft(sideChatRef)?.prompt).toBe(
    `${serialized} `,
  );

  const focusAtEnd = vi.fn();
  const insertCitation = vi.fn(() => true);
  const unregister = registerSideThreadComposerBridge(sideChatRef, {
    insertCitation,
    focusAtEnd,
  });

  try {
    // Case 2: once mounted, live delivery invokes insertCitation + focusAtEnd immediately
    const second = makeTestCitation("第二条即时插入引用", "2");
    expect(deliverCitationToSideThread(sideChatRef, second)).toBe(true);
    expect(insertCitation).toHaveBeenCalledWith(second);
    expect(focusAtEnd).toHaveBeenCalled();
  } finally {
    unregister();
  }
});
