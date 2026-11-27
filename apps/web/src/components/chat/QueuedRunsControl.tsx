import { scopeThreadRef } from "@prismux/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@prismux/client-runtime/state/runtime";
import { deriveThreadQueueWorkflowState } from "@prismux/client-runtime/state/thread-workflows";
import { assistantCitationsToPlainText } from "@prismux/core-shared/assistantCitations";
import { isSlashCommand } from "@prismux/core-shared/composerTrigger";
import {
  isAttachmentOnlyBootstrapPrompt,
  replaceComposerContextReferences,
} from "@prismux/core-shared/composerContextReferences";
import {
  parseGoalCommand,
  type ChatAttachment as ContractChatAttachment,
  type EnvironmentId,
  type MessageId,
  type RunId,
  type ThreadId,
} from "@prismux/core-contracts";
import { resolveUserMessagePresentation } from "@prismux/client-runtime/user-message";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  Clock3Icon,
  ListOrderedIcon,
  MessagesSquareIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";
import * as DateTime from "effect/DateTime";
import { msg, T, useGT, useLocale, useMessages } from "gt-react";
import { thrownErrorMessage } from "@prismux/client-runtime/errors";
import {
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";

import { useAssetUrls } from "../../assets/assetUrls";
import { threadEnvironment } from "../../state/threads";
import { useQuietThreadProjection, useQuietThreadShell } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { isImageAttachment, type ChatImageAttachment, type ChatMessage } from "../../types";
import { cn } from "~/lib/utils";
import { Button, InlineButton } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { toastManager } from "../ui/toast";
import { m } from "../../i18n/messages";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { TimestampFormat } from "@prismux/core-contracts/settings";
import { GuestMessageName } from "./guestMessageStyle";
import { TimelineRowTimestamp } from "./TimelineRowParts";
import { FoldedMessageHeader, useScheduledTaskTitle } from "./TimelineUserMessageRow";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "./ExpandedImagePreview";

export interface EditQueuedRunRequest {
  readonly runId: RunId;
  readonly messageId: MessageId;
  readonly text: string;
  readonly attachments: ReadonlyArray<ContractChatAttachment>;
}

// A longer queue shows its first messages and a button that shows the rest.
const QUEUE_VISIBLE_ROWS = 3;

const ACCENT_ICON_STYLE: CSSProperties = {
  color: "var(--pmx-accent-text, var(--pmx-accent, var(--primary)))",
};

const EDITING_ROW_STYLE: CSSProperties = {
  backgroundColor:
    "var(--pmx-accent-soft, color-mix(in srgb, var(--pmx-accent, var(--primary)) 10%, transparent))",
  boxShadow:
    "inset 0 0 0 1px var(--pmx-accent-border, color-mix(in srgb, var(--pmx-accent, var(--primary)) 42%, transparent))",
};

function getQueueDockCopy(locale: string | undefined) {
  const isZh = typeof locale === "string" && locale.toLowerCase().startsWith("zh");
  return {
    paused: isZh ? "已暂停" : "Paused",
    steerFirst: isZh ? "插话队首" : "steer first",
    resume: isZh ? "继续发送" : "Resume",
    clear: isZh ? "清空" : "Clear",
    clearAria: isZh ? "清空待发队列" : "Clear queued messages",
    clearAllAction: () => (isZh ? "移除全部待发排队消息" : "Remove all queued messages"),
  };
}

export interface QueuedRunsControlHandle {
  steerNext: (repeat: boolean) => boolean;
  editLatest: (repeat: boolean) => boolean;
}

type ThreadQueueProjection = Parameters<typeof deriveThreadQueueWorkflowState>[0];

function queuedImageResources(projection: ThreadQueueProjection | undefined) {
  if (!projection) return [];
  return deriveThreadQueueWorkflowState(projection).queuedRuns.flatMap(({ attachments }) =>
    attachments.flatMap((attachment) =>
      isImageAttachment(attachment)
        ? [{ _tag: "attachment" as const, attachmentId: attachment.id }]
        : [],
    ),
  );
}

export function QueuedRunsControl({
  ref,
  ...props
}: {
  readonly ref?: Ref<QueuedRunsControlHandle>;
  readonly steerShortcutLabel?: string | null;
  readonly editShortcutLabel?: string | null;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly optimisticMessages: ReadonlyArray<
    Pick<ChatMessage, "id" | "inputIntent" | "text" | "attachments">
  >;
  readonly editingRunId: RunId | null;
  /** Set while something else holds the composer, such as an open question. */
  readonly editBlockedReason: string | null;
  readonly onEditQueuedRun: (request: EditQueuedRunRequest) => void;
  readonly onCancelEdit: () => void;
  readonly timestampFormat: TimestampFormat;
  readonly onOpenThread: (threadId: ThreadId, environmentId?: EnvironmentId) => void;
  readonly onImageExpand: (preview: ExpandedImagePreview) => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  const copy = getQueueDockCopy(locale);
  const messages = useMessages();
  const projection = useQuietThreadProjection(
    scopeThreadRef(props.environmentId, props.threadId),
  )?.projection;
  const promote = useAtomCommand(threadEnvironment.promoteQueuedRun);
  const resume = useAtomCommand(threadEnvironment.resumeThreadQueue);
  const cancel = useAtomCommand(threadEnvironment.cancelQueuedRun);
  const [showAll, setShowAll] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const queueListId = useId();
  const [busyRunId, setBusyRunId] = useState<RunId | null>(null);
  const steerInFlightRef = useRef(false);
  // Run-only acknowledgements can resurrect pending rows after cancellation or startup.
  const acknowledgedMessageIds = new Set((projection?.messages ?? []).map((message) => message.id));
  const queuedImageAttachmentResources = queuedImageResources(projection);
  const queuedImageAttachmentUrls = useAssetUrls(
    props.environmentId,
    queuedImageAttachmentResources,
  );
  const workflow = projection ? deriveThreadQueueWorkflowState(projection, messages) : null;
  const queued = workflow?.queuedRuns ?? [];
  const activeRun = workflow?.activeRun ?? null;
  // A fresh message starts its own turn: it may skip compaction, but not steer into a turn.
  const canSendRun = (freshContext: boolean) =>
    workflow?.canSendNow === true ||
    (workflow?.canPromoteToSteer === true &&
      (!freshContext || workflow.promoteSkipsCompaction === true));
  const queuedImageUrlById = new Map(
    queuedImageAttachmentUrls.flatMap((url, index) => {
      const resource = queuedImageAttachmentResources[index];
      return url && resource ? [[resource.attachmentId, url] as const] : [];
    }),
  );
  const optimisticQueued = props.optimisticMessages.filter(
    (message) => message.inputIntent === "queued_turn" && !acknowledgedMessageIds.has(message.id),
  );
  const items = [
    ...queued.map(({ run, text, attachments, context, message }, serverIndex) => ({
      key: run.id,
      message,
      runId: run.id,
      messageId: run.userMessageId,
      freshContext: run.freshContext === true,
      serverIndex,
      text,
      // A guest's message keeps the guest's words; the owner can cancel it, not rewrite it.
      editable: context?.guest === undefined,
      attachments,
      thumbnails: attachments.filter(isImageAttachment).map<ChatImageAttachment>((attachment) => {
        const previewUrl = queuedImageUrlById.get(attachment.id);
        return {
          ...attachment,
          type: "image",
          ...(previewUrl ? { previewUrl } : {}),
        };
      }),
      pending: false,
    })),
    ...optimisticQueued.map((message) => ({
      key: message.id,
      message: undefined,
      runId: null,
      messageId: null,
      freshContext: false,
      serverIndex: null,
      text: message.text,
      editable: true,
      attachments: [] as ReadonlyArray<ContractChatAttachment>,
      thumbnails: (message.attachments ?? []).filter(isImageAttachment),
      pending: true,
    })),
  ];

  const sendQueuedMessage = async (queuedRunId: RunId) => {
    const freshContext = queued.some(
      ({ run }) => run.id === queuedRunId && run.freshContext === true,
    );
    if (!canSendRun(freshContext) || steerInFlightRef.current) return;
    steerInFlightRef.current = true;
    setBusyRunId(queuedRunId);
    const result = workflow?.canSendNow
      ? await resume({
          environmentId: props.environmentId,
          input: { threadId: props.threadId, runId: queuedRunId },
        })
      : activeRun !== null
        ? await promote({
            environmentId: props.environmentId,
            input: { threadId: props.threadId, queuedRunId, targetRunId: activeRun.id },
          })
        : null;
    steerInFlightRef.current = false;
    setBusyRunId(null);
    if (result?._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: m(msg("Could not send queued message")),
        description:
          error instanceof Error
            ? (thrownErrorMessage(error, m) ?? error.message)
            : m(msg("An error occurred.")),
      });
    }
  };

  useImperativeHandle(ref, () => ({
    steerNext(repeat) {
      const next = queued[0];
      if (!next || !canSendRun(next.run.freshContext === true)) return false;
      if (!repeat && busyRunId === null && !clearingAll) void sendQueuedMessage(next.run.id);
      return true;
    },
    // Leave the key to caret navigation while editing.
    editLatest(repeat) {
      const latest = queued.at(-1);
      if (
        !latest ||
        latest.context?.guest !== undefined ||
        props.editingRunId !== null ||
        props.editBlockedReason !== null ||
        busyRunId !== null ||
        clearingAll
      ) {
        return false;
      }
      if (!repeat) {
        setDockCollapsed(false);
        setShowAll(true);
        props.onEditQueuedRun({
          runId: latest.run.id,
          messageId: latest.run.userMessageId,
          text: latest.text,
          attachments: latest.attachments,
        });
      }
      return true;
    },
  }));

  if (items.length === 0) return null;

  const remove = async (runId: RunId) => {
    setBusyRunId(runId);
    await cancel({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, runId },
    });
    setBusyRunId(null);
  };

  const clearAll = async () => {
    if (queued.length === 0 || busyRunId !== null || clearingAll) return;
    setClearingAll(true);
    try {
      for (const entry of queued) {
        await cancel({
          environmentId: props.environmentId,
          input: { threadId: props.threadId, runId: entry.run.id },
        });
      }
    } finally {
      setClearingAll(false);
    }
  };

  const isHeld = workflow?.isHeld === true;
  const showHeader = items.length > 1 || isHeld;
  const interactionActive = props.editingRunId !== null || busyRunId !== null || clearingAll;
  const listVisible = !showHeader || !dockCollapsed || interactionActive;
  const collapsible = items.length > QUEUE_VISIBLE_ROWS;
  const visibleItems = collapsible && !showAll ? items.slice(0, QUEUE_VISIBLE_ROWS - 1) : items;
  const anyActionBusy = busyRunId !== null || clearingAll;
  const firstQueuedRun = queued[0] ?? null;

  return (
    <section
      aria-label={gt(
        "{count, plural, one {{count} queued message} other {{count} queued messages}}",
        { count: items.length },
      )}
      data-thread-queue="true"
      data-queue-dock="true"
      // Anchors the sr-only live region; unanchored, it escapes the timeline scroller and makes the chat column scroll.
      className="relative mx-auto flex w-full max-w-(--chat-content-max-width) flex-col pb-2.5"
    >
      <span className="sr-only" aria-live="polite">
        {gt("{count, plural, one {{count} queued} other {{count} queued}}", {
          count: items.length,
        })}
      </span>
      <div
        data-queue-dock-panel="true"
        className={cn(
          "overflow-hidden rounded-2xl border transition-colors",
          "border-border/80 bg-card/95 text-foreground shadow-xs",
          "dark:border-border/70 dark:bg-card/92",
          "[[data-pmx-glass='1']_&]:border-border/65 [[data-pmx-glass='1']_&]:bg-background/84 [[data-pmx-glass='1']_&]:backdrop-blur-md [[data-pmx-glass='1']_&]:shadow-sm",
          "dark:[[data-pmx-glass='1']_&]:bg-background/78",
        )}
      >
        {showHeader ? (
          <div
            data-queue-dock-header="true"
            className={cn(
              "flex min-h-9 items-center justify-between gap-2 px-3 py-1.5",
              listVisible && "border-b border-border/55",
            )}
          >
            <button
              type="button"
              data-queue-dock-toggle="true"
              aria-expanded={listVisible}
              aria-controls={queueListId}
              disabled={interactionActive}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => setDockCollapsed((value) => !value)}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default"
            >
              <ListOrderedIcon
                aria-hidden="true"
                className="size-3.5 shrink-0"
                style={ACCENT_ICON_STYLE}
              />
              <span className="truncate text-sm font-medium text-foreground">
                {gt(
                  "{count, plural, one {{count} queued message} other {{count} queued messages}}",
                  { count: items.length },
                )}
              </span>
              {isHeld ? (
                <span
                  data-queue-dock-held="true"
                  className="inline-flex shrink-0 items-center rounded-full border border-warning/35 bg-warning/14 px-2 py-0.5 text-2xs font-medium text-warning-foreground dark:text-warning"
                >
                  {copy.paused}
                </span>
              ) : null}
              {!listVisible && optimisticQueued.length > 0 ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Clock3Icon aria-hidden="true" className="size-3" />
                  <T>Saving</T>
                </span>
              ) : null}
              <ChevronDownIcon
                aria-hidden="true"
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                  !listVisible && "-rotate-90",
                )}
              />
            </button>
            <div className="flex shrink-0 items-center gap-1.5">
              {!isHeld && props.steerShortcutLabel && workflow?.canPromoteToSteer ? (
                <span
                  data-queue-dock-shortcut-hint="true"
                  className="hidden items-center gap-1 text-2xs text-muted-foreground sm:inline-flex"
                >
                  <Kbd variant="outline">{props.steerShortcutLabel}</Kbd>
                  <span>{copy.steerFirst}</span>
                </span>
              ) : null}
              {isHeld && workflow?.canSendNow && firstQueuedRun !== null ? (
                <button
                  type="button"
                  data-queue-dock-resume="true"
                  disabled={anyActionBusy}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => void sendQueuedMessage(firstQueuedRun.run.id)}
                  className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-full px-2 text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                >
                  <PlayIcon
                    aria-hidden="true"
                    className="size-3 fill-current"
                    style={ACCENT_ICON_STYLE}
                  />
                  <span>{copy.resume}</span>
                </button>
              ) : null}
              {queued.length > 1 && props.editingRunId === null ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        data-queue-dock-clear="true"
                        aria-label={copy.clearAria}
                        disabled={anyActionBusy}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => void clearAll()}
                        className="inline-flex h-6 cursor-pointer items-center rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                      />
                    }
                  >
                    {copy.clear}
                  </TooltipTrigger>
                  <TooltipPopup>{copy.clearAllAction()}</TooltipPopup>
                </Tooltip>
              ) : null}
            </div>
          </div>
        ) : null}
        <ol
          id={queueListId}
          hidden={!listVisible}
          className="max-h-56 overflow-y-auto divide-y divide-border/55"
        >
          {listVisible
            ? visibleItems.map((item, position) => {
                const previewText = isAttachmentOnlyBootstrapPrompt(item.text)
                  ? ""
                  : assistantCitationsToPlainText(
                      replaceComposerContextReferences(item.text, (reference) => reference.label),
                    ).trim();
                const isEditing = item.runId !== null && item.runId === props.editingRunId;
                // The server decides on the agent's text, and a goal command can stop the turn.
                const sentText = {
                  text: item.message?.text ?? item.text,
                  attachments: item.attachments,
                };
                const movesCommandFirst =
                  isSlashCommand(sentText) && parseGoalCommand(sentText) === null;
                return (
                  <li
                    key={item.key}
                    aria-label={gt("Queued message {position} of {total}, not sent", {
                      position: position + 1,
                      total: items.length,
                    })}
                    aria-posinset={position + 1}
                    aria-setsize={items.length}
                    aria-current={isEditing ? "true" : undefined}
                    className="group/queued transition-colors"
                    style={isEditing ? EDITING_ROW_STYLE : undefined}
                  >
                    <QueuedMessage
                      environmentId={props.environmentId}
                      message={item.message}
                      previewText={previewText}
                      thumbnails={item.thumbnails}
                      isEditing={isEditing}
                      position={position}
                      singleRow={!showHeader}
                      timestampFormat={props.timestampFormat}
                      onOpenThread={props.onOpenThread}
                      onImageExpand={props.onImageExpand}
                    >
                      {canSendRun(item.freshContext) && !isEditing ? (
                        <Tooltip>
                          <TooltipTrigger render={<span className="flex shrink-0" />}>
                            <Button
                              size="xs"
                              variant="ghost-muted"
                              disabled={item.runId === null || anyActionBusy}
                              onPointerDown={(event) => event.preventDefault()}
                              onClick={() => {
                                if (item.runId !== null) {
                                  void sendQueuedMessage(item.runId);
                                }
                              }}
                            >
                              <ArrowUpIcon aria-hidden="true" style={ACCENT_ICON_STYLE} />
                              <T>Send now</T>
                            </Button>
                          </TooltipTrigger>
                          <TooltipPopup>
                            {item.serverIndex === 0 && props.steerShortcutLabel
                              ? workflow?.canSendNow
                                ? gt("Start a turn with this message ({shortcut})", {
                                    shortcut: props.steerShortcutLabel,
                                  })
                                : workflow?.promoteSkipsCompaction
                                  ? gt("Skip compaction and send this message ({shortcut})", {
                                      shortcut: props.steerShortcutLabel,
                                    })
                                  : movesCommandFirst
                                    ? gt(
                                        "Move this command to the front of the queue ({shortcut})",
                                        {
                                          shortcut: props.steerShortcutLabel,
                                        },
                                      )
                                    : gt("Send into the current turn ({shortcut})", {
                                        shortcut: props.steerShortcutLabel,
                                      })
                              : workflow?.canSendNow
                                ? gt("Start a turn with this message")
                                : workflow?.promoteSkipsCompaction
                                  ? gt("Skip compaction and send this message")
                                  : movesCommandFirst
                                    ? gt("Move this command to the front of the queue")
                                    : gt("Send into the current turn")}
                          </TooltipPopup>
                        </Tooltip>
                      ) : null}
                      {item.pending ? (
                        <span className="flex shrink-0 items-center gap-1 px-1 text-xs text-muted-foreground">
                          <Clock3Icon aria-hidden className="size-3" />
                          <T>Saving</T>
                        </span>
                      ) : null}
                      {isEditing ? (
                        <>
                          <span className="shrink-0 px-1 text-xs font-medium text-foreground">
                            <T>Editing in the composer</T>
                          </span>
                          <Button
                            size="xs"
                            variant="ghost"
                            aria-label={gt("Cancel editing queued message")}
                            onClick={props.onCancelEdit}
                          >
                            <T>Cancel</T>
                          </Button>
                        </>
                      ) : (
                        <>
                          <Tooltip>
                            {/* The span keeps the tooltip, and its reason, on a disabled button. */}
                            <TooltipTrigger render={<span className="flex shrink-0" />}>
                              <Button
                                size="icon-xs"
                                variant="ghost-muted"
                                aria-label={gt("Edit queued message")}
                                disabled={
                                  item.runId === null ||
                                  !item.editable ||
                                  anyActionBusy ||
                                  props.editBlockedReason !== null
                                }
                                onPointerDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  if (item.runId !== null && item.messageId !== null) {
                                    props.onEditQueuedRun({
                                      runId: item.runId,
                                      messageId: item.messageId,
                                      text: item.text,
                                      attachments: item.attachments,
                                    });
                                  }
                                }}
                              >
                                <PencilIcon />
                              </Button>
                            </TooltipTrigger>
                            <TooltipPopup>
                              {props.editBlockedReason ??
                                (item.serverIndex === queued.length - 1 && props.editShortcutLabel
                                  ? gt("Edit in the composer ({shortcut})", {
                                      shortcut: props.editShortcutLabel,
                                    })
                                  : gt("Edit in the composer"))}
                            </TooltipPopup>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  size="icon-xs"
                                  variant="ghost-muted"
                                  aria-label={gt("Remove queued message")}
                                  disabled={item.runId === null || anyActionBusy}
                                  onPointerDown={(event) => event.preventDefault()}
                                  onClick={() => {
                                    if (item.runId !== null) void remove(item.runId);
                                  }}
                                />
                              }
                            >
                              <Trash2Icon />
                            </TooltipTrigger>
                            <TooltipPopup>
                              <T>Remove from queue</T>
                            </TooltipPopup>
                          </Tooltip>
                        </>
                      )}
                    </QueuedMessage>
                  </li>
                );
              })
            : null}
        </ol>
        {listVisible && collapsible ? (
          <div className="flex items-center justify-end border-t border-border/55 px-3 py-1.5 text-xs pointer-coarse:[&_[data-slot=inline-button]]:relative pointer-coarse:[&_[data-slot=inline-button]]:after:absolute pointer-coarse:[&_[data-slot=inline-button]]:after:-inset-x-1.5 pointer-coarse:[&_[data-slot=inline-button]]:after:-inset-y-3.5">
            <InlineButton
              tone="muted"
              aria-expanded={showAll}
              aria-controls={queueListId}
              // Keep the composer focused; keyboard activation still works.
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll
                ? gt("Show fewer")
                : gt(
                    "{count, plural, one {Show all {count} queued} other {Show all {count} queued}}",
                    { count: items.length },
                  )}
              <ChevronDownIcon
                aria-hidden
                className={cn(
                  "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
                  showAll && "rotate-180",
                )}
              />
            </InlineButton>
          </div>
        ) : null}
      </div>
    </section>
  );
}

