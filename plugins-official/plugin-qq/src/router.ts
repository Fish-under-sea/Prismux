import type {
  CallerScope,
  MemoryNamespace,
  MemoryQueryRequest,
  MemoryQueryResponse
} from "@prismux/protocol";
import { isScopeAllowedForNamespace } from "@prismux/protocol";
import {
  buildOneBotSendGroupMsgAction,
  buildOneBotSendPrivateMsgAction,
  detectBotMention,
  extractPlainTextFromSegments,
  parseOneBotMessageSegments,
  type OneBotActionPayload,
  type OneBotConnectionConfig,
  type OneBotInboundMessageEvent,
  type OneBotMessageSegment
} from "./onebot.js";
import {
  GroupPacingEngine,
  type GroupPacingDecision,
  type HumanReplySegment
} from "./pacing.js";

export type ChiefIntentKind =
  | "check_email"
  | "dispatch_factory"
  | "query_progress"
  | "chief_chat";

export interface QqInboundMessage {
  messageId?: string;
  messageType: "private" | "group";
  userId: string;
  groupId?: string;
  rawMessage: string;
  segments?: OneBotMessageSegment[];
  botQqId?: string;
  senderNickname?: string;
  timestamp?: number;
  mentionsBot?: boolean;
  isLoopback?: boolean;
}

export interface QqRouteMemoryPolicy {
  callerScope: CallerScope;
  lockedNamespace?: MemoryNamespace;
  canAccessPrivateChief: boolean;
  canAccessWorkspace: boolean;
  allowedNamespaces: string[];
  forbiddenNamespaces: string[];
}

export interface QqScopedMemoryQueryResult extends MemoryQueryResponse {
  enforcedCallerScope: CallerScope;
  enforcedNamespace?: MemoryNamespace;
  blockedNamespaces: string[];
}

export interface QqChiefDispatchContext {
  callerScope: "owner_chief";
  intent: ChiefIntentKind;
  userId: string;
  text: string;
  message: QqInboundMessage;
  memoryPolicy: QqRouteMemoryPolicy;
  queryMemory: (
    query: string,
    options?: Omit<MemoryQueryRequest, "callerScope" | "query">
  ) => Promise<QqScopedMemoryQueryResult>;
}

export interface QqGroupDispatchContext {
  callerScope: `qq_group:${string}`;
  namespace: `social/qq-group-${string}`;
  groupId: string;
  userId: string;
  text: string;
  mentionsBot: boolean;
  pacingDecision: GroupPacingDecision;
  message: QqInboundMessage;
  memoryPolicy: QqRouteMemoryPolicy;
  queryMemory: (
    query: string,
    options?: Omit<MemoryQueryRequest, "callerScope" | "query">
  ) => Promise<QqScopedMemoryQueryResult>;
}

export type QqMemoryQueryRunner = (
  request: MemoryQueryRequest
) => Promise<MemoryQueryResponse> | MemoryQueryResponse;

export type QqChiefHandler = (
  context: QqChiefDispatchContext
) => Promise<string> | string;

export type QqGroupResponder = (
  context: QqGroupDispatchContext
) => Promise<string> | string;

export type QqRouteKind =
  | "owner_private_chief"
  | "authorized_group_reply"
  | "authorized_group_suppressed"
  | "ignored_non_owner_private"
  | "ignored_unauthorized_group";

export interface QqRouteResult {
  handled: boolean;
  route: QqRouteKind;
  callerScope?: CallerScope;
  namespace?: MemoryNamespace;
  intent?: ChiefIntentKind;
  plainText: string;
  replyText?: string;
  segments: HumanReplySegment[];
  pacingDecision?: GroupPacingDecision;
  memoryPolicy?: QqRouteMemoryPolicy;
  outboundActions: OneBotActionPayload[];
  reason?: string;
}

