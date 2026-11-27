import {
  CANONICAL_PROVIDER_DISPLAY_NAMES,
  SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE,
  SUBSCRIPTION_WAIVER_SETTINGS_ROUTE,
  isAntigravityProvider,
  resolveCanonicalProviderDisplayName,
  type AntigravityGuardDecision,
  type AntigravityGuardErrorCode,
  type AntigravityPolicyResponse,
  type DispatchCallerKind,
  type PrismuxProviderProbeSnapshot,
  type ProviderAuthMode,
  type SubscriptionOrchestrationBlockedPayload,
  type SubscriptionOrchestrationBlockedReasonCode,
  type SubscriptionWaiverResponse,
} from "@prismux/protocol";
import {
  AUTH_LABEL_API_CUSTOM,
  AUTH_LABEL_LOCAL_RUNTIME,
  AUTH_LABEL_SUBSCRIPTION_OAUTH,
  canonicalizeProbeProviderId,
  type PrismuxProviderProbeService,
} from "../system/PrismuxProviderProbeService.js";
import { SubscriptionWaiverStore } from "./AntigravityPolicyStore.js";

export type GuardProbeSnapshotOverride = Partial<
  Pick<
    PrismuxProviderProbeSnapshot,
    "providerId" | "authMode" | "authSource" | "authLabel" | "endpoint"
  >
>;

export interface AntigravityGuardEvaluationInput {
  callerKind: DispatchCallerKind;
  targetProvider: string;
  targetModelId?: string;
  explicitAntigravityRequested?: boolean;
  isStopHookCallback?: boolean;
  humanConfirmed?: boolean;
  /** Optional explicit probe snapshot override for deterministic tests or pre-resolved auth state. */
  probeSnapshot?: GuardProbeSnapshotOverride | null;
}

export type SubscriptionGuardEvaluationInput = AntigravityGuardEvaluationInput;

export interface SubscriptionOrchestrationGuardOptions {
  store?: SubscriptionWaiverStore;
  probeService?: PrismuxProviderProbeService;
}

export class AntigravityGuardDeniedError extends Error {
  readonly statusCode: 403;
  readonly code: AntigravityGuardErrorCode;
  readonly reasonCode?: SubscriptionOrchestrationBlockedReasonCode;
  readonly providerId?: string;
  readonly authMode?: ProviderAuthMode;
  readonly authLabel?: string;
  readonly settingsRoute?: typeof SUBSCRIPTION_WAIVER_SETTINGS_ROUTE;
  readonly decision?: AntigravityGuardDecision;

  constructor(
    code: AntigravityGuardErrorCode,
    message: string,
    decision?: AntigravityGuardDecision,
  ) {
    super(message);
    this.name = "AntigravityGuardDeniedError";
    this.statusCode = 403;
    this.code = code;
    this.decision = decision;
    this.reasonCode = decision?.reasonCode;
    this.providerId = decision?.providerId;
    this.authMode = decision?.authMode;
    this.authLabel = decision?.authLabel;
    this.settingsRoute = decision?.settingsRoute;
  }

  toBlockedPayload(): SubscriptionOrchestrationBlockedPayload | null {
    if (
      this.code !== SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE ||
      !this.reasonCode ||
      !this.providerId
    ) {
      return null;
    }
    return {
      ok: false,
      code: SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE,
      reasonCode: this.reasonCode,
      providerId: this.providerId,
      authMode: "subscription_oauth",
      authLabel: this.authLabel ?? AUTH_LABEL_SUBSCRIPTION_OAUTH,
      settingsRoute: this.settingsRoute ?? SUBSCRIPTION_WAIVER_SETTINGS_ROUTE,
      message: this.message,
    };
  }
}

export class SubscriptionOrchestrationBlockedError extends AntigravityGuardDeniedError {
  constructor(message: string, decision: AntigravityGuardDecision) {
    super(SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE, message, decision);
    this.name = "SubscriptionOrchestrationBlockedError";
  }
}

const UNATTENDED_CALLER_KINDS: ReadonlySet<DispatchCallerKind> = new Set([
  "cron",
  "overnight_factory",
]);

