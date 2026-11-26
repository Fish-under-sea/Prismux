import type { ReasoningTranslationProvider } from "@prismux/core-contracts/settings";
import { useGT } from "gt-react";
import { CheckIcon, CopyIcon, LanguagesIcon, Loader2Icon, RotateCcwIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "../lib/utils";
import {
  useReasoningTranslation,
  type ReasoningTranslateFn,
  type ReasoningTranslationMemoryCache,
} from "./reasoningTranslation";

export interface ReasoningTranslationBodyProps {
  readonly text: string;
  readonly running?: boolean | undefined;
  readonly provider?: ReasoningTranslationProvider | undefined;
  readonly modelKey?: string | undefined;
  readonly targetLanguage?: string | undefined;
  readonly sourceLanguage?: string | undefined;
  readonly className?: string | undefined;
  readonly renderContent?: ((text: string) => ReactNode) | undefined;
  readonly cache?: ReasoningTranslationMemoryCache | undefined;
  readonly translate?: ReasoningTranslateFn | undefined;
}

const PROVIDER_SHORT_LABELS: Readonly<Record<Exclude<ReasoningTranslationProvider, "off">, string>> =
  {
    text_model: "AI",
  };

/** DSH-parity reasoning translation wrapper; renders raw content with zero I/O when disabled. */
export function ReasoningTranslationBody({
  text,
  running = false,
  provider,
  modelKey,
  targetLanguage,
  sourceLanguage,
  className,
  renderContent,
  cache,
  translate,
}: ReasoningTranslationBodyProps) {
  const gt = useGT();
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const translation = useReasoningTranslation({
    text,
    running,
    provider,
    modelKey,
    targetLanguage,
    sourceLanguage,
    cache,
    translate,
  });

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- Clears the transient copy-feedback timer on unmount.
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  const renderBody = (content: string) =>
    renderContent ? (
      renderContent(content)
    ) : (
      <div className="whitespace-pre-wrap break-words text-foreground/90">{content}</div>
    );

  if (!translation.enabled || translation.provider === "off") {
    return className ? (
      <div className={className}>{renderBody(text)}</div>
    ) : (
      <>{renderBody(text)}</>
    );
  }

  const activeProvider = translation.provider;
  const hasTranslatedContent = translation.translatedFragmentCount > 0;
  const hasError = translation.error !== null;
  const isComplianceBlocked =
    translation.errorCode === "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED";

  const handleCopyDisplayed = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    void navigator.clipboard
      .writeText(translation.displayText)
      .then(() => {
        setCopied(true);
        if (copyTimerRef.current !== null) {
          clearTimeout(copyTimerRef.current);
        }
        copyTimerRef.current = setTimeout(() => {
          setCopied(false);
          copyTimerRef.current = null;
        }, 1_500);
      })
      .catch(() => undefined);
  };

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-2", className)}
      data-slot="reasoning-translation-body"
      data-translation-status={translation.status}
      data-translation-provider={activeProvider}
    >
      <div
        data-slot="reasoning-translation-toolbar"
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/35 px-2.5 py-1.5 text-2xs leading-none text-muted-foreground",
          "[[data-pmx-glass='1']_&]:border-border/60 [[data-pmx-glass='1']_&]:bg-card/55 [[data-pmx-glass='1']_&]:backdrop-blur-md [[data-pmx-glass='1']_&]:ring-1 [[data-pmx-glass='1']_&]:ring-inset [[data-pmx-glass='1']_&]:ring-border/30",
        )}
      >
        <span className="inline-flex items-center gap-1.5 text-foreground/85">
          <LanguagesIcon className="size-3 shrink-0 text-primary/85" aria-hidden="true" />
          <span
            className={cn(
              "inline-flex items-center rounded border border-border/50 bg-background/70 px-1.5 py-0.5 text-2xs font-medium tracking-tight text-foreground/85",
              "[[data-pmx-glass='1']_&]:bg-background/45",
            )}
          >
            {PROVIDER_SHORT_LABELS[activeProvider]}
          </span>
        </span>

        {translation.isTranslating ? (
          <span
            className="inline-flex items-center gap-1.5 text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Loader2Icon
              className="size-3 shrink-0 animate-spin text-primary motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span>{gt("Translating reasoning…")}</span>
            {translation.totalFragmentCount > 1 ? (
              <span className="tabular-nums text-muted-foreground/80">
                {translation.translatedFragmentCount}/{translation.totalFragmentCount}
              </span>
            ) : null}
          </span>
        ) : null}

        {hasError ? (
          <span className="inline-flex flex-wrap items-center gap-1.5 text-warning">
            <span>
              {isComplianceBlocked
                ? gt("Antigravity subscription waiver required; showing original.")
                : gt("Translation unavailable, showing original")}
            </span>
            <button
              type="button"
              onClick={translation.retry}
              className="inline-flex items-center gap-1 rounded border border-border/50 bg-background/70 px-1.5 py-0.5 font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 motion-reduce:transition-none [[data-pmx-glass='1']_&]:bg-background/45"
            >
              <RotateCcwIcon className="size-2.5 shrink-0" aria-hidden="true" />
              <span>{gt("Retry")}</span>
            </button>
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          {hasTranslatedContent ? (
            <button
              type="button"
              onClick={translation.toggleShowOriginal}
              aria-pressed={translation.showOriginal}
              className={cn(
                "inline-flex items-center rounded border border-border/50 bg-background/70 px-1.5 py-0.5 text-2xs font-medium text-foreground/85 transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 motion-reduce:transition-none",
                "[[data-pmx-glass='1']_&]:bg-background/45 [[data-pmx-glass='1']_&]:hover:bg-card/75",
              )}
              data-slot="reasoning-translation-toggle"
            >
              {translation.showOriginal ? gt("View translation") : gt("View original")}
            </button>
          ) : null}

          <button
            type="button"
            onClick={handleCopyDisplayed}
            aria-label={copied ? gt("Copied") : gt("Copy")}
            className={cn(
              "inline-flex items-center gap-1 rounded border border-transparent px-1.5 py-0.5 text-2xs font-medium text-muted-foreground transition-colors hover:border-border/50 hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 motion-reduce:transition-none",
              "[[data-pmx-glass='1']_&]:hover:bg-background/45",
            )}
            data-slot="reasoning-translation-copy"
          >
            {copied ? (
              <CheckIcon className="size-2.5 shrink-0 text-primary" aria-hidden="true" />
            ) : (
              <CopyIcon className="size-2.5 shrink-0" aria-hidden="true" />
            )}
            <span>{copied ? gt("Copied") : gt("Copy")}</span>
          </button>
        </div>
      </div>

      <div className="min-w-0 text-foreground/90">{renderBody(translation.displayText)}</div>
    </div>
  );
}