export interface QqRouterOptions {
  config: OneBotConnectionConfig;
  pacingEngine?: GroupPacingEngine;
  botAliases?: string[];
  memoryQuery?: QqMemoryQueryRunner;
  chiefHandler?: QqChiefHandler;
  groupResponder?: QqGroupResponder;
  randomFn?: () => number;
}

export class QqScopeIsolationError extends Error {
  readonly callerScope: CallerScope;
  readonly attemptedNamespace: string;

  constructor(callerScope: CallerScope, attemptedNamespace: string) {
    super(
      `Physical domain isolation blocked "${callerScope}" from accessing namespace "${attemptedNamespace}".`
    );
    this.name = "QqScopeIsolationError";
    this.callerScope = callerScope;
    this.attemptedNamespace = attemptedNamespace;
  }
}

export function resolveGroupCallerScope(groupId: string): CallerScope {
  return `qq_group:${groupId}`;
}

export function resolveGroupMemoryNamespace(
  groupId: string
): `social/qq-group-${string}` {
  const trimmed = groupId.trim();
  if (trimmed.length === 0 || /[\s/\\\0]/.test(trimmed) || trimmed.includes("..")) {
    throw new Error(`Invalid QQ groupId "${groupId}" for memory namespace.`);
  }
  return `social/qq-group-${trimmed}`;
}

export function assertRouteNamespaceAllowed(
  callerScope: CallerScope,
  namespace: MemoryNamespace
): void {
  if (!isScopeAllowedForNamespace(callerScope, namespace)) {
    throw new QqScopeIsolationError(callerScope, namespace);
  }
}

export function classifyChiefIntent(text: string): ChiefIntentKind {
  const normalized = text.trim().toLowerCase();
  if (
    normalized.includes("查邮件") ||
    normalized.includes("收件箱") ||
    normalized.includes("未读邮件") ||
    normalized.includes("邮件") ||
    normalized.includes("inbox") ||
    normalized.includes("email") ||
    normalized.includes("mail")
  ) {
    return "check_email";
  }
  if (
    normalized.includes("夜间工场") ||
    normalized.includes("#factory") ||
    normalized.includes("factory") ||
    normalized.includes("派发") ||
    normalized.includes("夜班") ||
    normalized.includes("后台任务") ||
    normalized.includes("新建任务")
  ) {
    return "dispatch_factory";
  }
  if (
    normalized.includes("查进度") ||
    normalized.includes("查询进度") ||
    normalized.includes("进度") ||
    normalized.includes("状态") ||
    normalized.includes("progress") ||
    normalized.includes("status")
  ) {
    return "query_progress";
  }
  return "chief_chat";
}

function defaultChiefReply(ctx: QqChiefDispatchContext): string {
  switch (ctx.intent) {
    case "check_email":
      return `已连接主秘书线程（scope: ${ctx.callerScope}），正在为您检索近期重要邮件与 #factory 触发信件。`;
    case "dispatch_factory":
      return `主秘书已接收夜间工场任务指令：「${ctx.text}」，将通过 Handoff 与沙箱分支排期执行。`;
    case "query_progress":
      return `当前主秘书线程在线（scope: ${ctx.callerScope}），后台任务队列运行正常，暂未发现阻塞项。`;
    case "chief_chat":
    default:
      return `主秘书收到：「${ctx.text}」（已启用 private/chief 与 workspace/* 完整权限）。`;
  }
}

function defaultGroupReply(ctx: QqGroupDispatchContext): string {
  if (ctx.pacingDecision.reason === "at_mention") {
    return `收到！${ctx.text ? `关于「${ctx.text}」，` : ""}我只在当前群（${ctx.namespace}）的独立记忆里接茬，不会碰工作区信息～`;
  }
  if (ctx.pacingDecision.reason === "keyword_match") {
    return `刚看到关键词「${ctx.pacingDecision.matchedKeyword ?? ""}」！需要我帮忙补充点公开资料吗？`;
  }
  return `路过冒个泡～大家聊得正热闹呢！`;
}

