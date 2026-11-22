import type { AppearanceThemeMode, ReasoningEffort } from "@prismux/protocol";

export interface ReasoningTrackStyle {
  variant: "deepseek-dark" | "deepseek-light" | "standard-dark" | "standard-light";
  trackBackground: string;
  trackBorder: string;
  fillGradient: string;
  fillStartHex: string;
  fillEndHex: string;
  highlightTextColor: string;
  thumbColor: string;
  thumbGlow: string;
}

export interface ReasoningEffortDescriptor {
  effort: ReasoningEffort;
  labelZh: string;
  shortLabel: string;
  defaultTokenBudget: number;
  fillPercent: number;
  descriptionZh: string;
}

export const REASONING_EFFORT_PRESETS: ReadonlyArray<ReasoningEffortDescriptor> = [
  {
    effort: "low",
    labelZh: "低档 · 快速",
    shortLabel: "LOW",
    defaultTokenBudget: 1024,
    fillPercent: 25,
    descriptionZh: "轻量思考预算，适合常规问答与快速检索"
  },
  {
    effort: "medium",
    labelZh: "中档 · 均衡",
    shortLabel: "MEDIUM",
    defaultTokenBudget: 4096,
    fillPercent: 50,
    descriptionZh: "日常编码与脚本排错的默认均衡推理档位"
  },
  {
    effort: "high",
    labelZh: "高档 · 深度",
    shortLabel: "HIGH",
    defaultTokenBudget: 16384,
    fillPercent: 75,
    descriptionZh: "复杂架构推演、多文件重构与跨模块调试"
  },
  {
    effort: "xhigh",
    labelZh: "极高 · 全力",
    shortLabel: "XHIGH",
    defaultTokenBudget: 32768,
    fillPercent: 100,
    descriptionZh: "最大推理深度预算，用于高难度疑难排查"
  }
];

/**
 * Checks whether a model / provider pair belongs to the DeepSeek family.
 */
export function isDeepSeekModel(modelId: string, providerId?: string): boolean {
  const haystack = `${providerId ?? ""} ${modelId}`.toLowerCase();
  return haystack.includes("deepseek");
}

/**
 * Returns the dedicated DeepSeek reasoning track tokens:
 * - Dark / Liquid Glass: deep navy track (`#0b192e`), deep-to-light blue gradient (`#1d4ed8` -> `#6cb6ff`),
 *   and crisp `#6cb6ff` highlight text (strictly non-purple).
 * - Light: crisp white-blue track (`#eef5ff`) clearly distinct from dark mode.
 */
export function getDeepSeekTrackStyle(
  themeMode: AppearanceThemeMode
): ReasoningTrackStyle {
  if (themeMode === "light") {
    return {
      variant: "deepseek-light",
      trackBackground: "#eef5ff",
      trackBorder: "#bfd8ff",
      fillStartHex: "#2563eb",
      fillEndHex: "#60a5fa",
      fillGradient: "linear-gradient(90deg, #2563eb 0%, #3b82f6 55%, #60a5fa 100%)",
      highlightTextColor: "#1d4ed8",
      thumbColor: "#2563eb",
      thumbGlow: "0 0 8px rgba(37, 99, 235, 0.28)"
    };
  }

  return {
    variant: "deepseek-dark",
    trackBackground: "#0b192e",
    trackBorder: "#1b3a63",
    fillStartHex: "#1d4ed8",
    fillEndHex: "#6cb6ff",
    fillGradient: "linear-gradient(90deg, #1d4ed8 0%, #2f7df6 52%, #6cb6ff 100%)",
    highlightTextColor: "#6cb6ff",
    thumbColor: "#6cb6ff",
    thumbGlow: "0 0 12px rgba(108, 182, 255, 0.45)"
  };
}

/**
 * Resolves track colors for either DeepSeek models or general providers.
 */
export function getReasoningTrackStyle(
  modelId: string,
  themeMode: AppearanceThemeMode,
  providerId?: string
): ReasoningTrackStyle {
  if (isDeepSeekModel(modelId, providerId)) {
    return getDeepSeekTrackStyle(themeMode);
  }
  if (themeMode === "light") {
    return {
      variant: "standard-light",
      trackBackground: "#f1f5f9",
      trackBorder: "#cbd5e1",
      fillStartHex: "#334155",
      fillEndHex: "#2563eb",
      fillGradient: "linear-gradient(90deg, #334155 0%, #2563eb 100%)",
      highlightTextColor: "#1e40af",
      thumbColor: "#2563eb",
      thumbGlow: "0 0 8px rgba(37, 99, 235, 0.22)"
    };
  }
  return {
    variant: "standard-dark",
    trackBackground: "#162032",
    trackBorder: "#2b3b55",
    fillStartHex: "#3b82f6",
    fillEndHex: "#93c5fd",
    fillGradient: "linear-gradient(90deg, #2563eb 0%, #60a5fa 100%)",
    highlightTextColor: "#93c5fd",
    thumbColor: "#93c5fd",
    thumbGlow: "0 0 10px rgba(96, 165, 250, 0.35)"
  };
}

export function getReasoningEffortDescriptor(
  effort: ReasoningEffort
): ReasoningEffortDescriptor {
  return (
    REASONING_EFFORT_PRESETS.find((item) => item.effort === effort) ??
    REASONING_EFFORT_PRESETS[1]!
  );
}
