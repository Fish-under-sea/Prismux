export const DISPATCH_CALLER_KINDS = [
  "human_desktop",
  "antigravity_commander",
  "secretary_qq",
  "secretary_gmail",
  "overnight_factory",
  "cron",
  "agent_subtask",
  "internal_script",
  "post_stop_loop"
] as const;

export type DispatchCallerKind = (typeof DISPATCH_CALLER_KINDS)[number];

export const DISPATCH_TASK_CATEGORIES = [
  "backend_standard",
  "backend_hard",
  "frontend",
  "planning",
  "general"
] as const;

export type DispatchTaskCategory = (typeof DISPATCH_TASK_CATEGORIES)[number];

export const DISPATCH_REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "default"
] as const;

export type DispatchReasoningEffort =
  (typeof DISPATCH_REASONING_EFFORTS)[number];

export const DISPATCH_MODES = ["send", "draft_only"] as const;

export type DispatchMode = (typeof DISPATCH_MODES)[number];

export const DISPATCH_TASK_STATUSES = [
  "queued",
  "dispatched",
  "running",
  "awaiting_human_confirmation",
  "confirmed_sent",
  "completed",
  "cancelled",
  "failed",
  "denied"
] as const;

export type DispatchTaskStatus = (typeof DISPATCH_TASK_STATUSES)[number];

export const ANTIGRAVITY_DISCLAIMER_VERSION = "v3-2026" as const;

export type AntigravityGuardErrorCode =
  | "AGY_DISCLAIMER_REQUIRED"
  | "AGY_UNATTENDED_FORBIDDEN"
  | "AGY_CONTROLLED_AGENT_LOCKED"
  | "AGY_HUMAN_CONFIRMATION_REQUIRED";

export type AntigravityGuardDecisionKind =
  | "allow"
  | "stage_draft_only"
  | "deny";

export interface AntigravityPolicyRecord {
  allowAntigravityAsControlledAgent: boolean;
  disclaimerAcceptedAt: string | null;
  disclaimerVersion: string | null;
}

export interface AntigravityPolicyResponse extends AntigravityPolicyRecord {
  defaultLocked: true;
}

export interface AntigravityPolicyUpdateRequest {
  allowAntigravityAsControlledAgent: boolean;
  disclaimerAccepted?: boolean;
  disclaimerVersion?: string;
}

export interface AntigravityGuardDecision {
  allowed: boolean;
  decision: AntigravityGuardDecisionKind;
  mode: DispatchMode;
  status: "dispatched" | "awaiting_human_confirmation" | "denied";
  requiresHumanConfirmation: boolean;
  httpStatus: 200 | 202 | 403;
  code?: AntigravityGuardErrorCode;
  reason: string;
  targetIsAntigravity: boolean;
}

export interface DispatchReplyChannel {
  kind: "desktop" | "qq" | "gmail" | "overnight_factory" | "webhook";
  targetId?: string;
  recipient?: string;
  inReplyTo?: string;
  threadId?: string;
  label?: string;
}

export interface DispatchArtifactDiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface DispatchTaskArtifact {
  taskId: string;
  threadId: string;
  workspacePath: string;
  finalAssistantText: string;
  modifiedFiles: string[];
  diffStats: DispatchArtifactDiffStats;
  plainLanguageSummary: string;
  extractedAt: string;
  provider?: string;
  modelId?: string;
  branchName?: string;
  commitSha?: string;
  testPassed?: boolean;
}

export interface PrismuxDispatchEnvelope {
  taskId: string;
  status: DispatchTaskStatus;
  mode: DispatchMode;
  workspacePath: string;
  worktreePath?: string;
  branchName?: string;
  prompt: string;
  provider: string;
  modelId: string;
  reasoningEffort: DispatchReasoningEffort;
  callerKind: DispatchCallerKind;
  taskCategory?: DispatchTaskCategory;
  createdAt: string;
  updatedAt?: string;
  requiresHumanConfirmation: boolean;
  confirmationReason?: string;
  memoryContextSummary?: string;
  replyChannel?: DispatchReplyChannel;
  threadId?: string;
  confirmedBy?: string;
  confirmedAt?: string;
  cancelledAt?: string;
  completedAt?: string;
  artifact?: DispatchTaskArtifact;
}

