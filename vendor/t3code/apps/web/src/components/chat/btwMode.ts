import type {
  ComposerContextId,
  OrchestrationMessageContext,
  RuntimeMode,
  UnknownContextRecord,
} from "@t3tools/contracts";
import { BTW_GUARDRAIL_CONTEXT_KIND } from "@t3tools/shared/composerContextReferences";

export const BTW_READONLY_RUNTIME_MODE: RuntimeMode = "approval-required";

export const DEFAULT_BTW_THREAD_TITLE = "旁路提问";

export const BTW_READONLY_GUARDRAIL_CONTEXT_ID =
  "btw-guardrail_readonly" as ComposerContextId;

export const BTW_READONLY_SYSTEM_INSTRUCTION = [
  "You are answering a read-only Side Question (/btw) running in parallel beside the user's main conversation.",
  "- Use the inherited main-conversation context to answer the user's side question accurately.",
  "- You MAY read workspace files, search code, and run safe read-only inspection commands (such as `git status`, `git diff`, `git log`, or read-only search) when needed to verify facts.",
  "- You MUST NOT modify, create, or delete any workspace files, MUST NOT run write or destructive commands, and MUST NOT alter the main task's workspace state or redo the main thread's task.",
  "- Keep your answer concise, direct, and focused on the side question.",
].join("\n");

const LEGACY_PLACEHOLDER_SIDE_CHAT_TITLES = new Set([
  "side chat",
  "side question",
  "侧聊",
  "旁路提问",
]);

const SIDE_QUESTIONS_UPDATED_EVENT = "prismux:side-questions-updated";

export interface BtwSideThreadLike {
  readonly lineage?: {
    readonly sideChat?: boolean | undefined;
  } | null;
}

/**
 * Always returns `"approval-required"` for BTW side-question threads, regardless of
 * whether the parent main thread runs in `"full-access"`, `"auto"`, or `"auto-accept-edits"`.
 */
export function resolveBtwRuntimeMode(_parentRuntimeMode?: RuntimeMode): RuntimeMode {
  return BTW_READONLY_RUNTIME_MODE;
}

/** Returns true when a thread shell/projection represents a native BTW side-question thread. */
export function isBtwSideThread(thread: BtwSideThreadLike | null | undefined): boolean {
  return thread?.lineage?.sideChat === true;
}

/**
 * Detects legacy hardcoded placeholder titles (`"Side chat"`, `"Side question"`, empty) so the UI
 * can substitute the localized BTW title instead of showing raw `"Side chat"`.
 */
export function isLegacySideChatPlaceholderTitle(title: string | null | undefined): boolean {
  const trimmed = title?.trim() ?? "";
  if (!trimmed) return true;
  return LEGACY_PLACEHOLDER_SIDE_CHAT_TITLES.has(trimmed.toLowerCase());
}

/**
 * Derives a crisp, clean BTW thread title from the first question or title seed.
 * Never returns hardcoded `"Side chat"`; falls back to `DEFAULT_BTW_THREAD_TITLE` (`"旁路提问"`).
 */
export function deriveBtwThreadTitle(
  questionOrSeed: string | null | undefined,
  fallback = DEFAULT_BTW_THREAD_TITLE,
): string {
  const cleaned = (questionOrSeed ?? "")
    .trim()
    .replace(/^\/(?:btw|side)(?:\s+|$)/i, "")
    .split(/\r?\n/, 1)[0]
    ?.replace(/\s+/g, " ")
    .trim();

  if (!cleaned || isLegacySideChatPlaceholderTitle(cleaned)) {
    return fallback;
  }

  return cleaned.length > 44 ? `${cleaned.slice(0, 43)}…` : cleaned;
}

/**
 * Normalizes a thread's display title for BTW surfaces so historical `"Side chat"` threads
 * seamlessly present as `fallback` (`"旁路提问"` / `"Side question"`).
 */
export function normalizeBtwDisplayTitle(
  title: string | null | undefined,
  fallback = DEFAULT_BTW_THREAD_TITLE,
): string {
  const trimmed = title?.trim() ?? "";
  if (!trimmed || trimmed.toLowerCase() === "side chat") {
    return fallback;
  }
  return trimmed;
}

/**
 * Builds the invisible read-only BTW system guardrail record attached to `message.context.records`.
 * `message.text` stays 100% clean (raw user question only), while `projectComposerContextForProvider`
 * injects this guardrail into the provider prompt behind the scenes.
 */
export function buildBtwReadOnlyGuardrailRecord(options?: {
  readonly contextSummary?: string | null | undefined;
}): UnknownContextRecord {
  const trimmedSummary = options?.contextSummary?.trim();
  return {
    version: 1,
    kind: BTW_GUARDRAIL_CONTEXT_KIND,
    contextId: BTW_READONLY_GUARDRAIL_CONTEXT_ID,
    label: "BTW Read-Only Guardrail",
    payload: {
      mode: "read-only",
      instruction: BTW_READONLY_SYSTEM_INSTRUCTION,
      ...(trimmedSummary ? { contextSummary: trimmedSummary } : {}),
    },
  };
}

/**
 * Idempotently attaches the invisible BTW read-only guardrail record to an optional
 * `OrchestrationMessageContext` without mutating caller arrays or duplicating context IDs.
 */
export function attachBtwReadOnlyGuardrailContext(
  context: OrchestrationMessageContext | undefined,
  options?: { readonly contextSummary?: string | null | undefined },
): OrchestrationMessageContext {
  const guardrail = buildBtwReadOnlyGuardrailRecord(options);
  const existingRecords = (context?.records ?? []).filter(
    (record) => record.contextId !== BTW_READONLY_GUARDRAIL_CONTEXT_ID,
  );
  return {
    version: 1,
    ...(context?.guest ? { guest: context.guest } : {}),
    records: [...existingRecords, guardrail],
  };
}

/**
 * Returns true when `context` carries any user-visible context records (ignoring the invisible
 * `btw-guardrail` record). Used to preserve approval feedback checks inside BTW threads.
 */
export function hasUserVisibleMessageContext(
  context: OrchestrationMessageContext | undefined,
): boolean {
  if (!context) return false;
  return context.records.some(
    (record) =>
      record.kind !== BTW_GUARDRAIL_CONTEXT_KIND &&
      record.contextId !== BTW_READONLY_GUARDRAIL_CONTEXT_ID,
  );
}

/** Broadcasts that local persisted side questions changed for `(environmentId, threadId)`. */
export function notifySideQuestionsUpdated(environmentId: string, threadId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SIDE_QUESTIONS_UPDATED_EVENT, {
      detail: { environmentId, threadId },
    }),
  );
}

/** Subscribes to cross-surface side-question updates (Overview <-> Right Panel BTW empty surface). */
export function subscribeSideQuestionsUpdated(
  environmentId: string,
  threadId: string,
  onUpdate: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ environmentId?: string; threadId?: string }>).detail;
    if (detail?.environmentId === environmentId && detail?.threadId === threadId) {
      onUpdate();
    }
  };
  window.addEventListener(SIDE_QUESTIONS_UPDATED_EVENT, handler);
  return () => {
    window.removeEventListener(SIDE_QUESTIONS_UPDATED_EVENT, handler);
  };
}
