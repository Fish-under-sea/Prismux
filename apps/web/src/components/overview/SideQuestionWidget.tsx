import type {
  ChatAttachment,
  EnvironmentId,
  ModelSelection,
  OrchestrationMessageContext,
  OrchestrationV2ThreadProjection,
  ThreadId,
} from "@prismux/core-contracts";
import { scopeThreadRef } from "@prismux/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@prismux/client-runtime/state/runtime";
import { thrownErrorMessage } from "@prismux/client-runtime/errors";
import {
  AlertCircleIcon,
  ArrowUpRightIcon,
  CheckCircle2Icon,
  CornerDownLeftIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  Trash2Icon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { m } from "~/i18n/messages";
import { cn, newMessageId, newThreadId } from "~/lib/utils";
import { prismuxDaemonClient } from "~/prismux/daemonClient";
import { useRightPanelStore } from "~/rightPanelStore";
import { readThreadShell, useThreadProjection, waitForThreadShell } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import {
  attachBtwReadOnlyGuardrailContext,
  deriveBtwThreadTitle,
  notifySideQuestionsUpdated,
  resolveBtwRuntimeMode,
  subscribeSideQuestionsUpdated,
} from "../chat/btwMode";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import {
  buildSideQuestionContextSummary,
  buildSideQuestionPrompt,
  createSideQuestionRecord,
  deriveSideQuestionTitle,
  loadPersistedSideQuestions,
  removeSideQuestionRecord,
  savePersistedSideQuestions,
  upsertSideQuestionRecord,
  type OverviewModifiedFileItem,
  type OverviewSideQuestionItem,
  type SideQuestionRecord,
  type SideQuestionStatus,
} from "./sessionOverview.logic";

export interface SideQuestionAskOverrideResult {
  readonly status?: SideQuestionStatus;
  readonly answer?: string | null;
  readonly errorMessage?: string | null;
  readonly linkedSideThreadId?: ThreadId | null;
  readonly hints?: ReadonlyArray<string>;
}

export type SideQuestionAskExecutor = (input: {
  readonly question: string;
  readonly prompt: string;
  readonly contextSummary: string;
}) => Promise<SideQuestionAskOverrideResult | void> | SideQuestionAskOverrideResult | void;

export interface UseSideQuestionControllerInput {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly threadTitle: string | null | undefined;
  readonly cwd: string | null | undefined;
  readonly isServerThread: boolean;
  readonly sideChatAvailable: boolean;
  readonly sideChatDisabledReason?: string | null | undefined;
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly modifiedFiles: ReadonlyArray<OverviewModifiedFileItem>;
  readonly onOpenSideChat?:
    | ((message?: {
        readonly text: string;
        readonly titleSeed: string;
        readonly attachments: ReadonlyArray<ChatAttachment>;
        readonly context?: OrchestrationMessageContext;
      }) => Promise<boolean> | boolean | void)
    | undefined;
  readonly readModelSelection?: (() => ModelSelection | undefined) | undefined;
  readonly onAskSideQuestion?: SideQuestionAskExecutor | undefined;
}

export function useSideQuestionController(input: UseSideQuestionControllerInput) {
  const { environmentId, threadId } = input;
  const threadStorageKey = `${environmentId}:${threadId}`;
  const [state, setState] = useState<{
    readonly key: string;
    readonly records: ReadonlyArray<SideQuestionRecord>;
  }>(() => ({
    key: threadStorageKey,
    records: loadPersistedSideQuestions(environmentId, threadId),
  }));

  useEffect(
    () =>
      subscribeSideQuestionsUpdated(environmentId, threadId, () => {
        setState({
          key: threadStorageKey,
          records: loadPersistedSideQuestions(environmentId, threadId),
        });
      }),
    [environmentId, threadId, threadStorageKey],
  );

  const records =
    state.key === threadStorageKey
      ? state.records
      : loadPersistedSideQuestions(environmentId, threadId);

  const [submitting, setSubmitting] = useState(false);

  const forkSideChat = useAtomCommand(threadEnvironment.forkSideChat, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const setThreadRuntimeMode = useOrchestrationCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });

  const commitRecords = useCallback(
    (updater: (prev: ReadonlyArray<SideQuestionRecord>) => ReadonlyArray<SideQuestionRecord>) => {
      setState((current) => {
        const base =
          current.key === threadStorageKey
            ? current.records
            : loadPersistedSideQuestions(environmentId, threadId);
        const next = updater(base);
        savePersistedSideQuestions(environmentId, threadId, next);
        return { key: threadStorageKey, records: next };
      });
      notifySideQuestionsUpdated(environmentId, threadId);
    },
    [environmentId, threadId, threadStorageKey],
  );

  const fetchLocalMemoryHints = useCallback(async (question: string): Promise<string[]> => {
    try {
      const info = await prismuxDaemonClient.getConnectionInfo(false);
      if (!info.ready || !info.baseUrl) return [];
      const res = await prismuxDaemonClient.searchMemory({ query: question, limit: 3 });
      const items = res.results ?? res.items ?? [];
      return items
        .map((entry) => {
          const title = entry.title?.trim();
          const body = entry.content?.trim().replace(/\s+/g, " ").slice(0, 140);
          if (!body) return null;
          return title ? `${title}：${body}` : body;
        })
        .filter((line): line is string => Boolean(line));
    } catch {
      return [];
    }
  }, []);

  const dispatchQuestion = useCallback(
    async (record: SideQuestionRecord): Promise<SideQuestionRecord> => {
      const prompt = buildSideQuestionPrompt(record.question, record.contextSummary);
      const titleSeed = deriveBtwThreadTitle(record.question, deriveSideQuestionTitle(record.question));
      const btwRuntimeMode = resolveBtwRuntimeMode();
      const guardedContext = attachBtwReadOnlyGuardrailContext(undefined, {
        contextSummary: record.contextSummary,
      });
      const modelSelection = input.readModelSelection?.();

      // 1. Custom test / host bridge override
      if (input.onAskSideQuestion) {
        try {
          const outcome = await input.onAskSideQuestion({
            question: record.question,
            prompt,
            contextSummary: record.contextSummary,
          });
          const updated: SideQuestionRecord = {
            ...record,
            status: outcome?.status ?? (outcome?.answer ? "answered" : "pending"),
            answer: outcome?.answer ?? record.answer,
            errorMessage: outcome?.errorMessage ?? null,
            linkedSideThreadId: outcome?.linkedSideThreadId ?? record.linkedSideThreadId ?? null,
            hints: outcome?.hints ?? record.hints ?? [],
            updatedAt: new Date().toISOString(),
          };
          commitRecords((prev) => upsertSideQuestionRecord(prev, updated));
          return updated;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failed: SideQuestionRecord = {
            ...record,
            status: "error",
            errorMessage: message,
            updatedAt: new Date().toISOString(),
          };
          commitRecords((prev) => upsertSideQuestionRecord(prev, failed));
          return failed;
        }
      }

      // 2. Real isolated T3 BTW side-question fork + strictly read-only turn
      // (keeps `message.text` clean for the chat bubble and carries read-only instructions invisibly in `context`)
      if (input.isServerThread && input.sideChatAvailable) {
        const targetThreadId = newThreadId();
        const fork = await forkSideChat({
          environmentId,
          input: {
            sourceThreadId: threadId,
            targetThreadId,
            title: titleSeed,
          },
        });
        if (fork._tag === "Success") {
          const targetRef = scopeThreadRef(environmentId, targetThreadId);
          const ready = await waitForThreadShell(targetRef);
          if (ready) {
            const sideShell = readThreadShell(targetRef);
            if (sideShell && sideShell.runtimeMode !== btwRuntimeMode) {
              await setThreadRuntimeMode({
                environmentId,
                input: {
                  threadId: targetThreadId,
                  runtimeMode: btwRuntimeMode,
                  createdAt: new Date().toISOString(),
                },
              });
            }
            const turn = await startThreadTurn({
              environmentId,
              input: {
                threadId: targetThreadId,
                message: {
                  messageId: newMessageId(),
                  role: "user",
                  text: record.question,
                  attachments: [],
                  context: guardedContext,
                },
                ...(modelSelection === undefined ? {} : { modelSelection }),
                titleSeed,
                runtimeMode: btwRuntimeMode,
                interactionMode: "default",
                createdAt: new Date().toISOString(),
              },
            });
            if (turn._tag === "Success") {
              const linked: SideQuestionRecord = {
                ...record,
                status: "pending",
                linkedSideThreadId: targetThreadId,
                errorMessage: null,
                updatedAt: new Date().toISOString(),
              };
              commitRecords((prev) => upsertSideQuestionRecord(prev, linked));
              return linked;
            }
            const errMsg = !isAtomCommandInterrupted(turn)
              ? (thrownErrorMessage(squashAtomCommandFailure(turn), m) ?? "旁路提问发送失败")
              : "旁路提问已取消";
            void deleteThread({
              environmentId,
              input: { threadId: targetThreadId, onlyIfUnused: true },
            });
            const failed: SideQuestionRecord = {
              ...record,
              status: "error",
              errorMessage: errMsg,
              updatedAt: new Date().toISOString(),
            };
            commitRecords((prev) => upsertSideQuestionRecord(prev, failed));
            return failed;
          }
          void deleteThread({
            environmentId,
            input: { threadId: targetThreadId, onlyIfUnused: true },
          });
        }

        // Fallback to parent-provided side-chat callback if direct fork failed
        if (input.onOpenSideChat) {
          try {
            const started = await input.onOpenSideChat({
              text: record.question,
              titleSeed,
              attachments: [],
              context: guardedContext,
            });
            if (started !== false) {
              const dispatched: SideQuestionRecord = {
                ...record,
                status: "pending",
                errorMessage: null,
                updatedAt: new Date().toISOString(),
              };
              commitRecords((prev) => upsertSideQuestionRecord(prev, dispatched));
              return dispatched;
            }
          } catch {
            // Fall through to offline notice below
          }
        }
      }

      // 3. Offline / draft / unconfigured provider: persist locally + attach optional local memory hints
      const hints = await fetchLocalMemoryHints(record.question);
      const offlineReason =
        input.sideChatDisabledReason?.trim() ||
        (!input.isServerThread
          ? "当前为草稿会话，尚未启动 Provider；问题已本地保存，发送首条主消息后可一键重试。"
          : "当前环境离线或未配置可用 Provider，问题已本地保存；连接后可点击「重试发送」。");

      const offlineRecord: SideQuestionRecord = {
        ...record,
        status: "offline",
        errorMessage: offlineReason,
        hints,
        updatedAt: new Date().toISOString(),
      };
      commitRecords((prev) => upsertSideQuestionRecord(prev, offlineRecord));
      return offlineRecord;
    },
    [
      commitRecords,
      deleteThread,
      environmentId,
      fetchLocalMemoryHints,
      forkSideChat,
      input,
      setThreadRuntimeMode,
      startThreadTurn,
      threadId,
    ],
  );

  const ask = useCallback(
    async (rawQuestion: string): Promise<SideQuestionRecord | null> => {
      const question = rawQuestion.trim();
      if (!question || submitting) return null;
      setSubmitting(true);
      try {
        const contextSummary = buildSideQuestionContextSummary({
          threadTitle: input.threadTitle,
          cwd: input.cwd,
          projection: input.projection,
          modifiedFiles: input.modifiedFiles,
        });
        const initial = createSideQuestionRecord({
          question,
          contextSummary,
          status: "pending",
        });
        commitRecords((prev) => upsertSideQuestionRecord(prev, initial));
        return await dispatchQuestion(initial);
      } finally {
        setSubmitting(false);
      }
    },
    [
      commitRecords,
      dispatchQuestion,
      input.cwd,
      input.modifiedFiles,
      input.projection,
      input.threadTitle,
      submitting,
    ],
  );

  const retry = useCallback(
    async (id: string): Promise<SideQuestionRecord | null> => {
      const existing = records.find((item) => item.id === id);
      if (!existing || submitting) return null;
      setSubmitting(true);
      try {
        const reset: SideQuestionRecord = {
          ...existing,
          status: "pending",
          errorMessage: null,
          updatedAt: new Date().toISOString(),
        };
        commitRecords((prev) => upsertSideQuestionRecord(prev, reset));
        return await dispatchQuestion(reset);
      } finally {
        setSubmitting(false);
      }
    },
    [commitRecords, dispatchQuestion, records, submitting],
  );

  const syncAnswer = useCallback(
    (id: string, answer: string, status: SideQuestionStatus = "answered") => {
      const trimmed = answer.trim();
      if (!trimmed) return;
      commitRecords((prev) => {
        const existing = prev.find((item) => item.id === id);
        if (!existing) return prev;
        if (existing.answer === trimmed && existing.status === status) return prev;
        return upsertSideQuestionRecord(prev, {
          ...existing,
          answer: trimmed,
          status,
          errorMessage: null,
          updatedAt: new Date().toISOString(),
        });
      });
    },
    [commitRecords],
  );

  const remove = useCallback(
    (id: string) => {
      commitRecords((prev) => removeSideQuestionRecord(prev, id));
    },
    [commitRecords],
  );

  return {
    records,
    submitting,
    ask,
    retry,
    syncAnswer,
    remove,
  };
}

