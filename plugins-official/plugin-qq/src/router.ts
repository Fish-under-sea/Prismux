import process from "node:process";
import type {
  CallerScope,
  DispatchTaskArtifact,
  DispatchTaskCategory,
  DispatchThreadRequest,
  MemoryNamespace,
  MemoryQueryRequest,
  MemoryQueryResponse,
  PrismuxDispatchEnvelope
} from "@prismux/protocol";

function isScopeAllowedForNamespace(
  callerScope: CallerScope,
  namespace: MemoryNamespace
): boolean {
  if (callerScope === "owner_chief") {
    return true;
  }
  if (callerScope.startsWith("qq_group:")) {
    const groupId = callerScope.slice("qq_group:".length);
    return groupId.length > 0 && namespace === `social/qq-group-${groupId}`;
  }
  return false;
}
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
  | "dispatch_coding"
  | "query_progress"
  | "chief_chat";

export interface QqDaemonDispatchResult {
  ok: boolean;
  httpStatus: number;
  envelope?: PrismuxDispatchEnvelope;
  errorCode?: string;
  errorMessage?: string;
}

export type QqDaemonDispatcher = (
  request: DispatchThreadRequest
) => Promise<QqDaemonDispatchResult>;

export interface QqHttpDaemonDispatchOptions {
  daemonUrl: string;
  authToken: string;
  fetchFn?: typeof fetch;
}

const EXPLICIT_PERSONAL_AGY_RE =
  /(?:用|使用|调用|唤醒|交给|让|派给|指定)\s*(?:个人版\s*)?(?:antigravity|agy)\b|\b(?:use|call|invoke|ask|assign\s+to|dispatch\s+to)\s+(?:personal\s+)?(?:antigravity|agy)\b|\bprovider\s*[:=]\s*(?:antigravity|agy)\b|#(antigravity|agy)\b/i;

const QQ_BACKEND_HARD_RE =
  /(?:并发|死锁|竞态|架构重构|底层重构|性能优化|内存泄漏|安全审计|数据库迁移|复杂后端|疑难|deadlock|race\s+condition|architecture\s+refactor|security\s+audit)/i;

const QQ_PLANNING_RE =
  /(?:规划|方案设计|架构设计|拆解任务|技术方案|roadmap|rfc|spec)/i;

const QQ_FRONTEND_RE =
  /(?:前端|界面|页面|样式|动画|布局|组件|液态玻璃|壁纸|弹窗|css|tailwind|react|ui\/ux|frontend)/i;

const QQ_CODING_DISPATCH_RE =
  /(?:帮我|请)?(?:写代码|修复|实现|重构|开发|改一下|排查|补单测|加个功能|做个|用\s*(?:codex|claude|opencode|dsh|agy|antigravity)|\/dispatch|\/code)/i;

/**
 * Detects whether an owner QQ private message explicitly names personal Antigravity (AGY).
 */
export function detectExplicitPersonalAntigravityIntent(text: string): boolean {
  return EXPLICIT_PERSONAL_AGY_RE.test(text.trim());
}

/**
 * Infers structured task category from owner QQ private prompt so Daemon's Parameter Backdoor
 * routes smoothly without GUI dropdown clicks.
 */
export function inferQqTaskCategory(text: string): DispatchTaskCategory {
  if (QQ_BACKEND_HARD_RE.test(text)) {
    return "backend_hard";
  }
  if (QQ_PLANNING_RE.test(text)) {
    return "planning";
  }
  if (QQ_FRONTEND_RE.test(text)) {
    return "frontend";
  }
  return "backend_standard";
}

/**
 * Formats a concise plain-Chinese QQ reply for dual-track Daemon dispatch responses:
 * - Track 1 (automated workers): confirms auto-dispatch & ArtifactResultBackdoor straight reply.
 * - Track 2 (personal AGY): confirms Draft-Only staging, Worktree path, and awaiting desktop confirmation.
 */
