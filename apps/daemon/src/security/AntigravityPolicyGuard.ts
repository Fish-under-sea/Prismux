import {
  isAntigravityProvider,
  type AntigravityGuardDecision,
  type AntigravityGuardErrorCode,
  type AntigravityPolicyResponse,
  type DispatchCallerKind
} from "@prismux/protocol";
import { AntigravityPolicyStore } from "./AntigravityPolicyStore.js";

export interface AntigravityGuardEvaluationInput {
  callerKind: DispatchCallerKind;
  targetProvider: string;
  targetModelId?: string;
  explicitAntigravityRequested?: boolean;
  isStopHookCallback?: boolean;
  humanConfirmed?: boolean;
}

export class AntigravityGuardDeniedError extends Error {
  readonly statusCode: 403;
  readonly code: AntigravityGuardErrorCode;
  readonly decision?: AntigravityGuardDecision;

  constructor(
    code: AntigravityGuardErrorCode,
    message: string,
    decision?: AntigravityGuardDecision
  ) {
    super(message);
    this.name = "AntigravityGuardDeniedError";
    this.statusCode = 403;
    this.code = code;
    this.decision = decision;
  }
}

const UNATTENDED_CALLER_KINDS: ReadonlySet<DispatchCallerKind> = new Set([
  "cron",
  "overnight_factory"
]);

const REMOTE_SECRETARY_CALLER_KINDS: ReadonlySet<DispatchCallerKind> = new Set([
  "secretary_qq",
  "secretary_gmail"
]);

const CONTROLLED_AUTOMATION_CALLER_KINDS: ReadonlySet<DispatchCallerKind> =
  new Set([
    "agent_subtask",
    "internal_script",
    "post_stop_loop",
    "antigravity_commander"
  ]);

/**
 * Central role hard-lock guard protecting personal Antigravity (AGY) accounts:
 * 1. Human desktop (`human_desktop`) commanding AGY, OR AGY dispatching outward to Codex/Claude/OpenCode/DSH -> 100% ALLOWED (`mode: "send"`).
 * 2. Unattended loops (`cron` / `overnight_factory`) targeting personal AGY -> ALWAYS hard-denied (`AGY_UNATTENDED_FORBIDDEN`, HTTP 403), even if controlled toggle is ON.
 * 3. Remote secretaries (`secretary_qq` / `secretary_gmail`) explicitly requesting personal AGY -> NEVER auto-send; forced `stage_draft_only` (`mode: "draft_only"`, `requiresHumanConfirmation: true`, `status: "awaiting_human_confirmation"`).
 * 4. Other AI agents / scripts / post-stop loops (`agent_subtask` / `internal_script` / `post_stop_loop`) targeting personal AGY -> hard-denied (`AGY_CONTROLLED_AGENT_LOCKED`, HTTP 403) when default lock is active; Stop-hook callbacks NEVER auto-re-invoke personal AGY without explicit human confirmation!
 */
export class AntigravityPolicyGuard {
  private readonly store: AntigravityPolicyStore;

  constructor(store?: AntigravityPolicyStore) {
    this.store = store ?? new AntigravityPolicyStore();
  }

  getPolicy(): AntigravityPolicyResponse {
    return this.store.getPolicy();
  }

