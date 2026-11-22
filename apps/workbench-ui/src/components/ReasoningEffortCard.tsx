import React from "react";
import {
  REASONING_EFFORTS,
  type AppearanceThemeMode,
  type ReasoningEffort,
  type ReasoningModelProfile
} from "@prismux/protocol";
import {
  getReasoningEffortDescriptor,
  getReasoningTrackStyle,
  isDeepSeekModel,
  REASONING_EFFORT_PRESETS
} from "../logic/reasoningThemeTokens.js";
import { formatLedgerMetric } from "../logic/usageFormatting.js";

export interface ReasoningModelOption {
  providerId: string;
  modelId: string;
  label: string;
  supportsMultimodal: boolean;
  maxBudgetTokens?: number;
}

export const DEFAULT_REASONING_MODELS: ReadonlyArray<ReasoningModelOption> = [
  {
    providerId: "deepseek",
    modelId: "deepseek-r1",
    label: "DeepSeek R1（深度推理）",
    supportsMultimodal: false,
    maxBudgetTokens: 32768
  },
  {
    providerId: "deepseek",
    modelId: "deepseek-reasoner",
    label: "DeepSeek Reasoner",
    supportsMultimodal: false,
    maxBudgetTokens: 32768
  },
  {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    supportsMultimodal: true,
    maxBudgetTokens: 32768
  },
  {
    providerId: "openai",
    modelId: "o3-codex",
    label: "Codex o3",
    supportsMultimodal: true,
    maxBudgetTokens: 32768
  },
  {
    providerId: "google",
    modelId: "gemini-4-neon",
    label: "Antigravity (gemini-4-neon)",
    supportsMultimodal: true,
    maxBudgetTokens: 32768
  }
];

export interface ReasoningEffortCardProps {
  profile: ReasoningModelProfile;
  availableModels?: ReadonlyArray<ReasoningModelOption>;
  themeMode: AppearanceThemeMode;
  onChange: (next: ReasoningModelProfile) => void;
  disabledReason?: string;
}