export function formatQqDispatchReply(result: QqDaemonDispatchResult): string {
  if (!result.ok || result.envelope === undefined) {
    const code = result.errorCode ? `[${result.errorCode}] ` : "";
    return `派发未放行：${code}${result.errorMessage ?? `Daemon 返回 HTTP ${result.httpStatus}`}`;
  }

  const env = result.envelope;
  const targetPath = env.worktreePath ?? env.workspacePath;

  if (
    env.mode === "draft_only" ||
    env.requiresHumanConfirmation ||
    env.status === "awaiting_human_confirmation"
  ) {
    return [
      `【个人版 AGY 草稿已就位 · 待桌面确认】`,
      `按安全硬锁定规则，QQ 远程绝不会自动触发个人版 Antigravity（AGY）。`,
      `任务 ID：${env.taskId}`,
      `Worktree / 工作区：${targetPath}`,
      ...(env.memoryContextSummary
        ? [`已召回记忆：${env.memoryContextSummary}`]
        : []),
      `请回到桌面端 Prismux 点击「确认放行并发送」后正式执行。`
    ].join("\n");
  }

  return [
    `【已自动派发执行】`,
    `执行节点：${env.provider} / ${env.modelId}（思考强度：${env.reasoningEffort}）`,
    `任务 ID：${env.taskId}`,
    `工作区：${targetPath}`,
    `完工后将通过产物直出通道直接汇报中文摘要与 Diff 统计。`
  ].join("\n");
}

/**
 * Formats a straight plain-Chinese QQ reply from `ArtifactResultBackdoor` completion payload,
 * skipping any heavy Oracle second-review step.
 */
export function formatQqArtifactCompletionReply(
  artifact: DispatchTaskArtifact
): string {
  const filesPreview =
    artifact.modifiedFiles.length > 0
      ? artifact.modifiedFiles.slice(0, 6).join("、") +
        (artifact.modifiedFiles.length > 6
          ? ` 等共 ${artifact.modifiedFiles.length} 个文件`
          : "")
      : "无文件变更";
  return [
    `【任务完工直达回执】${artifact.plainLanguageSummary}`,
    `Diff 统计：${artifact.diffStats.filesChanged} 个文件（+${artifact.diffStats.insertions} / -${artifact.diffStats.deletions}）`,
    `改动文件：${filesPreview}`,
    ...(artifact.branchName ? [`分支：${artifact.branchName}`] : [])
  ].join("\n");
}

/**
 * Creates a real HTTP client targeting Daemon `POST /v1/dispatch/thread` with Bearer authentication.
 */
export function createHttpDaemonDispatcher(
  options: QqHttpDaemonDispatchOptions
): QqDaemonDispatcher {
  const baseUrl = options.daemonUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchFn ?? fetch;

  return async (
    request: DispatchThreadRequest
  ): Promise<QqDaemonDispatchResult> => {
    const res = await fetchImpl(`${baseUrl}/v1/dispatch/thread`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.authToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(request)
    });

    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      envelope?: PrismuxDispatchEnvelope;
      error?: { code?: string; message?: string };
    };

    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        errorCode: body.error?.code,
        errorMessage: body.error?.message
      };
    }

    return {
      ok: true,
      httpStatus: res.status,
      envelope: body.envelope
    };
  };
}

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
  dispatchToDaemon?: (
    overrides?: Partial<Omit<DispatchThreadRequest, "callerKind">>
  ) => Promise<QqDaemonDispatchResult>;
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
  dispatchEnvelope?: PrismuxDispatchEnvelope;
  dispatchResult?: QqDaemonDispatchResult;
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
  daemonDispatcher?: QqDaemonDispatcher;
  defaultWorkspacePath?: string;
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
  if (
    detectExplicitPersonalAntigravityIntent(text) ||
    QQ_CODING_DISPATCH_RE.test(text)
  ) {
    return "dispatch_coding";
  }
  return "chief_chat";
}

