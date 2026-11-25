import { TimelinePendingApprovalRow } from "./TimelinePendingApprovalRow";
import { WorkLogDetails, WorkLogRow } from "./WorkLog";
import {
  getQuestionAnswerPreview,
  getQuestionAnswerText,
  getQuestionTextPreview,
  hasQuestionAnswer,
} from "@prismux/client-runtime/work-log/user-input";
import {
  ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
  type EnvironmentId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
  ThreadId,
} from "@prismux/core-contracts";
import { scopeThreadRef } from "@prismux/client-runtime/environment";
import { Link } from "@tanstack/react-router";
import { notificationChildThreadId } from "@prismux/client-runtime/state/thread-execution";
import {
  resolveViewedImageAsset,
  resolveWorkEntryToolPresentation,
  toolGroupAction,
  workEntryViewedImagePath,
} from "@prismux/client-runtime/work-log/presentation";
import { t3ToolResultIndicatesFailure } from "@prismux/client-runtime/t3ToolSummary";
import {
  isJsonToolText,
  toolCallLines,
  turnItemDetailRevision,
  turnItemHasDetail,
  turnItemNeedsDetailFetch,
  turnItemOutputImages,
  turnItemOutputText,
} from "@prismux/client-runtime/work-log/item-detail";
import { formatDiffCount } from "@prismux/client-runtime/diff-count";
import { claudeSkillInvocation, isJavaScriptReplTool } from "@prismux/core-shared/toolActivity";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import {
  memo,
  Suspense,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  workEntryDisplayIndicatesToolFailure,
  workEntrySignalsSevereFailure,
  workLogEntryIsToolLike,
} from "../../session-logic";
import ChatMarkdown from "../ChatMarkdown";
import { ChatMarkdownAssetImage } from "./ChatMarkdownMedia";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { workGroupImageGallery } from "./markdownImageGallery";
import { McpSignInAction } from "./McpSignInAction";
import * as DateTime from "effect/DateTime";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CopyIcon,
  FileDiffIcon,
  FolderIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { Button, InlineButton } from "../ui/button";
import { useAssetUrls } from "../../assets/assetUrls";
import { useRenderedAppearance } from "../../hooks/useTheme";
import { observeResize } from "../../lib/observeResize";
import { resolveDiffThemeName } from "../../lib/diffRendering";
import { getSyntaxHighlighterPromise } from "../../lib/syntaxHighlighting";
import { useThreadShell } from "../../state/entities";
import { useTurnItemDetail } from "../../state/queries";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import {
  threadReadTargetId,
  threadReadTargetTitle,
  workEntryDisplayLabel,
  workEntryReadOutput,
} from "./MessagesTimeline.logic";
import { cn } from "~/lib/utils";
import type { MessageResolver } from "~/i18n/messages";
import { LocalizedErrorCard } from "../../prismux/LocalizedErrorCard";
import {
  ReasoningTranslationBody,
  useReasoningTranslation,
} from "../../prismux/reasoningTranslation";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { AgyTodoChecklist } from "./AgyTodoChecklist";
import {
  extractTodoChecklistFromTurnItem,
  extractTodoChecklistFromWorkEntry,
} from "./AgyTodoChecklist.logic";
import { CommandOutputPanel, useCommandOutputStreaming } from "./CommandOutputPanel";
import { DshSearchBlock, DshWebBlock } from "./DshSearchBlocks";
import {
  isSearchTurnItem,
  isSearchWorkEntry,
  isWebTurnItem,
  isWebWorkEntry,
  normalizeSearchWorkEntry,
  normalizeWebWorkEntry,
} from "./DshSearchBlocks.logic";
import { SubagentNotificationLink } from "./V2LifecycleRow";
import {
  TimelineRowCtx,
  TimelineRowActivityCtx,
  WorkGroupViewCtx,
  useInitialOutputReady,
  type TimelineRow,
  type TimelineWorkEntry,
  type TurnItemSource,
} from "./timelineRowContext";
import { MESSAGE_HEADING_LEVEL, TimelineRowTimestamp } from "./TimelineRowParts";
import {
  failedToolIconClassName,
  toolIconAcceptsTint,
  ToolActivityIconView,
} from "./TimelineToolActivityIcon";
import {
  workToneIcon,
  workEntryRawCommand,
  buildToolCallExpandedBody,
  workEntryIconName,
} from "./TimelineWorkEntryRow.logic";
import {
  extractReadLineRangeLabel,
  extractReasoningSummaryLine,
  extractWorkStepCollapsedPreview,
  formatFileChangeAction,
  formatStepOutputHeader,
  formatThinkingHeaderLabel,
  formatWorkStepElapsedMs,
  getWorkStepCardCopy,
  localizeWorkStepLabel,
  parseCompactDiffPreview,
  resolveWorkEntryElapsedMs,
  splitDisplayFilePath,
  stripShellCommandWrapper,
  type FileChangeActionKind,
} from "./dshWorkSteps.logic";
import type { ToolCallDiffTarget } from "../../diffPanelStore";

const FROSTED_STEP_CARD_CLASS = cn(
  "mt-1 mb-1 ml-1 overflow-hidden rounded-lg border border-border/55 bg-background/84 text-foreground shadow-xs backdrop-blur-md",
  "[[data-pmx-glass='1']_&]:border-foreground/15 [[data-pmx-glass='1']_&]:bg-card/76",
  "[[data-pmx-glass='1']_&]:shadow-sm [[data-pmx-glass='1']_&]:ring-1 [[data-pmx-glass='1']_&]:ring-inset [[data-pmx-glass='1']_&]:ring-foreground/8",
  "[[data-pmx-glass='1']_&]:backdrop-blur-xl",
);

const STEP_MONO_CLASS =
  "font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed whitespace-pre-wrap break-words select-text";

const DEFAULT_OUTPUT_PREVIEW_LINES = 20;
const DEFAULT_DIFF_PREVIEW_LINES = 24;

/** Smooth CSS `grid-template-rows` (`0fr` <-> `1fr`) + opacity disclosure panel with lazy unmount when closed. */
export function SmoothDisclosure({
  open,
  id,
  className,
  innerClassName,
  onClick,
  onPointerDown,
  children,
}: {
  readonly open: boolean;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
  readonly innerClassName?: string | undefined;
  readonly onClick?: ((e: MouseEvent<HTMLDivElement>) => void) | undefined;
  readonly onPointerDown?: ((e: MouseEvent<HTMLDivElement>) => void) | undefined;
  readonly children: ReactNode;
}) {
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(open);
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setRendered(true);
      if (!rendered) {
        setVisible(false);
      }
    } else {
      setVisible(false);
    }
  }

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- coordinates two-frame CSS grid-template-rows reveal and post-transition unmount
  useEffect(() => {
    if (open) {
      if (visible) return;
      const raf = window.requestAnimationFrame(() => {
        setVisible(true);
      });
      return () => window.cancelAnimationFrame(raf);
    }
    if (!rendered) return;
    const timer = window.setTimeout(() => {
      setRendered(false);
    }, 210);
    return () => window.clearTimeout(timer);
  }, [open, rendered, visible]);

  if (!rendered) return null;

  return (
    <div
      id={id}
      data-disclosure-panel={visible ? "open" : "closing"}
      onClick={onClick}
      onPointerDown={onPointerDown}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        visible ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className={cn("min-h-0 overflow-hidden", innerClassName)}>{children}</div>
    </div>
  );
}

/** DSH leading 16px disclosure slot: idle icon crossfades to rotating ChevronDown on hover/focus/open. */
export function DshDisclosureLeadingSlot({
  icon,
  expandable,
  expanded,
  iconClassName,
  groupScope = "disclosure-row",
  role,
  ariaLabel,
  liveDot = false,
}: {
  readonly icon: ReactNode;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly iconClassName?: string | undefined;
  readonly groupScope?: "disclosure-row" | "timeline-row" | "live-work" | undefined;
  readonly role?: "img" | undefined;
  readonly ariaLabel?: string | undefined;
  readonly liveDot?: boolean | undefined;
}) {
  const hideOnHoverFocus =
    groupScope === "live-work"
      ? "group-hover/live-work:opacity-0 group-focus-visible/live-work:opacity-0"
      : groupScope === "timeline-row"
        ? "group-hover/timeline-row:opacity-0 group-focus-visible/timeline-row:opacity-0"
        : "group-hover/disclosure-row:opacity-0 group-focus-visible/disclosure-row:opacity-0";
  const showOnHoverFocus =
    groupScope === "live-work"
      ? "group-hover/live-work:opacity-100 group-focus-visible/live-work:opacity-100"
      : groupScope === "timeline-row"
        ? "group-hover/timeline-row:opacity-100 group-focus-visible/timeline-row:opacity-100"
        : "group-hover/disclosure-row:opacity-100 group-focus-visible/disclosure-row:opacity-100";

  return (
    <span
      data-disclosure-leading="true"
      className={cn(
        "relative inline-flex size-4 shrink-0 items-center justify-center",
        iconClassName,
      )}
      role={role}
      aria-label={ariaLabel}
    >
      {expandable ? (
        <>
          {!expanded ? (
            <span
              data-disclosure-icon-idle="true"
              className={cn(
                "inline-flex size-4 items-center justify-center opacity-100 transition-opacity duration-200 ease-out motion-reduce:transition-none",
                hideOnHoverFocus,
              )}
            >
              {icon}
            </span>
          ) : null}
          <span
            data-disclosure-chevron="true"
            data-disclosure-state={expanded ? "open" : "closed"}
            aria-hidden="true"
            className={cn(
              "inline-flex items-center justify-center text-foreground/85 transition-opacity duration-200 ease-out motion-reduce:transition-none",
              expanded
                ? "size-4 opacity-100"
                : cn("pointer-events-none absolute inset-0 opacity-0", showOnHoverFocus),
            )}
          >
            <ChevronDownIcon
              className={cn(
                "size-3.5 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none",
                expanded && "rotate-180",
              )}
            />
          </span>
        </>
      ) : (
        <span className="inline-flex size-4 items-center justify-center">{icon}</span>
      )}
      {liveDot && !expanded ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute -right-0.5 -bottom-0.5 size-1.5 animate-pulse rounded-full bg-primary ring-2 ring-background transition-opacity duration-200 motion-reduce:transition-none",
            expandable && hideOnHoverFocus,
          )}
        />
      ) : null}
    </span>
  );
}

export function useThreadReadTarget(entry: TimelineWorkEntry, environmentId: EnvironmentId) {
  const rawThreadId = threadReadTargetId(entry);
  const threadId = rawThreadId === null ? null : ThreadId.make(rawThreadId);
  const shell = useThreadShell(threadId ? scopeThreadRef(environmentId, threadId) : null);
  const title = threadReadTargetTitle(shell);
  return threadId && title ? { threadId, title } : null;
}

