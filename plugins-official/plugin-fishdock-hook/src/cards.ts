import {
  BRAND,
  type ApprovalGuideCard,
  type HookInvocationContext,
  type IslandHookEvent,
  type RiskLevel
} from "@prismux/protocol";

export interface ApprovalIslandCardInput {
  cardId?: string;
  requestId: string;
  threadId?: string;
  sessionId?: string;
  approvalGuide: ApprovalGuideCard;
  title?: string;
  subtitle?: string;
  deepLink?: string;
  createdAt?: number;
}

export interface EmailAlertInput {
  cardId?: string;
  messageId: string;
  from: string;
  subject: string;
  snippet?: string;
  importance?: "high" | "normal";
  threadId?: string;
  deepLink?: string;
  receivedAt?: number;
}

export interface FactoryCompleteCardInput {
  cardId?: string;
  jobId: string;
  threadId: string;
  branchName?: string;
  summary: string;
  changedFilesCount?: number;
  reviewComments?: string[];
  deepLink?: string;
  completedAt?: number;
}

const RISK_LABEL_ZH: Record<RiskLevel, string> = {
  low: "低危",
  medium: "中危",
  high: "高危"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === "low" || value === "medium" || value === "high";
}

function buildDefaultApprovalDeepLink(requestId: string): string {
  return `${BRAND.uriScheme}://approval/${encodeURIComponent(requestId)}`;
}

export function buildFactoryReviewDeepLink(threadId: string): string {
  return `${BRAND.uriScheme}://review/${encodeURIComponent(threadId)}`;
}

/**
 * Backward-compatible factory creating an `approval` Dynamic Island card.
 */
export function createApprovalIslandCard(options: {
  cardId: string;
  title: string;
  subtitle?: string;
  riskLevel?: RiskLevel;
  approvalGuide?: ApprovalGuideCard;
  deepLink?: string;
  createdAt?: number;
}): IslandHookEvent {
  const riskLevel = options.riskLevel ?? options.approvalGuide?.riskLevel;
  const subtitle = options.subtitle ?? options.approvalGuide?.triggerReason;
  return {
    cardId: options.cardId,
    kind: "approval",
    title: options.title,
    ...(subtitle !== undefined ? { subtitle } : {}),
    ...(riskLevel !== undefined ? { riskLevel } : {}),
    ...(options.approvalGuide !== undefined
      ? { approvalGuide: options.approvalGuide }
      : {}),
    ...(options.deepLink !== undefined ? { deepLink: options.deepLink } : {}),
    actions: ["approve", "reject", "open_workbench"],
    createdAt: options.createdAt ?? Date.now()
  };
}

/**
 * Converts a `PreToolUse` Chinese `ApprovalGuideCard` into a Dynamic Island `approval` card.
 */
export function createApprovalCardFromGuide(
  input: ApprovalIslandCardInput
): IslandHookEvent {
  const cardId = input.cardId ?? `island-approval-${input.requestId}`;
  const riskLabel = RISK_LABEL_ZH[input.approvalGuide.riskLevel];
  const title =
    input.title ?? `【${riskLabel}审批】${input.approvalGuide.actionSummary}`;
  const subtitle = input.subtitle ?? input.approvalGuide.triggerReason;
  const deepLink = input.deepLink ?? buildDefaultApprovalDeepLink(input.requestId);

  return createApprovalIslandCard({
    cardId,
    title,
    subtitle,
    riskLevel: input.approvalGuide.riskLevel,
    approvalGuide: { ...input.approvalGuide },
    deepLink,
    createdAt: input.createdAt
  });
}

/**
 * Converts an important email alert into a Dynamic Island `email` card.
 */
export function createEmailIslandCard(input: EmailAlertInput): IslandHookEvent {
  const cardId = input.cardId ?? `island-email-${input.messageId}`;
  const prefix = input.importance === "high" ? "重要邮件" : "邮件提醒";
  const title = `${prefix}：${input.subject}`;
  const snippetPart =
    input.snippet !== undefined && input.snippet.trim().length > 0
      ? ` · ${input.snippet.trim()}`
      : "";
  const subtitle = `发件人：${input.from}${snippetPart}`;
  const deepLink =
    input.deepLink ??
    (input.threadId !== undefined && input.threadId.length > 0
      ? `${BRAND.uriScheme}://thread/${encodeURIComponent(input.threadId)}`
      : `${BRAND.uriScheme}://email/${encodeURIComponent(input.messageId)}`);

  return {
    cardId,
    kind: "email",
    title,
    subtitle,
    ...(input.importance === "high" ? { riskLevel: "medium" as const } : {}),
    deepLink,
    actions: ["open_workbench", "dismiss"],
    createdAt: input.receivedAt ?? Date.now()
  };
}

