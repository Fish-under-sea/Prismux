import { formatEffortLabel } from "@prismux/appearance";
import { memo, useEffect, useState } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import { AgentBrandLogo, formatAgentBrandName } from "./agentBrand";
import { isCustomChiefDisplayName, normalizeChiefDisplayName } from "./chiefMention";
import { useOptionalPrismuxRuntime, type PrismuxDialMode } from "./PrismuxRuntimeProvider";

export interface ChiefSlotBroadcastDetail {
  readonly provider: string;
  readonly model?: string | null;
  readonly reasoningEffort?: string | null;
  readonly dialMode?: PrismuxDialMode;
  readonly secretaryName?: string | null;
  readonly agentsMdPath?: string | null;
}

export const CHIEF_SLOT_UPDATED_EVENT = "prismux:chief-slot-updated";

let lastKnownChiefSlot: ChiefSlotBroadcastDetail | null = null;

/**
 * Broadcasts an updated Chief Thread Slot snapshot across topbar pills and settings views
 * so status indicators reflect provider/model/effort/identity changes instantaneously.
 */
export function emitChiefSlotUpdated(detail: ChiefSlotBroadcastDetail): void {
  lastKnownChiefSlot = {
    provider: detail.provider,
    model: detail.model ?? null,
    reasoningEffort: detail.reasoningEffort ?? null,
    ...(detail.dialMode ? { dialMode: detail.dialMode } : {}),
    secretaryName:
      detail.secretaryName !== undefined
        ? detail.secretaryName
        : (lastKnownChiefSlot?.secretaryName ?? null),
    agentsMdPath:
      detail.agentsMdPath !== undefined
        ? detail.agentsMdPath
        : (lastKnownChiefSlot?.agentsMdPath ?? null),
  };
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent<ChiefSlotBroadcastDetail>(CHIEF_SLOT_UPDATED_EVENT, { detail: lastKnownChiefSlot }));
  }
}

export function resetLastKnownChiefSlotForTests(): void {
  lastKnownChiefSlot = null;
}

const DIAL_MODE_TOOLTIP_LABELS: Readonly<Record<PrismuxDialMode, string>> = {
  agent: "Agent · 自主执行",
  oracle: "Oracle · 深度架构",
  review: "Review · 只读挑刺",
};

function normalizeDialMode(raw: unknown, fallback: PrismuxDialMode = "agent"): PrismuxDialMode {
  return raw === "agent" || raw === "oracle" || raw === "review" ? raw : fallback;
}

function readSlotProvider(slot: Record<string, unknown> | null | undefined): string | null {
  if (!slot) return null;
  const candidate =
    typeof slot.activeProvider === "string" && slot.activeProvider.trim().length > 0
      ? slot.activeProvider.trim()
      : typeof slot.provider === "string" && slot.provider.trim().length > 0
        ? slot.provider.trim()
        : null;
  return candidate;
}

function readSlotEffort(slot: Record<string, unknown> | null | undefined): string | null {
  if (!slot) return null;
  const raw =
    typeof slot.reasoningEffort === "string"
      ? slot.reasoningEffort.trim()
      : typeof slot.defaultEffort === "string"
        ? slot.defaultEffort.trim()
        : "";
  return raw.length > 0 ? raw : null;
}

function formatEffortForTooltip(effort: string | null | undefined): string {
  const trimmed = effort?.trim() ?? "";
  if (!trimmed) {
    return "跟随提供方默认";
  }
  return formatEffortLabel(trimmed);
}

export interface PrismuxChiefStatusPillProps {
  /** Invoked when the user clicks the Chief pill (typically navigates to /settings/memory). */
  readonly onClick?: () => void;
  /** Optional explicit overrides (defaults to live PrismuxRuntime + Daemon /v1/chief state). */
  readonly provider?: string;
  readonly model?: string | null;
  readonly reasoningEffort?: string | null;
  readonly dialMode?: PrismuxDialMode;
  readonly secretaryName?: string | null;
  readonly agentsMdPath?: string | null;
  readonly online?: boolean;
  readonly isGlassActive?: boolean;
  readonly className?: string;
}