const THREAD_READ_STATUSES = ["inProgress", "completed", "failed", "declined", "stopped"] as const;
type ThreadReadStatus = (typeof THREAD_READ_STATUSES)[number];

// The label arrives resolved (or still English), so its status is found by resolving each one.
function threadReadStatus(
  label: string,
  entry: TimelineWorkEntry,
  resolve: MessageResolver,
): ThreadReadStatus | null {
  const payload = entry.structuredPayload;
  if (payload?.type !== "dynamic_tool") return null;
  if (t3ToolResultIndicatesFailure(payload.output)) return "failed";
  for (const resolver of [resolve, undefined]) {
    for (const status of THREAD_READ_STATUSES) {
      const presentation = resolveWorkEntryToolPresentation(
        { ...entry, toolLifecycleStatus: status },
        undefined,
        resolver,
      );
      if (presentation?.displayName === label) return status;
    }
  }
  return null;
}

export function threadReadLabel(
  label: string,
  entry: TimelineWorkEntry,
  target: ReturnType<typeof useThreadReadTarget>,
  resolve: MessageResolver,
) {
  const status = target && threadReadStatus(label, entry, resolve);
  if (!target || !status) return null;
  return {
    ...target,
    status,
    text: resolve(
      msg(
        "{status, select, inProgress {Reading thread “{title}”} completed {Read thread “{title}”} failed {Failed to read thread “{title}”} declined {Declined to read thread “{title}”} stopped {Stopped reading thread “{title}”} other {Reading thread “{title}”}}",
        { status, title: target.title },
      ),
    ),
  };
}

export function ThreadReadLabel({
  label,
  environmentId,
  linked,
}: {
  label: NonNullable<ReturnType<typeof threadReadLabel>>;
  environmentId: EnvironmentId;
  linked: boolean;
}) {
  const title = linked ? (
    <Link
      to="/$environmentId/$threadId"
      params={{ environmentId, threadId: label.threadId }}
      className="min-w-0 truncate rounded-sm text-foreground underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
      onClick={stopRowToggle}
      onKeyDown={stopRowToggle}
    >
      {label.title}
    </Link>
  ) : (
    <span className="min-w-0 truncate">{label.title}</span>
  );
  return (
    <span className="flex min-w-0">
      {label.status === "completed" ? (
        <T>
          <span className="shrink-0">Read thread “</span>
          <Var>{title}</Var>
          <span className="shrink-0">”</span>
        </T>
      ) : label.status === "failed" ? (
        <T>
          <span className="shrink-0">Failed to read thread “</span>
          <Var>{title}</Var>
          <span className="shrink-0">”</span>
        </T>
      ) : label.status === "declined" ? (
        <T>
          <span className="shrink-0">Declined to read thread “</span>
          <Var>{title}</Var>
          <span className="shrink-0">”</span>
        </T>
      ) : label.status === "stopped" ? (
        <T>
          <span className="shrink-0">Stopped reading thread “</span>
          <Var>{title}</Var>
          <span className="shrink-0">”</span>
        </T>
      ) : (
        <T>
          <span className="shrink-0">Reading thread “</span>
          <Var>{title}</Var>
          <span className="shrink-0">”</span>
        </T>
      )}
    </span>
  );
}

const stopRowToggle = (e: { stopPropagation: () => void }) => e.stopPropagation();

function useCopyTextButton() {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const copy = (text: string) => {
    if (!text) return;
    void navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setCopied(false);
    }, 1500);
  };
  return { copied, copy };
}

function StepCopyButton({
  text,
  label,
  copiedLabel,
}: {
  readonly text: string;
  readonly label: string;
  readonly copiedLabel: string;
}) {
  const { copied, copy } = useCopyTextButton();
  return (
    <button
      type="button"
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        copy(text);
      }}
      aria-label={copied ? copiedLabel : label}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border/50 bg-background/70 px-1.5 py-0.5 text-2xs font-medium text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:border-primary/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 [[data-pmx-glass='1']_&]:border-foreground/15 [[data-pmx-glass='1']_&]:bg-card/65",
        copied && "border-success/35 bg-success/12 text-success-foreground",
      )}
    >
      {copied ? (
        <CheckIcon aria-hidden="true" className="size-3 shrink-0" />
      ) : (
        <CopyIcon aria-hidden="true" className="size-3 shrink-0" />
      )}
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}

function SyntaxTokens({
  text,
  language,
}: {
  readonly text: string;
  readonly language: "json" | "typescript" | "html";
}) {
  const resolvedTheme = useRenderedAppearance();
  const highlighter = use(getSyntaxHighlighterPromise(language));
  const { tokens } = highlighter.codeToTokens(text, {
    lang: language,
    theme: resolveDiffThemeName(resolvedTheme),
  });
  return tokens.flatMap((line, lineIndex) => [
    lineIndex > 0 ? "\n" : "",
    ...line.map((token) => (
      <span key={token.offset} style={{ color: token.color }}>
        {token.content}
      </span>
    )),
  ]);
}

function ExpandableCodeBlock({
  text,
  highlightJson = false,
  language,
  maxPreviewLines = DEFAULT_OUTPUT_PREVIEW_LINES,
  locale,
}: {
  readonly text: string;
  readonly highlightJson?: boolean;
  readonly language?: "json" | "typescript" | "html";
  readonly maxPreviewLines?: number;
  readonly locale?: string | undefined;
}) {
  const [showAll, setShowAll] = useState(false);
  const copy = getWorkStepCardCopy(locale);
  const allLines = text.split(/\r?\n/u);
  const isLong = allLines.length > maxPreviewLines;
  const visibleText = isLong && !showAll ? allLines.slice(0, maxPreviewLines).join("\n") : text;
  const isJson = !isLong && highlightJson && isJsonToolText(visibleText);
  const activeLanguage = language ?? (isJson ? "json" : undefined);

  return (
    <div className="space-y-1.5">
      <pre
        className={cn(
          "max-h-56 overflow-auto text-foreground/90",
          STEP_MONO_CLASS,
        )}
      >
        {activeLanguage ? (
          <RenderErrorBoundary fallback={visibleText}>
            <Suspense fallback={visibleText}>
              <SyntaxTokens text={visibleText} language={activeLanguage} />
            </Suspense>
          </RenderErrorBoundary>
        ) : (
          visibleText
        )}
      </pre>
      {isLong ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setShowAll((prev) => !prev);
          }}
          className="cursor-pointer text-2xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
        >
          {showAll
            ? copy.showLessOutput
            : `${copy.showAllPrefix}${allLines.length}${copy.linesSuffix}`}
        </button>
      ) : null}
    </div>
  );
}

function fileChangeActionPillClass(kind: FileChangeActionKind): string {
  switch (kind) {
    case "add":
      return "border-success/35 bg-success/12 text-success-foreground";
    case "delete":
      return "border-destructive/35 bg-destructive/12 text-destructive";
    case "rename":
      return "border-warning/35 bg-warning/12 text-warning-foreground";
    case "edit":
      return "border-primary/35 bg-primary/14 text-primary";
  }
}

export function ReasoningTraceContent({ entries }: { entries: ReadonlyArray<TimelineWorkEntry> }) {
  const ctx = use(TimelineRowCtx);
  const { isWorking, latestRunId } = use(TimelineRowActivityCtx);
  const isStreaming = (entry: TimelineWorkEntry) =>
    isWorking && entry.runId === latestRunId && entry.toolLifecycleStatus === "inProgress";
  return (
    <div
      data-reasoning-trace-content="true"
      className="flex min-w-0 flex-col gap-2.5 text-xs leading-relaxed text-foreground/85 select-text"
    >
      {entries.map((entry) => {
        const streaming = isStreaming(entry);
        return (
          <ReasoningTranslationBody
            key={entry.id}
            text={entry.detail ?? ""}
            running={streaming}
            renderContent={(displayText) => (
              <ChatMarkdown
                className="text-foreground/85"
                text={displayText}
                cwd={ctx.markdownCwd}
                threadRef={ctx.threadRef ?? undefined}
                skills={ctx.skills}
                isStreaming={streaming}
                headingLevelOffset={MESSAGE_HEADING_LEVEL}
                onUseArtifactTemplate={ctx.onUseArtifactTemplate}
                onImageExpand={ctx.onImageExpand}
                lineBreaks
              />
            )}
          />
        );
      })}
    </div>
  );
}

