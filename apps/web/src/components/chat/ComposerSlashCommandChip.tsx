/* oxlint-disable prismux/no-untranslated-copy, shadcn/no-raw-colors -- aria labels use concise Chinese and SwarmQueenBeeIcon preserves the 1:1 native Antigravity pixel queen bee palette */
import { XIcon } from "lucide-react";
import type { CSSProperties } from "react";

import { cn } from "../../lib/utils";
import {
  normalizeSlashCommandKey,
  resolveSlashCommandPresentation,
  type SlashCommandIconSpec,
} from "./composerSlashCatalog";

export interface LeadingSlashCommandToken {
  readonly type: "slash-command";
  readonly command: string;
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

const LEADING_SLASH_COMMAND_REGEX = /^\/([a-zA-Z][a-zA-Z0-9:_-]{0,63})(?=[ \t\r\n])/;

/**
 * Collects confirmed leading slash-command tokens (`/goal `, `/swarm `, `/plan `, ...) at the
 * very beginning of a prompt. Only matches consecutive `/command` tokens separated by horizontal
 * whitespace and terminated by whitespace, so paths (`/etc/hosts`), unfinished typing (`/sw`),
 * and mid-sentence slashes never become chips.
 */
export function collectLeadingSlashCommandTokens(text: string): LeadingSlashCommandToken[] {
  if (!text) return [];
  const tokens: LeadingSlashCommandToken[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) {
      cursor += 1;
    }
    if (cursor >= text.length || text[cursor] !== "/") {
      break;
    }
    const match = LEADING_SLASH_COMMAND_REGEX.exec(text.slice(cursor));
    if (!match) {
      break;
    }
    const source = match[0]!;
    const command = match[1]!;
    const start = cursor;
    const end = cursor + source.length;
    tokens.push({
      type: "slash-command",
      command,
      source,
      start,
      end,
    });
    cursor = end;
    // Do not continue scanning onto subsequent lines; body text starts after a newline.
    if (text[cursor] === "\n" || text[cursor] === "\r") {
      break;
    }
  }

  return tokens;
}

/**
 * Returns true when `rangeStart` sits at prompt start OR immediately after one or more confirmed
 * leading slash-command tokens separated by horizontal whitespace (enabling `/goal /swarm `).
 */
export function isAtLeadingSlashCommandPosition(text: string, rangeStart: number): boolean {
  if (rangeStart <= 0) return true;
  const prefix = text.slice(0, rangeStart);
  if (prefix.includes("\n") || prefix.includes("\r")) {
    return false;
  }
  const tokens = collectLeadingSlashCommandTokens(prefix);
  const lastEnd = tokens.length > 0 ? tokens[tokens.length - 1]!.end : 0;
  const remainder = prefix.slice(lastEnd);
  return /^[ \t]*$/.test(remainder);
}

/** 1:1 native Antigravity `/swarm` pixel queen bee icon (crisp pixel SVG, used exclusively for `/swarm`). */
export function SwarmQueenBeeIcon({ className = "size-4 shrink-0" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      data-slash-icon="swarm-bee"
      viewBox="5 7 18 13"
      shapeRendering="crispEdges"
      className={className}
    >
      {/* Ruby-tipped queen crown */}
      <rect x="9" y="7" width="1" height="1" fill="#FFE9A6" />
      <rect x="7" y="8" width="1" height="1" fill="#FFE9A6" />
      <rect x="9" y="8" width="1" height="1" fill="#FFE9A6" />
      <rect x="11" y="8" width="1" height="1" fill="#FFE9A6" />
      <rect x="7" y="9" width="1" height="1" fill="#C98A2B" />
      <rect x="8" y="9" width="1" height="1" fill="#F7CE5B" />
      <rect x="9" y="9" width="1" height="1" fill="#E4566A" />
      <rect x="10" y="9" width="1" height="1" fill="#F7CE5B" />
      <rect x="11" y="9" width="1" height="1" fill="#C98A2B" />
      {/* Translucent wing */}
      <rect x="16" y="9" width="4" height="1" fill="rgba(140,160,192,0.9)" />
      <rect x="15" y="10" width="6" height="1" fill="rgba(140,160,192,0.9)" />
      {/* Body outline & stinger */}
      <rect x="12" y="9" width="2" height="1" fill="#451c1e" />
      <rect x="14" y="9" width="1" height="1" fill="#b1502f" />
      <rect x="15" y="9" width="1" height="1" fill="#451c1e" />
      <rect x="7" y="10" width="2" height="1" fill="#b1502f" />
      <rect x="6" y="11" width="1" height="1" fill="#b1502f" />
      <rect x="19" y="11" width="1" height="1" fill="#451c1e" />
      <rect x="5" y="12" width="1" height="2" fill="#b1502f" />
      <rect x="5" y="14" width="1" height="3" fill="#451c1e" />
      <rect x="20" y="12" width="1" height="5" fill="#451c1e" />
      <rect x="21" y="14" width="2" height="1" fill="#451c1e" />
      <rect x="6" y="17" width="1" height="1" fill="#451c1e" />
      <rect x="19" y="17" width="1" height="1" fill="#451c1e" />
      <rect x="7" y="18" width="2" height="1" fill="#451c1e" />
      <rect x="17" y="18" width="2" height="1" fill="#451c1e" />
      <rect x="9" y="19" width="8" height="1" fill="#451c1e" />
      {/* Golden honey body & dark stripes */}
      <rect x="9" y="10" width="3" height="1" fill="#f8e081" />
      <rect x="12" y="10" width="2" height="1" fill="#5c4a3d" />
      <rect x="14" y="10" width="1" height="1" fill="#e9c349" />
      <rect x="7" y="11" width="2" height="1" fill="#f8e081" />
      <rect x="9" y="11" width="3" height="1" fill="#fef5cd" />
      <rect x="12" y="11" width="2" height="1" fill="#5c4a3d" />
      <rect x="14" y="11" width="1" height="1" fill="#f8e081" />
      <rect x="15" y="11" width="1" height="1" fill="#e9c349" />
      <rect x="16" y="11" width="2" height="1" fill="#392423" />
      <rect x="18" y="11" width="1" height="1" fill="#b1502f" />
      <rect x="6" y="12" width="1" height="3" fill="#e9c349" />
      <rect x="7" y="12" width="5" height="1" fill="#f8e081" />
      <rect x="9" y="12" width="1" height="1" fill="#fef5cd" />
      <rect x="12" y="12" width="2" height="1" fill="#5c4a3d" />
      <rect x="14" y="12" width="2" height="4" fill="#e9c349" />
      <rect x="16" y="12" width="2" height="2" fill="#392423" />
      <rect x="18" y="12" width="1" height="1" fill="#e9c349" />
      <rect x="19" y="12" width="1" height="5" fill="#b1502f" />
      <rect x="7" y="13" width="6" height="1" fill="#f8e081" />
      <rect x="8" y="13" width="1" height="1" fill="#FFFFFF" />
      <rect x="9" y="13" width="1" height="1" fill="#221116" />
      <rect x="13" y="13" width="1" height="4" fill="#392423" />
      <rect x="18" y="13" width="1" height="5" fill="#b1502f" />
      <rect x="7" y="14" width="6" height="3" fill="#e9c349" />
      <rect x="8" y="14" width="2" height="1" fill="#221116" />
      <rect x="16" y="14" width="1" height="1" fill="#392423" />
      <rect x="17" y="14" width="1" height="4" fill="#221116" />
      <rect x="6" y="15" width="1" height="1" fill="rgba(255,128,150,0.45)" />
      <rect x="7" y="15" width="1" height="1" fill="rgba(255,128,150,0.65)" />
      <rect x="16" y="15" width="1" height="4" fill="#221116" />
      <rect x="6" y="16" width="1" height="1" fill="#b1502f" />
      <rect x="12" y="16" width="1" height="1" fill="#392423" />
      <rect x="14" y="16" width="2" height="3" fill="#b1502f" />
      <rect x="7" y="17" width="5" height="1" fill="#b1502f" />
      <rect x="12" y="17" width="2" height="2" fill="#221116" />
      <rect x="9" y="18" width="3" height="1" fill="#b1502f" />
    </svg>
  );
}