  evaluateDispatch(
    input: AntigravityGuardEvaluationInput
  ): AntigravityGuardDecision {
    const targetIsAntigravity = isAntigravityProvider(input.targetProvider);

    // 1. Any non-AGY worker target (Codex / Claude Code / OpenCode / DSH / Gemini API) is 100% allowed.
    if (!targetIsAntigravity) {
      return {
        allowed: true,
        decision: "allow",
        mode: "send",
        status: "dispatched",
        requiresHumanConfirmation: false,
        httpStatus: 200,
        reason: `Dispatch from "${input.callerKind}" to automated worker "${input.targetProvider}" is allowed.`,
        targetIsAntigravity: false
      };
    }

    // 2. Unattended 24h loops (Cron / OvernightFactory) MUST NEVER wake personal AGY under any setting.
    if (UNATTENDED_CALLER_KINDS.has(input.callerKind)) {
      return {
        allowed: false,
        decision: "deny",
        mode: "draft_only",
        status: "denied",
        requiresHumanConfirmation: false,
        httpStatus: 403,
        code: "AGY_UNATTENDED_FORBIDDEN",
        reason:
          "24h 无人值守任务（Cron / OvernightFactory）严禁自动唤醒个人版 Antigravity（AGY），即使受控开关已解锁也强制拦截；请改用 Codex / Claude Code / OpenCode。",
        targetIsAntigravity: true
      };
    }

    const policy = this.store.getPolicy();

    // 3. Stop-hook auto-callback guard: NEVER auto-callback/re-invoke personal AGY on Stop hook without human confirmation.
    if (
      (input.isStopHookCallback === true ||
        input.callerKind === "post_stop_loop") &&
      input.humanConfirmed !== true
    ) {
      const code: AntigravityGuardErrorCode =
        policy.allowAntigravityAsControlledAgent
          ? "AGY_HUMAN_CONFIRMATION_REQUIRED"
          : "AGY_CONTROLLED_AGENT_LOCKED";
      return {
        allowed: false,
        decision: "deny",
        mode: "draft_only",
        status: "denied",
        requiresHumanConfirmation: true,
        httpStatus: 403,
        code,
        reason:
          "禁止在子任务 Stop 钩子或跨代理自动闭环中未经人工确认回调个人版 Antigravity（AGY）。",
        targetIsAntigravity: true
      };
    }

    // 4. Remote secretary (QQ / Gmail) requesting personal AGY -> NEVER auto-send; stage Draft-Only!
    if (REMOTE_SECRETARY_CALLER_KINDS.has(input.callerKind)) {
      return {
        allowed: true,
        decision: "stage_draft_only",
        mode: "draft_only",
        status: "awaiting_human_confirmation",
        requiresHumanConfirmation: true,
        httpStatus: 202,
        reason:
          "远程秘书请求调用个人版 Antigravity（AGY）：已允许召回记忆并准备隔离 Worktree 草稿，硬锁定为 Draft-Only，必须由本人在桌面端手动点击确认放行。",
        targetIsAntigravity: true
      };
    }

    // 5. Other AI agents / scripts / AGY self-loop targeting personal AGY -> blocked unless disclaimer-unlocked.
    if (CONTROLLED_AUTOMATION_CALLER_KINDS.has(input.callerKind)) {
      if (!policy.allowAntigravityAsControlledAgent) {
        return {
          allowed: false,
          decision: "deny",
          mode: "draft_only",
          status: "denied",
          requiresHumanConfirmation: false,
          httpStatus: 403,
          code: "AGY_CONTROLLED_AGENT_LOCKED",
          reason:
            "个人版 Antigravity（AGY）默认锁定为「仅总控模式」，禁止其他 AI 代理或内部脚本作为受控节点自动调用；如需解锁请在设置中签署风险免责声明。",
          targetIsAntigravity: true
        };
      }
      return {
        allowed: true,
        decision: "allow",
        mode: "send",
        status: "dispatched",
        requiresHumanConfirmation: false,
        httpStatus: 200,
        reason: `Controlled-agent unlock disclaimer (${policy.disclaimerVersion ?? "signed"}) is active; allowing dispatch from "${input.callerKind}".`,
        targetIsAntigravity: true
      };
    }

    // 6. Human desktop directly commanding personal AGY as commander -> 100% ALLOWED.
    if (input.callerKind === "human_desktop") {
      return {
        allowed: true,
        decision: "allow",
        mode: "send",
        status: "dispatched",
        requiresHumanConfirmation: false,
        httpStatus: 200,
        reason:
          "Human desktop commander invocation of Antigravity (AGY) is allowed.",
        targetIsAntigravity: true
      };
    }

    // Fail-closed fallback for any unknown caller kind targeting AGY.
    return {
      allowed: false,
      decision: "deny",
      mode: "draft_only",
      status: "denied",
      requiresHumanConfirmation: false,
      httpStatus: 403,
      code: "AGY_CONTROLLED_AGENT_LOCKED",
      reason: `Unrecognized callerKind "${String(input.callerKind)}" is blocked from targeting Antigravity.`,
      targetIsAntigravity: true
    };
  }

  /**
   * Enforces that only an explicit human desktop confirmation (`confirmedBy === "human_desktop"`)
   * may release a staged Draft-Only personal Antigravity dispatch.
   */
  assertHumanDesktopConfirmation(confirmedBy: unknown): "human_desktop" {
    if (confirmedBy !== "human_desktop") {
      throw new AntigravityGuardDeniedError(
        "AGY_HUMAN_CONFIRMATION_REQUIRED",
        `仅允许桌面端本人确认放行（confirmedBy 必须为 "human_desktop"，收到 "${String(confirmedBy ?? "")}"）。`
      );
    }
    return "human_desktop";
  }

  /**
   * Stop-hook safety guard: verifies whether an automated post-Stop callback may target a provider.
   * Personal Antigravity (AGY) MUST NEVER be auto-re-invoked on Stop hook without human confirmation.
   */
  evaluateStopHookCallback(
    targetProvider: string,
    options?: { humanConfirmed?: boolean }
  ): AntigravityGuardDecision {
    return this.evaluateDispatch({
      callerKind: "post_stop_loop",
      targetProvider,
      isStopHookCallback: true,
      humanConfirmed: options?.humanConfirmed === true
    });
  }
}
