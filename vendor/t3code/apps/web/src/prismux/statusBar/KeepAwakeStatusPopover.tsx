import { CoffeeIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from "./statusBarContextMenuPolicy";
import type { KeepAwakeDerivedState, KeepAwakeMode } from "./statusBarKeepAwake";

export interface KeepAwakeStatusPopoverProps {
  readonly state: KeepAwakeDerivedState;
  readonly onSelectMode: (mode: KeepAwakeMode) => void;
  readonly blockerId?: number | null;
  readonly error?: string | null;
  readonly embeddedInPopover?: boolean;
}

export function KeepAwakeStatusPopover({
  state,
  onSelectMode,
  blockerId = null,
  error = null,
  embeddedInPopover = false,
}: KeepAwakeStatusPopoverProps) {
  const isActiveLock = state.shouldPreventSleep && state.effectiveActive;

  return (
    <div
      {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
      {...(embeddedInPopover
        ? {}
        : { "data-pmx-glass-zone": "overlays", "data-pmx-status-popover": "1" })}
      data-testid="keep-awake-status-popover"
      data-keep-awake-mode={state.mode}
      data-keep-awake-active={isActiveLock ? "true" : "false"}
      className={cn(
        "flex w-[276px] max-w-[calc(100vw-24px)] flex-col text-xs text-popover-foreground",
        embeddedInPopover
          ? "bg-transparent"
          : "overflow-hidden rounded-xl border border-border bg-popover bg-clip-padding shadow-xl",
      )}
    >
      {/* Top Header: Title on left, real-time status badge on right */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <CoffeeIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 transition-colors",
              isActiveLock
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground",
            )}
          />
          <span className="truncate font-semibold tracking-tight text-foreground">
            {state.title}
          </span>
        </div>
        <span
          data-testid="keep-awake-status-badge"
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums",
            isActiveLock
              ? "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300"
              : state.visualTone === "standby"
                ? "bg-muted/80 text-foreground/80"
                : "bg-muted/60 text-muted-foreground",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full transition-all",
              isActiveLock
                ? "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.85)] dark:bg-amber-400"
                : state.visualTone === "standby"
                  ? "bg-muted-foreground/70"
                  : "bg-muted-foreground/40",
            )}
          />
          <span>{state.statusBadgeText}</span>
        </span>
      </div>

      {/* Divider */}
      <div className="border-t border-border/70" />

      {/* 3-State Radio Option List */}
      <div
        role="radiogroup"
        aria-label={state.title}
        className="flex flex-col gap-0.5 p-1.5"
      >
        {state.options.map((option) => {
          const selected = state.mode === option.mode;
          const optionIsActivelyLocking = selected && isActiveLock;

          return (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`keep-awake-option-${option.mode}`}
              onClick={() => onSelectMode(option.mode)}
              className={cn(
                "group flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                selected
                  ? "bg-accent/70 text-foreground"
                  : "text-foreground/90 hover:bg-accent/45",
              )}
            >
              {/* Left glowing dot indicator */}
              <span
                aria-hidden
                className="mt-1 flex size-3 shrink-0 items-center justify-center"
              >
                {selected ? (
                  <span
                    className={cn(
                      "size-2 rounded-full transition-all",
                      optionIsActivelyLocking
                        ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.85)] dark:bg-amber-400"
                        : option.mode === "agent"
                          ? "bg-primary shadow-[0_0_6px_color-mix(in_srgb,var(--primary)_60%,transparent)]"
                          : "bg-foreground/75",
                    )}
                  />
                ) : (
                  <span className="size-2 rounded-full border border-border/90 bg-transparent transition-colors group-hover:border-muted-foreground/70" />
                )}
              </span>

              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cn(
                    "text-[12px] leading-tight",
                    selected ? "font-semibold text-foreground" : "font-medium text-foreground/90",
                  )}
                >
                  {option.label}
                </span>
                <span className="text-[11px] leading-snug text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Subtle Footer Telemetry / Runtime Hint */}
      <div className="border-t border-border/60 px-3 py-2 text-[10px] leading-snug text-muted-foreground">
        <div className="flex items-center justify-between gap-2">
          <span>{state.footerHint}</span>
          {isActiveLock && blockerId !== null ? (
            <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground/80 tabular-nums">
              #{blockerId}
            </span>
          ) : null}
        </div>
        {error ? (
          <div className="mt-1 text-red-600 dark:text-red-400">{error}</div>
        ) : null}
      </div>
    </div>
  );
}
