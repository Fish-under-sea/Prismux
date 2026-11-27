import { scopedThreadKey, scopeThreadRef } from "@prismux/client-runtime/environment";
import {
  resolveSideThreadOpenTarget,
  type SideThreadOpenIntent,
} from "@prismux/client-runtime/side-thread";
import type {
  AssistantCitation,
  OrchestrationV2ThreadShell,
  ScopedThreadRef,
  SideThreadOpenTarget,
} from "@prismux/core-contracts";
import {
  collectAssistantCitations,
  formatAssistantCitationHref,
  serializeAssistantCitation,
} from "@prismux/core-shared/assistantCitations";

import type { ToolCallDiffTarget } from "../diffPanelStore";
import type { LinkedThreadTarget } from "@prismux/client-runtime/linked-thread";
import type { useNavigate } from "@tanstack/react-router";

import { deriveBtwThreadTitle } from "../components/chat/btwMode";
import { formatAssistantCitationForComposer } from "../composer-logic";
import { useComposerDraftStore } from "../composerDraftStore";
import { getClientSettings } from "../hooks/useSettings";
import { linkedThreadRouteParams } from "../linkedThreadSurface";
import { rightPanelHostRef, useRightPanelStore } from "../rightPanelStore";

/** Whether an event started in the side chat pane (`data-side-chat-pane`), which the main chat ignores. */
export function isInSideChatPane(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-side-chat-pane]") !== null;
}

export interface PendingSideAskSnapshot {
  readonly citations: ReadonlyArray<AssistantCitation>;
  readonly revision: number;
}

export const EMPTY_PENDING_SIDE_ASK_SNAPSHOT: PendingSideAskSnapshot = Object.freeze({
  citations: Object.freeze([]),
  revision: 0,
});

export interface SideThreadComposerBridgeHandlers {
  readonly insertCitation: (citation: AssistantCitation) => boolean;
  readonly focusAtEnd: () => void;
}

const pendingSideAskByThreadKey = new Map<string, PendingSideAskSnapshot>();
const pendingSideAskListenersByThreadKey = new Map<string, Set<() => void>>();
const sideThreadComposerBridgeByKey = new Map<string, SideThreadComposerBridgeHandlers>();
const pendingSideThreadFocusKeys = new Set<string>();

function notifyPendingSideAskListeners(threadKey: string): void {
  const listeners = pendingSideAskListenersByThreadKey.get(threadKey);
  if (!listeners) return;
  for (const listener of listeners) {
    listener();
  }
}

/** Appends a serialized `AssistantCitation` cleanly to a composer draft prompt. */
export function appendAssistantCitationToPrompt(
  prompt: string,
  citation: AssistantCitation,
): string {
  const formatted = formatAssistantCitationForComposer(citation);
  if (prompt.length === 0) return formatted;
  const separator = /\s$/.test(prompt) ? "" : " ";
  return `${prompt}${separator}${formatted}`;
}

/** Combines attached citations and an optional user question into a single BTW prompt string. */
export function composeSideAskPromptWithCitations(
  citations: ReadonlyArray<AssistantCitation>,
  question: string,
): string {
  const trimmedQuestion = question.trim();
  if (citations.length === 0) return trimmedQuestion;
  if (trimmedQuestion.length === 0) {
    return citations.map((citation) => serializeAssistantCitation(citation)).join(" ");
  }
  const prefix = citations.map((citation) => formatAssistantCitationForComposer(citation)).join("");
  return `${prefix}${trimmedQuestion}`;
}

function stripAssistantCitationLinks(text: string): string {
  const matches = collectAssistantCitations(text);
  if (matches.length === 0) return text.trim();
  let cursor = 0;
  let remaining = "";
  for (const match of matches) {
    remaining += text.slice(cursor, match.start);
    cursor = match.end;
  }
  remaining += text.slice(cursor);
  return remaining.replace(/\s+/g, " ").trim();
}

/** Derives a human-readable BTW title from an optional user question and attached citations. */
export function deriveSideAskTitleSeed(
  citations: ReadonlyArray<AssistantCitation>,
  question: string,
  fallback?: string,
): string {
  const strippedQuestion = stripAssistantCitationLinks(question);
  if (strippedQuestion.length > 0) {
    return deriveBtwThreadTitle(strippedQuestion, fallback);
  }
  const firstCitation = citations[0];
  if (firstCitation) {
    return deriveBtwThreadTitle(firstCitation.comment?.trim() || firstCitation.text, fallback);
  }
  return deriveBtwThreadTitle(question, fallback);
}

/** Extracts a clean BTW title from a prompt that may contain inline serialized citation links. */
export function extractSideAskTitleFromPrompt(prompt: string, fallback?: string): string {
  const matches = collectAssistantCitations(prompt);
  if (matches.length === 0) {
    return deriveBtwThreadTitle(prompt, fallback);
  }
  const stripped = stripAssistantCitationLinks(prompt);
  if (stripped.length > 0) {
    return deriveBtwThreadTitle(stripped, fallback);
  }
  const firstCitation = matches[0]!.citation;
  return deriveBtwThreadTitle(firstCitation.comment?.trim() || firstCitation.text, fallback);
}