export const ReasoningEffortCard: React.FC<ReasoningEffortCardProps> = ({
  profile,
  availableModels = DEFAULT_REASONING_MODELS,
  themeMode,
  onChange,
  disabledReason
}) => {
  const isDeepSeek = isDeepSeekModel(profile.modelId, profile.providerId);
  const trackStyle = getReasoningTrackStyle(
    profile.modelId,
    themeMode,
    profile.providerId
  );
  const descriptor = getReasoningEffortDescriptor(profile.effort);
  const selectedModelMeta = availableModels.find(
    (m) => m.modelId === profile.modelId && m.providerId === profile.providerId
  );
  const maxBudget = selectedModelMeta?.maxBudgetTokens ?? 32768;
  const activeBudget = profile.tokenBudget ?? descriptor.defaultTokenBudget;
  const fillPercent = Math.max(
    8,
    Math.min(100, Math.round((activeBudget / maxBudget) * 100))
  );

  const handleSelectModel = (modelKey: string): void => {
    const match = availableModels.find(
      (item) => `${item.providerId}::${item.modelId}` === modelKey
    );
    if (!match) {
      return;
    }
    onChange({
      ...profile,
      providerId: match.providerId,
      modelId: match.modelId,
      supportsMultimodal: match.supportsMultimodal,
      multimodalEnabled: match.supportsMultimodal
        ? profile.multimodalEnabled
        : false
    });
  };

  const handleSelectEffort = (effort: ReasoningEffort): void => {
    const nextMeta = getReasoningEffortDescriptor(effort);
    onChange({
      ...profile,
      effort,
      tokenBudget: nextMeta.defaultTokenBudget
    });
  };

  return (
    <section
      className="pmx-glass-content prismux-glass-surface"
      aria-label="模型思考强度与模态直调卡"
      data-deepseek-active={isDeepSeek ? "1" : "0"}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "16px"
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="prismux-ico" aria-hidden="true">
            ◈
          </span>
          <div>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>
              思考强度与模态直调
            </h3>
            <div className="pmx-muted">
              通过线协议参数直发推理预算，不拼接系统提示词
            </div>
          </div>
        </div>

        <span
          className="pmx-tabular"
          style={{
            color: trackStyle.highlightTextColor,
            fontWeight: 600,
            fontSize: "12.5px",
            padding: "2px 10px",
            borderRadius: "999px",
            border: `1px solid ${trackStyle.trackBorder}`,
            background: trackStyle.trackBackground
          }}
        >
          {descriptor.shortLabel} · {formatLedgerMetric(profile.tokenBudget, { unit: "tokens" })} Tokens
        </span>
      </header>

      {disabledReason && (
        <div className="pmx-muted" role="note">
          当前不可调节：{disabledReason}
        </div>
      )}

      {/* 模型选择器 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap"
        }}
      >
        <label
          htmlFor="pmx-reasoning-model-select"
          className="pmx-muted"
          style={{ minWidth: "88px" }}
        >
          当前模型
        </label>
        <select
          id="pmx-reasoning-model-select"
          className="pmx-input"
          disabled={Boolean(disabledReason)}
          value={`${profile.providerId}::${profile.modelId}`}
          onChange={(e) => handleSelectModel(e.target.value)}
          style={{ flex: 1, minWidth: "200px" }}
        >
          {availableModels.map((item) => (
            <option
              key={`${item.providerId}::${item.modelId}`}
              value={`${item.providerId}::${item.modelId}`}
            >
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {/* 思考强度档位 */}
      <div
        role="radiogroup"
        aria-label="思考预算档位"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: "8px"
        }}
      >
        {REASONING_EFFORTS.map((effortKey) => {
          const item = getReasoningEffortDescriptor(effortKey);
          const selected = profile.effort === effortKey;
          return (
            <button
              key={effortKey}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-pressed={selected}
              disabled={Boolean(disabledReason)}
              className={`pmx-btn ${selected ? "pmx-btn-selected" : ""}`}
              onClick={() => handleSelectEffort(effortKey)}
              style={{
                flexDirection: "column",
                height: "auto",
                minHeight: "44px",
                padding: "8px 6px",
                gap: "4px",
                borderColor: selected ? trackStyle.highlightTextColor : undefined
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  color: selected ? trackStyle.highlightTextColor : undefined
                }}
              >
                {item.shortLabel}
              </span>
              <span className="pmx-muted pmx-tabular" style={{ fontSize: "12px" }}>
                {formatLedgerMetric(item.defaultTokenBudget, { compact: true })}
              </span>
            </button>
          );
        })}
      </div>

      {/* DeepSeek 暗色深海蓝 / 浅色白蓝 专属思考轨道 */}
      <div
        data-reasoning-variant={trackStyle.variant}
        style={{
          padding: "12px",
          borderRadius: "10px",
          background: trackStyle.trackBackground,
          border: `1px solid ${trackStyle.trackBorder}`,
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
          <span
            style={{
              color: trackStyle.highlightTextColor,
              fontWeight: 600,
              fontSize: "12.5px"
            }}
          >
            {isDeepSeek ? "DeepSeek 专属思考深度轨" : "推理 Token 预算轨"}
          </span>
          <span
            className="pmx-tabular"
            style={{
              color: trackStyle.highlightTextColor,
              fontWeight: 600,
              fontSize: "12.5px"
            }}
          >
            {formatLedgerMetric(profile.tokenBudget, { unit: "tokens" })} /{" "}
            {formatLedgerMetric(maxBudget, { unit: "tokens" })}
          </span>
        </div>

        <div
          style={{
            position: "relative",
            height: "8px",
            borderRadius: "999px",
            background: "rgba(148, 163, 184, 0.16)",
            overflow: "hidden"
          }}
        >
          <div
            style={{
              width: `${fillPercent}%`,
              height: "100%",
              borderRadius: "999px",
              background: trackStyle.fillGradient,
              boxShadow: trackStyle.thumbGlow,
              transition: "width 200ms cubic-bezier(0.22, 1, 0.36, 1)"
            }}
          />
        </div>

        <input
          type="range"
          aria-label="微调推理 Token 预算"
          min={1024}
          max={maxBudget}
          step={1024}
          disabled={Boolean(disabledReason)}
          value={activeBudget}
          onChange={(e) => {
            const budget = Number(e.target.value);
            const matched =
              REASONING_EFFORT_PRESETS.find((p) => budget <= p.defaultTokenBudget)
                ?.effort ?? "xhigh";
            onChange({
              ...profile,
              effort: matched,
              tokenBudget: budget
            });
          }}
          style={{
            width: "100%",
            accentColor: trackStyle.thumbColor,
            cursor: disabledReason ? "not-allowed" : "pointer"
          }}
        />

        <div className="pmx-muted" style={{ fontSize: "12px" }}>
          {descriptor.descriptionZh}
        </div>
      </div>

      {/* 图片 / 多模态开关 */}
      <div
        className="pmx-kv-row"
        style={{
          padding: "4px 0"
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <span style={{ fontWeight: 500 }}>图片与多模态视觉输入</span>
          {!profile.supportsMultimodal && (
            <span className="pmx-muted">
              不可用原因：当前模型（{profile.modelId}）仅支持纯文本推理输入
            </span>
          )}
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={profile.supportsMultimodal && profile.multimodalEnabled}
          aria-pressed={profile.supportsMultimodal && profile.multimodalEnabled}
          disabled={Boolean(disabledReason) || !profile.supportsMultimodal}
          title={
            !profile.supportsMultimodal
              ? "当前模型不支持图片/多模态输入"
              : disabledReason
          }
          className={`pmx-btn ${
            profile.supportsMultimodal && profile.multimodalEnabled
              ? "pmx-btn-selected"
              : ""
          }`}
          onClick={() =>
            onChange({
              ...profile,
              multimodalEnabled: !profile.multimodalEnabled
            })
          }
        >
          <span className="prismux-ico" aria-hidden="true">
            {profile.supportsMultimodal && profile.multimodalEnabled ? "◉" : "○"}
          </span>
          <span>
            {profile.supportsMultimodal
              ? profile.multimodalEnabled
                ? "已开启多模态"
                : "仅纯文本"
              : "模型不支持"}
          </span>
        </button>
      </div>
    </section>
  );
};
