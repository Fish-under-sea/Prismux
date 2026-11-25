import { msg } from "gt-react";
import { CheckIcon, ChevronDownIcon, CopyIcon } from "lucide-react";
import { memo, useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { diagnoseModelError, type DiagnosedModelError } from "./errorDiagnostics";

export interface LocalizedErrorCardProps {
  readonly error: string;
  readonly errorClass?: string | null | undefined;
  readonly errorCode?: string | null | undefined;
  readonly providerName?: string | null | undefined;
  readonly diagnosed?: DiagnosedModelError | undefined;
  readonly variant?: "error" | "warning" | undefined;
  readonly compact?: boolean | undefined;
  readonly defaultExpanded?: boolean | undefined;
  readonly className?: string | undefined;
}

const ERROR_CARD_COPY = {
  collapseRaw: "收起原始报错",
  expandRaw: "查看原始报错",
  copiedRaw: "已复制原始报错",
  copyRaw: "复制原始报错",
} as const;

/**
 * High-contrast, glass-aware Chinese error diagnostic card:
 * displays a localized title, optional status badge, concise diagnosis, actionable tips,
 * and a default-collapsed "查看原始报错" drawer + one-click "复制原始报错" button.
 */
export const LocalizedErrorCard = memo(function LocalizedErrorCard(
  props: LocalizedErrorCardProps,
) {
  const {
    error,
    errorClass,
    errorCode,
    providerName,
    diagnosed: diagnosedProp,
    variant = "error",
    compact = false,
    defaultExpanded = false,
    className,
  } = props;

  const [expanded, setExpanded] = useState(defaultExpanded);
  const [rawRendered, setRawRendered] = useState(defaultExpanded);
  const [rawVisible, setRawVisible] = useState(defaultExpanded);

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      if (next) {
        setRawRendered(true);
        if (!rawRendered) setRawVisible(false);
      } else {
        setRawVisible(false);
      }
      return next;
    });
  };

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- drives smooth 0fr <-> 1fr CSS grid motion while keeping collapsed raw error unmounted
  useEffect(() => {
    if (expanded) {
      if (rawVisible) return;
      const raf = window.requestAnimationFrame(() => setRawVisible(true));
      return () => window.cancelAnimationFrame(raf);
    }
    if (!rawRendered) return;
    const timer = window.setTimeout(() => setRawRendered(false), 210);
    return () => window.clearTimeout(timer);
  }, [expanded, rawRendered, rawVisible]);

  const diagnosed =
    diagnosedProp ??
    diagnoseModelError(error, {
      errorClass,
      errorCode,
      providerName,
    });

  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: {
      target: "raw-error",
      unavailableMessage: msg("Clipboard API is unavailable while copying raw error."),
      failureMessage: msg("Failed to copy raw error to the clipboard."),
    },
  });

  const badgeToneClass =
    variant === "warning"
      ? "border-warning/40 bg-warning/15 text-warning-foreground"
      : "border-error/40 bg-error/15 text-error-foreground";

  const titleClass =
    variant === "warning" ? "text-warning-foreground" : "text-error-foreground";

  const bodyClass =
    variant === "warning" ? "text-warning-foreground/90" : "text-error-foreground/90";

  const actionBtnClass = cn(
    "inline-flex cursor-pointer items-center gap-1 rounded-md border border-border/80 bg-background/75 px-2 py-0.5 text-2xs font-medium text-foreground transition-colors duration-200 ease-out hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
    "[[data-pmx-glass='1']_&]:border-foreground/15 [[data-pmx-glass='1']_&]:bg-card/70 [[data-pmx-glass='1']_&]:hover:bg-card/90",
  );

  return (
    <div
      data-localized-error-card="1"
      data-error-category={diagnosed.category}
      className={cn("flex min-w-0 flex-col", compact ? "gap-1" : "gap-1.5", className)}
    >
      {/* Header: Chinese bold title + optional compact status badge */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          data-localized-error-title="1"
          className={cn(
            "font-semibold leading-snug tracking-tight",
            compact ? "text-xs" : "text-sm",
            titleClass,
          )}
        >
          {diagnosed.titleZh}
        </span>
        {diagnosed.statusBadge ? (
          <span
            data-localized-error-badge="1"
            className={cn(
              "inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 font-mono text-2xs font-semibold leading-none",
              badgeToneClass,
            )}
          >
            {diagnosed.statusBadge}
          </span>
        ) : null}
      </div>

      {/* Concise Chinese diagnosis */}
      <p
        data-localized-error-diagnosis="1"
        className={cn("text-xs leading-relaxed", bodyClass)}
      >
        {diagnosed.diagnosisZh}
      </p>

      {/* Actionable troubleshooting steps */}
      {diagnosed.suggestionsZh.length > 0 ? (
        <ul
          data-localized-error-suggestions="1"
          className={cn("list-disc space-y-0.5 pl-4 text-xs leading-relaxed", bodyClass)}
        >
          {diagnosed.suggestionsZh.map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ul>
      ) : null}

      {/* Default-collapsed raw error toggle + copy raw error button */}
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          data-localized-error-toggle="1"
          onClick={toggleExpanded}
          className={actionBtnClass}
        >
          <ChevronDownIcon
            className={cn(
              "size-3 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
            aria-hidden="true"
          />
          <span>{expanded ? ERROR_CARD_COPY.collapseRaw : ERROR_CARD_COPY.expandRaw}</span>
        </button>

        <button
          type="button"
          data-localized-error-copy="1"
          onClick={() => copyToClipboard(diagnosed.formattedRawError)}
          className={actionBtnClass}
        >
          {isCopied ? (
            <CheckIcon className="size-3 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <CopyIcon className="size-3 shrink-0" aria-hidden="true" />
          )}
          <span>{isCopied ? ERROR_CARD_COPY.copiedRaw : ERROR_CARD_COPY.copyRaw}</span>
        </button>
      </div>

      {/* Expandable full unclipped raw error container with smooth 0fr <-> 1fr motion */}
      {rawRendered ? (
        <div
          data-disclosure-panel={rawVisible ? "open" : "closing"}
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
            rawVisible ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <pre
              data-localized-error-raw="1"
              className="mt-1 max-h-56 overflow-auto rounded-lg border border-border/80 bg-background/85 px-2.5 py-2 font-mono text-2xs leading-relaxed text-foreground select-text whitespace-pre-wrap break-words [[data-pmx-glass='1']_&]:border-foreground/15 [[data-pmx-glass='1']_&]:bg-card/80 [[data-pmx-glass='1']_&]:backdrop-blur-md"
            >
              {diagnosed.formattedRawError}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
});
