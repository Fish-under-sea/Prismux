/* oxlint-disable prismux/no-untranslated-copy -- Prismux v3 spec mandates verbatim Chinese unified personal-subscription risk waiver copy */
import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider } from "@prismux/core-contracts";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  LockIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type MouseEvent } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { useStableCallback } from "../hooks/useStableCallback";
import { cn } from "../lib/utils";
import {
  brandProviderInstanceEntries,
  deriveProviderInstanceEntries,
  disambiguateProviderInstanceDisplayNames,
  orderItemsByConfiguredProviderOrder,
  orderProviderInstanceEntries,
  resolveConfiguredProviderLabel,
  type ProviderInstanceOrderSettings,
} from "../providerInstances";
import { primaryServerProvidersAtom, primaryServerSettingsAtom } from "../state/server";
import { AgentBrandLogo, formatAgentBrandName } from "./agentBrand";
import { prismuxDaemonClient, type PrismuxDaemonClient } from "./daemonClient";

export const SUBSCRIPTION_WAIVER_ENDPOINT = "/v1/security/subscription-waiver" as const;
export const PROVIDERS_PROBE_ENDPOINT = "/v1/providers/probe" as const;
export const SUBSCRIPTION_WAIVER_VERSION = "v3-unified-2026" as const;
export const SUBSCRIPTION_WAIVER_ANCHOR_ID = "subscription-risk-waiver" as const;
export const SUBSCRIPTION_WAIVER_ROUTE = "/settings/providers#subscription-risk-waiver" as const;
export const LEGACY_ANTIGRAVITY_LOCK_ANCHOR_ID = "antigravity-controlled-lock" as const;
export const SUBSCRIPTION_WAIVER_CHANGE_EVENT = "prismux:subscription-waiver-change" as const;
export const UNIFORM_API_CUSTOM_AUTH_LABEL = "API / 自定义端点注入（已放行）" as const;
export const AGY_WAIVER_REQUIRED_BADGE_TEXT = "需签署免责" as const;
export const AGY_UNATTENDED_FORBIDDEN_BADGE_TEXT = "无人值守禁止个人 AGY · 查看合规" as const;
export const AGY_TEXT_GEN_WAIVER_PILL_TEXT = "Antigravity 需签署免责 →" as const;

export type ProviderProbeAuthMode =
  | "api_or_custom"
  | "subscription_oauth"
  | "local"
  | "unauthenticated";

export type ProviderProbeStatus = "ready" | "degraded" | "not_installed" | "unauthenticated";

export interface ProviderProbeSnapshot {
  readonly providerId: string;
  readonly displayName: string;
  readonly installed: boolean;
  readonly version: string | null;
  readonly binaryPath: string | null;
  readonly status: ProviderProbeStatus;
  readonly authMode: ProviderProbeAuthMode;
  readonly authSource: string;
  readonly endpoint: string | null;
  readonly authLabel: string;
  readonly checkedAt: string;
}

export interface ProvidersProbeResponse {
  readonly ok: boolean;
  readonly generatedAt: string;
  readonly providers: ReadonlyArray<ProviderProbeSnapshot>;
}

export interface SubscriptionWaiverState {
  readonly signed: boolean;
  readonly waiverVersion: string | null;
  readonly signedAt: string | null;
  readonly allowAntigravityAsControlledAgent: boolean;
  readonly allowExternalSubscriptionAgentsInSwarm: boolean;
  readonly defaultLocked: true;
}

export interface ProviderComplianceBlock {
  readonly badgeText: string;
  readonly tooltip?: string | undefined;
  readonly onOpenWaiver: () => void;
}

export interface AntigravityProviderLikeInput {
  readonly driverKind?: string | null | undefined;
  readonly instanceId?: string | null | undefined;
  readonly acpRegistryAgentId?: string | null | undefined;
}

export interface AgyWaiverRequiredBadgeProps {
  readonly label?: string | undefined;
  readonly title?: string | undefined;
  readonly onClick?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
  readonly className?: string | undefined;
  readonly size?: "xs" | "sm" | undefined;
  readonly variant?: "inline" | "overlay" | undefined;
  readonly interactive?: boolean | undefined;
}

