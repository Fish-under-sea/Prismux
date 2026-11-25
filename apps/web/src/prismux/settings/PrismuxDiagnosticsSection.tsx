import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider } from "@prismux/core-contracts";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { T, useGT, useLocale } from "gt-react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  CpuIcon,
  DatabaseIcon,
  GlobeIcon,
  LayersIcon,
  RefreshCwIcon,
  WrenchIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
import { SidebarInset } from "../../components/ui/sidebar";
import { toastManager } from "../../components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { SettingsSection } from "../../components/settings/settingsLayout";
import { useNavigateToMainApp } from "../../components/sidebar/mainAppLocation";
import {
  PrismuxStageFrame,
  useWorkspaceTopbarPortal,
} from "../../components/workspace/WorkspaceTopbarPortalContext";
import { useStableCallback } from "../../hooks/useStableCallback";
import { cn } from "../../lib/utils";
import {
  brandProviderInstanceEntries,
  deriveProviderInstanceEntries,
  disambiguateProviderInstanceDisplayNames,
  orderItemsByConfiguredProviderOrder,
  orderProviderInstanceEntries,
  resolveConfiguredProviderLabel,
  type ProviderInstanceEntry,
  type ProviderInstanceOrderSettings,
} from "../../providerInstances";
import { primaryServerProvidersAtom, primaryServerSettingsAtom } from "../../state/server";
import { formatAgentBrandName } from "../agentBrand";
import { prismuxDaemonClient, type DaemonDiagnosticsStatus } from "../daemonClient";
import {
  createDiagnosticsRefreshController,
  DIAGNOSTICS_AUTO_REFRESH_COOLDOWN_MS,
  filterDiagnosticsReport,
  formatCompactDiagnosticSummary,
  formatCompactDiagnosticVersion,
  formatDiagnosticsTimestamp,
  getDiagnosticsStandaloneCopy,
  getLatestNormalizedDiagnosticsReport,
  isDiagnosticsEscapeTarget,
  isDiagnosticsStandalonePathname,
  publishDiagnosticsReport,
  subscribeDiagnosticsRefreshRequest,
  subscribeDiagnosticsReport,
  toggleDiagnosticStatusFilter,
  type DiagnosticStatusFilter,
  type NormalizedDiagnosticGroup,
  type NormalizedDiagnosticItem,
  type NormalizedDiagnosticsReport,
} from "./prismuxDiagnostics.logic";

/**
 * Shared Apple Liquid Glass Fresnel rim + specular top highlight matching
 * PrismuxPluginCenterView across Light, Dark, and Liquid Glass themes.
 */
const GLASS_SURFACE_RIM =
  // oxlint-disable-next-line shadcn/no-arbitrary-values -- Apple Liquid Glass Fresnel specular top highlight rim
  "rounded-xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]";

const CARD_META_PILL_CLASS =
  "rounded-md bg-foreground/[0.055] px-1.5 py-0.5 font-mono text-2xs leading-tight tabular-nums text-muted-foreground dark:bg-white/[0.08] [[data-pmx-glass='1']_&]:bg-white/[0.10] [[data-pmx-glass='1']_&]:text-foreground/80 [html:not(.dark)[data-pmx-glass='1']_&]:bg-foreground/[0.075] [html:not(.dark)[data-pmx-glass='1']_&]:text-foreground/75";

function statusToneClasses(status: DaemonDiagnosticsStatus): {
  readonly dot: string;
  readonly cardSurface: string;
  readonly dormantSurface: string;
  readonly groupIconTray: string;
  readonly badgeVariant: "success" | "warning" | "error";
} {
  switch (status) {
    case "ok":
      return {
        dot: "bg-success",
        cardSurface:
          "border-border/60 bg-foreground/[0.025] hover:-translate-y-px hover:border-border hover:bg-foreground/[0.045] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_6px_16px_-10px_rgba(0,0,0,0.12)] dark:bg-white/[0.035] dark:hover:border-white/20 dark:hover:bg-white/[0.055] dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_8px_20px_-10px_rgba(0,0,0,0.45)] [[data-pmx-glass='1']_&]:border-white/14 [[data-pmx-glass='1']_&]:bg-white/[0.055] [[data-pmx-glass='1']_&]:hover:border-white/24 [[data-pmx-glass='1']_&]:hover:bg-white/[0.085] [html:not(.dark)[data-pmx-glass='1']_&]:border-foreground/12 [html:not(.dark)[data-pmx-glass='1']_&]:bg-white/58 [html:not(.dark)[data-pmx-glass='1']_&]:hover:border-foreground/20 [html:not(.dark)[data-pmx-glass='1']_&]:hover:bg-white/74",
        dormantSurface:
          "border-border/60 bg-foreground/[0.025] hover:border-border hover:bg-foreground/[0.04] dark:bg-white/[0.035] dark:hover:border-white/18 dark:hover:bg-white/[0.05] [[data-pmx-glass='1']_&]:border-white/14 [[data-pmx-glass='1']_&]:bg-white/[0.055] [[data-pmx-glass='1']_&]:hover:border-white/22 [html:not(.dark)[data-pmx-glass='1']_&]:border-foreground/12 [html:not(.dark)[data-pmx-glass='1']_&]:bg-white/58 [html:not(.dark)[data-pmx-glass='1']_&]:hover:bg-white/70",
        groupIconTray:
          "border-border/60 bg-foreground/[0.04] text-muted-foreground dark:bg-white/[0.06]",
        badgeVariant: "success",
      };
    case "degraded":
      return {
        dot: "bg-warning ring-2 ring-warning/20",
        cardSurface:
          "border-amber-500/35 border-l-[3px] border-l-amber-500 bg-amber-500/[0.06] hover:-translate-y-px hover:border-amber-500/55 hover:bg-amber-500/[0.085] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.60),0_6px_16px_-10px_rgba(217,119,6,0.18)] dark:border-amber-400/35 dark:border-l-amber-400 dark:bg-amber-400/[0.07] dark:hover:border-amber-400/55 dark:hover:bg-amber-400/[0.10] dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_8px_20px_-10px_rgba(0,0,0,0.45)] [[data-pmx-glass='1']_&]:border-warning/40 [[data-pmx-glass='1']_&]:bg-warning/[0.095] [[data-pmx-glass='1']_&]:hover:border-warning/60 [[data-pmx-glass='1']_&]:hover:bg-warning/[0.135] [html:not(.dark)[data-pmx-glass='1']_&]:border-warning/40 [html:not(.dark)[data-pmx-glass='1']_&]:bg-warning/[0.11] [html:not(.dark)[data-pmx-glass='1']_&]:hover:border-warning/60 [html:not(.dark)[data-pmx-glass='1']_&]:hover:bg-warning/[0.16]",
        dormantSurface:
          "border-amber-500/35 border-l-[3px] border-l-amber-500 bg-amber-500/[0.06] hover:border-amber-500/50 dark:border-amber-400/35 dark:border-l-amber-400 dark:bg-amber-400/[0.07] dark:hover:border-amber-400/50 [[data-pmx-glass='1']_&]:border-warning/40 [[data-pmx-glass='1']_&]:bg-warning/[0.095] [html:not(.dark)[data-pmx-glass='1']_&]:border-warning/40 [html:not(.dark)[data-pmx-glass='1']_&]:bg-warning/[0.11]",
        groupIconTray:
          "border-warning/35 bg-warning/12 text-warning-foreground dark:border-warning/35 dark:bg-warning/15",
        badgeVariant: "warning",
      };
    case "error":
      return {
        dot: "bg-destructive ring-2 ring-destructive/20",
        cardSurface:
          "border-destructive/40 border-l-[3px] border-l-destructive bg-destructive/[0.065] hover:-translate-y-px hover:border-destructive/60 hover:bg-destructive/[0.09] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.60),0_6px_16px_-10px_rgba(239,68,68,0.20)] dark:border-destructive/45 dark:border-l-destructive dark:bg-destructive/[0.09] dark:hover:border-destructive/65 dark:hover:bg-destructive/[0.12] dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_8px_20px_-10px_rgba(0,0,0,0.45)] [[data-pmx-glass='1']_&]:border-destructive/50 [[data-pmx-glass='1']_&]:bg-destructive/[0.13] [[data-pmx-glass='1']_&]:hover:border-destructive/70 [[data-pmx-glass='1']_&]:hover:bg-destructive/[0.17] [html:not(.dark)[data-pmx-glass='1']_&]:border-destructive/45 [html:not(.dark)[data-pmx-glass='1']_&]:bg-destructive/[0.11] [html:not(.dark)[data-pmx-glass='1']_&]:hover:border-destructive/65 [html:not(.dark)[data-pmx-glass='1']_&]:hover:bg-destructive/[0.16]",
        dormantSurface:
          "border-destructive/40 border-l-[3px] border-l-destructive bg-destructive/[0.065] hover:border-destructive/55 dark:border-destructive/45 dark:border-l-destructive dark:bg-destructive/[0.09] dark:hover:border-destructive/60 [[data-pmx-glass='1']_&]:border-destructive/50 [[data-pmx-glass='1']_&]:bg-destructive/[0.13] [html:not(.dark)[data-pmx-glass='1']_&]:border-destructive/45 [html:not(.dark)[data-pmx-glass='1']_&]:bg-destructive/[0.11]",
        groupIconTray:
          "border-destructive/35 bg-destructive/12 text-destructive-foreground dark:border-destructive/40 dark:bg-destructive/18",
        badgeVariant: "error",
      };
  }
}