function defaultChiefReply(ctx: QqChiefDispatchContext): string {
  switch (ctx.intent) {
    case "check_email":
      return `已连接主秘书线程（scope: ${ctx.callerScope}），正在为您检索近期重要邮件与 #factory 触发信件。`;
    case "dispatch_factory":
      return `主秘书已接收夜间工场任务指令：「${ctx.text}」，将通过 Handoff 与沙箱分支排期执行。`;
    case "dispatch_coding":
      return `主秘书已接收开发任务指令：「${ctx.text}」，请配置 Daemon 派发通道以自动路由至工作节点。`;
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
  private daemonDispatcher?: QqDaemonDispatcher;
  private defaultWorkspacePath: string;
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
    this.daemonDispatcher = options.daemonDispatcher;
    this.defaultWorkspacePath = options.defaultWorkspacePath ?? process.cwd();
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

  setDaemonDispatcher(dispatcher: QqDaemonDispatcher | undefined): void {
    this.daemonDispatcher = dispatcher;
  }

  setDefaultWorkspacePath(workspacePath: string): void {
    if (workspacePath.trim().length > 0) {
      this.defaultWorkspacePath = workspacePath.trim();
    }
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

      const dispatchToDaemon = this.daemonDispatcher
        ? async (
            overrides?: Partial<Omit<DispatchThreadRequest, "callerKind">>
          ): Promise<QqDaemonDispatchResult> => {
            const explicitAgy =
              overrides?.explicitAntigravityRequested ??
              detectExplicitPersonalAntigravityIntent(plainText);
            let memoryContextSummary = overrides?.memoryContextSummary;
            if (memoryContextSummary === undefined && this.memoryQuery) {
              try {
                const mem = await this.queryScopedMemory(callerScope, plainText, {
                  limit: 3
                });
                if (mem.hits.length > 0) {
                  memoryContextSummary = mem.hits
                    .map((h) => `[${h.entry.namespace}] ${h.entry.title}`)
                    .join("；");
                }
              } catch {
                // Memory enrichment is best-effort.
              }
            }
            const reqPayload: DispatchThreadRequest = {
              prompt: overrides?.prompt ?? plainText,
              workspacePath:
                overrides?.workspacePath ?? this.defaultWorkspacePath,
              ...(overrides?.worktreePath !== undefined
                ? { worktreePath: overrides.worktreePath }
                : {}),
              ...(overrides?.branchName !== undefined
                ? { branchName: overrides.branchName }
                : {}),
              callerKind: "secretary_qq",
              taskCategory:
                overrides?.taskCategory ?? inferQqTaskCategory(plainText),
              ...(overrides?.provider !== undefined
                ? { provider: overrides.provider }
                : explicitAgy
                  ? { provider: "antigravity" }
                  : {}),
              ...(overrides?.modelId !== undefined
                ? { modelId: overrides.modelId }
                : {}),
              ...(overrides?.reasoningEffort !== undefined
                ? { reasoningEffort: overrides.reasoningEffort }
                : {}),
              ...(explicitAgy ? { explicitAntigravityRequested: true } : {}),
              ...(memoryContextSummary !== undefined
                ? { memoryContextSummary }
                : {}),
              replyChannel: overrides?.replyChannel ?? {
                kind: "qq",
                targetId: message.userId,
                label: "QQ 私聊主秘书"
              }
            };
            return this.daemonDispatcher!(reqPayload);
          }
        : undefined;

      const dispatchCtx: QqChiefDispatchContext = {
        callerScope,
        intent,
        userId: message.userId,
        text: plainText,
        message,
        memoryPolicy,
        queryMemory: (query, opts) =>
          this.queryScopedMemory(callerScope, query, opts),
        ...(dispatchToDaemon !== undefined ? { dispatchToDaemon } : {})
      };

      let replyText: string;
      let dispatchResult: QqDaemonDispatchResult | undefined;
      if (this.chiefHandler) {
        replyText = await this.chiefHandler(dispatchCtx);
      } else if (
        dispatchToDaemon !== undefined &&
        (intent === "dispatch_factory" || intent === "dispatch_coding")
      ) {
        dispatchResult = await dispatchToDaemon();
        replyText = formatQqDispatchReply(dispatchResult);
      } else {
        replyText = defaultChiefReply(dispatchCtx);
      }

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
        ...(dispatchResult?.envelope !== undefined
          ? { dispatchEnvelope: dispatchResult.envelope }
          : {}),
        ...(dispatchResult !== undefined ? { dispatchResult } : {}),
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
