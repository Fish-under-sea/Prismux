import { readFileSync } from "node:fs";
import type {
  HookInvocationContext,
  PluginContext,
  PluginManifest
} from "@prismux/protocol";
import {
  buildOneBotSendPrivateMsgAction,
  deleteOneBotAccessToken,
  loadOneBotAccessToken,
  OneBotWsBridge,
  probeLocalOneBotPorts,
  sanitizeOneBotConfig,
  saveOneBotAccessToken,
  validateOneBotConnectionConfig,
  type OneBotConnectionConfig,
  type OneBotPortProbeOptions,
  type OneBotPortProbeResult,
  type SanitizedOneBotConnectionConfig
} from "./onebot.js";
import { GroupPacingEngine, type GroupPacingConfig } from "./pacing.js";
import {
  OneBotLoopbackHarness,
  QqMessageRouter,
  type QqChiefHandler,
  type QqGroupResponder,
  type QqInboundMessage,
  type QqMemoryQueryRunner,
  type QqRouteResult
} from "./router.js";

export * from "./onebot.js";
export * from "./pacing.js";
export * from "./router.js";

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
  id: "qq",
  version: readBundledManifestVersion("0.2.0-rc.1"),
  realms: ["daemon", "ui"],
  permissions: [
    "network:outbound",
    "network:inbound",
    "memory:social-qq",
    "hooks:subscribe"
  ],
  modelVisible: false,
  behaviors: {
    autostart: true,
    supportsLoopbackTest: true
  }
};

export interface QqOwnerNotificationRecord {
  event: string;
  title: string;
  body: string;
  timestamp: number;
}

export interface QqPluginRuntimeOptions {
  initialConfig?: Partial<OneBotConnectionConfig>;
  pacingConfig?: Partial<GroupPacingConfig>;
  botAliases?: string[];
  memoryQuery?: QqMemoryQueryRunner;
  chiefHandler?: QqChiefHandler;
  groupResponder?: QqGroupResponder;
  onOwnerNotification?: (record: QqOwnerNotificationRecord) => Promise<void> | void;
}

export interface QqPluginStatusSnapshot {
  disposed: boolean;
  realm: PluginContext["realm"];
  wsConnected: boolean;
  config: SanitizedOneBotConnectionConfig;
  loopbackHistoryCount: number;
  activeTimers: number;
  notificationCount: number;
}

const DEFAULT_QQ_CONNECTION_CONFIG: OneBotConnectionConfig = {
  mode: "forward-ws",
  wsUrl: "ws://127.0.0.1:3001",
  ownerQqId: "10001",
  authorizedGroups: [],
  implementation: "napcat"
};

const runtimeByContext = new WeakMap<PluginContext, QqPluginRuntime>();

export function getQqRuntime(ctx: PluginContext): QqPluginRuntime | undefined {
  return runtimeByContext.get(ctx);
}

/**
 * Runtime container for `@prismux/plugin-qq`, encapsulating OneBot transport,
 * dual-route three-domain router, group pacing, loopback testing, and clean disposal.
 */
export class QqPluginRuntime {
  private readonly ctx: PluginContext;
  private readonly pacingEngine: GroupPacingEngine;
  private readonly router: QqMessageRouter;
  private readonly loopback: OneBotLoopbackHarness;
  private readonly notifications: QqOwnerNotificationRecord[] = [];
  private readonly onOwnerNotification?: (
    record: QqOwnerNotificationRecord
  ) => Promise<void> | void;
  private wsBridge: OneBotWsBridge | null = null;
  private config: OneBotConnectionConfig;
  private disposed = false;

