import { msg } from "gt-react";
import { thrownErrorMessage } from "@prismux/client-runtime/errors";
import { m } from "~/i18n/messages";
import type { ModelSelection, RuntimeMode, ScopedThreadRef } from "@prismux/core-contracts";
import { scopeThreadRef } from "@prismux/client-runtime/environment";
import type { StartThreadTurnInput } from "@prismux/client-runtime/operations";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@prismux/client-runtime/state/runtime";
import { useRef } from "react";

import { newMessageId, newThreadId } from "~/lib/utils";
import {
  extractSideAskTitleFromPrompt,
  requestSideThreadComposerFocus,
} from "../../lib/sideChatPane";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useRightPanelStore } from "../../rightPanelStore";
import { readThreadShell, waitForThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { attachBtwReadOnlyGuardrailContext, resolveBtwRuntimeMode } from "./btwMode";

export type SideChatMessage = Pick<
  StartThreadTurnInput["message"],
  "text" | "attachments" | "context"
> & { readonly titleSeed: string };

export interface SideChatOpenOptions {
  readonly initialPrompt?: string | undefined;
}

/**
 * Starts side chats from `threadRef`, or offers none when it is null. `open` forks the
 * thread's latest stable point, sends `message` there with `readSettings()`, the parent
 * composer's settings, and shows the tab. It resolves false when the side chat did not
 * start, or another one is still starting.
 */
export function useSideChat(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly readSettings: () => {
    readonly runtimeMode: RuntimeMode;
    readonly modelSelection: ModelSelection | undefined;
  };
  readonly onError: (message: string) => void;
}) {
  const pendingRef = useRef(false);
  const forkSideChat = useAtomCommand(threadEnvironment.forkSideChat, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const setThreadRuntimeMode = useOrchestrationCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const reportFailure = (
    failure: Extract<AtomCommandResult<unknown, unknown>, { readonly _tag: "Failure" }>,
    fallback: string,
  ) => {
    if (isAtomCommandInterrupted(failure)) return;
    const error = squashAtomCommandFailure(failure);
    input.onError(thrownErrorMessage(error, m) ?? fallback);
  };
  const start = async (
    threadRef: ScopedThreadRef,
    message: SideChatMessage | undefined,
    options?: SideChatOpenOptions,
  ) => {
    const { runtimeMode: parentRuntimeMode, modelSelection } = input.readSettings();
    // 1:1 AGY Native BTW: side questions are ALWAYS strictly read-only (`approval-required`),
    // never inheriting writable `full-access` from the main thread.
    const btwRuntimeMode = resolveBtwRuntimeMode(parentRuntimeMode);
    const initialTitle = extractSideAskTitleFromPrompt(
      message?.titleSeed || message?.text || options?.initialPrompt || "",
      m(msg("Side chat")),
    );
    const targetThreadId = newThreadId();
    const fork = await forkSideChat({
      environmentId: threadRef.environmentId,
      input: { sourceThreadId: threadRef.threadId, targetThreadId, title: initialTitle },
    });
    if (fork._tag === "Failure") {
      reportFailure(fork, m(msg("Could not start a side chat.")));
      return false;
    }
    // Drops the empty side chat a failed start leaves behind; one that got its message stays.
    const discard = () =>
      void deleteThread({
        environmentId: threadRef.environmentId,
        input: { threadId: targetThreadId, onlyIfUnused: true },
      });
    const targetRef = scopeThreadRef(threadRef.environmentId, targetThreadId);
    if (!(await waitForThreadShell(targetRef))) {
      input.onError(m(msg("The side chat was created, but it did not reach this client.")));
      discard();
      return false;
    }
    const sideChat = readThreadShell(targetRef);
    if (sideChat === null) {
      input.onError(m(msg("The side chat is no longer available.")));
      discard();
      return false;
    }
    if (btwRuntimeMode !== sideChat.runtimeMode) {
      const mode = await setThreadRuntimeMode({
        environmentId: threadRef.environmentId,
        input: {
          threadId: targetThreadId,
          runtimeMode: btwRuntimeMode,
          createdAt: new Date().toISOString(),
        },
      });
      if (mode._tag === "Failure") {
        reportFailure(mode, m(msg("Could not set the side chat's permission mode.")));
        discard();
        return false;
      }
    }
    // Send before showing the tab: closing a tab whose side chat has no run deletes it.
    if (message) {
      const { titleSeed, context, ...content } = message;
      const guardedContext = attachBtwReadOnlyGuardrailContext(context);
      const turn = await startThreadTurn({
        environmentId: threadRef.environmentId,
        input: {
          threadId: targetThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            ...content,
            context: guardedContext,
          },
          ...(modelSelection === undefined ? {} : { modelSelection }),
          titleSeed: extractSideAskTitleFromPrompt(titleSeed || content.text, initialTitle),
          runtimeMode: btwRuntimeMode,
          interactionMode: "default",
          createdAt: new Date().toISOString(),
        },
      });
      if (turn._tag === "Failure") {
        reportFailure(turn, m(msg("Could not send the side chat message.")));
        discard();
        return false;
      }
    } else {
      const draftStore = useComposerDraftStore.getState();
      draftStore.setRuntimeMode(targetRef, btwRuntimeMode);
      if (modelSelection !== undefined) {
        draftStore.setModelSelection(targetRef, modelSelection);
      }
      if (options?.initialPrompt) {
        draftStore.setPrompt(targetRef, options.initialPrompt);
      }
      requestSideThreadComposerFocus(targetRef);
    }
    useRightPanelStore.getState().openThread(threadRef, targetThreadId);
    return true;
  };
  const open = async (message?: SideChatMessage, options?: SideChatOpenOptions) => {
    const { threadRef } = input;
    if (!threadRef || pendingRef.current) return false;
    pendingRef.current = true;
    return start(threadRef, message, options).finally(() => {
      pendingRef.current = false;
    });
  };
  return { available: input.threadRef !== null, open: useStableCallback(open) };
}