/**
 * Converts an Overnight Factory morning report into a Dynamic Island `factory_complete` card
 * carrying the canonical `prismux://review/<threadId>` deep link.
 */
export function createFactoryCompleteIslandCard(
  input: FactoryCompleteCardInput
): IslandHookEvent {
  const cardId = input.cardId ?? `island-factory-${input.jobId}`;
  const branchSuffix =
    input.branchName !== undefined && input.branchName.trim().length > 0
      ? `（分支：${input.branchName.trim()}）`
      : "";
  const filesSuffix =
    input.changedFilesCount !== undefined
      ? ` · 变更 ${input.changedFilesCount} 个文件`
      : "";
  const subtitle = `${input.summary}${branchSuffix}${filesSuffix}`;
  const deepLink = input.deepLink ?? buildFactoryReviewDeepLink(input.threadId);

  return {
    cardId,
    kind: "factory_complete",
    title: `${BRAND.appName} 夜间工场已完工`,
    subtitle,
    deepLink,
    actions: ["open_workbench", "dismiss"],
    createdAt: input.completedAt ?? Date.now()
  };
}

/**
 * Extracts an existing `ApprovalGuideCard` from hook input or synthesizes a Chinese fallback card.
 */
export function translateHookContextToApprovalGuide(
  context: HookInvocationContext
): ApprovalGuideCard {
  const input = context.toolInput;
  if (isRecord(input) && isRecord(input.approvalGuide)) {
    const candidate = input.approvalGuide;
    if (
      typeof candidate.toolName === "string" &&
      typeof candidate.actionSummary === "string" &&
      isRiskLevel(candidate.riskLevel) &&
      typeof candidate.triggerReason === "string"
    ) {
      return {
        toolName: candidate.toolName,
        actionSummary: candidate.actionSummary,
        riskLevel: candidate.riskLevel,
        triggerReason: candidate.triggerReason,
        ...(typeof candidate.rawCommandOrTarget === "string"
          ? { rawCommandOrTarget: candidate.rawCommandOrTarget }
          : {})
      };
    }
  }

  const toolName = context.toolName ?? "unknown_tool";
  const rawTarget = extractRawTarget(input);
  const targetLower = `${toolName} ${rawTarget ?? ""}`.toLowerCase();

  if (
    /\b(?:rm\s+-rf|remove-item\s+-recurse\s+-force|git\s+push\s+--force|git\s+reset\s+--hard|mkfs|dd\s+if=|chmod\s+0?777)\b/i.test(
      targetLower
    ) ||
    /(?:\.env|\.ssh|credentials|id_rsa|id_ed25519|\.npmrc)/i.test(targetLower)
  ) {
    return {
      toolName,
      actionSummary: `准备执行高危操作（${toolName}）`,
      riskLevel: "high",
      triggerReason: `命中高危规则（模式：${context.permissionMode}）`,
      ...(rawTarget !== undefined ? { rawCommandOrTarget: rawTarget } : {})
    };
  }

  const normalizedTool = toolName.trim().toLowerCase();
  const isReadOnly =
    normalizedTool.startsWith("read") ||
    normalizedTool.startsWith("view") ||
    normalizedTool.startsWith("list") ||
    normalizedTool.startsWith("search") ||
    normalizedTool.startsWith("grep");

  if (isReadOnly) {
    return {
      toolName,
      actionSummary: `准备只读查询上下文（${toolName}）`,
      riskLevel: "low",
      triggerReason: `只读操作判定（模式：${context.permissionMode}）`,
      ...(rawTarget !== undefined ? { rawCommandOrTarget: rawTarget } : {})
    };
  }

  return {
    toolName,
    actionSummary: `准备通过工具 ${toolName} 变更工作区或执行命令`,
    riskLevel: "medium",
    triggerReason: `受控模式下需要人工确认放行（模式：${context.permissionMode}）`,
    ...(rawTarget !== undefined ? { rawCommandOrTarget: rawTarget } : {})
  };
}

function extractRawTarget(
  input: Record<string, unknown> | undefined
): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const keys = [
    "command",
    "cmd",
    "CommandLine",
    "filePath",
    "file_path",
    "path",
    "url",
    "target"
  ];
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}
