export const LIFECYCLE_HOOK_EVENTS = [
  "SessionStart",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "SubagentStop",
  "Stop"
] as const;

export type LifecycleHookEvent = (typeof LIFECYCLE_HOOK_EVENTS)[number];

export const HOOK_FAILURE_POLICIES = ["block", "warn", "ignore"] as const;

export type HookFailurePolicy = (typeof HOOK_FAILURE_POLICIES)[number];

export const DEFAULT_SECURITY_HOOK_FAILURE_POLICY: HookFailurePolicy = "block";

export const PERMISSION_MODES = [
  "plan",
  "acceptEdits",
  "auto",
  "supervised"
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export type RiskLevel = "low" | "medium" | "high";

export interface ApprovalGuideCard {
  toolName: string;
  actionSummary: string;
  riskLevel: RiskLevel;
  triggerReason: string;
  rawCommandOrTarget?: string;
}

export interface HookHandlerConfig {
  id: string;
  event: LifecycleHookEvent;
  onFailure: HookFailurePolicy;
  timeoutMs: number;
  securityCritical?: boolean;
  command?: string;
}

export interface HookInvocationContext {
  event: LifecycleHookEvent;
  sessionId: string;
  threadId: string;
  permissionMode: PermissionMode;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  timestamp: number;
}

export type HookDecision = "allow" | "block" | "modify";

export interface HookExecutionResult {
  decision: HookDecision;
  exitCode: number;
  feedback?: string;
  modifiedInput?: Record<string, unknown>;
  approvalGuide?: ApprovalGuideCard;
  failurePolicyApplied?: HookFailurePolicy;
}