const SWARM_CHIP_ACCENT_STYLE: CSSProperties = {
  color: "var(--pmx-accent-text, var(--pmx-accent, var(--primary)))",
  backgroundColor:
    "var(--pmx-accent-soft, color-mix(in srgb, var(--pmx-accent, var(--primary)) 13%, transparent))",
  borderColor:
    "var(--pmx-accent-border, color-mix(in srgb, var(--pmx-accent, var(--primary)) 34%, transparent))",
};

function InlineSlashIcon({ spec }: { readonly spec: SlashCommandIconSpec }) {
  if (spec.kind === "swarm-bee") {
    return <SwarmQueenBeeIcon className="size-3.5 shrink-0" />;
  }
  if (spec.kind === "emoji") {
    return (
      <span
        aria-hidden="true"
        data-slash-icon="emoji"
        className="inline-flex size-3.5 shrink-0 items-center justify-center text-xs leading-none"
      >
        {spec.emoji}
      </span>
    );
  }
  const Icon = spec.icon;
  return (
    <Icon aria-hidden="true" data-slash-icon="lucide" className="size-3.5 shrink-0 opacity-85" />
  );
}

export interface ComposerSlashCommandChipProps {
  readonly command: string;
  readonly onRemove?: (() => void) | undefined;
  readonly interactive?: boolean | undefined;
  readonly className?: string | undefined;
}

export function ComposerSlashCommandChip({
  command,
  onRemove,
  interactive = true,
  className,
}: ComposerSlashCommandChipProps) {
  const normalized = normalizeSlashCommandKey(command);
  const presentation = resolveSlashCommandPresentation(command);
  const isSwarm = normalized === "swarm";

  return (
    <span
      data-composer-slash-command={normalized || command}
      data-composer-slash-accent={isSwarm ? "dynamic" : "neutral"}
      contentEditable={false}
      spellCheck={false}
      aria-label={`/${command}`}
      style={isSwarm ? SWARM_CHIP_ACCENT_STYLE : undefined}
      className={cn(
        "group/slash-chip inline-flex select-none items-center gap-1 rounded-md border px-1.5 py-0.25 align-baseline text-xs font-medium leading-tight transition-colors",
        !isSwarm &&
          "border-border/75 bg-foreground/[0.06] text-foreground dark:border-white/15 dark:bg-white/[0.09]",
        className,
      )}
    >
      <InlineSlashIcon spec={presentation.icon} />
      <span className="max-w-[16ch] truncate">{command}</span>
      {interactive && onRemove ? (
        <button
          type="button"
          data-testid={`composer-slash-chip-remove-${normalized || command}`}
          aria-label={`移除 /${command}`}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
          className="-mr-0.5 ml-0.5 inline-flex size-3.5 cursor-pointer items-center justify-center rounded-sm opacity-60 transition-opacity hover:bg-foreground/10 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none dark:hover:bg-white/15"
        >
          <XIcon className="size-2.5" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
