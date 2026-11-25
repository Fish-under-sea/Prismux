import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/utils";

export type WorkspacePageWidth = "readable" | "wide" | "expanded" | "full";

const WIDTH_CLASS: Record<WorkspacePageWidth, string> = {
  readable: "max-w-[820px]",
  wide: "max-w-[1040px]",
  expanded: "max-w-[1040px]",
  full: "max-w-none",
};

export function WorkspacePageContainer({
  width = "readable",
  className,
  ...props
}: ComponentPropsWithoutRef<"div"> & { readonly width?: WorkspacePageWidth }) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-7 px-6 pt-7 pb-14",
        WIDTH_CLASS[width],
        className,
      )}
      {...props}
    />
  );
}