export function SideQuestionComposer(props: {
  readonly open: boolean;
  readonly submitting: boolean;
  readonly online: boolean;
  readonly contextMessageCount: number;
  readonly onSubmit: (question: string) => Promise<unknown> | unknown;
  readonly onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (props.open) {
      textareaRef.current?.focus();
    }
  }, [props.open]);

  if (!props.open) return null;

  const submit = async () => {
    const text = draft.trim();
    if (!text || props.submitting) return;
    setDraft("");
    await props.onSubmit(text);
  };

  return (
    <div
      data-side-question-composer="1"
      className="mx-1.5 mb-2 rounded-xl border border-border/70 bg-foreground/[0.035] p-2 dark:bg-white/[0.045]"
    >
      <div className="mb-1.5 flex items-center justify-between gap-1.5">
        <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-muted-foreground">
          <SparklesIcon className="size-3 shrink-0 text-primary" aria-hidden />
          <span>
            只读支线 · 附带上下文{props.contextMessageCount > 0 ? ` (${props.contextMessageCount} 条)` : ""}
          </span>
        </span>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="关闭旁路提问输入框"
          className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground"
        >
          <XIcon className="size-3" aria-hidden />
        </button>
      </div>
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
            return;
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
        rows={2}
        placeholder="输入只读快问（不污染主对话流）…"
        aria-label="旁路提问内容"
        disabled={props.submitting}
        className="w-full resize-none rounded-lg border border-border/60 bg-background/60 px-2 py-1.5 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none dark:bg-black/25"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-[10.5px] text-muted-foreground">
          {props.online ? "Enter 发送 · 独立支线回答" : "离线/草稿模式 · 将本地暂存"}
        </span>
        <Button
          type="button"
          size="xs"
          variant="default"
          disabled={props.submitting || draft.trim().length === 0}
          onClick={() => void submit()}
          data-side-question-submit="1"
          className="h-6 gap-1 rounded-md px-2 text-[11px]"
        >
          {props.submitting ? (
            <Loader2Icon className="size-3 animate-spin" aria-hidden />
          ) : (
            <CornerDownLeftIcon className="size-3" aria-hidden />
          )}
          <span>提问</span>
        </Button>
      </div>
    </div>
  );
}