const REMOTE_SECRETARY_CALLER_KINDS: ReadonlySet<DispatchCallerKind> = new Set([
  "secretary_qq",
  "secretary_gmail",
]);

const CONTROLLED_AUTOMATION_CALLER_KINDS: ReadonlySet<DispatchCallerKind> = new Set([
  "agent_subtask",
  "swarm",
  "internal_script",
  "post_stop_loop",
  "antigravity_commander",
]);

const EXTERNAL_SWARM_OR_CROSS_AGENT_CALLERS: ReadonlySet<DispatchCallerKind> = new Set([
  "agent_subtask",
  "swarm",
  "internal_script",
  "secretary_qq",
  "secretary_gmail",
  "cron",
  "overnight_factory",
  "post_stop_loop",
  "antigravity_commander",
]);

function isWaiverStore(value: unknown): value is SubscriptionWaiverStore {
  return (
    value instanceof SubscriptionWaiverStore ||
    (typeof value === "object" &&
      value !== null &&
      typeof (value as SubscriptionWaiverStore).getWaiver === "function")
  );
}

/**
 * Central unified guard protecting personal subscription OAuth accounts across
 * Antigravity (AGY) and external agents (Codex / Claude Code / etc.):
 *
 * 1. `api_or_custom` / `local` (CCS / Magpie / API Key / DSH / OpenCode / `requiresOpenaiAuth === false`):
 *    100% ALLOWED with ZERO waiver required!
 * 2. Personal `antigravity` (`subscription_oauth`):
 *    - `human_desktop` -> 100% ALLOWED (`mode: "send"`).
 *    - `cron` / `overnight_factory` -> ALWAYS HTTP 403 `ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED` (`reasonCode: "AGY_UNATTENDED_FORBIDDEN"`).
 *    - `secretary_qq` / `secretary_gmail` -> ALWAYS forced `draft_only` (`awaiting_human_confirmation`).
 *    - Stop-hook callbacks without `humanConfirmed === true` -> ALWAYS HTTP 403 `ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED`.
 *    - Controlled automation (`agent_subtask` / `swarm` / `internal_script` / `antigravity_commander`) ->
 *      HTTP 403 `ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED` (`reasonCode: "AGY_CONTROLLED_AGENT_LOCKED"`)
 *      unless `waiver.signed && waiver.allowAntigravityAsControlledAgent`.
 * 3. External `subscription_oauth` agents (`codex` / `claudeAgent` / etc.):
 *    - `human_desktop` -> 100% ALLOWED.
 *    - Swarm / cross-agent / automated callers (`agent_subtask` / `swarm` / `internal_script` /
 *      `secretary_*` / `cron` / `overnight_factory` / `antigravity_commander` / `post_stop_loop`) ->
 *      HTTP 403 `ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED` (`reasonCode: "EXTERNAL_SUBSCRIPTION_SWARM_LOCKED"`)
 *      unless `waiver.signed && waiver.allowExternalSubscriptionAgentsInSwarm`.
 */
export class SubscriptionOrchestrationGuard {
  private readonly store: SubscriptionWaiverStore;
  private readonly probeService: PrismuxProviderProbeService | undefined;

  constructor(
    storeOrOptions?: SubscriptionWaiverStore | SubscriptionOrchestrationGuardOptions,
    options?: { probeService?: PrismuxProviderProbeService },
  ) {
    if (isWaiverStore(storeOrOptions)) {
      this.store = storeOrOptions;
      this.probeService = options?.probeService;
    } else {
      this.store = storeOrOptions?.store ?? new SubscriptionWaiverStore();
      this.probeService = storeOrOptions?.probeService ?? options?.probeService;
    }
  }

  getWaiver(): SubscriptionWaiverResponse {
    return this.store.getWaiver();
  }

  getPolicy(): AntigravityPolicyResponse {
    return this.store.getPolicy();
  }

