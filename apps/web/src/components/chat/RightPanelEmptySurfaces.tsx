import type { ScopedThreadRef, ThreadId } from "@prismux/core-contracts";
import {
  ArrowUpRightIcon,
  CornerDownLeftIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  PlusIcon,
  SendIcon,
  Trash2Icon,
  WifiOffIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  createSideQuestionRecord,
  loadPersistedSideQuestions,
  removeSideQuestionRecord,
  savePersistedSideQuestions,
  upsertSideQuestionRecord,
  type SideQuestionRecord,
} from "../overview/sessionOverview.logic";
import { openLinkPullRequestDialog } from "../pullRequest/LinkPullRequestDialog";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Button } from "../ui/button";
import {
  notifySideQuestionsUpdated,
  subscribeSideQuestionsUpdated,
} from "./btwMode";

export interface ExistingBtwSideThreadItem {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly running?: boolean | undefined;
}

export function PullRequestEmptySurface(props: {
  readonly threadRef: ScopedThreadRef;
  readonly capabilityKnown: boolean;
  readonly supported: boolean;
  readonly isServerThread?: boolean;
  readonly onOpenLinkedItems?: (() => void) | undefined;
}) {
  const isServerThread = props.isServerThread !== false;
  const canLinkPullRequest = props.supported && isServerThread;
  return (
    <div
      data-testid="right-panel-pr-empty-state"
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <div className="flex size-10 items-center justify-center rounded-xl border border-border/70 bg-muted/40 dark:border-white/12 dark:bg-white/[0.06] [[data-pmx-glass='1']_&]:border-white/20 [[data-pmx-glass='1']_&]:bg-white/10">
        <PullRequestGlyph.pullRequest aria-hidden className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {!props.supported && props.capabilityKnown
            ? "当前环境暂不支持 PR 浏览"
            : "当前分支暂无 Pull Request"}
        </p>
        <p className="max-w-64 text-xs leading-relaxed text-muted-foreground">
          {!props.supported && props.capabilityKnown
            ? "升级或连接支持 Git 托管同步的运行环境后，即可在此查看与评审 Pull Request。"
            : !isServerThread
              ? "发送第一条消息建立会话后，当前分支关联的 Pull Request 将自动显示在这里。"
              : "当前会话分支尚未检测到 Pull Request。你可以手动粘贴链接或编号进行关联。"}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {canLinkPullRequest ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => openLinkPullRequestDialog(props.threadRef)}
          >
            <PlusIcon className="size-3.5" />
            手动关联 PR
          </Button>
        ) : null}
        {props.onOpenLinkedItems ? (
          <Button size="sm" variant="ghost" onClick={props.onOpenLinkedItems}>
            <PullRequestGlyph.link className="size-3.5" />
            查看已关联项
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function LinkedItemsEmptySurface() {
  return (
    <div
      data-testid="right-panel-linked-items-empty-state"
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <div className="flex size-10 items-center justify-center rounded-xl border border-border/70 bg-muted/40 dark:border-white/12 dark:bg-white/[0.06] [[data-pmx-glass='1']_&]:border-white/20 [[data-pmx-glass='1']_&]:bg-white/10">
        <PullRequestGlyph.link aria-hidden className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">暂无已关联项</p>
        <p className="max-w-64 text-xs leading-relaxed text-muted-foreground">
          发送第一条消息后，当前会话关联的 PR 与 Issue 会汇总显示在这里，也支持手动粘贴链接关联。
        </p>
      </div>
    </div>
  );
}

export function SideChatEmptySurface(props: {
  readonly canStart: boolean;
  readonly disabledReason: string | null;
  readonly onStart?: (() => void) | undefined;
  readonly onQuickAsk?: ((question: string) => Promise<boolean> | boolean | void) | undefined;
  readonly threadRef?: ScopedThreadRef | undefined;
  readonly isServerThread?: boolean | undefined;
  readonly existingSideThreads?: ReadonlyArray<ExistingBtwSideThreadItem> | undefined;
  readonly onOpenExistingSideThread?: ((threadId: ThreadId) => void) | undefined;
}) {
  const { threadRef, canStart, onQuickAsk } = props;
  const environmentId = threadRef?.environmentId;
  const threadId = threadRef?.threadId;
  const storageKey = threadRef ? `${threadRef.environmentId}:${threadRef.threadId}` : "";

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [stagedState, setStagedState] = useState<{
    readonly key: string;
    readonly records: ReadonlyArray<SideQuestionRecord>;
  }>(() => ({
    key: storageKey,
    records:
      environmentId && threadId ? loadPersistedSideQuestions(environmentId, threadId) : [],
  }));

  const refreshPersisted = useCallback(() => {
    if (!environmentId || !threadId) return;
    setStagedState({
      key: `${environmentId}:${threadId}`,
      records: loadPersistedSideQuestions(environmentId, threadId),
    });
  }, [environmentId, threadId]);

  useEffect(() => {
    if (!environmentId || !threadId) return;
    return subscribeSideQuestionsUpdated(environmentId, threadId, refreshPersisted);
  }, [environmentId, refreshPersisted, threadId]);

  const stagedRecords =
    stagedState.key === storageKey
      ? stagedState.records
      : environmentId && threadId
        ? loadPersistedSideQuestions(environmentId, threadId)
        : [];

  const existingSideThreads = props.existingSideThreads ?? [];
  const linkedThreadIds = new Set(existingSideThreads.map((item) => item.threadId));
  const visibleStagedRecords = stagedRecords.filter(
    (record) => !record.linkedSideThreadId || !linkedThreadIds.has(record.linkedSideThreadId as ThreadId),
  );

  const stageQuestionLocally = (question: string) => {
    if (!environmentId || !threadId) return;
    const record = createSideQuestionRecord({
      question,
      contextSummary: "",
      status: "offline",
      errorMessage:
        props.disabledReason ??
        "当前为主会话草稿，暂无主对话历史；问题已作为独立只读旁路暂存，主会话建立后可一键追问。",
    });
    const current = loadPersistedSideQuestions(environmentId, threadId);
    const next = upsertSideQuestionRecord(current, record);
    savePersistedSideQuestions(environmentId, threadId, next);
    setStagedState({ key: storageKey, records: next });
    notifySideQuestionsUpdated(environmentId, threadId);
  };

  const removeStagedRecord = (id: string) => {
    if (!environmentId || !threadId) return;
    const current = loadPersistedSideQuestions(environmentId, threadId);
    const next = removeSideQuestionRecord(current, id);
    savePersistedSideQuestions(environmentId, threadId, next);
    setStagedState({ key: storageKey, records: next });
    notifySideQuestionsUpdated(environmentId, threadId);
  };

  const launchQuestion = async (rawQuestion: string, stagedIdToClear?: string) => {
    const question = rawQuestion.trim();
    if (!question || submitting) return;
    setSubmitting(true);
    try {
      if (canStart && onQuickAsk) {
        const started = await onQuickAsk(question);
        if (started !== false) {
          if (stagedIdToClear) {
            removeStagedRecord(stagedIdToClear);
          } else {
            setDraft("");
          }
          return;
        }
      }
      if (!stagedIdToClear) {
        stageQuestionLocally(question);
        setDraft("");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isDraftMode = !canStart && props.isServerThread === false;

  return (
    <div
      data-testid="right-panel-side-chat-empty-state"
      className="flex h-full min-h-0 flex-col overflow-y-auto p-5"
    >
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <div className="flex size-10 items-center justify-center rounded-xl border border-sky-500/25 bg-sky-500/10 text-sky-600 dark:border-sky-400/25 dark:bg-sky-400/12 dark:text-sky-300 [[data-pmx-glass='1']_&]:border-white/25 [[data-pmx-glass='1']_&]:bg-white/12">
            <MessageSquarePlusIcon aria-hidden="true" className="size-5" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-center gap-1.5">
              <p className="text-sm font-semibold text-foreground">旁路提问（BTW）</p>
              <span
                data-btw-readonly-badge="1"
                className="inline-flex items-center rounded-full border border-sky-500/25 bg-sky-500/12 px-1.5 py-0.5 text-[10px] leading-none font-medium text-sky-600 dark:text-sky-300"
              >
                BTW · 只读
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              在不打断主线程、不污染主上下文的前提下，并行追问细节、查阅代码或验证想法（严格只读，不修改文件）。
            </p>
          </div>
        </div>

        {props.disabledReason || isDraftMode ? (
          <div
            data-btw-draft-notice="1"
            className="rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-left text-[11.5px] leading-relaxed text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]"
          >
            {props.disabledReason ? <p>{props.disabledReason}</p> : null}
            {isDraftMode ? (
              <p className={props.disabledReason ? "mt-1 opacity-90" : undefined}>
                当前为主会话草稿，暂无主对话历史；问题将作为独立只读旁路暂存，主会话建立后亦可一键追问。
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Live compact BTW quick-ask composer — works on BOTH active server threads and blank draft threads */}
        <div
          data-btw-empty-composer="1"
          className="rounded-2xl border border-border/75 bg-background/70 p-2.5 shadow-xs backdrop-blur-sm dark:border-white/12 dark:bg-white/[0.045]"
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void launchQuestion(draft);
              }
            }}
            rows={3}
            disabled={submitting}
            aria-label="旁路提问内容"
            placeholder={
              canStart
                ? "直接输入只读旁路问题，Enter 立即开启多轮 BTW 对话…"
                : "现在即可记录旁路问题，主会话启动后一键发往只读支线…"
            }
            className="w-full resize-none rounded-xl border border-border/60 bg-background/80 px-2.5 py-2 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/75 focus:border-ring focus:outline-none dark:border-white/10 dark:bg-black/25"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10.5px] text-muted-foreground">
              {canStart ? "主线程运行时亦可并行提问 · 严格只读" : "草稿暂存 · 支持随时切回主会话"}
            </span>
            <div className="flex items-center gap-1.5">
              {canStart && props.onStart ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={submitting}
                  onClick={props.onStart}
                  data-btw-open-blank="1"
                  className="h-7 gap-1 px-2 text-[11px]"
                >
                  <PlusIcon className="size-3" />
                  开启旁路提问
                </Button>
              ) : null}
              <Button
                type="button"
                size="xs"
                variant="default"
                disabled={submitting || draft.trim().length === 0}
                onClick={() => void launchQuestion(draft)}
                data-btw-empty-submit="1"
                className="h-7 gap-1 rounded-lg px-2.5 text-[11px]"
              >
                {submitting ? (
                  <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
                ) : (
                  <CornerDownLeftIcon className="size-3" aria-hidden="true" />
                )}
                <span>{canStart ? "发送旁路提问" : "暂存旁路提问"}</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Existing live BTW threads + locally staged side questions */}
        {existingSideThreads.length > 0 || visibleStagedRecords.length > 0 ? (
          <div
            data-btw-existing-list="1"
            className="space-y-1.5 rounded-2xl border border-border/65 bg-background/50 p-2.5 dark:border-white/10 dark:bg-white/[0.03]"
          >
            <div className="px-1 text-[11px] font-medium text-muted-foreground">
              当前会话的旁路提问
            </div>
            <ul className="m-0 list-none space-y-1 p-0">
              {existingSideThreads.map((item) => (
                <li key={item.threadId}>
                  <button
                    type="button"
                    data-btw-existing-thread={item.threadId}
                    onClick={() => props.onOpenExistingSideThread?.(item.threadId)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                  >
                    {item.running ? (
                      <Loader2Icon
                        aria-hidden="true"
                        className="size-3.5 shrink-0 animate-spin text-sky-500"
                      />
                    ) : (
                      <MessageSquarePlusIcon
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                    <ArrowUpRightIcon
                      aria-hidden="true"
                      className="size-3 shrink-0 text-muted-foreground"
                    />
                  </button>
                </li>
              ))}
              {visibleStagedRecords.map((record) => (
                <li
                  key={record.id}
                  data-btw-staged-record={record.id}
                  className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-foreground/[0.02] px-2 py-1.5 text-xs dark:border-white/8"
                >
                  <WifiOffIcon
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-amber-500"
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground/90" title={record.question}>
                    {record.title}
                  </span>
                  {canStart && onQuickAsk ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={submitting}
                      onClick={() => void launchQuestion(record.question, record.id)}
                      className="h-6 gap-1 px-1.5 text-[10.5px]"
                    >
                      <SendIcon className="size-2.5" aria-hidden="true" />
                      发送
                    </Button>
                  ) : (
                    <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400">
                      已暂存
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label="删除暂存的旁路提问"
                    onClick={() => removeStagedRecord(record.id)}
                    className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-black/[0.06] hover:text-destructive dark:hover:bg-white/[0.1]"
                  >
                    <Trash2Icon className="size-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
