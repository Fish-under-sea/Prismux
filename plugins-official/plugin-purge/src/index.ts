import type {
  HookExecutionResult,
  HookInvocationContext,
  PluginContext,
  PluginManifest,
  PrismuxPluginModule
} from "@prismux/protocol";
import {
  PromptPurgeEngine,
  type PromptPurgeEngineOptions,
  type PromptSnapshotMetadata,
  type PurgePromptOptions
} from "./engine.js";
import type { PurgeRule } from "./rules.js";

export * from "./rules.js";
export * from "./engine.js";

export const manifest: PluginManifest = {
  id: "purge",
  version: "0.1.0",
  realms: ["daemon", "ui"],
  permissions: ["hooks:intercept", "ui:panel"],
  modelVisible: false,
  behaviors: {
    autostart: false
  }
};

export interface CreatePurgePluginOptions extends PromptPurgeEngineOptions {
  onEngineCreated?: (engine: PromptPurgeEngine) => void;
}

const PROMPT_INSPECT_FIELDS = [
  "prompt",
  "systemPrompt",
  "instruction",
  "content",
  "message",
  "query"
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function evaluateHookInputWithPurge(
  engine: PromptPurgeEngine,
  context: HookInvocationContext
): HookExecutionResult | undefined {
  const input = context.toolInput;
  if (!isRecord(input)) {
    return undefined;
  }

  const scopeId = `${context.sessionId}:${context.threadId}`;
  let hasRedaction = false;
  let modifiedInput: Record<string, unknown> | undefined;
  const feedbacks: string[] = [];

  for (const field of PROMPT_INSPECT_FIELDS) {
    const rawValue = input[field];
    if (typeof rawValue !== "string" || rawValue.length === 0) {
      continue;
    }

    const result = engine.purgePrompt(rawValue, {
      scopeId,
      source: `hook:${context.event}:${context.toolName ?? "unknown"}:${field}`
    });

    if (result.decision === "block" || result.decision === "rollback") {
      return {
        decision: "block",
        exitCode: 2,
        feedback:
          result.feedback ??
          `插件 @prismux/plugin-purge 已拦截字段 "${field}"`
      };
    }

    if (result.decision === "redact" && result.sanitizedPrompt !== null) {
      hasRedaction = true;
      if (modifiedInput === undefined) {
        modifiedInput = { ...input };
      }
      modifiedInput[field] = result.sanitizedPrompt;
      if (result.feedback !== undefined) {
        feedbacks.push(result.feedback);
      }
    }
  }

  if (hasRedaction && modifiedInput !== undefined) {
    return {
      decision: "modify",
      exitCode: 0,
      modifiedInput,
      feedback: feedbacks.join("; ")
    };
  }

  return undefined;
}

export function applyWithOptions(
  ctx: PluginContext,
  options: CreatePurgePluginOptions = {}
): PromptPurgeEngine {
  const engine = new PromptPurgeEngine(options);
  options.onEngineCreated?.(engine);

  ctx.logger.info("Initialized @prismux/plugin-purge", {
    realm: ctx.realm
  });

  if (ctx.realm === "ui") {
    ctx.registerPanel?.("purge-workbench", {
      title: "红队提示词清洗与回滚工作台"
    });
    ctx.effect(() => {
      engine.dispose();
      ctx.logger.info("Disposed @prismux/plugin-purge UI panel");
    });
    return engine;
  }

  ctx.onHook?.("PreToolUse", (hookContext) => {
    if (engine.isDisposed()) {
      return undefined;
    }
    return evaluateHookInputWithPurge(engine, hookContext);
  });

  ctx.registerRoute?.(
    "POST",
    "/plugins/purge/sanitize",
    (payload: { prompt: string; options?: PurgePromptOptions }) => {
      return engine.purgePrompt(payload.prompt, payload.options);
    }
  );

  ctx.registerRoute?.(
    "POST",
    "/plugins/purge/snapshots",
    (payload: { prompt: string; metadata?: PromptSnapshotMetadata }) => {
      return engine.createSnapshot(payload.prompt, payload.metadata);
    }
  );

  ctx.registerRoute?.(
    "POST",
    "/plugins/purge/rollback",
    (payload: { snapshotId: string; reason?: string }) => {
      return engine.rollbackToSnapshot(payload.snapshotId, payload.reason);
    }
  );

  ctx.registerRoute?.(
    "GET",
    "/plugins/purge/audit",
    (payload?: { scopeId?: string; limit?: number }) => ({
      snapshots: engine.listSnapshots(payload?.scopeId),
      rollbackStack: engine.getRollbackStack(payload?.scopeId),
      auditHistory: engine.getAuditHistory(payload?.limit)
    })
  );

  ctx.registerRoute?.("GET", "/plugins/purge/rules", () => ({
    rules: engine.listRules()
  }));

  ctx.registerRoute?.(
    "POST",
    "/plugins/purge/rules",
    (payload: { rule: PurgeRule }) => {
      engine.addRule(payload.rule);
      return { added: payload.rule.id, rules: engine.listRules() };
    }
  );

  ctx.effect(() => {
    engine.dispose();
    ctx.logger.info("Disposed @prismux/plugin-purge interceptors and engine");
  });

  return engine;
}

export function createPurgePluginModule(
  options: CreatePurgePluginOptions = {}
): PrismuxPluginModule {
  return {
    manifest,
    apply(ctx: PluginContext): void {
      applyWithOptions(ctx, options);
    }
  };
}

export function apply(ctx: PluginContext): void {
  applyWithOptions(ctx);
}