export function isAntigravityProviderLike(raw: string | null | undefined): boolean {
  if (typeof raw !== "string") return false;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === "antigravity" ||
    normalized === "agy" ||
    normalized.startsWith("antigravity") ||
    normalized.startsWith("agy-") ||
    normalized.startsWith("agy_") ||
    normalized.startsWith("agy:") ||
    /(?:^|[:/_\-\s(])(?:antigravity|agy)(?:$|[:/_\-\s)])/.test(normalized)
  );
}

export function isAntigravityProviderInstance(
  entry: AntigravityProviderLikeInput | null | undefined,
): boolean {
  if (!entry) return false;
  return (
    isAntigravityProviderLike(entry.driverKind) ||
    isAntigravityProviderLike(entry.instanceId) ||
    isAntigravityProviderLike(entry.acpRegistryAgentId)
  );
}

export function resolveAntigravityComplianceBlock(input: {
  readonly entry: AntigravityProviderLikeInput | null | undefined;
  readonly waiver: Pick<SubscriptionWaiverState, "signed" | "allowAntigravityAsControlledAgent">;
  readonly mode: "controlled" | "unattended";
  readonly onOpenWaiver: () => void;
}): ProviderComplianceBlock | null {
  if (!isAntigravityProviderInstance(input.entry)) {
    return null;
  }
  if (input.mode === "unattended") {
    const signed = input.waiver.signed === true;
    return {
      badgeText: signed ? AGY_UNATTENDED_FORBIDDEN_BADGE_TEXT : AGY_WAIVER_REQUIRED_BADGE_TEXT,
      tooltip: signed
        ? "无人值守 / 定时任务永久禁止自动唤醒个人版 Antigravity：点击查看合规设置"
        : "需签署免责：点击前往签署个人订阅风险免责协议（且定时任务永久禁止个人版 AGY）",
      onOpenWaiver: input.onOpenWaiver,
    };
  }
  if (isAntigravityControlledAutomationAllowed(input.waiver)) {
    return null;
  }
  return {
    badgeText: AGY_WAIVER_REQUIRED_BADGE_TEXT,
    tooltip: "需签署免责：点击前往签署个人订阅风险免责协议",
    onOpenWaiver: input.onOpenWaiver,
  };
}

