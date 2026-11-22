import { randomUUID } from "node:crypto";
import type {
  ApprovalGuideCard,
  IslandCardAction,
  IslandCardKind,
  IslandHookEvent,
  IslandHookResponse,
  PluginCredentialsHandle,
  PluginLogger
} from "@prismux/protocol";
import {
  createApprovalCardFromGuide,
  createEmailIslandCard,
  createFactoryCompleteIslandCard,
  type ApprovalIslandCardInput,
  type EmailAlertInput,
  type FactoryCompleteCardInput
} from "./cards.js";
import {
  FishDockPushError,
  postIslandCardHttp,
  type FishDockBridgeConfig,
  type FishDockPushResult
} from "./transport.js";

const CREDENTIAL_KEY_ENDPOINT_URL = "fishdock:endpointUrl";
const CREDENTIAL_KEY_AUTH_TOKEN = "fishdock:authToken";

export interface IslandApprovalDecision {
  cardId: string;
  requestId: string;
  action: "approve" | "reject";
  allow: boolean;
  threadId?: string;
  sessionId?: string;
  approvalGuide: ApprovalGuideCard;
  respondedAt: number;
}

export interface IslandWorkbenchOpenEvent {
  cardId: string;
  kind: IslandCardKind;
  deepLink?: string;
  requestId?: string;
  respondedAt: number;
}

export interface IslandDismissEvent {
  cardId: string;
  kind: IslandCardKind;
  respondedAt: number;
}

export type ApprovalDecisionCallback = (
  decision: IslandApprovalDecision
) => void | Promise<void>;

export interface IslandActionCallbackResult {
  handled: boolean;
  status:
    | "approved"
    | "rejected"
    | "opened"
    | "dismissed"
    | "not_found"
    | "already_resolved"
    | "disposed";
  cardId: string;
  kind?: IslandCardKind;
  action: IslandCardAction;
  requestId?: string;
  allow?: boolean;
  deepLink?: string;
  respondedAt: number;
}

export interface PendingApprovalSummary {
  cardId: string;
  requestId: string;
  threadId?: string;
  sessionId?: string;
  approvalGuide: ApprovalGuideCard;
  createdAt: number;
}

interface PendingApprovalRecord extends PendingApprovalSummary {
  card: IslandHookEvent;
  onDecision?: ApprovalDecisionCallback;
}

interface PushedCardRecord {
  card: IslandHookEvent;
  requestId?: string;
  resolvedAction?: IslandCardAction;
}

export interface FishDockIslandBridgeOptions {
  config?: Partial<FishDockBridgeConfig>;
  credentials?: PluginCredentialsHandle;
  logger?: PluginLogger;
  onApprovalDecision?: ApprovalDecisionCallback;
  onOpenWorkbench?: (event: IslandWorkbenchOpenEvent) => void | Promise<void>;
  onDismiss?: (event: IslandDismissEvent) => void | Promise<void>;
}

/**
 * Bidirectional bridge between Prismux lifecycle/factory events and the FISH-Dock Dynamic Island.
 */
export class FishDockIslandBridge {
  private config: FishDockBridgeConfig;
  private readonly credentials: PluginCredentialsHandle | undefined;
  private readonly logger: PluginLogger | undefined;
  private readonly onApprovalDecision: ApprovalDecisionCallback | undefined;
  private readonly onOpenWorkbench:
    | ((event: IslandWorkbenchOpenEvent) => void | Promise<void>)
    | undefined;
  private readonly onDismiss:
    | ((event: IslandDismissEvent) => void | Promise<void>)
    | undefined;

  private readonly pendingApprovals = new Map<string, PendingApprovalRecord>();
  private readonly pushedCards = new Map<string, PushedCardRecord>();
  private readonly actionListeners = new Set<
    (result: IslandActionCallbackResult) => void | Promise<void>
  >();
  private readonly inFlightControllers = new Set<AbortController>();
  private disposed = false;

