/* oxlint-disable t3code/no-untranslated-copy -- Prismux v3 spec mandates verbatim Chinese subscription orchestration interception dialog copy */
import {
  ProviderDriverKind,
  ProviderInstanceId,
  defaultInstanceIdForDriver,
} from "@t3tools/contracts";
import { KeyRoundIcon, ShieldAlertIcon, ShieldCheckIcon, XIcon } from "lucide-react";
import { useEffect, useId } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { AgentBrandLogo, formatAgentBrandName, resolveAgentBrandId } from "./agentBrand";
import { SUBSCRIPTION_WAIVER_ANCHOR_ID } from "./SubscriptionRiskWaiverSection";

export const ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED =
  "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED" as const;
export const PRISMUX_SUBSCRIPTION_BLOCKED_EVENT =
  "prismux:subscription-orchestration-blocked" as const;
export const SUBSCRIPTION_WAIVER_SETTINGS_ROUTE =
  `/settings/providers#${SUBSCRIPTION_WAIVER_ANCHOR_ID}` as const;

export interface SubscriptionOrchestrationBlockedDetail {
  readonly code: typeof ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED;
  readonly reasonCode?: string | undefined;
  readonly providerId: string;
  readonly authMode: "subscription_oauth";
  readonly authLabel: string;
  readonly settingsRoute: string;
  readonly message?: string | undefined;
}

const DEFAULT_SUBSCRIPTION_AUTH_LABEL = "官方个人订阅 OAuth";

function normalizeBlockedRecord(
  record: Record<string, unknown>,
  fallbackProviderId?: string,
): SubscriptionOrchestrationBlockedDetail | null {
  if (record.code !== ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED) {
    return null;
  }
  const providerId =
    typeof record.providerId === "string" && record.providerId.trim().length > 0
      ? record.providerId.trim()
      : fallbackProviderId?.trim() || "agent";
  const authLabel =
    typeof record.authLabel === "string" && record.authLabel.trim().length > 0
      ? record.authLabel.trim()
      : DEFAULT_SUBSCRIPTION_AUTH_LABEL;
  const settingsRoute =
    typeof record.settingsRoute === "string" && record.settingsRoute.trim().length > 0
      ? record.settingsRoute.trim()
      : SUBSCRIPTION_WAIVER_SETTINGS_ROUTE;
  return {
    code: ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED,
    ...(typeof record.reasonCode === "string" && record.reasonCode.trim().length > 0
      ? { reasonCode: record.reasonCode.trim() }
      : {}),
    providerId,
    authMode: "subscription_oauth",
    authLabel,
    settingsRoute,
    ...(typeof record.message === "string" && record.message.trim().length > 0
      ? { message: record.message.trim() }
      : {}),
  };
}

/**
 * Extracts a structured `ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED` payload from daemon HTTP JSON,
 * `PrismuxDaemonError`, or raw error strings so any dispatch/swarm caller can open the interception dialog.
 */
export function extractSubscriptionOrchestrationBlockedError(
  input: unknown,
  fallbackProviderId?: string,
): SubscriptionOrchestrationBlockedDetail | null {
  if (!input) return null;

  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (typeof obj.details === "object" && obj.details !== null) {
      const fromDetails = normalizeBlockedRecord(
        obj.details as Record<string, unknown>,
        fallbackProviderId,
      );
      if (fromDetails) return fromDetails;
    }

    const direct = normalizeBlockedRecord(obj, fallbackProviderId);
    if (direct) return direct;

    if (obj.code === ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED) {
      return normalizeBlockedRecord(
        {
          code: ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED,
          providerId: fallbackProviderId ?? "agent",
          message: typeof obj.message === "string" ? obj.message : undefined,
        },
        fallbackProviderId,
      );
    }

    if (typeof obj.error === "string" || typeof obj.message === "string") {
      const rawText = typeof obj.error === "string" ? obj.error : (obj.message as string);
      const parsedFromText = extractSubscriptionOrchestrationBlockedError(
        rawText,
        fallbackProviderId,
      );
      if (parsedFromText) return parsedFromText;
    }
    return null;
  }

  if (typeof input === "string" && input.includes(ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED)) {
    const jsonStart = input.indexOf("{");
    const jsonEnd = input.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      try {
        const parsed = JSON.parse(input.slice(jsonStart, jsonEnd + 1)) as unknown;
        if (typeof parsed === "object" && parsed !== null) {
          const normalized = normalizeBlockedRecord(
            parsed as Record<string, unknown>,
            fallbackProviderId,
          );
          if (normalized) return normalized;
        }
      } catch {
        // Fall back to heuristic extraction below.
      }
    }
    return {
      code: ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED,
      providerId: fallbackProviderId?.trim() || "agent",
      authMode: "subscription_oauth",
      authLabel: DEFAULT_SUBSCRIPTION_AUTH_LABEL,
      settingsRoute: SUBSCRIPTION_WAIVER_SETTINGS_ROUTE,
      message: input,
    };
  }

  return null;
}