export function buildMemoryPolicyForScope(
  callerScope: CallerScope
): QqRouteMemoryPolicy {
  if (callerScope === "owner_chief") {
    return {
      callerScope,
      canAccessPrivateChief: true,
      canAccessWorkspace: true,
      allowedNamespaces: ["private/chief", "workspace/*", "social/qq-group-*"],
      forbiddenNamespaces: []
    };
  }
  const groupId = callerScope.slice("qq_group:".length);
  const lockedNamespace = resolveGroupMemoryNamespace(groupId);
  return {
    callerScope,
    lockedNamespace,
    canAccessPrivateChief: false,
    canAccessWorkspace: false,
    allowedNamespaces: [lockedNamespace],
    forbiddenNamespaces: ["private/chief", "workspace/*"]
  };
}

/**
 * Dual-route message router enforcing physical 3-domain isolation:
 * - Owner private message -> `owner_chief` (Chief Thread Slot: email / factory / progress)
 * - Authorized group message -> `qq_group:<gid>` & `social/qq-group-<gid>` ONLY
 * - Unauthorized groups / non-owner private messages -> silently ignored
 */
export class QqMessageRouter {
  private config: OneBotConnectionConfig;
  private readonly pacingEngine: GroupPacingEngine;
  private botAliases: string[];
  private memoryQuery?: QqMemoryQueryRunner;
  private chiefHandler?: QqChiefHandler;
  private groupResponder?: QqGroupResponder;
  private randomFn?: () => number;

  constructor(options: QqRouterOptions) {
    this.config = {
      ...options.config,
      authorizedGroups: [...options.config.authorizedGroups]
    };
    this.pacingEngine = options.pacingEngine ?? new GroupPacingEngine();
    this.botAliases = [...(options.botAliases ?? ["@Prismux", "@小棱镜"])];
    this.memoryQuery = options.memoryQuery;
    this.chiefHandler = options.chiefHandler;
    this.groupResponder = options.groupResponder;
    this.randomFn = options.randomFn;
  }

  getConfig(): OneBotConnectionConfig {
    return {
      ...this.config,
      authorizedGroups: [...this.config.authorizedGroups]
    };
  }

  updateConfig(config: OneBotConnectionConfig): void {
    this.config = {
      ...config,
      authorizedGroups: [...config.authorizedGroups]
    };
  }

  getPacingEngine(): GroupPacingEngine {
    return this.pacingEngine;
  }

  setMemoryQueryRunner(runner: QqMemoryQueryRunner | undefined): void {
    this.memoryQuery = runner;
  }

  setChiefHandler(handler: QqChiefHandler | undefined): void {
    this.chiefHandler = handler;
  }

  setGroupResponder(responder: QqGroupResponder | undefined): void {
    this.groupResponder = responder;
  }

