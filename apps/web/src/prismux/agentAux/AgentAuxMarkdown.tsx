import { ImageIcon } from "lucide-react";
import { memo, useMemo, useState, type ReactNode } from "react";

import {
  formatAuxBoardMemberHandle,
  formatAuxBoardStatusTag,
  getAuxStrings,
  localizeAuxBoardPlainText,
  type AgentAuxLocale,
  type AuxBoardStatusTagKind,
} from "./agentAux.i18n";
import {
  extractScreenshotsFromText,
  stripLeadingMentionTokens,
  tokenizeBoardText,
  type AgentAuxScreenshotRef,
} from "./agentAux.logic";

export interface AgentAuxMarkdownProps {
  readonly text: string;
  readonly knownNames: ReadonlySet<string>;
  readonly maxSeq: number;
  readonly mentions?: readonly string[];
  readonly all?: boolean;
  readonly stripLeadingMentions?: boolean;
  readonly clamp?: boolean;
  readonly locale: AgentAuxLocale;
  readonly onJumpSeq?: (seq: number) => void;
  readonly onClickMention?: (name: string) => void;
  readonly screenshots?: readonly AgentAuxScreenshotRef[];
}

type MdBlock =
  | { readonly kind: "heading"; readonly level: number; readonly text: string }
  | { readonly kind: "code"; readonly lang: string; readonly code: string }
  | { readonly kind: "ul"; readonly items: readonly string[] }
  | { readonly kind: "ol"; readonly items: readonly string[] }
  | { readonly kind: "p"; readonly text: string };

const SCREENSHOT_ONLY_LINE_RE = /^\s*Screenshot:\s*.+$/i;

function parseMarkdownBlocks(rawText: string): readonly MdBlock[] {
  const lines = rawText.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed || SCREENSHOT_ONLY_LINE_RE.test(trimmed)) {
      i += 1;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1; // skip closing fence
      blocks.push({ kind: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    // Heading (# .. ####)
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch?.[1] && headingMatch[2]) {
      blocks.push({
        kind: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      i += 1;
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const cur = (lines[i] ?? "").trim();
        const m = /^[-*+]\s+(.+)$/.exec(cur);
        if (!m?.[1]) break;
        items.push(m[1]);
        i += 1;
      }
      if (items.length > 0) {
        blocks.push({ kind: "ul", items });
        continue;
      }
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const cur = (lines[i] ?? "").trim();
        const m = /^\d+\.\s+(.+)$/.exec(cur);
        if (!m?.[1]) break;
        items.push(m[1]);
        i += 1;
      }
      if (items.length > 0) {
        blocks.push({ kind: "ol", items });
        continue;
      }
    }

    // Paragraph (join contiguous non-structural lines)
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = (lines[i] ?? "").trim();
      if (
        !cur ||
        cur.startsWith("```") ||
        /^#{1,4}\s+/.test(cur) ||
        /^[-*+]\s+/.test(cur) ||
        /^\d+\.\s+/.test(cur) ||
        SCREENSHOT_ONLY_LINE_RE.test(cur)
      ) {
        break;
      }
      paraLines.push(lines[i] ?? "");
      i += 1;
    }
    if (paraLines.length > 0) {
      blocks.push({ kind: "p", text: paraLines.join("\n") });
    }
  }

  return blocks;
}

