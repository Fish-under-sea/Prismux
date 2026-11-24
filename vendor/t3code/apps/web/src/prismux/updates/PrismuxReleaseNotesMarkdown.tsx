import type { Element as HastElement } from "hast";
import type { Components } from "hast-util-to-jsx-runtime";
import { memo, useMemo, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { createMarkdownRenderer } from "../../components/chat/markdownRenderer";
import {
  openSafeExternalHttpsFromAnchor,
  validateSafeHttpsUrl,
} from "../../components/settings/prismuxProviderMeta";
import { cn } from "../../lib/utils";

type HastComponentProps<T extends keyof React.JSX.IntrinsicElements> =
  ComponentPropsWithoutRef<T> & {
    readonly node?: HastElement | undefined;
  };

function ReleaseHeading1({ node: _node, className, children, ...props }: HastComponentProps<"h1">) {
  return (
    <h1
      {...props}
      className={cn(
        "border-b border-border/55 pb-1.5 text-[14.5px] font-semibold tracking-tight text-foreground first:mt-0 mt-3",
        className,
      )}
    >
      {children}
    </h1>
  );
}

function ReleaseHeading2({ node: _node, className, children, ...props }: HastComponentProps<"h2">) {
  return (
    <h2
      {...props}
      className={cn(
        "border-b border-border/50 pb-1.5 text-[14px] font-semibold tracking-tight text-foreground first:mt-0 mt-3.5",
        className,
      )}
    >
      {children}
    </h2>
  );
}

function ReleaseHeading3({ node: _node, className, children, ...props }: HastComponentProps<"h3">) {
  return (
    <h3
      {...props}
      className={cn(
        "text-[13px] font-semibold leading-snug text-foreground first:mt-0 mt-3.5",
        className,
      )}
    >
      {children}
    </h3>
  );
}

function ReleaseHeading4({ node: _node, className, children, ...props }: HastComponentProps<"h4">) {
  return (
    <h4
      {...props}
      className={cn("text-xs font-semibold text-foreground/90 first:mt-0 mt-2", className)}
    >
      {children}
    </h4>
  );
}

function ReleaseParagraph({ node: _node, className, children, ...props }: HastComponentProps<"p">) {
  return (
    <p
      {...props}
      className={cn("text-xs leading-[1.65] text-foreground/88 break-words", className)}
    >
      {children}
    </p>
  );
}

function ReleaseBlockquote({
  node: _node,
  className,
  children,
  ...props
}: HastComponentProps<"blockquote">) {
  return (
    <blockquote
      {...props}
      className={cn(
        "my-2 space-y-1.5 rounded-r-lg border-l-[3px] border-primary/65 bg-primary/[0.06] px-3 py-2 text-xs leading-relaxed text-foreground/90 dark:bg-primary/[0.1]",
        className,
      )}
    >
      {children}
    </blockquote>
  );
}

function ReleaseUnorderedList({
  node: _node,
  className,
  children,
  ...props
}: HastComponentProps<"ul">) {
  return (
    <ul
      {...props}
      className={cn(
        "my-1.5 list-disc space-y-1.5 pl-4.5 text-[12.5px] leading-[1.65] text-foreground/88 [&_ul]:mt-1 [&_ul]:list-[circle]",
        className,
      )}
    >
      {children}
    </ul>
  );
}

function ReleaseOrderedList({
  node: _node,
  className,
  children,
  ...props
}: HastComponentProps<"ol">) {
  return (
    <ol
      {...props}
      className={cn(
        "my-1.5 list-decimal space-y-1.5 pl-4.5 text-[12.5px] leading-[1.65] text-foreground/88 [&_ol]:mt-1",
        className,
      )}
    >
      {children}
    </ol>
  );
}

function ReleaseListItem({ node: _node, className, children, ...props }: HastComponentProps<"li">) {
  return (
    <li {...props} className={cn("leading-[1.65] marker:text-primary/70", className)}>
      {children}
    </li>
  );
}

function ReleaseStrong({
  node: _node,
  className,
  children,
  ...props
}: HastComponentProps<"strong">) {
  return (
    <strong {...props} className={cn("font-semibold text-foreground", className)}>
      {children}
    </strong>
  );
}

function ReleaseEmphasis({ node: _node, className, children, ...props }: HastComponentProps<"em">) {
  return (
    <em {...props} className={cn("italic text-foreground/92", className)}>
      {children}
    </em>
  );
}

function ReleaseDelete({ node: _node, className, children, ...props }: HastComponentProps<"del">) {
  return (
    <del {...props} className={cn("line-through text-muted-foreground", className)}>
      {children}
    </del>
  );
}

function ReleaseHorizontalRule({ node: _node, className, ...props }: HastComponentProps<"hr">) {
  return <hr {...props} className={cn("my-3 border-0 border-t border-border/65", className)} />;
}

function ReleasePre({ node: _node, className, children, ...props }: HastComponentProps<"pre">) {
  return (
    <pre
      {...props}
      className={cn(
        "my-2 max-w-full overflow-x-auto rounded-lg border border-border/65 bg-foreground/[0.045] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground dark:bg-black/30",
        className,
      )}
    >
      {children}
    </pre>
  );
}

function ReleaseCode({
  node: _node,
  className,
  children,
  ...props
}: HastComponentProps<"code"> & { readonly "data-inline-code"?: string | undefined }) {
  const isInline = "data-inline-code" in props || !className?.includes("language-");
  const { "data-inline-code": _inlineAttr, ...rest } = props;
  if (!isInline) {
    return (
      <code {...rest} className={cn("font-mono text-[11px] text-foreground", className)}>
        {children}
      </code>
    );
  }
  return (
    <code
      {...rest}
      className={cn(
        "rounded-md border border-border/55 bg-foreground/[0.07] px-1.5 py-[1px] font-mono text-[11px] font-medium text-foreground/95 dark:border-white/12 dark:bg-white/[0.1] in-[pre]:border-0 in-[pre]:bg-transparent in-[pre]:p-0 in-[pre]:rounded-none in-[pre]:font-normal",
        className,
      )}
    >
      {children}
    </code>
  );
}

function ReleaseTable({
  node: _node,
  className,
  children,
  ...props
}: HastComponentProps<"table">) {
  return (
    <div
      data-pmx-release-notes-table-wrap="1"
      className="my-2.5 w-full max-w-full overflow-x-auto rounded-lg border border-border/65 bg-background/40 dark:bg-white/[0.02]"
    >
      <table
        {...props}
        className={cn("w-full border-collapse text-left text-[11.5px] leading-snug", className)}
      >
        {children}
      </table>
    </div>
  );
}

function ReleaseTableHead({
  node: _node,
  className,
  children,
  ...props
}: HastComponentProps<"thead">) {
  return (
    <thead
      {...props}
      className={cn(
        "border-b border-border/70 bg-foreground/[0.045] text-foreground dark:bg-white/[0.05]",
        className,
      )}
    >
      {children}
    </thead>
  );
}

function ReleaseTableBody({
  node: _node,
  className,
  children,
  ...props
}: HastComponentProps<"tbody">) {
  return (
    <tbody {...props} className={cn("divide-y divide-border/50", className)}>
      {children}
    </tbody>
  );
}

function ReleaseTableRow({ node: _node, className, children, ...props }: HastComponentProps<"tr">) {
  return (
    <tr
      {...props}
      className={cn(
        "transition-colors hover:bg-foreground/[0.025] dark:hover:bg-white/[0.03]",
        className,
      )}
    >
      {children}
    </tr>
  );
}

function ReleaseTableHeaderCell({
  node: _node,
  className,
  children,
  ...props
}: HastComponentProps<"th">) {
  return (
    <th
      {...props}
      className={cn(
        "whitespace-nowrap px-2.5 py-1.5 font-semibold text-foreground",
        className,
      )}
    >
      {children}
    </th>
  );
}

function ReleaseTableCell({
  node: _node,
  className,
  children,
  ...props
}: HastComponentProps<"td">) {
  return (
    <td
      {...props}
      className={cn("px-2.5 py-1.5 align-top text-foreground/88 tabular-nums", className)}
    >
      {children}
    </td>
  );
}

function ReleaseLink({
  node: _node,
  href,
  className,
  children,
  ...props
}: HastComponentProps<"a">) {
  const safeHref = validateSafeHttpsUrl(href);
  if (!safeHref) {
    return <span className={className}>{children}</span>;
  }
  return (
    <a
      {...props}
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        openSafeExternalHttpsFromAnchor(event);
      }}
      className={cn(
        "font-medium text-primary underline decoration-primary/45 underline-offset-2 transition-colors hover:text-primary/85 hover:decoration-primary",
        className,
      )}
    >
      {children}
    </a>
  );
}

