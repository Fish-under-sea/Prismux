import { useGT, useLocale } from "gt-react";
import { PlayIcon, WrapTextIcon, CheckIcon, CopyIcon } from "lucide-react";
import { toHtml } from "hast-util-to-html";
import React, { startTransition, use, useEffect, useState, type ReactNode } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useClientSettings } from "../../hooks/useSettings";
import type { DiffThemeName } from "../../lib/diffRendering";
import {
  createIncrementalHighlightedDocument,
  highlightCodeToHast,
} from "../../lib/incrementalHighlighting";
import { LRUCache } from "../../lib/lruCache";
import { getSyntaxHighlighterPromise } from "../../lib/syntaxHighlighting";
import { cn } from "../../lib/utils";
import {
  hasSpecificPierreIconForFileName,
  syntheticFileNameForLanguageId,
} from "../../pierre-icons";
import { Button } from "../ui/button";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";
import { HighlightedCodeLines } from "./HighlightedCodeLines";
import {
  createHighlightCacheKey,
  estimateHighlightedSize,
  extractFenceLanguage,
} from "./MarkdownCodeBlock.logic";
import { reportMarkdownActionFailure } from "./markdownActionFailure";
import { PierreEntryIcon } from "./PierreEntryIcon";

const MAX_HIGHLIGHT_CACHE_ENTRIES = 500;
const MAX_HIGHLIGHT_CACHE_MEMORY_BYTES = 50 * 1024 * 1024;
/** Defer main-thread Shiki tokenization for large completed blocks (> 5 KB) so thread switching stays non-blocking. */
const LARGE_CODE_BLOCK_THRESHOLD_BYTES = 5 * 1024;

const highlightedCodeCache = new LRUCache<string>(
  MAX_HIGHLIGHT_CACHE_ENTRIES,
  MAX_HIGHLIGHT_CACHE_MEMORY_BYTES,
);

const THREAD_FIND_IGNORE_PROPS = {
  "data-thread-find-ignore": "",
} as React.HTMLAttributes<HTMLDivElement>;

export function MarkdownCodeBlockFrame({
  as: Wrapper = "div",
  language,
  fenceTitle,
  theme,
  wrapped = true,
  title,
  actions,
  headerProps,
  children,
}: {
  as?: React.ElementType;
  language: string;
  fenceTitle: string | null;
  theme: "light" | "dark";
  wrapped?: boolean;
  title?: React.ReactNode;
  actions?: React.ReactNode;
  headerProps?: React.HTMLAttributes<HTMLDivElement>;
  children: React.ReactNode;
}) {
  return (
    <Wrapper
      dir="ltr"
      className="chat-markdown-codeblock my-4 overflow-hidden text-start leading-snug"
      data-language={language}
      data-wrap={wrapped ? "true" : "false"}
    >
      <div
        {...headerProps}
        className={cn(
          "chat-markdown-codeblock-header flex items-center justify-between gap-2 pt-2.5 pr-4.5 pb-2 pl-5.5 text-2xs leading-4.5 select-none",
          headerProps?.className,
        )}
      >
        {title ?? (
          <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-2xs leading-4.5">
            <MarkdownCodeBlockTitleContent
              fenceTitle={fenceTitle}
              language={language}
              theme={theme}
            />
          </span>
        )}
        {actions}
      </div>
      {children}
    </Wrapper>
  );
}

const PLAIN_CODE_LANGUAGES = new Set(["", "text", "txt", "plain", "plaintext"]);

function resolvePlainCodeBlockLabel(locale: unknown, fallback: string): string {
  return typeof locale === "string" && locale.toLowerCase().startsWith("zh") ? "代码块" : fallback;
}

function MarkdownCodeBlockTitleContent({
  fenceTitle,
  language,
  theme,
}: {
  fenceTitle: string | null;
  language: string;
  theme: "light" | "dark";
}) {
  const gt = useGT();
  const locale = useLocale();
  if (fenceTitle) {
    return (
      <>
        <PierreEntryIcon pathValue={fenceTitle} kind="file" theme={theme} className="size-3.5" />
        <span className="truncate">{fenceTitle}</span>
      </>
    );
  }

  const normalizedLanguage = language.trim();
  if (PLAIN_CODE_LANGUAGES.has(normalizedLanguage.toLowerCase())) {
    return (
      <span className="truncate font-sans" data-codeblock-fallback-label="true">
        {resolvePlainCodeBlockLabel(locale, gt("Code block"))}
      </span>
    );
  }

  const fileName = syntheticFileNameForLanguageId(normalizedLanguage);
  if (!hasSpecificPierreIconForFileName(fileName)) {
    return <span className="truncate">{normalizedLanguage}</span>;
  }
  return (
    <SharedTooltipTrigger
      label={normalizedLanguage}
      render={
        <span
          className="inline-flex min-w-0 items-center gap-1.5 rounded-sm"
          aria-label={gt("Language: {language}", { language: normalizedLanguage })}
        />
      }
    >
      <PierreEntryIcon
        pathValue={fileName}
        kind="file"
        theme={theme}
        className="size-3.5 shrink-0"
      />
      <span className="truncate">{normalizedLanguage}</span>
    </SharedTooltipTrigger>
  );
}