const INLINE_FORMAT_RE =
  /(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(\[(?:done|blocked|stall)\])/gi;

function renderFormattedSpan(
  text: string,
  knownNames: ReadonlySet<string>,
  maxSeq: number,
  locale: AgentAuxLocale,
  onJumpSeq?: (seq: number) => void,
  onClickMention?: (name: string) => void,
  keyPrefix = "",
): ReactNode[] {
  const s = getAuxStrings(locale);
  const tokens = tokenizeBoardText(text, knownNames, maxSeq);
  const out: ReactNode[] = [];

  tokens.forEach((tok, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (tok.kind === "code") {
      out.push(
        <code key={key} className="pmx-aux-inline-code">
          {tok.value}
        </code>,
      );
      return;
    }
    if (tok.kind === "seq") {
      out.push(
        <button
          key={key}
          type="button"
          className="pmx-aux-seq-pill"
          onClick={(e) => {
            e.stopPropagation();
            onJumpSeq?.(tok.seq);
          }}
        >
          {tok.value}
        </button>,
      );
      return;
    }
    if (tok.kind === "mention") {
      const className = tok.isAll ? "pmx-aux-mention pmx-aux-mention--all" : "pmx-aux-mention";
      const displayLabel = tok.isAll
        ? s.boardBroadcastAllMention
        : formatAuxBoardMemberHandle(tok.name, locale);
      const rawMemberId = tok.isAll ? "all" : tok.name;
      if (!tok.isAll && onClickMention) {
        out.push(
          <button
            key={key}
            type="button"
            className={`${className} pmx-aux-mention--btn`}
            data-aux-member-id={rawMemberId}
            onClick={(e) => {
              e.stopPropagation();
              onClickMention(tok.name);
            }}
          >
            {displayLabel}
          </button>,
        );
      } else {
        out.push(
          <span key={key} className={className} data-aux-member-id={rawMemberId}>
            {displayLabel}
          </span>,
        );
      }
      return;
    }

    // Plain text: localize known provider/system notices and apply safe inline formatting
    const raw = localizeAuxBoardPlainText(tok.value, locale);
    let cursor = 0;
    let partIdx = 0;
    for (const match of raw.matchAll(INLINE_FORMAT_RE)) {
      const start = match.index ?? 0;
      if (start > cursor) {
        out.push(<span key={`${key}-t${partIdx++}`}>{raw.slice(cursor, start)}</span>);
      }
      const m0 = match[0];
      if (match[1]) {
        out.push(<strong key={`${key}-b${partIdx++}`}>{m0.slice(2, -2)}</strong>);
      } else if (match[2]) {
        out.push(<del key={`${key}-s${partIdx++}`}>{m0.slice(2, -2)}</del>);
      } else if (match[3]) {
        out.push(<em key={`${key}-i${partIdx++}`}>{m0.slice(1, -1)}</em>);
      } else if (match[4]) {
        const tagKind = m0.toLowerCase().slice(1, -1) as AuxBoardStatusTagKind;
        out.push(
          <span
            key={`${key}-tag${partIdx++}`}
            className={`pmx-aux-md-tag pmx-aux-md-tag--${tagKind}`}
            data-aux-status-tag={tagKind}
          >
            {formatAuxBoardStatusTag(tagKind, locale)}
          </span>,
        );
      }
      cursor = start + m0.length;
    }
    if (cursor < raw.length) {
      out.push(<span key={`${key}-e${partIdx++}`}>{raw.slice(cursor)}</span>);
    }
  });

  return out;
}

/**
 * Lightweight, safe, zero-HTML Markdown renderer for AgentAux Board & Replay captions.
 * Supports headings, lists, bold/italic/strikethrough, fenced/inline code, clickable
 * `@member` / `#seq` pills, `[done]`/`[blocked]`/`[stall]` status chips, `Screenshot:`
 * attachment pills, and 5-line gradient fade clamping with expand/collapse.
 */
export const AgentAuxMarkdown = memo(function AgentAuxMarkdown({
  text,
  knownNames,
  maxSeq,
  mentions = [],
  all = false,
  stripLeadingMentions = false,
  clamp = false,
  locale,
  onJumpSeq,
  onClickMention,
  screenshots,
}: AgentAuxMarkdownProps) {
  const s = getAuxStrings(locale);
  const [expanded, setExpanded] = useState(false);

  const normalizedText = useMemo(() => {
    return stripLeadingMentions ? stripLeadingMentionTokens(text, mentions, all) : text;
  }, [text, mentions, all, stripLeadingMentions]);

  const resolvedScreenshots = useMemo(() => {
    if (screenshots && screenshots.length > 0) return screenshots;
    return extractScreenshotsFromText(text);
  }, [screenshots, text]);

  const blocks = useMemo(() => parseMarkdownBlocks(normalizedText), [normalizedText]);

  const shouldClamp =
    clamp &&
    (normalizedText.length > 290 || normalizedText.split("\n").length > 5 || blocks.length > 3);

  return (
    <div className="pmx-aux-md-wrap">
      <div
        className={`pmx-aux-md${shouldClamp && !expanded ? " pmx-aux-md--clamped" : ""}`}
        onClick={shouldClamp && !expanded ? () => setExpanded(true) : undefined}
      >
        {blocks.map((block, bIdx) => {
          const blockKey = `${block.kind}-${bIdx === 0 ? "first" : bIdx}-${block.kind === "code" ? block.code.slice(0, 20) : block.kind === "ul" || block.kind === "ol" ? (block.items[0]?.slice(0, 20) ?? "") : block.text.slice(0, 20)}`;
          if (block.kind === "code") {
            return (
              <pre key={blockKey} className="pmx-aux-md-pre">
                <code>{block.code}</code>
              </pre>
            );
          }
          if (block.kind === "heading") {
            return (
              <p key={blockKey} className="pmx-aux-md-h">
                {renderFormattedSpan(
                  block.text,
                  knownNames,
                  maxSeq,
                  locale,
                  onJumpSeq,
                  onClickMention,
                  `h-${blockKey}`,
                )}
              </p>
            );
          }
          if (block.kind === "ul") {
            return (
              <ul key={blockKey} className="pmx-aux-md-ul">
                {block.items.map((item, li) => (
                  <li
                    key={`${blockKey}-item-${item.slice(0, 24)}-${item.length}-${li === 0 ? "a" : "b"}`}
                  >
                    {renderFormattedSpan(
                      item,
                      knownNames,
                      maxSeq,
                      locale,
                      onJumpSeq,
                      onClickMention,
                      `ul-${blockKey}-${li}`,
                    )}
                  </li>
                ))}
              </ul>
            );
          }
          if (block.kind === "ol") {
            return (
              <ol key={blockKey} className="pmx-aux-md-ol">
                {block.items.map((item, li) => (
                  <li
                    key={`${blockKey}-item-${item.slice(0, 24)}-${item.length}-${li === 0 ? "a" : "b"}`}
                  >
                    {renderFormattedSpan(
                      item,
                      knownNames,
                      maxSeq,
                      locale,
                      onJumpSeq,
                      onClickMention,
                      `ol-${blockKey}-${li}`,
                    )}
                  </li>
                ))}
              </ol>
            );
          }
          return (
            <p key={blockKey} className="pmx-aux-md-p">
              {renderFormattedSpan(
                block.text,
                knownNames,
                maxSeq,
                locale,
                onJumpSeq,
                onClickMention,
                `p-${blockKey}`,
              )}
            </p>
          );
        })}

        {resolvedScreenshots.length > 0 ? (
          <div className="pmx-aux-md-shots">
            {resolvedScreenshots.map((shot) => (
              <span
                key={`${shot.path}-${shot.caption}`}
                className="pmx-aux-md-shot"
                title={shot.path}
              >
                <ImageIcon className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{shot.caption}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {shouldClamp ? (
        <button
          type="button"
          className="pmx-aux-md-toggle"
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {expanded ? s.boardCollapsePost : s.boardExpandPost}
        </button>
      ) : null}
    </div>
  );
});