  /**
   * Executes a memory query bound physically to `verifiedScope`.
   * Any attempt by a `qq_group:<gid>` scope to query `private/chief` or `workspace/*`
   * is blocked at the boundary and returns empty hits.
   */
  async queryScopedMemory(
    verifiedScope: CallerScope,
    query: string,
    options?: Omit<MemoryQueryRequest, "callerScope" | "query">
  ): Promise<QqScopedMemoryQueryResult> {
    if (verifiedScope === "owner_chief") {
      const request: MemoryQueryRequest = {
        ...options,
        callerScope: "owner_chief",
        query
      };
      const base = this.memoryQuery
        ? await this.memoryQuery(request)
        : { hits: [], totalCandidates: 0, degradedToFtsOnly: false };
      return {
        ...base,
        enforcedCallerScope: "owner_chief",
        blockedNamespaces: []
      };
    }

    const groupId = verifiedScope.slice("qq_group:".length);
    const lockedNamespace = resolveGroupMemoryNamespace(groupId);
    const requestedNamespaces = options?.namespaces ?? [];
    const blockedNamespaces: string[] = [];
    const allowedRequested: MemoryNamespace[] = [];

    for (const ns of requestedNamespaces) {
      if (isScopeAllowedForNamespace(verifiedScope, ns)) {
        allowedRequested.push(ns);
      } else {
        blockedNamespaces.push(ns);
      }
    }

    // Caller explicitly asked ONLY for forbidden domains (e.g. private/chief or workspace/*).
    if (requestedNamespaces.length > 0 && allowedRequested.length === 0) {
      return {
        hits: [],
        totalCandidates: 0,
        degradedToFtsOnly: false,
        enforcedCallerScope: verifiedScope,
        enforcedNamespace: lockedNamespace,
        blockedNamespaces
      };
    }

    const safeRequest: MemoryQueryRequest = {
      ...options,
      callerScope: verifiedScope,
      query,
      namespaces: [lockedNamespace]
    };

    if (!this.memoryQuery) {
      return {
        hits: [],
        totalCandidates: 0,
        degradedToFtsOnly: false,
        enforcedCallerScope: verifiedScope,
        enforcedNamespace: lockedNamespace,
        blockedNamespaces
      };
    }

    const rawResult = await this.memoryQuery(safeRequest);
    const filteredHits = rawResult.hits.filter(
      (hit) => hit.entry.namespace === lockedNamespace
    );

    return {
      hits: filteredHits,
      totalCandidates: filteredHits.length,
      degradedToFtsOnly: rawResult.degradedToFtsOnly,
      enforcedCallerScope: verifiedScope,
      enforcedNamespace: lockedNamespace,
      blockedNamespaces
    };
  }

  async routeOneBotEvent(event: OneBotInboundMessageEvent): Promise<QqRouteResult> {
    const segments = parseOneBotMessageSegments(event.message);
    const rawMessage =
      event.raw_message ??
      (typeof event.message === "string"
        ? event.message
        : extractPlainTextFromSegments(segments));

    return this.routeMessage({
      messageId:
        event.message_id !== undefined ? String(event.message_id) : undefined,
      messageType: event.message_type,
      userId: String(event.user_id),
      groupId:
        event.group_id !== undefined ? String(event.group_id) : undefined,
      rawMessage,
      segments,
      botQqId:
        event.self_id !== undefined
          ? String(event.self_id)
          : this.config.botQqId,
      senderNickname: event.sender?.card || event.sender?.nickname,
      timestamp:
        event.time !== undefined ? event.time * 1000 : Date.now()
    });
  }

