import { cn } from "~/lib/utils";

/**
 * High-contrast segmented control track across Light, Dark, Dark Glass, and Light Glass overlays.
 * Uses explicit recessed tint + hairline border so the well never blends into dark or glass popovers.
 */
export const STATUS_BAR_SEGMENTED_GROUP_CLASS =
  "inline-flex items-center gap-0.5 rounded-lg border border-black/12 bg-black/[0.06] p-0.5 text-[10.5px] dark:border-white/15 dark:bg-black/45 [[data-pmx-glass='1']_&]:border-white/20 [[data-pmx-glass='1']_&]:bg-black/32 [html:not(.dark)[data-pmx-glass='1']_&]:border-black/14 [html:not(.dark)[data-pmx-glass='1']_&]:bg-black/[0.08]";

/**
 * Segmented option button class with unmistakably highlighted active pill (`bg-primary text-primary-foreground`)
 * and calm transparent unselected items across Light / Dark / Liquid Glass themes.
 */
export function statusBarSegmentedOptionClass(active: boolean): string {
  return cn(
    "cursor-pointer rounded-md border px-2 py-0.5 leading-tight transition-all focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
    active
      ? "border-primary/80 bg-primary font-semibold text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.24)] [@media(forced-colors:active)]:border-[Highlight] [@media(forced-colors:active)]:bg-[Highlight] [@media(forced-colors:active)]:text-[HighlightText]"
      : "border-transparent bg-transparent font-medium text-foreground/65 hover:bg-black/[0.06] hover:text-foreground dark:text-white/65 dark:hover:bg-white/10 dark:hover:text-white [[data-pmx-glass='1']_&]:text-white/68 [[data-pmx-glass='1']_&]:hover:bg-white/12 [[data-pmx-glass='1']_&]:hover:text-white [html:not(.dark)[data-pmx-glass='1']_&]:text-slate-900/65 [html:not(.dark)[data-pmx-glass='1']_&]:hover:bg-black/[0.07] [html:not(.dark)[data-pmx-glass='1']_&]:hover:text-slate-950",
  );
}

/**
 * Tactile secondary action button (Refresh / Scan) that stays legible in Light, Dark, and Liquid Glass
 * instead of relying on `bg-background` (which maps to translucent canvas in Glass mode).
 */
export const STATUS_BAR_ACTION_BUTTON_CLASS =
  "inline-flex cursor-pointer items-center gap-1 rounded-md border border-black/12 bg-black/[0.04] px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-black/[0.09] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring dark:border-white/15 dark:bg-white/[0.08] dark:hover:bg-white/[0.15] [[data-pmx-glass='1']_&]:border-white/20 [[data-pmx-glass='1']_&]:bg-white/12 [[data-pmx-glass='1']_&]:hover:bg-white/20 [html:not(.dark)[data-pmx-glass='1']_&]:border-black/15 [html:not(.dark)[data-pmx-glass='1']_&]:bg-white/65 [html:not(.dark)[data-pmx-glass='1']_&]:hover:bg-white/85";
