import { scopeThreadRef } from "@prismux/client-runtime/environment";
import { sideThreadKindOf } from "@prismux/client-runtime/side-thread";
import { formatSubagentDisplayTitle } from "@prismux/client-runtime/state/subagent-display";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@prismux/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@prismux/core-contracts";
import { threadContextRecord } from "@prismux/core-shared/composerContextReferences";
import { T, useGT } from "gt-react";
import {
  MessageSquarePlusIcon,
  PlusIcon,
  QuoteIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { ComposerHandleContext } from "../../composerHandleContext";
import { useClientSettings } from "../../hooks/useSettings";
import { releaseComposerDraftUploads } from "../../lib/composerDraftUploads";
import type { SideChatParentPanel } from "../../lib/sideChatPane";
import { readLocalApi } from "../../localApi";
import { hostRightPanel, type ThreadSurface, useRightPanelStore } from "../../rightPanelStore";
import { useQuietThreadProjection, useQuietThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { useEnvironmentShellStatus } from "../../state/shell";
import { threadEnvironment, useEnvironmentThread } from "../../state/threads";
import {
  isThreadRouteSnapshotAuthoritative,
  resolveThreadRouteRenderState,
} from "../../threadRoutes";
import { useOpenThreadFamily } from "../ThreadRouteView";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BackgroundThreadContext } from "./backgroundThread";
import { normalizeBtwDisplayTitle } from "./btwMode";

export interface SideThreadBtwHeaderProps {
  readonly title: string;
  readonly canAddToChat: boolean;
  readonly canDelete: boolean;
  readonly onNewSideChat?: (() => void) | undefined;
  readonly onAddToChat: () => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}

/**
 * 1:1 AGY Native BTW Side Question header bar:
 * `MessageSquarePlus` icon, clean derived title, `BTW · 只读` badge with safety tooltip,
 * `+ 新建` parallel BTW launcher, `引用回主会话`, delete, and close actions.
 */
export function SideThreadBtwHeader(props: SideThreadBtwHeaderProps) {
  const gt = useGT();
  return (
    <div
      data-btw-header="1"
      className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border/80 bg-background/50 pr-1.5 pl-3 backdrop-blur-xs dark:border-white/10 dark:bg-white/[0.025]"
    >
      <MessageSquarePlusIcon
        aria-hidden="true"
        className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400"
      />
      <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
        {props.title}
      </h2>

      <Tooltip>
        <TooltipTrigger
          render={
            <span
              data-btw-readonly-badge="1"
              className="inline-flex shrink-0 items-center rounded-full border border-sky-500/25 bg-sky-500/12 px-1.5 py-0.5 text-[10px] leading-none font-medium text-sky-600 select-none dark:text-sky-300"
            >
              BTW · 只读
            </span>
          }
        />
        <TooltipPopup side="bottom">
          旁路提问 · 不打断主线程 · 不污染主上下文 · 仅允许只读查询与读文件
        </TooltipPopup>
      </Tooltip>

      {props.onNewSideChat ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                data-btw-new-button="1"
                aria-label="新建一条旁路提问"
                className="h-6 gap-1 px-1.5 text-[11px] font-medium text-foreground/85 hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.1]"
                onClick={props.onNewSideChat}
              >
                <PlusIcon aria-hidden="true" className="size-3" />
                <span>新建</span>
              </Button>
            }
          />
          <TooltipPopup side="bottom">新建一条旁路提问</TooltipPopup>
        </Tooltip>
      ) : null}

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-btw-cite-button="1"
              aria-disabled={!props.canAddToChat || undefined}
              className="h-6 gap-1 px-1.5 text-[11px] font-medium text-foreground/85 hover:bg-black/[0.06] hover:text-foreground aria-disabled:opacity-45 dark:hover:bg-white/[0.1]"
              onClick={props.onAddToChat}
            >
              <QuoteIcon aria-hidden="true" className="size-3" />
              <span>引用回主会话</span>
            </Button>
          }
        />
        <TooltipPopup side="bottom">
          {props.canAddToChat
            ? gt("Adds this side chat to the main thread's next message.")
            : gt("Available after the first message.")}
        </TooltipPopup>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              data-btw-delete-button="1"
              aria-label={gt("Delete side chat")}
              disabled={!props.canDelete}
              className="text-muted-foreground hover:bg-black/[0.06] hover:text-destructive dark:hover:bg-white/[0.1]"
              onClick={props.onDelete}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          }
        />
        <TooltipPopup side="bottom">{gt("Delete side chat")}</TooltipPopup>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              data-btw-close-button="1"
              aria-label={gt("Close side chat")}
              className="text-muted-foreground hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.1]"
              onClick={props.onClose}
            >
              <XIcon className="size-3.5" />
            </Button>
          }
        />
        <TooltipPopup side="bottom">{gt("Close side chat")}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

/**
 * A side question (BTW) or a subagent as a tab: the thread's own chat, which decides its bottom,
 * the composer or the read-only bar, as it does on the main screen. The tab names it and closes
 * it, so only a BTW side question, which has actions of its own, gets a header.
 */