  async routeMessage(message: QqInboundMessage): Promise<QqRouteResult> {
    const segments =
      message.segments ?? parseOneBotMessageSegments(message.rawMessage);
    const plainText = extractPlainTextFromSegments(segments);

    if (message.messageType === "private") {
      if (message.userId !== this.config.ownerQqId) {
        return {
          handled: false,
          route: "ignored_non_owner_private",
          plainText,
          segments: [],
          outboundActions: [],
          reason: `Private sender "${message.userId}" is not configured ownerQqId.`
        };
      }

      const callerScope: "owner_chief" = "owner_chief";
      const memoryPolicy = buildMemoryPolicyForScope(callerScope);
      const intent = classifyChiefIntent(plainText);
      const dispatchCtx: QqChiefDispatchContext = {
        callerScope,
        intent,
        userId: message.userId,
        text: plainText,
        message,
        memoryPolicy,
        queryMemory: (query, opts) =>
          this.queryScopedMemory(callerScope, query, opts)
      };

      const replyText = this.chiefHandler
        ? await this.chiefHandler(dispatchCtx)
        : defaultChiefReply(dispatchCtx);

      const plannedSegments = this.pacingEngine.planSegments(replyText);
      const outboundActions: OneBotActionPayload[] =
        replyText.trim().length > 0
          ? [buildOneBotSendPrivateMsgAction(message.userId, replyText)]
          : [];

      return {
        handled: true,
        route: "owner_private_chief",
        callerScope,
        intent,
        plainText,
        replyText,
        segments: plannedSegments,
        memoryPolicy,
        outboundActions
      };
    }

    const groupId = message.groupId?.trim();
    if (!groupId || !this.config.authorizedGroups.includes(groupId)) {
      return {
        handled: false,
        route: "ignored_unauthorized_group",
        plainText,
        segments: [],
        outboundActions: [],
        reason: groupId
          ? `Group "${groupId}" is not in authorizedGroups.`
          : "Missing groupId on group message."
      };
    }

    const callerScope = resolveGroupCallerScope(groupId) as `qq_group:${string}`;
    const lockedNamespace = resolveGroupMemoryNamespace(groupId);
    const memoryPolicy = buildMemoryPolicyForScope(callerScope);

    const botQqId = message.botQqId ?? this.config.botQqId;
    const mentionsBot =
      message.mentionsBot === true ||
      detectBotMention(
        message.segments ?? message.rawMessage,
        botQqId,
        this.botAliases
      );

    const pacingDecision = this.pacingEngine.evaluate(
      {
        groupId,
        userId: message.userId,
        text: plainText,
        mentionsBot,
        timestamp: message.timestamp
      },
      { randomFn: this.randomFn }
    );

    if (!pacingDecision.shouldReply) {
      return {
        handled: true,
        route: "authorized_group_suppressed",
        callerScope,
        namespace: lockedNamespace,
        plainText,
        segments: [],
        pacingDecision,
        memoryPolicy,
        outboundActions: [],
        reason: `Group reply suppressed (${pacingDecision.reason}).`
      };
    }

    const groupCtx: QqGroupDispatchContext = {
      callerScope,
      namespace: lockedNamespace,
      groupId,
      userId: message.userId,
      text: plainText,
      mentionsBot,
      pacingDecision,
      message,
      memoryPolicy,
      queryMemory: (query, opts) =>
        this.queryScopedMemory(callerScope, query, opts)
    };

    const replyText = this.groupResponder
      ? await this.groupResponder(groupCtx)
      : defaultGroupReply(groupCtx);

    const plannedSegments = this.pacingEngine.planSegments(replyText);
    const outboundActions: OneBotActionPayload[] = plannedSegments.map((seg) =>
      buildOneBotSendGroupMsgAction(groupId, seg.text)
    );

    return {
      handled: true,
      route: "authorized_group_reply",
      callerScope,
      namespace: lockedNamespace,
      plainText,
      replyText,
      segments: plannedSegments,
      pacingDecision,
      memoryPolicy,
      outboundActions
    };
  }
}

export interface LoopbackTranscriptEntry {
  id: string;
  timestamp: number;
  messageType: "private" | "group";
  userId: string;
  groupId?: string;
  inboundText: string;
  routeResult: QqRouteResult;
}

export interface LoopbackIsolationProbeReport {
  groupId: string;
  callerScope: CallerScope;
  lockedNamespace: MemoryNamespace;
  privateChiefHits: number;
  workspaceHits: number;
  blockedNamespaces: string[];
  isolated: boolean;
}

/**
 * Zero-client in-memory loopback harness enabling full private & group QQ
 * message routing, pacing, and 3-domain isolation tests without any QQ client installed.
 */
export class OneBotLoopbackHarness {
  private readonly router: QqMessageRouter;
  private readonly history: LoopbackTranscriptEntry[] = [];
  private seq = 0;

  constructor(routerOrOptions: QqMessageRouter | QqRouterOptions) {
    this.router =
      routerOrOptions instanceof QqMessageRouter
        ? routerOrOptions
        : new QqMessageRouter(routerOrOptions);
  }

  getRouter(): QqMessageRouter {
    return this.router;
  }