  async evaluateDispatchAsync(
    input: AntigravityGuardEvaluationInput,
  ): Promise<AntigravityGuardDecision> {
    let resolvedProbe = input.probeSnapshot;
    if (resolvedProbe === undefined && this.probeService !== undefined) {
      resolvedProbe = await this.probeService.probeProvider(input.targetProvider);
    }
    return this.evaluateDispatch({
      ...input,
      probeSnapshot: resolvedProbe,
    });
  }

  evaluateDispatch(input: AntigravityGuardEvaluationInput): AntigravityGuardDecision {
    const canonicalProvider = canonicalizeProbeProviderId(input.targetProvider);
    const targetIsAntigravity = isAntigravityProvider(canonicalProvider);

    const resolvedProbe =
      input.probeSnapshot !== undefined
        ? input.probeSnapshot
        : this.probeService?.getCachedOrClassifySync(canonicalProvider);

    const authMode = this.resolveEffectiveAuthMode(
      canonicalProvider,
      targetIsAntigravity,
      resolvedProbe,
    );
    const authLabel =
      resolvedProbe?.authLabel ??
      (authMode === "subscription_oauth"
        ? AUTH_LABEL_SUBSCRIPTION_OAUTH
        : authMode === "local"
          ? AUTH_LABEL_LOCAL_RUNTIME
          : AUTH_LABEL_API_CUSTOM);

    // 1. API / Custom / CCS / Magpie / Local runtimes -> 100% ALLOWED with ZERO waiver!
    if (authMode === "api_or_custom" || authMode === "local") {
      return {
        allowed: true,
        decision: "allow",
        mode: "send",
        status: "dispatched",
        requiresHumanConfirmation: false,
        httpStatus: 200,
        providerId: canonicalProvider,
        authMode,
        authLabel,
        reason: `Provider "${canonicalProvider}" runs in "${authMode}" (${authLabel}); allowed without waiver.`,
        targetIsAntigravity,
      };
    }

    // 2. Non-Antigravity unauthenticated/unknown -> NEVER misclassify as subscription_oauth!
    if (!targetIsAntigravity && authMode !== "subscription_oauth") {
      return {
        allowed: true,
        decision: "allow",
        mode: "send",
        status: "dispatched",
        requiresHumanConfirmation: false,
        httpStatus: 200,
        providerId: canonicalProvider,
        authMode,
        authLabel,
        reason: `Dispatch from "${input.callerKind}" to worker "${canonicalProvider}" (${authMode}) is allowed.`,
        targetIsAntigravity: false,
      };
    }

    const waiver = this.store.getWaiver();

    // 3. Personal Antigravity (`subscription_oauth`) protection matrix
    if (targetIsAntigravity) {
      // 3a. Unattended 24h loops (Cron / OvernightFactory) MUST NEVER wake personal AGY under any waiver!
      if (UNATTENDED_CALLER_KINDS.has(input.callerKind)) {
        return {
          allowed: false,
          decision: "deny",
          mode: "draft_only",
          status: "denied",
          requiresHumanConfirmation: false,
          httpStatus: 403,
          code: SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE,
          reasonCode: "AGY_UNATTENDED_FORBIDDEN",
          providerId: "antigravity",
          authMode: "subscription_oauth",
          authLabel,
          settingsRoute: SUBSCRIPTION_WAIVER_SETTINGS_ROUTE,
          reason: `24h 无人值守任务（Cron / OvernightFactory）严禁自动唤醒个人版 Antigravity（AGY），即使受控开关已解锁也强制拦截；请改用 API 模式或 ${CANONICAL_PROVIDER_DISPLAY_NAMES.codex} / ${CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent} / ${CANONICAL_PROVIDER_DISPLAY_NAMES.opencode}。`,
          targetIsAntigravity: true,
        };
      }

      // 3b. Stop-hook auto-callback guard: NEVER auto-re-invoke personal AGY without human confirmation.
      if (
        (input.isStopHookCallback === true || input.callerKind === "post_stop_loop") &&
        input.humanConfirmed !== true
      ) {
        const reasonCode: SubscriptionOrchestrationBlockedReasonCode =
          waiver.signed && waiver.allowAntigravityAsControlledAgent
            ? "AGY_HUMAN_CONFIRMATION_REQUIRED"
            : "AGY_CONTROLLED_AGENT_LOCKED";
        return {
          allowed: false,
          decision: "deny",
          mode: "draft_only",
          status: "denied",
          requiresHumanConfirmation: true,
          httpStatus: 403,
          code: SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE,
          reasonCode,
          providerId: "antigravity",
          authMode: "subscription_oauth",
          authLabel,
          settingsRoute: SUBSCRIPTION_WAIVER_SETTINGS_ROUTE,
          reason:
            "禁止在子任务 Stop 钩子或跨代理自动闭环中未经人工确认回调个人版 Antigravity（AGY）。",
          targetIsAntigravity: true,
        };
      }

      // 3c. Remote secretary (QQ / Gmail) requesting personal AGY -> NEVER auto-send; forced Draft-Only!
      if (REMOTE_SECRETARY_CALLER_KINDS.has(input.callerKind)) {
        return {
          allowed: true,
          decision: "stage_draft_only",
          mode: "draft_only",
          status: "awaiting_human_confirmation",
          requiresHumanConfirmation: true,
          httpStatus: 202,
          providerId: "antigravity",
          authMode: "subscription_oauth",
          authLabel,
          reason:
            "远程秘书请求调用个人版 Antigravity（AGY）：已允许召回记忆并准备隔离 Worktree 草稿，硬锁定为 Draft-Only，必须由本人在桌面端手动点击确认放行。",
          targetIsAntigravity: true,
        };
      }

      // 3d. Controlled automation targeting personal AGY -> requires unified waiver + Switch A!
      if (CONTROLLED_AUTOMATION_CALLER_KINDS.has(input.callerKind)) {
        if (!(waiver.signed && waiver.allowAntigravityAsControlledAgent)) {
          return {
            allowed: false,
            decision: "deny",
            mode: "draft_only",
            status: "denied",
            requiresHumanConfirmation: false,
            httpStatus: 403,
            code: SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE,
            reasonCode: "AGY_CONTROLLED_AGENT_LOCKED",
            providerId: "antigravity",
            authMode: "subscription_oauth",
            authLabel,
            settingsRoute: SUBSCRIPTION_WAIVER_SETTINGS_ROUTE,
            reason:
              "当前 Antigravity (AGY) 运行在官方个人订阅模式，默认锁定为「仅总控模式」，禁止其他 AI 代理、蜂群或脚本作为受控节点自动调用；如需解锁请在设置中签署风险免责声明并开启受控开关。",
            targetIsAntigravity: true,
          };
        }
        return {
          allowed: true,
          decision: "allow",
          mode: "send",
          status: "dispatched",
          requiresHumanConfirmation: false,
          httpStatus: 200,
          providerId: "antigravity",
          authMode: "subscription_oauth",
          authLabel,
          reason: `Unified risk waiver (${waiver.waiverVersion ?? "signed"}) + Switch A active; allowing controlled Antigravity dispatch from "${input.callerKind}".`,
          targetIsAntigravity: true,
        };
      }

      // 3e. Human desktop directly commanding personal AGY -> 100% ALLOWED.
      if (input.callerKind === "human_desktop") {
        return {
          allowed: true,
          decision: "allow",
          mode: "send",
          status: "dispatched",
          requiresHumanConfirmation: false,
          httpStatus: 200,
          providerId: "antigravity",
          authMode: "subscription_oauth",
          authLabel,
          reason: "Human desktop commander invocation of Antigravity (AGY) is allowed.",
          targetIsAntigravity: true,
        };
      }

      // Fail-closed fallback for unrecognized caller targeting AGY.
      return {
        allowed: false,
        decision: "deny",
        mode: "draft_only",
        status: "denied",
        requiresHumanConfirmation: false,
        httpStatus: 403,
        code: SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE,
        reasonCode: "AGY_CONTROLLED_AGENT_LOCKED",
        providerId: "antigravity",
        authMode: "subscription_oauth",
        authLabel,
        settingsRoute: SUBSCRIPTION_WAIVER_SETTINGS_ROUTE,
        reason: `Unrecognized callerKind "${String(input.callerKind)}" is blocked from targeting Antigravity.`,
        targetIsAntigravity: true,
      };
    }

    // 4. External `subscription_oauth` agent (e.g. official ChatGPT Codex / Claude Code personal OAuth)
    if (input.callerKind === "human_desktop") {
      return {
        allowed: true,
        decision: "allow",
        mode: "send",
        status: "dispatched",
        requiresHumanConfirmation: false,
        httpStatus: 200,
        providerId: canonicalProvider,
        authMode: "subscription_oauth",
        authLabel,
        reason: `Direct human desktop session for "${canonicalProvider}" is allowed.`,
        targetIsAntigravity: false,
      };
    }

    if (
      EXTERNAL_SWARM_OR_CROSS_AGENT_CALLERS.has(input.callerKind) &&
      !(waiver.signed && waiver.allowExternalSubscriptionAgentsInSwarm)
    ) {
      return {
        allowed: false,
        decision: "deny",
        mode: "draft_only",
        status: "denied",
        requiresHumanConfirmation: false,
        httpStatus: 403,
        code: SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE,
        reasonCode: "EXTERNAL_SUBSCRIPTION_SWARM_LOCKED",
        providerId: canonicalProvider,
        authMode: "subscription_oauth",
        authLabel,
        settingsRoute: SUBSCRIPTION_WAIVER_SETTINGS_ROUTE,
        reason: `当前 ${resolveCanonicalProviderDisplayName(canonicalProvider)} 运行在官方个人订阅模式（${authLabel}），为避免违反厂商服务条款导致封号，默认禁止参与蜂群或跨代理自动化调用；若你使用 API Key 或 CCS / Magpie 注入 API 模式则不受限制，或前往设置签署风险免责声明并开启对应开关。`,
        targetIsAntigravity: false,
      };
    }

    return {
      allowed: true,
      decision: "allow",
      mode: "send",
      status: "dispatched",
      requiresHumanConfirmation: false,
      httpStatus: 200,
      providerId: canonicalProvider,
      authMode: "subscription_oauth",
      authLabel,
      reason: `Unified risk waiver (${waiver.waiverVersion ?? "signed"}) + Switch B active; allowing swarm/cross-agent dispatch to "${canonicalProvider}".`,
      targetIsAntigravity: false,
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
        `仅允许桌面端本人确认放行（confirmedBy 必须为 "human_desktop"，收到 "${String(confirmedBy ?? "")}"）。`,
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
    options?: {
      humanConfirmed?: boolean;
      probeSnapshot?: GuardProbeSnapshotOverride | null;
    },
  ): AntigravityGuardDecision {
    return this.evaluateDispatch({
      callerKind: "post_stop_loop",
      targetProvider,
      isStopHookCallback: true,
      humanConfirmed: options?.humanConfirmed === true,
      ...(options?.probeSnapshot !== undefined ? { probeSnapshot: options.probeSnapshot } : {}),
    });
  }

  private resolveEffectiveAuthMode(
    _canonicalProvider: string,
    targetIsAntigravity: boolean,
    probeSnapshot: GuardProbeSnapshotOverride | null | undefined,
  ): ProviderAuthMode {
    if (probeSnapshot?.authMode === "api_or_custom") {
      return "api_or_custom";
    }
    if (probeSnapshot?.authMode === "local") {
      return "local";
    }
    if (probeSnapshot?.authMode === "subscription_oauth") {
      return "subscription_oauth";
    }
    // Fail-closed invariant for personal Antigravity when no API override is detected.
    if (targetIsAntigravity) {
      return "subscription_oauth";
    }
    return probeSnapshot?.authMode ?? "unauthenticated";
  }
}

/**
 * Backward-compatible alias class extending `SubscriptionOrchestrationGuard`.
 */
export class AntigravityPolicyGuard extends SubscriptionOrchestrationGuard {}
