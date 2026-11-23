import { memo } from "react";
import { ArrowUpIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import {
  formatVersionBadge,
  hasVerifiedUpdatePackage,
  isUpdateTransferActive,
  prismuxUpdateNotifierStore,
  useUpdateNotifierState,
} from "./updateNotifierStore";

export interface PrismuxSidebarUpdateCapsuleProps {
  readonly railCompact: boolean;
}

/**
 * Compact liquid glass update capsule anchored directly above the bottom-left
 * Settings & Usage utility row inside `SidebarChromeFooter`.
 *
 * Zero-footprint guarantee: renders `null` (0px height) when no update has been
 * collapsed into the sidebar capsule.
 */
export const PrismuxSidebarUpdateCapsule = memo(function PrismuxSidebarUpdateCapsule({
  railCompact,
}: PrismuxSidebarUpdateCapsuleProps) {
  const state = useUpdateNotifierState();
  const status = state.updaterStatus;
  const update = state.availableUpdate;

  const isTransferring = state.downloading || isUpdateTransferActive(status);
  const isReady = hasVerifiedUpdatePackage(status);
  const hasUpdateData = Boolean(update?.hasUpdate && update.latestVersion) || isReady || isTransferring;

  // Render strictly when collapsed to capsule (or during active background transfer while modal/toast closed).
  const visible = hasUpdateData && state.presentation === "capsule";
  if (!visible) {
    return null;
  }

  const isFlyingIn = state.flyTransition !== null;
  const versionBadge = formatVersionBadge(update?.latestVersion);
  const progressPercent =
    status?.progress?.percent !== null && status?.progress?.percent !== undefined
      ? Math.max(0, Math.min(100, Math.round(status.progress.percent)))
      : null;

  const tone: "ready" | "transfer" | "available" = isReady
    ? "ready"
    : isTransferring
      ? "transfer"
      : "available";

  const label =
    tone === "ready"
      ? versionBadge
        ? `${versionBadge} 可重启安装`
        : "更新已就绪"
      : tone === "transfer"
        ? status?.progress?.stage === "verifying"
          ? "正在校验更新…"
          : status?.progress?.stage === "extracting"
            ? "分卷重组中…"
            : progressPercent !== null
              ? `下载更新 ${progressPercent}%`
              : "正在下载更新…"
        : versionBadge
          ? `发现新版本 ${versionBadge}`
          : "发现新版本";

  const tooltipText =
    tone === "ready"
      ? `${versionBadge || "Prismux 新版本"} 已通过 SHA-256 校验，点击查看公告并立即重启安装`
      : tone === "transfer"
        ? `${label} · 点击查看实时进度与更新公告`
        : `发现新版本 ${versionBadge || ""} · 点击查看更新公告与软件内一键更新`;

  const dotClass =
    tone === "ready"
      ? "bg-emerald-500"
      : tone === "transfer"
        ? "bg-sky-500"
        : "bg-primary";

  const capsuleToneClass =
    tone === "ready"
      ? "border-emerald-500/40 text-emerald-800 hover:border-emerald-500/65 dark:text-emerald-200"
      : tone === "transfer"
        ? "border-sky-500/40 text-sky-800 hover:border-sky-500/65 dark:text-sky-200"
        : "border-primary/35 text-foreground hover:border-primary/60";

  const handleOpenModal = () => {
    prismuxUpdateNotifierStore.openReleaseModal();
  };

  if (railCompact) {
    return (
      <div className="mb-1 flex w-full justify-center">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-testid="prismux-sidebar-update-capsule"
                data-prismux-update-capsule-slot="true"
                data-pmx-glass-zone="overlays"
                aria-label={tooltipText}
                onClick={handleOpenModal}
                className={cn(
                  "relative inline-flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-full border bg-background/70 shadow-xs outline-none transition-[opacity,transform,border-color,background-color] duration-200 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                  capsuleToneClass,
                  isFlyingIn
                    ? "pointer-events-none scale-90 opacity-0"
                    : "scale-100 opacity-100 hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08]",
                )}
              />
            }
          >
            {tone === "ready" ? (
              <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
            ) : tone === "transfer" ? (
              <RefreshCwIcon className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <ArrowUpIcon className="size-3.5" aria-hidden="true" />
            )}
            <span
              aria-hidden="true"
              className={cn(
                "absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-background",
                dotClass,
                "animate-pulse motion-reduce:animate-none",
              )}
            />
          </TooltipTrigger>
          <TooltipPopup data-pmx-glass-zone="overlays" side="right" sideOffset={8}>
            {tooltipText}
          </TooltipPopup>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="mb-1.5 px-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-testid="prismux-sidebar-update-capsule"
              data-prismux-update-capsule-slot="true"
              data-pmx-glass-zone="overlays"
              aria-label={tooltipText}
              onClick={handleOpenModal}
              className={cn(
                "group relative flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-full border bg-background/70 px-2.5 text-left text-[11.5px] font-medium tabular-nums shadow-xs outline-none transition-[opacity,transform,border-color,background-color] duration-200 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                capsuleToneClass,
                isFlyingIn
                  ? "pointer-events-none scale-95 opacity-0"
                  : "scale-100 opacity-100 hover:bg-foreground/[0.05] dark:hover:bg-white/[0.08]",
              )}
            />
          }
        >
          <span className="relative flex size-2 shrink-0 items-center justify-center" aria-hidden="true">
            <span
              className={cn(
                "absolute inline-flex size-full rounded-full opacity-55 animate-ping motion-reduce:animate-none",
                dotClass,
              )}
            />
            <span className={cn("relative inline-flex size-1.5 rounded-full", dotClass)} />
          </span>

          {tone === "ready" ? (
            <ShieldCheckIcon className="size-3 shrink-0" aria-hidden="true" />
          ) : tone === "transfer" ? (
            <RefreshCwIcon className="size-3 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <ArrowUpIcon className="size-3 shrink-0 text-primary transition-transform duration-150 group-hover:-translate-y-px motion-reduce:transition-none" aria-hidden="true" />
          )}

          <span className="min-w-0 flex-1 truncate">{label}</span>
        </TooltipTrigger>
        <TooltipPopup data-pmx-glass-zone="overlays" side="top" sideOffset={6}>
          {tooltipText}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});