function ReleaseImage({ node: _node, src, alt, className, ...props }: HastComponentProps<"img">) {
  const safeSrc = validateSafeHttpsUrl(src);
  if (!safeSrc) {
    return alt ? <span className="text-muted-foreground">{alt}</span> : null;
  }
  return (
    <img
      {...props}
      src={safeSrc}
      alt={alt ?? ""}
      loading="lazy"
      decoding="async"
      className={cn("my-2 max-h-56 max-w-full rounded-lg border border-border/60 object-contain", className)}
    />
  );
}

const RELEASE_NOTES_MARKDOWN_COMPONENTS: Partial<Components> = {
  h1: ReleaseHeading1,
  h2: ReleaseHeading2,
  h3: ReleaseHeading3,
  h4: ReleaseHeading4,
  h5: ReleaseHeading4,
  h6: ReleaseHeading4,
  p: ReleaseParagraph,
  blockquote: ReleaseBlockquote,
  ul: ReleaseUnorderedList,
  ol: ReleaseOrderedList,
  li: ReleaseListItem,
  strong: ReleaseStrong,
  em: ReleaseEmphasis,
  del: ReleaseDelete,
  hr: ReleaseHorizontalRule,
  pre: ReleasePre,
  code: ReleaseCode as Components["code"],
  table: ReleaseTable,
  thead: ReleaseTableHead,
  tbody: ReleaseTableBody,
  tr: ReleaseTableRow,
  th: ReleaseTableHeaderCell,
  td: ReleaseTableCell,
  a: ReleaseLink,
  img: ReleaseImage,
};

