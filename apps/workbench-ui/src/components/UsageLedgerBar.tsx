import React, { useEffect, useRef, useState } from "react";
import type { UsageLedgerSummary } from "@prismux/protocol";
import { shouldIgnorePopoverCloseOnEventTarget } from "../logic/navAndCommandStore.js";
import {
  formatLedgerMetric,
  formatMachineIdLabel,
  formatUnknownCountLabel,
  summarizeUsageLedger
} from "../logic/usageFormatting.js";

export interface OvernightEstimateInfo {
  estimatedTokens?: number | null;
  estimatedCostUsd?: number | null;
  windowLabel?: string;
}

export interface UsageLedgerBarProps {
  entries: UsageLedgerSummary[];
  overnightEstimate?: OvernightEstimateInfo;
  activeMachineId?: string | null;
  onInspectDetails?: () => void;
}

export const UsageLedgerBar: React.FC<UsageLedgerBarProps> = ({
  entries,
  overnightEstimate,
  activeMachineId,
  onInspectDetails
}) => {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const summary = summarizeUsageLedger(entries);
  const effectiveMachineId =
    activeMachineId ?? summary.machineIds[0] ?? undefined;

  useEffect(() => {
    if (!popoverOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent): void => {
      if (
        shouldIgnorePopoverCloseOnEventTarget(popoverRef.current, event.target) ||
        shouldIgnorePopoverCloseOnEventTarget(triggerRef.current, event.target)
      ) {
        return;
      }
      setPopoverOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setPopoverOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [popoverOpen]);

  return (
    <footer
      className="pmx-glass-sidebar"
      aria-label="Token 台账与订阅配额速览"
      style={{
        position: "relative",
        zIndex: 20,
        minHeight: "32px",
        padding: "4px 16px",
        borderTop: "1px solid var(--prismux-glass-border, var(--prismux-line, rgba(148,163,184,0.22)))",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        flexWrap: "wrap",
        fontSize: "12px"
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          flexWrap: "wrap"
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span className="prismux-ico" aria-hidden="true">
            ▤
          </span>
          <span className="pmx-muted">今日 Token</span>
          <strong className="pmx-tabular">
            {formatLedgerMetric(summary.totalTodayTokens, {
              unit: "tokens",
              compact: true
            })}
          </strong>
        </span>

        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span className="pmx-muted">本周 Token</span>
          <strong className="pmx-tabular">
            {formatLedgerMetric(summary.totalWeekTokens, {
              unit: "tokens",
              compact: true
            })}
          </strong>
        </span>

        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span className="pmx-muted">配额占比</span>
          <strong className="pmx-tabular">
            {formatLedgerMetric(summary.averageQuotaRatio, {
              unit: "ratio-percent"
            })}
          </strong>
        </span>

        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span className="pmx-muted">夜间工场估算</span>
          <strong className="pmx-tabular">
            {formatLedgerMetric(overnightEstimate?.estimatedCostUsd, {
              unit: "usd"
            })}
          </strong>
          {overnightEstimate?.windowLabel && (
            <span className="pmx-muted">（{overnightEstimate.windowLabel}）</span>
          )}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span className="pmx-muted">machineId</span>
          <code
            className="pmx-tabular"
            style={{
              fontFamily: "ui-monospace, Consolas, monospace",
              fontSize: "12px"
            }}
          >
            {formatMachineIdLabel(effectiveMachineId)}
          </code>
        </span>

        {summary.unknownFieldCount > 0 && summary.dedupedEntries.length > 0 && (
          <span className="pmx-muted pmx-tabular">
            {formatUnknownCountLabel(summary.unknownFieldCount)}
          </span>
        )}

        <button
          ref={triggerRef}
          type="button"
          className="pmx-btn pmx-btn-sm"
          aria-expanded={popoverOpen}
          aria-pressed={popoverOpen}
          onClick={() => {
            setPopoverOpen((v) => !v);
            onInspectDetails?.();
          }}
        >
          <span className="prismux-ico" aria-hidden="true">
            ⊞
          </span>
          <span>台账明细（{summary.dedupedEntries.length}）</span>
        </button>
      </div>

      {popoverOpen && (
        <div
          ref={popoverRef}
          className="pmx-glass-overlay"
          role="dialog"
          aria-label="各 Provider 与设备 Token 台账明细"
          style={{
            position: "absolute",
            right: "16px",
            bottom: "40px",
            width: "min(480px, 92vw)",
            maxHeight: "300px",
            overflowY: "auto",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px"
            }}
          >
            <strong style={{ fontSize: "13px" }}>
              Provider 台账明细（已按 machineId 去重防重算）
            </strong>
            <button
              type="button"
              className="pmx-btn pmx-btn-sm"
              onClick={() => setPopoverOpen(false)}
            >
              关闭
            </button>
          </div>

          {summary.dedupedEntries.length === 0 ? (
            <div className="pmx-muted">
              当前暂无上报流水（所有字段按规范显示「未告知」）。
            </div>
          ) : (
            summary.dedupedEntries.map((row) => (
              <div
                key={`${row.machineId ?? "unknown"}::${row.providerId}`}
                style={{
                  padding: "8px 12px",
                  borderRadius: "10px",
                  border: "1px solid var(--prismux-line, rgba(148,163,184,0.22))",
                  background: "var(--prismux-control, rgba(15,23,42,0.3))"
                }}
              >
                <div className="pmx-kv-row">
                  <strong>{row.providerId}</strong>
                  <span className="pmx-muted pmx-tabular">
                    machineId: {formatMachineIdLabel(row.machineId)}
                  </span>
                </div>
                <div className="pmx-kv-row">
                  <span className="pmx-muted">今日 / 本周 Token</span>
                  <span className="pmx-tabular">
                    {formatLedgerMetric(row.todayTokens, { unit: "tokens" })} /{" "}
                    {formatLedgerMetric(row.weekTokens, { unit: "tokens" })}
                  </span>
                </div>
                <div className="pmx-kv-row">
                  <span className="pmx-muted">配额占比 / 估算成本</span>
                  <span className="pmx-tabular">
                    {formatLedgerMetric(row.quotaUsedRatio, {
                      unit: "ratio-percent"
                    })}{" "}
                    / {formatLedgerMetric(row.estimatedCostUsd, { unit: "usd" })}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </footer>
  );
};
