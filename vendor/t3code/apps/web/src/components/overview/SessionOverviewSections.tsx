import type { ChatAttachment, EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  ArrowUpRightIcon,
  BotIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleIcon,
  FileCode2Icon,
  FileTextIcon,
  FilmIcon,
  GlobeIcon,
  ImageIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  PlusIcon,
  SparklesIcon,
  TerminalIcon,
  WifiOffIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
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
  DEFAULT_OVERVIEW_SECTION_LIMIT,
  sliceOverviewItems,
  type OverviewArtifactItem,
  type OverviewBackgroundTaskItem,
  type OverviewGoalItem,
  type OverviewGoalsSummary,
  type OverviewModifiedFileItem,
  type OverviewSideQuestionItem,
  type OverviewSubagentItem,
  type OverviewUploadItem,
  type OverviewUsedSkillItem,
} from "./sessionOverview.logic";

const OVERVIEW_ROW_CLASS =
  "group flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] leading-snug text-foreground/85 transition-colors hover:bg-black/[0.045] dark:hover:bg-white/[0.075]";

export function OverviewSectionBlock(props: {
  readonly id: string;
  readonly title: string;
  readonly count: number;
  readonly badgeExtra?: string | null;
  readonly emptyHint: string;
  readonly headerAction?: ReactNode;
  readonly forceExpanded?: boolean;
  readonly defaultVisibleCount?: number;
  readonly totalItems?: number;
  readonly showAll?: boolean;
  readonly onToggleShowAll?: () => void;
  readonly children: ReactNode;
}) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const expanded =
    props.forceExpanded === true
      ? true
      : manualExpanded !== null
        ? manualExpanded
        : props.count > 0;
  const limit = props.defaultVisibleCount ?? DEFAULT_OVERVIEW_SECTION_LIMIT;
  const totalItems = props.totalItems ?? props.count;
  const hasToggleAll = props.onToggleShowAll !== undefined && totalItems > limit;

  return (
    <section
      data-overview-section={props.id}
      aria-label={props.title}
      className="border-t border-border/50 px-1.5 py-1.5"
    >
      <div className="flex min-h-7 items-center justify-between gap-1.5 px-1.5">
        <button
          type="button"
          onClick={() => setManualExpanded((prev) => !(prev ?? props.count > 0))}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <span className="truncate text-[11.5px] font-medium tracking-tight text-muted-foreground select-none">
            {props.title}
          </span>
          <span
            data-overview-count={props.id}
            className="inline-flex min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-foreground/[0.07] px-1.5 py-px text-[10.5px] font-medium tabular-nums text-foreground/75 dark:bg-white/[0.09]"
          >
            {props.count}
          </span>
          {props.badgeExtra ? (
            <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground/80">
              {props.badgeExtra}
            </span>
          ) : null}
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "ml-auto size-3.5 shrink-0 text-muted-foreground/65 transition-transform duration-150",
              !expanded && "-rotate-90",
            )}
          />
        </button>
        {props.headerAction ? (
          <div className="flex shrink-0 items-center gap-0.5">{props.headerAction}</div>
        ) : null}
      </div>

      {expanded ? (
        <div className="mt-0.5">
          {props.count === 0 && !props.forceExpanded ? (
            <p className="px-2 py-1 text-[11.5px] text-muted-foreground/75">{props.emptyHint}</p>
          ) : (
            props.children
          )}
          {hasToggleAll ? (
            <button
              type="button"
              data-overview-toggle-all={props.id}
              onClick={props.onToggleShowAll}
              className="mt-0.5 flex h-7 w-full cursor-pointer items-center justify-center rounded-lg px-2 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.07]"
            >
              {props.showAll ? "收起" : `查看全部 (${totalItems})`}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function StatusDot({ tone, pulse }: { readonly tone: "emerald" | "sky" | "rose" | "amber" | "muted"; readonly pulse?: boolean }) {
  const toneClass =
    tone === "emerald"
      ? "bg-emerald-500"
      : tone === "sky"
        ? "bg-sky-500"
        : tone === "rose"
          ? "bg-rose-500"
          : tone === "amber"
            ? "bg-amber-500"
            : "bg-muted-foreground/45";
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full", toneClass, pulse && "animate-pulse")}
    />
  );
}

function subagentStatusTone(status: string): {
  readonly tone: "emerald" | "sky" | "rose" | "amber" | "muted";
  readonly pulse: boolean;
  readonly label: string;
} {
  if (status === "running" || status === "starting" || status === "in_progress") {
    return { tone: "sky", pulse: true, label: "运行中" };
  }
  if (status === "waiting_input") {
    return { tone: "amber", pulse: true, label: "等待输入" };
  }
  if (status === "pending" || status === "queued") {
    return { tone: "amber", pulse: false, label: "排队中" };
  }
  if (status === "completed") {
    return { tone: "emerald", pulse: false, label: "已完成" };
  }
  if (status === "failed" || status === "error") {
    return { tone: "rose", pulse: false, label: "失败" };
  }
  if (status === "cancelled" || status === "interrupted") {
    return { tone: "muted", pulse: false, label: "已中断" };
  }
  return { tone: "muted", pulse: false, label: "空闲" };
}

export function SubagentsOverviewSection(props: {
  readonly items: ReadonlyArray<OverviewSubagentItem>;
  readonly maxVisibleItems?: number;
  readonly onOpenSubagent: (item: OverviewSubagentItem) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const limit = props.maxVisibleItems ?? DEFAULT_OVERVIEW_SECTION_LIMIT;
  const { visible } = sliceOverviewItems(props.items, showAll, limit);

  return (
    <OverviewSectionBlock
      id="subagents"
      title="子智能体"
      count={props.items.length}
      emptyHint="当前会话暂无子智能体"
      defaultVisibleCount={limit}
      showAll={showAll}
      onToggleShowAll={() => setShowAll((prev) => !prev)}
    >
      <ul className="m-0 list-none space-y-0.5 p-0">
        {visible.map((item) => {
          const meta = subagentStatusTone(item.status);
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => props.onOpenSubagent(item)}
                disabled={!item.childThreadId}
                className={cn(OVERVIEW_ROW_CLASS, !item.childThreadId && "cursor-default opacity-80")}
                title={item.promptPreview ?? item.title}
              >
                <BotIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] text-muted-foreground">
                  <StatusDot tone={meta.tone} pulse={meta.pulse} />
                  <span>{item.remoteLabel ?? meta.label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </OverviewSectionBlock>
  );
}

export function SideQuestionsOverviewSection(props: {
  readonly items: ReadonlyArray<OverviewSideQuestionItem>;
  readonly maxVisibleItems?: number;
  readonly composerOpen: boolean;
  readonly composerSlot: ReactNode;
  readonly onToggleComposer: () => void;
  readonly onSelectItem: (item: OverviewSideQuestionItem) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const limit = props.maxVisibleItems ?? DEFAULT_OVERVIEW_SECTION_LIMIT;
  const { visible } = sliceOverviewItems(props.items, showAll, limit);

  return (
    <OverviewSectionBlock
      id="side-questions"
      title="旁路提问"
      count={props.items.length}
      emptyHint="点击右上角 + 发起只读旁路提问，不打断主对话"
      forceExpanded={props.composerOpen}
      defaultVisibleCount={limit}
      showAll={showAll}
      onToggleShowAll={() => setShowAll((prev) => !prev)}
      headerAction={
        <button
          type="button"
          data-action="add-side-question"
          aria-label="发起旁路提问"
          title="发起旁路提问"
          onClick={props.onToggleComposer}
          className={cn(
            "inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.1]",
            props.composerOpen && "bg-primary/15 text-primary",
          )}
        >
          <PlusIcon className="size-3.5" aria-hidden />
        </button>
      }
    >
      {props.composerSlot}
      {visible.length > 0 ? (
        <ul className="m-0 list-none space-y-0.5 p-0">
          {visible.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                data-side-question-item={item.id}
                onClick={() => props.onSelectItem(item)}
                className={OVERVIEW_ROW_CLASS}
                title={item.question}
              >
                {item.status === "pending" ? (
                  <Loader2Icon className="size-3.5 shrink-0 animate-spin text-sky-500" aria-hidden />
                ) : item.status === "offline" ? (
                  <WifiOffIcon className="size-3.5 shrink-0 text-amber-500" aria-hidden />
                ) : item.status === "answered" ? (
                  <SparklesIcon className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
                ) : (
                  <MessageSquarePlusIcon
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                <span className="shrink-0 text-[10.5px] text-muted-foreground">
                  {item.status === "pending"
                    ? "回答中"
                    : item.status === "answered"
                      ? "已回复"
                      : item.status === "offline"
                        ? "离线暂存"
                        : item.status === "error"
                          ? "受阻"
                          : "支线"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : props.composerOpen ? null : (
        <p className="px-2 py-1 text-[11.5px] text-muted-foreground/75">
          点击右上角 + 发起只读旁路提问，不打断主对话
        </p>
      )}
    </OverviewSectionBlock>
  );
}

export function BackgroundTasksOverviewSection(props: {
  readonly items: ReadonlyArray<OverviewBackgroundTaskItem>;
  readonly maxVisibleItems?: number;
  readonly onOpenTask: (item: OverviewBackgroundTaskItem) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const limit = props.maxVisibleItems ?? DEFAULT_OVERVIEW_SECTION_LIMIT;
  const { visible } = sliceOverviewItems(props.items, showAll, limit);

  const renderIcon = (kind: OverviewBackgroundTaskItem["kind"]) => {
    switch (kind) {
      case "server":
        return <GlobeIcon className="size-3.5 shrink-0 text-emerald-500" aria-hidden />;
      case "automation":
        return <CalendarClockIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
      default:
        return <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    }
  };

  return (
    <OverviewSectionBlock
      id="background-tasks"
      title="后台任务"
      count={props.items.length}
      emptyHint="暂无运行中的 PTY 或自动化任务"
      defaultVisibleCount={limit}
      showAll={showAll}
      onToggleShowAll={() => setShowAll((prev) => !prev)}
    >
      <ul className="m-0 list-none space-y-0.5 p-0">
        {visible.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => props.onOpenTask(item)}
              className={OVERVIEW_ROW_CLASS}
              title={item.subtitle ? `${item.title} (${item.subtitle})` : item.title}
            >
              {renderIcon(item.kind)}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.title}</span>
                {item.subtitle ? (
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {item.subtitle}
                  </span>
                ) : null}
              </span>
              <StatusDot
                tone={
                  item.status === "running"
                    ? "sky"
                    : item.status === "failed"
                      ? "rose"
                      : item.status === "scheduled"
                        ? "emerald"
                        : "muted"
                }
                pulse={item.status === "running"}
              />
            </button>
          </li>
        ))}
      </ul>
    </OverviewSectionBlock>
  );
}

export function GoalsOverviewSection(props: {
  readonly summary: OverviewGoalsSummary;
  readonly maxVisibleItems?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const limit = props.maxVisibleItems ?? DEFAULT_OVERVIEW_SECTION_LIMIT;
  const { visible } = sliceOverviewItems(props.summary.items, showAll, limit);

  const renderGoalIcon = (status: OverviewGoalItem["status"]) => {
    if (status === "completed") {
      return <CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-500" aria-hidden />;
    }
    if (status === "running") {
      return <Loader2Icon className="size-3.5 shrink-0 animate-spin text-sky-500" aria-hidden />;
    }
    return <CircleIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />;
  };

  return (
    <OverviewSectionBlock
      id="goals"
      title="目标"
      count={props.summary.items.length}
      totalItems={props.summary.items.length}
      badgeExtra={
        props.summary.totalCount > 0
          ? `${props.summary.completedCount}/${props.summary.totalCount}`
          : null
      }
      emptyHint="当前会话暂无计划或任务步骤"
      defaultVisibleCount={limit}
      showAll={showAll}
      onToggleShowAll={() => setShowAll((prev) => !prev)}
    >
      <ul className="m-0 list-none space-y-0.5 p-0">
        {visible.map((goal) => (
          <li
            key={goal.id}
            className="flex min-w-0 items-start gap-2 rounded-lg px-2 py-1 text-[12px] leading-snug text-foreground/85"
          >
            <span className="mt-0.5 shrink-0">{renderGoalIcon(goal.status)}</span>
            <span
              className={cn(
                "min-w-0 flex-1 break-words",
                goal.status === "completed" && "text-muted-foreground line-through",
              )}
            >
              {goal.text}
            </span>
          </li>
        ))}
      </ul>
    </OverviewSectionBlock>
  );
}

export function ArtifactsOverviewSection(props: {
  readonly items: ReadonlyArray<OverviewArtifactItem>;
  readonly maxVisibleItems?: number;
  readonly onOpenArtifact: (item: OverviewArtifactItem) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const limit = props.maxVisibleItems ?? DEFAULT_OVERVIEW_SECTION_LIMIT;
  const { visible } = sliceOverviewItems(props.items, showAll, limit);

  return (
    <OverviewSectionBlock
      id="artifacts"
      title="产物文档"
      count={props.items.length}
      emptyHint="当前会话暂无计划或 Markdown 报告文档"
      defaultVisibleCount={limit}
      showAll={showAll}
      onToggleShowAll={() => setShowAll((prev) => !prev)}
    >
      <ul className="m-0 list-none space-y-0.5 p-0">
        {visible.map((artifact) => (
          <li key={artifact.id}>
            <button
              type="button"
              onClick={() => props.onOpenArtifact(artifact)}
              className={OVERVIEW_ROW_CLASS}
              title={artifact.relativePath ?? artifact.title}
            >
              <FileTextIcon className="size-3.5 shrink-0 text-indigo-500 dark:text-indigo-400" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{artifact.title}</span>
                {artifact.subtitle ? (
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {artifact.subtitle}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </OverviewSectionBlock>
  );
}

export function ModifiedFilesOverviewSection(props: {
  readonly items: ReadonlyArray<OverviewModifiedFileItem>;
  readonly maxVisibleItems?: number;
  readonly onOpenFileDiff: (item: OverviewModifiedFileItem) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const limit = props.maxVisibleItems ?? DEFAULT_OVERVIEW_SECTION_LIMIT;
  const { visible } = sliceOverviewItems(props.items, showAll, limit);

  return (
    <OverviewSectionBlock
      id="modified-files"
      title="已修改文件"
      count={props.items.length}
      emptyHint="工作区暂无已修改文件"
      defaultVisibleCount={limit}
      showAll={showAll}
      onToggleShowAll={() => setShowAll((prev) => !prev)}
    >
      <ul className="m-0 list-none space-y-0.5 p-0">
        {visible.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              data-overview-modified-file={file.path}
              onClick={() => props.onOpenFileDiff(file)}
              className={OVERVIEW_ROW_CLASS}
              title={file.path}
            >
              <span
                className={cn(
                  "inline-flex h-4 min-w-[2.05rem] shrink-0 items-center justify-center rounded px-1 font-mono text-[9.5px] font-semibold tracking-tight",
                  file.badge.className,
                )}
              >
                {file.badge.label}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground/90">
                  {file.fileName}
                </span>
                {file.dirPath ? (
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {file.dirPath}
                  </span>
                ) : null}
              </span>
              {file.insertions > 0 || file.deletions > 0 ? (
                <span className="flex shrink-0 items-center gap-1 font-mono text-[10.5px] tabular-nums">
                  {file.insertions > 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +{file.insertions}
                    </span>
                  ) : null}
                  {file.deletions > 0 ? (
                    <span className="text-rose-600 dark:text-rose-400">-{file.deletions}</span>
                  ) : null}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </OverviewSectionBlock>
  );
}

export function UploadsOverviewSection(props: {
  readonly items: ReadonlyArray<OverviewUploadItem>;
  readonly maxVisibleItems?: number;
  readonly imageUrlById: ReadonlyMap<string, string>;
  readonly onOpenUpload: (item: OverviewUploadItem, previewUrl: string | null) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const limit = props.maxVisibleItems ?? DEFAULT_OVERVIEW_SECTION_LIMIT;
  const { visible } = sliceOverviewItems(props.items, showAll, limit);

  return (
    <OverviewSectionBlock
      id="uploads"
      title="上传内容"
      count={props.items.length}
      emptyHint="本会话暂无上传的图片或附件"
      defaultVisibleCount={limit}
      showAll={showAll}
      onToggleShowAll={() => setShowAll((prev) => !prev)}
    >
      <ul className="m-0 list-none space-y-0.5 p-0">
        {visible.map((upload) => {
          const previewUrl = props.imageUrlById.get(upload.id) ?? null;
          return (
            <li key={upload.id}>
              <button
                type="button"
                data-overview-upload={upload.id}
                onClick={() => props.onOpenUpload(upload, previewUrl)}
                className={OVERVIEW_ROW_CLASS}
                title={upload.name}
              >
                {upload.kind === "image" && previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={upload.name}
                    className="size-5 shrink-0 rounded object-cover ring-1 ring-border/60"
                  />
                ) : upload.kind === "image" ? (
                  <ImageIcon className="size-3.5 shrink-0 text-sky-500" aria-hidden />
                ) : upload.kind === "video" ? (
                  <FilmIcon className="size-3.5 shrink-0 text-violet-500" aria-hidden />
                ) : (
                  <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{upload.name}</span>
                {upload.sizeLabel ? (
                  <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                    {upload.sizeLabel}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </OverviewSectionBlock>
  );
}

/**
 * Strictly read-only display of slash commands and skills actually used in this session.
 * Does NOT build or link to any Skill Center / Skill Lens panel (AGENTS.md Red Line #2).
 */
export function UsedSkillsOverviewSection(props: {
  readonly items: ReadonlyArray<OverviewUsedSkillItem>;
  readonly maxVisibleItems?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const limit = props.maxVisibleItems ?? DEFAULT_OVERVIEW_SECTION_LIMIT;
  const { visible } = sliceOverviewItems(props.items, showAll, limit);

  return (
    <OverviewSectionBlock
      id="used-skills"
      title="已使用技能"
      count={props.items.length}
      emptyHint="本会话暂未触发斜杠命令或技能引用"
      defaultVisibleCount={limit}
      showAll={showAll}
      onToggleShowAll={() => setShowAll((prev) => !prev)}
    >
      <ul className="m-0 list-none space-y-0.5 p-0">
        {visible.map((skill) => (
          <li
            key={skill.id}
            data-overview-skill={skill.name}
            className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-foreground/85"
          >
            <FileCode2Icon
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-medium">
              {skill.name}
            </span>
            {skill.count > 1 ? (
              <span className="shrink-0 rounded-full bg-foreground/[0.06] px-1.5 py-px text-[10px] tabular-nums text-muted-foreground dark:bg-white/[0.08]">
                ×{skill.count}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </OverviewSectionBlock>
  );
}

export function ArtifactPreviewDialog(props: {
  readonly artifact: OverviewArtifactItem | null;
  readonly onClose: () => void;
  readonly onOpenWorkspaceFile?: (relativePath: string) => void;
}) {
  const artifact = props.artifact;
  return (
    <Dialog open={artifact !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup
        data-pmx-glass-zone="overlays"
        data-overview-artifact-dialog="1"
        className="max-w-2xl rounded-2xl"
      >
        {artifact ? (
          <>
            <DialogHeader>
              <DialogTitle className="pr-8 text-sm font-semibold">{artifact.title}</DialogTitle>
              <DialogDescription className="text-xs">
                {artifact.relativePath ?? artifact.subtitle ?? "会话产物文档预览"}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <pre className="max-h-[60vh] overflow-y-auto rounded-xl border border-border/60 bg-foreground/[0.03] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">
                {artifact.markdown ?? "暂无内联正文，请点击下方按钮在工作区中打开完整文件。"}
              </pre>
            </DialogPanel>
            <DialogFooter>
              {artifact.relativePath && props.onOpenWorkspaceFile ? (
                <Button
                  type="button"
                  size="xs"
                  variant="default"
                  onClick={() => {
                    props.onOpenWorkspaceFile?.(artifact.relativePath!);
                    props.onClose();
                  }}
                >
                  <ArrowUpRightIcon className="size-3.5" aria-hidden />
                  打开工作区文件
                </Button>
              ) : null}
            </DialogFooter>
          </>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

export function UploadPreviewDialog(props: {
  readonly target: { readonly item: OverviewUploadItem; readonly url: string | null } | null;
  readonly onClose: () => void;
  readonly onOpenAttachmentFile?: (attachment: ChatAttachment) => void;
}) {
  const target = props.target;
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup
        data-pmx-glass-zone="overlays"
        data-overview-upload-dialog="1"
        className="max-w-2xl rounded-2xl"
      >
        {target ? (
          <>
            <DialogHeader>
              <DialogTitle className="pr-8 text-sm font-semibold">{target.item.name}</DialogTitle>
              <DialogDescription className="text-xs">
                {[target.item.mimeType, target.item.sizeLabel].filter(Boolean).join(" · ")}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              {target.item.kind === "image" && target.url ? (
                <div className="flex max-h-[65vh] items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-black/10 p-2">
                  <img
                    src={target.url}
                    alt={target.item.name}
                    className="max-h-[60vh] max-w-full rounded-lg object-contain"
                  />
                </div>
              ) : (
                <div className="rounded-xl border border-border/60 bg-foreground/[0.03] px-3 py-4 text-center text-xs text-muted-foreground">
                  {target.item.kind === "image"
                    ? "当前环境暂无法加载该图片预览链接。"
                    : "点击下方按钮在右侧文件面板打开该附件。"}
                </div>
              )}
            </DialogPanel>
            {target.item.attachment.type === "file" && props.onOpenAttachmentFile ? (
              <DialogFooter>
                <Button
                  type="button"
                  size="xs"
                  variant="default"
                  onClick={() => {
                    props.onOpenAttachmentFile?.(target.item.attachment);
                    props.onClose();
                  }}
                >
                  <ArrowUpRightIcon className="size-3.5" aria-hidden />
                  在右侧打开附件
                </Button>
              </DialogFooter>
            ) : null}
          </>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

export type OverviewAttachmentHandler = (
  environmentId: EnvironmentId,
  threadId: ThreadId,
  attachment: ChatAttachment,
) => void;
