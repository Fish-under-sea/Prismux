import type { HTMLAttributes } from "react";
import { cn } from "~/lib/utils";

export const PRISMUX_WORDMARK_TEXT = "Ciallo～(∠・ω< )⌒★";

const FIXED_BOX_CLASS_RE = /^(?:(?:[a-z0-9_-]+:)*)?(?:size|w|h|min-w|max-w|min-h|max-h)-[^\s]+$/;

export function stripFixedSquareClasses(className: string | undefined): string | undefined {
  if (!className) return undefined;
  const kept = className
    .split(/\s+/)
    .filter(
      (token) =>
        token.length > 0 &&
        token !== "block" &&
        !FIXED_BOX_CLASS_RE.test(token) &&
        !token.startsWith("stroke-"),
    );
  return kept.length > 0 ? kept.join(" ") : undefined;
}

export function PrismuxWordmark({
  className,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, "children">) {
  return (
    <span
      {...props}
      data-prismux-wordmark="true"
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap font-medium leading-none tracking-tight text-2xs select-none",
        stripFixedSquareClasses(className),
      )}
    >
      {PRISMUX_WORDMARK_TEXT}
    </span>
  );
}