export function getPendingSideAskSnapshot(threadRef: ScopedThreadRef): PendingSideAskSnapshot {
  return (
    pendingSideAskByThreadKey.get(scopedThreadKey(threadRef)) ?? EMPTY_PENDING_SIDE_ASK_SNAPSHOT
  );
}

export function getPendingSideAskCitations(
  threadRef: ScopedThreadRef,
): ReadonlyArray<AssistantCitation> {
  return getPendingSideAskSnapshot(threadRef).citations;
}

export function enqueueSideAskCitation(
  threadRef: ScopedThreadRef,
  citation: AssistantCitation,
): void {
  const threadKey = scopedThreadKey(threadRef);
  const current = pendingSideAskByThreadKey.get(threadKey) ?? EMPTY_PENDING_SIDE_ASK_SNAPSHOT;
  const nextHref = formatAssistantCitationHref(citation);
  const exists = current.citations.some(
    (existing) => formatAssistantCitationHref(existing) === nextHref,
  );
  const nextCitations = exists ? current.citations : [...current.citations, citation];
  pendingSideAskByThreadKey.set(threadKey, {
    citations: nextCitations,
    revision: current.revision + 1,
  });
  notifyPendingSideAskListeners(threadKey);
}

export function removePendingSideAskCitation(
  threadRef: ScopedThreadRef,
  citationHref: string,
): void {
  const threadKey = scopedThreadKey(threadRef);
  const current = pendingSideAskByThreadKey.get(threadKey);
  if (!current) return;
  const nextCitations = current.citations.filter(
    (citation) => formatAssistantCitationHref(citation) !== citationHref,
  );
  if (nextCitations.length === current.citations.length) return;
  if (nextCitations.length === 0) {
    pendingSideAskByThreadKey.delete(threadKey);
  } else {
    pendingSideAskByThreadKey.set(threadKey, {
      citations: nextCitations,
      revision: current.revision,
    });
  }
  notifyPendingSideAskListeners(threadKey);
}

export function clearPendingSideAskCitations(threadRef: ScopedThreadRef): void {
  const threadKey = scopedThreadKey(threadRef);
  if (!pendingSideAskByThreadKey.delete(threadKey)) return;
  notifyPendingSideAskListeners(threadKey);
}

export function consumePendingSideAskCitations(
  threadRef: ScopedThreadRef,
): ReadonlyArray<AssistantCitation> {
  const threadKey = scopedThreadKey(threadRef);
  const current = pendingSideAskByThreadKey.get(threadKey);
  if (!current || current.citations.length === 0) return [];
  pendingSideAskByThreadKey.delete(threadKey);
  notifyPendingSideAskListeners(threadKey);
  return current.citations;
}

export function subscribePendingSideAskCitations(
  threadRef: ScopedThreadRef,
  listener: () => void,
): () => void {
  const threadKey = scopedThreadKey(threadRef);
  let listeners = pendingSideAskListenersByThreadKey.get(threadKey);
  if (!listeners) {
    listeners = new Set();
    pendingSideAskListenersByThreadKey.set(threadKey, listeners);
  }
  listeners.add(listener);
  return () => {
    const active = pendingSideAskListenersByThreadKey.get(threadKey);
    if (!active) return;
    active.delete(listener);
    if (active.size === 0) {
      pendingSideAskListenersByThreadKey.delete(threadKey);
    }
  };
}

export function requestSideThreadComposerFocus(sideThreadRef: ScopedThreadRef): void {
  const threadKey = scopedThreadKey(sideThreadRef);
  const bridge = sideThreadComposerBridgeByKey.get(threadKey);
  if (bridge) {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => bridge.focusAtEnd());
    } else {
      bridge.focusAtEnd();
    }
    return;
  }
  pendingSideThreadFocusKeys.add(threadKey);
}

export function registerSideThreadComposerBridge(
  sideThreadRef: ScopedThreadRef,
  handlers: SideThreadComposerBridgeHandlers,
): () => void {
  const threadKey = scopedThreadKey(sideThreadRef);
  sideThreadComposerBridgeByKey.set(threadKey, handlers);
  let focusFrame: number | null = null;
  if (pendingSideThreadFocusKeys.delete(threadKey)) {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      focusFrame = window.requestAnimationFrame(() => {
        focusFrame = null;
        handlers.focusAtEnd();
      });
    } else {
      handlers.focusAtEnd();
    }
  }
  return () => {
    if (focusFrame !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(focusFrame);
    }
    if (sideThreadComposerBridgeByKey.get(threadKey) === handlers) {
      sideThreadComposerBridgeByKey.delete(threadKey);
    }
  };
}