export function AgyWaiverRequiredBadge({
  label = AGY_WAIVER_REQUIRED_BADGE_TEXT,
  title = "需签署免责：点击前往签署个人订阅风险免责协议",
  onClick,
  className,
  size = "xs",
  variant = "inline",
  interactive = true,
}: AgyWaiverRequiredBadgeProps) {
  const sharedClassName = cn(
    "inline-flex shrink-0 items-center gap-1 rounded-md border font-semibold leading-tight text-destructive transition-colors",
    variant === "overlay"
      ? "border-destructive bg-background/95 shadow-xs hover:bg-destructive/10"
      : "border-destructive/90 bg-destructive/10 hover:bg-destructive/18",
    size === "sm" ? "px-2 py-0.5 text-xs" : "px-1.5 py-0.5 text-2xs",
    interactive &&
      "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-destructive/40",
    className,
  );

  if (!interactive) {
    return (
      <span
        data-pmx-agy-waiver-badge="true"
        aria-label={title}
        className={sharedClassName}
      >
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      data-pmx-agy-waiver-badge="true"
      aria-label={title}
      className={sharedClassName}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      {label}
    </button>
  );
}

export interface SubscriptionRiskWaiverSectionProps {
  readonly daemon?: Pick<PrismuxDaemonClient, "requestJson">;
  readonly readOnly?: boolean;
  readonly className?: string;
  readonly onWaiverChange?: (state: SubscriptionWaiverState) => void;
  readonly serverProvidersOverride?: ReadonlyArray<ServerProvider>;
  readonly settingsOverride?: ProviderInstanceOrderSettings | null;
}

const DEFAULT_WAIVER_STATE: SubscriptionWaiverState = {
  signed: false,
  waiverVersion: null,
  signedAt: null,
  allowAntigravityAsControlledAgent: false,
  allowExternalSubscriptionAgentsInSwarm: false,
  defaultLocked: true,
};

type WaiverStateListener = (state: SubscriptionWaiverState) => void;
const waiverStateListeners = new Set<WaiverStateListener>();
let cachedWaiverState: SubscriptionWaiverState = DEFAULT_WAIVER_STATE;

export function isAntigravityControlledAutomationAllowed(
  waiver:
    | Pick<SubscriptionWaiverState, "signed" | "allowAntigravityAsControlledAgent">
    | null
    | undefined,
): boolean {
  return waiver?.signed === true && waiver.allowAntigravityAsControlledAgent === true;
}

export function getCachedSubscriptionWaiverState(): SubscriptionWaiverState {
  return cachedWaiverState;
}

export function publishSubscriptionWaiverState(next: SubscriptionWaiverState): void {
  const normalized = normalizeSubscriptionWaiverResponse(next);
  cachedWaiverState = normalized;
  for (const listener of waiverStateListeners) {
    listener(normalized);
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function" &&
    typeof CustomEvent === "function"
  ) {
    window.dispatchEvent(
      new CustomEvent<SubscriptionWaiverState>(SUBSCRIPTION_WAIVER_CHANGE_EVENT, {
        detail: normalized,
      }),
    );
  }
}

export function subscribeSubscriptionWaiverState(listener: WaiverStateListener): () => void {
  waiverStateListeners.add(listener);
  return () => {
    waiverStateListeners.delete(listener);
  };
}

export function resetSubscriptionWaiverStateCache(): void {
  cachedWaiverState = DEFAULT_WAIVER_STATE;
}

export function useSubscriptionWaiverState(
  daemon: Pick<PrismuxDaemonClient, "requestJson"> = prismuxDaemonClient,
): SubscriptionWaiverState {
  const [waiver, setWaiver] = useState<SubscriptionWaiverState>(cachedWaiverState);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to local waiver updates and fetches live waiver policy from local daemon
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeSubscriptionWaiverState((next) => {
      if (active) setWaiver(next);
    });
    const handleWindowWaiverChange = (event: Event) => {
      if (!active) return;
      const detail = (event as CustomEvent<unknown>).detail;
      const normalized = normalizeSubscriptionWaiverResponse(detail);
      cachedWaiverState = normalized;
      setWaiver(normalized);
    };
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener(SUBSCRIPTION_WAIVER_CHANGE_EVENT, handleWindowWaiverChange);
    }

    void daemon
      .requestJson<SubscriptionWaiverState>(SUBSCRIPTION_WAIVER_ENDPOINT)
      .then((response) => {
        if (!active) return;
        const normalized = normalizeSubscriptionWaiverResponse(response);
        cachedWaiverState = normalized;
        setWaiver(normalized);
      })
      .catch(() => {
        // Keep safe default locked state if daemon is temporarily unavailable.
      });

    return () => {
      active = false;
      unsubscribe();
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener(SUBSCRIPTION_WAIVER_CHANGE_EVENT, handleWindowWaiverChange);
      }
    };
  }, [daemon]);

  return waiver;
}

export function normalizeSubscriptionWaiverResponse(raw: unknown): SubscriptionWaiverState {
  if (typeof raw !== "object" || raw === null) {
    return DEFAULT_WAIVER_STATE;
  }
  const record = raw as Record<string, unknown>;
  const signed = record.signed === true;
  return {
    signed,
    waiverVersion:
      signed && typeof record.waiverVersion === "string" && record.waiverVersion.trim().length > 0
        ? record.waiverVersion
        : null,
    signedAt:
      signed && typeof record.signedAt === "string" && record.signedAt.trim().length > 0
        ? record.signedAt
        : null,
    // Defense-in-depth: both switches remain strictly locked OFF whenever waiver is unsigned.
    allowAntigravityAsControlledAgent:
      signed && record.allowAntigravityAsControlledAgent === true,
    allowExternalSubscriptionAgentsInSwarm:
      signed && record.allowExternalSubscriptionAgentsInSwarm === true,
    defaultLocked: true,
  };
}