function categoryIconComponent(groupId: string): ComponentType<{ className?: string }> {
  switch (groupId) {
    case "host_core":
      return CpuIcon;
    case "memory_sync":
      return DatabaseIcon;
    case "ai_providers":
      return BotIcon;
    case "simulators_media":
      return WrenchIcon;
    case "network_mirrors":
      return GlobeIcon;
    case "dormant_engines":
      return LayersIcon;
    default:
      return ActivityIcon;
  }
}

function useCopyFixCommand() {
  const gt = useGT();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyCommand = async (id: string, command: string) => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(command);
      setCopiedId(id);
      toastManager.add({
        type: "success",
        title: gt("Command copied"),
        description: command,
      });
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1600);
    } catch {
      toastManager.add({
        type: "error",
        title: gt("Could not copy command"),
        description: command,
      });
    }
  };

  return { copiedId, copyCommand };
}

function categoryHeadingLabel(
  group: NormalizedDiagnosticGroup,
  gt: ReturnType<typeof useGT>,
): string {
  switch (group.id) {
    case "host_core":
      return gt("Host Core");
    case "memory_sync":
      return gt("Memory & Sync");
    case "ai_providers":
      return gt("AI Provider CLIs");
    case "simulators_media":
      return gt("Simulators & Media Tools");
    case "network_mirrors":
      return gt("Network & Mirrors");
    case "dormant_engines":
      return gt("Dormant Engines Summary");
    default:
      return group.fallbackLabel;
  }
}

function statusLabel(status: DaemonDiagnosticsStatus, gt: ReturnType<typeof useGT>): string {
  switch (status) {
    case "ok":
      return gt("Healthy");
    case "degraded":
      return gt("Degraded");
    case "error":
      return gt("Error");
  }
}

