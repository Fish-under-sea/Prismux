import type { ScopedThreadRef } from "@t3tools/contracts";
import { MessagesSquare, PlusIcon } from "lucide-react";

import { openLinkPullRequestDialog } from "../pullRequest/LinkPullRequestDialog";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Button } from "../ui/button";

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
}) {
  return (
    <div
      data-testid="right-panel-side-chat-empty-state"
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <div className="flex size-10 items-center justify-center rounded-xl border border-border/70 bg-muted/40 dark:border-white/12 dark:bg-white/[0.06] [[data-pmx-glass='1']_&]:border-white/20 [[data-pmx-glass='1']_&]:bg-white/10">
        <MessagesSquare aria-hidden className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">侧聊</p>
        <p className="max-w-64 text-xs leading-relaxed text-muted-foreground">
          {props.disabledReason ??
            "在不打断主线程的前提下，随时开启一条平行侧聊追问细节或验证想法。"}
        </p>
      </div>
      {props.canStart && props.onStart ? (
        <Button size="sm" variant="outline" onClick={props.onStart}>
          <MessagesSquare className="size-3.5" />
          开启侧聊
        </Button>
      ) : null}
    </div>
  );
}