function normalizeProbeResponse(raw: unknown): ReadonlyArray<ProviderProbeSnapshot> {
  if (typeof raw !== "object" || raw === null) {
    return [];
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.providers)) {
    return [];
  }
  const results: ProviderProbeSnapshot[] = [];
  for (const item of record.providers) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.providerId !== "string" || entry.providerId.trim().length === 0) continue;
    const authMode: ProviderProbeAuthMode =
      entry.authMode === "api_or_custom" ||
      entry.authMode === "subscription_oauth" ||
      entry.authMode === "local" ||
      entry.authMode === "unauthenticated"
        ? entry.authMode
        : "unauthenticated";
    const status: ProviderProbeStatus =
      entry.status === "ready" ||
      entry.status === "degraded" ||
      entry.status === "not_installed" ||
      entry.status === "unauthenticated"
        ? entry.status
        : "unauthenticated";
    results.push({
      providerId: entry.providerId,
      displayName:
        typeof entry.displayName === "string" && entry.displayName.trim().length > 0
          ? entry.displayName
          : formatAgentBrandName(entry.providerId),
      installed: entry.installed === true,
      version: typeof entry.version === "string" ? entry.version : null,
      binaryPath: typeof entry.binaryPath === "string" ? entry.binaryPath : null,
      status,
      authMode,
      authSource: typeof entry.authSource === "string" ? entry.authSource : "none",
      endpoint: typeof entry.endpoint === "string" && entry.endpoint.trim().length > 0
        ? entry.endpoint.trim()
        : null,
      authLabel:
        authMode === "api_or_custom"
          ? UNIFORM_API_CUSTOM_AUTH_LABEL
          : typeof entry.authLabel === "string" && entry.authLabel.trim().length > 0
            ? entry.authLabel.trim()
            : authMode === "local"
              ? "本地运行时（已放行）"
              : authMode === "subscription_oauth"
                ? "官方个人订阅 OAuth（默认锁定）"
                : "未检测到登录态",
      checkedAt: typeof entry.checkedAt === "string" ? entry.checkedAt : "",
    });
  }
  return results;
}