const releaseNotesRenderer = createMarkdownRenderer({
  markdown: {
    math: false,
    breaks: false,
    escapeHtml: true,
    insights: false,
    extensions: { githubEmoji: true },
  },
  urlTransform: (url, key) => {
    if (key === "href" || key === "src") {
      return validateSafeHttpsUrl(url) ?? "";
    }
    return "";
  },
  components: RELEASE_NOTES_MARKDOWN_COMPONENTS,
});

export interface PrismuxReleaseNotesMarkdownProps {
  readonly markdown: string | null | undefined;
  readonly fallback?: ReactNode;
  readonly className?: string;
  readonly "data-testid"?: string;
}

/**
 * Safe, sanitized CommonMark + GFM release notes renderer shared by:
 * 1. Settings -> About / Updates (`PrismuxUpdatesSettingsPage`)
 * 2. Centered Auto-Update Announcement Dialog (`PrismuxUpdateReleaseModal`)
 *
 * Uses `@t3tools/web`'s `@pierre/words` + `sanitizeChatHast` + `hast-util-to-jsx-runtime`
 * pipeline (zero `dangerouslySetInnerHTML`, strict `https:` external links routed through
 * Electron `openExternal`).
 */
export const PrismuxReleaseNotesMarkdown = memo(function PrismuxReleaseNotesMarkdown({
  markdown,
  fallback = null,
  className,
  "data-testid": testId,
}: PrismuxReleaseNotesMarkdownProps) {
  const trimmed = typeof markdown === "string" ? markdown.trim() : "";

  const renderedElement = useMemo(() => {
    if (!trimmed) return null;
    const entry = releaseNotesRenderer.parse(trimmed);
    const element = releaseNotesRenderer.element(entry);
    releaseNotesRenderer.remember(trimmed, entry);
    return element;
  }, [trimmed]);

  return (
    <div
      data-pmx-release-notes-markdown="1"
      data-testid={testId}
      className={cn("space-y-2 text-xs leading-relaxed text-foreground/90", className)}
    >
      {renderedElement ?? fallback}
    </div>
  );
});
