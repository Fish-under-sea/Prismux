import {
  DEFAULT_SECURITY_HOOK_FAILURE_POLICY,
  type ApprovalGuideCard,
  type HookExecutionResult,
  type HookFailurePolicy,
  type HookHandlerConfig,
  type HookInvocationContext,
  type LifecycleHookEvent,
  type PermissionMode
} from "@prismux/protocol";

export type HookHandlerFn = (
  context: HookInvocationContext
) => Promise<HookExecutionResult | void> | HookExecutionResult | void;

export interface RegisteredHookEntry {
  config: HookHandlerConfig;
  handler: HookHandlerFn;
}

/**
 * Deterministic lifecycle hook bus (SessionStart, PreToolUse, PostToolUse, Notification, SubagentStop, Stop).
 * Security-critical hooks default to `onFailure: "block"`, and exit code 2 feeds stderr back to the agent.
 */
export class LifecycleHookBus {
  private readonly handlers = new Map<
    LifecycleHookEvent,
    RegisteredHookEntry[]
  >();
  private permissionMode: PermissionMode = "supervised";

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
  }

  register(config: HookHandlerConfig, handler: HookHandlerFn): () => void {
    const resolvedConfig: HookHandlerConfig = {
      ...config,
      onFailure: config.securityCritical
        ? "block"
        : (config.onFailure ?? DEFAULT_SECURITY_HOOK_FAILURE_POLICY)
    };
    const list = this.handlers.get(resolvedConfig.event) ?? [];
    const entry: RegisteredHookEntry = { config: resolvedConfig, handler };
    list.push(entry);
    this.handlers.set(resolvedConfig.event, list);

    return () => {
      const current = this.handlers.get(resolvedConfig.event);
      if (current === undefined) {
        return;
      }
      this.handlers.set(
        resolvedConfig.event,
        current.filter((item) => item !== entry)
      );
    };
  }

  translatePreToolApproval(context: HookInvocationContext): ApprovalGuideCard {
    const toolName = context.toolName ?? "unknown_tool";
    return {
      toolName,
      actionSummary: `即将调用工具 ${toolName}`,
      riskLevel: context.permissionMode === "auto" ? "low" : "medium",
      triggerReason: `命中 ${context.event}（权限模式：${context.permissionMode}）`
    };
  }

  async emit(context: HookInvocationContext): Promise<HookExecutionResult> {
    const entries = this.handlers.get(context.event) ?? [];
    for (const entry of entries) {
      const failurePolicy: HookFailurePolicy = entry.config.securityCritical
        ? "block"
        : entry.config.onFailure;
      try {
        const result = await entry.handler(context);
        if (result === undefined) {
          continue;
        }
        if (result.exitCode === 2 || result.decision === "block") {
          return {
            ...result,
            decision: "block",
            approvalGuide:
              result.approvalGuide ??
              (context.event === "PreToolUse"
                ? this.translatePreToolApproval(context)
                : undefined)
          };
        }
        if (result.decision === "modify") {
          return result;
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        if (failurePolicy === "block") {
          return {
            decision: "block",
            exitCode: 2,
            feedback: `Hook ${entry.config.id} failed under fail-closed policy: ${message}`,
            failurePolicyApplied: "block"
          };
        }
      }
    }

    return {
      decision: "allow",
      exitCode: 0
    };
  }
}
