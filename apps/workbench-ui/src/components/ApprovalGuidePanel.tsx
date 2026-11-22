import React, { useMemo, useRef, useState } from "react";
import type { ApprovalGuideCard } from "@prismux/protocol";
import { getRiskLevelDisplayMeta } from "../logic/approvalTranslator.js";
import {
  EmptyContinueSubmissionLatch,
  STANDARD_CONTINUE_COMMAND,
  type SubmissionIntent
} from "../logic/emptyInputContinue.js";

export interface PendingApprovalItem {
  requestId: string;
  threadId?: string;
  card: ApprovalGuideCard;
  createdAt: number;
  status?: "pending" | "approved" | "rejected";
}

export interface ApprovalGuidePanelProps {
  approvals: PendingApprovalItem[];
  onDecide: (requestId: string, allow: boolean, reason?: string) => void;
  onSubmitPrompt: (intent: SubmissionIntent) => Promise<void> | void;
  latch?: EmptyContinueSubmissionLatch;
  activeThreadId?: string;
  disabledReason?: string;
  loadingRequestId?: string | null;
  errorMessage?: string | null;
  onRetryError?: () => void;
}

export const ApprovalGuidePanel: React.FC<ApprovalGuidePanelProps> = ({
  approvals,
  onDecide,
  onSubmitPrompt,
  latch,
  activeThreadId = "chief",
  disabledReason,
  loadingRequestId = null,
  errorMessage = null,
  onRetryError
}) => {
  const fallbackLatchRef = useRef<EmptyContinueSubmissionLatch | null>(null);
  if (fallbackLatchRef.current === null) {
    fallbackLatchRef.current = new EmptyContinueSubmissionLatch();
  }
  const activeLatch = latch ?? fallbackLatchRef.current;

  const [promptInput, setPromptInput] = useState("");
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [confirmHighRiskId, setConfirmHighRiskId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [latchStatusText, setLatchStatusText] = useState<string | null>(null);

  const pendingApprovals = useMemo(
    () => approvals.filter((item) => (item.status ?? "pending") === "pending"),
    [approvals]
  );

  const handleDispatchPrompt = async (trigger: "button" | "enter"): Promise<void> => {
    if (disabledReason) {
      return;
    }
    const outcome = await activeLatch.submitOnce(
      promptInput,
      async (intent) => {
        setSubmitting(true);
        setLatchStatusText(
          intent.isAutoContinue
            ? `已自动转为标准续跑指令：${STANDARD_CONTINUE_COMMAND}`
            : `已发送指令：${intent.text}`
        );
        try {
          await onSubmitPrompt(intent);
        } finally {
          setSubmitting(false);
        }
      },
      { trigger, threadId: activeThreadId }
    );

    if (!outcome.executed) {
      setLatchStatusText(
        outcome.latch.reason === "duplicate_inflight"
          ? "单路径幂等保护：上一条指令仍在执行，已拦截重复发送"
          : "单路径幂等保护：检测到连点或热键重复触发，已去重拦截"
      );
      return;
    }

    setPromptInput("");
  };

  return (
    <section
      className="pmx-glass-content prismux-glass-surface"
      aria-label="中文审批解说与续跑控制台"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "10px 12px",
        height: "100%",
        minHeight: 0,
        overflow: "hidden"
      }}
    >
      <header
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
          <span className="prismux-ico" aria-hidden="true">
            ⚑
          </span>
          <h3
            style={{
              margin: 0,
              fontSize: "13px",
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}
          >
            中文审批解说（ApprovalGuide）
          </h3>
        </div>
        <span
          className="pmx-muted pmx-tabular"
          style={{
            flexShrink: 0,
            padding: "2px 8px",
            borderRadius: "999px",
            border: "1px solid var(--prismux-line, rgba(148,163,184,0.28))"
          }}
        >
          待审批 {pendingApprovals.length} 项
        </span>
      </header>

      {errorMessage && (
        <div className="pmx-alert" role="alert" style={{ flexShrink: 0 }}>
          <span>审批动作失败：{errorMessage}。请检查守护进程连接后重试。</span>
          {onRetryError && (
            <button
              type="button"
              className="pmx-btn pmx-btn-sm"
              onClick={onRetryError}
            >
              重试
            </button>
          )}
        </div>
      )}

      {disabledReason && (
        <p className="pmx-muted" style={{ margin: 0, flexShrink: 0 }}>
          操作受限：{disabledReason}
        </p>
      )}

      <div
        style={{
          flex: "1 1 0",
          minHeight: "110px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "8px"
        }}
      >
        {pendingApprovals.length === 0 ? (
          <div
            style={{
              padding: "12px",
              borderRadius: "10px",
              border: "1px dashed var(--prismux-line, rgba(148,163,184,0.28))",
              color: "var(--prismux-muted, #94a3b8)",
              fontSize: "12.5px"
            }}
          >
            当前暂无待确认的 PreToolUse 高风险工具调用。可在下方留空输入框直接点击发送，幂等续跑当前线程。
          </div>
        ) : (
          pendingApprovals.map((item) => {
            const riskMeta = getRiskLevelDisplayMeta(item.card.riskLevel);
            const isBusy = loadingRequestId === item.requestId;
            const isConfirmingHigh = confirmHighRiskId === item.requestId;
            const reasonValue = rejectReasons[item.requestId] ?? "";

            return (
              <article
                key={item.requestId}
                aria-busy={isBusy}
                style={{
                  padding: "8px 12px",
                  borderRadius: "10px",
                  border: `1px solid ${
                    riskMeta.level === "high"
                      ? "var(--c-bad, #dc2626)"
                      : "var(--prismux-line, rgba(148,163,184,0.28))"
                  }`,
                  background: "var(--prismux-control, rgba(15, 23, 42, 0.35))",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px"
                }}
              >
                {/* 三栏中文审批卡 */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1.35fr) auto minmax(0, 1.35fr)",
                    gap: "8px",
                    alignItems: "start"
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="pmx-muted" style={{ marginBottom: "2px" }}>
                      准备干什么
                    </div>
                    <div style={{ fontWeight: 600, fontSize: "12.5px", lineHeight: 1.35 }}>
                      {item.card.actionSummary}
                    </div>
                    <div className="pmx-muted" style={{ marginTop: "2px" }}>
                      工具：{item.card.toolName}
                    </div>
                  </div>

                  <div style={{ flexShrink: 0 }}>
                    <div className="pmx-muted" style={{ marginBottom: "2px" }}>
                      潜在风险等级
                    </div>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "2px 8px",
                        borderRadius: "999px",
                        border: `1px solid ${riskMeta.colorVar}`,
                        color: riskMeta.colorVar,
                        fontWeight: 600,
                        fontSize: "12px",
                        whiteSpace: "nowrap"
                      }}
                    >
                      <span className="prismux-ico" aria-hidden="true">
                        {riskMeta.badgeIcon}
                      </span>
                      <span>{riskMeta.labelZh}</span>
                    </div>
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div className="pmx-muted" style={{ marginBottom: "2px" }}>
                      触发拦截依据
                    </div>
                    <div style={{ fontSize: "12px", lineHeight: 1.35 }}>
                      {item.card.triggerReason}
                    </div>
                  </div>
                </div>

                {item.card.rawCommandOrTarget && (
                  <pre
                    style={{
                      margin: 0,
                      padding: "4px 8px",
                      borderRadius: "6px",
                      background: "rgba(15, 23, 42, 0.45)",
                      border: "1px solid var(--prismux-line, rgba(148,163,184,0.22))",
                      fontFamily: "ui-monospace, Consolas, monospace",
                      fontSize: "12px",
                      lineHeight: 1.35,
                      overflowX: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all"
                    }}
                  >
                    {item.card.rawCommandOrTarget}
                  </pre>
                )}

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "6px"
                  }}
                >
                  <input
                    type="text"
                    className="pmx-input"
                    aria-label="驳回或审批备注"
                    placeholder="可选：填写驳回原因或审批批注..."
                    value={reasonValue}
                    disabled={Boolean(disabledReason) || isBusy}
                    onChange={(e) =>
                      setRejectReasons((prev) => ({
                        ...prev,
                        [item.requestId]: e.target.value
                      }))
                    }
                    style={{
                      flex: 1,
                      minWidth: "100px",
                      height: "24px",
                      minHeight: "24px",
                      padding: "0 8px",
                      fontSize: "12px"
                    }}
                  />

                  {riskMeta.requiresExtraCaution && !isConfirmingHigh ? (
                    <button
                      type="button"
                      className="pmx-btn pmx-btn-sm pmx-btn-danger"
                      disabled={Boolean(disabledReason) || isBusy}
                      title={disabledReason}
                      onClick={() => setConfirmHighRiskId(item.requestId)}
                    >
                      <span className="prismux-ico" aria-hidden="true">
                        !
                      </span>
                      <span>高危放行确认</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="pmx-btn pmx-btn-sm pmx-btn-primary"
                      disabled={Boolean(disabledReason) || isBusy}
                      aria-busy={isBusy}
                      title={disabledReason}
                      onClick={() => {
                        setConfirmHighRiskId(null);
                        onDecide(item.requestId, true, reasonValue.trim() || undefined);
                      }}
                    >
                      <span className="prismux-ico" aria-hidden="true">
                        ✓
                      </span>
                      <span>
                        {isBusy
                          ? "处理中..."
                          : riskMeta.requiresExtraCaution
                            ? "确认高危放行"
                            : "放行执行"}
                      </span>
                    </button>
                  )}

                  {isConfirmingHigh && (
                    <button
                      type="button"
                      className="pmx-btn pmx-btn-sm"
                      onClick={() => setConfirmHighRiskId(null)}
                    >
                      取消高危放行
                    </button>
                  )}

                  <button
                    type="button"
                    className="pmx-btn pmx-btn-sm pmx-btn-danger"
                    disabled={Boolean(disabledReason) || isBusy}
                    title={disabledReason}
                    onClick={() => {
                      setConfirmHighRiskId(null);
                      onDecide(
                        item.requestId,
                        false,
                        reasonValue.trim() || "用户审阅后驳回执行"
                      );
                    }}
                  >
                    <span className="prismux-ico" aria-hidden="true">
                      ✕
                    </span>
                    <span>驳回拦截</span>
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* 空输入自动 Continue 发送条 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleDispatchPrompt("button");
        }}
        style={{
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          paddingTop: "6px",
          borderTop: "1px solid var(--prismux-line, rgba(148,163,184,0.2))"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <input
            type="text"
            className="pmx-input"
            aria-label="主秘书快捷指令输入框"
            title="输入补充说明；留空直接按 Enter 或点击发送将自动续跑 Continue"
            placeholder="输入指令，留空直接 Continue"
            value={promptInput}
            disabled={Boolean(disabledReason)}
            onChange={(e) => setPromptInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleDispatchPrompt("enter");
              }
            }}
            style={{
              flex: 1,
              minWidth: 0,
              height: "28px",
              minHeight: "28px"
            }}
          />
          <button
            type="submit"
            className="pmx-btn pmx-btn-primary"
            disabled={Boolean(disabledReason)}
            aria-busy={submitting}
            title={disabledReason}
            style={{ flexShrink: 0, padding: "0 10px" }}
          >
            <span className="prismux-ico" aria-hidden="true">
              ▶
            </span>
            <span>
              {submitting
                ? "发送中..."
                : promptInput.trim().length === 0
                  ? "继续（Continue）"
                  : "发送指令"}
            </span>
          </button>
        </div>

        {latchStatusText && (
          <div className="pmx-muted" role="status" style={{ fontSize: "12px" }}>
            {latchStatusText}
          </div>
        )}
      </form>
    </section>
  );
};