export function SubscriptionRiskWaiverSection({
  daemon = prismuxDaemonClient,
  readOnly = false,
  className,
  onWaiverChange,
  serverProvidersOverride,
  settingsOverride,
}: SubscriptionRiskWaiverSectionProps) {
  const liveServerProviders = useAtomValue(primaryServerProvidersAtom);
  const liveServerSettings = useAtomValue(primaryServerSettingsAtom);
  const effectiveProviders = serverProvidersOverride ?? liveServerProviders;
  const effectiveSettings =
    settingsOverride !== undefined ? settingsOverride : liveServerSettings;
  const configuredEntries = useMemo(() => {
    const derived = deriveProviderInstanceEntries(effectiveProviders);
    const branded = effectiveSettings
      ? brandProviderInstanceEntries(derived, effectiveSettings)
      : derived;
    return disambiguateProviderInstanceDisplayNames(
      orderProviderInstanceEntries(branded, effectiveSettings?.providerOrder),
    );
  }, [effectiveProviders, effectiveSettings]);

  const [waiver, setWaiver] = useState<SubscriptionWaiverState>(DEFAULT_WAIVER_STATE);
  const [probes, setProbes] = useState<ReadonlyArray<ProviderProbeSnapshot>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [probeLoading, setProbeLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [waiverChecked, setWaiverChecked] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const checkboxId = useId();
  const modalTitleId = useId();

  const loadProbeSnapshot = async (refresh = false) => {
    setProbeLoading(true);
    try {
      const endpoint = refresh
        ? `${PROVIDERS_PROBE_ENDPOINT}?refresh=1`
        : PROVIDERS_PROBE_ENDPOINT;
      const response = await daemon.requestJson<ProvidersProbeResponse>(endpoint);
      setProbes(normalizeProbeResponse(response));
    } catch {
      // Keep previous probe state if daemon probe is temporarily unavailable.
    } finally {
      setProbeLoading(false);
    }
  };

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- fetches initial persisted unified subscription waiver policy and live provider auth probe from local daemon
  useEffect(() => {
    let active = true;

    const waiverTask = daemon
      .requestJson<SubscriptionWaiverState>(SUBSCRIPTION_WAIVER_ENDPOINT)
      .then((response) => {
        if (!active) return;
        const normalized = normalizeSubscriptionWaiverResponse(response);
        setWaiver(normalized);
        publishSubscriptionWaiverState(normalized);
        onWaiverChange?.(normalized);
      })
      .catch(() => {
        // Keep safe locked default when daemon is unavailable.
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const probeTask = daemon
      .requestJson<ProvidersProbeResponse>(PROVIDERS_PROBE_ENDPOINT)
      .then((response) => {
        if (!active) return;
        setProbes(normalizeProbeResponse(response));
      })
      .catch(() => {
        // Probe card gracefully falls back to summary note when daemon is offline.
      })
      .finally(() => {
        if (active) setProbeLoading(false);
      });

    void Promise.allSettled([waiverTask, probeTask]);

    return () => {
      active = false;
    };
  }, [daemon, onWaiverChange]);

  const closeModal = useStableCallback(() => {
    if (saving) return;
    setModalOpen(false);
    setWaiverChecked(false);
    setErrorMessage(null);
  });

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- binds Escape dismissal while unified risk waiver modal is open
  useEffect(() => {
    if (!modalOpen || typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeModal, modalOpen]);

  const handleOpenSignModal = () => {
    if (readOnly || saving || loading) return;
    setErrorMessage(null);
    setWaiverChecked(false);
    setModalOpen(true);
  };

  const handleSignWaiver = async () => {
    if (!waiverChecked || saving || readOnly) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      const signedAt = new Date().toISOString();
      const response = await daemon.requestJson<SubscriptionWaiverState>(
        SUBSCRIPTION_WAIVER_ENDPOINT,
        {
          method: "PUT",
          body: JSON.stringify({
            signed: true,
            waiverVersion: SUBSCRIPTION_WAIVER_VERSION,
            signedAt,
          }),
        },
      );
      const normalized = normalizeSubscriptionWaiverResponse(response);
      setWaiver(normalized);
      setModalOpen(false);
      setWaiverChecked(false);
      publishSubscriptionWaiverState(normalized);
      onWaiverChange?.(normalized);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "签署免责声明失败，当前仍保持硬锁。",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeWaiver = async () => {
    if (saving || readOnly) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      const response = await daemon.requestJson<SubscriptionWaiverState>(
        SUBSCRIPTION_WAIVER_ENDPOINT,
        {
          method: "DELETE",
        },
      );
      const normalized = normalizeSubscriptionWaiverResponse(response);
      setWaiver(normalized);
      setModalOpen(false);
      setWaiverChecked(false);
      publishSubscriptionWaiverState(normalized);
      onWaiverChange?.(normalized);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "撤销免责声明失败，请重试。",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSwitch = async (
    field: "allowAntigravityAsControlledAgent" | "allowExternalSubscriptionAgentsInSwarm",
    nextChecked: boolean,
  ) => {
    if (!waiver.signed || readOnly || saving || loading) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      const response = await daemon.requestJson<SubscriptionWaiverState>(
        SUBSCRIPTION_WAIVER_ENDPOINT,
        {
          method: "PUT",
          body: JSON.stringify({
            [field]: nextChecked,
          }),
        },
      );
      const normalized = normalizeSubscriptionWaiverResponse(response);
      setWaiver(normalized);
      publishSubscriptionWaiverState(normalized);
      onWaiverChange?.(normalized);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "保存授权开关失败，请重试。",
      );
    } finally {
      setSaving(false);
    }
  };

  const isSigned = waiver.signed === true;
  const anySwitchActive =
    isSigned &&
    (waiver.allowAntigravityAsControlledAgent || waiver.allowExternalSubscriptionAgentsInSwarm);
  const switchesDisabled = !isSigned || readOnly || saving || loading;
  const visibleProbes = useMemo(
    () =>
      orderItemsByConfiguredProviderOrder(
        probes.filter((entry) => entry.installed || entry.status !== "not_installed"),
        (entry) => entry.providerId,
        configuredEntries,
        effectiveSettings?.providerOrder,
      ),
    [configuredEntries, effectiveSettings?.providerOrder, probes],
  );

  return (
    <section
      id={SUBSCRIPTION_WAIVER_ANCHOR_ID}
      tabIndex={-1}
      data-pmx-subscription-risk-waiver="true"
      data-pmx-waiver-signed={isSigned ? "true" : "false"}
      data-pmx-waiver-state={isSigned ? "signed" : "locked"}
      className={cn(
        "relative rounded-xl border border-border/60 bg-card/45 p-4 text-foreground shadow-xs/5 sm:p-5",
        anySwitchActive && "border-warning/45 bg-warning/8",
        className,
      )}
    >
      {/* Preserve legacy anchor `#antigravity-controlled-lock` so older links land on this unified card */}
      <span
        id={LEGACY_ANTIGRAVITY_LOCK_ANCHOR_ID}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex size-6.5 shrink-0 items-center justify-center rounded-lg",
                anySwitchActive
                  ? "bg-warning/16 text-warning-foreground"
                  : isSigned
                    ? "bg-primary/14 text-primary"
                    : "bg-muted text-muted-foreground",
              )}
              aria-hidden
            >
              {anySwitchActive ? (
                <ShieldAlertIcon className="size-3.5" />
              ) : (
                <ShieldCheckIcon className="size-3.5" />
              )}
            </span>
            <h3 className="text-sm font-semibold text-foreground">
              个人订阅跨代理编排与自动化风险免责
            </h3>
            {isSigned ? (
              <Badge variant="warning" size="sm" data-pmx-waiver-status-badge="signed">
                已签署统一免责
              </Badge>
            ) : (
              <Badge variant="secondary" size="sm" data-pmx-waiver-status-badge="locked">
                <LockIcon className="size-2.5" aria-hidden />
                默认锁定
              </Badge>
            )}
          </div>

          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {isSigned
              ? "已签署个人订阅跨代理风险免责声明。你可以按需独立开启下方精细化开关；若要立即恢复全量硬锁，可随时一键撤销免责。无论是否签署，24h 无人值守 Cron / 夜间工场仍永久禁止自动唤醒个人版 AGY。"
              : "为守护您的个人订阅账号合规（Google Antigravity / Anthropic Claude / OpenAI Codex），官方个人订阅 OAuth 模式默认锁定，禁止被跨代理自动化调用或拉入蜂群。使用付费 API Key 或 CCS / Magpie 自定义端点注入模式始终直接放行，不受任何限制。"}
          </p>

          {isSigned ? (
            <p className="text-2xs text-warning-foreground" data-pmx-waiver-signed-meta="true">
              已签署版本 {waiver.waiverVersion ?? SUBSCRIPTION_WAIVER_VERSION}
              {waiver.signedAt ? ` · ${waiver.signedAt}` : ""}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 pt-0.5">
          {isSigned ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={readOnly || saving || loading}
              data-pmx-waiver-revoke="true"
              onClick={() => void handleRevokeWaiver()}
            >
              <RotateCcwIcon className="size-3.5" aria-hidden />
              撤销免责并恢复硬锁
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={readOnly || saving || loading}
              data-pmx-waiver-open-modal="true"
              onClick={handleOpenSignModal}
            >
              <AlertTriangleIcon className="size-3.5" aria-hidden />
              签署统一风险免责
            </Button>
          )}
        </div>
      </div>

      {/* Live Unified Provider Auth Probe Badges */}
      <div
        data-pmx-probe-badges-panel="true"
        className="mt-4 rounded-xl border border-border/60 bg-background/55 p-3"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground">实时鉴权模式探测（统一探针）</span>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={probeLoading}
            data-pmx-probe-refresh="true"
            onClick={() => void loadProbeSnapshot(true)}
          >
            <RefreshCwIcon
              className={cn("size-3", probeLoading && "animate-spin")}
              aria-hidden
            />
            {probeLoading ? "探测中…" : "重新探测"}
          </Button>
        </div>

        {visibleProbes.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-2" data-pmx-probe-badge-list="true">
            {visibleProbes.map((entry) => {
              const isAllowedMode =
                entry.authMode === "api_or_custom" || entry.authMode === "local";
              const isSubscriptionMode = entry.authMode === "subscription_oauth";
              return (
                <div
                  key={entry.providerId}
                  data-pmx-probe-provider={entry.providerId}
                  data-pmx-probe-auth-mode={entry.authMode}
                  className={cn(
                    "inline-flex flex-wrap items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs",
                    isAllowedMode
                      ? "border-success/35 bg-success/8 text-foreground"
                      : isSubscriptionMode
                        ? "border-warning/40 bg-warning/10 text-foreground"
                        : "border-border/60 bg-muted/40 text-muted-foreground",
                  )}
                >
                  <AgentBrandLogo provider={entry.providerId} size={13} />
                  <span className="font-medium text-foreground">
                    {resolveConfiguredProviderLabel(
                      entry.providerId,
                      configuredEntries,
                      entry.displayName,
                    )}
                  </span>
                  <Badge
                    variant={isAllowedMode ? "success" : isSubscriptionMode ? "warning" : "secondary"}
                    size="sm"
                    data-pmx-probe-auth-badge={entry.providerId}
                  >
                    {isAllowedMode ? (
                      <CheckCircle2Icon className="size-2.5" aria-hidden />
                    ) : isSubscriptionMode ? (
                      <LockIcon className="size-2.5" aria-hidden />
                    ) : null}
                    {entry.authLabel}
                  </Badge>
                  {entry.endpoint ? (
                    <span className="max-w-44 truncate font-mono text-2xs text-muted-foreground">
                      {entry.endpoint}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">
            {probeLoading
              ? "正在检测本机已安装 Agent 的 API 注入与个人订阅 OAuth 状态…"
              : "未获取到本机探针数据。使用 API Key、CCS 或 Magpie 自定义端点注入模式将自动识别为「API / 自定义端点注入（已放行）」。"}
          </p>
        )}
      </div>

      {/* Two Granular Switches — strictly disabled & locked grey until unified waiver is signed */}
      <div
        className={cn(
          "mt-4 divide-y divide-border/50 rounded-xl border border-border/60 bg-background/50 transition-opacity",
          !isSigned && "opacity-65",
        )}
        data-pmx-waiver-switches="true"
        data-pmx-waiver-switches-locked={isSigned ? "false" : "true"}
      >
        {!isSigned ? (
          <div
            data-pmx-waiver-switches-lock-banner="true"
            className="flex items-center gap-2 bg-muted/50 px-3.5 py-2 text-2xs text-muted-foreground"
          >
            <LockIcon className="size-3 shrink-0" aria-hidden />
            <span>请先点击右上角「签署统一风险免责」，完成风险确认后方可解锁以下两项细粒度开关。</span>
          </div>
        ) : null}

        {/* Switch A */}
        <div className="flex items-start justify-between gap-4 px-3.5 py-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-foreground">
                允许个人订阅态 Antigravity (AGY) 作为被控端/接受自动化调用
              </span>
              {!isSigned ? (
                <Badge variant="secondary" size="sm">
                  未签署已锁灰
                </Badge>
              ) : waiver.allowAntigravityAsControlledAgent ? (
                <Badge variant="warning" size="sm" data-pmx-waiver-switch-a-badge="enabled">
                  已放行被控
                </Badge>
              ) : (
                <Badge variant="secondary" size="sm" data-pmx-waiver-switch-a-badge="locked">
                  仅总控模式
                </Badge>
              )}
            </div>
            <p className="text-2xs leading-relaxed text-muted-foreground">
              默认仅允许您本人将 AGY 作为总控指挥官向外派发任务。开启后允许受控跨代理调用个人订阅态 AGY，但
              24h 无人值守 Cron 与夜间工场仍永久禁止自动唤醒，远程 QQ / Gmail 仍强制草稿就位等待本人确认。
            </p>
          </div>
          <div className="shrink-0 pt-0.5">
            <Switch
              aria-label="允许个人订阅态 Antigravity (AGY) 作为被控端/接受自动化调用"
              data-pmx-waiver-switch="agy-controlled"
              checked={isSigned && waiver.allowAntigravityAsControlledAgent}
              disabled={switchesDisabled}
              onCheckedChange={(next) =>
                void handleToggleSwitch("allowAntigravityAsControlledAgent", next)
              }
            />
          </div>
        </div>

        {/* Switch B */}
        <div className="flex items-start justify-between gap-4 px-3.5 py-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-foreground">
                允许将官方个人订阅态外部 Agent（Codex / Claude Code 等）拉入蜂群与跨代理指挥
              </span>
              {isSigned && waiver.allowExternalSubscriptionAgentsInSwarm ? (
                <Badge variant="warning" size="sm" data-pmx-waiver-high-risk-badge="true">
                  订阅态高风险
                </Badge>
              ) : !isSigned ? (
                <Badge variant="secondary" size="sm">
                  未签署已锁灰
                </Badge>
              ) : null}
            </div>
            <p className="text-2xs leading-relaxed text-muted-foreground">
              仅影响官方个人订阅 OAuth 登录态的外部 Agent（如 ChatGPT 登录态 Codex、个人订阅态 Claude
              Code）。若已配置 API Key 或通过 CCS / Magpie 注入自定义端点，系统默认直接放行，无需开启此开关。
            </p>
          </div>
          <div className="shrink-0 pt-0.5">
            <Switch
              aria-label="允许将官方个人订阅态外部 Agent（Codex / Claude Code 等）拉入蜂群与跨代理指挥"
              data-pmx-waiver-switch="external-swarm"
              checked={isSigned && waiver.allowExternalSubscriptionAgentsInSwarm}
              disabled={switchesDisabled}
              onCheckedChange={(next) =>
                void handleToggleSwitch("allowExternalSubscriptionAgentsInSwarm", next)
              }
            />
          </div>
        </div>
      </div>

      {errorMessage && !modalOpen ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {errorMessage}
        </p>
      ) : null}

      {/* Unified Signing Modal covering AGY + Claude + Codex personal subscription OAuth terms */}
      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/72 p-4 backdrop-blur-sm [-webkit-app-region:no-drag]"
          data-pmx-waiver-modal-backdrop="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            data-pmx-waiver-modal="true"
            data-pmx-glass-zone="overlays"
            className="w-full max-w-xl rounded-2xl border border-warning/45 bg-popover/95 p-6 text-popover-foreground shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/16 text-warning-foreground">
                <AlertTriangleIcon className="size-5" aria-hidden />
              </span>
              <div className="space-y-1">
                <h4
                  id={modalTitleId}
                  className="text-base leading-snug font-semibold text-foreground"
                >
                  统一高风险免责确认：个人订阅跨代理编排与自动化调用
                </h4>
                <p className="text-xs text-muted-foreground">
                  版本 {SUBSCRIPTION_WAIVER_VERSION} · 覆盖 Google Antigravity、Anthropic Claude 与
                  OpenAI Codex 个人订阅 OAuth 条款
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-xs leading-relaxed text-foreground">
              <p className="font-semibold text-warning-foreground">
                通过跨代理调度或蜂群自动化调用官方个人订阅 OAuth 账号可能违反各厂商服务条款，存在服务端 403
                限流、账号冻结与订阅封号风险；签署本免责声明不代表免疫平台风控，建议优先使用企业版、付费 API Key
                或 CCS / Magpie 注入 API 模式，后果自负！
              </p>
              <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">
                <li>
                  <strong className="font-medium text-foreground">Google Antigravity (AGY)</strong>
                  ：个人订阅仅限本人主动交互，反向自动化调用存在 Google 服务端 403 封号风险；且 24h
                  无人值守 Cron / 夜间工场永久禁止自动唤醒个人版 AGY。
                </li>
                <li>
                  <strong className="font-medium text-foreground">Anthropic Claude (Claude Code)</strong>
                  ：官方个人订阅 OAuth（Free / Pro / Max）用于多代理并发编排可能违反 Anthropic
                  个人订阅条款并触发账号风控封禁。
                </li>
                <li>
                  <strong className="font-medium text-foreground">OpenAI Codex (ChatGPT)</strong>
                  ：官方 ChatGPT 个人订阅 OAuth 态拉入蜂群或脚本化调度可能违反 OpenAI
                  个人订阅条款并导致限流或封号。
                </li>
                <li>
                  <strong className="font-medium text-foreground">随时一键回退</strong>
                  ：签署后两项开关仍默认保持关闭，需您手动逐项开启；您可随时点击「撤销免责并恢复硬锁」立即清空授权。
                </li>
              </ul>
            </div>

            <label
              htmlFor={checkboxId}
              className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/70 bg-background/60 p-3 text-xs leading-relaxed text-foreground transition-colors hover:bg-accent/40"
            >
              <input
                id={checkboxId}
                type="checkbox"
                data-pmx-waiver-checkbox="true"
                checked={waiverChecked}
                disabled={saving}
                onChange={(event) => setWaiverChecked(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-warning"
              />
              <span>
                我已完整阅读并充分知晓：将 Google Antigravity、Anthropic Claude 或 OpenAI Codex
                的官方个人订阅 OAuth 账号用于蜂群或跨代理自动化调用，存在违反厂商服务条款及 403
                封号风险，签署免责不免疫平台风控，本人自愿承担全部后果。
              </span>
            </label>

            {errorMessage ? (
              <p
                role="alert"
                className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {errorMessage}
              </p>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving}
                data-pmx-waiver-cancel="true"
                onClick={closeModal}
              >
                取消（保持锁定）
              </Button>
              <Button
                type="button"
                size="sm"
                variant="default"
                disabled={!waiverChecked || saving}
                data-pmx-waiver-confirm="true"
                onClick={() => void handleSignWaiver()}
              >
                {saving ? "正在保存…" : "确认签署统一免责"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