export function MarkdownCodeBlock({
  code,
  language,
  fenceTitle,
  theme,
  onRunShellCommand,
  isStreaming,
  viewToggle,
  canWrap = true,
  diagram = false,
  children,
}: {
  code: string;
  language: string;
  fenceTitle: string | null;
  theme: "light" | "dark";
  onRunShellCommand?: ((command: string) => void) | undefined;
  isStreaming: boolean;
  viewToggle?: ReactNode;
  canWrap?: boolean;
  diagram?: boolean;
  children: ReactNode;
}) {
  const gt = useGT();
  const { copyToClipboard, isCopied: copied } = useCopyToClipboard({
    timeout: 1200,
    onError: (cause) =>
      reportMarkdownActionFailure(
        {
          operation: "copy-code-block",
          language,
          ...(fenceTitle ? { fenceTitle } : {}),
        },
        cause,
      ),
  });
  const defaultWrapped = useClientSettings((settings) => settings.wordWrap);
  const [wrapOverride, setWrapOverride] = useState<boolean | null>(null);
  const wrapped = wrapOverride ?? defaultWrapped;
  const wrapLabel = wrapped ? gt("Disable line wrap") : gt("Wrap lines");
  const copyLabel = copied ? gt("Copied") : gt("Copy code");
  const command = code.trim();
  const canRun =
    onRunShellCommand !== undefined &&
    !isStreaming &&
    /^(?:sh|bash|zsh|fish|shell|powershell|pwsh)$/.test(language) &&
    code.endsWith("\n") &&
    command.length > 0 &&
    !command.endsWith("\\") &&
    // Control and invisible format characters (bidi overrides, zero-width) can
    // make the rendered command differ from what the terminal would receive.
    !/[\p{Cc}\p{Cf}]/u.test(code.slice(0, -1));

  const handleCopy = () => copyToClipboard(code.endsWith("\n") ? code.slice(0, -1) : code);

  const copyButton = (
    <SharedTooltipTrigger
      label={copyLabel}
      render={
        <Button
          type="button"
          variant="ghost-muted"
          size="icon-xs"
          data-accent-active={copied ? "true" : undefined}
          className="size-6"
          onClick={handleCopy}
          aria-label={copyLabel}
        />
      }
    >
      {copied ? (
        <CheckIcon className="size-3.5" style={{ color: "var(--pmx-accent-text)" }} />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </SharedTooltipTrigger>
  );

  if (diagram) {
    return (
      <div className="my-2.5 border border-transparent" data-language={language}>
        <div className="flex items-center justify-end gap-0.5 pt-1.5 pr-1.5 select-none">
          {viewToggle}
          {copyButton}
        </div>
        {children}
      </div>
    );
  }

  return (
    <MarkdownCodeBlockFrame
      language={language}
      fenceTitle={fenceTitle}
      theme={theme}
      wrapped={wrapped}
      headerProps={THREAD_FIND_IGNORE_PROPS}
      actions={
        <span
          className="flex items-center gap-1"
          role="toolbar"
          aria-label={gt("Code block actions")}
        >
          {canWrap ? (
            <SharedTooltipTrigger
              label={wrapLabel}
              render={
                <Button
                  type="button"
                  variant={wrapped ? "secondary" : "ghost-muted"}
                  size="icon-xs"
                  data-accent-active={wrapped ? "true" : undefined}
                  className="size-6"
                  aria-pressed={wrapped}
                  onClick={() => setWrapOverride(!wrapped)}
                  aria-label={wrapLabel}
                />
              }
            >
              <WrapTextIcon className="size-3.5" />
            </SharedTooltipTrigger>
          ) : null}
          {canRun ? (
            <SharedTooltipTrigger
              label={gt("Run in terminal")}
              render={
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="icon-xs"
                  className="size-6"
                  onClick={() => onRunShellCommand(command)}
                  aria-label={gt("Run in terminal")}
                />
              }
            >
              <PlayIcon className="size-3.5" />
            </SharedTooltipTrigger>
          ) : null}
          {viewToggle}
          {copyButton}
        </span>
      }
    >
      {children}
    </MarkdownCodeBlockFrame>
  );
}

interface SuspenseShikiCodeBlockProps {
  className: string | undefined;
  code: string;
  themeName: DiffThemeName;
  isStreaming: boolean;
}

export function SuspenseShikiCodeBlock({
  className,
  code,
  themeName,
  isStreaming,
}: SuspenseShikiCodeBlockProps) {
  const [hasStreamed, setHasStreamed] = useState(isStreaming);
  if (isStreaming && !hasStreamed) setHasStreamed(true);
  const language = extractFenceLanguage(className);
  const cacheKey = createHighlightCacheKey(code, language, themeName);
  // Once lines are mounted individually, keep that renderer when streaming
  // finishes so switching to cached HTML cannot clear an existing selection.
  const cachedHighlightedHtml =
    !isStreaming && !hasStreamed ? highlightedCodeCache.get(cacheKey) : null;

  if (cachedHighlightedHtml != null) {
    return (
      <div
        className="chat-markdown-shiki"
        dangerouslySetInnerHTML={{ __html: cachedHighlightedHtml }}
      />
    );
  }

  if (!isStreaming && !hasStreamed && code.length > LARGE_CODE_BLOCK_THRESHOLD_BYTES) {
    return (
      <DeferredLargeShikiCodeBlock
        code={code}
        language={language}
        themeName={themeName}
        cacheKey={cacheKey}
      />
    );
  }

  return (
    <UncachedShikiCodeBlock
      code={code}
      language={language}
      themeName={themeName}
      cacheKey={cacheKey}
      isStreaming={isStreaming}
      preserveLines={isStreaming || hasStreamed}
    />
  );
}

interface DeferredLargeShikiCodeBlockProps {
  code: string;
  language: string;
  themeName: DiffThemeName;
  cacheKey: string;
}

function DeferredLargeShikiCodeBlock({
  code,
  language,
  themeName,
  cacheKey,
}: DeferredLargeShikiCodeBlockProps) {
  const [rendered, setRendered] = useState<{ readonly key: string; readonly html: string } | null>(
    null,
  );

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- schedules non-blocking idle tokenization for completed >5 KB code blocks and cancels on unmount
  useEffect(() => {
    let cancelled = false;
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const runHighlight = () => {
      void getSyntaxHighlighterPromise(language).then(
        (highlighter) => {
          if (cancelled) return;
          let html: string;
          try {
            html = highlighter.codeToHtml(code, { lang: language, theme: themeName });
          } catch (error) {
            console.warn(
              `Code highlighting failed for language "${language}", falling back to plain text.`,
              error instanceof Error ? error.message : error,
            );
            html = highlighter.codeToHtml(code, { lang: "text", theme: themeName });
          }
          highlightedCodeCache.set(cacheKey, html, estimateHighlightedSize(html, cacheKey));
          startTransition(() => {
            if (!cancelled) {
              setRendered({ key: cacheKey, html });
            }
          });
        },
        () => {
          // Keep plain fallback visible if the grammar loader fails.
        },
      );
    };

    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(runHighlight, { timeout: 150 });
    } else {
      timeoutHandle = setTimeout(runHighlight, 0);
    }

    return () => {
      cancelled = true;
      if (
        idleHandle !== null &&
        typeof window !== "undefined" &&
        typeof window.cancelIdleCallback === "function"
      ) {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    };
  }, [cacheKey, code, language, themeName]);

  if (rendered?.key === cacheKey) {
    return (
      <div className="chat-markdown-shiki" dangerouslySetInnerHTML={{ __html: rendered.html }} />
    );
  }

  return (
    <div className="chat-markdown-shiki" data-deferred-highlight="pending">
      <pre className="shiki">
        <code>{code}</code>
      </pre>
    </div>
  );
}

interface UncachedShikiCodeBlockProps {
  code: string;
  language: string;
  themeName: DiffThemeName;
  cacheKey: string;
  isStreaming: boolean;
  preserveLines: boolean;
}

function UncachedShikiCodeBlock({
  code,
  language,
  themeName,
  cacheKey,
  isStreaming,
  preserveLines,
}: UncachedShikiCodeBlockProps) {
  const highlighter = use(getSyntaxHighlighterPromise(language));
  const incrementalHighlight = preserveLines
    ? createIncrementalHighlightedDocument(highlighter, language, themeName)
    : null;
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- disposes the incremental Shiki highlighter when it is replaced or the block unmounts
  useEffect(() => () => incrementalHighlight?.dispose(), [incrementalHighlight]);
  const highlighted = (() => {
    const result = (() => {
      try {
        if (incrementalHighlight) return incrementalHighlight(code);
        return preserveLines
          ? highlightCodeToHast(highlighter, code, language, themeName)
          : highlighter.codeToHtml(code, { lang: language, theme: themeName });
      } catch (error) {
        console.warn(
          `Code highlighting failed for language "${language}", falling back to plain text.`,
          error instanceof Error ? error.message : error,
        );
        return preserveLines
          ? highlightCodeToHast(highlighter, code, "text", themeName)
          : highlighter.codeToHtml(code, { lang: "text", theme: themeName });
      }
    })();
    // A finished block is cached for the next mount; a streaming one is still changing.
    if (!isStreaming) {
      const highlightedHtml = typeof result === "string" ? result : toHtml(result);
      highlightedCodeCache.set(
        cacheKey,
        highlightedHtml,
        estimateHighlightedSize(highlightedHtml, cacheKey),
      );
    }
    return result;
  })();

  return typeof highlighted === "string" ? (
    <div className="chat-markdown-shiki" dangerouslySetInnerHTML={{ __html: highlighted }} />
  ) : (
    <div className="chat-markdown-shiki">
      <HighlightedCodeLines root={highlighted} />
    </div>
  );
}