function LiveSideThreadReply(props: {
  readonly environmentId: EnvironmentId;
  readonly sideThreadId: ThreadId;
  readonly recordId: string;
  readonly source: "local" | "native";
  readonly persistedAnswer: string | null;
  readonly onSyncAnswer: (id: string, answer: string, status?: SideQuestionStatus) => void;
}) {
  const projection = useThreadProjection(
    scopeThreadRef(props.environmentId, props.sideThreadId),
  )?.projection;

  const assistantMessages = (projection?.messages ?? []).filter(
    (msg) => msg.role === "assistant" && msg.text.trim().length > 0,
  );
  const liveText =
    assistantMessages.map((msg) => msg.text.trim()).join("\n\n") ||
    (projection?.turnItems ?? [])
      .filter(
        (
          item,
        ): item is Extract<
          NonNullable<typeof projection>["turnItems"][number],
          { readonly type: "assistant_message" }
        > => item.type === "assistant_message" && item.text.trim().length > 0,
      )
      .map((item) => item.text.trim())
      .join("\n\n");

  const isStreaming = (projection?.turnItems ?? []).some(
    (item) => item.type === "assistant_message" && item.streaming,
  );

  const effectiveText = liveText || props.persistedAnswer;

  useEffect(() => {
    if (props.source === "local" && liveText && !isStreaming) {
      props.onSyncAnswer(props.recordId, liveText, "answered");
    }
  }, [isStreaming, liveText, props]);

  if (!effectiveText) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-foreground/[0.03] px-3 py-2.5 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin text-sky-500" aria-hidden />
        <span>支线模型正在结合主会话上下文生成只读回复…</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-foreground/[0.03] p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">
      {effectiveText}
      {isStreaming ? (
        <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-sky-500 align-middle" />
      ) : null}
    </div>
  );
}

