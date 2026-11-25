import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderSearchIcon,
  GlobeIcon,
  SearchIcon,
} from "lucide-react";
import { memo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { OrchestrationV2TurnItem } from "@prismux/core-contracts";
import { cn } from "~/lib/utils";
import type { WorkLogEntry } from "../../session-logic";
import {
  buildGroupedMatchRenderSections,
  computeHeadTailSlice,
  DEFAULT_SEARCH_MAX_LINES,
  DSH_SEARCH_COPY_ZH,
  normalizeSearchTurnItem,
  normalizeSearchWorkEntry,
  normalizeWebTurnItem,
  normalizeWebWorkEntry,
  type DshSearchFileGroup,
  type DshSearchMatchLine,
  type DshWebSource,
  type NormalizedDshSearchData,
  type NormalizedDshWebData,
} from "./DshSearchBlocks.logic";

const DSH_CARD_CHROME_CLASS = cn(
  "mt-1 mb-1 ml-1 overflow-hidden rounded-lg border border-border/50 bg-background/80 text-foreground shadow-xs backdrop-blur-md",
  "[[data-pmx-glass='1']_&]:border-foreground/15 [[data-pmx-glass='1']_&]:bg-card/72",
  "[[data-pmx-glass='1']_&]:shadow-sm [[data-pmx-glass='1']_&]:ring-1 [[data-pmx-glass='1']_&]:ring-inset [[data-pmx-glass='1']_&]:ring-foreground/10",
  "[[data-pmx-glass='1']_&]:backdrop-blur-xl",
);

const DSH_CARD_HEADER_CLASS = cn(
  "flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-muted/30 px-3.5 py-2 text-2xs",
  "[[data-pmx-glass='1']_&]:border-foreground/12 [[data-pmx-glass='1']_&]:bg-background/35",
);

const DSH_GAP_TOGGLE_CLASS = cn(
  "block w-full cursor-pointer bg-muted/20 px-3.5 py-1.5 text-left font-mono text-2xs font-medium text-muted-foreground transition-colors duration-150 motion-reduce:transition-none",
  "hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
  "[[data-pmx-glass='1']_&]:bg-background/25 [[data-pmx-glass='1']_&]:hover:bg-foreground/8",
);

function DshCopyButton({
  text,
  label = DSH_SEARCH_COPY_ZH.copy,
  copiedLabel = DSH_SEARCH_COPY_ZH.copied,
}: {
  readonly text: string;
  readonly label?: string | undefined;
  readonly copiedLabel?: string | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
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

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!text}
      aria-label={copied ? copiedLabel : label}
      data-dsh-copy-button="true"
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border/50 bg-background/70 px-2 py-0.5 text-2xs font-medium text-muted-foreground transition-colors duration-150 motion-reduce:transition-none",
        "hover:border-primary/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 disabled:cursor-default disabled:opacity-45",
        "[[data-pmx-glass='1']_&]:border-foreground/15 [[data-pmx-glass='1']_&]:bg-card/65",
        copied && "border-success/40 bg-success/12 text-success-foreground",
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

function MatchLineRow({ match }: { readonly match: DshSearchMatchLine }) {
  return (
    <div
      data-dsh-search-line="true"
      className={cn(
        "flex min-w-0 items-baseline gap-2.5 px-3.5 py-0.5 font-mono text-2xs leading-relaxed transition-colors duration-75 motion-reduce:transition-none",
        "hover:bg-muted/35 [[data-pmx-glass='1']_&]:hover:bg-foreground/6",
      )}
    >
      {match.lineNumber !== undefined ? (
        <span
          aria-hidden="true"
          data-dsh-line-number={match.lineNumber}
          className="w-9 shrink-0 select-none text-right tabular-nums text-muted-foreground/70"
        >
          {match.lineNumber}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 overflow-x-auto whitespace-pre text-foreground/90 select-text">
        {match.text}
      </div>
    </div>
  );
}

function GroupedMatchesBody({
  groups,
  maxLines,
}: {
  readonly groups: ReadonlyArray<DshSearchFileGroup>;
  readonly maxLines: number;
}) {
  const [expandedAll, setExpandedAll] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());

  const { slice, sections } = buildGroupedMatchRenderSections(groups, maxLines, expandedAll);

  const toggleGroup = (path: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (groups.length === 0) {
    return (
      <div className="px-3.5 py-2.5 text-xs italic text-muted-foreground">
        {DSH_SEARCH_COPY_ZH.emptyMatches}
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/40 [[data-pmx-glass='1']_&]:divide-foreground/10">
      {sections.map((section) => {
        if (section.kind === "gap") {
          return (
            <button
              key={section.key}
              type="button"
              data-dsh-expand-toggle="true"
              onClick={(event) => {
                event.stopPropagation();
                setExpandedAll(true);
              }}
              className={DSH_GAP_TOGGLE_CLASS}
            >
              {DSH_SEARCH_COPY_ZH.expandMoreLines(slice.hiddenCount)}
            </button>
          );
        }

        const { group, headMatches, tailMatches, needsGapBeforeGroup, needsGapInsideGroup } =
          section;
        const isGroupCollapsed = collapsedGroups.has(group.path);

        return (
          <div key={group.path} data-dsh-search-file-group={group.displayPath}>
            {needsGapBeforeGroup ? (
              <button
                type="button"
                data-dsh-expand-toggle="true"
                onClick={(event) => {
                  event.stopPropagation();
                  setExpandedAll(true);
                }}
                className={cn(
                  DSH_GAP_TOGGLE_CLASS,
                  "border-b border-border/45 [[data-pmx-glass='1']_&]:border-foreground/12",
                )}
              >
                {DSH_SEARCH_COPY_ZH.expandMoreLines(slice.hiddenCount)}
              </button>
            ) : null}
            <button
              type="button"
              aria-expanded={!isGroupCollapsed}
              data-dsh-file-group-toggle="true"
              onClick={(event) => {
                event.stopPropagation();
                toggleGroup(group.path);
              }}
              className={cn(
                "flex w-full cursor-pointer items-center justify-between gap-2 bg-muted/18 px-3.5 py-1.5 text-left transition-colors duration-100 motion-reduce:transition-none",
                "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
                "[[data-pmx-glass='1']_&]:bg-background/20 [[data-pmx-glass='1']_&]:hover:bg-foreground/6",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <ChevronRightIcon
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none",
                    !isGroupCollapsed && "rotate-90",
                  )}
                />
                <span className="min-w-0 truncate font-mono text-2xs font-semibold text-foreground">
                  {group.displayPath}
                </span>
              </span>
              <span className="shrink-0 rounded-full border border-border/50 bg-background/70 px-1.5 py-0.5 font-mono text-3xs tabular-nums text-muted-foreground [[data-pmx-glass='1']_&]:border-foreground/14 [[data-pmx-glass='1']_&]:bg-card/65">
                {DSH_SEARCH_COPY_ZH.matchCountPill(group.matches.length)}
              </span>
            </button>
            <div
              data-disclosure-panel={!isGroupCollapsed ? "open" : "closed"}
              aria-hidden={isGroupCollapsed}
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
                !isGroupCollapsed ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="py-1">
                  {headMatches.map(({ match, globalIndex }) => (
                    <MatchLineRow key={`${group.path}:${globalIndex}`} match={match} />
                  ))}
                  {needsGapInsideGroup ? (
                    <button
                      type="button"
                      data-dsh-expand-toggle="true"
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedAll(true);
                      }}
                      className={cn(
                        DSH_GAP_TOGGLE_CLASS,
                        "my-0.5 border-y border-border/40 [[data-pmx-glass='1']_&]:border-foreground/10",
                      )}
                    >
                      {DSH_SEARCH_COPY_ZH.expandMoreLines(slice.hiddenCount)}
                    </button>
                  ) : null}
                  {tailMatches.map(({ match, globalIndex }) => (
                    <MatchLineRow key={`${group.path}:${globalIndex}`} match={match} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      {slice.collapsed && expandedAll ? (
        <button
          type="button"
          data-dsh-collapse-toggle="true"
          onClick={(event) => {
            event.stopPropagation();
            setExpandedAll(false);
          }}
          className={DSH_GAP_TOGGLE_CLASS}
        >
          {DSH_SEARCH_COPY_ZH.collapse}
        </button>
      ) : null}
    </div>
  );
}

function FlatPathsBody({
  paths,
  maxLines,
}: {
  readonly paths: ReadonlyArray<{ readonly path: string; readonly displayPath: string }>;
  readonly maxLines: number;
}) {
  const [expandedAll, setExpandedAll] = useState(false);
  const slice = computeHeadTailSlice(paths.length, maxLines);

  if (paths.length === 0) {
    return (
      <div className="px-3.5 py-2.5 text-xs italic text-muted-foreground">
        {DSH_SEARCH_COPY_ZH.emptyPaths}
      </div>
    );
  }

  const head = slice.collapsed && !expandedAll ? paths.slice(0, slice.headCount) : paths;
  const tail =
    slice.collapsed && !expandedAll ? paths.slice(paths.length - slice.tailCount) : [];

  const renderPathRow = (entry: { readonly path: string; readonly displayPath: string }) => (
    <div
      key={entry.path}
      data-dsh-search-path="true"
      className={cn(
        "flex min-w-0 items-center gap-2 px-3.5 py-1 font-mono text-2xs leading-relaxed transition-colors duration-75 motion-reduce:transition-none",
        "hover:bg-muted/35 [[data-pmx-glass='1']_&]:hover:bg-foreground/6",
      )}
    >
      <FileTextIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground/75" />
      <div className="min-w-0 flex-1 overflow-x-auto whitespace-pre text-foreground/90 select-text">
        {entry.displayPath}
      </div>
    </div>
  );

  return (
    <div className="py-1">
      {head.map(renderPathRow)}
      {slice.collapsed && !expandedAll ? (
        <button
          type="button"
          data-dsh-expand-toggle="true"
          onClick={(event) => {
            event.stopPropagation();
            setExpandedAll(true);
          }}
          className={cn(
            DSH_GAP_TOGGLE_CLASS,
            "my-0.5 border-y border-border/45 [[data-pmx-glass='1']_&]:border-foreground/12",
          )}
        >
          {DSH_SEARCH_COPY_ZH.expandMoreLines(slice.hiddenCount)}
        </button>
      ) : null}
      {tail.map(renderPathRow)}
      {slice.collapsed && expandedAll ? (
        <button
          type="button"
          data-dsh-collapse-toggle="true"
          onClick={(event) => {
            event.stopPropagation();
            setExpandedAll(false);
          }}
          className={cn(
            DSH_GAP_TOGGLE_CLASS,
            "mt-0.5 border-t border-border/45 [[data-pmx-glass='1']_&]:border-foreground/12",
          )}
        >
          {DSH_SEARCH_COPY_ZH.collapse}
        </button>
      ) : null}
    </div>
  );
}

export interface DshSearchBlockProps {
  readonly data?: NormalizedDshSearchData | null | undefined;
  readonly entry?: WorkLogEntry | null | undefined;
  readonly item?: OrchestrationV2TurnItem | null | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly outputText?: string | undefined;
  readonly maxLines?: number | undefined;
  readonly className?: string | undefined;
}

/**
 * 1:1 DSH NEXT `SearchBlock` for code/file search (`grep` / `glob` / `file_search`) across all agents.
 */
export const DshSearchBlock = memo(function DshSearchBlock({
  data: explicitData,
  entry,
  item,
  workspaceRoot,
  outputText,
  maxLines = DEFAULT_SEARCH_MAX_LINES,
  className,
}: DshSearchBlockProps) {
  const data =
    explicitData !== undefined
      ? explicitData
      : item
        ? normalizeSearchTurnItem(item, workspaceRoot, outputText)
        : entry
          ? normalizeSearchWorkEntry(entry, workspaceRoot, outputText)
          : null;

  if (!data) return null;

  return (
    <div
      data-v2-item-inspector="file_search"
      data-step-detail-card="file_search"
      data-dsh-search-block={data.kind}
      className={cn(DSH_CARD_CHROME_CLASS, className)}
    >
      <div className={DSH_CARD_HEADER_CLASS}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {data.kind === "matches" ? (
            <SearchIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <FolderSearchIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          )}
          {data.query ? (
            <code className="max-w-full truncate rounded border border-border/50 bg-background/75 px-1.5 py-0.5 font-mono text-2xs font-medium text-foreground [[data-pmx-glass='1']_&]:border-foreground/14 [[data-pmx-glass='1']_&]:bg-card/65">
              {data.query}
            </code>
          ) : null}
          {data.scope ? (
            <span className="truncate font-mono text-2xs text-muted-foreground">{data.scope}</span>
          ) : null}
          <span
            data-dsh-search-summary="true"
            className="font-medium tabular-nums text-muted-foreground"
          >
            {data.summaryZh}
          </span>
        </div>
        <DshCopyButton text={data.copyText} />
      </div>

      {data.kind === "matches" ? (
        <GroupedMatchesBody groups={data.groups} maxLines={maxLines} />
      ) : (
        <FlatPathsBody paths={data.paths} maxLines={maxLines} />
      )}
    </div>
  );
});

function httpStatusPillClass(status: number): string {
  if (status >= 200 && status < 300) {
    return "border-success/35 bg-success/12 text-success-foreground";
  }
  if (status >= 300 && status < 400) {
    return "border-warning/35 bg-warning/12 text-warning-foreground";
  }
  return "border-destructive/35 bg-destructive/12 text-destructive";
}

function WebSourceRow({
  source,
  index,
}: {
  readonly source: DshWebSource;
  readonly index: number;
}) {
  return (
    <li
      data-dsh-web-source="true"
      className={cn(
        "space-y-1 px-3.5 py-2.5 transition-colors duration-100 motion-reduce:transition-none",
        "hover:bg-muted/25 [[data-pmx-glass='1']_&]:hover:bg-foreground/5",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-border/55 bg-muted/45 font-mono text-3xs font-medium tabular-nums text-muted-foreground [[data-pmx-glass='1']_&]:border-foreground/15 [[data-pmx-glass='1']_&]:bg-card/65">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          {source.safeHref ? (
            <a
              href={source.safeHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="inline-flex max-w-full items-center gap-1 rounded-sm text-xs font-medium text-foreground transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
            >
              <span className="truncate">{source.title}</span>
              <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0 opacity-75" />
            </a>
          ) : (
            <div className="truncate text-xs font-medium text-foreground/85">{source.title}</div>
          )}
          {source.hostname || source.publishedDate ? (
            <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
              {source.hostname ? (
                <span className="truncate font-mono">{source.hostname}</span>
              ) : null}
              {source.hostname && source.publishedDate ? <span aria-hidden="true">·</span> : null}
              {source.publishedDate ? (
                <span className="tabular-nums">{source.publishedDate}</span>
              ) : null}
            </div>
          ) : null}
          {source.snippet ? (
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {source.snippet}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export interface DshWebBlockProps {
  readonly data?: NormalizedDshWebData | null | undefined;
  readonly entry?: WorkLogEntry | null | undefined;
  readonly item?: OrchestrationV2TurnItem | null | undefined;
  readonly outputText?: string | undefined;
  readonly renderMarkdown?: ((markdown: string) => ReactNode) | undefined;
  readonly className?: string | undefined;
}

/**
 * 1:1 DSH NEXT `WebBlock` for `web_search` and `web_fetch` across all agents.
 */
export const DshWebBlock = memo(function DshWebBlock({
  data: explicitData,
  entry,
  item,
  outputText,
  renderMarkdown,
  className,
}: DshWebBlockProps) {
  const [excerptExpanded, setExcerptExpanded] = useState(false);

  const data =
    explicitData !== undefined
      ? explicitData
      : item
        ? normalizeWebTurnItem(item, outputText)
        : entry
          ? normalizeWebWorkEntry(entry, outputText)
          : null;

  if (!data) return null;

  if (data.kind === "fetch") {
    const excerptLines = data.excerpt ? data.excerpt.replace(/\r\n/gu, "\n").split("\n") : [];
    const hasLongExcerpt = excerptLines.length > 10;
    const displayedExcerpt =
      data.excerpt && hasLongExcerpt && !excerptExpanded
        ? excerptLines.slice(0, 10).join("\n")
        : data.excerpt;

    return (
      <div
        data-v2-item-inspector="web_search"
        data-step-detail-card="web_fetch"
        data-dsh-web-block="fetch"
        className={cn(DSH_CARD_CHROME_CLASS, className)}
      >
        <div className={DSH_CARD_HEADER_CLASS}>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <GlobeIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            {data.safeHref ? (
              <a
                href={data.safeHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm font-mono text-2xs font-medium text-foreground transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
              >
                <span className="truncate">{data.url}</span>
                <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0 opacity-75" />
              </a>
            ) : (
              <span className="min-w-0 truncate font-mono text-2xs font-medium text-foreground/85">
                {data.url || DSH_SEARCH_COPY_ZH.webFetchFallback}
              </span>
            )}
            {data.httpStatus !== undefined ? (
              <span
                data-dsh-http-status={data.httpStatus}
                className={cn(
                  "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-3xs font-medium tabular-nums",
                  httpStatusPillClass(data.httpStatus),
                )}
              >
                {`HTTP ${data.httpStatus}`}
              </span>
            ) : null}
            {data.truncated ? (
              <span
                data-dsh-web-truncated="true"
                className="inline-flex shrink-0 items-center rounded-full border border-warning/35 bg-warning/12 px-2 py-0.5 text-3xs font-medium text-warning-foreground"
              >
                {DSH_SEARCH_COPY_ZH.contentTruncated}
              </span>
            ) : null}
          </div>
          <DshCopyButton text={data.copyText} />
        </div>

        {data.title || data.contentType || displayedExcerpt ? (
          <div className="space-y-2 px-3.5 py-2.5">
            {data.title || data.contentType ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {data.title ? (
                  <span className="font-medium text-foreground">{data.title}</span>
                ) : null}
                {data.contentType ? (
                  <span className="rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-3xs text-muted-foreground [[data-pmx-glass='1']_&]:border-foreground/14 [[data-pmx-glass='1']_&]:bg-card/65">
                    {data.contentType}
                  </span>
                ) : null}
              </div>
            ) : null}
            {displayedExcerpt ? (
              <div className="space-y-1.5">
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed text-foreground/85 select-text">
                  {displayedExcerpt}
                </pre>
                {hasLongExcerpt ? (
                  <button
                    type="button"
                    data-dsh-expand-toggle="true"
                    onClick={(event) => {
                      event.stopPropagation();
                      setExcerptExpanded((prev) => !prev);
                    }}
                    className="cursor-pointer rounded-sm text-2xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                  >
                    {excerptExpanded
                      ? DSH_SEARCH_COPY_ZH.collapse
                      : DSH_SEARCH_COPY_ZH.expandMoreLines(excerptLines.length - 10)}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      data-v2-item-inspector="web_search"
      data-step-detail-card="web_search"
      data-dsh-web-block="search"
      className={cn(DSH_CARD_CHROME_CLASS, className)}
    >
      <div className={DSH_CARD_HEADER_CLASS}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <GlobeIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          {data.queries.map((query) => (
            <span
              key={query}
              className="inline-flex max-w-full items-center truncate rounded-md border border-border/50 bg-background/75 px-2 py-0.5 font-mono text-2xs text-foreground/90 [[data-pmx-glass='1']_&]:border-foreground/14 [[data-pmx-glass='1']_&]:bg-card/65"
            >
              {query}
            </span>
          ))}
          <span
            data-dsh-web-summary="true"
            className="font-medium tabular-nums text-muted-foreground"
          >
            {data.summaryZh}
          </span>
        </div>
        <DshCopyButton text={data.copyText} />
      </div>

      {data.answerMarkdown ? (
        <div
          data-dsh-web-answer="true"
          className="border-b border-border/45 px-3.5 py-2.5 text-xs leading-relaxed text-foreground/90 [[data-pmx-glass='1']_&]:border-foreground/12"
        >
          {renderMarkdown ? (
            renderMarkdown(data.answerMarkdown)
          ) : (
            <div className="whitespace-pre-wrap break-words">{data.answerMarkdown}</div>
          )}
        </div>
      ) : null}

      {data.sources.length > 0 ? (
        <ol className="max-h-80 divide-y divide-border/40 overflow-y-auto [[data-pmx-glass='1']_&]:divide-foreground/10">
          {data.sources.map((source, index) => (
            <WebSourceRow key={source.url} source={source} index={index} />
          ))}
        </ol>
      ) : !data.answerMarkdown ? (
        <div className="px-3.5 py-2.5 text-xs italic text-muted-foreground">
          {DSH_SEARCH_COPY_ZH.emptySources}
        </div>
      ) : null}

      {data.truncated ? (
        <div
          data-dsh-web-truncated="true"
          className="border-t border-border/45 bg-muted/20 px-3.5 py-1.5 text-2xs text-muted-foreground [[data-pmx-glass='1']_&]:border-foreground/12 [[data-pmx-glass='1']_&]:bg-background/25"
        >
          {DSH_SEARCH_COPY_ZH.partialSourcesTruncated}
        </div>
      ) : null}
    </div>
  );
});