function GroupStatusPills({ group }: { readonly group: NormalizedDiagnosticGroup }) {
  const gt = useGT();
  return (
    <div className="flex flex-wrap items-center gap-1.5 font-mono text-2xs tabular-nums">
      {group.okCount > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 font-medium text-success-foreground dark:bg-success/14">
          <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
          {group.okCount} {gt("Healthy")}
        </span>
      ) : null}
      {group.degradedCount > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-warning/12 px-2 py-0.5 font-medium text-warning-foreground dark:bg-warning/16">
          <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
          {group.degradedCount} {gt("Degraded")}
        </span>
      ) : null}
      {group.errorCount > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/12 px-2 py-0.5 font-medium text-destructive-foreground dark:bg-destructive/18">
          <span className="size-1.5 rounded-full bg-destructive" aria-hidden="true" />
          {group.errorCount} {gt("Error")}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Unified 3-band compact diagnostic card (~108–118px consistent footprint across every group):
 * 1. Single-line header: status dot + bold 13px title + compact status badge
 * 2. Crisp 2-line body: single-line summary + single-line mono path/detail (full tooltips, zero multi-line bloat)
 * 3. Unified single-row bottom strip: version/latency capsules on left + inline actions on right
 */
function CompactDiagnosticCard({
  item,
  readOnly = false,
  copied = false,
  onCopyCommand,
}: {
  readonly item: NormalizedDiagnosticItem;
  readonly readOnly?: boolean;
  readonly copied?: boolean;
  readonly onCopyCommand?: (id: string, command: string) => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  const cardCopy = getDiagnosticsStandaloneCopy(locale);
  const tone = statusToneClasses(item.status);
  const displaySummary = formatCompactDiagnosticSummary(item.summary);
  const displayVersion = formatCompactDiagnosticVersion(item.version);
  const secondaryDetail = readOnly ? item.detail : (item.detail ?? item.fixAction ?? null);
  const fixCommand = readOnly ? null : item.fixCommand;
  const settingsRoute = readOnly ? null : item.settingsRoute;
  const hasFooterActions = Boolean(fixCommand || settingsRoute);
  const hasBottomStrip = Boolean(displayVersion || item.latencyMs !== null || hasFooterActions);

  return (
    <article
      data-diagnostic-card="true"
      data-diagnostic-id={item.id}
      data-diagnostic-status={item.status}
      data-diagnostic-readonly={readOnly ? "true" : undefined}
      className={cn(
        "group/diag-card flex h-full min-w-0 flex-col gap-1.5 p-3 transition-all duration-150 motion-reduce:transition-none motion-reduce:transform-none",
        GLASS_SURFACE_RIM,
        readOnly ? tone.dormantSurface : tone.cardSurface,
      )}
    >
      {/* Band 1: Single-line header */}
      <div className="flex min-h-5 shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("size-2 shrink-0 rounded-full", tone.dot)} aria-hidden="true" />
          <h5
            // oxlint-disable-next-line shadcn/no-arbitrary-values -- compact 13px Level-1 card heading per diagnostics spec
            className="truncate text-[13px] font-semibold tracking-tight text-foreground"
            // oxlint-disable-next-line prismux/no-native-title-tooltip -- preserves full truncated title on hover
            title={item.name}
          >
            {item.name}
          </h5>
        </div>
        <Badge variant={tone.badgeVariant} size="sm" className="shrink-0">
          {statusLabel(item.status, gt)}
        </Badge>
      </div>

      {/* Band 2: Crisp 2-line body (single-line primary summary + single-line mono path/detail) */}
      <div className="flex min-h-8.5 min-w-0 flex-col gap-0.5">
        <p
          data-diagnostic-card-summary="true"
          className="truncate text-xs font-medium leading-4.25 text-foreground/88"
          // oxlint-disable-next-line prismux/no-native-title-tooltip -- preserves full raw diagnostic summary on hover for single-line truncated cards
          title={item.summary}
        >
          {displaySummary}
        </p>

        {secondaryDetail ? (
          <p
            data-diagnostic-card-detail="true"
            className="truncate font-mono text-2xs leading-3.75 text-muted-foreground"
            // oxlint-disable-next-line prismux/no-native-title-tooltip -- preserves full path/detail on hover for single-line truncated cards
            title={secondaryDetail}
          >
            {secondaryDetail}
          </p>
        ) : (
          <span aria-hidden="true" className="block h-3.75 select-none" />
        )}
      </div>

      {/* Band 3: Unified single-row bottom meta + inline action strip (zero <code> tags) */}
      {hasBottomStrip ? (
        <div
          data-diagnostic-card-bottom="true"
          className="mt-auto flex min-h-5.5 min-w-0 items-center gap-1.5 pt-1.5"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {displayVersion ? (
              <span
                data-diagnostic-version-pill="true"
                className={cn("min-w-0 truncate", CARD_META_PILL_CLASS)}
                // oxlint-disable-next-line prismux/no-native-title-tooltip -- preserves full raw version string on hover for compact version pill
                title={item.version ?? displayVersion}
              >
                {displayVersion}
              </span>
            ) : null}
            {item.latencyMs !== null ? (
              <span className={cn("shrink-0", CARD_META_PILL_CLASS)}>{item.latencyMs} ms</span>
            ) : null}
          </div>

          {hasFooterActions ? (
            <div
              data-diagnostic-card-footer="true"
              className="ml-auto flex shrink-0 items-center gap-1"
            >
              {fixCommand && onCopyCommand ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        data-diagnostic-copy-command="true"
                        aria-label={gt("Copy fix command")}
                        // oxlint-disable-next-line prismux/no-native-title-tooltip -- keeps raw fix command accessible in both TooltipPopup and native title attribute
                        title={fixCommand}
                        onClick={() => onCopyCommand(item.id, fixCommand)}
                        className={cn(
                          "inline-flex h-5.5 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-1.5 text-2xs font-medium leading-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
                          copied
                            ? "border-success/45 bg-success/12 text-success-foreground dark:border-success/45 dark:bg-success/16"
                            : "border-border/70 bg-foreground/[0.04] text-foreground/85 hover:border-border hover:bg-foreground/[0.08] hover:text-foreground dark:border-white/15 dark:bg-white/[0.07] dark:hover:border-white/25 dark:hover:bg-white/[0.12] [[data-pmx-glass='1']_&]:border-white/20 [[data-pmx-glass='1']_&]:bg-white/[0.09] [[data-pmx-glass='1']_&]:hover:bg-white/[0.16] [html:not(.dark)[data-pmx-glass='1']_&]:border-foreground/18 [html:not(.dark)[data-pmx-glass='1']_&]:bg-white/75 [html:not(.dark)[data-pmx-glass='1']_&]:text-foreground [html:not(.dark)[data-pmx-glass='1']_&]:hover:bg-white/95",
                        )}
                      />
                    }
                  >
                    {copied ? (
                      <CheckIcon
                        className="size-3 shrink-0 text-success-foreground"
                        aria-hidden="true"
                      />
                    ) : (
                      <CopyIcon className="size-3 shrink-0 opacity-80" aria-hidden="true" />
                    )}
                    <span className="whitespace-nowrap">
                      {copied ? `${gt("Copied")} ✓` : cardCopy.copyFixLabel}
                    </span>
                  </TooltipTrigger>
                  <TooltipPopup data-pmx-glass-zone="overlays" side="top" sideOffset={6}>
                    <span className="block max-w-xs break-words font-mono text-2xs">
                      {fixCommand}
                    </span>
                  </TooltipPopup>
                </Tooltip>
              ) : null}

              {settingsRoute ? (
                <Link
                  to={settingsRoute as never}
                  data-diagnostic-settings-link="true"
                  aria-label={gt("Open settings")}
                  className="inline-flex h-5.5 shrink-0 items-center gap-0.5 rounded px-1 text-2xs font-medium whitespace-nowrap text-primary underline-offset-2 transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                >
                  <span>{gt("Settings")}</span>
                  <ArrowRightIcon className="size-3 shrink-0" aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function DormantEngineReadOnlyCard({ engine }: { readonly engine: NormalizedDiagnosticItem }) {
  return <CompactDiagnosticCard item={engine} readOnly />;
}

export function DiagnosticItemCard({
  item,
  copied,
  onCopyCommand,
}: {
  readonly item: NormalizedDiagnosticItem;
  readonly copied: boolean;
  readonly onCopyCommand: (id: string, command: string) => void;
}) {
  return <CompactDiagnosticCard item={item} copied={copied} onCopyCommand={onCopyCommand} />;
}

function kpiTileSurfaceClasses(
  filterKey: DiagnosticStatusFilter,
  selected: boolean,
  hasCount: boolean,
): {
  readonly container: string;
  readonly iconTray: string;
  readonly valueText: string;
  readonly indicatorBar: string;
} {
  switch (filterKey) {
    case "all":
      return {
        container: selected
          ? "border-primary/60 bg-primary/[0.085] ring-1 ring-primary/20 -translate-y-px shadow-[inset_0_1px_0_rgba(255,255,255,0.60),0_4px_12px_-4px_rgba(0,0,0,0.08)] dark:border-primary/65 dark:bg-primary/[0.15] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_14px_-4px_rgba(0,0,0,0.35)]"
          : "border-border/60 bg-foreground/[0.025] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:border-border hover:bg-foreground/[0.045] dark:bg-white/[0.035] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] dark:hover:border-white/20 dark:hover:bg-white/[0.055]",
        iconTray: selected
          ? "border-primary/35 bg-primary/14 text-primary"
          : "border-border/60 bg-foreground/[0.04] text-muted-foreground dark:bg-white/[0.06]",
        valueText: "text-foreground",
        indicatorBar: "bg-primary",
      };
    case "ok":
      return {
        container: selected
          ? "border-emerald-500/60 bg-emerald-500/[0.09] ring-1 ring-emerald-500/20 -translate-y-px shadow-[inset_0_1px_0_rgba(255,255,255,0.60),0_4px_12px_-4px_rgba(0,0,0,0.08)] dark:border-emerald-400/60 dark:bg-emerald-400/[0.13] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_14px_-4px_rgba(0,0,0,0.35)]"
          : "border-border/60 bg-foreground/[0.025] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:border-emerald-500/40 hover:bg-emerald-500/[0.05] dark:bg-white/[0.035] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] dark:hover:border-emerald-400/40 dark:hover:bg-emerald-400/[0.07]",
        iconTray:
          "border-emerald-500/30 bg-emerald-500/12 text-success-foreground dark:border-emerald-400/30 dark:bg-emerald-400/14",
        valueText: "text-success-foreground",
        indicatorBar: "bg-emerald-500",
      };
    case "degraded":
      return {
        container: selected
          ? "border-amber-500/65 bg-amber-500/[0.11] ring-1 ring-amber-500/25 -translate-y-px shadow-[inset_0_1px_0_rgba(255,255,255,0.60),0_4px_12px_-4px_rgba(0,0,0,0.08)] dark:border-amber-400/65 dark:bg-amber-400/[0.15] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_14px_-4px_rgba(0,0,0,0.35)]"
          : hasCount
            ? "border-amber-500/30 bg-amber-500/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:border-amber-500/50 hover:bg-amber-500/[0.08] dark:border-amber-400/30 dark:bg-amber-400/[0.055] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] dark:hover:border-amber-400/50 dark:hover:bg-amber-400/[0.09]"
            : "border-border/60 bg-foreground/[0.025] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:border-amber-500/40 hover:bg-amber-500/[0.05] dark:bg-white/[0.035] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] dark:hover:border-amber-400/40 dark:hover:bg-amber-400/[0.07]",
        iconTray:
          "border-amber-500/30 bg-amber-500/12 text-warning-foreground dark:border-amber-400/30 dark:bg-amber-400/15",
        valueText: "text-warning-foreground",
        indicatorBar: "bg-amber-500",
      };
    case "error":
      return {
        container: selected
          ? "border-destructive/65 bg-destructive/[0.11] ring-1 ring-destructive/25 -translate-y-px shadow-[inset_0_1px_0_rgba(255,255,255,0.60),0_4px_12px_-4px_rgba(0,0,0,0.08)] dark:border-destructive/70 dark:bg-destructive/[0.16] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_14px_-4px_rgba(0,0,0,0.35)]"
          : hasCount
            ? "border-destructive/35 bg-destructive/[0.05] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:border-destructive/55 hover:bg-destructive/[0.085] dark:border-destructive/40 dark:bg-destructive/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] dark:hover:border-destructive/60 dark:hover:bg-destructive/[0.11]"
            : "border-border/60 bg-foreground/[0.025] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:border-destructive/40 hover:bg-destructive/[0.05] dark:bg-white/[0.035] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] dark:hover:border-destructive/45 dark:hover:bg-destructive/[0.08]",
        iconTray:
          "border-destructive/30 bg-destructive/12 text-destructive-foreground dark:border-destructive/35 dark:bg-destructive/18",
        valueText: "text-destructive-foreground",
        indicatorBar: "bg-destructive",
      };
  }
}

function extractDiagnosticProviderKey(
  item: Pick<NormalizedDiagnosticItem, "id" | "name">,
): string {
  const trimmedId = item.id.trim();
  if (/^provider[.:_-]/i.test(trimmedId)) {
    return trimmedId.replace(/^provider[.:_-]+/i, "");
  }
  return trimmedId || item.name;
}

function applyConfiguredProviderBrandingToDiagnosticItem(
  item: NormalizedDiagnosticItem,
  configuredEntries: ReadonlyArray<ProviderInstanceEntry>,
): NormalizedDiagnosticItem {
  if (item.category !== "ai_providers" || configuredEntries.length === 0) {
    return item;
  }
  const providerKey = extractDiagnosticProviderKey(item);
  const defaultBrand = formatAgentBrandName(providerKey);
  const resolvedLabel = resolveConfiguredProviderLabel(providerKey, configuredEntries, item.name);
  const normalizedResolved = resolvedLabel.trim().toLowerCase();
  const isCustomized =
    normalizedResolved.length > 0 &&
    normalizedResolved !== item.name.trim().toLowerCase() &&
    normalizedResolved !== defaultBrand.trim().toLowerCase();
  if (!isCustomized) {
    return item;
  }
  const detailParts = [item.name, item.detail].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  return {
    ...item,
    name: resolvedLabel,
    detail: detailParts.join(" · "),
  };
}

export interface PrismuxDiagnosticsSectionProps {
  readonly variant?: "full" | "compact";
  /** Render inside the standalone full-width workbench stage frame (auto-enabled on `/diagnostics`). */
  readonly standalone?: boolean | undefined;
  readonly initialReportOverride?: NormalizedDiagnosticsReport | null | undefined;
  readonly initialStatusFilter?: DiagnosticStatusFilter;
  readonly serverProvidersOverride?: ReadonlyArray<ServerProvider>;
  readonly settingsOverride?: ProviderInstanceOrderSettings | null;
}

function PrismuxDiagnosticsStandaloneFrame({
  report,
  loading,
  onRerun,
  children,
}: {
  readonly report: NormalizedDiagnosticsReport | null;
  readonly loading: boolean;
  readonly onRerun: () => void;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const locale = useLocale();
  const standaloneCopy = getDiagnosticsStandaloneCopy(locale);
  const navigateToMainApp = useNavigateToMainApp();
  const topbarPortal = useWorkspaceTopbarPortal();

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- window Escape key listener closes standalone panel when no modal/input owns focus
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (isDiagnosticsEscapeTarget(event.target)) return;
      event.preventDefault();
      void navigateToMainApp();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateToMainApp]);

  return (
    <SidebarInset className="h-dvh min-w-0 flex-1 overflow-hidden">
      <PrismuxStageFrame
        glassZone="workPanels"
        rightPanelOpen={topbarPortal.standaloneRightPanelOpen}
      >
        <div
          id="prismux-diagnostics"
          data-testid="prismux-diagnostics-page"
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {/* Unified Full-Bleed Top Header Bar — aligned 1:1 with Tasks / Workspace Board / Scheduled Tasks */}
          <header
            data-testid="diagnostics-page-header"
            className="flex flex-none flex-wrap items-center justify-between gap-2.5 border-b border-border/65 px-4 py-2.5"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/14 text-primary">
                <ActivityIcon className="size-4" aria-hidden="true" />
              </span>

              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
                  {gt("Prismux Service Diagnostics")}
                </h1>

                {report ? (
                  <div
                    data-testid="diagnostics-header-summary"
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    <span
                      data-testid="diagnostics-summary-pill"
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-2xs font-medium tabular-nums",
                        report.summary.error === 0 && report.summary.degraded === 0
                          ? "border-success/35 bg-success/12 text-success-foreground dark:border-success/35 dark:bg-success/14"
                          : "border-border/65 bg-muted/75 text-foreground/85",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-1.5 rounded-full",
                          report.summary.error > 0
                            ? "bg-destructive"
                            : report.summary.degraded > 0
                              ? "bg-warning"
                              : "bg-success",
                        )}
                      />
                      {standaloneCopy.summaryHealthyPill(report.summary.ok, report.summary.total)}
                    </span>

                    {report.summary.degraded > 0 ? (
                      <span
                        data-testid="diagnostics-degraded-pill"
                        className="inline-flex shrink-0 items-center rounded-full border border-warning/35 bg-warning/12 px-2 py-0.5 font-mono text-2xs font-medium text-warning-foreground tabular-nums dark:border-warning/35 dark:bg-warning/16"
                      >
                        {standaloneCopy.summaryDegradedPill(report.summary.degraded)}
                      </span>
                    ) : null}

                    {report.summary.error > 0 ? (
                      <span
                        data-testid="diagnostics-error-pill"
                        className="inline-flex shrink-0 items-center rounded-full border border-destructive/35 bg-destructive/12 px-2 py-0.5 font-mono text-2xs font-medium text-destructive-foreground tabular-nums dark:border-destructive/40 dark:bg-destructive/18"
                      >
                        {standaloneCopy.summaryErrorPill(report.summary.error)}
                      </span>
                    ) : null}

                    <span
                      data-testid="diagnostics-last-checked"
                      className="text-2xs text-muted-foreground tabular-nums"
                    >
                      {formatDiagnosticsTimestamp(report.checkedAt)}
                      {/* oxlint-disable-next-line prismux/no-untranslated-copy -- numeric millisecond telemetry suffix */}
                      {report.durationMs !== null ? ` · ${report.durationMs} ms` : ""}
                    </span>

                    {report.cached ? (
                      <Badge variant="outline" size="sm">
                        {gt("Cached")}
                      </Badge>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                data-testid="diagnostics-rerun-button"
                data-pmx-work-panel-control="1"
                disabled={loading}
                onClick={onRerun}
              >
                <RefreshCwIcon
                  className={cn("size-3.5", loading && "animate-spin motion-reduce:animate-none")}
                />
                {loading ? gt("Running diagnostics…") : gt("Re-run diagnostics")}
              </Button>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost-muted"
                      size="icon-sm"
                      data-testid="diagnostics-close-button"
                      onClick={() => void navigateToMainApp()}
                      aria-label={standaloneCopy.closeLabel}
                    />
                  }
                >
                  <XIcon className="size-4" />
                </TooltipTrigger>
                <TooltipPopup side="bottom" sideOffset={6}>
                  {standaloneCopy.closeTooltip}
                </TooltipPopup>
              </Tooltip>
            </div>
          </header>

          {/* Full-Bleed Edge-to-Edge Body (no narrow centered max-w-* container) */}
          <div
            data-testid="diagnostics-page-body"
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-gutter-both"
          >
            <div className="flex w-full flex-col gap-5" aria-busy={loading}>
              {children}
            </div>
          </div>
        </div>
      </PrismuxStageFrame>
    </SidebarInset>
  );
}

/**
 * Prismux Service Diagnostics Center (`GET /v1/diagnostics/services`).
 * `full` mounts as a standalone full-width workbench panel at `/diagnostics`; `compact` mounts on `/welcome` and hides if Daemon is unreachable.
 */
function PrismuxDiagnosticsContent({
  variant = "full",
  standalone = false,
  initialReportOverride,
  initialStatusFilter = "all",
  serverProvidersOverride,
  settingsOverride,
}: {
  readonly variant: "full" | "compact";
  readonly standalone: boolean;
  readonly initialReportOverride?: NormalizedDiagnosticsReport | null | undefined;
  readonly initialStatusFilter: DiagnosticStatusFilter;
  readonly serverProvidersOverride?: ReadonlyArray<ServerProvider> | undefined;
  readonly settingsOverride?: ProviderInstanceOrderSettings | null | undefined;
}) {
  const gt = useGT();
  const { copiedId, copyCommand } = useCopyFixCommand();
  const liveServerProviders = useAtomValue(primaryServerProvidersAtom);
  const liveServerSettings = useAtomValue(primaryServerSettingsAtom);
  const effectiveProviders = serverProvidersOverride ?? liveServerProviders;
  const effectiveSettings =
    settingsOverride !== undefined ? settingsOverride : liveServerSettings;
  const derivedEntries = deriveProviderInstanceEntries(effectiveProviders);
  const brandedEntries = effectiveSettings
    ? brandProviderInstanceEntries(derivedEntries, effectiveSettings)
    : derivedEntries;
  const configuredProviderEntries = disambiguateProviderInstanceDisplayNames(
    orderProviderInstanceEntries(brandedEntries, effectiveSettings?.providerOrder),
  );
  const [report, setReport] = useState<NormalizedDiagnosticsReport | null>(() =>
    initialReportOverride !== undefined
      ? initialReportOverride
      : getLatestNormalizedDiagnosticsReport(),
  );
  const [loading, setLoading] = useState(() => initialReportOverride === undefined);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [compactOpen, setCompactOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<DiagnosticStatusFilter>(initialStatusFilter);

  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const refreshControllerRef = useRef<ReturnType<typeof createDiagnosticsRefreshController> | null>(
    null,
  );

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- tracks mount lifetime to guard async daemon probe commits after unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadDiagnostics = useStableCallback(
    async (force: boolean, options?: { silent?: boolean }) => {
      const seq = ++requestSeqRef.current;
      setLoading(true);
      if (!options?.silent) {
        setErrorMsg(null);
      }
      try {
        const response = force
          ? await prismuxDaemonClient.refreshDiagnosticsServices()
          : await prismuxDaemonClient.fetchDiagnosticsServices(false);
        if (!mountedRef.current || seq !== requestSeqRef.current) {
          return;
        }
        const normalized = publishDiagnosticsReport(response);
        setReport(normalized);
        setErrorMsg(null);
        refreshControllerRef.current?.markRefreshed();
      } catch (error) {
        if (!mountedRef.current || seq !== requestSeqRef.current) {
          return;
        }
        if (!options?.silent) {
          setErrorMsg(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (mountedRef.current && seq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
  );

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- binds Imperative refresh throttle controller ref to latest daemon probe callback
  useEffect(() => {
    const prevTimestamp = refreshControllerRef.current?.getLastTriggeredAt();
    const controller = createDiagnosticsRefreshController(
      () => {
        void loadDiagnostics(true, { silent: true });
      },
      { cooldownMs: DIAGNOSTICS_AUTO_REFRESH_COOLDOWN_MS },
    );
    if (prevTimestamp !== undefined && Number.isFinite(prevTimestamp)) {
      controller.markRefreshed(prevTimestamp);
    }
    refreshControllerRef.current = controller;
  }, [loadDiagnostics]);

  // Initial mount: opening the diagnostics panel always runs a fresh `force=1` hot-probe
  // (refreshing Windows registry env & bypassing TTL cache), while keeping any prior report visible.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- triggers initial external daemon HTTP diagnostics probe on mount
  useEffect(() => {
    if (initialReportOverride !== undefined) return;
    const forceRefresh = variant === "full";
    if (forceRefresh) {
      refreshControllerRef.current?.markRefreshed();
    }
    void Promise.resolve().then(() => loadDiagnostics(forceRefresh));
  }, [initialReportOverride, loadDiagnostics, variant]);

  // Sync with externally published reports (e.g. sidebar background refresh) and explicit reload broadcasts.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to external diagnostics broadcast bus for cross-panel sync
  useEffect(() => {
    if (initialReportOverride !== undefined) return;
    const unsubReport = subscribeDiagnosticsReport(({ report: nextReport }) => {
      setReport((current) => {
        if (!current || nextReport.checkedAt >= current.checkedAt) {
          return nextReport;
        }
        return current;
      });
    });
    const unsubRequest = subscribeDiagnosticsRefreshRequest((reason) => {
      if (variant !== "full") return;
      refreshControllerRef.current?.trigger(reason, { bypassCooldown: true });
    });
    return () => {
      unsubReport();
      unsubRequest();
    };
  }, [initialReportOverride, variant]);

  // Auto hot-reload on window focus / tab visibility return (debounced 3s to prevent probe storms).
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to browser window focus and visibilitychange DOM events
  useEffect(() => {
    if (initialReportOverride !== undefined || variant !== "full") return;
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const handleFocus = () => {
      refreshControllerRef.current?.trigger("focus");
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshControllerRef.current?.trigger("visibility");
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [initialReportOverride, variant]);

  const filteredView = (() => {
    if (!report) return null;
    const base = filterDiagnosticsReport(report, statusFilter);
    const providerOrder = effectiveSettings?.providerOrder;
    const hasConfiguredOrdering =
      configuredProviderEntries.length > 0 || Boolean(providerOrder && providerOrder.length > 0);
    if (!hasConfiguredOrdering) {
      return base;
    }
    return {
      ...base,
      activeGroups: base.activeGroups.map((group) => {
        if (group.id !== "ai_providers") {
          return group;
        }
        const ordered = orderItemsByConfiguredProviderOrder(
          group.items,
          extractDiagnosticProviderKey,
          configuredProviderEntries,
          providerOrder,
        );
        return {
          ...group,
          items: ordered.map((item) =>
            applyConfiguredProviderBrandingToDiagnosticItem(item, configuredProviderEntries),
          ),
        };
      }),
    };
  })();

  if (variant === "compact") {
    if (!report) {
      return null;
    }
    const attentionItems = report.items
      .filter((item) => item.status !== "ok")
      .map((item) =>
        applyConfiguredProviderBrandingToDiagnosticItem(item, configuredProviderEntries),
      );
    const compactStatus: DaemonDiagnosticsStatus =
      report.summary.error > 0 ? "error" : report.summary.degraded > 0 ? "degraded" : "ok";
    const compactTone = statusToneClasses(compactStatus);

    return (
      <section
        id="prismux-welcome-diagnostics"
        className="grid gap-x-10 border-b border-border/60 py-4 sm:grid-cols-[6rem_minmax(0,1fr)]"
      >
        <h2 className="text-sm leading-10 text-muted-foreground">
          <T>Health</T>
        </h2>
        <div className="min-w-0">
          <Collapsible open={compactOpen} onOpenChange={setCompactOpen}>
            <div
              className={cn(
                "px-3.5 py-2.5 transition-colors duration-150 motion-reduce:transition-none",
                GLASS_SURFACE_RIM,
                compactStatus === "error"
                  ? "border-destructive/35 bg-destructive/[0.045] dark:border-destructive/40 dark:bg-destructive/[0.07]"
                  : compactStatus === "degraded"
                    ? "border-warning/35 bg-warning/[0.045] dark:border-warning/35 dark:bg-warning/[0.06]"
                    : "border-border/60 bg-foreground/[0.025] dark:bg-white/[0.035]",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <CollapsibleTrigger className="group flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border",
                      compactTone.groupIconTray,
                    )}
                  >
                    <ActivityIcon className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    {/* oxlint-disable-next-line shadcn/no-arbitrary-values -- compact 13px Level-1 diagnostics card title */}
                    <span className="text-[13px] font-semibold tracking-tight text-foreground">
                      <T>Prismux Service Diagnostics</T>
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="success" size="sm">
                        <span className="font-mono tabular-nums">
                          {report.summary.ok} {gt("Healthy")}
                        </span>
                      </Badge>
                      {report.summary.degraded > 0 ? (
                        <Badge variant="warning" size="sm">
                          <span className="font-mono tabular-nums">
                            {report.summary.degraded} {gt("Degraded")}
                          </span>
                        </Badge>
                      ) : null}
                      {report.summary.error > 0 ? (
                        <Badge variant="error" size="sm">
                          <span className="font-mono tabular-nums">
                            {report.summary.error} {gt("Error")}
                          </span>
                        </Badge>
                      ) : null}
                      <Badge
                        variant={
                          report.memoryRetrievalState === "fts5+sqlite-vec" ? "info" : "secondary"
                        }
                        size="sm"
                      >
                        {report.memoryRetrievalState === "fts5+sqlite-vec"
                          ? gt("FTS5 + sqlite-vec hybrid")
                          : gt("FTS5 degraded mode")}
                      </Badge>
                    </div>
                  </div>
                  <ChevronDownIcon className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-panel-open:rotate-180 motion-reduce:transition-none" />
                </CollapsibleTrigger>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={loading}
                  onClick={() => void loadDiagnostics(true)}
                >
                  <RefreshCwIcon
                    className={cn("size-3", loading && "animate-spin motion-reduce:animate-none")}
                  />
                  {gt("Re-run check")}
                </Button>
              </div>
            </div>
            <CollapsiblePanel>
              <div className="mt-3 space-y-2.5 pb-1">
                {attentionItems.length === 0 ? (
                  <div
                    className={cn(
                      "flex items-center gap-2.5 border-success/30 bg-success/[0.05] px-3.5 py-2.5 text-xs text-foreground/85 dark:border-success/25 dark:bg-success/[0.06]",
                      GLASS_SURFACE_RIM,
                    )}
                  >
                    <CheckCircle2Icon
                      className="size-4 shrink-0 text-success-foreground"
                      aria-hidden="true"
                    />
                    <span>
                      <T>All detected host services, tools, and mirrors are healthy.</T>
                    </span>
                  </div>
                ) : (
                  <div className="grid items-stretch gap-2.5 sm:grid-cols-2">
                    {attentionItems.slice(0, 6).map((item) => (
                      <DiagnosticItemCard
                        key={item.id}
                        item={item}
                        copied={copiedId === item.id}
                        onCopyCommand={(id, cmd) => void copyCommand(id, cmd)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      </section>
    );
  }

  const memoryState = report?.memoryRetrievalState ?? "unknown";
  const memoryBannerSurface =
    memoryState === "fts5+sqlite-vec"
      ? "border-success/25 bg-success/[0.04] dark:border-success/20 dark:bg-success/[0.05]"
      : memoryState === "fts5-only"
        ? "border-warning/30 bg-warning/[0.045] dark:border-warning/25 dark:bg-warning/[0.055]"
        : "border-border/55 bg-foreground/[0.02] dark:bg-white/[0.03]";

  /* oxlint-disable prismux/no-em-dash-copy -- standard empty-metric placeholder dash while initial probe is loading */
  const kpiTiles: ReadonlyArray<{
    readonly key: DiagnosticStatusFilter;
    readonly icon: ComponentType<{ className?: string }>;
    readonly label: ReactNode;
    readonly value: number | string;
    readonly hasCount: boolean;
  }> = [
    {
      key: "all",
      icon: ActivityIcon,
      label: <T>Total checks</T>,
      value: report ? report.summary.total : "—",
      hasCount: Boolean(report && report.summary.total > 0),
    },
    {
      key: "ok",
      icon: CheckCircle2Icon,
      label: <T>Healthy</T>,
      value: report ? report.summary.ok : "—",
      hasCount: Boolean(report && report.summary.ok > 0),
    },
    {
      key: "degraded",
      icon: AlertTriangleIcon,
      label: <T>Degraded</T>,
      value: report ? report.summary.degraded : "—",
      hasCount: Boolean(report && report.summary.degraded > 0),
    },
    {
      key: "error",
      icon: XCircleIcon,
      label: <T>Errors</T>,
      value: report ? report.summary.error : "—",
      hasCount: Boolean(report && report.summary.error > 0),
    },
  ];
  /* oxlint-enable prismux/no-em-dash-copy */

  const diagnosticsBody = (
    <>
      {/* Layer 1a: Interactive Liquid Glass KPI Overview & Status Filter Bar */}
      <div
        role="group"
        aria-label={gt("Filter by state")}
        className={
          standalone
            ? "grid grid-cols-2 gap-3 lg:grid-cols-4"
            : "grid grid-cols-2 gap-2.5 sm:grid-cols-4"
        }
      >
        {kpiTiles.map((tile) => {
          const selected = statusFilter === tile.key;
          const style = kpiTileSurfaceClasses(tile.key, selected, tile.hasCount);
          const TileIcon = tile.icon;

          return (
            <button
              key={tile.key}
              type="button"
              aria-pressed={selected}
              data-diagnostic-filter={tile.key}
              onClick={() =>
                setStatusFilter((current) => toggleDiagnosticStatusFilter(current, tile.key))
              }
              className={cn(
                "relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-xl border px-3.5 py-3 text-left transition-all duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none active:translate-y-px motion-reduce:transition-none motion-reduce:transform-none",
                style.container,
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-flex size-6 shrink-0 items-center justify-center rounded-lg border",
                      style.iconTray,
                    )}
                  >
                    <TileIcon className="size-3.5" />
                  </span>
                  <span className="truncate text-2xs font-medium text-muted-foreground">
                    {tile.label}
                  </span>
                </span>
              </div>
              <div
                className={cn(
                  "mt-2.5 font-mono text-xl font-semibold leading-none tracking-tight tabular-nums",
                  style.valueText,
                )}
              >
                {tile.value}
              </div>
              {selected ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute inset-x-4 bottom-0 h-[2px] rounded-full",
                    style.indicatorBar,
                  )}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {errorMsg ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive-foreground"
        >
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangleIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="break-words">
              {gt("Could not load Prismux Daemon diagnostics: {error}", { error: errorMsg })}
            </span>
          </div>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => void loadDiagnostics(true)}
          >
            {gt("Retry")}
          </Button>
        </div>
      ) : null}

      {/* Single-line Memory Retrieval Status Strip */}
      {report ? (
        <div
          data-diagnostic-memory-banner="true"
          className={cn(
            "flex flex-wrap items-center justify-between gap-2.5 rounded-xl border px-3.5 py-2 text-xs",
            memoryBannerSurface,
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <DatabaseIcon
              className={cn(
                "size-3.5 shrink-0",
                memoryState === "fts5+sqlite-vec"
                  ? "text-success-foreground"
                  : memoryState === "fts5-only"
                    ? "text-warning-foreground"
                    : "text-muted-foreground",
              )}
              aria-hidden="true"
            />
            <span className="shrink-0 font-medium text-foreground">
              <T>Memory retrieval engine</T>
            </span>
            <Badge
              size="sm"
              className="shrink-0"
              variant={
                memoryState === "fts5+sqlite-vec"
                  ? "success"
                  : memoryState === "fts5-only"
                    ? "warning"
                    : "secondary"
              }
            >
              {memoryState === "fts5+sqlite-vec"
                ? gt("FTS5 + sqlite-vec hybrid")
                : memoryState === "fts5-only"
                  ? gt("FTS5 degraded mode")
                  : gt("Unknown")}
            </Badge>
            {report.memoryRetrievalDetail ? (
              <span
                className="min-w-0 truncate text-muted-foreground"
                // oxlint-disable-next-line prismux/no-native-title-tooltip -- preserves full truncated memory retrieval detail on hover
                title={report.memoryRetrievalDetail}
              >
                {report.memoryRetrievalDetail}
              </span>
            ) : null}
          </div>
          <Button
            size="xs"
            variant="outline"
            className="shrink-0"
            render={<Link to="/settings/memory" />}
          >
            <span>{gt("Chief & memory", { $context: "settings navigation item" })}</span>
            <ArrowRightIcon className="size-3" />
          </Button>
        </div>
      ) : null}

      {/* Active status filter summary bar with one-click reset (shown when filtered cards are visible) */}
      {report && filteredView && statusFilter !== "all" && filteredView.totalVisibleCount > 0 ? (
        <div
          data-diagnostic-active-filter={statusFilter}
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 border-border/60 bg-foreground/[0.025] px-3.5 py-2 text-xs dark:bg-white/[0.035]",
            GLASS_SURFACE_RIM,
          )}
        >
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span>{gt("Filtered")}</span>
            <Badge variant={statusToneClasses(statusFilter).badgeVariant} size="sm">
              {statusLabel(statusFilter, gt)}
            </Badge>
            <span className="font-mono text-2xs tabular-nums text-foreground/85">
              {filteredView.totalVisibleCount} / {report.summary.total}
            </span>
          </div>
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-diagnostic-filter-reset="true"
            onClick={() => setStatusFilter("all")}
          >
            <T>Show all</T>
          </Button>
        </div>
      ) : null}

      {/* Initial loading state */}
      {loading && !report ? (
        <div
          className={cn(
            "border-border/50 bg-foreground/[0.02] px-4 py-8 text-center text-xs text-muted-foreground dark:bg-white/[0.025]",
            GLASS_SURFACE_RIM,
          )}
        >
          <T>Probing Prismux services, tools, and mirrors…</T>
        </div>
      ) : null}

      {/* Layer 2 & 3: Active Category Groups + Single Deduplicated Dormant Engines Summary */}
      {report && filteredView ? (
        filteredView.totalVisibleCount === 0 ? (
          <div
            data-diagnostic-empty-state="true"
            className={cn(
              "flex flex-col items-center justify-center gap-3 border-dashed border-border/65 bg-foreground/[0.02] px-5 py-8 text-center dark:bg-white/[0.025]",
              GLASS_SURFACE_RIM,
            )}
          >
            <span
              aria-hidden="true"
              className="inline-flex size-9 items-center justify-center rounded-xl border border-border/60 bg-foreground/[0.04] text-muted-foreground dark:bg-white/[0.06]"
            >
              <CheckCircle2Icon className="size-4" />
            </span>
            <div className="space-y-1">
              {/* oxlint-disable-next-line shadcn/no-arbitrary-values -- compact 13px empty-state heading */}
              <p className="text-[13px] font-semibold text-foreground">
                <T>Nothing matches that.</T>
              </p>
              {statusFilter !== "all" ? (
                <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant={statusToneClasses(statusFilter).badgeVariant} size="sm">
                    {statusLabel(statusFilter, gt)}
                  </Badge>
                  <span className="font-mono text-2xs tabular-nums">0</span>
                </div>
              ) : null}
            </div>
            {statusFilter !== "all" ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                data-diagnostic-filter-reset="true"
                onClick={() => setStatusFilter("all")}
              >
                {gt("Reset filters")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-5">
            {filteredView.activeGroups.map((group) => {
              const groupTone = statusToneClasses(group.status);
              const GroupIcon = categoryIconComponent(group.id);
              return (
                <section
                  key={group.id}
                  data-diagnostic-group={group.id}
                  className="space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "inline-flex size-7 shrink-0 items-center justify-center rounded-lg border",
                          groupTone.groupIconTray,
                        )}
                      >
                        <GroupIcon className="size-3.5" />
                      </span>
                      {/* oxlint-disable-next-line shadcn/no-arbitrary-values -- compact 13px group heading */}
                      <h4 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
                        {categoryHeadingLabel(group, gt)}
                      </h4>
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border/60 bg-foreground/[0.04] px-1.5 font-mono text-2xs font-medium tabular-nums text-muted-foreground dark:bg-white/[0.06]">
                        {group.items.length}
                      </span>
                    </div>
                    <GroupStatusPills group={group} />
                  </div>

                  <div
                    data-diagnostic-group-grid={group.id}
                    className="grid grid-cols-1 items-stretch gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                  >
                    {group.items.map((item) => (
                      <DiagnosticItemCard
                        key={item.id}
                        item={item}
                        copied={copiedId === item.id}
                        onCopyCommand={(id, cmd) => void copyCommand(id, cmd)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

            {/* Single deduplicated Dormant Engines Read-Only Summary (flattened <= 2 card layers) */}
            {filteredView.dormantGroup ? (
              <section
                data-diagnostic-group={filteredView.dormantGroup.id}
                data-diagnostic-dormant-summary="true"
                aria-label={categoryHeadingLabel(filteredView.dormantGroup, gt)}
                className="space-y-2.5 border-t border-border/50 pt-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "inline-flex size-7 shrink-0 items-center justify-center rounded-lg border",
                        statusToneClasses(filteredView.dormantGroup.status).groupIconTray,
                      )}
                    >
                      <LayersIcon className="size-3.5" />
                    </span>
                    {/* oxlint-disable-next-line shadcn/no-arbitrary-values -- compact 13px group heading */}
                    <h4 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
                      <T>Dormant Engines Read-Only Summary</T>
                    </h4>
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border/60 bg-foreground/[0.04] px-1.5 font-mono text-2xs font-medium tabular-nums text-muted-foreground dark:bg-white/[0.06]">
                      {filteredView.dormantGroup.items.length}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <GroupStatusPills group={filteredView.dormantGroup} />
                    <Badge variant="outline" size="sm">
                      {gt("Read-only")}
                    </Badge>
                  </div>
                </div>

                <div
                  data-diagnostic-group-grid={filteredView.dormantGroup.id}
                  className="grid grid-cols-1 items-stretch gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                >
                  {filteredView.dormantGroup.items.map((engine) => (
                    <DormantEngineReadOnlyCard key={engine.id} engine={engine} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )
      ) : null}
    </>
  );

  if (standalone) {
    return (
      <PrismuxDiagnosticsStandaloneFrame
        report={report}
        loading={loading}
        onRerun={() => void loadDiagnostics(true)}
      >
        {diagnosticsBody}
      </PrismuxDiagnosticsStandaloneFrame>
    );
  }

  return (
    <div id="prismux-diagnostics" className="space-y-6">
      <SettingsSection
        title={gt("Prismux Service Diagnostics")}
        icon={<ActivityIcon className="size-4 text-primary" aria-hidden="true" />}
        headerAction={
          <div className="flex flex-wrap items-center gap-2">
            {report ? (
              <span className="text-2xs text-muted-foreground tabular-nums">
                {formatDiagnosticsTimestamp(report.checkedAt)}
                {/* oxlint-disable-next-line prismux/no-untranslated-copy -- numeric millisecond telemetry suffix */}
                {report.durationMs !== null ? ` · ${report.durationMs} ms` : ""}
              </span>
            ) : null}
            {report?.cached ? (
              <Badge variant="outline" size="sm">
                {gt("Cached")}
              </Badge>
            ) : null}
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={loading}
              onClick={() => void loadDiagnostics(true)}
            >
              <RefreshCwIcon
                className={cn("size-3.5", loading && "animate-spin motion-reduce:animate-none")}
              />
              {loading ? gt("Running diagnostics…") : gt("Re-run diagnostics")}
            </Button>
          </div>
        }
      >
        <div className="space-y-5 p-4 sm:p-5" aria-busy={loading}>
          {diagnosticsBody}
        </div>
      </SettingsSection>
    </div>
  );
}

function PrismuxDiagnosticsAutoStandalone({
  initialReportOverride,
  initialStatusFilter,
  serverProvidersOverride,
  settingsOverride,
}: {
  readonly initialReportOverride?: NormalizedDiagnosticsReport | null | undefined;
  readonly initialStatusFilter: DiagnosticStatusFilter;
  readonly serverProvidersOverride?: ReadonlyArray<ServerProvider> | undefined;
  readonly settingsOverride?: ProviderInstanceOrderSettings | null | undefined;
}) {
  const pathname = useLocation({ select: (loc) => loc.pathname });
  return (
    <PrismuxDiagnosticsContent
      variant="full"
      standalone={isDiagnosticsStandalonePathname(pathname)}
      initialReportOverride={initialReportOverride}
      initialStatusFilter={initialStatusFilter}
      serverProvidersOverride={serverProvidersOverride}
      settingsOverride={settingsOverride}
    />
  );
}

export function PrismuxDiagnosticsSection({
  variant = "full",
  standalone,
  initialReportOverride,
  initialStatusFilter = "all",
  serverProvidersOverride,
  settingsOverride,
}: PrismuxDiagnosticsSectionProps = {}) {
  if (variant === "compact") {
    return (
      <PrismuxDiagnosticsContent
        variant="compact"
        standalone={false}
        initialReportOverride={initialReportOverride}
        initialStatusFilter={initialStatusFilter}
        serverProvidersOverride={serverProvidersOverride}
        settingsOverride={settingsOverride}
      />
    );
  }
  if (standalone !== undefined) {
    return (
      <PrismuxDiagnosticsContent
        variant="full"
        standalone={standalone}
        initialReportOverride={initialReportOverride}
        initialStatusFilter={initialStatusFilter}
        serverProvidersOverride={serverProvidersOverride}
        settingsOverride={settingsOverride}
      />
    );
  }
  return (
    <PrismuxDiagnosticsAutoStandalone
      initialReportOverride={initialReportOverride}
      initialStatusFilter={initialStatusFilter}
      serverProvidersOverride={serverProvidersOverride}
      settingsOverride={settingsOverride}
    />
  );
}
