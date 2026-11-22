import type { ApprovalGuideCard, RiskLevel } from "@prismux/protocol";

export interface RiskLevelDisplayMeta {
  level: RiskLevel;
  labelZh: string;
  badgeIcon: string;
  colorVar: string;
  requiresExtraCaution: boolean;
}

const RISK_DISPLAY_MAP: Record<RiskLevel, RiskLevelDisplayMeta> = {
  low: {
    level: "low",
    labelZh: "低危",
    badgeIcon: "○",
    colorVar: "var(--c-ok, #16a34a)",
    requiresExtraCaution: false
  },
  medium: {
    level: "medium",
    labelZh: "中危",
    badgeIcon: "△",
    colorVar: "var(--c-warn, #d97706)",
    requiresExtraCaution: false
  },
  high: {
    level: "high",
    labelZh: "高危",
    badgeIcon: "!",
    colorVar: "var(--c-bad, #dc2626)",
    requiresExtraCaution: true
  }
};

export function getRiskLevelDisplayMeta(level: RiskLevel): RiskLevelDisplayMeta {
  return RISK_DISPLAY_MAP[level];
}

/**
 * Fallback client-side Chinese translator when raw PreToolUse payloads arrive
 * without a prebuilt server-side ApprovalGuideCard.
 */
export function buildFallbackApprovalGuideCard(
  toolName: string,
  rawCommandOrTarget?: string
): ApprovalGuideCard {
  const normalizedTool = toolName.trim().toLowerCase();
  const target = rawCommandOrTarget?.trim() ?? "";

  if (
    /\b(?:rm\s+-rf|remove-item\s+-recurse\s+-force|git\s+push\s+--force|git\s+reset\s+--hard|mkfs|dd\s+if=|chmod\s+0?777)\b/i.test(
      target
    ) ||
    /(?:\.env|\.ssh|credentials|id_rsa|id_ed25519|\.npmrc)/i.test(target)
  ) {
    return {
      toolName,
      actionSummary: "准备执行高危破坏性命令或触及敏感凭据路径",
      riskLevel: "high",
      triggerReason: "命中高危规则词典（强制删除 / 强推重置 / 权限放开 / 敏感凭据保护）",
      ...(target.length > 0 ? { rawCommandOrTarget: target } : {})
    };
  }

  if (
    normalizedTool.includes("write") ||
    normalizedTool.includes("edit") ||
    normalizedTool.includes("delete") ||
    normalizedTool.includes("bash") ||
    normalizedTool.includes("shell") ||
    normalizedTool.includes("run_command") ||
    normalizedTool.includes("fetch") ||
    normalizedTool.includes("http")
  ) {
    return {
      toolName,
      actionSummary: `准备通过工具 ${toolName} 变更工作区文件、执行命令或访问网络`,
      riskLevel: "medium",
      triggerReason: "命中中危常规变更规则，在受控审批模式下需人类确认放行",
      ...(target.length > 0 ? { rawCommandOrTarget: target } : {})
    };
  }

  return {
    toolName,
    actionSummary: `准备使用 ${toolName} 读取或检索只读上下文`,
    riskLevel: "low",
    triggerReason: "判定为低危只读操作，无本地写入或不可逆变更副作用",
    ...(target.length > 0 ? { rawCommandOrTarget: target } : {})
  };
}
