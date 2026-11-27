import {
  memo,
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { msg, useGT, useLocale, useMessages } from "gt-react";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  Minimize2Icon,
  PlayIcon,
  CornerUpRightIcon,
  ListPlusIcon,
} from "lucide-react";
import type { MessageResolver } from "~/i18n/messages";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import { StageBackdropButtonArt, useSidebarStageBackdropVariant } from "../SidebarStageBackdrop";
import {
  computeSkyScene,
  getSkyClockServerSnapshot,
  getSkyClockSnapshot,
  resolveCompactSkyButtonTheme,
  subscribeSkyClock,
} from "../sidebarSkyBackdrop.logic";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  alternateComposerDispatchAction,
  resolveComposerDispatchMode,
} from "@prismux/client-runtime/state/composer-dispatch";

export function compactShortcutKeyLabel(shortcut: string | null | undefined): string | null {
  if (!shortcut) return null;
  const compacted = shortcut
    .split(/\s*\/\s*/u)
    .map((entry) => entry.trim().replace(/Enter$/i, "↵"))
    .filter((entry) => entry.length > 0);
  return compacted.length > 0 ? compacted.join(" / ") : null;
}

let alternateModifierDown = false;
const alternateModifierListeners = new Set<() => void>();
let stopAlternateModifierTracking: (() => void) | null = null;

function setAlternateModifierDown(next: boolean) {
  if (alternateModifierDown === next) return;
  alternateModifierDown = next;
  for (const listener of alternateModifierListeners) listener();
}

function subscribeAlternateModifier(listener: () => void): () => void {
  alternateModifierListeners.add(listener);
  if (stopAlternateModifierTracking === null) {
    const update = (event: KeyboardEvent) => {
      setAlternateModifierDown(event.metaKey || event.ctrlKey || event.altKey);
    };
    const reset = () => setAlternateModifierDown(false);
    window.addEventListener("keydown", update, true);
    window.addEventListener("keyup", update, true);
    window.addEventListener("blur", reset);
    stopAlternateModifierTracking = () => {
      window.removeEventListener("keydown", update, true);
      window.removeEventListener("keyup", update, true);
      window.removeEventListener("blur", reset);
      alternateModifierDown = false;
    };
  }
  return () => {
    alternateModifierListeners.delete(listener);
    if (alternateModifierListeners.size === 0) {
      stopAlternateModifierTracking?.();
      stopAlternateModifierTracking = null;
    }
  };
}

const noopSubscribe = () => () => {};
const getAlternateModifierSnapshot = () => alternateModifierDown;
const getFalseSnapshot = () => false;

/** Tracks Ctrl / Meta / Alt only while a running turn has sendable content, ignoring Shift. */
function useAlternateModifierPressed(enabled: boolean): boolean {
  return useSyncExternalStore(
    enabled ? subscribeAlternateModifier : noopSubscribe,
    enabled ? getAlternateModifierSnapshot : getFalseSnapshot,
    getFalseSnapshot,
  );
}

const ACCENT_ICON_STYLE: CSSProperties = {
  color: "var(--pmx-accent-text, var(--pmx-accent, var(--primary)))",
};

const ACCENT_SEND_BUTTON_STYLE: CSSProperties = {
  backgroundColor: "var(--pmx-accent, var(--message-action))",
  color: "var(--pmx-accent-ink, var(--message-action-foreground))",
};

const STEER_PILL_STYLE: CSSProperties = {
  borderColor:
    "var(--pmx-accent-border, color-mix(in srgb, var(--pmx-accent, var(--primary)) 40%, var(--border)))",
  backgroundColor:
    "var(--pmx-accent-soft, color-mix(in srgb, var(--pmx-accent, var(--primary)) 12%, var(--background)))",
};