function DshReasoningWorkEntryRow({
  workEntry,
  expanded,
  isReasoningLive,
  settledReasoningPreview,
  reasoningTitleLabel,
  canExpandProjectedItem,
  detailsId,
  labelRef,
  toggleExpanded,
  handleRowKeyDown,
  stopRowToggle,
}: {
  readonly workEntry: TimelineWorkEntry;
  readonly expanded: boolean;
  readonly isReasoningLive: boolean;
  readonly settledReasoningPreview: boolean;
  readonly reasoningTitleLabel: string;
  readonly canExpandProjectedItem: boolean;
  readonly detailsId: string;
  readonly labelRef: React.RefObject<HTMLSpanElement | null>;
  readonly toggleExpanded: () => void;
  readonly handleRowKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  readonly stopRowToggle: (e: MouseEvent<HTMLDivElement>) => void;
}) {
  const previewTranslation = useReasoningTranslation({
    text: workEntry.detail ?? "",
    running: isReasoningLive,
    enabled: !expanded,
  });
  const previewSourceText =
    previewTranslation.enabled && previewTranslation.translatedFragmentCount > 0
      ? previewTranslation.displayText
      : workEntry.detail;
  const reasoningSummaryLine = extractReasoningSummaryLine(previewSourceText, {
    live: isReasoningLive,
    settledReasoningPreview,
  });
  const accessibleLabel = reasoningSummaryLine
    ? `${reasoningTitleLabel} · ${reasoningSummaryLine}`
    : reasoningTitleLabel;

  return (
    <div
      data-work-entry-id={workEntry.id}
      data-v2-item-type={workEntry.projectedItem?.item.type}
      data-v2-item-visibility={workEntry.projectedItem?.visibility}
      data-reasoning-row="true"
      data-reasoning-expanded={String(expanded)}
      data-state={isReasoningLive ? "running" : "ok"}
      data-preview={!expanded && Boolean(reasoningSummaryLine) ? "true" : undefined}
      onClick={canExpandProjectedItem ? toggleExpanded : undefined}
      className="flex w-full min-w-0 flex-col"
    >
      <div
        data-disclosure-header="true"
        data-open={expanded ? "true" : undefined}
        className={cn(
          "flex min-w-0 items-center",
          expanded &&
            "sticky top-0 z-10 bg-background/95 [[data-pmx-glass='1']_&]:bg-card/85 [[data-pmx-glass='1']_&]:backdrop-blur-md",
        )}
      >
        <div
          data-disclosure-row="true"
          data-expandable={canExpandProjectedItem ? "true" : undefined}
          role={canExpandProjectedItem ? "button" : undefined}
          tabIndex={canExpandProjectedItem ? 0 : undefined}
          aria-label={canExpandProjectedItem ? accessibleLabel : undefined}
          aria-expanded={canExpandProjectedItem ? expanded : undefined}
          aria-controls={canExpandProjectedItem ? detailsId : undefined}
          onKeyDown={canExpandProjectedItem ? handleRowKeyDown : undefined}
          className={cn(
            "group/disclosure-row relative flex h-6 min-w-0 flex-1 items-center overflow-hidden rounded-md text-left text-muted-foreground transition-colors duration-200 ease-out select-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 motion-reduce:transition-none",
            canExpandProjectedItem && "cursor-pointer",
          )}
        >
          <DshDisclosureLeadingSlot
            icon={
              <ToolActivityIconView
                icon={undefined}
                fallbackName="brain"
                className="block size-3.5 shrink-0 stroke-2"
                muted={!isReasoningLive}
              />
            }
            expandable={canExpandProjectedItem}
            expanded={expanded}
            groupScope="disclosure-row"
            iconClassName={cn("mr-1.5", isReasoningLive ? "text-primary" : "text-inherit")}
            liveDot={isReasoningLive}
          />
          <span
            ref={labelRef}
            className="flex min-w-0 flex-1 items-center overflow-hidden text-xs leading-6"
          >
            <span
              className={cn(
                "shrink-0 font-normal",
                isReasoningLive ? "text-primary" : "text-inherit",
              )}
            >
              {reasoningTitleLabel}
            </span>
            {!expanded && reasoningSummaryLine ? (
              <>
                <span
                  aria-hidden="true"
                  data-reasoning-separator="true"
                  className="mx-2 size-0.5 shrink-0 rounded-full bg-muted-foreground/60"
                />
                <span
                  data-reasoning-summary-preview="true"
                  data-streaming={isReasoningLive ? "true" : undefined}
                  className={cn(
                    "min-w-0 flex-1 overflow-hidden whitespace-nowrap text-xs leading-5 text-muted-foreground/85",
                    isReasoningLive &&
                      "live-tool-shine [mask-image:linear-gradient(to_right,black_calc(100%-48px),transparent)]",
                  )}
                >
                  <span
                    className={cn(
                      "block",
                      isReasoningLive
                        ? "overflow-visible text-clip"
                        : "overflow-hidden text-ellipsis",
                    )}
                  >
                    {reasoningSummaryLine}
                  </span>
                </span>
              </>
            ) : null}
          </span>
        </div>
      </div>
      <SmoothDisclosure
        open={expanded}
        id={detailsId}
        onClick={stopRowToggle}
        onPointerDown={stopRowToggle}
      >
        <div
          data-reasoning-body="true"
          className="min-w-0 py-1 pl-5.5 text-xs leading-relaxed text-foreground/85 select-text"
        >
          <ReasoningTraceContent entries={[workEntry]} />
        </div>
      </SmoothDisclosure>
    </div>
  );
}

interface ResolvedDetailItem {
  readonly item: OrchestrationV2TurnItem;
  readonly outputText: string | null;
  readonly outputImages: ReturnType<typeof turnItemOutputImages>;
  readonly pending: boolean;
  readonly error: string | null;
  readonly empty: boolean;
}

function useResolvedTurnItemDetail(
  projectedItem: OrchestrationV2ProjectedTurnItem,
  environmentId: EnvironmentId,
  source: TurnItemSource | undefined,
  skip = false,
): ResolvedDetailItem {
  const gt = useGT();
  const wireItem = projectedItem.item;
  const needsFileChangeDiffFetch =
    wireItem.type === "file_change" &&
    wireItem.diffStr === undefined &&
    wireItem.oldStr === undefined &&
    wireItem.newStr === undefined;
  const fetches = !skip && (turnItemNeedsDetailFetch(wireItem) || needsFileChangeDiffFetch);
  const detail = useTurnItemDetail(
    fetches
      ? {
          environmentId,
          threadId: projectedItem.sourceThreadId,
          itemId: projectedItem.sourceItemId,
          revision: turnItemDetailRevision(wireItem),
        }
      : null,
    source?.detail,
  );
  const fetchedItem = detail.data?.item;
  const item = fetchedItem?.type === wireItem.type ? fetchedItem : wireItem;
  return {
    item,
    outputText: turnItemOutputText(item),
    outputImages: turnItemOutputImages(item),
    pending: item === wireItem && detail.isPending,
    error:
      item !== wireItem
        ? null
        : detail.data?.item === null
          ? needsFileChangeDiffFetch
            ? null
            : gt("Output is no longer available.")
          : detail.error
            ? String(detail.error)
            : null,
    empty: fetches && item !== wireItem,
  };
}

function CommandExecutionDetailCard({
  rawCommand,
  cwd,
  workspaceRoot,
  exitCode,
  isRunning,
  isFailed,
  elapsedLabel,
  streamsOutput,
  projectedItem,
  environmentId,
  source,
  outputText,
  pending,
  error,
  empty,
  onInitialOutputReady,
  locale,
}: {
  readonly rawCommand: string;
  readonly cwd?: string | null | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly exitCode?: number | undefined;
  readonly isRunning: boolean;
  readonly isFailed: boolean;
  readonly elapsedLabel: string | null;
  readonly streamsOutput: boolean;
  readonly projectedItem?: OrchestrationV2ProjectedTurnItem | undefined;
  readonly environmentId: EnvironmentId;
  readonly source?: TurnItemSource | undefined;
  readonly outputText: string | null;
  readonly pending: boolean;
  readonly error: string | null;
  readonly empty: boolean;
  readonly onInitialOutputReady?: (() => void) | undefined;
  readonly locale?: string | undefined;
}) {
  const [showRawCommand, setShowRawCommand] = useState(false);
  const copy = getWorkStepCardCopy(locale);
  const stripped = stripShellCommandWrapper(rawCommand);
  const commandForDisplay = stripped.displayCommand || rawCommand.trim();
  const displayCwd = cwd?.trim() ? formatWorkspaceRelativePath(cwd.trim(), workspaceRoot) : null;
  const outputLinesCount = outputText ? outputText.split(/\r?\n/u).length : 0;

  return (
    <div
      data-v2-item-inspector="command_execution"
      data-step-detail-card="command_execution"
      className={FROSTED_STEP_CARD_CLASS}
    >
      {/* Command bar */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/45 bg-muted/40 px-3 py-2 [[data-pmx-glass='1']_&]:border-foreground/12 [[data-pmx-glass='1']_&]:bg-foreground/[0.04]">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-0.5 shrink-0 select-none font-mono text-xs font-semibold text-primary"
          >
            $
          </span>
          <code className={cn("min-w-0 flex-1 text-foreground", STEP_MONO_CLASS)}>
            {commandForDisplay}
          </code>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {stripped.wasWrapped ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setShowRawCommand((prev) => !prev);
              }}
              className={cn(
                "cursor-pointer rounded-md border border-border/50 bg-background/70 px-1.5 py-0.5 text-2xs font-medium text-muted-foreground transition-colors hover:border-primary/45 hover:text-foreground [[data-pmx-glass='1']_&]:border-foreground/15 [[data-pmx-glass='1']_&]:bg-card/65",
                showRawCommand && "border-primary/45 text-primary",
              )}
            >
              {showRawCommand ? copy.hideRawCommand : copy.rawCommand}
            </button>
          ) : null}
          <StepCopyButton
            text={showRawCommand ? stripped.rawCommand : commandForDisplay}
            label={copy.copyCommand}
            copiedLabel={copy.copied}
          />
        </div>
      </div>

      {/* Optional raw shell wrapper disclosure */}
      <SmoothDisclosure open={showRawCommand && stripped.wasWrapped}>
        <div className="border-b border-border/40 bg-muted/25 px-3 py-1.5 [[data-pmx-glass='1']_&]:border-foreground/10 [[data-pmx-glass='1']_&]:bg-foreground/[0.03]">
          <div className="mb-0.5 text-3xs font-medium uppercase tracking-wide text-muted-foreground">
            {copy.rawInvocation}
          </div>
          <code className={cn("block text-muted-foreground", STEP_MONO_CLASS)}>
            {stripped.rawCommand}
          </code>
        </div>
      </SmoothDisclosure>

      {/* Status + cwd metadata bar */}
      {displayCwd || exitCode !== undefined || elapsedLabel || isRunning ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/35 px-3 py-1.5 text-2xs text-muted-foreground [[data-pmx-glass='1']_&]:border-foreground/10">
          {isRunning ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/14 px-2 py-0.5 font-medium text-primary">
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
              {copy.executing}
            </span>
          ) : exitCode !== undefined ? (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 font-mono font-medium tabular-nums",
                exitCode === 0
                  ? "border-success/35 bg-success/12 text-success-foreground"
                  : "border-destructive/35 bg-destructive/12 text-destructive",
              )}
            >
              {`${copy.exitPrefix}${exitCode}`}
            </span>
          ) : isFailed ? (
            <span className="inline-flex items-center rounded-full border border-destructive/35 bg-destructive/12 px-2 py-0.5 font-medium text-destructive">
              {copy.failed}
            </span>
          ) : null}
          {elapsedLabel ? (
            <span className="font-mono tabular-nums text-muted-foreground">{elapsedLabel}</span>
          ) : null}
          {displayCwd ? (
            <span className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-muted-foreground">
              <FolderIcon aria-hidden="true" className="size-3 shrink-0 opacity-75" />
              <span className="truncate">{displayCwd}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Output region */}
      <div className="px-3 py-2">
        {streamsOutput && projectedItem ? (
          <div className={cn("text-foreground/90", STEP_MONO_CLASS)}>
            <CommandOutputPanel
              onInitialOutputReady={onInitialOutputReady}
              environmentId={environmentId}
              threadId={projectedItem.sourceThreadId}
              itemId={projectedItem.sourceItemId}
              source={source?.commandOutput}
            />
          </div>
        ) : outputText ? (
          isFailed ? (
            <LocalizedErrorCard error={outputText} compact />
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
                <span>{formatStepOutputHeader(outputLinesCount, locale)}</span>
                <StepCopyButton
                  text={outputText}
                  label={copy.copyOutput}
                  copiedLabel={copy.copied}
                />
              </div>
              <ExpandableCodeBlock text={outputText} locale={locale} />
            </div>
          )
        ) : pending ? (
          <div className="text-xs italic text-muted-foreground">{copy.loadingOutput}</div>
        ) : error ? (
          <LocalizedErrorCard error={error} compact />
        ) : empty ? (
          <div className="text-xs italic text-muted-foreground">{copy.noOutput}</div>
        ) : null}
      </div>
    </div>
  );
}

