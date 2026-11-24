import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangleIcon,
  LockIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";

import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import {
  createBackdropDismissGuardState,
  recordBackdropPointerDown,
  shouldDismissOnBackdropClick,
} from "../../../components/ui/dialog-styles";
import type { TrustAuditAssessment } from "./pluginCenterModel";

export interface PluginTrustAuditModalProps {
  readonly audit: TrustAuditAssessment | null;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onConfirm: () => void | Promise<void>;
  readonly onCancel: () => void;
}

const PERMISSION_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  model: "模型可见",
  prompt: "提示词 / 钩子",
  network: "敏感网络",
  filesystem: "本地文件",
  shell: "Shell / 终端",
  ui: "宿主界面",
  other: "常规能力",
};

/**
 * Structured pre-install / pre-upgrade trust audit gate.
 * Requires explicit checkbox consent before permitting installation or upgrade of
 * plugins declaring `modelVisible: true`, prompt modification, or sensitive
 * network/filesystem/shell permissions.
 */
export function PluginTrustAuditModal({
  audit,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: PluginTrustAuditModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const titleId = useId();
  const descId = useId();
  const checkboxId = useId();
  const disabledReasonId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const backdropGuardRef = useRef(createBackdropDismissGuardState());
  const portalHost = typeof document !== "undefined" ? document.body : null;

  useEffect(() => {
    setAcknowledged(false);
    if (audit) {
      // Aligned with stablyai/orca PluginInstallTrustDialog: Cancel holds initial focus
      // so a held Enter keystroke can never confirm an untrusted install.
      cancelRef.current?.focus();
    }
  }, [audit]);

  useEffect(() => {
    if (!audit) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [audit, busy, onCancel]);

  if (!audit) {
    return null;
  }

  const isUpgrade = audit.operation === "upgrade";
  const actionVerb = isUpgrade ? "升级" : "安装";
  const confirmDisabled = busy || !acknowledged;

  const modalContent = (
    <div
      className="fixed top-0 right-0 bottom-[var(--pmx-status-bar-height,20px)] left-0 z-[80] flex items-center justify-center bg-black/60 px-4 pt-10 pb-5 backdrop-blur-xs [-webkit-app-region:no-drag]"
      data-slot="plugin-trust-audit-backdrop"
      data-portal-layer="plugin-trust-audit"
      onPointerDownCapture={(event) => {
        recordBackdropPointerDown(backdropGuardRef.current, event, modalRef.current);
      }}
      onClick={(event) => {
        if (
          shouldDismissOnBackdropClick(backdropGuardRef.current, event, modalRef.current, {
            disabled: busy,
          })
        ) {
          onCancel();
        }
      }}
    >
      <div
        ref={modalRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-pmx-glass-zone="overlays"
        data-testid="plugin-trust-audit-modal"
        className="pmx-plugin-overlay-surface relative flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border-2 border-warning/70 text-popover-foreground shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border/70 bg-warning/10 px-5 py-4">
          <div className="flex items-start gap-3">
            <ShieldAlertIcon className="mt-0.5 size-5 shrink-0 text-warning-foreground" />
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 id={titleId} className="text-base font-semibold text-foreground">
                  {isUpgrade ? "升级前信任审计确认" : "安装前信任审计确认"}
                </h3>
                <Badge variant={audit.severity === "critical" ? "error" : "warning"}>
                  {audit.severity === "critical" ? "高敏风险 · 强制二次确认" : "敏感权限审计"}
                </Badge>
              </div>
              <p id={descId} className="text-xs leading-relaxed text-muted-foreground">
                在继续{actionVerb}之前，请逐项核对插件分发来源、完整性摘要与权限边界。
              </p>
            </div>
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="关闭信任审计弹窗"
            disabled={busy}
            onClick={onCancel}
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        {/* Scrollable body */}
        <div className="space-y-4 overflow-y-auto px-5 py-4 text-xs">
          {/* Identity & Source Summary */}
          <div className="space-y-2 rounded-xl border border-border/60 bg-foreground/[0.025] p-3.5 dark:bg-white/[0.035]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground">{audit.targetLabel}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={audit.source === "official" ? "success" : "info"}>
                  {audit.source === "official"
                    ? "官方认证目录"
                    : audit.source === "local"
                      ? "本地 .wb-plugin 归档"
                      : "社区 npm 源"}
                </Badge>
                <Badge variant="outline">distribution: {audit.distribution}</Badge>
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {isUpgrade && audit.fromVersion && audit.toVersion ? (
                <div className="flex items-center gap-1.5">
                  <dt className="text-muted-foreground">版本变更：</dt>
                  <dd className="font-mono tabular-nums text-foreground">
                    v{audit.fromVersion} → v{audit.toVersion}
                  </dd>
                </div>
              ) : audit.toVersion ? (
                <div className="flex items-center gap-1.5">
                  <dt className="text-muted-foreground">目标版本：</dt>
                  <dd className="font-mono tabular-nums text-foreground">v{audit.toVersion}</dd>
                </div>
              ) : null}

              <div className="flex items-center gap-1.5">
                <dt className="text-muted-foreground">模型可见性：</dt>
                <dd>
                  <Badge variant={audit.modelVisible ? "warning" : "outline"} size="sm">
                    {audit.modelVisible ? "modelVisible: true（模型可见）" : "0 Token 宿主隔离"}
                  </Badge>
                </dd>
              </div>
            </dl>

            {audit.sha256 ? (
              <div className="rounded-lg border border-border/60 bg-foreground/[0.035] px-2.5 py-1.5 dark:bg-white/[0.04]">
                <span className="text-muted-foreground">SHA-256 校验摘要：</span>
                <code className="break-all font-mono text-[11px] text-foreground">
                  {audit.sha256}
                </code>
              </div>
            ) : audit.packageNameOrTarball ? (
              <div className="rounded-lg border border-border/60 bg-foreground/[0.035] px-2.5 py-1.5 dark:bg-white/[0.04]">
                <span className="text-muted-foreground">npm 包 / Tarball：</span>
                <code className="break-all font-mono text-[11px] text-foreground">
                  {audit.packageNameOrTarball}
                </code>
              </div>
            ) : null}
          </div>

          {/* Risk Reasons */}
          {audit.riskReasons.length > 0 ? (
            <div className="space-y-2 rounded-xl border border-warning/50 bg-warning/8 p-3.5">
              <div className="flex items-center gap-1.5 font-semibold text-foreground">
                <AlertTriangleIcon className="size-4 text-warning-foreground" />
                <span>风险提示（{audit.riskReasons.length} 项）</span>
              </div>
              <ul className="list-disc space-y-1 pl-5 leading-relaxed text-foreground">
                {audit.riskReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Permission Matrix */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground">声明权限清单</span>
              <span className="tabular-nums text-muted-foreground">
                共 {audit.permissions.length} 项（含 {audit.sensitivePermissions.length} 项敏感权限）
              </span>
            </div>
            {audit.permissions.length === 0 ? (
              <div className="rounded-lg border border-border/60 bg-foreground/[0.025] px-3 py-2 text-muted-foreground dark:bg-white/[0.035]">
                未在安装前返回静态权限列表（安装时内核仍将强制执行顶层 engines.prismux 校验与脚本禁用）。
              </div>
            ) : (
              <ul className="divide-y divide-border/50 rounded-xl border border-border/60 bg-foreground/[0.025] dark:bg-white/[0.035]">
                {audit.permissions.map((perm) => (
                  <li
                    key={perm.permission}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                          {perm.permission}
                        </code>
                        <Badge variant={perm.elevated ? "warning" : "outline"} size="sm">
                          {PERMISSION_CATEGORY_LABELS[perm.category] ?? "其他"}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{perm.label}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Security Baseline Notice */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-foreground/[0.025] px-3 py-2 text-[11px] text-muted-foreground dark:bg-white/[0.035]">
            <LockIcon className="size-3.5 shrink-0" />
            <span>
              安装过程强制禁用 preinstall / install / postinstall 生命周期脚本、不调用本机 git，凭据独立写入 0600 加密仓。
            </span>
          </div>

          {/* Inline Error Feedback (never hidden behind backdrop) */}
          {error ? (
            <div
              role="alert"
              data-testid="plugin-trust-audit-error"
              className="flex items-start gap-2 rounded-xl border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-xs text-destructive"
            >
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1 break-all leading-relaxed">{error}</span>
            </div>
          ) : null}

          {/* Explicit Consent Checkbox */}
          <label
            htmlFor={checkboxId}
            className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/60 bg-foreground/[0.03] p-3 transition-colors hover:border-primary/60 dark:bg-white/[0.04]"
          >
            <input
              id={checkboxId}
              type="checkbox"
              checked={acknowledged}
              disabled={busy}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
            />
            <span className="leading-relaxed text-foreground">
              我已逐项核对插件分发源、校验摘要与上述权限风险，确认放行本次{actionVerb}操作。
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-foreground/[0.02] px-5 py-3 dark:bg-white/[0.025]">
          {!acknowledged ? (
            <span id={disabledReasonId} className="text-[11px] text-muted-foreground">
              请先勾选上方风险确认框以启用放行按钮。
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-success-foreground">
              <ShieldCheckIcon className="size-3.5" />
              已完成人工审计确认
            </span>
          )}
          <div className="flex items-center gap-2">
            <Button ref={cancelRef} size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
              取消{actionVerb}
            </Button>
            <Button
              size="sm"
              variant="warning-outline"
              disabled={confirmDisabled}
              aria-busy={busy || undefined}
              aria-describedby={!acknowledged ? disabledReasonId : undefined}
              onClick={() => {
                void onConfirm();
              }}
            >
              {busy ? `正在${actionVerb}…` : `确认信任并${actionVerb}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return portalHost ? createPortal(modalContent, portalHost) : modalContent;
}