function getComposerActionCopy(locale: string | undefined) {
  const isZh = typeof locale === "string" && locale.toLowerCase().startsWith("zh");
  return {
    escPrefix: isZh ? "再按" : "Press",
    escSuffix: isZh ? "强行中断" : "again to stop",
    // oxlint-disable-next-line prismux/no-untranslated-copy -- inline bilingual copy (zh.json owned by Track B)
    sendMessageHeading: isZh ? "发送消息" : "Send message",
    // oxlint-disable-next-line prismux/no-untranslated-copy -- inline bilingual copy (zh.json owned by Track B)
    queueMessageHeading: isZh ? "加入队列" : "Queue Message",
    // oxlint-disable-next-line prismux/no-untranslated-copy -- inline bilingual copy (zh.json owned by Track B)
    sendNowHeading: isZh ? "立即发送" : "Send now",
    sendNowWithShortcut: (shortcut: string) =>
      isZh ? `立即发送 (${shortcut})` : `Send now (${shortcut})`,
    queueWithShortcut: (shortcut: string) =>
      isZh ? `加入队列 (${shortcut})` : `Queue Message (${shortcut})`,
    steerQueueAction: isZh ? "插话队首" : "Steer queue",
    steerQueueAria: (shortcut: string | null) =>
      isZh
        ? shortcut
          ? `立即插话发送队首排队消息 (${shortcut})`
          : "立即插话发送队首排队消息"
        : shortcut
          ? `Steer queued messages (${shortcut})`
          : "Steer queued messages",
    steerQueueTooltip: (count: number, shortcut: string | null) =>
      isZh
        ? shortcut
          ? `按 ${shortcut} 将队首排队消息立即插话发送（共 ${count} 条排队）`
          : `将队首排队消息立即插话发送（共 ${count} 条排队）`
        : shortcut
          ? `Press ${shortcut} to steer the next queued message (${count} queued)`
          : `Steer the next queued message (${count} queued)`,
    steerAction: isZh ? "插话" : "Steer",
    queueAction: isZh ? "排队" : "Queue",
    steerNowAria: (shortcut: string | null) =>
      isZh
        ? shortcut
          ? `强行插话发送 (${shortcut})`
          : "强行插话发送"
        : shortcut
          ? `Steer now (${shortcut})`
          : "Steer now",
    queueInsteadAria: (shortcut: string | null) =>
      isZh
        ? shortcut
          ? `加入队列 (${shortcut})`
          : "加入队列"
        : shortcut
          ? `Queue instead (${shortcut})`
          : "Queue instead",
    steerNowTooltip: (shortcut: string | null) =>
      isZh
        ? shortcut
          ? `强行打断/插话发送当前输入（${shortcut}）`
          : "强行打断/插话发送当前输入"
        : shortcut
          ? `Interrupt / steer current turn with this message (${shortcut})`
          : "Interrupt / steer current turn with this message",
    queueInsteadTooltip: (shortcut: string | null) =>
      isZh
        ? shortcut
          ? `不打断当前运行，加入待发队列（${shortcut}）`
          : "不打断当前运行，加入待发队列"
        : shortcut
          ? `Queue behind the active run without interrupting (${shortcut})`
          : "Queue behind the active run without interrupting",
  };
}

interface PendingActionState {
  questionIndex: number;
  isLastQuestion: boolean;
  canAdvance: boolean;
  isResponding: boolean;
  isComplete: boolean;
}