function FileChangeDetailCard({
  item,
  projectedItem,
  workspaceRoot,
  onOpenToolDiff,
  locale,
}: {
  readonly item: Extract<OrchestrationV2TurnItem, { readonly type: "file_change" }>;
  readonly projectedItem: OrchestrationV2ProjectedTurnItem;
  readonly workspaceRoot?: string | undefined;
  readonly onOpenToolDiff?: ((target: ToolCallDiffTarget) => void) | undefined;
  readonly locale?: string | undefined;
}) {
  const [showAllDiff, setShowAllDiff] = useState(false);
  const copy = getWorkStepCardCopy(locale);
  const relativePath = formatWorkspaceRelativePath(item.fileName, workspaceRoot);
  const primaryOperation = item.changes?.[0]?.operation;
  const action = formatFileChangeAction(primaryOperation, locale);
  const parsedDiff = parseCompactDiffPreview({
    diffStr: item.diffStr,
    oldStr: item.oldStr,
    newStr: item.newStr,
  });
  const additions = item.additions ?? parsedDiff?.additions;
  const deletions = item.deletions ?? parsedDiff?.deletions;
  const visibleDiffLines =
    parsedDiff && !showAllDiff
      ? parsedDiff.lines.slice(0, DEFAULT_DIFF_PREVIEW_LINES)
      : (parsedDiff?.lines ?? []);
  const hasMoreDiffLines =
    parsedDiff !== null && parsedDiff.totalLines > DEFAULT_DIFF_PREVIEW_LINES;

  return (
    <div
      data-v2-item-inspector="file_change"
      data-step-detail-card="file_change"
      className={FROSTED_STEP_CARD_CLASS}
    >
      {/* File summary header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/45 bg-muted/40 px-3 py-2 [[data-pmx-glass='1']_&]:border-foreground/12 [[data-pmx-glass='1']_&]:bg-foreground/[0.04]">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-2xs font-medium leading-none",
              fileChangeActionPillClass(action.kind),
            )}
          >
            {action.label}
          </span>
          <span className="min-w-0 truncate font-mono text-xs font-medium text-foreground">
            {relativePath}
          </span>
          {additions !== undefined || deletions !== undefined ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-2xs font-medium tabular-nums">
              <span className="text-diff-addition-foreground">
                +{formatDiffCount(additions ?? 0)}
              </span>
              <span className="text-diff-deletion-foreground">
                -{formatDiffCount(deletions ?? 0)}
              </span>
            </span>
          ) : null}
        </div>
        {onOpenToolDiff ? (
          <Button
            size="xs"
            variant="outline"
            className="shrink-0"
            onClick={(event) => {
              event.stopPropagation();
              onOpenToolDiff({
                threadId: projectedItem.sourceThreadId,
                itemId: projectedItem.sourceItemId,
                revision: turnItemDetailRevision(item),
              });
            }}
          >
            <FileDiffIcon aria-hidden="true" className="size-3" />
            <T>Open diff</T>
          </Button>
        ) : null}
      </div>

      {/* Multi-file change list (if >1 file) */}
      {item.changes !== undefined && item.changes.length > 1 ? (
        <ul className="space-y-1 border-b border-border/35 px-3 py-2 font-mono text-xs [[data-pmx-glass='1']_&]:border-foreground/10">
          {item.changes.map((change) => {
            const changeAction = formatFileChangeAction(change.operation, locale);
            return (
              <li
                key={JSON.stringify([change.operation, change.oldPath, change.path])}
                className="flex flex-wrap items-center gap-1.5 text-foreground/85"
              >
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center rounded border px-1 py-0.5 text-3xs font-medium leading-none",
                    fileChangeActionPillClass(changeAction.kind),
                  )}
                >
                  {changeAction.label}
                </span>
                <span className="min-w-0 truncate">
                  {change.oldPath
                    ? `${formatWorkspaceRelativePath(change.oldPath, workspaceRoot)} → `
                    : ""}
                  {formatWorkspaceRelativePath(change.path, workspaceRoot)}
                </span>
                {change.fileType || change.mimeType ? (
                  <span className="text-2xs text-muted-foreground">
                    ({[change.fileType, change.mimeType].filter(Boolean).join(", ")})
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Inline diff/patch preview */}
      {item.status === "failed" && item.diffStr?.trim() ? (
        <div className="px-3 py-2">
          <LocalizedErrorCard error={item.diffStr} compact />
        </div>
      ) : parsedDiff ? (
        <div className="py-1.5">
          <div className="max-h-72 overflow-auto font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed select-text">
            {visibleDiffLines.map((line, idx) => (
              <div
                // oxlint-disable-next-line react/no-array-index-key -- parsed diff snapshot is immutable per item revision
                key={idx}
                className={cn(
                  "flex min-w-0 px-3 py-px",
                  line.kind === "add" && "bg-diff-addition/12 text-diff-addition-foreground",
                  line.kind === "del" && "bg-diff-deletion/12 text-diff-deletion-foreground",
                  line.kind === "hunk" &&
                    "bg-muted/45 font-medium text-primary [[data-pmx-glass='1']_&]:bg-foreground/[0.05]",
                  line.kind === "meta" && "italic text-muted-foreground",
                  line.kind === "context" && "text-foreground/85",
                )}
              >
                <span
                  aria-hidden="true"
                  className="mr-2 w-8 shrink-0 select-none text-right tabular-nums text-muted-foreground/70"
                >
                  {line.kind === "add"
                    ? (line.newLine ?? "")
                    : line.kind === "del"
                      ? (line.oldLine ?? "")
                      : line.kind === "context"
                        ? (line.newLine ?? line.oldLine ?? "")
                        : ""}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "mr-1.5 w-3 shrink-0 select-none font-semibold",
                    line.kind === "add" && "text-diff-addition-foreground",
                    line.kind === "del" && "text-diff-deletion-foreground",
                  )}
                >
                  {line.kind === "hunk" ? "" : line.prefix}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                  {line.text}
                </span>
              </div>
            ))}
          </div>
          {hasMoreDiffLines ? (
            <div className="border-t border-border/35 px-3 pt-1.5 [[data-pmx-glass='1']_&]:border-foreground/10">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowAllDiff((prev) => !prev);
                }}
                className="cursor-pointer text-2xs font-medium text-primary hover:underline"
              >
                {showAllDiff
                  ? copy.showLessPreview
                  : `${copy.showAllPrefix}${parsedDiff.totalLines}${copy.diffLinesSuffix}`}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          {`${action.label} ${relativePath}${onOpenToolDiff ? copy.openDiffNote : ""}`}
        </div>
      )}
    </div>
  );
}

function FrostedV2StepInspector({
  projectedItem,
  environmentId,
  cwd,
  workspaceRoot,
  onOpenToolDiff,
  onImageExpand,
  source,
  onInitialOutputReady,
  elapsedLabel,
  isRunning,
  isFailed,
  locale,
  toolDataCwd,
}: {
  readonly projectedItem: OrchestrationV2ProjectedTurnItem;
  readonly environmentId: EnvironmentId;
  readonly cwd?: string | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly onOpenToolDiff?: ((target: ToolCallDiffTarget) => void) | undefined;
  readonly onImageExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
  readonly source?: TurnItemSource | undefined;
  readonly onInitialOutputReady?: (() => void) | undefined;
  readonly elapsedLabel: string | null;
  readonly isRunning: boolean;
  readonly isFailed: boolean;
  readonly locale?: string | undefined;
  readonly toolDataCwd?: string | null | undefined;
}) {
  const gt = useGT();
  const copy = getWorkStepCardCopy(locale);
  const environmentStreamsOutput = useCommandOutputStreaming(environmentId);
  const streamsOutput =
    (source === undefined ? environmentStreamsOutput : source.commandOutput !== undefined) &&
    projectedItem.item.type === "command_execution";
  const detail = useResolvedTurnItemDetail(projectedItem, environmentId, source, streamsOutput);
  const { item } = detail;
  useInitialOutputReady(streamsOutput || detail.pending, onInitialOutputReady);

  if (item.type === "command_execution") {
    return (
      <CommandExecutionDetailCard
        rawCommand={item.input}
        cwd={toolDataCwd}
        workspaceRoot={workspaceRoot}
        exitCode={item.exitCode}
        isRunning={isRunning}
        isFailed={isFailed}
        elapsedLabel={elapsedLabel}
        streamsOutput={streamsOutput}
        projectedItem={projectedItem}
        environmentId={environmentId}
        source={source}
        outputText={detail.outputText}
        pending={detail.pending}
        error={detail.error}
        empty={detail.empty}
        onInitialOutputReady={onInitialOutputReady}
        locale={locale}
      />
    );
  }

  if (item.type === "file_change") {
    return (
      <FileChangeDetailCard
        item={item}
        projectedItem={projectedItem}
        workspaceRoot={workspaceRoot}
        onOpenToolDiff={onOpenToolDiff}
        locale={locale}
      />
    );
  }

  if (item.type === "file_search" || isSearchTurnItem(item)) {
    if (detail.pending && !detail.outputText && item.type === "dynamic_tool") {
      return (
        <div
          data-v2-item-inspector="file_search"
          data-step-detail-card="file_search"
          className={cn(FROSTED_STEP_CARD_CLASS, "px-3 py-2 text-xs italic text-muted-foreground")}
        >
          {copy.loadingOutput}
        </div>
      );
    }
    if (detail.error && !detail.outputText) {
      return (
        <div
          data-v2-item-inspector="file_search"
          data-step-detail-card="file_search"
          className={cn(FROSTED_STEP_CARD_CLASS, "px-3 py-2")}
        >
          <LocalizedErrorCard error={detail.error} compact />
        </div>
      );
    }
    return (
      <DshSearchBlock
        item={item}
        workspaceRoot={workspaceRoot}
        outputText={detail.outputText ?? undefined}
      />
    );
  }

  if (item.type === "web_search" || isWebTurnItem(item)) {
    if (detail.pending && !detail.outputText && item.type === "dynamic_tool") {
      return (
        <div
          data-v2-item-inspector="web_search"
          data-step-detail-card="web_search"
          className={cn(FROSTED_STEP_CARD_CLASS, "px-3 py-2 text-xs italic text-muted-foreground")}
        >
          {copy.loadingOutput}
        </div>
      );
    }
    if (detail.error && !detail.outputText) {
      return (
        <div
          data-v2-item-inspector="web_search"
          data-step-detail-card="web_search"
          className={cn(FROSTED_STEP_CARD_CLASS, "px-3 py-2")}
        >
          <LocalizedErrorCard error={detail.error} compact />
        </div>
      );
    }
    return (
      <DshWebBlock
        item={item}
        outputText={detail.outputText ?? undefined}
        renderMarkdown={(md) => (
          <ChatMarkdown
            text={md}
            cwd={cwd}
            threadRef={{ environmentId, threadId: projectedItem.sourceThreadId }}
            lineBreaks
          />
        )}
      />
    );
  }

  if (
    item.type === "todo_list" ||
    (item.type === "dynamic_tool" && extractTodoChecklistFromTurnItem(item) !== null)
  ) {
    return <AgyTodoChecklist variant="inline" turnItem={item} defaultOpen />;
  }

  if (item.type === "dynamic_tool") {
    const call = toolCallLines({ args: item.input });
    const hasInputSection = Boolean(call.args || call.argsText);
    const hasOutputSection = Boolean(
      detail.outputImages.length > 0 ||
        detail.outputText ||
        detail.pending ||
        detail.error ||
        detail.empty,
    );
    return (
      <div
        data-v2-item-inspector="dynamic_tool"
        data-step-detail-card="dynamic_tool"
        data-dsh-io-card="true"
        className={FROSTED_STEP_CARD_CLASS}
      >
        {item.toolName || elapsedLabel ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/45 bg-muted/35 px-4 py-1.5 text-2xs [[data-pmx-glass='1']_&]:border-foreground/12 [[data-pmx-glass='1']_&]:bg-foreground/[0.04]">
            {item.toolName ? (
              <span className="font-mono font-medium text-foreground/90">{item.toolName}</span>
            ) : (
              <span />
            )}
            {elapsedLabel ? (
              <span className="font-mono tabular-nums text-muted-foreground">{elapsedLabel}</span>
            ) : null}
          </div>
        ) : null}

        {hasInputSection ? (
          <div
            data-dsh-io-section="in"
            className="grid max-h-[150px] grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-3.5 overflow-y-auto px-4 py-3"
          >
            <span className="sticky top-0 self-start font-mono text-2xs font-medium uppercase tracking-wide text-muted-foreground/80 select-none">
              {copy.ioIn}
            </span>
            <div className="min-w-0 space-y-1.5 text-xs">
              {call.args ? (
                call.args.map(([key, value]) => (
                  <div key={key} className="space-y-0.5">
                    <span className="inline-block rounded bg-muted/60 px-1.5 py-0.5 font-mono text-2xs font-medium text-muted-foreground [[data-pmx-glass='1']_&]:bg-foreground/[0.07]">
                      {key}
                    </span>
                    <div className="pl-1">
                      {key === "html" ? (
                        <ExpandableCodeBlock text={value} language="html" locale={locale} />
                      ) : key === "code" && isJavaScriptReplTool(item.toolName) ? (
                        <ExpandableCodeBlock text={value} language="typescript" locale={locale} />
                      ) : isJsonToolText(value) ? (
                        <ExpandableCodeBlock text={value} language="json" locale={locale} />
                      ) : (
                        <span className={cn("text-foreground/90", STEP_MONO_CLASS)}>{value}</span>
                      )}
                    </div>
                  </div>
                ))
              ) : call.argsText ? (
                <ExpandableCodeBlock text={call.argsText} highlightJson locale={locale} />
              ) : null}
            </div>
          </div>
        ) : null}

        {hasInputSection && hasOutputSection ? (
          <div
            data-dsh-io-divider="true"
            aria-hidden="true"
            className="h-[0.5px] w-full shrink-0 bg-border/50 [[data-pmx-glass='1']_&]:bg-foreground/12"
          />
        ) : null}

        {hasOutputSection ? (
          <div
            data-dsh-io-section="out"
            className="grid max-h-[150px] grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-3.5 overflow-y-auto px-4 py-3"
          >
            <span className="sticky top-0 self-start font-mono text-2xs font-medium uppercase tracking-wide text-muted-foreground/80 select-none">
              {copy.ioOut}
            </span>
            <div className="min-w-0 space-y-2">
              {detail.outputImages.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {detail.outputImages.map((resource) => (
                    <ChatMarkdownAssetImage
                      key={resource.index}
                      environmentId={environmentId}
                      resource={resource}
                      alt={gt("Tool output image")}
                      maxHeightRem={16}
                      onImageExpand={onImageExpand}
                    />
                  ))}
                </div>
              ) : null}
              {detail.outputText ? (
                isFailed ? (
                  <LocalizedErrorCard error={detail.outputText} compact />
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-end">
                      <StepCopyButton
                        text={detail.outputText}
                        label={copy.copyResult}
                        copiedLabel={copy.copied}
                      />
                    </div>
                    <ExpandableCodeBlock text={detail.outputText} highlightJson locale={locale} />
                  </div>
                )
              ) : detail.pending ? (
                <div className="text-xs italic text-muted-foreground">{copy.loadingOutput}</div>
              ) : detail.error ? (
                <LocalizedErrorCard error={detail.error} compact />
              ) : detail.empty && detail.outputImages.length === 0 ? (
                <div className="text-xs italic text-muted-foreground">{copy.noOutput}</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // Fallback for reasoning / approval_request / user_input_request / notification / system_notice / error
  let fallbackBody: ReactNode = null;
  if (item.type === "reasoning" && item.text) {
    fallbackBody = (
      <ReasoningTranslationBody
        text={item.text}
        running={isRunning}
        renderContent={(displayText) => (
          <ChatMarkdown
            text={displayText}
            cwd={cwd}
            threadRef={{ environmentId, threadId: projectedItem.sourceThreadId }}
            lineBreaks
          />
        )}
      />
    );
  } else if (item.type === "approval_request" && item.prompt) {
    fallbackBody = <ExpandableCodeBlock text={item.prompt} locale={locale} />;
  } else if (item.type === "user_input_request") {
    fallbackBody = (
      <ExpandableCodeBlock
        text={item.questions
          .map((q) => [q.question, ...q.options.map((opt) => `• ${opt.label}`)].join("\n"))
          .join("\n\n")}
        locale={locale}
      />
    );
  } else if (item.type === "notification" && item.detail) {
    fallbackBody = <ExpandableCodeBlock text={item.detail} locale={locale} />;
  } else if (item.type === "system_notice") {
    fallbackBody = <ExpandableCodeBlock text={item.message} locale={locale} />;
  } else if (item.type === "error") {
    fallbackBody = (
      <LocalizedErrorCard
        error={item.failure.message}
        errorClass={item.failure.class}
        errorCode={item.failure.code}
        variant={item.failure.class === "usage_limit" ? "warning" : "error"}
        compact
      />
    );
  }

  if (!fallbackBody) return null;
  return (
    <div
      data-v2-item-inspector={item.type}
      data-step-detail-card={item.type}
      className={cn(FROSTED_STEP_CARD_CLASS, "px-3 py-2")}
    >
      {fallbackBody}
    </div>
  );
}

function FrostedReadOutputCard({
  plainOutput,
  plainOutputFetches,
  projectedItem,
  environmentId,
  onImageExpand,
  source,
  onInitialOutputReady,
  locale,
}: {
  readonly plainOutput: string | null;
  readonly plainOutputFetches: boolean;
  readonly projectedItem?: OrchestrationV2ProjectedTurnItem | undefined;
  readonly environmentId: EnvironmentId;
  readonly onImageExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
  readonly source?: TurnItemSource | undefined;
  readonly onInitialOutputReady?: (() => void) | undefined;
  readonly locale?: string | undefined;
}) {
  const gt = useGT();
  const copy = getWorkStepCardCopy(locale);
  const detail = useResolvedTurnItemDetail(
    projectedItem ?? ({} as OrchestrationV2ProjectedTurnItem),
    environmentId,
    source,
    !plainOutputFetches || !projectedItem,
  );
  useInitialOutputReady(plainOutputFetches && detail.pending, onInitialOutputReady);

  return (
    <div data-step-detail-card="read" className={FROSTED_STEP_CARD_CLASS}>
      {plainOutput ? (
        <div className="flex items-start justify-between gap-2 border-b border-border/40 bg-muted/35 px-3 py-2 [[data-pmx-glass='1']_&]:border-foreground/10 [[data-pmx-glass='1']_&]:bg-foreground/[0.04]">
          <pre className={cn("min-w-0 flex-1 text-foreground/90", STEP_MONO_CLASS)}>
            {plainOutput}
          </pre>
          <StepCopyButton
            text={plainOutput}
            label={copy.copyPath}
            copiedLabel={copy.copied}
          />
        </div>
      ) : null}
      {plainOutputFetches && projectedItem ? (
        <div className="space-y-2 px-3 py-2">
          {detail.outputImages.map((resource) => (
            <ChatMarkdownAssetImage
              key={resource.index}
              environmentId={environmentId}
              resource={resource}
              alt={gt("Tool output image")}
              maxHeightRem={16}
              onImageExpand={onImageExpand}
            />
          ))}
          {detail.outputText ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
                <span>{copy.contentPreview}</span>
                <StepCopyButton
                  text={detail.outputText}
                  label={copy.copyContent}
                  copiedLabel={copy.copied}
                />
              </div>
              <ExpandableCodeBlock text={detail.outputText} highlightJson locale={locale} />
            </div>
          ) : detail.pending ? (
            <div className="text-xs italic text-muted-foreground">{copy.loadingContent}</div>
          ) : detail.error ? (
            <LocalizedErrorCard error={detail.error} compact />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type WorkEntryRowProps = {
  workEntry: TimelineWorkEntry;
  workspaceRoot: string | undefined;
  displayLabel?: string | undefined;
  autoExpandReasoning?: boolean | undefined;
  autoExpandDetails?: boolean | undefined;
  onToggleEntry?: ((collapsed: boolean) => void) | undefined;
  onContentReady?: (() => void) | undefined;
};

export const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: WorkEntryRowProps) {
  const ctx = use(TimelineRowCtx);
  const item = props.workEntry.projectedItem?.item;
  const childThreadId =
    item?.type === "notification" ? notificationChildThreadId(item.source) : undefined;
  if (item?.type !== "notification" || childThreadId === undefined) {
    return <WorkEntryLogRow {...props} />;
  }
  return (
    <SubagentNotificationLink
      parentRef={scopeThreadRef(ctx.activeThreadEnvironmentId, item.threadId)}
      childThreadId={childThreadId}
      taskIds={item.source.kind === "delegated_task" ? item.source.taskIds : undefined}
      outcome={item.outcome}
      createdAt={props.workEntry.createdAt}
      timestampFormat={ctx.timestampFormat}
      onOpenThread={ctx.onOpenThread}
      fallback={<WorkEntryLogRow {...props} />}
    />
  );
});

export function ViewedImagesTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "viewed-images" }>;
}) {
  const { threadRef, workspaceRoot, onImageExpand } = use(TimelineRowCtx);
  if (!threadRef) return null;
  return (
    <div className="flex flex-wrap items-start gap-2 px-0.5" data-image-gallery>
      {row.paths.map((path) => {
        const image = resolveViewedImageAsset(path, {
          threadId: threadRef.threadId,
          workspaceRoot,
        });
        return image ? (
          <ChatMarkdownAssetImage
            key={path}
            environmentId={threadRef.environmentId}
            resource={image.resource}
            alt={image.alt}
            srcFragment={image.srcFragment}
            workspaceRoot={workspaceRoot}
            maxHeightRem={10}
            onImageExpand={onImageExpand}
          />
        ) : null;
      })}
    </div>
  );
}

function WorkEntryLogRow(props: WorkEntryRowProps) {
  const {
    workEntry,
    workspaceRoot,
    displayLabel,
    autoExpandReasoning = false,
    autoExpandDetails = false,
  } = props;
  const detailsId = useId();
  const ctx = use(TimelineRowCtx);
  const gt = useGT();
  const m = useMessages();
  const { threadRef, onImageExpand, timestampFormat } = ctx;
  const { retryableWorkspacePreparationRunIds, onRetryWorkspacePreparation } = ctx;
  const threadTarget = useThreadReadTarget(workEntry, ctx.activeThreadEnvironmentId);
  const createdThread =
    workEntry.projectedItem?.item.type === "thread_created"
      ? workEntry.projectedItem.item
      : undefined;
  const notifiedSubagentThreadId =
    workEntry.projectedItem?.item.type === "notification"
      ? notificationChildThreadId(workEntry.projectedItem.item.source)
      : undefined;
  const groupView = use(WorkGroupViewCtx);
  const isReasoning = workEntry.itemType === "reasoning" || workEntry.tone === "thinking";
  const shouldAutoExpand = Boolean(
    autoExpandDetails ||
      ctx.workStepsPolicy?.defaultExpandLongItems ||
      (autoExpandReasoning && isReasoning),
  );
  const defaultExpanded =
    (groupView?.state.expandedEntries.has(workEntry.id) ?? false) || shouldAutoExpand;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [trackedAutoExpand, setTrackedAutoExpand] = useState(shouldAutoExpand);
  if (trackedAutoExpand !== shouldAutoExpand) {
    setTrackedAutoExpand(shouldAutoExpand);
    setExpanded(shouldAutoExpand);
  }
  const resetCount = ctx.turnDisclosureResetCount ?? 0;
  const [seenResetCount, setSeenResetCount] = useState(resetCount);
  if (seenResetCount !== resetCount) {
    setSeenResetCount(resetCount);
    if (expanded && !shouldAutoExpand) {
      setExpanded(false);
    }
  }
  const noticeMessage =
    workEntry.structuredPayload?.type === "system_notice"
      ? workEntry.structuredPayload.message
      : null;
  const labelRef = useRef<HTMLSpanElement>(null);
  const [noticeCutOff, setNoticeCutOff] = useState(false);
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- only layout knows whether a notice fits its row
  useLayoutEffect(() => {
    const label = labelRef.current;
    if (!label || noticeMessage === null) return;
    const measure = () => setNoticeCutOff(label.scrollWidth > label.clientWidth);
    measure();
    return observeResize(label, measure);
  }, [noticeMessage]);
  const onInitialOutputReady = () => {
    if (groupView) groupView.onContentReady?.(workEntry.id);
    else props.onContentReady?.();
  };
  const toggleExpanded = () => {
    const next = !expanded;
    if (groupView) {
      groupView.onToggleEntry(!next, workEntry.id);
      if (next) groupView.state.expandedEntries.add(workEntry.id);
      else groupView.state.expandedEntries.delete(workEntry.id);
    } else {
      props.onToggleEntry?.(!next);
    }
    setExpanded(next);
  };
  const failureItem = workEntry.projectedItem?.item;
  const pendingApproval =
    failureItem?.type === "approval_request"
      ? ctx.pendingApprovals.get(failureItem.requestId)
      : undefined;
  if (pendingApproval) return <TimelinePendingApprovalRow approval={pendingApproval} />;
  if (failureItem?.type === "error" && failureItem.status === "failed") {
    const warning = failureItem.failure.class === "usage_limit";
    const resetAt = failureItem.failure.resetAt;
    const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    const resetTime = resetAt
      ? `${formatUpcomingTimestamp(resetAt, timestampFormat, undefined, timeZone, m)} (${timeZone})`
      : null;
    const label = warning
      ? resetTime
        ? gt("Usage limit reached. Retry after {resetTime}.", { resetTime })
        : gt("Usage limit reached.")
      : localizeWorkStepLabel(workEntry.label, ctx.locale);
    const retryRunId =
      failureItem.runId !== null &&
      retryableWorkspacePreparationRunIds.has(failureItem.runId) &&
      failureItem.failure.code === ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE
        ? failureItem.runId
        : null;
    return (
      <WorkLogRow
        data-v2-item-type="error"
        data-v2-item-visibility={workEntry.projectedItem?.visibility}
        wrapLabel
        icon={
          <CircleAlertIcon
            className={cn("size-4", warning ? "text-warning" : "text-destructive")}
          />
        }
        label={
          <span
            className={cn("text-sm font-medium", warning ? "text-warning" : "text-destructive")}
          >
            {label}
          </span>
        }
        trailing={
          <TimelineRowTimestamp
            createdAt={workEntry.createdAt}
            timestampFormat={timestampFormat}
            alwaysVisible
          />
        }
      >
        <div
          className={cn(
            "ms-7 mt-1 mb-1 rounded-lg border px-3 py-2 shadow-xs backdrop-blur-md",
            warning
              ? "border-warning/35 bg-warning/10 [[data-pmx-glass='1']_&]:border-warning/40 [[data-pmx-glass='1']_&]:bg-card/78 [[data-pmx-glass='1']_&]:backdrop-blur-xl"
              : "border-error/35 bg-error/8 [[data-pmx-glass='1']_&]:border-error/40 [[data-pmx-glass='1']_&]:bg-card/78 [[data-pmx-glass='1']_&]:backdrop-blur-xl",
          )}
        >
          <LocalizedErrorCard
            error={failureItem.failure.message}
            errorClass={failureItem.failure.class}
            errorCode={failureItem.failure.code}
            variant={warning ? "warning" : "error"}
            compact
          />
        </div>
        {retryRunId !== null && onRetryWorkspacePreparation ? (
          <div className="ms-7 pb-1">
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => onRetryWorkspacePreparation(retryRunId)}
            >
              <RotateCcwIcon aria-hidden />
              <T>Retry</T>
            </Button>
          </div>
        ) : null}
      </WorkLogRow>
    );
  }

  const iconConfig = workToneIcon(workEntry.tone);
  const showWarningIndicator = workEntry.sourceActivityKind === "runtime.warning";
  const showFailedIndicator =
    !showWarningIndicator && workEntryDisplayIndicatesToolFailure(workEntry);
  const showDestructiveRowStyle =
    !showWarningIndicator &&
    showFailedIndicator &&
    (workEntrySignalsSevereFailure(workEntry) || !workLogEntryIsToolLike(workEntry));
  const entryIconName =
    showWarningIndicator || showDestructiveRowStyle ? "circle-alert" : workEntryIconName(workEntry);
  const entryToolIcon =
    showWarningIndicator || showDestructiveRowStyle
      ? undefined
      : (workEntry.toolIcon ?? workEntry.toolSource?.icon);

  const isRunning = workEntry.toolLifecycleStatus === "inProgress";
  const isReasoningLive = isReasoning && isRunning;
  const settledReasoningPreview = ctx.workStepsPolicy?.settledReasoningPreview ?? true;
  const stepCopy = getWorkStepCardCopy(ctx.locale);
  const elapsedMs = resolveWorkEntryElapsedMs(workEntry);
  const elapsedLabel =
    elapsedMs !== null && elapsedMs >= 1 ? formatWorkStepElapsedMs(elapsedMs) : null;

  const reasoningTitleLabel = formatThinkingHeaderLabel({
    live: isReasoningLive,
    elapsedMs,
    locale: ctx.locale,
  });
  const reasoningSummaryLine = isReasoning
    ? extractReasoningSummaryLine(workEntry.detail, {
        live: isReasoningLive,
        settledReasoningPreview,
      })
    : null;
  const questionHeading = workEntry.questionAnswer
    ? getQuestionTextPreview(workEntry.questionAnswer)
    : "";

  const payload = workEntry.structuredPayload;
  const isCommandEntry =
    !isReasoning &&
    (payload?.type === "command_execution" ||
      workEntry.itemType === "command_execution" ||
      Boolean(workEntry.command?.trim()));
  const rawCommandText =
    payload?.type === "command_execution"
      ? payload.input
      : (workEntry.rawCommand ?? workEntry.command ?? "");
  const strippedCommand = isCommandEntry ? stripShellCommandWrapper(rawCommandText) : null;
  const commandExitCode = payload?.type === "command_execution" ? payload.exitCode : undefined;
  const toolDataRecord =
    workEntry.toolData !== null &&
    typeof workEntry.toolData === "object" &&
    !Array.isArray(workEntry.toolData)
      ? (workEntry.toolData as Record<string, unknown>)
      : undefined;
  const toolDataCwd = typeof toolDataRecord?.cwd === "string" ? toolDataRecord.cwd : undefined;

  const isFileChangeEntry =
    !isReasoning && (payload?.type === "file_change" || workEntry.itemType === "file_change");
  const fileChangePayload = payload?.type === "file_change" ? payload : undefined;
  const primaryFileChangePath = fileChangePayload
    ? formatWorkspaceRelativePath(fileChangePayload.fileName, workspaceRoot)
    : workEntry.changedFiles?.[0]
      ? formatWorkspaceRelativePath(workEntry.changedFiles[0], workspaceRoot)
      : null;
  const fileChangeSplit = primaryFileChangePath
    ? splitDisplayFilePath(primaryFileChangePath)
    : null;
  const fileChangeAction = isFileChangeEntry
    ? formatFileChangeAction(fileChangePayload?.changes?.[0]?.operation, ctx.locale)
    : null;
  const fileChangeExtraCount =
    fileChangePayload?.changes && fileChangePayload.changes.length > 1
      ? fileChangePayload.changes.length - 1
      : (workEntry.changedFiles?.length ?? 0) > 1
        ? (workEntry.changedFiles?.length ?? 1) - 1
        : 0;

  const readLineRange =
    !isReasoning && !isCommandEntry && !isFileChangeEntry && toolGroupAction(workEntry) === "read"
      ? extractReadLineRangeLabel(workEntry)
      : null;
  const searchMatchCount =
    payload?.type === "file_search" && payload.results?.length
      ? payload.results.length
      : payload?.type === "web_search" && payload.results?.length
        ? payload.results.length
        : null;

  const rawPreviewText = isReasoning
    ? reasoningSummaryLine
      ? `${reasoningTitleLabel} · ${reasoningSummaryLine}`
      : reasoningTitleLabel
    : isCommandEntry && strippedCommand?.displayCommand
      ? strippedCommand.displayCommand
      : questionHeading || (displayLabel ?? workEntryDisplayLabel(workEntry, workspaceRoot, m));
  const previewText =
    isReasoning || isCommandEntry
      ? rawPreviewText
      : localizeWorkStepLabel(rawPreviewText, ctx.locale);

  const searchFallbackData =
    !isReasoning && workEntry.projectedItem === undefined && isSearchWorkEntry(workEntry)
      ? normalizeSearchWorkEntry(workEntry, workspaceRoot, workEntry.detail)
      : null;
  const webFallbackData =
    !isReasoning &&
    !searchFallbackData &&
    workEntry.projectedItem === undefined &&
    isWebWorkEntry(workEntry)
      ? normalizeWebWorkEntry(workEntry, workEntry.detail)
      : null;
  const todoFallbackSnapshot =
    !isReasoning && workEntry.projectedItem === undefined
      ? extractTodoChecklistFromWorkEntry(workEntry)
      : null;
  const detailedCollapsedPreview =
    !expanded && !isReasoning && ctx.workStepsPolicy?.mode === "detailed"
      ? extractWorkStepCollapsedPreview(workEntry, {
          workspaceRoot,
          locale: ctx.locale,
          headingText: previewText,
        })
      : null;

  const answerPreview =
    workEntry.questionAnswer && hasQuestionAnswer(workEntry.questionAnswer)
      ? getQuestionAnswerPreview(workEntry.questionAnswer)
      : null;
  const viewedImagePath = workEntryViewedImagePath(workEntry);
  const mcpSignIn =
    payload?.type === "system_notice" &&
    payload.mcpSignIn !== undefined &&
    payload.providerThreadId !== null ? (
      <McpSignInAction
        environmentId={ctx.activeThreadEnvironmentId}
        threadId={payload.threadId}
        providerThreadId={payload.providerThreadId}
        server={payload.mcpSignIn.server}
        noticeAt={DateTime.toEpochMillis(payload.updatedAt)}
      />
    ) : null;
  const skill =
    payload?.type === "dynamic_tool"
      ? claudeSkillInvocation(payload.toolName, payload.input)
      : undefined;
  const plainOutput =
    toolGroupAction(workEntry) === "read"
      ? workEntryReadOutput(workEntry, workspaceRoot)
      : skill
        ? (skill.args ?? null)
        : undefined;
  const viewedImage =
    viewedImagePath && threadRef
      ? resolveViewedImageAsset(viewedImagePath, {
          threadId: threadRef.threadId,
          workspaceRoot,
        })
      : null;
  const groupViewedImages = groupView?.viewedImages;
  const expandImage =
    viewedImage && groupViewedImages
      ? (preview: ExpandedImagePreview) =>
          onImageExpand(workGroupImageGallery(groupViewedImages, viewedImagePath, preview))
      : onImageExpand;
  const canExpand =
    previewText.trim().length > 0 ||
    (workEntry.itemType === "dynamic_tool" && workEntry.toolData !== undefined) ||
    Boolean(
      workEntryRawCommand(workEntry) ||
      workEntry.command?.trim() ||
      workEntry.detail?.trim() ||
      workEntry.changedFiles?.length ||
      viewedImage,
    );
  const expandedBody =
    expanded && !isReasoning
      ? plainOutput !== undefined
        ? plainOutput
        : buildToolCallExpandedBody(
            workEntry,
            workspaceRoot,
            previewText,
            viewedImage ? viewedImagePath : null,
            m,
          )
      : null;
  const plainOutputFetches =
    plainOutput !== undefined &&
    workEntry.projectedItem !== undefined &&
    turnItemNeedsDetailFetch(workEntry.projectedItem.item);
  const canExpandProjectedItem =
    (noticeMessage === null || noticeCutOff) &&
    (plainOutput !== undefined
      ? Boolean(plainOutput || viewedImage || workEntry.questionAnswer || plainOutputFetches)
      : workEntry.projectedItem === undefined
        ? Boolean(canExpand || searchFallbackData || webFallbackData || todoFallbackSnapshot)
        : isReasoning
          ? Boolean(workEntry.detail?.trim())
          : Boolean(
              viewedImage ||
              workEntry.questionAnswer ||
              turnItemHasDetail(workEntry.projectedItem.item) ||
              isSearchTurnItem(workEntry.projectedItem.item) ||
              isWebTurnItem(workEntry.projectedItem.item) ||
              extractTodoChecklistFromTurnItem(workEntry.projectedItem.item) !== null,
            ));

  const iconWrapperClass = cn(
    "relative flex size-4 items-center justify-center",
    showWarningIndicator
      ? "text-warning"
      : showDestructiveRowStyle
        ? "text-destructive"
        : showFailedIndicator
          ? failedToolIconClassName
          : isRunning
            ? "text-primary"
            : isReasoning
              ? "text-primary/80"
              : workEntry.tone === "tool"
                ? "text-icon-muted"
                : iconConfig.className,
  );
  const headingClass = showWarningIndicator
    ? "font-medium text-warning"
    : showDestructiveRowStyle
      ? "font-medium text-destructive"
      : workLogEntryIsToolLike(workEntry)
        ? "text-foreground/90"
        : "text-foreground/85";
  const threadLabel = isReasoning ? null : threadReadLabel(previewText, workEntry, threadTarget, m);
  const accessiblePreview = [threadLabel?.text ?? previewText, answerPreview]
    .filter(Boolean)
    .join(": ");
  const accessibleDisplayText = showFailedIndicator
    ? gt("{label}, tool call failed", { label: accessiblePreview })
    : accessiblePreview;
  const handleRowKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      toggleExpanded();
    }
  };

  if (isReasoning) {
    return (
      <DshReasoningWorkEntryRow
        workEntry={workEntry}
        expanded={expanded}
        isReasoningLive={isReasoningLive}
        settledReasoningPreview={settledReasoningPreview}
        reasoningTitleLabel={reasoningTitleLabel}
        canExpandProjectedItem={canExpandProjectedItem}
        detailsId={detailsId}
        labelRef={labelRef}
        toggleExpanded={toggleExpanded}
        handleRowKeyDown={handleRowKeyDown}
        stopRowToggle={stopRowToggle}
      />
    );
  }

  const hasHeaderAccessory = Boolean(
    (isFileChangeEntry && fileChangePayload && workEntry.projectedItem && ctx.onOpenToolDiff) ||
      createdThread ||
      notifiedSubagentThreadId ||
      (showFailedIndicator && !showDestructiveRowStyle && !toolIconAcceptsTint(entryToolIcon)),
  );

  return (
    <div
      data-work-entry-id={workEntry.id}
      data-v2-item-type={workEntry.projectedItem?.item.type}
      data-v2-item-visibility={workEntry.projectedItem?.visibility}
      data-tool-row="true"
      data-open={expanded ? "true" : undefined}
      onClick={canExpandProjectedItem ? toggleExpanded : undefined}
      className="flex w-full min-w-0 flex-col"
    >
      <div
        data-disclosure-header="true"
        data-has-accessory={hasHeaderAccessory ? "true" : undefined}
        className={cn("flex min-w-0 items-center", hasHeaderAccessory && "gap-2")}
      >
        <div
          data-disclosure-row="true"
          data-expandable={canExpandProjectedItem ? "true" : undefined}
          role={canExpandProjectedItem ? "button" : undefined}
          tabIndex={canExpandProjectedItem ? 0 : undefined}
          aria-label={canExpandProjectedItem ? accessibleDisplayText : undefined}
          aria-expanded={canExpandProjectedItem ? expanded : undefined}
          aria-controls={canExpandProjectedItem ? detailsId : undefined}
          onKeyDown={canExpandProjectedItem ? handleRowKeyDown : undefined}
          className={cn(
            "group/disclosure-row relative flex h-6 min-w-0 flex-1 items-center overflow-hidden rounded-md text-left text-xs leading-6 text-muted-foreground transition-colors duration-200 ease-out select-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 motion-reduce:transition-none",
            canExpandProjectedItem && "cursor-pointer",
          )}
        >
          <DshDisclosureLeadingSlot
            icon={
              <ToolActivityIconView
                icon={entryToolIcon}
                fallbackName={entryIconName}
                className="block size-3.5 shrink-0 stroke-2"
                muted={!isRunning}
              />
            }
            expandable={canExpandProjectedItem}
            expanded={expanded}
            groupScope="disclosure-row"
            iconClassName={cn("mr-1.5", iconWrapperClass)}
            role={showFailedIndicator ? "img" : undefined}
            ariaLabel={showFailedIndicator ? gt("Tool call failed") : undefined}
            liveDot={isRunning}
          />
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {isCommandEntry && strippedCommand ? (
              <span
                ref={labelRef}
                className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"
              >
                <code
                  className={cn(
                    "min-w-0 truncate font-mono text-xs font-normal text-foreground/90",
                    detailedCollapsedPreview && "max-w-[55%] shrink-0",
                  )}
                >
                  {strippedCommand.displayCommand}
                </code>
                {isRunning ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/14 px-1.5 py-px text-3xs font-medium leading-tight text-primary">
                    <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                    {stepCopy.running}
                  </span>
                ) : commandExitCode !== undefined && commandExitCode !== 0 ? (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-destructive/35 bg-destructive/12 px-1.5 py-px font-mono text-3xs font-medium leading-tight tabular-nums text-destructive">
                    {`${stepCopy.exitPrefix}${commandExitCode}`}
                  </span>
                ) : null}
                {elapsedLabel ? (
                  <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
                    {elapsedLabel}
                  </span>
                ) : null}
                {detailedCollapsedPreview ? (
                  <>
                    <span
                      aria-hidden="true"
                      data-step-preview-separator="true"
                      className="size-0.5 shrink-0 rounded-full bg-muted-foreground/60"
                    />
                    <span
                      data-step-collapsed-preview="true"
                      className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground/80"
                    >
                      {detailedCollapsedPreview}
                    </span>
                  </>
                ) : null}
              </span>
            ) : isFileChangeEntry && fileChangeSplit && fileChangeAction ? (
              <span
                ref={labelRef}
                className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
              >
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center rounded border px-1.5 py-px text-3xs font-medium leading-tight",
                    fileChangeActionPillClass(fileChangeAction.kind),
                  )}
                >
                  {fileChangeAction.label}
                </span>
                <span className="shrink-0 font-mono text-xs font-medium text-foreground/95">
                  {fileChangeSplit.basename}
                </span>
                {fileChangeSplit.dirPath ? (
                  <span
                    className={cn(
                      "min-w-0 truncate font-mono text-xs text-muted-foreground",
                      detailedCollapsedPreview && "max-w-[28%] shrink",
                    )}
                  >
                    {fileChangeSplit.dirPath}
                  </span>
                ) : null}
                {fileChangeExtraCount > 0 ? (
                  <span className="shrink-0 rounded-full border border-border/50 bg-muted/45 px-1.5 py-px font-mono text-3xs tabular-nums text-muted-foreground [[data-pmx-glass='1']_&]:border-foreground/14 [[data-pmx-glass='1']_&]:bg-card/65">
                    +{fileChangeExtraCount}
                  </span>
                ) : null}
                {fileChangePayload &&
                (fileChangePayload.additions !== undefined ||
                  fileChangePayload.deletions !== undefined) ? (
                  <span className="inline-flex shrink-0 items-center gap-1 font-mono text-2xs font-medium tabular-nums">
                    <span className="text-diff-addition-foreground">
                      +{formatDiffCount(fileChangePayload.additions ?? 0)}
                    </span>
                    <span className="text-diff-deletion-foreground">
                      -{formatDiffCount(fileChangePayload.deletions ?? 0)}
                    </span>
                  </span>
                ) : null}
                {detailedCollapsedPreview ? (
                  <>
                    <span
                      aria-hidden="true"
                      data-step-preview-separator="true"
                      className="size-0.5 shrink-0 rounded-full bg-muted-foreground/60"
                    />
                    <span
                      data-step-collapsed-preview="true"
                      className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground/80"
                    >
                      {detailedCollapsedPreview}
                    </span>
                  </>
                ) : null}
              </span>
            ) : (
              <span
                ref={labelRef}
                className={cn(
                  answerPreview || mcpSignIn ? "min-w-0" : "min-w-0 flex-1",
                  "flex items-center gap-1.5 overflow-hidden",
                  headingClass,
                )}
              >
                <span
                  className={cn(
                    "min-w-0 truncate",
                    detailedCollapsedPreview && "max-w-[55%] shrink-0",
                  )}
                >
                  {threadLabel ? (
                    <ThreadReadLabel
                      label={threadLabel}
                      environmentId={ctx.activeThreadEnvironmentId}
                      linked
                    />
                  ) : (
                    previewText
                  )}
                </span>
                {readLineRange ? (
                  <span className="shrink-0 rounded border border-border/50 bg-muted/45 px-1.5 py-px font-mono text-3xs tabular-nums text-muted-foreground [[data-pmx-glass='1']_&]:border-foreground/14 [[data-pmx-glass='1']_&]:bg-card/65">
                    {readLineRange}
                  </span>
                ) : null}
                {searchMatchCount !== null ? (
                  <span className="shrink-0 rounded-full border border-border/50 bg-muted/45 px-1.5 py-px font-mono text-3xs tabular-nums text-muted-foreground [[data-pmx-glass='1']_&]:border-foreground/14 [[data-pmx-glass='1']_&]:bg-card/65">
                    {`${searchMatchCount}${
                      payload?.type === "web_search"
                        ? stepCopy.resultsSuffix
                        : stepCopy.matchesSuffix
                    }`}
                  </span>
                ) : null}
                {elapsedLabel && workLogEntryIsToolLike(workEntry) ? (
                  <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
                    {elapsedLabel}
                  </span>
                ) : null}
                {detailedCollapsedPreview ? (
                  <>
                    <span
                      aria-hidden="true"
                      data-step-preview-separator="true"
                      className="size-0.5 shrink-0 rounded-full bg-muted-foreground/60"
                    />
                    <span
                      data-step-collapsed-preview="true"
                      className="min-w-0 flex-1 truncate text-2xs text-muted-foreground/80"
                    >
                      {detailedCollapsedPreview}
                    </span>
                  </>
                ) : null}
              </span>
            )}
            {answerPreview ? (
              <span
                className={cn(
                  "min-w-0 truncate",
                  !expanded &&
                    workEntry.questionAnswer &&
                    hasQuestionAnswer(workEntry.questionAnswer)
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {answerPreview}
              </span>
            ) : null}
            {mcpSignIn}
          </div>
        </div>
        {hasHeaderAccessory ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {isFileChangeEntry &&
            fileChangePayload &&
            workEntry.projectedItem &&
            ctx.onOpenToolDiff ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  ctx.onOpenToolDiff?.({
                    threadId: workEntry.projectedItem!.sourceThreadId,
                    itemId: workEntry.projectedItem!.sourceItemId,
                    revision: turnItemDetailRevision(fileChangePayload),
                  });
                }}
                onKeyDown={stopRowToggle}
                className="shrink-0 cursor-pointer rounded-md border border-border/55 bg-background/70 px-1.5 py-0.5 text-2xs font-medium text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 [[data-pmx-glass='1']_&]:border-foreground/15 [[data-pmx-glass='1']_&]:bg-card/65"
              >
                <T>Open diff</T>
              </button>
            ) : null}
            {createdThread ? (
              <button
                type="button"
                className="shrink-0 rounded-sm text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                aria-label={
                  createdThread.title != null
                    ? gt("Open {title}", { title: createdThread.title })
                    : gt("Open created thread")
                }
                onClick={(event) => {
                  event.stopPropagation();
                  ctx.onOpenThread(createdThread.targetThreadId);
                }}
                onKeyDown={stopRowToggle}
              >
                <T>Open chat</T>
              </button>
            ) : null}
            {notifiedSubagentThreadId ? (
              <InlineButton
                aria-label={gt("Open subagent thread")}
                onClick={(event) => {
                  event.stopPropagation();
                  ctx.onOpenThread(notifiedSubagentThreadId);
                }}
                onKeyDown={stopRowToggle}
              >
                <T>Open subagent</T>
              </InlineButton>
            ) : null}
            {showFailedIndicator &&
            !showDestructiveRowStyle &&
            !toolIconAcceptsTint(entryToolIcon) ? (
              <XIcon aria-hidden className={cn("size-3 shrink-0", failedToolIconClassName)} />
            ) : null}
          </div>
        ) : null}
      </div>
      <SmoothDisclosure
        open={expanded}
        id={detailsId}
        onClick={stopRowToggle}
        onPointerDown={stopRowToggle}
      >
        {viewedImage && threadRef ? (
          <WorkLogDetails kind="media">
            <div className={cn(FROSTED_STEP_CARD_CLASS, "p-2")}>
              <ChatMarkdownAssetImage
                environmentId={threadRef.environmentId}
                resource={viewedImage.resource}
                alt={viewedImage.alt}
                srcFragment={viewedImage.srcFragment}
                workspaceRoot={workspaceRoot}
                maxHeightRem={16}
                onImageExpand={expandImage}
              />
            </div>
          </WorkLogDetails>
        ) : null}
        {workEntry.questionAnswer ? (
          <QuestionAnswerHistory answer={workEntry.questionAnswer} />
        ) : null}
        {!workEntry.questionAnswer &&
        canExpandProjectedItem &&
        (expandedBody ||
          plainOutputFetches ||
          searchFallbackData !== null ||
          webFallbackData !== null ||
          todoFallbackSnapshot !== null ||
          (workEntry.projectedItem && plainOutput === undefined)) ? (
          <WorkLogDetails kind="panel">
            {workEntry.projectedItem && plainOutput === undefined ? (
              <FrostedV2StepInspector
                onInitialOutputReady={onInitialOutputReady}
                projectedItem={workEntry.projectedItem}
                environmentId={ctx.activeThreadEnvironmentId}
                cwd={ctx.markdownCwd}
                workspaceRoot={workspaceRoot}
                onOpenToolDiff={ctx.onOpenToolDiff}
                onImageExpand={expandImage}
                source={ctx.turnItemSource}
                elapsedLabel={elapsedLabel}
                isRunning={isRunning}
                isFailed={showFailedIndicator}
                locale={ctx.locale}
                toolDataCwd={toolDataCwd}
              />
            ) : plainOutput !== undefined ? (
              <FrostedReadOutputCard
                plainOutput={plainOutput}
                plainOutputFetches={plainOutputFetches}
                projectedItem={workEntry.projectedItem}
                environmentId={ctx.activeThreadEnvironmentId}
                onImageExpand={expandImage}
                source={ctx.turnItemSource}
                onInitialOutputReady={onInitialOutputReady}
                locale={ctx.locale}
              />
            ) : searchFallbackData ? (
              <DshSearchBlock data={searchFallbackData} />
            ) : webFallbackData ? (
              <DshWebBlock
                data={webFallbackData}
                renderMarkdown={(md) => (
                  <ChatMarkdown
                    text={md}
                    cwd={ctx.markdownCwd}
                    threadRef={ctx.threadRef ?? undefined}
                    lineBreaks
                  />
                )}
              />
            ) : todoFallbackSnapshot ? (
              <AgyTodoChecklist
                variant="inline"
                snapshot={todoFallbackSnapshot}
                defaultOpen
              />
            ) : isCommandEntry && rawCommandText ? (
              <CommandExecutionDetailCard
                rawCommand={rawCommandText}
                cwd={toolDataCwd}
                workspaceRoot={workspaceRoot}
                exitCode={commandExitCode}
                isRunning={isRunning}
                isFailed={showFailedIndicator}
                elapsedLabel={elapsedLabel}
                streamsOutput={false}
                environmentId={ctx.activeThreadEnvironmentId}
                outputText={workEntry.detail?.trim() || null}
                pending={false}
                error={null}
                empty={!workEntry.detail?.trim()}
                locale={ctx.locale}
              />
            ) : expandedBody ? (
              <div
                data-step-detail-card="generic"
                className={cn(FROSTED_STEP_CARD_CLASS, "px-3 py-2")}
              >
                {showFailedIndicator ? (
                  <LocalizedErrorCard error={expandedBody} compact />
                ) : (
                  <ExpandableCodeBlock text={expandedBody} highlightJson locale={ctx.locale} />
                )}
              </div>
            ) : null}
          </WorkLogDetails>
        ) : null}
      </SmoothDisclosure>
    </div>
  );
}

