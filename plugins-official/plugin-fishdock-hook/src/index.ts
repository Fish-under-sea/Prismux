import { readFileSync } from "node:fs";
import type {
  HookInvocationContext,
  IslandHookEvent,
  IslandHookResponse,
  PluginContext,
  PluginManifest,
  PrismuxPluginModule
} from "@prismux/protocol";
import {
  FishDockIslandBridge,
  type ApprovalDecisionCallback,
  type FishDockIslandBridgeOptions
} from "./bridge.js";
import {
  createApprovalCardFromGuide,
  createApprovalIslandCard,
  createEmailIslandCard,
  createFactoryCompleteIslandCard,
  translateHookContextToApprovalGuide,
  type ApprovalIslandCardInput,
  type EmailAlertInput,
  type FactoryCompleteCardInput
} from "./cards.js";
import type { FishDockBridgeConfig } from "./transport.js";

export * from "./cards.js";
export * from "./transport.js";
export * from "./bridge.js";

function readBundledManifestVersion(fallback: string): string {
  try {
    const raw = readFileSync(new URL("../plugin.manifest.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
  } catch {
    // Fallback to static version if manifest file is unavailable.
  }
  return fallback;
}

export const manifest: PluginManifest = {
  id: "fishdock-hook",
  version: readBundledManifestVersion("0.2.3-rc.1"),
  realms: ["daemon"],
  permissions: ["network:outbound", "hooks:subscribe", "notifications:push"],
  modelVisible: false,
  behaviors: {
    autostart: true
  }
};

export interface CreateFishDockPluginOptions extends FishDockIslandBridgeOptions {
  onBridgeCreated?: (bridge: FishDockIslandBridge) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveNotificationPayload(
  context: HookInvocationContext
): IslandHookEvent | null {
  const payload = isRecord(context.toolInput)
    ? context.toolInput
    : isRecord(context.toolOutput)
      ? context.toolOutput
      : undefined;

  if (payload === undefined) {
    return null;
  }

  const kind = payload.kind;
  if (kind === "email" && isRecord(payload.email)) {
    const email = payload.email;
    if (
      typeof email.messageId === "string" &&
      typeof email.from === "string" &&
      typeof email.subject === "string"
    ) {
      return createEmailIslandCard({
        messageId: email.messageId,
        from: email.from,
        subject: email.subject,
        ...(typeof email.snippet === "string" ? { snippet: email.snippet } : {}),
        ...(email.importance === "high" || email.importance === "normal"
          ? { importance: email.importance }
          : {}),
        ...(typeof email.threadId === "string"
          ? { threadId: email.threadId }
          : {}),
        ...(typeof email.deepLink === "string"
          ? { deepLink: email.deepLink }
          : {})
      });
    }
  }

  if (kind === "factory_complete" && isRecord(payload.factoryReport)) {
    const report = payload.factoryReport;
    if (
      typeof report.jobId === "string" &&
      typeof report.threadId === "string" &&
      typeof report.summary === "string"
    ) {
      return createFactoryCompleteIslandCard({
        jobId: report.jobId,
        threadId: report.threadId,
        summary: report.summary,
        ...(typeof report.branchName === "string"
          ? { branchName: report.branchName }
          : {}),
        ...(typeof report.changedFilesCount === "number"
          ? { changedFilesCount: report.changedFilesCount }
          : {}),
        ...(typeof report.deepLink === "string"
          ? { deepLink: report.deepLink }
          : {})
      });
    }
  }

  return null;
}

async function tryPushHookCard(
  bridge: FishDockIslandBridge,
  card: IslandHookEvent,
  ctx: PluginContext
): Promise<void> {
  await bridge.loadCredentials();
  if (!bridge.hasEndpointConfigured()) {
    return;
  }
  try {
    await bridge.pushCard(card);
  } catch (error) {
    ctx.logger.warn("Failed to push Dynamic Island card to FISH-Dock", {
      cardId: card.cardId,
      kind: card.kind,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export function applyWithOptions(
  ctx: PluginContext,
  options: CreateFishDockPluginOptions = {}
): FishDockIslandBridge {
  const bridge = new FishDockIslandBridge({
    ...options,
    credentials: options.credentials ?? ctx.credentials,
    logger: options.logger ?? ctx.logger
  });
  options.onBridgeCreated?.(bridge);

  ctx.logger.info("Initialized @prismux/plugin-fishdock-hook", {
    realm: ctx.realm
  });

  ctx.onHook?.("PreToolUse", async (hookContext) => {
    if (bridge.isDisposed()) {
      return undefined;
    }

    const input = hookContext.toolInput;
    const approvalRequestId =
      isRecord(input) && typeof input.approvalRequestId === "string"
        ? input.approvalRequestId
        : `${hookContext.sessionId}:${hookContext.threadId}:${hookContext.timestamp}`;

    const approvalGuide = translateHookContextToApprovalGuide(hookContext);
    const card = createApprovalCardFromGuide({
      requestId: approvalRequestId,
      sessionId: hookContext.sessionId,
      threadId: hookContext.threadId,
      approvalGuide
    });

    bridge.registerPendingApproval(card, {
      requestId: approvalRequestId,
      sessionId: hookContext.sessionId,
      threadId: hookContext.threadId,
      approvalGuide
    });

    if (bridge.getConfig().autoPushHooks !== false) {
      await tryPushHookCard(bridge, card, ctx);
    }
    return undefined;
  });

  ctx.onHook?.("Notification", async (hookContext) => {
    if (bridge.isDisposed()) {
      return undefined;
    }
    const card = resolveNotificationPayload(hookContext);
    if (card === null) {
      return undefined;
    }
    if (bridge.getConfig().autoPushHooks !== false) {
      await tryPushHookCard(bridge, card, ctx);
    }
    return undefined;
  });

  ctx.registerRoute?.(
    "POST",
    "/plugins/fishdock-hook/callback",
    async (payload: IslandHookResponse) => {
      return bridge.handleActionCallback(payload);
    }
  );

  ctx.registerRoute?.(
    "POST",
    "/plugins/fishdock-hook/notify",
    async (
      payload:
        | { kind: "approval"; data: ApprovalIslandCardInput; onDecision?: ApprovalDecisionCallback }
        | { kind: "email"; data: EmailAlertInput }
        | { kind: "factory_complete"; data: FactoryCompleteCardInput }
        | { kind: "raw"; card: IslandHookEvent }
    ) => {
      if (payload.kind === "approval") {
        return bridge.pushApprovalGuide(payload.data, payload.onDecision);
      }
      if (payload.kind === "email") {
        return bridge.pushEmailAlert(payload.data);
      }
      if (payload.kind === "factory_complete") {
        return bridge.pushFactoryComplete(payload.data);
      }
      return bridge.pushCard(payload.card);
    }
  );

  ctx.registerRoute?.(
    "POST",
    "/plugins/fishdock-hook/config",
    async (nextConfig: Partial<FishDockBridgeConfig>) => {
      await bridge.saveCredentials(nextConfig);
      return {
        endpointConfigured: bridge.hasEndpointConfigured(),
        endpointUrl: bridge.getConfig().endpointUrl
      };
    }
  );

  ctx.registerRoute?.("GET", "/plugins/fishdock-hook/status", () => ({
    disposed: bridge.isDisposed(),
    endpointConfigured: bridge.hasEndpointConfigured(),
    pendingCount: bridge.getPendingCount(),
    pendingApprovals: bridge.getPendingApprovals()
  }));

  ctx.effect(() => {
    bridge.dispose();
    ctx.logger.info("Disposed @prismux/plugin-fishdock-hook bridge and mappings");
  });

  return bridge;
}

export function createFishDockPluginModule(
  options: CreateFishDockPluginOptions = {}
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
