import { useLocale } from "gt-react";

import { getActiveLocale } from "../../i18n/messages";

export type SessionTelemetryLocale = "zh" | "en";

export interface SessionTelemetryCopy {
  readonly locale: SessionTelemetryLocale;
  readonly statsTitle: string;
  readonly modelCallDuration: string;
  readonly toolCallDuration: string;
  readonly avgTtft: string;
  readonly sessionTps: string;
  readonly latestRequest: string;
  readonly textAndThinkingOutput: string;
  readonly tokensTitle: string;
  readonly cacheHit: string;
  readonly uncachedInput: string;
  readonly cacheRead: string;
  readonly output: string;
  readonly aggregatedTaskTokens: string;
  readonly modelDistribution: string;
  readonly noModelSamples: string;
  readonly todayUsage: string;
  readonly monthUsage: string;
  readonly tokenUnit: string;
  readonly viewUsageStats: string;
  readonly contextWindowTitle: string;
  readonly sampledModel: string;
  readonly primaryEntrypoint: string;
  readonly multipleModelsSampled: string;
  readonly statsTriggerAria: (tpsText: string) => string;
  readonly tokensTriggerAria: (summaryText: string) => string;
  readonly contextTriggerAria: (contextText: string) => string;
  readonly formatCacheHitInline: (rateText: string) => string;
  readonly formatContextInline: (percentText: string) => string;
  readonly formatRoundsStepsSamples: (rounds: number, steps: number, samples: number) => string;
  readonly formatSubagentsLabel: (count: number) => string;
  readonly formatModelCount: (count: number) => string;
  readonly formatContextHeadline: (usedPercent: number, remainingPercent: number) => string;
  readonly formatDuration: (ms: number | null | undefined) => string;
  readonly formatTtft: (ms: number | null | undefined) => string;
}

function formatZhDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)}毫秒`;
  if (ms < 60_000) {
    const secs = ms / 1_000;
    return `${secs.toFixed(1).replace(/\.0$/, "")}秒`;
  }
  const totalSeconds = Math.round(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}小时${minutes}分${seconds}秒`;
  }
  return `${minutes}分${seconds}秒`;
}

function formatEnDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) {
    const secs = ms / 1_000;
    return `${secs.toFixed(1).replace(/\.0$/, "")}s`;
  }
  const totalSeconds = Math.round(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function formatZhTtft(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(2)} 秒`;
}

function formatEnTtft(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(2)} s`;
}

const ZH_COPY: SessionTelemetryCopy = {
  locale: "zh",
  statsTitle: "会话统计",
  modelCallDuration: "模型调用用时",
  toolCallDuration: "工具调用用时",
  avgTtft: "首 token 平均（TTFT）",
  sessionTps: "会话输出速率（TPS）",
  latestRequest: "最近一次请求",
  textAndThinkingOutput: "正文 / 思考输出",
  tokensTitle: "Token 用量",
  cacheHit: "缓存命中",
  uncachedInput: "未缓存输入",
  cacheRead: "缓存读取",
  output: "输出",
  aggregatedTaskTokens: "任务总 Token（聚合）",
  modelDistribution: "多模型分布",
  noModelSamples: "当前会话暂无模型采样",
  todayUsage: "今日用量",
  monthUsage: "本月用量",
  tokenUnit: "Token",
  viewUsageStats: "查看用量统计",
  contextWindowTitle: "上下文窗口",
  sampledModel: "采样模型",
  primaryEntrypoint: "主控入口",
  multipleModelsSampled: "当前会话采样了多个模型",
  statsTriggerAria: (tpsText) => `会话统计（${tpsText}）`,
  tokensTriggerAria: (summaryText) => `Token 用量（${summaryText}）`,
  contextTriggerAria: (contextText) => `上下文窗口（${contextText}）`,
  formatCacheHitInline: (rateText) => `缓存命中 ${rateText}`,
  formatContextInline: (percentText) => `上下文 ${percentText}`,
  formatRoundsStepsSamples: (rounds, steps, samples) =>
    `${rounds}轮 ${steps}步 · ${samples} 次采样`,
  formatSubagentsLabel: (count) => `子代理（${count} 个）`,
  formatModelCount: (count) => `${count} 个模型`,
  formatContextHeadline: (usedPercent, remainingPercent) =>
    `${usedPercent}% 已用（剩余 ${remainingPercent}%）`,
  formatDuration: formatZhDuration,
  formatTtft: formatZhTtft,
};

const EN_COPY: SessionTelemetryCopy = {
  locale: "en",
  statsTitle: "Session stats",
  modelCallDuration: "Model call time",
  toolCallDuration: "Tool call time",
  avgTtft: "Avg first token (TTFT)",
  sessionTps: "Session output rate (TPS)",
  latestRequest: "Latest request",
  textAndThinkingOutput: "Text / thinking output",
  tokensTitle: "Token usage",
  cacheHit: "Cache hit",
  uncachedInput: "Uncached input",
  cacheRead: "Cache read",
  output: "Output",
  aggregatedTaskTokens: "Task total tokens (agg.)",
  modelDistribution: "Model distribution",
  noModelSamples: "No model samples in this session yet",
  todayUsage: "Today",
  monthUsage: "This month",
  tokenUnit: "Token",
  viewUsageStats: "View usage statistics",
  contextWindowTitle: "Context window",
  sampledModel: "Sampled model",
  primaryEntrypoint: "Primary entrypoint",
  multipleModelsSampled: "Multiple models sampled in this session",
  statsTriggerAria: (tpsText) => `Session stats (${tpsText})`,
  tokensTriggerAria: (summaryText) => `Token usage (${summaryText})`,
  contextTriggerAria: (contextText) => `Context window (${contextText})`,
  formatCacheHitInline: (rateText) => `Cache hit ${rateText}`,
  formatContextInline: (percentText) => `Context ${percentText}`,
  formatRoundsStepsSamples: (rounds, steps, samples) =>
    `${rounds} ${rounds === 1 ? "turn" : "turns"} ${steps} ${steps === 1 ? "step" : "steps"} · ${samples} ${samples === 1 ? "sample" : "samples"}`,
  formatSubagentsLabel: (count) => `Subagents (${count})`,
  formatModelCount: (count) => `${count} ${count === 1 ? "model" : "models"}`,
  formatContextHeadline: (usedPercent, remainingPercent) =>
    `${usedPercent}% used (${remainingPercent}% left)`,
  formatDuration: formatEnDuration,
  formatTtft: formatEnTtft,
};

export function resolveSessionTelemetryLocale(
  locale?: string | null,
): SessionTelemetryLocale {
  const normalized = (locale ?? getActiveLocale() ?? "en").toLowerCase();
  return normalized.startsWith("zh") ? "zh" : "en";
}

export function getSessionTelemetryCopy(
  locale?: string | null,
): SessionTelemetryCopy {
  return resolveSessionTelemetryLocale(locale) === "zh" ? ZH_COPY : EN_COPY;
}

export function useSessionTelemetryCopy(): SessionTelemetryCopy {
  const locale = useLocale();
  return getSessionTelemetryCopy(locale);
}