function QuestionAnswerHistory({
  answer,
}: {
  answer: import("@prismux/core-contracts").UserInputAttachmentAnswerPayload;
}) {
  const { activeThreadEnvironmentId } = use(TimelineRowCtx);
  const attachments = Object.values(answer.attachmentsByQuestionId).flat();
  const resources = attachments.map((attachment) => ({
    _tag: "attachment" as const,
    attachmentId: attachment.id,
  }));
  const urls = useAssetUrls(activeThreadEnvironmentId, resources);
  return (
    <div
      className={cn(FROSTED_STEP_CARD_CLASS, "ms-7 space-y-2 px-3 py-2.5")}
      onClick={stopRowToggle}
    >
      {[
        ...new Set([
          ...Object.keys(answer.questionTextById ?? {}),
          ...Object.keys(answer.answers),
          ...Object.keys(answer.attachmentsByQuestionId),
        ]),
      ].map((questionId) => (
        <div key={questionId} className="space-y-1">
          {answer.questionTextById?.[questionId] ? (
            <p className="whitespace-pre-wrap text-sm font-medium text-foreground/90">
              {answer.questionTextById[questionId]}
            </p>
          ) : null}
          {getQuestionAnswerText(answer.answers[questionId]) ? (
            <p className="ms-3 whitespace-pre-wrap text-sm text-muted-foreground">
              {getQuestionAnswerText(answer.answers[questionId])}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {(answer.attachmentsByQuestionId[questionId] ?? []).map((attachment) => {
              const url = urls[attachments.indexOf(attachment)];
              return (
                <a
                  key={attachment.id}
                  href={url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary underline"
                >
                  {attachment.type === "image" && url ? (
                    <img
                      src={url}
                      alt={attachment.name}
                      className="h-20 max-w-32 rounded object-contain"
                    />
                  ) : (
                    attachment.name
                  )}
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