export function emitSubscriptionOrchestrationBlocked(
  detail: SubscriptionOrchestrationBlockedDetail,
): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }
  const EventCtor =
    typeof CustomEvent === "function"
      ? CustomEvent
      : (window as unknown as { CustomEvent?: typeof CustomEvent }).CustomEvent;
  if (typeof EventCtor === "function") {
    window.dispatchEvent(new EventCtor(PRISMUX_SUBSCRIPTION_BLOCKED_EVENT, { detail }));
  } else {
    window.dispatchEvent({
      type: PRISMUX_SUBSCRIPTION_BLOCKED_EVENT,
      detail,
    } as unknown as Event);
  }
}

export function resolveBlockedProviderInstanceId(
  providerId: string,
): ProviderInstanceId | undefined {
  const brand = resolveAgentBrandId(providerId);
  switch (brand) {
    case "codex":
      return defaultInstanceIdForDriver(ProviderDriverKind.make("codex"));
    case "claude-code":
      return defaultInstanceIdForDriver(ProviderDriverKind.make("claudeAgent"));
    case "antigravity":
      return defaultInstanceIdForDriver(ProviderDriverKind.make("antigravity"));
    case "opencode":
      return defaultInstanceIdForDriver(ProviderDriverKind.make("opencode"));
    case "cursor":
      return defaultInstanceIdForDriver(ProviderDriverKind.make("cursor"));
    default: {
      const trimmed = providerId.trim();
      return trimmed.length > 0 ? ProviderInstanceId.make(trimmed) : undefined;
    }
  }
}

export function formatSubscriptionBlockedCopy(
  detail: Pick<SubscriptionOrchestrationBlockedDetail, "providerId" | "authLabel">,
): string {
  const agentName = formatAgentBrandName(detail.providerId);
  const authLabel = detail.authLabel.trim() || DEFAULT_SUBSCRIPTION_AUTH_LABEL;
  return `当前 ${agentName} 运行在官方个人订阅模式（${authLabel}），为避免违反厂商服务条款导致封号，默认禁止参与蜂群或跨代理自动化调用；若你使用 API Key 或 CCS / Magpie 注入 API 模式则不受限制`;
}

export interface SubscriptionOrchestrationBlockedDialogProps {
  readonly detail: SubscriptionOrchestrationBlockedDetail | null;
  readonly onClose: () => void;
  readonly onConfigureApi: (detail: SubscriptionOrchestrationBlockedDetail) => void;
  readonly onOpenWaiver: (detail: SubscriptionOrchestrationBlockedDetail) => void;
}

export function SubscriptionOrchestrationBlockedDialog({
  detail,
  onClose,
  onConfigureApi,
  onOpenWaiver,
}: SubscriptionOrchestrationBlockedDialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- binds Escape dismissal while interception dialog is open
  useEffect(() => {
    if (!detail || typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [detail, onClose]);

  if (!detail) return null;

  const agentName = formatAgentBrandName(detail.providerId);
  const bodyCopy = formatSubscriptionBlockedCopy(detail);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/72 p-4 backdrop-blur-sm [-webkit-app-region:no-drag]"
      data-pmx-subscription-blocked-backdrop="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-pmx-subscription-blocked-dialog="true"
        data-pmx-blocked-provider={detail.providerId}
        data-pmx-glass-zone="overlays"
        className="w-full max-w-lg rounded-2xl border border-warning/45 bg-popover/95 p-6 text-popover-foreground shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/16 text-warning-foreground">
              <ShieldAlertIcon className="size-5" aria-hidden />
            </span>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="warning" size="sm">
                  {ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED}
                </Badge>
                <Badge variant="outline" size="sm">
                  <AgentBrandLogo provider={detail.providerId} size={12} />
                  {agentName}
                </Badge>
              </div>
              <h4
                id={titleId}
                className="text-base leading-snug font-semibold text-foreground"
              >
                已拦截官方个人订阅态跨代理自动化调用
              </h4>
            </div>
          </div>

          <button
            type="button"
            aria-label="关闭弹窗"
            data-pmx-blocked-close="true"
            onClick={onClose}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <XIcon className="size-4" aria-hidden />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-warning/35 bg-warning/10 p-3.5">
          <p
            id={descriptionId}
            data-pmx-blocked-copy="true"
            className="text-xs leading-relaxed text-foreground"
          >
            {bodyCopy}
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-pmx-blocked-open-waiver="true"
            onClick={() => onOpenWaiver(detail)}
          >
            <ShieldCheckIcon className="size-3.5" aria-hidden />
            前往设置签署免责声明
          </Button>
          <Button
            type="button"
            size="sm"
            variant="default"
            data-pmx-blocked-configure-api="true"
            onClick={() => onConfigureApi(detail)}
          >
            <KeyRoundIcon className="size-3.5" aria-hidden />
            配置 API 模式（推荐）
          </Button>
        </div>
      </div>
    </div>
  );
}
