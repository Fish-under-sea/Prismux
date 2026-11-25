import { memo } from "react";
import { AlertTriangleIcon, ArrowUpIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import {
  formatProgressPercentDisplay,
  resolveProgressBarPercent,
} from "../settings/prismuxUpdates.logic";
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
  const hasError =
    !isReady &&
    !isTransferring &&
    (Boolean(state.errorMessage) ||
      status?.installState === "error" ||
      status?.progress?.stage === "error");
  const hasUpdateData =
    Boolean(update?.hasUpdate && update.latestVersion) || isReady || isTransferring || hasError;

  // Render strictly when collapsed to capsule (or during active background transfer while modal/toast closed).
  const visible = hasUpdateData && state.presentation === "capsule";
  if (!visible) {
    return null;
  }

  const isFlyingIn = state.flyTransition !== null;
  const versionBadge = formatVersionBadge(update?.latestVersion);
  const barPercent = resolveProgressBarPercent(status?.progress ?? null, isReady && !isTransferring);
  const progressPercentText = formatProgressPercentDisplay(barPercent);

  const tone: "ready" | "transfer" | "error" | "available" = isReady
    ? "ready"
    : isTransferring
      ? "transfer"
      : hasError
        ? "error"
        : "available";

  const label =
    tone === "ready"
      ? versionBadge
        ? `${versionBadge} 可重启安装`
        : "更新已就绪"
      : tone === "transfer"
        ? status?.progress?.stage === "verifying"
          ? progressPercentText
            ? `校验更新 ${progressPercentText}`
            : "正在校验更新…"
          : status?.progress?.stage === "extracting"
            ? progressPercentText
              ? `合并分卷 ${progressPercentText}`
              : "分卷重组中…"
            : progressPercentText !== null
              ? `下载更新 ${progressPercentText}`
              : "正在连接下载源…"
        : tone === "error"
          ? versionBadge
            ? `${versionBadge} 更新失败`
            : "更新失败"
          : versionBadge
            ? `发现新版本 ${versionBadge}`
            : "发现新版本";

  const tooltipText =
    tone === "ready"
      ? `${versionBadge || "Prismux 新版本"} 已通过 SHA-256 校验，点击查看公告并立即重启安装`
      : tone === "transfer"
        ? `${label} · 点击查看实时进度与更新公告`
        : tone === "error"
          ? `${state.errorMessage || status?.lastError || "软件内更新失败"} · 点击查看详情并重试`
          : `发现新版本 ${versionBadge || ""} · 点击查看更新公告与软件内一键更新`;

  const dotClass =
    tone === "ready"
      ? "bg-success"
      : tone === "error"
        ? "bg-destructive"
        : "bg-primary";

  const capsuleToneClass =
    tone === "ready"
      ? "border-success/45 text-success-foreground hover:border-success/70 [[data-pmx-glass='1']_&]:border-success/55 [[data-pmx-glass='1']_&]:bg-success/[0.14] [html:not(.dark)[data-pmx-glass='1']_&]:bg-success/[0.10]"
      : tone === "transfer"
        ? "border-primary/45 text-foreground hover:border-primary/70 dark:border-primary/50 dark:hover:border-primary/75 [[data-pmx-glass='1']_&]:border-primary/55 [[data-pmx-glass='1']_&]:bg-primary/[0.12] [[data-pmx-glass='1']_&]:hover:border-primary/80 [html:not(.dark)[data-pmx-glass='1']_&]:bg-primary/[0.08]"
        : tone === "error"
          ? "border-destructive/45 text-destructive-foreground hover:border-destructive/70 dark:border-destructive/55 [[data-pmx-glass='1']_&]:border-destructive/55 [[data-pmx-glass='1']_&]:bg-destructive/[0.14] [html:not(.dark)[data-pmx-glass='1']_&]:bg-destructive/[0.10]"
          : "border-primary/35 text-foreground hover:border-primary/60 dark:border-primary/40 dark:hover:border-primary/65 [[data-pmx-glass='1']_&]:border-primary/45 [[data-pmx-glass='1']_&]:bg-primary/[0.08] [html:not(.dark)[data-pmx-glass='1']_&]:bg-primary/[0.06]";

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
                data-update-tone={tone}
                aria-label={tooltipText}
                onClick={handleOpenModal}
                className={cn(
                  "relative inline-flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-full border bg-foreground/[0.05] shadow-xs outline-none transition-[opacity,transform,border-color,background-color] duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none dark:bg-white/[0.08]",
                  capsuleToneClass,
                  isFlyingIn
                    ? "pointer-events-none scale-90 opacity-0"
                    : "scale-100 opacity-100 hover:bg-foreground/[0.09] dark:hover:bg-white/[0.12]",
                )}
              />
            }
          >
            {tone === "ready" ? (
              <ShieldCheckIcon className="size-3.5 text-success-foreground" aria-hidden="true" />
            ) : tone === "transfer" ? (
              <RefreshCwIcon className="size-3.5 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
            ) : tone === "error" ? (
              <AlertTriangleIcon className="size-3.5 text-destructive" aria-hidden="true" />
            ) : (
              <ArrowUpIcon className="size-3.5 text-primary" aria-hidden="true" />
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
              data-update-tone={tone}
              aria-label={tooltipText}
              onClick={handleOpenModal}
              className={cn(
                "group relative flex h-7 w-full cursor-pointer items-center gap-1.5 overflow-hidden rounded-full border bg-foreground/[0.05] px-2.5 text-left text-2xs font-medium tabular-nums shadow-xs outline-none transition-[opacity,transform,border-color,background-color] duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none dark:bg-white/[0.08]",
                capsuleToneClass,
                isFlyingIn
                  ? "pointer-events-none scale-95 opacity-0"
                  : "scale-100 opacity-100 hover:bg-foreground/[0.08] dark:hover:bg-white/[0.12]",
              )}
            />
          }
        >
          {tone === "transfer" && barPercent !== null ? (
            <span
              aria-hidden="true"
              data-testid="prismux-sidebar-update-capsule-progress"
              className="pointer-events-none absolute inset-y-0 left-0 bg-primary/18 transition-[width] duration-200 ease-out motion-reduce:transition-none dark:bg-primary/22 [[data-pmx-glass='1']_&]:bg-primary/24 [html:not(.dark)[data-pmx-glass='1']_&]:bg-primary/18"
              style={{ width: `${barPercent}%` }}
            />
          ) : null}
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
            <ShieldCheckIcon className="relative size-3 shrink-0 text-success-foreground" aria-hidden="true" />
          ) : tone === "transfer" ? (
            <RefreshCwIcon className="relative size-3 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
          ) : tone === "error" ? (
            <AlertTriangleIcon className="relative size-3 shrink-0 text-destructive" aria-hidden="true" />
          ) : (
            <ArrowUpIcon className="relative size-3 shrink-0 text-primary transition-transform duration-150 group-hover:-translate-y-px motion-reduce:transition-none" aria-hidden="true" />
          )}

          <span className="relative min-w-0 flex-1 truncate">{label}</span>
        </TooltipTrigger>
        <TooltipPopup data-pmx-glass-zone="overlays" side="top" sideOffset={6}>
          {tooltipText}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});