  async simulatePrivateMessage(
    text: string,
    options?: {
      userId?: string;
      timestamp?: number;
      messageId?: string;
    }
  ): Promise<LoopbackTranscriptEntry> {
    const config = this.router.getConfig();
    const userId = options?.userId ?? config.ownerQqId;
    const timestamp = options?.timestamp ?? Date.now();
    const routeResult = await this.router.routeMessage({
      messageId: options?.messageId ?? `lb-pm-${this.seq + 1}`,
      messageType: "private",
      userId,
      rawMessage: text,
      timestamp,
      isLoopback: true
    });

    return this.recordEntry("private", userId, undefined, text, timestamp, routeResult);
  }

  async simulateGroupMessage(
    groupId: string,
    text: string,
    options?: {
      userId?: string;
      mentionsBot?: boolean;
      timestamp?: number;
      messageId?: string;
    }
  ): Promise<LoopbackTranscriptEntry> {
    const config = this.router.getConfig();
    const userId = options?.userId ?? "200001";
    const timestamp = options?.timestamp ?? Date.now();
    const rawMessage =
      options?.mentionsBot && config.botQqId
        ? `[CQ:at,qq=${config.botQqId}] ${text}`
        : text;

    const routeResult = await this.router.routeMessage({
      messageId: options?.messageId ?? `lb-gm-${this.seq + 1}`,
      messageType: "group",
      userId,
      groupId,
      rawMessage,
      mentionsBot: options?.mentionsBot,
      botQqId: config.botQqId,
      timestamp,
      isLoopback: true
    });

    return this.recordEntry("group", userId, groupId, text, timestamp, routeResult);
  }

  async simulateOneBotEvent(
    event: OneBotInboundMessageEvent
  ): Promise<LoopbackTranscriptEntry> {
    const timestamp = event.time !== undefined ? event.time * 1000 : Date.now();
    const routeResult = await this.router.routeOneBotEvent(event);
    const plain = routeResult.plainText;

    return this.recordEntry(
      event.message_type,
      String(event.user_id),
      event.group_id !== undefined ? String(event.group_id) : undefined,
      plain,
      timestamp,
      routeResult
    );
  }

  /**
   * Self-test verifying that a group caller scope cannot read `private/chief`
   * or `workspace/*` even when explicitly requested.
   */
  async verifyDomainIsolation(
    groupId: string,
    probeQuery = "secret token"
  ): Promise<LoopbackIsolationProbeReport> {
    const callerScope = resolveGroupCallerScope(groupId);
    const lockedNamespace = resolveGroupMemoryNamespace(groupId);

    const privateAttempt = await this.router.queryScopedMemory(
      callerScope,
      probeQuery,
      { namespaces: ["private/chief"] }
    );
    const workspaceAttempt = await this.router.queryScopedMemory(
      callerScope,
      probeQuery,
      { namespaces: ["workspace/default"] }
    );

    const blockedNamespaces = Array.from(
      new Set([
        ...privateAttempt.blockedNamespaces,
        ...workspaceAttempt.blockedNamespaces
      ])
    );

    return {
      groupId,
      callerScope,
      lockedNamespace,
      privateChiefHits: privateAttempt.hits.length,
      workspaceHits: workspaceAttempt.hits.length,
      blockedNamespaces,
      isolated:
        privateAttempt.hits.length === 0 &&
        workspaceAttempt.hits.length === 0 &&
        blockedNamespaces.includes("private/chief") &&
        blockedNamespaces.includes("workspace/default")
    };
  }

  getTranscript(): readonly LoopbackTranscriptEntry[] {
    return [...this.history];
  }

  clear(): void {
    this.history.length = 0;
  }

  dispose(): void {
    this.clear();
  }

  private recordEntry(
    messageType: "private" | "group",
    userId: string,
    groupId: string | undefined,
    inboundText: string,
    timestamp: number,
    routeResult: QqRouteResult
  ): LoopbackTranscriptEntry {
    this.seq += 1;
    const entry: LoopbackTranscriptEntry = {
      id: `loopback-${this.seq}`,
      timestamp,
      messageType,
      userId,
      groupId,
      inboundText,
      routeResult
    };
    this.history.push(entry);
    return entry;
  }
}