  constructor(options: FishDockIslandBridgeOptions = {}) {
    this.config = {
      endpointUrl: options.config?.endpointUrl ?? "",
      ...(options.config?.authToken !== undefined
        ? { authToken: options.config.authToken }
        : {}),
      ...(options.config?.timeoutMs !== undefined
        ? { timeoutMs: options.config.timeoutMs }
        : {}),
      ...(options.config?.headers !== undefined
        ? { headers: { ...options.config.headers } }
        : {}),
      ...(options.config?.autoPushHooks !== undefined
        ? { autoPushHooks: options.config.autoPushHooks }
        : {})
    };
    this.credentials = options.credentials;
    this.logger = options.logger;
    this.onApprovalDecision = options.onApprovalDecision;
    this.onOpenWorkbench = options.onOpenWorkbench;
    this.onDismiss = options.onDismiss;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  configure(next: Partial<FishDockBridgeConfig>): void {
    this.assertNotDisposed();
    this.config = {
      ...this.config,
      ...next,
      ...(next.headers !== undefined
        ? { headers: { ...(this.config.headers ?? {}), ...next.headers } }
        : {})
    };
  }

  getConfig(): FishDockBridgeConfig {
    return {
      ...this.config,
      ...(this.config.headers !== undefined
        ? { headers: { ...this.config.headers } }
        : {})
    };
  }

  hasEndpointConfigured(): boolean {
    return this.config.endpointUrl.trim().length > 0;
  }

  async loadCredentials(): Promise<void> {
    if (this.credentials === undefined || this.disposed) {
      return;
    }
    const [storedEndpoint, storedToken] = await Promise.all([
      this.credentials.get(CREDENTIAL_KEY_ENDPOINT_URL),
      this.credentials.get(CREDENTIAL_KEY_AUTH_TOKEN)
    ]);
    if (this.disposed) {
      return;
    }
    if (
      storedEndpoint !== null &&
      storedEndpoint.trim().length > 0 &&
      this.config.endpointUrl.trim().length === 0
    ) {
      this.config.endpointUrl = storedEndpoint.trim();
    }
    if (
      storedToken !== null &&
      storedToken.length > 0 &&
      this.config.authToken === undefined
    ) {
      this.config.authToken = storedToken;
    }
  }

  async saveCredentials(next: Partial<FishDockBridgeConfig>): Promise<void> {
    this.assertNotDisposed();
    this.configure(next);
    if (this.credentials === undefined) {
      return;
    }
    if (next.endpointUrl !== undefined) {
      await this.credentials.set(CREDENTIAL_KEY_ENDPOINT_URL, next.endpointUrl);
    }
    if (next.authToken !== undefined) {
      if (next.authToken.length === 0) {
        await this.credentials.delete(CREDENTIAL_KEY_AUTH_TOKEN);
      } else {
        await this.credentials.set(CREDENTIAL_KEY_AUTH_TOKEN, next.authToken);
      }
    }
  }

  onAction(
    listener: (result: IslandActionCallbackResult) => void | Promise<void>
  ): () => void {
    this.assertNotDisposed();
    this.actionListeners.add(listener);
    return () => {
      this.actionListeners.delete(listener);
    };
  }

  getPendingCount(): number {
    return this.pendingApprovals.size;
  }

  getPendingApprovals(): PendingApprovalSummary[] {
    return Array.from(this.pendingApprovals.values()).map((entry) => ({
      cardId: entry.cardId,
      requestId: entry.requestId,
      ...(entry.threadId !== undefined ? { threadId: entry.threadId } : {}),
      ...(entry.sessionId !== undefined ? { sessionId: entry.sessionId } : {}),
      approvalGuide: { ...entry.approvalGuide },
      createdAt: entry.createdAt
    }));
  }

  registerPendingApproval(
    card: IslandHookEvent,
    details: {
      requestId: string;
      threadId?: string;
      sessionId?: string;
      approvalGuide: ApprovalGuideCard;
      onDecision?: ApprovalDecisionCallback;
    }
  ): void {
    this.assertNotDisposed();
    this.pushedCards.set(card.cardId, {
      card,
      requestId: details.requestId
    });
    this.pendingApprovals.set(card.cardId, {
      cardId: card.cardId,
      requestId: details.requestId,
      ...(details.threadId !== undefined ? { threadId: details.threadId } : {}),
      ...(details.sessionId !== undefined
        ? { sessionId: details.sessionId }
        : {}),
      approvalGuide: { ...details.approvalGuide },
      createdAt: card.createdAt,
      card,
      ...(details.onDecision !== undefined
        ? { onDecision: details.onDecision }
        : {})
    });
  }

  async pushCard(card: IslandHookEvent): Promise<FishDockPushResult> {
    this.assertNotDisposed();
    await this.loadCredentials();
    this.assertNotDisposed();

    if (!this.pushedCards.has(card.cardId)) {
      this.pushedCards.set(card.cardId, { card });
    }

    const controller = new AbortController();
    this.inFlightControllers.add(controller);
    try {
      return await postIslandCardHttp(this.config, card, controller.signal);
    } finally {
      this.inFlightControllers.delete(controller);
    }
  }

  async pushApprovalGuide(
    input: ApprovalIslandCardInput,
    onDecision?: ApprovalDecisionCallback
  ): Promise<{ card: IslandHookEvent; pushResult: FishDockPushResult }> {
    this.assertNotDisposed();
    const card = createApprovalCardFromGuide({
      ...input,
      cardId: input.cardId ?? `island-approval-${input.requestId || randomUUID()}`
    });
    this.registerPendingApproval(card, {
      requestId: input.requestId,
      ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      approvalGuide: input.approvalGuide,
      ...(onDecision !== undefined ? { onDecision } : {})
    });
    const pushResult = await this.pushCard(card);
    return { card, pushResult };
  }

  async pushEmailAlert(
    input: EmailAlertInput
  ): Promise<{ card: IslandHookEvent; pushResult: FishDockPushResult }> {
    this.assertNotDisposed();
    const card = createEmailIslandCard(input);
    this.pushedCards.set(card.cardId, { card });
    const pushResult = await this.pushCard(card);
    return { card, pushResult };
  }

  async pushFactoryComplete(
    input: FactoryCompleteCardInput
  ): Promise<{ card: IslandHookEvent; pushResult: FishDockPushResult }> {
    this.assertNotDisposed();
    const card = createFactoryCompleteIslandCard(input);
    this.pushedCards.set(card.cardId, { card });
    const pushResult = await this.pushCard(card);
    return { card, pushResult };
  }

  /**
   * Routes a Dynamic Island action receipt (`approve` / `reject` / `open_workbench` / `dismiss`)
   * back to the corresponding host approval or workbench callback.
   */
  async handleActionCallback(
    response: IslandHookResponse
  ): Promise<IslandActionCallbackResult> {
    if (
      typeof response?.cardId !== "string" ||
      response.cardId.trim().length === 0
    ) {
      throw new FishDockPushError(
        "IslandHookResponse.cardId must be a non-empty string."
      );
    }
    const validActions = new Set<IslandCardAction>([
      "approve",
      "reject",
      "open_workbench",
      "dismiss"
    ]);
    if (!validActions.has(response.action)) {
      throw new FishDockPushError(
        `Unsupported IslandHookResponse.action: "${String(response.action)}".`
      );
    }

    const respondedAt =
      typeof response.respondedAt === "number" &&
      Number.isFinite(response.respondedAt)
        ? response.respondedAt
        : Date.now();

    if (this.disposed) {
      return {
        handled: false,
        status: "disposed",
        cardId: response.cardId,
        action: response.action,
        respondedAt
      };
    }

    const pushedRecord = this.pushedCards.get(response.cardId);
    const pendingApproval = this.pendingApprovals.get(response.cardId);

    if (response.action === "approve" || response.action === "reject") {
      if (pendingApproval === undefined) {
        if (pushedRecord?.resolvedAction !== undefined) {
          return {
            handled: false,
            status: "already_resolved",
            cardId: response.cardId,
            kind: pushedRecord.card.kind,
            action: response.action,
            ...(pushedRecord.requestId !== undefined
              ? { requestId: pushedRecord.requestId }
              : {}),
            respondedAt
          };
        }
        return {
          handled: false,
          status: "not_found",
          cardId: response.cardId,
          ...(pushedRecord !== undefined ? { kind: pushedRecord.card.kind } : {}),
          action: response.action,
          respondedAt
        };
      }

      const allow = response.action === "approve";
      this.pendingApprovals.delete(response.cardId);
      if (pushedRecord !== undefined) {
        pushedRecord.resolvedAction = response.action;
      }

      const decision: IslandApprovalDecision = {
        cardId: response.cardId,
        requestId: pendingApproval.requestId,
        action: response.action,
        allow,
        ...(pendingApproval.threadId !== undefined
          ? { threadId: pendingApproval.threadId }
          : {}),
        ...(pendingApproval.sessionId !== undefined
          ? { sessionId: pendingApproval.sessionId }
          : {}),
        approvalGuide: pendingApproval.approvalGuide,
        respondedAt
      };

      await pendingApproval.onDecision?.(decision);
      await this.onApprovalDecision?.(decision);

      const result: IslandActionCallbackResult = {
        handled: true,
        status: allow ? "approved" : "rejected",
        cardId: response.cardId,
        kind: pendingApproval.card.kind,
        action: response.action,
        requestId: pendingApproval.requestId,
        allow,
        ...(pendingApproval.card.deepLink !== undefined
          ? { deepLink: pendingApproval.card.deepLink }
          : {}),
        respondedAt
      };
      await this.notifyActionListeners(result);
      return result;
    }

    if (pushedRecord === undefined) {
      return {
        handled: false,
        status: "not_found",
        cardId: response.cardId,
        action: response.action,
        respondedAt
      };
    }

    if (response.action === "open_workbench") {
      await this.onOpenWorkbench?.({
        cardId: response.cardId,
        kind: pushedRecord.card.kind,
        ...(pushedRecord.card.deepLink !== undefined
          ? { deepLink: pushedRecord.card.deepLink }
          : {}),
        ...(pushedRecord.requestId !== undefined
          ? { requestId: pushedRecord.requestId }
          : {}),
        respondedAt
      });

      const result: IslandActionCallbackResult = {
        handled: true,
        status: "opened",
        cardId: response.cardId,
        kind: pushedRecord.card.kind,
        action: "open_workbench",
        ...(pushedRecord.requestId !== undefined
          ? { requestId: pushedRecord.requestId }
          : {}),
        ...(pushedRecord.card.deepLink !== undefined
          ? { deepLink: pushedRecord.card.deepLink }
          : {}),
        respondedAt
      };
      await this.notifyActionListeners(result);
      return result;
    }

    // `dismiss`
    this.pendingApprovals.delete(response.cardId);
    pushedRecord.resolvedAction = "dismiss";
    await this.onDismiss?.({
      cardId: response.cardId,
      kind: pushedRecord.card.kind,
      respondedAt
    });

    const result: IslandActionCallbackResult = {
      handled: true,
      status: "dismissed",
      cardId: response.cardId,
      kind: pushedRecord.card.kind,
      action: "dismiss",
      ...(pushedRecord.requestId !== undefined
        ? { requestId: pushedRecord.requestId }
        : {}),
      respondedAt
    };
    await this.notifyActionListeners(result);
    return result;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const controller of this.inFlightControllers) {
      controller.abort();
    }
    this.inFlightControllers.clear();
    this.pendingApprovals.clear();
    this.pushedCards.clear();
    this.actionListeners.clear();
    this.logger?.info("Disposed FishDockIslandBridge pending approvals and listeners");
  }

  private async notifyActionListeners(
    result: IslandActionCallbackResult
  ): Promise<void> {
    for (const listener of [...this.actionListeners]) {
      await listener(result);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new FishDockPushError(
        "FishDockIslandBridge has been disposed and can no longer accept operations."
      );
    }
  }
}