  constructor(ctx: PluginContext, options?: QqPluginRuntimeOptions) {
    this.ctx = ctx;
    this.config = {
      ...DEFAULT_QQ_CONNECTION_CONFIG,
      ...options?.initialConfig,
      authorizedGroups: [...(options?.initialConfig?.authorizedGroups ?? [])]
    };
    this.onOwnerNotification = options?.onOwnerNotification;
    this.pacingEngine = new GroupPacingEngine(options?.pacingConfig);
    this.router = new QqMessageRouter({
      config: this.config,
      pacingEngine: this.pacingEngine,
      botAliases: options?.botAliases,
      memoryQuery: options?.memoryQuery,
      chiefHandler: options?.chiefHandler,
      groupResponder: options?.groupResponder
    });
    this.loopback = new OneBotLoopbackHarness(this.router);
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  getRouter(): QqMessageRouter {
    return this.router;
  }

  getPacingEngine(): GroupPacingEngine {
    return this.pacingEngine;
  }

  getLoopbackHarness(): OneBotLoopbackHarness {
    return this.loopback;
  }

  getNotifications(): readonly QqOwnerNotificationRecord[] {
    return [...this.notifications];
  }

  getStatus(): QqPluginStatusSnapshot {
    return {
      disposed: this.disposed,
      realm: this.ctx.realm,
      wsConnected: this.wsBridge?.isConnected() ?? false,
      config: sanitizeOneBotConfig(this.config),
      loopbackHistoryCount: this.loopback.getTranscript().length,
      activeTimers: this.pacingEngine.getActiveTimerCount(),
      notificationCount: this.notifications.length
    };
  }

  async probePorts(options?: OneBotPortProbeOptions): Promise<OneBotPortProbeResult> {
    this.assertActive();
    return probeLocalOneBotPorts(options);
  }

  async configure(nextConfig: OneBotConnectionConfig): Promise<SanitizedOneBotConnectionConfig> {
    this.assertActive();
    const validation = validateOneBotConnectionConfig(nextConfig);
    if (!validation.valid || validation.normalizedConfig === undefined) {
      throw new Error(
        `Invalid OneBot configuration: ${validation.errors.join("; ")}`
      );
    }

    const normalized = validation.normalizedConfig;
    if (normalized.accessToken !== undefined) {
      if (normalized.accessToken.length > 0) {
        await saveOneBotAccessToken(this.ctx.credentials, normalized.accessToken);
      } else {
        await deleteOneBotAccessToken(this.ctx.credentials);
      }
    }

    this.config = normalized;
    this.router.updateConfig(normalized);
    return sanitizeOneBotConfig(normalized);
  }

  async hydrateStoredToken(): Promise<boolean> {
    this.assertActive();
    const token = await loadOneBotAccessToken(this.ctx.credentials);
    if (token !== null && token.length > 0) {
      this.config = { ...this.config, accessToken: token };
      this.router.updateConfig(this.config);
      return true;
    }
    return false;
  }

  async connectTransport(): Promise<void> {
    this.assertActive();
    if (this.wsBridge !== null) {
      await this.wsBridge.close();
      this.wsBridge = null;
    }
    const bridge = new OneBotWsBridge(this.config, {
      onMessage: async (event) => {
        if (this.disposed) {
          return;
        }
        const routed = await this.router.routeOneBotEvent(event);
        if (routed.handled && bridge.isConnected()) {
          for (const action of routed.outboundActions) {
            bridge.sendAction(action);
          }
        }
      },
      onError: (err) => {
        this.ctx.logger.warn("OneBot WebSocket transport error", {
          error: err.message
        });
      }
    });
    await bridge.connect();
    this.wsBridge = bridge;
  }

  async handleInboundMessage(message: QqInboundMessage): Promise<QqRouteResult> {
    this.assertActive();
    return this.router.routeMessage(message);
  }

  async handleHookNotification(hookCtx: HookInvocationContext): Promise<void> {
    if (this.disposed) {
      return;
    }
    const summaryRaw =
      typeof hookCtx.toolOutput === "string"
        ? hookCtx.toolOutput
        : hookCtx.toolName
          ? `${hookCtx.event}: ${hookCtx.toolName}`
          : `${hookCtx.event} (thread: ${hookCtx.threadId})`;

    const record: QqOwnerNotificationRecord = {
      event: hookCtx.event,
      title:
        hookCtx.event === "Stop"
          ? "Prismux 任务完工摘要"
          : "Prismux 主秘书提醒",
      body: summaryRaw,
      timestamp: hookCtx.timestamp
    };
    this.notifications.push(record);
    if (this.notifications.length > 50) {
      this.notifications.shift();
    }

    if (this.onOwnerNotification) {
      await this.onOwnerNotification(record);
    }

    if (this.wsBridge?.isConnected() && this.config.ownerQqId) {
      this.wsBridge.sendAction(
        buildOneBotSendPrivateMsgAction(
          this.config.ownerQqId,
          `[${record.title}] ${record.body}`
        )
      );
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.pacingEngine.dispose();
    this.loopback.dispose();
    this.notifications.length = 0;

    if (this.wsBridge !== null) {
      const bridge = this.wsBridge;
      this.wsBridge = null;
      await bridge.close();
    }
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error("@prismux/plugin-qq runtime has been disposed.");
    }
  }
}

export function applyWithOptions(
  ctx: PluginContext,
  options?: QqPluginRuntimeOptions
): QqPluginRuntime {
  const runtime = new QqPluginRuntime(ctx, options);
  runtimeByContext.set(ctx, runtime);

  if (ctx.realm === "daemon") {
    ctx.registerRoute?.("GET", "/plugins/qq/status", () => runtime.getStatus());
    ctx.registerRoute?.(
      "POST",
      "/plugins/qq/probe",
      async (body?: OneBotPortProbeOptions) => runtime.probePorts(body)
    );
    ctx.registerRoute?.(
      "POST",
      "/plugins/qq/config",
      async (body: OneBotConnectionConfig) => runtime.configure(body)
    );
    ctx.registerRoute?.(
      "POST",
      "/plugins/qq/loopback",
      async (body: {
        messageType: "private" | "group";
        text: string;
        groupId?: string;
        userId?: string;
        mentionsBot?: boolean;
      }) => {
        if (body.messageType === "private") {
          return runtime
            .getLoopbackHarness()
            .simulatePrivateMessage(body.text, { userId: body.userId });
        }
        return runtime
          .getLoopbackHarness()
          .simulateGroupMessage(body.groupId ?? "", body.text, {
            userId: body.userId,
            mentionsBot: body.mentionsBot
          });
      }
    );
    ctx.registerRoute?.(
      "POST",
      "/plugins/qq/inbound",
      async (body: QqInboundMessage) => runtime.handleInboundMessage(body)
    );

    ctx.onHook?.("Stop", async (hookCtx) => {
      await runtime.handleHookNotification(hookCtx);
    });
    ctx.onHook?.("Notification", async (hookCtx) => {
      await runtime.handleHookNotification(hookCtx);
    });
  }

  if (ctx.realm === "ui") {
    ctx.registerPanel?.("qq.companion", {
      title: "QQ 秘书与群聊桥接"
    });
  }

  ctx.logger.info("Initialized @prismux/plugin-qq runtime", {
    realm: ctx.realm
  });

  ctx.effect(async () => {
    await runtime.dispose();
    runtimeByContext.delete(ctx);
    ctx.logger.info("Disposed @prismux/plugin-qq runtime", {
      realm: ctx.realm
    });
  });

  return runtime;
}

export function createQqPluginModule(options?: QqPluginRuntimeOptions): {
  manifest: PluginManifest;
  apply: (ctx: PluginContext) => void;
  getRuntime: (ctx: PluginContext) => QqPluginRuntime | undefined;
} {
  return {
    manifest,
    apply(ctx: PluginContext): void {
      applyWithOptions(ctx, options);
    },
    getRuntime(ctx: PluginContext): QqPluginRuntime | undefined {
      return getQqRuntime(ctx);
    }
  };
}

export function apply(ctx: PluginContext): void {
  applyWithOptions(ctx);
}
