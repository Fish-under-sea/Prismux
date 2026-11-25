/* oxlint-disable t3code/no-untranslated-copy -- Prismux v3 spec mandates verbatim Chinese AGY controlled-lock badges and risk disclaimer copy */
import { AlertTriangleIcon, LockIcon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { useStableCallback } from "../hooks/useStableCallback";
import { cn } from "../lib/utils";
import { prismuxDaemonClient, type PrismuxDaemonClient } from "./daemonClient";

export const ANTIGRAVITY_CONTROLLED_DEFAULT_LOCKED = true;
export const ANTIGRAVITY_CONTROLLED_DEFAULT_ENABLED = false;
export const ANTIGRAVITY_DISCLAIMER_VERSION = "v3-2026" as const;
export const ANTIGRAVITY_POLICY_ENDPOINT = "/v1/security/antigravity-policy" as const;

export interface AntigravityPolicyState {
  readonly allowAntigravityAsControlledAgent: boolean;
  readonly disclaimerAcceptedAt: string | null;
  readonly disclaimerVersion: string | null;
  readonly defaultLocked: true;
}

export interface AntigravityControlledLockSectionProps {
  readonly daemon?: Pick<PrismuxDaemonClient, "requestJson">;
  readonly readOnly?: boolean;
  readonly className?: string;
  readonly onPolicyChange?: (policy: AntigravityPolicyState) => void;
}

const DEFAULT_POLICY_STATE: AntigravityPolicyState = {
  allowAntigravityAsControlledAgent: ANTIGRAVITY_CONTROLLED_DEFAULT_ENABLED,
  disclaimerAcceptedAt: null,
  disclaimerVersion: null,
  defaultLocked: ANTIGRAVITY_CONTROLLED_DEFAULT_LOCKED,
};

function normalizePolicyResponse(raw: unknown): AntigravityPolicyState {
  if (typeof raw !== "object" || raw === null) {
    return DEFAULT_POLICY_STATE;
  }
  const record = raw as Record<string, unknown>;
  return {
    allowAntigravityAsControlledAgent: record.allowAntigravityAsControlledAgent === true,
    disclaimerAcceptedAt:
      typeof record.disclaimerAcceptedAt === "string" ? record.disclaimerAcceptedAt : null,
    disclaimerVersion:
      typeof record.disclaimerVersion === "string" ? record.disclaimerVersion : null,
    defaultLocked: ANTIGRAVITY_CONTROLLED_DEFAULT_LOCKED,
  };
}

export function AntigravityControlledLockSection({
  daemon = prismuxDaemonClient,
  readOnly = false,
  className,
  onPolicyChange,
}: AntigravityControlledLockSectionProps) {
  const [policy, setPolicy] = useState<AntigravityPolicyState>(DEFAULT_POLICY_STATE);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [disclaimerChecked, setDisclaimerChecked] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const checkboxId = useId();
  const titleId = useId();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fetches initial persisted Antigravity security policy from local daemon
  useEffect(() => {
    let active = true;
    void daemon
      .requestJson<AntigravityPolicyState>(ANTIGRAVITY_POLICY_ENDPOINT)
      .then((response) => {
        if (!active) return;
        const normalized = normalizePolicyResponse(response);
        setPolicy(normalized);
        onPolicyChange?.(normalized);
      })
      .catch(() => {
        // Keep safe locked default (`false`) when daemon is unavailable.
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [daemon, onPolicyChange]);

  const closeDisclaimerModal = useStableCallback(() => {
    if (saving) return;
    setModalOpen(false);
    setDisclaimerChecked(false);
    setErrorMessage(null);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- binds Escape dismissal while risk disclaimer modal is open
  useEffect(() => {
    if (!modalOpen || typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDisclaimerModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDisclaimerModal, modalOpen]);

  const persistLockOff = async () => {
    setSaving(true);
    setErrorMessage(null);
    try {
      const response = await daemon.requestJson<AntigravityPolicyState>(
        ANTIGRAVITY_POLICY_ENDPOINT,
        {
          method: "PUT",
          body: JSON.stringify({
            allowAntigravityAsControlledAgent: false,
          }),
        },
      );
      const normalized = normalizePolicyResponse(response);
      setPolicy(normalized);
      setModalOpen(false);
      setDisclaimerChecked(false);
      onPolicyChange?.(normalized);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "重新锁定失败，请重试。");
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchChange = (nextChecked: boolean) => {
    if (readOnly || saving) return;
    setErrorMessage(null);
    if (!nextChecked) {
      void persistLockOff();
      return;
    }
    // Turning ON never mutates policy directly: mandatory Risk Disclaimer Modal must be accepted first.
    setDisclaimerChecked(false);
    setModalOpen(true);
  };

  const handleAcceptAndEnable = async () => {
    if (!disclaimerChecked || saving || readOnly) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      const response = await daemon.requestJson<AntigravityPolicyState>(
        ANTIGRAVITY_POLICY_ENDPOINT,
        {
          method: "PUT",
          body: JSON.stringify({
            allowAntigravityAsControlledAgent: true,
            disclaimerAccepted: true,
            disclaimerVersion: ANTIGRAVITY_DISCLAIMER_VERSION,
          }),
        },
      );
      const normalized = normalizePolicyResponse(response);
      setPolicy(normalized);
      setModalOpen(false);
      setDisclaimerChecked(false);
      onPolicyChange?.(normalized);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "保存免责解锁策略失败，当前仍保持锁定。",
      );
    } finally {
      setSaving(false);
    }
  };

  const isUnlocked = policy.allowAntigravityAsControlledAgent === true;

  return (
    <section
      data-pmx-agy-controlled-lock="true"
      data-pmx-agy-lock-state={isUnlocked ? "unlocked" : "locked"}
      className={cn(
        "rounded-xl border border-border/60 bg-card/40 p-4 text-foreground shadow-xs/5",
        isUnlocked && "border-warning/45 bg-warning/8",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-lg",
                isUnlocked
                  ? "bg-warning/16 text-warning-foreground"
                  : "bg-muted text-muted-foreground",
              )}
              aria-hidden
            >
              {isUnlocked ? (
                <ShieldAlertIcon className="size-3.5" />
              ) : (
                <ShieldCheckIcon className="size-3.5" />
              )}
            </span>
            <h3 className="text-sm font-semibold text-foreground">
              允许 Antigravity 作为被控 Agent 接受跨代理调度
            </h3>
            {isUnlocked ? (
              <Badge variant="warning" size="sm" data-pmx-agy-lock-badge="unlocked">
                已签署免责解锁
              </Badge>
            ) : (
              <Badge variant="secondary" size="sm" data-pmx-agy-lock-badge="locked">
                <LockIcon className="size-2.5" aria-hidden />
                默认锁定（仅总控）
              </Badge>
            )}
          </div>

          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {isUnlocked
              ? "已解除默认跨代理被控锁定。请注意：即使开启本项，24h 无人值守 Cron 与夜间工场仍永久禁止自动唤醒个人版 AGY，且远程 QQ / Gmail 请求个人版 AGY 仍强制草稿就位等待本人确认。"
              : "为守护个人版 Antigravity（AGY）账号合规，默认严格锁定为「仅总控指挥官（Commander）」模式：您本人可直接驱动 AGY 统筹全栈并向外派发 Codex / Claude Code / OpenCode，但禁止其他 AI 代理或脚本反向操控个人版 AGY。"}
          </p>

          {isUnlocked && policy.disclaimerAcceptedAt ? (
            <p className="text-2xs text-warning-foreground">
              免责声明已签署（版本 {policy.disclaimerVersion ?? ANTIGRAVITY_DISCLAIMER_VERSION} ·{" "}
              {policy.disclaimerAcceptedAt}）
            </p>
          ) : null}

          {errorMessage && !modalOpen ? (
            <p role="alert" className="text-xs text-destructive">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          <Switch
            aria-label="允许 Antigravity 作为被控 Agent"
            data-pmx-agy-controlled-switch="true"
            checked={isUnlocked}
            disabled={readOnly || saving || loading}
            onCheckedChange={handleSwitchChange}
          />
        </div>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/72 p-4 backdrop-blur-sm [-webkit-app-region:no-drag]"
          data-pmx-agy-disclaimer-backdrop="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeDisclaimerModal();
            }
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-pmx-agy-disclaimer-modal="true"
            data-pmx-glass-zone="overlays"
            className="w-full max-w-lg rounded-2xl border border-warning/45 bg-popover/95 p-6 text-popover-foreground shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/16 text-warning-foreground">
                <AlertTriangleIcon className="size-5" aria-hidden />
              </span>
              <div className="space-y-1">
                <h4 id={titleId} className="text-base leading-snug font-semibold text-foreground">
                  高风险免责确认：解除 Antigravity 被控锁定
                </h4>
                <p className="text-xs text-muted-foreground">
                  版本 {ANTIGRAVITY_DISCLAIMER_VERSION} · 启用前请完整阅读以下账号安全警告
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-xs leading-relaxed text-foreground">
              <p className="font-semibold text-warning-foreground">
                跨代理操控个人版 AGY 违反个人订阅条款、存在 Google 服务端 403
                封号风险，签署免责不免疫平台风控，仅建议企业版或付费 API Key 用户启用，后果自负！
              </p>
              <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                <li>个人版订阅仅限您本人主动交互使用，禁止通过第三方脚本或子代理自动化轮询调用。</li>
                <li>解锁后若触发上游 403 限流、账号冻结或订阅吊销，Prismux 无法为您豁免平台风控。</li>
                <li>为守住底线，24h 无人值守 Cron / 夜间工场仍永久禁止自动唤醒个人版 AGY。</li>
              </ul>
            </div>

            <label
              htmlFor={checkboxId}
              className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/70 bg-background/60 p-3 text-xs leading-relaxed text-foreground transition-colors hover:bg-accent/40"
            >
              <input
                id={checkboxId}
                type="checkbox"
                data-pmx-agy-disclaimer-checkbox="true"
                checked={disclaimerChecked}
                disabled={saving}
                onChange={(event) => setDisclaimerChecked(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-warning"
              />
              <span>
                我已充分知晓跨代理调用个人版 Antigravity 存在违反订阅条款与 Google 403
                封号风险，确认仅在企业版或付费 API Key 环境下使用，并自愿承担全部后果。
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
                data-pmx-agy-disclaimer-cancel="true"
                onClick={closeDisclaimerModal}
              >
                取消（保持锁定）
              </Button>
              <Button
                type="button"
                size="sm"
                variant="default"
                disabled={!disclaimerChecked || saving}
                data-pmx-agy-disclaimer-confirm="true"
                onClick={() => void handleAcceptAndEnable()}
              >
                {saving ? "正在保存…" : "签署免责并启用"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
