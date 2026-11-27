import type { ReasoningTranslationProvider } from "@prismux/core-contracts/settings";
import { msg, useGT, useMessages } from "gt-react";
import {
  CheckIcon,
  CopyIcon,
  LanguagesIcon,
  Loader2Icon,
  PowerOffIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "../lib/utils";
import {
  readLastActiveReasoningTranslationProvider,
  rememberLastActiveReasoningTranslationProvider,
  shouldSkipReasoningTranslation,
  useReasoningTranslation,
  type ActiveReasoningTranslationProvider,
  type ReasoningTranslateFn,
  type ReasoningTranslationMemoryCache,
} from "./reasoningTranslation";

export type ReasoningTranslationSettingsTarget = "reasoning" | "waiver";

export interface ReasoningTranslationErrorHint {
  readonly message: string;
  readonly actionLabel?: string | undefined;
  readonly settingsTarget?: ReasoningTranslationSettingsTarget | undefined;
}

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
  /** Renders a subtle quick toggle in thinking cards when translation is enabled or off (zero I/O when off). */
  readonly showQuickToggle?: boolean | undefined;
  readonly onOpenSettings?: ((target: ReasoningTranslationSettingsTarget) => void) | undefined;
  readonly renderSettingsLink?:
    | ((input: {
        readonly target: ReasoningTranslationSettingsTarget;
        readonly label: ReactNode;
        readonly className: string;
        readonly dataSlot: string;
      }) => ReactNode)
    | undefined;
  readonly onToggleProvider?: ((next: ReasoningTranslationProvider) => void) | undefined;
}

const PROVIDER_SHORT_LABELS: Readonly<Record<ActiveReasoningTranslationProvider, string>> = {
  local_nmt: msg("Local", { $context: "reasoning translation badge" }),
  text_model: msg("AI", { $context: "reasoning translation badge" }),
  official_api: msg("API", { $context: "reasoning translation badge" }),
};

export function resolveReasoningTranslationErrorHint(
  errorCode: string | null,
): ReasoningTranslationErrorHint {
  switch (errorCode) {
    case "LOCAL_NMT_NOT_INSTALLED":
      return {
        message: msg("Offline translation pack is not installed yet."),
        actionLabel: msg("Download in Settings →"),
        settingsTarget: "reasoning",
      };
    case "LOCAL_NMT_UNSUPPORTED_LANGUAGE":
      return {
        message: msg("Offline NMT only supports Simplified Chinese output; showing original."),
      };
    case "OFFICIAL_API_NOT_CONFIGURED":
      return {
        message: msg("Official translation API is not configured yet."),
        actionLabel: msg("Configure in Settings →"),
        settingsTarget: "reasoning",
      };
    case "OFFICIAL_API_AUTH_FAILED":
      return {
        message: msg("Translation API rejected credentials. Check your key in Settings."),
        actionLabel: msg("Check API settings →"),
        settingsTarget: "reasoning",
      };
    case "INVALID_OFFICIAL_API_ENDPOINT":
      return {
        message: msg("Invalid translation API endpoint URL."),
        actionLabel: msg("Check API settings →"),
        settingsTarget: "reasoning",
      };
    case "OFFICIAL_API_RATE_LIMITED":
      return {
        message: msg("Translation API rate limit reached; showing original."),
      };
    case "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED":
      return {
        message: msg("Antigravity subscription waiver required; showing original."),
        actionLabel: msg("Review waiver →"),
        settingsTarget: "waiver",
      };
    default:
      return {
        message: msg("Translation unavailable, showing original"),
      };
  }
}

