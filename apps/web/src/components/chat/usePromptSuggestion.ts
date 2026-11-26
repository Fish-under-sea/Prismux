import type { EnvironmentId, OrchestrationV2Run, RunId } from "@prismux/core-contracts";
import { useSyncExternalStore } from "react";

import type { Thread } from "../../types";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useServerConfigs } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { announcedRun } from "@prismux/client-runtime/state/thread-activity-announcement";

export const MAX_DISMISSED_PROMPT_SUGGESTION_KEYS = 200;

// Dismissed suggestions, keyed by environment and run, shared by every mounted composer and kept
// across remounts (bounded LRU). Run ids derive from thread ids, which can repeat across environments.
let dismissedKeys: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const subscribeDismissed = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const readDismissed = () => dismissedKeys;
const dismissKey = (environmentId: EnvironmentId, runId: RunId) => `${environmentId}\u0000${runId}`;

export function dismissPromptSuggestionKey(environmentId: EnvironmentId, runId: RunId): void {
  const key = dismissKey(environmentId, runId);
  const next = new Set(dismissedKeys);
  next.delete(key);
  next.add(key);
  while (next.size > MAX_DISMISSED_PROMPT_SUGGESTION_KEYS) {
    const oldestKey = next.values().next().value;
    if (oldestKey === undefined) break;
    next.delete(oldestKey);
  }
  dismissedKeys = next;
  for (const listener of listeners) listener();
}

export const __promptSuggestionTesting = {
  getDismissedKeyCount: () => dismissedKeys.size,
  hasDismissedKey: (environmentId: EnvironmentId, runId: RunId) =>
    dismissedKeys.has(dismissKey(environmentId, runId)),
  resetDismissedKeysForTests: () => {
    dismissedKeys = new Set();
  },
};

/**
 * The suggestion while the run that produced it is the thread's latest completed run. A message
 * promoted to Steer leaves its queued run cancelled before it started, still the latest run, so
 * the comparison skips to the last run that ran. Detail can lag the shell, so it skips only once
 * the runs include that cancelled run.
 */
export function offeredPromptSuggestion<Suggestion extends { readonly runId: RunId }>(
  suggestion: Suggestion | null | undefined,
  latestRun: Thread["latestRun"] | undefined,
  runs: ReadonlyArray<OrchestrationV2Run>,
): Suggestion | null {
  const run = announcedRun(latestRun ?? null, runs);
  const skippedUnseenRun =
    latestRun != null &&
    run?.runId !== latestRun.runId &&
    !runs.some(
      (candidate) =>
        candidate.id === latestRun.runId &&
        candidate.status === "cancelled" &&
        candidate.startedAt === null,
    );
  return suggestion &&
    !skippedUnseenRun &&
    run?.runId === suggestion.runId &&
    run.status === "completed"
    ? suggestion
    : null;
}

/**
 * The suggestion to insert when Tab or the hint accepts it. The hint unmounts a render after
 * typing starts, so a late accept must not prepend the suggestion to a draft that has text.
 */
export function promptSuggestionToAccept(suggestion: string | null, draft: string): string | null {
  return draft.length === 0 ? suggestion : null;
}

/**
 * The provider's predicted next prompt, while the run that produced it is the thread's latest
 * completed run and Escape has not dismissed it.
 */
export function usePromptSuggestion(
  environmentId: EnvironmentId,
  thread: Thread | undefined,
  runs: ReadonlyArray<OrchestrationV2Run>,
): { readonly suggestion: string | null; readonly dismiss: () => void } {
  // Older servers decode the missing setting as false, so true also proves the method exists.
  const enabled = useServerConfigs().get(environmentId)?.settings.promptSuggestionsEnabled === true;
  // Suggestions target keyboard and mouse setups, so skip devices with no mouse or trackpad at all.
  const hasFinePointer = useMediaQuery("(any-pointer: fine)");
  const { data } = useEnvironmentQuery(
    // A local draft has no run, and so no suggestion, until its first send.
    enabled && hasFinePointer && thread?.latestRun
      ? orchestrationEnvironment.v2.promptSuggestion({
          environmentId,
          input: { threadId: thread.id },
        })
      : null,
  );
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed);
  const offered = offeredPromptSuggestion(data, thread?.latestRun, runs);
  return {
    suggestion:
      offered && !dismissed.has(dismissKey(environmentId, offered.runId)) ? offered.text : null,
    dismiss: () => {
      if (offered === null) return;
      dismissPromptSuggestionKey(environmentId, offered.runId);
    },
  };
}