/**
 * Minimalist topbar Chief Thread Slot status pill:
 * - Replaces the legacy green dot with the official vendor SVG logo using gentle breathing luminance when online
 * - Shows user's custom Chief Secretary name when customized, or canonical brand name (e.g. "Codex", "Claude Code") by default
 * - Removes the noisy grey "AGENT" suffix tag for a crisp, calm header chrome
 * - Rich hover tooltip displays custom identity, active engine, model, default reasoning effort, independent AGENTS.md status, and online status
 */
export const PrismuxChiefStatusPill = memo(function PrismuxChiefStatusPill({
  onClick,
  provider: providerProp,
  model: modelProp,
  reasoningEffort: effortProp,
  dialMode: dialModeProp,
  secretaryName: secretaryNameProp,
  agentsMdPath: agentsMdPathProp,
  online: onlineProp,
  isGlassActive: isGlassActiveProp,
  className,
}: PrismuxChiefStatusPillProps) {
  const runtime = useOptionalPrismuxRuntime();
  const [hydrated, setHydrated] = useState<ChiefSlotBroadcastDetail | null>(() => lastKnownChiefSlot);

  const daemonReady = runtime?.daemonInfo.ready ?? false;
  const runtimeChiefProvider = runtime?.chiefProvider;
  const runtimeDialMode = runtime?.dialMode;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleUpdate = (event: Event) => {
      const custom = event as CustomEvent<ChiefSlotBroadcastDetail>;
      if (custom.detail && typeof custom.detail.provider === "string") {
        setHydrated(custom.detail);
      }
    };
    window.addEventListener(CHIEF_SLOT_UPDATED_EVENT, handleUpdate);
    return () => {
      window.removeEventListener(CHIEF_SLOT_UPDATED_EVENT, handleUpdate);
    };
  }, []);

  useEffect(() => {
    if (!runtime || !daemonReady) return;
    let cancelled = false;
    void runtime.daemon
      .getChief()
      .then((res) => {
        if (cancelled || !res?.slot) return;
        const slotRec = res.slot as unknown as Record<string, unknown>;
        const nextProvider = readSlotProvider(slotRec) ?? runtimeChiefProvider ?? "codex";
        const nextModel =
          typeof res.slot.model === "string" && res.slot.model.trim().length > 0
            ? res.slot.model.trim()
            : null;
        const nextEffort = readSlotEffort(slotRec);
        const nextDialMode = normalizeDialMode(res.dialMode, runtimeDialMode ?? "agent");
        const rawSecretaryName =
          typeof res.secretaryName === "string"
            ? res.secretaryName
            : typeof res.slot.secretaryName === "string"
              ? res.slot.secretaryName
              : null;
        const rawAgentsMdPath =
          typeof res.agentsMdPath === "string"
            ? res.agentsMdPath
            : typeof res.slot.agentsMdPath === "string"
              ? res.slot.agentsMdPath
              : null;
        const snapshot: ChiefSlotBroadcastDetail = {
          provider: nextProvider,
          model: nextModel,
          reasoningEffort: nextEffort,
          dialMode: nextDialMode,
          secretaryName: rawSecretaryName,
          agentsMdPath: rawAgentsMdPath,
        };
        lastKnownChiefSlot = snapshot;
        setHydrated(snapshot);
      })
      .catch(() => {
        // Degrade smoothly if daemon is restarting.
      });
    return () => {
      cancelled = true;
    };
  }, [daemonReady, runtime, runtimeChiefProvider, runtimeDialMode]);

  const effectiveProvider = providerProp ?? hydrated?.provider ?? runtimeChiefProvider ?? "codex";
  const effectiveModel =
    modelProp !== undefined ? modelProp : (hydrated?.model ?? null);
  const effectiveEffort =
    effortProp !== undefined ? effortProp : (hydrated?.reasoningEffort ?? null);
  const effectiveDialMode = normalizeDialMode(
    dialModeProp ?? hydrated?.dialMode ?? runtimeDialMode,
    "agent",
  );
  const effectiveSecretaryName = normalizeChiefDisplayName(
    secretaryNameProp !== undefined ? secretaryNameProp : hydrated?.secretaryName,
  );
  const hasCustomName = isCustomChiefDisplayName(effectiveSecretaryName);
  const effectiveAgentsMdPath =
    (agentsMdPathProp !== undefined ? agentsMdPathProp : hydrated?.agentsMdPath)?.trim() ||
    "~/.prismux/chief/AGENTS.md";
  const effectiveOnline = onlineProp ?? daemonReady;
  const isGlassActive =
    isGlassActiveProp ??
    Boolean(runtime && runtime.appearance.themeMode === "glass" && runtime.appearance.glassPreset !== "off");

  const brandName = formatAgentBrandName(effectiveProvider);
  const pillLabel = hasCustomName ? effectiveSecretaryName : brandName;
  const modelLabel =
    effectiveModel && effectiveModel.trim().length > 0 ? effectiveModel.trim() : "跟随提供方默认";
  const effortLabel = formatEffortForTooltip(effectiveEffort);
  const dialLabel = DIAL_MODE_TOOLTIP_LABELS[effectiveDialMode];
  const onlineLabel = effectiveOnline ? "在线" : "离线 / 本地预览";

  const ariaLabel = hasCustomName
    ? `${effectiveSecretaryName}（主秘书槽位）· 引擎：${brandName}，模型：${modelLabel}，默认思考强度：${effortLabel}，独立 AGENTS.md 已加载，喊「${effectiveSecretaryName}」即可唤起，档位：${dialLabel}，状态：${onlineLabel}，点击管理主秘书与记忆设置`
    : `主秘书槽位：${brandName}，模型：${modelLabel}，默认思考强度：${effortLabel}，独立 AGENTS.md 已加载，档位：${dialLabel}，状态：${onlineLabel}，点击管理主秘书与记忆设置`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-pmx-chief-badge=""
            data-pmx-chief-online={effectiveOnline ? "1" : "0"}
            data-pmx-chief-provider={effectiveProvider}
            data-pmx-chief-name={effectiveSecretaryName}
            onClick={onClick}
            className={cn(
              "inline-flex h-7 max-w-44 cursor-pointer items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 text-[11.5px] font-medium text-foreground/90 transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [-webkit-app-region:no-drag]",
              isGlassActive && "border-white/20 bg-white/10 backdrop-blur-md hover:bg-white/18",
              !effectiveOnline && "text-muted-foreground",
              className,
            )}
            aria-label={ariaLabel}
          >
            <AgentBrandLogo
              provider={effectiveProvider}
              online={effectiveOnline}
              breathing={effectiveOnline}
              size={14}
            />
            <span className="truncate tracking-tight">{pillLabel}</span>
          </button>
        }
      />
      <TooltipPopup side="bottom" className="max-w-76 p-2.5 text-left">
        <div className="space-y-1 text-[11px] leading-snug">
          <div className="flex items-center justify-between gap-3 font-medium text-foreground">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <AgentBrandLogo provider={effectiveProvider} online={effectiveOnline} size={12} />
              <span className="truncate">
                {hasCustomName
                  ? `${effectiveSecretaryName}（主秘书槽位）`
                  : `主秘书 · ${brandName}`}
              </span>
            </span>
            <span
              className={cn(
                "shrink-0 text-[10px] font-normal",
                effectiveOnline ? "text-emerald-500 dark:text-emerald-400" : "text-muted-foreground",
              )}
            >
              {onlineLabel}
            </span>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10.5px] text-muted-foreground">
            <span>当前引擎</span>
            <span className="truncate text-foreground/90">{brandName}</span>
            <span>当前模型</span>
            <span className="truncate font-mono text-foreground/90">{modelLabel}</span>
            <span>思考强度</span>
            <span className="truncate text-foreground/90">{effortLabel}</span>
            <span>工作档位</span>
            <span className="truncate text-foreground/90">{dialLabel}</span>
            <span>独立指令</span>
            <span className="truncate text-emerald-600 dark:text-emerald-400" title={effectiveAgentsMdPath}>
              独立 AGENTS.md 已加载
            </span>
          </div>
          <div className="border-t border-border/50 pt-1 text-[10px] text-muted-foreground">
            喊「{effectiveSecretaryName}」或 @{effectiveSecretaryName} 即可唤起 · 点击管理主秘书与记忆设置
          </div>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
});