/** Reasoning translation wrapper; renders raw content with zero I/O when disabled. */
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
  showQuickToggle = false,
  onOpenSettings,
  renderSettingsLink,
  onToggleProvider,
}: ReasoningTranslationBodyProps) {
  const gt = useGT();
  const messages = useMessages();
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

  const applyProviderToggle = (next: ReasoningTranslationProvider) => {
    if (onToggleProvider) {
      onToggleProvider(next);
      return;
    }
    void import("../hooks/useSettings")
      .then((mod) => mod.persistClientSettingsPatch?.({ reasoningTranslationProvider: next }))
      .catch(() => undefined);
  };

  const renderSettingsAction = (input: {
    readonly target: ReasoningTranslationSettingsTarget;
    readonly label: ReactNode;
    readonly className: string;
    readonly dataSlot: string;
  }): ReactNode => {
    if (onOpenSettings) {
      return (
        <button
          type="button"
          data-slot={input.dataSlot}
          onClick={(event) => {
            event.stopPropagation();
            onOpenSettings(input.target);
          }}
          className={input.className}
        >
          {input.label}
        </button>
      );
    }
    if (renderSettingsLink) {
      return renderSettingsLink(input);
    }
    return null;
  };

  if (!translation.enabled || translation.provider === "off") {
    const canShowOffQuickToggle =
      showQuickToggle &&
      translation.provider === "off" &&
      !shouldSkipReasoningTranslation(text, targetLanguage);
    if (!canShowOffQuickToggle) {
      return className ? (
        <div className={className}>{renderBody(text)}</div>
      ) : (
        <>{renderBody(text)}</>
      );
    }

    const lastActiveProvider = readLastActiveReasoningTranslationProvider();
    const quickToggleClassName =
      "inline-flex cursor-pointer items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-2xs font-medium text-muted-foreground transition-colors hover:border-border/50 hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 motion-reduce:transition-none";
    const quickToggleContent = (
      <>
        <LanguagesIcon className="size-3 shrink-0 text-primary/80" aria-hidden="true" />
        <span>{lastActiveProvider ? gt("Translate reasoning") : gt("Reasoning translation")}</span>
      </>
    );

    const quickControl = lastActiveProvider ? (
      <button
        type="button"
        data-slot="reasoning-translation-quick-toggle"
        data-quick-toggle-mode="resume"
        onClick={(event) => {
          event.stopPropagation();
          applyProviderToggle(lastActiveProvider);
        }}
        className={quickToggleClassName}
      >
        {quickToggleContent}
      </button>
    ) : (
      renderSettingsAction({
        target: "reasoning",
        label: quickToggleContent,
        className: quickToggleClassName,
        dataSlot: "reasoning-translation-quick-toggle",
      })
    );

    if (!quickControl) {
      return className ? (
        <div className={className}>{renderBody(text)}</div>
      ) : (
        <>{renderBody(text)}</>
      );
    }

    return (
      <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        <div className="flex items-center justify-end">{quickControl}</div>
        <div className="min-w-0 text-foreground/90">{renderBody(text)}</div>
      </div>
    );
  }

  const activeProvider = translation.provider;
  const hasTranslatedContent = translation.translatedFragmentCount > 0;
  const hasError = translation.error !== null;
  const errorHint = hasError ? resolveReasoningTranslationErrorHint(translation.errorCode) : null;

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

  const handleQuickPause = () => {
    rememberLastActiveReasoningTranslationProvider(activeProvider);
    applyProviderToggle("off");
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
            data-slot="reasoning-translation-provider-badge"
            className={cn(
              "inline-flex items-center rounded border border-border/50 bg-background/70 px-1.5 py-0.5 text-2xs font-medium tracking-tight text-foreground/85",
              "[[data-pmx-glass='1']_&]:bg-background/45",
            )}
          >
            {messages(PROVIDER_SHORT_LABELS[activeProvider])}
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

        {errorHint ? (
          <span
            data-slot="reasoning-translation-error"
            data-error-code={translation.errorCode ?? undefined}
            className="inline-flex flex-wrap items-center gap-1.5 text-warning-foreground"
          >
            <span>{messages(errorHint.message)}</span>
            {errorHint.actionLabel && errorHint.settingsTarget
              ? renderSettingsAction({
                  target: errorHint.settingsTarget,
                  label: messages(errorHint.actionLabel),
                  dataSlot: "reasoning-translation-settings-hint",
                  className:
                    "inline-flex cursor-pointer items-center font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
                })
              : null}
            <button
              type="button"
              onClick={translation.retry}
              className="inline-flex cursor-pointer items-center gap-1 rounded border border-border/50 bg-background/70 px-1.5 py-0.5 font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 motion-reduce:transition-none [[data-pmx-glass='1']_&]:bg-background/45"
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
                "inline-flex cursor-pointer items-center rounded border border-border/50 bg-background/70 px-1.5 py-0.5 text-2xs font-medium text-foreground/85 transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 motion-reduce:transition-none",
                "[[data-pmx-glass='1']_&]:bg-background/45 [[data-pmx-glass='1']_&]:hover:bg-card/75",
              )}
              data-slot="reasoning-translation-toggle"
            >
              {translation.showOriginal ? gt("View translation") : gt("View original")}
            </button>
          ) : null}

          {showQuickToggle ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleQuickPause();
              }}
              aria-label={gt("Turn off reasoning translation")}
              data-slot="reasoning-translation-quick-toggle"
              data-quick-toggle-mode="pause"
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded border border-transparent px-1.5 py-0.5 text-2xs font-medium text-muted-foreground transition-colors hover:border-border/50 hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 motion-reduce:transition-none",
                "[[data-pmx-glass='1']_&]:hover:bg-background/45",
              )}
            >
              <PowerOffIcon className="size-2.5 shrink-0" aria-hidden="true" />
              <span>{gt("Off")}</span>
            </button>
          ) : null}

          <button
            type="button"
            onClick={handleCopyDisplayed}
            aria-label={copied ? gt("Copied") : gt("Copy")}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1 rounded border border-transparent px-1.5 py-0.5 text-2xs font-medium text-muted-foreground transition-colors hover:border-border/50 hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 motion-reduce:transition-none",
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
