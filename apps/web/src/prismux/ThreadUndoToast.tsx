import { useAtomValue } from "@effect/atom-react";
import { useGT, useMessages } from "gt-react";
import { Undo2Icon, XIcon } from "lucide-react";
import { memo } from "react";
import { createPortal } from "react-dom";

import { Button } from "../components/ui/button";
import { Kbd } from "../components/ui/kbd";
import {
  dismissThreadUndoNotice,
  THREAD_UNDO_NOTICE_TTL_MS,
  threadUndoLabel,
  threadUndoNoticeSummary,
  undoLatestThreadAction,
  useThreadUndoNotice,
  type ThreadUndoNotice,
} from "../hooks/showThreadUndoNotice";
import { shortcutLabelForCommand } from "../keybindings";
import { cn } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useUpdateNotifierState } from "./updates/updateNotifierStore";

export interface ThreadUndoToastCardProps {
  readonly notice: Pick<ThreadUndoNotice, "action" | "count" | "revision">;
  readonly summary: string;
  readonly undoHint: string;
  readonly undoButtonLabel: string;
  readonly dismissLabel: string;
  readonly shortcutLabel: string | null;
  readonly stackedAboveUpdateToast: boolean;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
}

/**
 * Pure bottom-right liquid-glass floating undo card styled 1:1 with `PrismuxUpdateToastCard`.
 * Exported directly so SSR/unit tests can verify markup, copy, and glass attributes cleanly.
 */
export const ThreadUndoToastCard = memo(function ThreadUndoToastCard({
  notice,
  summary,
  undoHint,
  undoButtonLabel,
  dismissLabel,
  shortcutLabel,
  stackedAboveUpdateToast,
  onUndo,
  onDismiss,
}: ThreadUndoToastCardProps) {
  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label={summary}
      data-testid="prismux-thread-undo-toast"
      data-undo-action={notice.action}
      data-undo-count={String(notice.count)}
      data-pmx-glass-zone="overlays"
      className={cn(
        "dialog-glass fixed right-4 z-50 w-82 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border p-3.5 text-popover-foreground shadow-2xl/45 transition-[opacity,transform,bottom] duration-200 ease-out starting:translate-y-3 starting:scale-95 starting:opacity-0 [-webkit-app-region:no-drag] motion-reduce:transition-none",
        stackedAboveUpdateToast
          ? "bottom-[calc(var(--pmx-status-bar-height,20px)+168px)]"
          : "bottom-[calc(var(--pmx-status-bar-height,20px)+12px)]",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/25"
        >
          <Undo2Icon className="size-3.5" />
        </span>

        <div className="min-w-0 flex-1 space-y-0.5 pr-6">
          <div className="truncate text-sm font-semibold tracking-tight text-foreground">
            {summary}
          </div>
          <p className="truncate text-xs leading-relaxed text-muted-foreground">{undoHint}</p>
        </div>

        <button
          type="button"
          data-testid="prismux-thread-undo-dismiss"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="absolute top-2.5 right-2.5 inline-flex size-6 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/10"
        >
          <XIcon className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/50 pt-2.5">
        <div className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
          {shortcutLabel ? <Kbd>{shortcutLabel}</Kbd> : null}
        </div>
        <Button
          type="button"
          size="xs"
          data-testid="prismux-thread-undo-action"
          onClick={onUndo}
        >
          <Undo2Icon className="size-3" aria-hidden="true" />
          <span>{undoButtonLabel}</span>
        </Button>
      </div>

      {/* Slim 5s expiry bar anchored along the bottom edge */}
      <div
        aria-hidden="true"
        data-testid="prismux-thread-undo-progress"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-border/35 motion-reduce:hidden"
      >
        <div
          key={notice.revision}
          className="h-full origin-left bg-primary/80"
          style={{
            animation: `prismux-undo-countdown ${THREAD_UNDO_NOTICE_TTL_MS}ms linear forwards`,
          }}
        />
      </div>
      <style>{`@keyframes prismux-undo-countdown { from { transform: scaleX(1); } to { transform: scaleX(0); } }`}</style>
    </aside>
  );
});

/**
 * Global bottom-right liquid-glass floating undo toast host mounted in `__root.tsx`.
 * Replaces the legacy inline sidebar footer undo strip so Settled / Snoozed / Unpinned /
 * Archived / Discarded undo actions remain cleanly visible even when the sidebar is collapsed.
 */
export const ThreadUndoToast = memo(function ThreadUndoToast() {
  const notice = useThreadUndoNotice((state) => state.notice);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const updateNotifier = useUpdateNotifierState();
  const messages = useMessages();
  const gt = useGT();

  const stackedAboveUpdateToast =
    updateNotifier.presentation === "toast" &&
    Boolean(
      updateNotifier.availableUpdate?.hasUpdate && updateNotifier.availableUpdate.latestVersion,
    );

  if (!notice || typeof document === "undefined") {
    return null;
  }

  const summary = threadUndoNoticeSummary(notice, messages);
  const undoHint = threadUndoLabel(keybindings, messages);
  const shortcutLabel = shortcutLabelForCommand(keybindings, "thread.undo");

  return createPortal(
    <ThreadUndoToastCard
      notice={notice}
      summary={summary}
      undoHint={undoHint}
      undoButtonLabel={gt("Undo")}
      dismissLabel={gt("Dismiss")}
      shortcutLabel={shortcutLabel}
      stackedAboveUpdateToast={stackedAboveUpdateToast}
      onUndo={() => {
        void undoLatestThreadAction();
      }}
      onDismiss={dismissThreadUndoNotice}
    />,
    document.body,
  );
});