interface ComposerPrimaryActionsProps {
  /** Footer controls (dictation) that always sit right before the primary button. */
  children?: ReactNode;
  compact: boolean;
  canOperateThread: boolean;
  pendingAction: PendingActionState | null;
  isRunning: boolean;
  canInterrupt: boolean;
  runId?: string | null;
  followUpBehavior?: "queue" | "steer";
  canSteer?: boolean;
  /** Live primary send shortcut label derived from user send-shortcut preference (e.g. "Enter"). */
  sendShortcutLabel?: string | null;
  /** Live alternate dispatch shortcut label(s) derived from user keybindings. */
  alternateShortcutLabel?: string | null;
  /** Live stop/interrupt shortcut label derived from user keybindings (`thread.stop`). */
  stopShortcutLabel?: string | null;
  /** True during the 500ms window after the first Esc press (double-Esc force-interrupt). */
  escStopArmed?: boolean;
  /** Count of pending queued turns waiting behind the active run. */
  queuedCount?: number;
  /** Dictation is running; Send finishes it and submits once the transcript lands. */
  voiceInputActive?: boolean;
  isSendBusy: boolean;
  /** A send is armed and waiting for its attachments to finish preparing or uploading. */
  isSendHeld?: boolean;
  sendDisabledReason: string | null;
  isEnvironmentUnavailable: boolean;
  isPreparingWorktree: boolean;
  hasSendableContent: boolean;
  canResume?: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  isEditingQueuedMessage?: boolean;
  onSubmitMessage?: MouseEventHandler<HTMLButtonElement> | undefined;
  onAlternateSubmitMessage?: MouseEventHandler<HTMLButtonElement> | undefined;
  onSteerQueuedMessages?: (() => void) | undefined;
  onResume?: () => void;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  compactBeforeSendTokens?: number | null;
  hideCompactToggle?: boolean;
  keepFullHistory?: boolean;
  onToggleKeepFullHistory?: () => void;
}

const formatPendingPrimaryActionLabel = (
  input: {
    compact: boolean;
    isLastQuestion: boolean;
    isResponding: boolean;
    questionIndex: number;
  },
  resolve: MessageResolver,
) => {
  if (input.isResponding) {
    return resolve(msg("Submitting..."));
  }
  if (input.compact) {
    return input.isLastQuestion
      ? resolve(msg("Submit", { $context: "verb, submits answers" }))
      : resolve(msg("Next", { $context: "button that goes to the next question" }));
  }
  if (!input.isLastQuestion) {
    return resolve(msg("Next question"));
  }
  return input.questionIndex > 0 ? resolve(msg("Submit answers")) : resolve(msg("Submit answer"));
};

const STOP_PENDING_MAX_MS = 10_000;
// The action that takes Stop's place ignores clicks this long, so repeat Stop clicks can't resume.
const STOP_LANDED_CLICK_GUARD_MS = 500;

const messageActionPillClassName =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-message-action font-medium text-base text-message-action-foreground shadow-xs shadow-message-action/24 outline-none hover:bg-message-action-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 disabled:shadow-none sm:text-sm";

const preventPointerFocus: PointerEventHandler<HTMLElement> = (event) => {
  event.preventDefault();
};

type StopPhase = "pending" | "timedOut" | "landed" | null;

function useStopPhase(input: {
  runId: string | null;
  canInterrupt: boolean;
  canOperateThread: boolean;
}) {
  const { runId, canInterrupt, canOperateThread } = input;
  const [stopPhase, setStopPhase] = useState<StopPhase>(null);
  const [stopRunId, setStopRunId] = useState(runId);
  if (runId !== null && stopRunId !== runId) {
    setStopRunId(runId);
    setStopPhase(null);
  } else if (canOperateThread) {
    // Losing permission also clears canInterrupt; it does not acknowledge the stop.
    if ((stopPhase === "pending" || stopPhase === "timedOut") && !canInterrupt)
      setStopPhase("landed");
    else if (stopPhase === "landed" && canInterrupt) setStopPhase(null);
  }
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- timers that re-enable an unsettled Stop and end the landed click guard
  useEffect(() => {
    if (stopPhase === "pending") {
      const timeout = setTimeout(() => setStopPhase("timedOut"), STOP_PENDING_MAX_MS);
      return () => clearTimeout(timeout);
    }
    if (stopPhase === "landed") {
      const timeout = setTimeout(() => setStopPhase(null), STOP_LANDED_CLICK_GUARD_MS);
      return () => clearTimeout(timeout);
    }
  }, [stopPhase]);
  return [stopPhase, setStopPhase] as const;
}