export default function SideThreadPane(props: {
  /** The thread whose panel shows the tab. */
  readonly parentRef: ScopedThreadRef;
  readonly surface: ThreadSurface;
  readonly parentPanel: SideChatParentPanel;
  readonly onClose: () => void;
}) {
  const { parentRef, surface } = props;
  const { threadId } = surface;
  const gt = useGT();
  const threadRef = scopeThreadRef(parentRef.environmentId, threadId);
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- registers the parent panel as host in the panel store
  useEffect(
    () => hostRightPanel(scopeThreadRef(parentRef.environmentId, threadId), parentRef),
    [parentRef, threadId],
  );
  const shell = useQuietThreadShell(threadRef);
  const bootstrapComplete = isThreadRouteSnapshotAuthoritative(
    useEnvironmentShellStatus(parentRef.environmentId),
  );
  // The shell can leave an idle subagent out, so its own detail says whether it still exists.
  const unlistedDetail = useEnvironmentThread(
    shell === null ? parentRef.environmentId : null,
    shell === null ? threadId : null,
  );
  useOpenThreadFamily(threadRef, bootstrapComplete && shell === null);
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete,
    serverThreadExists: shell !== null,
    serverThreadDeleted: shell?.deletedAt != null,
    unlistedThreadDetail: unlistedDetail,
    draftThreadExists: false,
  });
  const projection = useQuietThreadProjection(threadRef)?.projection;
  const thread = shell ?? projection?.thread ?? null;
  // A tab opens for side chats and subagents only, so an unloaded one is still one of them.
  const kind = sideThreadKindOf(thread) ?? "subagent";
  const isSideChat = kind === "side-chat";
  const canOperate = useEnvironmentScope(parentRef.environmentId, AuthOrchestrationOperateScope);
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const confirmThreadDelete = useClientSettings((settings) => settings.confirmThreadDelete);
  const [deleting, setDeleting] = useState(false);
  // Closing an unused side chat deletes it, which would leave the link unreadable.
  const canAddToChat = shell !== null && shell.latestUserMessageAt !== null;
  const defaultSideTitle = gt("Side chat");
  const title =
    thread === null
      ? isSideChat
        ? defaultSideTitle
        : gt("Subagent")
      : isSideChat
        ? normalizeBtwDisplayTitle(thread.title, defaultSideTitle)
        : formatSubagentDisplayTitle(thread.title);

  const addToChat = () => {
    if (!canAddToChat) return;
    useComposerDraftStore
      .getState()
      .addThreadContexts(
        parentRef,
        [threadContextRecord(threadRef, normalizeBtwDisplayTitle(shell.title, defaultSideTitle))],
        {
          insertAtCaret: false,
        },
      );
  };

  const deleteSideChat = async () => {
    if (!canOperate || shell === null || deleting) return;
    if (confirmThreadDelete) {
      const api = readLocalApi();
      if (!api) return;
      const confirmed = await settlePromise(() =>
        api.dialogs.confirm(
          [
            gt('Delete side chat "{title}"?', {
              title: normalizeBtwDisplayTitle(shell.title, defaultSideTitle),
            }),
            gt("This permanently clears its conversation history."),
          ].join("\n"),
          { variant: "destructive" },
        ),
      );
      if (confirmed._tag === "Failure" || !confirmed.value) return;
    }
    setDeleting(true);
    const result = await deleteThread({
      environmentId: parentRef.environmentId,
      input: { threadId },
    });
    setDeleting(false);
    if (result._tag === "Success") {
      releaseComposerDraftUploads(threadRef);
      useComposerDraftStore.getState().clearDraftThread(threadRef);
      useRightPanelStore.getState().closeSurface(parentRef, surface.id);
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not delete the side chat"),
        ...(error instanceof Error ? { description: error.message } : {}),
      });
    }
  };

  return (
    <div
      data-side-chat-pane={threadId}
      data-testid="side-thread-pane"
      className="flex h-full min-h-0 flex-col"
    >
      {isSideChat ? (
        <SideThreadBtwHeader
          title={title}
          canAddToChat={canAddToChat}
          canDelete={canOperate && shell !== null && !deleting}
          onNewSideChat={props.parentPanel.onNewSideChat}
          onAddToChat={addToChat}
          onDelete={() => void deleteSideChat()}
          onClose={props.onClose}
        />
      ) : null}
      {renderState === "missing" ? (
        <p className="p-3 text-xs text-muted-foreground">
          {isSideChat ? (
            <T>This side chat was deleted.</T>
          ) : (
            <T>This thread is no longer available.</T>
          )}
        </p>
      ) : renderState === "loading" && thread === null ? null : (
        <BackgroundThreadContext value>
          <ComposerHandleContext value={null}>
            <ChatView
              environmentId={parentRef.environmentId}
              threadId={threadId}
              routeKind="server"
              embedded={props.parentPanel}
            />
          </ComposerHandleContext>
        </BackgroundThreadContext>
      )}
    </div>
  );
}