type QueuedRunMessage = NonNullable<ThreadQueueProjection["messages"][number]>;

/** A queued turn displayed inside the DSH-style docked queue strip while retaining full attribution. */
function QueuedMessage(props: {
  readonly environmentId: EnvironmentId;
  readonly message: QueuedRunMessage | undefined;
  readonly previewText: string;
  readonly thumbnails: ReadonlyArray<ChatImageAttachment>;
  readonly isEditing: boolean;
  readonly position: number;
  readonly singleRow: boolean;
  readonly timestampFormat: TimestampFormat;
  readonly onOpenThread: (threadId: ThreadId, environmentId?: EnvironmentId) => void;
  readonly children: ReactNode;
  readonly onImageExpand: (preview: ExpandedImagePreview) => void;
}) {
  const gt = useGT();
  const presentation = props.message ? resolveUserMessagePresentation(props.message) : null;
  const attribution = presentation?.attribution ?? null;
  const scheduledTaskId = presentation?.scheduledTaskId;
  const senderThreadId = props.message?.senderThreadId;
  // A linked environment's agent sent it from a thread there.
  const senderRef =
    props.message?.linkedSender ??
    (senderThreadId === undefined ? null : scopeThreadRef(props.environmentId, senderThreadId));
  const [expanded, setExpanded] = useState(false);
  const taskTitle = useScheduledTaskTitle(props.environmentId, scheduledTaskId);
  const senderShell = useQuietThreadShell(attribution === "agent" ? senderRef : null);
  const linkedSenderEnvironment = useEnvironment(
    props.message?.linkedSender?.environmentId ?? null,
  );
  const senderTitle = senderShell?.title.trim() || props.message?.linkedSender?.title.trim();
  const fold =
    attribution === "automation"
      ? {
          icon: CalendarClockIcon,
          label: gt("Automation"),
          fitLabel: true,
          summary: taskTitle ?? props.previewText.split(/\r?\n/, 1)[0] ?? "",
        }
      : attribution === "agent"
        ? {
            icon: MessagesSquareIcon,
            label:
              senderTitle ||
              gt("Agent", { $context: "fallback name of the agent that sent a message" }),
            fitLabel: !senderTitle,
            summary: props.previewText.split(/\r?\n/).find((line) => line.trim()) ?? "",
          }
        : null;
  const bodyVisible = fold === null || expanded;

  const leadingMarker = props.singleRow ? (
    <ListOrderedIcon aria-hidden="true" className="size-3.5 shrink-0" style={ACCENT_ICON_STYLE} />
  ) : (
    <span
      aria-hidden="true"
      className="inline-flex size-4.5 shrink-0 items-center justify-center rounded-full bg-foreground/8 text-3xs font-semibold tabular-nums text-muted-foreground"
    >
      {props.position + 1}
    </span>
  );

  const secondaryLinks = props.message ? (
    <span className="flex items-center gap-2 text-xs text-muted-foreground opacity-0 transition-opacity duration-200 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover/queued:opacity-100">
      {attribution === "agent" &&
      senderRef &&
      // Only an environment this client is connected to can open the sender's thread there.
      (props.message?.linkedSender === undefined || linkedSenderEnvironment !== null) ? (
        <InlineButton
          tone="muted"
          onClick={() => props.onOpenThread(senderRef.threadId, senderRef.environmentId)}
        >
          <T>Open thread</T>
        </InlineButton>
      ) : null}
      {scheduledTaskId ? (
        <InlineButton
          tone="muted"
          render={
            <Link
              to="/settings/scheduled-tasks"
              search={{ environmentId: props.environmentId, taskId: scheduledTaskId }}
            />
          }
        >
          <T>Open automation</T>
        </InlineButton>
      ) : null}
      <TimelineRowTimestamp
        createdAt={DateTime.formatIso(props.message.createdAt)}
        timestampFormat={props.timestampFormat}
        alwaysVisible
      />
    </span>
  ) : null;

  return (
    <div className="flex min-h-9 flex-col gap-1 px-3 py-1.5">
      {attribution === "prismux" ? (
        <p className="ps-6 text-2xs text-muted-foreground">
          <T>Sent by Prismux</T>
        </p>
      ) : null}
      {presentation?.guestName === undefined ? null : (
        <div className="ps-6">
          <GuestMessageName name={presentation.guestName} />
        </div>
      )}
      <div className="flex min-w-0 items-center gap-2.5">
        {leadingMarker}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {fold ? (
            <FoldedMessageHeader
              icon={fold.icon}
              label={fold.label}
              fitLabel={fold.fitLabel}
              summary={fold.summary}
              expanded={expanded}
              onToggle={() => setExpanded((value) => !value)}
            />
          ) : null}
          {bodyVisible ? (
            fold !== null ? (
              <div className="flex max-h-72 min-w-0 flex-col items-start gap-2 overflow-auto pt-1">
                {props.thumbnails.length > 0 ? (
                  <span className="flex shrink-0 flex-wrap items-center gap-1">
                    {props.thumbnails.map((thumbnail) => (
                      <button
                        key={thumbnail.id}
                        type="button"
                        aria-label={gt("Preview {name}", { name: thumbnail.name })}
                        disabled={!thumbnail.previewUrl}
                        className="size-6 overflow-hidden rounded border border-border/70 bg-background enabled:cursor-zoom-in"
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => {
                          const preview = buildExpandedImagePreview(props.thumbnails, thumbnail.id);
                          if (preview) props.onImageExpand(preview);
                        }}
                      >
                        {thumbnail.previewUrl ? (
                          <img
                            src={thumbnail.previewUrl}
                            alt={thumbnail.name}
                            className="size-full object-cover"
                          />
                        ) : (
                          <span
                            aria-label={thumbnail.name}
                            className="block size-full bg-muted/60"
                          />
                        )}
                      </button>
                    ))}
                  </span>
                ) : null}
                {props.previewText ? (
                  <p
                    className={cn(
                      "min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere text-sm leading-snug",
                      props.isEditing ? "font-medium text-foreground" : "text-foreground/90",
                    )}
                  >
                    {props.previewText}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex min-w-0 items-center gap-2">
                {props.thumbnails.length > 0 ? (
                  <span className="flex shrink-0 flex-wrap items-center gap-1">
                    {props.thumbnails.map((thumbnail) => (
                      <button
                        key={thumbnail.id}
                        type="button"
                        aria-label={gt("Preview {name}", { name: thumbnail.name })}
                        disabled={!thumbnail.previewUrl}
                        className="size-6 overflow-hidden rounded border border-border/70 bg-background enabled:cursor-zoom-in"
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => {
                          const preview = buildExpandedImagePreview(props.thumbnails, thumbnail.id);
                          if (preview) props.onImageExpand(preview);
                        }}
                      >
                        {thumbnail.previewUrl ? (
                          <img
                            src={thumbnail.previewUrl}
                            alt={thumbnail.name}
                            className="size-full object-cover"
                          />
                        ) : (
                          <span
                            aria-label={thumbnail.name}
                            className="block size-full bg-muted/60"
                          />
                        )}
                      </button>
                    ))}
                  </span>
                ) : null}
                {props.previewText ? (
                  <p
                    className={cn(
                      "min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere text-sm leading-snug",
                      props.isEditing ? "font-medium text-foreground" : "text-foreground/90",
                    )}
                  >
                    {props.previewText}
                  </p>
                ) : null}
              </div>
            )
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {secondaryLinks}
          {props.children}
        </div>
      </div>
    </div>
  );
}