function SideQuestionStatusBadge({ status }: { readonly status: SideQuestionStatus }) {
  switch (status) {
    case "answered":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle2Icon className="size-3" aria-hidden />
          已回复
        </span>
      );
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10.5px] font-medium text-sky-700 dark:text-sky-300">
          <Loader2Icon className="size-3 animate-spin" aria-hidden />
          回答中
        </span>
      );
    case "offline":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-300">
          <WifiOffIcon className="size-3" aria-hidden />
          离线暂存
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10.5px] font-medium text-rose-700 dark:text-rose-300">
          <AlertCircleIcon className="size-3" aria-hidden />
          发送受阻
        </span>
      );
    case "native":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10.5px] font-medium text-indigo-700 dark:text-indigo-300">
          <MessageSquarePlusIcon className="size-3" aria-hidden />
          原生支线
        </span>
      );
  }
}

export function SideQuestionDetailDialog(props: {
  readonly item: OverviewSideQuestionItem | null;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly submitting: boolean;
  readonly onClose: () => void;
  readonly onRetry: (id: string) => Promise<unknown>;
  readonly onRemove: (id: string) => void;
  readonly onSyncAnswer: (id: string, answer: string, status?: SideQuestionStatus) => void;
}) {
  const item = props.item;
  const openSideThreadInPane = () => {
    if (!item?.linkedSideThreadId) return;
    useRightPanelStore
      .getState()
      .openThread(scopeThreadRef(props.environmentId, props.threadId), item.linkedSideThreadId);
    props.onClose();
  };

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup
        data-pmx-glass-zone="overlays"
        data-side-question-dialog="1"
        className="max-w-lg rounded-2xl"
      >
        {item ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 pr-8">
                <DialogTitle className="truncate text-sm font-semibold">{item.title}</DialogTitle>
                <SideQuestionStatusBadge status={item.status} />
              </div>
              <DialogDescription className="text-xs">
                独立只读旁路提问，不写入主会话时间线。
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-3">
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">提问内容</div>
                <div className="rounded-lg border border-border/60 bg-foreground/[0.03] px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-foreground">
                  {item.question}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">回复</div>
                {item.linkedSideThreadId ? (
                  <LiveSideThreadReply
                    environmentId={props.environmentId}
                    sideThreadId={item.linkedSideThreadId}
                    recordId={item.id}
                    source={item.source}
                    persistedAnswer={item.answer}
                    onSyncAnswer={props.onSyncAnswer}
                  />
                ) : item.answer ? (
                  <div className="rounded-lg border border-border/60 bg-foreground/[0.03] p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">
                    {item.answer}
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                    {item.errorMessage ?? "暂无回复内容，可尝试重新发送。"}
                  </div>
                )}
              </div>

              {item.hints.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    关联本地记忆提示（只读）
                  </div>
                  <ul className="m-0 list-none space-y-1 p-0">
                    {item.hints.map((hint, idx) => (
                      <li
                        key={idx}
                        className="rounded-md border border-border/50 bg-foreground/[0.025] px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground/80"
                      >
                        {hint}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {item.contextSummary ? (
                <details className="rounded-lg border border-border/50 bg-foreground/[0.02] px-2.5 py-1.5">
                  <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground select-none">
                    查看附带的会话上下文摘要
                  </summary>
                  <pre className="mt-1.5 max-h-36 overflow-y-auto font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                    {item.contextSummary}
                  </pre>
                </details>
              ) : null}
            </DialogPanel>
            <DialogFooter className="gap-1.5">
              {item.source === "local" ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="mr-auto text-destructive hover:text-destructive"
                  onClick={() => {
                    props.onRemove(item.id);
                    props.onClose();
                  }}
                >
                  <Trash2Icon className="size-3.5" aria-hidden />
                  删除记录
                </Button>
              ) : null}
              {item.source === "local" && (item.status === "offline" || item.status === "error") ? (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={props.submitting}
                  onClick={() => void props.onRetry(item.id)}
                >
                  <RefreshCwIcon
                    className={cn("size-3.5", props.submitting && "animate-spin")}
                    aria-hidden
                  />
                  重试发送
                </Button>
              ) : null}
              {item.linkedSideThreadId ? (
                <Button type="button" size="xs" variant="default" onClick={openSideThreadInPane}>
                  <ArrowUpRightIcon className="size-3.5" aria-hidden />
                  在侧栏中展开对话
                </Button>
              ) : null}
            </DialogFooter>
          </>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