export interface DispatchThreadRequest {
  taskId?: string;
  prompt: string;
  workspacePath: string;
  worktreePath?: string;
  branchName?: string;
  callerKind: DispatchCallerKind;
  taskCategory?: DispatchTaskCategory;
  provider?: string;
  modelId?: string;
  reasoningEffort?: DispatchReasoningEffort;
  explicitAntigravityRequested?: boolean;
  memoryContextSummary?: string;
  replyChannel?: DispatchReplyChannel;
  threadId?: string;
  metadata?: Record<string, unknown>;
}

export interface DispatchThreadResponse {
  ok: true;
  decision: AntigravityGuardDecision;
  envelope: PrismuxDispatchEnvelope;
  deliveredToListeners: number;
  queuedForRenderer: boolean;
}

export interface DispatchConfirmRequest {
  confirmedBy: string;
}

export interface DispatchConfirmResponse {
  ok: true;
  taskId: string;
  envelope: PrismuxDispatchEnvelope;
}

export interface DispatchCancelRequest {
  reason?: string;
}

export interface DispatchCancelResponse {
  ok: true;
  taskId: string;
  envelope: PrismuxDispatchEnvelope;
}

export interface DispatchCompleteRequest {
  threadId?: string;
  workspacePath?: string;
  finalAssistantText?: string;
  modifiedFiles?: string[];
  diffStats?: DispatchArtifactDiffStats;
  branchName?: string;
  commitSha?: string;
  testPassed?: boolean;
  baseRef?: string;
  skipGitInspection?: boolean;
  callbackTargetProvider?: string;
  humanConfirmed?: boolean;
}

export interface DispatchCompleteResponse {
  ok: true;
  taskId: string;
  envelope: PrismuxDispatchEnvelope;
  artifact: DispatchTaskArtifact;
  directReplyText: string;
}

export interface DispatchTaskListResponse {
  ok: true;
  tasks: PrismuxDispatchEnvelope[];
  total: number;
  awaitingConfirmationCount: number;
}

export type DispatchSseEventName =
  | "connected"
  | "dispatch_thread"
  | "dispatch_confirmed"
  | "dispatch_cancelled"
  | "dispatch_completed";

export function isDispatchCallerKind(value: unknown): value is DispatchCallerKind {
  return (
    typeof value === "string" &&
    (DISPATCH_CALLER_KINDS as readonly string[]).includes(value)
  );
}

export function isDispatchTaskCategory(
  value: unknown
): value is DispatchTaskCategory {
  return (
    typeof value === "string" &&
    (DISPATCH_TASK_CATEGORIES as readonly string[]).includes(value)
  );
}

export function isDispatchReasoningEffort(
  value: unknown
): value is DispatchReasoningEffort {
  return (
    typeof value === "string" &&
    (DISPATCH_REASONING_EFFORTS as readonly string[]).includes(value)
  );
}

const ANTIGRAVITY_PROVIDER_RE =
  /^(?:antigravity(?:[-_:\s].*)?|agy(?:[-_:\s].*)?|google[-_\s]?antigravity|personal[-_\s]?(?:antigravity|agy))$/i;

/**
 * Identifies whether a provider string refers to personal Antigravity (AGY).
 * Note: standalone Gemini API (`gemini`, `gemini-api`) is explicitly NOT personal Antigravity.
 */
export function isAntigravityProvider(provider: unknown): boolean {
  if (typeof provider !== "string") {
    return false;
  }
  const normalized = provider.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  return ANTIGRAVITY_PROVIDER_RE.test(normalized);
}