/**
 * Inserts an `AssistantCitation` into an existing BTW side thread's composer and focuses it.
 * Uses the mounted `SideThreadPane` bridge when live, or writes to `composerDraftStore` and
 * defers focus until the pane mounts.
 */
export function deliverCitationToSideThread(
  sideThreadRef: ScopedThreadRef,
  citation: AssistantCitation,
): boolean {
  const threadKey = scopedThreadKey(sideThreadRef);
  const bridge = sideThreadComposerBridgeByKey.get(threadKey);
  if (bridge && bridge.insertCitation(citation)) {
    bridge.focusAtEnd();
    return true;
  }
  const draftStore = useComposerDraftStore.getState();
  const currentPrompt = draftStore.getComposerDraft(sideThreadRef)?.prompt ?? "";
  draftStore.setPrompt(sideThreadRef, appendAssistantCitationToPrompt(currentPrompt, citation));
  requestSideThreadComposerFocus(sideThreadRef);
  return true;
}

/**
 * Opens an embedded side thread's tool diffs in its parent's diff panel and runs its shell commands
 * in the parent's terminal drawer, since the embedded view hides its own. Other panel actions reach
 * the parent through `hostRightPanel`; diff selection and the drawer are not panel state.
 */
export interface SideChatParentPanel {
  /** The thread whose panel shows the embedded one. */
  readonly hostRef: ScopedThreadRef;
  readonly openToolDiff: (target: ToolCallDiffTarget) => void;
  readonly runShellCommand: (command: string) => void;
  /** Starts a fresh parallel BTW side-question tab beside the current one. */
  readonly onNewSideChat?: (() => void) | undefined;
}

/**
 * Where opening `threadRef` should route. A side chat shows as a tab of its parent, so this opens
 * that tab and returns the parent; any other thread returns `threadRef`.
 */
export function resolveThreadOpenRoute(
  threadRef: ScopedThreadRef,
  thread: Pick<OrchestrationV2ThreadShell, "lineage"> | null,
): ScopedThreadRef {
  const parentThreadId = thread?.lineage.sideChat === true ? thread.lineage.parentThreadId : null;
  if (parentThreadId === null) return threadRef;
  const parentRef = scopeThreadRef(threadRef.environmentId, parentThreadId);
  useRightPanelStore.getState().openThread(parentRef, threadRef.threadId);
  return parentRef;
}

/**
 * Whether `panelRef`'s right panel can show `threadRef` as a tab: a thread of the same environment
 * that is not the one the panel belongs to.
 */
function canOpenThreadInPanel(
  threadRef: ScopedThreadRef,
  panelRef: ScopedThreadRef | null,
): panelRef is ScopedThreadRef {
  if (panelRef === null) return false;
  const host = rightPanelHostRef(panelRef);
  return host.environmentId === threadRef.environmentId && host.threadId !== threadRef.threadId;
}

/**
 * Opens a side chat or subagent where the click asked: as a tab beside `panelRef`, the thread the
 * click happened in, or on the main screen through `navigate`. Returns where it went.
 */
export function openSideThread(input: {
  readonly threadRef: ScopedThreadRef;
  readonly panelRef: ScopedThreadRef | null;
  readonly intent: SideThreadOpenIntent;
  readonly navigate: (threadRef: ScopedThreadRef) => void;
}): SideThreadOpenTarget {
  const { threadRef, panelRef } = input;
  const target = resolveSideThreadOpenTarget({
    preference: getClientSettings().sideThreadOpenTarget,
    intent: input.intent,
    panelAvailable: canOpenThreadInPanel(threadRef, panelRef),
  });
  if (target === "panel" && panelRef !== null) {
    useRightPanelStore.getState().openThread(panelRef, threadRef.threadId);
  } else {
    input.navigate(threadRef);
  }
  return target;
}

/**
 * Opens the read-only view of a linked environment's thread where the click asked: as a tab in
 * `panelRef`'s right panel, or on the main screen, which is also where it goes without a panel.
 */
export function openLinkedThreadRead(input: {
  readonly panelRef: ScopedThreadRef | null;
  readonly target: LinkedThreadTarget;
  readonly intent: SideThreadOpenIntent;
  readonly navigate: ReturnType<typeof useNavigate>;
}) {
  const { panelRef, target } = input;
  const place = resolveSideThreadOpenTarget({
    preference: getClientSettings().sideThreadOpenTarget,
    intent: input.intent,
    panelAvailable: panelRef !== null,
  });
  if (place === "panel" && panelRef !== null) {
    useRightPanelStore.getState().openLinkedThread(panelRef, target);
    return;
  }
  void input.navigate({
    to: "/linked/$viaEnvironmentId/$linkedEnvironmentId/$linkedThreadId",
    params: linkedThreadRouteParams(target),
  });
}