function StopGenerationButton({
  stopPhase,
  canOperateThread,
  insidePendingAction,
  preserveComposerFocusOnPointerDown,
  stopShortcutLabel = null,
  onStopRequested,
  onInterrupt,
}: {
  stopPhase: StopPhase;
  canOperateThread: boolean;
  insidePendingAction: boolean;
  preserveComposerFocusOnPointerDown: boolean;
  stopShortcutLabel?: string | null;
  onStopRequested: () => void;
  onInterrupt: () => void;
}) {
  const gt = useGT();
  const isStopDisabled = stopPhase === "pending";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-destructive/90 text-white shadow-xs shadow-destructive/24 inset-shadow-control-highlight transition-colors duration-150 hover:bg-destructive active:inset-shadow-control-pressed active:shadow-none disabled:cursor-default disabled:opacity-64 disabled:hover:bg-destructive/90 [&_svg]:pointer-events-none",
              insidePendingAction ? "size-8 sm:size-7" : "size-8 sm:h-8 sm:w-8",
            )}
            onPointerDown={preserveComposerFocusOnPointerDown ? preventPointerFocus : undefined}
            disabled={!canOperateThread || isStopDisabled}
            onClick={() => {
              if (!canOperateThread || isStopDisabled) return;
              onStopRequested();
              onInterrupt();
            }}
            aria-label={stopPhase === "pending" ? gt("Stopping") : gt("Stop generation")}
          />
        }
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <rect x="2" y="2" width="8" height="8" rx="1.5" />
        </svg>
      </TooltipTrigger>
      <TooltipPopup>
        {stopPhase === "pending" ? (
          gt("Stopping…")
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span>{gt("Interrupt", { $context: "verb, stops the running agent" })}</span>
            {stopShortcutLabel ? <Kbd variant="outline">{stopShortcutLabel}</Kbd> : null}
          </span>
        )}
      </TooltipPopup>
    </Tooltip>
  );
}

/** The collapsed mobile composer's Stop, shown in place of `children` while a turn can be stopped. */
export function CollapsedComposerStopAction({
  children,
  canOperateThread,
  canInterrupt,
  runId,
  hasSendableContent,
  isEditingQueuedMessage,
  stopShortcutLabel = null,
  onInterrupt,
}: {
  children: ReactNode;
  canOperateThread: boolean;
  canInterrupt: boolean;
  runId: string | null;
  hasSendableContent: boolean;
  isEditingQueuedMessage: boolean;
  stopShortcutLabel?: string | null;
  onInterrupt: () => void;
}) {
  const [stopPhase, setStopPhase] = useStopPhase({ runId, canInterrupt, canOperateThread });
  if (
    !(canInterrupt || stopPhase === "pending" || stopPhase === "timedOut") ||
    hasSendableContent ||
    isEditingQueuedMessage
  ) {
    return children;
  }
  return (
    <span
      data-chat-composer-transition-actions="true"
      data-chat-composer-collapsed-controls="true"
      className="flex shrink-0"
    >
      <StopGenerationButton
        stopPhase={stopPhase}
        canOperateThread={canOperateThread}
        insidePendingAction={false}
        preserveComposerFocusOnPointerDown
        stopShortcutLabel={stopShortcutLabel}
        onStopRequested={() => setStopPhase("pending")}
        onInterrupt={onInterrupt}
      />
    </span>
  );
}

export const ComposerPrimaryActions = memo(function ComposerPrimaryActions({
  children,
  compact,
  canOperateThread,
  pendingAction,
  isRunning,
  canInterrupt,
  runId = null,
  followUpBehavior = "queue",
  canSteer = true,
  sendShortcutLabel = null,
  alternateShortcutLabel = null,
  stopShortcutLabel = null,
  escStopArmed = false,
  queuedCount = 0,
  voiceInputActive = false,
  isSendBusy,
  isSendHeld = false,
  sendDisabledReason,
  isEnvironmentUnavailable,
  isPreparingWorktree,
  hasSendableContent,
  canResume = false,
  preserveComposerFocusOnPointerDown = false,
  isEditingQueuedMessage = false,
  onSubmitMessage,
  onAlternateSubmitMessage,
  onSteerQueuedMessages,
  onResume,
  onPreviousPendingQuestion,
  onInterrupt,
  compactBeforeSendTokens = null,
  hideCompactToggle = false,
  keepFullHistory = false,
  onToggleKeepFullHistory,
}: ComposerPrimaryActionsProps) {
  const gt = useGT();
  const locale = useLocale();
  const actionCopy = getComposerActionCopy(locale);
  const m = useMessages();
  const [stopPhase, setStopPhase] = useStopPhase({ runId, canInterrupt, canOperateThread });
  const pointerFocusProps = preserveComposerFocusOnPointerDown
    ? { onPointerDown: preventPointerFocus }
    : undefined;
  const alternateModifierPressed = useAlternateModifierPressed(
    isRunning && !isEditingQueuedMessage && hasSendableContent,
  );
  const isQueuing =
    !isEditingQueuedMessage &&
    resolveComposerDispatchMode({
      running: isRunning,
      activeTurnDefault: followUpBehavior,
      canSteer,
      alternateModifier: alternateModifierPressed,
    }) === "queue";
  const alternateAction = alternateComposerDispatchAction(followUpBehavior);
  const compactAlternateShortcut = compactShortcutKeyLabel(alternateShortcutLabel);
  const isSendDisabled = !canOperateThread || sendDisabledReason !== null;
  const stageBackdropVariant = useSidebarStageBackdropVariant();
  const skyMinutes = useSyncExternalStore(
    subscribeSkyClock,
    getSkyClockSnapshot,
    getSkyClockServerSnapshot,
  );
  const skyButtonTheme = stageBackdropVariant
    ? resolveCompactSkyButtonTheme(computeSkyScene(skyMinutes))
    : null;

  const escStopArmedChip =
    escStopArmed && canInterrupt && stopPhase !== "pending" ? (
      <span
        role="status"
        aria-live="polite"
        data-composer-esc-stop-armed="true"
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-destructive/35 bg-destructive/12 px-2.5 text-xs font-medium text-destructive select-none dark:border-destructive/45 dark:bg-destructive/20 [[data-pmx-glass='1']_&]:bg-destructive/18 dark:[[data-pmx-glass='1']_&]:bg-destructive/26"
      >
        <span>{actionCopy.escPrefix}</span>
        <Kbd variant="outline">Esc</Kbd>
        <span>{actionCopy.escSuffix}</span>
      </span>
    ) : null;

  const renderStopGenerationButton = (insidePendingAction: boolean) => (
    <StopGenerationButton
      key="interrupt"
      stopPhase={stopPhase}
      canOperateThread={canOperateThread}
      insidePendingAction={insidePendingAction}
      preserveComposerFocusOnPointerDown={preserveComposerFocusOnPointerDown}
      stopShortcutLabel={stopShortcutLabel}
      onStopRequested={() => setStopPhase("pending")}
      onInterrupt={onInterrupt}
    />
  );

  // Keep the clicked target at the right edge even if typing changes the primary action.
  const withStopButton = (action: ReactNode) => (
    <>
      {action}
      {stopPhase === "pending" || stopPhase === "timedOut"
        ? renderStopGenerationButton(false)
        : null}
    </>
  );

  if (pendingAction) {
    return (
      <div className={cn("flex items-center justify-end", compact ? "gap-1.5" : "gap-2")}>
        {pendingAction.questionIndex > 0 ? (
          compact ? (
            <Button
              size="icon-sm"
              variant="outline"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
              aria-label={gt("Previous question")}
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
            >
              {gt("Previous", { $context: "button that goes to the previous question" })}
            </Button>
          )
        ) : null}
        {children}
        <button
          type="submit"
          className={cn(messageActionPillClassName, "h-8 sm:h-7", compact ? "px-3" : "px-4")}
          {...pointerFocusProps}
          onClick={(event) => {
            if (stopPhase === "landed") event.preventDefault();
          }}
          disabled={
            !canOperateThread ||
            isEnvironmentUnavailable ||
            isSendDisabled ||
            pendingAction.isResponding ||
            (!voiceInputActive &&
              (pendingAction.isLastQuestion
                ? !pendingAction.isComplete
                : !pendingAction.canAdvance))
          }
        >
          {formatPendingPrimaryActionLabel(
            {
              compact,
              isLastQuestion: pendingAction.isLastQuestion,
              isResponding: pendingAction.isResponding,
              questionIndex: pendingAction.questionIndex,
            },
            m,
          )}
        </button>
        {canInterrupt || stopPhase === "pending" || stopPhase === "timedOut"
          ? renderStopGenerationButton(true)
          : null}
      </div>
    );
  }

  if (
    (canInterrupt || stopPhase === "pending" || stopPhase === "timedOut") &&
    !hasSendableContent &&
    !isEditingQueuedMessage &&
    !isSendHeld
  ) {
    const showEmptySteerQueueAction =
      !compact &&
      !escStopArmed &&
      isRunning &&
      canSteer &&
      queuedCount > 0 &&
      onSteerQueuedMessages !== undefined &&
      stopPhase !== "pending";
    return (
      <>
        {children}
        {escStopArmedChip}
        {showEmptySteerQueueAction ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  data-composer-steer-queue-action="true"
                  className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/80 bg-background/90 px-2.5 text-xs font-medium text-foreground shadow-2xs transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none dark:border-border/70 dark:bg-card/85 [[data-pmx-glass='1']_&]:border-white/16 [[data-pmx-glass='1']_&]:bg-background/88 dark:[[data-pmx-glass='1']_&]:bg-card/84"
                  style={STEER_PILL_STYLE}
                  {...pointerFocusProps}
                  onClick={() => onSteerQueuedMessages()}
                  aria-label={actionCopy.steerQueueAria(alternateShortcutLabel)}
                />
              }
            >
              <CornerUpRightIcon
                aria-hidden="true"
                className="size-3.5 shrink-0"
                style={ACCENT_ICON_STYLE}
              />
              <span>{actionCopy.steerQueueAction}</span>
              {compactAlternateShortcut ? (
                <Kbd variant="outline">{compactAlternateShortcut}</Kbd>
              ) : null}
            </TooltipTrigger>
            <TooltipPopup>
              {actionCopy.steerQueueTooltip(queuedCount, alternateShortcutLabel)}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        {renderStopGenerationButton(false)}
      </>
    );
  }

  const showResume = canResume && !hasSendableContent && !isEditingQueuedMessage;

  const compactTokens =
    compactBeforeSendTokens !== null && !showResume && !isEditingQueuedMessage
      ? formatContextWindowTokens(compactBeforeSendTokens)
      : null;
  const compactsBeforeSend = compactTokens !== null && !keepFullHistory;

  const submitLabel = showResume
    ? gt("Resume thread")
    : isEditingQueuedMessage
      ? gt("Update queued message")
      : compactsBeforeSend
        ? gt("Compact and send")
        : isQueuing
          ? gt("Queue message")
          : isRunning
            ? gt("Steer message")
            : gt("Submit message");
  const submitStatus = isEnvironmentUnavailable
    ? gt("Environment disconnected")
    : isSendHeld
      ? gt("Sending when ready")
      : (sendDisabledReason ??
        (isPreparingWorktree
          ? gt("Preparing worktree")
          : isSendBusy
            ? isEditingQueuedMessage
              ? gt("Updating queued message")
              : gt("Submitting message")
            : null));
  const runningDispatchTooltip = (
    <div
      data-composer-send-tooltip={isQueuing ? "queue" : "steer"}
      className="flex flex-col gap-0.5 text-left"
    >
      <div className="flex items-center gap-1.5 font-medium">
        <span>{isQueuing ? actionCopy.queueMessageHeading : actionCopy.sendNowHeading}</span>
        {isQueuing && sendShortcutLabel ? (
          <Kbd variant="outline">{sendShortcutLabel}</Kbd>
        ) : !isQueuing && alternateShortcutLabel ? (
          <Kbd variant="outline">{alternateShortcutLabel}</Kbd>
        ) : null}
      </div>
      {isQueuing && canSteer && alternateShortcutLabel ? (
        <div className="text-muted-foreground">
          {actionCopy.sendNowWithShortcut(alternateShortcutLabel)}
        </div>
      ) : !isQueuing && sendShortcutLabel ? (
        <div className="text-muted-foreground">
          {actionCopy.queueWithShortcut(sendShortcutLabel)}
        </div>
      ) : null}
    </div>
  );
  const idleSendTooltip = (
    <span className="inline-flex items-center gap-1.5">
      <span>{actionCopy.sendMessageHeading}</span>
      {sendShortcutLabel ? <Kbd variant="outline">{sendShortcutLabel}</Kbd> : null}
    </span>
  );
  const submitTooltip =
    submitStatus ??
    (compactsBeforeSend
      ? gt("Summarize {tokens} tokens of history, then send", { tokens: compactTokens })
      : showResume || isEditingQueuedMessage
        ? submitLabel
        : isRunning
          ? runningDispatchTooltip
          : idleSendTooltip);

  const isBusyOrHeld = isSendBusy || isSendHeld;
  const isPrimaryButtonDisabled =
    isBusyOrHeld ||
    isSendDisabled ||
    isEnvironmentUnavailable ||
    (!hasSendableContent && !showResume);
  const sendButton = (
    <button
      type={showResume ? "button" : "submit"}
      data-sky-button-tone={skyButtonTheme?.tone}
      data-composer-send-accent={
        !stageBackdropVariant && !isPrimaryButtonDisabled ? "true" : undefined
      }
      style={
        skyButtonTheme
          ? {
              color: skyButtonTheme.iconColor,
              backgroundColor: "transparent",
            }
          : !isPrimaryButtonDisabled
            ? ACCENT_SEND_BUTTON_STYLE
            : undefined
      }
      className={cn(
        "relative isolate flex h-9 w-9 items-center justify-center overflow-hidden rounded-full shadow-xs transition-all duration-150 enabled:cursor-pointer enabled:inset-shadow-control-highlight hover:scale-105 active:inset-shadow-control-pressed active:shadow-none disabled:pointer-events-none disabled:shadow-none disabled:hover:scale-100 motion-reduce:transition-none sm:h-8 sm:w-8 [&_svg]:pointer-events-none",
        stageBackdropVariant
          ? cn(
              "bg-transparent! enabled:shadow-black/24 enabled:hover:brightness-110 disabled:opacity-64",
              skyButtonTheme?.tone === "dark"
                ? "text-black! ring-1 ring-inset ring-black/12"
                : "text-white! ring-1 ring-inset ring-white/18",
            )
          : "bg-message-action text-message-action-foreground enabled:shadow-message-action/24 enabled:hover:brightness-110 enabled:active:brightness-95 disabled:bg-foreground/12 disabled:text-muted-foreground",
      )}
      {...pointerFocusProps}
      onClick={(event) => {
        if (stopPhase === "landed") {
          event.preventDefault();
          return;
        }
        if (showResume) onResume?.();
        else onSubmitMessage?.(event);
      }}
      disabled={isPrimaryButtonDisabled}
      aria-label={submitStatus ?? submitLabel}
      aria-busy={isBusyOrHeld || undefined}
    >
      {stageBackdropVariant ? (
        <span className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <StageBackdropButtonArt variant={stageBackdropVariant} />
        </span>
      ) : null}
      {isBusyOrHeld ? (
        <Spinner size="sm" aria-hidden="true" />
      ) : showResume ? (
        <PlayIcon className="size-4 fill-current" aria-hidden="true" />
      ) : isEditingQueuedMessage ? (
        <CheckIcon className="size-4" aria-hidden="true" />
      ) : (
        <ArrowRightIcon
          className="size-4"
          aria-hidden="true"
          data-composer-send-icon="arrow-right"
        />
      )}
    </button>
  );

  const showAlternateActionPill =
    !compact &&
    isRunning &&
    !isEditingQueuedMessage &&
    !showResume &&
    hasSendableContent &&
    canSteer &&
    !isBusyOrHeld &&
    !isSendDisabled &&
    !isEnvironmentUnavailable &&
    onAlternateSubmitMessage !== undefined;

  const alternateActionPill = showAlternateActionPill ? (
    <Tooltip key="alternate-dispatch">
      <TooltipTrigger
        render={
          <button
            type="button"
            data-composer-alternate-action={alternateAction}
            className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/80 bg-background/90 px-2.5 text-xs font-medium text-foreground shadow-2xs transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none dark:border-border/70 dark:bg-card/85 [[data-pmx-glass='1']_&]:border-white/16 [[data-pmx-glass='1']_&]:bg-background/88 dark:[[data-pmx-glass='1']_&]:bg-card/84"
            style={alternateAction === "steer" ? STEER_PILL_STYLE : undefined}
            {...pointerFocusProps}
            onClick={(event) => {
              if (stopPhase === "landed") {
                event.preventDefault();
                return;
              }
              onAlternateSubmitMessage(event);
            }}
            aria-label={
              alternateAction === "steer"
                ? actionCopy.steerNowAria(alternateShortcutLabel)
                : actionCopy.queueInsteadAria(alternateShortcutLabel)
            }
          />
        }
      >
        {alternateAction === "steer" ? (
          <CornerUpRightIcon
            aria-hidden="true"
            className="size-3.5 shrink-0"
            style={ACCENT_ICON_STYLE}
          />
        ) : (
          <ListPlusIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span>{alternateAction === "steer" ? actionCopy.steerAction : actionCopy.queueAction}</span>
        {compactAlternateShortcut ? <Kbd variant="outline">{compactAlternateShortcut}</Kbd> : null}
      </TooltipTrigger>
      <TooltipPopup>
        {alternateAction === "steer"
          ? actionCopy.steerNowTooltip(alternateShortcutLabel)
          : actionCopy.queueInsteadTooltip(alternateShortcutLabel)}
      </TooltipPopup>
    </Tooltip>
  ) : null;

  const submit = (
    <Tooltip key="submit">
      <TooltipTrigger render={<span className="inline-flex" />}>{sendButton}</TooltipTrigger>
      <TooltipPopup>{submitTooltip}</TooltipPopup>
    </Tooltip>
  );
  if (compactTokens === null || hideCompactToggle) {
    return withStopButton(
      <>
        {children}
        {escStopArmedChip}
        {alternateActionPill}
        {submit}
      </>,
    );
  }

  return withStopButton(
    <div data-chat-composer-compact-send="true" className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-(--control-radius) px-2 font-medium text-base text-foreground/80 tabular-nums outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64 sm:text-sm aria-pressed:bg-accent/60 aria-pressed:text-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:text-muted-foreground"
              {...pointerFocusProps}
              aria-pressed={!keepFullHistory}
              aria-label={gt("Compact {tokens} tokens of history before sending", {
                tokens: compactTokens,
              })}
              disabled={!canOperateThread}
              onClick={onToggleKeepFullHistory}
            />
          }
        >
          <Minimize2Icon aria-hidden="true" />
          <span className="@max-[480px]/composer-surface:hidden">
            {keepFullHistory
              ? gt("Keep", { $context: "keep full history instead of compacting" })
              : gt("Compact", { $context: "verb, compact history before sending" })}
          </span>
          <span className="text-muted-foreground">{compactTokens}</span>
        </TooltipTrigger>
        <TooltipPopup>
          <div>
            {keepFullHistory
              ? gt("Next send keeps all {tokens} tokens.", { tokens: compactTokens })
              : gt("Next send compacts {tokens} tokens first.", { tokens: compactTokens })}
          </div>
          <div>
            {keepFullHistory ? gt("Click to compact first") : gt("Click to keep full history")}
          </div>
        </TooltipPopup>
      </Tooltip>
      {children}
      {escStopArmedChip}
      {alternateActionPill}
      {submit}
    </div>,
  );
});
